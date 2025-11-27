/**
 * SpanObserver - For distributed tracing
 * 
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit option
 * - No auto-generation of correlationId (must be propagated)
 * - Hierarchical spans via parentSpanId
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
  /** Parent span ID for nested spans */
  parentSpanId?: string;
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
  end(options?: { success?: boolean; error?: Error; status?: string }): void;
  withChild<T>(
    operation: string,
    fn: (span: ISpanObserver) => Promise<T>,
    options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): Promise<T>;
  createChild(
    operation: string,
    options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): ISpanObserver;
}

export class SpanObserver implements ISpanObserver {
  private readonly spanId: string;
  private readonly correlationId: string;
  private readonly parentSpanId?: string;
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
    this.parentSpanId = options.parentSpanId ?? context?.parentLogId;
    this.level = options.level ?? 'info';
    this.attributes = options.attributes ?? {};
    this.source = options.source ?? fields.source;
    this.tags = mergeObserverTags(fields.tags, options.tags);
    this.actor = options.actor ?? fields.actor;
    this.startTime = Date.now();

    // Emit span.start event using capturer pattern
    captureEvent(fields, {
      type: 'span.start',
      level: this.level,
      parentLogId: this.parentSpanId,
      entityName: 'span',
      entityId: this.spanId,
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
   * @param options - Span options (correlationId required if no context)
   * @returns SpanObserver instance, or NoOp span if correlationId not available
   */
  static start(operation: string, options?: SpanOptions): ISpanObserver {
    // Build common fields using base utilities
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options?.correlationId,
      actor: options?.actor,
      source: options?.source,
      tags: options?.tags,
    });

    if (!fields) {
      // Return a no-op span that won't crash but won't record anything
      return new NoOpSpanObserver(operation);
    }

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
        level: this.level,
        parentLogId: this.spanId,
        entityName: 'span',
        entityId: this.spanId,
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
        level: options?.error ? 'error' : this.level,
        parentLogId: this.parentSpanId,
        entityName: 'span',
        entityId: this.spanId,
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
    options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): Promise<T> {
    return SpanObserver.withSpan(operation, fn, {
      ...options,
      correlationId: this.correlationId,
      parentSpanId: this.spanId,
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
    options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): ISpanObserver {
    return SpanObserver.start(operation, {
      ...options,
      correlationId: this.correlationId,
      parentSpanId: this.spanId,
      source: options?.source ?? this.source,
      tags: { ...this.tags, ...options?.tags },
      actor: options?.actor ?? this.actor,
    });
  }
}

/**
 * No-op span for when correlationId is not available
 * Implements ISpanObserver interface properly (no type casts)
 */
class NoOpSpanObserver implements ISpanObserver {
  private readonly operation: string;

  constructor(operation: string) {
    this.operation = operation;
    logger.warn(`NoOp span created for operation: ${operation}`);
  }

  get id(): string {
    return 'noop';
  }

  get traceId(): string {
    return 'noop';
  }

  setAttribute(_key: string, _value: unknown): this {
    return this;
  }

  setAttributes(_attrs: Record<string, unknown>): this {
    return this;
  }

  addEvent(_name: string, _eventAttributes?: Record<string, unknown>): this {
    return this;
  }

  end(_options?: { success?: boolean; error?: Error; status?: string }): void {
    // No-op
  }

  async withChild<T>(
    _operation: string,
    fn: (span: ISpanObserver) => Promise<T>,
    _options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): Promise<T> {
    return fn(this);
  }

  createChild(
    operation: string,
    _options?: Omit<SpanOptions, 'correlationId' | 'parentSpanId'>
  ): ISpanObserver {
    return new NoOpSpanObserver(operation);
  }
}

// Re-export withSpan for convenience
export const withSpan = SpanObserver.withSpan.bind(SpanObserver);
