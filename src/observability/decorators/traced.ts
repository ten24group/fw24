/**
 * @Traced Decorator - Automatic span tracing for methods
 * 
 * Wraps a method in a span, automatically recording duration and errors.
 * 
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Traced()
 *   async processOrder(orderId: string): Promise<Order> {
 *     // Method body is automatically traced
 *   }
 *   
 *   @Traced({ name: 'custom-operation', level: 'debug' })
 *   async internalProcess(): Promise<void> {
 *     // Custom span name and level
 *   }
 * }
 * ```
 * 
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise creates a NoOp span that doesn't record anything
 */

import { setParentObservabilityLogId, getCurrentContext } from '../context';
import { normalizeError } from '../observers/base';
import { SpanObserver, SpanOptions } from '../observers/span';
import { safeSerialize } from '../utils/payload';
import { executeWithHandlers, SourceType, resolveSource } from './decorator-utils';


export interface TracedOptions {
  /** Custom span name (defaults to ClassName.methodName) */
  name?: string;
  /** Span level */
  level?: SpanOptions[ 'level' ];
  /** Additional attributes to add to span */
  attributes?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: Record<string, string>;
  /** Whether to capture method arguments in span attributes */
  captureArgs?: boolean;
  /** Whether to capture return value in span attributes */
  captureResult?: boolean;
  /** 
   * Source type for the span (auto-detected if not provided)
   * Auto-detection rules:
   * - *Controller → 'controller'
   * - *Service → 'service'
   * - *Queue, *QueueHandler → 'queue'
   * - *Task, *TaskHandler → 'task'
   * - Default → 'handler'
   */
  sourceType?: SourceType;
  /**
   * Conditionally enable/disable tracing.
   * - Static boolean: `enabled: false` to disable
   * - Dynamic function: `enabled: () => someCondition()`
   * Function receives no arguments but can access getCurrentContext() internally.
   * Default: true (enabled)
   */
  enabled?: boolean | (() => boolean);
}

/**
 * Method decorator that wraps a method in a trace span
 * 
 * @param options - Tracing options
 */
export function Traced(options: TracedOptions = {}) {
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
    const spanName = options.name ?? `${className}.${methodName}`;

    // Resolve source using shared utility (auto-detects if sourceType not provided)
    const source = resolveSource(options.sourceType, className, methodName);

    // Wrap method - handles both sync and async via result checking
    // This is more robust than checking constructor.name which can break with transpilation
    const wrappedMethod = function (this: unknown, ...args: unknown[]): unknown {
      // Check if tracing is enabled (static or dynamic)
      if (options.enabled !== undefined) {
        const isEnabled = typeof options.enabled === 'function'
          ? options.enabled()
          : options.enabled;

        if (!isEnabled) {
          // Tracing disabled - execute method without span
          return (originalMethod as (...a: unknown[]) => unknown).apply(this, args);
        }
      }

      const spanOptions: SpanOptions = {
        level: options.level,
        attributes: {
          'code.function': methodName,
          'code.namespace': className,
          ...options.attributes,
          ...(options.captureArgs && args.length > 0 && { args: safeSerialize(args) }),
        },
        tags: options.tags,
        source,
      };

      // CRITICAL FIX: Snapshot the current parent BEFORE starting the span
      // This prevents sibling operations (e.g., multiple calls in a loop) from forming a chain
      const ctx = getCurrentContext();
      const previousParentId = ctx?.parentObservabilityLogId;

      const span = SpanObserver.start(spanName, spanOptions);

      // Update context so child operations can link to this span
      // This is critical for SpanObserver.addEventToCurrentSpan() and nested spans
      setParentObservabilityLogId(span.id);

      // Execute method with automatic sync/async handling
      return executeWithHandlers(
        originalMethod as (...args: unknown[]) => unknown,
        this,
        args,
        (success, result, error) => {
          if (success) {
            if (options.captureResult && result !== undefined) {
              span.setAttribute('result', safeSerialize(result));
            }
            span.end({ success: true });
          } else {
            span.end({ success: false, error: normalizeError(error) });
          }
          
          // CRITICAL FIX: Restore the previous parent ID after span ends
          // This ensures sibling operations see the correct parent, not the just-completed span
          if (previousParentId !== undefined) {
            setParentObservabilityLogId(previousParentId);
          }
        }
      );
    };
    descriptor.value = wrappedMethod as T;

    return descriptor;
  };
}

