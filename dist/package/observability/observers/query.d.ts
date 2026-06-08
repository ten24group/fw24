import type { QueryOperation } from '../types';
export interface QueryContext {
    /** Query filters */
    filters?: Record<string, unknown>;
    /** Index name used */
    indexName?: string;
    /** Pagination config */
    pagination?: Record<string, unknown>;
    /** Pre-computed item count (optional) */
    itemCount?: number;
}
/**
 * Consumed capacity data captured from DynamoDB responses.
 * Populated via ElectroDB `listeners` when `trackCapacity` is enabled.
 */
export interface ConsumedCapacityResult {
    readonly rcu?: number;
    readonly wcu?: number;
}
/**
 * QueryObserver
 *
 * Specialized observer for database performance tracking.
 * Encapsulates all timing, sampling, and checkpoint logic for entity queries.
 *
 * Features:
 * - Configurable thresholds (per-entity, per-operation)
 * - Smart sampling (fast vs slow queries)
 * - Automatic item count extraction from ElectroDB results
 * - Checkpoint to active spans (always)
 * - Conditional logging (slow queries, scans, errors)
 */
export declare class QueryObserver {
    /**
     * Track an entity query operation performance.
     *
     * @param entityName - Name of the entity being queried
     * @param operation - The type of operation (get, query, scan, etc.)
     * @param fn - The async function to execute
     * @param context - Additional query context for logging
     */
    static track<T>(entityName: string, operation: QueryOperation, fn: () => Promise<T>, context?: QueryContext): Promise<T>;
    /**
     * Determine the log level for a query based on its characteristics.
     *
     * @param _operation - The query operation (reserved for future use)
     * @param isSlow - Whether the query exceeded the slow threshold
     * @param isScan - Whether this is a table scan
     * @returns The appropriate log level
     */
    private static determineLevel;
    private static getSlowThreshold;
    /**
     * Classify a DynamoDB operation into a high-level query type for filtering.
     */
    private static classifyQueryType;
    private static extractItemCount;
    /** Thread-local storage for consumed capacity captured by the ElectroDB listener. */
    private static _lastConsumedCapacity;
    /**
     * Returns extra `.go()` options to merge into ElectroDB calls when consumed capacity
     * tracking is enabled. The caller should spread these into their `.go()` call.
     *
     * Uses ElectroDB's `params` passthrough to request `ReturnConsumedCapacity: 'TOTAL'`
     * and a `listeners` callback that captures the raw `ConsumedCapacity` from the
     * DynamoDB response.
     *
     * @example
     * ```typescript
     * const entity = await QueryObserver.track(entityName, 'get', () =>
     *   repo.get(id).go({ attributes, ...QueryObserver.getCapacityGoOptions() })
     * );
     * ```
     */
    static getCapacityGoOptions(): Record<string, unknown>;
    /**
     * Returns and clears the last captured consumed capacity.
     * Call this after `.go()` completes to get the capacity metrics.
     */
    static consumeLastCapacity(): ConsumedCapacityResult | undefined;
}
