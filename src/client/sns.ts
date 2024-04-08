import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({});
/**
 * Send message to queue
 * @param topicUrl 
 * @param message
 */
export const sendTopicMessage = async (topicUrl: string, message: any) => {

    const snsCommand = new PublishCommand({ 
        TopicArn: topicUrl, 
        Message: JSON.stringify({ message: message })
    });

    const result = await snsClient.send(snsCommand);
    return result;
}