"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const audit_helpers_1 = require("../../audit/helpers/audit-helpers");
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
            return result;
        }
        catch (error) {
            if (auditContext) {
                await this.captureEnd(auditContext, null, error);
            }
            throw error;
        }
    }
}
exports.QueueController = QueueController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSxxRUFBd0U7QUFHeEU7O0dBRUc7QUFDSCxNQUFlLGVBQWdCLFNBQVEsK0NBQXFCO0lBRWhELFVBQVUsQ0FBQyxNQUFnQixFQUFFLFFBQWlCO1FBQ3RELE9BQU8sT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFJRDs7Ozs7T0FLRztJQUNPLGdCQUFnQixDQUFDLEtBQWUsRUFBRSxPQUFnQjtRQUMxRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7UUFDckMsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFDO1FBRXpDLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxLQUFLLENBQUMsSUFBSSxPQUFPLENBQUMsWUFBWSxDQUFDO1FBQ3pGLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxZQUFZLEVBQUUsSUFBSSxlQUFlLENBQUM7UUFDN0QsTUFBTSxXQUFXLEdBQUcsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSxhQUFhLEVBQUUsQ0FBQztRQUVoRSxPQUFPO1lBQ0wsT0FBTyxFQUFFLElBQUk7WUFDYixPQUFPLEVBQUUsT0FBTztZQUNoQixPQUFPLEVBQUUsa0JBQWtCO1lBQzNCLFVBQVUsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUk7WUFDakMsU0FBUyxFQUFFLGFBQWE7WUFDeEIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUMvQixXQUFXLEVBQUU7Z0JBQ1gsYUFBYTtnQkFDYixXQUFXO2dCQUNYLGlCQUFpQixFQUFFLElBQUksQ0FBQyxrQ0FBa0MsQ0FB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T0FBTyxDQUFDLENBQUM7WUFDdEMsd0NBQXdDO1lBQ3hDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFbEQsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDcEQsQ0FBQztZQUVELE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsS0FBYyxDQUFDLENBQUM7WUFDNUQsQ0FBQztZQUNELE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQUVRLDBDQUFlIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1FTRXZlbnQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgUXVldWVBdWRpdENvbnRleHQgfSBmcm9tICcuLi8uLi9hdWRpdC9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0Q2FwdHVyZVNlcnZpY2UgfSBmcm9tICcuLi8uLi9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMnO1xuaW1wb3J0IHsgSVF1ZXVlQ29uZmlnIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycy9xdWV1ZSc7XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU1FTIGV2ZW50cy5cbiAqL1xuYWJzdHJhY3QgY2xhc3MgUXVldWVDb250cm9sbGVyIGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcblxuICBwcm90ZWN0ZWQgaW5pdGlhbGl6ZShfZXZlbnQ6IFNRU0V2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgYWJzdHJhY3QgcHJvY2VzcyhldmVudDogYW55LCBjb250ZXh0OiBhbnkpOiBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYXVkaXQgY29udGV4dCBmb3IgdGhlIHF1ZXVlIHByb2Nlc3NpbmcgZm9sbG93aW5nIHRoZSBleGlzdGluZyBwYXR0ZXJuXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBTUVMgZXZlbnRcbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgTGFtYmRhIGNvbnRleHRcbiAgICogQHJldHVybnMgQXVkaXRDb250ZXh0IG9yIG51bGwgaWYgYXVkaXQgaXMgZGlzYWJsZWRcbiAgICovXG4gIHByb3RlY3RlZCBtYWtlQXVkaXRDb250ZXh0KGV2ZW50OiBTUVNFdmVudCwgY29udGV4dDogQ29udGV4dCk6IEF1ZGl0Q29udGV4dCB8IG51bGwge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0UXVldWVDb25maWcoKTtcbiAgICBpZiAoIWNvbmZpZz8uYXVkaXQ/LmVuYWJsZWQpIHJldHVybiBudWxsO1xuICAgIFxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB0aGlzLmV4dHJhY3RDb3JyZWxhdGlvbkZyb21NZXNzYWdlcyhldmVudCkgfHwgY29udGV4dC5hd3NSZXF1ZXN0SWQ7XG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IHRoaXMuZ2V0UXVldWVOYW1lKCkgfHwgJ3Byb2Nlc3NfYmF0Y2gnO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke29wZXJhdGlvbk5hbWV9YDtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIGxvZ1R5cGU6ICdldmVudCcsXG4gICAgICBzdWJUeXBlOiAncXVldWVfcHJvY2Vzc2luZycsXG4gICAgICBlbnRpdHlOYW1lOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBvcGVyYXRpb246IG9wZXJhdGlvbk5hbWUsXG4gICAgICBjYXRlZ29yeTogY29uZmlnLmF1ZGl0LmNhdGVnb3J5LFxuICAgICAgY29ycmVsYXRpb246IHtcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQsXG4gICAgICAgIHBhcmVudE9wZXJhdGlvbklkOiB0aGlzLmV4dHJhY3RQYXJlbnRPcGVyYXRpb25Gcm9tTWVzc2FnZXMoZXZlbnQpIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgb3BlcmF0aW9uVHlwZTogJ3F1ZXVlJyxcbiAgICAgICAgb3BlcmF0aW9uTmFtZSxcbiAgICAgICAgc3RhcnRUaW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSxcbiAgICAgIGF1ZGl0Q29uZmlnOiBjb25maWcuYXVkaXRcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpY2F0aW9ucyBvdmVycmlkZSB0aGlzIHRvIGV4dHJhY3QgY29ycmVsYXRpb24gZnJvbSB0aGVpciBtZXNzYWdlIGZvcm1hdFxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RDb3JyZWxhdGlvbkZyb21NZXNzYWdlcyhldmVudDogU1FTRXZlbnQpOiBzdHJpbmcgfCBudWxsIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlyc3RNZXNzYWdlID0gSlNPTi5wYXJzZShldmVudC5SZWNvcmRzWzBdLmJvZHkpO1xuICAgICAgcmV0dXJuIGZpcnN0TWVzc2FnZS5jb3JyZWxhdGlvbklkIHx8IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGljYXRpb25zIG92ZXJyaWRlIHRoaXMgdG8gZXh0cmFjdCBwYXJlbnQgb3BlcmF0aW9uIGZyb20gdGhlaXIgbWVzc2FnZSBmb3JtYXRcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0UGFyZW50T3BlcmF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50OiBTUVNFdmVudCk6IHN0cmluZyB8IG51bGwge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaXJzdE1lc3NhZ2UgPSBKU09OLnBhcnNlKGV2ZW50LlJlY29yZHNbMF0uYm9keSk7XG4gICAgICByZXR1cm4gZmlyc3RNZXNzYWdlLnBhcmVudE9wZXJhdGlvbklkIHx8IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciBxdWV1ZSBwcm9jZXNzaW5nIHN0YXJ0XG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCBxdWV1ZUNvbnRleHQ6IFF1ZXVlQXVkaXRDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCBxdWV1ZUNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgcXVldWUgcHJvY2Vzc2luZyBlbmQgKHN1Y2Nlc3Mgb3IgZXJyb3IpXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUVuZChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgX3Jlc3VsdDogYW55LCBlcnJvcjogRXJyb3IgfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgX3Jlc3VsdCwgZXJyb3IpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHF1ZXVlIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRRdWV1ZUNvbmZpZygpOiBJUXVldWVDb25maWcge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAncXVldWVDb25maWcnKSB8fCB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBxdWV1ZSBuYW1lXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0UXVldWVOYW1lKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZU5hbWUnKSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBxdWV1ZS5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBTUVMgZXZlbnRzLlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIFNRUy5cbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgU1FTLlxuICAgKiBAcmV0dXJucyBUaGUgU1FTIHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IFNRU0V2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxhbnk+IHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTLUxhbWJkYUhhbmRsZXIgUmVjZWl2ZWQgZXZlbnQ6XCIsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG4gICAgICBcbiAgICAgIC8vIENyZWF0ZSBhdWRpdCBjb250ZXh0XG4gICAgICBjb25zdCBhdWRpdENvbnRleHQgPSB0aGlzLm1ha2VBdWRpdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgY29uc3QgcXVldWVDb250ZXh0OiBRdWV1ZUF1ZGl0Q29udGV4dCA9IHtcbiAgICAgICAgcXVldWVOYW1lOiB0aGlzLmdldFF1ZXVlTmFtZSgpLFxuICAgICAgICBiYXRjaFNpemU6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgICBtZXNzYWdlSWRzOiBldmVudC5SZWNvcmRzLm1hcChyID0+IHIubWVzc2FnZUlkKSxcbiAgICAgICAgYXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6IHBhcnNlSW50KGV2ZW50LlJlY29yZHNbMF0uYXR0cmlidXRlcz8uQXBwcm94aW1hdGVSZWNlaXZlQ291bnQgfHwgJzEnKVxuICAgICAgfTtcbiAgICAgIFxuICAgICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTdGFydChhdWRpdENvbnRleHQsIHF1ZXVlQ29udGV4dCk7XG4gICAgICB9XG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIGhvb2sgZm9yIHRoZSBhcHBsaWNhdGlvbiB0byBpbml0aWFsaXplIGl0J3Mgc3RhdGUsIERlcGVuZGVuY2llcywgY29uZmlnIGV0Y1xuICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgICAvLyBFeGVjdXRlIHRoZSBhc3NvY2lhdGVkIHJvdXRlIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2VzcyhldmVudCwgY29udGV4dCk7XG4gICAgICAgIFxuICAgICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgcmVzdWx0LCBudWxsKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVFbmQoYXVkaXRDb250ZXh0LCBudWxsLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gIH1cbn1cblxuZXhwb3J0IHsgUXVldWVDb250cm9sbGVyIH07Il19