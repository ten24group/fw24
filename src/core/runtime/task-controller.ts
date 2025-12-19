import { Context, ScheduledEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { ITaskConfig } from '../../decorators/task';
import { SpanObserver, generateTraceId } from '../../observability';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
  setParentObservabilityLogId,
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
    this.initializeEntryPackagesAndObservability();

    const taskName = this.getTaskName() || this.constructor.name;
    const taskConfig = this.getTaskConfig();
    const obsConfig = taskConfig.observability || {};
    // Use W3C Trace ID format for consistency with observability system
    const correlationId = context?.awsRequestId || generateTraceId();

    // Build automatic tags for consistent observability
    const automaticTags: Record<string, string> = {
      handler_type: 'task',
      task_name: taskName,
    };
    if (taskConfig.schedule) {
      automaticTags.schedule = taskConfig.schedule;
    }

    // Create execution context with custom source and tags from decorator
    const execCtx = createExecutionContext({
      correlationId,
      source: obsConfig.source || `task:${taskName}`,
      tags: {
        ...automaticTags,
        ...obsConfig.tags, // Decorator tags override automatic
      },
    });

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Create span with merged tags (consistent with API Gateway)
      const taskSpan = SpanObserver.start(`Task ${taskName}`, {
        correlationId,
        source: obsConfig.source || `task:${taskName}`,
        tags: {
          ...automaticTags,
          ...obsConfig.tags, // Decorator tags override automatic
        },
        attributes: {
          'task.name': taskName,
          'task.schedule': taskConfig.schedule,
          ...obsConfig.attributes,
        },
      });

      // Store span ID in execution context for child spans
      setParentObservabilityLogId(taskSpan.id);

      // Build task execution context
      const ctx: TaskExecutionContext = {
        event: _event,
        lambdaContext: context,
        executionContext: execCtx,
      };

      let spanEnded = false;
      const endSpan = async (success: boolean, error?: Error, metrics?: Record<string, number>): Promise<void> => {
        if (!spanEnded) {
          taskSpan.end({ success, error, metrics });
          spanEnded = true;
        }
        await this.flushObservability();
      };

      const startTime = Date.now();
      try {
        await this.initialize();
        await this.process(ctx);
        const duration = Date.now() - startTime;
        await endSpan(true, undefined, { 'task.duration_ms': duration });
      } catch (error) {
        const duration = Date.now() - startTime;
        await endSpan(false, error as Error, {
          'task.duration_ms': duration,
          'task.errors': 1,
        });
        throw error;
      }
    });
  }
}

export { TaskController };
