import { useMetadataManager } from "../utils";
import { DIContainer } from "./di-container";
import { ClassConstructor, DepIdentifier, DIModuleOptions, InjectOptions, InternalProviderOptions, isAliasProviderOptions, isClassProviderOptions, isConfigProviderOptions, isFactoryProviderOptions, isValueProviderOptions, Middleware, MiddlewareAsync, ParameterInjectMetadata, PriorityCriteria, PropertyInjectMetadata, ProviderOptions, Token } from "./types";

export const PROPERTY_INJECT_METADATA_KEY = 'PROPERTY_DEPENDENCY';
export const CONSTRUCTOR_INJECT_METADATA_KEY = 'CONSTRUCTOR_DEPENDENCY';
export const ON_INIT_HOOK_METADATA_KEY = 'ON_INIT_HOOK';
export const DI_MODULE_METADATA_KEY = 'DI_MODULE';

export function isSerializedSymbol(token: string): boolean {
    const serializedSymbolPattern = /^Symbol\(.+\)$/;
    return serializedSymbolPattern.test(token);
}

export function getSymbolKey(token: string): string | null {
    
    const serializedSymbolPattern = /^Symbol\((.+)\)$/;

    const match = token.match(serializedSymbolPattern);

    return match ? match[1] : null;
}

export function makeDIToken<T>(tokenOrType: DepIdentifier<T>, namespace: string = 'fw24.di.token'): Token {

    // if it's a function use it's name as token
    if(typeof tokenOrType === 'function'){
        if(tokenOrType.hasOwnProperty('name') && tokenOrType.name){
            tokenOrType = tokenOrType.name;
        }
        //else if it's a class, use class-name as the token
        else if(hasConstructor(tokenOrType)){
            tokenOrType = tokenOrType.constructor.name;
        }
    } 

    if( !tokenOrType || !(tokenOrType || '').trim() ){
        throw new Error(`Invalid 'tokenOrType' ${String(tokenOrType)}`);
    }

    // if it's a serialized token, return it
    if(tokenOrType.startsWith(namespace)){
        return tokenOrType
    }

    // else namespace the token and return it
    return `${namespace}:${tokenOrType}`
}

export function stripDITokenNamespace(token: Token, namespace: string = 'fw24.di.token'): string {
    return token.replace(`${namespace}:`, '');
}

export function hasConstructor(obj: any): obj is { constructor: Function } {
    return obj && typeof obj.constructor === 'function' && obj.constructor.prototype;
}

export const DIMetadataStore = useMetadataManager({namespace: 'fw24:di'});

export type RegisterDIModuleMetadataOptions = Omit<DIModuleOptions, 'identifier' | 'container'>;

export function registerModuleMetadata(target: any, options: RegisterDIModuleMetadataOptions, override = false) {
    DIMetadataStore.setPropertyMetadata(target, DI_MODULE_METADATA_KEY, { 
        ...options, 
        identifier: makeDIToken(target) 
    }, override);
}

/**
 * Sets up Dependency Injection (DI) for a class and returns the DI container.
 *
 * @param target - The class for which DI is being set up.
 * @param options - DI options including the container and module configurations.
 * @param fallbackToRootContainer - Whether to use the default DIContainer.ROOT if resolvingContainer is not specified in di options.
 * @returns The DI container used for the setup.
 */
