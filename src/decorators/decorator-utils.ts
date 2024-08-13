import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { IFunctionResourceAccess } from "../constructs/lambda-function";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";

import type { ClassConstructor } from "../di/types";
import type { RegisterDIModuleMetadataOptions } from "../di/utils";

import { AbstractLambdaHandler } from "../core/runtime/abstract-lambda-handler";
import { DIContainer } from "../di";
import { registerModuleMetadata } from "../di/utils";
import { DefaultLogger } from "../logging";

export type CommonLambdaHandlerOptions = {

	/**
	 * Defines the resources that the controller needs access to.
	 */
	resourceAccess?: IFunctionResourceAccess;

	/**
	 * Specifies the timeout for the controller function in seconds.
	 * * Use this timeout to avoid importing the duration class from aws-cdk-lib.
	 */
	functionTimeout?: number;

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
	 * Specifies the parent DI-container or to register this module in or auto-resolve the container instance from.
	 * you don't need to specify this unless you are creating a separate container and want to use that container as the parent of this controller/module.
	 * @default: DIContainer.ROOT
	 */
	providedBy ?: DIContainer | 'ROOT';
	
	/**
	 * Specifies the DI-module options for the controller.
	 * Under the hood this will create a dedicated module and container for this controller; you can use this option to shadow the providers and configs available in the parent scopes.
	 */
	module?: RegisterDIModuleMetadataOptions
}

export function trySettingUpEntryPackage(controllerName: string) {
	const entryPackageName = process.env['entryPackageName']; // TODO: key should be a constant and available for the users

	if(entryPackageName){
		DefaultLogger.info(`Controller ${controllerName} is configured to import entry-package: ${entryPackageName}`);
		try {
			const entry = require(entryPackageName);
			DefaultLogger.info(`Controller ${controllerName} imported entry-package: ${entryPackageName}`, entry);
		} catch (error) {
			console.error(`Controller ${controllerName} failed to import entry-package: ${entryPackageName}`, error);
		}
	} else {
		DefaultLogger.info(`Controller ${controllerName} is not configured to import any entry-package`);
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
    target: ClassConstructor<T>,
    options: {
		module?: RegisterDIModuleMetadataOptions,
		providedBy?: DIContainer | 'ROOT',
	},
    fallbackToRootContainer: boolean = false
): DIContainer | undefined {

    options.providedBy = options.providedBy || (fallbackToRootContainer ? DIContainer.ROOT : undefined);

	let resolvingContainer: DIContainer | undefined;

	if(options.providedBy instanceof DIContainer){

		resolvingContainer = options.providedBy;

	} else if(options.providedBy === 'ROOT'){

		resolvingContainer = DIContainer.ROOT;
	}

    if (options.module) {
		
		if(!resolvingContainer){
			throw new Error(`Invalid 'providedBy' option for ${target.name}. Ensure it is either "ROOT" or an instance of DI container or a Module.`);
		}

		registerModuleMetadata(target, options.module);
		// register the module in the resolving container and use the module's container for resolving the controller instance
		resolvingContainer = resolvingContainer.module(target).container;
    }
    
    if (resolvingContainer) {
        // register the controller itself as a provider 
        resolvingContainer.register({ provide: target, useClass: target, tags: ['_internal_'] });
    }

    return resolvingContainer;
}

export function resolveHandler(target: string, container?: DIContainer) {
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

export function resolveAndExportHandler(target: Function, container?: DIContainer ) {
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
            console.warn(`Handler '${handlerName}' already exists in calling module: ${callingModule.filename}`);
        }
    } else {
        console.warn('Could not find calling module');
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