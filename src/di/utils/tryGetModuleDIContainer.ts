import { getModuleMetadata } from ".";
import { DIContainer } from "../di-container";
import type { DIModuleOptions } from "../../interfaces/di";

export function tryGetModuleDIContainer(moduleClass: Function) {
	const parentModuleMetadata = getModuleMetadata(moduleClass) as DIModuleOptions | undefined;

	if (!parentModuleMetadata) {
		throw new Error(`Invalid 'providedBy': [${moduleClass.name}] option. Ensure the class is decorated with @DIModule({...} || @Container({ module: {}})).`);
	}

	if (!parentModuleMetadata.container) {
		console.warn("No container found in module's metadata, this should only happen during build time and when the module is imported into root container via an entry-layer, trying to get the container fro this module, from the ROOT ");

		if (DIContainer.ROOT.hasChildContainerById(parentModuleMetadata.identifier)) {
			console.info(`child container found in ROOT for module: ${parentModuleMetadata.identifier}`);
			const container = DIContainer.ROOT.getChildContainerById(parentModuleMetadata.identifier);
			// the container in the ROOT will be a proxy, make sure to get the actual container out of the proxy
			parentModuleMetadata.container = container!.proxyFor!;
		} else {
			throw new Error(`no child container found in ROOT for module: ${parentModuleMetadata.identifier}; If it is supposed to have an entry, please make sure those configurations are in right order.`);
		}
	}

	if (!parentModuleMetadata.container!.proxies!.size) {
		throw new Error(`Invalid 'providedBy': [${moduleClass.name}] option. Ensure the module is registered in a container.`);
	}

	if (parentModuleMetadata.container!.proxies!.size > 1) {
		const childContainerIdentifiers = Array.from(parentModuleMetadata.container!.proxies!.keys()).map(c => c.containerId);
		throw new Error(`Invalid 'providedBy': [${moduleClass.name}] option. The module has been imported by multiple other modules ${childContainerIdentifiers}, please specify a particular container instead of module-class`);
	}

	return parentModuleMetadata.container.proxies!.entries().next().value[ 1 ];
}
