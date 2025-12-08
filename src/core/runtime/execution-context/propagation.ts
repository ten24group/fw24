/**
 * Trace Context Propagation
 * 
 * Extract trace context from incoming requests/messages.
 * Create propagation data for outgoing requests/messages.
 */

import { ExecutionContextData, ParsedTraceContext } from './types';

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

  // 1. Custom correlation ID
  const customId = normalized[ 'x-correlation-id' ]?.trim();
  if (customId) {
    return {
      correlationId: customId,
      parentLogId: normalized[ 'x-parent-log-id' ]?.trim(),
    };
  }

  // 2. W3C traceparent: 00-{trace-id}-{parent-id}-{flags}
  const traceparent = normalized[ 'traceparent' ];
  if (traceparent && /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)) {
    const parts = traceparent.split('-');
    return {
      correlationId: parts[ 1 ],
      parentLogId: parts[ 2 ],
      sampled: parts[ 3 ] === '01',
    };
  }

  // 3. X-Ray: Root=1-{epoch}-{unique};Parent={id};Sampled={0|1}
  const xray = normalized[ 'x-amzn-trace-id' ];
  if (xray && /Root=1-[0-9a-f]{8}-[0-9a-f]{24}/.test(xray)) {
    const rootMatch = xray.match(/Root=([^;]+)/);
    const parentMatch = xray.match(/Parent=([^;]+)/);
    const sampledMatch = xray.match(/Sampled=([01])/);
    if (rootMatch) {
      return {
        correlationId: rootMatch[ 1 ].replace(/^1-/, '').replace(/-/g, ''),
        parentLogId: parentMatch?.[ 1 ],
        sampled: sampledMatch?.[ 1 ] === '1',
      };
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
    const parentMatch = xray.match(/Parent=([^;]+)/);
    const sampledMatch = xray.match(/Sampled=([01])/);
    if (rootMatch) {
      return {
        correlationId: rootMatch[ 1 ].replace(/^1-/, '').replace(/-/g, ''),
        parentLogId: parentMatch?.[ 1 ],
        sampled: sampledMatch?.[ 1 ] === '1',
      };
    }
  }

  // Custom attributes
  const correlationAttr = messageAttributes[ 'correlationId' ];
  const correlationId = (correlationAttr?.stringValue || correlationAttr?.StringValue)?.trim();
  if (correlationId) {
    const parentAttr = messageAttributes[ 'parentLogId' ];
    const sampledAttr = messageAttributes[ 'sampled' ];
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
export function extractFromSns(
  messageAttributes?: Record<string, { Type?: string; Value?: string }>
): ParsedTraceContext | undefined {
  if (!messageAttributes) return undefined;

  const correlationAttr = messageAttributes[ 'correlationId' ];
  if (correlationAttr?.Value?.trim()) {
    const parentAttr = messageAttributes[ 'parentLogId' ];
    const sampledAttr = messageAttributes[ 'sampled' ];
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
export function extractFromEventBridge(
  event: { detail?: Record<string, unknown> }
): ParsedTraceContext | undefined {
  const detail = event?.detail;
  if (!detail) return undefined;

  // Direct fields
  const correlationId = detail[ 'correlationId' ] || detail[ 'traceId' ];
  if (typeof correlationId === 'string' && correlationId.trim()) {
    const parentLogId = detail[ 'parentLogId' ];
    const sampled = detail[ 'sampled' ];
    return {
      correlationId: correlationId.trim(),
      parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
      sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
    };
  }

  // Nested traceContext object
  const traceContext = detail[ 'traceContext' ] as Record<string, unknown> | undefined;
  if (traceContext && typeof traceContext.correlationId === 'string') {
    return {
      correlationId: (traceContext.correlationId as string).trim(),
      parentLogId: typeof traceContext.parentLogId === 'string'
        ? (traceContext.parentLogId as string).trim()
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
export function extractFromStepFunctions(
  input: Record<string, unknown>
): ParsedTraceContext | undefined {
  if (!input) return undefined;

  // Direct fields
  const correlationId = input[ 'correlationId' ] || input[ 'traceId' ];
  if (typeof correlationId === 'string' && correlationId.trim()) {
    const parentLogId = input[ 'parentLogId' ];
    const sampled = input[ 'sampled' ];
    return {
      correlationId: correlationId.trim(),
      parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
      sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
    };
  }

  // Nested traceContext
  const traceContext = input[ 'traceContext' ] as Record<string, unknown> | undefined;
  if (traceContext && typeof traceContext.correlationId === 'string') {
    return {
      correlationId: (traceContext.correlationId as string).trim(),
      parentLogId: typeof traceContext.parentLogId === 'string'
        ? (traceContext.parentLogId as string).trim()
        : undefined,
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
    if (typeof correlationId === 'string' && correlationId.trim()) {
      const parentLogId = data[ 'parentLogId' ];
      const sampled = data[ 'sampled' ];
      return {
        correlationId: correlationId.trim(),
        parentLogId: typeof parentLogId === 'string' ? parentLogId.trim() : undefined,
        sampled: typeof sampled === 'boolean' ? sampled : sampled === 'true',
      };
    }
  } catch {
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
export function extractFromDynamoDBStream(
  record: {
    dynamodb?: {
      NewImage?: Record<string, { S?: string; BOOL?: boolean }>;
    };
    eventID?: string;
  }
): ParsedTraceContext | undefined {
  const newImage = record?.dynamodb?.NewImage;
  if (newImage) {
    const correlationId = newImage[ 'correlationId' ]?.S || newImage[ 'traceId' ]?.S;
    if (correlationId?.trim()) {
      const parentLogId = newImage[ 'parentLogId' ]?.S;
      const sampled = newImage[ 'sampled' ]?.BOOL ?? newImage[ 'sampled' ]?.S === 'true';
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
export function createHttpHeaders(ctx: ExecutionContextData): Record<string, string> {
  const headers: Record<string, string> = {
    'x-correlation-id': ctx.correlationId,
  };

  if (ctx.parentLogId) {
    headers[ 'x-parent-log-id' ] = ctx.parentLogId;
  }

  // W3C traceparent
  const sampledFlag = ctx.sampled ? '01' : '00';
  const traceId = toW3CTraceId(ctx.correlationId);
  const parentId = ctx.parentLogId
    ? toW3CParentId(ctx.parentLogId)
    : toW3CParentId(ctx.correlationId);
  headers[ 'traceparent' ] = `00-${traceId}-${parentId}-${sampledFlag}`;

  return headers;
}

/**
 * Create SQS message attributes for trace propagation.
 */
export function createSqsAttributes(
  ctx: ExecutionContextData
): Record<string, { DataType: string; StringValue: string }> {
  const attrs: Record<string, { DataType: string; StringValue: string }> = {
    correlationId: { DataType: 'String', StringValue: ctx.correlationId },
    sampled: { DataType: 'String', StringValue: String(ctx.sampled) },
  };
  if (ctx.parentLogId) {
    attrs[ 'parentLogId' ] = { DataType: 'String', StringValue: ctx.parentLogId };
  }
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
  const traceContext: Record<string, string | boolean> = {
    correlationId: ctx.correlationId,
    sampled: ctx.sampled,
  };
  if (ctx.parentLogId) {
    traceContext[ 'parentLogId' ] = ctx.parentLogId;
  }
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

