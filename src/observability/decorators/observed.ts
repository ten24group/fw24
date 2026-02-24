/**
 * @Observed Decorator - Unified observability decorator
 *
 * Combines tracing, audit, and metrics in one decorator.
 * Parent tracking is FULLY AUTOMATIC via span tree.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed()  // Default - trace only
 *   async fetchOrders(): Promise<Order[]> { }
 *
 *   @Observed({ trace: true, audit: { entityName: 'order' } })
 *   async createOrder(order: Order): Promise<Order> { }
 *
 *   @Observed({ trace: false, audit: true })  // Audit only, no span
 *   async deleteOrder(id: string): Promise<void> { }
 * }
 * ```
 */

import { getCurrentExecutionContext } from '../../core/runtime/execution-context';
import { AuditObserver } from '../observers/audit';
import { MetricObserver } from '../observers/metric';
import { SpanObserver, SpanOptions, ISpanObserver } from '../observers/span';
import type { DecoratorBaseOptions, CaptureSerializeOptions } from '../types';
import { resolveSource } from './decorator-utils';
import { safeSerialize, type SerializeOptions } from '../utils/payload';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type ObservedTagValue = string | number | boolean;

export type ObservedEnrichment = {
  /** Span tags (stored as strings, indexed). */
  tags?: Record<string, ObservedTagValue>;
  /** Span metrics (numeric). */
  metrics?: Record<string, number>;
  /** Span debug data (not indexed). */
  data?: Record<string, unknown>;
  /** Associate this span with a specific entity (filterable in admin UI). */
  entityName?: string;
  /** Entity instance ID (filterable in admin UI). */
  entityId?: string;
  /** Convenience: add checkpoint(s) to the span timeline. */
  checkpoints?: Array<{
    name: string;
    tags?: Record<string, string>;
    metrics?: Record<string, number>;
    data?: Record<string, unknown>;
    error?: Error | string;
  }>;
};

export type ObservedExtractContext<TInstance, TArgs extends unknown[], TResult> = {
  instance: TInstance;
  args: TArgs;
  operationName: string;
  source: string;
  /** Only available in finish() */
  result?: TResult;
  /** Only available in finish() */
  error?: Error;
  /** Only available in finish() */
  success?: boolean;
  /** Only available in finish() */
  durationMs?: number;
  /** The current span (only present when tracing is enabled and capture is active). */
  span?: ISpanObserver;
};

type BivariantFn<T extends (...args: any[]) => any> = {
  bivarianceHack: T;
}[ 'bivarianceHack' ];

export interface ObservedExtractor<TInstance, TArgs extends unknown[], TResult> {
  /**
   * Run before the method is executed.
   * Return any enrichment to apply to the span.
   */
  start?: BivariantFn<(ctx: ObservedExtractContext<TInstance, TArgs, TResult>) => ObservedEnrichment | void>;
  /**
   * Run after the method finishes (success or error).
   * Return any enrichment to apply to the span.
   */
  finish?: BivariantFn<(ctx: ObservedExtractContext<TInstance, TArgs, TResult>) => ObservedEnrichment | void>;
}

export interface ObservedOptions<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown> extends DecoratorBaseOptions {
  /** Operation name (defaults to ClassName.methodName) */
  name?: string;

  /**
   * Create span for distributed tracing (default: true if nothing else specified).
   * Can be boolean or partial SpanOptions to configure the span.
   * Use capture.noise for noise reduction control.
   */
  trace?: boolean | Partial<SpanOptions>;

  /**
   * Create audit record.
   * Note: Args/result capture is controlled via capture.args/capture.result at the top level.
   */
  audit?: boolean | {
    action?: string;
    entityName?: string;
    level?: 'info' | 'warn' | 'error';
  };

  /** Record metric */
  metric?: {
    name?: string;
    type?: 'counter' | 'timing';
    unit?: string;
    tags?: Record<string, string>;
  };

