/**
 * @Observed Decorator - Unified observability decorator
 * 
 * Smart decorator that combines tracing, audit, and metrics without duplication.
 * 
 * DEFAULT: If no options specified, defaults to { trace: true }
 * 
 * DESIGN:
 * - trace: Creates span with duration/success/error (for debugging/performance)
 * - audit: Creates business/compliance log (only for entity operations)
 * - metric: Creates aggregatable counters/gauges (NOT timing if trace enabled!)
 * 
 * Usage:
 * ```typescript
 * class OrderService {
 *   // Default - trace only
 *   @Observed()
 *   async fetchOrders(): Promise<Order[]> { }
 *   
 *   // Explicit trace
 *   @Observed({ trace: true })
 *   async getOrder(id: string): Promise<Order> { }
 *   
 *   // Business operation - trace + audit
 *   @Observed({ 
 *     trace: true,
 *     audit: { entityName: 'order' },
 *     metric: { type: 'counter', name: 'orders.created' }
 *   })
 *   async createOrder(order: Order): Promise<Order> { }
 *   
 *   // Counter only (no trace)
 *   @Observed({ 
 *     metric: { type: 'counter', name: 'cache.hit' }
 *   })
 *   getCached(key: string): any { }
 * }
 * ```
 * 
 * ANTI-PATTERNS:
 * ❌ DON'T: trace + timing metric (span already has duration!)
 * ❌ DON'T: audit every method (only business events!)
 * ✅ DO: trace for debugging, audit for compliance, counter for stats
 */

import { setParentObservabilityLogId, getCurrentContext } from '../context';
import { AuditObserver } from '../observers/audit';
import { normalizeError } from '../observers/base';
import { MetricObserver } from '../observers/metric';
import { SpanObserver, SpanOptions, SpanEndOptions } from '../observers/span';
import { safeSerialize } from '../utils/payload';
import { executeWithHandlers, SourceType, resolveSource } from './decorator-utils';

export interface ObservedOptions {
  /** Method name (defaults to ClassName.methodName) */
  name?: string;

  /**
   * Create span for distributed tracing
   * Spans capture duration, success, error automatically.
   * Use for: debugging, performance analysis, distributed tracing
   * 
   * DEFAULT: true if no options are specified (trace, audit, metric all undefined)
   */
  trace?: boolean | {
    level?: SpanOptions[ 'level' ];
    attributes?: Record<string, unknown>;
  };

  /**
   * Create audit record for business/compliance tracking
   * Use for: entity operations, security events, compliance requirements
   * Note: Only use for actual business events, not every traced method
   * 
   * DEFAULT: false
   */
  audit?: boolean | {
    action?: string;
    entityName?: string;
    level?: 'info' | 'warn' | 'error';
    captureArgs?: boolean;
    captureResult?: boolean;
  };

  /**
   * Record metric for aggregation/dashboards
   * - counter: Count method invocations (useful!)
   * - gauge: Set a specific value (useful!)
   * - timing: Duration in ms (DON'T USE if trace:true - span already captures duration!)
   * 
   * DEFAULT: undefined (no metrics)
   */
  metric?: {
    name?: string;
    type?: 'counter' | 'gauge' | 'timing';
    unit?: string;
    tags?: Record<string, string>;
  };

  /** 
   * Source type (auto-detected if not provided)
   * Auto-detection rules:
   * - *Controller → 'controller' → "api:ControllerName.method"
   * - *Service → 'service' → "service:ServiceName.method"
   * - *Queue, *QueueHandler → 'queue' → "queue:QueueName.method"
   * - *Task, *TaskHandler → 'task' → "task:TaskName.method"
   * - Default → 'handler' → "ClassName.method"
   */
  sourceType?: SourceType;

  /** Tags applied to all observability events */
  tags?: Record<string, string>;

  /** Capture method arguments */
  captureArgs?: boolean;

  /** Capture return value */
  captureResult?: boolean;

  /**
   * Conditionally enable/disable observability.
   * - Static boolean: `enabled: false` to disable
   * - Dynamic function: `enabled: () => someCondition()`
   * Function receives no arguments but can access getCurrentContext() internally.
   * Default: true (enabled)
   */
  enabled?: boolean | (() => boolean);

