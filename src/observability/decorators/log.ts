/**
 * @Log Decorator - Lightweight logging without creating spans
 * 
 * Creates standalone log events instead of spans. Perfect for:
 * - Informational messages
 * - Warnings/errors that don't need span context
 * - Debug statements
 * - Events that should be searchable but don't need timeline tracking
 * 
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Log({ level: 'warn', message: 'Suspicious order detected' })
 *   private checkFraud(order: Order) {
 *     // Log is emitted on method entry/exit
 *   }
 *   
 *   @Log({
 *     level: 'info',
 *     extract: {
 *       finish: (ctx) => ({
 *         message: `Order processed: ${ctx.result.orderId}`,
 *         tags: { orderId: ctx.result.orderId },
 *         metrics: { itemCount: ctx.result.items.length }
 *       })
 *     }
 *   })
 *   async processOrder(order: Order) {
 *     // Log emitted after method completes with dynamic data
 *   }
 * }
 * ```
 */

import { captureRecord } from '../observers/base';
import { resolveSource } from './decorator-utils';
import type { ObservabilityLevelString } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LogEnrichment {
  /** Log message (overrides default) */
  message?: string;
  /** Log tags for filtering */
  tags?: Record<string, string>;
  /** Log metrics */
  metrics?: Record<string, number>;
  /** Log data payload */
  data?: Record<string, unknown>;
  /** Log level (overrides default) */
  level?: ObservabilityLevelString;
}

export interface LogExtractContext<TInstance, TArgs extends unknown[], TResult> {
  instance: TInstance;
  args: TArgs;
  operationName: string;
  source: string;
  /** Only available in finish() */
  result?: TResult;
  /** Only available in finish() */
  error?: Error;
  /** Only available in finish() */
  success?: boolean;
  /** Only available in finish() */
  durationMs?: number;
}

type BivariantFn<T extends (...args: any[]) => any> = {
  bivarianceHack: T;
}[ 'bivarianceHack' ];

export interface LogExtractor<TInstance, TArgs extends unknown[], TResult> {
  /**
   * Extract log data before method execution.
   */
  start?: BivariantFn<(ctx: LogExtractContext<TInstance, TArgs, TResult>) => LogEnrichment | void>;

  /**
   * Extract log data after method execution.
   */
  finish?: BivariantFn<(ctx: LogExtractContext<TInstance, TArgs, TResult>) => LogEnrichment | void>;
}

export interface LogOptions<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown> {
  /**
   * Log level.
   * Default: 'info'
   */
  level?: ObservabilityLevelString;

  /**
   * Static log message.
   * For dynamic messages, use extract.start or extract.finish.
   */
  message?: string;

  /**
   * Static tags.
   * For dynamic tags, use extract.
   */
  tags?: Record<string, string>;

  /**
   * Extraction API for dynamic log data.
   */
  extract?: LogExtractor<TInstance, TArgs, TResult>;

  /**
   * Whether to log on method start.
   * Default: false
   */
  logStart?: boolean;

  /**
   * Whether to log on method finish.
   * Default: true
   */
  logFinish?: boolean;

  /**
   * Whether to log on errors only.
   * Default: false
   */
  onErrorOnly?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Decorator
// ═══════════════════════════════════════════════════════════════════════════

export function Log<TInstance = unknown, TArgs extends unknown[] = unknown[], TResult = unknown>(
  options: LogOptions<TInstance, TArgs, TResult> = {}
) {
  return function <T extends (...args: any[]) => any>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    const methodName = String(propertyKey);
    const className = target.constructor.name;
    const source = resolveSource(target as any, methodName, className);
    const operationName = `${className}.${methodName}`;

    const defaultLevel = options.level ?? 'info';
    const logStart = options.logStart ?? false;
    const logFinish = options.logFinish ?? true;
    const onErrorOnly = options.onErrorOnly ?? false;

    descriptor.value = function (this: any, ...args: any[]) {
      const startTime = Date.now();

      // Emit start log if configured
      if (logStart && !onErrorOnly) {
        const startEnrichment = options.extract?.start?.({
          instance: this,
          args: args as any,
          operationName,
          source,
        });

        const logMessage = startEnrichment?.message ?? options.message ?? `${operationName} started`;

        captureRecord('LogDecorator', {
          type: 'log',
          level: startEnrichment?.level ?? defaultLevel,
          operation: logMessage,  // Message in operation field (like LogObserver)
          source,
          tags: {
            ...options.tags,
            ...startEnrichment?.tags,
          },
          metrics: startEnrichment?.metrics,
          data: startEnrichment?.data,
        });
      }

      // Execute method and emit finish log
      const executeAndLog = (result: any, error?: Error) => {
        const durationMs = Date.now() - startTime;
        const success = !error;

        // Skip finish log if onErrorOnly and no error
        if (onErrorOnly && !error) {
          if (error) throw error;
          return result;
        }

        if (logFinish) {
          const finishEnrichment = options.extract?.finish?.({
            instance: this,
            args: args as any,
            operationName,
            source,
            result,
            error,
            success,
            durationMs,
          });

          const logLevel = error
            ? 'error'
            : (finishEnrichment?.level ?? defaultLevel);

          const logMessage = error
            ? `${operationName} failed: ${error.message}`
            : (finishEnrichment?.message ?? options.message ?? `${operationName} completed`);

          captureRecord('LogDecorator', {
            type: 'log',
            level: logLevel,
            operation: logMessage,  // Message in operation field (like LogObserver)
            source,
            success,
            error: error ? { type: error.name, message: error.message, stack: error.stack } : undefined,
            tags: {
              ...options.tags,
              ...finishEnrichment?.tags,
              'log.method_success': String(success),
            },
            metrics: {
              'log.duration_ms': durationMs,
              ...finishEnrichment?.metrics
            },
            data: finishEnrichment?.data,
          });
        }

        if (error) throw error;
        return result;
      };

      // Handle async/sync
      try {
        const result = originalMethod.apply(this, args);

        if (result && typeof result.then === 'function') {
          return result
            .then((value: any) => executeAndLog(value))
            .catch((error: Error) => executeAndLog(undefined, error));
        } else {
          return executeAndLog(result);
        }
      } catch (error) {
        return executeAndLog(undefined, error as Error);
      }
    } as any;

    return descriptor;
  };
}
