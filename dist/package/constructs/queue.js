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
const mailer_1 = require("./mailer");
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
    dependencies = [dynamodb_1.DynamoDBConstruct.name, vpc_1.VpcConstruct.name, layer_1.LayerConstruct.name, mailer_1.MailerConstruct.name];
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
            allowSendEmail: queueConfig?.allowSendEmail !== false,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFFQSwyQ0FBd0M7QUFDeEMsdURBQXlGO0FBQ3pGLHVDQUFvQztBQUlwQyxpREFBNkM7QUFFN0Msd0NBQXVEO0FBQ3ZELHlDQUErQztBQUMvQyxxQ0FBMkM7QUFHM0MsbUNBQXlDO0FBQ3pDLCtCQUFxQztBQUNyQyx1REFBbUQ7QUFDbkQsb0NBQWlDO0FBNEJqQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHO0FBQ0gsTUFBYSxjQUFjO0lBZU07SUFkcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0MsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUNuQyxZQUFZLEdBQWEsQ0FBRSw0QkFBaUIsQ0FBQyxJQUFJLEVBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLEVBQUUsd0JBQWUsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUNsSCxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUNELFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBaUIsQ0FBQztJQUVyRDs7O09BR0c7SUFDSCxZQUE2QixvQkFBMkM7UUFBM0MseUJBQW9CLEdBQXBCLG9CQUFvQixDQUF1QjtRQUNwRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUN2RCxlQUFNLENBQUMsYUFBYSxDQUFDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3RELENBQUM7SUFFRDs7T0FFRztJQUVVLEFBQU4sS0FBSyxDQUFDLFNBQVM7UUFDbEIsNkNBQTZDO1FBQzdDLElBQUksQ0FBQyxTQUFTLEdB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Q0FBQztRQUVELG1FQUFtRTtRQUNuRSxNQUFNLGFBQWEsR0FBRyxJQUFJLGdDQUFjLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLFNBQVMsZUFBZSxFQUFFO1lBQ2xGLEtBQUssRUFBRSxTQUFTLENBQUMsUUFBUSxHQUFHLEdBQUcsR0FBRyxTQUFTLENBQUMsUUFBUTtZQUNwRCxvQkFBb0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUM7WUFDcEUsY0FBYyxFQUFFLFdBQVcsRUFBRSxjQUFjO1lBQzNDLGNBQWMsRUFBRSxXQUFXLEVBQUUsY0FBYyxLQUFLLEtBQUs7WUFDckQsZUFBZSxFQUFFLFdBQVcsRUFBRSxlQUFlLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxlQUFlO1lBQ3RGLFFBQVEsRUFBRSxXQUFXLEVBQUUsUUFBUTtZQUMvQixhQUFhLEVBQUUsSUFBQSxhQUFLLEVBQUM7Z0JBQ2pCLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLElBQUksRUFBRTtnQkFDN0MsV0FBVyxFQUFFLGFBQWEsSUFBSSxFQUFFO2FBQ25DLENBQUU7WUFDSCxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCO1lBQy9DLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxnQkFBZ0I7U0FDbEQsQ0FBbUIsQ0FBQztRQUVyQixtR0FBbUc7UUFDbkcsMEJBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLFdBQVcsQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0lBQzlILENBQUMsQ0FBQTtDQUNKO0FBcktELHdDQXFLQztBQTdJZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7K0NBMkRiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuT3V0cHV0LCBEdXJhdGlvbiwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgUXVldWVQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBRdWV1ZUxhbWJkYSB9IGZyb20gXCIuL3F1ZXVlLWxhbWJkYVwiO1xuaW1wb3J0IHsgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2xhbWJkYS1lbnZcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9keW5hbW9kYlwiO1xuaW1wb3J0IHsgTWFpbGVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbWFpbGVyXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYSBxdWV1ZSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVF1ZXVlQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIGRpcmVjdG9yeSB3aGVyZSBxdWV1ZXMgYXJlIHN0b3JlZC5cbiAgICAgKi9cbiAgICBxdWV1ZXNEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBxdWV1ZS5cbiAgICAgKi9cbiAgICBlbnY/OiBJTGFtYmRhRW52Q29uZmlnW107XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIGZ1bmN0aW9uLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhIFF1ZXVlQ29uc3RydWN0IHRoYXQgY3JlYXRlcyBhbmQgcmVnaXN0ZXJzIHF1ZXVlcyBpbiB0aGUgc3RhY2suXG4gKiBAaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0XG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIG5ldyBRdWV1ZUNvbnN0cnVjdCBpbnN0YW5jZVxuICogY29uc3QgcXVldWVDb25maWc6IElRdWV1ZUNvbnN0cnVjdENvbmZpZyA9IHtcbiAqICAgcXVldWVzRGlyZWN0b3J5OiBcIi4vc3JjL3F1ZXVlc1wiLFxuICogICBlbnY6IFtcbiAqICAgICB7IG5hbWU6IFwiUVVFVUVfTkFNRVwiLCBwcmVmaXg6IFwiUFJFRklYX1wiIH0sXG4gKiAgICAgeyBuYW1lOiBcIlFVRVVFX1VSTFwiIH1cbiAqICAgXSxcbiAqICAgcXVldWVQcm9wczoge1xuICogICAgIGZpZm86IHRydWUsXG4gKiAgICAgY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbjogdHJ1ZVxuICogICB9LFxuICogICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgbWVtb3J5U2l6ZTogNTEyXG4gKiAgIH1cbiAqIH07XG4gKiBjb25zdCBxdWV1ZUNvbnN0cnVjdCA9IG5ldyBRdWV1ZUNvbnN0cnVjdChxdWV1ZUNvbmZpZyk7XG4gKlxuICogYXBwLnVzZShxdWV1ZUNvbnN0cnVjdCk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXVlQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFF1ZXVlQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG5cbiAgICBuYW1lOiBzdHJpbmcgPSBRdWV1ZUNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbIER5bmFtb0RCQ29uc3RydWN0Lm5hbWUsIFZwY0NvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lLCBNYWlsZXJDb25zdHJ1Y3QubmFtZSBdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcbiAgICBwcml2YXRlIHJlYWRvbmx5IHF1ZXVlTWFwID0gbmV3IE1hcDxzdHJpbmcsIFF1ZXVlPigpO1xuXG4gICAgLyoqXG4gICAgICogRGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uLlxuICAgICAqIEBwYXJhbSBxdWV1ZUNvbnN0cnVjdENvbmZpZyBUaGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIFF1ZXVlQ29uc3RydWN0LlxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcXVldWVDb25zdHJ1Y3RDb25maWc6IElRdWV1ZUNvbnN0cnVjdENvbmZpZykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcImNvbnN0cnVjdG9yXCIsIHF1ZXVlQ29uc3RydWN0Q29uZmlnKTtcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcocXVldWVDb25zdHJ1Y3RDb25maWcsICdTUVMnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2suXG4gICAgICovXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gbWFrZSB0aGUgZncyNCBpbnN0YW5jZSBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgcXVldWVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZiAodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9PT0gXCJcIikge1xuICAgICAgICAgICAgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPSBcIi4vc3JjL3F1ZXVlc1wiO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVHdvLXBoYXNlIGNvbnN0cnVjdGlvbiB0byBoYW5kbGUgY3Jvc3MtcXVldWUgcmVmZXJlbmNlczpcbiAgICAgICAgLy8gUGhhc2UgMTogQ29sbGVjdCBhbGwgcXVldWUgZGVzY3JpcHRvcnNcbiAgICAgICAgY29uc3QgcXVldWVEZXNjcmlwdG9yczogSGFuZGxlckRlc2NyaXB0b3JbXSA9IFtdO1xuICAgICAgICBjb25zdCBjb2xsZWN0UXVldWUgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICAgICAgcXVldWVEZXNjcmlwdG9ycy5wdXNoKHF1ZXVlSW5mbyk7XG4gICAgICAgIH07XG5cbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnksIGNvbGxlY3RRdWV1ZSk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBtb2R1bGVzIFwiLCBBcnJheS5mcm9tKG1vZHVsZXMua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZXNEaXJlY3RvcnkgPSBtb2R1bGUuZ2V0UXVldWVzRGlyZWN0b3J5KCk7XG4gICAgICAgICAgICAgICAgaWYgKHF1ZXVlc0RpcmVjdG9yeSAhPSAnJykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgcXVldWVzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZShtb2R1bGUsIGNvbGxlY3RRdWV1ZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBubyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBoYXNlIDI6IENyZWF0ZSBxdWV1ZXMgd2l0aG91dCBsYW1iZGFzIGFuZCByZWdpc3RlciB0aGVpciBVUkxzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfk4sgQ3JlYXRpbmcgJHtxdWV1ZURlc2NyaXB0b3JzLmxlbmd0aH0gcXVldWUocykuLi5gKTtcbiAgICAgICAgZm9yIChjb25zdCBxdWV1ZUluZm8gb2YgcXVldWVEZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgdGhpcy5jcmVhdGVBbmRSZWdpc3RlclF1ZXVlKHF1ZXVlSW5mbyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQaGFzZSAzOiBDcmVhdGUgbGFtYmRhIGZ1bmN0aW9ucyBmb3IgcXVldWVzIChub3cgYWxsIHF1ZXVlIFVSTHMgYXJlIHJlZ2lzdGVyZWQpXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCflKcgQ3JlYXRpbmcgTGFtYmRhIGZ1bmN0aW9ucyBmb3IgJHtxdWV1ZURlc2NyaXB0b3JzLmxlbmd0aH0gcXVldWUocykuLi5gKTtcbiAgICAgICAgbGV0IGNyZWF0ZWRDb3VudCA9IDA7XG4gICAgICAgIGxldCBza2lwcGVkQ291bnQgPSAwO1xuXG4gICAgICAgIGZvciAoY29uc3QgcXVldWVJbmZvIG9mIHF1ZXVlRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWc/LnF1ZXVlTmFtZSB8fCBxdWV1ZUluZm8uaGFuZGxlckNsYXNzLm5hbWU7XG4gICAgICAgICAgICBjb25zdCBpc01hbnVhbCA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWc/Lm1hbnVhbFJlZ2lzdHJhdGlvbjtcblxuICAgICAgICAgICAgdGhpcy5jcmVhdGVRdWV1ZUxhbWJkYShxdWV1ZUluZm8pO1xuXG4gICAgICAgICAgICBpZiAoaXNNYW51YWwpIHtcbiAgICAgICAgICAgICAgICBza2lwcGVkQ291bnQrKztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY3JlYXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgUXVldWUgc2V0dXAgY29tcGxldGU6ICR7Y3JlYXRlZENvdW50fSBhY3RpdmUsICR7c2tpcHBlZENvdW50fSBtYW51YWxgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAyOiBDcmVhdGVzIHF1ZXVlIHdpdGhvdXQgbGFtYmRhIGFuZCByZWdpc3RlcnMgaXRzIFVSTFxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlQW5kUmVnaXN0ZXJRdWV1ZSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgcXVldWVJbmZvLmhhbmRsZXJDbGFzcygpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIjo6OlF1ZXVlIGluc3RhbmNlOiBcIiwgcXVldWVJbmZvLmZpbGVOYW1lLCBxdWV1ZUluZm8uZmlsZVBhdGgpO1xuXG4gICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVOYW1lO1xuICAgICAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWcgfHwge307XG5cbiAgICAgICAgLy8gU2tpcCBxdWV1ZXMgbWFya2VkIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uXG4gICAgICAgIGlmIChxdWV1ZUNvbmZpZy5tYW51YWxSZWdpc3RyYXRpb24pIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBTa2lwcGluZyBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcXVldWVQcm9wcyA9IHsgLi4udGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZVByb3BzLCAuLi5xdWV1ZUNvbmZpZy5xdWV1ZVByb3BzIH07XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuXG4gICAgICAgIC8vIENyZWF0ZSBxdWV1ZSB3aXRoIHN1YnNjcmlwdGlvbnMgdXNpbmcgc3RhdGljIGhlbHBlclxuICAgICAgICAvLyBUaGlzIGVuc3VyZXMgY29uc2lzdGVudCBETFEgc2V0dXAsIHRpbWVvdXQgY29uZmlndXJhdGlvbiwgYW5kIHRvcGljIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZSh0aGlzLm1haW5TdGFjaywgcXVldWVOYW1lICsgXCItcXVldWVcIiwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiBxdWV1ZVByb3BzLFxuICAgICAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzOiBxdWV1ZUNvbmZpZz8udmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzLFxuICAgICAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHM6IHF1ZXVlQ29uZmlnPy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyxcbiAgICAgICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IHF1ZXVlQ29uZmlnPy5yZXRlbnRpb25QZXJpb2REYXlzLFxuICAgICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiBxdWV1ZUNvbmZpZz8ubWF4UmVjZWl2ZUNvdW50LFxuICAgICAgICB9LCBxdWV1ZUNvbmZpZz8uc3Vic2NyaXB0aW9ucyk7XG5cbiAgICAgICAgLy8gUmVnaXN0ZXIgcXVldWUgVVJMIGltbWVkaWF0ZWx5IHNvIG90aGVyIGxhbWJkYXMgY2FuIHJlZmVyZW5jZSBpdFxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHF1ZXVlTmFtZSwgcXVldWUsIE91dHB1dFR5cGUuUVVFVUUsICdxdWV1ZU5hbWUnKTtcblxuICAgICAgICAvLyBTdG9yZSBxdWV1ZSBmb3IgcGhhc2UgM1xuICAgICAgICB0aGlzLnF1ZXVlTWFwLnNldChxdWV1ZU5hbWUsIHF1ZXVlKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAzOiBDcmVhdGVzIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIHF1ZXVlIChhZnRlciBhbGwgcXVldWVzIGFyZSByZWdpc3RlcmVkKVxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlUXVldWVMYW1iZGEgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnIHx8IHt9O1xuXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgOjo6U2tpcHBpbmcgbGFtYmRhIGNyZWF0aW9uIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGxhbWJkYSBmb3IgcXVldWUgJHtxdWV1ZU5hbWV9YCk7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBhbHJlYWR5LWNyZWF0ZWQgcXVldWVcbiAgICAgICAgY29uc3QgcXVldWUgPSB0aGlzLnF1ZXVlTWFwLmdldChxdWV1ZU5hbWUpO1xuICAgICAgICBpZiAoIXF1ZXVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUXVldWUgJHtxdWV1ZU5hbWV9IG5vdCBmb3VuZCBpbiBxdWV1ZU1hcGApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBzZXBhcmF0ZWx5IHVzaW5nIExhbWJkYUZ1bmN0aW9uIGNvbnN0cnVjdFxuICAgICAgICBjb25zdCBxdWV1ZUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBgJHtxdWV1ZU5hbWV9LXF1ZXVlLWxhbWJkYWAsIHtcbiAgICAgICAgICAgIGVudHJ5OiBxdWV1ZUluZm8uZmlsZVBhdGggKyBcIi9cIiArIHF1ZXVlSW5mby5maWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhxdWV1ZUNvbmZpZy5lbnYpLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IHF1ZXVlQ29uZmlnPy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiBxdWV1ZUNvbmZpZz8uYWxsb3dTZW5kRW1haWwgIT09IGZhbHNlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiBxdWV1ZUNvbmZpZz8uZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICBwb2xpY2llczogcXVldWVDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogbWVyZ2UoW1xuICAgICAgICAgICAgICAgIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcyA/PyB7fSxcbiAgICAgICAgICAgICAgICBxdWV1ZUNvbmZpZz8uZnVuY3Rpb25Qcm9wcyA/PyB7fVxuICAgICAgICAgICAgXSkhLFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogcXVldWVDb25maWc/LmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiBxdWV1ZUNvbmZpZz8ubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgLy8gQXR0YWNoIHF1ZXVlIGFzIGV2ZW50IHNvdXJjZSB1c2luZyBzdGF0aWMgaGVscGVyIChlbnN1cmVzIGNvbnNpc3RlbnQgZXZlbnQgc291cmNlIGNvbmZpZ3VyYXRpb24pXG4gICAgICAgIFF1ZXVlTGFtYmRhLmF0dGFjaFF1ZXVlVG9MYW1iZGEocXVldWVGdW5jdGlvbiwgcXVldWUsIHF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHMsIHF1ZXVlTmFtZSwgcXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcyk7XG4gICAgfVxufVxuIl19