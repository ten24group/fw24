import { BaseEntityService } from "../base-service";
import { BaseEntityController } from "../base-entity-controller";
import { createEntitySchema, DefaultEntityOperations } from "../base-entity";
import { DIContainer } from "../../di";
import { ExecutionContext } from "../../core/types/execution-context";
import { EntityConfiguration } from 'electrodb';

describe("Entity Overhaul & Advanced Features", () => {

    // =========================================================================
    // BASE TESTS (Restored)
    // =========================================================================
    const mockEntityConfigurations: any = { table: "test-table" };
    const baseSchema = createEntitySchema({
        model: {
            entity: "test",
            entityNamePlural: "Tests",
            service: "testService",
            version: "1",
            entityOperations: {
                ...DefaultEntityOperations,
                customOp: {
                    enabled: true,
                    method: 'POST',
                    path: '/custom-op',
                    handler: 'customHandler',
                    label: 'Custom Op'
                },
                disabledOp: {
                    enabled: false,
                    method: 'GET',
                    path: '/disabled'
                }
            }
        },
        attributes: {
            id: { type: "string", required: true, isIdentifier: true },
            name: { type: "string", required: true },
            status: { type: "string" }
        },
        indexes: {
            primary: {
                pk: { field: "pk", composite: ["id"] },
                sk: { field: "sk", composite: [] }
            }
        }
    } as const);

    class TestService extends BaseEntityService<typeof baseSchema> {
        constructor() { super(baseSchema, mockEntityConfigurations, DIContainer.ROOT); }
        async customHandler(payload: any, ctx?: ExecutionContext) {
            return { success: true, payload, operation: 'customOp' };
        }
        public beforeHookCalled = false;
        public afterHookCalled = false;
        protected async onBeforeCreate(payload: any, ctx?: ExecutionContext) {
            this.beforeHookCalled = true;
            return await super.onBeforeCreate(payload, ctx);
        }
        protected async onAfterCreate(record: any, ctx?: ExecutionContext) {
            this.afterHookCalled = true;
            await super.onAfterCreate(record, ctx);
        }
    }

    describe("BaseEntityService Operations & Hooks", () => {
        let service: TestService;
        beforeEach(() => { service = new TestService(); });

        it("should correctly resolve operations config", () => {
            const config = service.getOperationsConfig();
            expect(config.get).toBeDefined();
            expect(config.customOp).toBeDefined();
            expect(config.customOp.enabled).toBe(true);
            expect(config.disabledOp.enabled).toBe(false);
        });

        it("should execute custom operation via executeOperation", async () => {
            const payload = { data: "test" };
            const result = await service.executeOperation('customOp' as any, payload);
            expect(result).toEqual({ success: true, payload, operation: 'customOp' });
        });

        it("should throw error for disabled operation", async () => {
            await expect(service.executeOperation('disabledOp' as any, {})).rejects.toThrow(/not enabled/);
        });

        it("should trigger hooks during create operation", async () => {
            const mockRepo = {
                create: jest.fn().mockReturnValue({ go: jest.fn().mockResolvedValue({ data: { id: "1", name: "test" } }) }),
                _findBestIndexKeyMatch: jest.fn().mockReturnValue({ keys: [], index: '', shouldScan: true }),
                scan: { where: jest.fn().mockReturnThis(), go: jest.fn().mockResolvedValue({ data: [] }) }
            };
            jest.spyOn(service, 'getRepository').mockReturnValue(mockRepo as any);
            jest.spyOn(service, 'isUniqueAttributeValue').mockResolvedValue(true);

            const payload = { id: "1", name: "test" };
            await service.executeOperation('create', payload);
            expect(service.beforeHookCalled).toBe(true);
            expect(service.afterHookCalled).toBe(true);
        });
    });

    describe("BaseEntityController Metadata Routing", () => {
        let service: TestService;
        beforeEach(() => { service = new TestService(); });

        it("should register custom routes based on metadata", () => {
            const controller = new BaseEntityController(service);
            const routes = (controller as any).routes;
            expect(routes['POST|/custom-op']).toBeDefined();
            expect(routes['POST|/custom-op'].functionName).toBe('handleDynamicOperation');
        });

        it("should NOT register disabled routes", () => {
            const controller = new BaseEntityController(service);
            const routes = (controller as any).routes;
            expect(routes['GET|/disabled']).toBeUndefined();
        });

        it("should map standard routes to executeOperation", async () => {
            const controller = new BaseEntityController(service);
            const mockExecute = jest.spyOn(service, 'executeOperation').mockResolvedValue({ id: '1' } as any);
            const req: any = { body: { name: 'test' }, path: '/tests' };
            const res: any = { json: jest.fn().mockImplementation(data => data) };
            await controller.create(req, res, {});
            expect(mockExecute).toHaveBeenCalledWith('create', req.body, expect.anything());
        });
    });

    // =========================================================================
    // ADVANCED FEATURES
    // =========================================================================

    describe("Geospatial Support", () => {
        const GeoSchema = createEntitySchema({
            model: { entity: 'geoTest', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
            attributes: { id: { type: 'string', required: true, isIdentifier: true }, location: { type: 'any', geo: true } },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        class GeoService extends BaseEntityService<typeof GeoSchema> {
            constructor() { super(GeoSchema, { table: 'test' } as any); }
        }

        test('should generate geohash and perform geoSearch', async () => {
            const service = new GeoService();
            const payload = { id: '1', location: { lat: 40.7128, lng: -74.0060 } };
            const mockRepo: any = {
                create: (data: any) => ({ go: async () => ({ data }) }),
                query: { primary: () => ({ where: () => ({ go: async () => ({ data: [payload] }) }), go: async () => ({ data: [] }) }) },
                _findBestIndexKeyMatch: () => ({ keys: [], index: 'primary', shouldScan: false })
            };
            jest.spyOn(service, 'getRepository').mockReturnValue(mockRepo);
            jest.spyOn(service, 'isUniqueAttributeValue').mockResolvedValue(true);

            const created = await service.executeOperation('create', payload);
            expect((created as any).data.__geohash).toBeDefined();

            jest.spyOn(service, 'list').mockResolvedValue({ data: [created.data] } as any);
            const searchResult = await service.geoSearch({
                attribute: 'location',
                center: { lat: 40.7128, lng: -74.0060 },
                radiusInMeters: 1000
            });
            expect(searchResult.length).toBe(1);
            expect(searchResult[0].id).toBe('1');
        });
    });

    describe("Hierarchical Data (Trees)", () => {
        const TreeSchema = createEntitySchema({
            model: {
                entity: 'treeTest',
                service: 'test',
                version: '1',
                entityOperations: DefaultEntityOperations,
                tree: { strategy: 'path', parentAttribute: 'parentId' }
            },
            attributes: { id: { type: 'string', required: true, isIdentifier: true }, parentId: { type: 'string' }, __path: { type: 'string' } },
            indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
        } as const);

        class TreeService extends BaseEntityService<typeof TreeSchema> {
            constructor() { super(TreeSchema, { table: 'test' } as any); }
        }

        test('should maintain path and traverse', async () => {
            const service = new TreeService();
            const parent = { id: 'p1', __path: 'p1/' };
            const child = { id: 'c1', parentId: 'p1' };
            jest.spyOn(service, 'get').mockImplementation(async (opts: any) => {
                if (opts.identifiers.id === 'p1') return parent as any;
                if (opts.identifiers.id === 'c1') return { ...child, __path: 'p1/c1/' } as any;
                return null;
            });
            const mockRepo: any = {
                create: (data: any) => ({ go: async () => ({ data }) }),
                query: { primary: () => ({ where: () => ({ go: async () => ({ data: [] }) }), go: async () => ({ data: [] }) }) },
                _findBestIndexKeyMatch: () => ({ keys: [], index: 'primary', shouldScan: false })
            };
            jest.spyOn(service, 'getRepository').mockReturnValue(mockRepo);
            jest.spyOn(service, 'isUniqueAttributeValue').mockResolvedValue(true);

            const createdChild = await service.executeOperation('create', child);
            expect((createdChild as any).data.__path).toBe('p1/c1/');

            jest.spyOn(service, 'batchGet').mockResolvedValue({ data: [parent] } as any);
            const ancestors = await service.getAncestors({ id: 'c1' });
            expect(ancestors.length).toBe(1);
            expect(ancestors[0].id).toBe('p1');
        });
    });

    describe("Many-to-Many Relationships", () => {
        test('should attach and detach', async () => {
            const UserSchema = createEntitySchema({
                model: { entity: 'user', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
                attributes: {
                    id: { type: 'string', required: true, isIdentifier: true },
                    roles: { type: 'string', relation: { entityName: 'role', type: 'many-to-many', identifiers: { source: 'id', target: 'id' } } }
                },
                indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
            } as const);

            const UserRoleSchema = createEntitySchema({
                model: { entity: 'userRole', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
                attributes: { userId: { type: 'string', isIdentifier: true }, roleId: { type: 'string', isIdentifier: true } },
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
    });

    describe("Dependency Tracking (Subscription)", () => {
        test('should propagate updates via DependencyManager', async () => {
            const { EntityDependencyManager } = require('../dependency-manager');
            const SourceSchema = createEntitySchema({
                model: { entity: 'source', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
                attributes: {
                    id: { type: 'string', required: true, isIdentifier: true },
                    name: { type: 'string' }
                },
                indexes: { primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } } }
            } as const);

            class SourceService extends BaseEntityService<typeof SourceSchema> {
                constructor() { super(SourceSchema, { table: 'test' } as any); }
            }

            const sourceService = new SourceService();
            const propagateSpy = jest.spyOn(EntityDependencyManager, 'propagateChanges').mockResolvedValue(undefined);

            await (sourceService as any).onAfterUpdate({ id: 's1', name: 'New Name' });
            expect(propagateSpy).toHaveBeenCalledWith('source', expect.objectContaining({ id: 's1', name: 'New Name' }), expect.arrayContaining(['name']), undefined);
        });
    });
});
