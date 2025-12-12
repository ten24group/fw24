import { SQSEvent, SQSBatchResponse, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { IQueueConfig } from '../../decorators/queue';
import { ExecutionContextData } from './execution-context';
/**
 * Result type for queue processing.
 * - void: All messages processed successfully
 * - SQSBatchResponse: Partial batch failure (some messages need retry)
 */
export type QueueProcessResult = void | SQSBatchResponse;
/**
 * Queue execution context - contains queue-specific data AND execution context.
 */
export interface QueueExecutionContext {
    /** The SQS event */
    readonly event: SQSEvent;
    /** Lambda context */
    readonly lambdaContext: Context;
    /** Execution context (also available via getCurrentExecutionContext()) */
    readonly executionContext: ExecutionContextData;
}
/**
 * Base class for handling SQS events.
 *
 * Generic TEvent allows subclasses to specify more specific event types
 * while maintaining type safety.
 *
 * All handler execution is wrapped in execution context.
 * Configure observability via the @Queue decorator:
 *
 * @example
 * ```typescript
 * @Queue('my-queue', {
 *   observability: {
 *     source: 'domain:queue-type',
 *     tags: { domain: 'sports', priority: 'high' }
 *   }
 * })
 * export class MyQueue extends QueueController { }
 * ```
 */
declare abstract class QueueController<TEvent extends SQSEvent = SQSEvent> extends AbstractLambdaHandler {
    protected initialize(_event: TEvent, _context: Context): Promise<void>;
    /**
     * Process the queue event.
     *
     * Return `void` if all messages processed successfully.
     * Return `SQSBatchResponse` with `batchItemFailures` for partial batch failures
     * (requires `reportBatchItemFailures: true` in queue config).
     *
     * @param event - The event
     * @param context - The Lambda context
     * @param ctx - Queue execution context
     * @returns void or SQSBatchResponse for partial batch failures
     */
    abstract process(event: TEvent, context: Context, ctx?: QueueExecutionContext): Promise<QueueProcessResult>;
    protected getQueueConfig(): IQueueConfig;
    protected getQueueName(): string | undefined;
    LambdaHandler(event: TEvent, context: Context): Promise<QueueProcessResult>;
}
export { QueueController };
