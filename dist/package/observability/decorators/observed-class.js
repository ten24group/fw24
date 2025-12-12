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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2ZWQtY2xhc3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9kZWNvcmF0b3JzL29ic2VydmVkLWNsYXNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQStCRzs7QUF1REgsc0NBMkdDO0FBaEtELHlDQUF1RDtBQWdEdkQ7Ozs7R0FJRztBQUNILFNBQWdCLGFBQWEsQ0FBQyxVQUFnQyxFQUFFO0lBQzlELE9BQU8sVUFBaUQsV0FBYztRQUNwRSxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsSUFBSSxDQUFDO1FBRW5DLHNDQUFzQztRQUN0QyxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDO1FBQ3hDLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLENBQUM7YUFDdEQsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFO1lBQ2IsbUJBQW1CO1lBQ25CLElBQUksSUFBSSxLQUFLLGFBQWE7Z0JBQUUsT0FBTyxLQUFLLENBQUM7WUFFekMseUJBQXlCO1lBQ3pCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDcEUsSUFBSSxDQUFDLFVBQVUsSUFBSSxPQUFPLFVBQVUsQ0FBQyxLQUFLLEtBQUssVUFBVTtnQkFBRSxPQUFPLEtBQUssQ0FBQztZQUV4RSxnQ0FBZ0M7WUFDaEMsSUFBSSxPQUFPLENBQUMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNsRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3hDLENBQUM7WUFFRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENB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Z0JBQ0osQ0FBQztxQkFBTSxDQUFDO29CQUNOLGFBQWEsQ0FBQyxNQUFNLEdBQUc7d0JBQ3JCLElBQUksRUFBRSxHQUFHLFNBQVMsSUFBSSxVQUFVLElBQUksT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE9BQU8sRUFBRTt3QkFDN0YsSUFBSSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLFNBQVM7d0JBQ3RDLElBQUksRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUk7cUJBQzFCLENBQUM7Z0JBQ0osQ0FBQztZQUNILENBQUM7WUFFRCxzQkFBc0I7WUFDdEIsTUFBTSxtQkFBbUIsR0FBRyxJQUFBLG1CQUFRLEVBQUMsYUFBYSxDQUFDLENBQ2pELFNBQVMsRUFDVCxVQUFVLEVBQ1YsVUFBMEMsQ0FDM0MsQ0FBQztZQUVGLHdCQUF3QjtZQUN4QixJQUFJLG1CQUFtQixFQUFFLENBQUM7Z0JBQ3hCLE1BQU0sQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1lBQ3BFLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sV0FBVyxDQUFDO0lBQ3JCLENBQUMsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBPYnNlcnZlZENsYXNzIERlY29yYXRvciAtIENsYXNzLWxldmVsIG9ic2VydmFiaWxpdHkgY29uZmlndXJhdGlvblxuICogXG4gKiBBdXRvbWF0aWNhbGx5IGFwcGxpZXMgb2JzZXJ2YWJpbGl0eSB0byBhbGwgb3Igc2VsZWN0ZWQgbWV0aG9kcyBpbiBhIGNsYXNzLlxuICogVXNlZnVsIGZvciBzZXJ2aWNlcywgY29udHJvbGxlcnMsIG9yIGFueSBjbGFzcyB3aGVyZSB5b3Ugd2FudCBjb21wcmVoZW5zaXZlIHRyYWNraW5nLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIEBPYnNlcnZlZENsYXNzKHsgdHJhY2VBbGw6IHRydWUsIHNvdXJjZVR5cGU6ICdzZXJ2aWNlJyB9KVxuICogY2xhc3MgT3JkZXJTZXJ2aWNlIHtcbiAqICAgLy8gQWxsIG1ldGhvZHMgYXV0b21hdGljYWxseSB0cmFjZWRcbiAqICAgYXN5bmMgY3JlYXRlT3JkZXIob3JkZXI6IE9yZGVyKTogUHJvbWlzZTxPcmRlcj4geyAuLi4gfVxuICogICBhc3luYyB1cGRhdGVPcmRlcihpZDogc3RyaW5nLCBkYXRhOiBQYXJ0aWFsPE9yZGVyPik6IFByb21pc2U8T3JkZXI+IHsgLi4uIH1cbiAqICAgYXN5bmMgZGVsZXRlT3JkZXIoaWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4geyAuLi4gfVxuICogfVxuICogXG4gKiBAT2JzZXJ2ZWRDbGFzcyh7IFxuICogICB0cmFjZTogdHJ1ZSxcbiAqICAgYXVkaXQ6IHRydWUsXG4gKiAgIGV4Y2x1ZGU6IFsnaW50ZXJuYWxIZWxwZXInLCAncHJpdmF0ZU1ldGhvZCddXG4gKiB9KVxuICogY2xhc3MgVXNlclNlcnZpY2Uge1xuICogICBhc3luYyBjcmVhdGVVc2VyKGRhdGE6IFVzZXJEYXRhKTogUHJvbWlzZTxVc2VyPiB7IC4uLiB9IC8vIFRyYWNlZCArIEF1ZGl0ZWRcbiAqICAgYXN5bmMgdXBkYXRlVXNlcihpZDogc3RyaW5nLCBkYXRhOiBQYXJ0aWFsPFVzZXJEYXRhPik6IFByb21pc2U8VXNlcj4geyAuLi4gfSAvLyBUcmFjZWQgKyBBdWRpdGVkXG4gKiAgIHByaXZhdGUgaW50ZXJuYWxIZWxwZXIoKTogdm9pZCB7IC4uLiB9IC8vIEV4Y2x1ZGVkXG4gKiB9XG4gKiBgYGBcbiAqIFxuICogUkVRVUlSRU1FTlRTOlxuICogLSBNdXN0IGJlIGNhbGxlZCB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAocnVuV2l0aENvbnRleHQpXG4gKiAtIE1ldGhvZHMgbXVzdCBiZSBhc3luYyBvciByZXR1cm4gc3luY2hyb25vdXMgdmFsdWVzXG4gKi9cblxuaW1wb3J0IHsgT2JzZXJ2ZWQsIE9ic2VydmVkT3B0aW9ucyB9IGZyb20gJy4vb2JzZXJ2ZWQnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmVkQ2xhc3NPcHRpb25zIHtcbiAgLyoqIFNvdXJjZSB0eXBlIGZvciBhbGwgbWV0aG9kcyBpbiB0aGUgY2xhc3MgKi9cbiAgc291cmNlVHlwZT86ICdjb250cm9sbGVyJyB8ICdzZXJ2aWNlJyB8ICdoYW5kbGVyJyB8ICdxdWV1ZScgfCAndGFzayc7XG4gIFxuICAvKiogRGVmYXVsdCBsZXZlbCBmb3IgYWxsIG9ic2VydmF0aW9ucyAqL1xuICBsZXZlbD86ICd0cmFjZScgfCAnZGVidWcnIHwgJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJztcbiAgXG4gIC8qKiBFbmFibGUgdHJhY2luZyBmb3IgYWxsIG1ldGhvZHMgKi9cbiAgdHJhY2VBbGw/OiBib29sZWFuO1xuICBcbiAgLyoqIEVuYWJsZSB0cmFjaW5nIHdpdGggc3BlY2lmaWMgb3B0aW9ucyAqL1xuICB0cmFjZT86IGJvb2xlYW4gfCB7XG4gICAgbGV2ZWw/OiAndHJhY2UnIHwgJ2RlYnVnJyB8ICdpbmZvJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gICAgY2FwdHVyZUFyZ3M/OiBib29sZWFuO1xuICAgIGNhcHR1cmVSZXN1bHQ/OiBib29sZWFuO1xuICB9O1xuICBcbiAgLyoqIEVuYWJsZSBhdWRpdCBmb3IgYWxsIG1ldGhvZHMgKi9cbiAgYXVkaXQ/OiBib29sZWFuIHwge1xuICAgIGxldmVsPzogJ2luZm8nIHwgJ3dhcm4nIHwgJ2Vycm9yJztcbiAgICBjYXB0dXJlQXJncz86IGJvb2xlYW47XG4gICAgY2FwdHVyZVJlc3VsdD86IGJvb2xlYW47XG4gIH07XG4gIFxuICAvKiogRW5hYmxlIG1ldHJpY3MgZm9yIGFsbCBtZXRob2RzICovXG4gIG1ldHJpYz86IGJvb2xlYW4gfCB7XG4gICAgdHlwZT86ICdjb3VudGVyJyB8ICd0aW1pbmcnO1xuICAgIHVuaXQ/OiBzdHJpbmc7XG4gIH07XG4gIFxuICAvKiogTWV0aG9kcyB0byBleGNsdWRlIGZyb20gb2JzZXJ2YWJpbGl0eSAqL1xuICBleGNsdWRlPzogc3RyaW5nW107XG4gIFxuICAvKiogTWV0aG9kcyB0byBpbmNsdWRlIChpZiBwcm92aWRlZCwgb25seSB0aGVzZSB3aWxsIGJlIG9ic2VydmVkKSAqL1xuICBpbmNsdWRlPzogc3RyaW5nW107XG4gIFxuICAvKiogVGFncyBhcHBsaWVkIHRvIGFsbCBvYnNlcnZhdGlvbnMgaW4gdGhpcyBjbGFzcyAqL1xuICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgXG4gIC8qKiBDYXB0dXJlIGFyZ3VtZW50cyBmb3IgYWxsIG1ldGhvZHMgKi9cbiAgY2FwdHVyZUFyZ3M/OiBib29sZWFuO1xuICBcbiAgLyoqIENhcHR1cmUgcmVzdWx0cyBmb3IgYWxsIG1ldGhvZHMgKi9cbiAgY2FwdHVyZVJlc3VsdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogQ2xhc3MgZGVjb3JhdG9yIHRoYXQgYXV0b21hdGljYWxseSBhcHBsaWVzIG9ic2VydmFiaWxpdHkgdG8gbWV0aG9kc1xuICogXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENsYXNzLWxldmVsIG9ic2VydmFiaWxpdHkgb3B0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gT2JzZXJ2ZWRDbGFzcyhvcHRpb25zOiBPYnNlcnZlZENsYXNzT3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBmdW5jdGlvbiA8VCBleHRlbmRzIHsgbmV3KC4uLmFyZ3M6IGFueVtdKToge30gfT4oY29uc3RydWN0b3I6IFQpOiBUIHtcbiAgICBjb25zdCBjbGFzc05hbWUgPSBjb25zdHJ1Y3Rvci5uYW1lO1xuICAgIFxuICAgIC8vIEdldCBhbGwgbWV0aG9kIG5hbWVzIGZyb20gcHJvdG90eXBlXG4gICAgY29uc3QgcHJvdG90eXBlID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICAgIGNvbnN0IG1ldGhvZE5hbWVzID0gT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMocHJvdG90eXBlKVxuICAgICAgLmZpbHRlcihuYW1lID0+IHtcbiAgICAgICAgLy8gU2tpcCBjb25zdHJ1Y3RvclxuICAgICAgICBpZiAobmFtZSA9PT0gJ2NvbnN0cnVjdG9yJykgcmV0dXJuIGZhbHNlO1xuICAgICAgICBcbiAgICAgICAgLy8gU2tpcCBpZiBub3QgYSBmdW5jdGlvblxuICAgICAgICBjb25zdCBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90b3R5cGUsIG5hbWUpO1xuICAgICAgICBpZiAoIWRlc2NyaXB0b3IgfHwgdHlwZW9mIGRlc2NyaXB0b3IudmFsdWUgIT09ICdmdW5jdGlvbicpIHJldHVybiBmYWxzZTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFwcGx5IGluY2x1ZGUvZXhjbHVkZSBmaWx0ZXJzXG4gICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGUgJiYgb3B0aW9ucy5pbmNsdWRlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZXR1cm4gb3B0aW9ucy5pbmNsdWRlLmluY2x1ZGVzKG5hbWUpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAob3B0aW9ucy5leGNsdWRlICYmIG9wdGlvbnMuZXhjbHVkZS5pbmNsdWRlcyhuYW1lKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9KTtcblxuICAgIC8vIEFwcGx5IEBPYnNlcnZlZCBkZWNvcmF0b3IgdG8gZWFjaCBtZXRob2RcbiAgICBtZXRob2ROYW1lcy5mb3JFYWNoKG1ldGhvZE5hbWUgPT4ge1xuICAgICAgY29uc3QgZGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG90eXBlLCBtZXRob2ROYW1lKTtcbiAgICAgIGlmICghZGVzY3JpcHRvcikgcmV0dXJuO1xuXG4gICAgICAvLyBCdWlsZCBtZXRob2Qtc3BlY2lmaWMgb3B0aW9uc1xuICAgICAgY29uc3QgbWV0aG9kT3B0aW9uczogT2JzZXJ2ZWRPcHRpb25zID0ge1xuICAgICAgICBuYW1lOiBgJHtjbGFzc05hbWV9LiR7bWV0aG9kTmFtZX1gLFxuICAgICAgICBzb3VyY2VUeXBlOiBvcHRpb25zLnNvdXJjZVR5cGUsXG4gICAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgICAgY2FwdHVyZUFyZ3M6IG9wdGlvbnMuY2FwdHVyZUFyZ3MsXG4gICAgICAgIGNhcHR1cmVSZXN1bHQ6IG9wdGlvbnMuY2FwdHVyZVJlc3VsdCxcbiAgICAgIH07XG5cbiAgICAgIC8vIENvbmZpZ3VyZSB0cmFjaW5nXG4gICAgICBpZiAob3B0aW9ucy50cmFjZUFsbCB8fCBvcHRpb25zLnRyYWNlKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgbWV0aG9kT3B0aW9ucy50cmFjZSA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAob3B0aW9ucy50cmFjZSAmJiB0eXBlb2Ygb3B0aW9ucy50cmFjZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBtZXRob2RPcHRpb25zLnRyYWNlID0ge1xuICAgICAgICAgICAgbGV2ZWw6IG9wdGlvbnMudHJhY2UubGV2ZWwgfHwgb3B0aW9ucy5sZXZlbCxcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgIH07XG4gICAgICAgICAgLy8gT3ZlcnJpZGUgY2FwdHVyZUFyZ3MvY2FwdHVyZVJlc3VsdCBpZiBzcGVjaWZpZWQgaW4gdHJhY2Ugb3B0aW9uc1xuICAgICAgICAgIGlmIChvcHRpb25zLnRyYWNlLmNhcHR1cmVBcmdzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMuY2FwdHVyZUFyZ3MgPSBvcHRpb25zLnRyYWNlLmNhcHR1cmVBcmdzO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAob3B0aW9ucy50cmFjZS5jYXB0dXJlUmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG1ldGhvZE9wdGlvbnMuY2FwdHVyZVJlc3VsdCA9IG9wdGlvbnMudHJhY2UuY2FwdHVyZVJlc3VsdDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbWV0aG9kT3B0aW9ucy50cmFjZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ29uZmlndXJlIGF1ZGl0XG4gICAgICBpZiAob3B0aW9ucy5hdWRpdCkge1xuICAgICAgICBpZiAodHlwZW9mIG9wdGlvbnMuYXVkaXQgPT09ICdib29sZWFuJykge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMuYXVkaXQgPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMuYXVkaXQgPSB7XG4gICAgICAgICAgICBhY3Rpb246IGAke2NsYXNzTmFtZX0uJHttZXRob2ROYW1lfWAsXG4gICAgICAgICAgICBsZXZlbDogb3B0aW9ucy5hdWRpdC5sZXZlbCxcbiAgICAgICAgICAgIGNhcHR1cmVBcmdzOiBvcHRpb25zLmF1ZGl0LmNhcHR1cmVBcmdzID8/IG9wdGlvbnMuY2FwdHVyZUFyZ3MsXG4gICAgICAgICAgICBjYXB0dXJlUmVzdWx0OiBvcHRpb25zLmF1ZGl0LmNhcHR1cmVSZXN1bHQgPz8gb3B0aW9ucy5jYXB0dXJlUmVzdWx0LFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ29uZmlndXJlIG1ldHJpY1xuICAgICAgaWYgKG9wdGlvbnMubWV0cmljKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb3B0aW9ucy5tZXRyaWMgPT09ICdib29sZWFuJykge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMubWV0cmljID0ge1xuICAgICAgICAgICAgbmFtZTogYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9LmNvdW50YCxcbiAgICAgICAgICAgIHR5cGU6ICdjb3VudGVyJyxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1ldGhvZE9wdGlvbnMubWV0cmljID0ge1xuICAgICAgICAgICAgbmFtZTogYCR7Y2xhc3NOYW1lfS4ke21ldGhvZE5hbWV9LiR7b3B0aW9ucy5tZXRyaWMudHlwZSA9PT0gJ3RpbWluZycgPyAnZHVyYXRpb24nIDogJ2NvdW50J31gLFxuICAgICAgICAgICAgdHlwZTogb3B0aW9ucy5tZXRyaWMudHlwZSA/PyAnY291bnRlcicsXG4gICAgICAgICAgICB1bml0OiBvcHRpb25zLm1ldHJpYy51bml0LFxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQXBwbHkgdGhlIGRlY29yYXRvclxuICAgICAgY29uc3QgZGVjb3JhdGVkRGVzY3JpcHRvciA9IE9ic2VydmVkKG1ldGhvZE9wdGlvbnMpKFxuICAgICAgICBwcm90b3R5cGUsXG4gICAgICAgIG1ldGhvZE5hbWUsXG4gICAgICAgIGRlc2NyaXB0b3IgYXMgVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8YW55PlxuICAgICAgKTtcblxuICAgICAgLy8gVXBkYXRlIHRoZSBkZXNjcmlwdG9yXG4gICAgICBpZiAoZGVjb3JhdGVkRGVzY3JpcHRvcikge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG90eXBlLCBtZXRob2ROYW1lLCBkZWNvcmF0ZWREZXNjcmlwdG9yKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBjb25zdHJ1Y3RvcjtcbiAgfTtcbn1cblxuIl19