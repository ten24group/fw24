import { PartialBy } from '../utils';
import { CONSTRUCTOR_INJECT_METADATA_KEY, DI_MODULE_METADATA_KEY, ON_INIT_HOOK_METADATA_KEY, PROPERTY_INJECT_METADATA_KEY } from './const';
import { Inject, Injectable, OnInit } from './decorators';
import { DefineMetadataOptions, GetMetadataOptions, IMetadataStore, MetadataStore } from './metadata-store';
import {
    BaseProviderOptions,
    ClassProviderOptions,
    DepIdentifier,
    DIModuleOptions,
    FactoryProviderOptions,
    InjectOptions,
    isClassProviderOptions, 
    isFactoryProviderOptions, 
    isValueProviderOptions, 
    Middleware, 
    MiddlewareAsync,
    ParameterInjectMetadata, PropertyInjectMetadata, ProviderOptions,
    Token
} from './types';
import { hasConstructor, makeDIToken } from './utils';


export class DIContainer {
    
    private providers = new Map<symbol, ProviderOptions<any>>();

    private cache = new Map<symbol, any>();
    private resolving = new Map<symbol, any>();
    private middlewares: Middleware<any>[] = [];
    private asyncMiddlewares: MiddlewareAsync<any>[] = [];
    private childContainers = new Set<DIContainer>();

    private static rootInstance: DIContainer;

    static get ROOT(): DIContainer {
        if (!this.rootInstance) {
            this.rootInstance = new DIContainer();
        }
        return this.rootInstance;
    }
    
    constructor(private metadataStore: IMetadataStore = new MetadataStore(), private parentContainer?: DIContainer) {
        // to ensure destructuring works correctly
        this.Injectable = this.Injectable.bind(this);
        this.Inject = this.Inject.bind(this);
        this.OnInit = this.OnInit.bind(this);
    }
    
    createChildContainer(metadataStore: IMetadataStore = this.metadataStore): DIContainer {
        const child = new DIContainer(metadataStore, this);
        this.childContainers.add(child);
        return child;
    }

    createToken<T>(tokenOrType: DepIdentifier<T>): Token<T> {
        return makeDIToken(tokenOrType);
    }

    register<T>(options: ProviderOptions<T> & { name: string }) {
        const token = this.createToken(options.name);

        const optionsCopy = { 
            ...options, 
            priority: options.priority !== undefined ? options.priority : 0,
            singleton: options.singleton !== undefined ? options.singleton : true,
        };
        
        // DO not register the provider if condition is not met
        if (optionsCopy.condition && !optionsCopy.condition()) return;
        
        this.validateProviderOptions(optionsCopy, token);

        // Do not override existing provider if it has higher priority; but override if it has lower or similar priority
        const existingProvider = this.providers.get(token);
        if(existingProvider){
            if (existingProvider.priority !== undefined && optionsCopy.priority !== undefined && optionsCopy.priority < existingProvider.priority) {
                return; 
            } else {
                console.warn(`Provider ${String(token)} is being overwritten. The existing instance will be removed from the cache if applicable.`);
            }
        }

        // ensure reregistration overwrites the existing provider and the cache if any
        if (optionsCopy.singleton && this.cache.has(token)) {
            this.cache.delete(token);
        }

        this.providers.set(token, optionsCopy);
    }

    importModule(target: any){

        const moduleMeta = this.getMetadata<DIModuleOptions>({
            target: target,
            key: DI_MODULE_METADATA_KEY,
        });

        if(!moduleMeta){
            throw new Error(`Module ${target.name} does not have any metadata, make sure it's decorated with @DIModule`);
        }

        const { imports = [], exports = [], providers = [], identifier } = moduleMeta;

        const moduleContainer = this.createChildContainer(); // TODO: annotate the container with some metadata for debugging
        
        // make sure all the module providers are loaded into the module's container's providers
        for (const provider of providers) {
            moduleContainer.register(provider);
        }
        // and make sure all the module exports are also loaded into the module's container's providers
        for( const importedModule of imports) {
            moduleContainer.importModule(importedModule);
        }

        // load all the export from this module into the current container
        for( const exportedDep of exports) {
            if(moduleContainer.has(exportedDep)){
                const token = moduleContainer.createToken(exportedDep);
                // TODO: need a conflict resolution strategy
                // make sure to handle the conflicts with actual providers;
                // maybe use provider aliases or annotate the providers with the module's identifier
                this.register({
                    // make sure the dependency is resolved by the actual module; 
                    // that way any overrides/interceptors are applied properly
                    name: String(token), // TODO: change the name to {provide: depNameOrToken, ...rest}
                    useFactory: () => moduleContainer.resolve(token),
                });
            } else {
                throw new Error(`Module ${moduleContainer.constructor.name} does not provide ${String(exportedDep)}`);
            }
        }

        // TODO: module lifecycle hooks

        return {
            identifier,
            container: moduleContainer
        }
    }

