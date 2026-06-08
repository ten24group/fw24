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
                    // SQS retry detection — tag when messages are being reprocessed
                    const receiveCounts = event.Records.map((r) => parseInt(r.attributes?.ApproximateReceiveCount ?? '1', 10));
                    const maxReceiveCount = Math.max(...receiveCounts);
                    const retryCount = receiveCounts.filter((c) => c > 1).length;
                    if (retryCount > 0) {
                        queueSpan.tag('sqs.has_retries', 'true');
                        queueSpan.metrics({
                            'sqs.retry_count': retryCount,
                            'sqs.max_receive_count': maxReceiveCount,
                        });
                    }
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
            }, context);
        });
    }
}
exports.QueueController = QueueController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSx1REFBb0U7QUFDcEUsMkRBTTZCO0FBMkI3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWUsZUFBNEQsU0FBUSwrQ0FBcUI7SUFFNUYsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUNwRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBZ0JTLGNBQWM7UUFDdEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDaEQsQ0FBQztJQUVTLFlBQVk7UUFDcEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXLENBQXVCLENBQUM7SUFDOUQsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNPLDZCQUE2QixDQUFDLEtBQWE7UUFDbkQsSUFBSSxDQUFDLENBQUMsU0FBUyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU87WUFBRSxPQUFPLEVBQUUsQ0FBQztRQUN2RCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUU7WUFDbEMseUVBQXlFO1lBQ3pFLElBQUksQ0FBQyxDQUFDLGlCQUFpQixLQUFLLFNBQVMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUM5RCxNQUFNLE9BQU8sR0FBRyxJQUFBLHdDQUFvQixFQUFDLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLGlCQUFpQixFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDL0YsSUFBSSxPQUFPLEVBQUUs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QUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztpQkFDbkQ7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLGVBQWUsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07aUJBQ3RDO2FBQ0YsRUFDRCxPQUFPLENBQ1IsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBRVEsMENBQWUiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTUVNFdmVudCwgU1FTQmF0Y2hSZXNwb25zZSwgQ29udGV4dCwgRHluYW1vREJTdHJlYW1FdmVudCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgSVF1ZXVlQ29uZmlnIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycy9xdWV1ZSc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIGdlbmVyYXRlVHJhY2VJZCB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIFBhcnNlZFRyYWNlQ29udGV4dCxcbiAgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsXG4gIGV4dHJhY3RGcm9tU3FzUmVjb3JkLFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG4vKipcbiAqIFN1cHBvcnRlZCBldmVudCB0eXBlcyBmb3IgcXVldWUvc3RyZWFtIHByb2Nlc3NpbmcuXG4gKi9cbmV4cG9ydCB0eXBlIFF1ZXVlU3RyZWFtRXZlbnQgPSBTUVNFdmVudCB8IER5bmFtb0RCU3RyZWFtRXZlbnQ7XG5cbi8qKlxuICogUmVzdWx0IHR5cGUgZm9yIHF1ZXVlIHByb2Nlc3NpbmcuXG4gKiAtIHZvaWQ6IEFsbCBtZXNzYWdlcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5XG4gKiAtIFNRU0JhdGNoUmVzcG9uc2U6IFBhcnRpYWwgYmF0Y2ggZmFpbHVyZSAoc29tZSBtZXNzYWdlcyBuZWVkIHJldHJ5KVxuICovXG5leHBvcnQgdHlwZSBRdWV1ZVByb2Nlc3NSZXN1bHQgPSB2b2lkIHwgU1FTQmF0Y2hSZXNwb25zZTtcblxuLyoqXG4gKiBRdWV1ZSBleGVjdXRpb24gY29udGV4dCAtIGNvbnRhaW5zIHF1ZXVlLXNwZWNpZmljIGRhdGEgQU5EIGV4ZWN1dGlvbiBjb250ZXh0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXVlRXhlY3V0aW9uQ29udGV4dDxURXZlbnQgZXh0ZW5kcyBRdWV1ZVN0cmVhbUV2ZW50ID0gU1FTRXZlbnQ+IHtcbiAgLyoqIFRoZSBldmVudCAqL1xuICByZWFkb25seSBldmVudDogVEV2ZW50O1xuICAvKiogTGFtYmRhIGNvbnRleHQgKi9cbiAgcmVhZG9ubHkgbGFtYmRhQ29udGV4dDogQ29udGV4dDtcbiAgLyoqIEV4ZWN1dGlvbiBjb250ZXh0IChhbHNvIGF2YWlsYWJsZSB2aWEgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSkgKi9cbiAgcmVhZG9ubHkgZXhlY3V0aW9uQ29udGV4dDogRXhlY3V0aW9uQ29udGV4dERhdGE7XG59XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU1FTIGV2ZW50cyAoYW5kIG9wdGlvbmFsbHkgRHluYW1vREIgU3RyZWFtIGV2ZW50cykuXG4gKiBcbiAqIEdlbmVyaWMgVEV2ZW50IGFsbG93cyBzdWJjbGFzc2VzIHRvIHNwZWNpZnkgbW9yZSBzcGVjaWZpYyBldmVudCB0eXBlc1xuICogd2hpbGUgbWFpbnRhaW5pbmcgdHlwZSBzYWZldHkuXG4gKiBcbiAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LlxuICogQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgdmlhIHRoZSBAUXVldWUgZGVjb3JhdG9yOlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogQFF1ZXVlKCdteS1xdWV1ZScsIHtcbiAqICAgb2JzZXJ2YWJpbGl0eToge1xuICogICAgIHNvdXJjZTogJ2RvbWFpbjpxdWV1ZS10eXBlJyxcbiAqICAgICB0YWdzOiB7IGRvbWFpbjogJ3Nwb3J0cycsIHByaW9yaXR5OiAnaGlnaCcgfVxuICogICB9XG4gKiB9KVxuICogZXhwb3J0IGNsYXNzIE15UXVldWUgZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIgeyB9XG4gKiBgYGBcbiAqL1xuYWJzdHJhY3QgY2xhc3MgUXVldWVDb250cm9sbGVyPFRFdmVudCBleHRlbmRzIFF1ZXVlU3RyZWFtRXZlbnQgPSBTUVNFdmVudD4gZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuXG4gIHByb3RlY3RlZCBpbml0aWFsaXplKF9ldmVudDogVEV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoZSBxdWV1ZSBldmVudC5cbiAgICogXG4gICAqIFJldHVybiBgdm9pZGAgaWYgYWxsIG1lc3NhZ2VzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHkuXG4gICAqIFJldHVybiBgU1FTQmF0Y2hSZXNwb25zZWAgd2l0aCBgYmF0Y2hJdGVtRmFpbHVyZXNgIGZvciBwYXJ0aWFsIGJhdGNoIGZhaWx1cmVzXG4gICAqIChyZXF1aXJlcyBgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IHRydWVgIGluIHF1ZXVlIGNvbmZpZykuXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnRcbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgTGFtYmRhIGNvbnRleHQgIFxuICAgKiBAcGFyYW0gY3R4IC0gUXVldWUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICogQHJldHVybnMgdm9pZCBvciBTUVNCYXRjaFJlc3BvbnNlIGZvciBwYXJ0aWFsIGJhdGNoIGZhaWx1cmVzXG4gICAqL1xuICBhYnN0cmFjdCBwcm9jZXNzKGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIGN0eD86IFF1ZXVlRXhlY3V0aW9uQ29udGV4dDxURXZlbnQ+KTogUHJvbWlzZTxRdWV1ZVByb2Nlc3NSZXN1bHQ+O1xuXG4gIHByb3RlY3RlZCBnZXRRdWV1ZUNvbmZpZygpOiBJUXVldWVDb25maWcge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAncXVldWVDb25maWcnKSB8fCB7fTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRRdWV1ZU5hbWUoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3F1ZXVlTmFtZScpIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHBlci1yZWNvcmQgdHJhY2UgY29udGV4dHMgZnJvbSB0aGUgZXZlbnQuXG4gICAqIE92ZXJyaWRlIGluIHN1YmNsYXNzZXMgZm9yIGRpZmZlcmVudCBldmVudCB0eXBlcyAoZS5nLiwgRHluYW1vREIgc3RyZWFtcykuXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgaW5jb21pbmcgZXZlbnRcbiAgICogQHJldHVybnMgQXJyYXkgb2YgdHJhY2UgY29udGV4dHMgKG9uZSBwZXIgcmVjb3JkLCBtYXkgY29udGFpbiB1bmRlZmluZWQgZW50cmllcylcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0UGVyUmVjb3JkVHJhY2VDb250ZXh0cyhldmVudDogVEV2ZW50KTogKFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZClbXSB7XG4gICAgaWYgKCEoJ1JlY29yZHMnIGluIGV2ZW50KSB8fCAhZXZlbnQuUmVjb3JkcykgcmV0dXJuIFtdO1xuICAgIHJldHVybiBldmVudC5SZWNvcmRzLm1hcCgocjogYW55KSA9PiB7XG4gICAgICAvLyAxLiBTUVMgcmVjb3JkczogZXh0cmFjdCBmcm9tIG1lc3NhZ2VBdHRyaWJ1dGVzIG9yIFNOUyBlbnZlbG9wZSBpbiBib2R5XG4gICAgICBpZiAoci5tZXNzYWdlQXR0cmlidXRlcyAhPT0gdW5kZWZpbmVkIHx8IHIuYm9keSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnN0IGZyb21TcXMgPSBleHRyYWN0RnJvbVNxc1JlY29yZCh7IG1lc3NhZ2VBdHRyaWJ1dGVzOiByLm1lc3NhZ2VBdHRyaWJ1dGVzLCBib2R5OiByLmJvZHkgfSk7XG4gICAgICAgIGlmIChmcm9tU3FzPy5jb3JyZWxhdGlvbklkKSByZXR1cm4gZnJvbVNxcztcbiAgICAgIH1cblxuICAgICAgLy8gMi4gRHluYW1vREIgc3RyZWFtIHJlY29yZHM6IGV4dHJhY3QgZnJvbSBfYWN0b3IgZmllbGQgaW4gdGhlIHJlY29yZFxuICAgICAgaWYgKHIuZHluYW1vZGIpIHtcbiAgICAgICAgLy8gU3RyaWN0IGNvbnRyYWN0OlxuICAgICAgICAvLyAtIE9ubHkgdHJ1c3QgTkVXIGltYWdlIGZvciBjdXJyZW50IG9wZXJhdGlvbiB0cmFjZSBjb250ZXh0LlxuICAgICAgICAvLyAtIE9sZEltYWdlIGNvbnRhaW5zIHN0YWxlIGNvbnRleHQgKHdobyBsYXN0IHdyb3RlKSwgbm90IHdobyBwZXJmb3JtZWQgdGhlIGN1cnJlbnQgb3AuXG4gICAgICAgIC8vIC0gRm9yIGRlbGV0ZXMgKG5vIE5ld0ltYWdlKSwgd2UgY2Fubm90IHJlbGlhYmx5IGRldGVybWluZSB0aGUgdXBzdHJlYW0gY2F1c2UgZnJvbSB0aGUgc3RyZWFtIHJlY29yZCBhbG9uZS5cbiAgICAgICAgY29uc3QgaW1hZ2UgPSByLmR5bmFtb2RiLk5ld0ltYWdlO1xuICAgICAgICBpZiAoaW1hZ2U/Ll9hY3Rvcikge1xuICAgICAgICAgIC8vIEhhbmRsZSBib3RoIG1hcnNoYWxsZWQgKER5bmFtb0RCIGZvcm1hdCkgYW5kIHVubWFyc2hhbGxlZCBmb3JtYXRzXG4gICAgICAgICAgY29uc3QgYWN0b3IgPSBpbWFnZS5fYWN0b3IuTSB8fCBpbWFnZS5fYWN0b3I7XG4gICAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGFjdG9yPy5jb3JyZWxhdGlvbklkPy5TIHx8IGFjdG9yPy5jb3JyZWxhdGlvbklkO1xuICAgICAgICAgIGlmIChjb3JyZWxhdGlvbklkKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZ2dyZWdhdGUgcGVyLXJlY29yZCB0cmFjZSBjb250ZXh0cyBpbnRvIGJhdGNoLWxldmVsIHRyYWNlIGluZm8uXG4gICAqL1xuICBwcm90ZWN0ZWQgYWdncmVnYXRlQmF0Y2hUcmFjZUNvbnRleHQoXG4gICAgcmVjb3JkVHJhY2VDb250ZXh0czogKFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZClbXVxuICApOiB7IGJhdGNoQ2F1c2VkQnk/OiBzdHJpbmc7IGJhdGNoVXBzdHJlYW1Db3JyZWxhdGlvbklkPzogc3RyaW5nOyBpc01peGVkQmF0Y2g6IGJvb2xlYW4gfSB7XG4gICAgY29uc3QgdXBzdHJlYW1Db3JyZWxhdGlvbkNhbmRpZGF0ZXMgPSByZWNvcmRUcmFjZUNvbnRleHRzXG4gICAgICAubWFwKCh0KSA9PiB0Py5jb3JyZWxhdGlvbklkKVxuICAgICAgLmZpbHRlcigodik6IHYgaXMgc3RyaW5nID0+ICEhdik7XG4gICAgY29uc3QgYmF0Y2hVcHN0cmVhbUNvcnJlbGF0aW9uSWQgPVxuICAgICAgdXBzdHJlYW1Db3JyZWxhdGlvbkNhbmRpZGF0ZXMubGVuZ3RoID4gMCAmJiB1cHN0cmVhbUNvcnJlbGF0aW9uQ2FuZGlkYXRlcy5ldmVyeSgodikgPT4gdiA9PT0gdXBzdHJlYW1Db3JyZWxhdGlvbkNhbmRpZGF0ZXNbIDAgXSlcbiAgICAgICAgPyB1cHN0cmVhbUNvcnJlbGF0aW9uQ2FuZGlkYXRlc1sgMCBdXG4gICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgLy8gSW4gc3RyaWN0LWhpZXJhcmNoeSBtb2RlLCBjb3JyZWxhdGlvbklkIGlzIHBlci1pbnZvY2F0aW9uLiBVcHN0cmVhbSBjb3JyZWxhdGlvbklkIGJlY29tZXMgY2F1c2VkQnkuXG4gICAgY29uc3QgYmF0Y2hDYXVzZWRCeSA9IGJhdGNoVXBzdHJlYW1Db3JyZWxhdGlvbklkO1xuICAgIGNvbnN0IGlzTWl4ZWRCYXRjaCA9IHVwc3RyZWFtQ29ycmVsYXRpb25DYW5kaWRhdGVzLmxlbmd0aCA+IDEgJiYgYmF0Y2hVcHN0cmVhbUNvcnJlbGF0aW9uSWQgPT09IHVuZGVmaW5lZDtcblxuICAgIHJldHVybiB7IGJhdGNoQ2F1c2VkQnksIGJhdGNoVXBzdHJlYW1Db3JyZWxhdGlvbklkLCBpc01peGVkQmF0Y2ggfTtcbiAgfVxuXG4gIGFzeW5jIExhbWJkYUhhbmRsZXIoZXZlbnQ6IFRFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8UXVldWVQcm9jZXNzUmVzdWx0PiB7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoXCJTUVMtTGFtYmRhSGFuZGxlciByZWNlaXZlZFwiLCB7IHJlY29yZENvdW50OiBldmVudC5SZWNvcmRzPy5sZW5ndGggfSk7XG4gICAgdGhpcy5pbml0aWFsaXplRW50cnlQYWNrYWdlc0FuZE9ic2VydmFiaWxpdHkoKTtcblxuICAgIGNvbnN0IHF1ZXVlTmFtZSA9IHRoaXMuZ2V0UXVldWVOYW1lKCkgfHwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IHF1ZXVlQ29uZmlnID0gdGhpcy5nZXRRdWV1ZUNvbmZpZygpO1xuICAgIGNvbnN0IG9ic0NvbmZpZyA9IHF1ZXVlQ29uZmlnLm9ic2VydmFiaWxpdHkgfHwge307XG5cbiAgICAvLyBFeHRyYWN0IGFuZCBhZ2dyZWdhdGUgdHJhY2UgY29udGV4dHNcbiAgICBjb25zdCByZWNvcmRUcmFjZUNvbnRleHRzID0gdGhpcy5leHRyYWN0UGVyUmVjb3JkVHJhY2VDb250ZXh0cyhldmVudCk7XG4gICAgY29uc3QgeyBiYXRjaENhdXNlZEJ5LCBiYXRjaFVwc3RyZWFtQ29ycmVsYXRpb25JZCwgaXNNaXhlZEJhdGNoIH0gPSB0aGlzLmFnZ3JlZ2F0ZUJhdGNoVHJhY2VDb250ZXh0KHJlY29yZFRyYWNlQ29udGV4dHMpO1xuXG4gICAgY29uc3QgaW52b2NhdGlvbklkID0gY29udGV4dC5hd3NSZXF1ZXN0SWQgfHwgZ2VuZXJhdGVUcmFjZUlkKCk7XG4gICAgLy8gU3RyaWN0IGhpZXJhcmNoeSBndWFyYW50ZWU6IGNvcnJlbGF0aW9uSWQgaXMgcGVyLWludm9jYXRpb24gKGxvY2FsIHNsaWNlKS5cbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW52b2NhdGlvbklkO1xuXG4gICAgY29uc3QgYmF0Y2hBY3RvcjogQWN0b3IgPSB7XG4gICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgIGF1dGhNZXRob2Q6ICdzeXN0ZW0nLFxuICAgICAgYWN0b3JJZDogYHF1ZXVlOiR7cXVldWVOYW1lfWAsXG4gICAgICByZXF1ZXN0SWQ6IGludm9jYXRpb25JZCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICB9O1xuXG4gICAgLy8gQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIGNvbnNpc3RlbnQgb2JzZXJ2YWJpbGl0eVxuICAgIGNvbnN0IGF1dG9tYXRpY1RhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBoYW5kbGVyX3R5cGU6ICdxdWV1ZScsXG4gICAgICBxdWV1ZV9uYW1lOiBxdWV1ZU5hbWUsXG4gICAgICBpc19iYXRjaDogJ3RydWUnLFxuICAgIH07XG5cbiAgICAvLyBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHQgd2l0aCBjdXN0b20gc291cmNlIGFuZCB0YWdzIGZyb20gZGVjb3JhdG9yXG4gICAgY29uc3QgZXhlY0N0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5OiBiYXRjaENhdXNlZEJ5LFxuICAgICAgYWN0b3I6IGJhdGNoQWN0b3IsXG4gICAgICAvLyBCYXRjaCBkb2Vzbid0IGhhdmUgYSBwYXJlbnQgbG9nIElEIGZyb20gU1FTIChyZWNvcmRzIGRvKVxuICAgICAgc291cmNlOiBvYnNDb25maWcuc291cmNlIHx8IGBxdWV1ZToke3F1ZXVlTmFtZX1gLFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAuLi5vYnNDb25maWcudGFncywgLy8gRGVjb3JhdG9yIHRhZ3Mgb3ZlcnJpZGUgYXV0b21hdGljXG4gICAgICAgIGludm9jYXRpb25JZCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBCdWlsZCBxdWV1ZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IGN0eDogUXVldWVFeGVjdXRpb25Db250ZXh0PFRFdmVudD4gPSB7XG4gICAgICBldmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICBleGVjdXRpb25Db250ZXh0OiBleGVjQ3R4LFxuICAgIH07XG5cbiAgICAvLyBSdW4gaGFuZGxlciB3aXRoaW4gZXhlY3V0aW9uIGNvbnRleHRcbiAgICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoZXhlY0N0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gVXNlIHRoZSBiYXNlIGNsYXNzIGhlbHBlciBmb3Igc3BhbiArIGZsdXNoIHBhdHRlcm5cbiAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGVXaXRoU3BhbkFuZEZsdXNoKFxuICAgICAgICBgU1FTIEJhdGNoICR7cXVldWVOYW1lfWAsXG4gICAgICAgIGFzeW5jIChxdWV1ZVNwYW4pID0+IHtcbiAgICAgICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmluaXRpYWxpemUoZXZlbnQsIGNvbnRleHQpO1xuXG4gICAgICAgICAgICAvLyBTUVMgcmV0cnkgZGV0ZWN0aW9uIOKAlCB0YWcgd2hlbiBtZXNzYWdlcyBhcmUgYmVpbmcgcmVwcm9jZXNzZWRcbiAgICAgICAgICAgIGNvbnN0IHJlY2VpdmVDb3VudHMgPSAoZXZlbnQuUmVjb3JkcyBhcyBBcnJheTx7IGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IH0+KS5tYXAoXG4gICAgICAgICAgICAgIChyKSA9PiBwYXJzZUludChyLmF0dHJpYnV0ZXM/LkFwcHJveGltYXRlUmVjZWl2ZUNvdW50ID8/ICcxJywgMTApXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29uc3QgbWF4UmVjZWl2ZUNvdW50ID0gTWF0aC5tYXgoLi4ucmVjZWl2ZUNvdW50cyk7XG4gICAgICAgICAgICBjb25zdCByZXRyeUNvdW50ID0gcmVjZWl2ZUNvdW50cy5maWx0ZXIoKGMpID0+IGMgPiAxKS5sZW5ndGg7XG4gICAgICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICAgICAgcXVldWVTcGFuLnRhZygnc3FzLmhhc19yZXRyaWVzJywgJ3RydWUnKTtcbiAgICAgICAgICAgICAgcXVldWVTcGFuLm1ldHJpY3Moe1xuICAgICAgICAgICAgICAgICdzcXMucmV0cnlfY291bnQnOiByZXRyeUNvdW50LFxuICAgICAgICAgICAgICAgICdzcXMubWF4X3JlY2VpdmVfY291bnQnOiBtYXhSZWNlaXZlQ291bnQsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3MoZXZlbnQsIGNvbnRleHQsIGN0eCk7XG4gICAgICAgICAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG5cbiAgICAgICAgICAgIC8vIERldGVybWluZSBzdWNjZXNzIGJhc2VkIG9uIHJlc3VsdFxuICAgICAgICAgICAgY29uc3QgaGFzRmFpbHVyZXMgPSByZXN1bHQgJiYgJ2JhdGNoSXRlbUZhaWx1cmVzJyBpbiByZXN1bHQgJiYgcmVzdWx0LmJhdGNoSXRlbUZhaWx1cmVzLmxlbmd0aCA+IDA7XG4gICAgICAgICAgICBjb25zdCBmYWlsdXJlQ291bnQgPSBoYXNGYWlsdXJlcyA/IHJlc3VsdC5iYXRjaEl0ZW1GYWlsdXJlcy5sZW5ndGggOiAwO1xuICAgICAgICAgICAgY29uc3QgdG90YWxDb3VudCA9IGV2ZW50LlJlY29yZHMubGVuZ3RoO1xuICAgICAgICAgICAgY29uc3Qgc3VjY2Vzc0NvdW50ID0gdG90YWxDb3VudCAtIGZhaWx1cmVDb3VudDtcblxuICAgICAgICAgICAgaWYgKGhhc0ZhaWx1cmVzKSB7XG4gICAgICAgICAgICAgIFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpPy5jaGVja3BvaW50Py4oJ3Nxcy5iYXRjaC5wYXJ0aWFsX2ZhaWx1cmUnLCB7XG4gICAgICAgICAgICAgICAgdGFnczoge1xuICAgICAgICAgICAgICAgICAgJ3Nxcy5oYXNfZmFpbHVyZXMnOiAndHJ1ZScsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAgICAgICAnc3FzLmJhdGNoLmZhaWx1cmVfY291bnQnOiBmYWlsdXJlQ291bnQsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNldCBmaW5hbCBtZXRyaWNzIG9uIHNwYW5cbiAgICAgICAgICAgIHF1ZXVlU3Bhbi5tZXRyaWNzKHtcbiAgICAgICAgICAgICAgJ3Nxcy5iYXRjaC5kdXJhdGlvbl9tcyc6IGR1cmF0aW9uLFxuICAgICAgICAgICAgICAnc3FzLmJhdGNoLnRvdGFsX2NvdW50JzogdG90YWxDb3VudCxcbiAgICAgICAgICAgICAgJ3Nxcy5iYXRjaC5zdWNjZXNzX2NvdW50Jzogc3VjY2Vzc0NvdW50LFxuICAgICAgICAgICAgICAnc3FzLmJhdGNoLmZhaWx1cmVfY291bnQnOiBmYWlsdXJlQ291bnQsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgICAgICAgICAgcXVldWVTcGFuLm1ldHJpY3Moe1xuICAgICAgICAgICAgICAnc3FzLmJhdGNoLmR1cmF0aW9uX21zJzogZHVyYXRpb24sXG4gICAgICAgICAgICAgICdzcXMuYmF0Y2gudG90YWxfY291bnQnOiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgICAgICAgICAgICAgJ3Nxcy5iYXRjaC5lcnJvcnMnOiAxLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGNhdXNlZEJ5OiBiYXRjaENhdXNlZEJ5LFxuICAgICAgICAgIHNvdXJjZTogb2JzQ29uZmlnLnNvdXJjZSB8fCBgcXVldWU6JHtxdWV1ZU5hbWV9YCxcbiAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAgICAgLi4ub2JzQ29uZmlnLnRhZ3MsXG4gICAgICAgICAgICAnc3FzLnF1ZXVlTmFtZSc6IHF1ZXVlTmFtZSxcbiAgICAgICAgICAgICdmYWFzLmV4ZWN1dGlvbic6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxuICAgICAgICAgICAgLi4uKGlzTWl4ZWRCYXRjaCA/IHsgJ3RyYWNlLm1peGVkJzogJ3RydWUnIH0gOiB7fSksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgICAnc3FzLmJhdGNoU2l6ZSc6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGNvbnRleHRcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IHsgUXVldWVDb250cm9sbGVyIH07XG4iXX0=