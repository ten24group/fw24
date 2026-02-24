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

// Track if entry packages have been loaded (prevent duplicate loading)
let entryPackagesLoaded = false;

/**
 * Global lock key for cross-instance coordination.
 * Shared across ALL fw24 instances (bundled + layer) via Node.js global object.
 */
const GLOBAL_LOCK_KEY = '__fw24_entry_packages_loading__';
const GLOBAL_LOADED_KEY = '__fw24_entry_packages_loaded__';

/**
 * Loads entry packages specified in ENTRY_PACKAGES environment variable.
 * Called automatically by fw24 layer on import, and by decorators for backward compatibility.
 * Safe to call multiple times - only loads once.
 *
 * Uses global locking to prevent race conditions when multiple fw24 instances
 * (bundled in Lambda + layer) try to load entry packages simultaneously.
 */
export function tryImportingEntryPackagesFor(controllerName = getCallingModule(3)?.path) {
	// Check if another fw24 instance is currently loading
	if ((global as any)[ GLOBAL_LOCK_KEY ]) {
		DefaultLogger.debug("Entry packages currently loading by another fw24 instance, skipping", { controllerName });
		return;
	}

	// Check if already loaded (global check across all instances)
	if ((global as any)[ GLOBAL_LOADED_KEY ] || entryPackagesLoaded) {
		DefaultLogger.debug("Entry packages already loaded, skipping", { controllerName });
		return;
	}

	// Acquire global lock and mark as loaded
	(global as any)[ GLOBAL_LOCK_KEY ] = true;
	(global as any)[ GLOBAL_LOADED_KEY ] = true;
	entryPackagesLoaded = true;

	try {
		DefaultLogger.debug("Loading entry packages", { controllerName });
		const entryPackageNames = resolveEnvValueFor({ key: ENV_KEYS.ENTRY_PACKAGES });

		if (!entryPackageNames) {
			DefaultLogger.debug("No ENTRY_PACKAGES environment variable found");
			return;
		}

		const packageNamesArray = entryPackageNames.split(',').map((pkg: string) => pkg.trim()).filter(Boolean);

		packageNamesArray.forEach((entryPackageName: string) => {
			try {
				DefaultLogger.debug("Loading entry package", { entryPackageName });
				const entry = require(entryPackageName);
				// Call the default export if available
				if (entry.default && typeof entry.default === 'function') {
					entry.default();
				}
				DefaultLogger.debug(`Successfully loaded entry package: ${entryPackageName}`);
			} catch (error) {
				DefaultLogger.warn(`Failed to load entry package: ${entryPackageName}`, error);
			}
		});
	} catch (e) {
		DefaultLogger.error(`Error loading entry packages`, e);
	} finally {
		// Always release the lock, even if loading fails
		(global as any)[ GLOBAL_LOCK_KEY ] = false;
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
export function setupDIModuleForController<T>(
	options: {
		target: ClassConstructor<T>,
		module: RegisterDIModuleMetadataOptions,
		fallbackToRootContainer?: boolean
	},
): IDIContainer | undefined {
	return setupDIModule(options);
}

export function resolveHandler(target: string, container?: IDIContainer) {
	if (!container) {
		throw new Error(`Could not setup DI for controller: ${target}. make sure DI is setup correctly`);
	}

	const instance = container.resolve<AbstractLambdaHandler>(target, { tags: [ '_internal_' ] });

	if (!instance) {
		throw new Error(`Could not resolve controller: ${target}. make sure DI is setup correctly`);
	}

	const handler = instance.LambdaHandler;

	if (!handler) {
		throw new Error(`Could not find LambdaHandler in controller: ${target}. make sure it extends 'AbstractLambdaHandler'`);
	}

	return handler;
}

export function resolveAndExportHandler(target: Function, container?: IDIContainer) {
	const handler = resolveHandler(target.name, container);
	exportHandler(handler, 'handler', getCallingModule(4)); // export into the `modules` of the file where the `decorator` is used.
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
			callingModule.exports[ handlerName ] = handler;
		} else {
			DefaultLogger.debug(`exportHandler: Handler '${handlerName}' already exists in calling module: ${callingModule.filename}`);
		}
	} else {
		DefaultLogger.debug('exportHandler: Could not find calling module');
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

	if (stack.length < nthModuleInStack) {
		throw new Error(`Could not find calling module at index: ${nthModuleInStack}`);
	}

	if (stack && stack.length > nthModuleInStack) {
		const caller = stack[ nthModuleInStack ];
		const callerFile = caller.getFileName();
		return require.cache[ callerFile ];
	}

	return undefined;
}

/**
 * Utility function to find the constructor of a class from a method decorator target.
 * This ensures consistent constructor access across all decorators.
 * 
 * @param target - The target object from the decorator
 * @param methodToDecorate - The method being decorated
 * @returns The constructor of the class or undefined if not found
 */
export function findConstructor(target: any, methodToDecorate: any): any {
	// Approach 1: Direct access
	if (target && target.constructor) {
		return target.constructor;
	}
	// Approach 2: From prototype
	else if (target && Object.getPrototypeOf(target) && Object.getPrototypeOf(target).constructor) {
		return Object.getPrototypeOf(target).constructor;
	}
	// Approach 3: From the method itself
	else if (methodToDecorate && methodToDecorate.constructor) {
		return methodToDecorate.constructor;
	}
	// Approach 4: Last resort - use the target itself if it's a constructor
	else if (target && typeof target === 'function') {
		return target;
	}

	return undefined;
}

/**
 * Utility function to get a unique symbol for a class's routes.
 * This ensures consistent route storage across all decorators.
 * 
 * @param constructor - The constructor of the class
 * @returns A unique symbol for the class's routes
 */
export function getRoutesKey(constructor: any): symbol {
	// Use a combination of constructor name and a unique identifier to ensure
	// each class gets its own unique symbol, even when inheritance is involved
	const uniqueId = constructor.toString().split('\n')[ 0 ].trim();
	return Symbol.for(`routes_${uniqueId}`);
}
