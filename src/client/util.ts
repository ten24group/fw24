export const Environment = {
    emailQueueUrl: process.env.EMAIL_QUEUE_URL || '',
    queueUrl: (queueName: string) => process.env[queueName + '_queueUrl'] || '',
    topicArn: (topicName: string) => process.env[topicName + '_topicArn'] || '',
    bucketName: (bucketName: string) => process.env['bucket_' + bucketName] || ''
}