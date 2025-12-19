/**
 * ObservabilityLogService - Service for observability data storage
 * 
 * Registered via DI with @Service decorator.
 * Config injected via @InjectConfig.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Service } from '../../decorators';
import { DIContainer, InjectConfig, InjectContainer, InjectEntitySchema } from '../../di';
import { BaseEntityService } from '../../entity/base-service';
import { EntityQuery } from '../../entity/query-types';
import { EntitySearchQuery } from '../../search/types';
import { ExecutionContext } from '../../core/types/execution-context';
import { ObservabilityLogEntitySchema, ObservabilityLogSchema } from './observability-log-entity';
import { CreateEntityItemTypeFromSchema, EntityRecordTypeFromSchema } from '../../entity/base-entity';
import { resolveEnvValueFor } from '../../utils/env';
import { IDIContainer } from '../../interfaces';

export type ObservabilityLogCreateItem = CreateEntityItemTypeFromSchema<ObservabilityLogSchema>;
export type LogRecord = EntityRecordTypeFromSchema<ObservabilityLogSchema>;

/** Reconstructed span with hierarchy for trace visualization */
export interface ReconstructedSpan {
  spanId: string;
  traceId: string;
  parentObservabilityLogId?: string;
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

// manual registration of the schema to avoid circular dependency
DIContainer.ROOT.register({
  type: 'schema',
  provide: 'observabilityLogSchema',
  forEntity: 'observabilityLog',
  useValue: ObservabilityLogEntitySchema,
});

/**
 * ObservabilityLogService
 * 
 * DI-managed service for observability log storage.
 * tableName and ttlDays injected via @InjectConfig.
 * 
 */
@Service({ forEntity: 'observabilityLog' })
export class ObservabilityLogService extends BaseEntityService<ObservabilityLogSchema> {

  constructor(
    @InjectConfig('observability.dynamodb.tableKey')
    readonly tableKey: string,

    @InjectConfig('observability.dynamodb.ttlDays')
    readonly ttlDays: number,

    @InjectEntitySchema('observabilityLog')
    readonly schema: ObservabilityLogSchema,

    @InjectContainer()
    readonly container: IDIContainer
  ) {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true, convertEmptyValues: true },
    });

    // Resolve actual table name from env using framework convention
    // Env var: {tableKey}_table (special chars replaced with _)
    const tableName = resolveEnvValueFor({ key: tableKey, suffix: 'table', defaultValue: tableKey });

    super(schema, {
      table: tableName,
      client: docClient,
    }, container);
  }

  /** Batch create - used by DynamoDB backend */
  async batchCreate(items: ObservabilityLogCreateItem[]): Promise<void> {
    const repo = this.getRepository();
    await repo.put(items).go();
  }

  /** Override list to default to desc order (latest first) */
  public async list(query: EntityQuery<ObservabilityLogSchema> = {}, ctx?: ExecutionContext) {
    return super.list({
      ...query,
      pagination: { ...query.pagination, order: query.pagination?.order ?? 'desc' },
    }, ctx);
  }

  /** Override search to default sort by timestamp desc */
  public async search(query: EntitySearchQuery<ObservabilityLogSchema>, ctx?: ExecutionContext) {
    return super.search({
      ...query,
      sort: query.sort?.length ? query.sort : [ { field: 'timestampMs' as const, dir: 'desc' as const } ],
    }, ctx);
  }

  /** Get trace with reconstructed span tree */
  async getTraceWithSpans(correlationId: string, ctx?: ExecutionContext): Promise<ReconstructedSpan[]> {
    const result = await this.query({
      filters: { correlationId: { eq: correlationId } },
      pagination: { order: 'asc' },
      index: { name: 'byTrace' },
    }, ctx);
    return this.reconstructSpans((result.data ?? []) as LogRecord[]);
  }

  /** Reconstruct span hierarchy from flat log records */
  reconstructSpans(records: ReadonlyArray<LogRecord>): ReconstructedSpan[] {
    const spanMap = new Map<string, ReconstructedSpan>();
    const grouped = new Map<string, LogRecord[]>();

    for (const record of records) {
      // Filter by type (span.start, span.end, span.event) and group by entityId (spanId)
      if (!record.type?.startsWith('span.')) continue;
      const id = String(record.entityId);
      (grouped.get(id) ?? grouped.set(id, []).get(id)!).push(record);
    }

    for (const [ spanId, spanRecords ] of grouped) {
      const start = spanRecords.find(r => r.type === 'span.start');
      const end = spanRecords.find(r => r.type === 'span.end');
      if (!start) continue;

      spanMap.set(spanId, {
        spanId,
        traceId: String(start.correlationId ?? ''),
        parentObservabilityLogId: start.parentObservabilityLogId ? String(start.parentObservabilityLogId) : undefined,
        operation: String(start.operation ?? 'unknown'),
        startTime: Number(start.timestampMs ?? 0),
        endTime: end?.timestampMs ? Number(end.timestampMs) : undefined,
        duration: end?.durationMs ? Number(end.durationMs) : undefined,
        status: end?.status ? String(end.status) : undefined,
        success: typeof end?.success === 'boolean' ? end.success : undefined,
        attributes: { ...toRecord(start.data), ...toRecord(end?.data) },
        events: spanRecords.filter(r => r.type === 'span.event').map(e => ({
          name: String(e.operation ?? 'event'),
          timestamp: Number(e.timestampMs ?? 0),
          attributes: toRecord(e.data),
        })),
        metrics: toNumberRecord(end?.metrics),
        children: [],
      });
    }

    const roots: ReconstructedSpan[] = [];
    for (const span of spanMap.values()) {
      const parent = span.parentObservabilityLogId && spanMap.get(span.parentObservabilityLogId);
      parent ? parent.children.push(span) : roots.push(span);
    }

    const sortChildren = (s: ReconstructedSpan): void => {
      s.children.sort((a, b) => a.startTime - b.startTime).forEach(sortChildren);
    };
    roots.forEach(sortChildren);

    return roots;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [ k, v ] of Object.entries(value)) if (typeof v === 'number') result[ k ] = v;
  return result;
}
