import { ILambdaEnvConfig } from "../interfaces/lambda-env";

export interface IControllerConfig {
	tableName?: string;
	authorizer?: { 
		name: string;
		type: string;
	} | string;
	buckets?: [
		{ 
			name: string;
			access?: string; // read, write, readwrite | default is readwrite
		}
	];
	env?: ILambdaEnvConfig[];
}

export function Controller(controllerName: string, controllerConfig: IControllerConfig = {}) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		return class extends target {
			constructor(...args: any[]) {
				super(...args);
				// set the controller name
				Reflect.set(this, 'controllerName', controllerName);

				// initialize the default controller config
				const defaultConfig: IControllerConfig = {
					authorizer: 'NONE',
					env: []
				};
				
				// set the controller config
				Reflect.set(this, 'controllerConfig', { ...defaultConfig, ...controllerConfig});
			}
		};
	};
}
