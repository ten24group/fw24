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
 *     capture: { args: true }
 *   })
 *   async accessSensitiveData(userId: string): Promise<SensitiveData> {
 *     // Audit with arguments captured
 *   }
 * }
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Audited = Audited;
const execution_context_1 = require("../../core/runtime/execution-context");
const audit_1 = require("../observers/audit");
const base_1 = require("../observers/base");
const decorator_utils_1 = require("./decorator-utils");
const payload_1 = require("../utils/payload");
/**
 * Method decorator that records an audit event for method calls
 */
function Audited(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        // Pre-compute static values
        const className = target.constructor.name;
        const methodName = String(propertyKey);
        const operation = options.operation ?? `${className}.${methodName}`;
        descriptor.value = function (...args) {
            // Early exits
            if (!isEnabled(options) || !(0, execution_context_1.getCurrentExecutionContext)()) {
                return originalMethod.apply(this, args);
            }
            // Extract RecordOverrides from options
            const { operation: opName, entityName, level, argNames, dataExtractor, enabled, sourceType, ...recordOverrides } = options;
            // Compute source (use explicit source override if provided, otherwise auto-detect)
            const computedSource = (0, decorator_utils_1.resolveSource)(sourceType, className, methodName);
            const finalSource = recordOverrides.source ?? computedSource;
            const startTime = Date.now();
            return (0, decorator_utils_1.executeWithHandlers)(originalMethod, this, args, (success, result, error) => {
                recordAudit(operation, finalSource, options, args, result, success, Date.now() - startTime, error ? (0, base_1.normalizeError)(error) : undefined, recordOverrides, toSerializeOptions(recordOverrides.capture?.args), toSerializeOptions(recordOverrides.capture?.result));
            });
        };
        return descriptor;
    };
}
// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════
function isEnabled(options) {
    if (options.enabled === undefined)
        return true;
    return typeof options.enabled === 'function' ? options.enabled() : options.enabled;
}
/**
 * Convert decorator capture options to SerializeOptions
 */
