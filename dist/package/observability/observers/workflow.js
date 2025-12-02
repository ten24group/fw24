"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowObserver = void 0;
const base_1 = require("./base");
const logging_1 = require("../../logging");
const logger = (0, logging_1.createLogger)('WorkflowObserver');
const OBSERVER_NAME = 'WorkflowObserver';
class WorkflowObserver {
    workflowId;
    correlationId;
    workflowName;
    startTime;
    entityName;
    entityId;
    actor;
    tags;
    fields;
    stepCount = 0;
    status = 'running';
    constructor(workflowName, fields, options) {
        this.workflowId = (0, base_1.generateId)();
        this.correlationId = fields.correlationId;
        this.workflowName = workflowName;
        this.entityName = options?.entityName;
        this.entityId = options?.entityId;
        this.actor = options?.actor ?? fields.actor;
        this.tags = (0, base_1.mergeObserverTags)(fields.tags, options?.tags);
        this.startTime = Date.now();
        this.fields = fields;
        (0, base_1.captureEvent)(fields, {
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
    static start(workflowName, options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
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
    get id() {
        return this.workflowId;
    }
    get traceId() {
        return this.correlationId;
    }
    get name() {
        return this.workflowName;
    }
    get currentStatus() {
        return this.status;
    }
    async step(stepName, fn, options) {
        this.stepCount++;
        const stepId = (0, base_1.generateId)();
        const stepStart = Date.now();
        // Emit step start event (subType: 'execute' for consistency)
        (0, base_1.captureEvent)(this.fields, {
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
            (0, base_1.captureEvent)(this.fields, {
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
        }
        catch (error) {
            const normalizedError = (0, base_1.normalizeError)(error);
            const stepEnd = Date.now();
            // Emit step failed - use START time as timestampMs for correct time-series ordering
            (0, base_1.captureEvent)(this.fields, {
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
                error: (0, base_1.mapError)(normalizedError),
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
    checkpoint(name, state) {
        return (0, base_1.captureEvent)(this.fields, {
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
    decision(decisionName, result, options) {
        return (0, base_1.captureEvent)(this.fields, {
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
    pause(reason, resumeData) {
        this.status = 'paused';
        return (0, base_1.captureEvent)(this.fields, {
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
    resume(resumeInput) {
        this.status = 'running';
        return (0, base_1.captureEvent)(this.fields, {
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
    event(name, data) {
        return (0, base_1.captureEvent)(this.fields, {
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
    complete(options) {
        this.status = 'completed';
        const duration = Date.now() - this.startTime;
        return (0, base_1.captureEvent)(this.fields, {
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
    fail(error, options) {
        this.status = 'failed';
        const duration = Date.now() - this.startTime;
        return (0, base_1.captureEvent)(this.fields, {
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
            error: (0, base_1.mapError)(error),
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
    cancel(reason) {
        this.status = 'cancelled';
        const duration = Date.now() - this.startTime;
        return (0, base_1.captureEvent)(this.fields, {
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
exports.WorkflowObserver = WorkflowObserver;
/**
 * No-op workflow for when correlationId is not available
 * Implements IWorkflowObserver interface properly (no type casts)
 *
 * Tracks status to maintain consistent behavior with real WorkflowObserver
 */
class NoOpWorkflowObserver {
    workflowName;
    status = 'running';
    constructor(workflowName) {
        this.workflowName = workflowName;
        logger.warn(`NoOp workflow created for: ${workflowName}`);
    }
    get id() {
        return 'noop';
    }
    get traceId() {
        return 'noop';
    }
    get name() {
        return this.workflowName;
    }
    get currentStatus() {
        return this.status;
    }
    async step(_stepName, fn, options) {
        try {
            return await fn();
        }
        catch (error) {
            if (options?.continueOnError) {
                return undefined;
            }
            this.status = 'failed';
            throw error;
        }
    }
    checkpoint(_name, _state) {
        return undefined;
    }
    decision(_decisionName, _result, _options) {
        return undefined;
    }
    pause(_reason, _resumeData) {
        this.status = 'paused';
        return undefined;
    }
    resume(_resumeInput) {
        this.status = 'running';
        return undefined;
    }
    event(_name, _data) {
        return undefined;
    }
    complete(_options) {
        this.status = 'completed';
        return undefined;
    }
    fail(_error, _options) {
        this.status = 'failed';
        return undefined;
    }
    cancel(_reason) {
        this.status = 'cancelled';
        return undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2Zsb3cuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vYnNlcnZlcnMvd29ya2Zsb3cudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQ0c7OztBQUdILGlDQVFnQjtBQUNoQiwyQ0FBNkM7QUFFN0MsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGtCQUFrQixDQUFDLENBQUM7QUFDaEQsTUFBTSxhQUFhLEdBQUcsa0JBQWtCLENBQUM7QUFnRHpDLE1BQWEsZ0JBQWdCO0lBQ1YsVUFBVSxDQUFTO0lBQ25CLGFBQWEsQ0FBUztJQUN0QixZQUFZLENBQVM7SUFDckIsU0FBUyxDQUFTO0lBQ2xCLFVBQVUsQ0FBVTtJQUNwQixRQUFRLENBQVU7SUFDbEIsS0FBSyxDQUFTO0lBQ2QsSUFBSSxDQUEwQjtJQUM5QixNQUFNLENBQWU7SUFDOUIsU0FBUyxHQUFHLENBQUMsQ0FBQztJQUNkLE1BQU0sR0FBbUIsU0FBUyxDQUFDO0lBRTNDLFlBQW9CLFlBQW9CLEVBQUUsTUFBb0IsRUFBRSxPQUF5QjtRQUN2RixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUEsaUJBQVUsR0FBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxhQUFhLEdBQUcsTUFBTSxDQUFDLGFBQWEsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQztRQUNqQyxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sRUFBRSxVQUFVLENBQUM7UUFDdEMsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLEVBQUUsUUFBUSxDQUFDO1FBQ2xDLElBQUksQ0FBQyxLQUFLLEdBQUcsT0FBTyxFQUFFLEtBQUssSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDO1FBQzVDLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxRCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUM1QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUVyQixJQUFBLG1CQUFZLEVBQUMsTUFBTSxFQUFFO1lBQ25CLElBQUksRUFBRSxnQkFBZ0I7WUFDdEIsS0FBSyxFQUFFLE1BQU07WUFDYixVQUFVLEVBQUUsVUFBVTtZQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDekIsU0FBUyxFQUFFLFlBQVk7WUFDdkIsTUFBTSxFQUFFLFNBQVM7WUFDakIsSUFBSSxFQUFFO2dCQUNKLFlBQVk7Z0JBQ1osZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQ2pDLGNBQWMsRUFBRSxJQUFJLENBQUMsUUFBUTtnQkFDN0IsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRO2FBQzVCO1lBQ0QsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2pCLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFO1lBQzlDLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUztTQUM1QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFvQixFQUFFLE9BQXlCO1FBQzFELE1BQU0sTUFBTSxHQUFHLElBQUEsd0JBQWlCLEVBQUMsYUFBYSxFQUFFO1lBQzlDLGFBQWEsRUFBRSxPQUFPLEVBQUUsYUFBYTtZQUNyQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUs7WUFDckIsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJO1lBQ25CLFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUTtTQUM1QixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixxRUFBcUU7WUFDckUsT0FBTyxJQUFJLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ2hELENBQUM7UUFFRCxPQUFPLElBQUksZ0JBQWdCLENBQUMsWUFBWSxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQztJQUM3RCxDQUFDO0lBRUQsa0JBQWtCO0lBQ2xCLElBQUksRUFBRTtRQUNKLE9BQU8sSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUN6QixDQUFDO0lBRUQsSUFBSSxPQUFPO1FBQ1QsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDO0lBQzVCLENBQUM7SUFFRCxJQUFJLElBQUk7UUFDTixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUM7SUFDM0IsQ0FBQztJQUVELElBQUksYUFBYTtRQUNmLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNyQixDQUFDO0lBa0JELEtBQUssQ0FBQyxJQUFJLENBQ1IsUUFBZ0IsRUFDaEIsRUFBb0IsRUFDcEIsT0FBcUI7UUFFckIsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2pCLE1BQU0sTUFBTSxHQUFHLElBQUEsaUJBQVUsR0FBRSxDQUFDO1FBQzVCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUU3Qiw2REFBNkQ7UUFDN0QsSUFBQSxtQkFBWSxFQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDeEIsSUFBSSxFQUFFLGVBQWU7WUFDckIsT0FBTyxFQUFFLFNBQVM7WUFDbEIsS0FBSyxFQUFFLE1BQU07WUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDNUIsVUFBVSxFQUFFLFVBQVU7WUFDdEIsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQ3pCLFNBQVMsRUFBRSxRQUFRO1lBQ25CLE1BQU0sRUFBRSxTQUFTO1lBQ2pCLElBQUksRUFBRTtnQkFDSixNQUFNO2dCQUNOLFVBQVUsRUFBRSxJQUFJLENBQUMsU0FBUztnQkFDMUIsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO2FBQ3RCO1lBQ0QsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUU7WUFDbkUsV0FBVyxFQUFFLFNBQVM7U0FDdkIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxFQUFFLEVBQUUsQ0FBQztZQUMxQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFFM0Isc0ZBQXNGO1lBQ3RGLElBQUEsbUJBQVksRUFBQyxJQUFJLENBQUMsTUFBTSxFQUFFO2dCQUN4QixJQUFJLEVBQUUsZUFBZTtnQkFDckIsT0FBTyxFQUFFLFNBQVM7Z0JBQ2xCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDNUIsVUFBVSxFQUFFLFVBQVU7Z0JBQ3RCLFFBQVEsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDekIsU0FBUyxFQUFFLFFBQVE7Z0JBQ25CLE1BQU0sRUFBRSxXQUFXO2dCQUNuQixPQUFPLEVBQUUsSUFBSTtnQkFDYixVQUFVLEVBQUUsT0FBTyxHQUFHLFNBQVM7Z0JBQy9CLElBQUksRUFBRTtvQkFDSixNQUFNO29CQUNOLFVBQVUsRUFBRSxJQUFJLENBQUMsU0FBUztvQkFDMUIsTUFBTSxFQUFFLE9BQU8sRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsU0FBUztvQkFDbkQsU0FBUyxFQUFFLFNBQVM7b0JBQ3BCLFdBQVcsRUFBRSxPQUFPO2lCQUNyQjtnQkFDRCxJQUFJLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRTtnQkFDbkUsT0FBTyxFQUFFLEVBQUUsWUFBWSxFQUFFLE9BQU8sR0FBRyxTQUFTLEVBQUU7Z0JBQzlDLFdBQVcsRUFBRSxTQUFTLEVBQUUsc0NBQXNDO2FBQy9ELENBQUMsQ0FBQztZQUVILE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxlQUFlLEdBQUcsSUFBQSxxQkFBYyxFQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzlDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUUzQixvRkFBb0Y7WUFDcEYsSUFBQSxtQkFBWSxFQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7Z0JBQ3hCLElBQUksRUFBRSxlQUFlO2dCQUNyQixPQUFPLEVBQUUsU0FBUztnQkFDbEIsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUM1QixVQUFVLEVBQUUsVUFBVTtnQkFDdEIsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUN6QixTQUFTLEVBQUUsUUFBUTtnQkFDbkIsTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLE9BQU8sRUFBRSxLQUFLO2dCQUNkLFVBQVUsRUFBRSxPQUFPLEdBQUcsU0FBUztnQkFDL0IsSUFBSSxFQUFFO29CQUNKLE1BQU07b0JBQ04sVUFBVSxFQUFFLElBQUksQ0FBQyxTQUFTO29CQUMxQixTQUFTLEVBQUUsU0FBUztvQkFDcEIsUUFBUSxFQUFFLE9BQU87aUJBQ2xCO2dCQUNELEtBQUssRUFBRSxJQUFBLGVBQVEsRUFBQyxlQUFlLENBQUM7Z0JBQ2hDLElBQUksRUFBRSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2dCQUNuRSxPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsT0FBTyxHQUFHLFNBQVMsRUFBRTtnQkFDOUMsV0FBVyxFQUFFLFNBQVMsRUFBRSxzQ0FBc0M7YUFDL0QsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUUsQ0FBQztnQkFDOUIsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUM7Z0JBQ3ZCLE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQztZQUVELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxVQUFVLENBQUMsSUFBWSxFQUFFLEtBQWU7UUFDdEMsT0FBTyxJQUFBLG1CQUFZLEVBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUMvQixJQUFJLEVBQUUsZUFBZTtZQUNyQixPQUFPLEVBQUUsWUFBWTtZQUNyQixLQUFLLEVBQUUsTUFBTTtZQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUM1QixVQUFVLEVBQUUsVUFBVTtZQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDekIsU0FBUyxFQUFFLElBQUk7WUFDZixNQUFNLEVBQUUsWUFBWTtZQUNwQixJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUNqQyxJQUFJLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDbkQsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7U0FDeEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsUUFBUSxDQUNOLFlBQW9CLEVBQ3BCLE1BQWUsRUFDZixPQUFtRDtRQUVuRCxPQUFPLElBQUEsbUJBQVksRUFBQyxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQy9CLElBQUksRUFBRSxlQUFlO1lBQ3JCLE9BQU8sRUFBRSxVQUFVO1lBQ25CLEtBQUssRUFBRSxNQUFNO1lBQ2IsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQzVCLFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFFBQVEsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUN6QixTQUFTLEVBQUUsWUFBWTtZQUN2QixNQUFNLEVBQUUsV0FBVztZQUNuQixJQUFJLEVBQUU7Z0JBQ0osUUFBUSxFQUFFLE1BQU07Z0JBQ2hCLFNBQVMsRUFBRSxPQUFPLEVBQUUsU0FBUztnQkFDN0IsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO2FBQ3RCO1lBQ0QsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFO1lBQ25ELFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1NBQ3hCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxNQUFjLEVBQUUsVUFBb0I7UUFDeEMsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUM7UUFDdkIsT0FBTyxJQUFBLG1CQUFZLEVBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRTtZQUMvQixJQUFJLEVBQUUsZUFBZTtZQUNyQixPQUFPLEVBQUUsT0FBTztZQUNoQixLQUFLLEVBQUUsTUFBTTtZQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUM1QixVQUFVLEVBQUUsVUFBVTtZQUN0QixRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDekIsU0FBUyxFQUFFLE9BQU87WUFDbEIsTUFBTSxFQUFFLFFBQVE7WUFDaEIsSUFBSSxFQUFFLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRTtZQUM1QixJQUFJLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDbkQsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7U0FDeEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFdBQXFCO1FBQzFCLElBQUksQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFDO1FBQ3hCLE9BQU8sSUFBQSxtQkFBWSxFQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDL0IsSUFBSSxFQUFFLGVBQWU7WUFDckIsT0FBTyxFQUFFLFFBQVE7WUFDakIsS0FBSyxFQUFFLE1BQU07WUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDNUIsVUFBVSxFQUFFLFVBQVU7WUFDdEIsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQ3pCLFNBQVMsRUFBRSxRQUFRO1lBQ25CLE1BQU0sRUFBRSxTQUFTO1lBQ2pCLElBQUksRUFBRSxFQUFFLFdBQVcsRUFBRTtZQUNyQixJQUFJLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDbkQsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7U0FDeEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLElBQVksRUFBRSxJQUE4QjtRQUNoRCxPQUFPLElBQUEsbUJBQVksRUFBQyxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQy9CLElBQUksRUFBRSxlQUFlO1lBQ3JCLE9BQU8sRUFBRSxPQUFPO1lBQ2hCLEtBQUssRUFBRSxNQUFNO1lBQ2IsV0FBVyxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQzVCLFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFFBQVEsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUN6QixTQUFTLEVBQUUsSUFBSTtZQUNmLElBQUk7WUFDSixJQUFJLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDbkQsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7U0FDeEIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsUUFBUSxDQUFDLE9BQWtFO1FBQ3pFLElBQUksQ0FBQyxNQUFNLEdBQUcsV0FBVyxDQUFDO1FBQzFCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBRTdDLE9BQU8sSUFBQSxtQkFBWSxFQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDL0IsSUFBSSxFQUFFLGNBQWM7WUFDcEIsS0FBSyxFQUFFLE1BQU07WUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxtQ0FBbUM7WUFDakUsVUFBVSxFQUFFLFVBQVU7WUFDdEIsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQ3pCLFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtZQUM1QixNQUFNLEVBQUUsV0FBVztZQUNuQixPQUFPLEVBQUUsSUFBSTtZQUNiLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLElBQUksRUFBRTtnQkFDSixNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU07Z0JBQ3ZCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUzthQUMxQjtZQUNELFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUTtZQUMzQixLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDakIsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFO1lBQ25ELE9BQU8sRUFBRSxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUNoRCxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtTQUN4QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxJQUFJLENBQUMsS0FBWSxFQUFFLE9BQWdEO1FBQ2pFLElBQUksQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFDO1FBQ3ZCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBRTdDLE9BQU8sSUFBQSxtQkFBWSxFQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDL0IsSUFBSSxFQUFFLGNBQWM7WUFDcEIsS0FBSyxFQUFFLE9BQU87WUFDZCxXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxtQ0FBbUM7WUFDakUsVUFBVSxFQUFFLFVBQVU7WUFDdEIsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQ3pCLFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtZQUM1QixNQUFNLEVBQUUsUUFBUTtZQUNoQixPQUFPLEVBQUUsS0FBSztZQUNkLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLElBQUksRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFO1lBQ25DLEtBQUssRUFBRSxJQUFBLGVBQVEsRUFBQyxLQUFLLENBQUM7WUFDdEIsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRO1lBQzNCLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztZQUNqQixJQUFJLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDbkQsT0FBTyxFQUFFLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFO1lBQ2hELFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1NBQ3hCLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxNQUFlO1FBQ3BCLElBQUksQ0FBQyxNQUFNLEdBQUcsV0FBVyxDQUFDO1FBQzFCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBRTdDLE9BQU8sSUFBQSxtQkFBWSxFQUFDLElBQUksQ0FBQyxNQUFNLEVBQUU7WUFDL0IsSUFBSSxFQUFFLGNBQWM7WUFDcEIsS0FBSyxFQUFFLE1BQU07WUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxtQ0FBbUM7WUFDakUsVUFBVSxFQUFFLFVBQVU7WUFDdEIsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQ3pCLFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtZQUM1QixNQUFNLEVBQUUsV0FBVztZQUNuQixPQUFPLEVBQUUsS0FBSztZQUNkLFVBQVUsRUFBRSxRQUFRO1lBQ3BCLElBQUksRUFBRSxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUMzQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDakIsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWSxFQUFFO1lBQ25ELE9BQU8sRUFBRSxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUNoRCxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtTQUN4QixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF0WEQsNENBc1hDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxNQUFNLG9CQUFvQjtJQUNQLFlBQVksQ0FBUztJQUM5QixNQUFNLEdBQW1CLFNBQVMsQ0FBQztJQUUzQyxZQUFZLFlBQW9CO1FBQzlCLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO1FBQ2pDLE1BQU0sQ0FBQyxJQUFJLENBQUMsOEJBQThCLFlBQVksRUFBRSxDQUFDLENBQUM7SUFDNUQsQ0FBQztJQUVELElBQUksRUFBRTtRQUNKLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxJQUFJLE9BQU87UUFDVCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRUQsSUFBSSxJQUFJO1FBQ04sT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDO0lBQzNCLENBQUM7SUFFRCxJQUFJLGFBQWE7UUFDZixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDckIsQ0FBQztJQVlELEtBQUssQ0FBQyxJQUFJLENBQUksU0FBaUIsRUFBRSxFQUFvQixFQUFFLE9BQXFCO1FBQzFFLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxFQUFFLEVBQUUsQ0FBQztRQUNwQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksT0FBTyxFQUFFLGVBQWUsRUFBRSxDQUFDO2dCQUM3QixPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBQ0QsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUM7WUFDdkIsTUFBTSxLQUFLLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVELFVBQVUsQ0FBQyxLQUFhLEVBQUUsTUFBZ0I7UUFDeEMsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELFFBQVEsQ0FBQyxhQUFxQixFQUFFLE9BQWdCLEVBQUUsUUFBb0Q7UUFDcEcsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFlLEVBQUUsV0FBcUI7UUFDMUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUM7UUFDdkIsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELE1BQU0sQ0FBQyxZQUFzQjtRQUMzQixJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQztRQUN4QixPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQWEsRUFBRSxLQUErQjtRQUNsRCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRUQsUUFBUSxDQUFDLFFBQW1FO1FBQzFFLElBQUksQ0FBQyxNQUFNLEdBQUcsV0FBVyxDQUFDO1FBQzFCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxJQUFJLENBQUMsTUFBYSxFQUFFLFFBQWlEO1FBQ25FLElBQUksQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFDO1FBQ3ZCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxNQUFNLENBQUMsT0FBZ0I7UUFDckIsSUFBSSxDQUFDLE1BQU0sR0FBRyxXQUFXLENBQUM7UUFDMUIsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBXb3JrZmxvd09ic2VydmVyIC0gRm9yIGxvbmctcnVubmluZyBhbmQgZGlzdHJpYnV0ZWQgd29ya2Zsb3dzXG4gKiBcbiAqIERFU0lHTiBQUklOQ0lQTEVTOlxuICogLSBSZXF1aXJlcyBjb3JyZWxhdGlvbklkIGZyb20gY29udGV4dCBvciBleHBsaWNpdFxuICogLSBUcmFja3Mgd29ya2Zsb3cgbGlmZWN5Y2xlIChzdGFydCwgc3RlcHMsIGVuZClcbiAqIC0gU3VwcG9ydHMgY2hlY2twb2ludHMsIGRlY2lzaW9ucywgcGF1c2UvcmVzdW1lXG4gKiAtIFVzZXMgY2FwdHVyZXIgcGF0dGVybiBmb3IgdGVzdGFiaWxpdHlcbiAqIC0gUmV0dXJucyBsb2dJZCBmcm9tIG1ldGhvZHMgZm9yIHRyYWNraW5nXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gRklSU1Q6IEVzdGFibGlzaCBjb250ZXh0XG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCwgeyBhY3RvciB9KSxcbiAqICAgYXN5bmMgKCkgPT4ge1xuICogICAgIGNvbnN0IHdvcmtmbG93ID0gV29ya2Zsb3dPYnNlcnZlci5zdGFydCgnb3JkZXItZnVsZmlsbG1lbnQnLCB7XG4gKiAgICAgICBlbnRpdHlOYW1lOiAnT3JkZXInLFxuICogICAgICAgZW50aXR5SWQ6IG9yZGVySWQsXG4gKiAgICAgfSk7XG4gKiAgICAgXG4gKiAgICAgYXdhaXQgd29ya2Zsb3cuc3RlcCgndmFsaWRhdGUnLCBhc3luYyAoKSA9PiB7XG4gKiAgICAgICAvLyB2YWxpZGF0aW9uIGxvZ2ljXG4gKiAgICAgfSk7XG4gKiAgICAgXG4gKiAgICAgYXdhaXQgd29ya2Zsb3cuc3RlcCgncGF5bWVudCcsIGFzeW5jICgpID0+IHtcbiAqICAgICAgIC8vIHBheW1lbnQgbG9naWNcbiAqICAgICB9KTtcbiAqICAgICBcbiAqICAgICB3b3JrZmxvdy5jb21wbGV0ZSh7IHJlc3VsdDogJ2Z1bGZpbGxlZCcgfSk7XG4gKiAgIH1cbiAqICk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHtcbiAgYnVpbGRDb21tb25GaWVsZHMsXG4gIGNhcHR1cmVFdmVudCxcbiAgZ2VuZXJhdGVJZCxcbiAgbWFwRXJyb3IsXG4gIG5vcm1hbGl6ZUVycm9yLFxuICBtZXJnZU9ic2VydmVyVGFncyxcbiAgQ29tbW9uRmllbGRzLFxufSBmcm9tICcuL2Jhc2UnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignV29ya2Zsb3dPYnNlcnZlcicpO1xuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdXb3JrZmxvd09ic2VydmVyJztcblxuZXhwb3J0IGludGVyZmFjZSBXb3JrZmxvd09wdGlvbnMge1xuICAvKiogQ29ycmVsYXRpb24gSUQgLSBpZiBub3QgcHJvdmlkZWQsIG11c3QgY29tZSBmcm9tIGNvbnRleHQgKi9cbiAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgLyoqIFRhcmdldCBlbnRpdHkgdHlwZSAqL1xuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAvKiogVGFyZ2V0IGVudGl0eSBJRCAqL1xuICBlbnRpdHlJZD86IHN0cmluZztcbiAgLyoqIEFjdG9yIHBlcmZvcm1pbmcgdGhlIHdvcmtmbG93ICovXG4gIGFjdG9yPzogQWN0b3I7XG4gIC8qKiBUYWdzIGZvciBmaWx0ZXJpbmcgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBBZGRpdGlvbmFsIG1ldGFkYXRhICovXG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RlcE9wdGlvbnMge1xuICAvKiogSW5wdXQgZGF0YSBmb3IgdGhlIHN0ZXAgKi9cbiAgaW5wdXQ/OiB1bmtub3duO1xuICAvKiogV2hldGhlciB0byBjYXB0dXJlIG91dHB1dCBpbiBsb2dzIChtYXkgY29udGFpbiBzZW5zaXRpdmUgZGF0YSkgKi9cbiAgY2FwdHVyZU91dHB1dD86IGJvb2xlYW47XG4gIC8qKiBDb250aW51ZSB3b3JrZmxvdyBldmVuIGlmIHN0ZXAgZmFpbHMgKi9cbiAgY29udGludWVPbkVycm9yPzogYm9vbGVhbjtcbn1cblxudHlwZSBXb3JrZmxvd1N0YXR1cyA9ICdydW5uaW5nJyB8ICdjb21wbGV0ZWQnIHwgJ2ZhaWxlZCcgfCAncGF1c2VkJyB8ICdjYW5jZWxsZWQnO1xuXG4vKipcbiAqIEludGVyZmFjZSBmb3Igd29ya2Zsb3cgb3BlcmF0aW9ucyAoYWxsb3dzIE5vT3AgaW1wbGVtZW50YXRpb24pXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSVdvcmtmbG93T2JzZXJ2ZXIge1xuICByZWFkb25seSBpZDogc3RyaW5nO1xuICByZWFkb25seSB0cmFjZUlkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgY3VycmVudFN0YXR1czogV29ya2Zsb3dTdGF0dXM7XG4gIHN0ZXA8VD4oc3RlcE5hbWU6IHN0cmluZywgZm46ICgpID0+IFByb21pc2U8VD4sIG9wdGlvbnM6IFN0ZXBPcHRpb25zICYgeyBjb250aW51ZU9uRXJyb3I6IHRydWUgfSk6IFByb21pc2U8VCB8IHVuZGVmaW5lZD47XG4gIHN0ZXA8VD4oc3RlcE5hbWU6IHN0cmluZywgZm46ICgpID0+IFByb21pc2U8VD4sIG9wdGlvbnM/OiBTdGVwT3B0aW9ucyAmIHsgY29udGludWVPbkVycm9yPzogZmFsc2UgfSk6IFByb21pc2U8VD47XG4gIGNoZWNrcG9pbnQobmFtZTogc3RyaW5nLCBzdGF0ZT86IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGRlY2lzaW9uKGRlY2lzaW9uTmFtZTogc3RyaW5nLCByZXN1bHQ6IHVua25vd24sIG9wdGlvbnM/OiB7IHJlYXNvbmluZz86IHN0cmluZzsgcnVsZXM/OiB1bmtub3duW10gfSk6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgcGF1c2UocmVhc29uOiBzdHJpbmcsIHJlc3VtZURhdGE/OiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICByZXN1bWUocmVzdW1lSW5wdXQ/OiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBldmVudChuYW1lOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgY29tcGxldGUob3B0aW9ucz86IHsgcmVzdWx0PzogdW5rbm93bjsgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9KTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBmYWlsKGVycm9yOiBFcnJvciwgb3B0aW9ucz86IHsgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9KTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBjYW5jZWwocmVhc29uPzogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgY2xhc3MgV29ya2Zsb3dPYnNlcnZlciBpbXBsZW1lbnRzIElXb3JrZmxvd09ic2VydmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSB3b3JrZmxvd0lkOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgY29ycmVsYXRpb25JZDogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHdvcmtmbG93TmFtZTogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0YXJ0VGltZTogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZW50aXR5SWQ/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWN0b3I/OiBBY3RvcjtcbiAgcHJpdmF0ZSByZWFkb25seSB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWVsZHM6IENvbW1vbkZpZWxkcztcbiAgcHJpdmF0ZSBzdGVwQ291bnQgPSAwO1xuICBwcml2YXRlIHN0YXR1czogV29ya2Zsb3dTdGF0dXMgPSAncnVubmluZyc7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3Rvcih3b3JrZmxvd05hbWU6IHN0cmluZywgZmllbGRzOiBDb21tb25GaWVsZHMsIG9wdGlvbnM/OiBXb3JrZmxvd09wdGlvbnMpIHtcbiAgICB0aGlzLndvcmtmbG93SWQgPSBnZW5lcmF0ZUlkKCk7XG4gICAgdGhpcy5jb3JyZWxhdGlvbklkID0gZmllbGRzLmNvcnJlbGF0aW9uSWQ7XG4gICAgdGhpcy53b3JrZmxvd05hbWUgPSB3b3JrZmxvd05hbWU7XG4gICAgdGhpcy5lbnRpdHlOYW1lID0gb3B0aW9ucz8uZW50aXR5TmFtZTtcbiAgICB0aGlzLmVudGl0eUlkID0gb3B0aW9ucz8uZW50aXR5SWQ7XG4gICAgdGhpcy5hY3RvciA9IG9wdGlvbnM/LmFjdG9yID8/IGZpZWxkcy5hY3RvcjtcbiAgICB0aGlzLnRhZ3MgPSBtZXJnZU9ic2VydmVyVGFncyhmaWVsZHMudGFncywgb3B0aW9ucz8udGFncyk7XG4gICAgdGhpcy5zdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRoaXMuZmllbGRzID0gZmllbGRzO1xuXG4gICAgY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ3dvcmtmbG93LnN0YXJ0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBlbnRpdHlOYW1lOiAnd29ya2Zsb3cnLFxuICAgICAgZW50aXR5SWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIG9wZXJhdGlvbjogd29ya2Zsb3dOYW1lLFxuICAgICAgc3RhdHVzOiAnc3RhcnRlZCcsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIHdvcmtmbG93TmFtZSxcbiAgICAgICAgdGFyZ2V0RW50aXR5TmFtZTogdGhpcy5lbnRpdHlOYW1lLFxuICAgICAgICB0YXJnZXRFbnRpdHlJZDogdGhpcy5lbnRpdHlJZCxcbiAgICAgICAgbWV0YWRhdGE6IG9wdGlvbnM/Lm1ldGFkYXRhLFxuICAgICAgfSxcbiAgICAgIGFjdG9yOiB0aGlzLmFjdG9yLFxuICAgICAgdGFnczogeyAuLi50aGlzLnRhZ3MsIHdvcmtmbG93OiB3b3JrZmxvd05hbWUgfSxcbiAgICAgIHRpbWVzdGFtcE1zOiB0aGlzLnN0YXJ0VGltZSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydCBhIG5ldyB3b3JrZmxvd1xuICAgKiBAcmV0dXJucyBXb3JrZmxvd09ic2VydmVyIGluc3RhbmNlLCBvciBOb09wIHdvcmtmbG93IGlmIGNvcnJlbGF0aW9uSWQgbm90IGF2YWlsYWJsZVxuICAgKi9cbiAgc3RhdGljIHN0YXJ0KHdvcmtmbG93TmFtZTogc3RyaW5nLCBvcHRpb25zPzogV29ya2Zsb3dPcHRpb25zKTogSVdvcmtmbG93T2JzZXJ2ZXIge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQsXG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnM/Lm1ldGFkYXRhLFxuICAgIH0pO1xuXG4gICAgaWYgKCFmaWVsZHMpIHtcbiAgICAgIC8vIFJldHVybiBhIG5vLW9wIHdvcmtmbG93IHRoYXQgd29uJ3QgY3Jhc2ggYnV0IHdvbid0IHJlY29yZCBhbnl0aGluZ1xuICAgICAgcmV0dXJuIG5ldyBOb09wV29ya2Zsb3dPYnNlcnZlcih3b3JrZmxvd05hbWUpO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgV29ya2Zsb3dPYnNlcnZlcih3b3JrZmxvd05hbWUsIGZpZWxkcywgb3B0aW9ucyk7XG4gIH1cblxuICAvLyA9PT0gR2V0dGVycyA9PT1cbiAgZ2V0IGlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMud29ya2Zsb3dJZDtcbiAgfVxuXG4gIGdldCB0cmFjZUlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuY29ycmVsYXRpb25JZDtcbiAgfVxuXG4gIGdldCBuYW1lKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMud29ya2Zsb3dOYW1lO1xuICB9XG5cbiAgZ2V0IGN1cnJlbnRTdGF0dXMoKTogV29ya2Zsb3dTdGF0dXMge1xuICAgIHJldHVybiB0aGlzLnN0YXR1cztcbiAgfVxuXG4gIC8qKlxuICAgKiBFeGVjdXRlIGFuZCByZWNvcmQgYSB3b3JrZmxvdyBzdGVwXG4gICAqIFxuICAgKiBAb3ZlcmxvYWQgV2hlbiBjb250aW51ZU9uRXJyb3IgaXMgdHJ1ZSwgcmV0dXJucyBUIHwgdW5kZWZpbmVkIG9uIGVycm9yXG4gICAqIEBvdmVybG9hZCBXaGVuIGNvbnRpbnVlT25FcnJvciBpcyBmYWxzZS91bmRlZmluZWQsIHRocm93cyBvbiBlcnJvciBhbmQgcmV0dXJucyBUXG4gICAqL1xuICBhc3luYyBzdGVwPFQ+KFxuICAgIHN0ZXBOYW1lOiBzdHJpbmcsXG4gICAgZm46ICgpID0+IFByb21pc2U8VD4sXG4gICAgb3B0aW9uczogU3RlcE9wdGlvbnMgJiB7IGNvbnRpbnVlT25FcnJvcjogdHJ1ZSB9XG4gICk6IFByb21pc2U8VCB8IHVuZGVmaW5lZD47XG4gIGFzeW5jIHN0ZXA8VD4oXG4gICAgc3RlcE5hbWU6IHN0cmluZyxcbiAgICBmbjogKCkgPT4gUHJvbWlzZTxUPixcbiAgICBvcHRpb25zPzogU3RlcE9wdGlvbnMgJiB7IGNvbnRpbnVlT25FcnJvcj86IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxUPjtcbiAgYXN5bmMgc3RlcDxUPihcbiAgICBzdGVwTmFtZTogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICAgIG9wdGlvbnM/OiBTdGVwT3B0aW9uc1xuICApOiBQcm9taXNlPFQgfCB1bmRlZmluZWQ+IHtcbiAgICB0aGlzLnN0ZXBDb3VudCsrO1xuICAgIGNvbnN0IHN0ZXBJZCA9IGdlbmVyYXRlSWQoKTtcbiAgICBjb25zdCBzdGVwU3RhcnQgPSBEYXRlLm5vdygpO1xuXG4gICAgLy8gRW1pdCBzdGVwIHN0YXJ0IGV2ZW50IChzdWJUeXBlOiAnZXhlY3V0ZScgZm9yIGNvbnNpc3RlbmN5KVxuICAgIGNhcHR1cmVFdmVudCh0aGlzLmZpZWxkcywge1xuICAgICAgdHlwZTogJ3dvcmtmbG93LnN0ZXAnLFxuICAgICAgc3ViVHlwZTogJ2V4ZWN1dGUnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHBhcmVudExvZ0lkOiB0aGlzLndvcmtmbG93SWQsXG4gICAgICBlbnRpdHlOYW1lOiAnd29ya2Zsb3cnLFxuICAgICAgZW50aXR5SWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIG9wZXJhdGlvbjogc3RlcE5hbWUsXG4gICAgICBzdGF0dXM6ICdzdGFydGVkJyxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgc3RlcElkLFxuICAgICAgICBzdGVwTnVtYmVyOiB0aGlzLnN0ZXBDb3VudCxcbiAgICAgICAgaW5wdXQ6IG9wdGlvbnM/LmlucHV0LFxuICAgICAgfSxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCB3b3JrZmxvdzogdGhpcy53b3JrZmxvd05hbWUsIHN0ZXA6IHN0ZXBOYW1lIH0sXG4gICAgICB0aW1lc3RhbXBNczogc3RlcFN0YXJ0LFxuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZuKCk7XG4gICAgICBjb25zdCBzdGVwRW5kID0gRGF0ZS5ub3coKTtcblxuICAgICAgLy8gRW1pdCBzdGVwIGNvbXBsZXRlIC0gdXNlIFNUQVJUIHRpbWUgYXMgdGltZXN0YW1wTXMgZm9yIGNvcnJlY3QgdGltZS1zZXJpZXMgb3JkZXJpbmdcbiAgICAgIGNhcHR1cmVFdmVudCh0aGlzLmZpZWxkcywge1xuICAgICAgICB0eXBlOiAnd29ya2Zsb3cuc3RlcCcsXG4gICAgICAgIHN1YlR5cGU6ICdleGVjdXRlJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgICAgZW50aXR5TmFtZTogJ3dvcmtmbG93JyxcbiAgICAgICAgZW50aXR5SWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgICAgb3BlcmF0aW9uOiBzdGVwTmFtZSxcbiAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgZHVyYXRpb25Nczogc3RlcEVuZCAtIHN0ZXBTdGFydCxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIHN0ZXBJZCxcbiAgICAgICAgICBzdGVwTnVtYmVyOiB0aGlzLnN0ZXBDb3VudCxcbiAgICAgICAgICBvdXRwdXQ6IG9wdGlvbnM/LmNhcHR1cmVPdXRwdXQgPyByZXN1bHQgOiB1bmRlZmluZWQsXG4gICAgICAgICAgc3RhcnRlZEF0OiBzdGVwU3RhcnQsXG4gICAgICAgICAgY29tcGxldGVkQXQ6IHN0ZXBFbmQsXG4gICAgICAgIH0sXG4gICAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCB3b3JrZmxvdzogdGhpcy53b3JrZmxvd05hbWUsIHN0ZXA6IHN0ZXBOYW1lIH0sXG4gICAgICAgIG1ldHJpY3M6IHsgc3RlcER1cmF0aW9uOiBzdGVwRW5kIC0gc3RlcFN0YXJ0IH0sXG4gICAgICAgIHRpbWVzdGFtcE1zOiBzdGVwU3RhcnQsIC8vIFVzZSBTVEFSVCB0aW1lIGZvciBjb3JyZWN0IG9yZGVyaW5nXG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEVycm9yID0gbm9ybWFsaXplRXJyb3IoZXJyb3IpO1xuICAgICAgY29uc3Qgc3RlcEVuZCA9IERhdGUubm93KCk7XG5cbiAgICAgIC8vIEVtaXQgc3RlcCBmYWlsZWQgLSB1c2UgU1RBUlQgdGltZSBhcyB0aW1lc3RhbXBNcyBmb3IgY29ycmVjdCB0aW1lLXNlcmllcyBvcmRlcmluZ1xuICAgICAgY2FwdHVyZUV2ZW50KHRoaXMuZmllbGRzLCB7XG4gICAgICAgIHR5cGU6ICd3b3JrZmxvdy5zdGVwJyxcbiAgICAgICAgc3ViVHlwZTogJ2V4ZWN1dGUnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgICAgZW50aXR5TmFtZTogJ3dvcmtmbG93JyxcbiAgICAgICAgZW50aXR5SWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgICAgb3BlcmF0aW9uOiBzdGVwTmFtZSxcbiAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGR1cmF0aW9uTXM6IHN0ZXBFbmQgLSBzdGVwU3RhcnQsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBzdGVwSWQsXG4gICAgICAgICAgc3RlcE51bWJlcjogdGhpcy5zdGVwQ291bnQsXG4gICAgICAgICAgc3RhcnRlZEF0OiBzdGVwU3RhcnQsXG4gICAgICAgICAgZmFpbGVkQXQ6IHN0ZXBFbmQsXG4gICAgICAgIH0sXG4gICAgICAgIGVycm9yOiBtYXBFcnJvcihub3JtYWxpemVkRXJyb3IpLFxuICAgICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgd29ya2Zsb3c6IHRoaXMud29ya2Zsb3dOYW1lLCBzdGVwOiBzdGVwTmFtZSB9LFxuICAgICAgICBtZXRyaWNzOiB7IHN0ZXBEdXJhdGlvbjogc3RlcEVuZCAtIHN0ZXBTdGFydCB9LFxuICAgICAgICB0aW1lc3RhbXBNczogc3RlcFN0YXJ0LCAvLyBVc2UgU1RBUlQgdGltZSBmb3IgY29ycmVjdCBvcmRlcmluZ1xuICAgICAgfSk7XG5cbiAgICAgIGlmICghb3B0aW9ucz8uY29udGludWVPbkVycm9yKSB7XG4gICAgICAgIHRoaXMuc3RhdHVzID0gJ2ZhaWxlZCc7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYSBjaGVja3BvaW50IChzYXZlIHBvaW50IGZvciByZXN1bXB0aW9uKVxuICAgKi9cbiAgY2hlY2twb2ludChuYW1lOiBzdHJpbmcsIHN0YXRlPzogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudCh0aGlzLmZpZWxkcywge1xuICAgICAgdHlwZTogJ3dvcmtmbG93LnN0ZXAnLFxuICAgICAgc3ViVHlwZTogJ2NoZWNrcG9pbnQnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHBhcmVudExvZ0lkOiB0aGlzLndvcmtmbG93SWQsXG4gICAgICBlbnRpdHlOYW1lOiAnd29ya2Zsb3cnLFxuICAgICAgZW50aXR5SWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIG9wZXJhdGlvbjogbmFtZSxcbiAgICAgIHN0YXR1czogJ2NoZWNrcG9pbnQnLFxuICAgICAgZGF0YTogeyBjaGVja3BvaW50OiBuYW1lLCBzdGF0ZSB9LFxuICAgICAgdGFnczogeyAuLi50aGlzLnRhZ3MsIHdvcmtmbG93OiB0aGlzLndvcmtmbG93TmFtZSB9LFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGRlY2lzaW9uIHBvaW50IGluIHdvcmtmbG93XG4gICAqL1xuICBkZWNpc2lvbihcbiAgICBkZWNpc2lvbk5hbWU6IHN0cmluZyxcbiAgICByZXN1bHQ6IHVua25vd24sXG4gICAgb3B0aW9ucz86IHsgcmVhc29uaW5nPzogc3RyaW5nOyBydWxlcz86IHVua25vd25bXSB9XG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudCh0aGlzLmZpZWxkcywge1xuICAgICAgdHlwZTogJ3dvcmtmbG93LnN0ZXAnLFxuICAgICAgc3ViVHlwZTogJ2RlY2lzaW9uJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBwYXJlbnRMb2dJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgZW50aXR5TmFtZTogJ3dvcmtmbG93JyxcbiAgICAgIGVudGl0eUlkOiB0aGlzLndvcmtmbG93SWQsXG4gICAgICBvcGVyYXRpb246IGRlY2lzaW9uTmFtZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGRlY2lzaW9uOiByZXN1bHQsXG4gICAgICAgIHJlYXNvbmluZzogb3B0aW9ucz8ucmVhc29uaW5nLFxuICAgICAgICBydWxlczogb3B0aW9ucz8ucnVsZXMsXG4gICAgICB9LFxuICAgICAgdGFnczogeyAuLi50aGlzLnRhZ3MsIHdvcmtmbG93OiB0aGlzLndvcmtmbG93TmFtZSB9LFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUGF1c2Ugd29ya2Zsb3cgKGUuZy4sIHdhaXRpbmcgZm9yIGV4dGVybmFsIGlucHV0KVxuICAgKi9cbiAgcGF1c2UocmVhc29uOiBzdHJpbmcsIHJlc3VtZURhdGE/OiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICB0aGlzLnN0YXR1cyA9ICdwYXVzZWQnO1xuICAgIHJldHVybiBjYXB0dXJlRXZlbnQodGhpcy5maWVsZHMsIHtcbiAgICAgIHR5cGU6ICd3b3JrZmxvdy5zdGVwJyxcbiAgICAgIHN1YlR5cGU6ICdwYXVzZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgb3BlcmF0aW9uOiAncGF1c2UnLFxuICAgICAgc3RhdHVzOiAncGF1c2VkJyxcbiAgICAgIGRhdGE6IHsgcmVhc29uLCByZXN1bWVEYXRhIH0sXG4gICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgd29ya2Zsb3c6IHRoaXMud29ya2Zsb3dOYW1lIH0sXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXN1bWUgd29ya2Zsb3cgZnJvbSBwYXVzZVxuICAgKi9cbiAgcmVzdW1lKHJlc3VtZUlucHV0PzogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgdGhpcy5zdGF0dXMgPSAncnVubmluZyc7XG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudCh0aGlzLmZpZWxkcywge1xuICAgICAgdHlwZTogJ3dvcmtmbG93LnN0ZXAnLFxuICAgICAgc3ViVHlwZTogJ3Jlc3VtZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgb3BlcmF0aW9uOiAncmVzdW1lJyxcbiAgICAgIHN0YXR1czogJ3J1bm5pbmcnLFxuICAgICAgZGF0YTogeyByZXN1bWVJbnB1dCB9LFxuICAgICAgdGFnczogeyAuLi50aGlzLnRhZ3MsIHdvcmtmbG93OiB0aGlzLndvcmtmbG93TmFtZSB9LFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIGFuIGV2ZW50IGluIHRoZSB3b3JrZmxvd1xuICAgKi9cbiAgZXZlbnQobmFtZTogc3RyaW5nLCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBjYXB0dXJlRXZlbnQodGhpcy5maWVsZHMsIHtcbiAgICAgIHR5cGU6ICd3b3JrZmxvdy5zdGVwJyxcbiAgICAgIHN1YlR5cGU6ICdldmVudCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCxcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgb3BlcmF0aW9uOiBuYW1lLFxuICAgICAgZGF0YSxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy50YWdzLCB3b3JrZmxvdzogdGhpcy53b3JrZmxvd05hbWUgfSxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENvbXBsZXRlIHdvcmtmbG93IHN1Y2Nlc3NmdWxseVxuICAgKi9cbiAgY29tcGxldGUob3B0aW9ucz86IHsgcmVzdWx0PzogdW5rbm93bjsgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICB0aGlzLnN0YXR1cyA9ICdjb21wbGV0ZWQnO1xuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRUaW1lO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudCh0aGlzLmZpZWxkcywge1xuICAgICAgdHlwZTogJ3dvcmtmbG93LmVuZCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCwgLy8gTGluayBlbmQgZXZlbnQgdG8gd29ya2Zsb3cgc3RhcnRcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgb3BlcmF0aW9uOiB0aGlzLndvcmtmbG93TmFtZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogZHVyYXRpb24sXG4gICAgICBkYXRhOiB7XG4gICAgICAgIHJlc3VsdDogb3B0aW9ucz8ucmVzdWx0LFxuICAgICAgICBzdGVwQ291bnQ6IHRoaXMuc3RlcENvdW50LFxuICAgICAgfSxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zPy5tZXRhZGF0YSxcbiAgICAgIGFjdG9yOiB0aGlzLmFjdG9yLFxuICAgICAgdGFnczogeyAuLi50aGlzLnRhZ3MsIHdvcmtmbG93OiB0aGlzLndvcmtmbG93TmFtZSB9LFxuICAgICAgbWV0cmljczogeyBkdXJhdGlvbiwgc3RlcENvdW50OiB0aGlzLnN0ZXBDb3VudCB9LFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTWFyayB3b3JrZmxvdyBhcyBmYWlsZWRcbiAgICovXG4gIGZhaWwoZXJyb3I6IEVycm9yLCBvcHRpb25zPzogeyBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRoaXMuc3RhdHVzID0gJ2ZhaWxlZCc7XG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWU7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KHRoaXMuZmllbGRzLCB7XG4gICAgICB0eXBlOiAnd29ya2Zsb3cuZW5kJyxcbiAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgcGFyZW50TG9nSWQ6IHRoaXMud29ya2Zsb3dJZCwgLy8gTGluayBlbmQgZXZlbnQgdG8gd29ya2Zsb3cgc3RhcnRcbiAgICAgIGVudGl0eU5hbWU6ICd3b3JrZmxvdycsXG4gICAgICBlbnRpdHlJZDogdGhpcy53b3JrZmxvd0lkLFxuICAgICAgb3BlcmF0aW9uOiB0aGlzLndvcmtmbG93TmFtZSxcbiAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGR1cmF0aW9uTXM6IGR1cmF0aW9uLFxuICAgICAgZGF0YTogeyBzdGVwQ291bnQ6IHRoaXMuc3RlcENvdW50IH0sXG4gICAgICBlcnJvcjogbWFwRXJyb3IoZXJyb3IpLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnM/Lm1ldGFkYXRhLFxuICAgICAgYWN0b3I6IHRoaXMuYWN0b3IsXG4gICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgd29ya2Zsb3c6IHRoaXMud29ya2Zsb3dOYW1lIH0sXG4gICAgICBtZXRyaWNzOiB7IGR1cmF0aW9uLCBzdGVwQ291bnQ6IHRoaXMuc3RlcENvdW50IH0sXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYW5jZWwgd29ya2Zsb3dcbiAgICovXG4gIGNhbmNlbChyZWFzb24/OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRoaXMuc3RhdHVzID0gJ2NhbmNlbGxlZCc7XG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWU7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KHRoaXMuZmllbGRzLCB7XG4gICAgICB0eXBlOiAnd29ya2Zsb3cuZW5kJyxcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBwYXJlbnRMb2dJZDogdGhpcy53b3JrZmxvd0lkLCAvLyBMaW5rIGVuZCBldmVudCB0byB3b3JrZmxvdyBzdGFydFxuICAgICAgZW50aXR5TmFtZTogJ3dvcmtmbG93JyxcbiAgICAgIGVudGl0eUlkOiB0aGlzLndvcmtmbG93SWQsXG4gICAgICBvcGVyYXRpb246IHRoaXMud29ya2Zsb3dOYW1lLFxuICAgICAgc3RhdHVzOiAnY2FuY2VsbGVkJyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZHVyYXRpb25NczogZHVyYXRpb24sXG4gICAgICBkYXRhOiB7IHJlYXNvbiwgc3RlcENvdW50OiB0aGlzLnN0ZXBDb3VudCB9LFxuICAgICAgYWN0b3I6IHRoaXMuYWN0b3IsXG4gICAgICB0YWdzOiB7IC4uLnRoaXMudGFncywgd29ya2Zsb3c6IHRoaXMud29ya2Zsb3dOYW1lIH0sXG4gICAgICBtZXRyaWNzOiB7IGR1cmF0aW9uLCBzdGVwQ291bnQ6IHRoaXMuc3RlcENvdW50IH0sXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIE5vLW9wIHdvcmtmbG93IGZvciB3aGVuIGNvcnJlbGF0aW9uSWQgaXMgbm90IGF2YWlsYWJsZVxuICogSW1wbGVtZW50cyBJV29ya2Zsb3dPYnNlcnZlciBpbnRlcmZhY2UgcHJvcGVybHkgKG5vIHR5cGUgY2FzdHMpXG4gKiBcbiAqIFRyYWNrcyBzdGF0dXMgdG8gbWFpbnRhaW4gY29uc2lzdGVudCBiZWhhdmlvciB3aXRoIHJlYWwgV29ya2Zsb3dPYnNlcnZlclxuICovXG5jbGFzcyBOb09wV29ya2Zsb3dPYnNlcnZlciBpbXBsZW1lbnRzIElXb3JrZmxvd09ic2VydmVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSB3b3JrZmxvd05hbWU6IHN0cmluZztcbiAgcHJpdmF0ZSBzdGF0dXM6IFdvcmtmbG93U3RhdHVzID0gJ3J1bm5pbmcnO1xuXG4gIGNvbnN0cnVjdG9yKHdvcmtmbG93TmFtZTogc3RyaW5nKSB7XG4gICAgdGhpcy53b3JrZmxvd05hbWUgPSB3b3JrZmxvd05hbWU7XG4gICAgbG9nZ2VyLndhcm4oYE5vT3Agd29ya2Zsb3cgY3JlYXRlZCBmb3I6ICR7d29ya2Zsb3dOYW1lfWApO1xuICB9XG5cbiAgZ2V0IGlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuICdub29wJztcbiAgfVxuXG4gIGdldCB0cmFjZUlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuICdub29wJztcbiAgfVxuXG4gIGdldCBuYW1lKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMud29ya2Zsb3dOYW1lO1xuICB9XG5cbiAgZ2V0IGN1cnJlbnRTdGF0dXMoKTogV29ya2Zsb3dTdGF0dXMge1xuICAgIHJldHVybiB0aGlzLnN0YXR1cztcbiAgfVxuXG4gIGFzeW5jIHN0ZXA8VD4oXG4gICAgX3N0ZXBOYW1lOiBzdHJpbmcsXG4gICAgZm46ICgpID0+IFByb21pc2U8VD4sXG4gICAgX29wdGlvbnM6IFN0ZXBPcHRpb25zICYgeyBjb250aW51ZU9uRXJyb3I6IHRydWUgfVxuICApOiBQcm9taXNlPFQgfCB1bmRlZmluZWQ+O1xuICBhc3luYyBzdGVwPFQ+KFxuICAgIF9zdGVwTmFtZTogc3RyaW5nLFxuICAgIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICAgIF9vcHRpb25zPzogU3RlcE9wdGlvbnMgJiB7IGNvbnRpbnVlT25FcnJvcj86IGZhbHNlIH1cbiAgKTogUHJvbWlzZTxUPjtcbiAgYXN5bmMgc3RlcDxUPihfc3RlcE5hbWU6IHN0cmluZywgZm46ICgpID0+IFByb21pc2U8VD4sIG9wdGlvbnM/OiBTdGVwT3B0aW9ucyk6IFByb21pc2U8VCB8IHVuZGVmaW5lZD4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKG9wdGlvbnM/LmNvbnRpbnVlT25FcnJvcikge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgICAgdGhpcy5zdGF0dXMgPSAnZmFpbGVkJztcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIGNoZWNrcG9pbnQoX25hbWU6IHN0cmluZywgX3N0YXRlPzogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGRlY2lzaW9uKF9kZWNpc2lvbk5hbWU6IHN0cmluZywgX3Jlc3VsdDogdW5rbm93biwgX29wdGlvbnM/OiB7IHJlYXNvbmluZz86IHN0cmluZzsgcnVsZXM/OiB1bmtub3duW10gfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHBhdXNlKF9yZWFzb246IHN0cmluZywgX3Jlc3VtZURhdGE/OiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICB0aGlzLnN0YXR1cyA9ICdwYXVzZWQnO1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXN1bWUoX3Jlc3VtZUlucHV0PzogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgdGhpcy5zdGF0dXMgPSAncnVubmluZyc7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGV2ZW50KF9uYW1lOiBzdHJpbmcsIF9kYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb21wbGV0ZShfb3B0aW9ucz86IHsgcmVzdWx0PzogdW5rbm93bjsgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICB0aGlzLnN0YXR1cyA9ICdjb21wbGV0ZWQnO1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBmYWlsKF9lcnJvcjogRXJyb3IsIF9vcHRpb25zPzogeyBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRoaXMuc3RhdHVzID0gJ2ZhaWxlZCc7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNhbmNlbChfcmVhc29uPzogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICB0aGlzLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cbiJdfQ==