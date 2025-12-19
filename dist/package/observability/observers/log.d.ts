/**
 * LogObserver - For simple structured logging
 *
 * Provides a simple API for structured logging that integrates with
 * the observability system. Unlike raw console.log, these logs:
 * - Include correlationId for distributed tracing
 * - Have proper severity levels
 * - Go through configured backends (CloudWatch, DynamoDB, etc.)
 * - Can be sampled/filtered
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context (usually done by middleware)
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Simple logging
 *     LogObserver.info('User logged in', { userId });
 *     LogObserver.warn('Rate limit approaching', { current: 90, limit: 100 });
 *     LogObserver.error('Payment failed', { orderId, error: err.message });
 *
 *     // With additional options
 *     LogObserver.debug('Cache lookup', { key, hit: true }, {
 *       tags: { component: 'cache' }
 *     });
 *   }
 * );
 * ```
 */
import { BaseObserverOptions, ObservabilityPayload } from './base';
export interface LogOptions extends BaseObserverOptions, ObservabilityPayload {
    /** Entity name for context */
    entityName?: string;
    /** Entity ID for context */
    entityId?: string;
}
export declare class LogObserver {
    /**
     * Log at INFO level
     */
    static info(message: string, ...args: unknown[]): string | undefined;
    /**
     * Log at WARN level
     */
    static warn(message: string, ...args: unknown[]): string | undefined;
    /**
     * Log at ERROR level
     */
    static error(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined;
    /**
     * Log at DEBUG level
     */
    static debug(message: string, ...args: unknown[]): string | undefined;
    /**
     * Log at TRACE level
     */
    static trace(message: string, ...args: unknown[]): string | undefined;
    private static logWithArgs;
    /**
     * Log at CRITICAL level (most severe, bypasses sampling)
     */
    static critical(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined;
    /**
     * Core log method
     */
    private static log;
    /**
     * Create a child logger with preset tags/options
     * Useful for component-specific logging
     */
    static createChild(defaultOptions: LogOptions): ChildLogObserver;
}
/**
 * Child logger with preset options
 */
export declare class ChildLogObserver {
    private readonly defaults;
    constructor(defaults: LogOptions);
    trace(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined;
    debug(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined;
    info(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined;
    warn(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined;
    error(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined;
    critical(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined;
    private mergeOptions;
}
