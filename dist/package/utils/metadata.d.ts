type MetadataManagerConfig = {
    namespace?: string;
};
export declare class MetadataManager {
    private namespace;
    private metadataMap;
    logMetadata(): void;
    clearMetadata(): void;
    constructor(config?: MetadataManagerConfig);
    private getNamespacedKey;
    private ensureTargetMetadata;
    private setMetadata;
    private getMetadata;
    private hasMetadata;
    private deleteMetadata;
    setClassMetadata<T>(target: Function, value: T, override?: boolean): void;
    getClassMetadata<T>(target: Function): T | undefined;
    hasClassMetadata(target: Function): boolean;
    setClassMetadataForKey<T>(target: Function, key: string | symbol, value: T, override?: boolean): void;
    getClassMetadataForKey<T>(target: Function, key: string | symbol): T | undefined;
    hasClassMetadataForKey(target: Function, key: string | symbol): boolean;
    setPropertyMetadata<T>(target: object, propertyKey: string | number | symbol, value: T, override?: boolean): void;
    getPropertyMetadata<T>(target: any, propertyKey: string | number | symbol): T | undefined;
    hasPropertyMetadata<T extends object>(target: T, propertyKey: keyof T): boolean;
    setMethodMetadata<T extends object, K extends keyof T>(target: T, propertyKey: K, value: any, override?: boolean): void;
    getMethodMetadata<Val extends unknown, T extends object = any, K extends keyof T = any>(target: T, propertyKey: K): Val | undefined;
    hasMethodMetadata<T extends object>(target: T, propertyKey: keyof T): boolean;
    setParameterMetadata<T extends object>(target: Function | T, propertyKey: keyof T | undefined, parameterIndex: number, value: any, override?: boolean): void;
    getParameterMetadata<Val extends Array<any>, T extends object = any>(target: T, propertyKey: keyof T | undefined): Val;
    hasParameterMetadata<T extends object>(target: T, propertyKey: keyof T | undefined): boolean;
    removeClassMetadata(target: Function): void;
    removePropertyMetadata<T extends object>(target: T, propertyKey: keyof T): void;
    removeMethodMetadata<T extends object>(target: T, propertyKey: keyof T): void;
    removeParameterMetadata<T extends object>(target: T, propertyKey: keyof T | undefined): void;
    listMetadataKeys(target: object): string[];
    mergeMetadata<T extends object>(target: object, propertyKey: keyof T, ...sources: any[]): void;
    cloneMetadata(source: object, target: object): void;
    setPropertiesMetadata<T extends object>(target: T, properties: {
        [K in keyof T]?: T[K];
    }, override?: boolean): void;
    getPropertiesMetadata<T extends object>(target: T, propertyKeys: (keyof T)[]): Partial<T>;
    removePropertiesMetadata<T extends object>(target: T, propertyKeys: (keyof T)[]): void;
}
export {};
