import { SQSEvent, SQSBatchResponse, Context, DynamoDBStreamEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { IQueueConfig } from '../../decorators/queue';
import { ExecutionContextData, ParsedTraceContext } from './execution-context';
/**
 * Supported event types for queue/stream processing.
 */
export type QueueStreamEvent = SQSEvent | DynamoDBStreamEvent;
/**
 * Result type for queue processing.
 * - void: All messages processed successfully
 * - SQSBatchResponse: Partial batch failure (some messages need retry)
 */
export type QueueProcessResult = void | SQSBatchResponse;
/**
 * Queue execution context - contains queue-specific data AND execution context.
 */
export interface QueueExecutionContext<TEvent extends QueueStreamEvent = SQSEvent> {
    /** The event */
    readonly event: TEvent;
    /** Lambda context */
    readonly lambdaContext: Context;
    /** Execution context (also available via getCurrentExecutionContext()) */
    readonly executionContext: ExecutionContextData;
}
/**
 * Base class for handling SQS events (and optionally DynamoDB Stream events).
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
declare abstract class QueueController<TEvent extends QueueStreamEvent = SQSEvent> extends AbstractLambdaHandler {
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
    abstract process(event: TEvent, context: Context, ctx?: QueueExecutionContext<TEvent>): Promise<QueueProcessResult>;
    protected getQueueConfig(): IQueueConfig;
    protected getQueueName(): string | undefined;
    /**
     * Extract per-record trace contexts from the event.
     * Override in subclasses for different event types (e.g., DynamoDB streams).
     *
     * @param event - The incoming event
     * @returns Array of trace contexts (one per record, may contain undefined entries)
     */
    protected extractPerRecordTraceContexts(event: TEvent): (ParsedTraceContext | undefined)[];
    /**
     * Aggregate per-record trace contexts into batch-level trace info.
     */
    protected aggregateBatchTraceContext(recordTraceContexts: (ParsedTraceContext | undefined)[]): {
        batchCausedBy?: string;
        batchUpstreamCorrelationId?: string;
        isMixedBatch: boolean;
    };
    LambdaHandler(event: TEvent, context: Context): Promise<QueueProcessResult>;
}
export { QueueController };
