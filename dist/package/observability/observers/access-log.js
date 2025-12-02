"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessLogObserver = void 0;
const context_1 = require("../context");
const base_1 = require("./base");
const OBSERVER_NAME = 'AccessLogObserver';
class AccessLogObserver {
    /**
     * Determine log level based on status code
     */
    static getLevelForStatus(statusCode) {
        if (statusCode >= 500)
            return 'error';
        if (statusCode >= 400)
            return 'warn';
        return 'info';
    }
    /**
     * Record API request
     */
    static request(options) {
        // For access logs, requestId can also serve as correlationId
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            correlationId: options.correlationId ?? options.requestId,
            actor: options.actor,
            source: options.source,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        const success = options.responseCode < 400;
        return (0, base_1.captureEvent)(fields, {
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
            error: options.error ? (0, base_1.mapError)(options.error) : undefined,
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
    static fromContext(request, response, actor, durationMs) {
        // Calculate content size
        let contentLength = 0;
        if (request.body) {
            try {
                contentLength = Buffer.byteLength(typeof request.body === 'string' ? request.body : JSON.stringify(request.body));
            }
            catch {
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
            userAgent: request.headers?.['user-agent'],
            sourceIp: request.requestContext?.identity?.sourceIp,
        });
    }
    /**
     * Create a request tracker for timing
     *
     * @returns Object with startTime and end() method
     */
    static requestStart(options) {
        const startTime = Date.now();
        const context = (0, context_1.getCurrentContext)();
        const requestId = options.requestId ?? context?.correlationId;
        return {
            startTime,
            end: (responseCode, error) => {
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
    static error(options) {
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
    static rateLimited(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            actor: options.actor,
            tags: options.tags,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
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
    static unauthorized(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            actor: options.actor,
            tags: options.tags,
            metadata: options.metadata,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
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
    static forbidden(options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, {
            actor: options.actor,
            tags: options.tags,
        });
        if (!fields)
            return undefined;
        return (0, base_1.captureEvent)(fields, {
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
exports.AccessLogObserver = AccessLogObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjZXNzLWxvZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9hY2Nlc3MtbG9nLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBd0JHOzs7QUFJSCx3Q0FBK0M7QUFFL0MsaUNBS2dCO0FBRWhCLE1BQU0sYUFBYSxHQUFHLG1CQUFtQixDQUFDO0FBZTFDLE1BQWEsaUJBQWlCO0lBRTVCOztPQUVHO0lBQ0ssTUFBTSxDQUFDLGlCQUFpQixDQUFDLFVBQWtCO1FBQ2pELElBQUksVUFBVSxJQUFJLEdBQUc7WUFBRSxPQUFPLE9BQU8sQ0FBQztRQUN0QyxJQUFJLFVBQVUsSUFBSSxHQUFHO1lBQUUsT0FBTyxNQUFNLENBQUM7UUFDckMsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUF5QjtRQUN0Qyw2REFBNkQ7UUFDN0QsTUFBTSxNQUFNLEdBQUcsSUFBQSx3QkFBaUIsRUFBQyxhQUFhLEVBQUU7WUFDOUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLFNBQVM7WUFDekQsS0FBSyxFQUFFLE9BQU8sQ0FBQyxLQUFLO1lBQ3BCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtZQUN0QixJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUk7WUFDbEIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO1NBQzNCLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTyxTQUFTLENBQUM7UUFFOUIsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLFlBQVksR0FBRyxHQUFHLENBQUM7UUFFM0MsT0FBTyxJQUFBLG1CQUFZLEVBQUMsTUFBTSxFQUFFO1lBQzFCLElBQUksRUFBRSxnQkFBZ0I7WUFDdEIsS0FBSyxFQUFFLElBQUksQ0FBQyxpQkFB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TyxFQUFFLFdBQVc7WUFDcEIsS0FBSyxFQUFFLE1BQU07WUFDYixTQUFTLEVBQUUsR0FBRyxPQUFPLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxJQUFJLEVBQUU7WUFDOUMsTUFBTSxFQUFFLEtBQUs7WUFDYixPQUFPLEVBQUUsS0FBSztZQUNkLElBQUksRUFBRTtnQkFDSixNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU07Z0JBQ3RCLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtnQkFDbEIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO2dCQUN0QixtQkFBbUIsRUFBRSxPQUFPLENBQUMsbUJBQW1CO2FBQ2pEO1lBQ0QsSUFBSSxFQUFFO2dCQUNKLEdBQUcsTUFBTSxDQUFDLElBQUk7Z0JBQ2QsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO2dCQUN0QixVQUFVLEVBQUUsS0FBSztnQkFDakIsU0FBUyxFQUFFLE1BQU07YUFDbEI7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqUkQsOENBaVJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBY2Nlc3NMb2dPYnNlcnZlciAtIEZvciBBUEkgYWNjZXNzIGxvZ2dpbmdcbiAqIFxuICogREVTSUdOIFBSSU5DSVBMRVM6XG4gKiAtIFJlcXVpcmVzIGNvcnJlbGF0aW9uSWQgZnJvbSBjb250ZXh0IG9yIGV4cGxpY2l0XG4gKiAtIENhcHR1cmVzIEhUVFAgcmVxdWVzdC9yZXNwb25zZSBkZXRhaWxzXG4gKiAtIEF1dG9tYXRpY2FsbHkgZGV0ZXJtaW5lcyBsZXZlbCBiYXNlZCBvbiBzdGF0dXMgY29kZVxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dFxuICogYXdhaXQgcnVuV2l0aENvbnRleHQoXG4gKiAgIGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChyZXF1ZXN0SWQsIHsgYWN0b3IgfSksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBBdCBlbmQgb2YgcmVxdWVzdFxuICogICAgIEFjY2Vzc0xvZ09ic2VydmVyLnJlcXVlc3Qoe1xuICogICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gKiAgICAgICBwYXRoOiAnL2FwaS9vcmRlcnMnLFxuICogICAgICAgcmVzcG9uc2VDb2RlOiAyMDEsXG4gKiAgICAgICBkdXJhdGlvbk1zOiAxNDUsXG4gKiAgICAgfSk7XG4gKiAgIH1cbiAqICk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgUmVxdWVzdCwgUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dCc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQge1xuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgY2FwdHVyZUV2ZW50LFxuICBtYXBFcnJvcixcbiAgQmFzZU9ic2VydmVyT3B0aW9ucyxcbn0gZnJvbSAnLi9iYXNlJztcblxuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdBY2Nlc3NMb2dPYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWNjZXNzTG9nT3B0aW9ucyBleHRlbmRzIEJhc2VPYnNlcnZlck9wdGlvbnMge1xuICBtZXRob2Q6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICByZXNwb25zZUNvZGU6IG51bWJlcjtcbiAgZHVyYXRpb25NczogbnVtYmVyO1xuICByZXF1ZXN0SWQ/OiBzdHJpbmc7XG4gIGNvbnRlbnRMZW5ndGg/OiBudW1iZXI7XG4gIHJlc3BvbnNlU2l6ZT86IG51bWJlcjtcbiAgdXNlckFnZW50Pzogc3RyaW5nO1xuICBzb3VyY2VJcD86IHN0cmluZztcbiAgZXJyb3I/OiBFcnJvcjtcbn1cblxuZXhwb3J0IGNsYXNzIEFjY2Vzc0xvZ09ic2VydmVyIHtcblxuICAvKipcbiAgICogRGV0ZXJtaW5lIGxvZyBsZXZlbCBiYXNlZCBvbiBzdGF0dXMgY29kZVxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0TGV2ZWxGb3JTdGF0dXMoc3RhdHVzQ29kZTogbnVtYmVyKTogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIHtcbiAgICBpZiAoc3RhdHVzQ29kZSA+PSA1MDApIHJldHVybiAnZXJyb3InO1xuICAgIGlmIChzdGF0dXNDb2RlID49IDQwMCkgcmV0dXJuICd3YXJuJztcbiAgICByZXR1cm4gJ2luZm8nO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCBBUEkgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIHJlcXVlc3Qob3B0aW9uczogQWNjZXNzTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgLy8gRm9yIGFjY2VzcyBsb2dzLCByZXF1ZXN0SWQgY2FuIGFsc28gc2VydmUgYXMgY29ycmVsYXRpb25JZFxuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnMuY29ycmVsYXRpb25JZCA/PyBvcHRpb25zLnJlcXVlc3RJZCxcbiAgICAgIGFjdG9yOiBvcHRpb25zLmFjdG9yLFxuICAgICAgc291cmNlOiBvcHRpb25zLnNvdXJjZSxcbiAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgIG1ldGFkYXRhOiBvcHRpb25zLm1ldGFkYXRhLFxuICAgIH0pO1xuICAgIGlmICghZmllbGRzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgY29uc3Qgc3VjY2VzcyA9IG9wdGlvbnMucmVzcG9uc2VDb2RlIDwgNDAwO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhY2Nlc3MucmVxdWVzdCcsXG4gICAgICBsZXZlbDogdGhpcy5nZXRMZXZlbEZvclN0YXR1cyhvcHRpb25zLnJlc3BvbnNlQ29kZSksXG4gICAgICBvcGVyYXRpb246IGAke29wdGlvbnMubWV0aG9kfSAke29wdGlvbnMucGF0aH1gLFxuICAgICAgc3RhdHVzOiBvcHRpb25zLnJlc3BvbnNlQ29kZS50b1N0cmluZygpLFxuICAgICAgc3VjY2VzcyxcbiAgICAgIGR1cmF0aW9uTXM6IG9wdGlvbnMuZHVyYXRpb25NcyxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgcGF0aDogb3B0aW9ucy5wYXRoLFxuICAgICAgICByZXNwb25zZUNvZGU6IG9wdGlvbnMucmVzcG9uc2VDb2RlLFxuICAgICAgICBjb250ZW50TGVuZ3RoOiBvcHRpb25zLmNvbnRlbnRMZW5ndGgsXG4gICAgICAgIHJlc3BvbnNlU2l6ZTogb3B0aW9ucy5yZXNwb25zZVNpemUsXG4gICAgICAgIHVzZXJBZ2VudDogb3B0aW9ucy51c2VyQWdlbnQgPz8gb3B0aW9ucy5hY3Rvcj8udXNlckFnZW50LFxuICAgICAgICBzb3VyY2VJcDogb3B0aW9ucy5zb3VyY2VJcCA/PyBvcHRpb25zLmFjdG9yPy5zb3VyY2VJcCxcbiAgICAgIH0sXG4gICAgICBlcnJvcjogb3B0aW9ucy5lcnJvciA/IG1hcEVycm9yKG9wdGlvbnMuZXJyb3IpIDogdW5kZWZpbmVkLFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5maWVsZHMudGFncyxcbiAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgc3RhdHVzQ29kZTogb3B0aW9ucy5yZXNwb25zZUNvZGUudG9TdHJpbmcoKSxcbiAgICAgICAgc3RhdHVzQ2xhc3M6IGAke01hdGguZmxvb3Iob3B0aW9ucy5yZXNwb25zZUNvZGUgLyAxMDApfXh4YCxcbiAgICAgIH0sXG4gICAgICBtZXRyaWNzOiB7XG4gICAgICAgIHJlc3BvbnNlVGltZTogb3B0aW9ucy5kdXJhdGlvbk1zLFxuICAgICAgICBzdGF0dXNDb2RlOiBvcHRpb25zLnJlc3BvbnNlQ29kZSxcbiAgICAgICAgLi4uKG9wdGlvbnMucmVzcG9uc2VTaXplICE9PSB1bmRlZmluZWQgJiYgeyByZXNwb25zZVNpemU6IG9wdGlvbnMucmVzcG9uc2VTaXplIH0pLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZnJvbSBGVzI0IFJlcXVlc3QvUmVzcG9uc2Ugb2JqZWN0c1xuICAgKiBcbiAgICogVXNlcyB0aGUgc2FtZSBwcm9wZXJ0eSBhY2Nlc3MgcGF0dGVybnMgYXMgQVBJQ29udHJvbGxlci5leHRyYWN0QWN0b3JDb250ZXh0XG4gICAqL1xuICBzdGF0aWMgZnJvbUNvbnRleHQoXG4gICAgcmVxdWVzdDogUmVxdWVzdCxcbiAgICByZXNwb25zZTogUmVzcG9uc2UsXG4gICAgYWN0b3I/OiBBY3RvcixcbiAgICBkdXJhdGlvbk1zPzogbnVtYmVyXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgLy8gQ2FsY3VsYXRlIGNvbnRlbnQgc2l6ZVxuICAgIGxldCBjb250ZW50TGVuZ3RoID0gMDtcbiAgICBpZiAocmVxdWVzdC5ib2R5KSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb250ZW50TGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoXG4gICAgICAgICAgdHlwZW9mIHJlcXVlc3QuYm9keSA9PT0gJ3N0cmluZycgPyByZXF1ZXN0LmJvZHkgOiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LmJvZHkpXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gSWdub3JlIHNlcmlhbGl6YXRpb24gZXJyb3JzXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVzcG9uc2UuYm9keSBpcyB0eXBlZCBhcyBzdHJpbmdcbiAgICBjb25zdCByZXNwb25zZVNpemUgPSByZXNwb25zZS5ib2R5ID8gQnVmZmVyLmJ5dGVMZW5ndGgocmVzcG9uc2UuYm9keSwgJ3V0ZjgnKSA6IDA7XG5cbiAgICByZXR1cm4gdGhpcy5yZXF1ZXN0KHtcbiAgICAgIG1ldGhvZDogcmVxdWVzdC5odHRwTWV0aG9kLFxuICAgICAgcGF0aDogcmVxdWVzdC5wYXRoLFxuICAgICAgcmVzcG9uc2VDb2RlOiByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgZHVyYXRpb25NczogZHVyYXRpb25NcyA/PyAwLFxuICAgICAgYWN0b3IsXG4gICAgICAvLyByZXF1ZXN0Q29udGV4dCBpcyB0eXBlZCBhcyBgYW55YCAtIGFjY2VzcyBkaXJlY3RseSBsaWtlIEFQSUNvbnRyb2xsZXIgZG9lc1xuICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LnJlcXVlc3RDb250ZXh0Py5yZXF1ZXN0SWQsXG4gICAgICBjb250ZW50TGVuZ3RoLFxuICAgICAgcmVzcG9uc2VTaXplLFxuICAgICAgdXNlckFnZW50OiByZXF1ZXN0LmhlYWRlcnM/LlsgJ3VzZXItYWdlbnQnIF0sXG4gICAgICBzb3VyY2VJcDogcmVxdWVzdC5yZXF1ZXN0Q29udGV4dD8uaWRlbnRpdHk/LnNvdXJjZUlwLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHJlcXVlc3QgdHJhY2tlciBmb3IgdGltaW5nXG4gICAqIFxuICAgKiBAcmV0dXJucyBPYmplY3Qgd2l0aCBzdGFydFRpbWUgYW5kIGVuZCgpIG1ldGhvZFxuICAgKi9cbiAgc3RhdGljIHJlcXVlc3RTdGFydChvcHRpb25zOiB7XG4gICAgbWV0aG9kOiBzdHJpbmc7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIHJlcXVlc3RJZD86IHN0cmluZztcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICB9KTogeyBlbmQ6IChyZXNwb25zZUNvZGU6IG51bWJlciwgZXJyb3I/OiBFcnJvcikgPT4gc3RyaW5nIHwgdW5kZWZpbmVkOyBzdGFydFRpbWU6IG51bWJlciB9IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IG9wdGlvbnMucmVxdWVzdElkID8/IGNvbnRleHQ/LmNvcnJlbGF0aW9uSWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhcnRUaW1lLFxuICAgICAgZW5kOiAocmVzcG9uc2VDb2RlOiBudW1iZXIsIGVycm9yPzogRXJyb3IpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdCh7XG4gICAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgICBwYXRoOiBvcHRpb25zLnBhdGgsXG4gICAgICAgICAgcmVzcG9uc2VDb2RlLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXG4gICAgICAgICAgYWN0b3I6IG9wdGlvbnMuYWN0b3IgPz8gY29udGV4dD8uYWN0b3IsXG4gICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkIEFQSSBlcnJvclxuICAgKi9cbiAgc3RhdGljIGVycm9yKG9wdGlvbnM6IHtcbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgZXJyb3I6IEVycm9yO1xuICAgIHJlc3BvbnNlQ29kZT86IG51bWJlcjtcbiAgICBkdXJhdGlvbk1zPzogbnVtYmVyO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnJlcXVlc3Qoe1xuICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgIHBhdGg6IG9wdGlvbnMucGF0aCxcbiAgICAgIHJlc3BvbnNlQ29kZTogb3B0aW9ucy5yZXNwb25zZUNvZGUgPz8gNTAwLFxuICAgICAgZHVyYXRpb25Nczogb3B0aW9ucy5kdXJhdGlvbk1zID8/IDAsXG4gICAgICBhY3Rvcjogb3B0aW9ucy5hY3RvcixcbiAgICAgIGVycm9yOiBvcHRpb25zLmVycm9yLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCByYXRlIGxpbWl0IGhpdFxuICAgKi9cbiAgc3RhdGljIHJhdGVMaW1pdGVkKG9wdGlvbnM6IHtcbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgYWN0b3I/OiBBY3RvcjtcbiAgICBsaW1pdD86IG51bWJlcjtcbiAgICByZW1haW5pbmc/OiBudW1iZXI7XG4gICAgcmVzZXRBdD86IG51bWJlcjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgfSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwge1xuICAgICAgYWN0b3I6IG9wdGlvbnMuYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgfSk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2FjY2Vzcy5yZXNwb25zZScsXG4gICAgICBzdWJUeXBlOiAncmF0ZV9saW1pdGVkJyxcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBvcGVyYXRpb246IGAke29wdGlvbnMubWV0aG9kfSAke29wdGlvbnMucGF0aH1gLFxuICAgICAgc3RhdHVzOiAnNDI5JyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZGF0YToge1xuICAgICAgICBtZXRob2Q6IG9wdGlvbnMubWV0aG9kLFxuICAgICAgICBwYXRoOiBvcHRpb25zLnBhdGgsXG4gICAgICAgIGxpbWl0OiBvcHRpb25zLmxpbWl0LFxuICAgICAgICByZW1haW5pbmc6IG9wdGlvbnMucmVtYWluaW5nLFxuICAgICAgICByZXNldEF0OiBvcHRpb25zLnJlc2V0QXQsXG4gICAgICB9LFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5maWVsZHMudGFncyxcbiAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgc3RhdHVzQ29kZTogJzQyOScsXG4gICAgICAgIHJhdGVMaW1pdGVkOiAndHJ1ZScsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZCB1bmF1dGhvcml6ZWQgYWNjZXNzIGF0dGVtcHRcbiAgICovXG4gIHN0YXRpYyB1bmF1dGhvcml6ZWQob3B0aW9uczoge1xuICAgIG1ldGhvZDogc3RyaW5nO1xuICAgIHBhdGg6IHN0cmluZztcbiAgICByZWFzb246IHN0cmluZztcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGFjdG9yOiBvcHRpb25zLmFjdG9yLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnMubWV0YWRhdGEsXG4gICAgfSk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2FjY2Vzcy5yZXNwb25zZScsXG4gICAgICBzdWJUeXBlOiAndW5hdXRob3JpemVkJyxcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBvcGVyYXRpb246IGAke29wdGlvbnMubWV0aG9kfSAke29wdGlvbnMucGF0aH1gLFxuICAgICAgc3RhdHVzOiAnNDAxJyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZGF0YToge1xuICAgICAgICBtZXRob2Q6IG9wdGlvbnMubWV0aG9kLFxuICAgICAgICBwYXRoOiBvcHRpb25zLnBhdGgsXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICB9LFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5maWVsZHMudGFncyxcbiAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgc3RhdHVzQ29kZTogJzQwMScsXG4gICAgICAgIHVuYXV0aG9yaXplZDogJ3RydWUnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgZm9yYmlkZGVuIGFjY2VzcyBhdHRlbXB0XG4gICAqL1xuICBzdGF0aWMgZm9yYmlkZGVuKG9wdGlvbnM6IHtcbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgcmVhc29uOiBzdHJpbmc7XG4gICAgYWN0b3I/OiBBY3RvcjtcbiAgICByZXF1aXJlZFBlcm1pc3Npb25zPzogc3RyaW5nW107XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH0pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIHtcbiAgICAgIGFjdG9yOiBvcHRpb25zLmFjdG9yLFxuICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgIH0pO1xuICAgIGlmICghZmllbGRzKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdhY2Nlc3MucmVzcG9uc2UnLFxuICAgICAgc3ViVHlwZTogJ2ZvcmJpZGRlbicsXG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgb3BlcmF0aW9uOiBgJHtvcHRpb25zLm1ldGhvZH0gJHtvcHRpb25zLnBhdGh9YCxcbiAgICAgIHN0YXR1czogJzQwMycsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgcGF0aDogb3B0aW9ucy5wYXRoLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICByZXF1aXJlZFBlcm1pc3Npb25zOiBvcHRpb25zLnJlcXVpcmVkUGVybWlzc2lvbnMsXG4gICAgICB9LFxuICAgICAgdGFnczoge1xuICAgICAgICAuLi5maWVsZHMudGFncyxcbiAgICAgICAgbWV0aG9kOiBvcHRpb25zLm1ldGhvZCxcbiAgICAgICAgc3RhdHVzQ29kZTogJzQwMycsXG4gICAgICAgIGZvcmJpZGRlbjogJ3RydWUnLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxufVxuIl19