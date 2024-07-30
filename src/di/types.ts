export type Token<T> = symbol & { __type?: T };
export type DepIdentifier<T extends unknown = unknown> = symbol | string | Function | Token<T> | ClassConstructor<T>;
export type ClassConstructor<T extends any = any> = new (...args: any[]) => T;

export type BaseProviderOptions = {
    name?: string;
    singleton?: boolean;
    priority?: number;
    condition?: () => boolean;
}

export type ClassProviderOptions<T> = BaseProviderOptions & {
    useClass: ClassConstructor<T>;
}

export function isClassProviderOptions<T>(options: ProviderOptions<T>): options is ClassProviderOptions<T> {
    return (options as ClassProviderOptions<T>).useClass !== undefined;
}

export type FactoryProviderOptions<T> = BaseProviderOptions & {
    deps?: Token<any>[];
    useFactory: (...args: any[]) => T;
}

export function isFactoryProviderOptions<T>(options: ProviderOptions<T>): options is FactoryProviderOptions<T> {
    return (options as FactoryProviderOptions<T>).useFactory !== undefined;
}

export type ValueProviderOptions<T> = BaseProviderOptions & {
    useValue: T;
}

export function isValueProviderOptions<T>(options: ProviderOptions<T>): options is ValueProviderOptions<T> {
    return (options as ValueProviderOptions<T>).useValue !== undefined;
}

export type ProviderOptions<T> =  ClassProviderOptions<T> | FactoryProviderOptions<T> | ValueProviderOptions<T>;

export type InjectOptions<T extends unknown = unknown> = {
    isOptional?: boolean;
    defaultValue?: T
};

export type ParameterInjectMetadata<T extends unknown = unknown> = InjectOptions<T> & {
    token: Token<any>;
};

export type PropertyInjectMetadata<T extends unknown = unknown> = InjectOptions<T> & {
    token: Token<any>;
    propertyKey: string | symbol;
};