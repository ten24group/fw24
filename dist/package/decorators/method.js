"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Options = exports.Patch = exports.Delete = exports.Put = exports.Post = exports.Get = void 0;
const decorator_utils_1 = require("./decorator-utils");
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
            authorizer: options?.authorizer,
            observability: options?.observability
        };
        // Store routes on the constructor using the unique symbol
        Reflect.set(constructor, routesKey, routes);
        // Also store a reference to the routes on the prototype for backward compatibility
        Reflect.set(target, "routes", routes);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0aG9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RlY29yYXRvcnMvbWV0aG9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBLHVEQUFrRTtBQUVsRTs7Ozs7R0FLRztBQUNILFNBQVMsb0JBQW9CLENBQUMsTUFBYztJQUMxQyxPQUFPLENBQ0wsS0FBYSxFQUNiLE9BcUJDLEVBQ0QsRUFBRSxDQUNGLENBQUMsTUFBVyxFQUFFLGdCQUFxQixFQUFFLEVBQUU7UUFDckMsaURBQWlEO1FBQ2pELE1BQU0sV0FBVyxHQUFHLElBQUEsaUNBQWUsRUFBQyxNQUFNLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUU5RCxnRUFBZ0U7UUFDaEUsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2pCLE9BQU8sQ0FBQyxLQUFLLENBQUMscURBQXFELENBQUMsQ0FBQztZQUNyRSxPQUFPO1FBQ1QsQ0FBQztRQUVELGdEQUFnRDtRQUNoRCxNQUFNLFNBQVMsR0FBRyxJQUFBLDhCQUFZLEVBQUMsV0FBVyxDQUFDLENBQUM7UUFFNUMsaURBQWlEO1FBQ2pELElBQUksTUFBTSxHQUEwQixPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLENBQUMsSUFBSSxFQUFFLENBQUM7UUFFOUUsNEVBQTRFO1FBQzVFLElBQUksWUFBWSxHQUFHLFdBQVcsQ0FBQyxTQUFTLENBQUM7UUFDekMsT0FBTyxZQUFZLElBQUksWUFBWSxDQUFDLFNBQVMsSUFBSSxZQUFZLENBQUMsU0FBUyxDQUFDLFdBQVcsS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUMvRixNQUFNLGlCQUFpQixHQUFHLFlBQVksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDO1lBQzdELE1BQU0sZUFBZSxHQUFHLElBQUEsOEJBQVksRUFBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQ3hELE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEVBQUUsZUFBZSxDQUFDLElBQUksRUFBRSxDQUFDO1lBRTNFLDZFQUE2RTtZQUM3RSxNQUFNLEdBQUcsRUFBRSxHQUFHLFlBQVksRUFBRSxHQUFHLE1BQU0sRUFBRSxDQUFDO1lBRXhDLDhCQUE4QjtZQUM5QixZQUFZLEdBQUcsWUFBWSxDQUFDLFNBQVMsQ0FBQztRQUN4QyxDQUFDO1FBRUQsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ1gsS0FBSyxHQUFHLEdBQUcsQ0FBQztRQUNkLENBQUM7UUFFRCxJQUFJLEtBQUssSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNwQyxLQUFLLEdBQUcsSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUN0QixDQUFDO1FBRUQsTUFBTSxVQUFVLEdBQWtCLEVBQUUsQ0FBQztRQUVyQyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ2pDLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ2pELFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3RDLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sQ0FBQyxHQUFHLE1BQU0sSUFBSSxLQUFLLEVBQUUsQ0FBQyxHQUFHO1lBQzdCLHlEQUF5RDtZQUN6RCwrREFBK0Q7WUFDL0Qsa0VBQWtFO1lBQ2xFLGlHQUFpRztZQUNqRyxJQUFJLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSztZQUNyRCxVQUFVLEVBQUUsTUFBTTtZQUNsQixZQUFZLEVBQUUsZ0JBQWdCLENBQUMsSUFBSSxJQUFJLGdCQUFnQjtZQUN2RCxVQUFVLEVBQUUsVUFBVTtZQUN0QixXQUFXLEVBQUUsT0FBTyxFQUFFLFdBQVc7WUFDakMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNO1lBQ3ZCLFVBQVUsRUFBRSxPQUFPLEVBQUUsVUFBVTtZQUMvQixhQUFhLEVBQUUsT0FBTyxFQUFFLGFBQWE7U0FDdEMsQ0FBQztRQUVGLDBEQUEwRDtRQUMxRCxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFNUMsbUZBQW1GO1FBQ25GLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN4QyxDQUFDLENBQUM7QUFDTixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDVSxRQUFBLEdBQUcsR0FBRyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUUvQzs7O0dBR0c7QUFDVSxRQUFBLElBQUksR0FBRyxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUVqRDs7Ozs7R0FLRztBQUNVLFFBQUEsR0FBRyxHQUFHLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQy9DOzs7OztHQUtHO0FBQ1UsUUFBQSxNQUFNLEdBQUcsb0JBQW9CLENBQUMsUUFBUSxDQUFDLENBQUM7QUFFckQ7Ozs7O0dBS0c7QUFDVSxRQUFBLEtBQUssR0FBRyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNuRDs7Ozs7R0FLRztBQUNVLFFBQUEsT0FBTyxHQUFHLG9CQUFvQixDQUFDLFNBQVMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBSb3V0ZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL3JvdXRlXCI7XG5pbXBvcnQgdHlwZSB7IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsIElucHV0VmFsaWRhdGlvblJ1bGUgfSBmcm9tIFwiLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHR5cGUgeyBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gXCIuLi9vYnNlcnZhYmlsaXR5L2NvbnRyb2xsZXItY29uZmlnXCI7XG5pbXBvcnQgeyBmaW5kQ29uc3RydWN0b3IsIGdldFJvdXRlc0tleSB9IGZyb20gXCIuL2RlY29yYXRvci11dGlsc1wiO1xuXG4vKipcbiAqIENyZWF0ZXMgYSByb3V0ZSBkZWNvcmF0b3IgZm9yIEhUVFAgbWV0aG9kcy5cbiAqIFxuICogQHBhcmFtIG1ldGhvZCAtIFRoZSBIVFRQIG1ldGhvZCBmb3IgdGhlIHJvdXRlIGRlY29yYXRvci5cbiAqIEByZXR1cm5zIEEgZGVjb3JhdG9yIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIHVzZWQgdG8gZGVjb3JhdGUgY2xhc3MgbWV0aG9kcyBhcyByb3V0ZXMuXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVJvdXRlRGVjb3JhdG9yKG1ldGhvZDogc3RyaW5nKSB7XG4gIHJldHVybiAoXG4gICAgcm91dGU6IHN0cmluZyxcbiAgICBvcHRpb25zPzoge1xuICAgICAgdmFsaWRhdGlvbnM/OiBJbnB1dFZhbGlkYXRpb25SdWxlIHwgSHR0cFJlcXVlc3RWYWxpZGF0aW9ucyxcbiAgICAgIC8qKlxuICAgICAgICogU3BlY2lmaWVzIHRoZSB0YXJnZXQgZm9yIHRoZSBBUElcbiAgICAgICAqIFZhbHVlcyBjYW4gYmUgXCJxdWV1ZVwiIG9yIFwidG9waWNcIlxuICAgICAgICogQGRlZmF1bHQgXCJcIlxuICAgICAgICovXG4gICAgICB0YXJnZXQ/OiBzdHJpbmc7XG4gICAgICAvKipcbiAgICAgICAqIFNwZWNpZmllcyB0aGUgYXV0aG9yaXplciBmb3IgdGhlIHJvdXRlLlxuICAgICAgICovXG4gICAgICBhdXRob3JpemVyPzogeyBcbiAgICAgICAgbmFtZT86IHN0cmluZztcbiAgICAgICAgdHlwZT86IHN0cmluZztcbiAgICAgICAgZ3JvdXBzPzogc3RyaW5nW10gfCBzdHJpbmc7XG4gICAgICB9IHwgc3RyaW5nO1xuICAgICAgLyoqXG4gICAgICAgKiBPYnNlcnZhYmlsaXR5IGNvbmZpZyBvdmVycmlkZSBmb3IgdGhpcyBtZXRob2QuXG4gICAgICAgKiBUYWtlcyBwcmVjZWRlbmNlIG92ZXIgY29udHJvbGxlci1sZXZlbCBjb25maWcuXG4gICAgICAgKi9cbiAgICAgIG9ic2VydmFiaWxpdHk/OiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZztcbiAgICB9XG4gICkgPT5cbiAgICAodGFyZ2V0OiBhbnksIG1ldGhvZFRvRGVjb3JhdGU6IGFueSkgPT4ge1xuICAgICAgLy8gR2V0IHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdXRpbGl0eSBmdW5jdGlvblxuICAgICAgY29uc3QgY29uc3RydWN0b3IgPSBmaW5kQ29uc3RydWN0b3IodGFyZ2V0LCBtZXRob2RUb0RlY29yYXRlKTtcbiAgICAgIFxuICAgICAgLy8gSWYgd2Ugc3RpbGwgZG9uJ3QgaGF2ZSBhIGNvbnN0cnVjdG9yLCBsb2cgYW4gZXJyb3IgYW5kIHJldHVyblxuICAgICAgaWYgKCFjb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIGNvbnN0cnVjdG9yIGZvciByb3V0ZSBkZWNvcmF0b3InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBHZXQgdGhlIHJvdXRlcyBrZXkgdXNpbmcgdGhlIHV0aWxpdHkgZnVuY3Rpb25cbiAgICAgIGNvbnN0IHJvdXRlc0tleSA9IGdldFJvdXRlc0tleShjb25zdHJ1Y3Rvcik7XG4gICAgICBcbiAgICAgIC8vIEdldCBleGlzdGluZyByb3V0ZXMgb3IgaW5pdGlhbGl6ZSBlbXB0eSBvYmplY3RcbiAgICAgIGxldCByb3V0ZXM6IFJlY29yZDxzdHJpbmcsIFJvdXRlPiA9IFJlZmxlY3QuZ2V0KGNvbnN0cnVjdG9yLCByb3V0ZXNLZXkpIHx8IHt9O1xuXG4gICAgICAvLyBJZiB0aGlzIGlzIGEgZGVyaXZlZCBjbGFzcywgd2UgbmVlZCB0byBtZXJnZSByb3V0ZXMgZnJvbSB0aGUgcGFyZW50IGNsYXNzXG4gICAgICBsZXQgY3VycmVudFByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICAgICAgd2hpbGUgKGN1cnJlbnRQcm90byAmJiBjdXJyZW50UHJvdG8uX19wcm90b19fICYmIGN1cnJlbnRQcm90by5fX3Byb3RvX18uY29uc3RydWN0b3IgIT09IE9iamVjdCkge1xuICAgICAgICBjb25zdCBwYXJlbnRDb25zdHJ1Y3RvciA9IGN1cnJlbnRQcm90by5fX3Byb3RvX18uY29uc3RydWN0b3I7XG4gICAgICAgIGNvbnN0IHBhcmVudFJvdXRlc0tleSA9IGdldFJvdXRlc0tleShwYXJlbnRDb25zdHJ1Y3Rvcik7XG4gICAgICAgIGNvbnN0IHBhcmVudFJvdXRlcyA9IFJlZmxlY3QuZ2V0KHBhcmVudENvbnN0cnVjdG9yLCBwYXJlbnRSb3V0ZXNLZXkpIHx8IHt9O1xuICAgICAgICBcbiAgICAgICAgLy8gTWVyZ2UgcGFyZW50IHJvdXRlcyB3aXRoIGN1cnJlbnQgcm91dGVzLCBnaXZpbmcgcHJpb3JpdHkgdG8gY3VycmVudCByb3V0ZXNcbiAgICAgICAgcm91dGVzID0geyAuLi5wYXJlbnRSb3V0ZXMsIC4uLnJvdXRlcyB9O1xuICAgICAgICBcbiAgICAgICAgLy8gTW92ZSB1cCB0aGUgcHJvdG90eXBlIGNoYWluXG4gICAgICAgIGN1cnJlbnRQcm90byA9IGN1cnJlbnRQcm90by5fX3Byb3RvX187XG4gICAgICB9XG5cbiAgICAgIGlmICghcm91dGUpIHtcbiAgICAgICAgcm91dGUgPSAnLyc7XG4gICAgICB9XG5cbiAgICAgIGlmIChyb3V0ZSAmJiAhcm91dGUuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgICAgcm91dGUgPSBgLyR7cm91dGV9YDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyYW1ldGVyczogQXJyYXk8U3RyaW5nPiA9IFtdO1xuXG4gICAgICByb3V0ZS5zcGxpdCgnLycpLmZvckVhY2goKHBhcmFtKSA9PiB7XG4gICAgICAgIGlmIChwYXJhbS5zdGFydHNXaXRoKCd7JykgJiYgcGFyYW0uZW5kc1dpdGgoJ30nKSkge1xuICAgICAgICAgIHBhcmFtZXRlcnMucHVzaChwYXJhbS5zbGljZSgxLCAtMSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcm91dGVzW2Ake21ldGhvZH18JHtyb3V0ZX1gXSA9IHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHBhdGggZG9lcy1ub3QgZW5kIHdpdGggYSB0cmFpbGluZy1zbGFzaCBgL2AgXG4gICAgICAgIC8vIFtBV1Mgc2lnbmF0dXJlIG5lZWRzIHRoZSBleGFjdCBwYXRoICh3aXRoIG9yIHdpdGhvdXQgc2xhc2gpXVxuICAgICAgICAvLyBBbmQgQVBJIGdhdGV3YXkgc3RyaXBzIHRlaCB0cmFpbmluZyBzbGFzaCBmcm9tIHRoZSBBUEktZW5kcG9pbnRcbiAgICAgICAgLy8gKiB3ZSBuZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IEFQSSwgQXV0aC1wb2xpY3ksIGFuZCBGcm9udGVuZC1jb2RlIGFsbCBmb2xsb3cgdGhlIHNhbWUgY29udmVudGlvblxuICAgICAgICBwYXRoOiByb3V0ZS5lbmRzV2l0aCgnLycpID8gcm91dGUuc2xpY2UoMCwtMSkgOiByb3V0ZSwgXG4gICAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBtZXRob2RUb0RlY29yYXRlLm5hbWUgfHwgbWV0aG9kVG9EZWNvcmF0ZSxcbiAgICAgICAgcGFyYW1ldGVyczogcGFyYW1ldGVycyxcbiAgICAgICAgdmFsaWRhdGlvbnM6IG9wdGlvbnM/LnZhbGlkYXRpb25zLFxuICAgICAgICB0YXJnZXQ6IG9wdGlvbnM/LnRhcmdldCxcbiAgICAgICAgYXV0aG9yaXplcjogb3B0aW9ucz8uYXV0aG9yaXplcixcbiAgICAgICAgb2JzZXJ2YWJpbGl0eTogb3B0aW9ucz8ub2JzZXJ2YWJpbGl0eVxuICAgICAgfTtcblxuICAgICAgLy8gU3RvcmUgcm91dGVzIG9uIHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdW5pcXVlIHN5bWJvbFxuICAgICAgUmVmbGVjdC5zZXQoY29uc3RydWN0b3IsIHJvdXRlc0tleSwgcm91dGVzKTtcbiAgICAgIFxuICAgICAgLy8gQWxzbyBzdG9yZSBhIHJlZmVyZW5jZSB0byB0aGUgcm91dGVzIG9uIHRoZSBwcm90b3R5cGUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIFJlZmxlY3Quc2V0KHRhcmdldCwgXCJyb3V0ZXNcIiwgcm91dGVzKTtcbiAgICB9O1xufVxuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgZGVmaW5pbmcgYSBHRVQgcm91dGUuXG4gKiBcbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggb2YgdGhlIHJvdXRlLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBhIG1ldGhvZC5cbiAqL1xuZXhwb3J0IGNvbnN0IEdldCA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiR0VUXCIpO1xuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgYSBQT1NUIHJvdXRlLlxuICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIHJvdXRlLlxuICovXG5leHBvcnQgY29uc3QgUG9zdCA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiUE9TVFwiKTtcblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGRlZmluaW5nIGEgUFVUIHJvdXRlLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkgYmVpbmcgZGVjb3JhdGVkLlxuICogQHBhcmFtIGRlc2NyaXB0b3IgVGhlIHByb3BlcnR5IGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBjb25zdCBQdXQgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBVVFwiKTtcbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBkZWZpbmluZyBhIERFTEVURSByb3V0ZS5cbiAqIFxuICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCBvZiB0aGUgcm91dGUuXG4gKiBAcmV0dXJucyBBIGRlY29yYXRvciBmdW5jdGlvbiB0aGF0IGNhbiBiZSB1c2VkIHRvIGRlY29yYXRlIGEgbWV0aG9kIGFzIGEgREVMRVRFIHJvdXRlLlxuICovXG5leHBvcnQgY29uc3QgRGVsZXRlID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJERUxFVEVcIik7XG5cbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBQQVRDSCByb3V0ZXMuXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSB0YXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHByb3BlcnR5S2V5IFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS5cbiAqIEBwYXJhbSBkZXNjcmlwdG9yIFRoZSBwcm9wZXJ0eSBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgY29uc3QgUGF0Y2ggPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBBVENIXCIpO1xuLyoqXG4gKiBSZXByZXNlbnRzIGEgZGVjb3JhdG9yIHRoYXQgY3JlYXRlcyBhIHJvdXRlIGRlY29yYXRvciB3aXRoIHRoZSBzcGVjaWZpZWQgSFRUUCBtZXRob2QgXCJPUFRJT05TXCIuXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSB0YXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHByb3BlcnR5S2V5IFRoZSBwcm9wZXJ0eSBrZXkuXG4gKiBAcGFyYW0gZGVzY3JpcHRvciBUaGUgcHJvcGVydHkgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGNvbnN0IE9wdGlvbnMgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIk9QVElPTlNcIik7XG5cbmV4cG9ydCB0eXBlIFJvdXRlTWV0aG9kcyA9IHR5cGVvZiBPcHRpb25zIHwgdHlwZW9mIFBhdGNoIHwgdHlwZW9mIERlbGV0ZSB8IHR5cGVvZiBQdXQgfCB0eXBlb2YgUG9zdCB8IHR5cGVvZiBHZXQ7XG4iXX0=