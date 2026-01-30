"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapInSpan = exports.withSpanSync = exports.withSpan = exports.SpanObserver = void 0;
const storage_1 = require("../../core/runtime/execution-context/storage");
const base_1 = require("./base");
const logging_1 = require("../../logging");
const config_1 = require("../config");
const id_generator_1 = require("../utils/id-generator");
const runtime_state_1 = require("../runtime-state");
/**
 * Get span config from ObservabilityManager (already cached).
 * Returns empty object if not initialized yet.
 */
function getSpanConfig() {
    return (0, runtime_state_1.getCurrentObservabilityConfig)()?.spans ?? config_1.CONFIG_DEFAULTS.spans;
}
/**
 * Track spans per execution context so flush() can force-end any spans left open.
 *
 * This is the core fix for "missing parent span":
 * - a parent span might not have ended when flush runs
 * - or a parent span might end "empty" and be droppable depending on children
 *
 * We solve this by:
 * - recording spans per context
 * - force-ending any still-open spans at flush
 * - deferring the drop decision to flush-time graph analysis (not in SpanObserver.end()).
 */
const spansByContext = new WeakMap();
function registerSpan(span) {
    const ctx = (0, storage_1.getCurrentExecutionContext)();
    if (!ctx)
        return;
    const key = ctx.observability.contextKey;
    const set = spansByContext.get(key);
    if (set)
        set.add(span);
    else
        spansByContext.set(key, new Set([span]));
}
function finalizeOpenSpansForCurrentContext() {
    const ctx = (0, storage_1.getCurrentExecutionContext)();
    if (!ctx)
        return;
    const set = spansByContext.get(ctx.observability.contextKey);
    if (!set)
        return;
    for (const span of set) {
        if (!span.ended) {
            // Force-close: a span left open until flush is a bug in user code or framework wiring.
            // We end it as "abandoned" so it is visible and does not break hierarchy.
            span.end({ success: false, status: 'abandoned' });
        }
    }
}
// Register finalizer so ObservabilityManager.flush() can call it without importing SpanObserver (avoid cycles).
(0, runtime_state_1.setSpanFinalizer)(finalizeOpenSpansForCurrentContext);
const logger = (0, logging_1.createLogger)('SpanObserver');
const OBSERVER_NAME = 'SpanObserver';
// ═══════════════════════════════════════════════════════════════════════════
// SpanObserver Implementation
// ═══════════════════════════════════════════════════════════════════════════
class SpanObserver {
    id;
    operation;
    parent;
    captured;
    parentLogId;
    correlationId;
    options;
    level;
    startTime;
    // Clean data storage
    _tags = {};
    _metrics = {};
    _data = {};
    _checkpoints = [];
    // State tracking
    _hasError = false;
    // NOTE: We no longer mutate spans to track "has children".
    // Parent/span integrity is handled centrally via explicit reference tracking in execution-context state.
    // NOTE: Used by the flush-time span finalizer to close spans left open by user/framework code.
    ended = false;
    constructor(id, operation, parent, captured, options, correlationId, parentLogIdVal = undefined) {
        this.id = id;
        this.operation = operation;
        this.parent = parent;
        this.captured = captured;
        this.options = options;
        this.correlationId = correlationId;
        this.level = options.level ?? 'info';
        this.startTime = Date.now();
        this.parentLogId = parentLogIdVal;
        // Initialize from options
        if (options.tags) {
            this._tags = { ...options.tags };
        }
        if (options.metrics) {
            this._metrics = { ...options.metrics };
        }
        if (options.data) {
            this._data = { ...options.data };
        }
    }
    get traceId() {
        const ctx = (0, storage_1.getCurrentExecutionContext)();
        return this.correlationId ?? this.options.correlationId ?? ctx?.correlationId ?? '';
    }
    /** Check if span has any content worth capturing */
    get hasContent() {
        return this._checkpoints.length > 0
            || this._hasError
            || Object.keys(this._tags).length > 0
            || Object.keys(this._metrics).length > 0
            || Object.keys(this._data).length > 0;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // CLEAN API: Tags, Metrics, Data, Checkpoints
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Set a tag for indexing/filtering.
     * Tags are string key-value pairs that can be searched.
     */
    tag(key, value) {
        this._tags[key] = String(value);
        return this;
    }
    /**
     * Set multiple tags at once.
     */
    tags(tags) {
        for (const [key, value] of Object.entries(tags)) {
            this._tags[key] = String(value);
        }
        return this;
    }
    /**
     * Record a numeric metric for dashboards/aggregation.
     */
    metric(key, value) {
        this._metrics[key] = value;
        return this;
    }
    /**
     * Record multiple metrics at once.
     */
    metrics(metrics) {
        Object.assign(this._metrics, metrics);
        return this;
    }
    /**
     * Set debug data payload.
     * Data is NOT indexed - use for debugging inspection only.
     */
    setData(data) {
        Object.assign(this._data, data);
        return this;
    }
    /**
     * Add a checkpoint to the timeline.
     * Checkpoints are simple markers of what happened when.
     */
    checkpoint(name, options) {
        if (!this.captured)
            return this;
        // Build checkpoint with all fields included in the checkpoint object itself
        const checkpoint = {
            name,
            ts: Date.now()
        };
        // Add checkpoint-specific data/tags/metrics/error to the checkpoint object
        if (options?.data) {
            checkpoint.data = options.data;
        }
        if (options?.tags) {
            checkpoint.tags = options.tags;
        }
        if (options?.metrics) {
            checkpoint.metrics = options.metrics;
        }
        if (options?.error) {
            const err = typeof options.error === 'string'
                ? new Error(options.error)
                : options.error;
            checkpoint.error = (0, base_1.mapError)(err);
        }
        this._checkpoints.push(checkpoint);
        return this;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Error Handling
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Record an exception on this span.
     * Marks the span as having an error and captures exception details.
     */
    recordException(exception) {
        const error = (0, base_1.normalizeError)(exception);
        this._hasError = true;
        this.checkpoint('exception');
        this._data['exception'] = {
            type: error.name,
            message: error.message,
            stack: error.stack,
        };
        this._tags['error'] = 'true';
        return this;
    }
    static wrap(operation, fn, options) {
        const ctx = (0, storage_1.getCurrentExecutionContext)();
        if (!ctx) {
            return fn();
        }
        const opts = options ?? {};
        const span = SpanObserver.createSpan(operation, opts);
        const startTime = Date.now();
        return (0, storage_1.withCurrentSpan)(span, () => {
            try {
                opts.onStart?.(span);
                const result = fn();
                if (result instanceof Promise) {
                    return result
                        .then((value) => {
                        const durationMs = Date.now() - startTime;
                        opts.onFinish?.(span, { value, success: true, durationMs });
                        span.end({ success: true });
                        return value;
                    })
                        .catch((error) => {
                        const durationMs = Date.now() - startTime;
                        const normalizedError = (0, base_1.normalizeError)(error);
                        opts.onFinish?.(span, { error: normalizedError, success: false, durationMs });
                        span.end({ success: false, error: normalizedError });
                        throw error;
                    });
                }
                else {
                    const durationMs = Date.now() - startTime;
                    opts.onFinish?.(span, { value: result, success: true, durationMs });
                    span.end({ success: true });
                    return result;
                }
            }
            catch (syncError) {
                const durationMs = Date.now() - startTime;
                const normalizedError = (0, base_1.normalizeError)(syncError);
                opts.onFinish?.(span, { error: normalizedError, success: false, durationMs });
                span.end({ success: false, error: normalizedError });
                throw syncError;
            }
        });
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SECONDARY API: withSpan() - Explicit async with span access
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Execute async function within a span scope.
     * Use when you need access to the span instance.
     */
    static async withSpan(operation, fn, options = {}) {
        const ctx = (0, storage_1.getCurrentExecutionContext)();
        if (!ctx) {
            const dummySpan = new SpanObserver((0, base_1.generateId)(), operation, undefined, false, options, options.correlationId);
            return fn(dummySpan);
        }
        const span = SpanObserver.createSpan(operation, options);
        return (0, storage_1.withCurrentSpan)(span, async () => {
            try {
                const result = await fn(span);
                span.end({ success: true });
                return result;
            }
            catch (error) {
                span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                throw error;
            }
        });
    }
    /**
     * Execute sync function within a span scope.
     */
    static withSpanSync(operation, fn, options = {}) {
        const ctx = (0, storage_1.getCurrentExecutionContext)();
        if (!ctx) {
            const dummySpan = new SpanObserver((0, base_1.generateId)(), operation, undefined, false, options, options.correlationId);
            return fn(dummySpan);
        }
        const span = SpanObserver.createSpan(operation, options);
        return (0, storage_1.withCurrentSpan)(span, () => {
            try {
                const result = fn(span);
                span.end({ success: true });
                return result;
            }
            catch (error) {
                span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                throw error;
            }
        });
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // ADVANCED API: start() - Manual management (avoid in most cases)
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Start a span without automatic scope management.
     * WARNING: This does NOT set the span as current in context.
     * Prefer wrap() or withSpan() for proper parent tracking.
     */
    static start(operation, options = {}) {
        return SpanObserver.createSpan(operation, options);
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Internal: Span Creation
    // ═══════════════════════════════════════════════════════════════════════════
    static createSpan(operation, options) {
        const state = (0, storage_1.getObservabilityState)();
        const parent = state?.currentSpan;
        // IMPORTANT: ObservabilityLog IDs must be globally unique in DynamoDB.
        // We namespace IDs by correlationId to eliminate collision risk at scale.
        const ctx = (0, storage_1.getCurrentExecutionContext)();
        const correlationId = options.correlationId ?? ctx?.correlationId;
        const id = correlationId ? (0, id_generator_1.generateObservabilityLogId)(correlationId) : (0, base_1.generateId)();
        if (options.skipCapture) {
            return new SpanObserver(id, operation, parent, false, options, correlationId, undefined);
        }
        // Parent resolution:
        // - If caller explicitly provides parentObservabilityLogId (including null), use it.
        // - Otherwise derive from current in-memory span tree.
        //
        // IMPORTANT:
        // parentObservabilityLogId is strict in-slice hierarchy. Do NOT set it to a remote parent.
        const explicitParent = options.parentObservabilityLogId;
        const derivedParentLogId = parent
            ? (parent.captured ? parent.id : (0, storage_1.getCapturedParentId)(parent))
            : undefined;
        const parentLogId = explicitParent === undefined
            ? derivedParentLogId
            : (explicitParent === null ? undefined : explicitParent);
        const { level, metrics, data, skipCapture, tags, ...overrides } = options;
        // Emit span.start to OTEL only
        // Use null if no parent to prevent fallback to getCurrentParentObservabilityLogId()
        (0, base_1.captureRecord)(OBSERVER_NAME, {
            type: 'span.start',
            correlationId,
            observabilityLogId: id,
            parentObservabilityLogId: explicitParent === undefined ? (parentLogId ?? null) : explicitParent,
            level: level ?? 'info',
            timestampMs: Date.now(),
            operation,
            tags: (0, base_1.mergeTags)(state?.tags, tags),
            capture: { backends: ['otel'] },
            ...overrides,
        });
        const span = new SpanObserver(id, operation, parent, true, options, correlationId, parentLogId);
        registerSpan(span);
        return span;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Static Utilities
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Get the currently active span from context.
     */
    static getCurrentSpan() {
        const current = (0, storage_1.getObservabilityState)()?.currentSpan;
        // currentSpan is only ever set by SpanObserver, but we keep the runtime check conservative.
        return current instanceof SpanObserver ? current : undefined;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Lifecycle: end()
    // ═══════════════════════════════════════════════════════════════════════════
    end(options) {
        if (this.ended)
            return;
        this.ended = true;
        if (!this.captured)
            return;
        const endTime = Date.now();
        const duration = endTime - this.startTime;
        const hasError = !!options?.error || options?.success === false;
        if (hasError) {
            this._hasError = true;
        }
        // IMPORTANT:
        // Do NOT drop spans here.
        //
        // Whether a span can be dropped depends on whether it has any children (graph property),
        // which can only be known reliably at flush-time once all events are buffered.
        const { level, skipCapture, metrics, data, tags, ...overrides } = this.options;
        // Build error info
        let errorInfo;
        if (options?.error) {
            errorInfo = {
                type: options.error.name,
                message: options.error.message,
                stack: options.error.stack,
                code: 'code' in options.error && typeof options.error.code === 'string'
                    ? options.error.code
                    : undefined,
            };
        }
        // Build final metrics (duration always included)
        const finalMetrics = {
            duration,
            ...this._metrics,
            ...options?.metrics,
        };
        // Build final data
        const finalData = {
            ...this._data,
            ...options?.data,
        };
        // Mark whether this span was "empty" (no useful content beyond timing).
        // Flush-time logic can safely drop empty *leaf* spans when configured.
        const isEmptySpan = !this.hasContent && !hasError;
        if (isEmptySpan) {
            const existing = finalData._fw24;
            const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
                ? existing
                : {};
            finalData._fw24 = { ...base, spanEmpty: true };
        }
        // Add checkpoints to data if any
        if (this._checkpoints.length > 0) {
            finalData.checkpoints = this._checkpoints;
        }
        // Emit consolidated span record
        // CRITICAL: Pass null explicitly if no parent to prevent fallback to getCurrentParentObservabilityLogId()
        // which would return THIS span's ID (causing self-reference bug)
        const capturedId = (0, base_1.captureRecord)(OBSERVER_NAME, {
            type: 'span',
            // IMPORTANT:
            // Span end can occur after the async execution context has unwound (ALS boundary),
            // especially in queue/batch processors. Store correlationId at span creation time and
            // pass it explicitly so we never end up with span.start but no span record.
            correlationId: this.correlationId,
            observabilityLogId: this.id,
            level: options?.error ? 'error' : this.level,
            parentObservabilityLogId: this.parentLogId ?? null,
            // IMPORTANT:
            // Use span *start* timestamp for ordering in DynamoDB/UI.
            // DurationMs still represents end-start, so the end timestamp is derivable as (timestampMs + durationMs).
            // Using endTime here causes spans to appear after their children, which breaks timeline ordering in the UI.
            timestampMs: this.startTime,
            durationMs: duration,
            operation: this.operation,
            success: options?.success ?? !options?.error,
            status: options?.status ?? (options?.error ? 'failed' : 'completed'),
            tags: this._tags,
            metrics: finalMetrics,
            data: Object.keys(finalData).length > 0 ? finalData : undefined,
            error: errorInfo,
            capture: {
                ...this.options.capture,
            },
            ...overrides,
        });
        // NOTE: Span parent/child integrity is enforced at flush-time by analyzing the buffered graph.
    }
}
exports.SpanObserver = SpanObserver;
// ═══════════════════════════════════════════════════════════════════════════
// Convenience Exports
// ═══════════════════════════════════════════════════════════════════════════
exports.withSpan = SpanObserver.withSpan.bind(SpanObserver);
exports.withSpanSync = SpanObserver.withSpanSync.bind(SpanObserver);
exports.wrapInSpan = SpanObserver.wrap.bind(SpanObserver);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUNHOzs7QUFHSCwwRUFLc0Q7QUFFdEQsaUNBTWdCO0FBQ2hCLDJDQUE2QztBQUM3QyxzQ0FBNEM7QUFDNUMsd0RBQW1FO0FBQ25FLG9EQUFtRjtBQVFuRjs7O0dBR0c7QUFDSCxTQUFTLGFBQWE7SUFDcEIsT0FBTyxJQUFBLDZDQUE2QixHQUFFLEVBQUUsS0FBSyxJQUFJLHdCQUFlLENBQUMsS0FBSyxDQUFDO0FBQ3pFLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sY0FBYyxHQUFHLElBQUksT0FBTyxFQUE2QixDQUFDO0FBRWhFLFNBQVMsWUFBWSxDQUFDLElBQWtCO0lBQ3RDLE1BQU0sR0FBRyxHQUFHLElBQUEsb0NBQTBCLEdBQUUsQ0FBQztJQUN6QyxJQUFJLENBQUMsR0FBRztRQUFFLE9BQU87SUFDakIsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7SUFDekMsTUFBTSxHQUFHLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNwQyxJQUFJLEdBQUc7UUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDOztRQUNsQixjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEdBQUcsQ0FBQyxDQUFFLElBQUksQ0FBRSxDQUFDLENBQUMsQ0FBQztBQUNsRCxDQUFDO0FBRUQsU0FBUyxrQ0FBa0M7SUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBQSxvQ0FBMEIsR0FBRSxDQUFDO0lBQ3pDLElBQUksQ0FBQyxHQUFHO1FBQUUsT0FBTztJQUNqQixNQUFNLEdBQUcsR0FBRyxjQUFjLENBQUMsR0FB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RztZQUM1RyxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDM0IsVUFBVSxFQUFFLFFBQVE7WUFDcEIsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3pCLE9BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxJQUFJLENBQUMsT0FBTyxFQUFFLEtBQUs7WUFDNUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQztZQUNwRSxJQUFJLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDaEIsT0FBTyxFQUFFLFlBQVk7WUFDckIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQy9ELEtBQUssRUFBRSxTQUFTO1lBQ2hCLE9BQU8sRUFBRTtnQkFDUCxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTzthQUN4QjtZQUNELEdBQUcsU0FBUztTQUNiLENBQUMsQ0FBQztRQUVILCtGQUErRjtJQUNqRyxDQUFDO0NBQ0Y7QUEzZkQsb0NBMmZDO0FBRUQsOEVBQThFO0FBQzlFLHNCQUFzQjtBQUN0Qiw4RUFBOEU7QUFFakUsUUFBQSxRQUFRLEdBQUcsWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDcEQsUUFBQSxZQUFZLEdBQUcsWUFBWSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUQsUUFBQSxVQUFVLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFNwYW5PYnNlcnZlciAtIERpc3RyaWJ1dGVkIFRyYWNpbmcgd2l0aCBDbGVhbiBEYXRhIFNlcGFyYXRpb25cbiAqIFxuICogREVTSUdOIFBSSU5DSVBMRVM6XG4gKiAtIENsZWFyIHNlcGFyYXRpb246IHRhZ3MgKGluZGV4YWJsZSksIG1ldHJpY3MgKG51bWVyaWMpLCBkYXRhIChkZWJ1ZyBwYXlsb2FkKSwgY2hlY2twb2ludHMgKHRpbWVsaW5lKVxuICogLSBTcGFuT2JzZXJ2ZXIgaW5zdGFuY2VzIGZvcm0gYSBsaW5rZWQgdHJlZSB2aWEgYHBhcmVudGAgcmVmZXJlbmNlc1xuICogLSBgd2l0aFNwYW4oKWAgLyBgd3JhcCgpYCBhcmUgdGhlIFBSSU1BUlkgQVBJcyAtIGF1dG9tYXRpYyBzY29wZSBtYW5hZ2VtZW50XG4gKiAtIENvbnNvbGlkYXRpb246IEJ5IGRlZmF1bHQsIHNwYW4uc3RhcnQgKyBjb250ZW50ICsgZW5kIGFyZSBtZXJnZWQgaW50byBPTkUgcmVjb3JkXG4gKiBcbiAqIERBVEEgQ09OQ0VQVFM6XG4gKiAtIFRhZ3M6IHN0cmluZ+KGknN0cmluZyBwYWlycyBmb3IgZmlsdGVyaW5nL2luZGV4aW5nIChvcmRlcklkLCB1c2VySWQsIHN0YXR1cylcbiAqIC0gTWV0cmljczogc3RyaW5n4oaSbnVtYmVyIHBhaXJzIGZvciBkYXNoYm9hcmRzL2FsZXJ0cyAoZHVyYXRpb24sIGNvdW50LCBzaXplKVxuICogLSBEYXRhOiBhcmJpdHJhcnkgcGF5bG9hZCBmb3IgZGVidWdnaW5nIChyZXF1ZXN0LCByZXNwb25zZSwgY29udGV4dClcbiAqIC0gQ2hlY2twb2ludHM6IHNpbXBsZSB0aW1lbGluZSBvZiB3aGF0IGhhcHBlbmVkICh2YWxpZGF0aW9uX3N0YXJ0LCBkYl9jb21wbGV0ZSlcbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBhd2FpdCB3aXRoU3BhbigncHJvY2Vzc09yZGVyJywgYXN5bmMgKHNwYW4pID0+IHtcbiAqICAgLy8gVGFncyAtIGZvciBmaWx0ZXJpbmcvc2VhcmNoaW5nXG4gKiAgIHNwYW4udGFnKCdvcmRlcklkJywgb3JkZXIuaWQpO1xuICogICBzcGFuLnRhZygnc3RhdHVzJywgJ3Byb2Nlc3NpbmcnKTtcbiAqICAgXG4gKiAgIC8vIE1ldHJpY3MgLSBmb3IgZGFzaGJvYXJkc1xuICogICBzcGFuLm1ldHJpYygnaXRlbUNvdW50JywgaXRlbXMubGVuZ3RoKTtcbiAqICAgXG4gKiAgIC8vIENoZWNrcG9pbnRzIC0gdGltZWxpbmVcbiAqICAgc3Bhbi5jaGVja3BvaW50KCd2YWxpZGF0aW9uX2NvbXBsZXRlJyk7XG4gKiAgIHNwYW4uY2hlY2twb2ludCgncGF5bWVudF9wcm9jZXNzZWQnKTtcbiAqICAgXG4gKiAgIC8vIERhdGEgLSBkZWJ1ZyBwYXlsb2FkXG4gKiAgIHNwYW4uc2V0RGF0YSh7IHJlcXVlc3Q6IGJvZHksIHJlc3BvbnNlOiByZXN1bHQgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB0eXBlIHsgSVNwYW5Ob2RlIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3R5cGVzJztcbmltcG9ydCB7XG4gIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LFxuICBnZXRPYnNlcnZhYmlsaXR5U3RhdGUsXG4gIHdpdGhDdXJyZW50U3BhbixcbiAgZ2V0Q2FwdHVyZWRQYXJlbnRJZCxcbn0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3N0b3JhZ2UnO1xuaW1wb3J0IHR5cGUgeyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsIFJlY29yZE92ZXJyaWRlcywgT2JzZXJ2YWJpbGl0eUVycm9yLCBTcGFuQ29uZmlnLCBTcGFuQ2hlY2twb2ludCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7XG4gIGdlbmVyYXRlSWQsXG4gIGNhcHR1cmVSZWNvcmQsXG4gIG5vcm1hbGl6ZUVycm9yLFxuICBtZXJnZVRhZ3MsXG4gIG1hcEVycm9yLFxufSBmcm9tICcuL2Jhc2UnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBDT05GSUdfREVGQVVMVFMgfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IHsgZ2VuZXJhdGVPYnNlcnZhYmlsaXR5TG9nSWQgfSBmcm9tICcuLi91dGlscy9pZC1nZW5lcmF0b3InO1xuaW1wb3J0IHsgZ2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcsIHNldFNwYW5GaW5hbGl6ZXIgfSBmcm9tICcuLi9ydW50aW1lLXN0YXRlJztcblxuLyoqIENoZWNrcG9pbnQgZW50cnkgLSBzaW1wbGUgdGltZWxpbmUgbWFya2VyICovXG5pbnRlcmZhY2UgQ2hlY2twb2ludCB7XG4gIG5hbWU6IHN0cmluZztcbiAgdHM6IG51bWJlcjtcbn1cblxuLyoqIFxuICogR2V0IHNwYW4gY29uZmlnIGZyb20gT2JzZXJ2YWJpbGl0eU1hbmFnZXIgKGFscmVhZHkgY2FjaGVkKS5cbiAqIFJldHVybnMgZW1wdHkgb2JqZWN0IGlmIG5vdCBpbml0aWFsaXplZCB5ZXQuXG4gKi9cbmZ1bmN0aW9uIGdldFNwYW5Db25maWcoKTogU3BhbkNvbmZpZyB7XG4gIHJldHVybiBnZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZygpPy5zcGFucyA/PyBDT05GSUdfREVGQVVMVFMuc3BhbnM7XG59XG5cbi8qKlxuICogVHJhY2sgc3BhbnMgcGVyIGV4ZWN1dGlvbiBjb250ZXh0IHNvIGZsdXNoKCkgY2FuIGZvcmNlLWVuZCBhbnkgc3BhbnMgbGVmdCBvcGVuLlxuICpcbiAqIFRoaXMgaXMgdGhlIGNvcmUgZml4IGZvciBcIm1pc3NpbmcgcGFyZW50IHNwYW5cIjpcbiAqIC0gYSBwYXJlbnQgc3BhbiBtaWdodCBub3QgaGF2ZSBlbmRlZCB3aGVuIGZsdXNoIHJ1bnNcbiAqIC0gb3IgYSBwYXJlbnQgc3BhbiBtaWdodCBlbmQgXCJlbXB0eVwiIGFuZCBiZSBkcm9wcGFibGUgZGVwZW5kaW5nIG9uIGNoaWxkcmVuXG4gKlxuICogV2Ugc29sdmUgdGhpcyBieTpcbiAqIC0gcmVjb3JkaW5nIHNwYW5zIHBlciBjb250ZXh0XG4gKiAtIGZvcmNlLWVuZGluZyBhbnkgc3RpbGwtb3BlbiBzcGFucyBhdCBmbHVzaFxuICogLSBkZWZlcnJpbmcgdGhlIGRyb3AgZGVjaXNpb24gdG8gZmx1c2gtdGltZSBncmFwaCBhbmFseXNpcyAobm90IGluIFNwYW5PYnNlcnZlci5lbmQoKSkuXG4gKi9cbmNvbnN0IHNwYW5zQnlDb250ZXh0ID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBTZXQ8U3Bhbk9ic2VydmVyPj4oKTtcblxuZnVuY3Rpb24gcmVnaXN0ZXJTcGFuKHNwYW46IFNwYW5PYnNlcnZlcik6IHZvaWQge1xuICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICBpZiAoIWN0eCkgcmV0dXJuO1xuICBjb25zdCBrZXkgPSBjdHgub2JzZXJ2YWJpbGl0eS5jb250ZXh0S2V5O1xuICBjb25zdCBzZXQgPSBzcGFuc0J5Q29udGV4dC5nZXQoa2V5KTtcbiAgaWYgKHNldCkgc2V0LmFkZChzcGFuKTtcbiAgZWxzZSBzcGFuc0J5Q29udGV4dC5zZXQoa2V5LCBuZXcgU2V0KFsgc3BhbiBdKSk7XG59XG5cbmZ1bmN0aW9uIGZpbmFsaXplT3BlblNwYW5zRm9yQ3VycmVudENvbnRleHQoKTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gIGlmICghY3R4KSByZXR1cm47XG4gIGNvbnN0IHNldCA9IHNwYW5zQnlDb250ZXh0LmdldChjdHgub2JzZXJ2YWJpbGl0eS5jb250ZXh0S2V5KTtcbiAgaWYgKCFzZXQpIHJldHVybjtcblxuICBmb3IgKGNvbnN0IHNwYW4gb2Ygc2V0KSB7XG4gICAgaWYgKCFzcGFuLmVuZGVkKSB7XG4gICAgICAvLyBGb3JjZS1jbG9zZTogYSBzcGFuIGxlZnQgb3BlbiB1bnRpbCBmbHVzaCBpcyBhIGJ1ZyBpbiB1c2VyIGNvZGUgb3IgZnJhbWV3b3JrIHdpcmluZy5cbiAgICAgIC8vIFdlIGVuZCBpdCBhcyBcImFiYW5kb25lZFwiIHNvIGl0IGlzIHZpc2libGUgYW5kIGRvZXMgbm90IGJyZWFrIGhpZXJhcmNoeS5cbiAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIHN0YXR1czogJ2FiYW5kb25lZCcgfSk7XG4gICAgfVxuICB9XG59XG5cbi8vIFJlZ2lzdGVyIGZpbmFsaXplciBzbyBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpIGNhbiBjYWxsIGl0IHdpdGhvdXQgaW1wb3J0aW5nIFNwYW5PYnNlcnZlciAoYXZvaWQgY3ljbGVzKS5cbnNldFNwYW5GaW5hbGl6ZXIoZmluYWxpemVPcGVuU3BhbnNGb3JDdXJyZW50Q29udGV4dCk7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignU3Bhbk9ic2VydmVyJyk7XG5jb25zdCBPQlNFUlZFUl9OQU1FID0gJ1NwYW5PYnNlcnZlcic7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gVHlwZXNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIHN0YXJ0aW5nIGEgc3Bhbi5cbiAqIEV4dGVuZHMgUmVjb3JkT3ZlcnJpZGVzIGZvciBhbGwgY29udGV4dCBvdmVycmlkZSBjYXBhYmlsaXRpZXMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3Bhbk9wdGlvbnMgZXh0ZW5kcyBSZWNvcmRPdmVycmlkZXMge1xuICAvKiogU2V2ZXJpdHkgbGV2ZWwgZm9yIHRoZSBzcGFuICovXG4gIGxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICAvKiogSW5pdGlhbCBtZXRyaWNzIChzdHJpbmfihpJudW1iZXIgZm9yIGFnZ3JlZ2F0aW9uKSAqL1xuICBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgLyoqIEluaXRpYWwgZGF0YSAoZGVidWcgcGF5bG9hZCkgKi9cbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogU2tpcCBjYXB0dXJpbmcgZW50aXJlbHkgKGZvciBhdWRpdC1vbmx5IG9yIG1ldHJpYy1vbmx5IHNjZW5hcmlvcykgKi9cbiAgc2tpcENhcHR1cmU/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGVuZGluZyBhIHNwYW5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGFuRW5kT3B0aW9ucyB7XG4gIC8qKiBXaGV0aGVyIHRoZSBvcGVyYXRpb24gc3VjY2VlZGVkICovXG4gIHN1Y2Nlc3M/OiBib29sZWFuO1xuICAvKiogRXJyb3IgaWYgb3BlcmF0aW9uIGZhaWxlZCAqL1xuICBlcnJvcj86IEVycm9yO1xuICAvKiogQ3VzdG9tIHN0YXR1cyBzdHJpbmcgKi9cbiAgc3RhdHVzPzogc3RyaW5nO1xuICAvKiogQWRkaXRpb25hbCBkYXRhIHRvIG1lcmdlICovXG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIEFkZGl0aW9uYWwgbWV0cmljcyB0byBtZXJnZSAqL1xuICBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbn1cblxuLyoqXG4gKiBJbnRlcmZhY2UgZm9yIHNwYW4gb3BlcmF0aW9uc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIElTcGFuT2JzZXJ2ZXIgZXh0ZW5kcyBJU3Bhbk5vZGUge1xuICByZWFkb25seSBpZDogc3RyaW5nO1xuICByZWFkb25seSBvcGVyYXRpb246IHN0cmluZztcbiAgcmVhZG9ubHkgY2FwdHVyZWQ6IGJvb2xlYW47XG4gIHJlYWRvbmx5IHRyYWNlSWQ6IHN0cmluZztcbiAgcmVhZG9ubHkgcGFyZW50TG9nSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICAvLyBDbGVhbiBBUElcbiAgdGFnKGtleTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbik6IHRoaXM7XG4gIHRhZ3ModGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj4pOiB0aGlzO1xuICBtZXRyaWMoa2V5OiBzdHJpbmcsIHZhbHVlOiBudW1iZXIpOiB0aGlzO1xuICBtZXRyaWNzKG1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4pOiB0aGlzO1xuICBzZXREYXRhKGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdGhpcztcbiAgY2hlY2twb2ludChuYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiB7XG4gICAgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIGVycm9yPzogRXJyb3IgfCBzdHJpbmc7XG4gIH0pOiB0aGlzO1xuXG4gIC8vIExpZmVjeWNsZVxuICBlbmQob3B0aW9ucz86IFNwYW5FbmRPcHRpb25zKTogdm9pZDtcblxuICAvLyBFcnJvciBoYW5kbGluZ1xuICByZWNvcmRFeGNlcHRpb24oZXhjZXB0aW9uOiBFcnJvciB8IHN0cmluZyk6IHRoaXM7XG59XG5cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBTcGFuT2JzZXJ2ZXIgSW1wbGVtZW50YXRpb25cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgY2xhc3MgU3Bhbk9ic2VydmVyIGltcGxlbWVudHMgSVNwYW5PYnNlcnZlciB7XG4gIHJlYWRvbmx5IGlkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG9wZXJhdGlvbjogc3RyaW5nO1xuICByZWFkb25seSBwYXJlbnQ/OiBJU3Bhbk5vZGU7XG4gIHJlYWRvbmx5IGNhcHR1cmVkOiBib29sZWFuO1xuICByZWFkb25seSBwYXJlbnRMb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IGNvcnJlbGF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFNwYW5PcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IGxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RhcnRUaW1lOiBudW1iZXI7XG5cbiAgLy8gQ2xlYW4gZGF0YSBzdG9yYWdlXG4gIHByaXZhdGUgX3RhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgcHJpdmF0ZSBfbWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICBwcml2YXRlIF9kYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBwcml2YXRlIF9jaGVja3BvaW50czogQ2hlY2twb2ludFtdID0gW107XG5cbiAgLy8gU3RhdGUgdHJhY2tpbmdcbiAgcHJpdmF0ZSBfaGFzRXJyb3IgPSBmYWxzZTtcbiAgLy8gTk9URTogV2Ugbm8gbG9uZ2VyIG11dGF0ZSBzcGFucyB0byB0cmFjayBcImhhcyBjaGlsZHJlblwiLlxuICAvLyBQYXJlbnQvc3BhbiBpbnRlZ3JpdHkgaXMgaGFuZGxlZCBjZW50cmFsbHkgdmlhIGV4cGxpY2l0IHJlZmVyZW5jZSB0cmFja2luZyBpbiBleGVjdXRpb24tY29udGV4dCBzdGF0ZS5cbiAgLy8gTk9URTogVXNlZCBieSB0aGUgZmx1c2gtdGltZSBzcGFuIGZpbmFsaXplciB0byBjbG9zZSBzcGFucyBsZWZ0IG9wZW4gYnkgdXNlci9mcmFtZXdvcmsgY29kZS5cbiAgcHVibGljIGVuZGVkID0gZmFsc2U7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihcbiAgICBpZDogc3RyaW5nLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIHBhcmVudDogSVNwYW5Ob2RlIHwgdW5kZWZpbmVkLFxuICAgIGNhcHR1cmVkOiBib29sZWFuLFxuICAgIG9wdGlvbnM6IFNwYW5PcHRpb25zLFxuICAgIGNvcnJlbGF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICBwYXJlbnRMb2dJZFZhbDogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkXG4gICkge1xuICAgIHRoaXMuaWQgPSBpZDtcbiAgICB0aGlzLm9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICB0aGlzLnBhcmVudCA9IHBhcmVudDtcbiAgICB0aGlzLmNhcHR1cmVkID0gY2FwdHVyZWQ7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICB0aGlzLmNvcnJlbGF0aW9uSWQgPSBjb3JyZWxhdGlvbklkO1xuICAgIHRoaXMubGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgdGhpcy5wYXJlbnRMb2dJZCA9IHBhcmVudExvZ0lkVmFsO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBmcm9tIG9wdGlvbnNcbiAgICBpZiAob3B0aW9ucy50YWdzKSB7XG4gICAgICB0aGlzLl90YWdzID0geyAuLi5vcHRpb25zLnRhZ3MgfTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWV0cmljcykge1xuICAgICAgdGhpcy5fbWV0cmljcyA9IHsgLi4ub3B0aW9ucy5tZXRyaWNzIH07XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmRhdGEpIHtcbiAgICAgIHRoaXMuX2RhdGEgPSB7IC4uLm9wdGlvbnMuZGF0YSB9O1xuICAgIH1cbiAgfVxuXG4gIGdldCB0cmFjZUlkKCk6IHN0cmluZyB7XG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICByZXR1cm4gdGhpcy5jb3JyZWxhdGlvbklkID8/IHRoaXMub3B0aW9ucy5jb3JyZWxhdGlvbklkID8/IGN0eD8uY29ycmVsYXRpb25JZCA/PyAnJztcbiAgfVxuXG4gIC8qKiBDaGVjayBpZiBzcGFuIGhhcyBhbnkgY29udGVudCB3b3J0aCBjYXB0dXJpbmcgKi9cbiAgZ2V0IGhhc0NvbnRlbnQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuX2NoZWNrcG9pbnRzLmxlbmd0aCA+IDBcbiAgICAgIHx8IHRoaXMuX2hhc0Vycm9yXG4gICAgICB8fCBPYmplY3Qua2V5cyh0aGlzLl90YWdzKS5sZW5ndGggPiAwXG4gICAgICB8fCBPYmplY3Qua2V5cyh0aGlzLl9tZXRyaWNzKS5sZW5ndGggPiAwXG4gICAgICB8fCBPYmplY3Qua2V5cyh0aGlzLl9kYXRhKS5sZW5ndGggPiAwO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIENMRUFOIEFQSTogVGFncywgTWV0cmljcywgRGF0YSwgQ2hlY2twb2ludHNcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgLyoqXG4gICAqIFNldCBhIHRhZyBmb3IgaW5kZXhpbmcvZmlsdGVyaW5nLlxuICAgKiBUYWdzIGFyZSBzdHJpbmcga2V5LXZhbHVlIHBhaXJzIHRoYXQgY2FuIGJlIHNlYXJjaGVkLlxuICAgKi9cbiAgdGFnKGtleTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbik6IHRoaXMge1xuICAgIHRoaXMuX3RhZ3NbIGtleSBdID0gU3RyaW5nKHZhbHVlKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgbXVsdGlwbGUgdGFncyBhdCBvbmNlLlxuICAgKi9cbiAgdGFncyh0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPik6IHRoaXMge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXModGFncykpIHtcbiAgICAgIHRoaXMuX3RhZ3NbIGtleSBdID0gU3RyaW5nKHZhbHVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGEgbnVtZXJpYyBtZXRyaWMgZm9yIGRhc2hib2FyZHMvYWdncmVnYXRpb24uXG4gICAqL1xuICBtZXRyaWMoa2V5OiBzdHJpbmcsIHZhbHVlOiBudW1iZXIpOiB0aGlzIHtcbiAgICB0aGlzLl9tZXRyaWNzWyBrZXkgXSA9IHZhbHVlO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBtdWx0aXBsZSBtZXRyaWNzIGF0IG9uY2UuXG4gICAqL1xuICBtZXRyaWNzKG1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4pOiB0aGlzIHtcbiAgICBPYmplY3QuYXNzaWduKHRoaXMuX21ldHJpY3MsIG1ldHJpY3MpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBkZWJ1ZyBkYXRhIHBheWxvYWQuXG4gICAqIERhdGEgaXMgTk9UIGluZGV4ZWQgLSB1c2UgZm9yIGRlYnVnZ2luZyBpbnNwZWN0aW9uIG9ubHkuXG4gICAqL1xuICBzZXREYXRhKGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdGhpcyB7XG4gICAgT2JqZWN0LmFzc2lnbih0aGlzLl9kYXRhLCBkYXRhKTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBjaGVja3BvaW50IHRvIHRoZSB0aW1lbGluZS5cbiAgICogQ2hlY2twb2ludHMgYXJlIHNpbXBsZSBtYXJrZXJzIG9mIHdoYXQgaGFwcGVuZWQgd2hlbi5cbiAgICovXG4gIGNoZWNrcG9pbnQobmFtZTogc3RyaW5nLCBvcHRpb25zPzoge1xuICAgIG1ldHJpY3M/OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgICBlcnJvcj86IEVycm9yIHwgc3RyaW5nO1xuICB9KTogdGhpcyB7XG4gICAgaWYgKCF0aGlzLmNhcHR1cmVkKSByZXR1cm4gdGhpcztcblxuICAgIC8vIEJ1aWxkIGNoZWNrcG9pbnQgd2l0aCBhbGwgZmllbGRzIGluY2x1ZGVkIGluIHRoZSBjaGVja3BvaW50IG9iamVjdCBpdHNlbGZcbiAgICBjb25zdCBjaGVja3BvaW50OiBTcGFuQ2hlY2twb2ludCA9IHtcbiAgICAgIG5hbWUsXG4gICAgICB0czogRGF0ZS5ub3coKVxuICAgIH07XG5cbiAgICAvLyBBZGQgY2hlY2twb2ludC1zcGVjaWZpYyBkYXRhL3RhZ3MvbWV0cmljcy9lcnJvciB0byB0aGUgY2hlY2twb2ludCBvYmplY3RcbiAgICBpZiAob3B0aW9ucz8uZGF0YSkge1xuICAgICAgY2hlY2twb2ludC5kYXRhID0gb3B0aW9ucy5kYXRhO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucz8udGFncykge1xuICAgICAgY2hlY2twb2ludC50YWdzID0gb3B0aW9ucy50YWdzO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucz8ubWV0cmljcykge1xuICAgICAgY2hlY2twb2ludC5tZXRyaWNzID0gb3B0aW9ucy5tZXRyaWNzO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucz8uZXJyb3IpIHtcbiAgICAgIGNvbnN0IGVyciA9IHR5cGVvZiBvcHRpb25zLmVycm9yID09PSAnc3RyaW5nJ1xuICAgICAgICA/IG5ldyBFcnJvcihvcHRpb25zLmVycm9yKVxuICAgICAgICA6IG9wdGlvbnMuZXJyb3I7XG4gICAgICBjaGVja3BvaW50LmVycm9yID0gbWFwRXJyb3IoZXJyKTtcbiAgICB9XG5cbiAgICB0aGlzLl9jaGVja3BvaW50cy5wdXNoKGNoZWNrcG9pbnQpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEVycm9yIEhhbmRsaW5nXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYW4gZXhjZXB0aW9uIG9uIHRoaXMgc3Bhbi5cbiAgICogTWFya3MgdGhlIHNwYW4gYXMgaGF2aW5nIGFuIGVycm9yIGFuZCBjYXB0dXJlcyBleGNlcHRpb24gZGV0YWlscy5cbiAgICovXG4gIHJlY29yZEV4Y2VwdGlvbihleGNlcHRpb246IEVycm9yIHwgc3RyaW5nKTogdGhpcyB7XG4gICAgY29uc3QgZXJyb3IgPSBub3JtYWxpemVFcnJvcihleGNlcHRpb24pO1xuICAgIHRoaXMuX2hhc0Vycm9yID0gdHJ1ZTtcbiAgICB0aGlzLmNoZWNrcG9pbnQoJ2V4Y2VwdGlvbicpO1xuICAgIHRoaXMuX2RhdGFbICdleGNlcHRpb24nIF0gPSB7XG4gICAgICB0eXBlOiBlcnJvci5uYW1lLFxuICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcbiAgICB9O1xuICAgIHRoaXMuX3RhZ3NbICdlcnJvcicgXSA9ICd0cnVlJztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBQUklNQVJZIEFQSTogd3JhcCgpIC0gSGFuZGxlcyBib3RoIHN5bmMgYW5kIGFzeW5jIGF1dG9tYXRpY2FsbHlcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgLyoqXG4gICAqIFdyYXAgYSBmdW5jdGlvbiBpbiBhIHNwYW4gLSBoYW5kbGVzIGJvdGggc3luYyBhbmQgYXN5bmMgYXV0b21hdGljYWxseS5cbiAgICogVGhpcyBpcyB0aGUgUFJFRkVSUkVEIEFQSSBmb3IgZGVjb3JhdG9ycyBhbmQgdW5rbm93biBzeW5jL2FzeW5jIHNpdHVhdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgd3JhcDxSPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKCkgPT4gUHJvbWlzZTxSPixcbiAgICBvcHRpb25zPzogU3Bhbk9wdGlvbnMgJiB7XG4gICAgICAvKiogQ2FsbGVkIGltbWVkaWF0ZWx5IGFmdGVyIHNwYW4gaXMgY3JlYXRlZCBhbmQgbWFkZSBjdXJyZW50IChiZWZvcmUgaW52b2tpbmcgZm4pLiAqL1xuICAgICAgb25TdGFydD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIpID0+IHZvaWQ7XG4gICAgICAvKiogQ2FsbGVkIGJlZm9yZSBzcGFuLmVuZCgpIHdpdGggcmVzdWx0L2Vycm9yLiAqL1xuICAgICAgb25GaW5pc2g/OiAoc3BhbjogU3Bhbk9ic2VydmVyLCByZXN1bHQ6IHsgdmFsdWU/OiB1bmtub3duOyBlcnJvcj86IEVycm9yOyBzdWNjZXNzOiBib29sZWFuOyBkdXJhdGlvbk1zOiBudW1iZXIgfSkgPT4gdm9pZDtcbiAgICB9XG4gICk6IFByb21pc2U8Uj47XG4gIHN0YXRpYyB3cmFwPFI+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBSLFxuICAgIG9wdGlvbnM/OiBTcGFuT3B0aW9ucyAmIHtcbiAgICAgIC8qKiBDYWxsZWQgaW1tZWRpYXRlbHkgYWZ0ZXIgc3BhbiBpcyBjcmVhdGVkIGFuZCBtYWRlIGN1cnJlbnQgKGJlZm9yZSBpbnZva2luZyBmbikuICovXG4gICAgICBvblN0YXJ0PzogKHNwYW46IFNwYW5PYnNlcnZlcikgPT4gdm9pZDtcbiAgICAgIC8qKiBDYWxsZWQgYmVmb3JlIHNwYW4uZW5kKCkgd2l0aCByZXN1bHQvZXJyb3IuICovXG4gICAgICBvbkZpbmlzaD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIsIHJlc3VsdDogeyB2YWx1ZT86IHVua25vd247IGVycm9yPzogRXJyb3I7IHN1Y2Nlc3M6IGJvb2xlYW47IGR1cmF0aW9uTXM6IG51bWJlciB9KSA9PiB2b2lkO1xuICAgIH1cbiAgKTogUjtcbiAgc3RhdGljIHdyYXA8Uj4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZm46ICgpID0+IFIgfCBQcm9taXNlPFI+LFxuICAgIG9wdGlvbnM/OiBTcGFuT3B0aW9ucyAmIHtcbiAgICAgIC8qKiBDYWxsZWQgaW1tZWRpYXRlbHkgYWZ0ZXIgc3BhbiBpcyBjcmVhdGVkIGFuZCBtYWRlIGN1cnJlbnQgKGJlZm9yZSBpbnZva2luZyBmbikuICovXG4gICAgICBvblN0YXJ0PzogKHNwYW46IFNwYW5PYnNlcnZlcikgPT4gdm9pZDtcbiAgICAgIC8qKiBDYWxsZWQgYmVmb3JlIHNwYW4uZW5kKCkgd2l0aCByZXN1bHQvZXJyb3IuICovXG4gICAgICBvbkZpbmlzaD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIsIHJlc3VsdDogeyB2YWx1ZT86IHVua25vd247IGVycm9yPzogRXJyb3I7IHN1Y2Nlc3M6IGJvb2xlYW47IGR1cmF0aW9uTXM6IG51bWJlciB9KSA9PiB2b2lkO1xuICAgIH1cbiAgKTogUiB8IFByb21pc2U8Uj4ge1xuICAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgaWYgKCFjdHgpIHtcbiAgICAgIHJldHVybiBmbigpO1xuICAgIH1cblxuICAgIGNvbnN0IG9wdHMgPSBvcHRpb25zID8/IHt9O1xuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdHMpO1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICByZXR1cm4gd2l0aEN1cnJlbnRTcGFuKHNwYW4sICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG9wdHMub25TdGFydD8uKHNwYW4pO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBmbigpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyB2YWx1ZSwgc3VjY2VzczogdHJ1ZSwgZHVyYXRpb25NcyB9KTtcbiAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbm9ybWFsaXplRXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyBlcnJvcjogbm9ybWFsaXplZEVycm9yLCBzdWNjZXNzOiBmYWxzZSwgZHVyYXRpb25NcyB9KTtcbiAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciB9KTtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyB2YWx1ZTogcmVzdWx0LCBzdWNjZXNzOiB0cnVlLCBkdXJhdGlvbk1zIH0pO1xuICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChzeW5jRXJyb3IpIHtcbiAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IG5vcm1hbGl6ZUVycm9yKHN5bmNFcnJvcik7XG4gICAgICAgIG9wdHMub25GaW5pc2g/LihzcGFuLCB7IGVycm9yOiBub3JtYWxpemVkRXJyb3IsIHN1Y2Nlc3M6IGZhbHNlLCBkdXJhdGlvbk1zIH0pO1xuICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplZEVycm9yIH0pO1xuICAgICAgICB0aHJvdyBzeW5jRXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gU0VDT05EQVJZIEFQSTogd2l0aFNwYW4oKSAtIEV4cGxpY2l0IGFzeW5jIHdpdGggc3BhbiBhY2Nlc3NcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgLyoqXG4gICAqIEV4ZWN1dGUgYXN5bmMgZnVuY3Rpb24gd2l0aGluIGEgc3BhbiBzY29wZS5cbiAgICogVXNlIHdoZW4geW91IG5lZWQgYWNjZXNzIHRvIHRoZSBzcGFuIGluc3RhbmNlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhTcGFuPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge31cbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICBpZiAoIWN0eCkge1xuICAgICAgY29uc3QgZHVtbXlTcGFuID0gbmV3IFNwYW5PYnNlcnZlcihcbiAgICAgICAgZ2VuZXJhdGVJZCgpLCBvcGVyYXRpb24sIHVuZGVmaW5lZCwgZmFsc2UsIG9wdGlvbnMsIG9wdGlvbnMuY29ycmVsYXRpb25JZFxuICAgICAgKTtcbiAgICAgIHJldHVybiBmbihkdW1teVNwYW4pO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHdpdGhDdXJyZW50U3BhbihzcGFuLCBhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBmbihzcGFuKTtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSBzeW5jIGZ1bmN0aW9uIHdpdGhpbiBhIHNwYW4gc2NvcGUuXG4gICAqL1xuICBzdGF0aWMgd2l0aFNwYW5TeW5jPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiBULFxuICAgIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge31cbiAgKTogVCB7XG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICBpZiAoIWN0eCkge1xuICAgICAgY29uc3QgZHVtbXlTcGFuID0gbmV3IFNwYW5PYnNlcnZlcihcbiAgICAgICAgZ2VuZXJhdGVJZCgpLCBvcGVyYXRpb24sIHVuZGVmaW5lZCwgZmFsc2UsIG9wdGlvbnMsIG9wdGlvbnMuY29ycmVsYXRpb25JZFxuICAgICAgKTtcbiAgICAgIHJldHVybiBmbihkdW1teVNwYW4pO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHdpdGhDdXJyZW50U3BhbihzcGFuLCAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBmbihzcGFuKTtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gQURWQU5DRUQgQVBJOiBzdGFydCgpIC0gTWFudWFsIG1hbmFnZW1lbnQgKGF2b2lkIGluIG1vc3QgY2FzZXMpXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBTdGFydCBhIHNwYW4gd2l0aG91dCBhdXRvbWF0aWMgc2NvcGUgbWFuYWdlbWVudC5cbiAgICogV0FSTklORzogVGhpcyBkb2VzIE5PVCBzZXQgdGhlIHNwYW4gYXMgY3VycmVudCBpbiBjb250ZXh0LlxuICAgKiBQcmVmZXIgd3JhcCgpIG9yIHdpdGhTcGFuKCkgZm9yIHByb3BlciBwYXJlbnQgdHJhY2tpbmcuXG4gICAqL1xuICBzdGF0aWMgc3RhcnQob3BlcmF0aW9uOiBzdHJpbmcsIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge30pOiBTcGFuT2JzZXJ2ZXIge1xuICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEludGVybmFsOiBTcGFuIENyZWF0aW9uXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIHByaXZhdGUgc3RhdGljIGNyZWF0ZVNwYW4ob3BlcmF0aW9uOiBzdHJpbmcsIG9wdGlvbnM6IFNwYW5PcHRpb25zKTogU3Bhbk9ic2VydmVyIHtcbiAgICBjb25zdCBzdGF0ZSA9IGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpO1xuICAgIGNvbnN0IHBhcmVudCA9IHN0YXRlPy5jdXJyZW50U3BhbjtcbiAgICAvLyBJTVBPUlRBTlQ6IE9ic2VydmFiaWxpdHlMb2cgSURzIG11c3QgYmUgZ2xvYmFsbHkgdW5pcXVlIGluIER5bmFtb0RCLlxuICAgIC8vIFdlIG5hbWVzcGFjZSBJRHMgYnkgY29ycmVsYXRpb25JZCB0byBlbGltaW5hdGUgY29sbGlzaW9uIHJpc2sgYXQgc2NhbGUuXG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucy5jb3JyZWxhdGlvbklkID8/IGN0eD8uY29ycmVsYXRpb25JZDtcbiAgICBjb25zdCBpZCA9IGNvcnJlbGF0aW9uSWQgPyBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZChjb3JyZWxhdGlvbklkKSA6IGdlbmVyYXRlSWQoKTtcblxuICAgIGlmIChvcHRpb25zLnNraXBDYXB0dXJlKSB7XG4gICAgICByZXR1cm4gbmV3IFNwYW5PYnNlcnZlcihpZCwgb3BlcmF0aW9uLCBwYXJlbnQsIGZhbHNlLCBvcHRpb25zLCBjb3JyZWxhdGlvbklkLCB1bmRlZmluZWQpO1xuICAgIH1cblxuICAgIC8vIFBhcmVudCByZXNvbHV0aW9uOlxuICAgIC8vIC0gSWYgY2FsbGVyIGV4cGxpY2l0bHkgcHJvdmlkZXMgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIChpbmNsdWRpbmcgbnVsbCksIHVzZSBpdC5cbiAgICAvLyAtIE90aGVyd2lzZSBkZXJpdmUgZnJvbSBjdXJyZW50IGluLW1lbW9yeSBzcGFuIHRyZWUuXG4gICAgLy9cbiAgICAvLyBJTVBPUlRBTlQ6XG4gICAgLy8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGlzIHN0cmljdCBpbi1zbGljZSBoaWVyYXJjaHkuIERvIE5PVCBzZXQgaXQgdG8gYSByZW1vdGUgcGFyZW50LlxuICAgIGNvbnN0IGV4cGxpY2l0UGFyZW50ID0gb3B0aW9ucy5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgY29uc3QgZGVyaXZlZFBhcmVudExvZ0lkID0gcGFyZW50XG4gICAgICA/IChwYXJlbnQuY2FwdHVyZWQgPyBwYXJlbnQuaWQgOiBnZXRDYXB0dXJlZFBhcmVudElkKHBhcmVudCkpXG4gICAgICA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBwYXJlbnRMb2dJZCA9IGV4cGxpY2l0UGFyZW50ID09PSB1bmRlZmluZWRcbiAgICAgID8gZGVyaXZlZFBhcmVudExvZ0lkXG4gICAgICA6IChleHBsaWNpdFBhcmVudCA9PT0gbnVsbCA/IHVuZGVmaW5lZCA6IGV4cGxpY2l0UGFyZW50KTtcblxuICAgIGNvbnN0IHsgbGV2ZWwsIG1ldHJpY3MsIGRhdGEsIHNraXBDYXB0dXJlLCB0YWdzLCAuLi5vdmVycmlkZXMgfSA9IG9wdGlvbnM7XG5cbiAgICAvLyBFbWl0IHNwYW4uc3RhcnQgdG8gT1RFTCBvbmx5XG4gICAgLy8gVXNlIG51bGwgaWYgbm8gcGFyZW50IHRvIHByZXZlbnQgZmFsbGJhY2sgdG8gZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCgpXG4gICAgY2FwdHVyZVJlY29yZChPQlNFUlZFUl9OQU1FLCB7XG4gICAgICB0eXBlOiAnc3Bhbi5zdGFydCcsXG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBpZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogZXhwbGljaXRQYXJlbnQgPT09IHVuZGVmaW5lZCA/IChwYXJlbnRMb2dJZCA/PyBudWxsKSA6IGV4cGxpY2l0UGFyZW50LFxuICAgICAgbGV2ZWw6IGxldmVsID8/ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgdGFnczogbWVyZ2VUYWdzKHN0YXRlPy50YWdzLCB0YWdzKSxcbiAgICAgIGNhcHR1cmU6IHsgYmFja2VuZHM6IFsgJ290ZWwnIF0gfSxcbiAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNwYW4gPSBuZXcgU3Bhbk9ic2VydmVyKGlkLCBvcGVyYXRpb24sIHBhcmVudCwgdHJ1ZSwgb3B0aW9ucywgY29ycmVsYXRpb25JZCwgcGFyZW50TG9nSWQpO1xuICAgIHJlZ2lzdGVyU3BhbihzcGFuKTtcbiAgICByZXR1cm4gc3BhbjtcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBTdGF0aWMgVXRpbGl0aWVzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGN1cnJlbnRseSBhY3RpdmUgc3BhbiBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q3VycmVudFNwYW4oKTogU3Bhbk9ic2VydmVyIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjdXJyZW50ID0gZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlKCk/LmN1cnJlbnRTcGFuO1xuICAgIC8vIGN1cnJlbnRTcGFuIGlzIG9ubHkgZXZlciBzZXQgYnkgU3Bhbk9ic2VydmVyLCBidXQgd2Uga2VlcCB0aGUgcnVudGltZSBjaGVjayBjb25zZXJ2YXRpdmUuXG4gICAgcmV0dXJuIGN1cnJlbnQgaW5zdGFuY2VvZiBTcGFuT2JzZXJ2ZXIgPyBjdXJyZW50IDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIExpZmVjeWNsZTogZW5kKClcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgZW5kKG9wdGlvbnM/OiBTcGFuRW5kT3B0aW9ucyk6IHZvaWQge1xuICAgIGlmICh0aGlzLmVuZGVkKSByZXR1cm47XG4gICAgdGhpcy5lbmRlZCA9IHRydWU7XG5cbiAgICBpZiAoIXRoaXMuY2FwdHVyZWQpIHJldHVybjtcblxuICAgIGNvbnN0IGVuZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IGR1cmF0aW9uID0gZW5kVGltZSAtIHRoaXMuc3RhcnRUaW1lO1xuICAgIGNvbnN0IGhhc0Vycm9yID0gISFvcHRpb25zPy5lcnJvciB8fCBvcHRpb25zPy5zdWNjZXNzID09PSBmYWxzZTtcblxuICAgIGlmIChoYXNFcnJvcikge1xuICAgICAgdGhpcy5faGFzRXJyb3IgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIElNUE9SVEFOVDpcbiAgICAvLyBEbyBOT1QgZHJvcCBzcGFucyBoZXJlLlxuICAgIC8vXG4gICAgLy8gV2hldGhlciBhIHNwYW4gY2FuIGJlIGRyb3BwZWQgZGVwZW5kcyBvbiB3aGV0aGVyIGl0IGhhcyBhbnkgY2hpbGRyZW4gKGdyYXBoIHByb3BlcnR5KSxcbiAgICAvLyB3aGljaCBjYW4gb25seSBiZSBrbm93biByZWxpYWJseSBhdCBmbHVzaC10aW1lIG9uY2UgYWxsIGV2ZW50cyBhcmUgYnVmZmVyZWQuXG5cbiAgICBjb25zdCB7IGxldmVsLCBza2lwQ2FwdHVyZSwgbWV0cmljcywgZGF0YSwgdGFncywgLi4ub3ZlcnJpZGVzIH0gPSB0aGlzLm9wdGlvbnM7XG5cbiAgICAvLyBCdWlsZCBlcnJvciBpbmZvXG4gICAgbGV0IGVycm9ySW5mbzogT2JzZXJ2YWJpbGl0eUVycm9yIHwgdW5kZWZpbmVkO1xuICAgIGlmIChvcHRpb25zPy5lcnJvcikge1xuICAgICAgZXJyb3JJbmZvID0ge1xuICAgICAgICB0eXBlOiBvcHRpb25zLmVycm9yLm5hbWUsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgc3RhY2s6IG9wdGlvbnMuZXJyb3Iuc3RhY2ssXG4gICAgICAgIGNvZGU6ICdjb2RlJyBpbiBvcHRpb25zLmVycm9yICYmIHR5cGVvZiBvcHRpb25zLmVycm9yLmNvZGUgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBvcHRpb25zLmVycm9yLmNvZGVcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgZmluYWwgbWV0cmljcyAoZHVyYXRpb24gYWx3YXlzIGluY2x1ZGVkKVxuICAgIGNvbnN0IGZpbmFsTWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHtcbiAgICAgIGR1cmF0aW9uLFxuICAgICAgLi4udGhpcy5fbWV0cmljcyxcbiAgICAgIC4uLm9wdGlvbnM/Lm1ldHJpY3MsXG4gICAgfTtcblxuICAgIC8vIEJ1aWxkIGZpbmFsIGRhdGFcbiAgICBjb25zdCBmaW5hbERhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgLi4udGhpcy5fZGF0YSxcbiAgICAgIC4uLm9wdGlvbnM/LmRhdGEsXG4gICAgfTtcblxuICAgIC8vIE1hcmsgd2hldGhlciB0aGlzIHNwYW4gd2FzIFwiZW1wdHlcIiAobm8gdXNlZnVsIGNvbnRlbnQgYmV5b25kIHRpbWluZykuXG4gICAgLy8gRmx1c2gtdGltZSBsb2dpYyBjYW4gc2FmZWx5IGRyb3AgZW1wdHkgKmxlYWYqIHNwYW5zIHdoZW4gY29uZmlndXJlZC5cbiAgICBjb25zdCBpc0VtcHR5U3BhbiA9ICF0aGlzLmhhc0NvbnRlbnQgJiYgIWhhc0Vycm9yO1xuICAgIGlmIChpc0VtcHR5U3Bhbikge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBmaW5hbERhdGEuX2Z3MjQ7XG4gICAgICBjb25zdCBiYXNlID0gKGV4aXN0aW5nICYmIHR5cGVvZiBleGlzdGluZyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkoZXhpc3RpbmcpKVxuICAgICAgICA/IChleGlzdGluZyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgOiB7fTtcbiAgICAgIGZpbmFsRGF0YS5fZncyNCA9IHsgLi4uYmFzZSwgc3BhbkVtcHR5OiB0cnVlIH07XG4gICAgfVxuXG4gICAgLy8gQWRkIGNoZWNrcG9pbnRzIHRvIGRhdGEgaWYgYW55XG4gICAgaWYgKHRoaXMuX2NoZWNrcG9pbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbmFsRGF0YS5jaGVja3BvaW50cyA9IHRoaXMuX2NoZWNrcG9pbnRzO1xuICAgIH1cblxuICAgIC8vIEVtaXQgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkXG4gICAgLy8gQ1JJVElDQUw6IFBhc3MgbnVsbCBleHBsaWNpdGx5IGlmIG5vIHBhcmVudCB0byBwcmV2ZW50IGZhbGxiYWNrIHRvIGdldEN1cnJlbnRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQoKVxuICAgIC8vIHdoaWNoIHdvdWxkIHJldHVybiBUSElTIHNwYW4ncyBJRCAoY2F1c2luZyBzZWxmLXJlZmVyZW5jZSBidWcpXG4gICAgY29uc3QgY2FwdHVyZWRJZCA9IGNhcHR1cmVSZWNvcmQoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgLy8gSU1QT1JUQU5UOlxuICAgICAgLy8gU3BhbiBlbmQgY2FuIG9jY3VyIGFmdGVyIHRoZSBhc3luYyBleGVjdXRpb24gY29udGV4dCBoYXMgdW53b3VuZCAoQUxTIGJvdW5kYXJ5KSxcbiAgICAgIC8vIGVzcGVjaWFsbHkgaW4gcXVldWUvYmF0Y2ggcHJvY2Vzc29ycy4gU3RvcmUgY29ycmVsYXRpb25JZCBhdCBzcGFuIGNyZWF0aW9uIHRpbWUgYW5kXG4gICAgICAvLyBwYXNzIGl0IGV4cGxpY2l0bHkgc28gd2UgbmV2ZXIgZW5kIHVwIHdpdGggc3Bhbi5zdGFydCBidXQgbm8gc3BhbiByZWNvcmQuXG4gICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuaWQsXG4gICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5wYXJlbnRMb2dJZCA/PyBudWxsLFxuICAgICAgLy8gSU1QT1JUQU5UOlxuICAgICAgLy8gVXNlIHNwYW4gKnN0YXJ0KiB0aW1lc3RhbXAgZm9yIG9yZGVyaW5nIGluIER5bmFtb0RCL1VJLlxuICAgICAgLy8gRHVyYXRpb25NcyBzdGlsbCByZXByZXNlbnRzIGVuZC1zdGFydCwgc28gdGhlIGVuZCB0aW1lc3RhbXAgaXMgZGVyaXZhYmxlIGFzICh0aW1lc3RhbXBNcyArIGR1cmF0aW9uTXMpLlxuICAgICAgLy8gVXNpbmcgZW5kVGltZSBoZXJlIGNhdXNlcyBzcGFucyB0byBhcHBlYXIgYWZ0ZXIgdGhlaXIgY2hpbGRyZW4sIHdoaWNoIGJyZWFrcyB0aW1lbGluZSBvcmRlcmluZyBpbiB0aGUgVUkuXG4gICAgICB0aW1lc3RhbXBNczogdGhpcy5zdGFydFRpbWUsXG4gICAgICBkdXJhdGlvbk1zOiBkdXJhdGlvbixcbiAgICAgIG9wZXJhdGlvbjogdGhpcy5vcGVyYXRpb24sXG4gICAgICBzdWNjZXNzOiBvcHRpb25zPy5zdWNjZXNzID8/ICFvcHRpb25zPy5lcnJvcixcbiAgICAgIHN0YXR1czogb3B0aW9ucz8uc3RhdHVzID8/IChvcHRpb25zPy5lcnJvciA/ICdmYWlsZWQnIDogJ2NvbXBsZXRlZCcpLFxuICAgICAgdGFnczogdGhpcy5fdGFncyxcbiAgICAgIG1ldHJpY3M6IGZpbmFsTWV0cmljcyxcbiAgICAgIGRhdGE6IE9iamVjdC5rZXlzKGZpbmFsRGF0YSkubGVuZ3RoID4gMCA/IGZpbmFsRGF0YSA6IHVuZGVmaW5lZCxcbiAgICAgIGVycm9yOiBlcnJvckluZm8sXG4gICAgICBjYXB0dXJlOiB7XG4gICAgICAgIC4uLnRoaXMub3B0aW9ucy5jYXB0dXJlLFxuICAgICAgfSxcbiAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICB9KTtcblxuICAgIC8vIE5PVEU6IFNwYW4gcGFyZW50L2NoaWxkIGludGVncml0eSBpcyBlbmZvcmNlZCBhdCBmbHVzaC10aW1lIGJ5IGFuYWx5emluZyB0aGUgYnVmZmVyZWQgZ3JhcGguXG4gIH1cbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDb252ZW5pZW5jZSBFeHBvcnRzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGNvbnN0IHdpdGhTcGFuID0gU3Bhbk9ic2VydmVyLndpdGhTcGFuLmJpbmQoU3Bhbk9ic2VydmVyKTtcbmV4cG9ydCBjb25zdCB3aXRoU3BhblN5bmMgPSBTcGFuT2JzZXJ2ZXIud2l0aFNwYW5TeW5jLmJpbmQoU3Bhbk9ic2VydmVyKTtcbmV4cG9ydCBjb25zdCB3cmFwSW5TcGFuID0gU3Bhbk9ic2VydmVyLndyYXAuYmluZChTcGFuT2JzZXJ2ZXIpO1xuIl19