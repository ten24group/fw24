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
            target: options?.target
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWV0aG9kLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2RlY29yYXRvcnMvbWV0aG9kLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLHVEQUFrRTtBQUVsRSx5QkFBeUI7QUFDekIsaUJBQWlCO0FBQ2pCLHdCQUF3QjtBQUN4QixtQ0FBbUM7QUFDbkMsTUFBTTtBQUNOLCtDQUErQztBQUMvQyxtREFBbUQ7QUFDbkQsMkRBQTJEO0FBQzNELHlCQUF5QjtBQUN6QixjQUFjO0FBQ2QsK0VBQStFO0FBQy9FLFdBQVc7QUFFWCxzREFBc0Q7QUFDdEQsT0FBTztBQUNQLElBQUk7QUFFSjs7Ozs7R0FLRztBQUNILFNBQVMsb0JBQW9CLENBQUMsTUFBYztJQUMxQyxPQUFPLENBQ0wsS0FBYSxFQUNiLE9BUUMsRUFDRCxFQUFFLENBQ0YsQ0FBQyxNQUFXLEVBQUUsZ0JBQXFCLEVBQUUsRUFBRTtRQUNyQyxpREFBaUQ7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBQSxpQ0FBZSxFQUFDLE1BQU0sRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBRTlELGdFQUFnRTtRQUNoRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsT0FBTyxDQUFDLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1lBQ3JFLE9BQU87UUFDVCxDQUFDO1FBRUQsZ0RBQWdEO1FBQ2hELE1BQU0sU0FBUyxHQUFHLElBQUEsOEJBQVksRUFBQyxXQUFXLENBQUMsQ0FBQztRQUU1QyxpREFBaUQ7UUFDakQsSUFBSSxNQUFNLEdBQTBCLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLFNBQVMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUU5RSw0RUFBNEU7UUFDNUUsSUFBSSxZQUFZLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQztRQUN6QyxPQUFPLFlBQVksSUFBSSxZQUFZLENBQUMsU0FBUyxJQUFJLFlBQVksQ0FBQyxTQUFTLENBQUMsV0FBVyxLQUFLLE1BQU0sRUFBRSxDQUFDO1lBQy9GLE1BQU0saUJBQWlCLEdBQUcsWUFBWSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUM7WUFDN0QsTUFBTSxlQUFlLEdBQUcsSUFBQSw4QkFBWSxFQUFDLGlCQUFpQixDQUFDLENBQUM7WUFDeEQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRSxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7WUFFM0UsNkVBQTZFO1lBQzdFLE1BQU0sR0FBRyxFQUFFLEdBQUcsWUFBWSxFQUFFLEdBQUcsTUFBTSxFQUFFLENBQUM7WUFFeEMsOEJBQThCO1lBQzlCLFlBQVksR0FBRyxZQUFZLENBQUMsU0FBUyxDQUFDO1FBQ3hDLENBQUM7UUFFRCxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWCxLQUFLLEdBQUcsR0FBRyxDQUFDO1FBQ2QsQ0FBQztRQUVELElBQUksS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3BDLEtBQUssR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQ3RCLENBQUM7UUFFRCxNQUFNLFVBQVUsR0FBa0IsRUFBRSxDQUFDO1FBRXJDLEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDakMsSUFBSSxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDakQsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdEMsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxDQUFDLEdBQUcsTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDLEdBQUc7WUFDN0IseURBQXlEO1lBQ3pELCtEQUErRDtZQUMvRCxrRUFBa0U7WUFDbEUsaUdBQWlHO1lBQ2pHLElBQUksRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLO1lBQ3JELFVBQVUsRUFBRSxNQUFNO1lBQ2xCLFlBQVksRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLElBQUksZ0JBQWdCO1lBQ3ZELFVBQVUsRUFBRSxVQUFVO1lBQ3RCLFdBQVcsRUFBRSxPQUFPLEVBQUUsV0FBVztZQUNqQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU07U0FDeEIsQ0FBQztRQUVGLDBEQUEwRDtRQUMxRCxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFNUMsbUZBQW1GO1FBQ25GLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN0QyxxREFBcUQ7SUFDdkQsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOzs7OztHQUtHO0FBQ1UsUUFBQSxHQUFHLEdBQUcsb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUM7QUFFL0M7OztHQUdHO0FBQ1UsUUFBQSxJQUFJLEdBQUcsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7QUFFakQ7Ozs7O0dBS0c7QUFDVSxRQUFBLEdBQUcsR0FBRyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUMvQzs7Ozs7R0FLRztBQUNVLFFBQUEsTUFBTSxHQUFHLG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBRXJEOzs7OztHQUtHO0FBQ1UsUUFBQSxLQUFLLEdBQUcsb0JBQW9CLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbkQ7Ozs7O0dBS0c7QUFDVSxRQUFBLE9BQU8sR0FBRyxvQkFBb0IsQ0FBQyxTQUFTLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgUm91dGUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlcy9yb3V0ZVwiO1xuaW1wb3J0IHR5cGUgeyBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLCBJbnB1dFZhbGlkYXRpb25SdWxlIH0gZnJvbSBcIi4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IGZpbmRDb25zdHJ1Y3RvciwgZ2V0Um91dGVzS2V5IH0gZnJvbSBcIi4vZGVjb3JhdG9yLXV0aWxzXCI7XG5cbi8vIGZ1bmN0aW9uIEluamVjdFBhcmFtcyhcbi8vICAgdGFyZ2V0OiBhbnksXG4vLyAgIG1ldGhvZE5hbWU6IHN0cmluZyxcbi8vICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4vLyApIHtcbi8vICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSB0YXJnZXRbbWV0aG9kTmFtZV07XG4vLyAgIGRlc2NyaXB0b3IudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbi8vICAgICBjb25zdCBwYXJhbVZhbHVlcyA9IG5ldyBBcnJheShvcmlnaW5hbE1ldGhvZC5sZW5ndGgpXG4vLyAgICAgICAuZmlsbCh1bmRlZmluZWQpXG4vLyAgICAgICAubWFwKFxuLy8gICAgICAgICAoXywgaSkgPT4gUmVmbGVjdC5nZXQodGFyZ2V0LCBgcGFyYW1fJHttZXRob2ROYW1lfV8ke2l9YCkgfHwgYXJnc1tpXVxuLy8gICAgICAgKTtcblxuLy8gICAgIHJldHVybiBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBwYXJhbVZhbHVlcyk7XG4vLyAgIH07XG4vLyB9XG5cbi8qKlxuICogQ3JlYXRlcyBhIHJvdXRlIGRlY29yYXRvciBmb3IgSFRUUCBtZXRob2RzLlxuICogXG4gKiBAcGFyYW0gbWV0aG9kIC0gVGhlIEhUVFAgbWV0aG9kIGZvciB0aGUgcm91dGUgZGVjb3JhdG9yLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBjbGFzcyBtZXRob2RzIGFzIHJvdXRlcy5cbiAqL1xuZnVuY3Rpb24gY3JlYXRlUm91dGVEZWNvcmF0b3IobWV0aG9kOiBzdHJpbmcpIHtcbiAgcmV0dXJuIChcbiAgICByb3V0ZTogc3RyaW5nLFxuICAgIG9wdGlvbnM/OiB7XG4gICAgICB2YWxpZGF0aW9ucz86IElucHV0VmFsaWRhdGlvblJ1bGUgfCBIdHRwUmVxdWVzdFZhbGlkYXRpb25zLFxuICAgICAgLyoqXG4gICAgICAgKiBTcGVjaWZpZXMgdGhlIHRhcmdldCBmb3IgdGhlIEFQSVxuICAgICAgICogVmFsdWVzIGNhbiBiZSBcInF1ZXVlXCIgb3IgXCJ0b3BpY1wiXG4gICAgICAgKiBAZGVmYXVsdCBcIlwiXG4gICAgICAgKi9cbiAgICAgIHRhcmdldD86IHN0cmluZztcbiAgICB9XG4gICkgPT5cbiAgICAodGFyZ2V0OiBhbnksIG1ldGhvZFRvRGVjb3JhdGU6IGFueSkgPT4ge1xuICAgICAgLy8gR2V0IHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdXRpbGl0eSBmdW5jdGlvblxuICAgICAgY29uc3QgY29uc3RydWN0b3IgPSBmaW5kQ29uc3RydWN0b3IodGFyZ2V0LCBtZXRob2RUb0RlY29yYXRlKTtcbiAgICAgIFxuICAgICAgLy8gSWYgd2Ugc3RpbGwgZG9uJ3QgaGF2ZSBhIGNvbnN0cnVjdG9yLCBsb2cgYW4gZXJyb3IgYW5kIHJldHVyblxuICAgICAgaWYgKCFjb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdDb3VsZCBub3QgZGV0ZXJtaW5lIGNvbnN0cnVjdG9yIGZvciByb3V0ZSBkZWNvcmF0b3InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBHZXQgdGhlIHJvdXRlcyBrZXkgdXNpbmcgdGhlIHV0aWxpdHkgZnVuY3Rpb25cbiAgICAgIGNvbnN0IHJvdXRlc0tleSA9IGdldFJvdXRlc0tleShjb25zdHJ1Y3Rvcik7XG4gICAgICBcbiAgICAgIC8vIEdldCBleGlzdGluZyByb3V0ZXMgb3IgaW5pdGlhbGl6ZSBlbXB0eSBvYmplY3RcbiAgICAgIGxldCByb3V0ZXM6IFJlY29yZDxzdHJpbmcsIFJvdXRlPiA9IFJlZmxlY3QuZ2V0KGNvbnN0cnVjdG9yLCByb3V0ZXNLZXkpIHx8IHt9O1xuXG4gICAgICAvLyBJZiB0aGlzIGlzIGEgZGVyaXZlZCBjbGFzcywgd2UgbmVlZCB0byBtZXJnZSByb3V0ZXMgZnJvbSB0aGUgcGFyZW50IGNsYXNzXG4gICAgICBsZXQgY3VycmVudFByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICAgICAgd2hpbGUgKGN1cnJlbnRQcm90byAmJiBjdXJyZW50UHJvdG8uX19wcm90b19fICYmIGN1cnJlbnRQcm90by5fX3Byb3RvX18uY29uc3RydWN0b3IgIT09IE9iamVjdCkge1xuICAgICAgICBjb25zdCBwYXJlbnRDb25zdHJ1Y3RvciA9IGN1cnJlbnRQcm90by5fX3Byb3RvX18uY29uc3RydWN0b3I7XG4gICAgICAgIGNvbnN0IHBhcmVudFJvdXRlc0tleSA9IGdldFJvdXRlc0tleShwYXJlbnRDb25zdHJ1Y3Rvcik7XG4gICAgICAgIGNvbnN0IHBhcmVudFJvdXRlcyA9IFJlZmxlY3QuZ2V0KHBhcmVudENvbnN0cnVjdG9yLCBwYXJlbnRSb3V0ZXNLZXkpIHx8IHt9O1xuICAgICAgICBcbiAgICAgICAgLy8gTWVyZ2UgcGFyZW50IHJvdXRlcyB3aXRoIGN1cnJlbnQgcm91dGVzLCBnaXZpbmcgcHJpb3JpdHkgdG8gY3VycmVudCByb3V0ZXNcbiAgICAgICAgcm91dGVzID0geyAuLi5wYXJlbnRSb3V0ZXMsIC4uLnJvdXRlcyB9O1xuICAgICAgICBcbiAgICAgICAgLy8gTW92ZSB1cCB0aGUgcHJvdG90eXBlIGNoYWluXG4gICAgICAgIGN1cnJlbnRQcm90byA9IGN1cnJlbnRQcm90by5fX3Byb3RvX187XG4gICAgICB9XG5cbiAgICAgIGlmICghcm91dGUpIHtcbiAgICAgICAgcm91dGUgPSAnLyc7XG4gICAgICB9XG5cbiAgICAgIGlmIChyb3V0ZSAmJiAhcm91dGUuc3RhcnRzV2l0aChcIi9cIikpIHtcbiAgICAgICAgcm91dGUgPSBgLyR7cm91dGV9YDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyYW1ldGVyczogQXJyYXk8U3RyaW5nPiA9IFtdO1xuXG4gICAgICByb3V0ZS5zcGxpdCgnLycpLmZvckVhY2goKHBhcmFtKSA9PiB7XG4gICAgICAgIGlmIChwYXJhbS5zdGFydHNXaXRoKCd7JykgJiYgcGFyYW0uZW5kc1dpdGgoJ30nKSkge1xuICAgICAgICAgIHBhcmFtZXRlcnMucHVzaChwYXJhbS5zbGljZSgxLCAtMSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcm91dGVzW2Ake21ldGhvZH18JHtyb3V0ZX1gXSA9IHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHBhdGggZG9lcy1ub3QgZW5kIHdpdGggYSB0cmFpbGluZy1zbGFzaCBgL2AgXG4gICAgICAgIC8vIFtBV1Mgc2lnbmF0dXJlIG5lZWRzIHRoZSBleGFjdCBwYXRoICh3aXRoIG9yIHdpdGhvdXQgc2xhc2gpXVxuICAgICAgICAvLyBBbmQgQVBJIGdhdGV3YXkgc3RyaXBzIHRlaCB0cmFpbmluZyBzbGFzaCBmcm9tIHRoZSBBUEktZW5kcG9pbnRcbiAgICAgICAgLy8gKiB3ZSBuZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IEFQSSwgQXV0aC1wb2xpY3ksIGFuZCBGcm9udGVuZC1jb2RlIGFsbCBmb2xsb3cgdGhlIHNhbWUgY29udmVudGlvblxuICAgICAgICBwYXRoOiByb3V0ZS5lbmRzV2l0aCgnLycpID8gcm91dGUuc2xpY2UoMCwtMSkgOiByb3V0ZSwgXG4gICAgICAgIGh0dHBNZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBtZXRob2RUb0RlY29yYXRlLm5hbWUgfHwgbWV0aG9kVG9EZWNvcmF0ZSxcbiAgICAgICAgcGFyYW1ldGVyczogcGFyYW1ldGVycyxcbiAgICAgICAgdmFsaWRhdGlvbnM6IG9wdGlvbnM/LnZhbGlkYXRpb25zLFxuICAgICAgICB0YXJnZXQ6IG9wdGlvbnM/LnRhcmdldFxuICAgICAgfTtcblxuICAgICAgLy8gU3RvcmUgcm91dGVzIG9uIHRoZSBjb25zdHJ1Y3RvciB1c2luZyB0aGUgdW5pcXVlIHN5bWJvbFxuICAgICAgUmVmbGVjdC5zZXQoY29uc3RydWN0b3IsIHJvdXRlc0tleSwgcm91dGVzKTtcbiAgICAgIFxuICAgICAgLy8gQWxzbyBzdG9yZSBhIHJlZmVyZW5jZSB0byB0aGUgcm91dGVzIG9uIHRoZSBwcm90b3R5cGUgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIFJlZmxlY3Quc2V0KHRhcmdldCwgXCJyb3V0ZXNcIiwgcm91dGVzKTtcbiAgICAgIC8vSW5qZWN0UGFyYW1zKHRhcmdldCwgbWV0aG9kVG9EZWNvcmF0ZSwgZGVzY3JpcHRvcik7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGRlZmluaW5nIGEgR0VUIHJvdXRlLlxuICogXG4gKiBAcGFyYW0gcGF0aCAtIFRoZSBwYXRoIG9mIHRoZSByb3V0ZS5cbiAqIEByZXR1cm5zIEEgZGVjb3JhdG9yIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIHVzZWQgdG8gZGVjb3JhdGUgYSBtZXRob2QuXG4gKi9cbmV4cG9ydCBjb25zdCBHZXQgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIkdFVFwiKTtcblxuLyoqXG4gKiBEZWNvcmF0b3IgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgUE9TVCByb3V0ZS5cbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggZm9yIHRoZSByb3V0ZS5cbiAqL1xuZXhwb3J0IGNvbnN0IFBvc3QgPSBjcmVhdGVSb3V0ZURlY29yYXRvcihcIlBPU1RcIik7XG5cbi8qKlxuICogRGVjb3JhdG9yIGZ1bmN0aW9uIGZvciBkZWZpbmluZyBhIFBVVCByb3V0ZS5cbiAqIEBwYXJhbSB0YXJnZXQgVGhlIHRhcmdldCBvYmplY3QuXG4gKiBAcGFyYW0gcHJvcGVydHlLZXkgVGhlIG5hbWUgb2YgdGhlIHByb3BlcnR5IGJlaW5nIGRlY29yYXRlZC5cbiAqIEBwYXJhbSBkZXNjcmlwdG9yIFRoZSBwcm9wZXJ0eSBkZXNjcmlwdG9yLlxuICovXG5leHBvcnQgY29uc3QgUHV0ID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJQVVRcIik7XG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgZGVmaW5pbmcgYSBERUxFVEUgcm91dGUuXG4gKiBcbiAqIEBwYXJhbSBwYXRoIC0gVGhlIHBhdGggb2YgdGhlIHJvdXRlLlxuICogQHJldHVybnMgQSBkZWNvcmF0b3IgZnVuY3Rpb24gdGhhdCBjYW4gYmUgdXNlZCB0byBkZWNvcmF0ZSBhIG1ldGhvZCBhcyBhIERFTEVURSByb3V0ZS5cbiAqL1xuZXhwb3J0IGNvbnN0IERlbGV0ZSA9IGNyZWF0ZVJvdXRlRGVjb3JhdG9yKFwiREVMRVRFXCIpO1xuXG4vKipcbiAqIERlY29yYXRvciBmdW5jdGlvbiBmb3IgUEFUQ0ggcm91dGVzLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkuXG4gKiBAcGFyYW0gZGVzY3JpcHRvciBUaGUgcHJvcGVydHkgZGVzY3JpcHRvci5cbiAqL1xuZXhwb3J0IGNvbnN0IFBhdGNoID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJQQVRDSFwiKTtcbi8qKlxuICogUmVwcmVzZW50cyBhIGRlY29yYXRvciB0aGF0IGNyZWF0ZXMgYSByb3V0ZSBkZWNvcmF0b3Igd2l0aCB0aGUgc3BlY2lmaWVkIEhUVFAgbWV0aG9kIFwiT1BUSU9OU1wiLlxuICogQHBhcmFtIHRhcmdldCBUaGUgdGFyZ2V0IG9iamVjdC5cbiAqIEBwYXJhbSBwcm9wZXJ0eUtleSBUaGUgcHJvcGVydHkga2V5LlxuICogQHBhcmFtIGRlc2NyaXB0b3IgVGhlIHByb3BlcnR5IGRlc2NyaXB0b3IuXG4gKi9cbmV4cG9ydCBjb25zdCBPcHRpb25zID0gY3JlYXRlUm91dGVEZWNvcmF0b3IoXCJPUFRJT05TXCIpO1xuXG5leHBvcnQgdHlwZSBSb3V0ZU1ldGhvZHMgPSB0eXBlb2YgT3B0aW9ucyB8IHR5cGVvZiBQYXRjaCB8IHR5cGVvZiBEZWxldGUgfCB0eXBlb2YgUHV0IHwgdHlwZW9mIFBvc3QgfCB0eXBlb2YgR2V0OyJdfQ==