import { BaseEntityService } from '../base-service';
import { createEntitySchema, DefaultEntityOperations } from '../base-entity';
import { DIContainer } from '../../di';
import { EntityConfiguration } from 'electrodb';

describe('Advanced Entity Features Integration', () => {

    // =========================================================================
    // GEO TEST
    // =========================================================================
    const GeoSchema = createEntitySchema({
        model: {
            entity: 'geoTest',
            service: 'test',
            version: '1',
            entityOperations: DefaultEntityOperations
        },
        attributes: {
            id: { type: 'string', required: true, isIdentifier: true },
            location: { type: 'any', geo: true }
        },
        indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
    } as const);

    class GeoService extends BaseEntityService<typeof GeoSchema> {
        constructor() { super(GeoSchema, { table: 'test' } as any); }
    }

    test('Geo Support: should generate geohash and perform geoSearch', async () => {
        const service = new GeoService();
        const payload = { id: '1', location: { lat: 40.7128, lng: -74.0060 } }; // NYC

        // Mock getRepository
        const mockRepo: any = {
            create: (data: any) => ({ go: async () => ({ data }) }),
            query: { primary: () => ({
                where: () => ({ go: async () => ({ data: [payload] }) }),
                go: async () => ({ data: [] })
            }) },
            _findBestIndexKeyMatch: () => ({ keys: [], index: 'primary', shouldScan: false })
        };
        jest.spyOn(service, 'getRepository').mockReturnValue(mockRepo);

        // Mock uniqueness check to pass
        jest.spyOn(service, 'isUniqueAttributeValue').mockResolvedValue(true);

        const created = await service.executeOperation('create', payload);
        expect((created as any).data.__geohash).toBeDefined();

        // Test geoSearch
        jest.spyOn(service, 'list').mockResolvedValue({ data: [created.data] } as any);
        const searchResult = await service.geoSearch({
            attribute: 'location',
            center: { lat: 40.7128, lng: -74.0060 },
            radiusInMeters: 1000
        });

        expect(searchResult.length).toBe(1);
        expect(searchResult[0].id).toBe('1');
    });

    // =========================================================================
    // TREE TEST
    // =========================================================================
    const TreeSchema = createEntitySchema({
        model: {
            entity: 'treeTest',
            service: 'test',
            version: '1',
            entityOperations: DefaultEntityOperations,
            tree: { strategy: 'path', parentAttribute: 'parentId' }
        },
        attributes: {
            id: { type: 'string', required: true, isIdentifier: true },
            parentId: { type: 'string' },
            __path: { type: 'string' }
        },
        indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
    } as const);

    class TreeService extends BaseEntityService<typeof TreeSchema> {
        constructor() { super(TreeSchema, { table: 'test' } as any); }
    }

    test('Tree Support: should maintain path and traverse', async () => {
        const service = new TreeService();
        const parent = { id: 'p1', __path: '' };
        const child = { id: 'c1', parentId: 'p1' };

        jest.spyOn(service, 'get').mockImplementation(async (opts: any) => {
            if (opts.identifiers.id === 'p1') return parent;
            if (opts.identifiers.id === 'c1') return { ...child, __path: 'p1' };
            return null;
        });

        const mockRepo: any = {
            create: (data: any) => ({ go: async () => ({ data }) }),
            query: { primary: () => ({
                where: () => ({ go: async () => ({ data: [] }) }),
                go: async () => ({ data: [] })
            }) },
            _findBestIndexKeyMatch: () => ({ keys: [], index: 'primary', shouldScan: false })
        };
        jest.spyOn(service, 'getRepository').mockReturnValue(mockRepo);
        jest.spyOn(service, 'isUniqueAttributeValue').mockResolvedValue(true);

        const createdChild = await service.executeOperation('create', child);
        expect((createdChild as any).data.__path).toBe('p1');

        // Test Ancestors/Descendants
        jest.spyOn(service, 'batchGet').mockResolvedValue({ data: [parent] } as any);
        const ancestors = await service.getAncestors({ id: 'c1' });
        expect(ancestors.length).toBe(1);
        expect(ancestors[0].id).toBe('p1');
    });

    // =========================================================================
    // M:N TEST
    // =========================================================================
    test('Many-to-Many: should attach and detach', async () => {
        const UserSchema = createEntitySchema({
            model: { entity: 'user', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
            attributes: {
                id: { type: 'string', required: true, isIdentifier: true },
                roles: { type: 'string', relation: { entityName: 'role', type: 'many-to-many', identifiers: { source: 'id', target: 'id' } } }
            },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        const RoleSchema = createEntitySchema({
            model: { entity: 'role', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
            attributes: { id: { type: 'string', required: true, isIdentifier: true } },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        const UserRoleSchema = createEntitySchema({
            model: { entity: 'userRole', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
            attributes: {
                userId: { type: 'string', isIdentifier: true },
                roleId: { type: 'string', isIdentifier: true }
            },
            indexes: { primary: { pk: { field: 'pk', composite: ['userId', 'roleId'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        class UserService extends BaseEntityService<typeof UserSchema> {
            constructor() { super(UserSchema, { table: 'test' } as any); }
        }
        class BridgeService extends BaseEntityService<typeof UserRoleSchema> {
            constructor() { super(UserRoleSchema, { table: 'test' } as any); }
        }

        const userService = new UserService();
        const bridgeService = new BridgeService();

        jest.spyOn(userService, 'getEntityServiceByEntityName').mockReturnValue(bridgeService as any);
        const bridgeSpy = jest.spyOn(bridgeService, 'executeOperation').mockResolvedValue({} as any);
        jest.spyOn(userService, 'extractEntityIdentifiers').mockReturnValue({ userId: 'u1' });
        jest.spyOn(bridgeService, 'extractEntityIdentifiers').mockReturnValue({ roleId: 'r1' });

        await userService.attach({ relation: 'roles', id: 'u1', targetId: 'r1' });
        expect(bridgeSpy).toHaveBeenCalledWith('upsert', expect.objectContaining({ userId: 'u1', roleId: 'r1' }), undefined);
    });

    // =========================================================================
    // DEPENDENCY TEST
    // =========================================================================
    test('Dependencies: should propagate updates', async () => {
        const SourceSchema = createEntitySchema({
            model: { entity: 'source', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
            attributes: {
                id: { type: 'string', required: true, isIdentifier: true },
                name: { type: 'string', dependencies: [{ entityName: 'target', attributeName: 'sourceName', mapping: { id: 'sourceId' } }] }
            },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        const TargetSchema = createEntitySchema({
            model: { entity: 'target', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
            attributes: {
                id: { type: 'string', required: true, isIdentifier: true },
                sourceId: { type: 'string' },
                sourceName: { type: 'string' }
            },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        class SourceService extends BaseEntityService<typeof SourceSchema> {
            constructor() { super(SourceSchema, { table: 'test' } as any); }
        }
        class TargetService extends BaseEntityService<typeof TargetSchema> {
            constructor() { super(TargetSchema, { table: 'test' } as any); }
        }

        const sourceService = new SourceService();
        const targetService = new TargetService();

        jest.spyOn(sourceService, 'getEntityServiceByEntityName').mockReturnValue(targetService as any);
        jest.spyOn(targetService, 'list').mockResolvedValue({ data: [{ id: 't1', sourceId: 's1' }] } as any);
        const targetUpdateSpy = jest.spyOn(targetService, 'executeOperation').mockResolvedValue({} as any);

        // Trigger onAfterUpdate
        await (sourceService as any).onAfterUpdate({ id: 's1', name: 'New Name' });

        expect(targetUpdateSpy).toHaveBeenCalledWith('update', expect.objectContaining({
            data: { sourceName: 'New Name' }
        }), undefined);
    });
});
