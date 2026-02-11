/**
 * SpanObserver - Distributed Tracing with Clean Data Separation
 *
 * DESIGN PRINCIPLES:
 * - Clear separation: tags (indexable), metrics (numeric), data (debug payload), checkpoints (timeline)
 * - SpanObserver instances form a linked tree via `parent` references
 * - `withSpan()` / `wrap()` are the PRIMARY APIs - automatic scope management
 * - Consolidation: By default, span.start + content + end are merged into ONE record
 *
 * DATA CONCEPTS:
 * - Tags: string→string pairs for filtering/indexing (orderId, userId, status)
 * - Metrics: string→number pairs for dashboards/alerts (duration, count, size)
 * - Data: arbitrary payload for debugging (request, response, context)
 * - Checkpoints: simple timeline of what happened (validation_start, db_complete)
 *
 * Usage:
 * ```typescript
 * await withSpan('processOrder', async (span) => {
 *   // Tags - for filtering/searching
 *   span.tag('orderId', order.id);
 *   span.tag('status', 'processing');
 *
 *   // Metrics - for dashboards
 *   span.metric('itemCount', items.length);
 *
 *   // Checkpoints - timeline
 *   span.checkpoint('validation_complete');
 *   span.checkpoint('payment_processed');
 *
 *   // Data - debug payload
 *   span.setData({ request: body, response: result });
 * });
 * ```
 */
import type { ISpanNode } from '../../core/runtime/execution-context/types';
import type { ObservabilityLevelString, RecordOverrides } from '../types';
/**
 * Options for starting a span.
 * Extends RecordOverrides for all context override capabilities.
 */
export interface SpanOptions extends RecordOverrides {
    /** Severity level for the span */
    level?: ObservabilityLevelString;
    /** Initial metrics (string→number for aggregation) */
    metrics?: Record<string, number>;
    /** Initial data (debug payload) */
    data?: Record<string, unknown>;
    /** Skip capturing entirely (for audit-only or metric-only scenarios) */
    skipCapture?: boolean;
}
/**
 * Options for ending a span
 */
export interface SpanEndOptions {
    /** Whether the operation succeeded */
    success?: boolean;
    /** Error if operation failed */
    error?: Error;
    /** Custom status string */
    status?: string;
    /** Additional data to merge */
    data?: Record<string, unknown>;
    /** Additional metrics to merge */
    metrics?: Record<string, number>;
}
/**
 * Interface for span operations
 */
export interface ISpanObserver extends ISpanNode {
    readonly id: string;
    readonly operation: string;
    readonly captured: boolean;
    readonly traceId: string;
    readonly parentLogId: string | undefined;
    tag(key: string, value: string | number | boolean): this;
    tags(tags: Record<string, string | number | boolean>): this;
    metric(key: string, value: number): this;
    metrics(metrics: Record<string, number>): this;
    setData(data: Record<string, unknown>): this;
    checkpoint(name: string, options?: {
        metrics?: Record<string, number>;
        data?: Record<string, unknown>;
        tags?: Record<string, string>;
        error?: Error | string;
    }): this;
    end(options?: SpanEndOptions): void;
    recordException(exception: Error | string): this;
}
export declare class SpanObserver implements ISpanObserver {
    readonly id: string;
    readonly operation: string;
    readonly parent?: ISpanNode;
    readonly captured: boolean;
    readonly parentLogId: string | undefined;
    /** Nesting depth in the span hierarchy. Root = 0, direct child = 1, etc. */
    readonly depth: number;
    private readonly correlationId;
    private readonly options;
    private readonly level;
    private readonly startTime;
    private _tags;
    private _metrics;
    private _data;
    private _checkpoints;
    private _hasError;
    ended: boolean;
    private constructor();
    get traceId(): string;
    /** Check if span has any content worth capturing */
    get hasContent(): boolean;
    /**
     * Set a tag for indexing/filtering.
     * Tags are string key-value pairs that can be searched.
     */
    tag(key: string, value: string | number | boolean): this;
    /**
     * Set multiple tags at once.
     */
    tags(tags: Record<string, string | number | boolean>): this;
    /**
     * Record a numeric metric for dashboards/aggregation.
     */
    metric(key: string, value: number): this;
    /**
     * Record multiple metrics at once.
     */
    metrics(metrics: Record<string, number>): this;
    /**
     * Set debug data payload.
     * Data is NOT indexed - use for debugging inspection only.
     */
    setData(data: Record<string, unknown>): this;
    /**
     * Add a checkpoint to the timeline.
     * Checkpoints are simple markers of what happened when.
     */
    checkpoint(name: string, options?: {
        metrics?: Record<string, number>;
        data?: Record<string, unknown>;
        tags?: Record<string, string>;
        error?: Error | string;
    }): this;
    /**
     * Record an exception on this span.
     * Marks the span as having an error and captures exception details.
     */
    recordException(exception: Error | string): this;
    /**
     * Wrap a function in a span - handles both sync and async automatically.
     * This is the PREFERRED API for decorators and unknown sync/async situations.
     */
    static wrap<R>(operation: string, fn: () => Promise<R>, options?: SpanOptions & {
        /** Called immediately after span is created and made current (before invoking fn). */
        onStart?: (span: SpanObserver) => void;
        /** Called before span.end() with result/error. */
        onFinish?: (span: SpanObserver, result: {
            value?: unknown;
            error?: Error;
            success: boolean;
            durationMs: number;
        }) => void;
    }): Promise<R>;
    static wrap<R>(operation: string, fn: () => R, options?: SpanOptions & {
        /** Called immediately after span is created and made current (before invoking fn). */
        onStart?: (span: SpanObserver) => void;
        /** Called before span.end() with result/error. */
        onFinish?: (span: SpanObserver, result: {
            value?: unknown;
            error?: Error;
            success: boolean;
            durationMs: number;
        }) => void;
    }): R;
    /**
     * Execute async function within a span scope.
     * Use when you need access to the span instance.
     */
    static withSpan<T>(operation: string, fn: (span: SpanObserver) => Promise<T>, options?: SpanOptions): Promise<T>;
    /**
     * Execute sync function within a span scope.
     */
    static withSpanSync<T>(operation: string, fn: (span: SpanObserver) => T, options?: SpanOptions): T;
    /**
     * Start a span without automatic scope management.
     * WARNING: This does NOT set the span as current in context.
     * Prefer wrap() or withSpan() for proper parent tracking.
     */
    static start(operation: string, options?: SpanOptions): SpanObserver;
    private static createSpan;
    /**
     * Get the currently active span from context.
     */
    static getCurrentSpan(): SpanObserver | undefined;
    end(options?: SpanEndOptions): void;
}
export declare const withSpan: typeof SpanObserver.withSpan;
export declare const withSpanSync: typeof SpanObserver.withSpanSync;
export declare const wrapInSpan: typeof SpanObserver.wrap;
