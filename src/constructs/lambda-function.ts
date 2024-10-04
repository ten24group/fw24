import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement, type PolicyStatementProps } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture, LayerVersion, ApplicationLogLevel, LoggingFormat, ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { MailerConstruct } from "./mailer";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { createLogger, ILogger } from "../logging";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ensureNoSpecialChars, ensureSuffix, ensureValidEnvKey } from "../utils/keys";

export type TPolicyStatementOrProps = PolicyStatement | PolicyStatementProps ;
export type TImportedPolicy = {name: string, isOptional?: boolean, prefix?: string};

export function isImportedPolicy(policy: TPolicyStatementOrProps | TImportedPolicy): policy is TImportedPolicy {
  return (policy as TImportedPolicy).name !== undefined;
}

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
  policies?: Array<TPolicyStatementOrProps | TImportedPolicy>;

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
  functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
    readonly layers?: Array<ILayerVersion | string>;
  }
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
 *   policies: [{
 *         effect: Effect.ALLOW,
 *         actions: [
 *          "s3:GetObject"
 *         ],
 *         resources: ["arn:aws:s3:::my-bucket/*"],
 *     }, 
 *     {
 *       policy: "authModule:create-user-auth-record",
 *       isOptional: true
 *     }
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

export function formatLogLevel(logLevel?: string) {
   switch(logLevel?.toUpperCase()) {
    case'ERROR': 
      return ApplicationLogLevel.ERROR;
    case 'WARN':
      return ApplicationLogLevel.WARN;
    case 'DEBUG':
      return ApplicationLogLevel.DEBUG;
    case 'TRACE':
      return ApplicationLogLevel.TRACE;
    case 'FATAL':
      return ApplicationLogLevel.FATAL;
    case 'INFO':
    default: 
      return ApplicationLogLevel.INFO
  }
}

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
      loggingFormat: process.env.LOG_FORMAT?.toLowerCase?.() === 'json' ?  LoggingFormat.JSON : LoggingFormat.TEXT,
      ...fw24.getConfig().functionProps as NodejsFunctionProps,
    };

    //  'Error'  To use ApplicationLogLevel and/or SystemLogLevel you must set LoggingFormat to 'JSON', got 'Text'.
    if(defaultProps.loggingFormat === LoggingFormat.JSON){
      defaultProps = {
        ...defaultProps,
        applicationLogLevelV2: formatLogLevel( process.env.LOG_LEVEL)
      };
    }

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
    
    // resolve layer names to actual layer arns
    const layers = [ ...(defaultProps?.layers ?? []), ...(props.functionProps?.layers ?? [])] as Array<string | ILayerVersion>;
    const resolvedLayers = layers.map( layerName => {
      if(typeof layerName === 'string'){

        return LayerVersion.fromLayerVersionArn(this, `${id}-${layerName}-Layer`, fw24.get(layerName, 'layer') );
      }
      return layerName;
    })
    
    additionalProps.layers = [
      ...resolvedLayers,
      // Use fw24 layer
      LayerVersion.fromLayerVersionArn(this,  `${id}-Fw24CoreLayer`, fw24.get('fw24', 'layer'))
    ];

    additionalProps.bundling = {
      ...defaultProps.bundling,
      ...props.functionProps?.bundling,
      sourceMap: true,
      externalModules: [
        ...(defaultProps?.bundling?.externalModules ?? []),
        ...(props.functionProps?.bundling?.externalModules ?? []), 
        "@ten24group/fw24"
      ],
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
          envValue = fw24.get(fw24Key, prefix);
          this.logger?.debug(`:GET environment variable from fw24 scope : ${fw24Key} : ${envValue}`, id);
        }
        
        this.logger?.debug(`:SET environment variable : ${envKey} : ${envValue}`, id);
        
        addEnvironmentKeyValueForFunction({
          fn,
          key: envKey,
          value: envValue
        });
      }
    }

    // Attach policies to the function
    (props.policies ?? []).forEach( policy => {

      if(isImportedPolicy(policy) ){
        
        if( !policy.isOptional && !fw24.hasPolicy(policy.name, policy.prefix)){
          throw new Error(`Policy ${policy} not found in fw24 scope`);
        }

        policy = fw24.getPolicy(policy.name, policy.prefix) as PolicyStatementProps | PolicyStatement;
      }

      if(!(policy instanceof PolicyStatement)){
        policy = new PolicyStatement(policy);
      }

      fn.addToRolePolicy(policy as PolicyStatement);
      
    });

    // If we are using SES, then we need to add the email queue url to the environment
    if(props.allowSendEmail && fw24.emailProvider instanceof MailerConstruct){
      this.logger?.debug(":GET emailQueue Name from fw24 scope : ", fw24.get('emailQueue', 'queueName'), id);
      let emailQueue = fw24.getQueueByName('emailQueue');
      emailQueue.grantSendMessages(fn);
      addEnvironmentKeyValueForFunction({
        fn,
        key: `EMAIL_QUEUE_URL`,
        value: emailQueue.queueUrl
      });
    }

    // Logic for adding DynamoDB table access to the controller
    props.resourceAccess?.tables?.forEach( ( table: any ) => {
      let tableName = typeof table === 'string' ? table : table.name;
      
      // ensure the placeholder env keys are resolved from the fw24 scope
      tableName = fw24.tryResolveEnvKeyTemplate(tableName);

      const appQualifiedTableName = ensureNoSpecialChars(ensureSuffix(tableName, `table`));

      const access = typeof table === 'string' ? ['readwrite'] : table.access || ['readwrite'];
      // Get the DynamoDB table based on the controller config
      const tableInstance: TableV2 = fw24.getDynamoTable(appQualifiedTableName);
      
      // Add the table name to the lambda environment      
      addEnvironmentKeyValueForFunction({
        fn,
        key: `${appQualifiedTableName}`,
        value: tableInstance.tableName
      });

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
      let bucketName = typeof bucket === 'string' ? bucket : bucket.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      bucketName = fw24.tryResolveEnvKeyTemplate(bucketName);

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
      addEnvironmentKeyValueForFunction({
        fn,
        key: `bucket_${bucketName}`,
        value: bucketFullName
      });
      
    });

    props.resourceAccess?.queues?.forEach( ( queue: any ) => {
      let queueName = typeof queue === 'string' ? queue : queue.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      queueName = fw24.tryResolveEnvKeyTemplate(queueName);

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
      addEnvironmentKeyValueForFunction({
        fn,
        key: `${queueName}_topicArn`,
        value: queueInstance.queueUrl
      })
    });

    // Add SNS topic permission
    props.resourceAccess?.topics?.forEach( ( topic: any ) => {
      let topicName = typeof topic === 'string' ? topic : topic.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      topicName = fw24.tryResolveEnvKeyTemplate(topicName);

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
      addEnvironmentKeyValueForFunction({
        fn,
        key: `${topicName}_topicArn`,
        value: topicInstance.topicArn
      })
    });

    return fn;
  }
}

function addEnvironmentKeyValueForFunction( options: {
    fn: NodejsFunction, 
    key: string, 
    value: string,
    prefix ?: string,
    suffix ?: string, 
  }){

    const { fn, key, value, prefix = '', suffix = '' } = options;

    const envKey = ensureValidEnvKey(key, prefix, suffix);
    
    fn.addEnvironment(envKey, value);
  }
