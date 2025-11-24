import { randomUUID } from 'crypto';
import { ObservabilityManager } from './manager';

export class WorkflowRun {
  private readonly workflowId: string;
  private readonly traceId: string;
  private readonly workflowName: string;

  constructor(workflowName: string, traceId = randomUUID()) {
    this.workflowId = randomUUID();
    this.traceId = traceId;
    this.workflowName = workflowName;

    void ObservabilityManager.capture({
      type: 'workflow.start',
      level: 'info',
      correlationId: this.traceId,
      entityName: 'workflow',
      entityId: this.workflowId,
      timestampMs: Date.now(),
      operation: workflowName,
    });
  }

  async recordStep<T>(stepName: string, fn: () => Promise<T>) {
    const stepId = randomUUID();
    const start = Date.now();
    void ObservabilityManager.capture({
      type: 'workflow.step',
      level: 'info',
      correlationId: this.traceId,
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      timestampMs: start,
      operation: stepName,
      status: 'started',
    });

    try {
      const result = await fn();
      void ObservabilityManager.capture({
        type: 'workflow.step',
        level: 'info',
        correlationId: this.traceId,
        parentLogId: this.workflowId,
        entityName: 'workflow',
        entityId: this.workflowId,
        timestampMs: Date.now(),
        operation: stepName,
        status: 'completed',
        success: true,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      void ObservabilityManager.capture({
        type: 'workflow.step',
        level: 'error',
        correlationId: this.traceId,
        parentLogId: this.workflowId,
        entityName: 'workflow',
        entityId: this.workflowId,
        timestampMs: Date.now(),
        operation: stepName,
        status: 'failed',
        success: false,
        durationMs: Date.now() - start,
        error: {
          type: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      });
      throw error;
    }
  }

  end(): void {
    void ObservabilityManager.capture({
      type: 'workflow.end',
      level: 'info',
      correlationId: this.traceId,
      entityName: 'workflow',
      entityId: this.workflowId,
      timestampMs: Date.now(),
      operation: this.workflowName,
      status: 'completed',
      success: true,
    });
  }
}