    registerModuleMetadata(target: any, options: PartialBy<DIModuleOptions, 'identifier'>) {
        options.identifier = options.identifier || target;
        this.defineMetadata({
            target: target,
            key: DI_MODULE_METADATA_KEY,
            value: { 
                ...options, 
                identifier: this.createToken(target) 
            },
        });
    }

    registerConstructorDependency<T>( target: any, parameterIndex: number, depNameOrToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
        const token = this.createToken(depNameOrToken);

        const existingDependencies = this.getMetadata<{ [key: number]: ParameterInjectMetadata<T> }>({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            target: target
        }) || {};

        existingDependencies[parameterIndex] = { ...options, token };

        this.defineMetadata({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            value: existingDependencies,
            target: target
        });
    }

    registerPropertyDependency<T>( target: any, propertyKey: string | symbol, depNameOrToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
        const token = this.createToken(depNameOrToken);

        const existingDependencies = this.getMetadata<PropertyInjectMetadata<T>[]>({
            key: PROPERTY_INJECT_METADATA_KEY,
            target
        }) || [];

        existingDependencies.push({ ...options, token, propertyKey });

        this.defineMetadata({
            key: PROPERTY_INJECT_METADATA_KEY,
            value: existingDependencies,
            target
        });
    }

    registerOnInitHook(target: any, propertyKey: string | symbol) {
        this.defineMetadata({
            key: ON_INIT_HOOK_METADATA_KEY,
            value: propertyKey,
            target
        });
    }

    removeProvider(depNameOrToken: DepIdentifier) {
        const token = this.createToken(depNameOrToken);
        this.providers.delete(token);
        this.cache.delete(token);
    }

    registerInParentContainer<T>(options: ProviderOptions<T> & { name: string }) {
        if (this.parentContainer) {
            this.parentContainer.register(options);
        } else {
            throw new Error('No parent container to add the provider to.');
        }
    }

    resolve<T>(depNameOrToken: DepIdentifier, path: Set<Token<any>> = new Set()): T {
        const token = this.createToken(depNameOrToken);
        let options = this.providers.get(token);
        if (!options) {
            if (this.parentContainer) {
                return this.parentContainer.resolve(depNameOrToken, path);
            }
            console.error('No provider found for:', { token, path });
            throw new Error(`No provider found for ${token.toString()}`);
        }

        if (options.singleton && this.cache.has(token)) {
            return this.cache.get(token);
        }

        if (this.resolving.has(token)) {
            return this.resolving.get(token);
        }

        if (path.has(token)) {
            throw new Error(`Circular dependency detected: ${Array.from(path).join(' -> ')} -> ${token.toString()}`);
        }

        path.add(token);
        return this.applyMiddlewares(
            () => this.createAndCacheInstance(token, options, path)
        );
    }

    private validateProviderOptions<T>(options: ProviderOptions<T>, token: Token<any>) {
        if (isClassProviderOptions(options) && !options.useClass) {
            throw new Error(`Invalid provider configuration for ${token.toString()}. useClass is required for class providers`);
        } else if (isFactoryProviderOptions(options) && !options.useFactory) {
            throw new Error(`Invalid provider configuration for ${token.toString()}. useFactory is required for factory providers`);
        } else if (isValueProviderOptions(options) && options.useValue === undefined) {
            throw new Error(`Invalid provider configuration for ${token.toString()}. useValue is required for value providers`);
        } else if (!isClassProviderOptions(options) && !isFactoryProviderOptions(options) && !isValueProviderOptions(options)) {
            throw new Error(`Invalid provider configuration for ${token.toString()}`);
        }
    }

    private createAndCacheInstance<T>(token: Token<any>, options: ProviderOptions<T>, path: Set<Token<any>>): T {
        const instance = this.createInstance(token, options, path);
        if (options.singleton) {
            this.cache.set(token, instance);
        }
        this.resolving.delete(token);
        this.injectProperties(instance);
        this.initializeInstance(instance);
        path.delete(token);
        return instance;
    }

    private createInstance<T>(token: Token<any>, options: ProviderOptions<T>, path: Set<Token<any>>): T {
        if (isClassProviderOptions(options)) {
            return this.createClassInstance(token, options, path);
        } else if (isFactoryProviderOptions(options)) {
            return this.createFactoryInstance(options, path);
        } else if (isValueProviderOptions(options)) {
            return options.useValue;
        } else {
            throw new Error(`Provider for ${token.toString()} is not correctly configured`);
        }
    }

