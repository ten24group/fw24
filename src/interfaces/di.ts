import { DeepPartial, PartialBy } from '../utils/types';

export type Token = string;
export type DepIdentifier<T = any> = string | Function | ClassConstructor<T>;
export type ClassConstructor<T extends any = any> = new (...args: any[]) => T;

export type BaseProviderOptions = {
    provide: DepIdentifier<any>;
    type?: 'config' | 'service' | 'schema' | 'controller' | 'module' | 'unknown';
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
    _container: IDIContainer; // Reference to the container that registered this provider
    _provider: ProviderOptions<T>;
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
    container: IDIContainer;
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
	providedBy ?: IDIContainer | 'ROOT' | ClassConstructor;
}

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

export interface IDIContainer {
    containerId: string;

    providers: Map<string, InternalProviderOptions[]>; // Map of providers by token
    exports: Map<string, InternalProviderOptions[]>; // Map of providers by token
    parent: IDIContainer | undefined;
    childContainers: Set<IDIContainer> | undefined;

    proxyFor: IDIContainer | undefined;
    proxies: Set<IDIContainer> | undefined;

    Injectable(options?: PartialBy<BaseProviderOptions, "provide">): ClassDecorator;

    // Method to register a provider
    register<T>(provider: ProviderOptions<T>): void;

    registerConfigProvider(options: ConfigProviderOptions): void;

    has(dependencyToken: DepIdentifier, criteria?: {
        priority?: PriorityCriteria;
        tags?: string[];
    }): boolean;

    clear(clearChildContainers?: boolean): void;

    useMiddleware({ middleware, order }: PartialBy<Middleware<any>, "order">): void;

    useMiddlewareAsync({ middleware, order }: PartialBy<MiddlewareAsync<any>, "order">): void;
    
    resolve<T, Async extends boolean = false>(
        dependencyToken: DepIdentifier<T>,
        criteria?: {
            priority?: PriorityCriteria;
            tags?: string[];
        },
        path?: Set<Token>,
        async?: Async
    ): Async extends true ? Promise<T> : T;

    resolveConfig<T = any>(query?: string, criteria?: {
        priority?: PriorityCriteria;
        tags?: string[];
    }): DeepPartial<T>

    resolveAsync<T>(dependencyToken: DepIdentifier<T>, criteria?: {
        priority?: PriorityCriteria;
        tags?: string[];
    }, path?: Set<Token>): Promise<T>;

    resolveProviderValue<T, Async extends boolean = false>(
        options: InternalProviderOptions<T>, 
        path?: Set<Token>, 
        async?: Async
    ): Async extends true ? Promise<T> : T;

    removeProvidersFor(dependencyToken: DepIdentifier): void;

    hasChildContainerById(identifier: string): boolean;

    getChildContainerById(identifier: string): IDIContainer | undefined;

    createChildContainer(identifier: string): IDIContainer;

    module(target: ClassConstructor): {
        identifier: string,
        container: IDIContainer
    };

    // Method to create a token for a dependency
    createToken<T>(identifier: DepIdentifier<T>): string;

    getClassDependencies(target: ClassConstructor): {
        propertyDependencies: PropertyInjectMetadata<unknown>[];
        constructorDependencies: ParameterInjectMetadata<unknown>[];
    };

    logProviders(): void;

    logCache(): void;

    
}