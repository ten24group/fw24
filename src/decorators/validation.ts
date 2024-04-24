import { Route } from "../interfaces/route";
import { InputValidationRule, HttpRequestValidations } from "../validation";

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