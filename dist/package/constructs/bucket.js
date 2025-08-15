"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BucketConstruct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_cdk_lib_2 = require("aws-cdk-lib");
const aws_s3_1 = require("aws-cdk-lib/aws-s3");
const aws_s3_notifications_1 = require("aws-cdk-lib/aws-s3-notifications");
const aws_s3_deployment_1 = require("aws-cdk-lib/aws-s3-deployment");
const lambda_function_1 = require("./lambda-function");
const helper_1 = require("../core/helper");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const queue_1 = require("./queue");
const aws_cloudfront_1 = require("aws-cdk-lib/aws-cloudfront");
const certificate_1 = require("./certificate");
const vpc_1 = require("./vpc");
const mailer_1 = require("./mailer");
/**
 * FW24 Construct to add buckets to your application.
 *
 * @param bucketConstructConfig - The configuration for the bucket construct.
 *
 * @example
 * const bucketConfig: IBucketConstructConfig[] = [
 *   {
 *     bucketName: 'my-bucket',
 *     removalPolicy: RemovalPolicy.RETAIN,
 *     autoDeleteObjects: false,
 *     publicReadAccess: true,
 *     bucketProps: {
 *       encryption: BucketEncryption.KMS,
 *       versioned: true,
 *     },
 *     domain: 'files.example.com',
 *     source: '/path/to/source',
 *     triggers: [
 *       {
 *         destination: 'lambda',
 *         events: [BucketEvent.OBJECT_CREATED],
 *         functionProps: {
 *           runtime: Runtime.NODEJS_22_X,
 *           entry: '/path/to/lambda_function',
 *         },
 *       },
 *     ],
 *   },
 * ];
 *
 * const bucket = new BucketConstruct(bucketConfig);
 *
 * app.use(bucket).run();
 *
 */
