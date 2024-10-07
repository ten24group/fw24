import { resolveEnvValueFor } from "../utils";

export const Environment = {
    emailQueueUrl: resolveEnvValueFor({key: 'EMAIL_QUEUE_URL'}) || '',
    queueUrl: (queueName: string) => resolveEnvValueFor({ key: queueName, suffix: 'queueUrl'}) || '',
    topicArn: (topicName: string) => resolveEnvValueFor({ key: topicName, suffix: 'topicArn'}) || '',
    bucketName: (bucketName: string) => resolveEnvValueFor({ key: bucketName, prefix: 'bucket' }) || ''
}