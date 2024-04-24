import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { IFunctionResourceAccess } from "../constructs/lambda-function";

export interface IControllerConfig {
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
	// define the resources that the controller need access to
	resourceAccess?: IFunctionResourceAccess;
	env?: Array<ILambdaEnvConfig>;
	functionProps?: NodejsFunctionProps
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
