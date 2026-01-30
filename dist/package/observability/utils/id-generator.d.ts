/**
 * ID Generator for W3C Trace Context compliance
 *
 * W3C Trace Context requires:
 * - Trace ID: 16-byte array (32 hex characters)
 * - Parent ID (Span ID): 8-byte array (16 hex characters)
 *
 * We use crypto.randomBytes for better entropy than Math.random()
 */
/**
 * Generate a W3C-compliant Trace ID (16 bytes / 32 hex chars)
 */
export declare function generateTraceId(): string;
/**
 * Generate a W3C-compliant Span ID (8 bytes / 16 hex chars)
 * Also used for Observability Log IDs
 */
export declare function generateSpanId(): string;
/**
 * Generate an observability log ID (DynamoDB PK).
 *
 * IMPORTANT:
 * ObservabilityLog IDs must be globally unique across a high-volume, TTL'd table.
 * A raw 8-byte span id has non-zero collision risk at scale (birthday bound).
 *
 * We namespace the random span id by the current slice correlationId to make collisions
 * effectively impossible across invocations:
 *
 *   <32-hex correlationId> "-" <16-hex spanId>
 */
export declare function generateObservabilityLogId(correlationId: string): string;
/**
 * Generate a generic unique ID (legacy).
 * Prefer generateObservabilityLogId() when correlationId is available.
 */
export declare function generateId(): string;
