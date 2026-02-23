"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaFunction = void 0;
exports.isImportedPolicy = isImportedPolicy;
exports.formatLogLevel = formatLogLevel;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const fw24_1 = require("../core/fw24");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const mailer_1 = require("./mailer");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const aws_sns_1 = require("aws-cdk-lib/aws-sns");
const logging_1 = require("../logging");
const ENV_KEYS = __importStar(require("../const/env"));
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const keys_1 = require("../utils/keys");
const utils_1 = require("../utils");
function isImportedPolicy(policy) {
    return policy.name !== undefined;
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
function formatLogLevel(logLevel) {
    switch (logLevel?.toUpperCase()) {
        case 'ERROR':
            return aws_lambda_1.ApplicationLogLevel.ERROR;
        case 'WARN':
            return aws_lambda_1.ApplicationLogLevel.WARN;
        case 'DEBUG':
            return aws_lambda_1.ApplicationLogLevel.DEBUG;
        case 'TRACE':
            return aws_lambda_1.ApplicationLogLevel.TRACE;
        case 'FATAL':
            return aws_lambda_1.ApplicationLogLevel.FATAL;
        case 'INFO':
        default:
            return aws_lambda_1.ApplicationLogLevel.INFO;
    }
}
class LambdaFunction extends constructs_1.Construct {
    logger = (0, logging_1.createLogger)('LambdaFunction');
    /**
     * Constructs a new instance of the LambdaFunction class.
     * @param scope - The parent construct.
     * @param id - The ID of the construct.
     * @param props - The Lambda function properties.
     * @returns The Lambda function.
     */
    constructor(scope, id, props) {
        super(scope, id);
        const fw24 = fw24_1.Fw24.getInstance();
        // Default properties for the Node.js function
        let defaultProps = {
            runtime: aws_lambda_1.Runtime.NODEJS_22_X,
            architecture: aws_lambda_1.Architecture.ARM_64,
            handler: "handler",
            timeout: aws_cdk_lib_1.Duration.seconds(5),
            memorySize: 128,
            loggingFormat: process.env.LOG_FORMAT?.toLowerCase?.() === 'json' ? aws_lambda_1.LoggingFormat.JSON : aws_lambda_1.LoggingFormat.TEXT,
            ...fw24.getConfig().functionProps,
        };
        //  'Error'  To use ApplicationLogLevel and/or SystemLogLevel you must set LoggingFormat to 'JSON', got 'Text'.
        if (defaultProps.loggingFormat === aws_lambda_1.LoggingFormat.JSON) {
            defaultProps = {
                ...defaultProps,
                applicationLogLevelV2: formatLogLevel(process.env.LOG_LEVEL)
            };
        }
        // Create log group if not provided
        let logGroup = props.functionProps?.logGroup;
        if (!logGroup) {
            let logRetentionDays = props.logRetentionDays || fw24.getConfig().logRetentionDays || 30;
            logGroup = new aws_logs_1.LogGroup(this, `${id}-LogGroup`, {
                removalPolicy: props.logRemovalPolicy || fw24.getConfig().logRemovalPolicy || aws_cdk_lib_1.RemovalPolicy.RETAIN,
                retention: parseInt(logRetentionDays.toString()),
            });
        }
        const additionalProps = {
            entry: props.entry,
        };
        // collect the names of the layers provided in default config if any or else the global layers;
        const defaultLayers = defaultProps?.layers ?? Array.from(fw24.getGlobalLambdaLayerNames());
        // resolve layer names to actual layer arns
        const layers = [
            ...defaultLayers,
            // collect the names of the layers provided in function config if any;
            ...(props.functionProps?.layers ?? [])
        ];
        // remove duplicates
        const deDupLayers = Array.from(new Set(layers));
        // Ensure fw24 layer is included (if not already in the list)
        if (!deDupLayers.includes('fw24')) {
            deDupLayers.push('fw24');
        }
        // map layers to actual layer objects
        const resolvedLayers = deDupLayers.map(layerName => {
            if (typeof layerName === 'string') {
                return aws_lambda_1.LayerVersion.fromLayerVersionArn(this, `${id}-${layerName}-Layer`, fw24.getEnvironmentVariable(layerName + '_layerVersionArn', 'layer', scope));
            }
            return layerName;
        });
        additionalProps.layers = resolvedLayers;
        additionalProps.bundling = (0, utils_1.merge)([
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
        ]);
        additionalProps.logGroup = logGroup;
        if (props.functionTimeout) {
            additionalProps.timeout = aws_cdk_lib_1.Duration.seconds(props.functionTimeout);
        }
        if (props.processorArchitecture) {
            additionalProps.architecture = props.processorArchitecture === 'x86_64' ? aws_lambda_1.Architecture.X86_64 : aws_lambda_1.Architecture.ARM_64;
        }
        // Create the Node.js function
        const fn = new aws_lambda_nodejs_1.NodejsFunction(this, id, (0, utils_1.merge)([
            defaultProps,
            props.functionProps ?? {},
            additionalProps
        ]));
        props.environmentVariables = props.environmentVariables ?? {};
        // * EXPORT the log-level for our logger-instances in the runtime of this lambda
        // See '../logging/index.ts' for more info
        // NOTE: this log-level is different than the aws-log-level
        // aws requires the log format set to JSON to override log-level see `applicationLogLevelV2` in the code above
        // ensure the environment-variables for the lambda always have a log-level
        if (!('LOG_LEVEL' in props.environmentVariables)) {
            props.environmentVariables['LOG_LEVEL'] = fw24.getEnvironmentVariable('LOG_LEVEL');
        }
        // Set environment variables
        for (const [key, value] of Object.entries(props.environmentVariables)) {
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
                const envVarName = parts[parts.length - 1];
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
        if (!(ENV_KEYS.ENTRY_PACKAGES in props.environmentVariables)
            &&
                !globalEnvKeys.includes(ENV_KEYS.ENTRY_PACKAGES)) {
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
        if (props.allowSendEmail && fw24.emailProvider instanceof mailer_1.MailerConstruct) {
            const emailQueueName = fw24.getEnvironmentVariable('emailQueue_queueName', 'queue', scope);
            const emailQueue = aws_sqs_1.Queue.fromQueueArn(this, `${id}-${emailQueueName}-queue`, fw24.getArn('sqs', emailQueueName));
            emailQueue.grantSendMessages(fn);
            addEnvironmentKeyValueForFunction({
                fn,
                key: `EMAIL_QUEUE_URL`,
                value: emailQueue.queueUrl
            });
        }
        // Logic for adding DynamoDB table access to the controller
        mergedResourceAccess?.tables?.forEach((table) => {
            let tableName = typeof table === 'string' ? table : table.name;
            // ensure the placeholder env keys are resolved from the fw24 scope
            tableName = fw24.tryResolveEnvKeyTemplate(tableName);
            const appQualifiedTableName = (0, keys_1.ensureNoSpecialChars)((0, keys_1.ensureSuffix)(tableName, `table`));
            const access = typeof table === 'string' ? ['readwrite'] : table.access || ['readwrite'];
            // Get the DynamoDB table based on the controller config
            const tableInstance = aws_dynamodb_1.TableV2.fromTableAttributes(this, `${id}-${tableName}-table`, {
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
            access.forEach((accessType) => {
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
        mergedResourceAccess?.buckets?.forEach((bucket) => {
            let bucketName = typeof bucket === 'string' ? bucket : bucket.name;
            // ensure the placeholder env keys are resolved from the fw24 scope
            bucketName = fw24.tryResolveEnvKeyTemplate(bucketName);
            const access = typeof bucket === 'string' ? ['readwrite'] : bucket.access || ['readwrite'];
            const bucketFullName = fw24.getUniqueName(bucketName);
            const bucketInstance = aws_s3_1.Bucket.fromBucketName(this, bucketName + id + '-bucket', bucketFullName);
            // Grant the lambda function access to the bucket
            access.forEach((accessType) => {
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
        mergedResourceAccess?.queues?.forEach((queue) => {
            let queueName = typeof queue === 'string' ? queue : queue.name;
            // ensure the placeholder env keys are resolved from the fw24 scope
            queueName = fw24.tryResolveEnvKeyTemplate(queueName);
            const access = typeof queue === 'string' ? ['send'] : queue.access || ['send'];
            const queueArn = fw24.getArn('sqs', fw24.getEnvironmentVariable(queueName + '_queueName', 'queue', scope));
            const queueInstance = aws_sqs_1.Queue.fromQueueArn(this, queueName + id + '-queue', queueArn);
            // Grant the lambda function access to the queue
            access.forEach((accessType) => {
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
            });
        });
        // Add SNS topic permission
        mergedResourceAccess?.topics?.forEach((topic) => {
            let topicName = typeof topic === 'string' ? topic : topic.name;
            // ensure the placeholder env keys are resolved from the fw24 scope
            topicName = fw24.tryResolveEnvKeyTemplate(topicName);
            const access = typeof topic === 'string' ? ['publish'] : topic.access || ['publish'];
            const topicArn = fw24.getArn('sns', fw24.getEnvironmentVariable(topicName + '_topicName', 'topic', scope));
            const topicInstance = aws_sns_1.Topic.fromTopicArn(this, topicName + id + '-topic', topicArn);
            // Grant the lambda function access to the topic
            access.forEach((accessType) => {
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
            });
        });
        // Register with simulator if in simulation mode
        const resolvedEnv = {};
        const fnEnv = fn.environment || {};
        for (const [key, config] of Object.entries(fnEnv)) {
            resolvedEnv[key] = config.value;
        }
        fw24.registerSimulatedLambda(id, {
            entry: props.entry,
            handlerClassName: props.handlerClassName || 'handler',
            environment: resolvedEnv,
            // We can also store policies if needed for IAM simulation
            policies: props.policies
        });
        return fn;
    }
}
exports.LambdaFunction = LambdaFunction;
function addPolicyToFunction(options) {
    const { fn, fw24, policy } = options;
    let resolvedPolicy = policy;
    if (isImportedPolicy(policy)) {
        const policyExists = fw24.hasPolicy(policy.name, policy.prefix);
        if (!policyExists) {
            if (policy.isOptional) {
                // Skip optional policies that don't exist
                return;
            }
            throw new Error(`Policy ${policy.name} not found in fw24 scope`);
        }
        resolvedPolicy = fw24.getPolicy(policy.name, policy.prefix);
    }
    if (!(resolvedPolicy instanceof aws_iam_1.PolicyStatement)) {
        resolvedPolicy = new aws_iam_1.PolicyStatement(resolvedPolicy);
    }
    fn.addToRolePolicy(resolvedPolicy);
}
function addEnvironmentKeyValueForFunction(options) {
    const { fn, key, value, prefix = '', suffix = '' } = options;
    const envKey = (0, keys_1.ensureValidEnvKey)(key, prefix, suffix);
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
function mergeResourceAccess(globalAccess, functionAccess) {
    if (!globalAccess && !functionAccess) {
        return {};
    }
    if (!globalAccess) {
        return functionAccess;
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
function deduplicateResourceArray(resources) {
    if (!resources || resources.length === 0) {
        return [];
    }
    const resourceMap = new Map();
    for (const resource of resources) {
        const name = typeof resource === 'string' ? resource : resource.name;
        const existingResource = resourceMap.get(name);
        if (!existingResource) {
            resourceMap.set(name, resource);
        }
        else {
            // Merge logic: prefer explicit access over implicit
            const existingAccess = typeof existingResource === 'string' ? undefined : existingResource.access;
            const newAccess = typeof resource === 'string' ? undefined : resource.access;
            if (existingAccess && newAccess) {
                // Both have explicit access - merge and deduplicate
                const mergedAccess = Array.from(new Set([...existingAccess, ...newAccess]));
                resourceMap.set(name, { name, access: mergedAccess });
            }
            else if (newAccess) {
                // New has explicit access, existing doesn't - prefer new
                resourceMap.set(name, resource);
            }
            // else: existing has explicit access or both implicit - keep existing
        }
    }
    return Array.from(resourceMap.values());
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQXFCQSw0Q0FFQztBQXNLRCx3Q0FnQkM7QUE3TUQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsdURBQXlDO0FBQ3pDLG1EQUErRDtBQUMvRCx3Q0FBc0Y7QUFDdEYsb0NBQWlDO0FBTWpDLFNBQWdCLGdCQUFnQixDQUFDLE1BQWlEO0lBQ2hGLE9BQVEsTUFBMEIsQ0FBQyxJQUFJLEtBQUssU0FBUyxDQUFDO0FBQ3hELENBQUM7QUFxSEQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBK0NHO0FBRUgsU0FBZ0IsY0FBYyxDQUFDLFFBQWlCO0lBQzlDLFFBQVEsUUFBUSxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUM7UUFDaEMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxNQUFNO1lBQ1QsT0FBTyxnQ0FBbUIsQ0FBQyxJQUFJLENBQUM7UUFDbEMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxNQUFNLENBQUM7UUFDWjtZQUNFLE9BQU8sZ0NBQW1CLENB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cnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgUG9saWN5U3RhdGVtZW50LCB0eXBlIFBvbGljeVN0YXRlbWVudFByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IFJ1bnRpbWUsIEFyY2hpdGVjdHVyZSwgTGF5ZXJWZXJzaW9uLCBBcHBsaWNhdGlvbkxvZ0xldmVsLCBMb2dnaW5nRm9ybWF0LCBJTGF5ZXJWZXJzaW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCB7IElUYWJsZVYyLCBUYWJsZVYyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBCdWNrZXQgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IFRvcGljIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgKiBhcyBFTlZfS0VZUyBmcm9tIFwiLi4vY29uc3QvZW52XCI7XG5pbXBvcnQgeyBMb2dHcm91cCwgUmV0ZW50aW9uRGF5cyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgZW5zdXJlTm9TcGVjaWFsQ2hhcnMsIGVuc3VyZVN1ZmZpeCwgZW5zdXJlVmFsaWRFbnZLZXkgfSBmcm9tIFwiLi4vdXRpbHMva2V5c1wiO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tIFwiLi4vdXRpbHNcIjtcblxudHlwZSBSZXNvdXJjZUFjY2Vzc0l0ZW0gPSBzdHJpbmcgfCB7IG5hbWU6IHN0cmluZzsgYWNjZXNzPzogc3RyaW5nW10gfTtcbmV4cG9ydCB0eXBlIFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzID0gUG9saWN5U3RhdGVtZW50IHwgUG9saWN5U3RhdGVtZW50UHJvcHM7XG5leHBvcnQgdHlwZSBUSW1wb3J0ZWRQb2xpY3kgPSB7IG5hbWU6IHN0cmluZywgaXNPcHRpb25hbD86IGJvb2xlYW4sIHByZWZpeD86IHN0cmluZyB9O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNJbXBvcnRlZFBvbGljeShwb2xpY3k6IFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzIHwgVEltcG9ydGVkUG9saWN5KTogcG9saWN5IGlzIFRJbXBvcnRlZFBvbGljeSB7XG4gIHJldHVybiAocG9saWN5IGFzIFRJbXBvcnRlZFBvbGljeSkubmFtZSAhPT0gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIHByb3BlcnRpZXMgZm9yIGEgTGFtYmRhIGZ1bmN0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYUZ1bmN0aW9uUHJvcHMge1xuICAvKipcbiAgICogVGhlIGVudHJ5IHBvaW50IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZW50cnk6IHN0cmluZztcblxuICAvKipcbiAgICogVGhlIHBvbGljaWVzIHRvIGF0dGFjaCB0byB0aGUgTGFtYmRhIGZ1bmN0aW9uJ3MgZXhlY3V0aW9uIHJvbGUuXG4gICAqL1xuICBwb2xpY2llcz86IEFycmF5PFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzIHwgVEltcG9ydGVkUG9saWN5PjtcblxuICAvKipcbiAgICogVGhlIGVudmlyb25tZW50IHZhcmlhYmxlcyB0byBzZXQgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBlbnZpcm9ubWVudFZhcmlhYmxlcz86IHsgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmcgfTtcblxuICAvKipcbiAgICogVGhlIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgcmVzb3VyY2VBY2Nlc3M/OiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcztcblxuICAvKipcbiAgICogSW5kaWNhdGVzIHdoZXRoZXIgdGhlIExhbWJkYSBmdW5jdGlvbiBpcyBhbGxvd2VkIHRvIHNlbmQgZW1haWxzLlxuICAgKi9cbiAgYWxsb3dTZW5kRW1haWw/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGRheXMgdG8gcmV0YWluIHRoZSBsb2dzIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgbG9nUmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG5cbiAgLyoqXG4gICAqIFRoZSByZW1vdmFsIHBvbGljeSBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbidzIGxvZ3MuXG4gICAqL1xuICBsb2dSZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcblxuICAvKipcbiAgICogVGhlIHRpbWVvdXQgZHVyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24gaW4gc2Vjb25kcy5cbiAgICogVXNlIHRoaXMgdGltZW91dCB0byBhdm9pZCBpbXBvcnRpbmcgdGhlIGR1cmF0aW9uIGNsYXNzIGZyb20gYXdzLWNkay1saWIuXG4gICAqL1xuICBmdW5jdGlvblRpbWVvdXQ/OiBudW1iZXI7XG5cbiAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlPzogJ3g4Nl82NCcgfCAnYXJtXzY0JztcblxuICAvKipcbiAgICogQWRkaXRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBmdW5jdGlvblByb3BzPzogT21pdDxOb2RlanNGdW5jdGlvblByb3BzLCAnbGF5ZXJzJz4gJiB7XG4gICAgcmVhZG9ubHkgbGF5ZXJzPzogQXJyYXk8SUxheWVyVmVyc2lvbiB8IHN0cmluZz47XG4gIH1cblxuICAvKipcbiAgICogT3B0aW9uYWwgbmFtZSBvZiB0aGUgY2xhc3MgdGhhdCBoYW5kbGVzIHRoZSByZXF1ZXN0LlxuICAgKi9cbiAgaGFuZGxlckNsYXNzTmFtZT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgcmVzb3VyY2UgYWNjZXNzIGVudHJ5IC0gZWl0aGVyIGEgc2ltcGxlIHN0cmluZyBuYW1lIG9yIGFuIG9iamVjdCB3aXRoIG5hbWUgYW5kIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAqL1xuZXhwb3J0IHR5cGUgVFJlc291cmNlQWNjZXNzRW50cnkgPSBzdHJpbmcgfCB7IG5hbWU6IHN0cmluZzsgYWNjZXNzPzogc3RyaW5nW10gfTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHZhcmlvdXMgcmVzb3VyY2VzIHRoYXQgY2FuIGJlIGFjY2Vzc2VkIGJ5IGEgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3Mge1xuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciB0YWJsZXMuXG4gICAqIEVhY2ggdGFibGUgY2FuIGJlIGEgc3RyaW5nIChuYW1lIG9ubHksIGRlZmF1bHRzIHRvIHJlYWR3cml0ZSkgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncmVhZCcsICd3cml0ZScsIG9yICdyZWFkd3JpdGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3JlYWR3cml0ZScuXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiB0YWJsZXM6IFsndXNlcnMtdGFibGUnLCB7IG5hbWU6ICdvcmRlcnMtdGFibGUnLCBhY2Nlc3M6IFsncmVhZCddIH1dXG4gICAqL1xuICB0YWJsZXM/OiBUUmVzb3VyY2VBY2Nlc3NFbnRyeVtdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIGJ1Y2tldHMuXG4gICAqIEVhY2ggYnVja2V0IGNhbiBiZSBhIHN0cmluZyAobmFtZSBvbmx5LCBkZWZhdWx0cyB0byByZWFkd3JpdGUpIG9yIGFuIG9iamVjdCB3aXRoIG5hbWUgYW5kIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3JlYWQnLCAnd3JpdGUnLCBvciAncmVhZHdyaXRlJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdyZWFkd3JpdGUnLlxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogYnVja2V0czogWydhc3NldHMtYnVja2V0JywgeyBuYW1lOiAnbG9ncy1idWNrZXQnLCBhY2Nlc3M6IFsnd3JpdGUnXSB9XVxuICAgKi9cbiAgYnVja2V0cz86IFRSZXNvdXJjZUFjY2Vzc0VudHJ5W107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdG9waWNzLlxuICAgKiBFYWNoIHRvcGljIGNhbiBiZSBhIHN0cmluZyAobmFtZSBvbmx5LCBkZWZhdWx0cyB0byBwdWJsaXNoKSBvciBhbiBvYmplY3Qgd2l0aCBuYW1lIGFuZCBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdwdWJsaXNoJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdwdWJsaXNoJy5cbiAgICogXG4gICAqIEBleGFtcGxlXG4gICAqIHRvcGljczogWydldmVudHMtdG9waWMnLCB7IG5hbWU6ICdub3RpZmljYXRpb25zLXRvcGljJywgYWNjZXNzOiBbJ3B1Ymxpc2gnXSB9XVxuICAgKi9cbiAgdG9waWNzPzogVFJlc291cmNlQWNjZXNzRW50cnlbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciBxdWV1ZXMuXG4gICAqIEVhY2ggcXVldWUgY2FuIGJlIGEgc3RyaW5nIChuYW1lIG9ubHksIGRlZmF1bHRzIHRvIHNlbmQpIG9yIGFuIG9iamVjdCB3aXRoIG5hbWUgYW5kIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3NlbmQnLCAncmVjZWl2ZScsIG9yICdkZWxldGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3NlbmQnLlxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogcXVldWVzOiBbJ25vdGlmaWNhdGlvbnMtcXVldWUnLCB7IG5hbWU6ICdwcm9jZXNzaW5nLXF1ZXVlJywgYWNjZXNzOiBbJ3NlbmQnLCAncmVjZWl2ZSddIH1dXG4gICAqL1xuICBxdWV1ZXM/OiBUUmVzb3VyY2VBY2Nlc3NFbnRyeVtdO1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhIExhbWJkYSBmdW5jdGlvbiBjb25zdHJ1Y3QuXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBDcmVhdGUgYSBMYW1iZGEgZnVuY3Rpb24gd2l0aCBjdXN0b20gcHJvcGVydGllc1xuICogY29uc3QgbGFtYmRhUHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHMgPSB7XG4gKiAgIGVudHJ5OiBcImluZGV4LmpzXCIsXG4gKiAgIHBvbGljaWVzOiBbe1xuICogICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAqICAgICAgICAgYWN0aW9uczogW1xuICogICAgICAgICAgXCJzMzpHZXRPYmplY3RcIlxuICogICAgICAgICBdLFxuICogICAgICAgICByZXNvdXJjZXM6IFtcImFybjphd3M6czM6OjpteS1idWNrZXQvKlwiXSxcbiAqICAgICB9LCBcbiAqICAgICB7XG4gKiAgICAgICBwb2xpY3k6IFwiYXV0aE1vZHVsZTpjcmVhdGUtdXNlci1hdXRoLXJlY29yZFwiLFxuICogICAgICAgaXNPcHRpb25hbDogdHJ1ZVxuICogICAgIH1cbiAqICAgXSxcbiAqICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAqICAgICBNWV9FTlZfVkFSOiBcIm15LXZhbHVlXCIsXG4gKiAgIH0sXG4gKiAgIHJlc291cmNlQWNjZXNzOiB7XG4gKiAgICAgdGFibGVzOiBbXG4gKiAgICAgICB7XG4gKiAgICAgICAgIG5hbWU6IFwibXktdGFibGVcIixcbiAqICAgICAgICAgYWNjZXNzOiBbXCJyZWFkXCIsIFwid3JpdGVcIl0sXG4gKiAgICAgICB9LFxuICogICAgIF0sXG4gKiAgICAgYnVja2V0czogW1wibXktYnVja2V0XCJdLFxuICogICAgIHRvcGljczogW1wibXktdG9waWNcIl0sXG4gKiAgICAgcXVldWVzOiBbXCJteS1xdWV1ZVwiXSxcbiAqICAgfSxcbiAqICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gKiAgIGxvZ1JldGVudGlvbkRheXM6IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gKiAgIGxvZ1JlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAqICAgZnVuY3Rpb25UaW1lb3V0OiAxMCxcbiAqICAgZnVuY3Rpb25Qcm9wczoge1xuICogICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gKiAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICogICB9LFxuICogfTtcbiAqXG4gKiBjb25zdCBsYW1iZGFGdW5jdGlvbiA9IG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgXCJNeUxhbWJkYUZ1bmN0aW9uXCIsIGxhbWJkYVByb3BzKTtcbiAqIFxuICogYGBgXG4gKi9cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdExvZ0xldmVsKGxvZ0xldmVsPzogc3RyaW5nKSB7XG4gIHN3aXRjaCAobG9nTGV2ZWw/LnRvVXBwZXJDYXNlKCkpIHtcbiAgICBjYXNlICdFUlJPUic6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5FUlJPUjtcbiAgICBjYXNlICdXQVJOJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLldBUk47XG4gICAgY2FzZSAnREVCVUcnOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuREVCVUc7XG4gICAgY2FzZSAnVFJBQ0UnOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuVFJBQ0U7XG4gICAgY2FzZSAnRkFUQUwnOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuRkFUQUw7XG4gICAgY2FzZSAnSU5GTyc6XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLklORk9cbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgTGFtYmRhRnVuY3Rpb24gZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuXG4gIHJlYWRvbmx5IGxvZ2dlcj86IElMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0xhbWJkYUZ1bmN0aW9uJyk7XG5cbiAgLyoqXG4gICAqIENvbnN0cnVjdHMgYSBuZXcgaW5zdGFuY2Ugb2YgdGhlIExhbWJkYUZ1bmN0aW9uIGNsYXNzLlxuICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgcGFyZW50IGNvbnN0cnVjdC5cbiAgICogQHBhcmFtIGlkIC0gVGhlIElEIG9mIHRoZSBjb25zdHJ1Y3QuXG4gICAqIEBwYXJhbSBwcm9wcyAtIFRoZSBMYW1iZGEgZnVuY3Rpb24gcHJvcGVydGllcy5cbiAgICogQHJldHVybnMgVGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICAvLyBEZWZhdWx0IHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIGZ1bmN0aW9uXG4gICAgbGV0IGRlZmF1bHRQcm9wczogTm9kZWpzRnVuY3Rpb25Qcm9wcyA9IHtcbiAgICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZS5BUk1fNjQsXG4gICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICBtZW1vcnlTaXplOiAxMjgsXG4gICAgICBsb2dnaW5nRm9ybWF0OiBwcm9jZXNzLmVudi5MT0dfRk9STUFUPy50b0xvd2VyQ2FzZT8uKCkgPT09ICdqc29uJyA/IExvZ2dpbmdGb3JtYXQuSlNPTiA6IExvZ2dpbmdGb3JtYXQuVEVYVCxcbiAgICAgIC4uLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25Qcm9wcyBhcyBOb2RlanNGdW5jdGlvblByb3BzLFxuICAgIH07XG5cbiAgICAvLyAgJ0Vycm9yJyAgVG8gdXNlIEFwcGxpY2F0aW9uTG9nTGV2ZWwgYW5kL29yIFN5c3RlbUxvZ0xldmVsIHlvdSBtdXN0IHNldCBMb2dnaW5nRm9ybWF0IHRvICdKU09OJywgZ290ICdUZXh0Jy5cbiAgICBpZiAoZGVmYXVsdFByb3BzLmxvZ2dpbmdGb3JtYXQgPT09IExvZ2dpbmdGb3JtYXQuSlNPTikge1xuICAgICAgZGVmYXVsdFByb3BzID0ge1xuICAgICAgICAuLi5kZWZhdWx0UHJvcHMsXG4gICAgICAgIGFwcGxpY2F0aW9uTG9nTGV2ZWxWMjogZm9ybWF0TG9nTGV2ZWwocHJvY2Vzcy5lbnYuTE9HX0xFVkVMKVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgbG9nIGdyb3VwIGlmIG5vdCBwcm92aWRlZFxuICAgIGxldCBsb2dHcm91cCA9IHByb3BzLmZ1bmN0aW9uUHJvcHM/LmxvZ0dyb3VwO1xuICAgIGlmICghbG9nR3JvdXApIHtcbiAgICAgIGxldCBsb2dSZXRlbnRpb25EYXlzID0gcHJvcHMubG9nUmV0ZW50aW9uRGF5cyB8fCBmdzI0LmdldENvbmZpZygpLmxvZ1JldGVudGlvbkRheXMgfHwgMzA7XG4gICAgICBsb2dHcm91cCA9IG5ldyBMb2dHcm91cCh0aGlzLCBgJHtpZH0tTG9nR3JvdXBgLCB7XG4gICAgICAgIHJlbW92YWxQb2xpY3k6IHByb3BzLmxvZ1JlbW92YWxQb2xpY3kgfHwgZncyNC5nZXRDb25maWcoKS5sb2dSZW1vdmFsUG9saWN5IHx8IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICByZXRlbnRpb246IHBhcnNlSW50KGxvZ1JldGVudGlvbkRheXMudG9TdHJpbmcoKSksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBhZGRpdGlvbmFsUHJvcHM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICBlbnRyeTogcHJvcHMuZW50cnksXG4gICAgfVxuXG4gICAgLy8gY29sbGVjdCB0aGUgbmFtZXMgb2YgdGhlIGxheWVycyBwcm92aWRlZCBpbiBkZWZhdWx0IGNvbmZpZyBpZiBhbnkgb3IgZWxzZSB0aGUgZ2xvYmFsIGxheWVycztcbiAgICBjb25zdCBkZWZhdWx0TGF5ZXJzID0gZGVmYXVsdFByb3BzPy5sYXllcnMgPz8gQXJyYXkuZnJvbShmdzI0LmdldEdsb2JhbExhbWJkYUxheWVyTmFtZXMoKSk7XG5cbiAgICAvLyByZXNvbHZlIGxheWVyIG5hbWVzIHRvIGFjdHVhbCBsYXllciBhcm5zXG4gICAgY29uc3QgbGF5ZXJzID0gW1xuICAgICAgLi4uZGVmYXVsdExheWVycyxcbiAgICAgIC8vIGNvbGxlY3QgdGhlIG5hbWVzIG9mIHRoZSBsYXllcnMgcHJvdmlkZWQgaW4gZnVuY3Rpb24gY29uZmlnIGlmIGFueTtcbiAgICAgIC4uLihwcm9wcy5mdW5jdGlvblByb3BzPy5sYXllcnMgPz8gW10pXG4gICAgXSBhcyBBcnJheTxzdHJpbmcgfCBJTGF5ZXJWZXJzaW9uPjtcblxuICAgIC8vIHJlbW92ZSBkdXBsaWNhdGVzXG4gICAgY29uc3QgZGVEdXBMYXllcnMgPSBBcnJheS5mcm9tKG5ldyBTZXQobGF5ZXJzKSk7XG5cbiAgICAvLyBFbnN1cmUgZncyNCBsYXllciBpcyBpbmNsdWRlZCAoaWYgbm90IGFscmVhZHkgaW4gdGhlIGxpc3QpXG4gICAgaWYgKCFkZUR1cExheWVycy5pbmNsdWRlcygnZncyNCcpKSB7XG4gICAgICBkZUR1cExheWVycy5wdXNoKCdmdzI0Jyk7XG4gICAgfVxuXG4gICAgLy8gbWFwIGxheWVycyB0byBhY3R1YWwgbGF5ZXIgb2JqZWN0c1xuICAgIGNvbnN0IHJlc29sdmVkTGF5ZXJzID0gZGVEdXBMYXllcnMubWFwKGxheWVyTmFtZSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGxheWVyTmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIExheWVyVmVyc2lvbi5mcm9tTGF5ZXJWZXJzaW9uQXJuKHRoaXMsIGAke2lkfS0ke2xheWVyTmFtZX0tTGF5ZXJgLCBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lICsgJ19sYXllclZlcnNpb25Bcm4nLCAnbGF5ZXInLCBzY29wZSkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGF5ZXJOYW1lO1xuICAgIH0pXG5cbiAgICBhZGRpdGlvbmFsUHJvcHMubGF5ZXJzID0gcmVzb2x2ZWRMYXllcnM7XG5cbiAgICBhZGRpdGlvbmFsUHJvcHMuYnVuZGxpbmcgPSBtZXJnZShbXG4gICAgICBkZWZhdWx0UHJvcHMuYnVuZGxpbmcgPz8ge30sXG4gICAgICBwcm9wcy5mdW5jdGlvblByb3BzPy5idW5kbGluZyA/PyB7fSxcbiAgICAgIHtcbiAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAgICAgICAgICAuLi4oZGVmYXVsdFByb3BzPy5idW5kbGluZz8uZXh0ZXJuYWxNb2R1bGVzID8/IFtdKSxcbiAgICAgICAgICAuLi4ocHJvcHMuZnVuY3Rpb25Qcm9wcz8uYnVuZGxpbmc/LmV4dGVybmFsTW9kdWxlcyA/PyBbXSksXG4gICAgICAgICAgXCJAdGVuMjRncm91cC9mdzI0XCJcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICBdKSE7XG4gICAgYWRkaXRpb25hbFByb3BzLmxvZ0dyb3VwID0gbG9nR3JvdXA7XG4gICAgaWYgKHByb3BzLmZ1bmN0aW9uVGltZW91dCkge1xuICAgICAgYWRkaXRpb25hbFByb3BzLnRpbWVvdXQgPSBEdXJhdGlvbi5zZWNvbmRzKHByb3BzLmZ1bmN0aW9uVGltZW91dCk7XG4gICAgfVxuXG4gICAgaWYgKHByb3BzLnByb2Nlc3NvckFyY2hpdGVjdHVyZSkge1xuICAgICAgYWRkaXRpb25hbFByb3BzLmFyY2hpdGVjdHVyZSA9IHByb3BzLnByb2Nlc3NvckFyY2hpdGVjdHVyZSA9PT0gJ3g4Nl82NCcgPyBBcmNoaXRlY3R1cmUuWDg2XzY0IDogQXJjaGl0ZWN0dXJlLkFSTV82NDtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgdGhlIE5vZGUuanMgZnVuY3Rpb25cbiAgICBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBpZCwgbWVyZ2UoW1xuICAgICAgZGVmYXVsdFByb3BzLFxuICAgICAgcHJvcHMuZnVuY3Rpb25Qcm9wcyA/PyB7fSxcbiAgICAgIGFkZGl0aW9uYWxQcm9wc1xuICAgIF0pISk7XG5cbiAgICBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcyA9IHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzID8/IHt9O1xuXG4gICAgLy8gKiBFWFBPUlQgdGhlIGxvZy1sZXZlbCBmb3Igb3VyIGxvZ2dlci1pbnN0YW5jZXMgaW4gdGhlIHJ1bnRpbWUgb2YgdGhpcyBsYW1iZGFcbiAgICAvLyBTZWUgJy4uL2xvZ2dpbmcvaW5kZXgudHMnIGZvciBtb3JlIGluZm9cbiAgICAvLyBOT1RFOiB0aGlzIGxvZy1sZXZlbCBpcyBkaWZmZXJlbnQgdGhhbiB0aGUgYXdzLWxvZy1sZXZlbFxuICAgIC8vIGF3cyByZXF1aXJlcyB0aGUgbG9nIGZvcm1hdCBzZXQgdG8gSlNPTiB0byBvdmVycmlkZSBsb2ctbGV2ZWwgc2VlIGBhcHBsaWNhdGlvbkxvZ0xldmVsVjJgIGluIHRoZSBjb2RlIGFib3ZlXG5cbiAgICAvLyBlbnN1cmUgdGhlIGVudmlyb25tZW50LXZhcmlhYmxlcyBmb3IgdGhlIGxhbWJkYSBhbHdheXMgaGF2ZSBhIGxvZy1sZXZlbFxuICAgIGlmICghKCdMT0dfTEVWRUwnIGluIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKSkge1xuICAgICAgcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXNbICdMT0dfTEVWRUwnIF0gPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpO1xuICAgIH1cblxuICAgIC8vIFNldCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKSkge1xuICAgICAgbGV0IGVudlZhbHVlID0gdmFsdWU7XG4gICAgICBsZXQgZW52S2V5ID0ga2V5O1xuICAgICAgLy8gSWYga2V5IGlzIHByZWZpeGVkIHdpdGggZncyNF8sIGFjY2VzcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBmdzI0IHNjb3BlXG4gICAgICAvLyBrZXlzIGNhbiBoYXZlIHNoYXBlIGxpa2U6XG4gICAgICAvLyBmdzI0X3h4eCAod2l0aG91dCBzY29wZSlcbiAgICAgIC8vIGZ3MjRfQXV0aE1vZHVsZV94eHggKHdpdGggc2NvcGU6IEF1dGhNb2R1bGUpXG4gICAgICAvLyBmdzI0X1VzZXJQb29sX0F1dGhNb2R1bGVfdXNlclBvb2xJZCAod2l0aCBzY29wZTogVXNlclBvb2xfQXV0aE1vZHVsZSlcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5zdGFydHNXaXRoKCdmdzI0XycpKSB7XG4gICAgICAgIC8vIFJlbW92ZSBmdzI0XyBwcmVmaXhcbiAgICAgICAgY29uc3Qga2V5V2l0aG91dFByZWZpeCA9IHZhbHVlLnJlcGxhY2UoJ2Z3MjRfJywgJycpO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IGtleVdpdGhvdXRQcmVmaXguc3BsaXQoJ18nKTtcblxuICAgICAgICAvLyBMYXN0IHBhcnQgaXMgYWx3YXlzIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBuYW1lXG4gICAgICAgIGNvbnN0IGVudlZhck5hbWUgPSBwYXJ0c1sgcGFydHMubGVuZ3RoIC0gMSBdO1xuXG4gICAgICAgIC8vIEV2ZXJ5dGhpbmcgYmVmb3JlIHRoZSBsYXN0IHBhcnQgaXMgdGhlIHNjb3BlIChpZiBhbnkpXG4gICAgICAgIGNvbnN0IHNjb3BlID0gcGFydHMubGVuZ3RoID4gMSA/IHBhcnRzLnNsaWNlKDAsIC0xKS5qb2luKCdfJykgOiAnJztcblxuICAgICAgICBlbnZWYWx1ZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZWYXJOYW1lLCBzY29wZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgUmVzb2x2ZWQgZncyNCBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHt2YWx1ZX0gLT4gJHtlbnZWYWx1ZX1gLCBpZCk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgOlNFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBbJHtlbnZLZXl9IDogJHtlbnZWYWx1ZX1dYCwgaWQpO1xuXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBlbnZLZXksXG4gICAgICAgIHZhbHVlOiBlbnZWYWx1ZVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQWRkIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gdGhlIGZ1bmN0aW9uXG4gICAgZncyNC5nZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpLmZvckVhY2goZW52S2V5ID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgQWRkaW5nIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHtlbnZLZXl9YCwgaWQpO1xuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogZW52S2V5LFxuICAgICAgICB2YWx1ZTogZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudktleSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQXV0by1zZXQgRU5UUllfUEFDS0FHRVMgZm9yIEFMTCBMYW1iZGFzIChlbnN1cmVzIERJIGluaXRpYWxpemF0aW9uKVxuICAgIC8vIE9ubHkgc2V0IGlmIG5vdCBhbHJlYWR5IGNvbmZpZ3VyZWQgaW4gcHJvcHMgb3IgZ2xvYmFsIGVudiB2YXJzXG4gICAgY29uc3QgZ2xvYmFsRW52S2V5cyA9IGZ3MjQuZ2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMoKTtcbiAgICBpZiAoXG4gICAgICAhKEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTIGluIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKVxuICAgICAgJiZcbiAgICAgICFnbG9iYWxFbnZLZXlzLmluY2x1ZGVzKEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTKVxuICAgICkge1xuICAgICAgY29uc3QgZW50cnlQYWNrYWdlcyA9IGZ3MjQuZ2V0TGFtYmRhRW50cnlQYWNrYWdlcygpO1xuICAgICAgaWYgKGVudHJ5UGFja2FnZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBSZXNvbHZlIGVudiBrZXkgdGVtcGxhdGVzIChlLmcuLCBlbnY6bGF5ZXJJbXBvcnRQYXRoOmRpIC0+IC9vcHQvbm9kZWpzL25vZGVfbW9kdWxlcy9kaS9pbmRleC5qcylcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRQYWNrYWdlcyA9IGVudHJ5UGFja2FnZXMubWFwKHBrZyA9PiBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShwa2cpKTtcbiAgICAgICAgY29uc3QgZW50cnlQYWNrYWdlc1ZhbHVlID0gcmVzb2x2ZWRQYWNrYWdlcy5qb2luKCcsJyk7XG4gICAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgQXV0by1zZXR0aW5nIEVOVFJZX1BBQ0tBR0VTOiAke2VudHJ5UGFja2FnZXNWYWx1ZX1gLCBpZCk7XG4gICAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgICAgZm4sXG4gICAgICAgICAga2V5OiBFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyxcbiAgICAgICAgICB2YWx1ZTogZW50cnlQYWNrYWdlc1ZhbHVlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCBnbG9iYWwgcG9saWNpZXMgdG8gdGhlIGZ1bmN0aW9uXG4gICAgZncyNC5nZXRHbG9iYWxQb2xpY2llcygpLmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgIGFkZFBvbGljeVRvRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAgZncyNCxcbiAgICAgICAgcG9saWN5XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEF0dGFjaCBwb2xpY2llcyB0byB0aGUgZnVuY3Rpb25cbiAgICAocHJvcHMucG9saWNpZXMgPz8gW10pLmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgIGFkZFBvbGljeVRvRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAgZncyNCxcbiAgICAgICAgcG9saWN5XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIE1lcmdlIGdsb2JhbCByZXNvdXJjZSBhY2Nlc3Mgd2l0aCBwZXItZnVuY3Rpb24gcmVzb3VyY2UgYWNjZXNzXG4gICAgY29uc3QgZ2xvYmFsUmVzb3VyY2VBY2Nlc3MgPSBmdzI0LmdldEdsb2JhbFJlc291cmNlQWNjZXNzKCk7XG4gICAgY29uc3QgbWVyZ2VkUmVzb3VyY2VBY2Nlc3MgPSBtZXJnZVJlc291cmNlQWNjZXNzKGdsb2JhbFJlc291cmNlQWNjZXNzLCBwcm9wcy5yZXNvdXJjZUFjY2Vzcyk7XG5cbiAgICAvLyBJZiB3ZSBhcmUgdXNpbmcgU0VTLCB0aGVuIHdlIG5lZWQgdG8gYWRkIHRoZSBlbWFpbCBxdWV1ZSB1cmwgdG8gdGhlIGVudmlyb25tZW50XG4gICAgaWYgKHByb3BzLmFsbG93U2VuZEVtYWlsICYmIGZ3MjQuZW1haWxQcm92aWRlciBpbnN0YW5jZW9mIE1haWxlckNvbnN0cnVjdCkge1xuICAgICAgY29uc3QgZW1haWxRdWV1ZU5hbWUgPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ2VtYWlsUXVldWVfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpO1xuICAgICAgY29uc3QgZW1haWxRdWV1ZSA9IFF1ZXVlLmZyb21RdWV1ZUFybih0aGlzLCBgJHtpZH0tJHtlbWFpbFF1ZXVlTmFtZX0tcXVldWVgLCBmdzI0LmdldEFybignc3FzJywgZW1haWxRdWV1ZU5hbWUpKTtcblxuICAgICAgZW1haWxRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhmbik7XG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgRU1BSUxfUVVFVUVfVVJMYCxcbiAgICAgICAgdmFsdWU6IGVtYWlsUXVldWUucXVldWVVcmxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIExvZ2ljIGZvciBhZGRpbmcgRHluYW1vREIgdGFibGUgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgbWVyZ2VkUmVzb3VyY2VBY2Nlc3M/LnRhYmxlcz8uZm9yRWFjaCgodGFibGU6IFJlc291cmNlQWNjZXNzSXRlbSkgPT4ge1xuICAgICAgbGV0IHRhYmxlTmFtZSA9IHR5cGVvZiB0YWJsZSA9PT0gJ3N0cmluZycgPyB0YWJsZSA6IHRhYmxlLm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIHRhYmxlTmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHRhYmxlTmFtZSk7XG5cbiAgICAgIGNvbnN0IGFwcFF1YWxpZmllZFRhYmxlTmFtZSA9IGVuc3VyZU5vU3BlY2lhbENoYXJzKGVuc3VyZVN1ZmZpeCh0YWJsZU5hbWUsIGB0YWJsZWApKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHRhYmxlID09PSAnc3RyaW5nJyA/IFsgJ3JlYWR3cml0ZScgXSA6IHRhYmxlLmFjY2VzcyB8fCBbICdyZWFkd3JpdGUnIF07XG4gICAgICAvLyBHZXQgdGhlIER5bmFtb0RCIHRhYmxlIGJhc2VkIG9uIHRoZSBjb250cm9sbGVyIGNvbmZpZ1xuICAgICAgY29uc3QgdGFibGVJbnN0YW5jZTogSVRhYmxlVjIgPSBUYWJsZVYyLmZyb21UYWJsZUF0dHJpYnV0ZXModGhpcywgYCR7aWR9LSR7dGFibGVOYW1lfS10YWJsZWAsIHtcbiAgICAgICAgdGFibGVOYW1lOiBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoYXBwUXVhbGlmaWVkVGFibGVOYW1lICsgJ190YWJsZU5hbWUnLCAndGFibGUnLCBzY29wZSksXG4gICAgICAgIGdyYW50SW5kZXhQZXJtaXNzaW9uczogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgdGhlIHRhYmxlIG5hbWUgdG8gdGhlIGxhbWJkYSBlbnZpcm9ubWVudCAgICAgIFxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYCR7YXBwUXVhbGlmaWVkVGFibGVOYW1lfWAsXG4gICAgICAgIHZhbHVlOiB0YWJsZUluc3RhbmNlLnRhYmxlTmFtZVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gcmVhZCB3cml0ZSBhY2Nlc3MgdG8gdGhlIHRhYmxlXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ3JlYWQnOlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFJlYWREYXRhKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ3dyaXRlJzpcbiAgICAgICAgICAgIHRhYmxlSW5zdGFuY2UuZ3JhbnRXcml0ZURhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHRhYmxlSW5zdGFuY2UuZ3JhbnRSZWFkV3JpdGVEYXRhKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIExvZ2ljIGZvciBhZGRpbmcgUzMgYnVja2V0IGFjY2VzcyB0byB0aGUgY29udHJvbGxlclxuICAgIG1lcmdlZFJlc291cmNlQWNjZXNzPy5idWNrZXRzPy5mb3JFYWNoKChidWNrZXQ6IFJlc291cmNlQWNjZXNzSXRlbSkgPT4ge1xuICAgICAgbGV0IGJ1Y2tldE5hbWUgPSB0eXBlb2YgYnVja2V0ID09PSAnc3RyaW5nJyA/IGJ1Y2tldCA6IGJ1Y2tldC5uYW1lO1xuXG4gICAgICAvLyBlbnN1cmUgdGhlIHBsYWNlaG9sZGVyIGVudiBrZXlzIGFyZSByZXNvbHZlZCBmcm9tIHRoZSBmdzI0IHNjb3BlXG4gICAgICBidWNrZXROYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUoYnVja2V0TmFtZSk7XG5cbiAgICAgIGNvbnN0IGFjY2VzcyA9IHR5cGVvZiBidWNrZXQgPT09ICdzdHJpbmcnID8gWyAncmVhZHdyaXRlJyBdIDogYnVja2V0LmFjY2VzcyB8fCBbICdyZWFkd3JpdGUnIF07XG5cbiAgICAgIGNvbnN0IGJ1Y2tldEZ1bGxOYW1lID0gZncyNC5nZXRVbmlxdWVOYW1lKGJ1Y2tldE5hbWUpO1xuICAgICAgY29uc3QgYnVja2V0SW5zdGFuY2UgPSBCdWNrZXQuZnJvbUJ1Y2tldE5hbWUodGhpcywgYnVja2V0TmFtZSArIGlkICsgJy1idWNrZXQnLCBidWNrZXRGdWxsTmFtZSk7XG4gICAgICAvLyBHcmFudCB0aGUgbGFtYmRhIGZ1bmN0aW9uIGFjY2VzcyB0byB0aGUgYnVja2V0XG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ3JlYWQnOlxuICAgICAgICAgICAgYnVja2V0SW5zdGFuY2UuZ3JhbnRSZWFkKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ3dyaXRlJzpcbiAgICAgICAgICAgIGJ1Y2tldEluc3RhbmNlLmdyYW50V3JpdGUoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIGJ1Y2tldEluc3RhbmNlLmdyYW50UmVhZFdyaXRlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgYnVja2V0IG5hbWVcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGBidWNrZXRfJHtidWNrZXROYW1lfWAsXG4gICAgICAgIHZhbHVlOiBidWNrZXRGdWxsTmFtZVxuICAgICAgfSk7XG5cbiAgICB9KTtcblxuICAgIC8vIExvZ2ljIGZvciBhZGRpbmcgU1FTIHF1ZXVlIGFjY2VzcyB0byB0aGUgY29udHJvbGxlclxuICAgIG1lcmdlZFJlc291cmNlQWNjZXNzPy5xdWV1ZXM/LmZvckVhY2goKHF1ZXVlOiBSZXNvdXJjZUFjY2Vzc0l0ZW0pID0+IHtcbiAgICAgIGxldCBxdWV1ZU5hbWUgPSB0eXBlb2YgcXVldWUgPT09ICdzdHJpbmcnID8gcXVldWUgOiBxdWV1ZS5uYW1lO1xuXG4gICAgICAvLyBlbnN1cmUgdGhlIHBsYWNlaG9sZGVyIGVudiBrZXlzIGFyZSByZXNvbHZlZCBmcm9tIHRoZSBmdzI0IHNjb3BlXG4gICAgICBxdWV1ZU5hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShxdWV1ZU5hbWUpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgcXVldWUgPT09ICdzdHJpbmcnID8gWyAnc2VuZCcgXSA6IHF1ZXVlLmFjY2VzcyB8fCBbICdzZW5kJyBdO1xuXG4gICAgICBjb25zdCBxdWV1ZUFybiA9IGZ3MjQuZ2V0QXJuKCdzcXMnLCBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUocXVldWVOYW1lICsgJ19xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSkpO1xuICAgICAgY29uc3QgcXVldWVJbnN0YW5jZSA9IFF1ZXVlLmZyb21RdWV1ZUFybih0aGlzLCBxdWV1ZU5hbWUgKyBpZCArICctcXVldWUnLCBxdWV1ZUFybik7XG4gICAgICAvLyBHcmFudCB0aGUgbGFtYmRhIGZ1bmN0aW9uIGFjY2VzcyB0byB0aGUgcXVldWVcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVjZWl2ZSc6XG4gICAgICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50Q29uc3VtZU1lc3NhZ2VzKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50UHVyZ2UoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRTZW5kTWVzc2FnZXMoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBxdWV1ZSB1cmxcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke3F1ZXVlTmFtZX1fcXVldWVVcmxgLFxuICAgICAgICB2YWx1ZTogcXVldWVJbnN0YW5jZS5xdWV1ZVVybFxuICAgICAgfSlcbiAgICB9KTtcblxuICAgIC8vIEFkZCBTTlMgdG9waWMgcGVybWlzc2lvblxuICAgIG1lcmdlZFJlc291cmNlQWNjZXNzPy50b3BpY3M/LmZvckVhY2goKHRvcGljOiBSZXNvdXJjZUFjY2Vzc0l0ZW0pID0+IHtcbiAgICAgIGxldCB0b3BpY05hbWUgPSB0eXBlb2YgdG9waWMgPT09ICdzdHJpbmcnID8gdG9waWMgOiB0b3BpYy5uYW1lO1xuXG4gICAgICAvLyBlbnN1cmUgdGhlIHBsYWNlaG9sZGVyIGVudiBrZXlzIGFyZSByZXNvbHZlZCBmcm9tIHRoZSBmdzI0IHNjb3BlXG4gICAgICB0b3BpY05hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSh0b3BpY05hbWUpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgdG9waWMgPT09ICdzdHJpbmcnID8gWyAncHVibGlzaCcgXSA6IHRvcGljLmFjY2VzcyB8fCBbICdwdWJsaXNoJyBdO1xuXG4gICAgICBjb25zdCB0b3BpY0FybiA9IGZ3MjQuZ2V0QXJuKCdzbnMnLCBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUodG9waWNOYW1lICsgJ190b3BpY05hbWUnLCAndG9waWMnLCBzY29wZSkpO1xuICAgICAgY29uc3QgdG9waWNJbnN0YW5jZSA9IFRvcGljLmZyb21Ub3BpY0Fybih0aGlzLCB0b3BpY05hbWUgKyBpZCArICctdG9waWMnLCB0b3BpY0Fybik7XG4gICAgICAvLyBHcmFudCB0aGUgbGFtYmRhIGZ1bmN0aW9uIGFjY2VzcyB0byB0aGUgdG9waWNcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHRvcGljSW5zdGFuY2UuZ3JhbnRQdWJsaXNoKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIHRvcGljIGFyblxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYCR7dG9waWNOYW1lfV90b3BpY0FybmAsXG4gICAgICAgIHZhbHVlOiB0b3BpY0luc3RhbmNlLnRvcGljQXJuXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgLy8gUmVnaXN0ZXIgd2l0aCBzaW11bGF0b3IgaWYgaW4gc2ltdWxhdGlvbiBtb2RlXG4gICAgY29uc3QgcmVzb2x2ZWRFbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgICBjb25zdCBmbkVudiA9IChmbiBhcyBhbnkpLmVudmlyb25tZW50IHx8IHt9O1xuICAgIGZvciAoY29uc3QgWyBrZXksIGNvbmZpZyBdIG9mIE9iamVjdC5lbnRyaWVzKGZuRW52KSkge1xuICAgICAgcmVzb2x2ZWRFbnZbIGtleSBdID0gKGNvbmZpZyBhcyBhbnkpLnZhbHVlO1xuICAgIH1cblxuICAgIGZ3MjQucmVnaXN0ZXJTaW11bGF0ZWRMYW1iZGEoaWQsIHtcbiAgICAgIGVudHJ5OiBwcm9wcy5lbnRyeSxcbiAgICAgIGhhbmRsZXJDbGFzc05hbWU6IHByb3BzLmhhbmRsZXJDbGFzc05hbWUgfHwgJ2hhbmRsZXInLFxuICAgICAgZW52aXJvbm1lbnQ6IHJlc29sdmVkRW52LFxuICAgICAgLy8gV2UgY2FuIGFsc28gc3RvcmUgcG9saWNpZXMgaWYgbmVlZGVkIGZvciBJQU0gc2ltdWxhdGlvblxuICAgICAgcG9saWNpZXM6IHByb3BzLnBvbGljaWVzXG4gICAgfSk7XG5cbiAgICByZXR1cm4gZm47XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUG9saWN5VG9GdW5jdGlvbihvcHRpb25zOiB7XG4gIGZuOiBOb2RlanNGdW5jdGlvbixcbiAgZncyNDogRncyNCxcbiAgcG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSxcbn0pIHtcbiAgY29uc3QgeyBmbiwgZncyNCwgcG9saWN5IH0gPSBvcHRpb25zO1xuXG4gIGxldCByZXNvbHZlZFBvbGljeTogVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3kgPSBwb2xpY3k7XG5cbiAgaWYgKGlzSW1wb3J0ZWRQb2xpY3kocG9saWN5KSkge1xuICAgIGNvbnN0IHBvbGljeUV4aXN0cyA9IGZ3MjQuaGFzUG9saWN5KHBvbGljeS5uYW1lLCBwb2xpY3kucHJlZml4KTtcblxuICAgIGlmICghcG9saWN5RXhpc3RzKSB7XG4gICAgICBpZiAocG9saWN5LmlzT3B0aW9uYWwpIHtcbiAgICAgICAgLy8gU2tpcCBvcHRpb25hbCBwb2xpY2llcyB0aGF0IGRvbid0IGV4aXN0XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgUG9saWN5ICR7cG9saWN5Lm5hbWV9IG5vdCBmb3VuZCBpbiBmdzI0IHNjb3BlYCk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQb2xpY3kgPSBmdzI0LmdldFBvbGljeShwb2xpY3kubmFtZSwgcG9saWN5LnByZWZpeCkgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ7XG4gIH1cblxuICBpZiAoIShyZXNvbHZlZFBvbGljeSBpbnN0YW5jZW9mIFBvbGljeVN0YXRlbWVudCkpIHtcbiAgICByZXNvbHZlZFBvbGljeSA9IG5ldyBQb2xpY3lTdGF0ZW1lbnQocmVzb2x2ZWRQb2xpY3kgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMpO1xuICB9XG5cbiAgZm4uYWRkVG9Sb2xlUG9saWN5KHJlc29sdmVkUG9saWN5IGFzIFBvbGljeVN0YXRlbWVudCk7XG5cbn1cblxuZnVuY3Rpb24gYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKG9wdGlvbnM6IHtcbiAgZm46IE5vZGVqc0Z1bmN0aW9uLFxuICBrZXk6IHN0cmluZyxcbiAgdmFsdWU6IHN0cmluZyxcbiAgcHJlZml4Pzogc3RyaW5nLFxuICBzdWZmaXg/OiBzdHJpbmcsXG59KSB7XG5cbiAgY29uc3QgeyBmbiwga2V5LCB2YWx1ZSwgcHJlZml4ID0gJycsIHN1ZmZpeCA9ICcnIH0gPSBvcHRpb25zO1xuXG4gIGNvbnN0IGVudktleSA9IGVuc3VyZVZhbGlkRW52S2V5KGtleSwgcHJlZml4LCBzdWZmaXgpO1xuICBmbi5hZGRFbnZpcm9ubWVudChlbnZLZXksIHZhbHVlKTtcbn1cblxuLyoqXG4gKiBNZXJnZXMgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB3aXRoIHBlci1mdW5jdGlvbiByZXNvdXJjZSBhY2Nlc3MuXG4gKiBQZXItZnVuY3Rpb24gcmVzb3VyY2UgYWNjZXNzIHRha2VzIHByZWNlZGVuY2UgKGNvbWVzIGFmdGVyIGdsb2JhbCBpbiB0aGUgbWVyZ2VkIGFycmF5KS5cbiAqIERlZHVwbGljYXRpb24gaXMgaGFuZGxlZCBhdCB0aGUgcmVzb3VyY2UgbGV2ZWwgLSBpZiB0aGUgc2FtZSByZXNvdXJjZSBhcHBlYXJzIGluIGJvdGhcbiAqIGdsb2JhbCBhbmQgcGVyLWZ1bmN0aW9uIGFjY2VzcywgYm90aCBlbnRyaWVzIGFyZSBrZXB0IChhbGxvd2luZyBmb3IgZGlmZmVyZW50IGFjY2VzcyBsZXZlbHMpLlxuICogXG4gKiBAcGFyYW0gZ2xvYmFsQWNjZXNzIC0gR2xvYmFsIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uIGZyb20gZncyNFxuICogQHBhcmFtIGZ1bmN0aW9uQWNjZXNzIC0gUGVyLWZ1bmN0aW9uIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBNZXJnZWQgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAqL1xuZnVuY3Rpb24gbWVyZ2VSZXNvdXJjZUFjY2VzcyhcbiAgZ2xvYmFsQWNjZXNzOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB8IHVuZGVmaW5lZCxcbiAgZnVuY3Rpb25BY2Nlc3M6IElGdW5jdGlvblJlc291cmNlQWNjZXNzIHwgdW5kZWZpbmVkXG4pOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gIGlmICghZ2xvYmFsQWNjZXNzICYmICFmdW5jdGlvbkFjY2Vzcykge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIGlmICghZ2xvYmFsQWNjZXNzKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uQWNjZXNzITtcbiAgfVxuXG4gIGlmICghZnVuY3Rpb25BY2Nlc3MpIHtcbiAgICByZXR1cm4gZ2xvYmFsQWNjZXNzO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0YWJsZXM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnRhYmxlcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MudGFibGVzIHx8IFtdKVxuICAgIF0pLFxuICAgIGJ1Y2tldHM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLmJ1Y2tldHMgfHwgW10pLFxuICAgICAgLi4uKGZ1bmN0aW9uQWNjZXNzLmJ1Y2tldHMgfHwgW10pXG4gICAgXSksXG4gICAgcXVldWVzOiBkZWR1cGxpY2F0ZVJlc291cmNlQXJyYXkoW1xuICAgICAgLi4uKGdsb2JhbEFjY2Vzcy5xdWV1ZXMgfHwgW10pLFxuICAgICAgLi4uKGZ1bmN0aW9uQWNjZXNzLnF1ZXVlcyB8fCBbXSlcbiAgICBdKSxcbiAgICB0b3BpY3M6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnRvcGljcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MudG9waWNzIHx8IFtdKVxuICAgIF0pXG4gIH07XG59XG5cbi8qKlxuICogRGVkdXBsaWNhdGVzIHJlc291cmNlIGFycmF5IGVudHJpZXMgYnkgbmFtZSwgcHJlZmVycmluZyBlbnRyaWVzIHdpdGggZXhwbGljaXQgYWNjZXNzIG92ZXIgaW1wbGljaXQuXG4gKiBXaGVuIHRoZSBzYW1lIHJlc291cmNlIGFwcGVhcnMgbXVsdGlwbGUgdGltZXM6XG4gKiAtIElmIGJvdGggaGF2ZSBleHBsaWNpdCBhY2Nlc3MgYXJyYXlzLCBtZXJnZSB0aGUgYWNjZXNzIGFycmF5c1xuICogLSBJZiBvbmUgaGFzIGV4cGxpY2l0IGFjY2VzcyBhbmQgb25lIGRvZXNuJ3QsIHVzZSB0aGUgZXhwbGljaXQgb25lXG4gKiAtIElmIGJvdGggYXJlIHN0cmluZ3MgKGltcGxpY2l0IHJlYWR3cml0ZSksIGtlZXAgb25seSBvbmVcbiAqIFxuICogQHBhcmFtIHJlc291cmNlcyAtIEFycmF5IG9mIHJlc291cmNlIGVudHJpZXMgKHN0cmluZyBvciB7IG5hbWUsIGFjY2Vzcz8gfSlcbiAqIEByZXR1cm5zIERlZHVwbGljYXRlZCBhcnJheVxuICovXG5mdW5jdGlvbiBkZWR1cGxpY2F0ZVJlc291cmNlQXJyYXk8VCBleHRlbmRzIHN0cmluZyB8IHsgbmFtZTogc3RyaW5nOyBhY2Nlc3M/OiBzdHJpbmdbXSB9PihcbiAgcmVzb3VyY2VzOiBUW11cbik6IFRbXSB7XG4gIGlmICghcmVzb3VyY2VzIHx8IHJlc291cmNlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXNvdXJjZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBUPigpO1xuXG4gIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgY29uc3QgbmFtZSA9IHR5cGVvZiByZXNvdXJjZSA9PT0gJ3N0cmluZycgPyByZXNvdXJjZSA6IHJlc291cmNlLm5hbWU7XG4gICAgY29uc3QgZXhpc3RpbmdSZXNvdXJjZSA9IHJlc291cmNlTWFwLmdldChuYW1lKTtcblxuICAgIGlmICghZXhpc3RpbmdSZXNvdXJjZSkge1xuICAgICAgcmVzb3VyY2VNYXAuc2V0KG5hbWUsIHJlc291cmNlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTWVyZ2UgbG9naWM6IHByZWZlciBleHBsaWNpdCBhY2Nlc3Mgb3ZlciBpbXBsaWNpdFxuICAgICAgY29uc3QgZXhpc3RpbmdBY2Nlc3MgPSB0eXBlb2YgZXhpc3RpbmdSZXNvdXJjZSA9PT0gJ3N0cmluZycgPyB1bmRlZmluZWQgOiBleGlzdGluZ1Jlc291cmNlLmFjY2VzcztcbiAgICAgIGNvbnN0IG5ld0FjY2VzcyA9IHR5cGVvZiByZXNvdXJjZSA9PT0gJ3N0cmluZycgPyB1bmRlZmluZWQgOiByZXNvdXJjZS5hY2Nlc3M7XG5cbiAgICAgIGlmIChleGlzdGluZ0FjY2VzcyAmJiBuZXdBY2Nlc3MpIHtcbiAgICAgICAgLy8gQm90aCBoYXZlIGV4cGxpY2l0IGFjY2VzcyAtIG1lcmdlIGFuZCBkZWR1cGxpY2F0ZVxuICAgICAgICBjb25zdCBtZXJnZWRBY2Nlc3MgPSBBcnJheS5mcm9tKG5ldyBTZXQoWyAuLi5leGlzdGluZ0FjY2VzcywgLi4ubmV3QWNjZXNzIF0pKTtcbiAgICAgICAgcmVzb3VyY2VNYXAuc2V0KG5hbWUsIHsgbmFtZSwgYWNjZXNzOiBtZXJnZWRBY2Nlc3MgfSBhcyBUKTtcbiAgICAgIH0gZWxzZSBpZiAobmV3QWNjZXNzKSB7XG4gICAgICAgIC8vIE5ldyBoYXMgZXhwbGljaXQgYWNjZXNzLCBleGlzdGluZyBkb2Vzbid0IC0gcHJlZmVyIG5ld1xuICAgICAgICByZXNvdXJjZU1hcC5zZXQobmFtZSwgcmVzb3VyY2UpO1xuICAgICAgfVxuICAgICAgLy8gZWxzZTogZXhpc3RpbmcgaGFzIGV4cGxpY2l0IGFjY2VzcyBvciBib3RoIGltcGxpY2l0IC0ga2VlcCBleGlzdGluZ1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBBcnJheS5mcm9tKHJlc291cmNlTWFwLnZhbHVlcygpKTtcbn1cbiJdfQ==