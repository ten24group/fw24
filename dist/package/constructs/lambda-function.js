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
        // Source-position pinning: capture file:line for the configured levels so Logtrail can link a log to
        // the exact culprit line. Config-driven (per-construct prop or app config), default 'warn-error'.
        // When on, add --enable-source-maps (merged) so runtime stacks resolve to source, not the bundle.
        const positionMode = props.logSourcePosition ?? fw24.getConfig().logSourcePosition ?? 'warn-error';
        if (positionMode !== 'off') {
            if (!('LOG_SOURCE_POSITION' in props.environmentVariables)) {
                props.environmentVariables['LOG_SOURCE_POSITION'] = positionMode;
            }
            const existingNodeOpts = props.environmentVariables['NODE_OPTIONS'] ?? '';
            if (!existingNodeOpts.includes('--enable-source-maps')) {
                props.environmentVariables['NODE_OPTIONS'] = `${existingNodeOpts} --enable-source-maps`.trim();
            }
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQXFCQSw0Q0FFQztBQTJLRCx3Q0FnQkM7QUFsTkQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsdURBQXlDO0FBQ3pDLG1EQUErRDtBQUMvRCx3Q0FBc0Y7QUFDdEYsb0NBQWlDO0FBTWpDLFNBQWdCLGdCQUFnQixDQUFDLE1BQWlEO0lBQ2hGLE9BQVEsTUFBMEIsQ0FBQyxJQUFJLEtBQUssU0FBUyxDQUFDO0FBQ3hELENBQUM7QUEwSEQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBK0NHO0FBRUgsU0FBZ0IsY0FBYyxDQUFDLFFBQWlCO0lBQzlDLFFBQVEsUUFBUSxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUM7UUFDaEMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxNQUFNO1lBQ1QsT0FBTyxnQ0FBbUIsQ0FBQyxJQUFJLENBQUM7UUFDbEMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxPQUFPO1lBQ1YsT0FBTyxnQ0FBbUIsQ0FBQyxLQUFLLENBQUM7UUFDbkMsS0FBSyxNQUFNLENBQUM7UUFDWjtZQUNFLE9BQU8sZ0NBQW1CLENBQUMsSUFBSSxDQUFBO0lBQ25DLENBQUM7QUFDSCxDQUFDO0FBRUQsTUFBYSxjQUFlLFNBQVEsc0JBQVM7SUFFbEMsTUFBTSxHQUFhLElBQUEsc0JBQVksRUFBQyxnQkFBZ0IsQ0FBQyxDQUFDO0lBRTNEOzs7Ozs7T0FNRztJQUNILFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBMEI7UUFDbEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFFaEMsOENBQThDO1FBQzlDLElBQUksWUFBWSxHQUF3QjtZQUN0QyxPQUFPLEVBQUUsb0JBQU8sQ0FBQyxXQUFXO1lBQzVCLFlBQVksRUFBRSx5QkFBWSxDQUFDLE1BQU07WUFDakMsT0FBTyxFQUFFLFNBQVM7WUFDbEIsT0FBTyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM1QixVQUFVLEVBQUUsR0FBRztZQUNmLGFBQWEsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsRUFBRSxLQUFLLE1BQU0sQ0FBQyxDQUFDLENBQUMsMEJBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLDBCQUFhLENBQUMsSUFBSTtZQUMzRyxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxhQUFvQztTQUN6RCxDQUFDO1FBRUYsK0dBQStHO1FBQy9HLElBQUksWUFBWSxDQUFDLGFBQWEsS0FBSywwQkFBYSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3RELFlBQVksR0FBRztnQkFDYixHQUFHLFlBQVk7Z0JBQ2YscUJBQXFCLEVBQUUsY0FBYyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDO2FBQzdELENBQUM7UUFDSixDQUFDO1FBRUQsbUNBQW1DO1FBQ25DLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsUUFBUSxDQUFDO1FBQzdDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLElBQUksZ0JBQWdCLEdBQUcsS0FBSyxDQUFDLGdCQUFnQixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7WUFDekYsUUFBUSxHQUFHLElBQUksbUJBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRTtnQkFDOUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxnQkFBZ0IsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsZ0JBQWdCLElBQUksMkJBQWEsQ0FBQyxNQUFNO2dCQUNsRyxTQUFTLEVBQUUsUUFBUSxDQUFDLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxDQUFDO2FBQ2pELENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCxNQUFNLGVBQWUsR0FBd0I7WUFDM0MsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1NBQ25CLENBQUE7UUFFRCwrRkFBK0Y7UUFDL0YsTUFBTSxhQUFhLEdBQUcsWUFBWSxFQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFDLENBQUM7UUFFM0YsMkNBQTJDO1FBQzNDLE1BQU0sTUFBTSxHQUFHO1lBQ2IsR0FBRyxhQUFhO1lBQ2hCLHNFQUFzRTtZQUN0RSxHQUFHLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxNQUFNLElBQUksRUFBRSxDQUFDO1NBQ04sQ0FBQztRQUVuQyxvQkFBb0I7UUFDcEIsTUFBTSxXQUFXLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1FBRWhELDZEQUE2RDtRQUM3RCxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO1lBQ2xDLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDM0IsQ0FBQztRQUVELHFDQUFxQztRQUNyQyxNQUFNLGNBQWMsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFO1lBQ2pELElBQUksT0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ2xDLE9BQU8seUJBQVksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksU0FBUyxRQUFRLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFNBQVMsR0FBRyxrQkFBa0IsRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUN6SixDQUFDO1lBRUQsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQyxDQUFDLENBQUE7UUFFRixlQUFlLENBQUMsTUFBTSxHQUFHLGNBQWMsQ0FBQztRQUV4QyxlQUFlLENBQUMsUUFBUSxHQUFHLElBQUEsYUFBSyxFQUFDO1lBQy9CLFlBQVksQ0FBQyxRQUFRLElBQUksRUFBRTtZQUMzQixLQUFLLENBQUMsYUFBYSxFQUFFLFFBQVEsSUFBSSxFQUFFO1lBQ25DO2dCQUNFLFNBQVMsRUFBRSxJQUFJO2dCQUNmLGVBQWUsRUFBRTtvQkFDZixHQUFHLENBQUMsWUFBWSxFQUFFLFFBQVEsRUFBRSxlQUFlLElBQUksRUFBRSxDQUFDO29CQUNsRCxHQUFHLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxRQUFRLEVBQUUsZUFBZSxJQUFJLEVBQUUsQ0FBQztvQkFDekQsa0JBQWtCO2lCQUNuQjthQUNGO1NBQ0YsQ0FBRSxDQUFDO1FBQ0osZUFBZSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDcEMsSUFBSSxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDMUIsZUFBZSxDQUFDLE9BQU8sR0FBRyxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDcEUsQ0FBQztRQUVELElBQUksS0FBSyxDQUFDLHFCQUFxQixFQUFFLENBQUM7WUFDaEMsZUFBZSxDQUFDLFlBQVksR0FBRyxLQUFLLENBQUMscUJBQXFCLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyx5QkFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMseUJBQVksQ0FBQyxNQUFNLENBQUM7UUFDdEgsQ0FBQztRQUVELDhCQUE4QjtRQUM5QixNQUFNLEVBQUUsR0FBRyxJQUFJLGtDQUFjLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBRSxJQUFBLGFBQUssRUFBQztZQUM1QyxZQUFZO1lBQ1osS0FBSyxDQUFDLGFBQWEsSUFBSSxFQUFFO1lBQ3pCLGVBQWU7U0FDaEIsQ0FBRSxDQUFDLENBQUM7UUFFTCxLQUFLLENBQUMsb0JBQW9CLEdBQUcsS0FBSyxDQUFDLG9CQUFvQixJQUFJLEVBQUUsQ0FBQztRQUU5RCxxR0FBcUc7UUFDckcsa0dBQWtHO1FBQ2xHLGtHQUFrRztRQUNsRyxNQUFNLFlBQVksR0FDaEIsS0FBSyxDQUFDLGlCQUFpQixJQUFLLElBQUksQ0FBQyxTQUFTLEVBQXFDLENBQUMsaUJBQWlCLElBQUksWUFBWSxDQUFDO1FBQ3BILElBQUksWUFBWSxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQzNCLElBQUksQ0FBQyxDQUFDLHFCQUFxQixJQUFJLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUM7Z0JBQzNELEtBQUssQ0FBQyxvQkFBb0IsQ0FBRSxxQkFBcUIsQ0FBRSxHQUFHLFlBQVksQ0FBQztZQUNyRSxDQUFDO1lBQ0QsTUFBTSxnQkFBZ0IsR0FBRyxLQUFLLENBQUMsb0JBQW9CLENBQUUsY0FBYyxDQUFFLElBQUksRUFBRSxDQUFDO1lBQzVFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsc0JBQXNCLENBQUMsRUFBRSxDQUFDO2dCQUN2RCxLQUFLLENBQUMsb0JBQW9CLENBQUUsY0FBYyxDQUFFLEdBQUcsR0FBRyxnQkFBZ0IsdUJBQXVCLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDbkcsQ0FBQztRQUNILENBQUM7UUFFRCxnRkFBZ0Y7UUFDaEYsMENBQTBDO1FBQzFDLDJEQUEyRDtRQUMzRCw4R0FBOEc7UUFFOUcsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxDQUFDLFdBQVcsSUFBSSxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBRSxDQUFDO1lBQ2pELEtBQUssQ0FBQyxvQkFBb0IsQ0FBRSxXQUFXLENBQUUsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDdkYsQ0FBQztRQUVELDRCQUE0QjtRQUM1QixLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsS0FBSyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBRSxDQUFDO1lBQ3hFLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQztZQUNyQixJQUFJLE1BQU0sR0FBRyxHQUFHLENBQUM7WUFDakIsOEVBQThFO1lBQzlFLDRCQUE0QjtZQUM1QiwyQkFBMkI7WUFDM0IsK0NBQStDO1lBQy9DLHdFQUF3RTtZQUN4RSxJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZDLHNCQUFzQjtnQkFDdEIsTUFBTSxnQkFBZ0IsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDcEQsTUFBTSxLQUFLLEdBQUcsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUUxQyxvREFBb0Q7Z0JBQ3BELE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBRSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBRSxDQUFDO2dCQUU3Qyx3REFBd0Q7Z0JBQ3hELE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUVuRSxRQUFRLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDMUQsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsdUNBQXVDLEtBQUssT0FBTyxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUN4RixDQUFDO1lBRUQsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsOEJBQThCLE1BQU0sTUFBTSxRQUFRLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUU5RSxpQ0FBaUMsQ0FBQztnQkFDaEMsRUFBRTtnQkFDRixHQUFHLEVBQUUsTUFBTTtnQkFDWCxLQUFLLEVBQUUsUUFBUTthQUNoQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsbURBQW1EO1FBQ25ELElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRTtZQUNwRCxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyx1Q0FBdUMsTUFBTSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDeEUsaUNBQWlDLENBQUM7Z0JBQ2hDLEVBQUU7Z0JBQ0YsR0FBRyxFQUFFLE1BQU07Z0JBQ1gsS0FBSyxFQUFFLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLENBQUM7YUFDM0MsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxzRUFBc0U7UUFDdEUsaUVBQWlFO1FBQ2pFLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxDQUFDO1FBQzNELElBQ0UsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxjQUFjLElBQUksS0FBSyxDQUFDLG9CQUFvQixDQUFDOztnQkFFeEQsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsRUFDaEQsQ0FBQztZQUNELE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1lBQ3BELElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDN0IsbUdBQW1HO2dCQUNuRyxNQUFNLGdCQUFnQixHQUFHLGFBQWEsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztnQkFDdEYsTUFBTSxrQkFBa0IsR0FBRyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ3RELElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLGdDQUFnQyxrQkFBa0IsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUM3RSxpQ0FBaUMsQ0FBQztvQkFDaEMsRUFBRTtvQkFDRixHQUFHLEVBQUUsUUFBUSxDQUFDLGNBQWM7b0JBQzVCLEtBQUssRUFBRSxrQkFBa0I7aUJBQzFCLENBQUMsQ0FBQztZQUNMLENBQUM7UUFDSCxDQUFDO1FBRUQsc0NBQXNDO1FBQ3RDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRTtZQUN4QyxtQkFBbUIsQ0FBQztnQkFDbEIsRUFBRTtnQkFDRixJQUFJO2dCQUNKLE1BQU07YUFDUCxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILGtDQUFrQztRQUNsQyxDQUFDLEtBQUssQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQ3RDLG1CQUFtQixDQUFDO2dCQUNsQixFQUFFO2dCQUNGLElBQUk7Z0JBQ0osTUFBTTthQUNQLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsaUVBQWlFO1FBQ2pFLE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxDQUFDLHVCQUF1QixFQUFFLENBQUM7UUFDNUQsTUFBTSxvQkFBb0IsR0FBRyxtQkFBbUIsQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7UUFFN0Ysa0ZBQWtGO1FBQ2xGLElBQUksS0FBSyxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUMsYUFBYSxZQUFZLHdCQUFlLEVBQUUsQ0FBQztZQUMxRSxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsc0JBQXNCLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzNGLE1BQU0sVUFBVSxHQUFHLGVBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLGNBQWMsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUM7WUFFakgsVUFBVSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ2pDLGlDQUFpQyxDQUFDO2dCQUNoQyxFQUFFO2dCQUNGLEdBQUcsRUFBRSxpQkFBaUI7Z0JBQ3RCLEtBQUssRUFBRSxVQUFVLENBQUMsUUFBUTthQUMzQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsMkRBQTJEO1FBQzNELG9CQUFvQixFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxLQUF5QixFQUFFLEVBQUU7WUFDbEUsSUFBSSxTQUFTLEdBQUcsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7WUFFL0QsbUVBQW1FO1lBQ25FLFNBQVMsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsU0FBUyxDQUFDLENBQUM7WUFFckQsTUFBTSxxQkFBcUIsR0FBRyxJQUFBLDJCQUFvQixFQUFDLElBQUEsbUJBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUVyRixNQUFNLE1BQU0sR0FBRyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUUsV0FBVyxDQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBRSxXQUFXLENBQUUsQ0FBQztZQUM3Rix3REFBd0Q7WUFDeEQsTUFBTSxhQUFhLEdBQWEsc0JBQU8sQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksU0FBUyxRQUFRLEVBQUU7Z0JBQzVGLFNBQVMsRUFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMscUJBQXFCLEdBQUcsWUFBWSxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUM7Z0JBQzVGLHFCQUFxQixFQUFFLElBQUk7YUFDNUIsQ0FBQyxDQUFDO1lBRUgscURBQXFEO1lBQ3JELGlDQUFpQyxDQUFDO2dCQUNoQyxFQUFFO2dCQUNGLEdBQUcsRUFBRSxHQUFHLHFCQUFxQixFQUFFO2dCQUMvQixLQUFLLEVBQUUsYUFBYSxDQUFDLFNBQVM7YUFDL0IsQ0FBQyxDQUFDO1lBRUgsMkRBQTJEO1lBQzNELE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFrQixFQUFFLEVBQUU7Z0JBQ3BDLFFBQVEsVUFBVSxFQUFFLENBQUM7b0JBQ25CLEtBQUssTUFBTTt3QkFDVCxhQUFhLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNoQyxNQUFNO29CQUNSLEtBQUssT0FBTzt3QkFDVixhQUFhLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNqQyxNQUFNO29CQUNSO3dCQUNFLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsQ0FBQzt3QkFDckMsTUFBTTtnQkFDVixDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILHNEQUFzRDtRQUN0RCxvQkFBb0IsRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUMsTUFBMEIsRUFBRSxFQUFFO1lBQ3BFLElBQUksVUFBVSxHQUFHLE9BQU8sTUFBTSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDO1lBRW5FLG1FQUFtRTtZQUNuRSxVQUFVLEdBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBRXZELE1BQU0sTUFBTSxHQUFHLE9BQU8sTUFBTSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBRSxXQUFXLENBQUUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFFLFdBQVcsQ0FBRSxDQUFDO1lBRS9GLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDdEQsTUFBTSxjQUFjLEdBQUcsZUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsVUFBVSxHQUFHLEVBQUUsR0FBRyxTQUFTLEVBQUUsY0FBYyxDQUFDLENBQUM7WUFDaEcsaURBQWlEO1lBQ2pELE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFrQixFQUFFLEVBQUU7Z0JBQ3BDLFFBQVEsVUFBVSxFQUFFLENBQUM7b0JBQ25CLEtBQUssTUFBTTt3QkFDVCxjQUFjLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUM3QixNQUFNO29CQUNSLEtBQUssT0FBTzt3QkFDVixjQUFjLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUM5QixNQUFNO29CQUNSO3dCQUNFLGNBQWMsQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ2xDLE1BQU07Z0JBQ1YsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsK0NBQStDO1lBQy9DLGlDQUFpQyxDQUFDO2dCQUNoQyxFQUFFO2dCQUNGLEdBQUcsRUFBRSxVQUFVLFVBQVUsRUFBRTtnQkFDM0IsS0FBSyxFQUFFLGNBQWM7YUFDdEIsQ0FBQyxDQUFDO1FBRUwsQ0FBQyxDQUFDLENBQUM7UUFFSCxzREFBc0Q7UUFDdEQsb0JBQW9CLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDLEtBQXlCLEVBQUUsRUFBRTtZQUNsRSxJQUFJLFNBQVMsR0FBRyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztZQUUvRCxtRUFBbUU7WUFDbkUsU0FBUyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUVyRCxNQUFNLE1BQU0sR0FBRyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUUsTUFBTSxDQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBRSxNQUFNLENBQUUsQ0FBQztZQUVuRixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsU0FBUyxHQUFHLFlBQVksRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUMzRyxNQUFNLGFBQWEsR0FBRyxlQUFLLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxTQUFTLEdBQUcsRUFBRSxHQUFHLFFBQVEsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUNwRixnREFBZ0Q7WUFDaEQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFVBQWtCLEVBQUUsRUFBRTtnQkFDcEMsUUFBUSxVQUFVLEVBQUUsQ0FBQztvQkFDbkIsS0FBSyxTQUFTO3dCQUNaLGFBQWEsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUMsQ0FBQzt3QkFDdkMsTUFBTTtvQkFDUixLQUFLLFFBQVE7d0JBQ1gsYUFBYSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUMsQ0FBQzt3QkFDN0IsTUFBTTtvQkFDUjt3QkFDRSxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ3BDLE1BQU07Z0JBQ1YsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsNkNBQTZDO1lBQzdDLGlDQUFpQyxDQUFDO2dCQUNoQyxFQUFFO2dCQUNGLEdBQUcsRUFBRSxHQUFHLFNBQVMsV0FBVztnQkFDNUIsS0FBSyxFQUFFLGFBQWEsQ0FBQyxRQUFRO2FBQzlCLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFDO1FBRUgsMkJBQTJCO1FBQzNCLG9CQUFvQixFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxLQUF5QixFQUFFLEVBQUU7WUFDbEUsSUFBSSxTQUFTLEdBQUcsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7WUFFL0QsbUVBQW1FO1lBQ25FLFNBQVMsR0FBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsU0FBUyxDQUFDLENBQUM7WUFFckQsTUFBTSxNQUFNLEdBQUcsT0FBTyxLQUFLLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFFLFNBQVMsQ0FBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxJQUFJLENBQUUsU0FBUyxDQUFFLENBQUM7WUFFekYsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFNBQVMsR0FBRyxZQUFZLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDM0csTUFBTSxhQUFhLEdBQUcsZUFBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsU0FBUyxHQUFHLEVBQUUsR0FBRyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDcEYsZ0RBQWdEO1lBQ2hELE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFrQixFQUFFLEVBQUU7Z0JBQ3BDLFFBQVEsVUFBVSxFQUFFLENBQUM7b0JBQ25CO3dCQUNFLGFBQWEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQy9CLE1BQU07Z0JBQ1YsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBQ0gsNkNBQTZDO1lBQzdDLGlDQUFpQyxDQUFDO2dCQUNoQyxFQUFFO2dCQUNGLEdBQUcsRUFBRSxHQUFHLFNBQVMsV0FBVztnQkFDNUIsS0FBSyxFQUFFLGFBQWEsQ0FBQyxRQUFRO2FBQzlCLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0NBQ0Y7QUFsWEQsd0NBa1hDO0FBRUQsU0FBUyxtQkFBbUIsQ0FBQyxPQUk1QjtJQUNDLE1BQU0sRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUVyQyxJQUFJLGNBQWMsR0FBOEMsTUFBTSxDQUFDO0lBRXZFLElBQUksZ0JBQWdCLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUM3QixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRWhFLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNsQixJQUFJLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDdEIsMENBQTBDO2dCQUMxQyxPQUFPO1lBQ1QsQ0FBQztZQUNELE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxNQUFNLENBQUMsSUFBSSwwQkFBMEIsQ0FBQyxDQUFDO1FBQ25FLENBQUM7UUFFRCxjQUFjLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQTJDLENBQUM7SUFDeEcsQ0FBQztJQUVELElBQUksQ0FBQyxDQUFDLGNBQWMsWUFBWSx5QkFBZSxDQUFDLEVBQUUsQ0FBQztRQUNqRCxjQUFjLEdBQUcsSUFBSSx5QkFBZSxDQUFDLGNBQXNDLENBQUMsQ0FBQztJQUMvRSxDQUFDO0lBRUQsRUFBRSxDQUFDLGVBQWUsQ0FBQyxjQUFpQyxDQUFDLENBQUM7QUFFeEQsQ0FBQztBQUVELFNBQVMsaUNBQWlDLENBQUMsT0FNMUM7SUFFQyxNQUFNLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsTUFBTSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFFLEdBQUcsT0FBTyxDQUFDO0lBRTdELE1BQU0sTUFBTSxHQUFHLElBQUEsd0JBQWlCLEVBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN0RCxFQUFFLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztBQUNuQyxDQUFDO0FBRUQ7Ozs7Ozs7OztHQVNHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FDMUIsWUFBaUQsRUFDakQsY0FBbUQ7SUFFbkQsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUNsQixPQUFPLGNBQWUsQ0FBQztJQUN6QixDQUFDO0lBRUQsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3BCLE9BQU8sWUFBWSxDQUFDO0lBQ3RCLENBQUM7SUFFRCxPQUFPO1FBQ0wsTUFBTSxFQUFFLHdCQUF3QixDQUFDO1lBQy9CLEdBQUcsQ0FBQyxZQUFZLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQztZQUM5QixHQUFHLENBQUMsY0FBYyxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUM7U0FDakMsQ0FBQztRQUNGLE9BQU8sRUFBRSx3QkFBd0IsQ0FBQztZQUNoQyxHQUFHLENBQUMsWUFBWSxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDL0IsR0FBRyxDQUFDLGNBQWMsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDO1NBQ2xDLENBQUM7UUFDRixNQUFNLEVBQUUsd0JBQXdCLENBQUM7WUFDL0IsR0FBRyxDQUFDLFlBQVksQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDO1lBQzlCLEdBQUcsQ0FBQyxjQUFjLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQztTQUNqQyxDQUFDO1FBQ0YsTUFBTSxFQUFFLHdCQUF3QixDQUFDO1lBQy9CLEdBQUcsQ0FBQyxZQUFZLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQztZQUM5QixHQUFHLENBQUMsY0FBYyxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUM7U0FDakMsQ0FBQztLQUNILENBQUM7QUFDSixDQUFDO0FBRUQ7Ozs7Ozs7OztHQVNHO0FBQ0gsU0FBUyx3QkFBd0IsQ0FDL0IsU0FBYztJQUVkLElBQUksQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUN6QyxPQUFPLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFRCxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBYSxDQUFDO0lBRXpDLEtBQUssTUFBTSxRQUFRLElBQUksU0FBUyxFQUFFLENBQUM7UUFDakMsTUFBTSxJQUFJLEdBQUcsT0FBTyxRQUFRLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDckUsTUFBTSxnQkFBZ0IsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRS9DLElBQUksQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RCLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ2xDLENBQUM7YUFBTSxDQUFDO1lBQ04sb0RBQW9EO1lBQ3BELE1BQU0sY0FBYyxHQUFHLE9BQU8sZ0JBQWdCLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQztZQUNsRyxNQUFNLFNBQVMsR0FBRyxPQUFPLFFBQVEsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQztZQUU3RSxJQUFJLGNBQWMsSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDaEMsb0RBQW9EO2dCQUNwRCxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUUsR0FBRyxjQUFjLEVBQUUsR0FBRyxTQUFTLENBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQzlFLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQU8sQ0FBQyxDQUFDO1lBQzdELENBQUM7aUJBQU0sSUFBSSxTQUFTLEVBQUUsQ0FBQztnQkFDckIseURBQXlEO2dCQUN6RCxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztZQUNsQyxDQUFDO1lBQ0Qsc0VBQXNFO1FBQ3hFLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0FBQzFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgRHVyYXRpb24sIFJlbW92YWxQb2xpY3kgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCwgdHlwZSBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSdW50aW1lLCBBcmNoaXRlY3R1cmUsIExheWVyVmVyc2lvbiwgQXBwbGljYXRpb25Mb2dMZXZlbCwgTG9nZ2luZ0Zvcm1hdCwgSUxheWVyVmVyc2lvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBJVGFibGVWMiwgVGFibGVWMiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgQnVja2V0IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zM1wiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIElMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0ICogYXMgRU5WX0tFWVMgZnJvbSBcIi4uL2NvbnN0L2VudlwiO1xuaW1wb3J0IHsgTG9nR3JvdXAsIFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IGVuc3VyZU5vU3BlY2lhbENoYXJzLCBlbnN1cmVTdWZmaXgsIGVuc3VyZVZhbGlkRW52S2V5IH0gZnJvbSBcIi4uL3V0aWxzL2tleXNcIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5cbnR5cGUgUmVzb3VyY2VBY2Nlc3NJdGVtID0gc3RyaW5nIHwgeyBuYW1lOiBzdHJpbmc7IGFjY2Vzcz86IHN0cmluZ1tdIH07XG5leHBvcnQgdHlwZSBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyA9IFBvbGljeVN0YXRlbWVudCB8IFBvbGljeVN0YXRlbWVudFByb3BzO1xuZXhwb3J0IHR5cGUgVEltcG9ydGVkUG9saWN5ID0geyBuYW1lOiBzdHJpbmcsIGlzT3B0aW9uYWw/OiBib29sZWFuLCBwcmVmaXg/OiBzdHJpbmcgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzSW1wb3J0ZWRQb2xpY3kocG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSk6IHBvbGljeSBpcyBUSW1wb3J0ZWRQb2xpY3kge1xuICByZXR1cm4gKHBvbGljeSBhcyBUSW1wb3J0ZWRQb2xpY3kpLm5hbWUgIT09IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBwcm9wZXJ0aWVzIGZvciBhIExhbWJkYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFGdW5jdGlvblByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBlbnRyeSBwb2ludCBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGVudHJ5OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBwb2xpY2llcyB0byBhdHRhY2ggdG8gdGhlIExhbWJkYSBmdW5jdGlvbidzIGV4ZWN1dGlvbiByb2xlLlxuICAgKi9cbiAgcG9saWNpZXM/OiBBcnJheTxUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeT47XG5cbiAgLyoqXG4gICAqIFRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gc2V0IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZW52aXJvbm1lbnRWYXJpYWJsZXM/OiB7IFsga2V5OiBzdHJpbmcgXTogc3RyaW5nIH07XG5cbiAgLyoqXG4gICAqIFRoZSByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIHJlc291cmNlQWNjZXNzPzogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIEluZGljYXRlcyB3aGV0aGVyIHRoZSBMYW1iZGEgZnVuY3Rpb24gaXMgYWxsb3dlZCB0byBzZW5kIGVtYWlscy5cbiAgICovXG4gIGFsbG93U2VuZEVtYWlsPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBkYXlzIHRvIHJldGFpbiB0aGUgbG9ncyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGxvZ1JldGVudGlvbkRheXM/OiBSZXRlbnRpb25EYXlzO1xuXG4gIC8qKlxuICAgKiBUaGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24ncyBsb2dzLlxuICAgKi9cbiAgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgLyoqXG4gICAqIFRoZSB0aW1lb3V0IGR1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGluIHNlY29uZHMuXG4gICAqIFVzZSB0aGlzIHRpbWVvdXQgdG8gYXZvaWQgaW1wb3J0aW5nIHRoZSBkdXJhdGlvbiBjbGFzcyBmcm9tIGF3cy1jZGstbGliLlxuICAgKi9cbiAgZnVuY3Rpb25UaW1lb3V0PzogbnVtYmVyO1xuXG4gIHByb2Nlc3NvckFyY2hpdGVjdHVyZT86ICd4ODZfNjQnIHwgJ2FybV82NCc7XG5cbiAgLyoqXG4gICAqIFNvdXJjZS1wb3NpdGlvbiBjYXB0dXJlIGZvciBcInBpbiB0aGUgZXhhY3QgY3VscHJpdCBsaW5lXCIgY29kZSBsaW5rcyBpbiBMb2d0cmFpbC5cbiAgICogICAtIGAnd2Fybi1lcnJvcidgIChkZWZhdWx0KTogY2FwdHVyZSBgZmlsZTpsaW5lYCBmb3Igd2Fybi9lcnJvci9mYXRhbCBvbmx5IChjaGVhcCDigJQgaG90IGluZm8vZGVidWdcbiAgICogICAgIHBhdGhzIHBheSBub3RoaW5nKS4gQWRkcyBgLS1lbmFibGUtc291cmNlLW1hcHNgIHNvIHBvc2l0aW9ucyByZXNvbHZlIHRvIHJlYWwgc291cmNlLlxuICAgKiAgIC0gYCdhbGwnYDogY2FwdHVyZSBmb3IgZXZlcnkgZW1pdHRlZCBsb2cgKGFkZHMgY29zdCBvbiBidXN5IHBhdGhzKS5cbiAgICogICAtIGAnb2ZmJ2A6IGRpc2FibGUgZW50aXJlbHkuXG4gICAqIE9ubHkgbWVhbmluZ2Z1bCB3aXRoIHNvdXJjZW1hcHMgb24gKGZ3MjQgZGVmYXVsdCkuIFNldCBhdCB0aGUgYXBwIGNvbmZpZyBsZXZlbCB0byBhcHBseSB0byBhbGwgZnVuY3Rpb25zLlxuICAgKi9cbiAgbG9nU291cmNlUG9zaXRpb24/OiAnb2ZmJyB8ICd3YXJuLWVycm9yJyB8ICdhbGwnO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGZ1bmN0aW9uUHJvcHM/OiBPbWl0PE5vZGVqc0Z1bmN0aW9uUHJvcHMsICdsYXllcnMnPiAmIHtcbiAgICByZWFkb25seSBsYXllcnM/OiBBcnJheTxJTGF5ZXJWZXJzaW9uIHwgc3RyaW5nPjtcbiAgfVxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSByZXNvdXJjZSBhY2Nlc3MgZW50cnkgLSBlaXRoZXIgYSBzaW1wbGUgc3RyaW5nIG5hbWUgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICovXG5leHBvcnQgdHlwZSBUUmVzb3VyY2VBY2Nlc3NFbnRyeSA9IHN0cmluZyB8IHsgbmFtZTogc3RyaW5nOyBhY2Nlc3M/OiBzdHJpbmdbXSB9O1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdmFyaW91cyByZXNvdXJjZXMgdGhhdCBjYW4gYmUgYWNjZXNzZWQgYnkgYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHRhYmxlcy5cbiAgICogRWFjaCB0YWJsZSBjYW4gYmUgYSBzdHJpbmcgKG5hbWUgb25seSwgZGVmYXVsdHMgdG8gcmVhZHdyaXRlKSBvciBhbiBvYmplY3Qgd2l0aCBuYW1lIGFuZCBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdyZWFkJywgJ3dyaXRlJywgb3IgJ3JlYWR3cml0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncmVhZHdyaXRlJy5cbiAgICogXG4gICAqIEBleGFtcGxlXG4gICAqIHRhYmxlczogWyd1c2Vycy10YWJsZScsIHsgbmFtZTogJ29yZGVycy10YWJsZScsIGFjY2VzczogWydyZWFkJ10gfV1cbiAgICovXG4gIHRhYmxlcz86IFRSZXNvdXJjZUFjY2Vzc0VudHJ5W107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgYnVja2V0cy5cbiAgICogRWFjaCBidWNrZXQgY2FuIGJlIGEgc3RyaW5nIChuYW1lIG9ubHksIGRlZmF1bHRzIHRvIHJlYWR3cml0ZSkgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncmVhZCcsICd3cml0ZScsIG9yICdyZWFkd3JpdGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3JlYWR3cml0ZScuXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBidWNrZXRzOiBbJ2Fzc2V0cy1idWNrZXQnLCB7IG5hbWU6ICdsb2dzLWJ1Y2tldCcsIGFjY2VzczogWyd3cml0ZSddIH1dXG4gICAqL1xuICBidWNrZXRzPzogVFJlc291cmNlQWNjZXNzRW50cnlbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciB0b3BpY3MuXG4gICAqIEVhY2ggdG9waWMgY2FuIGJlIGEgc3RyaW5nIChuYW1lIG9ubHksIGRlZmF1bHRzIHRvIHB1Ymxpc2gpIG9yIGFuIG9iamVjdCB3aXRoIG5hbWUgYW5kIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3B1Ymxpc2gnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3B1Ymxpc2gnLlxuICAgKiBcbiAgICogQGV4YW1wbGVcbiAgICogdG9waWNzOiBbJ2V2ZW50cy10b3BpYycsIHsgbmFtZTogJ25vdGlmaWNhdGlvbnMtdG9waWMnLCBhY2Nlc3M6IFsncHVibGlzaCddIH1dXG4gICAqL1xuICB0b3BpY3M/OiBUUmVzb3VyY2VBY2Nlc3NFbnRyeVtdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHF1ZXVlcy5cbiAgICogRWFjaCBxdWV1ZSBjYW4gYmUgYSBzdHJpbmcgKG5hbWUgb25seSwgZGVmYXVsdHMgdG8gc2VuZCkgb3IgYW4gb2JqZWN0IHdpdGggbmFtZSBhbmQgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAnc2VuZCcsICdyZWNlaXZlJywgb3IgJ2RlbGV0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAnc2VuZCcuXG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBxdWV1ZXM6IFsnbm90aWZpY2F0aW9ucy1xdWV1ZScsIHsgbmFtZTogJ3Byb2Nlc3NpbmctcXVldWUnLCBhY2Nlc3M6IFsnc2VuZCcsICdyZWNlaXZlJ10gfV1cbiAgICovXG4gIHF1ZXVlcz86IFRSZXNvdXJjZUFjY2Vzc0VudHJ5W107XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgTGFtYmRhIGZ1bmN0aW9uIGNvbnN0cnVjdC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIExhbWJkYSBmdW5jdGlvbiB3aXRoIGN1c3RvbSBwcm9wZXJ0aWVzXG4gKiBjb25zdCBsYW1iZGFQcm9wczogTGFtYmRhRnVuY3Rpb25Qcm9wcyA9IHtcbiAqICAgZW50cnk6IFwiaW5kZXguanNcIixcbiAqICAgcG9saWNpZXM6IFt7XG4gKiAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICogICAgICAgICBhY3Rpb25zOiBbXG4gKiAgICAgICAgICBcInMzOkdldE9iamVjdFwiXG4gKiAgICAgICAgIF0sXG4gKiAgICAgICAgIHJlc291cmNlczogW1wiYXJuOmF3czpzMzo6Om15LWJ1Y2tldC8qXCJdLFxuICogICAgIH0sIFxuICogICAgIHtcbiAqICAgICAgIHBvbGljeTogXCJhdXRoTW9kdWxlOmNyZWF0ZS11c2VyLWF1dGgtcmVjb3JkXCIsXG4gKiAgICAgICBpc09wdGlvbmFsOiB0cnVlXG4gKiAgICAgfVxuICogICBdLFxuICogICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICogICAgIE1ZX0VOVl9WQVI6IFwibXktdmFsdWVcIixcbiAqICAgfSxcbiAqICAgcmVzb3VyY2VBY2Nlc3M6IHtcbiAqICAgICB0YWJsZXM6IFtcbiAqICAgICAgIHtcbiAqICAgICAgICAgbmFtZTogXCJteS10YWJsZVwiLFxuICogICAgICAgICBhY2Nlc3M6IFtcInJlYWRcIiwgXCJ3cml0ZVwiXSxcbiAqICAgICAgIH0sXG4gKiAgICAgXSxcbiAqICAgICBidWNrZXRzOiBbXCJteS1idWNrZXRcIl0sXG4gKiAgICAgdG9waWNzOiBbXCJteS10b3BpY1wiXSxcbiAqICAgICBxdWV1ZXM6IFtcIm15LXF1ZXVlXCJdLFxuICogICB9LFxuICogICBhbGxvd1NlbmRFbWFpbDogdHJ1ZSxcbiAqICAgbG9nUmV0ZW50aW9uRGF5czogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAqICAgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICogICBmdW5jdGlvblRpbWVvdXQ6IDEwLFxuICogICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAqICAgICBtZW1vcnlTaXplOiAyNTYsXG4gKiAgIH0sXG4gKiB9O1xuICpcbiAqIGNvbnN0IGxhbWJkYUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCBcIk15TGFtYmRhRnVuY3Rpb25cIiwgbGFtYmRhUHJvcHMpO1xuICogXG4gKiBgYGBcbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0TG9nTGV2ZWwobG9nTGV2ZWw/OiBzdHJpbmcpIHtcbiAgc3dpdGNoIChsb2dMZXZlbD8udG9VcHBlckNhc2UoKSkge1xuICAgIGNhc2UgJ0VSUk9SJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkVSUk9SO1xuICAgIGNhc2UgJ1dBUk4nOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuV0FSTjtcbiAgICBjYXNlICdERUJVRyc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5ERUJVRztcbiAgICBjYXNlICdUUkFDRSc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5UUkFDRTtcbiAgICBjYXNlICdGQVRBTCc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5GQVRBTDtcbiAgICBjYXNlICdJTkZPJzpcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuSU5GT1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBMYW1iZGFGdW5jdGlvbiBleHRlbmRzIENvbnN0cnVjdCB7XG5cbiAgcmVhZG9ubHkgbG9nZ2VyPzogSUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignTGFtYmRhRnVuY3Rpb24nKTtcblxuICAvKipcbiAgICogQ29uc3RydWN0cyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgTGFtYmRhRnVuY3Rpb24gY2xhc3MuXG4gICAqIEBwYXJhbSBzY29wZSAtIFRoZSBwYXJlbnQgY29uc3RydWN0LlxuICAgKiBAcGFyYW0gaWQgLSBUaGUgSUQgb2YgdGhlIGNvbnN0cnVjdC5cbiAgICogQHBhcmFtIHByb3BzIC0gVGhlIExhbWJkYSBmdW5jdGlvbiBwcm9wZXJ0aWVzLlxuICAgKiBAcmV0dXJucyBUaGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIC8vIERlZmF1bHQgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb25cbiAgICBsZXQgZGVmYXVsdFByb3BzOiBOb2RlanNGdW5jdGlvblByb3BzID0ge1xuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLkFSTV82NCxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDEyOCxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IHByb2Nlc3MuZW52LkxPR19GT1JNQVQ/LnRvTG93ZXJDYXNlPy4oKSA9PT0gJ2pzb24nID8gTG9nZ2luZ0Zvcm1hdC5KU09OIDogTG9nZ2luZ0Zvcm1hdC5URVhULFxuICAgICAgLi4uZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblByb3BzIGFzIE5vZGVqc0Z1bmN0aW9uUHJvcHMsXG4gICAgfTtcblxuICAgIC8vICAnRXJyb3InICBUbyB1c2UgQXBwbGljYXRpb25Mb2dMZXZlbCBhbmQvb3IgU3lzdGVtTG9nTGV2ZWwgeW91IG11c3Qgc2V0IExvZ2dpbmdGb3JtYXQgdG8gJ0pTT04nLCBnb3QgJ1RleHQnLlxuICAgIGlmIChkZWZhdWx0UHJvcHMubG9nZ2luZ0Zvcm1hdCA9PT0gTG9nZ2luZ0Zvcm1hdC5KU09OKSB7XG4gICAgICBkZWZhdWx0UHJvcHMgPSB7XG4gICAgICAgIC4uLmRlZmF1bHRQcm9wcyxcbiAgICAgICAgYXBwbGljYXRpb25Mb2dMZXZlbFYyOiBmb3JtYXRMb2dMZXZlbChwcm9jZXNzLmVudi5MT0dfTEVWRUwpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBsb2cgZ3JvdXAgaWYgbm90IHByb3ZpZGVkXG4gICAgbGV0IGxvZ0dyb3VwID0gcHJvcHMuZnVuY3Rpb25Qcm9wcz8ubG9nR3JvdXA7XG4gICAgaWYgKCFsb2dHcm91cCkge1xuICAgICAgbGV0IGxvZ1JldGVudGlvbkRheXMgPSBwcm9wcy5sb2dSZXRlbnRpb25EYXlzIHx8IGZ3MjQuZ2V0Q29uZmlnKCkubG9nUmV0ZW50aW9uRGF5cyB8fCAzMDtcbiAgICAgIGxvZ0dyb3VwID0gbmV3IExvZ0dyb3VwKHRoaXMsIGAke2lkfS1Mb2dHcm91cGAsIHtcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogcHJvcHMubG9nUmVtb3ZhbFBvbGljeSB8fCBmdzI0LmdldENvbmZpZygpLmxvZ1JlbW92YWxQb2xpY3kgfHwgUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICAgIHJldGVudGlvbjogcGFyc2VJbnQobG9nUmV0ZW50aW9uRGF5cy50b1N0cmluZygpKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFkZGl0aW9uYWxQcm9wczogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgIGVudHJ5OiBwcm9wcy5lbnRyeSxcbiAgICB9XG5cbiAgICAvLyBjb2xsZWN0IHRoZSBuYW1lcyBvZiB0aGUgbGF5ZXJzIHByb3ZpZGVkIGluIGRlZmF1bHQgY29uZmlnIGlmIGFueSBvciBlbHNlIHRoZSBnbG9iYWwgbGF5ZXJzO1xuICAgIGNvbnN0IGRlZmF1bHRMYXllcnMgPSBkZWZhdWx0UHJvcHM/LmxheWVycyA/PyBBcnJheS5mcm9tKGZ3MjQuZ2V0R2xvYmFsTGFtYmRhTGF5ZXJOYW1lcygpKTtcblxuICAgIC8vIHJlc29sdmUgbGF5ZXIgbmFtZXMgdG8gYWN0dWFsIGxheWVyIGFybnNcbiAgICBjb25zdCBsYXllcnMgPSBbXG4gICAgICAuLi5kZWZhdWx0TGF5ZXJzLFxuICAgICAgLy8gY29sbGVjdCB0aGUgbmFtZXMgb2YgdGhlIGxheWVycyBwcm92aWRlZCBpbiBmdW5jdGlvbiBjb25maWcgaWYgYW55O1xuICAgICAgLi4uKHByb3BzLmZ1bmN0aW9uUHJvcHM/LmxheWVycyA/PyBbXSlcbiAgICBdIGFzIEFycmF5PHN0cmluZyB8IElMYXllclZlcnNpb24+O1xuXG4gICAgLy8gcmVtb3ZlIGR1cGxpY2F0ZXNcbiAgICBjb25zdCBkZUR1cExheWVycyA9IEFycmF5LmZyb20obmV3IFNldChsYXllcnMpKTtcblxuICAgIC8vIEVuc3VyZSBmdzI0IGxheWVyIGlzIGluY2x1ZGVkIChpZiBub3QgYWxyZWFkeSBpbiB0aGUgbGlzdClcbiAgICBpZiAoIWRlRHVwTGF5ZXJzLmluY2x1ZGVzKCdmdzI0JykpIHtcbiAgICAgIGRlRHVwTGF5ZXJzLnB1c2goJ2Z3MjQnKTtcbiAgICB9XG5cbiAgICAvLyBtYXAgbGF5ZXJzIHRvIGFjdHVhbCBsYXllciBvYmplY3RzXG4gICAgY29uc3QgcmVzb2x2ZWRMYXllcnMgPSBkZUR1cExheWVycy5tYXAobGF5ZXJOYW1lID0+IHtcbiAgICAgIGlmICh0eXBlb2YgbGF5ZXJOYW1lID09PSAnc3RyaW5nJykge1xuICAgICAgICByZXR1cm4gTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4odGhpcywgYCR7aWR9LSR7bGF5ZXJOYW1lfS1MYXllcmAsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShsYXllck5hbWUgKyAnX2xheWVyVmVyc2lvbkFybicsICdsYXllcicsIHNjb3BlKSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBsYXllck5hbWU7XG4gICAgfSlcblxuICAgIGFkZGl0aW9uYWxQcm9wcy5sYXllcnMgPSByZXNvbHZlZExheWVycztcblxuICAgIGFkZGl0aW9uYWxQcm9wcy5idW5kbGluZyA9IG1lcmdlKFtcbiAgICAgIGRlZmF1bHRQcm9wcy5idW5kbGluZyA/PyB7fSxcbiAgICAgIHByb3BzLmZ1bmN0aW9uUHJvcHM/LmJ1bmRsaW5nID8/IHt9LFxuICAgICAge1xuICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgIC4uLihkZWZhdWx0UHJvcHM/LmJ1bmRsaW5nPy5leHRlcm5hbE1vZHVsZXMgPz8gW10pLFxuICAgICAgICAgIC4uLihwcm9wcy5mdW5jdGlvblByb3BzPy5idW5kbGluZz8uZXh0ZXJuYWxNb2R1bGVzID8/IFtdKSxcbiAgICAgICAgICBcIkB0ZW4yNGdyb3VwL2Z3MjRcIlxuICAgICAgICBdLFxuICAgICAgfVxuICAgIF0pITtcbiAgICBhZGRpdGlvbmFsUHJvcHMubG9nR3JvdXAgPSBsb2dHcm91cDtcbiAgICBpZiAocHJvcHMuZnVuY3Rpb25UaW1lb3V0KSB7XG4gICAgICBhZGRpdGlvbmFsUHJvcHMudGltZW91dCA9IER1cmF0aW9uLnNlY29uZHMocHJvcHMuZnVuY3Rpb25UaW1lb3V0KTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHMucHJvY2Vzc29yQXJjaGl0ZWN0dXJlKSB7XG4gICAgICBhZGRpdGlvbmFsUHJvcHMuYXJjaGl0ZWN0dXJlID0gcHJvcHMucHJvY2Vzc29yQXJjaGl0ZWN0dXJlID09PSAneDg2XzY0JyA/IEFyY2hpdGVjdHVyZS5YODZfNjQgOiBBcmNoaXRlY3R1cmUuQVJNXzY0O1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSB0aGUgTm9kZS5qcyBmdW5jdGlvblxuICAgIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIGlkLCBtZXJnZShbXG4gICAgICBkZWZhdWx0UHJvcHMsXG4gICAgICBwcm9wcy5mdW5jdGlvblByb3BzID8/IHt9LFxuICAgICAgYWRkaXRpb25hbFByb3BzXG4gICAgXSkhKTtcblxuICAgIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzID0gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMgPz8ge307XG5cbiAgICAvLyBTb3VyY2UtcG9zaXRpb24gcGlubmluZzogY2FwdHVyZSBmaWxlOmxpbmUgZm9yIHRoZSBjb25maWd1cmVkIGxldmVscyBzbyBMb2d0cmFpbCBjYW4gbGluayBhIGxvZyB0b1xuICAgIC8vIHRoZSBleGFjdCBjdWxwcml0IGxpbmUuIENvbmZpZy1kcml2ZW4gKHBlci1jb25zdHJ1Y3QgcHJvcCBvciBhcHAgY29uZmlnKSwgZGVmYXVsdCAnd2Fybi1lcnJvcicuXG4gICAgLy8gV2hlbiBvbiwgYWRkIC0tZW5hYmxlLXNvdXJjZS1tYXBzIChtZXJnZWQpIHNvIHJ1bnRpbWUgc3RhY2tzIHJlc29sdmUgdG8gc291cmNlLCBub3QgdGhlIGJ1bmRsZS5cbiAgICBjb25zdCBwb3NpdGlvbk1vZGUgPVxuICAgICAgcHJvcHMubG9nU291cmNlUG9zaXRpb24gPz8gKGZ3MjQuZ2V0Q29uZmlnKCkgYXMgeyBsb2dTb3VyY2VQb3NpdGlvbj86IHN0cmluZyB9KS5sb2dTb3VyY2VQb3NpdGlvbiA/PyAnd2Fybi1lcnJvcic7XG4gICAgaWYgKHBvc2l0aW9uTW9kZSAhPT0gJ29mZicpIHtcbiAgICAgIGlmICghKCdMT0dfU09VUkNFX1BPU0lUSU9OJyBpbiBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcykpIHtcbiAgICAgICAgcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXNbICdMT0dfU09VUkNFX1BPU0lUSU9OJyBdID0gcG9zaXRpb25Nb2RlO1xuICAgICAgfVxuICAgICAgY29uc3QgZXhpc3RpbmdOb2RlT3B0cyA9IHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzWyAnTk9ERV9PUFRJT05TJyBdID8/ICcnO1xuICAgICAgaWYgKCFleGlzdGluZ05vZGVPcHRzLmluY2x1ZGVzKCctLWVuYWJsZS1zb3VyY2UtbWFwcycpKSB7XG4gICAgICAgIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzWyAnTk9ERV9PUFRJT05TJyBdID0gYCR7ZXhpc3RpbmdOb2RlT3B0c30gLS1lbmFibGUtc291cmNlLW1hcHNgLnRyaW0oKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAqIEVYUE9SVCB0aGUgbG9nLWxldmVsIGZvciBvdXIgbG9nZ2VyLWluc3RhbmNlcyBpbiB0aGUgcnVudGltZSBvZiB0aGlzIGxhbWJkYVxuICAgIC8vIFNlZSAnLi4vbG9nZ2luZy9pbmRleC50cycgZm9yIG1vcmUgaW5mb1xuICAgIC8vIE5PVEU6IHRoaXMgbG9nLWxldmVsIGlzIGRpZmZlcmVudCB0aGFuIHRoZSBhd3MtbG9nLWxldmVsXG4gICAgLy8gYXdzIHJlcXVpcmVzIHRoZSBsb2cgZm9ybWF0IHNldCB0byBKU09OIHRvIG92ZXJyaWRlIGxvZy1sZXZlbCBzZWUgYGFwcGxpY2F0aW9uTG9nTGV2ZWxWMmAgaW4gdGhlIGNvZGUgYWJvdmVcblxuICAgIC8vIGVuc3VyZSB0aGUgZW52aXJvbm1lbnQtdmFyaWFibGVzIGZvciB0aGUgbGFtYmRhIGFsd2F5cyBoYXZlIGEgbG9nLWxldmVsXG4gICAgaWYgKCEoJ0xPR19MRVZFTCcgaW4gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpKSB7XG4gICAgICBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgJ0xPR19MRVZFTCcgXSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpKSB7XG4gICAgICBsZXQgZW52VmFsdWUgPSB2YWx1ZTtcbiAgICAgIGxldCBlbnZLZXkgPSBrZXk7XG4gICAgICAvLyBJZiBrZXkgaXMgcHJlZml4ZWQgd2l0aCBmdzI0XywgYWNjZXNzIGVudmlyb25tZW50IHZhcmlhYmxlcyBmcm9tIGZ3MjQgc2NvcGVcbiAgICAgIC8vIGtleXMgY2FuIGhhdmUgc2hhcGUgbGlrZTpcbiAgICAgIC8vIGZ3MjRfeHh4ICh3aXRob3V0IHNjb3BlKVxuICAgICAgLy8gZncyNF9BdXRoTW9kdWxlX3h4eCAod2l0aCBzY29wZTogQXV0aE1vZHVsZSlcbiAgICAgIC8vIGZ3MjRfVXNlclBvb2xfQXV0aE1vZHVsZV91c2VyUG9vbElkICh3aXRoIHNjb3BlOiBVc2VyUG9vbF9BdXRoTW9kdWxlKVxuICAgICAgaWYgKHZhbHVlICYmIHZhbHVlLnN0YXJ0c1dpdGgoJ2Z3MjRfJykpIHtcbiAgICAgICAgLy8gUmVtb3ZlIGZ3MjRfIHByZWZpeFxuICAgICAgICBjb25zdCBrZXlXaXRob3V0UHJlZml4ID0gdmFsdWUucmVwbGFjZSgnZncyNF8nLCAnJyk7XG4gICAgICAgIGNvbnN0IHBhcnRzID0ga2V5V2l0aG91dFByZWZpeC5zcGxpdCgnXycpO1xuXG4gICAgICAgIC8vIExhc3QgcGFydCBpcyBhbHdheXMgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIG5hbWVcbiAgICAgICAgY29uc3QgZW52VmFyTmFtZSA9IHBhcnRzWyBwYXJ0cy5sZW5ndGggLSAxIF07XG5cbiAgICAgICAgLy8gRXZlcnl0aGluZyBiZWZvcmUgdGhlIGxhc3QgcGFydCBpcyB0aGUgc2NvcGUgKGlmIGFueSlcbiAgICAgICAgY29uc3Qgc2NvcGUgPSBwYXJ0cy5sZW5ndGggPiAxID8gcGFydHMuc2xpY2UoMCwgLTEpLmpvaW4oJ18nKSA6ICcnO1xuXG4gICAgICAgIGVudlZhbHVlID0gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudlZhck5hbWUsIHNjb3BlKTtcbiAgICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBSZXNvbHZlZCBmdzI0IGVudmlyb25tZW50IHZhcmlhYmxlOiAke3ZhbHVlfSAtPiAke2VudlZhbHVlfWAsIGlkKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGA6U0VUIGVudmlyb25tZW50IHZhcmlhYmxlIFske2VudktleX0gOiAke2VudlZhbHVlfV1gLCBpZCk7XG5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGVudktleSxcbiAgICAgICAgdmFsdWU6IGVudlZhbHVlXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBBZGQgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlcyB0byB0aGUgZnVuY3Rpb25cbiAgICBmdzI0LmdldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKCkuZm9yRWFjaChlbnZLZXkgPT4ge1xuICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBBZGRpbmcgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlOiAke2VudktleX1gLCBpZCk7XG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBlbnZLZXksXG4gICAgICAgIHZhbHVlOiBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoZW52S2V5KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBBdXRvLXNldCBFTlRSWV9QQUNLQUdFUyBmb3IgQUxMIExhbWJkYXMgKGVuc3VyZXMgREkgaW5pdGlhbGl6YXRpb24pXG4gICAgLy8gT25seSBzZXQgaWYgbm90IGFscmVhZHkgY29uZmlndXJlZCBpbiBwcm9wcyBvciBnbG9iYWwgZW52IHZhcnNcbiAgICBjb25zdCBnbG9iYWxFbnZLZXlzID0gZncyNC5nZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpO1xuICAgIGlmIChcbiAgICAgICEoRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMgaW4gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpXG4gICAgICAmJlxuICAgICAgIWdsb2JhbEVudktleXMuaW5jbHVkZXMoRU5WX0tFWVMuRU5UUllfUEFDS0FHRVMpXG4gICAgKSB7XG4gICAgICBjb25zdCBlbnRyeVBhY2thZ2VzID0gZncyNC5nZXRMYW1iZGFFbnRyeVBhY2thZ2VzKCk7XG4gICAgICBpZiAoZW50cnlQYWNrYWdlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIFJlc29sdmUgZW52IGtleSB0ZW1wbGF0ZXMgKGUuZy4sIGVudjpsYXllckltcG9ydFBhdGg6ZGkgLT4gL29wdC9ub2RlanMvbm9kZV9tb2R1bGVzL2RpL2luZGV4LmpzKVxuICAgICAgICBjb25zdCByZXNvbHZlZFBhY2thZ2VzID0gZW50cnlQYWNrYWdlcy5tYXAocGtnID0+IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHBrZykpO1xuICAgICAgICBjb25zdCBlbnRyeVBhY2thZ2VzVmFsdWUgPSByZXNvbHZlZFBhY2thZ2VzLmpvaW4oJywnKTtcbiAgICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBBdXRvLXNldHRpbmcgRU5UUllfUEFDS0FHRVM6ICR7ZW50cnlQYWNrYWdlc1ZhbHVlfWAsIGlkKTtcbiAgICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgICBmbixcbiAgICAgICAgICBrZXk6IEVOVl9LRVlTLkVOVFJZX1BBQ0tBR0VTLFxuICAgICAgICAgIHZhbHVlOiBlbnRyeVBhY2thZ2VzVmFsdWVcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIGdsb2JhbCBwb2xpY2llcyB0byB0aGUgZnVuY3Rpb25cbiAgICBmdzI0LmdldEdsb2JhbFBvbGljaWVzKCkuZm9yRWFjaChwb2xpY3kgPT4ge1xuICAgICAgYWRkUG9saWN5VG9GdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBmdzI0LFxuICAgICAgICBwb2xpY3lcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQXR0YWNoIHBvbGljaWVzIHRvIHRoZSBmdW5jdGlvblxuICAgIChwcm9wcy5wb2xpY2llcyA/PyBbXSkuZm9yRWFjaChwb2xpY3kgPT4ge1xuICAgICAgYWRkUG9saWN5VG9GdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBmdzI0LFxuICAgICAgICBwb2xpY3lcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTWVyZ2UgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB3aXRoIHBlci1mdW5jdGlvbiByZXNvdXJjZSBhY2Nlc3NcbiAgICBjb25zdCBnbG9iYWxSZXNvdXJjZUFjY2VzcyA9IGZ3MjQuZ2V0R2xvYmFsUmVzb3VyY2VBY2Nlc3MoKTtcbiAgICBjb25zdCBtZXJnZWRSZXNvdXJjZUFjY2VzcyA9IG1lcmdlUmVzb3VyY2VBY2Nlc3MoZ2xvYmFsUmVzb3VyY2VBY2Nlc3MsIHByb3BzLnJlc291cmNlQWNjZXNzKTtcblxuICAgIC8vIElmIHdlIGFyZSB1c2luZyBTRVMsIHRoZW4gd2UgbmVlZCB0byBhZGQgdGhlIGVtYWlsIHF1ZXVlIHVybCB0byB0aGUgZW52aXJvbm1lbnRcbiAgICBpZiAocHJvcHMuYWxsb3dTZW5kRW1haWwgJiYgZncyNC5lbWFpbFByb3ZpZGVyIGluc3RhbmNlb2YgTWFpbGVyQ29uc3RydWN0KSB7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlTmFtZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZW1haWxRdWV1ZV9xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSk7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMsIGAke2lkfS0ke2VtYWlsUXVldWVOYW1lfS1xdWV1ZWAsIGZ3MjQuZ2V0QXJuKCdzcXMnLCBlbWFpbFF1ZXVlTmFtZSkpO1xuXG4gICAgICBlbWFpbFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGBFTUFJTF9RVUVVRV9VUkxgLFxuICAgICAgICB2YWx1ZTogZW1haWxRdWV1ZS5xdWV1ZVVybFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBEeW5hbW9EQiB0YWJsZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBtZXJnZWRSZXNvdXJjZUFjY2Vzcz8udGFibGVzPy5mb3JFYWNoKCh0YWJsZTogUmVzb3VyY2VBY2Nlc3NJdGVtKSA9PiB7XG4gICAgICBsZXQgdGFibGVOYW1lID0gdHlwZW9mIHRhYmxlID09PSAnc3RyaW5nJyA/IHRhYmxlIDogdGFibGUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdGFibGVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodGFibGVOYW1lKTtcblxuICAgICAgY29uc3QgYXBwUXVhbGlmaWVkVGFibGVOYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMoZW5zdXJlU3VmZml4KHRhYmxlTmFtZSwgYHRhYmxlYCkpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgdGFibGUgPT09ICdzdHJpbmcnID8gWyAncmVhZHdyaXRlJyBdIDogdGFibGUuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcbiAgICAgIC8vIEdldCB0aGUgRHluYW1vREIgdGFibGUgYmFzZWQgb24gdGhlIGNvbnRyb2xsZXIgY29uZmlnXG4gICAgICBjb25zdCB0YWJsZUluc3RhbmNlOiBJVGFibGVWMiA9IFRhYmxlVjIuZnJvbVRhYmxlQXR0cmlidXRlcyh0aGlzLCBgJHtpZH0tJHt0YWJsZU5hbWV9LXRhYmxlYCwge1xuICAgICAgICB0YWJsZU5hbWU6IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShhcHBRdWFsaWZpZWRUYWJsZU5hbWUgKyAnX3RhYmxlTmFtZScsICd0YWJsZScsIHNjb3BlKSxcbiAgICAgICAgZ3JhbnRJbmRleFBlcm1pc3Npb25zOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCB0aGUgdGFibGUgbmFtZSB0byB0aGUgbGFtYmRhIGVudmlyb25tZW50ICAgICAgXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHthcHBRdWFsaWZpZWRUYWJsZU5hbWV9YCxcbiAgICAgICAgdmFsdWU6IHRhYmxlSW5zdGFuY2UudGFibGVOYW1lXG4gICAgICB9KTtcblxuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiByZWFkIHdyaXRlIGFjY2VzcyB0byB0aGUgdGFibGVcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVhZCc6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50UmVhZERhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnd3JpdGUnOlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFdyaXRlRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFJlYWRXcml0ZURhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBTMyBidWNrZXQgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgbWVyZ2VkUmVzb3VyY2VBY2Nlc3M/LmJ1Y2tldHM/LmZvckVhY2goKGJ1Y2tldDogUmVzb3VyY2VBY2Nlc3NJdGVtKSA9PiB7XG4gICAgICBsZXQgYnVja2V0TmFtZSA9IHR5cGVvZiBidWNrZXQgPT09ICdzdHJpbmcnID8gYnVja2V0IDogYnVja2V0Lm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIGJ1Y2tldE5hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShidWNrZXROYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIGJ1Y2tldCA9PT0gJ3N0cmluZycgPyBbICdyZWFkd3JpdGUnIF0gOiBidWNrZXQuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcblxuICAgICAgY29uc3QgYnVja2V0RnVsbE5hbWUgPSBmdzI0LmdldFVuaXF1ZU5hbWUoYnVja2V0TmFtZSk7XG4gICAgICBjb25zdCBidWNrZXRJbnN0YW5jZSA9IEJ1Y2tldC5mcm9tQnVja2V0TmFtZSh0aGlzLCBidWNrZXROYW1lICsgaWQgKyAnLWJ1Y2tldCcsIGJ1Y2tldEZ1bGxOYW1lKTtcbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gYWNjZXNzIHRvIHRoZSBidWNrZXRcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVhZCc6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFJlYWQoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnd3JpdGUnOlxuICAgICAgICAgICAgYnVja2V0SW5zdGFuY2UuZ3JhbnRXcml0ZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgYnVja2V0SW5zdGFuY2UuZ3JhbnRSZWFkV3JpdGUoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBidWNrZXQgbmFtZVxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYGJ1Y2tldF8ke2J1Y2tldE5hbWV9YCxcbiAgICAgICAgdmFsdWU6IGJ1Y2tldEZ1bGxOYW1lXG4gICAgICB9KTtcblxuICAgIH0pO1xuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBTUVMgcXVldWUgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgbWVyZ2VkUmVzb3VyY2VBY2Nlc3M/LnF1ZXVlcz8uZm9yRWFjaCgocXVldWU6IFJlc291cmNlQWNjZXNzSXRlbSkgPT4ge1xuICAgICAgbGV0IHF1ZXVlTmFtZSA9IHR5cGVvZiBxdWV1ZSA9PT0gJ3N0cmluZycgPyBxdWV1ZSA6IHF1ZXVlLm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIHF1ZXVlTmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHF1ZXVlTmFtZSk7XG5cbiAgICAgIGNvbnN0IGFjY2VzcyA9IHR5cGVvZiBxdWV1ZSA9PT0gJ3N0cmluZycgPyBbICdzZW5kJyBdIDogcXVldWUuYWNjZXNzIHx8IFsgJ3NlbmQnIF07XG5cbiAgICAgIGNvbnN0IHF1ZXVlQXJuID0gZncyNC5nZXRBcm4oJ3NxcycsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShxdWV1ZU5hbWUgKyAnX3F1ZXVlTmFtZScsICdxdWV1ZScsIHNjb3BlKSk7XG4gICAgICBjb25zdCBxdWV1ZUluc3RhbmNlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMsIHF1ZXVlTmFtZSArIGlkICsgJy1xdWV1ZScsIHF1ZXVlQXJuKTtcbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gYWNjZXNzIHRvIHRoZSBxdWV1ZVxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWNlaXZlJzpcbiAgICAgICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRDb25zdW1lTWVzc2FnZXMoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRQdXJnZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFNlbmRNZXNzYWdlcyhmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIHF1ZXVlIHVybFxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYCR7cXVldWVOYW1lfV9xdWV1ZVVybGAsXG4gICAgICAgIHZhbHVlOiBxdWV1ZUluc3RhbmNlLnF1ZXVlVXJsXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgLy8gQWRkIFNOUyB0b3BpYyBwZXJtaXNzaW9uXG4gICAgbWVyZ2VkUmVzb3VyY2VBY2Nlc3M/LnRvcGljcz8uZm9yRWFjaCgodG9waWM6IFJlc291cmNlQWNjZXNzSXRlbSkgPT4ge1xuICAgICAgbGV0IHRvcGljTmFtZSA9IHR5cGVvZiB0b3BpYyA9PT0gJ3N0cmluZycgPyB0b3BpYyA6IHRvcGljLm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIHRvcGljTmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHRvcGljTmFtZSk7XG5cbiAgICAgIGNvbnN0IGFjY2VzcyA9IHR5cGVvZiB0b3BpYyA9PT0gJ3N0cmluZycgPyBbICdwdWJsaXNoJyBdIDogdG9waWMuYWNjZXNzIHx8IFsgJ3B1Ymxpc2gnIF07XG5cbiAgICAgIGNvbnN0IHRvcGljQXJuID0gZncyNC5nZXRBcm4oJ3NucycsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUgKyAnX3RvcGljTmFtZScsICd0b3BpYycsIHNjb3BlKSk7XG4gICAgICBjb25zdCB0b3BpY0luc3RhbmNlID0gVG9waWMuZnJvbVRvcGljQXJuKHRoaXMsIHRvcGljTmFtZSArIGlkICsgJy10b3BpYycsIHRvcGljQXJuKTtcbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gYWNjZXNzIHRvIHRoZSB0b3BpY1xuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdG9waWNJbnN0YW5jZS5ncmFudFB1Ymxpc2goZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgdG9waWMgYXJuXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHt0b3BpY05hbWV9X3RvcGljQXJuYCxcbiAgICAgICAgdmFsdWU6IHRvcGljSW5zdGFuY2UudG9waWNBcm5cbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICByZXR1cm4gZm47XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUG9saWN5VG9GdW5jdGlvbihvcHRpb25zOiB7XG4gIGZuOiBOb2RlanNGdW5jdGlvbixcbiAgZncyNDogRncyNCxcbiAgcG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSxcbn0pIHtcbiAgY29uc3QgeyBmbiwgZncyNCwgcG9saWN5IH0gPSBvcHRpb25zO1xuXG4gIGxldCByZXNvbHZlZFBvbGljeTogVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3kgPSBwb2xpY3k7XG5cbiAgaWYgKGlzSW1wb3J0ZWRQb2xpY3kocG9saWN5KSkge1xuICAgIGNvbnN0IHBvbGljeUV4aXN0cyA9IGZ3MjQuaGFzUG9saWN5KHBvbGljeS5uYW1lLCBwb2xpY3kucHJlZml4KTtcblxuICAgIGlmICghcG9saWN5RXhpc3RzKSB7XG4gICAgICBpZiAocG9saWN5LmlzT3B0aW9uYWwpIHtcbiAgICAgICAgLy8gU2tpcCBvcHRpb25hbCBwb2xpY2llcyB0aGF0IGRvbid0IGV4aXN0XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgUG9saWN5ICR7cG9saWN5Lm5hbWV9IG5vdCBmb3VuZCBpbiBmdzI0IHNjb3BlYCk7XG4gICAgfVxuXG4gICAgcmVzb2x2ZWRQb2xpY3kgPSBmdzI0LmdldFBvbGljeShwb2xpY3kubmFtZSwgcG9saWN5LnByZWZpeCkgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ7XG4gIH1cblxuICBpZiAoIShyZXNvbHZlZFBvbGljeSBpbnN0YW5jZW9mIFBvbGljeVN0YXRlbWVudCkpIHtcbiAgICByZXNvbHZlZFBvbGljeSA9IG5ldyBQb2xpY3lTdGF0ZW1lbnQocmVzb2x2ZWRQb2xpY3kgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMpO1xuICB9XG5cbiAgZm4uYWRkVG9Sb2xlUG9saWN5KHJlc29sdmVkUG9saWN5IGFzIFBvbGljeVN0YXRlbWVudCk7XG5cbn1cblxuZnVuY3Rpb24gYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKG9wdGlvbnM6IHtcbiAgZm46IE5vZGVqc0Z1bmN0aW9uLFxuICBrZXk6IHN0cmluZyxcbiAgdmFsdWU6IHN0cmluZyxcbiAgcHJlZml4Pzogc3RyaW5nLFxuICBzdWZmaXg/OiBzdHJpbmcsXG59KSB7XG5cbiAgY29uc3QgeyBmbiwga2V5LCB2YWx1ZSwgcHJlZml4ID0gJycsIHN1ZmZpeCA9ICcnIH0gPSBvcHRpb25zO1xuXG4gIGNvbnN0IGVudktleSA9IGVuc3VyZVZhbGlkRW52S2V5KGtleSwgcHJlZml4LCBzdWZmaXgpO1xuICBmbi5hZGRFbnZpcm9ubWVudChlbnZLZXksIHZhbHVlKTtcbn1cblxuLyoqXG4gKiBNZXJnZXMgZ2xvYmFsIHJlc291cmNlIGFjY2VzcyB3aXRoIHBlci1mdW5jdGlvbiByZXNvdXJjZSBhY2Nlc3MuXG4gKiBQZXItZnVuY3Rpb24gcmVzb3VyY2UgYWNjZXNzIHRha2VzIHByZWNlZGVuY2UgKGNvbWVzIGFmdGVyIGdsb2JhbCBpbiB0aGUgbWVyZ2VkIGFycmF5KS5cbiAqIERlZHVwbGljYXRpb24gaXMgaGFuZGxlZCBhdCB0aGUgcmVzb3VyY2UgbGV2ZWwgLSBpZiB0aGUgc2FtZSByZXNvdXJjZSBhcHBlYXJzIGluIGJvdGhcbiAqIGdsb2JhbCBhbmQgcGVyLWZ1bmN0aW9uIGFjY2VzcywgYm90aCBlbnRyaWVzIGFyZSBrZXB0IChhbGxvd2luZyBmb3IgZGlmZmVyZW50IGFjY2VzcyBsZXZlbHMpLlxuICogXG4gKiBAcGFyYW0gZ2xvYmFsQWNjZXNzIC0gR2xvYmFsIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uIGZyb20gZncyNFxuICogQHBhcmFtIGZ1bmN0aW9uQWNjZXNzIC0gUGVyLWZ1bmN0aW9uIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBNZXJnZWQgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb25cbiAqL1xuZnVuY3Rpb24gbWVyZ2VSZXNvdXJjZUFjY2VzcyhcbiAgZ2xvYmFsQWNjZXNzOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB8IHVuZGVmaW5lZCxcbiAgZnVuY3Rpb25BY2Nlc3M6IElGdW5jdGlvblJlc291cmNlQWNjZXNzIHwgdW5kZWZpbmVkXG4pOiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gIGlmICghZ2xvYmFsQWNjZXNzICYmICFmdW5jdGlvbkFjY2Vzcykge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIGlmICghZ2xvYmFsQWNjZXNzKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uQWNjZXNzITtcbiAgfVxuXG4gIGlmICghZnVuY3Rpb25BY2Nlc3MpIHtcbiAgICByZXR1cm4gZ2xvYmFsQWNjZXNzO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0YWJsZXM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnRhYmxlcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MudGFibGVzIHx8IFtdKVxuICAgIF0pLFxuICAgIGJ1Y2tldHM6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLmJ1Y2tldHMgfHwgW10pLFxuICAgICAgLi4uKGZ1bmN0aW9uQWNjZXNzLmJ1Y2tldHMgfHwgW10pXG4gICAgXSksXG4gICAgcXVldWVzOiBkZWR1cGxpY2F0ZVJlc291cmNlQXJyYXkoW1xuICAgICAgLi4uKGdsb2JhbEFjY2Vzcy5xdWV1ZXMgfHwgW10pLFxuICAgICAgLi4uKGZ1bmN0aW9uQWNjZXNzLnF1ZXVlcyB8fCBbXSlcbiAgICBdKSxcbiAgICB0b3BpY3M6IGRlZHVwbGljYXRlUmVzb3VyY2VBcnJheShbXG4gICAgICAuLi4oZ2xvYmFsQWNjZXNzLnRvcGljcyB8fCBbXSksXG4gICAgICAuLi4oZnVuY3Rpb25BY2Nlc3MudG9waWNzIHx8IFtdKVxuICAgIF0pXG4gIH07XG59XG5cbi8qKlxuICogRGVkdXBsaWNhdGVzIHJlc291cmNlIGFycmF5IGVudHJpZXMgYnkgbmFtZSwgcHJlZmVycmluZyBlbnRyaWVzIHdpdGggZXhwbGljaXQgYWNjZXNzIG92ZXIgaW1wbGljaXQuXG4gKiBXaGVuIHRoZSBzYW1lIHJlc291cmNlIGFwcGVhcnMgbXVsdGlwbGUgdGltZXM6XG4gKiAtIElmIGJvdGggaGF2ZSBleHBsaWNpdCBhY2Nlc3MgYXJyYXlzLCBtZXJnZSB0aGUgYWNjZXNzIGFycmF5c1xuICogLSBJZiBvbmUgaGFzIGV4cGxpY2l0IGFjY2VzcyBhbmQgb25lIGRvZXNuJ3QsIHVzZSB0aGUgZXhwbGljaXQgb25lXG4gKiAtIElmIGJvdGggYXJlIHN0cmluZ3MgKGltcGxpY2l0IHJlYWR3cml0ZSksIGtlZXAgb25seSBvbmVcbiAqIFxuICogQHBhcmFtIHJlc291cmNlcyAtIEFycmF5IG9mIHJlc291cmNlIGVudHJpZXMgKHN0cmluZyBvciB7IG5hbWUsIGFjY2Vzcz8gfSlcbiAqIEByZXR1cm5zIERlZHVwbGljYXRlZCBhcnJheVxuICovXG5mdW5jdGlvbiBkZWR1cGxpY2F0ZVJlc291cmNlQXJyYXk8VCBleHRlbmRzIHN0cmluZyB8IHsgbmFtZTogc3RyaW5nOyBhY2Nlc3M/OiBzdHJpbmdbXSB9PihcbiAgcmVzb3VyY2VzOiBUW11cbik6IFRbXSB7XG4gIGlmICghcmVzb3VyY2VzIHx8IHJlc291cmNlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXNvdXJjZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBUPigpO1xuXG4gIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgY29uc3QgbmFtZSA9IHR5cGVvZiByZXNvdXJjZSA9PT0gJ3N0cmluZycgPyByZXNvdXJjZSA6IHJlc291cmNlLm5hbWU7XG4gICAgY29uc3QgZXhpc3RpbmdSZXNvdXJjZSA9IHJlc291cmNlTWFwLmdldChuYW1lKTtcblxuICAgIGlmICghZXhpc3RpbmdSZXNvdXJjZSkge1xuICAgICAgcmVzb3VyY2VNYXAuc2V0KG5hbWUsIHJlc291cmNlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTWVyZ2UgbG9naWM6IHByZWZlciBleHBsaWNpdCBhY2Nlc3Mgb3ZlciBpbXBsaWNpdFxuICAgICAgY29uc3QgZXhpc3RpbmdBY2Nlc3MgPSB0eXBlb2YgZXhpc3RpbmdSZXNvdXJjZSA9PT0gJ3N0cmluZycgPyB1bmRlZmluZWQgOiBleGlzdGluZ1Jlc291cmNlLmFjY2VzcztcbiAgICAgIGNvbnN0IG5ld0FjY2VzcyA9IHR5cGVvZiByZXNvdXJjZSA9PT0gJ3N0cmluZycgPyB1bmRlZmluZWQgOiByZXNvdXJjZS5hY2Nlc3M7XG5cbiAgICAgIGlmIChleGlzdGluZ0FjY2VzcyAmJiBuZXdBY2Nlc3MpIHtcbiAgICAgICAgLy8gQm90aCBoYXZlIGV4cGxpY2l0IGFjY2VzcyAtIG1lcmdlIGFuZCBkZWR1cGxpY2F0ZVxuICAgICAgICBjb25zdCBtZXJnZWRBY2Nlc3MgPSBBcnJheS5mcm9tKG5ldyBTZXQoWyAuLi5leGlzdGluZ0FjY2VzcywgLi4ubmV3QWNjZXNzIF0pKTtcbiAgICAgICAgcmVzb3VyY2VNYXAuc2V0KG5hbWUsIHsgbmFtZSwgYWNjZXNzOiBtZXJnZWRBY2Nlc3MgfSBhcyBUKTtcbiAgICAgIH0gZWxzZSBpZiAobmV3QWNjZXNzKSB7XG4gICAgICAgIC8vIE5ldyBoYXMgZXhwbGljaXQgYWNjZXNzLCBleGlzdGluZyBkb2Vzbid0IC0gcHJlZmVyIG5ld1xuICAgICAgICByZXNvdXJjZU1hcC5zZXQobmFtZSwgcmVzb3VyY2UpO1xuICAgICAgfVxuICAgICAgLy8gZWxzZTogZXhpc3RpbmcgaGFzIGV4cGxpY2l0IGFjY2VzcyBvciBib3RoIGltcGxpY2l0IC0ga2VlcCBleGlzdGluZ1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBBcnJheS5mcm9tKHJlc291cmNlTWFwLnZhbHVlcygpKTtcbn1cbiJdfQ==