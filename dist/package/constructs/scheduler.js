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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvc2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUF3RDtBQUN4RCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUd6Rix1REFBd0Q7QUFJeEQsd0NBQXVEO0FBQ3ZELHVEQUFtRDtBQUNuRCwrQkFBcUM7QUFzQnJDOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFhLGtCQUFrQjtJQVdFO0lBVnBCLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDL0MsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsa0JBQWtCLENBQUMsSUFBSSxDQUFDO0lBQ3ZDLFlBQVksR0FBYSxDQUFDLGtCQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0MsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFFbEIsNERBQTREO0lBQzVELFlBQTZCLHdCQUFtRDtRQUFuRCw2QkFBd0IsR0FBeEIsd0JBQXdCLENBQTJCO1FBQzVFLGVBQU0sQ0FBQyxhQUFhLENBQUMsd0JBQXdCLEVBQUMsV0FBVyxDQUFDLENBQUM7SUFDL0QsQ0FBQztJQUVELHVDQUF1QztJQUUxQixBQUFOLEtBQUssQ0FBQyxTQUFTO1FBQ2xCLDZDQUE2QztRQUM3QyxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLHdCQUF3QixDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQzVILGtEQUFrRDtRQUNsRCxJQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxjQUFjLEtBQUssU0FBUyxJQUFJLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxjQUFjLEtBQUss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QUFZLEVBQUU7WUFDOUMsUUFBUSxFQUFFLHFCQUFRLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7WUFDbEQsT0FBTyxFQUFFO2dCQUNMLElBQUksZ0NBQWtCLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQzthQUM5QztTQUNKLENBQUMsQ0FBQztJQUVQLENBQUMsQ0FBQTtDQUNKO0FBNUVELGdEQTRFQztBQTNEZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7bURBd0JiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIGF3c19ldmVudHNfdGFyZ2V0cyB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBSdWxlLCBTY2hlZHVsZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9sYW1iZGEtZW52XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IExhbWJkYUZ1bmN0aW9uIH0gZnJvbSBcIi4vbGFtYmRhLWZ1bmN0aW9uXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcblxuLyoqXG4gKiBSZXByZXNlbnRzIHRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgU2NoZWR1bGVyIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnIGV4dGVuZHMgSUNvbnN0cnVjdENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogVGhlIGRpcmVjdG9yeSB3aGVyZSB0aGUgdGFza3MgYXJlIGxvY2F0ZWQuXG4gICAgICovXG4gICAgdGFza3NEaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbnMuXG4gICAgICovXG4gICAgZW52PzogSUxhbWJkYUVudkNvbmZpZ1tdO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIHRoZSBOb2RlLmpzIGZ1bmN0aW9ucy5cbiAgICAgKi9cbiAgICBmdW5jdGlvblByb3BzPzogTm9kZWpzRnVuY3Rpb25Qcm9wcztcbn1cblxuLyoqXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGNvbnN0IHNjaGVkdWxlckNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAqICAgdGFza3NEaXJlY3Rvcnk6IFwiLi9zcmMvdGFza3NcIixcbiAqICAgLy8gb3RoZXIgY29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzXG4gKiB9O1xuICogY29uc3Qgc2NoZWR1bGVyID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChzY2hlZHVsZXJDb25maWcpO1xuICogYXdhaXQgc2NoZWR1bGVyLmNvbnN0cnVjdCgpO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBTY2hlZHVsZXJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoU2NoZWR1bGVyQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZTogc3RyaW5nID0gU2NoZWR1bGVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtWcGNDb25zdHJ1Y3QubmFtZV07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLy8gZGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBzY2hlZHVsZXJDb25zdHJ1Y3RDb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLCdTQ0hFRFVMRVInKTtcbiAgICB9XG5cbiAgICAvLyBjb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2tcbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIG1ha2UgdGhlIG1haW4gc3RhY2sgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgdGFza3MgZGlyZWN0b3J5IGlmIG5vdCBkZWZpbmVkXG4gICAgICAgIGlmKHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5ID09PSB1bmRlZmluZWQgfHwgdGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnkgPT09IFwiXCIpe1xuICAgICAgICAgICAgdGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnkgPSBcIi4vc3JjL3Rhc2tzXCI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWdpc3RlciB0aGUgdGFza3NcbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnksIHRoaXMucmVnaXN0ZXJUYXNrKTtcblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlcyA9IHRoaXMuZncyNC5nZXRNb2R1bGVzKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFssIG1vZHVsZV0gb2YgbW9kdWxlcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2VQYXRoID0gbW9kdWxlLmdldEJhc2VQYXRoKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgdGFza3NEaXJlY3RvcnkgPSBtb2R1bGUuZ2V0VGFza3NEaXJlY3RvcnkoKTtcbiAgICAgICAgICAgICAgICBpZih0YXNrc0RpcmVjdG9yeSAhPSAnJyl7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJMb2FkIHRhc2tzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlKG1vZHVsZSwgdGhpcy5yZWdpc3RlclRhc2spO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlclRhc2sgPSAodGFza0luZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZSA9IG5ldyB0YXNrSW5mby5oYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUYXNrIGluc3RhbmNlOiBcIiwgdGFza0luZm8uaGFuZGxlckluc3RhbmNlKTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHRhc2tOYW1lID0gdGFza0luZm8uaGFuZGxlckluc3RhbmNlLnRhc2tOYW1lO1xuICAgICAgICBjb25zdCB0YXNrQ29uZmlnID0gdGFza0luZm8uaGFuZGxlckluc3RhbmNlLnRhc2tDb25maWcgfHwge307XG4gICAgICAgIGNvbnN0IHRhc2tQcm9wcyA9IHsuLi50aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzLCAuLi50YXNrQ29uZmlnLmZ1bmN0aW9uUHJvcHN9O1xuICAgICAgICBjb25zdCB0YXNrQ29uZmlnRW52ID0gWy4uLih0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnYgPz8gW10pLC4uLnRhc2tDb25maWcuZW52ID8/IFtdXTtcblxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJpbmcgdGFzayAke3Rhc2tOYW1lfWApO1xuXG4gICAgICAgIGNvbnN0IHRhc2sgPSBuZXcgTGFtYmRhRnVuY3Rpb24odGhpcy5tYWluU3RhY2ssIHRhc2tOYW1lICsgXCItdGFza1wiLCB7XG4gICAgICAgICAgICBlbnRyeTogdGFza0luZm8uZmlsZVBhdGggKyBcIi9cIiArIHRhc2tJbmZvLmZpbGVOYW1lLFxuICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHRoaXMuZncyNC5yZXNvbHZlRW52VmFyaWFibGVzKHRhc2tDb25maWdFbnYpLFxuICAgICAgICAgICAgYWxsb3dTZW5kRW1haWw6IHRydWUsXG4gICAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IHRhc2tDb25maWcuZnVuY3Rpb25UaW1lb3V0IHx8IHRoaXMuZncyNC5nZXRDb25maWcoKS5mdW5jdGlvblRpbWVvdXQsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgICAgICAgLi4udGFza1Byb3BzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlc291cmNlQWNjZXNzOiB0YXNrQ29uZmlnLnJlc291cmNlQWNjZXNzLFxuICAgICAgICAgICAgbG9nUmV0ZW50aW9uRGF5czogdGFza0NvbmZpZy5sb2dSZXRlbnRpb25EYXlzLFxuICAgICAgICAgICAgbG9nUmVtb3ZhbFBvbGljeTogdGFza0NvbmZpZy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgICB9KSBhcyBOb2RlanNGdW5jdGlvbjtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHRhc2tOYW1lLCB0YXNrLCBPdXRwdXRUeXBlLkZVTkNUSU9OKTtcblxuICAgICAgICBuZXcgUnVsZSh0aGlzLm1haW5TdGFjaywgdGFza05hbWUgKyBcIi1zY2hlZHVsZXJcIiwge1xuICAgICAgICAgICAgc2NoZWR1bGU6IFNjaGVkdWxlLmV4cHJlc3Npb24odGFza0NvbmZpZy5zY2hlZHVsZSksXG4gICAgICAgICAgICB0YXJnZXRzOiBbXG4gICAgICAgICAgICAgICAgbmV3IGF3c19ldmVudHNfdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0YXNrKSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pO1xuXG4gICAgfVxufVxuIl19