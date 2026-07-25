/**
 * Trace Context Propagation
 *
 * Extract trace context from incoming requests/messages.
 * Create propagation data for outgoing requests/messages.
 */
import { ExecutionContextData, ParsedTraceContext } from './types';
/**
 * True if `trimmedValue` is one of the literal "empty value" tokens (see
 * {@link LITERAL_EMPTY_VALUE_TOKENS}). Exported so every extraction boundary —
 * not just the charset-guarded ones behind {@link sanitizeTraceId} — can reject
 * these tokens, since a producer stringifying an unset id can hit EventBridge
 * `detail`, Step Functions input, or Kinesis payloads just as easily as an HTTP
 * header or SQS/SNS attribute.
 */
export declare function isLiteralEmptyValueToken(trimmedValue: string): boolean;
/**
 * Return `value` only if it is a safe trace/correlation id (see
 * {@link SAFE_TRACE_ID_RE}); otherwise `undefined`. Trims first; treats blank as
 * absent. Use at every UNTRUSTED extraction boundary so nothing charset-unsafe
 * can reach outbound headers or logs.
 */
export declare function sanitizeTraceId(value: string | undefined | null): string | undefined;
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
 * Priority: x-correlation-id > traceparent (W3C) > x-amzn-trace-id (X-Ray)
 */
export declare function extractFromHeaders(headers: Record<string, string | undefined>): ParsedTraceContext | undefined;
/**
 * Extract trace context from SQS message attributes.
 */
export declare function extractFromSqs(messageAttributes?: Record<string, {
    stringValue?: string;
    StringValue?: string;
}>): ParsedTraceContext | undefined;
/**
 * Extract trace context from SNS message attributes.
 */
export declare function extractFromSns(messageAttributes?: Record<string, {
    Type?: string;
    Value?: string;
}>): ParsedTraceContext | undefined;
/**
 * Extract trace context from an SQS record.
 *
 * Supports both:
 * - Direct SQS sendMessage() with MessageAttributes (record.messageAttributes)
 * - SNS -> SQS subscription envelope where SNS MessageAttributes are present in record.body.MessageAttributes
 */
export declare function extractFromSqsRecord(record: {
    messageAttributes?: Record<string, {
        stringValue?: string;
        StringValue?: string;
    }>;
    body?: string;
}): ParsedTraceContext | undefined;
/**
 * Extract trace context from EventBridge event.
 */
export declare function extractFromEventBridge(event: {
    detail?: Record<string, unknown>;
}): ParsedTraceContext | undefined;
/**
 * Extract trace context from Step Functions input.
 */
export declare function extractFromStepFunctions(input: Record<string, unknown>): ParsedTraceContext | undefined;
/**
 * Extract trace context from Kinesis record.
 */
export declare function extractFromKinesis(record: {
    kinesis?: {
        data?: string;
        partitionKey?: string;
    };
}): ParsedTraceContext | undefined;
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
export declare function createHttpHeaders(ctx: ExecutionContextData): Record<string, string>;
/**
 * Create SQS message attributes for trace propagation.
 */
export declare function createSqsAttributes(ctx: ExecutionContextData): Record<string, {
    DataType: string;
    StringValue: string;
}>;
/**
 * Create SNS message attributes for trace propagation.
 */
export declare function createSnsAttributes(ctx: ExecutionContextData): Record<string, {
    DataType: string;
    StringValue: string;
}>;
/**
 * Create trace context for EventBridge event detail.
 */
export declare function createEventBridgeContext(ctx: ExecutionContextData): Record<string, string | boolean>;
/**
 * Create trace context for Step Functions output.
 */
export declare function createStepFunctionsContext(ctx: ExecutionContextData): Record<string, string | boolean>;
