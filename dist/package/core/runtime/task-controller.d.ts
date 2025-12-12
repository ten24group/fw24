import { Context, ScheduledEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { ITaskConfig } from '../../decorators/task';
import { ExecutionContextData } from './execution-context';
/**
 * Task execution context - contains task-specific data AND execution context.
 */
export interface TaskExecutionContext {
    /** The scheduled event (if available) */
    readonly event?: ScheduledEvent;
    /** Lambda context (if available) */
    readonly lambdaContext?: Context;
    /** Execution context (also available via getCurrentExecutionContext()) */
    readonly executionContext: ExecutionContextData;
}
/**
 * Base class for handling Schedule Tasks.
 *
 * All handler execution is wrapped in execution context.
 * Configure observability via the @Task decorator:
 *
 * @example
 * ```typescript
 * @Task('my-task', {
 *   schedule: 'rate(1 minute)',
 *   observability: {
 *     source: 'domain:task-type',
 *     tags: { domain: 'sports', frequency: 'frequent' }
 *   }
 * })
 * export class MyTask extends TaskController { }
 * ```
 */
declare abstract class TaskController extends AbstractLambdaHandler {
    protected initialize(): Promise<void>;
    /**
     * Process the scheduled task.
     * @param ctx - Task execution context
     */
    abstract process(ctx?: TaskExecutionContext): Promise<void>;
    protected getTaskConfig(): ITaskConfig;
    protected getTaskName(): string | undefined;
    LambdaHandler(_event?: ScheduledEvent, context?: Context): Promise<void>;
}
export { TaskController };
