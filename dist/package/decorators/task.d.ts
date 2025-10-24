import 'reflect-metadata';
import type { ILambdaEnvConfig } from "../interfaces";
import type { CommonLambdaHandlerOptions } from "./decorator-utils";
/**
 * Represents the configuration for a task.
 */
export type ITaskConfig = CommonLambdaHandlerOptions & {
    /**
     * The schedule for the task.
     */
    schedule: string;
    /**
     * The environment configuration for the task.
     */
    env?: Array<ILambdaEnvConfig>;
};
/**
 * Decorator function to define a scheduled task.
 * @param taskName - The name of the task.
 * @param taskConfig - Optional configuration for the task.
 * @returns A class decorator function.
 */
export declare function Task(taskName: string, taskConfig: ITaskConfig): <T extends {
    new (...args: any[]): {};
}>(target: T) => {
    new (...args: any[]): {};
} & T;
