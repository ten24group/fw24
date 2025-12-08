/**
 * @Audited Decorator - Automatic audit logging for methods
 * 
 * Records audit events for method calls, useful for tracking
 * sensitive operations, permission changes, etc.
 * 
 * Usage:
 * ```typescript
 * class UserService {
 *   @Audited({ operation: 'permission.change' })
 *   async updatePermissions(userId: string, permissions: string[]): Promise<void> {
 *     // Method is automatically audited
 *   }
 *   
 *   @Audited({ 
 *     operation: 'sensitive.access', 
 *     level: 'warn',
 *     captureArgs: true 
 *   })
 *   async accessSensitiveData(userId: string): Promise<SensitiveData> {
 *     // Audit with arguments captured
 *   }
 * }
 * ```
 * 
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise logs warning and doesn't record anything
 */

import { AuditObserver } from '../observers/audit';
import { getCurrentContext, getCorrelationIdIfExists } from '../context';
import { createLogger } from '../../logging';
import { safeSerialize } from '../utils/payload';
import { normalizeError } from '../observers/base';

const logger = createLogger('AuditedDecorator');

export interface AuditedOptions {
  /** Audit operation name (defaults to ClassName.methodName) */
  operation?: string;
  /** Entity name being audited (optional) */
  entityName?: string;
  /** Audit level */
  level?: 'info' | 'warn' | 'error';
  /** Whether to capture method arguments in audit data */
  captureArgs?: boolean;
  /** Whether to capture return value in audit data */
  captureResult?: boolean;
  /** Specific argument names to capture (if captureArgs is false) */
  argNames?: string[];
  /** Custom data extractor function */
  dataExtractor?: (args: unknown[], result?: unknown) => Record<string, unknown>;
  /** Tags for filtering */
  tags?: Record<string, string>;
}

/**
 * Method decorator that records an audit event for method calls
 * 
 * @param options - Audit options
 */
export function Audited(options: AuditedOptions = {}) {
  return function <T extends (...args: unknown[]) => unknown>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;

    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const operation = options.operation ?? `${className}.${methodName}`;

    // Wrap method - handles both sync and async via result checking
    // This is more robust than checking constructor.name which can break with transpilation
    const wrappedMethod = function (this: unknown, ...args: unknown[]): unknown {
      const startTime = Date.now();

      try {
        const result = (originalMethod as (...a: unknown[]) => unknown).apply(this, args);

        // Check if result is a Promise/thenable (works with any async method)
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          // Handle async method
          return (result as Promise<unknown>)
            .then((value) => {
              recordAudit({
                operation,
                options,
                args,
                result: value,
                success: true,
                durationMs: Date.now() - startTime,
                className,
                methodName,
              });
              return value;
            })
            .catch((err) => {
              recordAudit({
                operation,
                options,
                args,
                success: false,
                error: normalizeError(err),
                durationMs: Date.now() - startTime,
                className,
                methodName,
              });
              throw err;
            });
        }

        // Handle sync method
        recordAudit({
          operation,
          options,
          args,
          result,
          success: true,
          durationMs: Date.now() - startTime,
          className,
          methodName,
        });
        return result;
      } catch (err) {
        recordAudit({
          operation,
          options,
          args,
          success: false,
          error: normalizeError(err),
          durationMs: Date.now() - startTime,
          className,
          methodName,
        });
        throw err;
      }
    };
    descriptor.value = wrappedMethod as T;

    return descriptor;
  };
}

/**
 * Record the audit event
 */
function recordAudit(params: {
  operation: string;
  options: AuditedOptions;
  args: unknown[];
  result?: unknown;
  success: boolean;
  error?: Error;
  durationMs: number;
  className: string;
  methodName: string;
}): void {
  const { operation, options, args, result, success, error, durationMs, className, methodName } = params;
  const context = getCurrentContext();

  // Build audit data
  let data: Record<string, unknown> = {
    success,
    durationMs,
  };

  // Use custom data extractor if provided
  if (options.dataExtractor) {
    try {
      data = {
        ...data,
        ...options.dataExtractor(args, result),
      };
    } catch {
      // Ignore extractor errors
    }
  } else {
    // Capture args if requested
    if (options.captureArgs && args.length > 0) {
      if (options.argNames && options.argNames.length > 0) {
        // Capture specific named arguments
        const namedArgs: Record<string, unknown> = {};
        options.argNames.forEach((name, index) => {
          if (index < args.length) {
            namedArgs[ name ] = safeSerialize(args[ index ]);
          }
        });
        data.args = namedArgs;
      } else {
        data.args = safeSerialize(args);
      }
    }

    // Capture result if requested
    if (options.captureResult && result !== undefined) {
      data.result = safeSerialize(result);
    }
  }

  // Add error info if failed
  if (error) {
    data.error = {
      type: error.name,
      message: error.message,
    };
  }

  AuditObserver.record({
    operation,
    entityName: options.entityName,
    data,
    level: error ? 'error' : (options.level ?? 'info'),
    source: `${className}.${methodName}`,
    tags: options.tags,
    actor: context?.actor,
  });
}

