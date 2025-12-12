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
const layer_1 = require("./layer");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw2Q0FBeUQ7QUFFekQsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFJcEMsaURBQTZDO0FBRTdDLHdDQUF1RDtBQUN2RCx5Q0FBK0M7QUFHL0MsbUNBQXlDO0FBQ3pDLCtCQUFxQztBQUNyQyx1REFBbUQ7QUFDbkQsbUZBQXNFO0FBNEJ0RTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHO0FBQ0gsTUFBYSxjQUFjO0lBZU07SUFkcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0MsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUNuQyxZQUFZLEdBQWEsQ0FBQyw0QkFBaUIsQ0FBQyxJQUFJLEVBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMxRixNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUNELFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBaUIsQ0FBQztJQUVyRDs7O09BR0c7SUFDSCxZQUE2QixvQkFBMkM7UUFBM0MseUJBQW9CLEdBQXBCLG9CQUFvQixDQUF1QjtRQUNwRSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUN2RCxlQUFNLENBQUMsYUFBYSxDQUFDLG9CQUFvQixFQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFFRDs7T0FFRztJQUVVLEFBQU4sS0FBSyxDQUFDLFNBQVM7UUFDbEIsNkNBQTZDO1FBQzdDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FB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UyxJQUFJLENBQUM7WUFDMUQsaUJBQWlCLEVBQUUsV0FBVyxDQUFDLG1CQUFtQixFQUFFLGlCQUFpQixJQUFJLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM1Rix1QkFBdUIsRUFBRSxXQUFXLENBQUMsbUJBQW1CLEVBQUUsdUJBQXVCLElBQUksSUFBSTtTQUM1RixDQUFDO1FBRUYsYUFBYSxDQUFDLGNBQWMsQ0FBQyxJQUFJLHlDQUFjLENBQUMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLENBQUMsQ0FBQztJQUM5RSxDQUFDLENBQUE7Q0FDSjtBQWpMRCx3Q0FpTEM7QUF6SmdCO0lBRFosSUFBQSxxQkFBVyxHQUFFOytDQTJEYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENmbk91dHB1dCwgRHVyYXRpb24sIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5cbmltcG9ydCB7IFF1ZXVlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgUXVldWVMYW1iZGEgfSBmcm9tIFwiLi9xdWV1ZS1sYW1iZGFcIjtcbmltcG9ydCB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9sYW1iZGEtZW52XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgU3FzRXZlbnRTb3VyY2UgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYSBxdWV1ZSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVF1ZXVlQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIGRpcmVjdG9yeSB3aGVyZSBxdWV1ZXMgYXJlIHN0b3JlZC5cbiAgICAgKi9cbiAgICBxdWV1ZXNEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBxdWV1ZS5cbiAgICAgKi9cbiAgICBlbnY/OiBJTGFtYmRhRW52Q29uZmlnW107XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIGZ1bmN0aW9uLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhIFF1ZXVlQ29uc3RydWN0IHRoYXQgY3JlYXRlcyBhbmQgcmVnaXN0ZXJzIHF1ZXVlcyBpbiB0aGUgc3RhY2suXG4gKiBAaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0XG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIG5ldyBRdWV1ZUNvbnN0cnVjdCBpbnN0YW5jZVxuICogY29uc3QgcXVldWVDb25maWc6IElRdWV1ZUNvbnN0cnVjdENvbmZpZyA9IHtcbiAqICAgcXVldWVzRGlyZWN0b3J5OiBcIi4vc3JjL3F1ZXVlc1wiLFxuICogICBlbnY6IFtcbiAqICAgICB7IG5hbWU6IFwiUVVFVUVfTkFNRVwiLCBwcmVmaXg6IFwiUFJFRklYX1wiIH0sXG4gKiAgICAgeyBuYW1lOiBcIlFVRVVFX1VSTFwiIH1cbiAqICAgXSxcbiAqICAgcXVldWVQcm9wczoge1xuICogICAgIGZpZm86IHRydWUsXG4gKiAgICAgY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbjogdHJ1ZVxuICogICB9LFxuICogICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgbWVtb3J5U2l6ZTogNTEyXG4gKiAgIH1cbiAqIH07XG4gKiBjb25zdCBxdWV1ZUNvbnN0cnVjdCA9IG5ldyBRdWV1ZUNvbnN0cnVjdChxdWV1ZUNvbmZpZyk7XG4gKlxuICogYXBwLnVzZShxdWV1ZUNvbnN0cnVjdCk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXVlQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFF1ZXVlQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZTogc3RyaW5nID0gUXVldWVDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW0R5bmFtb0RCQ29uc3RydWN0Lm5hbWUsIFZwY0NvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG4gICAgcHJpdmF0ZSByZWFkb25seSBxdWV1ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBRdWV1ZT4oKTtcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvbi5cbiAgICAgKiBAcGFyYW0gcXVldWVDb25zdHJ1Y3RDb25maWcgVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBRdWV1ZUNvbnN0cnVjdC5cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHF1ZXVlQ29uc3RydWN0Q29uZmlnOiBJUXVldWVDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJjb25zdHJ1Y3RvclwiLCBxdWV1ZUNvbnN0cnVjdENvbmZpZyk7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHF1ZXVlQ29uc3RydWN0Q29uZmlnLCdTUVMnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2suXG4gICAgICovXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gbWFrZSB0aGUgZncyNCBpbnN0YW5jZSBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgcXVldWVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZih0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID09PSBcIlwiKXtcbiAgICAgICAgICAgIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID0gXCIuL3NyYy9xdWV1ZXNcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFR3by1waGFzZSBjb25zdHJ1Y3Rpb24gdG8gaGFuZGxlIGNyb3NzLXF1ZXVlIHJlZmVyZW5jZXM6XG4gICAgICAgIC8vIFBoYXNlIDE6IENvbGxlY3QgYWxsIHF1ZXVlIGRlc2NyaXB0b3JzXG4gICAgICAgIGNvbnN0IHF1ZXVlRGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW10gPSBbXTtcbiAgICAgICAgY29uc3QgY29sbGVjdFF1ZXVlID0gKHF1ZXVlSW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgICAgIHF1ZXVlRGVzY3JpcHRvcnMucHVzaChxdWV1ZUluZm8pO1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5LCBjb2xsZWN0UXVldWUpO1xuXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVzID0gdGhpcy5mdzI0LmdldE1vZHVsZXMoKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTIHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbW9kdWxlcyBcIiwgQXJyYXkuZnJvbShtb2R1bGVzLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbLCBtb2R1bGVdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXVlc0RpcmVjdG9yeSA9IG1vZHVsZS5nZXRRdWV1ZXNEaXJlY3RvcnkoKTtcbiAgICAgICAgICAgICAgICBpZihxdWV1ZXNEaXJlY3RvcnkgIT0gJycpe1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgcXVldWVzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZShtb2R1bGUsIGNvbGxlY3RRdWV1ZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBubyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBoYXNlIDI6IENyZWF0ZSBxdWV1ZXMgd2l0aG91dCBsYW1iZGFzIGFuZCByZWdpc3RlciB0aGVpciBVUkxzXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCfk4sgQ3JlYXRpbmcgJHtxdWV1ZURlc2NyaXB0b3JzLmxlbmd0aH0gcXVldWUocykuLi5gKTtcbiAgICAgICAgZm9yIChjb25zdCBxdWV1ZUluZm8gb2YgcXVldWVEZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgdGhpcy5jcmVhdGVBbmRSZWdpc3RlclF1ZXVlKHF1ZXVlSW5mbyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQaGFzZSAzOiBDcmVhdGUgbGFtYmRhIGZ1bmN0aW9ucyBmb3IgcXVldWVzIChub3cgYWxsIHF1ZXVlIFVSTHMgYXJlIHJlZ2lzdGVyZWQpXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYPCflKcgQ3JlYXRpbmcgTGFtYmRhIGZ1bmN0aW9ucyBmb3IgJHtxdWV1ZURlc2NyaXB0b3JzLmxlbmd0aH0gcXVldWUocykuLi5gKTtcbiAgICAgICAgbGV0IGNyZWF0ZWRDb3VudCA9IDA7XG4gICAgICAgIGxldCBza2lwcGVkQ291bnQgPSAwO1xuXG4gICAgICAgIGZvciAoY29uc3QgcXVldWVJbmZvIG9mIHF1ZXVlRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWc/LnF1ZXVlTmFtZSB8fCBxdWV1ZUluZm8uaGFuZGxlckNsYXNzLm5hbWU7XG4gICAgICAgICAgICBjb25zdCBpc01hbnVhbCA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWc/Lm1hbnVhbFJlZ2lzdHJhdGlvbjtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5jcmVhdGVRdWV1ZUxhbWJkYShxdWV1ZUluZm8pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoaXNNYW51YWwpIHtcbiAgICAgICAgICAgICAgICBza2lwcGVkQ291bnQrKztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY3JlYXRlZENvdW50Kys7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDinIUgUXVldWUgc2V0dXAgY29tcGxldGU6ICR7Y3JlYXRlZENvdW50fSBhY3RpdmUsICR7c2tpcHBlZENvdW50fSBtYW51YWxgKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAyOiBDcmVhdGVzIHF1ZXVlIHdpdGhvdXQgbGFtYmRhIGFuZCByZWdpc3RlcnMgaXRzIFVSTFxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlQW5kUmVnaXN0ZXJRdWV1ZSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgcXVldWVJbmZvLmhhbmRsZXJDbGFzcygpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIjo6OlF1ZXVlIGluc3RhbmNlOiBcIiwgcXVldWVJbmZvLmZpbGVOYW1lLCBxdWV1ZUluZm8uZmlsZVBhdGgpO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZU5hbWU7XG4gICAgICAgIGNvbnN0IHF1ZXVlQ29uZmlnID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZyB8fCB7fTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU2tpcHBpbmcgbWFudWFsIHJlZ2lzdHJhdGlvbiBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgcXVldWVQcm9wcyA9IHsuLi50aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlUHJvcHMsIC4uLnF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHN9O1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcblxuICAgICAgICAvLyBDcmVhdGUgcXVldWUgd2l0aG91dCBsYW1iZGEgKGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHVuZGVmaW5lZClcbiAgICAgICAgY29uc3QgcXVldWUgPSBuZXcgUXVldWVMYW1iZGEodGhpcy5tYWluU3RhY2ssIHF1ZXVlTmFtZSArIFwiLXF1ZXVlXCIsIHtcbiAgICAgICAgICAgIHF1ZXVlTmFtZTogcXVldWVOYW1lLFxuICAgICAgICAgICAgcXVldWVQcm9wczogcXVldWVQcm9wcyxcbiAgICAgICAgICAgIHZpc2liaWxpdHlUaW1lb3V0U2Vjb25kczogcXVldWVDb25maWc/LnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcyxcbiAgICAgICAgICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzOiBxdWV1ZUNvbmZpZz8ucmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHMsXG4gICAgICAgICAgICByZXRlbnRpb25QZXJpb2REYXlzOiBxdWV1ZUNvbmZpZz8ucmV0ZW50aW9uUGVyaW9kRGF5cyxcbiAgICAgICAgICAgIG1heFJlY2VpdmVDb3VudDogcXVldWVDb25maWc/Lm1heFJlY2VpdmVDb3VudCxcbiAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHtcbiAgICAgICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcyhxdWV1ZUNvbmZpZz8ubWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzID8/IDUpLFxuICAgICAgICAgICAgICAgIC4uLnF1ZXVlQ29uZmlnPy5zcXNFdmVudFNvdXJjZVByb3BzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN1YnNjcmlwdGlvbnM6IHF1ZXVlQ29uZmlnPy5zdWJzY3JpcHRpb25zLFxuICAgICAgICAgICAgbGFtYmRhRnVuY3Rpb25Qcm9wczogdW5kZWZpbmVkICAvLyBEb24ndCBjcmVhdGUgbGFtYmRhIHlldFxuICAgICAgICB9KSBhcyBRdWV1ZTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlZ2lzdGVyIHF1ZXVlIFVSTCBpbW1lZGlhdGVseSBzbyBvdGhlciBsYW1iZGFzIGNhbiByZWZlcmVuY2UgaXRcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBxdWV1ZU5hbWUsIHF1ZXVlLCBPdXRwdXRUeXBlLlFVRVVFLCAncXVldWVOYW1lJyk7XG4gICAgICAgIFxuICAgICAgICAvLyBTdG9yZSBxdWV1ZSBmb3IgcGhhc2UgM1xuICAgICAgICB0aGlzLnF1ZXVlTWFwLnNldChxdWV1ZU5hbWUsIHF1ZXVlKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAzOiBDcmVhdGVzIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIHF1ZXVlIChhZnRlciBhbGwgcXVldWVzIGFyZSByZWdpc3RlcmVkKVxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JlYXRlUXVldWVMYW1iZGEgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnIHx8IHt9O1xuXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgOjo6U2tpcHBpbmcgbGFtYmRhIGNyZWF0aW9uIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIGxhbWJkYSBmb3IgcXVldWUgJHtxdWV1ZU5hbWV9YCk7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBhbHJlYWR5LWNyZWF0ZWQgcXVldWVcbiAgICAgICAgY29uc3QgcXVldWUgPSB0aGlzLnF1ZXVlTWFwLmdldChxdWV1ZU5hbWUpO1xuICAgICAgICBpZiAoIXF1ZXVlKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUXVldWUgJHtxdWV1ZU5hbWV9IG5vdCBmb3VuZCBpbiBxdWV1ZU1hcGApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGxhbWJkYSBmdW5jdGlvbiBzZXBhcmF0ZWx5IHVzaW5nIExhbWJkYUZ1bmN0aW9uIGNvbnN0cnVjdFxuICAgICAgICBjb25zdCBxdWV1ZUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCBgJHtxdWV1ZU5hbWV9LXF1ZXVlLWxhbWJkYWAsIHtcbiAgICAgICAgICAgIGVudHJ5OiBxdWV1ZUluZm8uZmlsZVBhdGggKyBcIi9cIiArIHF1ZXVlSW5mby5maWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhxdWV1ZUNvbmZpZy5lbnYpLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IHF1ZXVlQ29uZmlnPy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogcXVldWVDb25maWc/LmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgcG9saWNpZXM6IHF1ZXVlQ29uZmlnPy5wb2xpY2llcyxcbiAgICAgICAgICAgIGZ1bmN0aW9uUHJvcHM6IHsuLi50aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMsIC4uLnF1ZXVlQ29uZmlnPy5mdW5jdGlvblByb3BzfSxcbiAgICAgICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IHF1ZXVlQ29uZmlnPy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogcXVldWVDb25maWc/LmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuXG4gICAgICAgIC8vIEF0dGFjaCBxdWV1ZSBhcyBldmVudCBzb3VyY2VcbiAgICAgICAgY29uc3QgaXNGaWZvUXVldWUgPSBIZWxwZXIuaXNGaWZvUXVldWVQcm9wcyh7IFxuICAgICAgICAgICAgLi4uKHF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHMgfHwge30pLCBcbiAgICAgICAgICAgIHF1ZXVlTmFtZTogcXVldWVOYW1lIFxuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGV2ZW50U291cmNlUHJvcHMgPSBpc0ZpZm9RdWV1ZSA/IHt9IDoge1xuICAgICAgICAgICAgYmF0Y2hTaXplOiBxdWV1ZUNvbmZpZy5zcXNFdmVudFNvdXJjZVByb3BzPy5iYXRjaFNpemUgPz8gMSxcbiAgICAgICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBxdWV1ZUNvbmZpZy5zcXNFdmVudFNvdXJjZVByb3BzPy5tYXhCYXRjaGluZ1dpbmRvdyA/PyBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgICAgICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHM/LnJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzID8/IHRydWUsXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICBxdWV1ZUZ1bmN0aW9uLmFkZEV2ZW50U291cmNlKG5ldyBTcXNFdmVudFNvdXJjZShxdWV1ZSwgZXZlbnRTb3VyY2VQcm9wcykpO1xuICAgIH1cbn1cbiJdfQ==