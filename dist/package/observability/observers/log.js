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
        const data = isError ? { errorMessage: errorOrData.message } : (options?.data || errorOrData);
        const error = isError ? (0, base_1.mapError)(errorOrData) : undefined;
        return (0, base_1.captureEvent)(fields, {
            type: 'log',
            level: 'error',
            operation: message,
            data,
            attributes: options?.attributes,
            metrics: options?.metrics,
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
        const data = isError ? { errorMessage: errorOrData.message } : (options?.data || errorOrData);
        const error = isError ? (0, base_1.mapError)(errorOrData) : undefined;
        // Don't duplicate message - it's already in `operation`
        return (0, base_1.captureEvent)(fields, {
            type: 'log',
            level: 'critical',
            operation: message,
            data,
            attributes: options?.attributes,
            metrics: options?.metrics,
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
            data: options?.data || data,
            metrics: options?.metrics,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvb2JzZXJ2ZXJzL2xvZy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Qkc7OztBQUdILGlDQU1nQjtBQUVoQixNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUM7QUFTcEMsTUFBYSxXQUFXO0lBRXRCOztPQUVHO0lBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFlLEVBQUUsR0FBRyxJQUFlO1FBQzdDLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ2pELENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBZSxFQUFFLEdBQUcsSUFBZTtRQUM3QyxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNqRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQWUsRUFBRSxXQUE2QyxFQUFFLE9BQW9CO1FBQy9GLHNFQUFzRTtRQUN0RSxNQUFNLE1BQU0sR0FBRyxJQUFBLHdCQUFpQixFQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV6RCxNQUFNLE9BQU8sR0FBRyxXQUFXLFlBQVksS0FBSyxDQUFDO1FBQzdDLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxJQUFJLElBQUksV0FBVyxDQUFDLENBQUM7UUFDOUYsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFBLGVBQVEsRUFBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FB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SSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLE9BQU8sRUFBRSxJQUFJLEVBQUU7WUFDakQsVUFBVSxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxHQUFHLE9BQU8sRUFBRSxVQUFVLEVBQUU7U0FDcEUsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQW5DRCw0Q0FtQ0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExvZ09ic2VydmVyIC0gRm9yIHNpbXBsZSBzdHJ1Y3R1cmVkIGxvZ2dpbmdcbiAqIFxuICogUHJvdmlkZXMgYSBzaW1wbGUgQVBJIGZvciBzdHJ1Y3R1cmVkIGxvZ2dpbmcgdGhhdCBpbnRlZ3JhdGVzIHdpdGhcbiAqIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbS4gVW5saWtlIHJhdyBjb25zb2xlLmxvZywgdGhlc2UgbG9nczpcbiAqIC0gSW5jbHVkZSBjb3JyZWxhdGlvbklkIGZvciBkaXN0cmlidXRlZCB0cmFjaW5nXG4gKiAtIEhhdmUgcHJvcGVyIHNldmVyaXR5IGxldmVsc1xuICogLSBHbyB0aHJvdWdoIGNvbmZpZ3VyZWQgYmFja2VuZHMgKENsb3VkV2F0Y2gsIER5bmFtb0RCLCBldGMuKVxuICogLSBDYW4gYmUgc2FtcGxlZC9maWx0ZXJlZFxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEZJUlNUOiBFc3RhYmxpc2ggY29udGV4dCAodXN1YWxseSBkb25lIGJ5IG1pZGRsZXdhcmUpXG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBTaW1wbGUgbG9nZ2luZ1xuICogICAgIExvZ09ic2VydmVyLmluZm8oJ1VzZXIgbG9nZ2VkIGluJywgeyB1c2VySWQgfSk7XG4gKiAgICAgTG9nT2JzZXJ2ZXIud2FybignUmF0ZSBsaW1pdCBhcHByb2FjaGluZycsIHsgY3VycmVudDogOTAsIGxpbWl0OiAxMDAgfSk7XG4gKiAgICAgTG9nT2JzZXJ2ZXIuZXJyb3IoJ1BheW1lbnQgZmFpbGVkJywgeyBvcmRlcklkLCBlcnJvcjogZXJyLm1lc3NhZ2UgfSk7XG4gKiAgICAgXG4gKiAgICAgLy8gV2l0aCBhZGRpdGlvbmFsIG9wdGlvbnNcbiAqICAgICBMb2dPYnNlcnZlci5kZWJ1ZygnQ2FjaGUgbG9va3VwJywgeyBrZXksIGhpdDogdHJ1ZSB9LCB7IFxuICogICAgICAgdGFnczogeyBjb21wb25lbnQ6ICdjYWNoZScgfSBcbiAqICAgICB9KTtcbiAqICAgfVxuICogKTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7XG4gIEJhc2VPYnNlcnZlck9wdGlvbnMsXG4gIE9ic2VydmFiaWxpdHlQYXlsb2FkLFxuICBidWlsZENvbW1vbkZpZWxkcyxcbiAgY2FwdHVyZUV2ZW50LFxuICBtYXBFcnJvcixcbn0gZnJvbSAnLi9iYXNlJztcblxuY29uc3QgT0JTRVJWRVJfTkFNRSA9ICdMb2dPYnNlcnZlcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTG9nT3B0aW9ucyBleHRlbmRzIEJhc2VPYnNlcnZlck9wdGlvbnMsIE9ic2VydmFiaWxpdHlQYXlsb2FkIHtcbiAgLyoqIEVudGl0eSBuYW1lIGZvciBjb250ZXh0ICovXG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIC8qKiBFbnRpdHkgSUQgZm9yIGNvbnRleHQgKi9cbiAgZW50aXR5SWQ/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBMb2dPYnNlcnZlciB7XG5cbiAgLyoqXG4gICAqIExvZyBhdCBJTkZPIGxldmVsXG4gICAqL1xuICBzdGF0aWMgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIC4uLmFyZ3M6IHVua25vd25bXSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMubG9nV2l0aEFyZ3MoJ2luZm8nLCBtZXNzYWdlLCBhcmdzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgYXQgV0FSTiBsZXZlbFxuICAgKi9cbiAgc3RhdGljIHdhcm4obWVzc2FnZTogc3RyaW5nLCAuLi5hcmdzOiB1bmtub3duW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmxvZ1dpdGhBcmdzKCd3YXJuJywgbWVzc2FnZSwgYXJncyk7XG4gIH1cblxuICAvKipcbiAgICogTG9nIGF0IEVSUk9SIGxldmVsXG4gICAqL1xuICBzdGF0aWMgZXJyb3IobWVzc2FnZTogc3RyaW5nLCBlcnJvck9yRGF0YT86IEVycm9yIHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICAvLyBLZWVwIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgZm9yIGVycm9yKCkgYXMgaXQgaGFzIHNwZWNpYWwgc2lnbmF0dXJlXG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICBjb25zdCBpc0Vycm9yID0gZXJyb3JPckRhdGEgaW5zdGFuY2VvZiBFcnJvcjtcbiAgICBjb25zdCBkYXRhID0gaXNFcnJvciA/IHsgZXJyb3JNZXNzYWdlOiBlcnJvck9yRGF0YS5tZXNzYWdlIH0gOiAob3B0aW9ucz8uZGF0YSB8fCBlcnJvck9yRGF0YSk7XG4gICAgY29uc3QgZXJyb3IgPSBpc0Vycm9yID8gbWFwRXJyb3IoZXJyb3JPckRhdGEpIDogdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIGNhcHR1cmVFdmVudChmaWVsZHMsIHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBvcGVyYXRpb246IG1lc3NhZ2UsXG4gICAgICBkYXRhLFxuICAgICAgYXR0cmlidXRlczogb3B0aW9ucz8uYXR0cmlidXRlcyxcbiAgICAgIG1ldHJpY3M6IG9wdGlvbnM/Lm1ldHJpY3MsXG4gICAgICBlbnRpdHlOYW1lOiBvcHRpb25zPy5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IG9wdGlvbnM/LmVudGl0eUlkLFxuICAgICAgZXJyb3IsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTG9nIGF0IERFQlVHIGxldmVsXG4gICAqL1xuICBzdGF0aWMgZGVidWcobWVzc2FnZTogc3RyaW5nLCAuLi5hcmdzOiB1bmtub3duW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmxvZ1dpdGhBcmdzKCdkZWJ1ZycsIG1lc3NhZ2UsIGFyZ3MpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZyBhdCBUUkFDRSBsZXZlbFxuICAgKi9cbiAgc3RhdGljIHRyYWNlKG1lc3NhZ2U6IHN0cmluZywgLi4uYXJnczogdW5rbm93bltdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5sb2dXaXRoQXJncygndHJhY2UnLCBtZXNzYWdlLCBhcmdzKTtcbiAgfVxuXG4gIC8vIEhlbHBlciB0byBoYW5kbGUgdmFyaWFibGUgYXJndW1lbnRzXG4gIHByaXZhdGUgc3RhdGljIGxvZ1dpdGhBcmdzKGxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsIG1lc3NhZ2U6IHN0cmluZywgYXJnczogdW5rbm93bltdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBsZXQgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgbGV0IG9wdGlvbnM6IExvZ09wdGlvbnMgfCB1bmRlZmluZWQ7XG5cbiAgICAvLyBQYXJzZSBhcmdzIHNpbWlsYXIgdG8gY29uc29sZS5sb2cgYnV0IGV4dHJhY3Rpbmcgb3B0aW9ucyBpZiBsYXN0IGFyZ1xuICAgIGlmIChhcmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxhc3RBcmcgPSBhcmdzWyBhcmdzLmxlbmd0aCAtIDEgXTtcbiAgICAgIC8vIEhldXJpc3RpYzogaWYgbGFzdCBhcmcgaGFzICd0YWdzJywgJ3NvdXJjZScsIG9yICdhdHRyaWJ1dGVzJywgdHJlYXQgYXMgb3B0aW9uc1xuICAgICAgaWYgKGxhc3RBcmcgJiYgdHlwZW9mIGxhc3RBcmcgPT09ICdvYmplY3QnICYmICgndGFncycgaW4gbGFzdEFyZyB8fCAnYXR0cmlidXRlcycgaW4gbGFzdEFyZyB8fCAnc291cmNlJyBpbiBsYXN0QXJnKSkge1xuICAgICAgICBvcHRpb25zID0gYXJncy5wb3AoKSBhcyBMb2dPcHRpb25zO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXJncy5sZW5ndGggPT09IDEgJiYgdHlwZW9mIGFyZ3NbIDAgXSA9PT0gJ29iamVjdCcgJiYgYXJnc1sgMCBdICE9PSBudWxsKSB7XG4gICAgICAgIGRhdGEgPSBhcmdzWyAwIF0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB9IGVsc2UgaWYgKGFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICBkYXRhID0geyBhcmdzIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMubG9nKGxldmVsLCBtZXNzYWdlLCBkYXRhLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2cgYXQgQ1JJVElDQUwgbGV2ZWwgKG1vc3Qgc2V2ZXJlLCBieXBhc3NlcyBzYW1wbGluZylcbiAgICovXG4gIHN0YXRpYyBjcml0aWNhbChcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgZXJyb3JPckRhdGE/OiBFcnJvciB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgIG9wdGlvbnM/OiBMb2dPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZmllbGRzID0gYnVpbGRDb21tb25GaWVsZHMoT0JTRVJWRVJfTkFNRSwgb3B0aW9ucyk7XG5cbiAgICBjb25zdCBpc0Vycm9yID0gZXJyb3JPckRhdGEgaW5zdGFuY2VvZiBFcnJvcjtcbiAgICBjb25zdCBkYXRhID0gaXNFcnJvciA/IHsgZXJyb3JNZXNzYWdlOiBlcnJvck9yRGF0YS5tZXNzYWdlIH0gOiAob3B0aW9ucz8uZGF0YSB8fCBlcnJvck9yRGF0YSk7XG4gICAgY29uc3QgZXJyb3IgPSBpc0Vycm9yID8gbWFwRXJyb3IoZXJyb3JPckRhdGEpIDogdW5kZWZpbmVkO1xuXG4gICAgLy8gRG9uJ3QgZHVwbGljYXRlIG1lc3NhZ2UgLSBpdCdzIGFscmVhZHkgaW4gYG9wZXJhdGlvbmBcbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2NyaXRpY2FsJyxcbiAgICAgIG9wZXJhdGlvbjogbWVzc2FnZSxcbiAgICAgIGRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBvcHRpb25zPy5hdHRyaWJ1dGVzLFxuICAgICAgbWV0cmljczogb3B0aW9ucz8ubWV0cmljcyxcbiAgICAgIGVudGl0eU5hbWU6IG9wdGlvbnM/LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogb3B0aW9ucz8uZW50aXR5SWQsXG4gICAgICBlcnJvcixcbiAgICB9LCB7IGNyaXRpY2FsOiB0cnVlIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENvcmUgbG9nIG1ldGhvZFxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgbG9nKFxuICAgIGxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICBvcHRpb25zPzogTG9nT3B0aW9uc1xuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGZpZWxkcyA9IGJ1aWxkQ29tbW9uRmllbGRzKE9CU0VSVkVSX05BTUUsIG9wdGlvbnMpO1xuXG4gICAgLy8gRG9uJ3QgZHVwbGljYXRlIG1lc3NhZ2UgLSBpdCdzIGFscmVhZHkgaW4gYG9wZXJhdGlvbmBcbiAgICByZXR1cm4gY2FwdHVyZUV2ZW50KGZpZWxkcywge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbCxcbiAgICAgIG9wZXJhdGlvbjogbWVzc2FnZSxcbiAgICAgIGRhdGE6IG9wdGlvbnM/LmRhdGEgfHwgZGF0YSxcbiAgICAgIG1ldHJpY3M6IG9wdGlvbnM/Lm1ldHJpY3MsXG4gICAgICBhdHRyaWJ1dGVzOiBvcHRpb25zPy5hdHRyaWJ1dGVzLFxuICAgICAgZW50aXR5TmFtZTogb3B0aW9ucz8uZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBvcHRpb25zPy5lbnRpdHlJZCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBjaGlsZCBsb2dnZXIgd2l0aCBwcmVzZXQgdGFncy9vcHRpb25zXG4gICAqIFVzZWZ1bCBmb3IgY29tcG9uZW50LXNwZWNpZmljIGxvZ2dpbmdcbiAgICovXG4gIHN0YXRpYyBjcmVhdGVDaGlsZChkZWZhdWx0T3B0aW9uczogTG9nT3B0aW9ucyk6IENoaWxkTG9nT2JzZXJ2ZXIge1xuICAgIHJldHVybiBuZXcgQ2hpbGRMb2dPYnNlcnZlcihkZWZhdWx0T3B0aW9ucyk7XG4gIH1cbn1cblxuLyoqXG4gKiBDaGlsZCBsb2dnZXIgd2l0aCBwcmVzZXQgb3B0aW9uc1xuICovXG5leHBvcnQgY2xhc3MgQ2hpbGRMb2dPYnNlcnZlciB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgZGVmYXVsdHM6IExvZ09wdGlvbnMpIHsgfVxuXG4gIHRyYWNlKG1lc3NhZ2U6IHN0cmluZywgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIExvZ09ic2VydmVyLnRyYWNlKG1lc3NhZ2UsIGRhdGEsIHRoaXMubWVyZ2VPcHRpb25zKG9wdGlvbnMpKTtcbiAgfVxuXG4gIGRlYnVnKG1lc3NhZ2U6IHN0cmluZywgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIExvZ09ic2VydmVyLmRlYnVnKG1lc3NhZ2UsIGRhdGEsIHRoaXMubWVyZ2VPcHRpb25zKG9wdGlvbnMpKTtcbiAgfVxuXG4gIGluZm8obWVzc2FnZTogc3RyaW5nLCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gTG9nT2JzZXJ2ZXIuaW5mbyhtZXNzYWdlLCBkYXRhLCB0aGlzLm1lcmdlT3B0aW9ucyhvcHRpb25zKSk7XG4gIH1cblxuICB3YXJuKG1lc3NhZ2U6IHN0cmluZywgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIExvZ09ic2VydmVyLndhcm4obWVzc2FnZSwgZGF0YSwgdGhpcy5tZXJnZU9wdGlvbnMob3B0aW9ucykpO1xuICB9XG5cbiAgZXJyb3IobWVzc2FnZTogc3RyaW5nLCBlcnJvck9yRGF0YT86IEVycm9yIHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG9wdGlvbnM/OiBMb2dPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gTG9nT2JzZXJ2ZXIuZXJyb3IobWVzc2FnZSwgZXJyb3JPckRhdGEsIHRoaXMubWVyZ2VPcHRpb25zKG9wdGlvbnMpKTtcbiAgfVxuXG4gIGNyaXRpY2FsKG1lc3NhZ2U6IHN0cmluZywgZXJyb3JPckRhdGE/OiBFcnJvciB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBvcHRpb25zPzogTG9nT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIExvZ09ic2VydmVyLmNyaXRpY2FsKG1lc3NhZ2UsIGVycm9yT3JEYXRhLCB0aGlzLm1lcmdlT3B0aW9ucyhvcHRpb25zKSk7XG4gIH1cblxuICBwcml2YXRlIG1lcmdlT3B0aW9ucyhvcHRpb25zPzogTG9nT3B0aW9ucyk6IExvZ09wdGlvbnMge1xuICAgIHJldHVybiB7XG4gICAgICAuLi50aGlzLmRlZmF1bHRzLFxuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIHRhZ3M6IHsgLi4udGhpcy5kZWZhdWx0cy50YWdzLCAuLi5vcHRpb25zPy50YWdzIH0sXG4gICAgICBhdHRyaWJ1dGVzOiB7IC4uLnRoaXMuZGVmYXVsdHMuYXR0cmlidXRlcywgLi4ub3B0aW9ucz8uYXR0cmlidXRlcyB9LFxuICAgIH07XG4gIH1cbn1cblxuIl19