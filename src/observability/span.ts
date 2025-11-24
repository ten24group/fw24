import { randomUUID } from 'crypto';
import { ObservabilityManager } from './manager';
import { ObservabilityEvent } from './types';

export interface SpanOptions {
  traceId?: string;
  parentSpanId?: string;
  level?: ObservabilityEvent['level'];
  attributes?: Record<string, any>;
}

export class Span {
  private readonly _spanId: string;
  private readonly _traceId: string;
  private readonly _parentSpanId?: string;
  private readonly level: ObservabilityEvent['level'];
  private readonly startTime: number;
  private attributes: Record<string, any>;
  private operation: string;

  constructor(operation: string, options: SpanOptions = {}) {
    this.operation = operation;
    this._spanId = randomUUID();
    this._traceId = options.traceId ?? randomUUID();
    this._parentSpanId = options.parentSpanId;
    this.level = options.level ?? 'info';
    this.attributes = options.attributes ?? {};
    this.startTime = Date.now();

    void ObservabilityManager.capture({
      type: 'span.start',
      level: this.level,
      correlationId: this._traceId,
      parentLogId: this._parentSpanId,
      entityName: 'span',
      entityId: this._spanId,
      timestampMs: this.startTime,
      operation: this.operation,
      attributes: this.attributes,
    });
  }

  get spanId() {
    return this._spanId;
  }

  get traceId() {
    return this._traceId;
  }

  get parentSpanId() {
    return this._parentSpanId;
  }

  setAttribute(key: string, value: any) {
    this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, any>, level?: ObservabilityEvent['level']) {
    void ObservabilityManager.capture({
      type: 'span.event',
      level: level ?? this.level,
      correlationId: this._traceId,
      parentLogId: this._spanId,
      entityName: 'span',
      entityId: this._spanId,
      timestampMs: Date.now(),
      operation: name,
      attributes,
    });
    return this;
  }

  end(options?: { success?: boolean; error?: Error }): void {
    const end = Date.now();
    const duration = end - this.startTime;
    void ObservabilityManager.capture({
      type: 'span.end',
      level: this.level,
      correlationId: this._traceId,
      parentLogId: this._parentSpanId,
      entityName: 'span',
      entityId: this._spanId,
      timestampMs: end,
      durationMs: duration,
      operation: this.operation,
      success: options?.success ?? options?.error === undefined,
      status: options?.error ? 'failed' : 'completed',
      attributes: this.attributes,
      error: options?.error
        ? {
            type: options.error.name,
            message: options.error.message,
            stack: options.error.stack,
          }
        : undefined,
      metrics: {
        duration,
      },
    });
  }

  async withChild<T>(
    operation: string,
    fn: (span: Span) => Promise<T>,
    options?: Omit<SpanOptions, 'traceId' | 'parentSpanId'>,
  ): Promise<T> {
    return withSpan(
      operation,
      fn,
      {
        ...options,
        traceId: this._traceId,
        parentSpanId: this._spanId,
      },
    );
  }
}

export const withSpan = async <T>(
  operation: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> => {
  const span = new Span(operation, options);
  try {
    const result = await fn(span);
    span.end({ success: true });
    return result;
  } catch (error) {
    span.end({ success: false, error: error as Error });
    throw error;
  }
};

