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
const utils_1 = require("../utils");
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
        const taskProps = (0, utils_1.merge)([
            this.schedulerConstructConfig.functionProps ?? {},
            taskConfig.functionProps ?? {}
        ]);
        const taskConfigEnv = [...(this.schedulerConstructConfig.env ?? []), ...taskConfig.env ?? []];
        this.logger.debug(`Registering task ${taskName}`);
        const task = new lambda_function_1.LambdaFunction(this.mainStack, taskName + "-task", {
            entry: taskInfo.filePath + "/" + taskInfo.fileName,
            environmentVariables: this.fw24.resolveEnvVariables(taskConfigEnv),
            allowSendEmail: true,
            functionTimeout: taskConfig.functionTimeout || this.fw24.getConfig().functionTimeout,
            functionProps: taskProps,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvc2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUF3RDtBQUN4RCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUd6Rix1REFBd0Q7QUFJeEQsd0NBQXVEO0FBQ3ZELG9DQUFpQztBQUNqQyx1REFBbUQ7QUFDbkQsbUNBQXlDO0FBQ3pDLCtCQUFxQztBQXNCckM7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQWEsa0JBQWtCO0lBV0U7SUFWcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxrQkFBa0IsQ0FBQyxJQUFJLENBQUM7SUFDdkMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUNwRSxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQiw0REFBNEQ7SUFDNUQsWUFBNkIsd0JBQW1EO1FBQW5ELDZCQUF3QixHQUF4Qix3QkFBd0IsQ0FBMkI7UUFDNUUsZUFBTSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUNoRSxDQUFDO0lBRUQsdUNBQXVDO0lBRTFCLEFBQU4sS0FBSyxDQUFDLFNBQVM7UUFDbEIsNkNBQTZDO1FBQzdDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDNUgsa0RBQWtEO1FBQ2xELElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMs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LFFBQVEsQ0FBQyxDQUFDO1FBRXhFLElBQUksaUJBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsR0FBRyxZQUFZLEVBQUU7WUFDOUMsUUFBUSxFQUFFLHFCQUFRLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7WUFDbEQsT0FBTyxFQUFFO2dCQUNMLElBQUksZ0NBQWtCLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQzthQUM5QztTQUNKLENBQUMsQ0FBQztJQUVQLENBQUMsQ0FBQTtDQUNKO0FBN0VELGdEQTZFQztBQTVEZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7bURBd0JiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIGF3c19ldmVudHNfdGFyZ2V0cyB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcbmltcG9ydCB7IEhlbHBlciB9IGZyb20gXCIuLi9jb3JlL2hlbHBlclwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IEhhbmRsZXJEZXNjcmlwdG9yIGZyb20gXCIuLi9pbnRlcmZhY2VzL2hhbmRsZXItZGVzY3JpcHRvclwiO1xuXG5pbXBvcnQgeyBSdWxlLCBTY2hlZHVsZSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiwgTm9kZWpzRnVuY3Rpb25Qcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqc1wiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IElMYW1iZGFFbnZDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9sYW1iZGEtZW52XCI7XG5pbXBvcnQgeyBMb2dEdXJhdGlvbiwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IG1lcmdlIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQgeyBMYW1iZGFGdW5jdGlvbiB9IGZyb20gXCIuL2xhbWJkYS1mdW5jdGlvblwiO1xuaW1wb3J0IHsgTGF5ZXJDb25zdHJ1Y3QgfSBmcm9tIFwiLi9sYXllclwiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5cbi8qKlxuICogUmVwcmVzZW50cyB0aGUgY29uZmlndXJhdGlvbiBmb3IgdGhlIFNjaGVkdWxlciBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIFRoZSBkaXJlY3Rvcnkgd2hlcmUgdGhlIHRhc2tzIGFyZSBsb2NhdGVkLlxuICAgICAqL1xuICAgIHRhc2tzRGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGVudmlyb25tZW50IGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBMYW1iZGEgZnVuY3Rpb25zLlxuICAgICAqL1xuICAgIGVudj86IElMYW1iZGFFbnZDb25maWdbXTtcblxuICAgIC8qKlxuICAgICAqIFRoZSBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgTm9kZS5qcyBmdW5jdGlvbnMuXG4gICAgICovXG4gICAgZnVuY3Rpb25Qcm9wcz86IE5vZGVqc0Z1bmN0aW9uUHJvcHM7XG59XG5cbi8qKlxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCBzY2hlZHVsZXJDb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gKiAgIHRhc2tzRGlyZWN0b3J5OiBcIi4vc3JjL3Rhc2tzXCIsXG4gKiAgIC8vIG90aGVyIGNvbmZpZ3VyYXRpb24gcHJvcGVydGllc1xuICogfTtcbiAqIGNvbnN0IHNjaGVkdWxlciA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3Qoc2NoZWR1bGVyQ29uZmlnKTtcbiAqIGF3YWl0IHNjaGVkdWxlci5jb25zdHJ1Y3QoKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgU2NoZWR1bGVyQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKFNjaGVkdWxlckNvbnN0cnVjdC5uYW1lKTtcbiAgICByZWFkb25seSBmdzI0OiBGdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuXG4gICAgbmFtZTogc3RyaW5nID0gU2NoZWR1bGVyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFsgVnBjQ29uc3RydWN0Lm5hbWUsIExheWVyQ29uc3RydWN0Lm5hbWUgXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG5cbiAgICAvLyBkZWZhdWx0IGNvbnN0cnVjdG9yIHRvIGluaXRpYWxpemUgdGhlIHN0YWNrIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHNjaGVkdWxlckNvbnN0cnVjdENvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZykge1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhzY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcsICdTQ0hFRFVMRVInKTtcbiAgICB9XG5cbiAgICAvLyBjb25zdHJ1Y3QgbWV0aG9kIHRvIGNyZWF0ZSB0aGUgc3RhY2tcbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIC8vIG1ha2UgdGhlIG1haW4gc3RhY2sgYXZhaWxhYmxlIHRvIHRoZSBjbGFzc1xuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5zdGFja05hbWUsIHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnBhcmVudFN0YWNrTmFtZSk7XG4gICAgICAgIC8vIHNldHMgdGhlIGRlZmF1bHQgdGFza3MgZGlyZWN0b3J5IGlmIG5vdCBkZWZpbmVkXG4gICAgICAgIGlmICh0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5ID09PSBcIlwiKSB7XG4gICAgICAgICAgICB0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSA9IFwiLi9zcmMvdGFza3NcIjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlZ2lzdGVyIHRoZSB0YXNrc1xuICAgICAgICBhd2FpdCBIZWxwZXIucmVnaXN0ZXJIYW5kbGVycyh0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSwgdGhpcy5yZWdpc3RlclRhc2spO1xuXG4gICAgICAgIGlmICh0aGlzLmZ3MjQuaGFzTW9kdWxlcygpKSB7XG4gICAgICAgICAgICBjb25zdCBtb2R1bGVzID0gdGhpcy5mdzI0LmdldE1vZHVsZXMoKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyAsIG1vZHVsZSBdIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlUGF0aCA9IG1vZHVsZS5nZXRCYXNlUGF0aCgpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHRhc2tzRGlyZWN0b3J5ID0gbW9kdWxlLmdldFRhc2tzRGlyZWN0b3J5KCk7XG4gICAgICAgICAgICAgICAgaWYgKHRhc2tzRGlyZWN0b3J5ICE9ICcnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJMb2FkIHRhc2tzIGZyb20gbW9kdWxlIGJhc2UtcGF0aDogXCIsIGJhc2VQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVyVGFza3NGcm9tTW9kdWxlKG1vZHVsZSwgdGhpcy5yZWdpc3RlclRhc2spO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgcHJpdmF0ZSByZWFkb25seSByZWdpc3RlclRhc2sgPSAodGFza0luZm86IEhhbmRsZXJEZXNjcmlwdG9yKSA9PiB7XG4gICAgICAgIHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZSA9IG5ldyB0YXNrSW5mby5oYW5kbGVyQ2xhc3MoKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJUYXNrIGluc3RhbmNlOiBcIiwgdGFza0luZm8uaGFuZGxlckluc3RhbmNlKTtcblxuICAgICAgICBjb25zdCB0YXNrTmFtZSA9IHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZS50YXNrTmFtZTtcbiAgICAgICAgY29uc3QgdGFza0NvbmZpZyA9IHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZS50YXNrQ29uZmlnIHx8IHt9O1xuICAgICAgICBjb25zdCB0YXNrUHJvcHMgPSBtZXJnZShbXG4gICAgICAgICAgICB0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzID8/IHt9LFxuICAgICAgICAgICAgdGFza0NvbmZpZy5mdW5jdGlvblByb3BzID8/IHt9XG4gICAgICAgIF0pITtcbiAgICAgICAgY29uc3QgdGFza0NvbmZpZ0VudiA9IFsgLi4uKHRoaXMuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmVudiA/PyBbXSksIC4uLnRhc2tDb25maWcuZW52ID8/IFtdIF07XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJlZ2lzdGVyaW5nIHRhc2sgJHt0YXNrTmFtZX1gKTtcblxuICAgICAgICBjb25zdCB0YXNrID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMubWFpblN0YWNrLCB0YXNrTmFtZSArIFwiLXRhc2tcIiwge1xuICAgICAgICAgICAgZW50cnk6IHRhc2tJbmZvLmZpbGVQYXRoICsgXCIvXCIgKyB0YXNrSW5mby5maWxlTmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyh0YXNrQ29uZmlnRW52KSxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiB0YXNrQ29uZmlnLmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogdGFza1Byb3BzLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IHRhc2tDb25maWcucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiB0YXNrQ29uZmlnLmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiB0YXNrQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdGFza05hbWUsIHRhc2ssIE91dHB1dFR5cGUuRlVOQ1RJT04pO1xuXG4gICAgICAgIG5ldyBSdWxlKHRoaXMubWFpblN0YWNrLCB0YXNrTmFtZSArIFwiLXNjaGVkdWxlclwiLCB7XG4gICAgICAgICAgICBzY2hlZHVsZTogU2NoZWR1bGUuZXhwcmVzc2lvbih0YXNrQ29uZmlnLnNjaGVkdWxlKSxcbiAgICAgICAgICAgIHRhcmdldHM6IFtcbiAgICAgICAgICAgICAgICBuZXcgYXdzX2V2ZW50c190YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRhc2spLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG5cbiAgICB9XG59XG4iXX0=