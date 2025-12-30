/**
 * DynamoDB Backend for Observability
 * 
 * Stores all observability events in DynamoDB.
 * All config injected via DI - no fallbacks.
 */

import { Inject, Injectable, InjectConfig } from '../../di';
import { createLogger } from '../../logging';
import { ObservabilityLogCreateItem, ObservabilityLogService } from '../storage/service';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
import { estimateItemSize, truncatePayload } from '../utils/payload';
import { compressItem, type CompressionConfig } from '../utils/compression';

const logger = createLogger('DynamoDBObservabilityBackend');

// DynamoDB limits
const DYNAMO_BATCH_SIZE = 25;
const DYNAMO_MAX_ITEM_SIZE = 400 * 1024; // 400KB per item
const MAX_BUFFER_SIZE = 1000;

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: [ 'observability', 'backend', 'dynamodb' ]
})
export class DynamoDBObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'dynamodb';
  public readonly minLevel?: ObservabilityLevel;

  private buffer: ObservabilityEvent[] = [];
  private readonly ttlDays: number;
  private readonly compressionConfig: CompressionConfig;

  constructor(
    @InjectConfig('observability.dynamodb.ttlDays') ttlDays: number,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel,
    @InjectConfig('observability.dynamodb.compression') compression: CompressionConfig,
    @Inject(ObservabilityLogService) private readonly service: ObservabilityLogService
  ) {
    this.minLevel = minLevel;
    this.ttlDays = ttlDays;
    this.compressionConfig = compression;
  }

  initializeInvocation(): void {
    this.buffer = [];
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    // CRITICAL: span.start events should NEVER be stored in DynamoDB
    // They are only for OTEL's span tracking. Skip them entirely.
    if (event.type === 'span.start') {
      // This shouldn't happen if filtering works, but guard against it
      logger.debug('Skipping span.start event in DynamoDB backend', {
        observabilityLogId: event.observabilityLogId,
        operation: event.operation,
      });
      return; // Skip - do NOT buffer
    }

    this.buffer.push(event);

    if (this.buffer.length >= DYNAMO_BATCH_SIZE) {
      await this.flush();
    }

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      logger.warn(`Buffer overflow (${this.buffer.length} events), force flushing`);
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);

    for (let i = 0; i < events.length; i += DYNAMO_BATCH_SIZE) {
      const batch = events.slice(i, i + DYNAMO_BATCH_SIZE);
      await this.writeBatch(batch);
    }
  }

  private static readonly RETRYABLE_ERRORS = new Set([
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'RequestLimitExceeded',
    'InternalServerError',
    'ServiceUnavailable',
  ]);

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;

    const errorName = (error as { name?: string }).name;
    if (errorName && DynamoDBObservabilityBackend.RETRYABLE_ERRORS.has(errorName)) {
      return true;
    }

    const errorCode = (error as { code?: string }).code;
    if (errorCode && DynamoDBObservabilityBackend.RETRYABLE_ERRORS.has(errorCode)) {
      return true;
    }

    const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    if (metadata?.httpStatusCode && metadata.httpStatusCode >= 500) {
      return true;
    }

    return false;
  }

  private async writeBatch(events: ObservabilityEvent[], retryCount = 0): Promise<void> {
    const MAX_RETRIES = 2;

    try {
      const nowSeconds = Math.floor(Date.now() / 1000);

      const items = events.map((event) => {
        // Use per-event TTL override if specified, otherwise use default
        const ttlDays = event.capture?.ttlDays ?? this.ttlDays;
        const ttlSeconds = nowSeconds + ttlDays * 24 * 60 * 60;
        return this.mapEventToItem(event, ttlSeconds);
      });

      // Filter out oversized items and items without observabilityLogId
      const validItems = items.filter((item): item is ObservabilityLogCreateItem & { observabilityLogId: string } => {
        // observabilityLogId is required for deduplication
        if (!item.observabilityLogId) {
          logger.warn('Item missing observabilityLogId, skipping');
          return false;
        }

        const size = estimateItemSize(item);
        if (size > DYNAMO_MAX_ITEM_SIZE) {
          logger.warn(`Item too large (${size} bytes), skipping:`, {
            observabilityLogId: item.observabilityLogId,
            type: item.type,
            size,
          });
          return false;
        }
        return true;
      });

      if (validItems.length === 0) return;

      // BatchWriteItem fails when the same PK appears multiple times in a single batch.
      // Under FW24, observabilityLogId MUST be globally unique per record.
      // If duplicates happen, it is an invariant violation. We choose a deterministic winner and log loudly.
      const levelRank = (level: unknown): number => {
        switch (level) {
          case 'critical': return 50;
          case 'error': return 40;
          case 'warn': return 30;
          case 'info': return 20;
          case 'debug': return 10;
          case 'trace': return 0;
          default: return -1;
        }
      };
      const pickWinner = (a: ObservabilityLogCreateItem, b: ObservabilityLogCreateItem): ObservabilityLogCreateItem => {
        const la = levelRank(a.level);
        const lb = levelRank(b.level);
        if (la !== lb) return la > lb ? a : b;

        // Deterministic tie-breaker: keep earlier timestampMs.
        // timestampMs is expected for persisted records; if it's missing, treat it as "latest" (keep the other).
        const tsa = a.timestampMs;
        const tsb = b.timestampMs;
        if (typeof tsa === 'number' && typeof tsb === 'number') {
          return tsa <= tsb ? a : b;
        }
        if (typeof tsa === 'number') return a;
        if (typeof tsb === 'number') return b;
        return a;
      };

      const chosenById = new Map<string, ObservabilityLogCreateItem>();
      const dupInfo: Array<{ id: string; count: number; types: string[]; levels: string[] }> = [];
      const grouped = new Map<string, ObservabilityLogCreateItem[]>();

      for (const item of validItems) {
        const list = grouped.get(item.observabilityLogId);
        if (list) list.push(item);
        else grouped.set(item.observabilityLogId, [ item ]);
      }

      for (const [ id, list ] of grouped) {
        if (list.length === 1) {
          chosenById.set(id, list[ 0 ]);
          continue;
        }
        let winner = list[ 0 ];
        for (let i = 1; i < list.length; i++) {
          winner = pickWinner(winner, list[ i ]);
        }
        chosenById.set(id, winner);
        dupInfo.push({
          id,
          count: list.length,
          types: list.map((x) => String(x.type)),
          levels: list.map((x) => String(x.level)),
        });
      }

      if (dupInfo.length > 0) {
        logger.error('Observability invariant violation: duplicate observabilityLogId(s) in a single DynamoDB batch.', {
          duplicateIdCount: dupInfo.length,
          duplicates: dupInfo.slice(0, 5),
          totalItems: validItems.length,
          deduplicatedCount: chosenById.size,
        });
      }

      const deduplicatedItems = Array.from(chosenById.values());
      if (deduplicatedItems.length === 0) return;

      // Apply compression to items if enabled
      const itemsToWrite = this.compressionConfig.enabled
        ? deduplicatedItems.map(item => compressItem(item, this.compressionConfig))
        : deduplicatedItems;

      await this.service.batchCreate(itemsToWrite);
    } catch (error) {
      if (this.isRetryableError(error) && retryCount < MAX_RETRIES) {
        logger.warn(`DynamoDB transient error, retrying (${retryCount + 1}/${MAX_RETRIES}):`, {
          errorName: (error as { name?: string }).name,
          errorCode: (error as { code?: string }).code,
        });
        await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
        return this.writeBatch(events, retryCount + 1);
      }

      logger.error('DynamoDB batch write failed:', {
        error: error instanceof Error ? error.message : String(error),
        errorName: (error as { name?: string }).name,
        eventCount: events.length,
        eventIds: events.map(e => e.observabilityLogId),
        retried: retryCount > 0,
      });
    }
  }

  private mapEventToItem(event: ObservabilityEvent, ttlSeconds: number): ObservabilityLogCreateItem {
    const item: ObservabilityLogCreateItem = {
      observabilityLogId: event.observabilityLogId,
      parentObservabilityLogId: typeof event.parentObservabilityLogId === 'string'
        ? event.parentObservabilityLogId
        : undefined,
      correlationId: event.correlationId,
      causedBy: event.causedBy,
      relatedTraces: event.relatedTraces,
      type: event.type,
      subType: event.subType,
      level: event.level,
      entityName: event.entityName,
      entityId: event.entityId,
      operation: event.operation,
      status: event.status,
      success: event.success,
      timestampMs: event.timestampMs,
      durationMs: event.durationMs,
      source: event.source,
      tags: event.tags,
      actor: event.actor ? truncatePayload(event.actor) : undefined,
      data: event.data ? truncatePayload(event.data) : undefined,
      attributes: event.attributes ? truncatePayload(event.attributes) : undefined,
      metadata: event.metadata ? truncatePayload(event.metadata) : undefined,
      metrics: event.metrics,
      context: event.context ? truncatePayload(event.context) : undefined,
      error: event.error,
      ttl: ttlSeconds,
    };
    return item;
  }
}
