// di.ts

const INJECTABLE_KEY = 'INJECTABLE';
const DEPENDENCIES_KEY = 'DEPENDENCIES';
const INJECT_KEY = 'INJECT';
const LAZY_KEY = 'LAZY';
const ON_INIT_KEY = 'ON_INIT';
const ON_DESTROY_KEY = 'ON_DESTROY';

type Token<T> = symbol & { __type?: T };

type ProviderOptions<T> = {
    useClass?: new (...args: any[]) => T;
    useFactory?: (...args: any[]) => Promise<T> | T;
    useValue?: T;
    deps?: any[];
    singleton?: boolean;
    name?: string;
    lazy?: boolean;
    condition?: () => boolean;
};

class MetadataStorage {
    private metadata = new Map<any, Map<string | symbol, any>>();

    defineMetadata(key: string | symbol, value: any, target: any, propertyKey?: string | symbol) {
        if (!this.metadata.has(target)) {
            this.metadata.set(target, new Map());
        }
        const targetMetadata = this.metadata.get(target)!;
        const metaKey = propertyKey !== undefined ? `${String(propertyKey)}_${String(key)}` : String(key);
        targetMetadata.set(metaKey, value);
    }

    getMetadata(key: string | symbol, target: any, propertyKey?: string | symbol): any {
        if (!this.metadata.has(target)) {
            return undefined;
        }
        const targetMetadata = this.metadata.get(target)!;
        const metaKey = propertyKey !== undefined ? `${String(propertyKey)}_${String(key)}` : String(key);
        return targetMetadata.get(metaKey);
    }

    hasMetadata(key: string | symbol, target: any): boolean {
        return this.metadata.has(target) && this.metadata.get(target)!.has(String(key));
    }
}

const metadataStorage = new MetadataStorage();

class DependencyRegistry {
    private providers = new Map<string, ProviderOptions<any>>();
    private singletons = new Map<string, any>();

    register<T>(token: Token<T>, options: ProviderOptions<T>) {
        if (options.useClass && !this.isInjectable(options.useClass)) {
            throw new Error(`Provider ${options.useClass.name} is not annotated with @Injectable`);
        }
        if (options.condition && !options.condition()) {
            return;
        }
        const tokenKey = this.getTokenKey(token, options.name);
        this.providers.set(tokenKey, options);
    }

    async resolve<T>(token: Token<T>, name?: string, path: string[] = []): Promise<T> {
        const providerKey = this.getTokenKey(token, name);
        const options = this.providers.get(providerKey);

        if (!options) {
            throw new Error(`No provider found for ${token.toString()}`);
        }

        if (options.singleton) {
            if (this.singletons.has(providerKey)) {
                return this.singletons.get(providerKey);
            }
        }

        if (path.includes(providerKey)) {
            throw new Error(`Circular dependency detected: ${path.join(' -> ')} -> ${providerKey}`);
        }

        let instance: T;
        if (options.lazy && !options.singleton) {
            return (async () => this.resolve(token, name, path)) as unknown as T;
        }

        if (options.useClass) {
            const dependencies = await Promise.all(
                this.getDependencies(options.useClass).map(dep => this.resolve(dep.token, dep.name, [...path, providerKey]))
            );
            instance = new options.useClass(...dependencies);
        } else if (options.useFactory) {
            const dependencies = await Promise.all((options.deps || []).map(dep => this.resolve(dep, undefined, [...path, providerKey])));
            instance = await options.useFactory(...dependencies);
        } else if (options.useValue !== undefined) {
            instance = options.useValue;
        } else {
            throw new Error(`Provider for ${token.toString()} is not correctly configured`);
        }

        if (options.singleton) {
            this.singletons.set(providerKey, instance);
        }

        if ((instance as any)[ON_INIT_KEY]) {
            const onInit = (instance as any)[ON_INIT_KEY].bind(instance);
            await onInit();
        }

        return instance;
    }

