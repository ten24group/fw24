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
 * Generate a generic unique ID (for backward compatibility or non-trace entities)
 * Uses Span ID format (16 hex chars) to maintain consistency
 */
export function generateId(): string {
  return generateSpanId();
}

