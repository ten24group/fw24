"use strict";
/**
 * @Traced Decorator - Automatic span tracing for methods
 *
 * Wraps a method in a span, automatically recording duration and errors.
 * Parent tracking is FULLY AUTOMATIC via span tree.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Traced()
 *   async processOrder(orderId: string): Promise<Order> {
 *     // Method body is automatically traced
 *   }
 *
 *   @Traced({ name: 'custom.operation', level: 'debug' })
 *   async helperMethod(): Promise<void> { }
 * }
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Traced = Traced;
const execution_context_1 = require("../../core/runtime/execution-context");
const span_1 = require("../observers/span");
const decorator_utils_1 = require("./decorator-utils");
const payload_1 = require("../utils/payload");
/**
 * Method decorator that wraps a method in a trace span
 */
function Traced(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        // Pre-compute static values
        const className = target.constructor.name;
        const methodName = String(propertyKey);
        const spanName = options.name ?? `${className}.${methodName}`;
        descriptor.value = function (...args) {
            // Early exits
            if (!isEnabled(options) || !(0, execution_context_1.getCurrentExecutionContext)()) {
                return originalMethod.apply(this, args);
            }
            // Extract RecordOverrides from options
            const { name, level, data, enabled, sourceType, ...recordOverrides } = options;
            // Compute source (use explicit source override if provided, otherwise auto-detect)
            const computedSource = (0, decorator_utils_1.resolveSource)(sourceType, className, methodName);
            const finalSource = recordOverrides.source ?? computedSource;
            // Extract capture options from capture namespace
            const argsSerializeOpts = toSerializeOptions(recordOverrides.capture?.args);
            return span_1.SpanObserver.wrap(spanName, () => {
                return originalMethod.apply(this, args);
            }, {
                ...recordOverrides,
                level,
                source: finalSource,
                tags: {
                    ...recordOverrides.tags,
                    'code.function': methodName,
                    'code.namespace': className,
                },
                data: {
                    ...data,
                    ...(argsSerializeOpts && args.length > 0 && { args: (0, payload_1.safeSerialize)(args, argsSerializeOpts) }),
                },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy90cmFjZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7O0FBb0JILHdCQStEQztBQWpGRCw0RUFBa0Y7QUFDbEYsNENBQThEO0FBRTlELHVEQUFrRDtBQUNsRCw4Q0FBd0U7QUFXeEU7O0dBRUc7QUFDSCxTQUFnQixNQUFNLENBQUMsVUFBeUIsRUFBRTtJQUNoRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsSUFBSSxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRTlELFVBQVUsQ0FBQyxLQUFLLEdBQUcsVUFBc0MsR0FBRyxJQUFtQjtZQUM3RSxjQUFjO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUEsOENBQTBCLEdBQUUsRUFBRSxDQUFDO2dCQUN6RCxPQUFPLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBa0IsQ0FBQztZQUMzRCxDQUFDO1lBRUQsdUNBQXVDO1lBQ3ZDLE1BQU0sRUFDSixJQUFJLEVBQ0osS0FBSyxFQUNMLElBQUksRUFDSixPQUFPLEVBQ1AsVUFBVSxFQUNWLEdBQUcsZUFBZSxFQUNuQixHQUFHLE9BQU8sQ0FBQztZQUVaLG1GQUFtRjtZQUNuRixNQUFNLGNBQWMsR0FBRyxJQUFBLCtCQUFhLEVBQUMsVUFBVSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUMsQ0FBQztZQUN4RSxNQUFNLFdBQVcsR0FBRyxlQUFlLENBQUMsTUFBTSxJQUFJLGNBQWMsQ0FBQztZQUU3RCxpREFBaUQ7WUFDakQsTUFBTSxpQkFBaUIsR0FBRyxrQkFBa0IsQ0FBQyxlQUFlLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1lBRTVFLE9BQU8sbUJBQVksQ0FBQyxJQUFJLENBQ3RCLFFBQVEsRUFDUixHQUFHLEVBQUU7Z0JBQ0gsT0FBTyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQWtCLENBQUM7WUFDM0QsQ0FBQyxFQUNEO2dCQUNFLEdBQUcsZUFBZTtnQkFDbEIsS0FBSztnQkFDTCxNQUFNLEVBQUUsV0FBVztnQkFDbkIsSUFBSSxFQUFFO29CQUNKLEdBQUcsZUFBZSxDQUFDLElBQUk7b0JBQ3ZCLGVBQWUsRUFBRSxVQUFVO29CQUMzQixnQkFBZ0IsRUFBRSxTQUFTO2lCQUM1QjtnQkFDRCxJQUFJLEVBQUU7b0JBQ0osR0FBRyxJQUFJO29CQUNQLEdBQUcsQ0FBQyxpQkFBaUIsSUFBSSxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFBLHVCQUFhLEVBQUMsSUFBSSxFQUFFLGlCQUFpQixDQUFDLEVBQUUsQ0FBQztpQkFDOUY7YUFDRixDQUNlLENBQUM7UUFDckIsQ0FBTSxDQUFDO1FBRVAsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUVELDhFQUE4RTtBQUM5RSxVQUFVO0FBQ1YsOEVBQThFO0FBRTlFLFNBQVMsU0FBUyxDQUFDLE9BQXNCO0lBQ3ZDLElBQUksT0FBTyxDQUFDLE9BQU8sS0FBSyxTQUFTO1FBQUUsT0FBTyxJQUFJLENBQUM7SUFDL0MsT0FBTyxPQUFPLE9BQU8sQ0FBQyxPQUFPLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDckYsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxNQUFxRDtJQUMvRSxJQUFJLE1BQU0sS0FBSyxTQUFTLElBQUksTUFBTSxLQUFLLEtBQUs7UUFBRSxPQUFPLFNBQVMsQ0FBQztJQUMvRCxJQUFJLE1BQU0sS0FBSyxJQUFJO1FBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQyxlQUFlO0lBQy9DLE9BQU8sTUFBTSxDQUFDLENBQUMsMkJBQTJCO0FBQzVDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBUcmFjZWQgRGVjb3JhdG9yIC0gQXV0b21hdGljIHNwYW4gdHJhY2luZyBmb3IgbWV0aG9kc1xuICogXG4gKiBXcmFwcyBhIG1ldGhvZCBpbiBhIHNwYW4sIGF1dG9tYXRpY2FsbHkgcmVjb3JkaW5nIGR1cmF0aW9uIGFuZCBlcnJvcnMuXG4gKiBQYXJlbnQgdHJhY2tpbmcgaXMgRlVMTFkgQVVUT01BVElDIHZpYSBzcGFuIHRyZWUuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgT3JkZXJTZXJ2aWNlIHtcbiAqICAgQFRyYWNlZCgpXG4gKiAgIGFzeW5jIHByb2Nlc3NPcmRlcihvcmRlcklkOiBzdHJpbmcpOiBQcm9taXNlPE9yZGVyPiB7XG4gKiAgICAgLy8gTWV0aG9kIGJvZHkgaXMgYXV0b21hdGljYWxseSB0cmFjZWRcbiAqICAgfVxuICogICBcbiAqICAgQFRyYWNlZCh7IG5hbWU6ICdjdXN0b20ub3BlcmF0aW9uJywgbGV2ZWw6ICdkZWJ1ZycgfSlcbiAqICAgYXN5bmMgaGVscGVyTWV0aG9kKCk6IFByb21pc2U8dm9pZD4geyB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIFNwYW5PcHRpb25zIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHR5cGUgeyBEZWNvcmF0b3JCYXNlT3B0aW9ucywgQ2FwdHVyZVNlcmlhbGl6ZU9wdGlvbnMgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyByZXNvbHZlU291cmNlIH0gZnJvbSAnLi9kZWNvcmF0b3ItdXRpbHMnO1xuaW1wb3J0IHsgc2FmZVNlcmlhbGl6ZSwgdHlwZSBTZXJpYWxpemVPcHRpb25zIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhY2VkT3B0aW9ucyBleHRlbmRzIERlY29yYXRvckJhc2VPcHRpb25zIHtcbiAgLyoqIEN1c3RvbSBzcGFuIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBuYW1lPzogc3RyaW5nO1xuICAvKiogU3BhbiBsZXZlbCAqL1xuICBsZXZlbD86IFNwYW5PcHRpb25zWyAnbGV2ZWwnIF07XG4gIC8qKiBJbml0aWFsIGRhdGEgcGF5bG9hZCAqL1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogTWV0aG9kIGRlY29yYXRvciB0aGF0IHdyYXBzIGEgbWV0aG9kIGluIGEgdHJhY2Ugc3BhblxuICovXG5leHBvcnQgZnVuY3Rpb24gVHJhY2VkKG9wdGlvbnM6IFRyYWNlZE9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogYW55W10pID0+IGFueT4oXG4gICAgdGFyZ2V0OiBvYmplY3QsXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPlxuICApOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPiB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIC8vIFByZS1jb21wdXRlIHN0YXRpYyB2YWx1ZXNcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBzcGFuTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICh0aGlzOiBUaGlzUGFyYW1ldGVyVHlwZTxUPiwgLi4uYXJnczogUGFyYW1ldGVyczxUPik6IFJldHVyblR5cGU8VD4ge1xuICAgICAgLy8gRWFybHkgZXhpdHNcbiAgICAgIGlmICghaXNFbmFibGVkKG9wdGlvbnMpIHx8ICFnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpKSB7XG4gICAgICAgIHJldHVybiBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKSBhcyBSZXR1cm5UeXBlPFQ+O1xuICAgICAgfVxuXG4gICAgICAvLyBFeHRyYWN0IFJlY29yZE92ZXJyaWRlcyBmcm9tIG9wdGlvbnNcbiAgICAgIGNvbnN0IHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgbGV2ZWwsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIGVuYWJsZWQsXG4gICAgICAgIHNvdXJjZVR5cGUsXG4gICAgICAgIC4uLnJlY29yZE92ZXJyaWRlc1xuICAgICAgfSA9IG9wdGlvbnM7XG5cbiAgICAgIC8vIENvbXB1dGUgc291cmNlICh1c2UgZXhwbGljaXQgc291cmNlIG92ZXJyaWRlIGlmIHByb3ZpZGVkLCBvdGhlcndpc2UgYXV0by1kZXRlY3QpXG4gICAgICBjb25zdCBjb21wdXRlZFNvdXJjZSA9IHJlc29sdmVTb3VyY2Uoc291cmNlVHlwZSwgY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICAgIGNvbnN0IGZpbmFsU291cmNlID0gcmVjb3JkT3ZlcnJpZGVzLnNvdXJjZSA/PyBjb21wdXRlZFNvdXJjZTtcblxuICAgICAgLy8gRXh0cmFjdCBjYXB0dXJlIG9wdGlvbnMgZnJvbSBjYXB0dXJlIG5hbWVzcGFjZVxuICAgICAgY29uc3QgYXJnc1NlcmlhbGl6ZU9wdHMgPSB0b1NlcmlhbGl6ZU9wdGlvbnMocmVjb3JkT3ZlcnJpZGVzLmNhcHR1cmU/LmFyZ3MpO1xuXG4gICAgICByZXR1cm4gU3Bhbk9ic2VydmVyLndyYXAoXG4gICAgICAgIHNwYW5OYW1lLFxuICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpIGFzIFJldHVyblR5cGU8VD47XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAuLi5yZWNvcmRPdmVycmlkZXMsXG4gICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgc291cmNlOiBmaW5hbFNvdXJjZSxcbiAgICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgICAuLi5yZWNvcmRPdmVycmlkZXMudGFncyxcbiAgICAgICAgICAgICdjb2RlLmZ1bmN0aW9uJzogbWV0aG9kTmFtZSxcbiAgICAgICAgICAgICdjb2RlLm5hbWVzcGFjZSc6IGNsYXNzTmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIC4uLmRhdGEsXG4gICAgICAgICAgICAuLi4oYXJnc1NlcmlhbGl6ZU9wdHMgJiYgYXJncy5sZW5ndGggPiAwICYmIHsgYXJnczogc2FmZVNlcmlhbGl6ZShhcmdzLCBhcmdzU2VyaWFsaXplT3B0cykgfSksXG4gICAgICAgICAgfSxcbiAgICAgICAgfVxuICAgICAgKSBhcyBSZXR1cm5UeXBlPFQ+O1xuICAgIH0gYXMgVDtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIEhlbHBlcnNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5mdW5jdGlvbiBpc0VuYWJsZWQob3B0aW9uczogVHJhY2VkT3B0aW9ucyk6IGJvb2xlYW4ge1xuICBpZiAob3B0aW9ucy5lbmFibGVkID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICByZXR1cm4gdHlwZW9mIG9wdGlvbnMuZW5hYmxlZCA9PT0gJ2Z1bmN0aW9uJyA/IG9wdGlvbnMuZW5hYmxlZCgpIDogb3B0aW9ucy5lbmFibGVkO1xufVxuXG4vKipcbiAqIENvbnZlcnQgZGVjb3JhdG9yIGNhcHR1cmUgb3B0aW9ucyB0byBTZXJpYWxpemVPcHRpb25zXG4gKi9cbmZ1bmN0aW9uIHRvU2VyaWFsaXplT3B0aW9ucyhvcHRpb246IGJvb2xlYW4gfCBDYXB0dXJlU2VyaWFsaXplT3B0aW9ucyB8IHVuZGVmaW5lZCk6IFNlcmlhbGl6ZU9wdGlvbnMgfCB1bmRlZmluZWQge1xuICBpZiAob3B0aW9uID09PSB1bmRlZmluZWQgfHwgb3B0aW9uID09PSBmYWxzZSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKG9wdGlvbiA9PT0gdHJ1ZSkgcmV0dXJuIHt9OyAvLyBVc2UgZGVmYXVsdHNcbiAgcmV0dXJuIG9wdGlvbjsgLy8gQWxyZWFkeSBTZXJpYWxpemVPcHRpb25zXG59XG4iXX0=