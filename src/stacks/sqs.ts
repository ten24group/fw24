import { Duration, Stack, CfnOutput } from "aws-cdk-lib";
import Mutable from "../types/mutable";
import { readdirSync } from "fs";
import { resolve, join } from "path";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";

import QueueDescriptor from "../interfaces/queue-descriptor";
import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";
import { ISQSConfig } from "../interfaces/sqs";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { IQLambdaEnvConfig } from "../fw24";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";


export class SQS {
    //public queueURL!: Queue.QueueUrl;
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    constructor(private config: ISQSConfig) {
        console.log("SQS", config);
        Helper.hydrateConfig(config,'SQS');

        if (!this.config.queues || this.config.queues.length === 0) {
            this.config.queues = "./src/queues";
        }

    }

    public construct(appConfig: IApplicationConfig) {
        console.log("SQS construct", appConfig, this.config);
        this.appConfig = appConfig;

        if (!this.config.queues || this.config.queues.length === 0) {
            throw new Error("No queues defined");
        }

        const paramsApi: Mutable<QueueProps> = this.config.queueOptions || {};
        
        console.log("Creating SQS... paramsApi: ", paramsApi);

        this.mainStack = Reflect.get(globalThis, "mainStack");
        
        this.registerQueues();

    }

    private getLayerARN(): string {
        return `arn:aws:lambda:${this.appConfig?.region}:${this.mainStack.account}:layer:Fw24CoreLayer:${this.appConfig?.coreVersion}`;
    }

    private registerQueue(queueInfo: QueueDescriptor) {
        queueInfo.queueInstance = new queueInfo.queueClass();
        console.log(":::Queue instance: ", queueInfo.queueInstance);
        const queueName = queueInfo.queueInstance.queueName;
        const queueConfig = queueInfo.queueInstance?.queueConfig;

        console.log(`:::Registering queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);

        // create the queue
        const queue = new Queue(this.mainStack, queueName + "-queue", {
            queueName: queueName,
          });

        // create lambda function for the queue
        const queueFunction = new NodejsFunction(this.mainStack, queueName + "-consumer", {
            entry: queueInfo.filePath + "/" + queueInfo.fileName,
            handler: "handler",
            runtime: Runtime.NODEJS_18_X, // define from queue decorator
            architecture: Architecture.ARM_64, // define from queue decorator
            layers: [LayerVersion.fromLayerVersionArn(this.mainStack, queueName + "-Fw24CoreLayer", this.getLayerARN())],
            timeout: Duration.seconds(5), // define from queue decorator
            memorySize: 128, // define from queue decorator
            // lambda IAM role
            bundling: {
                sourceMap: true,
                externalModules: ["aws-sdk", "fw24"], // review fw24-core
            },
        });

        // add environment variables from queue config
        queueConfig?.env?.forEach( ( lambdaEnv: IQLambdaEnvConfig ) => {
            if (lambdaEnv.path === "globalThis") {
                queueFunction.addEnvironment(lambdaEnv.name, Reflect.get(globalThis, lambdaEnv.name));
            }
        });

        // add dynanoDB support
        if (queueConfig?.tableName) {
            console.log("🚀 ~ Queue ~ registerQueue ~ if:", queueConfig);

            const diRegisteredTableName = `${queueConfig.tableName}_table`;
            const tableInstance: TableV2 = Reflect.get(globalThis, diRegisteredTableName);

            queueFunction.addEnvironment(diRegisteredTableName.toUpperCase(), tableInstance.tableName);
            console.log("🚀 ~ Queue ~ registerQueue ~ queueFunction.env:", queueFunction.env);

            tableInstance.grantReadWriteData(queueFunction);
        }


        // add event source for the queue
        queueFunction.addEventSource(new SqsEventSource(queue));
        queue.grantConsumeMessages(queueFunction);

        // subscribe the queue to SNS topic
        queueConfig?.sns?.forEach( ( topicName: string ) => {
            const topicArn = `arn:aws:sns:${this.appConfig?.region}:${this.mainStack.account}:${topicName}`;
            const topicInstance = Topic.fromTopicArn(this.mainStack, topicName, topicArn);
            // TODO: add ability to filter messages
            topicInstance.addSubscription(new SqsSubscription(queue));
        });

        Reflect.set(globalThis, queueName + "-queue", queue);
        // output the api endpoint
        new CfnOutput(this.mainStack, `SQS-${queueName}`, {
            value: queue.queueUrl,
            description: "Queue URL for " + queueName,
        });
        
    }

    private async registerQueues() {
        console.log("Registering queues...");
        const queuesConfig = this.config.queues || [];
        console.log("Queues config: ", queuesConfig);

        if (typeof queuesConfig === "string") {
            // Resolve the absolute path
            const queuesDirectory = resolve(queuesConfig);
            // Get all the files in the queues directory
            const queueFiles = readdirSync(queuesDirectory);
            // Filter the files to only include TypeScript files
            const queuePaths = queueFiles.filter((file) => file.endsWith(".ts"));

            for (const queuePath of queuePaths) {
                try {
                    // Dynamically import the queue file
                    const module = await import(join(queuesDirectory, queuePath));

                    // Find and instantiate queue classes
                    for (const exportedItem of Object.values(module)) {
                        if (typeof exportedItem === "function") {
                            const queueInfo: QueueDescriptor = {
                                queueClass: exportedItem,
                                fileName: queuePath,
                                filePath: queuesDirectory,
                            };
                            this.registerQueue(queueInfo);
                            break;
                        }
                    }
                } catch (err) {
                    console.error(err);
                }
            }
        } else if (Array.isArray(queuesConfig)) {
            for (const queue of queuesConfig) {
                try {
                    this.registerQueue(queue);
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }
}