import { Context, ScheduledEvent } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { ITaskConfig } from '../../decorators/task';
import { SpanObserver, generateTraceId } from '../../observability';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
} from './execution-context';
import { Actor } from '../types/execution-context';

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

    // Create service actor for task - enables actor context injection in entity services
    const taskActor: Actor = {
      actorType: 'service',
      authMethod: 'system',
      actorId: `task:${taskName}`,
      requestId: context?.awsRequestId || correlationId,
      timestamp: new Date().toISOString(),
      correlationId,  // Task is the root trigger, so use its own correlationId
    };

    // Create execution context with custom source and tags from decorator
    const execCtx = createExecutionContext({
      correlationId,
      actor: taskActor,
      source: obsConfig.source || `task:${taskName}`,
      tags: {
        ...automaticTags,
        ...obsConfig.tags, // Decorator tags override automatic
      },
    });

    // Build task execution context
    const ctx: TaskExecutionContext = {
      event: _event,
      lambdaContext: context,
      executionContext: execCtx,
    };

    // Run handler within execution context
    return runWithExecutionContext(execCtx, async () => {
      // Use the base class helper for span + flush pattern
      return this.executeWithSpanAndFlush(
        `Task ${taskName}`,
        async (taskSpan) => {
          const startTime = Date.now();
          try {
            await this.initialize();
            await this.process(ctx);
            const duration = Date.now() - startTime;
            taskSpan.metrics({
              'task.duration_ms': duration,
            });
            // Flush happens automatically in executeWithSpanAndFlush's finally block
          } catch (error) {
            const duration = Date.now() - startTime;
            taskSpan.metrics({
              'task.duration_ms': duration,
              'task.errors': 1,
            });
            // Flush happens automatically in executeWithSpanAndFlush's finally block
            throw error;
          }
        },
        {
          correlationId,
          actor: taskActor,
          source: obsConfig.source || `task:${taskName}`,
          tags: {
            ...automaticTags,
            ...obsConfig.tags,
            'task.name': taskName,
            'task.schedule': taskConfig.schedule || '',
          },
        }
      );
    });
  }
}

export { TaskController };
