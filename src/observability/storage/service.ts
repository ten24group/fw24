/**
 * ObservabilityLogService - Service for observability data storage
 * 
 * Registered via DI with @Service decorator.
 * Config injected via @InjectConfig.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { FW24_UA_APP_ID } from '../../client/user-agent';
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
    const client = new DynamoDBClient({ userAgentAppId: FW24_UA_APP_ID });
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

  /** 
   * Batch create - used by DynamoDB backend
   * Auto-compresses fields marked with `compressed: true` in entity schema
   */
  async batchCreate(items: ObservabilityLogCreateItem[]): Promise<void> {
    const compressedItems = items.map(item => this.compressFields(item));
    const repo = this.getRepository();
    await repo.put(compressedItems).go();
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

  /** 
   * Reconstruct span hierarchy from flat log records.
   * FW24 supports consolidated span records only (type='span').
   * No compatibility is provided for legacy span.* record formats.
   */
  reconstructSpans(records: ReadonlyArray<LogRecord>): ReconstructedSpan[] {
    const spanMap = new Map<string, ReconstructedSpan>();

    for (const record of records) {
      // Handle consolidated spans (type='span')
      if (record.type === 'span') {
        const spanId = String(record.observabilityLogId ?? record.entityId);
        const data = toRecord(record.data);
        const checkpointsRaw = data.checkpoints;
        const checkpoints = Array.isArray(checkpointsRaw)
          ? checkpointsRaw.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c))
          : [];

        spanMap.set(spanId, {
          spanId,
          traceId: String(record.correlationId ?? ''),
          parentObservabilityLogId: record.parentObservabilityLogId ? String(record.parentObservabilityLogId) : undefined,
          operation: String(record.operation ?? 'unknown'),
          // Consolidated spans store timestampMs as START time (for timeline ordering).
          // Reconstruct endTime using durationMs when available.
          startTime: Number(record.timestampMs ?? 0),
          endTime: (record.durationMs && record.timestampMs)
            ? Number(record.timestampMs) + Number(record.durationMs)
            : Number(record.timestampMs ?? 0),
          duration: record.durationMs ? Number(record.durationMs) : undefined,
          status: record.status ? String(record.status) : undefined,
          success: typeof record.success === 'boolean' ? record.success : undefined,
          attributes: { ...toRecord(record.attributes), ...data },
          // Derive timeline events from checkpoints (canonical format).
          events: checkpoints.map((cp) => {
            const name = typeof cp.name === 'string' ? cp.name : 'checkpoint';
            const ts = typeof cp.ts === 'number' ? cp.ts : 0;
            const attrs: Record<string, unknown> = {};
            if (cp.tags && typeof cp.tags === 'object') attrs.tags = cp.tags;
            if (cp.metrics && typeof cp.metrics === 'object') attrs.metrics = cp.metrics;
            if (cp.data && typeof cp.data === 'object') attrs.data = cp.data;
            if (cp.error && typeof cp.error === 'object') attrs.error = cp.error;
            return { name, timestamp: ts, attributes: attrs };
          }),
          metrics: toNumberRecord(record.metrics),
          children: [],
        });
        continue;
      }
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
