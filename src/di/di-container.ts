import { v4 as generateUUID } from 'uuid';
import type { DeepPartial, PartialBy } from '../utils';
import { createLogger, ILogger } from './../logging/index';
import { Injectable } from './decorators';

import {
    BaseProviderOptions,
    ClassConstructor,
    ClassProviderOptions,
    ConfigProviderOptions,
    DepIdentifier,
    FactoryProviderOptions,
    InternalProviderOptions,
    isAliasProviderOptions,
    isClassProviderOptions,
    isConfigProviderOptions,
    isFactoryProviderOptions,
    isValueProviderOptions,
    Middleware,
    MiddlewareAsync,
    PriorityCriteria,
    ProviderOptions,
    Token
} from './types';
import { applyMiddlewares, applyMiddlewaresAsync, filterAndSortProviders, flattenConfig, getConstructorDependenciesMetadata, getModuleMetadata, getOnInitHookMetadata, getPathValue, getPropertyDependenciesMetadata, hasConstructor, makeDIToken, matchesPattern, registerModuleMetadata, setPathValue, stripDITokenNamespace, validateProviderOptions } from './utils';

export class DIContainer {

    public readonly containerId: string;
    private readonly logger: ILogger;
    private readonly middlewares: Middleware<any>[] = [];
    private readonly asyncMiddlewares: MiddlewareAsync<any>[] = [];

    private _resolving = new Map<string, any>();
    get resolving(): Map<string, any> {

        if(this.proxyFor){
            return this.proxyFor.resolving;
        }

        if(!this._resolving){
            this._resolving = new Map<string, any>();
        }
        return this._resolving;
    }

    private _cache = new Map<string, any>();
    get cache(): Map<string, any> {

        if(this.proxyFor){
            return this.proxyFor.cache;
        }

        if(!this._cache){
            this._cache = new Map<string, any>();
        }
        return this._cache;
    }

    private _providers: Map<string, InternalProviderOptions[]> | undefined;
    get providers(): Map<string, InternalProviderOptions[]> {

        if(this.proxyFor){
            return this.proxyFor.providers;
        }

        if(!this._providers){
            this._providers = new Map<string, InternalProviderOptions[]>();
        }
        return this._providers
    }

    private _exports: Map<string, InternalProviderOptions[]> | undefined;
    get exports(): Map<string, InternalProviderOptions[]> {

        if(this.proxyFor){
            return this.proxyFor.exports;
        }

        if(!this._exports){
            this._exports = new Map<string, InternalProviderOptions[]>();
        }
        return this._exports
    }

    // when this container is a proxy for another container; the another container's ref will be stored here
    private proxyFor: DIContainer | undefined;

    get parent() {
        return this.parentContainer
    }

    private _childContainers: Set<DIContainer> | undefined;
    get childContainers(): Set<DIContainer> {

        if(this.proxyFor){
            return this.proxyFor.childContainers;
        }

        if(!this._childContainers){
            this._childContainers = new Set<DIContainer>();
        }
        return this._childContainers
    }

    private _proxies: Set<DIContainer> | undefined;
    get proxies(): Set<DIContainer> {

        if(this.proxyFor){
            return this.proxyFor.proxies;
        }

        if(!this._proxies){
            this._proxies = new Set<DIContainer>();
        }
        return this._proxies
    }

    private static _rootInstance: DIContainer;
    static get ROOT(): DIContainer {
        if (!this._rootInstance) {
            this._rootInstance = new DIContainer();
        }
        return this._rootInstance;
    }
    
    constructor(private parentContainer?: DIContainer, identifier: string = 'ROOT') {
        // to ensure destructuring works correctly
        this.Injectable = this.Injectable.bind(this);
        this.containerId = identifier;
        this.logger = createLogger(`DIContainer[${identifier}]`);
    }

    Injectable(options: PartialBy<BaseProviderOptions, 'provide'> = {}) {
        return Injectable(options, this);
    }
    
    createChildContainer(identifier: string): DIContainer {
        const child = new DIContainer(this, identifier);
        this.childContainers.add(child);
        return child;
    }

    protected addProxyContainerIn = (parentContainer: DIContainer): DIContainer => {
        
        const child = parentContainer.createChildContainer(`${this.containerId}:ProxyIn[${parentContainer.containerId}]`);
        
        child.proxyFor = this;
        this.proxies.add(child);

        return child;
    }

