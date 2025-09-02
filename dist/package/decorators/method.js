"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Options = exports.Patch = exports.Delete = exports.Put = exports.Post = exports.Get = void 0;
const decorator_utils_1 = require("./decorator-utils");
// function InjectParams(
//   target: any,
//   methodName: string,
//   descriptor: PropertyDescriptor
// ) {
//   const originalMethod = target[methodName];
//   descriptor.value = function (...args: any[]) {
//     const paramValues = new Array(originalMethod.length)
//       .fill(undefined)
//       .map(
//         (_, i) => Reflect.get(target, `param_${methodName}_${i}`) || args[i]
//       );
//     return originalMethod.apply(this, paramValues);
//   };
// }
/**
 * Creates a route decorator for HTTP methods.
 *
 * @param method - The HTTP method for the route decorator.
 * @returns A decorator function that can be used to decorate class methods as routes.
 */
function createRouteDecorator(method) {
    return (route, options) => (target, methodToDecorate) => {
        // Get the constructor using the utility function
        const constructor = (0, decorator_utils_1.findConstructor)(target, methodToDecorate);
        // If we still don't have a constructor, log an error and return
        if (!constructor) {
            console.error('Could not determine constructor for route decorator');
            return;
        }
        // Get the routes key using the utility function
        const routesKey = (0, decorator_utils_1.getRoutesKey)(constructor);
        // Get existing routes or initialize empty object
        let routes = Reflect.get(constructor, routesKey) || {};
        // If this is a derived class, we need to merge routes from the parent class
        let currentProto = constructor.prototype;
        while (currentProto && currentProto.__proto__ && currentProto.__proto__.constructor !== Object) {
            const parentConstructor = currentProto.__proto__.constructor;
            const parentRoutesKey = (0, decorator_utils_1.getRoutesKey)(parentConstructor);
            const parentRoutes = Reflect.get(parentConstructor, parentRoutesKey) || {};
            // Merge parent routes with current routes, giving priority to current routes
            routes = { ...parentRoutes, ...routes };
            // Move up the prototype chain
            currentProto = currentProto.__proto__;
        }
        if (!route) {
            route = '/';
        }
        if (route && !route.startsWith("/")) {
            route = `/${route}`;
        }
        const parameters = [];
        route.split('/').forEach((param) => {
            if (param.startsWith('{') && param.endsWith('}')) {
                parameters.push(param.slice(1, -1));
            }
        });
        routes[`${method}|${route}`] = {
            // Make sure path does-not end with a trailing-slash `/` 
            // [AWS signature needs the exact path (with or without slash)]
            // And API gateway strips teh training slash from the API-endpoint
            // * we need to make sure that API, Auth-policy, and Frontend-code all follow the same convention
            path: route.endsWith('/') ? route.slice(0, -1) : route,
            httpMethod: method,
            functionName: methodToDecorate.name || methodToDecorate,
            parameters: parameters,
            validations: options?.validations,
            target: options?.target,
            audit: options?.audit
        };
        // Store routes on the constructor using the unique symbol
        Reflect.set(constructor, routesKey, routes);
        // Also store a reference to the routes on the prototype for backward compatibility
        Reflect.set(target, "routes", routes);
        //InjectParams(target, methodToDecorate, descriptor);
    };
}
/**
 * Decorator function for defining a GET route.
 *
 * @param path - The path of the route.
 * @returns A decorator function that can be used to decorate a method.
 */
exports.Get = createRouteDecorator("GET");
/**
 * Decorator function for creating a POST route.
 * @param path - The path for the route.
 */
exports.Post = createRouteDecorator("POST");
/**
 * Decorator function for defining a PUT route.
 * @param target The target object.
 * @param propertyKey The name of the property being decorated.
 * @param descriptor The property descriptor.
 */
exports.Put = createRouteDecorator("PUT");
/**
 * Decorator function for defining a DELETE route.
 *
 * @param path - The path of the route.
 * @returns A decorator function that can be used to decorate a method as a DELETE route.
 */
exports.Delete = createRouteDecorator("DELETE");
/**
 * Decorator function for PATCH routes.
 * @param target The target object.
 * @param propertyKey The name of the property.
 * @param descriptor The property descriptor.
 */
