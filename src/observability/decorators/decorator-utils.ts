/**
 * Shared utilities for observability decorators
 * 
 * Eliminates duplication across @Observed, @Traced, @Audited
 */

// Re-export from types for type consistency
export type { SourceType } from '../types';
export { resolveSource } from '../utils/source-utils';

/**
 * Execute a method with callbacks for success/error handling.
 * Automatically detects sync vs async and calls appropriate callbacks.
 * 
 * This eliminates the 4-path duplication (async-success, async-error, sync-success, sync-error)
 * that was present in all decorators.
 */
export function executeWithHandlers<T extends (...args: any[]) => any>(
  originalMethod: T,
  context: ThisParameterType<T>,
  args: Parameters<T>,
  onFinish: (success: boolean, result?: unknown, error?: unknown) => void
): ReturnType<T> {
  try {
    const result = originalMethod.apply(context, args);

    // Check if result is a Promise (framework standard).
    // We intentionally do NOT treat arbitrary "thenables" as promises to avoid unsafe casting.
    if (result instanceof Promise) {
      return result
        .then((value) => {
          onFinish(true, value);
          return value;
        })
        .catch((error: unknown) => {
          onFinish(false, undefined, error);
          throw error;
        }) as ReturnType<T>;
    }

    // Handle sync method
    onFinish(true, result);
    return result as ReturnType<T>;
  } catch (error) {
    onFinish(false, undefined, error);
    throw error;
  }
}

