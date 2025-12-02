/**
 * Context Management for Observability
 *
 * Provides context propagation for distributed tracing and observability correlation.
 *
 * ## Design: Single Context Mechanism
 *
 * This module uses **AsyncLocalStorage only** for context propagation:
 * - Standard Node.js mechanism for async context
 * - Automatic propagation across async boundaries (promises, callbacks)
 * - No module-level state, no Lambda-specific hacks
 *
 * ## Usage Patterns
 *
 * ### Lambda Handlers (Direct)
 * ```typescript
 * export const handler = async (event, lambdaContext) => {
 *   const context = createObservationContext(lambdaContext.awsRequestId, { ... });
 *   return runWithContext(context, async () => {
 *     // getCurrentContext() works here
 *     SpanObserver.start('operation');
 *   });
 * };
 * ```
 *
 * ### API Gateway Controllers (via Middleware)
 * The middleware stores context in `ExecutionContext.observability`.
 * Access it in your handler:
 * ```typescript
 * async myHandler(request, response, ctx) {
 *   // Option 1: Access context data directly
 *   const { correlationId } = ctx.observability;
 *
 *   // Option 2: Run code with full context propagation
 *   return runWithContext(ctx.observability.context, async () => {
 *     // getCurrentContext() works here
 *     SpanObserver.start('nested-operation');
 *   });
 * }
 * ```
 *
 * ## W3C Trace Context Compliance
 *
 * The traceparent header format is: `00-{trace-id}-{parent-id}-{flags}`
 * - trace-id: 32 lowercase hex chars
 * - parent-id: 16 lowercase hex chars
 * - flags: 2 lowercase hex chars (01 = sampled)
 *
 * @module observability/context
 */
import { Actor } from '../core/types/execution-context';
import { ObservationContext } from './types';
/**
 * Options for creating an observation context.
 */
export interface CreateObservationContextOptions {
    /** Parent log/span ID for trace hierarchy */
    parentLogId?: string;
    /** Actor performing the operation */
    actor?: Actor;
    /** Tags to attach to all events */
    tags?: Record<string, string>;
    /** Source identifier (e.g., 'UserController.create') */
    source?: string;
    /** Whether trace is sampled (default: true) */
    sampled?: boolean;
}
/**
 * Parsed trace context from incoming requests/messages.
 */
export interface ParsedTraceContext {
    /** Correlation/trace ID */
    correlationId: string;
    /** Parent span/log ID */
    parentLogId?: string;
    /** Whether trace is sampled */
    sampled?: boolean;
}
/**
 * Create a new observation context.
 *
 * @param correlationId - REQUIRED non-empty trace/correlation ID
 * @param options - Optional configuration
 * @throws Error if correlationId is empty
 */
export declare function createObservationContext(correlationId: string, options?: CreateObservationContextOptions): ObservationContext;
/**
 * Get the current observation context.
 * Returns undefined if no context is established.
 */
export declare function getCurrentContext(): ObservationContext | undefined;
/**
 * Check if context is established.
 */
export declare function hasContext(): boolean;
/**
 * Get correlation ID from current context.
 * @throws Error if no context is established
 */
export declare function getCorrelationId(): string;
/**
 * Get correlation ID if context exists, undefined otherwise.
 */
export declare function getCorrelationIdIfExists(): string | undefined;
/**
 * Get actor from current context.
 */
export declare function getContextActor(): Actor | undefined;
/**
 * Run a function with the given observation context.
 *
 * This is THE way to establish context. All code within the function
 * will have access to the context via getCurrentContext().
 *
 * @example
 * ```typescript
 * await runWithContext(context, async () => {
 *   // getCurrentContext() returns the context here
 *   const span = SpanObserver.start('operation');
 *   await doWork();
 *   span.end({ success: true });
 * });
 * ```
 */
export declare function runWithContext<T>(context: ObservationContext, fn: () => Promise<T>): Promise<T>;
/**
 * Run a sync function with the given observation context.
 */
export declare function runWithContextSync<T>(context: ObservationContext, fn: () => T): T;
/**
 * Update actor in current context.
 * Useful when actor becomes available after context creation (e.g., post-auth).
 *
 * @throws Error if no context is established
 */
export declare function setContextActor(actor: Actor): void;
/**
 * Add tags to current context (merged with existing).
 *
 * @throws Error if no context is established
 */
export declare function addContextTags(tags: Record<string, string>): void;
/**
 * Set parent log ID in current context.
 *
 * @throws Error if no context is established
 */
export declare function setContextParentLogId(parentLogId: string): void;
/**
 * Convert UUID/string to valid W3C trace-id (32 hex chars).
 */
export declare function toW3CTraceId(id: string): string;
/**
 * Convert UUID/string to valid W3C parent-id (16 hex chars).
 */
export declare function toW3CParentId(id: string): string;
/**
 * Extract trace context from HTTP headers.
 *
 * Priority: x-correlation-id > traceparent (W3C) > x-amzn-trace-id (X-Ray)
 */
export declare function extractTraceContextFromHeaders(headers: Record<string, string | undefined>): ParsedTraceContext | undefined;
/**
 * Extract trace context from SQS message attributes.
 */
export declare function extractTraceContextFromSqs(messageAttributes?: Record<string, {
    stringValue?: string;
    StringValue?: string;
}>): ParsedTraceContext | undefined;
/**
 * Extract trace context from SNS message attributes.
 */
export declare function extractTraceContextFromSns(messageAttributes?: Record<string, {
    Type?: string;
    Value?: string;
}>): ParsedTraceContext | undefined;
/**
 * Extract trace context from EventBridge event.
 */
export declare function extractTraceContextFromEventBridge(event: {
    detail?: Record<string, unknown>;
}): ParsedTraceContext | undefined;
/**
 * Extract trace context from Step Functions input.
 */
export declare function extractTraceContextFromStepFunctions(input: Record<string, unknown>): ParsedTraceContext | undefined;
/**
 * Extract trace context from Kinesis record.
 */
export declare function extractTraceContextFromKinesis(record: {
    kinesis?: {
        data?: string;
        partitionKey?: string;
    };
}): ParsedTraceContext | undefined;
/**
 * Extract trace context from DynamoDB Streams record.
 */
export declare function extractTraceContextFromDynamoDBStream(record: {
    dynamodb?: {
        NewImage?: Record<string, {
            S?: string;
            BOOL?: boolean;
        }>;
    };
    eventID?: string;
}): ParsedTraceContext | undefined;
/**
 * Create HTTP headers for trace propagation.
 * Includes both custom headers and W3C traceparent.
 */
export declare function createPropagationHeaders(context: ObservationContext): Record<string, string>;
/**
 * Create SQS message attributes for trace propagation.
 */
export declare function createSqsMessageAttributes(context: ObservationContext): Record<string, {
    DataType: string;
    StringValue: string;
}>;
/**
 * Create SNS message attributes for trace propagation.
 */
export declare function createSnsMessageAttributes(context: ObservationContext): Record<string, {
    DataType: string;
    StringValue: string;
}>;
/**
 * Create trace context for EventBridge event detail.
 */
export declare function createEventBridgeTraceContext(context: ObservationContext): Record<string, string | boolean>;
/**
 * Create trace context for Step Functions output.
 */
export declare function createStepFunctionsTraceContext(context: ObservationContext): Record<string, string | boolean>;
/**
 * @deprecated Use `runWithContext` instead
 */
export declare const withObservationContext: typeof runWithContext;
/**
 * @deprecated Use `runWithContextSync` instead
 */
export declare const withObservationContextSync: typeof runWithContextSync;
