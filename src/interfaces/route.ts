import type { HttpRequestValidations, InputValidationRule } from "../validation";

export interface Route {
  httpMethod: string;
  functionName: string;
  path: string;
  parameters: Array<String>;
  authorizer?: { 
		name?: string;
		type?: string;
    groups?: string[] | string;
	} | string;
  validations ?: InputValidationRule | HttpRequestValidations;
  target?: string;
}

export type Routes = Route[];
