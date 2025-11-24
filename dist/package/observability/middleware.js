"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sqsObservabilityMiddleware = exports.apiGatewayObservabilityMiddleware = void 0;
const span_1 = require("./span");
const context_1 = require("./context");
const manager_1 = require("./manager");
/**
 * API Gateway middleware for automatic observability instrumentation
 *
 * @example
 * ```typescript
 * export class MyController extends APIController {
 *   constructor() {
 *     super();
 *     this.useMiddleware(apiGatewayObservabilityMiddleware);
 *   }
 * }
 * ```
 */
exports.apiGatewayObservabilityMiddleware = {
    async before(request, _response, ctx) {
        // Extract trace context from incoming headers
        const { traceId, parentSpanId } = (0, context_1.extractTraceContextFromHeaders)(request.headers || {});
        // Create root span for this request
        const span = new span_1.Span(`HTTP ${request.httpMethod} ${request.path}`, {
            traceId,
            parentSpanId,
            level: 'info',
            attributes: {
                'http.method': request.httpMethod,
                'http.url': request.path,
                'http.path': request.path,
                'http.user_agent': request.headers?.['user-agent'],
                'http.request_id': request.requestId,
            },
        });
        // Store span in context for downstream use
        if (ctx) {
            ctx.observability = {
                span,
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
            };
        }
    },
    async after(_request, response, ctx) {
        const span = ctx?.observability?.span;
        if (span) {
            // Add response attributes
            span.setAttribute('http.status_code', response.statusCode || 200);
            // Inject trace context into response headers
            const traceHeaders = (0, context_1.injectTraceContextHeaders)(span.traceId, span.spanId);
            Object.entries(traceHeaders).forEach(([key, value]) => {
                response.setHeader(key, value);
            });
            // End span with success
            await span.end({ success: (response.statusCode || 200) < 400 });
        }
        // Flush all observability data
        await manager_1.ObservabilityManager.flush();
    },
    async onError(error, _request, response, ctx) {
        const span = ctx?.observability?.span;
        if (span) {
            // Add error attributes
            span.setAttribute('http.status_code', response.statusCode || 500);
            span.setAttribute('error', true);
            // End span with error
            await span.end({ success: false, error });
        }
        // Flush all observability data
        await manager_1.ObservabilityManager.flush();
    },
};
/**
 * SQS middleware for automatic observability instrumentation
 * Note: This is applied automatically in the SQS controller
 */
