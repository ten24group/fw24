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
                    ...(itemCount !== undefined && { itemCount })
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
    static extractItemCount(result) {
        if (result && typeof result === 'object') {
            if ('data' in result) {
                return Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0);
            }
        }
        return undefined;
    }
}
exports.QueryObserver = QueryObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvcXVlcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsb0RBQWlFO0FBRWpFLGlDQUFpRTtBQWFqRTs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSCxNQUFhLGFBQWE7SUFFeEI7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUNoQixVQUFrQixFQUNsQixTQUF5QixFQUN6QixFQUFvQixFQUNwQixPQUFzQjtRQUV0QixNQUFNLFNBQVMsR0FBRyxJQUFBLDZDQUE2QixHQUFFLENBQUM7UUFDbEQsTUFBTSxNQUFNLEdBQUcsU0FBUyxFQUFFLGdCQUFnQixDQUFDO1FBRTNDLG9EQUFvRDtRQUNwRCxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sSUFBSSxNQUFNLENBQUMsZUFBZSxFQUFFLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ3JFLE9BQU8sRUFBRSxFQUFFLENBQUM7UUFDZCxDQUFDO1FBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ3pCLElBQUksU0FBUyxHQUF1QixPQUFPLEVBQUUsU0FBUyxDQUFDO1FBRXZELElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sRUFBRSxFQUFFLENBQUM7WUFDMUIsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLEtBQUssQ0FBQztZQUV0QyxtREFBbUQ7WUFDbkQsSUFBSSxTQUFTLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQzVCLFNBQVMsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDNUMsQ0FBQztZQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsQ0FBQyxD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QUFwSkQsc0NBb0pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZ2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9ydW50aW1lLXN0YXRlJztcbmltcG9ydCB0eXBlIHsgUXVlcnlQZXJmb3JtYW5jZUNvbmZpZywgUXVlcnlPcGVyYXRpb24sIE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNhcHR1cmVSZWNvcmQsIG5vcm1hbGl6ZUVycm9yLCBtYXBFcnJvciB9IGZyb20gJy4vYmFzZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUXVlcnlDb250ZXh0IHtcbiAgLyoqIFF1ZXJ5IGZpbHRlcnMgKi9cbiAgZmlsdGVycz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogSW5kZXggbmFtZSB1c2VkICovXG4gIGluZGV4TmFtZT86IHN0cmluZztcbiAgLyoqIFBhZ2luYXRpb24gY29uZmlnICovXG4gIHBhZ2luYXRpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFByZS1jb21wdXRlZCBpdGVtIGNvdW50IChvcHRpb25hbCkgKi9cbiAgaXRlbUNvdW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIFF1ZXJ5T2JzZXJ2ZXJcbiAqIFxuICogU3BlY2lhbGl6ZWQgb2JzZXJ2ZXIgZm9yIGRhdGFiYXNlIHBlcmZvcm1hbmNlIHRyYWNraW5nLlxuICogRW5jYXBzdWxhdGVzIGFsbCB0aW1pbmcsIHNhbXBsaW5nLCBhbmQgY2hlY2twb2ludCBsb2dpYyBmb3IgZW50aXR5IHF1ZXJpZXMuXG4gKiBcbiAqIEZlYXR1cmVzOlxuICogLSBDb25maWd1cmFibGUgdGhyZXNob2xkcyAocGVyLWVudGl0eSwgcGVyLW9wZXJhdGlvbilcbiAqIC0gU21hcnQgc2FtcGxpbmcgKGZhc3QgdnMgc2xvdyBxdWVyaWVzKVxuICogLSBBdXRvbWF0aWMgaXRlbSBjb3VudCBleHRyYWN0aW9uIGZyb20gRWxlY3Ryb0RCIHJlc3VsdHNcbiAqIC0gQ2hlY2twb2ludCB0byBhY3RpdmUgc3BhbnMgKGFsd2F5cylcbiAqIC0gQ29uZGl0aW9uYWwgbG9nZ2luZyAoc2xvdyBxdWVyaWVzLCBzY2FucywgZXJyb3JzKVxuICovXG5leHBvcnQgY2xhc3MgUXVlcnlPYnNlcnZlciB7XG5cbiAgLyoqXG4gICAqIFRyYWNrIGFuIGVudGl0eSBxdWVyeSBvcGVyYXRpb24gcGVyZm9ybWFuY2UuXG4gICAqIFxuICAgKiBAcGFyYW0gZW50aXR5TmFtZSAtIE5hbWUgb2YgdGhlIGVudGl0eSBiZWluZyBxdWVyaWVkXG4gICAqIEBwYXJhbSBvcGVyYXRpb24gLSBUaGUgdHlwZSBvZiBvcGVyYXRpb24gKGdldCwgcXVlcnksIHNjYW4sIGV0Yy4pXG4gICAqIEBwYXJhbSBmbiAtIFRoZSBhc3luYyBmdW5jdGlvbiB0byBleGVjdXRlXG4gICAqIEBwYXJhbSBjb250ZXh0IC0gQWRkaXRpb25hbCBxdWVyeSBjb250ZXh0IGZvciBsb2dnaW5nXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdHJhY2s8VD4oXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG9wZXJhdGlvbjogUXVlcnlPcGVyYXRpb24sXG4gICAgZm46ICgpID0+IFByb21pc2U8VD4sXG4gICAgY29udGV4dD86IFF1ZXJ5Q29udGV4dFxuICApOiBQcm9taXNlPFQ+IHtcbiAgICBjb25zdCBvYnNDb25maWcgPSBnZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZygpO1xuICAgIGNvbnN0IGNvbmZpZyA9IG9ic0NvbmZpZz8ucXVlcnlQZXJmb3JtYW5jZTtcblxuICAgIC8vIEZhaWwgZmFzdCBpZiB0cmFja2luZyBkaXNhYmxlZCBvciBlbnRpdHkgZXhjbHVkZWRcbiAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCB8fCBjb25maWcuZXhjbHVkZUVudGl0aWVzPy5pbmNsdWRlcyhlbnRpdHlOYW1lKSkge1xuICAgICAgcmV0dXJuIGZuKCk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIGxldCBpdGVtQ291bnQ6IG51bWJlciB8IHVuZGVmaW5lZCA9IGNvbnRleHQ/Lml0ZW1Db3VudDtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBmbigpO1xuICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydDtcblxuICAgICAgLy8gQXV0by1leHRyYWN0IGl0ZW0gY291bnQgZm9yIGxpc3QvcXVlcnkvYmF0Y2ggb3BzXG4gICAgICBpZiAoaXRlbUNvdW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaXRlbUNvdW50ID0gdGhpcy5leHRyYWN0SXRlbUNvdW50KHJlc3VsdCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRocmVzaG9sZCA9IHRoaXMuZ2V0U2xvd1RocmVzaG9sZChjb25maWcsIGVudGl0eU5hbWUsIG9wZXJhdGlvbik7XG4gICAgICBjb25zdCBpc1Nsb3cgPSBkdXJhdGlvbk1zID4gdGhyZXNob2xkO1xuICAgICAgY29uc3QgaXNTY2FuID0gb3BlcmF0aW9uID09PSAnc2Nhbic7XG5cbiAgICAgIC8vIEVtaXQgZXZlbnQgdGhyb3VnaCBwcm9wZXIgY2FwdHVyZSBzeXN0ZW1cbiAgICAgIC8vIFRoZSBvYnNlcnZhYmlsaXR5IG1hbmFnZXIgd2lsbCBhcHBseSBub2lzZSByZWR1Y3Rpb24sIHNhbXBsaW5nLCBldGMuXG4gICAgICBjYXB0dXJlUmVjb3JkKCdRdWVyeU9ic2VydmVyJywge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBsZXZlbDogdGhpcy5kZXRlcm1pbmVMZXZlbChvcGVyYXRpb24sIGlzU2xvdywgaXNTY2FuKSxcbiAgICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS4ke29wZXJhdGlvbn1gLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgZHVyYXRpb25NcyxcbiAgICAgICAgICB0aHJlc2hvbGQsXG4gICAgICAgICAgLi4uKGl0ZW1Db3VudCAhPT0gdW5kZWZpbmVkICYmIHsgaXRlbUNvdW50IH0pXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAuLi4oY29udGV4dD8uZmlsdGVycyAmJiBjb25maWcuY2FwdHVyZVNsb3dRdWVyeURldGFpbHMgJiYgaXNTbG93ICYmIHtcbiAgICAgICAgICAgIGZpbHRlcnM6IGNvbnRleHQuZmlsdGVyc1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIC4uLihjb250ZXh0Py5wYWdpbmF0aW9uICYmIGNvbmZpZy5jYXB0dXJlU2xvd1F1ZXJ5RGV0YWlscyAmJiBpc1Nsb3cgJiYge1xuICAgICAgICAgICAgcGFnaW5hdGlvbjogY29udGV4dC5wYWdpbmF0aW9uXG4gICAgICAgICAgfSlcbiAgICAgICAgfSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIC4uLihjb250ZXh0Py5pbmRleE5hbWUgJiYgeyBpbmRleE5hbWU6IGNvbnRleHQuaW5kZXhOYW1lIH0pLFxuICAgICAgICAgIC4uLihpc1Nsb3cgJiYgeyBzbG93UXVlcnk6ICd0cnVlJyB9KSxcbiAgICAgICAgICAuLi4oaXNTY2FuICYmIHsgc2NhbjogJ3RydWUnIH0pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbm9ybWFsaXplRXJyb3IoZXJyb3IpO1xuXG4gICAgICAvLyBFbWl0IGVycm9yIGV2ZW50IHRocm91Z2ggcHJvcGVyIGNhcHR1cmUgc3lzdGVtXG4gICAgICBjYXB0dXJlUmVjb3JkKCdRdWVyeU9ic2VydmVyJywge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgb3BlcmF0aW9uOiBgJHtlbnRpdHlOYW1lfS4ke29wZXJhdGlvbn1gLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBkdXJhdGlvbk1zLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6IG1hcEVycm9yKG5vcm1hbGl6ZWRFcnJvciksXG4gICAgICAgIG1ldHJpY3M6IHsgZHVyYXRpb25NcyB9LFxuICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgZXJyb3I6ICd0cnVlJyxcbiAgICAgICAgICAuLi4oY29udGV4dD8uaW5kZXhOYW1lICYmIHsgaW5kZXhOYW1lOiBjb250ZXh0LmluZGV4TmFtZSB9KVxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgLi4uKGNvbnRleHQ/LmZpbHRlcnMgJiYgY29uZmlnLmNhcHR1cmVTbG93UXVlcnlEZXRhaWxzICYmIHtcbiAgICAgICAgICAgIGZpbHRlcnM6IGNvbnRleHQuZmlsdGVyc1xuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lIHRoZSBsb2cgbGV2ZWwgZm9yIGEgcXVlcnkgYmFzZWQgb24gaXRzIGNoYXJhY3RlcmlzdGljcy5cbiAgICogXG4gICAqIEBwYXJhbSBfb3BlcmF0aW9uIC0gVGhlIHF1ZXJ5IG9wZXJhdGlvbiAocmVzZXJ2ZWQgZm9yIGZ1dHVyZSB1c2UpXG4gICAqIEBwYXJhbSBpc1Nsb3cgLSBXaGV0aGVyIHRoZSBxdWVyeSBleGNlZWRlZCB0aGUgc2xvdyB0aHJlc2hvbGRcbiAgICogQHBhcmFtIGlzU2NhbiAtIFdoZXRoZXIgdGhpcyBpcyBhIHRhYmxlIHNjYW5cbiAgICogQHJldHVybnMgVGhlIGFwcHJvcHJpYXRlIGxvZyBsZXZlbFxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgZGV0ZXJtaW5lTGV2ZWwoXG4gICAgX29wZXJhdGlvbjogUXVlcnlPcGVyYXRpb24sXG4gICAgaXNTbG93OiBib29sZWFuLFxuICAgIGlzU2NhbjogYm9vbGVhblxuICApOiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcge1xuICAgIC8vIFNjYW5zIGFyZSBhbHdheXMgd2FybmluZ3MgKGV4cGVuc2l2ZSBvcGVyYXRpb25zKVxuICAgIGlmIChpc1NjYW4pIHJldHVybiAnd2Fybic7XG5cbiAgICAvLyBTbG93IHF1ZXJpZXMgYXJlIHdhcm5pbmdzXG4gICAgaWYgKGlzU2xvdykgcmV0dXJuICd3YXJuJztcblxuICAgIC8vIEZhc3QgcXVlcmllcyBhcmUgZGVidWcgbGV2ZWxcbiAgICAvLyBOb2lzZSByZWR1Y3Rpb24gd2lsbCBkZWNpZGUgd2hhdCB0byBkbyAoZm9sZC9hZ2dyZWdhdGUva2VlcC9kcm9wKVxuICAgIHJldHVybiAnZGVidWcnO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0U2xvd1RocmVzaG9sZChjb25maWc6IFF1ZXJ5UGVyZm9ybWFuY2VDb25maWcsIGVudGl0eU5hbWU6IHN0cmluZywgb3BlcmF0aW9uOiBRdWVyeU9wZXJhdGlvbik6IG51bWJlciB7XG4gICAgY29uc3QgZW50aXR5T3ZlcnJpZGUgPSBjb25maWcuZW50aXR5T3ZlcnJpZGVzPy5maW5kKGUgPT4gZS5lbnRpdHlOYW1lID09PSBlbnRpdHlOYW1lKTtcbiAgICBpZiAoZW50aXR5T3ZlcnJpZGU/LnNsb3dUaHJlc2hvbGQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGVudGl0eU92ZXJyaWRlLnNsb3dUaHJlc2hvbGQ7XG5cbiAgICBjb25zdCBvcENvbmZpZyA9IGNvbmZpZy5vcGVyYXRpb25UaHJlc2hvbGRzPy5maW5kKG8gPT4gby5vcGVyYXRpb24gPT09IG9wZXJhdGlvbik7XG4gICAgcmV0dXJuIG9wQ29uZmlnID8gb3BDb25maWcuc2xvd1RocmVzaG9sZCA6IGNvbmZpZy5zbG93VGhyZXNob2xkO1xuICB9XG5cblxuICBwcml2YXRlIHN0YXRpYyBleHRyYWN0SXRlbUNvdW50KHJlc3VsdDogYW55KTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAoJ2RhdGEnIGluIHJlc3VsdCkge1xuICAgICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyZXN1bHQuZGF0YSkgPyByZXN1bHQuZGF0YS5sZW5ndGggOiAocmVzdWx0LmRhdGEgPyAxIDogMCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cbiJdfQ==