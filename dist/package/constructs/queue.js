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
        for (const queueInfo of queueDescriptors) {
            this.createAndRegisterQueue(queueInfo);
        }
        // Phase 3: Create lambda functions for queues (now all queue URLs are registered)
        for (const queueInfo of queueDescriptors) {
            this.createQueueLambda(queueInfo);
        }
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
            this.logger.info(`:::Skipping manual registration queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);
            return;
        }
        const queueProps = { ...this.queueConstructConfig.queueProps, ...queueConfig.queueProps };
        this.logger.info(`:::Creating queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);
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
        this.logger.info(`:::Creating lambda for queue ${queueName}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw2Q0FBeUQ7QUFFekQsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFJcEMsaURBQTZDO0FBRTdDLHdDQUF1RDtBQUN2RCx5Q0FBK0M7QUFHL0MsK0JBQXFDO0FBQ3JDLHVEQUFtRDtBQUNuRCxtRkFBc0U7QUE0QnRFOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Qkc7QUFDSCxNQUFhLGNBQWM7SUFlSDtJQWRYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDbkMsWUFBWSxHQUFhLENBQUMsNEJBQWlCLENBQUMsSUFBSSxFQUFFLGtCQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDckUsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFDVixRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQWlCLENBQUM7SUFFNUM7OztPQUdHO0lBQ0gsWUFBb0Isb0JBQTJDO1FBQTNDLHlCQUFvQixHQUFwQixvQkFBb0IsQ0FBdUI7UUFDM0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLG9CQUFvQixDQUFDLENBQUM7UUFDdkQsZUFBTSxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsRUFBQyxLQUFLLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQ7O09BRUc7SUFFVSxBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLDZDQUE2QztRQUM3QyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxT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QixhQUFhLEVBQUUsRUFBQyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLEVBQUUsR0FBRyxXQUFXLEVBQUUsYUFBYSxFQUFDO1lBQzFGLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxnQkFBZ0I7WUFDL0MsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLGdCQUFnQjtTQUNsRCxDQUFtQixDQUFDO1FBRXJCLCtCQUErQjtRQUMvQixNQUFNLFdBQVcsR0FBRyxlQUFNLENBQUMsZ0JBQWdCLENBQUM7WUFDeEMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDO1lBQ2pDLFNBQVMsRUFBRSxTQUFTO1NBQ3ZCLENBQUMsQ0FBQztRQUVILE1BQU0sZ0JBQWdCLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3hDLFNBQVMsRUFBRSxXQUFXLENBQUMsbUJBQW1CLEVBQUUsU0FBUyxJQUFJLENBQUM7WUFDMUQsaUJBQWlCLEVBQUUsV0FBVyxDQUFDLG1CQUFtQixFQUFFLGlCQUFpQixJQUFJLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM1Rix1QkFBdUIsRUFBRSxXQUFXLENBQUMsbUJBQW1CLEVBQUUsdUJBQXVCLElBQUksSUFBSTtTQUM1RixDQUFDO1FBRUYsYUFBYSxDQUFDLGNBQWMsQ0FBQyxJQUFJLHlDQUFjLENBQUMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLENBQUMsQ0FBQztJQUM5RSxDQUFDLENBQUE7Q0FDSjtBQWpLRCx3Q0FpS0M7QUF6SWdCO0lBRFosSUFBQSxxQkFBVyxHQUFFOytDQTJDYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENmbk91dHB1dCwgRHVyYXRpb24sIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5cbmltcG9ydCB7IFF1ZXVlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgUXVldWVMYW1iZGEgfSBmcm9tIFwiLi9xdWV1ZS1sYW1iZGFcIjtcbmltcG9ydCB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9sYW1iZGEtZW52XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgU3FzRXZlbnRTb3VyY2UgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgYSBxdWV1ZSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVF1ZXVlQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIGRpcmVjdG9yeSB3aGVyZSBxdWV1ZXMgYXJlIHN0b3JlZC5cbiAgICAgKi9cbiAgICBxdWV1ZXNEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIHF1ZXVlUHJvcHM/OiBRdWV1ZVByb3BzO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBxdWV1ZS5cbiAgICAgKi9cbiAgICBlbnY/OiBJTGFtYmRhRW52Q29uZmlnW107XG5cbiAgICAvKipcbiAgICAgKiBUaGUgcHJvcGVydGllcyBmb3IgdGhlIGZ1bmN0aW9uLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xufVxuXG5cbi8qKlxuICogUmVwcmVzZW50cyBhIFF1ZXVlQ29uc3RydWN0IHRoYXQgY3JlYXRlcyBhbmQgcmVnaXN0ZXJzIHF1ZXVlcyBpbiB0aGUgc3RhY2suXG4gKiBAaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0XG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIENyZWF0ZSBhIG5ldyBRdWV1ZUNvbnN0cnVjdCBpbnN0YW5jZVxuICogY29uc3QgcXVldWVDb25maWc6IElRdWV1ZUNvbnN0cnVjdENvbmZpZyA9IHtcbiAqICAgcXVldWVzRGlyZWN0b3J5OiBcIi4vc3JjL3F1ZXVlc1wiLFxuICogICBlbnY6IFtcbiAqICAgICB7IG5hbWU6IFwiUVVFVUVfTkFNRVwiLCBwcmVmaXg6IFwiUFJFRklYX1wiIH0sXG4gKiAgICAgeyBuYW1lOiBcIlFVRVVFX1VSTFwiIH1cbiAqICAgXSxcbiAqICAgcXVldWVQcm9wczoge1xuICogICAgIGZpZm86IHRydWUsXG4gKiAgICAgY29udGVudEJhc2VkRGVkdXBsaWNhdGlvbjogdHJ1ZVxuICogICB9LFxuICogICBmdW5jdGlvblByb3BzOiB7XG4gKiAgICAgbWVtb3J5U2l6ZTogNTEyXG4gKiAgIH1cbiAqIH07XG4gKiBjb25zdCBxdWV1ZUNvbnN0cnVjdCA9IG5ldyBRdWV1ZUNvbnN0cnVjdChxdWV1ZUNvbmZpZyk7XG4gKlxuICogYXBwLnVzZShxdWV1ZUNvbnN0cnVjdCk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXVlQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFF1ZXVlQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZTogc3RyaW5nID0gUXVldWVDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW0R5bmFtb0RCQ29uc3RydWN0Lm5hbWUsIFZwY0NvbnN0cnVjdC5uYW1lXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG4gICAgcHJpdmF0ZSBxdWV1ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBRdWV1ZT4oKTtcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvbi5cbiAgICAgKiBAcGFyYW0gcXVldWVDb25zdHJ1Y3RDb25maWcgVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBRdWV1ZUNvbnN0cnVjdC5cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHF1ZXVlQ29uc3RydWN0Q29uZmlnOiBJUXVldWVDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJjb25zdHJ1Y3RvclwiLCBxdWV1ZUNvbnN0cnVjdENvbmZpZyk7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHF1ZXVlQ29uc3RydWN0Q29uZmlnLCdTUVMnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2suXG4gICAgICovXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gbWFrZSB0aGUgZncyNCBpbnN0YW5jZSBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgcXVldWVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZih0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID09PSBcIlwiKXtcbiAgICAgICAgICAgIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID0gXCIuL3NyYy9xdWV1ZXNcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFR3by1waGFzZSBjb25zdHJ1Y3Rpb24gdG8gaGFuZGxlIGNyb3NzLXF1ZXVlIHJlZmVyZW5jZXM6XG4gICAgICAgIC8vIFBoYXNlIDE6IENvbGxlY3QgYWxsIHF1ZXVlIGRlc2NyaXB0b3JzXG4gICAgICAgIGNvbnN0IHF1ZXVlRGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW10gPSBbXTtcbiAgICAgICAgY29uc3QgY29sbGVjdFF1ZXVlID0gKHF1ZXVlSW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgICAgIHF1ZXVlRGVzY3JpcHRvcnMucHVzaChxdWV1ZUluZm8pO1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5LCBjb2xsZWN0UXVldWUpO1xuXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVzID0gdGhpcy5mdzI0LmdldE1vZHVsZXMoKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTIHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbW9kdWxlcyBcIiwgQXJyYXkuZnJvbShtb2R1bGVzLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbLCBtb2R1bGVdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHF1ZXVlc0RpcmVjdG9yeSA9IG1vZHVsZS5nZXRRdWV1ZXNEaXJlY3RvcnkoKTtcbiAgICAgICAgICAgICAgICBpZihxdWV1ZXNEaXJlY3RvcnkgIT0gJycpe1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIkxvYWQgcXVldWVzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVyUXVldWVzRnJvbU1vZHVsZShtb2R1bGUsIGNvbGxlY3RRdWV1ZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBubyBtb2R1bGVzIFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBoYXNlIDI6IENyZWF0ZSBxdWV1ZXMgd2l0aG91dCBsYW1iZGFzIGFuZCByZWdpc3RlciB0aGVpciBVUkxzXG4gICAgICAgIGZvciAoY29uc3QgcXVldWVJbmZvIG9mIHF1ZXVlRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kUmVnaXN0ZXJRdWV1ZShxdWV1ZUluZm8pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGhhc2UgMzogQ3JlYXRlIGxhbWJkYSBmdW5jdGlvbnMgZm9yIHF1ZXVlcyAobm93IGFsbCBxdWV1ZSBVUkxzIGFyZSByZWdpc3RlcmVkKVxuICAgICAgICBmb3IgKGNvbnN0IHF1ZXVlSW5mbyBvZiBxdWV1ZURlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgICB0aGlzLmNyZWF0ZVF1ZXVlTGFtYmRhKHF1ZXVlSW5mbyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAyOiBDcmVhdGVzIHF1ZXVlIHdpdGhvdXQgbGFtYmRhIGFuZCByZWdpc3RlcnMgaXRzIFVSTFxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlQW5kUmVnaXN0ZXJRdWV1ZSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgcXVldWVJbmZvLmhhbmRsZXJDbGFzcygpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIjo6OlF1ZXVlIGluc3RhbmNlOiBcIiwgcXVldWVJbmZvLmZpbGVOYW1lLCBxdWV1ZUluZm8uZmlsZVBhdGgpO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZU5hbWU7XG4gICAgICAgIGNvbnN0IHF1ZXVlQ29uZmlnID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZyB8fCB7fTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGA6OjpTa2lwcGluZyBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfSBmcm9tICR7cXVldWVJbmZvLmZpbGVQYXRofS8ke3F1ZXVlSW5mby5maWxlTmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc3QgcXVldWVQcm9wcyA9IHsuLi50aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlUHJvcHMsIC4uLnF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHN9O1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYDo6OkNyZWF0aW5nIHF1ZXVlICR7cXVldWVOYW1lfSBmcm9tICR7cXVldWVJbmZvLmZpbGVQYXRofS8ke3F1ZXVlSW5mby5maWxlTmFtZX1gKTtcblxuICAgICAgICAvLyBDcmVhdGUgcXVldWUgd2l0aG91dCBsYW1iZGEgKGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHVuZGVmaW5lZClcbiAgICAgICAgY29uc3QgcXVldWUgPSBuZXcgUXVldWVMYW1iZGEodGhpcy5tYWluU3RhY2ssIHF1ZXVlTmFtZSArIFwiLXF1ZXVlXCIsIHtcbiAgICAgICAgICAgIHF1ZXVlTmFtZTogcXVldWVOYW1lLFxuICAgICAgICAgICAgcXVldWVQcm9wczogcXVldWVQcm9wcyxcbiAgICAgICAgICAgIHZpc2liaWxpdHlUaW1lb3V0U2Vjb25kczogcXVldWVDb25maWc/LnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcyxcbiAgICAgICAgICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzOiBxdWV1ZUNvbmZpZz8ucmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHMsXG4gICAgICAgICAgICByZXRlbnRpb25QZXJpb2REYXlzOiBxdWV1ZUNvbmZpZz8ucmV0ZW50aW9uUGVyaW9kRGF5cyxcbiAgICAgICAgICAgIG1heFJlY2VpdmVDb3VudDogcXVldWVDb25maWc/Lm1heFJlY2VpdmVDb3VudCxcbiAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHtcbiAgICAgICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcyhxdWV1ZUNvbmZpZz8ubWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzID8/IDUpLFxuICAgICAgICAgICAgICAgIC4uLnF1ZXVlQ29uZmlnPy5zcXNFdmVudFNvdXJjZVByb3BzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHN1YnNjcmlwdGlvbnM6IHF1ZXVlQ29uZmlnPy5zdWJzY3JpcHRpb25zLFxuICAgICAgICAgICAgbGFtYmRhRnVuY3Rpb25Qcm9wczogdW5kZWZpbmVkICAvLyBEb24ndCBjcmVhdGUgbGFtYmRhIHlldFxuICAgICAgICB9KSBhcyBRdWV1ZTtcbiAgICAgICAgXG4gICAgICAgIC8vIFJlZ2lzdGVyIHF1ZXVlIFVSTCBpbW1lZGlhdGVseSBzbyBvdGhlciBsYW1iZGFzIGNhbiByZWZlcmVuY2UgaXRcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBxdWV1ZU5hbWUsIHF1ZXVlLCBPdXRwdXRUeXBlLlFVRVVFLCAncXVldWVOYW1lJyk7XG4gICAgICAgIFxuICAgICAgICAvLyBTdG9yZSBxdWV1ZSBmb3IgcGhhc2UgM1xuICAgICAgICB0aGlzLnF1ZXVlTWFwLnNldChxdWV1ZU5hbWUsIHF1ZXVlKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBQaGFzZSAzOiBDcmVhdGVzIGxhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIHF1ZXVlIChhZnRlciBhbGwgcXVldWVzIGFyZSByZWdpc3RlcmVkKVxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlUXVldWVMYW1iZGEgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnIHx8IHt9O1xuXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgOjo6U2tpcHBpbmcgbGFtYmRhIGNyZWF0aW9uIGZvciBtYW51YWwgcmVnaXN0cmF0aW9uIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgOjo6Q3JlYXRpbmcgbGFtYmRhIGZvciBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcblxuICAgICAgICAvLyBHZXQgdGhlIGFscmVhZHktY3JlYXRlZCBxdWV1ZVxuICAgICAgICBjb25zdCBxdWV1ZSA9IHRoaXMucXVldWVNYXAuZ2V0KHF1ZXVlTmFtZSk7XG4gICAgICAgIGlmICghcXVldWUpIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKGBRdWV1ZSAke3F1ZXVlTmFtZX0gbm90IGZvdW5kIGluIHF1ZXVlTWFwYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgbGFtYmRhIGZ1bmN0aW9uIHNlcGFyYXRlbHkgdXNpbmcgTGFtYmRhRnVuY3Rpb24gY29uc3RydWN0XG4gICAgICAgIGNvbnN0IHF1ZXVlRnVuY3Rpb24gPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIGAke3F1ZXVlTmFtZX0tcXVldWUtbGFtYmRhYCwge1xuICAgICAgICAgICAgZW50cnk6IHF1ZXVlSW5mby5maWxlUGF0aCArIFwiL1wiICsgcXVldWVJbmZvLmZpbGVOYW1lLFxuICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHRoaXMuZncyNC5yZXNvbHZlRW52VmFyaWFibGVzKHF1ZXVlQ29uZmlnLmVudiksXG4gICAgICAgICAgICByZXNvdXJjZUFjY2VzczogcXVldWVDb25maWc/LnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiBxdWV1ZUNvbmZpZz8uZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICBwb2xpY2llczogcXVldWVDb25maWc/LnBvbGljaWVzLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogey4uLnRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcywgLi4ucXVldWVDb25maWc/LmZ1bmN0aW9uUHJvcHN9LFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogcXVldWVDb25maWc/LmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiBxdWV1ZUNvbmZpZz8ubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgLy8gQXR0YWNoIHF1ZXVlIGFzIGV2ZW50IHNvdXJjZVxuICAgICAgICBjb25zdCBpc0ZpZm9RdWV1ZSA9IEhlbHBlci5pc0ZpZm9RdWV1ZVByb3BzKHsgXG4gICAgICAgICAgICAuLi4ocXVldWVDb25maWcucXVldWVQcm9wcyB8fCB7fSksIFxuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUgXG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZXZlbnRTb3VyY2VQcm9wcyA9IGlzRmlmb1F1ZXVlID8ge30gOiB7XG4gICAgICAgICAgICBiYXRjaFNpemU6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHM/LmJhdGNoU2l6ZSA/PyAxLFxuICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IHF1ZXVlQ29uZmlnLnNxc0V2ZW50U291cmNlUHJvcHM/Lm1heEJhdGNoaW5nV2luZG93ID8/IER1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogcXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcz8ucmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXMgPz8gdHJ1ZSxcbiAgICAgICAgfTtcbiAgICAgICAgXG4gICAgICAgIHF1ZXVlRnVuY3Rpb24uYWRkRXZlbnRTb3VyY2UobmV3IFNxc0V2ZW50U291cmNlKHF1ZXVlLCBldmVudFNvdXJjZVByb3BzKSk7XG4gICAgfVxufVxuIl19