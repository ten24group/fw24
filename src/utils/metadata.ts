import { merge } from "./merge";

type MetadataManagerConfig = {
    namespace?: string;
}

export class MetadataManager {
    private namespace: string;

    constructor(config: MetadataManagerConfig = {}) {
        this.namespace = config.namespace || 'fw24:metadata:default';
    }

    private getNamespacedKey(key: string): string {
        if(key.startsWith(this.namespace)){
            return key;
        }
        return `${this.namespace}_${key}`;
    }

    private setMetadata(target: object, key: string, value: any, override = false) {
        const metadataKey = this.getNamespacedKey(key);
        if (Reflect.has(target, metadataKey) && !override) {
            throw new Error(`Metadata for key "${key}" already exists and override flag is not set.`);
        }
        Reflect.set(target, metadataKey, value);
    }

    private getMetadata(target: object, key: string): any | undefined {
        const metadataKey = this.getNamespacedKey(key);
        if (Reflect.has(target, metadataKey)) {
            return Reflect.get(target, metadataKey);
        }
        return undefined;
    }

    private hasMetadata(target: object, key: string): boolean {
        const metadataKey = this.getNamespacedKey(key);
        return Reflect.has(target, metadataKey);
    }

    private deleteMetadata(target: object, key: string) {
        const metadataKey = this.getNamespacedKey(key);
        if (Reflect.has(target, metadataKey)) {
            Reflect.deleteProperty(target, metadataKey);
        }
    }

    setClassMetadata<T>(target: Function, value: T, override = false) {
        this.setMetadata(target, 'classMetadata', value, override);
    }

    getClassMetadata<T>(target: Function): T | undefined {
        return this.getMetadata(target, 'classMetadata') as T;
    }

    hasClassMetadata(target: Function): boolean {
        return this.hasMetadata(target, 'classMetadata');
    }

    setClassMetadataForKey<T>(target: Function, key: string | symbol, value: T, override = false) {
        const classMetadata: Record< string | symbol, any> = this.getClassMetadata(target) || {};
        if(classMetadata[key] !== undefined && !override){
            throw new Error(`Class Metadata for key "${String(key)}" already exists and override flag is not set.`);
        }
        classMetadata[key] = value;
        this.setClassMetadata(target, classMetadata, override);
    }

    getClassMetadataForKey<T>(target: Function, key: string | symbol ): T | undefined {
        const classMetadata: Record< string | symbol, any> = this.getClassMetadata(target) || {};
        return classMetadata?.[key] || undefined;
    }

    hasClassMetadataFOrKey(target: Function, key: string | symbol): boolean {
        const classMetadata: Record< string | symbol, any> = this.getClassMetadata(target) || {};
        return classMetadata && classMetadata.hasOwnProperty(key);
    }

    setPropertyMetadata<T>(target: Object, propertyKey: string | number | symbol, value: T, override = false) {
        this.setMetadata(target, `propertyMetadata_${String(propertyKey)}`, value, override);
    }

    getPropertyMetadata<T>(target: any, propertyKey: string | number | symbol): T | undefined {
        return this.getMetadata(target, `propertyMetadata_${String(propertyKey)}`);
    }

    hasPropertyMetadata<T extends object,>(target: T, propertyKey: keyof T): boolean {
        return this.hasMetadata(target, `propertyMetadata_${String(propertyKey)}`);
    }

    setMethodMetadata<T extends object, K extends keyof T>(
        target: T, 
        propertyKey: K, 
        value: any, 
        override = false
    ) {
        this.setMetadata(target, `methodMetadata_${String(propertyKey)}`, value, override);
    }

    getMethodMetadata<Val extends unknown, T extends object = any, K extends keyof T = any>(target: T, propertyKey: K): Val | undefined {
        return this.getMetadata(target, `methodMetadata_${String(propertyKey)}`) as Val;
    }

    hasMethodMetadata<T extends object>(target: T, propertyKey: keyof T): boolean {
        return this.hasMetadata(target, `methodMetadata_${String(propertyKey)}`);
    }

    setParameterMetadata<T extends object>(
        target: Function | T,
        propertyKey: keyof T | undefined,
        parameterIndex: number,
        value: any,
        override = false
    ) {
        const existingParameters: any[] = this.getMetadata(target, `parameterMetadata_${String(propertyKey)}`) || [];
        if (existingParameters[parameterIndex] !== undefined && !override) {
            throw new Error(`Metadata for parameter at index "${parameterIndex}" already exists and override flag is not set.`);
        }
        existingParameters[parameterIndex] = value;
        this.setMetadata(target, `parameterMetadata_${String(propertyKey)}`, existingParameters, override);
    }

    getParameterMetadata<Val extends Array<any>, T extends object = any>(target: T, propertyKey: keyof T | undefined): Val {
        return this.getMetadata(target, `parameterMetadata_${String(propertyKey)}`) || [];
    }

    hasParameterMetadata<T extends object>(target: T, propertyKey: keyof T | undefined): boolean {
        return this.hasMetadata(target, `parameterMetadata_${String(propertyKey)}`);
    }

    removeClassMetadata(target: Function) {
        this.deleteMetadata(target, 'classMetadata');
    }

    removePropertyMetadata<T extends object>(target: T, propertyKey: keyof T) {
        this.deleteMetadata(target, `propertyMetadata_${String(propertyKey)}`);
    }

    removeMethodMetadata<T extends object>(target: T, propertyKey: keyof T) {
        this.deleteMetadata(target, `methodMetadata_${String(propertyKey)}`);
    }

    removeParameterMetadata<T extends object>(target: T, propertyKey: keyof T | undefined) {
        this.deleteMetadata(target, `parameterMetadata_${String(propertyKey)}`);
    }

    listMetadataKeys(target: Object): string[] {
        const keys: string[] = [];
        for (const key in target) {
            if (Reflect.has(target, key)) {
                keys.push(key);
            }
        }
        return keys;
    }

    mergeMetadata<T extends object>(target: Object, propertyKey: keyof T, ...sources: any[]) {
        const merged = merge([{}, ...sources]);
        this.setMetadata(target, `propertyMetadata_${String(propertyKey)}`, merged, true);
    }

    cloneMetadata(source: Object, target: Object) {
        const metadataKeys = this.listMetadataKeys(source);
        metadataKeys.forEach((key) => {
            if (key.includes(this.namespace)) {
                const metadata = this.getMetadata(source, key as any);
                this.setMetadata(target, key as any, metadata, true);
            }
        });
    }

    setPropertiesMetadata<T extends object>(target: T, properties: { [K in keyof T]?: T[K] }, override = false) {
        for (const propertyKey in properties) {
            if (properties.hasOwnProperty(propertyKey)) {
                this.setPropertyMetadata(target, propertyKey as keyof T, properties[propertyKey] as T[keyof T], override);
            }
        }
    }

    getPropertiesMetadata<T extends object>(target: T, propertyKeys: (keyof T)[]): Partial<T> {
        const metadata: Partial<T> = {};
        for (const propertyKey of propertyKeys) {
            metadata[propertyKey] = this.getPropertyMetadata(target, propertyKey);
        }
        return metadata;
    }

    removePropertiesMetadata<T extends object>(target: T, propertyKeys: (keyof T)[]) {
        for (const propertyKey of propertyKeys) {
            this.removePropertyMetadata(target, propertyKey);
        }
    }
}

export function useMetadataManager(config: MetadataManagerConfig){
    return new MetadataManager(config);
}

export const defaultMetadataManager = new MetadataManager();