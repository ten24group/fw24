import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { IFunctionResourceAccess } from "../constructs/lambda-function";
import { RemovalPolicy } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { AuthorizerTypeMetadata } from "./authorizer";
import { DIContainer } from "../di";
import { APIController } from "../core/api-gateway-controller";

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

	/**
	 * Specifies whether to auto-generate the lambda handler.
	 * @default true
	 * if set to false, the handler will not be exported into the module.exports of the decorated-class's module
	 * this is useful when you want to manually export the handler in a different way
	 * e.g.
	 * ```ts
	 *  @Controller('abc', { autoExportLambdaHandler: false })
	 *  class MyController extends APIController {
	 * 
	 *  }
	 * 	export const handler: Handler = MyController.CreateHandler(MyController);
	 * ```
	 */
	autoExportLambdaHandler?: boolean;
}

function getCallingModule(): NodeModule | undefined {
	const originalPrepareStackTrace = Error.prepareStackTrace;

	Error.prepareStackTrace = (_, stack) => stack;
	const stack = new Error().stack as any;
	Error.prepareStackTrace = originalPrepareStackTrace;

	if (stack && stack.length > 2) {
		const caller = stack[2];
		const callerFile = caller.getFileName();
		return require.cache[callerFile];
	}

	return undefined;
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

	if(controllerConfig.autoExportLambdaHandler === undefined) {
		controllerConfig.autoExportLambdaHandler = true;
	}

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

    // Register the extended class in the DI container
    DIContainer.ROOT.register({ provide: target, useClass: ExtendedTarget });

	if(controllerConfig.autoExportLambdaHandler) {
		// Resolve the handler from the DI container and export it dynamically
		const handler = DIContainer.ROOT.resolve<APIController>(target.name)?.LambdaHandler as any;
	
		if (handler) {
			// Find the calling module and modify its exports
			const callingModule = getCallingModule();
			
			if (callingModule && callingModule.exports) {
				if(!callingModule.exports.hasOwnProperty('handler')) {
					callingModule.exports['handler'] = handler;
				} else {
					console.warn(`handler already exists in calling module: ${callingModule.filename}`);
				}
			} else {
				console.warn('Could not find calling module');
			}
		}
	}

    return ExtendedTarget;
  };
}