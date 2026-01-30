import type { ILambdaEnvConfig } from "../interfaces";
import type { CommonLambdaHandlerOptions } from "./decorator-utils";
import type { SpanMetadata } from "../observability/controller-config";
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
    /**
     * Observability configuration for the task.
     * Allows specifying custom tags, source, and attributes for spans.
     *
     * @example
     * ```typescript
     * @Task('sports-poll', {
     *   schedule: 'rate(1 minute)',
     *   observability: {
     *     source: 'sports:scheduler:frequent',
     *     tags: { domain: 'sports', frequency: 'frequent' },
     *     attributes: { 'task.category': 'data-sync' }
     *   }
     * })
     * ```
     */
    observability?: SpanMetadata;
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
