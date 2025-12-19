/**
 * SpanObserver - For distributed tracing
 *
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit option
 * - No auto-generation of correlationId (must be propagated)
 * - Hierarchical spans via parentObservabilityLogId
 * - Fire-and-forget capture via capturer pattern (testable)
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context with correlationId
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Then create spans
 *     const span = SpanObserver.start('processOrder');
 *     try {
 *       // ... work
 *       span.end({ success: true });
 *     } catch (error) {
 *       span.end({ success: false, error });
 *     }
 *   }
 * );
 *
 * // Or use withSpan helper
 * await SpanObserver.withSpan('processOrder', async (span) => {
 *   span.addEvent('validation_complete');
 * });
 * ```
 */
import { ObservabilityLevelString } from '../types';
import { BaseObserverOptions, ObservabilityPayload } from './base';
export interface SpanOptions extends BaseObserverOptions {
    /** Parent observability log ID for nested spans */
    parentObservabilityLogId?: string;
    /** Severity level for the span */
    level?: ObservabilityLevelString;
    /** Additional attributes */
    attributes?: Record<string, unknown>;
}
/**
 * Options for adding events to a span
 */
export interface SpanEventOptions extends ObservabilityPayload {
    /** Event severity level */
    level?: ObservabilityLevelString;
    /** Additional tags for this event */
    tags?: Record<string, string>;
}
/**
 * Options for ending a span
 */
export interface SpanEndOptions extends ObservabilityPayload {
    /** Whether the operation succeeded */
    success?: boolean;
    /** Error if operation failed */
    error?: Error;
    /** Custom status string */
    status?: string;
}
/**
 * Interface for span operations (allows NoOp implementation)
 */
export interface ISpanObserver {
    readonly id: string;
    readonly traceId: string;
    setAttribute(key: string, value: unknown): this;
    setAttributes(attrs: Record<string, unknown>): this;
    /**
     * Set span status (OTEL compliant)
     * @param code - Status code ('OK' | 'ERROR' | 'UNSET')
     * @param message - Optional description
     */
    setStatus(code: 'OK' | 'ERROR' | 'UNSET', message?: string): this;
    /**
     * Record an exception (OTEL compliant)
     * Adds an exception event to the span
     */
    recordException(exception: Error | string): this;
    addEvent(name: string, options?: SpanEventOptions): this;
    end(options?: SpanEndOptions): void;
    withChild<T>(operation: string, fn: (span: ISpanObserver) => Promise<T>, options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>): Promise<T>;
    createChild(operation: string, options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>): ISpanObserver;
}
export declare class SpanObserver implements ISpanObserver {
    private readonly spanId;
    private readonly correlationId;
    private readonly parentObservabilityLogId;
    private readonly causedBy?;
    private readonly relatedTraces?;
    private readonly level;
    private readonly startTime;
    private readonly source?;
    private readonly tags?;
    private readonly actor?;
    private attributes;
    private readonly operation;
    private ended;
    private constructor();
    /**
     * Start a new span
     *
     * @param operation - Name of the operation being traced
     * @param options - Span options (correlationId auto-generated if no context)
     * @returns SpanObserver instance (always succeeds)
     */
    static start(operation: string, options?: SpanOptions): ISpanObserver;
    /**
     * Execute function within a span
     */
    static withSpan<T>(operation: string, fn: (span: ISpanObserver) => Promise<T>, options?: SpanOptions): Promise<T>;
    /**
     * Add an event to the current span context.
     * This is a convenience method for adding events when you don't have direct access to the span object.
     * The event will be linked to the current span via parentObservabilityLogId from context.
     *
     * @param name - Event name
     * @param options - Event options (attributes, metrics, data, level, tags)
     *
     * @example
     * ```typescript
     * // From anywhere in the call stack within an observed context:
     * SpanObserver.addEventToCurrentSpan('database.full_scan', {
     *   attributes: { entityName: 'User', operation: 'query' },
     *   metrics: { records_scanned: 1000 },
     *   level: 'warn'
     * });
     * ```
     */
    static addEventToCurrentSpan(name: string, options?: SpanEventOptions): void;
    get id(): string;
    get traceId(): string;
    setAttribute(key: string, value: unknown): this;
    setAttributes(attrs: Record<string, unknown>): this;
    setStatus(code: 'OK' | 'ERROR' | 'UNSET', message?: string): this;
    recordException(exception: Error | string): this;
    addEvent(name: string, options?: SpanEventOptions): this;
    end(options?: SpanEndOptions): void;
    /**
     * Execute function within a child span
     */
    withChild<T>(operation: string, fn: (span: ISpanObserver) => Promise<T>, options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>): Promise<T>;
    /**
     * Create a child span
     */
    createChild(operation: string, options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>): ISpanObserver;
}
export declare const withSpan: typeof SpanObserver.withSpan;
