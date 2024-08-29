import { RegisterDIModuleMetadataOptions, registerModuleMetadata } from ".";
import { DIContainer } from "../di-container";
import { ClassConstructor, IDIContainer } from "../../interfaces/di";
import { tryGetModuleDIContainer } from "./tryGetModuleDIContainer";

/**
 * Sets up Dependency Injection (DI) for a class and returns the DI container.
 *
 * @param target - The class for which DI is being set up.
 * @param options - DI options including the container and module configurations.
 * @param fallbackToRootContainer - Whether to use the default DIContainer.ROOT if resolvingContainer is not specified in di options.
 * @returns The DI container used for the setup.
 */
export function setupDIModule<T>(
	options: {
		target: ClassConstructor<T>,
		module: RegisterDIModuleMetadataOptions,
		fallbackToRootContainer?: boolean
	},
): IDIContainer | undefined {

	const { target, module } = options;

	module.providedBy = module.providedBy || (options.fallbackToRootContainer ? DIContainer.ROOT : undefined);
	
	let resolvingContainer: IDIContainer | undefined;

	if(typeof module.providedBy === 'function' ){

		resolvingContainer = tryGetModuleDIContainer(module.providedBy);

	} else if(module.providedBy instanceof DIContainer){

		resolvingContainer = module.providedBy;

	} else if(module.providedBy === 'ROOT'){

		resolvingContainer = DIContainer.ROOT;
	}

    if (module.providers || module.exports || module.imports) {
		
		if(!resolvingContainer){
			throw new Error(`Invalid 'providedBy' option for ${target.name}. Ensure it is either "ROOT" or an instance of DI container or a Module.`);
		}

		registerModuleMetadata(target, options.module);
		
		// register the module in the resolving container and use the module's container for resolving the controller instance
		resolvingContainer = resolvingContainer.module(target).container;
    }
    
    if (resolvingContainer) {
        // register the controller itself as a provider 
        resolvingContainer.register({ provide: target, useClass: target, tags: ['_internal_'], type: 'module' });
    }

    return resolvingContainer;
}