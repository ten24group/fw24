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
        this._checkpoints.push({ name, ts: Date.now() });
        if (options?.tags) {
            this.tags(options.tags);
        }
        if (options?.data) {
            this.setData(options.data);
        }
        if (options?.metrics) {
            this.metrics(options.metrics);
        }
        if (options?.error) {
            this.recordException(options.error);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUNHOzs7QUFHSCwwRUFLc0Q7QUFFdEQsaUNBS2dCO0FBQ2hCLDJDQUE2QztBQUM3QyxzQ0FBNEM7QUFDNUMsd0RBQW1FO0FBQ25FLG9EQUFtRjtBQVFuRjs7O0dBR0c7QUFDSCxTQUFTLGFBQWE7SUFDcEIsT0FBTyxJQUFBLDZDQUE2QixHQUFFLEVBQUUsS0FBSyxJQUFJLHdCQUFlLENBQUMsS0FBSyxDQUFDO0FBQ3pFLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sY0FBYyxHQUFHLElBQUksT0FBTyxFQUE2QixDQUFDO0FBRWhFLFNBQVMsWUFBWSxDQUFDLElBQWtCO0lBQ3RDLE1BQU0sR0FBRyxHQUFHLElBQUEsb0NBQTBCLEdBQUUsQ0FBQztJQUN6QyxJQUFJLENBQUMsR0FBRztRQUFFLE9BQU87SUFDakIsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7SUFDekMsTUFBTSxHQUFHLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNwQyxJQUFJLEdBQUc7UUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDOztRQUNsQixjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEdBQUcsQ0FBQyxDQUFFLElBQUksQ0FBRSxDQUFDLENBQUMsQ0FBQztBQUNsRCxDQUFDO0FBRUQsU0FBUyxrQ0FBa0M7SUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBQSxvQ0FBMEIsR0FBRSxDQUFDO0lBQ3pDLElBQUksQ0FBQyxHQUFHO1FBQUUsT0FBTztJQUNqQixNQUFNLEdBQUcsR0FBRyxjQUFjLENBQUMsR0FB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QUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7WUFDcEUsSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2hCLE9BQU8sRUFBRSxZQUFZO1lBQ3JCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUMvRCxLQUFLLEVBQUUsU0FBUztZQUNoQixPQUFPLEVBQUU7Z0JBQ1AsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU87YUFDeEI7WUFDRCxHQUFHLFNBQVM7U0FDYixDQUFDLENBQUM7UUFFSCwrRkFBK0Y7SUFDakcsQ0FBQztDQUNGO0FBaGZELG9DQWdmQztBQUVELDhFQUE4RTtBQUM5RSxzQkFBc0I7QUFDdEIsOEVBQThFO0FBRWpFLFFBQUEsUUFBUSxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ3BELFFBQUEsWUFBWSxHQUFHLFlBQVksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELFFBQUEsVUFBVSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTcGFuT2JzZXJ2ZXIgLSBEaXN0cmlidXRlZCBUcmFjaW5nIHdpdGggQ2xlYW4gRGF0YSBTZXBhcmF0aW9uXG4gKiBcbiAqIERFU0lHTiBQUklOQ0lQTEVTOlxuICogLSBDbGVhciBzZXBhcmF0aW9uOiB0YWdzIChpbmRleGFibGUpLCBtZXRyaWNzIChudW1lcmljKSwgZGF0YSAoZGVidWcgcGF5bG9hZCksIGNoZWNrcG9pbnRzICh0aW1lbGluZSlcbiAqIC0gU3Bhbk9ic2VydmVyIGluc3RhbmNlcyBmb3JtIGEgbGlua2VkIHRyZWUgdmlhIGBwYXJlbnRgIHJlZmVyZW5jZXNcbiAqIC0gYHdpdGhTcGFuKClgIC8gYHdyYXAoKWAgYXJlIHRoZSBQUklNQVJZIEFQSXMgLSBhdXRvbWF0aWMgc2NvcGUgbWFuYWdlbWVudFxuICogLSBDb25zb2xpZGF0aW9uOiBCeSBkZWZhdWx0LCBzcGFuLnN0YXJ0ICsgY29udGVudCArIGVuZCBhcmUgbWVyZ2VkIGludG8gT05FIHJlY29yZFxuICogXG4gKiBEQVRBIENPTkNFUFRTOlxuICogLSBUYWdzOiBzdHJpbmfihpJzdHJpbmcgcGFpcnMgZm9yIGZpbHRlcmluZy9pbmRleGluZyAob3JkZXJJZCwgdXNlcklkLCBzdGF0dXMpXG4gKiAtIE1ldHJpY3M6IHN0cmluZ+KGkm51bWJlciBwYWlycyBmb3IgZGFzaGJvYXJkcy9hbGVydHMgKGR1cmF0aW9uLCBjb3VudCwgc2l6ZSlcbiAqIC0gRGF0YTogYXJiaXRyYXJ5IHBheWxvYWQgZm9yIGRlYnVnZ2luZyAocmVxdWVzdCwgcmVzcG9uc2UsIGNvbnRleHQpXG4gKiAtIENoZWNrcG9pbnRzOiBzaW1wbGUgdGltZWxpbmUgb2Ygd2hhdCBoYXBwZW5lZCAodmFsaWRhdGlvbl9zdGFydCwgZGJfY29tcGxldGUpXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogYXdhaXQgd2l0aFNwYW4oJ3Byb2Nlc3NPcmRlcicsIGFzeW5jIChzcGFuKSA9PiB7XG4gKiAgIC8vIFRhZ3MgLSBmb3IgZmlsdGVyaW5nL3NlYXJjaGluZ1xuICogICBzcGFuLnRhZygnb3JkZXJJZCcsIG9yZGVyLmlkKTtcbiAqICAgc3Bhbi50YWcoJ3N0YXR1cycsICdwcm9jZXNzaW5nJyk7XG4gKiAgIFxuICogICAvLyBNZXRyaWNzIC0gZm9yIGRhc2hib2FyZHNcbiAqICAgc3Bhbi5tZXRyaWMoJ2l0ZW1Db3VudCcsIGl0ZW1zLmxlbmd0aCk7XG4gKiAgIFxuICogICAvLyBDaGVja3BvaW50cyAtIHRpbWVsaW5lXG4gKiAgIHNwYW4uY2hlY2twb2ludCgndmFsaWRhdGlvbl9jb21wbGV0ZScpO1xuICogICBzcGFuLmNoZWNrcG9pbnQoJ3BheW1lbnRfcHJvY2Vzc2VkJyk7XG4gKiAgIFxuICogICAvLyBEYXRhIC0gZGVidWcgcGF5bG9hZFxuICogICBzcGFuLnNldERhdGEoeyByZXF1ZXN0OiBib2R5LCByZXNwb25zZTogcmVzdWx0IH0pO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IElTcGFuTm9kZSB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dC90eXBlcyc7XG5pbXBvcnQge1xuICBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCxcbiAgZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlLFxuICB3aXRoQ3VycmVudFNwYW4sXG4gIGdldENhcHR1cmVkUGFyZW50SWQsXG59IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dC9zdG9yYWdlJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBSZWNvcmRPdmVycmlkZXMsIE9ic2VydmFiaWxpdHlFcnJvciwgU3BhbkNvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7XG4gIGdlbmVyYXRlSWQsXG4gIGNhcHR1cmVSZWNvcmQsXG4gIG5vcm1hbGl6ZUVycm9yLFxuICBtZXJnZVRhZ3MsXG59IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IENPTkZJR19ERUZBVUxUUyB9IGZyb20gJy4uL2NvbmZpZyc7XG5pbXBvcnQgeyBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZCB9IGZyb20gJy4uL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5pbXBvcnQgeyBnZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgc2V0U3BhbkZpbmFsaXplciB9IGZyb20gJy4uL3J1bnRpbWUtc3RhdGUnO1xuXG4vKiogQ2hlY2twb2ludCBlbnRyeSAtIHNpbXBsZSB0aW1lbGluZSBtYXJrZXIgKi9cbmludGVyZmFjZSBDaGVja3BvaW50IHtcbiAgbmFtZTogc3RyaW5nO1xuICB0czogbnVtYmVyO1xufVxuXG4vKiogXG4gKiBHZXQgc3BhbiBjb25maWcgZnJvbSBPYnNlcnZhYmlsaXR5TWFuYWdlciAoYWxyZWFkeSBjYWNoZWQpLlxuICogUmV0dXJucyBlbXB0eSBvYmplY3QgaWYgbm90IGluaXRpYWxpemVkIHlldC5cbiAqL1xuZnVuY3Rpb24gZ2V0U3BhbkNvbmZpZygpOiBTcGFuQ29uZmlnIHtcbiAgcmV0dXJuIGdldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKCk/LnNwYW5zID8/IENPTkZJR19ERUZBVUxUUy5zcGFucztcbn1cblxuLyoqXG4gKiBUcmFjayBzcGFucyBwZXIgZXhlY3V0aW9uIGNvbnRleHQgc28gZmx1c2goKSBjYW4gZm9yY2UtZW5kIGFueSBzcGFucyBsZWZ0IG9wZW4uXG4gKlxuICogVGhpcyBpcyB0aGUgY29yZSBmaXggZm9yIFwibWlzc2luZyBwYXJlbnQgc3BhblwiOlxuICogLSBhIHBhcmVudCBzcGFuIG1pZ2h0IG5vdCBoYXZlIGVuZGVkIHdoZW4gZmx1c2ggcnVuc1xuICogLSBvciBhIHBhcmVudCBzcGFuIG1pZ2h0IGVuZCBcImVtcHR5XCIgYW5kIGJlIGRyb3BwYWJsZSBkZXBlbmRpbmcgb24gY2hpbGRyZW5cbiAqXG4gKiBXZSBzb2x2ZSB0aGlzIGJ5OlxuICogLSByZWNvcmRpbmcgc3BhbnMgcGVyIGNvbnRleHRcbiAqIC0gZm9yY2UtZW5kaW5nIGFueSBzdGlsbC1vcGVuIHNwYW5zIGF0IGZsdXNoXG4gKiAtIGRlZmVycmluZyB0aGUgZHJvcCBkZWNpc2lvbiB0byBmbHVzaC10aW1lIGdyYXBoIGFuYWx5c2lzIChub3QgaW4gU3Bhbk9ic2VydmVyLmVuZCgpKS5cbiAqL1xuY29uc3Qgc3BhbnNCeUNvbnRleHQgPSBuZXcgV2Vha01hcDxvYmplY3QsIFNldDxTcGFuT2JzZXJ2ZXI+PigpO1xuXG5mdW5jdGlvbiByZWdpc3RlclNwYW4oc3BhbjogU3Bhbk9ic2VydmVyKTogdm9pZCB7XG4gIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gIGlmICghY3R4KSByZXR1cm47XG4gIGNvbnN0IGtleSA9IGN0eC5vYnNlcnZhYmlsaXR5LmNvbnRleHRLZXk7XG4gIGNvbnN0IHNldCA9IHNwYW5zQnlDb250ZXh0LmdldChrZXkpO1xuICBpZiAoc2V0KSBzZXQuYWRkKHNwYW4pO1xuICBlbHNlIHNwYW5zQnlDb250ZXh0LnNldChrZXksIG5ldyBTZXQoWyBzcGFuIF0pKTtcbn1cblxuZnVuY3Rpb24gZmluYWxpemVPcGVuU3BhbnNGb3JDdXJyZW50Q29udGV4dCgpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgaWYgKCFjdHgpIHJldHVybjtcbiAgY29uc3Qgc2V0ID0gc3BhbnNCeUNvbnRleHQuZ2V0KGN0eC5vYnNlcnZhYmlsaXR5LmNvbnRleHRLZXkpO1xuICBpZiAoIXNldCkgcmV0dXJuO1xuXG4gIGZvciAoY29uc3Qgc3BhbiBvZiBzZXQpIHtcbiAgICBpZiAoIXNwYW4uZW5kZWQpIHtcbiAgICAgIC8vIEZvcmNlLWNsb3NlOiBhIHNwYW4gbGVmdCBvcGVuIHVudGlsIGZsdXNoIGlzIGEgYnVnIGluIHVzZXIgY29kZSBvciBmcmFtZXdvcmsgd2lyaW5nLlxuICAgICAgLy8gV2UgZW5kIGl0IGFzIFwiYWJhbmRvbmVkXCIgc28gaXQgaXMgdmlzaWJsZSBhbmQgZG9lcyBub3QgYnJlYWsgaGllcmFyY2h5LlxuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgc3RhdHVzOiAnYWJhbmRvbmVkJyB9KTtcbiAgICB9XG4gIH1cbn1cblxuLy8gUmVnaXN0ZXIgZmluYWxpemVyIHNvIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCkgY2FuIGNhbGwgaXQgd2l0aG91dCBpbXBvcnRpbmcgU3Bhbk9ic2VydmVyIChhdm9pZCBjeWNsZXMpLlxuc2V0U3BhbkZpbmFsaXplcihmaW5hbGl6ZU9wZW5TcGFuc0ZvckN1cnJlbnRDb250ZXh0KTtcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdTcGFuT2JzZXJ2ZXInKTtcbmNvbnN0IE9CU0VSVkVSX05BTUUgPSAnU3Bhbk9ic2VydmVyJztcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBUeXBlc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogT3B0aW9ucyBmb3Igc3RhcnRpbmcgYSBzcGFuLlxuICogRXh0ZW5kcyBSZWNvcmRPdmVycmlkZXMgZm9yIGFsbCBjb250ZXh0IG92ZXJyaWRlIGNhcGFiaWxpdGllcy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGFuT3B0aW9ucyBleHRlbmRzIFJlY29yZE92ZXJyaWRlcyB7XG4gIC8qKiBTZXZlcml0eSBsZXZlbCBmb3IgdGhlIHNwYW4gKi9cbiAgbGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmc7XG4gIC8qKiBJbml0aWFsIG1ldHJpY3MgKHN0cmluZ+KGkm51bWJlciBmb3IgYWdncmVnYXRpb24pICovXG4gIG1ldHJpY3M/OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAvKiogSW5pdGlhbCBkYXRhIChkZWJ1ZyBwYXlsb2FkKSAqL1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIC8qKiBTa2lwIGNhcHR1cmluZyBlbnRpcmVseSAoZm9yIGF1ZGl0LW9ubHkgb3IgbWV0cmljLW9ubHkgc2NlbmFyaW9zKSAqL1xuICBza2lwQ2FwdHVyZT86IGJvb2xlYW47XG59XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgZW5kaW5nIGEgc3BhblxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwYW5FbmRPcHRpb25zIHtcbiAgLyoqIFdoZXRoZXIgdGhlIG9wZXJhdGlvbiBzdWNjZWVkZWQgKi9cbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIC8qKiBFcnJvciBpZiBvcGVyYXRpb24gZmFpbGVkICovXG4gIGVycm9yPzogRXJyb3I7XG4gIC8qKiBDdXN0b20gc3RhdHVzIHN0cmluZyAqL1xuICBzdGF0dXM/OiBzdHJpbmc7XG4gIC8qKiBBZGRpdGlvbmFsIGRhdGEgdG8gbWVyZ2UgKi9cbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogQWRkaXRpb25hbCBtZXRyaWNzIHRvIG1lcmdlICovXG4gIG1ldHJpY3M/OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xufVxuXG4vKipcbiAqIEludGVyZmFjZSBmb3Igc3BhbiBvcGVyYXRpb25zXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVNwYW5PYnNlcnZlciBleHRlbmRzIElTcGFuTm9kZSB7XG4gIHJlYWRvbmx5IGlkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG9wZXJhdGlvbjogc3RyaW5nO1xuICByZWFkb25seSBjYXB0dXJlZDogYm9vbGVhbjtcbiAgcmVhZG9ubHkgdHJhY2VJZDogc3RyaW5nO1xuICByZWFkb25seSBwYXJlbnRMb2dJZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIC8vIENsZWFuIEFQSVxuICB0YWcoa2V5OiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuKTogdGhpcztcbiAgdGFncyh0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPik6IHRoaXM7XG4gIG1ldHJpYyhrZXk6IHN0cmluZywgdmFsdWU6IG51bWJlcik6IHRoaXM7XG4gIG1ldHJpY3MobWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPik6IHRoaXM7XG4gIHNldERhdGEoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzO1xuICBjaGVja3BvaW50KG5hbWU6IHN0cmluZywgb3B0aW9ucz86IHtcbiAgICBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgZXJyb3I/OiBFcnJvciB8IHN0cmluZztcbiAgfSk6IHRoaXM7XG5cbiAgLy8gTGlmZWN5Y2xlXG4gIGVuZChvcHRpb25zPzogU3BhbkVuZE9wdGlvbnMpOiB2b2lkO1xuXG4gIC8vIEVycm9yIGhhbmRsaW5nXG4gIHJlY29yZEV4Y2VwdGlvbihleGNlcHRpb246IEVycm9yIHwgc3RyaW5nKTogdGhpcztcbn1cblxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFNwYW5PYnNlcnZlciBJbXBsZW1lbnRhdGlvblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBTcGFuT2JzZXJ2ZXIgaW1wbGVtZW50cyBJU3Bhbk9ic2VydmVyIHtcbiAgcmVhZG9ubHkgaWQ6IHN0cmluZztcbiAgcmVhZG9ubHkgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHBhcmVudD86IElTcGFuTm9kZTtcbiAgcmVhZG9ubHkgY2FwdHVyZWQ6IGJvb2xlYW47XG4gIHJlYWRvbmx5IHBhcmVudExvZ0lkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgY29ycmVsYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogU3Bhbk9wdGlvbnM7XG4gIHByaXZhdGUgcmVhZG9ubHkgbGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBzdGFydFRpbWU6IG51bWJlcjtcblxuICAvLyBDbGVhbiBkYXRhIHN0b3JhZ2VcbiAgcHJpdmF0ZSBfdGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBwcml2YXRlIF9tZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gIHByaXZhdGUgX2RhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gIHByaXZhdGUgX2NoZWNrcG9pbnRzOiBDaGVja3BvaW50W10gPSBbXTtcblxuICAvLyBTdGF0ZSB0cmFja2luZ1xuICBwcml2YXRlIF9oYXNFcnJvciA9IGZhbHNlO1xuICAvLyBOT1RFOiBXZSBubyBsb25nZXIgbXV0YXRlIHNwYW5zIHRvIHRyYWNrIFwiaGFzIGNoaWxkcmVuXCIuXG4gIC8vIFBhcmVudC9zcGFuIGludGVncml0eSBpcyBoYW5kbGVkIGNlbnRyYWxseSB2aWEgZXhwbGljaXQgcmVmZXJlbmNlIHRyYWNraW5nIGluIGV4ZWN1dGlvbi1jb250ZXh0IHN0YXRlLlxuICAvLyBOT1RFOiBVc2VkIGJ5IHRoZSBmbHVzaC10aW1lIHNwYW4gZmluYWxpemVyIHRvIGNsb3NlIHNwYW5zIGxlZnQgb3BlbiBieSB1c2VyL2ZyYW1ld29yayBjb2RlLlxuICBwdWJsaWMgZW5kZWQgPSBmYWxzZTtcblxuICBwcml2YXRlIGNvbnN0cnVjdG9yKFxuICAgIGlkOiBzdHJpbmcsXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgcGFyZW50OiBJU3Bhbk5vZGUgfCB1bmRlZmluZWQsXG4gICAgY2FwdHVyZWQ6IGJvb2xlYW4sXG4gICAgb3B0aW9uczogU3Bhbk9wdGlvbnMsXG4gICAgY29ycmVsYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHBhcmVudExvZ0lkVmFsOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWRcbiAgKSB7XG4gICAgdGhpcy5pZCA9IGlkO1xuICAgIHRoaXMub3BlcmF0aW9uID0gb3BlcmF0aW9uO1xuICAgIHRoaXMucGFyZW50ID0gcGFyZW50O1xuICAgIHRoaXMuY2FwdHVyZWQgPSBjYXB0dXJlZDtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMuY29ycmVsYXRpb25JZCA9IGNvcnJlbGF0aW9uSWQ7XG4gICAgdGhpcy5sZXZlbCA9IG9wdGlvbnMubGV2ZWwgPz8gJ2luZm8nO1xuICAgIHRoaXMuc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLnBhcmVudExvZ0lkID0gcGFyZW50TG9nSWRWYWw7XG5cbiAgICAvLyBJbml0aWFsaXplIGZyb20gb3B0aW9uc1xuICAgIGlmIChvcHRpb25zLnRhZ3MpIHtcbiAgICAgIHRoaXMuX3RhZ3MgPSB7IC4uLm9wdGlvbnMudGFncyB9O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5tZXRyaWNzKSB7XG4gICAgICB0aGlzLl9tZXRyaWNzID0geyAuLi5vcHRpb25zLm1ldHJpY3MgfTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuZGF0YSkge1xuICAgICAgdGhpcy5fZGF0YSA9IHsgLi4ub3B0aW9ucy5kYXRhIH07XG4gICAgfVxuICB9XG5cbiAgZ2V0IHRyYWNlSWQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICAgIHJldHVybiB0aGlzLmNvcnJlbGF0aW9uSWQgPz8gdGhpcy5vcHRpb25zLmNvcnJlbGF0aW9uSWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkID8/ICcnO1xuICB9XG5cbiAgLyoqIENoZWNrIGlmIHNwYW4gaGFzIGFueSBjb250ZW50IHdvcnRoIGNhcHR1cmluZyAqL1xuICBnZXQgaGFzQ29udGVudCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5fY2hlY2twb2ludHMubGVuZ3RoID4gMFxuICAgICAgfHwgdGhpcy5faGFzRXJyb3JcbiAgICAgIHx8IE9iamVjdC5rZXlzKHRoaXMuX3RhZ3MpLmxlbmd0aCA+IDBcbiAgICAgIHx8IE9iamVjdC5rZXlzKHRoaXMuX21ldHJpY3MpLmxlbmd0aCA+IDBcbiAgICAgIHx8IE9iamVjdC5rZXlzKHRoaXMuX2RhdGEpLmxlbmd0aCA+IDA7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gQ0xFQU4gQVBJOiBUYWdzLCBNZXRyaWNzLCBEYXRhLCBDaGVja3BvaW50c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICAvKipcbiAgICogU2V0IGEgdGFnIGZvciBpbmRleGluZy9maWx0ZXJpbmcuXG4gICAqIFRhZ3MgYXJlIHN0cmluZyBrZXktdmFsdWUgcGFpcnMgdGhhdCBjYW4gYmUgc2VhcmNoZWQuXG4gICAqL1xuICB0YWcoa2V5OiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuKTogdGhpcyB7XG4gICAgdGhpcy5fdGFnc1sga2V5IF0gPSBTdHJpbmcodmFsdWUpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBtdWx0aXBsZSB0YWdzIGF0IG9uY2UuXG4gICAqL1xuICB0YWdzKHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+KTogdGhpcyB7XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyh0YWdzKSkge1xuICAgICAgdGhpcy5fdGFnc1sga2V5IF0gPSBTdHJpbmcodmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYSBudW1lcmljIG1ldHJpYyBmb3IgZGFzaGJvYXJkcy9hZ2dyZWdhdGlvbi5cbiAgICovXG4gIG1ldHJpYyhrZXk6IHN0cmluZywgdmFsdWU6IG51bWJlcik6IHRoaXMge1xuICAgIHRoaXMuX21ldHJpY3NbIGtleSBdID0gdmFsdWU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIG11bHRpcGxlIG1ldHJpY3MgYXQgb25jZS5cbiAgICovXG4gIG1ldHJpY3MobWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPik6IHRoaXMge1xuICAgIE9iamVjdC5hc3NpZ24odGhpcy5fbWV0cmljcywgbWV0cmljcyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGRlYnVnIGRhdGEgcGF5bG9hZC5cbiAgICogRGF0YSBpcyBOT1QgaW5kZXhlZCAtIHVzZSBmb3IgZGVidWdnaW5nIGluc3BlY3Rpb24gb25seS5cbiAgICovXG4gIHNldERhdGEoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzIHtcbiAgICBPYmplY3QuYXNzaWduKHRoaXMuX2RhdGEsIGRhdGEpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBhIGNoZWNrcG9pbnQgdG8gdGhlIHRpbWVsaW5lLlxuICAgKiBDaGVja3BvaW50cyBhcmUgc2ltcGxlIG1hcmtlcnMgb2Ygd2hhdCBoYXBwZW5lZCB3aGVuLlxuICAgKi9cbiAgY2hlY2twb2ludChuYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiB7XG4gICAgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIGVycm9yPzogRXJyb3IgfCBzdHJpbmc7XG4gIH0pOiB0aGlzIHtcbiAgICBpZiAoIXRoaXMuY2FwdHVyZWQpIHJldHVybiB0aGlzO1xuICAgIHRoaXMuX2NoZWNrcG9pbnRzLnB1c2goeyBuYW1lLCB0czogRGF0ZS5ub3coKSB9KTtcblxuICAgIGlmIChvcHRpb25zPy50YWdzKSB7XG4gICAgICB0aGlzLnRhZ3Mob3B0aW9ucy50YWdzKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnM/LmRhdGEpIHtcbiAgICAgIHRoaXMuc2V0RGF0YShvcHRpb25zLmRhdGEpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucz8ubWV0cmljcykge1xuICAgICAgdGhpcy5tZXRyaWNzKG9wdGlvbnMubWV0cmljcyk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zPy5lcnJvcikge1xuICAgICAgdGhpcy5yZWNvcmRFeGNlcHRpb24ob3B0aW9ucy5lcnJvcik7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEVycm9yIEhhbmRsaW5nXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYW4gZXhjZXB0aW9uIG9uIHRoaXMgc3Bhbi5cbiAgICogTWFya3MgdGhlIHNwYW4gYXMgaGF2aW5nIGFuIGVycm9yIGFuZCBjYXB0dXJlcyBleGNlcHRpb24gZGV0YWlscy5cbiAgICovXG4gIHJlY29yZEV4Y2VwdGlvbihleGNlcHRpb246IEVycm9yIHwgc3RyaW5nKTogdGhpcyB7XG4gICAgY29uc3QgZXJyb3IgPSBub3JtYWxpemVFcnJvcihleGNlcHRpb24pO1xuICAgIHRoaXMuX2hhc0Vycm9yID0gdHJ1ZTtcbiAgICB0aGlzLmNoZWNrcG9pbnQoJ2V4Y2VwdGlvbicpO1xuICAgIHRoaXMuX2RhdGFbICdleGNlcHRpb24nIF0gPSB7XG4gICAgICB0eXBlOiBlcnJvci5uYW1lLFxuICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgIHN0YWNrOiBlcnJvci5zdGFjayxcbiAgICB9O1xuICAgIHRoaXMuX3RhZ3NbICdlcnJvcicgXSA9ICd0cnVlJztcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBQUklNQVJZIEFQSTogd3JhcCgpIC0gSGFuZGxlcyBib3RoIHN5bmMgYW5kIGFzeW5jIGF1dG9tYXRpY2FsbHlcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgLyoqXG4gICAqIFdyYXAgYSBmdW5jdGlvbiBpbiBhIHNwYW4gLSBoYW5kbGVzIGJvdGggc3luYyBhbmQgYXN5bmMgYXV0b21hdGljYWxseS5cbiAgICogVGhpcyBpcyB0aGUgUFJFRkVSUkVEIEFQSSBmb3IgZGVjb3JhdG9ycyBhbmQgdW5rbm93biBzeW5jL2FzeW5jIHNpdHVhdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgd3JhcDxSPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKCkgPT4gUHJvbWlzZTxSPixcbiAgICBvcHRpb25zPzogU3Bhbk9wdGlvbnMgJiB7XG4gICAgICAvKiogQ2FsbGVkIGltbWVkaWF0ZWx5IGFmdGVyIHNwYW4gaXMgY3JlYXRlZCBhbmQgbWFkZSBjdXJyZW50IChiZWZvcmUgaW52b2tpbmcgZm4pLiAqL1xuICAgICAgb25TdGFydD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIpID0+IHZvaWQ7XG4gICAgICAvKiogQ2FsbGVkIGJlZm9yZSBzcGFuLmVuZCgpIHdpdGggcmVzdWx0L2Vycm9yLiAqL1xuICAgICAgb25GaW5pc2g/OiAoc3BhbjogU3Bhbk9ic2VydmVyLCByZXN1bHQ6IHsgdmFsdWU/OiB1bmtub3duOyBlcnJvcj86IEVycm9yOyBzdWNjZXNzOiBib29sZWFuOyBkdXJhdGlvbk1zOiBudW1iZXIgfSkgPT4gdm9pZDtcbiAgICB9XG4gICk6IFByb21pc2U8Uj47XG4gIHN0YXRpYyB3cmFwPFI+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBSLFxuICAgIG9wdGlvbnM/OiBTcGFuT3B0aW9ucyAmIHtcbiAgICAgIC8qKiBDYWxsZWQgaW1tZWRpYXRlbHkgYWZ0ZXIgc3BhbiBpcyBjcmVhdGVkIGFuZCBtYWRlIGN1cnJlbnQgKGJlZm9yZSBpbnZva2luZyBmbikuICovXG4gICAgICBvblN0YXJ0PzogKHNwYW46IFNwYW5PYnNlcnZlcikgPT4gdm9pZDtcbiAgICAgIC8qKiBDYWxsZWQgYmVmb3JlIHNwYW4uZW5kKCkgd2l0aCByZXN1bHQvZXJyb3IuICovXG4gICAgICBvbkZpbmlzaD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIsIHJlc3VsdDogeyB2YWx1ZT86IHVua25vd247IGVycm9yPzogRXJyb3I7IHN1Y2Nlc3M6IGJvb2xlYW47IGR1cmF0aW9uTXM6IG51bWJlciB9KSA9PiB2b2lkO1xuICAgIH1cbiAgKTogUjtcbiAgc3RhdGljIHdyYXA8Uj4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZm46ICgpID0+IFIgfCBQcm9taXNlPFI+LFxuICAgIG9wdGlvbnM/OiBTcGFuT3B0aW9ucyAmIHtcbiAgICAgIC8qKiBDYWxsZWQgaW1tZWRpYXRlbHkgYWZ0ZXIgc3BhbiBpcyBjcmVhdGVkIGFuZCBtYWRlIGN1cnJlbnQgKGJlZm9yZSBpbnZva2luZyBmbikuICovXG4gICAgICBvblN0YXJ0PzogKHNwYW46IFNwYW5PYnNlcnZlcikgPT4gdm9pZDtcbiAgICAgIC8qKiBDYWxsZWQgYmVmb3JlIHNwYW4uZW5kKCkgd2l0aCByZXN1bHQvZXJyb3IuICovXG4gICAgICBvbkZpbmlzaD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIsIHJlc3VsdDogeyB2YWx1ZT86IHVua25vd247IGVycm9yPzogRXJyb3I7IHN1Y2Nlc3M6IGJvb2xlYW47IGR1cmF0aW9uTXM6IG51bWJlciB9KSA9PiB2b2lkO1xuICAgIH1cbiAgKTogUiB8IFByb21pc2U8Uj4ge1xuICAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgaWYgKCFjdHgpIHtcbiAgICAgIHJldHVybiBmbigpO1xuICAgIH1cblxuICAgIGNvbnN0IG9wdHMgPSBvcHRpb25zID8/IHt9O1xuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdHMpO1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICByZXR1cm4gd2l0aEN1cnJlbnRTcGFuKHNwYW4sICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIG9wdHMub25TdGFydD8uKHNwYW4pO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBmbigpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyB2YWx1ZSwgc3VjY2VzczogdHJ1ZSwgZHVyYXRpb25NcyB9KTtcbiAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbm9ybWFsaXplRXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyBlcnJvcjogbm9ybWFsaXplZEVycm9yLCBzdWNjZXNzOiBmYWxzZSwgZHVyYXRpb25NcyB9KTtcbiAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciB9KTtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyB2YWx1ZTogcmVzdWx0LCBzdWNjZXNzOiB0cnVlLCBkdXJhdGlvbk1zIH0pO1xuICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChzeW5jRXJyb3IpIHtcbiAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IG5vcm1hbGl6ZUVycm9yKHN5bmNFcnJvcik7XG4gICAgICAgIG9wdHMub25GaW5pc2g/LihzcGFuLCB7IGVycm9yOiBub3JtYWxpemVkRXJyb3IsIHN1Y2Nlc3M6IGZhbHNlLCBkdXJhdGlvbk1zIH0pO1xuICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplZEVycm9yIH0pO1xuICAgICAgICB0aHJvdyBzeW5jRXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gU0VDT05EQVJZIEFQSTogd2l0aFNwYW4oKSAtIEV4cGxpY2l0IGFzeW5jIHdpdGggc3BhbiBhY2Nlc3NcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgLyoqXG4gICAqIEV4ZWN1dGUgYXN5bmMgZnVuY3Rpb24gd2l0aGluIGEgc3BhbiBzY29wZS5cbiAgICogVXNlIHdoZW4geW91IG5lZWQgYWNjZXNzIHRvIHRoZSBzcGFuIGluc3RhbmNlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhTcGFuPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge31cbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICBpZiAoIWN0eCkge1xuICAgICAgY29uc3QgZHVtbXlTcGFuID0gbmV3IFNwYW5PYnNlcnZlcihcbiAgICAgICAgZ2VuZXJhdGVJZCgpLCBvcGVyYXRpb24sIHVuZGVmaW5lZCwgZmFsc2UsIG9wdGlvbnMsIG9wdGlvbnMuY29ycmVsYXRpb25JZFxuICAgICAgKTtcbiAgICAgIHJldHVybiBmbihkdW1teVNwYW4pO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHdpdGhDdXJyZW50U3BhbihzcGFuLCBhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBmbihzcGFuKTtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRXhlY3V0ZSBzeW5jIGZ1bmN0aW9uIHdpdGhpbiBhIHNwYW4gc2NvcGUuXG4gICAqL1xuICBzdGF0aWMgd2l0aFNwYW5TeW5jPFQ+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiBULFxuICAgIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge31cbiAgKTogVCB7XG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICBpZiAoIWN0eCkge1xuICAgICAgY29uc3QgZHVtbXlTcGFuID0gbmV3IFNwYW5PYnNlcnZlcihcbiAgICAgICAgZ2VuZXJhdGVJZCgpLCBvcGVyYXRpb24sIHVuZGVmaW5lZCwgZmFsc2UsIG9wdGlvbnMsIG9wdGlvbnMuY29ycmVsYXRpb25JZFxuICAgICAgKTtcbiAgICAgIHJldHVybiBmbihkdW1teVNwYW4pO1xuICAgIH1cblxuICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHdpdGhDdXJyZW50U3BhbihzcGFuLCAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBmbihzcGFuKTtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZUVycm9yKGVycm9yKSB9KTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gQURWQU5DRUQgQVBJOiBzdGFydCgpIC0gTWFudWFsIG1hbmFnZW1lbnQgKGF2b2lkIGluIG1vc3QgY2FzZXMpXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBTdGFydCBhIHNwYW4gd2l0aG91dCBhdXRvbWF0aWMgc2NvcGUgbWFuYWdlbWVudC5cbiAgICogV0FSTklORzogVGhpcyBkb2VzIE5PVCBzZXQgdGhlIHNwYW4gYXMgY3VycmVudCBpbiBjb250ZXh0LlxuICAgKiBQcmVmZXIgd3JhcCgpIG9yIHdpdGhTcGFuKCkgZm9yIHByb3BlciBwYXJlbnQgdHJhY2tpbmcuXG4gICAqL1xuICBzdGF0aWMgc3RhcnQob3BlcmF0aW9uOiBzdHJpbmcsIG9wdGlvbnM6IFNwYW5PcHRpb25zID0ge30pOiBTcGFuT2JzZXJ2ZXIge1xuICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIuY3JlYXRlU3BhbihvcGVyYXRpb24sIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEludGVybmFsOiBTcGFuIENyZWF0aW9uXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIHByaXZhdGUgc3RhdGljIGNyZWF0ZVNwYW4ob3BlcmF0aW9uOiBzdHJpbmcsIG9wdGlvbnM6IFNwYW5PcHRpb25zKTogU3Bhbk9ic2VydmVyIHtcbiAgICBjb25zdCBzdGF0ZSA9IGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpO1xuICAgIGNvbnN0IHBhcmVudCA9IHN0YXRlPy5jdXJyZW50U3BhbjtcbiAgICAvLyBJTVBPUlRBTlQ6IE9ic2VydmFiaWxpdHlMb2cgSURzIG11c3QgYmUgZ2xvYmFsbHkgdW5pcXVlIGluIER5bmFtb0RCLlxuICAgIC8vIFdlIG5hbWVzcGFjZSBJRHMgYnkgY29ycmVsYXRpb25JZCB0byBlbGltaW5hdGUgY29sbGlzaW9uIHJpc2sgYXQgc2NhbGUuXG4gICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucy5jb3JyZWxhdGlvbklkID8/IGN0eD8uY29ycmVsYXRpb25JZDtcbiAgICBjb25zdCBpZCA9IGNvcnJlbGF0aW9uSWQgPyBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZChjb3JyZWxhdGlvbklkKSA6IGdlbmVyYXRlSWQoKTtcblxuICAgIGlmIChvcHRpb25zLnNraXBDYXB0dXJlKSB7XG4gICAgICByZXR1cm4gbmV3IFNwYW5PYnNlcnZlcihpZCwgb3BlcmF0aW9uLCBwYXJlbnQsIGZhbHNlLCBvcHRpb25zLCBjb3JyZWxhdGlvbklkLCB1bmRlZmluZWQpO1xuICAgIH1cblxuICAgIC8vIFBhcmVudCByZXNvbHV0aW9uOlxuICAgIC8vIC0gSWYgY2FsbGVyIGV4cGxpY2l0bHkgcHJvdmlkZXMgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIChpbmNsdWRpbmcgbnVsbCksIHVzZSBpdC5cbiAgICAvLyAtIE90aGVyd2lzZSBkZXJpdmUgZnJvbSBjdXJyZW50IGluLW1lbW9yeSBzcGFuIHRyZWUuXG4gICAgLy9cbiAgICAvLyBJTVBPUlRBTlQ6XG4gICAgLy8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGlzIHN0cmljdCBpbi1zbGljZSBoaWVyYXJjaHkuIERvIE5PVCBzZXQgaXQgdG8gYSByZW1vdGUgcGFyZW50LlxuICAgIGNvbnN0IGV4cGxpY2l0UGFyZW50ID0gb3B0aW9ucy5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgY29uc3QgZGVyaXZlZFBhcmVudExvZ0lkID0gcGFyZW50XG4gICAgICA/IChwYXJlbnQuY2FwdHVyZWQgPyBwYXJlbnQuaWQgOiBnZXRDYXB0dXJlZFBhcmVudElkKHBhcmVudCkpXG4gICAgICA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBwYXJlbnRMb2dJZCA9IGV4cGxpY2l0UGFyZW50ID09PSB1bmRlZmluZWRcbiAgICAgID8gZGVyaXZlZFBhcmVudExvZ0lkXG4gICAgICA6IChleHBsaWNpdFBhcmVudCA9PT0gbnVsbCA/IHVuZGVmaW5lZCA6IGV4cGxpY2l0UGFyZW50KTtcblxuICAgIGNvbnN0IHsgbGV2ZWwsIG1ldHJpY3MsIGRhdGEsIHNraXBDYXB0dXJlLCB0YWdzLCAuLi5vdmVycmlkZXMgfSA9IG9wdGlvbnM7XG5cbiAgICAvLyBFbWl0IHNwYW4uc3RhcnQgdG8gT1RFTCBvbmx5XG4gICAgLy8gVXNlIG51bGwgaWYgbm8gcGFyZW50IHRvIHByZXZlbnQgZmFsbGJhY2sgdG8gZ2V0Q3VycmVudFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCgpXG4gICAgY2FwdHVyZVJlY29yZChPQlNFUlZFUl9OQU1FLCB7XG4gICAgICB0eXBlOiAnc3Bhbi5zdGFydCcsXG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBpZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogZXhwbGljaXRQYXJlbnQgPT09IHVuZGVmaW5lZCA/IChwYXJlbnRMb2dJZCA/PyBudWxsKSA6IGV4cGxpY2l0UGFyZW50LFxuICAgICAgbGV2ZWw6IGxldmVsID8/ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgb3BlcmF0aW9uLFxuICAgICAgdGFnczogbWVyZ2VUYWdzKHN0YXRlPy50YWdzLCB0YWdzKSxcbiAgICAgIGNhcHR1cmU6IHsgYmFja2VuZHM6IFsgJ290ZWwnIF0gfSxcbiAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNwYW4gPSBuZXcgU3Bhbk9ic2VydmVyKGlkLCBvcGVyYXRpb24sIHBhcmVudCwgdHJ1ZSwgb3B0aW9ucywgY29ycmVsYXRpb25JZCwgcGFyZW50TG9nSWQpO1xuICAgIHJlZ2lzdGVyU3BhbihzcGFuKTtcbiAgICByZXR1cm4gc3BhbjtcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBTdGF0aWMgVXRpbGl0aWVzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGN1cnJlbnRseSBhY3RpdmUgc3BhbiBmcm9tIGNvbnRleHQuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q3VycmVudFNwYW4oKTogU3Bhbk9ic2VydmVyIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjdXJyZW50ID0gZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlKCk/LmN1cnJlbnRTcGFuO1xuICAgIC8vIGN1cnJlbnRTcGFuIGlzIG9ubHkgZXZlciBzZXQgYnkgU3Bhbk9ic2VydmVyLCBidXQgd2Uga2VlcCB0aGUgcnVudGltZSBjaGVjayBjb25zZXJ2YXRpdmUuXG4gICAgcmV0dXJuIGN1cnJlbnQgaW5zdGFuY2VvZiBTcGFuT2JzZXJ2ZXIgPyBjdXJyZW50IDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIExpZmVjeWNsZTogZW5kKClcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgZW5kKG9wdGlvbnM/OiBTcGFuRW5kT3B0aW9ucyk6IHZvaWQge1xuICAgIGlmICh0aGlzLmVuZGVkKSByZXR1cm47XG4gICAgdGhpcy5lbmRlZCA9IHRydWU7XG5cbiAgICBpZiAoIXRoaXMuY2FwdHVyZWQpIHJldHVybjtcblxuICAgIGNvbnN0IGVuZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IGR1cmF0aW9uID0gZW5kVGltZSAtIHRoaXMuc3RhcnRUaW1lO1xuICAgIGNvbnN0IGhhc0Vycm9yID0gISFvcHRpb25zPy5lcnJvciB8fCBvcHRpb25zPy5zdWNjZXNzID09PSBmYWxzZTtcblxuICAgIGlmIChoYXNFcnJvcikge1xuICAgICAgdGhpcy5faGFzRXJyb3IgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIElNUE9SVEFOVDpcbiAgICAvLyBEbyBOT1QgZHJvcCBzcGFucyBoZXJlLlxuICAgIC8vXG4gICAgLy8gV2hldGhlciBhIHNwYW4gY2FuIGJlIGRyb3BwZWQgZGVwZW5kcyBvbiB3aGV0aGVyIGl0IGhhcyBhbnkgY2hpbGRyZW4gKGdyYXBoIHByb3BlcnR5KSxcbiAgICAvLyB3aGljaCBjYW4gb25seSBiZSBrbm93biByZWxpYWJseSBhdCBmbHVzaC10aW1lIG9uY2UgYWxsIGV2ZW50cyBhcmUgYnVmZmVyZWQuXG5cbiAgICBjb25zdCB7IGxldmVsLCBza2lwQ2FwdHVyZSwgbWV0cmljcywgZGF0YSwgdGFncywgLi4ub3ZlcnJpZGVzIH0gPSB0aGlzLm9wdGlvbnM7XG5cbiAgICAvLyBCdWlsZCBlcnJvciBpbmZvXG4gICAgbGV0IGVycm9ySW5mbzogT2JzZXJ2YWJpbGl0eUVycm9yIHwgdW5kZWZpbmVkO1xuICAgIGlmIChvcHRpb25zPy5lcnJvcikge1xuICAgICAgZXJyb3JJbmZvID0ge1xuICAgICAgICB0eXBlOiBvcHRpb25zLmVycm9yLm5hbWUsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMuZXJyb3IubWVzc2FnZSxcbiAgICAgICAgc3RhY2s6IG9wdGlvbnMuZXJyb3Iuc3RhY2ssXG4gICAgICAgIGNvZGU6ICdjb2RlJyBpbiBvcHRpb25zLmVycm9yICYmIHR5cGVvZiBvcHRpb25zLmVycm9yLmNvZGUgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBvcHRpb25zLmVycm9yLmNvZGVcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgZmluYWwgbWV0cmljcyAoZHVyYXRpb24gYWx3YXlzIGluY2x1ZGVkKVxuICAgIGNvbnN0IGZpbmFsTWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHtcbiAgICAgIGR1cmF0aW9uLFxuICAgICAgLi4udGhpcy5fbWV0cmljcyxcbiAgICAgIC4uLm9wdGlvbnM/Lm1ldHJpY3MsXG4gICAgfTtcblxuICAgIC8vIEJ1aWxkIGZpbmFsIGRhdGFcbiAgICBjb25zdCBmaW5hbERhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgLi4udGhpcy5fZGF0YSxcbiAgICAgIC4uLm9wdGlvbnM/LmRhdGEsXG4gICAgfTtcblxuICAgIC8vIE1hcmsgd2hldGhlciB0aGlzIHNwYW4gd2FzIFwiZW1wdHlcIiAobm8gdXNlZnVsIGNvbnRlbnQgYmV5b25kIHRpbWluZykuXG4gICAgLy8gRmx1c2gtdGltZSBsb2dpYyBjYW4gc2FmZWx5IGRyb3AgZW1wdHkgKmxlYWYqIHNwYW5zIHdoZW4gY29uZmlndXJlZC5cbiAgICBjb25zdCBpc0VtcHR5U3BhbiA9ICF0aGlzLmhhc0NvbnRlbnQgJiYgIWhhc0Vycm9yO1xuICAgIGlmIChpc0VtcHR5U3Bhbikge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBmaW5hbERhdGEuX2Z3MjQ7XG4gICAgICBjb25zdCBiYXNlID0gKGV4aXN0aW5nICYmIHR5cGVvZiBleGlzdGluZyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkoZXhpc3RpbmcpKVxuICAgICAgICA/IChleGlzdGluZyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgOiB7fTtcbiAgICAgIGZpbmFsRGF0YS5fZncyNCA9IHsgLi4uYmFzZSwgc3BhbkVtcHR5OiB0cnVlIH07XG4gICAgfVxuXG4gICAgLy8gQWRkIGNoZWNrcG9pbnRzIHRvIGRhdGEgaWYgYW55XG4gICAgaWYgKHRoaXMuX2NoZWNrcG9pbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGZpbmFsRGF0YS5jaGVja3BvaW50cyA9IHRoaXMuX2NoZWNrcG9pbnRzO1xuICAgIH1cblxuICAgIC8vIEVtaXQgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkXG4gICAgLy8gQ1JJVElDQUw6IFBhc3MgbnVsbCBleHBsaWNpdGx5IGlmIG5vIHBhcmVudCB0byBwcmV2ZW50IGZhbGxiYWNrIHRvIGdldEN1cnJlbnRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQoKVxuICAgIC8vIHdoaWNoIHdvdWxkIHJldHVybiBUSElTIHNwYW4ncyBJRCAoY2F1c2luZyBzZWxmLXJlZmVyZW5jZSBidWcpXG4gICAgY29uc3QgY2FwdHVyZWRJZCA9IGNhcHR1cmVSZWNvcmQoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgLy8gSU1QT1JUQU5UOlxuICAgICAgLy8gU3BhbiBlbmQgY2FuIG9jY3VyIGFmdGVyIHRoZSBhc3luYyBleGVjdXRpb24gY29udGV4dCBoYXMgdW53b3VuZCAoQUxTIGJvdW5kYXJ5KSxcbiAgICAgIC8vIGVzcGVjaWFsbHkgaW4gcXVldWUvYmF0Y2ggcHJvY2Vzc29ycy4gU3RvcmUgY29ycmVsYXRpb25JZCBhdCBzcGFuIGNyZWF0aW9uIHRpbWUgYW5kXG4gICAgICAvLyBwYXNzIGl0IGV4cGxpY2l0bHkgc28gd2UgbmV2ZXIgZW5kIHVwIHdpdGggc3Bhbi5zdGFydCBidXQgbm8gc3BhbiByZWNvcmQuXG4gICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuaWQsXG4gICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5wYXJlbnRMb2dJZCA/PyBudWxsLFxuICAgICAgLy8gSU1QT1JUQU5UOlxuICAgICAgLy8gVXNlIHNwYW4gKnN0YXJ0KiB0aW1lc3RhbXAgZm9yIG9yZGVyaW5nIGluIER5bmFtb0RCL1VJLlxuICAgICAgLy8gRHVyYXRpb25NcyBzdGlsbCByZXByZXNlbnRzIGVuZC1zdGFydCwgc28gdGhlIGVuZCB0aW1lc3RhbXAgaXMgZGVyaXZhYmxlIGFzICh0aW1lc3RhbXBNcyArIGR1cmF0aW9uTXMpLlxuICAgICAgLy8gVXNpbmcgZW5kVGltZSBoZXJlIGNhdXNlcyBzcGFucyB0byBhcHBlYXIgYWZ0ZXIgdGhlaXIgY2hpbGRyZW4sIHdoaWNoIGJyZWFrcyB0aW1lbGluZSBvcmRlcmluZyBpbiB0aGUgVUkuXG4gICAgICB0aW1lc3RhbXBNczogdGhpcy5zdGFydFRpbWUsXG4gICAgICBkdXJhdGlvbk1zOiBkdXJhdGlvbixcbiAgICAgIG9wZXJhdGlvbjogdGhpcy5vcGVyYXRpb24sXG4gICAgICBzdWNjZXNzOiBvcHRpb25zPy5zdWNjZXNzID8/ICFvcHRpb25zPy5lcnJvcixcbiAgICAgIHN0YXR1czogb3B0aW9ucz8uc3RhdHVzID8/IChvcHRpb25zPy5lcnJvciA/ICdmYWlsZWQnIDogJ2NvbXBsZXRlZCcpLFxuICAgICAgdGFnczogdGhpcy5fdGFncyxcbiAgICAgIG1ldHJpY3M6IGZpbmFsTWV0cmljcyxcbiAgICAgIGRhdGE6IE9iamVjdC5rZXlzKGZpbmFsRGF0YSkubGVuZ3RoID4gMCA/IGZpbmFsRGF0YSA6IHVuZGVmaW5lZCxcbiAgICAgIGVycm9yOiBlcnJvckluZm8sXG4gICAgICBjYXB0dXJlOiB7XG4gICAgICAgIC4uLnRoaXMub3B0aW9ucy5jYXB0dXJlLFxuICAgICAgfSxcbiAgICAgIC4uLm92ZXJyaWRlcyxcbiAgICB9KTtcblxuICAgIC8vIE5PVEU6IFNwYW4gcGFyZW50L2NoaWxkIGludGVncml0eSBpcyBlbmZvcmNlZCBhdCBmbHVzaC10aW1lIGJ5IGFuYWx5emluZyB0aGUgYnVmZmVyZWQgZ3JhcGguXG4gIH1cbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDb252ZW5pZW5jZSBFeHBvcnRzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGNvbnN0IHdpdGhTcGFuID0gU3Bhbk9ic2VydmVyLndpdGhTcGFuLmJpbmQoU3Bhbk9ic2VydmVyKTtcbmV4cG9ydCBjb25zdCB3aXRoU3BhblN5bmMgPSBTcGFuT2JzZXJ2ZXIud2l0aFNwYW5TeW5jLmJpbmQoU3Bhbk9ic2VydmVyKTtcbmV4cG9ydCBjb25zdCB3cmFwSW5TcGFuID0gU3Bhbk9ic2VydmVyLndyYXAuYmluZChTcGFuT2JzZXJ2ZXIpO1xuIl19