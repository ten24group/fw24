"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueConstruct = void 0;
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const fw24_1 = require("../core/fw24");
const queue_lambda_1 = require("./queue-lambda");
const logging_1 = require("../logging");
const dynamodb_1 = require("./dynamodb");
const layer_1 = require("./layer");
const vpc_1 = require("./vpc");
const lambda_function_1 = require("./lambda-function");
const utils_1 = require("../utils");
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
    dependencies = [dynamodb_1.DynamoDBConstruct.name, vpc_1.VpcConstruct.name, layer_1.LayerConstruct.name];
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
        // Create queue with subscriptions using static helper
        // This ensures consistent DLQ setup, timeout configuration, and topic subscriptions
        const queue = queue_lambda_1.QueueLambda.createQueue(this.mainStack, queueName + "-queue", {
            queueName: queueName,
            queueProps: queueProps,
            visibilityTimeoutSeconds: queueConfig?.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig?.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig?.retentionPeriodDays,
            maxReceiveCount: queueConfig?.maxReceiveCount,
        }, queueConfig?.subscriptions);
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
            functionProps: (0, utils_1.merge)([
                this.queueConstructConfig.functionProps ?? {},
                queueConfig?.functionProps ?? {}
            ]),
            logRemovalPolicy: queueConfig?.logRemovalPolicy,
            logRetentionDays: queueConfig?.logRetentionDays,
        });
        // Attach queue as event source using static helper (ensures consistent event source configuration)
        queue_lambda_1.QueueLambda.attachQueueToLambda(queueFunction, queue, queueConfig.queueProps, queueName, queueConfig.sqsEventSourceProps);
    };
}
exports.QueueConstruct = QueueConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], QueueConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFFQSwyQ0FBd0M7QUFDeEMsdURBQXlGO0FBQ3pGLHVDQUFvQztBQUlwQyxpREFBNkM7QUFFN0Msd0NBQXVEO0FBQ3ZELHlDQUErQztBQUcvQyxtQ0FBeUM7QUFDekMsK0JBQXFDO0FBQ3JDLHVEQUFtRDtBQUNuRCxvQ0FBaUM7QUE0QmpDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Qkc7QUFDSCxNQUFhLGNBQWM7SUFlTTtJQWRwQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQ25DLFlBQVksR0FBYSxDQUFFLDRCQUFpQixDQUFDLElBQUksRUFBRSxrQkFBWSxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksQ0FBRSxDQUFDO0lBQzVGLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBQ0QsUUFBUSxHQUFHLElBQUksR0FBRyxFQUFpQixDQUFDO0lBRXJEOzs7T0FHRztJQUNILFlBQTZCLG9CQUEyQztRQUEzQyx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQXVCO1FBQ3BFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3ZELGVBQU0sQ0FBQyxhQUFhLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDdEQsQ0FBQztJQUVEOztPQUVHO0lBRVUsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJ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QUFHLElBQUksZ0NBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsU0FBUyxlQUFlLEVBQUU7WUFDbEYsS0FBSyxFQUFFLFNBQVMsQ0FBQyxRQUFRLEdBQUcsR0FBRyxHQUFHLFNBQVMsQ0FBQyxRQUFRO1lBQ3BELG9CQUFvQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQztZQUNwRSxjQUFjLEVBQUUsV0FBVyxFQUFFLGNBQWM7WUFDM0MsZUFBZSxFQUFFLFdBQVcsRUFBRSxlQUFlLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxlQUFlO1lBQ3RGLFFBQVEsRUFBRSxXQUFXLEVBQUUsUUFBUTtZQUMvQixhQUFhLEVBQUUsSUFBQSxhQUFLLEVBQUM7Z0JBQ2pCLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLElBQUksRUFBRTtnQkFDN0MsV0FBVyxFQUFFLGFBQWEsSUFBSSxFQUFFO2FBQ25DLENBQUU7WUFDSCxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCO1lBQy9DLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxnQkFBZ0I7U0FDbEQsQ0FBbUIsQ0FBQztRQUVyQixtR0FBbUc7UUFDbkcsMEJBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLFdBQVcsQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0lBQzlILENBQUMsQ0FBQTtDQUNKO0FBcEtELHdDQW9LQztBQTVJZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7K0NBMkRiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgUXVldWVQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBRdWV1ZUxhbWJkYSB9IGZyb20gXCIuL3F1ZXVlLWxhbWJkYVwiO1xuaW1wb3J0IHsgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2xhbWJkYS1lbnZcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9keW5hbW9kYlwiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBMYXllckNvbnN0cnVjdCB9IGZyb20gXCIuL2xheWVyXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGEgcXVldWUgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElRdWV1ZUNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgcXVldWVzIGFyZSBzdG9yZWQuXG4gICAgICovXG4gICAgcXVldWVzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBxdWV1ZS5cbiAgICAgKi9cbiAgICBxdWV1ZVByb3BzPzogUXVldWVQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFRoZSBlbnZpcm9ubWVudCBjb25maWd1cmF0aW9uIGZvciB0aGUgcXVldWUuXG4gICAgICovXG4gICAgZW52PzogSUxhbWJkYUVudkNvbmZpZ1tdO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBmdW5jdGlvbi5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBRdWV1ZUNvbnN0cnVjdCB0aGF0IGNyZWF0ZXMgYW5kIHJlZ2lzdGVycyBxdWV1ZXMgaW4gdGhlIHN0YWNrLlxuICogQGltcGxlbWVudHMgRlcyNENvbnN0cnVjdFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBDcmVhdGUgYSBuZXcgUXVldWVDb25zdHJ1Y3QgaW5zdGFuY2VcbiAqIGNvbnN0IHF1ZXVlQ29uZmlnOiBJUXVldWVDb25zdHJ1Y3RDb25maWcgPSB7XG4gKiAgIHF1ZXVlc0RpcmVjdG9yeTogXCIuL3NyYy9xdWV1ZXNcIixcbiAqICAgZW52OiBbXG4gKiAgICAgeyBuYW1lOiBcIlFVRVVFX05BTUVcIiwgcHJlZml4OiBcIlBSRUZJWF9cIiB9LFxuICogICAgIHsgbmFtZTogXCJRVUVVRV9VUkxcIiB9XG4gKiAgIF0sXG4gKiAgIHF1ZXVlUHJvcHM6IHtcbiAqICAgICBmaWZvOiB0cnVlLFxuICogICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IHRydWVcbiAqICAgfSxcbiAqICAgZnVuY3Rpb25Qcm9wczoge1xuICogICAgIG1lbW9yeVNpemU6IDUxMlxuICogICB9XG4gKiB9O1xuICogY29uc3QgcXVldWVDb25zdHJ1Y3QgPSBuZXcgUXVldWVDb25zdHJ1Y3QocXVldWVDb25maWcpO1xuICpcbiAqIGFwcC51c2UocXVldWVDb25zdHJ1Y3QpO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBRdWV1ZUNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihRdWV1ZUNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gUXVldWVDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gWyBEeW5hbW9EQkNvbnN0cnVjdC5uYW1lLCBWcGNDb25zdHJ1Y3QubmFtZSwgTGF5ZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICBwcml2YXRlIHJlYWRvbmx5IHF1ZXVlTWFwID0gbmV3IE1hcDxzdHJpbmcsIFF1ZXVlPigpO1xuXG4gICAgLyoqXG4gICAgICogRGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uLlxuICAgICAqIEBwYXJhbSBxdWV1ZUNvbnN0cnVjdENvbmZpZyBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIFF1ZXVlQ29uc3RydWN0LlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcXVldWVDb25zdHJ1Y3RDb25maWc6IElRdWV1ZUNvbnN0cnVjdENvbmZpZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImNvbnN0cnVjdG9yXCIsIHF1ZXVlQ29uc3RydWN0Q29uZmlnKTtcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcocXVldWVDb25zdHJ1Y3RDb25maWcsICdTUVMnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2suXG4gICAgICovXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gbWFrZSB0aGUgZncyNCBpbnN0YW5jZSBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgcXVldWVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZiAodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9PT0gXCJcIikge1xuICAgICAgICAgICAgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPSBcIi4vc3JjL3F1ZXVlc1wiO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVHdvLXBoYXNlIGNvbnN0cnVjdGlvbiB0byBoYW5kbGUgY3Jvc3MtcXVldWUgcmVmZXJlbmNlczpcbiAgICAgICAgLy8gUGhhc2UgMTogQ29sbGVjdCBhbGwgcXVldWUgZGVzY3JpcHRvcnNcbiAgICAgICAgY29uc3QgcXVldWVEZXNjcmlwdG9yczogSGFuZGxlckRlc2NyaXB0b3JbXSA9IFtdO1xuICAgICAgICBjb25zdCBjb2xsZWN0UXVldWUgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICAgICAgcXVldWVEZXNjcmlwdG9ycy5wdXNoKHF1ZXVlSW5mbyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnksIGNvbGxlY3RRdWV1ZSk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBtb2R1bGVzIFwiLCBBcnJheS5mcm9tKG1vZHVsZXMua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZXNEaXJlY3RvcnkgPSBtb2R1bGUuZ2V0UXVldWVzRGlyZWN0b3J5KCk7XG4gICAgICAgICAgICAgICAgaWYgKHF1ZXVlc0RpcmVjdG9yeSAhPSAnJykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgcXVldWVzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZShtb2R1bGUsIGNvbGxlY3RRdWV1ZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBubyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBoYXNlIDI6IENyZWF0ZSBxdWV1ZXMgd2l0aG91dCBsYW1iZGFzIGFuZCByZWdpc3RlciB0aGVpciBVUkxzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfk4sgQ3JlYXRpbmcgJHtxdWV1ZURlc2NyaXB0b3JzLmxlbmd0aH0gcXVldWUocykuLi5gKTtcbiAgICAgICAgZm9yIChjb25zdCBxdWV1ZUluZm8gb2YgcXVldWVEZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgdGhpcy5jcmVhdGVBbmRSZWdpc3RlclF1ZXVlKHF1ZXVlSW5mbyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQaGFzZSAzOiBDcmVhdGUgbGFtYmRhIGZ1bmN0aW9ucyBmb3IgcXVldWVzIChub3cgYWxsIHF1ZXVlIFVSTHMgYXJlIHJlZ2lzdGVyZWQpXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCflKcgQ3JlYXRpbmcgTGFtYmRhIGZ1bmN0aW9ucyBmb3IgJHtxdWV1ZURlc2NyaXB0b3JzLmxlbmd0aH0gcXVldWUocykuLi5gKTtcbiAgICAgICAgbGV0IGNyZWF0ZWRDb3VudCA9IDA7XG4gICAgICAgIGxldCBza2lwcGVkQ291bnQgPSAwO1xuXG4gICAgICAgIGZvciAoY29uc3QgcXVldWVJbmZvIG9mIHF1ZXVlRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWc/LnF1ZXVlTmFtZSB8fCBxdWV1ZUluZm8uaGFuZGxlckNsYXNzLm5hbWU7XG4gICAgICAgICAgICBjb25zdCBpc01hbnVhbCA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWc/Lm1hbnVhbFJlZ2lzdHJhdGlvbjtcblxuICAgICAgICAgICAgdGhpcy5jcmVhdGVRdWV1ZUxhbWJkYShxdWV1ZUluZm8pO1xuXG4gICAgICAgICAgICBpZiAoaXNNYW51YWwpIHtcbiAgICAgICAgICAgICAgICBza2lwcGVkQ291bnQrKztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY3JlYXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgUXVldWUgc2V0dXAgY29tcGxldGU6ICR7Y3JlYXRlZENvdW50fSBhY3RpdmUsICR7c2tpcHBlZENvdW50fSBtYW51YWxgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAyOiBDcmVhdGVzIHF1ZXVlIHdpdGhvdXQgbGFtYmRhIGFuZCByZWdpc3RlcnMgaXRzIFVSTFxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlQW5kUmVnaXN0ZXJRdWV1ZSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgcXVldWVJbmZvLmhhbmRsZXJDbGFzcygpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIjo6OlF1ZXVlIGluc3RhbmNlOiBcIiwgcXVldWVJbmZvLmZpbGVOYW1lLCBxdWV1ZUluZm8uZmlsZVBhdGgpO1xuXG4gICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVOYW1lO1xuICAgICAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWcgfHwge307XG5cbiAgICAgICAgLy8gU2tpcCBxdWV1ZXMgbWFya2VkIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uXG4gICAgICAgIGlmIChxdWV1ZUNvbmZpZy5tYW51YWxSZWdpc3RyYXRpb24pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBTa2lwcGluZyBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcXVldWVQcm9wcyA9IHsgLi4udGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZVByb3BzLCAuLi5xdWV1ZUNvbmZpZy5xdWV1ZVByb3BzIH07XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBxdWV1ZSB3aXRoIHN1YnNjcmlwdGlvbnMgdXNpbmcgc3RhdGljIGhlbHBlclxuICAgICAgICAvLyBUaGlzIGVuc3VyZXMgY29uc2lzdGVudCBETFEgc2V0dXAsIHRpbWVvdXQgY29uZmlndXJhdGlvbiwgYW5kIHRvcGljIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZSh0aGlzLm1haW5TdGFjaywgcXVldWVOYW1lICsgXCItcXVldWVcIiwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiBxdWV1ZVByb3BzLFxuICAgICAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzOiBxdWV1ZUNvbmZpZz8udmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzLFxuICAgICAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHM6IHF1ZXVlQ29uZmlnPy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyxcbiAgICAgICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IHF1ZXVlQ29uZmlnPy5yZXRlbnRpb25QZXJpb2REYXlzLFxuICAgICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiBxdWV1ZUNvbmZpZz8ubWF4UmVjZWl2ZUNvdW50LFxuICAgICAgICB9LCBxdWV1ZUNvbmZpZz8uc3Vic2NyaXB0aW9ucyk7XG5cbiAgICAgICAgLy8gUmVnaXN0ZXIgcXVldWUgVVJMIGltbWVkaWF0ZWx5IHNvIG90aGVyIGxhbWJkYXMgY2FuIHJlZmVyZW5jZSBpdFxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHF1ZXVlTmFtZSwgcXVldWUsIE91dHB1dFR5cGUuUVVFVUUsICdxdWV1ZU5hbWUnKTtcblxuICAgICAgICAvLyBTdG9yZSBxdWV1ZSBmb3IgcGhhc2UgM1xuICAgICAgICB0aGlzLnF1ZXVlTWFwLnNldChxdWV1ZU5hbWUsIHF1ZXVlKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAzOiBDcmVhdGVzIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIHF1ZXVlIChhZnRlciBhbGwgcXVldWVzIGFyZSByZWdpc3RlcmVkKVxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlUXVldWVMYW1iZGEgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnIHx8IHt9O1xuXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgOjo6U2tpcHBpbmcgbGFtYmRhIGNyZWF0aW9uIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGxhbWJkYSBmb3IgcXVldWUgJHtxdWV1ZU5hbWV9YCk7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBhbHJlYWR5LWNyZWF0ZWQgcXVldWVcbiAgICAgICAgY29uc3QgcXVldWUgPSB0aGlzLnF1ZXVlTWFwLmdldChxdWV1ZU5hbWUpO1xuICAgICAgICBpZiAoIXF1ZXVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUXVldWUgJHtxdWV1ZU5hbWV9IG5vdCBmb3VuZCBpbiBxdWV1ZU1hcGApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBzZXBhcmF0ZWx5IHVzaW5nIExhbWJkYUZ1bmN0aW9uIGNvbnN0cnVjdFxuICAgICAgICBjb25zdCBxdWV1ZUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBgJHtxdWV1ZU5hbWV9LXF1ZXVlLWxhbWJkYWAsIHtcbiAgICAgICAgICAgIGVudHJ5OiBxdWV1ZUluZm8uZmlsZVBhdGggKyBcIi9cIiArIHF1ZXVlSW5mby5maWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhxdWV1ZUNvbmZpZy5lbnYpLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IHF1ZXVlQ29uZmlnPy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogcXVldWVDb25maWc/LmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgcG9saWNpZXM6IHF1ZXVlQ29uZmlnPy5wb2xpY2llcyxcbiAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IG1lcmdlKFtcbiAgICAgICAgICAgICAgICB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMgPz8ge30sXG4gICAgICAgICAgICAgICAgcXVldWVDb25maWc/LmZ1bmN0aW9uUHJvcHMgPz8ge31cbiAgICAgICAgICAgIF0pISxcbiAgICAgICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IHF1ZXVlQ29uZmlnPy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogcXVldWVDb25maWc/LmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuXG4gICAgICAgIC8vIEF0dGFjaCBxdWV1ZSBhcyBldmVudCBzb3VyY2UgdXNpbmcgc3RhdGljIGhlbHBlciAoZW5zdXJlcyBjb25zaXN0ZW50IGV2ZW50IHNvdXJjZSBjb25maWd1cmF0aW9uKVxuICAgICAgICBRdWV1ZUxhbWJkYS5hdHRhY2hRdWV1ZVRvTGFtYmRhKHF1ZXVlRnVuY3Rpb24sIHF1ZXVlLCBxdWV1ZUNvbmZpZy5xdWV1ZVByb3BzLCBxdWV1ZU5hbWUsIHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHMpO1xuICAgIH1cbn1cbiJdfQ==