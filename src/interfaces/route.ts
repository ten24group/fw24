import { AuthorizationType } from "../types/autorization-type";

export interface Route {
  httpMethod: string;
  functionName: string;
  path: string;
  parameters: Array<String>;
  authorizationType: AuthorizationType
}

export type Routes = Route[];