function toSerializeOptions(option) {
    if (option === undefined || option === false)
        return undefined;
    if (option === true)
        return {}; // Use defaults
    return option; // Already SerializeOptions
}
function recordAudit(operation, source, options, args, result, success, durationMs, error, recordOverrides, argsSerializeOpts, resultSerializeOpts) {
    // Build audit data
    let data = { success, durationMs };
    // Use custom data extractor if provided
    if (options.dataExtractor) {
        // No defensive fallbacks: extractor errors should surface (tests + caller visibility).
        data = { ...data, ...options.dataExtractor(args, result) };
    }
    else {
        // Capture args if requested
        if (argsSerializeOpts && args.length > 0) {
            if (options.argNames?.length) {
                // Capture specific named arguments
                const namedArgs = {};
                options.argNames.forEach((name, index) => {
                    if (index < args.length) {
                        namedArgs[name] = (0, payload_1.safeSerialize)(args[index], argsSerializeOpts);
                    }
                });
                data.args = namedArgs;
            }
            else {
                data.args = (0, payload_1.safeSerialize)(args, argsSerializeOpts);
            }
        }
        // Capture result if requested
        if (resultSerializeOpts && result !== undefined) {
            data.result = (0, payload_1.safeSerialize)(result, resultSerializeOpts);
        }
    }
    // Add error info if failed
    if (error) {
        data.error = { type: error.name, message: error.message };
    }
    // Pass through all RecordOverrides fields
    audit_1.AuditObserver.record({
        operation,
        entityName: options.entityName,
        data,
        level: error ? 'error' : (options.level ?? 'info'),
        source,
        ...recordOverrides,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvYXVkaXRlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXdCRzs7QUF5QkgsMEJBZ0VDO0FBdkZELDRFQUFrRjtBQUNsRiw4Q0FBbUQ7QUFDbkQsNENBQW1EO0FBRW5ELHVEQUF1RTtBQUN2RSw4Q0FBd0U7QUFleEU7O0dBRUc7QUFDSCxTQUFnQixPQUFPLENBQUMsVUFBMEIsRUFBRTtJQUNsRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRXBFLFVBQVUsQ0FBQyxLQUFLLEdBQUcsVUFBc0MsR0FBRyxJQUFtQjtZQUM3RSxjQUFjO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUEsOENBQTBCLEdBQUUsRUFBRSxDQUFDO2dCQUN6RCxPQUFPLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBa0IsQ0FBQztZQUMzRCxDQUFDO1lBRUQsdUNBQXVDO1lBQ3ZDLE1BQU0sRUFDSixTQUFTLEVBQUUsTUFBTSxFQUNqQixVQUFVLEVBQ1YsS0FBSyxFQUNMLFFBQVEsRUFDUixhQUFhLEVBQ2IsT0FBTyxFQUNQLFVBQVUsRUFDVixHQUFHLGVBQWUsRUFDbkIsR0FBRyxPQUFPLENBQUM7WUFFWixtRkFBbUY7WUFDbkYsTUFBTSxjQUFjLEdBQUcsSUFBQSwrQkFBYSxFQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFDeEUsTUFBTSxXQUFXLEdBQUcsZUFBZSxDQUFDLE1BQU0sSUFBSSxjQUFjLENBQUM7WUFFN0QsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBRTdCLE9BQU8sSUFBQSxxQ0FBbUIsRUFDeEIsY0FBYyxFQUNkLElBQUksRUFDSixJQUFJLEVBQ0osQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxFQUFFO2dCQUN6QixXQUFXLENBQ1QsU0FBUyxFQUNULFdBQVcsRUFDWCxPQUFPLEVBQ1AsSUFBSSxFQUNKLE1BQU0sRUFDTixPQUFPLEVBQ1AsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsRUFDdEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFBLHFCQUFjLEVBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFDekMsZUFBZSxFQUNmLGtCQUFrQixDQUFDLGVBQWUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLEVBQ2pELGtCQUFrQixDQUFDLGVBQWUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQ3BELENBQUM7WUFDSixDQUFDLENBQ0YsQ0FBQztRQUNKLENBQU0sQ0FBQztRQUVQLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUMsQ0FBQztBQUNKLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsVUFBVTtBQUNWLDhFQUE4RTtBQUU5RSxTQUFTLFNBQVMsQ0FBQyxPQUF1QjtJQUN4QyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUssU0FBUztRQUFFLE9BQU8sSUFBSSxDQUFDO0lBQy9DLE9BQU8sT0FBTyxPQUFPLENBQUMsT0FBTyxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO0FBQ3JGLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsa0JBQWtCLENBQUMsTUFBcUQ7SUFDL0UsSUFBSSxNQUFNLEtBQUssU0FBUyxJQUFJLE1BQU0sS0FBSyxLQUFLO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFDL0QsSUFBSSxNQUFNLEtBQUssSUFBSTtRQUFFLE9BQU8sRUFBRSxDQUFDLENBQUMsZUFBZTtJQUMvQyxPQUFPLE1BQU0sQ0FBQyxDQUFDLDJCQUEyQjtBQUM1QyxDQUFDO0FBRUQsU0FBUyxXQUFXLENBQ2xCLFNBQWlCLEVBQ2pCLE1BQWMsRUFDZCxPQUF1QixFQUN2QixJQUFlLEVBQ2YsTUFBZSxFQUNmLE9BQWdCLEVBQ2hCLFVBQWtCLEVBQ2xCLEtBQXdCLEVBQ3hCLGVBQThDLEVBQzlDLGlCQUErQyxFQUMvQyxtQkFBaUQ7SUFFakQsbUJBQW1CO0lBQ25CLElBQUksSUFBSSxHQUE0QixFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsQ0FBQztJQUU1RCx3Q0FBd0M7SUFDeEMsSUFBSSxPQUFPLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDMUIsdUZBQXVGO1FBQ3ZGLElBQUksR0FBRyxFQUFFLEdBQUcsSUFBSSxFQUFFLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQztJQUM3RCxDQUFDO1NBQU0sQ0FBQztRQUNOLDRCQUE0QjtRQUM1QixJQUFJLGlCQUFpQixJQUFJLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDekMsSUFBSSxPQUFPLENBQUMsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDO2dCQUM3QixtQ0FBbUM7Z0JBQ25DLE1BQU0sU0FBUyxHQUE0QixFQUFFLENBQUM7Z0JBQzlDLE9BQU8sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO29CQUN2QyxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7d0JBQ3hCLFNBQVMsQ0FBRSxJQUFJLENBQUUsR0FBRyxJQUFBLHVCQUFhLEVBQUMsSUFBSSxDQUFFLEtBQUssQ0FBRSxFQUFFLGlCQUFpQixDQUFDLENBQUM7b0JBQ3RFLENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7Z0JBQ0gsSUFBSSxDQUFDLElBQUksR0FBRyxTQUFTLENBQUM7WUFDeEIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBQSx1QkFBYSxFQUFDLElBQUksRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1lBQ3JELENBQUM7UUFDSCxDQUFDO1FBRUQsOEJBQThCO1FBQzlCLElBQUksbUJBQW1CLElBQUksTUFBTSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2hELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSx1QkFBYSxFQUFDLE1BQU0sRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1FBQzNELENBQUM7SUFDSCxDQUFDO0lBRUQsMkJBQTJCO0lBQzNCLElBQUksS0FBSyxFQUFFLENBQUM7UUFDVixJQUFJLENBQUMsS0FBSyxHQUFHLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUM1RCxDQUFDO0lBRUQsMENBQTBDO0lBQzFDLHFCQUFhLENBQUMsTUFBTSxDQUFDO1FBQ25CLFNBQVM7UUFDVCxVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVU7UUFDOUIsSUFBSTtRQUNKLEtBQUssRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQztRQUNsRCxNQUFNO1FBQ04sR0FBRyxlQUFlO0tBQ25CLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBBdWRpdGVkIERlY29yYXRvciAtIEF1dG9tYXRpYyBhdWRpdCBsb2dnaW5nIGZvciBtZXRob2RzXG4gKiBcbiAqIFJlY29yZHMgYXVkaXQgZXZlbnRzIGZvciBtZXRob2QgY2FsbHMsIHVzZWZ1bCBmb3IgdHJhY2tpbmdcbiAqIHNlbnNpdGl2ZSBvcGVyYXRpb25zLCBwZXJtaXNzaW9uIGNoYW5nZXMsIGV0Yy5cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjbGFzcyBVc2VyU2VydmljZSB7XG4gKiAgIEBBdWRpdGVkKHsgb3BlcmF0aW9uOiAncGVybWlzc2lvbi5jaGFuZ2UnIH0pXG4gKiAgIGFzeW5jIHVwZGF0ZVBlcm1pc3Npb25zKHVzZXJJZDogc3RyaW5nLCBwZXJtaXNzaW9uczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAqICAgICAvLyBNZXRob2QgaXMgYXV0b21hdGljYWxseSBhdWRpdGVkXG4gKiAgIH1cbiAqICAgXG4gKiAgIEBBdWRpdGVkKHsgXG4gKiAgICAgb3BlcmF0aW9uOiAnc2Vuc2l0aXZlLmFjY2VzcycsIFxuICogICAgIGxldmVsOiAnd2FybicsXG4gKiAgICAgY2FwdHVyZTogeyBhcmdzOiB0cnVlIH1cbiAqICAgfSlcbiAqICAgYXN5bmMgYWNjZXNzU2Vuc2l0aXZlRGF0YSh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8U2Vuc2l0aXZlRGF0YT4ge1xuICogICAgIC8vIEF1ZGl0IHdpdGggYXJndW1lbnRzIGNhcHR1cmVkXG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0IH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEF1ZGl0T2JzZXJ2ZXIgfSBmcm9tICcuLi9vYnNlcnZlcnMvYXVkaXQnO1xuaW1wb3J0IHsgbm9ybWFsaXplRXJyb3IgfSBmcm9tICcuLi9vYnNlcnZlcnMvYmFzZSc7XG5pbXBvcnQgdHlwZSB7IERlY29yYXRvckJhc2VPcHRpb25zLCBDYXB0dXJlU2VyaWFsaXplT3B0aW9ucyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGV4ZWN1dGVXaXRoSGFuZGxlcnMsIHJlc29sdmVTb3VyY2UgfSBmcm9tICcuL2RlY29yYXRvci11dGlscyc7XG5pbXBvcnQgeyBzYWZlU2VyaWFsaXplLCB0eXBlIFNlcmlhbGl6ZU9wdGlvbnMgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcblxuZXhwb3J0IGludGVyZmFjZSBBdWRpdGVkT3B0aW9ucyBleHRlbmRzIERlY29yYXRvckJhc2VPcHRpb25zIHtcbiAgLyoqIEF1ZGl0IG9wZXJhdGlvbiBuYW1lIChkZWZhdWx0cyB0byBDbGFzc05hbWUubWV0aG9kTmFtZSkgKi9cbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICAvKiogRW50aXR5IG5hbWUgYmVpbmcgYXVkaXRlZCAob3B0aW9uYWwpICovXG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIC8qKiBBdWRpdCBsZXZlbCAqL1xuICBsZXZlbD86ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gIC8qKiBTcGVjaWZpYyBhcmd1bWVudCBuYW1lcyB0byBjYXB0dXJlIChyZXF1aXJlcyBjYXB0dXJlLmFyZ3MgdG8gYmUgZW5hYmxlZCkgKi9cbiAgYXJnTmFtZXM/OiBzdHJpbmdbXTtcbiAgLyoqIEN1c3RvbSBkYXRhIGV4dHJhY3RvciBmdW5jdGlvbiAqL1xuICBkYXRhRXh0cmFjdG9yPzogKGFyZ3M6IHVua25vd25bXSwgcmVzdWx0PzogdW5rbm93bikgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogTWV0aG9kIGRlY29yYXRvciB0aGF0IHJlY29yZHMgYW4gYXVkaXQgZXZlbnQgZm9yIG1ldGhvZCBjYWxsc1xuICovXG5leHBvcnQgZnVuY3Rpb24gQXVkaXRlZChvcHRpb25zOiBBdWRpdGVkT3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzICguLi5hcmdzOiBhbnlbXSkgPT4gYW55PihcbiAgICB0YXJnZXQ6IG9iamVjdCxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4gICk6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+IHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG4gICAgaWYgKHR5cGVvZiBvcmlnaW5hbE1ldGhvZCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gICAgfVxuXG4gICAgLy8gUHJlLWNvbXB1dGUgc3RhdGljIHZhbHVlc1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRhcmdldC5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBTdHJpbmcocHJvcGVydHlLZXkpO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IG9wdGlvbnMub3BlcmF0aW9uID8/IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG5cbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKHRoaXM6IFRoaXNQYXJhbWV0ZXJUeXBlPFQ+LCAuLi5hcmdzOiBQYXJhbWV0ZXJzPFQ+KTogUmV0dXJuVHlwZTxUPiB7XG4gICAgICAvLyBFYXJseSBleGl0c1xuICAgICAgaWYgKCFpc0VuYWJsZWQob3B0aW9ucykgfHwgIWdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCkpIHtcbiAgICAgICAgcmV0dXJuIG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpIGFzIFJldHVyblR5cGU8VD47XG4gICAgICB9XG5cbiAgICAgIC8vIEV4dHJhY3QgUmVjb3JkT3ZlcnJpZGVzIGZyb20gb3B0aW9uc1xuICAgICAgY29uc3Qge1xuICAgICAgICBvcGVyYXRpb246IG9wTmFtZSxcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgbGV2ZWwsXG4gICAgICAgIGFyZ05hbWVzLFxuICAgICAgICBkYXRhRXh0cmFjdG9yLFxuICAgICAgICBlbmFibGVkLFxuICAgICAgICBzb3VyY2VUeXBlLFxuICAgICAgICAuLi5yZWNvcmRPdmVycmlkZXNcbiAgICAgIH0gPSBvcHRpb25zO1xuXG4gICAgICAvLyBDb21wdXRlIHNvdXJjZSAodXNlIGV4cGxpY2l0IHNvdXJjZSBvdmVycmlkZSBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlIGF1dG8tZGV0ZWN0KVxuICAgICAgY29uc3QgY29tcHV0ZWRTb3VyY2UgPSByZXNvbHZlU291cmNlKHNvdXJjZVR5cGUsIGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgICBjb25zdCBmaW5hbFNvdXJjZSA9IHJlY29yZE92ZXJyaWRlcy5zb3VyY2UgPz8gY29tcHV0ZWRTb3VyY2U7XG5cbiAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgIHJldHVybiBleGVjdXRlV2l0aEhhbmRsZXJzKFxuICAgICAgICBvcmlnaW5hbE1ldGhvZCxcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYXJncyxcbiAgICAgICAgKHN1Y2Nlc3MsIHJlc3VsdCwgZXJyb3IpID0+IHtcbiAgICAgICAgICByZWNvcmRBdWRpdChcbiAgICAgICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgICAgIGZpbmFsU291cmNlLFxuICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgICByZXN1bHQsXG4gICAgICAgICAgICBzdWNjZXNzLFxuICAgICAgICAgICAgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSxcbiAgICAgICAgICAgIGVycm9yID8gbm9ybWFsaXplRXJyb3IoZXJyb3IpIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgcmVjb3JkT3ZlcnJpZGVzLFxuICAgICAgICAgICAgdG9TZXJpYWxpemVPcHRpb25zKHJlY29yZE92ZXJyaWRlcy5jYXB0dXJlPy5hcmdzKSxcbiAgICAgICAgICAgIHRvU2VyaWFsaXplT3B0aW9ucyhyZWNvcmRPdmVycmlkZXMuY2FwdHVyZT8ucmVzdWx0KVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfSBhcyBUO1xuXG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH07XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gSGVscGVyc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmZ1bmN0aW9uIGlzRW5hYmxlZChvcHRpb25zOiBBdWRpdGVkT3B0aW9ucyk6IGJvb2xlYW4ge1xuICBpZiAob3B0aW9ucy5lbmFibGVkID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICByZXR1cm4gdHlwZW9mIG9wdGlvbnMuZW5hYmxlZCA9PT0gJ2Z1bmN0aW9uJyA/IG9wdGlvbnMuZW5hYmxlZCgpIDogb3B0aW9ucy5lbmFibGVkO1xufVxuXG4vKipcbiAqIENvbnZlcnQgZGVjb3JhdG9yIGNhcHR1cmUgb3B0aW9ucyB0byBTZXJpYWxpemVPcHRpb25zXG4gKi9cbmZ1bmN0aW9uIHRvU2VyaWFsaXplT3B0aW9ucyhvcHRpb246IGJvb2xlYW4gfCBDYXB0dXJlU2VyaWFsaXplT3B0aW9ucyB8IHVuZGVmaW5lZCk6IFNlcmlhbGl6ZU9wdGlvbnMgfCB1bmRlZmluZWQge1xuICBpZiAob3B0aW9uID09PSB1bmRlZmluZWQgfHwgb3B0aW9uID09PSBmYWxzZSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKG9wdGlvbiA9PT0gdHJ1ZSkgcmV0dXJuIHt9OyAvLyBVc2UgZGVmYXVsdHNcbiAgcmV0dXJuIG9wdGlvbjsgLy8gQWxyZWFkeSBTZXJpYWxpemVPcHRpb25zXG59XG5cbmZ1bmN0aW9uIHJlY29yZEF1ZGl0KFxuICBvcGVyYXRpb246IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIG9wdGlvbnM6IEF1ZGl0ZWRPcHRpb25zLFxuICBhcmdzOiB1bmtub3duW10sXG4gIHJlc3VsdDogdW5rbm93bixcbiAgc3VjY2VzczogYm9vbGVhbixcbiAgZHVyYXRpb25NczogbnVtYmVyLFxuICBlcnJvcjogRXJyb3IgfCB1bmRlZmluZWQsXG4gIHJlY29yZE92ZXJyaWRlczogUGFydGlhbDxEZWNvcmF0b3JCYXNlT3B0aW9ucz4sXG4gIGFyZ3NTZXJpYWxpemVPcHRzOiBTZXJpYWxpemVPcHRpb25zIHwgdW5kZWZpbmVkLFxuICByZXN1bHRTZXJpYWxpemVPcHRzOiBTZXJpYWxpemVPcHRpb25zIHwgdW5kZWZpbmVkXG4pOiB2b2lkIHtcbiAgLy8gQnVpbGQgYXVkaXQgZGF0YVxuICBsZXQgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7IHN1Y2Nlc3MsIGR1cmF0aW9uTXMgfTtcblxuICAvLyBVc2UgY3VzdG9tIGRhdGEgZXh0cmFjdG9yIGlmIHByb3ZpZGVkXG4gIGlmIChvcHRpb25zLmRhdGFFeHRyYWN0b3IpIHtcbiAgICAvLyBObyBkZWZlbnNpdmUgZmFsbGJhY2tzOiBleHRyYWN0b3IgZXJyb3JzIHNob3VsZCBzdXJmYWNlICh0ZXN0cyArIGNhbGxlciB2aXNpYmlsaXR5KS5cbiAgICBkYXRhID0geyAuLi5kYXRhLCAuLi5vcHRpb25zLmRhdGFFeHRyYWN0b3IoYXJncywgcmVzdWx0KSB9O1xuICB9IGVsc2Uge1xuICAgIC8vIENhcHR1cmUgYXJncyBpZiByZXF1ZXN0ZWRcbiAgICBpZiAoYXJnc1NlcmlhbGl6ZU9wdHMgJiYgYXJncy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAob3B0aW9ucy5hcmdOYW1lcz8ubGVuZ3RoKSB7XG4gICAgICAgIC8vIENhcHR1cmUgc3BlY2lmaWMgbmFtZWQgYXJndW1lbnRzXG4gICAgICAgIGNvbnN0IG5hbWVkQXJnczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgb3B0aW9ucy5hcmdOYW1lcy5mb3JFYWNoKChuYW1lLCBpbmRleCkgPT4ge1xuICAgICAgICAgIGlmIChpbmRleCA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgICAgICAgICBuYW1lZEFyZ3NbIG5hbWUgXSA9IHNhZmVTZXJpYWxpemUoYXJnc1sgaW5kZXggXSwgYXJnc1NlcmlhbGl6ZU9wdHMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuYXJncyA9IG5hbWVkQXJncztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRhdGEuYXJncyA9IHNhZmVTZXJpYWxpemUoYXJncywgYXJnc1NlcmlhbGl6ZU9wdHMpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENhcHR1cmUgcmVzdWx0IGlmIHJlcXVlc3RlZFxuICAgIGlmIChyZXN1bHRTZXJpYWxpemVPcHRzICYmIHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBkYXRhLnJlc3VsdCA9IHNhZmVTZXJpYWxpemUocmVzdWx0LCByZXN1bHRTZXJpYWxpemVPcHRzKTtcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgZXJyb3IgaW5mbyBpZiBmYWlsZWRcbiAgaWYgKGVycm9yKSB7XG4gICAgZGF0YS5lcnJvciA9IHsgdHlwZTogZXJyb3IubmFtZSwgbWVzc2FnZTogZXJyb3IubWVzc2FnZSB9O1xuICB9XG5cbiAgLy8gUGFzcyB0aHJvdWdoIGFsbCBSZWNvcmRPdmVycmlkZXMgZmllbGRzXG4gIEF1ZGl0T2JzZXJ2ZXIucmVjb3JkKHtcbiAgICBvcGVyYXRpb24sXG4gICAgZW50aXR5TmFtZTogb3B0aW9ucy5lbnRpdHlOYW1lLFxuICAgIGRhdGEsXG4gICAgbGV2ZWw6IGVycm9yID8gJ2Vycm9yJyA6IChvcHRpb25zLmxldmVsID8/ICdpbmZvJyksXG4gICAgc291cmNlLFxuICAgIC4uLnJlY29yZE92ZXJyaWRlcyxcbiAgfSk7XG59XG4iXX0=