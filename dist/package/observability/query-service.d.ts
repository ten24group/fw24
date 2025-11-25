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
export declare class ObservabilityQueryService {
    /**
     * Get all records for a trace
     */
    static getTrace(correlationId: string): Promise<{
        readonly metadata?: ({} & {}) | undefined;
        readonly correlationId: string;
        readonly attributes?: ({} & {}) | undefined;
        readonly type: string;
        readonly status?: string | undefined;
        readonly entityName?: string | undefined;
        readonly actor?: ({} & {}) | undefined;
        readonly tags?: ({} & {}) | undefined;
        readonly source?: string | undefined;
        readonly data?: ({} & {}) | undefined;
        readonly error?: ({} & {
            readonly type?: string | undefined;
            readonly message?: string | undefined;
            readonly stack?: string | undefined;
        }) | undefined;
        readonly success?: boolean | undefined;
        readonly subType?: string | undefined;
        readonly entityId?: string | undefined;
        readonly operation?: string | undefined;
        readonly ttl?: number | undefined;
        readonly metrics?: ({} & {}) | undefined;
        readonly context?: ({} & {}) | undefined;
        readonly timestampMs: number;
        readonly logId: string;
        readonly parentLogId?: string | undefined;
        readonly level: string;
        readonly durationMs?: number | undefined;
    }[]>;
    /**
     * Get all records for a specific span (entityName='span', entityId=spanId)
     */
    static getSpan(spanId: string): Promise<{
        readonly metadata?: ({} & {}) | undefined;
        readonly correlationId: string;
        readonly attributes?: ({} & {}) | undefined;
        readonly type: string;
        readonly status?: string | undefined;
        readonly entityName?: string | undefined;
        readonly actor?: ({} & {}) | undefined;
        readonly tags?: ({} & {}) | undefined;
        readonly source?: string | undefined;
        readonly data?: ({} & {}) | undefined;
        readonly error?: ({} & {
            readonly type?: string | undefined;
            readonly message?: string | undefined;
            readonly stack?: string | undefined;
        }) | undefined;
        readonly success?: boolean | undefined;
        readonly subType?: string | undefined;
        readonly entityId?: string | undefined;
        readonly operation?: string | undefined;
        readonly ttl?: number | undefined;
        readonly metrics?: ({} & {}) | undefined;
        readonly context?: ({} & {}) | undefined;
        readonly timestampMs: number;
        readonly logId: string;
        readonly parentLogId?: string | undefined;
        readonly level: string;
        readonly durationMs?: number | undefined;
    }[]>;
    /**
     * Get all child logs of a parent log
     */
    static getChildLogs(parentLogId: string): Promise<{
        readonly metadata?: ({} & {}) | undefined;
        readonly correlationId: string;
        readonly attributes?: ({} & {}) | undefined;
        readonly type: string;
        readonly status?: string | undefined;
        readonly entityName?: string | undefined;
        readonly actor?: ({} & {}) | undefined;
        readonly tags?: ({} & {}) | undefined;
        readonly source?: string | undefined;
        readonly data?: ({} & {}) | undefined;
        readonly error?: ({} & {
            readonly type?: string | undefined;
            readonly message?: string | undefined;
            readonly stack?: string | undefined;
        }) | undefined;
        readonly success?: boolean | undefined;
        readonly subType?: string | undefined;
        readonly entityId?: string | undefined;
        readonly operation?: string | undefined;
        readonly ttl?: number | undefined;
        readonly metrics?: ({} & {}) | undefined;
        readonly context?: ({} & {}) | undefined;
        readonly timestampMs: number;
        readonly logId: string;
        readonly parentLogId?: string | undefined;
        readonly level: string;
        readonly durationMs?: number | undefined;
    }[]>;
    /**
     * Get all logs for a specific entity
     */
    static getEntityLogs(entityName: string, entityId: string): Promise<{
        readonly metadata?: ({} & {}) | undefined;
        readonly correlationId: string;
        readonly attributes?: ({} & {}) | undefined;
        readonly type: string;
        readonly status?: string | undefined;
        readonly entityName?: string | undefined;
        readonly actor?: ({} & {}) | undefined;
        readonly tags?: ({} & {}) | undefined;
        readonly source?: string | undefined;
        readonly data?: ({} & {}) | undefined;
        readonly error?: ({} & {
            readonly type?: string | undefined;
            readonly message?: string | undefined;
            readonly stack?: string | undefined;
        }) | undefined;
        readonly success?: boolean | undefined;
        readonly subType?: string | undefined;
        readonly entityId?: string | undefined;
        readonly operation?: string | undefined;
        readonly ttl?: number | undefined;
        readonly metrics?: ({} & {}) | undefined;
        readonly context?: ({} & {}) | undefined;
        readonly timestampMs: number;
        readonly logId: string;
        readonly parentLogId?: string | undefined;
        readonly level: string;
        readonly durationMs?: number | undefined;
    }[]>;
    /**
     * Reconstruct spans from flat records into hierarchical structure
     */
    static reconstructSpans(records: any[]): ReconstructedSpan[];
    /**
     * Get complete trace with reconstructed span hierarchy
     */
    static getTraceWithSpans(traceId: string): Promise<ReconstructedSpan[]>;
}
