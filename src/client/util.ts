import { resolveEnvValueFor } from '../utils';
import { MessageAttributeValue as SqsMessageAttributeValue } from '@aws-sdk/client-sqs';
import { MessageAttributeValue as SnsMessageAttributeValue } from '@aws-sdk/client-sns';
import { getCurrentExecutionContext, createSqsAttributes, createSnsAttributes, ExecutionContextData } from '../core/runtime/execution-context';

export const Environment = {
    emailQueueUrl: resolveEnvValueFor({ key: 'EMAIL_QUEUE_URL' }) || '',
    queueUrl: (queueName: string) => resolveEnvValueFor({ key: queueName, suffix: 'queueUrl' }) || '',
    topicArn: (topicName: string) => resolveEnvValueFor({ key: topicName, suffix: 'topicArn' }) || '',
    bucketName: (bucketName: string) => {
        // Try to resolve from env first (e.g., 'FILES_BUCKET_NAME' -> env value)
        const resolved = resolveEnvValueFor({ key: bucketName, prefix: 'bucket' });
        // If env resolution fails, assume it's an actual bucket name and return as-is
        return resolved || bucketName;
    }
};

/**
 * Configure AWS SDK client options for local simulation if needed.
 * This is used to ensure compatibility with local sidecars (e.g. Minio needing forcePathStyle).
 */
export function getClientConfig(service: 'S3' | 'DynamoDB' | 'SQS' | 'SNS' | 'SES' | 'Cognito'): any {
    const config: any = {};

    // Check for service-specific endpoint overrides (standard AWS SDK env vars)
    const endpoint = process.env[`AWS_ENDPOINT_URL_${service.toUpperCase()}`] || process.env.AWS_ENDPOINT_URL;
    if (endpoint) {
        config.endpoint = endpoint;

        // S3-specific local compatibility
        if (service === 'S3') {
            config.forcePathStyle = true;
        }

        // For local simulation, disable SSL if endpoint is http
        if (endpoint.startsWith('http://')) {
            config.tls = false;
        }
    }

    return config;
}

/**
 * Get SQS trace attributes from execution context.
 * Automatically sets causedBy to current correlationId for cross-invocation tracing.
 * 
 * @param context - Explicit context, null to disable, or undefined to use current context
 */
export function getSqsTraceAttributes(context?: ExecutionContextData | null): Record<string, SqsMessageAttributeValue> {
    if (context === null) {
        return {};
    }

    const ctx = context ?? getCurrentExecutionContext();
    if (!ctx) {
        return {};
    }

    // Outgoing propagation contract is centralized in execution-context/propagation.ts.
    return createSqsAttributes(ctx);
}

/**
 * Get SNS trace attributes from execution context.
 * Automatically sets causedBy to current correlationId for cross-invocation tracing.
 * 
 * @param context - Explicit context, null to disable, or undefined to use current context
 */
export function getSnsTraceAttributes(context?: ExecutionContextData | null): Record<string, SnsMessageAttributeValue> {
    if (context === null) {
        return {};
    }

    const ctx = context ?? getCurrentExecutionContext();
    if (!ctx) {
        return {};
    }

    // Outgoing propagation contract is centralized in execution-context/propagation.ts.
    return createSnsAttributes(ctx);
}