exports.sqsObservabilityMiddleware = {
// Implementation is directly in sqs-controller.ts
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlkZGxld2FyZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21pZGRsZXdhcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsaUNBQThCO0FBQzlCLHVDQUFzRjtBQUN0Rix1Q0FBaUQ7QUFFakQ7Ozs7Ozs7Ozs7OztHQVlHO0FBQ1UsUUFBQSxpQ0FBaUMsR0FBNEI7SUFDeEUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLEdBQUc7UUFDbEMsOENBQThDO1FBQzlDLE1BQU0sRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLEdBQUcsSUFBQSx3Q0FBOEIsRUFBQyxPQUFPLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRXhGLG9DQUFvQztRQUNwQyxNQUFNLElBQUksR0FBRyxJQUFJLFdBQUksQ0FBQyxRQUFRLE9BQU8sQ0FBQyxVQUFVLElBQUksT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFO1lBQ2xFLE9BQU87WUFDUCxZQUFZO1lBQ1osS0FBSyxFQUFFLE1BQU07WUFFYixVQUFVLEVBQUU7Z0JBQ1YsYUFBYSxFQUFFLE9BQU8sQ0FBQyxVQUFVO2dCQUNqQyxVQUFVLEVBQUUsT0FBTyxDQUFDLElBQUk7Z0JBQ3hCLFdBQVcsRUFBRSxPQUFPLENBQUMsSUFBSTtnQkFDekIsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLFlBQVksQ0FBQztnQkFDbEQsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLFNBQVM7YUFDckM7U0FDRixDQUFDLENBQUM7UUFFSCwyQ0FBMkM7UUFDM0MsSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUNSLEdBQUcsQ0FBQyxhQUFhLEdBQUc7Z0JBQ2xCLElBQUk7Z0JBQ0osT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO2dCQUNyQixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07Z0JBQ25CLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWTthQUNoQyxDQUFDO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRztRQUNqQyxNQUFNLElBQUksR0FBSSxHQUFXLEVBQUUsYUFBYSxFQUFFLElBQXdCLENBQUM7UUFDbkUsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNULDBCQUEwQjtZQUMxQixJQUFJLENBQUMsWUFBWSxDQUFDLGtCQUFrQixFQUFFLFFBQVEsQ0FBQyxVQUFVLElBQUksR0FBRyxDQUFDLENBQUM7WUFFbEUsNkNBQTZDO1lBQzdDLE1BQU0sWUFBWSxHQUFHLElBQUEsbUNBQXlCLEVBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDMUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFO2dCQUNwRCxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNqQyxDQUFDLENBQUMsQ0FBQztZQUVILHdCQUF3QjtZQUN4QixNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsQ0FBQyxRQUFRLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDbEUsQ0FBQztRQUVELCtCQUErQjtRQUMvQixNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3JDLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLEdBQUc7UUFDMUMsTUFBTSxJQUFJLEdBQUksR0FBVyxFQUFFLGFBQWEsRUFBRSxJQUF3QixDQUFDO1FBQ25FLElBQUksSUFBSSxFQUFFLENBQUM7WUFDVCx1QkFBdUI7WUFDdkIsSUFBSSxDQUFDLFlBQVksQ0FBQyxrQkFBa0IsRUFBRSxRQUFRLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQyxDQUFDO1lBQ2xFLElBQUksQ0FBQyxZQUFZLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1lBRWpDLHNCQUFzQjtZQUN0QixNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7UUFDNUMsQ0FBQztRQUVELCtCQUErQjtRQUMvQixNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3JDLENBQUM7Q0FDRixDQUFDO0FBRUY7OztHQUdHO0FBQ1UsUUFBQSwwQkFBMEIsR0FBRztBQUN4QyxrREFBa0Q7Q0FDbkQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUNvbnRyb2xsZXJNaWRkbGV3YXJlIH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2FwaS1nYXRld2F5LWNvbnRyb2xsZXInO1xuaW1wb3J0IHsgU3BhbiB9IGZyb20gJy4vc3Bhbic7XG5pbXBvcnQgeyBleHRyYWN0VHJhY2VDb250ZXh0RnJvbUhlYWRlcnMsIGluamVjdFRyYWNlQ29udGV4dEhlYWRlcnMgfSBmcm9tICcuL2NvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuL21hbmFnZXInO1xuXG4vKipcbiAqIEFQSSBHYXRld2F5IG1pZGRsZXdhcmUgZm9yIGF1dG9tYXRpYyBvYnNlcnZhYmlsaXR5IGluc3RydW1lbnRhdGlvblxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGNsYXNzIE15Q29udHJvbGxlciBleHRlbmRzIEFQSUNvbnRyb2xsZXIge1xuICogICBjb25zdHJ1Y3RvcigpIHtcbiAqICAgICBzdXBlcigpO1xuICogICAgIHRoaXMudXNlTWlkZGxld2FyZShhcGlHYXRld2F5T2JzZXJ2YWJpbGl0eU1pZGRsZXdhcmUpO1xuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGFwaUdhdGV3YXlPYnNlcnZhYmlsaXR5TWlkZGxld2FyZTogQVBJQ29udHJvbGxlck1pZGRsZXdhcmUgPSB7XG4gIGFzeW5jIGJlZm9yZShyZXF1ZXN0LCBfcmVzcG9uc2UsIGN0eCkge1xuICAgIC8vIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIGluY29taW5nIGhlYWRlcnNcbiAgICBjb25zdCB7IHRyYWNlSWQsIHBhcmVudFNwYW5JZCB9ID0gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21IZWFkZXJzKHJlcXVlc3QuaGVhZGVycyB8fCB7fSk7XG5cbiAgICAvLyBDcmVhdGUgcm9vdCBzcGFuIGZvciB0aGlzIHJlcXVlc3RcbiAgICBjb25zdCBzcGFuID0gbmV3IFNwYW4oYEhUVFAgJHtyZXF1ZXN0Lmh0dHBNZXRob2R9ICR7cmVxdWVzdC5wYXRofWAsIHtcbiAgICAgIHRyYWNlSWQsXG4gICAgICBwYXJlbnRTcGFuSWQsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICdodHRwLm1ldGhvZCc6IHJlcXVlc3QuaHR0cE1ldGhvZCxcbiAgICAgICAgJ2h0dHAudXJsJzogcmVxdWVzdC5wYXRoLFxuICAgICAgICAnaHR0cC5wYXRoJzogcmVxdWVzdC5wYXRoLFxuICAgICAgICAnaHR0cC51c2VyX2FnZW50JzogcmVxdWVzdC5oZWFkZXJzPy5bJ3VzZXItYWdlbnQnXSxcbiAgICAgICAgJ2h0dHAucmVxdWVzdF9pZCc6IHJlcXVlc3QucmVxdWVzdElkLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIHNwYW4gaW4gY29udGV4dCBmb3IgZG93bnN0cmVhbSB1c2VcbiAgICBpZiAoY3R4KSB7XG4gICAgICBjdHgub2JzZXJ2YWJpbGl0eSA9IHtcbiAgICAgICAgc3BhbixcbiAgICAgICAgdHJhY2VJZDogc3Bhbi50cmFjZUlkLFxuICAgICAgICBzcGFuSWQ6IHNwYW4uc3BhbklkLFxuICAgICAgICBwYXJlbnRTcGFuSWQ6IHNwYW4ucGFyZW50U3BhbklkLFxuICAgICAgfTtcbiAgICB9XG4gIH0sXG5cbiAgYXN5bmMgYWZ0ZXIoX3JlcXVlc3QsIHJlc3BvbnNlLCBjdHgpIHtcbiAgICBjb25zdCBzcGFuID0gKGN0eCBhcyBhbnkpPy5vYnNlcnZhYmlsaXR5Py5zcGFuIGFzIFNwYW4gfCB1bmRlZmluZWQ7XG4gICAgaWYgKHNwYW4pIHtcbiAgICAgIC8vIEFkZCByZXNwb25zZSBhdHRyaWJ1dGVzXG4gICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnaHR0cC5zdGF0dXNfY29kZScsIHJlc3BvbnNlLnN0YXR1c0NvZGUgfHwgMjAwKTtcblxuICAgICAgLy8gSW5qZWN0IHRyYWNlIGNvbnRleHQgaW50byByZXNwb25zZSBoZWFkZXJzXG4gICAgICBjb25zdCB0cmFjZUhlYWRlcnMgPSBpbmplY3RUcmFjZUNvbnRleHRIZWFkZXJzKHNwYW4udHJhY2VJZCwgc3Bhbi5zcGFuSWQpO1xuICAgICAgT2JqZWN0LmVudHJpZXModHJhY2VIZWFkZXJzKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgcmVzcG9uc2Uuc2V0SGVhZGVyKGtleSwgdmFsdWUpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEVuZCBzcGFuIHdpdGggc3VjY2Vzc1xuICAgICAgYXdhaXQgc3Bhbi5lbmQoeyBzdWNjZXNzOiAocmVzcG9uc2Uuc3RhdHVzQ29kZSB8fCAyMDApIDwgNDAwIH0pO1xuICAgIH1cblxuICAgIC8vIEZsdXNoIGFsbCBvYnNlcnZhYmlsaXR5IGRhdGFcbiAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICB9LFxuXG4gIGFzeW5jIG9uRXJyb3IoZXJyb3IsIF9yZXF1ZXN0LCByZXNwb25zZSwgY3R4KSB7XG4gICAgY29uc3Qgc3BhbiA9IChjdHggYXMgYW55KT8ub2JzZXJ2YWJpbGl0eT8uc3BhbiBhcyBTcGFuIHwgdW5kZWZpbmVkO1xuICAgIGlmIChzcGFuKSB7XG4gICAgICAvLyBBZGQgZXJyb3IgYXR0cmlidXRlc1xuICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ2h0dHAuc3RhdHVzX2NvZGUnLCByZXNwb25zZS5zdGF0dXNDb2RlIHx8IDUwMCk7XG4gICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnZXJyb3InLCB0cnVlKTtcblxuICAgICAgLy8gRW5kIHNwYW4gd2l0aCBlcnJvclxuICAgICAgYXdhaXQgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSwgZXJyb3IgfSk7XG4gICAgfVxuXG4gICAgLy8gRmx1c2ggYWxsIG9ic2VydmFiaWxpdHkgZGF0YVxuICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gIH0sXG59O1xuXG4vKipcbiAqIFNRUyBtaWRkbGV3YXJlIGZvciBhdXRvbWF0aWMgb2JzZXJ2YWJpbGl0eSBpbnN0cnVtZW50YXRpb25cbiAqIE5vdGU6IFRoaXMgaXMgYXBwbGllZCBhdXRvbWF0aWNhbGx5IGluIHRoZSBTUVMgY29udHJvbGxlclxuICovXG5leHBvcnQgY29uc3Qgc3FzT2JzZXJ2YWJpbGl0eU1pZGRsZXdhcmUgPSB7XG4gIC8vIEltcGxlbWVudGF0aW9uIGlzIGRpcmVjdGx5IGluIHNxcy1jb250cm9sbGVyLnRzXG59O1xuXG4iXX0=