class BucketConstruct {
    bucketConstructConfig;
    stackName;
    parentStackName;
    logger = (0, logging_1.createLogger)(BucketConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = BucketConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name, mailer_1.MailerConstruct.name, queue_1.QueueConstruct.name];
    output;
    appConfig;
    mainStack;
    // default constructor to initialize the stack configuration
    constructor(bucketConstructConfig, stackName, parentStackName) {
        this.bucketConstructConfig = bucketConstructConfig;
        this.stackName = stackName;
        this.parentStackName = parentStackName;
        helper_1.Helper.hydrateConfig(bucketConstructConfig, 'S3');
    }
    // construct method to create the stack
    async construct() {
        // make the main stack available to the class
        this.appConfig = this.fw24.getConfig();
        // create the buckets
        this.bucketConstructConfig.forEach((bucketConfig) => {
            this.mainStack = this.fw24.getStack(bucketConfig.stackName || this.stackName, bucketConfig.parentStackName || this.parentStackName);
            this.createBucket(bucketConfig);
        });
    }
    createBucket(bucketConfig) {
        this.logger.debug("Creating bucket: ", bucketConfig.bucketName);
        const bucketName = this.fw24.getUniqueName(bucketConfig.bucketName);
        this.logger.info("Creating bucket name: ", bucketName);
        var bucketParams = {
            bucketName: bucketName,
            removalPolicy: bucketConfig.removalPolicy || aws_cdk_lib_2.RemovalPolicy.DESTROY,
            autoDeleteObjects: bucketConfig.autoDeleteObjects || true,
        };
        if (bucketConfig.publicReadAccess === true) {
            bucketParams.blockPublicAccess = new aws_s3_1.BlockPublicAccess({
                blockPublicAcls: false,
                blockPublicPolicy: false,
                ignorePublicAcls: false,
                restrictPublicBuckets: false,
            });
        }
        if (bucketConfig.bucketProps) {
            bucketParams = { ...bucketParams, ...bucketConfig.bucketProps };
        }
        const bucket = new aws_s3_1.Bucket(this.mainStack, bucketConfig.bucketName + '-bucket', bucketParams);
        this.fw24.setConstructOutput(this, bucketConfig.bucketName, bucket, construct_1.OutputType.BUCKET);
        if (bucketConfig.publicReadAccess === true) {
            bucket.grantPublicAccess();
        }
        if (bucketConfig.source && bucketConfig.source.length > 0) {
            new aws_s3_deployment_1.BucketDeployment(this.mainStack, bucketConfig.bucketName + '-deployment', {
                sources: [aws_s3_deployment_1.Source.asset(bucketConfig.source)],
                destinationBucket: bucket,
            });
        }
        if (bucketConfig.triggers && bucketConfig.triggers.length > 0) {
            bucketConfig.triggers.forEach(trigger => {
                if (trigger.destination === 'lambda' && trigger.functionProps) {
                    // create lambda function for the trigger event
                    // const functionPath = resolve(trigger.handler);
                    this.logger.debug("Creating lambda function for the trigger event: ", trigger.events.toString());
                    const functionId = bucketConfig.bucketName + "-" + trigger.destination + "-" + trigger.events.toString();
                    const lambda = new lambda_function_1.LambdaFunction(this.mainStack, functionId, {
                        ...trigger.functionProps
                    });
                    // grant the lambda function permissions to the bucket
                    bucket.grantRead(lambda);
                    // add event notification to the bucket for each event
                    // list of event types: https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#supported-notification-event-types
                    trigger.events.forEach(bucketEvent => {
                        bucket.addEventNotification(bucketEvent, new aws_s3_notifications_1.LambdaDestination(lambda));
                    });
                }
                if (trigger.destination === 'queue' && trigger.queueName) {
                    // add event notification to the bucket for each event
                    const queueInstance = this.fw24.getEnvironmentVariable(trigger.queueName, 'queue');
                    if (queueInstance && queueInstance !== null) {
                        this.logger.debug(":::Creating queue for the trigger event: ", trigger.events.toString());
                        trigger.events.forEach(bucketEvent => {
                            this.logger.debug(aws_s3_notifications_1.SqsDestination, bucketEvent);
                            bucket.addEventNotification(bucketEvent, new aws_s3_notifications_1.SqsDestination(queueInstance));
                        });
                    }
                }
            });
        }
        const cfnDistributionConfig = bucketConfig.cfnDistributionConfig;
        if (cfnDistributionConfig && cfnDistributionConfig.domainName && cfnDistributionConfig.domainName.length > 0) {
            this.logger.debug("Creating bucket domain: ", cfnDistributionConfig.domainName);
            const certificateConstruct = new certificate_1.CertificateConstruct({
                domainName: cfnDistributionConfig.domainName,
                certificateArn: cfnDistributionConfig.certificateArn
            });
            certificateConstruct.construct();
            const certificate = certificateConstruct.output[construct_1.OutputType.CERTIFICATE][cfnDistributionConfig.domainName];
            // create a cloudfront distribution for the bucket
            const cfnDistribution = new aws_cloudfront_1.CloudFrontWebDistribution(this.mainStack, bucketConfig.bucketName + '-distribution', {
                originConfigs: [
                    {
                        s3OriginSource: {
                            s3BucketSource: bucket,
                        },
                        behaviors: [{ isDefaultBehavior: true }],
                    },
                ],
                viewerCertificate: aws_cloudfront_1.ViewerCertificate.fromAcmCertificate(certificate, {
                    aliases: [cfnDistributionConfig.domainName],
                    securityPolicy: aws_cloudfront_1.SecurityPolicyProtocol.TLS_V1_2_2021,
                    sslMethod: aws_cloudfront_1.SSLMethod.SNI,
                }),
            });
            this.fw24.setConstructOutput(this, bucketConfig.bucketName, cfnDistribution, construct_1.OutputType.CLOUDFRONTWEBDISTRIBUTION);
            new aws_cdk_lib_1.CfnOutput(this.mainStack, bucketConfig.bucketName + 'cfnOutput', {
                value: cfnDistribution.distributionDomainName,
            });
        }
        new aws_cdk_lib_1.CfnOutput(this.mainStack, bucketConfig.bucketName + 'Output', {
            value: bucket.bucketName,
        });
    }
}
exports.BucketConstruct = BucketConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], BucketConstruct.prototype, "createBucket", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVja2V0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYnVja2V0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUErQztBQUMvQyw2Q0FBNEM7QUFDNUMsK0NBQXVGO0FBQ3ZGLDJFQUFxRjtBQUNyRixxRUFBeUU7QUFFekUsdURBQXdFO0FBRXhFLDJDQUF3QztBQUN4Qyx1Q0FBb0M7QUFFcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxtQ0FBeUM7QUFFekMsK0RBQTZIO0FBQzdILCtDQUFxRDtBQUVyRCwrQkFBcUM7QUFDckMscUNBQTJDO0FBa0YzQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FtQ0c7QUFDSCxNQUFhLGVBQWU7SUFZSjtJQUF5RDtJQUE0QjtJQVhoRyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxlQUFlLENBQUMsSUFBSSxDQUFDO0lBQ3BDLFlBQVksR0FBYSxDQUFDLGtCQUFZLENBQUMsSUFBSSxFQUFFLHdCQUFlLENBQUMsSUFBSSxFQUFFLHNCQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDeEYsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQWlDO0lBQzFDLFNBQVMsQ0FBUztJQUVsQiw0REFBNEQ7SUFDNUQsWUFBb0IscUJBQStDLEVBQVUsU0FBa0IsRUFBVSxlQUF3QjtRQUE3RywwQkFBcUIsR0FBckIscUJBQXFCLENBQTBCO1FBQVUsY0FBUyxHQUFULFNBQVMsQ0FBUztRQUFVLG9CQUFlLEdBQWYsZUFBZSxDQUFTO1FBQzdILGVBQU0sQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUMsSUFBSSxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVELHVDQUF1QztJQUNoQyxLQUFLLENB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QUFjLEVBQUUsTUFBTTt5QkFDekI7d0JBQ0QsU0FBUyxFQUFFLENBQUMsRUFBRSxpQkFBaUIsRUFBRSxJQUFJLEVBQUUsQ0FBQztxQkFDM0M7aUJBQ0o7Z0JBQ0QsaUJBQWlCLEVBQUUsa0NBQWlCLENBQUMsa0JBQWtCLENBQUMsV0FBVyxFQUFFO29CQUNqRSxPQUFPLEVBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLENBQUM7b0JBQzNDLGNBQWMsRUFBRSx1Q0FBc0IsQ0FBQyxhQUFhO29CQUNwRCxTQUFTLEVBQUUsMEJBQVMsQ0FBQyxHQUFHO2lCQUMzQixDQUFDO2FBRUwsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsWUFBWSxDQUFDLFVBQVUsRUFBRSxlQUFlLEVBQUUsc0JBQVUsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1lBRW5ILElBQUksdUJBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxVQUFVLEdBQUcsV0FBVyxFQUFFO2dCQUNqRSxLQUFLLEVBQUUsZUFBZSxDQUFDLHNCQUFzQjthQUNoRCxDQUFDLENBQUM7UUFFUCxDQUFDO1FBRUQsSUFBSSx1QkFBUyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsWUFBWSxDQUFDLFVBQVUsR0FBRyxRQUFRLEVBQUU7WUFDOUQsS0FBSyxFQUFFLE1BQU0sQ0FBQyxVQUFVO1NBQzNCLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQS9JRCwwQ0ErSUM7QUFuSFc7SUFEUCxJQUFBLHFCQUFXLEdBQUU7bURBbUhiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIENmbk91dHB1dCB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgUmVtb3ZhbFBvbGljeSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEJ1Y2tldCwgQmxvY2tQdWJsaWNBY2Nlc3MsIEV2ZW50VHlwZSwgQnVja2V0UHJvcHMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0IHsgTGFtYmRhRGVzdGluYXRpb24sIFNxc0Rlc3RpbmF0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLW5vdGlmaWNhdGlvbnMnO1xuaW1wb3J0IHsgQnVja2V0RGVwbG95bWVudCwgU291cmNlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuXG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiwgTGFtYmRhRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgSUFwcGxpY2F0aW9uQ29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uZmlnXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBRdWV1ZUNvbnN0cnVjdCB9IGZyb20gXCIuL3F1ZXVlXCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZSwgQ2VydGlmaWNhdGVWYWxpZGF0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXJcIjtcbmltcG9ydCB7IENsb3VkRnJvbnRXZWJEaXN0cmlidXRpb24sIFZpZXdlckNlcnRpZmljYXRlLCBTZWN1cml0eVBvbGljeVByb3RvY29sLCBTU0xNZXRob2QgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnRcIjtcbmltcG9ydCB7IENlcnRpZmljYXRlQ29uc3RydWN0IH0gZnJvbSBcIi4vY2VydGlmaWNhdGVcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcbmltcG9ydCB7IE1haWxlckNvbnN0cnVjdCB9IGZyb20gXCIuL21haWxlclwiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGEgYnVja2V0IGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJQnVja2V0Q29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIG5hbWUgb2YgdGhlIGJ1Y2tldC5cbiAgICAgKi9cbiAgICBidWNrZXROYW1lOiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcmVtb3ZhbCBwb2xpY3kgZm9yIHRoZSBidWNrZXQuXG4gICAgICovXG4gICAgcmVtb3ZhbFBvbGljeT86IGFueTtcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB3aGV0aGVyIHRvIGF1dG9tYXRpY2FsbHkgZGVsZXRlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldCB3aGVuIHRoZSBidWNrZXQgaXMgZGVsZXRlZC5cbiAgICAgKi9cbiAgICBhdXRvRGVsZXRlT2JqZWN0cz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgd2hldGhlciB0aGUgYnVja2V0IGFsbG93cyBwdWJsaWMgcmVhZCBhY2Nlc3MuXG4gICAgICovXG4gICAgcHVibGljUmVhZEFjY2Vzcz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBUaGUgc291cmNlIG9mIHRoZSBidWNrZXQuXG4gICAgICovXG4gICAgc291cmNlPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHRyaWdnZXJzIGZvciB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIHRyaWdnZXJzPzogSVMzVHJpZ2dlckNvbmZpZ1tdO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHByb3BlcnRpZXMgb2YgdGhlIGJ1Y2tldC5cbiAgICAgKi9cbiAgICBidWNrZXRQcm9wcz86IEJ1Y2tldFByb3BzO1xuXG4gICAgLyoqXG4gICAgICogVGhlIENGTiBkaXN0cmlidXRpb24gY29uZmlnIGZvciB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIGNmbkRpc3RyaWJ1dGlvbkNvbmZpZz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBkb21haW4gbmFtZSBmb3IgdGhlIGJ1Y2tldCB0byBzZXR1cCBhIGNsb3VkZnJvbnQgZGlzdHJpYnV0aW9uXG4gICAgICAgICAqL1xuICAgICAgICBkb21haW5OYW1lPzogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIGNlcnRpZmljYXRlQXJuIGZvciB0aGUgZG9tYWluLiBJZiB0aGlzIGlzIG5vdCBwcm92aWRlZCwgYSBuZXcgY2VydGlmaWNhdGUgd2lsbCBiZSBjcmVhdGVkLlxuICAgICAgICAgKi9cbiAgICAgICAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG4gICAgfVxufVxuXG50eXBlIFMzRXZlbnREZXN0aW5hdGlvbiA9ICdsYW1iZGEnIHwgJ3F1ZXVlJztcbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYW4gUzMgdHJpZ2dlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUzNUcmlnZ2VyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZXZlbnRzIHRoYXQgd2lsbCB0cmlnZ2VyIHRoZSBTMyB0cmlnZ2VyLlxuICAgICAqL1xuICAgIGV2ZW50czogRXZlbnRUeXBlW107XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZGVzdGluYXRpb24gZm9yIHRoZSBTMyB0cmlnZ2VyLlxuICAgICAqL1xuICAgIGRlc3RpbmF0aW9uOiBTM0V2ZW50RGVzdGluYXRpb247XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgUzMgdHJpZ2dlci5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTGFtYmRhRnVuY3Rpb25Qcm9wcztcblxuICAgIC8qKlxuICAgICAqIFRoZSBuYW1lIG9mIHRoZSBxdWV1ZSBhc3NvY2lhdGVkIHdpdGggdGhlIFMzIHRyaWdnZXIuXG4gICAgICovXG4gICAgcXVldWVOYW1lPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEZXMjQgQ29uc3RydWN0IHRvIGFkZCBidWNrZXRzIHRvIHlvdXIgYXBwbGljYXRpb24uXG4gKiBcbiAqIEBwYXJhbSBidWNrZXRDb25zdHJ1Y3RDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGJ1Y2tldCBjb25zdHJ1Y3QuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBidWNrZXRDb25maWc6IElCdWNrZXRDb25zdHJ1Y3RDb25maWdbXSA9IFtcbiAqICAge1xuICogICAgIGJ1Y2tldE5hbWU6ICdteS1idWNrZXQnLFxuICogICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICogICAgIGF1dG9EZWxldGVPYmplY3RzOiBmYWxzZSxcbiAqICAgICBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlLFxuICogICAgIGJ1Y2tldFByb3BzOiB7XG4gKiAgICAgICBlbmNyeXB0aW9uOiBCdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAqICAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAqICAgICB9LFxuICogICAgIGRvbWFpbjogJ2ZpbGVzLmV4YW1wbGUuY29tJyxcbiAqICAgICBzb3VyY2U6ICcvcGF0aC90by9zb3VyY2UnLFxuICogICAgIHRyaWdnZXJzOiBbXG4gKiAgICAgICB7XG4gKiAgICAgICAgIGRlc3RpbmF0aW9uOiAnbGFtYmRhJyxcbiAqICAgICAgICAgZXZlbnRzOiBbQnVja2V0RXZlbnQuT0JKRUNUX0NSRUFURURdLFxuICogICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAqICAgICAgICAgICBlbnRyeTogJy9wYXRoL3RvL2xhbWJkYV9mdW5jdGlvbicsXG4gKiAgICAgICAgIH0sXG4gKiAgICAgICB9LFxuICogICAgIF0sXG4gKiAgIH0sXG4gKiBdO1xuICogXG4gKiBjb25zdCBidWNrZXQgPSBuZXcgQnVja2V0Q29uc3RydWN0KGJ1Y2tldENvbmZpZyk7XG4gKiBcbiAqIGFwcC51c2UoYnVja2V0KS5ydW4oKTtcbiAqIFxuICovXG5leHBvcnQgY2xhc3MgQnVja2V0Q29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEJ1Y2tldENvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gQnVja2V0Q29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtWcGNDb25zdHJ1Y3QubmFtZSwgTWFpbGVyQ29uc3RydWN0Lm5hbWUsIFF1ZXVlQ29uc3RydWN0Lm5hbWVdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBhcHBDb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZyB8IHVuZGVmaW5lZDtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgYnVja2V0Q29uc3RydWN0Q29uZmlnOiBJQnVja2V0Q29uc3RydWN0Q29uZmlnW10sIHByaXZhdGUgc3RhY2tOYW1lPzogc3RyaW5nLCBwcml2YXRlIHBhcmVudFN0YWNrTmFtZT86IHN0cmluZykge1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhidWNrZXRDb25zdHJ1Y3RDb25maWcsJ1MzJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gbWFrZSB0aGUgbWFpbiBzdGFjayBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIHRoaXMuYXBwQ29uZmlnID0gdGhpcy5mdzI0LmdldENvbmZpZygpO1xuICAgICAgICAvLyBjcmVhdGUgdGhlIGJ1Y2tldHNcbiAgICAgICAgdGhpcy5idWNrZXRDb25zdHJ1Y3RDb25maWcuZm9yRWFjaCggKCBidWNrZXRDb25maWc6IElCdWNrZXRDb25zdHJ1Y3RDb25maWcgKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhidWNrZXRDb25maWcuc3RhY2tOYW1lIHx8IHRoaXMuc3RhY2tOYW1lLCBidWNrZXRDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlQnVja2V0KGJ1Y2tldENvbmZpZyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHJpdmF0ZSBjcmVhdGVCdWNrZXQoYnVja2V0Q29uZmlnOiBJQnVja2V0Q29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgYnVja2V0OiBcIiwgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUpO1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gdGhpcy5mdzI0LmdldFVuaXF1ZU5hbWUoYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQ3JlYXRpbmcgYnVja2V0IG5hbWU6IFwiLCBidWNrZXROYW1lKTtcbiAgICAgICAgdmFyIGJ1Y2tldFBhcmFtczogYW55ID0ge1xuICAgICAgICAgICAgYnVja2V0TmFtZTogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGJ1Y2tldENvbmZpZy5yZW1vdmFsUG9saWN5IHx8IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBidWNrZXRDb25maWcuYXV0b0RlbGV0ZU9iamVjdHMgfHwgdHJ1ZSxcbiAgICAgICAgfTtcbiAgICAgICAgaWYoYnVja2V0Q29uZmlnLnB1YmxpY1JlYWRBY2Nlc3MgPT09IHRydWUpe1xuICAgICAgICAgICAgYnVja2V0UGFyYW1zLmJsb2NrUHVibGljQWNjZXNzID0gbmV3IEJsb2NrUHVibGljQWNjZXNzKHtcbiAgICAgICAgICAgICAgICBibG9ja1B1YmxpY0FjbHM6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGJsb2NrUHVibGljUG9saWN5OiBmYWxzZSxcbiAgICAgICAgICAgICAgICBpZ25vcmVQdWJsaWNBY2xzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICByZXN0cmljdFB1YmxpY0J1Y2tldHM6IGZhbHNlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYoYnVja2V0Q29uZmlnLmJ1Y2tldFByb3BzKXtcbiAgICAgICAgICAgIGJ1Y2tldFBhcmFtcyA9IHsuLi5idWNrZXRQYXJhbXMsIC4uLmJ1Y2tldENvbmZpZy5idWNrZXRQcm9wc307XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBidWNrZXQgPSBuZXcgQnVja2V0KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICctYnVja2V0JywgYnVja2V0UGFyYW1zKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSwgYnVja2V0LCBPdXRwdXRUeXBlLkJVQ0tFVCk7XG5cbiAgICAgICAgaWYoYnVja2V0Q29uZmlnLnB1YmxpY1JlYWRBY2Nlc3MgPT09IHRydWUpe1xuICAgICAgICAgICAgYnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYnVja2V0Q29uZmlnLnNvdXJjZSAmJiBidWNrZXRDb25maWcuc291cmNlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIG5ldyBCdWNrZXREZXBsb3ltZW50KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICctZGVwbG95bWVudCcsIHtcbiAgICAgICAgICAgICAgICBzb3VyY2VzOiBbU291cmNlLmFzc2V0KGJ1Y2tldENvbmZpZy5zb3VyY2UpXSxcbiAgICAgICAgICAgICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogYnVja2V0LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYnVja2V0Q29uZmlnLnRyaWdnZXJzICYmIGJ1Y2tldENvbmZpZy50cmlnZ2Vycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBidWNrZXRDb25maWcudHJpZ2dlcnMuZm9yRWFjaCh0cmlnZ2VyID0+IHtcblxuICAgICAgICAgICAgICAgIGlmKHRyaWdnZXIuZGVzdGluYXRpb24gPT09ICdsYW1iZGEnICYmIHRyaWdnZXIuZnVuY3Rpb25Qcm9wcykge1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSB0cmlnZ2VyIGV2ZW50XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnN0IGZ1bmN0aW9uUGF0aCA9IHJlc29sdmUodHJpZ2dlci5oYW5kbGVyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSB0cmlnZ2VyIGV2ZW50OiBcIiwgdHJpZ2dlci5ldmVudHMudG9TdHJpbmcoKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uSWQgPSBidWNrZXRDb25maWcuYnVja2V0TmFtZSArIFwiLVwiICsgdHJpZ2dlci5kZXN0aW5hdGlvbiArIFwiLVwiICsgdHJpZ2dlci5ldmVudHMudG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBmdW5jdGlvbklkLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi50cmlnZ2VyLmZ1bmN0aW9uUHJvcHNcbiAgICAgICAgICAgICAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gZ3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBwZXJtaXNzaW9ucyB0byB0aGUgYnVja2V0XG4gICAgICAgICAgICAgICAgICAgIGJ1Y2tldC5ncmFudFJlYWQobGFtYmRhKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBhZGQgZXZlbnQgbm90aWZpY2F0aW9uIHRvIHRoZSBidWNrZXQgZm9yIGVhY2ggZXZlbnRcbiAgICAgICAgICAgICAgICAgICAgLy8gbGlzdCBvZiBldmVudCB0eXBlczogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC91c2VyZ3VpZGUvbm90aWZpY2F0aW9uLWhvdy10by1ldmVudC10eXBlcy1hbmQtZGVzdGluYXRpb25zLmh0bWwjc3VwcG9ydGVkLW5vdGlmaWNhdGlvbi1ldmVudC10eXBlc1xuICAgICAgICAgICAgICAgICAgICB0cmlnZ2VyLmV2ZW50cy5mb3JFYWNoKGJ1Y2tldEV2ZW50ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJ1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihidWNrZXRFdmVudCwgbmV3IExhbWJkYURlc3RpbmF0aW9uKGxhbWJkYSkpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZih0cmlnZ2VyLmRlc3RpbmF0aW9uID09PSAncXVldWUnICYmIHRyaWdnZXIucXVldWVOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGFkZCBldmVudCBub3RpZmljYXRpb24gdG8gdGhlIGJ1Y2tldCBmb3IgZWFjaCBldmVudFxuICAgICAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZUluc3RhbmNlID0gdGhpcy5mdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUodHJpZ2dlci5xdWV1ZU5hbWUsICdxdWV1ZScpO1xuICAgICAgICAgICAgICAgICAgICBpZihxdWV1ZUluc3RhbmNlICYmIHF1ZXVlSW5zdGFuY2UgIT09IG51bGwpe1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCI6OjpDcmVhdGluZyBxdWV1ZSBmb3IgdGhlIHRyaWdnZXIgZXZlbnQ6IFwiLCB0cmlnZ2VyLmV2ZW50cy50b1N0cmluZygpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyaWdnZXIuZXZlbnRzLmZvckVhY2goYnVja2V0RXZlbnQgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFNxc0Rlc3RpbmF0aW9uLGJ1Y2tldEV2ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBidWNrZXQuYWRkRXZlbnROb3RpZmljYXRpb24oYnVja2V0RXZlbnQsIG5ldyBTcXNEZXN0aW5hdGlvbihxdWV1ZUluc3RhbmNlKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBjZm5EaXN0cmlidXRpb25Db25maWcgPSBidWNrZXRDb25maWcuY2ZuRGlzdHJpYnV0aW9uQ29uZmlnO1xuICAgICAgICBpZihjZm5EaXN0cmlidXRpb25Db25maWcgJiYgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUgJiYgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUubGVuZ3RoID4gMCl7XG5cbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgYnVja2V0IGRvbWFpbjogXCIsIGNmbkRpc3RyaWJ1dGlvbkNvbmZpZy5kb21haW5OYW1lKTtcblxuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGVDb25zdHJ1Y3QgPSBuZXcgQ2VydGlmaWNhdGVDb25zdHJ1Y3Qoe1xuICAgICAgICAgICAgICAgIGRvbWFpbk5hbWU6IGNmbkRpc3RyaWJ1dGlvbkNvbmZpZy5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlQXJuOiBjZm5EaXN0cmlidXRpb25Db25maWcuY2VydGlmaWNhdGVBcm5cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgY29uc3QgY2VydGlmaWNhdGUgPSBjZXJ0aWZpY2F0ZUNvbnN0cnVjdC5vdXRwdXRbT3V0cHV0VHlwZS5DRVJUSUZJQ0FURV1bY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWVdO1xuXG4gICAgICAgICAgICAvLyBjcmVhdGUgYSBjbG91ZGZyb250IGRpc3RyaWJ1dGlvbiBmb3IgdGhlIGJ1Y2tldFxuICAgICAgICAgICAgY29uc3QgY2ZuRGlzdHJpYnV0aW9uID0gbmV3IENsb3VkRnJvbnRXZWJEaXN0cmlidXRpb24odGhpcy5tYWluU3RhY2ssIGJ1Y2tldENvbmZpZy5idWNrZXROYW1lICsgJy1kaXN0cmlidXRpb24nLCB7XG4gICAgICAgICAgICAgICAgb3JpZ2luQ29uZmlnczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzM09yaWdpblNvdXJjZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMzQnVja2V0U291cmNlOiBidWNrZXQsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgYmVoYXZpb3JzOiBbeyBpc0RlZmF1bHRCZWhhdmlvcjogdHJ1ZSB9XSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHZpZXdlckNlcnRpZmljYXRlOiBWaWV3ZXJDZXJ0aWZpY2F0ZS5mcm9tQWNtQ2VydGlmaWNhdGUoY2VydGlmaWNhdGUsIHtcbiAgICAgICAgICAgICAgICAgICAgYWxpYXNlczogW2NmbkRpc3RyaWJ1dGlvbkNvbmZpZy5kb21haW5OYW1lXSxcbiAgICAgICAgICAgICAgICAgICAgc2VjdXJpdHlQb2xpY3k6IFNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgICAgICAgICAgICAgc3NsTWV0aG9kOiBTU0xNZXRob2QuU05JLFxuICAgICAgICAgICAgICAgIH0pLFxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUsIGNmbkRpc3RyaWJ1dGlvbiwgT3V0cHV0VHlwZS5DTE9VREZST05UV0VCRElTVFJJQlVUSU9OKTtcblxuICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnY2ZuT3V0cHV0Jywge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBjZm5EaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgIH1cblxuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICdPdXRwdXQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogYnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cbn0gICAiXX0=