import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { LambdaFunctionProps } from "./lambda-function";
import { ILogger } from "../logging";
/**
 * Represents the properties for a QueueLambdaFunction.
 */
interface QueueLambdaFunctionProps {
    /**
     * The name of the queue.
     */
    queueName: string;
    /**
     * The properties for the queue.
     */
    queueProps?: QueueProps;
    /**
     * The visibility timeout for the queue in seconds.
     */
    visibilityTimeoutSeconds?: number;
    /**
     * The wait time for receiving messages from the queue in seconds.
     */
    receiveMessageWaitTimeSeconds?: number;
    /**
     * The retention period for the queue in days.
     */
    retentionPeriodDays?: number;
    /**
     * The number of times a message can be unsuccessfully dequeued before being moved to the dead-letter queue.
     */
    maxReceiveCount?: number;
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
        maxBatchingWindow?: Duration;
        /**
         * Whether to report failures for individual batch items.
         */
        reportBatchItemFailures?: boolean;
    };
    /**
     * The properties for the lambda function.
     */
    lambdaFunctionProps?: LambdaFunctionProps;
    /**
     * The subscriptions for the queue.
     */
    subscriptions?: IQueueSubscriptions;
}
/**
 * Represents the subscriptions for a queue.
 */
export interface IQueueSubscriptions {
    /**
     * An array of topics with their corresponding filters.
     * Each topic has a name and an array of filters.
     */
    topics: Array<{
        name: string;
        filters: string[];
    }> | string[];
}
/**
 * @class
 * @constructor
 * @param {Construct} scope - The scope in which the construct is defined.
 * @param {string} id - The logical ID of the construct.
 * @param {QueueLambdaFunctionProps} queueLambdaProps - The properties for the QueueLambda construct.
 * @returns {Queue} - The created Queue instance.
 *
 * @example
 * ```ts
 * // Create a new QueueLambda instance
 * const queueLambda = new QueueLambda(scope, 'MyQueueLambda', {
 *   queueName: 'MyQueue',
 *   visibilityTimeoutSeconds: 60,
 *   receiveMessageWaitTimeSeconds: 10,
 *   retentionPeriodDays: 7,
 *   queueProps: {
 *     fifo: false,
 *     encryption: QueueEncryption.KMS,
 *   },
 *   lambdaFunctionProps: {
 *     runtime: Runtime.NODEJS_22_X,
 *     entry: '/path/to/lambda_function',
 *   },
 *   sqsEventSourceProps: {
 *     batchSize: 10,
 *     maxBatchingWindow: Duration.minutes(1),
 *     reportBatchItemFailures: false,
 *   },
 *   subscriptions: {
 *     topics: ['MyTopic'],
 *   },
 * });
 * ```
 */
export declare class QueueLambda extends Construct {
    readonly logger?: ILogger;
    constructor(scope: Construct, id: string, queueLambdaProps: QueueLambdaFunctionProps);
}
export {};
