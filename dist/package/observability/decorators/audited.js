"use strict";
/**
 * @Audited Decorator - Automatic audit logging for methods
 *
 * Records audit events for method calls, useful for tracking
 * sensitive operations, permission changes, etc.
 *
 * Usage:
 * ```typescript
 * class UserService {
 *   @Audited({ operation: 'permission.change' })
 *   async updatePermissions(userId: string, permissions: string[]): Promise<void> {
 *     // Method is automatically audited
 *   }
 *
 *   @Audited({
 *     operation: 'sensitive.access',
 *     level: 'warn',
 *     captureArgs: true
 *   })
 *   async accessSensitiveData(userId: string): Promise<SensitiveData> {
 *     // Audit with arguments captured
 *   }
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise logs warning and doesn't record anything
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Audited = Audited;
const audit_1 = require("../observers/audit");
const context_1 = require("../context");
const logging_1 = require("../../logging");
const payload_1 = require("../utils/payload");
const base_1 = require("../observers/base");
const logger = (0, logging_1.createLogger)('AuditedDecorator');
/**
 * Method decorator that records an audit event for method calls
 *
 * @param options - Audit options
 */
function Audited(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        const className = target.constructor.name;
        const methodName = String(propertyKey);
        const operation = options.operation ?? `${className}.${methodName}`;
        // Wrap method - handles both sync and async via result checking
        // This is more robust than checking constructor.name which can break with transpilation
        const wrappedMethod = function (...args) {
            const startTime = Date.now();
            try {
                const result = originalMethod.apply(this, args);
                // Check if result is a Promise/thenable (works with any async method)
                if (result && typeof result.then === 'function') {
                    // Handle async method
                    return result
                        .then((value) => {
                        recordAudit({
                            operation,
                            options,
                            args,
                            result: value,
                            success: true,
                            durationMs: Date.now() - startTime,
                            className,
                            methodName,
                        });
                        return value;
                    })
                        .catch((err) => {
                        recordAudit({
                            operation,
                            options,
                            args,
                            success: false,
                            error: (0, base_1.normalizeError)(err),
                            durationMs: Date.now() - startTime,
                            className,
                            methodName,
                        });
                        throw err;
                    });
                }
                // Handle sync method
                recordAudit({
                    operation,
                    options,
                    args,
                    result,
                    success: true,
                    durationMs: Date.now() - startTime,
                    className,
                    methodName,
                });
                return result;
            }
            catch (err) {
                recordAudit({
                    operation,
                    options,
                    args,
                    success: false,
                    error: (0, base_1.normalizeError)(err),
                    durationMs: Date.now() - startTime,
                    className,
                    methodName,
                });
                throw err;
            }
        };
        descriptor.value = wrappedMethod;
        return descriptor;
    };
}
/**
 * Record the audit event
 */
