/**
 * Trace Context Propagation
 * 
 * Extract trace context from incoming requests/messages.
 * Create propagation data for outgoing requests/messages.
 */

import { ExecutionContextData, ParsedTraceContext } from './types';
import { parseSnsSqsEnvelope } from '../sns-sqs-envelope';

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
const LITERAL_EMPTY_VALUE_TOKENS = new Set([ 'undefined', 'null', 'nan' ]);

/**
 * True if `trimmedValue` is one of the literal "empty value" tokens (see
 * {@link LITERAL_EMPTY_VALUE_TOKENS}). Exported so every extraction boundary —
 * not just the charset-guarded ones behind {@link sanitizeTraceId} — can reject
 * these tokens, since a producer stringifying an unset id can hit EventBridge
 * `detail`, Step Functions input, or Kinesis payloads just as easily as an HTTP
 * header or SQS/SNS attribute.
 */
export function isLiteralEmptyValueToken(trimmedValue: string): boolean {
  return LITERAL_EMPTY_VALUE_TOKENS.has(trimmedValue.toLowerCase());
}

/**
 * Return `value` only if it is a safe trace/correlation id (see
 * {@link SAFE_TRACE_ID_RE}); otherwise `undefined`. Trims first; treats blank as
 * absent. Use at every UNTRUSTED extraction boundary so nothing charset-unsafe
 * can reach outbound headers or logs.
 */
export function sanitizeTraceId(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!SAFE_TRACE_ID_RE.test(trimmed)) return undefined;
  if (isLiteralEmptyValueToken(trimmed)) return undefined;
  return trimmed;
}

// ============================================================================
// W3C Utilities
// ============================================================================

/**
 * Convert UUID/string to valid W3C trace-id (32 hex chars).
 */
export function toW3CTraceId(id: string): string {
  const hex = id.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return hex.length >= W3C_TRACE_ID_LENGTH
    ? hex.substring(0, W3C_TRACE_ID_LENGTH)
    : hex.padEnd(W3C_TRACE_ID_LENGTH, '0');
}

/**
 * Convert UUID/string to valid W3C parent-id (16 hex chars).
 */
export function toW3CParentId(id: string): string {
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
export function extractFromHeaders(
  headers: Record<string, string | undefined>
): ParsedTraceContext | undefined {
  if (!headers) return undefined;

  // Normalize to lowercase
  const normalized: Record<string, string | undefined> = {};
  for (const [ key, value ] of Object.entries(headers)) {
    normalized[ key.toLowerCase() ] = value;
  }

  // 1. Custom correlation ID (UNTRUSTED — sanitize charset+length before use).
  // A poisoned value is dropped so the caller mints a fresh id rather than
  // propagating CR/LF or control chars to outbound headers / logs.
  const customId = sanitizeTraceId(normalized[ 'x-correlation-id' ]);
  if (customId) {
    return {
      correlationId: customId,
      causedBy: sanitizeTraceId(normalized[ 'x-caused-by' ]),
    };
  }

  // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
  // The strict hex regex already guarantees a header/log-safe value.
  const traceparent = normalized[ 'traceparent' ];
  if (traceparent && /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
    const parts = traceparent.split('-');
    return {
      correlationId: parts[ 1 ],
      sampled: parts[ 3 ] === '01',
    };
  }

  // 3. X-Ray: Root=1-{epoch}-{unique};Parent={id};Sampled={0|1}
  const xray = normalized[ 'x-amzn-trace-id' ];
  if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
    const rootMatch = xray.match(/Root=([^;]+)/);
    const sampledMatch = xray.match(/Sampled=([01])/);
    if (rootMatch) {
      const correlationId = sanitizeTraceId(rootMatch[ 1 ].replace(/^1-/, '').replace(/-/g, ''));
      if (correlationId) {
        return {
          correlationId,
          sampled: sampledMatch?.[ 1 ] === '1',
        };
      }
    }
  }

  return undefined;
}

/**
 * Extract trace context from SQS message attributes.
 */
