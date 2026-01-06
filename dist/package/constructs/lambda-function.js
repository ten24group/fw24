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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQXFCQSw0Q0FFQztBQWlLRCx3Q0FnQkM7QUF4TUQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsdURBQXlDO0FBQ3pDLG1EQUErRDtBQUMvRCx3Q0FBc0Y7QUFDdEYsb0NBQWlDO0FBTWpDLFNBQWdCLGdCQUFnQixDQUFDLE1BQWlEO0lBQ2hGLE9BQVEsTUFBMEIsQ0FBQyxJQUFJLEtBQUssU0FBUyxDQUFDO0FBQ3hELENBQUM7QUFnSEQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBK0NHO0FBRUgsU0FBZ0IsY0FBYyxDQUFDLFFBQWlCO0lBQzlDLFFBQVEsUUFBUSxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUM7UUFDaEMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxNQUFNO1lBQ1QsT0FBTyxnQ0FBbUIsQ0FBQyxJQUFJLENBQUM7UUFDbEMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxNQUFNLENBQUM7UUFDWjtZQUNFLE9BQU8sZ0NBQW1CLENB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LFlBQVksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUUsR0FBRyxjQUFjLEVBQUUsR0FBRyxTQUFTLENBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQzlFLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQU8sQ0FBQyxDQUFDO1lBQzdELENBQUM7aUJBQU0sSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDckIseURBQXlEO2dCQUN6RCxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztZQUNsQyxDQUFDO1lBQ0Qsc0VBQXNFO1FBQ3hFLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0FBQzFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgRHVyYXRpb24sIFJlbW92YWxQb2xpY3kgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCwgdHlwZSBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSdW50aW1lLCBBcmNoaXRlY3R1cmUsIExheWVyVmVyc2lvbiwgQXBwbGljYXRpb25Mb2dMZXZlbCwgTG9nZ2luZ0Zvcm1hdCwgSUxheWVyVmVyc2lvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBJVGFibGVWMiwgVGFibGVWMiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgQnVja2V0IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zM1wiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIElMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0ICogYXMgRU5WX0tFWVMgZnJvbSBcIi4uL2NvbnN0L2VudlwiO1xuaW1wb3J0IHsgTG9nR3JvdXAsIFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IGVuc3VyZU5vU3BlY2lhbENoYXJzLCBlbnN1cmVTdWZmaXgsIGVuc3VyZVZhbGlkRW52S2V5IH0gZnJvbSBcIi4uL3V0aWxzL2tleXNcIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5cbnR5cGUgUmVzb3VyY2VBY2Nlc3NJdGVtID0gc3RyaW5nIHwgeyBuYW1lOiBzdHJpbmc7IGFjY2Vzcz86IHN0cmluZ1tdIH07XG5leHBvcnQgdHlwZSBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyA9IFBvbGljeVN0YXRlbWVudCB8IFBvbGljeVN0YXRlbWVudFByb3BzO1xuZXhwb3J0IHR5cGUgVEltcG9ydGVkUG9saWN5ID0geyBuYW1lOiBzdHJpbmcsIGlzT3B0aW9uYWw/OiBib29sZWFuLCBwcmVmaXg/OiBzdHJpbmcgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzSW1wb3J0ZWRQb2xpY3kocG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSk6IHBvbGljeSBpcyBUSW1wb3J0ZWRQb2xpY3kge1xuICByZXR1cm4gKHBvbGljeSBhcyBUSW1wb3J0ZWRQb2xpY3kpLm5hbWUgIT09IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBwcm9wZXJ0aWVzIGZvciBhIExhbWJkYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFGdW5jdGlvblByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBlbnRyeSBwb2ludCBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGVudHJ5OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBwb2xpY2llcyB0byBhdHRhY2ggdG8gdGhlIExhbWJkYSBmdW5jdGlvbidzIGV4ZWN1dGlvbiByb2xlLlxuICAgKi9cbiAgcG9saWNpZXM/OiBBcnJheTxUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeT47XG5cbiAgLyoqXG4gICAqIFRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gc2V0IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZW52aXJvbm1lbnRWYXJpYWJsZXM/OiB7IFsga2V5OiBzdHJpbmcgXTogc3RyaW5nIH07XG5cbiAgLyoqXG4gICAqIFRoZSByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIHJlc291cmNlQWNjZXNzPzogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIEluZGljYXRlcyB3aGV0aGVyIHRoZSBMYW1iZGEgZnVuY3Rpb24gaXMgYWxsb3dlZCB0byBzZW5kIGVtYWlscy5cbiAgICovXG4gIGFsbG93U2VuZEVtYWlsPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBkYXlzIHRvIHJldGFpbiB0aGUgbG9ncyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGxvZ1JldGVudGlvbkRheXM/OiBSZXRlbnRpb25EYXlzO1xuXG4gIC8qKlxuICAgKiBUaGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24ncyBsb2dzLlxuICAgKi9cbiAgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgLyoqXG4gICAqIFRoZSB0aW1lb3V0IGR1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGluIHNlY29uZHMuXG4gICAqIFVzZSB0aGlzIHRpbWVvdXQgdG8gYXZvaWQgaW1wb3J0aW5nIHRoZSBkdXJhdGlvbiBjbGFzcyBmcm9tIGF3cy1jZGstbGliLlxuICAgKi9cbiAgZnVuY3Rpb25UaW1lb3V0PzogbnVtYmVyO1xuXG4gIHByb2Nlc3NvckFyY2hpdGVjdHVyZT86ICd4ODZfNjQnIHwgJ2FybV82NCc7XG5cbiAgLyoqXG4gICAqIEFkZGl0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZnVuY3Rpb25Qcm9wcz86IE9taXQ8Tm9kZWpzRnVuY3Rpb25Qcm9wcywgJ2xheWVycyc+ICYge1xuICAgIHJlYWRvbmx5IGxheWVycz86IEFycmF5PElMYXllclZlcnNpb24gfCBzdHJpbmc+O1xuICB9XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIHJlc291cmNlIGFjY2VzcyBlbnRyeSAtIGVpdGhlciBhIHNpbXBsZSBzdHJpbmcgbmFtZSBvciBhbiBvYmplY3Qgd2l0aCBuYW1lIGFuZCBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gKi9cbmV4cG9ydCB0eXBlIFRSZXNvdXJjZUFjY2Vzc0VudHJ5ID0gc3RyaW5nIHwgeyBuYW1lOiBzdHJpbmc7IGFjY2Vzcz86IHN0cmluZ1tdIH07XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYWNjZXNzIHBlcm1pc3Npb25zIGZvciB2YXJpb3VzIHJlc291cmNlcyB0aGF0IGNhbiBiZSBhY2Nlc3NlZCBieSBhIGZ1bmN0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElGdW5jdGlvblJlc291cmNlQWNjZXNzIHtcbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdGFibGVzLlxuICAgKiBFYWNoIHRhYmxlIGNhbiBiZSBhIHN0cmluZyAobmFtZSBvbmx5LCBkZWZhdWx0cyB0byByZWFkd3JpdGUpIG9yIGFuIG9iamVjdCB3aXRoIG5hbWUgYW5kIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3JlYWQnLCAnd3JpdGUnLCBvciAncmVhZHdyaXRlJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdyZWFkd3JpdGUnLlxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogdGFibGVzOiBbJ3VzZXJzLXRhYmxlJywgeyBuYW1lOiAnb3JkZXJzLXRhYmxlJywgYWNjZXNzOiBbJ3JlYWQnXSB9XVxuICAgKi9cbiAgdGFibGVzPzogVFJlc291cmNlQWNjZXNzRW50cnlbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciBidWNrZXRzLlxuICAgKiBFYWNoIGJ1Y2tldCBjYW4gYmUgYSBzdHJpbmcgKG5hbWUgb25seSwgZGVmYXVsdHMgdG8gcmVhZHdyaXRlKSBvciBhbiBvYmplY3Qgd2l0aCBuYW1lIGFuZCBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdyZWFkJywgJ3dyaXRlJywgb3IgJ3JlYWR3cml0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncmVhZHdyaXRlJy5cbiAgICogXG4gICAqIEBleGFtcGxlXG4gICAqIGJ1Y2tldHM6IFsnYXNzZXRzLWJ1Y2tldCcsIHsgbmFtZTogJ2xvZ3MtYnVja2V0JywgYWNjZXNzOiBbJ3dyaXRlJ10gfV1cbiAgICovXG4gIGJ1Y2tldHM/OiBUUmVzb3VyY2VBY2Nlc3NFbnRyeVtdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHRvcGljcy5cbiAgICogRWFjaCB0b3BpYyBjYW4gYmUgYSBzdHJpbmcgKG5hbWUgb25seSwgZGVmYXVsdHMgdG8gcHVibGlzaCkgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncHVibGlzaCcuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncHVibGlzaCcuXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiB0b3BpY3M6IFsnZXZlbnRzLXRvcGljJywgeyBuYW1lOiAnbm90aWZpY2F0aW9ucy10b3BpYycsIGFjY2VzczogWydwdWJsaXNoJ10gfV1cbiAgICovXG4gIHRvcGljcz86IFRSZXNvdXJjZUFjY2Vzc0VudHJ5W107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgcXVldWVzLlxuICAgKiBFYWNoIHF1ZXVlIGNhbiBiZSBhIHN0cmluZyAobmFtZSBvbmx5LCBkZWZhdWx0cyB0byBzZW5kKSBvciBhbiBvYmplY3Qgd2l0aCBuYW1lIGFuZCBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdzZW5kJywgJ3JlY2VpdmUnLCBvciAnZGVsZXRlJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdzZW5kJy5cbiAgICogXG4gICAqIEBleGFtcGxlXG4gICAqIHF1ZXVlczogWydub3RpZmljYXRpb25zLXF1ZXVlJywgeyBuYW1lOiAncHJvY2Vzc2luZy1xdWV1ZScsIGFjY2VzczogWydzZW5kJywgJ3JlY2VpdmUnXSB9XVxuICAgKi9cbiAgcXVldWVzPzogVFJlc291cmNlQWNjZXNzRW50cnlbXTtcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBMYW1iZGEgZnVuY3Rpb24gY29uc3RydWN0LlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQ3JlYXRlIGEgTGFtYmRhIGZ1bmN0aW9uIHdpdGggY3VzdG9tIHByb3BlcnRpZXNcbiAqIGNvbnN0IGxhbWJkYVByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzID0ge1xuICogICBlbnRyeTogXCJpbmRleC5qc1wiLFxuICogICBwb2xpY2llczogW3tcbiAqICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gKiAgICAgICAgIGFjdGlvbnM6IFtcbiAqICAgICAgICAgIFwiczM6R2V0T2JqZWN0XCJcbiAqICAgICAgICAgXSxcbiAqICAgICAgICAgcmVzb3VyY2VzOiBbXCJhcm46YXdzOnMzOjo6bXktYnVja2V0LypcIl0sXG4gKiAgICAgfSwgXG4gKiAgICAge1xuICogICAgICAgcG9saWN5OiBcImF1dGhNb2R1bGU6Y3JlYXRlLXVzZXItYXV0aC1yZWNvcmRcIixcbiAqICAgICAgIGlzT3B0aW9uYWw6IHRydWVcbiAqICAgICB9XG4gKiAgIF0sXG4gKiAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gKiAgICAgTVlfRU5WX1ZBUjogXCJteS12YWx1ZVwiLFxuICogICB9LFxuICogICByZXNvdXJjZUFjY2Vzczoge1xuICogICAgIHRhYmxlczogW1xuICogICAgICAge1xuICogICAgICAgICBuYW1lOiBcIm15LXRhYmxlXCIsXG4gKiAgICAgICAgIGFjY2VzczogW1wicmVhZFwiLCBcIndyaXRlXCJdLFxuICogICAgICAgfSxcbiAqICAgICBdLFxuICogICAgIGJ1Y2tldHM6IFtcIm15LWJ1Y2tldFwiXSxcbiAqICAgICB0b3BpY3M6IFtcIm15LXRvcGljXCJdLFxuICogICAgIHF1ZXVlczogW1wibXktcXVldWVcIl0sXG4gKiAgIH0sXG4gKiAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICogICBsb2dSZXRlbnRpb25EYXlzOiBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICogICBsb2dSZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gKiAgIGZ1bmN0aW9uVGltZW91dDogMTAsXG4gKiAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAqICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuICogICAgIG1lbW9yeVNpemU6IDI1NixcbiAqICAgfSxcbiAqIH07XG4gKlxuICogY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssIFwiTXlMYW1iZGFGdW5jdGlvblwiLCBsYW1iZGFQcm9wcyk7XG4gKiBcbiAqIGBgYFxuICovXG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRMb2dMZXZlbChsb2dMZXZlbD86IHN0cmluZykge1xuICBzd2l0Y2ggKGxvZ0xldmVsPy50b1VwcGVyQ2FzZSgpKSB7XG4gICAgY2FzZSAnRVJST1InOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuRVJST1I7XG4gICAgY2FzZSAnV0FSTic6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5XQVJOO1xuICAgIGNhc2UgJ0RFQlVHJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkRFQlVHO1xuICAgIGNhc2UgJ1RSQUNFJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLlRSQUNFO1xuICAgIGNhc2UgJ0ZBVEFMJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkZBVEFMO1xuICAgIGNhc2UgJ0lORk8nOlxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5JTkZPXG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYUZ1bmN0aW9uIGV4dGVuZHMgQ29uc3RydWN0IHtcblxuICByZWFkb25seSBsb2dnZXI/OiBJTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdMYW1iZGFGdW5jdGlvbicpO1xuXG4gIC8qKlxuICAgKiBDb25zdHJ1Y3RzIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBMYW1iZGFGdW5jdGlvbiBjbGFzcy5cbiAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3QuXG4gICAqIEBwYXJhbSBpZCAtIFRoZSBJRCBvZiB0aGUgY29uc3RydWN0LlxuICAgKiBAcGFyYW0gcHJvcHMgLSBUaGUgTGFtYmRhIGZ1bmN0aW9uIHByb3BlcnRpZXMuXG4gICAqIEByZXR1cm5zIFRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTGFtYmRhRnVuY3Rpb25Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgLy8gRGVmYXVsdCBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvblxuICAgIGxldCBkZWZhdWx0UHJvcHM6IE5vZGVqc0Z1bmN0aW9uUHJvcHMgPSB7XG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuQVJNXzY0LFxuICAgICAgaGFuZGxlcjogXCJoYW5kbGVyXCIsXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogcHJvY2Vzcy5lbnYuTE9HX0ZPUk1BVD8udG9Mb3dlckNhc2U/LigpID09PSAnanNvbicgPyBMb2dnaW5nRm9ybWF0LkpTT04gOiBMb2dnaW5nRm9ybWF0LlRFWFQsXG4gICAgICAuLi5mdzI0LmdldENvbmZpZygpLmZ1bmN0aW9uUHJvcHMgYXMgTm9kZWpzRnVuY3Rpb25Qcm9wcyxcbiAgICB9O1xuXG4gICAgLy8gICdFcnJvcicgIFRvIHVzZSBBcHBsaWNhdGlvbkxvZ0xldmVsIGFuZC9vciBTeXN0ZW1Mb2dMZXZlbCB5b3UgbXVzdCBzZXQgTG9nZ2luZ0Zvcm1hdCB0byAnSlNPTicsIGdvdCAnVGV4dCcuXG4gICAgaWYgKGRlZmF1bHRQcm9wcy5sb2dnaW5nRm9ybWF0ID09PSBMb2dnaW5nRm9ybWF0LkpTT04pIHtcbiAgICAgIGRlZmF1bHRQcm9wcyA9IHtcbiAgICAgICAgLi4uZGVmYXVsdFByb3BzLFxuICAgICAgICBhcHBsaWNhdGlvbkxvZ0xldmVsVjI6IGZvcm1hdExvZ0xldmVsKHByb2Nlc3MuZW52LkxPR19MRVZFTClcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGxvZyBncm91cCBpZiBub3QgcHJvdmlkZWRcbiAgICBsZXQgbG9nR3JvdXAgPSBwcm9wcy5mdW5jdGlvblByb3BzPy5sb2dHcm91cDtcbiAgICBpZiAoIWxvZ0dyb3VwKSB7XG4gICAgICBsZXQgbG9nUmV0ZW50aW9uRGF5cyA9IHByb3BzLmxvZ1JldGVudGlvbkRheXMgfHwgZncyNC5nZXRDb25maWcoKS5sb2dSZXRlbnRpb25EYXlzIHx8IDMwO1xuICAgICAgbG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcywgYCR7aWR9LUxvZ0dyb3VwYCwge1xuICAgICAgICByZW1vdmFsUG9saWN5OiBwcm9wcy5sb2dSZW1vdmFsUG9saWN5IHx8IGZ3MjQuZ2V0Q29uZmlnKCkubG9nUmVtb3ZhbFBvbGljeSB8fCBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgcmV0ZW50aW9uOiBwYXJzZUludChsb2dSZXRlbnRpb25EYXlzLnRvU3RyaW5nKCkpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgYWRkaXRpb25hbFByb3BzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgZW50cnk6IHByb3BzLmVudHJ5LFxuICAgIH1cblxuICAgIC8vIGNvbGxlY3QgdGhlIG5hbWVzIG9mIHRoZSBsYXllcnMgcHJvdmlkZWQgaW4gZGVmYXVsdCBjb25maWcgaWYgYW55IG9yIGVsc2UgdGhlIGdsb2JhbCBsYXllcnM7XG4gICAgY29uc3QgZGVmYXVsdExheWVycyA9IGRlZmF1bHRQcm9wcz8ubGF5ZXJzID8/IEFycmF5LmZyb20oZncyNC5nZXRHbG9iYWxMYW1iZGFMYXllck5hbWVzKCkpO1xuXG4gICAgLy8gcmVzb2x2ZSBsYXllciBuYW1lcyB0byBhY3R1YWwgbGF5ZXIgYXJuc1xuICAgIGNvbnN0IGxheWVycyA9IFtcbiAgICAgIC4uLmRlZmF1bHRMYXllcnMsXG4gICAgICAvLyBjb2xsZWN0IHRoZSBuYW1lcyBvZiB0aGUgbGF5ZXJzIHByb3ZpZGVkIGluIGZ1bmN0aW9uIGNvbmZpZyBpZiBhbnk7XG4gICAgICAuLi4ocHJvcHMuZnVuY3Rpb25Qcm9wcz8ubGF5ZXJzID8/IFtdKVxuICAgIF0gYXMgQXJyYXk8c3RyaW5nIHwgSUxheWVyVmVyc2lvbj47XG5cbiAgICAvLyByZW1vdmUgZHVwbGljYXRlc1xuICAgIGNvbnN0IGRlRHVwTGF5ZXJzID0gQXJyYXkuZnJvbShuZXcgU2V0KGxheWVycykpO1xuXG4gICAgLy8gRW5zdXJlIGZ3MjQgbGF5ZXIgaXMgaW5jbHVkZWQgKGlmIG5vdCBhbHJlYWR5IGluIHRoZSBsaXN0KVxuICAgIGlmICghZGVEdXBMYXllcnMuaW5jbHVkZXMoJ2Z3MjQnKSkge1xuICAgICAgZGVEdXBMYXllcnMucHVzaCgnZncyNCcpO1xuICAgIH1cblxuICAgIC8vIG1hcCBsYXllcnMgdG8gYWN0dWFsIGxheWVyIG9iamVjdHNcbiAgICBjb25zdCByZXNvbHZlZExheWVycyA9IGRlRHVwTGF5ZXJzLm1hcChsYXllck5hbWUgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBsYXllck5hbWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCBgJHtpZH0tJHtsYXllck5hbWV9LUxheWVyYCwgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGxheWVyTmFtZSArICdfbGF5ZXJWZXJzaW9uQXJuJywgJ2xheWVyJywgc2NvcGUpKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxheWVyTmFtZTtcbiAgICB9KVxuXG4gICAgYWRkaXRpb25hbFByb3BzLmxheWVycyA9IHJlc29sdmVkTGF5ZXJzO1xuXG4gICAgYWRkaXRpb25hbFByb3BzLmJ1bmRsaW5nID0gbWVyZ2UoW1xuICAgICAgZGVmYXVsdFByb3BzLmJ1bmRsaW5nID8/IHt9LFxuICAgICAgcHJvcHMuZnVuY3Rpb25Qcm9wcz8uYnVuZGxpbmcgPz8ge30sXG4gICAgICB7XG4gICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgLi4uKGRlZmF1bHRQcm9wcz8uYnVuZGxpbmc/LmV4dGVybmFsTW9kdWxlcyA/PyBbXSksXG4gICAgICAgICAgLi4uKHByb3BzLmZ1bmN0aW9uUHJvcHM/LmJ1bmRsaW5nPy5leHRlcm5hbE1vZHVsZXMgPz8gW10pLFxuICAgICAgICAgIFwiQHRlbjI0Z3JvdXAvZncyNFwiXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgXSkhO1xuICAgIGFkZGl0aW9uYWxQcm9wcy5sb2dHcm91cCA9IGxvZ0dyb3VwO1xuICAgIGlmIChwcm9wcy5mdW5jdGlvblRpbWVvdXQpIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wcy50aW1lb3V0ID0gRHVyYXRpb24uc2Vjb25kcyhwcm9wcy5mdW5jdGlvblRpbWVvdXQpO1xuICAgIH1cblxuICAgIGlmIChwcm9wcy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUpIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wcy5hcmNoaXRlY3R1cmUgPSBwcm9wcy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUgPT09ICd4ODZfNjQnID8gQXJjaGl0ZWN0dXJlLlg4Nl82NCA6IEFyY2hpdGVjdHVyZS5BUk1fNjQ7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHRoZSBOb2RlLmpzIGZ1bmN0aW9uXG4gICAgY29uc3QgZm4gPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgaWQsIG1lcmdlKFtcbiAgICAgIGRlZmF1bHRQcm9wcyxcbiAgICAgIHByb3BzLmZ1bmN0aW9uUHJvcHMgPz8ge30sXG4gICAgICBhZGRpdGlvbmFsUHJvcHNcbiAgICBdKSEpO1xuXG4gICAgcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMgPSBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcyA/PyB7fTtcblxuICAgIC8vICogRVhQT1JUIHRoZSBsb2ctbGV2ZWwgZm9yIG91ciBsb2dnZXItaW5zdGFuY2VzIGluIHRoZSBydW50aW1lIG9mIHRoaXMgbGFtYmRhXG4gICAgLy8gU2VlICcuLi9sb2dnaW5nL2luZGV4LnRzJyBmb3IgbW9yZSBpbmZvXG4gICAgLy8gTk9URTogdGhpcyBsb2ctbGV2ZWwgaXMgZGlmZmVyZW50IHRoYW4gdGhlIGF3cy1sb2ctbGV2ZWxcbiAgICAvLyBhd3MgcmVxdWlyZXMgdGhlIGxvZyBmb3JtYXQgc2V0IHRvIEpTT04gdG8gb3ZlcnJpZGUgbG9nLWxldmVsIHNlZSBgYXBwbGljYXRpb25Mb2dMZXZlbFYyYCBpbiB0aGUgY29kZSBhYm92ZVxuXG4gICAgLy8gZW5zdXJlIHRoZSBlbnZpcm9ubWVudC12YXJpYWJsZXMgZm9yIHRoZSBsYW1iZGEgYWx3YXlzIGhhdmUgYSBsb2ctbGV2ZWxcbiAgICBpZiAoISgnTE9HX0xFVkVMJyBpbiBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcykpIHtcbiAgICAgIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzWyAnTE9HX0xFVkVMJyBdID0gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdMT0dfTEVWRUwnKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcykpIHtcbiAgICAgIGxldCBlbnZWYWx1ZSA9IHZhbHVlO1xuICAgICAgbGV0IGVudktleSA9IGtleTtcbiAgICAgIC8vIElmIGtleSBpcyBwcmVmaXhlZCB3aXRoIGZ3MjRfLCBhY2Nlc3MgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZyb20gZncyNCBzY29wZVxuICAgICAgLy8ga2V5cyBjYW4gaGF2ZSBzaGFwZSBsaWtlOlxuICAgICAgLy8gZncyNF94eHggKHdpdGhvdXQgc2NvcGUpXG4gICAgICAvLyBmdzI0X0F1dGhNb2R1bGVfeHh4ICh3aXRoIHNjb3BlOiBBdXRoTW9kdWxlKVxuICAgICAgLy8gZncyNF9Vc2VyUG9vbF9BdXRoTW9kdWxlX3VzZXJQb29sSWQgKHdpdGggc2NvcGU6IFVzZXJQb29sX0F1dGhNb2R1bGUpXG4gICAgICBpZiAodmFsdWUgJiYgdmFsdWUuc3RhcnRzV2l0aCgnZncyNF8nKSkge1xuICAgICAgICAvLyBSZW1vdmUgZncyNF8gcHJlZml4XG4gICAgICAgIGNvbnN0IGtleVdpdGhvdXRQcmVmaXggPSB2YWx1ZS5yZXBsYWNlKCdmdzI0XycsICcnKTtcbiAgICAgICAgY29uc3QgcGFydHMgPSBrZXlXaXRob3V0UHJlZml4LnNwbGl0KCdfJyk7XG5cbiAgICAgICAgLy8gTGFzdCBwYXJ0IGlzIGFsd2F5cyB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZVxuICAgICAgICBjb25zdCBlbnZWYXJOYW1lID0gcGFydHNbIHBhcnRzLmxlbmd0aCAtIDEgXTtcblxuICAgICAgICAvLyBFdmVyeXRoaW5nIGJlZm9yZSB0aGUgbGFzdCBwYXJ0IGlzIHRoZSBzY29wZSAoaWYgYW55KVxuICAgICAgICBjb25zdCBzY29wZSA9IHBhcnRzLmxlbmd0aCA+IDEgPyBwYXJ0cy5zbGljZSgwLCAtMSkuam9pbignXycpIDogJyc7XG5cbiAgICAgICAgZW52VmFsdWUgPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoZW52VmFyTmFtZSwgc2NvcGUpO1xuICAgICAgICB0aGlzLmxvZ2dlcj8uZGVidWcoYFJlc29sdmVkIGZ3MjQgZW52aXJvbm1lbnQgdmFyaWFibGU6ICR7dmFsdWV9IC0+ICR7ZW52VmFsdWV9YCwgaWQpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxvZ2dlcj8uZGVidWcoYDpTRVQgZW52aXJvbm1lbnQgdmFyaWFibGUgWyR7ZW52S2V5fSA6ICR7ZW52VmFsdWV9XWAsIGlkKTtcblxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogZW52S2V5LFxuICAgICAgICB2YWx1ZTogZW52VmFsdWVcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEFkZCBnbG9iYWwgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIHRoZSBmdW5jdGlvblxuICAgIGZ3MjQuZ2V0R2xvYmFsRW52aXJvbm1lbnRWYXJpYWJsZXMoKS5mb3JFYWNoKGVudktleSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlcj8uZGVidWcoYEFkZGluZyBnbG9iYWwgZW52aXJvbm1lbnQgdmFyaWFibGU6ICR7ZW52S2V5fWAsIGlkKTtcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGVudktleSxcbiAgICAgICAgdmFsdWU6IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZLZXkpXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEF1dG8tc2V0IEVOVFJZX1BBQ0tBR0VTIGZvciBBTEwgTGFtYmRhcyAoZW5zdXJlcyBESSBpbml0aWFsaXphdGlvbilcbiAgICAvLyBPbmx5IHNldCBpZiBub3QgYWxyZWFkeSBjb25maWd1cmVkIGluIHByb3BzIG9yIGdsb2JhbCBlbnYgdmFyc1xuICAgIGNvbnN0IGdsb2JhbEVudktleXMgPSBmdzI0LmdldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKCk7XG4gICAgaWYgKFxuICAgICAgIShFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUyBpbiBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcylcbiAgICAgICYmXG4gICAgICAhZ2xvYmFsRW52S2V5cy5pbmNsdWRlcyhFTlZfS0VZUy5FTlRSWV9QQUNLQUdFUylcbiAgICApIHtcbiAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXMgPSBmdzI0LmdldExhbWJkYUVudHJ5UGFja2FnZXMoKTtcbiAgICAgIGlmIChlbnRyeVBhY2thZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gUmVzb2x2ZSBlbnYga2V5IHRlbXBsYXRlcyAoZS5nLiwgZW52OmxheWVySW1wb3J0UGF0aDpkaSAtPiAvb3B0L25vZGVqcy9ub2RlX21vZHVsZXMvZGkvaW5kZXguanMpXG4gICAgICAgIGNvbnN0IHJlc29sdmVkUGFja2FnZXMgPSBlbnRyeVBhY2thZ2VzLm1hcChwa2cgPT4gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUocGtnKSk7XG4gICAgICAgIGNvbnN0IGVudHJ5UGFja2FnZXNWYWx1ZSA9IHJlc29sdmVkUGFja2FnZXMuam9pbignLCcpO1xuICAgICAgICB0aGlzLmxvZ2dlcj8uZGVidWcoYEF1dG8tc2V0dGluZyBFTlRSWV9QQUNLQUdFUzogJHtlbnRyeVBhY2thZ2VzVmFsdWV9YCwgaWQpO1xuICAgICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICAgIGZuLFxuICAgICAgICAgIGtleTogRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMsXG4gICAgICAgICAgdmFsdWU6IGVudHJ5UGFja2FnZXNWYWx1ZVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBZGQgZ2xvYmFsIHBvbGljaWVzIHRvIHRoZSBmdW5jdGlvblxuICAgIGZ3MjQuZ2V0R2xvYmFsUG9saWNpZXMoKS5mb3JFYWNoKHBvbGljeSA9PiB7XG4gICAgICBhZGRQb2xpY3lUb0Z1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGZ3MjQsXG4gICAgICAgIHBvbGljeVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBBdHRhY2ggcG9saWNpZXMgdG8gdGhlIGZ1bmN0aW9uXG4gICAgKHByb3BzLnBvbGljaWVzID8/IFtdKS5mb3JFYWNoKHBvbGljeSA9PiB7XG4gICAgICBhZGRQb2xpY3lUb0Z1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGZ3MjQsXG4gICAgICAgIHBvbGljeVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBNZXJnZSBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIHdpdGggcGVyLWZ1bmN0aW9uIHJlc291cmNlIGFjY2Vzc1xuICAgIGNvbnN0IGdsb2JhbFJlc291cmNlQWNjZXNzID0gZncyNC5nZXRHbG9iYWxSZXNvdXJjZUFjY2VzcygpO1xuICAgIGNvbnN0IG1lcmdlZFJlc291cmNlQWNjZXNzID0gbWVyZ2VSZXNvdXJjZUFjY2VzcyhnbG9iYWxSZXNvdXJjZUFjY2VzcywgcHJvcHMucmVzb3VyY2VBY2Nlc3MpO1xuXG4gICAgLy8gSWYgd2UgYXJlIHVzaW5nIFNFUywgdGhlbiB3ZSBuZWVkIHRvIGFkZCB0aGUgZW1haWwgcXVldWUgdXJsIHRvIHRoZSBlbnZpcm9ubWVudFxuICAgIGlmIChwcm9wcy5hbGxvd1NlbmRFbWFpbCAmJiBmdzI0LmVtYWlsUHJvdmlkZXIgaW5zdGFuY2VvZiBNYWlsZXJDb25zdHJ1Y3QpIHtcbiAgICAgIGNvbnN0IGVtYWlsUXVldWVOYW1lID0gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKCdlbWFpbFF1ZXVlX3F1ZXVlTmFtZScsICdxdWV1ZScsIHNjb3BlKTtcbiAgICAgIGNvbnN0IGVtYWlsUXVldWUgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcywgYCR7aWR9LSR7ZW1haWxRdWV1ZU5hbWV9LXF1ZXVlYCwgZncyNC5nZXRBcm4oJ3NxcycsIGVtYWlsUXVldWVOYW1lKSk7XG5cbiAgICAgIGVtYWlsUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoZm4pO1xuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYEVNQUlMX1FVRVVFX1VSTGAsXG4gICAgICAgIHZhbHVlOiBlbWFpbFF1ZXVlLnF1ZXVlVXJsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIER5bmFtb0RCIHRhYmxlIGFjY2VzcyB0byB0aGUgY29udHJvbGxlclxuICAgIG1lcmdlZFJlc291cmNlQWNjZXNzPy50YWJsZXM/LmZvckVhY2goKHRhYmxlOiBSZXNvdXJjZUFjY2Vzc0l0ZW0pID0+IHtcbiAgICAgIGxldCB0YWJsZU5hbWUgPSB0eXBlb2YgdGFibGUgPT09ICdzdHJpbmcnID8gdGFibGUgOiB0YWJsZS5uYW1lO1xuXG4gICAgICAvLyBlbnN1cmUgdGhlIHBsYWNlaG9sZGVyIGVudiBrZXlzIGFyZSByZXNvbHZlZCBmcm9tIHRoZSBmdzI0IHNjb3BlXG4gICAgICB0YWJsZU5hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZSh0YWJsZU5hbWUpO1xuXG4gICAgICBjb25zdCBhcHBRdWFsaWZpZWRUYWJsZU5hbWUgPSBlbnN1cmVOb1NwZWNpYWxDaGFycyhlbnN1cmVTdWZmaXgodGFibGVOYW1lLCBgdGFibGVgKSk7XG5cbiAgICAgIGNvbnN0IGFjY2VzcyA9IHR5cGVvZiB0YWJsZSA9PT0gJ3N0cmluZycgPyBbICdyZWFkd3JpdGUnIF0gOiB0YWJsZS5hY2Nlc3MgfHwgWyAncmVhZHdyaXRlJyBdO1xuICAgICAgLy8gR2V0IHRoZSBEeW5hbW9EQiB0YWJsZSBiYXNlZCBvbiB0aGUgY29udHJvbGxlciBjb25maWdcbiAgICAgIGNvbnN0IHRhYmxlSW5zdGFuY2U6IElUYWJsZVYyID0gVGFibGVWMi5mcm9tVGFibGVBdHRyaWJ1dGVzKHRoaXMsIGAke2lkfS0ke3RhYmxlTmFtZX0tdGFibGVgLCB7XG4gICAgICAgIHRhYmxlTmFtZTogZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGFwcFF1YWxpZmllZFRhYmxlTmFtZSArICdfdGFibGVOYW1lJywgJ3RhYmxlJywgc2NvcGUpLFxuICAgICAgICBncmFudEluZGV4UGVybWlzc2lvbnM6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIHRoZSB0YWJsZSBuYW1lIHRvIHRoZSBsYW1iZGEgZW52aXJvbm1lbnQgICAgICBcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke2FwcFF1YWxpZmllZFRhYmxlTmFtZX1gLFxuICAgICAgICB2YWx1ZTogdGFibGVJbnN0YW5jZS50YWJsZU5hbWVcbiAgICAgIH0pO1xuXG4gICAgICAvLyBHcmFudCB0aGUgbGFtYmRhIGZ1bmN0aW9uIHJlYWQgd3JpdGUgYWNjZXNzIHRvIHRoZSB0YWJsZVxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWFkJzpcbiAgICAgICAgICAgIHRhYmxlSW5zdGFuY2UuZ3JhbnRSZWFkRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd3cml0ZSc6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50V3JpdGVEYXRhKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50UmVhZFdyaXRlRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIFMzIGJ1Y2tldCBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8uYnVja2V0cz8uZm9yRWFjaCgoYnVja2V0OiBSZXNvdXJjZUFjY2Vzc0l0ZW0pID0+IHtcbiAgICAgIGxldCBidWNrZXROYW1lID0gdHlwZW9mIGJ1Y2tldCA9PT0gJ3N0cmluZycgPyBidWNrZXQgOiBidWNrZXQubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgYnVja2V0TmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKGJ1Y2tldE5hbWUpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgYnVja2V0ID09PSAnc3RyaW5nJyA/IFsgJ3JlYWR3cml0ZScgXSA6IGJ1Y2tldC5hY2Nlc3MgfHwgWyAncmVhZHdyaXRlJyBdO1xuXG4gICAgICBjb25zdCBidWNrZXRGdWxsTmFtZSA9IGZ3MjQuZ2V0VW5pcXVlTmFtZShidWNrZXROYW1lKTtcbiAgICAgIGNvbnN0IGJ1Y2tldEluc3RhbmNlID0gQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsIGJ1Y2tldE5hbWUgKyBpZCArICctYnVja2V0JywgYnVja2V0RnVsbE5hbWUpO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIGJ1Y2tldFxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWFkJzpcbiAgICAgICAgICAgIGJ1Y2tldEluc3RhbmNlLmdyYW50UmVhZChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd3cml0ZSc6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFdyaXRlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFJlYWRXcml0ZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGJ1Y2tldCBuYW1lXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgYnVja2V0XyR7YnVja2V0TmFtZX1gLFxuICAgICAgICB2YWx1ZTogYnVja2V0RnVsbE5hbWVcbiAgICAgIH0pO1xuXG4gICAgfSk7XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIFNRUyBxdWV1ZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8ucXVldWVzPy5mb3JFYWNoKChxdWV1ZTogUmVzb3VyY2VBY2Nlc3NJdGVtKSA9PiB7XG4gICAgICBsZXQgcXVldWVOYW1lID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IHF1ZXVlIDogcXVldWUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgcXVldWVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUocXVldWVOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IFsgJ3NlbmQnIF0gOiBxdWV1ZS5hY2Nlc3MgfHwgWyAnc2VuZCcgXTtcblxuICAgICAgY29uc3QgcXVldWVBcm4gPSBmdzI0LmdldEFybignc3FzJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcywgcXVldWVOYW1lICsgaWQgKyAnLXF1ZXVlJywgcXVldWVBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHF1ZXVlXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ3JlY2VpdmUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudENvbnN1bWVNZXNzYWdlcyhmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFB1cmdlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgcXVldWUgdXJsXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHtxdWV1ZU5hbWV9X3F1ZXVlVXJsYCxcbiAgICAgICAgdmFsdWU6IHF1ZXVlSW5zdGFuY2UucXVldWVVcmxcbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgU05TIHRvcGljIHBlcm1pc3Npb25cbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8udG9waWNzPy5mb3JFYWNoKCh0b3BpYzogUmVzb3VyY2VBY2Nlc3NJdGVtKSA9PiB7XG4gICAgICBsZXQgdG9waWNOYW1lID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IHRvcGljIDogdG9waWMubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdG9waWNOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodG9waWNOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IFsgJ3B1Ymxpc2gnIF0gOiB0b3BpYy5hY2Nlc3MgfHwgWyAncHVibGlzaCcgXTtcblxuICAgICAgY29uc3QgdG9waWNBcm4gPSBmdzI0LmdldEFybignc25zJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSArICdfdG9waWNOYW1lJywgJ3RvcGljJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcywgdG9waWNOYW1lICsgaWQgKyAnLXRvcGljJywgdG9waWNBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHRvcGljXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICB0b3BpY0luc3RhbmNlLmdyYW50UHVibGlzaChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSB0b3BpYyBhcm5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke3RvcGljTmFtZX1fdG9waWNBcm5gLFxuICAgICAgICB2YWx1ZTogdG9waWNJbnN0YW5jZS50b3BpY0FyblxuICAgICAgfSlcbiAgICB9KTtcblxuICAgIHJldHVybiBmbjtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRQb2xpY3lUb0Z1bmN0aW9uKG9wdGlvbnM6IHtcbiAgZm46IE5vZGVqc0Z1bmN0aW9uLFxuICBmdzI0OiBGdzI0LFxuICBwb2xpY3k6IFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzIHwgVEltcG9ydGVkUG9saWN5LFxufSkge1xuICBjb25zdCB7IGZuLCBmdzI0LCBwb2xpY3kgfSA9IG9wdGlvbnM7XG5cbiAgbGV0IHJlc29sdmVkUG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSA9IHBvbGljeTtcblxuICBpZiAoaXNJbXBvcnRlZFBvbGljeShwb2xpY3kpKSB7XG4gICAgY29uc3QgcG9saWN5RXhpc3RzID0gZncyNC5oYXNQb2xpY3kocG9saWN5Lm5hbWUsIHBvbGljeS5wcmVmaXgpO1xuXG4gICAgaWYgKCFwb2xpY3lFeGlzdHMpIHtcbiAgICAgIGlmIChwb2xpY3kuaXNPcHRpb25hbCkge1xuICAgICAgICAvLyBTa2lwIG9wdGlvbmFsIHBvbGljaWVzIHRoYXQgZG9uJ3QgZXhpc3RcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQb2xpY3kgJHtwb2xpY3kubmFtZX0gbm90IGZvdW5kIGluIGZ3MjQgc2NvcGVgKTtcbiAgICB9XG5cbiAgICByZXNvbHZlZFBvbGljeSA9IGZ3MjQuZ2V0UG9saWN5KHBvbGljeS5uYW1lLCBwb2xpY3kucHJlZml4KSBhcyBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudDtcbiAgfVxuXG4gIGlmICghKHJlc29sdmVkUG9saWN5IGluc3RhbmNlb2YgUG9saWN5U3RhdGVtZW50KSkge1xuICAgIHJlc29sdmVkUG9saWN5ID0gbmV3IFBvbGljeVN0YXRlbWVudChyZXNvbHZlZFBvbGljeSBhcyBQb2xpY3lTdGF0ZW1lbnRQcm9wcyk7XG4gIH1cblxuICBmbi5hZGRUb1JvbGVQb2xpY3kocmVzb2x2ZWRQb2xpY3kgYXMgUG9saWN5U3RhdGVtZW50KTtcblxufVxuXG5mdW5jdGlvbiBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24ob3B0aW9uczoge1xuICBmbjogTm9kZWpzRnVuY3Rpb24sXG4gIGtleTogc3RyaW5nLFxuICB2YWx1ZTogc3RyaW5nLFxuICBwcmVmaXg/OiBzdHJpbmcsXG4gIHN1ZmZpeD86IHN0cmluZyxcbn0pIHtcblxuICBjb25zdCB7IGZuLCBrZXksIHZhbHVlLCBwcmVmaXggPSAnJywgc3VmZml4ID0gJycgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgZW52S2V5ID0gZW5zdXJlVmFsaWRFbnZLZXkoa2V5LCBwcmVmaXgsIHN1ZmZpeCk7XG4gIGZuLmFkZEVudmlyb25tZW50KGVudktleSwgdmFsdWUpO1xufVxuXG4vKipcbiAqIE1lcmdlcyBnbG9iYWwgcmVzb3VyY2UgYWNjZXNzIHdpdGggcGVyLWZ1bmN0aW9uIHJlc291cmNlIGFjY2Vzcy5cbiAqIFBlci1mdW5jdGlvbiByZXNvdXJjZSBhY2Nlc3MgdGFrZXMgcHJlY2VkZW5jZSAoY29tZXMgYWZ0ZXIgZ2xvYmFsIGluIHRoZSBtZXJnZWQgYXJyYXkpLlxuICogRGVkdXBsaWNhdGlvbiBpcyBoYW5kbGVkIGF0IHRoZSByZXNvdXJjZSBsZXZlbCAtIGlmIHRoZSBzYW1lIHJlc291cmNlIGFwcGVhcnMgaW4gYm90aFxuICogZ2xvYmFsIGFuZCBwZXItZnVuY3Rpb24gYWNjZXNzLCBib3RoIGVudHJpZXMgYXJlIGtlcHQgKGFsbG93aW5nIGZvciBkaWZmZXJlbnQgYWNjZXNzIGxldmVscykuXG4gKiBcbiAqIEBwYXJhbSBnbG9iYWxBY2Nlc3MgLSBHbG9iYWwgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb24gZnJvbSBmdzI0XG4gKiBAcGFyYW0gZnVuY3Rpb25BY2Nlc3MgLSBQZXItZnVuY3Rpb24gcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIE1lcmdlZCByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvblxuICovXG5mdW5jdGlvbiBtZXJnZVJlc291cmNlQWNjZXNzKFxuICBnbG9iYWxBY2Nlc3M6IElGdW5jdGlvblJlc291cmNlQWNjZXNzIHwgdW5kZWZpbmVkLFxuICBmdW5jdGlvbkFjY2VzczogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3MgfCB1bmRlZmluZWRcbik6IElGdW5jdGlvblJlc291cmNlQWNjZXNzIHtcbiAgaWYgKCFnbG9iYWxBY2Nlc3MgJiYgIWZ1bmN0aW9uQWNjZXNzKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgaWYgKCFnbG9iYWxBY2Nlc3MpIHtcbiAgICByZXR1cm4gZnVuY3Rpb25BY2Nlc3MhO1xuICB9XG5cbiAgaWYgKCFmdW5jdGlvbkFjY2Vzcykge1xuICAgIHJldHVybiBnbG9iYWxBY2Nlc3M7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHRhYmxlczogZGVkdXBsaWNhdGVSZXNvdXJjZUFycmF5KFtcbiAgICAgIC4uLihnbG9iYWxBY2Nlc3MudGFibGVzIHx8IFtdKSxcbiAgICAgIC4uLihmdW5jdGlvbkFjY2Vzcy50YWJsZXMgfHwgW10pXG4gICAgXSksXG4gICAgYnVja2V0czogZGVkdXBsaWNhdGVSZXNvdXJjZUFycmF5KFtcbiAgICAgIC4uLihnbG9iYWxBY2Nlc3MuYnVja2V0cyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MuYnVja2V0cyB8fCBbXSlcbiAgICBdKSxcbiAgICBxdWV1ZXM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnF1ZXVlcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MucXVldWVzIHx8IFtdKVxuICAgIF0pLFxuICAgIHRvcGljczogZGVkdXBsaWNhdGVSZXNvdXJjZUFycmF5KFtcbiAgICAgIC4uLihnbG9iYWxBY2Nlc3MudG9waWNzIHx8IFtdKSxcbiAgICAgIC4uLihmdW5jdGlvbkFjY2Vzcy50b3BpY3MgfHwgW10pXG4gICAgXSlcbiAgfTtcbn1cblxuLyoqXG4gKiBEZWR1cGxpY2F0ZXMgcmVzb3VyY2UgYXJyYXkgZW50cmllcyBieSBuYW1lLCBwcmVmZXJyaW5nIGVudHJpZXMgd2l0aCBleHBsaWNpdCBhY2Nlc3Mgb3ZlciBpbXBsaWNpdC5cbiAqIFdoZW4gdGhlIHNhbWUgcmVzb3VyY2UgYXBwZWFycyBtdWx0aXBsZSB0aW1lczpcbiAqIC0gSWYgYm90aCBoYXZlIGV4cGxpY2l0IGFjY2VzcyBhcnJheXMsIG1lcmdlIHRoZSBhY2Nlc3MgYXJyYXlzXG4gKiAtIElmIG9uZSBoYXMgZXhwbGljaXQgYWNjZXNzIGFuZCBvbmUgZG9lc24ndCwgdXNlIHRoZSBleHBsaWNpdCBvbmVcbiAqIC0gSWYgYm90aCBhcmUgc3RyaW5ncyAoaW1wbGljaXQgcmVhZHdyaXRlKSwga2VlcCBvbmx5IG9uZVxuICogXG4gKiBAcGFyYW0gcmVzb3VyY2VzIC0gQXJyYXkgb2YgcmVzb3VyY2UgZW50cmllcyAoc3RyaW5nIG9yIHsgbmFtZSwgYWNjZXNzPyB9KVxuICogQHJldHVybnMgRGVkdXBsaWNhdGVkIGFycmF5XG4gKi9cbmZ1bmN0aW9uIGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheTxUIGV4dGVuZHMgc3RyaW5nIHwgeyBuYW1lOiBzdHJpbmc7IGFjY2Vzcz86IHN0cmluZ1tdIH0+KFxuICByZXNvdXJjZXM6IFRbXVxuKTogVFtdIHtcbiAgaWYgKCFyZXNvdXJjZXMgfHwgcmVzb3VyY2VzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IHJlc291cmNlTWFwID0gbmV3IE1hcDxzdHJpbmcsIFQ+KCk7XG5cbiAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICBjb25zdCBuYW1lID0gdHlwZW9mIHJlc291cmNlID09PSAnc3RyaW5nJyA/IHJlc291cmNlIDogcmVzb3VyY2UubmFtZTtcbiAgICBjb25zdCBleGlzdGluZ1Jlc291cmNlID0gcmVzb3VyY2VNYXAuZ2V0KG5hbWUpO1xuXG4gICAgaWYgKCFleGlzdGluZ1Jlc291cmNlKSB7XG4gICAgICByZXNvdXJjZU1hcC5zZXQobmFtZSwgcmVzb3VyY2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBNZXJnZSBsb2dpYzogcHJlZmVyIGV4cGxpY2l0IGFjY2VzcyBvdmVyIGltcGxpY2l0XG4gICAgICBjb25zdCBleGlzdGluZ0FjY2VzcyA9IHR5cGVvZiBleGlzdGluZ1Jlc291cmNlID09PSAnc3RyaW5nJyA/IHVuZGVmaW5lZCA6IGV4aXN0aW5nUmVzb3VyY2UuYWNjZXNzO1xuICAgICAgY29uc3QgbmV3QWNjZXNzID0gdHlwZW9mIHJlc291cmNlID09PSAnc3RyaW5nJyA/IHVuZGVmaW5lZCA6IHJlc291cmNlLmFjY2VzcztcblxuICAgICAgaWYgKGV4aXN0aW5nQWNjZXNzICYmIG5ld0FjY2Vzcykge1xuICAgICAgICAvLyBCb3RoIGhhdmUgZXhwbGljaXQgYWNjZXNzIC0gbWVyZ2UgYW5kIGRlZHVwbGljYXRlXG4gICAgICAgIGNvbnN0IG1lcmdlZEFjY2VzcyA9IEFycmF5LmZyb20obmV3IFNldChbIC4uLmV4aXN0aW5nQWNjZXNzLCAuLi5uZXdBY2Nlc3MgXSkpO1xuICAgICAgICByZXNvdXJjZU1hcC5zZXQobmFtZSwgeyBuYW1lLCBhY2Nlc3M6IG1lcmdlZEFjY2VzcyB9IGFzIFQpO1xuICAgICAgfSBlbHNlIGlmIChuZXdBY2Nlc3MpIHtcbiAgICAgICAgLy8gTmV3IGhhcyBleHBsaWNpdCBhY2Nlc3MsIGV4aXN0aW5nIGRvZXNuJ3QgLSBwcmVmZXIgbmV3XG4gICAgICAgIHJlc291cmNlTWFwLnNldChuYW1lLCByZXNvdXJjZSk7XG4gICAgICB9XG4gICAgICAvLyBlbHNlOiBleGlzdGluZyBoYXMgZXhwbGljaXQgYWNjZXNzIG9yIGJvdGggaW1wbGljaXQgLSBrZWVwIGV4aXN0aW5nXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIEFycmF5LmZyb20ocmVzb3VyY2VNYXAudmFsdWVzKCkpO1xufVxuIl19