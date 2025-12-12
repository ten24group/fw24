"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureBusinessEvent = captureBusinessEvent;
exports.captureBusinessError = captureBusinessError;
exports.captureMetric = captureMetric;
const manager_1 = require("../manager");
const data_protection_1 = require("../utils/data-protection");
const crypto_1 = require("crypto");
const logging_1 = require("../../logging");
const logger = (0, logging_1.createLogger)('CaptureHelper');
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
function captureBusinessEvent(options) {
    try {
        // Extract context
        const actor = options.actor ?? options.ctx?.actor;
        const correlationId = options.correlationId
            ?? options.ctx?.actor?.correlationId
            ?? options.ctx?.request?.requestId
            ?? (0, crypto_1.randomUUID)();
        // Build metrics
        const metrics = { ...options.metrics };
        if (options.duration !== undefined) {
            metrics.duration = options.duration;
        }
        // Determine status
        let status = options.status;
        if (status === undefined && options.success !== undefined) {
            status = options.success ? 'completed' : 'failed';
        }
        // Build tags
        const tags = { ...options.tags };
        if (options.service)
            tags.service = options.service;
        if (options.externalSystem)
            tags.externalSystem = options.externalSystem;
        // Build data with external reference
        let data = options.data;
        if (options.externalId) {
            data = { ...data, externalId: options.externalId };
        }
        // Apply data protection
        if (data && options.dataProtection?.enabled !== false) {
            data = (0, data_protection_1.redactSensitiveData)(data, options.dataProtection);
        }
        // Create capture input
        const input = {
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
        return manager_1.ObservabilityManager.capture(input);
    }
    catch (error) {
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
function captureBusinessError(error, options) {
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
function captureMetric(name, value, options) {
    try {
        const correlationId = options?.correlationId
            ?? options?.ctx?.actor?.correlationId
            ?? (0, crypto_1.randomUUID)();
        const input = {
            type: 'metric',
            level: 'info',
            correlationId,
            operation: name,
            metrics: { [name]: value },
            tags: options?.tags,
        };
        return manager_1.ObservabilityManager.capture(input);
    }
    catch (error) {
        logger.error('Failed to capture metric', { error });
        return undefined;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FwdHVyZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2hlbHBlcnMvY2FwdHVyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBNkJHOztBQTJGSCxvREFrRUM7QUFzQkQsb0RBbUJDO0FBWUQsc0NBNkJDO0FBM09ELHdDQUFrRDtBQUNsRCw4REFBcUY7QUFDckYsbUNBQW9DO0FBQ3BDLDJDQUE2QztBQUU3QyxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsZUFBZSxDQUFDLENBQUM7QUE2RDdDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRztBQUNILFNBQWdCLG9CQUFvQixDQUFDLE9BQTRCO0lBQy9ELElBQUksQ0FBQztRQUNILGtCQUFrQjtRQUNsQixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDO1FBQ2xELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhO2VBQ3RDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsS0FBSyxFQUFFLGFBQWE7ZUFDakMsT0FBTyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsU0FBUztlQUMvQixJQUFBLG1CQUFVLEdBQUUsQ0FBQztRQUVsQixnQkFBZ0I7UUFDaEIsTUFBTSxPQUFPLEdBQTJCLEVBQUUsR0FBRyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDL0QsSUFBSSxPQUFPLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ25DLE9BQU8sQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUN0QyxDQUFDO1FBRUQsbUJBQW1CO1FBQ25CLElBQUksTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUM7UUFDNUIsSUFBSSxNQUFNLEtBQUssU0FBUyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUss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S0FBSztRQUNkLE1BQU0sRUFBRSxRQUFRO1FBQ2hCLElBQUksRUFBRSxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLFNBQVMsRUFBRTtLQUN4QyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7Ozs7OztHQVNHO0FBQ0gsU0FBZ0IsYUFBYSxDQUMzQixJQUFZLEVBQ1osS0FBYSxFQUNiLE9BSUM7SUFFRCxJQUFJLENBQUM7UUFDSCxNQUFNLGFBQWEsR0FBRyxPQUFPLEVBQUUsYUFBYTtlQUN2QyxPQUFPLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxhQUFhO2VBQ2xDLElBQUEsbUJBQVUsR0FBRSxDQUFDO1FBRWxCLE1BQU0sS0FBSyxHQUFpQjtZQUMxQixJQUFJLEVBQUUsUUFBUTtZQUNkLEtBQUssRUFBRSxNQUFNO1lBQ2IsYUFBYTtZQUNiLFNBQVMsRUFBRSxJQUFJO1lBQ2YsT0FBTyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLEVBQUU7WUFDMUIsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJO1NBQ3BCLENBQUM7UUFFRixPQUFPLDhCQUFvQixDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUU3QyxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsMEJBQTBCLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ3BELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBBcHBsaWNhdGlvbi1MZXZlbCBDYXB0dXJlIEhlbHBlcnNcbiAqIFxuICogUHJvdmlkZXMgY29udmVuaWVudCBmdW5jdGlvbnMgZm9yIGFwcGxpY2F0aW9uIGNvZGUgdG8gY2FwdHVyZSBidXNpbmVzcyBldmVudHMsXG4gKiBlcnJvcnMsIGFuZCBtZXRyaWNzIHVzaW5nIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbS5cbiAqIFxuICogVGhlc2UgYXJlIGhpZ2hlci1sZXZlbCBoZWxwZXJzIHRoYXQgd3JhcCB0aGUgb2JzZXJ2ZXJzIGZvciBjb21tb24gdXNlIGNhc2VzLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEJ1c2luZXNzIGV2ZW50IHdpdGggbWV0cmljc1xuICogY2FwdHVyZUV2ZW50KHtcbiAqICAgb3BlcmF0aW9uOiAncGF5bWVudC5wcm9jZXNzZWQnLFxuICogICBlbnRpdHlOYW1lOiAncGF5bWVudCcsXG4gKiAgIGVudGl0eUlkOiBwYXltZW50LmlkLFxuICogICBzdWNjZXNzOiB0cnVlLFxuICogICBtZXRyaWNzOiB7IGFtb3VudDogMTAwMCwgY3VycmVuY3k6ICdVU0QnIH0sXG4gKiAgIGRhdGE6IHsgZ2F0ZXdheTogJ3N0cmlwZScgfSxcbiAqICAgY3R4OiBleGVjdXRpb25Db250ZXh0XG4gKiB9KTtcbiAqIFxuICogLy8gRXJyb3IgY2FwdHVyZVxuICogY2FwdHVyZUVycm9yKGVycm9yLCB7XG4gKiAgIG9wZXJhdGlvbjogJ3BheW1lbnQuZmFpbGVkJyxcbiAqICAgZW50aXR5TmFtZTogJ3BheW1lbnQnLFxuICogICBlbnRpdHlJZDogb3JkZXIuaWQsXG4gKiAgIGN0eDogZXhlY3V0aW9uQ29udGV4dFxuICogfSk7XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBBY3RvciwgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBDYXB0dXJlSW5wdXQgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4uL21hbmFnZXInO1xuaW1wb3J0IHsgcmVkYWN0U2Vuc2l0aXZlRGF0YSwgRGF0YVByb3RlY3Rpb25Db25maWcgfSBmcm9tICcuLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDYXB0dXJlSGVscGVyJyk7XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgY2FwdHVyaW5nIGFwcGxpY2F0aW9uIGV2ZW50c1xuICovXG5leHBvcnQgaW50ZXJmYWNlIENhcHR1cmVFdmVudE9wdGlvbnMge1xuICAvLyA9PT0gT1BFUkFUSU9OID09PVxuICAvKiogT3BlcmF0aW9uIG5hbWUgKGUuZy4sICdwYXltZW50LnByb2Nlc3NlZCcsICd1c2VyLmxvZ2luJykgKi9cbiAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIC8qKiBFdmVudCBzdWItdHlwZSBmb3IgY2xhc3NpZmljYXRpb24gKi9cbiAgc3ViVHlwZT86IHN0cmluZztcbiAgLyoqIExvZyBsZXZlbCAqL1xuICBsZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZztcblxuICAvLyA9PT0gRU5USVRZID09PVxuICAvKiogRW50aXR5IHR5cGUgYmVpbmcgb2JzZXJ2ZWQgKi9cbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgLyoqIEVudGl0eSBpbnN0YW5jZSBJRCAqL1xuICBlbnRpdHlJZD86IHN0cmluZztcblxuICAvLyA9PT0gT1VUQ09NRSA9PT1cbiAgLyoqIE9wZXJhdGlvbiBzdGF0dXMgKi9cbiAgc3RhdHVzPzogc3RyaW5nO1xuICAvKiogV2hldGhlciBvcGVyYXRpb24gc3VjY2VlZGVkICovXG4gIHN1Y2Nlc3M/OiBib29sZWFuO1xuXG4gIC8vID09PSBDT05URVhUID09PVxuICAvKiogU2VydmljZSBuYW1lICovXG4gIHNlcnZpY2U/OiBzdHJpbmc7XG4gIC8qKiBFeHRlcm5hbCBzeXN0ZW0gKHN0cmlwZSwgc2VuZGdyaWQsIGV0Yy4pICovXG4gIGV4dGVybmFsU3lzdGVtPzogc3RyaW5nO1xuICAvKiogRXh0ZXJuYWwgdHJhbnNhY3Rpb24vcmVmZXJlbmNlIElEICovXG4gIGV4dGVybmFsSWQ/OiBzdHJpbmc7XG5cbiAgLy8gPT09IE1FVFJJQ1MgPT09XG4gIC8qKiBOdW1lcmljIG1ldHJpY3MgKi9cbiAgbWV0cmljcz86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIC8qKiBEdXJhdGlvbiBpbiBtcyAoY29udmVuaWVuY2UgLSBhZGRlZCB0byBtZXRyaWNzKSAqL1xuICBkdXJhdGlvbj86IG51bWJlcjtcblxuICAvLyA9PT0gREFUQSA9PT1cbiAgLyoqIE1haW4gZGF0YSBwYXlsb2FkICovXG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIEFkZGl0aW9uYWwgbWV0YWRhdGEgKi9cbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFRhZ3MgZm9yIGZpbHRlcmluZyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcblxuICAvLyA9PT0gQ09OVEVYVCBFWFRSQUNUSU9OID09PVxuICAvKiogRXhlY3V0aW9uQ29udGV4dCBmb3IgYWN0b3IvY29ycmVsYXRpb25JZCBleHRyYWN0aW9uICovXG4gIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQ7XG4gIC8qKiBFeHBsaWNpdCBhY3RvciAob3ZlcnJpZGVzIGN0eC5hY3RvcikgKi9cbiAgYWN0b3I/OiBBY3RvcjtcbiAgLyoqIEV4cGxpY2l0IGNvcnJlbGF0aW9uIElEIChvdmVycmlkZXMgY3R4IGV4dHJhY3Rpb24pICovXG4gIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG5cbiAgLy8gPT09IERBVEEgUFJPVEVDVElPTiA9PT1cbiAgLyoqIERhdGEgcHJvdGVjdGlvbiBjb25maWd1cmF0aW9uICovXG4gIGRhdGFQcm90ZWN0aW9uPzogRGF0YVByb3RlY3Rpb25Db25maWc7XG59XG5cbi8qKlxuICogQ2FwdHVyZSBhIGJ1c2luZXNzL2FwcGxpY2F0aW9uIGV2ZW50IHRocm91Z2ggdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtLlxuICogXG4gKiBUaGlzIGlzIGEgY29udmVuaWVuY2Ugd3JhcHBlciB0aGF0OlxuICogLSBFeHRyYWN0cyBhY3Rvci9jb3JyZWxhdGlvbklkIGZyb20gRXhlY3V0aW9uQ29udGV4dFxuICogLSBBcHBsaWVzIGRhdGEgcHJvdGVjdGlvbiBhdXRvbWF0aWNhbGx5XG4gKiAtIEhhbmRsZXMgZXJyb3JzIGdyYWNlZnVsbHkgKHdvbid0IGJyZWFrIGJ1c2luZXNzIGxvZ2ljKVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY2FwdHVyZUJ1c2luZXNzRXZlbnQoe1xuICogICBvcGVyYXRpb246ICdvcmRlci5zaGlwcGVkJyxcbiAqICAgZW50aXR5TmFtZTogJ29yZGVyJyxcbiAqICAgZW50aXR5SWQ6IG9yZGVyLmlkLFxuICogICBzdWNjZXNzOiB0cnVlLFxuICogICBkYXRhOiB7IHRyYWNraW5nTnVtYmVyOiAnMTIzNCcgfSxcbiAqICAgbWV0cmljczogeyBpdGVtQ291bnQ6IDUgfSxcbiAqICAgY3R4OiBleGVjdXRpb25Db250ZXh0XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZUJ1c2luZXNzRXZlbnQob3B0aW9uczogQ2FwdHVyZUV2ZW50T3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHRyeSB7XG4gICAgLy8gRXh0cmFjdCBjb250ZXh0XG4gICAgY29uc3QgYWN0b3IgPSBvcHRpb25zLmFjdG9yID8/IG9wdGlvbnMuY3R4Py5hY3RvcjtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucy5jb3JyZWxhdGlvbklkIFxuICAgICAgPz8gb3B0aW9ucy5jdHg/LmFjdG9yPy5jb3JyZWxhdGlvbklkIFxuICAgICAgPz8gb3B0aW9ucy5jdHg/LnJlcXVlc3Q/LnJlcXVlc3RJZFxuICAgICAgPz8gcmFuZG9tVVVJRCgpO1xuXG4gICAgLy8gQnVpbGQgbWV0cmljc1xuICAgIGNvbnN0IG1ldHJpY3M6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7IC4uLm9wdGlvbnMubWV0cmljcyB9O1xuICAgIGlmIChvcHRpb25zLmR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIG1ldHJpY3MuZHVyYXRpb24gPSBvcHRpb25zLmR1cmF0aW9uO1xuICAgIH1cblxuICAgIC8vIERldGVybWluZSBzdGF0dXNcbiAgICBsZXQgc3RhdHVzID0gb3B0aW9ucy5zdGF0dXM7XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkICYmIG9wdGlvbnMuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBzdGF0dXMgPSBvcHRpb25zLnN1Y2Nlc3MgPyAnY29tcGxldGVkJyA6ICdmYWlsZWQnO1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIHRhZ3NcbiAgICBjb25zdCB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyAuLi5vcHRpb25zLnRhZ3MgfTtcbiAgICBpZiAob3B0aW9ucy5zZXJ2aWNlKSB0YWdzLnNlcnZpY2UgPSBvcHRpb25zLnNlcnZpY2U7XG4gICAgaWYgKG9wdGlvbnMuZXh0ZXJuYWxTeXN0ZW0pIHRhZ3MuZXh0ZXJuYWxTeXN0ZW0gPSBvcHRpb25zLmV4dGVybmFsU3lzdGVtO1xuXG4gICAgLy8gQnVpbGQgZGF0YSB3aXRoIGV4dGVybmFsIHJlZmVyZW5jZVxuICAgIGxldCBkYXRhID0gb3B0aW9ucy5kYXRhO1xuICAgIGlmIChvcHRpb25zLmV4dGVybmFsSWQpIHtcbiAgICAgIGRhdGEgPSB7IC4uLmRhdGEsIGV4dGVybmFsSWQ6IG9wdGlvbnMuZXh0ZXJuYWxJZCB9O1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGRhdGEgcHJvdGVjdGlvblxuICAgIGlmIChkYXRhICYmIG9wdGlvbnMuZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICBkYXRhID0gcmVkYWN0U2Vuc2l0aXZlRGF0YShkYXRhLCBvcHRpb25zLmRhdGFQcm90ZWN0aW9uKTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgY2FwdHVyZSBpbnB1dFxuICAgIGNvbnN0IGlucHV0OiBDYXB0dXJlSW5wdXQgPSB7XG4gICAgICB0eXBlOiAnYXVkaXQnLFxuICAgICAgbGV2ZWw6IG9wdGlvbnMubGV2ZWwgPz8gJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBzdWJUeXBlOiBvcHRpb25zLnN1YlR5cGUsXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucy5lbnRpdHlJZCxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHN1Y2Nlc3M6IG9wdGlvbnMuc3VjY2VzcyxcbiAgICAgIGFjdG9yLFxuICAgICAgdGFnczogT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMCA/IHRhZ3MgOiB1bmRlZmluZWQsXG4gICAgICBkYXRhLFxuICAgICAgbWV0YWRhdGE6IG9wdGlvbnMubWV0YWRhdGEsXG4gICAgICBtZXRyaWNzOiBPYmplY3Qua2V5cyhtZXRyaWNzKS5sZW5ndGggPiAwID8gbWV0cmljcyA6IHVuZGVmaW5lZCxcbiAgICB9O1xuXG4gICAgcmV0dXJuIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQpO1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgLy8gRG9uJ3QgYnJlYWsgYnVzaW5lc3MgbG9naWMgb24gb2JzZXJ2YWJpbGl0eSBmYWlsdXJlc1xuICAgIGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGNhcHR1cmUgZXZlbnQnLCB7XG4gICAgICBlcnJvcixcbiAgICAgIG9wZXJhdGlvbjogb3B0aW9ucy5vcGVyYXRpb24sXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zLmVudGl0eU5hbWUsXG4gICAgfSk7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKipcbiAqIENhcHR1cmUgYW4gZXJyb3IgdGhyb3VnaCB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIENvbnZlbmllbmNlIGZ1bmN0aW9uIHRoYXQgcHJvcGVybHkgZm9ybWF0cyBlcnJvciBvYmplY3RzLlxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdHJ5IHtcbiAqICAgYXdhaXQgcHJvY2Vzc1BheW1lbnQob3JkZXIpO1xuICogfSBjYXRjaCAoZXJyb3IpIHtcbiAqICAgY2FwdHVyZUVycm9yKGVycm9yLCB7XG4gKiAgICAgb3BlcmF0aW9uOiAncGF5bWVudC5mYWlsZWQnLFxuICogICAgIGVudGl0eU5hbWU6ICdwYXltZW50JyxcbiAqICAgICBlbnRpdHlJZDogb3JkZXIuaWQsXG4gKiAgICAgY3R4OiBleGVjdXRpb25Db250ZXh0XG4gKiAgIH0pO1xuICogICB0aHJvdyBlcnJvcjtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZUJ1c2luZXNzRXJyb3IoXG4gIGVycm9yOiBFcnJvciB8IHVua25vd24sXG4gIG9wdGlvbnM6IE9taXQ8Q2FwdHVyZUV2ZW50T3B0aW9ucywgJ2xldmVsJyB8ICdzdWNjZXNzJyB8ICdzdGF0dXMnPlxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgZXJyb3JEYXRhID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxuICAgID8geyBcbiAgICAgICAgZXJyb3JUeXBlOiBlcnJvci5uYW1lLCBcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBlcnJvci5tZXNzYWdlLCBcbiAgICAgICAgZXJyb3JTdGFjazogZXJyb3Iuc3RhY2sgXG4gICAgICB9XG4gICAgOiB7IGVycm9yOiBTdHJpbmcoZXJyb3IpIH07XG5cbiAgcmV0dXJuIGNhcHR1cmVCdXNpbmVzc0V2ZW50KHtcbiAgICAuLi5vcHRpb25zLFxuICAgIGxldmVsOiAnZXJyb3InLFxuICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgZGF0YTogeyAuLi5vcHRpb25zLmRhdGEsIC4uLmVycm9yRGF0YSB9XG4gIH0pO1xufVxuXG4vKipcbiAqIENhcHR1cmUgYSBtZXRyaWMgdGhyb3VnaCB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjYXB0dXJlTWV0cmljKCdhcGkubGF0ZW5jeScsIDE1MCwge1xuICogICB0YWdzOiB7IGVuZHBvaW50OiAnL3VzZXJzJywgbWV0aG9kOiAnR0VUJyB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FwdHVyZU1ldHJpYyhcbiAgbmFtZTogc3RyaW5nLFxuICB2YWx1ZTogbnVtYmVyLFxuICBvcHRpb25zPzoge1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dDtcbiAgfVxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucz8uY29ycmVsYXRpb25JZCBcbiAgICAgID8/IG9wdGlvbnM/LmN0eD8uYWN0b3I/LmNvcnJlbGF0aW9uSWQgXG4gICAgICA/PyByYW5kb21VVUlEKCk7XG5cbiAgICBjb25zdCBpbnB1dDogQ2FwdHVyZUlucHV0ID0ge1xuICAgICAgdHlwZTogJ21ldHJpYycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIG9wZXJhdGlvbjogbmFtZSxcbiAgICAgIG1ldHJpY3M6IHsgW25hbWVdOiB2YWx1ZSB9LFxuICAgICAgdGFnczogb3B0aW9ucz8udGFncyxcbiAgICB9O1xuXG4gICAgcmV0dXJuIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQpO1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gY2FwdHVyZSBtZXRyaWMnLCB7IGVycm9yIH0pO1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cblxuIl19