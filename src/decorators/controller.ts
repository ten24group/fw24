
export interface IControllerConfig {
	tableName?: string;
	authorizers?: IAuthorizerConfig[];
	env?: ILambdaEnvConfig[];
	queue?: IControllerSQSConfig[];
}
export interface IAuthorizerConfig {
	type: string;
	methods?: string[];
	default?: boolean;
}
export interface ILambdaEnvConfig {
	name: string;
	path: string;
}
export interface IControllerSQSConfig {
	name: string;
	path: string;
}

export function Controller(controllerName: string, controllerConfig?: IControllerConfig) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		return class extends target {
			constructor(...args: any[]) {
				super(...args);
				Reflect.set(this, 'controllerName', controllerName);
				Reflect.set(this, 'controllerConfig', controllerConfig);
			}
		};
	};
}
