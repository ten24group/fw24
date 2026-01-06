/**
 * Base Observer Utilities
 *
 * Provides shared functionality for all observers:
 * - Event capture via IEventCapture interface
 * - Context resolution utilities
 * - Error normalization
 * - ID generation
 *
 * DESIGN:
 * - Observers use RecordOverrides from types.ts for options
 * - No duplicate type definitions here
 * - Simple capture function that takes CaptureInput
 * - Context resolution handled by manager
 */
import type { CaptureInput, IEventCapture, ObservabilityError, RecordOverrides } from '../types';
/** Set a custom event capturer (for testing) */
export declare function setCapturer(capturer: IEventCapture): void;
/** Reset capturer to default (for testing cleanup) */
export declare function resetCapturer(): void;
/** Generate a unique ID (W3C Span ID format - 16 hex chars) */
export declare function generateId(): string;
/**
 * Resolve correlation ID from explicit value or context.
 *
 * Returns undefined if no correlationId is available - caller should NOT capture.
 * NEVER auto-generates - that would break trace continuity and hide bugs.
 */
export declare function resolveCorrelationId(observerName: string, explicitId?: string): string | undefined;
/**
 * Merge tags from multiple sources.
 * Later sources override earlier ones.
 */
export declare function mergeTags(...sources: Array<Record<string, string> | undefined>): Record<string, string> | undefined;
/**
 * Normalize an unknown caught value to an Error.
 * In JavaScript, catch blocks can receive any value.
 */
export declare function normalizeError(error: unknown): Error;
/**
 * Map Error to ObservabilityError format
 */
export declare function mapError(error: Error): ObservabilityError;
/**
 * Build complete CaptureInput from partial input + context.
 *
 * This is the key function that resolves context and fills in defaults.
 * Observers call this with their specific fields, context fills the rest.
 *
 * Returns undefined if no correlationId can be resolved - event should NOT be captured.
 */
export declare function buildCaptureInput(observerName: string, input: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & {
    correlationId?: string;
    observabilityLogId?: string;
    timestampMs?: number;
}): CaptureInput | undefined;
/**
 * Capture an event.
 *
 * This is the main function observers use. It:
 * 1. Builds complete CaptureInput from partial input + context
 * 2. Sends to capturer (ObservabilityManager)
 *
 * Returns undefined if:
 * - Observability not initialized
 * - No execution context (no correlationId)
 * - Filtered/sampled out
 *
 * @param observerName - Name of the calling observer (for error messages)
 * @param input - Partial input (required: type, level)
 * @returns observabilityLogId if captured, undefined otherwise
 */
export declare function captureRecord(observerName: string, input: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & RecordOverrides & {
    observabilityLogId?: string;
    timestampMs?: number;
}): string | undefined;
/**
 * Capture an event asynchronously.
 * Use when you need to await backend completion.
 *
 * Returns undefined if:
 * - Observability not initialized
 * - No execution context (no correlationId)
 * - Filtered/sampled out
 */
export declare function captureRecordAsync(observerName: string, input: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & RecordOverrides & {
    observabilityLogId?: string;
    timestampMs?: number;
}): Promise<string | undefined>;
