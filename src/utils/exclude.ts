import { isArray, isObject } from "./datatypes";

/**
 * Recursively remove props from an object, if the prop's value matches `valueToRemove`
 * 
 * example
  ```
    const payload = { a: 1, b: undefined, c: {}, d: [] }
    removeProps(payload, {}, []);
    // returns
    // { a: 1, b: undefined }
  ```
 *
 */
export function excludeValues<T extends Record<string, unknown> = Record<string, unknown>>(
    payload: T,
    ...valuesToRemove: any[]
): Partial<T> {
    if (!isObject(payload)) return payload;

    return Object.fromEntries( 
        Object.entries(payload).filter(([, v]) => ![...valuesToRemove].includes(v)) 
    ) as Partial<T>;
}

export function excludeValuesRecursively<T extends Record<string, any> = Record<string, any> >(
    payload: T | Array<T>,
    ...valuesToRemove: any[]
): Partial<T> | Array<Partial<T>> {
    
    if(isArray(payload)){
        return payload.map( item => excludeValuesRecursively(item, ...valuesToRemove) ) as Array<Partial<T>>  ;
    }

    return excludeValues<T>(payload, ...valuesToRemove );
}

export const removeEmpty = <T extends {[k:string]: any|undefined|null}>(obj: T) => {
    return excludeValues( obj, undefined, null, '');
};

export function excludeKeys<T extends Record<string, any> = Record<string, any>>(
    payload: T,
    ...keysToRemove: Array<string>
): Partial<T> {
  
    if (!isObject(payload)) return payload;

    return Object.fromEntries( 
        Object.entries(payload).filter(([k]) => ![...keysToRemove].includes(k)) 
    ) as Partial<T>;
}

export function excludeKeysRecursively<T extends Record<string, any> = Record<string, any> >(
    payload: T | Array<T>,
    ...keysToRemove: Array<string>
): Partial<T> | Array<Partial<T>> {
    
    if(isArray(payload)){
        return payload.map( item => excludeKeysRecursively(item, ...keysToRemove) ) as Array<Partial<T>>  ;
    }

    return excludeKeys<T>(payload, ...keysToRemove );
}

export function pickKeys<T extends Record<string, any> = Record<string, any>>(
    payload: T,
    ...keysToKeep: Array<string>
): Partial<T> {
  
    if (!isObject(payload)) return payload;

    return Object.fromEntries( 
        Object.entries(payload).filter(([k]) => [...keysToKeep].includes(k)) 
    ) as Partial<T>;
}

export function pickKeysRecursively<T extends Record<string, any> = Record<string, any> >(
    payload: T | Array<T>,
    ...keysToKeep: Array<string>
): Partial<T> | Array<Partial<T>> {
    
    if(isArray(payload)){
        return payload.map( item => pickKeysRecursively(item, ...keysToKeep) ) as Array<Partial<T>>  ;
    }

    return pickKeys<T>(payload, ...keysToKeep );
}