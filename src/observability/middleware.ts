import { APIControllerMiddleware } from '../core/runtime/api-gateway-controller';
import { Span } from './span';
import { extractTraceContextFromHeaders, injectTraceContextHeaders } from './context';
import { ObservabilityManager } from './manager';

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
export const apiGatewayObservabilityMiddleware: APIControllerMiddleware = {
  async before(request, _response, ctx) {
    // Extract trace context from incoming headers
    const { traceId, parentSpanId } = extractTraceContextFromHeaders(request.headers || {});

    // Create root span for this request
    const span = new Span(`HTTP ${request.httpMethod} ${request.path}`, {
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
    const span = (ctx as any)?.observability?.span as Span | undefined;
    if (span) {
      // Add response attributes
      span.setAttribute('http.status_code', response.statusCode || 200);

      // Inject trace context into response headers
      const traceHeaders = injectTraceContextHeaders(span.traceId, span.spanId);
      Object.entries(traceHeaders).forEach(([key, value]) => {
        response.setHeader(key, value);
      });

      // End span with success
      await span.end({ success: (response.statusCode || 200) < 400 });
    }

    // Flush all observability data
    await ObservabilityManager.flush();
  },

  async onError(error, _request, response, ctx) {
    const span = (ctx as any)?.observability?.span as Span | undefined;
    if (span) {
      // Add error attributes
      span.setAttribute('http.status_code', response.statusCode || 500);
      span.setAttribute('error', true);

      // End span with error
      await span.end({ success: false, error });
    }

    // Flush all observability data
    await ObservabilityManager.flush();
  },
};

/**
 * SQS middleware for automatic observability instrumentation
 * Note: This is applied automatically in the SQS controller
 */
export const sqsObservabilityMiddleware = {
  // Implementation is directly in sqs-controller.ts
};

