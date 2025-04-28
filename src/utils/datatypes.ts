/**
 * 
 * Some of these utils are modified/collected from 
 * https://github.com/mesqueeb/is-what
 * 
 */

import { AnyClass, AnyFunction, Nullish, PlainObject } from "./types";

export function getType(payload: any): string {
    return Object.prototype.toString.call(payload).slice(8, -1)
}

export function isTypeOf(payload: any, type: string): boolean {
    return getType(payload) === type;
}

export function isNumeric(payload: any): payload is Number {
    return getType(payload) === 'Number' && !isNaN(payload)
}

export function isEmail(payload: string): boolean {
    const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return pattern.test(payload);
}

export function isUnique(payload: any): boolean {
    throw (new Error(`isUnique not implemented yet: ${payload}`));
}

export function isIP(payload: any): boolean {
    return !!require('net').isIP(payload)
}

export function isIPv4(payload: any): boolean {
    return require('net').isIPv4(payload)
}

export function isIPv6(payload: any): boolean {
    return require('net').isIPv6(payload)
}

export function isUUID(payload: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload);
}

export function isString(payload: any): payload is string {
    return getType(payload) === 'String'
}

export function isNumericString(payload: any): payload is string {
    return !isNaN(Number(payload));
}

export function isEmptyString(payload: any): payload is '' {
    return payload === ''
}

export function isNotEmptyString(payload: any): payload is string {
    return isString(payload) && payload !== ''
}

export function isJsonString(payload: string): payload is string {
    try {
        JSON.parse(payload);
    } catch (e) {
        return false;
    }
    return true;
}

export function isDateString(payload: string): payload is string {
    try {
        return isDate(new Date(payload));
    } catch (e) {
        return false;
    }
}

export function isHttpUrlString(payload: string): payload is string {
    let url;
    try {
        url = new URL(payload);
    } catch (_) {
        return false;
    }

    return url?.protocol === "http:" || url?.protocol === "https:";
}

export function isDate(payload: any): payload is Date {
    return getType(payload) === 'Date' && !isNaN(payload)
}

export function isError(payload: any): payload is Error {
    return getType(payload) === 'Error' || payload instanceof Error
}

export function isFile(payload: any): payload is File {
    return getType(payload) === 'File'
}

export function isFunction(payload: any): payload is AnyFunction {
    return typeof payload === 'function'
}

export function isClassConstructor(payload: any): payload is AnyClass {
    return isFunction(payload) && payload.prototype
}

export function isSubclassOf(payload: any, superClass: AnyClass): payload is AnyClass {
    // Handle null/undefined cases
    if (!payload || !superClass) {
        return false;
    }

    // Handle primitive types
    if (typeof payload !== 'function') {
        return false;
    }

    // Ensure superClass is a valid constructor
    if (typeof superClass !== 'function') {
        return false;
    }

    // Check if payload is a constructor
    if (!isClassConstructor(payload)) {
        return false;
    }

    // Don't consider a class as a subclass of itself
    if (payload === superClass) {
        return false;
    }

    // Traverse the prototype chain
    let proto = payload.prototype;
    while (proto) {
        if (proto instanceof superClass) {
            return true;
        }
        proto = Object.getPrototypeOf(proto);
    }

    return false;
}

export function isBlob(payload: any): payload is Blob {
    return getType(payload) === 'Blob'
}

export function isNull(payload: any): payload is null {
    return getType(payload) === 'Null'
}

export function isUndefined(payload: any): payload is undefined {
    return getType(payload) === 'Undefined'
}

export function isBoolean(payload: any): payload is boolean {
    return getType(payload) === 'Boolean'
}

export function isSymbol(payload: any): payload is symbol {
    return getType(payload) === 'Symbol'
}

/**
 * Returns whether the payload is a primitive type (eg. Boolean | Null | Undefined | Number | String | Symbol)
 *
 * @param {any} payload
 * @returns {(payload is boolean | null | undefined | number | string | symbol)}
 */
export function isPrimitive(
    payload: any
): payload is boolean | null | undefined | number | string | symbol {
    return (
        isBoolean(payload) ||
        isNull(payload) ||
        isUndefined(payload) ||
        isNumeric(payload) ||
        isString(payload) ||
        isSymbol(payload)
    )
}

export function isPromise(payload: any): payload is Promise<any> {
    return getType(payload) === 'Promise'
}

