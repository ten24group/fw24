/**
 * @Observed Decorator - Unified observability decorator
 *
 * Smart decorator that combines tracing, audit, and metrics without duplication.
 *
 * DEFAULT: If no options specified, defaults to { trace: true }
 *
 * DESIGN:
 * - trace: Creates span with duration/success/error (for debugging/performance)
 * - audit: Creates business/compliance log (only for entity operations)
 * - metric: Creates aggregatable counters/gauges (NOT timing if trace enabled!)
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   // Default - trace only
 *   @Observed()
 *   async fetchOrders(): Promise<Order[]> { }
 *
 *   // Explicit trace
 *   @Observed({ trace: true })
 *   async getOrder(id: string): Promise<Order> { }
 *
 *   // Business operation - trace + audit
 *   @Observed({
 *     trace: true,
 *     audit: { entityName: 'order' },
 *     metric: { type: 'counter', name: 'orders.created' }
 *   })
 *   async createOrder(order: Order): Promise<Order> { }
 *
 *   // Counter only (no trace)
 *   @Observed({
 *     metric: { type: 'counter', name: 'cache.hit' }
 *   })
 *   getCached(key: string): any { }
 * }
 * ```
 *
 * ANTI-PATTERNS:
 * ❌ DON'T: trace + timing metric (span already has duration!)
 * ❌ DON'T: audit every method (only business events!)
 * ✅ DO: trace for debugging, audit for compliance, counter for stats
 */
import { SpanOptions } from '../observers/span';
import { SourceType } from './decorator-utils';
export interface ObservedOptions {
    /** Method name (defaults to ClassName.methodName) */
    name?: string;
    /**
     * Create span for distributed tracing
     * Spans capture duration, success, error automatically.
     * Use for: debugging, performance analysis, distributed tracing
     *
     * DEFAULT: true if no options are specified (trace, audit, metric all undefined)
     */
    trace?: boolean | {
        level?: SpanOptions['level'];
        attributes?: Record<string, unknown>;
    };
    /**
     * Create audit record for business/compliance tracking
     * Use for: entity operations, security events, compliance requirements
     * Note: Only use for actual business events, not every traced method
     *
     * DEFAULT: false
     */
    audit?: boolean | {
        action?: string;
        entityName?: string;
        level?: 'info' | 'warn' | 'error';
        captureArgs?: boolean;
        captureResult?: boolean;
    };
    /**
     * Record metric for aggregation/dashboards
     * - counter: Count method invocations (useful!)
     * - gauge: Set a specific value (useful!)
     * - timing: Duration in ms (DON'T USE if trace:true - span already captures duration!)
     *
     * DEFAULT: undefined (no metrics)
     */
    metric?: {
        name?: string;
        type?: 'counter' | 'gauge' | 'timing';
        unit?: string;
        tags?: Record<string, string>;
    };
    /**
     * Source type (auto-detected if not provided)
     * Auto-detection rules:
     * - *Controller → 'controller' → "api:ControllerName.method"
     * - *Service → 'service' → "service:ServiceName.method"
     * - *Queue, *QueueHandler → 'queue' → "queue:QueueName.method"
     * - *Task, *TaskHandler → 'task' → "task:TaskName.method"
     * - Default → 'handler' → "ClassName.method"
     */
    sourceType?: SourceType;
    /** Tags applied to all observability events */
    tags?: Record<string, string>;
    /** Capture method arguments */
    captureArgs?: boolean;
    /** Capture return value */
    captureResult?: boolean;
    /**
     * Conditionally enable/disable observability.
     * - Static boolean: `enabled: false` to disable
     * - Dynamic function: `enabled: () => someCondition()`
     * Function receives no arguments but can access getCurrentContext() internally.
     * Default: true (enabled)
     */
    enabled?: boolean | (() => boolean);
    /**
     * Callback to extract context-specific attributes at runtime.
     * Called with the instance (`this`) and method arguments.
     * Returns attributes to add to the span.
     */
    getAttributes?: (instance: any, args: any[]) => Record<string, unknown>;
    /**
     * Callback to extract attributes from the result after execution.
     * Called with the method's return value.
     * Returns attributes to add to the span before it ends.
     */
    getResultAttributes?: (result: any) => Record<string, unknown>;
    /**
     * Callback to extract metrics from the result after execution.
     * Called with the method's return value.
     * Returns metrics to embed in the span (published as CloudWatch EMF metrics).
     */
    getMetrics?: (result: any) => Record<string, number>;
    /**
     * Callback to extract data from the result after execution.
     * Called with the method's return value.
     * Returns data to embed in the span (for audit-like structured information).
     */
    getData?: (result: any) => Record<string, unknown>;
}
/**
 * Unified observability decorator that combines tracing, auditing, and metrics
 *
 * @param options - Observability options
 */
export declare function Observed(options?: ObservedOptions): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
