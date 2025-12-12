"use strict";
/**
 * @Traced Decorator - Automatic span tracing for methods
 *
 * Wraps a method in a span, automatically recording duration and errors.
 *
 * Usage:
 * ```typescript
 * class OrderService {
 *   @Traced()
 *   async processOrder(orderId: string): Promise<Order> {
 *     // Method body is automatically traced
 *   }
 *
 *   @Traced({ name: 'custom-operation', level: 'debug' })
 *   async internalProcess(): Promise<void> {
 *     // Custom span name and level
 *   }
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Otherwise creates a NoOp span that doesn't record anything
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Traced = Traced;
const span_1 = require("../observers/span");
const source_utils_1 = require("../utils/source-utils");
const payload_1 = require("../utils/payload");
const base_1 = require("../observers/base");
/**
 * Auto-detect source type from class name
 */
function autoDetectSourceType(className) {
    const lowerName = className.toLowerCase();
    if (lowerName.includes('controller')) {
        return 'controller';
    }
    if (lowerName.includes('service')) {
        return 'service';
    }
    if (lowerName.includes('queue') || lowerName.includes('queuehandler')) {
        return 'queue';
    }
    if (lowerName.includes('task') || lowerName.includes('taskhandler')) {
        return 'task';
    }
    return 'handler';
}
/**
 * Method decorator that wraps a method in a trace span
 *
 * @param options - Tracing options
 */
