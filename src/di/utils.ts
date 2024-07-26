export type Token<T> = symbol & { __type?: T };

export function createToken<T>(description: string, namespace: string = 'fw24.di.token'): Token<T> {
    return Symbol(`${namespace}:${description}`) as Token<T>;
}

export function hasConstructor(obj: any): obj is { constructor: Function } {
    return obj && typeof obj.constructor === 'function' && obj.constructor.prototype;
}


