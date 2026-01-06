import { FrameworkError } from '../errors';
export * from './cases';
export * from './datatypes';
export * from './exclude';
export * from './merge';
export * from './parse';
export * from './serialize';
export * from './types';
export * from './timer';
export * from './metadata';
export * from './keys';
export * from './env';
export * from './compression';
export declare class ValueByPathError extends FrameworkError {
    constructor(message: string, details?: Record<string, any>);
}
export declare function getValueByPath<T = any>(obj: Record<string, any>, path: string, defaultValue?: T): T;
