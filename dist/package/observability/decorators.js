"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Traced = Traced;
const span_1 = require("./span");
const source_utils_1 = require("./utils/source-utils");
/**
 * Decorator to automatically trace method execution
 *
 * @example
 * ```typescript
 * class MyService {
 *   async processOrder(orderId: string) {
 *     // method body
 *   }
 * }
 * ```
 */
function Traced(options) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        const className = target.constructor.name;
        const methodName = String(propertyKey);
        const operation = options?.operation || `${className}.${methodName}`;
        // Auto-detect source type from class name
        const isController = className.toLowerCase().includes('controller');
        const isService = className.toLowerCase().includes('service');
        const autoSource = isController
            ? (0, source_utils_1.createControllerSource)(className, methodName)
            : isService
                ? (0, source_utils_1.createServiceSource)(className, methodName)
                : `class:${className}.${methodName}`;
        const source = options?.source || autoSource;
        descriptor.value = async function (...args) {
            // Extract context if available from 'this'
            const ctx = this.context || this.executionContext || this.ctx;
            const traceId = ctx?.observability?.traceId || ctx?.traceId;
            const parentSpanId = ctx?.observability?.spanId;
            return await (0, span_1.withSpan)(operation, async (span) => {
                // Add actor if available
                if (ctx?.actor) {
                    span.setAttribute('actor.id', ctx.actor.actorId);
                    span.setAttribute('actor.type', ctx.actor.actorType);
                }
                // Add method arguments as attributes (sanitized)
                if (args.length > 0) {
                    span.setAttribute('method.args_count', args.length);
                }
                // Add custom tags
                if (options?.tags) {
                    Object.entries(options.tags).forEach(([key, value]) => {
                        span.setAttribute(`tag.${key}`, value);
                    });
                }
                return await originalMethod.apply(this, args);
            }, {
                level: options?.level || 'info',
                traceId,
                parentSpanId,
                source,
                tags: options?.tags,
            });
        };
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVjb3JhdG9ycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFzQkEsd0JBMkRDO0FBakZELGlDQUF3QztBQUN4Qyx1REFBbUY7QUFTbkY7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxTQUFnQixNQUFNLENBQUMsT0FBdUI7SUFDNUMsT0FBTyxVQUFVLE1BQVcsRUFBRSxXQUE0QixFQUFFLFVBQThCO1FBQ3hGLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDMUMsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3ZDLE1BQU0sU0FBUyxHQUFHLE9BQU8sRUFBRSxTQUFTLElBQUksR0FBRyxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7UUFFckUsMENBQTBDO1FBQzFDLE1BQU0sWUFBWSxHQUFHLFNBQVMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDcEUsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUM5RCxNQUFNLFVBQVUsR0FBRyxZQUFZO1lBQzdCLENBQUMsQ0FBQyxJQUFBLHFDQUFzQixFQUFDLFNBQVMsRUFBRSxVQUFVLENBQUM7WUFDL0MsQ0FBQyxDQUFDLFNBQVM7Z0JBQ1QsQ0FBQyxDQUFDLElBQUEsa0NBQW1CLEVBQUMsU0FBUyxFQUFFLFVBQVUsQ0FBQztnQkFDNUMsQ0FBQyxDQUFDLFNBQVMsU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBRXpDLE1BQU0sTUFBTSxHQUFHLE9BQU8sRUFBRSxNQUFNLElBQUksVUFBVSxDQUFDO1FBRTdDLFVBQVUsQ0FBQyxLQUFLLEdBQUcsS0FBSyxXQUFXLEdBQUcsSUFBVztZQUMvQywyQ0FBMkM7WUFDM0MsTUFBTSxHQUFHLEdBQUksSUFBWSxDQUFDLE9BQU8sSUFBSyxJQUFZLENBQUMsZ0JBQWdCLElBQUssSUFBWSxDQUFDLEdBQUcsQ0FBQztZQUN6RixNQUFNLE9BQU8sR0FBRyxHQUFHLEVBQUUsYUFBYSxFQUFFLE9BQU8sSUFBSSxHQUFHLEVBQUUsT0FBTyxDQUFDO1lBQzVELE1BQU0sWUFBWSxHQUFHLEdBQUcsRUFBRSxhQUFhLEVBQUUsTUFBTSxDQUFDO1lBRWhELE9BQU8sTUFBTSxJQUFBLGVBQVEsRUFDbkIsU0FBUyxFQUNULEtBQUssRUFBRSxJQUFVLEVBQUUsRUFBRTtnQkFDbkIseUJBQXlCO2dCQUN6QixJQUFJLEdBQUcsRUFBRSxLQUFLLEVBQUUsQ0FBQztvQkFDZixJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO29CQUNqRCxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksRUFBRSxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUN2RCxDQUFDO2dCQUVELGlEQUFpRDtnQkFDakQsSUFBSSxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUNwQixJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDdEQsQ0FBQztnQkFFRCxrQkFBa0I7Z0JBQ2xCLElBQUksT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO29CQUNsQixNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFO3dCQUNwRCxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sR0FBRyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7b0JBQ3pDLENBQUMsQ0FBQyxDQUFDO2dCQUNMLENBQUM7Z0JBRUQsT0FBTyxNQUFNLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ2hELENBQUMsRUFDRDtnQkFDRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssSUFBSSxNQUFNO2dCQUMvQixPQUFPO2dCQUNQLFlBQVk7Z0JBQ1osTUFBTTtnQkFDTixJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUk7YUFDcEIsQ0FDRixDQUFDO1FBQ0osQ0FBQyxDQUFDO1FBRUYsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNwYW4sIHdpdGhTcGFuIH0gZnJvbSAnLi9zcGFuJztcbmltcG9ydCB7IGNyZWF0ZUNvbnRyb2xsZXJTb3VyY2UsIGNyZWF0ZVNlcnZpY2VTb3VyY2UgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhY2VkT3B0aW9ucyB7XG4gIG9wZXJhdGlvbj86IHN0cmluZztcbiAgbGV2ZWw/OiAndHJhY2UnIHwgJ2RlYnVnJyB8ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcicgfCAnY3JpdGljYWwnO1xuICBzb3VyY2U/OiBzdHJpbmc7XG4gIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG4vKipcbiAqIERlY29yYXRvciB0byBhdXRvbWF0aWNhbGx5IHRyYWNlIG1ldGhvZCBleGVjdXRpb25cbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNsYXNzIE15U2VydmljZSB7XG4gKiAgIGFzeW5jIHByb2Nlc3NPcmRlcihvcmRlcklkOiBzdHJpbmcpIHtcbiAqICAgICAvLyBtZXRob2QgYm9keVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIFRyYWNlZChvcHRpb25zPzogVHJhY2VkT3B0aW9ucyk6IE1ldGhvZERlY29yYXRvciB7XG4gIHJldHVybiBmdW5jdGlvbiAodGFyZ2V0OiBhbnksIHByb3BlcnR5S2V5OiBzdHJpbmcgfCBzeW1ib2wsIGRlc2NyaXB0b3I6IFByb3BlcnR5RGVzY3JpcHRvcikge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSB0YXJnZXQuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBtZXRob2ROYW1lID0gU3RyaW5nKHByb3BlcnR5S2V5KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSBvcHRpb25zPy5vcGVyYXRpb24gfHwgYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9YDtcbiAgICBcbiAgICAvLyBBdXRvLWRldGVjdCBzb3VyY2UgdHlwZSBmcm9tIGNsYXNzIG5hbWVcbiAgICBjb25zdCBpc0NvbnRyb2xsZXIgPSBjbGFzc05hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnY29udHJvbGxlcicpO1xuICAgIGNvbnN0IGlzU2VydmljZSA9IGNsYXNzTmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdzZXJ2aWNlJyk7XG4gICAgY29uc3QgYXV0b1NvdXJjZSA9IGlzQ29udHJvbGxlciBcbiAgICAgID8gY3JlYXRlQ29udHJvbGxlclNvdXJjZShjbGFzc05hbWUsIG1ldGhvZE5hbWUpXG4gICAgICA6IGlzU2VydmljZSBcbiAgICAgICAgPyBjcmVhdGVTZXJ2aWNlU291cmNlKGNsYXNzTmFtZSwgbWV0aG9kTmFtZSlcbiAgICAgICAgOiBgY2xhc3M6JHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gO1xuICAgIFxuICAgIGNvbnN0IHNvdXJjZSA9IG9wdGlvbnM/LnNvdXJjZSB8fCBhdXRvU291cmNlO1xuXG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGFzeW5jIGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgLy8gRXh0cmFjdCBjb250ZXh0IGlmIGF2YWlsYWJsZSBmcm9tICd0aGlzJ1xuICAgICAgY29uc3QgY3R4ID0gKHRoaXMgYXMgYW55KS5jb250ZXh0IHx8ICh0aGlzIGFzIGFueSkuZXhlY3V0aW9uQ29udGV4dCB8fCAodGhpcyBhcyBhbnkpLmN0eDtcbiAgICAgIGNvbnN0IHRyYWNlSWQgPSBjdHg/Lm9ic2VydmFiaWxpdHk/LnRyYWNlSWQgfHwgY3R4Py50cmFjZUlkO1xuICAgICAgY29uc3QgcGFyZW50U3BhbklkID0gY3R4Py5vYnNlcnZhYmlsaXR5Py5zcGFuSWQ7XG5cbiAgICAgIHJldHVybiBhd2FpdCB3aXRoU3BhbihcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICBhc3luYyAoc3BhbjogU3BhbikgPT4ge1xuICAgICAgICAgIC8vIEFkZCBhY3RvciBpZiBhdmFpbGFibGVcbiAgICAgICAgICBpZiAoY3R4Py5hY3Rvcikge1xuICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ2FjdG9yLmlkJywgY3R4LmFjdG9yLmFjdG9ySWQpO1xuICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ2FjdG9yLnR5cGUnLCBjdHguYWN0b3IuYWN0b3JUeXBlKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBBZGQgbWV0aG9kIGFyZ3VtZW50cyBhcyBhdHRyaWJ1dGVzIChzYW5pdGl6ZWQpXG4gICAgICAgICAgaWYgKGFyZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoJ21ldGhvZC5hcmdzX2NvdW50JywgYXJncy5sZW5ndGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICAvLyBBZGQgY3VzdG9tIHRhZ3NcbiAgICAgICAgICBpZiAob3B0aW9ucz8udGFncykge1xuICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMob3B0aW9ucy50YWdzKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoYHRhZy4ke2tleX1gLCB2YWx1ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gYXdhaXQgb3JpZ2luYWxNZXRob2QuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBsZXZlbDogb3B0aW9ucz8ubGV2ZWwgfHwgJ2luZm8nLFxuICAgICAgICAgIHRyYWNlSWQsXG4gICAgICAgICAgcGFyZW50U3BhbklkLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH07XG59XG5cbiJdfQ==