import { DIContainer } from "./di-container";

export type Token<T> = symbol & { __type?: T };
export type DepIdentifier<T extends unknown = unknown> = symbol | string | Function | Token<T> | ClassConstructor<T>;
export type ClassConstructor<T extends any = any> = new (...args: any[]) => T;

export type BaseProviderOptions = {
    provide: DepIdentifier<any>;
    singleton?: boolean;
    priority?: number;
    condition?: () => boolean;
}

export type ClassProviderOptions<T> = BaseProviderOptions & {
    useClass: ClassConstructor<T>;
}

export type FactoryProviderOptions<T> = BaseProviderOptions & {
    deps?: Token<any>[];
    useFactory: (...args: any[]) => T;
}

export type ValueProviderOptions<T> = BaseProviderOptions & {
    useValue: T;
}

export type ProviderOptions<T extends unknown = unknown> =  ClassProviderOptions<T> | FactoryProviderOptions<T> | ValueProviderOptions<T>;

export function isClassProviderOptions<T>(options: ProviderOptions<T>): options is ClassProviderOptions<T> {
    return (options as ClassProviderOptions<T>).useClass !== undefined;
}

export function isFactoryProviderOptions<T>(options: ProviderOptions<T>): options is FactoryProviderOptions<T> {
    return (options as FactoryProviderOptions<T>).useFactory !== undefined;
}


export function isValueProviderOptions<T>(options: ProviderOptions<T>): options is ValueProviderOptions<T> {
    return (options as ValueProviderOptions<T>).useValue !== undefined;
}

export type Middleware<T> = {
    order?: number;
    middleware: (next: () => T) => T;
};
export type MiddlewareAsync<T> = {
    order?: number;
    middleware: (next: () => Promise<T>) => Promise<T>;
};

export type DIModuleOptions = {
    identifier: Token<any>;
    imports?: ClassConstructor[];
    exports?: DepIdentifier[];
    providers?: ProviderOptions[];
}

export interface DIModule extends DIModuleOptions {}

export type DIModuleConstructor = { new (...args: any[]): DIModule };


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


export type DependencyGraphNode = {
    token: string;
    dependencies: Set<string>;   
    resolvedFrom: string; // Container where the provider is resolved from
    availableInContainers: Set<string>; // Containers where this provider is available
}