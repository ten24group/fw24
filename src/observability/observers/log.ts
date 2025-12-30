/**
 * LogObserver - Structured logging
 * 
 * Unlike raw console.log, these logs:
 * - Include correlationId for distributed tracing
 * - Have proper severity levels
 * - Go through configured backends (CloudWatch, DynamoDB, etc.)
 * - Can be sampled/filtered
 * 
 * Usage:
 * ```typescript
 * // Context is auto-established in controllers
 * LogObserver.info('User logged in', { userId });
 * LogObserver.warn('Rate limit approaching', { current: 90, limit: 100 });
 * LogObserver.error('Payment failed', new Error('Timeout'));
 * 
 * // With additional options
 * LogObserver.debug('Cache lookup', { key, hit: true }, { 
 *   tags: { component: 'cache' } 
 * });
 * ```
 */

import type { ObservabilityLevelString, RecordOverrides, ObservabilityError } from '../types';
import { captureRecord } from './base';

const OBSERVER_NAME = 'LogObserver';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for log operations.
 * Extends RecordOverrides for all context override capabilities.
 */
export interface LogOptions extends RecordOverrides {
  /** Entity name for context */
  entityName?: string;
  /** Entity ID for context */
  entityId?: string;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
  /** Duration of the operation in milliseconds */
  durationMs?: number;
  /** Whether the operation succeeded */
  success?: boolean;
  /** Status of the operation */
  status?: string;
  /** Metrics to attach to the log */
  metrics?: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Core log implementation
 */
function logEvent(
  level: ObservabilityLevelString,
  message: string,
  data?: Record<string, unknown>,
  options?: LogOptions
): string | undefined {
  const { entityName, entityId, attributes, durationMs, success, status, metrics, ...overrides } = options ?? {};

  return captureRecord(OBSERVER_NAME, {
    type: 'log',
    level,
    operation: message,
    data,
    entityName,
    entityId,
    attributes,
    durationMs,
    success,
    status,
    metrics,
    ...overrides,
  });
}

/**
 * Log with error handling
 */
function logWithError(
  level: ObservabilityLevelString,
  message: string,
  errorOrData?: Error | Record<string, unknown>,
  options?: LogOptions
): string | undefined {
  const { entityName, entityId, attributes, durationMs, success, status, metrics, ...overrides } = options ?? {};

  const isError = errorOrData instanceof Error;
  const data = isError ? { errorMessage: errorOrData.message } : errorOrData;

  let error: ObservabilityError | undefined;
  if (isError) {
    error = {
      type: errorOrData.name,
      message: errorOrData.message,
      stack: errorOrData.stack,
      code: 'code' in errorOrData && typeof errorOrData.code === 'string'
        ? errorOrData.code
        : undefined,
    };
  }

  return captureRecord(OBSERVER_NAME, {
    type: 'log',
    level,
    operation: message,
    data,
    entityName,
    entityId,
    attributes,
    error,
    durationMs,
    success: success ?? (isError ? false : undefined),
    status,
    metrics,
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LogObserver
// ═══════════════════════════════════════════════════════════════════════════

export class LogObserver {

  /**
   * Log at TRACE level (most verbose)
   */
  static trace(
    message: string,
    data?: Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    return logEvent('trace', message, data, options);
  }

  /**
   * Log at DEBUG level
   */
  static debug(
    message: string,
    data?: Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    return logEvent('debug', message, data, options);
  }

  /**
   * Log at INFO level
   */
  static info(
    message: string,
    data?: Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    return logEvent('info', message, data, options);
  }

  /**
   * Log at WARN level
   */
  static warn(
    message: string,
    data?: Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    return logEvent('warn', message, data, options);
  }

  /**
   * Log at ERROR level
   * @param message - Log message
   * @param errorOrData - Error object OR data object
   * @param options - Additional options
   */
  static error(
    message: string,
    errorOrData?: Error | Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    return logWithError('error', message, errorOrData, options);
  }

  /**
   * Log at CRITICAL level (most severe)
   * Note: CRITICAL level bypasses sampling automatically
   */
  static critical(
    message: string,
    errorOrData?: Error | Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    return logWithError('critical', message, errorOrData, options);
  }
}
