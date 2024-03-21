
export interface Route {
  httpMethod: string;
  functionName: string;
  path: string;
  parameters: Array<String>;
  authorizer: string
}

export type Routes = Route[];
