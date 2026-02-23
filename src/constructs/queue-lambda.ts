import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { SqsEventSource, SqsEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Fw24 } from "../core/fw24";
import { ILogger, createLogger } from "../logging";
import { Helper } from "../core";

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
 * Default properties for the QueueLambdaFunction.
 */
const QueueLambdaFunctionPropDefaults: QueueLambdaFunctionProps = {
  queueName: "",
  queueProps: {
    visibilityTimeout: Duration.seconds(30),
    receiveMessageWaitTime: Duration.seconds(20),
  },
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
export class QueueLambda extends Construct {
  readonly logger?: ILogger;

  /**
   * Default SQS event source configuration values
   */
  private static readonly DEFAULTS = {
    BATCH_SIZE: 10,
    MAX_BATCHING_WINDOW_SECONDS: 5,
    REPORT_BATCH_ITEM_FAILURES: true,
  } as const;

  /**
   * Normalizes SQS event source props with defaults and type conversions.
   * Handles conversion of maxBatchingWindowSeconds to Duration.
   * FIFO queues return empty object (they don't support event source props).
   * 
   * @param props - Event source props (can have maxBatchingWindowSeconds)
   * @param isFifoQueue - Whether the queue is FIFO
   * @returns Normalized SqsEventSourceProps for CDK
   */
  static normalizeSqsEventSourceProps(
    props: QueueLambdaFunctionProps[ 'sqsEventSourceProps' ],
    isFifoQueue: boolean
  ): SqsEventSourceProps {
    // FIFO queues don't support event source configuration
    if (isFifoQueue) {
      return {};
    }

    return {
      batchSize: props?.batchSize ?? QueueLambda.DEFAULTS.BATCH_SIZE,
      maxBatchingWindow: props?.maxBatchingWindow ??
        (props?.maxBatchingWindowSeconds
          ? Duration.seconds(props.maxBatchingWindowSeconds)
          : Duration.seconds(QueueLambda.DEFAULTS.MAX_BATCHING_WINDOW_SECONDS)),
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
  static createQueue(
    scope: Construct,
    id: string,
    props: Pick<QueueLambdaFunctionProps, 'queueName' | 'queueProps' | 'visibilityTimeoutSeconds' | 'receiveMessageWaitTimeSeconds' | 'retentionPeriodDays' | 'maxReceiveCount'>,
    subscriptions?: IQueueSubscriptions
  ): Queue {
    const fw24 = Fw24.getInstance();
    const mergedProps = { ...QueueLambdaFunctionPropDefaults, ...props };

    // Setup dead letter queue (DLQ) configuration
    type DLQProps = Pick<QueueProps, 'deadLetterQueue'>;
    let dlqProps: DLQProps = {};

    // Check if DLQ already exists
    const existingDLQ: Queue | undefined =
      fw24.getEnvironmentVariable(mergedProps.queueName, 'dlq') ||
      fw24.getEnvironmentVariable(mergedProps.queueName + '_dlq', 'queue');

    if (existingDLQ) {
      // Use existing DLQ
      dlqProps = {
        deadLetterQueue: {
          maxReceiveCount: mergedProps.maxReceiveCount ?? 3,
          queue: existingDLQ,
        }
      };
    } else if (!mergedProps.queueName.endsWith("dlq")) {
      // Queue itself is not a DLQ, so create or use default DLQ
      const isFifoQueue = Helper.isFifoQueueProps(mergedProps.queueProps ?? {}) || mergedProps.queueName.endsWith('.fifo');
      let defaultDLQ: Queue | undefined = isFifoQueue
        ? fw24.getEnvironmentVariable('dlq_default_fifo')
        : fw24.getEnvironmentVariable('dlq_default');

      if (!defaultDLQ) {
        const dlqName: string = isFifoQueue ? 'default-dlq-fifo' : 'default-dlq';
        const envKey: string = isFifoQueue ? 'dlq_default_fifo' : 'dlq_default';

        // Create ONE shared default DLQ (original intent from commit aef55ce)
        // Use the QueueLambda instance (scope) as parent so each QueueLambda has its DLQ as child
        // This prevents collisions while still allowing reuse within the same QueueLambda instance
        defaultDLQ = new Queue(scope, dlqName, {
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
    const timeoutProps: Record<string, Duration> = {};
    if (mergedProps.visibilityTimeoutSeconds) {
      timeoutProps.visibilityTimeout = Duration.seconds(mergedProps.visibilityTimeoutSeconds);
    }
    if (mergedProps.receiveMessageWaitTimeSeconds) {
      timeoutProps.receiveMessageWaitTime = Duration.seconds(mergedProps.receiveMessageWaitTimeSeconds);
    }
    if (mergedProps.retentionPeriodDays) {
      timeoutProps.retentionPeriod = Duration.days(mergedProps.retentionPeriodDays);
    }

    // set the default dlq with option to override
    const finalQueueProps = {
      ...dlqProps,
      ...mergedProps.queueProps,
      ...timeoutProps,
    };

    const queue = new Queue(scope, id, finalQueueProps);

    // Subscribe to SNS topics if configured
    if (subscriptions?.topics) {
      subscriptions.topics.forEach((topic) => {
        const topicName = typeof topic === 'string' ? topic : topic.name;
        const topicArn = fw24.getArn('sns', fw24.getEnvironmentVariable(topicName, 'topicName'));
        const topicInstance = Topic.fromTopicArn(scope, `${mergedProps.queueName}-${topicName}-topic`, topicArn);
        topicInstance.addSubscription(new SqsSubscription(queue));
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
  static attachQueueToLambda(
    lambda: NodejsFunction,
    queue: Queue,
    queueProps: QueueProps | undefined,
    queueName: string,
    sqsEventSourceProps?: QueueLambdaFunctionProps[ 'sqsEventSourceProps' ]
  ): void {
    const isQueueFifo = Helper.isFifoQueueProps({
      ...(queueProps || {}),
      queueName: queueName
    });

    const eventSourceProps = QueueLambda.normalizeSqsEventSourceProps(sqsEventSourceProps, isQueueFifo);
    lambda.addEventSource(new SqsEventSource(queue, eventSourceProps));
  }

  constructor(scope: Construct, id: string, queueLambdaProps: QueueLambdaFunctionProps) {
    super(scope, id);
    this.logger = createLogger(`${QueueLambda.name}-${id}`);

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
      const queueFunction = new LambdaFunction(scope, `${id}-lambda`, { ...props.lambdaFunctionProps }) as NodejsFunction;
      QueueLambda.attachQueueToLambda(queueFunction, queue, props.queueProps, props.queueName, props.sqsEventSourceProps);

      // Store subscription for simulator
      const fw24 = Fw24.getInstance();
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
