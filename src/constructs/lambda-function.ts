import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement, type PolicyStatementProps } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture, LayerVersion, ApplicationLogLevel, LoggingFormat, ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { ITableV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { MailerConstruct } from "./mailer";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { createLogger, ILogger } from "../logging";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ensureNoSpecialChars, ensureSuffix, ensureValidEnvKey } from "../utils/keys";

export type TPolicyStatementOrProps = PolicyStatement | PolicyStatementProps;
export type TImportedPolicy = { name: string, isOptional?: boolean, prefix?: string };

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
  environmentVariables?: { [ key: string ]: string };

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

  processorArchitecture?: 'x86_64' | 'arm_64';

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
  topics?: Array<{
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
  switch (logLevel?.toUpperCase()) {
    case 'ERROR':
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

  readonly logger?: ILogger = createLogger('LambdaFunction');

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
      loggingFormat: process.env.LOG_FORMAT?.toLowerCase?.() === 'json' ? LoggingFormat.JSON : LoggingFormat.TEXT,
      ...fw24.getConfig().functionProps as NodejsFunctionProps,
    };

    //  'Error'  To use ApplicationLogLevel and/or SystemLogLevel you must set LoggingFormat to 'JSON', got 'Text'.
    if (defaultProps.loggingFormat === LoggingFormat.JSON) {
      defaultProps = {
        ...defaultProps,
        applicationLogLevelV2: formatLogLevel(process.env.LOG_LEVEL)
      };
    }

    // Create log group if not provided
    let logGroup = props.functionProps?.logGroup;
    if (!logGroup) {
      let logRetentionDays = props.logRetentionDays || fw24.getConfig().logRetentionDays || 30;
      logGroup = new LogGroup(this, `${id}-LogGroup`, {
        removalPolicy: props.logRemovalPolicy || fw24.getConfig().logRemovalPolicy || RemovalPolicy.RETAIN,
        retention: parseInt(logRetentionDays.toString()),
      });
    }

    let additionalProps: any = {
      entry: props.entry,
    }

    // collect the names of the layers provided in default config if any or else the global layers;
    const defaultLayers = defaultProps?.layers ?? Array.from(fw24.getGlobalLambdaLayerNames());

    // resolve layer names to actual layer arns
    const layers = [
      ...defaultLayers,
      // collect the names of the layers provided in function config if any;
      ...(props.functionProps?.layers ?? [])
    ] as Array<string | ILayerVersion>;

    // remove duplicates
    const deDupLayers = Array.from(new Set(layers));

    // map layers to actual layer objects
    const resolvedLayers = deDupLayers.map(layerName => {
      if (typeof layerName === 'string') {
        return LayerVersion.fromLayerVersionArn(this, `${id}-${layerName}-Layer`, fw24.getEnvironmentVariable(layerName + '_layerVersionArn', 'layer', scope));
      }

      return layerName;
    })

    // make sure to add fw24 layer
    additionalProps.layers = [
      ...resolvedLayers,
      LayerVersion.fromLayerVersionArn(this, `${id}-Fw24CoreLayer`, fw24.getEnvironmentVariable('fw24_layerVersionArn', 'layer', scope))
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
    if (props.functionTimeout) {
      additionalProps.timeout = Duration.seconds(props.functionTimeout);
    }

    if (props.processorArchitecture) {
      additionalProps.architecture = props.processorArchitecture === 'x86_64' ? Architecture.X86_64 : Architecture.ARM_64;
    }

    // Create the Node.js function
    const fn = new NodejsFunction(this, id, {
      ...defaultProps,
      ...props.functionProps,
      ...additionalProps,
    });

    props.environmentVariables = props.environmentVariables ?? {};

    // * EXPORT the log-level for our logger-instances in the runtime of this lambda
    // See '../logging/index.ts' for more info
    // NOTE: this log-level is different than the aws-log-level
    // aws requires the log format set to JSON to override log-level see `applicationLogLevelV2` in the code above

    // ensure the environment-variables for the lambda always have a log-level
    if (!('LOG_LEVEL' in props.environmentVariables)) {
      props.environmentVariables[ 'LOG_LEVEL' ] = fw24.getEnvironmentVariable('LOG_LEVEL');
    }

    // Set environment variables
    for (const [ key, value ] of Object.entries(props.environmentVariables)) {
      let envValue = value;
      let envKey = key;
      // If key is prefixed with fw24_, access environment variables from fw24 scope
      // keys can have shape like:
      // fw24_xxx (without scope)
      // fw24_AuthModule_xxx (with scope: AuthModule)
      // fw24_UserPool_AuthModule_userPoolId (with scope: UserPool_AuthModule)
      if (value?.startsWith('fw24_')) {
        // Remove fw24_ prefix
        const keyWithoutPrefix = value.replace('fw24_', '');
        const parts = keyWithoutPrefix.split('_');

        // Last part is always the environment variable name
        const envVarName = parts[ parts.length - 1 ];

        // Everything before the last part is the scope (if any)
        const scope = parts.length > 1 ? parts.slice(0, -1).join('_') : '';

        envValue = fw24.getEnvironmentVariable(envVarName, scope);
        this.logger?.debug(`Resolved fw24 environment variable: ${value} -> ${envValue}`, id);
      }

      this.logger?.debug(`:SET environment variable [${envKey} : ${envValue}]`, id);

      addEnvironmentKeyValueForFunction({
        fn,
        key: envKey,
        value: envValue
      });
    }

    // Attach policies to the function
    (props.policies ?? []).forEach(policy => {

      if (isImportedPolicy(policy)) {

        if (!policy.isOptional && !fw24.hasPolicy(policy.name, policy.prefix)) {
          throw new Error(`Policy ${policy} not found in fw24 scope`);
        }

        policy = fw24.getPolicy(policy.name, policy.prefix) as PolicyStatementProps | PolicyStatement;
      }

      if (!(policy instanceof PolicyStatement)) {
        policy = new PolicyStatement(policy);
      }

      fn.addToRolePolicy(policy as PolicyStatement);

    });

    // If we are using SES, then we need to add the email queue url to the environment
    if (props.allowSendEmail && fw24.emailProvider instanceof MailerConstruct) {
      const emailQueueName = fw24.getEnvironmentVariable('emailQueue_queueName', 'queue', scope);
      const emailQueue = Queue.fromQueueArn(this, `${id}-${emailQueueName}-queue`, fw24.getArn('sqs', emailQueueName));

      emailQueue.grantSendMessages(fn);
      addEnvironmentKeyValueForFunction({
        fn,
        key: `EMAIL_QUEUE_URL`,
        value: emailQueue.queueUrl
      });
    }

    // Add global environment variables to the function
    fw24.getGlobalEnvironmentVariables().forEach(envKey => {
      addEnvironmentKeyValueForFunction({
        fn,
        key: envKey,
        value: fw24.getEnvironmentVariable(envKey)
      });
    });
    
    // Logic for adding DynamoDB table access to the controller
    props.resourceAccess?.tables?.forEach((table: any) => {
      let tableName = typeof table === 'string' ? table : table.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      tableName = fw24.tryResolveEnvKeyTemplate(tableName);

      const appQualifiedTableName = ensureNoSpecialChars(ensureSuffix(tableName, `table`));

      const access = typeof table === 'string' ? [ 'readwrite' ] : table.access || [ 'readwrite' ];
      // Get the DynamoDB table based on the controller config
      const tableInstance: ITableV2 = TableV2.fromTableName(this, `${id}-${tableName}-table`, fw24.getEnvironmentVariable(appQualifiedTableName + '_tableName', 'table', scope));

      // Add the table name to the lambda environment      
      addEnvironmentKeyValueForFunction({
        fn,
        key: `${appQualifiedTableName}`,
        value: tableInstance.tableName
      });

      // Grant the lambda function read write access to the table
      access.forEach((accessType: string) => {
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
    props.resourceAccess?.buckets?.forEach((bucket: any) => {
      let bucketName = typeof bucket === 'string' ? bucket : bucket.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      bucketName = fw24.tryResolveEnvKeyTemplate(bucketName);

      const access = typeof bucket === 'string' ? [ 'readwrite' ] : bucket.access || [ 'readwrite' ];

      const bucketFullName = fw24.getUniqueName(bucketName);
      const bucketInstance: any = Bucket.fromBucketName(this, bucketName + id + '-bucket', bucketFullName);
      // Grant the lambda function access to the bucket
      access.forEach((accessType: string) => {
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

    // Logic for adding SQS queue access to the controller
    props.resourceAccess?.queues?.forEach((queue: any) => {
      let queueName = typeof queue === 'string' ? queue : queue.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      queueName = fw24.tryResolveEnvKeyTemplate(queueName);

      const access = typeof queue === 'string' ? [ 'send' ] : queue.access || [ 'send' ];

      const queueArn = fw24.getArn('sqs', fw24.getEnvironmentVariable(queueName + '_queueName', 'queue', scope));
      const queueInstance = Queue.fromQueueArn(this, queueName + id + '-queue', queueArn);
      // Grant the lambda function access to the queue
      access.forEach((accessType: string) => {
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
        key: `${queueName}_queueUrl`,
        value: queueInstance.queueUrl
      })
    });

    // Add SNS topic permission
    props.resourceAccess?.topics?.forEach((topic: any) => {
      let topicName = typeof topic === 'string' ? topic : topic.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      topicName = fw24.tryResolveEnvKeyTemplate(topicName);

      const access = typeof topic === 'string' ? [ 'publish' ] : topic.access || [ 'publish' ];

      const topicArn = fw24.getArn('sns', fw24.getEnvironmentVariable(topicName + '_topicName', 'topic', scope));
      const topicInstance = Topic.fromTopicArn(this, topicName + id + '-topic', topicArn);
      // Grant the lambda function access to the topic
      access.forEach((accessType: string) => {
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

function addEnvironmentKeyValueForFunction(options: {
  fn: NodejsFunction,
  key: string,
  value: string,
  prefix?: string,
  suffix?: string,
}) {

  const { fn, key, value, prefix = '', suffix = '' } = options;

  const envKey = ensureValidEnvKey(key, prefix, suffix);

  fn.addEnvironment(envKey, value);
}
