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
exports.extractFromSqsRecord = extractFromSqsRecord;
exports.extractFromEventBridge = extractFromEventBridge;
exports.extractFromStepFunctions = extractFromStepFunctions;
exports.extractFromKinesis = extractFromKinesis;
exports.createHttpHeaders = createHttpHeaders;
exports.createSqsAttributes = createSqsAttributes;
exports.createSnsAttributes = createSnsAttributes;
exports.createEventBridgeContext = createEventBridgeContext;
exports.createStepFunctionsContext = createStepFunctionsContext;
const sns_sqs_envelope_1 = require("../sns-sqs-envelope");
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
            causedBy: normalized['x-caused-by']?.trim(),
        };
    }
    // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
    const traceparent = normalized['traceparent'];
    if (traceparent && /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
        const parts = traceparent.split('-');
        return {
            correlationId: parts[1],
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
                sampled: sampledMatch?.[1] === '1',
            };
        }
    }
    // Custom attributes
    const correlationAttr = messageAttributes['correlationId'];
    const correlationId = (correlationAttr?.stringValue || correlationAttr?.StringValue)?.trim();
    if (correlationId) {
        const sampledAttr = messageAttributes['sampled'];
        const causedByAttr = messageAttributes['causedBy'];
        return {
            correlationId,
            causedBy: (causedByAttr?.stringValue || causedByAttr?.StringValue)?.trim(),
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
        const sampledAttr = messageAttributes['sampled'];
        const causedByAttr = messageAttributes['causedBy'];
        return {
            correlationId: correlationAttr.Value.trim(),
            causedBy: causedByAttr?.Value?.trim(),
            sampled: sampledAttr?.Value === 'true',
        };
    }
    return undefined;
}
/**
 * Extract trace context from an SQS record.
 *
 * Supports both:
 * - Direct SQS sendMessage() with MessageAttributes (record.messageAttributes)
 * - SNS -> SQS subscription envelope where SNS MessageAttributes are present in record.body.MessageAttributes
 */
