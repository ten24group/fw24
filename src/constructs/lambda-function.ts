import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { MailerConstruct } from "./mailer";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { createLogger, ILogger } from "../logging";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

/**
 * Represents the properties for a Lambda function.
 */
export interface LambdaFunctionProps {
  /**
   * The entry point for the Lambda function.
   */
  entry: string;

  /**
   * The policies to attach to the Lambda function's execution role.
   */
  policies?: any[];

  /**
   * The environment variables to set for the Lambda function.
   */
  environmentVariables?: { [key: string]: string };

  /**
   * The resource access configuration for the Lambda function.
   */
  resourceAccess?: IFunctionResourceAccess;

  /**
   * Indicates whether the Lambda function is allowed to send emails.
   */
  allowSendEmail?: boolean;

  /**
   * The number of days to retain the logs for the Lambda function.
   */
  logRetentionDays?: RetentionDays;

  /**
   * The removal policy for the Lambda function's logs.
   */
  logRemovalPolicy?: RemovalPolicy;

  /**
   * The timeout duration for the Lambda function in seconds.
   * Use this timeout to avoid importing the duration class from aws-cdk-lib.
   */
  functionTimeout?: number;

  /**
   * Additional properties for the Node.js Lambda function.
   */
  functionProps?: NodejsFunctionProps;
}

/**
 * Represents the access permissions for various resources that can be accessed by a function.
 */
export interface IFunctionResourceAccess {
  /**
   * Access permissions for tables.
   * Each table can have a name and an optional array of access permissions.
   * The access permissions can be 'read', 'write', or 'readwrite'.
   * If no access permissions are specified, the default is 'readwrite'.
   */
  tables?: Array<{ 
    name: string;
    access?: string[];
  }> | string[];

  /**
   * Access permissions for buckets.
   * Each bucket can have a name and an optional array of access permissions.
   * The access permissions can be 'read', 'write', or 'readwrite'.
   * If no access permissions are specified, the default is 'readwrite'.
   */
  buckets?: Array<{ 
    name: string;
    access?: string[];
  }> | string[];

  /**
   * Access permissions for topics.
   * Each topic can have a name and an optional array of access permissions.
   * The access permissions can be 'publish'.
   * If no access permissions are specified, the default is 'publish'.
   */
  topics? : Array<{
    name: string;
    access?: string[];
  }> | string[];

  /**
   * Access permissions for queues.
   * Each queue can have a name and an optional array of access permissions.
   * The access permissions can be 'send', 'receive', or 'delete'.
   * If no access permissions are specified, the default is 'send'.
   */
  queues?: Array<{
    name: string;
    access?: string[];
  }> | string[];
}


/**
 * Represents a Lambda function construct.
 *
 * @example
 * ```ts
 * // Create a Lambda function with custom properties
 * const lambdaProps: LambdaFunctionProps = {
 *   entry: "index.js",
 *   policies: [
 *     {
 *       Effect: "Allow",
 *       Action: "s3:GetObject",
 *       Resource: "arn:aws:s3:::my-bucket/*",
 *     },
 *   ],
 *   environmentVariables: {
 *     MY_ENV_VAR: "my-value",
 *   },
 *   resourceAccess: {
 *     tables: [
 *       {
 *         name: "my-table",
 *         access: ["read", "write"],
 *       },
 *     ],
 *     buckets: ["my-bucket"],
 *     topics: ["my-topic"],
 *     queues: ["my-queue"],
 *   },
 *   allowSendEmail: true,
 *   logRetentionDays: RetentionDays.ONE_WEEK,
 *   logRemovalPolicy: RemovalPolicy.DESTROY,
 *   functionTimeout: 10,
 *   functionProps: {
 *     runtime: Runtime.NODEJS_14_X,
 *     memorySize: 256,
 *   },
 * };
 *
 * const lambdaFunction = new LambdaFunction(stack, "MyLambdaFunction", lambdaProps);
 * 
 * ```
 */
export class LambdaFunction extends Construct {
  
  readonly logger ?: ILogger = createLogger('LambdaFunction');