export function setupDIModule<T>(
	options: {
		target: ClassConstructor<T>,
		module: RegisterDIModuleMetadataOptions,
		fallbackToRootContainer?: boolean
	},
): DIContainer | undefined {

	const { target, module } = options;

	module.providedBy = module.providedBy || (options.fallbackToRootContainer ? DIContainer.ROOT : undefined);
	
	let resolvingContainer: DIContainer | undefined;

	if(typeof module.providedBy === 'function' ){

		const parentModuleMetadata = getModuleMetadata(module.providedBy);
		
		if(!parentModuleMetadata){
			throw new Error(`Invalid 'providedBy': [${module.providedBy.name}] option for ${target.name}. Ensure the class is decorated with @DIModule({...} || @Container({ module: {}})).`);
		}

		if(!parentModuleMetadata.container){
			console.warn("No container found in module's metadata, this should only happen during build time and when the module is imported into root container via an entry-layer, trying to get the container fro this module, from the ROOT ");

			if(DIContainer.ROOT.hasChildContainerById(parentModuleMetadata.identifier)){
				console.info(`child container found in ROOT for module: ${parentModuleMetadata.identifier}`);
				const container = DIContainer.ROOT.getChildContainerById(parentModuleMetadata.identifier);
				// the container in the ROOT will be a proxy, make sure to get the actual container out of the proxy
				parentModuleMetadata.container = container.proxyFor;
			} else {
				throw new Error(`no child container found in ROOT for module: ${parentModuleMetadata.identifier}; If it is supposed to have an entry, please make sure those configurations are in right order.`);
			}
        }

		if(!parentModuleMetadata.container!.proxies!.size){
			throw new Error(`Invalid 'providedBy': [${module.providedBy.name}] option for ${target.name}. Ensure the module is registered in a container.`);
		}

		if(parentModuleMetadata.container!.proxies!.size > 1){
			const childContainerIdentifiers = Array.from(parentModuleMetadata.container!.proxies.keys()).map(c => c.containerId);
			throw new Error(`Invalid 'providedBy': [${module.providedBy.name}] option for ${target.name}. The module has been imported by multiple other modules ${childContainerIdentifiers}, please specify a particular container instead of module-class`);
		}

		resolvingContainer = parentModuleMetadata.container.proxies.entries().next().value[1];

	} else if(module.providedBy instanceof DIContainer){

		resolvingContainer = module.providedBy;

	} else if(module.providedBy === 'ROOT'){

		resolvingContainer = DIContainer.ROOT;
	}

    if (module.providers || module.exports || module.imports) {
		
		if(!resolvingContainer){
			throw new Error(`Invalid 'providedBy' option for ${target.name}. Ensure it is either "ROOT" or an instance of DI container or a Module.`);
		}

		registerModuleMetadata(target, options.module);
		
		// register the module in the resolving container and use the module's container for resolving the controller instance
		resolvingContainer = resolvingContainer.module(target).container;
    }
    
    if (resolvingContainer) {
        // register the controller itself as a provider 
        resolvingContainer.register({ provide: target, useClass: target, tags: ['_internal_'] });
    }

    return resolvingContainer;
}

export function registerConstructorDependency<T>( target: any, parameterIndex: number, dependencyToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
    const token = makeDIToken(dependencyToken);

    const existingDependencies: ParameterInjectMetadata<T>[] = DIMetadataStore.getPropertyMetadata(
        target,
        CONSTRUCTOR_INJECT_METADATA_KEY,
    ) || [];
    
    existingDependencies[parameterIndex] = { ...options, token };

    DIMetadataStore.setPropertyMetadata(
        target,
        CONSTRUCTOR_INJECT_METADATA_KEY,
        existingDependencies,
        true
    );
}

export function getConstructorDependenciesMetadata<T>(target: ClassConstructor): ParameterInjectMetadata<T>[] {
    return DIMetadataStore.getPropertyMetadata(
        target, 
        CONSTRUCTOR_INJECT_METADATA_KEY
    ) || [];
}

export function registerPropertyDependency<T>( target: ClassConstructor, propertyKey: string | symbol, dependencyToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
    const token = makeDIToken(dependencyToken);

    const existingDependencies = DIMetadataStore.getPropertyMetadata<PropertyInjectMetadata<T>[]>(
        target,
        PROPERTY_INJECT_METADATA_KEY
    ) || [];

    existingDependencies.push({ ...options, token, propertyKey });

    DIMetadataStore.setPropertyMetadata(
        target,
        PROPERTY_INJECT_METADATA_KEY, 
        existingDependencies, 
        true
    );
}

