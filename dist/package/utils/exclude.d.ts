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
export declare function excludeValues<T extends Record<string, unknown> = Record<string, unknown>>(payload: T, ...valuesToRemove: any[]): Partial<T>;
export declare function excludeValuesRecursively<T extends Record<string, any> = Record<string, any>>(payload: T | Array<T>, ...valuesToRemove: any[]): Partial<T> | Array<Partial<T>>;
export declare const removeEmpty: <T extends {
    [k: string]: any | undefined | null;
}>(obj: T) => Partial<T>;
export declare function excludeKeys<T extends Record<string, any> = Record<string, any>>(payload: T, ...keysToRemove: Array<string>): Partial<T>;
export declare function excludeKeysRecursively<T extends Record<string, any> = Record<string, any>>(payload: T | Array<T>, ...keysToRemove: Array<string>): Partial<T> | Array<Partial<T>>;
export declare function pickKeys<T extends Record<string, any> = Record<string, any>>(payload: T, ...keysToKeep: Array<string>): Partial<T>;
export declare function pickKeysRecursively<T extends Record<string, any> = Record<string, any>>(payload: T | Array<T>, ...keysToKeep: Array<string>): Partial<T> | Array<Partial<T>>;
