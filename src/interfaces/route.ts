export interface Route {
  httpMethod: string;
  functionName: string;
  path: string;
  parameters: Array<String>;
}

export type Routes = Route[];
