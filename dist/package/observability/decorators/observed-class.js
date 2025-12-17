"use strict";
/**
 * @ObservedClass Decorator - Class-level observability configuration
 *
 * Automatically applies observability to all or selected methods in a class.
 * Useful for services, controllers, or any class where you want comprehensive tracking.
 *
 * Usage:
 * ```typescript
 * @ObservedClass({ traceAll: true, sourceType: 'service' })
 * class OrderService {
 *   // All methods automatically traced
 *   async createOrder(order: Order): Promise<Order> { ... }
 *   async updateOrder(id: string, data: Partial<Order>): Promise<Order> { ... }
 *   async deleteOrder(id: string): Promise<void> { ... }
 * }
 *
 * @ObservedClass({
 *   trace: true,
 *   audit: true,
 *   exclude: ['internalHelper', 'privateMethod']
 * })
 * class UserService {
 *   async createUser(data: UserData): Promise<User> { ... } // Traced + Audited
 *   async updateUser(id: string, data: Partial<UserData>): Promise<User> { ... } // Traced + Audited
 *   private internalHelper(): void { ... } // Excluded
 * }
 * ```
 *
 * REQUIREMENTS:
 * - Must be called within an observation context (runWithContext)
 * - Methods must be async or return synchronous values
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservedClass = ObservedClass;
const observed_1 = require("./observed");
/**
 * Class decorator that automatically applies observability to methods
 *
 * @param options - Class-level observability options
 */
