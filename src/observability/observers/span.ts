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
import {
  getCurrentExecutionContext,
  getObservabilityState,
  withCurrentSpan,
  getCapturedParentId,
} from '../../core/runtime/execution-context/storage';
import type { ObservabilityLevelString, RecordOverrides, ObservabilityError, SpanConfig } from '../types';
import {
  generateId,
  captureRecord,
  normalizeError,
  mergeTags,
} from './base';
import { createLogger } from '../../logging';
import { CONFIG_DEFAULTS } from '../config';
import { generateObservabilityLogId } from '../utils/id-generator';
import { getCurrentObservabilityConfig, setSpanFinalizer } from '../runtime-state';

/** Checkpoint entry - simple timeline marker */
interface Checkpoint {
  name: string;
  ts: number;
}

/** 
 * Get span config from ObservabilityManager (already cached).
 * Returns empty object if not initialized yet.
 */
function getSpanConfig(): SpanConfig {
  return getCurrentObservabilityConfig()?.spans ?? CONFIG_DEFAULTS.spans;
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
const spansByContext = new WeakMap<object, Set<SpanObserver>>();

function registerSpan(span: SpanObserver): void {
  const ctx = getCurrentExecutionContext();
  if (!ctx) return;
  const key = ctx.observability.contextKey;
  const set = spansByContext.get(key);
  if (set) set.add(span);
  else spansByContext.set(key, new Set([ span ]));
}

function finalizeOpenSpansForCurrentContext(): void {
  const ctx = getCurrentExecutionContext();
  if (!ctx) return;
  const set = spansByContext.get(ctx.observability.contextKey);
  if (!set) return;

  for (const span of set) {
    if (!span.ended) {
      // Force-close: a span left open until flush is a bug in user code or framework wiring.
      // We end it as "abandoned" so it is visible and does not break hierarchy.
      span.end({ success: false, status: 'abandoned' });
    }
  }
}

// Register finalizer so ObservabilityManager.flush() can call it without importing SpanObserver (avoid cycles).
setSpanFinalizer(finalizeOpenSpansForCurrentContext);

const logger = createLogger('SpanObserver');
const OBSERVER_NAME = 'SpanObserver';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

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

  // Clean API
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

  // Lifecycle
  end(options?: SpanEndOptions): void;

  // Error handling
  recordException(exception: Error | string): this;
}


// ═══════════════════════════════════════════════════════════════════════════
// SpanObserver Implementation
// ═══════════════════════════════════════════════════════════════════════════

export class SpanObserver implements ISpanObserver {
  readonly id: string;
  readonly operation: string;
  readonly parent?: ISpanNode;
  readonly captured: boolean;
  readonly parentLogId: string | undefined;
  private readonly correlationId: string | undefined;

  private readonly options: SpanOptions;
  private readonly level: ObservabilityLevelString;
  private readonly startTime: number;

  // Clean data storage
  private _tags: Record<string, string> = {};
  private _metrics: Record<string, number> = {};
  private _data: Record<string, unknown> = {};
  private _checkpoints: Checkpoint[] = [];

  // State tracking
  private _hasError = false;
  // NOTE: We no longer mutate spans to track "has children".
  // Parent/span integrity is handled centrally via explicit reference tracking in execution-context state.
  // NOTE: Used by the flush-time span finalizer to close spans left open by user/framework code.
  public ended = false;

