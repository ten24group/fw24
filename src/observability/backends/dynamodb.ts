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

  constructor(
    @InjectConfig('observability.dynamodb.ttlDays') ttlDays: number,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel,
    @Inject(ObservabilityLogService) private readonly service: ObservabilityLogService
  ) {
    this.minLevel = minLevel;
    this.ttlDays = ttlDays;
  }

  initializeInvocation(): void {
    this.buffer = [];
  }

  async capture(event: ObservabilityEvent): Promise<void> {
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
      const ttlSeconds = Math.floor(Date.now() / 1000) + this.ttlDays * 24 * 60 * 60;

      const items = events.map((event) => this.mapEventToItem(event, ttlSeconds));

      const validItems = items.filter((item) => {
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

      await this.service.batchCreate(validItems);
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
      parentObservabilityLogId: event.parentObservabilityLogId,
      correlationId: event.correlationId,
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
    } as ObservabilityLogCreateItem;
  }
}
