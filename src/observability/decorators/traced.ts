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

import { SpanObserver, SpanOptions } from '../observers/span';
import { createControllerSource, createServiceSource, createQueueSource, createTaskSource, detectSource } from '../utils/source-utils';
import { safeSerialize } from '../utils/payload';
import { normalizeError } from '../observers/base';

/**
 * Auto-detect source type from class name
 */
function autoDetectSourceType(className: string): 'controller' | 'service' | 'queue' | 'task' | 'handler' {
  const lowerName = className.toLowerCase();
  
  if (lowerName.includes('controller')) {
    return 'controller';
  }
  if (lowerName.includes('service')) {
    return 'service';
  }
  if (lowerName.includes('queue') || lowerName.includes('queuehandler')) {
    return 'queue';
  }
  if (lowerName.includes('task') || lowerName.includes('taskhandler')) {
    return 'task';
  }
  
  return 'handler';
}

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
  sourceType?: 'controller' | 'service' | 'handler' | 'queue' | 'task';
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

    // Auto-detect source type if not explicitly provided
    const sourceType = options.sourceType ?? autoDetectSourceType(className);
    
    // Determine source based on sourceType
    let source: string;
    switch (sourceType) {
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

    // Wrap method - handles both sync and async via result checking
    // This is more robust than checking constructor.name which can break with transpilation
    const wrappedMethod = function (this: unknown, ...args: unknown[]): unknown {
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

      const span = SpanObserver.start(spanName, spanOptions);

      try {
        const result = (originalMethod as (...a: unknown[]) => unknown).apply(this, args);

        // Check if result is a Promise/thenable (works with any async method)
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          // Handle async method
          return (result as Promise<unknown>)
            .then((value) => {
              if (options.captureResult && value !== undefined) {
                span.setAttribute('result', safeSerialize(value));
              }
              span.end({ success: true });
              return value;
            })
            .catch((error) => {
              span.end({ success: false, error: normalizeError(error) });
              throw error;
            });
        }

        // Handle sync method
        if (options.captureResult && result !== undefined) {
          span.setAttribute('result', safeSerialize(result));
        }
        span.end({ success: true });
        return result;
      } catch (error) {
        span.end({ success: false, error: normalizeError(error) });
        throw error;
      }
    };
    descriptor.value = wrappedMethod as T;

    return descriptor;
  };
}

