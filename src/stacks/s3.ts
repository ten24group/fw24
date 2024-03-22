import { Stack, CfnOutput } from "aws-cdk-lib";
import { RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination, SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { resolve } from "path";

import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";
import { IS3Config } from "../interfaces/s3";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";

export class S3Stack {
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    constructor(private config: IS3Config[]) {
        console.log("s3", config);
        Helper.hydrateConfig(config,'s3');

    }

    public construct(appConfig: IApplicationConfig) {
        console.log("s3 construct", appConfig, this.config);
        this.appConfig = appConfig;

        console.log("Creating s3 buckets: ");

        this.mainStack = Reflect.get(globalThis, "mainStack");

        this.createBuckets();

    }

    private createBuckets() {
        
        this.config.forEach( ( bucketConfig: IS3Config ) => {
            this.createBucket(bucketConfig);
        });
    }

    private createBucket(bucketConfig: IS3Config) {
        console.log("Creating bucket: ", bucketConfig.bucketName);
        const bucketName = this.getUniqueName(bucketConfig.bucketName);
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
                    const lambda = new NodejsFunction(this.mainStack, functionId, {
                        entry: functionPath,
                        handler: 'handler',
                        runtime: Runtime.NODEJS_18_X,
                        architecture: Architecture.ARM_64
                    });

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
                    // const queueArn = `arn:aws:sqs:${this.appConfig?.region}:${this.mainStack.account}:${trigger.queueName}`
                    // const queueInstance = Queue.fromQueueArn(this.mainStack, trigger.queueName, queueArn);
                    const queueInstance: Queue = Reflect.get(globalThis, trigger.queueName+"-queue");
                    console.log(":::Creating queue for the trigger event: ", queueInstance);

                    if(queueInstance !== undefined){                        
                        queueInstance.addToResourcePolicy(
                            new PolicyStatement({
                                effect: Effect.ALLOW,
                                actions: ["sqs:SendMessage"],
                                resources: [queueInstance.queueArn],
                                principals: [new ServicePrincipal("s3.amazonaws.com")],
                                conditions: {
                                    ArnLike: {
                                        "aws:SourceArn": bucket.bucketArn
                                    }
                                }
                            })
                        );
    
                        trigger.events.forEach(bucketEvent => {
                            console.log(SqsDestination,bucketEvent);
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
    

    // move to fw24 context
    public getUniqueName(name: string) {
        return `${name}-${this.appConfig?.name}-${this.appConfig?.env}-${this.mainStack.account}`;
    }


}   