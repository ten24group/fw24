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
        props.resourceAccess?.buckets?.forEach((bucket) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWlCQSw0Q0FFQztBQTRKRCx3Q0FnQkM7QUEvTEQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsbURBQStEO0FBQy9ELHdDQUFzRjtBQUl0RixTQUFnQixnQkFBZ0IsQ0FBQyxNQUFpRDtJQUNoRixPQUFRLE1BQTBCLENBQUMsSUFBSSxLQUFLLFNBQVMsQ0FBQztBQUN4RCxDQUFDO0FBMkdEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStDRztBQUVILFNBQWdCLGNBQWMsQ0FBQyxRQUFpQjtJQUM5QyxRQUFRLFFBQVEsRUFBRSxXQUFXLEVBQUUsRUFBRSxDQUFDO1FBQ2hDLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssTUFBTTtZQUNULE9BQU8sZ0NBQW1CLENBQUMsSUFBSSxDQUFDO1FBQ2xDLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssTUFBTSxDQUFDO1FBQ1o7WUFDRSxPQUFPLGdDQUFtQixDQUFDLElBQUksQ0FBQTtJQUNuQyxDQUFDO0FBQ0gsQ0FBQztBQUVELE1BQWEsY0FBZSxTQUFRLHNCQUFT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QUFHLGVBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLFNBQVMsR0FBRyxFQUFFLEdBQUcsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBQ3BGLGdEQUFnRDtZQUNoRCxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsVUFBa0IsRUFBRSxFQUFFO2dCQUNwQyxRQUFRLFVBQVUsRUFBRSxDQUFDO29CQUNuQjt3QkFDRSxhQUFhLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUMvQixNQUFNO2dCQUNWLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQztZQUNILDZDQUE2QztZQUM3QyxpQ0FBaUMsQ0FBQztnQkFDaEMsRUFBRTtnQkFDRixHQUFHLEVBQUUsR0FBRyxTQUFTLFdBQVc7Z0JBQzVCLEtBQUssRUFBRSxhQUFhLENBQUMsUUFBUTthQUM5QixDQUFDLENBQUE7UUFDSixDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztDQUNGO0FBelVELHdDQXlVQztBQUVELFNBQVMsaUNBQWlDLENBQUMsT0FNMUM7SUFFQyxNQUFNLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsTUFBTSxHQUFHLEVBQUUsRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFFLEdBQUcsT0FBTyxDQUFDO0lBRTdELE1BQU0sTUFBTSxHQUFHLElBQUEsd0JBQWlCLEVBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN0RCxFQUFFLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztBQUNuQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IER1cmF0aW9uLCBSZW1vdmFsUG9saWN5IH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIHR5cGUgUG9saWN5U3RhdGVtZW50UHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgUnVudGltZSwgQXJjaGl0ZWN0dXJlLCBMYXllclZlcnNpb24sIEFwcGxpY2F0aW9uTG9nTGV2ZWwsIExvZ2dpbmdGb3JtYXQsIElMYXllclZlcnNpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgSVRhYmxlVjIsIFRhYmxlVjIgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEJ1Y2tldCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtczNcIjtcbmltcG9ydCB7IE1haWxlckNvbnN0cnVjdCB9IGZyb20gXCIuL21haWxlclwiO1xuaW1wb3J0IHsgUXVldWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgVG9waWMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNuc1wiO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyLCBJTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IExvZ0dyb3VwLCBSZXRlbnRpb25EYXlzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sb2dzXCI7XG5pbXBvcnQgeyBlbnN1cmVOb1NwZWNpYWxDaGFycywgZW5zdXJlU3VmZml4LCBlbnN1cmVWYWxpZEVudktleSB9IGZyb20gXCIuLi91dGlscy9rZXlzXCI7XG5leHBvcnQgdHlwZSBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyA9IFBvbGljeVN0YXRlbWVudCB8IFBvbGljeVN0YXRlbWVudFByb3BzO1xuZXhwb3J0IHR5cGUgVEltcG9ydGVkUG9saWN5ID0geyBuYW1lOiBzdHJpbmcsIGlzT3B0aW9uYWw/OiBib29sZWFuLCBwcmVmaXg/OiBzdHJpbmcgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGlzSW1wb3J0ZWRQb2xpY3kocG9saWN5OiBUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeSk6IHBvbGljeSBpcyBUSW1wb3J0ZWRQb2xpY3kge1xuICByZXR1cm4gKHBvbGljeSBhcyBUSW1wb3J0ZWRQb2xpY3kpLm5hbWUgIT09IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBwcm9wZXJ0aWVzIGZvciBhIExhbWJkYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFGdW5jdGlvblByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBlbnRyeSBwb2ludCBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGVudHJ5OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBwb2xpY2llcyB0byBhdHRhY2ggdG8gdGhlIExhbWJkYSBmdW5jdGlvbidzIGV4ZWN1dGlvbiByb2xlLlxuICAgKi9cbiAgcG9saWNpZXM/OiBBcnJheTxUUG9saWN5U3RhdGVtZW50T3JQcm9wcyB8IFRJbXBvcnRlZFBvbGljeT47XG5cbiAgLyoqXG4gICAqIFRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gc2V0IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZW52aXJvbm1lbnRWYXJpYWJsZXM/OiB7IFsga2V5OiBzdHJpbmcgXTogc3RyaW5nIH07XG5cbiAgLyoqXG4gICAqIFRoZSByZXNvdXJjZSBhY2Nlc3MgY29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIHJlc291cmNlQWNjZXNzPzogSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIEluZGljYXRlcyB3aGV0aGVyIHRoZSBMYW1iZGEgZnVuY3Rpb24gaXMgYWxsb3dlZCB0byBzZW5kIGVtYWlscy5cbiAgICovXG4gIGFsbG93U2VuZEVtYWlsPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBkYXlzIHRvIHJldGFpbiB0aGUgbG9ncyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGxvZ1JldGVudGlvbkRheXM/OiBSZXRlbnRpb25EYXlzO1xuXG4gIC8qKlxuICAgKiBUaGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24ncyBsb2dzLlxuICAgKi9cbiAgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgLyoqXG4gICAqIFRoZSB0aW1lb3V0IGR1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGluIHNlY29uZHMuXG4gICAqIFVzZSB0aGlzIHRpbWVvdXQgdG8gYXZvaWQgaW1wb3J0aW5nIHRoZSBkdXJhdGlvbiBjbGFzcyBmcm9tIGF3cy1jZGstbGliLlxuICAgKi9cbiAgZnVuY3Rpb25UaW1lb3V0PzogbnVtYmVyO1xuXG4gIHByb2Nlc3NvckFyY2hpdGVjdHVyZT86ICd4ODZfNjQnIHwgJ2FybV82NCc7XG5cbiAgLyoqXG4gICAqIEFkZGl0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZnVuY3Rpb25Qcm9wcz86IE9taXQ8Tm9kZWpzRnVuY3Rpb25Qcm9wcywgJ2xheWVycyc+ICYge1xuICAgIHJlYWRvbmx5IGxheWVycz86IEFycmF5PElMYXllclZlcnNpb24gfCBzdHJpbmc+O1xuICB9XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgYWNjZXNzIHBlcm1pc3Npb25zIGZvciB2YXJpb3VzIHJlc291cmNlcyB0aGF0IGNhbiBiZSBhY2Nlc3NlZCBieSBhIGZ1bmN0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElGdW5jdGlvblJlc291cmNlQWNjZXNzIHtcbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgdGFibGVzLlxuICAgKiBFYWNoIHRhYmxlIGNhbiBoYXZlIGEgbmFtZSBhbmQgYW4gb3B0aW9uYWwgYXJyYXkgb2YgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncmVhZCcsICd3cml0ZScsIG9yICdyZWFkd3JpdGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3JlYWR3cml0ZScuXG4gICAqL1xuICB0YWJsZXM/OiBBcnJheTx7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGFjY2Vzcz86IHN0cmluZ1tdO1xuICB9PiB8IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIGJ1Y2tldHMuXG4gICAqIEVhY2ggYnVja2V0IGNhbiBoYXZlIGEgbmFtZSBhbmQgYW4gb3B0aW9uYWwgYXJyYXkgb2YgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAncmVhZCcsICd3cml0ZScsIG9yICdyZWFkd3JpdGUnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3JlYWR3cml0ZScuXG4gICAqL1xuICBidWNrZXRzPzogQXJyYXk8e1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhY2Nlc3M/OiBzdHJpbmdbXTtcbiAgfT4gfCBzdHJpbmdbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciB0b3BpY3MuXG4gICAqIEVhY2ggdG9waWMgY2FuIGhhdmUgYSBuYW1lIGFuZCBhbiBvcHRpb25hbCBhcnJheSBvZiBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdwdWJsaXNoJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdwdWJsaXNoJy5cbiAgICovXG4gIHRvcGljcz86IEFycmF5PHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgYWNjZXNzPzogc3RyaW5nW107XG4gIH0+IHwgc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgcXVldWVzLlxuICAgKiBFYWNoIHF1ZXVlIGNhbiBoYXZlIGEgbmFtZSBhbmQgYW4gb3B0aW9uYWwgYXJyYXkgb2YgYWNjZXNzIHBlcm1pc3Npb25zLlxuICAgKiBUaGUgYWNjZXNzIHBlcm1pc3Npb25zIGNhbiBiZSAnc2VuZCcsICdyZWNlaXZlJywgb3IgJ2RlbGV0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAnc2VuZCcuXG4gICAqL1xuICBxdWV1ZXM/OiBBcnJheTx7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGFjY2Vzcz86IHN0cmluZ1tdO1xuICB9PiB8IHN0cmluZ1tdO1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhIExhbWJkYSBmdW5jdGlvbiBjb25zdHJ1Y3QuXG4gKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBDcmVhdGUgYSBMYW1iZGEgZnVuY3Rpb24gd2l0aCBjdXN0b20gcHJvcGVydGllc1xuICogY29uc3QgbGFtYmRhUHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHMgPSB7XG4gKiAgIGVudHJ5OiBcImluZGV4LmpzXCIsXG4gKiAgIHBvbGljaWVzOiBbe1xuICogICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAqICAgICAgICAgYWN0aW9uczogW1xuICogICAgICAgICAgXCJzMzpHZXRPYmplY3RcIlxuICogICAgICAgICBdLFxuICogICAgICAgICByZXNvdXJjZXM6IFtcImFybjphd3M6czM6OjpteS1idWNrZXQvKlwiXSxcbiAqICAgICB9LCBcbiAqICAgICB7XG4gKiAgICAgICBwb2xpY3k6IFwiYXV0aE1vZHVsZTpjcmVhdGUtdXNlci1hdXRoLXJlY29yZFwiLFxuICogICAgICAgaXNPcHRpb25hbDogdHJ1ZVxuICogICAgIH1cbiAqICAgXSxcbiAqICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAqICAgICBNWV9FTlZfVkFSOiBcIm15LXZhbHVlXCIsXG4gKiAgIH0sXG4gKiAgIHJlc291cmNlQWNjZXNzOiB7XG4gKiAgICAgdGFibGVzOiBbXG4gKiAgICAgICB7XG4gKiAgICAgICAgIG5hbWU6IFwibXktdGFibGVcIixcbiAqICAgICAgICAgYWNjZXNzOiBbXCJyZWFkXCIsIFwid3JpdGVcIl0sXG4gKiAgICAgICB9LFxuICogICAgIF0sXG4gKiAgICAgYnVja2V0czogW1wibXktYnVja2V0XCJdLFxuICogICAgIHRvcGljczogW1wibXktdG9waWNcIl0sXG4gKiAgICAgcXVldWVzOiBbXCJteS1xdWV1ZVwiXSxcbiAqICAgfSxcbiAqICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gKiAgIGxvZ1JldGVudGlvbkRheXM6IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gKiAgIGxvZ1JlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAqICAgZnVuY3Rpb25UaW1lb3V0OiAxMCxcbiAqICAgZnVuY3Rpb25Qcm9wczoge1xuICogICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gKiAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICogICB9LFxuICogfTtcbiAqXG4gKiBjb25zdCBsYW1iZGFGdW5jdGlvbiA9IG5ldyBMYW1iZGFGdW5jdGlvbihzdGFjaywgXCJNeUxhbWJkYUZ1bmN0aW9uXCIsIGxhbWJkYVByb3BzKTtcbiAqIFxuICogYGBgXG4gKi9cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdExvZ0xldmVsKGxvZ0xldmVsPzogc3RyaW5nKSB7XG4gIHN3aXRjaCAobG9nTGV2ZWw/LnRvVXBwZXJDYXNlKCkpIHtcbiAgICBjYXNlICdFUlJPUic6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5FUlJPUjtcbiAgICBjYXNlICdXQVJOJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLldBUk47XG4gICAgY2FzZSAnREVCVUcnOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuREVCVUc7XG4gICAgY2FzZSAnVFJBQ0UnOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuVFJBQ0U7XG4gICAgY2FzZSAnRkFUQUwnOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuRkFUQUw7XG4gICAgY2FzZSAnSU5GTyc6XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLklORk9cbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgTGFtYmRhRnVuY3Rpb24gZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuXG4gIHJlYWRvbmx5IGxvZ2dlcj86IElMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0xhbWJkYUZ1bmN0aW9uJyk7XG5cbiAgLyoqXG4gICAqIENvbnN0cnVjdHMgYSBuZXcgaW5zdGFuY2Ugb2YgdGhlIExhbWJkYUZ1bmN0aW9uIGNsYXNzLlxuICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgcGFyZW50IGNvbnN0cnVjdC5cbiAgICogQHBhcmFtIGlkIC0gVGhlIElEIG9mIHRoZSBjb25zdHJ1Y3QuXG4gICAqIEBwYXJhbSBwcm9wcyAtIFRoZSBMYW1iZGEgZnVuY3Rpb24gcHJvcGVydGllcy5cbiAgICogQHJldHVybnMgVGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMYW1iZGFGdW5jdGlvblByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICAvLyBEZWZhdWx0IHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIGZ1bmN0aW9uXG4gICAgbGV0IGRlZmF1bHRQcm9wczogTm9kZWpzRnVuY3Rpb25Qcm9wcyA9IHtcbiAgICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZS5BUk1fNjQsXG4gICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICBtZW1vcnlTaXplOiAxMjgsXG4gICAgICBsb2dnaW5nRm9ybWF0OiBwcm9jZXNzLmVudi5MT0dfRk9STUFUPy50b0xvd2VyQ2FzZT8uKCkgPT09ICdqc29uJyA/IExvZ2dpbmdGb3JtYXQuSlNPTiA6IExvZ2dpbmdGb3JtYXQuVEVYVCxcbiAgICAgIC4uLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25Qcm9wcyBhcyBOb2RlanNGdW5jdGlvblByb3BzLFxuICAgIH07XG5cbiAgICAvLyAgJ0Vycm9yJyAgVG8gdXNlIEFwcGxpY2F0aW9uTG9nTGV2ZWwgYW5kL29yIFN5c3RlbUxvZ0xldmVsIHlvdSBtdXN0IHNldCBMb2dnaW5nRm9ybWF0IHRvICdKU09OJywgZ290ICdUZXh0Jy5cbiAgICBpZiAoZGVmYXVsdFByb3BzLmxvZ2dpbmdGb3JtYXQgPT09IExvZ2dpbmdGb3JtYXQuSlNPTikge1xuICAgICAgZGVmYXVsdFByb3BzID0ge1xuICAgICAgICAuLi5kZWZhdWx0UHJvcHMsXG4gICAgICAgIGFwcGxpY2F0aW9uTG9nTGV2ZWxWMjogZm9ybWF0TG9nTGV2ZWwocHJvY2Vzcy5lbnYuTE9HX0xFVkVMKVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgbG9nIGdyb3VwIGlmIG5vdCBwcm92aWRlZFxuICAgIGxldCBsb2dHcm91cCA9IHByb3BzLmZ1bmN0aW9uUHJvcHM/LmxvZ0dyb3VwO1xuICAgIGlmICghbG9nR3JvdXApIHtcbiAgICAgIGxldCBsb2dSZXRlbnRpb25EYXlzID0gcHJvcHMubG9nUmV0ZW50aW9uRGF5cyB8fCBmdzI0LmdldENvbmZpZygpLmxvZ1JldGVudGlvbkRheXMgfHwgMzA7XG4gICAgICBsb2dHcm91cCA9IG5ldyBMb2dHcm91cCh0aGlzLCBgJHtpZH0tTG9nR3JvdXBgLCB7XG4gICAgICAgIHJlbW92YWxQb2xpY3k6IHByb3BzLmxvZ1JlbW92YWxQb2xpY3kgfHwgZncyNC5nZXRDb25maWcoKS5sb2dSZW1vdmFsUG9saWN5IHx8IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICByZXRlbnRpb246IHBhcnNlSW50KGxvZ1JldGVudGlvbkRheXMudG9TdHJpbmcoKSksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBsZXQgYWRkaXRpb25hbFByb3BzOiBhbnkgPSB7XG4gICAgICBlbnRyeTogcHJvcHMuZW50cnksXG4gICAgfVxuXG4gICAgLy8gY29sbGVjdCB0aGUgbmFtZXMgb2YgdGhlIGxheWVycyBwcm92aWRlZCBpbiBkZWZhdWx0IGNvbmZpZyBpZiBhbnkgb3IgZWxzZSB0aGUgZ2xvYmFsIGxheWVycztcbiAgICBjb25zdCBkZWZhdWx0TGF5ZXJzID0gZGVmYXVsdFByb3BzPy5sYXllcnMgPz8gQXJyYXkuZnJvbShmdzI0LmdldEdsb2JhbExhbWJkYUxheWVyTmFtZXMoKSk7XG5cbiAgICAvLyByZXNvbHZlIGxheWVyIG5hbWVzIHRvIGFjdHVhbCBsYXllciBhcm5zXG4gICAgY29uc3QgbGF5ZXJzID0gW1xuICAgICAgLi4uZGVmYXVsdExheWVycyxcbiAgICAgIC8vIGNvbGxlY3QgdGhlIG5hbWVzIG9mIHRoZSBsYXllcnMgcHJvdmlkZWQgaW4gZnVuY3Rpb24gY29uZmlnIGlmIGFueTtcbiAgICAgIC4uLihwcm9wcy5mdW5jdGlvblByb3BzPy5sYXllcnMgPz8gW10pXG4gICAgXSBhcyBBcnJheTxzdHJpbmcgfCBJTGF5ZXJWZXJzaW9uPjtcblxuICAgIC8vIHJlbW92ZSBkdXBsaWNhdGVzXG4gICAgY29uc3QgZGVEdXBMYXllcnMgPSBBcnJheS5mcm9tKG5ldyBTZXQobGF5ZXJzKSk7XG5cbiAgICAvLyBFbnN1cmUgZncyNCBsYXllciBpcyBpbmNsdWRlZCAoaWYgbm90IGFscmVhZHkgaW4gdGhlIGxpc3QpXG4gICAgaWYgKCFkZUR1cExheWVycy5pbmNsdWRlcygnZncyNCcpKSB7XG4gICAgICBkZUR1cExheWVycy5wdXNoKCdmdzI0Jyk7XG4gICAgfVxuXG4gICAgLy8gbWFwIGxheWVycyB0byBhY3R1YWwgbGF5ZXIgb2JqZWN0c1xuICAgIGNvbnN0IHJlc29sdmVkTGF5ZXJzID0gZGVEdXBMYXllcnMubWFwKGxheWVyTmFtZSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGxheWVyTmFtZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIExheWVyVmVyc2lvbi5mcm9tTGF5ZXJWZXJzaW9uQXJuKHRoaXMsIGAke2lkfS0ke2xheWVyTmFtZX0tTGF5ZXJgLCBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUobGF5ZXJOYW1lICsgJ19sYXllclZlcnNpb25Bcm4nLCAnbGF5ZXInLCBzY29wZSkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbGF5ZXJOYW1lO1xuICAgIH0pXG5cbiAgICBhZGRpdGlvbmFsUHJvcHMubGF5ZXJzID0gcmVzb2x2ZWRMYXllcnM7XG5cbiAgICBhZGRpdGlvbmFsUHJvcHMuYnVuZGxpbmcgPSB7XG4gICAgICAuLi5kZWZhdWx0UHJvcHMuYnVuZGxpbmcsXG4gICAgICAuLi5wcm9wcy5mdW5jdGlvblByb3BzPy5idW5kbGluZyxcbiAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAuLi4oZGVmYXVsdFByb3BzPy5idW5kbGluZz8uZXh0ZXJuYWxNb2R1bGVzID8/IFtdKSxcbiAgICAgICAgLi4uKHByb3BzLmZ1bmN0aW9uUHJvcHM/LmJ1bmRsaW5nPy5leHRlcm5hbE1vZHVsZXMgPz8gW10pLFxuICAgICAgICBcIkB0ZW4yNGdyb3VwL2Z3MjRcIlxuICAgICAgXSxcbiAgICB9O1xuICAgIGFkZGl0aW9uYWxQcm9wcy5sb2dHcm91cCA9IGxvZ0dyb3VwO1xuICAgIGlmIChwcm9wcy5mdW5jdGlvblRpbWVvdXQpIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wcy50aW1lb3V0ID0gRHVyYXRpb24uc2Vjb25kcyhwcm9wcy5mdW5jdGlvblRpbWVvdXQpO1xuICAgIH1cblxuICAgIGlmIChwcm9wcy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUpIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wcy5hcmNoaXRlY3R1cmUgPSBwcm9wcy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUgPT09ICd4ODZfNjQnID8gQXJjaGl0ZWN0dXJlLlg4Nl82NCA6IEFyY2hpdGVjdHVyZS5BUk1fNjQ7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHRoZSBOb2RlLmpzIGZ1bmN0aW9uXG4gICAgY29uc3QgZm4gPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgaWQsIHtcbiAgICAgIC4uLmRlZmF1bHRQcm9wcyxcbiAgICAgIC4uLnByb3BzLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAuLi5hZGRpdGlvbmFsUHJvcHMsXG4gICAgfSk7XG5cbiAgICBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcyA9IHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzID8/IHt9O1xuXG4gICAgLy8gKiBFWFBPUlQgdGhlIGxvZy1sZXZlbCBmb3Igb3VyIGxvZ2dlci1pbnN0YW5jZXMgaW4gdGhlIHJ1bnRpbWUgb2YgdGhpcyBsYW1iZGFcbiAgICAvLyBTZWUgJy4uL2xvZ2dpbmcvaW5kZXgudHMnIGZvciBtb3JlIGluZm9cbiAgICAvLyBOT1RFOiB0aGlzIGxvZy1sZXZlbCBpcyBkaWZmZXJlbnQgdGhhbiB0aGUgYXdzLWxvZy1sZXZlbFxuICAgIC8vIGF3cyByZXF1aXJlcyB0aGUgbG9nIGZvcm1hdCBzZXQgdG8gSlNPTiB0byBvdmVycmlkZSBsb2ctbGV2ZWwgc2VlIGBhcHBsaWNhdGlvbkxvZ0xldmVsVjJgIGluIHRoZSBjb2RlIGFib3ZlXG5cbiAgICAvLyBlbnN1cmUgdGhlIGVudmlyb25tZW50LXZhcmlhYmxlcyBmb3IgdGhlIGxhbWJkYSBhbHdheXMgaGF2ZSBhIGxvZy1sZXZlbFxuICAgIGlmICghKCdMT0dfTEVWRUwnIGluIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKSkge1xuICAgICAgcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXNbICdMT0dfTEVWRUwnIF0gPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpO1xuICAgIH1cblxuICAgIC8vIFNldCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKSkge1xuICAgICAgbGV0IGVudlZhbHVlID0gdmFsdWU7XG4gICAgICBsZXQgZW52S2V5ID0ga2V5O1xuICAgICAgLy8gSWYga2V5IGlzIHByZWZpeGVkIHdpdGggZncyNF8sIGFjY2VzcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBmdzI0IHNjb3BlXG4gICAgICAvLyBrZXlzIGNhbiBoYXZlIHNoYXBlIGxpa2U6XG4gICAgICAvLyBmdzI0X3h4eCAod2l0aG91dCBzY29wZSlcbiAgICAgIC8vIGZ3MjRfQXV0aE1vZHVsZV94eHggKHdpdGggc2NvcGU6IEF1dGhNb2R1bGUpXG4gICAgICAvLyBmdzI0X1VzZXJQb29sX0F1dGhNb2R1bGVfdXNlclBvb2xJZCAod2l0aCBzY29wZTogVXNlclBvb2xfQXV0aE1vZHVsZSlcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5zdGFydHNXaXRoKCdmdzI0XycpKSB7XG4gICAgICAgIC8vIFJlbW92ZSBmdzI0XyBwcmVmaXhcbiAgICAgICAgY29uc3Qga2V5V2l0aG91dFByZWZpeCA9IHZhbHVlLnJlcGxhY2UoJ2Z3MjRfJywgJycpO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IGtleVdpdGhvdXRQcmVmaXguc3BsaXQoJ18nKTtcblxuICAgICAgICAvLyBMYXN0IHBhcnQgaXMgYWx3YXlzIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBuYW1lXG4gICAgICAgIGNvbnN0IGVudlZhck5hbWUgPSBwYXJ0c1sgcGFydHMubGVuZ3RoIC0gMSBdO1xuXG4gICAgICAgIC8vIEV2ZXJ5dGhpbmcgYmVmb3JlIHRoZSBsYXN0IHBhcnQgaXMgdGhlIHNjb3BlIChpZiBhbnkpXG4gICAgICAgIGNvbnN0IHNjb3BlID0gcGFydHMubGVuZ3RoID4gMSA/IHBhcnRzLnNsaWNlKDAsIC0xKS5qb2luKCdfJykgOiAnJztcblxuICAgICAgICBlbnZWYWx1ZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZWYXJOYW1lLCBzY29wZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgUmVzb2x2ZWQgZncyNCBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHt2YWx1ZX0gLT4gJHtlbnZWYWx1ZX1gLCBpZCk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgOlNFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBbJHtlbnZLZXl9IDogJHtlbnZWYWx1ZX1dYCwgaWQpO1xuXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBlbnZLZXksXG4gICAgICAgIHZhbHVlOiBlbnZWYWx1ZVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQWRkIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gdGhlIGZ1bmN0aW9uXG4gICAgZncyNC5nZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpLmZvckVhY2goZW52S2V5ID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgQWRkaW5nIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHtlbnZLZXl9YCwgaWQpO1xuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogZW52S2V5LFxuICAgICAgICB2YWx1ZTogZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudktleSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQXR0YWNoIHBvbGljaWVzIHRvIHRoZSBmdW5jdGlvblxuICAgIChwcm9wcy5wb2xpY2llcyA/PyBbXSkuZm9yRWFjaChwb2xpY3kgPT4ge1xuXG4gICAgICBpZiAoaXNJbXBvcnRlZFBvbGljeShwb2xpY3kpKSB7XG5cbiAgICAgICAgaWYgKCFwb2xpY3kuaXNPcHRpb25hbCAmJiAhZncyNC5oYXNQb2xpY3kocG9saWN5Lm5hbWUsIHBvbGljeS5wcmVmaXgpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQb2xpY3kgJHtwb2xpY3l9IG5vdCBmb3VuZCBpbiBmdzI0IHNjb3BlYCk7XG4gICAgICAgIH1cblxuICAgICAgICBwb2xpY3kgPSBmdzI0LmdldFBvbGljeShwb2xpY3kubmFtZSwgcG9saWN5LnByZWZpeCkgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghKHBvbGljeSBpbnN0YW5jZW9mIFBvbGljeVN0YXRlbWVudCkpIHtcbiAgICAgICAgcG9saWN5ID0gbmV3IFBvbGljeVN0YXRlbWVudChwb2xpY3kpO1xuICAgICAgfVxuXG4gICAgICBmbi5hZGRUb1JvbGVQb2xpY3kocG9saWN5IGFzIFBvbGljeVN0YXRlbWVudCk7XG5cbiAgICB9KTtcblxuICAgIC8vIElmIHdlIGFyZSB1c2luZyBTRVMsIHRoZW4gd2UgbmVlZCB0byBhZGQgdGhlIGVtYWlsIHF1ZXVlIHVybCB0byB0aGUgZW52aXJvbm1lbnRcbiAgICBpZiAocHJvcHMuYWxsb3dTZW5kRW1haWwgJiYgZncyNC5lbWFpbFByb3ZpZGVyIGluc3RhbmNlb2YgTWFpbGVyQ29uc3RydWN0KSB7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlTmFtZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZW1haWxRdWV1ZV9xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSk7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMsIGAke2lkfS0ke2VtYWlsUXVldWVOYW1lfS1xdWV1ZWAsIGZ3MjQuZ2V0QXJuKCdzcXMnLCBlbWFpbFF1ZXVlTmFtZSkpO1xuXG4gICAgICBlbWFpbFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGBFTUFJTF9RVUVVRV9VUkxgLFxuICAgICAgICB2YWx1ZTogZW1haWxRdWV1ZS5xdWV1ZVVybFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBEeW5hbW9EQiB0YWJsZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8udGFibGVzPy5mb3JFYWNoKCh0YWJsZTogYW55KSA9PiB7XG4gICAgICBsZXQgdGFibGVOYW1lID0gdHlwZW9mIHRhYmxlID09PSAnc3RyaW5nJyA/IHRhYmxlIDogdGFibGUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdGFibGVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodGFibGVOYW1lKTtcblxuICAgICAgY29uc3QgYXBwUXVhbGlmaWVkVGFibGVOYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMoZW5zdXJlU3VmZml4KHRhYmxlTmFtZSwgYHRhYmxlYCkpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgdGFibGUgPT09ICdzdHJpbmcnID8gWyAncmVhZHdyaXRlJyBdIDogdGFibGUuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcbiAgICAgIC8vIEdldCB0aGUgRHluYW1vREIgdGFibGUgYmFzZWQgb24gdGhlIGNvbnRyb2xsZXIgY29uZmlnXG4gICAgICBjb25zdCB0YWJsZUluc3RhbmNlOiBJVGFibGVWMiA9IFRhYmxlVjIuZnJvbVRhYmxlQXR0cmlidXRlcyh0aGlzLCBgJHtpZH0tJHt0YWJsZU5hbWV9LXRhYmxlYCwge1xuICAgICAgICB0YWJsZU5hbWU6IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShhcHBRdWFsaWZpZWRUYWJsZU5hbWUgKyAnX3RhYmxlTmFtZScsICd0YWJsZScsIHNjb3BlKSxcbiAgICAgICAgZ3JhbnRJbmRleFBlcm1pc3Npb25zOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCB0aGUgdGFibGUgbmFtZSB0byB0aGUgbGFtYmRhIGVudmlyb25tZW50ICAgICAgXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHthcHBRdWFsaWZpZWRUYWJsZU5hbWV9YCxcbiAgICAgICAgdmFsdWU6IHRhYmxlSW5zdGFuY2UudGFibGVOYW1lXG4gICAgICB9KTtcblxuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiByZWFkIHdyaXRlIGFjY2VzcyB0byB0aGUgdGFibGVcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVhZCc6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50UmVhZERhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnd3JpdGUnOlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFdyaXRlRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFJlYWRXcml0ZURhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBTMyBidWNrZXQgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgcHJvcHMucmVzb3VyY2VBY2Nlc3M/LmJ1Y2tldHM/LmZvckVhY2goKGJ1Y2tldDogYW55KSA9PiB7XG4gICAgICBsZXQgYnVja2V0TmFtZSA9IHR5cGVvZiBidWNrZXQgPT09ICdzdHJpbmcnID8gYnVja2V0IDogYnVja2V0Lm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIGJ1Y2tldE5hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShidWNrZXROYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIGJ1Y2tldCA9PT0gJ3N0cmluZycgPyBbICdyZWFkd3JpdGUnIF0gOiBidWNrZXQuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcblxuICAgICAgY29uc3QgYnVja2V0RnVsbE5hbWUgPSBmdzI0LmdldFVuaXF1ZU5hbWUoYnVja2V0TmFtZSk7XG4gICAgICBjb25zdCBidWNrZXRJbnN0YW5jZTogYW55ID0gQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsIGJ1Y2tldE5hbWUgKyBpZCArICctYnVja2V0JywgYnVja2V0RnVsbE5hbWUpO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIGJ1Y2tldFxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWFkJzpcbiAgICAgICAgICAgIGJ1Y2tldEluc3RhbmNlLmdyYW50UmVhZChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd3cml0ZSc6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFdyaXRlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFJlYWRXcml0ZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGJ1Y2tldCBuYW1lXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgYnVja2V0XyR7YnVja2V0TmFtZX1gLFxuICAgICAgICB2YWx1ZTogYnVja2V0RnVsbE5hbWVcbiAgICAgIH0pO1xuXG4gICAgfSk7XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIFNRUyBxdWV1ZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8ucXVldWVzPy5mb3JFYWNoKChxdWV1ZTogYW55KSA9PiB7XG4gICAgICBsZXQgcXVldWVOYW1lID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IHF1ZXVlIDogcXVldWUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgcXVldWVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUocXVldWVOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IFsgJ3NlbmQnIF0gOiBxdWV1ZS5hY2Nlc3MgfHwgWyAnc2VuZCcgXTtcblxuICAgICAgY29uc3QgcXVldWVBcm4gPSBmdzI0LmdldEFybignc3FzJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcywgcXVldWVOYW1lICsgaWQgKyAnLXF1ZXVlJywgcXVldWVBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHF1ZXVlXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ3JlY2VpdmUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudENvbnN1bWVNZXNzYWdlcyhmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFB1cmdlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgcXVldWUgdXJsXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHtxdWV1ZU5hbWV9X3F1ZXVlVXJsYCxcbiAgICAgICAgdmFsdWU6IHF1ZXVlSW5zdGFuY2UucXVldWVVcmxcbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgU05TIHRvcGljIHBlcm1pc3Npb25cbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8udG9waWNzPy5mb3JFYWNoKCh0b3BpYzogYW55KSA9PiB7XG4gICAgICBsZXQgdG9waWNOYW1lID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IHRvcGljIDogdG9waWMubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdG9waWNOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodG9waWNOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IFsgJ3B1Ymxpc2gnIF0gOiB0b3BpYy5hY2Nlc3MgfHwgWyAncHVibGlzaCcgXTtcblxuICAgICAgY29uc3QgdG9waWNBcm4gPSBmdzI0LmdldEFybignc25zJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSArICdfdG9waWNOYW1lJywgJ3RvcGljJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcywgdG9waWNOYW1lICsgaWQgKyAnLXRvcGljJywgdG9waWNBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHRvcGljXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICB0b3BpY0luc3RhbmNlLmdyYW50UHVibGlzaChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSB0b3BpYyBhcm5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke3RvcGljTmFtZX1fdG9waWNBcm5gLFxuICAgICAgICB2YWx1ZTogdG9waWNJbnN0YW5jZS50b3BpY0FyblxuICAgICAgfSlcbiAgICB9KTtcblxuICAgIHJldHVybiBmbjtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24ob3B0aW9uczoge1xuICBmbjogTm9kZWpzRnVuY3Rpb24sXG4gIGtleTogc3RyaW5nLFxuICB2YWx1ZTogc3RyaW5nLFxuICBwcmVmaXg/OiBzdHJpbmcsXG4gIHN1ZmZpeD86IHN0cmluZyxcbn0pIHtcblxuICBjb25zdCB7IGZuLCBrZXksIHZhbHVlLCBwcmVmaXggPSAnJywgc3VmZml4ID0gJycgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgZW52S2V5ID0gZW5zdXJlVmFsaWRFbnZLZXkoa2V5LCBwcmVmaXgsIHN1ZmZpeCk7XG4gIGZuLmFkZEVudmlyb25tZW50KGVudktleSwgdmFsdWUpO1xufVxuIl19