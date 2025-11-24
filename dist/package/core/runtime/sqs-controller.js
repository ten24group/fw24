"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const audit_helpers_1 = require("../../audit/helpers/audit-helpers");
const observability_1 = require("../../observability");
/**
 * Base class for handling SQS events.
 */
class QueueController extends abstract_lambda_handler_1.AbstractLambdaHandler {
    initialize(_event, _context) {
        return Promise.resolve();
    }
    /**
     * Creates audit context for the queue processing following the existing pattern
     * @param event - The SQS event
     * @param context - The Lambda context
     * @returns AuditContext or null if audit is disabled
     */
    makeAuditContext(event, context) {
        const config = this.getQueueConfig();
        if (!config?.audit?.enabled)
            return null;
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
    extractCorrelationFromMessages(event) {
        try {
            const firstMessage = JSON.parse(event.Records[0].body);
            return firstMessage.correlationId || null;
        }
        catch {
            return null;
        }
    }
    /**
     * Applications override this to extract parent operation from their message format
     */
    extractParentOperationFromMessages(event) {
        try {
            const firstMessage = JSON.parse(event.Records[0].body);
            return firstMessage.parentOperationId || null;
        }
        catch {
            return null;
        }
    }
    /**
     * Captures audit log for queue processing start
     */
    async captureStart(auditContext, queueContext) {
        await audit_helpers_1.AuditCaptureService.captureStart(auditContext, queueContext);
    }
    /**
     * Captures audit log for queue processing end (success or error)
     */
    async captureEnd(auditContext, _result, error) {
        await audit_helpers_1.AuditCaptureService.captureEnd(auditContext, _result, error);
    }
    /**
     * Gets the queue configuration
     */
    getQueueConfig() {
        return Reflect.get(this, 'queueConfig') || {};
    }
    /**
     * Gets the queue name
     */
    getQueueName() {
        return Reflect.get(this, 'queueName');
    }
    /**
     * Lambda handler for the queue.
     * Handles incoming SQS events.
     * @param event - The event object from the SQS.
     * @param context - The context object from the SQS.
     * @returns The SQS response object.
     */
    async LambdaHandler(event, context) {
        this.logger.debug("SQS-LambdaHandler Received event:", JSON.stringify(event, null, 2));
        observability_1.ObservabilityManager.initializeInvocation();
        const queueName = this.getQueueName() || this.constructor.name;
        const messageAttributes = event.Records?.[0]?.messageAttributes || {};
        const traceContext = (0, observability_1.extractTraceContextFromSqs)(messageAttributes);
        const queueSpan = new observability_1.Span(`SQS ${queueName}`, {
            traceId: traceContext.traceId,
            parentSpanId: traceContext.parentSpanId,
            attributes: {
                'sqs.batchSize': event.Records.length,
            },
        });
        let spanEnded = false;
        const finalizeObservability = async (success, error) => {
            if (!spanEnded) {
                await queueSpan.end({ success, error });
                spanEnded = true;
            }
            await observability_1.ObservabilityManager.flush();
        };
        // Create audit context
        const auditContext = this.makeAuditContext(event, context);
        const queueContext = {
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
            await finalizeObservability(true);
            return result;
        }
        catch (error) {
            if (auditContext) {
                await this.captureEnd(auditContext, null, error);
            }
            await finalizeObservability(false, error);
            throw error;
        }
    }
}
exports.QueueController = QueueController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSxxRUFBd0U7QUFFeEUsdURBQTZGO0FBRTdGOztHQUVHO0FBQ0gsTUFBZSxlQUFnQixTQUFRLCtDQUFxQjtJQUVoRCxVQUFVLENBQUMsTUFBZ0IsRUFBRSxRQUFpQjtRQUN0RCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBSUQ7Ozs7O09BS0c7SUFDTyxnQkFBZ0IsQ0FBQyxLQUFlLEVBQUUsT0FBZ0I7UUFDMUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQztRQUV6QyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsS0FBSyxDQUFDLElBQUksT0FBTyxDQUFDLFlBQVksQ0FBQztRQUN6RixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLElBQUksZUFBZSxDQUFDO1FBQzdELE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksYUFBYSxFQUFFLENBQUM7UUFFaEUsT0FBTztZQUNMLE9BQU8sRUFBRSxJQUFJO1lBQ2IsT0FBTyxFQUFFLE9BQU87WUFDaEIsT0FBTyxFQUFFLGtCQUFrQjtZQUMzQixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJO1lBQ2pDLFNBQVMsRUFBRSxhQUFhO1lBQ3hCLFFBQVEsRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLFFBQVE7WUFDL0IsV0FBVyxFQUFFO2dCQUNYLGFBQWE7Z0JBQ2IsV0FBVztnQkFDWCxpQkFBaUIsRUFBRSxJQUFJLENB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QUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNwRCxDQUFDO1lBRUQsTUFBTSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNsQyxPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsSUFBSSxFQUFFLEtBQWMsQ0FBQyxDQUFDO1lBQzVELENBQUM7WUFDRCxNQUFNLHFCQUFxQixDQUFDLEtBQUssRUFBRSxLQUFjLENBQUMsQ0FBQztZQUNuRCxNQUFNLEtBQUssQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFUSwwQ0FBZSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBBdWRpdENvbnRleHQsIFF1ZXVlQXVkaXRDb250ZXh0IH0gZnJvbSAnLi4vLi4vYXVkaXQvaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBBdWRpdENhcHR1cmVTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vYXVkaXQvaGVscGVycy9hdWRpdC1oZWxwZXJzJztcbmltcG9ydCB7IElRdWV1ZUNvbmZpZyB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMvcXVldWUnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIsIFNwYW4sIGV4dHJhY3RUcmFjZUNvbnRleHRGcm9tU3FzIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU1FTIGV2ZW50cy5cbiAqL1xuYWJzdHJhY3QgY2xhc3MgUXVldWVDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcblxuICBwcm90ZWN0ZWQgaW5pdGlhbGl6ZShfZXZlbnQ6IFNRU0V2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgYWJzdHJhY3QgcHJvY2VzcyhldmVudDogYW55LCBjb250ZXh0OiBhbnkpOiBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYXVkaXQgY29udGV4dCBmb3IgdGhlIHF1ZXVlIHByb2Nlc3NpbmcgZm9sbG93aW5nIHRoZSBleGlzdGluZyBwYXR0ZXJuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBTUVMgZXZlbnRcbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgTGFtYmRhIGNvbnRleHRcbiAgICogQHJldHVybnMgQXVkaXRDb250ZXh0IG9yIG51bGwgaWYgYXVkaXQgaXMgZGlzYWJsZWRcbiAgICovXG4gIHByb3RlY3RlZCBtYWtlQXVkaXRDb250ZXh0KGV2ZW50OiBTUVNFdmVudCwgY29udGV4dDogQ29udGV4dCk6IEF1ZGl0Q29udGV4dCB8IG51bGwge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0UXVldWVDb25maWcoKTtcbiAgICBpZiAoIWNvbmZpZz8uYXVkaXQ/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHRoaXMuZXh0cmFjdENvcnJlbGF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50KSB8fCBjb250ZXh0LmF3c1JlcXVlc3RJZDtcbiAgICBjb25zdCBvcGVyYXRpb25OYW1lID0gdGhpcy5nZXRRdWV1ZU5hbWUoKSB8fCAncHJvY2Vzc19iYXRjaCc7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiR7b3BlcmF0aW9uTmFtZX1gO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBsb2dUeXBlOiAnZXZlbnQnLFxuICAgICAgc3ViVHlwZTogJ3F1ZXVlX3Byb2Nlc3NpbmcnLFxuICAgICAgZW50aXR5TmFtZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgb3BlcmF0aW9uOiBvcGVyYXRpb25OYW1lLFxuICAgICAgY2F0ZWdvcnk6IGNvbmZpZy5hdWRpdC5jYXRlZ29yeSxcbiAgICAgIGNvcnJlbGF0aW9uOiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgIG9wZXJhdGlvbklkLFxuICAgICAgICBwYXJlbnRPcGVyYXRpb25JZDogdGhpcy5leHRyYWN0UGFyZW50T3BlcmF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50KSB8fCB1bmRlZmluZWQsXG4gICAgICAgIG9wZXJhdGlvblR5cGU6ICdxdWV1ZScsXG4gICAgICAgIG9wZXJhdGlvbk5hbWUsXG4gICAgICAgIHN0YXJ0VGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0sXG4gICAgICBhdWRpdENvbmZpZzogY29uZmlnLmF1ZGl0XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWNhdGlvbnMgb3ZlcnJpZGUgdGhpcyB0byBleHRyYWN0IGNvcnJlbGF0aW9uIGZyb20gdGhlaXIgbWVzc2FnZSBmb3JtYXRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0Q29ycmVsYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQ6IFNRU0V2ZW50KTogc3RyaW5nIHwgbnVsbCB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZpcnN0TWVzc2FnZSA9IEpTT04ucGFyc2UoZXZlbnQuUmVjb3Jkc1sgMCBdLmJvZHkpO1xuICAgICAgcmV0dXJuIGZpcnN0TWVzc2FnZS5jb3JyZWxhdGlvbklkIHx8IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGljYXRpb25zIG92ZXJyaWRlIHRoaXMgdG8gZXh0cmFjdCBwYXJlbnQgb3BlcmF0aW9uIGZyb20gdGhlaXIgbWVzc2FnZSBmb3JtYXRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0UGFyZW50T3BlcmF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50OiBTUVNFdmVudCk6IHN0cmluZyB8IG51bGwge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaXJzdE1lc3NhZ2UgPSBKU09OLnBhcnNlKGV2ZW50LlJlY29yZHNbIDAgXS5ib2R5KTtcbiAgICAgIHJldHVybiBmaXJzdE1lc3NhZ2UucGFyZW50T3BlcmF0aW9uSWQgfHwgbnVsbDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhdWRpdCBsb2cgZm9yIHF1ZXVlIHByb2Nlc3Npbmcgc3RhcnRcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBjYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0OiBBdWRpdENvbnRleHQsIHF1ZXVlQ29udGV4dDogUXVldWVBdWRpdENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHF1ZXVlQ29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciBxdWV1ZSBwcm9jZXNzaW5nIGVuZCAoc3VjY2VzcyBvciBlcnJvcilcbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBjYXB0dXJlRW5kKGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCBfcmVzdWx0OiBhbnksIGVycm9yOiBFcnJvciB8IG51bGwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBBdWRpdENhcHR1cmVTZXJ2aWNlLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBfcmVzdWx0LCBlcnJvcik7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgcXVldWUgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIGdldFF1ZXVlQ29uZmlnKCk6IElRdWV1ZUNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZUNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHF1ZXVlIG5hbWVcbiAgICovXG4gIHByb3RlY3RlZCBnZXRRdWV1ZU5hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3F1ZXVlTmFtZScpIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYW1iZGEgaGFuZGxlciBmb3IgdGhlIHF1ZXVlLlxuICAgKiBIYW5kbGVzIGluY29taW5nIFNRUyBldmVudHMuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudCBvYmplY3QgZnJvbSB0aGUgU1FTLlxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBjb250ZXh0IG9iamVjdCBmcm9tIHRoZSBTUVMuXG4gICAqIEByZXR1cm5zIFRoZSBTUVMgcmVzcG9uc2Ugb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogU1FTRXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPGFueT4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTLUxhbWJkYUhhbmRsZXIgUmVjZWl2ZWQgZXZlbnQ6XCIsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgICBjb25zdCBxdWV1ZU5hbWUgPSB0aGlzLmdldFF1ZXVlTmFtZSgpIHx8IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXNzYWdlQXR0cmlidXRlcyA9IGV2ZW50LlJlY29yZHM/LlsgMCBdPy5tZXNzYWdlQXR0cmlidXRlcyB8fCB7fTtcbiAgICBjb25zdCB0cmFjZUNvbnRleHQgPSBleHRyYWN0VHJhY2VDb250ZXh0RnJvbVNxcyhtZXNzYWdlQXR0cmlidXRlcyk7XG4gICAgY29uc3QgcXVldWVTcGFuID0gbmV3IFNwYW4oYFNRUyAke3F1ZXVlTmFtZX1gLCB7XG4gICAgICB0cmFjZUlkOiB0cmFjZUNvbnRleHQudHJhY2VJZCxcbiAgICAgIHBhcmVudFNwYW5JZDogdHJhY2VDb250ZXh0LnBhcmVudFNwYW5JZCxcbiAgICAgIFxuICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAnc3FzLmJhdGNoU2l6ZSc6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBsZXQgc3BhbkVuZGVkID0gZmFsc2U7XG4gICAgY29uc3QgZmluYWxpemVPYnNlcnZhYmlsaXR5ID0gYXN5bmMgKHN1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogRXJyb3IpID0+IHtcbiAgICAgIGlmICghc3BhbkVuZGVkKSB7XG4gICAgICAgIGF3YWl0IHF1ZXVlU3Bhbi5lbmQoeyBzdWNjZXNzLCBlcnJvciB9KTtcbiAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSBhdWRpdCBjb250ZXh0XG4gICAgY29uc3QgYXVkaXRDb250ZXh0ID0gdGhpcy5tYWtlQXVkaXRDb250ZXh0KGV2ZW50LCBjb250ZXh0KTtcbiAgICBjb25zdCBxdWV1ZUNvbnRleHQ6IFF1ZXVlQXVkaXRDb250ZXh0ID0ge1xuICAgICAgcXVldWVOYW1lOiB0aGlzLmdldFF1ZXVlTmFtZSgpLFxuICAgICAgYmF0Y2hTaXplOiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgICAgIG1lc3NhZ2VJZHM6IGV2ZW50LlJlY29yZHMubWFwKHIgPT4gci5tZXNzYWdlSWQpLFxuICAgICAgYXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6IHBhcnNlSW50KGV2ZW50LlJlY29yZHNbIDAgXS5hdHRyaWJ1dGVzPy5BcHByb3hpbWF0ZVJlY2VpdmVDb3VudCB8fCAnMScpXG4gICAgfTtcblxuICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dCwgcXVldWVDb250ZXh0KTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gaG9vayBmb3IgdGhlIGFwcGxpY2F0aW9uIHRvIGluaXRpYWxpemUgaXQncyBzdGF0ZSwgRGVwZW5kZW5jaWVzLCBjb25maWcgZXRjXG4gICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgLy8gRXhlY3V0ZSB0aGUgYXNzb2NpYXRlZCByb3V0ZSBmdW5jdGlvblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzKGV2ZW50LCBjb250ZXh0KTtcblxuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCByZXN1bHQsIG51bGwpO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkodHJ1ZSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIG51bGwsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgIH1cbiAgICAgIGF3YWl0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eShmYWxzZSwgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCB7IFF1ZXVlQ29udHJvbGxlciB9O1xuIl19