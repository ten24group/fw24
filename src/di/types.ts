import type { PartialBy } from "../utils";
import type { DIContainer } from "./di-container";

export type Token = string;
export type DepIdentifier<T = any> = string | Function | ClassConstructor<T>;
export type ClassConstructor<T extends any = any> = new (...args: any[]) => T;

export type BaseProviderOptions = {
    provide: DepIdentifier<any>;
    singleton?: boolean;
    priority?: number;
    tags?: string[]; // Tags for additional filtering
    condition?: () => boolean;
    override?: boolean; // Indicates if this provider should explicitly override others
}

export interface ClassProviderOptions<T = ClassConstructor<any>> extends BaseProviderOptions {
    useClass: ClassConstructor<T>;
}

export interface FactoryProviderOptions<T = any> extends BaseProviderOptions {
    deps?: DepIdentifier[];
    useFactory: (...args: any[]) => T;
}

export interface ValueProviderOptions<T = any> extends BaseProviderOptions {
    useValue: T;
}

export interface ConfigProviderOptions<T = any> extends BaseProviderOptions {
    useConfig: T; // Configuration object
}

export interface AliasProviderOptions<T> extends BaseProviderOptions {
    useExisting: DepIdentifier<T>;
}

export type ProviderOptions<T = any> =  
    | ClassProviderOptions<T> 
    | FactoryProviderOptions<T> 
    | ValueProviderOptions<T> 
    | ConfigProviderOptions<T>
    | AliasProviderOptions<T>;

// util type to infer the right provider type from the passed in ProviderOptions
export type InferProviderType<T> = T extends ClassProviderOptions<infer U> ? U
    : T extends FactoryProviderOptions<infer U> ? U
    : T extends ValueProviderOptions<infer U> ? U
    : T extends ConfigProviderOptions<infer U> ? U
    : never;

// the stored value of a provider byt the container
export type InternalProviderOptions<T = any> = {
    _id: string;
    _type: 'config' | 'standard';
    _container: DIContainer; // Reference to the container that registered this provider
    _provider: ProviderOptions<T>;
}

export function isClassProviderOptions<T>(options: BaseProviderOptions): options is ClassProviderOptions<T> {
    return (options as ClassProviderOptions<T>).useClass !== undefined;
}

export function isFactoryProviderOptions<T>(options: BaseProviderOptions): options is FactoryProviderOptions<T> {
    return (options as FactoryProviderOptions<T>).useFactory !== undefined;
}

export function isValueProviderOptions<T>(options: BaseProviderOptions): options is ValueProviderOptions<T> {
    return (options as ValueProviderOptions<T>).useValue !== undefined;
}

export function isConfigProviderOptions<T>(options: BaseProviderOptions): options is ConfigProviderOptions<T> {
    return (options as ConfigProviderOptions<any>).useConfig !== undefined;
}

export function isAliasProviderOptions<T>(options: BaseProviderOptions): options is AliasProviderOptions<T> {
    return (options as AliasProviderOptions<any>).useExisting !== undefined;
}

export type Middleware<T> = {
    order?: number;
    middleware: (next: () => T) => T;
};
export type MiddlewareAsync<T> = {
    order?: number;
    middleware: (next: () => Promise<T>) => Promise<T>;
};

export type DIModuleOptions = {
    /**
     * The id token for this module, assigned by the framework.
     */
    identifier: string;
    /**
     * The container instance specific to this module, this's the internal instance and is assigned by the framework.
     */
    container: DIContainer;
    /**
     * List of modules to import into this module, the exported providers of the imported modules will be available in this module.
     */
    imports?: ClassConstructor[];
    /**
     * List of providers to be exported from the module, the exported providers can be used in other modules that import this module, or in the container that registers this module.
     */
    exports?: DepIdentifier[];
    /**
     * Providers to be registered in the module's container; these providers are only available to the module's children and can shadow/override providers in parent hierarchy by specifying priority and other criteria [but only for the Injectable/s in itself and it's children].
     */
    providers ?: ProviderOptions<any>[];
	/**
	 * Specifies the parent DI-container or parent Module to register this module in or auto-resolve the container instance from.
	 * you don't need to specify this unless you are creating a separate module and want to use that module as the parent of this controller/module.
	 * @default: DIContainer.ROOT
	 */
	providedBy ?: DIContainer | 'ROOT' | ClassConstructor;
}

export interface DIModule extends DIModuleOptions {}

export type DIModuleConstructor = { new (...args: any[]): DIModule };


export type InjectOptions<T extends unknown = unknown> = {
    isOptional?: boolean;
    isConfig?: boolean;
    defaultValue?: T
};

export type ParameterInjectMetadata<T extends unknown = unknown> = InjectOptions<T> & {
    token: Token;
};

export type PropertyInjectMetadata<T extends unknown = unknown> = InjectOptions<T> & {
    token: Token;
    propertyKey: string | symbol;
};

export type PriorityCriteria =
  | { greaterThan: number }
  | { lessThan: number }
  | { eq: number }
  | { between: [number, number] };
  

export interface InjectableOptions extends PartialBy<BaseProviderOptions, 'provide'> {
    providedIn?: 'ROOT' | ClassConstructor;
}
