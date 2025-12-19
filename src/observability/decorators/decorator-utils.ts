/**
 * Shared utilities for observability decorators
 * 
 * Eliminates duplication across @Observed, @Traced, @Audited
 */

export { SourceType, resolveSource } from '../utils/source-utils';

/**
 * Execute a method with callbacks for success/error handling.
 * Automatically detects sync vs async and calls appropriate callbacks.
 * 
 * This eliminates the 4-path duplication (async-success, async-error, sync-success, sync-error)
 * that was present in all decorators.
 */
export function executeWithHandlers<T>(
  originalMethod: (...args: unknown[]) => T,
  context: unknown,
  args: unknown[],
  onFinish: (success: boolean, result?: unknown, error?: unknown) => void
): T {
  try {
    const result = originalMethod.apply(context, args);

    // Check if result is a Promise/thenable
    if (result && typeof (result as any).then === 'function') {
      // Handle async method
      return (result as any)
        .then((value: unknown) => {
          onFinish(true, value);
          return value;
        })
        .catch((error: unknown) => {
          onFinish(false, undefined, error);
          throw error;
        });
    }

    // Handle sync method
    onFinish(true, result);
    return result;
  } catch (error) {
    onFinish(false, undefined, error);
    throw error;
  }
}

