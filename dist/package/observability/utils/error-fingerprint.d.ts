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
import type { ObservabilityError } from '../types';
/**
 * Normalize an error message by stripping variable parts (UUIDs, numbers, timestamps).
 * This ensures the same logical error produces the same fingerprint even with different runtime values.
 */
export declare function normalizeErrorMessage(message: string): string;
/**
 * Extract and normalize the first N stack frames.
 * Strips line/column numbers so minor code shifts don't change the fingerprint.
 */
export declare function normalizeStackTrace(stack: string): string;
/**
 * Compute a deterministic fingerprint for an error.
 *
 * Returns a 16-character hex string (first 8 bytes of SHA-256).
 * The fingerprint is stable across invocations for the same logical error,
 * but may change if the error type, message pattern, or stack trace location changes.
 */
export declare function computeErrorFingerprint(error: ObservabilityError): string;
