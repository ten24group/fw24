/**
 * @Traced Decorator - Automatic span tracing for methods
 * 
 * Wraps a method in a span, automatically recording duration and errors.
 * Parent tracking is FULLY AUTOMATIC via span tree.
 * 
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Traced()
 *   async processOrder(orderId: string): Promise<Order> {
 *     // Method body is automatically traced
 *   }
 *   
 *   @Traced({ name: 'custom.operation', level: 'debug' })
 *   async helperMethod(): Promise<void> { }
 * }
 * ```
 */

import { getCurrentExecutionContext } from '../../core/runtime/execution-context';
import { SpanObserver, SpanOptions } from '../observers/span';
import type { NoiseControl } from '../types';
import { safeSerialize } from '../utils/payload';
import { SourceType, resolveSource } from './decorator-utils';

export interface TracedOptions {
  /** Custom span name (defaults to ClassName.methodName) */
  name?: string;
  /** Span level */
  level?: SpanOptions[ 'level' ];
  /** Tags for filtering */
  tags?: Record<string, string>;
  /** Initial data payload */
  data?: Record<string, unknown>;
  /** Capture method arguments */
  captureArgs?: boolean;
  /** Capture return value */
  captureResult?: boolean;
  /** Source type (auto-detected if not provided) */
  sourceType?: SourceType;
  /** Conditionally enable/disable */
  enabled?: boolean | (() => boolean);
  /** Capture control options */
  capture?: SpanOptions[ 'capture' ];

  /**
   * Noise reduction override for this traced span.
   * Convenience for setting `capture.noise` without having to build CaptureControl manually.
   */
  noise?: NoiseControl;
}

/**
 * Method decorator that wraps a method in a trace span
 */
export function Traced(options: TracedOptions = {}) {
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
    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const spanName = options.name ?? `${className}.${methodName}`;
    const source = resolveSource(options.sourceType, className, methodName);

    descriptor.value = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
      // Early exits
      if (!isEnabled(options) || !getCurrentExecutionContext()) {
        return originalMethod.apply(this, args) as ReturnType<T>;
      }

      return SpanObserver.wrap(
        spanName,
        () => {
          return originalMethod.apply(this, args) as ReturnType<T>;
        },
        {
          level: options.level,
          capture: options.noise
            ? { ...(options.capture ?? {}), noise: options.noise }
            : options.capture,
          source,
          tags: {
            ...options.tags,
            'code.function': methodName,
            'code.namespace': className,
          },
          data: {
            ...options.data,
            ...(options.captureArgs && args.length > 0 && { args: safeSerialize(args) }),
          },
        }
      ) as ReturnType<T>;
    } as T;

    return descriptor;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isEnabled(options: TracedOptions): boolean {
  if (options.enabled === undefined) return true;
  return typeof options.enabled === 'function' ? options.enabled() : options.enabled;
}
