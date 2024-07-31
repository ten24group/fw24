import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { RemovalPolicy } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { AuthorizerTypeMetadata } from "./authorizer";
import { DIContainer } from "../di";

/**
 * Represents the configuration options for a controller.
 */
export interface IControllerConfig {
	/**
	 * Specifies the authorizer for the controller.
	 * It can be an array of authorizer objects, a single authorizer object, or a string.
	 */
	authorizer?:
		| Array<AuthorizerTypeMetadata>
		| AuthorizerTypeMetadata
		| string;

	/**
	 * Defines the resources that the controller needs access to.
	 */
	resourceAccess?: IFunctionResourceAccess;

	/**
	 * Specifies the environment configurations for the controller.
	 */
	env?: Array<ILambdaEnvConfig>;

	/**
	 * Specifies the timeout for the controller function in seconds.
	 * Use this timeout to avoid importing the duration class from aws-cdk-lib.
	 */
	functionTimeout?: number;

	/**
	 * Specifies additional properties for the controller function.
	 */
	functionProps?: NodejsFunctionProps;

	/**
	 * Specifies the number of days to retain the controller function's logs.
	 */
	logRetentionDays?: RetentionDays;

	/**
	 * Specifies the removal policy for the controller function's logs.
	 */
	logRemovalPolicy?: RemovalPolicy;

	/**
     * Specifies the target for the API
     * Values can be "function", "queue" or "topic"
     * @default "function"
     */
    target?: string;
}

/**
 * Decorator function for defining a controller.
 * 
 * @param controllerName - The name of the controller.
 * @param controllerConfig - Optional configuration for the controller.
 * @returns A class decorator function.
 */
export function Controller(controllerName: string, controllerConfig: IControllerConfig = {}) {
	return function <T extends { new (...args: any[]): {} }>(target: T) {
		
		class ExtendedTarget extends target {
			constructor(...args: any[]) {
				super(...args);
				// set the controller name
				Reflect.set(this, 'controllerName', controllerName.toLowerCase());

				// initialize the default controller config
				const defaultConfig: IControllerConfig = {
					env: []
				};
				
				// set the controller config
				Reflect.set(this, 'controllerConfig', { ...defaultConfig, ...controllerConfig});
			}
		};

		Object.defineProperty(ExtendedTarget, 'name', { value: target.name });
		DIContainer.ROOT.register({ singleton: true, provide: target.name, useClass: ExtendedTarget });

		return ExtendedTarget;
	};
}
