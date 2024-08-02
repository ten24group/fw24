import { PartialBy, useMetadataManager } from "../utils";
import { DIContainer } from "./di-container";
import { ClassConstructor, DependencyGraphNode, DepIdentifier, DIModuleOptions, InjectOptions, isClassProviderOptions, isFactoryProviderOptions, isValueProviderOptions, Middleware, MiddlewareAsync, ParameterInjectMetadata, PropertyInjectMetadata, ProviderOptions, Token } from "./types";

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

export function makeDIToken<T>(tokenOrType: DepIdentifier<T>, namespace: string = 'fw24.di.token'): Token<T> {
    
    // if it's already a token, return it
    if(typeof tokenOrType === 'symbol'){
        tokenOrType = tokenOrType.toString();
    }

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

    if(isSerializedSymbol(tokenOrType)){
        tokenOrType = getSymbolKey(tokenOrType) as string;
    }

    if( !tokenOrType || !(tokenOrType || '').trim() ){
        throw new Error(`Invalid 'tokenOrType' ${String(tokenOrType)}`);
    }

    // if it's a serialized token, return it's symbol
    if(tokenOrType.startsWith(namespace)){
        return Symbol.for(tokenOrType);
    }

    // else namespace the token and return it's symbol
    return Symbol.for(`${namespace}:${tokenOrType}`);
}

export function hasConstructor(obj: any): obj is { constructor: Function } {
    return obj && typeof obj.constructor === 'function' && obj.constructor.prototype;
}

export const DIMetadataStore = useMetadataManager({namespace: 'fw24:di'});

export type RegisterDIModuleMetadataOptions = Omit<DIModuleOptions, 'identifier'> & {identifier?: ClassConstructor | Token<any>};

export function registerModuleMetadata(target: any, options: RegisterDIModuleMetadataOptions, override = false) {
    options.identifier = options.identifier || target;
    DIMetadataStore.setPropertyMetadata(target, DI_MODULE_METADATA_KEY, { 
        ...options, 
        identifier: makeDIToken(target) 
    }, override);
}