function extractFromSqsRecord(record) {
    // 1) Direct SQS messageAttributes
    const fromSqs = extractFromSqs(record?.messageAttributes);
    if (fromSqs?.correlationId)
        return fromSqs;
    // 2) SNS -> SQS envelope
    if (typeof record?.body !== 'string' || !record.body)
        return undefined;
    const envelope = (0, sns_sqs_envelope_1.parseSnsSqsEnvelope)(record.body);
    if (!envelope)
        return undefined;
    return extractFromSns(envelope.MessageAttributes);
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
        const causedBy = detail['causedBy'];
        const sampled = detail['sampled'];
        return {
            correlationId: correlationId.trim(),
            causedBy: typeof causedBy === 'string' ? causedBy.trim() : undefined,
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext object
    const traceContext = detail['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string') {
        return {
            correlationId: traceContext.correlationId.trim(),
            causedBy: typeof traceContext.causedBy === 'string' ? traceContext.causedBy.trim() : undefined,
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
        const sampled = input['sampled'];
        return {
            correlationId: correlationId.trim(),
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext
    const traceContext = input['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string') {
        return {
            correlationId: traceContext.correlationId.trim(),
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
            const causedBy = data['causedBy'];
            const sampled = data['sampled'];
            return {
                correlationId: correlationId.trim(),
                causedBy: typeof causedBy === 'string' ? causedBy.trim() : undefined,
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
// ============================================================================
// Trace Context Creation (Outgoing)
// ============================================================================
/**
 * Create HTTP headers for trace propagation in outgoing HTTP requests.
 *
 * Returns headers that include:
 * - `x-correlation-id`: Custom correlation ID for application-level tracing
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
    // IMPORTANT: We do NOT propagate parentObservabilityLogId across hops.
    // parentObservabilityLogId is STRICT hierarchy within a single persisted slice.
    // Set causedBy to CURRENT correlationId for the next hop
    // This ensures the chain is A -> B -> C, not Root -> A, Root -> B, Root -> C
    headers['x-caused-by'] = ctx.correlationId;
    // W3C traceparent
    const sampledFlag = ctx.observability.sampled ? '01' : '00';
    const traceId = toW3CTraceId(ctx.correlationId);
    // We cannot safely derive a remote OTEL parent span-id from FW24 parentObservabilityLogId.
    // Use a stable fallback parent-id derived from correlationId.
    const parentId = toW3CParentId(ctx.correlationId);
    headers['traceparent'] = `00-${traceId}-${parentId}-${sampledFlag}`;
    return headers;
}
/**
 * Create SQS message attributes for trace propagation.
 */
function createSqsAttributes(ctx) {
    // ALWAYS use current correlationId as causedBy for the next hop.
    // This creates a proper chain: A → B → C (each hop knows its immediate cause)
    const causedBy = ctx.correlationId;
    const attrs = {
        correlationId: { DataType: 'String', StringValue: ctx.correlationId },
        sampled: { DataType: 'String', StringValue: String(ctx.observability.sampled) },
        causedBy: { DataType: 'String', StringValue: causedBy },
    };
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
    // ALWAYS use current correlationId as causedBy for the next hop.
    // This creates a proper chain: A → B → C (each hop knows its immediate cause)
    const traceContext = {
        correlationId: ctx.correlationId,
        sampled: ctx.observability.sampled,
        causedBy: ctx.correlationId, // Sender's correlationId = receiver's causedBy
    };
    return traceContext;
}
/**
 * Create trace context for Step Functions output.
 */
function createStepFunctionsContext(ctx) {
    return createEventBridgeContext(ctx);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvcGFnYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3Byb3BhZ2F0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFzQkgsb0NBS0M7QUFLRCxzQ0FLQztBQVVELGdEQTZDQztBQUtELHdDQWtDQztBQUtELHdDQWlCQztBQVNELG9EQWFDO0FBS0Qsd0RBK0JDO0FBS0QsNERBa0NDO0FBS0QsZ0RBNEJDO0FBNkRELDhDQXFCQztBQUtELGtEQWFDO0FBS0Qsa0RBSUM7QUFLRCw0REFZQztBQUtELGdFQUlDO0FBL1pELDBEQUEwRDtBQUUxRCwrRUFBK0U7QUFDL0UsWUFBWTtBQUNaLCtFQUErRTtBQUUvRSxvREFBb0Q7QUFDcEQsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUM7QUFFL0IsNERBQTREO0FBQzVELE1BQU0sb0JBQW9CLEdBQUcsRUFBRSxDQUFDO0FBRWhDLCtFQUErRTtBQUMvRSxnQkFBZ0I7QUFDaEIsK0VBQStFO0FBRS9FOztHQUVHO0FBQ0gsU0FBZ0IsWUFBWSxDQUFDLEVBQVU7SUFDckMsTUFBTSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDMUQsT0FBTyxHQUFHLENBQUMsTUFBTSxJQUFJLG1CQUFtQjtRQUN0QyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsbUJBQW1CLENBQUM7UUFDdkMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDM0MsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLEVBQVU7SUFDdEMsTUFBTSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFD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O0FBRUQ7O0dBRUc7QUFDSCxTQUFnQiwwQkFBMEIsQ0FDeEMsR0FBeUI7SUFFekIsT0FBTyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUN2QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUcmFjZSBDb250ZXh0IFByb3BhZ2F0aW9uXG4gKiBcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIGluY29taW5nIHJlcXVlc3RzL21lc3NhZ2VzLlxuICogQ3JlYXRlIHByb3BhZ2F0aW9uIGRhdGEgZm9yIG91dGdvaW5nIHJlcXVlc3RzL21lc3NhZ2VzLlxuICovXG5cbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHREYXRhLCBQYXJzZWRUcmFjZUNvbnRleHQgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IHBhcnNlU25zU3FzRW52ZWxvcGUgfSBmcm9tICcuLi9zbnMtc3FzLWVudmVsb3BlJztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gQ29uc3RhbnRzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKiBXM0MgdHJhY2UtaWQgbGVuZ3RoICgzMiBoZXggY2hhcnMgPSAxNiBieXRlcykgKi9cbmNvbnN0IFczQ19UUkFDRV9JRF9MRU5HVEggPSAzMjtcblxuLyoqIFczQyBwYXJlbnQtaWQvc3Bhbi1pZCBsZW5ndGggKDE2IGhleCBjaGFycyA9IDggYnl0ZXMpICovXG5jb25zdCBXM0NfUEFSRU5UX0lEX0xFTkdUSCA9IDE2O1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBXM0MgVXRpbGl0aWVzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQ29udmVydCBVVUlEL3N0cmluZyB0byB2YWxpZCBXM0MgdHJhY2UtaWQgKDMyIGhleCBjaGFycykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1czQ1RyYWNlSWQoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhleCA9IGlkLnJlcGxhY2UoL1teYS1mQS1GMC05XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhleC5sZW5ndGggPj0gVzNDX1RSQUNFX0lEX0xFTkdUSFxuICAgID8gaGV4LnN1YnN0cmluZygwLCBXM0NfVFJBQ0VfSURfTEVOR1RIKVxuICAgIDogaGV4LnBhZEVuZChXM0NfVFJBQ0VfSURfTEVOR1RILCAnMCcpO1xufVxuXG4vKipcbiAqIENvbnZlcnQgVVVJRC9zdHJpbmcgdG8gdmFsaWQgVzNDIHBhcmVudC1pZCAoMTYgaGV4IGNoYXJzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvVzNDUGFyZW50SWQoaWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGhleCA9IGlkLnJlcGxhY2UoL1teYS1mQS1GMC05XS9nLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhleC5sZW5ndGggPj0gVzNDX1BBUkVOVF9JRF9MRU5HVEhcbiAgICA/IGhleC5zdWJzdHJpbmcoMCwgVzNDX1BBUkVOVF9JRF9MRU5HVEgpXG4gICAgOiBoZXgucGFkRW5kKFczQ19QQVJFTlRfSURfTEVOR1RILCAnMCcpO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IEV4dHJhY3Rpb24gKEluY29taW5nKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIEhUVFAgaGVhZGVycy5cbiAqIFByaW9yaXR5OiB4LWNvcnJlbGF0aW9uLWlkID4gdHJhY2VwYXJlbnQgKFczQykgPiB4LWFtem4tdHJhY2UtaWQgKFgtUmF5KVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21IZWFkZXJzKFxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIWhlYWRlcnMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gTm9ybWFsaXplIHRvIGxvd2VyY2FzZVxuICBjb25zdCBub3JtYWxpemVkOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+ID0ge307XG4gIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcbiAgICBub3JtYWxpemVkWyBrZXkudG9Mb3dlckNhc2UoKSBdID0gdmFsdWU7XG4gIH1cblxuICAvLyAxLiBDdXN0b20gY29ycmVsYXRpb24gSURcbiAgY29uc3QgY3VzdG9tSWQgPSBub3JtYWxpemVkWyAneC1jb3JyZWxhdGlvbi1pZCcgXT8udHJpbSgpO1xuICBpZiAoY3VzdG9tSWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY3VzdG9tSWQsXG4gICAgICBjYXVzZWRCeTogbm9ybWFsaXplZFsgJ3gtY2F1c2VkLWJ5JyBdPy50cmltKCksXG4gICAgfTtcbiAgfVxuXG4gIC8vIDIuIFczQyB0cmFjZXBhcmVudDogMDAte3RyYWNlLWlkfS17cGFyZW50LWlkfS17ZmxhZ3N9XG4gIGNvbnN0IHRyYWNlcGFyZW50ID0gbm9ybWFsaXplZFsgJ3RyYWNlcGFyZW50JyBdO1xuICBpZiAodHJhY2VwYXJlbnQgJiYgL15bMC05YS1mXXsyfS1bMC05YS1mXXszMn0tWzAtOWEtZl17MTZ9LVswLTlhLWZdezJ9JC8udGVzdCh0cmFjZXBhcmVudCkpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHRyYWNlcGFyZW50LnNwbGl0KCctJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHBhcnRzWyAxIF0sXG4gICAgICBzYW1wbGVkOiBwYXJ0c1sgMyBdID09PSAnMDEnLFxuICAgIH07XG4gIH1cblxuICAvLyAzLiBYLVJheTogUm9vdD0xLXtlcG9jaH0te3VuaXF1ZX07UGFyZW50PXtpZH07U2FtcGxlZD17MHwxfVxuICBjb25zdCB4cmF5ID0gbm9ybWFsaXplZFsgJ3gtYW16bi10cmFjZS1pZCcgXTtcbiAgaWYgKHhyYXkgJiYgL1Jvb3Q9MS1bMC05YS1mXXs4fS1bMC05YS1mXXsyNH0vLnRlc3QoeHJheSkpIHtcbiAgICBjb25zdCByb290TWF0Y2ggPSB4cmF5Lm1hdGNoKC9Sb290PShbXjtdKykvKTtcbiAgICBjb25zdCBwYXJlbnRNYXRjaCA9IHhyYXkubWF0Y2goL1BhcmVudD0oW147XSspLyk7XG4gICAgY29uc3Qgc2FtcGxlZE1hdGNoID0geHJheS5tYXRjaCgvU2FtcGxlZD0oWzAxXSkvKTtcbiAgICBpZiAocm9vdE1hdGNoKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiByb290TWF0Y2hbIDEgXS5yZXBsYWNlKC9eMS0vLCAnJykucmVwbGFjZSgvLS9nLCAnJyksXG4gICAgICAgIHNhbXBsZWQ6IHNhbXBsZWRNYXRjaD8uWyAxIF0gPT09ICcxJyxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21TcXMoXG4gIG1lc3NhZ2VBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgeyBzdHJpbmdWYWx1ZT86IHN0cmluZzsgU3RyaW5nVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gWC1SYXkgaGVhZGVyXG4gIGNvbnN0IHhyYXlBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdBV1NUcmFjZUhlYWRlcicgXTtcbiAgY29uc3QgeHJheSA9IHhyYXlBdHRyPy5zdHJpbmdWYWx1ZSB8fCB4cmF5QXR0cj8uU3RyaW5nVmFsdWU7XG4gIGlmICh4cmF5ICYmIC9Sb290PTEtWzAtOWEtZl17OH0tWzAtOWEtZl17MjR9Ly50ZXN0KHhyYXkpKSB7XG4gICAgY29uc3Qgcm9vdE1hdGNoID0geHJheS5tYXRjaCgvUm9vdD0oW147XSspLyk7XG4gICAgY29uc3QgcGFyZW50TWF0Y2ggPSB4cmF5Lm1hdGNoKC9QYXJlbnQ9KFteO10rKS8pO1xuICAgIGNvbnN0IHNhbXBsZWRNYXRjaCA9IHhyYXkubWF0Y2goL1NhbXBsZWQ9KFswMV0pLyk7XG4gICAgaWYgKHJvb3RNYXRjaCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogcm9vdE1hdGNoWyAxIF0ucmVwbGFjZSgvXjEtLywgJycpLnJlcGxhY2UoLy0vZywgJycpLFxuICAgICAgICBzYW1wbGVkOiBzYW1wbGVkTWF0Y2g/LlsgMSBdID09PSAnMScsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIEN1c3RvbSBhdHRyaWJ1dGVzXG4gIGNvbnN0IGNvcnJlbGF0aW9uQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnY29ycmVsYXRpb25JZCcgXTtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IChjb3JyZWxhdGlvbkF0dHI/LnN0cmluZ1ZhbHVlIHx8IGNvcnJlbGF0aW9uQXR0cj8uU3RyaW5nVmFsdWUpPy50cmltKCk7XG4gIGlmIChjb3JyZWxhdGlvbklkKSB7XG4gICAgY29uc3Qgc2FtcGxlZEF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ3NhbXBsZWQnIF07XG4gICAgY29uc3QgY2F1c2VkQnlBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjYXVzZWRCeScgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5OiAoY2F1c2VkQnlBdHRyPy5zdHJpbmdWYWx1ZSB8fCBjYXVzZWRCeUF0dHI/LlN0cmluZ1ZhbHVlKT8udHJpbSgpLFxuICAgICAgc2FtcGxlZDogKHNhbXBsZWRBdHRyPy5zdHJpbmdWYWx1ZSB8fCBzYW1wbGVkQXR0cj8uU3RyaW5nVmFsdWUpID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU05TIG1lc3NhZ2UgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU25zKFxuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgVHlwZT86IHN0cmluZzsgVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY29ycmVsYXRpb25BdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjb3JyZWxhdGlvbklkJyBdO1xuICBpZiAoY29ycmVsYXRpb25BdHRyPy5WYWx1ZT8udHJpbSgpKSB7XG4gICAgY29uc3Qgc2FtcGxlZEF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ3NhbXBsZWQnIF07XG4gICAgY29uc3QgY2F1c2VkQnlBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjYXVzZWRCeScgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25BdHRyLlZhbHVlLnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiBjYXVzZWRCeUF0dHI/LlZhbHVlPy50cmltKCksXG4gICAgICBzYW1wbGVkOiBzYW1wbGVkQXR0cj8uVmFsdWUgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBhbiBTUVMgcmVjb3JkLlxuICpcbiAqIFN1cHBvcnRzIGJvdGg6XG4gKiAtIERpcmVjdCBTUVMgc2VuZE1lc3NhZ2UoKSB3aXRoIE1lc3NhZ2VBdHRyaWJ1dGVzIChyZWNvcmQubWVzc2FnZUF0dHJpYnV0ZXMpXG4gKiAtIFNOUyAtPiBTUVMgc3Vic2NyaXB0aW9uIGVudmVsb3BlIHdoZXJlIFNOUyBNZXNzYWdlQXR0cmlidXRlcyBhcmUgcHJlc2VudCBpbiByZWNvcmQuYm9keS5NZXNzYWdlQXR0cmlidXRlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21TcXNSZWNvcmQocmVjb3JkOiB7XG4gIG1lc3NhZ2VBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgeyBzdHJpbmdWYWx1ZT86IHN0cmluZzsgU3RyaW5nVmFsdWU/OiBzdHJpbmcgfT47XG4gIGJvZHk/OiBzdHJpbmc7XG59KTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgLy8gMSkgRGlyZWN0IFNRUyBtZXNzYWdlQXR0cmlidXRlc1xuICBjb25zdCBmcm9tU3FzID0gZXh0cmFjdEZyb21TcXMocmVjb3JkPy5tZXNzYWdlQXR0cmlidXRlcyk7XG4gIGlmIChmcm9tU3FzPy5jb3JyZWxhdGlvbklkKSByZXR1cm4gZnJvbVNxcztcblxuICAvLyAyKSBTTlMgLT4gU1FTIGVudmVsb3BlXG4gIGlmICh0eXBlb2YgcmVjb3JkPy5ib2R5ICE9PSAnc3RyaW5nJyB8fCAhcmVjb3JkLmJvZHkpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGVudmVsb3BlID0gcGFyc2VTbnNTcXNFbnZlbG9wZShyZWNvcmQuYm9keSk7XG4gIGlmICghZW52ZWxvcGUpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiBleHRyYWN0RnJvbVNucyhlbnZlbG9wZS5NZXNzYWdlQXR0cmlidXRlcyk7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gRXZlbnRCcmlkZ2UgZXZlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbUV2ZW50QnJpZGdlKFxuICBldmVudDogeyBkZXRhaWw/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBjb25zdCBkZXRhaWwgPSBldmVudD8uZGV0YWlsO1xuICBpZiAoIWRldGFpbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBEaXJlY3QgZmllbGRzXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBkZXRhaWxbICdjb3JyZWxhdGlvbklkJyBdIHx8IGRldGFpbFsgJ3RyYWNlSWQnIF07XG4gIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICBjb25zdCBjYXVzZWRCeSA9IGRldGFpbFsgJ2NhdXNlZEJ5JyBdO1xuICAgIGNvbnN0IHNhbXBsZWQgPSBkZXRhaWxbICdzYW1wbGVkJyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbklkLnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiB0eXBlb2YgY2F1c2VkQnkgPT09ICdzdHJpbmcnID8gY2F1c2VkQnkudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5lc3RlZCB0cmFjZUNvbnRleHQgb2JqZWN0XG4gIGNvbnN0IHRyYWNlQ29udGV4dCA9IGRldGFpbFsgJ3RyYWNlQ29udGV4dCcgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKHRyYWNlQ29udGV4dCAmJiB0eXBlb2YgdHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICh0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCBhcyBzdHJpbmcpLnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiB0eXBlb2YgdHJhY2VDb250ZXh0LmNhdXNlZEJ5ID09PSAnc3RyaW5nJyA/ICh0cmFjZUNvbnRleHQuY2F1c2VkQnkgYXMgc3RyaW5nKS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBzYW1wbGVkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICdib29sZWFuJ1xuICAgICAgICA/IHRyYWNlQ29udGV4dC5zYW1wbGVkXG4gICAgICAgIDogdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTdGVwIEZ1bmN0aW9ucyBpbnB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU3RlcEZ1bmN0aW9ucyhcbiAgaW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIWlucHV0KSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIERpcmVjdCBmaWVsZHNcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGlucHV0WyAnY29ycmVsYXRpb25JZCcgXSB8fCBpbnB1dFsgJ3RyYWNlSWQnIF07XG4gIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICBjb25zdCBzYW1wbGVkID0gaW5wdXRbICdzYW1wbGVkJyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbklkLnRyaW0oKSxcbiAgICAgIHNhbXBsZWQ6IHR5cGVvZiBzYW1wbGVkID09PSAnYm9vbGVhbicgPyBzYW1wbGVkIDogc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICAvLyBOZXN0ZWQgdHJhY2VDb250ZXh0XG4gIGNvbnN0IHRyYWNlQ29udGV4dCA9IGlucHV0WyAndHJhY2VDb250ZXh0JyBdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICBpZiAodHJhY2VDb250ZXh0ICYmIHR5cGVvZiB0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkIGFzIHN0cmluZykudHJpbSgpLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAnYm9vbGVhbidcbiAgICAgICAgPyB0cmFjZUNvbnRleHQuc2FtcGxlZFxuICAgICAgICA6IHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFXUyBleGVjdXRpb24gY29udGV4dFxuICBjb25zdCBhd3NDb250ZXh0ID0gaW5wdXRbICdhd3MnIF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGlmIChhd3NDb250ZXh0Py5bICdleGVjdXRpb25Bcm4nIF0gJiYgdHlwZW9mIGF3c0NvbnRleHRbICdleGVjdXRpb25Bcm4nIF0gPT09ICdzdHJpbmcnKSB7XG4gICAgY29uc3QgYXJuUGFydHMgPSAoYXdzQ29udGV4dFsgJ2V4ZWN1dGlvbkFybicgXSBhcyBzdHJpbmcpLnNwbGl0KCc6Jyk7XG4gICAgcmV0dXJuIHsgY29ycmVsYXRpb25JZDogYXJuUGFydHNbIGFyblBhcnRzLmxlbmd0aCAtIDEgXSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBLaW5lc2lzIHJlY29yZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tS2luZXNpcyhcbiAgcmVjb3JkOiB7IGtpbmVzaXM/OiB7IGRhdGE/OiBzdHJpbmc7IHBhcnRpdGlvbktleT86IHN0cmluZyB9IH1cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghcmVjb3JkPy5raW5lc2lzPy5kYXRhKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgZGVjb2RlZCA9IEJ1ZmZlci5mcm9tKHJlY29yZC5raW5lc2lzLmRhdGEsICdiYXNlNjQnKS50b1N0cmluZygndXRmLTgnKTtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShkZWNvZGVkKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZGF0YVsgJ2NvcnJlbGF0aW9uSWQnIF0gfHwgZGF0YVsgJ3RyYWNlSWQnIF07XG4gICAgaWYgKHR5cGVvZiBjb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBjb3JyZWxhdGlvbklkLnRyaW0oKSkge1xuICAgICAgY29uc3QgY2F1c2VkQnkgPSBkYXRhWyAnY2F1c2VkQnknIF07XG4gICAgICBjb25zdCBzYW1wbGVkID0gZGF0YVsgJ3NhbXBsZWQnIF07XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbklkLnRyaW0oKSxcbiAgICAgICAgY2F1c2VkQnk6IHR5cGVvZiBjYXVzZWRCeSA9PT0gJ3N0cmluZycgPyBjYXVzZWRCeS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICAgIHNhbXBsZWQ6IHR5cGVvZiBzYW1wbGVkID09PSAnYm9vbGVhbicgPyBzYW1wbGVkIDogc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgICAgfTtcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIC8vIE5vdCBKU09OXG4gIH1cblxuICAvLyBGYWxsIGJhY2sgdG8gcGFydGl0aW9uIGtleVxuICBpZiAocmVjb3JkLmtpbmVzaXMucGFydGl0aW9uS2V5KSB7XG4gICAgcmV0dXJuIHsgY29ycmVsYXRpb25JZDogcmVjb3JkLmtpbmVzaXMucGFydGl0aW9uS2V5IH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IENyZWF0aW9uIChPdXRnb2luZylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDcmVhdGUgSFRUUCBoZWFkZXJzIGZvciB0cmFjZSBwcm9wYWdhdGlvbiBpbiBvdXRnb2luZyBIVFRQIHJlcXVlc3RzLlxuICogXG4gKiBSZXR1cm5zIGhlYWRlcnMgdGhhdCBpbmNsdWRlOlxuICogLSBgeC1jb3JyZWxhdGlvbi1pZGA6IEN1c3RvbSBjb3JyZWxhdGlvbiBJRCBmb3IgYXBwbGljYXRpb24tbGV2ZWwgdHJhY2luZ1xuICogLSBgdHJhY2VwYXJlbnRgOiBXM0MgVHJhY2UgQ29udGV4dCBzdGFuZGFyZCBoZWFkZXIgKDAwLXt0cmFjZS1pZH0te3BhcmVudC1pZH0te2ZsYWdzfSlcbiAqIFxuICogIyMgVXNhZ2Ugd2l0aCBmZXRjaC9heGlvc1xuICogXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCwgY3JlYXRlSHR0cEhlYWRlcnMgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0JztcbiAqIFxuICogLy8gT3B0aW9uIDE6IEdldCBjb250ZXh0IGF1dG9tYXRpY2FsbHkgKHJlY29tbWVuZGVkKVxuICogYXN5bmMgZnVuY3Rpb24gY2FsbEV4dGVybmFsU2VydmljZShkYXRhOiBhbnkpIHtcbiAqICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAqICAgY29uc3QgdHJhY2VIZWFkZXJzID0gY3R4ID8gY3JlYXRlSHR0cEhlYWRlcnMoY3R4KSA6IHt9O1xuICogICBcbiAqICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCgnaHR0cHM6Ly9hcGkuZXhhbXBsZS5jb20vZW5kcG9pbnQnLCB7XG4gKiAgICAgbWV0aG9kOiAnUE9TVCcsXG4gKiAgICAgaGVhZGVyczoge1xuICogICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAqICAgICAgIC4uLnRyYWNlSGVhZGVycywgIC8vIFNwcmVhZCB0cmFjZSBoZWFkZXJzXG4gKiAgICAgfSxcbiAqICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAqICAgfSk7XG4gKiAgIHJldHVybiByZXNwb25zZS5qc29uKCk7XG4gKiB9XG4gKiBcbiAqIC8vIE9wdGlvbiAyOiBXaXRoIGF4aW9zIGludGVyY2VwdG9yXG4gKiBpbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuICogXG4gKiBjb25zdCBhcGlDbGllbnQgPSBheGlvcy5jcmVhdGUoeyBiYXNlVVJMOiAnaHR0cHM6Ly9hcGkuZXhhbXBsZS5jb20nIH0pO1xuICogXG4gKiBhcGlDbGllbnQuaW50ZXJjZXB0b3JzLnJlcXVlc3QudXNlKChjb25maWcpID0+IHtcbiAqICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAqICAgaWYgKGN0eCkge1xuICogICAgIGNvbnN0IHRyYWNlSGVhZGVycyA9IGNyZWF0ZUh0dHBIZWFkZXJzKGN0eCk7XG4gKiAgICAgY29uZmlnLmhlYWRlcnMgPSB7IC4uLmNvbmZpZy5oZWFkZXJzLCAuLi50cmFjZUhlYWRlcnMgfTtcbiAqICAgfVxuICogICByZXR1cm4gY29uZmlnO1xuICogfSk7XG4gKiBgYGBcbiAqIFxuICogIyMgTm90ZSBvbiBXM0MgVHJhY2UgQ29udGV4dFxuICogVGhlIGB0cmFjZXBhcmVudGAgaGVhZGVyIGZvbGxvd3MgdGhlIFczQyBUcmFjZSBDb250ZXh0IHNwZWNpZmljYXRpb246XG4gKiAtIEZvcm1hdDogYHt2ZXJzaW9ufS17dHJhY2UtaWR9LXtwYXJlbnQtaWR9LXtmbGFnc31gXG4gKiAtIEV4YW1wbGU6IGAwMC0wYWY3NjUxOTE2Y2Q0M2RkODQ0OGViMjExYzgwMzE5Yy1iN2FkNmI3MTY5MjAzMzMxLTAxYFxuICogLSBgZmxhZ3NgOiBgMDFgID0gc2FtcGxlZCwgYDAwYCA9IG5vdCBzYW1wbGVkXG4gKiBcbiAqIFRoaXMgZW5hYmxlcyBpbnRlcm9wZXJhYmlsaXR5IHdpdGggT3BlblRlbGVtZXRyeSwgSmFlZ2VyLCBaaXBraW4sIGFuZCBvdGhlclxuICogZGlzdHJpYnV0ZWQgdHJhY2luZyBzeXN0ZW1zLlxuICogXG4gKiBAcGFyYW0gY3R4IC0gVGhlIGV4ZWN1dGlvbiBjb250ZXh0IHRvIHByb3BhZ2F0ZVxuICogQHJldHVybnMgSGVhZGVycyBvYmplY3QgdG8gc3ByZWFkIGludG8geW91ciBIVFRQIHJlcXVlc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUh0dHBIZWFkZXJzKGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGEpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAneC1jb3JyZWxhdGlvbi1pZCc6IGN0eC5jb3JyZWxhdGlvbklkLFxuICB9O1xuXG4gIC8vIElNUE9SVEFOVDogV2UgZG8gTk9UIHByb3BhZ2F0ZSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgYWNyb3NzIGhvcHMuXG4gIC8vIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBTVFJJQ1QgaGllcmFyY2h5IHdpdGhpbiBhIHNpbmdsZSBwZXJzaXN0ZWQgc2xpY2UuXG5cbiAgLy8gU2V0IGNhdXNlZEJ5IHRvIENVUlJFTlQgY29ycmVsYXRpb25JZCBmb3IgdGhlIG5leHQgaG9wXG4gIC8vIFRoaXMgZW5zdXJlcyB0aGUgY2hhaW4gaXMgQSAtPiBCIC0+IEMsIG5vdCBSb290IC0+IEEsIFJvb3QgLT4gQiwgUm9vdCAtPiBDXG4gIGhlYWRlcnNbICd4LWNhdXNlZC1ieScgXSA9IGN0eC5jb3JyZWxhdGlvbklkO1xuXG4gIC8vIFczQyB0cmFjZXBhcmVudFxuICBjb25zdCBzYW1wbGVkRmxhZyA9IGN0eC5vYnNlcnZhYmlsaXR5LnNhbXBsZWQgPyAnMDEnIDogJzAwJztcbiAgY29uc3QgdHJhY2VJZCA9IHRvVzNDVHJhY2VJZChjdHguY29ycmVsYXRpb25JZCk7XG4gIC8vIFdlIGNhbm5vdCBzYWZlbHkgZGVyaXZlIGEgcmVtb3RlIE9URUwgcGFyZW50IHNwYW4taWQgZnJvbSBGVzI0IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZC5cbiAgLy8gVXNlIGEgc3RhYmxlIGZhbGxiYWNrIHBhcmVudC1pZCBkZXJpdmVkIGZyb20gY29ycmVsYXRpb25JZC5cbiAgY29uc3QgcGFyZW50SWQgPSB0b1czQ1BhcmVudElkKGN0eC5jb3JyZWxhdGlvbklkKTtcbiAgaGVhZGVyc1sgJ3RyYWNlcGFyZW50JyBdID0gYDAwLSR7dHJhY2VJZH0tJHtwYXJlbnRJZH0tJHtzYW1wbGVkRmxhZ31gO1xuXG4gIHJldHVybiBoZWFkZXJzO1xufVxuXG4vKipcbiAqIENyZWF0ZSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciB0cmFjZSBwcm9wYWdhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNxc0F0dHJpYnV0ZXMoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHsgRGF0YVR5cGU6IHN0cmluZzsgU3RyaW5nVmFsdWU6IHN0cmluZyB9PiB7XG4gIC8vIEFMV0FZUyB1c2UgY3VycmVudCBjb3JyZWxhdGlvbklkIGFzIGNhdXNlZEJ5IGZvciB0aGUgbmV4dCBob3AuXG4gIC8vIFRoaXMgY3JlYXRlcyBhIHByb3BlciBjaGFpbjogQSDihpIgQiDihpIgQyAoZWFjaCBob3Aga25vd3MgaXRzIGltbWVkaWF0ZSBjYXVzZSlcbiAgY29uc3QgY2F1c2VkQnkgPSBjdHguY29ycmVsYXRpb25JZDtcblxuICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgeyBEYXRhVHlwZTogc3RyaW5nOyBTdHJpbmdWYWx1ZTogc3RyaW5nIH0+ID0ge1xuICAgIGNvcnJlbGF0aW9uSWQ6IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY3R4LmNvcnJlbGF0aW9uSWQgfSxcbiAgICBzYW1wbGVkOiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IFN0cmluZyhjdHgub2JzZXJ2YWJpbGl0eS5zYW1wbGVkKSB9LFxuICAgIGNhdXNlZEJ5OiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IGNhdXNlZEJ5IH0sXG4gIH07XG4gIHJldHVybiBhdHRycztcbn1cblxuLyoqXG4gKiBDcmVhdGUgU05TIG1lc3NhZ2UgYXR0cmlidXRlcyBmb3IgdHJhY2UgcHJvcGFnYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTbnNBdHRyaWJ1dGVzKFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4ge1xuICByZXR1cm4gY3JlYXRlU3FzQXR0cmlidXRlcyhjdHgpO1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBFdmVudEJyaWRnZSBldmVudCBkZXRhaWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IGJvb2xlYW4+IHtcbiAgLy8gQUxXQVlTIHVzZSBjdXJyZW50IGNvcnJlbGF0aW9uSWQgYXMgY2F1c2VkQnkgZm9yIHRoZSBuZXh0IGhvcC5cbiAgLy8gVGhpcyBjcmVhdGVzIGEgcHJvcGVyIGNoYWluOiBBIOKGkiBCIOKGkiBDIChlYWNoIGhvcCBrbm93cyBpdHMgaW1tZWRpYXRlIGNhdXNlKVxuXG4gIGNvbnN0IHRyYWNlQ29udGV4dDogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4gPSB7XG4gICAgY29ycmVsYXRpb25JZDogY3R4LmNvcnJlbGF0aW9uSWQsXG4gICAgc2FtcGxlZDogY3R4Lm9ic2VydmFiaWxpdHkuc2FtcGxlZCxcbiAgICBjYXVzZWRCeTogY3R4LmNvcnJlbGF0aW9uSWQsICAvLyBTZW5kZXIncyBjb3JyZWxhdGlvbklkID0gcmVjZWl2ZXIncyBjYXVzZWRCeVxuICB9O1xuICByZXR1cm4gdHJhY2VDb250ZXh0O1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBTdGVwIEZ1bmN0aW9ucyBvdXRwdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dChcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YVxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4ge1xuICByZXR1cm4gY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0KGN0eCk7XG59XG5cbiJdfQ==