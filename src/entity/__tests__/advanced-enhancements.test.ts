import { BaseEntityService } from '../base-service';
import { createEntitySchema, DefaultEntityOperations } from '../base-entity';
import { DIContainer } from '../../di';
import { EntityConfiguration } from 'electrodb';

describe('Advanced Entity Enhancements', () => {

    // =========================================================================
    // VERSIONING TESTS
    // =========================================================================
    const VersionedSchema = createEntitySchema({
        model: {
            entity: 'versionTest',
            service: 'test',
            version: '2',
            entityOperations: DefaultEntityOperations,
            versioning: {
                version: '2',
                transformers: {
                    '1': (data: any) => ({ ...data, name: data.oldName, transformed: true })
                }
            }
        },
        attributes: {
            id: { type: 'string', required: true, isIdentifier: true },
            name: { type: 'string' },
            oldName: { type: 'string' },
            transformed: { type: 'boolean' },
            __v: { type: 'string' }
        },
        indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
    } as const);

    class VersionedService extends BaseEntityService<typeof VersionedSchema> {
        constructor() { super(VersionedSchema, { table: 'test' } as any); }
    }

    test('Versioning: should transform old record to new version on read', async () => {
        const service = new VersionedService();
        const oldRecord = { id: '1', oldName: 'Old', __v: '1' };

        jest.spyOn(service, 'getRepository').mockReturnValue({
            get: () => ({ go: async () => ({ data: oldRecord }) }),
            _findBestIndexKeyMatch: () => ({ keys: [], index: 'primary', shouldScan: false })
        } as any);

        const result = await service.get({ identifiers: { id: '1' } });
        expect(result!.name).toBe('Old');
        expect(result!.transformed).toBe(true);
        expect(result!.__v).toBe('2');
    });

    // =========================================================================
    // CACHING TESTS
    // =========================================================================
    test('Caching: should use cache if enabled', async () => {
        const CacheSchema = createEntitySchema({
            model: {
                entity: 'cacheTest',
                service: 'test',
                version: '1',
                entityOperations: DefaultEntityOperations,
                cache: { enabled: true }
            },
            attributes: { id: { type: 'string', required: true, isIdentifier: true } },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        const mockCache = {
            get: jest.fn().mockResolvedValue({ id: 'cached' }),
            set: jest.fn(),
            delete: jest.fn()
        };

        const mockDI: any = {
            resolve: (token: string) => token === 'CacheProvider' ? mockCache : null,
            collectBestProvidersFor: () => []
        };

        class CachedService extends BaseEntityService<typeof CacheSchema> {
            constructor() { super(CacheSchema, { table: 'test' } as any, mockDI); }
        }

        const service = new CachedService();
        const result = await service.get({ identifiers: { id: '1' } });

        expect(mockCache.get).toHaveBeenCalled();
        expect(result!.id).toBe('cached');
    });
});
