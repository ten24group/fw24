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
import * as ENV_KEYS from "../const/env";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ensureNoSpecialChars, ensureSuffix, ensureValidEnvKey } from "../utils/keys";
import { merge } from "../utils";

type ResourceAccessItem = string | { name: string; access?: string[] };
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
 * Represents a resource access entry - either a simple string name or an object with name and access permissions.
 */
export type TResourceAccessEntry = string | { name: string; access?: string[] };

/**
 * Represents the access permissions for various resources that can be accessed by a function.
 */
export interface IFunctionResourceAccess {
  /**
   * Access permissions for tables.
   * Each table can be a string (name only, defaults to readwrite) or an object with name and access permissions.
   * The access permissions can be 'read', 'write', or 'readwrite'.
   * If no access permissions are specified, the default is 'readwrite'.
   *
   * @example
   * tables: ['users-table', { name: 'orders-table', access: ['read'] }]
   */
  tables?: TResourceAccessEntry[];

  /**
   * Access permissions for buckets.
   * Each bucket can be a string (name only, defaults to readwrite) or an object with name and access permissions.
   * The access permissions can be 'read', 'write', or 'readwrite'.
   * If no access permissions are specified, the default is 'readwrite'.
   *
   * @example
   * buckets: ['assets-bucket', { name: 'logs-bucket', access: ['write'] }]
   */
  buckets?: TResourceAccessEntry[];

  /**
   * Access permissions for topics.
   * Each topic can be a string (name only, defaults to publish) or an object with name and access permissions.
   * The access permissions can be 'publish'.
   * If no access permissions are specified, the default is 'publish'.
   *
   * @example
   * topics: ['events-topic', { name: 'notifications-topic', access: ['publish'] }]
   */
  topics?: TResourceAccessEntry[];

  /**
   * Access permissions for queues.
   * Each queue can be a string (name only, defaults to send) or an object with name and access permissions.
   * The access permissions can be 'send', 'receive', or 'delete'.
   * If no access permissions are specified, the default is 'send'.
   *
   * @example
   * queues: ['notifications-queue', { name: 'processing-queue', access: ['send', 'receive'] }]
   */
  queues?: TResourceAccessEntry[];
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
 *     runtime: Runtime.NODEJS_22_X,
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
      runtime: Runtime.NODEJS_22_X,
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

