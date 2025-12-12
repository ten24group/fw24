/**
 * @Observed Decorator - Unified observability decorator
 *
 * Combines tracing, audit, and metric recording in a single decorator.
 * Use this for high-level methods that need comprehensive observability.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed({
 *     trace: true,
 *     audit: { action: 'order.create' },
 *     metric: { name: 'orders.created', type: 'counter' }
 *   })
 *   async createOrder(order: Order): Promise<Order> {
 *     // Method is traced, audited, and metered
 *   }
 *
 *   @Observed({
 *     trace: { level: 'info' },
 *     audit: { action: 'payment.process', level: 'warn', captureArgs: true }
 *   })
 *   async processPayment(orderId: string, amount: number): Promise<void> {
 *     // Comprehensive observability with custom config
 *   }
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise creates NoOp spans and skips audits/metrics
 */
import { SpanOptions } from '../observers/span';
export interface ObservedOptions {
    /** Method name (defaults to ClassName.methodName) */
    name?: string;
    /** Create span for tracing */
    trace?: boolean | {
        level?: SpanOptions['level'];
        attributes?: Record<string, unknown>;
    };
    /** Create audit record */
    audit?: boolean | {
        action?: string;
        entityName?: string;
        level?: 'info' | 'warn' | 'error';
        captureArgs?: boolean;
        captureResult?: boolean;
    };
    /** Record metric */
    metric?: {
        name?: string;
        type?: 'counter' | 'gauge' | 'timing';
        unit?: string;
        tags?: Record<string, string>;
    };
    /** Source type for the operation */
    sourceType?: 'controller' | 'service' | 'handler' | 'queue' | 'task';
    /** Tags applied to all observability events */
    tags?: Record<string, string>;
    /** Capture method arguments */
    captureArgs?: boolean;
    /** Capture return value */
    captureResult?: boolean;
}
/**
 * Unified observability decorator that combines tracing, auditing, and metrics
 *
 * @param options - Observability options
 */
export declare function Observed(options?: ObservedOptions): <T extends (...args: unknown[]) => unknown>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
