import { Stack, CfnOutput } from "aws-cdk-lib";
import { RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess, EventType, BucketProps } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination, SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';

import { LambdaFunction, LambdaFunctionProps } from "./lambda-function";
import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { FW24Construct, FW24ConstructOutout, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";
import { QueueConstruct } from "./queue";

export interface IBucketConstructConfig {
    bucketName: string;
    removalPolicy?: any;
    autoDeleteObjects?: boolean;
    publicReadAccess?: boolean;
    source?: string;
    triggers?: IS3TriggerConfig[];
    bucketProps?: BucketProps
}

type S3EventDestination = 'lambda' | 'queue';
export interface IS3TriggerConfig {
    events: EventType[];
    destination: S3EventDestination;
    functionProps?: LambdaFunctionProps;
    queueName?: string;
}

export class BucketConstruct implements FW24Construct {
    readonly logger = createLogger(BucketConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = BucketConstruct.name;
    dependencies: string[] = [QueueConstruct.name];
    output!: FW24ConstructOutout;

    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private bucketConstructConfig: IBucketConstructConfig[]) {
        Helper.hydrateConfig(bucketConstructConfig,'S3');
    }

    // construct method to create the stack
    public async construct() {
        // make the main stack available to the class
        this.appConfig = this.fw24.getConfig();
        // get the main stack from the framework
        this.mainStack = this.fw24.getStack("main");
        // create the buckets
        this.bucketConstructConfig.forEach( ( bucketConfig: IBucketConstructConfig ) => {
            this.createBucket(bucketConfig);
        });
    }

    @LogDuration()
    private createBucket(bucketConfig: IBucketConstructConfig) {
        this.logger.debug("Creating bucket: ", bucketConfig.bucketName);
        const bucketName = this.fw24.getUniqueName(bucketConfig.bucketName);
        var bucketParams: any = {
            bucketName: bucketName,
            removalPolicy: bucketConfig.removalPolicy || RemovalPolicy.DESTROY,
            autoDeleteObjects: bucketConfig.autoDeleteObjects || true,
        };
        if(bucketConfig.publicReadAccess === true){
            bucketParams.blockPublicAccess = new BlockPublicAccess({
                blockPublicAcls: false,
                blockPublicPolicy: false,
                ignorePublicAcls: false,
                restrictPublicBuckets: false,
            });
        }
        if(bucketConfig.bucketProps){
            bucketParams = {...bucketParams, ...bucketConfig.bucketProps};
        }

        const bucket = new Bucket(this.mainStack, bucketConfig.bucketName + '-bucket', bucketParams);
        this.fw24.setConstructOutput(this, OutputType.BUCKET, bucketConfig.bucketName, bucket);

        if(bucketConfig.publicReadAccess === true){
            bucket.grantPublicAccess();
        }

        if (bucketConfig.source && bucketConfig.source.length > 0) {
            new BucketDeployment(this.mainStack, bucketConfig.bucketName + '-deployment', {
                sources: [Source.asset(bucketConfig.source)],
                destinationBucket: bucket,
            });
        }

        if (bucketConfig.triggers && bucketConfig.triggers.length > 0) {
            bucketConfig.triggers.forEach(trigger => {

                if(trigger.destination === 'lambda' && trigger.functionProps) {

                    // create lambda function for the trigger event
                    // const functionPath = resolve(trigger.handler);
                    this.logger.debug("Creating lambda function for the trigger event: ", trigger.events.toString());
                    const functionId = bucketConfig.bucketName + "-" + trigger.destination + "-" + trigger.events.toString();
                    const lambda = new LambdaFunction(this.mainStack, functionId, {
                        ...trigger.functionProps
                    }) as NodejsFunction;

                    // grant the lambda function permissions to the bucket
                    bucket.grantRead(lambda);

                    // add event notification to the bucket for each event
                    // list of event types: https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html#supported-notification-event-types
                    trigger.events.forEach(bucketEvent => {
                        bucket.addEventNotification(bucketEvent, new LambdaDestination(lambda));
                    });
                }

                if(trigger.destination === 'queue' && trigger.queueName) {
                    // add event notification to the bucket for each event
                    const queueId = bucketConfig.bucketName + "-" + trigger.destination + "-" + trigger.queueName;
                    const queueInstance = this.fw24.get(trigger.queueName, 'queue');
                    if(queueInstance && queueInstance !== null){
                        this.logger.debug(":::Creating queue for the trigger event: ", trigger.events.toString());
                        trigger.events.forEach(bucketEvent => {
                            this.logger.debug(SqsDestination,bucketEvent);
                            bucket.addEventNotification(bucketEvent, new SqsDestination(queueInstance));
                        });
                    }
                }
            });
        }
        
        new CfnOutput(this.mainStack, bucketConfig.bucketName + 'Output', {
            value: bucket.bucketName,
        });
    }
}   