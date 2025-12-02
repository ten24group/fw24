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
import { APIControllerMiddleware } from '../core/runtime/api-gateway-controller';
import { ISpanObserver } from './observers/span';
import { ObservationContext } from './types';
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
    messageAttributes?: Record<string, {
        stringValue?: string;
        StringValue?: string;
    }>;
    attributes?: Record<string, string>;
}
/**
 * SQS message handler function type.
 */
export type SqsMessageHandler = (message: SqsMessage, context: ObservationContext) => Promise<void>;
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
export declare const apiGatewayObservabilityMiddleware: APIControllerMiddleware;
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
export declare function processSqsMessages(messages: SqsMessage[], handler: SqsMessageHandler): Promise<Array<{
    messageId: string;
    success: boolean;
    error?: Error;
}>>;
