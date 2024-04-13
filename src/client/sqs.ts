import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({});
/**
 * Send message to queue
 * @param queueUrl 
 * @param message
 */
export const sendQueueMessage = async (queueUrl: string, message: any) => {

    const sqsCommand = new SendMessageCommand({ 
        QueueUrl: queueUrl, 
        MessageBody: JSON.stringify(message) 
    });

    const result = await sqsClient.send(sqsCommand);
    return result;
}