    public hasChildContainerById(identifier: string): boolean {
        let found = Array.from(this.childContainers).some(element => {
            element.containerId.startsWith(identifier);
        });

        if(!found && this.childContainers.size > 0){
            found = Array.from(this.childContainers).some(cc => cc.hasChildContainerById(identifier) );
        }
        
        return found;
    }

    public getChildContainerById(identifier: string): any {
        let foundContainer = Array.from(this.childContainers).find(element => {
            return element.containerId.startsWith(identifier);
        });

        if (!foundContainer && this.childContainers.size > 0) {
            for (const cc of this.childContainers) {
                foundContainer = cc.getChildContainerById(identifier);
                if (foundContainer) {
                    break;
                }
            }
        }

        return foundContainer;
    }

    module(target: ClassConstructor){

        const moduleMeta = getModuleMetadata(target);

        if(!moduleMeta){
            throw new Error(`Module ${target.name} does not have any metadata, make sure it's decorated with @DIModule()`);
        }

        const { imports = [], exports = [], providers = [], identifier } = moduleMeta;

        // if there's no container in the module metadata, create the main container for the module
        if(!moduleMeta.container){

            const moduleContainer = new DIContainer(undefined, identifier); 
            this.logger.info(`Module ${moduleMeta.identifier} metadata does not have a container, assigning one.`, { id: moduleContainer.containerId });
            moduleMeta.container = moduleContainer;
            registerModuleMetadata(target, moduleMeta, true);

            // make sure all the module providers are loaded into the module's container's providers
            for (const provider of providers) {
                moduleContainer.register(provider);
            }
            // and make sure all the module exports are also loaded into the module's container's providers
            for( const importedModule of imports) {
                moduleContainer.module(importedModule);
            }
    
            // load all the export from this module into the current container
            for( const exportedDep of exports) {
                moduleContainer.exportProvidersFor(exportedDep);
            }

            // TODO: module lifecycle hooks
        }

        const moduleProxyContainer = moduleMeta.container.addProxyContainerIn(this);
        
        return {
            identifier,
            container: moduleProxyContainer
        }
    }

    exportProvidersFor<T>(exportedDep: DepIdentifier<T>) {
        const token = this.createToken(exportedDep);

        // Collect providers directly matching the export token
        const availableProviders = this.providers.get(token) || [];
        const childExportedProviders = Array.from(this.childContainers)
            .flatMap(child => child.exports.get(token) || []);

        // Combine available providers and child exported providers
        const allProviders = [...availableProviders, ...childExportedProviders];

        // Nested function to map and export providers
        const mapAndExportProviders = (providers: InternalProviderOptions[], targetToken: string) => {
            const exported = providers.map(provider => {
                const { _container, _provider, _id } = provider;
                const { condition, provide, priority, override, singleton, tags } = _provider;

                return {
                    _provider: {
                        useFactory: () => _container.resolve(provide),
                        condition,
                        provide,
                        priority,
                        override,
                        singleton,
                        tags,
                    },
                    _id,
                    _type: provider._type,
                    _container: this
                };
            });

            // Merge or set these exported providers under their respective keys
            const existingExports = this.exports.get(targetToken) || [];
            this.exports.set(targetToken, [...existingExports, ...exported]);
        };

        // Export the standard and config providers directly matching the token
        mapAndExportProviders(allProviders, token);

        // Find all config providers whose keys start with the token and export them
        for (const [configKey, configProviders] of this.providers.entries()) {
            if (configKey.startsWith(token) && configProviders.some(p => p._type === 'config')) {
                mapAndExportProviders(configProviders, configKey);
            }
        }
    }

    createToken<T>(tokenOrType: DepIdentifier<T>): Token {
        // maybe add a mechanism for adding extra metadata to the token like container ID and stuff?
        return makeDIToken(tokenOrType);
    }

    register<T>(options: ProviderOptions<T>, container: DIContainer = this): { provide: Token, options: ProviderOptions<T> } | undefined {
        if (container !== this) {
            return container.register(options);
        }

        const token = this.createToken(options.provide);

        const optionsCopy = {
            ...options,
            priority: options.priority !== undefined ? options.priority : 0,
            singleton: options.singleton !== undefined ? options.singleton : true,
        };

        if (optionsCopy.condition && !optionsCopy.condition()) return;

        validateProviderOptions(optionsCopy, token);

        // Handle config providers
        if (isConfigProviderOptions(options)) {
            this.registerConfigProvider(options);
        } else {
            this.registerProvider({
                _provider: optionsCopy
            });
        }

        return {
            provide: token,
            options: optionsCopy,
        };
    }

