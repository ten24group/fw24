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
 * Trace context is automatically propagated to maintain distributed tracing:
 * - By default, uses the current execution context from AsyncLocalStorage
 * - Pass explicit `context` option to override
 * - Pass `context: null` to disable trace propagation
 *
 * @example
 * ```typescript
 * // Automatic trace propagation (recommended)
 * await sendQueueMessage(queueUrl, { orderId: '123', action: 'process' });
 *
 * // With explicit context
 * await sendQueueMessage(queueUrl, payload, { context: myContext });
 *
 * // Disable trace propagation
 * await sendQueueMessage(queueUrl, payload, { context: null });
 *
 * // FIFO queue with message group
 * await sendQueueMessage(queueUrl, payload, { messageGroupId: 'order-123' });
 * ```
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
 * Send multiple messages to SQS queue in a single batch operation with automatic trace context propagation.
 *
 * Trace context is automatically propagated to maintain distributed tracing:
 * - By default, uses the current execution context from AsyncLocalStorage
 * - Pass explicit `context` option to override
 * - Pass `context: null` to disable trace propagation
 * - The SAME trace context (with causedBy = current correlationId) is applied to ALL messages
 *
 * @example
 * ```typescript
 * // Automatic trace propagation (recommended)
 * await sendQueueMessageBatch(queueUrl, [
 *   { id: '1', message: { orderId: '123', action: 'process' } },
 *   { id: '2', message: { orderId: '456', action: 'process' } },
 * ]);
 *
 * // With additional message attributes per message
 * await sendQueueMessageBatch(queueUrl, [
 *   {
 *     id: '1',
 *     message: { orderId: '123' },
 *     messageAttributes: { priority: { DataType: 'String', StringValue: 'high' } }
 *   },
 * ]);
 *
 * // FIFO queue with message groups
 * await sendQueueMessageBatch(queueUrl, [
 *   { id: '1', message: { orderId: '123' }, messageGroupId: 'order-123' },
 *   { id: '2', message: { orderId: '456' }, messageGroupId: 'order-456' },
 * ]);
 * ```
 *
 * @param queueUrl - The SQS queue URL
 * @param entries - Array of message entries (max 10 per SQS limitation)
 * @param options - Optional configuration (only context is used, other MessageProperties are per-message in entries)
 * @returns SQS SendMessageBatch response
 */
export declare const sendQueueMessageBatch: (queueUrl: string, entries: BatchQueueMessageEntry[], options?: SendQueueMessageOptions) => Promise<import("@aws-sdk/client-sqs").SendMessageBatchCommandOutput>;
/**
 * Get queue metadata/statistics
 *
 * @param queueUrl - The SQS queue URL
 * @returns Queue metadata including message counts and delay settings
 */
export declare const getQueueMessageMetadata: (queueUrl: string) => Promise<{
    messageCount: string | undefined;
    delaySeconds: string | undefined;
    messageCountDelayed: string | undefined;
    messageCountNotVisible: string | undefined;
    response: import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput;
}>;
