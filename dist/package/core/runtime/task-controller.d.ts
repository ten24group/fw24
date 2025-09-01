import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { AuditContext, TaskAuditContext } from '../../audit/interfaces';
import { ITaskConfig } from '../../decorators/task';
/**
 * Base class for handling Schedule Tasks.
 */
declare abstract class TaskController extends AbstractLambdaHandler {
    protected initialize(): Promise<any>;
    abstract process(): Promise<any>;
    /**
     * Creates audit context for the task execution following the existing pattern
     * @returns AuditContext or null if audit is disabled
     */
    protected makeAuditContext(): AuditContext | null;
    /**
     * Captures audit log for task execution start
     */
    protected captureStart(auditContext: AuditContext, taskContext: TaskAuditContext): Promise<void>;
    /**
     * Captures audit log for task execution end (success or error)
     */
    protected captureEnd(auditContext: AuditContext, _result: any, error: Error | null): Promise<void>;
    /**
     * Gets the task configuration
     */
    protected getTaskConfig(): ITaskConfig;
    /**
     * Gets the task name
     */
    protected getTaskName(): string | undefined;
    /**
     * Lambda handler for the task.
     */
    LambdaHandler(): Promise<any>;
}
export { TaskController };