  /**
   * Unified extraction API (recommended).
   *
   * Lets applications enrich span tags/metrics/data/checkpoints both at start and finish,
   * without needing 3-4 separate callbacks.
   */
  extract?: ObservedExtractor<TInstance, TArgs, TResult>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Decorator
// ═══════════════════════════════════════════════════════════════════════════

export function Observed(): <T extends (...args: any[]) => any>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T>
) => TypedPropertyDescriptor<T>;
export function Observed<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown>(
  options: ObservedOptions<TInstance, TArgs, TResult>
): <T extends (...args: any[]) => any>(
  target: object,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T>
) => TypedPropertyDescriptor<T>;
export function Observed(options: ObservedOptions = {}) {
  return function <T extends (...args: any[]) => any>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    // Pre-compute static values
    const className = ('name' in target ? target.name : target.constructor.name) as string;
    const methodName = String(propertyKey);
    const operationName = options.name ?? `${className}.${methodName}`;
    const shouldTrace = computeShouldTrace(options);
    const traceOptions = typeof options.trace === 'object' ? options.trace : {};

    descriptor.value = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
      // Early exits
      if (!isEnabled(options) || !getCurrentExecutionContext()) {
        return originalMethod.apply(this, args) as ReturnType<T>;
      }

      // Extract RecordOverrides from options (these get passed through to SpanObserver)
      const {
        enabled,
        sourceType,
        name,
        trace,
        audit,
        metric,
        extract,
        ...recordOverrides
      } = options;

      // Compute source (use explicit source override if provided, otherwise auto-detect)
      const computedSource = resolveSource(sourceType, className, methodName);
      const finalSource = recordOverrides.source ?? computedSource;

      // Extract capture options from capture namespace
      const argsSerializeOpts = toSerializeOptions(recordOverrides.capture?.args);
      const resultSerializeOpts = toSerializeOptions(recordOverrides.capture?.result);

      // Build span options (only compute dynamic attrs if tracing)
      const spanOptions: SpanOptions & {
        onStart?: (span: ISpanObserver) => void;
        onFinish?: (span: ISpanObserver, result: { value?: unknown; error?: Error; success: boolean; durationMs: number }) => void;
      } = {
        ...traceOptions,
        ...recordOverrides,
        source: finalSource,
        tags: shouldTrace ? {
          ...recordOverrides.tags,
          'code.function': methodName,
          'code.namespace': className,
        } : recordOverrides.tags,
        data: shouldTrace ? {
          ...traceOptions.data,
          ...(argsSerializeOpts && args.length > 0 && { args: safeSerialize(args, argsSerializeOpts) }),
        } : traceOptions.data,
        skipCapture: !shouldTrace,
        onStart: (span: ISpanObserver) => {
          applyObservedEnrichment(
            span,
            extract?.start?.({
              instance: this,
              args,
              operationName,
              source: finalSource,
              span,
            })
          );
        },
        onFinish: (span: ISpanObserver, result: { value?: unknown; error?: Error; success: boolean; durationMs: number }) => {
          // Unified extractor (finish hook)
          applyObservedEnrichment(
            span,
            extract?.finish?.({
              instance: this,
              args,
              operationName,
              source: finalSource,
              result: result.value as unknown,
              error: result.error,
              success: result.success,
              durationMs: result.durationMs,
              span,
            })
          );

          onMethodFinish(span, options, operationName, args, result, finalSource, recordOverrides, resultSerializeOpts, argsSerializeOpts);
        },
      };

      // Single path for EVERYTHING - SpanObserver.wrap handles sync/async
      return SpanObserver.wrap(operationName, () => originalMethod.apply(this, args) as ReturnType<T>, spanOptions) as ReturnType<T>;
    } as T;

    return descriptor;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function computeShouldTrace(options: ObservedOptions): boolean {
  // If trace is explicitly set, use that
  if (options.trace !== undefined) {
    return options.trace !== false;
  }
  // If only audit/metric specified, don't trace
  if (options.audit !== undefined || options.metric !== undefined) {
    return false;
  }
  // Default: trace
  return true;
}

function isEnabled(options: ObservedOptions): boolean {
  if (options.enabled === undefined) return true;
  return typeof options.enabled === 'function' ? options.enabled() : options.enabled;
}

/**
 * Convert decorator capture options to SerializeOptions
 */
