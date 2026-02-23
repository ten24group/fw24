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
            handlerClassName: taskInfo.handlerClass.name,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvc2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLDZDQUF3RDtBQUN4RCx1Q0FBb0M7QUFDcEMsMkNBQXdDO0FBQ3hDLHVEQUF5RjtBQUd6Rix1REFBd0Q7QUFJeEQsd0NBQXVEO0FBQ3ZELG9DQUFpQztBQUNqQyx1REFBbUQ7QUFDbkQsbUNBQXlDO0FBQ3pDLCtCQUFxQztBQXNCckM7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQWEsa0JBQWtCO0lBV0U7SUFWcEIsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvQyxJQUFJLEdBQVMsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXpDLElBQUksR0FBVyxrQkFBa0IsQ0FBQyxJQUFJLENBQUM7SUFDdkMsWUFBWSxHQUFhLENBQUUsa0JBQVksQ0FBQyxJQUFJLEVBQUUsc0JBQWMsQ0FBQyxJQUFJLENBQUUsQ0FBQztJQUNwRSxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUVsQiw0REFBNEQ7SUFDNUQsWUFBNkIsd0JBQW1EO1FBQW5ELDZCQUF3QixHQUF4Qix3QkFBd0IsQ0FBMkI7UUFDNUUsZUFBTSxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUNoRSxDQUFDO0lBRUQsdUNBQXVDO0lBRTFCLEFBQU4sS0FBSyxDQUFDLFNBQVM7UUFDbEIsNkNBQTZDO1FBQzdDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsd0JBQXdCLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDNUgsa0RBQWtEO1FBQ2xELElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsS0FBSyxTQUFTLElBQUksSUFBSSxDQUFDLHdCQUF3QixDQUFDLGNBQWMsS0FBSyxFQUFFLEVBQUUsQ0FBQztZQUNwSCxJQUFJLENBQUMsd0JBQXdCLENBQUMsY0FBYyxHQUFHLGFBQWEsQ0FBQztRQUNqRSxDQUFDO1FBRUQscUJBQXFCO1FBQ3JCLE1BQU0sZUFBTSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRS9GLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDdkMsS0FBSyxNQUFNLENBQUUsQUFBRCxFQUFHLE1BQU0sQ0FBRSxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNqQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7Z0JBQ3RDLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO2dCQUNsRCxJQUFJLGNBQWMsSUFBSSxFQUFFLEVBQUUsQ0FBQztvQkFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsb0NBQW9DLEVBQUUsUUFBUSxDQUFDLENBQUM7b0JBQ2pFLE1BQU0sZUFBTSxDQUFDLHVCQUF1QixDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQ3BFLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQztJQUVMLENBQUM7SUFFZ0IsWUFBWSxHQUFHLENBQUMsUUFBMkIsRUFBRSxFQUFFO1FBQzVELFFBQVEsQ0FBQyxlQUFlLEdBQUcsSUFBSSxRQUFRLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDdkQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLEVBQUUsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRS9ELE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUFDO1FBQ25ELE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQztRQUM3RCxNQUFNLFNBQVMsR0FBRyxJQUFBLGFBQUssRUFBQztZQUNwQixJQUFJLENBQUMsd0JBQXdCLENBQUMsYUFBYSxJQUFJLEVBQUU7WUFDakQsVUFBVSxDQUFDLGFBQWEsSUFBSSxFQUFFO1NBQ2pDLENBQUUsQ0FBQztRQUNKLE1BQU0sYUFBYSxHQUFHLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxVQUFVLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBRSxDQUFDO1FBRWhHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG9CQUFvQixRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRWxELE1BQU0sSUFBSSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsR0FBRyxPQUFPLEVBQUU7WUFDaEUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxRQUFRLEdBQUcsR0FBRyxHQUFHLFFBQVEsQ0FBQyxRQUFRO1lBQ2xELGdCQUFnQixFQUFFLFFBQVEsQ0FBQyxZQUFZLENBQUMsSUFBSTtZQUM1QyxvQkFBb0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLGFBQWEsQ0FBQztZQUNsRSxjQUFjLEVBQUUsSUFBSTtZQUNwQixlQUFlLEVBQUUsVUFBVSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDLGVBQWU7WUFDcEYsYUFBYSxFQUFFLFNBQVM7WUFDeEIsY0FBYyxFQUFFLFVBQVUsQ0FBQyxjQUFjO1lBQ3pDLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0I7WUFDN0MsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQjtTQUNoRCxDQUFtQixDQUFDO1FBRXJCLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsc0JBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUV4RSxJQUFJLGlCQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLEdBQUcsWUFBWSxFQUFFO1lBQzlDLFFBQVEsRUFBRSxxQkFBUSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO1lBQ2xELE9BQU8sRUFBRTtnQkFDTCxJQUFJLGdDQUFrQixDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUM7YUFDOUM7U0FDSixDQUFDLENBQUM7SUFFUCxDQUFDLENBQUE7Q0FDSjtBQTlFRCxnREE4RUM7QUE3RGdCO0lBRFosSUFBQSxxQkFBVyxHQUFFO21EQXdCYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBhd3NfZXZlbnRzX3RhcmdldHMgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZXMjRDb25zdHJ1Y3QsIEZXMjRDb25zdHJ1Y3RPdXRwdXQsIE91dHB1dFR5cGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3RcIjtcbmltcG9ydCBIYW5kbGVyRGVzY3JpcHRvciBmcm9tIFwiLi4vaW50ZXJmYWNlcy9oYW5kbGVyLWRlc2NyaXB0b3JcIjtcblxuaW1wb3J0IHsgUnVsZSwgU2NoZWR1bGUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWV2ZW50c1wiO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24sIE5vZGVqc0Z1bmN0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanNcIjtcbmltcG9ydCB7IElDb25zdHJ1Y3RDb25maWcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9jb25zdHJ1Y3QtY29uZmlnXCI7XG5pbXBvcnQgeyBJTGFtYmRhRW52Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvbGFtYmRhLWVudlwiO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBtZXJnZSB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgTGFtYmRhRnVuY3Rpb24gfSBmcm9tIFwiLi9sYW1iZGEtZnVuY3Rpb25cIjtcbmltcG9ydCB7IExheWVyQ29uc3RydWN0IH0gZnJvbSBcIi4vbGF5ZXJcIjtcbmltcG9ydCB7IFZwY0NvbnN0cnVjdCB9IGZyb20gXCIuL3ZwY1wiO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBTY2hlZHVsZXIgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBUaGUgZGlyZWN0b3J5IHdoZXJlIHRoZSB0YXNrcyBhcmUgbG9jYXRlZC5cbiAgICAgKi9cbiAgICB0YXNrc0RpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBlbnZpcm9ubWVudCBjb25maWd1cmF0aW9uIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9ucy5cbiAgICAgKi9cbiAgICBlbnY/OiBJTGFtYmRhRW52Q29uZmlnW107XG5cbiAgICAvKipcbiAgICAgKiBUaGUgZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgdGhlIE5vZGUuanMgZnVuY3Rpb25zLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uUHJvcHM/OiBOb2RlanNGdW5jdGlvblByb3BzO1xufVxuXG4vKipcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogY29uc3Qgc2NoZWR1bGVyQ29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICogICB0YXNrc0RpcmVjdG9yeTogXCIuL3NyYy90YXNrc1wiLFxuICogICAvLyBvdGhlciBjb25maWd1cmF0aW9uIHByb3BlcnRpZXNcbiAqIH07XG4gKiBjb25zdCBzY2hlZHVsZXIgPSBuZXcgU2NoZWR1bGVyQ29uc3RydWN0KHNjaGVkdWxlckNvbmZpZyk7XG4gKiBhd2FpdCBzY2hlZHVsZXIuY29uc3RydWN0KCk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIFNjaGVkdWxlckNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihTY2hlZHVsZXJDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcblxuICAgIG5hbWU6IHN0cmluZyA9IFNjaGVkdWxlckNvbnN0cnVjdC5uYW1lO1xuICAgIGRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbIFZwY0NvbnN0cnVjdC5uYW1lLCBMYXllckNvbnN0cnVjdC5uYW1lIF07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuXG4gICAgLy8gZGVmYXVsdCBjb25zdHJ1Y3RvciB0byBpbml0aWFsaXplIHRoZSBzdGFjayBjb25maWd1cmF0aW9uXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBzY2hlZHVsZXJDb25zdHJ1Y3RDb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcpIHtcbiAgICAgICAgSGVscGVyLmh5ZHJhdGVDb25maWcoc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLCAnU0NIRURVTEVSJyk7XG4gICAgfVxuXG4gICAgLy8gY29uc3RydWN0IG1ldGhvZCB0byBjcmVhdGUgdGhlIHN0YWNrXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICAvLyBtYWtlIHRoZSBtYWluIHN0YWNrIGF2YWlsYWJsZSB0byB0aGUgY2xhc3NcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuc3RhY2tOYW1lLCB0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuICAgICAgICAvLyBzZXRzIHRoZSBkZWZhdWx0IHRhc2tzIGRpcmVjdG9yeSBpZiBub3QgZGVmaW5lZFxuICAgICAgICBpZiAodGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnkgPT09IHVuZGVmaW5lZCB8fCB0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSA9PT0gXCJcIikge1xuICAgICAgICAgICAgdGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnkgPSBcIi4vc3JjL3Rhc2tzXCI7XG4gICAgICAgIH1cblxuICAgICAgICAvLyByZWdpc3RlciB0aGUgdGFza3NcbiAgICAgICAgYXdhaXQgSGVscGVyLnJlZ2lzdGVySGFuZGxlcnModGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnksIHRoaXMucmVnaXN0ZXJUYXNrKTtcblxuICAgICAgICBpZiAodGhpcy5mdzI0Lmhhc01vZHVsZXMoKSkge1xuICAgICAgICAgICAgY29uc3QgbW9kdWxlcyA9IHRoaXMuZncyNC5nZXRNb2R1bGVzKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgLCBtb2R1bGUgXSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZVBhdGggPSBtb2R1bGUuZ2V0QmFzZVBhdGgoKTtcbiAgICAgICAgICAgICAgICBjb25zdCB0YXNrc0RpcmVjdG9yeSA9IG1vZHVsZS5nZXRUYXNrc0RpcmVjdG9yeSgpO1xuICAgICAgICAgICAgICAgIGlmICh0YXNrc0RpcmVjdG9yeSAhPSAnJykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiTG9hZCB0YXNrcyBmcm9tIG1vZHVsZSBiYXNlLXBhdGg6IFwiLCBiYXNlUGF0aCk7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEhlbHBlci5yZWdpc3RlclRhc2tzRnJvbU1vZHVsZShtb2R1bGUsIHRoaXMucmVnaXN0ZXJUYXNrKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVnaXN0ZXJUYXNrID0gKHRhc2tJbmZvOiBIYW5kbGVyRGVzY3JpcHRvcikgPT4ge1xuICAgICAgICB0YXNrSW5mby5oYW5kbGVySW5zdGFuY2UgPSBuZXcgdGFza0luZm8uaGFuZGxlckNsYXNzKCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiVGFzayBpbnN0YW5jZTogXCIsIHRhc2tJbmZvLmhhbmRsZXJJbnN0YW5jZSk7XG5cbiAgICAgICAgY29uc3QgdGFza05hbWUgPSB0YXNrSW5mby5oYW5kbGVySW5zdGFuY2UudGFza05hbWU7XG4gICAgICAgIGNvbnN0IHRhc2tDb25maWcgPSB0YXNrSW5mby5oYW5kbGVySW5zdGFuY2UudGFza0NvbmZpZyB8fCB7fTtcbiAgICAgICAgY29uc3QgdGFza1Byb3BzID0gbWVyZ2UoW1xuICAgICAgICAgICAgdGhpcy5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcyA/PyB7fSxcbiAgICAgICAgICAgIHRhc2tDb25maWcuZnVuY3Rpb25Qcm9wcyA/PyB7fVxuICAgICAgICBdKSE7XG4gICAgICAgIGNvbnN0IHRhc2tDb25maWdFbnYgPSBbIC4uLih0aGlzLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnYgPz8gW10pLCAuLi50YXNrQ29uZmlnLmVudiA/PyBbXSBdO1xuXG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSZWdpc3RlcmluZyB0YXNrICR7dGFza05hbWV9YCk7XG5cbiAgICAgICAgY29uc3QgdGFzayA9IG5ldyBMYW1iZGFGdW5jdGlvbih0aGlzLm1haW5TdGFjaywgdGFza05hbWUgKyBcIi10YXNrXCIsIHtcbiAgICAgICAgICAgIGVudHJ5OiB0YXNrSW5mby5maWxlUGF0aCArIFwiL1wiICsgdGFza0luZm8uZmlsZU5hbWUsXG4gICAgICAgICAgICBoYW5kbGVyQ2xhc3NOYW1lOiB0YXNrSW5mby5oYW5kbGVyQ2xhc3MubmFtZSxcbiAgICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB0aGlzLmZ3MjQucmVzb2x2ZUVudlZhcmlhYmxlcyh0YXNrQ29uZmlnRW52KSxcbiAgICAgICAgICAgIGFsbG93U2VuZEVtYWlsOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25UaW1lb3V0OiB0YXNrQ29uZmlnLmZ1bmN0aW9uVGltZW91dCB8fCB0aGlzLmZ3MjQuZ2V0Q29uZmlnKCkuZnVuY3Rpb25UaW1lb3V0LFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczogdGFza1Byb3BzLFxuICAgICAgICAgICAgcmVzb3VyY2VBY2Nlc3M6IHRhc2tDb25maWcucmVzb3VyY2VBY2Nlc3MsXG4gICAgICAgICAgICBsb2dSZXRlbnRpb25EYXlzOiB0YXNrQ29uZmlnLmxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgICAgICBsb2dSZW1vdmFsUG9saWN5OiB0YXNrQ29uZmlnLmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICAgIH0pIGFzIE5vZGVqc0Z1bmN0aW9uO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgdGFza05hbWUsIHRhc2ssIE91dHB1dFR5cGUuRlVOQ1RJT04pO1xuXG4gICAgICAgIG5ldyBSdWxlKHRoaXMubWFpblN0YWNrLCB0YXNrTmFtZSArIFwiLXNjaGVkdWxlclwiLCB7XG4gICAgICAgICAgICBzY2hlZHVsZTogU2NoZWR1bGUuZXhwcmVzc2lvbih0YXNrQ29uZmlnLnNjaGVkdWxlKSxcbiAgICAgICAgICAgIHRhcmdldHM6IFtcbiAgICAgICAgICAgICAgICBuZXcgYXdzX2V2ZW50c190YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRhc2spLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG5cbiAgICB9XG59XG4iXX0=