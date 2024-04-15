import { Route } from "../interfaces/route";
import { HttpRequestValidations, ValidationRules } from "../validation";

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

function createRouteDecorator(method: string) {
  return (
    route: string,
    options ?: {
      authorizer?: string,
      validations?: ValidationRules | HttpRequestValidations
    } 
  ) =>
    (target: any, methodToDecorate: any) => {

      const routes: Record<string, Route> = Reflect.get(target, "routes") || {};

      if (route && !route.startsWith("/")) {
        route = `/${route}`;
      }

      var parameters: Array<String> = [];

      route.split('/').forEach((param) => {
        if(param.startsWith('{') && param.endsWith('}')){
          parameters.push(param.slice(1, -1));
        }
      });

      routes[`${method}|${route}`] = {
        path: route,
        httpMethod: method,
        functionName: methodToDecorate.name || methodToDecorate,
        parameters: parameters,
        authorizer: options?.authorizer || Reflect.get(target, "authorizer") || "NONE",
        validations: options?.validations,
      };

      Reflect.set(target, "routes", routes);
      //InjectParams(target, methodToDecorate, descriptor);
    };
}

export const Get = createRouteDecorator("GET");
export const Post = createRouteDecorator("POST");
export const Put = createRouteDecorator("PUT");
export const Delete = createRouteDecorator("DELETE");
export const Patch = createRouteDecorator("PATCH");
export const Options = createRouteDecorator("OPTIONS");
