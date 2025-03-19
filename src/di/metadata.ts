import { makeDIToken } from "./utils";
import { DIContainer } from ".";
import type { DIModuleOptions, IDIContainer, ClassConstructor, DepIdentifier, ProviderOptions, ParameterInjectMetadata, PropertyInjectMetadata, InjectOptions } from "../interfaces";
import { type ILogger, createLogger } from "../logging";
import { compareProviderOptions } from "../utils/di";
import { isClassConstructor } from "../utils";

export const DI_MODULE_METADATA_KEY = 'DI_MODULE';
export const ON_INIT_HOOK_METADATA_KEY = 'ON_INIT_HOOK';
export const PROPERTY_INJECT_METADATA_KEY = 'PROPERTY_DEPENDENCY';
export const CONSTRUCTOR_INJECT_METADATA_KEY = 'CONSTRUCTOR_DEPENDENCY';

export type RegisterDIModuleMetadataOptions = Omit<DIModuleOptions, 'identifier' | 'container'>;

export class DIModuleMetadata implements DIModuleOptions {
    private readonly logger: ILogger;
    identifier: string;
    container: IDIContainer;
    imports: ClassConstructor[];
    exports: DepIdentifier[];
    providers: Array<ProviderOptions<any>>;
    providedBy?: IDIContainer | 'ROOT' | ClassConstructor;

    constructor(options: DIModuleOptions) {
        this.identifier = options.identifier;
        this.container = options.container;
        this.imports = options.imports || [];
        this.exports = options.exports || [];
        
        this.providers = (options.providers || []).map(p => {
            if(isClassConstructor(p)){
                return { provide: p, useClass: p };
            }
            return p;
        });

        this.providedBy = options.providedBy;
        this.logger = createLogger(`DIModuleMetadata[${this.identifier}]`);
    }

    updateMetadata(options: Partial<DIModuleOptions>): void {
        if (!this.identifier && options.identifier) {
            this.identifier = options.identifier;
        } else if (this.identifier && options.identifier && this.identifier !== options.identifier) {
            throw new Error(`Cannot replace the identifier of a module [existing: ${this.identifier}, new: ${options.identifier}]`);
        }

        if (!this.container && options.container) {
            this.container = options.container;
        } else if (this.container && options.container && this.container.containerId !== options.container.containerId) {
            throw new Error(`Cannot replace the container of a module [existing: ${this.container.containerId}, new: ${options.container.containerId}]`);
        }

        if (!this.providedBy && options.providedBy) {
            this.providedBy = options.providedBy;
        } else if (this.providedBy && options.providedBy && this.providedBy !== options.providedBy) {
            throw new Error(`Cannot replace the providedBy of a module [existing: ${this.providedBy}, new: ${options.providedBy}]`);
        }

        if (options.imports !== undefined) {
            options.imports.forEach(module => {
                if (!this.hasImport(module)) {
                    this.imports.push(module);
                    if (this.container) {
                        this.container.module(module);
                    }
                } else {
                    this.logger.debug(`Module ${module.name} is already imported`);
                }
            });
        }

        if (options.exports !== undefined) {
            options.exports.forEach(provide => {
                if (!this.hasExport(provide)) {
                    this.exports.push(provide);
                    if (this.container) {
                        this.container.exportProvidersFor(provide);
                    }
                } else {
                    this.logger.debug(`Provider ${provide} is already exported`);
                }
            }); 
        }

        if (options.providers !== undefined) {

            options.providers.forEach(providerOptions => {

                if(isClassConstructor(providerOptions)){
                    providerOptions = { provide: providerOptions, useClass: providerOptions };
                }

                if (!this.hasProvider(providerOptions)) {
                    this.providers.push(providerOptions);
                    if (this.container) {
                        this.container.register(providerOptions);
                    }
                    
                } else {
                    this.logger.debug(`Provider ${providerOptions.provide} is already registered`);
                }
            });
        }
    }

    addImport(module: ClassConstructor): void {
        this.imports.push(module);
    }

    removeImport(module: ClassConstructor): void {
        this.imports = this.imports.filter(m => m !== module);
    }

    hasImport(module: ClassConstructor): boolean {
        return this.imports ? this.imports.includes(module) : false;
    }

    addExport(provider: DepIdentifier): void {
        this.exports.push(provider);
    }

