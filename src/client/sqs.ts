import { GetQueueAttributesCommand, SQSClient, SendMessageCommand, SendMessageCommandInput, MessageAttributeValue } from '@aws-sdk/client-sqs';
import { getCurrentExecutionContext, createSqsAttributes, ExecutionContextData } from '../core/runtime/execution-context';

const sqsClient = new SQSClient({});

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
export const sendQueueMessage = async (
    queueUrl: string,
    message: any,
    options?: SendQueueMessageOptions
) => {
    // Get trace context: explicit > auto > none
    let traceAttributes: Record<string, MessageAttributeValue> = {};

    if (options?.context !== null) {
        const ctx = options?.context ?? getCurrentExecutionContext();
        if (ctx) {
            traceAttributes = createSqsAttributes(ctx);
        }
    }

    // Merge with any additional message attributes
    const messageAttributes = {
        ...traceAttributes,
        ...options?.messageAttributes,
    };

    // Handle legacy messageGroupID in message body (backward compatibility)
    const { messageGroupID, ...messageBody } = message;
    const effectiveGroupId = options?.messageGroupId || messageGroupID || '';

    const queuePayload: SendMessageCommandInput = {
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(messageBody),
        MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
    };

    // FIFO queue options
    if (effectiveGroupId) {
        queuePayload.MessageGroupId = effectiveGroupId;
    }

    if (options?.messageDeduplicationId) {
        queuePayload.MessageDeduplicationId = options.messageDeduplicationId;
    }

    if (options?.delaySeconds !== undefined) {
        queuePayload.DelaySeconds = options.delaySeconds;
    }

    const sqsCommand = new SendMessageCommand(queuePayload);
    const result = await sqsClient.send(sqsCommand);
    return result;
};

/**
 * Get queue metadata/statistics
 * 
 * @param queueUrl - The SQS queue URL
 * @returns Queue metadata including message counts and delay settings
 */
export const getQueueMessageMetadata = async (queueUrl: string) => {
    const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed',
            'DelaySeconds',
        ],
    });

    const response = await sqsClient.send(command);

    return {
        messageCount: response.Attributes?.ApproximateNumberOfMessages,
        delaySeconds: response.Attributes?.DelaySeconds,
        messageCountDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed,
        messageCountNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
        response: response,
    };
};
