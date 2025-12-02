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
    step<T>(stepName: string, fn: () => Promise<T>, options: StepOptions & {
        continueOnError: true;
    }): Promise<T | undefined>;
    step<T>(stepName: string, fn: () => Promise<T>, options?: StepOptions & {
        continueOnError?: false;
    }): Promise<T>;
    checkpoint(name: string, state?: unknown): string | undefined;
    decision(decisionName: string, result: unknown, options?: {
        reasoning?: string;
        rules?: unknown[];
    }): string | undefined;
    pause(reason: string, resumeData?: unknown): string | undefined;
    resume(resumeInput?: unknown): string | undefined;
    event(name: string, data?: Record<string, unknown>): string | undefined;
    complete(options?: {
        result?: unknown;
        metadata?: Record<string, unknown>;
    }): string | undefined;
    fail(error: Error, options?: {
        metadata?: Record<string, unknown>;
    }): string | undefined;
    cancel(reason?: string): string | undefined;
}
export declare class WorkflowObserver implements IWorkflowObserver {
    private readonly workflowId;
    private readonly correlationId;
    private readonly workflowName;
    private readonly startTime;
    private readonly entityName?;
    private readonly entityId?;
    private readonly actor?;
    private readonly tags?;
    private readonly fields;
    private stepCount;
    private status;
    private constructor();
    /**
     * Start a new workflow
     * @returns WorkflowObserver instance, or NoOp workflow if correlationId not available
     */
    static start(workflowName: string, options?: WorkflowOptions): IWorkflowObserver;
    get id(): string;
    get traceId(): string;
    get name(): string;
    get currentStatus(): WorkflowStatus;
    /**
     * Execute and record a workflow step
     *
     * @overload When continueOnError is true, returns T | undefined on error
     * @overload When continueOnError is false/undefined, throws on error and returns T
     */
    step<T>(stepName: string, fn: () => Promise<T>, options: StepOptions & {
        continueOnError: true;
    }): Promise<T | undefined>;
    step<T>(stepName: string, fn: () => Promise<T>, options?: StepOptions & {
        continueOnError?: false;
    }): Promise<T>;
    /**
     * Record a checkpoint (save point for resumption)
     */
    checkpoint(name: string, state?: unknown): string | undefined;
    /**
     * Record decision point in workflow
     */
    decision(decisionName: string, result: unknown, options?: {
        reasoning?: string;
        rules?: unknown[];
    }): string | undefined;
    /**
     * Pause workflow (e.g., waiting for external input)
     */
    pause(reason: string, resumeData?: unknown): string | undefined;
    /**
     * Resume workflow from pause
     */
    resume(resumeInput?: unknown): string | undefined;
    /**
     * Record an event in the workflow
     */
    event(name: string, data?: Record<string, unknown>): string | undefined;
    /**
     * Complete workflow successfully
     */
    complete(options?: {
        result?: unknown;
        metadata?: Record<string, unknown>;
    }): string | undefined;
    /**
     * Mark workflow as failed
     */
    fail(error: Error, options?: {
        metadata?: Record<string, unknown>;
    }): string | undefined;
    /**
     * Cancel workflow
     */
    cancel(reason?: string): string | undefined;
}
export {};
