import { MessageAttributeValue as SqsMessageAttributeValue } from '@aws-sdk/client-sqs';
import { MessageAttributeValue as SnsMessageAttributeValue } from '@aws-sdk/client-sns';
import { ExecutionContextData } from '../core/runtime/execution-context';
export declare const Environment: {
    emailQueueUrl: any;
    queueUrl: (queueName: string) => any;
    topicArn: (topicName: string) => any;
    bucketName: (bucketName: string) => any;
};
/**
 * Configure AWS SDK client options for local simulation if needed.
 * This is used to ensure compatibility with local sidecars (e.g. Minio needing forcePathStyle).
 */
export declare function getClientConfig(service: 'S3' | 'DynamoDB' | 'SQS' | 'SNS' | 'SES' | 'Cognito'): any;
/**
 * Get SQS trace attributes from execution context.
 * Automatically sets causedBy to current correlationId for cross-invocation tracing.
 *
 * @param context - Explicit context, null to disable, or undefined to use current context
 */
export declare function getSqsTraceAttributes(context?: ExecutionContextData | null): Record<string, SqsMessageAttributeValue>;
/**
 * Get SNS trace attributes from execution context.
 * Automatically sets causedBy to current correlationId for cross-invocation tracing.
 *
 * @param context - Explicit context, null to disable, or undefined to use current context
 */
export declare function getSnsTraceAttributes(context?: ExecutionContextData | null): Record<string, SnsMessageAttributeValue>;
