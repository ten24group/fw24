import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Fw24 } from "../core/fw24";

interface QueueLambdaFunctionProps {
  // queue properties
  queueName: string;
  visibilityTimeout?: Duration;
  receiveMessageWaitTime?: Duration;

  //SQS event source properties
  sqsEventSourceProps?: {
    batchSize?: number;
    maxBatchingWindow?: Duration;
    reportBatchItemFailures?: boolean;
  }

  // lambda function properties
  lambdaFunctionProps: LambdaFunctionProps;

  // sns subscription topics
  topics?: [{ name: string, actions: string[] }];
}

export class QueueLambda extends Construct {

  constructor(scope: Construct, id: string, props: QueueLambdaFunctionProps) {
    super(scope, id);

    const fw24 = Fw24.getInstance();

    const queue = new Queue(this, id, {
      visibilityTimeout: props.visibilityTimeout || Duration.seconds(30),
      receiveMessageWaitTime: props.receiveMessageWaitTime || Duration.seconds(20),
    });

    fw24.set(props.queueName, queue.queueName, "queueName_");
    console.log("Queue Name set in fw24 scope : ", props.queueName, " :", fw24.get(props.queueName, 'queueName_'));

    fw24.set(props.queueName, queue, "queue_");

    const queueFunction = new LambdaFunction(this, `${id}-lambda`, { ...props.lambdaFunctionProps }) as NodejsFunction;

    // add event source to lambda function
    queueFunction.addEventSource(new SqsEventSource(queue, {
      batchSize: props.sqsEventSourceProps?.batchSize || 1,
      maxBatchingWindow: props.sqsEventSourceProps?.maxBatchingWindow || Duration.seconds(5),
      reportBatchItemFailures: props.sqsEventSourceProps?.reportBatchItemFailures || true,
    }));

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
