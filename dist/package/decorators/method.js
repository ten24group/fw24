"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Options = exports.Patch = exports.Delete = exports.Put = exports.Post = exports.Get = void 0;
require("reflect-metadata");
const decorator_utils_1 = require("./decorator-utils");
const metadata_keys_1 = require("../manifest/metadata-keys");
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
        const normalizedPath = route.endsWith('/') ? route.slice(0, -1) : route;
        routes[`${method}|${route}`] = {
            // Make sure path does-not end with a trailing-slash `/` 
            // [AWS signature needs the exact path (with or without slash)]
            // And API gateway strips teh training slash from the API-endpoint
            // * we need to make sure that API, Auth-policy, and Frontend-code all follow the same convention
            path: normalizedPath,
            httpMethod: method,
            functionName: methodToDecorate.name || methodToDecorate,
            parameters: parameters,
            validations: options?.validations,
            target: options?.target
        };
        // Store route metadata using reflect-metadata for production extraction
        const routeMetadata = {
            method: method.toUpperCase(),
            path: normalizedPath,
            options: {
                authorizer: options?.authorizer || 'AWS_IAM',
                target: options?.target || 'function',
                validations: options?.validations
            },
            functionName: methodToDecorate.name || methodToDecorate,
            parameters: parameters.map(p => String(p))
        };
        // Store metadata on the method itself
        Reflect.defineMetadata(metadata_keys_1.METADATA_KEYS.ROUTE, routeMetadata, target, methodToDecorate.name);
        // Store routes on the constructor using the unique symbol (backward compatibility)
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0aG9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RlY29yYXRvcnMvbWV0aG9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDRCQUEwQjtBQUcxQix1REFBa0U7QUFDbEUsNkRBQThFO0FBRzlFLHlCQUF5QjtBQUN6QixpQkFBaUI7QUFDakIsd0JBQXdCO0FBQ3hCLG1DQUFtQztBQUNuQyxNQUFNO0FBQ04sK0NBQStDO0FBQy9DLG1EQUFtRDtBQUNuRCwyREFBMkQ7QUFDM0QseUJBQXlCO0FBQ3pCLGNBQWM7QUFDZCwrRUFBK0U7QUFDL0UsV0FBVztBQUVYLHNEQUFzRDtBQUN0RCxPQUFPO0FBQ1AsSUFBSTtBQUVKOzs7OztHQUtHO0FBQ0gsU0FBUyxvQkFBb0IsQ0FBQyxNQUFjO0lBQzFDLE9BQU8sQ0FDTCxLQUFhLEVBQ2IsT0FZQyxFQUNELEVBQUUsQ0FDRixDQUFDLE1BQVcsRUFBRSxnQkFBcUIsRUFBRSxFQUFFO1FBQ3JDLGlEQUFpRDtRQUNqRCxNQUFNLFdBQVcsR0FBRyxJQUFBLGlDQUFlLEVBQUMsTUFBTSxFQUFFLGdCQUFnQixDQUFDLENBQUM7UUFFOUQsZ0VBQWdFO1FBQ2hFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqQixPQUFPLENBQUMsS0FBSyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7WUFDckUsT0FBTztRQUNULENBQUM7UUFFRCxnREFBZ0Q7UUFDaEQsTUFBTSxTQUFTLEdBQUcsSUFBQSw4QkFBWSxFQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRTVDLGlEQUFpRDtRQUNqRCxJQUFJLE1BQU0sR0FBMEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFDO1FBRTlFLDRFQUE0RTtRQUM1RSxJQUFJLFlBQVksR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDO1FBQ3pDLE9BQU8sWUFBWSxJQUFJLFlBQVksQ0FBQyxTQUFTLElBQUksWUFBWSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEtBQUssTUFBTSxFQUFFLENBQUM7WUFDL0YsTUFBTSxpQkFBaUIsR0FBRyxZQUFZLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQztZQUM3RCxNQUFNLGVBQWUsR0FBRyxJQUFBLDhCQUFZLEVBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUN4RCxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFLGVBQWUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUUzRSw2RUFBNkU7WUFDN0UsTUFBTSxHQUFHLEVBQUUsR0FBRyxZQUFZLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQztZQUV4Qyw4QkFBOEI7WUFDOUIsWUFBWSxHQUFHLFlBQVksQ0FBQyxTQUFTLENBQUM7UUFDeEMsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNYLEtBQUssR0FBRyxHQUFHLENBQUM7UUFDZCxDQUFDO1FBRUQsSUFBSSxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDcEMsS0FBSyxHQUFHLElBQUksS0FBSyxFQUFFLENBQUM7UUFDdEIsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFrQixFQUFFLENBQUM7UUFFckMsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUNqQyxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNqRCxVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN0QyxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7UUFFSCxNQUFNLGNBQWMsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFFdkUsTUFBTSxDQUFDLEdBQUcsTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDLEdBQUc7WUFDN0IseURBQXlEO1lBQ3pELCtEQUErRDtZQUMvRCxrRUFBa0U7WUFDbEUsaUdBQWlHO1lBQ2pHLElBQUksRUFBRSxjQUFjO1lBQ3BCLFVBQVUsRUFBRSxNQUFNO1lBQ2xCLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLElBQUksZ0JBQWdCO1lBQ3ZELFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFdBQVcsRUFBRSxPQUFPLEVBQUUsV0FBVztZQUNqQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU07U0FDeEIsQ0FBQztRQUVGLHdFQUF3RTtRQUN4RSxNQUFNLGFBQWEsR0FBa0I7WUFDbkMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxXQUFXLEVBQUU7WUFDNUIsSUFBSSxFQUFFLGNBQWM7WUFDcEIsT0FBTyxFQUFFO2dCQUNQLFVBQVUsRUFBRSxPQUFPLEVBQUUsVUFBVSxJQUFJLFNBQVM7Z0JBQzVDLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxJQUFJLFVBQVU7Z0JBQ3JDLFdBQVcsRUFBRSxPQUFPLEVBQUUsV0FBVzthQUNsQztZQUNELFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLElBQUksZ0JBQWdCO1lBQ3ZELFVBQVUsRUFBRSxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQzNDLENBQUM7UUFFRixzQ0FBc0M7UUFDdEMsT0FBTyxDQUFDLGNBQWMsQ0FBQyw2QkFBYSxDQUFDLEtBQUssRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDO1FBRTFGLG1GQUFtRjtRQUNuRixPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFNUMsbUZBQW1GO1FBQ25GLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN0QyxxREFBcUQ7SUFDdkQsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOzs7OztHQUtHO0FBQ1UsUUFBQSxHQUFHLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFL0M7OztHQUdHO0FBQ1UsUUFBQSxJQUFJLEdBQUcsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7QUFFakQ7Ozs7O0dBS0c7QUFDVSxRQUFBLEdBQUcsR0FBRyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUMvQzs7Ozs7R0FLRztBQUNVLFFBQUEsTUFBTSxHQUFHLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBRXJEOzs7OztHQUtHO0FBQ1UsUUFBQSxLQUFLLEdBQUcsb0JBQW9CLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbkQ7Ozs7O0dBS0c7QUFDVSxRQUFBLE9BQU8sR0FBRyxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAncmVmbGVjdC1tZXRhZGF0YSc7XG5pbXBvcnQgdHlwZSB7IFJvdXRlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvcm91dGVcIjtcbmltcG9ydCB0eXBlIHsgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucywgSW5wdXRWYWxpZGF0aW9uUnVsZSB9IGZyb20gXCIuLi92YWxpZGF0aW9uXCI7XG5pbXBvcnQgeyBmaW5kQ29uc3RydWN0b3IsIGdldFJvdXRlc0tleSB9IGZyb20gXCIuL2RlY29yYXRvci11dGlsc1wiO1xuaW1wb3J0IHsgTUVUQURBVEFfS0VZUywgdHlwZSBSb3V0ZU1ldGFkYXRhIH0gZnJvbSAnLi4vbWFuaWZlc3QvbWV0YWRhdGEta2V5cyc7XG5pbXBvcnQgdHlwZSB7IEF1dGhvcml6ZXJUeXBlTWV0YWRhdGEgfSBmcm9tICcuL2F1dGhvcml6ZXInO1xuXG4vLyBmdW5jdGlvbiBJbmplY3RQYXJhbXMoXG4vLyAgIHRhcmdldDogYW55LFxuLy8gICBtZXRob2ROYW1lOiBzdHJpbmcsXG4vLyAgIGRlc2NyaXB0b3I6IFByb3BlcnR5RGVzY3JpcHRvclxuLy8gKSB7XG4vLyAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gdGFyZ2V0W21ldGhvZE5hbWVdO1xuLy8gICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4vLyAgICAgY29uc3QgcGFyYW1WYWx1ZXMgPSBuZXcgQXJyYXkob3JpZ2luYWxNZXRob2QubGVuZ3RoKVxuLy8gICAgICAgLmZpbGwodW5kZWZpbmVkKVxuLy8gICAgICAgLm1hcChcbi8vICAgICAgICAgKF8sIGkpID0+IFJlZmxlY3QuZ2V0KHRhcmdldCwgYHBhcmFtXyR7bWV0aG9kTmFtZX1fJHtpfWApIHx8IGFyZ3NbaV1cbi8vICAgICAgICk7XG5cbi8vICAgICByZXR1cm4gb3JpZ2luYWxNZXRob2QuYXBwbHkodGhpcywgcGFyYW1WYWx1ZXMpO1xuLy8gICB9O1xuLy8gfVxuXG4vKipcbiAqIENyZWF0ZXMgYSByb3V0ZSBkZWNvcmF0b3IgZm9yIEhUVFAgbWV0aG9kcy5cbiAqIFxuICogQHBhcmFtIG1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIHJvdXRlIGRlY29yYXRvci5cbiAqIEByZXR1cm5zIEEgZGVjb3JhdG9yIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIHVzZWQgdG8gZGVjb3JhdGUgY2xhc3MgbWV0aG9kcyBhcyByb3V0ZXMuXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVJvdXRlRGVjb3JhdG9yKG1ldGhvZDogc3RyaW5nKSB7XG4gIHJldHVybiAoXG4gICAgcm91dGU6IHN0cmluZyxcbiAgICBvcHRpb25zPzoge1xuICAgICAgdmFsaWRhdGlvbnM/OiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyxcbiAgICAgIC8qKlxuICAgICAgICogU3BlY2lmaWVzIHRoZSB0YXJnZXQgZm9yIHRoZSBBUElcbiAgICAgICAqIFZhbHVlcyBjYW4gYmUgXCJxdWV1ZVwiIG9yIFwidG9waWNcIlxuICAgICAgICogQGRlZmF1bHQgXCJmdW5jdGlvblwiXG4gICAgICAgKi9cbiAgICAgIHRhcmdldD86ICdmdW5jdGlvbicgfCAncXVldWUnIHwgJ3RvcGljJztcbiAgICAgIC8qKlxuICAgICAgICogU3BlY2lmaWVzIHRoZSBhdXRob3JpemVyIGZvciB0aGlzIHJvdXRlXG4gICAgICAgKi9cbiAgICAgIGF1dGhvcml6ZXI/OiBBdXRob3JpemVyVHlwZU1ldGFkYXRhIHwgc3RyaW5nO1xuICAgIH1cbiAgKSA9PlxuICAgICh0YXJnZXQ6IGFueSwgbWV0aG9kVG9EZWNvcmF0ZTogYW55KSA9PiB7XG4gICAgICAvLyBHZXQgdGhlIGNvbnN0cnVjdG9yIHVzaW5nIHRoZSB1dGlsaXR5IGZ1bmN0aW9uXG4gICAgICBjb25zdCBjb25zdHJ1Y3RvciA9IGZpbmRDb25zdHJ1Y3Rvcih0YXJnZXQsIG1ldGhvZFRvRGVjb3JhdGUpO1xuICAgICAgXG4gICAgICAvLyBJZiB3ZSBzdGlsbCBkb24ndCBoYXZlIGEgY29uc3RydWN0b3IsIGxvZyBhbiBlcnJvciBhbmQgcmV0dXJuXG4gICAgICBpZiAoIWNvbnN0cnVjdG9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0NvdWxkIG5vdCBkZXRlcm1pbmUgY29uc3RydWN0b3IgZm9yIHJvdXRlIGRlY29yYXRvcicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIEdldCB0aGUgcm91dGVzIGtleSB1c2luZyB0aGUgdXRpbGl0eSBmdW5jdGlvblxuICAgICAgY29uc3Qgcm91dGVzS2V5ID0gZ2V0Um91dGVzS2V5KGNvbnN0cnVjdG9yKTtcbiAgICAgIFxuICAgICAgLy8gR2V0IGV4aXN0aW5nIHJvdXRlcyBvciBpbml0aWFsaXplIGVtcHR5IG9iamVjdFxuICAgICAgbGV0IHJvdXRlczogUmVjb3JkPHN0cmluZywgUm91dGU+ID0gUmVmbGVjdC5nZXQoY29uc3RydWN0b3IsIHJvdXRlc0tleSkgfHwge307XG5cbiAgICAgIC8vIElmIHRoaXMgaXMgYSBkZXJpdmVkIGNsYXNzLCB3ZSBuZWVkIHRvIG1lcmdlIHJvdXRlcyBmcm9tIHRoZSBwYXJlbnQgY2xhc3NcbiAgICAgIGxldCBjdXJyZW50UHJvdG8gPSBjb25zdHJ1Y3Rvci5wcm90b3R5cGU7XG4gICAgICB3aGlsZSAoY3VycmVudFByb3RvICYmIGN1cnJlbnRQcm90by5fX3Byb3RvX18gJiYgY3VycmVudFByb3RvLl9fcHJvdG9fXy5jb25zdHJ1Y3RvciAhPT0gT2JqZWN0KSB7XG4gICAgICAgIGNvbnN0IHBhcmVudENvbnN0cnVjdG9yID0gY3VycmVudFByb3RvLl9fcHJvdG9fXy5jb25zdHJ1Y3RvcjtcbiAgICAgICAgY29uc3QgcGFyZW50Um91dGVzS2V5ID0gZ2V0Um91dGVzS2V5KHBhcmVudENvbnN0cnVjdG9yKTtcbiAgICAgICAgY29uc3QgcGFyZW50Um91dGVzID0gUmVmbGVjdC5nZXQocGFyZW50Q29uc3RydWN0b3IsIHBhcmVudFJvdXRlc0tleSkgfHwge307XG4gICAgICAgIFxuICAgICAgICAvLyBNZXJnZSBwYXJlbnQgcm91dGVzIHdpdGggY3VycmVudCByb3V0ZXMsIGdpdmluZyBwcmlvcml0eSB0byBjdXJyZW50IHJvdXRlc1xuICAgICAgICByb3V0ZXMgPSB7IC4uLnBhcmVudFJvdXRlcywgLi4ucm91dGVzIH07XG4gICAgICAgIFxuICAgICAgICAvLyBNb3ZlIHVwIHRoZSBwcm90b3R5cGUgY2hhaW5cbiAgICAgICAgY3VycmVudFByb3RvID0gY3VycmVudFByb3RvLl9fcHJvdG9fXztcbiAgICAgIH1cblxuICAgICAgaWYgKCFyb3V0ZSkge1xuICAgICAgICByb3V0ZSA9ICcvJztcbiAgICAgIH1cblxuICAgICAgaWYgKHJvdXRlICYmICFyb3V0ZS5zdGFydHNXaXRoKFwiL1wiKSkge1xuICAgICAgICByb3V0ZSA9IGAvJHtyb3V0ZX1gO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJhbWV0ZXJzOiBBcnJheTxTdHJpbmc+ID0gW107XG5cbiAgICAgIHJvdXRlLnNwbGl0KCcvJykuZm9yRWFjaCgocGFyYW0pID0+IHtcbiAgICAgICAgaWYgKHBhcmFtLnN0YXJ0c1dpdGgoJ3snKSAmJiBwYXJhbS5lbmRzV2l0aCgnfScpKSB7XG4gICAgICAgICAgcGFyYW1ldGVycy5wdXNoKHBhcmFtLnNsaWNlKDEsIC0xKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBub3JtYWxpemVkUGF0aCA9IHJvdXRlLmVuZHNXaXRoKCcvJykgPyByb3V0ZS5zbGljZSgwLC0xKSA6IHJvdXRlO1xuICAgICAgXG4gICAgICByb3V0ZXNbYCR7bWV0aG9kfXwke3JvdXRlfWBdID0ge1xuICAgICAgICAvLyBNYWtlIHN1cmUgcGF0aCBkb2VzLW5vdCBlbmQgd2l0aCBhIHRyYWlsaW5nLXNsYXNoIGAvYCBcbiAgICAgICAgLy8gW0FXUyBzaWduYXR1cmUgbmVlZHMgdGhlIGV4YWN0IHBhdGggKHdpdGggb3Igd2l0aG91dCBzbGFzaCldXG4gICAgICAgIC8vIEFuZCBBUEkgZ2F0ZXdheSBzdHJpcHMgdGVoIHRyYWluaW5nIHNsYXNoIGZyb20gdGhlIEFQSS1lbmRwb2ludFxuICAgICAgICAvLyAqIHdlIG5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgQVBJLCBBdXRoLXBvbGljeSwgYW5kIEZyb250ZW5kLWNvZGUgYWxsIGZvbGxvdyB0aGUgc2FtZSBjb252ZW50aW9uXG4gICAgICAgIHBhdGg6IG5vcm1hbGl6ZWRQYXRoLCBcbiAgICAgICAgaHR0cE1ldGhvZDogbWV0aG9kLFxuICAgICAgICBmdW5jdGlvbk5hbWU6IG1ldGhvZFRvRGVjb3JhdGUubmFtZSB8fCBtZXRob2RUb0RlY29yYXRlLFxuICAgICAgICBwYXJhbWV0ZXJzOiBwYXJhbWV0ZXJzLFxuICAgICAgICB2YWxpZGF0aW9uczogb3B0aW9ucz8udmFsaWRhdGlvbnMsXG4gICAgICAgIHRhcmdldDogb3B0aW9ucz8udGFyZ2V0XG4gICAgICB9O1xuXG4gICAgICAvLyBTdG9yZSByb3V0ZSBtZXRhZGF0YSB1c2luZyByZWZsZWN0LW1ldGFkYXRhIGZvciBwcm9kdWN0aW9uIGV4dHJhY3Rpb25cbiAgICAgIGNvbnN0IHJvdXRlTWV0YWRhdGE6IFJvdXRlTWV0YWRhdGEgPSB7XG4gICAgICAgIG1ldGhvZDogbWV0aG9kLnRvVXBwZXJDYXNlKCksXG4gICAgICAgIHBhdGg6IG5vcm1hbGl6ZWRQYXRoLFxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgYXV0aG9yaXplcjogb3B0aW9ucz8uYXV0aG9yaXplciB8fCAnQVdTX0lBTScsXG4gICAgICAgICAgdGFyZ2V0OiBvcHRpb25zPy50YXJnZXQgfHwgJ2Z1bmN0aW9uJyxcbiAgICAgICAgICB2YWxpZGF0aW9uczogb3B0aW9ucz8udmFsaWRhdGlvbnNcbiAgICAgICAgfSxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBtZXRob2RUb0RlY29yYXRlLm5hbWUgfHwgbWV0aG9kVG9EZWNvcmF0ZSxcbiAgICAgICAgcGFyYW1ldGVyczogcGFyYW1ldGVycy5tYXAocCA9PiBTdHJpbmcocCkpXG4gICAgICB9O1xuXG4gICAgICAvLyBTdG9yZSBtZXRhZGF0YSBvbiB0aGUgbWV0aG9kIGl0c2VsZlxuICAgICAgUmVmbGVjdC5kZWZpbmVNZXRhZGF0YShNRVRBREFUQV9LRVlTLlJPVVRFLCByb3V0ZU1ldGFkYXRhLCB0YXJnZXQsIG1ldGhvZFRvRGVjb3JhdGUubmFtZSk7XG5cbiAgICAgIC8vIFN0b3JlIHJvdXRlcyBvbiB0aGUgY29uc3RydWN0b3IgdXNpbmcgdGhlIHVuaXF1ZSBzeW1ib2wgKGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXG4gICAgICBSZWZsZWN0LnNldChjb25zdHJ1Y3Rvciwgcm91dGVzS2V5LCByb3V0ZXMpO1xuICAgICAgXG4gICAgICAvLyBBbHNvIHN0b3JlIGEgcmVmZXJlbmNlIHRvIHRoZSByb3V0ZXMgb24gdGhlIHByb3RvdHlwZSBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgUmVmbGVjdC5zZXQodGFyZ2V0LCBcInJvdXRlc1wiLCByb3V0ZXMpO1xuICAgICAgLy9JbmplY3RQYXJhbXModGFyZ2V0LCBtZXRob2RUb0RlY29yYXRlLCBkZXNjcmlwdG9yKTtcbiAgICB9O1xufVxuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgZGVmaW5pbmcgYSBHRVQgcm91dGUuXG4gKiBcbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggb2YgdGhlIHJvdXRlLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBhIG1ldGhvZC5cbiAqL1xuZXhwb3J0IGNvbnN0IEdldCA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiR0VUXCIpO1xuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgYSBQT1NUIHJvdXRlLlxuICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIHJvdXRlLlxuICovXG5leHBvcnQgY29uc3QgUG9zdCA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiUE9TVFwiKTtcblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGRlZmluaW5nIGEgUFVUIHJvdXRlLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkgYmVpbmcgZGVjb3JhdGVkLlxuICogQHBhcmFtIGRlc2NyaXB0b3IgVGhlIHByb3BlcnR5IGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBjb25zdCBQdXQgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBVVFwiKTtcbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBkZWZpbmluZyBhIERFTEVURSByb3V0ZS5cbiAqIFxuICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCBvZiB0aGUgcm91dGUuXG4gKiBAcmV0dXJucyBBIGRlY29yYXRvciBmdW5jdGlvbiB0aGF0IGNhbiBiZSB1c2VkIHRvIGRlY29yYXRlIGEgbWV0aG9kIGFzIGEgREVMRVRFIHJvdXRlLlxuICovXG5leHBvcnQgY29uc3QgRGVsZXRlID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJERUxFVEVcIik7XG5cbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBQQVRDSCByb3V0ZXMuXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSB0YXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHByb3BlcnR5S2V5IFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS5cbiAqIEBwYXJhbSBkZXNjcmlwdG9yIFRoZSBwcm9wZXJ0eSBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgY29uc3QgUGF0Y2ggPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBBVENIXCIpO1xuLyoqXG4gKiBSZXByZXNlbnRzIGEgZGVjb3JhdG9yIHRoYXQgY3JlYXRlcyBhIHJvdXRlIGRlY29yYXRvciB3aXRoIHRoZSBzcGVjaWZpZWQgSFRUUCBtZXRob2QgXCJPUFRJT05TXCIuXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSB0YXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHByb3BlcnR5S2V5IFRoZSBwcm9wZXJ0eSBrZXkuXG4gKiBAcGFyYW0gZGVzY3JpcHRvciBUaGUgcHJvcGVydHkgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGNvbnN0IE9wdGlvbnMgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIk9QVElPTlNcIik7XG5cbmV4cG9ydCB0eXBlIFJvdXRlTWV0aG9kcyA9IHR5cGVvZiBPcHRpb25zIHwgdHlwZW9mIFBhdGNoIHwgdHlwZW9mIERlbGV0ZSB8IHR5cGVvZiBQdXQgfCB0eXBlb2YgUG9zdCB8IHR5cGVvZiBHZXQ7Il19