    private createClassInstance<T>(token: Token<any>, options: ClassProviderOptions<T>, path: Set<Token<any>>): T {

        if (this.resolving.has(token)) {
            return this.resolving.get(token);
        }

        // Create a placeholder object and store it in the resolving map
        const instancePlaceholder: T = Object.create(options.useClass.prototype);
        this.resolving.set(token, instancePlaceholder);

        const dependencies = this.resolveDependencies(options.useClass, path);
        const actualInstance = new options.useClass(...dependencies);
        Object.assign(instancePlaceholder as any, actualInstance);

        this.resolving.set(token, actualInstance);

        return actualInstance;
    }

    private createFactoryInstance<T>(options: FactoryProviderOptions<T>, path: Set<Token<any>>): T {
        const dependencies = (options.deps || []).map(dep => this.resolve(dep, path));
        return options.useFactory(...dependencies);
    }

    private resolveDependencies<T>(target: T, path: Set<Token<any>>): any[] {
        const injectMetadata = this.getMetadata<{ [key: number]: ParameterInjectMetadata<T> }>({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            target: target
        }) || {};

        return Object.values(injectMetadata).map(dep => {
            try {
                return this.resolve(dep.token, path);
            } catch (error) {
                if (dep.isOptional) return dep.defaultValue !== undefined ? dep.defaultValue : undefined;
                throw error;
            }
        });
    }

