"use strict";
/**
 * LogObserver - For simple structured logging
 *
 * Provides a simple API for structured logging that integrates with
 * the observability system. Unlike raw console.log, these logs:
 * - Include correlationId for distributed tracing
 * - Have proper severity levels
 * - Go through configured backends (CloudWatch, DynamoDB, etc.)
 * - Can be sampled/filtered
 *
 * Usage:
 * ```typescript
 * // FIRST: Establish context (usually done by middleware)
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Simple logging
 *     LogObserver.info('User logged in', { userId });
 *     LogObserver.warn('Rate limit approaching', { current: 90, limit: 100 });
 *     LogObserver.error('Payment failed', { orderId, error: err.message });
 *
 *     // With additional options
 *     LogObserver.debug('Cache lookup', { key, hit: true }, {
 *       tags: { component: 'cache' }
 *     });
 *   }
 * );
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChildLogObserver = exports.LogObserver = void 0;
const base_1 = require("./base");
const OBSERVER_NAME = 'LogObserver';
class LogObserver {
    /**
     * Log at TRACE level (most verbose)
     */
    static trace(message, data, options) {
        return this.log('trace', message, data, options);
    }
    /**
     * Log at DEBUG level
     */
    static debug(message, data, options) {
        return this.log('debug', message, data, options);
    }
    /**
     * Log at INFO level
     */
    static info(message, data, options) {
        return this.log('info', message, data, options);
    }
    /**
     * Log at WARN level
     */
    static warn(message, data, options) {
        return this.log('warn', message, data, options);
    }
    /**
     * Log at ERROR level
     */
    static error(message, errorOrData, options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        const isError = errorOrData instanceof Error;
        const data = isError ? { errorMessage: errorOrData.message } : errorOrData;
        const error = isError ? (0, base_1.mapError)(errorOrData) : undefined;
        // Don't duplicate message - it's already in `operation`
        return (0, base_1.captureEvent)(fields, {
            type: 'log',
            level: 'error',
            operation: message,
            data,
            attributes: options?.attributes,
            entityName: options?.entityName,
            entityId: options?.entityId,
            error,
        });
    }
    /**
     * Log at CRITICAL level (most severe, bypasses sampling)
     */
    static critical(message, errorOrData, options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        const isError = errorOrData instanceof Error;
        const data = isError ? { errorMessage: errorOrData.message } : errorOrData;
        const error = isError ? (0, base_1.mapError)(errorOrData) : undefined;
        // Don't duplicate message - it's already in `operation`
        return (0, base_1.captureEvent)(fields, {
            type: 'log',
            level: 'critical',
            operation: message,
            data,
            attributes: options?.attributes,
            entityName: options?.entityName,
            entityId: options?.entityId,
            error,
        }, { critical: true });
    }
    /**
     * Core log method
     */
    static log(level, message, data, options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        if (!fields)
            return undefined;
        // Don't duplicate message - it's already in `operation`
        return (0, base_1.captureEvent)(fields, {
            type: 'log',
            level,
            operation: message,
            data,
            attributes: options?.attributes,
            entityName: options?.entityName,
            entityId: options?.entityId,
        });
    }
    /**
     * Create a child logger with preset tags/options
     * Useful for component-specific logging
     */
    static createChild(defaultOptions) {
        return new ChildLogObserver(defaultOptions);
    }
}
exports.LogObserver = LogObserver;
/**
 * Child logger with preset options
 */
