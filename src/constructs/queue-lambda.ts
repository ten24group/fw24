import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { Runtime, Architecture, ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { BundlingOptions } from "aws-cdk-lib/aws-lambda-nodejs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction } from "./lambda-function";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

interface QueueLambdaFunctionProps {
  // queue properties
  queueName: string;
  visibilityTimeout: Duration;
  receiveMessageWaitTime: Duration;
  //SQS event source properties
  batchSize?: number;
  maxBatchingWindow?: Duration;
  reportBatchItemFailures?: boolean;
  // lambda properties
  entry: string;
  runtime?: Runtime;
  handler?: string;
  timeout?: Duration;
  memorySize?: number;
  architecture?: Architecture;
  layerArn?: string;
  layers?: ILayerVersion[];
  bundling?: BundlingOptions;
  policies?: any[];
  env?: { [key: string]: string };
}

export class QueueLambda extends Construct {
  readonly queue: Queue;

  constructor(scope: Construct, id: string, props: QueueLambdaFunctionProps) {
    super(scope, id);

    this.queue = new Queue(this, id, {
      queueName: props.queueName,
      visibilityTimeout: props.visibilityTimeout,
      receiveMessageWaitTime: props.receiveMessageWaitTime,
    });

    const queueFunction = new LambdaFunction(this, id, { ...props }).fn;

    // add event source to lambda function
    queueFunction.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize || 1,
      maxBatchingWindow: props.maxBatchingWindow || Duration.seconds(5),
      reportBatchItemFailures: props.reportBatchItemFailures || true,
    }));
    
  }
}
