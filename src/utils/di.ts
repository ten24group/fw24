import type { AliasProviderOptions, BaseProviderOptions, ClassProviderOptions, ConfigProviderOptions, FactoryProviderOptions, ValueProviderOptions } from "../interfaces/di";

export function isClassProviderOptions<T>(options: BaseProviderOptions): options is ClassProviderOptions<T> {
    return (options as ClassProviderOptions<T>).useClass !== undefined;
}

export function isFactoryProviderOptions<T>(options: BaseProviderOptions): options is FactoryProviderOptions<T> {
    return (options as FactoryProviderOptions<T>).useFactory !== undefined;
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