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
import { createLogger, ILogger } from "../logging";

export interface LambdaFunctionProps {
  entry: string;
  fw24LayerArn?: string;
  policies?: any[];
  environmentVariables?: { [key: string]: string };
  tableName?: string;
  buckets? : [{ name: string, access?: string }];
  queues?: [{ name: string, actions: string[] }];
  topics?: [{ name: string, actions: string[] }];
  allowSendEmail?: boolean;
  functionProps?: NodejsFunctionProps;
}

export class LambdaFunction extends Construct {
  
  readonly logger ?: ILogger = createLogger('LambdaFunction');

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

    let additionalProps: any = {
      entry: props.entry,
    }
    // If layerArn is defined, then we are using the layer
    if(props.fw24LayerArn){
      additionalProps.layers = [...(props.functionProps?.layers ?? []), LayerVersion.fromLayerVersionArn(this,  `${id}-Fw24CoreLayer`, props.fw24LayerArn)];
      additionalProps.bundling = {
        ...props.functionProps?.bundling,
        sourceMap: true,
        externalModules: ["aws-sdk", "fw24"],
      };
    }

    const fn = new NodejsFunction(this, id, {
      ...defaultProps, 
      ...props.functionProps,
      ...additionalProps
    });

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
      this.logger?.debug(":GET emailQueue Name from fw24 scope : ", fw24.get('emailQueue', 'queueName_'));
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
      this.logger?.debug(":GET Queue Name from fw24 scope : ", queue.name, " :", fw24.get(queue.name, 'queueName_'));
      const queueArn = fw24.getArn('sqs', fw24.get(queue.name, 'queueName_'));
      const queueInstance = Queue.fromQueueArn(this, queue.name+id+'-queue', queueArn);
      queueInstance.grantSendMessages(fn);
      fn.addEnvironment(`${queue.name}_queueUrl`, queueInstance.queueUrl);
    });

    // add sns topic permission
    props.topics?.forEach( ( topic: any ) => {
      const topicArn = fw24.getArn('sns', fw24.get(topic.name, 'topicName_'));
      const topicInstance = Topic.fromTopicArn(this, topic.name+id+'-topic', topicArn);
      topicInstance.grantPublish(fn);
      fn.addEnvironment(`${topic.name}_topicArn`, topicInstance.topicArn);
    });

    return fn;
  }
}
