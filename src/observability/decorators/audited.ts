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

import { createLogger } from '../../logging';
import { AuditObserver } from '../observers/audit';
import { normalizeError } from '../observers/base';
import { safeSerialize } from '../utils/payload';
import { executeWithHandlers } from './decorator-utils';

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

    // Wrap method - automatic sync/async handling
    const wrappedMethod = function (this: unknown, ...args: unknown[]): unknown {
      const startTime = Date.now();

      return executeWithHandlers(
        originalMethod as (...args: unknown[]) => unknown,
        this,
        args,
        (success, result, error) => {
          recordAudit({
            operation,
            options,
            args,
            result,
            success,
            error: error ? normalizeError(error) : undefined,
            durationMs: Date.now() - startTime,
            className,
            methodName,
          });
        }
      );
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

  // AuditObserver.record will automatically pick up actor/correlationId/causedBy from context
  // No need to pass them explicitly - let the lower level handle it!
  AuditObserver.record({
    operation,
    entityName: options.entityName,
    data,
    level: error ? 'error' : (options.level ?? 'info'),
    source: `${className}.${methodName}`,
    tags: options.tags,
  });
}

