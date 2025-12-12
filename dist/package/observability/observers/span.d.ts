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
import { Actor } from '../../core/types/execution-context';
import { ObservabilityLevelString } from '../types';
export interface SpanOptions {
    /** Correlation ID - if not provided, must come from context */
    correlationId?: string;
    /** Parent observability log ID for nested spans */
    parentObservabilityLogId?: string;
    /** Severity level for the span */
    level?: ObservabilityLevelString;
    /** Additional attributes */
    attributes?: Record<string, unknown>;
    /** Source identifier */
    source?: string;
    /** Tags for filtering */
    tags?: Record<string, string>;
    /** Actor performing the operation */
    actor?: Actor;
}
/**
 * Interface for span operations (allows NoOp implementation)
 */
export interface ISpanObserver {
    readonly id: string;
    readonly traceId: string;
    setAttribute(key: string, value: unknown): this;
    setAttributes(attrs: Record<string, unknown>): this;
    addEvent(name: string, eventAttributes?: Record<string, unknown>): this;
    end(options?: {
        success?: boolean;
        error?: Error;
        status?: string;
    }): void;
    withChild<T>(operation: string, fn: (span: ISpanObserver) => Promise<T>, options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>): Promise<T>;
    createChild(operation: string, options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>): ISpanObserver;
}
export declare class SpanObserver implements ISpanObserver {
    private readonly spanId;
    private readonly correlationId;
    private readonly parentObservabilityLogId;
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
    get id(): string;
    get traceId(): string;
    setAttribute(key: string, value: unknown): this;
    setAttributes(attrs: Record<string, unknown>): this;
    addEvent(name: string, eventAttributes?: Record<string, unknown>): this;
    end(options?: {
        success?: boolean;
        error?: Error;
        status?: string;
    }): void;
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
