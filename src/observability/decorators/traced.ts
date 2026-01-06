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
import type { DecoratorBaseOptions, CaptureSerializeOptions } from '../types';
import { resolveSource } from './decorator-utils';
import { safeSerialize, type SerializeOptions } from '../utils/payload';

export interface TracedOptions extends DecoratorBaseOptions {
  /** Custom span name (defaults to ClassName.methodName) */
  name?: string;
  /** Span level */
  level?: SpanOptions[ 'level' ];
  /** Initial data payload */
  data?: Record<string, unknown>;
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

    descriptor.value = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
      // Early exits
      if (!isEnabled(options) || !getCurrentExecutionContext()) {
        return originalMethod.apply(this, args) as ReturnType<T>;
      }

      // Extract RecordOverrides from options
      const {
        name,
        level,
        data,
        enabled,
        sourceType,
        ...recordOverrides
      } = options;

      // Compute source (use explicit source override if provided, otherwise auto-detect)
      const computedSource = resolveSource(sourceType, className, methodName);
      const finalSource = recordOverrides.source ?? computedSource;

      // Extract capture options from capture namespace
      const argsSerializeOpts = toSerializeOptions(recordOverrides.capture?.args);

      return SpanObserver.wrap(
        spanName,
        () => {
          return originalMethod.apply(this, args) as ReturnType<T>;
        },
        {
          ...recordOverrides,
          level,
          source: finalSource,
          tags: {
            ...recordOverrides.tags,
            'code.function': methodName,
            'code.namespace': className,
          },
          data: {
            ...data,
            ...(argsSerializeOpts && args.length > 0 && { args: safeSerialize(args, argsSerializeOpts) }),
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

/**
 * Convert decorator capture options to SerializeOptions
 */
function toSerializeOptions(option: boolean | CaptureSerializeOptions | undefined): SerializeOptions | undefined {
  if (option === undefined || option === false) return undefined;
  if (option === true) return {}; // Use defaults
  return option; // Already SerializeOptions
}