function toSerializeOptions(option: boolean | CaptureSerializeOptions | undefined): SerializeOptions | undefined {
  if (option === undefined || option === false) return undefined;
  if (option === true) return {}; // Use defaults
  return option; // Already SerializeOptions
}

function onMethodFinish(
  span: ISpanObserver,
  options: ObservedOptions,
  operationName: string,
  args: unknown[],
  result: { value?: unknown; error?: Error; success: boolean; durationMs: number },
  source: string,
  recordOverrides: Partial<DecoratorBaseOptions>,
  resultSerializeOpts: SerializeOptions | undefined,
  argsSerializeOpts: SerializeOptions | undefined
): void {
  const { value, error, success, durationMs } = result;

  // Add result data to span (only if span was captured)
  if (span.captured && success) {
    if (resultSerializeOpts && value !== undefined) {
      span.setData({ result: safeSerialize(value, resultSerializeOpts) });
    }
  }

  // Audit (only if configured)
  if (options.audit) {
    recordAudit(options, operationName, args, value, success, durationMs, source, error, recordOverrides, argsSerializeOpts, resultSerializeOpts);
  }

  // Metrics (only if configured)
  if (options.metric) {
    recordMetric(options, operationName, success, durationMs, source, recordOverrides);
  }
}

function applyObservedEnrichment(span: ISpanObserver, enrichment: ObservedEnrichment | void): void {
  if (!enrichment) return;

  if (enrichment.tags) {
    for (const [ k, v ] of Object.entries(enrichment.tags)) {
      span.tag(k, v);
    }
  }
  if (enrichment.metrics) {
    span.metrics(enrichment.metrics);
  }
  if (enrichment.data) {
    span.setData(enrichment.data);
  }
  if (enrichment.entityName && enrichment.entityId) {
    span.setEntity(enrichment.entityName, enrichment.entityId);
  }
  if (enrichment.checkpoints) {
    for (const cp of enrichment.checkpoints) {
      span.checkpoint(cp.name, {
        tags: cp.tags,
        metrics: cp.metrics,
        data: cp.data,
        error: cp.error,
      });
    }
  }
}

function recordAudit(
  options: ObservedOptions,
  operationName: string,
  args: unknown[],
  result: unknown,
  success: boolean,
  durationMs: number,
  source: string,
  error: Error | undefined,
  recordOverrides: Partial<DecoratorBaseOptions>,
  argsSerializeOpts: SerializeOptions | undefined,
  resultSerializeOpts: SerializeOptions | undefined
): void {
  const auditOpts = typeof options.audit === 'object' ? options.audit : {};
  const data: Record<string, unknown> = { success, durationMs };

  // Use top-level capture options (not audit sub-options)
  if (argsSerializeOpts && args.length > 0) {
    data.args = safeSerialize(args, argsSerializeOpts);
  }
  if (resultSerializeOpts && result !== undefined) {
    data.result = safeSerialize(result, resultSerializeOpts);
  }
  if (error) {
    data.error = { type: error.name, message: error.message };
  }

  AuditObserver.record({
    operation: auditOpts.action ?? operationName,
    entityName: auditOpts.entityName,
    data,
    level: error ? 'error' : (auditOpts.level ?? 'info'),
    source,
    ...recordOverrides,
  });
}

function recordMetric(
  options: ObservedOptions,
  operationName: string,
  success: boolean,
  durationMs: number,
  source: string,
  recordOverrides: Partial<DecoratorBaseOptions>
): void {
  const metricOpts = options.metric;
  if (!metricOpts) return;
  const metricTags = { ...recordOverrides.tags, ...metricOpts.tags, success: String(success) };

  if (metricOpts.type === 'counter') {
    MetricObserver.increment(metricOpts.name ?? `${operationName}.count`, 1, {
      ...recordOverrides,
      tags: metricTags,
      source,
    });
  } else if (metricOpts.type === 'timing') {
    MetricObserver.timing(metricOpts.name ?? `${operationName}.duration`, durationMs, {
      ...recordOverrides,
      tags: metricTags,
      unit: metricOpts.unit ?? 'milliseconds',
      source,
    });
  }
}
