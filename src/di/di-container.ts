import { INJECT_KEY, ON_INIT_KEY } from './const';
import { DefineMetadataOptions, GetMetadataOptions, IMetadataStore, MetadataStore } from './metadata-store';
import { DepIdentifier, isClassProviderOptions, isFactoryProviderOptions, isValueProviderOptions, ProviderOptions, Token } from './types';
import { makeDIToken, hasConstructor } from './utils';


export class DIContainer {

    public static INSTANCE: DIContainer;

    private providers = new Map<string, ProviderOptions<any>>();
    private cache = new Map<string, any>();

    constructor(private metadataStore: IMetadataStore = new MetadataStore() ) {};

    register<T>(options: ProviderOptions<T> & { name: string }) {

        const token = makeDIToken(options.name);

        if (options.condition && !options.condition()) {
            return;
        }

        if(!options.hasOwnProperty('singleton') || options.singleton === undefined) {
            options.singleton = true;
        }

        const providerKey = this.getProviderIdentifier(token);
        this.providers.set(providerKey, options);
    }

    resolve<T>(depNameOrToken: DepIdentifier, path: Set<string> = new Set()): T {
        const token = makeDIToken(depNameOrToken);
        const providerKey = this.getProviderIdentifier(token);
        const options = this.providers.get(providerKey);

        if (!options) {
            console.error('++resolve++', { token, path, providers: this.providers, providerKey });
            throw new Error(`No provider found for ${token.toString()}`);
        }

        if (options.singleton && this.cache.has(providerKey)) {
            return this.cache.get(providerKey);
        }

        if (path.has(providerKey)) {
            throw new Error(`Circular dependency detected: ${Array.from(path).join(' -> ')} -> ${providerKey}`);
        }

        path.add(providerKey);

        let instance: T;

        if (isClassProviderOptions(options)) {

            const injectMetadata = this.getMetadata<{ [key: number]: { token: Token<any> } }>({
                key: INJECT_KEY,
                target: options.useClass
            }) || {};

            const dependencies = Object.values(injectMetadata).map(
                dep => this.resolve(dep.token, new Set(path))
            );

            instance = new options.useClass(...dependencies);

        } else if ( isFactoryProviderOptions(options) ) {

            const dependencies = (options.deps || []).map(dep => this.resolve(dep, new Set(path)));

            instance = options.useFactory(...dependencies);

        } else if ( isValueProviderOptions(options) ) {

            instance = options.useValue;

        } else {

            throw new Error(`Provider for ${token.toString()} is not correctly configured`);
        }

        if (options.singleton) {
            this.cache.set(providerKey, instance);
        }

        if(hasConstructor(instance)) {
            const initMethod = this.getMetadata<keyof typeof instance>({
                key: ON_INIT_KEY,
                target: instance.constructor.prototype
            });

            if (initMethod) {
                const theInitMethod = instance[initMethod] as Function;
                if (typeof theInitMethod === 'function') {
                    theInitMethod();
                } else {
                    throw new Error(`Initialization method ${theInitMethod} is not a function on ${instance.constructor.name}`);
                }
            }
        }

        path.delete(providerKey);

        return instance;
    }

    has(depNameOrToken: DepIdentifier,): boolean {
        const token = makeDIToken(depNameOrToken);
        const providerKey = this.getProviderIdentifier(token);
        return this.providers.has(providerKey);
    }

    private getProviderIdentifier(token: Token<any>): string {
        return token.toString();
    }

    clear() {
        this.providers.clear();
        this.cache.clear();
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

const registry = new DIContainer();
DIContainer.INSTANCE = registry;

/**
 * Register a provider manually.
 * @param token The token to register the provider for.
 * @param options The options for the provider.
 */
export function registerProvider<T>(options: ProviderOptions<T> & { name: string }) {
    return DIContainer.INSTANCE.register(options);
}