    private initializeInstance<T>(instance: T): void {
        if (!hasConstructor(instance)) return;

        const initMethod = this.getMetadata<keyof typeof instance>({
            key: ON_INIT_HOOK_METADATA_KEY,
            target: instance.constructor.prototype
        });

        if (initMethod) {
            const theInitMethod = instance[initMethod] as Function;
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

        const dependencies = this.getMetadata<PropertyInjectMetadata<T>[]>({
            key: PROPERTY_INJECT_METADATA_KEY,
            target: instance.constructor.prototype
        }) || [];

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

    has(depNameOrToken: DepIdentifier): boolean {
        const token = this.createToken(depNameOrToken);
        return this.providers.has(token);
    }

    clear(clearChildContainers = true) {
        this.providers.clear();
        this.cache.clear();
        this.metadataStore.clear();
        this.resolving.clear();
        if(clearChildContainers){
            this.childContainers.forEach(container => container.clear());
        }
    }

    defineMetadata<T = any>(options: DefineMetadataOptions<T>) {
        this.metadataStore.defineMetadata(options);
    }

    getMetadata<T = any>(options: GetMetadataOptions): T | undefined {
        return this.metadataStore.getMetadata(options) || this.parentContainer?.getMetadata(options);
    }

    hasMetadata(key: string | symbol, target: any): boolean {
        return this.metadataStore.hasMetadata(key, target) || this.parentContainer?.hasMetadata(key, target) === true;
    }

    Injectable(options: PartialBy<BaseProviderOptions, 'name'> = {}) {
        return Injectable(options, this);
    }

    Inject<T>(depNameOrToken: DepIdentifier<T>, options: InjectOptions = {}) {
        return Inject(depNameOrToken, options, this);
    }

    OnInit() {
        return OnInit(this);
    }

    useMiddleware({middleware, order = 1}: PartialBy<Middleware<any>, 'order' >) {
        this.middlewares.push({ middleware, order });
        this.middlewares.sort((a, b) => a.order - b.order);
    }

    useAsyncMiddleware({middleware, order = 1}: PartialBy<MiddlewareAsync<any>, 'order'> ) {
        this.asyncMiddlewares.push({ middleware, order });
        this.asyncMiddlewares.sort((a, b) => a.order - b.order);
    }

    private applyMiddlewares<T>(next: () => T): T {
        let index = -1;

        const dispatch = (i: number): T => {
            if (i <= index) {
                throw new Error('next() called multiple times');
            }
            
            index = i;

            if (i >= this.middlewares.length) {
                return next(); // Ensure we don't access out of bounds
            }

            const middlewareInfo = this.middlewares[i];
            const middleware = middlewareInfo?.middleware;

            if (middleware) {
                return middleware(() => dispatch(i + 1));
            }

            return next();
        };

        return dispatch(0);
    }

    async resolveAsync<T>(depNameOrToken: DepIdentifier, path: Set<Token<any>> = new Set()): Promise<T> {
        const token = this.createToken(depNameOrToken);

        let options = this.providers.get(token);
        if (!options) {
            if (this.parentContainer) {
                return this.parentContainer.resolve(depNameOrToken, path);
            }
            console.error('No provider found for:', { token, path });
            throw new Error(`No provider found for ${token.toString()}`);
        }

        if (options.singleton && this.cache.has(token)) {
            return this.cache.get(token);
        }

        if (this.resolving.has(token)) {
            return this.resolving.get(token);
        }

        if (path.has(token)) {
            // should not be needed; left here for debugging/testing purposes
            throw new Error(`Circular dependency detected: ${Array.from(path).join(' -> ')} -> ${token.toString()}`);
        }

        path.add(token);

        return this.applyAsyncMiddlewares(
            () => this.createAndCacheInstanceAsync(token, options, path)
        );
    }

    private async createAndCacheInstanceAsync<T>(token: Token<any>, options: ProviderOptions<T>, path: Set<Token<any>>): Promise<T> {
        const instance = await this.createInstanceAsync(token, options, path);
        if (options.singleton) {
            this.cache.set(token, instance);
        }

        this.resolving.delete(token);
        await this.injectPropertiesAsync(instance);
        await this.initializeInstanceAsync(instance);
        path.delete(token);

        return instance;
    }

    private async createInstanceAsync<T>(token: Token<any>, options: ProviderOptions<T>, path: Set<Token<any>>): Promise<T> {
        if (isClassProviderOptions(options)) {
            return this.createClassInstanceAsync(token, options, path);
        } else if (isFactoryProviderOptions(options)) {
            return this.createFactoryInstanceAsync(options, path);
        } else if (isValueProviderOptions(options)) {
            return options.useValue;
        } else {
            throw new Error(`Provider for ${token.toString()} is not correctly configured`);
        }
    }

    private async createClassInstanceAsync<T>(token: Token<any>, options: ClassProviderOptions<T>, path: Set<Token<any>>): Promise<T> {

        if (this.resolving.has(token)) {
            return this.resolving.get(token);
        }

        // Create a placeholder object and store it in the resolving map
        const instancePlaceholder: T = Object.create(options.useClass.prototype);
        this.resolving.set(token, instancePlaceholder);

        const dependencies = await this.resolveDependenciesAsync(options.useClass, path);
        const actualInstance = new options.useClass(...dependencies);
        Object.assign(instancePlaceholder as any, actualInstance);

        // Replace the placeholder instance in the resolving map with the actual instance
        this.resolving.set(token, actualInstance);

        return actualInstance;
    }

    private async resolveDependenciesAsync<T>(target: T, path: Set<Token<any>>): Promise<any[]> {
        const injectMetadata = this.getMetadata<{ [key: number]: ParameterInjectMetadata<T> }>({
            key: CONSTRUCTOR_INJECT_METADATA_KEY,
            target: target
        }) || {};

        return await Promise.all(Object.values(injectMetadata).map(async dep => {
            try {
                return await this.resolveAsync(dep.token, path);
            } catch (error) {
                if (dep.isOptional) return dep.defaultValue !== undefined ? dep.defaultValue : undefined;
                throw error;
            }
        }));
    }

    private async initializeInstanceAsync<T>(instance: T): Promise<void> {
        if (!hasConstructor(instance)) return;

        const initMethod = this.getMetadata<keyof typeof instance>({
            key: ON_INIT_HOOK_METADATA_KEY,
            target: instance.constructor.prototype
        });

        if (initMethod) {
            const theInitMethod = instance[initMethod] as Function;
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

    private async createFactoryInstanceAsync<T>(options: FactoryProviderOptions<T>, path: Set<Token<any>>): Promise<T> {
        const dependencies = await Promise.all((options.deps || []).map(dep => this.resolveAsync(dep, path)));
        return options.useFactory(...dependencies);
    }

    private async injectPropertiesAsync<T>(instance: T): Promise<void> {
        if (!hasConstructor(instance)) return;

        const dependencies = this.getMetadata<PropertyInjectMetadata<T>[]>({
            key: PROPERTY_INJECT_METADATA_KEY,
            target: instance.constructor.prototype
        }) || [];

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

    private async applyAsyncMiddlewares<T>(next: () => Promise<T>): Promise<T> {
        let index = -1;

        const dispatch = async (i: number): Promise<T> => {
            if (i <= index) {
                throw new Error('next() called multiple times');
            }
            index = i;

            if (i >= this.asyncMiddlewares.length) {
                return next(); // Ensure we don't access out of bounds
            }

            const middlewareInfo = this.asyncMiddlewares[i];
            const middleware = middlewareInfo?.middleware;

            if (middleware) {
                return await middleware(() => dispatch(i + 1));
            }

            return next();
        };

        return dispatch(0);
    }
}
