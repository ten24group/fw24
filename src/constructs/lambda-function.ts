import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { SESStack } from "../stacks/ses";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { createLogger, ILogger } from "../logging";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export interface LambdaFunctionProps {
  entry: string;
  policies?: any[];
  environmentVariables?: { [key: string]: string };
  resourceAccess?: IFunctionResourceAccess;
  allowSendEmail?: boolean;
  logRetentionDays?: RetentionDays;
  logRemovalPolicy?: RemovalPolicy,
  // timeout in seconds; use this timeout to avoid importing duration class from aws-cdk-lib
  functionTimeout?: number;
  functionProps?: NodejsFunctionProps;
}

export interface IFunctionResourceAccess {
  tables?: Array<{ 
    name: string;
    access?: string[]; // read, write, readwrite | default is readwrite
  }> | string[];
  buckets?: Array<{ 
    name: string;
    access?: string[]; // read, write, readwrite | default is readwrite
  }> | string[];
  topics? : Array<{
    name: string;
    access?: string[]; // publish | default is publish
  }> | string[];
  queues?: Array<{
    name: string;
    access?: string[]; // send, receive, delete | default is send
  }> | string[];
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
      ...fw24.getConfig().functionProps,
    };

    // create log group
    let logGroup =  props.functionProps?.logGroup;
    if(!logGroup) {
      let logRetentionDays = props.logRetentionDays || fw24.getConfig().logRetentionDays || 30;
      logGroup = new LogGroup(this, `${id}-LogGroup`, {
        removalPolicy: props.logRemovalPolicy || fw24.getConfig().logRemovalPolicy || RemovalPolicy.RETAIN,
        retention: parseInt(logRetentionDays.toString()),
      });
    }
    
    let additionalProps: any = {
      entry: props.entry,
    }
    // use fw24 layer
    additionalProps.layers = [...(defaultProps?.layers ?? []),...(props.functionProps?.layers ?? []), LayerVersion.fromLayerVersionArn(this,  `${id}-Fw24CoreLayer`, fw24.get('fw24', 'layer'))];
    additionalProps.bundling = {
      ...defaultProps.bundling,
      ...props.functionProps?.bundling,
      sourceMap: true,
      externalModules: [...(defaultProps?.bundling?.externalModules ?? []),...(props.functionProps?.bundling?.externalModules ?? []), "@ten24group/fw24"],
    };
    additionalProps.logGroup = logGroup;
    if(props.functionTimeout){
      additionalProps.timeout = Duration.seconds(props.functionTimeout);
    }

    const fn = new NodejsFunction(this, id, {
      ...defaultProps, 
      ...props.functionProps,
      ...additionalProps,
    });

    // Set environment variables
    if(props.environmentVariables){
      for (const [key, value] of Object.entries(props.environmentVariables)) {
        let envValue = value;
        let envKey = key;
        // if key is prefixed with fw24_ access environment variables from fw24 scope
        if(value.startsWith('fw24_')){
          // last part of the key is the environment variable name in fw24 scope
          let fw24Key = key.split('_').pop() || '';
          // if the key has 3 parts then the second part is the scope name
          let prefix = key.split('_').length == 3 ? key.split('_')[1] : '';
          envValue = fw24.get(fw24Key,prefix);
          this.logger?.debug(`:GET environment variable from fw24 scope : ${fw24Key} : ${envValue}`);
        }
        fn.addEnvironment(envKey, envValue);
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
      this.logger?.debug(":GET emailQueue Name from fw24 scope : ", fw24.get('emailQueue', 'queueName'));
      let emailQueue = fw24.getQueueByName('emailQueue');
      emailQueue.grantSendMessages(fn);
      fn.addEnvironment('EMAIL_QUEUE_URL', emailQueue.queueUrl);
    }

    // logic for adding dynamodb table access to the controller
    props.resourceAccess?.tables?.forEach( ( table: any ) => {
      const tableName = typeof table === 'string' ? table : table.name;
      const access = typeof table === 'string' ? ['readwrite'] : table.access || ['readwrite'];
      // get the dynamodb table based on the controller config
      const tableInstance: TableV2 = fw24.getDynamoTable(tableName);
      // add the table name to the lambda environment
      fn.addEnvironment(`${tableName.toUpperCase()}_TABLE`, tableInstance.tableName);
      // grant the lambda function read write access to the table
      access.forEach( (accessType: string) => {
        switch (accessType) {
          case 'read':
            tableInstance.grantReadData(fn);
            break;
          case 'write':
            tableInstance.grantWriteData(fn);
            break;
          default:
            tableInstance.grantReadWriteData(fn);
            break;
        }
      });
    });

    // logic for adding s3 bucket access to the controller
    props.resourceAccess?.buckets?.forEach( ( bucket: any ) => {
      const bucketName = typeof bucket === 'string' ? bucket : bucket.name;
      const access = typeof bucket === 'string' ? ['readwrite'] : bucket.access || ['readwrite'];

      const bucketFullName = fw24.getUniqueName(bucketName);
      const bucketInstance: any = Bucket.fromBucketName(this, bucketName+id+'-bucket', bucketFullName);
      // grant the lambda function access to the bucket
      access.forEach( (accessType: string) => {
        switch (accessType) {
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
      });
      // add environment variable for the bucket name
      fn.addEnvironment(`bucket_${bucketName}`, bucketFullName);
    });

    props.resourceAccess?.queues?.forEach( ( queue: any ) => {
      const queueName = typeof queue === 'string' ? queue : queue.name;
      const access = typeof queue === 'string' ? ['send'] : queue.access || ['send'];

      this.logger?.debug(":GET Queue Name from fw24 scope : ", queueName, " :", fw24.get(queueName, 'queueName'));
      const queueArn = fw24.getArn('sqs', fw24.get(queueName, 'queueName'));
      const queueInstance = Queue.fromQueueArn(this, queueName+id+'-queue', queueArn);
      // grant the lambda function access to the queue
      access.forEach( (accessType: string) => {
        switch (accessType) {
          case 'receive':
            queueInstance.grantConsumeMessages(fn);
            break;
          case 'delete':
            queueInstance.grantPurge(fn);
            break;
          default:
            queueInstance.grantSendMessages(fn);
            break;
        }
      });
      // add environment variable for the queue url
      fn.addEnvironment(`${queueName}_queueUrl`, queueInstance.queueUrl);
    });

    // add sns topic permission
    props.resourceAccess?.topics?.forEach( ( topic: any ) => {
      const topicName = typeof topic === 'string' ? topic : topic.name;
      const access = typeof topic === 'string' ? ['publish'] : topic.access || ['publish'];

      const topicArn = fw24.getArn('sns', fw24.get(topicName, 'topicName'));
      const topicInstance = Topic.fromTopicArn(this, topicName+id+'-topic', topicArn);
      // grant the lambda function access to the topic
      access.forEach( (accessType: string) => {
        switch (accessType) {
          default:
            topicInstance.grantPublish(fn);
            break;
        }
      });
      // add environment variable for the topic arn
      fn.addEnvironment(`${topicName}_topicArn`, topicInstance.topicArn);
    });

    return fn;
  }
}
