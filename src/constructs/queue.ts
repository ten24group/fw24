import { CfnOutput, Duration, Stack } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";

import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { QueueLambda } from "./queue-lambda";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { LogDuration, createLogger } from "../logging";
import { DynamoDBConstruct } from "./dynamodb";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { IConstructConfig } from "../interfaces/construct-config";
import { VpcConstruct } from "./vpc";

/**
 * Represents the configuration for a queue construct.
 */
export interface IQueueConstructConfig extends IConstructConfig {
    /**
     * The directory where queues are stored.
     */
    queuesDirectory?: string;

    /**
     * The properties for the queue.
     */
    queueProps?: QueueProps;

    /**
     * The environment configuration for the queue.
     */
    env?: ILambdaEnvConfig[];

    /**
     * The properties for the function.
     */
    functionProps?: NodejsFunctionProps;
}


/**
 * Represents a QueueConstruct that creates and registers queues in the stack.
 * @implements FW24Construct
 * @example
 * ```ts
 * // Create a new QueueConstruct instance
 * const queueConfig: IQueueConstructConfig = {
 *   queuesDirectory: "./src/queues",
 *   env: [
 *     { name: "QUEUE_NAME", prefix: "PREFIX_" },
 *     { name: "QUEUE_URL" }
 *   ],
 *   queueProps: {
 *     fifo: true,
 *     contentBasedDeduplication: true
 *   },
 *   functionProps: {
 *     memorySize: 512
 *   }
 * };
 * const queueConstruct = new QueueConstruct(queueConfig);
 *
 * app.use(queueConstruct);
 * ```
 */
export class QueueConstruct implements FW24Construct {
    readonly logger = createLogger(QueueConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = QueueConstruct.name;
    dependencies: string[] = [DynamoDBConstruct.name, VpcConstruct.name];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

    /**
     * Default constructor to initialize the stack configuration.
     * @param queueConstructConfig The configuration for the QueueConstruct.
     */
    constructor(private queueConstructConfig: IQueueConstructConfig) {
        this.logger.debug("constructor", queueConstructConfig);
        Helper.hydrateConfig(queueConstructConfig,'SQS');
    }

    /**
     * Construct method to create the stack.
     */
    @LogDuration()
    public async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack(this.queueConstructConfig.stackName, this.queueConstructConfig.parentStackName);
        // make the fw24 instance available to the class
        // sets the default queues directory if not defined
        if(this.queueConstructConfig.queuesDirectory === undefined || this.queueConstructConfig.queuesDirectory === ""){
            this.queueConstructConfig.queuesDirectory = "./src/queues";
        }

        // register the queues
        await Helper.registerHandlers(this.queueConstructConfig.queuesDirectory, this.registerQueue);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("SQS stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                const queuesDirectory = module.getQueuesDirectory();
                if(queuesDirectory != ''){
                    this.logger.debug("Load queues from module base-path: ", basePath);
                    await Helper.registerQueuesFromModule(module, this.registerQueue);
                }
            }
        } else {
            this.logger.debug("SQS stack: construct: app has no modules ");
        }
    }

    /**
     * Registers a queue using the provided queue information.
     * @param queueInfo The information about the queue to be registered.
     */
    private registerQueue = (queueInfo: HandlerDescriptor) => {
        queueInfo.handlerInstance = new queueInfo.handlerClass();
        this.logger.debug(":::Queue instance: ", queueInfo.fileName, queueInfo.filePath);
        
        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance.queueConfig || {};
        const queueProps = {...this.queueConstructConfig.queueProps, ...queueConfig.queueProps};

        this.logger.info(`:::Registering queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);

        const queue = new QueueLambda(this.mainStack, queueName + "-queue", {
            queueName: queueName,
            queueProps: queueProps,
            visibilityTimeoutSeconds: queueConfig?.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig?.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig?.retentionPeriodDays,
            sqsEventSourceProps: {
                maxBatchingWindow: Duration.seconds(queueConfig?.maxBatchingWindowSeconds ?? 5),
                ...queueConfig?.sqsEventSourceProps,
            },
            subscriptions: queueConfig?.subscriptions,            
            lambdaFunctionProps: {
                entry: queueInfo.filePath + "/" + queueInfo.fileName,
                environmentVariables: this.fw24.resolveEnvVariables(queueConfig.env),
                resourceAccess: queueConfig?.resourceAccess,
                functionTimeout: queueConfig?.functionTimeout,
                policies: queueConfig?.policies,
                functionProps: {...this.queueConstructConfig.functionProps, ...queueConfig?.functionProps},
                logRemovalPolicy: queueConfig?.logRemovalPolicy,
                logRetentionDays: queueConfig?.logRetentionDays,
            }
        }) as Queue;
        
        this.fw24.setConstructOutput(this, queueName, queue, OutputType.QUEUE, 'queueName');
    }
}
