import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture, ILayerVersion, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction, NodejsFunctionProps, BundlingOptions } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { SESStack } from "../stacks/ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";

export interface LambdaFunctionProps {
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
  environmentVariables?: { [key: string]: string };
  tableName?: string;
  buckets? : [{ name: string, access?: string }];
  queues?: [{ name: string, actions: string[] }];
  topics?: [{ name: string, actions: string[] }];
  allowSendEmail?: boolean;
}

export class LambdaFunction extends Construct {
  constructor(scope: Construct, id: string, props: LambdaFunctionProps) {
    super(scope, id);

    const fw24 = Fw24.getInstance();

    let defaultProps: NodejsFunctionProps = {
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.seconds(5),
      memorySize: 128,
    };

    // If layerArn is defined, then we are using the layer
    if(props.layerArn){
      props.layers = [LayerVersion.fromLayerVersionArn(this,  `${id}-Fw24CoreLayer`, props.layerArn)];
      props.bundling = {
        sourceMap: true,
        externalModules: ["aws-sdk", "fw24"],
      };
    }

    const fn = new NodejsFunction(this, id, { ...defaultProps, ...props });

    // Set environment variables
    if(props.environmentVariables){
      for (const [key, value] of Object.entries(props.environmentVariables)) {
        fn.addEnvironment(key, value);
      }
    }

    // Attach policies to the function
    if(props.policies){
      props.policies.forEach(policy => {
        fn.addToRolePolicy(
          new PolicyStatement(policy)
        );
      });
    }

    // If we are using SES, then we need to add the email queue url to the environment
    if(props.allowSendEmail && fw24.emailProvider instanceof SESStack){
      let emailQueue = fw24.getQueueByName('emailQueue');
      emailQueue.grantSendMessages(fn);
      fn.addEnvironment('EMAIL_QUEUE_URL', emailQueue.queueUrl);
    }

     // logic for adding dynamodb table access to the controller
     if (props.tableName) {
        // get the dynamodb table based on the controller config
        const tableInstance: TableV2 = fw24.getDynamoTable(props.tableName);
        // add the table name to the lambda environment
        fn.addEnvironment(`${props.tableName.toUpperCase()}_TABLE`, tableInstance.tableName);
        // grant the lambda function read write access to the table
        tableInstance.grantReadWriteData(fn);
    }

     // logic for adding s3 bucket access to the controller
    props.buckets?.forEach( ( bucket: any ) => {
      const bucketFullName = fw24.getUniqueName(bucket.name);
      const bucketInstance: any = Bucket.fromBucketName(this, bucket.name+id+'-bucket', bucketFullName);
      // grant the lambda function access to the bucket
      switch (bucket.access) {
          case 'read':
              bucketInstance.grantRead(fn);
              break;
          case 'write':
              bucketInstance.grantWrite(fn);
              break;
          default:
              bucketInstance.grantReadWrite(fn);
              break;
      }
      // add environment variable for the bucket name
      fn.addEnvironment(`bucket_${bucket.name}`, bucketFullName);
    });

    props.queues?.forEach( ( queue: any ) => {
      const queueArn = fw24.getArn('sqs', queue.name);

      const queueInstance = Queue.fromQueueArn(this, queue.name+id+'-queue', queueArn);
      queueInstance.grantSendMessages(fn);
      fn.addEnvironment(`${queue.name}_queueUrl`, queueInstance.queueUrl);
    });

    // add sns topic permission
    props.topics?.forEach( ( topic: any ) => {
      const topicArn = fw24.getArn('sns', topic.name);

      const topicInstance = Topic.fromTopicArn(this, topic.name+id+'-topic', topicArn);
      topicInstance.grantPublish(fn);
      fn.addEnvironment(`${topic.name}_topicArn`, topicInstance.topicArn);
    });

    return fn;
  }
}
