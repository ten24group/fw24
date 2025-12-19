import { SNSClient, PublishCommand, PublishBatchCommand, PublishBatchRequestEntry, MessageAttributeValue } from '@aws-sdk/client-sns';
import { getCurrentExecutionContext, createSnsAttributes, ExecutionContextData } from '../core/runtime/execution-context';

const snsClient = new SNSClient({});

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
    return createSnsAttributes(contextWithCausedBy);
};

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
export const sendTopicMessage = async (
    topicArn: string,
    message: any,
    options?: SendTopicMessageOptions
) => {
    // Merge trace context with message attributes
    const messageAttributes = {
        ...getTraceAttributes(options?.context),
        ...options?.messageAttributes,
    };

    // Handle legacy messageGroupID in message body (backward compatibility)
    const { messageGroupID, ...messageBody } = message;
    const effectiveGroupId = options?.messageGroupId || messageGroupID || '';

    const snsCommand = new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(messageBody),
        MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        ...(effectiveGroupId ? { MessageGroupId: effectiveGroupId } : {}),
        ...(options?.messageDeduplicationId ? { MessageDeduplicationId: options.messageDeduplicationId } : {}),
    });

    const result = await snsClient.send(snsCommand);
    return result;
};

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
export const sendTopicMessageBatch = async (
    topicArn: string,
    messages: BatchTopicMessage[],
    options?: SendTopicMessageBatchOptions
) => {
    // Get trace context once for the batch
    const traceAttributes = getTraceAttributes(options?.context);

    // Convert messages to SNS batch entries
    const entries: PublishBatchRequestEntry[] = messages.map((msg) => {
        // Merge trace attributes with message-specific attributes
        const messageAttributes = {
            ...traceAttributes,
            ...msg.messageAttributes,
        };

        return {
            Id: msg.id,
            Message: JSON.stringify(msg.message),
            MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
            ...(msg.messageGroupId ? { MessageGroupId: msg.messageGroupId } : {}),
            ...(msg.messageDeduplicationId ? { MessageDeduplicationId: msg.messageDeduplicationId } : {}),
        };
    });

    const command = new PublishBatchCommand({
        TopicArn: topicArn,
        PublishBatchRequestEntries: entries,
    });

    const result = await snsClient.send(command);
    return result;
};
