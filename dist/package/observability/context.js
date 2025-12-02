"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.withObservationContextSync = exports.withObservationContext = void 0;
exports.createObservationContext = createObservationContext;
exports.getCurrentContext = getCurrentContext;
exports.hasContext = hasContext;
exports.getCorrelationId = getCorrelationId;
exports.getCorrelationIdIfExists = getCorrelationIdIfExists;
exports.getContextActor = getContextActor;
exports.runWithContext = runWithContext;
exports.runWithContextSync = runWithContextSync;
exports.setContextActor = setContextActor;
exports.addContextTags = addContextTags;
exports.setContextParentLogId = setContextParentLogId;
exports.toW3CTraceId = toW3CTraceId;
exports.toW3CParentId = toW3CParentId;
exports.extractTraceContextFromHeaders = extractTraceContextFromHeaders;
exports.extractTraceContextFromSqs = extractTraceContextFromSqs;
exports.extractTraceContextFromSns = extractTraceContextFromSns;
exports.extractTraceContextFromEventBridge = extractTraceContextFromEventBridge;
exports.extractTraceContextFromStepFunctions = extractTraceContextFromStepFunctions;
exports.extractTraceContextFromKinesis = extractTraceContextFromKinesis;
exports.extractTraceContextFromDynamoDBStream = extractTraceContextFromDynamoDBStream;
exports.createPropagationHeaders = createPropagationHeaders;
exports.createSqsMessageAttributes = createSqsMessageAttributes;
exports.createSnsMessageAttributes = createSnsMessageAttributes;
exports.createEventBridgeTraceContext = createEventBridgeTraceContext;
exports.createStepFunctionsTraceContext = createStepFunctionsTraceContext;
const node_async_hooks_1 = require("node:async_hooks");
// ============================================================================
// Constants
// ============================================================================
/** W3C trace-id length (32 hex chars = 16 bytes) */
const W3C_TRACE_ID_LENGTH = 32;
/** W3C parent-id/span-id length (16 hex chars = 8 bytes) */
const W3C_PARENT_ID_LENGTH = 16;
// ============================================================================
// Context Storage (AsyncLocalStorage ONLY)
// ============================================================================
/**
 * AsyncLocalStorage for context propagation.
 * This is the ONLY storage mechanism - no module-level fallbacks.
 */
const storage = new node_async_hooks_1.AsyncLocalStorage();
// ============================================================================
// Context Creation
// ============================================================================
/**
 * Create a new observation context.
 *
 * @param correlationId - REQUIRED non-empty trace/correlation ID
 * @param options - Optional configuration
 * @throws Error if correlationId is empty
 */
function createObservationContext(correlationId, options) {
    const trimmedId = correlationId?.trim();
    if (!trimmedId) {
        throw new Error('correlationId is required and cannot be empty. ' +
            'Use request.requestId, context.awsRequestId, or crypto.randomUUID().');
    }
    return {
        correlationId: trimmedId,
        parentLogId: options?.parentLogId?.trim() || undefined,
        actor: options?.actor,
        tags: options?.tags,
        source: options?.source?.trim() || undefined,
        tenantId: options?.actor?.tenantId,
        sessionId: options?.actor?.sessionId,
        sampled: options?.sampled ?? true,
    };
}
// ============================================================================
// Context Access
// ============================================================================
/**
 * Get the current observation context.
 * Returns undefined if no context is established.
 */
function getCurrentContext() {
    return storage.getStore();
}
/**
 * Check if context is established.
 */
function hasContext() {
    return storage.getStore() !== undefined;
}
/**
 * Get correlation ID from current context.
 * @throws Error if no context is established
 */
function getCorrelationId() {
    const context = storage.getStore();
    if (!context) {
        throw new Error('No observation context. Wrap your code with runWithContext().');
    }
    return context.correlationId;
}
/**
 * Get correlation ID if context exists, undefined otherwise.
 */
function getCorrelationIdIfExists() {
    return storage.getStore()?.correlationId;
}
/**
 * Get actor from current context.
 */
function getContextActor() {
    return storage.getStore()?.actor;
}
// ============================================================================
// Context Execution
// ============================================================================
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
async function runWithContext(context, fn) {
    return storage.run(context, fn);
}
/**
 * Run a sync function with the given observation context.
 */
function runWithContextSync(context, fn) {
    return storage.run(context, fn);
}
// ============================================================================
// Context Modification
// ============================================================================
/**
 * Update actor in current context.
 * Useful when actor becomes available after context creation (e.g., post-auth).
 *
 * @throws Error if no context is established
 */
function setContextActor(actor) {
    const context = storage.getStore();
    if (!context) {
        throw new Error('No observation context. Cannot set actor.');
    }
    context.actor = actor;
    context.tenantId = actor.tenantId;
    context.sessionId = actor.sessionId;
}
/**
 * Add tags to current context (merged with existing).
 *
 * @throws Error if no context is established
 */
function addContextTags(tags) {
    const context = storage.getStore();
    if (!context) {
        throw new Error('No observation context. Cannot add tags.');
    }
    context.tags = { ...context.tags, ...tags };
}
/**
 * Set parent log ID in current context.
 *
 * @throws Error if no context is established
 */
function setContextParentLogId(parentLogId) {
    const context = storage.getStore();
    if (!context) {
        throw new Error('No observation context. Cannot set parent log ID.');
    }
    context.parentLogId = parentLogId;
}
// ============================================================================
// W3C Trace Context Utilities
// ============================================================================
/**
 * Convert UUID/string to valid W3C trace-id (32 hex chars).
 */
function toW3CTraceId(id) {
    const hex = id.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    return hex.length >= W3C_TRACE_ID_LENGTH
        ? hex.substring(0, W3C_TRACE_ID_LENGTH)
        : hex.padEnd(W3C_TRACE_ID_LENGTH, '0');
}
/**
 * Convert UUID/string to valid W3C parent-id (16 hex chars).
 */
function toW3CParentId(id) {
    const hex = id.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
    return hex.length >= W3C_PARENT_ID_LENGTH
        ? hex.substring(0, W3C_PARENT_ID_LENGTH)
        : hex.padEnd(W3C_PARENT_ID_LENGTH, '0');
}
// ============================================================================
// Trace Context Extraction (Incoming)
// ============================================================================
/**
 * Extract trace context from HTTP headers.
 *
 * Priority: x-correlation-id > traceparent (W3C) > x-amzn-trace-id (X-Ray)
 */
function extractTraceContextFromHeaders(headers) {
    if (!headers)
        return undefined;
    // Normalize to lowercase
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        normalized[key.toLowerCase()] = value;
    }
    // 1. Custom correlation ID
    const customId = normalized['x-correlation-id']?.trim();
    if (customId) {
        return {
            correlationId: customId,
            parentLogId: normalized['x-parent-log-id']?.trim(),
        };
    }
    // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
    const traceparent = normalized['traceparent'];
    if (traceparent && /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
        const parts = traceparent.split('-');
        return {
            correlationId: parts[1],
            parentLogId: parts[2],
            sampled: parts[3] === '01',
        };
    }
    // 3. X-Ray: Root=1-{epoch}-{unique};Parent={id};Sampled={0|1}
    const xray = normalized['x-amzn-trace-id'];
    if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
        const rootMatch = xray.match(/Root=([^;]+)/);
        const parentMatch = xray.match(/Parent=([^;]+)/);
        const sampledMatch = xray.match(/Sampled=([01])/);
        if (rootMatch) {
            return {
                correlationId: rootMatch[1].replace(/^1-/, '').replace(/-/g, ''),
                parentLogId: parentMatch?.[1],
                sampled: sampledMatch?.[1] === '1',
            };
        }
    }
    return undefined;
}
/**
 * Extract trace context from SQS message attributes.
 */
