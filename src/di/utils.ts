import { DepIdentifier, Token } from "./types";

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


