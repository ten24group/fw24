import { Stack } from "aws-cdk-lib";
import { EventType, BucketProps } from 'aws-cdk-lib/aws-s3';
import { LambdaFunctionProps } from "./lambda-function";
import { IApplicationConfig } from "../interfaces/config";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration for a bucket construct.
 */
export interface IBucketConstructConfig extends IConstructConfig {
    /**
     * The name of the bucket.
     */
    bucketName: string;
    /**
     * The removal policy for the bucket.
     */
    removalPolicy?: any;
    /**
     * Specifies whether to automatically delete objects in the bucket when the bucket is deleted.
     */
    autoDeleteObjects?: boolean;
    /**
     * Specifies whether the bucket allows public read access.
     */
    publicReadAccess?: boolean;
    /**
     * The source of the bucket.
     */
    source?: string;
    /**
     * The triggers for the bucket.
     */
    triggers?: IS3TriggerConfig[];
    /**
     * The properties of the bucket.
     */
    bucketProps?: BucketProps;
    /**
     * The CFN distribution config for the bucket.
     */
    cfnDistributionConfig?: {
        /**
         * The domain name for the bucket to setup a cloudfront distribution
         */
        domainName?: string;
        /**
         * The certificateArn for the domain. If this is not provided, a new certificate will be created.
         */
        certificateArn?: string;
    };
}
type S3EventDestination = 'lambda' | 'queue';
/**
 * Represents the configuration for an S3 trigger.
 */
export interface IS3TriggerConfig {
    /**
     * The events that will trigger the S3 trigger.
     */
    events: EventType[];
    /**
     * The destination for the S3 trigger.
     */
    destination: S3EventDestination;
    /**
     * Optional properties for the Lambda function associated with the S3 trigger.
     */
    functionProps?: LambdaFunctionProps;
    /**
     * The name of the queue associated with the S3 trigger.
     */
    queueName?: string;
}
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
export declare class BucketConstruct implements FW24Construct {
    private bucketConstructConfig;
    private stackName?;
    private parentStackName?;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    appConfig: IApplicationConfig | undefined;
    mainStack: Stack;
    constructor(bucketConstructConfig: IBucketConstructConfig[], stackName?: string | undefined, parentStackName?: string | undefined);
    construct(): Promise<void>;
    private createBucket;
}
export {};
