import { Stack, CfnOutput } from "aws-cdk-lib";
import { RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess, EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination, SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Queue } from "aws-cdk-lib/aws-sqs";
import { resolve } from "path";

import { LambdaFunction } from "../constructs/lambda-function";
import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";

export interface IS3Config {
    bucketName: string;
    removalPolicy?: any;
    autoDeleteObjects?: boolean;
    publicReadAccess?: boolean;
    source?: string;
    triggers?: IS3TriggerConfig[];
}

export interface IS3TriggerConfig {
    events: EventType[];
    destination: string;
    handler?: string;
    queueName?: string;
}

export class S3Stack {
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;
    fw24!: Fw24;

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: IS3Config[]) {
        console.log("s3");
        Helper.hydrateConfig(stackConfig,'S3');
    }

    // construct method to create the stack
    public construct(fw24: Fw24) {
        console.log("s3 construct");
        // make the main stack available to the class
        this.appConfig = fw24.getConfig();
        // get the main stack from the framework
        this.mainStack = fw24.getStack("main");
        // make the fw24 instance available to the class
        this.fw24 = fw24;
        // create the buckets
        this.stackConfig.forEach( ( bucketConfig: IS3Config ) => {
            this.createBucket(bucketConfig);
        });
    }

    private createBucket(bucketConfig: IS3Config) {
        console.log("Creating bucket: ", bucketConfig.bucketName);
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

        const bucket = new Bucket(this.mainStack, bucketConfig.bucketName + '-bucket', bucketParams);

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

                if(trigger.destination === 'lambda' && trigger.handler) {

                    // create lambda function for the trigger event
                    const functionPath = resolve(trigger.handler);
                    console.log("Creating lambda function for the trigger event: ", functionPath);
                    const functionId = bucketConfig.bucketName + "-" + trigger.destination + "-" + trigger.events.toString();
                    const lambda = new LambdaFunction(this.mainStack, functionId, {
                        entry: functionPath
                    }).fn;

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
                    const queueInstance = Queue.fromQueueArn(this.mainStack, trigger.queueName, this.fw24.getQueueArn(trigger.queueName));
                    console.log(":::Creating queue for the trigger event: ", queueInstance);
                    if(queueInstance !== null){
                        trigger.events.forEach(bucketEvent => {
                            console.log(SqsDestination,bucketEvent);
                            //bucket.addEventNotification(bucketEvent, new SqsDestination(queueInstance));
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