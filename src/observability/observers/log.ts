/**
 * LogObserver - For simple structured logging
 * 
 * Provides a simple API for structured logging that integrates with
 * the observability system. Unlike raw console.log, these logs:
 * - Include correlationId for distributed tracing
 * - Have proper severity levels
 * - Go through configured backends (CloudWatch, DynamoDB, etc.)
 * - Can be sampled/filtered
 * 
 * Usage:
 * ```typescript
 * // FIRST: Establish context (usually done by middleware)
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Simple logging
 *     LogObserver.info('User logged in', { userId });
 *     LogObserver.warn('Rate limit approaching', { current: 90, limit: 100 });
 *     LogObserver.error('Payment failed', { orderId, error: err.message });
 *     
 *     // With additional options
 *     LogObserver.debug('Cache lookup', { key, hit: true }, { 
 *       tags: { component: 'cache' } 
 *     });
 *   }
 * );
 * ```
 */

import { Actor } from '../../core/types/execution-context';
import { ObservabilityLevelString } from '../types';
import {
  BaseObserverOptions,
  buildCommonFields,
  captureEvent,
  mapError,
} from './base';

const OBSERVER_NAME = 'LogObserver';

export interface LogOptions extends BaseObserverOptions {
  /** Additional attributes */
  attributes?: Record<string, unknown>;
  /** Entity name for context */
  entityName?: string;
  /** Entity ID for context */
  entityId?: string;
}

export class LogObserver {

  /**
   * Log at INFO level
   */
  static info(message: string, ...args: unknown[]): string | undefined {
    return this.logWithArgs('info', message, args);
  }

  /**
   * Log at WARN level
   */
  static warn(message: string, ...args: unknown[]): string | undefined {
    return this.logWithArgs('warn', message, args);
  }

  /**
   * Log at ERROR level
   */
  static error(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined {
    // Keep backward compatibility for error() as it has special signature
    const fields = buildCommonFields(OBSERVER_NAME, options);

    const isError = errorOrData instanceof Error;
    const data = isError ? { errorMessage: errorOrData.message } : errorOrData;
    const error = isError ? mapError(errorOrData) : undefined;

    return captureEvent(fields, {
      type: 'log',
      level: 'error',
      operation: message,
      data,
      attributes: options?.attributes,
      entityName: options?.entityName,
      entityId: options?.entityId,
      error,
    });
  }

  /**
   * Log at DEBUG level
   */
  static debug(message: string, ...args: unknown[]): string | undefined {
    return this.logWithArgs('debug', message, args);
  }

  /**
   * Log at TRACE level
   */
  static trace(message: string, ...args: unknown[]): string | undefined {
    return this.logWithArgs('trace', message, args);
  }

  // Helper to handle variable arguments
  private static logWithArgs(level: ObservabilityLevelString, message: string, args: unknown[]): string | undefined {
    let data: Record<string, unknown> | undefined;
    let options: LogOptions | undefined;

    // Parse args similar to console.log but extracting options if last arg
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      // Heuristic: if last arg has 'tags', 'source', or 'attributes', treat as options
      if (lastArg && typeof lastArg === 'object' && ('tags' in lastArg || 'attributes' in lastArg || 'source' in lastArg)) {
        options = args.pop() as LogOptions;
      }
      
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        data = args[0] as Record<string, unknown>;
      } else if (args.length > 0) {
        data = { args };
      }
    }

    return this.log(level, message, data, options);
  }

  /**
   * Log at CRITICAL level (most severe, bypasses sampling)
   */
  static critical(
    message: string,
    errorOrData?: Error | Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, options);

    const isError = errorOrData instanceof Error;
    const data = isError ? { errorMessage: errorOrData.message } : errorOrData;
    const error = isError ? mapError(errorOrData) : undefined;

    // Don't duplicate message - it's already in `operation`
    return captureEvent(fields, {
      type: 'log',
      level: 'critical',
      operation: message,
      data,
      attributes: options?.attributes,
      entityName: options?.entityName,
      entityId: options?.entityId,
      error,
    }, { critical: true });
  }

  /**
   * Core log method
   */
  private static log(
    level: ObservabilityLevelString,
    message: string,
    data?: Record<string, unknown>,
    options?: LogOptions
  ): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, options);

    // Don't duplicate message - it's already in `operation`
    return captureEvent(fields, {
      type: 'log',
      level,
      operation: message,
      data,
      attributes: options?.attributes,
      entityName: options?.entityName,
      entityId: options?.entityId,
    });
  }

  /**
   * Create a child logger with preset tags/options
   * Useful for component-specific logging
   */
  static createChild(defaultOptions: LogOptions): ChildLogObserver {
    return new ChildLogObserver(defaultOptions);
  }
}

/**
 * Child logger with preset options
 */
export class ChildLogObserver {
  constructor(private readonly defaults: LogOptions) { }

  trace(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined {
    return LogObserver.trace(message, data, this.mergeOptions(options));
  }

  debug(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined {
    return LogObserver.debug(message, data, this.mergeOptions(options));
  }

  info(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined {
    return LogObserver.info(message, data, this.mergeOptions(options));
  }

  warn(message: string, data?: Record<string, unknown>, options?: LogOptions): string | undefined {
    return LogObserver.warn(message, data, this.mergeOptions(options));
  }

  error(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined {
    return LogObserver.error(message, errorOrData, this.mergeOptions(options));
  }

  critical(message: string, errorOrData?: Error | Record<string, unknown>, options?: LogOptions): string | undefined {
    return LogObserver.critical(message, errorOrData, this.mergeOptions(options));
  }

  private mergeOptions(options?: LogOptions): LogOptions {
    return {
      ...this.defaults,
      ...options,
      tags: { ...this.defaults.tags, ...options?.tags },
      attributes: { ...this.defaults.attributes, ...options?.attributes },
    };
  }
}