    registerConfigProvider(options: ConfigProviderOptions) {
        const { useConfig, provide: provide, ...rest } = options;
        
        let provideToken = stripDITokenNamespace(this.createToken(provide));
        const flattenedEntries = flattenConfig(useConfig, provideToken);

        for (const [configPath, value] of flattenedEntries) {

            const providerOptions = {
                ...rest,
                provide: configPath,
                useConfig: value,
            };
            
            this.registerProvider({
                _type: 'config',
                _provider: providerOptions,
            });
        }
    }

    protected registerProvider(options: PartialBy<InternalProviderOptions, '_id' | '_type' | '_container'>) {
        const currentProvider = options._provider;
        const token = this.createToken(currentProvider.provide);

        const tokenProviders = this.providers.get(token) || [];

        // if token providers already has a provider with same priority and tags, log warning and replace it
        const existingProvider = tokenProviders.find(({_provider: existingProvider}) => {
            return existingProvider.priority === currentProvider.priority
            && (
                // maybe be make it configurable to compare tags...
                (!existingProvider.tags?.length && !currentProvider.tags?.length) 
                || 
                (
                    // compare array items are the same
                    existingProvider.tags?.every((tag, index) => tag == currentProvider.tags?.[index])
                )
            )
        });

        if(existingProvider){
            this.logger.warn(`Provider for ${token} with same priority and tags already exists, replacing it.`);
            const index = tokenProviders.indexOf(existingProvider);
            // delete the existing provider
            tokenProviders.splice(index, 1);
        }

        const internalProviderOptions = {
            ...options,
            _id: generateUUID(),
            _type: options._type || 'standard',
            _container: this,
        };

        tokenProviders.push(internalProviderOptions);
        this.providers.set(token, tokenProviders);
    }

    removeProvidersFor(dependencyToken: DepIdentifier) {
        const token = this.createToken(dependencyToken);
        const providers = this.providers.get(token) || [];
        providers.forEach(provider => {
            this.cache.delete(provider._id!);
        });
        this.providers.delete(token);
    }

    // Resolve a configuration path with flexible criteria, supporting wildcards and regex
    resolveConfig<T = any>(
        query: string = '',
        criteria?: {
            priority?: PriorityCriteria;
            tags?: string[];
        }
    ): DeepPartial<T> {

        query = stripDITokenNamespace(query);

        const matchingPaths = this.collectMatchingConfigPaths(query);

        const resolvedValues = this.resolveConfigPaths(matchingPaths, criteria);

        // Merge resolved values into a final configuration object
        const mergedConfig: Record<any, any> = {};

        resolvedValues.forEach((value, path) => {
            path = stripDITokenNamespace(path);
            setPathValue(mergedConfig, path, value);
        });

        return getPathValue(mergedConfig, query) as DeepPartial<T>;
    }

    // Collect all paths that match the query, supporting wildcards and regex
    private collectMatchingConfigPaths(query: string): Set<string> {
        const matchingPaths: Set<string> = new Set();

        const processKeys = (keys: IterableIterator<string>) => {
            for (const path of keys) {
                const actualPath = stripDITokenNamespace(path);
                if (matchesPattern(actualPath, query)) {
                    matchingPaths.add(path);
                }
            }
        };

        let current: DIContainer | undefined = this;

        while (current) {
            // Check the providers in the current container
            processKeys(current.providers.keys());

            // Check the exported providers from child containers
            current.childContainers.forEach(child => {
                processKeys(child.exports.keys());
            });

            // Move to the parent container
            current = current.parent;
        }

        return matchingPaths;
    }

    // Resolve values for all matching paths using the best provider from the hierarchy based on criteria
    private resolveConfigPaths(
        paths: Set<string>, 
        criteria?: {
            priority?: PriorityCriteria;
            tags?: string[];
        }
    ): Map<string, any> {

        const resolvedValues = new Map<string, any>();

        const reduceProviders = (providers: InternalProviderOptions[]): any => {
            if (providers.length === 0) {
                return undefined;
            }

            // Assume the highest-priority provider's value is the desired one
            const bestProvider = providers[0]._provider as ConfigProviderOptions<any>;
            return bestProvider.useConfig 
        }

        paths.forEach((path) => {
            const bestProviders = this.collectBestProvidersFor<ConfigProviderOptions>(
                path, 
                {...criteria, type: 'config'}
            );
            
            const resolvedValue = reduceProviders(bestProviders);

            resolvedValues.set(path, resolvedValue);
        });

        return resolvedValues;
    }

