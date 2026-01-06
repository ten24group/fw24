import { MessageAttributeValue } from '@aws-sdk/client-sns';
import { ExecutionContextData } from '../core/runtime/execution-context';
/**
 * Common message properties for FIFO topics and attributes
 */
export interface MessageProperties {
    messageGroupId?: string;
    messageDeduplicationId?: string;
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
    id: string;
    message: any;
}
/**
 * Options for batch sending
 */
export interface SendTopicMessageBatchOptions {
    context?: ExecutionContextData | null;
}
/**
 * Send multiple messages to SNS topic in batches (up to 10 per API call).
 *
 * @param topicArn - The SNS topic ARN
 * @param messages - Array of messages to publish (max 10 per batch)
 * @param options - Optional configuration including trace context
 * @returns SNS PublishBatch response
 */
export declare const sendTopicMessageBatch: (topicArn: string, messages: BatchTopicMessage[], options?: SendTopicMessageBatchOptions) => Promise<import("@aws-sdk/client-sns").PublishBatchCommandOutput>;
