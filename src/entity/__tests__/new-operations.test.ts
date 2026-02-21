import { BaseEntityService } from '../base-service';
import { createEntitySchema } from '../base-entity';
import { DefaultEntityOperations } from '../constants';
import { EntityConfiguration } from 'electrodb';

describe('New OOB Operations', () => {
    const TestSchema = createEntitySchema({
        model: {
            entity: 'test',
            service: 'test',
            version: '1',
            entityOperations: {
                ...DefaultEntityOperations,
                export: { ...DefaultEntityOperations.export, enabled: true },
                import: { ...DefaultEntityOperations.import, enabled: true },
                patch: { ...DefaultEntityOperations.patch, enabled: true },
                restore: { ...DefaultEntityOperations.restore, enabled: true },
                archive: { ...DefaultEntityOperations.archive, enabled: true },
            },
            softDelete: true, // enables softDelete
        },
        attributes: {
            id: { type: 'string', required: true },
            name: { type: 'string' },
            deletedAt: { type: 'string', readOnly: true },
            archivedAt: { type: 'string' },
        },
        indexes: {
            primary: {
                pk: { field: 'pk', composite: ['id'] },
                sk: { field: 'sk', composite: [] },
            }
        }
    } as const);

    class TestService extends BaseEntityService<typeof TestSchema> {
        constructor() {
            super(TestSchema, { table: 'test-table' } as EntityConfiguration);
        }

        // Mock list to return some data for export
        public async list(query: any = {}): Promise<any[]> {
            return [{ id: '1', name: 'Test 1' }, { id: '2', name: 'Test 2' }];
        }

        // Mock batchUpsert for import
        public async batchUpsert(items: any[]): Promise<any[]> {
            return items.map(item => ({ data: item, status: 'created' }));
        }

        // Mock update for patch, restore, archive
        public async update(id: any, data: any): Promise<any> {
            return { id, ...data, status: 'updated' };
        }
    }

    let service: TestService;

    beforeEach(() => {
        service = new TestService();
    });

    test('export should return data', async () => {
        const result = await service.executeOperation('export', {});
        expect(result.data).toHaveLength(2);
        expect(result.data[0].name).toBe('Test 1');
    });

    test('import should call batchUpsert', async () => {
        const items = [{ id: '3', name: 'Test 3' }];
        const result = await service.executeOperation('import', { items });
        expect(result.count).toBe(1);
        expect(result.results[0].data.id).toBe('3');
    });

    test('patch should call update for each id', async () => {
        const ids = [{ id: '1' }, { id: '2' }];
        const data = { name: 'Patched' };
        const result = await service.executeOperation('patch', { ids, data });
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('Patched');
    });

    test('restore should set deletedAt to null', async () => {
        const id = { id: '1' };
        const result = await service.executeOperation('restore', id);
        expect(result.deletedAt).toBeNull();
    });

    test('archive should set archivedAt', async () => {
        const id = { id: '1' };
        const result = await service.executeOperation('archive', id);
        expect(result.archivedAt).toBeDefined();
        expect(new Date(result.archivedAt).getTime()).toBeGreaterThan(0);
    });
});

describe('Custom Operations with Handlers', () => {
    const CustomSchema = createEntitySchema({
        model: {
            entity: 'custom',
            service: 'test',
            version: '1',
            entityOperations: {
                ...DefaultEntityOperations,
                calculate: {
                    enabled: true,
                    method: 'POST',
                    path: '/calculate',
                    handler: 'doCalculation',
                    label: 'Calculate'
                },
            }
        },
        attributes: {
            id: { type: 'string', required: true },
        },
        indexes: {
            primary: {
                pk: { field: 'pk', composite: ['id'] },
                sk: { field: 'sk', composite: [] },
            }
        }
    } as const);

    class CustomService extends BaseEntityService<typeof CustomSchema> {
        constructor() {
            super(CustomSchema, { table: 'test-table' } as EntityConfiguration);
        }

        async doCalculation(payload: { value: number }, ctx?: any) {
            return { result: payload.value * 2 };
        }
    }

    test('should execute custom handler', async () => {
        const service = new CustomService();
        const result = await service.executeOperation('calculate' as any, { value: 21 });
        expect(result.result).toBe(42);
    });
});

describe('Operation Guards', () => {
    const GuardSchema = createEntitySchema({
        model: {
            entity: 'guardTest',
            service: 'test',
            version: '1',
            entityOperations: {
                ...DefaultEntityOperations,
                restricted: {
                    enabled: true,
                    method: 'POST',
                    path: '/restricted',
                    guards: ['isAllowed']
                },
            }
        },
        attributes: {
            id: { type: 'string', required: true },
        },
        indexes: {
            primary: {
                pk: { field: 'pk', composite: ['id'] },
                sk: { field: 'sk', composite: [] },
            }
        }
    } as const);

    class GuardService extends BaseEntityService<typeof GuardSchema> {
        public allowed = false;
        constructor() {
            super(GuardSchema, { table: 'test-table' } as EntityConfiguration);
        }

        async isAllowed(payload: any, ctx?: any) {
            return this.allowed;
        }

        async restricted(payload: any, ctx?: any) {
            return { success: true };
        }
    }

    test('should block operation if guard fails', async () => {
        const service = new GuardService();
        service.allowed = false;
        await expect(service.executeOperation('restricted' as any, {})).rejects.toThrow('Access Denied');
    });

    test('should allow operation if guard passes', async () => {
        const service = new GuardService();
        service.allowed = true;
        const result = await service.executeOperation('restricted' as any, {});
        expect(result.success).toBe(true);
    });
});
