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
    /** Nesting depth in the span hierarchy. Root = 0, direct child = 1, etc. */
    depth;
    correlationId;
    options;
    level;
    startTime;
    // Clean data storage
    _tags = {};
    _metrics = {};
    _data = {};
    _checkpoints = [];
    // Entity context (set dynamically via setEntity)
    _entityName;
    _entityId;
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
        // Compute span depth from parent chain (root = 0)
        this.depth = parent && 'depth' in parent && typeof parent.depth === 'number'
            ? parent.depth + 1
            : 0;
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
     * Associate this span with a specific entity for admin UI filtering.
     * Sets the actual entityName/entityId fields on the observability record.
     */
    setEntity(entityName, entityId) {
        this._entityName = entityName;
        this._entityId = entityId;
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
        const startTimeMs = Date.now();
        // Notify lifecycle hooks (OTEL and other real-time backends) synchronously.
        // This replaces the old approach of emitting span.start events through the capture pipeline.
        const hooks = (0, runtime_state_1.getSpanLifecycleHooks)();
        if (hooks.length > 0) {
            const startInfo = {
                id,
                operation,
                parentId: parentLogId,
                correlationId: correlationId ?? '',
                causedBy: options.causedBy,
                source: options.source ?? state?.source,
                subType: undefined, // span-level subType not typically set at start
                tags: (0, base_1.mergeTags)(state?.tags, options.tags),
                startTimeMs,
            };
            for (const hook of hooks) {
                try {
                    hook.onSpanStart(startInfo);
                }
                catch (error) {
                    logger.warn('SpanLifecycleHook.onSpanStart failed:', error);
                }
            }
        }
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
        // Build final metrics (duration and span.depth always included)
        const finalMetrics = {
            duration,
            'span.depth': this.depth,
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
        const finalDataOrUndefined = Object.keys(finalData).length > 0 ? finalData : undefined;
        const success = options?.success ?? !options?.error;
        // Notify lifecycle hooks (OTEL and other real-time backends) synchronously.
        const hooks = (0, runtime_state_1.getSpanLifecycleHooks)();
        if (hooks.length > 0) {
            const endInfo = {
                id: this.id,
                operation: this.operation,
                success,
                durationMs: duration,
                startTimeMs: this.startTime,
                parentId: this.parentLogId,
                correlationId: this.correlationId ?? '',
                causedBy: this.options.causedBy,
                source: this.options.source ?? (0, storage_1.getObservabilityState)()?.source,
                subType: undefined, // subType is determined by the capture pipeline, not at span level
                error: errorInfo,
                tags: Object.keys(this._tags).length > 0 ? this._tags : undefined,
                metrics: Object.keys(finalMetrics).length > 0 ? finalMetrics : undefined,
                data: finalDataOrUndefined,
            };
            for (const hook of hooks) {
                try {
                    hook.onSpanEnd(endInfo);
                }
                catch (error) {
                    logger.warn('SpanLifecycleHook.onSpanEnd failed:', error);
                }
            }
        }
        // Emit consolidated span record to the buffered capture pipeline (for DynamoDB/CloudWatch).
        // CRITICAL: Pass null explicitly if no parent to prevent fallback to getCurrentParentObservabilityLogId()
        // which would return THIS span's ID (causing self-reference bug)
        (0, base_1.captureRecord)(OBSERVER_NAME, {
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
            success,
            status: options?.status ?? (options?.error ? 'failed' : 'completed'),
            tags: this._tags,
            metrics: finalMetrics,
            data: finalDataOrUndefined,
            error: errorInfo,
            capture: {
                ...this.options.capture,
            },
            ...overrides,
            // Dynamic entity context (setEntity) takes priority over static options
            ...(this._entityName && { entityName: this._entityName }),
            ...(this._entityId && { entityId: this._entityId }),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3Bhbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9zcGFuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUNHOzs7QUFHSCwwRUFLc0Q7QUFFdEQsaUNBTWdCO0FBQ2hCLDJDQUE2QztBQUM3QyxzQ0FBNEM7QUFDNUMsd0RBQW1FO0FBQ25FLG9EQUEwRztBQVExRzs7O0dBR0c7QUFDSCxTQUFTLGFBQWE7SUFDcEIsT0FBTyxJQUFBLDZDQUE2QixHQUFFLEVBQUUsS0FBSyxJQUFJLHdCQUFlLENBQUMsS0FBSyxDQUFDO0FBQ3pFLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQU0sY0FBYyxHQUFHLElBQUksT0FBTyxFQUE2QixDQUFDO0FBRWhFLFNBQVMsWUFBWSxDQUFDLElBQWtCO0lBQ3RDLE1BQU0sR0FBRyxHQUFHLElBQUEsb0NBQTBCLEdBQUUsQ0FBQztJQUN6QyxJQUFJLENBQUMsR0FBRztRQUFFLE9BQU87SUFDakIsTUFBTSxHQUFHLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7SUFDekMsTUFBTSxHQUFHLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNwQyxJQUFJLEdBQUc7UUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDOztRQUNsQixjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJLEdBQUcsQ0FBQyxDQUFFLElBQUksQ0FBRSxDQUFDLENBQUMsQ0FBQztBQUNsRCxDQUFDO0FBRUQsU0FBUyxrQ0FBa0M7SUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBQSxvQ0FBMEIsR0FBRSxDQUFDO0lBQ3pDLElBQUksQ0FBQyxHQUFHO1FBQUUsT0FBTztJQUNqQixNQUFNLEdBQUcsR0FBRyxjQUFjLENBQUMsR0FB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QUNwQixTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsT0FBTztZQUNQLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7WUFDcEUsSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2hCLE9BQU8sRUFBRSxZQUFZO1lBQ3JCLElBQUksRUFBRSxvQkFBb0I7WUFDMUIsS0FBSyxFQUFFLFNBQVM7WUFDaEIsT0FBTyxFQUFFO2dCQUNQLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPO2FBQ3hCO1lBQ0QsR0FBRyxTQUFTO1lBQ1osd0VBQXdFO1lBQ3hFLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUUsVUFBVSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN6RCxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7U0FDcEQsQ0FBQyxDQUFDO1FBRUgsK0ZBQStGO0lBQ2pHLENBQUM7Q0FDRjtBQTNqQkQsb0NBMmpCQztBQUVELDhFQUE4RTtBQUM5RSxzQkFBc0I7QUFDdEIsOEVBQThFO0FBRWpFLFFBQUEsUUFBUSxHQUFHLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQ3BELFFBQUEsWUFBWSxHQUFHLFlBQVksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELFFBQUEsVUFBVSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTcGFuT2JzZXJ2ZXIgLSBEaXN0cmlidXRlZCBUcmFjaW5nIHdpdGggQ2xlYW4gRGF0YSBTZXBhcmF0aW9uXG4gKiBcbiAqIERFU0lHTiBQUklOQ0lQTEVTOlxuICogLSBDbGVhciBzZXBhcmF0aW9uOiB0YWdzIChpbmRleGFibGUpLCBtZXRyaWNzIChudW1lcmljKSwgZGF0YSAoZGVidWcgcGF5bG9hZCksIGNoZWNrcG9pbnRzICh0aW1lbGluZSlcbiAqIC0gU3Bhbk9ic2VydmVyIGluc3RhbmNlcyBmb3JtIGEgbGlua2VkIHRyZWUgdmlhIGBwYXJlbnRgIHJlZmVyZW5jZXNcbiAqIC0gYHdpdGhTcGFuKClgIC8gYHdyYXAoKWAgYXJlIHRoZSBQUklNQVJZIEFQSXMgLSBhdXRvbWF0aWMgc2NvcGUgbWFuYWdlbWVudFxuICogLSBDb25zb2xpZGF0aW9uOiBCeSBkZWZhdWx0LCBzcGFuLnN0YXJ0ICsgY29udGVudCArIGVuZCBhcmUgbWVyZ2VkIGludG8gT05FIHJlY29yZFxuICogXG4gKiBEQVRBIENPTkNFUFRTOlxuICogLSBUYWdzOiBzdHJpbmfihpJzdHJpbmcgcGFpcnMgZm9yIGZpbHRlcmluZy9pbmRleGluZyAob3JkZXJJZCwgdXNlcklkLCBzdGF0dXMpXG4gKiAtIE1ldHJpY3M6IHN0cmluZ+KGkm51bWJlciBwYWlycyBmb3IgZGFzaGJvYXJkcy9hbGVydHMgKGR1cmF0aW9uLCBjb3VudCwgc2l6ZSlcbiAqIC0gRGF0YTogYXJiaXRyYXJ5IHBheWxvYWQgZm9yIGRlYnVnZ2luZyAocmVxdWVzdCwgcmVzcG9uc2UsIGNvbnRleHQpXG4gKiAtIENoZWNrcG9pbnRzOiBzaW1wbGUgdGltZWxpbmUgb2Ygd2hhdCBoYXBwZW5lZCAodmFsaWRhdGlvbl9zdGFydCwgZGJfY29tcGxldGUpXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogYXdhaXQgd2l0aFNwYW4oJ3Byb2Nlc3NPcmRlcicsIGFzeW5jIChzcGFuKSA9PiB7XG4gKiAgIC8vIFRhZ3MgLSBmb3IgZmlsdGVyaW5nL3NlYXJjaGluZ1xuICogICBzcGFuLnRhZygnb3JkZXJJZCcsIG9yZGVyLmlkKTtcbiAqICAgc3Bhbi50YWcoJ3N0YXR1cycsICdwcm9jZXNzaW5nJyk7XG4gKiAgIFxuICogICAvLyBNZXRyaWNzIC0gZm9yIGRhc2hib2FyZHNcbiAqICAgc3Bhbi5tZXRyaWMoJ2l0ZW1Db3VudCcsIGl0ZW1zLmxlbmd0aCk7XG4gKiAgIFxuICogICAvLyBDaGVja3BvaW50cyAtIHRpbWVsaW5lXG4gKiAgIHNwYW4uY2hlY2twb2ludCgndmFsaWRhdGlvbl9jb21wbGV0ZScpO1xuICogICBzcGFuLmNoZWNrcG9pbnQoJ3BheW1lbnRfcHJvY2Vzc2VkJyk7XG4gKiAgIFxuICogICAvLyBEYXRhIC0gZGVidWcgcGF5bG9hZFxuICogICBzcGFuLnNldERhdGEoeyByZXF1ZXN0OiBib2R5LCByZXNwb25zZTogcmVzdWx0IH0pO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IElTcGFuTm9kZSB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dC90eXBlcyc7XG5pbXBvcnQge1xuICBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCxcbiAgZ2V0T2JzZXJ2YWJpbGl0eVN0YXRlLFxuICB3aXRoQ3VycmVudFNwYW4sXG4gIGdldENhcHR1cmVkUGFyZW50SWQsXG59IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dC9zdG9yYWdlJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBSZWNvcmRPdmVycmlkZXMsIE9ic2VydmFiaWxpdHlFcnJvciwgU3BhbkNvbmZpZywgU3BhbkNoZWNrcG9pbnQsIFNwYW5TdGFydEluZm8sIFNwYW5FbmRJbmZvIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHtcbiAgZ2VuZXJhdGVJZCxcbiAgY2FwdHVyZVJlY29yZCxcbiAgbm9ybWFsaXplRXJyb3IsXG4gIG1lcmdlVGFncyxcbiAgbWFwRXJyb3IsXG59IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IENPTkZJR19ERUZBVUxUUyB9IGZyb20gJy4uL2NvbmZpZyc7XG5pbXBvcnQgeyBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZCB9IGZyb20gJy4uL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5pbXBvcnQgeyBnZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgc2V0U3BhbkZpbmFsaXplciwgZ2V0U3BhbkxpZmVjeWNsZUhvb2tzIH0gZnJvbSAnLi4vcnVudGltZS1zdGF0ZSc7XG5cbi8qKiBDaGVja3BvaW50IGVudHJ5IC0gc2ltcGxlIHRpbWVsaW5lIG1hcmtlciAqL1xuaW50ZXJmYWNlIENoZWNrcG9pbnQge1xuICBuYW1lOiBzdHJpbmc7XG4gIHRzOiBudW1iZXI7XG59XG5cbi8qKiBcbiAqIEdldCBzcGFuIGNvbmZpZyBmcm9tIE9ic2VydmFiaWxpdHlNYW5hZ2VyIChhbHJlYWR5IGNhY2hlZCkuXG4gKiBSZXR1cm5zIGVtcHR5IG9iamVjdCBpZiBub3QgaW5pdGlhbGl6ZWQgeWV0LlxuICovXG5mdW5jdGlvbiBnZXRTcGFuQ29uZmlnKCk6IFNwYW5Db25maWcge1xuICByZXR1cm4gZ2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcoKT8uc3BhbnMgPz8gQ09ORklHX0RFRkFVTFRTLnNwYW5zO1xufVxuXG4vKipcbiAqIFRyYWNrIHNwYW5zIHBlciBleGVjdXRpb24gY29udGV4dCBzbyBmbHVzaCgpIGNhbiBmb3JjZS1lbmQgYW55IHNwYW5zIGxlZnQgb3Blbi5cbiAqXG4gKiBUaGlzIGlzIHRoZSBjb3JlIGZpeCBmb3IgXCJtaXNzaW5nIHBhcmVudCBzcGFuXCI6XG4gKiAtIGEgcGFyZW50IHNwYW4gbWlnaHQgbm90IGhhdmUgZW5kZWQgd2hlbiBmbHVzaCBydW5zXG4gKiAtIG9yIGEgcGFyZW50IHNwYW4gbWlnaHQgZW5kIFwiZW1wdHlcIiBhbmQgYmUgZHJvcHBhYmxlIGRlcGVuZGluZyBvbiBjaGlsZHJlblxuICpcbiAqIFdlIHNvbHZlIHRoaXMgYnk6XG4gKiAtIHJlY29yZGluZyBzcGFucyBwZXIgY29udGV4dFxuICogLSBmb3JjZS1lbmRpbmcgYW55IHN0aWxsLW9wZW4gc3BhbnMgYXQgZmx1c2hcbiAqIC0gZGVmZXJyaW5nIHRoZSBkcm9wIGRlY2lzaW9uIHRvIGZsdXNoLXRpbWUgZ3JhcGggYW5hbHlzaXMgKG5vdCBpbiBTcGFuT2JzZXJ2ZXIuZW5kKCkpLlxuICovXG5jb25zdCBzcGFuc0J5Q29udGV4dCA9IG5ldyBXZWFrTWFwPG9iamVjdCwgU2V0PFNwYW5PYnNlcnZlcj4+KCk7XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyU3BhbihzcGFuOiBTcGFuT2JzZXJ2ZXIpOiB2b2lkIHtcbiAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgaWYgKCFjdHgpIHJldHVybjtcbiAgY29uc3Qga2V5ID0gY3R4Lm9ic2VydmFiaWxpdHkuY29udGV4dEtleTtcbiAgY29uc3Qgc2V0ID0gc3BhbnNCeUNvbnRleHQuZ2V0KGtleSk7XG4gIGlmIChzZXQpIHNldC5hZGQoc3Bhbik7XG4gIGVsc2Ugc3BhbnNCeUNvbnRleHQuc2V0KGtleSwgbmV3IFNldChbIHNwYW4gXSkpO1xufVxuXG5mdW5jdGlvbiBmaW5hbGl6ZU9wZW5TcGFuc0ZvckN1cnJlbnRDb250ZXh0KCk6IHZvaWQge1xuICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICBpZiAoIWN0eCkgcmV0dXJuO1xuICBjb25zdCBzZXQgPSBzcGFuc0J5Q29udGV4dC5nZXQoY3R4Lm9ic2VydmFiaWxpdHkuY29udGV4dEtleSk7XG4gIGlmICghc2V0KSByZXR1cm47XG5cbiAgZm9yIChjb25zdCBzcGFuIG9mIHNldCkge1xuICAgIGlmICghc3Bhbi5lbmRlZCkge1xuICAgICAgLy8gRm9yY2UtY2xvc2U6IGEgc3BhbiBsZWZ0IG9wZW4gdW50aWwgZmx1c2ggaXMgYSBidWcgaW4gdXNlciBjb2RlIG9yIGZyYW1ld29yayB3aXJpbmcuXG4gICAgICAvLyBXZSBlbmQgaXQgYXMgXCJhYmFuZG9uZWRcIiBzbyBpdCBpcyB2aXNpYmxlIGFuZCBkb2VzIG5vdCBicmVhayBoaWVyYXJjaHkuXG4gICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBzdGF0dXM6ICdhYmFuZG9uZWQnIH0pO1xuICAgIH1cbiAgfVxufVxuXG4vLyBSZWdpc3RlciBmaW5hbGl6ZXIgc28gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKSBjYW4gY2FsbCBpdCB3aXRob3V0IGltcG9ydGluZyBTcGFuT2JzZXJ2ZXIgKGF2b2lkIGN5Y2xlcykuXG5zZXRTcGFuRmluYWxpemVyKGZpbmFsaXplT3BlblNwYW5zRm9yQ3VycmVudENvbnRleHQpO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ1NwYW5PYnNlcnZlcicpO1xuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdTcGFuT2JzZXJ2ZXInO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFR5cGVzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBPcHRpb25zIGZvciBzdGFydGluZyBhIHNwYW4uXG4gKiBFeHRlbmRzIFJlY29yZE92ZXJyaWRlcyBmb3IgYWxsIGNvbnRleHQgb3ZlcnJpZGUgY2FwYWJpbGl0aWVzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwYW5PcHRpb25zIGV4dGVuZHMgUmVjb3JkT3ZlcnJpZGVzIHtcbiAgLyoqIFNldmVyaXR5IGxldmVsIGZvciB0aGUgc3BhbiAqL1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcbiAgLyoqIEluaXRpYWwgbWV0cmljcyAoc3RyaW5n4oaSbnVtYmVyIGZvciBhZ2dyZWdhdGlvbikgKi9cbiAgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIC8qKiBJbml0aWFsIGRhdGEgKGRlYnVnIHBheWxvYWQpICovXG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFNraXAgY2FwdHVyaW5nIGVudGlyZWx5IChmb3IgYXVkaXQtb25seSBvciBtZXRyaWMtb25seSBzY2VuYXJpb3MpICovXG4gIHNraXBDYXB0dXJlPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciBlbmRpbmcgYSBzcGFuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3BhbkVuZE9wdGlvbnMge1xuICAvKiogV2hldGhlciB0aGUgb3BlcmF0aW9uIHN1Y2NlZWRlZCAqL1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgLyoqIEVycm9yIGlmIG9wZXJhdGlvbiBmYWlsZWQgKi9cbiAgZXJyb3I/OiBFcnJvcjtcbiAgLyoqIEN1c3RvbSBzdGF0dXMgc3RyaW5nICovXG4gIHN0YXR1cz86IHN0cmluZztcbiAgLyoqIEFkZGl0aW9uYWwgZGF0YSB0byBtZXJnZSAqL1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIC8qKiBBZGRpdGlvbmFsIG1ldHJpY3MgdG8gbWVyZ2UgKi9cbiAgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIGZvciBzcGFuIG9wZXJhdGlvbnNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJU3Bhbk9ic2VydmVyIGV4dGVuZHMgSVNwYW5Ob2RlIHtcbiAgcmVhZG9ubHkgaWQ6IHN0cmluZztcbiAgcmVhZG9ubHkgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGNhcHR1cmVkOiBib29sZWFuO1xuICByZWFkb25seSB0cmFjZUlkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHBhcmVudExvZ0lkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgLy8gQ2xlYW4gQVBJXG4gIHRhZyhrZXk6IHN0cmluZywgdmFsdWU6IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4pOiB0aGlzO1xuICB0YWdzKHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+KTogdGhpcztcbiAgbWV0cmljKGtleTogc3RyaW5nLCB2YWx1ZTogbnVtYmVyKTogdGhpcztcbiAgbWV0cmljcyhtZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+KTogdGhpcztcbiAgc2V0RGF0YShkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHRoaXM7XG4gIHNldEVudGl0eShlbnRpdHlOYW1lOiBzdHJpbmcsIGVudGl0eUlkOiBzdHJpbmcpOiB0aGlzO1xuICBjaGVja3BvaW50KG5hbWU6IHN0cmluZywgb3B0aW9ucz86IHtcbiAgICBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgZXJyb3I/OiBFcnJvciB8IHN0cmluZztcbiAgfSk6IHRoaXM7XG5cbiAgLy8gTGlmZWN5Y2xlXG4gIGVuZChvcHRpb25zPzogU3BhbkVuZE9wdGlvbnMpOiB2b2lkO1xuXG4gIC8vIEVycm9yIGhhbmRsaW5nXG4gIHJlY29yZEV4Y2VwdGlvbihleGNlcHRpb246IEVycm9yIHwgc3RyaW5nKTogdGhpcztcbn1cblxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFNwYW5PYnNlcnZlciBJbXBsZW1lbnRhdGlvblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBTcGFuT2JzZXJ2ZXIgaW1wbGVtZW50cyBJU3Bhbk9ic2VydmVyIHtcbiAgcmVhZG9ubHkgaWQ6IHN0cmluZztcbiAgcmVhZG9ubHkgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHBhcmVudD86IElTcGFuTm9kZTtcbiAgcmVhZG9ubHkgY2FwdHVyZWQ6IGJvb2xlYW47XG4gIHJlYWRvbmx5IHBhcmVudExvZ0lkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIC8qKiBOZXN0aW5nIGRlcHRoIGluIHRoZSBzcGFuIGhpZXJhcmNoeS4gUm9vdCA9IDAsIGRpcmVjdCBjaGlsZCA9IDEsIGV0Yy4gKi9cbiAgcmVhZG9ubHkgZGVwdGg6IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBjb3JyZWxhdGlvbklkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBTcGFuT3B0aW9ucztcbiAgcHJpdmF0ZSByZWFkb25seSBsZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YXJ0VGltZTogbnVtYmVyO1xuXG4gIC8vIENsZWFuIGRhdGEgc3RvcmFnZVxuICBwcml2YXRlIF90YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIHByaXZhdGUgX21ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgcHJpdmF0ZSBfZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgcHJpdmF0ZSBfY2hlY2twb2ludHM6IENoZWNrcG9pbnRbXSA9IFtdO1xuXG4gIC8vIEVudGl0eSBjb250ZXh0IChzZXQgZHluYW1pY2FsbHkgdmlhIHNldEVudGl0eSlcbiAgcHJpdmF0ZSBfZW50aXR5TmFtZT86IHN0cmluZztcbiAgcHJpdmF0ZSBfZW50aXR5SWQ/OiBzdHJpbmc7XG5cbiAgLy8gU3RhdGUgdHJhY2tpbmdcbiAgcHJpdmF0ZSBfaGFzRXJyb3IgPSBmYWxzZTtcbiAgLy8gTk9URTogV2Ugbm8gbG9uZ2VyIG11dGF0ZSBzcGFucyB0byB0cmFjayBcImhhcyBjaGlsZHJlblwiLlxuICAvLyBQYXJlbnQvc3BhbiBpbnRlZ3JpdHkgaXMgaGFuZGxlZCBjZW50cmFsbHkgdmlhIGV4cGxpY2l0IHJlZmVyZW5jZSB0cmFja2luZyBpbiBleGVjdXRpb24tY29udGV4dCBzdGF0ZS5cbiAgLy8gTk9URTogVXNlZCBieSB0aGUgZmx1c2gtdGltZSBzcGFuIGZpbmFsaXplciB0byBjbG9zZSBzcGFucyBsZWZ0IG9wZW4gYnkgdXNlci9mcmFtZXdvcmsgY29kZS5cbiAgcHVibGljIGVuZGVkID0gZmFsc2U7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihcbiAgICBpZDogc3RyaW5nLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIHBhcmVudDogSVNwYW5Ob2RlIHwgdW5kZWZpbmVkLFxuICAgIGNhcHR1cmVkOiBib29sZWFuLFxuICAgIG9wdGlvbnM6IFNwYW5PcHRpb25zLFxuICAgIGNvcnJlbGF0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICBwYXJlbnRMb2dJZFZhbDogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkXG4gICkge1xuICAgIHRoaXMuaWQgPSBpZDtcbiAgICB0aGlzLm9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICB0aGlzLnBhcmVudCA9IHBhcmVudDtcbiAgICB0aGlzLmNhcHR1cmVkID0gY2FwdHVyZWQ7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICB0aGlzLmNvcnJlbGF0aW9uSWQgPSBjb3JyZWxhdGlvbklkO1xuICAgIHRoaXMubGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgdGhpcy5wYXJlbnRMb2dJZCA9IHBhcmVudExvZ0lkVmFsO1xuICAgIC8vIENvbXB1dGUgc3BhbiBkZXB0aCBmcm9tIHBhcmVudCBjaGFpbiAocm9vdCA9IDApXG4gICAgdGhpcy5kZXB0aCA9IHBhcmVudCAmJiAnZGVwdGgnIGluIHBhcmVudCAmJiB0eXBlb2YgKHBhcmVudCBhcyBTcGFuT2JzZXJ2ZXIpLmRlcHRoID09PSAnbnVtYmVyJ1xuICAgICAgPyAocGFyZW50IGFzIFNwYW5PYnNlcnZlcikuZGVwdGggKyAxXG4gICAgICA6IDA7XG5cbiAgICAvLyBJbml0aWFsaXplIGZyb20gb3B0aW9uc1xuICAgIGlmIChvcHRpb25zLnRhZ3MpIHtcbiAgICAgIHRoaXMuX3RhZ3MgPSB7IC4uLm9wdGlvbnMudGFncyB9O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5tZXRyaWNzKSB7XG4gICAgICB0aGlzLl9tZXRyaWNzID0geyAuLi5vcHRpb25zLm1ldHJpY3MgfTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuZGF0YSkge1xuICAgICAgdGhpcy5fZGF0YSA9IHsgLi4ub3B0aW9ucy5kYXRhIH07XG4gICAgfVxuICB9XG5cbiAgZ2V0IHRyYWNlSWQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICAgIHJldHVybiB0aGlzLmNvcnJlbGF0aW9uSWQgPz8gdGhpcy5vcHRpb25zLmNvcnJlbGF0aW9uSWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkID8/ICcnO1xuICB9XG5cbiAgLyoqIENoZWNrIGlmIHNwYW4gaGFzIGFueSBjb250ZW50IHdvcnRoIGNhcHR1cmluZyAqL1xuICBnZXQgaGFzQ29udGVudCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5fY2hlY2twb2ludHMubGVuZ3RoID4gMFxuICAgICAgfHwgdGhpcy5faGFzRXJyb3JcbiAgICAgIHx8IE9iamVjdC5rZXlzKHRoaXMuX3RhZ3MpLmxlbmd0aCA+IDBcbiAgICAgIHx8IE9iamVjdC5rZXlzKHRoaXMuX21ldHJpY3MpLmxlbmd0aCA+IDBcbiAgICAgIHx8IE9iamVjdC5rZXlzKHRoaXMuX2RhdGEpLmxlbmd0aCA+IDA7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gQ0xFQU4gQVBJOiBUYWdzLCBNZXRyaWNzLCBEYXRhLCBDaGVja3BvaW50c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICAvKipcbiAgICogU2V0IGEgdGFnIGZvciBpbmRleGluZy9maWx0ZXJpbmcuXG4gICAqIFRhZ3MgYXJlIHN0cmluZyBrZXktdmFsdWUgcGFpcnMgdGhhdCBjYW4gYmUgc2VhcmNoZWQuXG4gICAqL1xuICB0YWcoa2V5OiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuKTogdGhpcyB7XG4gICAgdGhpcy5fdGFnc1sga2V5IF0gPSBTdHJpbmcodmFsdWUpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBtdWx0aXBsZSB0YWdzIGF0IG9uY2UuXG4gICAqL1xuICB0YWdzKHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+KTogdGhpcyB7XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyh0YWdzKSkge1xuICAgICAgdGhpcy5fdGFnc1sga2V5IF0gPSBTdHJpbmcodmFsdWUpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYSBudW1lcmljIG1ldHJpYyBmb3IgZGFzaGJvYXJkcy9hZ2dyZWdhdGlvbi5cbiAgICovXG4gIG1ldHJpYyhrZXk6IHN0cmluZywgdmFsdWU6IG51bWJlcik6IHRoaXMge1xuICAgIHRoaXMuX21ldHJpY3NbIGtleSBdID0gdmFsdWU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIG11bHRpcGxlIG1ldHJpY3MgYXQgb25jZS5cbiAgICovXG4gIG1ldHJpY3MobWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPik6IHRoaXMge1xuICAgIE9iamVjdC5hc3NpZ24odGhpcy5fbWV0cmljcywgbWV0cmljcyk7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IGRlYnVnIGRhdGEgcGF5bG9hZC5cbiAgICogRGF0YSBpcyBOT1QgaW5kZXhlZCAtIHVzZSBmb3IgZGVidWdnaW5nIGluc3BlY3Rpb24gb25seS5cbiAgICovXG4gIHNldERhdGEoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB0aGlzIHtcbiAgICBPYmplY3QuYXNzaWduKHRoaXMuX2RhdGEsIGRhdGEpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc29jaWF0ZSB0aGlzIHNwYW4gd2l0aCBhIHNwZWNpZmljIGVudGl0eSBmb3IgYWRtaW4gVUkgZmlsdGVyaW5nLlxuICAgKiBTZXRzIHRoZSBhY3R1YWwgZW50aXR5TmFtZS9lbnRpdHlJZCBmaWVsZHMgb24gdGhlIG9ic2VydmFiaWxpdHkgcmVjb3JkLlxuICAgKi9cbiAgc2V0RW50aXR5KGVudGl0eU5hbWU6IHN0cmluZywgZW50aXR5SWQ6IHN0cmluZyk6IHRoaXMge1xuICAgIHRoaXMuX2VudGl0eU5hbWUgPSBlbnRpdHlOYW1lO1xuICAgIHRoaXMuX2VudGl0eUlkID0gZW50aXR5SWQ7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGEgY2hlY2twb2ludCB0byB0aGUgdGltZWxpbmUuXG4gICAqIENoZWNrcG9pbnRzIGFyZSBzaW1wbGUgbWFya2VycyBvZiB3aGF0IGhhcHBlbmVkIHdoZW4uXG4gICAqL1xuICBjaGVja3BvaW50KG5hbWU6IHN0cmluZywgb3B0aW9ucz86IHtcbiAgICBtZXRyaWNzPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgZXJyb3I/OiBFcnJvciB8IHN0cmluZztcbiAgfSk6IHRoaXMge1xuICAgIGlmICghdGhpcy5jYXB0dXJlZCkgcmV0dXJuIHRoaXM7XG5cbiAgICAvLyBCdWlsZCBjaGVja3BvaW50IHdpdGggYWxsIGZpZWxkcyBpbmNsdWRlZCBpbiB0aGUgY2hlY2twb2ludCBvYmplY3QgaXRzZWxmXG4gICAgY29uc3QgY2hlY2twb2ludDogU3BhbkNoZWNrcG9pbnQgPSB7XG4gICAgICBuYW1lLFxuICAgICAgdHM6IERhdGUubm93KClcbiAgICB9O1xuXG4gICAgLy8gQWRkIGNoZWNrcG9pbnQtc3BlY2lmaWMgZGF0YS90YWdzL21ldHJpY3MvZXJyb3IgdG8gdGhlIGNoZWNrcG9pbnQgb2JqZWN0XG4gICAgaWYgKG9wdGlvbnM/LmRhdGEpIHtcbiAgICAgIGNoZWNrcG9pbnQuZGF0YSA9IG9wdGlvbnMuZGF0YTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnM/LnRhZ3MpIHtcbiAgICAgIGNoZWNrcG9pbnQudGFncyA9IG9wdGlvbnMudGFncztcbiAgICB9XG4gICAgaWYgKG9wdGlvbnM/Lm1ldHJpY3MpIHtcbiAgICAgIGNoZWNrcG9pbnQubWV0cmljcyA9IG9wdGlvbnMubWV0cmljcztcbiAgICB9XG4gICAgaWYgKG9wdGlvbnM/LmVycm9yKSB7XG4gICAgICBjb25zdCBlcnIgPSB0eXBlb2Ygb3B0aW9ucy5lcnJvciA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBuZXcgRXJyb3Iob3B0aW9ucy5lcnJvcilcbiAgICAgICAgOiBvcHRpb25zLmVycm9yO1xuICAgICAgY2hlY2twb2ludC5lcnJvciA9IG1hcEVycm9yKGVycik7XG4gICAgfVxuXG4gICAgdGhpcy5fY2hlY2twb2ludHMucHVzaChjaGVja3BvaW50KTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBFcnJvciBIYW5kbGluZ1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICAvKipcbiAgICogUmVjb3JkIGFuIGV4Y2VwdGlvbiBvbiB0aGlzIHNwYW4uXG4gICAqIE1hcmtzIHRoZSBzcGFuIGFzIGhhdmluZyBhbiBlcnJvciBhbmQgY2FwdHVyZXMgZXhjZXB0aW9uIGRldGFpbHMuXG4gICAqL1xuICByZWNvcmRFeGNlcHRpb24oZXhjZXB0aW9uOiBFcnJvciB8IHN0cmluZyk6IHRoaXMge1xuICAgIGNvbnN0IGVycm9yID0gbm9ybWFsaXplRXJyb3IoZXhjZXB0aW9uKTtcbiAgICB0aGlzLl9oYXNFcnJvciA9IHRydWU7XG4gICAgdGhpcy5jaGVja3BvaW50KCdleGNlcHRpb24nKTtcbiAgICB0aGlzLl9kYXRhWyAnZXhjZXB0aW9uJyBdID0ge1xuICAgICAgdHlwZTogZXJyb3IubmFtZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgfTtcbiAgICB0aGlzLl90YWdzWyAnZXJyb3InIF0gPSAndHJ1ZSc7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gUFJJTUFSWSBBUEk6IHdyYXAoKSAtIEhhbmRsZXMgYm90aCBzeW5jIGFuZCBhc3luYyBhdXRvbWF0aWNhbGx5XG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBXcmFwIGEgZnVuY3Rpb24gaW4gYSBzcGFuIC0gaGFuZGxlcyBib3RoIHN5bmMgYW5kIGFzeW5jIGF1dG9tYXRpY2FsbHkuXG4gICAqIFRoaXMgaXMgdGhlIFBSRUZFUlJFRCBBUEkgZm9yIGRlY29yYXRvcnMgYW5kIHVua25vd24gc3luYy9hc3luYyBzaXR1YXRpb25zLlxuICAgKi9cbiAgc3RhdGljIHdyYXA8Uj4oXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgZm46ICgpID0+IFByb21pc2U8Uj4sXG4gICAgb3B0aW9ucz86IFNwYW5PcHRpb25zICYge1xuICAgICAgLyoqIENhbGxlZCBpbW1lZGlhdGVseSBhZnRlciBzcGFuIGlzIGNyZWF0ZWQgYW5kIG1hZGUgY3VycmVudCAoYmVmb3JlIGludm9raW5nIGZuKS4gKi9cbiAgICAgIG9uU3RhcnQ/OiAoc3BhbjogU3Bhbk9ic2VydmVyKSA9PiB2b2lkO1xuICAgICAgLyoqIENhbGxlZCBiZWZvcmUgc3Bhbi5lbmQoKSB3aXRoIHJlc3VsdC9lcnJvci4gKi9cbiAgICAgIG9uRmluaXNoPzogKHNwYW46IFNwYW5PYnNlcnZlciwgcmVzdWx0OiB7IHZhbHVlPzogdW5rbm93bjsgZXJyb3I/OiBFcnJvcjsgc3VjY2VzczogYm9vbGVhbjsgZHVyYXRpb25NczogbnVtYmVyIH0pID0+IHZvaWQ7XG4gICAgfVxuICApOiBQcm9taXNlPFI+O1xuICBzdGF0aWMgd3JhcDxSPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKCkgPT4gUixcbiAgICBvcHRpb25zPzogU3Bhbk9wdGlvbnMgJiB7XG4gICAgICAvKiogQ2FsbGVkIGltbWVkaWF0ZWx5IGFmdGVyIHNwYW4gaXMgY3JlYXRlZCBhbmQgbWFkZSBjdXJyZW50IChiZWZvcmUgaW52b2tpbmcgZm4pLiAqL1xuICAgICAgb25TdGFydD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIpID0+IHZvaWQ7XG4gICAgICAvKiogQ2FsbGVkIGJlZm9yZSBzcGFuLmVuZCgpIHdpdGggcmVzdWx0L2Vycm9yLiAqL1xuICAgICAgb25GaW5pc2g/OiAoc3BhbjogU3Bhbk9ic2VydmVyLCByZXN1bHQ6IHsgdmFsdWU/OiB1bmtub3duOyBlcnJvcj86IEVycm9yOyBzdWNjZXNzOiBib29sZWFuOyBkdXJhdGlvbk1zOiBudW1iZXIgfSkgPT4gdm9pZDtcbiAgICB9XG4gICk6IFI7XG4gIHN0YXRpYyB3cmFwPFI+KFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBSIHwgUHJvbWlzZTxSPixcbiAgICBvcHRpb25zPzogU3Bhbk9wdGlvbnMgJiB7XG4gICAgICAvKiogQ2FsbGVkIGltbWVkaWF0ZWx5IGFmdGVyIHNwYW4gaXMgY3JlYXRlZCBhbmQgbWFkZSBjdXJyZW50IChiZWZvcmUgaW52b2tpbmcgZm4pLiAqL1xuICAgICAgb25TdGFydD86IChzcGFuOiBTcGFuT2JzZXJ2ZXIpID0+IHZvaWQ7XG4gICAgICAvKiogQ2FsbGVkIGJlZm9yZSBzcGFuLmVuZCgpIHdpdGggcmVzdWx0L2Vycm9yLiAqL1xuICAgICAgb25GaW5pc2g/OiAoc3BhbjogU3Bhbk9ic2VydmVyLCByZXN1bHQ6IHsgdmFsdWU/OiB1bmtub3duOyBlcnJvcj86IEVycm9yOyBzdWNjZXNzOiBib29sZWFuOyBkdXJhdGlvbk1zOiBudW1iZXIgfSkgPT4gdm9pZDtcbiAgICB9XG4gICk6IFIgfCBQcm9taXNlPFI+IHtcbiAgICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICAgIGlmICghY3R4KSB7XG4gICAgICByZXR1cm4gZm4oKTtcbiAgICB9XG5cbiAgICBjb25zdCBvcHRzID0gb3B0aW9ucyA/PyB7fTtcbiAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLmNyZWF0ZVNwYW4ob3BlcmF0aW9uLCBvcHRzKTtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgcmV0dXJuIHdpdGhDdXJyZW50U3BhbihzcGFuLCAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBvcHRzLm9uU3RhcnQ/LihzcGFuKTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZm4oKTtcblxuICAgICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHRcbiAgICAgICAgICAgIC50aGVuKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBkdXJhdGlvbk1zID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgICAgICAgb3B0cy5vbkZpbmlzaD8uKHNwYW4sIHsgdmFsdWUsIHN1Y2Nlc3M6IHRydWUsIGR1cmF0aW9uTXMgfSk7XG4gICAgICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRFcnJvciA9IG5vcm1hbGl6ZUVycm9yKGVycm9yKTtcbiAgICAgICAgICAgICAgb3B0cy5vbkZpbmlzaD8uKHNwYW4sIHsgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciwgc3VjY2VzczogZmFsc2UsIGR1cmF0aW9uTXMgfSk7XG4gICAgICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVkRXJyb3IgfSk7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgZHVyYXRpb25NcyA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgICAgICAgb3B0cy5vbkZpbmlzaD8uKHNwYW4sIHsgdmFsdWU6IHJlc3VsdCwgc3VjY2VzczogdHJ1ZSwgZHVyYXRpb25NcyB9KTtcbiAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoc3luY0Vycm9yKSB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uTXMgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICBjb25zdCBub3JtYWxpemVkRXJyb3IgPSBub3JtYWxpemVFcnJvcihzeW5jRXJyb3IpO1xuICAgICAgICBvcHRzLm9uRmluaXNoPy4oc3BhbiwgeyBlcnJvcjogbm9ybWFsaXplZEVycm9yLCBzdWNjZXNzOiBmYWxzZSwgZHVyYXRpb25NcyB9KTtcbiAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IG5vcm1hbGl6ZWRFcnJvciB9KTtcbiAgICAgICAgdGhyb3cgc3luY0Vycm9yO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFNFQ09OREFSWSBBUEk6IHdpdGhTcGFuKCkgLSBFeHBsaWNpdCBhc3luYyB3aXRoIHNwYW4gYWNjZXNzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIGFzeW5jIGZ1bmN0aW9uIHdpdGhpbiBhIHNwYW4gc2NvcGUuXG4gICAqIFVzZSB3aGVuIHlvdSBuZWVkIGFjY2VzcyB0byB0aGUgc3BhbiBpbnN0YW5jZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3aXRoU3BhbjxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IFNwYW5PYnNlcnZlcikgPT4gUHJvbWlzZTxUPixcbiAgICBvcHRpb25zOiBTcGFuT3B0aW9ucyA9IHt9XG4gICk6IFByb21pc2U8VD4ge1xuICAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgaWYgKCFjdHgpIHtcbiAgICAgIGNvbnN0IGR1bW15U3BhbiA9IG5ldyBTcGFuT2JzZXJ2ZXIoXG4gICAgICAgIGdlbmVyYXRlSWQoKSwgb3BlcmF0aW9uLCB1bmRlZmluZWQsIGZhbHNlLCBvcHRpb25zLCBvcHRpb25zLmNvcnJlbGF0aW9uSWRcbiAgICAgICk7XG4gICAgICByZXR1cm4gZm4oZHVtbXlTcGFuKTtcbiAgICB9XG5cbiAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLmNyZWF0ZVNwYW4ob3BlcmF0aW9uLCBvcHRpb25zKTtcblxuICAgIHJldHVybiB3aXRoQ3VycmVudFNwYW4oc3BhbiwgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZm4oc3Bhbik7XG4gICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnJvcikgfSk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4ZWN1dGUgc3luYyBmdW5jdGlvbiB3aXRoaW4gYSBzcGFuIHNjb3BlLlxuICAgKi9cbiAgc3RhdGljIHdpdGhTcGFuU3luYzxUPihcbiAgICBvcGVyYXRpb246IHN0cmluZyxcbiAgICBmbjogKHNwYW46IFNwYW5PYnNlcnZlcikgPT4gVCxcbiAgICBvcHRpb25zOiBTcGFuT3B0aW9ucyA9IHt9XG4gICk6IFQge1xuICAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgaWYgKCFjdHgpIHtcbiAgICAgIGNvbnN0IGR1bW15U3BhbiA9IG5ldyBTcGFuT2JzZXJ2ZXIoXG4gICAgICAgIGdlbmVyYXRlSWQoKSwgb3BlcmF0aW9uLCB1bmRlZmluZWQsIGZhbHNlLCBvcHRpb25zLCBvcHRpb25zLmNvcnJlbGF0aW9uSWRcbiAgICAgICk7XG4gICAgICByZXR1cm4gZm4oZHVtbXlTcGFuKTtcbiAgICB9XG5cbiAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLmNyZWF0ZVNwYW4ob3BlcmF0aW9uLCBvcHRpb25zKTtcblxuICAgIHJldHVybiB3aXRoQ3VycmVudFNwYW4oc3BhbiwgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gZm4oc3Bhbik7XG4gICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnJvcikgfSk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEFEVkFOQ0VEIEFQSTogc3RhcnQoKSAtIE1hbnVhbCBtYW5hZ2VtZW50IChhdm9pZCBpbiBtb3N0IGNhc2VzKVxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICAvKipcbiAgICogU3RhcnQgYSBzcGFuIHdpdGhvdXQgYXV0b21hdGljIHNjb3BlIG1hbmFnZW1lbnQuXG4gICAqIFdBUk5JTkc6IFRoaXMgZG9lcyBOT1Qgc2V0IHRoZSBzcGFuIGFzIGN1cnJlbnQgaW4gY29udGV4dC5cbiAgICogUHJlZmVyIHdyYXAoKSBvciB3aXRoU3BhbigpIGZvciBwcm9wZXIgcGFyZW50IHRyYWNraW5nLlxuICAgKi9cbiAgc3RhdGljIHN0YXJ0KG9wZXJhdGlvbjogc3RyaW5nLCBvcHRpb25zOiBTcGFuT3B0aW9ucyA9IHt9KTogU3Bhbk9ic2VydmVyIHtcbiAgICByZXR1cm4gU3Bhbk9ic2VydmVyLmNyZWF0ZVNwYW4ob3BlcmF0aW9uLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBJbnRlcm5hbDogU3BhbiBDcmVhdGlvblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBwcml2YXRlIHN0YXRpYyBjcmVhdGVTcGFuKG9wZXJhdGlvbjogc3RyaW5nLCBvcHRpb25zOiBTcGFuT3B0aW9ucyk6IFNwYW5PYnNlcnZlciB7XG4gICAgY29uc3Qgc3RhdGUgPSBnZXRPYnNlcnZhYmlsaXR5U3RhdGUoKTtcbiAgICBjb25zdCBwYXJlbnQgPSBzdGF0ZT8uY3VycmVudFNwYW47XG4gICAgLy8gSU1QT1JUQU5UOiBPYnNlcnZhYmlsaXR5TG9nIElEcyBtdXN0IGJlIGdsb2JhbGx5IHVuaXF1ZSBpbiBEeW5hbW9EQi5cbiAgICAvLyBXZSBuYW1lc3BhY2UgSURzIGJ5IGNvcnJlbGF0aW9uSWQgdG8gZWxpbWluYXRlIGNvbGxpc2lvbiByaXNrIGF0IHNjYWxlLlxuICAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IG9wdGlvbnMuY29ycmVsYXRpb25JZCA/PyBjdHg/LmNvcnJlbGF0aW9uSWQ7XG4gICAgY29uc3QgaWQgPSBjb3JyZWxhdGlvbklkID8gZ2VuZXJhdGVPYnNlcnZhYmlsaXR5TG9nSWQoY29ycmVsYXRpb25JZCkgOiBnZW5lcmF0ZUlkKCk7XG5cbiAgICBpZiAob3B0aW9ucy5za2lwQ2FwdHVyZSkge1xuICAgICAgcmV0dXJuIG5ldyBTcGFuT2JzZXJ2ZXIoaWQsIG9wZXJhdGlvbiwgcGFyZW50LCBmYWxzZSwgb3B0aW9ucywgY29ycmVsYXRpb25JZCwgdW5kZWZpbmVkKTtcbiAgICB9XG5cbiAgICAvLyBQYXJlbnQgcmVzb2x1dGlvbjpcbiAgICAvLyAtIElmIGNhbGxlciBleHBsaWNpdGx5IHByb3ZpZGVzIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCAoaW5jbHVkaW5nIG51bGwpLCB1c2UgaXQuXG4gICAgLy8gLSBPdGhlcndpc2UgZGVyaXZlIGZyb20gY3VycmVudCBpbi1tZW1vcnkgc3BhbiB0cmVlLlxuICAgIC8vXG4gICAgLy8gSU1QT1JUQU5UOlxuICAgIC8vIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBzdHJpY3QgaW4tc2xpY2UgaGllcmFyY2h5LiBEbyBOT1Qgc2V0IGl0IHRvIGEgcmVtb3RlIHBhcmVudC5cbiAgICBjb25zdCBleHBsaWNpdFBhcmVudCA9IG9wdGlvbnMucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGNvbnN0IGRlcml2ZWRQYXJlbnRMb2dJZCA9IHBhcmVudFxuICAgICAgPyAocGFyZW50LmNhcHR1cmVkID8gcGFyZW50LmlkIDogZ2V0Q2FwdHVyZWRQYXJlbnRJZChwYXJlbnQpKVxuICAgICAgOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgcGFyZW50TG9nSWQgPSBleHBsaWNpdFBhcmVudCA9PT0gdW5kZWZpbmVkXG4gICAgICA/IGRlcml2ZWRQYXJlbnRMb2dJZFxuICAgICAgOiAoZXhwbGljaXRQYXJlbnQgPT09IG51bGwgPyB1bmRlZmluZWQgOiBleHBsaWNpdFBhcmVudCk7XG5cbiAgICBjb25zdCBzdGFydFRpbWVNcyA9IERhdGUubm93KCk7XG5cbiAgICAvLyBOb3RpZnkgbGlmZWN5Y2xlIGhvb2tzIChPVEVMIGFuZCBvdGhlciByZWFsLXRpbWUgYmFja2VuZHMpIHN5bmNocm9ub3VzbHkuXG4gICAgLy8gVGhpcyByZXBsYWNlcyB0aGUgb2xkIGFwcHJvYWNoIG9mIGVtaXR0aW5nIHNwYW4uc3RhcnQgZXZlbnRzIHRocm91Z2ggdGhlIGNhcHR1cmUgcGlwZWxpbmUuXG4gICAgY29uc3QgaG9va3MgPSBnZXRTcGFuTGlmZWN5Y2xlSG9va3MoKTtcbiAgICBpZiAoaG9va3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc3RhcnRJbmZvOiBTcGFuU3RhcnRJbmZvID0ge1xuICAgICAgICBpZCxcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICBwYXJlbnRJZDogcGFyZW50TG9nSWQsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQgPz8gJycsXG4gICAgICAgIGNhdXNlZEJ5OiBvcHRpb25zLmNhdXNlZEJ5LFxuICAgICAgICBzb3VyY2U6IG9wdGlvbnMuc291cmNlID8/IHN0YXRlPy5zb3VyY2UsXG4gICAgICAgIHN1YlR5cGU6IHVuZGVmaW5lZCwgLy8gc3Bhbi1sZXZlbCBzdWJUeXBlIG5vdCB0eXBpY2FsbHkgc2V0IGF0IHN0YXJ0XG4gICAgICAgIHRhZ3M6IG1lcmdlVGFncyhzdGF0ZT8udGFncywgb3B0aW9ucy50YWdzKSxcbiAgICAgICAgc3RhcnRUaW1lTXMsXG4gICAgICB9O1xuICAgICAgZm9yIChjb25zdCBob29rIG9mIGhvb2tzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaG9vay5vblNwYW5TdGFydChzdGFydEluZm8pO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci53YXJuKCdTcGFuTGlmZWN5Y2xlSG9vay5vblNwYW5TdGFydCBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc3BhbiA9IG5ldyBTcGFuT2JzZXJ2ZXIoaWQsIG9wZXJhdGlvbiwgcGFyZW50LCB0cnVlLCBvcHRpb25zLCBjb3JyZWxhdGlvbklkLCBwYXJlbnRMb2dJZCk7XG4gICAgcmVnaXN0ZXJTcGFuKHNwYW4pO1xuICAgIHJldHVybiBzcGFuO1xuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFN0YXRpYyBVdGlsaXRpZXNcbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgLyoqXG4gICAqIEdldCB0aGUgY3VycmVudGx5IGFjdGl2ZSBzcGFuIGZyb20gY29udGV4dC5cbiAgICovXG4gIHN0YXRpYyBnZXRDdXJyZW50U3BhbigpOiBTcGFuT2JzZXJ2ZXIgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRPYnNlcnZhYmlsaXR5U3RhdGUoKT8uY3VycmVudFNwYW47XG4gICAgLy8gY3VycmVudFNwYW4gaXMgb25seSBldmVyIHNldCBieSBTcGFuT2JzZXJ2ZXIsIGJ1dCB3ZSBrZWVwIHRoZSBydW50aW1lIGNoZWNrIGNvbnNlcnZhdGl2ZS5cbiAgICByZXR1cm4gY3VycmVudCBpbnN0YW5jZW9mIFNwYW5PYnNlcnZlciA/IGN1cnJlbnQgOiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gTGlmZWN5Y2xlOiBlbmQoKVxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBlbmQob3B0aW9ucz86IFNwYW5FbmRPcHRpb25zKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuZW5kZWQpIHJldHVybjtcbiAgICB0aGlzLmVuZGVkID0gdHJ1ZTtcblxuICAgIGlmICghdGhpcy5jYXB0dXJlZCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZW5kVGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3QgZHVyYXRpb24gPSBlbmRUaW1lIC0gdGhpcy5zdGFydFRpbWU7XG4gICAgY29uc3QgaGFzRXJyb3IgPSAhIW9wdGlvbnM/LmVycm9yIHx8IG9wdGlvbnM/LnN1Y2Nlc3MgPT09IGZhbHNlO1xuXG4gICAgaWYgKGhhc0Vycm9yKSB7XG4gICAgICB0aGlzLl9oYXNFcnJvciA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gSU1QT1JUQU5UOlxuICAgIC8vIERvIE5PVCBkcm9wIHNwYW5zIGhlcmUuXG4gICAgLy9cbiAgICAvLyBXaGV0aGVyIGEgc3BhbiBjYW4gYmUgZHJvcHBlZCBkZXBlbmRzIG9uIHdoZXRoZXIgaXQgaGFzIGFueSBjaGlsZHJlbiAoZ3JhcGggcHJvcGVydHkpLFxuICAgIC8vIHdoaWNoIGNhbiBvbmx5IGJlIGtub3duIHJlbGlhYmx5IGF0IGZsdXNoLXRpbWUgb25jZSBhbGwgZXZlbnRzIGFyZSBidWZmZXJlZC5cblxuICAgIGNvbnN0IHsgbGV2ZWwsIHNraXBDYXB0dXJlLCBtZXRyaWNzLCBkYXRhLCB0YWdzLCAuLi5vdmVycmlkZXMgfSA9IHRoaXMub3B0aW9ucztcblxuICAgIC8vIEJ1aWxkIGVycm9yIGluZm9cbiAgICBsZXQgZXJyb3JJbmZvOiBPYnNlcnZhYmlsaXR5RXJyb3IgfCB1bmRlZmluZWQ7XG4gICAgaWYgKG9wdGlvbnM/LmVycm9yKSB7XG4gICAgICBlcnJvckluZm8gPSB7XG4gICAgICAgIHR5cGU6IG9wdGlvbnMuZXJyb3IubmFtZSxcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5lcnJvci5tZXNzYWdlLFxuICAgICAgICBzdGFjazogb3B0aW9ucy5lcnJvci5zdGFjayxcbiAgICAgICAgY29kZTogJ2NvZGUnIGluIG9wdGlvbnMuZXJyb3IgJiYgdHlwZW9mIG9wdGlvbnMuZXJyb3IuY29kZSA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IG9wdGlvbnMuZXJyb3IuY29kZVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBCdWlsZCBmaW5hbCBtZXRyaWNzIChkdXJhdGlvbiBhbmQgc3Bhbi5kZXB0aCBhbHdheXMgaW5jbHVkZWQpXG4gICAgY29uc3QgZmluYWxNZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge1xuICAgICAgZHVyYXRpb24sXG4gICAgICAnc3Bhbi5kZXB0aCc6IHRoaXMuZGVwdGgsXG4gICAgICAuLi50aGlzLl9tZXRyaWNzLFxuICAgICAgLi4ub3B0aW9ucz8ubWV0cmljcyxcbiAgICB9O1xuXG4gICAgLy8gQnVpbGQgZmluYWwgZGF0YVxuICAgIGNvbnN0IGZpbmFsRGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICAuLi50aGlzLl9kYXRhLFxuICAgICAgLi4ub3B0aW9ucz8uZGF0YSxcbiAgICB9O1xuXG4gICAgLy8gTWFyayB3aGV0aGVyIHRoaXMgc3BhbiB3YXMgXCJlbXB0eVwiIChubyB1c2VmdWwgY29udGVudCBiZXlvbmQgdGltaW5nKS5cbiAgICAvLyBGbHVzaC10aW1lIGxvZ2ljIGNhbiBzYWZlbHkgZHJvcCBlbXB0eSAqbGVhZiogc3BhbnMgd2hlbiBjb25maWd1cmVkLlxuICAgIGNvbnN0IGlzRW1wdHlTcGFuID0gIXRoaXMuaGFzQ29udGVudCAmJiAhaGFzRXJyb3I7XG4gICAgaWYgKGlzRW1wdHlTcGFuKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGZpbmFsRGF0YS5fZncyNDtcbiAgICAgIGNvbnN0IGJhc2UgPSAoZXhpc3RpbmcgJiYgdHlwZW9mIGV4aXN0aW5nID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShleGlzdGluZykpXG4gICAgICAgID8gKGV4aXN0aW5nIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICA6IHt9O1xuICAgICAgZmluYWxEYXRhLl9mdzI0ID0geyAuLi5iYXNlLCBzcGFuRW1wdHk6IHRydWUgfTtcbiAgICB9XG5cbiAgICAvLyBBZGQgY2hlY2twb2ludHMgdG8gZGF0YSBpZiBhbnlcbiAgICBpZiAodGhpcy5fY2hlY2twb2ludHMubGVuZ3RoID4gMCkge1xuICAgICAgZmluYWxEYXRhLmNoZWNrcG9pbnRzID0gdGhpcy5fY2hlY2twb2ludHM7XG4gICAgfVxuXG4gICAgY29uc3QgZmluYWxEYXRhT3JVbmRlZmluZWQgPSBPYmplY3Qua2V5cyhmaW5hbERhdGEpLmxlbmd0aCA+IDAgPyBmaW5hbERhdGEgOiB1bmRlZmluZWQ7XG4gICAgY29uc3Qgc3VjY2VzcyA9IG9wdGlvbnM/LnN1Y2Nlc3MgPz8gIW9wdGlvbnM/LmVycm9yO1xuXG4gICAgLy8gTm90aWZ5IGxpZmVjeWNsZSBob29rcyAoT1RFTCBhbmQgb3RoZXIgcmVhbC10aW1lIGJhY2tlbmRzKSBzeW5jaHJvbm91c2x5LlxuICAgIGNvbnN0IGhvb2tzID0gZ2V0U3BhbkxpZmVjeWNsZUhvb2tzKCk7XG4gICAgaWYgKGhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGVuZEluZm86IFNwYW5FbmRJbmZvID0ge1xuICAgICAgICBpZDogdGhpcy5pZCxcbiAgICAgICAgb3BlcmF0aW9uOiB0aGlzLm9wZXJhdGlvbixcbiAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgZHVyYXRpb25NczogZHVyYXRpb24sXG4gICAgICAgIHN0YXJ0VGltZU1zOiB0aGlzLnN0YXJ0VGltZSxcbiAgICAgICAgcGFyZW50SWQ6IHRoaXMucGFyZW50TG9nSWQsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHRoaXMuY29ycmVsYXRpb25JZCA/PyAnJyxcbiAgICAgICAgY2F1c2VkQnk6IHRoaXMub3B0aW9ucy5jYXVzZWRCeSxcbiAgICAgICAgc291cmNlOiB0aGlzLm9wdGlvbnMuc291cmNlID8/IGdldE9ic2VydmFiaWxpdHlTdGF0ZSgpPy5zb3VyY2UsXG4gICAgICAgIHN1YlR5cGU6IHVuZGVmaW5lZCwgLy8gc3ViVHlwZSBpcyBkZXRlcm1pbmVkIGJ5IHRoZSBjYXB0dXJlIHBpcGVsaW5lLCBub3QgYXQgc3BhbiBsZXZlbFxuICAgICAgICBlcnJvcjogZXJyb3JJbmZvLFxuICAgICAgICB0YWdzOiBPYmplY3Qua2V5cyh0aGlzLl90YWdzKS5sZW5ndGggPiAwID8gdGhpcy5fdGFncyA6IHVuZGVmaW5lZCxcbiAgICAgICAgbWV0cmljczogT2JqZWN0LmtleXMoZmluYWxNZXRyaWNzKS5sZW5ndGggPiAwID8gZmluYWxNZXRyaWNzIDogdW5kZWZpbmVkLFxuICAgICAgICBkYXRhOiBmaW5hbERhdGFPclVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgaG9va3MpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBob29rLm9uU3BhbkVuZChlbmRJbmZvKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIud2FybignU3BhbkxpZmVjeWNsZUhvb2sub25TcGFuRW5kIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBFbWl0IGNvbnNvbGlkYXRlZCBzcGFuIHJlY29yZCB0byB0aGUgYnVmZmVyZWQgY2FwdHVyZSBwaXBlbGluZSAoZm9yIER5bmFtb0RCL0Nsb3VkV2F0Y2gpLlxuICAgIC8vIENSSVRJQ0FMOiBQYXNzIG51bGwgZXhwbGljaXRseSBpZiBubyBwYXJlbnQgdG8gcHJldmVudCBmYWxsYmFjayB0byBnZXRDdXJyZW50UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKClcbiAgICAvLyB3aGljaCB3b3VsZCByZXR1cm4gVEhJUyBzcGFuJ3MgSUQgKGNhdXNpbmcgc2VsZi1yZWZlcmVuY2UgYnVnKVxuICAgIGNhcHR1cmVSZWNvcmQoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgLy8gSU1QT1JUQU5UOlxuICAgICAgLy8gU3BhbiBlbmQgY2FuIG9jY3VyIGFmdGVyIHRoZSBhc3luYyBleGVjdXRpb24gY29udGV4dCBoYXMgdW53b3VuZCAoQUxTIGJvdW5kYXJ5KSxcbiAgICAgIC8vIGVzcGVjaWFsbHkgaW4gcXVldWUvYmF0Y2ggcHJvY2Vzc29ycy4gU3RvcmUgY29ycmVsYXRpb25JZCBhdCBzcGFuIGNyZWF0aW9uIHRpbWUgYW5kXG4gICAgICAvLyBwYXNzIGl0IGV4cGxpY2l0bHkgc28gd2UgbmV2ZXIgZW5kIHVwIHdpdGggc3Bhbi5zdGFydCBidXQgbm8gc3BhbiByZWNvcmQuXG4gICAgICBjb3JyZWxhdGlvbklkOiB0aGlzLmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IHRoaXMuaWQsXG4gICAgICBsZXZlbDogb3B0aW9ucz8uZXJyb3IgPyAnZXJyb3InIDogdGhpcy5sZXZlbCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdGhpcy5wYXJlbnRMb2dJZCA/PyBudWxsLFxuICAgICAgLy8gSU1QT1JUQU5UOlxuICAgICAgLy8gVXNlIHNwYW4gKnN0YXJ0KiB0aW1lc3RhbXAgZm9yIG9yZGVyaW5nIGluIER5bmFtb0RCL1VJLlxuICAgICAgLy8gRHVyYXRpb25NcyBzdGlsbCByZXByZXNlbnRzIGVuZC1zdGFydCwgc28gdGhlIGVuZCB0aW1lc3RhbXAgaXMgZGVyaXZhYmxlIGFzICh0aW1lc3RhbXBNcyArIGR1cmF0aW9uTXMpLlxuICAgICAgLy8gVXNpbmcgZW5kVGltZSBoZXJlIGNhdXNlcyBzcGFucyB0byBhcHBlYXIgYWZ0ZXIgdGhlaXIgY2hpbGRyZW4sIHdoaWNoIGJyZWFrcyB0aW1lbGluZSBvcmRlcmluZyBpbiB0aGUgVUkuXG4gICAgICB0aW1lc3RhbXBNczogdGhpcy5zdGFydFRpbWUsXG4gICAgICBkdXJhdGlvbk1zOiBkdXJhdGlvbixcbiAgICAgIG9wZXJhdGlvbjogdGhpcy5vcGVyYXRpb24sXG4gICAgICBzdWNjZXNzLFxuICAgICAgc3RhdHVzOiBvcHRpb25zPy5zdGF0dXMgPz8gKG9wdGlvbnM/LmVycm9yID8gJ2ZhaWxlZCcgOiAnY29tcGxldGVkJyksXG4gICAgICB0YWdzOiB0aGlzLl90YWdzLFxuICAgICAgbWV0cmljczogZmluYWxNZXRyaWNzLFxuICAgICAgZGF0YTogZmluYWxEYXRhT3JVbmRlZmluZWQsXG4gICAgICBlcnJvcjogZXJyb3JJbmZvLFxuICAgICAgY2FwdHVyZToge1xuICAgICAgICAuLi50aGlzLm9wdGlvbnMuY2FwdHVyZSxcbiAgICAgIH0sXG4gICAgICAuLi5vdmVycmlkZXMsXG4gICAgICAvLyBEeW5hbWljIGVudGl0eSBjb250ZXh0IChzZXRFbnRpdHkpIHRha2VzIHByaW9yaXR5IG92ZXIgc3RhdGljIG9wdGlvbnNcbiAgICAgIC4uLih0aGlzLl9lbnRpdHlOYW1lICYmIHsgZW50aXR5TmFtZTogdGhpcy5fZW50aXR5TmFtZSB9KSxcbiAgICAgIC4uLih0aGlzLl9lbnRpdHlJZCAmJiB7IGVudGl0eUlkOiB0aGlzLl9lbnRpdHlJZCB9KSxcbiAgICB9KTtcblxuICAgIC8vIE5PVEU6IFNwYW4gcGFyZW50L2NoaWxkIGludGVncml0eSBpcyBlbmZvcmNlZCBhdCBmbHVzaC10aW1lIGJ5IGFuYWx5emluZyB0aGUgYnVmZmVyZWQgZ3JhcGguXG4gIH1cbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBDb252ZW5pZW5jZSBFeHBvcnRzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGNvbnN0IHdpdGhTcGFuID0gU3Bhbk9ic2VydmVyLndpdGhTcGFuLmJpbmQoU3Bhbk9ic2VydmVyKTtcbmV4cG9ydCBjb25zdCB3aXRoU3BhblN5bmMgPSBTcGFuT2JzZXJ2ZXIud2l0aFNwYW5TeW5jLmJpbmQoU3Bhbk9ic2VydmVyKTtcbmV4cG9ydCBjb25zdCB3cmFwSW5TcGFuID0gU3Bhbk9ic2VydmVyLndyYXAuYmluZChTcGFuT2JzZXJ2ZXIpO1xuIl19