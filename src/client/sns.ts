import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({});
/**
 * Send message to queue
 * @param topicUrl
 * @param message
 */
export const sendTopicMessage = async (topicUrl: string, message: any) => {
  //check if message group ID is provided
  const { messageGroupID = '' } = message;
  const messageGroupPayload =
    messageGroupID !== ''
      ? {
          MessageGroupId: messageGroupID,
        }
      : {};

  const snsCommand = new PublishCommand({
    TopicArn: topicUrl,
    Message: JSON.stringify({ message: message }),
    ...messageGroupPayload,
  });

  const result = await snsClient.send(snsCommand);
  return result;
};