  /**
   * Callback to extract context-specific attributes at runtime.
   * Called with the instance (`this`) and method arguments.
   * Returns attributes to add to the span.
   */
  getAttributes?: (instance: any, args: any[]) => Record<string, unknown>;

  /**
   * Callback to extract attributes from the result after execution.
   * Called with the method's return value.
   * Returns attributes to add to the span before it ends.
   */
  getResultAttributes?: (result: any) => Record<string, unknown>;

  /**
   * Callback to extract metrics from the result after execution.
   * Called with the method's return value.
   * Returns metrics to embed in the span (published as CloudWatch EMF metrics).
   */
  getMetrics?: (result: any) => Record<string, number>;

  /**
   * Callback to extract data from the result after execution.
   * Called with the method's return value.
   * Returns data to embed in the span (for audit-like structured information).
   */
  getData?: (result: any) => Record<string, unknown>;
}

/**
 * Unified observability decorator that combines tracing, auditing, and metrics
 * 
 * @param options - Observability options
 */
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

    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const operationName = options.name ?? `${className}.${methodName}`;

    // Default to trace:true if nothing is specified
    if (!options.trace && !options.audit && !options.metric) {
      options.trace = true;
    }

    // Resolve source using shared utility (auto-detects if sourceType not provided)
    const source = resolveSource(options.sourceType, className, methodName);

    const wrappedMethod = function (this: unknown, ...args: unknown[]): unknown {
      // Check if observability is enabled (static or dynamic)
      if (options.enabled !== undefined) {
        const isEnabled = typeof options.enabled === 'function'
          ? options.enabled()
          : options.enabled;

        if (!isEnabled) {
          // Observability disabled - execute method without instrumentation
          return (originalMethod as (...a: unknown[]) => unknown).apply(this, args);
        }
      }

      const startTime = Date.now();
      let span: ReturnType<typeof SpanObserver.start> | null = null;
      let previousParentId: string | undefined = undefined;

      // Start span if tracing enabled
      if (options.trace) {
        const traceOptions = typeof options.trace === 'boolean' ? {} : options.trace;

        const dynamicAttributes = options.getAttributes ? options.getAttributes(this, args) : {};

        const spanOptions: SpanOptions = {
          level: traceOptions.level,
          attributes: {
            'code.function': methodName,
            'code.namespace': className,
            ...traceOptions.attributes,
            ...dynamicAttributes,
            ...(options.captureArgs && args.length > 0 && { args: safeSerialize(args) }),
          },
          tags: { ...options.tags, ...traceOptions.attributes?.tags as Record<string, string> | undefined },
          source,
        };

        // CRITICAL FIX: Snapshot the current parent BEFORE starting the span
        // This prevents sibling operations (e.g., multiple upserts in a loop) from forming a chain
        const ctx = getCurrentContext();
        previousParentId = ctx?.parentObservabilityLogId;

        span = SpanObserver.start(operationName, spanOptions);
        // Update context so child operations can link to this span
        setParentObservabilityLogId(span.id);
      }

      // Emit pre-execution metric (counter)
      if (options.metric && options.metric.type === 'counter') {
        const metricName = options.metric.name ?? `${operationName}.count`;
        MetricObserver.increment(metricName, 1, {
          tags: { ...options.tags, ...options.metric.tags },
          source,
        });
      }

      // Execute method with automatic sync/async handling
      return executeWithHandlers(
        originalMethod as (...args: unknown[]) => unknown,
        this,
        args,
        (success, result, error) => {
          finishObservability({
            span,
            options,
            operationName,
            args,
            result,
            success,
            error: error ? normalizeError(error) : undefined,
            durationMs: Date.now() - startTime,
            source,
            previousParentId,
          });
        }
      );
    };
    descriptor.value = wrappedMethod as T;

    return descriptor;
  };
}

/**
 * Finish all observability recording (span, audit, metrics)
 * Unified handler for both sync and async, success and error paths
 */