export function extractFromSqs(
  messageAttributes?: Record<string, { stringValue?: string; StringValue?: string }>
): ParsedTraceContext | undefined {
  if (!messageAttributes) return undefined;

  // X-Ray header
  const xrayAttr = messageAttributes[ 'AWSTraceHeader' ];
  const xray = xrayAttr?.stringValue || xrayAttr?.StringValue;
  if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
    const rootMatch = xray.match(/Root=([^;]+)/);
    const sampledMatch = xray.match(/Sampled=([01])/);
    if (rootMatch) {
      const correlationId = sanitizeTraceId(rootMatch[ 1 ].replace(/^1-/, '').replace(/-/g, ''));
      if (correlationId) {
        return {
          correlationId,
          sampled: sampledMatch?.[ 1 ] === '1',
        };
      }
    }
  }

  // Custom attributes (sanitize — a poisoned upstream attribute must not reach
  // outbound headers or logs)
  const correlationAttr = messageAttributes[ 'correlationId' ];
  const correlationId = sanitizeTraceId(correlationAttr?.stringValue || correlationAttr?.StringValue);
  if (correlationId) {
    const sampledAttr = messageAttributes[ 'sampled' ];
    const causedByAttr = messageAttributes[ 'causedBy' ];
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
export function extractFromSns(
  messageAttributes?: Record<string, { Type?: string; Value?: string }>
): ParsedTraceContext | undefined {
  if (!messageAttributes) return undefined;

  const correlationAttr = messageAttributes[ 'correlationId' ];
  const correlationId = sanitizeTraceId(correlationAttr?.Value);
  if (correlationId) {
    const sampledAttr = messageAttributes[ 'sampled' ];
    const causedByAttr = messageAttributes[ 'causedBy' ];
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
export function extractFromSqsRecord(record: {
  messageAttributes?: Record<string, { stringValue?: string; StringValue?: string }>;
  body?: string;
}): ParsedTraceContext | undefined {
  // 1) Direct SQS messageAttributes
  const fromSqs = extractFromSqs(record?.messageAttributes);
  if (fromSqs?.correlationId) return fromSqs;

  // 2) SNS -> SQS envelope
  if (typeof record?.body !== 'string' || !record.body) return undefined;
  const envelope = parseSnsSqsEnvelope(record.body);
  if (!envelope) return undefined;
  return extractFromSns(envelope.MessageAttributes);
}

/**
 * Extract trace context from EventBridge event.
 */
export function extractFromEventBridge(
  event: { detail?: Record<string, unknown> }
): ParsedTraceContext | undefined {
  const detail = event?.detail;
  if (!detail) return undefined;

  // Direct fields
  const correlationId = detail[ 'correlationId' ] || detail[ 'traceId' ];
  if (typeof correlationId === 'string' && correlationId.trim() && !isLiteralEmptyValueToken(correlationId.trim())) {
    const causedBy = detail[ 'causedBy' ];
    const sampled = detail[ 'sampled' ];
    const trimmedCausedBy = typeof causedBy === 'string' ? causedBy.trim() : undefined;
    return {
      correlationId: correlationId.trim(),
      causedBy: trimmedCausedBy && !isLiteralEmptyValueToken(trimmedCausedBy) ? trimmedCausedBy : undefined,
      sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
    };
  }

  // Nested traceContext object
  const traceContext = detail[ 'traceContext' ] as Record<string, unknown> | undefined;
  if (traceContext && typeof traceContext.correlationId === 'string' && traceContext.correlationId.trim() && !isLiteralEmptyValueToken(traceContext.correlationId.trim())) {
    const trimmedCausedBy = typeof traceContext.causedBy === 'string' ? (traceContext.causedBy as string).trim() : undefined;
    return {
      correlationId: (traceContext.correlationId as string).trim(),
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
export function extractFromStepFunctions(
  input: Record<string, unknown>
): ParsedTraceContext | undefined {
  if (!input) return undefined;

  // Direct fields
  const correlationId = input[ 'correlationId' ] || input[ 'traceId' ];
  if (typeof correlationId === 'string' && correlationId.trim() && !isLiteralEmptyValueToken(correlationId.trim())) {
    const sampled = input[ 'sampled' ];
    return {
      correlationId: correlationId.trim(),
      sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
    };
  }

  // Nested traceContext
  const traceContext = input[ 'traceContext' ] as Record<string, unknown> | undefined;
  if (traceContext && typeof traceContext.correlationId === 'string' && traceContext.correlationId.trim() && !isLiteralEmptyValueToken(traceContext.correlationId.trim())) {
    return {
      correlationId: (traceContext.correlationId as string).trim(),
      sampled: typeof traceContext.sampled === 'boolean'
        ? traceContext.sampled
        : traceContext.sampled === 'true',
    };
  }

  // AWS execution context
  const awsContext = input[ 'aws' ] as Record<string, unknown> | undefined;
  if (awsContext?.[ 'executionArn' ] && typeof awsContext[ 'executionArn' ] === 'string') {
    const arnParts = (awsContext[ 'executionArn' ] as string).split(':');
    return { correlationId: arnParts[ arnParts.length - 1 ] };
  }

  return undefined;
}

/**
 * Extract trace context from Kinesis record.
 */
export function extractFromKinesis(
  record: { kinesis?: { data?: string; partitionKey?: string } }
): ParsedTraceContext | undefined {
  if (!record?.kinesis?.data) return undefined;

  try {
    const decoded = Buffer.from(record.kinesis.data, 'base64').toString('utf-8');
    const data = JSON.parse(decoded) as Record<string, unknown>;
    const correlationId = data[ 'correlationId' ] || data[ 'traceId' ];
    if (typeof correlationId === 'string' && correlationId.trim() && !isLiteralEmptyValueToken(correlationId.trim())) {
      const causedBy = data[ 'causedBy' ];
      const sampled = data[ 'sampled' ];
      const trimmedCausedBy = typeof causedBy === 'string' ? causedBy.trim() : undefined;
      return {
        correlationId: correlationId.trim(),
        causedBy: trimmedCausedBy && !isLiteralEmptyValueToken(trimmedCausedBy) ? trimmedCausedBy : undefined,
        sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
      };
    }
  } catch {
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
export function createHttpHeaders(ctx: ExecutionContextData): Record<string, string> {
  const headers: Record<string, string> = {
    'x-correlation-id': ctx.correlationId,
  };

  // IMPORTANT: We do NOT propagate parentObservabilityLogId across hops.
  // parentObservabilityLogId is STRICT hierarchy within a single persisted slice.

  // Set causedBy to CURRENT correlationId for the next hop
  // This ensures the chain is A -> B -> C, not Root -> A, Root -> B, Root -> C
  headers[ 'x-caused-by' ] = ctx.correlationId;

  // W3C traceparent
  const sampledFlag = ctx.observability.sampled ? '01' : '00';
  const traceId = toW3CTraceId(ctx.correlationId);
  // We cannot safely derive a remote OTEL parent span-id from FW24 parentObservabilityLogId.
  // Use a stable fallback parent-id derived from correlationId.
  const parentId = toW3CParentId(ctx.correlationId);
  headers[ 'traceparent' ] = `00-${traceId}-${parentId}-${sampledFlag}`;

  return headers;
}

/**
 * Create SQS message attributes for trace propagation.
 */
export function createSqsAttributes(
  ctx: ExecutionContextData
): Record<string, { DataType: string; StringValue: string }> {
  // ALWAYS use current correlationId as causedBy for the next hop.
  // This creates a proper chain: A → B → C (each hop knows its immediate cause)
  const causedBy = ctx.correlationId;

  const attrs: Record<string, { DataType: string; StringValue: string }> = {
    correlationId: { DataType: 'String', StringValue: ctx.correlationId },
    sampled: { DataType: 'String', StringValue: String(ctx.observability.sampled) },
    causedBy: { DataType: 'String', StringValue: causedBy },
  };
  return attrs;
}

/**
 * Create SNS message attributes for trace propagation.
 */
export function createSnsAttributes(
  ctx: ExecutionContextData
): Record<string, { DataType: string; StringValue: string }> {
  return createSqsAttributes(ctx);
}

/**
 * Create trace context for EventBridge event detail.
 */
export function createEventBridgeContext(
  ctx: ExecutionContextData
): Record<string, string | boolean> {
  // ALWAYS use current correlationId as causedBy for the next hop.
  // This creates a proper chain: A → B → C (each hop knows its immediate cause)

  const traceContext: Record<string, string | boolean> = {
    correlationId: ctx.correlationId,
    sampled: ctx.observability.sampled,
    causedBy: ctx.correlationId,  // Sender's correlationId = receiver's causedBy
  };
  return traceContext;
}

/**
 * Create trace context for Step Functions output.
 */
export function createStepFunctionsContext(
  ctx: ExecutionContextData
): Record<string, string | boolean> {
  return createEventBridgeContext(ctx);
}

