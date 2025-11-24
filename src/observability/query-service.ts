import { ObservabilityLogEntity } from './storage/log-entity';

const entity = ObservabilityLogEntity();

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
  attributes: Record<string, any>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes: Record<string, any>;
  }>;
  metrics: Record<string, number>;
  children: ReconstructedSpan[];
}

export class ObservabilityQueryService {
  /**
   * Get all records for a trace
   */
  static async getTrace(correlationId: string) {
    const result = await entity.query.byTrace({ correlationId }).go({ order: 'asc' });
    return result.data;
  }

  /**
   * Get all records for a specific span (entityName='span', entityId=spanId)
   */
  static async getSpan(spanId: string) {
    const result = await entity.query.byEntity({ entityName: 'span', entityId: spanId }).go({ order: 'asc' });
    return result.data;
  }

  /**
   * Get all child logs of a parent log
   */
  static async getChildLogs(parentLogId: string) {
    const result = await entity.query.byParent({ parentLogId }).go({ order: 'asc' });
    return result.data;
  }

  /**
   * Get all logs for a specific entity
   */
  static async getEntityLogs(entityName: string, entityId: string) {
    const result = await entity.query.byEntity({ entityName, entityId }).go({ order: 'desc' });
    return result.data;
  }

  /**
   * Reconstruct spans from flat records into hierarchical structure
   */
  static reconstructSpans(records: any[]): ReconstructedSpan[] {
    const spanMap = new Map<string, ReconstructedSpan>();

    // Group records by entityId (for span records)
    const grouped = new Map<string, any[]>();
    records.forEach((record) => {
      if (record.entityName !== 'span' || !record.entityId) return;

      if (!grouped.has(record.entityId)) {
        grouped.set(record.entityId, []);
      }
      grouped.get(record.entityId)!.push(record);
    });

    // Build span objects from grouped records
    grouped.forEach((spanRecords, spanId) => {
      const startRecord = spanRecords.find((r) => r.type === 'span.start');
      const endRecord = spanRecords.find((r) => r.type === 'span.end');
      const eventRecords = spanRecords.filter((r) => r.type === 'span.event');

      if (!startRecord) return;

      const span: ReconstructedSpan = {
        spanId,
        traceId: startRecord.correlationId,
        parentSpanId: startRecord.parentLogId,
        operation: startRecord.operation || 'unknown',
        startTime: startRecord.timestampMs,
        endTime: endRecord?.timestampMs,
        duration: endRecord?.durationMs,
        status: endRecord?.status,
        success: endRecord?.success,
        attributes: {
          ...(startRecord.data || {}),
          ...(endRecord?.data || {}),
        },
        events: eventRecords.map((e) => ({
          name: e.operation || 'event',
          timestamp: e.timestampMs,
          attributes: e.data || {},
        })),
        metrics: endRecord?.metrics || {},
        children: [],
      };

      spanMap.set(spanId, span);
    });

    // Build tree using parentSpanId from span.start records
    const roots: ReconstructedSpan[] = [];
    spanMap.forEach((span) => {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        spanMap.get(span.parentSpanId)!.children.push(span);
      } else {
        roots.push(span);
      }
    });

    return roots;
  }

  /**
   * Get complete trace with reconstructed span hierarchy
   */
  static async getTraceWithSpans(traceId: string): Promise<ReconstructedSpan[]> {
    const records = await this.getTrace(traceId);
    return this.reconstructSpans(records);
  }
}

