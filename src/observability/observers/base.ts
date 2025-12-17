/**
 * Base utilities for observers
 * 
 * Provides shared functionality to reduce code duplication across observers.
 * All observers should use these utilities instead of duplicating logic.
 * 
 * TESTABILITY: Uses IEventCapture interface with setCapturer() for dependency injection.
 * In tests, call setCapturer(mockCapturer) before running observer tests.
 */

import { randomUUID } from 'crypto';
import { Actor, ExecutionContext } from '../../core/types/execution-context';
import { getCurrentContext, getCorrelationIdIfExists } from '../context';
import { CaptureInput, CaptureOptions, IEventCapture, ObservabilityError } from '../types';
import { createLogger } from '../../logging';
import { generateTraceId, generateSpanId } from '../utils/id-generator';

const baseLogger = createLogger('Observer');

/**
 * Event Capturer Registry
 * 
 * Simple registry - no lazy loading, no circular dependencies.
 * ObservabilityManager MUST call initialize() during its initialization.
 */
class CapturerRegistry {
  private capturer: IEventCapture | null = null;

  /**
     * Initialize the capturer (called by ObservabilityManager during initialization)
   */
  initialize(capturer: IEventCapture): void {
    if (!this.capturer) {
      this.capturer = capturer;
    }
  }

  /**
     * Get the event capturer. Throws if not initialized.
   */
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

  /**
     * Set a custom capturer (for testing)
   * 
   * @example
   * ```typescript
   * // In tests:
   * const mockCapturer = {
   *   capture: jest.fn().mockReturnValue('test-log-id'),
   *   captureAsync: jest.fn().mockResolvedValue('test-log-id'),
   * };
   * setCapturer(mockCapturer);
     * ```
     */
  set(capturer: IEventCapture): void {
    this.capturer = capturer;
  }

  /**
   * Reset to uninitialized state (for testing cleanup)
   */
  reset(): void {
    this.capturer = null;
  }
}

// Singleton instance
const capturerRegistry = new CapturerRegistry();

/**
 * Initialize the capturer - called by ObservabilityManager
 * @internal
 */
export function initializeCapturer(capturer: IEventCapture): void {
  capturerRegistry.initialize(capturer);
}

/**
 * Get the event capturer (lazy-loads manager if needed)
 * @internal
 */
function getCapturer(): IEventCapture {
  return capturerRegistry.get();
}

/**
 * Set a custom event capturer (for testing)
 */
export function setCapturer(capturer: IEventCapture): void {
  capturerRegistry.set(capturer);
}

/**
 * Reset capturer to default (for testing cleanup)
 */
export function resetCapturer(): void {
  capturerRegistry.reset();
}

/**
 * Standard options shared by all observers
 */
