/**
 * ObservabilityLogService - Self-contained service for observability data
 * 
 * Extends BaseEntityService but creates its own DynamoDB client internally.
 * This allows observability to work BEFORE DI is initialized.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BaseEntityService } from '../../entity/base-service';
import { Pagination } from '../../entity/query-types';
import { ObservabilityLogEntitySchema, ObservabilityLogSchema } from './log-entity';
import { ConfigManager } from '../config';
import { CreateEntityItemTypeFromSchema, EntityRecordTypeFromSchema } from '../../entity/base-entity';

type ObservabilityLogCreateItem = CreateEntityItemTypeFromSchema<ObservabilityLogSchema>;

/**
 * Reconstructed span with hierarchy for trace visualization
 */
export interface ReconstructedSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: string;
  success?: boolean;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timestamp: number; attributes: Record<string, unknown> }>;
  metrics: Record<string, number>;
  children: ReconstructedSpan[];
}

/**
 * Type for log record from query results
 */
export type LogRecord = EntityRecordTypeFromSchema<ObservabilityLogSchema>;

// Module-level lazy client
let _docClient: DynamoDBDocumentClient | null = null;

function getDocClient(): DynamoDBDocumentClient {
  if (!_docClient) {
    const client = new DynamoDBClient({});
    _docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _docClient;
}

/**
 * ObservabilityLogService
 * 
 * Self-contained service - creates its own DynamoDB client.
 */
export class ObservabilityLogService extends BaseEntityService<ObservabilityLogSchema> {
  private static instance: ObservabilityLogService | null = null;

  private constructor() {
    const config = ConfigManager.fromEnvironment();
    super(
      ObservabilityLogEntitySchema,
      {
        table: config.dynamodb.tableName,
        client: getDocClient(),
      },
    );
  }

  static getInstance(): ObservabilityLogService {
    if (!ObservabilityLogService.instance) {
      ObservabilityLogService.instance = new ObservabilityLogService();
    }
    return ObservabilityLogService.instance;
  }

  /**
   * Reset for testing
   * @internal
   */
  static resetInstance(): void {
    ObservabilityLogService.instance = null;
    _docClient = null;
  }

  /**
   * Batch create - used by DynamoDB backend
   */
  async batchCreate(items: ObservabilityLogCreateItem[]): Promise<void> {
    const repo = this.getRepository();
    await repo.put(items).go();
  }

  /**
   * Get by trace/correlation
   */
  async getByTrace(correlationId: string, pagination?: Pagination) {
    return this.query({
      filters: { correlationId: { eq: correlationId } },
      pagination: { order: 'asc', ...pagination },
      index: { name: 'byTrace' },
    });
  }

  /**
   * Get by entity
   */
  async getByEntity(entityName: string, entityId: string, pagination?: Pagination) {
    return this.query({
      filters: { entityName: { eq: entityName }, entityId: { eq: entityId } },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'byEntity' },
    });
  }

  /**
   * Get by type
   */
  async getByType(type: string, pagination?: Pagination) {
    return this.query({
      filters: { type: { eq: type } },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'byType' },
    });
  }

  /**
   * Get children
   */
  async getChildren(parentLogId: string, pagination?: Pagination) {
    return this.query({
      filters: { parentLogId: { eq: parentLogId } },
      pagination: { order: 'asc', ...pagination },
      index: { name: 'byParent' },
    });
  }

  /**
   * Get by source
   */
  async getBySource(source: string, pagination?: Pagination) {
    return this.query({
      filters: { source: { eq: source } },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'bySource' },
    });
  }

  /**
   * Get by tenant
   */
  async getByTenant(tenantId: string, pagination?: Pagination) {
    return this.query({
      filters: { tenantId: { eq: tenantId } },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'byTenant' },
    });
  }

  /**
   * Get by actor
   */
  async getByActor(actorId: string, pagination?: Pagination) {
    return this.query({
      filters: { actorId: { eq: actorId } },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'byActor' },
    });
  }

  /**
   * Get by level
   */
  async getByLevel(level: string, pagination?: Pagination) {
    return this.query({
      filters: { level: { eq: level } },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'byLevel' },
    });
  }

  /**
   * Get errors
   */
  async getErrors(pagination?: Pagination) {
    return this.getByLevel('error', pagination);
  }

  /**
   * Get audit history for entity
   */
  async getAuditHistory(entityName: string, entityId: string, pagination?: Pagination) {
    return this.query({
      filters: {
        entityName: { eq: entityName },
        entityId: { eq: entityId },
        type: { beginsWith: 'audit' },
      },
      pagination: { order: 'desc', ...pagination },
      index: { name: 'byEntity' },
    });
  }

  /**
   * Get workflow history
   */
  async getWorkflowHistory(workflowId: string, pagination?: Pagination) {
    return this.query({
      filters: { entityName: { eq: 'workflow' }, entityId: { eq: workflowId } },
      pagination: { order: 'asc', ...pagination },
      index: { name: 'byEntity' },
    });
  }

  /**
   * Get trace with reconstructed spans
   */
  async getTraceWithSpans(correlationId: string): Promise<ReconstructedSpan[]> {
    const result = await this.getByTrace(correlationId);
    return this.reconstructSpans((result.data ?? []) as LogRecord[]);
  }

  /**
   * Reconstruct span hierarchy from flat records
   */
  reconstructSpans(records: ReadonlyArray<LogRecord>): ReconstructedSpan[] {
    const spanMap = new Map<string, ReconstructedSpan>();

    // Group by entityId for span records
    const grouped = new Map<string, LogRecord[]>();
    for (const record of records) {
      if (record.entityName !== 'span' || !record.entityId) continue;
      const entityId = String(record.entityId);
      const existing = grouped.get(entityId);
      if (existing) {
        existing.push(record);
      } else {
        grouped.set(entityId, [ record ]);
      }
    }

    // Build span objects
    for (const [ spanId, spanRecords ] of grouped) {
      const startRecord = spanRecords.find(r => r.type === 'span.start');
      const endRecord = spanRecords.find(r => r.type === 'span.end');
      const eventRecords = spanRecords.filter(r => r.type === 'span.event');

      if (!startRecord) continue;

      const startData = this.toRecord(startRecord.data);
      const endData = this.toRecord(endRecord?.data);

      spanMap.set(spanId, {
        spanId,
        traceId: String(startRecord.correlationId ?? ''),
        parentSpanId: startRecord.parentLogId ? String(startRecord.parentLogId) : undefined,
        operation: String(startRecord.operation ?? 'unknown'),
        startTime: Number(startRecord.timestampMs ?? 0),
        endTime: endRecord?.timestampMs ? Number(endRecord.timestampMs) : undefined,
        duration: endRecord?.durationMs ? Number(endRecord.durationMs) : undefined,
        status: endRecord?.status ? String(endRecord.status) : undefined,
        success: typeof endRecord?.success === 'boolean' ? endRecord.success : undefined,
        attributes: { ...startData, ...endData },
        events: eventRecords.map(e => ({
          name: String(e.operation ?? 'event'),
          timestamp: Number(e.timestampMs ?? 0),
          attributes: this.toRecord(e.data),
        })),
        metrics: this.toNumberRecord(endRecord?.metrics),
        children: [],
      });
    }

    // Build tree
    const roots: ReconstructedSpan[] = [];
    for (const span of spanMap.values()) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        spanMap.get(span.parentSpanId)!.children.push(span);
      } else {
        roots.push(span);
      }
    }

    // Sort children
    const sortChildren = (span: ReconstructedSpan): void => {
      span.children.sort((a, b) => a.startTime - b.startTime);
      span.children.forEach(sortChildren);
    };
    roots.forEach(sortChildren);

    return roots;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toNumberRecord(value: unknown): Record<string, number> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const result: Record<string, number> = {};
      for (const [ k, v ] of Object.entries(value)) {
        if (typeof v === 'number') result[ k ] = v;
      }
      return result;
    }
    return {};
  }
}
