import { GetQueueAttributesCommand, SQSClient, SendMessageCommand, SendMessageCommandInput, MessageAttributeValue, SendMessageBatchCommand, SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs';
import { ExecutionContextData } from '../core/runtime/execution-context';
import { getSqsTraceAttributes, getClientConfig } from './util';

/**
 * Lazily-created SQS client.
 *
 * We intentionally rely on the AWS SDK's native environment/config resolution:
 * - AWS_PROFILE / shared credentials
 * - AWS_REGION
 * - AWS_ENDPOINT_URL_SQS (service-specific endpoint override; perfect for local-aws-sqs)
 *
 * This avoids FW24-specific endpoint/credential logic here and keeps behavior predictable.
 */
let sqsClient: SQSClient | null = null;

function getSqsClient(): SQSClient {
    if (sqsClient) return sqsClient;
    sqsClient = new SQSClient(getClientConfig('SQS'));
    return sqsClient;
}

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
export const sendQueueMessage = async (
    queueUrl: string,
    message: any,
    options?: SendQueueMessageOptions
) => {
    // Merge trace context with message attributes
    const messageAttributes = {
        ...getSqsTraceAttributes(options?.context),
        ...options?.messageAttributes,
    };

    const { messageGroupID, ...messageBody } = message;
    const effectiveGroupId = options?.messageGroupId || messageGroupID || '';

    const queuePayload: SendMessageCommandInput = {
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(messageBody),
        MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
    };

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
    const result = await getSqsClient().send(sqsCommand);
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
 * Send multiple messages to SQS queue in a single batch operation.
 * 
 * @param queueUrl - The SQS queue URL
 * @param entries - Array of message entries (max 10 per SQS limitation)
 * @param options - Optional configuration (only context is used)
 * @returns SQS SendMessageBatch response
 */
export const sendQueueMessageBatch = async (
    queueUrl: string,
    entries: BatchQueueMessageEntry[],
    options?: SendQueueMessageOptions
) => {
    const traceAttributes = getSqsTraceAttributes(options?.context);

    const batchEntries: SendMessageBatchRequestEntry[] = entries.map((entry) => {
        const messageAttributes = {
            ...traceAttributes,
            ...entry.messageAttributes,
        };

        const { messageGroupID, ...messageBody } = entry.message;
        const effectiveGroupId = entry.messageGroupId || messageGroupID || undefined;

        const batchEntry: SendMessageBatchRequestEntry = {
            Id: entry.id,
            MessageBody: JSON.stringify(messageBody),
            MessageAttributes: Object.keys(messageAttributes).length > 0 ? messageAttributes : undefined,
        };

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

    const result = await getSqsClient().send(command);
    return result;
};

/**
 * Get queue metadata/statistics
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

    const response = await getSqsClient().send(command);

    return {
        messageCount: response.Attributes?.ApproximateNumberOfMessages,
        delaySeconds: response.Attributes?.DelaySeconds,
        messageCountDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed,
        messageCountNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
        response: response,
    };
};
