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
     * Log at INFO level
     */
    static info(message, ...args) {
        return this.logWithArgs('info', message, args);
    }
    /**
     * Log at WARN level
     */
    static warn(message, ...args) {
        return this.logWithArgs('warn', message, args);
    }
    /**
     * Log at ERROR level
     */
    static error(message, errorOrData, options) {
        // Keep backward compatibility for error() as it has special signature
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
        const isError = errorOrData instanceof Error;
        const data = isError ? { errorMessage: errorOrData.message } : errorOrData;
        const error = isError ? (0, base_1.mapError)(errorOrData) : undefined;
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
     * Log at DEBUG level
     */
    static debug(message, ...args) {
        return this.logWithArgs('debug', message, args);
    }
    /**
     * Log at TRACE level
     */
    static trace(message, ...args) {
        return this.logWithArgs('trace', message, args);
    }
    // Helper to handle variable arguments
    static logWithArgs(level, message, args) {
        let data;
        let options;
        // Parse args similar to console.log but extracting options if last arg
        if (args.length > 0) {
            const lastArg = args[args.length - 1];
            // Heuristic: if last arg has 'tags', 'source', or 'attributes', treat as options
            if (lastArg && typeof lastArg === 'object' && ('tags' in lastArg || 'attributes' in lastArg || 'source' in lastArg)) {
                options = args.pop();
            }
            if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
                data = args[0];
            }
            else if (args.length > 0) {
                data = { args };
            }
        }
        return this.log(level, message, data, options);
    }
    /**
     * Log at CRITICAL level (most severe, bypasses sampling)
     */
    static critical(message, errorOrData, options) {
        const fields = (0, base_1.buildCommonFields)(OBSERVER_NAME, options);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL2xvZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Qkc7OztBQUlILGlDQUtnQjtBQUVoQixNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUM7QUFXcEMsTUFBYSxXQUFXO0lBRXRCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFlLEVBQUUsR0FBRyxJQUFlO1FBQzdDLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ2pELENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBZSxFQUFFLEdBQUcsSUFBZTtRQUM3QyxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQWUsRUFBRSxXQUE2QyxFQUFFLE9BQW9CO1FBQy9GLHNFQUFzRTtRQUN0RSxNQUFNLE1BQU0sR0FBRyxJQUFBLHdCQUFpQixFQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV6RCxNQUFNLE9BQU8sR0FBRyxXQUFXLFlBQVksS0FBSyxDQUFDO1FBQzdDLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7UUFDM0UsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFBLGVBQVEsRUFBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FBRTFELE9BQU8sSUFBQSxtQkFBWSxFQUFDLE1BQU0s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LDRDQW1DQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogTG9nT2JzZXJ2ZXIgLSBGb3Igc2ltcGxlIHN0cnVjdHVyZWQgbG9nZ2luZ1xuICogXG4gKiBQcm92aWRlcyBhIHNpbXBsZSBBUEkgZm9yIHN0cnVjdHVyZWQgbG9nZ2luZyB0aGF0IGludGVncmF0ZXMgd2l0aFxuICogdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtLiBVbmxpa2UgcmF3IGNvbnNvbGUubG9nLCB0aGVzZSBsb2dzOlxuICogLSBJbmNsdWRlIGNvcnJlbGF0aW9uSWQgZm9yIGRpc3RyaWJ1dGVkIHRyYWNpbmdcbiAqIC0gSGF2ZSBwcm9wZXIgc2V2ZXJpdHkgbGV2ZWxzXG4gKiAtIEdvIHRocm91Z2ggY29uZmlndXJlZCBiYWNrZW5kcyAoQ2xvdWRXYXRjaCwgRHluYW1vREIsIGV0Yy4pXG4gKiAtIENhbiBiZSBzYW1wbGVkL2ZpbHRlcmVkXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gRklSU1Q6IEVzdGFibGlzaCBjb250ZXh0ICh1c3VhbGx5IGRvbmUgYnkgbWlkZGxld2FyZSlcbiAqIGF3YWl0IHJ1bldpdGhDb250ZXh0KFxuICogICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQocmVxdWVzdElkKSxcbiAqICAgYXN5bmMgKCkgPT4ge1xuICogICAgIC8vIFNpbXBsZSBsb2dnaW5nXG4gKiAgICAgTG9nT2JzZXJ2ZXIuaW5mbygnVXNlciBsb2dnZWQgaW4nLCB7IHVzZXJJZCB9KTtcbiAqICAgICBMb2dPYnNlcnZlci53YXJuKCdSYXRlIGxpbWl0IGFwcHJvYWNoaW5nJywgeyBjdXJyZW50OiA5MCwgbGltaXQ6IDEwMCB9KTtcbiAqICAgICBMb2dPYnNlcnZlci5lcnJvcignUGF5bWVudCBmYWlsZWQnLCB7IG9yZGVySWQsIGVycm9yOiBlcnIubWVzc2FnZSB9KTtcbiAqICAgICBcbiAqICAgICAvLyBXaXRoIGFkZGl0aW9uYWwgb3B0aW9uc1xuICogICAgIExvZ09ic2VydmVyLmRlYnVnKCdDYWNoZSBsb29rdXAnLCB7IGtleSwgaGl0OiB0cnVlIH0sIHsgXG4gKiAgICAgICB0YWdzOiB7IGNvbXBvbmVudDogJ2NhY2hlJyB9IFxuICogICAgIH0pO1xuICogICB9XG4gKiApO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7XG4gIEJhc2VPYnNlcnZlck9wdGlvbnMsXG4gIGJ1aWxkQ29tbW9uRmllbGRzLFxuICBjYXB0dXJlRXZlbnQsXG4gIG1hcEVycm9yLFxufSBmcm9tICcuL2Jhc2UnO1xuXG5jb25zdCBPQlNFUlZFUl9OQU1FID0gJ0xvZ09ic2VydmVyJztcblxuZXhwb3J0IGludGVyZmFjZSBMb2dPcHRpb25zIGV4dGVuZHMgQmFzZU9ic2VydmVyT3B0aW9ucyB7XG4gIC8qKiBBZGRpdGlvbmFsIGF0dHJpYnV0ZXMgKi9cbiAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogRW50aXR5IG5hbWUgZm9yIGNvbnRleHQgKi9cbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgLyoqIEVudGl0eSBJRCBmb3IgY29udGV4dCAqL1xuICBlbnRpdHlJZD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIExvZ09ic2VydmVyIHtcblxuICAvKipcbiAgICogTG9nIGF0IElORk8gbGV2ZWxcbiAgICovXG4gIHN0YXRpYyBpbmZvKG1lc3NhZ2U6IHN0cmluZywgLi4uYXJnczogdW5rbm93bltdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5sb2dXaXRoQXJncygnaW5mbycsIG1lc3NhZ2UsIGFyZ3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBXQVJOIGxldmVsXG4gICAqL1xuICBzdGF0aWMgd2FybihtZXNzYWdlOiBzdHJpbmcsIC4uLmFyZ3M6IHVua25vd25bXSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMubG9nV2l0aEFyZ3MoJ3dhcm4nLCBtZXNzYWdlLCBhcmdzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgYXQgRVJST1IgbGV2ZWxcbiAgICovXG4gIHN0YXRpYyBlcnJvcihtZXNzYWdlOiBzdHJpbmcsIGVycm9yT3JEYXRhPzogRXJyb3IgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIC8vIEtlZXAgYmFja3dhcmQgY29tcGF0aWJpbGl0eSBmb3IgZXJyb3IoKSBhcyBpdCBoYXMgc3BlY2lhbCBzaWduYXR1cmVcbiAgICBjb25zdCBmaWVsZHMgPSBidWlsZENvbW1vbkZpZWxkcyhPQlNFUlZFUl9OQU1FLCBvcHRpb25zKTtcblxuICAgIGNvbnN0IGlzRXJyb3IgPSBlcnJvck9yRGF0YSBpbnN0YW5jZW9mIEVycm9yO1xuICAgIGNvbnN0IGRhdGEgPSBpc0Vycm9yID8geyBlcnJvck1lc3NhZ2U6IGVycm9yT3JEYXRhLm1lc3NhZ2UgfSA6IGVycm9yT3JEYXRhO1xuICAgIGNvbnN0IGVycm9yID0gaXNFcnJvciA/IG1hcEVycm9yKGVycm9yT3JEYXRhKSA6IHVuZGVmaW5lZDtcblxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgb3BlcmF0aW9uOiBtZXNzYWdlLFxuICAgICAgZGF0YSxcbiAgICAgIGF0dHJpYnV0ZXM6IG9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zPy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnM/LmVudGl0eUlkLFxuICAgICAgZXJyb3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTG9nIGF0IERFQlVHIGxldmVsXG4gICAqL1xuICBzdGF0aWMgZGVidWcobWVzc2FnZTogc3RyaW5nLCAuLi5hcmdzOiB1bmtub3duW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmxvZ1dpdGhBcmdzKCdkZWJ1ZycsIG1lc3NhZ2UsIGFyZ3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBUUkFDRSBsZXZlbFxuICAgKi9cbiAgc3RhdGljIHRyYWNlKG1lc3NhZ2U6IHN0cmluZywgLi4uYXJnczogdW5rbm93bltdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5sb2dXaXRoQXJncygndHJhY2UnLCBtZXNzYWdlLCBhcmdzKTtcbiAgfVxuXG4gIC8vIEhlbHBlciB0byBoYW5kbGUgdmFyaWFibGUgYXJndW1lbnRzXG4gIHByaXZhdGUgc3RhdGljIGxvZ1dpdGhBcmdzKGxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgYXJnczogdW5rbm93bltdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBsZXQgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgbGV0IG9wdGlvbnM6IExvZ09wdGlvbnMgfCB1bmRlZmluZWQ7XG5cbiAgICAvLyBQYXJzZSBhcmdzIHNpbWlsYXIgdG8gY29uc29sZS5sb2cgYnV0IGV4dHJhY3Rpbmcgb3B0aW9ucyBpZiBsYXN0IGFyZ1xuICAgIGlmIChhcmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxhc3RBcmcgPSBhcmdzW2FyZ3MubGVuZ3RoIC0gMV07XG4gICAgICAvLyBIZXVyaXN0aWM6IGlmIGxhc3QgYXJnIGhhcyAndGFncycsICdzb3VyY2UnLCBvciAnYXR0cmlidXRlcycsIHRyZWF0IGFzIG9wdGlvbnNcbiAgICAgIGlmIChsYXN0QXJnICYmIHR5cGVvZiBsYXN0QXJnID09PSAnb2JqZWN0JyAmJiAoJ3RhZ3MnIGluIGxhc3RBcmcgfHwgJ2F0dHJpYnV0ZXMnIGluIGxhc3RBcmcgfHwgJ3NvdXJjZScgaW4gbGFzdEFyZykpIHtcbiAgICAgICAgb3B0aW9ucyA9IGFyZ3MucG9wKCkgYXMgTG9nT3B0aW9ucztcbiAgICAgIH1cbiAgICAgIFxuICAgICAgaWYgKGFyZ3MubGVuZ3RoID09PSAxICYmIHR5cGVvZiBhcmdzWzBdID09PSAnb2JqZWN0JyAmJiBhcmdzWzBdICE9PSBudWxsKSB7XG4gICAgICAgIGRhdGEgPSBhcmdzWzBdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBlbHNlIGlmIChhcmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZGF0YSA9IHsgYXJncyB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmxvZyhsZXZlbCwgbWVzc2FnZSwgZGF0YSwgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogTG9nIGF0IENSSVRJQ0FMIGxldmVsIChtb3N0IHNldmVyZSwgYnlwYXNzZXMgc2FtcGxpbmcpXG4gICAqL1xuICBzdGF0aWMgY3JpdGljYWwoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIGVycm9yT3JEYXRhPzogRXJyb3IgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICBvcHRpb25zPzogTG9nT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgY29uc3QgaXNFcnJvciA9IGVycm9yT3JEYXRhIGluc3RhbmNlb2YgRXJyb3I7XG4gICAgY29uc3QgZGF0YSA9IGlzRXJyb3IgPyB7IGVycm9yTWVzc2FnZTogZXJyb3JPckRhdGEubWVzc2FnZSB9IDogZXJyb3JPckRhdGE7XG4gICAgY29uc3QgZXJyb3IgPSBpc0Vycm9yID8gbWFwRXJyb3IoZXJyb3JPckRhdGEpIDogdW5kZWZpbmVkO1xuXG4gICAgLy8gRG9uJ3QgZHVwbGljYXRlIG1lc3NhZ2UgLSBpdCdzIGFscmVhZHkgaW4gYG9wZXJhdGlvbmBcbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2NyaXRpY2FsJyxcbiAgICAgIG9wZXJhdGlvbjogbWVzc2FnZSxcbiAgICAgIGRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBvcHRpb25zPy5hdHRyaWJ1dGVzLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucz8uZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zPy5lbnRpdHlJZCxcbiAgICAgIGVycm9yLFxuICAgIH0sIHsgY3JpdGljYWw6IHRydWUgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ29yZSBsb2cgbWV0aG9kXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBsb2coXG4gICAgbGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIG9wdGlvbnM/OiBMb2dPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICAvLyBEb24ndCBkdXBsaWNhdGUgbWVzc2FnZSAtIGl0J3MgYWxyZWFkeSBpbiBgb3BlcmF0aW9uYFxuICAgIHJldHVybiBjYXB0dXJlRXZlbnQoZmllbGRzLCB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsLFxuICAgICAgb3BlcmF0aW9uOiBtZXNzYWdlLFxuICAgICAgZGF0YSxcbiAgICAgIGF0dHJpYnV0ZXM6IG9wdGlvbnM/LmF0dHJpYnV0ZXMsXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zPy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnM/LmVudGl0eUlkLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIGNoaWxkIGxvZ2dlciB3aXRoIHByZXNldCB0YWdzL29wdGlvbnNcbiAgICogVXNlZnVsIGZvciBjb21wb25lbnQtc3BlY2lmaWMgbG9nZ2luZ1xuICAgKi9cbiAgc3RhdGljIGNyZWF0ZUNoaWxkKGRlZmF1bHRPcHRpb25zOiBMb2dPcHRpb25zKTogQ2hpbGRMb2dPYnNlcnZlciB7XG4gICAgcmV0dXJuIG5ldyBDaGlsZExvZ09ic2VydmVyKGRlZmF1bHRPcHRpb25zKTtcbiAgfVxufVxuXG4vKipcbiAqIENoaWxkIGxvZ2dlciB3aXRoIHByZXNldCBvcHRpb25zXG4gKi9cbmV4cG9ydCBjbGFzcyBDaGlsZExvZ09ic2VydmVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBkZWZhdWx0czogTG9nT3B0aW9ucykgeyB9XG5cbiAgdHJhY2UobWVzc2FnZTogc3RyaW5nLCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gTG9nT2JzZXJ2ZXIudHJhY2UobWVzc2FnZSwgZGF0YSwgdGhpcy5tZXJnZU9wdGlvbnMob3B0aW9ucykpO1xuICB9XG5cbiAgZGVidWcobWVzc2FnZTogc3RyaW5nLCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gTG9nT2JzZXJ2ZXIuZGVidWcobWVzc2FnZSwgZGF0YSwgdGhpcy5tZXJnZU9wdGlvbnMob3B0aW9ucykpO1xuICB9XG5cbiAgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBMb2dPYnNlcnZlci5pbmZvKG1lc3NhZ2UsIGRhdGEsIHRoaXMubWVyZ2VPcHRpb25zKG9wdGlvbnMpKTtcbiAgfVxuXG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gTG9nT2JzZXJ2ZXIud2FybihtZXNzYWdlLCBkYXRhLCB0aGlzLm1lcmdlT3B0aW9ucyhvcHRpb25zKSk7XG4gIH1cblxuICBlcnJvcihtZXNzYWdlOiBzdHJpbmcsIGVycm9yT3JEYXRhPzogRXJyb3IgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgb3B0aW9ucz86IExvZ09wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBMb2dPYnNlcnZlci5lcnJvcihtZXNzYWdlLCBlcnJvck9yRGF0YSwgdGhpcy5tZXJnZU9wdGlvbnMob3B0aW9ucykpO1xuICB9XG5cbiAgY3JpdGljYWwobWVzc2FnZTogc3RyaW5nLCBlcnJvck9yRGF0YT86IEVycm9yIHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gTG9nT2JzZXJ2ZXIuY3JpdGljYWwobWVzc2FnZSwgZXJyb3JPckRhdGEsIHRoaXMubWVyZ2VPcHRpb25zKG9wdGlvbnMpKTtcbiAgfVxuXG4gIHByaXZhdGUgbWVyZ2VPcHRpb25zKG9wdGlvbnM/OiBMb2dPcHRpb25zKTogTG9nT3B0aW9ucyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnRoaXMuZGVmYXVsdHMsXG4gICAgICAuLi5vcHRpb25zLFxuICAgICAgdGFnczogeyAuLi50aGlzLmRlZmF1bHRzLnRhZ3MsIC4uLm9wdGlvbnM/LnRhZ3MgfSxcbiAgICAgIGF0dHJpYnV0ZXM6IHsgLi4udGhpcy5kZWZhdWx0cy5hdHRyaWJ1dGVzLCAuLi5vcHRpb25zPy5hdHRyaWJ1dGVzIH0sXG4gICAgfTtcbiAgfVxufVxuXG4iXX0=