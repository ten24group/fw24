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
        // register the queues
        await helper_1.Helper.registerHandlers(this.queueConstructConfig.queuesDirectory, this.registerQueue);
        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            this.logger.debug("SQS stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                const queuesDirectory = module.getQueuesDirectory();
                if (queuesDirectory != '') {
                    this.logger.debug("Load queues from module base-path: ", basePath);
                    await helper_1.Helper.registerQueuesFromModule(module, this.registerQueue);
                }
            }
        }
        else {
            this.logger.debug("SQS stack: construct: app has no modules ");
        }
    }
    /**
     * Registers a queue using the provided queue information.
     * @param queueInfo The information about the queue to be registered.
     */
    registerQueue = (queueInfo) => {
        queueInfo.handlerInstance = new queueInfo.handlerClass();
        this.logger.debug(":::Queue instance: ", queueInfo.fileName, queueInfo.filePath);
        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance.queueConfig || {};
        const queueProps = { ...this.queueConstructConfig.queueProps, ...queueConfig.queueProps };
        this.logger.info(`:::Registering queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);
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
            lambdaFunctionProps: {
                entry: queueInfo.filePath + "/" + queueInfo.fileName,
                environmentVariables: this.fw24.resolveEnvVariables(queueConfig.env),
                resourceAccess: queueConfig?.resourceAccess,
                functionTimeout: queueConfig?.functionTimeout || this.fw24.getConfig().functionTimeout,
                policies: queueConfig?.policies,
                functionProps: { ...this.queueConstructConfig.functionProps, ...queueConfig?.functionProps },
                logRemovalPolicy: queueConfig?.logRemovalPolicy,
                logRetentionDays: queueConfig?.logRetentionDays,
            }
        });
        this.fw24.setConstructOutput(this, queueName, queue, construct_1.OutputType.QUEUE, 'queueName');
    };
}
exports.QueueConstruct = QueueConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], QueueConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSw2Q0FBeUQ7QUFFekQsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUN6Rix1Q0FBb0M7QUFJcEMsaURBQTZDO0FBRTdDLHdDQUF1RDtBQUN2RCx5Q0FBK0M7QUFHL0MsK0JBQXFDO0FBNEJyQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHO0FBQ0gsTUFBYSxjQUFjO0lBY0g7SUFiWCxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQ25DLFlBQVksR0FBYSxDQUFDLDRCQUFpQixDQUFDLElBQUksRUFBRSxrQkFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3JFLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBRWxCOzs7T0FHRztJQUNILFlBQW9CLG9CQUEyQztRQUEzQyx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQXVCO1FBQzNELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3ZELGVBQU0sQ0FBQyxhQUFhLENBQUMsb0JBQW9CLEVBQUMsS0FBSyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVEOztPQUVHO0lBRVUsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNwSCxnREFBZ0Q7UUFD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dEM7WUFDRCxhQUFhLEVBQUUsV0FBVyxFQUFFLGFBQWE7WUFDekMsbUJBQW1CLEVBQUU7Z0JBQ2pCLEtBQUssRUFBRSxTQUFTLENBQUMsUUFBUSxHQUFHLEdBQUcsR0FBRyxTQUFTLENBQUMsUUFBUTtnQkFDcEQsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDO2dCQUNwRSxjQUFjLEVBQUUsV0FBVyxFQUFFLGNBQWM7Z0JBQzNDLGVBQWUsRUFBRSxXQUFXLEVBQUUsZUFBZSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsZUFBZTtnQkFDdEYsUUFBUSxFQUFFLFdBQVcsRUFBRSxRQUFRO2dCQUMvQixhQUFhLEVBQUUsRUFBQyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLEVBQUUsR0FBRyxXQUFXLEVBQUUsYUFBYSxFQUFDO2dCQUMxRixnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCO2dCQUMvQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCO2FBQ2xEO1NBQ0osQ0FBVSxDQUFDO1FBRVosSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxzQkFBVSxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztJQUN4RixDQUFDLENBQUE7Q0FDSjtBQTNGRCx3Q0EyRkM7QUFwRWdCO0lBRFosSUFBQSxxQkFBVyxHQUFFOytDQTJCYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENmbk91dHB1dCwgRHVyYXRpb24sIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5cbmltcG9ydCB7IFF1ZXVlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgUXVldWVMYW1iZGEgfSBmcm9tIFwiLi9xdWV1ZS1sYW1iZGFcIjtcbmltcG9ydCB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9sYW1iZGEtZW52XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciBhIHF1ZXVlIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUXVldWVDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGlyZWN0b3J5IHdoZXJlIHF1ZXVlcyBhcmUgc3RvcmVkLlxuICAgICAqL1xuICAgIHF1ZXVlc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgcXVldWUuXG4gICAgICovXG4gICAgcXVldWVQcm9wcz86IFF1ZXVlUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIGVudj86IElMYW1iZGFFbnZDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgZnVuY3Rpb24uXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgUXVldWVDb25zdHJ1Y3QgdGhhdCBjcmVhdGVzIGFuZCByZWdpc3RlcnMgcXVldWVzIGluIHRoZSBzdGFjay5cbiAqIEBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3RcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQ3JlYXRlIGEgbmV3IFF1ZXVlQ29uc3RydWN0IGluc3RhbmNlXG4gKiBjb25zdCBxdWV1ZUNvbmZpZzogSVF1ZXVlQ29uc3RydWN0Q29uZmlnID0ge1xuICogICBxdWV1ZXNEaXJlY3Rvcnk6IFwiLi9zcmMvcXVldWVzXCIsXG4gKiAgIGVudjogW1xuICogICAgIHsgbmFtZTogXCJRVUVVRV9OQU1FXCIsIHByZWZpeDogXCJQUkVGSVhfXCIgfSxcbiAqICAgICB7IG5hbWU6IFwiUVVFVUVfVVJMXCIgfVxuICogICBdLFxuICogICBxdWV1ZVByb3BzOiB7XG4gKiAgICAgZmlmbzogdHJ1ZSxcbiAqICAgICBjb250ZW50QmFzZWREZWR1cGxpY2F0aW9uOiB0cnVlXG4gKiAgIH0sXG4gKiAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAqICAgICBtZW1vcnlTaXplOiA1MTJcbiAqICAgfVxuICogfTtcbiAqIGNvbnN0IHF1ZXVlQ29uc3RydWN0ID0gbmV3IFF1ZXVlQ29uc3RydWN0KHF1ZXVlQ29uZmlnKTtcbiAqXG4gKiBhcHAudXNlKHF1ZXVlQ29uc3RydWN0KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgUXVldWVDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoUXVldWVDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lOiBzdHJpbmcgPSBRdWV1ZUNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbRHluYW1vREJDb25zdHJ1Y3QubmFtZSwgVnBjQ29uc3RydWN0Lm5hbWVdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvbi5cbiAgICAgKiBAcGFyYW0gcXVldWVDb25zdHJ1Y3RDb25maWcgVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBRdWV1ZUNvbnN0cnVjdC5cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHF1ZXVlQ29uc3RydWN0Q29uZmlnOiBJUXVldWVDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJjb25zdHJ1Y3RvclwiLCBxdWV1ZUNvbnN0cnVjdENvbmZpZyk7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHF1ZXVlQ29uc3RydWN0Q29uZmlnLCdTUVMnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2suXG4gICAgICovXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucGFyZW50U3RhY2tOYW1lKTtcbiAgICAgICAgLy8gbWFrZSB0aGUgZncyNCBpbnN0YW5jZSBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgcXVldWVzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZih0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID09PSBcIlwiKXtcbiAgICAgICAgICAgIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID0gXCIuL3NyYy9xdWV1ZXNcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlZ2lzdGVyIHRoZSBxdWV1ZXNcbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnksIHRoaXMucmVnaXN0ZXJRdWV1ZSk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMgc3RhY2s6IGNvbnN0cnVjdDogYXBwIGhhcyBtb2R1bGVzIFwiLCBBcnJheS5mcm9tKG1vZHVsZXMua2V5cygpKSk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFssIG1vZHVsZV0gb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVldWVzRGlyZWN0b3J5ID0gbW9kdWxlLmdldFF1ZXVlc0RpcmVjdG9yeSgpO1xuICAgICAgICAgICAgICAgIGlmKHF1ZXVlc0RpcmVjdG9yeSAhPSAnJyl7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiTG9hZCBxdWV1ZXMgZnJvbSBtb2R1bGUgYmFzZS1wYXRoOiBcIiwgYmFzZVBhdGgpO1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJRdWV1ZXNGcm9tTW9kdWxlKG1vZHVsZSwgdGhpcy5yZWdpc3RlclF1ZXVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUyBzdGFjazogY29uc3RydWN0OiBhcHAgaGFzIG5vIG1vZHVsZXMgXCIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXJzIGEgcXVldWUgdXNpbmcgdGhlIHByb3ZpZGVkIHF1ZXVlIGluZm9ybWF0aW9uLlxuICAgICAqIEBwYXJhbSBxdWV1ZUluZm8gVGhlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBxdWV1ZSB0byBiZSByZWdpc3RlcmVkLlxuICAgICAqL1xuICAgIHByaXZhdGUgcmVnaXN0ZXJRdWV1ZSA9IChxdWV1ZUluZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHF1ZXVlSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgcXVldWVJbmZvLmhhbmRsZXJDbGFzcygpO1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIjo6OlF1ZXVlIGluc3RhbmNlOiBcIiwgcXVldWVJbmZvLmZpbGVOYW1lLCBxdWV1ZUluZm8uZmlsZVBhdGgpO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZU5hbWU7XG4gICAgICAgIGNvbnN0IHF1ZXVlQ29uZmlnID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZyB8fCB7fTtcbiAgICAgICAgY29uc3QgcXVldWVQcm9wcyA9IHsuLi50aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnF1ZXVlUHJvcHMsIC4uLnF1ZXVlQ29uZmlnLnF1ZXVlUHJvcHN9O1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oYDo6OlJlZ2lzdGVyaW5nIHF1ZXVlICR7cXVldWVOYW1lfSBmcm9tICR7cXVldWVJbmZvLmZpbGVQYXRofS8ke3F1ZXVlSW5mby5maWxlTmFtZX1gKTtcblxuICAgICAgICBjb25zdCBxdWV1ZSA9IG5ldyBRdWV1ZUxhbWJkYSh0aGlzLm1haW5TdGFjaywgcXVldWVOYW1lICsgXCItcXVldWVcIiwge1xuICAgICAgICAgICAgcXVldWVOYW1lOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgICBxdWV1ZVByb3BzOiBxdWV1ZVByb3BzLFxuICAgICAgICAgICAgdmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzOiBxdWV1ZUNvbmZpZz8udmlzaWJpbGl0eVRpbWVvdXRTZWNvbmRzLFxuICAgICAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHM6IHF1ZXVlQ29uZmlnPy5yZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kcyxcbiAgICAgICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IHF1ZXVlQ29uZmlnPy5yZXRlbnRpb25QZXJpb2REYXlzLFxuICAgICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiBxdWV1ZUNvbmZpZz8ubWF4UmVjZWl2ZUNvdW50LFxuICAgICAgICAgICAgc3FzRXZlbnRTb3VyY2VQcm9wczoge1xuICAgICAgICAgICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBEdXJhdGlvbi5zZWNvbmRzKHF1ZXVlQ29uZmlnPy5tYXhCYXRjaGluZ1dpbmRvd1NlY29uZHMgPz8gNSksXG4gICAgICAgICAgICAgICAgLi4ucXVldWVDb25maWc/LnNxc0V2ZW50U291cmNlUHJvcHMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uczogcXVldWVDb25maWc/LnN1YnNjcmlwdGlvbnMsICAgICAgICAgICAgXG4gICAgICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgICAgICAgZW50cnk6IHF1ZXVlSW5mby5maWxlUGF0aCArIFwiL1wiICsgcXVldWVJbmZvLmZpbGVOYW1lLFxuICAgICAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyhxdWV1ZUNvbmZpZy5lbnYpLFxuICAgICAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBxdWV1ZUNvbmZpZz8ucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiBxdWV1ZUNvbmZpZz8uZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICAgICAgcG9saWNpZXM6IHF1ZXVlQ29uZmlnPy5wb2xpY2llcyxcbiAgICAgICAgICAgICAgICBmdW5jdGlvblByb3BzOiB7Li4udGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzLCAuLi5xdWV1ZUNvbmZpZz8uZnVuY3Rpb25Qcm9wc30sXG4gICAgICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogcXVldWVDb25maWc/LmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogcXVldWVDb25maWc/LmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pIGFzIFF1ZXVlO1xuICAgICAgICBcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBxdWV1ZU5hbWUsIHF1ZXVlLCBPdXRwdXRUeXBlLlFVRVVFLCAncXVldWVOYW1lJyk7XG4gICAgfVxufVxuIl19