function Traced(options = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        if (typeof originalMethod !== 'function') {
            return descriptor;
        }
        const className = target.constructor.name;
        const methodName = String(propertyKey);
        const spanName = options.name ?? `${className}.${methodName}`;
        // Auto-detect source type if not explicitly provided
        const sourceType = options.sourceType ?? autoDetectSourceType(className);
        // Determine source based on sourceType
        let source;
        switch (sourceType) {
            case 'controller':
                source = (0, source_utils_1.createControllerSource)(className, methodName);
                break;
            case 'service':
                source = (0, source_utils_1.createServiceSource)(className, methodName);
                break;
            case 'queue':
                source = (0, source_utils_1.createQueueSource)(className, methodName);
                break;
            case 'task':
                source = (0, source_utils_1.createTaskSource)(className, methodName);
                break;
            default:
                source = `${className}.${methodName}`;
        }
        // Wrap method - handles both sync and async via result checking
        // This is more robust than checking constructor.name which can break with transpilation
        const wrappedMethod = function (...args) {
            const spanOptions = {
                level: options.level,
                attributes: {
                    'code.function': methodName,
                    'code.namespace': className,
                    ...options.attributes,
                    ...(options.captureArgs && args.length > 0 && { args: (0, payload_1.safeSerialize)(args) }),
                },
                tags: options.tags,
                source,
            };
            const span = span_1.SpanObserver.start(spanName, spanOptions);
            try {
                const result = originalMethod.apply(this, args);
                // Check if result is a Promise/thenable (works with any async method)
                if (result && typeof result.then === 'function') {
                    // Handle async method
                    return result
                        .then((value) => {
                        if (options.captureResult && value !== undefined) {
                            span.setAttribute('result', (0, payload_1.safeSerialize)(value));
                        }
                        span.end({ success: true });
                        return value;
                    })
                        .catch((error) => {
                        span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                        throw error;
                    });
                }
                // Handle sync method
                if (options.captureResult && result !== undefined) {
                    span.setAttribute('result', (0, payload_1.safeSerialize)(result));
                }
                span.end({ success: true });
                return result;
            }
            catch (error) {
                span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                throw error;
            }
        };
        descriptor.value = wrappedMethod;
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy90cmFjZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRzs7QUEyREgsd0JBMEZDO0FBbkpELDRDQUE4RDtBQUM5RCx3REFBdUk7QUFDdkksOENBQWlEO0FBQ2pELDRDQUFtRDtBQUVuRDs7R0FFRztBQUNILFNBQVMsb0JBQW9CLENBQUMsU0FBaUI7SUFDN0MsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTFDLElBQUksU0FBUyxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1FBQ3JDLE9BQU8sWUFBWSxDQUFDO0lBQ3RCLENBQUM7SUFDRCxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUNsQyxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBQ0QsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztRQUN0RSxPQUFPLE9BQU8sQ0FBQztJQUNqQixDQUFDO0lBQ0QsSUFBSSxTQUFTLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLFNBQVMsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztRQUNwRSxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQTJCRDs7OztHQUlHO0FBQ0gsU0FBZ0IsTUFBTSxDQUFDLFVBQXlCLEVBQUU7SUFDaEQsT0FBTyxVQUNMLE1BQWMsRUFDZCxXQUE0QixFQUM1QixVQUFzQztRQUV0QyxNQUFNLGNBQWMsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDO1FBRXhDLElBQUksT0FBTyxj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QUssQ0FBQyxFQUFFLENBQUMsQ0FBQzt3QkFDM0QsTUFBTSxLQUFLLENBQUM7b0JBQ2QsQ0FBQyxDQUFDLENBQUM7Z0JBQ1AsQ0FBQztnQkFFRCxxQkFBcUI7Z0JBQ3JCLElBQUksT0FBTyxDQUFDLGFBQWEsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7b0JBQ2xELElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxFQUFFLElBQUEsdUJBQWEsRUFBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO2dCQUNyRCxDQUFDO2dCQUNELElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDNUIsT0FBTyxNQUFNLENBQUM7WUFDaEIsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUEscUJBQWMsRUFBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQzNELE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQztRQUNILENBQUMsQ0FBQztRQUNGLFVBQVUsQ0FBQyxLQUFLLEdBQUcsYUFBa0IsQ0FBQztRQUV0QyxPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAVHJhY2VkIERlY29yYXRvciAtIEF1dG9tYXRpYyBzcGFuIHRyYWNpbmcgZm9yIG1ldGhvZHNcbiAqIFxuICogV3JhcHMgYSBtZXRob2QgaW4gYSBzcGFuLCBhdXRvbWF0aWNhbGx5IHJlY29yZGluZyBkdXJhdGlvbiBhbmQgZXJyb3JzLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNsYXNzIE9yZGVyU2VydmljZSB7XG4gKiAgIEBUcmFjZWQoKVxuICogICBhc3luYyBwcm9jZXNzT3JkZXIob3JkZXJJZDogc3RyaW5nKTogUHJvbWlzZTxPcmRlcj4ge1xuICogICAgIC8vIE1ldGhvZCBib2R5IGlzIGF1dG9tYXRpY2FsbHkgdHJhY2VkXG4gKiAgIH1cbiAqICAgXG4gKiAgIEBUcmFjZWQoeyBuYW1lOiAnY3VzdG9tLW9wZXJhdGlvbicsIGxldmVsOiAnZGVidWcnIH0pXG4gKiAgIGFzeW5jIGludGVybmFsUHJvY2VzcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAqICAgICAvLyBDdXN0b20gc3BhbiBuYW1lIGFuZCBsZXZlbFxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogUkVRVUlSRU1FTlRTOlxuICogLSBNdXN0IGJlIGNhbGxlZCB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAocnVuV2l0aENvbnRleHQpXG4gKiAtIE90aGVyd2lzZSBjcmVhdGVzIGEgTm9PcCBzcGFuIHRoYXQgZG9lc24ndCByZWNvcmQgYW55dGhpbmdcbiAqL1xuXG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIFNwYW5PcHRpb25zIH0gZnJvbSAnLi4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHsgY3JlYXRlQ29udHJvbGxlclNvdXJjZSwgY3JlYXRlU2VydmljZVNvdXJjZSwgY3JlYXRlUXVldWVTb3VyY2UsIGNyZWF0ZVRhc2tTb3VyY2UsIGRldGVjdFNvdXJjZSB9IGZyb20gJy4uL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyBzYWZlU2VyaWFsaXplIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5pbXBvcnQgeyBub3JtYWxpemVFcnJvciB9IGZyb20gJy4uL29ic2VydmVycy9iYXNlJztcblxuLyoqXG4gKiBBdXRvLWRldGVjdCBzb3VyY2UgdHlwZSBmcm9tIGNsYXNzIG5hbWVcbiAqL1xuZnVuY3Rpb24gYXV0b0RldGVjdFNvdXJjZVR5cGUoY2xhc3NOYW1lOiBzdHJpbmcpOiAnY29udHJvbGxlcicgfCAnc2VydmljZScgfCAncXVldWUnIHwgJ3Rhc2snIHwgJ2hhbmRsZXInIHtcbiAgY29uc3QgbG93ZXJOYW1lID0gY2xhc3NOYW1lLnRvTG93ZXJDYXNlKCk7XG4gIFxuICBpZiAobG93ZXJOYW1lLmluY2x1ZGVzKCdjb250cm9sbGVyJykpIHtcbiAgICByZXR1cm4gJ2NvbnRyb2xsZXInO1xuICB9XG4gIGlmIChsb3dlck5hbWUuaW5jbHVkZXMoJ3NlcnZpY2UnKSkge1xuICAgIHJldHVybiAnc2VydmljZSc7XG4gIH1cbiAgaWYgKGxvd2VyTmFtZS5pbmNsdWRlcygncXVldWUnKSB8fCBsb3dlck5hbWUuaW5jbHVkZXMoJ3F1ZXVlaGFuZGxlcicpKSB7XG4gICAgcmV0dXJuICdxdWV1ZSc7XG4gIH1cbiAgaWYgKGxvd2VyTmFtZS5pbmNsdWRlcygndGFzaycpIHx8IGxvd2VyTmFtZS5pbmNsdWRlcygndGFza2hhbmRsZXInKSkge1xuICAgIHJldHVybiAndGFzayc7XG4gIH1cbiAgXG4gIHJldHVybiAnaGFuZGxlcic7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhY2VkT3B0aW9ucyB7XG4gIC8qKiBDdXN0b20gc3BhbiBuYW1lIChkZWZhdWx0cyB0byBDbGFzc05hbWUubWV0aG9kTmFtZSkgKi9cbiAgbmFtZT86IHN0cmluZztcbiAgLyoqIFNwYW4gbGV2ZWwgKi9cbiAgbGV2ZWw/OiBTcGFuT3B0aW9uc1sgJ2xldmVsJyBdO1xuICAvKiogQWRkaXRpb25hbCBhdHRyaWJ1dGVzIHRvIGFkZCB0byBzcGFuICovXG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFRhZ3MgZm9yIGZpbHRlcmluZyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIFdoZXRoZXIgdG8gY2FwdHVyZSBtZXRob2QgYXJndW1lbnRzIGluIHNwYW4gYXR0cmlidXRlcyAqL1xuICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG4gIC8qKiBXaGV0aGVyIHRvIGNhcHR1cmUgcmV0dXJuIHZhbHVlIGluIHNwYW4gYXR0cmlidXRlcyAqL1xuICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcbiAgLyoqIFxuICAgKiBTb3VyY2UgdHlwZSBmb3IgdGhlIHNwYW4gKGF1dG8tZGV0ZWN0ZWQgaWYgbm90IHByb3ZpZGVkKVxuICAgKiBBdXRvLWRldGVjdGlvbiBydWxlczpcbiAgICogLSAqQ29udHJvbGxlciDihpIgJ2NvbnRyb2xsZXInXG4gICAqIC0gKlNlcnZpY2Ug4oaSICdzZXJ2aWNlJ1xuICAgKiAtICpRdWV1ZSwgKlF1ZXVlSGFuZGxlciDihpIgJ3F1ZXVlJ1xuICAgKiAtICpUYXNrLCAqVGFza0hhbmRsZXIg4oaSICd0YXNrJ1xuICAgKiAtIERlZmF1bHQg4oaSICdoYW5kbGVyJ1xuICAgKi9cbiAgc291cmNlVHlwZT86ICdjb250cm9sbGVyJyB8ICdzZXJ2aWNlJyB8ICdoYW5kbGVyJyB8ICdxdWV1ZScgfCAndGFzayc7XG59XG5cbi8qKlxuICogTWV0aG9kIGRlY29yYXRvciB0aGF0IHdyYXBzIGEgbWV0aG9kIGluIGEgdHJhY2Ugc3BhblxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRyYWNpbmcgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gVHJhY2VkKG9wdGlvbnM6IFRyYWNlZE9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPihcbiAgICB0YXJnZXQ6IG9iamVjdCxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4gICk6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+IHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG5cbiAgICBpZiAodHlwZW9mIG9yaWdpbmFsTWV0aG9kICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBzcGFuTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgLy8gQXV0by1kZXRlY3Qgc291cmNlIHR5cGUgaWYgbm90IGV4cGxpY2l0bHkgcHJvdmlkZWRcbiAgICBjb25zdCBzb3VyY2VUeXBlID0gb3B0aW9ucy5zb3VyY2VUeXBlID8/IGF1dG9EZXRlY3RTb3VyY2VUeXBlKGNsYXNzTmFtZSk7XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIHNvdXJjZSBiYXNlZCBvbiBzb3VyY2VUeXBlXG4gICAgbGV0IHNvdXJjZTogc3RyaW5nO1xuICAgIHN3aXRjaCAoc291cmNlVHlwZSkge1xuICAgICAgY2FzZSAnY29udHJvbGxlcic6XG4gICAgICAgIHNvdXJjZSA9IGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdzZXJ2aWNlJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlU2VydmljZVNvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3F1ZXVlJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlUXVldWVTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd0YXNrJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlVGFza1NvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHNvdXJjZSA9IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG4gICAgfVxuXG4gICAgLy8gV3JhcCBtZXRob2QgLSBoYW5kbGVzIGJvdGggc3luYyBhbmQgYXN5bmMgdmlhIHJlc3VsdCBjaGVja2luZ1xuICAgIC8vIFRoaXMgaXMgbW9yZSByb2J1c3QgdGhhbiBjaGVja2luZyBjb25zdHJ1Y3Rvci5uYW1lIHdoaWNoIGNhbiBicmVhayB3aXRoIHRyYW5zcGlsYXRpb25cbiAgICBjb25zdCB3cmFwcGVkTWV0aG9kID0gZnVuY3Rpb24gKHRoaXM6IHVua25vd24sIC4uLmFyZ3M6IHVua25vd25bXSk6IHVua25vd24ge1xuICAgICAgY29uc3Qgc3Bhbk9wdGlvbnM6IFNwYW5PcHRpb25zID0ge1xuICAgICAgICBsZXZlbDogb3B0aW9ucy5sZXZlbCxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdjb2RlLmZ1bmN0aW9uJzogbWV0aG9kTmFtZSxcbiAgICAgICAgICAnY29kZS5uYW1lc3BhY2UnOiBjbGFzc05hbWUsXG4gICAgICAgICAgLi4ub3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgIC4uLihvcHRpb25zLmNhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCAmJiB7IGFyZ3M6IHNhZmVTZXJpYWxpemUoYXJncykgfSksXG4gICAgICAgIH0sXG4gICAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgICAgc291cmNlLFxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChzcGFuTmFtZSwgc3Bhbk9wdGlvbnMpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgcmVzdWx0IGlzIGEgUHJvbWlzZS90aGVuYWJsZSAod29ya3Mgd2l0aCBhbnkgYXN5bmMgbWV0aG9kKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiAocmVzdWx0IGFzIHsgdGhlbj86IHVua25vd24gfSkudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEhhbmRsZSBhc3luYyBtZXRob2RcbiAgICAgICAgICByZXR1cm4gKHJlc3VsdCBhcyBQcm9taXNlPHVua25vd24+KVxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgdmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKCdyZXN1bHQnLCBzYWZlU2VyaWFsaXplKHZhbHVlKSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpIH0pO1xuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIHN5bmMgbWV0aG9kXG4gICAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgncmVzdWx0Jywgc2FmZVNlcmlhbGl6ZShyZXN1bHQpKTtcbiAgICAgICAgfVxuICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpIH0pO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9O1xuICAgIGRlc2NyaXB0b3IudmFsdWUgPSB3cmFwcGVkTWV0aG9kIGFzIFQ7XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn1cblxuIl19