/**
 * Send message to queue
 * @param topicUrl
 * @param message
 */
export declare const sendTopicMessage: (topicUrl: string, message: any) => Promise<import("@aws-sdk/client-sns").PublishCommandOutput>;
