import { GetQueueAttributesCommand, SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({});
/**
 * Send message to queue
 * @param queueUrl 
 * @param message
 */
export const sendQueueMessage = async (queueUrl: string, message: any) => {
    
    //check if message group ID is provided
    const { messageGroupID = "" } = message;
    const messageGroupPayload = messageGroupID !== "" ? {
        MessageGroupId : messageGroupID,
    } : {}

    const queuePayload = { 
        QueueUrl: queueUrl, 
        MessageBody: JSON.stringify(message),
        ...messageGroupPayload
    }
    const sqsCommand = new SendMessageCommand({...queuePayload});

    const result = await sqsClient.send(sqsCommand);
    return result;
}

export const getQueueMessageMetadata = async ( queueUrl: string ) => {
    const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [ 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed', 'DelaySeconds' ]
    });

    const response = await sqsClient.send(command);

    response.Attributes?.ApproximateNumberOfMessagesDelayed

    return {
        messageCount: response.Attributes?.ApproximateNumberOfMessages,
        delaySeconds: response.Attributes?.DelaySeconds,
        messageCountDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed,
        messageCountNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
        response: response
    }
}

