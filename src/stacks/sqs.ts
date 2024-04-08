import { Stack, CfnOutput } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

import { LambdaFunction } from "../constructs/lambda-function";
import { Helper } from "../core/helper";
import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";

import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { QueueLambda } from "../constructs/queue-lambda";

export interface ISQSConfig {
    queuesDirectory?: string;
    queueOptions?: QueueProps;
    env?: ILambdaEnvConfig[];
}

export class SQSStack implements IStack {
    fw24: Fw24 = Fw24.getInstance();
    dependencies: string[] = ['DynamoDBStack'];
    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: ISQSConfig) {
        console.log("SQS");
        Helper.hydrateConfig(stackConfig,'SQS');
    }

    // construct method to create the stack
    public async construct() {
        console.log("SQS construct");
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack("main");
        // make the fw24 instance available to the class
        // sets the default queuess directory if not defined
        if(this.stackConfig.queuesDirectory === undefined || this.stackConfig.queuesDirectory === ""){
            this.stackConfig.queuesDirectory = "./src/queues";
        }
        // register the queues
        await Helper.registerHandlers(this.stackConfig.queuesDirectory, this.registerQueue);
    }

    private getEnvironmentVariables(queueConfig: ISQSConfig): any {
        const env: any = {};
        for (const envConfig of queueConfig.env || []) {
            const value = this.fw24.get(envConfig.name, envConfig.prefix || '');
            if (value) {
                env[envConfig.name] = value;
            }
        }
        return env;
    }

    private registerQueue = (queueInfo: HandlerDescriptor) => {
        queueInfo.handlerInstance = new queueInfo.handlerClass();
        console.log(":::Queue instance: ", queueInfo.handlerInstance);
        
        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance.queueConfig || {};

        console.log(`:::Registering queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);

        const queue = new QueueLambda(this.mainStack, queueName + "-queue", {
            queueName: queueName,
            topics: queueConfig?.topics,
            lambdaFunctionProps: {
                entry: queueInfo.filePath + "/" + queueInfo.fileName,
                layerArn: this.fw24.getLayerARN(),
                environmentVariables: this.getEnvironmentVariables(queueConfig),
                tableName: queueConfig?.tableName,
            }
        }) as Queue;

        // output the api endpoint
        new CfnOutput(this.mainStack, `SQS-${queueName}`, {
            value: queue.queueUrl,
            description: "Queue URL for " + queueName,
        });
    }
}
