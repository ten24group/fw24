import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { Runtime, Architecture, ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { BundlingOptions, NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

interface QueueLambdaFunctionProps {
  // queue properties
  queueName: string;
  visibilityTimeout: Duration;
  receiveMessageWaitTime: Duration;

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

    const queue = new Queue(this, id, {
      queueName: props.queueName,
      visibilityTimeout: props.visibilityTimeout,
      receiveMessageWaitTime: props.receiveMessageWaitTime,
    });

    const queueFunction = new LambdaFunction(this, id, { ...props.lambdaFunctionProps }) as NodejsFunction;

    // add event source to lambda function
    queueFunction.addEventSource(new SqsEventSource(queue, {
      batchSize: props.sqsEventSourceProps?.batchSize || 1,
      maxBatchingWindow: props.sqsEventSourceProps?.maxBatchingWindow || Duration.seconds(5),
      reportBatchItemFailures: props.sqsEventSourceProps?.reportBatchItemFailures || true,
    }));
    
    return queue;
  }
}
