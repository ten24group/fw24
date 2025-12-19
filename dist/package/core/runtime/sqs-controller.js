"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
const observability_1 = require("../../observability");
const execution_context_1 = require("./execution-context");
/**
 * Base class for handling SQS events.
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
    async LambdaHandler(event, context) {
        this.logger.debug("SQS-LambdaHandler received", { recordCount: event.Records?.length });
        this.initializeEntryPackagesAndObservability();
        const queueName = this.getQueueName() || this.constructor.name;
        const queueConfig = this.getQueueConfig();
        const obsConfig = queueConfig.observability || {};
        // CRITICAL FIX: Do not use Records[0] for context.
        // Each record has its own trace. The Lambda invocation itself represents a "Batch"
        // and should have its own unique correlation ID (Lambda Request ID).
        // Individual record processing should extract context per record.
        // Use W3C Trace ID format for consistency with observability system
        const correlationId = context.awsRequestId || (0, observability_1.generateTraceId)();
        // Build automatic tags for consistent observability
        const automaticTags = {
            handler_type: 'queue',
            queue_name: queueName,
            is_batch: 'true',
        };
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            // Batch doesn't have a parent log ID from SQS (records do)
            source: obsConfig.source || `queue:${queueName}`,
            tags: {
                ...automaticTags,
                ...obsConfig.tags, // Decorator tags override automatic
            },
        });
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Create span with merged tags (consistent with API Gateway and Task)
            const queueSpan = observability_1.SpanObserver.start(`SQS Batch ${queueName}`, {
                correlationId,
                source: obsConfig.source || `queue:${queueName}`,
                tags: {
                    ...automaticTags,
                    ...obsConfig.tags, // Decorator tags override automatic
                },
                attributes: {
                    'sqs.queueName': queueName,
                    'sqs.batchSize': event.Records.length,
                    'faas.execution': context.awsRequestId,
                    ...obsConfig.attributes,
                },
            });
            // Store span ID in execution context for child spans
            (0, execution_context_1.setParentObservabilityLogId)(queueSpan.id);
            // Build queue execution context
            const ctx = {
                event: event,
                lambdaContext: context,
                executionContext: execCtx,
            };
            let spanEnded = false;
            const endSpan = async (success, error, metrics) => {
                if (!spanEnded) {
                    queueSpan.end({ success, error, metrics });
                    spanEnded = true;
                }
                await this.flushObservability();
            };
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
                    queueSpan.setAttribute('sqs.failure_count', failureCount);
                    queueSpan.setAttribute('sqs.success_count', successCount);
                    queueSpan.addEvent('sqs.batch.partial_failure', {
                        level: 'warn',
                        metrics: {
                            'sqs.failure_count': failureCount,
                            'sqs.success_count': successCount,
                            'sqs.total_count': totalCount,
                        },
                        attributes: {
                            'sqs.has_failures': true,
                        },
                    });
                }
                await endSpan(!hasFailures, undefined, {
                    'sqs.batch.duration_ms': duration,
                    'sqs.batch.total_count': totalCount,
                    'sqs.batch.success_count': successCount,
                    'sqs.batch.failure_count': failureCount,
                });
                return result;
            }
            catch (error) {
                const duration = Date.now() - startTime;
                await endSpan(false, error, {
                    'sqs.batch.duration_ms': duration,
                    'sqs.batch.total_count': event.Records.length,
                    'sqs.batch.errors': 1,
                });
                throw error;
            }
        });
    }
}
exports.QueueController = QueueController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSx1REFBb0U7QUFDcEUsMkRBTTZCO0FBcUI3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWUsZUFBb0QsU0FBUSwrQ0FBcUI7SUFFcEYsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUNwRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBZ0JTLGNBQWM7UUFDdEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDaEQsQ0FBQztJQUVTLFlBQVk7UUFDcEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXLENBQXVCLENBQUM7SUFDOUQsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBYSxFQUFFLE9BQWdCO1FBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDRCQUE0QixFQUFFLEVBQUUsV0FBVyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUN4RixJQUFJLENBQUMsdUNBQXVDLEVBQUUsQ0FBQztRQUUvQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDL0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQzFDLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBRWxELG1EQUFtRDtRQUNuRCxtRkFBbUY7UUFDbkYscUVBQXFFO1FBQ3JFLGtFQUFrRTtRQUNsRSxvRUFBb0U7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QztDQUNGO0FBRVEsMENBQWUiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTUVNFdmVudCwgU1FTQmF0Y2hSZXNwb25zZSwgQ29udGV4dCB9IGZyb20gXCJhd3MtbGFtYmRhXCI7XG5pbXBvcnQgeyBBYnN0cmFjdExhbWJkYUhhbmRsZXIgfSBmcm9tIFwiLi9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlclwiO1xuaW1wb3J0IHsgSVF1ZXVlQ29uZmlnIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycy9xdWV1ZSc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIGdlbmVyYXRlVHJhY2VJZCB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBleHRyYWN0RnJvbVNxcyxcbiAgc2V0UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxufSBmcm9tICcuL2V4ZWN1dGlvbi1jb250ZXh0JztcblxuLyoqXG4gKiBSZXN1bHQgdHlwZSBmb3IgcXVldWUgcHJvY2Vzc2luZy5cbiAqIC0gdm9pZDogQWxsIG1lc3NhZ2VzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHlcbiAqIC0gU1FTQmF0Y2hSZXNwb25zZTogUGFydGlhbCBiYXRjaCBmYWlsdXJlIChzb21lIG1lc3NhZ2VzIG5lZWQgcmV0cnkpXG4gKi9cbmV4cG9ydCB0eXBlIFF1ZXVlUHJvY2Vzc1Jlc3VsdCA9IHZvaWQgfCBTUVNCYXRjaFJlc3BvbnNlO1xuXG4vKipcbiAqIFF1ZXVlIGV4ZWN1dGlvbiBjb250ZXh0IC0gY29udGFpbnMgcXVldWUtc3BlY2lmaWMgZGF0YSBBTkQgZXhlY3V0aW9uIGNvbnRleHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUXVldWVFeGVjdXRpb25Db250ZXh0IHtcbiAgLyoqIFRoZSBTUVMgZXZlbnQgKi9cbiAgcmVhZG9ubHkgZXZlbnQ6IFNRU0V2ZW50O1xuICAvKiogTGFtYmRhIGNvbnRleHQgKi9cbiAgcmVhZG9ubHkgbGFtYmRhQ29udGV4dDogQ29udGV4dDtcbiAgLyoqIEV4ZWN1dGlvbiBjb250ZXh0IChhbHNvIGF2YWlsYWJsZSB2aWEgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSkgKi9cbiAgcmVhZG9ubHkgZXhlY3V0aW9uQ29udGV4dDogRXhlY3V0aW9uQ29udGV4dERhdGE7XG59XG5cbi8qKlxuICogQmFzZSBjbGFzcyBmb3IgaGFuZGxpbmcgU1FTIGV2ZW50cy5cbiAqIFxuICogR2VuZXJpYyBURXZlbnQgYWxsb3dzIHN1YmNsYXNzZXMgdG8gc3BlY2lmeSBtb3JlIHNwZWNpZmljIGV2ZW50IHR5cGVzXG4gKiB3aGlsZSBtYWludGFpbmluZyB0eXBlIHNhZmV0eS5cbiAqIFxuICogQWxsIGhhbmRsZXIgZXhlY3V0aW9uIGlzIHdyYXBwZWQgaW4gZXhlY3V0aW9uIGNvbnRleHQuXG4gKiBDb25maWd1cmUgb2JzZXJ2YWJpbGl0eSB2aWEgdGhlIEBRdWV1ZSBkZWNvcmF0b3I6XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBAUXVldWUoJ215LXF1ZXVlJywge1xuICogICBvYnNlcnZhYmlsaXR5OiB7XG4gKiAgICAgc291cmNlOiAnZG9tYWluOnF1ZXVlLXR5cGUnLFxuICogICAgIHRhZ3M6IHsgZG9tYWluOiAnc3BvcnRzJywgcHJpb3JpdHk6ICdoaWdoJyB9XG4gKiAgIH1cbiAqIH0pXG4gKiBleHBvcnQgY2xhc3MgTXlRdWV1ZSBleHRlbmRzIFF1ZXVlQ29udHJvbGxlciB7IH1cbiAqIGBgYFxuICovXG5hYnN0cmFjdCBjbGFzcyBRdWV1ZUNvbnRyb2xsZXI8VEV2ZW50IGV4dGVuZHMgU1FTRXZlbnQgPSBTUVNFdmVudD4gZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuXG4gIHByb3RlY3RlZCBpbml0aWFsaXplKF9ldmVudDogVEV2ZW50LCBfY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIHRoZSBxdWV1ZSBldmVudC5cbiAgICogXG4gICAqIFJldHVybiBgdm9pZGAgaWYgYWxsIG1lc3NhZ2VzIHByb2Nlc3NlZCBzdWNjZXNzZnVsbHkuXG4gICAqIFJldHVybiBgU1FTQmF0Y2hSZXNwb25zZWAgd2l0aCBgYmF0Y2hJdGVtRmFpbHVyZXNgIGZvciBwYXJ0aWFsIGJhdGNoIGZhaWx1cmVzXG4gICAqIChyZXF1aXJlcyBgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IHRydWVgIGluIHF1ZXVlIGNvbmZpZykuXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgZXZlbnRcbiAgICogQHBhcmFtIGNvbnRleHQgLSBUaGUgTGFtYmRhIGNvbnRleHQgIFxuICAgKiBAcGFyYW0gY3R4IC0gUXVldWUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICogQHJldHVybnMgdm9pZCBvciBTUVNCYXRjaFJlc3BvbnNlIGZvciBwYXJ0aWFsIGJhdGNoIGZhaWx1cmVzXG4gICAqL1xuICBhYnN0cmFjdCBwcm9jZXNzKGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IENvbnRleHQsIGN0eD86IFF1ZXVlRXhlY3V0aW9uQ29udGV4dCk6IFByb21pc2U8UXVldWVQcm9jZXNzUmVzdWx0PjtcblxuICBwcm90ZWN0ZWQgZ2V0UXVldWVDb25maWcoKTogSVF1ZXVlQ29uZmlnIHtcbiAgICByZXR1cm4gUmVmbGVjdC5nZXQodGhpcywgJ3F1ZXVlQ29uZmlnJykgfHwge307XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0UXVldWVOYW1lKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZU5hbWUnKSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIH1cblxuICBhc3luYyBMYW1iZGFIYW5kbGVyKGV2ZW50OiBURXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPFF1ZXVlUHJvY2Vzc1Jlc3VsdD4ge1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiU1FTLUxhbWJkYUhhbmRsZXIgcmVjZWl2ZWRcIiwgeyByZWNvcmRDb3VudDogZXZlbnQuUmVjb3Jkcz8ubGVuZ3RoIH0pO1xuICAgIHRoaXMuaW5pdGlhbGl6ZUVudHJ5UGFja2FnZXNBbmRPYnNlcnZhYmlsaXR5KCk7XG5cbiAgICBjb25zdCBxdWV1ZU5hbWUgPSB0aGlzLmdldFF1ZXVlTmFtZSgpIHx8IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBxdWV1ZUNvbmZpZyA9IHRoaXMuZ2V0UXVldWVDb25maWcoKTtcbiAgICBjb25zdCBvYnNDb25maWcgPSBxdWV1ZUNvbmZpZy5vYnNlcnZhYmlsaXR5IHx8IHt9O1xuXG4gICAgLy8gQ1JJVElDQUwgRklYOiBEbyBub3QgdXNlIFJlY29yZHNbMF0gZm9yIGNvbnRleHQuXG4gICAgLy8gRWFjaCByZWNvcmQgaGFzIGl0cyBvd24gdHJhY2UuIFRoZSBMYW1iZGEgaW52b2NhdGlvbiBpdHNlbGYgcmVwcmVzZW50cyBhIFwiQmF0Y2hcIlxuICAgIC8vIGFuZCBzaG91bGQgaGF2ZSBpdHMgb3duIHVuaXF1ZSBjb3JyZWxhdGlvbiBJRCAoTGFtYmRhIFJlcXVlc3QgSUQpLlxuICAgIC8vIEluZGl2aWR1YWwgcmVjb3JkIHByb2Nlc3Npbmcgc2hvdWxkIGV4dHJhY3QgY29udGV4dCBwZXIgcmVjb3JkLlxuICAgIC8vIFVzZSBXM0MgVHJhY2UgSUQgZm9ybWF0IGZvciBjb25zaXN0ZW5jeSB3aXRoIG9ic2VydmFiaWxpdHkgc3lzdGVtXG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGNvbnRleHQuYXdzUmVxdWVzdElkIHx8IGdlbmVyYXRlVHJhY2VJZCgpO1xuXG4gICAgLy8gQnVpbGQgYXV0b21hdGljIHRhZ3MgZm9yIGNvbnNpc3RlbnQgb2JzZXJ2YWJpbGl0eVxuICAgIGNvbnN0IGF1dG9tYXRpY1RhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBoYW5kbGVyX3R5cGU6ICdxdWV1ZScsXG4gICAgICBxdWV1ZV9uYW1lOiBxdWV1ZU5hbWUsXG4gICAgICBpc19iYXRjaDogJ3RydWUnLFxuICAgIH07XG5cbiAgICAvLyBDcmVhdGUgZXhlY3V0aW9uIGNvbnRleHQgd2l0aCBjdXN0b20gc291cmNlIGFuZCB0YWdzIGZyb20gZGVjb3JhdG9yXG4gICAgY29uc3QgZXhlY0N0eCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIC8vIEJhdGNoIGRvZXNuJ3QgaGF2ZSBhIHBhcmVudCBsb2cgSUQgZnJvbSBTUVMgKHJlY29yZHMgZG8pXG4gICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHF1ZXVlOiR7cXVldWVOYW1lfWAsXG4gICAgICB0YWdzOiB7XG4gICAgICAgIC4uLmF1dG9tYXRpY1RhZ3MsXG4gICAgICAgIC4uLm9ic0NvbmZpZy50YWdzLCAvLyBEZWNvcmF0b3IgdGFncyBvdmVycmlkZSBhdXRvbWF0aWNcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBSdW4gaGFuZGxlciB3aXRoaW4gZXhlY3V0aW9uIGNvbnRleHRcbiAgICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoZXhlY0N0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQ3JlYXRlIHNwYW4gd2l0aCBtZXJnZWQgdGFncyAoY29uc2lzdGVudCB3aXRoIEFQSSBHYXRld2F5IGFuZCBUYXNrKVxuICAgICAgY29uc3QgcXVldWVTcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGBTUVMgQmF0Y2ggJHtxdWV1ZU5hbWV9YCwge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHF1ZXVlOiR7cXVldWVOYW1lfWAsXG4gICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAuLi5hdXRvbWF0aWNUYWdzLFxuICAgICAgICAgIC4uLm9ic0NvbmZpZy50YWdzLCAvLyBEZWNvcmF0b3IgdGFncyBvdmVycmlkZSBhdXRvbWF0aWNcbiAgICAgICAgfSxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdzcXMucXVldWVOYW1lJzogcXVldWVOYW1lLFxuICAgICAgICAgICdzcXMuYmF0Y2hTaXplJzogZXZlbnQuUmVjb3Jkcy5sZW5ndGgsXG4gICAgICAgICAgJ2ZhYXMuZXhlY3V0aW9uJzogY29udGV4dC5hd3NSZXF1ZXN0SWQsXG4gICAgICAgICAgLi4ub2JzQ29uZmlnLmF0dHJpYnV0ZXMsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gU3RvcmUgc3BhbiBJRCBpbiBleGVjdXRpb24gY29udGV4dCBmb3IgY2hpbGQgc3BhbnNcbiAgICAgIHNldFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZChxdWV1ZVNwYW4uaWQpO1xuXG4gICAgICAvLyBCdWlsZCBxdWV1ZSBleGVjdXRpb24gY29udGV4dFxuICAgICAgY29uc3QgY3R4OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQgPSB7XG4gICAgICAgIGV2ZW50OiBldmVudCBhcyBTUVNFdmVudCxcbiAgICAgICAgbGFtYmRhQ29udGV4dDogY29udGV4dCxcbiAgICAgICAgZXhlY3V0aW9uQ29udGV4dDogZXhlY0N0eCxcbiAgICAgIH07XG5cbiAgICAgIGxldCBzcGFuRW5kZWQgPSBmYWxzZTtcbiAgICAgIGNvbnN0IGVuZFNwYW4gPSBhc3luYyAoc3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBFcnJvciwgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj4pOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICAgICAgaWYgKCFzcGFuRW5kZWQpIHtcbiAgICAgICAgICBxdWV1ZVNwYW4uZW5kKHsgc3VjY2VzcywgZXJyb3IsIG1ldHJpY3MgfSk7XG4gICAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLmZsdXNoT2JzZXJ2YWJpbGl0eSgpO1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2VzcyhldmVudCwgY29udGV4dCwgY3R4KTtcbiAgICAgICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuXG4gICAgICAgIC8vIERldGVybWluZSBzdWNjZXNzIGJhc2VkIG9uIHJlc3VsdFxuICAgICAgICBjb25zdCBoYXNGYWlsdXJlcyA9IHJlc3VsdCAmJiAnYmF0Y2hJdGVtRmFpbHVyZXMnIGluIHJlc3VsdCAmJiByZXN1bHQuYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoID4gMDtcbiAgICAgICAgY29uc3QgZmFpbHVyZUNvdW50ID0gaGFzRmFpbHVyZXMgPyByZXN1bHQuYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoIDogMDtcbiAgICAgICAgY29uc3QgdG90YWxDb3VudCA9IGV2ZW50LlJlY29yZHMubGVuZ3RoO1xuICAgICAgICBjb25zdCBzdWNjZXNzQ291bnQgPSB0b3RhbENvdW50IC0gZmFpbHVyZUNvdW50O1xuXG4gICAgICAgIGlmIChoYXNGYWlsdXJlcykge1xuICAgICAgICAgIHF1ZXVlU3Bhbi5zZXRBdHRyaWJ1dGUoJ3Nxcy5mYWlsdXJlX2NvdW50JywgZmFpbHVyZUNvdW50KTtcbiAgICAgICAgICBxdWV1ZVNwYW4uc2V0QXR0cmlidXRlKCdzcXMuc3VjY2Vzc19jb3VudCcsIHN1Y2Nlc3NDb3VudCk7XG4gICAgICAgICAgcXVldWVTcGFuLmFkZEV2ZW50KCdzcXMuYmF0Y2gucGFydGlhbF9mYWlsdXJlJywge1xuICAgICAgICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAgICAgJ3Nxcy5mYWlsdXJlX2NvdW50JzogZmFpbHVyZUNvdW50LFxuICAgICAgICAgICAgICAnc3FzLnN1Y2Nlc3NfY291bnQnOiBzdWNjZXNzQ291bnQsXG4gICAgICAgICAgICAgICdzcXMudG90YWxfY291bnQnOiB0b3RhbENvdW50LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgICAgJ3Nxcy5oYXNfZmFpbHVyZXMnOiB0cnVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IGVuZFNwYW4oIWhhc0ZhaWx1cmVzLCB1bmRlZmluZWQsIHtcbiAgICAgICAgICAnc3FzLmJhdGNoLmR1cmF0aW9uX21zJzogZHVyYXRpb24sXG4gICAgICAgICAgJ3Nxcy5iYXRjaC50b3RhbF9jb3VudCc6IHRvdGFsQ291bnQsXG4gICAgICAgICAgJ3Nxcy5iYXRjaC5zdWNjZXNzX2NvdW50Jzogc3VjY2Vzc0NvdW50LFxuICAgICAgICAgICdzcXMuYmF0Y2guZmFpbHVyZV9jb3VudCc6IGZhaWx1cmVDb3VudCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICAgICAgYXdhaXQgZW5kU3BhbihmYWxzZSwgZXJyb3IgYXMgRXJyb3IsIHtcbiAgICAgICAgICAnc3FzLmJhdGNoLmR1cmF0aW9uX21zJzogZHVyYXRpb24sXG4gICAgICAgICAgJ3Nxcy5iYXRjaC50b3RhbF9jb3VudCc6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgICAgICdzcXMuYmF0Y2guZXJyb3JzJzogMSxcbiAgICAgICAgfSk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCB7IFF1ZXVlQ29udHJvbGxlciB9O1xuIl19