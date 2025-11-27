/**
 * WorkflowObserver - For long-running and distributed workflows
 * 
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit
 * - Tracks workflow lifecycle (start, steps, end)
 * - Supports checkpoints, decisions, pause/resume
 * - Uses capturer pattern for testability
 * - Returns logId from methods for tracking
 * 
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId, { actor }),
 *   async () => {
 *     const workflow = WorkflowObserver.start('order-fulfillment', {
 *       entityName: 'Order',
 *       entityId: orderId,
 *     });
 *     
 *     await workflow.step('validate', async () => {
 *       // validation logic
 *     });
 *     
 *     await workflow.step('payment', async () => {
 *       // payment logic
 *     });
 *     
 *     workflow.complete({ result: 'fulfilled' });
 *   }
 * );
 * ```
 */

import { Actor } from '../../core/types/execution-context';
import {
  buildCommonFields,
  captureEvent,
  generateId,
  mapError,
  normalizeError,
  mergeObserverTags,
  CommonFields,
} from './base';
import { createLogger } from '../../logging';

const logger = createLogger('WorkflowObserver');
const OBSERVER_NAME = 'WorkflowObserver';

export interface WorkflowOptions {
  /** Correlation ID - if not provided, must come from context */
  correlationId?: string;
  /** Target entity type */
  entityName?: string;
  /** Target entity ID */
  entityId?: string;
  /** Actor performing the workflow */
  actor?: Actor;
  /** Tags for filtering */
  tags?: Record<string, string>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface StepOptions {
  /** Input data for the step */
  input?: unknown;
  /** Whether to capture output in logs (may contain sensitive data) */
  captureOutput?: boolean;
  /** Continue workflow even if step fails */
  continueOnError?: boolean;
}

type WorkflowStatus = 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';

/**
 * Interface for workflow operations (allows NoOp implementation)
 */
export interface IWorkflowObserver {
  readonly id: string;
  readonly traceId: string;
  readonly name: string;
  readonly currentStatus: WorkflowStatus;
  step<T>(stepName: string, fn: () => Promise<T>, options: StepOptions & { continueOnError: true }): Promise<T | undefined>;
  step<T>(stepName: string, fn: () => Promise<T>, options?: StepOptions & { continueOnError?: false }): Promise<T>;
  checkpoint(name: string, state?: unknown): string | undefined;
  decision(decisionName: string, result: unknown, options?: { reasoning?: string; rules?: unknown[] }): string | undefined;
  pause(reason: string, resumeData?: unknown): string | undefined;
  resume(resumeInput?: unknown): string | undefined;
  event(name: string, data?: Record<string, unknown>): string | undefined;
  complete(options?: { result?: unknown; metadata?: Record<string, unknown> }): string | undefined;
  fail(error: Error, options?: { metadata?: Record<string, unknown> }): string | undefined;
  cancel(reason?: string): string | undefined;
}

export class WorkflowObserver implements IWorkflowObserver {
  private readonly workflowId: string;
  private readonly correlationId: string;
  private readonly workflowName: string;
  private readonly startTime: number;
  private readonly entityName?: string;
  private readonly entityId?: string;
  private readonly actor?: Actor;
  private readonly tags?: Record<string, string>;
  private readonly fields: CommonFields;
  private stepCount = 0;
  private status: WorkflowStatus = 'running';

  private constructor(workflowName: string, fields: CommonFields, options?: WorkflowOptions) {
    this.workflowId = generateId();
    this.correlationId = fields.correlationId;
    this.workflowName = workflowName;
    this.entityName = options?.entityName;
    this.entityId = options?.entityId;
    this.actor = options?.actor ?? fields.actor;
    this.tags = mergeObserverTags(fields.tags, options?.tags);
    this.startTime = Date.now();
    this.fields = fields;

    captureEvent(fields, {
      type: 'workflow.start',
      level: 'info',
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: workflowName,
      status: 'started',
      data: {
        workflowName,
        targetEntityName: this.entityName,
        targetEntityId: this.entityId,
        metadata: options?.metadata,
      },
      actor: this.actor,
      tags: { ...this.tags, workflow: workflowName },
      timestampMs: this.startTime,
    });
  }

  /**
   * Start a new workflow
   * @returns WorkflowObserver instance, or NoOp workflow if correlationId not available
   */
  static start(workflowName: string, options?: WorkflowOptions): IWorkflowObserver {
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options?.correlationId,
      actor: options?.actor,
      tags: options?.tags,
      metadata: options?.metadata,
    });

    if (!fields) {
      // Return a no-op workflow that won't crash but won't record anything
      return new NoOpWorkflowObserver(workflowName);
    }

