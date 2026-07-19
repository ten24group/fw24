"use strict";
/**
 * Trace Context Propagation
 *
 * Extract trace context from incoming requests/messages.
 * Create propagation data for outgoing requests/messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeTraceId = sanitizeTraceId;
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
/**
 * Conservative charset+length for a correlation/caused-by id read from an
 * UNTRUSTED source (inbound HTTP header, SQS/SNS attribute, event payload).
 *
 * SECURITY (P0): an inbound `x-correlation-id` / `x-caused-by` flows into the
 * ExecutionContext and can be re-emitted verbatim on outbound headers
 * (`createHttpHeaders`) and into structured logs. Without a charset guard a
 * caller could inject CR/LF (outbound-header splitting / request smuggling —
 * an availability bug) or newlines/control chars (log injection & amplification).
 * We therefore accept only `[A-Za-z0-9._-]`, capped at 128 chars — a superset of
 * UUIDs, W3C hex trace-ids, and AWS request ids, but with no header/log-breaking
 * characters. On violation the value is dropped so the entry point mints a fresh
 * id instead of propagating the poisoned one.
 */
const SAFE_TRACE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
/**
 * Return `value` only if it is a safe trace/correlation id (see
 * {@link SAFE_TRACE_ID_RE}); otherwise `undefined`. Trims first; treats blank as
 * absent. Use at every UNTRUSTED extraction boundary so nothing charset-unsafe
 * can reach outbound headers or logs.
 */
