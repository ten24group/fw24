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
const fw24_1 = require("../core/fw24");
const helper_1 = require("../core/helper");
const construct_1 = require("../interfaces/construct");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const logging_1 = require("../logging");
const lambda_function_1 = require("./lambda-function");
const layer_1 = require("./layer");
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
    dependencies = [vpc_1.VpcConstruct.name, layer_1.LayerConstruct.name];
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
        this.logger.debug(`Registering task ${taskName}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvc2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUF3RDtBQUN4RCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUd6Rix1REFBd0Q7QUFJeEQsd0NBQXVEO0FBQ3ZELHVEQUFtRDtBQUNuRCxtQ0FBeUM7QUFDekMsK0JBQXFDO0FBc0JyQzs7Ozs7Ozs7OztHQVVHO0FBQ0gsTUFBYSxrQkFBa0I7SUFXRTtJQVZwQixNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9DLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLGtCQUFrQixDQUFDLElBQUksQ0FBQztJQUN2QyxZQUFZLEdBQWEsQ0FBQyxrQkFBWSxDQUFDLElBQUksRUFBRSxzQkFBYyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2xFLE1BQU0sQ0FBdUI7SUFFN0IsU0FBUyxDQUFTO0lBRWxCLDREQUE0RDtJQUM1RCxZQUE2Qix3QkFBbUQ7UUFBbkQsNkJBQXdCLEdBQXhCLHdCQUF3QixDQUEyQjtRQUM1RSxlQUFNLENBQUMsYUFBYSxDQUFDLHdCQUF3QixFQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQy9ELENBQUM7SUFFRCx1Q0FBdUM7SUFFMUIsQUFBTixLQUFLLENBQUMsU0FBUztRQUNsQiw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUM1SCxrREFBa0Q7UUFDbEQsSUFBRyxJQUFJLENBQUMsd0JBQXdCLENBQUMsY0FBYyxLQUFLLFNBQVMsSUFB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QUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLEdBQUcsWUFBWSxFQUFFO1lBQzlDLFFBQVEsRUFBRSxxQkFBUSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO1lBQ2xELE9BQU8sRUFBRTtnQkFDTCxJQUFJLGdDQUFrQixDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUM7YUFDOUM7U0FDSixDQUFDLENBQUM7SUFFUCxDQUFDLENBQUE7Q0FDSjtBQTVFRCxnREE0RUM7QUEzRGdCO0lBRFosSUFBQSxxQkFBVyxHQUFFO21EQXdCYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBhd3NfZXZlbnRzX3RhcmdldHMgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgUnVsZSwgU2NoZWR1bGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50c1wiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBJTGFtYmRhRW52Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvbGFtYmRhLWVudlwiO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIFNjaGVkdWxlciBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIHRhc2tzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIHRhc2tzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqL1xuICAgIGVudj86IElMYW1iZGFFbnZDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvbnMuXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG59XG5cbi8qKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCBzY2hlZHVsZXJDb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gKiAgIHRhc2tzRGlyZWN0b3J5OiBcIi4vc3JjL3Rhc2tzXCIsXG4gKiAgIC8vIG90aGVyIGNvbmZpZ3VyYXRpb24gcHJvcGVydGllc1xuICogfTtcbiAqIGNvbnN0IHNjaGVkdWxlciA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3Qoc2NoZWR1bGVyQ29uZmlnKTtcbiAqIGF3YWl0IHNjaGVkdWxlci5jb25zdHJ1Y3QoKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgU2NoZWR1bGVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFNjaGVkdWxlckNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgIFxuICAgIG5hbWU6IHN0cmluZyA9IFNjaGVkdWxlckNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbVnBjQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWVdO1xuICAgIG91dHB1dCE6IEZXMjRDb25zdHJ1Y3RPdXRwdXQ7XG5cbiAgICBtYWluU3RhY2shOiBTdGFjaztcblxuICAgIC8vIGRlZmF1bHQgY29uc3RydWN0b3IgdG8gaW5pdGlhbGl6ZSB0aGUgc3RhY2sgY29uZmlndXJhdGlvblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKHNjaGVkdWxlckNvbnN0cnVjdENvbmZpZywnU0NIRURVTEVSJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IHRhc2tzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZih0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5ID09PSBcIlwiKXtcbiAgICAgICAgICAgIHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5ID0gXCIuL3NyYy90YXNrc1wiO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gcmVnaXN0ZXIgdGhlIHRhc2tzXG4gICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlckhhbmRsZXJzKHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5LCB0aGlzLnJlZ2lzdGVyVGFzayk7XG5cbiAgICAgICAgaWYgKHRoaXMuZncyNC5oYXNNb2R1bGVzKCkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1vZHVsZXMgPSB0aGlzLmZ3MjQuZ2V0TW9kdWxlcygpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbLCBtb2R1bGVdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRhc2tzRGlyZWN0b3J5ID0gbW9kdWxlLmdldFRhc2tzRGlyZWN0b3J5KCk7XG4gICAgICAgICAgICAgICAgaWYodGFza3NEaXJlY3RvcnkgIT0gJycpe1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiTG9hZCB0YXNrcyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlclRhc2tzRnJvbU1vZHVsZShtb2R1bGUsIHRoaXMucmVnaXN0ZXJUYXNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJUYXNrID0gKHRhc2tJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICB0YXNrSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgdGFza0luZm8uaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiVGFzayBpbnN0YW5jZTogXCIsIHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZSk7XG4gICAgICAgIFxuICAgICAgICBjb25zdCB0YXNrTmFtZSA9IHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZS50YXNrTmFtZTtcbiAgICAgICAgY29uc3QgdGFza0NvbmZpZyA9IHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZS50YXNrQ29uZmlnIHx8IHt9O1xuICAgICAgICBjb25zdCB0YXNrUHJvcHMgPSB7Li4udGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcywgLi4udGFza0NvbmZpZy5mdW5jdGlvblByb3BzfTtcbiAgICAgICAgY29uc3QgdGFza0NvbmZpZ0VudiA9IFsuLi4odGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZW52ID8/IFtdKSwuLi50YXNrQ29uZmlnLmVudiA/PyBbXV07XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHRhc2sgJHt0YXNrTmFtZX1gKTtcblxuICAgICAgICBjb25zdCB0YXNrID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCB0YXNrTmFtZSArIFwiLXRhc2tcIiwge1xuICAgICAgICAgICAgZW50cnk6IHRhc2tJbmZvLmZpbGVQYXRoICsgXCIvXCIgKyB0YXNrSW5mby5maWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyh0YXNrQ29uZmlnRW52KSxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiB0YXNrQ29uZmlnLmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgICAgICAgIC4uLnRhc2tQcm9wcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICByZXNvdXJjZUFjY2VzczogdGFza0NvbmZpZy5yZXNvdXJjZUFjY2VzcyxcbiAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHRhc2tDb25maWcubG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IHRhc2tDb25maWcubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgICAgfSkgYXMgTm9kZWpzRnVuY3Rpb247XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCB0YXNrTmFtZSwgdGFzaywgT3V0cHV0VHlwZS5GVU5DVElPTik7XG5cbiAgICAgICAgbmV3IFJ1bGUodGhpcy5tYWluU3RhY2ssIHRhc2tOYW1lICsgXCItc2NoZWR1bGVyXCIsIHtcbiAgICAgICAgICAgIHNjaGVkdWxlOiBTY2hlZHVsZS5leHByZXNzaW9uKHRhc2tDb25maWcuc2NoZWR1bGUpLFxuICAgICAgICAgICAgdGFyZ2V0czogW1xuICAgICAgICAgICAgICAgIG5ldyBhd3NfZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24odGFzayksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KTtcblxuICAgIH1cbn1cbiJdfQ==