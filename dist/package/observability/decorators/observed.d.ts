/**
 * @Observed Decorator - Unified observability decorator
 *
 * Combines tracing, audit, and metrics in one decorator.
 * Parent tracking is FULLY AUTOMATIC via span tree.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed()  // Default - trace only
 *   async fetchOrders(): Promise<Order[]> { }
 *
 *   @Observed({ trace: true, audit: { entityName: 'order' } })
 *   async createOrder(order: Order): Promise<Order> { }
 *
 *   @Observed({ trace: false, audit: true })  // Audit only, no span
 *   async deleteOrder(id: string): Promise<void> { }
 * }
 * ```
 */
import { SpanOptions, ISpanObserver } from '../observers/span';
import type { DecoratorBaseOptions } from '../types';
export type ObservedTagValue = string | number | boolean;
export type ObservedEnrichment = {
    /** Span tags (stored as strings, indexed). */
    tags?: Record<string, ObservedTagValue>;
    /** Span metrics (numeric). */
    metrics?: Record<string, number>;
    /** Span debug data (not indexed). */
    data?: Record<string, unknown>;
    /** Associate this span with a specific entity (filterable in admin UI). */
    entityName?: string;
    /** Entity instance ID (filterable in admin UI). */
    entityId?: string;
    /** Convenience: add checkpoint(s) to the span timeline. */
    checkpoints?: Array<{
        name: string;
        tags?: Record<string, string>;
        metrics?: Record<string, number>;
        data?: Record<string, unknown>;
        error?: Error | string;
    }>;
};
export type ObservedExtractContext<TInstance, TArgs extends unknown[], TResult> = {
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
    /** The current span (only present when tracing is enabled and capture is active). */
    span?: ISpanObserver;
};
type BivariantFn<T extends (...args: any[]) => any> = {
    bivarianceHack: T;
}['bivarianceHack'];
export interface ObservedExtractor<TInstance, TArgs extends unknown[], TResult> {
    /**
     * Run before the method is executed.
     * Return any enrichment to apply to the span.
     */
    start?: BivariantFn<(ctx: ObservedExtractContext<TInstance, TArgs, TResult>) => ObservedEnrichment | void>;
    /**
     * Run after the method finishes (success or error).
     * Return any enrichment to apply to the span.
     */
    finish?: BivariantFn<(ctx: ObservedExtractContext<TInstance, TArgs, TResult>) => ObservedEnrichment | void>;
}
export interface ObservedOptions<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown> extends DecoratorBaseOptions {
    /** Operation name (defaults to ClassName.methodName) */
    name?: string;
    /**
     * Create span for distributed tracing (default: true if nothing else specified).
     * Can be boolean or partial SpanOptions to configure the span.
     * Use capture.noise for noise reduction control.
     */
    trace?: boolean | Partial<SpanOptions>;
    /**
     * Create audit record.
     * Note: Args/result capture is controlled via capture.args/capture.result at the top level.
     */
    audit?: boolean | {
        action?: string;
        entityName?: string;
        level?: 'info' | 'warn' | 'error';
    };
    /** Record metric */
    metric?: {
        name?: string;
        type?: 'counter' | 'timing';
        unit?: string;
        tags?: Record<string, string>;
    };
    /**
     * Unified extraction API (recommended).
     *
     * Lets applications enrich span tags/metrics/data/checkpoints both at start and finish,
     * without needing 3-4 separate callbacks.
     */
    extract?: ObservedExtractor<TInstance, TArgs, TResult>;
}
export declare function Observed(): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
export declare function Observed<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown>(options: ObservedOptions<TInstance, TArgs, TResult>): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
export {};
