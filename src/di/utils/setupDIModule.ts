import { getModuleMetadata, RegisterDIModuleMetadataOptions, registerModuleMetadata } from ".";
import { DIContainer } from "../di-container";
import { ClassConstructor, DIModuleOptions } from "../types";

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
): DIContainer | undefined {

	const { target, module } = options;

	module.providedBy = module.providedBy || (options.fallbackToRootContainer ? DIContainer.ROOT : undefined);
	
	let resolvingContainer: DIContainer | undefined;

	if(typeof module.providedBy === 'function' ){

		const parentModuleMetadata = getModuleMetadata(module.providedBy) as DIModuleOptions | undefined;
		
		if(!parentModuleMetadata){
			throw new Error(`Invalid 'providedBy': [${module.providedBy.name}] option for ${target.name}. Ensure the class is decorated with @DIModule({...} || @Container({ module: {}})).`);
		}

		if(!parentModuleMetadata.container){
			console.warn("No container found in module's metadata, this should only happen during build time and when the module is imported into root container via an entry-layer, trying to get the container fro this module, from the ROOT ");

			if(DIContainer.ROOT.hasChildContainerById(parentModuleMetadata.identifier)){
				console.info(`child container found in ROOT for module: ${parentModuleMetadata.identifier}`);
				const container = DIContainer.ROOT.getChildContainerById(parentModuleMetadata.identifier);
				// the container in the ROOT will be a proxy, make sure to get the actual container out of the proxy
				parentModuleMetadata.container = container.proxyFor;
			} else {
				throw new Error(`no child container found in ROOT for module: ${parentModuleMetadata.identifier}; If it is supposed to have an entry, please make sure those configurations are in right order.`);
			}
        }

		if(!parentModuleMetadata.container!.proxies!.size){
			throw new Error(`Invalid 'providedBy': [${module.providedBy.name}] option for ${target.name}. Ensure the module is registered in a container.`);
		}

		if(parentModuleMetadata.container!.proxies!.size > 1){
			const childContainerIdentifiers = Array.from(parentModuleMetadata.container!.proxies.keys()).map(c => c.containerId);
			throw new Error(`Invalid 'providedBy': [${module.providedBy.name}] option for ${target.name}. The module has been imported by multiple other modules ${childContainerIdentifiers}, please specify a particular container instead of module-class`);
		}

		resolvingContainer = parentModuleMetadata.container.proxies.entries().next().value[1];

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
        resolvingContainer.register({ provide: target, useClass: target, tags: ['_internal_'] });
    }

    return resolvingContainer;
}