import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { LambdaFunctionProps } from "./lambda-function";
import { SqsEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { ILogger } from "../logging";
/**
 * Represents the properties for a QueueLambdaFunction.
 */
export interface QueueLambdaFunctionProps {
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
     * Supports both Duration (maxBatchingWindow) and number (maxBatchingWindowSeconds).
     */
    sqsEventSourceProps?: {
        /**
         * The number of messages to retrieve from the queue in a single batch.
         */
        batchSize?: number;
        /**
         * The maximum amount of time to wait before triggering a batch of messages (CDK Duration object).
         */
        maxBatchingWindow?: Duration;
        /**
         * The maximum amount of time to wait before triggering a batch of messages (in seconds).
         * This is a convenience property that will be converted to Duration internally.
         */
        maxBatchingWindowSeconds?: number;
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
    /**
     * Default SQS event source configuration values
     */
    private static readonly DEFAULTS;
    /**
     * Normalizes SQS event source props with defaults and type conversions.
     * Handles conversion of maxBatchingWindowSeconds to Duration.
     * FIFO queues return empty object (they don't support event source props).
     *
     * @param props - Event source props (can have maxBatchingWindowSeconds)
     * @param isFifoQueue - Whether the queue is FIFO
     * @returns Normalized SqsEventSourceProps for CDK
     */
    static normalizeSqsEventSourceProps(props: QueueLambdaFunctionProps['sqsEventSourceProps'], isFifoQueue: boolean): SqsEventSourceProps;
    /**
     * Creates an SQS Queue with proper DLQ setup, timeout configuration, and SNS subscriptions.
     * This is a static helper for creating queues independently (useful for two-phase construction).
     *
     * @param scope - CDK construct scope
     * @param id - Construct ID
     * @param props - Queue configuration props
     * @param subscriptions - Optional SNS topic subscriptions
     * @returns CDK Queue instance
     *
     * @example
     * ```typescript
     * // Create queue with subscriptions in one call
     * const queue = QueueLambda.createQueue(stack, 'my-queue', {
     *   queueName: 'myQueue',
     *   queueProps: { fifo: true }
     * }, {
     *   topics: ['myTopic']
     * });
     * ```
     */
    static createQueue(scope: Construct, id: string, props: Pick<QueueLambdaFunctionProps, 'queueName' | 'queueProps' | 'visibilityTimeoutSeconds' | 'receiveMessageWaitTimeSeconds' | 'retentionPeriodDays' | 'maxReceiveCount'>, subscriptions?: IQueueSubscriptions): Queue;
    /**
     * Attaches an SQS Queue as an event source to a Lambda function with proper event source configuration.
     * Handles FIFO queue detection, event source props normalization, and attachment.
     *
     * @param lambda - The Lambda function to attach the queue to
     * @param queue - The SQS Queue to attach
     * @param queueProps - Queue properties for FIFO detection
     * @param queueName - Name of the queue
     * @param sqsEventSourceProps - Optional SQS event source configuration
     *
     * @example
     * ```typescript
     * const lambda = new LambdaFunction(...);
     * const queue = QueueLambda.createQueue(...);
     * QueueLambda.attachQueueToLambda(lambda, queue, queueProps, 'myQueue', {
     *   batchSize: 20,
     *   maxBatchingWindowSeconds: 10
     * });
     * ```
     */
    static attachQueueToLambda(lambda: NodejsFunction, queue: Queue, queueProps: QueueProps | undefined, queueName: string, sqsEventSourceProps?: QueueLambdaFunctionProps['sqsEventSourceProps']): void;
    constructor(scope: Construct, id: string, queueLambdaProps: QueueLambdaFunctionProps);
}
