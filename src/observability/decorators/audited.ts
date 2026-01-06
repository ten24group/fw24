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
 *     capture: { args: true }
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
import type { DecoratorBaseOptions, CaptureSerializeOptions } from '../types';
import { executeWithHandlers, resolveSource } from './decorator-utils';
import { safeSerialize, type SerializeOptions } from '../utils/payload';

export interface AuditedOptions extends DecoratorBaseOptions {
  /** Audit operation name (defaults to ClassName.methodName) */
  operation?: string;
  /** Entity name being audited (optional) */
  entityName?: string;
  /** Audit level */
  level?: 'info' | 'warn' | 'error';
  /** Specific argument names to capture (requires capture.args to be enabled) */
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
            recordOverrides,
            toSerializeOptions(recordOverrides.capture?.args),
            toSerializeOptions(recordOverrides.capture?.result)
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

/**
 * Convert decorator capture options to SerializeOptions
 */
function toSerializeOptions(option: boolean | CaptureSerializeOptions | undefined): SerializeOptions | undefined {
  if (option === undefined || option === false) return undefined;
  if (option === true) return {}; // Use defaults
  return option; // Already SerializeOptions
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
  recordOverrides: Partial<DecoratorBaseOptions>,
  argsSerializeOpts: SerializeOptions | undefined,
  resultSerializeOpts: SerializeOptions | undefined
): void {
  // Build audit data
  let data: Record<string, unknown> = { success, durationMs };

  // Use custom data extractor if provided
  if (options.dataExtractor) {
    // No defensive fallbacks: extractor errors should surface (tests + caller visibility).
    data = { ...data, ...options.dataExtractor(args, result) };
  } else {
    // Capture args if requested
    if (argsSerializeOpts && args.length > 0) {
      if (options.argNames?.length) {
        // Capture specific named arguments
        const namedArgs: Record<string, unknown> = {};
        options.argNames.forEach((name, index) => {
          if (index < args.length) {
            namedArgs[ name ] = safeSerialize(args[ index ], argsSerializeOpts);
          }
        });
        data.args = namedArgs;
      } else {
        data.args = safeSerialize(args, argsSerializeOpts);
      }
    }

    // Capture result if requested
    if (resultSerializeOpts && result !== undefined) {
      data.result = safeSerialize(result, resultSerializeOpts);
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
