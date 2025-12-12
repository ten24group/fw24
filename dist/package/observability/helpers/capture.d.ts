/**
 * Application-Level Capture Helpers
 *
 * Provides convenient functions for application code to capture business events,
 * errors, and metrics using the observability system.
 *
 * These are higher-level helpers that wrap the observers for common use cases.
 *
 * Usage:
 * ```typescript
 * // Business event with metrics
 * captureEvent({
 *   operation: 'payment.processed',
 *   entityName: 'payment',
 *   entityId: payment.id,
 *   success: true,
 *   metrics: { amount: 1000, currency: 'USD' },
 *   data: { gateway: 'stripe' },
 *   ctx: executionContext
 * });
 *
 * // Error capture
 * captureError(error, {
 *   operation: 'payment.failed',
 *   entityName: 'payment',
 *   entityId: order.id,
 *   ctx: executionContext
 * });
 * ```
 */
import { Actor, ExecutionContext } from '../../core/types/execution-context';
import { ObservabilityLevelString } from '../types';
import { DataProtectionConfig } from '../utils/data-protection';
/**
 * Options for capturing application events
 */
export interface CaptureEventOptions {
    /** Operation name (e.g., 'payment.processed', 'user.login') */
    operation: string;
    /** Event sub-type for classification */
    subType?: string;
    /** Log level */
    level?: ObservabilityLevelString;
    /** Entity type being observed */
    entityName?: string;
    /** Entity instance ID */
    entityId?: string;
    /** Operation status */
    status?: string;
    /** Whether operation succeeded */
    success?: boolean;
    /** Service name */
    service?: string;
    /** External system (stripe, sendgrid, etc.) */
    externalSystem?: string;
    /** External transaction/reference ID */
    externalId?: string;
    /** Numeric metrics */
    metrics?: Record<string, number>;
    /** Duration in ms (convenience - added to metrics) */
    duration?: number;
    /** Main data payload */
    data?: Record<string, unknown>;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
    /** Tags for filtering */
    tags?: Record<string, string>;
    /** ExecutionContext for actor/correlationId extraction */
    ctx?: ExecutionContext;
    /** Explicit actor (overrides ctx.actor) */
    actor?: Actor;
    /** Explicit correlation ID (overrides ctx extraction) */
    correlationId?: string;
    /** Data protection configuration */
    dataProtection?: DataProtectionConfig;
}
/**
 * Capture a business/application event through the observability system.
 *
 * This is a convenience wrapper that:
 * - Extracts actor/correlationId from ExecutionContext
 * - Applies data protection automatically
 * - Handles errors gracefully (won't break business logic)
 *
 * @example
 * ```typescript
 * captureBusinessEvent({
 *   operation: 'order.shipped',
 *   entityName: 'order',
 *   entityId: order.id,
 *   success: true,
 *   data: { trackingNumber: '1234' },
 *   metrics: { itemCount: 5 },
 *   ctx: executionContext
 * });
 * ```
 */
export declare function captureBusinessEvent(options: CaptureEventOptions): string | undefined;
/**
 * Capture an error through the observability system.
 *
 * Convenience function that properly formats error objects.
 *
 * @example
 * ```typescript
 * try {
 *   await processPayment(order);
 * } catch (error) {
 *   captureError(error, {
 *     operation: 'payment.failed',
 *     entityName: 'payment',
 *     entityId: order.id,
 *     ctx: executionContext
 *   });
 *   throw error;
 * }
 * ```
 */
export declare function captureBusinessError(error: Error | unknown, options: Omit<CaptureEventOptions, 'level' | 'success' | 'status'>): string | undefined;
/**
 * Capture a metric through the observability system.
 *
 * @example
 * ```typescript
 * captureMetric('api.latency', 150, {
 *   tags: { endpoint: '/users', method: 'GET' }
 * });
 * ```
 */
export declare function captureMetric(name: string, value: number, options?: {
    tags?: Record<string, string>;
    correlationId?: string;
    ctx?: ExecutionContext;
}): string | undefined;
