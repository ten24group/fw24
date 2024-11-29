import { getModuleMetadata } from "../metadata";
import { DIContainer } from "../container";
import type { IDIContainer } from "../../interfaces/di";
import { DefaultLogger } from "../../logging";

export function tryGetModuleDIContainer(moduleClass: Function) {
	const parentModuleMetadata = getModuleMetadata(moduleClass);

	if (!parentModuleMetadata) {
		throw new Error(`Invalid 'providedBy': [${moduleClass.name}] option. Ensure the class is decorated with @DIModule({...} || @Container({ module: {}})).`);
	}

	if (!parentModuleMetadata.container) {
		
		DefaultLogger.warn(`tryGetModuleDIContainer: No container found in module's metadata: [${moduleClass.name}], this should only happen during build time and when the module is imported into root container via an entry-layer, trying to get the container for this module, from the ROOT `);

		if (DIContainer.ROOT.hasChildContainerById(parentModuleMetadata.identifier)) {
			
			DefaultLogger.info(`tryGetModuleDIContainer: child container found in ROOT for module: ${parentModuleMetadata.identifier}`);
			const container = DIContainer.ROOT.getChildContainerById(parentModuleMetadata.identifier) as IDIContainer;
			// the container in the ROOT will be a proxy, make sure to get the actual container out of the proxy
			parentModuleMetadata.setContainer(container.proxyFor!);

		} else {

			const msg = `tryGetModuleDIContainer: no child container found in ROOT for module: ${parentModuleMetadata.identifier}; If it is supposed to have an entry, please make sure those configurations are in right order.`;
			DefaultLogger.error(msg);

			throw new Error(msg);
		}
	}

	if (!parentModuleMetadata.container!.proxies!.size) {
		throw new Error(`Invalid 'providedBy': [${moduleClass.name}] option. Ensure the module is registered in a container.`);
	}

	if (parentModuleMetadata.container!.proxies!.size > 1) {
		const childContainerIdentifiers = Array.from(parentModuleMetadata.container!.proxies!.keys()).map(c => c.containerId);
		throw new Error(`Invalid 'providedBy': [${moduleClass.name}] option. The module has been imported by multiple other modules ${childContainerIdentifiers}, please specify a particular container instead of module-class`);
	}

	return parentModuleMetadata.container.proxies!.entries().next().value![ 1 ];
}
