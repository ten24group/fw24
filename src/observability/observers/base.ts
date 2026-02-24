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

import type { Actor } from '../../core/types/execution-context';
import {
  getCurrentExecutionContext,
  getObservabilityState,
  getCurrentParentObservabilityLogId,
} from '../../core/runtime/execution-context/storage';
import type { CaptureInput, IEventCapture, ObservabilityError, RecordOverrides } from '../types';
import { createLogger } from '../../logging';
import { generateTraceId, generateSpanId, generateObservabilityLogId } from '../utils/id-generator';
import { merge } from '../../utils/merge';

const baseLogger = createLogger('Observer');

// ═══════════════════════════════════════════════════════════════════════════
// CAPTURER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Event Capturer Registry
 *
 * Simple registry for the event capturer (ObservabilityManager).
 * Enables testability via dependency injection.
 */
class CapturerRegistry {
  private capturer: IEventCapture | null = null;
  private warnedNotInitialized = false;

  /** Initialize the capturer (called by ObservabilityManager during initialization) */
  initialize(capturer: IEventCapture): void {
    if (!this.capturer) {
      this.capturer = capturer;
      this.warnedNotInitialized = false; // Reset warning flag on initialization
    }
  }

  /**
   * Get the event capturer or null if not initialized.
   * Use this for soft-fail capture (won't crash application code if observability isn't initialized yet).
   */
  tryGet(): IEventCapture | null {
    if (!this.capturer && !this.warnedNotInitialized) {
      this.warnedNotInitialized = true;
      baseLogger.warn(
        'Observability not initialized. ObservabilityManager must initialize before observers can be used. ' +
        'Observability events will be silently dropped until initialization. ' +
        'This usually means observers are being used before the framework has initialized.'
      );
    }
    return this.capturer;
  }

  /** Get the event capturer. Throws if not initialized. */
  get(): IEventCapture {
    if (!this.capturer) {
      throw new Error(
        'Observability not initialized. ObservabilityManager must initialize before observers can be used. ' +
        'This usually means you are using observers before the framework has initialized. ' +
        'If you see this error, import ObservabilityManager somewhere in your code to trigger initialization.'
      );
    }
    return this.capturer;
  }

  /** Set a custom capturer (for testing) */
  set(capturer: IEventCapture): void {
    this.capturer = capturer;
  }

  /** Reset to uninitialized state (for testing cleanup) */
  reset(): void {
    this.capturer = null;
    this.warnedNotInitialized = false;
  }
}

const capturerRegistry = new CapturerRegistry();

/** Initialize the capturer - called by ObservabilityManager @internal */
export function initializeCapturer(capturer: IEventCapture): void {
  capturerRegistry.initialize(capturer);
}

/** Set a custom event capturer (for testing) */
export function setCapturer(capturer: IEventCapture): void {
  capturerRegistry.set(capturer);
}

/** Reset capturer to default (for testing cleanup) */
export function resetCapturer(): void {
  capturerRegistry.reset();
}