    // Collect all providers for a given path across the hierarchy
    private collectBestProvidersFor<T>(
        path: string, 
        criteria?: {
            priority?: PriorityCriteria;
            type?: InternalProviderOptions['_type'], 
            tags?: string[];
        }
    ): InternalProviderOptions<T>[] {
        const bestProviders: InternalProviderOptions[] = [];

        let current: DIContainer | undefined = this;

        while (current) {
            
            let pathProviders = current.providers.get(path) || [];

            if(criteria?.type){
                pathProviders = pathProviders.filter((provider) => provider._type === criteria.type);
            }

            bestProviders.push(...pathProviders.map(provider => ({ 
                ...provider, 
                // when it's a proxy container make sure the provider has it's reference for resolving it later, 
                // that way the provider is resolved using the right hierarchy
                _container: current! 
            })));

            // Collect exported providers from child containers
            current.childContainers.forEach(child => {
                let childProviders = child.exports.get(path) || [];

                if (criteria?.type) {
                    childProviders = childProviders.filter(provider => provider._type === criteria.type);
                }

                childProviders.forEach(provider => {
                    if (!bestProviders.find(({ _id }) => _id === provider._id)) {
                        bestProviders.push({ ...provider, _container: child });
                    }
                });
            });

            current = current.parent;
        }

        // Filter and sort providers based on criteria and conflict resolution strategies
        return filterAndSortProviders(bestProviders, criteria);
    }

    resolve<T, Async extends boolean = false>(
        dependencyToken: DepIdentifier<T>,
        criteria?: {
            priority?: PriorityCriteria;
            tags?: string[];
        },
        path: Set<Token> = new Set(),
        async: Async = false as Async
    ): Async extends true ? Promise<T> : T {

        const token = this.createToken(dependencyToken);

        // if token is `DIContainer` return the current container
        if( DI_CONTAINER_TOKEN === token){
            return (async ? Promise.resolve(this) : this ) as Async extends true ? Promise<T> : T;
        }
        
        const bestProviders = this.collectBestProvidersFor<T>(token, criteria);
        
        if (bestProviders.length === 0) {
            throw new Error(`No provider found for ${token}`);
        }
        const options = bestProviders[0];
        
        return this.resolveProviderValue<T, Async>(options, path, async);
    }

    resolveProviderValue<T, Async extends boolean = false>(
        options: InternalProviderOptions<T>,
        path: Set<Token> = new Set(),
        async: Async = false as Async
    ): Async extends true ? Promise<T> : T {

        const { _id, _container, _provider: provider } = options;

        if ( _container !== this ){
            return _container.resolveProviderValue(options, path, async);
        }
        
        if (provider.singleton && this.cache.has(_id)) {
            return this.cache.get(_id);
        }

        if (this.resolving.has(_id)) {
            return this.resolving.get(_id);
        }

        if (path.has(_id)) {
            throw new Error(`Circular dependency detected: ${Array.from(path).join(' -> ')} -> ${_id}`);
        }

        path.add(_id);

        if(async){
            return applyMiddlewaresAsync(
                this.asyncMiddlewares,
                () => this.createAndCacheInstanceAsync<T>(options, path)
            ) as Async extends true ? Promise<T> : T;
        }

        return applyMiddlewares(
            this.middlewares,
            () => this.createAndCacheInstance(options, path)
        ) as Async extends true ? Promise<T> : T;
    }

    private createAndCacheInstance<T>(options: InternalProviderOptions<T>, path: Set<Token> ): T {

        const { _id, _provider: provider } = options;

        const instance = this.createInstance(options, path);
        if (provider.singleton) {
            this.cache.set(_id, instance);
        }

        this.resolving.delete(_id);

        this.injectProperties(instance);
        this.initializeInstance(instance);

        path.delete(_id);

        return instance;
    }

