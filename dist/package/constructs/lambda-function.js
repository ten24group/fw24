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
        let additionalProps = {
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
            additionalProps.timeout = aws_cdk_lib_1.Duration.seconds(props.functionTimeout);
        }
        if (props.processorArchitecture) {
            additionalProps.architecture = props.processorArchitecture === 'x86_64' ? aws_lambda_1.Architecture.X86_64 : aws_lambda_1.Architecture.ARM_64;
        }
        // Create the Node.js function
        const fn = new aws_lambda_nodejs_1.NodejsFunction(this, id, {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQWtCQSw0Q0FFQztBQWlLRCx3Q0FnQkM7QUFyTUQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsdURBQXlDO0FBQ3pDLG1EQUErRDtBQUMvRCx3Q0FBc0Y7QUFJdEYsU0FBZ0IsZ0JBQWdCLENBQUMsTUFBaUQ7SUFDaEYsT0FBUSxNQUEwQixDQUFDLElBQUksS0FBSyxTQUFTLENBQUM7QUFDeEQsQ0FBQztBQWdIRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0ErQ0c7QUFFSCxTQUFnQixjQUFjLENBQUMsUUFBaUI7SUFDOUMsUUFBUSxRQUFRLEVBQUUsV0FBVyxFQUFFLEVBQUUsQ0FBQztRQUNoQyxLQUFLLE9BQU87WUFDVixPQUFPLGdDQUFtQixDQUFDLEtBQUssQ0FBQztRQUNuQyxLQUFLLE1BQU07WUFDVCxPQUFPLGdDQUFtQixDQUFDLElBQUksQ0FBQztRQUNsQyxLQUFLLE9BQU87WUFDVixPQUFPLGdDQUFtQixDQUFDLEtBQUssQ0FBQztRQUNuQyxLQUFLLE9BQU87WUFDVixPQUFPLGdDQUFtQixDQUFDLEtBQUssQ0FBQztRQUNuQyxLQUFLLE9BQU87WUFDVixPQUFPLGdDQUFtQixDQUFDLEtBQUssQ0FBQztRQUNuQyxLQUFLLE1BQU0sQ0FBQztRQUNaO1lBQ0UsT0FBTyxnQ0FBbUIsQ0FBQyxJQUFJLENBQUE7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Q0FBRSxDQUFDLENBQUMsQ0FBQztnQkFDOUUsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBTyxDQUFDLENBQUM7WUFDN0QsQ0FBQztpQkFBTSxJQUFJLFNBQVMsRUFBRSxDQUFDO2dCQUNyQix5REFBeUQ7Z0JBQ3pELFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBQ2xDLENBQUM7WUFDRCxzRUFBc0U7UUFDeEUsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7QUFDMUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgUG9saWN5U3RhdGVtZW50LCB0eXBlIFBvbGljeVN0YXRlbWVudFByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IFJ1bnRpbWUsIEFyY2hpdGVjdHVyZSwgTGF5ZXJWZXJzaW9uLCBBcHBsaWNhdGlvbkxvZ0xldmVsLCBMb2dnaW5nRm9ybWF0LCBJTGF5ZXJWZXJzaW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCB7IElUYWJsZVYyLCBUYWJsZVYyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBCdWNrZXQgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IFRvcGljIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgKiBhcyBFTlZfS0VZUyBmcm9tIFwiLi4vY29uc3QvZW52XCI7XG5pbXBvcnQgeyBMb2dHcm91cCwgUmV0ZW50aW9uRGF5cyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgZW5zdXJlTm9TcGVjaWFsQ2hhcnMsIGVuc3VyZVN1ZmZpeCwgZW5zdXJlVmFsaWRFbnZLZXkgfSBmcm9tIFwiLi4vdXRpbHMva2V5c1wiO1xuZXhwb3J0IHR5cGUgVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgPSBQb2xpY3lTdGF0ZW1lbnQgfCBQb2xpY3lTdGF0ZW1lbnRQcm9wcztcbmV4cG9ydCB0eXBlIFRJbXBvcnRlZFBvbGljeSA9IHsgbmFtZTogc3RyaW5nLCBpc09wdGlvbmFsPzogYm9vbGVhbiwgcHJlZml4Pzogc3RyaW5nIH07XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0ltcG9ydGVkUG9saWN5KHBvbGljeTogVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3kpOiBwb2xpY3kgaXMgVEltcG9ydGVkUG9saWN5IHtcbiAgcmV0dXJuIChwb2xpY3kgYXMgVEltcG9ydGVkUG9saWN5KS5uYW1lICE9PSB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgcHJvcGVydGllcyBmb3IgYSBMYW1iZGEgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGFtYmRhRnVuY3Rpb25Qcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZW50cnkgcG9pbnQgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBlbnRyeTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSBMYW1iZGEgZnVuY3Rpb24ncyBleGVjdXRpb24gcm9sZS5cbiAgICovXG4gIHBvbGljaWVzPzogQXJyYXk8VFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3k+O1xuXG4gIC8qKlxuICAgKiBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIHNldCBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGVudmlyb25tZW50VmFyaWFibGVzPzogeyBbIGtleTogc3RyaW5nIF06IHN0cmluZyB9O1xuXG4gIC8qKlxuICAgKiBUaGUgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICByZXNvdXJjZUFjY2Vzcz86IElGdW5jdGlvblJlc291cmNlQWNjZXNzO1xuXG4gIC8qKlxuICAgKiBJbmRpY2F0ZXMgd2hldGhlciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGlzIGFsbG93ZWQgdG8gc2VuZCBlbWFpbHMuXG4gICAqL1xuICBhbGxvd1NlbmRFbWFpbD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgZGF5cyB0byByZXRhaW4gdGhlIGxvZ3MgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBsb2dSZXRlbnRpb25EYXlzPzogUmV0ZW50aW9uRGF5cztcblxuICAvKipcbiAgICogVGhlIHJlbW92YWwgcG9saWN5IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uJ3MgbG9ncy5cbiAgICovXG4gIGxvZ1JlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xuXG4gIC8qKlxuICAgKiBUaGUgdGltZW91dCBkdXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbiBpbiBzZWNvbmRzLlxuICAgKiBVc2UgdGhpcyB0aW1lb3V0IHRvIGF2b2lkIGltcG9ydGluZyB0aGUgZHVyYXRpb24gY2xhc3MgZnJvbSBhd3MtY2RrLWxpYi5cbiAgICovXG4gIGZ1bmN0aW9uVGltZW91dD86IG51bWJlcjtcblxuICBwcm9jZXNzb3JBcmNoaXRlY3R1cmU/OiAneDg2XzY0JyB8ICdhcm1fNjQnO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGZ1bmN0aW9uUHJvcHM/OiBPbWl0PE5vZGVqc0Z1bmN0aW9uUHJvcHMsICdsYXllcnMnPiAmIHtcbiAgICByZWFkb25seSBsYXllcnM/OiBBcnJheTxJTGF5ZXJWZXJzaW9uIHwgc3RyaW5nPjtcbiAgfVxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSByZXNvdXJjZSBhY2Nlc3MgZW50cnkgLSBlaXRoZXIgYSBzaW1wbGUgc3RyaW5nIG5hbWUgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICovXG5leHBvcnQgdHlwZSBUUmVzb3VyY2VBY2Nlc3NFbnRyeSA9IHN0cmluZyB8IHsgbmFtZTogc3RyaW5nOyBhY2Nlc3M/OiBzdHJpbmdbXSB9O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdmFyaW91cyByZXNvdXJjZXMgdGhhdCBjYW4gYmUgYWNjZXNzZWQgYnkgYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHRhYmxlcy5cbiAgICogRWFjaCB0YWJsZSBjYW4gYmUgYSBzdHJpbmcgKG5hbWUgb25seSwgZGVmYXVsdHMgdG8gcmVhZHdyaXRlKSBvciBhbiBvYmplY3Qgd2l0aCBuYW1lIGFuZCBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdyZWFkJywgJ3dyaXRlJywgb3IgJ3JlYWR3cml0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncmVhZHdyaXRlJy5cbiAgICogXG4gICAqIEBleGFtcGxlXG4gICAqIHRhYmxlczogWyd1c2Vycy10YWJsZScsIHsgbmFtZTogJ29yZGVycy10YWJsZScsIGFjY2VzczogWydyZWFkJ10gfV1cbiAgICovXG4gIHRhYmxlcz86IFRSZXNvdXJjZUFjY2Vzc0VudHJ5W107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgYnVja2V0cy5cbiAgICogRWFjaCBidWNrZXQgY2FuIGJlIGEgc3RyaW5nIChuYW1lIG9ubHksIGRlZmF1bHRzIHRvIHJlYWR3cml0ZSkgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncmVhZCcsICd3cml0ZScsIG9yICdyZWFkd3JpdGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3JlYWR3cml0ZScuXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBidWNrZXRzOiBbJ2Fzc2V0cy1idWNrZXQnLCB7IG5hbWU6ICdsb2dzLWJ1Y2tldCcsIGFjY2VzczogWyd3cml0ZSddIH1dXG4gICAqL1xuICBidWNrZXRzPzogVFJlc291cmNlQWNjZXNzRW50cnlbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciB0b3BpY3MuXG4gICAqIEVhY2ggdG9waWMgY2FuIGJlIGEgc3RyaW5nIChuYW1lIG9ubHksIGRlZmF1bHRzIHRvIHB1Ymxpc2gpIG9yIGFuIG9iamVjdCB3aXRoIG5hbWUgYW5kIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3B1Ymxpc2gnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3B1Ymxpc2gnLlxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogdG9waWNzOiBbJ2V2ZW50cy10b3BpYycsIHsgbmFtZTogJ25vdGlmaWNhdGlvbnMtdG9waWMnLCBhY2Nlc3M6IFsncHVibGlzaCddIH1dXG4gICAqL1xuICB0b3BpY3M/OiBUUmVzb3VyY2VBY2Nlc3NFbnRyeVtdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHF1ZXVlcy5cbiAgICogRWFjaCBxdWV1ZSBjYW4gYmUgYSBzdHJpbmcgKG5hbWUgb25seSwgZGVmYXVsdHMgdG8gc2VuZCkgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAnc2VuZCcsICdyZWNlaXZlJywgb3IgJ2RlbGV0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAnc2VuZCcuXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBxdWV1ZXM6IFsnbm90aWZpY2F0aW9ucy1xdWV1ZScsIHsgbmFtZTogJ3Byb2Nlc3NpbmctcXVldWUnLCBhY2Nlc3M6IFsnc2VuZCcsICdyZWNlaXZlJ10gfV1cbiAgICovXG4gIHF1ZXVlcz86IFRSZXNvdXJjZUFjY2Vzc0VudHJ5W107XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgTGFtYmRhIGZ1bmN0aW9uIGNvbnN0cnVjdC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIExhbWJkYSBmdW5jdGlvbiB3aXRoIGN1c3RvbSBwcm9wZXJ0aWVzXG4gKiBjb25zdCBsYW1iZGFQcm9wczogTGFtYmRhRnVuY3Rpb25Qcm9wcyA9IHtcbiAqICAgZW50cnk6IFwiaW5kZXguanNcIixcbiAqICAgcG9saWNpZXM6IFt7XG4gKiAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICogICAgICAgICBhY3Rpb25zOiBbXG4gKiAgICAgICAgICBcInMzOkdldE9iamVjdFwiXG4gKiAgICAgICAgIF0sXG4gKiAgICAgICAgIHJlc291cmNlczogW1wiYXJuOmF3czpzMzo6Om15LWJ1Y2tldC8qXCJdLFxuICogICAgIH0sIFxuICogICAgIHtcbiAqICAgICAgIHBvbGljeTogXCJhdXRoTW9kdWxlOmNyZWF0ZS11c2VyLWF1dGgtcmVjb3JkXCIsXG4gKiAgICAgICBpc09wdGlvbmFsOiB0cnVlXG4gKiAgICAgfVxuICogICBdLFxuICogICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICogICAgIE1ZX0VOVl9WQVI6IFwibXktdmFsdWVcIixcbiAqICAgfSxcbiAqICAgcmVzb3VyY2VBY2Nlc3M6IHtcbiAqICAgICB0YWJsZXM6IFtcbiAqICAgICAgIHtcbiAqICAgICAgICAgbmFtZTogXCJteS10YWJsZVwiLFxuICogICAgICAgICBhY2Nlc3M6IFtcInJlYWRcIiwgXCJ3cml0ZVwiXSxcbiAqICAgICAgIH0sXG4gKiAgICAgXSxcbiAqICAgICBidWNrZXRzOiBbXCJteS1idWNrZXRcIl0sXG4gKiAgICAgdG9waWNzOiBbXCJteS10b3BpY1wiXSxcbiAqICAgICBxdWV1ZXM6IFtcIm15LXF1ZXVlXCJdLFxuICogICB9LFxuICogICBhbGxvd1NlbmRFbWFpbDogdHJ1ZSxcbiAqICAgbG9nUmV0ZW50aW9uRGF5czogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAqICAgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICogICBmdW5jdGlvblRpbWVvdXQ6IDEwLFxuICogICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAqICAgICBtZW1vcnlTaXplOiAyNTYsXG4gKiAgIH0sXG4gKiB9O1xuICpcbiAqIGNvbnN0IGxhbWJkYUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCBcIk15TGFtYmRhRnVuY3Rpb25cIiwgbGFtYmRhUHJvcHMpO1xuICogXG4gKiBgYGBcbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0TG9nTGV2ZWwobG9nTGV2ZWw/OiBzdHJpbmcpIHtcbiAgc3dpdGNoIChsb2dMZXZlbD8udG9VcHBlckNhc2UoKSkge1xuICAgIGNhc2UgJ0VSUk9SJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkVSUk9SO1xuICAgIGNhc2UgJ1dBUk4nOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuV0FSTjtcbiAgICBjYXNlICdERUJVRyc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5ERUJVRztcbiAgICBjYXNlICdUUkFDRSc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5UUkFDRTtcbiAgICBjYXNlICdGQVRBTCc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5GQVRBTDtcbiAgICBjYXNlICdJTkZPJzpcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuSU5GT1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBMYW1iZGFGdW5jdGlvbiBleHRlbmRzIENvbnN0cnVjdCB7XG5cbiAgcmVhZG9ubHkgbG9nZ2VyPzogSUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignTGFtYmRhRnVuY3Rpb24nKTtcblxuICAvKipcbiAgICogQ29uc3RydWN0cyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgTGFtYmRhRnVuY3Rpb24gY2xhc3MuXG4gICAqIEBwYXJhbSBzY29wZSAtIFRoZSBwYXJlbnQgY29uc3RydWN0LlxuICAgKiBAcGFyYW0gaWQgLSBUaGUgSUQgb2YgdGhlIGNvbnN0cnVjdC5cbiAgICogQHBhcmFtIHByb3BzIC0gVGhlIExhbWJkYSBmdW5jdGlvbiBwcm9wZXJ0aWVzLlxuICAgKiBAcmV0dXJucyBUaGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIC8vIERlZmF1bHQgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb25cbiAgICBsZXQgZGVmYXVsdFByb3BzOiBOb2RlanNGdW5jdGlvblByb3BzID0ge1xuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLkFSTV82NCxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDEyOCxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IHByb2Nlc3MuZW52LkxPR19GT1JNQVQ/LnRvTG93ZXJDYXNlPy4oKSA9PT0gJ2pzb24nID8gTG9nZ2luZ0Zvcm1hdC5KU09OIDogTG9nZ2luZ0Zvcm1hdC5URVhULFxuICAgICAgLi4uZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblByb3BzIGFzIE5vZGVqc0Z1bmN0aW9uUHJvcHMsXG4gICAgfTtcblxuICAgIC8vICAnRXJyb3InICBUbyB1c2UgQXBwbGljYXRpb25Mb2dMZXZlbCBhbmQvb3IgU3lzdGVtTG9nTGV2ZWwgeW91IG11c3Qgc2V0IExvZ2dpbmdGb3JtYXQgdG8gJ0pTT04nLCBnb3QgJ1RleHQnLlxuICAgIGlmIChkZWZhdWx0UHJvcHMubG9nZ2luZ0Zvcm1hdCA9PT0gTG9nZ2luZ0Zvcm1hdC5KU09OKSB7XG4gICAgICBkZWZhdWx0UHJvcHMgPSB7XG4gICAgICAgIC4uLmRlZmF1bHRQcm9wcyxcbiAgICAgICAgYXBwbGljYXRpb25Mb2dMZXZlbFYyOiBmb3JtYXRMb2dMZXZlbChwcm9jZXNzLmVudi5MT0dfTEVWRUwpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBsb2cgZ3JvdXAgaWYgbm90IHByb3ZpZGVkXG4gICAgbGV0IGxvZ0dyb3VwID0gcHJvcHMuZnVuY3Rpb25Qcm9wcz8ubG9nR3JvdXA7XG4gICAgaWYgKCFsb2dHcm91cCkge1xuICAgICAgbGV0IGxvZ1JldGVudGlvbkRheXMgPSBwcm9wcy5sb2dSZXRlbnRpb25EYXlzIHx8IGZ3MjQuZ2V0Q29uZmlnKCkubG9nUmV0ZW50aW9uRGF5cyB8fCAzMDtcbiAgICAgIGxvZ0dyb3VwID0gbmV3IExvZ0dyb3VwKHRoaXMsIGAke2lkfS1Mb2dHcm91cGAsIHtcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogcHJvcHMubG9nUmVtb3ZhbFBvbGljeSB8fCBmdzI0LmdldENvbmZpZygpLmxvZ1JlbW92YWxQb2xpY3kgfHwgUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICAgIHJldGVudGlvbjogcGFyc2VJbnQobG9nUmV0ZW50aW9uRGF5cy50b1N0cmluZygpKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGxldCBhZGRpdGlvbmFsUHJvcHM6IGFueSA9IHtcbiAgICAgIGVudHJ5OiBwcm9wcy5lbnRyeSxcbiAgICB9XG5cbiAgICAvLyBjb2xsZWN0IHRoZSBuYW1lcyBvZiB0aGUgbGF5ZXJzIHByb3ZpZGVkIGluIGRlZmF1bHQgY29uZmlnIGlmIGFueSBvciBlbHNlIHRoZSBnbG9iYWwgbGF5ZXJzO1xuICAgIGNvbnN0IGRlZmF1bHRMYXllcnMgPSBkZWZhdWx0UHJvcHM/LmxheWVycyA/PyBBcnJheS5mcm9tKGZ3MjQuZ2V0R2xvYmFsTGFtYmRhTGF5ZXJOYW1lcygpKTtcblxuICAgIC8vIHJlc29sdmUgbGF5ZXIgbmFtZXMgdG8gYWN0dWFsIGxheWVyIGFybnNcbiAgICBjb25zdCBsYXllcnMgPSBbXG4gICAgICAuLi5kZWZhdWx0TGF5ZXJzLFxuICAgICAgLy8gY29sbGVjdCB0aGUgbmFtZXMgb2YgdGhlIGxheWVycyBwcm92aWRlZCBpbiBmdW5jdGlvbiBjb25maWcgaWYgYW55O1xuICAgICAgLi4uKHByb3BzLmZ1bmN0aW9uUHJvcHM/LmxheWVycyA/PyBbXSlcbiAgICBdIGFzIEFycmF5PHN0cmluZyB8IElMYXllclZlcnNpb24+O1xuXG4gICAgLy8gcmVtb3ZlIGR1cGxpY2F0ZXNcbiAgICBjb25zdCBkZUR1cExheWVycyA9IEFycmF5LmZyb20obmV3IFNldChsYXllcnMpKTtcblxuICAgIC8vIEVuc3VyZSBmdzI0IGxheWVyIGlzIGluY2x1ZGVkIChpZiBub3QgYWxyZWFkeSBpbiB0aGUgbGlzdClcbiAgICBpZiAoIWRlRHVwTGF5ZXJzLmluY2x1ZGVzKCdmdzI0JykpIHtcbiAgICAgIGRlRHVwTGF5ZXJzLnB1c2goJ2Z3MjQnKTtcbiAgICB9XG5cbiAgICAvLyBtYXAgbGF5ZXJzIHRvIGFjdHVhbCBsYXllciBvYmplY3RzXG4gICAgY29uc3QgcmVzb2x2ZWRMYXllcnMgPSBkZUR1cExheWVycy5tYXAobGF5ZXJOYW1lID0+IHtcbiAgICAgIGlmICh0eXBlb2YgbGF5ZXJOYW1lID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4odGhpcywgYCR7aWR9LSR7bGF5ZXJOYW1lfS1MYXllcmAsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShsYXllck5hbWUgKyAnX2xheWVyVmVyc2lvbkFybicsICdsYXllcicsIHNjb3BlKSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBsYXllck5hbWU7XG4gICAgfSlcblxuICAgIGFkZGl0aW9uYWxQcm9wcy5sYXllcnMgPSByZXNvbHZlZExheWVycztcblxuICAgIGFkZGl0aW9uYWxQcm9wcy5idW5kbGluZyA9IHtcbiAgICAgIC4uLmRlZmF1bHRQcm9wcy5idW5kbGluZyxcbiAgICAgIC4uLnByb3BzLmZ1bmN0aW9uUHJvcHM/LmJ1bmRsaW5nLFxuICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgIC4uLihkZWZhdWx0UHJvcHM/LmJ1bmRsaW5nPy5leHRlcm5hbE1vZHVsZXMgPz8gW10pLFxuICAgICAgICAuLi4ocHJvcHMuZnVuY3Rpb25Qcm9wcz8uYnVuZGxpbmc/LmV4dGVybmFsTW9kdWxlcyA/PyBbXSksXG4gICAgICAgIFwiQHRlbjI0Z3JvdXAvZncyNFwiXG4gICAgICBdLFxuICAgIH07XG4gICAgYWRkaXRpb25hbFByb3BzLmxvZ0dyb3VwID0gbG9nR3JvdXA7XG4gICAgaWYgKHByb3BzLmZ1bmN0aW9uVGltZW91dCkge1xuICAgICAgYWRkaXRpb25hbFByb3BzLnRpbWVvdXQgPSBEdXJhdGlvbi5zZWNvbmRzKHByb3BzLmZ1bmN0aW9uVGltZW91dCk7XG4gICAgfVxuXG4gICAgaWYgKHByb3BzLnByb2Nlc3NvckFyY2hpdGVjdHVyZSkge1xuICAgICAgYWRkaXRpb25hbFByb3BzLmFyY2hpdGVjdHVyZSA9IHByb3BzLnByb2Nlc3NvckFyY2hpdGVjdHVyZSA9PT0gJ3g4Nl82NCcgPyBBcmNoaXRlY3R1cmUuWDg2XzY0IDogQXJjaGl0ZWN0dXJlLkFSTV82NDtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgdGhlIE5vZGUuanMgZnVuY3Rpb25cbiAgICBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBpZCwge1xuICAgICAgLi4uZGVmYXVsdFByb3BzLFxuICAgICAgLi4ucHJvcHMuZnVuY3Rpb25Qcm9wcyxcbiAgICAgIC4uLmFkZGl0aW9uYWxQcm9wcyxcbiAgICB9KTtcblxuICAgIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzID0gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMgPz8ge307XG5cbiAgICAvLyAqIEVYUE9SVCB0aGUgbG9nLWxldmVsIGZvciBvdXIgbG9nZ2VyLWluc3RhbmNlcyBpbiB0aGUgcnVudGltZSBvZiB0aGlzIGxhbWJkYVxuICAgIC8vIFNlZSAnLi4vbG9nZ2luZy9pbmRleC50cycgZm9yIG1vcmUgaW5mb1xuICAgIC8vIE5PVEU6IHRoaXMgbG9nLWxldmVsIGlzIGRpZmZlcmVudCB0aGFuIHRoZSBhd3MtbG9nLWxldmVsXG4gICAgLy8gYXdzIHJlcXVpcmVzIHRoZSBsb2cgZm9ybWF0IHNldCB0byBKU09OIHRvIG92ZXJyaWRlIGxvZy1sZXZlbCBzZWUgYGFwcGxpY2F0aW9uTG9nTGV2ZWxWMmAgaW4gdGhlIGNvZGUgYWJvdmVcblxuICAgIC8vIGVuc3VyZSB0aGUgZW52aXJvbm1lbnQtdmFyaWFibGVzIGZvciB0aGUgbGFtYmRhIGFsd2F5cyBoYXZlIGEgbG9nLWxldmVsXG4gICAgaWYgKCEoJ0xPR19MRVZFTCcgaW4gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpKSB7XG4gICAgICBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgJ0xPR19MRVZFTCcgXSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpKSB7XG4gICAgICBsZXQgZW52VmFsdWUgPSB2YWx1ZTtcbiAgICAgIGxldCBlbnZLZXkgPSBrZXk7XG4gICAgICAvLyBJZiBrZXkgaXMgcHJlZml4ZWQgd2l0aCBmdzI0XywgYWNjZXNzIGVudmlyb25tZW50IHZhcmlhYmxlcyBmcm9tIGZ3MjQgc2NvcGVcbiAgICAgIC8vIGtleXMgY2FuIGhhdmUgc2hhcGUgbGlrZTpcbiAgICAgIC8vIGZ3MjRfeHh4ICh3aXRob3V0IHNjb3BlKVxuICAgICAgLy8gZncyNF9BdXRoTW9kdWxlX3h4eCAod2l0aCBzY29wZTogQXV0aE1vZHVsZSlcbiAgICAgIC8vIGZ3MjRfVXNlclBvb2xfQXV0aE1vZHVsZV91c2VyUG9vbElkICh3aXRoIHNjb3BlOiBVc2VyUG9vbF9BdXRoTW9kdWxlKVxuICAgICAgaWYgKHZhbHVlICYmIHZhbHVlLnN0YXJ0c1dpdGgoJ2Z3MjRfJykpIHtcbiAgICAgICAgLy8gUmVtb3ZlIGZ3MjRfIHByZWZpeFxuICAgICAgICBjb25zdCBrZXlXaXRob3V0UHJlZml4ID0gdmFsdWUucmVwbGFjZSgnZncyNF8nLCAnJyk7XG4gICAgICAgIGNvbnN0IHBhcnRzID0ga2V5V2l0aG91dFByZWZpeC5zcGxpdCgnXycpO1xuXG4gICAgICAgIC8vIExhc3QgcGFydCBpcyBhbHdheXMgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIG5hbWVcbiAgICAgICAgY29uc3QgZW52VmFyTmFtZSA9IHBhcnRzWyBwYXJ0cy5sZW5ndGggLSAxIF07XG5cbiAgICAgICAgLy8gRXZlcnl0aGluZyBiZWZvcmUgdGhlIGxhc3QgcGFydCBpcyB0aGUgc2NvcGUgKGlmIGFueSlcbiAgICAgICAgY29uc3Qgc2NvcGUgPSBwYXJ0cy5sZW5ndGggPiAxID8gcGFydHMuc2xpY2UoMCwgLTEpLmpvaW4oJ18nKSA6ICcnO1xuXG4gICAgICAgIGVudlZhbHVlID0gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudlZhck5hbWUsIHNjb3BlKTtcbiAgICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBSZXNvbHZlZCBmdzI0IGVudmlyb25tZW50IHZhcmlhYmxlOiAke3ZhbHVlfSAtPiAke2VudlZhbHVlfWAsIGlkKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGA6U0VUIGVudmlyb25tZW50IHZhcmlhYmxlIFske2VudktleX0gOiAke2VudlZhbHVlfV1gLCBpZCk7XG5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGVudktleSxcbiAgICAgICAgdmFsdWU6IGVudlZhbHVlXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBBZGQgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlcyB0byB0aGUgZnVuY3Rpb25cbiAgICBmdzI0LmdldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKCkuZm9yRWFjaChlbnZLZXkgPT4ge1xuICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBBZGRpbmcgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlOiAke2VudktleX1gLCBpZCk7XG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBlbnZLZXksXG4gICAgICAgIHZhbHVlOiBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoZW52S2V5KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBBdXRvLXNldCBFTlRSWV9QQUNLQUdFUyBmb3IgQUxMIExhbWJkYXMgKGVuc3VyZXMgREkgaW5pdGlhbGl6YXRpb24pXG4gICAgLy8gT25seSBzZXQgaWYgbm90IGFscmVhZHkgY29uZmlndXJlZCBpbiBwcm9wcyBvciBnbG9iYWwgZW52IHZhcnNcbiAgICBjb25zdCBnbG9iYWxFbnZLZXlzID0gZncyNC5nZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpO1xuICAgIGlmIChcbiAgICAgICEoRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMgaW4gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpXG4gICAgICAmJlxuICAgICAgIWdsb2JhbEVudktleXMuaW5jbHVkZXMoRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMpXG4gICAgKSB7XG4gICAgICBjb25zdCBlbnRyeVBhY2thZ2VzID0gZncyNC5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCk7XG4gICAgICBpZiAoZW50cnlQYWNrYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIFJlc29sdmUgZW52IGtleSB0ZW1wbGF0ZXMgKGUuZy4sIGVudjpsYXllckltcG9ydFBhdGg6ZGkgLT4gL29wdC9ub2RlanMvbm9kZV9tb2R1bGVzL2RpL2luZGV4LmpzKVxuICAgICAgICBjb25zdCByZXNvbHZlZFBhY2thZ2VzID0gZW50cnlQYWNrYWdlcy5tYXAocGtnID0+IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHBrZykpO1xuICAgICAgICBjb25zdCBlbnRyeVBhY2thZ2VzVmFsdWUgPSByZXNvbHZlZFBhY2thZ2VzLmpvaW4oJywnKTtcbiAgICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBBdXRvLXNldHRpbmcgRU5UUllfUEFDS0FHRVM6ICR7ZW50cnlQYWNrYWdlc1ZhbHVlfWAsIGlkKTtcbiAgICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgICBmbixcbiAgICAgICAgICBrZXk6IEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTLFxuICAgICAgICAgIHZhbHVlOiBlbnRyeVBhY2thZ2VzVmFsdWVcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIGdsb2JhbCBwb2xpY2llcyB0byB0aGUgZnVuY3Rpb25cbiAgICBmdzI0LmdldEdsb2JhbFBvbGljaWVzKCkuZm9yRWFjaChwb2xpY3kgPT4ge1xuICAgICAgYWRkUG9saWN5VG9GdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBmdzI0LFxuICAgICAgICBwb2xpY3lcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQXR0YWNoIHBvbGljaWVzIHRvIHRoZSBmdW5jdGlvblxuICAgIChwcm9wcy5wb2xpY2llcyA/PyBbXSkuZm9yRWFjaChwb2xpY3kgPT4ge1xuICAgICAgYWRkUG9saWN5VG9GdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBmdzI0LFxuICAgICAgICBwb2xpY3lcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTWVyZ2UgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB3aXRoIHBlci1mdW5jdGlvbiByZXNvdXJjZSBhY2Nlc3NcbiAgICBjb25zdCBnbG9iYWxSZXNvdXJjZUFjY2VzcyA9IGZ3MjQuZ2V0R2xvYmFsUmVzb3VyY2VBY2Nlc3MoKTtcbiAgICBjb25zdCBtZXJnZWRSZXNvdXJjZUFjY2VzcyA9IG1lcmdlUmVzb3VyY2VBY2Nlc3MoZ2xvYmFsUmVzb3VyY2VBY2Nlc3MsIHByb3BzLnJlc291cmNlQWNjZXNzKTtcblxuICAgIC8vIElmIHdlIGFyZSB1c2luZyBTRVMsIHRoZW4gd2UgbmVlZCB0byBhZGQgdGhlIGVtYWlsIHF1ZXVlIHVybCB0byB0aGUgZW52aXJvbm1lbnRcbiAgICBpZiAocHJvcHMuYWxsb3dTZW5kRW1haWwgJiYgZncyNC5lbWFpbFByb3ZpZGVyIGluc3RhbmNlb2YgTWFpbGVyQ29uc3RydWN0KSB7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlTmFtZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZW1haWxRdWV1ZV9xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSk7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMsIGAke2lkfS0ke2VtYWlsUXVldWVOYW1lfS1xdWV1ZWAsIGZ3MjQuZ2V0QXJuKCdzcXMnLCBlbWFpbFF1ZXVlTmFtZSkpO1xuXG4gICAgICBlbWFpbFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGBFTUFJTF9RVUVVRV9VUkxgLFxuICAgICAgICB2YWx1ZTogZW1haWxRdWV1ZS5xdWV1ZVVybFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBEeW5hbW9EQiB0YWJsZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8udGFibGVzPy5mb3JFYWNoKCh0YWJsZTogYW55KSA9PiB7XG4gICAgICBsZXQgdGFibGVOYW1lID0gdHlwZW9mIHRhYmxlID09PSAnc3RyaW5nJyA/IHRhYmxlIDogdGFibGUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdGFibGVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodGFibGVOYW1lKTtcblxuICAgICAgY29uc3QgYXBwUXVhbGlmaWVkVGFibGVOYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMoZW5zdXJlU3VmZml4KHRhYmxlTmFtZSwgYHRhYmxlYCkpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgdGFibGUgPT09ICdzdHJpbmcnID8gWyAncmVhZHdyaXRlJyBdIDogdGFibGUuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcbiAgICAgIC8vIEdldCB0aGUgRHluYW1vREIgdGFibGUgYmFzZWQgb24gdGhlIGNvbnRyb2xsZXIgY29uZmlnXG4gICAgICBjb25zdCB0YWJsZUluc3RhbmNlOiBJVGFibGVWMiA9IFRhYmxlVjIuZnJvbVRhYmxlQXR0cmlidXRlcyh0aGlzLCBgJHtpZH0tJHt0YWJsZU5hbWV9LXRhYmxlYCwge1xuICAgICAgICB0YWJsZU5hbWU6IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShhcHBRdWFsaWZpZWRUYWJsZU5hbWUgKyAnX3RhYmxlTmFtZScsICd0YWJsZScsIHNjb3BlKSxcbiAgICAgICAgZ3JhbnRJbmRleFBlcm1pc3Npb25zOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCB0aGUgdGFibGUgbmFtZSB0byB0aGUgbGFtYmRhIGVudmlyb25tZW50ICAgICAgXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHthcHBRdWFsaWZpZWRUYWJsZU5hbWV9YCxcbiAgICAgICAgdmFsdWU6IHRhYmxlSW5zdGFuY2UudGFibGVOYW1lXG4gICAgICB9KTtcblxuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiByZWFkIHdyaXRlIGFjY2VzcyB0byB0aGUgdGFibGVcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVhZCc6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50UmVhZERhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnd3JpdGUnOlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFdyaXRlRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFJlYWRXcml0ZURhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBTMyBidWNrZXQgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgbWVyZ2VkUmVzb3VyY2VBY2Nlc3M/LmJ1Y2tldHM/LmZvckVhY2goKGJ1Y2tldDogYW55KSA9PiB7XG4gICAgICBsZXQgYnVja2V0TmFtZSA9IHR5cGVvZiBidWNrZXQgPT09ICdzdHJpbmcnID8gYnVja2V0IDogYnVja2V0Lm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIGJ1Y2tldE5hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShidWNrZXROYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIGJ1Y2tldCA9PT0gJ3N0cmluZycgPyBbICdyZWFkd3JpdGUnIF0gOiBidWNrZXQuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcblxuICAgICAgY29uc3QgYnVja2V0RnVsbE5hbWUgPSBmdzI0LmdldFVuaXF1ZU5hbWUoYnVja2V0TmFtZSk7XG4gICAgICBjb25zdCBidWNrZXRJbnN0YW5jZTogYW55ID0gQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsIGJ1Y2tldE5hbWUgKyBpZCArICctYnVja2V0JywgYnVja2V0RnVsbE5hbWUpO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIGJ1Y2tldFxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWFkJzpcbiAgICAgICAgICAgIGJ1Y2tldEluc3RhbmNlLmdyYW50UmVhZChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd3cml0ZSc6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFdyaXRlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFJlYWRXcml0ZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGJ1Y2tldCBuYW1lXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgYnVja2V0XyR7YnVja2V0TmFtZX1gLFxuICAgICAgICB2YWx1ZTogYnVja2V0RnVsbE5hbWVcbiAgICAgIH0pO1xuXG4gICAgfSk7XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIFNRUyBxdWV1ZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8ucXVldWVzPy5mb3JFYWNoKChxdWV1ZTogYW55KSA9PiB7XG4gICAgICBsZXQgcXVldWVOYW1lID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IHF1ZXVlIDogcXVldWUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgcXVldWVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUocXVldWVOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IFsgJ3NlbmQnIF0gOiBxdWV1ZS5hY2Nlc3MgfHwgWyAnc2VuZCcgXTtcblxuICAgICAgY29uc3QgcXVldWVBcm4gPSBmdzI0LmdldEFybignc3FzJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcywgcXVldWVOYW1lICsgaWQgKyAnLXF1ZXVlJywgcXVldWVBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHF1ZXVlXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ3JlY2VpdmUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudENvbnN1bWVNZXNzYWdlcyhmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFB1cmdlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgcXVldWUgdXJsXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHtxdWV1ZU5hbWV9X3F1ZXVlVXJsYCxcbiAgICAgICAgdmFsdWU6IHF1ZXVlSW5zdGFuY2UucXVldWVVcmxcbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgU05TIHRvcGljIHBlcm1pc3Npb25cbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8udG9waWNzPy5mb3JFYWNoKCh0b3BpYzogYW55KSA9PiB7XG4gICAgICBsZXQgdG9waWNOYW1lID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IHRvcGljIDogdG9waWMubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdG9waWNOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodG9waWNOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IFsgJ3B1Ymxpc2gnIF0gOiB0b3BpYy5hY2Nlc3MgfHwgWyAncHVibGlzaCcgXTtcblxuICAgICAgY29uc3QgdG9waWNBcm4gPSBmdzI0LmdldEFybignc25zJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSArICdfdG9waWNOYW1lJywgJ3RvcGljJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcywgdG9waWNOYW1lICsgaWQgKyAnLXRvcGljJywgdG9waWNBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHRvcGljXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICB0b3BpY0luc3RhbmNlLmdyYW50UHVibGlzaChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSB0b3BpYyBhcm5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke3RvcGljTmFtZX1fdG9waWNBcm5gLFxuICAgICAgICB2YWx1ZTogdG9waWNJbnN0YW5jZS50b3BpY0FyblxuICAgICAgfSlcbiAgICB9KTtcblxuICAgIHJldHVybiBmbjtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRQb2xpY3lUb0Z1bmN0aW9uKG9wdGlvbnM6IHtcbiAgZm46IE5vZGVqc0Z1bmN0aW9uLFxuICBmdzI0OiBGdzI0LFxuICBwb2xpY3k6IFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzIHwgVEltcG9ydGVkUG9saWN5LFxufSkge1xuICBjb25zdCB7IGZuLCBmdzI0LCBwb2xpY3kgfSA9IG9wdGlvbnM7XG5cbiAgbGV0IHJlc29sdmVkUG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSA9IHBvbGljeTtcblxuICBpZiAoaXNJbXBvcnRlZFBvbGljeShwb2xpY3kpKSB7XG4gICAgY29uc3QgcG9saWN5RXhpc3RzID0gZncyNC5oYXNQb2xpY3kocG9saWN5Lm5hbWUsIHBvbGljeS5wcmVmaXgpO1xuICAgIFxuICAgIGlmICghcG9saWN5RXhpc3RzKSB7XG4gICAgICBpZiAocG9saWN5LmlzT3B0aW9uYWwpIHtcbiAgICAgICAgLy8gU2tpcCBvcHRpb25hbCBwb2xpY2llcyB0aGF0IGRvbid0IGV4aXN0XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgUG9saWN5ICR7cG9saWN5Lm5hbWV9IG5vdCBmb3VuZCBpbiBmdzI0IHNjb3BlYCk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQb2xpY3kgPSBmdzI0LmdldFBvbGljeShwb2xpY3kubmFtZSwgcG9saWN5LnByZWZpeCkgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ7XG4gIH1cblxuICBpZiAoIShyZXNvbHZlZFBvbGljeSBpbnN0YW5jZW9mIFBvbGljeVN0YXRlbWVudCkpIHtcbiAgICByZXNvbHZlZFBvbGljeSA9IG5ldyBQb2xpY3lTdGF0ZW1lbnQocmVzb2x2ZWRQb2xpY3kgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMpO1xuICB9XG5cbiAgZm4uYWRkVG9Sb2xlUG9saWN5KHJlc29sdmVkUG9saWN5IGFzIFBvbGljeVN0YXRlbWVudCk7XG5cbn1cblxuZnVuY3Rpb24gYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKG9wdGlvbnM6IHtcbiAgZm46IE5vZGVqc0Z1bmN0aW9uLFxuICBrZXk6IHN0cmluZyxcbiAgdmFsdWU6IHN0cmluZyxcbiAgcHJlZml4Pzogc3RyaW5nLFxuICBzdWZmaXg/OiBzdHJpbmcsXG59KSB7XG5cbiAgY29uc3QgeyBmbiwga2V5LCB2YWx1ZSwgcHJlZml4ID0gJycsIHN1ZmZpeCA9ICcnIH0gPSBvcHRpb25zO1xuXG4gIGNvbnN0IGVudktleSA9IGVuc3VyZVZhbGlkRW52S2V5KGtleSwgcHJlZml4LCBzdWZmaXgpO1xuICBmbi5hZGRFbnZpcm9ubWVudChlbnZLZXksIHZhbHVlKTtcbn1cblxuLyoqXG4gKiBNZXJnZXMgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB3aXRoIHBlci1mdW5jdGlvbiByZXNvdXJjZSBhY2Nlc3MuXG4gKiBQZXItZnVuY3Rpb24gcmVzb3VyY2UgYWNjZXNzIHRha2VzIHByZWNlZGVuY2UgKGNvbWVzIGFmdGVyIGdsb2JhbCBpbiB0aGUgbWVyZ2VkIGFycmF5KS5cbiAqIERlZHVwbGljYXRpb24gaXMgaGFuZGxlZCBhdCB0aGUgcmVzb3VyY2UgbGV2ZWwgLSBpZiB0aGUgc2FtZSByZXNvdXJjZSBhcHBlYXJzIGluIGJvdGhcbiAqIGdsb2JhbCBhbmQgcGVyLWZ1bmN0aW9uIGFjY2VzcywgYm90aCBlbnRyaWVzIGFyZSBrZXB0IChhbGxvd2luZyBmb3IgZGlmZmVyZW50IGFjY2VzcyBsZXZlbHMpLlxuICogXG4gKiBAcGFyYW0gZ2xvYmFsQWNjZXNzIC0gR2xvYmFsIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uIGZyb20gZncyNFxuICogQHBhcmFtIGZ1bmN0aW9uQWNjZXNzIC0gUGVyLWZ1bmN0aW9uIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBNZXJnZWQgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAqL1xuZnVuY3Rpb24gbWVyZ2VSZXNvdXJjZUFjY2VzcyhcbiAgZ2xvYmFsQWNjZXNzOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB8IHVuZGVmaW5lZCxcbiAgZnVuY3Rpb25BY2Nlc3M6IElGdW5jdGlvblJlc291cmNlQWNjZXNzIHwgdW5kZWZpbmVkXG4pOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gIGlmICghZ2xvYmFsQWNjZXNzICYmICFmdW5jdGlvbkFjY2Vzcykge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIGlmICghZ2xvYmFsQWNjZXNzKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uQWNjZXNzITtcbiAgfVxuXG4gIGlmICghZnVuY3Rpb25BY2Nlc3MpIHtcbiAgICByZXR1cm4gZ2xvYmFsQWNjZXNzO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0YWJsZXM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnRhYmxlcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MudGFibGVzIHx8IFtdKVxuICAgIF0pLFxuICAgIGJ1Y2tldHM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLmJ1Y2tldHMgfHwgW10pLFxuICAgICAgLi4uKGZ1bmN0aW9uQWNjZXNzLmJ1Y2tldHMgfHwgW10pXG4gICAgXSksXG4gICAgcXVldWVzOiBkZWR1cGxpY2F0ZVJlc291cmNlQXJyYXkoW1xuICAgICAgLi4uKGdsb2JhbEFjY2Vzcy5xdWV1ZXMgfHwgW10pLFxuICAgICAgLi4uKGZ1bmN0aW9uQWNjZXNzLnF1ZXVlcyB8fCBbXSlcbiAgICBdKSxcbiAgICB0b3BpY3M6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnRvcGljcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MudG9waWNzIHx8IFtdKVxuICAgIF0pXG4gIH07XG59XG5cbi8qKlxuICogRGVkdXBsaWNhdGVzIHJlc291cmNlIGFycmF5IGVudHJpZXMgYnkgbmFtZSwgcHJlZmVycmluZyBlbnRyaWVzIHdpdGggZXhwbGljaXQgYWNjZXNzIG92ZXIgaW1wbGljaXQuXG4gKiBXaGVuIHRoZSBzYW1lIHJlc291cmNlIGFwcGVhcnMgbXVsdGlwbGUgdGltZXM6XG4gKiAtIElmIGJvdGggaGF2ZSBleHBsaWNpdCBhY2Nlc3MgYXJyYXlzLCBtZXJnZSB0aGUgYWNjZXNzIGFycmF5c1xuICogLSBJZiBvbmUgaGFzIGV4cGxpY2l0IGFjY2VzcyBhbmQgb25lIGRvZXNuJ3QsIHVzZSB0aGUgZXhwbGljaXQgb25lXG4gKiAtIElmIGJvdGggYXJlIHN0cmluZ3MgKGltcGxpY2l0IHJlYWR3cml0ZSksIGtlZXAgb25seSBvbmVcbiAqIFxuICogQHBhcmFtIHJlc291cmNlcyAtIEFycmF5IG9mIHJlc291cmNlIGVudHJpZXMgKHN0cmluZyBvciB7IG5hbWUsIGFjY2Vzcz8gfSlcbiAqIEByZXR1cm5zIERlZHVwbGljYXRlZCBhcnJheVxuICovXG5mdW5jdGlvbiBkZWR1cGxpY2F0ZVJlc291cmNlQXJyYXk8VCBleHRlbmRzIHN0cmluZyB8IHsgbmFtZTogc3RyaW5nOyBhY2Nlc3M/OiBzdHJpbmdbXSB9PihcbiAgcmVzb3VyY2VzOiBUW11cbik6IFRbXSB7XG4gIGlmICghcmVzb3VyY2VzIHx8IHJlc291cmNlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXNvdXJjZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBUPigpO1xuXG4gIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgY29uc3QgbmFtZSA9IHR5cGVvZiByZXNvdXJjZSA9PT0gJ3N0cmluZycgPyByZXNvdXJjZSA6IHJlc291cmNlLm5hbWU7XG4gICAgY29uc3QgZXhpc3RpbmdSZXNvdXJjZSA9IHJlc291cmNlTWFwLmdldChuYW1lKTtcblxuICAgIGlmICghZXhpc3RpbmdSZXNvdXJjZSkge1xuICAgICAgcmVzb3VyY2VNYXAuc2V0KG5hbWUsIHJlc291cmNlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTWVyZ2UgbG9naWM6IHByZWZlciBleHBsaWNpdCBhY2Nlc3Mgb3ZlciBpbXBsaWNpdFxuICAgICAgY29uc3QgZXhpc3RpbmdBY2Nlc3MgPSB0eXBlb2YgZXhpc3RpbmdSZXNvdXJjZSA9PT0gJ3N0cmluZycgPyB1bmRlZmluZWQgOiBleGlzdGluZ1Jlc291cmNlLmFjY2VzcztcbiAgICAgIGNvbnN0IG5ld0FjY2VzcyA9IHR5cGVvZiByZXNvdXJjZSA9PT0gJ3N0cmluZycgPyB1bmRlZmluZWQgOiByZXNvdXJjZS5hY2Nlc3M7XG5cbiAgICAgIGlmIChleGlzdGluZ0FjY2VzcyAmJiBuZXdBY2Nlc3MpIHtcbiAgICAgICAgLy8gQm90aCBoYXZlIGV4cGxpY2l0IGFjY2VzcyAtIG1lcmdlIGFuZCBkZWR1cGxpY2F0ZVxuICAgICAgICBjb25zdCBtZXJnZWRBY2Nlc3MgPSBBcnJheS5mcm9tKG5ldyBTZXQoWyAuLi5leGlzdGluZ0FjY2VzcywgLi4ubmV3QWNjZXNzIF0pKTtcbiAgICAgICAgcmVzb3VyY2VNYXAuc2V0KG5hbWUsIHsgbmFtZSwgYWNjZXNzOiBtZXJnZWRBY2Nlc3MgfSBhcyBUKTtcbiAgICAgIH0gZWxzZSBpZiAobmV3QWNjZXNzKSB7XG4gICAgICAgIC8vIE5ldyBoYXMgZXhwbGljaXQgYWNjZXNzLCBleGlzdGluZyBkb2Vzbid0IC0gcHJlZmVyIG5ld1xuICAgICAgICByZXNvdXJjZU1hcC5zZXQobmFtZSwgcmVzb3VyY2UpO1xuICAgICAgfVxuICAgICAgLy8gZWxzZTogZXhpc3RpbmcgaGFzIGV4cGxpY2l0IGFjY2VzcyBvciBib3RoIGltcGxpY2l0IC0ga2VlcCBleGlzdGluZ1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBBcnJheS5mcm9tKHJlc291cmNlTWFwLnZhbHVlcygpKTtcbn1cbiJdfQ==