import { MetadataStore, DefineMetadataOptions, GetMetadataOptions } from './metadata-store';

describe('MetadataStorage', () => {
    let metadataStorage: MetadataStore;

    beforeEach(() => {
        metadataStorage = new MetadataStore();
    });

    it('should define and retrieve metadata correctly', () => {
        const target = {};
        const key = 'testKey';
        const value = 'testValue';

        const defineOptions: DefineMetadataOptions<string> = { key, value, target };
        metadataStorage.defineMetadata(defineOptions);

        const getOptions: GetMetadataOptions = { key, target };
        const retrievedValue = metadataStorage.getMetadata<string>(getOptions);

        expect(retrievedValue).toBe(value);
    });

    it('should return undefined for non-existent metadata', () => {
        const target = {};
        const key = 'nonExistentKey';

        const getOptions: GetMetadataOptions = { key, target };
        const retrievedValue = metadataStorage.getMetadata<string>(getOptions);

        expect(retrievedValue).toBeUndefined();
    });

    it('should correctly check for metadata existence', () => {
        const target = {};
        const key = 'testKey';
        const value = 'testValue';

        const defineOptions: DefineMetadataOptions<string> = { key, value, target };
        metadataStorage.defineMetadata(defineOptions);

        const hasMetadata = metadataStorage.hasMetadata(key, target);
        expect(hasMetadata).toBe(true);

        const nonExistentKey = 'nonExistentKey';
        const hasNonExistentMetadata = metadataStorage.hasMetadata(nonExistentKey, target);
        expect(hasNonExistentMetadata).toBe(false);
    });

    it('should handle metadata with propertyKey correctly', () => {
        const target = {};
        const key = 'testKey';
        const propertyKey = 'testProperty';
        const value = 'testValue';

        const defineOptions: DefineMetadataOptions<string> = { key, value, target, propertyKey };
        metadataStorage.defineMetadata(defineOptions);

        const getOptions: GetMetadataOptions = { key, target, propertyKey };
        const retrievedValue = metadataStorage.getMetadata<string>(getOptions);

        expect(retrievedValue).toBe(value);
    });
});