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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Audited = Audited;
const execution_context_1 = require("../../core/runtime/execution-context");
const audit_1 = require("../observers/audit");
const base_1 = require("../observers/base");
const payload_1 = require("../utils/payload");
const decorator_utils_1 = require("./decorator-utils");
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
            const { operation: opName, entityName, level, argNames, dataExtractor, captureArgs, captureResult, enabled, sourceType, ...recordOverrides } = options;
            // Compute source (use explicit source override if provided, otherwise auto-detect)
            const computedSource = (0, decorator_utils_1.resolveSource)(sourceType, className, methodName);
            const finalSource = recordOverrides.source ?? computedSource;
            const startTime = Date.now();
            return (0, decorator_utils_1.executeWithHandlers)(originalMethod, this, args, (success, result, error) => {
                recordAudit(operation, finalSource, options, args, result, success, Date.now() - startTime, error ? (0, base_1.normalizeError)(error) : undefined, recordOverrides);
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
function recordAudit(operation, source, options, args, result, success, durationMs, error, recordOverrides) {
    // Build audit data
    let data = { success, durationMs };
    // Use custom data extractor if provided
    if (options.dataExtractor) {
        // No defensive fallbacks: extractor errors should surface (tests + caller visibility).
        data = { ...data, ...options.dataExtractor(args, result) };
    }
    else {
        // Capture args if requested
        if (options.captureArgs && args.length > 0) {
            if (options.argNames?.length) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMvYXVkaXRlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXdCRzs7QUF5QkgsMEJBZ0VDO0FBdkZELDRFQUFrRjtBQUNsRiw4Q0FBbUQ7QUFDbkQsNENBQW1EO0FBRW5ELDhDQUFpRDtBQUNqRCx1REFBdUU7QUFldkU7O0dBRUc7QUFDSCxTQUFnQixPQUFPLENBQUMsVUFBMEIsRUFBRTtJQUNsRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUyxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRXBFLFVBQVUsQ0FBQyxLQUFLLEdBQUcsVUFBc0MsR0FBRyxJQUFtQjtZQUM3RSxjQUFjO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUEsOENBQTBCLEdBQUUsRUFBRSxDQUFDO2dCQUN6RCxPQUFPLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBa0IsQ0FBQztZQUMzRCxDQUFDO1lBRUQsdUNBQXVDO1lBQ3ZDLE1BQU0sRUFDSixTQUFTLEVBQUUsTUFBTSxFQUNqQixVQUFVLEVBQ1YsS0FBSyxFQUNMLFFB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SSxPQUFPLENBQUMsYUFBYSxJQUFJLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNsRCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsdUJBQWEsRUFBQyxNQUFNLENBQUMsQ0FBQztRQUN0QyxDQUFDO0lBQ0gsQ0FBQztJQUVELDJCQUEyQjtJQUMzQixJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ1YsSUFBSSxDQUFDLEtBQUssR0FBRyxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDNUQsQ0FBQztJQUVELDBDQUEwQztJQUMxQyxxQkFBYSxDQUFDLE1BQU0sQ0FBQztRQUNuQixTQUFTO1FBQ1QsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1FBQzlCLElBQUk7UUFDSixLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUM7UUFDbEQsTUFBTTtRQUNOLEdBQUcsZUFBZTtLQUNuQixDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAQXVkaXRlZCBEZWNvcmF0b3IgLSBBdXRvbWF0aWMgYXVkaXQgbG9nZ2luZyBmb3IgbWV0aG9kc1xuICogXG4gKiBSZWNvcmRzIGF1ZGl0IGV2ZW50cyBmb3IgbWV0aG9kIGNhbGxzLCB1c2VmdWwgZm9yIHRyYWNraW5nXG4gKiBzZW5zaXRpdmUgb3BlcmF0aW9ucywgcGVybWlzc2lvbiBjaGFuZ2VzLCBldGMuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgVXNlclNlcnZpY2Uge1xuICogICBAQXVkaXRlZCh7IG9wZXJhdGlvbjogJ3Blcm1pc3Npb24uY2hhbmdlJyB9KVxuICogICBhc3luYyB1cGRhdGVQZXJtaXNzaW9ucyh1c2VySWQ6IHN0cmluZywgcGVybWlzc2lvbnM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gKiAgICAgLy8gTWV0aG9kIGlzIGF1dG9tYXRpY2FsbHkgYXVkaXRlZFxuICogICB9XG4gKiAgIFxuICogICBAQXVkaXRlZCh7IFxuICogICAgIG9wZXJhdGlvbjogJ3NlbnNpdGl2ZS5hY2Nlc3MnLCBcbiAqICAgICBsZXZlbDogJ3dhcm4nLFxuICogICAgIGNhcHR1cmVBcmdzOiB0cnVlIFxuICogICB9KVxuICogICBhc3luYyBhY2Nlc3NTZW5zaXRpdmVEYXRhKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxTZW5zaXRpdmVEYXRhPiB7XG4gKiAgICAgLy8gQXVkaXQgd2l0aCBhcmd1bWVudHMgY2FwdHVyZWRcbiAqICAgfVxuICogfVxuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgQXVkaXRPYnNlcnZlciB9IGZyb20gJy4uL29ic2VydmVycy9hdWRpdCc7XG5pbXBvcnQgeyBub3JtYWxpemVFcnJvciB9IGZyb20gJy4uL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB0eXBlIHsgRGVjb3JhdG9yQmFzZU9wdGlvbnMgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBzYWZlU2VyaWFsaXplIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5pbXBvcnQgeyBleGVjdXRlV2l0aEhhbmRsZXJzLCByZXNvbHZlU291cmNlIH0gZnJvbSAnLi9kZWNvcmF0b3ItdXRpbHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF1ZGl0ZWRPcHRpb25zIGV4dGVuZHMgRGVjb3JhdG9yQmFzZU9wdGlvbnMge1xuICAvKiogQXVkaXQgb3BlcmF0aW9uIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBvcGVyYXRpb24/OiBzdHJpbmc7XG4gIC8qKiBFbnRpdHkgbmFtZSBiZWluZyBhdWRpdGVkIChvcHRpb25hbCkgKi9cbiAgZW50aXR5TmFtZT86IHN0cmluZztcbiAgLyoqIEF1ZGl0IGxldmVsICovXG4gIGxldmVsPzogJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJztcbiAgLyoqIFNwZWNpZmljIGFyZ3VtZW50IG5hbWVzIHRvIGNhcHR1cmUgKGlmIGNhcHR1cmVBcmdzIGlzIGZhbHNlKSAqL1xuICBhcmdOYW1lcz86IHN0cmluZ1tdO1xuICAvKiogQ3VzdG9tIGRhdGEgZXh0cmFjdG9yIGZ1bmN0aW9uICovXG4gIGRhdGFFeHRyYWN0b3I/OiAoYXJnczogdW5rbm93bltdLCByZXN1bHQ/OiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuLyoqXG4gKiBNZXRob2QgZGVjb3JhdG9yIHRoYXQgcmVjb3JkcyBhbiBhdWRpdCBldmVudCBmb3IgbWV0aG9kIGNhbGxzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBBdWRpdGVkKG9wdGlvbnM6IEF1ZGl0ZWRPcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgKC4uLmFyZ3M6IGFueVtdKSA9PiBhbnk+KFxuICAgIHRhcmdldDogb2JqZWN0LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbiAgKTogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD4ge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBpZiAodHlwZW9mIG9yaWdpbmFsTWV0aG9kICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgICB9XG5cbiAgICAvLyBQcmUtY29tcHV0ZSBzdGF0aWMgdmFsdWVzXG4gICAgY29uc3QgY2xhc3NOYW1lID0gdGFyZ2V0LmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgbWV0aG9kTmFtZSA9IFN0cmluZyhwcm9wZXJ0eUtleSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uID0gb3B0aW9ucy5vcGVyYXRpb24gPz8gYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcblxuICAgIGRlc2NyaXB0b3IudmFsdWUgPSBmdW5jdGlvbiAodGhpczogVGhpc1BhcmFtZXRlclR5cGU8VD4sIC4uLmFyZ3M6IFBhcmFtZXRlcnM8VD4pOiBSZXR1cm5UeXBlPFQ+IHtcbiAgICAgIC8vIEVhcmx5IGV4aXRzXG4gICAgICBpZiAoIWlzRW5hYmxlZChvcHRpb25zKSB8fCAhZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKSkge1xuICAgICAgICByZXR1cm4gb3JpZ2luYWxNZXRob2QuYXBwbHkodGhpcywgYXJncykgYXMgUmV0dXJuVHlwZTxUPjtcbiAgICAgIH1cblxuICAgICAgLy8gRXh0cmFjdCBSZWNvcmRPdmVycmlkZXMgZnJvbSBvcHRpb25zXG4gICAgICBjb25zdCB7XG4gICAgICAgIG9wZXJhdGlvbjogb3BOYW1lLFxuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBsZXZlbCxcbiAgICAgICAgYXJnTmFtZXMsXG4gICAgICAgIGRhdGFFeHRyYWN0b3IsXG4gICAgICAgIGNhcHR1cmVBcmdzLFxuICAgICAgICBjYXB0dXJlUmVzdWx0LFxuICAgICAgICBlbmFibGVkLFxuICAgICAgICBzb3VyY2VUeXBlLFxuICAgICAgICAuLi5yZWNvcmRPdmVycmlkZXNcbiAgICAgIH0gPSBvcHRpb25zO1xuXG4gICAgICAvLyBDb21wdXRlIHNvdXJjZSAodXNlIGV4cGxpY2l0IHNvdXJjZSBvdmVycmlkZSBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlIGF1dG8tZGV0ZWN0KVxuICAgICAgY29uc3QgY29tcHV0ZWRTb3VyY2UgPSByZXNvbHZlU291cmNlKHNvdXJjZVR5cGUsIGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgICBjb25zdCBmaW5hbFNvdXJjZSA9IHJlY29yZE92ZXJyaWRlcy5zb3VyY2UgPz8gY29tcHV0ZWRTb3VyY2U7XG5cbiAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICAgIHJldHVybiBleGVjdXRlV2l0aEhhbmRsZXJzKFxuICAgICAgICBvcmlnaW5hbE1ldGhvZCxcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYXJncyxcbiAgICAgICAgKHN1Y2Nlc3MsIHJlc3VsdCwgZXJyb3IpID0+IHtcbiAgICAgICAgICByZWNvcmRBdWRpdChcbiAgICAgICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgICAgIGZpbmFsU291cmNlLFxuICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgIGFyZ3MsXG4gICAgICAgICAgICByZXN1bHQsXG4gICAgICAgICAgICBzdWNjZXNzLFxuICAgICAgICAgICAgRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSxcbiAgICAgICAgICAgIGVycm9yID8gbm9ybWFsaXplRXJyb3IoZXJyb3IpIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgcmVjb3JkT3ZlcnJpZGVzXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICB9IGFzIFQ7XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBIZWxwZXJzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZnVuY3Rpb24gaXNFbmFibGVkKG9wdGlvbnM6IEF1ZGl0ZWRPcHRpb25zKTogYm9vbGVhbiB7XG4gIGlmIChvcHRpb25zLmVuYWJsZWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWU7XG4gIHJldHVybiB0eXBlb2Ygb3B0aW9ucy5lbmFibGVkID09PSAnZnVuY3Rpb24nID8gb3B0aW9ucy5lbmFibGVkKCkgOiBvcHRpb25zLmVuYWJsZWQ7XG59XG5cbmZ1bmN0aW9uIHJlY29yZEF1ZGl0KFxuICBvcGVyYXRpb246IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4gIG9wdGlvbnM6IEF1ZGl0ZWRPcHRpb25zLFxuICBhcmdzOiB1bmtub3duW10sXG4gIHJlc3VsdDogdW5rbm93bixcbiAgc3VjY2VzczogYm9vbGVhbixcbiAgZHVyYXRpb25NczogbnVtYmVyLFxuICBlcnJvcjogRXJyb3IgfCB1bmRlZmluZWQsXG4gIHJlY29yZE92ZXJyaWRlczogUGFydGlhbDxEZWNvcmF0b3JCYXNlT3B0aW9ucz5cbik6IHZvaWQge1xuICAvLyBCdWlsZCBhdWRpdCBkYXRhXG4gIGxldCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgc3VjY2VzcywgZHVyYXRpb25NcyB9O1xuXG4gIC8vIFVzZSBjdXN0b20gZGF0YSBleHRyYWN0b3IgaWYgcHJvdmlkZWRcbiAgaWYgKG9wdGlvbnMuZGF0YUV4dHJhY3Rvcikge1xuICAgIC8vIE5vIGRlZmVuc2l2ZSBmYWxsYmFja3M6IGV4dHJhY3RvciBlcnJvcnMgc2hvdWxkIHN1cmZhY2UgKHRlc3RzICsgY2FsbGVyIHZpc2liaWxpdHkpLlxuICAgIGRhdGEgPSB7IC4uLmRhdGEsIC4uLm9wdGlvbnMuZGF0YUV4dHJhY3RvcihhcmdzLCByZXN1bHQpIH07XG4gIH0gZWxzZSB7XG4gICAgLy8gQ2FwdHVyZSBhcmdzIGlmIHJlcXVlc3RlZFxuICAgIGlmIChvcHRpb25zLmNhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKG9wdGlvbnMuYXJnTmFtZXM/Lmxlbmd0aCkge1xuICAgICAgICAvLyBDYXB0dXJlIHNwZWNpZmljIG5hbWVkIGFyZ3VtZW50c1xuICAgICAgICBjb25zdCBuYW1lZEFyZ3M6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICAgIG9wdGlvbnMuYXJnTmFtZXMuZm9yRWFjaCgobmFtZSwgaW5kZXgpID0+IHtcbiAgICAgICAgICBpZiAoaW5kZXggPCBhcmdzLmxlbmd0aCkge1xuICAgICAgICAgICAgbmFtZWRBcmdzWyBuYW1lIF0gPSBzYWZlU2VyaWFsaXplKGFyZ3NbIGluZGV4IF0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGRhdGEuYXJncyA9IG5hbWVkQXJncztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRhdGEuYXJncyA9IHNhZmVTZXJpYWxpemUoYXJncyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ2FwdHVyZSByZXN1bHQgaWYgcmVxdWVzdGVkXG4gICAgaWYgKG9wdGlvbnMuY2FwdHVyZVJlc3VsdCAmJiByZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgZGF0YS5yZXN1bHQgPSBzYWZlU2VyaWFsaXplKHJlc3VsdCk7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGVycm9yIGluZm8gaWYgZmFpbGVkXG4gIGlmIChlcnJvcikge1xuICAgIGRhdGEuZXJyb3IgPSB7IHR5cGU6IGVycm9yLm5hbWUsIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UgfTtcbiAgfVxuXG4gIC8vIFBhc3MgdGhyb3VnaCBhbGwgUmVjb3JkT3ZlcnJpZGVzIGZpZWxkc1xuICBBdWRpdE9ic2VydmVyLnJlY29yZCh7XG4gICAgb3BlcmF0aW9uLFxuICAgIGVudGl0eU5hbWU6IG9wdGlvbnMuZW50aXR5TmFtZSxcbiAgICBkYXRhLFxuICAgIGxldmVsOiBlcnJvciA/ICdlcnJvcicgOiAob3B0aW9ucy5sZXZlbCA/PyAnaW5mbycpLFxuICAgIHNvdXJjZSxcbiAgICAuLi5yZWNvcmRPdmVycmlkZXMsXG4gIH0pO1xufVxuIl19