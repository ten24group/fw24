import { MessageAttributeValue } from '@aws-sdk/client-sqs';
import { ExecutionContextData } from '../core/runtime/execution-context';
/**
 * Options for sending a queue message
 */
export interface SendQueueMessageOptions {
    /**
     * Explicit execution context for trace propagation.
     * If not provided, automatically fetched from getCurrentExecutionContext().
     * Pass `null` to explicitly disable trace propagation.
     */
    context?: ExecutionContextData | null;
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
     * Additional message attributes (merged with trace attributes)
     */
    messageAttributes?: Record<string, MessageAttributeValue>;
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