export function isRegExp(payload: any): payload is RegExp {
    return getType(payload) === 'RegExp'
}

export function isArray(payload: any): payload is Array<any> {
    return getType(payload) === 'Array'
}

export function isArrayOfType<T>(value: any, evalType: (item: any) => item is T): value is Array<T> {
    return Array.isArray(value) && value.every(item => evalType(item));
}

export function isArrayOfStrings(payload: any): payload is string[] {
    return isArrayOfType<string>(payload, isString);
}

export function isEmptyArray(payload: any): boolean {
    return isArray(payload) && payload.length === 0;
}

export function isNonEmptyArray(payload: any): payload is Array<any> {
    return isArray(payload) && payload.length > 0
}

export function isEmptyArrayDeep(payload: any): boolean {
    return isArray(payload) && payload.every((item: any) => isEmptyDeep(item));
}

/**
 * Returns whether the payload is a plain JavaScript object (excluding special classes or objects
 * with other prototypes)
 */
export function isPlainObject(payload: any): payload is PlainObject {
    if (getType(payload) !== 'Object') return false
    const prototype = Object.getPrototypeOf(payload)
    return !!prototype && prototype.constructor === Object && prototype === Object.prototype
}

export function isAnyObject(payload: any): payload is PlainObject {
    return getType(payload) === 'Object'
}

export function isObject(payload: any): payload is PlainObject {
    return isPlainObject(payload)
}

export function isEmptyObject(payload: any): payload is { [ K in any ]: never } {
    return isPlainObject(payload) && Object.keys(payload).length === 0
}

export function isNonEmptyObject(payload: any): payload is { [ K in any ]: never } {
    return isPlainObject(payload) && Object.keys(payload).length > 0
}

export function isEmptyObjectDeep(payload: any): boolean {
    return isObject(payload) && Object.keys(payload).every((key: any) => isEmptyDeep(payload[ key ]));
}

export function isMap(payload: any): payload is Map<any, any> {
    return getType(payload) === 'Map'
}

export function isWeakMap(payload: any): payload is WeakMap<any, any> {
    return getType(payload) === 'WeakMap'
}

export function isEmptyMap(payload: any) {
    return isMap(payload) && payload.size === 0;
}

export function isEmptyMapDeep(payload: any) {
    return isMap(payload) && isEmptyArray(Array.from(payload.values()));
}

export function isSet(payload: any): payload is Set<any> {
    return getType(payload) === 'Set'
}

export function isWeakSet(payload: any): payload is WeakSet<any> {
    return getType(payload) === 'WeakSet'
}

export function isEmptySet(payload: any) {
    return isSet(payload) && payload.size === 0;
}

export function isEmptySetDeep(payload: any) {
    return isSet(payload) && isEmptyArray(Array.from(payload.values()));
}

export function isComplexValue(payload: any) {
    return !isPrimitive(payload)
}

export function isSimpleValue(payload: any) {
    return isPrimitive(payload);
}

export function isNullish(payload: any): payload is Nullish {
    return isNull(payload) || isUndefined(payload)
}

export function isEmptySimpleValue(payload: any): boolean {
    return isNullish(payload) || isEmptyString(payload)
}

export function isEmpty(payload: any) {
    return isEmptySimpleValue(payload)
        || isEmptyMap(payload)
        || isEmptySet(payload)
        || isEmptyArray(payload)
        || isEmptyObject(payload)
}

export function isEmptyDeep(payload: any) {
    return isEmpty(payload)
        || isEmptyMapDeep(payload)
        || isEmptySetDeep(payload)
        || isEmptyArrayDeep(payload)
        || isEmptyObjectDeep(payload)
}

/**
 * Does a generic check to check that the given payload is of a given type. In cases like Number, it
 * will return true for NaN as NaN is a Number (thanks javascript!); It will, however, differentiate
 * between object and null
 */
export function isType<T extends AnyFunction | AnyClass>(payload: any, type: T): payload is T {
    if (!(type instanceof Function)) {
        throw new TypeError('Type must be a function')
    }
    if (!Object.prototype.hasOwnProperty.call(type, 'prototype')) {
        throw new TypeError('Type is not a class')
    }
    // Classes usually have names (as functions usually have names)
    const name: string | undefined | null = (type as any).name
    return getType(payload) === name || Boolean(payload && payload.constructor === type)
}