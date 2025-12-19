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
            causedBy: normalized['x-caused-by']?.trim(),
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
        const causedByAttr = messageAttributes['causedBy'];
        return {
            correlationId,
            parentObservabilityLogId: (parentAttr?.stringValue || parentAttr?.StringValue)?.trim(),
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
        const parentAttr = messageAttributes['parentObservabilityLogId'];
        const sampledAttr = messageAttributes['sampled'];
        const causedByAttr = messageAttributes['causedBy'];
        return {
            correlationId: correlationAttr.Value.trim(),
            parentObservabilityLogId: parentAttr?.Value?.trim(),
            causedBy: causedByAttr?.Value?.trim(),
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
        const causedBy = detail['causedBy'];
        const sampled = detail['sampled'];
        return {
            correlationId: correlationId.trim(),
            parentObservabilityLogId: typeof parentObservabilityLogId === 'string' ? parentObservabilityLogId.trim() : undefined,
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
            const causedBy = data['causedBy'];
            const sampled = data['sampled'];
            return {
                correlationId: correlationId.trim(),
                parentObservabilityLogId: typeof parentObservabilityLogId === 'string' ? parentObservabilityLogId.trim() : undefined,
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
    // Set causedBy to CURRENT correlationId for the next hop
    // This ensures the chain is A -> B -> C, not Root -> A, Root -> B, Root -> C
    headers['x-caused-by'] = ctx.correlationId;
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
        // Set causedBy to CURRENT correlationId for the next hop
        causedBy: { DataType: 'String', StringValue: ctx.correlationId },
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
        // Set causedBy to CURRENT correlationId for the next hop
        causedBy: ctx.correlationId,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvcGFnYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3Byb3BhZ2F0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFxQkgsb0NBS0M7QUFLRCxzQ0FLQztBQVVELGdEQWdEQztBQUtELHdDQXFDQztBQUtELHdDQW1CQztBQUtELHdEQW9DQztBQUtELDREQXVDQztBQUtELGdEQThCQztBQThERCw4Q0FzQkM7QUFLRCxrREFhQztBQUtELGtEQUlDO0FBS0QsNERBYUM7QUFLRCxnRUFJQztBQTlaRCwrRUFBK0U7QUFDL0UsWUFBWTtBQUNaLCtFQUErRTtBQUUvRSxvREFBb0Q7QUFDcEQsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUM7QUFFL0IsNERBQTREO0FBQzVELE1BQU0sb0JBQW9CLEdBQUcsRUFBRSxDQUFDO0FBRWhDLCtFQUErRTtBQUMvRSxnQkFBZ0I7QUFDaEIsK0VBQStFO0FBRS9FOztHQUVHO0FBQ0gsU0FBZ0IsWUFBWSxDQUFDLEVBQVU7SUFDckMsTUFBTSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDMUQsT0FBTyxHQUFHLENBQUMsTUFBTSxJQUFJLG1CQUFtQjtRQUN0QyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsbUJBQW1CLENBQUM7UUFDdkMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDM0MsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLEVBQVU7SUFDdEMsTUFBTSxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFD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QU8sWUFBWSxDQUFDO0FBQ3RCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLDBCQUEwQixDQUN4QyxHQUF5QjtJQUV6QixPQUFPLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFRyYWNlIENvbnRleHQgUHJvcGFnYXRpb25cbiAqIFxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gaW5jb21pbmcgcmVxdWVzdHMvbWVzc2FnZXMuXG4gKiBDcmVhdGUgcHJvcGFnYXRpb24gZGF0YSBmb3Igb3V0Z29pbmcgcmVxdWVzdHMvbWVzc2FnZXMuXG4gKi9cblxuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dERhdGEsIFBhcnNlZFRyYWNlQ29udGV4dCB9IGZyb20gJy4vdHlwZXMnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb25zdGFudHNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIFczQyB0cmFjZS1pZCBsZW5ndGggKDMyIGhleCBjaGFycyA9IDE2IGJ5dGVzKSAqL1xuY29uc3QgVzNDX1RSQUNFX0lEX0xFTkdUSCA9IDMyO1xuXG4vKiogVzNDIHBhcmVudC1pZC9zcGFuLWlkIGxlbmd0aCAoMTYgaGV4IGNoYXJzID0gOCBieXRlcykgKi9cbmNvbnN0IFczQ19QQVJFTlRfSURfTEVOR1RIID0gMTY7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFczQyBVdGlsaXRpZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDb252ZXJ0IFVVSUQvc3RyaW5nIHRvIHZhbGlkIFczQyB0cmFjZS1pZCAoMzIgaGV4IGNoYXJzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvVzNDVHJhY2VJZChpZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgaGV4ID0gaWQucmVwbGFjZSgvW15hLWZBLUYwLTldL2csICcnKS50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gaGV4Lmxlbmd0aCA+PSBXM0NfVFJBQ0VfSURfTEVOR1RIXG4gICAgPyBoZXguc3Vic3RyaW5nKDAsIFczQ19UUkFDRV9JRF9MRU5HVEgpXG4gICAgOiBoZXgucGFkRW5kKFczQ19UUkFDRV9JRF9MRU5HVEgsICcwJyk7XG59XG5cbi8qKlxuICogQ29udmVydCBVVUlEL3N0cmluZyB0byB2YWxpZCBXM0MgcGFyZW50LWlkICgxNiBoZXggY2hhcnMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XM0NQYXJlbnRJZChpZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgaGV4ID0gaWQucmVwbGFjZSgvW15hLWZBLUYwLTldL2csICcnKS50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gaGV4Lmxlbmd0aCA+PSBXM0NfUEFSRU5UX0lEX0xFTkdUSFxuICAgID8gaGV4LnN1YnN0cmluZygwLCBXM0NfUEFSRU5UX0lEX0xFTkdUSClcbiAgICA6IGhleC5wYWRFbmQoVzNDX1BBUkVOVF9JRF9MRU5HVEgsICcwJyk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRyYWNlIENvbnRleHQgRXh0cmFjdGlvbiAoSW5jb21pbmcpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gSFRUUCBoZWFkZXJzLlxuICogUHJpb3JpdHk6IHgtY29ycmVsYXRpb24taWQgPiB0cmFjZXBhcmVudCAoVzNDKSA+IHgtYW16bi10cmFjZS1pZCAoWC1SYXkpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbUhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghaGVhZGVycykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBOb3JtYWxpemUgdG8gbG93ZXJjYXNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gPSB7fTtcbiAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgIG5vcm1hbGl6ZWRbIGtleS50b0xvd2VyQ2FzZSgpIF0gPSB2YWx1ZTtcbiAgfVxuXG4gIC8vIDEuIEN1c3RvbSBjb3JyZWxhdGlvbiBJRFxuICBjb25zdCBjdXN0b21JZCA9IG5vcm1hbGl6ZWRbICd4LWNvcnJlbGF0aW9uLWlkJyBdPy50cmltKCk7XG4gIGlmIChjdXN0b21JZCkge1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjdXN0b21JZCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogbm9ybWFsaXplZFsgJ3gtcGFyZW50LWxvZy1pZCcgXT8udHJpbSgpLFxuICAgICAgY2F1c2VkQnk6IG5vcm1hbGl6ZWRbICd4LWNhdXNlZC1ieScgXT8udHJpbSgpLFxuICAgIH07XG4gIH1cblxuICAvLyAyLiBXM0MgdHJhY2VwYXJlbnQ6IDAwLXt0cmFjZS1pZH0te3BhcmVudC1pZH0te2ZsYWdzfVxuICBjb25zdCB0cmFjZXBhcmVudCA9IG5vcm1hbGl6ZWRbICd0cmFjZXBhcmVudCcgXTtcbiAgaWYgKHRyYWNlcGFyZW50ICYmIC9eWzAtOWEtZl17Mn0tWzAtOWEtZl17MzJ9LVswLTlhLWZdezE2fS1bMC05YS1mXXsyfSQvLnRlc3QodHJhY2VwYXJlbnQpKSB7XG4gICAgY29uc3QgcGFydHMgPSB0cmFjZXBhcmVudC5zcGxpdCgnLScpO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBwYXJ0c1sgMSBdLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBwYXJ0c1sgMiBdLFxuICAgICAgc2FtcGxlZDogcGFydHNbIDMgXSA9PT0gJzAxJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMy4gWC1SYXk6IFJvb3Q9MS17ZXBvY2h9LXt1bmlxdWV9O1BhcmVudD17aWR9O1NhbXBsZWQ9ezB8MX1cbiAgY29uc3QgeHJheSA9IG5vcm1hbGl6ZWRbICd4LWFtem4tdHJhY2UtaWQnIF07XG4gIGlmICh4cmF5ICYmIC9Sb290PTEtWzAtOWEtZl17OH0tWzAtOWEtZl17MjR9Ly50ZXN0KHhyYXkpKSB7XG4gICAgY29uc3Qgcm9vdE1hdGNoID0geHJheS5tYXRjaCgvUm9vdD0oW147XSspLyk7XG4gICAgY29uc3QgcGFyZW50TWF0Y2ggPSB4cmF5Lm1hdGNoKC9QYXJlbnQ9KFteO10rKS8pO1xuICAgIGNvbnN0IHNhbXBsZWRNYXRjaCA9IHhyYXkubWF0Y2goL1NhbXBsZWQ9KFswMV0pLyk7XG4gICAgaWYgKHJvb3RNYXRjaCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogcm9vdE1hdGNoWyAxIF0ucmVwbGFjZSgvXjEtLywgJycpLnJlcGxhY2UoLy0vZywgJycpLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHBhcmVudE1hdGNoPy5bIDEgXSxcbiAgICAgICAgc2FtcGxlZDogc2FtcGxlZE1hdGNoPy5bIDEgXSA9PT0gJzEnLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIFNRUyBtZXNzYWdlIGF0dHJpYnV0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbVNxcyhcbiAgbWVzc2FnZUF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7IHN0cmluZ1ZhbHVlPzogc3RyaW5nOyBTdHJpbmdWYWx1ZT86IHN0cmluZyB9PlxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFtZXNzYWdlQXR0cmlidXRlcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBYLVJheSBoZWFkZXJcbiAgY29uc3QgeHJheUF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ0FXU1RyYWNlSGVhZGVyJyBdO1xuICBjb25zdCB4cmF5ID0geHJheUF0dHI/LnN0cmluZ1ZhbHVlIHx8IHhyYXlBdHRyPy5TdHJpbmdWYWx1ZTtcbiAgaWYgKHhyYXkgJiYgL1Jvb3Q9MS1bMC05YS1mXXs4fS1bMC05YS1mXXsyNH0vLnRlc3QoeHJheSkpIHtcbiAgICBjb25zdCByb290TWF0Y2ggPSB4cmF5Lm1hdGNoKC9Sb290PShbXjtdKykvKTtcbiAgICBjb25zdCBwYXJlbnRNYXRjaCA9IHhyYXkubWF0Y2goL1BhcmVudD0oW147XSspLyk7XG4gICAgY29uc3Qgc2FtcGxlZE1hdGNoID0geHJheS5tYXRjaCgvU2FtcGxlZD0oWzAxXSkvKTtcbiAgICBpZiAocm9vdE1hdGNoKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb3JyZWxhdGlvbklkOiByb290TWF0Y2hbIDEgXS5yZXBsYWNlKC9eMS0vLCAnJykucmVwbGFjZSgvLS9nLCAnJyksXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogcGFyZW50TWF0Y2g/LlsgMSBdLFxuICAgICAgICBzYW1wbGVkOiBzYW1wbGVkTWF0Y2g/LlsgMSBdID09PSAnMScsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIEN1c3RvbSBhdHRyaWJ1dGVzXG4gIGNvbnN0IGNvcnJlbGF0aW9uQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnY29ycmVsYXRpb25JZCcgXTtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IChjb3JyZWxhdGlvbkF0dHI/LnN0cmluZ1ZhbHVlIHx8IGNvcnJlbGF0aW9uQXR0cj8uU3RyaW5nVmFsdWUpPy50cmltKCk7XG4gIGlmIChjb3JyZWxhdGlvbklkKSB7XG4gICAgY29uc3QgcGFyZW50QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdO1xuICAgIGNvbnN0IHNhbXBsZWRBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdzYW1wbGVkJyBdO1xuICAgIGNvbnN0IGNhdXNlZEJ5QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnY2F1c2VkQnknIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IChwYXJlbnRBdHRyPy5zdHJpbmdWYWx1ZSB8fCBwYXJlbnRBdHRyPy5TdHJpbmdWYWx1ZSk/LnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiAoY2F1c2VkQnlBdHRyPy5zdHJpbmdWYWx1ZSB8fCBjYXVzZWRCeUF0dHI/LlN0cmluZ1ZhbHVlKT8udHJpbSgpLFxuICAgICAgc2FtcGxlZDogKHNhbXBsZWRBdHRyPy5zdHJpbmdWYWx1ZSB8fCBzYW1wbGVkQXR0cj8uU3RyaW5nVmFsdWUpID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU05TIG1lc3NhZ2UgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU25zKFxuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgVHlwZT86IHN0cmluZzsgVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY29ycmVsYXRpb25BdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjb3JyZWxhdGlvbklkJyBdO1xuICBpZiAoY29ycmVsYXRpb25BdHRyPy5WYWx1ZT8udHJpbSgpKSB7XG4gICAgY29uc3QgcGFyZW50QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdO1xuICAgIGNvbnN0IHNhbXBsZWRBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdzYW1wbGVkJyBdO1xuICAgIGNvbnN0IGNhdXNlZEJ5QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnY2F1c2VkQnknIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uQXR0ci5WYWx1ZS50cmltKCksXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHBhcmVudEF0dHI/LlZhbHVlPy50cmltKCksXG4gICAgICBjYXVzZWRCeTogY2F1c2VkQnlBdHRyPy5WYWx1ZT8udHJpbSgpLFxuICAgICAgc2FtcGxlZDogc2FtcGxlZEF0dHI/LlZhbHVlID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gRXZlbnRCcmlkZ2UgZXZlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbUV2ZW50QnJpZGdlKFxuICBldmVudDogeyBkZXRhaWw/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBjb25zdCBkZXRhaWwgPSBldmVudD8uZGV0YWlsO1xuICBpZiAoIWRldGFpbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBEaXJlY3QgZmllbGRzXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBkZXRhaWxbICdjb3JyZWxhdGlvbklkJyBdIHx8IGRldGFpbFsgJ3RyYWNlSWQnIF07XG4gIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICBjb25zdCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBkZXRhaWxbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF07XG4gICAgY29uc3QgY2F1c2VkQnkgPSBkZXRhaWxbICdjYXVzZWRCeScgXTtcbiAgICBjb25zdCBzYW1wbGVkID0gZGV0YWlsWyAnc2FtcGxlZCcgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHR5cGVvZiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdHJpbmcnID8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIGNhdXNlZEJ5OiB0eXBlb2YgY2F1c2VkQnkgPT09ICdzdHJpbmcnID8gY2F1c2VkQnkudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5lc3RlZCB0cmFjZUNvbnRleHQgb2JqZWN0XG4gIGNvbnN0IHRyYWNlQ29udGV4dCA9IGRldGFpbFsgJ3RyYWNlQ29udGV4dCcgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKHRyYWNlQ29udGV4dCAmJiB0eXBlb2YgdHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICh0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCBhcyBzdHJpbmcpLnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiB0eXBlb2YgdHJhY2VDb250ZXh0LmNhdXNlZEJ5ID09PSAnc3RyaW5nJyA/ICh0cmFjZUNvbnRleHQuY2F1c2VkQnkgYXMgc3RyaW5nKS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHR5cGVvZiB0cmFjZUNvbnRleHQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc3RyaW5nJ1xuICAgICAgICA/ICh0cmFjZUNvbnRleHQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGFzIHN0cmluZykudHJpbSgpXG4gICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAnYm9vbGVhbidcbiAgICAgICAgPyB0cmFjZUNvbnRleHQuc2FtcGxlZFxuICAgICAgICA6IHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU3RlcCBGdW5jdGlvbnMgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMoXG4gIGlucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBEaXJlY3QgZmllbGRzXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBpbnB1dFsgJ2NvcnJlbGF0aW9uSWQnIF0gfHwgaW5wdXRbICd0cmFjZUlkJyBdO1xuICBpZiAodHlwZW9mIGNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIGNvcnJlbGF0aW9uSWQudHJpbSgpKSB7XG4gICAgY29uc3QgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gaW5wdXRbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF07XG4gICAgY29uc3Qgc2FtcGxlZCA9IGlucHV0WyAnc2FtcGxlZCcgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHR5cGVvZiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdHJpbmcnID8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIHNhbXBsZWQ6IHR5cGVvZiBzYW1wbGVkID09PSAnYm9vbGVhbicgPyBzYW1wbGVkIDogc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICAvLyBOZXN0ZWQgdHJhY2VDb250ZXh0XG4gIGNvbnN0IHRyYWNlQ29udGV4dCA9IGlucHV0WyAndHJhY2VDb250ZXh0JyBdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICBpZiAodHJhY2VDb250ZXh0ICYmIHR5cGVvZiB0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkIGFzIHN0cmluZykudHJpbSgpLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyAodHJhY2VDb250ZXh0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBhcyBzdHJpbmcpLnRyaW0oKVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIHNhbXBsZWQ6IHR5cGVvZiB0cmFjZUNvbnRleHQuc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nXG4gICAgICAgID8gdHJhY2VDb250ZXh0LnNhbXBsZWRcbiAgICAgICAgOiB0cmFjZUNvbnRleHQuc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICAvLyBBV1MgZXhlY3V0aW9uIGNvbnRleHRcbiAgY29uc3QgYXdzQ29udGV4dCA9IGlucHV0WyAnYXdzJyBdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICBpZiAoYXdzQ29udGV4dD8uWyAnZXhlY3V0aW9uQXJuJyBdICYmIHR5cGVvZiBhd3NDb250ZXh0WyAnZXhlY3V0aW9uQXJuJyBdID09PSAnc3RyaW5nJykge1xuICAgIGNvbnN0IGFyblBhcnRzID0gKGF3c0NvbnRleHRbICdleGVjdXRpb25Bcm4nIF0gYXMgc3RyaW5nKS5zcGxpdCgnOicpO1xuICAgIHJldHVybiB7IGNvcnJlbGF0aW9uSWQ6IGFyblBhcnRzWyBhcm5QYXJ0cy5sZW5ndGggLSAxIF0gfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gS2luZXNpcyByZWNvcmQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbUtpbmVzaXMoXG4gIHJlY29yZDogeyBraW5lc2lzPzogeyBkYXRhPzogc3RyaW5nOyBwYXJ0aXRpb25LZXk/OiBzdHJpbmcgfSB9XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIXJlY29yZD8ua2luZXNpcz8uZGF0YSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICB0cnkge1xuICAgIGNvbnN0IGRlY29kZWQgPSBCdWZmZXIuZnJvbShyZWNvcmQua2luZXNpcy5kYXRhLCAnYmFzZTY0JykudG9TdHJpbmcoJ3V0Zi04Jyk7XG4gICAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoZGVjb2RlZCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGRhdGFbICdjb3JyZWxhdGlvbklkJyBdIHx8IGRhdGFbICd0cmFjZUlkJyBdO1xuICAgIGlmICh0eXBlb2YgY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycgJiYgY29ycmVsYXRpb25JZC50cmltKCkpIHtcbiAgICAgIGNvbnN0IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IGRhdGFbICdwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnIF07XG4gICAgICBjb25zdCBjYXVzZWRCeSA9IGRhdGFbICdjYXVzZWRCeScgXTtcbiAgICAgIGNvbnN0IHNhbXBsZWQgPSBkYXRhWyAnc2FtcGxlZCcgXTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQudHJpbSgpLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHR5cGVvZiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdHJpbmcnID8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgY2F1c2VkQnk6IHR5cGVvZiBjYXVzZWRCeSA9PT0gJ3N0cmluZycgPyBjYXVzZWRCeS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICAgIHNhbXBsZWQ6IHR5cGVvZiBzYW1wbGVkID09PSAnYm9vbGVhbicgPyBzYW1wbGVkIDogc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgICAgfTtcbiAgICB9XG4gIH0gY2F0Y2gge1xuICAgIC8vIE5vdCBKU09OXG4gIH1cblxuICAvLyBGYWxsIGJhY2sgdG8gcGFydGl0aW9uIGtleVxuICBpZiAocmVjb3JkLmtpbmVzaXMucGFydGl0aW9uS2V5KSB7XG4gICAgcmV0dXJuIHsgY29ycmVsYXRpb25JZDogcmVjb3JkLmtpbmVzaXMucGFydGl0aW9uS2V5IH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IENyZWF0aW9uIChPdXRnb2luZylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDcmVhdGUgSFRUUCBoZWFkZXJzIGZvciB0cmFjZSBwcm9wYWdhdGlvbiBpbiBvdXRnb2luZyBIVFRQIHJlcXVlc3RzLlxuICogXG4gKiBSZXR1cm5zIGhlYWRlcnMgdGhhdCBpbmNsdWRlOlxuICogLSBgeC1jb3JyZWxhdGlvbi1pZGA6IEN1c3RvbSBjb3JyZWxhdGlvbiBJRCBmb3IgYXBwbGljYXRpb24tbGV2ZWwgdHJhY2luZ1xuICogLSBgeC1wYXJlbnQtbG9nLWlkYDogUGFyZW50IHNwYW4vbG9nIElEIGZvciBoaWVyYXJjaHkgdHJhY2tpbmdcbiAqIC0gYHRyYWNlcGFyZW50YDogVzNDIFRyYWNlIENvbnRleHQgc3RhbmRhcmQgaGVhZGVyICgwMC17dHJhY2UtaWR9LXtwYXJlbnQtaWR9LXtmbGFnc30pXG4gKiBcbiAqICMjIFVzYWdlIHdpdGggZmV0Y2gvYXhpb3NcbiAqIFxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQsIGNyZWF0ZUh0dHBIZWFkZXJzIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNCc7XG4gKiBcbiAqIC8vIE9wdGlvbiAxOiBHZXQgY29udGV4dCBhdXRvbWF0aWNhbGx5IChyZWNvbW1lbmRlZClcbiAqIGFzeW5jIGZ1bmN0aW9uIGNhbGxFeHRlcm5hbFNlcnZpY2UoZGF0YTogYW55KSB7XG4gKiAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gKiAgIGNvbnN0IHRyYWNlSGVhZGVycyA9IGN0eCA/IGNyZWF0ZUh0dHBIZWFkZXJzKGN0eCkgOiB7fTtcbiAqICAgXG4gKiAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tL2VuZHBvaW50Jywge1xuICogICAgIG1ldGhvZDogJ1BPU1QnLFxuICogICAgIGhlYWRlcnM6IHtcbiAqICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gKiAgICAgICAuLi50cmFjZUhlYWRlcnMsICAvLyBTcHJlYWQgdHJhY2UgaGVhZGVyc1xuICogICAgIH0sXG4gKiAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZGF0YSksXG4gKiAgIH0pO1xuICogICByZXR1cm4gcmVzcG9uc2UuanNvbigpO1xuICogfVxuICogXG4gKiAvLyBPcHRpb24gMjogV2l0aCBheGlvcyBpbnRlcmNlcHRvclxuICogaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcbiAqIFxuICogY29uc3QgYXBpQ2xpZW50ID0gYXhpb3MuY3JlYXRlKHsgYmFzZVVSTDogJ2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tJyB9KTtcbiAqIFxuICogYXBpQ2xpZW50LmludGVyY2VwdG9ycy5yZXF1ZXN0LnVzZSgoY29uZmlnKSA9PiB7XG4gKiAgIGNvbnN0IGN0eCA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gKiAgIGlmIChjdHgpIHtcbiAqICAgICBjb25zdCB0cmFjZUhlYWRlcnMgPSBjcmVhdGVIdHRwSGVhZGVycyhjdHgpO1xuICogICAgIGNvbmZpZy5oZWFkZXJzID0geyAuLi5jb25maWcuaGVhZGVycywgLi4udHJhY2VIZWFkZXJzIH07XG4gKiAgIH1cbiAqICAgcmV0dXJuIGNvbmZpZztcbiAqIH0pO1xuICogYGBgXG4gKiBcbiAqICMjIE5vdGUgb24gVzNDIFRyYWNlIENvbnRleHRcbiAqIFRoZSBgdHJhY2VwYXJlbnRgIGhlYWRlciBmb2xsb3dzIHRoZSBXM0MgVHJhY2UgQ29udGV4dCBzcGVjaWZpY2F0aW9uOlxuICogLSBGb3JtYXQ6IGB7dmVyc2lvbn0te3RyYWNlLWlkfS17cGFyZW50LWlkfS17ZmxhZ3N9YFxuICogLSBFeGFtcGxlOiBgMDAtMGFmNzY1MTkxNmNkNDNkZDg0NDhlYjIxMWM4MDMxOWMtYjdhZDZiNzE2OTIwMzMzMS0wMWBcbiAqIC0gYGZsYWdzYDogYDAxYCA9IHNhbXBsZWQsIGAwMGAgPSBub3Qgc2FtcGxlZFxuICogXG4gKiBUaGlzIGVuYWJsZXMgaW50ZXJvcGVyYWJpbGl0eSB3aXRoIE9wZW5UZWxlbWV0cnksIEphZWdlciwgWmlwa2luLCBhbmQgb3RoZXJcbiAqIGRpc3RyaWJ1dGVkIHRyYWNpbmcgc3lzdGVtcy5cbiAqIFxuICogQHBhcmFtIGN0eCAtIFRoZSBleGVjdXRpb24gY29udGV4dCB0byBwcm9wYWdhdGVcbiAqIEByZXR1cm5zIEhlYWRlcnMgb2JqZWN0IHRvIHNwcmVhZCBpbnRvIHlvdXIgSFRUUCByZXF1ZXN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIdHRwSGVhZGVycyhjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJ3gtY29ycmVsYXRpb24taWQnOiBjdHguY29ycmVsYXRpb25JZCxcbiAgfTtcblxuICBpZiAoY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgIGhlYWRlcnNbICd4LXBhcmVudC1sb2ctaWQnIF0gPSBjdHgucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICB9XG5cbiAgLy8gU2V0IGNhdXNlZEJ5IHRvIENVUlJFTlQgY29ycmVsYXRpb25JZCBmb3IgdGhlIG5leHQgaG9wXG4gIC8vIFRoaXMgZW5zdXJlcyB0aGUgY2hhaW4gaXMgQSAtPiBCIC0+IEMsIG5vdCBSb290IC0+IEEsIFJvb3QgLT4gQiwgUm9vdCAtPiBDXG4gIGhlYWRlcnNbICd4LWNhdXNlZC1ieScgXSA9IGN0eC5jb3JyZWxhdGlvbklkO1xuXG4gIC8vIFczQyB0cmFjZXBhcmVudFxuICBjb25zdCBzYW1wbGVkRmxhZyA9IGN0eC5zYW1wbGVkID8gJzAxJyA6ICcwMCc7XG4gIGNvbnN0IHRyYWNlSWQgPSB0b1czQ1RyYWNlSWQoY3R4LmNvcnJlbGF0aW9uSWQpO1xuICBjb25zdCBwYXJlbnRJZCA9IGN0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAgICA/IHRvVzNDUGFyZW50SWQoY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZClcbiAgICA6IHRvVzNDUGFyZW50SWQoY3R4LmNvcnJlbGF0aW9uSWQpO1xuICBoZWFkZXJzWyAndHJhY2VwYXJlbnQnIF0gPSBgMDAtJHt0cmFjZUlkfS0ke3BhcmVudElkfS0ke3NhbXBsZWRGbGFnfWA7XG5cbiAgcmV0dXJuIGhlYWRlcnM7XG59XG5cbi8qKlxuICogQ3JlYXRlIFNRUyBtZXNzYWdlIGF0dHJpYnV0ZXMgZm9yIHRyYWNlIHByb3BhZ2F0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3FzQXR0cmlidXRlcyhcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YVxuKTogUmVjb3JkPHN0cmluZywgeyBEYXRhVHlwZTogc3RyaW5nOyBTdHJpbmdWYWx1ZTogc3RyaW5nIH0+IHtcbiAgY29uc3QgYXR0cnM6IFJlY29yZDxzdHJpbmcsIHsgRGF0YVR5cGU6IHN0cmluZzsgU3RyaW5nVmFsdWU6IHN0cmluZyB9PiA9IHtcbiAgICBjb3JyZWxhdGlvbklkOiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IGN0eC5jb3JyZWxhdGlvbklkIH0sXG4gICAgc2FtcGxlZDogeyBEYXRhVHlwZTogJ1N0cmluZycsIFN0cmluZ1ZhbHVlOiBTdHJpbmcoY3R4LnNhbXBsZWQpIH0sXG4gICAgLy8gU2V0IGNhdXNlZEJ5IHRvIENVUlJFTlQgY29ycmVsYXRpb25JZCBmb3IgdGhlIG5leHQgaG9wXG4gICAgY2F1c2VkQnk6IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY3R4LmNvcnJlbGF0aW9uSWQgfSxcbiAgfTtcbiAgaWYgKGN0eC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICBhdHRyc1sgJ3BhcmVudE9ic2VydmFiaWxpdHlMb2dJZCcgXSA9IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB9O1xuICB9XG4gIHJldHVybiBhdHRycztcbn1cblxuLyoqXG4gKiBDcmVhdGUgU05TIG1lc3NhZ2UgYXR0cmlidXRlcyBmb3IgdHJhY2UgcHJvcGFnYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTbnNBdHRyaWJ1dGVzKFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4ge1xuICByZXR1cm4gY3JlYXRlU3FzQXR0cmlidXRlcyhjdHgpO1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBFdmVudEJyaWRnZSBldmVudCBkZXRhaWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IGJvb2xlYW4+IHtcbiAgY29uc3QgdHJhY2VDb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiA9IHtcbiAgICBjb3JyZWxhdGlvbklkOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICBzYW1wbGVkOiBjdHguc2FtcGxlZCxcbiAgICAvLyBTZXQgY2F1c2VkQnkgdG8gQ1VSUkVOVCBjb3JyZWxhdGlvbklkIGZvciB0aGUgbmV4dCBob3BcbiAgICBjYXVzZWRCeTogY3R4LmNvcnJlbGF0aW9uSWQsXG4gIH07XG4gIGlmIChjdHgucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgdHJhY2VDb250ZXh0WyAncGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkJyBdID0gY3R4LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDtcbiAgfVxuICByZXR1cm4gdHJhY2VDb250ZXh0O1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBTdGVwIEZ1bmN0aW9ucyBvdXRwdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dChcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YVxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4ge1xuICByZXR1cm4gY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0KGN0eCk7XG59XG5cbiJdfQ==