function ObservedClass(options = {}) {
    return function (constructor) {
        const className = constructor.name;
        // Get all method names from prototype
        const prototype = constructor.prototype;
        const methodNames = Object.getOwnPropertyNames(prototype)
            .filter(name => {
            // Skip constructor
            if (name === 'constructor')
                return false;
            // Skip if not a function
            const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
            if (!descriptor || typeof descriptor.value !== 'function')
                return false;
            // Apply include/exclude filters
            if (options.include && options.include.length > 0) {
                return options.include.includes(name);
            }
            if (options.exclude && options.exclude.includes(name)) {
                return false;
            }
            return true;
        });
        // Apply @Observed decorator to each method
        methodNames.forEach(methodName => {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
            if (!descriptor)
                return;
            // Build method-specific options
            const methodOptions = {
                name: `${className}.${methodName}`,
                sourceType: options.sourceType,
                tags: options.tags,
                captureArgs: options.captureArgs,
                captureResult: options.captureResult,
                enabled: options.enabled, // Pass through enabled from class level
            };
            // Configure tracing
            if (options.traceAll || options.trace) {
                if (typeof options.trace === 'boolean') {
                    methodOptions.trace = true;
                }
                else if (options.trace && typeof options.trace === 'object') {
                    methodOptions.trace = {
                        level: options.trace.level || options.level,
                        attributes: {},
                    };
                    // Override captureArgs/captureResult if specified in trace options
                    if (options.trace.captureArgs !== undefined) {
                        methodOptions.captureArgs = options.trace.captureArgs;
                    }
                    if (options.trace.captureResult !== undefined) {
                        methodOptions.captureResult = options.trace.captureResult;
                    }
                }
                else {
                    methodOptions.trace = true;
                }
            }
            // Configure audit
            if (options.audit) {
                if (typeof options.audit === 'boolean') {
                    methodOptions.audit = true;
                }
                else {
                    methodOptions.audit = {
                        action: `${className}.${methodName}`,
                        level: options.audit.level,
                        captureArgs: options.audit.captureArgs ?? options.captureArgs,
                        captureResult: options.audit.captureResult ?? options.captureResult,
                    };
                }
            }
            // Configure metric
            if (options.metric) {
                if (typeof options.metric === 'boolean') {
                    methodOptions.metric = {
                        name: `${className}.${methodName}.count`,
                        type: 'counter',
                    };
                }
                else {
                    methodOptions.metric = {
                        name: `${className}.${methodName}.${options.metric.type === 'timing' ? 'duration' : 'count'}`,
                        type: options.metric.type ?? 'counter',
                        unit: options.metric.unit,
                    };
                }
            }
            // Apply the decorator
            const decoratedDescriptor = (0, observed_1.Observed)(methodOptions)(prototype, methodName, descriptor);
            // Update the descriptor
            if (decoratedDescriptor) {
                Object.defineProperty(prototype, methodName, decoratedDescriptor);
            }
        });
        return constructor;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2ZWQtY2xhc3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL29ic2VydmVkLWNsYXNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7QUFnRUgsc0NBNEdDO0FBMUtELHlDQUF1RDtBQXlEdkQ7Ozs7R0FJRztBQUNILFNBQWdCLGFBQWEsQ0FBQyxVQUFnQyxFQUFFO0lBQzlELE9BQU8sVUFBaUQsV0FBYztRQUNwRSxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBRW5DLHNDQUFzQztRQUN0QyxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDO1FBQ3hDLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLENBQUM7YUFDdEQsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFO1lBQ2IsbUJBQW1CO1lBQ25CLElBQUksSUFBSSxLQUFLLGFBQWE7Z0JBQUUsT0FBTyxLQUFLLENBQUM7WUFFekMseUJBQXlCO1lBQ3pCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDcEUsSUFBSSxDQUFDLFVBQVUsSUFBSSxPQUFPLFVBQVUsQ0FBQyxLQUFLLEtBQUssVUFBVTtnQkFBRSxPQUFPLEtBQUssQ0FBQztZQUV4RSxnQ0FBZ0M7WUFDaEMsSUFBSSxPQUFPLENBQUMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNsRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3hDLENBQUM7WUFFRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENB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VUFBVSxRQUFRO3dCQUN4QyxJQUFJLEVBQUUsU0FBUztxQkFDaEIsQ0FBQztnQkFDSixDQUFDO3FCQUFNLENBQUM7b0JBQ04sYUFBYSxDQUFDLE1BQU0sR0FBRzt3QkFDckIsSUFBSSxFQUFFLEdBQUcsU0FBUyxJQUFJLFVBQVUsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsT0FBTyxFQUFFO3dCQUM3RixJQUFJLEVBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLElBQUksU0FBUzt3QkFDdEMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSTtxQkFDMUIsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUVELHNCQUFzQjtZQUN0QixNQUFNLG1CQUFtQixHQUFHLElBQUEsbUJBQVEsRUFBQyxhQUFhLENBQUMsQ0FDakQsU0FBUyxFQUNULFVBQVUsRUFDVixVQUEwQyxDQUMzQyxDQUFDO1lBRUYsd0JBQXdCO1lBQ3hCLElBQUksbUJBQW1CLEVBQUUsQ0FBQztnQkFDeEIsTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsVUFBVSxFQUFFLG1CQUFtQixDQUFDLENBQUM7WUFDcEUsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxXQUFXLENBQUM7SUFDckIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQE9ic2VydmVkQ2xhc3MgRGVjb3JhdG9yIC0gQ2xhc3MtbGV2ZWwgb2JzZXJ2YWJpbGl0eSBjb25maWd1cmF0aW9uXG4gKiBcbiAqIEF1dG9tYXRpY2FsbHkgYXBwbGllcyBvYnNlcnZhYmlsaXR5IHRvIGFsbCBvciBzZWxlY3RlZCBtZXRob2RzIGluIGEgY2xhc3MuXG4gKiBVc2VmdWwgZm9yIHNlcnZpY2VzLCBjb250cm9sbGVycywgb3IgYW55IGNsYXNzIHdoZXJlIHlvdSB3YW50IGNvbXByZWhlbnNpdmUgdHJhY2tpbmcuXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogQE9ic2VydmVkQ2xhc3MoeyB0cmFjZUFsbDogdHJ1ZSwgc291cmNlVHlwZTogJ3NlcnZpY2UnIH0pXG4gKiBjbGFzcyBPcmRlclNlcnZpY2Uge1xuICogICAvLyBBbGwgbWV0aG9kcyBhdXRvbWF0aWNhbGx5IHRyYWNlZFxuICogICBhc3luYyBjcmVhdGVPcmRlcihvcmRlcjogT3JkZXIpOiBQcm9taXNlPE9yZGVyPiB7IC4uLiB9XG4gKiAgIGFzeW5jIHVwZGF0ZU9yZGVyKGlkOiBzdHJpbmcsIGRhdGE6IFBhcnRpYWw8T3JkZXI+KTogUHJvbWlzZTxPcmRlcj4geyAuLi4gfVxuICogICBhc3luYyBkZWxldGVPcmRlcihpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7IC4uLiB9XG4gKiB9XG4gKiBcbiAqIEBPYnNlcnZlZENsYXNzKHsgXG4gKiAgIHRyYWNlOiB0cnVlLFxuICogICBhdWRpdDogdHJ1ZSxcbiAqICAgZXhjbHVkZTogWydpbnRlcm5hbEhlbHBlcicsICdwcml2YXRlTWV0aG9kJ11cbiAqIH0pXG4gKiBjbGFzcyBVc2VyU2VydmljZSB7XG4gKiAgIGFzeW5jIGNyZWF0ZVVzZXIoZGF0YTogVXNlckRhdGEpOiBQcm9taXNlPFVzZXI+IHsgLi4uIH0gLy8gVHJhY2VkICsgQXVkaXRlZFxuICogICBhc3luYyB1cGRhdGVVc2VyKGlkOiBzdHJpbmcsIGRhdGE6IFBhcnRpYWw8VXNlckRhdGE+KTogUHJvbWlzZTxVc2VyPiB7IC4uLiB9IC8vIFRyYWNlZCArIEF1ZGl0ZWRcbiAqICAgcHJpdmF0ZSBpbnRlcm5hbEhlbHBlcigpOiB2b2lkIHsgLi4uIH0gLy8gRXhjbHVkZWRcbiAqIH1cbiAqIGBgYFxuICogXG4gKiBSRVFVSVJFTUVOVFM6XG4gKiAtIE11c3QgYmUgY2FsbGVkIHdpdGhpbiBhbiBvYnNlcnZhdGlvbiBjb250ZXh0IChydW5XaXRoQ29udGV4dClcbiAqIC0gTWV0aG9kcyBtdXN0IGJlIGFzeW5jIG9yIHJldHVybiBzeW5jaHJvbm91cyB2YWx1ZXNcbiAqL1xuXG5pbXBvcnQgeyBPYnNlcnZlZCwgT2JzZXJ2ZWRPcHRpb25zIH0gZnJvbSAnLi9vYnNlcnZlZCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzZXJ2ZWRDbGFzc09wdGlvbnMge1xuICAvKiogU291cmNlIHR5cGUgZm9yIGFsbCBtZXRob2RzIGluIHRoZSBjbGFzcyAqL1xuICBzb3VyY2VUeXBlPzogJ2NvbnRyb2xsZXInIHwgJ3NlcnZpY2UnIHwgJ2hhbmRsZXInIHwgJ3F1ZXVlJyB8ICd0YXNrJztcblxuICAvKiogRGVmYXVsdCBsZXZlbCBmb3IgYWxsIG9ic2VydmF0aW9ucyAqL1xuICBsZXZlbD86ICd0cmFjZScgfCAnZGVidWcnIHwgJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJztcblxuICAvKiogRW5hYmxlIHRyYWNpbmcgZm9yIGFsbCBtZXRob2RzICovXG4gIHRyYWNlQWxsPzogYm9vbGVhbjtcblxuICAvKiogRW5hYmxlIHRyYWNpbmcgd2l0aCBzcGVjaWZpYyBvcHRpb25zICovXG4gIHRyYWNlPzogYm9vbGVhbiB8IHtcbiAgICBsZXZlbD86ICd0cmFjZScgfCAnZGVidWcnIHwgJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJztcbiAgICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG4gICAgY2FwdHVyZVJlc3VsdD86IGJvb2xlYW47XG4gIH07XG5cbiAgLyoqIEVuYWJsZSBhdWRpdCBmb3IgYWxsIG1ldGhvZHMgKi9cbiAgYXVkaXQ/OiBib29sZWFuIHwge1xuICAgIGxldmVsPzogJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJztcbiAgICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG4gICAgY2FwdHVyZVJlc3VsdD86IGJvb2xlYW47XG4gIH07XG5cbiAgLyoqIEVuYWJsZSBtZXRyaWNzIGZvciBhbGwgbWV0aG9kcyAqL1xuICBtZXRyaWM/OiBib29sZWFuIHwge1xuICAgIHR5cGU/OiAnY291bnRlcicgfCAndGltaW5nJztcbiAgICB1bml0Pzogc3RyaW5nO1xuICB9O1xuXG4gIC8qKiBNZXRob2RzIHRvIGV4Y2x1ZGUgZnJvbSBvYnNlcnZhYmlsaXR5ICovXG4gIGV4Y2x1ZGU/OiBzdHJpbmdbXTtcblxuICAvKiogTWV0aG9kcyB0byBpbmNsdWRlIChpZiBwcm92aWRlZCwgb25seSB0aGVzZSB3aWxsIGJlIG9ic2VydmVkKSAqL1xuICBpbmNsdWRlPzogc3RyaW5nW107XG5cbiAgLyoqIFRhZ3MgYXBwbGllZCB0byBhbGwgb2JzZXJ2YXRpb25zIGluIHRoaXMgY2xhc3MgKi9cbiAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgLyoqIENhcHR1cmUgYXJndW1lbnRzIGZvciBhbGwgbWV0aG9kcyAqL1xuICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG5cbiAgLyoqIENhcHR1cmUgcmVzdWx0cyBmb3IgYWxsIG1ldGhvZHMgKi9cbiAgY2FwdHVyZVJlc3VsdD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIENvbmRpdGlvbmFsbHkgZW5hYmxlL2Rpc2FibGUgb2JzZXJ2YWJpbGl0eSBmb3IgYWxsIG1ldGhvZHMuXG4gICAqIC0gU3RhdGljIGJvb2xlYW46IGBlbmFibGVkOiBmYWxzZWAgdG8gZGlzYWJsZVxuICAgKiAtIER5bmFtaWMgZnVuY3Rpb246IGBlbmFibGVkOiAoKSA9PiBzb21lQ29uZGl0aW9uKClgXG4gICAqIEZ1bmN0aW9uIHJlY2VpdmVzIG5vIGFyZ3VtZW50cyBidXQgY2FuIGFjY2VzcyBnZXRDdXJyZW50Q29udGV4dCgpIGludGVybmFsbHkuXG4gICAqIERlZmF1bHQ6IHRydWUgKGVuYWJsZWQpXG4gICAqL1xuICBlbmFibGVkPzogYm9vbGVhbiB8ICgoKSA9PiBib29sZWFuKTtcbn1cblxuLyoqXG4gKiBDbGFzcyBkZWNvcmF0b3IgdGhhdCBhdXRvbWF0aWNhbGx5IGFwcGxpZXMgb2JzZXJ2YWJpbGl0eSB0byBtZXRob2RzXG4gKiBcbiAqIEBwYXJhbSBvcHRpb25zIC0gQ2xhc3MtbGV2ZWwgb2JzZXJ2YWJpbGl0eSBvcHRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBPYnNlcnZlZENsYXNzKG9wdGlvbnM6IE9ic2VydmVkQ2xhc3NPcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxUIGV4dGVuZHMgeyBuZXcoLi4uYXJnczogYW55W10pOiB7fSB9Pihjb25zdHJ1Y3RvcjogVCk6IFQge1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IGNvbnN0cnVjdG9yLm5hbWU7XG5cbiAgICAvLyBHZXQgYWxsIG1ldGhvZCBuYW1lcyBmcm9tIHByb3RvdHlwZVxuICAgIGNvbnN0IHByb3RvdHlwZSA9IGNvbnN0cnVjdG9yLnByb3RvdHlwZTtcbiAgICBjb25zdCBtZXRob2ROYW1lcyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSlcbiAgICAgIC5maWx0ZXIobmFtZSA9PiB7XG4gICAgICAgIC8vIFNraXAgY29uc3RydWN0b3JcbiAgICAgICAgaWYgKG5hbWUgPT09ICdjb25zdHJ1Y3RvcicpIHJldHVybiBmYWxzZTtcblxuICAgICAgICAvLyBTa2lwIGlmIG5vdCBhIGZ1bmN0aW9uXG4gICAgICAgIGNvbnN0IGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbmFtZSk7XG4gICAgICAgIGlmICghZGVzY3JpcHRvciB8fCB0eXBlb2YgZGVzY3JpcHRvci52YWx1ZSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIC8vIEFwcGx5IGluY2x1ZGUvZXhjbHVkZSBmaWx0ZXJzXG4gICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGUgJiYgb3B0aW9ucy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZXR1cm4gb3B0aW9ucy5pbmNsdWRlLmluY2x1ZGVzKG5hbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG9wdGlvbnMuZXhjbHVkZSAmJiBvcHRpb25zLmV4Y2x1ZGUuaW5jbHVkZXMobmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0pO1xuXG4gICAgLy8gQXBwbHkgQE9ic2VydmVkIGRlY29yYXRvciB0byBlYWNoIG1ldGhvZFxuICAgIG1ldGhvZE5hbWVzLmZvckVhY2gobWV0aG9kTmFtZSA9PiB7XG4gICAgICBjb25zdCBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90b3R5cGUsIG1ldGhvZE5hbWUpO1xuICAgICAgaWYgKCFkZXNjcmlwdG9yKSByZXR1cm47XG5cbiAgICAgIC8vIEJ1aWxkIG1ldGhvZC1zcGVjaWZpYyBvcHRpb25zXG4gICAgICBjb25zdCBtZXRob2RPcHRpb25zOiBPYnNlcnZlZE9wdGlvbnMgPSB7XG4gICAgICAgIG5hbWU6IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWAsXG4gICAgICAgIHNvdXJjZVR5cGU6IG9wdGlvbnMuc291cmNlVHlwZSxcbiAgICAgICAgdGFnczogb3B0aW9ucy50YWdzLFxuICAgICAgICBjYXB0dXJlQXJnczogb3B0aW9ucy5jYXB0dXJlQXJncyxcbiAgICAgICAgY2FwdHVyZVJlc3VsdDogb3B0aW9ucy5jYXB0dXJlUmVzdWx0LFxuICAgICAgICBlbmFibGVkOiBvcHRpb25zLmVuYWJsZWQsIC8vIFBhc3MgdGhyb3VnaCBlbmFibGVkIGZyb20gY2xhc3MgbGV2ZWxcbiAgICAgIH07XG5cbiAgICAgIC8vIENvbmZpZ3VyZSB0cmFjaW5nXG4gICAgICBpZiAob3B0aW9ucy50cmFjZUFsbCB8fCBvcHRpb25zLnRyYWNlKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgbWV0aG9kT3B0aW9ucy50cmFjZSA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAob3B0aW9ucy50cmFjZSAmJiB0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBtZXRob2RPcHRpb25zLnRyYWNlID0ge1xuICAgICAgICAgICAgbGV2ZWw6IG9wdGlvbnMudHJhY2UubGV2ZWwgfHwgb3B0aW9ucy5sZXZlbCxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgIH07XG4gICAgICAgICAgLy8gT3ZlcnJpZGUgY2FwdHVyZUFyZ3MvY2FwdHVyZVJlc3VsdCBpZiBzcGVjaWZpZWQgaW4gdHJhY2Ugb3B0aW9uc1xuICAgICAgICAgIGlmIChvcHRpb25zLnRyYWNlLmNhcHR1cmVBcmdzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMuY2FwdHVyZUFyZ3MgPSBvcHRpb25zLnRyYWNlLmNhcHR1cmVBcmdzO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAob3B0aW9ucy50cmFjZS5jYXB0dXJlUmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMuY2FwdHVyZVJlc3VsdCA9IG9wdGlvbnMudHJhY2UuY2FwdHVyZVJlc3VsdDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbWV0aG9kT3B0aW9ucy50cmFjZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ29uZmlndXJlIGF1ZGl0XG4gICAgICBpZiAob3B0aW9ucy5hdWRpdCkge1xuICAgICAgICBpZiAodHlwZW9mIG9wdGlvbnMuYXVkaXQgPT09ICdib29sZWFuJykge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMuYXVkaXQgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMuYXVkaXQgPSB7XG4gICAgICAgICAgICBhY3Rpb246IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWAsXG4gICAgICAgICAgICBsZXZlbDogb3B0aW9ucy5hdWRpdC5sZXZlbCxcbiAgICAgICAgICAgIGNhcHR1cmVBcmdzOiBvcHRpb25zLmF1ZGl0LmNhcHR1cmVBcmdzID8/IG9wdGlvbnMuY2FwdHVyZUFyZ3MsXG4gICAgICAgICAgICBjYXB0dXJlUmVzdWx0OiBvcHRpb25zLmF1ZGl0LmNhcHR1cmVSZXN1bHQgPz8gb3B0aW9ucy5jYXB0dXJlUmVzdWx0LFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ29uZmlndXJlIG1ldHJpY1xuICAgICAgaWYgKG9wdGlvbnMubWV0cmljKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5tZXRyaWMgPT09ICdib29sZWFuJykge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMubWV0cmljID0ge1xuICAgICAgICAgICAgbmFtZTogYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9LmNvdW50YCxcbiAgICAgICAgICAgIHR5cGU6ICdjb3VudGVyJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMubWV0cmljID0ge1xuICAgICAgICAgICAgbmFtZTogYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9LiR7b3B0aW9ucy5tZXRyaWMudHlwZSA9PT0gJ3RpbWluZycgPyAnZHVyYXRpb24nIDogJ2NvdW50J31gLFxuICAgICAgICAgICAgdHlwZTogb3B0aW9ucy5tZXRyaWMudHlwZSA/PyAnY291bnRlcicsXG4gICAgICAgICAgICB1bml0OiBvcHRpb25zLm1ldHJpYy51bml0LFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQXBwbHkgdGhlIGRlY29yYXRvclxuICAgICAgY29uc3QgZGVjb3JhdGVkRGVzY3JpcHRvciA9IE9ic2VydmVkKG1ldGhvZE9wdGlvbnMpKFxuICAgICAgICBwcm90b3R5cGUsXG4gICAgICAgIG1ldGhvZE5hbWUsXG4gICAgICAgIGRlc2NyaXB0b3IgYXMgVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8YW55PlxuICAgICAgKTtcblxuICAgICAgLy8gVXBkYXRlIHRoZSBkZXNjcmlwdG9yXG4gICAgICBpZiAoZGVjb3JhdGVkRGVzY3JpcHRvcikge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG90eXBlLCBtZXRob2ROYW1lLCBkZWNvcmF0ZWREZXNjcmlwdG9yKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjb25zdHJ1Y3RvcjtcbiAgfTtcbn1cblxuIl19