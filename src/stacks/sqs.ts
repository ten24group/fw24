import { Stack, CfnOutput } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";

import { LambdaFunction } from "../constructs/lambda-function";
import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";
import { ISQSConfig } from "../interfaces/sqs";
import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";


export class SQS implements IStack {
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;
    fw24!: Fw24;

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: ISQSConfig) {
        console.log("SQS");
        Helper.hydrateConfig(stackConfig,'SQS');
    }

    // construct method to create the stack
    public construct(fw24: Fw24) {
        console.log("SQS construct");
        // make the appConfig available to the class
        this.appConfig = fw24.getConfig();
        // make the main stack available to the class
        this.mainStack = fw24.getStack("main");
        // make the fw24 instance available to the class
        this.fw24 = fw24;
        // sets the default queuess directory if not defined
        if(this.stackConfig.queuesDirectory === undefined || this.stackConfig.queuesDirectory === ""){
            this.stackConfig.queuesDirectory = "./src/queues";
        }
        // register the queues
        Helper.registerHandlers(this.stackConfig.queuesDirectory, this.registerQueue);
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

    private registerQueue(queueInfo: HandlerDescriptor) {
        queueInfo.handlerInstance = new queueInfo.handlerClass();
        console.log(":::Queue instance: ", queueInfo.handlerInstance);
        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance?.queueConfig;

        console.log(`:::Registering queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);

        // create the queue
        const queue = new Queue(this.mainStack, queueName + "-queue", {
            queueName: queueName,
        });

        // create lambda function for the controller
        const queueLambda = new LambdaFunction(this.mainStack, queueName + "-controller", {
            entry: queueInfo.filePath + "/" + queueInfo.fileName,
            layerArn: this.fw24.getLayerARN(),
            env: this.getEnvironmentVariables(queueConfig),
        }).fn;

         // logic for adding dynamodb table access to the controller
        if (queueConfig?.tableName) {
            // get the dynamodb table based on the controller config
            const tableInstance: TableV2 = this.fw24.getDynamoTable(queueConfig.tableName);
            // add the table name to the lambda environment
            queueLambda.addEnvironment(`${queueConfig.tableName.toUpperCase()}_TABLE`, tableInstance.tableName);
            // grant the lambda function read write access to the table
            tableInstance.grantReadWriteData(queueLambda);
        }

        // add event source for the queue
        queueLambda.addEventSource(new SqsEventSource(queue));
        queue.grantConsumeMessages(queueLambda);

        // output the api endpoint
        new CfnOutput(this.mainStack, `SQS-${queueName}`, {
            value: queue.queueUrl,
            description: "Queue URL for " + queueName,
        });
    }
}
