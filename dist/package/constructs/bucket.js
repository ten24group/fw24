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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVja2V0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvYnVja2V0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUErQztBQUMvQyw2Q0FBNEM7QUFDNUMsK0NBQXVGO0FBQ3ZGLDJFQUFxRjtBQUNyRixxRUFBeUU7QUFFekUsdURBQXdFO0FBRXhFLDJDQUF3QztBQUN4Qyx1Q0FBb0M7QUFFcEMsdURBQXlGO0FBQ3pGLHdDQUF1RDtBQUN2RCxtQ0FBeUM7QUFFekMsK0RBQTZIO0FBQzdILCtDQUFxRDtBQUVyRCwrQkFBcUM7QUFDckMscUNBQTJDO0FBQzNDLG1DQUF5QztBQWtGekM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUNHO0FBQ0gsTUFBYSxlQUFlO0lBWUo7SUFBeUQ7SUFBNEI7SUFYaEcsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxlQUFlLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUMsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsZUFBZSxDQUFDLElBQUksQ0FBQztJQUNwQyxZQUFZLEdBQWEsQ0FBRSxrQkFBWSxDQUFDLElBQUksRUFBRSx3QkFBZSxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksQ0FBRSxDQUFDO0lBQy9HLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFpQztJQUMxQyxTQUFTLENBQVM7SUFFbEIsNERBQTREO0lBQzVELFlBQW9CLHFCQUErQyxFQUFVLFNBQWtCLEVBQVUsZUFBd0I7UUFBN0csMEJBQXFCLEdBQXJCLHFCQUFxQixDQUEwQjtRQUFVLGNBQVMsR0FBVCxTQUFTLENBQVM7UUFBVSxvQkFBZSxHQUFmLGVBQWUsQ0FBUztRQUM3SCxlQUFNLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLElBQUksQ0FBQyxDQUFDO0lB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RUFBRTtvQkFDWDt3QkFDSSxjQUFjLEVBQUU7NEJBQ1osY0FBYyxFQUFFLE1BQU07eUJBQ3pCO3dCQUNELFNBQVMsRUFBRSxDQUFFLEVBQUUsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLENBQUU7cUJBQzdDO2lCQUNKO2dCQUNELGlCQUFpQixFQUFFLGtDQUFpQixDQUFDLGtCQUFrQixDQUFDLFdBQVcsRUFBRTtvQkFDakUsT0FBTyxFQUFFLENBQUUscUJBQXFCLENBQUMsVUFBVSxDQUFFO29CQUM3QyxjQUFjLEVBQUUsdUNBQXNCLENBQUMsYUFBYTtvQkFDcEQsU0FBUyxFQUFFLDBCQUFTLENBQUMsR0FBRztpQkFDM0IsQ0FBQzthQUVMLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxVQUFVLEVBQUUsZUFBZSxFQUFFLHNCQUFVLENBQUMseUJBQXlCLENBQUMsQ0FBQztZQUVuSCxJQUFJLHVCQUFTLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxZQUFZLENBQUMsVUFBVSxHQUFHLFdBQVcsRUFBRTtnQkFDakUsS0FBSyxFQUFFLGVBQWUsQ0FBQyxzQkFBc0I7YUFDaEQsQ0FBQyxDQUFDO1FBRVAsQ0FBQztRQUVELElBQUksdUJBQVMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFlBQVksQ0FBQyxVQUFVLEdBQUcsUUFBUSxFQUFFO1lBQzlELEtBQUssRUFBRSxNQUFNLENBQUMsVUFBVTtTQUMzQixDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUEvSUQsMENBK0lDO0FBbkhXO0lBRFAsSUFBQSxxQkFBVyxHQUFFO21EQW1IYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBDZm5PdXRwdXQgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFJlbW92YWxQb2xpY3kgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBCdWNrZXQsIEJsb2NrUHVibGljQWNjZXNzLCBFdmVudFR5cGUsIEJ1Y2tldFByb3BzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IExhbWJkYURlc3RpbmF0aW9uLCBTcXNEZXN0aW5hdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1ub3RpZmljYXRpb25zJztcbmltcG9ydCB7IEJ1Y2tldERlcGxveW1lbnQsIFNvdXJjZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcblxuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24sIExhbWJkYUZ1bmN0aW9uUHJvcHMgfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IElBcHBsaWNhdGlvbkNvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbmZpZ1wiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgUXVldWVDb25zdHJ1Y3QgfSBmcm9tIFwiLi9xdWV1ZVwiO1xuaW1wb3J0IHsgQ2VydGlmaWNhdGUsIENlcnRpZmljYXRlVmFsaWRhdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2VydGlmaWNhdGVtYW5hZ2VyXCI7XG5pbXBvcnQgeyBDbG91ZEZyb250V2ViRGlzdHJpYnV0aW9uLCBWaWV3ZXJDZXJ0aWZpY2F0ZSwgU2VjdXJpdHlQb2xpY3lQcm90b2NvbCwgU1NMTWV0aG9kIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCB9IGZyb20gXCIuL2NlcnRpZmljYXRlXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBNYWlsZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9tYWlsZXJcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciBhIGJ1Y2tldCBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUJ1Y2tldENvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBuYW1lIG9mIHRoZSBidWNrZXQuXG4gICAgICovXG4gICAgYnVja2V0TmFtZTogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHJlbW92YWwgcG9saWN5IGZvciB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIHJlbW92YWxQb2xpY3k/OiBhbnk7XG5cbiAgICAvKipcbiAgICAgKiBTcGVjaWZpZXMgd2hldGhlciB0byBhdXRvbWF0aWNhbGx5IGRlbGV0ZSBvYmplY3RzIGluIHRoZSBidWNrZXQgd2hlbiB0aGUgYnVja2V0IGlzIGRlbGV0ZWQuXG4gICAgICovXG4gICAgYXV0b0RlbGV0ZU9iamVjdHM/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogU3BlY2lmaWVzIHdoZXRoZXIgdGhlIGJ1Y2tldCBhbGxvd3MgcHVibGljIHJlYWQgYWNjZXNzLlxuICAgICAqL1xuICAgIHB1YmxpY1JlYWRBY2Nlc3M/OiBib29sZWFuO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHNvdXJjZSBvZiB0aGUgYnVja2V0LlxuICAgICAqL1xuICAgIHNvdXJjZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSB0cmlnZ2VycyBmb3IgdGhlIGJ1Y2tldC5cbiAgICAgKi9cbiAgICB0cmlnZ2Vycz86IElTM1RyaWdnZXJDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIG9mIHRoZSBidWNrZXQuXG4gICAgICovXG4gICAgYnVja2V0UHJvcHM/OiBCdWNrZXRQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFRoZSBDRk4gZGlzdHJpYnV0aW9uIGNvbmZpZyBmb3IgdGhlIGJ1Y2tldC5cbiAgICAgKi9cbiAgICBjZm5EaXN0cmlidXRpb25Db25maWc/OiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZG9tYWluIG5hbWUgZm9yIHRoZSBidWNrZXQgdG8gc2V0dXAgYSBjbG91ZGZyb250IGRpc3RyaWJ1dGlvblxuICAgICAgICAgKi9cbiAgICAgICAgZG9tYWluTmFtZT86IHN0cmluZztcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBjZXJ0aWZpY2F0ZUFybiBmb3IgdGhlIGRvbWFpbi4gSWYgdGhpcyBpcyBub3QgcHJvdmlkZWQsIGEgbmV3IGNlcnRpZmljYXRlIHdpbGwgYmUgY3JlYXRlZC5cbiAgICAgICAgICovXG4gICAgICAgIGNlcnRpZmljYXRlQXJuPzogc3RyaW5nO1xuICAgIH1cbn1cblxudHlwZSBTM0V2ZW50RGVzdGluYXRpb24gPSAnbGFtYmRhJyB8ICdxdWV1ZSc7XG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGFuIFMzIHRyaWdnZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVMzVHJpZ2dlckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIGV2ZW50cyB0aGF0IHdpbGwgdHJpZ2dlciB0aGUgUzMgdHJpZ2dlci5cbiAgICAgKi9cbiAgICBldmVudHM6IEV2ZW50VHlwZVtdO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGRlc3RpbmF0aW9uIGZvciB0aGUgUzMgdHJpZ2dlci5cbiAgICAgKi9cbiAgICBkZXN0aW5hdGlvbjogUzNFdmVudERlc3RpbmF0aW9uO1xuXG4gICAgLyoqXG4gICAgICogT3B0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbiBhc3NvY2lhdGVkIHdpdGggdGhlIFMzIHRyaWdnZXIuXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IExhbWJkYUZ1bmN0aW9uUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgbmFtZSBvZiB0aGUgcXVldWUgYXNzb2NpYXRlZCB3aXRoIHRoZSBTMyB0cmlnZ2VyLlxuICAgICAqL1xuICAgIHF1ZXVlTmFtZT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBGVzI0IENvbnN0cnVjdCB0byBhZGQgYnVja2V0cyB0byB5b3VyIGFwcGxpY2F0aW9uLlxuICogXG4gKiBAcGFyYW0gYnVja2V0Q29uc3RydWN0Q29uZmlnIC0gVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBidWNrZXQgY29uc3RydWN0LlxuICogXG4gKiBAZXhhbXBsZVxuICogY29uc3QgYnVja2V0Q29uZmlnOiBJQnVja2V0Q29uc3RydWN0Q29uZmlnW10gPSBbXG4gKiAgIHtcbiAqICAgICBidWNrZXROYW1lOiAnbXktYnVja2V0JyxcbiAqICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LlJFVEFJTixcbiAqICAgICBhdXRvRGVsZXRlT2JqZWN0czogZmFsc2UsXG4gKiAgICAgcHVibGljUmVhZEFjY2VzczogdHJ1ZSxcbiAqICAgICBidWNrZXRQcm9wczoge1xuICogICAgICAgZW5jcnlwdGlvbjogQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gKiAgICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gKiAgICAgfSxcbiAqICAgICBkb21haW46ICdmaWxlcy5leGFtcGxlLmNvbScsXG4gKiAgICAgc291cmNlOiAnL3BhdGgvdG8vc291cmNlJyxcbiAqICAgICB0cmlnZ2VyczogW1xuICogICAgICAge1xuICogICAgICAgICBkZXN0aW5hdGlvbjogJ2xhbWJkYScsXG4gKiAgICAgICAgIGV2ZW50czogW0J1Y2tldEV2ZW50Lk9CSkVDVF9DUkVBVEVEXSxcbiAqICAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICogICAgICAgICAgIHJ1bnRpbWU6IFJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gKiAgICAgICAgICAgZW50cnk6ICcvcGF0aC90by9sYW1iZGFfZnVuY3Rpb24nLFxuICogICAgICAgICB9LFxuICogICAgICAgfSxcbiAqICAgICBdLFxuICogICB9LFxuICogXTtcbiAqIFxuICogY29uc3QgYnVja2V0ID0gbmV3IEJ1Y2tldENvbnN0cnVjdChidWNrZXRDb25maWcpO1xuICogXG4gKiBhcHAudXNlKGJ1Y2tldCkucnVuKCk7XG4gKiBcbiAqL1xuZXhwb3J0IGNsYXNzIEJ1Y2tldENvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihCdWNrZXRDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWU6IHN0cmluZyA9IEJ1Y2tldENvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbIFZwY0NvbnN0cnVjdC5uYW1lLCBNYWlsZXJDb25zdHJ1Y3QubmFtZSwgUXVldWVDb25zdHJ1Y3QubmFtZSwgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBhcHBDb25maWc6IElBcHBsaWNhdGlvbkNvbmZpZyB8IHVuZGVmaW5lZDtcbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgYnVja2V0Q29uc3RydWN0Q29uZmlnOiBJQnVja2V0Q29uc3RydWN0Q29uZmlnW10sIHByaXZhdGUgc3RhY2tOYW1lPzogc3RyaW5nLCBwcml2YXRlIHBhcmVudFN0YWNrTmFtZT86IHN0cmluZykge1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhidWNrZXRDb25zdHJ1Y3RDb25maWcsICdTMycpO1xuICAgIH1cblxuICAgIC8vIGNvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFja1xuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIG1ha2UgdGhlIG1haW4gc3RhY2sgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICB0aGlzLmFwcENvbmZpZyA9IHRoaXMuZncyNC5nZXRDb25maWcoKTtcbiAgICAgICAgLy8gY3JlYXRlIHRoZSBidWNrZXRzXG4gICAgICAgIHRoaXMuYnVja2V0Q29uc3RydWN0Q29uZmlnLmZvckVhY2goKGJ1Y2tldENvbmZpZzogSUJ1Y2tldENvbnN0cnVjdENvbmZpZykgPT4ge1xuICAgICAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2soYnVja2V0Q29uZmlnLnN0YWNrTmFtZSB8fCB0aGlzLnN0YWNrTmFtZSwgYnVja2V0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSB8fCB0aGlzLnBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgICAgICB0aGlzLmNyZWF0ZUJ1Y2tldChidWNrZXRDb25maWcpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHByaXZhdGUgY3JlYXRlQnVja2V0KGJ1Y2tldENvbmZpZzogSUJ1Y2tldENvbnN0cnVjdENvbmZpZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0aW5nIGJ1Y2tldDogXCIsIGJ1Y2tldENvbmZpZy5idWNrZXROYW1lKTtcbiAgICAgICAgY29uc3QgYnVja2V0TmFtZSA9IHRoaXMuZncyNC5nZXRVbmlxdWVOYW1lKGJ1Y2tldENvbmZpZy5idWNrZXROYW1lKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIkNyZWF0aW5nIGJ1Y2tldCBuYW1lOiBcIiwgYnVja2V0TmFtZSk7XG4gICAgICAgIHZhciBidWNrZXRQYXJhbXM6IGFueSA9IHtcbiAgICAgICAgICAgIGJ1Y2tldE5hbWU6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBidWNrZXRDb25maWcucmVtb3ZhbFBvbGljeSB8fCBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogYnVja2V0Q29uZmlnLmF1dG9EZWxldGVPYmplY3RzIHx8IHRydWUsXG4gICAgICAgIH07XG4gICAgICAgIGlmIChidWNrZXRDb25maWcucHVibGljUmVhZEFjY2VzcyA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgYnVja2V0UGFyYW1zLmJsb2NrUHVibGljQWNjZXNzID0gbmV3IEJsb2NrUHVibGljQWNjZXNzKHtcbiAgICAgICAgICAgICAgICBibG9ja1B1YmxpY0FjbHM6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGJsb2NrUHVibGljUG9saWN5OiBmYWxzZSxcbiAgICAgICAgICAgICAgICBpZ25vcmVQdWJsaWNBY2xzOiBmYWxzZSxcbiAgICAgICAgICAgICAgICByZXN0cmljdFB1YmxpY0J1Y2tldHM6IGZhbHNlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJ1Y2tldENvbmZpZy5idWNrZXRQcm9wcykge1xuICAgICAgICAgICAgYnVja2V0UGFyYW1zID0geyAuLi5idWNrZXRQYXJhbXMsIC4uLmJ1Y2tldENvbmZpZy5idWNrZXRQcm9wcyB9O1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYnVja2V0ID0gbmV3IEJ1Y2tldCh0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnLWJ1Y2tldCcsIGJ1Y2tldFBhcmFtcyk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUsIGJ1Y2tldCwgT3V0cHV0VHlwZS5CVUNLRVQpO1xuXG4gICAgICAgIGlmIChidWNrZXRDb25maWcucHVibGljUmVhZEFjY2VzcyA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgYnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoYnVja2V0Q29uZmlnLnNvdXJjZSAmJiBidWNrZXRDb25maWcuc291cmNlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIG5ldyBCdWNrZXREZXBsb3ltZW50KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICctZGVwbG95bWVudCcsIHtcbiAgICAgICAgICAgICAgICBzb3VyY2VzOiBbIFNvdXJjZS5hc3NldChidWNrZXRDb25maWcuc291cmNlKSBdLFxuICAgICAgICAgICAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBidWNrZXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChidWNrZXRDb25maWcudHJpZ2dlcnMgJiYgYnVja2V0Q29uZmlnLnRyaWdnZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGJ1Y2tldENvbmZpZy50cmlnZ2Vycy5mb3JFYWNoKHRyaWdnZXIgPT4ge1xuXG4gICAgICAgICAgICAgICAgaWYgKHRyaWdnZXIuZGVzdGluYXRpb24gPT09ICdsYW1iZGEnICYmIHRyaWdnZXIuZnVuY3Rpb25Qcm9wcykge1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSB0cmlnZ2VyIGV2ZW50XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnN0IGZ1bmN0aW9uUGF0aCA9IHJlc29sdmUodHJpZ2dlci5oYW5kbGVyKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSB0cmlnZ2VyIGV2ZW50OiBcIiwgdHJpZ2dlci5ldmVudHMudG9TdHJpbmcoKSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uSWQgPSBidWNrZXRDb25maWcuYnVja2V0TmFtZSArIFwiLVwiICsgdHJpZ2dlci5kZXN0aW5hdGlvbiArIFwiLVwiICsgdHJpZ2dlci5ldmVudHMudG9TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBmdW5jdGlvbklkLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi50cmlnZ2VyLmZ1bmN0aW9uUHJvcHNcbiAgICAgICAgICAgICAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gZ3JhbnQgdGhlIGxhbWJkYSBmdW5jdGlvbiBwZXJtaXNzaW9ucyB0byB0aGUgYnVja2V0XG4gICAgICAgICAgICAgICAgICAgIGJ1Y2tldC5ncmFudFJlYWQobGFtYmRhKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBhZGQgZXZlbnQgbm90aWZpY2F0aW9uIHRvIHRoZSBidWNrZXQgZm9yIGVhY2ggZXZlbnRcbiAgICAgICAgICAgICAgICAgICAgLy8gbGlzdCBvZiBldmVudCB0eXBlczogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC91c2VyZ3VpZGUvbm90aWZpY2F0aW9uLWhvdy10by1ldmVudC10eXBlcy1hbmQtZGVzdGluYXRpb25zLmh0bWwjc3VwcG9ydGVkLW5vdGlmaWNhdGlvbi1ldmVudC10eXBlc1xuICAgICAgICAgICAgICAgICAgICB0cmlnZ2VyLmV2ZW50cy5mb3JFYWNoKGJ1Y2tldEV2ZW50ID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJ1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihidWNrZXRFdmVudCwgbmV3IExhbWJkYURlc3RpbmF0aW9uKGxhbWJkYSkpO1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAodHJpZ2dlci5kZXN0aW5hdGlvbiA9PT0gJ3F1ZXVlJyAmJiB0cmlnZ2VyLnF1ZXVlTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBhZGQgZXZlbnQgbm90aWZpY2F0aW9uIHRvIHRoZSBidWNrZXQgZm9yIGVhY2ggZXZlbnRcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcXVldWVJbnN0YW5jZSA9IHRoaXMuZncyNC5nZXRFbnZpcm9ubWVudFZhcmlhYmxlKHRyaWdnZXIucXVldWVOYW1lLCAncXVldWUnKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHF1ZXVlSW5zdGFuY2UgJiYgcXVldWVJbnN0YW5jZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCI6OjpDcmVhdGluZyBxdWV1ZSBmb3IgdGhlIHRyaWdnZXIgZXZlbnQ6IFwiLCB0cmlnZ2VyLmV2ZW50cy50b1N0cmluZygpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyaWdnZXIuZXZlbnRzLmZvckVhY2goYnVja2V0RXZlbnQgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFNxc0Rlc3RpbmF0aW9uLCBidWNrZXRFdmVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnVja2V0LmFkZEV2ZW50Tm90aWZpY2F0aW9uKGJ1Y2tldEV2ZW50LCBuZXcgU3FzRGVzdGluYXRpb24ocXVldWVJbnN0YW5jZSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNmbkRpc3RyaWJ1dGlvbkNvbmZpZyA9IGJ1Y2tldENvbmZpZy5jZm5EaXN0cmlidXRpb25Db25maWc7XG4gICAgICAgIGlmIChjZm5EaXN0cmlidXRpb25Db25maWcgJiYgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUgJiYgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUubGVuZ3RoID4gMCkge1xuXG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkNyZWF0aW5nIGJ1Y2tldCBkb21haW46IFwiLCBjZm5EaXN0cmlidXRpb25Db25maWcuZG9tYWluTmFtZSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlQ29uc3RydWN0ID0gbmV3IENlcnRpZmljYXRlQ29uc3RydWN0KHtcbiAgICAgICAgICAgICAgICBkb21haW5OYW1lOiBjZm5EaXN0cmlidXRpb25Db25maWcuZG9tYWluTmFtZSxcbiAgICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZUFybjogY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmNlcnRpZmljYXRlQXJuXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY2VydGlmaWNhdGVDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0WyBPdXRwdXRUeXBlLkNFUlRJRklDQVRFIF1bIGNmbkRpc3RyaWJ1dGlvbkNvbmZpZy5kb21haW5OYW1lIF07XG5cbiAgICAgICAgICAgIC8vIGNyZWF0ZSBhIGNsb3VkZnJvbnQgZGlzdHJpYnV0aW9uIGZvciB0aGUgYnVja2V0XG4gICAgICAgICAgICBjb25zdCBjZm5EaXN0cmlidXRpb24gPSBuZXcgQ2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbih0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnLWRpc3RyaWJ1dGlvbicsIHtcbiAgICAgICAgICAgICAgICBvcmlnaW5Db25maWdzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHMzT3JpZ2luU291cmNlOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgczNCdWNrZXRTb3VyY2U6IGJ1Y2tldCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWhhdmlvcnM6IFsgeyBpc0RlZmF1bHRCZWhhdmlvcjogdHJ1ZSB9IF0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB2aWV3ZXJDZXJ0aWZpY2F0ZTogVmlld2VyQ2VydGlmaWNhdGUuZnJvbUFjbUNlcnRpZmljYXRlKGNlcnRpZmljYXRlLCB7XG4gICAgICAgICAgICAgICAgICAgIGFsaWFzZXM6IFsgY2ZuRGlzdHJpYnV0aW9uQ29uZmlnLmRvbWFpbk5hbWUgXSxcbiAgICAgICAgICAgICAgICAgICAgc2VjdXJpdHlQb2xpY3k6IFNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgICAgICAgICAgICAgc3NsTWV0aG9kOiBTU0xNZXRob2QuU05JLFxuICAgICAgICAgICAgICAgIH0pLFxuXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUsIGNmbkRpc3RyaWJ1dGlvbiwgT3V0cHV0VHlwZS5DTE9VREZST05UV0VCRElTVFJJQlVUSU9OKTtcblxuICAgICAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLm1haW5TdGFjaywgYnVja2V0Q29uZmlnLmJ1Y2tldE5hbWUgKyAnY2ZuT3V0cHV0Jywge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBjZm5EaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgIH1cblxuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMubWFpblN0YWNrLCBidWNrZXRDb25maWcuYnVja2V0TmFtZSArICdPdXRwdXQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogYnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIH0pO1xuICAgIH1cbn0gICAiXX0=