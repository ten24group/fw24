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
import type { DecoratorBaseOptions } from '../types';
import { safeSerialize } from '../utils/payload';
import { executeWithHandlers, resolveSource } from './decorator-utils';

export interface AuditedOptions extends DecoratorBaseOptions {
  /** Audit operation name (defaults to ClassName.methodName) */
  operation?: string;
  /** Entity name being audited (optional) */
  entityName?: string;
  /** Audit level */
  level?: 'info' | 'warn' | 'error';
  /** Specific argument names to capture (if captureArgs is false) */
  argNames?: string[];
  /** Custom data extractor function */
  dataExtractor?: (args: unknown[], result?: unknown) => Record<string, unknown>;
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

    descriptor.value = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
      // Early exits
      if (!isEnabled(options) || !getCurrentExecutionContext()) {
        return originalMethod.apply(this, args) as ReturnType<T>;
      }

      // Extract RecordOverrides from options
      const {
        operation: opName,
        entityName,
        level,
        argNames,
        dataExtractor,
        captureArgs,
        captureResult,
        enabled,
        sourceType,
        ...recordOverrides
      } = options;

      // Compute source (use explicit source override if provided, otherwise auto-detect)
      const computedSource = resolveSource(sourceType, className, methodName);
      const finalSource = recordOverrides.source ?? computedSource;

      const startTime = Date.now();

      return executeWithHandlers(
        originalMethod,
        this,
        args,
        (success, result, error) => {
          recordAudit(
            operation,
            finalSource,
            options,
            args,
            result,
            success,
            Date.now() - startTime,
            error ? normalizeError(error) : undefined,
            recordOverrides
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
  error: Error | undefined,
  recordOverrides: Partial<DecoratorBaseOptions>
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

  // Pass through all RecordOverrides fields
  AuditObserver.record({
    operation,
    entityName: options.entityName,
    data,
    level: error ? 'error' : (options.level ?? 'info'),
    source,
    ...recordOverrides,
  });
}
