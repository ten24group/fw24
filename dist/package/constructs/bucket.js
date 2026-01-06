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
const utils_1 = require("../utils");
const queue_1 = require("./queue");
const aws_cloudfront_1 = require("aws-cdk-lib/aws-cloudfront");
const certificate_1 = require("./certificate");
const vpc_1 = require("./vpc");
const mailer_1 = require("./mailer");
const layer_1 = require("./layer");
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
    dependencies = [vpc_1.VpcConstruct.name, mailer_1.MailerConstruct.name, queue_1.QueueConstruct.name, layer_1.LayerConstruct.name];
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
        const baseParams = {
            bucketName: bucketName,
            removalPolicy: bucketConfig.removalPolicy || aws_cdk_lib_2.RemovalPolicy.DESTROY,
            autoDeleteObjects: bucketConfig.autoDeleteObjects || true,
        };
        if (bucketConfig.publicReadAccess === true) {
            baseParams.blockPublicAccess = new aws_s3_1.BlockPublicAccess({
                blockPublicAcls: false,
                blockPublicPolicy: false,
                ignorePublicAcls: false,
                restrictPublicBuckets: false,
            });
        }
        const bucketParams = bucketConfig.bucketProps
            ? (0, utils_1.merge)([baseParams, bucketConfig.bucketProps])
            : baseParams;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVja2V0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYnVja2V0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUErQztBQUMvQyw2Q0FBNEM7QUFDNUMsK0NBQXVGO0FBQ3ZGLDJFQUFxRjtBQUNyRixxRUFBeUU7QUFFekUsdURBQXdFO0FBRXhFLDJDQUF3QztBQUN4Qyx1Q0FBb0M7QUFFcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxvQ0FBaUM7QUFDakMsbUNBQXlDO0FBRXpDLCtEQUE2SDtBQUM3SCwrQ0FBcUQ7QUFFckQsK0JBQXFDO0FBQ3JDLHFDQUEyQztBQUMzQyxtQ0FBeUM7QUFrRnpDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1DRztBQUNILE1BQWEsZUFBZTtJQVlKO0lBQXlEO0lBQTRCO0lBWGhHLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLGVBQWUsQ0FBQyxJQUFJLENBQUM7SUFDcEMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsd0JBQWUsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUMvRyxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBaUM7SUFDMUMsU0FBUyxDQUFTO0lBRWxCLDREQUE0RDtJQUM1RCxZQUFvQixxQkFBK0MsRUFBVSxTQUFrQixFQUFVLGVBQXdCO1FBQTdHLDBCQUFxQixHQUFyQixxQkFBcUIsQ0FBMEI7UUFBVSxjQUFTLEdBQVQsU0FBUyxDQUFTO1FBQVUsb0JBQWUsR0FBZixlQUFlLENBQVM7UUFDN0gsZUFBTSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxJQUFJ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QUFDLFVBQVUsR0FBRyxlQUFlLEVBQUU7Z0JBQzdHLGFBQWEsRUFBRTtvQkFDWDt3QkFDSSxjQUFjLEVBQUU7NEJBQ1osY0FBYyxFQUFFLE1BQU07eUJBQ3pCO3dCQUNELFNBQVMsRUFBRSxDQUFFLEVBQUUsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLENBQUU7cUJBQzdDO2lCQUNKO2dCQUNELGlCQUFpQixFQUFFLGtDQUFpQixDQUFDLGtCQUFrQixDQUFDLFdBQVcsRUFBRTtvQkFDakUsT0FBTyxFQUFFLENBQUUscUJBQXFCLENBQUMsVUFBVSxDQUFFO29CQUM3QyxjQUFjLEVBQUUsdUNBQXNCLENBQUMsYUFBYTtvQkFDcEQsU0FBUyxFQUFFLDBCQUFTLENBQUMsR0FBRztpQkFDM0IsQ0FBQzthQUVMLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxVQUFVLEVBQUUsZUFBZSxFQUFFLHNCQUFVLENBQUMseUJBQXlCLENBQUMsQ0FBQztZQUVuSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxZQUFZLENBQUMsVUFBVSxHQUFHLFdBQVcsRUFBRTtnQkFDakUsS0FBSyxFQUFFLGVBQWUsQ0FBQyxzQkFBc0I7YUFDaEQsQ0FBQyxDQUFDO1FBRVAsQ0FBQztRQUVELElBQUksdUJBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxVQUFVLEdBQUcsUUFBUSxFQUFFO1lBQzlELEtBQUssRUFBRSxNQUFNLENBQUMsVUFBVTtTQUMzQixDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUFsSkQsMENBa0pDO0FBdEhXO0lBRFAsSUFBQSxxQkFBVyxHQUFFO21EQXNIYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBDZm5PdXRwdXQgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFJlbW92YWxQb2xpY3kgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBCdWNrZXQsIEJsb2NrUHVibGljQWNjZXNzLCBFdmVudFR5cGUsIEJ1Y2tldFByb3BzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IExhbWJkYURlc3RpbmF0aW9uLCBTcXNEZXN0aW5hdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCB7IEJ1Y2tldERlcGxveW1lbnQsIFNvdXJjZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcblxuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24sIExhbWJkYUZ1bmN0aW9uUHJvcHMgfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbmZpZ1wiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tIFwiLi4vdXRpbHNcIjtcbmltcG9ydCB7IFF1ZXVlQ29uc3RydWN0IH0gZnJvbSBcIi4vcXVldWVcIjtcbmltcG9ydCB7IENlcnRpZmljYXRlLCBDZXJ0aWZpY2F0ZVZhbGlkYXRpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlclwiO1xuaW1wb3J0IHsgQ2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbiwgVmlld2VyQ2VydGlmaWNhdGUsIFNlY3VyaXR5UG9saWN5UHJvdG9jb2wsIFNTTE1ldGhvZCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xuaW1wb3J0IHsgQ2VydGlmaWNhdGVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9jZXJ0aWZpY2F0ZVwiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2xheWVyXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYSBidWNrZXQgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElCdWNrZXRDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgbmFtZSBvZiB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIGJ1Y2tldE5hbWU6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSByZW1vdmFsIHBvbGljeSBmb3IgdGhlIGJ1Y2tldC5cbiAgICAgKi9cbiAgICByZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcblxuICAgIC8qKlxuICAgICAqIFNwZWNpZmllcyB3aGV0aGVyIHRvIGF1dG9tYXRpY2FsbHkgZGVsZXRlIG9iamVjdHMgaW4gdGhlIGJ1Y2tldCB3aGVuIHRoZSBidWNrZXQgaXMgZGVsZXRlZC5cbiAgICAgKi9cbiAgICBhdXRvRGVsZXRlT2JqZWN0cz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgd2hldGhlciB0aGUgYnVja2V0IGFsbG93cyBwdWJsaWMgcmVhZCBhY2Nlc3MuXG4gICAgICovXG4gICAgcHVibGljUmVhZEFjY2Vzcz86IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBUaGUgc291cmNlIG9mIHRoZSBidWNrZXQuXG4gICAgICovXG4gICAgc291cmNlPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHRyaWdnZXJzIGZvciB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIHRyaWdnZXJzPzogSVMzVHJpZ2dlckNvbmZpZ1tdO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHByb3BlcnRpZXMgb2YgdGhlIGJ1Y2tldC5cbiAgICAgKi9cbiAgICBidWNrZXRQcm9wcz86IEJ1Y2tldFByb3BzO1xuXG4gICAgLyoqXG4gICAgICogVGhlIENGTiBkaXN0cmlidXRpb24gY29uZmlnIGZvciB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIGNmbkRpc3RyaWJ1dGlvbkNvbmZpZz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBkb21haW4gbmFtZSBmb3IgdGhlIGJ1Y2tldCB0byBzZXR1cCBhIGNsb3VkZnJvbnQgZGlzdHJpYnV0aW9uXG4gICAgICAgICAqL1xuICAgICAgICBkb21haW5OYW1lPzogc3RyaW5nO1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIGNlcnRpZmljYXRlQXJuIGZvciB0aGUgZG9tYWluLiBJZiB0aGlzIGlzIG5vdCBwcm92aWRlZCwgYSBuZXcgY2VydGlmaWNhdGUgd2lsbCBiZSBjcmVhdGVkLlxuICAgICAgICAgKi9cbiAgICAgICAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG4gICAgfVxufVxuXG50eXBlIFMzRXZlbnREZXN0aW5hdGlvbiA9ICdsYW1iZGEnIHwgJ3F1ZXVlJztcbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYW4gUzMgdHJpZ2dlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUzNUcmlnZ2VyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZXZlbnRzIHRoYXQgd2lsbCB0cmlnZ2VyIHRoZSBTMyB0cmlnZ2VyLlxuICAgICAqL1xuICAgIGV2ZW50czogRXZlbnRUeXBlW107XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZGVzdGluYXRpb24gZm9yIHRoZSBTMyB0cmlnZ2VyLlxuICAgICAqL1xuICAgIGRlc3RpbmF0aW9uOiBTM0V2ZW50RGVzdGluYXRpb247XG5cbiAgICAvKipcbiAgICAgKiBPcHRpb25hbCBwcm9wZXJ0aWVzIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGFzc29jaWF0ZWQgd2l0aCB0aGUgUzMgdHJpZ2dlci5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTGFtYmRhRnVuY3Rpb25Qcm9wcztcblxuICAgIC8qKlxuICAgICAqIFRoZSBuYW1lIG9mIHRoZSBxdWV1ZSBhc3NvY2lhdGVkIHdpdGggdGhlIFMzIHRyaWdnZXIuXG4gICAgICovXG4gICAgcXVldWVOYW1lPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEZXMjQgQ29uc3RydWN0IHRvIGFkZCBidWNrZXRzIHRvIHlvdXIgYXBwbGljYXRpb24uXG4gKiBcbiAqIEBwYXJhbSBidWNrZXRDb25zdHJ1Y3RDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIGJ1Y2tldCBjb25zdHJ1Y3QuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBjb25zdCBidWNrZXRDb25maWc6IElCdWNrZXRDb25zdHJ1Y3RDb25maWdbXSA9IFtcbiAqICAge1xuICogICAgIGJ1Y2tldE5hbWU6ICdteS1idWNrZXQnLFxuICogICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICogICAgIGF1dG9EZWxldGVPYmplY3RzOiBmYWxzZSxcbiAqICAgICBwdWJsaWNSZWFkQWNjZXNzOiB0cnVlLFxuICogICAgIGJ1Y2tldFByb3BzOiB7XG4gKiAgICAgICBlbmNyeXB0aW9uOiBCdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAqICAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAqICAgICB9LFxuICogICAgIGRvbWFpbjogJ2ZpbGVzLmV4YW1wbGUuY29tJyxcbiAqICAgICBzb3VyY2U6ICcvcGF0aC90by9zb3VyY2UnLFxuICogICAgIHRyaWdnZXJzOiBbXG4gKiAgICAgICB7XG4gKiAgICAgICAgIGRlc3RpbmF0aW9uOiAnbGFtYmRhJyxcbiAqICAgICAgICAgZXZlbnRzOiBbQnVja2V0RXZlbnQuT0JKRUNUX0NSRUFURURdLFxuICogICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgICAgICAgcnVudGltZTogUnVudGltZS5OT0RFSlNfMjJfWCxcbiAqICAgICAgICAgICBlbnRyeTogJy9wYXRoL3RvL2xhbWJkYV9mdW5jdGlvbicsXG4gKiAgICAgICAgIH0sXG4gKiAgICAgICB9LFxuICogICAgIF0sXG4gKiAgIH0sXG4gKiBdO1xuICogXG4gKiBjb25zdCBidWNrZXQgPSBuZXcgQnVja2V0Q29uc3RydWN0KGJ1Y2tldENvbmZpZyk7XG4gKiBcbiAqIGFwcC51c2UoYnVja2V0KS5ydW4oKTtcbiAqIFxuICovXG5leHBvcnQgY2xhc3MgQnVja2V0Q29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEJ1Y2tldENvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gQnVja2V0Q29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIE1haWxlckNvbnN0cnVjdC5uYW1lLCBRdWV1ZUNvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lIF07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIGFwcENvbmZpZzogSUFwcGxpY2F0aW9uQ29uZmlnIHwgdW5kZWZpbmVkO1xuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLy8gZGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBidWNrZXRDb25zdHJ1Y3RDb25maWc6IElCdWNrZXRDb25zdHJ1Y3RDb25maWdbXSwgcHJpdmF0ZSBzdGFja05hbWU/OiBzdHJpbmcsIHByaXZhdGUgcGFyZW50U3RhY2tOYW1lPzogc3RyaW5nKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGJ1Y2tldENvbnN0cnVjdENvbmZpZywgJ1MzJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gbWFrZSB0aGUgbWFpbiBzdGFjayBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIHRoaXMuYXBwQ29uZmlnID0gdGhpcy5mdzI0LmdldENvbmZpZygpO1xuICAgICAgICAvLyBjcmVhdGUgdGhlIGJ1Y2tldHNcbiAgICAgICAgdGhpcy5idWNrZXRDb25zdHJ1Y3RDb25maWcuZm9yRWFjaCgoYnVja2V0Q29uZmlnOiBJQnVja2V0Q29uc3RydWN0Q29uZmlnKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayhidWNrZXRDb25maWcuc3RhY2tOYW1lIHx8IHRoaXMuc3RhY2tOYW1lLCBidWNrZXRDb25maWcucGFyZW50U3RhY2tOYW1lIHx8IHRoaXMucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlQnVja2V0KGJ1Y2tldENvbmZpZyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHJpdmF0ZSBjcmVhdGVCdWNrZXQoYnVja2V0Q29uZmlnOiBJQnVja2V0Q29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgYnVja2V0OiBcIiwgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUpO1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gdGhpcy5mdzI0LmdldFVuaXF1ZU5hbWUoYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUpO1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiQ3JlYXRpbmcgYnVja2V0IG5hbWU6IFwiLCBidWNrZXROYW1lKTtcblxuICAgICAgICBjb25zdCBiYXNlUGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICAgICAgYnVja2V0TmFtZTogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGJ1Y2tldENvbmZpZy5yZW1vdmFsUG9saWN5IHx8IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBidWNrZXRDb25maWcuYXV0b0RlbGV0ZU9iamVjdHMgfHwgdHJ1ZSxcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoYnVja2V0Q29uZmlnLnB1YmxpY1JlYWRBY2Nlc3MgPT09IHRydWUpIHtcbiAgICAgICAgICAgIGJhc2VQYXJhbXMuYmxvY2tQdWJsaWNBY2Nlc3MgPSBuZXcgQmxvY2tQdWJsaWNBY2Nlc3Moe1xuICAgICAgICAgICAgICAgIGJsb2NrUHVibGljQWNsczogZmFsc2UsXG4gICAgICAgICAgICAgICAgYmxvY2tQdWJsaWNQb2xpY3k6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGlnbm9yZVB1YmxpY0FjbHM6IGZhbHNlLFxuICAgICAgICAgICAgICAgIHJlc3RyaWN0UHVibGljQnVja2V0czogZmFsc2UsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGJ1Y2tldFBhcmFtczogQnVja2V0UHJvcHMgPSBidWNrZXRDb25maWcuYnVja2V0UHJvcHNcbiAgICAgICAgICAgID8gbWVyZ2UoWyBiYXNlUGFyYW1zLCBidWNrZXRDb25maWcuYnVja2V0UHJvcHMgXSkhXG4gICAgICAgICAgICA6IGJhc2VQYXJhbXM7XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbmV3IEJ1Y2tldCh0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnLWJ1Y2tldCcsIGJ1Y2tldFBhcmFtcyk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUsIGJ1Y2tldCwgT3V0cHV0VHlwZS5CVUNLRVQpO1xuXG4gICAgICAgIGlmIChidWNrZXRDb25maWcucHVibGljUmVhZEFjY2VzcyA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgYnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYnVja2V0Q29uZmlnLnNvdXJjZSAmJiBidWNrZXRDb25maWcuc291cmNlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIG5ldyBCdWNrZXREZXBsb3ltZW50KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICctZGVwbG95bWVudCcsIHtcbiAgICAgICAgICAgICAgICBzb3VyY2VzOiBbIFNvdXJjZS5hc3NldChidWNrZXRDb25maWcuc291cmNlKSBdLFxuICAgICAgICAgICAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBidWNrZXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChidWNrZXRDb25maWcudHJpZ2dlcnMgJiYgYnVja2V0Q29uZmlnLnRyaWdnZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGJ1Y2tldENvbmZpZy50cmlnZ2Vycy5mb3JFYWNoKHRyaWdnZXIgPT4ge1xuXG4gICAgICAgICAgICAgICAgaWYgKHRyaWdnZXIuZGVzdGluYXRpb24gPT09ICdsYW1iZGEnICYmIHRyaWdnZXIuZnVuY3Rpb25Qcm9wcykge1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSB0cmlnZ2VyIGV2ZW50XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnN0IGZ1bmN0aW9uUGF0aCA9IHJlc29sdmUodHJpZ2dlci5oYW5kbGVyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSB0cmlnZ2VyIGV2ZW50OiBcIiwgdHJpZ2dlci5ldmVudHMudG9TdHJpbmcoKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uSWQgPSBidWNrZXRDb25maWcuYnVja2V0TmFtZSArIFwiLVwiICsgdHJpZ2dlci5kZXN0aW5hdGlvbiArIFwiLVwiICsgdHJpZ2dlci5ldmVudHMudG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBmdW5jdGlvbklkLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi50cmlnZ2VyLmZ1bmN0aW9uUHJvcHNcbiAgICAgICAgICAgICAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gZ3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBwZXJtaXNzaW9ucyB0byB0aGUgYnVja2V0XG4gICAgICAgICAgICAgICAgICAgIGJ1Y2tldC5ncmFudFJlYWQobGFtYmRhKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBhZGQgZXZlbnQgbm90aWZpY2F0aW9uIHRvIHRoZSBidWNrZXQgZm9yIGVhY2ggZXZlbnRcbiAgICAgICAgICAgICAgICAgICAgLy8gbGlzdCBvZiBldmVudCB0eXBlczogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC91c2VyZ3VpZGUvbm90aWZpY2F0aW9uLWhvdy10by1ldmVudC10eXBlcy1hbmQtZGVzdGluYXRpb25zLmh0bWwjc3VwcG9ydGVkLW5vdGlmaWNhdGlvbi1ldmVudC10eXBlc1xuICAgICAgICAgICAgICAgICAgICB0cmlnZ2VyLmV2ZW50cy5mb3JFYWNoKGJ1Y2tldEV2ZW50ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJ1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihidWNrZXRFdmVudCwgbmV3IExhbWJkYURlc3RpbmF0aW9uKGxhbWJkYSkpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAodHJpZ2dlci5kZXN0aW5hdGlvbiA9PT0gJ3F1ZXVlJyAmJiB0cmlnZ2VyLnF1ZXVlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBhZGQgZXZlbnQgbm90aWZpY2F0aW9uIHRvIHRoZSBidWNrZXQgZm9yIGVhY2ggZXZlbnRcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcXVldWVJbnN0YW5jZSA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRyaWdnZXIucXVldWVOYW1lLCAncXVldWUnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHF1ZXVlSW5zdGFuY2UgJiYgcXVldWVJbnN0YW5jZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCI6OjpDcmVhdGluZyBxdWV1ZSBmb3IgdGhlIHRyaWdnZXIgZXZlbnQ6IFwiLCB0cmlnZ2VyLmV2ZW50cy50b1N0cmluZygpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyaWdnZXIuZXZlbnRzLmZvckVhY2goYnVja2V0RXZlbnQgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFNxc0Rlc3RpbmF0aW9uLCBidWNrZXRFdmVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKGJ1Y2tldEV2ZW50LCBuZXcgU3FzRGVzdGluYXRpb24ocXVldWVJbnN0YW5jZSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNmbkRpc3RyaWJ1dGlvbkNvbmZpZyA9IGJ1Y2tldENvbmZpZy5jZm5EaXN0cmlidXRpb25Db25maWc7XG4gICAgICAgIGlmIChjZm5EaXN0cmlidXRpb25Db25maWcgJiYgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUgJiYgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0aW5nIGJ1Y2tldCBkb21haW46IFwiLCBjZm5EaXN0cmlidXRpb25Db25maWcuZG9tYWluTmFtZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlQ29uc3RydWN0ID0gbmV3IENlcnRpZmljYXRlQ29uc3RydWN0KHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiBjZm5EaXN0cmlidXRpb25Db25maWcuZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZUFybjogY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmNlcnRpZmljYXRlQXJuXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY2VydGlmaWNhdGVDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0WyBPdXRwdXRUeXBlLkNFUlRJRklDQVRFIF1bIGNmbkRpc3RyaWJ1dGlvbkNvbmZpZy5kb21haW5OYW1lIF07XG5cbiAgICAgICAgICAgIC8vIGNyZWF0ZSBhIGNsb3VkZnJvbnQgZGlzdHJpYnV0aW9uIGZvciB0aGUgYnVja2V0XG4gICAgICAgICAgICBjb25zdCBjZm5EaXN0cmlidXRpb24gPSBuZXcgQ2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbih0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnLWRpc3RyaWJ1dGlvbicsIHtcbiAgICAgICAgICAgICAgICBvcmlnaW5Db25maWdzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHMzT3JpZ2luU291cmNlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgczNCdWNrZXRTb3VyY2U6IGJ1Y2tldCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWhhdmlvcnM6IFsgeyBpc0RlZmF1bHRCZWhhdmlvcjogdHJ1ZSB9IF0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB2aWV3ZXJDZXJ0aWZpY2F0ZTogVmlld2VyQ2VydGlmaWNhdGUuZnJvbUFjbUNlcnRpZmljYXRlKGNlcnRpZmljYXRlLCB7XG4gICAgICAgICAgICAgICAgICAgIGFsaWFzZXM6IFsgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUgXSxcbiAgICAgICAgICAgICAgICAgICAgc2VjdXJpdHlQb2xpY3k6IFNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgICAgICAgICAgICAgc3NsTWV0aG9kOiBTU0xNZXRob2QuU05JLFxuICAgICAgICAgICAgICAgIH0pLFxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUsIGNmbkRpc3RyaWJ1dGlvbiwgT3V0cHV0VHlwZS5DTE9VREZST05UV0VCRElTVFJJQlVUSU9OKTtcblxuICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnY2ZuT3V0cHV0Jywge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBjZm5EaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH1cblxuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICdPdXRwdXQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogYnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cbn0gICAiXX0=