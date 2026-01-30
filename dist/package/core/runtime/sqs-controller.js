"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const observability_1 = require("../../observability");
const execution_context_1 = require("./execution-context");
/**
 * Base class for handling SQS events (and optionally DynamoDB Stream events).
 *
 * Generic TEvent allows subclasses to specify more specific event types
 * while maintaining type safety.
 *
 * All handler execution is wrapped in execution context.
 * Configure observability via the @Queue decorator:
 *
 * @example
 * ```typescript
 * @Queue('my-queue', {
 *   observability: {
 *     source: 'domain:queue-type',
 *     tags: { domain: 'sports', priority: 'high' }
 *   }
 * })
 * export class MyQueue extends QueueController { }
 * ```
 */
class QueueController extends abstract_lambda_handler_1.AbstractLambdaHandler {
    initialize(_event, _context) {
        return Promise.resolve();
    }
    getQueueConfig() {
        return Reflect.get(this, 'queueConfig') || {};
    }
    getQueueName() {
        return Reflect.get(this, 'queueName');
    }
    /**
     * Extract per-record trace contexts from the event.
     * Override in subclasses for different event types (e.g., DynamoDB streams).
     *
     * @param event - The incoming event
     * @returns Array of trace contexts (one per record, may contain undefined entries)
     */
    extractPerRecordTraceContexts(event) {
        if (!('Records' in event) || !event.Records)
            return [];
        return event.Records.map((r) => {
            // 1. SQS records: extract from messageAttributes or SNS envelope in body
            if (r.messageAttributes !== undefined || r.body !== undefined) {
                const fromSqs = (0, execution_context_1.extractFromSqsRecord)({ messageAttributes: r.messageAttributes, body: r.body });
                if (fromSqs?.correlationId)
                    return fromSqs;
            }
            // 2. DynamoDB stream records: extract from _actor field in the record
            if (r.dynamodb) {
                // Strict contract:
                // - Only trust NEW image for current operation trace context.
                // - OldImage contains stale context (who last wrote), not who performed the current op.
                // - For deletes (no NewImage), we cannot reliably determine the upstream cause from the stream record alone.
                const image = r.dynamodb.NewImage;
                if (image?._actor) {
                    // Handle both marshalled (DynamoDB format) and unmarshalled formats
                    const actor = image._actor.M || image._actor;
                    const correlationId = actor?.correlationId?.S || actor?.correlationId;
                    if (correlationId) {
                        return {
                            correlationId,
                        };
                    }
                }
            }
            return undefined;
        });
    }
    /**
     * Aggregate per-record trace contexts into batch-level trace info.
     */
    aggregateBatchTraceContext(recordTraceContexts) {
        const upstreamCorrelationCandidates = recordTraceContexts
            .map((t) => t?.correlationId)
            .filter((v) => !!v);
        const batchUpstreamCorrelationId = upstreamCorrelationCandidates.length > 0 && upstreamCorrelationCandidates.every((v) => v === upstreamCorrelationCandidates[0])
            ? upstreamCorrelationCandidates[0]
            : undefined;
        // In strict-hierarchy mode, correlationId is per-invocation. Upstream correlationId becomes causedBy.
        const batchCausedBy = batchUpstreamCorrelationId;
        const isMixedBatch = upstreamCorrelationCandidates.length > 1 && batchUpstreamCorrelationId === undefined;
        return { batchCausedBy, batchUpstreamCorrelationId, isMixedBatch };
    }
    async LambdaHandler(event, context) {
        this.logger.debug("SQS-LambdaHandler received", { recordCount: event.Records?.length });
        this.initializeEntryPackagesAndObservability();
        const queueName = this.getQueueName() || this.constructor.name;
        const queueConfig = this.getQueueConfig();
        const obsConfig = queueConfig.observability || {};
        // Extract and aggregate trace contexts
        const recordTraceContexts = this.extractPerRecordTraceContexts(event);
        const { batchCausedBy, batchUpstreamCorrelationId, isMixedBatch } = this.aggregateBatchTraceContext(recordTraceContexts);
        const invocationId = context.awsRequestId || (0, observability_1.generateTraceId)();
        // Strict hierarchy guarantee: correlationId is per-invocation (local slice).
        const correlationId = invocationId;
        const batchActor = {
            actorType: 'service',
            authMethod: 'system',
            actorId: `queue:${queueName}`,
            requestId: invocationId,
            timestamp: new Date().toISOString(),
            correlationId,
        };
        // Build automatic tags for consistent observability
        const automaticTags = {
            handler_type: 'queue',
            queue_name: queueName,
            is_batch: 'true',
        };
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            causedBy: batchCausedBy,
            actor: batchActor,
            // Batch doesn't have a parent log ID from SQS (records do)
            source: obsConfig.source || `queue:${queueName}`,
            tags: {
                ...automaticTags,
                ...obsConfig.tags, // Decorator tags override automatic
                invocationId,
            },
        });
        // Build queue execution context
        const ctx = {
            event,
            lambdaContext: context,
            executionContext: execCtx,
        };
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Use the base class helper for span + flush pattern
            return this.executeWithSpanAndFlush(`SQS Batch ${queueName}`, async (queueSpan) => {
                const startTime = Date.now();
                try {
                    await this.initialize(event, context);
                    const result = await this.process(event, context, ctx);
                    const duration = Date.now() - startTime;
                    // Determine success based on result
                    const hasFailures = result && 'batchItemFailures' in result && result.batchItemFailures.length > 0;
                    const failureCount = hasFailures ? result.batchItemFailures.length : 0;
                    const totalCount = event.Records.length;
                    const successCount = totalCount - failureCount;
                    if (hasFailures) {
                        observability_1.SpanObserver.getCurrentSpan()?.checkpoint?.('sqs.batch.partial_failure', {
                            tags: {
                                'sqs.has_failures': 'true',
                            },
                            metrics: {
                                'sqs.batch.failure_count': failureCount,
                            },
                        });
                    }
                    // Set final metrics on span
                    queueSpan.metrics({
                        'sqs.batch.duration_ms': duration,
                        'sqs.batch.total_count': totalCount,
                        'sqs.batch.success_count': successCount,
                        'sqs.batch.failure_count': failureCount,
                    });
                    return result;
                }
                catch (error) {
                    const duration = Date.now() - startTime;
                    queueSpan.metrics({
                        'sqs.batch.duration_ms': duration,
                        'sqs.batch.total_count': event.Records.length,
                        'sqs.batch.errors': 1,
                    });
                    throw error;
                }
            }, {
                correlationId,
                causedBy: batchCausedBy,
                source: obsConfig.source || `queue:${queueName}`,
                tags: {
                    ...automaticTags,
                    ...obsConfig.tags,
                    'sqs.queueName': queueName,
                    'faas.execution': context.awsRequestId,
                    ...(isMixedBatch ? { 'trace.mixed': 'true' } : {}),
                },
                metrics: {
                    'sqs.batchSize': event.Records.length,
                },
            });
        });
    }
}
exports.QueueController = QueueController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSx1REFBb0U7QUFDcEUsMkRBTTZCO0FBMkI3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWUsZUFBNEQsU0FBUSwrQ0FBcUI7SUFFNUYsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUNwRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBZ0JTLGNBQWM7UUFDdEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDaEQsQ0FBQztJQUVTLFlBQVk7UUFDcEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXLENBQXVCLENBQUM7SUFDOUQsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNPLDZCQUE2QixDQUFDLEtBQWE7UUFDbkQsSUFBSSxDQUFDLENBQUMsU0FBUyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU87WUFBRSxPQUFPLEVBQUUsQ0FBQztRQUN2RCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUU7WUFDbEMseUVBQXlFO1lBQ3pFLElBQUksQ0FBQyxDQUFDLGlCQUFpQixLQUFLLFNBQVMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUM5RCxNQUFNLE9BQU8sR0FBRyxJQUFBLHdDQUFvQixFQUFDLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLGlCQUFpQixFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDL0YsSUFBSSxPQUFPLEVBQUUs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QUFPLENBQUM7d0JBQ2hCLHVCQUF1QixFQUFFLFFBQVE7d0JBQ2pDLHVCQUF1QixFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTTt3QkFDN0Msa0JBQWtCLEVBQUUsQ0FBQztxQkFDdEIsQ0FBQyxDQUFDO29CQUNILE1BQU0sS0FBSyxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDLEVBQ0Q7Z0JBQ0UsYUFBYTtnQkFDYixRQUFRLEVBQUUsYUFBYTtnQkFDdkIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNLElBQUksU0FBUyxTQUFTLEVBQUU7Z0JBQ2hELElBQUksRUFBRTtvQkFDSixHQUFHLGFBQWE7b0JBQ2hCLEdBQUcsU0FBUyxDQUFDLElBQUk7b0JBQ2pCLGVBQWUsRUFBRSxTQUFTO29CQUMxQixnQkFBZ0IsRUFBRSxPQUFPLENBQUMsWUFBWTtvQkFDdEMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztpQkFDbkQ7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLGVBQWUsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07aUJBQ3RDO2FBQ0YsQ0FDRixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFFUSwwQ0FBZSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNRU0V2ZW50LCBTUVNCYXRjaFJlc3BvbnNlLCBDb250ZXh0LCBEeW5hbW9EQlN0cmVhbUV2ZW50IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBJUXVldWVDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3F1ZXVlJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgZ2VuZXJhdGVUcmFjZUlkIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eSc7XG5pbXBvcnQge1xuICBFeGVjdXRpb25Db250ZXh0RGF0YSxcbiAgUGFyc2VkVHJhY2VDb250ZXh0LFxuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgZXh0cmFjdEZyb21TcXNSZWNvcmQsXG59IGZyb20gJy4vZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5cbi8qKlxuICogU3VwcG9ydGVkIGV2ZW50IHR5cGVzIGZvciBxdWV1ZS9zdHJlYW0gcHJvY2Vzc2luZy5cbiAqL1xuZXhwb3J0IHR5cGUgUXVldWVTdHJlYW1FdmVudCA9IFNRU0V2ZW50IHwgRHluYW1vREJTdHJlYW1FdmVudDtcblxuLyoqXG4gKiBSZXN1bHQgdHlwZSBmb3IgcXVldWUgcHJvY2Vzc2luZy5cbiAqIC0gdm9pZDogQWxsIG1lc3NhZ2VzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHlcbiAqIC0gU1FTQmF0Y2hSZXNwb25zZTogUGFydGlhbCBiYXRjaCBmYWlsdXJlIChzb21lIG1lc3NhZ2VzIG5lZWQgcmV0cnkpXG4gKi9cbmV4cG9ydCB0eXBlIFF1ZXVlUHJvY2Vzc1Jlc3VsdCA9IHZvaWQgfCBTUVNCYXRjaFJlc3BvbnNlO1xuXG4vKipcbiAqIFF1ZXVlIGV4ZWN1dGlvbiBjb250ZXh0IC0gY29udGFpbnMgcXVldWUtc3BlY2lmaWMgZGF0YSBBTkQgZXhlY3V0aW9uIGNvbnRleHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUXVldWVFeGVjdXRpb25Db250ZXh0PFRFdmVudCBleHRlbmRzIFF1ZXVlU3RyZWFtRXZlbnQgPSBTUVNFdmVudD4ge1xuICAvKiogVGhlIGV2ZW50ICovXG4gIHJlYWRvbmx5IGV2ZW50OiBURXZlbnQ7XG4gIC8qKiBMYW1iZGEgY29udGV4dCAqL1xuICByZWFkb25seSBsYW1iZGFDb250ZXh0OiBDb250ZXh0O1xuICAvKiogRXhlY3V0aW9uIGNvbnRleHQgKGFsc28gYXZhaWxhYmxlIHZpYSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpKSAqL1xuICByZWFkb25seSBleGVjdXRpb25Db250ZXh0OiBFeGVjdXRpb25Db250ZXh0RGF0YTtcbn1cblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBoYW5kbGluZyBTUVMgZXZlbnRzIChhbmQgb3B0aW9uYWxseSBEeW5hbW9EQiBTdHJlYW0gZXZlbnRzKS5cbiAqIFxuICogR2VuZXJpYyBURXZlbnQgYWxsb3dzIHN1YmNsYXNzZXMgdG8gc3BlY2lmeSBtb3JlIHNwZWNpZmljIGV2ZW50IHR5cGVzXG4gKiB3aGlsZSBtYWludGFpbmluZyB0eXBlIHNhZmV0eS5cbiAqIFxuICogQWxsIGhhbmRsZXIgZXhlY3V0aW9uIGlzIHdyYXBwZWQgaW4gZXhlY3V0aW9uIGNvbnRleHQuXG4gKiBDb25maWd1cmUgb2JzZXJ2YWJpbGl0eSB2aWEgdGhlIEBRdWV1ZSBkZWNvcmF0b3I6XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAUXVldWUoJ215LXF1ZXVlJywge1xuICogICBvYnNlcnZhYmlsaXR5OiB7XG4gKiAgICAgc291cmNlOiAnZG9tYWluOnF1ZXVlLXR5cGUnLFxuICogICAgIHRhZ3M6IHsgZG9tYWluOiAnc3BvcnRzJywgcHJpb3JpdHk6ICdoaWdoJyB9XG4gKiAgIH1cbiAqIH0pXG4gKiBleHBvcnQgY2xhc3MgTXlRdWV1ZSBleHRlbmRzIFF1ZXVlQ29udHJvbGxlciB7IH1cbiAqIGBgYFxuICovXG5hYnN0cmFjdCBjbGFzcyBRdWV1ZUNvbnRyb2xsZXI8VEV2ZW50IGV4dGVuZHMgUXVldWVTdHJlYW1FdmVudCA9IFNRU0V2ZW50PiBleHRlbmRzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG5cbiAgcHJvdGVjdGVkIGluaXRpYWxpemUoX2V2ZW50OiBURXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgdGhlIHF1ZXVlIGV2ZW50LlxuICAgKiBcbiAgICogUmV0dXJuIGB2b2lkYCBpZiBhbGwgbWVzc2FnZXMgcHJvY2Vzc2VkIHN1Y2Nlc3NmdWxseS5cbiAgICogUmV0dXJuIGBTUVNCYXRjaFJlc3BvbnNlYCB3aXRoIGBiYXRjaEl0ZW1GYWlsdXJlc2AgZm9yIHBhcnRpYWwgYmF0Y2ggZmFpbHVyZXNcbiAgICogKHJlcXVpcmVzIGByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZWAgaW4gcXVldWUgY29uZmlnKS5cbiAgICogXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBldmVudFxuICAgKiBAcGFyYW0gY29udGV4dCAtIFRoZSBMYW1iZGEgY29udGV4dCAgXG4gICAqIEBwYXJhbSBjdHggLSBRdWV1ZSBleGVjdXRpb24gY29udGV4dFxuICAgKiBAcmV0dXJucyB2b2lkIG9yIFNRU0JhdGNoUmVzcG9uc2UgZm9yIHBhcnRpYWwgYmF0Y2ggZmFpbHVyZXNcbiAgICovXG4gIGFic3RyYWN0IHByb2Nlc3MoZXZlbnQ6IFRFdmVudCwgY29udGV4dDogQ29udGV4dCwgY3R4PzogUXVldWVFeGVjdXRpb25Db250ZXh0PFRFdmVudD4pOiBQcm9taXNlPFF1ZXVlUHJvY2Vzc1Jlc3VsdD47XG5cbiAgcHJvdGVjdGVkIGdldFF1ZXVlQ29uZmlnKCk6IElRdWV1ZUNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZUNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldFF1ZXVlTmFtZSgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAncXVldWVOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3QgcGVyLXJlY29yZCB0cmFjZSBjb250ZXh0cyBmcm9tIHRoZSBldmVudC5cbiAgICogT3ZlcnJpZGUgaW4gc3ViY2xhc3NlcyBmb3IgZGlmZmVyZW50IGV2ZW50IHR5cGVzIChlLmcuLCBEeW5hbW9EQiBzdHJlYW1zKS5cbiAgICogXG4gICAqIEBwYXJhbSBldmVudCAtIFRoZSBpbmNvbWluZyBldmVudFxuICAgKiBAcmV0dXJucyBBcnJheSBvZiB0cmFjZSBjb250ZXh0cyAob25lIHBlciByZWNvcmQsIG1heSBjb250YWluIHVuZGVmaW5lZCBlbnRyaWVzKVxuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RQZXJSZWNvcmRUcmFjZUNvbnRleHRzKGV2ZW50OiBURXZlbnQpOiAoUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkKVtdIHtcbiAgICBpZiAoISgnUmVjb3JkcycgaW4gZXZlbnQpIHx8ICFldmVudC5SZWNvcmRzKSByZXR1cm4gW107XG4gICAgcmV0dXJuIGV2ZW50LlJlY29yZHMubWFwKChyOiBhbnkpID0+IHtcbiAgICAgIC8vIDEuIFNRUyByZWNvcmRzOiBleHRyYWN0IGZyb20gbWVzc2FnZUF0dHJpYnV0ZXMgb3IgU05TIGVudmVsb3BlIGluIGJvZHlcbiAgICAgIGlmIChyLm1lc3NhZ2VBdHRyaWJ1dGVzICE9PSB1bmRlZmluZWQgfHwgci5ib2R5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc3QgZnJvbVNxcyA9IGV4dHJhY3RGcm9tU3FzUmVjb3JkKHsgbWVzc2FnZUF0dHJpYnV0ZXM6IHIubWVzc2FnZUF0dHJpYnV0ZXMsIGJvZHk6IHIuYm9keSB9KTtcbiAgICAgICAgaWYgKGZyb21TcXM/LmNvcnJlbGF0aW9uSWQpIHJldHVybiBmcm9tU3FzO1xuICAgICAgfVxuXG4gICAgICAvLyAyLiBEeW5hbW9EQiBzdHJlYW0gcmVjb3JkczogZXh0cmFjdCBmcm9tIF9hY3RvciBmaWVsZCBpbiB0aGUgcmVjb3JkXG4gICAgICBpZiAoci5keW5hbW9kYikge1xuICAgICAgICAvLyBTdHJpY3QgY29udHJhY3Q6XG4gICAgICAgIC8vIC0gT25seSB0cnVzdCBORVcgaW1hZ2UgZm9yIGN1cnJlbnQgb3BlcmF0aW9uIHRyYWNlIGNvbnRleHQuXG4gICAgICAgIC8vIC0gT2xkSW1hZ2UgY29udGFpbnMgc3RhbGUgY29udGV4dCAod2hvIGxhc3Qgd3JvdGUpLCBub3Qgd2hvIHBlcmZvcm1lZCB0aGUgY3VycmVudCBvcC5cbiAgICAgICAgLy8gLSBGb3IgZGVsZXRlcyAobm8gTmV3SW1hZ2UpLCB3ZSBjYW5ub3QgcmVsaWFibHkgZGV0ZXJtaW5lIHRoZSB1cHN0cmVhbSBjYXVzZSBmcm9tIHRoZSBzdHJlYW0gcmVjb3JkIGFsb25lLlxuICAgICAgICBjb25zdCBpbWFnZSA9IHIuZHluYW1vZGIuTmV3SW1hZ2U7XG4gICAgICAgIGlmIChpbWFnZT8uX2FjdG9yKSB7XG4gICAgICAgICAgLy8gSGFuZGxlIGJvdGggbWFyc2hhbGxlZCAoRHluYW1vREIgZm9ybWF0KSBhbmQgdW5tYXJzaGFsbGVkIGZvcm1hdHNcbiAgICAgICAgICBjb25zdCBhY3RvciA9IGltYWdlLl9hY3Rvci5NIHx8IGltYWdlLl9hY3RvcjtcbiAgICAgICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gYWN0b3I/LmNvcnJlbGF0aW9uSWQ/LlMgfHwgYWN0b3I/LmNvcnJlbGF0aW9uSWQ7XG4gICAgICAgICAgaWYgKGNvcnJlbGF0aW9uSWQpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEFnZ3JlZ2F0ZSBwZXItcmVjb3JkIHRyYWNlIGNvbnRleHRzIGludG8gYmF0Y2gtbGV2ZWwgdHJhY2UgaW5mby5cbiAgICovXG4gIHByb3RlY3RlZCBhZ2dyZWdhdGVCYXRjaFRyYWNlQ29udGV4dChcbiAgICByZWNvcmRUcmFjZUNvbnRleHRzOiAoUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkKVtdXG4gICk6IHsgYmF0Y2hDYXVzZWRCeT86IHN0cmluZzsgYmF0Y2hVcHN0cmVhbUNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7IGlzTWl4ZWRCYXRjaDogYm9vbGVhbiB9IHtcbiAgICBjb25zdCB1cHN0cmVhbUNvcnJlbGF0aW9uQ2FuZGlkYXRlcyA9IHJlY29yZFRyYWNlQ29udGV4dHNcbiAgICAgIC5tYXAoKHQpID0+IHQ/LmNvcnJlbGF0aW9uSWQpXG4gICAgICAuZmlsdGVyKCh2KTogdiBpcyBzdHJpbmcgPT4gISF2KTtcbiAgICBjb25zdCBiYXRjaFVwc3RyZWFtQ29ycmVsYXRpb25JZCA9XG4gICAgICB1cHN0cmVhbUNvcnJlbGF0aW9uQ2FuZGlkYXRlcy5sZW5ndGggPiAwICYmIHVwc3RyZWFtQ29ycmVsYXRpb25DYW5kaWRhdGVzLmV2ZXJ5KCh2KSA9PiB2ID09PSB1cHN0cmVhbUNvcnJlbGF0aW9uQ2FuZGlkYXRlc1sgMCBdKVxuICAgICAgICA/IHVwc3RyZWFtQ29ycmVsYXRpb25DYW5kaWRhdGVzWyAwIF1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAvLyBJbiBzdHJpY3QtaGllcmFyY2h5IG1vZGUsIGNvcnJlbGF0aW9uSWQgaXMgcGVyLWludm9jYXRpb24uIFVwc3RyZWFtIGNvcnJlbGF0aW9uSWQgYmVjb21lcyBjYXVzZWRCeS5cbiAgICBjb25zdCBiYXRjaENhdXNlZEJ5ID0gYmF0Y2hVcHN0cmVhbUNvcnJlbGF0aW9uSWQ7XG4gICAgY29uc3QgaXNNaXhlZEJhdGNoID0gdXBzdHJlYW1Db3JyZWxhdGlvbkNhbmRpZGF0ZXMubGVuZ3RoID4gMSAmJiBiYXRjaFVwc3RyZWFtQ29ycmVsYXRpb25JZCA9PT0gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIHsgYmF0Y2hDYXVzZWRCeSwgYmF0Y2hVcHN0cmVhbUNvcnJlbGF0aW9uSWQsIGlzTWl4ZWRCYXRjaCB9O1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogVEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxRdWV1ZVByb2Nlc3NSZXN1bHQ+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUy1MYW1iZGFIYW5kbGVyIHJlY2VpdmVkXCIsIHsgcmVjb3JkQ291bnQ6IGV2ZW50LlJlY29yZHM/Lmxlbmd0aCB9KTtcbiAgICB0aGlzLmluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgcXVldWVOYW1lID0gdGhpcy5nZXRRdWV1ZU5hbWUoKSB8fCB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgcXVldWVDb25maWcgPSB0aGlzLmdldFF1ZXVlQ29uZmlnKCk7XG4gICAgY29uc3Qgb2JzQ29uZmlnID0gcXVldWVDb25maWcub2JzZXJ2YWJpbGl0eSB8fCB7fTtcblxuICAgIC8vIEV4dHJhY3QgYW5kIGFnZ3JlZ2F0ZSB0cmFjZSBjb250ZXh0c1xuICAgIGNvbnN0IHJlY29yZFRyYWNlQ29udGV4dHMgPSB0aGlzLmV4dHJhY3RQZXJSZWNvcmRUcmFjZUNvbnRleHRzKGV2ZW50KTtcbiAgICBjb25zdCB7IGJhdGNoQ2F1c2VkQnksIGJhdGNoVXBzdHJlYW1Db3JyZWxhdGlvbklkLCBpc01peGVkQmF0Y2ggfSA9IHRoaXMuYWdncmVnYXRlQmF0Y2hUcmFjZUNvbnRleHQocmVjb3JkVHJhY2VDb250ZXh0cyk7XG5cbiAgICBjb25zdCBpbnZvY2F0aW9uSWQgPSBjb250ZXh0LmF3c1JlcXVlc3RJZCB8fCBnZW5lcmF0ZVRyYWNlSWQoKTtcbiAgICAvLyBTdHJpY3QgaGllcmFyY2h5IGd1YXJhbnRlZTogY29ycmVsYXRpb25JZCBpcyBwZXItaW52b2NhdGlvbiAobG9jYWwgc2xpY2UpLlxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBpbnZvY2F0aW9uSWQ7XG5cbiAgICBjb25zdCBiYXRjaEFjdG9yOiBBY3RvciA9IHtcbiAgICAgIGFjdG9yVHlwZTogJ3NlcnZpY2UnLFxuICAgICAgYXV0aE1ldGhvZDogJ3N5c3RlbScsXG4gICAgICBhY3RvcklkOiBgcXVldWU6JHtxdWV1ZU5hbWV9YCxcbiAgICAgIHJlcXVlc3RJZDogaW52b2NhdGlvbklkLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgIH07XG5cbiAgICAvLyBCdWlsZCBhdXRvbWF0aWMgdGFncyBmb3IgY29uc2lzdGVudCBvYnNlcnZhYmlsaXR5XG4gICAgY29uc3QgYXV0b21hdGljVGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgIGhhbmRsZXJfdHlwZTogJ3F1ZXVlJyxcbiAgICAgIHF1ZXVlX25hbWU6IHF1ZXVlTmFtZSxcbiAgICAgIGlzX2JhdGNoOiAndHJ1ZScsXG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnk6IGJhdGNoQ2F1c2VkQnksXG4gICAgICBhY3RvcjogYmF0Y2hBY3RvcixcbiAgICAgIC8vIEJhdGNoIGRvZXNuJ3QgaGF2ZSBhIHBhcmVudCBsb2cgSUQgZnJvbSBTUVMgKHJlY29yZHMgZG8pXG4gICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHF1ZXVlOiR7cXVldWVOYW1lfWAsXG4gICAgICB0YWdzOiB7XG4gICAgICAgIC4uLmF1dG9tYXRpY1RhZ3MsXG4gICAgICAgIC4uLm9ic0NvbmZpZy50YWdzLCAvLyBEZWNvcmF0b3IgdGFncyBvdmVycmlkZSBhdXRvbWF0aWNcbiAgICAgICAgaW52b2NhdGlvbklkLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEJ1aWxkIHF1ZXVlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgY29uc3QgY3R4OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQ8VEV2ZW50PiA9IHtcbiAgICAgIGV2ZW50LFxuICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgIGV4ZWN1dGlvbkNvbnRleHQ6IGV4ZWNDdHgsXG4gICAgfTtcblxuICAgIC8vIFJ1biBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBVc2UgdGhlIGJhc2UgY2xhc3MgaGVscGVyIGZvciBzcGFuICsgZmx1c2ggcGF0dGVyblxuICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZVdpdGhTcGFuQW5kRmx1c2goXG4gICAgICAgIGBTUVMgQmF0Y2ggJHtxdWV1ZU5hbWV9YCxcbiAgICAgICAgYXN5bmMgKHF1ZXVlU3BhbikgPT4ge1xuICAgICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3MoZXZlbnQsIGNvbnRleHQsIGN0eCk7XG4gICAgICAgICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG5cbiAgICAgICAgICAgIC8vIERldGVybWluZSBzdWNjZXNzIGJhc2VkIG9uIHJlc3VsdFxuICAgICAgICAgICAgY29uc3QgaGFzRmFpbHVyZXMgPSByZXN1bHQgJiYgJ2JhdGNoSXRlbUZhaWx1cmVzJyBpbiByZXN1bHQgJiYgcmVzdWx0LmJhdGNoSXRlbUZhaWx1cmVzLmxlbmd0aCA+IDA7XG4gICAgICAgICAgICBjb25zdCBmYWlsdXJlQ291bnQgPSBoYXNGYWlsdXJlcyA/IHJlc3VsdC5iYXRjaEl0ZW1GYWlsdXJlcy5sZW5ndGggOiAwO1xuICAgICAgICAgICAgY29uc3QgdG90YWxDb3VudCA9IGV2ZW50LlJlY29yZHMubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3Qgc3VjY2Vzc0NvdW50ID0gdG90YWxDb3VudCAtIGZhaWx1cmVDb3VudDtcblxuICAgICAgICAgICAgaWYgKGhhc0ZhaWx1cmVzKSB7XG4gICAgICAgICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ3Nxcy5iYXRjaC5wYXJ0aWFsX2ZhaWx1cmUnLCB7XG4gICAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICAgJ3Nxcy5oYXNfZmFpbHVyZXMnOiAndHJ1ZScsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAnc3FzLmJhdGNoLmZhaWx1cmVfY291bnQnOiBmYWlsdXJlQ291bnQsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNldCBmaW5hbCBtZXRyaWNzIG9uIHNwYW5cbiAgICAgICAgICAgIHF1ZXVlU3Bhbi5tZXRyaWNzKHtcbiAgICAgICAgICAgICAgJ3Nxcy5iYXRjaC5kdXJhdGlvbl9tcyc6IGR1cmF0aW9uLFxuICAgICAgICAgICAgICAnc3FzLmJhdGNoLnRvdGFsX2NvdW50JzogdG90YWxDb3VudCxcbiAgICAgICAgICAgICAgJ3Nxcy5iYXRjaC5zdWNjZXNzX2NvdW50Jzogc3VjY2Vzc0NvdW50LFxuICAgICAgICAgICAgICAnc3FzLmJhdGNoLmZhaWx1cmVfY291bnQnOiBmYWlsdXJlQ291bnQsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICAgICAgcXVldWVTcGFuLm1ldHJpY3Moe1xuICAgICAgICAgICAgICAnc3FzLmJhdGNoLmR1cmF0aW9uX21zJzogZHVyYXRpb24sXG4gICAgICAgICAgICAgICdzcXMuYmF0Y2gudG90YWxfY291bnQnOiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgICAgICAgICAgICAgJ3Nxcy5iYXRjaC5lcnJvcnMnOiAxLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGNhdXNlZEJ5OiBiYXRjaENhdXNlZEJ5LFxuICAgICAgICAgIHNvdXJjZTogb2JzQ29uZmlnLnNvdXJjZSB8fCBgcXVldWU6JHtxdWV1ZU5hbWV9YCxcbiAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAgICAgLi4ub2JzQ29uZmlnLnRhZ3MsXG4gICAgICAgICAgICAnc3FzLnF1ZXVlTmFtZSc6IHF1ZXVlTmFtZSxcbiAgICAgICAgICAgICdmYWFzLmV4ZWN1dGlvbic6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxuICAgICAgICAgICAgLi4uKGlzTWl4ZWRCYXRjaCA/IHsgJ3RyYWNlLm1peGVkJzogJ3RydWUnIH0gOiB7fSksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAnc3FzLmJhdGNoU2l6ZSc6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgICAgIH0sXG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IHsgUXVldWVDb250cm9sbGVyIH07XG4iXX0=