export function getPropertyDependenciesMetadata<T>(target: ClassConstructor): PropertyInjectMetadata<T>[] {
    return DIMetadataStore.getPropertyMetadata(
        target, 
        PROPERTY_INJECT_METADATA_KEY
    ) || [];
}

export function registerOnInitHook<T extends ClassConstructor>(target: T, propertyKey: string | symbol) {
    DIMetadataStore.setPropertyMetadata(
        target, 
        ON_INIT_HOOK_METADATA_KEY, 
        propertyKey
    );
}

export function getOnInitHookMetadata<T extends ClassConstructor>(target: T): string | symbol | undefined {
    return DIMetadataStore.getPropertyMetadata(target, ON_INIT_HOOK_METADATA_KEY);
}

export function getModuleMetadata(target: any): DIModuleOptions | undefined {
    return DIMetadataStore.getPropertyMetadata(target, DI_MODULE_METADATA_KEY);
}

export function validateProviderOptions<T>(options: ProviderOptions<T>, token: Token) {
    if (isClassProviderOptions(options) && !options.useClass) {
        throw new Error(`Invalid provider configuration for ${token.toString()}. 'useClass' is required for class providers`);
    } else if (isFactoryProviderOptions(options) && !options.useFactory) {
        throw new Error(`Invalid provider configuration for ${token.toString()}. 'useFactory' is required for factory providers`);
    } else if (isValueProviderOptions(options) && options.useValue === undefined) {
        throw new Error(`Invalid provider configuration for ${token.toString()}. 'useValue' is required for value providers`);
    } else if (isAliasProviderOptions(options) && options.useExisting === undefined) {
        throw new Error(`Invalid provider configuration for ${token.toString()}. 'aliasFor' is required for alias providers`);
    } else if (isConfigProviderOptions(options) && options.useConfig === undefined) {
        throw new Error(`Invalid provider configuration for ${token.toString()}. 'useConfig' is required for config providers`);
    } else if (
        !isClassProviderOptions(options) 
        && !isFactoryProviderOptions(options) 
        && !isValueProviderOptions(options) 
        && !isAliasProviderOptions(options) 
        && !isConfigProviderOptions(options)
    ) {
        throw new Error(`Invalid provider configuration for ${token.toString()}`);
    }
}

export function applyMiddlewares<T>(middlewares: Middleware<any>[], next: () => T): T {
    let index = -1;

    const dispatch = (i: number): T => {
        if (i <= index) {
            throw new Error('next() called multiple times');
        }
        
        index = i;

        if (i >= middlewares.length) {
            return next(); // Ensure we don't access out of bounds
        }

        const middlewareInfo = middlewares[i];
        const middleware = middlewareInfo?.middleware;

        if (middleware) {
            return middleware(() => dispatch(i + 1));
        }

        return next();
    };

    return dispatch(0);
}

export async function applyMiddlewaresAsync<T>(middlewares: MiddlewareAsync<any>[], next: () => Promise<T>): Promise<T> {
    let index = -1;

    const dispatch = async (i: number): Promise<T> => {
        if (i <= index) {
            throw new Error('next() called multiple times');
        }
        index = i;

        if (i >= middlewares.length) {
            return next(); // Ensure we don't access out of bounds
        }

        const middlewareInfo = middlewares[i];
        const middleware = middlewareInfo?.middleware;

        if (middleware) {
            return await middleware(() => dispatch(i + 1));
        }

        return next();
    };

    return dispatch(0);
}

export function matchesPattern(path: string, pattern: string): boolean {
    const pathSegments = path.split('.');
    const patternSegments = pattern.split('.');

    let pathIndex = 0;
    let patternIndex = 0;

    while (patternIndex < patternSegments.length && pathIndex < pathSegments.length) {
        const patternSegment = patternSegments[patternIndex];
        
        if (patternSegment === '*') {
            // Wildcard matches any segment, so move to the next path segment
            pathIndex++;
            patternIndex++;
        } else if (patternSegment === pathSegments[pathIndex]) {
            // Exact match, move both indices
            pathIndex++;
            patternIndex++;
        } else {
            // Mismatch, pattern does not match the path
            return false;
        }
    }

    // Check if the entire pattern has been matched
    return patternIndex === patternSegments.length;
}

