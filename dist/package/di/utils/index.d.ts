import type { DepIdentifier, InternalProviderOptions, DIMiddleware, DIMiddlewareAsync, PriorityCriteria, ProviderOptions, Token } from "./../../interfaces/di";
export declare function isSerializedSymbol(token: string): boolean;
export declare function getSymbolKey(token: string): string | null;
export declare function makeDIToken<T>(tokenOrType: DepIdentifier<T>, namespace?: string): Token;
export declare function stripDITokenNamespace(token: Token, namespace?: string): string;
export declare function hasConstructor(obj: any): obj is {
    constructor: Function;
};
export declare function validateProviderOptions<T>(options: ProviderOptions<T>, token: Token): void;
export declare function applyMiddlewares<T>(middlewares: DIMiddleware<any>[], next: () => T): T;
export declare function applyMiddlewaresAsync<T>(middlewares: DIMiddlewareAsync<any>[], next: () => Promise<T>): Promise<T>;
export declare function matchesPattern(path: string, pattern: string): boolean;
export declare function setPathValue(target: any, path: string, value: any): void;
export declare function getPathValue(obj: any, path: string): any;
export declare function filterAndSortProviders<T extends InternalProviderOptions>(providers: T[], criteria?: {
    priority?: PriorityCriteria;
    tags?: string[];
}): T[];
export declare function matchesPriority(providerPriority: number | undefined, criteria: PriorityCriteria): boolean;
export declare function flattenConfig(config: Record<any, any>, basePath?: string): Map<string, any>;
