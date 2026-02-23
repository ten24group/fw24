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
            handlerClassName: queueInfo.handlerClass.name,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9xdWV1ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFFQSwyQ0FBd0M7QUFDeEMsdURBQXlGO0FBQ3pGLHVDQUFvQztBQUlwQyxpREFBNkM7QUFFN0Msd0NBQXVEO0FBQ3ZELHlDQUErQztBQUcvQyxtQ0FBeUM7QUFDekMsK0JBQXFDO0FBQ3JDLHVEQUFtRDtBQUNuRCxvQ0FBaUM7QUE0QmpDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F3Qkc7QUFDSCxNQUFhLGNBQWM7SUFlTTtJQWRwQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQ25DLFlBQVksR0FBYSxDQUFFLDRCQUFpQixDQUFDLElBQUksRUFBRSxrQkFBWSxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksQ0FBRSxDQUFDO0lBQzVGLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBQ0QsUUFBUSxHQUFHLElBQUksR0FBRyxFQUFpQixDQUFDO0lBRXJEOzs7T0FHRztJQUNILFlBQTZCLG9CQUEyQztRQUEzQyx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQXVCO1FBQ3BFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBQ3ZELGVBQU0sQ0FBQyxhQUFhLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDdEQsQ0FBQztJQUVEOztPQUVHO0lBRVUsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJ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QUFHLElBQUksZ0NBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEdBQUcsU0FBUyxlQUFlLEVBQUU7WUFDbEYsS0FBSyxFQUFFLFNBQVMsQ0FBQyxRQUFRLEdBQUcsR0FBRyxHQUFHLFNBQVMsQ0FBQyxRQUFRO1lBQ3BELGdCQUFnQixFQUFFLFNBQVMsQ0FBQyxZQUFZLENBQUMsSUFBSTtZQUM3QyxvQkFBb0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUM7WUFDcEUsY0FBYyxFQUFFLFdBQVcsRUFBRSxjQUFjO1lBQzNDLGVBQWUsRUFBRSxXQUFXLEVBQUUsZUFBZSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsZUFBZTtZQUN0RixRQUFRLEVBQUUsV0FBVyxFQUFFLFFBQVE7WUFDL0IsYUFBYSxFQUFFLElBQUEsYUFBSyxFQUFDO2dCQUNqQixJQUFJLENBQUMsb0JBQW9CLENBQUMsYUFBYSxJQUFJLEVBQUU7Z0JBQzdDLFdBQVcsRUFBRSxhQUFhLElBQUksRUFBRTthQUNuQyxDQUFFO1lBQ0gsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLGdCQUFnQjtZQUMvQyxnQkFBZ0IsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCO1NBQ2xELENBQW1CLENBQUM7UUFFckIsbUdBQW1HO1FBQ25HLDBCQUFXLENBQUMsbUJBQW1CLENBQUMsYUFBYSxFQUFFLEtBQUssRUFBRSxXQUFXLENBQUMsVUFBVSxFQUFFLFNBQVMsRUFBRSxXQUFXLENBQUMsbUJBQW1CLENBQUMsQ0FBQztJQUM5SCxDQUFDLENBQUE7Q0FDSjtBQXJLRCx3Q0FxS0M7QUE3SWdCO0lBRFosSUFBQSxxQkFBVyxHQUFFOytDQTJEYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENmbk91dHB1dCwgRHVyYXRpb24sIFN0YWNrIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBRdWV1ZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgSGFuZGxlckRlc2NyaXB0b3IgZnJvbSBcIi4uL2ludGVyZmFjZXMvaGFuZGxlci1kZXNjcmlwdG9yXCI7XG5cbmltcG9ydCB7IFF1ZXVlUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXNxc1wiO1xuaW1wb3J0IHsgUXVldWVMYW1iZGEgfSBmcm9tIFwiLi9xdWV1ZS1sYW1iZGFcIjtcbmltcG9ydCB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9sYW1iZGEtZW52XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0IH0gZnJvbSBcIi4vZHluYW1vZGJcIjtcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uLCBOb2RlanNGdW5jdGlvblByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgbWVyZ2UgfSBmcm9tIFwiLi4vdXRpbHNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciBhIHF1ZXVlIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJUXVldWVDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGlyZWN0b3J5IHdoZXJlIHF1ZXVlcyBhcmUgc3RvcmVkLlxuICAgICAqL1xuICAgIHF1ZXVlc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgcXVldWUuXG4gICAgICovXG4gICAgcXVldWVQcm9wcz86IFF1ZXVlUHJvcHM7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiBmb3IgdGhlIHF1ZXVlLlxuICAgICAqL1xuICAgIGVudj86IElMYW1iZGFFbnZDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBwcm9wZXJ0aWVzIGZvciB0aGUgZnVuY3Rpb24uXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG59XG5cblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgUXVldWVDb25zdHJ1Y3QgdGhhdCBjcmVhdGVzIGFuZCByZWdpc3RlcnMgcXVldWVzIGluIHRoZSBzdGFjay5cbiAqIEBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3RcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gQ3JlYXRlIGEgbmV3IFF1ZXVlQ29uc3RydWN0IGluc3RhbmNlXG4gKiBjb25zdCBxdWV1ZUNvbmZpZzogSVF1ZXVlQ29uc3RydWN0Q29uZmlnID0ge1xuICogICBxdWV1ZXNEaXJlY3Rvcnk6IFwiLi9zcmMvcXVldWVzXCIsXG4gKiAgIGVudjogW1xuICogICAgIHsgbmFtZTogXCJRVUVVRV9OQU1FXCIsIHByZWZpeDogXCJQUkVGSVhfXCIgfSxcbiAqICAgICB7IG5hbWU6IFwiUVVFVUVfVVJMXCIgfVxuICogICBdLFxuICogICBxdWV1ZVByb3BzOiB7XG4gKiAgICAgZmlmbzogdHJ1ZSxcbiAqICAgICBjb250ZW50QmFzZWREZWR1cGxpY2F0aW9uOiB0cnVlXG4gKiAgIH0sXG4gKiAgIGZ1bmN0aW9uUHJvcHM6IHtcbiAqICAgICBtZW1vcnlTaXplOiA1MTJcbiAqICAgfVxuICogfTtcbiAqIGNvbnN0IHF1ZXVlQ29uc3RydWN0ID0gbmV3IFF1ZXVlQ29uc3RydWN0KHF1ZXVlQ29uZmlnKTtcbiAqXG4gKiBhcHAudXNlKHF1ZXVlQ29uc3RydWN0KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgUXVldWVDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoUXVldWVDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWU6IHN0cmluZyA9IFF1ZXVlQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgRHluYW1vREJDb25zdHJ1Y3QubmFtZSwgVnBjQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG4gICAgcHJpdmF0ZSByZWFkb25seSBxdWV1ZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBRdWV1ZT4oKTtcblxuICAgIC8qKlxuICAgICAqIERlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvbi5cbiAgICAgKiBAcGFyYW0gcXVldWVDb25zdHJ1Y3RDb25maWcgVGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBRdWV1ZUNvbnN0cnVjdC5cbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHF1ZXVlQ29uc3RydWN0Q29uZmlnOiBJUXVldWVDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJjb25zdHJ1Y3RvclwiLCBxdWV1ZUNvbnN0cnVjdENvbmZpZyk7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHF1ZXVlQ29uc3RydWN0Q29uZmlnLCAnU1FTJyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrLlxuICAgICAqL1xuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgLy8gbWFrZSB0aGUgbWFpbiBzdGFjayBhdmFpbGFibGUgdG8gdGhlIGNsYXNzXG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLnF1ZXVlQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIC8vIG1ha2UgdGhlIGZ3MjQgaW5zdGFuY2UgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IHF1ZXVlcyBkaXJlY3RvcnkgaWYgbm90IGRlZmluZWRcbiAgICAgICAgaWYgKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID09PSB1bmRlZmluZWQgfHwgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5xdWV1ZXNEaXJlY3RvcnkgPT09IFwiXCIpIHtcbiAgICAgICAgICAgIHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5ID0gXCIuL3NyYy9xdWV1ZXNcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFR3by1waGFzZSBjb25zdHJ1Y3Rpb24gdG8gaGFuZGxlIGNyb3NzLXF1ZXVlIHJlZmVyZW5jZXM6XG4gICAgICAgIC8vIFBoYXNlIDE6IENvbGxlY3QgYWxsIHF1ZXVlIGRlc2NyaXB0b3JzXG4gICAgICAgIGNvbnN0IHF1ZXVlRGVzY3JpcHRvcnM6IEhhbmRsZXJEZXNjcmlwdG9yW10gPSBbXTtcbiAgICAgICAgY29uc3QgY29sbGVjdFF1ZXVlID0gKHF1ZXVlSW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgICAgIHF1ZXVlRGVzY3JpcHRvcnMucHVzaChxdWV1ZUluZm8pO1xuICAgICAgICB9O1xuXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVzRGlyZWN0b3J5LCBjb2xsZWN0UXVldWUpO1xuXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVzID0gdGhpcy5mdzI0LmdldE1vZHVsZXMoKTtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTIHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbW9kdWxlcyBcIiwgQXJyYXkuZnJvbShtb2R1bGVzLmtleXMoKSkpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbICwgbW9kdWxlIF0gb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgcXVldWVzRGlyZWN0b3J5ID0gbW9kdWxlLmdldFF1ZXVlc0RpcmVjdG9yeSgpO1xuICAgICAgICAgICAgICAgIGlmIChxdWV1ZXNEaXJlY3RvcnkgIT0gJycpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJMb2FkIHF1ZXVlcyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlclF1ZXVlc0Zyb21Nb2R1bGUobW9kdWxlLCBjb2xsZWN0UXVldWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTIHN0YWNrOiBjb25zdHJ1Y3Q6IGFwcCBoYXMgbm8gbW9kdWxlcyBcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQaGFzZSAyOiBDcmVhdGUgcXVldWVzIHdpdGhvdXQgbGFtYmRhcyBhbmQgcmVnaXN0ZXIgdGhlaXIgVVJMc1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5OLIENyZWF0aW5nICR7cXVldWVEZXNjcmlwdG9ycy5sZW5ndGh9IHF1ZXVlKHMpLi4uYCk7XG4gICAgICAgIGZvciAoY29uc3QgcXVldWVJbmZvIG9mIHF1ZXVlRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlQW5kUmVnaXN0ZXJRdWV1ZShxdWV1ZUluZm8pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGhhc2UgMzogQ3JlYXRlIGxhbWJkYSBmdW5jdGlvbnMgZm9yIHF1ZXVlcyAobm93IGFsbCBxdWV1ZSBVUkxzIGFyZSByZWdpc3RlcmVkKVxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGDwn5SnIENyZWF0aW5nIExhbWJkYSBmdW5jdGlvbnMgZm9yICR7cXVldWVEZXNjcmlwdG9ycy5sZW5ndGh9IHF1ZXVlKHMpLi4uYCk7XG4gICAgICAgIGxldCBjcmVhdGVkQ291bnQgPSAwO1xuICAgICAgICBsZXQgc2tpcHBlZENvdW50ID0gMDtcblxuICAgICAgICBmb3IgKGNvbnN0IHF1ZXVlSW5mbyBvZiBxdWV1ZURlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnPy5xdWV1ZU5hbWUgfHwgcXVldWVJbmZvLmhhbmRsZXJDbGFzcy5uYW1lO1xuICAgICAgICAgICAgY29uc3QgaXNNYW51YWwgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnPy5tYW51YWxSZWdpc3RyYXRpb247XG5cbiAgICAgICAgICAgIHRoaXMuY3JlYXRlUXVldWVMYW1iZGEocXVldWVJbmZvKTtcblxuICAgICAgICAgICAgaWYgKGlzTWFudWFsKSB7XG4gICAgICAgICAgICAgICAgc2tpcHBlZENvdW50Kys7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNyZWF0ZWRDb3VudCsrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhg4pyFIFF1ZXVlIHNldHVwIGNvbXBsZXRlOiAke2NyZWF0ZWRDb3VudH0gYWN0aXZlLCAke3NraXBwZWRDb3VudH0gbWFudWFsYCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGhhc2UgMjogQ3JlYXRlcyBxdWV1ZSB3aXRob3V0IGxhbWJkYSBhbmQgcmVnaXN0ZXJzIGl0cyBVUkxcbiAgICAgKiBAcGFyYW0gcXVldWVJbmZvIFRoZSBpbmZvcm1hdGlvbiBhYm91dCB0aGUgcXVldWUgdG8gYmUgcmVnaXN0ZXJlZC5cbiAgICAgKi9cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZUFuZFJlZ2lzdGVyUXVldWUgPSAocXVldWVJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlID0gbmV3IHF1ZXVlSW5mby5oYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCI6OjpRdWV1ZSBpbnN0YW5jZTogXCIsIHF1ZXVlSW5mby5maWxlTmFtZSwgcXVldWVJbmZvLmZpbGVQYXRoKTtcblxuICAgICAgICBjb25zdCBxdWV1ZU5hbWUgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlTmFtZTtcbiAgICAgICAgY29uc3QgcXVldWVDb25maWcgPSBxdWV1ZUluZm8uaGFuZGxlckluc3RhbmNlLnF1ZXVlQ29uZmlnIHx8IHt9O1xuXG4gICAgICAgIC8vIFNraXAgcXVldWVzIG1hcmtlZCBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvblxuICAgICAgICBpZiAocXVldWVDb25maWcubWFudWFsUmVnaXN0cmF0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgU2tpcHBpbmcgbWFudWFsIHJlZ2lzdHJhdGlvbiBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHF1ZXVlUHJvcHMgPSB7IC4uLnRoaXMucXVldWVDb25zdHJ1Y3RDb25maWcucXVldWVQcm9wcywgLi4ucXVldWVDb25maWcucXVldWVQcm9wcyB9O1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcblxuICAgICAgICAvLyBDcmVhdGUgcXVldWUgd2l0aCBzdWJzY3JpcHRpb25zIHVzaW5nIHN0YXRpYyBoZWxwZXJcbiAgICAgICAgLy8gVGhpcyBlbnN1cmVzIGNvbnNpc3RlbnQgRExRIHNldHVwLCB0aW1lb3V0IGNvbmZpZ3VyYXRpb24sIGFuZCB0b3BpYyBzdWJzY3JpcHRpb25zXG4gICAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUodGhpcy5tYWluU3RhY2ssIHF1ZXVlTmFtZSArIFwiLXF1ZXVlXCIsIHtcbiAgICAgICAgICAgIHF1ZXVlTmFtZTogcXVldWVOYW1lLFxuICAgICAgICAgICAgcXVldWVQcm9wczogcXVldWVQcm9wcyxcbiAgICAgICAgICAgIHZpc2liaWxpdHlUaW1lb3V0U2Vjb25kczogcXVldWVDb25maWc/LnZpc2liaWxpdHlUaW1lb3V0U2Vjb25kcyxcbiAgICAgICAgICAgIHJlY2VpdmVNZXNzYWdlV2FpdFRpbWVTZWNvbmRzOiBxdWV1ZUNvbmZpZz8ucmVjZWl2ZU1lc3NhZ2VXYWl0VGltZVNlY29uZHMsXG4gICAgICAgICAgICByZXRlbnRpb25QZXJpb2REYXlzOiBxdWV1ZUNvbmZpZz8ucmV0ZW50aW9uUGVyaW9kRGF5cyxcbiAgICAgICAgICAgIG1heFJlY2VpdmVDb3VudDogcXVldWVDb25maWc/Lm1heFJlY2VpdmVDb3VudCxcbiAgICAgICAgfSwgcXVldWVDb25maWc/LnN1YnNjcmlwdGlvbnMpO1xuXG4gICAgICAgIC8vIFJlZ2lzdGVyIHF1ZXVlIFVSTCBpbW1lZGlhdGVseSBzbyBvdGhlciBsYW1iZGFzIGNhbiByZWZlcmVuY2UgaXRcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBxdWV1ZU5hbWUsIHF1ZXVlLCBPdXRwdXRUeXBlLlFVRVVFLCAncXVldWVOYW1lJyk7XG5cbiAgICAgICAgLy8gU3RvcmUgcXVldWUgZm9yIHBoYXNlIDNcbiAgICAgICAgdGhpcy5xdWV1ZU1hcC5zZXQocXVldWVOYW1lLCBxdWV1ZSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUGhhc2UgMzogQ3JlYXRlcyBsYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBxdWV1ZSAoYWZ0ZXIgYWxsIHF1ZXVlcyBhcmUgcmVnaXN0ZXJlZClcbiAgICAgKiBAcGFyYW0gcXVldWVJbmZvIFRoZSBpbmZvcm1hdGlvbiBhYm91dCB0aGUgcXVldWUgdG8gYmUgcmVnaXN0ZXJlZC5cbiAgICAgKi9cbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyZWF0ZVF1ZXVlTGFtYmRhID0gKHF1ZXVlSW5mbzogSGFuZGxlckRlc2NyaXB0b3IpID0+IHtcbiAgICAgICAgY29uc3QgcXVldWVOYW1lID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZU5hbWU7XG4gICAgICAgIGNvbnN0IHF1ZXVlQ29uZmlnID0gcXVldWVJbmZvLmhhbmRsZXJJbnN0YW5jZS5xdWV1ZUNvbmZpZyB8fCB7fTtcblxuICAgICAgICAvLyBTa2lwIHF1ZXVlcyBtYXJrZWQgZm9yIG1hbnVhbCByZWdpc3RyYXRpb25cbiAgICAgICAgaWYgKHF1ZXVlQ29uZmlnLm1hbnVhbFJlZ2lzdHJhdGlvbikge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYDo6OlNraXBwaW5nIGxhbWJkYSBjcmVhdGlvbiBmb3IgbWFudWFsIHJlZ2lzdHJhdGlvbiBxdWV1ZSAke3F1ZXVlTmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBDcmVhdGluZyBsYW1iZGEgZm9yIHF1ZXVlICR7cXVldWVOYW1lfWApO1xuXG4gICAgICAgIC8vIEdldCB0aGUgYWxyZWFkeS1jcmVhdGVkIHF1ZXVlXG4gICAgICAgIGNvbnN0IHF1ZXVlID0gdGhpcy5xdWV1ZU1hcC5nZXQocXVldWVOYW1lKTtcbiAgICAgICAgaWYgKCFxdWV1ZSkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYFF1ZXVlICR7cXVldWVOYW1lfSBub3QgZm91bmQgaW4gcXVldWVNYXBgKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBsYW1iZGEgZnVuY3Rpb24gc2VwYXJhdGVseSB1c2luZyBMYW1iZGFGdW5jdGlvbiBjb25zdHJ1Y3RcbiAgICAgICAgY29uc3QgcXVldWVGdW5jdGlvbiA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgYCR7cXVldWVOYW1lfS1xdWV1ZS1sYW1iZGFgLCB7XG4gICAgICAgICAgICBlbnRyeTogcXVldWVJbmZvLmZpbGVQYXRoICsgXCIvXCIgKyBxdWV1ZUluZm8uZmlsZU5hbWUsXG4gICAgICAgICAgICBoYW5kbGVyQ2xhc3NOYW1lOiBxdWV1ZUluZm8uaGFuZGxlckNsYXNzLm5hbWUsXG4gICAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczogdGhpcy5mdzI0LnJlc29sdmVFbnZWYXJpYWJsZXMocXVldWVDb25maWcuZW52KSxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiBxdWV1ZUNvbmZpZz8ucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IHF1ZXVlQ29uZmlnPy5mdW5jdGlvblRpbWVvdXQgfHwgdGhpcy5mdzI0LmdldENvbmZpZygpLmZ1bmN0aW9uVGltZW91dCxcbiAgICAgICAgICAgIHBvbGljaWVzOiBxdWV1ZUNvbmZpZz8ucG9saWNpZXMsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiBtZXJnZShbXG4gICAgICAgICAgICAgICAgdGhpcy5xdWV1ZUNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzID8/IHt9LFxuICAgICAgICAgICAgICAgIHF1ZXVlQ29uZmlnPy5mdW5jdGlvblByb3BzID8/IHt9XG4gICAgICAgICAgICBdKSEsXG4gICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiBxdWV1ZUNvbmZpZz8ubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHF1ZXVlQ29uZmlnPy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcblxuICAgICAgICAvLyBBdHRhY2ggcXVldWUgYXMgZXZlbnQgc291cmNlIHVzaW5nIHN0YXRpYyBoZWxwZXIgKGVuc3VyZXMgY29uc2lzdGVudCBldmVudCBzb3VyY2UgY29uZmlndXJhdGlvbilcbiAgICAgICAgUXVldWVMYW1iZGEuYXR0YWNoUXVldWVUb0xhbWJkYShxdWV1ZUZ1bmN0aW9uLCBxdWV1ZSwgcXVldWVDb25maWcucXVldWVQcm9wcywgcXVldWVOYW1lLCBxdWV1ZUNvbmZpZy5zcXNFdmVudFNvdXJjZVByb3BzKTtcbiAgICB9XG59XG4iXX0=