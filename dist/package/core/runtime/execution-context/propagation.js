"use strict";
/**
 * Trace Context Propagation
 *
 * Extract trace context from incoming requests/messages.
 * Create propagation data for outgoing requests/messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLiteralEmptyValueToken = isLiteralEmptyValueToken;
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
 * Literal "empty value" tokens that are valid per {@link SAFE_TRACE_ID_RE} (they're
 * alphanumeric) but are never legitimate ids — they're what you get when an unset
 * JS value is stringified via a template literal (`` `${x.correlationId}` ``) or
 * `String(x)` instead of being guarded. Rejected case-insensitively as a
 * defense-in-depth backstop: the real fix is at the producer that stringified an
 * absent value in the first place, but this stops the bad token from silently
 * propagating (and being mistaken for a real trace) if a similar mistake happens
 * again anywhere upstream.
 */
const LITERAL_EMPTY_VALUE_TOKENS = new Set(['undefined', 'null', 'nan']);
/**
 * True if `trimmedValue` is one of the literal "empty value" tokens (see
 * {@link LITERAL_EMPTY_VALUE_TOKENS}). Exported so every extraction boundary —
 * not just the charset-guarded ones behind {@link sanitizeTraceId} — can reject
 * these tokens, since a producer stringifying an unset id can hit EventBridge
 * `detail`, Step Functions input, or Kinesis payloads just as easily as an HTTP
 * header or SQS/SNS attribute.
 */
