import { CfnOutput, Stack, aws_events_targets } from "aws-cdk-lib";
import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";

import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { LogDuration, createLogger } from "../logging";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LambdaFunction } from "./lambda-function";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { IConstructConfig } from "../interfaces/construct-config";
import { VpcConstruct } from "./vpc";

/**
 * Represents the configuration for the Scheduler construct.
 */
export interface ISchedulerConstructConfig extends IConstructConfig {
    /**
     * The directory where the tasks are located.
     */
    tasksDirectory?: string;

    /**
     * The environment configuration for the Lambda functions.
     */
    env?: ILambdaEnvConfig[];

    /**
     * The function properties for the Node.js functions.
     */
    functionProps?: NodejsFunctionProps;
}

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
export class SchedulerConstruct implements FW24Construct {
    readonly logger = createLogger(SchedulerConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = SchedulerConstruct.name;
    dependencies: string[] = [VpcConstruct.name];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private schedulerConstructConfig: ISchedulerConstructConfig) {
        Helper.hydrateConfig(schedulerConstructConfig,'SCHEDULER');
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack(this.schedulerConstructConfig.stackName, this.schedulerConstructConfig.parentStackName);
        // sets the default tasks directory if not defined
        if(this.schedulerConstructConfig.tasksDirectory === undefined || this.schedulerConstructConfig.tasksDirectory === ""){
            this.schedulerConstructConfig.tasksDirectory = "./src/tasks";
        }

        // register the tasks
        await Helper.registerHandlers(this.schedulerConstructConfig.tasksDirectory, this.registerTask);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                const tasksDirectory = module.getTasksDirectory();
                if(tasksDirectory != ''){
                    this.logger.info("Load tasks from module base-path: ", basePath);
                    await Helper.registerTasksFromModule(module, this.registerTask);
                }
            }
        }

    }

    private registerTask= (taskInfo: HandlerDescriptor) => {
        taskInfo.handlerInstance = new taskInfo.handlerClass();
        this.logger.debug("Task instance: ", taskInfo.handlerInstance);
        
        const taskName = taskInfo.handlerInstance.taskName;
        const taskConfig = taskInfo.handlerInstance.taskConfig || {};
        const taskProps = {...this.schedulerConstructConfig.functionProps, ...taskConfig.functionProps};
        const taskConfigEnv = [...(this.schedulerConstructConfig.env ?? []),...taskConfig.env ?? []];

        this.logger.info(`Registering task ${taskName} from ${taskInfo.filePath}/${taskInfo.fileName}`);

        const task = new LambdaFunction(this.mainStack, taskName + "-task", {
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
        }) as NodejsFunction;

        this.fw24.setConstructOutput(this, taskName, task, OutputType.FUNCTION);

        new Rule(this.mainStack, taskName + "-scheduler", {
            schedule: Schedule.expression(taskConfig.schedule),
            targets: [
                new aws_events_targets.LambdaFunction(task),
            ],
        });

    }
}
