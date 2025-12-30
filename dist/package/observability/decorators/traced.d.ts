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
import { SpanOptions } from '../observers/span';
import type { DecoratorBaseOptions } from '../types';
export interface TracedOptions extends DecoratorBaseOptions {
    /** Custom span name (defaults to ClassName.methodName) */
    name?: string;
    /** Span level */
    level?: SpanOptions['level'];
    /** Initial data payload */
    data?: Record<string, unknown>;
}
/**
 * Method decorator that wraps a method in a trace span
 */
export declare function Traced(options?: TracedOptions): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
