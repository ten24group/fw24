import { MetadataManager } from '../utils/metadata';
import { type DeepPartial, type PartialBy } from '../utils/types';
import { BaseProviderOptions, ClassConstructor, ConfigProviderOptions, DepIdentifier, IDIContainer, InternalProviderOptions, DIMiddleware, DIMiddlewareAsync, PriorityCriteria, ProviderOptions, Token } from './../interfaces/di';
import { BaseSearchEngine } from '../search';
export declare class DIContainer implements IDIContainer {
    private parentContainer?;
    static readonly DIMetadataStore: MetadataManager;
    readonly containerId: string;
    private readonly logger;
    private readonly middlewares;
    private readonly asyncMiddlewares;
    private _resolving;
    protected get resolving(): Map<string, any>;
    private _cache;
    protected get cache(): Map<string, any>;
    private _providers;
    get providers(): Map<string, InternalProviderOptions[]>;
    private _exports;
    get exports(): Map<string, InternalProviderOptions[]>;
    proxyFor: DIContainer | undefined;
    get parent(): DIContainer | undefined;
    private _childContainers;
    get childContainers(): Set<DIContainer>;
    private _proxies;
    get proxies(): Set<DIContainer>;
    /**
     * Global ROOT container shared across ALL fw24 instances (bundled + layer).
     * Stored in global object to ensure singleton behavior even when multiple
     * fw24 module graphs exist (e.g., bundled in Lambda + layer).
     */
    private static _rootInstance;
    static get ROOT(): IDIContainer;
    private searchEngine?;
    constructor(parentContainer?: DIContainer | undefined, identifier?: string);
    Injectable(options?: PartialBy<BaseProviderOptions, 'provide'>): ClassDecorator;
    createChildContainer(identifier: string): DIContainer;
    protected createChildContainerProxyIdentifier(parentContainer: DIContainer): string;
    protected addProxyContainerIn: (parentContainer: DIContainer) => DIContainer;
    hasChildContainerById(identifier: string): boolean;
    removeChildContainerById(identifier: string): void;
    getChildContainerById(identifier: string): any;
    module(target: ClassConstructor): {
        identifier: string;
        container: DIContainer;
    };
    exportProvidersFor<T>(exportedDep: DepIdentifier<T>): void;
    createToken<T>(tokenOrType: DepIdentifier<T>): Token;
    register<T>(options: ProviderOptions<T>, container?: DIContainer): {
        provide: Token;
        options: ProviderOptions<T>;
    } | undefined;
    registerConfigProvider(options: ConfigProviderOptions): void;
    protected registerProvider(options: PartialBy<InternalProviderOptions, '_id' | '_container'>): void;
    removeProvidersFor(dependencyToken: DepIdentifier): void;
    resolveConfig<T = any>(query?: string, criteria?: {
        priority?: PriorityCriteria;
        tags?: string[];
    }): DeepPartial<T>;
    private collectMatchingConfigPaths;
    private resolveConfigPaths;
    collectBestProvidersFor<T>(criteria: {
        token?: string;
        tags?: string[];
        type?: ProviderOptions['type'];
        priority?: PriorityCriteria;
        forEntity?: ProviderOptions['forEntity'];
        allProvidersFromChildContainers?: boolean;
    }): InternalProviderOptions<T>[];
    resolve<T, Async extends boolean = false>(dependencyToken: DepIdentifier<T>, criteria?: {
        tags?: string[];
        type?: ProviderOptions['type'];
        priority?: PriorityCriteria;
        forEntity?: ProviderOptions['forEntity'];
        allProvidersFromChildContainers?: boolean;
    }, path?: Set<Token>, async?: Async): Async extends true ? Promise<T> : T;
    resolveProviderValue<T, Async extends boolean = false>(options: InternalProviderOptions<T>, path?: Set<Token>, async?: Async): Async extends true ? Promise<T> : T;
    private createAndCacheInstance;
    private createInstance;
    private createClassInstance;
    private createFactoryInstance;
    getClassDependencies(target: ClassConstructor): {
        propertyDependencies: import("./../interfaces/di").PropertyInjectMetadata<unknown>[];
        constructorDependencies: import("./../interfaces/di").ParameterInjectMetadata<unknown>[];
    };
    private resolveDependency;
    private resolveDependencies;
    private initializeInstance;
    private injectProperties;
    has(dependencyToken: DepIdentifier, criteria?: {
        tags?: string[];
        type?: ProviderOptions['type'];
        priority?: PriorityCriteria;
        forEntity?: ProviderOptions['forEntity'];
        allProvidersFromChildContainers?: boolean;
    }): boolean;
    hasEntityService(entityName: DepIdentifier, criteria?: {
        tags?: string[];
        priority?: PriorityCriteria;
        allProvidersFromChildContainers?: boolean;
    }): boolean;
    resolveEntityService<T, Async extends boolean = false>(entityName: DepIdentifier, criteria?: {
        tags?: string[];
        priority?: PriorityCriteria;
        allProvidersFromChildContainers?: boolean;
    }, async?: Async): Async extends true ? Promise<T> : T;
    hasEntitySchema(entityName: DepIdentifier, criteria?: {
        tags?: string[];
        priority?: PriorityCriteria;
        allProvidersFromChildContainers?: boolean;
    }): boolean;
    resolveEntitySchema<T, Async extends boolean = false>(entityName: DepIdentifier, criteria?: {
        tags?: string[];
        priority?: PriorityCriteria;
        allProvidersFromChildContainers?: boolean;
    }, async?: Async): Async extends true ? Promise<T> : T;
    clear(clearChildContainers?: boolean): void;
    useMiddleware({ middleware, order }: PartialBy<DIMiddleware<any>, 'order'>): void;
    resolveAsync<T>(dependencyToken: DepIdentifier<T>, criteria?: {
        tags?: string[];
        type?: ProviderOptions['type'];
        priority?: PriorityCriteria;
        forEntity?: ProviderOptions['forEntity'];
        allProvidersFromChildContainers?: boolean;
    }, path?: Set<Token>): Promise<T>;
    private createAndCacheInstanceAsync;
    useMiddlewareAsync({ middleware, order }: PartialBy<DIMiddlewareAsync<any>, 'order'>): void;
    private resolveDependenciesAsync;
    private initializeInstanceAsync;
    private createFactoryInstanceAsync;
    private injectPropertiesAsync;
    logChildContainers(): void;
    logProviders(allProvidersFromChildContainers?: boolean): void;
    logCache(): void;
    setSearchEngine(engine: BaseSearchEngine): void;
    resolveSearchEngine(): BaseSearchEngine;
}
