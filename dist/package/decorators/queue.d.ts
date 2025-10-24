import 'reflect-metadata';
import type { QueueProps } from "aws-cdk-lib/aws-sqs";
import type { IQueueSubscriptions } from "../constructs/queue-lambda";
import type { CommonLambdaHandlerOptions } from "./decorator-utils";
import type { ILambdaEnvConfig } from "../interfaces";
/**
 * Configuration options for the queue.
 */
/**
 * Represents the configuration options for a queue.
 */
export type IQueueConfig = CommonLambdaHandlerOptions & {
    /**
     * The properties of the queue.
     */
    queueProps?: QueueProps;
    /**
     * The properties for the SQS event source.
     */
    sqsEventSourceProps?: {
        /**
         * The number of messages to retrieve from the queue in a single batch.
         */
        batchSize?: number;
        /**
         * The maximum amount of time to wait before triggering a batch of messages.
         */
        maxBatchingWindowSeconds?: number;
        /**
         * Whether to report failures for individual batch items.
         */
        reportBatchItemFailures?: boolean;
    };
    /**
     * The visibility timeout for the messages in the queue, in seconds.
     */
    visibilityTimeoutSeconds?: number;
    /**
     * The amount of time for which a ReceiveMessage call will wait for a message to arrive in the queue before returning an empty response, in seconds.
     */
    receiveMessageWaitTimeSeconds?: number;
    /**
     * The number of days for which the messages in the queue are retained.
     */
    retentionPeriodDays?: number;
    /**
     * The number of times a message can be unsuccessfully dequeued before being moved to the dead-letter queue.
     */
    maxReceiveCount?: number;
    /**
     * The environment variables for the queue.
     */
    env?: Array<ILambdaEnvConfig>;
    /**
     * The subscriptions for the queue.
     */
    subscriptions?: IQueueSubscriptions;
};
/**
 * Decorator function defining a queue.
 * @param queueName - The name of the queue.
 * @param queueConfig - Optional configuration for the queue.
 * @returns A class decorator function.
 */
export declare function Queue(queueName: string, queueConfig?: IQueueConfig): <T extends {
    new (...args: any[]): {};
}>(target: T) => {
    new (...args: any[]): {};
} & T;