    private createInstance<T, Async extends boolean = false>(
        options: InternalProviderOptions<T>, 
        path: Set<Token>, 
        async: Async = false as Async
    ): Async extends true ? Promise<T> : T {

        const { _id, _provider: provider } = options;

        if(isAliasProviderOptions(provider)){
            return this.resolve(provider.useExisting, {}, path, async);
        } 

        if (isClassProviderOptions(provider)) {

            return ( 
                async ? this.createClassInstance<T, true>(options, path, true) 
                : this.createClassInstance(options, path)
            ) as Async extends true ? Promise<T> : T;
        } 
        
        if (isFactoryProviderOptions(provider)) {

            return ( 
                async ? this.createFactoryInstanceAsync<T>(provider, path) 
                : this.createFactoryInstance(provider, path)
            ) as Async extends true ? Promise<T> : T;
        } 
        
        if (isValueProviderOptions(provider)) {
            return provider.useValue as Async extends true ? Promise<T> : T;
        } 
        
        if (isConfigProviderOptions(provider)){
            return provider.useConfig as Async extends true ? Promise<T> : T;
        } 

        throw new Error(`Provider for '${_id}' is not correctly configured`);
    }

    private createClassInstance<T, Async extends boolean = false>(
        options: InternalProviderOptions<T>, 
        path: Set<Token>,
        async: Async = false as Async
    ): Async extends true ? Promise<T> : T {

        const { _id, _provider: provider } = options;

        if (this.resolving.has(_id)) {
            return this.resolving.get(_id);
        }

        const { useClass } = provider as ClassProviderOptions<T>;

        // Create a placeholder object and store it in the resolving map
        const instancePlaceholder: T = Object.create(useClass.prototype);
        this.resolving.set(_id, instancePlaceholder);


        if(async){
            this.resolveDependenciesAsync(useClass, path) .then(dependencies => {
                const actualInstance = new useClass(...dependencies);
                Object.assign(instancePlaceholder as any, actualInstance);
                this.resolving.set(_id, actualInstance);
                return actualInstance;
            })
        }

        const dependencies = this.resolveDependencies(useClass, path);
        const actualInstance = new useClass(...dependencies);
        Object.assign(instancePlaceholder as any, actualInstance);
        this.resolving.set(_id, actualInstance);

        return actualInstance as Async extends true ? Promise<T> : T;
    }

    private createFactoryInstance<T>(options: FactoryProviderOptions<T>, path: Set<Token>): T {
        const dependencies = (options.deps || []).map(dep => this.resolve(dep, {}, path));
        return options.useFactory(...dependencies);
    }

    getClassDependencies(target: ClassConstructor) {
        const constructorDependencies = getConstructorDependenciesMetadata(target);
        const propertyDependencies = getPropertyDependenciesMetadata(target);

        return {
            propertyDependencies,
            constructorDependencies
        }
    }

    private resolveDependencies<T extends ClassConstructor>(target: T, path: Set<Token>): any[] {
        
        const injectMetadata = getConstructorDependenciesMetadata(target);

        return injectMetadata.map(dep => {

            try {
                if(dep.isConfig){
                    return this.resolveConfig(dep.token, {});
                } else {
                    return this.resolve(dep.token, {}, path);
                }
            } catch (error) {
                if (dep.isOptional) return dep.defaultValue !== undefined ? dep.defaultValue : undefined;
                throw error;
            }
        });
    }

    private initializeInstance<T>(instance: T): void {
        if (!hasConstructor(instance)) return;

        const initMethod = getOnInitHookMetadata(instance.constructor as ClassConstructor);

        if (initMethod) {
            const theInitMethod = instance[initMethod as keyof typeof instance] as Function;
            if (typeof theInitMethod === 'function') {
                try {
                    theInitMethod();
                } catch (error: any) {
                    throw new Error(`Initialization method failed for ${instance.constructor.name}: ${error.message}`);
                }
            } else {
                throw new Error(`Initialization method ${String(initMethod)} is not a function on ${instance.constructor.name}`);
            }
        }
    }

    private injectProperties<T>(instance: T): void {
        if (!hasConstructor(instance)) return;

        const dependencies = getPropertyDependenciesMetadata(instance.constructor as ClassConstructor);


        for (const dep of dependencies) {
            const propertyValue = (() => {
                try {
                    return this.resolve(dep.token);
                } catch (error) {
                    if (dep.isOptional) return undefined;
                    throw error;
                }
            })();

            Object.defineProperty(instance, dep.propertyKey, {
                value: propertyValue,
                enumerable: true,
                configurable: true
            });
        }
    }

