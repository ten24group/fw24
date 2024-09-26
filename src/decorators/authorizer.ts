import type { Route } from "../interfaces/route";

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
      const routes: Record<string, Route> = Reflect.get(target, "routes") || {};
      const route = Object.values(routes).find(
        (route) => route.functionName === methodToDecorate
      );
      if (!route) {
        throw new Error("Route not found, try to add the decorator above the @Get, @Post, @Put, @Delete or @Patch decorator.");
      }
      route.authorizer = authorizationType;
    };
  }