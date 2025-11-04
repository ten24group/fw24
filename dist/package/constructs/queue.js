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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw2Q0FBeUQ7QUFFekQsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFJcEMsaURBQTZDO0FBRTdDLHdDQUF1RDtBQUN2RCx5Q0FBK0M7QUFHL0MsK0JBQXFDO0FBQ3JDLHVEQUFtRDtBQUNuRCxtRkFBc0U7QUE0QnRFOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Qkc7QUFDSCxNQUFhLGNBQWM7SUFlSDtJQWRYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDbkMsWUFBWSxHQUFhLENBQUMsNEJBQWlCLENBQUMsSUFBSSxFQUFFLGtCQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDckUsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFDVixRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQWlCLENBQUM7SUFFNUM7OztPQUdHO0lBQ0gsWUFBb0Isb0JBQTJDO1FBQTNDLHlCQUFvQixHQUFwQixvQkFBb0IsQ0FBdUI7UUFDM0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLG9CQUFvQixDQUFDLENBQUM7UUFDdkQsZUFBTSxDQUFDLGFBQWEsQ0FBQyxvQkFBb0IsRUFBQyxLQUFLLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQ7O09BRUc7SUFFVSxBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLDZDQUE2QztRQUM3QyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxT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SCxNQUFNLGdCQUFnQixHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUN4QyxTQUFTLEVBQUUsV0FBVyxDQUFDLG1CQUFtQixFQUFFLFNBQVMsSUFBSSxDQUFDO1lBQzFELGlCQUFpQixFQUFFLFdBQVcsQ0FBQyxtQkFBbUIsRUFBRSxpQkFBaUIsSUFBSSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDNUYsdUJBQXVCLEVBQUUsV0FBVyxDQUFDLG1CQUFtQixFQUFFLHVCQUF1QixJQUFJLElBQUk7U0FDNUYsQ0FBQztRQUVGLGFBQWEsQ0FBQyxjQUFjLENBQUMsSUFBSSx5Q0FBYyxDQUFDLEtBQUssRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7SUFDOUUsQ0FBQyxDQUFBO0NBQ0o7QUFwSkQsd0NBb0pDO0FBNUhnQjtJQURaLElBQUEscUJBQVcsR0FBRTsrQ0EyQ2IiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDZm5PdXRwdXQsIER1cmF0aW9uLCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgUXVldWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBRdWV1ZVByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcbmltcG9ydCB7IFF1ZXVlTGFtYmRhIH0gZnJvbSBcIi4vcXVldWUtbGFtYmRhXCI7XG5pbXBvcnQgeyBJTGFtYmRhRW52Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvbGFtYmRhLWVudlwiO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEeW5hbW9EQkNvbnN0cnVjdCB9IGZyb20gXCIuL2R5bmFtb2RiXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IFNxc0V2ZW50U291cmNlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIGEgcXVldWUgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElRdWV1ZUNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgcXVldWVzIGFyZSBzdG9yZWQuXG4gICAgICovXG4gICAgcXVldWVzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBxdWV1ZS5cbiAgICAgKi9cbiAgICBxdWV1ZVByb3BzPzogUXVldWVQcm9wcztcblxuICAgIC8qKlxuICAgICAqIFRoZSBlbnZpcm9ubWVudCBjb25maWd1cmF0aW9uIGZvciB0aGUgcXVldWUuXG4gICAgICovXG4gICAgZW52PzogSUxhbWJkYUVudkNvbmZpZ1tdO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHByb3BlcnRpZXMgZm9yIHRoZSBmdW5jdGlvbi5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcbn1cblxuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBRdWV1ZUNvbnN0cnVjdCB0aGF0IGNyZWF0ZXMgYW5kIHJlZ2lzdGVycyBxdWV1ZXMgaW4gdGhlIHN0YWNrLlxuICogQGltcGxlbWVudHMgRlcyNENvbnN0cnVjdFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiAvLyBDcmVhdGUgYSBuZXcgUXVldWVDb25zdHJ1Y3QgaW5zdGFuY2VcbiAqIGNvbnN0IHF1ZXVlQ29uZmlnOiBJUXVldWVDb25zdHJ1Y3RDb25maWcgPSB7XG4gKiAgIHF1ZXVlc0RpcmVjdG9yeTogXCIuL3NyYy9xdWV1ZXNcIixcbiAqICAgZW52OiBbXG4gKiAgICAgeyBuYW1lOiBcIlFVRVVFX05BTUVcIiwgcHJlZml4OiBcIlBSRUZJWF9cIiB9LFxuICogICAgIHsgbmFtZTogXCJRVUVVRV9VUkxcIiB9XG4gKiAgIF0sXG4gKiAgIHF1ZXVlUHJvcHM6IHtcbiAqICAgICBmaWZvOiB0cnVlLFxuICogICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IHRydWVcbiAqICAgfSxcbiAqICAgZnVuY3Rpb25Qcm9wczoge1xuICogICAgIG1lbW9yeVNpemU6IDUxMlxuICogICB9XG4gKiB9O1xuICogY29uc3QgcXVldWVDb25zdHJ1Y3QgPSBuZXcgUXVldWVDb25zdHJ1Y3QocXVldWVDb25maWcpO1xuICpcbiAqIGFwcC51c2UocXVldWVDb25zdHJ1Y3QpO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBRdWV1ZUNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihRdWV1ZUNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgIFxuICAgIG5hbWU6IHN0cmluZyA9IFF1ZXVlQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtEeW5hbW9EQkNvbnN0cnVjdC5uYW1lLCBWcGNDb25zdHJ1Y3QubmFtZV07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuICAgIHByaXZhdGUgcXVldWVNYXAgPSBuZXcgTWFwPHN0cmluZywgUXVldWU+KCk7XG5cbiAgICAvKipcbiAgICAgKiBEZWZhdWx0IGNvbnN0cnVjdG9yIHRvIGluaXRpYWxpemUgdGhlIHN0YWNrIGNvbmZpZ3VyYXRpb24uXG4gICAgICogQHBhcmFtIHF1ZXVlQ29uc3RydWN0Q29uZmlnIFRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgUXVldWVDb25zdHJ1Y3QuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBxdWV1ZUNvbnN0cnVjdENvbmZpZzogSVF1ZXVlQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiY29uc3RydWN0b3JcIiwgcXVldWVDb25zdHJ1Y3RDb25maWcpO1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhxdWV1ZUNvbnN0cnVjdENvbmZpZywnU1FTJyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrLlxuICAgICAqL1xuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gbWFrZSB0aGUgbWFpbiBzdGFjayBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIC8vIG1ha2UgdGhlIGZ3MjQgaW5zdGFuY2UgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IHF1ZXVlcyBkaXJlY3RvcnkgaWYgbm90IGRlZmluZWRcbiAgICAgICAgaWYodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9PT0gXCJcIil7XG4gICAgICAgICAgICB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9IFwiLi9zcmMvcXVldWVzXCI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUd28tcGhhc2UgY29uc3RydWN0aW9uIHRvIGhhbmRsZSBjcm9zcy1xdWV1ZSByZWZlcmVuY2VzOlxuICAgICAgICAvLyBQaGFzZSAxOiBDb2xsZWN0IGFsbCBxdWV1ZSBkZXNjcmlwdG9yc1xuICAgICAgICBjb25zdCBxdWV1ZURlc2NyaXB0b3JzOiBIYW5kbGVyRGVzY3JpcHRvcltdID0gW107XG4gICAgICAgIGNvbnN0IGNvbGxlY3RRdWV1ZSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgICAgICBxdWV1ZURlc2NyaXB0b3JzLnB1c2gocXVldWVJbmZvKTtcbiAgICAgICAgfTtcblxuICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyh0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSwgY29sbGVjdFF1ZXVlKTtcblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlcyA9IHRoaXMuZncyNC5nZXRNb2R1bGVzKCk7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUyBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG1vZHVsZXMgXCIsIEFycmF5LmZyb20obW9kdWxlcy5rZXlzKCkpKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWywgbW9kdWxlXSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBxdWV1ZXNEaXJlY3RvcnkgPSBtb2R1bGUuZ2V0UXVldWVzRGlyZWN0b3J5KCk7XG4gICAgICAgICAgICAgICAgaWYocXVldWVzRGlyZWN0b3J5ICE9ICcnKXtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJMb2FkIHF1ZXVlcyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlclF1ZXVlc0Zyb21Nb2R1bGUobW9kdWxlLCBjb2xsZWN0UXVldWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTIHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbm8gbW9kdWxlcyBcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQaGFzZSAyOiBDcmVhdGUgcXVldWVzIHdpdGhvdXQgbGFtYmRhcyBhbmQgcmVnaXN0ZXIgdGhlaXIgVVJMc1xuICAgICAgICBmb3IgKGNvbnN0IHF1ZXVlSW5mbyBvZiBxdWV1ZURlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgICB0aGlzLmNyZWF0ZUFuZFJlZ2lzdGVyUXVldWUocXVldWVJbmZvKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFBoYXNlIDM6IENyZWF0ZSBsYW1iZGEgZnVuY3Rpb25zIGZvciBxdWV1ZXMgKG5vdyBhbGwgcXVldWUgVVJMcyBhcmUgcmVnaXN0ZXJlZClcbiAgICAgICAgZm9yIChjb25zdCBxdWV1ZUluZm8gb2YgcXVldWVEZXNjcmlwdG9ycykge1xuICAgICAgICAgICAgdGhpcy5jcmVhdGVRdWV1ZUxhbWJkYShxdWV1ZUluZm8pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGhhc2UgMjogQ3JlYXRlcyBxdWV1ZSB3aXRob3V0IGxhbWJkYSBhbmQgcmVnaXN0ZXJzIGl0cyBVUkxcbiAgICAgKiBAcGFyYW0gcXVldWVJbmZvIFRoZSBpbmZvcm1hdGlvbiBhYm91dCB0aGUgcXVldWUgdG8gYmUgcmVnaXN0ZXJlZC5cbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZUFuZFJlZ2lzdGVyUXVldWUgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlID0gbmV3IHF1ZXVlSW5mby5oYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCI6OjpRdWV1ZSBpbnN0YW5jZTogXCIsIHF1ZXVlSW5mby5maWxlTmFtZSwgcXVldWVJbmZvLmZpbGVQYXRoKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVOYW1lO1xuICAgICAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UucXVldWVDb25maWcgfHwge307XG4gICAgICAgIGNvbnN0IHF1ZXVlUHJvcHMgPSB7Li4udGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZVByb3BzLCAuLi5xdWV1ZUNvbmZpZy5xdWV1ZVByb3BzfTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGA6OjpDcmVhdGluZyBxdWV1ZSAke3F1ZXVlTmFtZX0gZnJvbSAke3F1ZXVlSW5mby5maWxlUGF0aH0vJHtxdWV1ZUluZm8uZmlsZU5hbWV9YCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIHF1ZXVlIHdpdGhvdXQgbGFtYmRhIChsYW1iZGFGdW5jdGlvblByb3BzOiB1bmRlZmluZWQpXG4gICAgICAgIGNvbnN0IHF1ZXVlID0gbmV3IFF1ZXVlTGFtYmRhKHRoaXMubWFpblN0YWNrLCBxdWV1ZU5hbWUgKyBcIi1xdWV1ZVwiLCB7XG4gICAgICAgICAgICBxdWV1ZU5hbWU6IHF1ZXVlTmFtZSxcbiAgICAgICAgICAgIHF1ZXVlUHJvcHM6IHF1ZXVlUHJvcHMsXG4gICAgICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IHF1ZXVlQ29uZmlnPy52aXNpYmlsaXR5VGltZW91dFNlY29uZHMsXG4gICAgICAgICAgICByZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kczogcXVldWVDb25maWc/LnJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzLFxuICAgICAgICAgICAgcmV0ZW50aW9uUGVyaW9kRGF5czogcXVldWVDb25maWc/LnJldGVudGlvblBlcmlvZERheXMsXG4gICAgICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IHF1ZXVlQ29uZmlnPy5tYXhSZWNlaXZlQ291bnQsXG4gICAgICAgICAgICBzcXNFdmVudFNvdXJjZVByb3BzOiB7XG4gICAgICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IER1cmF0aW9uLnNlY29uZHMocXVldWVDb25maWc/Lm1heEJhdGNoaW5nV2luZG93U2Vjb25kcyA/PyA1KSxcbiAgICAgICAgICAgICAgICAuLi5xdWV1ZUNvbmZpZz8uc3FzRXZlbnRTb3VyY2VQcm9wcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzdWJzY3JpcHRpb25zOiBxdWV1ZUNvbmZpZz8uc3Vic2NyaXB0aW9ucyxcbiAgICAgICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHVuZGVmaW5lZCAgLy8gRG9uJ3QgY3JlYXRlIGxhbWJkYSB5ZXRcbiAgICAgICAgfSkgYXMgUXVldWU7XG4gICAgICAgIFxuICAgICAgICAvLyBSZWdpc3RlciBxdWV1ZSBVUkwgaW1tZWRpYXRlbHkgc28gb3RoZXIgbGFtYmRhcyBjYW4gcmVmZXJlbmNlIGl0XG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgcXVldWVOYW1lLCBxdWV1ZSwgT3V0cHV0VHlwZS5RVUVVRSwgJ3F1ZXVlTmFtZScpO1xuICAgICAgICBcbiAgICAgICAgLy8gU3RvcmUgcXVldWUgZm9yIHBoYXNlIDNcbiAgICAgICAgdGhpcy5xdWV1ZU1hcC5zZXQocXVldWVOYW1lLCBxdWV1ZSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGhhc2UgMzogQ3JlYXRlcyBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBxdWV1ZSAoYWZ0ZXIgYWxsIHF1ZXVlcyBhcmUgcmVnaXN0ZXJlZClcbiAgICAgKiBAcGFyYW0gcXVldWVJbmZvIFRoZSBpbmZvcm1hdGlvbiBhYm91dCB0aGUgcXVldWUgdG8gYmUgcmVnaXN0ZXJlZC5cbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZVF1ZXVlTGFtYmRhID0gKHF1ZXVlSW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZU5hbWU7XG4gICAgICAgIGNvbnN0IHF1ZXVlQ29uZmlnID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZyB8fCB7fTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGA6OjpDcmVhdGluZyBsYW1iZGEgZm9yIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuXG4gICAgICAgIC8vIEdldCB0aGUgYWxyZWFkeS1jcmVhdGVkIHF1ZXVlXG4gICAgICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5xdWV1ZU1hcC5nZXQocXVldWVOYW1lKTtcbiAgICAgICAgaWYgKCFxdWV1ZSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFF1ZXVlICR7cXVldWVOYW1lfSBub3QgZm91bmQgaW4gcXVldWVNYXBgKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gc2VwYXJhdGVseSB1c2luZyBMYW1iZGFGdW5jdGlvbiBjb25zdHJ1Y3RcbiAgICAgICAgY29uc3QgcXVldWVGdW5jdGlvbiA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7cXVldWVOYW1lfS1xdWV1ZS1sYW1iZGFgLCB7XG4gICAgICAgICAgICBlbnRyeTogcXVldWVJbmZvLmZpbGVQYXRoICsgXCIvXCIgKyBxdWV1ZUluZm8uZmlsZU5hbWUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczogdGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMocXVldWVDb25maWcuZW52KSxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBxdWV1ZUNvbmZpZz8ucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IHF1ZXVlQ29uZmlnPy5mdW5jdGlvblRpbWVvdXQgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmZ1bmN0aW9uVGltZW91dCxcbiAgICAgICAgICAgIHBvbGljaWVzOiBxdWV1ZUNvbmZpZz8ucG9saWNpZXMsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiB7Li4udGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzLCAuLi5xdWV1ZUNvbmZpZz8uZnVuY3Rpb25Qcm9wc30sXG4gICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiBxdWV1ZUNvbmZpZz8ubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHF1ZXVlQ29uZmlnPy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcblxuICAgICAgICAvLyBBdHRhY2ggcXVldWUgYXMgZXZlbnQgc291cmNlXG4gICAgICAgIGNvbnN0IGlzRmlmb1F1ZXVlID0gSGVscGVyLmlzRmlmb1F1ZXVlUHJvcHMoeyBcbiAgICAgICAgICAgIC4uLihxdWV1ZUNvbmZpZy5xdWV1ZVByb3BzIHx8IHt9KSwgXG4gICAgICAgICAgICBxdWV1ZU5hbWU6IHF1ZXVlTmFtZSBcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCBldmVudFNvdXJjZVByb3BzID0gaXNGaWZvUXVldWUgPyB7fSA6IHtcbiAgICAgICAgICAgIGJhdGNoU2l6ZTogcXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcz8uYmF0Y2hTaXplID8/IDEsXG4gICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogcXVldWVDb25maWcuc3FzRXZlbnRTb3VyY2VQcm9wcz8ubWF4QmF0Y2hpbmdXaW5kb3cgPz8gRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiBxdWV1ZUNvbmZpZy5zcXNFdmVudFNvdXJjZVByb3BzPy5yZXBvcnRCYXRjaEl0ZW1GYWlsdXJlcyA/PyB0cnVlLFxuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgcXVldWVGdW5jdGlvbi5hZGRFdmVudFNvdXJjZShuZXcgU3FzRXZlbnRTb3VyY2UocXVldWUsIGV2ZW50U291cmNlUHJvcHMpKTtcbiAgICB9XG59XG4iXX0=