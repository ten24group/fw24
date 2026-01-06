import { getCurrentObservabilityConfig } from '../runtime-state';
import type { QueryPerformanceConfig, QueryOperation, ObservabilityLevelString } from '../types';
import { captureRecord, normalizeError, mapError } from './base';

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
export class QueryObserver {

  /**
   * Track an entity query operation performance.
   * 
   * @param entityName - Name of the entity being queried
   * @param operation - The type of operation (get, query, scan, etc.)
   * @param fn - The async function to execute
   * @param context - Additional query context for logging
   */
  static async track<T>(
    entityName: string,
    operation: QueryOperation,
    fn: () => Promise<T>,
    context?: QueryContext
  ): Promise<T> {
    const obsConfig = getCurrentObservabilityConfig();
    const config = obsConfig?.queryPerformance;

    // Fail fast if tracking disabled or entity excluded
    if (!config?.enabled || config.excludeEntities?.includes(entityName)) {
      return fn();
    }

    const start = Date.now();
    let itemCount: number | undefined = context?.itemCount;

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
      captureRecord('QueryObserver', {
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
    } catch (error) {
      const durationMs = Date.now() - start;
      const normalizedError = normalizeError(error);

      // Emit error event through proper capture system
      captureRecord('QueryObserver', {
        type: 'database.query',
        level: 'error',
        operation: `${entityName}.${operation}`,
        entityName,
        durationMs,
        success: false,
        error: mapError(normalizedError),
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
  private static determineLevel(
    _operation: QueryOperation,
    isSlow: boolean,
    isScan: boolean
  ): ObservabilityLevelString {
    // Scans are always warnings (expensive operations)
    if (isScan) return 'warn';

    // Slow queries are warnings
    if (isSlow) return 'warn';

    // Fast queries are debug level
    // Noise reduction will decide what to do (fold/aggregate/keep/drop)
    return 'debug';
  }

  private static getSlowThreshold(config: QueryPerformanceConfig, entityName: string, operation: QueryOperation): number {
    const entityOverride = config.entityOverrides?.find(e => e.entityName === entityName);
    if (entityOverride?.slowThreshold !== undefined) return entityOverride.slowThreshold;

    const opConfig = config.operationThresholds?.find(o => o.operation === operation);
    return opConfig ? opConfig.slowThreshold : config.slowThreshold;
  }


  private static extractItemCount(result: any): number | undefined {
    if (result && typeof result === 'object') {
      if ('data' in result) {
        return Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0);
      }
    }
    return undefined;
  }
}
