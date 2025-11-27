/**
 * MetricObserver - For business and technical metrics
 * 
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context
 * - Supports counters, gauges, timings, histograms
 * - EMF-compatible for CloudWatch
 * 
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Simple counter
 *     MetricObserver.increment('orders.created');
 *     
 *     // Gauge value
 *     MetricObserver.gauge('queue.depth', 42);
 *     
 *     // Timing
 *     MetricObserver.timing('api.latency', 145);
 *     
 *     // Custom with tags
 *     MetricObserver.record('payment.amount', 99.99, {
 *       tags: { currency: 'USD', method: 'card' },
 *       unit: 'dollars',
 *     });
 *   }
 * );
 * ```
 */

import { ObservabilityLevelString } from '../types';
import { buildCommonFields, captureEvent, BaseObserverOptions } from './base';
import { createLogger } from '../../logging';

const OBSERVER_NAME = 'MetricObserver';
const logger = createLogger(OBSERVER_NAME);

/**
 * Validate a metric value
 * Returns true if valid, logs warning and returns false if invalid
 */
function isValidMetricValue(name: string, value: number): boolean {
  if (typeof value !== 'number') {
    logger.warn(`Invalid metric value for '${name}': not a number`);
    return false;
  }
  if (Number.isNaN(value)) {
    logger.warn(`Invalid metric value for '${name}': NaN`);
    return false;
  }
  if (!Number.isFinite(value)) {
    logger.warn(`Invalid metric value for '${name}': Infinity`);
    return false;
  }
  return true;
}

export interface MetricOptions extends BaseObserverOptions {
  /** Metric type */
  type?: 'counter' | 'gauge' | 'timing' | 'histogram' | 'custom';
  /** Unit (e.g., 'milliseconds', 'bytes', 'count') */
  unit?: string;
  /** Severity level (metrics typically trace-info, rarely warn/error) */
  level?: ObservabilityLevelString;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
  /** Entity name for context */
  entityName?: string;
  /** Entity ID for context */
  entityId?: string;
}

export class MetricObserver {

  /**
   * Increment counter
   */
  static increment(
    name: string,
    value: number = 1,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, value, { ...options, type: 'counter' });
  }

  /**
   * Decrement counter
   */
  static decrement(
    name: string,
    value: number = 1,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, -value, { ...options, type: 'counter' });
  }

  /**
   * Set gauge value
   */
  static gauge(
    name: string,
    value: number,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, value, { ...options, type: 'gauge' });
  }

  /**
   * Record timing (milliseconds)
   */
  static timing(
    name: string,
    durationMs: number,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, durationMs, {
      ...options,
      type: 'timing',
      unit: options?.unit ?? 'milliseconds',
    });
  }

  /**
   * Record histogram value
   */
  static histogram(
    name: string,
    value: number,
    options?: MetricOptions
  ): string | undefined {
    return this.record(name, value, { ...options, type: 'histogram' });
  }

  /**
   * Record custom metric
   */
  static record(
    name: string,
    value: number,
    options?: MetricOptions
  ): string | undefined {
    // Validate metric value
    if (!isValidMetricValue(name, value)) {
      return undefined;
    }

    const fields = buildCommonFields(OBSERVER_NAME, options);
    if (!fields) return undefined;

    return captureEvent(fields, {
      type: 'metric',
      subType: options?.type ?? 'custom',
      level: options?.level ?? 'info',
      operation: name,
      metrics: { [ name ]: value },
      attributes: {
        unit: options?.unit,
        metricType: options?.type,
        ...options?.attributes,
      },
      entityName: options?.entityName,
      entityId: options?.entityId,
    });
  }

  /**
   * Record multiple metrics at once
   * Invalid values (NaN, Infinity) are filtered out with warnings.
   */
  static recordBatch(
    metrics: Record<string, number>,
    options?: MetricOptions
  ): string | undefined {
    // Filter out invalid values
    const validMetrics: Record<string, number> = {};
    for (const [ name, value ] of Object.entries(metrics)) {
      if (isValidMetricValue(name, value)) {
        validMetrics[ name ] = value;
      }
    }

    // Don't capture if no valid metrics
    if (Object.keys(validMetrics).length === 0) {
      logger.warn('recordBatch: no valid metrics to record');
      return undefined;
    }

    const fields = buildCommonFields(OBSERVER_NAME, options);
    if (!fields) return undefined;

    return captureEvent(fields, {
      type: 'metric',
      subType: 'batch',
      level: options?.level ?? 'info',
      operation: 'metrics.batch',
      metrics: validMetrics,
      attributes: {
        ...options?.attributes,
        metricCount: Object.keys(validMetrics).length,
      },
    });
  }

  /**
   * Time a function execution and record the duration
   */
  static async time<T>(
    name: string,
    fn: () => Promise<T>,
    options?: MetricOptions
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.timing(name, duration, { ...options, tags: { ...options?.tags, success: 'true' } });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.timing(name, duration, { ...options, level: 'warn', tags: { ...options?.tags, success: 'false' } });
      throw error;
    }
  }

  /**
   * Time a sync function execution and record the duration
   */
  static timeSync<T>(
    name: string,
    fn: () => T,
    options?: MetricOptions
  ): T {
    const start = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - start;
      this.timing(name, duration, { ...options, tags: { ...options?.tags, success: 'true' } });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.timing(name, duration, { ...options, level: 'warn', tags: { ...options?.tags, success: 'false' } });
      throw error;
    }
  }
}