  /**
   * Constructs a new instance of the LambdaFunction class.
   * @param scope - The parent construct.
   * @param id - The ID of the construct.
   * @param props - The Lambda function properties.
   * @returns The Lambda function.
   */
  constructor(scope: Construct, id: string, props: LambdaFunctionProps) {
    super(scope, id);

    const fw24 = Fw24.getInstance();
    
    // Default properties for the Node.js function
    let defaultProps: NodejsFunctionProps = {
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.seconds(5),
      memorySize: 128,
      ...fw24.getConfig().functionProps,
    };

    // Create log group if not provided
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
    // Use fw24 layer
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

    // Create the Node.js function
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
        // If key is prefixed with fw24_, access environment variables from fw24 scope
        if(value.startsWith('fw24_')){
          // Last part of the key is the environment variable name in fw24 scope
          let fw24Key = key.split('_').pop() || '';
          // If the key has 3 parts then the second part is the scope name
          let prefix = key.split('_').length == 3 ? key.split('_')[1] : '';
          envValue = fw24.get(fw24Key,prefix);
          this.logger?.debug(`:GET environment variable from fw24 scope : ${fw24Key} : ${envValue}`, id);
        }
        this.logger?.debug(`:SET environment variable : ${envKey} : ${envValue}`, id);
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
    if(props.allowSendEmail && fw24.emailProvider instanceof MailerConstruct){
      this.logger?.debug(":GET emailQueue Name from fw24 scope : ", fw24.get('emailQueue', 'queueName'), id);
      let emailQueue = fw24.getQueueByName('emailQueue');
      emailQueue.grantSendMessages(fn);
      fn.addEnvironment('EMAIL_QUEUE_URL', emailQueue.queueUrl);
    }

    // Logic for adding DynamoDB table access to the controller
    props.resourceAccess?.tables?.forEach( ( table: any ) => {
      const tableName = typeof table === 'string' ? table : table.name;
      const access = typeof table === 'string' ? ['readwrite'] : table.access || ['readwrite'];
      // Get the DynamoDB table based on the controller config
      const tableInstance: TableV2 = fw24.getDynamoTable(tableName);
      // Add the table name to the lambda environment
      fn.addEnvironment(`${tableName.toUpperCase()}_TABLE`, tableInstance.tableName);
      // Grant the lambda function read write access to the table
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

    // Logic for adding S3 bucket access to the controller
    props.resourceAccess?.buckets?.forEach( ( bucket: any ) => {
      const bucketName = typeof bucket === 'string' ? bucket : bucket.name;
      const access = typeof bucket === 'string' ? ['readwrite'] : bucket.access || ['readwrite'];

      const bucketFullName = fw24.getUniqueName(bucketName);
      const bucketInstance: any = Bucket.fromBucketName(this, bucketName+id+'-bucket', bucketFullName);
      // Grant the lambda function access to the bucket
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
      // Add environment variable for the bucket name
      fn.addEnvironment(`bucket_${bucketName}`, bucketFullName);
    });

    props.resourceAccess?.queues?.forEach( ( queue: any ) => {
      const queueName = typeof queue === 'string' ? queue : queue.name;
      const access = typeof queue === 'string' ? ['send'] : queue.access || ['send'];

      this.logger?.debug(":GET Queue Name from fw24 scope : ", queueName, " :", fw24.get(queueName, 'queueName'));
      const queueArn = fw24.getArn('sqs', fw24.get(queueName, 'queueName'));
      const queueInstance = Queue.fromQueueArn(this, queueName+id+'-queue', queueArn);
      // Grant the lambda function access to the queue
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
      // Add environment variable for the queue url
      fn.addEnvironment(`${queueName}_queueUrl`, queueInstance.queueUrl);
    });

    // Add SNS topic permission
    props.resourceAccess?.topics?.forEach( ( topic: any ) => {
      const topicName = typeof topic === 'string' ? topic : topic.name;
      const access = typeof topic === 'string' ? ['publish'] : topic.access || ['publish'];

      const topicArn = fw24.getArn('sns', fw24.get(topicName, 'topicName'));
      const topicInstance = Topic.fromTopicArn(this, topicName+id+'-topic', topicArn);
      // Grant the lambda function access to the topic
      access.forEach( (accessType: string) => {
        switch (accessType) {
          default:
            topicInstance.grantPublish(fn);
            break;
        }
      });
      // Add environment variable for the topic arn
      fn.addEnvironment(`${topicName}_topicArn`, topicInstance.topicArn);
    });

    return fn;
  }
}
