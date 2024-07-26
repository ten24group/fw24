import { INJECT_KEY, INJECTABLE_KEY, ON_INIT_KEY } from './const';
import { DefineMetadataOptions, GetMetadataOptions, IMetadataStore, MetadataStore } from './metadata-store';
import { createToken, hasConstructor } from './utils';

export type Token<T> = symbol & { __type?: T };

export type ProviderOptions<T> = {
    useClass?: new (...args: any[]) => T;
    useFactory?: (...args: any[]) => Promise<T> | T;
    useValue?: T;
    deps?: any[];
    singleton?: boolean;
    name?: string;
    condition?: () => boolean;
};

export class DependencyRegistry {
    private providers = new Map<string, ProviderOptions<any>>();
    private singletons = new Map<string, any>();

    constructor(private metadataStore: IMetadataStore = new MetadataStore() ) {}

    register<T>(token: Token<T>, options: ProviderOptions<T>) {

        if (options.condition && !options.condition()) {
            return;
        }

        if(!options.hasOwnProperty('singleton') || options.singleton === undefined) {
            options.singleton = true;
        }

        const tokenKey = this.getTokenKey(token, options.name);
        this.providers.set(tokenKey, options);
    }

    async resolve<T>(depNameOrToken: string | Token<T>, name?: string, path: string[] = []): Promise<T> {

        if (typeof depNameOrToken === 'string') {
            const token = createToken<T>(depNameOrToken);
            return this.resolve<T>(token);
        }
        
        const token = depNameOrToken;
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

        if (options.useClass) {
            const injectMetadata = this.getMetadata<{ [key: number]: { token: Token<any>; name?: string } }>({
                key: INJECT_KEY,
                target: options.useClass
            }) || {};
            const dependencies = await Promise.all(
                Object.values(injectMetadata).map(dep => this.resolve(dep.token, dep.name, [...path, providerKey]))
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

        if(hasConstructor(instance)) {
            const initMethod = this.getMetadata<keyof typeof instance>({
                key: ON_INIT_KEY,
                target: instance.constructor.prototype
            });

            if (initMethod) {
                const theInitMethod = instance[initMethod] as Function;
                if (typeof theInitMethod === 'function') {
                    await theInitMethod();
                } else {
                    throw new Error('theInitMethod is not a function');
                }
            }
        }

        return instance;
    }

    resolveAll<T>(token: Token<T>): Promise<T[]> {
        const providerKey = this.getTokenKey(token);
        const providers = this.providers.get(providerKey);
        return Promise.all((providers ? [providers] : []).map(options => this.resolve(token, options.name)));
    }

    private isInjectable(target: any): boolean {
        return this.hasMetadata(INJECTABLE_KEY, target);
    }

    private getTokenKey(token: Token<any>, name?: string): string {
        return name ? `${token.toString()}_${name}` : token.toString();
    }

    async clear() {
        this.providers.clear();
        this.singletons.clear();
        this.metadataStore.clear();
    }


    // Metadata storage methods
    defineMetadata<T extends any = any>(options: DefineMetadataOptions<T> ) {
        this.metadataStore.defineMetadata(options);
    }

    getMetadata<T extends any = any>(options: GetMetadataOptions): T | undefined {
        return this.metadataStore.getMetadata(options);
    }

    hasMetadata(key: string | symbol, target: any): boolean {
        return this.metadataStore.hasMetadata(key, target)
    }
}

export const registry = new DependencyRegistry();

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