function recordAudit(params) {
    const { operation, options, args, result, success, error, durationMs, className, methodName } = params;
    const context = (0, context_1.getCurrentContext)();
    // Build audit data
    let data = {
        success,
        durationMs,
    };
    // Use custom data extractor if provided
    if (options.dataExtractor) {
        try {
            data = {
                ...data,
                ...options.dataExtractor(args, result),
            };
        }
        catch {
            // Ignore extractor errors
        }
    }
    else {
        // Capture args if requested
        if (options.captureArgs && args.length > 0) {
            if (options.argNames && options.argNames.length > 0) {
                // Capture specific named arguments
                const namedArgs = {};
                options.argNames.forEach((name, index) => {
                    if (index < args.length) {
                        namedArgs[name] = (0, payload_1.safeSerialize)(args[index]);
                    }
                });
                data.args = namedArgs;
            }
            else {
                data.args = (0, payload_1.safeSerialize)(args);
            }
        }
        // Capture result if requested
        if (options.captureResult && result !== undefined) {
            data.result = (0, payload_1.safeSerialize)(result);
        }
    }
    // Add error info if failed
    if (error) {
        data.error = {
            type: error.name,
            message: error.message,
        };
    }
    audit_1.AuditObserver.record({
        operation,
        entityName: options.entityName,
        data,
        level: error ? 'error' : (options.level ?? 'info'),
        source: `${className}.${methodName}`,
        tags: options.tags,
        actor: context?.actor,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvYXVkaXRlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Qkc7O0FBa0NILDBCQXNGQztBQXRIRCw4Q0FBbUQ7QUFDbkQsd0NBQXlFO0FBQ3pFLDJDQUE2QztBQUM3Qyw4Q0FBaUQ7QUFDakQsNENBQW1EO0FBRW5ELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBcUJoRDs7OztHQUlHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFDLFVBQTBCLEVBQUU7SUFDbEQsT0FBTyxVQUNMLE1BQWMsRUFDZCxXQUE0QixFQUM1QixVQUFzQztRQUV0QyxNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO1FBRXhDLElBQUksT0FBTyxjQUFjLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDekMsT0FBTyxVQUFVLENBQUM7UUFDcEIsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRXBFLGdFQUFnRTtRQUNoRSx3RkFBd0Y7UUFDeEYsTUFBTSxhQUFhLEdBQUcsVUFBeUIsR0FBRyxJQUFlO1lBQy9ELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUU3QixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxNQUFNLEdBQUksY0FBK0MsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUVsRixzRUFBc0U7Z0JBQ3RFLElBQUks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RCxNQUFNLEVBQUUsR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFO1FBQ3BDLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtRQUNsQixLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUs7S0FDdEIsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQEF1ZGl0ZWQgRGVjb3JhdG9yIC0gQXV0b21hdGljIGF1ZGl0IGxvZ2dpbmcgZm9yIG1ldGhvZHNcbiAqIFxuICogUmVjb3JkcyBhdWRpdCBldmVudHMgZm9yIG1ldGhvZCBjYWxscywgdXNlZnVsIGZvciB0cmFja2luZ1xuICogc2Vuc2l0aXZlIG9wZXJhdGlvbnMsIHBlcm1pc3Npb24gY2hhbmdlcywgZXRjLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNsYXNzIFVzZXJTZXJ2aWNlIHtcbiAqICAgQEF1ZGl0ZWQoeyBvcGVyYXRpb246ICdwZXJtaXNzaW9uLmNoYW5nZScgfSlcbiAqICAgYXN5bmMgdXBkYXRlUGVybWlzc2lvbnModXNlcklkOiBzdHJpbmcsIHBlcm1pc3Npb25zOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICogICAgIC8vIE1ldGhvZCBpcyBhdXRvbWF0aWNhbGx5IGF1ZGl0ZWRcbiAqICAgfVxuICogICBcbiAqICAgQEF1ZGl0ZWQoeyBcbiAqICAgICBvcGVyYXRpb246ICdzZW5zaXRpdmUuYWNjZXNzJywgXG4gKiAgICAgbGV2ZWw6ICd3YXJuJyxcbiAqICAgICBjYXB0dXJlQXJnczogdHJ1ZSBcbiAqICAgfSlcbiAqICAgYXN5bmMgYWNjZXNzU2Vuc2l0aXZlRGF0YSh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8U2Vuc2l0aXZlRGF0YT4ge1xuICogICAgIC8vIEF1ZGl0IHdpdGggYXJndW1lbnRzIGNhcHR1cmVkXG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICogXG4gKiBSRVFVSVJFTUVOVFM6XG4gKiAtIE11c3QgYmUgY2FsbGVkIHdpdGhpbiBhbiBvYnNlcnZhdGlvbiBjb250ZXh0IChydW5XaXRoQ29udGV4dClcbiAqIC0gT3RoZXJ3aXNlIGxvZ3Mgd2FybmluZyBhbmQgZG9lc24ndCByZWNvcmQgYW55dGhpbmdcbiAqL1xuXG5pbXBvcnQgeyBBdWRpdE9ic2VydmVyIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2F1ZGl0JztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0LCBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMgfSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgc2FmZVNlcmlhbGl6ZSB9IGZyb20gJy4uL3V0aWxzL3BheWxvYWQnO1xuaW1wb3J0IHsgbm9ybWFsaXplRXJyb3IgfSBmcm9tICcuLi9vYnNlcnZlcnMvYmFzZSc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQXVkaXRlZERlY29yYXRvcicpO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF1ZGl0ZWRPcHRpb25zIHtcbiAgLyoqIEF1ZGl0IG9wZXJhdGlvbiBuYW1lIChkZWZhdWx0cyB0byBDbGFzc05hbWUubWV0aG9kTmFtZSkgKi9cbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICAvKiogRW50aXR5IG5hbWUgYmVpbmcgYXVkaXRlZCAob3B0aW9uYWwpICovXG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIC8qKiBBdWRpdCBsZXZlbCAqL1xuICBsZXZlbD86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gIC8qKiBXaGV0aGVyIHRvIGNhcHR1cmUgbWV0aG9kIGFyZ3VtZW50cyBpbiBhdWRpdCBkYXRhICovXG4gIGNhcHR1cmVBcmdzPzogYm9vbGVhbjtcbiAgLyoqIFdoZXRoZXIgdG8gY2FwdHVyZSByZXR1cm4gdmFsdWUgaW4gYXVkaXQgZGF0YSAqL1xuICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcbiAgLyoqIFNwZWNpZmljIGFyZ3VtZW50IG5hbWVzIHRvIGNhcHR1cmUgKGlmIGNhcHR1cmVBcmdzIGlzIGZhbHNlKSAqL1xuICBhcmdOYW1lcz86IHN0cmluZ1tdO1xuICAvKiogQ3VzdG9tIGRhdGEgZXh0cmFjdG9yIGZ1bmN0aW9uICovXG4gIGRhdGFFeHRyYWN0b3I/OiAoYXJnczogdW5rbm93bltdLCByZXN1bHQ/OiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFRhZ3MgZm9yIGZpbHRlcmluZyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbn1cblxuLyoqXG4gKiBNZXRob2QgZGVjb3JhdG9yIHRoYXQgcmVjb3JkcyBhbiBhdWRpdCBldmVudCBmb3IgbWV0aG9kIGNhbGxzXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gQXVkaXQgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gQXVkaXRlZChvcHRpb25zOiBBdWRpdGVkT3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24+KFxuICAgIHRhcmdldDogb2JqZWN0LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbiAgKTogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD4ge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcblxuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRhcmdldC5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBTdHJpbmcocHJvcGVydHlLZXkpO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IG9wdGlvbnMub3BlcmF0aW9uID8/IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG5cbiAgICAvLyBXcmFwIG1ldGhvZCAtIGhhbmRsZXMgYm90aCBzeW5jIGFuZCBhc3luYyB2aWEgcmVzdWx0IGNoZWNraW5nXG4gICAgLy8gVGhpcyBpcyBtb3JlIHJvYnVzdCB0aGFuIGNoZWNraW5nIGNvbnN0cnVjdG9yLm5hbWUgd2hpY2ggY2FuIGJyZWFrIHdpdGggdHJhbnNwaWxhdGlvblxuICAgIGNvbnN0IHdyYXBwZWRNZXRob2QgPSBmdW5jdGlvbiAodGhpczogdW5rbm93biwgLi4uYXJnczogdW5rbm93bltdKTogdW5rbm93biB7XG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgcmVzdWx0IGlzIGEgUHJvbWlzZS90aGVuYWJsZSAod29ya3Mgd2l0aCBhbnkgYXN5bmMgbWV0aG9kKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiAocmVzdWx0IGFzIHsgdGhlbj86IHVua25vd24gfSkudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEhhbmRsZSBhc3luYyBtZXRob2RcbiAgICAgICAgICByZXR1cm4gKHJlc3VsdCBhcyBQcm9taXNlPHVua25vd24+KVxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgICAgIHJlc3VsdDogdmFsdWUsXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnIpLFxuICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgIG1ldGhvZE5hbWUsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBzeW5jIG1ldGhvZFxuICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICByZXN1bHQsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyKSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH07XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IHdyYXBwZWRNZXRob2QgYXMgVDtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG4vKipcbiAqIFJlY29yZCB0aGUgYXVkaXQgZXZlbnRcbiAqL1xuZnVuY3Rpb24gcmVjb3JkQXVkaXQocGFyYW1zOiB7XG4gIG9wZXJhdGlvbjogc3RyaW5nO1xuICBvcHRpb25zOiBBdWRpdGVkT3B0aW9ucztcbiAgYXJnczogdW5rbm93bltdO1xuICByZXN1bHQ/OiB1bmtub3duO1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBlcnJvcj86IEVycm9yO1xuICBkdXJhdGlvbk1zOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xuICBtZXRob2ROYW1lOiBzdHJpbmc7XG59KTogdm9pZCB7XG4gIGNvbnN0IHsgb3BlcmF0aW9uLCBvcHRpb25zLCBhcmdzLCByZXN1bHQsIHN1Y2Nlc3MsIGVycm9yLCBkdXJhdGlvbk1zLCBjbGFzc05hbWUsIG1ldGhvZE5hbWUgfSA9IHBhcmFtcztcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgLy8gQnVpbGQgYXVkaXQgZGF0YVxuICBsZXQgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgc3VjY2VzcyxcbiAgICBkdXJhdGlvbk1zLFxuICB9O1xuXG4gIC8vIFVzZSBjdXN0b20gZGF0YSBleHRyYWN0b3IgaWYgcHJvdmlkZWRcbiAgaWYgKG9wdGlvbnMuZGF0YUV4dHJhY3Rvcikge1xuICAgIHRyeSB7XG4gICAgICBkYXRhID0ge1xuICAgICAgICAuLi5kYXRhLFxuICAgICAgICAuLi5vcHRpb25zLmRhdGFFeHRyYWN0b3IoYXJncywgcmVzdWx0KSxcbiAgICAgIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgZXh0cmFjdG9yIGVycm9yc1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBDYXB0dXJlIGFyZ3MgaWYgcmVxdWVzdGVkXG4gICAgaWYgKG9wdGlvbnMuY2FwdHVyZUFyZ3MgJiYgYXJncy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAob3B0aW9ucy5hcmdOYW1lcyAmJiBvcHRpb25zLmFyZ05hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gQ2FwdHVyZSBzcGVjaWZpYyBuYW1lZCBhcmd1bWVudHNcbiAgICAgICAgY29uc3QgbmFtZWRBcmdzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgICBvcHRpb25zLmFyZ05hbWVzLmZvckVhY2goKG5hbWUsIGluZGV4KSA9PiB7XG4gICAgICAgICAgaWYgKGluZGV4IDwgYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICAgIG5hbWVkQXJnc1sgbmFtZSBdID0gc2FmZVNlcmlhbGl6ZShhcmdzWyBpbmRleCBdKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmFyZ3MgPSBuYW1lZEFyZ3M7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkYXRhLmFyZ3MgPSBzYWZlU2VyaWFsaXplKGFyZ3MpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENhcHR1cmUgcmVzdWx0IGlmIHJlcXVlc3RlZFxuICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGRhdGEucmVzdWx0ID0gc2FmZVNlcmlhbGl6ZShyZXN1bHQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCBlcnJvciBpbmZvIGlmIGZhaWxlZFxuICBpZiAoZXJyb3IpIHtcbiAgICBkYXRhLmVycm9yID0ge1xuICAgICAgdHlwZTogZXJyb3IubmFtZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgfTtcbiAgfVxuXG4gIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICBvcGVyYXRpb24sXG4gICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgIGRhdGEsXG4gICAgbGV2ZWw6IGVycm9yID8gJ2Vycm9yJyA6IChvcHRpb25zLmxldmVsID8/ICdpbmZvJyksXG4gICAgc291cmNlOiBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLFxuICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gIH0pO1xufVxuXG4iXX0=