export interface BaseObserverOptions {
  /** Explicit correlation ID (defaults to context) */
  correlationId?: string;
  /** Correlation ID that caused this event (cross-invocation tracing) */
  causedBy?: string;
  /** All related trace IDs (for complex workflows) */
  relatedTraces?: string[];
  /** Actor performing the action */
  actor?: Actor;
  /** Source identifier */
  source?: string;
  /** Tags for filtering */
  tags?: Record<string, string>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Common fields derived from context and options
 */
export interface CommonFields {
  correlationId: string;
  causedBy?: string;
  relatedTraces?: string[];
  actor?: Actor;
  source?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  // Use W3C Span ID format (16 hex chars) by default for compatibility
  return generateSpanId();
}

/**
 * Resolve correlation ID from explicit value or context.
 * 
 * If no correlationId is available:
 * - In development (NODE_ENV !== 'production'): throws error for fast failure
 * - In production: auto-generates with warning for resilience
 */
export function resolveCorrelationId(
  observerName: string,
  explicitId?: string
): string {
  let correlationId = explicitId ?? getCorrelationIdIfExists();

  if (!correlationId) {
    const message =
      `${observerName}: No observability context established. ` +
      'Establish context with runWithContext() before using observers. ';

    // In development, fail fast to catch context issues early
    if (process.env.NODE_ENV !== 'production') {
      baseLogger.error(message + 'This will auto-generate in production but should be fixed.');
      // Don't throw - just log error. Observability should never crash the app.
    }

    // Auto-generate correlationId to maintain observability
    // Use W3C Trace ID format (32 hex chars)
    correlationId = generateTraceId();
    baseLogger.warn(message + `Auto-generated correlationId: ${correlationId}`);
  }

  return correlationId;
}

/**
 * Merge tags from context and options
 */
export function mergeObserverTags(
  contextTags?: Record<string, string>,
  optionTags?: Record<string, string>
): Record<string, string> | undefined {
  if (!contextTags && !optionTags) return undefined;
  return { ...contextTags, ...optionTags };
}

/**
 * Build common fields from context and options.
 * Always returns fields - auto-generates correlationId if needed.
 */
export function buildCommonFields(
  observerName: string,
  options?: BaseObserverOptions
): CommonFields {
  const context = getCurrentContext();
  const correlationId = resolveCorrelationId(observerName, options?.correlationId);

  return {
    correlationId,
    causedBy: options?.causedBy,
    relatedTraces: options?.relatedTraces,
    actor: options?.actor ?? context?.actor,
    source: options?.source ?? context?.source,
    tags: mergeObserverTags(context?.tags, options?.tags),
    metadata: options?.metadata,
  };
}

/**
 * Extract BaseObserverOptions from ExecutionContext or pass through if already options.
 * 
 * When an ExecutionContext (the handler context with event/request/response) is passed,
 * extracts correlationId from executionContext first (the AsyncLocalStorage context),
 * then falls back to actor.correlationId.
 */
export function extractObserverOptions(
  ctx?: ExecutionContext | BaseObserverOptions
): BaseObserverOptions {
  if (!ctx) return {};

  // Check if this is a handler ExecutionContext (has event and lambdaContext)
  if ('event' in ctx && 'lambdaContext' in ctx) {
    const handlerCtx = ctx as ExecutionContext;
    return {
      // Prefer executionContext.correlationId (the real trace ID from AsyncLocalStorage)
      // Fall back to actor.correlationId for backward compatibility
      correlationId: handlerCtx.executionContext?.correlationId ?? handlerCtx.actor?.correlationId,
      actor: handlerCtx.actor,
    };
  }

  return ctx as BaseObserverOptions;
}

/**
 * Normalize an unknown caught value to an Error.
 * In JavaScript, catch blocks can receive any value, not just Error objects.
 * 
 * @example
 * ```typescript
 * try {
 *   // ...
 * } catch (error) {
 *   const normalizedError = normalizeError(error);
 *   span.end({ success: false, error: normalizedError });
 * }
 * ```
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  if (error !== null && typeof error === 'object') {
    // Handle error-like objects with message property
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
  // Fallback: stringify whatever we got
  return new Error(String(error));
}

/**
 * Map Error to ObservabilityError format
 */
export function mapError(error: Error): ObservabilityError {
  // Check for code property (common in Node.js errors)
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return {
    type: error.name,
    message: error.message,
    stack: error.stack,
    code,
  };
}

/**
 * Capture an event using common fields.
 * Handles all the boilerplate - observers should use this instead of calling capture directly.
 * 
 * Uses getCapturer() for testability - in tests, call setCapturer(mockCapturer) first.
 */
export function captureEvent(
  fields: CommonFields,
  event: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & {
    observabilityLogId?: string;
    timestampMs?: number;
  },
  options?: CaptureOptions
): string | undefined {
  return getCapturer().capture(
    {
      ...event,
      correlationId: fields.correlationId,
      observabilityLogId: event.observabilityLogId ?? generateId(),
      timestampMs: event.timestampMs ?? Date.now(),
      actor: event.actor ?? fields.actor,
      source: event.source ?? fields.source,
      tags: mergeObserverTags(fields.tags, event.tags),
      metadata: event.metadata ?? fields.metadata,
    },
    options
  );
}

/**
 * Capture an event asynchronously using common fields.
 * Use when you need to await backend completion (e.g., for critical audits).
 */
export async function captureEventAsync(
  fields: CommonFields,
  event: Omit<CaptureInput, 'correlationId' | 'observabilityLogId' | 'timestampMs'> & {
    observabilityLogId?: string;
    timestampMs?: number;
  },
  options?: Omit<CaptureOptions, 'sync'>
): Promise<string | undefined> {
  return getCapturer().captureAsync(
    {
      ...event,
      correlationId: fields.correlationId,
      observabilityLogId: event.observabilityLogId ?? generateId(),
      timestampMs: event.timestampMs ?? Date.now(),
      actor: event.actor ?? fields.actor,
      source: event.source ?? fields.source,
      tags: mergeObserverTags(fields.tags, event.tags),
      metadata: event.metadata ?? fields.metadata,
    },
    options
  );
}
