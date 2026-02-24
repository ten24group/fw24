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

      // Capture consumed capacity (if tracking is enabled and listener was wired)
      const capacity = this.consumeLastCapacity();
      const capacityMetrics: Record<string, number> = {};
      if (capacity?.rcu != null) capacityMetrics['dynamo.consumed_rcu'] = capacity.rcu;
      if (capacity?.wcu != null) capacityMetrics['dynamo.consumed_wcu'] = capacity.wcu;

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


  /**
   * Classify a DynamoDB operation into a high-level query type for filtering.
   */
  private static classifyQueryType(operation: QueryOperation): string {
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

  private static extractItemCount(result: unknown): number | undefined {
    if (result && typeof result === 'object' && 'data' in result) {
      const data = (result as { data: unknown }).data;
      return Array.isArray(data) ? data.length : (data ? 1 : 0);
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSUMED CAPACITY TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Thread-local storage for consumed capacity captured by the ElectroDB listener. */
  private static _lastConsumedCapacity: ConsumedCapacityResult | undefined;

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
  static getCapacityGoOptions(): Record<string, unknown> {
    const config = getCurrentObservabilityConfig()?.queryPerformance;
    if (!config?.trackCapacity) return {};

    // Reset before each call
    this._lastConsumedCapacity = undefined;

    return {
      params: { ReturnConsumedCapacity: 'TOTAL' },
      listeners: [
        (event: { type: string; results: unknown }) => {
          if (event.type === 'results') {
            const raw = event.results as Record<string, unknown> | undefined;
            const consumed = raw?.ConsumedCapacity as { CapacityUnits?: number; ReadCapacityUnits?: number; WriteCapacityUnits?: number } | undefined;
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
  static consumeLastCapacity(): ConsumedCapacityResult | undefined {
    const result = this._lastConsumedCapacity;
    this._lastConsumedCapacity = undefined;
    return result;
  }
}
