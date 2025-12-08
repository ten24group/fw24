import { Context, ScheduledEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { ITaskConfig } from '../../decorators/task';
import { SpanObserver } from '../../observability';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
} from './execution-context';

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
 */
abstract class TaskController extends AbstractLambdaHandler {

  protected initialize(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Process the scheduled task.
   * @param ctx - Task execution context
   */
  abstract process(ctx?: TaskExecutionContext): Promise<void>;

  protected getTaskConfig(): ITaskConfig {
    return (Reflect.get(this, 'taskConfig') as ITaskConfig) || { schedule: '' };
  }

  protected getTaskName(): string | undefined {
    return Reflect.get(this, 'taskName') as string | undefined;
  }

  async LambdaHandler(_event?: ScheduledEvent, context?: Context): Promise<void> {
    this.initializeObservability();
    
    const taskName = this.getTaskName() || this.constructor.name;
    const correlationId = context?.awsRequestId || `task-${taskName}-${Date.now()}`;

    // Create execution context
    const execCtx = createExecutionContext({
      correlationId,
      source: `${this.constructor.name}.process`,
    });

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Create span
      const taskSpan = SpanObserver.start(`Task ${taskName}`, {
        correlationId,
        attributes: {
          'task.name': taskName,
          'task.schedule': this.getTaskConfig().schedule,
        },
      });

      // Store span ID in execution context for child spans
      execCtx.parentLogId = taskSpan.id;

      // Build task execution context
      const ctx: TaskExecutionContext = {
        event: _event,
        lambdaContext: context,
        executionContext: execCtx,
      };

      let spanEnded = false;
      const endSpan = async (success: boolean, error?: Error): Promise<void> => {
        if (!spanEnded) {
          taskSpan.end({ success, error });
          spanEnded = true;
        }
        await this.flushObservability();
      };

      try {
        await this.initialize();
        await this.process(ctx);
        await endSpan(true);
      } catch (error) {
        await endSpan(false, error as Error);
        throw error;
      }
    });
  }
}

export { TaskController };