    removeExport(provider: DepIdentifier): void {
        this.exports = this.exports.filter(p => p !== provider);
    }

    hasExport(provider: DepIdentifier): boolean {
        return this.exports ? this.exports.includes(provider) : false;
    }

    addProvider(provider: ProviderOptions<any>): void {
        this.providers.push(provider);
    }

    removeProvider(provider: ProviderOptions<any>): void {
        if (this.providers) {
            this.providers = this.providers.filter(p => !compareProviderOptions(p, provider));
        }
    }

    hasProvider(provider: ProviderOptions<any>): boolean {
        return !!this.providers.find(p => compareProviderOptions(p, provider));
    }

    setContainer(container: IDIContainer): void {
        this.container = container;
    }

    hasContainer(): boolean {
        return !!this.container;
    }

    setProvidedBy(providedBy?: IDIContainer | 'ROOT' | ClassConstructor): void {
        this.providedBy = providedBy;
    }

    hasProvidedBy(): boolean {
        return !!this.providedBy;
    }
}

export function registerModuleMetadata(target: any, options: RegisterDIModuleMetadataOptions) {

    const newOptions = { ...options, identifier: makeDIToken(target) } as DIModuleOptions

    let moduleMetadata = DIContainer.DIMetadataStore.getPropertyMetadata<DIModuleMetadata>(target.name, DI_MODULE_METADATA_KEY); 
    
    if(moduleMetadata){
        moduleMetadata.updateMetadata(newOptions);
    } else {
        moduleMetadata = new DIModuleMetadata(newOptions);
    }
    
    DIContainer.DIMetadataStore.setPropertyMetadata(target.name, DI_MODULE_METADATA_KEY, moduleMetadata, true);
}

export function getModuleMetadata(target: any): DIModuleMetadata | undefined {
    return DIContainer.DIMetadataStore.getPropertyMetadata(target.name, DI_MODULE_METADATA_KEY);
}

export function registerConstructorDependency<T>( target: ClassConstructor, parameterIndex: number, dependencyToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
    const token = makeDIToken(dependencyToken);

    const existingDependencies: ParameterInjectMetadata<T>[] = DIContainer.DIMetadataStore.getPropertyMetadata(
        target.name,
        CONSTRUCTOR_INJECT_METADATA_KEY,
    ) || [];
    
    existingDependencies[parameterIndex] = { ...options, token };

   DIContainer.DIMetadataStore.setPropertyMetadata(
        target.name as any,
        CONSTRUCTOR_INJECT_METADATA_KEY,
        existingDependencies,
        true
    );
}

export function getConstructorDependenciesMetadata<T>(target: ClassConstructor): ParameterInjectMetadata<T>[] {
    return DIContainer.DIMetadataStore.getPropertyMetadata(
        target.name, 
        CONSTRUCTOR_INJECT_METADATA_KEY
    ) || [];
}

export function registerPropertyDependency<T>( target: ClassConstructor, propertyKey: string | symbol, dependencyToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
    const token = makeDIToken(dependencyToken);

    const existingDependencies =DIContainer.DIMetadataStore.getPropertyMetadata<PropertyInjectMetadata<T>[]>(
        target.name,
        PROPERTY_INJECT_METADATA_KEY
    ) || [];

    existingDependencies.push({ ...options, token, propertyKey });

   DIContainer.DIMetadataStore.setPropertyMetadata(
        target.name as any,
        PROPERTY_INJECT_METADATA_KEY, 
        existingDependencies, 
        true
    );
}

export function getPropertyDependenciesMetadata<T>(target: ClassConstructor): PropertyInjectMetadata<T>[] {
    return DIContainer.DIMetadataStore.getPropertyMetadata(
        target.name, 
        PROPERTY_INJECT_METADATA_KEY
    ) || [];
}

export function registerOnInitHook<T extends ClassConstructor>(target: T, propertyKey: string | symbol) {
   DIContainer.DIMetadataStore.setPropertyMetadata(
        target.name as any, 
        ON_INIT_HOOK_METADATA_KEY, 
        propertyKey
    );
}

export function getOnInitHookMetadata<T extends ClassConstructor>(target: T): string | symbol | undefined {
    return DIContainer.DIMetadataStore.getPropertyMetadata(target.name, ON_INIT_HOOK_METADATA_KEY);
}

