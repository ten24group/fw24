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