    return new WorkflowObserver(workflowName, fields, options);
  }

  // === Getters ===
  get id(): string {
    return this.workflowId;
  }

  get traceId(): string {
    return this.correlationId;
  }

  get name(): string {
    return this.workflowName;
  }

  get currentStatus(): WorkflowStatus {
    return this.status;
  }

  /**
   * Execute and record a workflow step
   * 
   * @overload When continueOnError is true, returns T | undefined on error
   * @overload When continueOnError is false/undefined, throws on error and returns T
   */
  async step<T>(
    stepName: string,
    fn: () => Promise<T>,
    options: StepOptions & { continueOnError: true }
  ): Promise<T | undefined>;
  async step<T>(
    stepName: string,
    fn: () => Promise<T>,
    options?: StepOptions & { continueOnError?: false }
  ): Promise<T>;
  async step<T>(
    stepName: string,
    fn: () => Promise<T>,
    options?: StepOptions
  ): Promise<T | undefined> {
    this.stepCount++;
    const stepId = generateId();
    const stepStart = Date.now();

    // Emit step start event (subType: 'execute' for consistency)
    captureEvent(this.fields, {
      type: 'workflow.step',
      subType: 'execute',
      level: 'info',
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: stepName,
      status: 'started',
      data: {
        stepId,
        stepNumber: this.stepCount,
        input: options?.input,
      },
      tags: { ...this.tags, workflow: this.workflowName, step: stepName },
      timestampMs: stepStart,
    });

    try {
      const result = await fn();
      const stepEnd = Date.now();

      // Emit step complete - use START time as timestampMs for correct time-series ordering
      captureEvent(this.fields, {
        type: 'workflow.step',
        subType: 'execute',
        level: 'info',
        parentLogId: this.workflowId,
        entityName: 'workflow',
        entityId: this.workflowId,
        operation: stepName,
        status: 'completed',
        success: true,
        durationMs: stepEnd - stepStart,
        data: {
          stepId,
          stepNumber: this.stepCount,
          output: options?.captureOutput ? result : undefined,
          startedAt: stepStart,
          completedAt: stepEnd,
        },
        tags: { ...this.tags, workflow: this.workflowName, step: stepName },
        metrics: { stepDuration: stepEnd - stepStart },
        timestampMs: stepStart, // Use START time for correct ordering
      });

      return result;
    } catch (error) {
      const normalizedError = normalizeError(error);
      const stepEnd = Date.now();

      // Emit step failed - use START time as timestampMs for correct time-series ordering
      captureEvent(this.fields, {
        type: 'workflow.step',
        subType: 'execute',
        level: 'error',
        parentLogId: this.workflowId,
        entityName: 'workflow',
        entityId: this.workflowId,
        operation: stepName,
        status: 'failed',
        success: false,
        durationMs: stepEnd - stepStart,
        data: {
          stepId,
          stepNumber: this.stepCount,
          startedAt: stepStart,
          failedAt: stepEnd,
        },
        error: mapError(normalizedError),
        tags: { ...this.tags, workflow: this.workflowName, step: stepName },
        metrics: { stepDuration: stepEnd - stepStart },
        timestampMs: stepStart, // Use START time for correct ordering
      });

      if (!options?.continueOnError) {
        this.status = 'failed';
        throw error;
      }

      return undefined;
    }
  }

  /**
   * Record a checkpoint (save point for resumption)
   */
  checkpoint(name: string, state?: unknown): string | undefined {
    return captureEvent(this.fields, {
      type: 'workflow.step',
      subType: 'checkpoint',
      level: 'info',
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: name,
      status: 'checkpoint',
      data: { checkpoint: name, state },
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Record decision point in workflow
   */
  decision(
    decisionName: string,
    result: unknown,
    options?: { reasoning?: string; rules?: unknown[] }
  ): string | undefined {
    return captureEvent(this.fields, {
      type: 'workflow.step',
      subType: 'decision',
      level: 'info',
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: decisionName,
      status: 'completed',
      data: {
        decision: result,
        reasoning: options?.reasoning,
        rules: options?.rules,
      },
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Pause workflow (e.g., waiting for external input)
   */
  pause(reason: string, resumeData?: unknown): string | undefined {
    this.status = 'paused';
    return captureEvent(this.fields, {
      type: 'workflow.step',
      subType: 'pause',
      level: 'info',
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: 'pause',
      status: 'paused',
      data: { reason, resumeData },
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Resume workflow from pause
   */
  resume(resumeInput?: unknown): string | undefined {
    this.status = 'running';
    return captureEvent(this.fields, {
      type: 'workflow.step',
      subType: 'resume',
      level: 'info',
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: 'resume',
      status: 'running',
      data: { resumeInput },
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Record an event in the workflow
   */
  event(name: string, data?: Record<string, unknown>): string | undefined {
    return captureEvent(this.fields, {
      type: 'workflow.step',
      subType: 'event',
      level: 'info',
      parentLogId: this.workflowId,
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: name,
      data,
      tags: { ...this.tags, workflow: this.workflowName },
      timestampMs: Date.now(),
    });
  }

  /**
   * Complete workflow successfully
   */
  complete(options?: { result?: unknown; metadata?: Record<string, unknown> }): string | undefined {
    this.status = 'completed';
    const duration = Date.now() - this.startTime;

    return captureEvent(this.fields, {
      type: 'workflow.end',
      level: 'info',
      parentLogId: this.workflowId, // Link end event to workflow start
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: this.workflowName,
      status: 'completed',
      success: true,
      durationMs: duration,
      data: {
        result: options?.result,
        stepCount: this.stepCount,
      },
      metadata: options?.metadata,
      actor: this.actor,
      tags: { ...this.tags, workflow: this.workflowName },
      metrics: { duration, stepCount: this.stepCount },
      timestampMs: Date.now(),
    });
  }

  /**
   * Mark workflow as failed
   */
  fail(error: Error, options?: { metadata?: Record<string, unknown> }): string | undefined {
    this.status = 'failed';
    const duration = Date.now() - this.startTime;

    return captureEvent(this.fields, {
      type: 'workflow.end',
      level: 'error',
      parentLogId: this.workflowId, // Link end event to workflow start
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: this.workflowName,
      status: 'failed',
      success: false,
      durationMs: duration,
      data: { stepCount: this.stepCount },
      error: mapError(error),
      metadata: options?.metadata,
      actor: this.actor,
      tags: { ...this.tags, workflow: this.workflowName },
      metrics: { duration, stepCount: this.stepCount },
      timestampMs: Date.now(),
    });
  }

  /**
   * Cancel workflow
   */
  cancel(reason?: string): string | undefined {
    this.status = 'cancelled';
    const duration = Date.now() - this.startTime;

    return captureEvent(this.fields, {
      type: 'workflow.end',
      level: 'warn',
      parentLogId: this.workflowId, // Link end event to workflow start
      entityName: 'workflow',
      entityId: this.workflowId,
      operation: this.workflowName,
      status: 'cancelled',
      success: false,
      durationMs: duration,
      data: { reason, stepCount: this.stepCount },
      actor: this.actor,
      tags: { ...this.tags, workflow: this.workflowName },
      metrics: { duration, stepCount: this.stepCount },
      timestampMs: Date.now(),
    });
  }
}

/**
 * No-op workflow for when correlationId is not available
 * Implements IWorkflowObserver interface properly (no type casts)
 * 
 * Tracks status to maintain consistent behavior with real WorkflowObserver
 */
class NoOpWorkflowObserver implements IWorkflowObserver {
  private readonly workflowName: string;
  private status: WorkflowStatus = 'running';

  constructor(workflowName: string) {
    this.workflowName = workflowName;
    logger.warn(`NoOp workflow created for: ${workflowName}`);
  }

  get id(): string {
    return 'noop';
  }

  get traceId(): string {
    return 'noop';
  }

  get name(): string {
    return this.workflowName;
  }

  get currentStatus(): WorkflowStatus {
    return this.status;
  }

  async step<T>(
    _stepName: string,
    fn: () => Promise<T>,
    _options: StepOptions & { continueOnError: true }
  ): Promise<T | undefined>;
  async step<T>(
    _stepName: string,
    fn: () => Promise<T>,
    _options?: StepOptions & { continueOnError?: false }
  ): Promise<T>;
  async step<T>(_stepName: string, fn: () => Promise<T>, options?: StepOptions): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      if (options?.continueOnError) {
        return undefined;
      }
      this.status = 'failed';
      throw error;
    }
  }

  checkpoint(_name: string, _state?: unknown): string | undefined {
    return undefined;
  }

  decision(_decisionName: string, _result: unknown, _options?: { reasoning?: string; rules?: unknown[] }): string | undefined {
    return undefined;
  }

  pause(_reason: string, _resumeData?: unknown): string | undefined {
    this.status = 'paused';
    return undefined;
  }

  resume(_resumeInput?: unknown): string | undefined {
    this.status = 'running';
    return undefined;
  }

  event(_name: string, _data?: Record<string, unknown>): string | undefined {
    return undefined;
  }

  complete(_options?: { result?: unknown; metadata?: Record<string, unknown> }): string | undefined {
    this.status = 'completed';
    return undefined;
  }

  fail(_error: Error, _options?: { metadata?: Record<string, unknown> }): string | undefined {
    this.status = 'failed';
    return undefined;
  }

  cancel(_reason?: string): string | undefined {
    this.status = 'cancelled';
    return undefined;
  }
}
