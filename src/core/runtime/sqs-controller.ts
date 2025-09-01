import { SQSEvent, Context } from "aws-lambda";
import { AbstractLambdaHandler } from "./abstract-lambda-handler";
import { AuditContext, QueueAuditContext, AuditConfig } from '../../audit/interfaces';
import { AuditCaptureService } from '../../audit/helpers/audit-helpers';
import { IQueueConfig } from '../../decorators/queue';

/**
 * Base class for handling SQS events.
 */
abstract class QueueController extends AbstractLambdaHandler {

  protected initialize(_event: SQSEvent, _context: Context): Promise<any> {
    return Promise.resolve();
  }

  abstract process(event: any, context: any): Promise<any>;

  /**
   * Creates audit context for the queue processing following the existing pattern
   * @param event - The SQS event
   * @param context - The Lambda context
   * @returns AuditContext or null if audit is disabled
   */
  protected makeAuditContext(event: SQSEvent, context: Context): AuditContext | null {
    const config = this.getQueueConfig();
    if (!config?.audit?.enabled) return null;
    
    const correlationId = this.extractCorrelationFromMessages(event) || context.awsRequestId;
    const operationName = this.getQueueName() || 'process_batch';
    const operationId = `${this.constructor.name}.${operationName}`;
    
    return {
      enabled: true,
      logType: 'event',
      subType: 'queue_processing',
      entityName: this.constructor.name,
      operation: operationName,
      category: config.audit.category,
      correlation: {
        correlationId,
        operationId,
        parentOperationId: this.extractParentOperationFromMessages(event) || undefined,
        operationType: 'queue',
        operationName,
        startTimestamp: new Date().toISOString()
      },
      auditConfig: config.audit
    };
  }

  /**
   * Applications override this to extract correlation from their message format
   */
  protected extractCorrelationFromMessages(event: SQSEvent): string | null {
    try {
      const firstMessage = JSON.parse(event.Records[0].body);
      return firstMessage.correlationId || null;
    } catch {
      return null;
    }
  }

  /**
   * Applications override this to extract parent operation from their message format
   */
  protected extractParentOperationFromMessages(event: SQSEvent): string | null {
    try {
      const firstMessage = JSON.parse(event.Records[0].body);
      return firstMessage.parentOperationId || null;
    } catch {
      return null;
    }
  }

  /**
   * Captures audit log for queue processing start
   */
  protected async captureStart(auditContext: AuditContext, queueContext: QueueAuditContext): Promise<void> {
    await AuditCaptureService.captureStart(auditContext, queueContext);
  }

  /**
   * Captures audit log for queue processing end (success or error)
   */
  protected async captureEnd(auditContext: AuditContext, _result: any, error: Error | null): Promise<void> {
    await AuditCaptureService.captureEnd(auditContext, _result, error);
  }

  /**
   * Gets the queue configuration
   */
  protected getQueueConfig(): IQueueConfig {
    return Reflect.get(this, 'queueConfig') || {};
  }

  /**
   * Gets the queue name
   */
  protected getQueueName(): string | undefined {
    return Reflect.get(this, 'queueName') as string | undefined;
  }

  /**
   * Lambda handler for the queue.
   * Handles incoming SQS events.
   * @param event - The event object from the SQS.
   * @param context - The context object from the SQS.
   * @returns The SQS response object.
   */
  async LambdaHandler(event: SQSEvent, context: Context): Promise<any> {
      this.logger.debug("SQS-LambdaHandler Received event:", JSON.stringify(event, null, 2));
      
      // Create audit context
      const auditContext = this.makeAuditContext(event, context);
      const queueContext: QueueAuditContext = {
        queueName: this.getQueueName(),
        batchSize: event.Records.length,
        messageIds: event.Records.map(r => r.messageId),
        approximateReceiveCount: parseInt(event.Records[0].attributes?.ApproximateReceiveCount || '1')
      };
      
      if (auditContext) {
        await this.captureStart(auditContext, queueContext);
      }
      
      try {
        // hook for the application to initialize it's state, Dependencies, config etc
        await this.initialize(event, context);
        // Execute the associated route function
        const result = await this.process(event, context);
        
        if (auditContext) {
          await this.captureEnd(auditContext, result, null);
        }
        
        return result;
      } catch (error) {
        if (auditContext) {
          await this.captureEnd(auditContext, null, error as Error);
        }
        throw error;
      }
  }
}

export { QueueController };