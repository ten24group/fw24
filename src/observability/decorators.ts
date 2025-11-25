import { Span, withSpan } from './span';
import { createControllerSource, createServiceSource } from './utils/source-utils';

export interface TracedOptions {
  operation?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
  source?: string;
  tags?: Record<string, string>;
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
    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const operation = options?.operation || `${className}.${methodName}`;
    
    // Auto-detect source type from class name
    const isController = className.toLowerCase().includes('controller');
    const isService = className.toLowerCase().includes('service');
    const autoSource = isController 
      ? createControllerSource(className, methodName)
      : isService 
        ? createServiceSource(className, methodName)
        : `class:${className}.${methodName}`;
    
    const source = options?.source || autoSource;

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
          
          // Add custom tags
          if (options?.tags) {
            Object.entries(options.tags).forEach(([key, value]) => {
              span.setAttribute(`tag.${key}`, value);
            });
          }

          return await originalMethod.apply(this, args);
        },
        {
          level: options?.level || 'info',
          traceId,
          parentSpanId,
          source,
          tags: options?.tags,
        },
      );
    };

    return descriptor;
  };
}

