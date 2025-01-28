import type { AliasProviderOptions, BaseProviderOptions, ClassProviderOptions, ComplexDependencyIdentifier, ConfigProviderOptions, FactoryProviderOptions, ValueProviderOptions } from "../interfaces/di";
import { camelCase, pascalCase } from "./cases";

export function isClassProviderOptions<T>(options: BaseProviderOptions): options is ClassProviderOptions<T> {
    return (options as ClassProviderOptions<T>).useClass !== undefined;
}

export function isFactoryProviderOptions<T>(options: BaseProviderOptions): options is FactoryProviderOptions<T> {
    return (options as FactoryProviderOptions<T>).useFactory !== undefined;
}

export function isComplexDependencyIdentifier<T>(options: any): options is ComplexDependencyIdentifier<T> {
    return ( typeof options == 'object' && options.hasOwnProperty('token') )
}

export function isValueProviderOptions<T>(options: BaseProviderOptions): options is ValueProviderOptions<T> {
    return (options as ValueProviderOptions<T>).useValue !== undefined;
}

export function isConfigProviderOptions<T>(options: BaseProviderOptions): options is ConfigProviderOptions<T> {
    return (options as ConfigProviderOptions<any>).useConfig !== undefined;
}

export function isAliasProviderOptions<T>(options: BaseProviderOptions): options is AliasProviderOptions<T> {
    return (options as AliasProviderOptions<any>).useExisting !== undefined;
}

function arraysEqual(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function compareProviderOptions(a: BaseProviderOptions, b: BaseProviderOptions): boolean {

    // Compare the common properties
    if(
        !(
            a.priority === b.priority &&
            arraysEqual(a.tags || [], b.tags || []) &&
            a.condition?.toString() === b.condition?.toString() &&
            a.override === b.override &&
            a.provide === b.provide &&
            a.type === b.type &&
            a.forEntity === b.forEntity
        )
    ){
        return false;
    }

    if (isClassProviderOptions(a) && isClassProviderOptions(b)) {
        return a.useClass === b.useClass;
    }
    if (isFactoryProviderOptions(a) && isFactoryProviderOptions(b)) {
        return a.useFactory === b.useFactory && arraysEqual(a.deps || [], b.deps || []);
    }
    if (isValueProviderOptions(a) && isValueProviderOptions(b)) {
        return a.useValue === b.useValue;
    }
    if (isConfigProviderOptions(a) && isConfigProviderOptions(b)) {
        return a.useConfig === b.useConfig;
    }
    if (isAliasProviderOptions(a) && isAliasProviderOptions(b)) {
        return a.useExisting === b.useExisting;
    }

    return false;
}

export function makeEntityServiceToken(entityName: string){
    return `${pascalCase(camelCase(entityName))}Service`
}

export function makeEntitySchemaTokenName(entityName: string){
    return `${pascalCase(camelCase(entityName))}Service`
}