/**
 * @Log Decorator - Lightweight logging without creating spans
 *
 * Creates standalone log events instead of spans. Perfect for:
 * - Informational messages
 * - Warnings/errors that don't need span context
 * - Debug statements
 * - Events that should be searchable but don't need timeline tracking
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Log({ level: 'warn', message: 'Suspicious order detected' })
 *   private checkFraud(order: Order) {
 *     // Log is emitted on method entry/exit
 *   }
 *
 *   @Log({
 *     level: 'info',
 *     extract: {
 *       finish: (ctx) => ({
 *         message: `Order processed: ${ctx.result.orderId}`,
 *         tags: { orderId: ctx.result.orderId },
 *         metrics: { itemCount: ctx.result.items.length }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Log emitted after method completes with dynamic data
 *   }
 * }
 * ```
 */
import type { ObservabilityLevelString } from '../types';
export interface LogEnrichment {
    /** Log message (overrides default) */
    message?: string;
    /** Log tags for filtering */
    tags?: Record<string, string>;
    /** Log metrics */
    metrics?: Record<string, number>;
    /** Log data payload */
    data?: Record<string, unknown>;
    /** Log level (overrides default) */
    level?: ObservabilityLevelString;
}
export interface LogExtractContext<TInstance, TArgs extends unknown[], TResult> {
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
}['bivarianceHack'];
export interface LogExtractor<TInstance, TArgs extends unknown[], TResult> {
    /**
     * Extract log data before method execution.
     */
    start?: BivariantFn<(ctx: LogExtractContext<TInstance, TArgs, TResult>) => LogEnrichment | void>;
    /**
     * Extract log data after method execution.
     */
    finish?: BivariantFn<(ctx: LogExtractContext<TInstance, TArgs, TResult>) => LogEnrichment | void>;
}
export interface LogOptions<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown> {
    /**
     * Log level.
     * Default: 'info'
     */
    level?: ObservabilityLevelString;
    /**
     * Static log message.
     * For dynamic messages, use extract.start or extract.finish.
     */
    message?: string;
    /**
     * Static tags.
     * For dynamic tags, use extract.
     */
    tags?: Record<string, string>;
    /**
     * Extraction API for dynamic log data.
     */
    extract?: LogExtractor<TInstance, TArgs, TResult>;
    /**
     * Whether to log on method start.
     * Default: false
     */
    logStart?: boolean;
    /**
     * Whether to log on method finish.
     * Default: true
     */
    logFinish?: boolean;
    /**
     * Whether to log on errors only.
     * Default: false
     */
    onErrorOnly?: boolean;
}
export declare function Log<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown>(options?: LogOptions<TInstance, TArgs, TResult>): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
export {};