function sanitizeTraceId(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return SAFE_TRACE_ID_RE.test(trimmed) ? trimmed : undefined;
}
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
    // 1. Custom correlation ID (UNTRUSTED — sanitize charset+length before use).
    // A poisoned value is dropped so the caller mints a fresh id rather than
    // propagating CR/LF or control chars to outbound headers / logs.
    const customId = sanitizeTraceId(normalized['x-correlation-id']);
    if (customId) {
        return {
            correlationId: customId,
            causedBy: sanitizeTraceId(normalized['x-caused-by']),
        };
    }
    // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
    // The strict hex regex already guarantees a header/log-safe value.
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
        const sampledMatch = xray.match(/Sampled=([01])/);
        if (rootMatch) {
            const correlationId = sanitizeTraceId(rootMatch[1].replace(/^1-/, '').replace(/-/g, ''));
            if (correlationId) {
                return {
                    correlationId,
                    sampled: sampledMatch?.[1] === '1',
                };
            }
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
        const sampledMatch = xray.match(/Sampled=([01])/);
        if (rootMatch) {
            const correlationId = sanitizeTraceId(rootMatch[1].replace(/^1-/, '').replace(/-/g, ''));
            if (correlationId) {
                return {
                    correlationId,
                    sampled: sampledMatch?.[1] === '1',
                };
            }
        }
    }
    // Custom attributes (sanitize — a poisoned upstream attribute must not reach
    // outbound headers or logs)
    const correlationAttr = messageAttributes['correlationId'];
    const correlationId = sanitizeTraceId(correlationAttr?.stringValue || correlationAttr?.StringValue);
    if (correlationId) {
        const sampledAttr = messageAttributes['sampled'];
        const causedByAttr = messageAttributes['causedBy'];
        return {
            correlationId,
            causedBy: sanitizeTraceId(causedByAttr?.stringValue || causedByAttr?.StringValue),
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
    const correlationId = sanitizeTraceId(correlationAttr?.Value);
    if (correlationId) {
        const sampledAttr = messageAttributes['sampled'];
        const causedByAttr = messageAttributes['causedBy'];
        return {
            correlationId,
            causedBy: sanitizeTraceId(causedByAttr?.Value),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvcGFnYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3Byb3BhZ2F0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFxQ0gsMENBSUM7QUFTRCxvQ0FLQztBQUtELHNDQUtDO0FBVUQsZ0RBa0RDO0FBS0Qsd0NBcUNDO0FBS0Qsd0NBa0JDO0FBU0Qsb0RBYUM7QUFLRCx3REErQkM7QUFLRCw0REFrQ0M7QUFLRCxnREE0QkM7QUE2REQsOENBcUJDO0FBS0Qsa0RBYUM7QUFLRCxrREFJQztBQUtELDREQVlDO0FBS0QsZ0VBSUM7QUFwY0QsMERBQTBEO0FBRTFELCtFQUErRTtBQUMvRSxZQUFZO0FBQ1osK0VBQStFO0FBRS9FLG9EQUFvRDtBQUNwRCxNQUFNLG1CQUFtQixHQUFHLEVBQUUsQ0FBQztBQUUvQiw0REFBNEQ7QUFDNUQsTUFBTSxvQkFBb0IsR0FBRyxFQUFFLENBQUM7QUFFaEM7Ozs7Ozs7Ozs7Ozs7R0FhRztBQUNILE1BQU0sZ0JBQWdCLEdBQUcseUJBQXlCLENBQUM7QUFFbkQ7Ozs7O0dBS0c7QUFDSCxTQUFnQixlQUFlLENBQUMsS0FBZ0M7SUFDOUQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFDaEQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQzdCLE9BQU8sZ0JBQWdCLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztBQUM5RCxDQUFDO0FBRUQsK0VBQStFO0FBQy9FLGdCQUFnQjtBQUNoQiwrRUFBK0U7QUFFL0U7O0dBRUc7QUFDSCxTQUFnQixZQUFZLENBQUMsRUFBVTtJQUNyQyxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUMxRCxPQUFPLEdBQUcsQ0FBQyxNQUFNLElBQUksbUJBQW1CO1FBQ3RDLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxtQkFBbUIsQ0FBQztRQUN2QyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUMzQyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixhQUFhLENBQUMsRUFBVTtJQUN0QyxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUMxRCxPQUFPLEdBQUcsQ0FBQyxNQUFNLElBQUksb0JBQW9CO1FBQ3ZDLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxvQkFBb0IsQ0FBQztRQUN4QyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUM1QyxDQUFDO0FBRUQsK0VBQStFO0FBQy9FLHNDQUFzQztBQUN0QywrRUFBK0U7QUFFL0U7OztHQUdHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQ2hDLE9BQTJDO0lBRTNDLElBQUksQ0FBQyxPQUFPO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFFL0IseUJBQXlCO0lBQ3pCLE1BQU0sVUFBVSxHQUF1QyxFQUFFLENBQUM7SUFDMUQsS0FBSyxNQUFNLENBQUUsR0FBRyxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNyRCxVQUFVLENBQUUsR0FBRyxDQUFDLFdBQVcsRUFBRSxDQUFFLEdBQUcsS0FBSyxDQUFDO0lBQzFDLENBQUM7SUFFRCw2RUFBNkU7SUFDN0UseUVBQXlFO0lBQ3pFLGlFQUFpRTtJQUNqRSxNQUFNLFFBQVEsR0FBRyxlQUFlLENBQUMsVUFBVSxDQUFFLGtCQUFrQixDQUFFLENBQUMsQ0FBQztJQUNuRSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ2IsT0FBTztZQUNMLGFBQWEsRUFBRSxRQUFRO1lBQ3ZCLFFBQVEsRUFBRSxlQUFlLENBQUMsVUFBVSxDQUFFLGFBQWEsQ0FBRSxDQUFDO1NBQ3ZELENBQUM7SUFDSixDQUFDO0lBRUQsd0RBQXdEO0lBQ3hELG1FQUFtRTtJQUNuRSxNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUUsYUFBYSxDQUFFLENBQUM7SUFDaEQsSUFBSSxXQUFXLElBQUkscURBQXFELENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7UUFDM0YsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNyQyxPQUFPO1lBQ0wsYUFBYSxFQUFFLEtBQUssQ0FBRSxDQUFDLENBQUU7WUFDekIsT0FBTyxFQUFFLEtBQUssQ0FBRSxDQUFDLENBQUUsS0FBSyxJQUFJO1NBQzdCLENBQUM7SUFDSixDQUFDO0lBRUQsOERBQThEO0lBQzlELE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBRSxpQkFBaUIsQ0FBRSxDQUFDO0lBQzdDLElBQUksSUFBSSxJQUFJLGlDQUFpQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQ3pELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDN0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2xELElBQUksU0FBUyxFQUFFLENBQUM7WUFDZCxNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUMsU0FBUyxDQUFFLENBQUMsQ0FBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQzNGLElBQUksYUFBYSxFQUFFLENBQUM7Z0JBQ2xCLE9BQU87b0JBQ0wsYUFBYTtvQkFDYixPQUFPLEVBQUUsWUFBWSxFQUFFLENBQUUsQ0FBQyxDQUFFLEtBQUssR0FBRztpQkFDckMsQ0FBQztZQUNKLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sU0FBUyxDQUFDO0FBQ25CLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGNBQWMsQ0FDNUIsaUJBQWtGO0lBRWxGLElBQUksQ0FBQyxpQkFBaUI7UUFBRSxPQUFPLFNBQVMsQ0FBQztJQUV6QyxlQUFlO0lBQ2YsTUFBTSxRQUFRLEdBQUcsaUJBQWlCLENBQUUsZ0JBQWdCLENBQUUsQ0FBQztJQUN2RCxNQUFNLElBQUksR0FBRyxRQUFRLEVBQUUsV0FBVyxJQUFJLFFBQVEsRUFBRSxXQUFXLENBQUM7SUFDNUQsSUFBSSxJQUFJLElBQUksaUNBQWlDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDekQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUM3QyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDbEQsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNkLE1BQU0sYUFBYSxHQUFHLGVBQWUsQ0FBQyxTQUFTLENBQUUsQ0FBQyxDQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDM0YsSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDbEIsT0FBTztvQkFDTCxhQUFhO29CQUNiLE9BQU8sRUFBRSxZQUFZLEVBQUUsQ0FBRSxDQUFDLENBQUUsS0FBSyxHQUFHO2lCQUNyQyxDQUFDO1lBQ0osQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsNkVBQTZFO0lBQzdFLDRCQUE0QjtJQUM1QixNQUFNLGVBQWUsR0FBRyxpQkFBaUIsQ0FBRSxlQUFlLENBQUUsQ0FBQztJQUM3RCxNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUMsZUFBZSxFQUFFLFdBQVcsSUFBSSxlQUFlLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFDcEcsSUFBSSxhQUFhLEVBQUUsQ0FBQztRQUNsQixNQUFNLFdBQVcsR0FBRyxpQkFBaUIsQ0FBRSxTQUFTLENBQUUsQ0FBQztRQUNuRCxNQUFNLFlBQVksR0FBRyxpQkFBaUIsQ0FBRSxVQUFVLENBQUUsQ0FBQztRQUNyRCxPQUFPO1lBQ0wsYUFBYTtZQUNiLFFBQVEsRUFBRSxlQUFlLENBQUMsWUFBWSxFQUFFLFdBQVcsSUFBSSxZQUFZLEVBQUUsV0FBVyxDQUFDO1lBQ2pGLE9BQU8sRUFBRSxDQUFDLFdBQVcsRUFBRSxXQUFXLElBQUksV0FBVyxFQUFFLFdBQVcsQ0FBQyxLQUFLLE1BQU07U0FDM0UsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixjQUFjLENBQzVCLGlCQUFxRTtJQUVyRSxJQUFJLENBQUMsaUJBQWlCO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFFekMsTUFBTSxlQUFlLEdBQUcsaUJBQWlCLENBQUUsZUFBZSxDQUFFLENBQUM7SUFDN0QsTUFBTSxhQUFhLEdBQUcsZUFBZSxDQUFDLGVBQWUsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUM5RCxJQUFJLGFBQWEsRUFBRSxDQUFDO1FBQ2xCLE1BQU0sV0FBVyxHQUFHLGlCQUFpQixDQUFFLFNBQVMsQ0FBRSxDQUFDO1FBQ25ELE1BQU0sWUFBWSxHQUFHLGlCQUFpQixDQUFFLFVBQVUsQ0FBRSxDQUFDO1FBQ3JELE9BQU87WUFDTCxhQUFhO1lBQ2IsUUFBUSxFQUFFLGVBQWUsQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDO1lBQzlDLE9BQU8sRUFBRSxXQUFXLEVBQUUsS0FBSyxLQUFLLE1BQU07U0FDdkMsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBZ0Isb0JBQW9CLENBQUMsTUFHcEM7SUFDQyxrQ0FBa0M7SUFDbEMsTUFBTSxPQUFPLEdBQUcsY0FBYyxDQUFDLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0lBQzFELElBQUksT0FBTyxFQUFFLGFBQWE7UUFBRSxPQUFPLE9BQU8sQ0FBQztJQUUzQyx5QkFBeUI7SUFDekIsSUFBSSxPQUFPLE1BQU0sRUFBRSxJQUFJLEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUk7UUFBRSxPQUFPLFNBQVMsQ0FBQztJQUN2RSxNQUFNLFFBQVEsR0FBRyxJQUFBLHNDQUFtQixFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNsRCxJQUFJLENBQUMsUUFBUTtRQUFFLE9BQU8sU0FBUyxDQUFDO0lBQ2hDLE9BQU8sY0FBYyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0FBQ3BELENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLHNCQUFzQixDQUNwQyxLQUEyQztJQUUzQyxNQUFNLE1BQU0sR0FBRyxLQUFLLEVBQUUsTUFBTSxDQUFDO0lBQzdCLElBQUksQ0FBQyxNQUFNO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFFOUIsZ0JBQWdCO0lBQ2hCLE1BQU0sYUFBYSxHQUFHLE1BQU0sQ0FBRSxlQUFlLENBQUUsSUFBSSxNQUFNLENBQUUsU0FBUyxDQUFFLENBQUM7SUFDdkUsSUFBSSxPQUFPLGFBQWEsS0FBSyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7UUFDOUQsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFFLFVBQVUsQ0FBRSxDQUFDO1FBQ3RDLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBRSxTQUFTLENBQUUsQ0FBQztRQUNwQyxPQUFPO1lBQ0wsYUFBYSxFQUFFLGFBQWEsQ0FBQyxJQUFJLEVBQUU7WUFDbkMsUUFBUSxFQUFFLE9BQU8sUUFBUSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ3BFLE9BQU8sRUFBRSxPQUFPLE9BQU8sS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxLQUFLLE1BQU07U0FDckUsQ0FBQztJQUNKLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFFLGNBQWMsQ0FBeUMsQ0FBQztJQUNyRixJQUFJLFlBQVksSUFBSSxPQUFPLFlBQVksQ0FBQyxhQUFhLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDbkUsT0FBTztZQUNMLGFBQWEsRUFBRyxZQUFZLENBQUMsYUFBd0IsQ0FBQyxJQUFJLEVBQUU7WUFDNUQsUUFBUSxFQUFFLE9BQU8sWUFBWSxDQUFDLFFBQVEsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFFLFlBQVksQ0FBQyxRQUFtQixDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQzFHLE9BQU8sRUFBRSxPQUFPLFlBQVksQ0FBQyxPQUFPLEtBQUssU0FBUztnQkFDaEQsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPO2dCQUN0QixDQUFDLENBQUMsWUFBWSxDQUFDLE9BQU8sS0FBSyxNQUFNO1NBQ3BDLENBQUM7SUFDSixDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isd0JBQXdCLENBQ3RDLEtBQThCO0lBRTlCLElBQUksQ0FBQyxLQUFLO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFFN0IsZ0JBQWdCO0lBQ2hCLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBRSxlQUFlLENBQUUsSUFBSSxLQUFLLENBQUUsU0FBUyxDQUFFLENBQUM7SUFDckUsSUFBSSxPQUFPLGFBQWEsS0FBSyxRQUFRLElBQUksYUFBYSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7UUFDOUQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFFLFNBQVMsQ0FBRSxDQUFDO1FBQ25DLE9BQU87WUFDTCxhQUFhLEVBQUUsYUFBYSxDQUFDLElBQUksRUFBRTtZQUNuQyxPQUFPLEVBQUUsT0FBTyxPQUFPLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxNQUFNO1NBQ3JFLENBQUM7SUFDSixDQUFDO0lBRUQsc0JBQXNCO0lBQ3RCLE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBRSxjQUFjLENBQXlDLENBQUM7SUFDcEYsSUFBSSxZQUFZLElBQUksT0FBTyxZQUFZLENBQUMsYUFBYSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ25FLE9BQU87WUFDTCxhQUFhLEVBQUcsWUFBWSxDQUFDLGFBQXdCLENBQUMsSUFBSSxFQUFFO1lBQzVELE9BQU8sRUFBRSxPQUFPLFlBQVksQ0FBQyxPQUFPLEtBQUssU0FBUztnQkFDaEQsQ0FBQyxDQUFDLFlBQVksQ0FBQyxPQUFPO2dCQUN0QixDQUFDLENBQUMsWUFBWSxDQUFDLE9BQU8sS0FBSyxNQUFNO1NBQ3BDLENBQUM7SUFDSixDQUFDO0lBRUQsd0JBQXdCO0lBQ3hCLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBRSxLQUFLLENBQXlDLENBQUM7SUFDekUsSUFBSSxVQUFVLEVBQUUsQ0FBRSxjQUFjLENBQUUsSUFBSSxPQUFPLFVBQVUsQ0FBRSxjQUFjLENBQUUsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN2RixNQUFNLFFBQVEsR0FBSSxVQUFVLENBQUUsY0FBYyxDQUFhLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3JFLE9BQU8sRUFBRSxhQUFhLEVBQUUsUUFBUSxDQUFFLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFFLEVBQUUsQ0FBQztJQUM1RCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQ2hDLE1BQThEO0lBRTlELElBQUksQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUk7UUFBRSxPQUFPLFNBQVMsQ0FBQztJQUU3QyxJQUFJLENBQUM7UUFDSCxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUM3RSxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBNEIsQ0FBQztRQUM1RCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUUsZUFBZSxDQUFFLElBQUksSUFBSSxDQUFFLFNBQVMsQ0FBRSxDQUFDO1FBQ25FLElBQUksT0FBTyxhQUFhLEtBQUssUUFBUSxJQUFJLGFBQWEsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO1lBQzlELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBRSxVQUFVLENBQUUsQ0FBQztZQUNwQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUUsU0FBUyxDQUFFLENBQUM7WUFDbEMsT0FBTztnQkFDTCxhQUFhLEVBQUUsYUFBYSxDQUFDLElBQUksRUFBRTtnQkFDbkMsUUFBUSxFQUFFLE9BQU8sUUFBUSxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTO2dCQUNwRSxPQUFPLEVBQUUsT0FBTyxPQUFPLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxNQUFNO2FBQ3JFLENBQUM7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNQLFdBQVc7SUFDYixDQUFDO0lBRUQsNkJBQTZCO0lBQzdCLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsQ0FBQztRQUNoQyxPQUFPLEVBQUUsYUFBYSxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDeEQsQ0FBQztJQUVELE9BQU8sU0FBUyxDQUFDO0FBQ25CLENBQUM7QUFFRCwrRUFBK0U7QUFDL0Usb0NBQW9DO0FBQ3BDLCtFQUErRTtBQUUvRTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0RHO0FBQ0gsU0FBZ0IsaUJBQWlCLENBQUMsR0FBeUI7SUFDekQsTUFBTSxPQUFPLEdBQTJCO1FBQ3RDLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxhQUFhO0tBQ3RDLENBQUM7SUFFRix1RUFBdUU7SUFDdkUsZ0ZBQWdGO0lBRWhGLHlEQUF5RDtJQUN6RCw2RUFBNkU7SUFDN0UsT0FBTyxDQUFFLGFBQWEsQ0FBRSxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUM7SUFFN0Msa0JBQWtCO0lBQ2xCLE1BQU0sV0FBVyxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUM1RCxNQUFNLE9BQU8sR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQ2hELDJGQUEyRjtJQUMzRiw4REFBOEQ7SUFDOUQsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUNsRCxPQUFPLENBQUUsYUFBYSxDQUFFLEdBQUcsTUFBTSxPQUFPLElBQUksUUFBUSxJQUFJLFdBQVcsRUFBRSxDQUFDO0lBRXRFLE9BQU8sT0FBTyxDQUFDO0FBQ2pCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLG1CQUFtQixDQUNqQyxHQUF5QjtJQUV6QixpRUFBaUU7SUFDakUsOEVBQThFO0lBQzlFLE1BQU0sUUFBUSxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUM7SUFFbkMsTUFBTSxLQUFLLEdBQThEO1FBQ3ZFLGFBQWEsRUFBRSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLEdBQUcsQ0FBQyxhQUFhLEVBQUU7UUFDckUsT0FBTyxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLEVBQUU7UUFDL0UsUUFBUSxFQUFFLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFO0tBQ3hELENBQUM7SUFDRixPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLG1CQUFtQixDQUNqQyxHQUF5QjtJQUV6QixPQUFPLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ2xDLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLHdCQUF3QixDQUN0QyxHQUF5QjtJQUV6QixpRUFBaUU7SUFDakUsOEVBQThFO0lBRTlFLE1BQU0sWUFBWSxHQUFxQztRQUNyRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWE7UUFDaEMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztRQUNsQyxRQUFRLEVBQUUsR0FBRyxDQUFDLGFBQWEsRUFBRywrQ0FBK0M7S0FDOUUsQ0FBQztJQUNGLE9BQU8sWUFBWSxDQUFDO0FBQ3RCLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLDBCQUEwQixDQUN4QyxHQUF5QjtJQUV6QixPQUFPLHdCQUF3QixDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFRyYWNlIENvbnRleHQgUHJvcGFnYXRpb25cbiAqIFxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gaW5jb21pbmcgcmVxdWVzdHMvbWVzc2FnZXMuXG4gKiBDcmVhdGUgcHJvcGFnYXRpb24gZGF0YSBmb3Igb3V0Z29pbmcgcmVxdWVzdHMvbWVzc2FnZXMuXG4gKi9cblxuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dERhdGEsIFBhcnNlZFRyYWNlQ29udGV4dCB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgcGFyc2VTbnNTcXNFbnZlbG9wZSB9IGZyb20gJy4uL3Nucy1zcXMtZW52ZWxvcGUnO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb25zdGFudHNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIFczQyB0cmFjZS1pZCBsZW5ndGggKDMyIGhleCBjaGFycyA9IDE2IGJ5dGVzKSAqL1xuY29uc3QgVzNDX1RSQUNFX0lEX0xFTkdUSCA9IDMyO1xuXG4vKiogVzNDIHBhcmVudC1pZC9zcGFuLWlkIGxlbmd0aCAoMTYgaGV4IGNoYXJzID0gOCBieXRlcykgKi9cbmNvbnN0IFczQ19QQVJFTlRfSURfTEVOR1RIID0gMTY7XG5cbi8qKlxuICogQ29uc2VydmF0aXZlIGNoYXJzZXQrbGVuZ3RoIGZvciBhIGNvcnJlbGF0aW9uL2NhdXNlZC1ieSBpZCByZWFkIGZyb20gYW5cbiAqIFVOVFJVU1RFRCBzb3VyY2UgKGluYm91bmQgSFRUUCBoZWFkZXIsIFNRUy9TTlMgYXR0cmlidXRlLCBldmVudCBwYXlsb2FkKS5cbiAqXG4gKiBTRUNVUklUWSAoUDApOiBhbiBpbmJvdW5kIGB4LWNvcnJlbGF0aW9uLWlkYCAvIGB4LWNhdXNlZC1ieWAgZmxvd3MgaW50byB0aGVcbiAqIEV4ZWN1dGlvbkNvbnRleHQgYW5kIGNhbiBiZSByZS1lbWl0dGVkIHZlcmJhdGltIG9uIG91dGJvdW5kIGhlYWRlcnNcbiAqIChgY3JlYXRlSHR0cEhlYWRlcnNgKSBhbmQgaW50byBzdHJ1Y3R1cmVkIGxvZ3MuIFdpdGhvdXQgYSBjaGFyc2V0IGd1YXJkIGFcbiAqIGNhbGxlciBjb3VsZCBpbmplY3QgQ1IvTEYgKG91dGJvdW5kLWhlYWRlciBzcGxpdHRpbmcgLyByZXF1ZXN0IHNtdWdnbGluZyDigJRcbiAqIGFuIGF2YWlsYWJpbGl0eSBidWcpIG9yIG5ld2xpbmVzL2NvbnRyb2wgY2hhcnMgKGxvZyBpbmplY3Rpb24gJiBhbXBsaWZpY2F0aW9uKS5cbiAqIFdlIHRoZXJlZm9yZSBhY2NlcHQgb25seSBgW0EtWmEtejAtOS5fLV1gLCBjYXBwZWQgYXQgMTI4IGNoYXJzIOKAlCBhIHN1cGVyc2V0IG9mXG4gKiBVVUlEcywgVzNDIGhleCB0cmFjZS1pZHMsIGFuZCBBV1MgcmVxdWVzdCBpZHMsIGJ1dCB3aXRoIG5vIGhlYWRlci9sb2ctYnJlYWtpbmdcbiAqIGNoYXJhY3RlcnMuIE9uIHZpb2xhdGlvbiB0aGUgdmFsdWUgaXMgZHJvcHBlZCBzbyB0aGUgZW50cnkgcG9pbnQgbWludHMgYSBmcmVzaFxuICogaWQgaW5zdGVhZCBvZiBwcm9wYWdhdGluZyB0aGUgcG9pc29uZWQgb25lLlxuICovXG5jb25zdCBTQUZFX1RSQUNFX0lEX1JFID0gL15bQS1aYS16MC05Ll8tXXsxLDEyOH0kLztcblxuLyoqXG4gKiBSZXR1cm4gYHZhbHVlYCBvbmx5IGlmIGl0IGlzIGEgc2FmZSB0cmFjZS9jb3JyZWxhdGlvbiBpZCAoc2VlXG4gKiB7QGxpbmsgU0FGRV9UUkFDRV9JRF9SRX0pOyBvdGhlcndpc2UgYHVuZGVmaW5lZGAuIFRyaW1zIGZpcnN0OyB0cmVhdHMgYmxhbmsgYXNcbiAqIGFic2VudC4gVXNlIGF0IGV2ZXJ5IFVOVFJVU1RFRCBleHRyYWN0aW9uIGJvdW5kYXJ5IHNvIG5vdGhpbmcgY2hhcnNldC11bnNhZmVcbiAqIGNhbiByZWFjaCBvdXRib3VuZCBoZWFkZXJzIG9yIGxvZ3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVRyYWNlSWQodmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIFNBRkVfVFJBQ0VfSURfUkUudGVzdCh0cmltbWVkKSA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFczQyBVdGlsaXRpZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDb252ZXJ0IFVVSUQvc3RyaW5nIHRvIHZhbGlkIFczQyB0cmFjZS1pZCAoMzIgaGV4IGNoYXJzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvVzNDVHJhY2VJZChpZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgaGV4ID0gaWQucmVwbGFjZSgvW15hLWZBLUYwLTldL2csICcnKS50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gaGV4Lmxlbmd0aCA+PSBXM0NfVFJBQ0VfSURfTEVOR1RIXG4gICAgPyBoZXguc3Vic3RyaW5nKDAsIFczQ19UUkFDRV9JRF9MRU5HVEgpXG4gICAgOiBoZXgucGFkRW5kKFczQ19UUkFDRV9JRF9MRU5HVEgsICcwJyk7XG59XG5cbi8qKlxuICogQ29udmVydCBVVUlEL3N0cmluZyB0byB2YWxpZCBXM0MgcGFyZW50LWlkICgxNiBoZXggY2hhcnMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XM0NQYXJlbnRJZChpZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgaGV4ID0gaWQucmVwbGFjZSgvW15hLWZBLUYwLTldL2csICcnKS50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gaGV4Lmxlbmd0aCA+PSBXM0NfUEFSRU5UX0lEX0xFTkdUSFxuICAgID8gaGV4LnN1YnN0cmluZygwLCBXM0NfUEFSRU5UX0lEX0xFTkdUSClcbiAgICA6IGhleC5wYWRFbmQoVzNDX1BBUkVOVF9JRF9MRU5HVEgsICcwJyk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRyYWNlIENvbnRleHQgRXh0cmFjdGlvbiAoSW5jb21pbmcpXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gSFRUUCBoZWFkZXJzLlxuICogUHJpb3JpdHk6IHgtY29ycmVsYXRpb24taWQgPiB0cmFjZXBhcmVudCAoVzNDKSA+IHgtYW16bi10cmFjZS1pZCAoWC1SYXkpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbUhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghaGVhZGVycykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBOb3JtYWxpemUgdG8gbG93ZXJjYXNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4gPSB7fTtcbiAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgIG5vcm1hbGl6ZWRbIGtleS50b0xvd2VyQ2FzZSgpIF0gPSB2YWx1ZTtcbiAgfVxuXG4gIC8vIDEuIEN1c3RvbSBjb3JyZWxhdGlvbiBJRCAoVU5UUlVTVEVEIOKAlCBzYW5pdGl6ZSBjaGFyc2V0K2xlbmd0aCBiZWZvcmUgdXNlKS5cbiAgLy8gQSBwb2lzb25lZCB2YWx1ZSBpcyBkcm9wcGVkIHNvIHRoZSBjYWxsZXIgbWludHMgYSBmcmVzaCBpZCByYXRoZXIgdGhhblxuICAvLyBwcm9wYWdhdGluZyBDUi9MRiBvciBjb250cm9sIGNoYXJzIHRvIG91dGJvdW5kIGhlYWRlcnMgLyBsb2dzLlxuICBjb25zdCBjdXN0b21JZCA9IHNhbml0aXplVHJhY2VJZChub3JtYWxpemVkWyAneC1jb3JyZWxhdGlvbi1pZCcgXSk7XG4gIGlmIChjdXN0b21JZCkge1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjdXN0b21JZCxcbiAgICAgIGNhdXNlZEJ5OiBzYW5pdGl6ZVRyYWNlSWQobm9ybWFsaXplZFsgJ3gtY2F1c2VkLWJ5JyBdKSxcbiAgICB9O1xuICB9XG5cbiAgLy8gMi4gVzNDIHRyYWNlcGFyZW50OiAwMC17dHJhY2UtaWR9LXtwYXJlbnQtaWR9LXtmbGFnc31cbiAgLy8gVGhlIHN0cmljdCBoZXggcmVnZXggYWxyZWFkeSBndWFyYW50ZWVzIGEgaGVhZGVyL2xvZy1zYWZlIHZhbHVlLlxuICBjb25zdCB0cmFjZXBhcmVudCA9IG5vcm1hbGl6ZWRbICd0cmFjZXBhcmVudCcgXTtcbiAgaWYgKHRyYWNlcGFyZW50ICYmIC9eWzAtOWEtZl17Mn0tWzAtOWEtZl17MzJ9LVswLTlhLWZdezE2fS1bMC05YS1mXXsyfSQvLnRlc3QodHJhY2VwYXJlbnQpKSB7XG4gICAgY29uc3QgcGFydHMgPSB0cmFjZXBhcmVudC5zcGxpdCgnLScpO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBwYXJ0c1sgMSBdLFxuICAgICAgc2FtcGxlZDogcGFydHNbIDMgXSA9PT0gJzAxJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gMy4gWC1SYXk6IFJvb3Q9MS17ZXBvY2h9LXt1bmlxdWV9O1BhcmVudD17aWR9O1NhbXBsZWQ9ezB8MX1cbiAgY29uc3QgeHJheSA9IG5vcm1hbGl6ZWRbICd4LWFtem4tdHJhY2UtaWQnIF07XG4gIGlmICh4cmF5ICYmIC9Sb290PTEtWzAtOWEtZl17OH0tWzAtOWEtZl17MjR9Ly50ZXN0KHhyYXkpKSB7XG4gICAgY29uc3Qgcm9vdE1hdGNoID0geHJheS5tYXRjaCgvUm9vdD0oW147XSspLyk7XG4gICAgY29uc3Qgc2FtcGxlZE1hdGNoID0geHJheS5tYXRjaCgvU2FtcGxlZD0oWzAxXSkvKTtcbiAgICBpZiAocm9vdE1hdGNoKSB7XG4gICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gc2FuaXRpemVUcmFjZUlkKHJvb3RNYXRjaFsgMSBdLnJlcGxhY2UoL14xLS8sICcnKS5yZXBsYWNlKC8tL2csICcnKSk7XG4gICAgICBpZiAoY29ycmVsYXRpb25JZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgc2FtcGxlZDogc2FtcGxlZE1hdGNoPy5bIDEgXSA9PT0gJzEnLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU1FTIG1lc3NhZ2UgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU3FzKFxuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgc3RyaW5nVmFsdWU/OiBzdHJpbmc7IFN0cmluZ1ZhbHVlPzogc3RyaW5nIH0+XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIW1lc3NhZ2VBdHRyaWJ1dGVzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIFgtUmF5IGhlYWRlclxuICBjb25zdCB4cmF5QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnQVdTVHJhY2VIZWFkZXInIF07XG4gIGNvbnN0IHhyYXkgPSB4cmF5QXR0cj8uc3RyaW5nVmFsdWUgfHwgeHJheUF0dHI/LlN0cmluZ1ZhbHVlO1xuICBpZiAoeHJheSAmJiAvUm9vdD0xLVswLTlhLWZdezh9LVswLTlhLWZdezI0fS8udGVzdCh4cmF5KSkge1xuICAgIGNvbnN0IHJvb3RNYXRjaCA9IHhyYXkubWF0Y2goL1Jvb3Q9KFteO10rKS8pO1xuICAgIGNvbnN0IHNhbXBsZWRNYXRjaCA9IHhyYXkubWF0Y2goL1NhbXBsZWQ9KFswMV0pLyk7XG4gICAgaWYgKHJvb3RNYXRjaCkge1xuICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHNhbml0aXplVHJhY2VJZChyb290TWF0Y2hbIDEgXS5yZXBsYWNlKC9eMS0vLCAnJykucmVwbGFjZSgvLS9nLCAnJykpO1xuICAgICAgaWYgKGNvcnJlbGF0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIHNhbXBsZWQ6IHNhbXBsZWRNYXRjaD8uWyAxIF0gPT09ICcxJyxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBDdXN0b20gYXR0cmlidXRlcyAoc2FuaXRpemUg4oCUIGEgcG9pc29uZWQgdXBzdHJlYW0gYXR0cmlidXRlIG11c3Qgbm90IHJlYWNoXG4gIC8vIG91dGJvdW5kIGhlYWRlcnMgb3IgbG9ncylcbiAgY29uc3QgY29ycmVsYXRpb25BdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjb3JyZWxhdGlvbklkJyBdO1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gc2FuaXRpemVUcmFjZUlkKGNvcnJlbGF0aW9uQXR0cj8uc3RyaW5nVmFsdWUgfHwgY29ycmVsYXRpb25BdHRyPy5TdHJpbmdWYWx1ZSk7XG4gIGlmIChjb3JyZWxhdGlvbklkKSB7XG4gICAgY29uc3Qgc2FtcGxlZEF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ3NhbXBsZWQnIF07XG4gICAgY29uc3QgY2F1c2VkQnlBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjYXVzZWRCeScgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIGNhdXNlZEJ5OiBzYW5pdGl6ZVRyYWNlSWQoY2F1c2VkQnlBdHRyPy5zdHJpbmdWYWx1ZSB8fCBjYXVzZWRCeUF0dHI/LlN0cmluZ1ZhbHVlKSxcbiAgICAgIHNhbXBsZWQ6IChzYW1wbGVkQXR0cj8uc3RyaW5nVmFsdWUgfHwgc2FtcGxlZEF0dHI/LlN0cmluZ1ZhbHVlKSA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIFNOUyBtZXNzYWdlIGF0dHJpYnV0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbVNucyhcbiAgbWVzc2FnZUF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7IFR5cGU/OiBzdHJpbmc7IFZhbHVlPzogc3RyaW5nIH0+XG4pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICBpZiAoIW1lc3NhZ2VBdHRyaWJ1dGVzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGNvcnJlbGF0aW9uQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnY29ycmVsYXRpb25JZCcgXTtcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IHNhbml0aXplVHJhY2VJZChjb3JyZWxhdGlvbkF0dHI/LlZhbHVlKTtcbiAgaWYgKGNvcnJlbGF0aW9uSWQpIHtcbiAgICBjb25zdCBzYW1wbGVkQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnc2FtcGxlZCcgXTtcbiAgICBjb25zdCBjYXVzZWRCeUF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ2NhdXNlZEJ5JyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnk6IHNhbml0aXplVHJhY2VJZChjYXVzZWRCeUF0dHI/LlZhbHVlKSxcbiAgICAgIHNhbXBsZWQ6IHNhbXBsZWRBdHRyPy5WYWx1ZSA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIGFuIFNRUyByZWNvcmQuXG4gKlxuICogU3VwcG9ydHMgYm90aDpcbiAqIC0gRGlyZWN0IFNRUyBzZW5kTWVzc2FnZSgpIHdpdGggTWVzc2FnZUF0dHJpYnV0ZXMgKHJlY29yZC5tZXNzYWdlQXR0cmlidXRlcylcbiAqIC0gU05TIC0+IFNRUyBzdWJzY3JpcHRpb24gZW52ZWxvcGUgd2hlcmUgU05TIE1lc3NhZ2VBdHRyaWJ1dGVzIGFyZSBwcmVzZW50IGluIHJlY29yZC5ib2R5Lk1lc3NhZ2VBdHRyaWJ1dGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbVNxc1JlY29yZChyZWNvcmQ6IHtcbiAgbWVzc2FnZUF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB7IHN0cmluZ1ZhbHVlPzogc3RyaW5nOyBTdHJpbmdWYWx1ZT86IHN0cmluZyB9PjtcbiAgYm9keT86IHN0cmluZztcbn0pOiBQYXJzZWRUcmFjZUNvbnRleHQgfCB1bmRlZmluZWQge1xuICAvLyAxKSBEaXJlY3QgU1FTIG1lc3NhZ2VBdHRyaWJ1dGVzXG4gIGNvbnN0IGZyb21TcXMgPSBleHRyYWN0RnJvbVNxcyhyZWNvcmQ/Lm1lc3NhZ2VBdHRyaWJ1dGVzKTtcbiAgaWYgKGZyb21TcXM/LmNvcnJlbGF0aW9uSWQpIHJldHVybiBmcm9tU3FzO1xuXG4gIC8vIDIpIFNOUyAtPiBTUVMgZW52ZWxvcGVcbiAgaWYgKHR5cGVvZiByZWNvcmQ/LmJvZHkgIT09ICdzdHJpbmcnIHx8ICFyZWNvcmQuYm9keSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgZW52ZWxvcGUgPSBwYXJzZVNuc1Nxc0VudmVsb3BlKHJlY29yZC5ib2R5KTtcbiAgaWYgKCFlbnZlbG9wZSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIGV4dHJhY3RGcm9tU25zKGVudmVsb3BlLk1lc3NhZ2VBdHRyaWJ1dGVzKTtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBFdmVudEJyaWRnZSBldmVudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tRXZlbnRCcmlkZ2UoXG4gIGV2ZW50OiB7IGRldGFpbD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IH1cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGRldGFpbCA9IGV2ZW50Py5kZXRhaWw7XG4gIGlmICghZGV0YWlsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIERpcmVjdCBmaWVsZHNcbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGRldGFpbFsgJ2NvcnJlbGF0aW9uSWQnIF0gfHwgZGV0YWlsWyAndHJhY2VJZCcgXTtcbiAgaWYgKHR5cGVvZiBjb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBjb3JyZWxhdGlvbklkLnRyaW0oKSkge1xuICAgIGNvbnN0IGNhdXNlZEJ5ID0gZGV0YWlsWyAnY2F1c2VkQnknIF07XG4gICAgY29uc3Qgc2FtcGxlZCA9IGRldGFpbFsgJ3NhbXBsZWQnIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQudHJpbSgpLFxuICAgICAgY2F1c2VkQnk6IHR5cGVvZiBjYXVzZWRCeSA9PT0gJ3N0cmluZycgPyBjYXVzZWRCeS50cmltKCkgOiB1bmRlZmluZWQsXG4gICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gTmVzdGVkIHRyYWNlQ29udGV4dCBvYmplY3RcbiAgY29uc3QgdHJhY2VDb250ZXh0ID0gZGV0YWlsWyAndHJhY2VDb250ZXh0JyBdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICBpZiAodHJhY2VDb250ZXh0ICYmIHR5cGVvZiB0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkIGFzIHN0cmluZykudHJpbSgpLFxuICAgICAgY2F1c2VkQnk6IHR5cGVvZiB0cmFjZUNvbnRleHQuY2F1c2VkQnkgPT09ICdzdHJpbmcnID8gKHRyYWNlQ29udGV4dC5jYXVzZWRCeSBhcyBzdHJpbmcpLnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgIHNhbXBsZWQ6IHR5cGVvZiB0cmFjZUNvbnRleHQuc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nXG4gICAgICAgID8gdHJhY2VDb250ZXh0LnNhbXBsZWRcbiAgICAgICAgOiB0cmFjZUNvbnRleHQuc2FtcGxlZCA9PT0gJ3RydWUnLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIFN0ZXAgRnVuY3Rpb25zIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21TdGVwRnVuY3Rpb25zKFxuICBpbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghaW5wdXQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gRGlyZWN0IGZpZWxkc1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW5wdXRbICdjb3JyZWxhdGlvbklkJyBdIHx8IGlucHV0WyAndHJhY2VJZCcgXTtcbiAgaWYgKHR5cGVvZiBjb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBjb3JyZWxhdGlvbklkLnRyaW0oKSkge1xuICAgIGNvbnN0IHNhbXBsZWQgPSBpbnB1dFsgJ3NhbXBsZWQnIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQudHJpbSgpLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5lc3RlZCB0cmFjZUNvbnRleHRcbiAgY29uc3QgdHJhY2VDb250ZXh0ID0gaW5wdXRbICd0cmFjZUNvbnRleHQnIF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGlmICh0cmFjZUNvbnRleHQgJiYgdHlwZW9mIHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiAodHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgYXMgc3RyaW5nKS50cmltKCksXG4gICAgICBzYW1wbGVkOiB0eXBlb2YgdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICdib29sZWFuJ1xuICAgICAgICA/IHRyYWNlQ29udGV4dC5zYW1wbGVkXG4gICAgICAgIDogdHJhY2VDb250ZXh0LnNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gQVdTIGV4ZWN1dGlvbiBjb250ZXh0XG4gIGNvbnN0IGF3c0NvbnRleHQgPSBpbnB1dFsgJ2F3cycgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKGF3c0NvbnRleHQ/LlsgJ2V4ZWN1dGlvbkFybicgXSAmJiB0eXBlb2YgYXdzQ29udGV4dFsgJ2V4ZWN1dGlvbkFybicgXSA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBhcm5QYXJ0cyA9IChhd3NDb250ZXh0WyAnZXhlY3V0aW9uQXJuJyBdIGFzIHN0cmluZykuc3BsaXQoJzonKTtcbiAgICByZXR1cm4geyBjb3JyZWxhdGlvbklkOiBhcm5QYXJ0c1sgYXJuUGFydHMubGVuZ3RoIC0gMSBdIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIEtpbmVzaXMgcmVjb3JkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21LaW5lc2lzKFxuICByZWNvcmQ6IHsga2luZXNpcz86IHsgZGF0YT86IHN0cmluZzsgcGFydGl0aW9uS2V5Pzogc3RyaW5nIH0gfVxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFyZWNvcmQ/LmtpbmVzaXM/LmRhdGEpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBkZWNvZGVkID0gQnVmZmVyLmZyb20ocmVjb3JkLmtpbmVzaXMuZGF0YSwgJ2Jhc2U2NCcpLnRvU3RyaW5nKCd1dGYtOCcpO1xuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGRlY29kZWQpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBkYXRhWyAnY29ycmVsYXRpb25JZCcgXSB8fCBkYXRhWyAndHJhY2VJZCcgXTtcbiAgICBpZiAodHlwZW9mIGNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIGNvcnJlbGF0aW9uSWQudHJpbSgpKSB7XG4gICAgICBjb25zdCBjYXVzZWRCeSA9IGRhdGFbICdjYXVzZWRCeScgXTtcbiAgICAgIGNvbnN0IHNhbXBsZWQgPSBkYXRhWyAnc2FtcGxlZCcgXTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvcnJlbGF0aW9uSWQudHJpbSgpLFxuICAgICAgICBjYXVzZWRCeTogdHlwZW9mIGNhdXNlZEJ5ID09PSAnc3RyaW5nJyA/IGNhdXNlZEJ5LnRyaW0oKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgICB9O1xuICAgIH1cbiAgfSBjYXRjaCB7XG4gICAgLy8gTm90IEpTT05cbiAgfVxuXG4gIC8vIEZhbGwgYmFjayB0byBwYXJ0aXRpb24ga2V5XG4gIGlmIChyZWNvcmQua2luZXNpcy5wYXJ0aXRpb25LZXkpIHtcbiAgICByZXR1cm4geyBjb3JyZWxhdGlvbklkOiByZWNvcmQua2luZXNpcy5wYXJ0aXRpb25LZXkgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFRyYWNlIENvbnRleHQgQ3JlYXRpb24gKE91dGdvaW5nKVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENyZWF0ZSBIVFRQIGhlYWRlcnMgZm9yIHRyYWNlIHByb3BhZ2F0aW9uIGluIG91dGdvaW5nIEhUVFAgcmVxdWVzdHMuXG4gKiBcbiAqIFJldHVybnMgaGVhZGVycyB0aGF0IGluY2x1ZGU6XG4gKiAtIGB4LWNvcnJlbGF0aW9uLWlkYDogQ3VzdG9tIGNvcnJlbGF0aW9uIElEIGZvciBhcHBsaWNhdGlvbi1sZXZlbCB0cmFjaW5nXG4gKiAtIGB0cmFjZXBhcmVudGA6IFczQyBUcmFjZSBDb250ZXh0IHN0YW5kYXJkIGhlYWRlciAoMDAte3RyYWNlLWlkfS17cGFyZW50LWlkfS17ZmxhZ3N9KVxuICogXG4gKiAjIyBVc2FnZSB3aXRoIGZldGNoL2F4aW9zXG4gKiBcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0LCBjcmVhdGVIdHRwSGVhZGVycyB9IGZyb20gJ0B0ZW4yNGdyb3VwL2Z3MjQnO1xuICogXG4gKiAvLyBPcHRpb24gMTogR2V0IGNvbnRleHQgYXV0b21hdGljYWxseSAocmVjb21tZW5kZWQpXG4gKiBhc3luYyBmdW5jdGlvbiBjYWxsRXh0ZXJuYWxTZXJ2aWNlKGRhdGE6IGFueSkge1xuICogICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICogICBjb25zdCB0cmFjZUhlYWRlcnMgPSBjdHggPyBjcmVhdGVIdHRwSGVhZGVycyhjdHgpIDoge307XG4gKiAgIFxuICogICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKCdodHRwczovL2FwaS5leGFtcGxlLmNvbS9lbmRwb2ludCcsIHtcbiAqICAgICBtZXRob2Q6ICdQT1NUJyxcbiAqICAgICBoZWFkZXJzOiB7XG4gKiAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICogICAgICAgLi4udHJhY2VIZWFkZXJzLCAgLy8gU3ByZWFkIHRyYWNlIGhlYWRlcnNcbiAqICAgICB9LFxuICogICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICogICB9KTtcbiAqICAgcmV0dXJuIHJlc3BvbnNlLmpzb24oKTtcbiAqIH1cbiAqIFxuICogLy8gT3B0aW9uIDI6IFdpdGggYXhpb3MgaW50ZXJjZXB0b3JcbiAqIGltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XG4gKiBcbiAqIGNvbnN0IGFwaUNsaWVudCA9IGF4aW9zLmNyZWF0ZSh7IGJhc2VVUkw6ICdodHRwczovL2FwaS5leGFtcGxlLmNvbScgfSk7XG4gKiBcbiAqIGFwaUNsaWVudC5pbnRlcmNlcHRvcnMucmVxdWVzdC51c2UoKGNvbmZpZykgPT4ge1xuICogICBjb25zdCBjdHggPSBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpO1xuICogICBpZiAoY3R4KSB7XG4gKiAgICAgY29uc3QgdHJhY2VIZWFkZXJzID0gY3JlYXRlSHR0cEhlYWRlcnMoY3R4KTtcbiAqICAgICBjb25maWcuaGVhZGVycyA9IHsgLi4uY29uZmlnLmhlYWRlcnMsIC4uLnRyYWNlSGVhZGVycyB9O1xuICogICB9XG4gKiAgIHJldHVybiBjb25maWc7XG4gKiB9KTtcbiAqIGBgYFxuICogXG4gKiAjIyBOb3RlIG9uIFczQyBUcmFjZSBDb250ZXh0XG4gKiBUaGUgYHRyYWNlcGFyZW50YCBoZWFkZXIgZm9sbG93cyB0aGUgVzNDIFRyYWNlIENvbnRleHQgc3BlY2lmaWNhdGlvbjpcbiAqIC0gRm9ybWF0OiBge3ZlcnNpb259LXt0cmFjZS1pZH0te3BhcmVudC1pZH0te2ZsYWdzfWBcbiAqIC0gRXhhbXBsZTogYDAwLTBhZjc2NTE5MTZjZDQzZGQ4NDQ4ZWIyMTFjODAzMTljLWI3YWQ2YjcxNjkyMDMzMzEtMDFgXG4gKiAtIGBmbGFnc2A6IGAwMWAgPSBzYW1wbGVkLCBgMDBgID0gbm90IHNhbXBsZWRcbiAqIFxuICogVGhpcyBlbmFibGVzIGludGVyb3BlcmFiaWxpdHkgd2l0aCBPcGVuVGVsZW1ldHJ5LCBKYWVnZXIsIFppcGtpbiwgYW5kIG90aGVyXG4gKiBkaXN0cmlidXRlZCB0cmFjaW5nIHN5c3RlbXMuXG4gKiBcbiAqIEBwYXJhbSBjdHggLSBUaGUgZXhlY3V0aW9uIGNvbnRleHQgdG8gcHJvcGFnYXRlXG4gKiBAcmV0dXJucyBIZWFkZXJzIG9iamVjdCB0byBzcHJlYWQgaW50byB5b3VyIEhUVFAgcmVxdWVzdFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSHR0cEhlYWRlcnMoY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YSk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICd4LWNvcnJlbGF0aW9uLWlkJzogY3R4LmNvcnJlbGF0aW9uSWQsXG4gIH07XG5cbiAgLy8gSU1QT1JUQU5UOiBXZSBkbyBOT1QgcHJvcGFnYXRlIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBhY3Jvc3MgaG9wcy5cbiAgLy8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGlzIFNUUklDVCBoaWVyYXJjaHkgd2l0aGluIGEgc2luZ2xlIHBlcnNpc3RlZCBzbGljZS5cblxuICAvLyBTZXQgY2F1c2VkQnkgdG8gQ1VSUkVOVCBjb3JyZWxhdGlvbklkIGZvciB0aGUgbmV4dCBob3BcbiAgLy8gVGhpcyBlbnN1cmVzIHRoZSBjaGFpbiBpcyBBIC0+IEIgLT4gQywgbm90IFJvb3QgLT4gQSwgUm9vdCAtPiBCLCBSb290IC0+IENcbiAgaGVhZGVyc1sgJ3gtY2F1c2VkLWJ5JyBdID0gY3R4LmNvcnJlbGF0aW9uSWQ7XG5cbiAgLy8gVzNDIHRyYWNlcGFyZW50XG4gIGNvbnN0IHNhbXBsZWRGbGFnID0gY3R4Lm9ic2VydmFiaWxpdHkuc2FtcGxlZCA/ICcwMScgOiAnMDAnO1xuICBjb25zdCB0cmFjZUlkID0gdG9XM0NUcmFjZUlkKGN0eC5jb3JyZWxhdGlvbklkKTtcbiAgLy8gV2UgY2Fubm90IHNhZmVseSBkZXJpdmUgYSByZW1vdGUgT1RFTCBwYXJlbnQgc3Bhbi1pZCBmcm9tIEZXMjQgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLlxuICAvLyBVc2UgYSBzdGFibGUgZmFsbGJhY2sgcGFyZW50LWlkIGRlcml2ZWQgZnJvbSBjb3JyZWxhdGlvbklkLlxuICBjb25zdCBwYXJlbnRJZCA9IHRvVzNDUGFyZW50SWQoY3R4LmNvcnJlbGF0aW9uSWQpO1xuICBoZWFkZXJzWyAndHJhY2VwYXJlbnQnIF0gPSBgMDAtJHt0cmFjZUlkfS0ke3BhcmVudElkfS0ke3NhbXBsZWRGbGFnfWA7XG5cbiAgcmV0dXJuIGhlYWRlcnM7XG59XG5cbi8qKlxuICogQ3JlYXRlIFNRUyBtZXNzYWdlIGF0dHJpYnV0ZXMgZm9yIHRyYWNlIHByb3BhZ2F0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3FzQXR0cmlidXRlcyhcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YVxuKTogUmVjb3JkPHN0cmluZywgeyBEYXRhVHlwZTogc3RyaW5nOyBTdHJpbmdWYWx1ZTogc3RyaW5nIH0+IHtcbiAgLy8gQUxXQVlTIHVzZSBjdXJyZW50IGNvcnJlbGF0aW9uSWQgYXMgY2F1c2VkQnkgZm9yIHRoZSBuZXh0IGhvcC5cbiAgLy8gVGhpcyBjcmVhdGVzIGEgcHJvcGVyIGNoYWluOiBBIOKGkiBCIOKGkiBDIChlYWNoIGhvcCBrbm93cyBpdHMgaW1tZWRpYXRlIGNhdXNlKVxuICBjb25zdCBjYXVzZWRCeSA9IGN0eC5jb3JyZWxhdGlvbklkO1xuXG4gIGNvbnN0IGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4gPSB7XG4gICAgY29ycmVsYXRpb25JZDogeyBEYXRhVHlwZTogJ1N0cmluZycsIFN0cmluZ1ZhbHVlOiBjdHguY29ycmVsYXRpb25JZCB9LFxuICAgIHNhbXBsZWQ6IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogU3RyaW5nKGN0eC5vYnNlcnZhYmlsaXR5LnNhbXBsZWQpIH0sXG4gICAgY2F1c2VkQnk6IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY2F1c2VkQnkgfSxcbiAgfTtcbiAgcmV0dXJuIGF0dHJzO1xufVxuXG4vKipcbiAqIENyZWF0ZSBTTlMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciB0cmFjZSBwcm9wYWdhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNuc0F0dHJpYnV0ZXMoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHsgRGF0YVR5cGU6IHN0cmluZzsgU3RyaW5nVmFsdWU6IHN0cmluZyB9PiB7XG4gIHJldHVybiBjcmVhdGVTcXNBdHRyaWJ1dGVzKGN0eCk7XG59XG5cbi8qKlxuICogQ3JlYXRlIHRyYWNlIGNvbnRleHQgZm9yIEV2ZW50QnJpZGdlIGV2ZW50IGRldGFpbC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUV2ZW50QnJpZGdlQ29udGV4dChcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YVxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4ge1xuICAvLyBBTFdBWVMgdXNlIGN1cnJlbnQgY29ycmVsYXRpb25JZCBhcyBjYXVzZWRCeSBmb3IgdGhlIG5leHQgaG9wLlxuICAvLyBUaGlzIGNyZWF0ZXMgYSBwcm9wZXIgY2hhaW46IEEg4oaSIEIg4oaSIEMgKGVhY2ggaG9wIGtub3dzIGl0cyBpbW1lZGlhdGUgY2F1c2UpXG5cbiAgY29uc3QgdHJhY2VDb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiA9IHtcbiAgICBjb3JyZWxhdGlvbklkOiBjdHguY29ycmVsYXRpb25JZCxcbiAgICBzYW1wbGVkOiBjdHgub2JzZXJ2YWJpbGl0eS5zYW1wbGVkLFxuICAgIGNhdXNlZEJ5OiBjdHguY29ycmVsYXRpb25JZCwgIC8vIFNlbmRlcidzIGNvcnJlbGF0aW9uSWQgPSByZWNlaXZlcidzIGNhdXNlZEJ5XG4gIH07XG4gIHJldHVybiB0cmFjZUNvbnRleHQ7XG59XG5cbi8qKlxuICogQ3JlYXRlIHRyYWNlIGNvbnRleHQgZm9yIFN0ZXAgRnVuY3Rpb25zIG91dHB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVN0ZXBGdW5jdGlvbnNDb250ZXh0KFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBib29sZWFuPiB7XG4gIHJldHVybiBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQoY3R4KTtcbn1cblxuIl19