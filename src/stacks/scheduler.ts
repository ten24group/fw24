import { CfnOutput, Stack, aws_events_targets } from "aws-cdk-lib";
import { Helper } from "../core/helper";
import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";

import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { LogDuration, createLogger } from "../logging";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { LambdaFunction } from "../constructs/lambda-function";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";

export interface ISchedulerConfig {
    tasksDirectory?: string;
    env?: ILambdaEnvConfig[];
    functionProps?: NodejsFunctionProps;
}

export class SchedulerStack implements IStack {
    readonly logger = createLogger(SchedulerStack.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    dependencies: string[] = [];
    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: ISchedulerConfig) {
        this.logger.debug("constructor", stackConfig);
        Helper.hydrateConfig(stackConfig,'Scheduler');
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack("main");
        // sets the default tasks directory if not defined
        if(this.stackConfig.tasksDirectory === undefined || this.stackConfig.tasksDirectory === ""){
            this.stackConfig.tasksDirectory = "./src/tasks";
        }

        // register the tasks
        await Helper.registerHandlers(this.stackConfig.tasksDirectory, this.registerTask);

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
        const taskProps = {...this.stackConfig.functionProps, ...taskConfig.functionProps};
        const taskConfigEnv = [...(this.stackConfig.env ?? []),...taskConfig.env ?? []];

        this.logger.info(`Registering task ${taskName} from ${taskInfo.filePath}/${taskInfo.fileName}`);

        const task = new LambdaFunction(this.mainStack, taskName + "-task", {
            entry: taskInfo.filePath + "/" + taskInfo.fileName,
            environmentVariables: this.getEnvironmentVariables(taskConfigEnv),
            allowSendEmail: true,
            functionProps: {
                ...taskProps,
            },
            resourceAccess: taskConfig.resourceAccess,
        }) as NodejsFunction;


        new Rule(this.mainStack, taskName + "-scheduler", {
            schedule: Schedule.expression(taskConfig.schedule),
            targets: [
                new aws_events_targets.LambdaFunction(task),
            ],
        });

    }
}