    resolveAll<T>(token: Token<T>): Promise<T[]> {
        const providerKey = this.getTokenKey(token);
        const providers = this.providers.get(providerKey);
        return Promise.all((providers ? [providers] : []).map(options => this.resolve(token, options.name)));
    }

    private isInjectable(target: any): boolean {
        return metadataStorage.hasMetadata(INJECTABLE_KEY, target);
    }

    private getDependencies(target: any): Array<{ token: any, name?: string }> {
        const paramTypes = metadataStorage.getMetadata('design:paramtypes', target) || [];
        const injectMetadata = metadataStorage.getMetadata(INJECT_KEY, target) || {};
        return paramTypes.map((dep: any, index: number) => injectMetadata[index] || { token: dep });
    }

    private getTokenKey(token: Token<any>, name?: string): string {
        return name ? `${token.toString()}_${name}` : token.toString();
    }
}

export const registry = new DependencyRegistry();

/**
 * Create a unique token for dependency injection with namespacing.
 * @param description The description for the token.
 * @param namespace The namespace for the token.
 */
export function createToken<T>(description: string, namespace: string): Token<T> {
    return Symbol(`${namespace}:${description}`) as Token<T>;
}

/**
 * Annotate a class as injectable.
 * @param options The options for the injectable.
 */
export function Injectable(options: { singleton?: boolean, name?: string } = {}): ClassDecorator {
    return (target: any) => {
        metadataStorage.defineMetadata(INJECTABLE_KEY, true, target);
        registry.register(target as unknown as Token<any>, { useClass: target as unknown as new (...args: any[]) => any, singleton: options.singleton, name: options.name });
    };
}

/**
 * Annotate a property or parameter for injection.
 * @param token The token to inject.
 * @param name An optional name for the token.
 */
export function Inject<T>(token: Token<T>, name?: string): PropertyDecorator & ParameterDecorator {
    return (target: Object, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
        if (typeof parameterIndex === 'number') {
            const existingDependencies = metadataStorage.getMetadata(INJECT_KEY, target) || {};
            existingDependencies[parameterIndex] = { token, name };
            metadataStorage.defineMetadata(INJECT_KEY, existingDependencies, target);
        } else if (propertyKey !== undefined) {
            const existingDependencies = metadataStorage.getMetadata(DEPENDENCIES_KEY, target) || [];
            existingDependencies.push({ token, name, propertyKey });
            metadataStorage.defineMetadata(DEPENDENCIES_KEY, existingDependencies, target);
        }
    };
}

/**
 * Annotate a class to be conditionally provided.
 * @param condition The condition for providing the class.
 */
export function Conditional(condition: () => boolean): ClassDecorator {
    return (target: any) => {
        const options = metadataStorage.getMetadata(INJECTABLE_KEY, target) || {};
        options.condition = condition;
        registry.register(target as unknown as Token<any>, { ...options, useClass: target as unknown as new (...args: any[]) => any });
    };
}

/**
 * Annotate a property for lazy initialization.
 */
export function Lazy(): PropertyDecorator {
    return (target, propertyKey) => {
        metadataStorage.defineMetadata(LAZY_KEY, true, target, propertyKey);
    };
}

/**
 * Annotate a method to be called on initialization.
 */
export function OnInit(): MethodDecorator {
    return (target, propertyKey) => {
        metadataStorage.defineMetadata(ON_INIT_KEY, target, propertyKey);
    };
}

/**
 * Annotate a method to be called on destruction.
 */
export function OnDestroy(): MethodDecorator {
    return (target, propertyKey) => {
        metadataStorage.defineMetadata(ON_DESTROY_KEY, target, propertyKey);
    };
}

/**
 * Resolve all instances of a token.
 * @param token The token to resolve all instances for.
 */
export function resolveAll<T>(token: Token<T>): Promise<T[]> {
    return registry.resolveAll(token);
}

/**
 * Register a provider manually.
 * @param token The token to register the provider for.
 * @param options The options for the provider.
 */
export function registerProvider<T>(token: Token<T>, options: ProviderOptions<T>) {
    registry.register(token, options);
}
