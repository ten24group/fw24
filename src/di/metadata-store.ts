export type GetMetadataOptions = {
    key: string | symbol, 
    target: any, 
    propertyKey?: string | symbol
}

export type DefineMetadataOptions<T extends any = any> = GetMetadataOptions & {
    value: T,
}

export interface IMetadataStore {
    clear(): void;
    defineMetadata<T extends any = any>(options: DefineMetadataOptions<T> ): void;
    getMetadata<T extends any = any>(options: GetMetadataOptions): T | undefined;
    hasMetadata(key: string | symbol, target: any): boolean;
}

export class MetadataStore implements IMetadataStore {
    private metadata = new Map<any, Map<string | symbol, any>>();

    clear() {
        this.metadata.clear();
    }
    
    defineMetadata<T extends any = any>(options: DefineMetadataOptions<T> ) {
        const { key, value, target, propertyKey } = options;
        const targetMetaKey = target.name || target;

        if (!this.metadata.has(targetMetaKey)) {
            this.metadata.set(targetMetaKey, new Map());
        }
        const targetMetadata = this.metadata.get(targetMetaKey)!;

        const metaKey = propertyKey !== undefined ? `${String(propertyKey)}_${String(key)}` : String(key);

        targetMetadata.set(metaKey, value);
    }

    getMetadata<T extends any = any>(options: GetMetadataOptions): T | undefined {

        const { key, target, propertyKey } = options;
        const targetMetaKey = target.name || target;

        if (!this.metadata.has(targetMetaKey)) {
            return undefined;
        }
        const targetMetadata = this.metadata.get(targetMetaKey)!;

        const metaKey = propertyKey !== undefined ? `${String(propertyKey)}_${String(key)}` : String(key);

        return targetMetadata.get(metaKey);
    }

    hasMetadata(key: string | symbol, target: any): boolean {
        const targetMetaKey = target.name || target;
        return this.metadata.has(targetMetaKey) && this.metadata.get(targetMetaKey)!.has(String(key));
    }
}