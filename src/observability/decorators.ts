import { Span, withSpan } from './span';

export interface TracedOptions {
  operation?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
}

/**
 * Decorator to automatically trace method execution
 * 
 * @example
 * ```typescript
 * class MyService {
 *   async processOrder(orderId: string) {
 *     // method body
 *   }
 * }
 * ```
 */
export function Traced(options?: TracedOptions): MethodDecorator {
  return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const operation = options?.operation || `${target.constructor.name}.${String(propertyKey)}`;

    descriptor.value = async function (...args: any[]) {
      // Extract context if available from 'this'
      const ctx = (this as any).context || (this as any).executionContext || (this as any).ctx;
      const traceId = ctx?.observability?.traceId || ctx?.traceId;
      const parentSpanId = ctx?.observability?.spanId;

      return await withSpan(
        operation,
        async (span: Span) => {
          // Add actor if available
          if (ctx?.actor) {
            span.setAttribute('actor.id', ctx.actor.actorId);
            span.setAttribute('actor.type', ctx.actor.actorType);
          }

          // Add method arguments as attributes (sanitized)
          if (args.length > 0) {
            span.setAttribute('method.args_count', args.length);
          }

          return await originalMethod.apply(this, args);
        },
        {
          level: options?.level || 'info',
          traceId,
          parentSpanId,
        },
      );
    };

    return descriptor;
  };
}