  private constructor(
    id: string,
    operation: string,
    parent: ISpanNode | undefined,
    captured: boolean,
    options: SpanOptions,
    correlationId: string | undefined,
    parentLogIdVal: string | undefined = undefined
  ) {
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

  get traceId(): string {
    const ctx = getCurrentExecutionContext();
    return this.correlationId ?? this.options.correlationId ?? ctx?.correlationId ?? '';
  }

  /** Check if span has any content worth capturing */
  get hasContent(): boolean {
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
  tag(key: string, value: string | number | boolean): this {
    this._tags[ key ] = String(value);
    return this;
  }

  /**
   * Set multiple tags at once.
   */
  tags(tags: Record<string, string | number | boolean>): this {
    for (const [ key, value ] of Object.entries(tags)) {
      this._tags[ key ] = String(value);
    }
    return this;
  }

  /**
   * Record a numeric metric for dashboards/aggregation.
   */
  metric(key: string, value: number): this {
    this._metrics[ key ] = value;
    return this;
  }

  /**
   * Record multiple metrics at once.
   */
  metrics(metrics: Record<string, number>): this {
    Object.assign(this._metrics, metrics);
    return this;
  }

  /**
   * Set debug data payload.
   * Data is NOT indexed - use for debugging inspection only.
   */
  setData(data: Record<string, unknown>): this {
    Object.assign(this._data, data);
    return this;
  }

  /**
   * Add a checkpoint to the timeline.
   * Checkpoints are simple markers of what happened when.
   */
  checkpoint(name: string, options?: {
    metrics?: Record<string, number>;
    data?: Record<string, unknown>;
    tags?: Record<string, string>;
    error?: Error | string;
  }): this {
    if (!this.captured) return this;
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
  recordException(exception: Error | string): this {
    const error = normalizeError(exception);
    this._hasError = true;
    this.checkpoint('exception');
    this._data[ 'exception' ] = {
      type: error.name,
      message: error.message,
      stack: error.stack,
    };
    this._tags[ 'error' ] = 'true';
    return this;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIMARY API: wrap() - Handles both sync and async automatically
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Wrap a function in a span - handles both sync and async automatically.
   * This is the PREFERRED API for decorators and unknown sync/async situations.
   */
  static wrap<R>(
    operation: string,
    fn: () => Promise<R>,
    options?: SpanOptions & {
      /** Called immediately after span is created and made current (before invoking fn). */
      onStart?: (span: SpanObserver) => void;
      /** Called before span.end() with result/error. */
      onFinish?: (span: SpanObserver, result: { value?: unknown; error?: Error; success: boolean; durationMs: number }) => void;
    }
  ): Promise<R>;
  static wrap<R>(
    operation: string,
    fn: () => R,
    options?: SpanOptions & {
      /** Called immediately after span is created and made current (before invoking fn). */
      onStart?: (span: SpanObserver) => void;
      /** Called before span.end() with result/error. */
      onFinish?: (span: SpanObserver, result: { value?: unknown; error?: Error; success: boolean; durationMs: number }) => void;
    }
  ): R;
  static wrap<R>(
    operation: string,
    fn: () => R | Promise<R>,
    options?: SpanOptions & {
      /** Called immediately after span is created and made current (before invoking fn). */
      onStart?: (span: SpanObserver) => void;
      /** Called before span.end() with result/error. */
      onFinish?: (span: SpanObserver, result: { value?: unknown; error?: Error; success: boolean; durationMs: number }) => void;
    }
  ): R | Promise<R> {
    const ctx = getCurrentExecutionContext();
    if (!ctx) {
      return fn();
    }

    const opts = options ?? {};
    const span = SpanObserver.createSpan(operation, opts);
    const startTime = Date.now();

    return withCurrentSpan(span, () => {
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
              const normalizedError = normalizeError(error);
              opts.onFinish?.(span, { error: normalizedError, success: false, durationMs });
              span.end({ success: false, error: normalizedError });
              throw error;
            });
        } else {
          const durationMs = Date.now() - startTime;
          opts.onFinish?.(span, { value: result, success: true, durationMs });
          span.end({ success: true });
          return result;
        }
      } catch (syncError) {
        const durationMs = Date.now() - startTime;
        const normalizedError = normalizeError(syncError);
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
  static async withSpan<T>(
    operation: string,
    fn: (span: SpanObserver) => Promise<T>,
    options: SpanOptions = {}
  ): Promise<T> {
    const ctx = getCurrentExecutionContext();
    if (!ctx) {
      const dummySpan = new SpanObserver(
        generateId(), operation, undefined, false, options, options.correlationId
      );
      return fn(dummySpan);
    }

    const span = SpanObserver.createSpan(operation, options);

    return withCurrentSpan(span, async () => {
      try {
        const result = await fn(span);
        span.end({ success: true });
        return result;
      } catch (error) {
        span.end({ success: false, error: normalizeError(error) });
        throw error;
      }
    });
  }

  /**
   * Execute sync function within a span scope.
   */
  static withSpanSync<T>(
    operation: string,
    fn: (span: SpanObserver) => T,
    options: SpanOptions = {}
  ): T {
    const ctx = getCurrentExecutionContext();
    if (!ctx) {
      const dummySpan = new SpanObserver(
        generateId(), operation, undefined, false, options, options.correlationId
      );
      return fn(dummySpan);
    }

    const span = SpanObserver.createSpan(operation, options);

    return withCurrentSpan(span, () => {
      try {
        const result = fn(span);
        span.end({ success: true });
        return result;
      } catch (error) {
        span.end({ success: false, error: normalizeError(error) });
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
  static start(operation: string, options: SpanOptions = {}): SpanObserver {
    return SpanObserver.createSpan(operation, options);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal: Span Creation
  // ═══════════════════════════════════════════════════════════════════════════

  private static createSpan(operation: string, options: SpanOptions): SpanObserver {
    const state = getObservabilityState();
    const parent = state?.currentSpan;
    // IMPORTANT: ObservabilityLog IDs must be globally unique in DynamoDB.
    // We namespace IDs by correlationId to eliminate collision risk at scale.
    const ctx = getCurrentExecutionContext();
    const correlationId = options.correlationId ?? ctx?.correlationId;
    const id = correlationId ? generateObservabilityLogId(correlationId) : generateId();

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
      ? (parent.captured ? parent.id : getCapturedParentId(parent))
      : undefined;
    const parentLogId = explicitParent === undefined
      ? derivedParentLogId
      : (explicitParent === null ? undefined : explicitParent);

    const { level, metrics, data, skipCapture, tags, ...overrides } = options;

    // Emit span.start to OTEL only
    // Use null if no parent to prevent fallback to getCurrentParentObservabilityLogId()
    captureRecord(OBSERVER_NAME, {
      type: 'span.start',
      correlationId,
      observabilityLogId: id,
      parentObservabilityLogId: explicitParent === undefined ? (parentLogId ?? null) : explicitParent,
      level: level ?? 'info',
      timestampMs: Date.now(),
      operation,
      tags: mergeTags(state?.tags, tags),
      capture: { backends: [ 'otel' ] },
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
  static getCurrentSpan(): SpanObserver | undefined {
    const current = getObservabilityState()?.currentSpan;
    // currentSpan is only ever set by SpanObserver, but we keep the runtime check conservative.
    return current instanceof SpanObserver ? current : undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle: end()
  // ═══════════════════════════════════════════════════════════════════════════

  end(options?: SpanEndOptions): void {
    if (this.ended) return;
    this.ended = true;

    if (!this.captured) return;

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
    let errorInfo: ObservabilityError | undefined;
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
    const finalMetrics: Record<string, number> = {
      duration,
      ...this._metrics,
      ...options?.metrics,
    };

    // Build final data
    const finalData: Record<string, unknown> = {
      ...this._data,
      ...options?.data,
    };

    // Mark whether this span was "empty" (no useful content beyond timing).
    // Flush-time logic can safely drop empty *leaf* spans when configured.
    const isEmptySpan = !this.hasContent && !hasError;
    if (isEmptySpan) {
      const existing = finalData._fw24;
      const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
        ? (existing as Record<string, unknown>)
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
    const capturedId = captureRecord(OBSERVER_NAME, {
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

// ═══════════════════════════════════════════════════════════════════════════
// Convenience Exports
// ═══════════════════════════════════════════════════════════════════════════

export const withSpan = SpanObserver.withSpan.bind(SpanObserver);
export const withSpanSync = SpanObserver.withSpanSync.bind(SpanObserver);
export const wrapInSpan = SpanObserver.wrap.bind(SpanObserver);
