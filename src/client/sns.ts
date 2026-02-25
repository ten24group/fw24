import { SNSClient, PublishCommand, PublishBatchCommand, PublishBatchRequestEntry, MessageAttributeValue } from '@aws-sdk/client-sns';
import { ExecutionContextData } from '../core/runtime/execution-context';
import { getSnsTraceAttributes, getClientConfig } from './util';

/**
 * Lazily-created SNS client.
 * Respects AWS_ENDPOINT_URL_SNS for local development/simulation.
 */
let snsClient: SNSClient | null = null;

function getSnsClient(): SNSClient {
    if (snsClient) return snsClient;
    snsClient = new SNSClient(getClientConfig('SNS'));
    return snsClient;
}

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
export const sendTopicMessage = async (
    topicArn: string,
    message: any,
    options?: SendTopicMessageOptions
) => {
    const messageAttributes = {
        ...getSnsTraceAttributes(options?.context),
        ...options?.messageAttributes,
    };

    const { messageGroupID, ...messageBody } = message;
    const effectiveGroupId = options?.messageGroupId || messageGroupID || '';

    const snsCommand = new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(messageBody),
        MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        ...(effectiveGroupId ? { MessageGroupId: effectiveGroupId } : {}),
        ...(options?.messageDeduplicationId ? { MessageDeduplicationId: options.messageDeduplicationId } : {}),
    });

    const result = await getSnsClient().send(snsCommand);
    return result;
};

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
export const sendTopicMessageBatch = async (
    topicArn: string,
    messages: BatchTopicMessage[],
    options?: SendTopicMessageBatchOptions
) => {
    const traceAttributes = getSnsTraceAttributes(options?.context);

    const entries: PublishBatchRequestEntry[] = messages.map((msg) => {
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

    const result = await getSnsClient().send(command);
    return result;
};
