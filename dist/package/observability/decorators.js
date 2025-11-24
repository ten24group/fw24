"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Traced = Traced;
const span_1 = require("./span");
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
        const operation = options?.operation || `${target.constructor.name}.${String(propertyKey)}`;
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
                return await originalMethod.apply(this, args);
            }, {
                level: options?.level || 'info',
                traceId,
                parentSpanId,
            });
        };
        return descriptor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVjb3JhdG9ycy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2RlY29yYXRvcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFtQkEsd0JBcUNDO0FBeERELGlDQUF3QztBQU94Qzs7Ozs7Ozs7Ozs7R0FXRztBQUNILFNBQWdCLE1BQU0sQ0FBQyxPQUF1QjtJQUM1QyxPQUFPLFVBQVUsTUFBVyxFQUFFLFdBQTRCLEVBQUUsVUFBOEI7UUFDeEYsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUN4QyxNQUFNLFNBQVMsR0FBRyxPQUFPLEVBQUUsU0FBUyxJQUFJLEdBQUcsTUFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7UUFFNUYsVUFBVSxDQUFDLEtBQUssR0FBRyxLQUFLLFdBQVcsR0FBRyxJQUFXO1lBQy9DLDJDQUEyQztZQUMzQyxNQUFNLEdBQUcsR0FBSSxJQUFZLENBQUMsT0FBTyxJQUFLLElBQVksQ0FBQyxnQkFBZ0IsSUFBSyxJQUFZLENBQUMsR0FBRyxDQUFDO1lBQ3pGLE1BQU0sT0FBTyxHQUFHLEdBQUcsRUFBRSxhQUFhLEVBQUUsT0FBTyxJQUFJLEdBQUcsRUFBRSxPQUFPLENBQUM7WUFDNUQsTUFBTSxZQUFZLEdBQUcsR0FBRyxFQUFFLGFBQWEsRUFBRSxNQUFNLENBQUM7WUFFaEQsT0FBTyxNQUFNLElBQUEsZUFBUSxFQUNuQixTQUFTLEVBQ1QsS0FBSyxFQUFFLElBQVUsRUFBRSxFQUFFO2dCQUNuQix5QkFBeUI7Z0JBQ3pCLElBQUksR0FBRyxFQUFFLEtBQUssRUFBRSxDQUFDO29CQUNmLElBQUksQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7b0JBQ2pELElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxFQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ3ZELENBQUM7Z0JBRUQsaURBQWlEO2dCQUNqRCxJQUFJLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxZQUFZLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUN0RCxDQUFDO2dCQUVELE9BQU8sTUFBTSxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNoRCxDQUFDLEVBQ0Q7Z0JBQ0UsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLElBQUksTUFBTTtnQkFDL0IsT0FBTztnQkFDUCxZQUFZO2FBQ2IsQ0FDRixDQUFDO1FBQ0osQ0FBQyxDQUFDO1FBRUYsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNwYW4sIHdpdGhTcGFuIH0gZnJvbSAnLi9zcGFuJztcblxuZXhwb3J0IGludGVyZmFjZSBUcmFjZWRPcHRpb25zIHtcbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICBsZXZlbD86ICd0cmFjZScgfCAnZGVidWcnIHwgJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJyB8ICdjcml0aWNhbCc7XG59XG5cbi8qKlxuICogRGVjb3JhdG9yIHRvIGF1dG9tYXRpY2FsbHkgdHJhY2UgbWV0aG9kIGV4ZWN1dGlvblxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY2xhc3MgTXlTZXJ2aWNlIHtcbiAqICAgYXN5bmMgcHJvY2Vzc09yZGVyKG9yZGVySWQ6IHN0cmluZykge1xuICogICAgIC8vIG1ldGhvZCBib2R5XG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gVHJhY2VkKG9wdGlvbnM/OiBUcmFjZWRPcHRpb25zKTogTWV0aG9kRGVjb3JhdG9yIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgcHJvcGVydHlLZXk6IHN0cmluZyB8IHN5bWJvbCwgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yKSB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IG9wdGlvbnM/Lm9wZXJhdGlvbiB8fCBgJHt0YXJnZXQuY29uc3RydWN0b3IubmFtZX0uJHtTdHJpbmcocHJvcGVydHlLZXkpfWA7XG5cbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gYXN5bmMgZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAvLyBFeHRyYWN0IGNvbnRleHQgaWYgYXZhaWxhYmxlIGZyb20gJ3RoaXMnXG4gICAgICBjb25zdCBjdHggPSAodGhpcyBhcyBhbnkpLmNvbnRleHQgfHwgKHRoaXMgYXMgYW55KS5leGVjdXRpb25Db250ZXh0IHx8ICh0aGlzIGFzIGFueSkuY3R4O1xuICAgICAgY29uc3QgdHJhY2VJZCA9IGN0eD8ub2JzZXJ2YWJpbGl0eT8udHJhY2VJZCB8fCBjdHg/LnRyYWNlSWQ7XG4gICAgICBjb25zdCBwYXJlbnRTcGFuSWQgPSBjdHg/Lm9ic2VydmFiaWxpdHk/LnNwYW5JZDtcblxuICAgICAgcmV0dXJuIGF3YWl0IHdpdGhTcGFuKFxuICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgIGFzeW5jIChzcGFuOiBTcGFuKSA9PiB7XG4gICAgICAgICAgLy8gQWRkIGFjdG9yIGlmIGF2YWlsYWJsZVxuICAgICAgICAgIGlmIChjdHg/LmFjdG9yKSB7XG4gICAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnYWN0b3IuaWQnLCBjdHguYWN0b3IuYWN0b3JJZCk7XG4gICAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnYWN0b3IudHlwZScsIGN0eC5hY3Rvci5hY3RvclR5cGUpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEFkZCBtZXRob2QgYXJndW1lbnRzIGFzIGF0dHJpYnV0ZXMgKHNhbml0aXplZClcbiAgICAgICAgICBpZiAoYXJncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZSgnbWV0aG9kLmFyZ3NfY291bnQnLCBhcmdzLmxlbmd0aCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbGV2ZWw6IG9wdGlvbnM/LmxldmVsIHx8ICdpbmZvJyxcbiAgICAgICAgICB0cmFjZUlkLFxuICAgICAgICAgIHBhcmVudFNwYW5JZCxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfTtcblxuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG4iXX0=