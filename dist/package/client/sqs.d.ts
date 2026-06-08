import { MessageAttributeValue } from '@aws-sdk/client-sqs';
import { ExecutionContextData } from '../core/runtime/execution-context';
/**
 * Common message properties for FIFO queues and attributes
 */
export interface QueueMessageProperties {
    /**
     * Message group ID for FIFO queues
     */
    messageGroupId?: string;
    /**
     * Message deduplication ID for FIFO queues
     */
    messageDeduplicationId?: string;
    /**
     * Delay in seconds before the message is available (0-900)
     */
    delaySeconds?: number;
    /**
     * Message attributes (merged with trace attributes)
     */
    messageAttributes?: Record<string, MessageAttributeValue>;
}
/**
 * Options for sending a queue message
 */
export interface SendQueueMessageOptions extends QueueMessageProperties {
    /**
     * Explicit execution context for trace propagation.
     * If not provided, automatically fetched from getCurrentExecutionContext().
     * Pass `null` to explicitly disable trace propagation.
     */
    context?: ExecutionContextData | null;
}
/**
 * Send message to SQS queue with automatic trace context propagation.
 *
 * @param queueUrl - The SQS queue URL
 * @param message - The message payload (will be JSON stringified)
 * @param options - Optional configuration including trace context
 * @returns SQS SendMessage response
 */
export declare const sendQueueMessage: (queueUrl: string, message: any, options?: SendQueueMessageOptions) => Promise<import("@aws-sdk/client-sqs").SendMessageCommandOutput>;
/**
 * Batch message entry for sendQueueMessageBatch
 */
export interface BatchQueueMessageEntry extends QueueMessageProperties {
    /**
     * Unique identifier for this message within the batch (required by SQS)
     */
    id: string;
    /**
     * The message payload (will be JSON stringified)
     */
    message: any;
}
/**
 * Send multiple messages to SQS queue in a single batch operation.
 *
 * @param queueUrl - The SQS queue URL
 * @param entries - Array of message entries (max 10 per SQS limitation)
 * @param options - Optional configuration (only context is used)
 * @returns SQS SendMessageBatch response
 */
export declare const sendQueueMessageBatch: (queueUrl: string, entries: BatchQueueMessageEntry[], options?: SendQueueMessageOptions) => Promise<import("@aws-sdk/client-sqs").SendMessageBatchCommandOutput>;
/**
 * Get queue metadata/statistics
 */
export declare const getQueueMessageMetadata: (queueUrl: string) => Promise<{
    messageCount: string | undefined;
    delaySeconds: string | undefined;
    messageCountDelayed: string | undefined;
    messageCountNotVisible: string | undefined;
    response: import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput;
}>;
