/**
 * Send message to queue
 * @param queueUrl
 * @param message
 */
export declare const sendQueueMessage: (queueUrl: string, message: any) => Promise<import("@aws-sdk/client-sqs").SendMessageCommandOutput>;
export declare const getQueueMessageMetadata: (queueUrl: string) => Promise<{
    messageCount: string | undefined;
    delaySeconds: string | undefined;
    messageCountDelayed: string | undefined;
    messageCountNotVisible: string | undefined;
    response: import("@aws-sdk/client-sqs").GetQueueAttributesCommandOutput;
}>;
