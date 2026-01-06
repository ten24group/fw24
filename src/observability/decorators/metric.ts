/**
 * @Metric Decorator - Lightweight metric tracking
 * 
 * Records metrics (counters, timings, gauges) without creating spans.
 * Perfect for:
 * - Tracking method execution counts
 * - Recording timing/duration metrics
 * - Counting errors/successes
 * - Business metrics (items processed, orders completed, etc.)
 * 
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Metric({ name: 'orders.processed', type: 'counter' })
 *   async processOrder(order: Order) {
 *     // Increments orders.processed counter on each call
 *   }
 *   
 *   @Metric({ 
 *     name: 'orders.processing_time',
 *     type: 'timing',
 *     extract: {
 *       finish: (ctx) => ({
 *         tags: { orderType: ctx.args[0].type }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Records processing duration with orderType tag
 *   }
 *   
 *   @Metric({
 *     extract: {
 *       finish: (ctx) => ({
 *         name: `orders.items.${ctx.result.status}`,
 *         value: ctx.result.items.length,
 *         tags: { status: ctx.result.status }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Dynamic metric name and value based on result
 *   }
 * }
 * ```
 */

import { MetricObserver } from '../observers/metric';
import { resolveSource } from './decorator-utils';
import type { ObservabilityLevelString } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface MetricEnrichment {
  /** Metric name (overrides default) */
  name?: string;
  /** Metric value (overrides default) */
  value?: number;
  /** Metric tags */
  tags?: Record<string, string>;
  /** Metric unit (overrides default) */
  unit?: string;
  /** Metric level (overrides default) */
  level?: ObservabilityLevelString;
}

export interface MetricExtractContext<TInstance, TArgs extends unknown[], TResult> {
  instance: TInstance;
  args: TArgs;
  operationName: string;
  source: string;
  /** Only available in finish() */
  result?: TResult;
  /** Only available in finish() */
  error?: Error;
  /** Only available in finish() */
  success?: boolean;
  /** Only available in finish() */
  durationMs?: number;
}

type BivariantFn<T extends (...args: any[]) => any> = {
  bivarianceHack: T;
}[ 'bivarianceHack' ];

export interface MetricExtractor<TInstance, TArgs extends unknown[], TResult> {
  /**
   * Extract metric data before method execution.
   */
  start?: BivariantFn<(ctx: MetricExtractContext<TInstance, TArgs, TResult>) => MetricEnrichment | void>;

  /**
   * Extract metric data after method execution.
   */
  finish?: BivariantFn<(ctx: MetricExtractContext<TInstance, TArgs, TResult>) => MetricEnrichment | void>;
}

export interface MetricOptions<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown> {
  /**
   * Metric name.
   * Default: className.methodName
   * Can use patterns: 'orders.processed', 'api.latency', etc.
   */
  name?: string;

  /**
   * Metric type.
   * - 'counter': Increments on each call (default)
   * - 'timing': Records method duration in ms
   * - 'gauge': Records a specific value (use extract.finish to provide value)
   */
  type?: 'counter' | 'timing' | 'gauge';

  /**
   * Metric unit (for timing/gauge).
   * Examples: 'ms', 'bytes', 'items', 'percentage'
   */
  unit?: string;

  /**
   * Static tags.
   * For dynamic tags, use extract.
   */
  tags?: Record<string, string>;

  /**
   * Metric level.
   * Default: 'info'
   */
  level?: ObservabilityLevelString;

  /**
   * Extraction API for dynamic metric data.
   */
  extract?: MetricExtractor<TInstance, TArgs, TResult>;

  /**
   * Whether to record metric on method start.
   * Default: false (only on finish)
   */
  recordStart?: boolean;

  /**
   * Whether to record metric on method finish.
   * Default: true
   */
  recordFinish?: boolean;

  /**
   * Whether to record success/error metrics separately.
   * Creates .success and .error suffixed metrics.
   * Default: false
   */
  trackSuccessError?: boolean;

  /**
   * Increment value for counter metrics.
   * Default: 1
   */
  incrementBy?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Decorator
// ═══════════════════════════════════════════════════════════════════════════

export function Metric<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown>(
  options: MetricOptions<TInstance, TArgs, TResult> = {}
) {
  return function <T extends (...args: any[]) => any>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    const methodName = String(propertyKey);
    const className = target.constructor.name;
    const source = resolveSource(target as any, methodName, className);
    const operationName = `${className}.${methodName}`;

    const metricType = options.type ?? 'counter';
    const defaultMetricName = options.name ?? operationName.replace(/\./g, '_').toLowerCase();
    const defaultLevel = options.level ?? 'info';
    const recordStart = options.recordStart ?? false;
    const recordFinish = options.recordFinish ?? true;
    const trackSuccessError = options.trackSuccessError ?? false;
    const incrementBy = options.incrementBy ?? 1;

    descriptor.value = function (this: any, ...args: any[]) {
      const startTime = Date.now();

      // Record start metric if configured
      if (recordStart && metricType === 'counter') {
        const startEnrichment = options.extract?.start?.({
          instance: this,
          args: args as any,
          operationName,
          source,
        });

        const metricName = startEnrichment?.name ?? `${defaultMetricName}.start`;

        MetricObserver.increment(metricName, incrementBy, {
          tags: { ...options.tags, ...startEnrichment?.tags },
          level: startEnrichment?.level ?? defaultLevel,
          unit: startEnrichment?.unit ?? options.unit,
        });
      }

      // Execute method and record finish metric
      const executeAndRecord = (result: any, error?: Error) => {
        const durationMs = Date.now() - startTime;
        const success = !error;

        if (recordFinish) {
          const finishEnrichment = options.extract?.finish?.({
            instance: this,
            args: args as any,
            operationName,
            source,
            result,
            error,
            success,
            durationMs,
          });

          let metricName = finishEnrichment?.name ?? defaultMetricName;

          // Add success/error suffix if tracking
          if (trackSuccessError) {
            metricName = `${metricName}.${success ? 'success' : 'error'}`;
          }

          const metricTags = {
            ...options.tags,
            ...finishEnrichment?.tags,
            ...(trackSuccessError ? {} : { success: String(success) }),
          };

          const metricLevel = error ? 'error' : (finishEnrichment?.level ?? defaultLevel);
          const metricUnit = finishEnrichment?.unit ?? options.unit;

          switch (metricType) {
            case 'counter':
              MetricObserver.increment(metricName, finishEnrichment?.value ?? incrementBy, {
                tags: metricTags,
                level: metricLevel,
                unit: metricUnit,
              });
              break;

            case 'timing':
              MetricObserver.timing(metricName, durationMs, {
                tags: metricTags,
                level: metricLevel,
                unit: metricUnit ?? 'ms',
              });
              break;

            case 'gauge':
              const gaugeValue = finishEnrichment?.value ?? durationMs;
              MetricObserver.gauge(metricName, gaugeValue, {
                tags: metricTags,
                level: metricLevel,
                unit: metricUnit,
              });
              break;
          }
        }

        if (error) throw error;
        return result;
      };

      // Handle async/sync
      try {
        const result = originalMethod.apply(this, args);

        if (result && typeof result.then === 'function') {
          return result
            .then((value: any) => executeAndRecord(value))
            .catch((error: Error) => executeAndRecord(undefined, error));
        } else {
          return executeAndRecord(result);
        }
      } catch (error) {
        return executeAndRecord(undefined, error as Error);
      }
    } as any;

    return descriptor;
  };
}
