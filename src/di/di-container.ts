import { PROPERTY_INJECT_KEY, CONSTRUCTOR_INJECT_KEY, ON_INIT_METHOD_KEY } from './const';
import { Inject, Injectable, InjectOptions, OnInit } from './decorators';
import { DefineMetadataOptions, GetMetadataOptions, IMetadataStore, MetadataStore } from './metadata-store';
import { 
  BaseProviderOptions, ClassProviderOptions, DepIdentifier, FactoryProviderOptions, 
  isClassProviderOptions, isFactoryProviderOptions, isValueProviderOptions, ProviderOptions, 
  Token 
} from './types';
import { makeDIToken, hasConstructor } from './utils';

type Middleware<T> = (next: () => T) => T;
type MiddlewareAsync<T> = (next: () => Promise<T>) => Promise<T>;

export class DIContainer {
    
    private providers = new Map<symbol, ProviderOptions<any>>();
    private cache = new Map<symbol, any>();
    private resolving = new Map<symbol, any>();
    private middlewares: Middleware<any>[] = [];
    private asyncMiddlewares: MiddlewareAsync<any>[] = [];
    private childContainers = new Set<DIContainer>();

    private static globalInstance: DIContainer;
    static get INSTANCE(): DIContainer {
        if (!this.globalInstance) {
            this.globalInstance = new DIContainer();
        }
        return this.globalInstance;
    }
    
    constructor(private metadataStore: IMetadataStore = new MetadataStore(), private parentContainer?: DIContainer) {}
    
    createChildContainer(metadataStore: IMetadataStore = this.metadataStore): DIContainer {
        const child = new DIContainer(metadataStore, this);
        this.childContainers.add(child);
        return child;
    }

    register<T>(options: ProviderOptions<T> & { name: string }) {
        const token = makeDIToken(options.name);

        if (options.condition && !options.condition()) return;

        this.validateProviderOptions(options, token);

        const optionsCopy = { ...options, singleton: options.singleton !== undefined ? options.singleton : true };

        // ensure reregistration overwrites the existing provider and the cache if any
        if (optionsCopy.singleton && this.cache.has(token)) {
            console.warn(`Provider ${String(token)} is being overwritten. The existing instance will be removed from the cache.`);
            this.cache.delete(token);
        }

        this.providers.set(token, optionsCopy);
    }

    registerInParentContainer<T>(options: ProviderOptions<T> & { name: string }) {
        if (this.parentContainer) {
            this.parentContainer.register(options);
        } else {
            throw new Error('No parent container to add the provider to.');
        }
    }

    registerInRootContainer<T>(options: ProviderOptions<T> & { name: string }) {
        let rootContainer = this as DIContainer;
        while (rootContainer.parentContainer) {
            rootContainer = rootContainer.parentContainer;
        }
        rootContainer.register(options);
    }

    useMiddleware(middleware: Middleware<any>) {
        this.middlewares.push(middleware);
    }

    useAsyncMiddleware(middleware: MiddlewareAsync<any>) {
        this.asyncMiddlewares.push(middleware);
    }

    resolve<T>(depNameOrToken: DepIdentifier, path: Set<Token<any>> = new Set()): T {
        const token = makeDIToken(depNameOrToken);
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

    async resolveAsync<T>(depNameOrToken: DepIdentifier, path: Set<Token<any>> = new Set()): Promise<T> {
        const token = makeDIToken(depNameOrToken);

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

    private createFactoryInstance<T>(options: FactoryProviderOptions<T>, path: Set<Token<any>>): T {
        const dependencies = (options.deps || []).map(dep => this.resolve(dep, path));
        return options.useFactory(...dependencies);
    }

    private async createFactoryInstanceAsync<T>(options: FactoryProviderOptions<T>, path: Set<Token<any>>): Promise<T> {
        const dependencies = await Promise.all((options.deps || []).map(dep => this.resolveAsync(dep, path)));
        return options.useFactory(...dependencies);
    }

    private resolveDependencies<T>(target: T, path: Set<Token<any>>): any[] {
        const injectMetadata = this.getMetadata<{ [key: number]: { token: Token<any>, isOptional?: boolean } }>({
            key: CONSTRUCTOR_INJECT_KEY,
            target: target
        }) || {};

        return Object.values(injectMetadata).map(dep => {
            try {
                return this.resolve(dep.token, path);
            } catch (error) {
                if (dep.isOptional) return undefined;
                throw error;
            }
        });
    }

    private async resolveDependenciesAsync<T>(target: T, path: Set<Token<any>>): Promise<any[]> {
        const injectMetadata = this.getMetadata<{ [key: number]: { token: Token<any>, isOptional?: boolean } }>({
            key: CONSTRUCTOR_INJECT_KEY,
            target: target
        }) || {};

        return await Promise.all(Object.values(injectMetadata).map(async dep => {
            try {
                return await this.resolveAsync(dep.token, path);
            } catch (error) {
                if (dep.isOptional) return undefined;
                throw error;
            }
        }));
    }

    private initializeInstance<T>(instance: T): void {
        if (!hasConstructor(instance)) return;

        const initMethod = this.getMetadata<keyof typeof instance>({
            key: ON_INIT_METHOD_KEY,
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

    private async initializeInstanceAsync<T>(instance: T): Promise<void> {
        if (!hasConstructor(instance)) return;

        const initMethod = this.getMetadata<keyof typeof instance>({
            key: ON_INIT_METHOD_KEY,
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

    private injectProperties<T>(instance: T): void {
        if (!hasConstructor(instance)) return;

        const dependencies = this.getMetadata<{ propertyKey: string | symbol, token: Token<any>, isOptional?: boolean }[]>({
            key: PROPERTY_INJECT_KEY,
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

    private async injectPropertiesAsync<T>(instance: T): Promise<void> {
        if (!hasConstructor(instance)) return;

        const dependencies = this.getMetadata<{ propertyKey: string | symbol, token: Token<any>, isOptional?: boolean }[]>({
            key: PROPERTY_INJECT_KEY,
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

    has(depNameOrToken: DepIdentifier): boolean {
        const token = makeDIToken(depNameOrToken);
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

    Injectable(options: BaseProviderOptions = {}) {
        return Injectable(options, this);
    }

    Inject<T>(depNameOrToken: DepIdentifier<T>, options: InjectOptions = {}) {
        return Inject(depNameOrToken, options, this);
    }

    OnInit() {
        return OnInit(this);
    }

    private applyMiddlewares<T>(next: () => T): T {
        let index = -1;

        const dispatch = (i: number): T => {
            if (i <= index) throw new Error('next() called multiple times');
            index = i;
            const middleware = this.middlewares[i];
            if (middleware) {
                return middleware(() => dispatch(i + 1));
            }
            return next();
        };

        return dispatch(0);
    }

    private async applyAsyncMiddlewares<T>(next: () => Promise<T>): Promise<T> {
        let index = -1;

        const dispatch = async (i: number): Promise<T> => {
            if (i <= index) throw new Error('next() called multiple times');
            index = i;
            const middleware = this.asyncMiddlewares[i];
            if (middleware) {
                return await middleware(() => dispatch(i + 1));
            }
            return next();
        };

        return dispatch(0);
    }
}

/**
 * Register a provider manually.
 * @param options The options for the provider.
 */
export function registerProvider<T>(options: ProviderOptions<T> & { name: string}, container: DIContainer = DIContainer.INSTANCE ) {
    return container.register(options);
}
