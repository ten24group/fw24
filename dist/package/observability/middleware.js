"use strict";
/**
 * Observability Middleware for AWS Lambda Event Sources
 *
 * Provides automatic observability instrumentation for API Gateway and SQS.
 *
 * ## Design
 *
 * The middleware uses a simple pattern:
 * 1. `before()`: Create context, store in `ctx.observability`, start root span
 * 2. Handler runs (accesses context via `ctx.observability`)
 * 3. `after()`/`onError()`: Complete span, flush, cleanup
 *
 * ## Context Access in Handlers
 *
 * Handlers access the observability context through `ExecutionContext.observability`:
 *
 * ```typescript
 * async myHandler(request, response, ctx) {
 *   // Access context data
 *   const { correlationId, span, context } = ctx.observability;
 *
 *   // For nested spans or operations needing getCurrentContext():
 *   return runWithContext(context, async () => {
 *     const childSpan = SpanObserver.start('nested-op');
 *     // ...
 *     childSpan.end({ success: true });
 *   });
 * }
 * ```
 *
 * @module observability/middleware
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiGatewayObservabilityMiddleware = void 0;
exports.processSqsMessages = processSqsMessages;
const crypto_1 = require("crypto");
const span_1 = require("./observers/span");
const context_1 = require("./context");
const manager_1 = require("./manager");
const base_1 = require("./observers/base");
// ============================================================================
// Request Context Storage
// ============================================================================
/**
 * WeakMap for storing context across middleware phases.
 * Automatically cleaned up when request object is garbage collected.
 */
const requestContextMap = new WeakMap();
// ============================================================================
// Helpers
// ============================================================================
function isObservabilityContextData(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'correlationId' in value &&
        'context' in value);
}
function getObsContextFromCtx(ctx) {
    const obs = ctx?.observability;
    return isObservabilityContextData(obs) ? obs : undefined;
}
function setObsContextOnCtx(ctx, data) {
    if (ctx) {
        ctx.observability = data;
    }
}
// ============================================================================
// API Gateway Middleware
// ============================================================================
/**
 * API Gateway middleware for automatic observability instrumentation.
 *
 * ## What it does
 * 1. Extracts trace context from incoming headers
 * 2. Creates observation context for the request
 * 3. Creates a root span for the HTTP request
 * 4. Stores context in `ctx.observability` for handler access
 * 5. Propagates trace context in response headers
 * 6. Flushes observability data before returning
 *
 * ## Usage
 *
 * ```typescript
 * export class MyController extends APIController {
 *   constructor() {
 *     super();
 *     this.useMiddleware(apiGatewayObservabilityMiddleware);
 *   }
 *
 *   async myHandler(request, response, ctx) {
 *     const { correlationId, context } = ctx.observability;
 *
 *     // For nested operations:
 *     return runWithContext(context, async () => {
 *       SpanObserver.start('db-query');
 *     });
 *   }
 * }
 * ```
 */