function finishObservability(params: {
  span: ReturnType<typeof SpanObserver.start> | null;
  options: ObservedOptions;
  operationName: string;
  args: unknown[];
  result?: unknown;
  success: boolean;
  error?: Error;
  durationMs: number;
  source: string;
  previousParentId?: string;
}): void {
  const { span, options, operationName, args, result, success, error, durationMs, source, previousParentId } = params;

  // End span (captures duration, success, error - no need for separate timing metric!)
  if (span) {
    if (success) {
      if (options.captureResult && result !== undefined) {
        span.setAttribute('result', safeSerialize(result));
      }

      // Build end options with all extractors
      const endOptions: SpanEndOptions = { success: true };

      // Extract attributes from result
      if (options.getResultAttributes && result !== undefined) {
        endOptions.attributes = options.getResultAttributes(result);
      }

      // Extract metrics from result (published as CloudWatch EMF metrics!)
      if (options.getMetrics && result !== undefined) {
        endOptions.metrics = options.getMetrics(result);
      }

      // Extract data from result (for audit-like structured info)
      if (options.getData && result !== undefined) {
        endOptions.data = options.getData(result);
      }

      span.end(endOptions);
    } else {
      // Error is already normalized in the callback
      span.end({ success: false, error: error as Error });
    }

    // CRITICAL FIX: Restore the previous parent ID after span ends
    // This ensures sibling operations see the correct parent, not the just-completed span
    if (previousParentId !== undefined) {
      setParentObservabilityLogId(previousParentId);
    }
  }

  // Record audit ONLY if explicitly configured
  // Audit is for business/compliance events, not every traced method
  if (options.audit) {
    recordAudit({
      options,
      operationName,
      args,
      result,
      success,
      error,
      durationMs,
      source,
    });
  }

  // Record timing metric ONLY if:
  // 1. Metric is configured as timing type
  // 2. AND no span exists (span already captures duration)
  // This prevents duplicate duration recording
  if (options.metric?.type === 'timing' && !span) {
    recordTimingMetric({
      options,
      operationName,
      durationMs,
      success,
      source,
    });
  }
}

/**
 * Record audit event
 * NOTE: Caller must check if options.audit is enabled before calling this
 */
function recordAudit(params: {
  options: ObservedOptions;
  operationName: string;
  args: unknown[];
  result?: unknown;
  success: boolean;
  error?: Error;
  durationMs: number;
  source: string;
}): void {
  const { options, operationName, args, result, success, error, durationMs, source } = params;

  // options.audit is guaranteed to exist (caller checks), extract config
  const auditOptions = typeof options.audit === 'boolean' ? {} : (options.audit ?? {});

  // Build audit data
  let data: Record<string, unknown> = {
    success,
    durationMs,
  };

  // Capture args if requested
  const shouldCaptureArgs = auditOptions?.captureArgs ?? options.captureArgs ?? false;
  if (shouldCaptureArgs && args.length > 0) {
    data.args = safeSerialize(args);
  }

  // Capture result if requested
  const shouldCaptureResult = auditOptions?.captureResult ?? options.captureResult ?? false;
  if (shouldCaptureResult && result !== undefined) {
    data.result = safeSerialize(result);
  }

  // Add error info if failed
  if (error) {
    data.error = {
      type: error.name,
      message: error.message,
    };
  }

  AuditObserver.record({
    operation: auditOptions?.action ?? operationName,
    entityName: auditOptions?.entityName,
    data,
    level: error ? 'error' : (auditOptions?.level ?? 'info'),
    source,
    tags: options.tags,
  });
}

/**
 * Record timing metric if configured
 */
function recordTimingMetric(params: {
  options: ObservedOptions;
  operationName: string;
  durationMs: number;
  success: boolean;
  source: string;
}): void {
  const { options, operationName, durationMs, success, source } = params;

  if (!options.metric || options.metric.type !== 'timing') return;

  const metricName = options.metric.name ?? `${operationName}.duration`;

  MetricObserver.timing(metricName, durationMs, {
    tags: {
      ...options.tags,
      ...options.metric.tags,
      success: String(success),
    },
    unit: options.metric.unit ?? 'milliseconds',
    source,
  });
}

