import 'reflect-metadata';
import type { Route } from "../interfaces/route";
import type { HttpRequestValidations, InputValidationRule } from "../validation";
import { findConstructor, getRoutesKey } from "./decorator-utils";
import { METADATA_KEYS, type RouteMetadata } from '../manifest/metadata-keys';
import type { AuthorizerTypeMetadata } from './authorizer';

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
function createRouteDecorator(method: string) {
  return (
    route: string,
    options?: {
      validations?: InputValidationRule | HttpRequestValidations,
      /**
       * Specifies the target for the API
       * Values can be "queue" or "topic"
       * @default "function"
       */
      target?: 'function' | 'queue' | 'topic';
      /**
       * Specifies the authorizer for this route
       */
      authorizer?: AuthorizerTypeMetadata | string;
    }
  ) =>
    (target: any, methodToDecorate: any) => {
      // Get the constructor using the utility function
      const constructor = findConstructor(target, methodToDecorate);
      
      // If we still don't have a constructor, log an error and return
      if (!constructor) {
        console.error('Could not determine constructor for route decorator');
        return;
      }
      
      // Get the routes key using the utility function
      const routesKey = getRoutesKey(constructor);
      
      // Get existing routes or initialize empty object
      let routes: Record<string, Route> = Reflect.get(constructor, routesKey) || {};

      // If this is a derived class, we need to merge routes from the parent class
      let currentProto = constructor.prototype;
      while (currentProto && currentProto.__proto__ && currentProto.__proto__.constructor !== Object) {
        const parentConstructor = currentProto.__proto__.constructor;
        const parentRoutesKey = getRoutesKey(parentConstructor);
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

      const parameters: Array<String> = [];

      route.split('/').forEach((param) => {
        if (param.startsWith('{') && param.endsWith('}')) {
          parameters.push(param.slice(1, -1));
        }
      });

      const normalizedPath = route.endsWith('/') ? route.slice(0,-1) : route;
      
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
      const routeMetadata: RouteMetadata = {
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
      Reflect.defineMetadata(METADATA_KEYS.ROUTE, routeMetadata, target, methodToDecorate.name);

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
export const Get = createRouteDecorator("GET");

/**
 * Decorator function for creating a POST route.
 * @param path - The path for the route.
 */
export const Post = createRouteDecorator("POST");

/**
 * Decorator function for defining a PUT route.
 * @param target The target object.
 * @param propertyKey The name of the property being decorated.
 * @param descriptor The property descriptor.
 */
export const Put = createRouteDecorator("PUT");
/**
 * Decorator function for defining a DELETE route.
 * 
 * @param path - The path of the route.
 * @returns A decorator function that can be used to decorate a method as a DELETE route.
 */
export const Delete = createRouteDecorator("DELETE");

/**
 * Decorator function for PATCH routes.
 * @param target The target object.
 * @param propertyKey The name of the property.
 * @param descriptor The property descriptor.
 */
export const Patch = createRouteDecorator("PATCH");
/**
 * Represents a decorator that creates a route decorator with the specified HTTP method "OPTIONS".
 * @param target The target object.
 * @param propertyKey The property key.
 * @param descriptor The property descriptor.
 */
export const Options = createRouteDecorator("OPTIONS");

export type RouteMethods = typeof Options | typeof Patch | typeof Delete | typeof Put | typeof Post | typeof Get;