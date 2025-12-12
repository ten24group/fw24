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
import { SpanOptions } from '../observers/span';
export interface TracedOptions {
    /** Custom span name (defaults to ClassName.methodName) */
    name?: string;
    /** Span level */
    level?: SpanOptions['level'];
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
export declare function Traced(options?: TracedOptions): <T extends (...args: unknown[]) => unknown>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