exports.Patch = createRouteDecorator("PATCH");
/**
 * Represents a decorator that creates a route decorator with the specified HTTP method "OPTIONS".
 * @param target The target object.
 * @param propertyKey The property key.
 * @param descriptor The property descriptor.
 */
exports.Options = createRouteDecorator("OPTIONS");
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0aG9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RlY29yYXRvcnMvbWV0aG9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBLHVEQUFrRTtBQUVsRSx5QkFBeUI7QUFDekIsaUJBQWlCO0FBQ2pCLHdCQUF3QjtBQUN4QixtQ0FBbUM7QUFDbkMsTUFBTTtBQUNOLCtDQUErQztBQUMvQyxtREFBbUQ7QUFDbkQsMkRBQTJEO0FBQzNELHlCQUF5QjtBQUN6QixjQUFjO0FBQ2QsK0VBQStFO0FBQy9FLFdBQVc7QUFFWCxzREFBc0Q7QUFDdEQsT0FBTztBQUNQLElBQUk7QUFFSjs7Ozs7R0FLRztBQUNILFNBQVMsb0JBQW9CLENBQUMsTUFBYztJQUMxQyxPQUFPLENBQ0wsS0FBYSxFQUNiLE9BYUMsRUFDRCxFQUFFLENBQ0YsQ0FBQyxNQUFXLEVBQUUsZ0JBQXFCLEVBQUUsRUFBRTtRQUNyQyxpREFBaUQ7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBQSxpQ0FBZSxFQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBRTlELGdFQUFnRTtRQUNoRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsT0FBTyxDQUFDLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1lBQ3JFLE9BQU87UUFDVCxDQUFDO1FBRUQsZ0RBQWdEO1FBQ2hELE1BQU0sU0FBUyxHQUFHLElBQUEsOEJBQVksRUFBQyxXQUFXLENBQUMsQ0FBQztRQUU1QyxpREFBaUQ7UUFDakQsSUFBSSxNQUFNLEdBQTBCLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUU5RSw0RUFBNEU7UUFDNUUsSUFBSSxZQUFZLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQztRQUN6QyxPQUFPLFlBQVksSUFBSSxZQUFZLENBQUMsU0FBUyxJQUFJLFlBQVksQ0FBQyxTQUFTLENBQUMsV0FBVyxLQUFLLE1B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bXBvcnQgdHlwZSB7IFJvdXRlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvcm91dGVcIjtcbmltcG9ydCB0eXBlIHsgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgdHlwZSB7IEF1ZGl0Q29uZmlnIH0gZnJvbSBcIi4uL2F1ZGl0L2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IGZpbmRDb25zdHJ1Y3RvciwgZ2V0Um91dGVzS2V5IH0gZnJvbSBcIi4vZGVjb3JhdG9yLXV0aWxzXCI7XG5cbi8vIGZ1bmN0aW9uIEluamVjdFBhcmFtcyhcbi8vICAgdGFyZ2V0OiBhbnksXG4vLyAgIG1ldGhvZE5hbWU6IHN0cmluZyxcbi8vICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4vLyApIHtcbi8vICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSB0YXJnZXRbbWV0aG9kTmFtZV07XG4vLyAgIGRlc2NyaXB0b3IudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbi8vICAgICBjb25zdCBwYXJhbVZhbHVlcyA9IG5ldyBBcnJheShvcmlnaW5hbE1ldGhvZC5sZW5ndGgpXG4vLyAgICAgICAuZmlsbCh1bmRlZmluZWQpXG4vLyAgICAgICAubWFwKFxuLy8gICAgICAgICAoXywgaSkgPT4gUmVmbGVjdC5nZXQodGFyZ2V0LCBgcGFyYW1fJHttZXRob2ROYW1lfV8ke2l9YCkgfHwgYXJnc1tpXVxuLy8gICAgICAgKTtcblxuLy8gICAgIHJldHVybiBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBwYXJhbVZhbHVlcyk7XG4vLyAgIH07XG4vLyB9XG5cbi8qKlxuICogQ3JlYXRlcyBhIHJvdXRlIGRlY29yYXRvciBmb3IgSFRUUCBtZXRob2RzLlxuICogXG4gKiBAcGFyYW0gbWV0aG9kIC0gVGhlIEhUVFAgbWV0aG9kIGZvciB0aGUgcm91dGUgZGVjb3JhdG9yLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBjbGFzcyBtZXRob2RzIGFzIHJvdXRlcy5cbiAqL1xuZnVuY3Rpb24gY3JlYXRlUm91dGVEZWNvcmF0b3IobWV0aG9kOiBzdHJpbmcpIHtcbiAgcmV0dXJuIChcbiAgICByb3V0ZTogc3RyaW5nLFxuICAgIG9wdGlvbnM/OiB7XG4gICAgICB2YWxpZGF0aW9ucz86IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLFxuICAgICAgLyoqXG4gICAgICAgKiBTcGVjaWZpZXMgdGhlIHRhcmdldCBmb3IgdGhlIEFQSVxuICAgICAgICogVmFsdWVzIGNhbiBiZSBcInF1ZXVlXCIgb3IgXCJ0b3BpY1wiXG4gICAgICAgKiBAZGVmYXVsdCBcIlwiXG4gICAgICAgKi9cbiAgICAgIHRhcmdldD86IHN0cmluZztcbiAgICAgIC8qKlxuICAgICAgICogQXVkaXQgY29uZmlndXJhdGlvbiBmb3IgdGhpcyByb3V0ZVxuICAgICAgICogV2lsbCBvdmVycmlkZS9lbmhhbmNlIGNvbnRyb2xsZXItbGV2ZWwgYXVkaXQgY29uZmlnXG4gICAgICAgKi9cbiAgICAgIGF1ZGl0PzogQXVkaXRDb25maWc7XG4gICAgfVxuICApID0+XG4gICAgKHRhcmdldDogYW55LCBtZXRob2RUb0RlY29yYXRlOiBhbnkpID0+IHtcbiAgICAgIC8vIEdldCB0aGUgY29uc3RydWN0b3IgdXNpbmcgdGhlIHV0aWxpdHkgZnVuY3Rpb25cbiAgICAgIGNvbnN0IGNvbnN0cnVjdG9yID0gZmluZENvbnN0cnVjdG9yKHRhcmdldCwgbWV0aG9kVG9EZWNvcmF0ZSk7XG4gICAgICBcbiAgICAgIC8vIElmIHdlIHN0aWxsIGRvbid0IGhhdmUgYSBjb25zdHJ1Y3RvciwgbG9nIGFuIGVycm9yIGFuZCByZXR1cm5cbiAgICAgIGlmICghY29uc3RydWN0b3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignQ291bGQgbm90IGRldGVybWluZSBjb25zdHJ1Y3RvciBmb3Igcm91dGUgZGVjb3JhdG9yJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gR2V0IHRoZSByb3V0ZXMga2V5IHVzaW5nIHRoZSB1dGlsaXR5IGZ1bmN0aW9uXG4gICAgICBjb25zdCByb3V0ZXNLZXkgPSBnZXRSb3V0ZXNLZXkoY29uc3RydWN0b3IpO1xuICAgICAgXG4gICAgICAvLyBHZXQgZXhpc3Rpbmcgcm91dGVzIG9yIGluaXRpYWxpemUgZW1wdHkgb2JqZWN0XG4gICAgICBsZXQgcm91dGVzOiBSZWNvcmQ8c3RyaW5nLCBSb3V0ZT4gPSBSZWZsZWN0LmdldChjb25zdHJ1Y3Rvciwgcm91dGVzS2V5KSB8fCB7fTtcblxuICAgICAgLy8gSWYgdGhpcyBpcyBhIGRlcml2ZWQgY2xhc3MsIHdlIG5lZWQgdG8gbWVyZ2Ugcm91dGVzIGZyb20gdGhlIHBhcmVudCBjbGFzc1xuICAgICAgbGV0IGN1cnJlbnRQcm90byA9IGNvbnN0cnVjdG9yLnByb3RvdHlwZTtcbiAgICAgIHdoaWxlIChjdXJyZW50UHJvdG8gJiYgY3VycmVudFByb3RvLl9fcHJvdG9fXyAmJiBjdXJyZW50UHJvdG8uX19wcm90b19fLmNvbnN0cnVjdG9yICE9PSBPYmplY3QpIHtcbiAgICAgICAgY29uc3QgcGFyZW50Q29uc3RydWN0b3IgPSBjdXJyZW50UHJvdG8uX19wcm90b19fLmNvbnN0cnVjdG9yO1xuICAgICAgICBjb25zdCBwYXJlbnRSb3V0ZXNLZXkgPSBnZXRSb3V0ZXNLZXkocGFyZW50Q29uc3RydWN0b3IpO1xuICAgICAgICBjb25zdCBwYXJlbnRSb3V0ZXMgPSBSZWZsZWN0LmdldChwYXJlbnRDb25zdHJ1Y3RvciwgcGFyZW50Um91dGVzS2V5KSB8fCB7fTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1lcmdlIHBhcmVudCByb3V0ZXMgd2l0aCBjdXJyZW50IHJvdXRlcywgZ2l2aW5nIHByaW9yaXR5IHRvIGN1cnJlbnQgcm91dGVzXG4gICAgICAgIHJvdXRlcyA9IHsgLi4ucGFyZW50Um91dGVzLCAuLi5yb3V0ZXMgfTtcbiAgICAgICAgXG4gICAgICAgIC8vIE1vdmUgdXAgdGhlIHByb3RvdHlwZSBjaGFpblxuICAgICAgICBjdXJyZW50UHJvdG8gPSBjdXJyZW50UHJvdG8uX19wcm90b19fO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJvdXRlKSB7XG4gICAgICAgIHJvdXRlID0gJy8nO1xuICAgICAgfVxuXG4gICAgICBpZiAocm91dGUgJiYgIXJvdXRlLnN0YXJ0c1dpdGgoXCIvXCIpKSB7XG4gICAgICAgIHJvdXRlID0gYC8ke3JvdXRlfWA7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmFtZXRlcnM6IEFycmF5PFN0cmluZz4gPSBbXTtcblxuICAgICAgcm91dGUuc3BsaXQoJy8nKS5mb3JFYWNoKChwYXJhbSkgPT4ge1xuICAgICAgICBpZiAocGFyYW0uc3RhcnRzV2l0aCgneycpICYmIHBhcmFtLmVuZHNXaXRoKCd9JykpIHtcbiAgICAgICAgICBwYXJhbWV0ZXJzLnB1c2gocGFyYW0uc2xpY2UoMSwgLTEpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHJvdXRlc1tgJHttZXRob2R9fCR7cm91dGV9YF0gPSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSBwYXRoIGRvZXMtbm90IGVuZCB3aXRoIGEgdHJhaWxpbmctc2xhc2ggYC9gIFxuICAgICAgICAvLyBbQVdTIHNpZ25hdHVyZSBuZWVkcyB0aGUgZXhhY3QgcGF0aCAod2l0aCBvciB3aXRob3V0IHNsYXNoKV1cbiAgICAgICAgLy8gQW5kIEFQSSBnYXRld2F5IHN0cmlwcyB0ZWggdHJhaW5pbmcgc2xhc2ggZnJvbSB0aGUgQVBJLWVuZHBvaW50XG4gICAgICAgIC8vICogd2UgbmVlZCB0byBtYWtlIHN1cmUgdGhhdCBBUEksIEF1dGgtcG9saWN5LCBhbmQgRnJvbnRlbmQtY29kZSBhbGwgZm9sbG93IHRoZSBzYW1lIGNvbnZlbnRpb25cbiAgICAgICAgcGF0aDogcm91dGUuZW5kc1dpdGgoJy8nKSA/IHJvdXRlLnNsaWNlKDAsLTEpIDogcm91dGUsIFxuICAgICAgICBodHRwTWV0aG9kOiBtZXRob2QsXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogbWV0aG9kVG9EZWNvcmF0ZS5uYW1lIHx8IG1ldGhvZFRvRGVjb3JhdGUsXG4gICAgICAgIHBhcmFtZXRlcnM6IHBhcmFtZXRlcnMsXG4gICAgICAgIHZhbGlkYXRpb25zOiBvcHRpb25zPy52YWxpZGF0aW9ucyxcbiAgICAgICAgdGFyZ2V0OiBvcHRpb25zPy50YXJnZXQsXG4gICAgICAgIGF1ZGl0OiBvcHRpb25zPy5hdWRpdFxuICAgICAgfTtcblxuICAgICAgLy8gU3RvcmUgcm91dGVzIG9uIHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdW5pcXVlIHN5bWJvbFxuICAgICAgUmVmbGVjdC5zZXQoY29uc3RydWN0b3IsIHJvdXRlc0tleSwgcm91dGVzKTtcbiAgICAgIFxuICAgICAgLy8gQWxzbyBzdG9yZSBhIHJlZmVyZW5jZSB0byB0aGUgcm91dGVzIG9uIHRoZSBwcm90b3R5cGUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIFJlZmxlY3Quc2V0KHRhcmdldCwgXCJyb3V0ZXNcIiwgcm91dGVzKTtcbiAgICAgIC8vSW5qZWN0UGFyYW1zKHRhcmdldCwgbWV0aG9kVG9EZWNvcmF0ZSwgZGVzY3JpcHRvcik7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGRlZmluaW5nIGEgR0VUIHJvdXRlLlxuICogXG4gKiBAcGFyYW0gcGF0aCAtIFRoZSBwYXRoIG9mIHRoZSByb3V0ZS5cbiAqIEByZXR1cm5zIEEgZGVjb3JhdG9yIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIHVzZWQgdG8gZGVjb3JhdGUgYSBtZXRob2QuXG4gKi9cbmV4cG9ydCBjb25zdCBHZXQgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIkdFVFwiKTtcblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgUE9TVCByb3V0ZS5cbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggZm9yIHRoZSByb3V0ZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBvc3QgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBPU1RcIik7XG5cbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBkZWZpbmluZyBhIFBVVCByb3V0ZS5cbiAqIEBwYXJhbSB0YXJnZXQgVGhlIHRhcmdldCBvYmplY3QuXG4gKiBAcGFyYW0gcHJvcGVydHlLZXkgVGhlIG5hbWUgb2YgdGhlIHByb3BlcnR5IGJlaW5nIGRlY29yYXRlZC5cbiAqIEBwYXJhbSBkZXNjcmlwdG9yIFRoZSBwcm9wZXJ0eSBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgY29uc3QgUHV0ID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJQVVRcIik7XG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgZGVmaW5pbmcgYSBERUxFVEUgcm91dGUuXG4gKiBcbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggb2YgdGhlIHJvdXRlLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBhIG1ldGhvZCBhcyBhIERFTEVURSByb3V0ZS5cbiAqL1xuZXhwb3J0IGNvbnN0IERlbGV0ZSA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiREVMRVRFXCIpO1xuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgUEFUQ0ggcm91dGVzLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkuXG4gKiBAcGFyYW0gZGVzY3JpcHRvciBUaGUgcHJvcGVydHkgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGNvbnN0IFBhdGNoID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJQQVRDSFwiKTtcbi8qKlxuICogUmVwcmVzZW50cyBhIGRlY29yYXRvciB0aGF0IGNyZWF0ZXMgYSByb3V0ZSBkZWNvcmF0b3Igd2l0aCB0aGUgc3BlY2lmaWVkIEhUVFAgbWV0aG9kIFwiT1BUSU9OU1wiLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgcHJvcGVydHkga2V5LlxuICogQHBhcmFtIGRlc2NyaXB0b3IgVGhlIHByb3BlcnR5IGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBjb25zdCBPcHRpb25zID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJPUFRJT05TXCIpO1xuXG5leHBvcnQgdHlwZSBSb3V0ZU1ldGhvZHMgPSB0eXBlb2YgT3B0aW9ucyB8IHR5cGVvZiBQYXRjaCB8IHR5cGVvZiBEZWxldGUgfCB0eXBlb2YgUHV0IHwgdHlwZW9mIFBvc3QgfCB0eXBlb2YgR2V0OyJdfQ==