import { GetQueueAttributesCommand, SQSClient, SendMessageCommand, SendMessageCommandInput, MessageAttributeValue, SendMessageBatchCommand, SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs';
import { getCurrentExecutionContext, createSqsAttributes, ExecutionContextData } from '../core/runtime/execution-context';

const sqsClient = new SQSClient({});

/**
 * Get trace attributes from execution context
 * Automatically sets causedBy to current correlationId for cross-invocation tracing
 */
const getTraceAttributes = (context?: ExecutionContextData | null): Record<string, MessageAttributeValue> => {
    if (context === null) {
        return {};
    }

    const ctx = context ?? getCurrentExecutionContext();
    if (!ctx) {
        return {};
    }

    // For cross-invocation tracing: Set causedBy to CURRENT correlationId
    // This links the downstream processing back to THIS invocation (immediate parent)
    // Creating a navigable chain: A→B→C, not all pointing to root A
    const contextWithCausedBy = {
        ...ctx,
        causedBy: ctx.correlationId,
    };
    return createSqsAttributes(contextWithCausedBy);
};

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
export const sendQueueMessage = async (
    queueUrl: string,
    message: any,
    options?: SendQueueMessageOptions
) => {
    // Merge trace context with message attributes
    const messageAttributes = {
        ...getTraceAttributes(options?.context),
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
export const sendQueueMessageBatch = async (
    queueUrl: string,
    entries: BatchQueueMessageEntry[],
    options?: SendQueueMessageOptions
) => {
    // Get trace context once for the entire batch
    const traceAttributes = getTraceAttributes(options?.context);

    // Build batch entries with trace context
    const batchEntries: SendMessageBatchRequestEntry[] = entries.map((entry) => {
        // Merge trace attributes with per-message attributes
        const messageAttributes = {
            ...traceAttributes,
            ...entry.messageAttributes,
        };

        // Handle legacy messageGroupID in message body (backward compatibility)
        const { messageGroupID, ...messageBody } = entry.message;
        const effectiveGroupId = entry.messageGroupId || messageGroupID || undefined;

        const batchEntry: SendMessageBatchRequestEntry = {
            Id: entry.id,
            MessageBody: JSON.stringify(messageBody),
            MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        };

        // FIFO queue options
        if (effectiveGroupId) {
            batchEntry.MessageGroupId = effectiveGroupId;
        }

        if (entry.messageDeduplicationId) {
            batchEntry.MessageDeduplicationId = entry.messageDeduplicationId;
        }

        if (entry.delaySeconds !== undefined) {
            batchEntry.DelaySeconds = entry.delaySeconds;
        }

        return batchEntry;
    });

    const command = new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batchEntries,
    });

    const result = await sqsClient.send(command);
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
