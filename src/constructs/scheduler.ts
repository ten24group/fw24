import { CfnOutput, Stack, aws_events_targets } from "aws-cdk-lib";
import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutout, OutputType } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";

import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { LogDuration, createLogger } from "../logging";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LambdaFunction } from "./lambda-function";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";

export interface ISchedulerConstructConfig {
    tasksDirectory?: string;
    env?: ILambdaEnvConfig[];
    functionProps?: NodejsFunctionProps;
}

export class SchedulerConstruct implements FW24Construct {
    readonly logger = createLogger(SchedulerConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = SchedulerConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutout;

    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private schedulerConstructConfig: ISchedulerConstructConfig) {
        Helper.hydrateConfig(schedulerConstructConfig,'SCHEDULER');
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack("main");
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

    private getEnvironmentVariables(config: ILambdaEnvConfig[]): any {
        const env: any = {};
        for (const envConfig of config || []) {
            const value = this.fw24.get(envConfig.name, envConfig.prefix || '');
            if (value) {
                env[envConfig.name] = value;
            }
        }
        return env;
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
            environmentVariables: this.getEnvironmentVariables(taskConfigEnv),
            allowSendEmail: true,
            functionTimeout: taskConfig.functionTimeout,
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
