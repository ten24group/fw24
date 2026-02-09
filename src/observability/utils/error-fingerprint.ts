/**
 * Error Fingerprinting Utility
 * 
 * Computes a deterministic fingerprint from error properties so that
 * "same error, different invocations" can be grouped together.
 * 
 * The fingerprint is a hex string derived from:
 *  - error.type (class name)
 *  - normalized error.message (variable parts stripped)
 *  - normalized stack trace (first few frames, line numbers stripped)
 */

import { createHash } from 'crypto';
import type { ObservabilityError } from '../types';

/** Patterns to strip variable parts from error messages */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_ID_PATTERN = /\b[0-9a-f]{16,}\b/gi;
const NUMERIC_ID_PATTERN = /\b\d{4,}\b/g;
const TIMESTAMP_ISO_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ+:-]*/g;
const TIMESTAMP_EPOCH_PATTERN = /\b1[6-9]\d{11}\b/g;

/** Number of stack frames to include in fingerprint */
const MAX_STACK_FRAMES = 3;

/** Pattern to strip line/column numbers from stack frames */
const LINE_COL_PATTERN = /:\d+:\d+\)?$/;

/**
 * Normalize an error message by stripping variable parts (UUIDs, numbers, timestamps).
 * This ensures the same logical error produces the same fingerprint even with different runtime values.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(UUID_PATTERN, '<uuid>')
    .replace(TIMESTAMP_ISO_PATTERN, '<timestamp>')
    .replace(TIMESTAMP_EPOCH_PATTERN, '<epoch>')
    .replace(HEX_ID_PATTERN, '<hex>')
    .replace(NUMERIC_ID_PATTERN, '<n>');
}

/**
 * Extract and normalize the first N stack frames.
 * Strips line/column numbers so minor code shifts don't change the fingerprint.
 */
export function normalizeStackTrace(stack: string): string {
  const lines = stack.split('\n');
  const frames: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Only include "at ..." lines (actual stack frames)
    if (trimmed.startsWith('at ')) {
      // Strip line:col numbers
      const normalized = trimmed.replace(LINE_COL_PATTERN, '');
      frames.push(normalized);
      if (frames.length >= MAX_STACK_FRAMES) break;
    }
  }

  return frames.join('\n');
}

/**
 * Compute a deterministic fingerprint for an error.
 * 
 * Returns a 16-character hex string (first 8 bytes of SHA-256).
 * The fingerprint is stable across invocations for the same logical error,
 * but may change if the error type, message pattern, or stack trace location changes.
 */
export function computeErrorFingerprint(error: ObservabilityError): string {
  const parts: string[] = [
    error.type,
    normalizeErrorMessage(error.message),
  ];

  if (error.stack) {
    parts.push(normalizeStackTrace(error.stack));
  }

  const input = parts.join('\n');
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}
