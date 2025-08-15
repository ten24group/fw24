import { Stack } from "aws-cdk-lib";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { IConstructConfig } from "../interfaces/construct-config";
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
export declare class SchedulerConstruct implements FW24Construct {
    private schedulerConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    constructor(schedulerConstructConfig: ISchedulerConstructConfig);
    construct(): Promise<void>;
    private registerTask;
}
