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
        this.initializeObservability();
        const queueName = this.getQueueName() || this.constructor.name;
        const queueConfig = this.getQueueConfig();
        const obsConfig = queueConfig.observability || {};
        const messageAttributes = event.Records?.[0]?.messageAttributes || {};
        const traceContext = (0, execution_context_1.extractFromSqs)(messageAttributes);
        const correlationId = traceContext?.correlationId || context.awsRequestId || crypto.randomUUID();
        // Create execution context with custom source and tags from decorator
        const execCtx = (0, execution_context_1.createExecutionContext)({
            correlationId,
            parentObservabilityLogId: traceContext?.parentObservabilityLogId,
            sampled: traceContext?.sampled,
            source: obsConfig.source || `queue:${queueName}`,
            tags: {
                queueName,
                ...obsConfig.tags,
            },
        });
        // Run handler within execution context
        return (0, execution_context_1.runWithExecutionContext)(execCtx, async () => {
            // Create span with custom attributes from decorator
            const queueSpan = observability_1.SpanObserver.start(`SQS ${queueName}`, {
                correlationId,
                parentObservabilityLogId: traceContext?.parentObservabilityLogId,
                source: obsConfig.source || `queue:${queueName}`,
                tags: obsConfig.tags,
                attributes: {
                    'sqs.queueName': queueName,
                    'sqs.batchSize': event.Records.length,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FzLWNvbnRyb2xsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL3Nxcy1jb250cm9sbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLHVFQUFrRTtBQUVsRSx1REFBbUQ7QUFDbkQsMkRBSzZCO0FBcUI3Qjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQWUsZUFBb0QsU0FBUSwrQ0FBcUI7SUFFcEYsVUFBVSxDQUFDLE1BQWMsRUFBRSxRQUFpQjtRQUNwRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBZ0JTLGNBQWM7UUFDdEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDaEQsQ0FBQztJQUVTLFlBQVk7UUFDcEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxXQUFXLENBQXVCLENBQUM7SUFDOUQsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsS0FBYSxFQUFFLE9BQWdCO1FBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDRCQUE0QixFQUFFLEVBQUUsV0FBVyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUN4RixJQUFJLENBQUMsdUJBQXVCLEVBQUUsQ0FBQztRQUUvQixNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDL0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQzFDLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ2xELE1BQU0saUJBQWlCLEdBQUcsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLGlC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bnNlLCBDb250ZXh0IH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcbmltcG9ydCB7IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9IGZyb20gXCIuL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyXCI7XG5pbXBvcnQgeyBJUXVldWVDb25maWcgfSBmcm9tICcuLi8uLi9kZWNvcmF0b3JzL3F1ZXVlJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHknO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBleHRyYWN0RnJvbVNxcyxcbn0gZnJvbSAnLi9leGVjdXRpb24tY29udGV4dCc7XG5cbi8qKlxuICogUmVzdWx0IHR5cGUgZm9yIHF1ZXVlIHByb2Nlc3NpbmcuXG4gKiAtIHZvaWQ6IEFsbCBtZXNzYWdlcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5XG4gKiAtIFNRU0JhdGNoUmVzcG9uc2U6IFBhcnRpYWwgYmF0Y2ggZmFpbHVyZSAoc29tZSBtZXNzYWdlcyBuZWVkIHJldHJ5KVxuICovXG5leHBvcnQgdHlwZSBRdWV1ZVByb2Nlc3NSZXN1bHQgPSB2b2lkIHwgU1FTQmF0Y2hSZXNwb25zZTtcblxuLyoqXG4gKiBRdWV1ZSBleGVjdXRpb24gY29udGV4dCAtIGNvbnRhaW5zIHF1ZXVlLXNwZWNpZmljIGRhdGEgQU5EIGV4ZWN1dGlvbiBjb250ZXh0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFF1ZXVlRXhlY3V0aW9uQ29udGV4dCB7XG4gIC8qKiBUaGUgU1FTIGV2ZW50ICovXG4gIHJlYWRvbmx5IGV2ZW50OiBTUVNFdmVudDtcbiAgLyoqIExhbWJkYSBjb250ZXh0ICovXG4gIHJlYWRvbmx5IGxhbWJkYUNvbnRleHQ6IENvbnRleHQ7XG4gIC8qKiBFeGVjdXRpb24gY29udGV4dCAoYWxzbyBhdmFpbGFibGUgdmlhIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCkpICovXG4gIHJlYWRvbmx5IGV4ZWN1dGlvbkNvbnRleHQ6IEV4ZWN1dGlvbkNvbnRleHREYXRhO1xufVxuXG4vKipcbiAqIEJhc2UgY2xhc3MgZm9yIGhhbmRsaW5nIFNRUyBldmVudHMuXG4gKiBcbiAqIEdlbmVyaWMgVEV2ZW50IGFsbG93cyBzdWJjbGFzc2VzIHRvIHNwZWNpZnkgbW9yZSBzcGVjaWZpYyBldmVudCB0eXBlc1xuICogd2hpbGUgbWFpbnRhaW5pbmcgdHlwZSBzYWZldHkuXG4gKiBcbiAqIEFsbCBoYW5kbGVyIGV4ZWN1dGlvbiBpcyB3cmFwcGVkIGluIGV4ZWN1dGlvbiBjb250ZXh0LlxuICogQ29uZmlndXJlIG9ic2VydmFiaWxpdHkgdmlhIHRoZSBAUXVldWUgZGVjb3JhdG9yOlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogQFF1ZXVlKCdteS1xdWV1ZScsIHtcbiAqICAgb2JzZXJ2YWJpbGl0eToge1xuICogICAgIHNvdXJjZTogJ2RvbWFpbjpxdWV1ZS10eXBlJyxcbiAqICAgICB0YWdzOiB7IGRvbWFpbjogJ3Nwb3J0cycsIHByaW9yaXR5OiAnaGlnaCcgfVxuICogICB9XG4gKiB9KVxuICogZXhwb3J0IGNsYXNzIE15UXVldWUgZXh0ZW5kcyBRdWV1ZUNvbnRyb2xsZXIgeyB9XG4gKiBgYGBcbiAqL1xuYWJzdHJhY3QgY2xhc3MgUXVldWVDb250cm9sbGVyPFRFdmVudCBleHRlbmRzIFNRU0V2ZW50ID0gU1FTRXZlbnQ+IGV4dGVuZHMgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcblxuICBwcm90ZWN0ZWQgaW5pdGlhbGl6ZShfZXZlbnQ6IFRFdmVudCwgX2NvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyB0aGUgcXVldWUgZXZlbnQuXG4gICAqIFxuICAgKiBSZXR1cm4gYHZvaWRgIGlmIGFsbCBtZXNzYWdlcyBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5LlxuICAgKiBSZXR1cm4gYFNRU0JhdGNoUmVzcG9uc2VgIHdpdGggYGJhdGNoSXRlbUZhaWx1cmVzYCBmb3IgcGFydGlhbCBiYXRjaCBmYWlsdXJlc1xuICAgKiAocmVxdWlyZXMgYHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlYCBpbiBxdWV1ZSBjb25maWcpLlxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGV2ZW50XG4gICAqIEBwYXJhbSBjb250ZXh0IC0gVGhlIExhbWJkYSBjb250ZXh0ICBcbiAgICogQHBhcmFtIGN0eCAtIFF1ZXVlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAqIEByZXR1cm5zIHZvaWQgb3IgU1FTQmF0Y2hSZXNwb25zZSBmb3IgcGFydGlhbCBiYXRjaCBmYWlsdXJlc1xuICAgKi9cbiAgYWJzdHJhY3QgcHJvY2VzcyhldmVudDogVEV2ZW50LCBjb250ZXh0OiBDb250ZXh0LCBjdHg/OiBRdWV1ZUV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFF1ZXVlUHJvY2Vzc1Jlc3VsdD47XG5cbiAgcHJvdGVjdGVkIGdldFF1ZXVlQ29uZmlnKCk6IElRdWV1ZUNvbmZpZyB7XG4gICAgcmV0dXJuIFJlZmxlY3QuZ2V0KHRoaXMsICdxdWV1ZUNvbmZpZycpIHx8IHt9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldFF1ZXVlTmFtZSgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBSZWZsZWN0LmdldCh0aGlzLCAncXVldWVOYW1lJykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgYXN5bmMgTGFtYmRhSGFuZGxlcihldmVudDogVEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxRdWV1ZVByb2Nlc3NSZXN1bHQ+IHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNRUy1MYW1iZGFIYW5kbGVyIHJlY2VpdmVkXCIsIHsgcmVjb3JkQ291bnQ6IGV2ZW50LlJlY29yZHM/Lmxlbmd0aCB9KTtcbiAgICB0aGlzLmluaXRpYWxpemVPYnNlcnZhYmlsaXR5KCk7XG4gICAgXG4gICAgY29uc3QgcXVldWVOYW1lID0gdGhpcy5nZXRRdWV1ZU5hbWUoKSB8fCB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgcXVldWVDb25maWcgPSB0aGlzLmdldFF1ZXVlQ29uZmlnKCk7XG4gICAgY29uc3Qgb2JzQ29uZmlnID0gcXVldWVDb25maWcub2JzZXJ2YWJpbGl0eSB8fCB7fTtcbiAgICBjb25zdCBtZXNzYWdlQXR0cmlidXRlcyA9IGV2ZW50LlJlY29yZHM/LlswXT8ubWVzc2FnZUF0dHJpYnV0ZXMgfHwge307XG4gICAgY29uc3QgdHJhY2VDb250ZXh0ID0gZXh0cmFjdEZyb21TcXMobWVzc2FnZUF0dHJpYnV0ZXMpO1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB0cmFjZUNvbnRleHQ/LmNvcnJlbGF0aW9uSWQgfHwgY29udGV4dC5hd3NSZXF1ZXN0SWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKTtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dCB3aXRoIGN1c3RvbSBzb3VyY2UgYW5kIHRhZ3MgZnJvbSBkZWNvcmF0b3JcbiAgICBjb25zdCBleGVjQ3R4ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0cmFjZUNvbnRleHQ/LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIHNhbXBsZWQ6IHRyYWNlQ29udGV4dD8uc2FtcGxlZCxcbiAgICAgIHNvdXJjZTogb2JzQ29uZmlnLnNvdXJjZSB8fCBgcXVldWU6JHtxdWV1ZU5hbWV9YCxcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgcXVldWVOYW1lLFxuICAgICAgICAuLi5vYnNDb25maWcudGFncyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBSdW4gaGFuZGxlciB3aXRoaW4gZXhlY3V0aW9uIGNvbnRleHRcbiAgICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoZXhlY0N0eCwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQ3JlYXRlIHNwYW4gd2l0aCBjdXN0b20gYXR0cmlidXRlcyBmcm9tIGRlY29yYXRvclxuICAgICAgY29uc3QgcXVldWVTcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGBTUVMgJHtxdWV1ZU5hbWV9YCwge1xuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHRyYWNlQ29udGV4dD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgICBzb3VyY2U6IG9ic0NvbmZpZy5zb3VyY2UgfHwgYHF1ZXVlOiR7cXVldWVOYW1lfWAsXG4gICAgICAgIHRhZ3M6IG9ic0NvbmZpZy50YWdzLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgJ3Nxcy5xdWV1ZU5hbWUnOiBxdWV1ZU5hbWUsXG4gICAgICAgICAgJ3Nxcy5iYXRjaFNpemUnOiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgICAgICAgICAuLi5vYnNDb25maWcuYXR0cmlidXRlcyxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTdG9yZSBzcGFuIElEIGluIGV4ZWN1dGlvbiBjb250ZXh0IGZvciBjaGlsZCBzcGFuc1xuICAgICAgZXhlY0N0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBxdWV1ZVNwYW4uaWQ7XG5cbiAgICAgIC8vIEJ1aWxkIHF1ZXVlIGV4ZWN1dGlvbiBjb250ZXh0XG4gICAgICBjb25zdCBjdHg6IFF1ZXVlRXhlY3V0aW9uQ29udGV4dCA9IHtcbiAgICAgICAgZXZlbnQ6IGV2ZW50IGFzIFNRU0V2ZW50LFxuICAgICAgICBsYW1iZGFDb250ZXh0OiBjb250ZXh0LFxuICAgICAgICBleGVjdXRpb25Db250ZXh0OiBleGVjQ3R4LFxuICAgICAgfTtcblxuICAgICAgbGV0IHNwYW5FbmRlZCA9IGZhbHNlO1xuICAgICAgY29uc3QgZW5kU3BhbiA9IGFzeW5jIChzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IEVycm9yKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgICAgIGlmICghc3BhbkVuZGVkKSB7XG4gICAgICAgICAgcXVldWVTcGFuLmVuZCh7IHN1Y2Nlc3MsIGVycm9yIH0pO1xuICAgICAgICAgIHNwYW5FbmRlZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5mbHVzaE9ic2VydmFiaWxpdHkoKTtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZShldmVudCwgY29udGV4dCk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2VzcyhldmVudCwgY29udGV4dCwgY3R4KTtcbiAgICAgICAgXG4gICAgICAgIC8vIERldGVybWluZSBzdWNjZXNzIGJhc2VkIG9uIHJlc3VsdFxuICAgICAgICBjb25zdCBoYXNGYWlsdXJlcyA9IHJlc3VsdCAmJiAnYmF0Y2hJdGVtRmFpbHVyZXMnIGluIHJlc3VsdCAmJiByZXN1bHQuYmF0Y2hJdGVtRmFpbHVyZXMubGVuZ3RoID4gMDtcbiAgICAgICAgYXdhaXQgZW5kU3BhbighaGFzRmFpbHVyZXMpO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGF3YWl0IGVuZFNwYW4oZmFsc2UsIGVycm9yIGFzIEVycm9yKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IHsgUXVldWVDb250cm9sbGVyIH07XG4iXX0=