import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Fw24 } from "../core/fw24";
import { ILogger, createLogger } from "../logging";

interface QueueLambdaFunctionProps {
  // queue properties
  queueName: string;
  queueProps?: QueueProps;
  // define timeouts in seconds to avoid importing Duration class from aws-cdk-lib
	visibilityTimeoutSeconds?: number;
	receiveMessageWaitTimeSeconds?: number;
	// define the retention period in days
	retentionPeriodDays?: number;

  //SQS event source properties
  sqsEventSourceProps?: {
    batchSize?: number;
    maxBatchingWindow?: Duration;
    reportBatchItemFailures?: boolean;
  }

  // lambda function properties
  lambdaFunctionProps?: LambdaFunctionProps;

  // queue subscriptions
  subscriptions?: IQueueSubscriptions
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

const QueueLambdaFunctionPropDefaults : QueueLambdaFunctionProps = {
  queueName: "",
  queueProps: {
    visibilityTimeout: Duration.seconds(30),
    receiveMessageWaitTime: Duration.seconds(20),
  },
}

export class QueueLambda extends Construct {
  readonly logger ?: ILogger;

  constructor(scope: Construct, id: string, queueLambdaProps: QueueLambdaFunctionProps) {
    super(scope, id);
    this.logger = createLogger(`${QueueLambda.name}-${id}`);

    const fw24 = Fw24.getInstance();
    
    let props = { ...QueueLambdaFunctionPropDefaults, ...queueLambdaProps };

    // get the dlq from fw24 or create a new dlq
    let dlq: Queue = fw24.get(props.queueName, 'dlq') || fw24.get('dlq_default');
    
    if(!dlq){
      dlq = new Queue(this, "default-dlq", {});
      fw24.set('dlq_default', dlq);
    }

    // set the timeouts
    let timeoutProps: any = {};
    if(props.visibilityTimeoutSeconds) Object.assign(timeoutProps, { visibilityTimeout : Duration.seconds(props.visibilityTimeoutSeconds)});
    if(props.receiveMessageWaitTimeSeconds) Object.assign(timeoutProps, { receiveMessageWaitTime : Duration.seconds(props.receiveMessageWaitTimeSeconds)});
    if(props.retentionPeriodDays) Object.assign(timeoutProps, { messageRetentionPeriod : Duration.days(props.retentionPeriodDays)});   

    // set the default dlq with option to override
    props.queueProps = {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
      ...props.queueProps,
      ...timeoutProps,
    }
    
    const queue = new Queue(this, id, {
      ...props.queueProps,
    }) as Queue;

    fw24.set(props.queueName, queue.queueName, "queueName");
    this.logger?.debug(" Queue Name set in fw24 scope : ", props.queueName, " :", fw24.get(props.queueName, 'queueName'));

    fw24.set(props.queueName, queue, "queue");

    if(props.lambdaFunctionProps){
      const queueFunction = new LambdaFunction(this, `${id}-lambda`, { ...props.lambdaFunctionProps }) as NodejsFunction;

      // add event source to lambda function
      queueFunction.addEventSource(new SqsEventSource(queue, {
        batchSize: props.sqsEventSourceProps?.batchSize || 1,
        maxBatchingWindow: props.sqsEventSourceProps?.maxBatchingWindow || Duration.seconds(5),
        reportBatchItemFailures: props.sqsEventSourceProps?.reportBatchItemFailures || true,
      }));
    }

    // subscribe the queue to SNS topic
    props?.subscriptions?.topics?.forEach( ( topic: any) => {
      const topicName = typeof topic === 'string' ? topic : topic.name;
      const filters = typeof topic === 'string' ? [] : topic.filters;

      const topicArn = fw24.getArn('sns', fw24.get(topicName, 'topicName'));
      const topicInstance = Topic.fromTopicArn(this, topicName+id+'-topic', topicArn);
      // TODO: add ability to filter messages
      topicInstance.addSubscription(new SqsSubscription(queue));
    });
    
    return queue;
  }
  
}
