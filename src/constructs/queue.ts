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
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { IConstructConfig } from "../interfaces/construct-config";
import { LayerConstruct } from "./layer";
import { VpcConstruct } from "./vpc";
import { LambdaFunction } from "./lambda-function";
import { merge } from "../utils";

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
    dependencies: string[] = [ DynamoDBConstruct.name, VpcConstruct.name, LayerConstruct.name ];
    output!: FW24ConstructOutput;

    mainStack!: Stack;
    private readonly queueMap = new Map<string, Queue>();

    /**
     * Default constructor to initialize the stack configuration.
     * @param queueConstructConfig The configuration for the QueueConstruct.
     */
    constructor(private readonly queueConstructConfig: IQueueConstructConfig) {
        this.logger.debug("constructor", queueConstructConfig);
        Helper.hydrateConfig(queueConstructConfig, 'SQS');
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
        if (this.queueConstructConfig.queuesDirectory === undefined || this.queueConstructConfig.queuesDirectory === "") {
            this.queueConstructConfig.queuesDirectory = "./src/queues";
        }

        // Two-phase construction to handle cross-queue references:
        // Phase 1: Collect all queue descriptors
        const queueDescriptors: HandlerDescriptor[] = [];
        const collectQueue = (queueInfo: HandlerDescriptor) => {
            queueDescriptors.push(queueInfo);
        };

        await Helper.registerHandlers(this.queueConstructConfig.queuesDirectory, collectQueue);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("SQS stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [ , module ] of modules) {
                const basePath = module.getBasePath();
                const queuesDirectory = module.getQueuesDirectory();
                if (queuesDirectory != '') {
                    this.logger.debug("Load queues from module base-path: ", basePath);
                    await Helper.registerQueuesFromModule(module, collectQueue);
                }
            }
        } else {
            this.logger.debug("SQS stack: construct: app has no modules ");
        }

        // Phase 2: Create queues without lambdas and register their URLs
        this.logger.info(`📋 Creating ${queueDescriptors.length} queue(s)...`);
        for (const queueInfo of queueDescriptors) {
            this.createAndRegisterQueue(queueInfo);
        }

        // Phase 3: Create lambda functions for queues (now all queue URLs are registered)
        this.logger.info(`🔧 Creating Lambda functions for ${queueDescriptors.length} queue(s)...`);
        let createdCount = 0;
        let skippedCount = 0;

        for (const queueInfo of queueDescriptors) {
            const queueName = queueInfo.handlerInstance.queueConfig?.queueName || queueInfo.handlerClass.name;
            const isManual = queueInfo.handlerInstance.queueConfig?.manualRegistration;

            this.createQueueLambda(queueInfo);

            if (isManual) {
                skippedCount++;
            } else {
                createdCount++;
            }
        }

        this.logger.info(`✅ Queue setup complete: ${createdCount} active, ${skippedCount} manual`);
    }

    /**
     * Phase 2: Creates queue without lambda and registers its URL
     * @param queueInfo The information about the queue to be registered.
     */
    private readonly createAndRegisterQueue = (queueInfo: HandlerDescriptor) => {
        queueInfo.handlerInstance = new queueInfo.handlerClass();
        this.logger.debug(":::Queue instance: ", queueInfo.fileName, queueInfo.filePath);

        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance.queueConfig || {};

        // Skip queues marked for manual registration
        if (queueConfig.manualRegistration) {
            this.logger.debug(`Skipping manual registration queue ${queueName}`);
            return;
        }

        const queueProps = { ...this.queueConstructConfig.queueProps, ...queueConfig.queueProps };

        this.logger.debug(`Creating queue ${queueName}`);

        // Create queue with subscriptions using static helper
        // This ensures consistent DLQ setup, timeout configuration, and topic subscriptions
        const queue = QueueLambda.createQueue(this.mainStack, queueName + "-queue", {
            queueName: queueName,
            queueProps: queueProps,
            visibilityTimeoutSeconds: queueConfig?.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig?.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig?.retentionPeriodDays,
            maxReceiveCount: queueConfig?.maxReceiveCount,
        }, queueConfig?.subscriptions);

        // Register queue URL immediately so other lambdas can reference it
        this.fw24.setConstructOutput(this, queueName, queue, OutputType.QUEUE, 'queueName');

        // Store queue for phase 3
        this.queueMap.set(queueName, queue);
    }

    /**
     * Phase 3: Creates lambda function for the queue (after all queues are registered)
     * @param queueInfo The information about the queue to be registered.
     */
    private readonly createQueueLambda = (queueInfo: HandlerDescriptor) => {
        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance.queueConfig || {};

        // Skip queues marked for manual registration
        if (queueConfig.manualRegistration) {
            this.logger.debug(`:::Skipping lambda creation for manual registration queue ${queueName}`);
            return;
        }

        this.logger.debug(`Creating lambda for queue ${queueName}`);

        // Get the already-created queue
        const queue = this.queueMap.get(queueName);
        if (!queue) {
            this.logger.error(`Queue ${queueName} not found in queueMap`);
            return;
        }

        // Create lambda function separately using LambdaFunction construct
        const queueFunction = new LambdaFunction(this.mainStack, `${queueName}-queue-lambda`, {
            entry: queueInfo.filePath + "/" + queueInfo.fileName,
            handlerClassName: queueInfo.handlerClass.name,
            environmentVariables: this.fw24.resolveEnvVariables(queueConfig.env),
            resourceAccess: queueConfig?.resourceAccess,
            functionTimeout: queueConfig?.functionTimeout || this.fw24.getConfig().functionTimeout,
            policies: queueConfig?.policies,
            functionProps: merge([
                this.queueConstructConfig.functionProps ?? {},
                queueConfig?.functionProps ?? {}
            ])!,
            logRemovalPolicy: queueConfig?.logRemovalPolicy,
            logRetentionDays: queueConfig?.logRetentionDays,
        }) as NodejsFunction;

        // Attach queue as event source using static helper (ensures consistent event source configuration)
        QueueLambda.attachQueueToLambda(queueFunction, queue, queueConfig.queueProps, queueName, queueConfig.sqsEventSourceProps);
    }
}
