/**
 * @Checkpoint Decorator - Lightweight checkpoint tracking without creating spans
 *
 * Adds checkpoints to the CURRENT span (if one exists) instead of creating new spans.
 * Perfect for tracking steps within an operation without span overhead.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Observed() // Creates span
 *   async processOrder(order: Order) {
 *     await this.validateOrder(order);    // Checkpoint added
 *     await this.chargePayment(order);    // Checkpoint added
 *     await this.shipOrder(order);        // Checkpoint added
 *     return order;
 *   }
 *
 *   @Checkpoint('order.validation')
 *   private async validateOrder(order: Order) {
 *     // Just adds checkpoint, no span created
 *   }
 *
 *   @Checkpoint({
 *     name: 'order.payment',
 *     extract: {
 *       start: (ctx) => ({
 *         tags: { paymentMethod: ctx.args[0].paymentMethod }
 *       }),
 *       finish: (ctx) => ({
 *         metrics: { amount: ctx.args[0].amount }
 *       })
 *     }
 *   })
 *   private async chargePayment(order: Order) {
 *     // Checkpoint with extracted context
 *   }
 * }
 * ```
 */
export interface CheckpointEnrichment {
    /** Checkpoint-specific tags */
    tags?: Record<string, string>;
    /** Checkpoint-specific metrics */
    metrics?: Record<string, number>;
    /** Checkpoint-specific data */
    data?: Record<string, unknown>;
}
export interface CheckpointExtractContext<TInstance, TArgs extends unknown[], TResult> {
    instance: TInstance;
    args: TArgs;
    operationName: string;
    source: string;
    /** Only available in finish() */
    result?: TResult;
    /** Only available in finish() */
    error?: Error;
    /** Only available in finish() */
    success?: boolean;
    /** Only available in finish() */
    durationMs?: number;
}
type BivariantFn<T extends (...args: any[]) => any> = {
    bivarianceHack: T;
}['bivarianceHack'];
export interface CheckpointExtractor<TInstance, TArgs extends unknown[], TResult> {
    /**
     * Extract enrichment before method execution.
     * Useful for capturing input parameters as checkpoint data.
     */
    start?: BivariantFn<(ctx: CheckpointExtractContext<TInstance, TArgs, TResult>) => CheckpointEnrichment | void>;
    /**
     * Extract enrichment after method execution.
     * Useful for capturing result/error information.
     */
    finish?: BivariantFn<(ctx: CheckpointExtractContext<TInstance, TArgs, TResult>) => CheckpointEnrichment | void>;
}
export interface CheckpointOptions<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown> {
    /**
     * Checkpoint name (defaults to ClassName.methodName).
     * Can use patterns: 'operation.step', 'entity.action', etc.
     */
    name?: string;
    /**
     * Extraction API for enriching checkpoints with context.
     * Allows capturing args/result without serializing entire payloads.
     */
    extract?: CheckpointExtractor<TInstance, TArgs, TResult>;
    /**
     * Static tags to apply to the checkpoint.
     * For dynamic tags, use extract.start or extract.finish.
     */
    tags?: Record<string, string>;
    /**
     * Whether to add checkpoint on method start (before execution).
     * Default: false (only checkpoint on finish)
     */
    checkpointStart?: boolean;
    /**
     * Whether to add checkpoint on method finish (after execution).
     * Default: true
     */
    checkpointFinish?: boolean;
    /**
     * If true, logs a warning when no span exists to attach checkpoint to.
     * Default: true (warns to catch missing @Observed parent)
     */
    warnIfNoSpan?: boolean;
}
/**
 * @Checkpoint decorator with string name
 */
export declare function Checkpoint(name: string): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
/**
 * @Checkpoint decorator with options
 */
export declare function Checkpoint<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown>(options: CheckpointOptions<TInstance, TArgs, TResult>): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
/**
 * @Checkpoint decorator with no args (uses method name)
 */
export declare function Checkpoint(): <T extends (...args: any[]) => any>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
export {};
