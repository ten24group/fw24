import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { QueueProps } from 'aws-cdk-lib/aws-sqs';
import { LambdaFunction, LambdaFunctionProps } from './lambda-function';
import { SqsEventSource, SqsEventSourceProps } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Fw24 } from '../core/fw24';
import { ILogger, createLogger } from '../logging';
import { Helper } from '../core';

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
  topics:
    | Array<{
        name: string;
        filters: string[];
      }>
    | string[];
}

/**
 * Default properties for the QueueLambdaFunction.
 */
const QueueLambdaFunctionPropDefaults: QueueLambdaFunctionProps = {
  queueName: '',
  queueProps: {
    visibilityTimeout: Duration.seconds(30),
    receiveMessageWaitTime: Duration.seconds(20),
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
 *     runtime: Runtime.NODEJS_14_X,
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

  constructor(scope: Construct, id: string, queueLambdaProps: QueueLambdaFunctionProps) {
    super(scope, id);
    this.logger = createLogger(`${QueueLambda.name}-${id}`);

    const fw24 = Fw24.getInstance();

    const props = { ...QueueLambdaFunctionPropDefaults, ...queueLambdaProps };

    // dlq props
    let dlqProps = {};
    //check if dlq already exists
    const existingDLQ: Queue =
      fw24.getEnvironmentVariable(props.queueName, 'dlq') ||
      fw24.getEnvironmentVariable(props.queueName + '_dlq', 'queue');
    //if it does, assign it to the queue
    if (existingDLQ) {
      dlqProps = {
        deadLetterQueue: {
          maxReceiveCount: 3,
          queue: existingDLQ,
        },
      };
    } else if (!props.queueName.endsWith('dlq')) {
      //if queue itself is a dlq don't assign default dlq
      //set default dlq
      const isFifoQueue =
        props.queueProps?.fifo || props.queueName.endsWith('.fifo') || props.queueProps?.contentBasedDeduplication;
      let defaultDLQ = isFifoQueue
        ? fw24.getEnvironmentVariable('dlq_default_fifo')
        : fw24.getEnvironmentVariable('dlq_default');

      if (!defaultDLQ) {
        const dlqName = isFifoQueue ? 'default-dlq-fifo' : 'default-dlq';
        //create default dlq
        defaultDLQ = new Queue(this, dlqName, {
          fifo: isFifoQueue,
        });
        fw24.getEnvironmentVariable(dlqName.replace('default-', '_'), defaultDLQ);
      }
      //assign default dlq
      dlqProps = {
        deadLetterQueue: {
          maxReceiveCount: 3,
          queue: defaultDLQ,
        },
      };
    }

    // set the timeouts
    const timeoutProps: any = {};
    if (props.visibilityTimeoutSeconds)
      Object.assign(timeoutProps, { visibilityTimeout: Duration.seconds(props.visibilityTimeoutSeconds) });
    if (props.receiveMessageWaitTimeSeconds)
      Object.assign(timeoutProps, { receiveMessageWaitTime: Duration.seconds(props.receiveMessageWaitTimeSeconds) });
    if (props.retentionPeriodDays)
      Object.assign(timeoutProps, { messageRetentionPeriod: Duration.days(props.retentionPeriodDays) });

    // set the default dlq with option to override
    props.queueProps = {
      ...dlqProps,
      ...props.queueProps,
      ...timeoutProps,
    };

    const queue = new Queue(this, id, {
      ...props.queueProps,
    }) as Queue;

    if (props.lambdaFunctionProps) {
      const queueFunction = new LambdaFunction(scope, `${id}-lambda`, {
        ...props.lambdaFunctionProps,
      }) as NodejsFunction;

      const isFifoQueue = Helper.isFifoQueueProps({
        ...(props.queueProps || {}),
        queueName: props.queueName,
      });

      const eventSourceProps: SqsEventSourceProps = isFifoQueue
        ? {}
        : {
            batchSize: props.sqsEventSourceProps?.batchSize ?? 1,
            maxBatchingWindow: props.sqsEventSourceProps?.maxBatchingWindow ?? Duration.seconds(5),
            reportBatchItemFailures: props.sqsEventSourceProps?.reportBatchItemFailures ?? true,
          };

      // add event source to lambda function
      queueFunction.addEventSource(new SqsEventSource(queue, eventSourceProps));
    }

    // subscribe the queue to SNS topic
    props?.subscriptions?.topics?.forEach((topic: any) => {
      const topicName = typeof topic === 'string' ? topic : topic.name;
      const filters = typeof topic === 'string' ? [] : topic.filters;

      const topicArn = fw24.getArn('sns', fw24.getEnvironmentVariable(topicName, 'topicName'));
      const topicInstance = Topic.fromTopicArn(this, topicName + id + '-topic', topicArn);
      // TODO: add ability to filter messages
      topicInstance.addSubscription(new SqsSubscription(queue));
    });

    return queue;
  }
}
