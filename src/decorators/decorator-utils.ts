import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { IFunctionResourceAccess, TImportedPolicy, TPolicyStatementOrProps } from "../constructs/lambda-function";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";

import type { ClassConstructor, IDIContainer } from "../interfaces/di";
import type { RegisterDIModuleMetadataOptions } from "../di/metadata";

import { AbstractLambdaHandler } from "../core/runtime/abstract-lambda-handler";
import { setupDIModule } from "../di/utils/setupDIModule";
import { DefaultLogger } from "../logging";
import { ENV_KEYS } from "../const";
import { resolveEnvValueFor } from "../utils/env";

export type CommonLambdaHandlerOptions = {

	/**
	 * Defines the resources that the controller needs access to.
	 */
	resourceAccess?: IFunctionResourceAccess;

	/**
	 * The policies to attach to the Lambda function's execution role.
	 */
	policies?: Array<TPolicyStatementOrProps | TImportedPolicy>;

	/**
	 * Specifies the timeout for the controller function in seconds.
	 * * Use this timeout to avoid importing the duration class from aws-cdk-lib.
	 */
	functionTimeout?: number;

	processorArchitecture?: 'x86_64' | 'arm_64';

	/**
	 * Specifies additional properties for the controller function.
	 */
	functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
		readonly layers?: Array<ILayerVersion | string>;
	}

	/**
	 * Specifies the number of days to retain the controller function's logs.
	 */
	logRetentionDays?: RetentionDays;

	/**
	 * Specifies the removal policy for the controller function's logs.
	 */
	logRemovalPolicy?: RemovalPolicy;

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

	/**
	 * Specifies the entry packages to import before initializing the lambda.
	 * This is useful when you want to import packages to do some initial setup [like warming up DI container] before executing the handler.
	 */
	entryPackages?: string[] | {
		override: boolean;
		packageNames: string[];
	};
	
	/**
	 * Specifies the DI-module options for the controller.
	 * Under the hood this will create a dedicated module and container for this controller; you can use this option to shadow the providers and configs available in the parent scopes.
	 */
	module?: RegisterDIModuleMetadataOptions
}

export function tryImportingEntryPackagesFor(controllerName = getCallingModule(3)?.path ) {

  try {
		const entryPackageNames = resolveEnvValueFor({key: ENV_KEYS.ENTRY_PACKAGES});

		if (!entryPackageNames) {
			return;
		}

		const packageNamesArray = entryPackageNames.split(',').map(pkg => pkg.trim()); // Split and trim package names

		packageNamesArray.forEach((entryPackageName) => {
			try {
				DefaultLogger.info("trying to import entry", {entryPackageName});
				const entry = require(entryPackageName);
				// call the default export if available
				entry.default && typeof entry.default === 'function' && entry.default(); 
				DefaultLogger.info(`Controller[${controllerName}]: successfully imported entry-package: ${entryPackageName}`);
			} catch (error) {
				DefaultLogger.error(`Controller[${controllerName}]: failed to import entry-package: ${entryPackageName}`, error);
			}
		});
	} catch(e){
		DefaultLogger.error(`Controller[${controllerName}]: Error importing entry packages in controller.ts`, e);
	}
}

/**
 * Sets up Dependency Injection (DI) for a class and returns the DI container.
 *
 * @param target - The class for which DI is being set up.
 * @param options - DI options including the container and module configurations.
 * @param fallbackToRootContainer - Whether to use the default DIContainer.ROOT if resolvingContainer is not specified in di options.
 * @returns The DI container used for the setup.
 */
export function setupDI<T>(
	options: {
		target: ClassConstructor<T>,
		module: RegisterDIModuleMetadataOptions,
		fallbackToRootContainer?: boolean
	},
): IDIContainer | undefined {
	return setupDIModule(options);
}

export function resolveHandler(target: string, container?: IDIContainer) {
    if(!container){
        throw new Error(`Could not setup DI for controller: ${target}. make sure DI is setup correctly`);
    }

    const instance = container.resolve<AbstractLambdaHandler>(target, { tags: ['_internal_'] });

    if(!instance){
        throw new Error(`Could not resolve controller: ${target}. make sure DI is setup correctly`);
    }

    const handler = instance.LambdaHandler;

    if(!handler){
        throw new Error(`Could not find LambdaHandler in controller: ${target}. make sure it extends 'AbstractLambdaHandler'`);
    }

    return handler;
}

export function resolveAndExportHandler(target: Function, container?: IDIContainer ) {
    const handler = resolveHandler(target.name, container);
    exportHandler(handler, 'handler', getCallingModule(4)); // export into the modules of the file the decorator is used in
}

/**
 * Exports a Lambda handler from the calling module.
 *
 * @param handler - The handler function to export.
 * @param handlerName - The name under which to export the handler.
 */
export function exportHandler(handler: any, handlerName: string = 'handler', callingModule = getCallingModule()): void {

    if (callingModule && callingModule.exports) {
        if (!callingModule.exports.hasOwnProperty(handlerName)) {
            callingModule.exports[handlerName] = handler;
        } else {
            DefaultLogger.warn(`exportHandler: Handler '${handlerName}' already exists in calling module: ${callingModule.filename}`);
        }
    } else {
        DefaultLogger.warn('exportHandler: Could not find calling module');
    }
}

/**
 * Gets the module that called the current function.
 * 
 * @param nthModuleInStack - The index of the module in the stack to return.
 *
 * @returns The nth NodeModule from which the current function was called.
 */
export function getCallingModule(nthModuleInStack: number = 3): NodeModule | undefined {
    const originalPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = new Error().stack as any;
    Error.prepareStackTrace = originalPrepareStackTrace;

    if(stack.length < nthModuleInStack){
        throw new Error(`Could not find calling module at index: ${nthModuleInStack}`);
    }
    
    if (stack && stack.length > nthModuleInStack) {
        const caller = stack[nthModuleInStack];
        const callerFile = caller.getFileName();
        return require.cache[callerFile];
    }

    return undefined;
}