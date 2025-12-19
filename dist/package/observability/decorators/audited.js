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
const logging_1 = require("../../logging");
const audit_1 = require("../observers/audit");
const base_1 = require("../observers/base");
const payload_1 = require("../utils/payload");
const decorator_utils_1 = require("./decorator-utils");
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
        // Wrap method - automatic sync/async handling
        const wrappedMethod = function (...args) {
            const startTime = Date.now();
            return (0, decorator_utils_1.executeWithHandlers)(originalMethod, this, args, (success, result, error) => {
                recordAudit({
                    operation,
                    options,
                    args,
                    result,
                    success,
                    error: error ? (0, base_1.normalizeError)(error) : undefined,
                    durationMs: Date.now() - startTime,
                    className,
                    methodName,
                });
            });
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
    // AuditObserver.record will automatically pick up actor/correlationId/causedBy from context
    // No need to pass them explicitly - let the lower level handle it!
    audit_1.AuditObserver.record({
        operation,
        entityName: options.entityName,
        data,
        level: error ? 'error' : (options.level ?? 'info'),
        source: `${className}.${methodName}`,
        tags: options.tags,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvYXVkaXRlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E0Qkc7O0FBa0NILDBCQTJDQztBQTNFRCwyQ0FBNkM7QUFDN0MsOENBQW1EO0FBQ25ELDRDQUFtRDtBQUNuRCw4Q0FBaUQ7QUFDakQsdURBQXdEO0FBRXhELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxrQkFBa0IsQ0FBQyxDQUFDO0FBcUJoRDs7OztHQUlHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFDLFVBQTBCLEVBQUU7SUFDbEQsT0FBTyxVQUNMLE1BQWMsRUFDZCxXQUE0QixFQUM1QixVQUFzQztRQUV0QyxNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO1FBRXhDLElBQUksT0FBTyxjQUFjLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDekMsT0FBTyxVQUFVLENBQUM7UUFDcEIsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRXBFLDhDQUE4QztRQUM5QyxNQUFNLGFBQWEsR0FBRyxVQUF5QixHQUFHLElBQWU7WUFDL0QsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBRTdCLE9BQU8sSUFBQSxxQ0FBbUIsRUFDeEIsY0FBaUQsRUFDakQsSUFBSSxFQUNKLElBQUksRUFDSixDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUU7Z0JBQ3pCLFdBQVcsQ0FBQztvQkFD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QyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQztRQUNsRCxNQUFNLEVBQUUsR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFO1FBQ3BDLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSTtLQUNuQixDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAQXVkaXRlZCBEZWNvcmF0b3IgLSBBdXRvbWF0aWMgYXVkaXQgbG9nZ2luZyBmb3IgbWV0aG9kc1xuICogXG4gKiBSZWNvcmRzIGF1ZGl0IGV2ZW50cyBmb3IgbWV0aG9kIGNhbGxzLCB1c2VmdWwgZm9yIHRyYWNraW5nXG4gKiBzZW5zaXRpdmUgb3BlcmF0aW9ucywgcGVybWlzc2lvbiBjaGFuZ2VzLCBldGMuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgVXNlclNlcnZpY2Uge1xuICogICBAQXVkaXRlZCh7IG9wZXJhdGlvbjogJ3Blcm1pc3Npb24uY2hhbmdlJyB9KVxuICogICBhc3luYyB1cGRhdGVQZXJtaXNzaW9ucyh1c2VySWQ6IHN0cmluZywgcGVybWlzc2lvbnM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gKiAgICAgLy8gTWV0aG9kIGlzIGF1dG9tYXRpY2FsbHkgYXVkaXRlZFxuICogICB9XG4gKiAgIFxuICogICBAQXVkaXRlZCh7IFxuICogICAgIG9wZXJhdGlvbjogJ3NlbnNpdGl2ZS5hY2Nlc3MnLCBcbiAqICAgICBsZXZlbDogJ3dhcm4nLFxuICogICAgIGNhcHR1cmVBcmdzOiB0cnVlIFxuICogICB9KVxuICogICBhc3luYyBhY2Nlc3NTZW5zaXRpdmVEYXRhKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxTZW5zaXRpdmVEYXRhPiB7XG4gKiAgICAgLy8gQXVkaXQgd2l0aCBhcmd1bWVudHMgY2FwdHVyZWRcbiAqICAgfVxuICogfVxuICogYGBgXG4gKiBcbiAqIFJFUVVJUkVNRU5UUzpcbiAqIC0gTXVzdCBiZSBjYWxsZWQgd2l0aGluIGFuIG9ic2VydmF0aW9uIGNvbnRleHQgKHJ1bldpdGhDb250ZXh0KVxuICogLSBPdGhlcndpc2UgbG9ncyB3YXJuaW5nIGFuZCBkb2Vzbid0IHJlY29yZCBhbnl0aGluZ1xuICovXG5cbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgQXVkaXRPYnNlcnZlciB9IGZyb20gJy4uL29ic2VydmVycy9hdWRpdCc7XG5pbXBvcnQgeyBub3JtYWxpemVFcnJvciB9IGZyb20gJy4uL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IHNhZmVTZXJpYWxpemUgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcbmltcG9ydCB7IGV4ZWN1dGVXaXRoSGFuZGxlcnMgfSBmcm9tICcuL2RlY29yYXRvci11dGlscyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQXVkaXRlZERlY29yYXRvcicpO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF1ZGl0ZWRPcHRpb25zIHtcbiAgLyoqIEF1ZGl0IG9wZXJhdGlvbiBuYW1lIChkZWZhdWx0cyB0byBDbGFzc05hbWUubWV0aG9kTmFtZSkgKi9cbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICAvKiogRW50aXR5IG5hbWUgYmVpbmcgYXVkaXRlZCAob3B0aW9uYWwpICovXG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIC8qKiBBdWRpdCBsZXZlbCAqL1xuICBsZXZlbD86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gIC8qKiBXaGV0aGVyIHRvIGNhcHR1cmUgbWV0aG9kIGFyZ3VtZW50cyBpbiBhdWRpdCBkYXRhICovXG4gIGNhcHR1cmVBcmdzPzogYm9vbGVhbjtcbiAgLyoqIFdoZXRoZXIgdG8gY2FwdHVyZSByZXR1cm4gdmFsdWUgaW4gYXVkaXQgZGF0YSAqL1xuICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcbiAgLyoqIFNwZWNpZmljIGFyZ3VtZW50IG5hbWVzIHRvIGNhcHR1cmUgKGlmIGNhcHR1cmVBcmdzIGlzIGZhbHNlKSAqL1xuICBhcmdOYW1lcz86IHN0cmluZ1tdO1xuICAvKiogQ3VzdG9tIGRhdGEgZXh0cmFjdG9yIGZ1bmN0aW9uICovXG4gIGRhdGFFeHRyYWN0b3I/OiAoYXJnczogdW5rbm93bltdLCByZXN1bHQ/OiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFRhZ3MgZm9yIGZpbHRlcmluZyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbn1cblxuLyoqXG4gKiBNZXRob2QgZGVjb3JhdG9yIHRoYXQgcmVjb3JkcyBhbiBhdWRpdCBldmVudCBmb3IgbWV0aG9kIGNhbGxzXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gQXVkaXQgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gQXVkaXRlZChvcHRpb25zOiBBdWRpdGVkT3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24+KFxuICAgIHRhcmdldDogb2JqZWN0LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbiAgKTogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD4ge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcblxuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRhcmdldC5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBTdHJpbmcocHJvcGVydHlLZXkpO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IG9wdGlvbnMub3BlcmF0aW9uID8/IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG5cbiAgICAvLyBXcmFwIG1ldGhvZCAtIGF1dG9tYXRpYyBzeW5jL2FzeW5jIGhhbmRsaW5nXG4gICAgY29uc3Qgd3JhcHBlZE1ldGhvZCA9IGZ1bmN0aW9uICh0aGlzOiB1bmtub3duLCAuLi5hcmdzOiB1bmtub3duW10pOiB1bmtub3duIHtcbiAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgIHJldHVybiBleGVjdXRlV2l0aEhhbmRsZXJzKFxuICAgICAgICBvcmlnaW5hbE1ldGhvZCBhcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duLFxuICAgICAgICB0aGlzLFxuICAgICAgICBhcmdzLFxuICAgICAgICAoc3VjY2VzcywgcmVzdWx0LCBlcnJvcikgPT4ge1xuICAgICAgICAgIHJlY29yZEF1ZGl0KHtcbiAgICAgICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgcmVzdWx0LFxuICAgICAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciA/IG5vcm1hbGl6ZUVycm9yKGVycm9yKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIGR1cmF0aW9uTXM6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXG4gICAgICAgICAgICBjbGFzc05hbWUsXG4gICAgICAgICAgICBtZXRob2ROYW1lLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICApO1xuICAgIH07XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IHdyYXBwZWRNZXRob2QgYXMgVDtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG5cbi8qKlxuICogUmVjb3JkIHRoZSBhdWRpdCBldmVudFxuICovXG5mdW5jdGlvbiByZWNvcmRBdWRpdChwYXJhbXM6IHtcbiAgb3BlcmF0aW9uOiBzdHJpbmc7XG4gIG9wdGlvbnM6IEF1ZGl0ZWRPcHRpb25zO1xuICBhcmdzOiB1bmtub3duW107XG4gIHJlc3VsdD86IHVua25vd247XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG4gIGVycm9yPzogRXJyb3I7XG4gIGR1cmF0aW9uTXM6IG51bWJlcjtcbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG4gIG1ldGhvZE5hbWU6IHN0cmluZztcbn0pOiB2b2lkIHtcbiAgY29uc3QgeyBvcGVyYXRpb24sIG9wdGlvbnMsIGFyZ3MsIHJlc3VsdCwgc3VjY2VzcywgZXJyb3IsIGR1cmF0aW9uTXMsIGNsYXNzTmFtZSwgbWV0aG9kTmFtZSB9ID0gcGFyYW1zO1xuXG4gIC8vIEJ1aWxkIGF1ZGl0IGRhdGFcbiAgbGV0IGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgIHN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NcyxcbiAgfTtcblxuICAvLyBVc2UgY3VzdG9tIGRhdGEgZXh0cmFjdG9yIGlmIHByb3ZpZGVkXG4gIGlmIChvcHRpb25zLmRhdGFFeHRyYWN0b3IpIHtcbiAgICB0cnkge1xuICAgICAgZGF0YSA9IHtcbiAgICAgICAgLi4uZGF0YSxcbiAgICAgICAgLi4ub3B0aW9ucy5kYXRhRXh0cmFjdG9yKGFyZ3MsIHJlc3VsdCksXG4gICAgICB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gSWdub3JlIGV4dHJhY3RvciBlcnJvcnNcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gQ2FwdHVyZSBhcmdzIGlmIHJlcXVlc3RlZFxuICAgIGlmIChvcHRpb25zLmNhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKG9wdGlvbnMuYXJnTmFtZXMgJiYgb3B0aW9ucy5hcmdOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIENhcHR1cmUgc3BlY2lmaWMgbmFtZWQgYXJndW1lbnRzXG4gICAgICAgIGNvbnN0IG5hbWVkQXJnczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgb3B0aW9ucy5hcmdOYW1lcy5mb3JFYWNoKChuYW1lLCBpbmRleCkgPT4ge1xuICAgICAgICAgIGlmIChpbmRleCA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgICAgICAgICBuYW1lZEFyZ3NbIG5hbWUgXSA9IHNhZmVTZXJpYWxpemUoYXJnc1sgaW5kZXggXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZGF0YS5hcmdzID0gbmFtZWRBcmdzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGF0YS5hcmdzID0gc2FmZVNlcmlhbGl6ZShhcmdzKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDYXB0dXJlIHJlc3VsdCBpZiByZXF1ZXN0ZWRcbiAgICBpZiAob3B0aW9ucy5jYXB0dXJlUmVzdWx0ICYmIHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBkYXRhLnJlc3VsdCA9IHNhZmVTZXJpYWxpemUocmVzdWx0KTtcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgZXJyb3IgaW5mbyBpZiBmYWlsZWRcbiAgaWYgKGVycm9yKSB7XG4gICAgZGF0YS5lcnJvciA9IHtcbiAgICAgIHR5cGU6IGVycm9yLm5hbWUsXG4gICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgIH07XG4gIH1cblxuICAvLyBBdWRpdE9ic2VydmVyLnJlY29yZCB3aWxsIGF1dG9tYXRpY2FsbHkgcGljayB1cCBhY3Rvci9jb3JyZWxhdGlvbklkL2NhdXNlZEJ5IGZyb20gY29udGV4dFxuICAvLyBObyBuZWVkIHRvIHBhc3MgdGhlbSBleHBsaWNpdGx5IC0gbGV0IHRoZSBsb3dlciBsZXZlbCBoYW5kbGUgaXQhXG4gIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICBvcGVyYXRpb24sXG4gICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgIGRhdGEsXG4gICAgbGV2ZWw6IGVycm9yID8gJ2Vycm9yJyA6IChvcHRpb25zLmxldmVsID8/ICdpbmZvJyksXG4gICAgc291cmNlOiBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLFxuICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgfSk7XG59XG5cbiJdfQ==