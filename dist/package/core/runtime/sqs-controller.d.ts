import { SQSEvent, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { AuditContext, QueueAuditContext } from '../../audit/interfaces';
import { IQueueConfig } from '../../decorators/queue';
/**
 * Base class for handling SQS events.
 */
declare abstract class QueueController extends AbstractLambdaHandler {
    protected initialize(_event: SQSEvent, _context: Context): Promise<any>;
    abstract process(event: any, context: any): Promise<any>;
    /**
     * Creates audit context for the queue processing following the existing pattern
     * @param event - The SQS event
     * @param context - The Lambda context
     * @returns AuditContext or null if audit is disabled
     */
    protected makeAuditContext(event: SQSEvent, context: Context): AuditContext | null;
    /**
     * Applications override this to extract correlation from their message format
     */
    protected extractCorrelationFromMessages(event: SQSEvent): string | null;
    /**
     * Applications override this to extract parent operation from their message format
     */
    protected extractParentOperationFromMessages(event: SQSEvent): string | null;
    /**
     * Captures audit log for queue processing start
     */
    protected captureStart(auditContext: AuditContext, queueContext: QueueAuditContext): Promise<void>;
    /**
     * Captures audit log for queue processing end (success or error)
     */
    protected captureEnd(auditContext: AuditContext, _result: any, error: Error | null): Promise<void>;
    /**
     * Gets the queue configuration
     */
    protected getQueueConfig(): IQueueConfig;
    /**
     * Gets the queue name
     */
    protected getQueueName(): string | undefined;
    /**
     * Lambda handler for the queue.
     * Handles incoming SQS events.
     * @param event - The event object from the SQS.
     * @param context - The context object from the SQS.
     * @returns The SQS response object.
     */
    LambdaHandler(event: SQSEvent, context: Context): Promise<any>;
}
export { QueueController };
