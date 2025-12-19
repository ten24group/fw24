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
import { BaseObserverOptions, ObservabilityPayload } from './base';
export interface MetricOptions extends BaseObserverOptions, ObservabilityPayload {
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
     * Record custom metric
     */
    static record(name: string, value: number, options?: MetricOptions): string | undefined;
    /**
     * Record multiple metrics at once
     * Invalid values (NaN, Infinity) are filtered out with warnings.
     */
    static recordBatch(metrics: Record<string, number>, options?: MetricOptions): string | undefined;
    /**
     * Time a function execution and record the duration
     */
    static time<T>(name: string, fn: () => Promise<T>, options?: MetricOptions): Promise<T>;
    /**
     * Time a sync function execution and record the duration
     */
    static timeSync<T>(name: string, fn: () => T, options?: MetricOptions): T;
}
