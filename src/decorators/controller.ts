
import type { ILambdaEnvConfig } from "../interfaces/lambda-env";
import type { AuthorizerTypeMetadata } from "./authorizer";
import type { CommonLambdaHandlerOptions } from "./decorator-utils";
import { resolveAndExportHandler, setupDI, tryImportingEntryPackagesFor } from "./decorator-utils";

/**
 * Represents the configuration options for a controller.
 */
export type IControllerConfig = CommonLambdaHandlerOptions & {
	/**
	 * Specifies the authorizer for the controller.
	 * It can be an array of authorizer objects, a single authorizer object, or a string.
	 */
	authorizer?:
		| Array<AuthorizerTypeMetadata>
		| AuthorizerTypeMetadata
		| string;

	/**
	 * Specifies the environment configurations for the controller.
	 */
	env?: Array<ILambdaEnvConfig>;

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
		tryImportingEntryPackagesFor();

		// Default autoExportLambdaHandler to true if undefined
		controllerConfig.autoExportLambdaHandler = controllerConfig.autoExportLambdaHandler ?? true;

		// Create an extended class that includes additional setup
		class ExtendedTarget extends target {
			constructor(...args: any[]) {
				super(...args);

				// Set the controller name
				Reflect.set(this, 'controllerName', controllerName.toLowerCase());

				// Initialize the default controller config
				const defaultConfig: IControllerConfig = {
					env: []
				};

				// Set the controller config
				Reflect.set(this, 'controllerConfig', { ...defaultConfig, ...controllerConfig });
			}
		}

		// Preserve the original class name
		Object.defineProperty(ExtendedTarget, 'name', { value: target.name });

		const container = setupDI({
			target: ExtendedTarget,
			module: controllerConfig.module || {},
			fallbackToRootContainer: controllerConfig.autoExportLambdaHandler
		});
		
		if (controllerConfig.autoExportLambdaHandler) {
			resolveAndExportHandler(ExtendedTarget, container);
		}

		return ExtendedTarget;
	};
}