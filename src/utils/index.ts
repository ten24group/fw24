export * from './cases';
export * from './datatypes';
export * from './exclude';
export * from './merge';
export * from './parse';
export * from './serialize';
export * from './types';

export function getValueByPath(obj: any, path: string): any {
    if (typeof path !== 'string') {
        throw new Error('Path must be a string');
    }

    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
        if (current === null || typeof current !== 'object') {
            throw new Error(`Invalid path: ${key} not found`);
        }

        current = current[key];
    }

    return current;
}

export function setValueByPath(obj: any, path: string, value: any): any {
    if (typeof path !== 'string') {
        throw new Error('Path must be a string');
    }

    const keys = path.split('.');
    let current = obj;
    
    const lastKey = keys.pop();

    for (const key of keys) {
        // Check if the current value is an object. If not, replace it with an empty object or array.
        if (current[key] === null || typeof current[key] !== 'object') {
            current[key] = isNaN(Number(key)) ? {} : [];
        }
        current = current[key];
    }

    if(!lastKey){
        throw new Error('Invalid path');
    }

    // Check if the current value is an object. If not, throw an error.
    if (current === null || typeof current !== 'object') {
        throw new Error(`Cannot set property ${lastKey} on non-object value`);
    }

    current[lastKey] = value;
}