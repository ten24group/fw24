/**
 * Observed Call Utility
 *
 * Lightweight wrapper for adding observability spans around any external call
 * (HTTP, gRPC, third-party SDK, etc.) without coupling the framework to a specific
 * HTTP client or transport library.
 *
 * @example
 * ```typescript
 * // Wrap a Stripe API call
 * const charge = await observedCall('stripe.createCharge', () => stripe.charges.create({
 *   amount: 2000,
 *   currency: 'usd',
 * }), { subType: 'http', data: { amount: 2000 } });
 *
 * // Wrap a Redis call
 * const value = await observedCall('redis.get', () => redis.get('session:abc'), {
 *   subType: 'cache',
 * });
 *
 * // Synchronous version
 * const result = observedCallSync('jwt.verify', () => jwt.verify(token, secret), {
 *   subType: 'crypto',
 * });
 * ```
 */

import { SpanObserver } from '../observers/span';
import type { ObservabilityLevelString } from '../types';

export interface ObservedCallOptions {
  /** Sub-type hint stored as a tag (e.g., 'http', 'cache', 'queue', 'crypto') */
  subType?: string;
  /** Additional data to attach to the span */
  data?: Record<string, unknown>;
  /** Severity level for the span (default: 'info') */
  level?: ObservabilityLevelString;
  /** Additional tags for filtering */
  tags?: Record<string, string>;
}

/**
 * Wrap an async external call with an observability span.
 *
 * The span automatically captures:
 * - Duration
 * - Success/failure
 * - Error details (if thrown)
 * - Custom data and sub-type from options
 *
 * Errors are re-thrown after being captured.
 */
export async function observedCall<T>(
  operation: string,
  fn: () => Promise<T>,
  options?: ObservedCallOptions,
): Promise<T> {
  return SpanObserver.wrap(operation, fn, {
    level: options?.level ?? 'info',
    data: options?.data,
    tags: {
      component: options?.subType ?? 'external',
      ...options?.tags,
    },
  });
}

/**
 * Wrap a synchronous external call with an observability span.
 *
 * Same as `observedCall` but for synchronous operations.
 */
export function observedCallSync<T>(
  operation: string,
  fn: () => T,
  options?: ObservedCallOptions,
): T {
  return SpanObserver.wrap(operation, fn, {
    level: options?.level ?? 'info',
    data: options?.data,
    tags: {
      component: options?.subType ?? 'external',
      ...options?.tags,
    },
  });
}
