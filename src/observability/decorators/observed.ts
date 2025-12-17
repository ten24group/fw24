/**
 * @Observed Decorator - Unified observability decorator
 * 
 * Combines tracing, audit, and metric recording in a single decorator.
 * Use this for high-level methods that need comprehensive observability.
 * 
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed({ 
 *     trace: true,
 *     audit: { action: 'order.create' },
 *     metric: { name: 'orders.created', type: 'counter' }
 *   })
 *   async createOrder(order: Order): Promise<Order> {
 *     // Method is traced, audited, and metered
 *   }
 *   
 *   @Observed({ 
 *     trace: { level: 'info' },
 *     audit: { action: 'payment.process', level: 'warn', captureArgs: true }
 *   })
 *   async processPayment(orderId: string, amount: number): Promise<void> {
 *     // Comprehensive observability with custom config
 *   }
 * }
 * ```
 * 
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise creates NoOp spans and skips audits/metrics
 */

import { SpanObserver, SpanOptions } from '../observers/span';
import { AuditObserver } from '../observers/audit';
import { MetricObserver, MetricOptions } from '../observers/metric';
import { createControllerSource, createServiceSource, createQueueSource, createTaskSource } from '../utils/source-utils';
import { safeSerialize } from '../utils/payload';
import { normalizeError } from '../observers/base';
import { getCurrentContext, getCorrelationIdIfExists } from '../context';
import { createLogger } from '../../logging';

const logger = createLogger('ObservedDecorator');

export interface ObservedOptions {
  /** Method name (defaults to ClassName.methodName) */
  name?: string;

  /** Create span for tracing */
  trace?: boolean | {
    level?: SpanOptions[ 'level' ];
    attributes?: Record<string, unknown>;
  };

  /** Create audit record */
  audit?: boolean | {
    action?: string;
    entityName?: string;
    level?: 'info' | 'warn' | 'error';
    captureArgs?: boolean;
    captureResult?: boolean;
  };

  /** Record metric */
  metric?: {
    name?: string;
    type?: 'counter' | 'gauge' | 'timing';
    unit?: string;
    tags?: Record<string, string>;
  };

  /** Source type for the operation */
  sourceType?: 'controller' | 'service' | 'handler' | 'queue' | 'task';

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
}

/**
 * Unified observability decorator that combines tracing, auditing, and metrics
 * 
 * @param options - Observability options
 */
export function Observed(options: ObservedOptions = {}) {
  return function <T extends (...args: unknown[]) => unknown>(
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

    // Determine source
    let source: string;
    switch (options.sourceType) {
      case 'controller':
        source = createControllerSource(className, methodName);
        break;
      case 'service':
        source = createServiceSource(className, methodName);
        break;
      case 'queue':
        source = createQueueSource(className, methodName);
        break;
      case 'task':
        source = createTaskSource(className, methodName);
        break;
      default:
        source = `${className}.${methodName}`;
    }

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

      // Start span if tracing enabled
      if (options.trace) {
        const traceOptions = typeof options.trace === 'boolean' ? {} : options.trace;

        const spanOptions: SpanOptions = {
          level: traceOptions.level,
          attributes: {
            'code.function': methodName,
            'code.namespace': className,
            ...traceOptions.attributes,
            ...(options.captureArgs && args.length > 0 && { args: safeSerialize(args) }),
          },
          tags: { ...options.tags, ...traceOptions.attributes?.tags as Record<string, string> | undefined },
          source,
        };

        span = SpanObserver.start(operationName, spanOptions);
      }

      // Emit pre-execution metric (counter)
      if (options.metric && options.metric.type === 'counter') {
        const metricName = options.metric.name ?? `${operationName}.count`;
        MetricObserver.increment(metricName, 1, {
          tags: { ...options.tags, ...options.metric.tags },
          source,
        });
      }

      try {
        const result = (originalMethod as (...a: unknown[]) => unknown).apply(this, args);

        // Check if result is a Promise/thenable
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          // Handle async method
          return (result as Promise<unknown>)
            .then((value) => {
              const durationMs = Date.now() - startTime;

              // End span
              if (span) {
                if (options.captureResult && value !== undefined) {
                  span.setAttribute('result', safeSerialize(value));
                }
                span.end({ success: true });
              }

              // Record audit
              recordAudit({
                options,
                operationName,
                args,
                result: value,
                success: true,
                durationMs,
                source,
              });

              // Record timing metric
              recordTimingMetric({
                options,
                operationName,
                durationMs,
                success: true,
                source,
              });

              return value;
            })
            .catch((error) => {
              const durationMs = Date.now() - startTime;

              // End span with error
              if (span) {
                span.end({ success: false, error: normalizeError(error) });
              }

              // Record audit with error
              recordAudit({
                options,
                operationName,
                args,
                success: false,
                error: normalizeError(error),
                durationMs,
                source,
              });

              // Record timing metric with error
              recordTimingMetric({
                options,
                operationName,
                durationMs,
                success: false,
                source,
              });

              throw error;
            });
        }

        // Handle sync method
        const durationMs = Date.now() - startTime;

        if (span) {
          if (options.captureResult && result !== undefined) {
            span.setAttribute('result', safeSerialize(result));
          }
          span.end({ success: true });
        }

        recordAudit({
          options,
          operationName,
          args,
          result,
          success: true,
          durationMs,
          source,
        });

        recordTimingMetric({
          options,
          operationName,
          durationMs,
          success: true,
          source,
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;

        if (span) {
          span.end({ success: false, error: normalizeError(error) });
        }

        recordAudit({
          options,
          operationName,
          args,
          success: false,
          error: normalizeError(error),
          durationMs,
          source,
        });

        recordTimingMetric({
          options,
          operationName,
          durationMs,
          success: false,
          source,
        });

        throw error;
      }
    };
    descriptor.value = wrappedMethod as T;

    return descriptor;
  };
}

/**
 * Record audit event if configured
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

  if (!options.audit) return;

  const auditOptions = typeof options.audit === 'boolean' ? {} : options.audit;
  const context = getCurrentContext();

  // Build audit data
  let data: Record<string, unknown> = {
    success,
    durationMs,
  };

  // Capture args if requested
  const shouldCaptureArgs = auditOptions.captureArgs ?? options.captureArgs ?? false;
  if (shouldCaptureArgs && args.length > 0) {
    data.args = safeSerialize(args);
  }

  // Capture result if requested
  const shouldCaptureResult = auditOptions.captureResult ?? options.captureResult ?? false;
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
    operation: auditOptions.action ?? operationName,
    entityName: auditOptions.entityName,
    data,
    level: error ? 'error' : (auditOptions.level ?? 'info'),
    source,
    tags: options.tags,
    actor: context?.actor,
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

