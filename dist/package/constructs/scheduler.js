"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerConstruct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const fw24_1 = require("../core/fw24");
const logging_1 = require("../logging");
const lambda_function_1 = require("./lambda-function");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const vpc_1 = require("./vpc");
/**
 * @example
 * ```ts
 * const schedulerConfig: ISchedulerConstructConfig = {
 *   tasksDirectory: "./src/tasks",
 *   // other configuration properties
 * };
 * const scheduler = new SchedulerConstruct(schedulerConfig);
 * await scheduler.construct();
 * ```
 */
class SchedulerConstruct {
    schedulerConstructConfig;
    logger = (0, logging_1.createLogger)(SchedulerConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = SchedulerConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name];
    output;
    mainStack;
    // default constructor to initialize the stack configuration
    constructor(schedulerConstructConfig) {
        this.schedulerConstructConfig = schedulerConstructConfig;
        helper_1.Helper.hydrateConfig(schedulerConstructConfig, 'SCHEDULER');
    }
    // construct method to create the stack
    async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack(this.schedulerConstructConfig.stackName, this.schedulerConstructConfig.parentStackName);
        // sets the default tasks directory if not defined
        if (this.schedulerConstructConfig.tasksDirectory === undefined || this.schedulerConstructConfig.tasksDirectory === "") {
            this.schedulerConstructConfig.tasksDirectory = "./src/tasks";
        }
        // register the tasks
        await helper_1.Helper.registerHandlers(this.schedulerConstructConfig.tasksDirectory, this.registerTask);
        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                const tasksDirectory = module.getTasksDirectory();
                if (tasksDirectory != '') {
                    this.logger.info("Load tasks from module base-path: ", basePath);
                    await helper_1.Helper.registerTasksFromModule(module, this.registerTask);
                }
            }
        }
    }
    registerTask = (taskInfo) => {
        taskInfo.handlerInstance = new taskInfo.handlerClass();
        this.logger.debug("Task instance: ", taskInfo.handlerInstance);
        const taskName = taskInfo.handlerInstance.taskName;
        const taskConfig = taskInfo.handlerInstance.taskConfig || {};
        const taskProps = { ...this.schedulerConstructConfig.functionProps, ...taskConfig.functionProps };
        const taskConfigEnv = [...(this.schedulerConstructConfig.env ?? []), ...taskConfig.env ?? []];
        this.logger.info(`Registering task ${taskName} from ${taskInfo.filePath}/${taskInfo.fileName}`);
        const task = new lambda_function_1.LambdaFunction(this.mainStack, taskName + "-task", {
            entry: taskInfo.filePath + "/" + taskInfo.fileName,
            environmentVariables: this.fw24.resolveEnvVariables(taskConfigEnv),
            allowSendEmail: true,
            functionTimeout: taskConfig.functionTimeout || this.fw24.getConfig().functionTimeout,
            functionProps: {
                ...taskProps,
            },
            resourceAccess: taskConfig.resourceAccess,
            logRetentionDays: taskConfig.logRetentionDays,
            logRemovalPolicy: taskConfig.logRemovalPolicy,
        });
        this.fw24.setConstructOutput(this, taskName, task, construct_1.OutputType.FUNCTION);
        new aws_events_1.Rule(this.mainStack, taskName + "-scheduler", {
            schedule: aws_events_1.Schedule.expression(taskConfig.schedule),
            targets: [
                new aws_cdk_lib_1.aws_events_targets.LambdaFunction(task),
            ],
        });
    };
}
exports.SchedulerConstruct = SchedulerConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], SchedulerConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvc2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUFtRTtBQUNuRSwyQ0FBd0M7QUFDeEMsdURBQXlGO0FBQ3pGLHVDQUFvQztBQUlwQyx3Q0FBdUQ7QUFFdkQsdURBQW1EO0FBQ25ELHVEQUF3RDtBQUV4RCwrQkFBcUM7QUFzQnJDOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFhLGtCQUFrQjtJQVdQO0lBVlgsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxrQkFBa0IsQ0FBQyxJQUFJLENBQUM7SUFDdkMsWUFBWSxHQUFhLENBQUMsa0JBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3QyxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQiw0REFBNEQ7SUFDNUQsWUFBb0Isd0JBQW1EO1FBQW5ELDZCQUF3QixHQUF4Qix3QkFBd0IsQ0FBMkI7UUFDbkUsZUFBTSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBQyxXQUFXLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBRUQsdUNBQXVDO0lBRTFCLEFBQU4sS0FBSyxDQUFDLFNBQVM7UUFDbEIsNkNBQTZDO1FBQzdDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDNUgsa0RBQWtEO1FBQ2xELElBQUcsSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsS0FBSyxF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SSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsUUFBUSxHQUFHLFlBQVksRUFBRTtZQUM5QyxRQUFRLEVBQUUscUJBQVEsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztZQUNsRCxPQUFPLEVBQUU7Z0JBQ0wsSUFBSSxnQ0FBa0IsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDO2FBQzlDO1NBQ0osQ0FBQyxDQUFDO0lBRVAsQ0FBQyxDQUFBO0NBQ0o7QUE1RUQsZ0RBNEVDO0FBM0RnQjtJQURaLElBQUEscUJBQVcsR0FBRTttREF3QmIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDZm5PdXRwdXQsIFN0YWNrLCBhd3NfZXZlbnRzX3RhcmdldHMgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgSUxhbWJkYUVudkNvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2xhbWJkYS1lbnZcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBSdWxlLCBTY2hlZHVsZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIFNjaGVkdWxlciBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIHRhc2tzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIHRhc2tzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqL1xuICAgIGVudj86IElMYW1iZGFFbnZDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvbnMuXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG59XG5cbi8qKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCBzY2hlZHVsZXJDb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gKiAgIHRhc2tzRGlyZWN0b3J5OiBcIi4vc3JjL3Rhc2tzXCIsXG4gKiAgIC8vIG90aGVyIGNvbmZpZ3VyYXRpb24gcHJvcGVydGllc1xuICogfTtcbiAqIGNvbnN0IHNjaGVkdWxlciA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3Qoc2NoZWR1bGVyQ29uZmlnKTtcbiAqIGF3YWl0IHNjaGVkdWxlci5jb25zdHJ1Y3QoKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgU2NoZWR1bGVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFNjaGVkdWxlckNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgIFxuICAgIG5hbWU6IHN0cmluZyA9IFNjaGVkdWxlckNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbVnBjQ29uc3RydWN0Lm5hbWVdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHNjaGVkdWxlckNvbnN0cnVjdENvbmZpZywnU0NIRURVTEVSJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IHRhc2tzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZih0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5ID09PSBcIlwiKXtcbiAgICAgICAgICAgIHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5ID0gXCIuL3NyYy90YXNrc1wiO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVnaXN0ZXIgdGhlIHRhc2tzXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5LCB0aGlzLnJlZ2lzdGVyVGFzayk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbLCBtb2R1bGVdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRhc2tzRGlyZWN0b3J5ID0gbW9kdWxlLmdldFRhc2tzRGlyZWN0b3J5KCk7XG4gICAgICAgICAgICAgICAgaWYodGFza3NEaXJlY3RvcnkgIT0gJycpe1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiTG9hZCB0YXNrcyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlclRhc2tzRnJvbU1vZHVsZShtb2R1bGUsIHRoaXMucmVnaXN0ZXJUYXNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHByaXZhdGUgcmVnaXN0ZXJUYXNrPSAodGFza0luZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZSA9IG5ldyB0YXNrSW5mby5oYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUYXNrIGluc3RhbmNlOiBcIiwgdGFza0luZm8uaGFuZGxlckluc3RhbmNlKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHRhc2tOYW1lID0gdGFza0luZm8uaGFuZGxlckluc3RhbmNlLnRhc2tOYW1lO1xuICAgICAgICBjb25zdCB0YXNrQ29uZmlnID0gdGFza0luZm8uaGFuZGxlckluc3RhbmNlLnRhc2tDb25maWcgfHwge307XG4gICAgICAgIGNvbnN0IHRhc2tQcm9wcyA9IHsuLi50aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzLCAuLi50YXNrQ29uZmlnLmZ1bmN0aW9uUHJvcHN9O1xuICAgICAgICBjb25zdCB0YXNrQ29uZmlnRW52ID0gWy4uLih0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnYgPz8gW10pLC4uLnRhc2tDb25maWcuZW52ID8/IFtdXTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmluZyB0YXNrICR7dGFza05hbWV9IGZyb20gJHt0YXNrSW5mby5maWxlUGF0aH0vJHt0YXNrSW5mby5maWxlTmFtZX1gKTtcblxuICAgICAgICBjb25zdCB0YXNrID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCB0YXNrTmFtZSArIFwiLXRhc2tcIiwge1xuICAgICAgICAgICAgZW50cnk6IHRhc2tJbmZvLmZpbGVQYXRoICsgXCIvXCIgKyB0YXNrSW5mby5maWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyh0YXNrQ29uZmlnRW52KSxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiB0YXNrQ29uZmlnLmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgICAgICAgIC4uLnRhc2tQcm9wcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNvdXJjZUFjY2VzczogdGFza0NvbmZpZy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHRhc2tDb25maWcubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IHRhc2tDb25maWcubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCB0YXNrTmFtZSwgdGFzaywgT3V0cHV0VHlwZS5GVU5DVElPTik7XG5cbiAgICAgICAgbmV3IFJ1bGUodGhpcy5tYWluU3RhY2ssIHRhc2tOYW1lICsgXCItc2NoZWR1bGVyXCIsIHtcbiAgICAgICAgICAgIHNjaGVkdWxlOiBTY2hlZHVsZS5leHByZXNzaW9uKHRhc2tDb25maWcuc2NoZWR1bGUpLFxuICAgICAgICAgICAgdGFyZ2V0czogW1xuICAgICAgICAgICAgICAgIG5ldyBhd3NfZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24odGFzayksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KTtcblxuICAgIH1cbn1cbiJdfQ==