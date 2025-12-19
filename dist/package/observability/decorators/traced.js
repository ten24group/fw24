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
const context_1 = require("../context");
const base_1 = require("../observers/base");
const span_1 = require("../observers/span");
const payload_1 = require("../utils/payload");
const decorator_utils_1 = require("./decorator-utils");
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
        // Resolve source using shared utility (auto-detects if sourceType not provided)
        const source = (0, decorator_utils_1.resolveSource)(options.sourceType, className, methodName);
        // Wrap method - handles both sync and async via result checking
        // This is more robust than checking constructor.name which can break with transpilation
        const wrappedMethod = function (...args) {
            // Check if tracing is enabled (static or dynamic)
            if (options.enabled !== undefined) {
                const isEnabled = typeof options.enabled === 'function'
                    ? options.enabled()
                    : options.enabled;
                if (!isEnabled) {
                    // Tracing disabled - execute method without span
                    return originalMethod.apply(this, args);
                }
            }
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
            // CRITICAL FIX: Snapshot the current parent BEFORE starting the span
            // This prevents sibling operations (e.g., multiple calls in a loop) from forming a chain
            const ctx = (0, context_1.getCurrentContext)();
            const previousParentId = ctx?.parentObservabilityLogId;
            const span = span_1.SpanObserver.start(spanName, spanOptions);
            // Update context so child operations can link to this span
            // This is critical for SpanObserver.addEventToCurrentSpan() and nested spans
            (0, context_1.setParentObservabilityLogId)(span.id);
            // Execute method with automatic sync/async handling
            return (0, decorator_utils_1.executeWithHandlers)(originalMethod, this, args, (success, result, error) => {
                if (success) {
                    if (options.captureResult && result !== undefined) {
                        span.setAttribute('result', (0, payload_1.safeSerialize)(result));
                    }
                    span.end({ success: true });
                }
                else {
                    span.end({ success: false, error: (0, base_1.normalizeError)(error) });
                }
                // CRITICAL FIX: Restore the previous parent ID after span ends
                // This ensures sibling operations see the correct parent, not the just-completed span
                if (previousParentId !== undefined) {
                    (0, context_1.setParentObservabilityLogId)(previousParentId);
                }
            });
        };
        descriptor.value = wrappedMethod;
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhY2VkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvZGVjb3JhdG9ycy90cmFjZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRzs7QUErQ0gsd0JBb0ZDO0FBaklELHdDQUE0RTtBQUM1RSw0Q0FBbUQ7QUFDbkQsNENBQThEO0FBQzlELDhDQUFpRDtBQUNqRCx1REFBbUY7QUFvQ25GOzs7O0dBSUc7QUFDSCxTQUFnQixNQUFNLENBQUMsVUFBeUIsRUFBRTtJQUNoRCxPQUFPLFVBQ0wsTUFBYyxFQUNkLFdBQTRCLEVBQzVCLFVBQXNDO1FBRXRDLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFFeEMsSUFBSSxPQUFPLGNBQWMsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUN6QyxPQUFPLFVBQVUsQ0FBQztRQUNwQixDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDMUMsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxJQUFJLElBQUksR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7UUFFOUQsZ0ZBQWdGO1FBQ2hGLE1BQU0sTUFBTSxHQUFHLElBQUEsK0JBQWEsRUFBQyxPQUFPLENBQUMsVUFBVSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUV4RSxnRUFBZ0U7UUFDaEUsd0ZBQXdGO1FBQ3hGLE1BQU0sYUFBYSxHQUFHLFVBQXlCLEdBQUcsSUFBZTtZQUMvRCxrREFBa0Q7WUFDbEQsSUFBSSxPQUFPLENBQUMsT0FBTyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUNsQyxNQUFNLFNBQVMsR0FBRyxPQUFPLE9BQU8sQ0FBQyxPQUFPLEtBQUssVUFBVTtvQkFDckQsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUU7b0JBQ25CLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO2dCQUVwQixJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7b0JBQ2YsaURBQWlEO29CQUNqRCxPQUFRLGNBQStDLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFDNUUsQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBZ0I7Z0JBQy9CLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSztnQkFDcEIsVUFBVSxFQUFFO29CQUNWLGVBQWUsRUFBRSxVQUFVO29CQUMzQixnQkFBZ0IsRUFBRSxTQUFTO29CQUMzQixHQUFHLE9BQU8sQ0FBQyxVQUFVO29CQUNyQixHQUFHLENBQUMsT0FBTyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFBLHVCQUFhLEVBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztpQkFDN0U7Z0JBQ0QsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJO2dCQUNsQixNQUFNO2FBQ1AsQ0FBQztZQUVGLHFFQUFxRTtZQUNyRSx5RkFBeUY7WUFDekYsTUFBTSxHQUFHLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO1lBQ2hDLE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxFQUFFLHdCQUF3QixDQUFDO1lBRXZELE1BQU0sSUFBSSxHQUFHLG1CQUFZLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztZQUV2RCwyREFBMkQ7WUFDM0QsNkVBQTZFO1lBQzdFLElBQUEscUNBQTJCLEVBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRXJDLG9EQUFvRDtZQUNwRCxPQUFPLElBQUEscUNBQW1CLEVBQ3hCLGNBQWlELEVBQ2pELElBQUksRUFDSixJQUFJLEVBQ0osQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxFQUFFO2dCQUN6QixJQUFJLE9BQU8sRUFBRSxDQUFDO29CQUNaLElBQUksT0FBTyxDQUFDLGFBQWEsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFLENBQUM7d0JBQ2xELElBQUksQ0FBQyxZQUFZLENBQUMsUUFBUSxFQUFFLElBQUEsdUJBQWEsRUFBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO29CQUNyRCxDQUFDO29CQUNELElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDOUIsQ0FBQztxQkFBTSxDQUFDO29CQUNOLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFBLHFCQUFjLEVBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUM3RCxDQUFDO2dCQUVELCtEQUErRDtnQkFDL0Qsc0ZBQXNGO2dCQUN0RixJQUFJLGdCQUFnQixLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUNuQyxJQUFBLHFDQUEyQixFQUFDLGdCQUFnQixDQUFDLENBQUM7Z0JBQ2hELENBQUM7WUFDSCxDQUFDLENBQ0YsQ0FBQztRQUNKLENBQUMsQ0FBQztRQUNGLFVBQVUsQ0FBQyxLQUFLLEdBQUcsYUFBa0IsQ0FBQztRQUV0QyxPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAVHJhY2VkIERlY29yYXRvciAtIEF1dG9tYXRpYyBzcGFuIHRyYWNpbmcgZm9yIG1ldGhvZHNcbiAqIFxuICogV3JhcHMgYSBtZXRob2QgaW4gYSBzcGFuLCBhdXRvbWF0aWNhbGx5IHJlY29yZGluZyBkdXJhdGlvbiBhbmQgZXJyb3JzLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNsYXNzIE9yZGVyU2VydmljZSB7XG4gKiAgIEBUcmFjZWQoKVxuICogICBhc3luYyBwcm9jZXNzT3JkZXIob3JkZXJJZDogc3RyaW5nKTogUHJvbWlzZTxPcmRlcj4ge1xuICogICAgIC8vIE1ldGhvZCBib2R5IGlzIGF1dG9tYXRpY2FsbHkgdHJhY2VkXG4gKiAgIH1cbiAqICAgXG4gKiAgIEBUcmFjZWQoeyBuYW1lOiAnY3VzdG9tLW9wZXJhdGlvbicsIGxldmVsOiAnZGVidWcnIH0pXG4gKiAgIGFzeW5jIGludGVybmFsUHJvY2VzcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAqICAgICAvLyBDdXN0b20gc3BhbiBuYW1lIGFuZCBsZXZlbFxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqIFxuICogUkVRVUlSRU1FTlRTOlxuICogLSBNdXN0IGJlIGNhbGxlZCB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAocnVuV2l0aENvbnRleHQpXG4gKiAtIE90aGVyd2lzZSBjcmVhdGVzIGEgTm9PcCBzcGFuIHRoYXQgZG9lc24ndCByZWNvcmQgYW55dGhpbmdcbiAqL1xuXG5pbXBvcnQgeyBzZXRQYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsIGdldEN1cnJlbnRDb250ZXh0IH0gZnJvbSAnLi4vY29udGV4dCc7XG5pbXBvcnQgeyBub3JtYWxpemVFcnJvciB9IGZyb20gJy4uL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgU3Bhbk9wdGlvbnMgfSBmcm9tICcuLi9vYnNlcnZlcnMvc3Bhbic7XG5pbXBvcnQgeyBzYWZlU2VyaWFsaXplIH0gZnJvbSAnLi4vdXRpbHMvcGF5bG9hZCc7XG5pbXBvcnQgeyBleGVjdXRlV2l0aEhhbmRsZXJzLCBTb3VyY2VUeXBlLCByZXNvbHZlU291cmNlIH0gZnJvbSAnLi9kZWNvcmF0b3ItdXRpbHMnO1xuXG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhY2VkT3B0aW9ucyB7XG4gIC8qKiBDdXN0b20gc3BhbiBuYW1lIChkZWZhdWx0cyB0byBDbGFzc05hbWUubWV0aG9kTmFtZSkgKi9cbiAgbmFtZT86IHN0cmluZztcbiAgLyoqIFNwYW4gbGV2ZWwgKi9cbiAgbGV2ZWw/OiBTcGFuT3B0aW9uc1sgJ2xldmVsJyBdO1xuICAvKiogQWRkaXRpb25hbCBhdHRyaWJ1dGVzIHRvIGFkZCB0byBzcGFuICovXG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgLyoqIFRhZ3MgZm9yIGZpbHRlcmluZyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIFdoZXRoZXIgdG8gY2FwdHVyZSBtZXRob2QgYXJndW1lbnRzIGluIHNwYW4gYXR0cmlidXRlcyAqL1xuICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG4gIC8qKiBXaGV0aGVyIHRvIGNhcHR1cmUgcmV0dXJuIHZhbHVlIGluIHNwYW4gYXR0cmlidXRlcyAqL1xuICBjYXB0dXJlUmVzdWx0PzogYm9vbGVhbjtcbiAgLyoqIFxuICAgKiBTb3VyY2UgdHlwZSBmb3IgdGhlIHNwYW4gKGF1dG8tZGV0ZWN0ZWQgaWYgbm90IHByb3ZpZGVkKVxuICAgKiBBdXRvLWRldGVjdGlvbiBydWxlczpcbiAgICogLSAqQ29udHJvbGxlciDihpIgJ2NvbnRyb2xsZXInXG4gICAqIC0gKlNlcnZpY2Ug4oaSICdzZXJ2aWNlJ1xuICAgKiAtICpRdWV1ZSwgKlF1ZXVlSGFuZGxlciDihpIgJ3F1ZXVlJ1xuICAgKiAtICpUYXNrLCAqVGFza0hhbmRsZXIg4oaSICd0YXNrJ1xuICAgKiAtIERlZmF1bHQg4oaSICdoYW5kbGVyJ1xuICAgKi9cbiAgc291cmNlVHlwZT86IFNvdXJjZVR5cGU7XG4gIC8qKlxuICAgKiBDb25kaXRpb25hbGx5IGVuYWJsZS9kaXNhYmxlIHRyYWNpbmcuXG4gICAqIC0gU3RhdGljIGJvb2xlYW46IGBlbmFibGVkOiBmYWxzZWAgdG8gZGlzYWJsZVxuICAgKiAtIER5bmFtaWMgZnVuY3Rpb246IGBlbmFibGVkOiAoKSA9PiBzb21lQ29uZGl0aW9uKClgXG4gICAqIEZ1bmN0aW9uIHJlY2VpdmVzIG5vIGFyZ3VtZW50cyBidXQgY2FuIGFjY2VzcyBnZXRDdXJyZW50Q29udGV4dCgpIGludGVybmFsbHkuXG4gICAqIERlZmF1bHQ6IHRydWUgKGVuYWJsZWQpXG4gICAqL1xuICBlbmFibGVkPzogYm9vbGVhbiB8ICgoKSA9PiBib29sZWFuKTtcbn1cblxuLyoqXG4gKiBNZXRob2QgZGVjb3JhdG9yIHRoYXQgd3JhcHMgYSBtZXRob2QgaW4gYSB0cmFjZSBzcGFuXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gVHJhY2luZyBvcHRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBUcmFjZWQob3B0aW9uczogVHJhY2VkT3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24+KFxuICAgIHRhcmdldDogb2JqZWN0LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD5cbiAgKTogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8VD4ge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcblxuICAgIGlmICh0eXBlb2Ygb3JpZ2luYWxNZXRob2QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICAgIH1cblxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHRhcmdldC5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IG1ldGhvZE5hbWUgPSBTdHJpbmcocHJvcGVydHlLZXkpO1xuICAgIGNvbnN0IHNwYW5OYW1lID0gb3B0aW9ucy5uYW1lID8/IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWA7XG5cbiAgICAvLyBSZXNvbHZlIHNvdXJjZSB1c2luZyBzaGFyZWQgdXRpbGl0eSAoYXV0by1kZXRlY3RzIGlmIHNvdXJjZVR5cGUgbm90IHByb3ZpZGVkKVxuICAgIGNvbnN0IHNvdXJjZSA9IHJlc29sdmVTb3VyY2Uob3B0aW9ucy5zb3VyY2VUeXBlLCBjbGFzc05hbWUsIG1ldGhvZE5hbWUpO1xuXG4gICAgLy8gV3JhcCBtZXRob2QgLSBoYW5kbGVzIGJvdGggc3luYyBhbmQgYXN5bmMgdmlhIHJlc3VsdCBjaGVja2luZ1xuICAgIC8vIFRoaXMgaXMgbW9yZSByb2J1c3QgdGhhbiBjaGVja2luZyBjb25zdHJ1Y3Rvci5uYW1lIHdoaWNoIGNhbiBicmVhayB3aXRoIHRyYW5zcGlsYXRpb25cbiAgICBjb25zdCB3cmFwcGVkTWV0aG9kID0gZnVuY3Rpb24gKHRoaXM6IHVua25vd24sIC4uLmFyZ3M6IHVua25vd25bXSk6IHVua25vd24ge1xuICAgICAgLy8gQ2hlY2sgaWYgdHJhY2luZyBpcyBlbmFibGVkIChzdGF0aWMgb3IgZHluYW1pYylcbiAgICAgIGlmIChvcHRpb25zLmVuYWJsZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb25zdCBpc0VuYWJsZWQgPSB0eXBlb2Ygb3B0aW9ucy5lbmFibGVkID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgPyBvcHRpb25zLmVuYWJsZWQoKVxuICAgICAgICAgIDogb3B0aW9ucy5lbmFibGVkO1xuXG4gICAgICAgIGlmICghaXNFbmFibGVkKSB7XG4gICAgICAgICAgLy8gVHJhY2luZyBkaXNhYmxlZCAtIGV4ZWN1dGUgbWV0aG9kIHdpdGhvdXQgc3BhblxuICAgICAgICAgIHJldHVybiAob3JpZ2luYWxNZXRob2QgYXMgKC4uLmE6IHVua25vd25bXSkgPT4gdW5rbm93bikuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3Qgc3Bhbk9wdGlvbnM6IFNwYW5PcHRpb25zID0ge1xuICAgICAgICBsZXZlbDogb3B0aW9ucy5sZXZlbCxcbiAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICdjb2RlLmZ1bmN0aW9uJzogbWV0aG9kTmFtZSxcbiAgICAgICAgICAnY29kZS5uYW1lc3BhY2UnOiBjbGFzc05hbWUsXG4gICAgICAgICAgLi4ub3B0aW9ucy5hdHRyaWJ1dGVzLFxuICAgICAgICAgIC4uLihvcHRpb25zLmNhcHR1cmVBcmdzICYmIGFyZ3MubGVuZ3RoID4gMCAmJiB7IGFyZ3M6IHNhZmVTZXJpYWxpemUoYXJncykgfSksXG4gICAgICAgIH0sXG4gICAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgICAgc291cmNlLFxuICAgICAgfTtcblxuICAgICAgLy8gQ1JJVElDQUwgRklYOiBTbmFwc2hvdCB0aGUgY3VycmVudCBwYXJlbnQgQkVGT1JFIHN0YXJ0aW5nIHRoZSBzcGFuXG4gICAgICAvLyBUaGlzIHByZXZlbnRzIHNpYmxpbmcgb3BlcmF0aW9ucyAoZS5nLiwgbXVsdGlwbGUgY2FsbHMgaW4gYSBsb29wKSBmcm9tIGZvcm1pbmcgYSBjaGFpblxuICAgICAgY29uc3QgY3R4ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICAgIGNvbnN0IHByZXZpb3VzUGFyZW50SWQgPSBjdHg/LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDtcblxuICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydChzcGFuTmFtZSwgc3Bhbk9wdGlvbnMpO1xuXG4gICAgICAvLyBVcGRhdGUgY29udGV4dCBzbyBjaGlsZCBvcGVyYXRpb25zIGNhbiBsaW5rIHRvIHRoaXMgc3BhblxuICAgICAgLy8gVGhpcyBpcyBjcml0aWNhbCBmb3IgU3Bhbk9ic2VydmVyLmFkZEV2ZW50VG9DdXJyZW50U3BhbigpIGFuZCBuZXN0ZWQgc3BhbnNcbiAgICAgIHNldFBhcmVudE9ic2VydmFiaWxpdHlMb2dJZChzcGFuLmlkKTtcblxuICAgICAgLy8gRXhlY3V0ZSBtZXRob2Qgd2l0aCBhdXRvbWF0aWMgc3luYy9hc3luYyBoYW5kbGluZ1xuICAgICAgcmV0dXJuIGV4ZWN1dGVXaXRoSGFuZGxlcnMoXG4gICAgICAgIG9yaWdpbmFsTWV0aG9kIGFzICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24sXG4gICAgICAgIHRoaXMsXG4gICAgICAgIGFyZ3MsXG4gICAgICAgIChzdWNjZXNzLCByZXN1bHQsIGVycm9yKSA9PiB7XG4gICAgICAgICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmNhcHR1cmVSZXN1bHQgJiYgcmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ3Jlc3VsdCcsIHNhZmVTZXJpYWxpemUocmVzdWx0KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBub3JtYWxpemVFcnJvcihlcnJvcikgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIC8vIENSSVRJQ0FMIEZJWDogUmVzdG9yZSB0aGUgcHJldmlvdXMgcGFyZW50IElEIGFmdGVyIHNwYW4gZW5kc1xuICAgICAgICAgIC8vIFRoaXMgZW5zdXJlcyBzaWJsaW5nIG9wZXJhdGlvbnMgc2VlIHRoZSBjb3JyZWN0IHBhcmVudCwgbm90IHRoZSBqdXN0LWNvbXBsZXRlZCBzcGFuXG4gICAgICAgICAgaWYgKHByZXZpb3VzUGFyZW50SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgc2V0UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKHByZXZpb3VzUGFyZW50SWQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgKTtcbiAgICB9O1xuICAgIGRlc2NyaXB0b3IudmFsdWUgPSB3cmFwcGVkTWV0aG9kIGFzIFQ7XG5cbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfTtcbn1cblxuIl19