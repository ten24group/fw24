/**
 * MetricObserver - Business and technical metrics
 * 
 * Supports counters, gauges, timings, histograms.
 * EMF-compatible for CloudWatch.
 * 
 * CONSOLIDATION: When an active span exists, metrics are added to the span
 * instead of creating separate records. This reduces DynamoDB entries while
 * still publishing metrics to CloudWatch (which extracts from any event).
 * 
 * Usage:
 * ```typescript
 * // Context is auto-established in controllers
 * 
 * // Simple counter
 * MetricObserver.increment('orders.created');
 * 
 * // Gauge value
 * MetricObserver.gauge('queue.depth', 42);
 * 
 * // Timing
 * MetricObserver.timing('api.latency', 145);
 * 
 * // Custom with tags
 * MetricObserver.record('payment.amount', 99.99, {
 *   tags: { currency: 'USD', method: 'card' },
 *   unit: 'dollars',
 * });
 * ```
 */

import type { ObservabilityLevelString, RecordOverrides } from '../types';
import { captureRecord } from './base';
import { createLogger } from '../../logging';
import { SpanObserver } from './span';

const OBSERVER_NAME = 'MetricObserver';
const logger = createLogger(OBSERVER_NAME);

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for metric operations.
 * Extends RecordOverrides for all context override capabilities.
 */
export interface MetricOptions extends RecordOverrides {
  /** Metric type */
  type?: 'counter' | 'gauge' | 'timing' | 'histogram' | 'custom';
  /** Unit (e.g., 'milliseconds', 'bytes', 'count') */
  unit?: string;
  /** Severity level (metrics typically trace-info, rarely warn/error) */
  level?: ObservabilityLevelString;
  /** Entity name for context */
  entityName?: string;
  /** Entity ID for context */
  entityId?: string;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
  /** Force standalone record even when span is active */
  standalone?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a metric value
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

// ═══════════════════════════════════════════════════════════════════════════
// MetricObserver
// ═══════════════════════════════════════════════════════════════════════════

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
   * Record custom metric.
   * 
   * When an active span exists, the metric is consolidated into the span
   * (added as a span event) instead of creating a separate record.
   * Use `standalone: true` to force a separate record.
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

    const {
      type,
      unit,
      level,
      entityName,
      entityId,
      attributes,
      standalone,
      tags,
      ...overrides
    } = options ?? {};

    // Consolidate into current span if one exists (unless standalone is requested)
    const currentSpan = standalone ? undefined : SpanObserver.getCurrentSpan();
    if (currentSpan) {
      // Use clean API - metric goes to metrics, context to tags
      currentSpan.metric(name, value);
      if (unit) currentSpan.tag(`${name}.unit`, unit);
      if (type) currentSpan.tag(`${name}.type`, type);
      if (entityName) currentSpan.tag('entityName', entityName);
      if (entityId) currentSpan.tag('entityId', entityId);
      currentSpan.checkpoint(`metric.${name}`);
      return currentSpan.id;
    }

    // No active span - create standalone metric record
    return captureRecord(OBSERVER_NAME, {
      type: 'metric',
      subType: type ?? 'custom',
      level: level ?? 'info',
      operation: name,
      metrics: { [ name ]: value },
      attributes: {
        unit,
        metricType: type,
        ...attributes,
      },
      entityName,
      entityId,
      tags,
      ...overrides,
    });
  }

  /**
   * Record multiple metrics at once.
   * Invalid values (NaN, Infinity) are filtered out with warnings.
   * 
   * When an active span exists, metrics are consolidated into the span.
   * Use `standalone: true` to force a separate record.
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

    const {
      type,
      unit,
      level,
      entityName,
      entityId,
      attributes,
      standalone,
      tags,
      ...overrides
    } = options ?? {};

    // Consolidate into current span if one exists
    const currentSpan = standalone ? undefined : SpanObserver.getCurrentSpan();
    if (currentSpan) {
      // Use clean API
      currentSpan.metrics(validMetrics);
      currentSpan.metric('metricCount', Object.keys(validMetrics).length);
      if (entityName) currentSpan.tag('entityName', entityName);
      if (entityId) currentSpan.tag('entityId', entityId);
      currentSpan.checkpoint('metrics.batch');
      return currentSpan.id;
    }

    // No active span - create standalone metric record
    return captureRecord(OBSERVER_NAME, {
      type: 'metric',
      subType: 'batch',
      level: level ?? 'info',
      operation: 'metrics.batch',
      metrics: validMetrics,
      attributes: {
        ...attributes,
        metricCount: Object.keys(validMetrics).length,
      },
      entityName,
      entityId,
      tags,
      ...overrides,
    });
  }

  /**
   * Time a function execution and record the duration.
   * Handles both sync and async functions automatically.
   */
  static time<T>(name: string, fn: () => T, options?: MetricOptions): T {
    const start = Date.now();
    const recordTiming = (success: boolean) => {
      this.timing(name, Date.now() - start, {
        ...options,
        level: success ? options?.level : 'warn',
        tags: { ...options?.tags, success: String(success) },
      });
    };

    try {
      const result = fn();

      if (result instanceof Promise) {
        return result
          .then((value) => { recordTiming(true); return value; })
          .catch((error) => { recordTiming(false); throw error; }) as T;
      }

      recordTiming(true);
      return result;
    } catch (error) {
      recordTiming(false);
      throw error;
    }
  }
}
