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
 */

import { getCurrentExecutionContext } from '../../core/runtime/execution-context';
import { AuditObserver } from '../observers/audit';
import { normalizeError } from '../observers/base';
import { safeSerialize } from '../utils/payload';
import { executeWithHandlers } from './decorator-utils';

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
  /** Conditionally enable/disable */
  enabled?: boolean | (() => boolean);
}

/**
 * Method decorator that records an audit event for method calls
 */
export function Audited(options: AuditedOptions = {}) {
  return function <T extends (...args: any[]) => any>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    // Pre-compute static values
    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const operation = options.operation ?? `${className}.${methodName}`;
    const source = `${className}.${methodName}`;

    descriptor.value = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
      // Early exits
      if (!isEnabled(options) || !getCurrentExecutionContext()) {
        return originalMethod.apply(this, args) as ReturnType<T>;
      }

      const startTime = Date.now();

      return executeWithHandlers(
        originalMethod,
        this,
        args,
        (success, result, error) => {
          recordAudit(
            operation,
            source,
            options,
            args,
            result,
            success,
            Date.now() - startTime,
            error ? normalizeError(error) : undefined
          );
        }
      );
    } as T;

    return descriptor;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isEnabled(options: AuditedOptions): boolean {
  if (options.enabled === undefined) return true;
  return typeof options.enabled === 'function' ? options.enabled() : options.enabled;
}

function recordAudit(
  operation: string,
  source: string,
  options: AuditedOptions,
  args: unknown[],
  result: unknown,
  success: boolean,
  durationMs: number,
  error?: Error
): void {
  // Build audit data
  let data: Record<string, unknown> = { success, durationMs };

  // Use custom data extractor if provided
  if (options.dataExtractor) {
    // No defensive fallbacks: extractor errors should surface (tests + caller visibility).
    data = { ...data, ...options.dataExtractor(args, result) };
  } else {
    // Capture args if requested
    if (options.captureArgs && args.length > 0) {
      if (options.argNames?.length) {
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
    data.error = { type: error.name, message: error.message };
  }

  // AuditObserver.record picks up actor/correlationId/causedBy from context automatically
  AuditObserver.record({
    operation,
    entityName: options.entityName,
    data,
    level: error ? 'error' : (options.level ?? 'info'),
    source,
    tags: options.tags,
  });
}
