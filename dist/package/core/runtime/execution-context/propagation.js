"use strict";
/**
 * Trace Context Propagation
 *
 * Extract trace context from incoming requests/messages.
 * Create propagation data for outgoing requests/messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toW3CTraceId = toW3CTraceId;
exports.toW3CParentId = toW3CParentId;
exports.extractFromHeaders = extractFromHeaders;
exports.extractFromSqs = extractFromSqs;
exports.extractFromSns = extractFromSns;
exports.extractFromEventBridge = extractFromEventBridge;
exports.extractFromStepFunctions = extractFromStepFunctions;
exports.extractFromKinesis = extractFromKinesis;
exports.extractFromDynamoDBStream = extractFromDynamoDBStream;
exports.createHttpHeaders = createHttpHeaders;
exports.createSqsAttributes = createSqsAttributes;
exports.createSnsAttributes = createSnsAttributes;
exports.createEventBridgeContext = createEventBridgeContext;
exports.createStepFunctionsContext = createStepFunctionsContext;
// ============================================================================
// Constants
// ============================================================================
/** W3C trace-id length (32 hex chars = 16 bytes) */
const W3C_TRACE_ID_LENGTH = 32;
/** W3C parent-id/span-id length (16 hex chars = 8 bytes) */
const W3C_PARENT_ID_LENGTH = 16;
// ============================================================================
// W3C Utilities
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
 * Priority: x-correlation-id > traceparent (W3C) > x-amzn-trace-id (X-Ray)
 */
function extractFromHeaders(headers) {
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
            parentObservabilityLogId: normalized['x-parent-log-id']?.trim(),
        };
    }
    // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
    const traceparent = normalized['traceparent'];
    if (traceparent && /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
        const parts = traceparent.split('-');
        return {
            correlationId: parts[1],
            parentObservabilityLogId: parts[2],
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
                parentObservabilityLogId: parentMatch?.[1],
                sampled: sampledMatch?.[1] === '1',
            };
        }
    }
    return undefined;
}
/**
 * Extract trace context from SQS message attributes.
 */
function extractFromSqs(messageAttributes) {
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
                parentObservabilityLogId: parentMatch?.[1],
                sampled: sampledMatch?.[1] === '1',
            };
        }
    }
    // Custom attributes
    const correlationAttr = messageAttributes['correlationId'];
    const correlationId = (correlationAttr?.stringValue || correlationAttr?.StringValue)?.trim();
    if (correlationId) {
        const parentAttr = messageAttributes['parentObservabilityLogId'];
        const sampledAttr = messageAttributes['sampled'];
        return {
            correlationId,
            parentObservabilityLogId: (parentAttr?.stringValue || parentAttr?.StringValue)?.trim(),
            sampled: (sampledAttr?.stringValue || sampledAttr?.StringValue) === 'true',
        };
    }
    return undefined;
}
/**
 * Extract trace context from SNS message attributes.
 */
function extractFromSns(messageAttributes) {
    if (!messageAttributes)
        return undefined;
    const correlationAttr = messageAttributes['correlationId'];
    if (correlationAttr?.Value?.trim()) {
        const parentAttr = messageAttributes['parentObservabilityLogId'];
        const sampledAttr = messageAttributes['sampled'];
        return {
            correlationId: correlationAttr.Value.trim(),
            parentObservabilityLogId: parentAttr?.Value?.trim(),
            sampled: sampledAttr?.Value === 'true',
        };
    }
    return undefined;
}
/**
 * Extract trace context from EventBridge event.
 */
