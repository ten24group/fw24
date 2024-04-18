
export interface Route {
  httpMethod: string;
  functionName: string;
  path: string;
  parameters: Array<String>;
  authorizer?: { 
		name?: string;
		type?: string;
    groups?: string[];
	} | string;
}

export type Routes = Route[];
