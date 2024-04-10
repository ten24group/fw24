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

interface QueueLambdaFunctionProps {
  // queue properties
  queueName: string;
  queueProps?: QueueProps;

  //SQS event source properties
  sqsEventSourceProps?: {
    batchSize?: number;
    maxBatchingWindow?: Duration;
    reportBatchItemFailures?: boolean;
  }

  // lambda function properties
  lambdaFunctionProps?: LambdaFunctionProps;

  // sns subscription topics
  topics?: [{ name: string, actions: string[] }];
}

const QueueLambdaFunctionPropDefaults : QueueLambdaFunctionProps = {
  queueName: "",
  queueProps: {
    visibilityTimeout: Duration.seconds(30),
    receiveMessageWaitTime: Duration.seconds(20),
  },
}

export class QueueLambda extends Construct {

  constructor(scope: Construct, id: string, queueLambdaProps: QueueLambdaFunctionProps) {
    super(scope, id);

    const fw24 = Fw24.getInstance();
    
    let props = { ...QueueLambdaFunctionPropDefaults, ...queueLambdaProps };

    // get the dlq from fw24 or create a new dlq
    let dlq: Queue = fw24.get(props.queueName, 'dlq_') || fw24.get('dlq_default');
    
    if(!dlq){
      dlq = new Queue(this, "default-dlq", {});
      fw24.set('dlq_default', dlq);
    }

    // set the default dlq with option to override
    props.queueProps = {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
      ...props.queueProps,
    }
    
    const queue = new Queue(this, id, {
      ...props.queueProps,
    }) as Queue;

    fw24.set(props.queueName, queue.queueName, "queueName_");
    console.log("Queue Name set in fw24 scope : ", props.queueName, " :", fw24.get(props.queueName, 'queueName_'));

    fw24.set(props.queueName, queue, "queue_");

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
    props?.topics?.forEach( ( topic: any) => {
      const topicArn = fw24.getArn('sns', fw24.get(topic.name, 'topicName_'));
      const topicInstance = Topic.fromTopicArn(this, topic.name+id+'-topic', topicArn);
      // TODO: add ability to filter messages
      topicInstance.addSubscription(new SqsSubscription(queue));
    });
    
    return queue;
  }
  
}
