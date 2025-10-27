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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWZ1bmN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWlCQSw0Q0FFQztBQTRKRCx3Q0FnQkM7QUEvTEQsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxpREFBaUY7QUFDakYsdURBQWdJO0FBQ2hJLDJEQUE2RDtBQUM3RCxxRUFBb0Y7QUFDcEYsdUNBQW9DO0FBQ3BDLCtDQUE0QztBQUM1QyxxQ0FBMkM7QUFDM0MsaURBQTRDO0FBQzVDLGlEQUE0QztBQUM1Qyx3Q0FBbUQ7QUFDbkQsbURBQStEO0FBQy9ELHdDQUFzRjtBQUl0RixTQUFnQixnQkFBZ0IsQ0FBQyxNQUFpRDtJQUNoRixPQUFRLE1BQTBCLENBQUMsSUFBSSxLQUFLLFNBQVMsQ0FBQztBQUN4RCxDQUFDO0FBMkdEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStDRztBQUVILFNBQWdCLGNBQWMsQ0FBQyxRQUFpQjtJQUM5QyxRQUFRLFFBQVEsRUFBRSxXQUFXLEVBQUUsRUFBRSxDQUFDO1FBQ2hDLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssTUFBTTtZQUNULE9BQU8sZ0NBQW1CLENBQUMsSUFBSSxDQUFDO1FBQ2xDLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssT0FBTztZQUNWLE9BQU8sZ0NBQW1CLENBQUMsS0FBSyxDQUFDO1FBQ25DLEtBQUssTUFBTSxDQUFDO1FBQ1o7WUFDRSxPQUFPLGdDQUFtQixDQUFDLElBQUksQ0FBQTtJQUNuQyxDQUFDO0FBQ0gsQ0FBQztBQUVELE1BQWEsY0FBZSxTQUFRLHNCQUFT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QyxDQUFDLENBQUM7WUFDM0csTUFBTSxhQUFhLEdBQUcsZUFBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsU0FBUyxHQUFHLEVBQUUsR0FBRyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDcEYsZ0RBQWdEO1lBQ2hELE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFrQixFQUFFLEVBQUU7Z0JBQ3BDLFFBQVEsVUFBVSxFQUFFLENBQUM7b0JBQ25CO3dCQUNFLGFBQWEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQy9CLE1BQU07Z0JBQ1YsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBQ0gsNkNBQTZDO1lBQzdDLGlDQUFpQyxDQUFDO2dCQUNoQyxFQUFFO2dCQUNGLEdBQUcsRUFBRSxHQUFHLFNBQVMsV0FBVztnQkFDNUIsS0FBSyxFQUFFLGFBQWEsQ0FBQyxRQUFRO2FBQzlCLENBQUMsQ0FBQTtRQUNKLENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0NBQ0Y7QUF4VUQsd0NBd1VDO0FBRUQsU0FBUyxpQ0FBaUMsQ0FBQyxPQU0xQztJQUVDLE1BQU0sRUFBRSxFQUFFLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRSxFQUFFLE1BQU0sR0FBRyxFQUFFLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFFN0QsTUFBTSxNQUFNLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxHQUFHLEVBQUUsTUFBTSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3RELEVBQUUsQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDO0FBQ25DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgRHVyYXRpb24sIFJlbW92YWxQb2xpY3kgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCwgdHlwZSBQb2xpY3lTdGF0ZW1lbnRQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBSdW50aW1lLCBBcmNoaXRlY3R1cmUsIExheWVyVmVyc2lvbiwgQXBwbGljYXRpb25Mb2dMZXZlbCwgTG9nZ2luZ0Zvcm1hdCwgSUxheWVyVmVyc2lvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBJVGFibGVWMiwgVGFibGVWMiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgQnVja2V0IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zM1wiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBUb3BpYyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc25zXCI7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIsIElMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgTG9nR3JvdXAsIFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IGVuc3VyZU5vU3BlY2lhbENoYXJzLCBlbnN1cmVTdWZmaXgsIGVuc3VyZVZhbGlkRW52S2V5IH0gZnJvbSBcIi4uL3V0aWxzL2tleXNcIjtcbmV4cG9ydCB0eXBlIFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzID0gUG9saWN5U3RhdGVtZW50IHwgUG9saWN5U3RhdGVtZW50UHJvcHM7XG5leHBvcnQgdHlwZSBUSW1wb3J0ZWRQb2xpY3kgPSB7IG5hbWU6IHN0cmluZywgaXNPcHRpb25hbD86IGJvb2xlYW4sIHByZWZpeD86IHN0cmluZyB9O1xuXG5leHBvcnQgZnVuY3Rpb24gaXNJbXBvcnRlZFBvbGljeShwb2xpY3k6IFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzIHwgVEltcG9ydGVkUG9saWN5KTogcG9saWN5IGlzIFRJbXBvcnRlZFBvbGljeSB7XG4gIHJldHVybiAocG9saWN5IGFzIFRJbXBvcnRlZFBvbGljeSkubmFtZSAhPT0gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIHByb3BlcnRpZXMgZm9yIGEgTGFtYmRhIGZ1bmN0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYUZ1bmN0aW9uUHJvcHMge1xuICAvKipcbiAgICogVGhlIGVudHJ5IHBvaW50IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgZW50cnk6IHN0cmluZztcblxuICAvKipcbiAgICogVGhlIHBvbGljaWVzIHRvIGF0dGFjaCB0byB0aGUgTGFtYmRhIGZ1bmN0aW9uJ3MgZXhlY3V0aW9uIHJvbGUuXG4gICAqL1xuICBwb2xpY2llcz86IEFycmF5PFRQb2xpY3lTdGF0ZW1lbnRPclByb3BzIHwgVEltcG9ydGVkUG9saWN5PjtcblxuICAvKipcbiAgICogVGhlIGVudmlyb25tZW50IHZhcmlhYmxlcyB0byBzZXQgZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBlbnZpcm9ubWVudFZhcmlhYmxlcz86IHsgWyBrZXk6IHN0cmluZyBdOiBzdHJpbmcgfTtcblxuICAvKipcbiAgICogVGhlIHJlc291cmNlIGFjY2VzcyBjb25maWd1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgcmVzb3VyY2VBY2Nlc3M/OiBJRnVuY3Rpb25SZXNvdXJjZUFjY2VzcztcblxuICAvKipcbiAgICogSW5kaWNhdGVzIHdoZXRoZXIgdGhlIExhbWJkYSBmdW5jdGlvbiBpcyBhbGxvd2VkIHRvIHNlbmQgZW1haWxzLlxuICAgKi9cbiAgYWxsb3dTZW5kRW1haWw/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGRheXMgdG8gcmV0YWluIHRoZSBsb2dzIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgbG9nUmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG5cbiAgLyoqXG4gICAqIFRoZSByZW1vdmFsIHBvbGljeSBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbidzIGxvZ3MuXG4gICAqL1xuICBsb2dSZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcblxuICAvKipcbiAgICogVGhlIHRpbWVvdXQgZHVyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb24gaW4gc2Vjb25kcy5cbiAgICogVXNlIHRoaXMgdGltZW91dCB0byBhdm9pZCBpbXBvcnRpbmcgdGhlIGR1cmF0aW9uIGNsYXNzIGZyb20gYXdzLWNkay1saWIuXG4gICAqL1xuICBmdW5jdGlvblRpbWVvdXQ/OiBudW1iZXI7XG5cbiAgcHJvY2Vzc29yQXJjaGl0ZWN0dXJlPzogJ3g4Nl82NCcgfCAnYXJtXzY0JztcblxuICAvKipcbiAgICogQWRkaXRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBMYW1iZGEgZnVuY3Rpb24uXG4gICAqL1xuICBmdW5jdGlvblByb3BzPzogT21pdDxOb2RlanNGdW5jdGlvblByb3BzLCAnbGF5ZXJzJz4gJiB7XG4gICAgcmVhZG9ubHkgbGF5ZXJzPzogQXJyYXk8SUxheWVyVmVyc2lvbiB8IHN0cmluZz47XG4gIH1cbn1cblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHZhcmlvdXMgcmVzb3VyY2VzIHRoYXQgY2FuIGJlIGFjY2Vzc2VkIGJ5IGEgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUZ1bmN0aW9uUmVzb3VyY2VBY2Nlc3Mge1xuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciB0YWJsZXMuXG4gICAqIEVhY2ggdGFibGUgY2FuIGhhdmUgYSBuYW1lIGFuZCBhbiBvcHRpb25hbCBhcnJheSBvZiBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdyZWFkJywgJ3dyaXRlJywgb3IgJ3JlYWR3cml0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncmVhZHdyaXRlJy5cbiAgICovXG4gIHRhYmxlcz86IEFycmF5PHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgYWNjZXNzPzogc3RyaW5nW107XG4gIH0+IHwgc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBwZXJtaXNzaW9ucyBmb3IgYnVja2V0cy5cbiAgICogRWFjaCBidWNrZXQgY2FuIGhhdmUgYSBuYW1lIGFuZCBhbiBvcHRpb25hbCBhcnJheSBvZiBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdyZWFkJywgJ3dyaXRlJywgb3IgJ3JlYWR3cml0ZScuXG4gICAqIElmIG5vIGFjY2VzcyBwZXJtaXNzaW9ucyBhcmUgc3BlY2lmaWVkLCB0aGUgZGVmYXVsdCBpcyAncmVhZHdyaXRlJy5cbiAgICovXG4gIGJ1Y2tldHM/OiBBcnJheTx7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGFjY2Vzcz86IHN0cmluZ1tdO1xuICB9PiB8IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgcGVybWlzc2lvbnMgZm9yIHRvcGljcy5cbiAgICogRWFjaCB0b3BpYyBjYW4gaGF2ZSBhIG5hbWUgYW5kIGFuIG9wdGlvbmFsIGFycmF5IG9mIGFjY2VzcyBwZXJtaXNzaW9ucy5cbiAgICogVGhlIGFjY2VzcyBwZXJtaXNzaW9ucyBjYW4gYmUgJ3B1Ymxpc2gnLlxuICAgKiBJZiBubyBhY2Nlc3MgcGVybWlzc2lvbnMgYXJlIHNwZWNpZmllZCwgdGhlIGRlZmF1bHQgaXMgJ3B1Ymxpc2gnLlxuICAgKi9cbiAgdG9waWNzPzogQXJyYXk8e1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhY2Nlc3M/OiBzdHJpbmdbXTtcbiAgfT4gfCBzdHJpbmdbXTtcblxuICAvKipcbiAgICogQWNjZXNzIHBlcm1pc3Npb25zIGZvciBxdWV1ZXMuXG4gICAqIEVhY2ggcXVldWUgY2FuIGhhdmUgYSBuYW1lIGFuZCBhbiBvcHRpb25hbCBhcnJheSBvZiBhY2Nlc3MgcGVybWlzc2lvbnMuXG4gICAqIFRoZSBhY2Nlc3MgcGVybWlzc2lvbnMgY2FuIGJlICdzZW5kJywgJ3JlY2VpdmUnLCBvciAnZGVsZXRlJy5cbiAgICogSWYgbm8gYWNjZXNzIHBlcm1pc3Npb25zIGFyZSBzcGVjaWZpZWQsIHRoZSBkZWZhdWx0IGlzICdzZW5kJy5cbiAgICovXG4gIHF1ZXVlcz86IEFycmF5PHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgYWNjZXNzPzogc3RyaW5nW107XG4gIH0+IHwgc3RyaW5nW107XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgTGFtYmRhIGZ1bmN0aW9uIGNvbnN0cnVjdC5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIExhbWJkYSBmdW5jdGlvbiB3aXRoIGN1c3RvbSBwcm9wZXJ0aWVzXG4gKiBjb25zdCBsYW1iZGFQcm9wczogTGFtYmRhRnVuY3Rpb25Qcm9wcyA9IHtcbiAqICAgZW50cnk6IFwiaW5kZXguanNcIixcbiAqICAgcG9saWNpZXM6IFt7XG4gKiAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICogICAgICAgICBhY3Rpb25zOiBbXG4gKiAgICAgICAgICBcInMzOkdldE9iamVjdFwiXG4gKiAgICAgICAgIF0sXG4gKiAgICAgICAgIHJlc291cmNlczogW1wiYXJuOmF3czpzMzo6Om15LWJ1Y2tldC8qXCJdLFxuICogICAgIH0sIFxuICogICAgIHtcbiAqICAgICAgIHBvbGljeTogXCJhdXRoTW9kdWxlOmNyZWF0ZS11c2VyLWF1dGgtcmVjb3JkXCIsXG4gKiAgICAgICBpc09wdGlvbmFsOiB0cnVlXG4gKiAgICAgfVxuICogICBdLFxuICogICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICogICAgIE1ZX0VOVl9WQVI6IFwibXktdmFsdWVcIixcbiAqICAgfSxcbiAqICAgcmVzb3VyY2VBY2Nlc3M6IHtcbiAqICAgICB0YWJsZXM6IFtcbiAqICAgICAgIHtcbiAqICAgICAgICAgbmFtZTogXCJteS10YWJsZVwiLFxuICogICAgICAgICBhY2Nlc3M6IFtcInJlYWRcIiwgXCJ3cml0ZVwiXSxcbiAqICAgICAgIH0sXG4gKiAgICAgXSxcbiAqICAgICBidWNrZXRzOiBbXCJteS1idWNrZXRcIl0sXG4gKiAgICAgdG9waWNzOiBbXCJteS10b3BpY1wiXSxcbiAqICAgICBxdWV1ZXM6IFtcIm15LXF1ZXVlXCJdLFxuICogICB9LFxuICogICBhbGxvd1NlbmRFbWFpbDogdHJ1ZSxcbiAqICAgbG9nUmV0ZW50aW9uRGF5czogUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAqICAgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICogICBmdW5jdGlvblRpbWVvdXQ6IDEwLFxuICogICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAqICAgICBtZW1vcnlTaXplOiAyNTYsXG4gKiAgIH0sXG4gKiB9O1xuICpcbiAqIGNvbnN0IGxhbWJkYUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHN0YWNrLCBcIk15TGFtYmRhRnVuY3Rpb25cIiwgbGFtYmRhUHJvcHMpO1xuICogXG4gKiBgYGBcbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0TG9nTGV2ZWwobG9nTGV2ZWw/OiBzdHJpbmcpIHtcbiAgc3dpdGNoIChsb2dMZXZlbD8udG9VcHBlckNhc2UoKSkge1xuICAgIGNhc2UgJ0VSUk9SJzpcbiAgICAgIHJldHVybiBBcHBsaWNhdGlvbkxvZ0xldmVsLkVSUk9SO1xuICAgIGNhc2UgJ1dBUk4nOlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuV0FSTjtcbiAgICBjYXNlICdERUJVRyc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5ERUJVRztcbiAgICBjYXNlICdUUkFDRSc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5UUkFDRTtcbiAgICBjYXNlICdGQVRBTCc6XG4gICAgICByZXR1cm4gQXBwbGljYXRpb25Mb2dMZXZlbC5GQVRBTDtcbiAgICBjYXNlICdJTkZPJzpcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIEFwcGxpY2F0aW9uTG9nTGV2ZWwuSU5GT1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBMYW1iZGFGdW5jdGlvbiBleHRlbmRzIENvbnN0cnVjdCB7XG5cbiAgcmVhZG9ubHkgbG9nZ2VyPzogSUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignTGFtYmRhRnVuY3Rpb24nKTtcblxuICAvKipcbiAgICogQ29uc3RydWN0cyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgTGFtYmRhRnVuY3Rpb24gY2xhc3MuXG4gICAqIEBwYXJhbSBzY29wZSAtIFRoZSBwYXJlbnQgY29uc3RydWN0LlxuICAgKiBAcGFyYW0gaWQgLSBUaGUgSUQgb2YgdGhlIGNvbnN0cnVjdC5cbiAgICogQHBhcmFtIHByb3BzIC0gVGhlIExhbWJkYSBmdW5jdGlvbiBwcm9wZXJ0aWVzLlxuICAgKiBAcmV0dXJucyBUaGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExhbWJkYUZ1bmN0aW9uUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIC8vIERlZmF1bHQgcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb25cbiAgICBsZXQgZGVmYXVsdFByb3BzOiBOb2RlanNGdW5jdGlvblByb3BzID0ge1xuICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLkFSTV82NCxcbiAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDEyOCxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IHByb2Nlc3MuZW52LkxPR19GT1JNQVQ/LnRvTG93ZXJDYXNlPy4oKSA9PT0gJ2pzb24nID8gTG9nZ2luZ0Zvcm1hdC5KU09OIDogTG9nZ2luZ0Zvcm1hdC5URVhULFxuICAgICAgLi4uZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblByb3BzIGFzIE5vZGVqc0Z1bmN0aW9uUHJvcHMsXG4gICAgfTtcblxuICAgIC8vICAnRXJyb3InICBUbyB1c2UgQXBwbGljYXRpb25Mb2dMZXZlbCBhbmQvb3IgU3lzdGVtTG9nTGV2ZWwgeW91IG11c3Qgc2V0IExvZ2dpbmdGb3JtYXQgdG8gJ0pTT04nLCBnb3QgJ1RleHQnLlxuICAgIGlmIChkZWZhdWx0UHJvcHMubG9nZ2luZ0Zvcm1hdCA9PT0gTG9nZ2luZ0Zvcm1hdC5KU09OKSB7XG4gICAgICBkZWZhdWx0UHJvcHMgPSB7XG4gICAgICAgIC4uLmRlZmF1bHRQcm9wcyxcbiAgICAgICAgYXBwbGljYXRpb25Mb2dMZXZlbFYyOiBmb3JtYXRMb2dMZXZlbChwcm9jZXNzLmVudi5MT0dfTEVWRUwpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBsb2cgZ3JvdXAgaWYgbm90IHByb3ZpZGVkXG4gICAgbGV0IGxvZ0dyb3VwID0gcHJvcHMuZnVuY3Rpb25Qcm9wcz8ubG9nR3JvdXA7XG4gICAgaWYgKCFsb2dHcm91cCkge1xuICAgICAgbGV0IGxvZ1JldGVudGlvbkRheXMgPSBwcm9wcy5sb2dSZXRlbnRpb25EYXlzIHx8IGZ3MjQuZ2V0Q29uZmlnKCkubG9nUmV0ZW50aW9uRGF5cyB8fCAzMDtcbiAgICAgIGxvZ0dyb3VwID0gbmV3IExvZ0dyb3VwKHRoaXMsIGAke2lkfS1Mb2dHcm91cGAsIHtcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogcHJvcHMubG9nUmVtb3ZhbFBvbGljeSB8fCBmdzI0LmdldENvbmZpZygpLmxvZ1JlbW92YWxQb2xpY3kgfHwgUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICAgIHJldGVudGlvbjogcGFyc2VJbnQobG9nUmV0ZW50aW9uRGF5cy50b1N0cmluZygpKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGxldCBhZGRpdGlvbmFsUHJvcHM6IGFueSA9IHtcbiAgICAgIGVudHJ5OiBwcm9wcy5lbnRyeSxcbiAgICB9XG5cbiAgICAvLyBjb2xsZWN0IHRoZSBuYW1lcyBvZiB0aGUgbGF5ZXJzIHByb3ZpZGVkIGluIGRlZmF1bHQgY29uZmlnIGlmIGFueSBvciBlbHNlIHRoZSBnbG9iYWwgbGF5ZXJzO1xuICAgIGNvbnN0IGRlZmF1bHRMYXllcnMgPSBkZWZhdWx0UHJvcHM/LmxheWVycyA/PyBBcnJheS5mcm9tKGZ3MjQuZ2V0R2xvYmFsTGFtYmRhTGF5ZXJOYW1lcygpKTtcblxuICAgIC8vIHJlc29sdmUgbGF5ZXIgbmFtZXMgdG8gYWN0dWFsIGxheWVyIGFybnNcbiAgICBjb25zdCBsYXllcnMgPSBbXG4gICAgICAuLi5kZWZhdWx0TGF5ZXJzLFxuICAgICAgLy8gY29sbGVjdCB0aGUgbmFtZXMgb2YgdGhlIGxheWVycyBwcm92aWRlZCBpbiBmdW5jdGlvbiBjb25maWcgaWYgYW55O1xuICAgICAgLi4uKHByb3BzLmZ1bmN0aW9uUHJvcHM/LmxheWVycyA/PyBbXSlcbiAgICBdIGFzIEFycmF5PHN0cmluZyB8IElMYXllclZlcnNpb24+O1xuXG4gICAgLy8gcmVtb3ZlIGR1cGxpY2F0ZXNcbiAgICBjb25zdCBkZUR1cExheWVycyA9IEFycmF5LmZyb20obmV3IFNldChsYXllcnMpKTtcblxuICAgIC8vIG1hcCBsYXllcnMgdG8gYWN0dWFsIGxheWVyIG9iamVjdHNcbiAgICBjb25zdCByZXNvbHZlZExheWVycyA9IGRlRHVwTGF5ZXJzLm1hcChsYXllck5hbWUgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBsYXllck5hbWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybih0aGlzLCBgJHtpZH0tJHtsYXllck5hbWV9LUxheWVyYCwgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGxheWVyTmFtZSArICdfbGF5ZXJWZXJzaW9uQXJuJywgJ2xheWVyJywgc2NvcGUpKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGxheWVyTmFtZTtcbiAgICB9KVxuXG4gICAgLy8gbWFrZSBzdXJlIHRvIGFkZCBmdzI0IGxheWVyXG4gICAgYWRkaXRpb25hbFByb3BzLmxheWVycyA9IFtcbiAgICAgIC4uLnJlc29sdmVkTGF5ZXJzLFxuICAgICAgTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4odGhpcywgYCR7aWR9LUZ3MjRDb3JlTGF5ZXJgLCBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ2Z3MjRfbGF5ZXJWZXJzaW9uQXJuJywgJ2xheWVyJywgc2NvcGUpKVxuICAgIF07XG5cbiAgICBhZGRpdGlvbmFsUHJvcHMuYnVuZGxpbmcgPSB7XG4gICAgICAuLi5kZWZhdWx0UHJvcHMuYnVuZGxpbmcsXG4gICAgICAuLi5wcm9wcy5mdW5jdGlvblByb3BzPy5idW5kbGluZyxcbiAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAuLi4oZGVmYXVsdFByb3BzPy5idW5kbGluZz8uZXh0ZXJuYWxNb2R1bGVzID8/IFtdKSxcbiAgICAgICAgLi4uKHByb3BzLmZ1bmN0aW9uUHJvcHM/LmJ1bmRsaW5nPy5leHRlcm5hbE1vZHVsZXMgPz8gW10pLFxuICAgICAgICBcIkB0ZW4yNGdyb3VwL2Z3MjRcIlxuICAgICAgXSxcbiAgICB9O1xuICAgIGFkZGl0aW9uYWxQcm9wcy5sb2dHcm91cCA9IGxvZ0dyb3VwO1xuICAgIGlmIChwcm9wcy5mdW5jdGlvblRpbWVvdXQpIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wcy50aW1lb3V0ID0gRHVyYXRpb24uc2Vjb25kcyhwcm9wcy5mdW5jdGlvblRpbWVvdXQpO1xuICAgIH1cblxuICAgIGlmIChwcm9wcy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUpIHtcbiAgICAgIGFkZGl0aW9uYWxQcm9wcy5hcmNoaXRlY3R1cmUgPSBwcm9wcy5wcm9jZXNzb3JBcmNoaXRlY3R1cmUgPT09ICd4ODZfNjQnID8gQXJjaGl0ZWN0dXJlLlg4Nl82NCA6IEFyY2hpdGVjdHVyZS5BUk1fNjQ7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHRoZSBOb2RlLmpzIGZ1bmN0aW9uXG4gICAgY29uc3QgZm4gPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgaWQsIHtcbiAgICAgIC4uLmRlZmF1bHRQcm9wcyxcbiAgICAgIC4uLnByb3BzLmZ1bmN0aW9uUHJvcHMsXG4gICAgICAuLi5hZGRpdGlvbmFsUHJvcHMsXG4gICAgfSk7XG5cbiAgICBwcm9wcy5lbnZpcm9ubWVudFZhcmlhYmxlcyA9IHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzID8/IHt9O1xuXG4gICAgLy8gKiBFWFBPUlQgdGhlIGxvZy1sZXZlbCBmb3Igb3VyIGxvZ2dlci1pbnN0YW5jZXMgaW4gdGhlIHJ1bnRpbWUgb2YgdGhpcyBsYW1iZGFcbiAgICAvLyBTZWUgJy4uL2xvZ2dpbmcvaW5kZXgudHMnIGZvciBtb3JlIGluZm9cbiAgICAvLyBOT1RFOiB0aGlzIGxvZy1sZXZlbCBpcyBkaWZmZXJlbnQgdGhhbiB0aGUgYXdzLWxvZy1sZXZlbFxuICAgIC8vIGF3cyByZXF1aXJlcyB0aGUgbG9nIGZvcm1hdCBzZXQgdG8gSlNPTiB0byBvdmVycmlkZSBsb2ctbGV2ZWwgc2VlIGBhcHBsaWNhdGlvbkxvZ0xldmVsVjJgIGluIHRoZSBjb2RlIGFib3ZlXG5cbiAgICAvLyBlbnN1cmUgdGhlIGVudmlyb25tZW50LXZhcmlhYmxlcyBmb3IgdGhlIGxhbWJkYSBhbHdheXMgaGF2ZSBhIGxvZy1sZXZlbFxuICAgIGlmICghKCdMT0dfTEVWRUwnIGluIHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKSkge1xuICAgICAgcHJvcHMuZW52aXJvbm1lbnRWYXJpYWJsZXNbICdMT0dfTEVWRUwnIF0gPSBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ0xPR19MRVZFTCcpO1xuICAgIH1cblxuICAgIC8vIFNldCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzLmVudmlyb25tZW50VmFyaWFibGVzKSkge1xuICAgICAgbGV0IGVudlZhbHVlID0gdmFsdWU7XG4gICAgICBsZXQgZW52S2V5ID0ga2V5O1xuICAgICAgLy8gSWYga2V5IGlzIHByZWZpeGVkIHdpdGggZncyNF8sIGFjY2VzcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBmdzI0IHNjb3BlXG4gICAgICAvLyBrZXlzIGNhbiBoYXZlIHNoYXBlIGxpa2U6XG4gICAgICAvLyBmdzI0X3h4eCAod2l0aG91dCBzY29wZSlcbiAgICAgIC8vIGZ3MjRfQXV0aE1vZHVsZV94eHggKHdpdGggc2NvcGU6IEF1dGhNb2R1bGUpXG4gICAgICAvLyBmdzI0X1VzZXJQb29sX0F1dGhNb2R1bGVfdXNlclBvb2xJZCAod2l0aCBzY29wZTogVXNlclBvb2xfQXV0aE1vZHVsZSlcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5zdGFydHNXaXRoKCdmdzI0XycpKSB7XG4gICAgICAgIC8vIFJlbW92ZSBmdzI0XyBwcmVmaXhcbiAgICAgICAgY29uc3Qga2V5V2l0aG91dFByZWZpeCA9IHZhbHVlLnJlcGxhY2UoJ2Z3MjRfJywgJycpO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IGtleVdpdGhvdXRQcmVmaXguc3BsaXQoJ18nKTtcblxuICAgICAgICAvLyBMYXN0IHBhcnQgaXMgYWx3YXlzIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBuYW1lXG4gICAgICAgIGNvbnN0IGVudlZhck5hbWUgPSBwYXJ0c1sgcGFydHMubGVuZ3RoIC0gMSBdO1xuXG4gICAgICAgIC8vIEV2ZXJ5dGhpbmcgYmVmb3JlIHRoZSBsYXN0IHBhcnQgaXMgdGhlIHNjb3BlIChpZiBhbnkpXG4gICAgICAgIGNvbnN0IHNjb3BlID0gcGFydHMubGVuZ3RoID4gMSA/IHBhcnRzLnNsaWNlKDAsIC0xKS5qb2luKCdfJykgOiAnJztcblxuICAgICAgICBlbnZWYWx1ZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShlbnZWYXJOYW1lLCBzY29wZSk7XG4gICAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgUmVzb2x2ZWQgZncyNCBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHt2YWx1ZX0gLT4gJHtlbnZWYWx1ZX1gLCBpZCk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgOlNFVCBlbnZpcm9ubWVudCB2YXJpYWJsZSBbJHtlbnZLZXl9IDogJHtlbnZWYWx1ZX1dYCwgaWQpO1xuXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBlbnZLZXksXG4gICAgICAgIHZhbHVlOiBlbnZWYWx1ZVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQWRkIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gdGhlIGZ1bmN0aW9uXG4gICAgZncyNC5nZXRHbG9iYWxFbnZpcm9ubWVudFZhcmlhYmxlcygpLmZvckVhY2goZW52S2V5ID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyPy5kZWJ1ZyhgQWRkaW5nIGdsb2JhbCBlbnZpcm9ubWVudCB2YXJpYWJsZTogJHtlbnZLZXl9YCwgaWQpO1xuICAgICAgYWRkRW52aXJvbm1lbnRLZXlWYWx1ZUZvckZ1bmN0aW9uKHtcbiAgICAgICAgZm4sXG4gICAgICAgIGtleTogZW52S2V5LFxuICAgICAgICB2YWx1ZTogZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKGVudktleSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQXR0YWNoIHBvbGljaWVzIHRvIHRoZSBmdW5jdGlvblxuICAgIChwcm9wcy5wb2xpY2llcyA/PyBbXSkuZm9yRWFjaChwb2xpY3kgPT4ge1xuXG4gICAgICBpZiAoaXNJbXBvcnRlZFBvbGljeShwb2xpY3kpKSB7XG5cbiAgICAgICAgaWYgKCFwb2xpY3kuaXNPcHRpb25hbCAmJiAhZncyNC5oYXNQb2xpY3kocG9saWN5Lm5hbWUsIHBvbGljeS5wcmVmaXgpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQb2xpY3kgJHtwb2xpY3l9IG5vdCBmb3VuZCBpbiBmdzI0IHNjb3BlYCk7XG4gICAgICAgIH1cblxuICAgICAgICBwb2xpY3kgPSBmdzI0LmdldFBvbGljeShwb2xpY3kubmFtZSwgcG9saWN5LnByZWZpeCkgYXMgUG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghKHBvbGljeSBpbnN0YW5jZW9mIFBvbGljeVN0YXRlbWVudCkpIHtcbiAgICAgICAgcG9saWN5ID0gbmV3IFBvbGljeVN0YXRlbWVudChwb2xpY3kpO1xuICAgICAgfVxuXG4gICAgICBmbi5hZGRUb1JvbGVQb2xpY3kocG9saWN5IGFzIFBvbGljeVN0YXRlbWVudCk7XG5cbiAgICB9KTtcblxuICAgIC8vIElmIHdlIGFyZSB1c2luZyBTRVMsIHRoZW4gd2UgbmVlZCB0byBhZGQgdGhlIGVtYWlsIHF1ZXVlIHVybCB0byB0aGUgZW52aXJvbm1lbnRcbiAgICBpZiAocHJvcHMuYWxsb3dTZW5kRW1haWwgJiYgZncyNC5lbWFpbFByb3ZpZGVyIGluc3RhbmNlb2YgTWFpbGVyQ29uc3RydWN0KSB7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlTmFtZSA9IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnZW1haWxRdWV1ZV9xdWV1ZU5hbWUnLCAncXVldWUnLCBzY29wZSk7XG4gICAgICBjb25zdCBlbWFpbFF1ZXVlID0gUXVldWUuZnJvbVF1ZXVlQXJuKHRoaXMsIGAke2lkfS0ke2VtYWlsUXVldWVOYW1lfS1xdWV1ZWAsIGZ3MjQuZ2V0QXJuKCdzcXMnLCBlbWFpbFF1ZXVlTmFtZSkpO1xuXG4gICAgICBlbWFpbFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGBFTUFJTF9RVUVVRV9VUkxgLFxuICAgICAgICB2YWx1ZTogZW1haWxRdWV1ZS5xdWV1ZVVybFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBEeW5hbW9EQiB0YWJsZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8udGFibGVzPy5mb3JFYWNoKCh0YWJsZTogYW55KSA9PiB7XG4gICAgICBsZXQgdGFibGVOYW1lID0gdHlwZW9mIHRhYmxlID09PSAnc3RyaW5nJyA/IHRhYmxlIDogdGFibGUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdGFibGVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodGFibGVOYW1lKTtcblxuICAgICAgY29uc3QgYXBwUXVhbGlmaWVkVGFibGVOYW1lID0gZW5zdXJlTm9TcGVjaWFsQ2hhcnMoZW5zdXJlU3VmZml4KHRhYmxlTmFtZSwgYHRhYmxlYCkpO1xuXG4gICAgICBjb25zdCBhY2Nlc3MgPSB0eXBlb2YgdGFibGUgPT09ICdzdHJpbmcnID8gWyAncmVhZHdyaXRlJyBdIDogdGFibGUuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcbiAgICAgIC8vIEdldCB0aGUgRHluYW1vREIgdGFibGUgYmFzZWQgb24gdGhlIGNvbnRyb2xsZXIgY29uZmlnXG4gICAgICBjb25zdCB0YWJsZUluc3RhbmNlOiBJVGFibGVWMiA9IFRhYmxlVjIuZnJvbVRhYmxlQXR0cmlidXRlcyh0aGlzLCBgJHtpZH0tJHt0YWJsZU5hbWV9LXRhYmxlYCwge1xuICAgICAgICB0YWJsZU5hbWU6IGZ3MjQuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZShhcHBRdWFsaWZpZWRUYWJsZU5hbWUgKyAnX3RhYmxlTmFtZScsICd0YWJsZScsIHNjb3BlKSxcbiAgICAgICAgZ3JhbnRJbmRleFBlcm1pc3Npb25zOiB0cnVlLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCB0aGUgdGFibGUgbmFtZSB0byB0aGUgbGFtYmRhIGVudmlyb25tZW50ICAgICAgXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHthcHBRdWFsaWZpZWRUYWJsZU5hbWV9YCxcbiAgICAgICAgdmFsdWU6IHRhYmxlSW5zdGFuY2UudGFibGVOYW1lXG4gICAgICB9KTtcblxuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiByZWFkIHdyaXRlIGFjY2VzcyB0byB0aGUgdGFibGVcbiAgICAgIGFjY2Vzcy5mb3JFYWNoKChhY2Nlc3NUeXBlOiBzdHJpbmcpID0+IHtcbiAgICAgICAgc3dpdGNoIChhY2Nlc3NUeXBlKSB7XG4gICAgICAgICAgY2FzZSAncmVhZCc6XG4gICAgICAgICAgICB0YWJsZUluc3RhbmNlLmdyYW50UmVhZERhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnd3JpdGUnOlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFdyaXRlRGF0YShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgdGFibGVJbnN0YW5jZS5ncmFudFJlYWRXcml0ZURhdGEoZm4pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTG9naWMgZm9yIGFkZGluZyBTMyBidWNrZXQgYWNjZXNzIHRvIHRoZSBjb250cm9sbGVyXG4gICAgcHJvcHMucmVzb3VyY2VBY2Nlc3M/LmJ1Y2tldHM/LmZvckVhY2goKGJ1Y2tldDogYW55KSA9PiB7XG4gICAgICBsZXQgYnVja2V0TmFtZSA9IHR5cGVvZiBidWNrZXQgPT09ICdzdHJpbmcnID8gYnVja2V0IDogYnVja2V0Lm5hbWU7XG5cbiAgICAgIC8vIGVuc3VyZSB0aGUgcGxhY2Vob2xkZXIgZW52IGtleXMgYXJlIHJlc29sdmVkIGZyb20gdGhlIGZ3MjQgc2NvcGVcbiAgICAgIGJ1Y2tldE5hbWUgPSBmdzI0LnRyeVJlc29sdmVFbnZLZXlUZW1wbGF0ZShidWNrZXROYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIGJ1Y2tldCA9PT0gJ3N0cmluZycgPyBbICdyZWFkd3JpdGUnIF0gOiBidWNrZXQuYWNjZXNzIHx8IFsgJ3JlYWR3cml0ZScgXTtcblxuICAgICAgY29uc3QgYnVja2V0RnVsbE5hbWUgPSBmdzI0LmdldFVuaXF1ZU5hbWUoYnVja2V0TmFtZSk7XG4gICAgICBjb25zdCBidWNrZXRJbnN0YW5jZTogYW55ID0gQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsIGJ1Y2tldE5hbWUgKyBpZCArICctYnVja2V0JywgYnVja2V0RnVsbE5hbWUpO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIGJ1Y2tldFxuICAgICAgYWNjZXNzLmZvckVhY2goKGFjY2Vzc1R5cGU6IHN0cmluZykgPT4ge1xuICAgICAgICBzd2l0Y2ggKGFjY2Vzc1R5cGUpIHtcbiAgICAgICAgICBjYXNlICdyZWFkJzpcbiAgICAgICAgICAgIGJ1Y2tldEluc3RhbmNlLmdyYW50UmVhZChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICd3cml0ZSc6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFdyaXRlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBidWNrZXRJbnN0YW5jZS5ncmFudFJlYWRXcml0ZShmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdGhlIGJ1Y2tldCBuYW1lXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgYnVja2V0XyR7YnVja2V0TmFtZX1gLFxuICAgICAgICB2YWx1ZTogYnVja2V0RnVsbE5hbWVcbiAgICAgIH0pO1xuXG4gICAgfSk7XG5cbiAgICAvLyBMb2dpYyBmb3IgYWRkaW5nIFNRUyBxdWV1ZSBhY2Nlc3MgdG8gdGhlIGNvbnRyb2xsZXJcbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8ucXVldWVzPy5mb3JFYWNoKChxdWV1ZTogYW55KSA9PiB7XG4gICAgICBsZXQgcXVldWVOYW1lID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IHF1ZXVlIDogcXVldWUubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgcXVldWVOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUocXVldWVOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHF1ZXVlID09PSAnc3RyaW5nJyA/IFsgJ3NlbmQnIF0gOiBxdWV1ZS5hY2Nlc3MgfHwgWyAnc2VuZCcgXTtcblxuICAgICAgY29uc3QgcXVldWVBcm4gPSBmdzI0LmdldEFybignc3FzJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHF1ZXVlTmFtZSArICdfcXVldWVOYW1lJywgJ3F1ZXVlJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHF1ZXVlSW5zdGFuY2UgPSBRdWV1ZS5mcm9tUXVldWVBcm4odGhpcywgcXVldWVOYW1lICsgaWQgKyAnLXF1ZXVlJywgcXVldWVBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHF1ZXVlXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGNhc2UgJ3JlY2VpdmUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudENvbnN1bWVNZXNzYWdlcyhmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgICAgcXVldWVJbnN0YW5jZS5ncmFudFB1cmdlKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICBxdWV1ZUluc3RhbmNlLmdyYW50U2VuZE1lc3NhZ2VzKGZuKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB0aGUgcXVldWUgdXJsXG4gICAgICBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24oe1xuICAgICAgICBmbixcbiAgICAgICAga2V5OiBgJHtxdWV1ZU5hbWV9X3F1ZXVlVXJsYCxcbiAgICAgICAgdmFsdWU6IHF1ZXVlSW5zdGFuY2UucXVldWVVcmxcbiAgICAgIH0pXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgU05TIHRvcGljIHBlcm1pc3Npb25cbiAgICBwcm9wcy5yZXNvdXJjZUFjY2Vzcz8udG9waWNzPy5mb3JFYWNoKCh0b3BpYzogYW55KSA9PiB7XG4gICAgICBsZXQgdG9waWNOYW1lID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IHRvcGljIDogdG9waWMubmFtZTtcblxuICAgICAgLy8gZW5zdXJlIHRoZSBwbGFjZWhvbGRlciBlbnYga2V5cyBhcmUgcmVzb2x2ZWQgZnJvbSB0aGUgZncyNCBzY29wZVxuICAgICAgdG9waWNOYW1lID0gZncyNC50cnlSZXNvbHZlRW52S2V5VGVtcGxhdGUodG9waWNOYW1lKTtcblxuICAgICAgY29uc3QgYWNjZXNzID0gdHlwZW9mIHRvcGljID09PSAnc3RyaW5nJyA/IFsgJ3B1Ymxpc2gnIF0gOiB0b3BpYy5hY2Nlc3MgfHwgWyAncHVibGlzaCcgXTtcblxuICAgICAgY29uc3QgdG9waWNBcm4gPSBmdzI0LmdldEFybignc25zJywgZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRvcGljTmFtZSArICdfdG9waWNOYW1lJywgJ3RvcGljJywgc2NvcGUpKTtcbiAgICAgIGNvbnN0IHRvcGljSW5zdGFuY2UgPSBUb3BpYy5mcm9tVG9waWNBcm4odGhpcywgdG9waWNOYW1lICsgaWQgKyAnLXRvcGljJywgdG9waWNBcm4pO1xuICAgICAgLy8gR3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBhY2Nlc3MgdG8gdGhlIHRvcGljXG4gICAgICBhY2Nlc3MuZm9yRWFjaCgoYWNjZXNzVHlwZTogc3RyaW5nKSA9PiB7XG4gICAgICAgIHN3aXRjaCAoYWNjZXNzVHlwZSkge1xuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICB0b3BpY0luc3RhbmNlLmdyYW50UHVibGlzaChmbik7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGUgZm9yIHRoZSB0b3BpYyBhcm5cbiAgICAgIGFkZEVudmlyb25tZW50S2V5VmFsdWVGb3JGdW5jdGlvbih7XG4gICAgICAgIGZuLFxuICAgICAgICBrZXk6IGAke3RvcGljTmFtZX1fdG9waWNBcm5gLFxuICAgICAgICB2YWx1ZTogdG9waWNJbnN0YW5jZS50b3BpY0FyblxuICAgICAgfSlcbiAgICB9KTtcblxuICAgIHJldHVybiBmbjtcbiAgfVxufVxuXG5mdW5jdGlvbiBhZGRFbnZpcm9ubWVudEtleVZhbHVlRm9yRnVuY3Rpb24ob3B0aW9uczoge1xuICBmbjogTm9kZWpzRnVuY3Rpb24sXG4gIGtleTogc3RyaW5nLFxuICB2YWx1ZTogc3RyaW5nLFxuICBwcmVmaXg/OiBzdHJpbmcsXG4gIHN1ZmZpeD86IHN0cmluZyxcbn0pIHtcblxuICBjb25zdCB7IGZuLCBrZXksIHZhbHVlLCBwcmVmaXggPSAnJywgc3VmZml4ID0gJycgfSA9IG9wdGlvbnM7XG5cbiAgY29uc3QgZW52S2V5ID0gZW5zdXJlVmFsaWRFbnZLZXkoa2V5LCBwcmVmaXgsIHN1ZmZpeCk7XG4gIGZuLmFkZEVudmlyb25tZW50KGVudktleSwgdmFsdWUpO1xufVxuIl19