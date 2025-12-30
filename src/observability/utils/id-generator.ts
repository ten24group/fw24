/**
 * ID Generator for W3C Trace Context compliance
 * 
 * W3C Trace Context requires:
 * - Trace ID: 16-byte array (32 hex characters)
 * - Parent ID (Span ID): 8-byte array (16 hex characters)
 * 
 * We use crypto.randomBytes for better entropy than Math.random()
 */

import { randomBytes } from 'crypto';

function toHex32(id: string): string {
  const hex = id.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return hex.length >= 32 ? hex.substring(0, 32) : hex.padEnd(32, '0');
}

/**
 * Generate a W3C-compliant Trace ID (16 bytes / 32 hex chars)
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a W3C-compliant Span ID (8 bytes / 16 hex chars)
 * Also used for Observability Log IDs
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

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
export function generateObservabilityLogId(correlationId: string): string {
  return `${toHex32(correlationId)}-${generateSpanId()}`;
}

/**
 * Generate a generic unique ID (legacy).
 * Prefer generateObservabilityLogId() when correlationId is available.
 */
export function generateId(): string {
  return generateSpanId();
}

