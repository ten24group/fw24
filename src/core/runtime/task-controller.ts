import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { AuditContext, TaskAuditContext } from '../../audit/interfaces';
import { AuditCaptureService } from '../../audit/helpers/audit-helpers';
import { ITaskConfig } from '../../decorators/task';
import { ObservabilityManager, Span } from '../../observability';

/**
 * Base class for handling Schedule Tasks.
 */
abstract class TaskController extends AbstractLambdaHandler {

  protected initialize(): Promise<any> {
    return Promise.resolve();
  }

  abstract process(): Promise<any>;

  /**
   * Creates audit context for the task execution following the existing pattern
   * @returns AuditContext or null if audit is disabled
   */
  protected makeAuditContext(): AuditContext | null {
    const config = this.getTaskConfig();
    if (!config?.audit?.enabled) return null;

    const operationName = this.getTaskName() || 'execute';
    const operationId = `${this.constructor.name}.${operationName}`;
    const correlationId = `${operationId}-${Date.now()}`;

    return {
      enabled: true,
      logType: 'event',
      subType: 'task_execution',
      entityName: this.constructor.name,
      operation: operationName,
      category: config.audit.category,
      actor: {
        actorType: 'service',
        actorId: 'scheduler',
        authMethod: 'system',
        requestId: correlationId,
        timestamp: new Date().toISOString()
      },
      correlation: {
        correlationId,
        operationId,
        parentOperationId: undefined, // Tasks typically don't have parents
        operationType: 'task',
        operationName,
        startTimestamp: new Date().toISOString()
      },
      auditConfig: config.audit
    };
  }

  /**
   * Captures audit log for task execution start
   */
  protected async captureStart(auditContext: AuditContext, taskContext: TaskAuditContext): Promise<void> {
    await AuditCaptureService.captureStart(auditContext, taskContext);
  }

  /**
   * Captures audit log for task execution end (success or error)
   */
  protected async captureEnd(auditContext: AuditContext, _result: any, error: Error | null): Promise<void> {
    await AuditCaptureService.captureEnd(auditContext, _result, error);
  }

  /**
   * Gets the task configuration
   */
  protected getTaskConfig(): ITaskConfig {
    return (Reflect.get(this, 'taskConfig') as ITaskConfig) || { schedule: '' };
  }

  /**
   * Gets the task name
   */
  protected getTaskName(): string | undefined {
    return Reflect.get(this, 'taskName') as string | undefined;
  }

  /**
   * Lambda handler for the task.
   */
  async LambdaHandler(): Promise<any> {
    ObservabilityManager.initializeInvocation();
    const taskName = this.getTaskName() || this.constructor.name;
    const taskSpan = new Span(`Task ${taskName}`, {
      
    });
    let spanEnded = false;
    const finalizeObservability = async (success: boolean, error?: Error) => {
      if (!spanEnded) {
        await taskSpan.end({ success, error });
        spanEnded = true;
      }
      await ObservabilityManager.flush();
    };

    // Create audit context
    const auditContext = this.makeAuditContext();
    const taskContext: TaskAuditContext = {
      taskName: this.getTaskName(),
      schedule: this.getTaskConfig().schedule,
      triggerSource: 'scheduled',
      environment: process.env.NODE_ENV
    };

    if (auditContext) {
      await this.captureStart(auditContext, taskContext);
    }

    try {
      // hook for the application to initialize it's state, Dependencies, config etc
      await this.initialize();
      // Execute the associated function
      const result = await this.process();

      if (auditContext) {
        await this.captureEnd(auditContext, result, null);
      }

      await finalizeObservability(true);
      return result;
    } catch (error) {
      if (auditContext) {
        await this.captureEnd(auditContext, null, error as Error);
      }
      await finalizeObservability(false, error as Error);
      throw error;
    }
  }
}

export { TaskController };