exports.apiGatewayObservabilityMiddleware = {
    async before(request, _response, ctx) {
        // Extract incoming trace context
        const parsed = (0, context_1.extractTraceContextFromHeaders)(request.headers || {});
        // Create observation context
        const correlationId = parsed?.correlationId || request.requestId || (0, crypto_1.randomUUID)();
        const observationContext = (0, context_1.createObservationContext)(correlationId, {
            parentLogId: parsed?.parentLogId,
            actor: ctx?.actor,
            sampled: parsed?.sampled,
        });
        // Create observability data
        const obsData = {
            correlationId: observationContext.correlationId,
            context: observationContext,
        };
        // Store for after/onError phases
        requestContextMap.set(request, obsData);
        // Create root span (within context for proper propagation)
        await (0, context_1.runWithContext)(observationContext, async () => {
            const span = span_1.SpanObserver.start(`HTTP ${request.httpMethod} ${request.path}`, {
                correlationId: observationContext.correlationId,
                level: 'info',
                attributes: {
                    'http.method': request.httpMethod,
                    'http.url': request.path,
                    'http.path': request.path,
                    'http.user_agent': request.headers?.['user-agent'],
                    'http.request_id': request.requestId,
                },
            });
            obsData.span = span;
        });
        // Store in execution context for handler access
        setObsContextOnCtx(ctx, obsData);
    },
    async after(request, response, ctx) {
        const obsData = requestContextMap.get(request) || getObsContextFromCtx(ctx);
        try {
            if (obsData) {
                await (0, context_1.runWithContext)(obsData.context, async () => {
                    const span = obsData.span;
                    if (span) {
                        span.setAttribute('http.status_code', response.statusCode || 200);
                        // Add trace headers to response
                        const headers = (0, context_1.createPropagationHeaders)(obsData.context);
                        Object.entries(headers).forEach(([key, value]) => {
                            response.setHeader(key, value);
                        });
                        span.end({ success: (response.statusCode || 200) < 400 });
                    }
                    await manager_1.ObservabilityManager.flush();
                });
            }
            else {
                await manager_1.ObservabilityManager.flush();
            }
        }
        finally {
            requestContextMap.delete(request);
        }
    },
    async onError(error, request, response, ctx) {
        const obsData = requestContextMap.get(request) || getObsContextFromCtx(ctx);
        try {
            if (obsData) {
                await (0, context_1.runWithContext)(obsData.context, async () => {
                    const span = obsData.span;
                    if (span) {
                        span.setAttribute('http.status_code', response.statusCode || 500);
                        span.setAttribute('error', true);
                        span.end({ success: false, error });
                    }
                    await manager_1.ObservabilityManager.flush();
                });
            }
            else {
                await manager_1.ObservabilityManager.flush();
            }
        }
        finally {
            requestContextMap.delete(request);
        }
    },
};
// ============================================================================
// SQS Processing Helper
// ============================================================================
/**
 * Process SQS messages with automatic observability instrumentation.
 *
 * @param messages - SQS messages from Lambda event
 * @param handler - Async handler for each message
 * @returns Results for partial batch response
 *
 * @example
 * ```typescript
 * export const handler = async (event: SQSEvent) => {
 *   const results = await processSqsMessages(event.Records, async (msg, ctx) => {
 *     // getCurrentContext() works here
 *     await processOrder(JSON.parse(msg.body));
 *   });
 *
 *   return {
 *     batchItemFailures: results
 *       .filter(r => !r.success)
 *       .map(r => ({ itemIdentifier: r.messageId }))
 *   };
 * };
 * ```
 */
