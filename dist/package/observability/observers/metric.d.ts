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
export declare class MetricObserver {
    /**
     * Increment counter
     */
    static increment(name: string, value?: number, options?: MetricOptions): string | undefined;
    /**
     * Decrement counter
     */
    static decrement(name: string, value?: number, options?: MetricOptions): string | undefined;
    /**
     * Set gauge value
     */
    static gauge(name: string, value: number, options?: MetricOptions): string | undefined;
    /**
     * Record timing (milliseconds)
     */
    static timing(name: string, durationMs: number, options?: MetricOptions): string | undefined;
    /**
     * Record histogram value
     */
    static histogram(name: string, value: number, options?: MetricOptions): string | undefined;
    /**
     * Record custom metric.
     *
     * When an active span exists, the metric is consolidated into the span
     * (added as a span event) instead of creating a separate record.
     * Use `standalone: true` to force a separate record.
     */
    static record(name: string, value: number, options?: MetricOptions): string | undefined;
    /**
     * Record multiple metrics at once.
     * Invalid values (NaN, Infinity) are filtered out with warnings.
     *
     * When an active span exists, metrics are consolidated into the span.
     * Use `standalone: true` to force a separate record.
     */
    static recordBatch(metrics: Record<string, number>, options?: MetricOptions): string | undefined;
    /**
     * Time a function execution and record the duration.
     * Handles both sync and async functions automatically.
     */
    static time<T>(name: string, fn: () => T, options?: MetricOptions): T;
}
