/**
 * Shared utilities for observability decorators
 *
 * Eliminates duplication across @Observed, @Traced, @Audited
 */
export type { SourceType } from '../types';
export { resolveSource } from '../utils/source-utils';
/**
 * Execute a method with callbacks for success/error handling.
 * Automatically detects sync vs async and calls appropriate callbacks.
 *
 * This eliminates the 4-path duplication (async-success, async-error, sync-success, sync-error)
 * that was present in all decorators.
 */
export declare function executeWithHandlers<T extends (...args: any[]) => any>(originalMethod: T, context: ThisParameterType<T>, args: Parameters<T>, onFinish: (success: boolean, result?: unknown, error?: unknown) => void): ReturnType<T>;