async function processSqsMessages(messages, handler) {
    const results = [];
    for (const message of messages) {
        const parsed = (0, context_1.extractTraceContextFromSqs)(message.messageAttributes);
        const correlationId = parsed?.correlationId || message.messageId;
        const context = (0, context_1.createObservationContext)(correlationId, {
            parentLogId: parsed?.parentLogId,
            sampled: parsed?.sampled,
        });
        await (0, context_1.runWithContext)(context, async () => {
            const span = span_1.SpanObserver.start(`SQS ${message.messageId}`, {
                correlationId,
                level: 'info',
                attributes: {
                    'messaging.system': 'sqs',
                    'messaging.message_id': message.messageId,
                    'messaging.operation': 'process',
                },
            });
            try {
                await handler(message, context);
                span.end({ success: true });
                results.push({ messageId: message.messageId, success: true });
            }
            catch (err) {
                const error = (0, base_1.normalizeError)(err);
                span.end({ success: false, error });
                results.push({ messageId: message.messageId, success: false, error });
            }
            await manager_1.ObservabilityManager.flush();
        });
    }
    return results;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlkZGxld2FyZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21pZGRsZXdhcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBK0JHOzs7QUFnUEgsZ0RBeUNDO0FBdlJELG1DQUFvQztBQUdwQywyQ0FBK0Q7QUFDL0QsdUNBTW1CO0FBRW5CLHVDQUFpRDtBQUNqRCwyQ0FBa0Q7QUFvQ2xELCtFQUErRTtBQUMvRSwwQkFBMEI7QUFDMUIsK0VBQStFO0FBRS9FOzs7R0FHRztBQUNILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxPQUFPLEVBQW9DLENBQUM7QUFFMUUsK0VBQStFO0FBQy9FLFVBQVU7QUFDViwrRUFBK0U7QUFFL0UsU0FBUywwQkFBMEIsQ0FBQyxLQUFjO0lBQ2hELE9BQU8sQ0FDTCxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQ3pCLEtBQUssS0FBSyxJQUFJO1FBQ2QsZUFBZSxJQUFJLEtBQUs7UUFDeEIsU0FBUyxJQUFJLEtBQUssQ0FDbkIsQ0FBQztBQUNKLENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUFDLEdBQWlDO0lBQzdELE1BQU0sR0FBRyxHQUFHLEdBQUcsRUFBRSxhQUFhLENBQUM7SUFDL0IsT0FBTywwQkFBMEIsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7QUFDM0QsQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsR0FBaUMsRUFBRSxJQUE4QjtJQUMzRixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ1AsR0FBa0QsQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDO0lBQzNFLENBQUM7QUFDSCxDQUFDO0FBRUQsK0VBQStFO0FBQy9FLHlCQUF5QjtBQUN6QiwrRUFBK0U7QUFFL0U7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQThCRztBQUNVLFFBQUEs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QyxDQUFDO2dCQUNoQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQzVCLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNoRSxDQUFDO1lBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztnQkFDYixNQUFNLEtBQUssR0FBRyxJQUFBLHFCQUFjLEVBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ2xDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7Z0JBQ3BDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDeEUsQ0FBQztZQUVELE1BQU0sOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eSBNaWRkbGV3YXJlIGZvciBBV1MgTGFtYmRhIEV2ZW50IFNvdXJjZXNcbiAqIFxuICogUHJvdmlkZXMgYXV0b21hdGljIG9ic2VydmFiaWxpdHkgaW5zdHJ1bWVudGF0aW9uIGZvciBBUEkgR2F0ZXdheSBhbmQgU1FTLlxuICogXG4gKiAjIyBEZXNpZ25cbiAqIFxuICogVGhlIG1pZGRsZXdhcmUgdXNlcyBhIHNpbXBsZSBwYXR0ZXJuOlxuICogMS4gYGJlZm9yZSgpYDogQ3JlYXRlIGNvbnRleHQsIHN0b3JlIGluIGBjdHgub2JzZXJ2YWJpbGl0eWAsIHN0YXJ0IHJvb3Qgc3BhblxuICogMi4gSGFuZGxlciBydW5zIChhY2Nlc3NlcyBjb250ZXh0IHZpYSBgY3R4Lm9ic2VydmFiaWxpdHlgKVxuICogMy4gYGFmdGVyKClgL2BvbkVycm9yKClgOiBDb21wbGV0ZSBzcGFuLCBmbHVzaCwgY2xlYW51cFxuICogXG4gKiAjIyBDb250ZXh0IEFjY2VzcyBpbiBIYW5kbGVyc1xuICogXG4gKiBIYW5kbGVycyBhY2Nlc3MgdGhlIG9ic2VydmFiaWxpdHkgY29udGV4dCB0aHJvdWdoIGBFeGVjdXRpb25Db250ZXh0Lm9ic2VydmFiaWxpdHlgOlxuICogXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBhc3luYyBteUhhbmRsZXIocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkge1xuICogICAvLyBBY2Nlc3MgY29udGV4dCBkYXRhXG4gKiAgIGNvbnN0IHsgY29ycmVsYXRpb25JZCwgc3BhbiwgY29udGV4dCB9ID0gY3R4Lm9ic2VydmFiaWxpdHk7XG4gKiAgIFxuICogICAvLyBGb3IgbmVzdGVkIHNwYW5zIG9yIG9wZXJhdGlvbnMgbmVlZGluZyBnZXRDdXJyZW50Q29udGV4dCgpOlxuICogICByZXR1cm4gcnVuV2l0aENvbnRleHQoY29udGV4dCwgYXN5bmMgKCkgPT4ge1xuICogICAgIGNvbnN0IGNoaWxkU3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydCgnbmVzdGVkLW9wJyk7XG4gKiAgICAgLy8gLi4uXG4gKiAgICAgY2hpbGRTcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gKiAgIH0pO1xuICogfVxuICogYGBgXG4gKiBcbiAqIEBtb2R1bGUgb2JzZXJ2YWJpbGl0eS9taWRkbGV3YXJlXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBBUElDb250cm9sbGVyTWlkZGxld2FyZSB9IGZyb20gJy4uL2NvcmUvcnVudGltZS9hcGktZ2F0ZXdheS1jb250cm9sbGVyJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgSVNwYW5PYnNlcnZlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHtcbiAgZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzLFxuICBleHRyYWN0VHJhY2VDb250ZXh0RnJvbVNxcyxcbiAgY3JlYXRlUHJvcGFnYXRpb25IZWFkZXJzLFxuICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQsXG4gIHJ1bldpdGhDb250ZXh0LFxufSBmcm9tICcuL2NvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YXRpb25Db250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgeyBub3JtYWxpemVFcnJvciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUeXBlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIE9ic2VydmFiaWxpdHkgZGF0YSBzdG9yZWQgaW4gRXhlY3V0aW9uQ29udGV4dC5vYnNlcnZhYmlsaXR5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmFiaWxpdHlDb250ZXh0RGF0YSB7XG4gIC8qKiBSb290IHNwYW4gZm9yIHRoZSByZXF1ZXN0L21lc3NhZ2UgKi9cbiAgc3Bhbj86IElTcGFuT2JzZXJ2ZXI7XG4gIC8qKiBDb3JyZWxhdGlvbiBJRCBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZyAqL1xuICBjb3JyZWxhdGlvbklkOiBzdHJpbmc7XG4gIC8qKiBGdWxsIG9ic2VydmF0aW9uIGNvbnRleHQgKHVzZSB3aXRoIHJ1bldpdGhDb250ZXh0IGZvciBuZXN0ZWQgb3BzKSAqL1xuICBjb250ZXh0OiBPYnNlcnZhdGlvbkNvbnRleHQ7XG59XG5cbi8qKlxuICogU1FTIG1lc3NhZ2Ugc3RydWN0dXJlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNxc01lc3NhZ2Uge1xuICBtZXNzYWdlSWQ6IHN0cmluZztcbiAgYm9keTogc3RyaW5nO1xuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgc3RyaW5nVmFsdWU/OiBzdHJpbmc7IFN0cmluZ1ZhbHVlPzogc3RyaW5nIH0+O1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbn1cblxuLyoqXG4gKiBTUVMgbWVzc2FnZSBoYW5kbGVyIGZ1bmN0aW9uIHR5cGUuXG4gKi9cbmV4cG9ydCB0eXBlIFNxc01lc3NhZ2VIYW5kbGVyID0gKFxuICBtZXNzYWdlOiBTcXNNZXNzYWdlLFxuICBjb250ZXh0OiBPYnNlcnZhdGlvbkNvbnRleHRcbikgPT4gUHJvbWlzZTx2b2lkPjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUmVxdWVzdCBDb250ZXh0IFN0b3JhZ2Vcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBXZWFrTWFwIGZvciBzdG9yaW5nIGNvbnRleHQgYWNyb3NzIG1pZGRsZXdhcmUgcGhhc2VzLlxuICogQXV0b21hdGljYWxseSBjbGVhbmVkIHVwIHdoZW4gcmVxdWVzdCBvYmplY3QgaXMgZ2FyYmFnZSBjb2xsZWN0ZWQuXG4gKi9cbmNvbnN0IHJlcXVlc3RDb250ZXh0TWFwID0gbmV3IFdlYWtNYXA8b2JqZWN0LCBPYnNlcnZhYmlsaXR5Q29udGV4dERhdGE+KCk7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEhlbHBlcnNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZnVuY3Rpb24gaXNPYnNlcnZhYmlsaXR5Q29udGV4dERhdGEodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBPYnNlcnZhYmlsaXR5Q29udGV4dERhdGEge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgICdjb3JyZWxhdGlvbklkJyBpbiB2YWx1ZSAmJlxuICAgICdjb250ZXh0JyBpbiB2YWx1ZVxuICApO1xufVxuXG5mdW5jdGlvbiBnZXRPYnNDb250ZXh0RnJvbUN0eChjdHg6IEV4ZWN1dGlvbkNvbnRleHQgfCB1bmRlZmluZWQpOiBPYnNlcnZhYmlsaXR5Q29udGV4dERhdGEgfCB1bmRlZmluZWQge1xuICBjb25zdCBvYnMgPSBjdHg/Lm9ic2VydmFiaWxpdHk7XG4gIHJldHVybiBpc09ic2VydmFiaWxpdHlDb250ZXh0RGF0YShvYnMpID8gb2JzIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBzZXRPYnNDb250ZXh0T25DdHgoY3R4OiBFeGVjdXRpb25Db250ZXh0IHwgdW5kZWZpbmVkLCBkYXRhOiBPYnNlcnZhYmlsaXR5Q29udGV4dERhdGEpOiB2b2lkIHtcbiAgaWYgKGN0eCkge1xuICAgIChjdHggYXMgRXhlY3V0aW9uQ29udGV4dDxPYnNlcnZhYmlsaXR5Q29udGV4dERhdGE+KS5vYnNlcnZhYmlsaXR5ID0gZGF0YTtcbiAgfVxufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBUEkgR2F0ZXdheSBNaWRkbGV3YXJlXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQVBJIEdhdGV3YXkgbWlkZGxld2FyZSBmb3IgYXV0b21hdGljIG9ic2VydmFiaWxpdHkgaW5zdHJ1bWVudGF0aW9uLlxuICogXG4gKiAjIyBXaGF0IGl0IGRvZXNcbiAqIDEuIEV4dHJhY3RzIHRyYWNlIGNvbnRleHQgZnJvbSBpbmNvbWluZyBoZWFkZXJzXG4gKiAyLiBDcmVhdGVzIG9ic2VydmF0aW9uIGNvbnRleHQgZm9yIHRoZSByZXF1ZXN0XG4gKiAzLiBDcmVhdGVzIGEgcm9vdCBzcGFuIGZvciB0aGUgSFRUUCByZXF1ZXN0XG4gKiA0LiBTdG9yZXMgY29udGV4dCBpbiBgY3R4Lm9ic2VydmFiaWxpdHlgIGZvciBoYW5kbGVyIGFjY2Vzc1xuICogNS4gUHJvcGFnYXRlcyB0cmFjZSBjb250ZXh0IGluIHJlc3BvbnNlIGhlYWRlcnNcbiAqIDYuIEZsdXNoZXMgb2JzZXJ2YWJpbGl0eSBkYXRhIGJlZm9yZSByZXR1cm5pbmdcbiAqIFxuICogIyMgVXNhZ2VcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGNsYXNzIE15Q29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICogICBjb25zdHJ1Y3RvcigpIHtcbiAqICAgICBzdXBlcigpO1xuICogICAgIHRoaXMudXNlTWlkZGxld2FyZShhcGlHYXRld2F5T2JzZXJ2YWJpbGl0eU1pZGRsZXdhcmUpO1xuICogICB9XG4gKiAgIFxuICogICBhc3luYyBteUhhbmRsZXIocmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkge1xuICogICAgIGNvbnN0IHsgY29ycmVsYXRpb25JZCwgY29udGV4dCB9ID0gY3R4Lm9ic2VydmFiaWxpdHk7XG4gKiAgICAgXG4gKiAgICAgLy8gRm9yIG5lc3RlZCBvcGVyYXRpb25zOlxuICogICAgIHJldHVybiBydW5XaXRoQ29udGV4dChjb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gKiAgICAgICBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ2RiLXF1ZXJ5Jyk7XG4gKiAgICAgfSk7XG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgYXBpR2F0ZXdheU9ic2VydmFiaWxpdHlNaWRkbGV3YXJlOiBBUElDb250cm9sbGVyTWlkZGxld2FyZSA9IHtcbiAgYXN5bmMgYmVmb3JlKHJlcXVlc3QsIF9yZXNwb25zZSwgY3R4KSB7XG4gICAgLy8gRXh0cmFjdCBpbmNvbWluZyB0cmFjZSBjb250ZXh0XG4gICAgY29uc3QgcGFyc2VkID0gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzKHJlcXVlc3QuaGVhZGVycyB8fCB7fSk7XG5cbiAgICAvLyBDcmVhdGUgb2JzZXJ2YXRpb24gY29udGV4dFxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBwYXJzZWQ/LmNvcnJlbGF0aW9uSWQgfHwgcmVxdWVzdC5yZXF1ZXN0SWQgfHwgcmFuZG9tVVVJRCgpO1xuICAgIGNvbnN0IG9ic2VydmF0aW9uQ29udGV4dCA9IGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChjb3JyZWxhdGlvbklkLCB7XG4gICAgICBwYXJlbnRMb2dJZDogcGFyc2VkPy5wYXJlbnRMb2dJZCxcbiAgICAgIGFjdG9yOiBjdHg/LmFjdG9yLFxuICAgICAgc2FtcGxlZDogcGFyc2VkPy5zYW1wbGVkLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIG9ic2VydmFiaWxpdHkgZGF0YVxuICAgIGNvbnN0IG9ic0RhdGE6IE9ic2VydmFiaWxpdHlDb250ZXh0RGF0YSA9IHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9ic2VydmF0aW9uQ29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgY29udGV4dDogb2JzZXJ2YXRpb25Db250ZXh0LFxuICAgIH07XG5cbiAgICAvLyBTdG9yZSBmb3IgYWZ0ZXIvb25FcnJvciBwaGFzZXNcbiAgICByZXF1ZXN0Q29udGV4dE1hcC5zZXQocmVxdWVzdCwgb2JzRGF0YSk7XG5cbiAgICAvLyBDcmVhdGUgcm9vdCBzcGFuICh3aXRoaW4gY29udGV4dCBmb3IgcHJvcGVyIHByb3BhZ2F0aW9uKVxuICAgIGF3YWl0IHJ1bldpdGhDb250ZXh0KG9ic2VydmF0aW9uQ29udGV4dCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChgSFRUUCAke3JlcXVlc3QuaHR0cE1ldGhvZH0gJHtyZXF1ZXN0LnBhdGh9YCwge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiBvYnNlcnZhdGlvbkNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdodHRwLm1ldGhvZCc6IHJlcXVlc3QuaHR0cE1ldGhvZCxcbiAgICAgICAgICAnaHR0cC51cmwnOiByZXF1ZXN0LnBhdGgsXG4gICAgICAgICAgJ2h0dHAucGF0aCc6IHJlcXVlc3QucGF0aCxcbiAgICAgICAgICAnaHR0cC51c2VyX2FnZW50JzogcmVxdWVzdC5oZWFkZXJzPy5bICd1c2VyLWFnZW50JyBdLFxuICAgICAgICAgICdodHRwLnJlcXVlc3RfaWQnOiByZXF1ZXN0LnJlcXVlc3RJZCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgb2JzRGF0YS5zcGFuID0gc3BhbjtcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIGluIGV4ZWN1dGlvbiBjb250ZXh0IGZvciBoYW5kbGVyIGFjY2Vzc1xuICAgIHNldE9ic0NvbnRleHRPbkN0eChjdHgsIG9ic0RhdGEpO1xuICB9LFxuXG4gIGFzeW5jIGFmdGVyKHJlcXVlc3QsIHJlc3BvbnNlLCBjdHgpIHtcbiAgICBjb25zdCBvYnNEYXRhID0gcmVxdWVzdENvbnRleHRNYXAuZ2V0KHJlcXVlc3QpIHx8IGdldE9ic0NvbnRleHRGcm9tQ3R4KGN0eCk7XG5cbiAgICB0cnkge1xuICAgICAgaWYgKG9ic0RhdGEpIHtcbiAgICAgICAgYXdhaXQgcnVuV2l0aENvbnRleHQob2JzRGF0YS5jb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgc3BhbiA9IG9ic0RhdGEuc3BhbjtcbiAgICAgICAgICBpZiAoc3Bhbikge1xuICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ2h0dHAuc3RhdHVzX2NvZGUnLCByZXNwb25zZS5zdGF0dXNDb2RlIHx8IDIwMCk7XG5cbiAgICAgICAgICAgIC8vIEFkZCB0cmFjZSBoZWFkZXJzIHRvIHJlc3BvbnNlXG4gICAgICAgICAgICBjb25zdCBoZWFkZXJzID0gY3JlYXRlUHJvcGFnYXRpb25IZWFkZXJzKG9ic0RhdGEuY29udGV4dCk7XG4gICAgICAgICAgICBPYmplY3QuZW50cmllcyhoZWFkZXJzKS5mb3JFYWNoKChbIGtleSwgdmFsdWUgXSkgPT4ge1xuICAgICAgICAgICAgICByZXNwb25zZS5zZXRIZWFkZXIoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiAocmVzcG9uc2Uuc3RhdHVzQ29kZSB8fCAyMDApIDwgNDAwIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlcXVlc3RDb250ZXh0TWFwLmRlbGV0ZShyZXF1ZXN0KTtcbiAgICB9XG4gIH0sXG5cbiAgYXN5bmMgb25FcnJvcihlcnJvciwgcmVxdWVzdCwgcmVzcG9uc2UsIGN0eCkge1xuICAgIGNvbnN0IG9ic0RhdGEgPSByZXF1ZXN0Q29udGV4dE1hcC5nZXQocmVxdWVzdCkgfHwgZ2V0T2JzQ29udGV4dEZyb21DdHgoY3R4KTtcblxuICAgIHRyeSB7XG4gICAgICBpZiAob2JzRGF0YSkge1xuICAgICAgICBhd2FpdCBydW5XaXRoQ29udGV4dChvYnNEYXRhLmNvbnRleHQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBzcGFuID0gb2JzRGF0YS5zcGFuO1xuICAgICAgICAgIGlmIChzcGFuKSB7XG4gICAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnaHR0cC5zdGF0dXNfY29kZScsIHJlc3BvbnNlLnN0YXR1c0NvZGUgfHwgNTAwKTtcbiAgICAgICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKCdlcnJvcicsIHRydWUpO1xuICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3IgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVxdWVzdENvbnRleHRNYXAuZGVsZXRlKHJlcXVlc3QpO1xuICAgIH1cbiAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNRUyBQcm9jZXNzaW5nIEhlbHBlclxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFByb2Nlc3MgU1FTIG1lc3NhZ2VzIHdpdGggYXV0b21hdGljIG9ic2VydmFiaWxpdHkgaW5zdHJ1bWVudGF0aW9uLlxuICogXG4gKiBAcGFyYW0gbWVzc2FnZXMgLSBTUVMgbWVzc2FnZXMgZnJvbSBMYW1iZGEgZXZlbnRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gQXN5bmMgaGFuZGxlciBmb3IgZWFjaCBtZXNzYWdlXG4gKiBAcmV0dXJucyBSZXN1bHRzIGZvciBwYXJ0aWFsIGJhdGNoIHJlc3BvbnNlXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBleHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogU1FTRXZlbnQpID0+IHtcbiAqICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHByb2Nlc3NTcXNNZXNzYWdlcyhldmVudC5SZWNvcmRzLCBhc3luYyAobXNnLCBjdHgpID0+IHtcbiAqICAgICAvLyBnZXRDdXJyZW50Q29udGV4dCgpIHdvcmtzIGhlcmVcbiAqICAgICBhd2FpdCBwcm9jZXNzT3JkZXIoSlNPTi5wYXJzZShtc2cuYm9keSkpO1xuICogICB9KTtcbiAqICAgXG4gKiAgIHJldHVybiB7XG4gKiAgICAgYmF0Y2hJdGVtRmFpbHVyZXM6IHJlc3VsdHNcbiAqICAgICAgIC5maWx0ZXIociA9PiAhci5zdWNjZXNzKVxuICogICAgICAgLm1hcChyID0+ICh7IGl0ZW1JZGVudGlmaWVyOiByLm1lc3NhZ2VJZCB9KSlcbiAqICAgfTtcbiAqIH07XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHByb2Nlc3NTcXNNZXNzYWdlcyhcbiAgbWVzc2FnZXM6IFNxc01lc3NhZ2VbXSxcbiAgaGFuZGxlcjogU3FzTWVzc2FnZUhhbmRsZXJcbik6IFByb21pc2U8QXJyYXk8eyBtZXNzYWdlSWQ6IHN0cmluZzsgc3VjY2VzczogYm9vbGVhbjsgZXJyb3I/OiBFcnJvciB9Pj4ge1xuICBjb25zdCByZXN1bHRzOiBBcnJheTx7IG1lc3NhZ2VJZDogc3RyaW5nOyBzdWNjZXNzOiBib29sZWFuOyBlcnJvcj86IEVycm9yIH0+ID0gW107XG5cbiAgZm9yIChjb25zdCBtZXNzYWdlIG9mIG1lc3NhZ2VzKSB7XG4gICAgY29uc3QgcGFyc2VkID0gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21TcXMobWVzc2FnZS5tZXNzYWdlQXR0cmlidXRlcyk7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHBhcnNlZD8uY29ycmVsYXRpb25JZCB8fCBtZXNzYWdlLm1lc3NhZ2VJZDtcblxuICAgIGNvbnN0IGNvbnRleHQgPSBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQoY29ycmVsYXRpb25JZCwge1xuICAgICAgcGFyZW50TG9nSWQ6IHBhcnNlZD8ucGFyZW50TG9nSWQsXG4gICAgICBzYW1wbGVkOiBwYXJzZWQ/LnNhbXBsZWQsXG4gICAgfSk7XG5cbiAgICBhd2FpdCBydW5XaXRoQ29udGV4dChjb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KGBTUVMgJHttZXNzYWdlLm1lc3NhZ2VJZH1gLCB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAnbWVzc2FnaW5nLnN5c3RlbSc6ICdzcXMnLFxuICAgICAgICAgICdtZXNzYWdpbmcubWVzc2FnZV9pZCc6IG1lc3NhZ2UubWVzc2FnZUlkLFxuICAgICAgICAgICdtZXNzYWdpbmcub3BlcmF0aW9uJzogJ3Byb2Nlc3MnLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGhhbmRsZXIobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHsgbWVzc2FnZUlkOiBtZXNzYWdlLm1lc3NhZ2VJZCwgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBlcnJvciA9IG5vcm1hbGl6ZUVycm9yKGVycik7XG4gICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yIH0pO1xuICAgICAgICByZXN1bHRzLnB1c2goeyBtZXNzYWdlSWQ6IG1lc3NhZ2UubWVzc2FnZUlkLCBzdWNjZXNzOiBmYWxzZSwgZXJyb3IgfSk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0cztcbn1cbiJdfQ==