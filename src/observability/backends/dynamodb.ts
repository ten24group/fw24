import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
import { ObservabilityLogEntity } from '../storage/log-entity';
import { truncatePayload } from '../utils/payload';
import { createLogger } from '../../logging';

const logger = createLogger('DynamoDBObservabilityBackend');

export interface DynamoDBBackendOptions {
  minLevel?: ObservabilityLevel;
  ttlDays?: number;
}

export class DynamoDBObservabilityBackend implements ObservabilityBackend {
  public readonly name = 'dynamodb';
  private readonly entity = ObservabilityLogEntity();
  public readonly minLevel?: ObservabilityLevel;
  private buffer: ObservabilityEvent[] = [];

  private readonly BATCH_SIZE = 25; // DynamoDB max
  private readonly MAX_BUFFER_SIZE = 1000;

  constructor(private readonly options: DynamoDBBackendOptions = {}) {
    this.minLevel = options.minLevel;
  }

  initializeInvocation(): void {
    // Clear buffer on warm start
    this.buffer = [];
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    this.buffer.push(event);

    // Flush if buffer full
    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flush();
    }

    // Safety: Prevent memory overflow
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      logger.warn(`DynamoDB buffer overflow (${this.buffer.length} events), force flushing`);
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);

    // Process in batches of 25 (DynamoDB limit)
    const batches = this.chunkArray(events, 25);

    for (const batch of batches) {
      await this.writeBatch(batch);
    }
  }

  private async writeBatch(events: ObservabilityEvent[]): Promise<void> {
    try {
    const ttlSeconds =
      this.options.ttlDays !== undefined
        ? Math.floor(Date.now() / 1000) + this.options.ttlDays * 24 * 60 * 60
        : undefined;

      // Map events to entity records with complete field mapping
      const items = events.map((event) => ({
        // Identity fields
        logId: event.entityId, // For spans, use entityId as logId
        parentLogId: event.parentLogId,
        correlationId: event.correlationId,
        
        // Classification
        type: event.type,
        subType: event.subType,
        level: event.level,
        
        // Entity/Resource
        entityName: event.entityName,
        entityId: event.entityId,
        
        // Operation & Source
        operation: event.operation,
        source: event.source,
        
        // Tags for filtering
        tags: event.tags,
        
        // Outcome
        success: event.success,
        status: event.status,
        durationMs: event.durationMs,
        
        // Time
        timestampMs: event.timestampMs,
        
        // Actor
        actor: event.actor ? truncatePayload(event.actor) : undefined,
        
        // Payloads (keep separate, don't merge)
        data: event.data ? truncatePayload(event.data) : undefined,
        attributes: event.attributes ? truncatePayload(event.attributes) : undefined,
        metadata: event.metadata ? truncatePayload(event.metadata) : undefined,
        metrics: event.metrics,
        
        // Error handling
        error: event.error,
        
        // Context (if present)
        context: event.context ? truncatePayload(event.context) : undefined,
        
        // TTL
        ttl: ttlSeconds,
      }));

      // Write all items using ElectroDB batch write (true batch operation)
      await this.entity.put(items).go();
    } catch (error) {
      logger.error('DynamoDB batch write failed:', error);
      // Don't throw - observability should never break app
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
