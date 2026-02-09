/**
 * DynamoDB Backend for Observability
 * 
 * Stores all observability events in DynamoDB.
 * 
 * **Size Management:**
 * - Entity schema auto-compresses fields (data, metadata) via `compressed: true`
 * - Optional truncation applied here (if enabled in config)
 * - All config injected via DI
 */

import { Inject, Injectable, InjectConfig } from '../../di';
import { createLogger } from '../../logging';
import { ObservabilityLogCreateItem, ObservabilityLogService } from '../storage/service';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, DynamoDBConfig } from '../types';
import { truncateItem } from '../utils/payload';

const logger = createLogger('DynamoDBObservabilityBackend');

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: [ 'observability', 'backend', 'dynamodb' ]
})
export class DynamoDBObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'dynamodb';
  public readonly minLevel?: ObservabilityLevel;
  private buffer: ObservabilityEvent[] = [];
  private readonly config: DynamoDBConfig;

  constructor(
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel,
    @InjectConfig('observability.dynamodb') config: DynamoDBConfig,
    @Inject(ObservabilityLogService) private readonly service: ObservabilityLogService
  ) {
    this.minLevel = minLevel;
    this.config = config;

    if (config.truncation?.enabled) {
      logger.info('Truncation enabled for observability logs', {
        fields: config.truncation.fields,
        maxBytes: config.truncation.maxBytes
      });
    }
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

    if (this.buffer.length >= (this.config.maxBatchSize ?? 25)) {
      await this.flush();
    }

    if (this.buffer.length >= (this.config.maxBufferSize ?? 1000)) {
      logger.warn(`Buffer overflow (${this.buffer.length} events), force flushing`);
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);
    const batchSize = this.config.maxBatchSize ?? 25;

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
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
        const ttlDays = event.capture?.ttlDays ?? this.config.ttlDays;
        const ttlSeconds = nowSeconds + ttlDays * 24 * 60 * 60;
        return this.mapEventToItem(event, ttlSeconds);
      });

      const validItems = items.filter((item): item is ObservabilityLogCreateItem & { observabilityLogId: string } => {
        if (!item.observabilityLogId) {
          logger.warn('Item missing observabilityLogId, skipping');
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
        // All duplicates reaching DynamoDB are unexpected (span.start is filtered out in capture())
        const unexpectedDuplicates = dupInfo;

        if (unexpectedDuplicates.length > 0) {
          // Serialize unexpected duplicate info for debugging
          const duplicatesForLog = unexpectedDuplicates.slice(0, 5).map(d => {
            const items = grouped.get(d.id) ?? [];
            return {
              id: d.id,
              count: d.count,
              types: d.types.join(', '),
              levels: d.levels.join(', '),
              operations: items.map(i => i.operation).join(', '),
            };
          });
          // NOTE: These are often legitimate repeated operations (e.g., downloading 2 images, updating 3 records)
          // The deduplication picks a winner correctly, so this is DEBUG, not an ERROR
          logger.debug('Deduplicating observability events with same ID in batch (repeated operations).', {
            duplicateIdCount: unexpectedDuplicates.length,
            duplicates: duplicatesForLog,
            totalItems: validItems.length,
            deduplicatedCount: chosenById.size,
          });
        }
      }

      const deduplicatedItems = Array.from(chosenById.values());
      if (deduplicatedItems.length === 0) return;

      // Apply optional truncation (entity schema handles compression automatically)
      const itemsToWrite = this.config.truncation?.enabled
        ? deduplicatedItems.map(item => truncateItem(item, this.config.truncation!.fields, this.config.truncation!.maxBytes))
        : deduplicatedItems;

      // Service auto-compresses via entity schema (data, metadata fields)
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
    return {
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
      actor: event.actor,
      data: event.data,
      attributes: event.attributes,
      metadata: event.metadata,
      metrics: event.metrics,
      context: event.context,
      error: event.error,
      fingerprint: event.fingerprint,
      absorbed: event._absorbed,
      ttl: ttlSeconds,
    };
  }
}
