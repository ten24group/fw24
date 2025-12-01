"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueConstruct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const fw24_1 = require("../core/fw24");
const queue_lambda_1 = require("./queue-lambda");
const logging_1 = require("../logging");
const dynamodb_1 = require("./dynamodb");
const vpc_1 = require("./vpc");
const lambda_function_1 = require("./lambda-function");
const aws_lambda_event_sources_1 = require("aws-cdk-lib/aws-lambda-event-sources");
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
class QueueConstruct {
    queueConstructConfig;
    logger = (0, logging_1.createLogger)(QueueConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = QueueConstruct.name;
    dependencies = [dynamodb_1.DynamoDBConstruct.name, vpc_1.VpcConstruct.name];
    output;
    mainStack;
    queueMap = new Map();
    /**
     * Default constructor to initialize the stack configuration.
     * @param queueConstructConfig The configuration for the QueueConstruct.
     */
    constructor(queueConstructConfig) {
        this.queueConstructConfig = queueConstructConfig;
        this.logger.debug("constructor", queueConstructConfig);
        helper_1.Helper.hydrateConfig(queueConstructConfig, 'SQS');
    }
    /**
     * Construct method to create the stack.
     */
    async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack(this.queueConstructConfig.stackName, this.queueConstructConfig.parentStackName);
        // make the fw24 instance available to the class
        // sets the default queues directory if not defined
        if (this.queueConstructConfig.queuesDirectory === undefined || this.queueConstructConfig.queuesDirectory === "") {
            this.queueConstructConfig.queuesDirectory = "./src/queues";
        }
        // Two-phase construction to handle cross-queue references:
        // Phase 1: Collect all queue descriptors
        const queueDescriptors = [];
        const collectQueue = (queueInfo) => {
            queueDescriptors.push(queueInfo);
        };
        await helper_1.Helper.registerHandlers(this.queueConstructConfig.queuesDirectory, collectQueue);
        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("SQS stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                const queuesDirectory = module.getQueuesDirectory();
                if (queuesDirectory != '') {
                    this.logger.debug("Load queues from module base-path: ", basePath);
                    await helper_1.Helper.registerQueuesFromModule(module, collectQueue);
                }
            }
        }
        else {
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
            }
            else {
                createdCount++;
            }
        }
        this.logger.info(`✅ Queue setup complete: ${createdCount} active, ${skippedCount} manual`);
    }
    /**
     * Phase 2: Creates queue without lambda and registers its URL
     * @param queueInfo The information about the queue to be registered.
     */
    createAndRegisterQueue = (queueInfo) => {
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
        // Create queue without lambda (lambdaFunctionProps: undefined)
        const queue = new queue_lambda_1.QueueLambda(this.mainStack, queueName + "-queue", {
            queueName: queueName,
            queueProps: queueProps,
            visibilityTimeoutSeconds: queueConfig?.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig?.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig?.retentionPeriodDays,
            maxReceiveCount: queueConfig?.maxReceiveCount,
            sqsEventSourceProps: {
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(queueConfig?.maxBatchingWindowSeconds ?? 5),
                ...queueConfig?.sqsEventSourceProps,
            },
            subscriptions: queueConfig?.subscriptions,
            lambdaFunctionProps: undefined // Don't create lambda yet
        });
        // Register queue URL immediately so other lambdas can reference it
        this.fw24.setConstructOutput(this, queueName, queue, construct_1.OutputType.QUEUE, 'queueName');
        // Store queue for phase 3
        this.queueMap.set(queueName, queue);
    };
    /**
     * Phase 3: Creates lambda function for the queue (after all queues are registered)
     * @param queueInfo The information about the queue to be registered.
     */
    createQueueLambda = (queueInfo) => {
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
        const queueFunction = new lambda_function_1.LambdaFunction(this.mainStack, `${queueName}-queue-lambda`, {
            entry: queueInfo.filePath + "/" + queueInfo.fileName,
            environmentVariables: this.fw24.resolveEnvVariables(queueConfig.env),
            resourceAccess: queueConfig?.resourceAccess,
            functionTimeout: queueConfig?.functionTimeout || this.fw24.getConfig().functionTimeout,
            policies: queueConfig?.policies,
            functionProps: { ...this.queueConstructConfig.functionProps, ...queueConfig?.functionProps },
            logRemovalPolicy: queueConfig?.logRemovalPolicy,
            logRetentionDays: queueConfig?.logRetentionDays,
        });
        // Attach queue as event source
        const isFifoQueue = helper_1.Helper.isFifoQueueProps({
            ...(queueConfig.queueProps || {}),
            queueName: queueName
        });
        const eventSourceProps = isFifoQueue ? {} : {
            batchSize: queueConfig.sqsEventSourceProps?.batchSize ?? 1,
            maxBatchingWindow: queueConfig.sqsEventSourceProps?.maxBatchingWindow ?? aws_cdk_lib_1.Duration.seconds(5),
            reportBatchItemFailures: queueConfig.sqsEventSourceProps?.reportBatchItemFailures ?? true,
        };
        queueFunction.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(queue, eventSourceProps));
    };
}
exports.QueueConstruct = QueueConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], QueueConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw2Q0FBeUQ7QUFFekQsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFJcEMsaURBQTZDO0FBRTdDLHdDQUF1RDtBQUN2RCx5Q0FBK0M7QUFHL0MsK0JBQXFDO0FBQ3JDLHVEQUFtRDtBQUNuRCxtRkFBc0U7QUE0QnRFOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Qkc7QUFDSCxNQUFhLGNBQWM7SUFlTTtJQWRwQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQ25DLFlBQVksR0FBYSxDQUFDLDRCQUFpQixDQUFDLElBQUksRUFBRSxrQkFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3JFLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBQ0QsUUFBUSxHQUFHLElBQUksR0FBRyxFQUFpQixDQUFDO0lBRXJEOzs7T0FHRztJQUNILFlBQTZCLG9CQUEyQztRQUEzQyx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQXVCO1FBQ3BFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3ZELGVBQU0sQ0FBQyxhQUFhLENBQUMsb0JBQW9CLEVBQUMsS0FBSyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVEOztPQUVHO0lBRVUsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMs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LENBQUMsbUJBQW1CLEVBQUUsaUJBQWlCLElBQUksc0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQzVGLHVCQUF1QixFQUFFLFdBQVcsQ0FBQyxtQkFBbUIsRUFBRSx1QkFBdUIsSUFBSSxJQUFJO1NBQzVGLENBQUM7UUFFRixhQUFhLENBQUMsY0FBYyxDQUFDLElBQUkseUNBQWMsQ0FBQyxLQUFLLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDO0lBQzlFLENBQUMsQ0FBQTtDQUNKO0FBakxELHdDQWlMQztBQXpKZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7K0NBMkRiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgUXVldWVQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBRdWV1ZUxhbWJkYSB9IGZyb20gXCIuL3F1ZXVlLWxhbWJkYVwiO1xuaW1wb3J0IHsgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2xhbWJkYS1lbnZcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9keW5hbW9kYlwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBTcXNFdmVudFNvdXJjZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciBhIHF1ZXVlIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUXVldWVDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGlyZWN0b3J5IHdoZXJlIHF1ZXVlcyBhcmUgc3RvcmVkLlxuICAgICAqL1xuICAgIHF1ZXVlc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgcXVldWUuXG4gICAgICovXG4gICAgcXVldWVQcm9wcz86IFF1ZXVlUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIGVudj86IElMYW1iZGFFbnZDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgZnVuY3Rpb24uXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgUXVldWVDb25zdHJ1Y3QgdGhhdCBjcmVhdGVzIGFuZCByZWdpc3RlcnMgcXVldWVzIGluIHRoZSBzdGFjay5cbiAqIEBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3RcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQ3JlYXRlIGEgbmV3IFF1ZXVlQ29uc3RydWN0IGluc3RhbmNlXG4gKiBjb25zdCBxdWV1ZUNvbmZpZzogSVF1ZXVlQ29uc3RydWN0Q29uZmlnID0ge1xuICogICBxdWV1ZXNEaXJlY3Rvcnk6IFwiLi9zcmMvcXVldWVzXCIsXG4gKiAgIGVudjogW1xuICogICAgIHsgbmFtZTogXCJRVUVVRV9OQU1FXCIsIHByZWZpeDogXCJQUkVGSVhfXCIgfSxcbiAqICAgICB7IG5hbWU6IFwiUVVFVUVfVVJMXCIgfVxuICogICBdLFxuICogICBxdWV1ZVByb3BzOiB7XG4gKiAgICAgZmlmbzogdHJ1ZSxcbiAqICAgICBjb250ZW50QmFzZWREZWR1cGxpY2F0aW9uOiB0cnVlXG4gKiAgIH0sXG4gKiAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAqICAgICBtZW1vcnlTaXplOiA1MTJcbiAqICAgfVxuICogfTtcbiAqIGNvbnN0IHF1ZXVlQ29uc3RydWN0ID0gbmV3IFF1ZXVlQ29uc3RydWN0KHF1ZXVlQ29uZmlnKTtcbiAqXG4gKiBhcHAudXNlKHF1ZXVlQ29uc3RydWN0KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgUXVldWVDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoUXVldWVDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lOiBzdHJpbmcgPSBRdWV1ZUNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbRHluYW1vREJDb25zdHJ1Y3QubmFtZSwgVnBjQ29uc3RydWN0Lm5hbWVdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICBwcml2YXRlIHJlYWRvbmx5IHF1ZXVlTWFwID0gbmV3IE1hcDxzdHJpbmcsIFF1ZXVlPigpO1xuXG4gICAgLyoqXG4gICAgICogRGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uLlxuICAgICAqIEBwYXJhbSBxdWV1ZUNvbnN0cnVjdENvbmZpZyBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIFF1ZXVlQ29uc3RydWN0LlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcXVldWVDb25zdHJ1Y3RDb25maWc6IElRdWV1ZUNvbnN0cnVjdENvbmZpZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImNvbnN0cnVjdG9yXCIsIHF1ZXVlQ29uc3RydWN0Q29uZmlnKTtcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcocXVldWVDb25zdHJ1Y3RDb25maWcsJ1NRUycpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdCBtZXRob2QgdG8gY3JlYXRlIHRoZSBzdGFjay5cbiAgICAgKi9cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIG1ha2UgdGhlIG1haW4gc3RhY2sgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnN0YWNrTmFtZSwgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBtYWtlIHRoZSBmdzI0IGluc3RhbmNlIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgLy8gc2V0cyB0aGUgZGVmYXVsdCBxdWV1ZXMgZGlyZWN0b3J5IGlmIG5vdCBkZWZpbmVkXG4gICAgICAgIGlmKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID09PSB1bmRlZmluZWQgfHwgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPT09IFwiXCIpe1xuICAgICAgICAgICAgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPSBcIi4vc3JjL3F1ZXVlc1wiO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVHdvLXBoYXNlIGNvbnN0cnVjdGlvbiB0byBoYW5kbGUgY3Jvc3MtcXVldWUgcmVmZXJlbmNlczpcbiAgICAgICAgLy8gUGhhc2UgMTogQ29sbGVjdCBhbGwgcXVldWUgZGVzY3JpcHRvcnNcbiAgICAgICAgY29uc3QgcXVldWVEZXNjcmlwdG9yczogSGFuZGxlckRlc2NyaXB0b3JbXSA9IFtdO1xuICAgICAgICBjb25zdCBjb2xsZWN0UXVldWUgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICAgICAgcXVldWVEZXNjcmlwdG9ycy5wdXNoKHF1ZXVlSW5mbyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnksIGNvbGxlY3RRdWV1ZSk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBtb2R1bGVzIFwiLCBBcnJheS5mcm9tKG1vZHVsZXMua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFssIG1vZHVsZV0gb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVldWVzRGlyZWN0b3J5ID0gbW9kdWxlLmdldFF1ZXVlc0RpcmVjdG9yeSgpO1xuICAgICAgICAgICAgICAgIGlmKHF1ZXVlc0RpcmVjdG9yeSAhPSAnJyl7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiTG9hZCBxdWV1ZXMgZnJvbSBtb2R1bGUgYmFzZS1wYXRoOiBcIiwgYmFzZVBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlKG1vZHVsZSwgY29sbGVjdFF1ZXVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUyBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG5vIG1vZHVsZXMgXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGhhc2UgMjogQ3JlYXRlIHF1ZXVlcyB3aXRob3V0IGxhbWJkYXMgYW5kIHJlZ2lzdGVyIHRoZWlyIFVSTHNcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+TiyBDcmVhdGluZyAke3F1ZXVlRGVzY3JpcHRvcnMubGVuZ3RofSBxdWV1ZShzKS4uLmApO1xuICAgICAgICBmb3IgKGNvbnN0IHF1ZXVlSW5mbyBvZiBxdWV1ZURlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgICB0aGlzLmNyZWF0ZUFuZFJlZ2lzdGVyUXVldWUocXVldWVJbmZvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBoYXNlIDM6IENyZWF0ZSBsYW1iZGEgZnVuY3Rpb25zIGZvciBxdWV1ZXMgKG5vdyBhbGwgcXVldWUgVVJMcyBhcmUgcmVnaXN0ZXJlZClcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg8J+UpyBDcmVhdGluZyBMYW1iZGEgZnVuY3Rpb25zIGZvciAke3F1ZXVlRGVzY3JpcHRvcnMubGVuZ3RofSBxdWV1ZShzKS4uLmApO1xuICAgICAgICBsZXQgY3JlYXRlZENvdW50ID0gMDtcbiAgICAgICAgbGV0IHNraXBwZWRDb3VudCA9IDA7XG5cbiAgICAgICAgZm9yIChjb25zdCBxdWV1ZUluZm8gb2YgcXVldWVEZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZz8ucXVldWVOYW1lIHx8IHF1ZXVlSW5mby5oYW5kbGVyQ2xhc3MubmFtZTtcbiAgICAgICAgICAgIGNvbnN0IGlzTWFudWFsID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZz8ubWFudWFsUmVnaXN0cmF0aW9uO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLmNyZWF0ZVF1ZXVlTGFtYmRhKHF1ZXVlSW5mbyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChpc01hbnVhbCkge1xuICAgICAgICAgICAgICAgIHNraXBwZWRDb3VudCsrO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjcmVhdGVkQ291bnQrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYOKchSBRdWV1ZSBzZXR1cCBjb21wbGV0ZTogJHtjcmVhdGVkQ291bnR9IGFjdGl2ZSwgJHtza2lwcGVkQ291bnR9IG1hbnVhbGApO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBoYXNlIDI6IENyZWF0ZXMgcXVldWUgd2l0aG91dCBsYW1iZGEgYW5kIHJlZ2lzdGVycyBpdHMgVVJMXG4gICAgICogQHBhcmFtIHF1ZXVlSW5mbyBUaGUgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHF1ZXVlIHRvIGJlIHJlZ2lzdGVyZWQuXG4gICAgICovXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVBbmRSZWdpc3RlclF1ZXVlID0gKHF1ZXVlSW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZSA9IG5ldyBxdWV1ZUluZm8uaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiOjo6UXVldWUgaW5zdGFuY2U6IFwiLCBxdWV1ZUluZm8uZmlsZU5hbWUsIHF1ZXVlSW5mby5maWxlUGF0aCk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnIHx8IHt9O1xuICAgICAgICBcbiAgICAgICAgLy8gU2tpcCBxdWV1ZXMgbWFya2VkIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uXG4gICAgICAgIGlmIChxdWV1ZUNvbmZpZy5tYW51YWxSZWdpc3RyYXRpb24pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBTa2lwcGluZyBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBxdWV1ZVByb3BzID0gey4uLnRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVQcm9wcywgLi4ucXVldWVDb25maWcucXVldWVQcm9wc307XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBxdWV1ZSB3aXRob3V0IGxhbWJkYSAobGFtYmRhRnVuY3Rpb25Qcm9wczogdW5kZWZpbmVkKVxuICAgICAgICBjb25zdCBxdWV1ZSA9IG5ldyBRdWV1ZUxhbWJkYSh0aGlzLm1haW5TdGFjaywgcXVldWVOYW1lICsgXCItcXVldWVcIiwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiBxdWV1ZVByb3BzLFxuICAgICAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzOiBxdWV1ZUNvbmZpZz8udmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzLFxuICAgICAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHM6IHF1ZXVlQ29uZmlnPy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyxcbiAgICAgICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IHF1ZXVlQ29uZmlnPy5yZXRlbnRpb25QZXJpb2REYXlzLFxuICAgICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiBxdWV1ZUNvbmZpZz8ubWF4UmVjZWl2ZUNvdW50LFxuICAgICAgICAgICAgc3FzRXZlbnRTb3VyY2VQcm9wczoge1xuICAgICAgICAgICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBEdXJhdGlvbi5zZWNvbmRzKHF1ZXVlQ29uZmlnPy5tYXhCYXRjaGluZ1dpbmRvd1NlY29uZHMgPz8gNSksXG4gICAgICAgICAgICAgICAgLi4ucXVldWVDb25maWc/LnNxc0V2ZW50U291cmNlUHJvcHMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uczogcXVldWVDb25maWc/LnN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB1bmRlZmluZWQgIC8vIERvbid0IGNyZWF0ZSBsYW1iZGEgeWV0XG4gICAgICAgIH0pIGFzIFF1ZXVlO1xuICAgICAgICBcbiAgICAgICAgLy8gUmVnaXN0ZXIgcXVldWUgVVJMIGltbWVkaWF0ZWx5IHNvIG90aGVyIGxhbWJkYXMgY2FuIHJlZmVyZW5jZSBpdFxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHF1ZXVlTmFtZSwgcXVldWUsIE91dHB1dFR5cGUuUVVFVUUsICdxdWV1ZU5hbWUnKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFN0b3JlIHF1ZXVlIGZvciBwaGFzZSAzXG4gICAgICAgIHRoaXMucXVldWVNYXAuc2V0KHF1ZXVlTmFtZSwgcXVldWUpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFBoYXNlIDM6IENyZWF0ZXMgbGFtYmRhIGZ1bmN0aW9uIGZvciB0aGUgcXVldWUgKGFmdGVyIGFsbCBxdWV1ZXMgYXJlIHJlZ2lzdGVyZWQpXG4gICAgICogQHBhcmFtIHF1ZXVlSW5mbyBUaGUgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHF1ZXVlIHRvIGJlIHJlZ2lzdGVyZWQuXG4gICAgICovXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmVhdGVRdWV1ZUxhbWJkYSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVOYW1lO1xuICAgICAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWcgfHwge307XG5cbiAgICAgICAgLy8gU2tpcCBxdWV1ZXMgbWFya2VkIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uXG4gICAgICAgIGlmIChxdWV1ZUNvbmZpZy5tYW51YWxSZWdpc3RyYXRpb24pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGA6OjpTa2lwcGluZyBsYW1iZGEgY3JlYXRpb24gZm9yIG1hbnVhbCByZWdpc3RyYXRpb24gcXVldWUgJHtxdWV1ZU5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgQ3JlYXRpbmcgbGFtYmRhIGZvciBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcblxuICAgICAgICAvLyBHZXQgdGhlIGFscmVhZHktY3JlYXRlZCBxdWV1ZVxuICAgICAgICBjb25zdCBxdWV1ZSA9IHRoaXMucXVldWVNYXAuZ2V0KHF1ZXVlTmFtZSk7XG4gICAgICAgIGlmICghcXVldWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBRdWV1ZSAke3F1ZXVlTmFtZX0gbm90IGZvdW5kIGluIHF1ZXVlTWFwYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgbGFtYmRhIGZ1bmN0aW9uIHNlcGFyYXRlbHkgdXNpbmcgTGFtYmRhRnVuY3Rpb24gY29uc3RydWN0XG4gICAgICAgIGNvbnN0IHF1ZXVlRnVuY3Rpb24gPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3F1ZXVlTmFtZX0tcXVldWUtbGFtYmRhYCwge1xuICAgICAgICAgICAgZW50cnk6IHF1ZXVlSW5mby5maWxlUGF0aCArIFwiL1wiICsgcXVldWVJbmZvLmZpbGVOYW1lLFxuICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHRoaXMuZncyNC5yZXNvbHZlRW52VmFyaWFibGVzKHF1ZXVlQ29uZmlnLmVudiksXG4gICAgICAgICAgICByZXNvdXJjZUFjY2VzczogcXVldWVDb25maWc/LnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiBxdWV1ZUNvbmZpZz8uZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICBwb2xpY2llczogcXVldWVDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogey4uLnRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcywgLi4ucXVldWVDb25maWc/LmZ1bmN0aW9uUHJvcHN9LFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogcXVldWVDb25maWc/LmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiBxdWV1ZUNvbmZpZz8ubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgLy8gQXR0YWNoIHF1ZXVlIGFzIGV2ZW50IHNvdXJjZVxuICAgICAgICBjb25zdCBpc0ZpZm9RdWV1ZSA9IEhlbHBlci5pc0ZpZm9RdWV1ZVByb3BzKHsgXG4gICAgICAgICAgICAuLi4ocXVldWVDb25maWcucXVldWVQcm9wcyB8fCB7fSksIFxuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUgXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZXZlbnRTb3VyY2VQcm9wcyA9IGlzRmlmb1F1ZXVlID8ge30gOiB7XG4gICAgICAgICAgICBiYXRjaFNpemU6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHM/LmJhdGNoU2l6ZSA/PyAxLFxuICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHM/Lm1heEJhdGNoaW5nV2luZG93ID8/IER1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogcXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcz8ucmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXMgPz8gdHJ1ZSxcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIHF1ZXVlRnVuY3Rpb24uYWRkRXZlbnRTb3VyY2UobmV3IFNxc0V2ZW50U291cmNlKHF1ZXVlLCBldmVudFNvdXJjZVByb3BzKSk7XG4gICAgfVxufVxuIl19