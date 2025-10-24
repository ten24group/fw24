"use strict";
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
        // map layers to actual layer objects
        const resolvedLayers = deDupLayers.map(layerName => {
            if (typeof layerName === 'string') {
                return aws_lambda_1.LayerVersion.fromLayerVersionArn(this, `${id}-${layerName}-Layer`, fw24.getEnvironmentVariable(layerName + '_layerVersionArn', 'layer', scope));
            }
            return layerName;
        });
        // make sure to add fw24 layer
        additionalProps.layers = [
            ...resolvedLayers,
            aws_lambda_1.LayerVersion.fromLayerVersionArn(this, `${id}-Fw24CoreLayer`, fw24.getEnvironmentVariable('fw24_layerVersionArn', 'layer', scope))
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
            this.logger?.info(`Adding global environment variable: ${envKey}`, id);
            addEnvironmentKeyValueForFunction({
                fn,
                key: envKey,
                value: fw24.getEnvironmentVariable(envKey)
            });
        });
        // Attach policies to the function
        (props.policies ?? []).forEach(policy => {
            if (isImportedPolicy(policy)) {
                if (!policy.isOptional && !fw24.hasPolicy(policy.name, policy.prefix)) {
                    throw new Error(`Policy ${policy} not found in fw24 scope`);
                }
                policy = fw24.getPolicy(policy.name, policy.prefix);
            }
            if (!(policy instanceof aws_iam_1.PolicyStatement)) {
                policy = new aws_iam_1.PolicyStatement(policy);
            }
            fn.addToRolePolicy(policy);
        });
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
        props.resourceAccess?.tables?.forEach((table) => {
            let tableName = typeof table === 'string' ? table : table.name;
            // ensure the placeholder env keys are resolved from the fw24 scope
            tableName = fw24.tryResolveEnvKeyTemplate(tableName);
            const appQualifiedTableName = (0, keys_1.ensureNoSpecialChars)((0, keys_1.ensureSuffix)(tableName, `table`));
            const access = typeof table === 'string' ? ['readwrite'] : table.access || ['readwrite'];
            // Get the DynamoDB table based on the controller config
            const tableInstance = aws_dynamodb_1.TableV2.fromTableAttributes(this, `${id}-${tableName}-table-${Math.random().toString(36).substr(2, 9)}`, {
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
        props.resourceAccess?.buckets?.forEach((bucket) => {
            let bucketName = typeof bucket === 'string' ? bucket : bucket.name;
            // ensure the placeholder env keys are resolved from the fw24 scope
            bucketName = fw24.tryResolveEnvKeyTemplate(bucketName);
            const access = typeof bucket === 'string' ? ['readwrite'] : bucket.access || ['readwrite'];
            const bucketFullName = fw24.getUniqueName(bucketName);
            const bucketInstance = aws_s3_1.Bucket.fromBucketName(this, `${bucketName}-${id}-bucket-${Math.random().toString(36).substr(2, 9)}`, bucketFullName);
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
        props.resourceAccess?.queues?.forEach((queue) => {
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
        props.resourceAccess?.topics?.forEach((topic) => {
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
function addEnvironmentKeyValueForFunction(options) {
    const { fn, key, value, prefix = '', suffix = '' } = options;
    const envKey = (0, keys_1.ensureValidEnvKey)(key, prefix, suffix);
    fn.addEnvironment(envKey, value);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWlCQSw0Q0FFQztBQTRKRCx3Q0FnQkM7QUEvTEQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsbURBQStEO0FBQy9ELHdDQUFzRjtBQUl0RixTQUFnQixnQkFBZ0IsQ0FBQyxNQUFpRDtJQUNoRixPQUFRLE1BQTBCLENBQUMsSUFBSSxLQUFLLFNBQVMsQ0FBQztBQUN4RCxDQUFDO0FBMkdEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStDRztBQUVILFNBQWdCLGNBQWMsQ0FBQyxRQUFpQjtJQUM5QyxRQUFRLFFBQVEsRUFBRSxXQUFXLEVBQUUsRUFBRSxDQUFDO1FBQ2hDLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssTUFBTTtZQUNULE9BQU8sZ0NBQW1CLENBQUMsSUFBSSxDQUFDO1FBQ2xDLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssTUFBTSxDQUFDO1FBQ1o7WUFDRSxPQUFPLGdDQUFtQixDQUFDLElBQUksQ0FBQTtJQUNuQyxDQUFDO0FBQ0gsQ0FBQztBQUVELE1BQWEsY0FBZSxTQUFRLHNCQUFT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bkMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgUG9saWN5U3RhdGVtZW50LCB0eXBlIFBvbGljeVN0YXRlbWVudFByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IFJ1bnRpbWUsIEFyY2hpdGVjdHVyZSwgTGF5ZXJWZXJzaW9uLCBBcHBsaWNhdGlvbkxvZ0xldmVsLCBMb2dnaW5nRm9ybWF0LCBJTGF5ZXJWZXJzaW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGFcIjtcbmltcG9ydCB7IElUYWJsZVYyLCBUYWJsZVYyIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBCdWNrZXQgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IFRvcGljIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciwgSUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBMb2dHcm91cCwgUmV0ZW50aW9uRGF5cyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgZW5zdXJlTm9TcGVjaWFsQ2hhcnMsIGVuc3VyZVN1ZmZpeCwgZW5zdXJlVmFsaWRFbnZLZXkgfSBmcm9tIFwiLi4vdXRpbHMva2V5c1wiO1xuZXhwb3J0IHR5cGUgVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgPSBQb2xpY3lTdGF0ZW1lbnQgfCBQb2xpY3lTdGF0ZW1lbnRQcm9wcztcbmV4cG9ydCB0eXBlIFRJbXBvcnRlZFBvbGljeSA9IHsgbmFtZTogc3RyaW5nLCBpc09wdGlvbmFsPzogYm9vbGVhbiwgcHJlZml4Pzogc3RyaW5nIH07XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0ltcG9ydGVkUG9saWN5KHBvbGljeTogVFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3kpOiBwb2xpY3kgaXMgVEltcG9ydGVkUG9saWN5IHtcbiAgcmV0dXJuIChwb2xpY3kgYXMgVEltcG9ydGVkUG9saWN5KS5uYW1lICE9PSB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgcHJvcGVydGllcyBmb3IgYSBMYW1iZGEgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGFtYmRhRnVuY3Rpb25Qcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgZW50cnkgcG9pbnQgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBlbnRyeTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSBMYW1iZGEgZnVuY3Rpb24ncyBleGVjdXRpb24gcm9sZS5cbiAgICovXG4gIHBvbGljaWVzPzogQXJyYXk8VFBvbGljeVN0YXRlbWVudE9yUHJvcHMgfCBUSW1wb3J0ZWRQb2xpY3k+O1xuXG4gIC8qKlxuICAgKiBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIHNldCBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGVudmlyb25tZW50VmFyaWFibGVzPzogeyBbIGtleTogc3RyaW5nIF06IHN0cmluZyB9O1xuXG4gIC8qKlxuICAgKiBUaGUgcmVzb3VyY2UgYWNjZXNzIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICByZXNvdXJjZUFjY2Vzcz86IElGdW5jdGlvblJlc291cmNlQWNjZXNzO1xuXG4gIC8qKlxuICAgKiBJbmRpY2F0ZXMgd2hldGhlciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGlzIGFsbG93ZWQgdG8gc2VuZCBlbWFpbHMuXG4gICAqL1xuICBhbGxvd1NlbmRFbWFpbD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgZGF5cyB0byByZXRhaW4gdGhlIGxvZ3MgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBsb2dSZXRlbnRpb25EYXlzPzogUmV0ZW50aW9uRGF5cztcblxuICAvKipcbiAgICogVGhlIHJlbW92YWwgcG9saWN5IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uJ3MgbG9ncy5cbiAgICovXG4gIGxvZ1JlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xuXG4gIC8qKlxuICAgKiBUaGUgdGltZW91dCBkdXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbiBpbiBzZWNvbmRzLlxuICAgKiBVc2UgdGhpcyB0aW1lb3V0IHRvIGF2b2lkIGltcG9ydGluZyB0aGUgZHVyYXRpb24gY2xhc3MgZnJvbSBhd3MtY2RrLWxpYi5cbiAgICovXG4gIGZ1bmN0aW9uVGltZW91dD86IG51bWJlcjtcblxuICBwcm9jZXNzb3JBcmNoaXRlY3R1cmU/OiAneDg2XzY0JyB8ICdhcm1fNjQnO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGZ1bmN0aW9uUHJvcHM/OiBPbWl0PE5vZGVqc0Z1bmN0aW9uUHJvcHMsICdsYXllcnMnPiAmIHtcbiAgICByZWFkb25seSBsYXllcnM/OiBBcnJheTxJTGF5ZXJWZXJzaW9uIHwgc3RyaW5nPjtcbiAgfVxufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdmFyaW91cyByZXNvdXJjZXMgdGhhdCBjYW4gYmUgYWNjZXNzZWQgYnkgYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcyB7XG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHRhYmxlcy5cbiAgICogRWFjaCB0YWJsZSBjYW4gaGF2ZSBhIG5hbWUgYW5kIGFuIG9wdGlvbmFsIGFycmF5IG9mIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3JlYWQnLCAnd3JpdGUnLCBvciAncmVhZHdyaXRlJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdyZWFkd3JpdGUnLlxuICAgKi9cbiAgdGFibGVzPzogQXJyYXk8e1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhY2Nlc3M/OiBzdHJpbmdbXTtcbiAgfT4gfCBzdHJpbmdbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciBidWNrZXRzLlxuICAgKiBFYWNoIGJ1Y2tldCBjYW4gaGF2ZSBhIG5hbWUgYW5kIGFuIG9wdGlvbmFsIGFycmF5IG9mIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3JlYWQnLCAnd3JpdGUnLCBvciAncmVhZHdyaXRlJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdyZWFkd3JpdGUnLlxuICAgKi9cbiAgYnVja2V0cz86IEFycmF5PHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgYWNjZXNzPzogc3RyaW5nW107XG4gIH0+IHwgc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdG9waWNzLlxuICAgKiBFYWNoIHRvcGljIGNhbiBoYXZlIGEgbmFtZSBhbmQgYW4gb3B0aW9uYWwgYXJyYXkgb2YgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncHVibGlzaCcuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncHVibGlzaCcuXG4gICAqL1xuICB0b3BpY3M/OiBBcnJheTx7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGFjY2Vzcz86IHN0cmluZ1tdO1xuICB9PiB8IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHF1ZXVlcy5cbiAgICogRWFjaCBxdWV1ZSBjYW4gaGF2ZSBhIG5hbWUgYW5kIGFuIG9wdGlvbmFsIGFycmF5IG9mIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3NlbmQnLCAncmVjZWl2ZScsIG9yICdkZWxldGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3NlbmQnLlxuICAgKi9cbiAgcXVldWVzPzogQXJyYXk8e1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhY2Nlc3M/OiBzdHJpbmdbXTtcbiAgfT4gfCBzdHJpbmdbXTtcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBMYW1iZGEgZnVuY3Rpb24gY29uc3RydWN0LlxuICpcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQ3JlYXRlIGEgTGFtYmRhIGZ1bmN0aW9uIHdpdGggY3VzdG9tIHByb3BlcnRpZXNcbiAqIGNvbnN0IGxhbWJkYVByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzID0ge1xuICogICBlbnRyeTogXCJpbmRleC5qc1wiLFxuICogICBwb2xpY2llczogW3tcbiAqICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gKiAgICAgICAgIGFjdGlvbnM6IFtcbiAqICAgICAgICAgIFwiczM6R2V0T2JqZWN0XCJcbiAqICAgICAgICAgXSxcbiAqICAgICAgICAgcmVzb3VyY2VzOiBbXCJhcm46YXdzOnMzOjo6bXktYnVja2V0LypcIl0sXG4gKiAgICAgfSwgXG4gKiAgICAge1xuICogICAgICAgcG9saWN5OiBcImF1dGhNb2R1bGU6Y3JlYXRlLXVzZXItYXV0aC1yZWNvcmRcIixcbiAqICAgICAgIGlzT3B0aW9uYWw6IHRydWVcbiAqICAgICB9XG4gKiAgIF0sXG4gKiAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gKiAgICAgTVlfRU5WX1ZBUjogXCJteS12YWx1ZVwiLFxuICogICB9LFxuICogICByZXNvdXJjZUFjY2Vzczoge1xuICogICAgIHRhYmxlczogW1xuICogICAgICAge1xuICogICAgICAgICBuYW1lOiBcIm15LXRhYmxlXCIsXG4gKiAgICAgICAgIGFjY2VzczogW1wicmVhZFwiLCBcIndyaXRlXCJdLFxuICogICAgICAgfSxcbiAqICAgICBdLFxuICogICAgIGJ1Y2tldHM6IFtcIm15LWJ1Y2tldFwiXSxcbiAqICAgICB0b3BpY3M6IFtcIm15LXRvcGljXCJdLFxuICogICAgIHF1ZXVlczogW1wibXktcXVldWVcIl0sXG4gKiAgIH0sXG4gKiAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICogICBsb2dSZXRlbnRpb25EYXlzOiBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICogICBsb2dSZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gKiAgIGZ1bmN0aW9uVGltZW91dDogMTAsXG4gKiAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAqICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuICogICAgIG1lbW9yeVNpemU6IDI1NixcbiAqICAgfSxcbiAqIH07XG4gKlxuICogY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgTGFtYmRhRnVuY3Rpb24oc3RhY2ssIFwiTXlMYW1iZGFGdW5jdGlvblwiLCBsYW1iZGFQcm9wcyk7XG4gKiBcbiAqIGBgYFxuICovXG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRMb2dMZXZlbChsb2dMZXZlbD86IHN0cmluZykge1xuICBzd2l0Y2ggKGxvZ0xldmVsPy50b1VwcGVyQ2FzZSgpKSB7XG4gICAgY2FzZSAnRVJST1InOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuRVJST1I7XG4gICAgY2FzZSAnV0FSTic6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5XQVJOO1xuICAgIGNhc2UgJ0RFQlVHJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkRFQlVHO1xuICAgIGNhc2UgJ1RSQUNFJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLlRSQUNFO1xuICAgIGNhc2UgJ0ZBVEFMJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkZBVEFMO1xuICAgIGNhc2UgJ0lORk8nOlxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5JTkZPXG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYUZ1bmN0aW9uIGV4dGVuZHMgQ29uc3RydWN0IHtcblxuICByZWFkb25seSBsb2dnZXI/OiBJTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdMYW1iZGFGdW5jdGlvbicpO1xuXG4gIC8qKlxuICAgKiBDb25zdHJ1Y3RzIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBMYW1iZGFGdW5jdGlvbiBjbGFzcy5cbiAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3QuXG4gICAqIEBwYXJhbSBpZCAtIFRoZSBJRCBvZiB0aGUgY29uc3RydWN0LlxuICAgKiBAcGFyYW0gcHJvcHMgLSBUaGUgTGFtYmRhIGZ1bmN0aW9uIHByb3BlcnRpZXMuXG4gICAqIEByZXR1cm5zIFRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTGFtYmRhRnVuY3Rpb25Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgLy8gRGVmYXVsdCBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvblxuICAgIGxldCBkZWZhdWx0UHJvcHM6IE5vZGVqc0Z1bmN0aW9uUHJvcHMgPSB7XG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuQVJNXzY0LFxuICAgICAgaGFuZGxlcjogXCJoYW5kbGVyXCIsXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogcHJvY2Vzcy5lbnYuTE9HX0ZPUk1BVD8udG9Mb3dlckNhc2U/LigpID09PSAnanNvbicgPyBMb2dnaW5nRm9ybWF0LkpTT04gOiBMb2dnaW5nRm9ybWF0LlRFWFQsXG4gICAgICAuLi5mdzI0LmdldENvbmZpZygpLmZ1bmN0aW9uUHJvcHMgYXMgTm9kZWpzRnVuY3Rpb25Qcm9wcyxcbiAgICB9O1xuXG4gICAgLy8gICdFcnJvcicgIFRvIHVzZSBBcHBsaWNhdGlvbkxvZ0xldmVsIGFuZC9vciBTeXN0ZW1Mb2dMZXZlbCB5b3UgbXVzdCBzZXQgTG9nZ2luZ0Zvcm1hdCB0byAnSlNPTicsIGdvdCAnVGV4dCcuXG4gICAgaWYgKGRlZmF1bHRQcm9wcy5sb2dnaW5nRm9ybWF0ID09PSBMb2dnaW5nRm9ybWF0LkpTT04pIHtcbiAgICAgIGRlZmF1bHRQcm9wcyA9IHtcbiAgICAgICAgLi4uZGVmYXVsdFByb3BzLFxuICAgICAgICBhcHBsaWNhdGlvbkxvZ0xldmVsVjI6IGZvcm1hdExvZ0xldmVsKHByb2Nlc3MuZW52LkxPR19MRVZFTClcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGxvZyBncm91cCBpZiBub3QgcHJvdmlkZWRcbiAgICBsZXQgbG9nR3JvdXAgPSBwcm9wcy5mdW5jdGlvblByb3BzPy5sb2dHcm91cDtcbiAgICBpZiAoIWxvZ0dyb3VwKSB7XG4gICAgICBsZXQgbG9nUmV0ZW50aW9uRGF5cyA9IHByb3BzLmxvZ1JldGVudGlvbkRheXMgfHwgZncyNC5nZXRDb25maWcoKS5sb2dSZXRlbnRpb25EYXlzIHx8IDMwO1xuICAgICAgbG9nR3JvdXAgPSBuZXcgTG9nR3JvdXAodGhpcywgYCR7aWR9LUxvZ0dyb3VwYCwge1xuICAgICAgICByZW1vdmFsUG9saWN5OiBwcm9wcy5sb2dSZW1vdmFsUG9saWN5IHx8IGZ3MjQuZ2V0Q29uZmlnKCkubG9nUmVtb3ZhbFBvbGljeSB8fCBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgcmV0ZW50aW9uOiBwYXJzZUludChsb2dSZXRlbnRpb25EYXlzLnRvU3RyaW5nKCkpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgbGV0IGFkZGl0aW9uYWxQcm9wczogYW55ID0ge1xuICAgICAgZW50cnk6IHByb3BzLmVudHJ5LFxuICAgIH1cblxuICAgIC8vIGNvbGxlY3QgdGhlIG5hbWVzIG9mIHRoZSBsYXllcnMgcHJvdmlkZWQgaW4gZGVmYXVsdCBjb25maWcgaWYgYW55IG9yIGVsc2UgdGhlIGdsb2JhbCBsYXllcnM7XG4gICAgY29uc3QgZGVmYXVsdExheWVycyA9IGRlZmF1bHRQcm9wcz8ubGF5ZXJzID8/IEFycmF5LmZyb20oZncyNC5nZXRHbG9iYWxMYW1iZGFMYXllck5hbWVzKCkpO1xuXG4gICAgLy8gcmVzb2x2ZSBsYXllciBuYW1lcyB0byBhY3R1YWwgbGF5ZXIgYXJuc1xuICAgIGNvbnN0IGxheWVycyA9IFtcbiAgICAgIC4uLmRlZmF1bHRMYXllcnMsXG4gICAgICAvLyBjb2xsZWN0IHRoZSBuYW1lcyBvZiB0aGUgbGF5ZXJzIHByb3ZpZGVkIGluIGZ1bmN0aW9uIGNvbmZpZyBpZiBhbnk7XG4gICAgICAuLi4ocHJvcHMuZnVuY3Rpb25Qcm9wcz8ubGF5ZXJzID8/IFtdKVxuICAgIF0gYXMgQXJyYXk8c3RyaW5nIHwgSUxheWVyVmVyc2lvbj47XG5cbiAgICAvLyByZW1vdmUgZHVwbGljYXRlc1xuICAgIGNvbnN0IGRlRHVwTGF5ZXJzID0gQXJyYXkuZnJvbShuZXcgU2V0KGxheWVycykpO1xuXG4gICAgLy8gbWFwIGxheWVycyB0byBhY3R1YWwgbGF5ZXIgb2JqZWN0c1xuICAgIGNvbnN0IHJlc29sdmVkTGF5ZXJzID0gZGVEdXBMYXllcnMubWFwKGxheWVyTmFtZSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGxheWVyTmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIExheWVyVmVyc2lvbi5mcm9tTGF5ZXJWZXJzaW9uQXJuKHRoaXMsIGAke2lkfS0ke2xheWVyTmFtZX0tTGF5ZXJgLCBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lICsgJ19sYXllclZlcnNpb25Bcm4nLCAnbGF5ZXInLCBzY29wZSkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGF5ZXJOYW1lO1xuICAgIH0pXG5cbiAgICAvLyBtYWtlIHN1cmUgdG8gYWRkIGZ3MjQgbGF5ZXJcbiAgICBhZGRpdGlvbmFsUHJvcHMubGF5ZXJzID0gW1xuICAgICAgLi4ucmVzb2x2ZWRMYXllcnMsXG4gICAgICBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCBgJHtpZH0tRncyNENvcmVMYXllcmAsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZncyNF9sYXllclZlcnNpb25Bcm4nLCAnbGF5ZXInLCBzY29wZSkpXG4gICAgXTtcblxuICAgIGFkZGl0aW9uYWxQcm9wcy5idW5kbGluZyA9IHtcbiAgICAgIC4uLmRlZmF1bHRQcm9wcy5idW5kbGluZyxcbiAgICAgIC4uLnByb3BzLmZ1bmN0aW9uUHJvcHM/LmJ1bmRsaW5nLFxuICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgIC4uLihkZWZhdWx0UHJvcHM/LmJ1bmRsaW5nPy5leHRlcm5hbE1vZHVsZXMgPz8gW10pLFxuICAgICAgICAuLi4ocHJvcHMuZnVuY3Rpb25Qcm9wcz8uYnVuZGxpbmc/LmV4dGVybmFsTW9kdWxlcyA/PyBbXSksXG4gICAgICAgIFwiQHRlbjI0Z3JvdXAvZncyNFwiXG4gICAgICBdLFxuICAgIH07XG4gICAgYWRkaXRpb25hbFByb3BzLmxvZ0dyb3VwID0gbG9nR3JvdXA7XG4gICAgaWYgKHByb3BzLmZ1bmN0aW9uVGltZW91dCkge1xuICAgICAgYWRkaXRpb25hbFByb3BzLnRpbWVvdXQgPSBEdXJhdGlvbi5zZWNvbmRzKHByb3BzLmZ1bmN0aW9uVGltZW91dCk7XG4gICAgfVxuXG4gICAgaWYgKHByb3BzLnByb2Nlc3NvckFyY2hpdGVjdHVyZSkge1xuICAgICAgYWRkaXRpb25hbFByb3BzLmFyY2hpdGVjdHVyZSA9IHByb3BzLnByb2Nlc3NvckFyY2hpdGVjdHVyZSA9PT0gJ3g4Nl82NCcgPyBBcmNoaXRlY3R1cmUuWDg2XzY0IDogQXJjaGl0ZWN0dXJlLkFSTV82NDtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgdGhlIE5vZGUuanMgZnVuY3Rpb25cbiAgICBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBpZCwge1xuICAgICAgLi4uZGVmYXVsdFByb3BzLFxuICAgICAgLi4ucHJvcHMuZnVuY3Rpb25Qcm9wcyxcbiAgICAgIC4uLmFkZGl0aW9uYWxQcm9wcyxcbiAgICB9KTtcblxuICAgIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzID0gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMgPz8ge307XG5cbiAgICAvLyAqIEVYUE9SVCB0aGUgbG9nLWxldmVsIGZvciBvdXIgbG9nZ2VyLWluc3RhbmNlcyBpbiB0aGUgcnVudGltZSBvZiB0aGlzIGxhbWJkYVxuICAgIC8vIFNlZSAnLi4vbG9nZ2luZy9pbmRleC50cycgZm9yIG1vcmUgaW5mb1xuICAgIC8vIE5PVEU6IHRoaXMgbG9nLWxldmVsIGlzIGRpZmZlcmVudCB0aGFuIHRoZSBhd3MtbG9nLWxldmVsXG4gICAgLy8gYXdzIHJlcXVpcmVzIHRoZSBsb2cgZm9ybWF0IHNldCB0byBKU09OIHRvIG92ZXJyaWRlIGxvZy1sZXZlbCBzZWUgYGFwcGxpY2F0aW9uTG9nTGV2ZWxWMmAgaW4gdGhlIGNvZGUgYWJvdmVcblxuICAgIC8vIGVuc3VyZSB0aGUgZW52aXJvbm1lbnQtdmFyaWFibGVzIGZvciB0aGUgbGFtYmRhIGFsd2F5cyBoYXZlIGEgbG9nLWxldmVsXG4gICAgaWYgKCEoJ0xPR19MRVZFTCcgaW4gcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpKSB7XG4gICAgICBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlc1sgJ0xPR19MRVZFTCcgXSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnTE9HX0xFVkVMJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXMpKSB7XG4gICAgICBsZXQgZW52VmFsdWUgPSB2YWx1ZTtcbiAgICAgIGxldCBlbnZLZXkgPSBrZXk7XG4gICAgICAvLyBJZiBrZXkgaXMgcHJlZml4ZWQgd2l0aCBmdzI0XywgYWNjZXNzIGVudmlyb25tZW50IHZhcmlhYmxlcyBmcm9tIGZ3MjQgc2NvcGVcbiAgICAgIC8vIGtleXMgY2FuIGhhdmUgc2hhcGUgbGlrZTpcbiAgICAgIC8vIGZ3MjRfeHh4ICh3aXRob3V0IHNjb3BlKVxuICAgICAgLy8gZncyNF9BdXRoTW9kdWxlX3h4eCAod2l0aCBzY29wZTogQXV0aE1vZHVsZSlcbiAgICAgIC8vIGZ3MjRfVXNlclBvb2xfQXV0aE1vZHVsZV91c2VyUG9vbElkICh3aXRoIHNjb3BlOiBVc2VyUG9vbF9BdXRoTW9kdWxlKVxuICAgICAgaWYgKHZhbHVlICYmIHZhbHVlLnN0YXJ0c1dpdGgoJ2Z3MjRfJykpIHtcbiAgICAgICAgLy8gUmVtb3ZlIGZ3MjRfIHByZWZpeFxuICAgICAgICBjb25zdCBrZXlXaXRob3V0UHJlZml4ID0gdmFsdWUucmVwbGFjZSgnZncyNF8nLCAnJyk7XG4gICAgICAgIGNvbnN0IHBhcnRzID0ga2V5V2l0aG91dFByZWZpeC5zcGxpdCgnXycpO1xuXG4gICAgICAgIC8vIExhc3QgcGFydCBpcyBhbHdheXMgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlIG5hbWVcbiAgICAgICAgY29uc3QgZW52VmFyTmFtZSA9IHBhcnRzWyBwYXJ0cy5sZW5ndGggLSAxIF07XG5cbiAgICAgICAgLy8gRXZlcnl0aGluZyBiZWZvcmUgdGhlIGxhc3QgcGFydCBpcyB0aGUgc2NvcGUgKGlmIGFueSlcbiAgICAgICAgY29uc3Qgc2NvcGUgPSBwYXJ0cy5sZW5ndGggPiAxID8gcGFydHMuc2xpY2UoMCwgLTEpLmpvaW4oJ18nKSA6ICcnO1xuXG4gICAgICAgIGVudlZhbHVlID0gZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudlZhck5hbWUsIHNjb3BlKTtcbiAgICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGBSZXNvbHZlZCBmdzI0IGVudmlyb25tZW50IHZhcmlhYmxlOiAke3ZhbHVlfSAtPiAke2VudlZhbHVlfWAsIGlkKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXI/LmRlYnVnKGA6U0VUIGVudmlyb25tZW50IHZhcmlhYmxlIFske2VudktleX0gOiAke2VudlZhbHVlfV1gLCBpZCk7XG5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGVudktleSxcbiAgICAgICAgdmFsdWU6IGVudlZhbHVlXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBBZGQgZ2xvYmFsIGVudmlyb25tZW50IHZhcmlhYmxlcyB0byB0aGUgZnVuY3Rpb25cbiAgICBmdzI0LmdldEdsb2JhbEVudmlyb25tZW50VmFyaWFibGVzKCkuZm9yRWFjaChlbnZLZXkgPT4ge1xuICAgICAgdGhpcy5sb2dnZXI/LmluZm8oYEFkZGluZyBnbG9iYWwgZW52aXJvbm1lbnQgdmFyaWFibGU6ICR7ZW52S2V5fWAsIGlkKTtcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGVudktleSxcbiAgICAgICAgdmFsdWU6IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZLZXkpXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEF0dGFjaCBwb2xpY2llcyB0byB0aGUgZnVuY3Rpb25cbiAgICAocHJvcHMucG9saWNpZXMgPz8gW10pLmZvckVhY2gocG9saWN5ID0+IHtcblxuICAgICAgaWYgKGlzSW1wb3J0ZWRQb2xpY3kocG9saWN5KSkge1xuXG4gICAgICAgIGlmICghcG9saWN5LmlzT3B0aW9uYWwgJiYgIWZ3MjQuaGFzUG9saWN5KHBvbGljeS5uYW1lLCBwb2xpY3kucHJlZml4KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUG9saWN5ICR7cG9saWN5fSBub3QgZm91bmQgaW4gZncyNCBzY29wZWApO1xuICAgICAgICB9XG5cbiAgICAgICAgcG9saWN5ID0gZncyNC5nZXRQb2xpY3kocG9saWN5Lm5hbWUsIHBvbGljeS5wcmVmaXgpIGFzIFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50O1xuICAgICAgfVxuXG4gICAgICBpZiAoIShwb2xpY3kgaW5zdGFuY2VvZiBQb2xpY3lTdGF0ZW1lbnQpKSB7XG4gICAgICAgIHBvbGljeSA9IG5ldyBQb2xpY3lTdGF0ZW1lbnQocG9saWN5KTtcbiAgICAgIH1cblxuICAgICAgZm4uYWRkVG9Sb2xlUG9saWN5KHBvbGljeSBhcyBQb2xpY3lTdGF0ZW1lbnQpO1xuXG4gICAgfSk7XG5cbiAgICAvLyBJZiB3ZSBhcmUgdXNpbmcgU0VTLCB0aGVuIHdlIG5lZWQgdG8gYWRkIHRoZSBlbWFpbCBxdWV1ZSB1cmwgdG8gdGhlIGVudmlyb25tZW50XG4gICAgaWYgKHByb3BzLmFsbG93U2VuZEVtYWlsICYmIGZ3MjQuZW1haWxQcm92aWRlciBpbnN0YW5jZW9mIE1haWxlckNvbnN0cnVjdCkge1xuICAgICAgY29uc3QgZW1haWxRdWV1ZU5hbWUgPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ2VtYWlsUXVldWVfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpO1xuICAgICAgY29uc3QgZW1haWxRdWV1ZSA9IFF1ZXVlLmZyb21RdWV1ZUFybih0aGlzLCBgJHtpZH0tJHtlbWFpbFF1ZXVlTmFtZX0tcXVldWVgLCBmdzI0LmdldEFybignc3FzJywgZW1haWxRdWV1ZU5hbWUpKTtcblxuICAgICAgZW1haWxRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhmbik7XG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgRU1BSUxfUVVFVUVfVVJMYCxcbiAgICAgICAgdmFsdWU6IGVtYWlsUXVldWUucXVldWVVcmxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIExvZ2ljIGZvciBhZGRpbmcgRHluYW1vREIgdGFibGUgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgcHJvcHMucmVzb3VyY2VBY2Nlc3M/LnRhYmxlcz8uZm9yRWFjaCgodGFibGU6IGFueSkgPT4ge1xuICAgICAgbGV0IHRhYmxlTmFtZSA9IHR5cGVvZiB0YWJsZSA9PT0gJ3N0cmluZycgPyB0YWJsZSA6IHRhYmxlLm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIHRhYmxlTmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHRhYmxlTmFtZSk7XG5cbiAgICAgIGNvbnN0IGFwcFF1YWxpZmllZFRhYmxlTmFtZSA9IGVuc3VyZU5vU3BlY2lhbENoYXJzKGVuc3VyZVN1ZmZpeCh0YWJsZU5hbWUsIGB0YWJsZWApKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHRhYmxlID09PSAnc3RyaW5nJyA/IFsgJ3JlYWR3cml0ZScgXSA6IHRhYmxlLmFjY2VzcyB8fCBbICdyZWFkd3JpdGUnIF07XG4gICAgICAvLyBHZXQgdGhlIER5bmFtb0RCIHRhYmxlIGJhc2VkIG9uIHRoZSBjb250cm9sbGVyIGNvbmZpZ1xuICAgICAgY29uc3QgdGFibGVJbnN0YW5jZTogSVRhYmxlVjIgPSBUYWJsZVYyLmZyb21UYWJsZUF0dHJpYnV0ZXModGhpcywgYCR7aWR9LSR7dGFibGVOYW1lfS10YWJsZS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gLCB7XG4gICAgICAgIHRhYmxlTmFtZTogZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGFwcFF1YWxpZmllZFRhYmxlTmFtZSArICdfdGFibGVOYW1lJywgJ3RhYmxlJywgc2NvcGUpLFxuICAgICAgICBncmFudEluZGV4UGVybWlzc2lvbnM6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIHRoZSB0YWJsZSBuYW1lIHRvIHRoZSBsYW1iZGEgZW52aXJvbm1lbnQgICAgICBcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke2FwcFF1YWxpZmllZFRhYmxlTmFtZX1gLFxuICAgICAgICB2YWx1ZTogdGFibGVJbnN0YW5jZS50YWJsZU5hbWVcbiAgICAgIH0pO1xuXG4gICAgICAvLyBHcmFudCB0aGUgbGFtYmRhIGZ1bmN0aW9uIHJlYWQgd3JpdGUgYWNjZXNzIHRvIHRoZSB0YWJsZVxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWFkJzpcbiAgICAgICAgICAgIHRhYmxlSW5zdGFuY2UuZ3JhbnRSZWFkRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd3cml0ZSc6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50V3JpdGVEYXRhKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50UmVhZFdyaXRlRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIFMzIGJ1Y2tldCBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8uYnVja2V0cz8uZm9yRWFjaCgoYnVja2V0OiBhbnkpID0+IHtcbiAgICAgIGxldCBidWNrZXROYW1lID0gdHlwZW9mIGJ1Y2tldCA9PT0gJ3N0cmluZycgPyBidWNrZXQgOiBidWNrZXQubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgYnVja2V0TmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKGJ1Y2tldE5hbWUpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgYnVja2V0ID09PSAnc3RyaW5nJyA/IFsgJ3JlYWR3cml0ZScgXSA6IGJ1Y2tldC5hY2Nlc3MgfHwgWyAncmVhZHdyaXRlJyBdO1xuXG4gICAgICBjb25zdCBidWNrZXRGdWxsTmFtZSA9IGZ3MjQuZ2V0VW5pcXVlTmFtZShidWNrZXROYW1lKTtcbiAgICAgIGNvbnN0IGJ1Y2tldEluc3RhbmNlOiBhbnkgPSBCdWNrZXQuZnJvbUJ1Y2tldE5hbWUodGhpcywgYCR7YnVja2V0TmFtZX0tJHtpZH0tYnVja2V0LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWAsIGJ1Y2tldEZ1bGxOYW1lKTtcbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gYWNjZXNzIHRvIHRoZSBidWNrZXRcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVhZCc6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFJlYWQoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnd3JpdGUnOlxuICAgICAgICAgICAgYnVja2V0SW5zdGFuY2UuZ3JhbnRXcml0ZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgYnVja2V0SW5zdGFuY2UuZ3JhbnRSZWFkV3JpdGUoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSBidWNrZXQgbmFtZVxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYGJ1Y2tldF8ke2J1Y2tldE5hbWV9YCxcbiAgICAgICAgdmFsdWU6IGJ1Y2tldEZ1bGxOYW1lXG4gICAgICB9KTtcblxuICAgIH0pO1xuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBTUVMgcXVldWUgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgcHJvcHMucmVzb3VyY2VBY2Nlc3M/LnF1ZXVlcz8uZm9yRWFjaCgocXVldWU6IGFueSkgPT4ge1xuICAgICAgbGV0IHF1ZXVlTmFtZSA9IHR5cGVvZiBxdWV1ZSA9PT0gJ3N0cmluZycgPyBxdWV1ZSA6IHF1ZXVlLm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIHF1ZXVlTmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHF1ZXVlTmFtZSk7XG5cbiAgICAgIGNvbnN0IGFjY2VzcyA9IHR5cGVvZiBxdWV1ZSA9PT0gJ3N0cmluZycgPyBbICdzZW5kJyBdIDogcXVldWUuYWNjZXNzIHx8IFsgJ3NlbmQnIF07XG5cbiAgICAgIGNvbnN0IHF1ZXVlQXJuID0gZncyNC5nZXRBcm4oJ3NxcycsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShxdWV1ZU5hbWUgKyAnX3F1ZXVlTmFtZScsICdxdWV1ZScsIHNjb3BlKSk7XG4gICAgICBjb25zdCBxdWV1ZUluc3RhbmNlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMsIHF1ZXVlTmFtZSArIGlkICsgJy1xdWV1ZScsIHF1ZXVlQXJuKTtcbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gYWNjZXNzIHRvIHRoZSBxdWV1ZVxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWNlaXZlJzpcbiAgICAgICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRDb25zdW1lTWVzc2FnZXMoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgICAgIHF1ZXVlSW5zdGFuY2UuZ3JhbnRQdXJnZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFNlbmRNZXNzYWdlcyhmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIHF1ZXVlIHVybFxuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogYCR7cXVldWVOYW1lfV9xdWV1ZVVybGAsXG4gICAgICAgIHZhbHVlOiBxdWV1ZUluc3RhbmNlLnF1ZXVlVXJsXG4gICAgICB9KVxuICAgIH0pO1xuXG4gICAgLy8gQWRkIFNOUyB0b3BpYyBwZXJtaXNzaW9uXG4gICAgcHJvcHMucmVzb3VyY2VBY2Nlc3M/LnRvcGljcz8uZm9yRWFjaCgodG9waWM6IGFueSkgPT4ge1xuICAgICAgbGV0IHRvcGljTmFtZSA9IHR5cGVvZiB0b3BpYyA9PT0gJ3N0cmluZycgPyB0b3BpYyA6IHRvcGljLm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIHRvcGljTmFtZSA9IGZ3MjQudHJ5UmVzb2x2ZUVudktleVRlbXBsYXRlKHRvcGljTmFtZSk7XG5cbiAgICAgIGNvbnN0IGFjY2VzcyA9IHR5cGVvZiB0b3BpYyA9PT0gJ3N0cmluZycgPyBbICdwdWJsaXNoJyBdIDogdG9waWMuYWNjZXNzIHx8IFsgJ3B1Ymxpc2gnIF07XG5cbiAgICAgIGNvbnN0IHRvcGljQXJuID0gZncyNC5nZXRBcm4oJ3NucycsIGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSh0b3BpY05hbWUgKyAnX3RvcGljTmFtZScsICd0b3BpYycsIHNjb3BlKSk7XG4gICAgICBjb25zdCB0b3BpY0luc3RhbmNlID0gVG9waWMuZnJvbVRvcGljQXJuKHRoaXMsIHRvcGljTmFtZSArIGlkICsgJy10b3BpYycsIHRvcGljQXJuKTtcbiAgICAgIC8vIEdyYW50IHRoZSBsYW1iZGEgZnVuY3Rpb24gYWNjZXNzIHRvIHRoZSB0b3BpY1xuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdG9waWNJbnN0YW5jZS5ncmFudFB1Ymxpc2goZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgdG9waWMgYXJuXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHt0b3BpY05hbWV9X3RvcGljQXJuYCxcbiAgICAgICAgdmFsdWU6IHRvcGljSW5zdGFuY2UudG9waWNBcm5cbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICByZXR1cm4gZm47XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKG9wdGlvbnM6IHtcbiAgZm46IE5vZGVqc0Z1bmN0aW9uLFxuICBrZXk6IHN0cmluZyxcbiAgdmFsdWU6IHN0cmluZyxcbiAgcHJlZml4Pzogc3RyaW5nLFxuICBzdWZmaXg/OiBzdHJpbmcsXG59KSB7XG5cbiAgY29uc3QgeyBmbiwga2V5LCB2YWx1ZSwgcHJlZml4ID0gJycsIHN1ZmZpeCA9ICcnIH0gPSBvcHRpb25zO1xuXG4gIGNvbnN0IGVudktleSA9IGVuc3VyZVZhbGlkRW52S2V5KGtleSwgcHJlZml4LCBzdWZmaXgpO1xuICBmbi5hZGRFbnZpcm9ubWVudChlbnZLZXksIHZhbHVlKTtcbn1cbiJdfQ==