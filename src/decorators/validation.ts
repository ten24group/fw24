import { Route } from "../interfaces/route";
import { InputValidationRule, HttpRequestValidations } from "../validation";

/**
 * Decorator function for adding validations to a route.
 * @param validations - The validations to be applied to the route.
 * @returns A decorator function that adds the validations to the route.
 */
export const Validation = (validations: InputValidationRule | HttpRequestValidations) => {
    return function (target: any, methodToDecorate: any) {
      
      const routes: Record<string, Route> = Reflect.get(target, "routes") || {};
      
      const route = Object.values(routes).find(
        (route) => route.functionName === methodToDecorate
      );

      if (!route) {
        throw new Error("Route not found, try to add the decorator above the @Get, @Post, @Put, @Delete or @Patch decorator.");
      }
      
      route.validations = validations;
    };
  }