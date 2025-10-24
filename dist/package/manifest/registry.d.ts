import { CapabilityDescriptor, CapabilityRef, DeploymentUnitDescriptor, EntityDescriptor, EntityRef, ManifestApp, ModuleDescriptor, ProviderDescriptor, ResourceIntent } from './types';
export interface RegistryFile<T> {
    items: T[];
}
export interface ModuleRegistryItem extends Omit<ModuleDescriptor, 'runtime' | 'buildExports'> {
    buildExports?: ModuleDescriptor['buildExports'];
    runtime?: {
        providers?: ProviderDescriptor[];
        entities?: EntityRef[];
        capabilities?: CapabilityRef[];
        tags?: string[];
    };
}
export interface CapabilityRegistryItem extends CapabilityDescriptor {
}
export interface EntityRegistryItem extends EntityDescriptor {
}
export interface ResourceIntentRegistryItem extends ResourceIntent {
}
export interface DeploymentUnitRegistryItem extends DeploymentUnitDescriptor {
}
export interface AppRegistry {
    app: ManifestApp;
}
export interface LoadedRegistries {
    app: ManifestApp;
    modules: ModuleRegistryItem[];
    entities: EntityRegistryItem[];
    capabilities: CapabilityRegistryItem[];
    resourceIntents: ResourceIntentRegistryItem[];
    deploymentUnits: DeploymentUnitRegistryItem[];
}
export declare function loadRegistries(rootDir?: string): LoadedRegistries;
