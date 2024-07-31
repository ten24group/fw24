import { PartialBy, useMetadataManager } from "../utils";
import { ClassConstructor, DepIdentifier, DIModuleOptions, InjectOptions, ParameterInjectMetadata, PropertyInjectMetadata, Token } from "./types";

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

export function registerModuleMetadata(target: any, options: PartialBy<DIModuleOptions, 'identifier'>) {
    options.identifier = options.identifier || target;
    DIMetadataStore.setPropertyMetadata(target, DI_MODULE_METADATA_KEY, { 
        ...options, 
        identifier: makeDIToken(target) 
    });
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


