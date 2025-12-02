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
import { BaseObserverOptions } from './base';
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
export declare class AccessLogObserver {
    /**
     * Determine log level based on status code
     */
    private static getLevelForStatus;
    /**
     * Record API request
     */
    static request(options: AccessLogOptions): string | undefined;
    /**
     * Record from FW24 Request/Response objects
     *
     * Uses the same property access patterns as APIController.extractActorContext
     */
    static fromContext(request: Request, response: Response, actor?: Actor, durationMs?: number): string | undefined;
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
    }): {
        end: (responseCode: number, error?: Error) => string | undefined;
        startTime: number;
    };
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
    }): string | undefined;
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
    }): string | undefined;
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
    }): string | undefined;
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
    }): string | undefined;
}
