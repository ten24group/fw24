import { ILambdaEnvConfig } from "../interfaces/lambda-env";

export interface IControllerConfig {
	tableName?: string;
	authorizer?: Array<{ 
		type: string;
		name?: string;
		methods?: string[];
		groups?: string[];
		default?: boolean;
		requireRouteInGroupConfig?: boolean;
	}> | { 
		type: string;
		name?: string;
		methods?: string[];
		groups?: string[];
		default?: boolean
		requireRouteInGroupConfig?: boolean;
	} | string;
	buckets?: Array<{ 
		name: string;
		access?: string; // read, write, readwrite | default is readwrite
	}>;
	topics? : Array<{
		name: string;
		actions: string[]; // publish, subscribe, unsubscribe
	}>;
	queues?: Array<{
		name: string;
		actions: string[]; // send, receive, delete
	}>;
	env?: Array<ILambdaEnvConfig>;
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
					env: []
				};
				
				// set the controller config
				Reflect.set(this, 'controllerConfig', { ...defaultConfig, ...controllerConfig});
			}
		};
	};
}
