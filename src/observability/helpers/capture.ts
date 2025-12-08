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
import { ObservabilityLevelString, CaptureInput } from '../types';
import { ObservabilityManager } from '../manager';
import { redactSensitiveData, DataProtectionConfig } from '../utils/data-protection';
import { randomUUID } from 'crypto';
import { createLogger } from '../../logging';

const logger = createLogger('CaptureHelper');

/**
 * Options for capturing application events
 */
export interface CaptureEventOptions {
  // === OPERATION ===
  /** Operation name (e.g., 'payment.processed', 'user.login') */
  operation: string;
  /** Event sub-type for classification */
  subType?: string;
  /** Log level */
  level?: ObservabilityLevelString;

  // === ENTITY ===
  /** Entity type being observed */
  entityName?: string;
  /** Entity instance ID */
  entityId?: string;

  // === OUTCOME ===
  /** Operation status */
  status?: string;
  /** Whether operation succeeded */
  success?: boolean;

  // === CONTEXT ===
  /** Service name */
  service?: string;
  /** External system (stripe, sendgrid, etc.) */
  externalSystem?: string;
  /** External transaction/reference ID */
  externalId?: string;

  // === METRICS ===
  /** Numeric metrics */
  metrics?: Record<string, number>;
  /** Duration in ms (convenience - added to metrics) */
  duration?: number;

  // === DATA ===
  /** Main data payload */
  data?: Record<string, unknown>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: Record<string, string>;

  // === CONTEXT EXTRACTION ===
  /** ExecutionContext for actor/correlationId extraction */
  ctx?: ExecutionContext;
  /** Explicit actor (overrides ctx.actor) */
  actor?: Actor;
  /** Explicit correlation ID (overrides ctx extraction) */
  correlationId?: string;

  // === DATA PROTECTION ===
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
export function captureBusinessEvent(options: CaptureEventOptions): string | undefined {
  try {
    // Extract context
    const actor = options.actor ?? options.ctx?.actor;
    const correlationId = options.correlationId 
      ?? options.ctx?.actor?.correlationId 
      ?? options.ctx?.request?.requestId
      ?? randomUUID();

    // Build metrics
    const metrics: Record<string, number> = { ...options.metrics };
    if (options.duration !== undefined) {
      metrics.duration = options.duration;
    }

    // Determine status
    let status = options.status;
    if (status === undefined && options.success !== undefined) {
      status = options.success ? 'completed' : 'failed';
    }

    // Build tags
    const tags: Record<string, string> = { ...options.tags };
    if (options.service) tags.service = options.service;
    if (options.externalSystem) tags.externalSystem = options.externalSystem;

    // Build data with external reference
    let data = options.data;
    if (options.externalId) {
      data = { ...data, externalId: options.externalId };
    }

    // Apply data protection
    if (data && options.dataProtection?.enabled !== false) {
      data = redactSensitiveData(data, options.dataProtection);
    }

    // Create capture input
    const input: CaptureInput = {
      type: 'audit',
      level: options.level ?? 'info',
      correlationId,
      operation: options.operation,
      subType: options.subType,
      entityName: options.entityName,
      entityId: options.entityId,
      status,
      success: options.success,
      actor,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
      data,
      metadata: options.metadata,
      metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
    };

    return ObservabilityManager.capture(input);

  } catch (error) {
    // Don't break business logic on observability failures
    logger.error('Failed to capture event', {
      error,
      operation: options.operation,
      entityName: options.entityName,
    });
    return undefined;
  }
}

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
export function captureBusinessError(
  error: Error | unknown,
  options: Omit<CaptureEventOptions, 'level' | 'success' | 'status'>
): string | undefined {
  const errorData = error instanceof Error
    ? { 
        errorType: error.name, 
        errorMessage: error.message, 
        errorStack: error.stack 
      }
    : { error: String(error) };

  return captureBusinessEvent({
    ...options,
    level: 'error',
    success: false,
    status: 'failed',
    data: { ...options.data, ...errorData }
  });
}

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
export function captureMetric(
  name: string,
  value: number,
  options?: {
    tags?: Record<string, string>;
    correlationId?: string;
    ctx?: ExecutionContext;
  }
): string | undefined {
  try {
    const correlationId = options?.correlationId 
      ?? options?.ctx?.actor?.correlationId 
      ?? randomUUID();

    const input: CaptureInput = {
      type: 'metric',
      level: 'info',
      correlationId,
      operation: name,
      metrics: { [name]: value },
      tags: options?.tags,
    };

    return ObservabilityManager.capture(input);

  } catch (error) {
    logger.error('Failed to capture metric', { error });
    return undefined;
  }
}

