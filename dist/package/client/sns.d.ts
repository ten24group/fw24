import { MessageAttributeValue } from '@aws-sdk/client-sns';
import { ExecutionContextData } from '../core/runtime/execution-context';
/**
 * Options for sending a topic message
 */
export interface SendTopicMessageOptions {
    /**
     * Explicit execution context for trace propagation.
     * If not provided, automatically fetched from getCurrentExecutionContext().
     * Pass `null` to explicitly disable trace propagation.
     */
    context?: ExecutionContextData | null;
    /**
     * Message group ID for FIFO topics
     */
    messageGroupId?: string;
    /**
     * Message deduplication ID for FIFO topics
     */
    messageDeduplicationId?: string;
    /**
     * Additional message attributes (merged with trace attributes)
     */
    messageAttributes?: Record<string, MessageAttributeValue>;
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
