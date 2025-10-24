import { ModuleDescriptor, EntityDescriptor, ProviderDescriptor, CapabilityDescriptor } from './types';
/**
 * Global metadata registry populated by decorators at module load time
 * This is the PROPER way to do framework metadata - not hacky AST parsing!
 */
export declare class MetadataRegistry {
    private static instance;
    private modules;
    private entities;
    private providers;
    private capabilities;
    static getInstance(): MetadataRegistry;
    registerModule(module: ModuleDescriptor): void;
    getModule(name: string): ModuleDescriptor | undefined;
    getAllModules(): ModuleDescriptor[];
    registerEntity(entity: EntityDescriptor): void;
    getEntity(name: string): EntityDescriptor | undefined;
    getAllEntities(): EntityDescriptor[];
    registerProvider(provider: ProviderDescriptor): void;
    getProvider(provide: string, forEntity?: string): ProviderDescriptor | undefined;
    getAllProviders(): ProviderDescriptor[];
    registerCapability(capability: CapabilityDescriptor): void;
    getCapability(id: string): CapabilityDescriptor | undefined;
    getAllCapabilities(): CapabilityDescriptor[];
    getProvidersForModule(moduleName: string): ProviderDescriptor[];
    clear(): void;
    exportMetadata(): {
        modules: ModuleDescriptor[];
        entities: EntityDescriptor[];
        providers: ProviderDescriptor[];
        capabilities: CapabilityDescriptor[];
    };
}
export declare const metadataRegistry: MetadataRegistry;
