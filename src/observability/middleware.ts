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

import { randomUUID } from 'crypto';
import { APIControllerMiddleware } from '../core/runtime/api-gateway-controller';
import { ExecutionContext } from '../core/types/execution-context';
import { SpanObserver, ISpanObserver } from './observers/span';
import {
  extractTraceContextFromHeaders,
  extractTraceContextFromSqs,
  createPropagationHeaders,
  createObservationContext,
  runWithContext,
} from './context';
import { ObservationContext } from './types';
import { ObservabilityManager } from './manager';
import { normalizeError } from './observers/base';

// ============================================================================
// Types
// ============================================================================

/**
 * Observability data stored in ExecutionContext.observability.
 */
export interface ObservabilityContextData {
  /** Root span for the request/message */
  span?: ISpanObserver;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Full observation context (use with runWithContext for nested ops) */
  context: ObservationContext;
}

/**
 * SQS message structure.
 */
export interface SqsMessage {
  messageId: string;
  body: string;
  messageAttributes?: Record<string, { stringValue?: string; StringValue?: string }>;
  attributes?: Record<string, string>;
}

/**
 * SQS message handler function type.
 */
export type SqsMessageHandler = (
  message: SqsMessage,
  context: ObservationContext
) => Promise<void>;

// ============================================================================
// Request Context Storage
// ============================================================================

/**
 * WeakMap for storing context across middleware phases.
 * Automatically cleaned up when request object is garbage collected.
 */
const requestContextMap = new WeakMap<object, ObservabilityContextData>();

// ============================================================================
// Helpers
// ============================================================================

function isObservabilityContextData(value: unknown): value is ObservabilityContextData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'correlationId' in value &&
    'context' in value
  );
}

function getObsContextFromCtx(ctx: ExecutionContext | undefined): ObservabilityContextData | undefined {
  const obs = ctx?.observability;
  return isObservabilityContextData(obs) ? obs : undefined;
}

function setObsContextOnCtx(ctx: ExecutionContext | undefined, data: ObservabilityContextData): void {
  if (ctx) {
    (ctx as ExecutionContext<ObservabilityContextData>).observability = data;
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
export const apiGatewayObservabilityMiddleware: APIControllerMiddleware = {
  async before(request, _response, ctx) {
    // Extract incoming trace context
    const parsed = extractTraceContextFromHeaders(request.headers || {});

    // Create observation context
    const correlationId = parsed?.correlationId || request.requestId || randomUUID();
    const observationContext = createObservationContext(correlationId, {
      parentLogId: parsed?.parentLogId,
      actor: ctx?.actor,
      sampled: parsed?.sampled,
    });

    // Create observability data
    const obsData: ObservabilityContextData = {
      correlationId: observationContext.correlationId,
      context: observationContext,
    };

    // Store for after/onError phases
    requestContextMap.set(request, obsData);

    // Create root span (within context for proper propagation)
    await runWithContext(observationContext, async () => {
      const span = SpanObserver.start(`HTTP ${request.httpMethod} ${request.path}`, {
        correlationId: observationContext.correlationId,
        level: 'info',
        attributes: {
          'http.method': request.httpMethod,
          'http.url': request.path,
          'http.path': request.path,
          'http.user_agent': request.headers?.[ 'user-agent' ],
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
        await runWithContext(obsData.context, async () => {
          const span = obsData.span;
          if (span) {
            span.setAttribute('http.status_code', response.statusCode || 200);

            // Add trace headers to response
            const headers = createPropagationHeaders(obsData.context);
            Object.entries(headers).forEach(([ key, value ]) => {
              response.setHeader(key, value);
            });

            span.end({ success: (response.statusCode || 200) < 400 });
          }
          await ObservabilityManager.flush();
        });
      } else {
        await ObservabilityManager.flush();
      }
    } finally {
      requestContextMap.delete(request);
    }
  },

  async onError(error, request, response, ctx) {
    const obsData = requestContextMap.get(request) || getObsContextFromCtx(ctx);

    try {
      if (obsData) {
        await runWithContext(obsData.context, async () => {
          const span = obsData.span;
          if (span) {
            span.setAttribute('http.status_code', response.statusCode || 500);
            span.setAttribute('error', true);
            span.end({ success: false, error });
          }
          await ObservabilityManager.flush();
        });
      } else {
        await ObservabilityManager.flush();
      }
    } finally {
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
export async function processSqsMessages(
  messages: SqsMessage[],
  handler: SqsMessageHandler
): Promise<Array<{ messageId: string; success: boolean; error?: Error }>> {
  const results: Array<{ messageId: string; success: boolean; error?: Error }> = [];

  for (const message of messages) {
    const parsed = extractTraceContextFromSqs(message.messageAttributes);
    const correlationId = parsed?.correlationId || message.messageId;

    const context = createObservationContext(correlationId, {
      parentLogId: parsed?.parentLogId,
      sampled: parsed?.sampled,
    });

    await runWithContext(context, async () => {
      const span = SpanObserver.start(`SQS ${message.messageId}`, {
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
      } catch (err) {
        const error = normalizeError(err);
        span.end({ success: false, error });
        results.push({ messageId: message.messageId, success: false, error });
      }

      await ObservabilityManager.flush();
    });
  }

  return results;
}