class ChildLogObserver {
    defaults;
    constructor(defaults) {
        this.defaults = defaults;
    }
    trace(message, data, options) {
        return LogObserver.trace(message, data, this.mergeOptions(options));
    }
    debug(message, data, options) {
        return LogObserver.debug(message, data, this.mergeOptions(options));
    }
    info(message, data, options) {
        return LogObserver.info(message, data, this.mergeOptions(options));
    }
    warn(message, data, options) {
        return LogObserver.warn(message, data, this.mergeOptions(options));
    }
    error(message, errorOrData, options) {
        return LogObserver.error(message, errorOrData, this.mergeOptions(options));
    }
    critical(message, errorOrData, options) {
        return LogObserver.critical(message, errorOrData, this.mergeOptions(options));
    }
    mergeOptions(options) {
        return {
            ...this.defaults,
            ...options,
            tags: { ...this.defaults.tags, ...options?.tags },
            attributes: { ...this.defaults.attributes, ...options?.attributes },
        };
    }
}
exports.ChildLogObserver = ChildLogObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL2xvZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Qkc7OztBQUlILGlDQUtnQjtBQUVoQixNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUM7QUFXcEMsTUFBYSxXQUFXO0lBRXRCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFlLEVBQUUsSUFBOEIsRUFBRSxPQUFvQjtRQUNoRixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFlLEVBQUUsSUFBOEIsRUFBRSxPQUFvQjtRQUNoRixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDbkQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFlLEVBQUUsSUFBOEIsRUFBRSxPQUFvQjtRQUMvRSxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDbEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFlLEVBQUUsSUFBOEIsRUFBRSxPQUFvQjtRQUMvRSxPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDbEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FDVixPQUFlLEVBQ2YsV0FBNkMsRUFDN0MsT0FBb0I7UUFFcEIs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LFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0lBQ2hGLENBQUM7SUFFTyxZQUFZLENBQUMsT0FBb0I7UUFDdkMsT0FBTztZQUNMLEdBQUcsSUFBSSxDQUFDLFFBQVE7WUFDaEIsR0FBRyxPQUFPO1lBQ1YsSUFBSSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLE9BQU8sRUFBRSxJQUFJLEVBQUU7WUFDakQsVUFBVSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxHQUFHLE9BQU8sRUFBRSxVQUFVLEVBQUU7U0FDcEUsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQW5DRCw0Q0FtQ0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExvZ09ic2VydmVyIC0gRm9yIHNpbXBsZSBzdHJ1Y3R1cmVkIGxvZ2dpbmdcbiAqIFxuICogUHJvdmlkZXMgYSBzaW1wbGUgQVBJIGZvciBzdHJ1Y3R1cmVkIGxvZ2dpbmcgdGhhdCBpbnRlZ3JhdGVzIHdpdGhcbiAqIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbS4gVW5saWtlIHJhdyBjb25zb2xlLmxvZywgdGhlc2UgbG9nczpcbiAqIC0gSW5jbHVkZSBjb3JyZWxhdGlvbklkIGZvciBkaXN0cmlidXRlZCB0cmFjaW5nXG4gKiAtIEhhdmUgcHJvcGVyIHNldmVyaXR5IGxldmVsc1xuICogLSBHbyB0aHJvdWdoIGNvbmZpZ3VyZWQgYmFja2VuZHMgKENsb3VkV2F0Y2gsIER5bmFtb0RCLCBldGMuKVxuICogLSBDYW4gYmUgc2FtcGxlZC9maWx0ZXJlZFxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dCAodXN1YWxseSBkb25lIGJ5IG1pZGRsZXdhcmUpXG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBTaW1wbGUgbG9nZ2luZ1xuICogICAgIExvZ09ic2VydmVyLmluZm8oJ1VzZXIgbG9nZ2VkIGluJywgeyB1c2VySWQgfSk7XG4gKiAgICAgTG9nT2JzZXJ2ZXIud2FybignUmF0ZSBsaW1pdCBhcHByb2FjaGluZycsIHsgY3VycmVudDogOTAsIGxpbWl0OiAxMDAgfSk7XG4gKiAgICAgTG9nT2JzZXJ2ZXIuZXJyb3IoJ1BheW1lbnQgZmFpbGVkJywgeyBvcmRlcklkLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gKiAgICAgXG4gKiAgICAgLy8gV2l0aCBhZGRpdGlvbmFsIG9wdGlvbnNcbiAqICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnQ2FjaGUgbG9va3VwJywgeyBrZXksIGhpdDogdHJ1ZSB9LCB7IFxuICogICAgICAgdGFnczogeyBjb21wb25lbnQ6ICdjYWNoZScgfSBcbiAqICAgICB9KTtcbiAqICAgfVxuICogKTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IEFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQge1xuICBCYXNlT2JzZXJ2ZXJPcHRpb25zLFxuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgY2FwdHVyZUV2ZW50LFxuICBtYXBFcnJvcixcbn0gZnJvbSAnLi9iYXNlJztcblxuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdMb2dPYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nT3B0aW9ucyBleHRlbmRzIEJhc2VPYnNlcnZlck9wdGlvbnMge1xuICAvKiogQWRkaXRpb25hbCBhdHRyaWJ1dGVzICovXG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIEVudGl0eSBuYW1lIGZvciBjb250ZXh0ICovXG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIC8qKiBFbnRpdHkgSUQgZm9yIGNvbnRleHQgKi9cbiAgZW50aXR5SWQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBMb2dPYnNlcnZlciB7XG5cbiAgLyoqXG4gICAqIExvZyBhdCBUUkFDRSBsZXZlbCAobW9zdCB2ZXJib3NlKVxuICAgKi9cbiAgc3RhdGljIHRyYWNlKG1lc3NhZ2U6IHN0cmluZywgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMubG9nKCd0cmFjZScsIG1lc3NhZ2UsIGRhdGEsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBERUJVRyBsZXZlbFxuICAgKi9cbiAgc3RhdGljIGRlYnVnKG1lc3NhZ2U6IHN0cmluZywgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMubG9nKCdkZWJ1ZycsIG1lc3NhZ2UsIGRhdGEsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBJTkZPIGxldmVsXG4gICAqL1xuICBzdGF0aWMgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmxvZygnaW5mbycsIG1lc3NhZ2UsIGRhdGEsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBXQVJOIGxldmVsXG4gICAqL1xuICBzdGF0aWMgd2FybihtZXNzYWdlOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmxvZygnd2FybicsIG1lc3NhZ2UsIGRhdGEsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBFUlJPUiBsZXZlbFxuICAgKi9cbiAgc3RhdGljIGVycm9yKFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBlcnJvck9yRGF0YT86IEVycm9yIHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgb3B0aW9ucz86IExvZ09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IGlzRXJyb3IgPSBlcnJvck9yRGF0YSBpbnN0YW5jZW9mIEVycm9yO1xuICAgIGNvbnN0IGRhdGEgPSBpc0Vycm9yID8geyBlcnJvck1lc3NhZ2U6IGVycm9yT3JEYXRhLm1lc3NhZ2UgfSA6IGVycm9yT3JEYXRhO1xuICAgIGNvbnN0IGVycm9yID0gaXNFcnJvciA/IG1hcEVycm9yKGVycm9yT3JEYXRhKSA6IHVuZGVmaW5lZDtcblxuICAgIC8vIERvbid0IGR1cGxpY2F0ZSBtZXNzYWdlIC0gaXQncyBhbHJlYWR5IGluIGBvcGVyYXRpb25gXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBvcGVyYXRpb246IG1lc3NhZ2UsXG4gICAgICBkYXRhLFxuICAgICAgYXR0cmlidXRlczogb3B0aW9ucz8uYXR0cmlidXRlcyxcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnM/LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucz8uZW50aXR5SWQsXG4gICAgICBlcnJvcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgYXQgQ1JJVElDQUwgbGV2ZWwgKG1vc3Qgc2V2ZXJlLCBieXBhc3NlcyBzYW1wbGluZylcbiAgICovXG4gIHN0YXRpYyBjcml0aWNhbChcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgZXJyb3JPckRhdGE/OiBFcnJvciB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIG9wdGlvbnM/OiBMb2dPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG4gICAgaWYgKCFmaWVsZHMpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBpc0Vycm9yID0gZXJyb3JPckRhdGEgaW5zdGFuY2VvZiBFcnJvcjtcbiAgICBjb25zdCBkYXRhID0gaXNFcnJvciA/IHsgZXJyb3JNZXNzYWdlOiBlcnJvck9yRGF0YS5tZXNzYWdlIH0gOiBlcnJvck9yRGF0YTtcbiAgICBjb25zdCBlcnJvciA9IGlzRXJyb3IgPyBtYXBFcnJvcihlcnJvck9yRGF0YSkgOiB1bmRlZmluZWQ7XG5cbiAgICAvLyBEb24ndCBkdXBsaWNhdGUgbWVzc2FnZSAtIGl0J3MgYWxyZWFkeSBpbiBgb3BlcmF0aW9uYFxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnY3JpdGljYWwnLFxuICAgICAgb3BlcmF0aW9uOiBtZXNzYWdlLFxuICAgICAgZGF0YSxcbiAgICAgIGF0dHJpYnV0ZXM6IG9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zPy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnM/LmVudGl0eUlkLFxuICAgICAgZXJyb3IsXG4gICAgfSwgeyBjcml0aWNhbDogdHJ1ZSB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3JlIGxvZyBtZXRob2RcbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGxvZyhcbiAgICBsZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgb3B0aW9ucz86IExvZ09wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcbiAgICBpZiAoIWZpZWxkcykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIERvbid0IGR1cGxpY2F0ZSBtZXNzYWdlIC0gaXQncyBhbHJlYWR5IGluIGBvcGVyYXRpb25gXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWwsXG4gICAgICBvcGVyYXRpb246IG1lc3NhZ2UsXG4gICAgICBkYXRhLFxuICAgICAgYXR0cmlidXRlczogb3B0aW9ucz8uYXR0cmlidXRlcyxcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnM/LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucz8uZW50aXR5SWQsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgY2hpbGQgbG9nZ2VyIHdpdGggcHJlc2V0IHRhZ3Mvb3B0aW9uc1xuICAgKiBVc2VmdWwgZm9yIGNvbXBvbmVudC1zcGVjaWZpYyBsb2dnaW5nXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlQ2hpbGQoZGVmYXVsdE9wdGlvbnM6IExvZ09wdGlvbnMpOiBDaGlsZExvZ09ic2VydmVyIHtcbiAgICByZXR1cm4gbmV3IENoaWxkTG9nT2JzZXJ2ZXIoZGVmYXVsdE9wdGlvbnMpO1xuICB9XG59XG5cbi8qKlxuICogQ2hpbGQgbG9nZ2VyIHdpdGggcHJlc2V0IG9wdGlvbnNcbiAqL1xuZXhwb3J0IGNsYXNzIENoaWxkTG9nT2JzZXJ2ZXIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRzOiBMb2dPcHRpb25zKSB7IH1cblxuICB0cmFjZShtZXNzYWdlOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBMb2dPYnNlcnZlci50cmFjZShtZXNzYWdlLCBkYXRhLCB0aGlzLm1lcmdlT3B0aW9ucyhvcHRpb25zKSk7XG4gIH1cblxuICBkZWJ1ZyhtZXNzYWdlOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBMb2dPYnNlcnZlci5kZWJ1ZyhtZXNzYWdlLCBkYXRhLCB0aGlzLm1lcmdlT3B0aW9ucyhvcHRpb25zKSk7XG4gIH1cblxuICBpbmZvKG1lc3NhZ2U6IHN0cmluZywgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIExvZ09ic2VydmVyLmluZm8obWVzc2FnZSwgZGF0YSwgdGhpcy5tZXJnZU9wdGlvbnMob3B0aW9ucykpO1xuICB9XG5cbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBMb2dPYnNlcnZlci53YXJuKG1lc3NhZ2UsIGRhdGEsIHRoaXMubWVyZ2VPcHRpb25zKG9wdGlvbnMpKTtcbiAgfVxuXG4gIGVycm9yKG1lc3NhZ2U6IHN0cmluZywgZXJyb3JPckRhdGE/OiBFcnJvciB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIExvZ09ic2VydmVyLmVycm9yKG1lc3NhZ2UsIGVycm9yT3JEYXRhLCB0aGlzLm1lcmdlT3B0aW9ucyhvcHRpb25zKSk7XG4gIH1cblxuICBjcml0aWNhbChtZXNzYWdlOiBzdHJpbmcsIGVycm9yT3JEYXRhPzogRXJyb3IgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBMb2dPYnNlcnZlci5jcml0aWNhbChtZXNzYWdlLCBlcnJvck9yRGF0YSwgdGhpcy5tZXJnZU9wdGlvbnMob3B0aW9ucykpO1xuICB9XG5cbiAgcHJpdmF0ZSBtZXJnZU9wdGlvbnMob3B0aW9ucz86IExvZ09wdGlvbnMpOiBMb2dPcHRpb25zIHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4udGhpcy5kZWZhdWx0cyxcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgICB0YWdzOiB7IC4uLnRoaXMuZGVmYXVsdHMudGFncywgLi4ub3B0aW9ucz8udGFncyB9LFxuICAgICAgYXR0cmlidXRlczogeyAuLi50aGlzLmRlZmF1bHRzLmF0dHJpYnV0ZXMsIC4uLm9wdGlvbnM/LmF0dHJpYnV0ZXMgfSxcbiAgICB9O1xuICB9XG59XG5cbiJdfQ==