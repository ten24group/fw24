/**
 * AccessLogObserver - For API access logging
 * 
 * DESIGN PRINCIPLES:
 * - Requires correlationId from context or explicit
 * - Captures HTTP request/response details
 * - Automatically determines level based on status code
 * 
 * Usage:
 * ```typescript
 * // FIRST: Establish context
 * await runWithContext(
 *   createObservationContext(requestId, { actor }),
 *   async () => {
 *     // At end of request
 *     AccessLogObserver.request({
 *       method: 'POST',
 *       path: '/api/orders',
 *       responseCode: 201,
 *       durationMs: 145,
 *     });
 *   }
 * );
 * ```
 */

import { Actor } from '../../core/types/execution-context';
import { Request, Response } from '../../interfaces';
import { getCurrentContext } from '../context';
import { ObservabilityLevelString } from '../types';
import {
  buildCommonFields,
  captureEvent,
  mapError,
  BaseObserverOptions,
} from './base';

const OBSERVER_NAME = 'AccessLogObserver';

export interface AccessLogOptions extends BaseObserverOptions {
  method: string;
  path: string;
  responseCode: number;
  durationMs: number;
  requestId?: string;
  contentLength?: number;
  responseSize?: number;
  userAgent?: string;
  sourceIp?: string;
  error?: Error;
}

export class AccessLogObserver {

  /**
   * Determine log level based on status code
   */
  private static getLevelForStatus(statusCode: number): ObservabilityLevelString {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  /**
   * Record API request
   */
  static request(options: AccessLogOptions): string | undefined {
    // For access logs, requestId can also serve as correlationId
    const fields = buildCommonFields(OBSERVER_NAME, {
      correlationId: options.correlationId ?? options.requestId,
      actor: options.actor,
      source: options.source,
      tags: options.tags,
      metadata: options.metadata,
    });
    if (!fields) return undefined;

    const success = options.responseCode < 400;

    return captureEvent(fields, {
      type: 'access.request',
      level: this.getLevelForStatus(options.responseCode),
      operation: `${options.method} ${options.path}`,
      status: options.responseCode.toString(),
      success,
      durationMs: options.durationMs,
      data: {
        method: options.method,
        path: options.path,
        responseCode: options.responseCode,
        contentLength: options.contentLength,
        responseSize: options.responseSize,
        userAgent: options.userAgent ?? options.actor?.userAgent,
        sourceIp: options.sourceIp ?? options.actor?.sourceIp,
      },
      error: options.error ? mapError(options.error) : undefined,
      tags: {
        ...fields.tags,
        method: options.method,
        statusCode: options.responseCode.toString(),
        statusClass: `${Math.floor(options.responseCode / 100)}xx`,
      },
      metrics: {
        responseTime: options.durationMs,
        statusCode: options.responseCode,
        ...(options.responseSize !== undefined && { responseSize: options.responseSize }),
      },
    });
  }

  /**
   * Record from FW24 Request/Response objects
   * 
   * Uses the same property access patterns as APIController.extractActorContext
   */
  static fromContext(
    request: Request,
    response: Response,
    actor?: Actor,
    durationMs?: number
  ): string | undefined {
    // Calculate content size
    let contentLength = 0;
    if (request.body) {
      try {
        contentLength = Buffer.byteLength(
          typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
        );
      } catch {
        // Ignore serialization errors
      }
    }

    // Response.body is typed as string
    const responseSize = response.body ? Buffer.byteLength(response.body, 'utf8') : 0;

    return this.request({
      method: request.httpMethod,
      path: request.path,
      responseCode: response.statusCode,
      durationMs: durationMs ?? 0,
      actor,
      // requestContext is typed as `any` - access directly like APIController does
      requestId: request.requestContext?.requestId,
      contentLength,
      responseSize,
      userAgent: request.headers?.[ 'user-agent' ],
      sourceIp: request.requestContext?.identity?.sourceIp,
    });
  }

  /**
   * Create a request tracker for timing
   * 
   * @returns Object with startTime and end() method
   */
  static requestStart(options: {
    method: string;
    path: string;
    requestId?: string;
    actor?: Actor;
    tags?: Record<string, string>;
  }): { end: (responseCode: number, error?: Error) => string | undefined; startTime: number } {
    const startTime = Date.now();
    const context = getCurrentContext();
    const requestId = options.requestId ?? context?.correlationId;

    return {
      startTime,
      end: (responseCode: number, error?: Error) => {
        return this.request({
          method: options.method,
          path: options.path,
          responseCode,
          durationMs: Date.now() - startTime,
          actor: options.actor ?? context?.actor,
          requestId,
          error,
          tags: options.tags,
        });
      },
    };
  }

  /**
   * Record API error
   */
  static error(options: {
    method: string;
    path: string;
    error: Error;
    responseCode?: number;
    durationMs?: number;
    actor?: Actor;
    tags?: Record<string, string>;
  }): string | undefined {
    return this.request({
      method: options.method,
      path: options.path,
      responseCode: options.responseCode ?? 500,
      durationMs: options.durationMs ?? 0,
      actor: options.actor,
      error: options.error,
      tags: options.tags,
    });
  }

  /**
   * Record rate limit hit
   */
  static rateLimited(options: {
    method: string;
    path: string;
    actor?: Actor;
    limit?: number;
    remaining?: number;
    resetAt?: number;
    tags?: Record<string, string>;
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      actor: options.actor,
      tags: options.tags,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
      type: 'access.response',
      subType: 'rate_limited',
      level: 'warn',
      operation: `${options.method} ${options.path}`,
      status: '429',
      success: false,
      data: {
        method: options.method,
        path: options.path,
        limit: options.limit,
        remaining: options.remaining,
        resetAt: options.resetAt,
      },
      tags: {
        ...fields.tags,
        method: options.method,
        statusCode: '429',
        rateLimited: 'true',
      },
    });
  }

  /**
   * Record unauthorized access attempt
   */
  static unauthorized(options: {
    method: string;
    path: string;
    reason: string;
    actor?: Actor;
    metadata?: Record<string, unknown>;
    tags?: Record<string, string>;
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      actor: options.actor,
      tags: options.tags,
      metadata: options.metadata,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
      type: 'access.response',
      subType: 'unauthorized',
      level: 'warn',
      operation: `${options.method} ${options.path}`,
      status: '401',
      success: false,
      data: {
        method: options.method,
        path: options.path,
        reason: options.reason,
      },
      tags: {
        ...fields.tags,
        method: options.method,
        statusCode: '401',
        unauthorized: 'true',
      },
    });
  }

  /**
   * Record forbidden access attempt
   */
  static forbidden(options: {
    method: string;
    path: string;
    reason: string;
    actor?: Actor;
    requiredPermissions?: string[];
    tags?: Record<string, string>;
  }): string | undefined {
    const fields = buildCommonFields(OBSERVER_NAME, {
      actor: options.actor,
      tags: options.tags,
    });
    if (!fields) return undefined;

    return captureEvent(fields, {
      type: 'access.response',
      subType: 'forbidden',
      level: 'warn',
      operation: `${options.method} ${options.path}`,
      status: '403',
      success: false,
      data: {
        method: options.method,
        path: options.path,
        reason: options.reason,
        requiredPermissions: options.requiredPermissions,
      },
      tags: {
        ...fields.tags,
        method: options.method,
        statusCode: '403',
        forbidden: 'true',
      },
    });
  }
}
