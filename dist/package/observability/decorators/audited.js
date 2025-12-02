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
            const correlationId = (0, context_1.getCorrelationIdIfExists)();
            if (!correlationId) {
                logger.warn(`@Audited on ${operation}: No correlationId. Establish context with runWithContext().`);
                return originalMethod.apply(this, args);
            }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvYXVkaXRlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Qkc7O0FBa0NILDBCQTZGQztBQTdIRCw4Q0FBbUQ7QUFDbkQsd0NBQXlFO0FBQ3pFLDJDQUE2QztBQUM3Qyw4Q0FBaUQ7QUFDakQsNENBQW1EO0FBRW5ELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBcUJoRDs7OztHQUlHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFDLFVBQTBCLEVBQUU7SUFDbEQsT0FBTyxVQUNMLE1BQWMsRUFDZCxXQUE0QixFQUM1QixVQUFzQztRQUV0QyxNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO1FBRXhDLElBQUksT0FBTyxjQUFjLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDekMsT0FBTyxVQUFVLENBQUM7UUFDcEIsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRXBFLGdFQUFnRTtRQUNoRSx3RkFBd0Y7UUFDeEYsTUFBTSxhQUFhLEdBQUcsVUFBeUIsR0FBRyxJQUFlO1lBQy9ELE1BQU0sYUFBYSxHQUFHLElBQUEsa0NBQXdCLEdBQUUsQ0FBQztZQUVqRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBQ25CLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxTQUFTLDhEQUE4RCxDQUFDLENBQUM7Z0JBQ3BHLE9BQVEsY0FBK0MsQ0FBQyxLQUFL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QU87U0FDdkIsQ0FBQztJQUNKLENBQUM7SUFFRCxxQkFBYSxDQUFDLE1BQU0sQ0FBQztRQUNuQixTQUFTO1FBQ1QsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1FBQzlCLElBQUk7UUFDSixLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUM7UUFDbEQsTUFBTSxFQUFFLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRTtRQUNwQyxJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUk7UUFDbEIsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLO0tBQ3RCLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBBdWRpdGVkIERlY29yYXRvciAtIEF1dG9tYXRpYyBhdWRpdCBsb2dnaW5nIGZvciBtZXRob2RzXG4gKiBcbiAqIFJlY29yZHMgYXVkaXQgZXZlbnRzIGZvciBtZXRob2QgY2FsbHMsIHVzZWZ1bCBmb3IgdHJhY2tpbmdcbiAqIHNlbnNpdGl2ZSBvcGVyYXRpb25zLCBwZXJtaXNzaW9uIGNoYW5nZXMsIGV0Yy5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBVc2VyU2VydmljZSB7XG4gKiAgIEBBdWRpdGVkKHsgb3BlcmF0aW9uOiAncGVybWlzc2lvbi5jaGFuZ2UnIH0pXG4gKiAgIGFzeW5jIHVwZGF0ZVBlcm1pc3Npb25zKHVzZXJJZDogc3RyaW5nLCBwZXJtaXNzaW9uczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAqICAgICAvLyBNZXRob2QgaXMgYXV0b21hdGljYWxseSBhdWRpdGVkXG4gKiAgIH1cbiAqICAgXG4gKiAgIEBBdWRpdGVkKHsgXG4gKiAgICAgb3BlcmF0aW9uOiAnc2Vuc2l0aXZlLmFjY2VzcycsIFxuICogICAgIGxldmVsOiAnd2FybicsXG4gKiAgICAgY2FwdHVyZUFyZ3M6IHRydWUgXG4gKiAgIH0pXG4gKiAgIGFzeW5jIGFjY2Vzc1NlbnNpdGl2ZURhdGEodXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFNlbnNpdGl2ZURhdGE+IHtcbiAqICAgICAvLyBBdWRpdCB3aXRoIGFyZ3VtZW50cyBjYXB0dXJlZFxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogUkVRVUlSRU1FTlRTOlxuICogLSBNdXN0IGJlIGNhbGxlZCB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAocnVuV2l0aENvbnRleHQpXG4gKiAtIE90aGVyd2lzZSBsb2dzIHdhcm5pbmcgYW5kIGRvZXNuJ3QgcmVjb3JkIGFueXRoaW5nXG4gKi9cblxuaW1wb3J0IHsgQXVkaXRPYnNlcnZlciB9IGZyb20gJy4uL29ic2VydmVycy9hdWRpdCc7XG5pbXBvcnQgeyBnZXRDdXJyZW50Q29udGV4dCwgZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzIH0gZnJvbSAnLi4vY29udGV4dCc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IHNhZmVTZXJpYWxpemUgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcbmltcG9ydCB7IG5vcm1hbGl6ZUVycm9yIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL2Jhc2UnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0F1ZGl0ZWREZWNvcmF0b3InKTtcblxuZXhwb3J0IGludGVyZmFjZSBBdWRpdGVkT3B0aW9ucyB7XG4gIC8qKiBBdWRpdCBvcGVyYXRpb24gbmFtZSAoZGVmYXVsdHMgdG8gQ2xhc3NOYW1lLm1ldGhvZE5hbWUpICovXG4gIG9wZXJhdGlvbj86IHN0cmluZztcbiAgLyoqIEVudGl0eSBuYW1lIGJlaW5nIGF1ZGl0ZWQgKG9wdGlvbmFsKSAqL1xuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICAvKiogQXVkaXQgbGV2ZWwgKi9cbiAgbGV2ZWw/OiAnaW5mbycgfCAnd2FybicgfCAnZXJyb3InO1xuICAvKiogV2hldGhlciB0byBjYXB0dXJlIG1ldGhvZCBhcmd1bWVudHMgaW4gYXVkaXQgZGF0YSAqL1xuICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG4gIC8qKiBXaGV0aGVyIHRvIGNhcHR1cmUgcmV0dXJuIHZhbHVlIGluIGF1ZGl0IGRhdGEgKi9cbiAgY2FwdHVyZVJlc3VsdD86IGJvb2xlYW47XG4gIC8qKiBTcGVjaWZpYyBhcmd1bWVudCBuYW1lcyB0byBjYXB0dXJlIChpZiBjYXB0dXJlQXJncyBpcyBmYWxzZSkgKi9cbiAgYXJnTmFtZXM/OiBzdHJpbmdbXTtcbiAgLyoqIEN1c3RvbSBkYXRhIGV4dHJhY3RvciBmdW5jdGlvbiAqL1xuICBkYXRhRXh0cmFjdG9yPzogKGFyZ3M6IHVua25vd25bXSwgcmVzdWx0PzogdW5rbm93bikgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIC8qKiBUYWdzIGZvciBmaWx0ZXJpbmcgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG59XG5cbi8qKlxuICogTWV0aG9kIGRlY29yYXRvciB0aGF0IHJlY29yZHMgYW4gYXVkaXQgZXZlbnQgZm9yIG1ldGhvZCBjYWxsc1xuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIEF1ZGl0IG9wdGlvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIEF1ZGl0ZWQob3B0aW9uczogQXVkaXRlZE9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPihcbiAgICB0YXJnZXQ6IG9iamVjdCxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4gICk6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+IHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG5cbiAgICBpZiAodHlwZW9mIG9yaWdpbmFsTWV0aG9kICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSBvcHRpb25zLm9wZXJhdGlvbiA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgLy8gV3JhcCBtZXRob2QgLSBoYW5kbGVzIGJvdGggc3luYyBhbmQgYXN5bmMgdmlhIHJlc3VsdCBjaGVja2luZ1xuICAgIC8vIFRoaXMgaXMgbW9yZSByb2J1c3QgdGhhbiBjaGVja2luZyBjb25zdHJ1Y3Rvci5uYW1lIHdoaWNoIGNhbiBicmVhayB3aXRoIHRyYW5zcGlsYXRpb25cbiAgICBjb25zdCB3cmFwcGVkTWV0aG9kID0gZnVuY3Rpb24gKHRoaXM6IHVua25vd24sIC4uLmFyZ3M6IHVua25vd25bXSk6IHVua25vd24ge1xuICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cygpO1xuXG4gICAgICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYEBBdWRpdGVkIG9uICR7b3BlcmF0aW9ufTogTm8gY29ycmVsYXRpb25JZC4gRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBydW5XaXRoQ29udGV4dCgpLmApO1xuICAgICAgICByZXR1cm4gKG9yaWdpbmFsTWV0aG9kIGFzICguLi5hOiB1bmtub3duW10pID0+IHVua25vd24pLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgcmVzdWx0IGlzIGEgUHJvbWlzZS90aGVuYWJsZSAod29ya3Mgd2l0aCBhbnkgYXN5bmMgbWV0aG9kKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiAocmVzdWx0IGFzIHsgdGhlbj86IHVua25vd24gfSkudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEhhbmRsZSBhc3luYyBtZXRob2RcbiAgICAgICAgICByZXR1cm4gKHJlc3VsdCBhcyBQcm9taXNlPHVua25vd24+KVxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgICAgIHJlc3VsdDogdmFsdWUsXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgICAgIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnIpLFxuICAgICAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXG4gICAgICAgICAgICAgICAgY2xhc3NOYW1lLFxuICAgICAgICAgICAgICAgIG1ldGhvZE5hbWUsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBzeW5jIG1ldGhvZFxuICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICByZXN1bHQsXG4gICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZWNvcmRBdWRpdCh7XG4gICAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgYXJncyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyKSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxuICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH07XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IHdyYXBwZWRNZXRob2QgYXMgVDtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG4vKipcbiAqIFJlY29yZCB0aGUgYXVkaXQgZXZlbnRcbiAqL1xuZnVuY3Rpb24gcmVjb3JkQXVkaXQocGFyYW1zOiB7XG4gIG9wZXJhdGlvbjogc3RyaW5nO1xuICBvcHRpb25zOiBBdWRpdGVkT3B0aW9ucztcbiAgYXJnczogdW5rbm93bltdO1xuICByZXN1bHQ/OiB1bmtub3duO1xuICBzdWNjZXNzOiBib29sZWFuO1xuICBlcnJvcj86IEVycm9yO1xuICBkdXJhdGlvbk1zOiBudW1iZXI7XG4gIGNsYXNzTmFtZTogc3RyaW5nO1xuICBtZXRob2ROYW1lOiBzdHJpbmc7XG59KTogdm9pZCB7XG4gIGNvbnN0IHsgb3BlcmF0aW9uLCBvcHRpb25zLCBhcmdzLCByZXN1bHQsIHN1Y2Nlc3MsIGVycm9yLCBkdXJhdGlvbk1zLCBjbGFzc05hbWUsIG1ldGhvZE5hbWUgfSA9IHBhcmFtcztcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgLy8gQnVpbGQgYXVkaXQgZGF0YVxuICBsZXQgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgc3VjY2VzcyxcbiAgICBkdXJhdGlvbk1zLFxuICB9O1xuXG4gIC8vIFVzZSBjdXN0b20gZGF0YSBleHRyYWN0b3IgaWYgcHJvdmlkZWRcbiAgaWYgKG9wdGlvbnMuZGF0YUV4dHJhY3Rvcikge1xuICAgIHRyeSB7XG4gICAgICBkYXRhID0ge1xuICAgICAgICAuLi5kYXRhLFxuICAgICAgICAuLi5vcHRpb25zLmRhdGFFeHRyYWN0b3IoYXJncywgcmVzdWx0KSxcbiAgICAgIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBJZ25vcmUgZXh0cmFjdG9yIGVycm9yc1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBDYXB0dXJlIGFyZ3MgaWYgcmVxdWVzdGVkXG4gICAgaWYgKG9wdGlvbnMuY2FwdHVyZUFyZ3MgJiYgYXJncy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAob3B0aW9ucy5hcmdOYW1lcyAmJiBvcHRpb25zLmFyZ05hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gQ2FwdHVyZSBzcGVjaWZpYyBuYW1lZCBhcmd1bWVudHNcbiAgICAgICAgY29uc3QgbmFtZWRBcmdzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgICBvcHRpb25zLmFyZ05hbWVzLmZvckVhY2goKG5hbWUsIGluZGV4KSA9PiB7XG4gICAgICAgICAgaWYgKGluZGV4IDwgYXJncy5sZW5ndGgpIHtcbiAgICAgICAgICAgIG5hbWVkQXJnc1sgbmFtZSBdID0gc2FmZVNlcmlhbGl6ZShhcmdzWyBpbmRleCBdKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBkYXRhLmFyZ3MgPSBuYW1lZEFyZ3M7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkYXRhLmFyZ3MgPSBzYWZlU2VyaWFsaXplKGFyZ3MpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENhcHR1cmUgcmVzdWx0IGlmIHJlcXVlc3RlZFxuICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGRhdGEucmVzdWx0ID0gc2FmZVNlcmlhbGl6ZShyZXN1bHQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEFkZCBlcnJvciBpbmZvIGlmIGZhaWxlZFxuICBpZiAoZXJyb3IpIHtcbiAgICBkYXRhLmVycm9yID0ge1xuICAgICAgdHlwZTogZXJyb3IubmFtZSxcbiAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgfTtcbiAgfVxuXG4gIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICBvcGVyYXRpb24sXG4gICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgIGRhdGEsXG4gICAgbGV2ZWw6IGVycm9yID8gJ2Vycm9yJyA6IChvcHRpb25zLmxldmVsID8/ICdpbmZvJyksXG4gICAgc291cmNlOiBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLFxuICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICBhY3RvcjogY29udGV4dD8uYWN0b3IsXG4gIH0pO1xufVxuXG4iXX0=