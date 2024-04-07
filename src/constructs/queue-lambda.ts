import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
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

    const queueFunction = new LambdaFunction(this, `${id}-lambda`, { ...props.lambdaFunctionProps }) as NodejsFunction;

    // add event source to lambda function
    queueFunction.addEventSource(new SqsEventSource(queue, {
      batchSize: props.sqsEventSourceProps?.batchSize || 1,
      maxBatchingWindow: props.sqsEventSourceProps?.maxBatchingWindow || Duration.seconds(5),
      reportBatchItemFailures: props.sqsEventSourceProps?.reportBatchItemFailures || true,
    }));
    
    return queue;
  }
}
