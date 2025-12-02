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
        // Determine source based on sourceType option
        let source;
        switch (options.sourceType) {
            case 'controller':
                source = (0, source_utils_1.createControllerSource)(className, methodName);
                break;
            case 'service':
                source = (0, source_utils_1.createServiceSource)(className, methodName);
                break;
            case 'queue':
                source = (0, source_utils_1.createQueueSource)(className, methodName); // className as queue name, methodName as handler
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy90cmFjZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRzs7QUE2Qkgsd0JBdUZDO0FBbEhELDRDQUE4RDtBQUM5RCx3REFBeUg7QUFDekgsOENBQWlEO0FBQ2pELDRDQUFtRDtBQW1CbkQ7Ozs7R0FJRztBQUNILFNBQWdCLE1BQU0sQ0FBQyxVQUF5QixFQUFFO0lBQ2hELE9BQU8sVUFDTCxNQUFjLEVBQ2QsV0FBNEIsRUFDNUIsVUFBc0M7UUFFdEMsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUV4QyxJQUFJLE9BQU8sY0FBYyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ3pDLE9BQU8sVUFBVSxDQUFDO1FBQ3BCLENBQUM7UUFFRCxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztRQUMxQyxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDdkMsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLElBQUksSUFBSSxHQUFHLFNBQVMsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUU5RCw4Q0FBOEM7UUFDOUMsSUFBSSxNQUFjLENBQUM7UUFDbkIsUUFBUSxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDM0IsS0FBSyxZQUFZO2dCQUNmLE1BQU0sR0FBRyxJQUFBLHFDQUFzQixFQUFDLFNBQVMsRUFBRSxVQUFVLENBQUMsQ0FBQztnQkFDdkQsTUFBTTtZQUNSLEtBQUssU0FBUztnQkFDWixNQUFNLEdBQUcsSUFBQSxrQ0FBbUIsRUFBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLENBQUM7Z0JBQ3BELE1BQU07WUFDUixLQUFLLE9BQU87Z0JBQ1YsTUFBTSxHQUFHLElBQUEsZ0NBQWlCLEVBQUMsU0FB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QUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBUcmFjZWQgRGVjb3JhdG9yIC0gQXV0b21hdGljIHNwYW4gdHJhY2luZyBmb3IgbWV0aG9kc1xuICogXG4gKiBXcmFwcyBhIG1ldGhvZCBpbiBhIHNwYW4sIGF1dG9tYXRpY2FsbHkgcmVjb3JkaW5nIGR1cmF0aW9uIGFuZCBlcnJvcnMuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgT3JkZXJTZXJ2aWNlIHtcbiAqICAgQFRyYWNlZCgpXG4gKiAgIGFzeW5jIHByb2Nlc3NPcmRlcihvcmRlcklkOiBzdHJpbmcpOiBQcm9taXNlPE9yZGVyPiB7XG4gKiAgICAgLy8gTWV0aG9kIGJvZHkgaXMgYXV0b21hdGljYWxseSB0cmFjZWRcbiAqICAgfVxuICogICBcbiAqICAgQFRyYWNlZCh7IG5hbWU6ICdjdXN0b20tb3BlcmF0aW9uJywgbGV2ZWw6ICdkZWJ1ZycgfSlcbiAqICAgYXN5bmMgaW50ZXJuYWxQcm9jZXNzKCk6IFByb21pc2U8dm9pZD4ge1xuICogICAgIC8vIEN1c3RvbSBzcGFuIG5hbWUgYW5kIGxldmVsXG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICogXG4gKiBSRVFVSVJFTUVOVFM6XG4gKiAtIE11c3QgYmUgY2FsbGVkIHdpdGhpbiBhbiBvYnNlcnZhdGlvbiBjb250ZXh0IChydW5XaXRoQ29udGV4dClcbiAqIC0gT3RoZXJ3aXNlIGNyZWF0ZXMgYSBOb09wIHNwYW4gdGhhdCBkb2Vzbid0IHJlY29yZCBhbnl0aGluZ1xuICovXG5cbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgU3Bhbk9wdGlvbnMgfSBmcm9tICcuLi9vYnNlcnZlcnMvc3Bhbic7XG5pbXBvcnQgeyBjcmVhdGVDb250cm9sbGVyU291cmNlLCBjcmVhdGVTZXJ2aWNlU291cmNlLCBjcmVhdGVRdWV1ZVNvdXJjZSwgY3JlYXRlVGFza1NvdXJjZSB9IGZyb20gJy4uL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyBzYWZlU2VyaWFsaXplIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5pbXBvcnQgeyBub3JtYWxpemVFcnJvciB9IGZyb20gJy4uL29ic2VydmVycy9iYXNlJztcblxuZXhwb3J0IGludGVyZmFjZSBUcmFjZWRPcHRpb25zIHtcbiAgLyoqIEN1c3RvbSBzcGFuIG5hbWUgKGRlZmF1bHRzIHRvIENsYXNzTmFtZS5tZXRob2ROYW1lKSAqL1xuICBuYW1lPzogc3RyaW5nO1xuICAvKiogU3BhbiBsZXZlbCAqL1xuICBsZXZlbD86IFNwYW5PcHRpb25zWyAnbGV2ZWwnIF07XG4gIC8qKiBBZGRpdGlvbmFsIGF0dHJpYnV0ZXMgdG8gYWRkIHRvIHNwYW4gKi9cbiAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogVGFncyBmb3IgZmlsdGVyaW5nICovXG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogV2hldGhlciB0byBjYXB0dXJlIG1ldGhvZCBhcmd1bWVudHMgaW4gc3BhbiBhdHRyaWJ1dGVzICovXG4gIGNhcHR1cmVBcmdzPzogYm9vbGVhbjtcbiAgLyoqIFdoZXRoZXIgdG8gY2FwdHVyZSByZXR1cm4gdmFsdWUgaW4gc3BhbiBhdHRyaWJ1dGVzICovXG4gIGNhcHR1cmVSZXN1bHQ/OiBib29sZWFuO1xuICAvKiogU291cmNlIHR5cGUgZm9yIHRoZSBzcGFuIChjb250cm9sbGVyLCBzZXJ2aWNlLCBxdWV1ZSwgdGFzaywgZXRjLikgKi9cbiAgc291cmNlVHlwZT86ICdjb250cm9sbGVyJyB8ICdzZXJ2aWNlJyB8ICdoYW5kbGVyJyB8ICdxdWV1ZScgfCAndGFzayc7XG59XG5cbi8qKlxuICogTWV0aG9kIGRlY29yYXRvciB0aGF0IHdyYXBzIGEgbWV0aG9kIGluIGEgdHJhY2Ugc3BhblxuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIFRyYWNpbmcgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gVHJhY2VkKG9wdGlvbnM6IFRyYWNlZE9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gZnVuY3Rpb24gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duPihcbiAgICB0YXJnZXQ6IG9iamVjdCxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nIHwgc3ltYm9sLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+XG4gICk6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPFQ+IHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG5cbiAgICBpZiAodHlwZW9mIG9yaWdpbmFsTWV0aG9kICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgICB9XG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBzcGFuTmFtZSA9IG9wdGlvbnMubmFtZSA/PyBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHNvdXJjZSBiYXNlZCBvbiBzb3VyY2VUeXBlIG9wdGlvblxuICAgIGxldCBzb3VyY2U6IHN0cmluZztcbiAgICBzd2l0Y2ggKG9wdGlvbnMuc291cmNlVHlwZSkge1xuICAgICAgY2FzZSAnY29udHJvbGxlcic6XG4gICAgICAgIHNvdXJjZSA9IGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdzZXJ2aWNlJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlU2VydmljZVNvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3F1ZXVlJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlUXVldWVTb3VyY2UoY2xhc3NOYW1lLCBtZXRob2ROYW1lKTsgIC8vIGNsYXNzTmFtZSBhcyBxdWV1ZSBuYW1lLCBtZXRob2ROYW1lIGFzIGhhbmRsZXJcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd0YXNrJzpcbiAgICAgICAgc291cmNlID0gY3JlYXRlVGFza1NvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHNvdXJjZSA9IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG4gICAgfVxuXG4gICAgLy8gV3JhcCBtZXRob2QgLSBoYW5kbGVzIGJvdGggc3luYyBhbmQgYXN5bmMgdmlhIHJlc3VsdCBjaGVja2luZ1xuICAgIC8vIFRoaXMgaXMgbW9yZSByb2J1c3QgdGhhbiBjaGVja2luZyBjb25zdHJ1Y3Rvci5uYW1lIHdoaWNoIGNhbiBicmVhayB3aXRoIHRyYW5zcGlsYXRpb25cbiAgICBjb25zdCB3cmFwcGVkTWV0aG9kID0gZnVuY3Rpb24gKHRoaXM6IHVua25vd24sIC4uLmFyZ3M6IHVua25vd25bXSk6IHVua25vd24ge1xuICAgICAgY29uc3Qgc3Bhbk9wdGlvbnM6IFNwYW5PcHRpb25zID0ge1xuICAgICAgICBsZXZlbDogb3B0aW9ucy5sZXZlbCxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdjb2RlLmZ1bmN0aW9uJzogbWV0aG9kTmFtZSxcbiAgICAgICAgICAnY29kZS5uYW1lc3BhY2UnOiBjbGFzc05hbWUsXG4gICAgICAgICAgLi4ub3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgIC4uLihvcHRpb25zLmNhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCAmJiB7IGFyZ3M6IHNhZmVTZXJpYWxpemUoYXJncykgfSksXG4gICAgICAgIH0sXG4gICAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgICAgc291cmNlLFxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChzcGFuTmFtZSwgc3Bhbk9wdGlvbnMpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgcmVzdWx0IGlzIGEgUHJvbWlzZS90aGVuYWJsZSAod29ya3Mgd2l0aCBhbnkgYXN5bmMgbWV0aG9kKVxuICAgICAgICBpZiAocmVzdWx0ICYmIHR5cGVvZiAocmVzdWx0IGFzIHsgdGhlbj86IHVua25vd24gfSkudGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIC8vIEhhbmRsZSBhc3luYyBtZXRob2RcbiAgICAgICAgICByZXR1cm4gKHJlc3VsdCBhcyBQcm9taXNlPHVua25vd24+KVxuICAgICAgICAgICAgLnRoZW4oKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgdmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKCdyZXN1bHQnLCBzYWZlU2VyaWFsaXplKHZhbHVlKSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpIH0pO1xuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIHN5bmMgbWV0aG9kXG4gICAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgncmVzdWx0Jywgc2FmZVNlcmlhbGl6ZShyZXN1bHQpKTtcbiAgICAgICAgfVxuICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogbm9ybWFsaXplRXJyb3IoZXJyb3IpIH0pO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cbiAgICB9O1xuICAgIGRlc2NyaXB0b3IudmFsdWUgPSB3cmFwcGVkTWV0aG9kIGFzIFQ7XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn1cblxuIl19