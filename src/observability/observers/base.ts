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

const baseLogger = createLogger('Observer');

/**
 * The event capturer - MUST be set by manager.ts during initialization
 * 
 * This breaks the circular dependency:
 * - base.ts defines the interface and placeholder
 * - manager.ts imports base.ts (no circular dep since we don't import manager)
 * - manager.ts calls initializeCapturer() to inject itself
 */
let eventCapturer: IEventCapture | null = null;

/**
 * Initialize the capturer - called by ObservabilityManager during initialization.
 * This breaks the circular dependency by having the manager inject itself.
 * 
 * @internal - Only called by manager.ts
 */
export function initializeCapturer(capturer: IEventCapture): void {
  if (!eventCapturer) {
    eventCapturer = capturer;
  }
}

/**
 * Get the event capturer.
 * Throws if not initialized - manager.ts must call initializeCapturer() first.
 */
function getCapturer(): IEventCapture {
  if (!eventCapturer) {
    throw new Error(
      'Observer not initialized. Ensure ObservabilityManager is imported before using observers. ' +
      'This is a framework bug if you see this error.'
    );
  }
  return eventCapturer;
}

/**
 * Set a custom event capturer (for testing)
 * 
 * @example
 * ```typescript
 * // In tests:
 * const mockCapturer = {
 *   capture: jest.fn().mockReturnValue('test-log-id'),
 *   captureAsync: jest.fn().mockResolvedValue('test-log-id'),
 * };
 * setCapturer(mockCapturer);
 * 
 * // Run your observer tests...
 * 
 * // Reset after tests:
 * resetCapturer();
 * ```
 */
export function setCapturer(capturer: IEventCapture): void {
  eventCapturer = capturer;
}

/**
 * Reset capturer to default (for testing cleanup)
 */
export function resetCapturer(): void {
  eventCapturer = null;
}

/**
 * Standard options shared by all observers
 */
export interface BaseObserverOptions {
  /** Explicit correlation ID (defaults to context) */
  correlationId?: string;
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
  actor?: Actor;
  source?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Resolve correlation ID from explicit value or context
 */
export function resolveCorrelationId(
  observerName: string,
  explicitId?: string
): string | undefined {
  const correlationId = explicitId ?? getCorrelationIdIfExists();
  if (!correlationId) {
    baseLogger.warn(
      `${observerName}: No correlationId available. ` +
      'Establish context with runWithContext() or use middleware.'
    );
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
 * Returns undefined if correlationId is not available.
 */
export function buildCommonFields(
  observerName: string,
  options?: BaseObserverOptions
): CommonFields | undefined {
  const context = getCurrentContext();
  const correlationId = resolveCorrelationId(observerName, options?.correlationId);
  
  if (!correlationId) return undefined;

  return {
    correlationId,
    actor: options?.actor ?? context?.actor,
    source: options?.source ?? context?.source,
    tags: mergeObserverTags(context?.tags, options?.tags),
    metadata: options?.metadata,
  };
}

/**
 * Extract BaseObserverOptions from ExecutionContext or pass through if already options
 */
export function extractObserverOptions(
  ctx?: ExecutionContext | BaseObserverOptions
): BaseObserverOptions {
  if (!ctx) return {};

  if ('event' in ctx && 'lambdaContext' in ctx) {
    const execCtx = ctx as ExecutionContext;
    return {
      correlationId: execCtx.actor?.correlationId,
      actor: execCtx.actor,
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
  event: Omit<CaptureInput, 'correlationId' | 'logId' | 'timestampMs'> & {
    logId?: string;
    timestampMs?: number;
  },
  options?: CaptureOptions
): string | undefined {
  return getCapturer().capture(
    {
      ...event,
      correlationId: fields.correlationId,
      logId: event.logId ?? generateId(),
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
  event: Omit<CaptureInput, 'correlationId' | 'logId' | 'timestampMs'> & {
    logId?: string;
    timestampMs?: number;
  },
  options?: Omit<CaptureOptions, 'sync'>
): Promise<string | undefined> {
  return getCapturer().captureAsync(
    {
      ...event,
      correlationId: fields.correlationId,
      logId: event.logId ?? generateId(),
      timestampMs: event.timestampMs ?? Date.now(),
      actor: event.actor ?? fields.actor,
      source: event.source ?? fields.source,
      tags: mergeObserverTags(fields.tags, event.tags),
      metadata: event.metadata ?? fields.metadata,
    },
    options
  );
}
