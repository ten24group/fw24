import { AuthorizationType } from "../types/autorization-type";

export interface IControllerConfig {
	tableName?: string;
	authorizationType?: AuthorizationType;
	env?: ILambdaEnvConfig[];
}
export interface ILambdaEnvConfig {
	name: string;
	prefix?: string;
}

export function Controller(controllerName: string, controllerConfig?: IControllerConfig) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		return class extends target {
			constructor(...args: any[]) {
				super(...args);
				// set the controller name
				Reflect.set(this, 'controllerName', controllerName);

				// initialize the default controller config
				const defaultConfig: IControllerConfig = {
					authorizationType: AuthorizationType.NONE,
					env: []
				};
				// set the controller config
				Reflect.set(this, 'controllerConfig', { ...defaultConfig, ...controllerConfig });
			}
		};
	};
}