    has(
        dependencyToken: DepIdentifier, 
        criteria?: {
            priority?: PriorityCriteria;
            tags?: string[];
        } 
    ): boolean {

        const token = this.createToken(dependencyToken);

        const bestProviders = this.collectBestProvidersFor<any>(token, criteria);

        return bestProviders.length > 0;
    }

    clear(clearChildContainers = true) {
        this.providers.clear();
        this.cache.clear();
        this.resolving.clear();
        if(clearChildContainers){
            this.childContainers.forEach(container => container.clear());
        }
    }

    useMiddleware({middleware, order = 1}: PartialBy<Middleware<any>, 'order' >) {
        this.middlewares.push({ middleware, order });
        this.middlewares.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) );
    }

    async resolveAsync<T>( 
        dependencyToken: DepIdentifier<T>, 
        criteria?: {
            priority?: PriorityCriteria;
            tags?: string[];
        },
        path?: Set<Token>){
        return await this.resolve<T, true>(dependencyToken, criteria, path, true);
    }
    
    private async createAndCacheInstanceAsync<T>(options: InternalProviderOptions<T>, path: Set<Token>): Promise<T> {
        const { _id, _provider: provider } = options;

        const instance = await this.createInstance(options, path, true);
        if (provider.singleton) {
            this.cache.set(_id, instance);
        }

        this.resolving.delete(_id);

        await this.injectPropertiesAsync(instance);
        await this.initializeInstanceAsync(instance);
        
        path.delete(_id);

        return instance;
    }

    useAsyncMiddleware({middleware, order = 1}: PartialBy<MiddlewareAsync<any>, 'order'> ) {
        this.asyncMiddlewares.push({ middleware, order });
        this.asyncMiddlewares.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    private async resolveDependenciesAsync<T extends ClassConstructor>(target: T, path: Set<Token>): Promise<any[]> {

        const injectMetadata = getConstructorDependenciesMetadata(target);

        return await Promise.all(injectMetadata.map(async dep => {
            try {
                if(dep.isConfig){
                    return Promise.resolve(this.resolveConfig(dep.token, {}));
                } else {
                    return await this.resolveAsync(dep.token, {}, path);
                }
            } catch (error) {
                if (dep.isOptional) return dep.defaultValue !== undefined ? dep.defaultValue : undefined;
                throw error;
            }
        }));
    }

    private async initializeInstanceAsync<T>(instance: T): Promise<void> {
        if (!hasConstructor(instance)) return;

        const initMethod = getOnInitHookMetadata(instance.constructor as ClassConstructor);

        if (initMethod) {
            const theInitMethod = instance[initMethod as keyof typeof instance] as Function;
            if (typeof theInitMethod === 'function') {
                try {
                    await theInitMethod();
                } catch (error: any) {
                    throw new Error(`Initialization method failed for ${instance.constructor.name}: ${error.message}`);
                }
            } else {
                throw new Error(`Initialization method ${String(initMethod)} is not a function on ${instance.constructor.name}`);
            }
        }
    }

    private async createFactoryInstanceAsync<T>(options: FactoryProviderOptions<T>, path: Set<Token>): Promise<T> {
        const dependencies = await Promise.all((options.deps || []).map(dep => this.resolveAsync(dep, {}, path)));
        return options.useFactory(...dependencies);
    }

    private async injectPropertiesAsync<T>(instance: T): Promise<void> {
        if (!hasConstructor(instance)) return;

        const dependencies = getPropertyDependenciesMetadata(instance.constructor as ClassConstructor);

        for (const dep of dependencies) {
            const propertyValue = await (async () => {
                try {
                    return await this.resolveAsync(dep.token);
                } catch (error) {
                    if (dep.isOptional) return undefined;
                    throw error;
                }
            })();

            Object.defineProperty(instance, dep.propertyKey, {
                value: propertyValue,
                enumerable: true,
                configurable: true
            });
        }
    }

    logProviders() {
        for (const [token, options] of this.providers.entries()) {
            this.logger.info(`Provider: [${this.containerId}] - ${token}:`, options);
        }
        this.parent?.logProviders();
    }

    logCache() {
        for (const [token, instance] of this.cache.entries()) {
            this.logger.info(`Cache: [${this.containerId}] - ${token}:`, instance);
        }
        this.parent?.logCache();
    }
}

export const DI_CONTAINER_TOKEN = makeDIToken(DIContainer);