function extractFromEventBridge(event) {
    const detail = event?.detail;
    if (!detail)
        return undefined;
    // Direct fields
    const correlationId = detail['correlationId'] || detail['traceId'];
    if (typeof correlationId === 'string' && correlationId.trim()) {
        const parentObservabilityLogId = detail['parentObservabilityLogId'];
        const sampled = detail['sampled'];
        return {
            correlationId: correlationId.trim(),
            parentObservabilityLogId: typeof parentObservabilityLogId === 'string' ? parentObservabilityLogId.trim() : undefined,
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext object
    const traceContext = detail['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string') {
        return {
            correlationId: traceContext.correlationId.trim(),
            parentObservabilityLogId: typeof traceContext.parentObservabilityLogId === 'string'
                ? traceContext.parentObservabilityLogId.trim()
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
function extractFromStepFunctions(input) {
    if (!input)
        return undefined;
    // Direct fields
    const correlationId = input['correlationId'] || input['traceId'];
    if (typeof correlationId === 'string' && correlationId.trim()) {
        const parentObservabilityLogId = input['parentObservabilityLogId'];
        const sampled = input['sampled'];
        return {
            correlationId: correlationId.trim(),
            parentObservabilityLogId: typeof parentObservabilityLogId === 'string' ? parentObservabilityLogId.trim() : undefined,
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext
    const traceContext = input['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string') {
        return {
            correlationId: traceContext.correlationId.trim(),
            parentObservabilityLogId: typeof traceContext.parentObservabilityLogId === 'string'
                ? traceContext.parentObservabilityLogId.trim()
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
function extractFromKinesis(record) {
    if (!record?.kinesis?.data)
        return undefined;
    try {
        const decoded = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
        const data = JSON.parse(decoded);
        const correlationId = data['correlationId'] || data['traceId'];
        if (typeof correlationId === 'string' && correlationId.trim()) {
            const parentObservabilityLogId = data['parentObservabilityLogId'];
            const sampled = data['sampled'];
            return {
                correlationId: correlationId.trim(),
                parentObservabilityLogId: typeof parentObservabilityLogId === 'string' ? parentObservabilityLogId.trim() : undefined,
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
function extractFromDynamoDBStream(record) {
    const newImage = record?.dynamodb?.NewImage;
    if (newImage) {
        const correlationId = newImage['correlationId']?.S || newImage['traceId']?.S;
        if (correlationId?.trim()) {
            const parentObservabilityLogId = newImage['parentObservabilityLogId']?.S;
            const sampled = newImage['sampled']?.BOOL ?? newImage['sampled']?.S === 'true';
            return {
                correlationId: correlationId.trim(),
                parentObservabilityLogId: parentObservabilityLogId?.trim(),
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
// Trace Context Creation (Outgoing)
// ============================================================================
/**
 * Create HTTP headers for trace propagation in outgoing HTTP requests.
 *
 * Returns headers that include:
 * - `x-correlation-id`: Custom correlation ID for application-level tracing
 * - `x-parent-log-id`: Parent span/log ID for hierarchy tracking
 * - `traceparent`: W3C Trace Context standard header (00-{trace-id}-{parent-id}-{flags})
 *
 * ## Usage with fetch/axios
 *
 * ```typescript
 * import { getCurrentExecutionContext, createHttpHeaders } from '@ten24group/fw24';
 *
 * // Option 1: Get context automatically (recommended)
 * async function callExternalService(data: any) {
 *   const ctx = getCurrentExecutionContext();
 *   const traceHeaders = ctx ? createHttpHeaders(ctx) : {};
 *
 *   const response = await fetch('https://api.example.com/endpoint', {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       ...traceHeaders,  // Spread trace headers
 *     },
 *     body: JSON.stringify(data),
 *   });
 *   return response.json();
 * }
 *
 * // Option 2: With axios interceptor
 * import axios from 'axios';
 *
 * const apiClient = axios.create({ baseURL: 'https://api.example.com' });
 *
 * apiClient.interceptors.request.use((config) => {
 *   const ctx = getCurrentExecutionContext();
 *   if (ctx) {
 *     const traceHeaders = createHttpHeaders(ctx);
 *     config.headers = { ...config.headers, ...traceHeaders };
 *   }
 *   return config;
 * });
 * ```
 *
 * ## Note on W3C Trace Context
 * The `traceparent` header follows the W3C Trace Context specification:
 * - Format: `{version}-{trace-id}-{parent-id}-{flags}`
 * - Example: `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`
 * - `flags`: `01` = sampled, `00` = not sampled
 *
 * This enables interoperability with OpenTelemetry, Jaeger, Zipkin, and other
 * distributed tracing systems.
 *
 * @param ctx - The execution context to propagate
 * @returns Headers object to spread into your HTTP request
 */
function createHttpHeaders(ctx) {
    const headers = {
        'x-correlation-id': ctx.correlationId,
    };
    if (ctx.parentObservabilityLogId) {
        headers['x-parent-log-id'] = ctx.parentObservabilityLogId;
    }
    // W3C traceparent
    const sampledFlag = ctx.sampled ? '01' : '00';
    const traceId = toW3CTraceId(ctx.correlationId);
    const parentId = ctx.parentObservabilityLogId
        ? toW3CParentId(ctx.parentObservabilityLogId)
        : toW3CParentId(ctx.correlationId);
    headers['traceparent'] = `00-${traceId}-${parentId}-${sampledFlag}`;
    return headers;
}
/**
 * Create SQS message attributes for trace propagation.
 */
function createSqsAttributes(ctx) {
    const attrs = {
        correlationId: { DataType: 'String', StringValue: ctx.correlationId },
        sampled: { DataType: 'String', StringValue: String(ctx.sampled) },
    };
    if (ctx.parentObservabilityLogId) {
        attrs['parentObservabilityLogId'] = { DataType: 'String', StringValue: ctx.parentObservabilityLogId };
    }
    return attrs;
}
/**
 * Create SNS message attributes for trace propagation.
 */
function createSnsAttributes(ctx) {
    return createSqsAttributes(ctx);
}
/**
 * Create trace context for EventBridge event detail.
 */
function createEventBridgeContext(ctx) {
    const traceContext = {
        correlationId: ctx.correlationId,
        sampled: ctx.sampled,
    };
    if (ctx.parentObservabilityLogId) {
        traceContext['parentObservabilityLogId'] = ctx.parentObservabilityLogId;
    }
    return traceContext;
}
/**
 * Create trace context for Step Functions output.
 */
function createStepFunctionsContext(ctx) {
    return createEventBridgeContext(ctx);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvcGFnYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3Byb3BhZ2F0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFxQkgsb0NBS0M7QUFLRCxzQ0FLQztBQVVELGdEQStDQztBQUtELHdDQW1DQztBQUtELHdDQWlCQztBQUtELHdEQWlDQztBQUtELDREQXVDQztBQUtELGdEQTRCQztBQUtELDhEQTRCQztBQThERCw4Q0FrQkM7QUFLRCxrREFXQztBQUtELGtEQUlDO0FBS0QsNERBV0M7QUFLRCxnRUFJQztBQTdhRCwrRUFBK0U7QUFDL0UsWUFBWTtBQUNaLCtFQUErRTtBQUUvRSxvREFBb0Q7QUFDcEQsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUM7QUFFL0IsNERBQTREO0FBQzVELE1BQU0sb0JBQW9CLEdBQUcsRUFBRSxDQUFDO0FBRWhDLCtFQUErRTtBQUMvRSxnQkFBZ0I7QUFDaEIsK0VBQStFO0FBRS9FOztHQUVHO0FBQ0gsU0FBZ0IsWUFBWSxDQUFDLEVBQVU7SUFDckMsTUFBTSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDMUQsT0FBTyxHQUFHLENBQUMsTUFBTSxJQUFJLG1CQUFtQjtRQUN0QyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsbUJBQW1CLENBQUM7UUFDdkMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDM0MsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLEVBQVU7SUFDdEMsTUFBTSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFDLENBQUMsV0FBVyxF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QUN2QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUcmFjZSBDb250ZXh0IFByb3BhZ2F0aW9uXG4gKiBcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIGluY29taW5nIHJlcXVlc3RzL21lc3NhZ2VzLlxuICogQ3JlYXRlIHByb3BhZ2F0aW9uIGRhdGEgZm9yIG91dGdvaW5nIHJlcXVlc3RzL21lc3NhZ2VzLlxuICovXG5cbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHREYXRhLCBQYXJzZWRUcmFjZUNvbnRleHQgfSBmcm9tICcuL3R5cGVzJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29uc3RhbnRzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBXM0MgdHJhY2UtaWQgbGVuZ3RoICgzMiBoZXggY2hhcnMgPSAxNiBieXRlcykgKi9cbmNvbnN0IFczQ19UUkFDRV9JRF9MRU5HVEggPSAzMjtcblxuLyoqIFczQyBwYXJlbnQtaWQvc3Bhbi1pZCBsZW5ndGggKDE2IGhleCBjaGFycyA9IDggYnl0ZXMpICovXG5jb25zdCBXM0NfUEFSRU5UX0lEX0xFTkdUSCA9IDE2O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBXM0MgVXRpbGl0aWVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udmVydCBVVUlEL3N0cmluZyB0byB2YWxpZCBXM0MgdHJhY2UtaWQgKDMyIGhleCBjaGFycykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1czQ1RyYWNlSWQoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhleCA9IGlkLnJlcGxhY2UoL1teYS1mQS1GMC05XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhleC5sZW5ndGggPj0gVzNDX1RSQUNFX0lEX0xFTkdUSFxuICAgID8gaGV4LnN1YnN0cmluZygwLCBXM0NfVFJBQ0VfSURfTEVOR1RIKVxuICAgIDogaGV4LnBhZEVuZChXM0NfVFJBQ0VfSURfTEVOR1RILCAnMCcpO1xufVxuXG4vKipcbiAqIENvbnZlcnQgVVVJRC9zdHJpbmcgdG8gdmFsaWQgVzNDIHBhcmVudC1pZCAoMTYgaGV4IGNoYXJzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvVzNDUGFyZW50SWQoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhleCA9IGlkLnJlcGxhY2UoL1teYS1mQS1GMC05XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhleC5sZW5ndGggPj0gVzNDX1BBUkVOVF9JRF9MRU5HVEhcbiAgICA/IGhleC5zdWJzdHJpbmcoMCwgVzNDX1BBUkVOVF9JRF9MRU5HVEgpXG4gICAgOiBoZXgucGFkRW5kKFczQ19QQVJFTlRfSURfTEVOR1RILCAnMCcpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IEV4dHJhY3Rpb24gKEluY29taW5nKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIEhUVFAgaGVhZGVycy5cbiAqIFByaW9yaXR5OiB4LWNvcnJlbGF0aW9uLWlkID4gdHJhY2VwYXJlbnQgKFczQykgPiB4LWFtem4tdHJhY2UtaWQgKFgtUmF5KVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21IZWFkZXJzKFxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIWhlYWRlcnMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gTm9ybWFsaXplIHRvIGxvd2VyY2FzZVxuICBjb25zdCBub3JtYWxpemVkOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+ID0ge307XG4gIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcbiAgICBub3JtYWxpemVkWyBrZXkudG9Mb3dlckNhc2UoKSBdID0gdmFsdWU7XG4gIH1cblxuICAvLyAxLiBDdXN0b20gY29ycmVsYXRpb24gSURcbiAgY29uc3QgY3VzdG9tSWQgPSBub3JtYWxpemVkWyAneC1jb3JyZWxhdGlvbi1pZCcgXT8udHJpbSgpO1xuICBpZiAoY3VzdG9tSWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY3VzdG9tSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IG5vcm1hbGl6ZWRbICd4LXBhcmVudC1sb2ctaWQnIF0/LnRyaW0oKSxcbiAgICB9O1xuICB9XG5cbiAgLy8gMi4gVzNDIHRyYWNlcGFyZW50OiAwMC17dHJhY2UtaWR9LXtwYXJlbnQtaWR9LXtmbGFnc31cbiAgY29uc3QgdHJhY2VwYXJlbnQgPSBub3JtYWxpemVkWyAndHJhY2VwYXJlbnQnIF07XG4gIGlmICh0cmFjZXBhcmVudCAmJiAvXlswLTlhLWZdezJ9LVswLTlhLWZdezMyfS1bMC05YS1mXXsxNn0tWzAtOWEtZl17Mn0kLy50ZXN0KHRyYWNlcGFyZW50KSkge1xuICAgIGNvbnN0IHBhcnRzID0gdHJhY2VwYXJlbnQuc3BsaXQoJy0nKTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogcGFydHNbIDEgXSxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogcGFydHNbIDIgXSxcbiAgICAgIHNhbXBsZWQ6IHBhcnRzWyAzIF0gPT09ICcwMScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIDMuIFgtUmF5OiBSb290PTEte2Vwb2NofS17dW5pcXVlfTtQYXJlbnQ9e2lkfTtTYW1wbGVkPXswfDF9XG4gIGNvbnN0IHhyYXkgPSBub3JtYWxpemVkWyAneC1hbXpuLXRyYWNlLWlkJyBdO1xuICBpZiAoeHJheSAmJiAvUm9vdD0xLVswLTlhLWZdezh9LVswLTlhLWZdezI0fS8udGVzdCh4cmF5KSkge1xuICAgIGNvbnN0IHJvb3RNYXRjaCA9IHhyYXkubWF0Y2goL1Jvb3Q9KFteO10rKS8pO1xuICAgIGNvbnN0IHBhcmVudE1hdGNoID0geHJheS5tYXRjaCgvUGFyZW50PShbXjtdKykvKTtcbiAgICBjb25zdCBzYW1wbGVkTWF0Y2ggPSB4cmF5Lm1hdGNoKC9TYW1wbGVkPShbMDFdKS8pO1xuICAgIGlmIChyb290TWF0Y2gpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IHJvb3RNYXRjaFsgMSBdLnJlcGxhY2UoL14xLS8sICcnKS5yZXBsYWNlKC8tL2csICcnKSxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBwYXJlbnRNYXRjaD8uWyAxIF0sXG4gICAgICAgIHNhbXBsZWQ6IHNhbXBsZWRNYXRjaD8uWyAxIF0gPT09ICcxJyxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21TcXMoXG4gIG1lc3NhZ2VBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgeyBzdHJpbmdWYWx1ZT86IHN0cmluZzsgU3RyaW5nVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gWC1SYXkgaGVhZGVyXG4gIGNvbnN0IHhyYXlBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdBV1NUcmFjZUhlYWRlcicgXTtcbiAgY29uc3QgeHJheSA9IHhyYXlBdHRyPy5zdHJpbmdWYWx1ZSB8fCB4cmF5QXR0cj8uU3RyaW5nVmFsdWU7XG4gIGlmICh4cmF5ICYmIC9Sb290PTEtWzAtOWEtZl17OH0tWzAtOWEtZl17MjR9Ly50ZXN0KHhyYXkpKSB7XG4gICAgY29uc3Qgcm9vdE1hdGNoID0geHJheS5tYXRjaCgvUm9vdD0oW147XSspLyk7XG4gICAgY29uc3QgcGFyZW50TWF0Y2ggPSB4cmF5Lm1hdGNoKC9QYXJlbnQ9KFteO10rKS8pO1xuICAgIGNvbnN0IHNhbXBsZWRNYXRjaCA9IHhyYXkubWF0Y2goL1NhbXBsZWQ9KFswMV0pLyk7XG4gICAgaWYgKHJvb3RNYXRjaCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogcm9vdE1hdGNoWyAxIF0ucmVwbGFjZSgvXjEtLywgJycpLnJlcGxhY2UoLy0vZywgJycpLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHBhcmVudE1hdGNoPy5bIDEgXSxcbiAgICAgICAgc2FtcGxlZDogc2FtcGxlZE1hdGNoPy5bIDEgXSA9PT0gJzEnLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyBDdXN0b20gYXR0cmlidXRlc1xuICBjb25zdCBjb3JyZWxhdGlvbkF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ2NvcnJlbGF0aW9uSWQnIF07XG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSAoY29ycmVsYXRpb25BdHRyPy5zdHJpbmdWYWx1ZSB8fCBjb3JyZWxhdGlvbkF0dHI/LlN0cmluZ1ZhbHVlKT8udHJpbSgpO1xuICBpZiAoY29ycmVsYXRpb25JZCkge1xuICAgIGNvbnN0IHBhcmVudEF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgXTtcbiAgICBjb25zdCBzYW1wbGVkQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnc2FtcGxlZCcgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogKHBhcmVudEF0dHI/LnN0cmluZ1ZhbHVlIHx8IHBhcmVudEF0dHI/LlN0cmluZ1ZhbHVlKT8udHJpbSgpLFxuICAgICAgc2FtcGxlZDogKHNhbXBsZWRBdHRyPy5zdHJpbmdWYWx1ZSB8fCBzYW1wbGVkQXR0cj8uU3RyaW5nVmFsdWUpID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU05TIG1lc3NhZ2UgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU25zKFxuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgVHlwZT86IHN0cmluZzsgVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY29ycmVsYXRpb25BdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjb3JyZWxhdGlvbklkJyBdO1xuICBpZiAoY29ycmVsYXRpb25BdHRyPy5WYWx1ZT8udHJpbSgpKSB7XG4gICAgY29uc3QgcGFyZW50QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdO1xuICAgIGNvbnN0IHNhbXBsZWRBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdzYW1wbGVkJyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbkF0dHIuVmFsdWUudHJpbSgpLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBwYXJlbnRBdHRyPy5WYWx1ZT8udHJpbSgpLFxuICAgICAgc2FtcGxlZDogc2FtcGxlZEF0dHI/LlZhbHVlID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gRXZlbnRCcmlkZ2UgZXZlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbUV2ZW50QnJpZGdlKFxuICBldmVudDogeyBkZXRhaWw/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBjb25zdCBkZXRhaWwgPSBldmVudD8uZGV0YWlsO1xuICBpZiAoIWRldGFpbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBEaXJlY3QgZmllbGRzXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBkZXRhaWxbICdjb3JyZWxhdGlvbklkJyBdIHx8IGRldGFpbFsgJ3RyYWNlSWQnIF07XG4gIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICBjb25zdCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBkZXRhaWxbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF07XG4gICAgY29uc3Qgc2FtcGxlZCA9IGRldGFpbFsgJ3NhbXBsZWQnIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQudHJpbSgpLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0eXBlb2YgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc3RyaW5nJyA/IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZC50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gTmVzdGVkIHRyYWNlQ29udGV4dCBvYmplY3RcbiAgY29uc3QgdHJhY2VDb250ZXh0ID0gZGV0YWlsWyAndHJhY2VDb250ZXh0JyBdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICBpZiAodHJhY2VDb250ZXh0ICYmIHR5cGVvZiB0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkIGFzIHN0cmluZykudHJpbSgpLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyAodHJhY2VDb250ZXh0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBhcyBzdHJpbmcpLnRyaW0oKVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIHNhbXBsZWQ6IHR5cGVvZiB0cmFjZUNvbnRleHQuc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nXG4gICAgICAgID8gdHJhY2VDb250ZXh0LnNhbXBsZWRcbiAgICAgICAgOiB0cmFjZUNvbnRleHQuc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIFN0ZXAgRnVuY3Rpb25zIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21TdGVwRnVuY3Rpb25zKFxuICBpbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghaW5wdXQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gRGlyZWN0IGZpZWxkc1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW5wdXRbICdjb3JyZWxhdGlvbklkJyBdIHx8IGlucHV0WyAndHJhY2VJZCcgXTtcbiAgaWYgKHR5cGVvZiBjb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBjb3JyZWxhdGlvbklkLnRyaW0oKSkge1xuICAgIGNvbnN0IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IGlucHV0WyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdO1xuICAgIGNvbnN0IHNhbXBsZWQgPSBpbnB1dFsgJ3NhbXBsZWQnIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQudHJpbSgpLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0eXBlb2YgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc3RyaW5nJyA/IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZC50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gTmVzdGVkIHRyYWNlQ29udGV4dFxuICBjb25zdCB0cmFjZUNvbnRleHQgPSBpbnB1dFsgJ3RyYWNlQ29udGV4dCcgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKHRyYWNlQ29udGV4dCAmJiB0eXBlb2YgdHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICh0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCBhcyBzdHJpbmcpLnRyaW0oKSxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdHlwZW9mIHRyYWNlQ29udGV4dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gKHRyYWNlQ29udGV4dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgYXMgc3RyaW5nKS50cmltKClcbiAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICBzYW1wbGVkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICdib29sZWFuJ1xuICAgICAgICA/IHRyYWNlQ29udGV4dC5zYW1wbGVkXG4gICAgICAgIDogdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gQVdTIGV4ZWN1dGlvbiBjb250ZXh0XG4gIGNvbnN0IGF3c0NvbnRleHQgPSBpbnB1dFsgJ2F3cycgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKGF3c0NvbnRleHQ/LlsgJ2V4ZWN1dGlvbkFybicgXSAmJiB0eXBlb2YgYXdzQ29udGV4dFsgJ2V4ZWN1dGlvbkFybicgXSA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBhcm5QYXJ0cyA9IChhd3NDb250ZXh0WyAnZXhlY3V0aW9uQXJuJyBdIGFzIHN0cmluZykuc3BsaXQoJzonKTtcbiAgICByZXR1cm4geyBjb3JyZWxhdGlvbklkOiBhcm5QYXJ0c1sgYXJuUGFydHMubGVuZ3RoIC0gMSBdIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIEtpbmVzaXMgcmVjb3JkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21LaW5lc2lzKFxuICByZWNvcmQ6IHsga2luZXNpcz86IHsgZGF0YT86IHN0cmluZzsgcGFydGl0aW9uS2V5Pzogc3RyaW5nIH0gfVxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFyZWNvcmQ/LmtpbmVzaXM/LmRhdGEpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBkZWNvZGVkID0gQnVmZmVyLmZyb20ocmVjb3JkLmtpbmVzaXMuZGF0YSwgJ2Jhc2U2NCcpLnRvU3RyaW5nKCd1dGYtOCcpO1xuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGRlY29kZWQpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBkYXRhWyAnY29ycmVsYXRpb25JZCcgXSB8fCBkYXRhWyAndHJhY2VJZCcgXTtcbiAgICBpZiAodHlwZW9mIGNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIGNvcnJlbGF0aW9uSWQudHJpbSgpKSB7XG4gICAgICBjb25zdCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBkYXRhWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdO1xuICAgICAgY29uc3Qgc2FtcGxlZCA9IGRhdGFbICdzYW1wbGVkJyBdO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdHlwZW9mIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3N0cmluZycgPyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICAgIH07XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBOb3QgSlNPTlxuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIHBhcnRpdGlvbiBrZXlcbiAgaWYgKHJlY29yZC5raW5lc2lzLnBhcnRpdGlvbktleSkge1xuICAgIHJldHVybiB7IGNvcnJlbGF0aW9uSWQ6IHJlY29yZC5raW5lc2lzLnBhcnRpdGlvbktleSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBEeW5hbW9EQiBTdHJlYW1zIHJlY29yZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tRHluYW1vREJTdHJlYW0oXG4gIHJlY29yZDoge1xuICAgIGR5bmFtb2RiPzoge1xuICAgICAgTmV3SW1hZ2U/OiBSZWNvcmQ8c3RyaW5nLCB7IFM/OiBzdHJpbmc7IEJPT0w/OiBib29sZWFuIH0+O1xuICAgIH07XG4gICAgZXZlbnRJRD86IHN0cmluZztcbiAgfVxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbmV3SW1hZ2UgPSByZWNvcmQ/LmR5bmFtb2RiPy5OZXdJbWFnZTtcbiAgaWYgKG5ld0ltYWdlKSB7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IG5ld0ltYWdlWyAnY29ycmVsYXRpb25JZCcgXT8uUyB8fCBuZXdJbWFnZVsgJ3RyYWNlSWQnIF0/LlM7XG4gICAgaWYgKGNvcnJlbGF0aW9uSWQ/LnRyaW0oKSkge1xuICAgICAgY29uc3QgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gbmV3SW1hZ2VbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0/LlM7XG4gICAgICBjb25zdCBzYW1wbGVkID0gbmV3SW1hZ2VbICdzYW1wbGVkJyBdPy5CT09MID8/IG5ld0ltYWdlWyAnc2FtcGxlZCcgXT8uUyA9PT0gJ3RydWUnO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkPy50cmltKCksXG4gICAgICAgIHNhbXBsZWQ6IHR5cGVvZiBzYW1wbGVkID09PSAnYm9vbGVhbicgPyBzYW1wbGVkIDogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyBGYWxsIGJhY2sgdG8gZXZlbnQgSURcbiAgaWYgKHJlY29yZD8uZXZlbnRJRCkge1xuICAgIHJldHVybiB7IGNvcnJlbGF0aW9uSWQ6IHJlY29yZC5ldmVudElEIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IENyZWF0aW9uIChPdXRnb2luZylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDcmVhdGUgSFRUUCBoZWFkZXJzIGZvciB0cmFjZSBwcm9wYWdhdGlvbiBpbiBvdXRnb2luZyBIVFRQIHJlcXVlc3RzLlxuICogXG4gKiBSZXR1cm5zIGhlYWRlcnMgdGhhdCBpbmNsdWRlOlxuICogLSBgeC1jb3JyZWxhdGlvbi1pZGA6IEN1c3RvbSBjb3JyZWxhdGlvbiBJRCBmb3IgYXBwbGljYXRpb24tbGV2ZWwgdHJhY2luZ1xuICogLSBgeC1wYXJlbnQtbG9nLWlkYDogUGFyZW50IHNwYW4vbG9nIElEIGZvciBoaWVyYXJjaHkgdHJhY2tpbmdcbiAqIC0gYHRyYWNlcGFyZW50YDogVzNDIFRyYWNlIENvbnRleHQgc3RhbmRhcmQgaGVhZGVyICgwMC17dHJhY2UtaWR9LXtwYXJlbnQtaWR9LXtmbGFnc30pXG4gKiBcbiAqICMjIFVzYWdlIHdpdGggZmV0Y2gvYXhpb3NcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsIGNyZWF0ZUh0dHBIZWFkZXJzIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNCc7XG4gKiBcbiAqIC8vIE9wdGlvbiAxOiBHZXQgY29udGV4dCBhdXRvbWF0aWNhbGx5IChyZWNvbW1lbmRlZClcbiAqIGFzeW5jIGZ1bmN0aW9uIGNhbGxFeHRlcm5hbFNlcnZpY2UoZGF0YTogYW55KSB7XG4gKiAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gKiAgIGNvbnN0IHRyYWNlSGVhZGVycyA9IGN0eCA/IGNyZWF0ZUh0dHBIZWFkZXJzKGN0eCkgOiB7fTtcbiAqICAgXG4gKiAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tL2VuZHBvaW50Jywge1xuICogICAgIG1ldGhvZDogJ1BPU1QnLFxuICogICAgIGhlYWRlcnM6IHtcbiAqICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gKiAgICAgICAuLi50cmFjZUhlYWRlcnMsICAvLyBTcHJlYWQgdHJhY2UgaGVhZGVyc1xuICogICAgIH0sXG4gKiAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gKiAgIH0pO1xuICogICByZXR1cm4gcmVzcG9uc2UuanNvbigpO1xuICogfVxuICogXG4gKiAvLyBPcHRpb24gMjogV2l0aCBheGlvcyBpbnRlcmNlcHRvclxuICogaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcbiAqIFxuICogY29uc3QgYXBpQ2xpZW50ID0gYXhpb3MuY3JlYXRlKHsgYmFzZVVSTDogJ2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tJyB9KTtcbiAqIFxuICogYXBpQ2xpZW50LmludGVyY2VwdG9ycy5yZXF1ZXN0LnVzZSgoY29uZmlnKSA9PiB7XG4gKiAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gKiAgIGlmIChjdHgpIHtcbiAqICAgICBjb25zdCB0cmFjZUhlYWRlcnMgPSBjcmVhdGVIdHRwSGVhZGVycyhjdHgpO1xuICogICAgIGNvbmZpZy5oZWFkZXJzID0geyAuLi5jb25maWcuaGVhZGVycywgLi4udHJhY2VIZWFkZXJzIH07XG4gKiAgIH1cbiAqICAgcmV0dXJuIGNvbmZpZztcbiAqIH0pO1xuICogYGBgXG4gKiBcbiAqICMjIE5vdGUgb24gVzNDIFRyYWNlIENvbnRleHRcbiAqIFRoZSBgdHJhY2VwYXJlbnRgIGhlYWRlciBmb2xsb3dzIHRoZSBXM0MgVHJhY2UgQ29udGV4dCBzcGVjaWZpY2F0aW9uOlxuICogLSBGb3JtYXQ6IGB7dmVyc2lvbn0te3RyYWNlLWlkfS17cGFyZW50LWlkfS17ZmxhZ3N9YFxuICogLSBFeGFtcGxlOiBgMDAtMGFmNzY1MTkxNmNkNDNkZDg0NDhlYjIxMWM4MDMxOWMtYjdhZDZiNzE2OTIwMzMzMS0wMWBcbiAqIC0gYGZsYWdzYDogYDAxYCA9IHNhbXBsZWQsIGAwMGAgPSBub3Qgc2FtcGxlZFxuICogXG4gKiBUaGlzIGVuYWJsZXMgaW50ZXJvcGVyYWJpbGl0eSB3aXRoIE9wZW5UZWxlbWV0cnksIEphZWdlciwgWmlwa2luLCBhbmQgb3RoZXJcbiAqIGRpc3RyaWJ1dGVkIHRyYWNpbmcgc3lzdGVtcy5cbiAqIFxuICogQHBhcmFtIGN0eCAtIFRoZSBleGVjdXRpb24gY29udGV4dCB0byBwcm9wYWdhdGVcbiAqIEByZXR1cm5zIEhlYWRlcnMgb2JqZWN0IHRvIHNwcmVhZCBpbnRvIHlvdXIgSFRUUCByZXF1ZXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIdHRwSGVhZGVycyhjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJ3gtY29ycmVsYXRpb24taWQnOiBjdHguY29ycmVsYXRpb25JZCxcbiAgfTtcblxuICBpZiAoY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgIGhlYWRlcnNbICd4LXBhcmVudC1sb2ctaWQnIF0gPSBjdHgucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICB9XG5cbiAgLy8gVzNDIHRyYWNlcGFyZW50XG4gIGNvbnN0IHNhbXBsZWRGbGFnID0gY3R4LnNhbXBsZWQgPyAnMDEnIDogJzAwJztcbiAgY29uc3QgdHJhY2VJZCA9IHRvVzNDVHJhY2VJZChjdHguY29ycmVsYXRpb25JZCk7XG4gIGNvbnN0IHBhcmVudElkID0gY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAgID8gdG9XM0NQYXJlbnRJZChjdHgucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKVxuICAgIDogdG9XM0NQYXJlbnRJZChjdHguY29ycmVsYXRpb25JZCk7XG4gIGhlYWRlcnNbICd0cmFjZXBhcmVudCcgXSA9IGAwMC0ke3RyYWNlSWR9LSR7cGFyZW50SWR9LSR7c2FtcGxlZEZsYWd9YDtcblxuICByZXR1cm4gaGVhZGVycztcbn1cblxuLyoqXG4gKiBDcmVhdGUgU1FTIG1lc3NhZ2UgYXR0cmlidXRlcyBmb3IgdHJhY2UgcHJvcGFnYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTcXNBdHRyaWJ1dGVzKFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4ge1xuICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgeyBEYXRhVHlwZTogc3RyaW5nOyBTdHJpbmdWYWx1ZTogc3RyaW5nIH0+ID0ge1xuICAgIGNvcnJlbGF0aW9uSWQ6IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY3R4LmNvcnJlbGF0aW9uSWQgfSxcbiAgICBzYW1wbGVkOiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IFN0cmluZyhjdHguc2FtcGxlZCkgfSxcbiAgfTtcbiAgaWYgKGN0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICBhdHRyc1sgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgXSA9IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB9O1xuICB9XG4gIHJldHVybiBhdHRycztcbn1cblxuLyoqXG4gKiBDcmVhdGUgU05TIG1lc3NhZ2UgYXR0cmlidXRlcyBmb3IgdHJhY2UgcHJvcGFnYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTbnNBdHRyaWJ1dGVzKFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4ge1xuICByZXR1cm4gY3JlYXRlU3FzQXR0cmlidXRlcyhjdHgpO1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBFdmVudEJyaWRnZSBldmVudCBkZXRhaWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IGJvb2xlYW4+IHtcbiAgY29uc3QgdHJhY2VDb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiA9IHtcbiAgICBjb3JyZWxhdGlvbklkOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICBzYW1wbGVkOiBjdHguc2FtcGxlZCxcbiAgfTtcbiAgaWYgKGN0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICB0cmFjZUNvbnRleHRbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF0gPSBjdHgucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICB9XG4gIHJldHVybiB0cmFjZUNvbnRleHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIHRyYWNlIGNvbnRleHQgZm9yIFN0ZXAgRnVuY3Rpb25zIG91dHB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVN0ZXBGdW5jdGlvbnNDb250ZXh0KFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiB7XG4gIHJldHVybiBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQoY3R4KTtcbn1cblxuIl19