function isLiteralEmptyValueToken(trimmedValue) {
    return LITERAL_EMPTY_VALUE_TOKENS.has(trimmedValue.toLowerCase());
}
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
    if (!SAFE_TRACE_ID_RE.test(trimmed))
        return undefined;
    if (isLiteralEmptyValueToken(trimmed))
        return undefined;
    return trimmed;
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
    if (typeof correlationId === 'string' && correlationId.trim() && !isLiteralEmptyValueToken(correlationId.trim())) {
        const causedBy = detail['causedBy'];
        const sampled = detail['sampled'];
        const trimmedCausedBy = typeof causedBy === 'string' ? causedBy.trim() : undefined;
        return {
            correlationId: correlationId.trim(),
            causedBy: trimmedCausedBy && !isLiteralEmptyValueToken(trimmedCausedBy) ? trimmedCausedBy : undefined,
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext object
    const traceContext = detail['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string' && traceContext.correlationId.trim() && !isLiteralEmptyValueToken(traceContext.correlationId.trim())) {
        const trimmedCausedBy = typeof traceContext.causedBy === 'string' ? traceContext.causedBy.trim() : undefined;
        return {
            correlationId: traceContext.correlationId.trim(),
            causedBy: trimmedCausedBy && !isLiteralEmptyValueToken(trimmedCausedBy) ? trimmedCausedBy : undefined,
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
    if (typeof correlationId === 'string' && correlationId.trim() && !isLiteralEmptyValueToken(correlationId.trim())) {
        const sampled = input['sampled'];
        return {
            correlationId: correlationId.trim(),
            sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
        };
    }
    // Nested traceContext
    const traceContext = input['traceContext'];
    if (traceContext && typeof traceContext.correlationId === 'string' && traceContext.correlationId.trim() && !isLiteralEmptyValueToken(traceContext.correlationId.trim())) {
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
        if (typeof correlationId === 'string' && correlationId.trim() && !isLiteralEmptyValueToken(correlationId.trim())) {
            const causedBy = data['causedBy'];
            const sampled = data['sampled'];
            const trimmedCausedBy = typeof causedBy === 'string' ? causedBy.trim() : undefined;
            return {
                correlationId: correlationId.trim(),
                causedBy: trimmedCausedBy && !isLiteralEmptyValueToken(trimmedCausedBy) ? trimmedCausedBy : undefined,
                sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
            };
        }
    }
    catch {
        // Not JSON
    }
    // Fall back to partition key
    if (record.kinesis.partitionKey && !isLiteralEmptyValueToken(record.kinesis.partitionKey.trim())) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvcGFnYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3Byb3BhZ2F0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFtREgsNERBRUM7QUFRRCwwQ0FNQztBQVNELG9DQUtDO0FBS0Qsc0NBS0M7QUFVRCxnREFrREM7QUFLRCx3Q0FxQ0M7QUFLRCx3Q0FrQkM7QUFTRCxvREFhQztBQUtELHdEQWlDQztBQUtELDREQWtDQztBQUtELGdEQTZCQztBQTZERCw4Q0FxQkM7QUFLRCxrREFhQztBQUtELGtEQUlDO0FBS0QsNERBWUM7QUFLRCxnRUFJQztBQWplRCwwREFBMEQ7QUFFMUQsK0VBQStFO0FBQy9FLFlBQVk7QUFDWiwrRUFBK0U7QUFFL0Usb0RBQW9EO0FBQ3BELE1BQU0sbUJBQW1CLEdBQUcsRUFBRSxDQUFDO0FBRS9CLDREQUE0RDtBQUM1RCxNQUFNLG9CQUFvQixHQUFHLEVBQUUsQ0FBQztBQUVoQzs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsTUFBTSxnQkFBZ0IsR0FBRyx5QkFBeUIsQ0FBQztBQUVuRDs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLDBCQUEwQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUUsQ0FBQyxDQUFDO0FBRTNFOzs7Ozs7O0dBT0c7QUFDSCxTQUFnQix3QkFBd0IsQ0FBQyxZQUFvQjtJQUMzRCxPQUFPLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNwRSxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFnQixlQUFlLENBQUMsS0FBZ0M7SUFDOUQsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFDaEQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLElB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LENBQUMsRUFBRTtRQUMvRSxRQUFRLEVBQUUsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUU7S0FDeEQsQ0FBQztJQUNGLE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsbUJBQW1CLENBQ2pDLEdBQXlCO0lBRXpCLE9BQU8sbUJBQW1CLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDbEMsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isd0JBQXdCLENBQ3RDLEdBQXlCO0lBRXpCLGlFQUFpRTtJQUNqRSw4RUFBOEU7SUFFOUUsTUFBTSxZQUFZLEdBQXFDO1FBQ3JELGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYTtRQUNoQyxPQUFPLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1FBQ2xDLFFBQVEsRUFBRSxHQUFHLENBQUMsYUFBYSxFQUFHLCtDQUErQztLQUM5RSxDQUFDO0lBQ0YsT0FBTyxZQUFZLENBQUM7QUFDdEIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsMEJBQTBCLENBQ3hDLEdBQXlCO0lBRXpCLE9BQU8sd0JBQXdCLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDdkMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVHJhY2UgQ29udGV4dCBQcm9wYWdhdGlvblxuICogXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBpbmNvbWluZyByZXF1ZXN0cy9tZXNzYWdlcy5cbiAqIENyZWF0ZSBwcm9wYWdhdGlvbiBkYXRhIGZvciBvdXRnb2luZyByZXF1ZXN0cy9tZXNzYWdlcy5cbiAqL1xuXG5pbXBvcnQgeyBFeGVjdXRpb25Db250ZXh0RGF0YSwgUGFyc2VkVHJhY2VDb250ZXh0IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBwYXJzZVNuc1Nxc0VudmVsb3BlIH0gZnJvbSAnLi4vc25zLXNxcy1lbnZlbG9wZSc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbnN0YW50c1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiogVzNDIHRyYWNlLWlkIGxlbmd0aCAoMzIgaGV4IGNoYXJzID0gMTYgYnl0ZXMpICovXG5jb25zdCBXM0NfVFJBQ0VfSURfTEVOR1RIID0gMzI7XG5cbi8qKiBXM0MgcGFyZW50LWlkL3NwYW4taWQgbGVuZ3RoICgxNiBoZXggY2hhcnMgPSA4IGJ5dGVzKSAqL1xuY29uc3QgVzNDX1BBUkVOVF9JRF9MRU5HVEggPSAxNjtcblxuLyoqXG4gKiBDb25zZXJ2YXRpdmUgY2hhcnNldCtsZW5ndGggZm9yIGEgY29ycmVsYXRpb24vY2F1c2VkLWJ5IGlkIHJlYWQgZnJvbSBhblxuICogVU5UUlVTVEVEIHNvdXJjZSAoaW5ib3VuZCBIVFRQIGhlYWRlciwgU1FTL1NOUyBhdHRyaWJ1dGUsIGV2ZW50IHBheWxvYWQpLlxuICpcbiAqIFNFQ1VSSVRZIChQMCk6IGFuIGluYm91bmQgYHgtY29ycmVsYXRpb24taWRgIC8gYHgtY2F1c2VkLWJ5YCBmbG93cyBpbnRvIHRoZVxuICogRXhlY3V0aW9uQ29udGV4dCBhbmQgY2FuIGJlIHJlLWVtaXR0ZWQgdmVyYmF0aW0gb24gb3V0Ym91bmQgaGVhZGVyc1xuICogKGBjcmVhdGVIdHRwSGVhZGVyc2ApIGFuZCBpbnRvIHN0cnVjdHVyZWQgbG9ncy4gV2l0aG91dCBhIGNoYXJzZXQgZ3VhcmQgYVxuICogY2FsbGVyIGNvdWxkIGluamVjdCBDUi9MRiAob3V0Ym91bmQtaGVhZGVyIHNwbGl0dGluZyAvIHJlcXVlc3Qgc211Z2dsaW5nIOKAlFxuICogYW4gYXZhaWxhYmlsaXR5IGJ1Zykgb3IgbmV3bGluZXMvY29udHJvbCBjaGFycyAobG9nIGluamVjdGlvbiAmIGFtcGxpZmljYXRpb24pLlxuICogV2UgdGhlcmVmb3JlIGFjY2VwdCBvbmx5IGBbQS1aYS16MC05Ll8tXWAsIGNhcHBlZCBhdCAxMjggY2hhcnMg4oCUIGEgc3VwZXJzZXQgb2ZcbiAqIFVVSURzLCBXM0MgaGV4IHRyYWNlLWlkcywgYW5kIEFXUyByZXF1ZXN0IGlkcywgYnV0IHdpdGggbm8gaGVhZGVyL2xvZy1icmVha2luZ1xuICogY2hhcmFjdGVycy4gT24gdmlvbGF0aW9uIHRoZSB2YWx1ZSBpcyBkcm9wcGVkIHNvIHRoZSBlbnRyeSBwb2ludCBtaW50cyBhIGZyZXNoXG4gKiBpZCBpbnN0ZWFkIG9mIHByb3BhZ2F0aW5nIHRoZSBwb2lzb25lZCBvbmUuXG4gKi9cbmNvbnN0IFNBRkVfVFJBQ0VfSURfUkUgPSAvXltBLVphLXowLTkuXy1dezEsMTI4fSQvO1xuXG4vKipcbiAqIExpdGVyYWwgXCJlbXB0eSB2YWx1ZVwiIHRva2VucyB0aGF0IGFyZSB2YWxpZCBwZXIge0BsaW5rIFNBRkVfVFJBQ0VfSURfUkV9ICh0aGV5J3JlXG4gKiBhbHBoYW51bWVyaWMpIGJ1dCBhcmUgbmV2ZXIgbGVnaXRpbWF0ZSBpZHMg4oCUIHRoZXkncmUgd2hhdCB5b3UgZ2V0IHdoZW4gYW4gdW5zZXRcbiAqIEpTIHZhbHVlIGlzIHN0cmluZ2lmaWVkIHZpYSBhIHRlbXBsYXRlIGxpdGVyYWwgKGBgIGAke3guY29ycmVsYXRpb25JZH1gIGBgKSBvclxuICogYFN0cmluZyh4KWAgaW5zdGVhZCBvZiBiZWluZyBndWFyZGVkLiBSZWplY3RlZCBjYXNlLWluc2Vuc2l0aXZlbHkgYXMgYVxuICogZGVmZW5zZS1pbi1kZXB0aCBiYWNrc3RvcDogdGhlIHJlYWwgZml4IGlzIGF0IHRoZSBwcm9kdWNlciB0aGF0IHN0cmluZ2lmaWVkIGFuXG4gKiBhYnNlbnQgdmFsdWUgaW4gdGhlIGZpcnN0IHBsYWNlLCBidXQgdGhpcyBzdG9wcyB0aGUgYmFkIHRva2VuIGZyb20gc2lsZW50bHlcbiAqIHByb3BhZ2F0aW5nIChhbmQgYmVpbmcgbWlzdGFrZW4gZm9yIGEgcmVhbCB0cmFjZSkgaWYgYSBzaW1pbGFyIG1pc3Rha2UgaGFwcGVuc1xuICogYWdhaW4gYW55d2hlcmUgdXBzdHJlYW0uXG4gKi9cbmNvbnN0IExJVEVSQUxfRU1QVFlfVkFMVUVfVE9LRU5TID0gbmV3IFNldChbICd1bmRlZmluZWQnLCAnbnVsbCcsICduYW4nIF0pO1xuXG4vKipcbiAqIFRydWUgaWYgYHRyaW1tZWRWYWx1ZWAgaXMgb25lIG9mIHRoZSBsaXRlcmFsIFwiZW1wdHkgdmFsdWVcIiB0b2tlbnMgKHNlZVxuICoge0BsaW5rIExJVEVSQUxfRU1QVFlfVkFMVUVfVE9LRU5TfSkuIEV4cG9ydGVkIHNvIGV2ZXJ5IGV4dHJhY3Rpb24gYm91bmRhcnkg4oCUXG4gKiBub3QganVzdCB0aGUgY2hhcnNldC1ndWFyZGVkIG9uZXMgYmVoaW5kIHtAbGluayBzYW5pdGl6ZVRyYWNlSWR9IOKAlCBjYW4gcmVqZWN0XG4gKiB0aGVzZSB0b2tlbnMsIHNpbmNlIGEgcHJvZHVjZXIgc3RyaW5naWZ5aW5nIGFuIHVuc2V0IGlkIGNhbiBoaXQgRXZlbnRCcmlkZ2VcbiAqIGBkZXRhaWxgLCBTdGVwIEZ1bmN0aW9ucyBpbnB1dCwgb3IgS2luZXNpcyBwYXlsb2FkcyBqdXN0IGFzIGVhc2lseSBhcyBhbiBIVFRQXG4gKiBoZWFkZXIgb3IgU1FTL1NOUyBhdHRyaWJ1dGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0xpdGVyYWxFbXB0eVZhbHVlVG9rZW4odHJpbW1lZFZhbHVlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIExJVEVSQUxfRU1QVFlfVkFMVUVfVE9LRU5TLmhhcyh0cmltbWVkVmFsdWUudG9Mb3dlckNhc2UoKSk7XG59XG5cbi8qKlxuICogUmV0dXJuIGB2YWx1ZWAgb25seSBpZiBpdCBpcyBhIHNhZmUgdHJhY2UvY29ycmVsYXRpb24gaWQgKHNlZVxuICoge0BsaW5rIFNBRkVfVFJBQ0VfSURfUkV9KTsgb3RoZXJ3aXNlIGB1bmRlZmluZWRgLiBUcmltcyBmaXJzdDsgdHJlYXRzIGJsYW5rIGFzXG4gKiBhYnNlbnQuIFVzZSBhdCBldmVyeSBVTlRSVVNURUQgZXh0cmFjdGlvbiBib3VuZGFyeSBzbyBub3RoaW5nIGNoYXJzZXQtdW5zYWZlXG4gKiBjYW4gcmVhY2ggb3V0Ym91bmQgaGVhZGVycyBvciBsb2dzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVUcmFjZUlkKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gIGlmICghU0FGRV9UUkFDRV9JRF9SRS50ZXN0KHRyaW1tZWQpKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAoaXNMaXRlcmFsRW1wdHlWYWx1ZVRva2VuKHRyaW1tZWQpKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVzNDIFV0aWxpdGllc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIENvbnZlcnQgVVVJRC9zdHJpbmcgdG8gdmFsaWQgVzNDIHRyYWNlLWlkICgzMiBoZXggY2hhcnMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XM0NUcmFjZUlkKGlkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBoZXggPSBpZC5yZXBsYWNlKC9bXmEtZkEtRjAtOV0vZywgJycpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBoZXgubGVuZ3RoID49IFczQ19UUkFDRV9JRF9MRU5HVEhcbiAgICA/IGhleC5zdWJzdHJpbmcoMCwgVzNDX1RSQUNFX0lEX0xFTkdUSClcbiAgICA6IGhleC5wYWRFbmQoVzNDX1RSQUNFX0lEX0xFTkdUSCwgJzAnKTtcbn1cblxuLyoqXG4gKiBDb252ZXJ0IFVVSUQvc3RyaW5nIHRvIHZhbGlkIFczQyBwYXJlbnQtaWQgKDE2IGhleCBjaGFycykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1czQ1BhcmVudElkKGlkOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBoZXggPSBpZC5yZXBsYWNlKC9bXmEtZkEtRjAtOV0vZywgJycpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBoZXgubGVuZ3RoID49IFczQ19QQVJFTlRfSURfTEVOR1RIXG4gICAgPyBoZXguc3Vic3RyaW5nKDAsIFczQ19QQVJFTlRfSURfTEVOR1RIKVxuICAgIDogaGV4LnBhZEVuZChXM0NfUEFSRU5UX0lEX0xFTkdUSCwgJzAnKTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVHJhY2UgQ29udGV4dCBFeHRyYWN0aW9uIChJbmNvbWluZylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBIVFRQIGhlYWRlcnMuXG4gKiBQcmlvcml0eTogeC1jb3JyZWxhdGlvbi1pZCA+IHRyYWNlcGFyZW50IChXM0MpID4geC1hbXpuLXRyYWNlLWlkIChYLVJheSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tSGVhZGVycyhcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPlxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFoZWFkZXJzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIE5vcm1hbGl6ZSB0byBsb3dlcmNhc2VcbiAgY29uc3Qgbm9ybWFsaXplZDogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPiA9IHt9O1xuICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpKSB7XG4gICAgbm9ybWFsaXplZFsga2V5LnRvTG93ZXJDYXNlKCkgXSA9IHZhbHVlO1xuICB9XG5cbiAgLy8gMS4gQ3VzdG9tIGNvcnJlbGF0aW9uIElEIChVTlRSVVNURUQg4oCUIHNhbml0aXplIGNoYXJzZXQrbGVuZ3RoIGJlZm9yZSB1c2UpLlxuICAvLyBBIHBvaXNvbmVkIHZhbHVlIGlzIGRyb3BwZWQgc28gdGhlIGNhbGxlciBtaW50cyBhIGZyZXNoIGlkIHJhdGhlciB0aGFuXG4gIC8vIHByb3BhZ2F0aW5nIENSL0xGIG9yIGNvbnRyb2wgY2hhcnMgdG8gb3V0Ym91bmQgaGVhZGVycyAvIGxvZ3MuXG4gIGNvbnN0IGN1c3RvbUlkID0gc2FuaXRpemVUcmFjZUlkKG5vcm1hbGl6ZWRbICd4LWNvcnJlbGF0aW9uLWlkJyBdKTtcbiAgaWYgKGN1c3RvbUlkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGN1c3RvbUlkLFxuICAgICAgY2F1c2VkQnk6IHNhbml0aXplVHJhY2VJZChub3JtYWxpemVkWyAneC1jYXVzZWQtYnknIF0pLFxuICAgIH07XG4gIH1cblxuICAvLyAyLiBXM0MgdHJhY2VwYXJlbnQ6IDAwLXt0cmFjZS1pZH0te3BhcmVudC1pZH0te2ZsYWdzfVxuICAvLyBUaGUgc3RyaWN0IGhleCByZWdleCBhbHJlYWR5IGd1YXJhbnRlZXMgYSBoZWFkZXIvbG9nLXNhZmUgdmFsdWUuXG4gIGNvbnN0IHRyYWNlcGFyZW50ID0gbm9ybWFsaXplZFsgJ3RyYWNlcGFyZW50JyBdO1xuICBpZiAodHJhY2VwYXJlbnQgJiYgL15bMC05YS1mXXsyfS1bMC05YS1mXXszMn0tWzAtOWEtZl17MTZ9LVswLTlhLWZdezJ9JC8udGVzdCh0cmFjZXBhcmVudCkpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHRyYWNlcGFyZW50LnNwbGl0KCctJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IHBhcnRzWyAxIF0sXG4gICAgICBzYW1wbGVkOiBwYXJ0c1sgMyBdID09PSAnMDEnLFxuICAgIH07XG4gIH1cblxuICAvLyAzLiBYLVJheTogUm9vdD0xLXtlcG9jaH0te3VuaXF1ZX07UGFyZW50PXtpZH07U2FtcGxlZD17MHwxfVxuICBjb25zdCB4cmF5ID0gbm9ybWFsaXplZFsgJ3gtYW16bi10cmFjZS1pZCcgXTtcbiAgaWYgKHhyYXkgJiYgL1Jvb3Q9MS1bMC05YS1mXXs4fS1bMC05YS1mXXsyNH0vLnRlc3QoeHJheSkpIHtcbiAgICBjb25zdCByb290TWF0Y2ggPSB4cmF5Lm1hdGNoKC9Sb290PShbXjtdKykvKTtcbiAgICBjb25zdCBzYW1wbGVkTWF0Y2ggPSB4cmF5Lm1hdGNoKC9TYW1wbGVkPShbMDFdKS8pO1xuICAgIGlmIChyb290TWF0Y2gpIHtcbiAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBzYW5pdGl6ZVRyYWNlSWQocm9vdE1hdGNoWyAxIF0ucmVwbGFjZSgvXjEtLywgJycpLnJlcGxhY2UoLy0vZywgJycpKTtcbiAgICAgIGlmIChjb3JyZWxhdGlvbklkKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBzYW1wbGVkOiBzYW1wbGVkTWF0Y2g/LlsgMSBdID09PSAnMScsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21TcXMoXG4gIG1lc3NhZ2VBdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgeyBzdHJpbmdWYWx1ZT86IHN0cmluZzsgU3RyaW5nVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gWC1SYXkgaGVhZGVyXG4gIGNvbnN0IHhyYXlBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdBV1NUcmFjZUhlYWRlcicgXTtcbiAgY29uc3QgeHJheSA9IHhyYXlBdHRyPy5zdHJpbmdWYWx1ZSB8fCB4cmF5QXR0cj8uU3RyaW5nVmFsdWU7XG4gIGlmICh4cmF5ICYmIC9Sb290PTEtWzAtOWEtZl17OH0tWzAtOWEtZl17MjR9Ly50ZXN0KHhyYXkpKSB7XG4gICAgY29uc3Qgcm9vdE1hdGNoID0geHJheS5tYXRjaCgvUm9vdD0oW147XSspLyk7XG4gICAgY29uc3Qgc2FtcGxlZE1hdGNoID0geHJheS5tYXRjaCgvU2FtcGxlZD0oWzAxXSkvKTtcbiAgICBpZiAocm9vdE1hdGNoKSB7XG4gICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gc2FuaXRpemVUcmFjZUlkKHJvb3RNYXRjaFsgMSBdLnJlcGxhY2UoL14xLS8sICcnKS5yZXBsYWNlKC8tL2csICcnKSk7XG4gICAgICBpZiAoY29ycmVsYXRpb25JZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgc2FtcGxlZDogc2FtcGxlZE1hdGNoPy5bIDEgXSA9PT0gJzEnLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEN1c3RvbSBhdHRyaWJ1dGVzIChzYW5pdGl6ZSDigJQgYSBwb2lzb25lZCB1cHN0cmVhbSBhdHRyaWJ1dGUgbXVzdCBub3QgcmVhY2hcbiAgLy8gb3V0Ym91bmQgaGVhZGVycyBvciBsb2dzKVxuICBjb25zdCBjb3JyZWxhdGlvbkF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ2NvcnJlbGF0aW9uSWQnIF07XG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBzYW5pdGl6ZVRyYWNlSWQoY29ycmVsYXRpb25BdHRyPy5zdHJpbmdWYWx1ZSB8fCBjb3JyZWxhdGlvbkF0dHI/LlN0cmluZ1ZhbHVlKTtcbiAgaWYgKGNvcnJlbGF0aW9uSWQpIHtcbiAgICBjb25zdCBzYW1wbGVkQXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnc2FtcGxlZCcgXTtcbiAgICBjb25zdCBjYXVzZWRCeUF0dHIgPSBtZXNzYWdlQXR0cmlidXRlc1sgJ2NhdXNlZEJ5JyBdO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgY2F1c2VkQnk6IHNhbml0aXplVHJhY2VJZChjYXVzZWRCeUF0dHI/LnN0cmluZ1ZhbHVlIHx8IGNhdXNlZEJ5QXR0cj8uU3RyaW5nVmFsdWUpLFxuICAgICAgc2FtcGxlZDogKHNhbXBsZWRBdHRyPy5zdHJpbmdWYWx1ZSB8fCBzYW1wbGVkQXR0cj8uU3RyaW5nVmFsdWUpID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU05TIG1lc3NhZ2UgYXR0cmlidXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU25zKFxuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgVHlwZT86IHN0cmluZzsgVmFsdWU/OiBzdHJpbmcgfT5cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghbWVzc2FnZUF0dHJpYnV0ZXMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgY29ycmVsYXRpb25BdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdjb3JyZWxhdGlvbklkJyBdO1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gc2FuaXRpemVUcmFjZUlkKGNvcnJlbGF0aW9uQXR0cj8uVmFsdWUpO1xuICBpZiAoY29ycmVsYXRpb25JZCkge1xuICAgIGNvbnN0IHNhbXBsZWRBdHRyID0gbWVzc2FnZUF0dHJpYnV0ZXNbICdzYW1wbGVkJyBdO1xuICAgIGNvbnN0IGNhdXNlZEJ5QXR0ciA9IG1lc3NhZ2VBdHRyaWJ1dGVzWyAnY2F1c2VkQnknIF07XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICBjYXVzZWRCeTogc2FuaXRpemVUcmFjZUlkKGNhdXNlZEJ5QXR0cj8uVmFsdWUpLFxuICAgICAgc2FtcGxlZDogc2FtcGxlZEF0dHI/LlZhbHVlID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gYW4gU1FTIHJlY29yZC5cbiAqXG4gKiBTdXBwb3J0cyBib3RoOlxuICogLSBEaXJlY3QgU1FTIHNlbmRNZXNzYWdlKCkgd2l0aCBNZXNzYWdlQXR0cmlidXRlcyAocmVjb3JkLm1lc3NhZ2VBdHRyaWJ1dGVzKVxuICogLSBTTlMgLT4gU1FTIHN1YnNjcmlwdGlvbiBlbnZlbG9wZSB3aGVyZSBTTlMgTWVzc2FnZUF0dHJpYnV0ZXMgYXJlIHByZXNlbnQgaW4gcmVjb3JkLmJvZHkuTWVzc2FnZUF0dHJpYnV0ZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tU3FzUmVjb3JkKHJlY29yZDoge1xuICBtZXNzYWdlQXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHsgc3RyaW5nVmFsdWU/OiBzdHJpbmc7IFN0cmluZ1ZhbHVlPzogc3RyaW5nIH0+O1xuICBib2R5Pzogc3RyaW5nO1xufSk6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIC8vIDEpIERpcmVjdCBTUVMgbWVzc2FnZUF0dHJpYnV0ZXNcbiAgY29uc3QgZnJvbVNxcyA9IGV4dHJhY3RGcm9tU3FzKHJlY29yZD8ubWVzc2FnZUF0dHJpYnV0ZXMpO1xuICBpZiAoZnJvbVNxcz8uY29ycmVsYXRpb25JZCkgcmV0dXJuIGZyb21TcXM7XG5cbiAgLy8gMikgU05TIC0+IFNRUyBlbnZlbG9wZVxuICBpZiAodHlwZW9mIHJlY29yZD8uYm9keSAhPT0gJ3N0cmluZycgfHwgIXJlY29yZC5ib2R5KSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBlbnZlbG9wZSA9IHBhcnNlU25zU3FzRW52ZWxvcGUocmVjb3JkLmJvZHkpO1xuICBpZiAoIWVudmVsb3BlKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gZXh0cmFjdEZyb21TbnMoZW52ZWxvcGUuTWVzc2FnZUF0dHJpYnV0ZXMpO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgdHJhY2UgY29udGV4dCBmcm9tIEV2ZW50QnJpZGdlIGV2ZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZyb21FdmVudEJyaWRnZShcbiAgZXZlbnQ6IHsgZGV0YWlsPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfVxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgZGV0YWlsID0gZXZlbnQ/LmRldGFpbDtcbiAgaWYgKCFkZXRhaWwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gRGlyZWN0IGZpZWxkc1xuICBjb25zdCBjb3JyZWxhdGlvbklkID0gZGV0YWlsWyAnY29ycmVsYXRpb25JZCcgXSB8fCBkZXRhaWxbICd0cmFjZUlkJyBdO1xuICBpZiAodHlwZW9mIGNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIGNvcnJlbGF0aW9uSWQudHJpbSgpICYmICFpc0xpdGVyYWxFbXB0eVZhbHVlVG9rZW4oY29ycmVsYXRpb25JZC50cmltKCkpKSB7XG4gICAgY29uc3QgY2F1c2VkQnkgPSBkZXRhaWxbICdjYXVzZWRCeScgXTtcbiAgICBjb25zdCBzYW1wbGVkID0gZGV0YWlsWyAnc2FtcGxlZCcgXTtcbiAgICBjb25zdCB0cmltbWVkQ2F1c2VkQnkgPSB0eXBlb2YgY2F1c2VkQnkgPT09ICdzdHJpbmcnID8gY2F1c2VkQnkudHJpbSgpIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiB7XG4gICAgICBjb3JyZWxhdGlvbklkOiBjb3JyZWxhdGlvbklkLnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiB0cmltbWVkQ2F1c2VkQnkgJiYgIWlzTGl0ZXJhbEVtcHR5VmFsdWVUb2tlbih0cmltbWVkQ2F1c2VkQnkpID8gdHJpbW1lZENhdXNlZEJ5IDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHNhbXBsZWQgPT09ICdib29sZWFuJyA/IHNhbXBsZWQgOiBzYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIE5lc3RlZCB0cmFjZUNvbnRleHQgb2JqZWN0XG4gIGNvbnN0IHRyYWNlQ29udGV4dCA9IGRldGFpbFsgJ3RyYWNlQ29udGV4dCcgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKHRyYWNlQ29udGV4dCAmJiB0eXBlb2YgdHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkLnRyaW0oKSAmJiAhaXNMaXRlcmFsRW1wdHlWYWx1ZVRva2VuKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkLnRyaW0oKSkpIHtcbiAgICBjb25zdCB0cmltbWVkQ2F1c2VkQnkgPSB0eXBlb2YgdHJhY2VDb250ZXh0LmNhdXNlZEJ5ID09PSAnc3RyaW5nJyA/ICh0cmFjZUNvbnRleHQuY2F1c2VkQnkgYXMgc3RyaW5nKS50cmltKCkgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICh0cmFjZUNvbnRleHQuY29ycmVsYXRpb25JZCBhcyBzdHJpbmcpLnRyaW0oKSxcbiAgICAgIGNhdXNlZEJ5OiB0cmltbWVkQ2F1c2VkQnkgJiYgIWlzTGl0ZXJhbEVtcHR5VmFsdWVUb2tlbih0cmltbWVkQ2F1c2VkQnkpID8gdHJpbW1lZENhdXNlZEJ5IDogdW5kZWZpbmVkLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAnYm9vbGVhbidcbiAgICAgICAgPyB0cmFjZUNvbnRleHQuc2FtcGxlZFxuICAgICAgICA6IHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXh0cmFjdCB0cmFjZSBjb250ZXh0IGZyb20gU3RlcCBGdW5jdGlvbnMgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0RnJvbVN0ZXBGdW5jdGlvbnMoXG4gIGlucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuKTogUGFyc2VkVHJhY2VDb250ZXh0IHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBEaXJlY3QgZmllbGRzXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBpbnB1dFsgJ2NvcnJlbGF0aW9uSWQnIF0gfHwgaW5wdXRbICd0cmFjZUlkJyBdO1xuICBpZiAodHlwZW9mIGNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIGNvcnJlbGF0aW9uSWQudHJpbSgpICYmICFpc0xpdGVyYWxFbXB0eVZhbHVlVG9rZW4oY29ycmVsYXRpb25JZC50cmltKCkpKSB7XG4gICAgY29uc3Qgc2FtcGxlZCA9IGlucHV0WyAnc2FtcGxlZCcgXTtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gTmVzdGVkIHRyYWNlQ29udGV4dFxuICBjb25zdCB0cmFjZUNvbnRleHQgPSBpbnB1dFsgJ3RyYWNlQ29udGV4dCcgXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKHRyYWNlQ29udGV4dCAmJiB0eXBlb2YgdHJhY2VDb250ZXh0LmNvcnJlbGF0aW9uSWQgPT09ICdzdHJpbmcnICYmIHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkLnRyaW0oKSAmJiAhaXNMaXRlcmFsRW1wdHlWYWx1ZVRva2VuKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkLnRyaW0oKSkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY29ycmVsYXRpb25JZDogKHRyYWNlQ29udGV4dC5jb3JyZWxhdGlvbklkIGFzIHN0cmluZykudHJpbSgpLFxuICAgICAgc2FtcGxlZDogdHlwZW9mIHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAnYm9vbGVhbidcbiAgICAgICAgPyB0cmFjZUNvbnRleHQuc2FtcGxlZFxuICAgICAgICA6IHRyYWNlQ29udGV4dC5zYW1wbGVkID09PSAndHJ1ZScsXG4gICAgfTtcbiAgfVxuXG4gIC8vIEFXUyBleGVjdXRpb24gY29udGV4dFxuICBjb25zdCBhd3NDb250ZXh0ID0gaW5wdXRbICdhd3MnIF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGlmIChhd3NDb250ZXh0Py5bICdleGVjdXRpb25Bcm4nIF0gJiYgdHlwZW9mIGF3c0NvbnRleHRbICdleGVjdXRpb25Bcm4nIF0gPT09ICdzdHJpbmcnKSB7XG4gICAgY29uc3QgYXJuUGFydHMgPSAoYXdzQ29udGV4dFsgJ2V4ZWN1dGlvbkFybicgXSBhcyBzdHJpbmcpLnNwbGl0KCc6Jyk7XG4gICAgcmV0dXJuIHsgY29ycmVsYXRpb25JZDogYXJuUGFydHNbIGFyblBhcnRzLmxlbmd0aCAtIDEgXSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IHRyYWNlIGNvbnRleHQgZnJvbSBLaW5lc2lzIHJlY29yZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGcm9tS2luZXNpcyhcbiAgcmVjb3JkOiB7IGtpbmVzaXM/OiB7IGRhdGE/OiBzdHJpbmc7IHBhcnRpdGlvbktleT86IHN0cmluZyB9IH1cbik6IFBhcnNlZFRyYWNlQ29udGV4dCB8IHVuZGVmaW5lZCB7XG4gIGlmICghcmVjb3JkPy5raW5lc2lzPy5kYXRhKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgZGVjb2RlZCA9IEJ1ZmZlci5mcm9tKHJlY29yZC5raW5lc2lzLmRhdGEsICdiYXNlNjQnKS50b1N0cmluZygndXRmLTgnKTtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShkZWNvZGVkKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZGF0YVsgJ2NvcnJlbGF0aW9uSWQnIF0gfHwgZGF0YVsgJ3RyYWNlSWQnIF07XG4gICAgaWYgKHR5cGVvZiBjb3JyZWxhdGlvbklkID09PSAnc3RyaW5nJyAmJiBjb3JyZWxhdGlvbklkLnRyaW0oKSAmJiAhaXNMaXRlcmFsRW1wdHlWYWx1ZVRva2VuKGNvcnJlbGF0aW9uSWQudHJpbSgpKSkge1xuICAgICAgY29uc3QgY2F1c2VkQnkgPSBkYXRhWyAnY2F1c2VkQnknIF07XG4gICAgICBjb25zdCBzYW1wbGVkID0gZGF0YVsgJ3NhbXBsZWQnIF07XG4gICAgICBjb25zdCB0cmltbWVkQ2F1c2VkQnkgPSB0eXBlb2YgY2F1c2VkQnkgPT09ICdzdHJpbmcnID8gY2F1c2VkQnkudHJpbSgpIDogdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29ycmVsYXRpb25JZC50cmltKCksXG4gICAgICAgIGNhdXNlZEJ5OiB0cmltbWVkQ2F1c2VkQnkgJiYgIWlzTGl0ZXJhbEVtcHR5VmFsdWVUb2tlbih0cmltbWVkQ2F1c2VkQnkpID8gdHJpbW1lZENhdXNlZEJ5IDogdW5kZWZpbmVkLFxuICAgICAgICBzYW1wbGVkOiB0eXBlb2Ygc2FtcGxlZCA9PT0gJ2Jvb2xlYW4nID8gc2FtcGxlZCA6IHNhbXBsZWQgPT09ICd0cnVlJyxcbiAgICAgIH07XG4gICAgfVxuICB9IGNhdGNoIHtcbiAgICAvLyBOb3QgSlNPTlxuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIHBhcnRpdGlvbiBrZXlcbiAgaWYgKHJlY29yZC5raW5lc2lzLnBhcnRpdGlvbktleSAmJiAhaXNMaXRlcmFsRW1wdHlWYWx1ZVRva2VuKHJlY29yZC5raW5lc2lzLnBhcnRpdGlvbktleS50cmltKCkpKSB7XG4gICAgcmV0dXJuIHsgY29ycmVsYXRpb25JZDogcmVjb3JkLmtpbmVzaXMucGFydGl0aW9uS2V5IH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUcmFjZSBDb250ZXh0IENyZWF0aW9uIChPdXRnb2luZylcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBDcmVhdGUgSFRUUCBoZWFkZXJzIGZvciB0cmFjZSBwcm9wYWdhdGlvbiBpbiBvdXRnb2luZyBIVFRQIHJlcXVlc3RzLlxuICogXG4gKiBSZXR1cm5zIGhlYWRlcnMgdGhhdCBpbmNsdWRlOlxuICogLSBgeC1jb3JyZWxhdGlvbi1pZGA6IEN1c3RvbSBjb3JyZWxhdGlvbiBJRCBmb3IgYXBwbGljYXRpb24tbGV2ZWwgdHJhY2luZ1xuICogLSBgdHJhY2VwYXJlbnRgOiBXM0MgVHJhY2UgQ29udGV4dCBzdGFuZGFyZCBoZWFkZXIgKDAwLXt0cmFjZS1pZH0te3BhcmVudC1pZH0te2ZsYWdzfSlcbiAqIFxuICogIyMgVXNhZ2Ugd2l0aCBmZXRjaC9heGlvc1xuICogXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCwgY3JlYXRlSHR0cEhlYWRlcnMgfSBmcm9tICdAdGVuMjRncm91cC9mdzI0JztcbiAqIFxuICogLy8gT3B0aW9uIDE6IEdldCBjb250ZXh0IGF1dG9tYXRpY2FsbHkgKHJlY29tbWVuZGVkKVxuICogYXN5bmMgZnVuY3Rpb24gY2FsbEV4dGVybmFsU2VydmljZShkYXRhOiBhbnkpIHtcbiAqICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAqICAgY29uc3QgdHJhY2VIZWFkZXJzID0gY3R4ID8gY3JlYXRlSHR0cEhlYWRlcnMoY3R4KSA6IHt9O1xuICogICBcbiAqICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCgnaHR0cHM6Ly9hcGkuZXhhbXBsZS5jb20vZW5kcG9pbnQnLCB7XG4gKiAgICAgbWV0aG9kOiAnUE9TVCcsXG4gKiAgICAgaGVhZGVyczoge1xuICogICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAqICAgICAgIC4uLnRyYWNlSGVhZGVycywgIC8vIFNwcmVhZCB0cmFjZSBoZWFkZXJzXG4gKiAgICAgfSxcbiAqICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAqICAgfSk7XG4gKiAgIHJldHVybiByZXNwb25zZS5qc29uKCk7XG4gKiB9XG4gKiBcbiAqIC8vIE9wdGlvbiAyOiBXaXRoIGF4aW9zIGludGVyY2VwdG9yXG4gKiBpbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnO1xuICogXG4gKiBjb25zdCBhcGlDbGllbnQgPSBheGlvcy5jcmVhdGUoeyBiYXNlVVJMOiAnaHR0cHM6Ly9hcGkuZXhhbXBsZS5jb20nIH0pO1xuICogXG4gKiBhcGlDbGllbnQuaW50ZXJjZXB0b3JzLnJlcXVlc3QudXNlKChjb25maWcpID0+IHtcbiAqICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAqICAgaWYgKGN0eCkge1xuICogICAgIGNvbnN0IHRyYWNlSGVhZGVycyA9IGNyZWF0ZUh0dHBIZWFkZXJzKGN0eCk7XG4gKiAgICAgY29uZmlnLmhlYWRlcnMgPSB7IC4uLmNvbmZpZy5oZWFkZXJzLCAuLi50cmFjZUhlYWRlcnMgfTtcbiAqICAgfVxuICogICByZXR1cm4gY29uZmlnO1xuICogfSk7XG4gKiBgYGBcbiAqIFxuICogIyMgTm90ZSBvbiBXM0MgVHJhY2UgQ29udGV4dFxuICogVGhlIGB0cmFjZXBhcmVudGAgaGVhZGVyIGZvbGxvd3MgdGhlIFczQyBUcmFjZSBDb250ZXh0IHNwZWNpZmljYXRpb246XG4gKiAtIEZvcm1hdDogYHt2ZXJzaW9ufS17dHJhY2UtaWR9LXtwYXJlbnQtaWR9LXtmbGFnc31gXG4gKiAtIEV4YW1wbGU6IGAwMC0wYWY3NjUxOTE2Y2Q0M2RkODQ0OGViMjExYzgwMzE5Yy1iN2FkNmI3MTY5MjAzMzMxLTAxYFxuICogLSBgZmxhZ3NgOiBgMDFgID0gc2FtcGxlZCwgYDAwYCA9IG5vdCBzYW1wbGVkXG4gKiBcbiAqIFRoaXMgZW5hYmxlcyBpbnRlcm9wZXJhYmlsaXR5IHdpdGggT3BlblRlbGVtZXRyeSwgSmFlZ2VyLCBaaXBraW4sIGFuZCBvdGhlclxuICogZGlzdHJpYnV0ZWQgdHJhY2luZyBzeXN0ZW1zLlxuICogXG4gKiBAcGFyYW0gY3R4IC0gVGhlIGV4ZWN1dGlvbiBjb250ZXh0IHRvIHByb3BhZ2F0ZVxuICogQHJldHVybnMgSGVhZGVycyBvYmplY3QgdG8gc3ByZWFkIGludG8geW91ciBIVFRQIHJlcXVlc3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUh0dHBIZWFkZXJzKGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGEpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAneC1jb3JyZWxhdGlvbi1pZCc6IGN0eC5jb3JyZWxhdGlvbklkLFxuICB9O1xuXG4gIC8vIElNUE9SVEFOVDogV2UgZG8gTk9UIHByb3BhZ2F0ZSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgYWNyb3NzIGhvcHMuXG4gIC8vIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpcyBTVFJJQ1QgaGllcmFyY2h5IHdpdGhpbiBhIHNpbmdsZSBwZXJzaXN0ZWQgc2xpY2UuXG5cbiAgLy8gU2V0IGNhdXNlZEJ5IHRvIENVUlJFTlQgY29ycmVsYXRpb25JZCBmb3IgdGhlIG5leHQgaG9wXG4gIC8vIFRoaXMgZW5zdXJlcyB0aGUgY2hhaW4gaXMgQSAtPiBCIC0+IEMsIG5vdCBSb290IC0+IEEsIFJvb3QgLT4gQiwgUm9vdCAtPiBDXG4gIGhlYWRlcnNbICd4LWNhdXNlZC1ieScgXSA9IGN0eC5jb3JyZWxhdGlvbklkO1xuXG4gIC8vIFczQyB0cmFjZXBhcmVudFxuICBjb25zdCBzYW1wbGVkRmxhZyA9IGN0eC5vYnNlcnZhYmlsaXR5LnNhbXBsZWQgPyAnMDEnIDogJzAwJztcbiAgY29uc3QgdHJhY2VJZCA9IHRvVzNDVHJhY2VJZChjdHguY29ycmVsYXRpb25JZCk7XG4gIC8vIFdlIGNhbm5vdCBzYWZlbHkgZGVyaXZlIGEgcmVtb3RlIE9URUwgcGFyZW50IHNwYW4taWQgZnJvbSBGVzI0IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZC5cbiAgLy8gVXNlIGEgc3RhYmxlIGZhbGxiYWNrIHBhcmVudC1pZCBkZXJpdmVkIGZyb20gY29ycmVsYXRpb25JZC5cbiAgY29uc3QgcGFyZW50SWQgPSB0b1czQ1BhcmVudElkKGN0eC5jb3JyZWxhdGlvbklkKTtcbiAgaGVhZGVyc1sgJ3RyYWNlcGFyZW50JyBdID0gYDAwLSR7dHJhY2VJZH0tJHtwYXJlbnRJZH0tJHtzYW1wbGVkRmxhZ31gO1xuXG4gIHJldHVybiBoZWFkZXJzO1xufVxuXG4vKipcbiAqIENyZWF0ZSBTUVMgbWVzc2FnZSBhdHRyaWJ1dGVzIGZvciB0cmFjZSBwcm9wYWdhdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVNxc0F0dHJpYnV0ZXMoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHsgRGF0YVR5cGU6IHN0cmluZzsgU3RyaW5nVmFsdWU6IHN0cmluZyB9PiB7XG4gIC8vIEFMV0FZUyB1c2UgY3VycmVudCBjb3JyZWxhdGlvbklkIGFzIGNhdXNlZEJ5IGZvciB0aGUgbmV4dCBob3AuXG4gIC8vIFRoaXMgY3JlYXRlcyBhIHByb3BlciBjaGFpbjogQSDihpIgQiDihpIgQyAoZWFjaCBob3Aga25vd3MgaXRzIGltbWVkaWF0ZSBjYXVzZSlcbiAgY29uc3QgY2F1c2VkQnkgPSBjdHguY29ycmVsYXRpb25JZDtcblxuICBjb25zdCBhdHRyczogUmVjb3JkPHN0cmluZywgeyBEYXRhVHlwZTogc3RyaW5nOyBTdHJpbmdWYWx1ZTogc3RyaW5nIH0+ID0ge1xuICAgIGNvcnJlbGF0aW9uSWQ6IHsgRGF0YVR5cGU6ICdTdHJpbmcnLCBTdHJpbmdWYWx1ZTogY3R4LmNvcnJlbGF0aW9uSWQgfSxcbiAgICBzYW1wbGVkOiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IFN0cmluZyhjdHgub2JzZXJ2YWJpbGl0eS5zYW1wbGVkKSB9LFxuICAgIGNhdXNlZEJ5OiB7IERhdGFUeXBlOiAnU3RyaW5nJywgU3RyaW5nVmFsdWU6IGNhdXNlZEJ5IH0sXG4gIH07XG4gIHJldHVybiBhdHRycztcbn1cblxuLyoqXG4gKiBDcmVhdGUgU05TIG1lc3NhZ2UgYXR0cmlidXRlcyBmb3IgdHJhY2UgcHJvcGFnYXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTbnNBdHRyaWJ1dGVzKFxuICBjdHg6IEV4ZWN1dGlvbkNvbnRleHREYXRhXG4pOiBSZWNvcmQ8c3RyaW5nLCB7IERhdGFUeXBlOiBzdHJpbmc7IFN0cmluZ1ZhbHVlOiBzdHJpbmcgfT4ge1xuICByZXR1cm4gY3JlYXRlU3FzQXR0cmlidXRlcyhjdHgpO1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBFdmVudEJyaWRnZSBldmVudCBkZXRhaWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFdmVudEJyaWRnZUNvbnRleHQoXG4gIGN0eDogRXhlY3V0aW9uQ29udGV4dERhdGFcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IGJvb2xlYW4+IHtcbiAgLy8gQUxXQVlTIHVzZSBjdXJyZW50IGNvcnJlbGF0aW9uSWQgYXMgY2F1c2VkQnkgZm9yIHRoZSBuZXh0IGhvcC5cbiAgLy8gVGhpcyBjcmVhdGVzIGEgcHJvcGVyIGNoYWluOiBBIOKGkiBCIOKGkiBDIChlYWNoIGhvcCBrbm93cyBpdHMgaW1tZWRpYXRlIGNhdXNlKVxuXG4gIGNvbnN0IHRyYWNlQ29udGV4dDogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4gPSB7XG4gICAgY29ycmVsYXRpb25JZDogY3R4LmNvcnJlbGF0aW9uSWQsXG4gICAgc2FtcGxlZDogY3R4Lm9ic2VydmFiaWxpdHkuc2FtcGxlZCxcbiAgICBjYXVzZWRCeTogY3R4LmNvcnJlbGF0aW9uSWQsICAvLyBTZW5kZXIncyBjb3JyZWxhdGlvbklkID0gcmVjZWl2ZXIncyBjYXVzZWRCeVxuICB9O1xuICByZXR1cm4gdHJhY2VDb250ZXh0O1xufVxuXG4vKipcbiAqIENyZWF0ZSB0cmFjZSBjb250ZXh0IGZvciBTdGVwIEZ1bmN0aW9ucyBvdXRwdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVTdGVwRnVuY3Rpb25zQ29udGV4dChcbiAgY3R4OiBFeGVjdXRpb25Db250ZXh0RGF0YVxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgYm9vbGVhbj4ge1xuICByZXR1cm4gY3JlYXRlRXZlbnRCcmlkZ2VDb250ZXh0KGN0eCk7XG59XG5cbiJdfQ==