export function setPathValue(target: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = target;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key]) {
            current[key] = {};
        }
        current = current[key];
    }

    current[keys[keys.length - 1]] = value;
}

export function getPathValue(obj: any, path: string): any {
  const pathParts = path.split('.');
  let current = obj;

  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];

    if (part === '*') {
      if (i === pathParts.length - 1) { // wildcard is the last part of the path
        if (Array.isArray(current)) {
          return current;
        } else if (typeof current === 'object') {
          return current;
        } else {
          throw new Error(`Invalid path at '${pathParts.slice(0, i).join('.')}'. Cannot use '*' on non-object or non-array value`);
        }
      } else {
        if (Array.isArray(current)) {
          return current.map((item) => getPathValue(item, pathParts.slice(i + 1).join('.')));
        } else if (typeof current === 'object') {
          const result: any = {};
          for (const key in current) {
            result[key] = getPathValue(current[key], pathParts.slice(i + 1).join('.'));
          }
          return result;
        } else {
          throw new Error(`Invalid path at '${pathParts.slice(0, i).join('.')}'. Cannot use '*' on non-object or non-array value`);
        }
      }
    } else if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || index < 0 || index >= current.length) {
        throw new Error(`Invalid path at '${pathParts.slice(0, i).join('.')}'. Index '${part}' out of range`);
      }
      current = current[index];
    } else if (typeof current === 'object') {
      if (!(part in current)) {
        throw new Error(`Invalid path at '${pathParts.slice(0, i).join('.')}'. Key '${part}' not found in object`);
      }
      current = current[part];
    } else {
      throw new Error(`Invalid path at '${pathParts.slice(0, i).join('.')}'. Cannot access property '${part}' on non-object value`);
    }
  }

  return current;
}

export function filterAndSortProviders<T extends InternalProviderOptions>(
    providers: T[],
    criteria?: {
        priority?: PriorityCriteria;
        tags?: string[];
    }
) {
    return providers
        .filter(({_provider: provider}) => {
            if (provider.override) return true; // Explicit overrides take precedence
            if (
                criteria?.priority &&
                !matchesPriority(provider.priority, criteria.priority)
            ) {
                return false;
            }
            if (
                criteria?.tags &&
                !criteria.tags.every((tag) => provider.tags?.includes(tag))
            ) {
                return false;
            }
            return true;
        })
        .sort(({_provider: a}, {_provider: b}) => {
            if (a.override) return -1; // Overrides take precedence
            if (b.override) return 1;
            return (b.priority || 0) - (a.priority || 0); // Higher priority comes first
        });
}

export function matchesPriority( providerPriority: number | undefined, criteria: PriorityCriteria ): boolean {
  if ('greaterThan' in criteria) {
    return (providerPriority ?? 0) > criteria.greaterThan;
  }

  if ('lessThan' in criteria) {
    return (providerPriority ?? 0) < criteria.lessThan;
  }

  if ('eq' in criteria) {
    return providerPriority === criteria.eq;
  }

  if ('between' in criteria) {
    const [minPriority, maxPriority] = criteria.between;
    return (
      (providerPriority ?? 0) >= minPriority 
      &&
      (providerPriority ?? 0) <= maxPriority
    );
  }

  return false;
}

// Flatten the configuration object into key-value pairs with paths as keys
export function flattenConfig(config: Record<any, any>, basePath: string = '' ): Map<string, any> {
const entries = new Map<string, any>();

    const recurse = (obj: any, path: string) => {
        if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    recurse(obj[key], path ? `${path}.${key}` : key);
                }
            }
        } else {
            entries.set(path, obj);
        }
    };

    recurse(config, basePath);
    return entries;
}