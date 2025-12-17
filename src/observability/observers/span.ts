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
import { getCurrentContext } from '../context';
import { ObservabilityLevelString } from '../types';
import { generateTraceId } from '../utils/id-generator';
import {
  resolveCorrelationId,
  generateId,
  captureEvent,
  buildCommonFields,
  mapError,
  normalizeError,
  mergeObserverTags,
  CommonFields,
} from './base';
import { createLogger } from '../../logging';

const logger = createLogger('SpanObserver');
const OBSERVER_NAME = 'SpanObserver';

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
  addEvent(name: string, eventAttributes?: Record<string, unknown>): this;
  end(options?: { success?: boolean; error?: Error; status?: string }): void;
  withChild<T>(
    operation: string,
    fn: (span: ISpanObserver) => Promise<T>,
    options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>
  ): Promise<T>;
  createChild(
    operation: string,
    options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>
  ): ISpanObserver;
}

export class SpanObserver implements ISpanObserver {
  private readonly spanId: string;
  private readonly correlationId: string;
  private readonly parentObservabilityLogId: string | null;
  private readonly level: ObservabilityLevelString;
  private readonly startTime: number;
  private readonly source?: string;
  private readonly tags?: Record<string, string>;
  private readonly actor?: Actor;
  private attributes: Record<string, unknown>;
  private readonly operation: string;
  private ended = false;

  private constructor(operation: string, fields: CommonFields, options: SpanOptions = {}) {
    const context = getCurrentContext();

    this.operation = operation;
    this.spanId = generateId();
    this.correlationId = fields.correlationId;
    // Store parent at construction time - use null to mean "no parent" (not undefined)
    // This prevents buildEvent from falling back to mutated context
    this.parentObservabilityLogId = options.parentObservabilityLogId ?? context?.parentObservabilityLogId ?? null;
    this.level = options.level ?? 'info';
    this.attributes = options.attributes ?? {};
    this.source = options.source ?? fields.source;
    this.tags = mergeObserverTags(fields.tags, options.tags);
    this.actor = options.actor ?? fields.actor;
    this.startTime = Date.now();

    // Emit span.start event using capturer pattern
    // CRITICAL: observabilityLogId MUST equal spanId for parent-child linking to work
    // Child spans reference parentObservabilityLogId = parent.spanId, which must match parent's observabilityLogId
    captureEvent(fields, {
      type: 'span.start',
      observabilityLogId: this.spanId,  // Use spanId as the DB record ID for parent-child linking
      level: this.level,
      parentObservabilityLogId: this.parentObservabilityLogId,
      // NOTE: entityName/entityId NOT set for spans - spans are observability primitives, not business entities
      // If you need to track which business entity a span is for, use tags or attributes
      timestampMs: this.startTime,
      operation: this.operation,
      attributes: this.attributes,
      source: this.source,
      tags: this.tags,
      actor: this.actor,
    });
  }

  /**
   * Start a new span
   * 
   * @param operation - Name of the operation being traced
   * @param options - Span options (correlationId auto-generated if no context)
   * @returns SpanObserver instance (always succeeds)
   */
  static start(operation: string, options?: SpanOptions): ISpanObserver {
    // Build common fields using base utilities
    // Note: buildCommonFields now always returns fields (auto-generates correlationId if needed)
    const fields = buildCommonFields(OBSERVER_NAME, {
      // Use W3C Trace ID if no correlationId provided
      correlationId: options?.correlationId ?? generateTraceId(),
      actor: options?.actor,
      source: options?.source,
      tags: options?.tags,
    });

    return new SpanObserver(operation, fields, options);
  }

  /**
   * Execute function within a span
   */
  static async withSpan<T>(
    operation: string,
    fn: (span: ISpanObserver) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    const span = SpanObserver.start(operation, options);
    try {
      const result = await fn(span);
      span.end({ success: true });
      return result;
    } catch (error) {
      span.end({ success: false, error: normalizeError(error) });
      throw error;
    }
  }

  // === Getters ===
  get id(): string {
    return this.spanId;
  }

  get traceId(): string {
    return this.correlationId;
  }

  // === Attribute management ===
  setAttribute(key: string, value: unknown): this {
    this.attributes[ key ] = value;
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): this {
    Object.assign(this.attributes, attrs);
    return this;
  }

  // === OTEL Compliance ===
  setStatus(code: 'OK' | 'ERROR' | 'UNSET', message?: string): this {
    // We map OTEL status to our internal attributes/status
    // Note: Actual end() call will finalize the status, but this allows intermediate updates
    this.attributes[ 'otel.status_code' ] = code;
    if (message) {
      this.attributes[ 'otel.status_description' ] = message;
    }
    return this;
  }

  recordException(exception: Error | string): this {
    const error = normalizeError(exception);
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    });
    // Also track the last error on the span itself for easy access
    this.setAttribute('error', true);
    return this;
  }

  // === Events ===
  addEvent(name: string, eventAttributes?: Record<string, unknown>): this {
    captureEvent(
      {
        actor: this.actor,
        correlationId: this.correlationId,
        source: this.source,
        tags: this.tags
      },
      {
        type: 'span.event',
        observabilityLogId: generateId(),  // Events get their own unique ID
        level: this.level,
        parentObservabilityLogId: this.spanId,  // Parent is this span
        // NOTE: entityName/entityId NOT set - span events are observability primitives
        timestampMs: Date.now(),
        operation: name,
        attributes: eventAttributes,
      }
    );
    return this;
  }

  // === End span ===
  end(options?: { success?: boolean; error?: Error; status?: string }): void {
    if (this.ended) return;
    this.ended = true;

    const endTime = Date.now();
    const duration = endTime - this.startTime;

    captureEvent(
      { correlationId: this.correlationId, actor: this.actor, source: this.source, tags: this.tags },
      {
        type: 'span.end',
        observabilityLogId: generateId(),  // span.end gets its own unique ID
        level: options?.error ? 'error' : this.level,
        parentObservabilityLogId: this.spanId,  // Parent is THIS span (span.start record), consistent with span.event
        // NOTE: entityName/entityId NOT set - spans are observability primitives
        timestampMs: endTime,
        durationMs: duration,
        operation: this.operation,
        success: options?.success ?? !options?.error,
        status: options?.status ?? (options?.error ? 'failed' : 'completed'),
        attributes: this.attributes,
        error: options?.error ? mapError(options.error) : undefined,
        metrics: { duration },
      }
    );
  }

  // === Child spans ===

  /**
   * Execute function within a child span
   */
  async withChild<T>(
    operation: string,
    fn: (span: ISpanObserver) => Promise<T>,
    options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>
  ): Promise<T> {
    return SpanObserver.withSpan(operation, fn, {
      ...options,
      correlationId: this.correlationId,
      parentObservabilityLogId: this.spanId,
      source: options?.source ?? this.source,
      tags: { ...this.tags, ...options?.tags },
      actor: options?.actor ?? this.actor,
    });
  }

  /**
   * Create a child span
   */
  createChild(
    operation: string,
    options?: Omit<SpanOptions, 'correlationId' | 'parentObservabilityLogId'>
  ): ISpanObserver {
    return SpanObserver.start(operation, {
      ...options,
      correlationId: this.correlationId,
      parentObservabilityLogId: this.spanId,
      source: options?.source ?? this.source,
      tags: { ...this.tags, ...options?.tags },
      actor: options?.actor ?? this.actor,
    });
  }
}

// Re-export withSpan for convenience
export const withSpan = SpanObserver.withSpan.bind(SpanObserver);
