"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryObserver = void 0;
const runtime_state_1 = require("../runtime-state");
const base_1 = require("./base");
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
class QueryObserver {
    /**
     * Track an entity query operation performance.
     *
     * @param entityName - Name of the entity being queried
     * @param operation - The type of operation (get, query, scan, etc.)
     * @param fn - The async function to execute
     * @param context - Additional query context for logging
     */
    static async track(entityName, operation, fn, context) {
        const obsConfig = (0, runtime_state_1.getCurrentObservabilityConfig)();
        const config = obsConfig?.queryPerformance;
        // Fail fast if tracking disabled or entity excluded
        if (!config?.enabled || config.excludeEntities?.includes(entityName)) {
            return fn();
        }
        const start = Date.now();
        let itemCount = context?.itemCount;
        try {
            const result = await fn();
            const durationMs = Date.now() - start;
            // Auto-extract item count for list/query/batch ops
            if (itemCount === undefined) {
                itemCount = this.extractItemCount(result);
            }
            const threshold = this.getSlowThreshold(config, entityName, operation);
            const isSlow = durationMs > threshold;
            const isScan = operation === 'scan';
            // Capture consumed capacity (if tracking is enabled and listener was wired)
            const capacity = this.consumeLastCapacity();
            const capacityMetrics = {};
            if (capacity?.rcu != null)
                capacityMetrics['dynamo.consumed_rcu'] = capacity.rcu;
            if (capacity?.wcu != null)
                capacityMetrics['dynamo.consumed_wcu'] = capacity.wcu;
            // Emit event through proper capture system
            // The observability manager will apply noise reduction, sampling, etc.
            (0, base_1.captureRecord)('QueryObserver', {
                type: 'database.query',
                level: this.determineLevel(operation, isSlow, isScan),
                operation: `${entityName}.${operation}`,
                entityName,
                durationMs,
                success: true,
                metrics: {
                    durationMs,
                    threshold,
                    ...(itemCount !== undefined && { itemCount }),
                    ...capacityMetrics,
                },
                data: {
                    operation,
                    entityName,
                    ...(context?.filters && config.captureSlowQueryDetails && isSlow && {
                        filters: context.filters
                    }),
                    ...(context?.pagination && config.captureSlowQueryDetails && isSlow && {
                        pagination: context.pagination
                    })
                },
                tags: {
                    entityName,
                    operation,
                    query_type: this.classifyQueryType(operation),
                    ...(context?.indexName && { indexName: context.indexName }),
                    ...(isSlow && { slowQuery: 'true' }),
                    ...(isScan && { scan: 'true' })
                }
            });
            return result;
        }
        catch (error) {
            const durationMs = Date.now() - start;
            const normalizedError = (0, base_1.normalizeError)(error);
            // Emit error event through proper capture system
            (0, base_1.captureRecord)('QueryObserver', {
                type: 'database.query',
                level: 'error',
                operation: `${entityName}.${operation}`,
                entityName,
                durationMs,
                success: false,
                error: (0, base_1.mapError)(normalizedError),
                metrics: { durationMs },
                tags: {
                    entityName,
                    operation,
                    query_type: this.classifyQueryType(operation),
                    error: 'true',
                    ...(context?.indexName && { indexName: context.indexName })
                },
                data: {
                    operation,
                    entityName,
                    ...(context?.filters && config.captureSlowQueryDetails && {
                        filters: context.filters
                    })
                }
            });
            throw error;
        }
    }
    /**
     * Determine the log level for a query based on its characteristics.
     *
     * @param _operation - The query operation (reserved for future use)
     * @param isSlow - Whether the query exceeded the slow threshold
     * @param isScan - Whether this is a table scan
     * @returns The appropriate log level
     */
    static determineLevel(_operation, isSlow, isScan) {
        // Scans are always warnings (expensive operations)
        if (isScan)
            return 'warn';
        // Slow queries are warnings
        if (isSlow)
            return 'warn';
        // Fast queries are debug level
        // Noise reduction will decide what to do (fold/aggregate/keep/drop)
        return 'debug';
    }
    static getSlowThreshold(config, entityName, operation) {
        const entityOverride = config.entityOverrides?.find(e => e.entityName === entityName);
        if (entityOverride?.slowThreshold !== undefined)
            return entityOverride.slowThreshold;
        const opConfig = config.operationThresholds?.find(o => o.operation === operation);
        return opConfig ? opConfig.slowThreshold : config.slowThreshold;
    }
    /**
     * Classify a DynamoDB operation into a high-level query type for filtering.
     */
    static classifyQueryType(operation) {
        switch (operation) {
            case 'get': return 'point-read';
            case 'batchGet': return 'batch-read';
            case 'scan': return 'full-scan';
            case 'query':
            case 'list': return 'range-query';
            case 'create':
            case 'upsert':
            case 'update':
            case 'delete':
            case 'batchDelete': return 'write';
            default: return 'other';
        }
    }
    static extractItemCount(result) {
        if (result && typeof result === 'object' && 'data' in result) {
            const data = result.data;
            return Array.isArray(data) ? data.length : (data ? 1 : 0);
        }
        return undefined;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSUMED CAPACITY TRACKING
    // ═══════════════════════════════════════════════════════════════════════════
    /** Thread-local storage for consumed capacity captured by the ElectroDB listener. */
    static _lastConsumedCapacity;
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
    static getCapacityGoOptions() {
        const config = (0, runtime_state_1.getCurrentObservabilityConfig)()?.queryPerformance;
        if (!config?.trackCapacity)
            return {};
        // Reset before each call
        this._lastConsumedCapacity = undefined;
        return {
            params: { ReturnConsumedCapacity: 'TOTAL' },
            listeners: [
                (event) => {
                    if (event.type === 'results') {
                        const raw = event.results;
                        const consumed = raw?.ConsumedCapacity;
                        if (consumed) {
                            QueryObserver._lastConsumedCapacity = {
                                rcu: consumed.ReadCapacityUnits ?? consumed.CapacityUnits,
                                wcu: consumed.WriteCapacityUnits,
                            };
                        }
                    }
                },
            ],
        };
    }
    /**
     * Returns and clears the last captured consumed capacity.
     * Call this after `.go()` completes to get the capacity metrics.
     */
    static consumeLastCapacity() {
        const result = this._lastConsumedCapacity;
        this._lastConsumedCapacity = undefined;
        return result;
    }
}
exports.QueryObserver = QueryObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvcXVlcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsb0RBQWlFO0FBRWpFLGlDQUFpRTtBQXNCakU7Ozs7Ozs7Ozs7OztHQVlHO0FBQ0gsTUFBYSxhQUFhO0lBRXhCOzs7Ozs7O09BT0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FDaEIsVUFBa0IsRUFDbEIsU0FBeUIsRUFDekIsRUFBb0IsRUFDcEIsT0FBc0I7UUFFdEIsTUFBTSxTQUFTLEdBQUcsSUFBQSw2Q0FBNkIsR0FBRSxDQUFDO1FBQ2xELE1BQU0sTUFBTSxHQUFHLFNBQVMsRUFBRSxnQkFBZ0IsQ0FBQztRQUUzQyxvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLElBQUksTUFBTSxDQUFDLGVBQWUsRUFBRSxRQUFRLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUNyRSxPQUFPLEVBQUUsRUFBRSxDQUFDO1FBQ2QsQ0FBQztRQUVELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUN6QixJQUFJLFNBQVMsR0FBdUIsT0FBTyxFQUFFLFNBQVMsQ0FBQztRQUV2RCxJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzFCLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxLQUFLLENBQUM7WUFFdEMsbURBQW1EO1lBQ25ELElBQUksU0FBUyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUM1QixTQUFTLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQzVDLENBQUM7WUFFRCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUMs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Y0c7SUFDSCxNQUFNLENBQUMsb0JBQW9CO1FBQ3pCLE1BQU0sTUFBTSxHQUFHLElBQUEsNkNBQTZCLEdBQUUsRUFBRSxnQkFBZ0IsQ0FBQztRQUNqRSxJQUFJLENBQUMsTUFBTSxFQUFFLGFBQWE7WUFBRSxPQUFPLEVBQUUsQ0FBQztRQUV0Qyx5QkFBeUI7UUFDekIsSUFBSSxDQUFDLHFCQUFxQixHQUFHLFNBQVMsQ0FBQztRQUV2QyxPQUFPO1lBQ0wsTUFBTSxFQUFFLEVBQUUsc0JBQXNCLEVBQUUsT0FBTyxFQUFFO1lBQzNDLFNBQVMsRUFBRTtnQkFDVCxDQUFDLEtBQXlDLEVBQUUsRUFBRTtvQkFDNUMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO3dCQUM3QixNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsT0FBOEMsQ0FBQzt3QkFDakUsTUFBTSxRQUFRLEdBQUcsR0FBRyxFQUFFLGdCQUFtSCxDQUFDO3dCQUMxSSxJQUFJLFFBQVEsRUFBRSxDQUFDOzRCQUNiLGFBQWEsQ0FBQyxxQkFBcUIsR0FBRztnQ0FDcEMsR0FBRyxFQUFFLFFBQVEsQ0FBQyxpQkFBaUIsSUFBSSxRQUFRLENBQUMsYUFBYTtnQ0FDekQsR0FBRyxFQUFFLFFBQVEsQ0FBQyxrQkFBa0I7NkJBQ2pDLENBQUM7d0JBQ0osQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUM7YUFDRjtTQUNGLENBQUM7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQjtRQUN4QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUM7UUFDMUMsSUFBSSxDQUFDLHFCQUFxQixHQUFHLFNBQVMsQ0FBQztRQUN2QyxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0NBQ0Y7QUF6T0Qsc0NBeU9DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZ2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9ydW50aW1lLXN0YXRlJztcbmltcG9ydCB0eXBlIHsgUXVlcnlQZXJmb3JtYW5jZUNvbmZpZywgUXVlcnlPcGVyYXRpb24sIE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNhcHR1cmVSZWNvcmQsIG5vcm1hbGl6ZUVycm9yLCBtYXBFcnJvciB9IGZyb20gJy4vYmFzZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUXVlcnlDb250ZXh0IHtcbiAgLyoqIFF1ZXJ5IGZpbHRlcnMgKi9cbiAgZmlsdGVycz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogSW5kZXggbmFtZSB1c2VkICovXG4gIGluZGV4TmFtZT86IHN0cmluZztcbiAgLyoqIFBhZ2luYXRpb24gY29uZmlnICovXG4gIHBhZ2luYXRpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFByZS1jb21wdXRlZCBpdGVtIGNvdW50IChvcHRpb25hbCkgKi9cbiAgaXRlbUNvdW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbnN1bWVkIGNhcGFjaXR5IGRhdGEgY2FwdHVyZWQgZnJvbSBEeW5hbW9EQiByZXNwb25zZXMuXG4gKiBQb3B1bGF0ZWQgdmlhIEVsZWN0cm9EQiBgbGlzdGVuZXJzYCB3aGVuIGB0cmFja0NhcGFjaXR5YCBpcyBlbmFibGVkLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbnN1bWVkQ2FwYWNpdHlSZXN1bHQge1xuICByZWFkb25seSByY3U/OiBudW1iZXI7XG4gIHJlYWRvbmx5IHdjdT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBRdWVyeU9ic2VydmVyXG4gKiBcbiAqIFNwZWNpYWxpemVkIG9ic2VydmVyIGZvciBkYXRhYmFzZSBwZXJmb3JtYW5jZSB0cmFja2luZy5cbiAqIEVuY2Fwc3VsYXRlcyBhbGwgdGltaW5nLCBzYW1wbGluZywgYW5kIGNoZWNrcG9pbnQgbG9naWMgZm9yIGVudGl0eSBxdWVyaWVzLlxuICogXG4gKiBGZWF0dXJlczpcbiAqIC0gQ29uZmlndXJhYmxlIHRocmVzaG9sZHMgKHBlci1lbnRpdHksIHBlci1vcGVyYXRpb24pXG4gKiAtIFNtYXJ0IHNhbXBsaW5nIChmYXN0IHZzIHNsb3cgcXVlcmllcylcbiAqIC0gQXV0b21hdGljIGl0ZW0gY291bnQgZXh0cmFjdGlvbiBmcm9tIEVsZWN0cm9EQiByZXN1bHRzXG4gKiAtIENoZWNrcG9pbnQgdG8gYWN0aXZlIHNwYW5zIChhbHdheXMpXG4gKiAtIENvbmRpdGlvbmFsIGxvZ2dpbmcgKHNsb3cgcXVlcmllcywgc2NhbnMsIGVycm9ycylcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXJ5T2JzZXJ2ZXIge1xuXG4gIC8qKlxuICAgKiBUcmFjayBhbiBlbnRpdHkgcXVlcnkgb3BlcmF0aW9uIHBlcmZvcm1hbmNlLlxuICAgKiBcbiAgICogQHBhcmFtIGVudGl0eU5hbWUgLSBOYW1lIG9mIHRoZSBlbnRpdHkgYmVpbmcgcXVlcmllZFxuICAgKiBAcGFyYW0gb3BlcmF0aW9uIC0gVGhlIHR5cGUgb2Ygb3BlcmF0aW9uIChnZXQsIHF1ZXJ5LCBzY2FuLCBldGMuKVxuICAgKiBAcGFyYW0gZm4gLSBUaGUgYXN5bmMgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICAgKiBAcGFyYW0gY29udGV4dCAtIEFkZGl0aW9uYWwgcXVlcnkgY29udGV4dCBmb3IgbG9nZ2luZ1xuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRyYWNrPFQ+KFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcGVyYXRpb246IFF1ZXJ5T3BlcmF0aW9uLFxuICAgIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICAgIGNvbnRleHQ/OiBRdWVyeUNvbnRleHRcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgY29uc3Qgb2JzQ29uZmlnID0gZ2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcoKTtcbiAgICBjb25zdCBjb25maWcgPSBvYnNDb25maWc/LnF1ZXJ5UGVyZm9ybWFuY2U7XG5cbiAgICAvLyBGYWlsIGZhc3QgaWYgdHJhY2tpbmcgZGlzYWJsZWQgb3IgZW50aXR5IGV4Y2x1ZGVkXG4gICAgaWYgKCFjb25maWc/LmVuYWJsZWQgfHwgY29uZmlnLmV4Y2x1ZGVFbnRpdGllcz8uaW5jbHVkZXMoZW50aXR5TmFtZSkpIHtcbiAgICAgIHJldHVybiBmbigpO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICBsZXQgaXRlbUNvdW50OiBudW1iZXIgfCB1bmRlZmluZWQgPSBjb250ZXh0Py5pdGVtQ291bnQ7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZm4oKTtcbiAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnQ7XG5cbiAgICAgIC8vIEF1dG8tZXh0cmFjdCBpdGVtIGNvdW50IGZvciBsaXN0L3F1ZXJ5L2JhdGNoIG9wc1xuICAgICAgaWYgKGl0ZW1Db3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGl0ZW1Db3VudCA9IHRoaXMuZXh0cmFjdEl0ZW1Db3VudChyZXN1bHQpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB0aHJlc2hvbGQgPSB0aGlzLmdldFNsb3dUaHJlc2hvbGQoY29uZmlnLCBlbnRpdHlOYW1lLCBvcGVyYXRpb24pO1xuICAgICAgY29uc3QgaXNTbG93ID0gZHVyYXRpb25NcyA+IHRocmVzaG9sZDtcbiAgICAgIGNvbnN0IGlzU2NhbiA9IG9wZXJhdGlvbiA9PT0gJ3NjYW4nO1xuXG4gICAgICAvLyBDYXB0dXJlIGNvbnN1bWVkIGNhcGFjaXR5IChpZiB0cmFja2luZyBpcyBlbmFibGVkIGFuZCBsaXN0ZW5lciB3YXMgd2lyZWQpXG4gICAgICBjb25zdCBjYXBhY2l0eSA9IHRoaXMuY29uc3VtZUxhc3RDYXBhY2l0eSgpO1xuICAgICAgY29uc3QgY2FwYWNpdHlNZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICBpZiAoY2FwYWNpdHk/LnJjdSAhPSBudWxsKSBjYXBhY2l0eU1ldHJpY3NbJ2R5bmFtby5jb25zdW1lZF9yY3UnXSA9IGNhcGFjaXR5LnJjdTtcbiAgICAgIGlmIChjYXBhY2l0eT8ud2N1ICE9IG51bGwpIGNhcGFjaXR5TWV0cmljc1snZHluYW1vLmNvbnN1bWVkX3djdSddID0gY2FwYWNpdHkud2N1O1xuXG4gICAgICAvLyBFbWl0IGV2ZW50IHRocm91Z2ggcHJvcGVyIGNhcHR1cmUgc3lzdGVtXG4gICAgICAvLyBUaGUgb2JzZXJ2YWJpbGl0eSBtYW5hZ2VyIHdpbGwgYXBwbHkgbm9pc2UgcmVkdWN0aW9uLCBzYW1wbGluZywgZXRjLlxuICAgICAgY2FwdHVyZVJlY29yZCgnUXVlcnlPYnNlcnZlcicsIHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbGV2ZWw6IHRoaXMuZGV0ZXJtaW5lTGV2ZWwob3BlcmF0aW9uLCBpc1Nsb3csIGlzU2NhbiksXG4gICAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uJHtvcGVyYXRpb259YCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgIGR1cmF0aW9uTXMsXG4gICAgICAgICAgdGhyZXNob2xkLFxuICAgICAgICAgIC4uLihpdGVtQ291bnQgIT09IHVuZGVmaW5lZCAmJiB7IGl0ZW1Db3VudCB9KSxcbiAgICAgICAgICAuLi5jYXBhY2l0eU1ldHJpY3MsXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAuLi4oY29udGV4dD8uZmlsdGVycyAmJiBjb25maWcuY2FwdHVyZVNsb3dRdWVyeURldGFpbHMgJiYgaXNTbG93ICYmIHtcbiAgICAgICAgICAgIGZpbHRlcnM6IGNvbnRleHQuZmlsdGVyc1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIC4uLihjb250ZXh0Py5wYWdpbmF0aW9uICYmIGNvbmZpZy5jYXB0dXJlU2xvd1F1ZXJ5RGV0YWlscyAmJiBpc1Nsb3cgJiYge1xuICAgICAgICAgICAgcGFnaW5hdGlvbjogY29udGV4dC5wYWdpbmF0aW9uXG4gICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIHF1ZXJ5X3R5cGU6IHRoaXMuY2xhc3NpZnlRdWVyeVR5cGUob3BlcmF0aW9uKSxcbiAgICAgICAgICAuLi4oY29udGV4dD8uaW5kZXhOYW1lICYmIHsgaW5kZXhOYW1lOiBjb250ZXh0LmluZGV4TmFtZSB9KSxcbiAgICAgICAgICAuLi4oaXNTbG93ICYmIHsgc2xvd1F1ZXJ5OiAndHJ1ZScgfSksXG4gICAgICAgICAgLi4uKGlzU2NhbiAmJiB7IHNjYW46ICd0cnVlJyB9KVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IG5vcm1hbGl6ZUVycm9yKGVycm9yKTtcblxuICAgICAgLy8gRW1pdCBlcnJvciBldmVudCB0aHJvdWdoIHByb3BlciBjYXB0dXJlIHN5c3RlbVxuICAgICAgY2FwdHVyZVJlY29yZCgnUXVlcnlPYnNlcnZlcicsIHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIG9wZXJhdGlvbjogYCR7ZW50aXR5TmFtZX0uJHtvcGVyYXRpb259YCxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiBtYXBFcnJvcihub3JtYWxpemVkRXJyb3IpLFxuICAgICAgICBtZXRyaWNzOiB7IGR1cmF0aW9uTXMgfSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIHF1ZXJ5X3R5cGU6IHRoaXMuY2xhc3NpZnlRdWVyeVR5cGUob3BlcmF0aW9uKSxcbiAgICAgICAgICBlcnJvcjogJ3RydWUnLFxuICAgICAgICAgIC4uLihjb250ZXh0Py5pbmRleE5hbWUgJiYgeyBpbmRleE5hbWU6IGNvbnRleHQuaW5kZXhOYW1lIH0pXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAuLi4oY29udGV4dD8uZmlsdGVycyAmJiBjb25maWcuY2FwdHVyZVNsb3dRdWVyeURldGFpbHMgJiYge1xuICAgICAgICAgICAgZmlsdGVyczogY29udGV4dC5maWx0ZXJzXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmUgdGhlIGxvZyBsZXZlbCBmb3IgYSBxdWVyeSBiYXNlZCBvbiBpdHMgY2hhcmFjdGVyaXN0aWNzLlxuICAgKiBcbiAgICogQHBhcmFtIF9vcGVyYXRpb24gLSBUaGUgcXVlcnkgb3BlcmF0aW9uIChyZXNlcnZlZCBmb3IgZnV0dXJlIHVzZSlcbiAgICogQHBhcmFtIGlzU2xvdyAtIFdoZXRoZXIgdGhlIHF1ZXJ5IGV4Y2VlZGVkIHRoZSBzbG93IHRocmVzaG9sZFxuICAgKiBAcGFyYW0gaXNTY2FuIC0gV2hldGhlciB0aGlzIGlzIGEgdGFibGUgc2NhblxuICAgKiBAcmV0dXJucyBUaGUgYXBwcm9wcmlhdGUgbG9nIGxldmVsXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBkZXRlcm1pbmVMZXZlbChcbiAgICBfb3BlcmF0aW9uOiBRdWVyeU9wZXJhdGlvbixcbiAgICBpc1Nsb3c6IGJvb2xlYW4sXG4gICAgaXNTY2FuOiBib29sZWFuXG4gICk6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB7XG4gICAgLy8gU2NhbnMgYXJlIGFsd2F5cyB3YXJuaW5ncyAoZXhwZW5zaXZlIG9wZXJhdGlvbnMpXG4gICAgaWYgKGlzU2NhbikgcmV0dXJuICd3YXJuJztcblxuICAgIC8vIFNsb3cgcXVlcmllcyBhcmUgd2FybmluZ3NcbiAgICBpZiAoaXNTbG93KSByZXR1cm4gJ3dhcm4nO1xuXG4gICAgLy8gRmFzdCBxdWVyaWVzIGFyZSBkZWJ1ZyBsZXZlbFxuICAgIC8vIE5vaXNlIHJlZHVjdGlvbiB3aWxsIGRlY2lkZSB3aGF0IHRvIGRvIChmb2xkL2FnZ3JlZ2F0ZS9rZWVwL2Ryb3ApXG4gICAgcmV0dXJuICdkZWJ1Zyc7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBnZXRTbG93VGhyZXNob2xkKGNvbmZpZzogUXVlcnlQZXJmb3JtYW5jZUNvbmZpZywgZW50aXR5TmFtZTogc3RyaW5nLCBvcGVyYXRpb246IFF1ZXJ5T3BlcmF0aW9uKTogbnVtYmVyIHtcbiAgICBjb25zdCBlbnRpdHlPdmVycmlkZSA9IGNvbmZpZy5lbnRpdHlPdmVycmlkZXM/LmZpbmQoZSA9PiBlLmVudGl0eU5hbWUgPT09IGVudGl0eU5hbWUpO1xuICAgIGlmIChlbnRpdHlPdmVycmlkZT8uc2xvd1RocmVzaG9sZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gZW50aXR5T3ZlcnJpZGUuc2xvd1RocmVzaG9sZDtcblxuICAgIGNvbnN0IG9wQ29uZmlnID0gY29uZmlnLm9wZXJhdGlvblRocmVzaG9sZHM/LmZpbmQobyA9PiBvLm9wZXJhdGlvbiA9PT0gb3BlcmF0aW9uKTtcbiAgICByZXR1cm4gb3BDb25maWcgPyBvcENvbmZpZy5zbG93VGhyZXNob2xkIDogY29uZmlnLnNsb3dUaHJlc2hvbGQ7XG4gIH1cblxuXG4gIC8qKlxuICAgKiBDbGFzc2lmeSBhIER5bmFtb0RCIG9wZXJhdGlvbiBpbnRvIGEgaGlnaC1sZXZlbCBxdWVyeSB0eXBlIGZvciBmaWx0ZXJpbmcuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBjbGFzc2lmeVF1ZXJ5VHlwZShvcGVyYXRpb246IFF1ZXJ5T3BlcmF0aW9uKTogc3RyaW5nIHtcbiAgICBzd2l0Y2ggKG9wZXJhdGlvbikge1xuICAgICAgY2FzZSAnZ2V0JzogcmV0dXJuICdwb2ludC1yZWFkJztcbiAgICAgIGNhc2UgJ2JhdGNoR2V0JzogcmV0dXJuICdiYXRjaC1yZWFkJztcbiAgICAgIGNhc2UgJ3NjYW4nOiByZXR1cm4gJ2Z1bGwtc2Nhbic7XG4gICAgICBjYXNlICdxdWVyeSc6XG4gICAgICBjYXNlICdsaXN0JzogcmV0dXJuICdyYW5nZS1xdWVyeSc7XG4gICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgY2FzZSAndXBzZXJ0JzpcbiAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgY2FzZSAnYmF0Y2hEZWxldGUnOiByZXR1cm4gJ3dyaXRlJztcbiAgICAgIGRlZmF1bHQ6IHJldHVybiAnb3RoZXInO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGV4dHJhY3RJdGVtQ291bnQocmVzdWx0OiB1bmtub3duKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnICYmICdkYXRhJyBpbiByZXN1bHQpIHtcbiAgICAgIGNvbnN0IGRhdGEgPSAocmVzdWx0IGFzIHsgZGF0YTogdW5rbm93biB9KS5kYXRhO1xuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoZGF0YSkgPyBkYXRhLmxlbmd0aCA6IChkYXRhID8gMSA6IDApO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIENPTlNVTUVEIENBUEFDSVRZIFRSQUNLSU5HXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKiBUaHJlYWQtbG9jYWwgc3RvcmFnZSBmb3IgY29uc3VtZWQgY2FwYWNpdHkgY2FwdHVyZWQgYnkgdGhlIEVsZWN0cm9EQiBsaXN0ZW5lci4gKi9cbiAgcHJpdmF0ZSBzdGF0aWMgX2xhc3RDb25zdW1lZENhcGFjaXR5OiBDb25zdW1lZENhcGFjaXR5UmVzdWx0IHwgdW5kZWZpbmVkO1xuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGV4dHJhIGAuZ28oKWAgb3B0aW9ucyB0byBtZXJnZSBpbnRvIEVsZWN0cm9EQiBjYWxscyB3aGVuIGNvbnN1bWVkIGNhcGFjaXR5XG4gICAqIHRyYWNraW5nIGlzIGVuYWJsZWQuIFRoZSBjYWxsZXIgc2hvdWxkIHNwcmVhZCB0aGVzZSBpbnRvIHRoZWlyIGAuZ28oKWAgY2FsbC5cbiAgICpcbiAgICogVXNlcyBFbGVjdHJvREIncyBgcGFyYW1zYCBwYXNzdGhyb3VnaCB0byByZXF1ZXN0IGBSZXR1cm5Db25zdW1lZENhcGFjaXR5OiAnVE9UQUwnYFxuICAgKiBhbmQgYSBgbGlzdGVuZXJzYCBjYWxsYmFjayB0aGF0IGNhcHR1cmVzIHRoZSByYXcgYENvbnN1bWVkQ2FwYWNpdHlgIGZyb20gdGhlXG4gICAqIER5bmFtb0RCIHJlc3BvbnNlLlxuICAgKlxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIGNvbnN0IGVudGl0eSA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soZW50aXR5TmFtZSwgJ2dldCcsICgpID0+XG4gICAqICAgcmVwby5nZXQoaWQpLmdvKHsgYXR0cmlidXRlcywgLi4uUXVlcnlPYnNlcnZlci5nZXRDYXBhY2l0eUdvT3B0aW9ucygpIH0pXG4gICAqICk7XG4gICAqIGBgYFxuICAgKi9cbiAgc3RhdGljIGdldENhcGFjaXR5R29PcHRpb25zKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgICBjb25zdCBjb25maWcgPSBnZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZygpPy5xdWVyeVBlcmZvcm1hbmNlO1xuICAgIGlmICghY29uZmlnPy50cmFja0NhcGFjaXR5KSByZXR1cm4ge307XG5cbiAgICAvLyBSZXNldCBiZWZvcmUgZWFjaCBjYWxsXG4gICAgdGhpcy5fbGFzdENvbnN1bWVkQ2FwYWNpdHkgPSB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGFyYW1zOiB7IFJldHVybkNvbnN1bWVkQ2FwYWNpdHk6ICdUT1RBTCcgfSxcbiAgICAgIGxpc3RlbmVyczogW1xuICAgICAgICAoZXZlbnQ6IHsgdHlwZTogc3RyaW5nOyByZXN1bHRzOiB1bmtub3duIH0pID0+IHtcbiAgICAgICAgICBpZiAoZXZlbnQudHlwZSA9PT0gJ3Jlc3VsdHMnKSB7XG4gICAgICAgICAgICBjb25zdCByYXcgPSBldmVudC5yZXN1bHRzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29uc3QgY29uc3VtZWQgPSByYXc/LkNvbnN1bWVkQ2FwYWNpdHkgYXMgeyBDYXBhY2l0eVVuaXRzPzogbnVtYmVyOyBSZWFkQ2FwYWNpdHlVbml0cz86IG51bWJlcjsgV3JpdGVDYXBhY2l0eVVuaXRzPzogbnVtYmVyIH0gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAoY29uc3VtZWQpIHtcbiAgICAgICAgICAgICAgUXVlcnlPYnNlcnZlci5fbGFzdENvbnN1bWVkQ2FwYWNpdHkgPSB7XG4gICAgICAgICAgICAgICAgcmN1OiBjb25zdW1lZC5SZWFkQ2FwYWNpdHlVbml0cyA/PyBjb25zdW1lZC5DYXBhY2l0eVVuaXRzLFxuICAgICAgICAgICAgICAgIHdjdTogY29uc3VtZWQuV3JpdGVDYXBhY2l0eVVuaXRzLFxuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuZCBjbGVhcnMgdGhlIGxhc3QgY2FwdHVyZWQgY29uc3VtZWQgY2FwYWNpdHkuXG4gICAqIENhbGwgdGhpcyBhZnRlciBgLmdvKClgIGNvbXBsZXRlcyB0byBnZXQgdGhlIGNhcGFjaXR5IG1ldHJpY3MuXG4gICAqL1xuICBzdGF0aWMgY29uc3VtZUxhc3RDYXBhY2l0eSgpOiBDb25zdW1lZENhcGFjaXR5UmVzdWx0IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9sYXN0Q29uc3VtZWRDYXBhY2l0eTtcbiAgICB0aGlzLl9sYXN0Q29uc3VtZWRDYXBhY2l0eSA9IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG59XG4iXX0=