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
