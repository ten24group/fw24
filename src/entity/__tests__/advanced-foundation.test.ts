import { BaseEntityService } from "../base-service";
import { createEntitySchema, DefaultEntityOperations, createGeoIndex } from "../base-entity";
import { DIContainer } from "../../di";

describe("Advanced Entity Foundation Integration", () => {
    const mockEntityConfigurations: any = { table: "test-table" };

    const TreeSchema = createEntitySchema({
        model: {
            entity: 'treeNode',
            service: 'test',
            version: '1',
            entityOperations: DefaultEntityOperations,
            tree: { strategy: 'both', parentAttribute: 'parentId', pathAttribute: '__path' }
        },
        attributes: {
            id: { type: 'string', required: true, isIdentifier: true },
            parentId: { type: 'string' },
            name: { type: 'string' },
            __path: { type: 'string' }
        },
        indexes: {
            primary: { pk: { field: 'pk', composite: ['id'] }, sk: { field: 'sk', composite: [] } }
        }
    } as const);

    class TreeService extends BaseEntityService<typeof TreeSchema> {
        constructor() { super(TreeSchema, mockEntityConfigurations, DIContainer.ROOT); }
    }

    const UserSchema = createEntitySchema({
        model: { entity: 'user', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
        attributes: {
            userId: { type: 'string', required: true, isIdentifier: true },
            roles: { type: 'string', relation: { entityName: 'role', type: 'many-to-many', identifiers: { source: 'userId', target: 'roleId' } } }
        },
        indexes: { primary: { pk: { field: 'pk', composite: ['userId'] }, sk: { field: 'sk', composite: [] } } }
    } as const);

    const RoleSchema = createEntitySchema({
        model: { entity: 'role', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
        attributes: { roleId: { type: 'string', required: true, isIdentifier: true } },
        indexes: { primary: { pk: { field: 'pk', composite: ['roleId'] }, sk: { field: 'sk', composite: [] } } }
    } as const);

    const UserRoleSchema = createEntitySchema({
        model: { entity: 'userRole', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
        attributes: {
            userId: { type: 'string', required: true, isIdentifier: true },
            roleId: { type: 'string', required: true, isIdentifier: true }
        },
        indexes: {
            primary: { pk: { field: 'pk', composite: ['userId'] }, sk: { field: 'sk', composite: ['roleId'] } }
        }
    } as const);

    class UserService extends BaseEntityService<typeof UserSchema> {
        constructor() { super(UserSchema, mockEntityConfigurations, DIContainer.ROOT); }
    }
    class RoleService extends BaseEntityService<typeof RoleSchema> {
        constructor() { super(RoleSchema, mockEntityConfigurations, DIContainer.ROOT); }
    }
    class UserRoleService extends BaseEntityService<typeof UserRoleSchema> {
        constructor() { super(UserRoleSchema, mockEntityConfigurations, DIContainer.ROOT); }
    }

    let treeService: TreeService;
    let userService: UserService;
    let roleService: RoleService;
    let userRoleService: UserRoleService;

    beforeEach(() => {
        treeService = new TreeService();
        userService = new UserService();
        roleService = new RoleService();
        userRoleService = new UserRoleService();

        jest.spyOn(DIContainer.ROOT, 'resolveEntityService').mockImplementation((name: string) => {
            if (name === 'userRole' || name === 'UserRole') return userRoleService;
            if (name === 'role') return roleService;
            if (name === 'user') return userService;
            return null as any;
        });
    });

    describe("Tree 'move' operation", () => {
        it("should call update on record and descendants", async () => {
            // Realistic paths ending with separator as per implementation
            const child = { id: 'c1', parentId: 'p1', __path: 'root/p1/c1/' };
            const grandchild = { id: 'gc1', parentId: 'c1', __path: 'root/p1/c1/gc1/' };

            // Mock 'get' and 'list'
            // move() calls get() on target, update() on target, get() on target again, then list() on descendants
            jest.spyOn(treeService, 'get')
                .mockResolvedValueOnce(child as any) // first get in move()
                .mockResolvedValueOnce({ ...child, __path: 'root/p2/c1/' } as any); // get after update in move()

            jest.spyOn(treeService, 'list').mockResolvedValue({ data: [child, grandchild] } as any);

            const updateSpy = jest.spyOn(treeService, 'executeOperation').mockImplementation(async (op: string) => {
                if (op === 'update') return { data: {} } as any;
                return {} as any;
            });
            const transactionSpy = jest.spyOn(treeService, 'executeTransaction').mockResolvedValue({} as any);

            await treeService.move({ id: { id: 'c1' }, newParentId: 'p2' });

            // Verify move() triggered update of the target record's parent
            expect(updateSpy).toHaveBeenCalledWith('update', expect.objectContaining({
                data: expect.objectContaining({ parentId: 'p2' })
            }), undefined);

            // Verify descendants are updated with new path
            // Old prefix: root/p1/c1/
            // New prefix: root/p2/c1/
            expect(transactionSpy).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({
                    op: 'update',
                    payload: expect.objectContaining({
                        data: { __path: 'root/p2/c1/gc1/' }
                    })
                })
            ]), undefined);
        });
    });

    describe("M:N 'attach' and 'detach' operations", () => {
        it("should correctly manage bridge records", async () => {
            const bridgeUpsertSpy = jest.spyOn(userRoleService, 'executeOperation').mockResolvedValue({} as any);
            jest.spyOn(userService, 'extractEntityIdentifiers').mockReturnValue({ userId: 'u1' });
            jest.spyOn(roleService, 'extractEntityIdentifiers').mockReturnValue({ roleId: 'r1' });

            await userService.attach({
                relation: 'roles',
                id: { userId: 'u1' },
                targetId: { roleId: 'r1' }
            });

            expect(bridgeUpsertSpy).toHaveBeenCalledWith('upsert', expect.objectContaining({
                userId: 'u1',
                roleId: 'r1'
            }), undefined);
        });
    });

    describe("GeoSearch Index Matching", () => {
        it("should use __geohash begins filter", async () => {
            const GeoSchema = createEntitySchema({
                model: { entity: 'geoStore', service: 'test', version: '1', entityOperations: DefaultEntityOperations },
                attributes: { storeId: { type: 'string', required: true, isIdentifier: true }, location: { type: 'any', geo: true } },
                indexes: {
                    primary: { pk: { field: 'pk', composite: ['storeId'] }, sk: { field: 'sk', composite: [] } },
                    spatial: createGeoIndex({ index: 'gsi1' })
                }
            } as const);

            class GeoService extends BaseEntityService<typeof GeoSchema> {
                constructor() { super(GeoSchema, mockEntityConfigurations, DIContainer.ROOT); }
            }

            const geoService = new GeoService();
            const listSpy = jest.spyOn(geoService, 'list').mockResolvedValue({ data: [] } as any);

            await geoService.geoSearch({
                attribute: 'location',
                center: { lat: 40, lng: -70 },
                radiusInMeters: 5000
            });

            expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({
                filters: expect.objectContaining({
                    __geohash: { begins: expect.any(String) }
                })
            }), undefined);
        });
    });
});
