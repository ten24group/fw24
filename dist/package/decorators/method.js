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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0aG9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RlY29yYXRvcnMvbWV0aG9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUdBLHVEQUFrRTtBQUVsRTs7Ozs7R0FLRztBQUNILFNBQVMsb0JBQW9CLENBQUMsTUFBYztJQUMxQyxPQUFPLENBQ0wsS0FBYSxFQUNiLE9BYUMsRUFDRCxFQUFFLENBQ0YsQ0FBQyxNQUFXLEVBQUUsZ0JBQXFCLEVBQUUsRUFBRTtRQUNyQyxpREFBaUQ7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBQSxpQ0FBZSxFQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBRTlELGdFQUFnRTtRQUNoRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsT0FBTyxDQUFDLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1lBQ3JFLE9BQU87UUFDVCxDQUFDO1FBRUQsZ0RBQWdEO1FBQ2hELE1BQU0sU0FBUyxHQUFHLElBQUEsOEJBQVksRUFBQyxXQUFXLENBQUMsQ0FBQztRQUU1QyxpREFBaUQ7UUFDakQsSUFBSSxNQUFNLEdBQTBCLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUU5RSw0RUFBNEU7UUFDNUUsSUFBSSxZQUFZLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQztRQUN6QyxPQUFPLFlBQVksSUFBSSxZQUFZLENBQUMsU0FBUyxJQUFJLFlBQVksQ0FBQyxTQUFTLENBQUMsV0FBVyxLQUFLLE1BQU0sRUFBRSxDQUFDO1lBQy9GLE1BQU0saUJBQWlCLEdBQUcsWUFBWSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUM7WUFDN0QsTUFBTSxlQUFlLEdBQUcsSUFBQSw4QkFBWSxFQUFDLGlCQUFpQixDQUFDLENBQUM7WUFDeEQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7WUFFM0UsNkVBQTZFO1lBQzdFLE1BQU0sR0FBRyxFQUFFLEdBQUcsWUFBWSxFQUFFLEdBQUcsTUFBTSxFQUFFLENBQUM7WUFFeEMsOEJBQThCO1lBQzlCLFlBQVksR0FBRyxZQUFZLENBQUMsU0FBUyxDQUFDO1FBQ3hDLENBQUM7UUFFRCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWCxLQUFLLEdBQUcsR0FBRyxDQUFDO1FBQ2QsQ0FBQztRQUVELElBQUksS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3BDLEtBQUssR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3RCLENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBa0IsRUFBRSxDQUFDO1FBRXJDLEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDakMsSUFBSSxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDakQsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdEMsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxDQUFDLEdBQUcsTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDLEdBQUc7WUFDN0IseURBQXlEO1lBQ3pELCtEQUErRDtZQUMvRCxrRUFBa0U7WUFDbEUsaUdBQWlHO1lBQ2pHLElBQUksRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLO1lBQ3JELFVBQVUsRUFBRSxNQUFNO1lBQ2xCLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLElBQUksZ0JBQWdCO1lBQ3ZELFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFdBQVcsRUFBRSxPQUFPLEVBQUUsV0FBVztZQUNqQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU07WUFDdkIsYUFBYSxFQUFFLE9BQU8sRUFBRSxhQUFhO1NBQ3RDLENBQUM7UUFFRiwwREFBMEQ7UUFDMUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsU0FBUyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRTVDLG1GQUFtRjtRQUNuRixPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDeEMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOzs7OztHQUtHO0FBQ1UsUUFBQSxHQUFHLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFL0M7OztHQUdHO0FBQ1UsUUFBQSxJQUFJLEdBQUcsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7QUFFakQ7Ozs7O0dBS0c7QUFDVSxRQUFBLEdBQUcsR0FBRyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUMvQzs7Ozs7R0FLRztBQUNVLFFBQUEsTUFBTSxHQUFHLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBRXJEOzs7OztHQUtHO0FBQ1UsUUFBQSxLQUFLLEdBQUcsb0JBQW9CLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbkQ7Ozs7O0dBS0c7QUFDVSxRQUFBLE9BQU8sR0FBRyxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgUm91dGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9yb3V0ZVwiO1xuaW1wb3J0IHR5cGUgeyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB0eXBlIHsgQ29udHJvbGxlck9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tIFwiLi4vb2JzZXJ2YWJpbGl0eS9jb250cm9sbGVyLWNvbmZpZ1wiO1xuaW1wb3J0IHsgZmluZENvbnN0cnVjdG9yLCBnZXRSb3V0ZXNLZXkgfSBmcm9tIFwiLi9kZWNvcmF0b3ItdXRpbHNcIjtcblxuLyoqXG4gKiBDcmVhdGVzIGEgcm91dGUgZGVjb3JhdG9yIGZvciBIVFRQIG1ldGhvZHMuXG4gKiBcbiAqIEBwYXJhbSBtZXRob2QgLSBUaGUgSFRUUCBtZXRob2QgZm9yIHRoZSByb3V0ZSBkZWNvcmF0b3IuXG4gKiBAcmV0dXJucyBBIGRlY29yYXRvciBmdW5jdGlvbiB0aGF0IGNhbiBiZSB1c2VkIHRvIGRlY29yYXRlIGNsYXNzIG1ldGhvZHMgYXMgcm91dGVzLlxuICovXG5mdW5jdGlvbiBjcmVhdGVSb3V0ZURlY29yYXRvcihtZXRob2Q6IHN0cmluZykge1xuICByZXR1cm4gKFxuICAgIHJvdXRlOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IHtcbiAgICAgIHZhbGlkYXRpb25zPzogSW5wdXRWYWxpZGF0aW9uUnVsZSB8IEh0dHBSZXF1ZXN0VmFsaWRhdGlvbnMsXG4gICAgICAvKipcbiAgICAgICAqIFNwZWNpZmllcyB0aGUgdGFyZ2V0IGZvciB0aGUgQVBJXG4gICAgICAgKiBWYWx1ZXMgY2FuIGJlIFwicXVldWVcIiBvciBcInRvcGljXCJcbiAgICAgICAqIEBkZWZhdWx0IFwiXCJcbiAgICAgICAqL1xuICAgICAgdGFyZ2V0Pzogc3RyaW5nO1xuICAgICAgLyoqXG4gICAgICAgKiBPYnNlcnZhYmlsaXR5IGNvbmZpZyBvdmVycmlkZSBmb3IgdGhpcyBtZXRob2QuXG4gICAgICAgKiBUYWtlcyBwcmVjZWRlbmNlIG92ZXIgY29udHJvbGxlci1sZXZlbCBjb25maWcuXG4gICAgICAgKi9cbiAgICAgIG9ic2VydmFiaWxpdHk/OiBDb250cm9sbGVyT2JzZXJ2YWJpbGl0eUNvbmZpZztcbiAgICB9XG4gICkgPT5cbiAgICAodGFyZ2V0OiBhbnksIG1ldGhvZFRvRGVjb3JhdGU6IGFueSkgPT4ge1xuICAgICAgLy8gR2V0IHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdXRpbGl0eSBmdW5jdGlvblxuICAgICAgY29uc3QgY29uc3RydWN0b3IgPSBmaW5kQ29uc3RydWN0b3IodGFyZ2V0LCBtZXRob2RUb0RlY29yYXRlKTtcbiAgICAgIFxuICAgICAgLy8gSWYgd2Ugc3RpbGwgZG9uJ3QgaGF2ZSBhIGNvbnN0cnVjdG9yLCBsb2cgYW4gZXJyb3IgYW5kIHJldHVyblxuICAgICAgaWYgKCFjb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIGNvbnN0cnVjdG9yIGZvciByb3V0ZSBkZWNvcmF0b3InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBHZXQgdGhlIHJvdXRlcyBrZXkgdXNpbmcgdGhlIHV0aWxpdHkgZnVuY3Rpb25cbiAgICAgIGNvbnN0IHJvdXRlc0tleSA9IGdldFJvdXRlc0tleShjb25zdHJ1Y3Rvcik7XG4gICAgICBcbiAgICAgIC8vIEdldCBleGlzdGluZyByb3V0ZXMgb3IgaW5pdGlhbGl6ZSBlbXB0eSBvYmplY3RcbiAgICAgIGxldCByb3V0ZXM6IFJlY29yZDxzdHJpbmcsIFJvdXRlPiA9IFJlZmxlY3QuZ2V0KGNvbnN0cnVjdG9yLCByb3V0ZXNLZXkpIHx8IHt9O1xuXG4gICAgICAvLyBJZiB0aGlzIGlzIGEgZGVyaXZlZCBjbGFzcywgd2UgbmVlZCB0byBtZXJnZSByb3V0ZXMgZnJvbSB0aGUgcGFyZW50IGNsYXNzXG4gICAgICBsZXQgY3VycmVudFByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICAgICAgd2hpbGUgKGN1cnJlbnRQcm90byAmJiBjdXJyZW50UHJvdG8uX19wcm90b19fICYmIGN1cnJlbnRQcm90by5fX3Byb3RvX18uY29uc3RydWN0b3IgIT09IE9iamVjdCkge1xuICAgICAgICBjb25zdCBwYXJlbnRDb25zdHJ1Y3RvciA9IGN1cnJlbnRQcm90by5fX3Byb3RvX18uY29uc3RydWN0b3I7XG4gICAgICAgIGNvbnN0IHBhcmVudFJvdXRlc0tleSA9IGdldFJvdXRlc0tleShwYXJlbnRDb25zdHJ1Y3Rvcik7XG4gICAgICAgIGNvbnN0IHBhcmVudFJvdXRlcyA9IFJlZmxlY3QuZ2V0KHBhcmVudENvbnN0cnVjdG9yLCBwYXJlbnRSb3V0ZXNLZXkpIHx8IHt9O1xuICAgICAgICBcbiAgICAgICAgLy8gTWVyZ2UgcGFyZW50IHJvdXRlcyB3aXRoIGN1cnJlbnQgcm91dGVzLCBnaXZpbmcgcHJpb3JpdHkgdG8gY3VycmVudCByb3V0ZXNcbiAgICAgICAgcm91dGVzID0geyAuLi5wYXJlbnRSb3V0ZXMsIC4uLnJvdXRlcyB9O1xuICAgICAgICBcbiAgICAgICAgLy8gTW92ZSB1cCB0aGUgcHJvdG90eXBlIGNoYWluXG4gICAgICAgIGN1cnJlbnRQcm90byA9IGN1cnJlbnRQcm90by5fX3Byb3RvX187XG4gICAgICB9XG5cbiAgICAgIGlmICghcm91dGUpIHtcbiAgICAgICAgcm91dGUgPSAnLyc7XG4gICAgICB9XG5cbiAgICAgIGlmIChyb3V0ZSAmJiAhcm91dGUuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgICAgcm91dGUgPSBgLyR7cm91dGV9YDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyYW1ldGVyczogQXJyYXk8U3RyaW5nPiA9IFtdO1xuXG4gICAgICByb3V0ZS5zcGxpdCgnLycpLmZvckVhY2goKHBhcmFtKSA9PiB7XG4gICAgICAgIGlmIChwYXJhbS5zdGFydHNXaXRoKCd7JykgJiYgcGFyYW0uZW5kc1dpdGgoJ30nKSkge1xuICAgICAgICAgIHBhcmFtZXRlcnMucHVzaChwYXJhbS5zbGljZSgxLCAtMSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcm91dGVzW2Ake21ldGhvZH18JHtyb3V0ZX1gXSA9IHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHBhdGggZG9lcy1ub3QgZW5kIHdpdGggYSB0cmFpbGluZy1zbGFzaCBgL2AgXG4gICAgICAgIC8vIFtBV1Mgc2lnbmF0dXJlIG5lZWRzIHRoZSBleGFjdCBwYXRoICh3aXRoIG9yIHdpdGhvdXQgc2xhc2gpXVxuICAgICAgICAvLyBBbmQgQVBJIGdhdGV3YXkgc3RyaXBzIHRlaCB0cmFpbmluZyBzbGFzaCBmcm9tIHRoZSBBUEktZW5kcG9pbnRcbiAgICAgICAgLy8gKiB3ZSBuZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IEFQSSwgQXV0aC1wb2xpY3ksIGFuZCBGcm9udGVuZC1jb2RlIGFsbCBmb2xsb3cgdGhlIHNhbWUgY29udmVudGlvblxuICAgICAgICBwYXRoOiByb3V0ZS5lbmRzV2l0aCgnLycpID8gcm91dGUuc2xpY2UoMCwtMSkgOiByb3V0ZSwgXG4gICAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBtZXRob2RUb0RlY29yYXRlLm5hbWUgfHwgbWV0aG9kVG9EZWNvcmF0ZSxcbiAgICAgICAgcGFyYW1ldGVyczogcGFyYW1ldGVycyxcbiAgICAgICAgdmFsaWRhdGlvbnM6IG9wdGlvbnM/LnZhbGlkYXRpb25zLFxuICAgICAgICB0YXJnZXQ6IG9wdGlvbnM/LnRhcmdldCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eTogb3B0aW9ucz8ub2JzZXJ2YWJpbGl0eVxuICAgICAgfTtcblxuICAgICAgLy8gU3RvcmUgcm91dGVzIG9uIHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdW5pcXVlIHN5bWJvbFxuICAgICAgUmVmbGVjdC5zZXQoY29uc3RydWN0b3IsIHJvdXRlc0tleSwgcm91dGVzKTtcbiAgICAgIFxuICAgICAgLy8gQWxzbyBzdG9yZSBhIHJlZmVyZW5jZSB0byB0aGUgcm91dGVzIG9uIHRoZSBwcm90b3R5cGUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIFJlZmxlY3Quc2V0KHRhcmdldCwgXCJyb3V0ZXNcIiwgcm91dGVzKTtcbiAgICB9O1xufVxuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgZGVmaW5pbmcgYSBHRVQgcm91dGUuXG4gKiBcbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggb2YgdGhlIHJvdXRlLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBhIG1ldGhvZC5cbiAqL1xuZXhwb3J0IGNvbnN0IEdldCA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiR0VUXCIpO1xuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgY3JlYXRpbmcgYSBQT1NUIHJvdXRlLlxuICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCBmb3IgdGhlIHJvdXRlLlxuICovXG5leHBvcnQgY29uc3QgUG9zdCA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiUE9TVFwiKTtcblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGRlZmluaW5nIGEgUFVUIHJvdXRlLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkgYmVpbmcgZGVjb3JhdGVkLlxuICogQHBhcmFtIGRlc2NyaXB0b3IgVGhlIHByb3BlcnR5IGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBjb25zdCBQdXQgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBVVFwiKTtcbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBkZWZpbmluZyBhIERFTEVURSByb3V0ZS5cbiAqIFxuICogQHBhcmFtIHBhdGggLSBUaGUgcGF0aCBvZiB0aGUgcm91dGUuXG4gKiBAcmV0dXJucyBBIGRlY29yYXRvciBmdW5jdGlvbiB0aGF0IGNhbiBiZSB1c2VkIHRvIGRlY29yYXRlIGEgbWV0aG9kIGFzIGEgREVMRVRFIHJvdXRlLlxuICovXG5leHBvcnQgY29uc3QgRGVsZXRlID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJERUxFVEVcIik7XG5cbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBQQVRDSCByb3V0ZXMuXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSB0YXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHByb3BlcnR5S2V5IFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS5cbiAqIEBwYXJhbSBkZXNjcmlwdG9yIFRoZSBwcm9wZXJ0eSBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgY29uc3QgUGF0Y2ggPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBBVENIXCIpO1xuLyoqXG4gKiBSZXByZXNlbnRzIGEgZGVjb3JhdG9yIHRoYXQgY3JlYXRlcyBhIHJvdXRlIGRlY29yYXRvciB3aXRoIHRoZSBzcGVjaWZpZWQgSFRUUCBtZXRob2QgXCJPUFRJT05TXCIuXG4gKiBAcGFyYW0gdGFyZ2V0IFRoZSB0YXJnZXQgb2JqZWN0LlxuICogQHBhcmFtIHByb3BlcnR5S2V5IFRoZSBwcm9wZXJ0eSBrZXkuXG4gKiBAcGFyYW0gZGVzY3JpcHRvciBUaGUgcHJvcGVydHkgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGNvbnN0IE9wdGlvbnMgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIk9QVElPTlNcIik7XG5cbmV4cG9ydCB0eXBlIFJvdXRlTWV0aG9kcyA9IHR5cGVvZiBPcHRpb25zIHwgdHlwZW9mIFBhdGNoIHwgdHlwZW9mIERlbGV0ZSB8IHR5cGVvZiBQdXQgfCB0eXBlb2YgUG9zdCB8IHR5cGVvZiBHZXQ7XG4iXX0=