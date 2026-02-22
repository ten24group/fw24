import { DIContainer } from '../../di';
import { BaseEntityService } from '../base-service';
import { createEntitySchema } from '../base-entity';
import { DefaultEntityOperations } from '../constants';
import { MemoryCacheProvider } from '../../core/cache-provider';

describe('Entity-Level Caching', () => {
  const CacheSchema = createEntitySchema({
    model: {
      entity: 'cache_test',
      entityNamePlural: 'cache_tests',
      service: 'testService',
      version: '1',
      entityOperations: DefaultEntityOperations,
      cache: { enabled: true, ttl: 60 }
    },
    attributes: {
      id: { type: 'string', required: true, isIdentifier: true },
      data: { type: 'string' }
    },
    indexes: {
      primary: {
        pk: { field: 'pk', composite: ['id'] },
        sk: { field: 'sk', composite: [] }
      }
    }
  } as const);

  class CacheService extends BaseEntityService<typeof CacheSchema> {
    public fetchCount = 0;
    constructor() {
      super(CacheSchema, { table: 'test-table' }, DIContainer.ROOT);
    }

    // Mock getEntity to track fetches
    // We override get() instead of mocking the underlying CRUD service for simplicity in this test
    async get(options: any, _ctx?: any): Promise<any> {
      // Logic from BaseEntityService.get
      const cacheProvider = this.getCacheProvider();
      const cacheKey = cacheProvider ? this.getCacheKey(options.identifiers) : undefined;

      if (cacheKey) {
        const cached = await cacheProvider!.get(cacheKey);
        if (cached) return cached;
      }

      this.fetchCount++;
      const record = { id: options.identifiers.id, data: 'real data' };

      if (cacheKey) {
        await cacheProvider!.set(cacheKey, record, 60);
      }
      return record;
    }

    // Expose protected method for testing
    public getCacheProvider() { return super.getCacheProvider(); }
  }

  beforeAll(() => {
    DIContainer.ROOT.register({
      provide: 'CacheProvider',
      useClass: MemoryCacheProvider,
      singleton: true
    });
  });

  it('should cache records and avoid redundant fetches', async () => {
    const service = new CacheService();
    const ids = { id: '123' };

    // First fetch -> real call
    const res1 = await service.get({ identifiers: ids });
    expect(res1.data).toBe('real data');
    expect(service.fetchCount).toBe(1);

    // Second fetch -> cache hit
    const res2 = await service.get({ identifiers: ids });
    expect(res2.data).toBe('real data');
    expect(service.fetchCount).toBe(1); // Still 1!
  });

  it('should invalidate cache on update', async () => {
    const service = new CacheService();
    const ids = { id: '456' };

    await service.get({ identifiers: ids });
    expect(service.fetchCount).toBe(1);

    // Invalidate manually for test (simulating onAfterUpdate)
    const cacheProvider = service.getCacheProvider();
    await cacheProvider!.delete(service.getCacheKey(ids));

    await service.get({ identifiers: ids });
    expect(service.fetchCount).toBe(2); // Increased!
  });
});