    const additionalProps: Record<string, any> = {
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

    // Ensure fw24 layer is included (if not already in the list)
    if (!deDupLayers.includes('fw24')) {
      deDupLayers.push('fw24');
    }

    // map layers to actual layer objects
    const resolvedLayers = deDupLayers.map(layerName => {
      if (typeof layerName === 'string') {
        return LayerVersion.fromLayerVersionArn(this, `${id}-${layerName}-Layer`, fw24.getEnvironmentVariable(layerName + '_layerVersionArn', 'layer', scope));
      }

      return layerName;
    })

    additionalProps.layers = resolvedLayers;

    additionalProps.bundling = merge([
      defaultProps.bundling ?? {},
      props.functionProps?.bundling ?? {},
      {
        sourceMap: true,
        externalModules: [
          ...(defaultProps?.bundling?.externalModules ?? []),
          ...(props.functionProps?.bundling?.externalModules ?? []),
          "@ten24group/fw24"
        ],
      }
    ])!;
    additionalProps.logGroup = logGroup;
    if (props.functionTimeout) {
      additionalProps.timeout = Duration.seconds(props.functionTimeout);
    }

    if (props.processorArchitecture) {
      additionalProps.architecture = props.processorArchitecture === 'x86_64' ? Architecture.X86_64 : Architecture.ARM_64;
    }

    // Create the Node.js function
    const fn = new NodejsFunction(this, id, merge([
      defaultProps,
      props.functionProps ?? {},
      additionalProps
    ])!);

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
      if (value && value.startsWith('fw24_')) {
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

    // Add global environment variables to the function
    fw24.getGlobalEnvironmentVariables().forEach(envKey => {
      this.logger?.debug(`Adding global environment variable: ${envKey}`, id);
      addEnvironmentKeyValueForFunction({
        fn,
        key: envKey,
        value: fw24.getEnvironmentVariable(envKey)
      });
    });

    // Auto-set ENTRY_PACKAGES for ALL Lambdas (ensures DI initialization)
    // Only set if not already configured in props or global env vars
    const globalEnvKeys = fw24.getGlobalEnvironmentVariables();
    if (
      !(ENV_KEYS.ENTRY_PACKAGES in props.environmentVariables)
      &&
      !globalEnvKeys.includes(ENV_KEYS.ENTRY_PACKAGES)
    ) {
      const entryPackages = fw24.getLambdaEntryPackages();
      if (entryPackages.length > 0) {
        // Resolve env key templates (e.g., env:layerImportPath:di -> /opt/nodejs/node_modules/di/index.js)
        const resolvedPackages = entryPackages.map(pkg => fw24.tryResolveEnvKeyTemplate(pkg));
        const entryPackagesValue = resolvedPackages.join(',');
        this.logger?.debug(`Auto-setting ENTRY_PACKAGES: ${entryPackagesValue}`, id);
        addEnvironmentKeyValueForFunction({
          fn,
          key: ENV_KEYS.ENTRY_PACKAGES,
          value: entryPackagesValue
        });
      }
    }

    // Add global policies to the function
    fw24.getGlobalPolicies().forEach(policy => {
      addPolicyToFunction({
        fn,
        fw24,
        policy
      });
    });

    // Attach policies to the function
    (props.policies ?? []).forEach(policy => {
      addPolicyToFunction({
        fn,
        fw24,
        policy
      });
    });

    // Merge global resource access with per-function resource access
    const globalResourceAccess = fw24.getGlobalResourceAccess();
    const mergedResourceAccess = mergeResourceAccess(globalResourceAccess, props.resourceAccess);

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

    // Logic for adding DynamoDB table access to the controller
    mergedResourceAccess?.tables?.forEach((table: ResourceAccessItem) => {
      let tableName = typeof table === 'string' ? table : table.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      tableName = fw24.tryResolveEnvKeyTemplate(tableName);

      const appQualifiedTableName = ensureNoSpecialChars(ensureSuffix(tableName, `table`));

      const access = typeof table === 'string' ? [ 'readwrite' ] : table.access || [ 'readwrite' ];
      // Get the DynamoDB table based on the controller config
      const tableInstance: ITableV2 = TableV2.fromTableAttributes(this, `${id}-${tableName}-table`, {
        tableName: fw24.getEnvironmentVariable(appQualifiedTableName + '_tableName', 'table', scope),
        grantIndexPermissions: true,
      });

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
    mergedResourceAccess?.buckets?.forEach((bucket: ResourceAccessItem) => {
      let bucketName = typeof bucket === 'string' ? bucket : bucket.name;

      // ensure the placeholder env keys are resolved from the fw24 scope
      bucketName = fw24.tryResolveEnvKeyTemplate(bucketName);

      const access = typeof bucket === 'string' ? [ 'readwrite' ] : bucket.access || [ 'readwrite' ];

      const bucketFullName = fw24.getUniqueName(bucketName);
      const bucketInstance = Bucket.fromBucketName(this, bucketName + id + '-bucket', bucketFullName);
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
    mergedResourceAccess?.queues?.forEach((queue: ResourceAccessItem) => {
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
    mergedResourceAccess?.topics?.forEach((topic: ResourceAccessItem) => {
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

function addPolicyToFunction(options: {
  fn: NodejsFunction,
  fw24: Fw24,
  policy: TPolicyStatementOrProps | TImportedPolicy,
}) {
  const { fn, fw24, policy } = options;

  let resolvedPolicy: TPolicyStatementOrProps | TImportedPolicy = policy;

  if (isImportedPolicy(policy)) {
    const policyExists = fw24.hasPolicy(policy.name, policy.prefix);

    if (!policyExists) {
      if (policy.isOptional) {
        // Skip optional policies that don't exist
        return;
      }
      throw new Error(`Policy ${policy.name} not found in fw24 scope`);
    }

    resolvedPolicy = fw24.getPolicy(policy.name, policy.prefix) as PolicyStatementProps | PolicyStatement;
  }

  if (!(resolvedPolicy instanceof PolicyStatement)) {
    resolvedPolicy = new PolicyStatement(resolvedPolicy as PolicyStatementProps);
  }

  fn.addToRolePolicy(resolvedPolicy as PolicyStatement);

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

/**
 * Merges global resource access with per-function resource access.
 * Per-function resource access takes precedence (comes after global in the merged array).
 * Deduplication is handled at the resource level - if the same resource appears in both
 * global and per-function access, both entries are kept (allowing for different access levels).
 *
 * @param globalAccess - Global resource access configuration from fw24
 * @param functionAccess - Per-function resource access configuration
 * @returns Merged resource access configuration
 */
function mergeResourceAccess(
  globalAccess: IFunctionResourceAccess | undefined,
  functionAccess: IFunctionResourceAccess | undefined
): IFunctionResourceAccess {
  if (!globalAccess && !functionAccess) {
    return {};
  }

  if (!globalAccess) {
    return functionAccess!;
  }

  if (!functionAccess) {
    return globalAccess;
  }

  return {
    tables: deduplicateResourceArray([
      ...(globalAccess.tables || []),
      ...(functionAccess.tables || [])
    ]),
    buckets: deduplicateResourceArray([
      ...(globalAccess.buckets || []),
      ...(functionAccess.buckets || [])
    ]),
    queues: deduplicateResourceArray([
      ...(globalAccess.queues || []),
      ...(functionAccess.queues || [])
    ]),
    topics: deduplicateResourceArray([
      ...(globalAccess.topics || []),
      ...(functionAccess.topics || [])
    ])
  };
}

/**
 * Deduplicates resource array entries by name, preferring entries with explicit access over implicit.
 * When the same resource appears multiple times:
 * - If both have explicit access arrays, merge the access arrays
 * - If one has explicit access and one doesn't, use the explicit one
 * - If both are strings (implicit readwrite), keep only one
 *
 * @param resources - Array of resource entries (string or { name, access? })
 * @returns Deduplicated array
 */
function deduplicateResourceArray<T extends string | { name: string; access?: string[] }>(
  resources: T[]
): T[] {
  if (!resources || resources.length === 0) {
    return [];
  }

  const resourceMap = new Map<string, T>();

  for (const resource of resources) {
    const name = typeof resource === 'string' ? resource : resource.name;
    const existingResource = resourceMap.get(name);

    if (!existingResource) {
      resourceMap.set(name, resource);
    } else {
      // Merge logic: prefer explicit access over implicit
      const existingAccess = typeof existingResource === 'string' ? undefined : existingResource.access;
      const newAccess = typeof resource === 'string' ? undefined : resource.access;

      if (existingAccess && newAccess) {
        // Both have explicit access - merge and deduplicate
        const mergedAccess = Array.from(new Set([ ...existingAccess, ...newAccess ]));
        resourceMap.set(name, { name, access: mergedAccess } as T);
      } else if (newAccess) {
        // New has explicit access, existing doesn't - prefer new
        resourceMap.set(name, resource);
      }
      // else: existing has explicit access or both implicit - keep existing
    }
  }

  return Array.from(resourceMap.values());
}
