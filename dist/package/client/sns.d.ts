import { MessageAttributeValue } from '@aws-sdk/client-sns';
import { ExecutionContextData } from '../core/runtime/execution-context';
/**
 * Common message properties for FIFO topics and attributes
 */
export interface MessageProperties {
    /**
     * Message group ID for FIFO topics
     */
    messageGroupId?: string;
    /**
     * Message deduplication ID for FIFO topics
     */
    messageDeduplicationId?: string;
    /**
     * Message attributes (merged with trace attributes)
     */
    messageAttributes?: Record<string, MessageAttributeValue>;
}
/**
 * Options for sending a topic message
 */
export interface SendTopicMessageOptions extends MessageProperties {
    /**
     * Explicit execution context for trace propagation.
     * If not provided, automatically fetched from getCurrentExecutionContext().
     * Pass `null` to explicitly disable trace propagation.
     */
    context?: ExecutionContextData | null;
}
/**
 * Send message to SNS topic with automatic trace context propagation.
 *
 * Trace context is automatically propagated to maintain distributed tracing:
 * - By default, uses the current execution context from AsyncLocalStorage
 * - Pass explicit `context` option to override
 * - Pass `context: null` to disable trace propagation
 *
 * @example
 * ```typescript
 * // Automatic trace propagation (recommended)
 * await sendTopicMessage(topicArn, { orderId: '123', action: 'process' });
 *
 * // With explicit context
 * await sendTopicMessage(topicArn, payload, { context: myContext });
 *
 * // Disable trace propagation
 * await sendTopicMessage(topicArn, payload, { context: null });
 *
 * // FIFO topic with message group
 * await sendTopicMessage(topicArn, payload, { messageGroupId: 'order-123' });
 * ```
 *
 * @param topicArn - The SNS topic ARN
 * @param message - The message payload (will be JSON stringified)
 * @param options - Optional configuration including trace context
 * @returns SNS Publish response
 */
export declare const sendTopicMessage: (topicArn: string, message: any, options?: SendTopicMessageOptions) => Promise<import("@aws-sdk/client-sns").PublishCommandOutput>;
/**
 * Message for batch publishing
 */
export interface BatchTopicMessage extends MessageProperties {
    /**
     * Unique ID for this message in the batch (for result matching)
     */
    id: string;
    /**
     * The message payload (will be JSON stringified)
     */
    message: any;
}
/**
 * Options for batch sending
 */
export interface SendTopicMessageBatchOptions {
    /**
     * Explicit execution context for trace propagation.
     * If not provided, automatically fetched from getCurrentExecutionContext().
     * Pass `null` to explicitly disable trace propagation.
     */
    context?: ExecutionContextData | null;
}
/**
 * Send multiple messages to SNS topic in batches (up to 10 per API call).
 * Only works with standard topics - FIFO topics should use sendTopicMessage individually.
 *
 * Trace context is automatically propagated to maintain distributed tracing.
 *
 * @example
 * ```typescript
 * const messages = [
 *   { id: '1', message: { orderId: '123' } },
 *   { id: '2', message: { orderId: '456' } }
 * ];
 *
 * const result = await sendTopicMessageBatch(topicArn, messages);
 * if (result.Failed && result.Failed.length > 0) {
 *   console.error('Some messages failed:', result.Failed);
 * }
 * ```
 *
 * @param topicArn - The SNS topic ARN
 * @param messages - Array of messages to publish (max 10 per batch)
 * @param options - Optional configuration including trace context
 * @returns SNS PublishBatch response with Successful and Failed arrays
 */
export declare const sendTopicMessageBatch: (topicArn: string, messages: BatchTopicMessage[], options?: SendTopicMessageBatchOptions) => Promise<import("@aws-sdk/client-sns").PublishBatchCommandOutput>;
