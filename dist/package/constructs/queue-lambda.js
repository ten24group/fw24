"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueLambda = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const lambda_function_1 = require("./lambda-function");
const aws_lambda_event_sources_1 = require("aws-cdk-lib/aws-lambda-event-sources");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const aws_sns_subscriptions_1 = require("aws-cdk-lib/aws-sns-subscriptions");
const fw24_1 = require("../core/fw24");
const logging_1 = require("../logging");
const core_1 = require("../core");
/**
 * Default properties for the QueueLambdaFunction.
 */
const QueueLambdaFunctionPropDefaults = {
    queueName: "",
    queueProps: {
        visibilityTimeout: aws_cdk_lib_1.Duration.seconds(30),
        receiveMessageWaitTime: aws_cdk_lib_1.Duration.seconds(20),
    },
};
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
class QueueLambda extends constructs_1.Construct {
    logger;
    /**
     * Default SQS event source configuration values
     */
    static DEFAULTS = {
        BATCH_SIZE: 10,
        MAX_BATCHING_WINDOW_SECONDS: 5,
        REPORT_BATCH_ITEM_FAILURES: true,
    };
    /**
     * Normalizes SQS event source props with defaults and type conversions.
     * Handles conversion of maxBatchingWindowSeconds to Duration.
     * FIFO queues return empty object (they don't support event source props).
     *
     * @param props - Event source props (can have maxBatchingWindowSeconds)
     * @param isFifoQueue - Whether the queue is FIFO
     * @returns Normalized SqsEventSourceProps for CDK
     */
    static normalizeSqsEventSourceProps(props, isFifoQueue) {
        // FIFO queues don't support event source configuration
        if (isFifoQueue) {
            return {};
        }
        return {
            batchSize: props?.batchSize ?? QueueLambda.DEFAULTS.BATCH_SIZE,
            maxBatchingWindow: props?.maxBatchingWindow ??
                (props?.maxBatchingWindowSeconds
                    ? aws_cdk_lib_1.Duration.seconds(props.maxBatchingWindowSeconds)
                    : aws_cdk_lib_1.Duration.seconds(QueueLambda.DEFAULTS.MAX_BATCHING_WINDOW_SECONDS)),
            reportBatchItemFailures: props?.reportBatchItemFailures ?? QueueLambda.DEFAULTS.REPORT_BATCH_ITEM_FAILURES,
        };
    }
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
    static createQueue(scope, id, props, subscriptions) {
        const fw24 = fw24_1.Fw24.getInstance();
        const mergedProps = { ...QueueLambdaFunctionPropDefaults, ...props };
        let dlqProps = {};
        // Check if DLQ already exists
        const existingDLQ = fw24.getEnvironmentVariable(mergedProps.queueName, 'dlq') ||
            fw24.getEnvironmentVariable(mergedProps.queueName + '_dlq', 'queue');
        if (existingDLQ) {
            // Use existing DLQ
            dlqProps = {
                deadLetterQueue: {
                    maxReceiveCount: mergedProps.maxReceiveCount ?? 3,
                    queue: existingDLQ,
                }
            };
        }
        else if (!mergedProps.queueName.endsWith("dlq")) {
            // Queue itself is not a DLQ, so create or use default DLQ
            const isFifoQueue = core_1.Helper.isFifoQueueProps(mergedProps.queueProps ?? {}) || mergedProps.queueName.endsWith('.fifo');
            let defaultDLQ = isFifoQueue
                ? fw24.getEnvironmentVariable('dlq_default_fifo')
                : fw24.getEnvironmentVariable('dlq_default');
            if (!defaultDLQ) {
                const dlqName = isFifoQueue ? 'default-dlq-fifo' : 'default-dlq';
                const envKey = isFifoQueue ? 'dlq_default_fifo' : 'dlq_default';
                // Create ONE shared default DLQ (original intent from commit aef55ce)
                // Use the QueueLambda instance (scope) as parent so each QueueLambda has its DLQ as child
                // This prevents collisions while still allowing reuse within the same QueueLambda instance
                defaultDLQ = new aws_sqs_1.Queue(scope, dlqName, {
                    fifo: isFifoQueue
                });
                // Store for reuse by other queues created in the same construct/scope
                fw24.setEnvironmentVariable(envKey, defaultDLQ);
            }
            // Assign default DLQ
            dlqProps = {
                deadLetterQueue: {
                    maxReceiveCount: mergedProps.maxReceiveCount ?? 3,
                    queue: defaultDLQ,
                }
            };
        }
        // set the timeouts
        const timeoutProps = {};
        if (mergedProps.visibilityTimeoutSeconds) {
            timeoutProps.visibilityTimeout = aws_cdk_lib_1.Duration.seconds(mergedProps.visibilityTimeoutSeconds);
        }
        if (mergedProps.receiveMessageWaitTimeSeconds) {
            timeoutProps.receiveMessageWaitTime = aws_cdk_lib_1.Duration.seconds(mergedProps.receiveMessageWaitTimeSeconds);
        }
        if (mergedProps.retentionPeriodDays) {
            timeoutProps.retentionPeriod = aws_cdk_lib_1.Duration.days(mergedProps.retentionPeriodDays);
        }
        // set the default dlq with option to override
        const finalQueueProps = {
            ...dlqProps,
            ...mergedProps.queueProps,
            ...timeoutProps,
        };
        const queue = new aws_sqs_1.Queue(scope, id, finalQueueProps);
        // Subscribe to SNS topics if configured
        if (subscriptions?.topics) {
            subscriptions.topics.forEach((topic) => {
                const topicName = typeof topic === 'string' ? topic : topic.name;
                const topicArn = fw24.getArn('sns', fw24.getEnvironmentVariable(topicName, 'topicName'));
                const topicInstance = aws_sns_1.Topic.fromTopicArn(scope, `${mergedProps.queueName}-${topicName}-topic`, topicArn);
                topicInstance.addSubscription(new aws_sns_subscriptions_1.SqsSubscription(queue));
            });
        }
        return queue;
    }
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
    static attachQueueToLambda(lambda, queue, queueProps, queueName, sqsEventSourceProps) {
        const isQueueFifo = core_1.Helper.isFifoQueueProps({
            ...(queueProps || {}),
            queueName: queueName
        });
        const eventSourceProps = QueueLambda.normalizeSqsEventSourceProps(sqsEventSourceProps, isQueueFifo);
        lambda.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(queue, eventSourceProps));
    }
    constructor(scope, id, queueLambdaProps) {
        super(scope, id);
        this.logger = (0, logging_1.createLogger)(`${QueueLambda.name}-${id}`);
        const props = { ...QueueLambdaFunctionPropDefaults, ...queueLambdaProps };
        // Create queue with subscriptions using static helper (ensures consistency)
        const queue = QueueLambda.createQueue(this, id, {
            queueName: props.queueName,
            queueProps: props.queueProps,
            visibilityTimeoutSeconds: props.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: props.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: props.retentionPeriodDays,
            maxReceiveCount: props.maxReceiveCount,
        }, props.subscriptions);
        // Attach lambda if configured
        if (props.lambdaFunctionProps) {
            const queueFunction = new lambda_function_1.LambdaFunction(scope, `${id}-lambda`, { ...props.lambdaFunctionProps });
            QueueLambda.attachQueueToLambda(queueFunction, queue, props.queueProps, props.queueName, props.sqsEventSourceProps);
            // Store subscription for simulator
            const fw24 = fw24_1.Fw24.getInstance();
            const simulatedQueues = fw24.getEnvironmentVariable('SIMULATED_QUEUES') || [];
            simulatedQueues.push({
                queueName: props.queueName,
                handlerId: `${id}-lambda`,
                subscriptions: props.subscriptions
            });
            fw24.setEnvironmentVariable('SIMULATED_QUEUES', simulatedQueues);
        }
        return queue;
    }
}
exports.QueueLambda = QueueLambda;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUtbGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvcXVldWUtbGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUF1QztBQUN2Qyw2Q0FBdUM7QUFFdkMsaURBQTRDO0FBRTVDLHVEQUF3RTtBQUN4RSxtRkFBMkY7QUFDM0YsaURBQTRDO0FBQzVDLDZFQUFvRTtBQUNwRSx1Q0FBb0M7QUFDcEMsd0NBQW1EO0FBQ25ELGtDQUFpQztBQXdGakM7O0dBRUc7QUFDSCxNQUFNLCtCQUErQixHQUE2QjtJQUNoRSxTQUFTLEVBQUUsRUFBRTtJQUNiLFVBQVUsRUFBRTtRQUNWLGlCQUFpQixFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUN2QyxzQkFBc0IsRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7S0FDN0M7Q0FDRixDQUFBO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQ0c7QUFDSCxNQUFhLFdBQVksU0FBUSxzQkFBUztJQUMvQixNQUFNLENBQVc7SUFFMUI7O09BRUc7SUFDSyxNQUFNLENBQVUsUUFBUSxHQUFHO1FBQ2pDLFVBQVUsRUFBRSxFQUFFO1FBQ2QsMkJBQTJCLEVBQUUsQ0FBQztRQUM5QiwwQkFBMEIsRUFBRSxJQUFJO0tBQ3hCLENBQUM7SUFFWDs7Ozs7Ozs7T0FRRztJQUNILE1BQU0sQ0FBQyw0QkFBNEIsQ0FDakMsS0FBd0QsRUFDeEQsV0FBb0I7UUFFcEIsdURBQXVEO1FBQ3ZELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsT0FBTyxFQUFFLENBQUM7UUFDWixDQUFDO1FBRUQsT0FBTztZQUNMLFNBQVMsRUFBRSxLQUFLLEVBQUUsU0FBUyxJQUFJLFdBQVcsQ0FBQyxRQUFRLENBQUMsVUFBVTtZQUM5RCxpQkFBaUIsRUFBRSxLQUFLLEVBQUUsaUJBQWlCO2dCQUN6QyxDQUFDLEtBQUssRUFBRSx3QkFBd0I7b0JBQzlCLENBQUMsQ0FBQyxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUM7b0JBQ2xELENBQUMsQ0FBQyxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDekUsdUJBQXVCLEVBQUUsS0FBSyxFQUFFLHVCQUF1QixJQUFJLFdBQVcsQ0FBQyxRQUFRLENBQUMsMEJBQTBCO1NBQzNHLENBQUM7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Bb0JHO0lBQ0gsTUFBTSxDQUFDLFdBQVcsQ0FDaEIsS0FBZ0IsRUFDaEIsRUFBVSxFQUNWLEtBQTRLLEVBQzVLLGFBQW1DO1FBRW5DLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxNQUFNLFdBQVcsR0FBRyxFQUFFLEdBQUcsK0JBQStCLEVBQUUsR0FBRyxLQUFLLEVBQUUsQ0FBQztRQUlyRSxJQUFJLFFBQVEsR0FBYSxFQUFFLENBQUM7UUFFNUIsOEJBQThCO1FBQzlCLE1BQU0sV0FBVyxHQUNmLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQztZQUN6RCxJQUFJLENBQUMsc0JBQXNCLENBQUMsV0FBVyxDQUFDLFNBQVMsR0FBRyxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFFdkUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixtQkFBbUI7WUFDbkIsUUFBUSxHQUFHO2dCQUNULGVBQWUsRUFBRTtvQkFDZixlQUFlLEVBQUUsV0FBVyxDQUFDLGVBQWUsSUFBSSxDQUFDO29CQUNqRCxLQUFLLEVBQUUsV0FBVztpQkFDbkI7YUFDRixDQUFDO1FBQ0osQ0FBQzthQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2xELDBEQUEwRDtZQUMxRCxNQUFNLFdBQVcsR0FBRyxhQUFNLENBQUMsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUMsSUFBSSxXQUFXLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNySCxJQUFJLFVBQVUsR0FBc0IsV0FBVztnQkFDN0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxrQkFBa0IsQ0FBQztnQkFDakQsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUUvQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQ2hCLE1BQU0sT0FBTyxHQUFXLFdBQVcsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDekUsTUFBTSxNQUFNLEdBQVcsV0FBVyxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUV4RSxzRUFBc0U7Z0JBQ3RFLDBGQUEwRjtnQkFDMUYsMkZBQTJGO2dCQUMzRixVQUFVLEdBQUcsSUFBSSxlQUFLLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRTtvQkFDckMsSUFBSSxFQUFFLFdBQVc7aUJBQ2xCLENBQUMsQ0FBQztnQkFFSCxzRUFBc0U7Z0JBQ3RFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFDbEQsQ0FBQztZQUVELHFCQUFxQjtZQUNyQixRQUFRLEdBQUc7Z0JBQ1QsZUFBZSxFQUFFO29CQUNmLGVBQWUsRUFBRSxXQUFXLENBQUMsZUFBZSxJQUFJLENBQUM7b0JBQ2pELEtBQUssRUFBRSxVQUFVO2lCQUNsQjthQUNGLENBQUM7UUFDSixDQUFDO1FBRUQsbUJBQW1CO1FBQ25CLE1BQU0sWUFBWSxHQUE2QixFQUFFLENBQUM7UUFDbEQsSUFBSSxXQUFXLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztZQUN6QyxZQUFZLENBQUMsaUJBQWlCLEdBQUcsc0JBQVEsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLHdCQUF3QixDQUFDLENBQUM7UUFDMUYsQ0FBQztRQUNELElBQUksV0FBVyxDQUFDLDZCQUE2QixFQUFFLENBQUM7WUFDOUMsWUFBWSxDQUFDLHNCQUFzQixHQUFHLHNCQUFRLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO1FBQ3BHLENBQUM7UUFDRCxJQUFJLFdBQVcsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQ3BDLFlBQVksQ0FBQyxlQUFlLEdBQUcsc0JBQVEsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFDaEYsQ0FBQztRQUVELDhDQUE4QztRQUM5QyxNQUFNLGVBQWUsR0FBRztZQUN0QixHQUFHLFFBQVE7WUFDWCxHQUFHLFdBQVcsQ0FBQyxVQUFVO1lBQ3pCLEdBQUcsWUFBWTtTQUNoQixDQUFDO1FBRUYsTUFBTSxLQUFLLEdBQUcsSUFBSSxlQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxlQUFlLENBQUMsQ0FBQztRQUVwRCx3Q0FBd0M7UUFDeEMsSUFBSSxhQUFhLEVBQUUsTUFBTSxFQUFFLENBQUM7WUFDMUIsYUFBYSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDckMsTUFBTSxTQUFTLEdBQUcsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7Z0JBQ2pFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLENBQUMsQ0FBQztnQkFDekYsTUFBTSxhQUFhLEdBQUcsZUFBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsR0FBRyxXQUFXLENBQUMsU0FBUyxJQUFJLFNBQVMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUN6RyxhQUFhLENBQUMsZUFBZSxDQUFDLElBQUksdUNBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQzVELENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BbUJHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUN4QixNQUFzQixFQUN0QixLQUFZLEVBQ1osVUFBa0MsRUFDbEMsU0FBaUIsRUFDakIsbUJBQXVFO1FBRXZFLE1BQU0sV0FBVyxHQUFHLGFBQU0sQ0FBQyxnQkFBZ0IsQ0FBQztZQUMxQyxHQUFHLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQztZQUNyQixTQUFTLEVBQUUsU0FBUztTQUNyQixDQUFDLENBQUM7UUFFSCxNQUFNLGdCQUFnQixHQUFHLFdBQVcsQ0FBQyw0QkFBNEIsQ0FBQyxtQkFBbUIsRUFBRSxXQUFXLENBQUMsQ0FBQztRQUNwRyxNQUFNLENBQUMsY0FBYyxDQUFDLElBQUkseUNBQWMsQ0FBQyxLQUFLLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFFRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLGdCQUEwQztRQUNsRixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBQ2pCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLEdBQUcsV0FBVyxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRXhELE1BQU0sS0FBSyxHQUFHLEVBQUUsR0FBRywrQkFBK0IsRUFBRSxHQUFHLGdCQUFnQixFQUFFLENBQUM7UUFFMUUsNEVBQTRFO1FBQzVFLE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBRTtZQUM5QyxTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7WUFDMUIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1lBQzVCLHdCQUF3QixFQUFFLEtBQUssQ0FBQyx3QkFBd0I7WUFDeEQsNkJBQTZCLEVBQUUsS0FBSyxDQUFDLDZCQUE2QjtZQUNsRSxtQkFBbUIsRUFBRSxLQUFLLENBQUMsbUJBQW1CO1lBQzlDLGVBQWUsRUFBRSxLQUFLLENBQUMsZUFBZTtTQUN2QyxFQUFFLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUV4Qiw4QkFBOEI7UUFDOUIsSUFBSSxLQUFLLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztZQUM5QixNQUFNLGFBQWEsR0FBRyxJQUFJLGdDQUFjLENBQUMsS0FBSyxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUUsRUFBRSxHQUFHLEtBQUssQ0FBQyxtQkFBbUIsRUFBRSxDQUFtQixDQUFDO1lBQ3BILFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsbUJBQW1CLENBQUMsQ0FBQztZQUVwSCxtQ0FBbUM7WUFDbkMsTUFBTSxJQUFJLEdBQUcsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2hDLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUM5RSxlQUFlLENBQUMsSUFBSSxDQUFDO2dCQUNuQixTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7Z0JBQzFCLFNBQVMsRUFBRSxHQUFHLEVBQUUsU0FBUztnQkFDekIsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO2FBQ25DLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxrQkFBa0IsRUFBRSxlQUFlLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDOztBQTdOSCxrQ0ErTkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgRHVyYXRpb24gfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uLCBMYW1iZGFGdW5jdGlvblByb3BzIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBTcXNFdmVudFNvdXJjZSwgU3FzRXZlbnRTb3VyY2VQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXNcIjtcbmltcG9ydCB7IFRvcGljIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IFNxc1N1YnNjcmlwdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zLXN1YnNjcmlwdGlvbnNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBJTG9nZ2VyLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmVcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBwcm9wZXJ0aWVzIGZvciBhIFF1ZXVlTGFtYmRhRnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUXVldWVMYW1iZGFGdW5jdGlvblByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoZSBxdWV1ZS5cbiAgICovXG4gIHF1ZXVlTmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIHF1ZXVlLlxuICAgKi9cbiAgcXVldWVQcm9wcz86IFF1ZXVlUHJvcHM7XG5cbiAgLyoqXG4gICAqIFRoZSB2aXNpYmlsaXR5IHRpbWVvdXQgZm9yIHRoZSBxdWV1ZSBpbiBzZWNvbmRzLlxuICAgKi9cbiAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgd2FpdCB0aW1lIGZvciByZWNlaXZpbmcgbWVzc2FnZXMgZnJvbSB0aGUgcXVldWUgaW4gc2Vjb25kcy5cbiAgICovXG4gIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgcmV0ZW50aW9uIHBlcmlvZCBmb3IgdGhlIHF1ZXVlIGluIGRheXMuXG4gICAqL1xuICByZXRlbnRpb25QZXJpb2REYXlzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIHRpbWVzIGEgbWVzc2FnZSBjYW4gYmUgdW5zdWNjZXNzZnVsbHkgZGVxdWV1ZWQgYmVmb3JlIGJlaW5nIG1vdmVkIHRvIHRoZSBkZWFkLWxldHRlciBxdWV1ZS5cbiAgICovXG4gIG1heFJlY2VpdmVDb3VudD86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBTUVMgZXZlbnQgc291cmNlLlxuICAgKiBTdXBwb3J0cyBib3RoIER1cmF0aW9uIChtYXhCYXRjaGluZ1dpbmRvdykgYW5kIG51bWJlciAobWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzKS5cbiAgICovXG4gIHNxc0V2ZW50U291cmNlUHJvcHM/OiB7XG4gICAgLyoqXG4gICAgICogVGhlIG51bWJlciBvZiBtZXNzYWdlcyB0byByZXRyaWV2ZSBmcm9tIHRoZSBxdWV1ZSBpbiBhIHNpbmdsZSBiYXRjaC5cbiAgICAgKi9cbiAgICBiYXRjaFNpemU/OiBudW1iZXI7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgbWF4aW11bSBhbW91bnQgb2YgdGltZSB0byB3YWl0IGJlZm9yZSB0cmlnZ2VyaW5nIGEgYmF0Y2ggb2YgbWVzc2FnZXMgKENESyBEdXJhdGlvbiBvYmplY3QpLlxuICAgICAqL1xuICAgIG1heEJhdGNoaW5nV2luZG93PzogRHVyYXRpb247XG5cbiAgICAvKipcbiAgICAgKiBUaGUgbWF4aW11bSBhbW91bnQgb2YgdGltZSB0byB3YWl0IGJlZm9yZSB0cmlnZ2VyaW5nIGEgYmF0Y2ggb2YgbWVzc2FnZXMgKGluIHNlY29uZHMpLlxuICAgICAqIFRoaXMgaXMgYSBjb252ZW5pZW5jZSBwcm9wZXJ0eSB0aGF0IHdpbGwgYmUgY29udmVydGVkIHRvIER1cmF0aW9uIGludGVybmFsbHkuXG4gICAgICovXG4gICAgbWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzPzogbnVtYmVyO1xuXG4gICAgLyoqXG4gICAgICogV2hldGhlciB0byByZXBvcnQgZmFpbHVyZXMgZm9yIGluZGl2aWR1YWwgYmF0Y2ggaXRlbXMuXG4gICAgICovXG4gICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM/OiBib29sZWFuO1xuICB9O1xuXG4gIC8qKlxuICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIGxhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGxhbWJkYUZ1bmN0aW9uUHJvcHM/OiBMYW1iZGFGdW5jdGlvblByb3BzO1xuXG4gIC8qKlxuICAgKiBUaGUgc3Vic2NyaXB0aW9ucyBmb3IgdGhlIHF1ZXVlLlxuICAgKi9cbiAgc3Vic2NyaXB0aW9ucz86IElRdWV1ZVN1YnNjcmlwdGlvbnM7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgc3Vic2NyaXB0aW9ucyBmb3IgYSBxdWV1ZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUXVldWVTdWJzY3JpcHRpb25zIHtcbiAgLyoqXG4gICAqIEFuIGFycmF5IG9mIHRvcGljcyB3aXRoIHRoZWlyIGNvcnJlc3BvbmRpbmcgZmlsdGVycy5cbiAgICogRWFjaCB0b3BpYyBoYXMgYSBuYW1lIGFuZCBhbiBhcnJheSBvZiBmaWx0ZXJzLlxuICAgKi9cbiAgdG9waWNzOiBBcnJheTx7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGZpbHRlcnM6IHN0cmluZ1tdO1xuICB9PiB8IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIERlZmF1bHQgcHJvcGVydGllcyBmb3IgdGhlIFF1ZXVlTGFtYmRhRnVuY3Rpb24uXG4gKi9cbmNvbnN0IFF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wRGVmYXVsdHM6IFF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wcyA9IHtcbiAgcXVldWVOYW1lOiBcIlwiLFxuICBxdWV1ZVByb3BzOiB7XG4gICAgdmlzaWJpbGl0eVRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWU6IER1cmF0aW9uLnNlY29uZHMoMjApLFxuICB9LFxufVxuXG4vKipcbiAqIEBjbGFzc1xuICogQGNvbnN0cnVjdG9yXG4gKiBAcGFyYW0ge0NvbnN0cnVjdH0gc2NvcGUgLSBUaGUgc2NvcGUgaW4gd2hpY2ggdGhlIGNvbnN0cnVjdCBpcyBkZWZpbmVkLlxuICogQHBhcmFtIHtzdHJpbmd9IGlkIC0gVGhlIGxvZ2ljYWwgSUQgb2YgdGhlIGNvbnN0cnVjdC5cbiAqIEBwYXJhbSB7UXVldWVMYW1iZGFGdW5jdGlvblByb3BzfSBxdWV1ZUxhbWJkYVByb3BzIC0gVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBRdWV1ZUxhbWJkYSBjb25zdHJ1Y3QuXG4gKiBAcmV0dXJucyB7UXVldWV9IC0gVGhlIGNyZWF0ZWQgUXVldWUgaW5zdGFuY2UuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQ3JlYXRlIGEgbmV3IFF1ZXVlTGFtYmRhIGluc3RhbmNlXG4gKiBjb25zdCBxdWV1ZUxhbWJkYSA9IG5ldyBRdWV1ZUxhbWJkYShzY29wZSwgJ015UXVldWVMYW1iZGEnLCB7XG4gKiAgIHF1ZXVlTmFtZTogJ015UXVldWUnLFxuICogICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IDYwLFxuICogICByZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kczogMTAsXG4gKiAgIHJldGVudGlvblBlcmlvZERheXM6IDcsXG4gKiAgIHF1ZXVlUHJvcHM6IHtcbiAqICAgICBmaWZvOiBmYWxzZSxcbiAqICAgICBlbmNyeXB0aW9uOiBRdWV1ZUVuY3J5cHRpb24uS01TLFxuICogICB9LFxuICogICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gKiAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAqICAgICBlbnRyeTogJy9wYXRoL3RvL2xhbWJkYV9mdW5jdGlvbicsXG4gKiAgIH0sXG4gKiAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHtcbiAqICAgICBiYXRjaFNpemU6IDEwLFxuICogICAgIG1heEJhdGNoaW5nV2luZG93OiBEdXJhdGlvbi5taW51dGVzKDEpLFxuICogICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiBmYWxzZSxcbiAqICAgfSxcbiAqICAgc3Vic2NyaXB0aW9uczoge1xuICogICAgIHRvcGljczogWydNeVRvcGljJ10sXG4gKiAgIH0sXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgUXVldWVMYW1iZGEgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICByZWFkb25seSBsb2dnZXI/OiBJTG9nZ2VyO1xuXG4gIC8qKlxuICAgKiBEZWZhdWx0IFNRUyBldmVudCBzb3VyY2UgY29uZmlndXJhdGlvbiB2YWx1ZXNcbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IERFRkFVTFRTID0ge1xuICAgIEJBVENIX1NJWkU6IDEwLFxuICAgIE1BWF9CQVRDSElOR19XSU5ET1dfU0VDT05EUzogNSxcbiAgICBSRVBPUlRfQkFUQ0hfSVRFTV9GQUlMVVJFUzogdHJ1ZSxcbiAgfSBhcyBjb25zdDtcblxuICAvKipcbiAgICogTm9ybWFsaXplcyBTUVMgZXZlbnQgc291cmNlIHByb3BzIHdpdGggZGVmYXVsdHMgYW5kIHR5cGUgY29udmVyc2lvbnMuXG4gICAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBtYXhCYXRjaGluZ1dpbmRvd1NlY29uZHMgdG8gRHVyYXRpb24uXG4gICAqIEZJRk8gcXVldWVzIHJldHVybiBlbXB0eSBvYmplY3QgKHRoZXkgZG9uJ3Qgc3VwcG9ydCBldmVudCBzb3VyY2UgcHJvcHMpLlxuICAgKiBcbiAgICogQHBhcmFtIHByb3BzIC0gRXZlbnQgc291cmNlIHByb3BzIChjYW4gaGF2ZSBtYXhCYXRjaGluZ1dpbmRvd1NlY29uZHMpXG4gICAqIEBwYXJhbSBpc0ZpZm9RdWV1ZSAtIFdoZXRoZXIgdGhlIHF1ZXVlIGlzIEZJRk9cbiAgICogQHJldHVybnMgTm9ybWFsaXplZCBTcXNFdmVudFNvdXJjZVByb3BzIGZvciBDREtcbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVTcXNFdmVudFNvdXJjZVByb3BzKFxuICAgIHByb3BzOiBRdWV1ZUxhbWJkYUZ1bmN0aW9uUHJvcHNbICdzcXNFdmVudFNvdXJjZVByb3BzJyBdLFxuICAgIGlzRmlmb1F1ZXVlOiBib29sZWFuXG4gICk6IFNxc0V2ZW50U291cmNlUHJvcHMge1xuICAgIC8vIEZJRk8gcXVldWVzIGRvbid0IHN1cHBvcnQgZXZlbnQgc291cmNlIGNvbmZpZ3VyYXRpb25cbiAgICBpZiAoaXNGaWZvUXVldWUpIHtcbiAgICAgIHJldHVybiB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYmF0Y2hTaXplOiBwcm9wcz8uYmF0Y2hTaXplID8/IFF1ZXVlTGFtYmRhLkRFRkFVTFRTLkJBVENIX1NJWkUsXG4gICAgICBtYXhCYXRjaGluZ1dpbmRvdzogcHJvcHM/Lm1heEJhdGNoaW5nV2luZG93ID8/XG4gICAgICAgIChwcm9wcz8ubWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzXG4gICAgICAgICAgPyBEdXJhdGlvbi5zZWNvbmRzKHByb3BzLm1heEJhdGNoaW5nV2luZG93U2Vjb25kcylcbiAgICAgICAgICA6IER1cmF0aW9uLnNlY29uZHMoUXVldWVMYW1iZGEuREVGQVVMVFMuTUFYX0JBVENISU5HX1dJTkRPV19TRUNPTkRTKSksXG4gICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogcHJvcHM/LnJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzID8/IFF1ZXVlTGFtYmRhLkRFRkFVTFRTLlJFUE9SVF9CQVRDSF9JVEVNX0ZBSUxVUkVTLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhbiBTUVMgUXVldWUgd2l0aCBwcm9wZXIgRExRIHNldHVwLCB0aW1lb3V0IGNvbmZpZ3VyYXRpb24sIGFuZCBTTlMgc3Vic2NyaXB0aW9ucy5cbiAgICogVGhpcyBpcyBhIHN0YXRpYyBoZWxwZXIgZm9yIGNyZWF0aW5nIHF1ZXVlcyBpbmRlcGVuZGVudGx5ICh1c2VmdWwgZm9yIHR3by1waGFzZSBjb25zdHJ1Y3Rpb24pLlxuICAgKiBcbiAgICogQHBhcmFtIHNjb3BlIC0gQ0RLIGNvbnN0cnVjdCBzY29wZVxuICAgKiBAcGFyYW0gaWQgLSBDb25zdHJ1Y3QgSURcbiAgICogQHBhcmFtIHByb3BzIC0gUXVldWUgY29uZmlndXJhdGlvbiBwcm9wc1xuICAgKiBAcGFyYW0gc3Vic2NyaXB0aW9ucyAtIE9wdGlvbmFsIFNOUyB0b3BpYyBzdWJzY3JpcHRpb25zXG4gICAqIEByZXR1cm5zIENESyBRdWV1ZSBpbnN0YW5jZVxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiAvLyBDcmVhdGUgcXVldWUgd2l0aCBzdWJzY3JpcHRpb25zIGluIG9uZSBjYWxsXG4gICAqIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICdteS1xdWV1ZScsIHtcbiAgICogICBxdWV1ZU5hbWU6ICdteVF1ZXVlJyxcbiAgICogICBxdWV1ZVByb3BzOiB7IGZpZm86IHRydWUgfVxuICAgKiB9LCB7XG4gICAqICAgdG9waWNzOiBbJ215VG9waWMnXVxuICAgKiB9KTtcbiAgICogYGBgXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlUXVldWUoXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICBpZDogc3RyaW5nLFxuICAgIHByb3BzOiBQaWNrPFF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wcywgJ3F1ZXVlTmFtZScgfCAncXVldWVQcm9wcycgfCAndmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzJyB8ICdyZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcycgfCAncmV0ZW50aW9uUGVyaW9kRGF5cycgfCAnbWF4UmVjZWl2ZUNvdW50Jz4sXG4gICAgc3Vic2NyaXB0aW9ucz86IElRdWV1ZVN1YnNjcmlwdGlvbnNcbiAgKTogUXVldWUge1xuICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgY29uc3QgbWVyZ2VkUHJvcHMgPSB7IC4uLlF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wRGVmYXVsdHMsIC4uLnByb3BzIH07XG5cbiAgICAvLyBTZXR1cCBkZWFkIGxldHRlciBxdWV1ZSAoRExRKSBjb25maWd1cmF0aW9uXG4gICAgdHlwZSBETFFQcm9wcyA9IFBpY2s8UXVldWVQcm9wcywgJ2RlYWRMZXR0ZXJRdWV1ZSc+O1xuICAgIGxldCBkbHFQcm9wczogRExRUHJvcHMgPSB7fTtcblxuICAgIC8vIENoZWNrIGlmIERMUSBhbHJlYWR5IGV4aXN0c1xuICAgIGNvbnN0IGV4aXN0aW5nRExROiBRdWV1ZSB8IHVuZGVmaW5lZCA9XG4gICAgICBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUobWVyZ2VkUHJvcHMucXVldWVOYW1lLCAnZGxxJykgfHxcbiAgICAgIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShtZXJnZWRQcm9wcy5xdWV1ZU5hbWUgKyAnX2RscScsICdxdWV1ZScpO1xuXG4gICAgaWYgKGV4aXN0aW5nRExRKSB7XG4gICAgICAvLyBVc2UgZXhpc3RpbmcgRExRXG4gICAgICBkbHFQcm9wcyA9IHtcbiAgICAgICAgZGVhZExldHRlclF1ZXVlOiB7XG4gICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiBtZXJnZWRQcm9wcy5tYXhSZWNlaXZlQ291bnQgPz8gMyxcbiAgICAgICAgICBxdWV1ZTogZXhpc3RpbmdETFEsXG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICghbWVyZ2VkUHJvcHMucXVldWVOYW1lLmVuZHNXaXRoKFwiZGxxXCIpKSB7XG4gICAgICAvLyBRdWV1ZSBpdHNlbGYgaXMgbm90IGEgRExRLCBzbyBjcmVhdGUgb3IgdXNlIGRlZmF1bHQgRExRXG4gICAgICBjb25zdCBpc0ZpZm9RdWV1ZSA9IEhlbHBlci5pc0ZpZm9RdWV1ZVByb3BzKG1lcmdlZFByb3BzLnF1ZXVlUHJvcHMgPz8ge30pIHx8IG1lcmdlZFByb3BzLnF1ZXVlTmFtZS5lbmRzV2l0aCgnLmZpZm8nKTtcbiAgICAgIGxldCBkZWZhdWx0RExROiBRdWV1ZSB8IHVuZGVmaW5lZCA9IGlzRmlmb1F1ZXVlXG4gICAgICAgID8gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdkbHFfZGVmYXVsdF9maWZvJylcbiAgICAgICAgOiBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ2RscV9kZWZhdWx0Jyk7XG5cbiAgICAgIGlmICghZGVmYXVsdERMUSkge1xuICAgICAgICBjb25zdCBkbHFOYW1lOiBzdHJpbmcgPSBpc0ZpZm9RdWV1ZSA/ICdkZWZhdWx0LWRscS1maWZvJyA6ICdkZWZhdWx0LWRscSc7XG4gICAgICAgIGNvbnN0IGVudktleTogc3RyaW5nID0gaXNGaWZvUXVldWUgPyAnZGxxX2RlZmF1bHRfZmlmbycgOiAnZGxxX2RlZmF1bHQnO1xuXG4gICAgICAgIC8vIENyZWF0ZSBPTkUgc2hhcmVkIGRlZmF1bHQgRExRIChvcmlnaW5hbCBpbnRlbnQgZnJvbSBjb21taXQgYWVmNTVjZSlcbiAgICAgICAgLy8gVXNlIHRoZSBRdWV1ZUxhbWJkYSBpbnN0YW5jZSAoc2NvcGUpIGFzIHBhcmVudCBzbyBlYWNoIFF1ZXVlTGFtYmRhIGhhcyBpdHMgRExRIGFzIGNoaWxkXG4gICAgICAgIC8vIFRoaXMgcHJldmVudHMgY29sbGlzaW9ucyB3aGlsZSBzdGlsbCBhbGxvd2luZyByZXVzZSB3aXRoaW4gdGhlIHNhbWUgUXVldWVMYW1iZGEgaW5zdGFuY2VcbiAgICAgICAgZGVmYXVsdERMUSA9IG5ldyBRdWV1ZShzY29wZSwgZGxxTmFtZSwge1xuICAgICAgICAgIGZpZm86IGlzRmlmb1F1ZXVlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFN0b3JlIGZvciByZXVzZSBieSBvdGhlciBxdWV1ZXMgY3JlYXRlZCBpbiB0aGUgc2FtZSBjb25zdHJ1Y3Qvc2NvcGVcbiAgICAgICAgZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudktleSwgZGVmYXVsdERMUSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEFzc2lnbiBkZWZhdWx0IERMUVxuICAgICAgZGxxUHJvcHMgPSB7XG4gICAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xuICAgICAgICAgIG1heFJlY2VpdmVDb3VudDogbWVyZ2VkUHJvcHMubWF4UmVjZWl2ZUNvdW50ID8/IDMsXG4gICAgICAgICAgcXVldWU6IGRlZmF1bHRETFEsXG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gc2V0IHRoZSB0aW1lb3V0c1xuICAgIGNvbnN0IHRpbWVvdXRQcm9wczogUmVjb3JkPHN0cmluZywgRHVyYXRpb24+ID0ge307XG4gICAgaWYgKG1lcmdlZFByb3BzLnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcykge1xuICAgICAgdGltZW91dFByb3BzLnZpc2liaWxpdHlUaW1lb3V0ID0gRHVyYXRpb24uc2Vjb25kcyhtZXJnZWRQcm9wcy52aXNpYmlsaXR5VGltZW91dFNlY29uZHMpO1xuICAgIH1cbiAgICBpZiAobWVyZ2VkUHJvcHMucmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHMpIHtcbiAgICAgIHRpbWVvdXRQcm9wcy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lID0gRHVyYXRpb24uc2Vjb25kcyhtZXJnZWRQcm9wcy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyk7XG4gICAgfVxuICAgIGlmIChtZXJnZWRQcm9wcy5yZXRlbnRpb25QZXJpb2REYXlzKSB7XG4gICAgICB0aW1lb3V0UHJvcHMucmV0ZW50aW9uUGVyaW9kID0gRHVyYXRpb24uZGF5cyhtZXJnZWRQcm9wcy5yZXRlbnRpb25QZXJpb2REYXlzKTtcbiAgICB9XG5cbiAgICAvLyBzZXQgdGhlIGRlZmF1bHQgZGxxIHdpdGggb3B0aW9uIHRvIG92ZXJyaWRlXG4gICAgY29uc3QgZmluYWxRdWV1ZVByb3BzID0ge1xuICAgICAgLi4uZGxxUHJvcHMsXG4gICAgICAuLi5tZXJnZWRQcm9wcy5xdWV1ZVByb3BzLFxuICAgICAgLi4udGltZW91dFByb3BzLFxuICAgIH07XG5cbiAgICBjb25zdCBxdWV1ZSA9IG5ldyBRdWV1ZShzY29wZSwgaWQsIGZpbmFsUXVldWVQcm9wcyk7XG5cbiAgICAvLyBTdWJzY3JpYmUgdG8gU05TIHRvcGljcyBpZiBjb25maWd1cmVkXG4gICAgaWYgKHN1YnNjcmlwdGlvbnM/LnRvcGljcykge1xuICAgICAgc3Vic2NyaXB0aW9ucy50b3BpY3MuZm9yRWFjaCgodG9waWMpID0+IHtcbiAgICAgICAgY29uc3QgdG9waWNOYW1lID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IHRvcGljIDogdG9waWMubmFtZTtcbiAgICAgICAgY29uc3QgdG9waWNBcm4gPSBmdzI0LmdldEFybignc25zJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSwgJ3RvcGljTmFtZScpKTtcbiAgICAgICAgY29uc3QgdG9waWNJbnN0YW5jZSA9IFRvcGljLmZyb21Ub3BpY0FybihzY29wZSwgYCR7bWVyZ2VkUHJvcHMucXVldWVOYW1lfS0ke3RvcGljTmFtZX0tdG9waWNgLCB0b3BpY0Fybik7XG4gICAgICAgIHRvcGljSW5zdGFuY2UuYWRkU3Vic2NyaXB0aW9uKG5ldyBTcXNTdWJzY3JpcHRpb24ocXVldWUpKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBxdWV1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2hlcyBhbiBTUVMgUXVldWUgYXMgYW4gZXZlbnQgc291cmNlIHRvIGEgTGFtYmRhIGZ1bmN0aW9uIHdpdGggcHJvcGVyIGV2ZW50IHNvdXJjZSBjb25maWd1cmF0aW9uLlxuICAgKiBIYW5kbGVzIEZJRk8gcXVldWUgZGV0ZWN0aW9uLCBldmVudCBzb3VyY2UgcHJvcHMgbm9ybWFsaXphdGlvbiwgYW5kIGF0dGFjaG1lbnQuXG4gICAqIFxuICAgKiBAcGFyYW0gbGFtYmRhIC0gVGhlIExhbWJkYSBmdW5jdGlvbiB0byBhdHRhY2ggdGhlIHF1ZXVlIHRvXG4gICAqIEBwYXJhbSBxdWV1ZSAtIFRoZSBTUVMgUXVldWUgdG8gYXR0YWNoXG4gICAqIEBwYXJhbSBxdWV1ZVByb3BzIC0gUXVldWUgcHJvcGVydGllcyBmb3IgRklGTyBkZXRlY3Rpb25cbiAgICogQHBhcmFtIHF1ZXVlTmFtZSAtIE5hbWUgb2YgdGhlIHF1ZXVlXG4gICAqIEBwYXJhbSBzcXNFdmVudFNvdXJjZVByb3BzIC0gT3B0aW9uYWwgU1FTIGV2ZW50IHNvdXJjZSBjb25maWd1cmF0aW9uXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIGNvbnN0IGxhbWJkYSA9IG5ldyBMYW1iZGFGdW5jdGlvbiguLi4pO1xuICAgKiBjb25zdCBxdWV1ZSA9IFF1ZXVlTGFtYmRhLmNyZWF0ZVF1ZXVlKC4uLik7XG4gICAqIFF1ZXVlTGFtYmRhLmF0dGFjaFF1ZXVlVG9MYW1iZGEobGFtYmRhLCBxdWV1ZSwgcXVldWVQcm9wcywgJ215UXVldWUnLCB7XG4gICAqICAgYmF0Y2hTaXplOiAyMCxcbiAgICogICBtYXhCYXRjaGluZ1dpbmRvd1NlY29uZHM6IDEwXG4gICAqIH0pO1xuICAgKiBgYGBcbiAgICovXG4gIHN0YXRpYyBhdHRhY2hRdWV1ZVRvTGFtYmRhKFxuICAgIGxhbWJkYTogTm9kZWpzRnVuY3Rpb24sXG4gICAgcXVldWU6IFF1ZXVlLFxuICAgIHF1ZXVlUHJvcHM6IFF1ZXVlUHJvcHMgfCB1bmRlZmluZWQsXG4gICAgcXVldWVOYW1lOiBzdHJpbmcsXG4gICAgc3FzRXZlbnRTb3VyY2VQcm9wcz86IFF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wc1sgJ3Nxc0V2ZW50U291cmNlUHJvcHMnIF1cbiAgKTogdm9pZCB7XG4gICAgY29uc3QgaXNRdWV1ZUZpZm8gPSBIZWxwZXIuaXNGaWZvUXVldWVQcm9wcyh7XG4gICAgICAuLi4ocXVldWVQcm9wcyB8fCB7fSksXG4gICAgICBxdWV1ZU5hbWU6IHF1ZXVlTmFtZVxuICAgIH0pO1xuXG4gICAgY29uc3QgZXZlbnRTb3VyY2VQcm9wcyA9IFF1ZXVlTGFtYmRhLm5vcm1hbGl6ZVNxc0V2ZW50U291cmNlUHJvcHMoc3FzRXZlbnRTb3VyY2VQcm9wcywgaXNRdWV1ZUZpZm8pO1xuICAgIGxhbWJkYS5hZGRFdmVudFNvdXJjZShuZXcgU3FzRXZlbnRTb3VyY2UocXVldWUsIGV2ZW50U291cmNlUHJvcHMpKTtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHF1ZXVlTGFtYmRhUHJvcHM6IFF1ZXVlTGFtYmRhRnVuY3Rpb25Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoYCR7UXVldWVMYW1iZGEubmFtZX0tJHtpZH1gKTtcblxuICAgIGNvbnN0IHByb3BzID0geyAuLi5RdWV1ZUxhbWJkYUZ1bmN0aW9uUHJvcERlZmF1bHRzLCAuLi5xdWV1ZUxhbWJkYVByb3BzIH07XG5cbiAgICAvLyBDcmVhdGUgcXVldWUgd2l0aCBzdWJzY3JpcHRpb25zIHVzaW5nIHN0YXRpYyBoZWxwZXIgKGVuc3VyZXMgY29uc2lzdGVuY3kpXG4gICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZSh0aGlzLCBpZCwge1xuICAgICAgcXVldWVOYW1lOiBwcm9wcy5xdWV1ZU5hbWUsXG4gICAgICBxdWV1ZVByb3BzOiBwcm9wcy5xdWV1ZVByb3BzLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzOiBwcm9wcy52aXNpYmlsaXR5VGltZW91dFNlY29uZHMsXG4gICAgICByZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kczogcHJvcHMucmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHMsXG4gICAgICByZXRlbnRpb25QZXJpb2REYXlzOiBwcm9wcy5yZXRlbnRpb25QZXJpb2REYXlzLFxuICAgICAgbWF4UmVjZWl2ZUNvdW50OiBwcm9wcy5tYXhSZWNlaXZlQ291bnQsXG4gICAgfSwgcHJvcHMuc3Vic2NyaXB0aW9ucyk7XG5cbiAgICAvLyBBdHRhY2ggbGFtYmRhIGlmIGNvbmZpZ3VyZWRcbiAgICBpZiAocHJvcHMubGFtYmRhRnVuY3Rpb25Qcm9wcykge1xuICAgICAgY29uc3QgcXVldWVGdW5jdGlvbiA9IG5ldyBMYW1iZGFGdW5jdGlvbihzY29wZSwgYCR7aWR9LWxhbWJkYWAsIHsgLi4ucHJvcHMubGFtYmRhRnVuY3Rpb25Qcm9wcyB9KSBhcyBOb2RlanNGdW5jdGlvbjtcbiAgICAgIFF1ZXVlTGFtYmRhLmF0dGFjaFF1ZXVlVG9MYW1iZGEocXVldWVGdW5jdGlvbiwgcXVldWUsIHByb3BzLnF1ZXVlUHJvcHMsIHByb3BzLnF1ZXVlTmFtZSwgcHJvcHMuc3FzRXZlbnRTb3VyY2VQcm9wcyk7XG5cbiAgICAgIC8vIFN0b3JlIHN1YnNjcmlwdGlvbiBmb3Igc2ltdWxhdG9yXG4gICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgY29uc3Qgc2ltdWxhdGVkUXVldWVzID0gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdTSU1VTEFURURfUVVFVUVTJykgfHwgW107XG4gICAgICBzaW11bGF0ZWRRdWV1ZXMucHVzaCh7XG4gICAgICAgIHF1ZXVlTmFtZTogcHJvcHMucXVldWVOYW1lLFxuICAgICAgICBoYW5kbGVySWQ6IGAke2lkfS1sYW1iZGFgLFxuICAgICAgICBzdWJzY3JpcHRpb25zOiBwcm9wcy5zdWJzY3JpcHRpb25zXG4gICAgICB9KTtcbiAgICAgIGZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnU0lNVUxBVEVEX1FVRVVFUycsIHNpbXVsYXRlZFF1ZXVlcyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHF1ZXVlO1xuICB9XG5cbn1cbiJdfQ==