// ═══════════════════════════════════════════════════════════════════════════
// ID GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/** Generate a unique ID (W3C Span ID format - 16 hex chars) */
export function generateId(): string {
  return generateSpanId();
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve correlation ID from explicit value or context.
 *
 * Returns undefined if no correlationId is available - caller should NOT capture.
 * NEVER auto-generates - that would break trace continuity and hide bugs.
 */
export function resolveCorrelationId(observerName: string, explicitId?: string): string | undefined {
  const ctx = getCurrentExecutionContext();
  const correlationId = explicitId ?? ctx?.correlationId;

  if (!correlationId) {
    baseLogger.warn(
      `${observerName}: No execution context established. ` +
      'Context is auto-established in controllers, or use runWithExecutionContext() before using observers. ' +
      'Event will NOT be captured - fix the missing context.'
    );
    return undefined;
  }

  return correlationId;
}

/**
 * Merge tags from multiple sources.
 * Later sources override earlier ones.
 */
export function mergeTags(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  let hasAny = false;

  for (const source of sources) {
    if (source) {
      Object.assign(result, source);
      hasAny = true;
    }
  }

  return hasAny ? result : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize an unknown caught value to an Error.
 * In JavaScript, catch blocks can receive any value.
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  if (error !== null && typeof error === 'object') {
    const errorObj = error as Record<string, unknown>;
    if (typeof errorObj.message === 'string') {
      const err = new Error(errorObj.message);
      if (typeof errorObj.name === 'string') {
        err.name = errorObj.name;
      }
      if (typeof errorObj.stack === 'string') {
        err.stack = errorObj.stack;
      }
      return err;
    }
  }
  return new Error(String(error));
}

/**
 * Map Error to ObservabilityError format
 */
export function mapError(error: Error): ObservabilityError {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return {
    type: error.name,
    message: error.message,
    stack: error.stack,
    code,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CAPTURE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build complete CaptureInput from partial input + context.
 *
 * This is the key function that resolves context and fills in defaults.
 * Observers call this with their specific fields, context fills the rest.
 *
 * Returns undefined if no correlationId can be resolved - event should NOT be captured.
 */
export function buildCaptureInput(
  observerName: string,
  input: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & {
    correlationId?: string;
    observabilityLogId?: string;
    timestampMs?: number;
  }
): CaptureInput | undefined {
  const ctx = getCurrentExecutionContext();
  const state = getObservabilityState();

  // Resolve correlationId - if undefined, we can't capture
  // Pass only explicit input.correlationId - resolveCorrelationId handles context fallback
  const correlationId = resolveCorrelationId(observerName, input.correlationId);
  if (!correlationId) {
    return undefined;
  }

  // Resolve parent: explicit > context span tree > undefined
  // causedBy and parentObservabilityLogId are orthogonal:
  //   - causedBy: cross-invocation link (e.g., audit event → original API request)
  //   - parentObservabilityLogId: in-invocation hierarchy (e.g., audit event → processor root span)
  // Both can and should coexist. Always resolve parent from context when not explicitly set.
  const parentLogId = input.parentObservabilityLogId !== undefined
    ? input.parentObservabilityLogId
    : getCurrentParentObservabilityLogId();

  // NOTE:
  // Parent/child integrity is enforced at flush-time by building a graph of buffered events.
  // We intentionally do not do any manual "parent reference registration" here.

  return {
    // Identity
    observabilityLogId: input.observabilityLogId ?? generateObservabilityLogId(correlationId),
    timestampMs: input.timestampMs ?? Date.now(),

    // Classification (required from input)
    type: input.type,
    level: input.level,

    // Trace context
    correlationId,
    parentObservabilityLogId: parentLogId ?? undefined,
    causedBy: input.causedBy ?? ctx?.causedBy,
    relatedTraces: input.relatedTraces,

    // Entity
    entityName: input.entityName,
    entityId: input.entityId,

    // Operation
    operation: input.operation,
    subType: input.subType,
    status: input.status,
    success: input.success,
    durationMs: input.durationMs,

    // Actor & source (from input or context)
    actor: input.actor ?? ctx?.actor,
    source: input.source ?? state?.source,
    tags: mergeTags(state?.tags, input.tags),

    // Payloads
    data: input.data,
    attributes: input.attributes,
    // Deep merge context-level metadata (from withContext) with event-level metadata
    metadata: state?.metadata || input.metadata
      ? (merge([ state?.metadata, input.metadata ]) ?? undefined)
      : undefined,
    metrics: input.metrics,
    context: input.context,
    error: input.error,

    // Capture control (pass through as-is)
    capture: input.capture,
  };
}

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
export function captureRecord(
  observerName: string,
  input: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & RecordOverrides & {
    observabilityLogId?: string;
    timestampMs?: number;
  }
): string | undefined {
  // Defensive: don't crash user code if observability not initialized
  const capturer = capturerRegistry.tryGet();
  if (!capturer) {
    return undefined;
  }

  // Build full input - returns undefined if no context (no correlationId)
  const fullInput = buildCaptureInput(observerName, input);
  if (!fullInput) {
    return undefined;
  }

  return capturer.capture(fullInput);
}

/**
 * Capture an event asynchronously.
 * Use when you need to await backend completion.
 *
 * Returns undefined if:
 * - Observability not initialized
 * - No execution context (no correlationId)
 * - Filtered/sampled out
 */
export async function captureRecordAsync(
  observerName: string,
  input: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & RecordOverrides & {
    observabilityLogId?: string;
    timestampMs?: number;
  }
): Promise<string | undefined> {
  // Defensive: don't crash user code if observability not initialized
  const capturer = capturerRegistry.tryGet();
  if (!capturer) {
    return undefined;
  }

  // Build full input - returns undefined if no context (no correlationId)
  const fullInput = buildCaptureInput(observerName, input);
  if (!fullInput) {
    return undefined;
  }

  return capturer.captureAsync(fullInput);
}