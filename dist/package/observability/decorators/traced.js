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
const payload_1 = require("../utils/payload");
const decorator_utils_1 = require("./decorator-utils");
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
            const { name, level, data, captureArgs, captureResult, enabled, sourceType, ...recordOverrides } = options;
            // Compute source (use explicit source override if provided, otherwise auto-detect)
            const computedSource = (0, decorator_utils_1.resolveSource)(sourceType, className, methodName);
            const finalSource = recordOverrides.source ?? computedSource;
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
                    ...(captureArgs && args.length > 0 && { args: (0, payload_1.safeSerialize)(args) }),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy90cmFjZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7O0FBb0JILHdCQThEQztBQWhGRCw0RUFBa0Y7QUFDbEYsNENBQThEO0FBRTlELDhDQUFpRDtBQUNqRCx1REFBa0Q7QUFXbEQ7O0dBRUc7QUFDSCxTQUFnQixNQUFNLENBQUMsVUFBeUIsRUFBRTtJQUNoRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQzFDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN2QyxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsSUFBSSxJQUFJLEdBQUcsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRTlELFVBQVUsQ0FBQyxLQUFLLEdBQUcsVUFBc0MsR0FBRyxJQUFtQjtZQUM3RSxjQUFjO1lBQ2QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUEsOENBQTBCLEdBQUUsRUFBRSxDQUFDO2dCQUN6RCxPQUFPLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBa0IsQ0FBQztZQUMzRCxDQUFDO1lBRUQsdUNBQXVDO1lBQ3ZDLE1BQU0sRUFDSixJQUFJLEVBQ0osS0FBSyxFQUNMLElBQUksRUFDSixXQUFXLEVBQ1gsYUFBYSxFQUNiLE9BQU8sRUFDUCxVQUFVLEVBQ1YsR0FBRyxlQUFlLEVBQ25CLEdBQUcsT0FBTyxDQUFDO1lBRVosbUZBQW1GO1lBQ25GLE1BQU0sY0FBYyxHQUFHLElBQUEsK0JBQWEsRUFBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQ3hFLE1BQU0sV0FBVyxHQUFHLGVBQWUsQ0FBQyxNQUFNLElBQUksY0FBYyxDQUFDO1lBRTdELE9BQU8sbUJBQVksQ0FBQyxJQUFJLENBQ3RCLFFBQVEsRUFDUixHQUFHLEVBQUU7Z0JBQ0gsT0FBTyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQWtCLENBQUM7WUFDM0QsQ0FBQyxFQUNEO2dCQUNFLEdBQUcsZUFBZTtnQkFDbEIsS0FBSztnQkFDTCxNQUFNLEVBQUUsV0FBVztnQkFDbkIsSUFBSSxFQUFFO29CQUNKLEdBQUcsZUFBZSxDQUFDLElBQUk7b0JBQ3ZCLGVBQWUsRUFBRSxVQUFVO29CQUMzQixnQkFBZ0IsRUFBRSxTQUFTO2lCQUM1QjtnQkFDRCxJQUFJLEVBQUU7b0JBQ0osR0FBRyxJQUFJO29CQUNQLEdBQUcsQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBQSx1QkFBYSxFQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7aUJBQ3JFO2FBQ0YsQ0FDZSxDQUFDO1FBQ3JCLENBQU0sQ0FBQztRQUVQLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUMsQ0FBQztBQUNKLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsVUFBVTtBQUNWLDhFQUE4RTtBQUU5RSxTQUFTLFNBQVMsQ0FBQyxPQUFzQjtJQUN2QyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUssU0FBUztRQUFFLE9BQU8sSUFBSSxDQUFDO0lBQy9DLE9BQU8sT0FBTyxPQUFPLENBQUMsT0FBTyxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO0FBQ3JGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBUcmFjZWQgRGVjb3JhdG9yIC0gQXV0b21hdGljIHNwYW4gdHJhY2luZyBmb3IgbWV0aG9kc1xuICogXG4gKiBXcmFwcyBhIG1ldGhvZCBpbiBhIHNwYW4sIGF1dG9tYXRpY2FsbHkgcmVjb3JkaW5nIGR1cmF0aW9uIGFuZCBlcnJvcnMuXG4gKiBQYXJlbnQgdHJhY2tpbmcgaXMgRlVMTFkgQVVUT01BVElDIHZpYSBzcGFuIHRyZWUuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgT3JkZXJTZXJ2aWNlIHtcbiAqICAgQFRyYWNlZCgpXG4gKiAgIGFzeW5jIHByb2Nlc3NPcmRlcihvcmRlcklkOiBzdHJpbmcpOiBQcm9taXNlPE9yZGVyPiB7XG4gKiAgICAgLy8gTWV0aG9kIGJvZHkgaXMgYXV0b21hdGljYWxseSB0cmFjZWRcbiAqICAgfVxuICogICBcbiAqICAgQFRyYWNlZCh7IG5hbWU6ICdjdXN0b20ub3BlcmF0aW9uJywgbGV2ZWw6ICdkZWJ1ZycgfSlcbiAqICAgYXN5bmMgaGVscGVyTWV0aG9kKCk6IFByb21pc2U8dm9pZD4geyB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuXG5pbXBvcnQgeyBnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dCc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIFNwYW5PcHRpb25zIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHR5cGUgeyBEZWNvcmF0b3JCYXNlT3B0aW9ucyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IHNhZmVTZXJpYWxpemUgfSBmcm9tICcuLi91dGlscy9wYXlsb2FkJztcbmltcG9ydCB7IHJlc29sdmVTb3VyY2UgfSBmcm9tICcuL2RlY29yYXRvci11dGlscyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhY2VkT3B0aW9ucyBleHRlbmRzIERlY29yYXRvckJhc2VPcHRpb25zIHtcbiAgLyoqIEN1c3RvbSBzcGFuIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBuYW1lPzogc3RyaW5nO1xuICAvKiogU3BhbiBsZXZlbCAqL1xuICBsZXZlbD86IFNwYW5PcHRpb25zWyAnbGV2ZWwnIF07XG4gIC8qKiBJbml0aWFsIGRhdGEgcGF5bG9hZCAqL1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbi8qKlxuICogTWV0aG9kIGRlY29yYXRvciB0aGF0IHdyYXBzIGEgbWV0aG9kIGluIGEgdHJhY2Ugc3BhblxuICovXG5leHBvcnQgZnVuY3Rpb24gVHJhY2VkKG9wdGlvbnM6IFRyYWNlZE9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogYW55W10pID0+IGFueT4oXG4gICAgdGFyZ2V0OiBvYmplY3QsXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPlxuICApOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxUPiB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIC8vIFByZS1jb21wdXRlIHN0YXRpYyB2YWx1ZXNcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBzcGFuTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICh0aGlzOiBUaGlzUGFyYW1ldGVyVHlwZTxUPiwgLi4uYXJnczogUGFyYW1ldGVyczxUPik6IFJldHVyblR5cGU8VD4ge1xuICAgICAgLy8gRWFybHkgZXhpdHNcbiAgICAgIGlmICghaXNFbmFibGVkKG9wdGlvbnMpIHx8ICFnZXRDdXJyZW50RXhlY3V0aW9uQ29udGV4dCgpKSB7XG4gICAgICAgIHJldHVybiBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKSBhcyBSZXR1cm5UeXBlPFQ+O1xuICAgICAgfVxuXG4gICAgICAvLyBFeHRyYWN0IFJlY29yZE92ZXJyaWRlcyBmcm9tIG9wdGlvbnNcbiAgICAgIGNvbnN0IHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgbGV2ZWwsXG4gICAgICAgIGRhdGEsXG4gICAgICAgIGNhcHR1cmVBcmdzLFxuICAgICAgICBjYXB0dXJlUmVzdWx0LFxuICAgICAgICBlbmFibGVkLFxuICAgICAgICBzb3VyY2VUeXBlLFxuICAgICAgICAuLi5yZWNvcmRPdmVycmlkZXNcbiAgICAgIH0gPSBvcHRpb25zO1xuXG4gICAgICAvLyBDb21wdXRlIHNvdXJjZSAodXNlIGV4cGxpY2l0IHNvdXJjZSBvdmVycmlkZSBpZiBwcm92aWRlZCwgb3RoZXJ3aXNlIGF1dG8tZGV0ZWN0KVxuICAgICAgY29uc3QgY29tcHV0ZWRTb3VyY2UgPSByZXNvbHZlU291cmNlKHNvdXJjZVR5cGUsIGNsYXNzTmFtZSwgbWV0aG9kTmFtZSk7XG4gICAgICBjb25zdCBmaW5hbFNvdXJjZSA9IHJlY29yZE92ZXJyaWRlcy5zb3VyY2UgPz8gY29tcHV0ZWRTb3VyY2U7XG5cbiAgICAgIHJldHVybiBTcGFuT2JzZXJ2ZXIud3JhcChcbiAgICAgICAgc3Bhbk5hbWUsXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gb3JpZ2luYWxNZXRob2QuYXBwbHkodGhpcywgYXJncykgYXMgUmV0dXJuVHlwZTxUPjtcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIC4uLnJlY29yZE92ZXJyaWRlcyxcbiAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICBzb3VyY2U6IGZpbmFsU291cmNlLFxuICAgICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICAgIC4uLnJlY29yZE92ZXJyaWRlcy50YWdzLFxuICAgICAgICAgICAgJ2NvZGUuZnVuY3Rpb24nOiBtZXRob2ROYW1lLFxuICAgICAgICAgICAgJ2NvZGUubmFtZXNwYWNlJzogY2xhc3NOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgLi4uZGF0YSxcbiAgICAgICAgICAgIC4uLihjYXB0dXJlQXJncyAmJiBhcmdzLmxlbmd0aCA+IDAgJiYgeyBhcmdzOiBzYWZlU2VyaWFsaXplKGFyZ3MpIH0pLFxuICAgICAgICAgIH0sXG4gICAgICAgIH1cbiAgICAgICkgYXMgUmV0dXJuVHlwZTxUPjtcbiAgICB9IGFzIFQ7XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBIZWxwZXJzXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZnVuY3Rpb24gaXNFbmFibGVkKG9wdGlvbnM6IFRyYWNlZE9wdGlvbnMpOiBib29sZWFuIHtcbiAgaWYgKG9wdGlvbnMuZW5hYmxlZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIHR5cGVvZiBvcHRpb25zLmVuYWJsZWQgPT09ICdmdW5jdGlvbicgPyBvcHRpb25zLmVuYWJsZWQoKSA6IG9wdGlvbnMuZW5hYmxlZDtcbn1cbiJdfQ==