function extractTraceContextFromSqs(messageAttributes) {
    if (!messageAttributes)
        return undefined;
    // X-Ray header
    const xrayAttr = messageAttributes['AWSTraceHeader'];
    const xray = xrayAttr?.stringValue || xrayAttr?.StringValue;
    if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
        const rootMatch = xray.match(/Root=([^;]+)/);
        const parentMatch = xray.match(/Parent=([^;]+)/);
        const sampledMatch = xray.match(/Sampled=([01])/);
        if (rootMatch) {
            return {
                correlationId: rootMatch[1].replace(/^1-/, '').replace(/-/g, ''),
                parentLogId: parentMatch?.[1],
                sampled: sampledMatch?.[1] === '1',
            };
        }
    }
    // Custom attributes
    const correlationAttr = messageAttributes['correlationId'];
    const correlationId = (correlationAttr?.stringValue || correlationAttr?.StringValue)?.trim();
    if (correlationId) {
        const parentAttr = messageAttributes['parentLogId'];
        const sampledAttr = messageAttributes['sampled'];
        return {
            correlationId,
            parentLogId: (parentAttr?.stringValue || parentAttr?.StringValue)?.trim(),
            sampled: (sampledAttr?.stringValue || sampledAttr?.StringValue) === 'true',
        };
    }
    return undefined;
}
/**
 * Extract trace context from SNS message attributes.
 */
function extractTraceContextFromSns(messageAttributes) {
    if (!messageAttributes)
        return undefined;
    const correlationAttr = messageAttributes['correlationId'];
    if (correlationAttr?.Value?.trim()) {
        const parentAttr = messageAttributes['parentLogId'];
        const sampledAttr = messageAttributes['sampled'];
        return {
            correlationId: correlationAttr.Value.trim(),
            parentLogId: parentAttr?.Value?.trim(),
            sampled: sampledAttr?.Value === 'true',
        };
    }
    return undefined;
}
/**
 * Extract trace context from EventBridge event.
 */
