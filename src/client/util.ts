export const Environment = {
    emailQueueUrl: process.env.EMAIL_QUEUE_URL || '',
    queueUrl: (queueName: string) => process.env[queueName + '_queueUrl'] || '',
    topicUrl: (topicName: string) => process.env[topicName + '_topicUrl'] || '',
    bucketName: (bucketName: string) => process.env['bucket_' + bucketName] || ''
}