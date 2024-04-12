import { HttpRequestValidation, ValidationRules } from "../validation";

export interface Route {
  httpMethod: string;
  functionName: string;
  path: string;
  parameters: Array<String>;
  authorizer: string,
  validations ?: ValidationRules | HttpRequestValidation
}

export type Routes = Route[];