function extractTraceContextFromEventBridge(event) {
    const detail = event?.detail;
    if (!detail)
        return undefined;
    // Direct fields
    const correlationId = detail['correlationId'] || detail['traceId'];
    if (typeof correlationId === 'string' && correlationId.trim()) {
        const parentLogId = detail['parentLogId'] || detail['parentId'];
        const sampled = detail['sampled'];
        return {
            correlationId: correlationId.trim(),
            parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext object
    const traceContext = detail['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string') {
        return {
            correlationId: traceContext.correlationId.trim(),
            parentLogId: typeof traceContext.parentLogId === 'string'
                ? traceContext.parentLogId.trim()
                : undefined,
            sampled: typeof traceContext.sampled === 'boolean'
                ? traceContext.sampled
                : traceContext.sampled === 'true',
        };
    }
    return undefined;
}
/**
 * Extract trace context from Step Functions input.
 */
function extractTraceContextFromStepFunctions(input) {
    if (!input)
        return undefined;
    // Direct fields
    const correlationId = input['correlationId'] || input['traceId'];
    if (typeof correlationId === 'string' && correlationId.trim()) {
        const parentLogId = input['parentLogId'] || input['parentId'];
        const sampled = input['sampled'];
        return {
            correlationId: correlationId.trim(),
            parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext
    const traceContext = input['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string') {
        return {
            correlationId: traceContext.correlationId.trim(),
            parentLogId: typeof traceContext.parentLogId === 'string'
                ? traceContext.parentLogId.trim()
                : undefined,
            sampled: typeof traceContext.sampled === 'boolean'
                ? traceContext.sampled
                : traceContext.sampled === 'true',
        };
    }
    // AWS execution context
    const awsContext = input['aws'];
    if (awsContext?.['executionArn'] && typeof awsContext['executionArn'] === 'string') {
        const arnParts = awsContext['executionArn'].split(':');
        return { correlationId: arnParts[arnParts.length - 1] };
    }
    return undefined;
}
/**
 * Extract trace context from Kinesis record.
 */
function extractTraceContextFromKinesis(record) {
    if (!record?.kinesis?.data)
        return undefined;
    try {
        const decoded = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
        const data = JSON.parse(decoded);
        const correlationId = data['correlationId'] || data['traceId'];
        if (typeof correlationId === 'string' && correlationId.trim()) {
            const parentLogId = data['parentLogId'] || data['parentId'];
            const sampled = data['sampled'];
            return {
                correlationId: correlationId.trim(),
                parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
                sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
            };
        }
    }
    catch {
        // Not JSON
    }
    // Fall back to partition key
    if (record.kinesis.partitionKey) {
        return { correlationId: record.kinesis.partitionKey };
    }
    return undefined;
}
/**
 * Extract trace context from DynamoDB Streams record.
 */
function extractTraceContextFromDynamoDBStream(record) {
    const newImage = record?.dynamodb?.NewImage;
    if (newImage) {
        const correlationId = newImage['correlationId']?.S || newImage['traceId']?.S;
        if (correlationId?.trim()) {
            const parentLogId = newImage['parentLogId']?.S || newImage['parentId']?.S;
            const sampled = newImage['sampled']?.BOOL ?? newImage['sampled']?.S === 'true';
            return {
                correlationId: correlationId.trim(),
                parentLogId: parentLogId?.trim(),
                sampled: typeof sampled === 'boolean' ? sampled : undefined,
            };
        }
    }
    // Fall back to event ID
    if (record?.eventID) {
        return { correlationId: record.eventID };
    }
    return undefined;
}
// ============================================================================
// Trace Context Propagation (Outgoing)
// ============================================================================
/**
 * Create HTTP headers for trace propagation.
 * Includes both custom headers and W3C traceparent.
 */
function createPropagationHeaders(context) {
    const headers = {
        'x-correlation-id': context.correlationId,
    };
    if (context.parentLogId) {
        headers['x-parent-log-id'] = context.parentLogId;
    }
    // W3C traceparent
    const sampledFlag = (context.sampled ?? true) ? '01' : '00';
    const traceId = toW3CTraceId(context.correlationId);
    const parentId = context.parentLogId
        ? toW3CParentId(context.parentLogId)
        : toW3CParentId(context.correlationId);
    headers['traceparent'] = `00-${traceId}-${parentId}-${sampledFlag}`;
    return headers;
}
/**
 * Create SQS message attributes for trace propagation.
 */
function createSqsMessageAttributes(context) {
    const attrs = {
        correlationId: { DataType: 'String', StringValue: context.correlationId },
        sampled: { DataType: 'String', StringValue: String(context.sampled ?? true) },
    };
    if (context.parentLogId) {
        attrs['parentLogId'] = { DataType: 'String', StringValue: context.parentLogId };
    }
    return attrs;
}
/**
 * Create SNS message attributes for trace propagation.
 */
function createSnsMessageAttributes(context) {
    return createSqsMessageAttributes(context);
}
/**
 * Create trace context for EventBridge event detail.
 */
function createEventBridgeTraceContext(context) {
    const traceContext = {
        correlationId: context.correlationId,
        sampled: context.sampled ?? true,
    };
    if (context.parentLogId) {
        traceContext['parentLogId'] = context.parentLogId;
    }
    return traceContext;
}
/**
 * Create trace context for Step Functions output.
 */
function createStepFunctionsTraceContext(context) {
    return createEventBridgeTraceContext(context);
}
// ============================================================================
// Legacy Aliases (for backward compatibility during migration)
// ============================================================================
/**
 * @deprecated Use `runWithContext` instead
 */
exports.withObservationContext = runWithContext;
/**
 * @deprecated Use `runWithContextSync` instead
 */
exports.withObservationContextSync = runWithContextSync;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGV4dC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2NvbnRleHQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaURHOzs7QUFxRUgsNERBc0JDO0FBVUQsOENBRUM7QUFLRCxnQ0FFQztBQU1ELDRDQVFDO0FBS0QsNERBRUM7QUFLRCwwQ0FFQztBQXNCRCx3Q0FLQztBQUtELGdEQUtDO0FBWUQsMENBUUM7QUFPRCx3Q0FNQztBQU9ELHNEQU1DO0FBU0Qsb0NBS0M7QUFLRCxzQ0FLQztBQVdELHdFQStDQztBQUtELGdFQW1DQztBQUtELGdFQWlCQztBQUtELGdGQWlDQztBQUtELG9GQXVDQztBQUtELHdFQTRCQztBQUtELHNGQTRCQztBQVVELDREQWtCQztBQUtELGdFQVdDO0FBS0QsZ0VBSUM7QUFLRCxzRUFXQztBQUtELDBFQUlDO0FBN2tCRCx1REFBcUQ7QUFJckQsK0VBQStFO0FBQy9FLFlBQVk7QUFDWiwrRUFBK0U7QUFFL0Usb0RBQW9EO0FBQ3BELE1BQU0sbUJBQW1CLEdBQUcsRUFBRSxDQUFDO0FBRS9CLDREQUE0RDtBQUM1RCxNQUFNLG9CQUFvQixHQUFHLEVBQUUsQ0FBQztBQUVoQywrRUFBK0U7QUFDL0UsMkNBQTJDO0FBQzNDLCtFQUErRTtBQUUvRTs7O0dBR0c7QUFDSCxNQUFNLE9BQU8sR0FBRyxJQUFJLG9DQUFpQixFQUFzQixDQUFDO0FBa0M1RCwrRUFBK0U7QUFDL0UsbUJBQW1CO0FBQ25CLCtFQUErRTtBQUUvRTs7Ozs7O0dBTUc7QUFDSCxTQUFnQix3QkFBd0IsQ0FDdEMsYUFBcUIsRUFDckIsT0FBeUM7SUFFekMsTUFBTSxTQUFTLEdBQUcsYUFBYSxFQUFFLElBQUksRUFBRSxDQUFDO0lBQ3hDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNmLE1BQU0sSUFBSSxL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KiBDb250ZXh0IE1hbmFnZW1lbnQgZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogUHJvdmlkZXMgY29udGV4dCBwcm9wYWdhdGlvbiBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZyBhbmQgb2JzZXJ2YWJpbGl0eSBjb3JyZWxhdGlvbi5cbiAqIFxuICogIyMgRGVzaWduOiBTaW5nbGUgQ29udGV4dCBNZWNoYW5pc21cbiAqIFxuICogVGhpcyBtb2R1bGUgdXNlcyAqKkFzeW5jTG9jYWxTdG9yYWdlIG9ubHkqKiBmb3IgY29udGV4dCBwcm9wYWdhdGlvbjpcbiAqIC0gU3RhbmRhcmQgTm9kZS5qcyBtZWNoYW5pc20gZm9yIGFzeW5jIGNvbnRleHRcbiAqIC0gQXV0b21hdGljIHByb3BhZ2F0aW9uIGFjcm9zcyBhc3luYyBib3VuZGFyaWVzIChwcm9taXNlcywgY2FsbGJhY2tzKVxuICogLSBObyBtb2R1bGUtbGV2ZWwgc3RhdGUsIG5vIExhbWJkYS1zcGVjaWZpYyBoYWNrc1xuICogXG4gKiAjIyBVc2FnZSBQYXR0ZXJuc1xuICogXG4gKiAjIyMgTGFtYmRhIEhhbmRsZXJzIChEaXJlY3QpXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBleHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudCwgbGFtYmRhQ29udGV4dCkgPT4ge1xuICogICBjb25zdCBjb250ZXh0ID0gY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KGxhbWJkYUNvbnRleHQuYXdzUmVxdWVzdElkLCB7IC4uLiB9KTtcbiAqICAgcmV0dXJuIHJ1bldpdGhDb250ZXh0KGNvbnRleHQsIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBnZXRDdXJyZW50Q29udGV4dCgpIHdvcmtzIGhlcmVcbiAqICAgICBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ29wZXJhdGlvbicpO1xuICogICB9KTtcbiAqIH07XG4gKiBgYGBcbiAqIFxuICogIyMjIEFQSSBHYXRld2F5IENvbnRyb2xsZXJzICh2aWEgTWlkZGxld2FyZSlcbiAqIFRoZSBtaWRkbGV3YXJlIHN0b3JlcyBjb250ZXh0IGluIGBFeGVjdXRpb25Db250ZXh0Lm9ic2VydmFiaWxpdHlgLlxuICogQWNjZXNzIGl0IGluIHlvdXIgaGFuZGxlcjpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGFzeW5jIG15SGFuZGxlcihyZXF1ZXN0LCByZXNwb25zZSwgY3R4KSB7XG4gKiAgIC8vIE9wdGlvbiAxOiBBY2Nlc3MgY29udGV4dCBkYXRhIGRpcmVjdGx5XG4gKiAgIGNvbnN0IHsgY29ycmVsYXRpb25JZCB9ID0gY3R4Lm9ic2VydmFiaWxpdHk7XG4gKiAgIFxuICogICAvLyBPcHRpb24gMjogUnVuIGNvZGUgd2l0aCBmdWxsIGNvbnRleHQgcHJvcGFnYXRpb25cbiAqICAgcmV0dXJuIHJ1bldpdGhDb250ZXh0KGN0eC5vYnNlcnZhYmlsaXR5LmNvbnRleHQsIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBnZXRDdXJyZW50Q29udGV4dCgpIHdvcmtzIGhlcmVcbiAqICAgICBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ25lc3RlZC1vcGVyYXRpb24nKTtcbiAqICAgfSk7XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogIyMgVzNDIFRyYWNlIENvbnRleHQgQ29tcGxpYW5jZVxuICogXG4gKiBUaGUgdHJhY2VwYXJlbnQgaGVhZGVyIGZvcm1hdCBpczogYDAwLXt0cmFjZS1pZH0te3BhcmVudC1pZH0te2ZsYWdzfWBcbiAqIC0gdHJhY2UtaWQ6IDMyIGxvd2VyY2FzZSBoZXggY2hhcnNcbiAqIC0gcGFyZW50LWlkOiAxNiBsb3dlcmNhc2UgaGV4IGNoYXJzICBcbiAqIC0gZmxhZ3M6IDIgbG93ZXJjYXNlIGhleCBjaGFycyAoMDEgPSBzYW1wbGVkKVxuICogXG4gKiBAbW9kdWxlIG9ic2VydmFiaWxpdHkvY29udGV4dFxuICovXG5cbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSAnbm9kZTphc3luY19ob29rcyc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YXRpb25Db250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnN0YW50c1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogVzNDIHRyYWNlLWlkIGxlbmd0aCAoMzIgaGV4IGNoYXJzID0gMTYgYnl0ZXMpICovXG5jb25zdCBXM0NfVFJBQ0VfSURfTEVOR1RIID0gMzI7XG5cbi8qKiBXM0MgcGFyZW50LWlkL3NwYW4taWQgbGVuZ3RoICgxNiBoZXggY2hhcnMgPSA4IGJ5dGVzKSAqL1xuY29uc3QgVzNDX1BBUkVOVF9JRF9MRU5HVEggPSAxNjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBTdG9yYWdlIChBc3luY0xvY2FsU3RvcmFnZSBPTkxZKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEFzeW5jTG9jYWxTdG9yYWdlIGZvciBjb250ZXh0IHByb3BhZ2F0aW9uLlxuICogVGhpcyBpcyB0aGUgT05MWSBzdG9yYWdlIG1lY2hhbmlzbSAtIG5vIG1vZHVsZS1sZXZlbCBmYWxsYmFja3MuXG4gKi9cbmNvbnN0IHN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2U8T2JzZXJ2YXRpb25Db250ZXh0PigpO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUeXBlc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGNyZWF0aW5nIGFuIG9ic2VydmF0aW9uIGNvbnRleHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0T3B0aW9ucyB7XG4gIC8qKiBQYXJlbnQgbG9nL3NwYW4gSUQgZm9yIHRyYWNlIGhpZXJhcmNoeSAqL1xuICBwYXJlbnRMb2dJZD86IHN0cmluZztcbiAgLyoqIEFjdG9yIHBlcmZvcm1pbmcgdGhlIG9wZXJhdGlvbiAqL1xuICBhY3Rvcj86IEFjdG9yO1xuICAvKiogVGFncyB0byBhdHRhY2ggdG8gYWxsIGV2ZW50cyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIFNvdXJjZSBpZGVudGlmaWVyIChlLmcuLCAnVXNlckNvbnRyb2xsZXIuY3JlYXRlJykgKi9cbiAgc291cmNlPzogc3RyaW5nO1xuICAvKiogV2hldGhlciB0cmFjZSBpcyBzYW1wbGVkIChkZWZhdWx0OiB0cnVlKSAqL1xuICBzYW1wbGVkPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBQYXJzZWQgdHJhY2UgY29udGV4dCBmcm9tIGluY29taW5nIHJlcXVlc3RzL21lc3NhZ2VzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZFRyYWNlQ29udGV4dCB7XG4gIC8qKiBDb3JyZWxhdGlvbi90cmFjZSBJRCAqL1xuICBjb3JyZWxhdGlvbklkOiBzdHJpbmc7XG4gIC8qKiBQYXJlbnQgc3Bhbi9sb2cgSUQgKi9cbiAgcGFyZW50TG9nSWQ/OiBzdHJpbmc7XG4gIC8qKiBXaGV0aGVyIHRyYWNlIGlzIHNhbXBsZWQgKi9cbiAgc2FtcGxlZD86IGJvb2xlYW47XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnRleHQgQ3JlYXRpb25cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDcmVhdGUgYSBuZXcgb2JzZXJ2YXRpb24gY29udGV4dC5cbiAqIFxuICogQHBhcmFtIGNvcnJlbGF0aW9uSWQgLSBSRVFVSVJFRCBub24tZW1wdHkgdHJhY2UvY29ycmVsYXRpb24gSURcbiAqIEBwYXJhbSBvcHRpb25zIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvblxuICogQHRocm93cyBFcnJvciBpZiBjb3JyZWxhdGlvbklkIGlzIGVtcHR5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQoXG4gIGNvcnJlbGF0aW9uSWQ6IHN0cmluZyxcbiAgb3B0aW9ucz86IENyZWF0ZU9ic2VydmF0aW9uQ29udGV4dE9wdGlvbnNcbik6IE9ic2VydmF0aW9uQ29udGV4dCB7XG4gIGNvbnN0IHRyaW1tZWRJZCA9IGNvcnJlbGF0aW9uSWQ/LnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZCBhbmQgY2Fubm90IGJlIGVtcHR5LiAnICtcbiAgICAgICdVc2UgcmVxdWVzdC5yZXF1ZXN0SWQsIGNvbnRleHQuYXdzUmVxdWVzdElkLCBvciBjcnlwdG8ucmFuZG9tVVVJRCgpLidcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBjb3JyZWxhdGlvbklkOiB0cmltbWVkSWQsXG4gICAgcGFyZW50TG9nSWQ6IG9wdGlvbnM/LnBhcmVudExvZ0lkPy50cmltKCkgfHwgdW5kZWZpbmVkLFxuICAgIGFjdG9yOiBvcHRpb25zPy5hY3RvcixcbiAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICAgIHNvdXJjZTogb3B0aW9ucz8uc291cmNlPy50cmltKCkgfHwgdW5kZWZpbmVkLFxuICAgIHRlbmFudElkOiBvcHRpb25zPy5hY3Rvcj8udGVuYW50SWQsXG4gICAgc2Vzc2lvbklkOiBvcHRpb25zPy5hY3Rvcj8uc2Vzc2lvbklkLFxuICAgIHNhbXBsZWQ6IG9wdGlvbnM/LnNhbXBsZWQgPz8gdHJ1ZSxcbiAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBBY2Nlc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBHZXQgdGhlIGN1cnJlbnQgb2JzZXJ2YXRpb24gY29udGV4dC5cbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGNvbnRleHQgaXMgZXN0YWJsaXNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDdXJyZW50Q29udGV4dCgpOiBPYnNlcnZhdGlvbkNvbnRleHQgfCB1bmRlZmluZWQge1xuICByZXR1cm4gc3RvcmFnZS5nZXRTdG9yZSgpO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGNvbnRleHQgaXMgZXN0YWJsaXNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoYXNDb250ZXh0KCk6IGJvb2xlYW4ge1xuICByZXR1cm4gc3RvcmFnZS5nZXRTdG9yZSgpICE9PSB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogR2V0IGNvcnJlbGF0aW9uIElEIGZyb20gY3VycmVudCBjb250ZXh0LlxuICogQHRocm93cyBFcnJvciBpZiBubyBjb250ZXh0IGlzIGVzdGFibGlzaGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDb3JyZWxhdGlvbklkKCk6IHN0cmluZyB7XG4gIGNvbnN0IGNvbnRleHQgPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmICghY29udGV4dCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdObyBvYnNlcnZhdGlvbiBjb250ZXh0LiBXcmFwIHlvdXIgY29kZSB3aXRoIHJ1bldpdGhDb250ZXh0KCkuJ1xuICAgICk7XG4gIH1cbiAgcmV0dXJuIGNvbnRleHQuY29ycmVsYXRpb25JZDtcbn1cblxuLyoqXG4gKiBHZXQgY29ycmVsYXRpb24gSUQgaWYgY29udGV4dCBleGlzdHMsIHVuZGVmaW5lZCBvdGhlcndpc2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHN0b3JhZ2UuZ2V0U3RvcmUoKT8uY29ycmVsYXRpb25JZDtcbn1cblxuLyoqXG4gKiBHZXQgYWN0b3IgZnJvbSBjdXJyZW50IGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRDb250ZXh0QWN0b3IoKTogQWN0b3IgfCB1bmRlZmluZWQge1xuICByZXR1cm4gc3RvcmFnZS5nZXRTdG9yZSgpPy5hY3Rvcjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29udGV4dCBFeGVjdXRpb25cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSdW4gYSBmdW5jdGlvbiB3aXRoIHRoZSBnaXZlbiBvYnNlcnZhdGlvbiBjb250ZXh0LlxuICogXG4gKiBUaGlzIGlzIFRIRSB3YXkgdG8gZXN0YWJsaXNoIGNvbnRleHQuIEFsbCBjb2RlIHdpdGhpbiB0aGUgZnVuY3Rpb25cbiAqIHdpbGwgaGF2ZSBhY2Nlc3MgdG8gdGhlIGNvbnRleHQgdmlhIGdldEN1cnJlbnRDb250ZXh0KCkuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChjb250ZXh0LCBhc3luYyAoKSA9PiB7XG4gKiAgIC8vIGdldEN1cnJlbnRDb250ZXh0KCkgcmV0dXJucyB0aGUgY29udGV4dCBoZXJlXG4gKiAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ29wZXJhdGlvbicpO1xuICogICBhd2FpdCBkb1dvcmsoKTtcbiAqICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bldpdGhDb250ZXh0PFQ+KFxuICBjb250ZXh0OiBPYnNlcnZhdGlvbkNvbnRleHQsXG4gIGZuOiAoKSA9PiBQcm9taXNlPFQ+XG4pOiBQcm9taXNlPFQ+IHtcbiAgcmV0dXJuIHN0b3JhZ2UucnVuKGNvbnRleHQsIGZuKTtcbn1cblxuLyoqXG4gKiBSdW4gYSBzeW5jIGZ1bmN0aW9uIHdpdGggdGhlIGdpdmVuIG9ic2VydmF0aW9uIGNvbnRleHQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBydW5XaXRoQ29udGV4dFN5bmM8VD4oXG4gIGNvbnRleHQ6IE9ic2VydmF0aW9uQ29udGV4dCxcbiAgZm46ICgpID0+IFRcbik6IFQge1xuICByZXR1cm4gc3RvcmFnZS5ydW4oY29udGV4dCwgZm4pO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb250ZXh0IE1vZGlmaWNhdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFVwZGF0ZSBhY3RvciBpbiBjdXJyZW50IGNvbnRleHQuXG4gKiBVc2VmdWwgd2hlbiBhY3RvciBiZWNvbWVzIGF2YWlsYWJsZSBhZnRlciBjb250ZXh0IGNyZWF0aW9uIChlLmcuLCBwb3N0LWF1dGgpLlxuICogXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGNvbnRleHQgaXMgZXN0YWJsaXNoZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldENvbnRleHRBY3RvcihhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgY29uc3QgY29udGV4dCA9IHN0b3JhZ2UuZ2V0U3RvcmUoKTtcbiAgaWYgKCFjb250ZXh0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdObyBvYnNlcnZhdGlvbiBjb250ZXh0LiBDYW5ub3Qgc2V0IGFjdG9yLicpO1xuICB9XG4gIGNvbnRleHQuYWN0b3IgPSBhY3RvcjtcbiAgY29udGV4dC50ZW5hbnRJZCA9IGFjdG9yLnRlbmFudElkO1xuICBjb250ZXh0LnNlc3Npb25JZCA9IGFjdG9yLnNlc3Npb25JZDtcbn1cblxuLyoqXG4gKiBBZGQgdGFncyB0byBjdXJyZW50IGNvbnRleHQgKG1lcmdlZCB3aXRoIGV4aXN0aW5nKS5cbiAqIFxuICogQHRocm93cyBFcnJvciBpZiBubyBjb250ZXh0IGlzIGVzdGFibGlzaGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZGRDb250ZXh0VGFncyh0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogdm9pZCB7XG4gIGNvbnN0IGNvbnRleHQgPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmICghY29udGV4dCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTm8gb2JzZXJ2YXRpb24gY29udGV4dC4gQ2Fubm90IGFkZCB0YWdzLicpO1xuICB9XG4gIGNvbnRleHQudGFncyA9IHsgLi4uY29udGV4dC50YWdzLCAuLi50YWdzIH07XG59XG5cbi8qKlxuICogU2V0IHBhcmVudCBsb2cgSUQgaW4gY3VycmVudCBjb250ZXh0LlxuICogXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIGNvbnRleHQgaXMgZXN0YWJsaXNoZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldENvbnRleHRQYXJlbnRMb2dJZChwYXJlbnRMb2dJZDogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRleHQgPSBzdG9yYWdlLmdldFN0b3JlKCk7XG4gIGlmICghY29udGV4dCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTm8gb2JzZXJ2YXRpb24gY29udGV4dC4gQ2Fubm90IHNldCBwYXJlbnQgbG9nIElELicpO1xuICB9XG4gIGNvbnRleHQucGFyZW50TG9nSWQgPSBwYXJlbnRMb2dJZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVzNDIFRyYWNlIENvbnRleHQgVXRpbGl0aWVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udmVydCBVVUlEL3N0cmluZyB0byB2YWxpZCBXM0MgdHJhY2UtaWQgKDMyIGhleCBjaGFycykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1czQ1RyYWNlSWQoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhleCA9IGlkLnJlcGxhY2UoL1teYS1mQS1GMC05XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhleC5sZW5ndGggPj0gVzNDX1RSQUNFX0lEX0xFTkdUSFxuICAgID8gaGV4LnN1YnN0cmluZygwLCBXM0NfVFJBQ0VfSURfTEVOR1RIKVxuICAgIDogaGV4LnBhZEVuZChXM0NfVFJBQ0VfSURfTEVOR1RILCAnMCcpO1xufVxuXG4vKipcbiAqIENvbnZlcnQgVVVJRC9zdHJpbmcgdG8gdmFsaWQgVzNDIHBhcmVudC1pZCAoMTYgaGV4IGNoYXJzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvVzNDUGFyZW50SWQoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhleCA9IGlkLnJlcGxhY2UoL1teYS1mQS1GMC05XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhleC5sZW5ndGggPj0gVzNDX1BBUkVOVF9JRF9MRU5HVEhcbiAgICA/IGhleC5zdWJzdHJpbmcoMCwgVzNDX1BBUkVOVF9JRF9MRU5HVEgpXG4gICAgOiBoZXgucGFkRW5kKFczQ19QQVJFTlRfSURfTEVOR1RILCAnMCcpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IEV4dHJhY3Rpb24gKEluY29taW5nKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIEhUVFAgaGVhZGVycy5cbiAqIFxuICogUHJpb3JpdHk6IHgtY29ycmVsYXRpb24taWQgPiB0cmFjZXBhcmVudCAoVzNDKSA+IHgtYW16bi10cmFjZS1pZCAoWC1SYXkpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0VHJhY2VDb250ZXh0RnJvbUhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghaGVhZGVycykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBOb3JtYWxpemUgdG8gbG93ZXJjYXNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gPSB7fTtcbiAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgIG5vcm1hbGl6ZWRbIGtleS50b0xvd2VyQ2FzZSgpIF0gPSB2YWx1ZTtcbiAgfVxuXG4gIC8vIDEuIEN1c3RvbSBjb3JyZWxhdGlvbiBJRFxuICBjb25zdCBjdXN0b21JZCA9IG5vcm1hbGl6ZWRbICd4LWNvcnJlbGF0aW9uLWlkJyBdPy50cmltKCk7XG4gIGlmIChjdXN0b21JZCkge1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjdXN0b21JZCxcbiAgICAgIHBhcmVudExvZ0lkOiBub3JtYWxpemVkWyAneC1wYXJlbnQtbG9nLWlkJyBdPy50cmltKCksXG4gICAgfTtcbiAgfVxuXG4gIC8vIDIuIFczQyB0cmFjZXBhcmVudDogMDAte3RyYWNlLWlkfS17cGFyZW50LWlkfS17ZmxhZ3N9XG4gIGNvbnN0IHRyYWNlcGFyZW50ID0gbm9ybWFsaXplZFsgJ3RyYWNlcGFyZW50JyBdO1xuICBpZiAodHJhY2VwYXJlbnQgJiYgL15bMC05YS1mXXsyfS1bMC05YS1mXXszMn0tWzAtOWEtZl17MTZ9LVswLTlhLWZdezJ9JC8udGVzdCh0cmFjZXBhcmVudCkpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHRyYWNlcGFyZW50LnNwbGl0KCctJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHBhcnRzWyAxIF0sXG4gICAgICBwYXJlbnRMb2dJZDogcGFydHNbIDIgXSxcbiAgICAgIHNhbXBsZWQ6IHBhcnRzWyAzIF0gPT09ICcwMScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMuIFgtUmF5OiBSb290PTEte2Vwb2NofS17dW5pcXVlfTtQYXJlbnQ9e2lkfTtTYW1wbGVkPXswfDF9XG4gIGNvbnN0IHhyYXkgPSBub3JtYWxpemVkWyAneC1hbXpuLXRyYWNlLWlkJyBdO1xuICBpZiAoeHJheSAmJiAvUm9vdD0xLVswLTlhLWZdezh9LVswLTlhLWZdezI0fS8udGVzdCh4cmF5KSkge1xuICAgIGNvbnN0IHJvb3RNYXRjaCA9IHhyYXkubWF0Y2goL1Jvb3Q9KFteO10rKS8pO1xuICAgIGNvbnN0IHBhcmVudE1hdGNoID0geHJheS5tYXRjaCgvUGFyZW50PShbXjtdKykvKTtcbiAgICBjb25zdCBzYW1wbGVkTWF0Y2ggPSB4cmF5Lm1hdGNoKC9TYW1wbGVkPShbMDFdKS8pO1xuICAgIGlmIChyb290TWF0Y2gpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHJvb3RNYXRjaFsgMSBdLnJlcGxhY2UoL14xLS8sICcnKS5yZXBsYWNlKC8tL2csICcnKSxcbiAgICAgICAgcGFyZW50TG9nSWQ6IHBhcmVudE1hdGNoPy5bIDEgXSxcbiAgICAgICAgc2FtcGxlZDogc2FtcGxlZE1hdGNoPy5bIDEgXSA9PT0gJzEnLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIFNRUyBtZXNzYWdlIGF0dHJpYnV0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0VHJhY2VDb250ZXh0RnJvbVNxcyhcbiAgbWVzc2FnZUF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7IHN0cmluZ1ZhbHVlPzogc3RyaW5nOyBTdHJpbmdWYWx1ZT86IHN0cmluZyB9PlxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFtZXNzYWdlQXR0cmlidXRlcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBYLVJheSBoZWFkZXJcbiAgY29uc3QgeHJheUF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ0FXU1RyYWNlSGVhZGVyJyBdO1xuICBjb25zdCB4cmF5ID0geHJheUF0dHI/LnN0cmluZ1ZhbHVlIHx8IHhyYXlBdHRyPy5TdHJpbmdWYWx1ZTtcbiAgaWYgKHhyYXkgJiYgL1Jvb3Q9MS1bMC05YS1mXXs4fS1bMC05YS1mXXsyNH0vLnRlc3QoeHJheSkpIHtcbiAgICBjb25zdCByb290TWF0Y2ggPSB4cmF5Lm1hdGNoKC9Sb290PShbXjtdKykvKTtcbiAgICBjb25zdCBwYXJlbnRNYXRjaCA9IHhyYXkubWF0Y2goL1BhcmVudD0oW147XSspLyk7XG4gICAgY29uc3Qgc2FtcGxlZE1hdGNoID0geHJheS5tYXRjaCgvU2FtcGxlZD0oWzAxXSkvKTtcbiAgICBpZiAocm9vdE1hdGNoKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiByb290TWF0Y2hbIDEgXS5yZXBsYWNlKC9eMS0vLCAnJykucmVwbGFjZSgvLS9nLCAnJyksXG4gICAgICAgIHBhcmVudExvZ0lkOiBwYXJlbnRNYXRjaD8uWyAxIF0sXG4gICAgICAgIHNhbXBsZWQ6IHNhbXBsZWRNYXRjaD8uWyAxIF0gPT09ICcxJyxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gQ3VzdG9tIGF0dHJpYnV0ZXNcbiAgY29uc3QgY29ycmVsYXRpb25BdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjb3JyZWxhdGlvbklkJyBdO1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gKGNvcnJlbGF0aW9uQXR0cj8uc3RyaW5nVmFsdWUgfHwgY29ycmVsYXRpb25BdHRyPy5TdHJpbmdWYWx1ZSk/LnRyaW0oKTtcbiAgaWYgKGNvcnJlbGF0aW9uSWQpIHtcbiAgICBjb25zdCBwYXJlbnRBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdwYXJlbnRMb2dJZCcgXTtcbiAgICBjb25zdCBzYW1wbGVkQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnc2FtcGxlZCcgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudExvZ0lkOiAocGFyZW50QXR0cj8uc3RyaW5nVmFsdWUgfHwgcGFyZW50QXR0cj8uU3RyaW5nVmFsdWUpPy50cmltKCksXG4gICAgICBzYW1wbGVkOiAoc2FtcGxlZEF0dHI/LnN0cmluZ1ZhbHVlIHx8IHNhbXBsZWRBdHRyPy5TdHJpbmdWYWx1ZSkgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTTlMgbWVzc2FnZSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFRyYWNlQ29udGV4dEZyb21TbnMoXG4gIG1lc3NhZ2VBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgeyBUeXBlPzogc3RyaW5nOyBWYWx1ZT86IHN0cmluZyB9PlxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFtZXNzYWdlQXR0cmlidXRlcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBjb3JyZWxhdGlvbkF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ2NvcnJlbGF0aW9uSWQnIF07XG4gIGlmIChjb3JyZWxhdGlvbkF0dHI/LlZhbHVlPy50cmltKCkpIHtcbiAgICBjb25zdCBwYXJlbnRBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdwYXJlbnRMb2dJZCcgXTtcbiAgICBjb25zdCBzYW1wbGVkQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnc2FtcGxlZCcgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25BdHRyLlZhbHVlLnRyaW0oKSxcbiAgICAgIHBhcmVudExvZ0lkOiBwYXJlbnRBdHRyPy5WYWx1ZT8udHJpbSgpLFxuICAgICAgc2FtcGxlZDogc2FtcGxlZEF0dHI/LlZhbHVlID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gRXZlbnRCcmlkZ2UgZXZlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0VHJhY2VDb250ZXh0RnJvbUV2ZW50QnJpZGdlKFxuICBldmVudDogeyBkZXRhaWw/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBjb25zdCBkZXRhaWwgPSBldmVudD8uZGV0YWlsO1xuICBpZiAoIWRldGFpbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBEaXJlY3QgZmllbGRzXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBkZXRhaWxbICdjb3JyZWxhdGlvbklkJyBdIHx8IGRldGFpbFsgJ3RyYWNlSWQnIF07XG4gIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICBjb25zdCBwYXJlbnRMb2dJZCA9IGRldGFpbFsgJ3BhcmVudExvZ0lkJyBdIHx8IGRldGFpbFsgJ3BhcmVudElkJyBdO1xuICAgIGNvbnN0IHNhbXBsZWQgPSBkZXRhaWxbICdzYW1wbGVkJyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbklkLnRyaW0oKSxcbiAgICAgIHBhcmVudExvZ0lkOiB0eXBlb2YgcGFyZW50TG9nSWQgPT09ICdzdHJpbmcnID8gcGFyZW50TG9nSWQudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5lc3RlZCB0cmFjZUNvbnRleHQgb2JqZWN0XG4gIGNvbnN0IHRyYWNlQ29udGV4dCA9IGRldGFpbFsgJ3RyYWNlQ29udGV4dCcgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKHRyYWNlQ29udGV4dCAmJiB0eXBlb2YgdHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICh0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCBhcyBzdHJpbmcpLnRyaW0oKSxcbiAgICAgIHBhcmVudExvZ0lkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnBhcmVudExvZ0lkID09PSAnc3RyaW5nJ1xuICAgICAgICA/ICh0cmFjZUNvbnRleHQucGFyZW50TG9nSWQgYXMgc3RyaW5nKS50cmltKClcbiAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICBzYW1wbGVkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICdib29sZWFuJ1xuICAgICAgICA/IHRyYWNlQ29udGV4dC5zYW1wbGVkXG4gICAgICAgIDogdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTdGVwIEZ1bmN0aW9ucyBpbnB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RUcmFjZUNvbnRleHRGcm9tU3RlcEZ1bmN0aW9ucyhcbiAgaW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIWlucHV0KSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIERpcmVjdCBmaWVsZHNcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGlucHV0WyAnY29ycmVsYXRpb25JZCcgXSB8fCBpbnB1dFsgJ3RyYWNlSWQnIF07XG4gIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICBjb25zdCBwYXJlbnRMb2dJZCA9IGlucHV0WyAncGFyZW50TG9nSWQnIF0gfHwgaW5wdXRbICdwYXJlbnRJZCcgXTtcbiAgICBjb25zdCBzYW1wbGVkID0gaW5wdXRbICdzYW1wbGVkJyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbklkLnRyaW0oKSxcbiAgICAgIHBhcmVudExvZ0lkOiB0eXBlb2YgcGFyZW50TG9nSWQgPT09ICdzdHJpbmcnID8gcGFyZW50TG9nSWQudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5lc3RlZCB0cmFjZUNvbnRleHRcbiAgY29uc3QgdHJhY2VDb250ZXh0ID0gaW5wdXRbICd0cmFjZUNvbnRleHQnIF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGlmICh0cmFjZUNvbnRleHQgJiYgdHlwZW9mIHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiAodHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgYXMgc3RyaW5nKS50cmltKCksXG4gICAgICBwYXJlbnRMb2dJZDogdHlwZW9mIHRyYWNlQ29udGV4dC5wYXJlbnRMb2dJZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyAodHJhY2VDb250ZXh0LnBhcmVudExvZ0lkIGFzIHN0cmluZykudHJpbSgpXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAnYm9vbGVhbidcbiAgICAgICAgPyB0cmFjZUNvbnRleHQuc2FtcGxlZFxuICAgICAgICA6IHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFXUyBleGVjdXRpb24gY29udGV4dFxuICBjb25zdCBhd3NDb250ZXh0ID0gaW5wdXRbICdhd3MnIF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGlmIChhd3NDb250ZXh0Py5bICdleGVjdXRpb25Bcm4nIF0gJiYgdHlwZW9mIGF3c0NvbnRleHRbICdleGVjdXRpb25Bcm4nIF0gPT09ICdzdHJpbmcnKSB7XG4gICAgY29uc3QgYXJuUGFydHMgPSAoYXdzQ29udGV4dFsgJ2V4ZWN1dGlvbkFybicgXSBhcyBzdHJpbmcpLnNwbGl0KCc6Jyk7XG4gICAgcmV0dXJuIHsgY29ycmVsYXRpb25JZDogYXJuUGFydHNbIGFyblBhcnRzLmxlbmd0aCAtIDEgXSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBLaW5lc2lzIHJlY29yZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RUcmFjZUNvbnRleHRGcm9tS2luZXNpcyhcbiAgcmVjb3JkOiB7IGtpbmVzaXM/OiB7IGRhdGE/OiBzdHJpbmc7IHBhcnRpdGlvbktleT86IHN0cmluZyB9IH1cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghcmVjb3JkPy5raW5lc2lzPy5kYXRhKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgZGVjb2RlZCA9IEJ1ZmZlci5mcm9tKHJlY29yZC5raW5lc2lzLmRhdGEsICdiYXNlNjQnKS50b1N0cmluZygndXRmLTgnKTtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShkZWNvZGVkKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZGF0YVsgJ2NvcnJlbGF0aW9uSWQnIF0gfHwgZGF0YVsgJ3RyYWNlSWQnIF07XG4gICAgaWYgKHR5cGVvZiBjb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBjb3JyZWxhdGlvbklkLnRyaW0oKSkge1xuICAgICAgY29uc3QgcGFyZW50TG9nSWQgPSBkYXRhWyAncGFyZW50TG9nSWQnIF0gfHwgZGF0YVsgJ3BhcmVudElkJyBdO1xuICAgICAgY29uc3Qgc2FtcGxlZCA9IGRhdGFbICdzYW1wbGVkJyBdO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICAgIHBhcmVudExvZ0lkOiB0eXBlb2YgcGFyZW50TG9nSWQgPT09ICdzdHJpbmcnID8gcGFyZW50TG9nSWQudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICAgIH07XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBOb3QgSlNPTlxuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIHBhcnRpdGlvbiBrZXlcbiAgaWYgKHJlY29yZC5raW5lc2lzLnBhcnRpdGlvbktleSkge1xuICAgIHJldHVybiB7IGNvcnJlbGF0aW9uSWQ6IHJlY29yZC5raW5lc2lzLnBhcnRpdGlvbktleSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBEeW5hbW9EQiBTdHJlYW1zIHJlY29yZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RUcmFjZUNvbnRleHRGcm9tRHluYW1vREJTdHJlYW0oXG4gIHJlY29yZDoge1xuICAgIGR5bmFtb2RiPzoge1xuICAgICAgTmV3SW1hZ2U/OiBSZWNvcmQ8c3RyaW5nLCB7IFM/OiBzdHJpbmc7IEJPT0w/OiBib29sZWFuIH0+O1xuICAgIH07XG4gICAgZXZlbnRJRD86IHN0cmluZztcbiAgfVxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbmV3SW1hZ2UgPSByZWNvcmQ/LmR5bmFtb2RiPy5OZXdJbWFnZTtcbiAgaWYgKG5ld0ltYWdlKSB7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IG5ld0ltYWdlWyAnY29ycmVsYXRpb25JZCcgXT8uUyB8fCBuZXdJbWFnZVsgJ3RyYWNlSWQnIF0/LlM7XG4gICAgaWYgKGNvcnJlbGF0aW9uSWQ/LnRyaW0oKSkge1xuICAgICAgY29uc3QgcGFyZW50TG9nSWQgPSBuZXdJbWFnZVsgJ3BhcmVudExvZ0lkJyBdPy5TIHx8IG5ld0ltYWdlWyAncGFyZW50SWQnIF0/LlM7XG4gICAgICBjb25zdCBzYW1wbGVkID0gbmV3SW1hZ2VbICdzYW1wbGVkJyBdPy5CT09MID8/IG5ld0ltYWdlWyAnc2FtcGxlZCcgXT8uUyA9PT0gJ3RydWUnO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICAgIHBhcmVudExvZ0lkOiBwYXJlbnRMb2dJZD8udHJpbSgpLFxuICAgICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIGV2ZW50IElEXG4gIGlmIChyZWNvcmQ/LmV2ZW50SUQpIHtcbiAgICByZXR1cm4geyBjb3JyZWxhdGlvbklkOiByZWNvcmQuZXZlbnRJRCB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVHJhY2UgQ29udGV4dCBQcm9wYWdhdGlvbiAoT3V0Z29pbmcpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ3JlYXRlIEhUVFAgaGVhZGVycyBmb3IgdHJhY2UgcHJvcGFnYXRpb24uXG4gKiBJbmNsdWRlcyBib3RoIGN1c3RvbSBoZWFkZXJzIGFuZCBXM0MgdHJhY2VwYXJlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVQcm9wYWdhdGlvbkhlYWRlcnMoY29udGV4dDogT2JzZXJ2YXRpb25Db250ZXh0KTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJ3gtY29ycmVsYXRpb24taWQnOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gIH07XG5cbiAgaWYgKGNvbnRleHQucGFyZW50TG9nSWQpIHtcbiAgICBoZWFkZXJzWyAneC1wYXJlbnQtbG9nLWlkJyBdID0gY29udGV4dC5wYXJlbnRMb2dJZDtcbiAgfVxuXG4gIC8vIFczQyB0cmFjZXBhcmVudFxuICBjb25zdCBzYW1wbGVkRmxhZyA9IChjb250ZXh0LnNhbXBsZWQgPz8gdHJ1ZSkgPyAnMDEnIDogJzAwJztcbiAgY29uc3QgdHJhY2VJZCA9IHRvVzNDVHJhY2VJZChjb250ZXh0LmNvcnJlbGF0aW9uSWQpO1xuICBjb25zdCBwYXJlbnRJZCA9IGNvbnRleHQucGFyZW50TG9nSWRcbiAgICA/IHRvVzNDUGFyZW50SWQoY29udGV4dC5wYXJlbnRMb2dJZClcbiAgICA6IHRvVzNDUGFyZW50SWQoY29udGV4dC5jb3JyZWxhdGlvbklkKTtcbiAgaGVhZGVyc1sgJ3RyYWNlcGFyZW50JyBdID0gYDAwLSR7dHJhY2VJZH0tJHtwYXJlbnRJZH0tJHtzYW1wbGVkRmxhZ31gO1xuXG4gIHJldHVybiBoZWFkZXJzO1xufVxuXG4vKipcbiAqIENyZWF0ZSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciB0cmFjZSBwcm9wYWdhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNxc01lc3NhZ2VBdHRyaWJ1dGVzKFxuICBjb250ZXh0OiBPYnNlcnZhdGlvbkNvbnRleHRcbik6IFJlY29yZDxzdHJpbmcsIHsgRGF0YVR5cGU6IHN0cmluZzsgU3RyaW5nVmFsdWU6IHN0cmluZyB9PiB7XG4gIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4gPSB7XG4gICAgY29ycmVsYXRpb25JZDogeyBEYXRhVHlwZTogJ1N0cmluZycsIFN0cmluZ1ZhbHVlOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQgfSxcbiAgICBzYW1wbGVkOiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IFN0cmluZyhjb250ZXh0LnNhbXBsZWQgPz8gdHJ1ZSkgfSxcbiAgfTtcbiAgaWYgKGNvbnRleHQucGFyZW50TG9nSWQpIHtcbiAgICBhdHRyc1sgJ3BhcmVudExvZ0lkJyBdID0geyBEYXRhVHlwZTogJ1N0cmluZycsIFN0cmluZ1ZhbHVlOiBjb250ZXh0LnBhcmVudExvZ0lkIH07XG4gIH1cbiAgcmV0dXJuIGF0dHJzO1xufVxuXG4vKipcbiAqIENyZWF0ZSBTTlMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciB0cmFjZSBwcm9wYWdhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNuc01lc3NhZ2VBdHRyaWJ1dGVzKFxuICBjb250ZXh0OiBPYnNlcnZhdGlvbkNvbnRleHRcbik6IFJlY29yZDxzdHJpbmcsIHsgRGF0YVR5cGU6IHN0cmluZzsgU3RyaW5nVmFsdWU6IHN0cmluZyB9PiB7XG4gIHJldHVybiBjcmVhdGVTcXNNZXNzYWdlQXR0cmlidXRlcyhjb250ZXh0KTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgdHJhY2UgY29udGV4dCBmb3IgRXZlbnRCcmlkZ2UgZXZlbnQgZGV0YWlsLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRXZlbnRCcmlkZ2VUcmFjZUNvbnRleHQoXG4gIGNvbnRleHQ6IE9ic2VydmF0aW9uQ29udGV4dFxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4ge1xuICBjb25zdCB0cmFjZUNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IGJvb2xlYW4+ID0ge1xuICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICBzYW1wbGVkOiBjb250ZXh0LnNhbXBsZWQgPz8gdHJ1ZSxcbiAgfTtcbiAgaWYgKGNvbnRleHQucGFyZW50TG9nSWQpIHtcbiAgICB0cmFjZUNvbnRleHRbICdwYXJlbnRMb2dJZCcgXSA9IGNvbnRleHQucGFyZW50TG9nSWQ7XG4gIH1cbiAgcmV0dXJuIHRyYWNlQ29udGV4dDtcbn1cblxuLyoqXG4gKiBDcmVhdGUgdHJhY2UgY29udGV4dCBmb3IgU3RlcCBGdW5jdGlvbnMgb3V0cHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3RlcEZ1bmN0aW9uc1RyYWNlQ29udGV4dChcbiAgY29udGV4dDogT2JzZXJ2YXRpb25Db250ZXh0XG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiB7XG4gIHJldHVybiBjcmVhdGVFdmVudEJyaWRnZVRyYWNlQ29udGV4dChjb250ZXh0KTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTGVnYWN5IEFsaWFzZXMgKGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IGR1cmluZyBtaWdyYXRpb24pXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgVXNlIGBydW5XaXRoQ29udGV4dGAgaW5zdGVhZFxuICovXG5leHBvcnQgY29uc3Qgd2l0aE9ic2VydmF0aW9uQ29udGV4dCA9IHJ1bldpdGhDb250ZXh0O1xuXG4vKipcbiAqIEBkZXByZWNhdGVkIFVzZSBgcnVuV2l0aENvbnRleHRTeW5jYCBpbnN0ZWFkXG4gKi9cbmV4cG9ydCBjb25zdCB3aXRoT2JzZXJ2YXRpb25Db250ZXh0U3luYyA9IHJ1bldpdGhDb250ZXh0U3luYztcbiJdfQ==