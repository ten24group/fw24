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
        const correlationId = traceContext?.correlationId || context.awsRequestId || crypto.randomUUID();
        const queueSpan = observability_1.SpanObserver.start(`SQS ${queueName}`, {
            correlationId,
            parentSpanId: traceContext?.parentLogId,
            attributes: {
                'sqs.batchSize': event.Records.length,
            },
        });
        let spanEnded = false;
        const finalizeObservability = async (success, error) => {
            if (!spanEnded) {
                queueSpan.end({ success, error });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSxxRUFBd0U7QUFFeEUsdURBQXFHO0FBRXJHOztHQUVHO0FBQ0gsTUFBZSxlQUFnQixTQUFRLCtDQUFxQjtJQUVoRCxVQUFVLENBQUMsTUFBZ0IsRUFBRSxRQUFpQjtRQUN0RCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBSUQ7Ozs7O09BS0c7SUFDTyxnQkFBZ0IsQ0FBQyxLQUFlLEVBQUUsT0FBZ0I7UUFDMUQsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLElBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU87WUFBRSxPQUFPLElBQUksQ0FBQztRQUV6QyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsOEJBQThCLENBQUMsS0FBSyxDQUFDLElBQUksT0FBTyxDQUFDLFlBQVksQ0FBQztRQUN6RixNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLElBQUksZUFBZSxDQUFDO1FBQzdELE1BQU0sV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksYUFBYSxFQUFFLENBQUM7UUFFaEUsT0FBTztZQUNMLE9BQU8sRUFBRSxJQUFJO1lBQ2IsT0FBTyxFQUFFLE9BQU87WUFDaEIsT0FBTyxFQUFFLGtCQUFrQjtZQUMzQixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJO1lBQ2pDLFNBQVMsRUFBRSxhQUFhO1lBQ3hCLFFBQVEsRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLFFBQVE7WUFDL0IsV0FBVyxFQUFFO2dCQUNYLGFBQWE7Z0JBQ2IsV0FBVztnQkFDWCxpQkFBaUIsRUFBRSxJQUFJLENB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O1lBRWxELElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ3BELENBQUM7WUFFRCxNQUFNLHFCQUFxQixDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2xDLE9BQU8sTUFBTSxDQUFDO1FBQ2hCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsS0FBYyxDQUFDLENBQUM7WUFDNUQsQ0FBQztZQUNELE1BQU0scUJBQXFCLENBQUMsS0FBSyxFQUFFLEtBQWMsQ0FBQyxDQUFDO1lBQ25ELE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVRLDBDQUFlIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU1FTRXZlbnQsIENvbnRleHQgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcbmltcG9ydCB7IEF1ZGl0Q29udGV4dCwgUXVldWVBdWRpdENvbnRleHQgfSBmcm9tICcuLi8uLi9hdWRpdC9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEF1ZGl0Q2FwdHVyZVNlcnZpY2UgfSBmcm9tICcuLi8uLi9hdWRpdC9oZWxwZXJzL2F1ZGl0LWhlbHBlcnMnO1xuaW1wb3J0IHsgSVF1ZXVlQ29uZmlnIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycy9xdWV1ZSc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciwgU3Bhbk9ic2VydmVyLCBleHRyYWN0VHJhY2VDb250ZXh0RnJvbVNxcyB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIFNRUyBldmVudHMuXG4gKi9cbmFic3RyYWN0IGNsYXNzIFF1ZXVlQ29udHJvbGxlciBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGluaXRpYWxpemUoX2V2ZW50OiBTUVNFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIGFic3RyYWN0IHByb2Nlc3MoZXZlbnQ6IGFueSwgY29udGV4dDogYW55KTogUHJvbWlzZTxhbnk+O1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGF1ZGl0IGNvbnRleHQgZm9yIHRoZSBxdWV1ZSBwcm9jZXNzaW5nIGZvbGxvd2luZyB0aGUgZXhpc3RpbmcgcGF0dGVyblxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgU1FTIGV2ZW50XG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIExhbWJkYSBjb250ZXh0XG4gICAqIEByZXR1cm5zIEF1ZGl0Q29udGV4dCBvciBudWxsIGlmIGF1ZGl0IGlzIGRpc2FibGVkXG4gICAqL1xuICBwcm90ZWN0ZWQgbWFrZUF1ZGl0Q29udGV4dChldmVudDogU1FTRXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBBdWRpdENvbnRleHQgfCBudWxsIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmdldFF1ZXVlQ29uZmlnKCk7XG4gICAgaWYgKCFjb25maWc/LmF1ZGl0Py5lbmFibGVkKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB0aGlzLmV4dHJhY3RDb3JyZWxhdGlvbkZyb21NZXNzYWdlcyhldmVudCkgfHwgY29udGV4dC5hd3NSZXF1ZXN0SWQ7XG4gICAgY29uc3Qgb3BlcmF0aW9uTmFtZSA9IHRoaXMuZ2V0UXVldWVOYW1lKCkgfHwgJ3Byb2Nlc3NfYmF0Y2gnO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4ke29wZXJhdGlvbk5hbWV9YDtcblxuICAgIHJldHVybiB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbG9nVHlwZTogJ2V2ZW50JyxcbiAgICAgIHN1YlR5cGU6ICdxdWV1ZV9wcm9jZXNzaW5nJyxcbiAgICAgIGVudGl0eU5hbWU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIG9wZXJhdGlvbjogb3BlcmF0aW9uTmFtZSxcbiAgICAgIGNhdGVnb3J5OiBjb25maWcuYXVkaXQuY2F0ZWdvcnksXG4gICAgICBjb3JyZWxhdGlvbjoge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBvcGVyYXRpb25JZCxcbiAgICAgICAgcGFyZW50T3BlcmF0aW9uSWQ6IHRoaXMuZXh0cmFjdFBhcmVudE9wZXJhdGlvbkZyb21NZXNzYWdlcyhldmVudCkgfHwgdW5kZWZpbmVkLFxuICAgICAgICBvcGVyYXRpb25UeXBlOiAncXVldWUnLFxuICAgICAgICBvcGVyYXRpb25OYW1lLFxuICAgICAgICBzdGFydFRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9LFxuICAgICAgYXVkaXRDb25maWc6IGNvbmZpZy5hdWRpdFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQXBwbGljYXRpb25zIG92ZXJyaWRlIHRoaXMgdG8gZXh0cmFjdCBjb3JyZWxhdGlvbiBmcm9tIHRoZWlyIG1lc3NhZ2UgZm9ybWF0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdENvcnJlbGF0aW9uRnJvbU1lc3NhZ2VzKGV2ZW50OiBTUVNFdmVudCk6IHN0cmluZyB8IG51bGwge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaXJzdE1lc3NhZ2UgPSBKU09OLnBhcnNlKGV2ZW50LlJlY29yZHNbIDAgXS5ib2R5KTtcbiAgICAgIHJldHVybiBmaXJzdE1lc3NhZ2UuY29ycmVsYXRpb25JZCB8fCBudWxsO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpY2F0aW9ucyBvdmVycmlkZSB0aGlzIHRvIGV4dHJhY3QgcGFyZW50IG9wZXJhdGlvbiBmcm9tIHRoZWlyIG1lc3NhZ2UgZm9ybWF0XG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdFBhcmVudE9wZXJhdGlvbkZyb21NZXNzYWdlcyhldmVudDogU1FTRXZlbnQpOiBzdHJpbmcgfCBudWxsIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlyc3RNZXNzYWdlID0gSlNPTi5wYXJzZShldmVudC5SZWNvcmRzWyAwIF0uYm9keSk7XG4gICAgICByZXR1cm4gZmlyc3RNZXNzYWdlLnBhcmVudE9wZXJhdGlvbklkIHx8IG51bGw7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYXVkaXQgbG9nIGZvciBxdWV1ZSBwcm9jZXNzaW5nIHN0YXJ0XG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZVN0YXJ0KGF1ZGl0Q29udGV4dDogQXVkaXRDb250ZXh0LCBxdWV1ZUNvbnRleHQ6IFF1ZXVlQXVkaXRDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCBxdWV1ZUNvbnRleHQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGF1ZGl0IGxvZyBmb3IgcXVldWUgcHJvY2Vzc2luZyBlbmQgKHN1Y2Nlc3Mgb3IgZXJyb3IpXG4gICAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgY2FwdHVyZUVuZChhdWRpdENvbnRleHQ6IEF1ZGl0Q29udGV4dCwgX3Jlc3VsdDogYW55LCBlcnJvcjogRXJyb3IgfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgQXVkaXRDYXB0dXJlU2VydmljZS5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgX3Jlc3VsdCwgZXJyb3IpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHF1ZXVlIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCBnZXRRdWV1ZUNvbmZpZygpOiBJUXVldWVDb25maWcge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAncXVldWVDb25maWcnKSB8fCB7fTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBxdWV1ZSBuYW1lXG4gICAqL1xuICBwcm90ZWN0ZWQgZ2V0UXVldWVOYW1lKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZU5hbWUnKSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogTGFtYmRhIGhhbmRsZXIgZm9yIHRoZSBxdWV1ZS5cbiAgICogSGFuZGxlcyBpbmNvbWluZyBTUVMgZXZlbnRzLlxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnQgb2JqZWN0IGZyb20gdGhlIFNRUy5cbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgY29udGV4dCBvYmplY3QgZnJvbSB0aGUgU1FTLlxuICAgKiBAcmV0dXJucyBUaGUgU1FTIHJlc3BvbnNlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IFNRU0V2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUy1MYW1iZGFIYW5kbGVyIFJlY2VpdmVkIGV2ZW50OlwiLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gICAgY29uc3QgcXVldWVOYW1lID0gdGhpcy5nZXRRdWV1ZU5hbWUoKSB8fCB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgbWVzc2FnZUF0dHJpYnV0ZXMgPSBldmVudC5SZWNvcmRzPy5bIDAgXT8ubWVzc2FnZUF0dHJpYnV0ZXMgfHwge307XG4gICAgY29uc3QgdHJhY2VDb250ZXh0ID0gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21TcXMobWVzc2FnZUF0dHJpYnV0ZXMpO1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB0cmFjZUNvbnRleHQ/LmNvcnJlbGF0aW9uSWQgfHwgY29udGV4dC5hd3NSZXF1ZXN0SWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKTtcbiAgICBjb25zdCBxdWV1ZVNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoYFNRUyAke3F1ZXVlTmFtZX1gLCB7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgcGFyZW50U3BhbklkOiB0cmFjZUNvbnRleHQ/LnBhcmVudExvZ0lkLFxuICAgICAgXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICdzcXMuYmF0Y2hTaXplJzogZXZlbnQuUmVjb3Jkcy5sZW5ndGgsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGxldCBzcGFuRW5kZWQgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5hbGl6ZU9ic2VydmFiaWxpdHkgPSBhc3luYyAoc3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBFcnJvcikgPT4ge1xuICAgICAgaWYgKCFzcGFuRW5kZWQpIHtcbiAgICAgICAgcXVldWVTcGFuLmVuZCh7IHN1Y2Nlc3MsIGVycm9yIH0pO1xuICAgICAgICBzcGFuRW5kZWQgPSB0cnVlO1xuICAgICAgfVxuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9O1xuXG4gICAgLy8gQ3JlYXRlIGF1ZGl0IGNvbnRleHRcbiAgICBjb25zdCBhdWRpdENvbnRleHQgPSB0aGlzLm1ha2VBdWRpdENvbnRleHQoZXZlbnQsIGNvbnRleHQpO1xuICAgIGNvbnN0IHF1ZXVlQ29udGV4dDogUXVldWVBdWRpdENvbnRleHQgPSB7XG4gICAgICBxdWV1ZU5hbWU6IHRoaXMuZ2V0UXVldWVOYW1lKCksXG4gICAgICBiYXRjaFNpemU6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgbWVzc2FnZUlkczogZXZlbnQuUmVjb3Jkcy5tYXAociA9PiByLm1lc3NhZ2VJZCksXG4gICAgICBhcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogcGFyc2VJbnQoZXZlbnQuUmVjb3Jkc1sgMCBdLmF0dHJpYnV0ZXM/LkFwcHJveGltYXRlUmVjZWl2ZUNvdW50IHx8ICcxJylcbiAgICB9O1xuXG4gICAgaWYgKGF1ZGl0Q29udGV4dCkge1xuICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU3RhcnQoYXVkaXRDb250ZXh0LCBxdWV1ZUNvbnRleHQpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBob29rIGZvciB0aGUgYXBwbGljYXRpb24gdG8gaW5pdGlhbGl6ZSBpdCdzIHN0YXRlLCBEZXBlbmRlbmNpZXMsIGNvbmZpZyBldGNcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAgICAvLyBFeGVjdXRlIHRoZSBhc3NvY2lhdGVkIHJvdXRlIGZ1bmN0aW9uXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3MoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICBpZiAoYXVkaXRDb250ZXh0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZUVuZChhdWRpdENvbnRleHQsIHJlc3VsdCwgbnVsbCk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGZpbmFsaXplT2JzZXJ2YWJpbGl0eSh0cnVlKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChhdWRpdENvbnRleHQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlRW5kKGF1ZGl0Q29udGV4dCwgbnVsbCwgZXJyb3IgYXMgRXJyb3IpO1xuICAgICAgfVxuICAgICAgYXdhaXQgZmluYWxpemVPYnNlcnZhYmlsaXR5KGZhbHNlLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IHsgUXVldWVDb250cm9sbGVyIH07XG4iXX0=