export function registerConstructorDependency<T>( target: any, parameterIndex: number, depNameOrToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
    const token = makeDIToken(depNameOrToken);

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

export function registerPropertyDependency<T>( target: ClassConstructor, propertyKey: string | symbol, depNameOrToken: DepIdentifier<T>, options: InjectOptions<T> = {} ) {
    const token = makeDIToken(depNameOrToken);

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

export function validateProviderOptions<T>(options: ProviderOptions<T>, token: Token<any>) {
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

export function serializeGraphToText(graph: DependencyGraphNode[]) {
    const output: string[] = ['Dependency Graph:'];

    function printNode(node: DependencyGraphNode, prefix: string, isLast: boolean, visited: Set<string>): void {
        const resolvedFrom = node.resolvedFrom ? ` (resolved from ${node.resolvedFrom})` : '';

        output.push(`${prefix}${isLast ? '└── ' : '├── '}${node.token}${resolvedFrom}`);

        const newPrefix = prefix + (isLast ? '    ' : '│   ');

        visited.add(node.token);

        const depArray = Array.from(node.dependencies);
        if (depArray.length === 0) {
            output.push(`${newPrefix}└── No dependencies`);
        } else {
            depArray.forEach((dep, index) => {
                const depNode = graph.find(n => n.token === dep);
                if (depNode) {
                    if (visited.has(depNode.token)) {
                        output.push(`${newPrefix}${index === depArray.length - 1 ? '└── ' : '├── '}Circular dependency detected: ${node.token} -> ${depNode.token}`);
                    } else {
                        printNode(depNode, newPrefix, index === depArray.length - 1, new Set(visited));
                    }
                }
            });
        }
    }

    // Start from nodes with no incoming dependencies
    const rootNodes = graph.filter(node => !Array.from(graph).some(n => n.dependencies.has(node.token)));
    rootNodes.forEach((rootNode, index) => {
        printNode(rootNode, '', index === rootNodes.length - 1, new Set<string>());
    });

    // Include standalone nodes (nodes with no dependencies and not dependent on by others)
    const standaloneNodes = graph.filter(node => node.dependencies.size === 0 && !rootNodes.includes(node));
    standaloneNodes.forEach((node) => {
        output.push(`└── ${node.token}${node.resolvedFrom ? ` (resolved from ${node.resolvedFrom})` : ''}`);
        output.push(`    └── No dependencies`);
    });

    return output.join('\n');
}

export function generateCompleteDependencyGraph(rootContainer: DIContainer): DependencyGraphNode[] {
        const graph: Map<string, DependencyGraphNode> = new Map();
        const visitedContainers = new Set<DIContainer>();

        // Start from the provided root container
        buildDependencyGraphForContainer(rootContainer, graph, visitedContainers);

        return Array.from(graph.values());
    }

    export function buildDependencyGraphForContainer(container: DIContainer, graph: Map<string, DependencyGraphNode>, visitedContainers: Set<DIContainer>) {
        if (visitedContainers.has(container)) {
            return; // Prevent infinite recursion in case of circular module imports
        }

        visitedContainers.add(container);

        for (const [token, options] of container.getProviders().entries()) {
            const tokenString = token.toString();
            if (!graph.has(tokenString)) {
                addDependencyGraphNode(container, graph, tokenString, options, new Set<string>(), visitedContainers);
            }
        }

        // Recurse into child containers (imported modules)
        for (const childContainer of container.getChildContainers()) {
            buildDependencyGraphForContainer(childContainer, graph, visitedContainers);
        }
    }

    export function addDependencyGraphNode(
        container: DIContainer,
        graph: Map<string, DependencyGraphNode>,
        tokenString: string,
        options: ProviderOptions<any>,
        visitedTokens: Set<string>, // Track visited tokens for the current path
        visitedContainers: Set<DIContainer>
    ) {
        if (visitedTokens.has(tokenString)) {
            console.warn(`Circular dependency detected: ${Array.from(visitedTokens).join(' -> ')} -> ${tokenString}`);
            return; // Circular dependency detected, stop further resolution
        }

        visitedTokens.add(tokenString);

        const node: DependencyGraphNode = graph.get(tokenString) || {
            token: tokenString,
            dependencies: new Set(),
            resolvedFrom: container.containerIdentifier.toString(),
            availableInContainers: new Set<string>()
        };

        // Add the current container to the list of containers where this token is available
        node.availableInContainers.add(container.containerIdentifier.toString());

        let dependencies: string[] = [];

        if ('useClass' in options) {
            const { constructorDependencies, propertyDependencies } = container.getClassDependencies(options.useClass);
            dependencies = [
                ...constructorDependencies.map(dep => makeDIToken(dep.token).toString()),
                ...propertyDependencies.map(dep => makeDIToken(dep.token).toString())
            ];
        } else if ('deps' in options && options.deps) {
            dependencies = options.deps.map(dep => makeDIToken(dep).toString());
        }

        for (const dep of dependencies) {
            node.dependencies.add(dep);

            // Check if the dependency is an alias or directly provided
            let resolvedOptions = container.getProviders().get(makeDIToken(dep));
            let resolvedContainer = container;
            let currentContainer = container.getParentContainer();
            while (!resolvedOptions && currentContainer) {
                resolvedOptions = currentContainer.getProviders().get(makeDIToken(dep));
                if (resolvedOptions) {
                    resolvedContainer = currentContainer;
                }
                currentContainer = currentContainer.getParentContainer();
            }

            // If the dependency has not been resolved yet, recurse into the appropriate container
            if (resolvedOptions) {
                addDependencyGraphNode(resolvedContainer, graph, dep, resolvedOptions, new Set(visitedTokens), visitedContainers);
            }
        }

        // Update the resolvedFrom information if this node is shadowed by another container
        if (node.resolvedFrom !== container.containerIdentifier.toString()) {
            node.resolvedFrom += ` (shadowed by ${container.containerIdentifier.toString()})`;
        }

        graph.set(tokenString, node);
    }