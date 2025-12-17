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
        const correlationId = context.awsRequestId || crypto.randomUUID();
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            // Batch doesn't have a parent log ID from SQS (records do)
            source: obsConfig.source || `queue:${queueName}`,
            tags: {
                queueName,
                isBatch: 'true',
                ...obsConfig.tags,
            },
        });
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Create span with custom attributes from decorator
            const queueSpan = observability_1.SpanObserver.start(`SQS Batch ${queueName}`, {
                correlationId,
                source: obsConfig.source || `queue:${queueName}`,
                tags: obsConfig.tags,
                attributes: {
                    'sqs.queueName': queueName,
                    'sqs.batchSize': event.Records.length,
                    'faas.execution': context.awsRequestId,
                    ...obsConfig.attributes,
                },
            });
            // Store span ID in execution context for child spans
            execCtx.parentObservabilityLogId = queueSpan.id;
            // Build queue execution context
            const ctx = {
                event: event,
                lambdaContext: context,
                executionContext: execCtx,
            };
            let spanEnded = false;
            const endSpan = async (success, error) => {
                if (!spanEnded) {
                    queueSpan.end({ success, error });
                    spanEnded = true;
                }
                await this.flushObservability();
            };
            try {
                await this.initialize(event, context);
                const result = await this.process(event, context, ctx);
                // Determine success based on result
                const hasFailures = result && 'batchItemFailures' in result && result.batchItemFailures.length > 0;
                await endSpan(!hasFailures);
                return result;
            }
            catch (error) {
                await endSpan(false, error);
                throw error;
            }
        });
    }
}
exports.QueueController = QueueController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSx1REFBbUQ7QUFDbkQsMkRBSzZCO0FBcUI3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWUsZUFBb0QsU0FBUSwrQ0FBcUI7SUFFcEYsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUNwRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBZ0JTLGNBQWM7UUFDdEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDaEQsQ0FBQztJQUVTLFlBQVk7UUFDcEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXLENBQXVCLENBQUM7SUFDOUQsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBYSxFQUFFLE9BQWdCO1FBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDRCQUE0QixFQUFFLEVBQUUsV0FBVyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUN4RixJQUFJLENBQUMsdUNBQXVDLEVBQUUsQ0FBQztRQUUvQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDL0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQzFDLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBRWxELG1EQUFtRDtRQUNuRCxtRkFBbUY7UUFDbkYscUVBQXFFO1FBQ3JFLGtFQUFrRTtRQUNsRSxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsWUFBWSxJQUFJLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUVsRSxzRUFBc0U7UUFDdEUsTUFBTSxPQUFPLEdBQUcsSUFBQSwwQ0FBc0IsRUFBQztZQUNyQyxhQUFhO1lBQ2IsMkRBQTJEO1lBQzNELE1BQU0sRUFBRSxTQUFTLENBQUMsTUFBTSxJQUFJLFNBQVMsU0FBUyxFQUFFO1lBQ2hELElBQUksRUFBRTtnQkFDSixTQUFTO2dCQUNULE9BQU8sRUFBRSxNQUFNO2dCQUNmLEdBQUcsU0FBUyxDQUFDLElBQUk7YUFDbEI7U0FDRixDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsT0FBTyxJQUFBLDJDQUF1QixFQUFDLE9BQU8sRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRCxvREFBb0Q7WUFDcEQsTUFBTSxTQUFTLEdBQUcsNEJBQVksQ0FBQyxLQUFLLENBQUMsYUFBYSxTQUFTLEVBQUUsRUFBRTtnQkFDN0QsYUFBYTtnQkFDYixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sSUFBSSxTQUFTLFNBQVMsRUFBRTtnQkFDaEQsSUFBSSxFQUFFLFNBQVMsQ0FBQyxJQUFJO2dCQUNwQixVQUFVLEVBQUU7b0JBQ1YsZUFBZSxFQUFFLFNBQVM7b0JBQzFCLGVBQWUsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU07b0JBQ3JDLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxZQUFZO29CQUN0QyxHQUFHLFNBQVMsQ0FBQyxVQUFVO2lCQUN4QjthQUNGLENBQUMsQ0FBQztZQUVILHFEQUFxRDtZQUNyRCxPQUFPLENBQUMsd0JBQXdCLEdBQUcsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUVoRCxnQ0FBZ0M7WUFDaEMsTUFBTSxHQUFHLEdBQTBCO2dCQUNqQyxLQUFLLEVBQUUsS0FBaUI7Z0JBQ3hCLGFBQWEsRUFBRSxPQUFPO2dCQUN0QixnQkFBZ0IsRUFBRSxPQUFPO2FBQzFCLENBQUM7WUFFRixJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUM7WUFDdEIsTUFBTSxPQUFPLEdBQUcsS0FBSyxFQUFFLE9BQWdCLEVBQUUsS0FBYSxFQUFpQixFQUFFO2dCQUN2RSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7b0JBQ2YsU0FBUyxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO29CQUNsQyxTQUFTLEdBQUcsSUFBSSxDQUFDO2dCQUNuQixDQUFDO2dCQUNELE1BQU0sSUFBSSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDbEMsQ0FBQyxDQUFDO1lBRUYsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ3RDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDO2dCQUV2RCxvQ0FBb0M7Z0JBQ3BDLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxtQkFBbUIsSUFBSSxNQUFNLElBQUksTUFBTSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7Z0JBQ25HLE1BQU0sT0FBTyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUM7Z0JBRTVCLE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sT0FBTyxDQUFDLEtBQUssRUFBRSxLQUFjLENBQUMsQ0FBQztnQkFDckMsTUFBTSxLQUFLLENBQUM7WUFDZCxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFFUSwwQ0FBZSIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNRU0V2ZW50LCBTUVNCYXRjaFJlc3BvbnNlLCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBJUXVldWVDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3F1ZXVlJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBleHRyYWN0RnJvbVNxcyxcbn0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5cbi8qKlxuICogUmVzdWx0IHR5cGUgZm9yIHF1ZXVlIHByb2Nlc3NpbmcuXG4gKiAtIHZvaWQ6IEFsbCBtZXNzYWdlcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5XG4gKiAtIFNRU0JhdGNoUmVzcG9uc2U6IFBhcnRpYWwgYmF0Y2ggZmFpbHVyZSAoc29tZSBtZXNzYWdlcyBuZWVkIHJldHJ5KVxuICovXG5leHBvcnQgdHlwZSBRdWV1ZVByb2Nlc3NSZXN1bHQgPSB2b2lkIHwgU1FTQmF0Y2hSZXNwb25zZTtcblxuLyoqXG4gKiBRdWV1ZSBleGVjdXRpb24gY29udGV4dCAtIGNvbnRhaW5zIHF1ZXVlLXNwZWNpZmljIGRhdGEgQU5EIGV4ZWN1dGlvbiBjb250ZXh0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXVlRXhlY3V0aW9uQ29udGV4dCB7XG4gIC8qKiBUaGUgU1FTIGV2ZW50ICovXG4gIHJlYWRvbmx5IGV2ZW50OiBTUVNFdmVudDtcbiAgLyoqIExhbWJkYSBjb250ZXh0ICovXG4gIHJlYWRvbmx5IGxhbWJkYUNvbnRleHQ6IENvbnRleHQ7XG4gIC8qKiBFeGVjdXRpb24gY29udGV4dCAoYWxzbyBhdmFpbGFibGUgdmlhIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCkpICovXG4gIHJlYWRvbmx5IGV4ZWN1dGlvbkNvbnRleHQ6IEV4ZWN1dGlvbkNvbnRleHREYXRhO1xufVxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIFNRUyBldmVudHMuXG4gKiBcbiAqIEdlbmVyaWMgVEV2ZW50IGFsbG93cyBzdWJjbGFzc2VzIHRvIHNwZWNpZnkgbW9yZSBzcGVjaWZpYyBldmVudCB0eXBlc1xuICogd2hpbGUgbWFpbnRhaW5pbmcgdHlwZSBzYWZldHkuXG4gKiBcbiAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LlxuICogQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgdmlhIHRoZSBAUXVldWUgZGVjb3JhdG9yOlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogQFF1ZXVlKCdteS1xdWV1ZScsIHtcbiAqICAgb2JzZXJ2YWJpbGl0eToge1xuICogICAgIHNvdXJjZTogJ2RvbWFpbjpxdWV1ZS10eXBlJyxcbiAqICAgICB0YWdzOiB7IGRvbWFpbjogJ3Nwb3J0cycsIHByaW9yaXR5OiAnaGlnaCcgfVxuICogICB9XG4gKiB9KVxuICogZXhwb3J0IGNsYXNzIE15UXVldWUgZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIgeyB9XG4gKiBgYGBcbiAqL1xuYWJzdHJhY3QgY2xhc3MgUXVldWVDb250cm9sbGVyPFRFdmVudCBleHRlbmRzIFNRU0V2ZW50ID0gU1FTRXZlbnQ+IGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcblxuICBwcm90ZWN0ZWQgaW5pdGlhbGl6ZShfZXZlbnQ6IFRFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyB0aGUgcXVldWUgZXZlbnQuXG4gICAqIFxuICAgKiBSZXR1cm4gYHZvaWRgIGlmIGFsbCBtZXNzYWdlcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5LlxuICAgKiBSZXR1cm4gYFNRU0JhdGNoUmVzcG9uc2VgIHdpdGggYGJhdGNoSXRlbUZhaWx1cmVzYCBmb3IgcGFydGlhbCBiYXRjaCBmYWlsdXJlc1xuICAgKiAocmVxdWlyZXMgYHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlYCBpbiBxdWV1ZSBjb25maWcpLlxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50XG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIExhbWJkYSBjb250ZXh0ICBcbiAgICogQHBhcmFtIGN0eCAtIFF1ZXVlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAqIEByZXR1cm5zIHZvaWQgb3IgU1FTQmF0Y2hSZXNwb25zZSBmb3IgcGFydGlhbCBiYXRjaCBmYWlsdXJlc1xuICAgKi9cbiAgYWJzdHJhY3QgcHJvY2VzcyhldmVudDogVEV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCBjdHg/OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFF1ZXVlUHJvY2Vzc1Jlc3VsdD47XG5cbiAgcHJvdGVjdGVkIGdldFF1ZXVlQ29uZmlnKCk6IElRdWV1ZUNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZUNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldFF1ZXVlTmFtZSgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAncXVldWVOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogVEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxRdWV1ZVByb2Nlc3NSZXN1bHQ+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUy1MYW1iZGFIYW5kbGVyIHJlY2VpdmVkXCIsIHsgcmVjb3JkQ291bnQ6IGV2ZW50LlJlY29yZHM/Lmxlbmd0aCB9KTtcbiAgICB0aGlzLmluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpO1xuXG4gICAgY29uc3QgcXVldWVOYW1lID0gdGhpcy5nZXRRdWV1ZU5hbWUoKSB8fCB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgcXVldWVDb25maWcgPSB0aGlzLmdldFF1ZXVlQ29uZmlnKCk7XG4gICAgY29uc3Qgb2JzQ29uZmlnID0gcXVldWVDb25maWcub2JzZXJ2YWJpbGl0eSB8fCB7fTtcblxuICAgIC8vIENSSVRJQ0FMIEZJWDogRG8gbm90IHVzZSBSZWNvcmRzWzBdIGZvciBjb250ZXh0LlxuICAgIC8vIEVhY2ggcmVjb3JkIGhhcyBpdHMgb3duIHRyYWNlLiBUaGUgTGFtYmRhIGludm9jYXRpb24gaXRzZWxmIHJlcHJlc2VudHMgYSBcIkJhdGNoXCJcbiAgICAvLyBhbmQgc2hvdWxkIGhhdmUgaXRzIG93biB1bmlxdWUgY29ycmVsYXRpb24gSUQgKExhbWJkYSBSZXF1ZXN0IElEKS5cbiAgICAvLyBJbmRpdmlkdWFsIHJlY29yZCBwcm9jZXNzaW5nIHNob3VsZCBleHRyYWN0IGNvbnRleHQgcGVyIHJlY29yZC5cbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gY29udGV4dC5hd3NSZXF1ZXN0SWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKTtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgLy8gQmF0Y2ggZG9lc24ndCBoYXZlIGEgcGFyZW50IGxvZyBJRCBmcm9tIFNRUyAocmVjb3JkcyBkbylcbiAgICAgIHNvdXJjZTogb2JzQ29uZmlnLnNvdXJjZSB8fCBgcXVldWU6JHtxdWV1ZU5hbWV9YCxcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgcXVldWVOYW1lLFxuICAgICAgICBpc0JhdGNoOiAndHJ1ZScsXG4gICAgICAgIC4uLm9ic0NvbmZpZy50YWdzLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFJ1biBoYW5kbGVyIHdpdGhpbiBleGVjdXRpb24gY29udGV4dFxuICAgIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChleGVjQ3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgc3BhbiB3aXRoIGN1c3RvbSBhdHRyaWJ1dGVzIGZyb20gZGVjb3JhdG9yXG4gICAgICBjb25zdCBxdWV1ZVNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoYFNRUyBCYXRjaCAke3F1ZXVlTmFtZX1gLCB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgIHNvdXJjZTogb2JzQ29uZmlnLnNvdXJjZSB8fCBgcXVldWU6JHtxdWV1ZU5hbWV9YCxcbiAgICAgICAgdGFnczogb2JzQ29uZmlnLnRhZ3MsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAnc3FzLnF1ZXVlTmFtZSc6IHF1ZXVlTmFtZSxcbiAgICAgICAgICAnc3FzLmJhdGNoU2l6ZSc6IGV2ZW50LlJlY29yZHMubGVuZ3RoLFxuICAgICAgICAgICdmYWFzLmV4ZWN1dGlvbic6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxuICAgICAgICAgIC4uLm9ic0NvbmZpZy5hdHRyaWJ1dGVzLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0b3JlIHNwYW4gSUQgaW4gZXhlY3V0aW9uIGNvbnRleHQgZm9yIGNoaWxkIHNwYW5zXG4gICAgICBleGVjQ3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHF1ZXVlU3Bhbi5pZDtcblxuICAgICAgLy8gQnVpbGQgcXVldWUgZXhlY3V0aW9uIGNvbnRleHRcbiAgICAgIGNvbnN0IGN0eDogUXVldWVFeGVjdXRpb25Db250ZXh0ID0ge1xuICAgICAgICBldmVudDogZXZlbnQgYXMgU1FTRXZlbnQsXG4gICAgICAgIGxhbWJkYUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICAgIGV4ZWN1dGlvbkNvbnRleHQ6IGV4ZWNDdHgsXG4gICAgICB9O1xuXG4gICAgICBsZXQgc3BhbkVuZGVkID0gZmFsc2U7XG4gICAgICBjb25zdCBlbmRTcGFuID0gYXN5bmMgKHN1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogRXJyb3IpOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICAgICAgaWYgKCFzcGFuRW5kZWQpIHtcbiAgICAgICAgICBxdWV1ZVNwYW4uZW5kKHsgc3VjY2VzcywgZXJyb3IgfSk7XG4gICAgICAgICAgc3BhbkVuZGVkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB0aGlzLmZsdXNoT2JzZXJ2YWJpbGl0eSgpO1xuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5pbml0aWFsaXplKGV2ZW50LCBjb250ZXh0KTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzKGV2ZW50LCBjb250ZXh0LCBjdHgpO1xuXG4gICAgICAgIC8vIERldGVybWluZSBzdWNjZXNzIGJhc2VkIG9uIHJlc3VsdFxuICAgICAgICBjb25zdCBoYXNGYWlsdXJlcyA9IHJlc3VsdCAmJiAnYmF0Y2hJdGVtRmFpbHVyZXMnIGluIHJlc3VsdCAmJiByZXN1bHQuYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoID4gMDtcbiAgICAgICAgYXdhaXQgZW5kU3BhbighaGFzRmFpbHVyZXMpO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBhd2FpdCBlbmRTcGFuKGZhbHNlLCBlcnJvciBhcyBFcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCB7IFF1ZXVlQ29udHJvbGxlciB9O1xuIl19