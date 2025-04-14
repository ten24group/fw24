import type { Route } from "../interfaces/route";
import { findConstructor, getRoutesKey } from "./decorator-utils";

export type AuthorizerTypeMetadata = { 
  type?: string; 
  name?: string; 
  groups?: string[] | string; 
  requireRouteInGroupConfig?: boolean 
};

/**
 * Specifies the authorizer for the API-route, it can be a single authorizer-type-metadata-object, or a authorizer-type-name. 
 * @param authorizationType - The authorization type for the route.
 * @returns A decorator function that sets the authorization type for the route.
 */
export const Authorizer = (authorizationType: AuthorizerTypeMetadata | string) => {
    return function (target: any, methodToDecorate: any) {
      // Get the constructor from the prototype chain
      const constructor = findConstructor(target, methodToDecorate);
      const routesKey = getRoutesKey(constructor);
            
      // Get existing routes or initialize empty object
      const routes: Record<string, Route> = Reflect.get(constructor, routesKey) || {};
      
      // Find the route for this method
      const route = (Object.values(routes) as Route[]).find(
        (route) => route.functionName === methodToDecorate
      );
      
      if (!route) {
        throw new Error("Route not found, try to add the decorator above the @Get, @Post, @Put, @Delete or @Patch decorator.");
      }
      
      route.authorizer = authorizationType;
    };
  }