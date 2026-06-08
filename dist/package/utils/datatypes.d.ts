/**
 *
 * Some of these utils are modified/collected from
 * https://github.com/mesqueeb/is-what
 *
 */
import { AnyClass, AnyFunction, Nullish, PlainObject } from "./types";
export declare function getType(payload: any): string;
export declare function isTypeOf(payload: any, type: string): boolean;
export declare function isNumeric(payload: any): payload is Number;
export declare function isEmail(payload: string): boolean;
export declare function isUnique(payload: any): boolean;
export declare function isIP(payload: any): boolean;
export declare function isIPv4(payload: any): boolean;
export declare function isIPv6(payload: any): boolean;
export declare function isUUID(payload: string): boolean;
export declare function isString(payload: any): payload is string;
export declare function isNumericString(payload: any): payload is string;
export declare function isEmptyString(payload: any): payload is '';
export declare function isNotEmptyString(payload: any): payload is string;
export declare function isJsonString(payload: string): payload is string;
export declare function isDateString(payload: string): payload is string;
export declare function isHttpUrlString(payload: string): payload is string;
export declare function isDate(payload: any): payload is Date;
export declare function isError(payload: any): payload is Error;
export declare function isFile(payload: any): payload is File;
export declare function isFunction(payload: any): payload is AnyFunction;
export declare function isClassConstructor(payload: any): payload is AnyClass;
export declare function isSubclassOf(payload: any, superClass: AnyClass): payload is AnyClass;
export declare function isBlob(payload: any): payload is Blob;
export declare function isNull(payload: any): payload is null;
export declare function isUndefined(payload: any): payload is undefined;
export declare function isBoolean(payload: any): payload is boolean;
export declare function isSymbol(payload: any): payload is symbol;
/**
 * Returns whether the payload is a primitive type (eg. Boolean | Null | Undefined | Number | String | Symbol)
 *
 * @param {any} payload
 * @returns {(payload is boolean | null | undefined | number | string | symbol)}
 */
export declare function isPrimitive(payload: any): payload is boolean | null | undefined | number | string | symbol;
export declare function isPromise(payload: any): payload is Promise<any>;
export declare function isRegExp(payload: any): payload is RegExp;
export declare function isArray(payload: any): payload is Array<any>;
export declare function isArrayOfType<T>(value: any, evalType: (item: any) => item is T): value is Array<T>;
export declare function isArrayOfStrings(payload: any): payload is string[];
export declare function isEmptyArray(payload: any): boolean;
export declare function isNonEmptyArray(payload: any): payload is Array<any>;
export declare function isEmptyArrayDeep(payload: any): boolean;
/**
 * Returns whether the payload is a plain JavaScript object (excluding special classes or objects
 * with other prototypes)
 */
export declare function isPlainObject(payload: any): payload is PlainObject;
export declare function isAnyObject(payload: any): payload is PlainObject;
export declare function isObject(payload: any): payload is PlainObject;
export declare function isEmptyObject(payload: any): payload is {
    [K in any]: never;
};
export declare function isNonEmptyObject(payload: any): payload is {
    [K in any]: never;
};
export declare function isEmptyObjectDeep(payload: any): boolean;
export declare function isMap(payload: any): payload is Map<any, any>;
export declare function isWeakMap(payload: any): payload is WeakMap<any, any>;
export declare function isEmptyMap(payload: any): boolean;
export declare function isEmptyMapDeep(payload: any): boolean;
export declare function isSet(payload: any): payload is Set<any>;
export declare function isWeakSet(payload: any): payload is WeakSet<any>;
export declare function isEmptySet(payload: any): boolean;
export declare function isEmptySetDeep(payload: any): boolean;
export declare function isComplexValue(payload: any): boolean;
export declare function isSimpleValue(payload: any): payload is string | number | boolean | symbol | null | undefined;
export declare function isNullish(payload: any): payload is Nullish;
export declare function isEmptySimpleValue(payload: any): boolean;
export declare function isEmpty(payload: any): boolean;
export declare function isEmptyDeep(payload: any): boolean;
/**
 * Does a generic check to check that the given payload is of a given type. In cases like Number, it
 * will return true for NaN as NaN is a Number (thanks javascript!); It will, however, differentiate
 * between object and null
 */
export declare function isType<T extends AnyFunction | AnyClass>(payload: any, type: T): payload is T;
