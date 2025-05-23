import { Entity, EntityConfiguration } from "electrodb";
import { BaseEntityService, createEntitySchema, DefaultEntityOperations } from "..";
import { DIContainer, OnInit } from "../../di";
import { Service } from "../../decorators";
import { EntitySearchService, MeiliSearchEngine } from "../../search";
import { LambdaTestHarness } from '../../testing/lambda-test-harness';
import { Controller } from '../../decorators';
import { BaseEntityController } from '../base-entity-controller';

describe('BaseEntityController Search Integration (real MeiliSearch)', () => {
  // --- Setup test entity schema and service ---
  const entitySchema = createEntitySchema({
    model: {
      entity: 'testcontroller',
      service: 'testcontroller-service',
      version: '1',
      entityNamePlural: 'testcontrollers',
      entityOperations: DefaultEntityOperations,
    },
    attributes: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      status: { type: 'string', required: true },
      createdAt: { type: 'string', required: true },
    },
    indexes: {
      primary: {
        pk: { composite: [ 'id' ], field: 'pk' },
        sk: { composite: [ 'id' ], field: 'sk' },
      },
    },
  });

  @Service()
  class TestEntityService extends BaseEntityService<typeof entitySchema> {
    constructor(entityConfigurations: EntityConfiguration) {
      super(entitySchema, entityConfigurations, DIContainer.ROOT);
    }
  }

  @Controller('testcontroller')
  class TestEntityController extends BaseEntityController<typeof entitySchema> {
    constructor() {
      super(DIContainer.ROOT.resolve(TestEntityService));
    }
  }

  let entityService: TestEntityService;
  let searchService: EntitySearchService<any>;
  let harness: LambdaTestHarness;
  let controller: TestEntityController;
  const indexName = 'testcontroller';

  beforeAll(async () => {

    DIContainer.ROOT.setSearchEngine(new MeiliSearchEngine({
      host: 'http://localhost:7700',
      apiKey: 'xxx_your_master_key',
    }));

    entityService = DIContainer.ROOT.resolve(TestEntityService);
    searchService = entityService.getSearchService();
    controller = new TestEntityController();
    harness = new LambdaTestHarness(controller as any);

    // Clean up and create index
    const engine = searchService.getEngine() as MeiliSearchEngine;
    try {
      const exists = await engine.indexExists(indexName);
      if (exists) await engine.deleteIndex(indexName, true);
    } catch { }
    await new Promise(res => setTimeout(res, 1000));
    await searchService.initSearchIndex();
    await new Promise(res => setTimeout(res, 2000));
  }, 60000);

  afterAll(async () => {
    const engine = searchService.getEngine() as MeiliSearchEngine;
    try { await engine.deleteIndex(indexName, true); } catch { }
  }, 60000);

  // --- Seed data before each test ---
  const testEntities = [
    { id: '1', name: 'Alpha Product', status: 'active', createdAt: '2023-01-01' },
    { id: '2', name: 'Beta Service', status: 'inactive', createdAt: '2023-01-02' },
    { id: '3', name: 'Gamma Tool', status: 'active', createdAt: '2023-01-03' },
    { id: '4', name: 'Delta App', status: 'pending', createdAt: '2023-01-04' },
    { id: '5', name: 'Alpha Beta Mix', status: 'active', createdAt: '2023-01-05' },
  ];

  beforeEach(async () => {
    await searchService.bulkSync(testEntities);
    await new Promise(res => setTimeout(res, 1000));
  });

  afterEach(async () => {
    // Clean up index between tests
    await searchService.deleteAllDocuments();
    await new Promise(res => setTimeout(res, 500));
  });

  describe('POST /search', () => {
    it('should return all items for empty search', async () => {
      const response = await harness.post('/search', { body: {} });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      expect(body.total).toBe(5);
    }, 60000);

    it('should filter by search string', async () => {
      const response = await harness.post('/search', { body: { search: 'Alpha' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
      expect(body.items.every((item: any) => item.name.includes('Alpha'))).toBe(true);
    }, 60000);

    it('should filter by status with eq operator', async () => {
      const response = await harness.post('/search', { body: { filters: { status: { eq: 'active' } } } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(3);
      expect(body.items.every((item: any) => item.status === 'active')).toBe(true);
    }, 60000);

    it('should filter by status with neq operator', async () => {
      const response = await harness.post('/search', { body: { filters: { status: { neq: 'active' } } } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
      expect(body.items.every((item: any) => item.status !== 'active')).toBe(true);
    }, 60000);

    it('should filter with in operator', async () => {
      const response = await harness.post('/search', {
        body: { filters: { status: { in: [ 'active', 'pending' ] } } }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(4);
      expect(body.items.every((item: any) => [ 'active', 'pending' ].includes(item.status))).toBe(true);
    }, 60000);

    it('should filter with nin operator', async () => {
      const response = await harness.post('/search', {
        body: { filters: { status: { nin: [ 'inactive' ] } } }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(4);
      expect(body.items.every((item: any) => item.status !== 'inactive')).toBe(true);
    }, 60000);

    it('should filter with NOT logical operator', async () => {
      const response = await harness.post('/search', {
        body: {
          filters: {
            not: [
              { status: { eq: 'inactive' } }
            ]
          }
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(4);
      expect(body.items.every((item: any) => item.status !== 'inactive')).toBe(true);
    }, 60000);

    it('should sort results by name ascending', async () => {
      const response = await harness.post('/search', {
        body: {
          sort: [ { field: 'name', dir: 'asc' } ]
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      const names = body.items.map((item: any) => item.name);
      expect(names).toEqual([ ...names ].sort());
    }, 60000);

    it('should sort results by createdAt descending', async () => {
      const response = await harness.post('/search', {
        body: {
          sort: [ { field: 'createdAt', dir: 'desc' } ]
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      const dates = body.items.map((item: any) => item.createdAt);
      expect(dates).toEqual([ ...dates ].sort().reverse());
    }, 60000);

    it('should select specific fields', async () => {
      const response = await harness.post('/search', {
        body: {
          select: [ 'id', 'name' ]
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      body.items.forEach((item: any) => {
        expect(Object.keys(item).sort()).toEqual([ 'id', 'name' ].sort());
      });
    }, 60000);

    it('should combine search, filters, sort, and pagination', async () => {
      const response = await harness.post('/search', {
        body: {
          search: 'Alpha',
          filters: { status: { eq: 'active' } },
          sort: [ { field: 'name', dir: 'asc' } ],
          pagination: { page: 1, limit: 1 }
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name).toBe('Alpha Beta Mix');
      expect(body.items[ 0 ].status).toBe('active');
    }, 60000);

    it('should paginate results correctly', async () => {
      const page1 = await harness.post('/search', {
        body: {
          sort: [ { field: 'id', dir: 'asc' } ],
          pagination: { page: 1, limit: 2 }
        }
      });
      const page2 = await harness.post('/search', {
        body: {
          sort: [ { field: 'id', dir: 'asc' } ],
          pagination: { page: 2, limit: 2 }
        }
      });

      expect(page1.statusCode).toBe(200);
      expect(page2.statusCode).toBe(200);

      const body1 = JSON.parse(page1.body);
      const body2 = JSON.parse(page2.body);

      expect(body1.items.length).toBe(2);
      expect(body2.items.length).toBe(2);
      expect(body1.total).toBe(5);
      expect(body2.total).toBe(5);

      // Ensure no overlap between pages
      const page1Ids = body1.items.map((item: any) => item.id);
      const page2Ids = body2.items.map((item: any) => item.id);
      expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids));
    }, 60000);

    it('should return empty results for non-matching search', async () => {
      const response = await harness.post('/search', { body: { search: 'NonExistent' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(0);
      expect(body.total).toBe(0);
    }, 60000);

    it('should handle special characters in search', async () => {
      // First add an entity with special characters
      const specialEntity = { id: '99', name: 'Test-Item @#$%', status: 'active', createdAt: '2023-01-99' };
      await searchService.syncToIndex(specialEntity, undefined, undefined, true);
      await new Promise(res => setTimeout(res, 1000));

      const response = await harness.post('/search', { body: { search: 'Test-Item' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name).toBe('Test-Item @#$%');
    }, 60000);
  });

  describe('GET /search', () => {
    it('should support search via query string', async () => {
      const response = await harness.get('/search', { queryStringParameters: { q: 'Beta' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
      expect(body.items.every((item: any) => item.name.includes('Beta'))).toBe(true);
    }, 60000);

    it('should support filters via query string with eq operator', async () => {
      const response = await harness.get('/search', { queryStringParameters: { status: 'inactive' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].status).toBe('inactive');
    }, 60000);

    it('should support in filter via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          'status.in': 'active,pending'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(4);
      expect(body.items.every((item: any) => [ 'active', 'pending' ].includes(item.status))).toBe(true);
    }, 60000);

    it('should support sorting via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          sort: 'name:asc'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      const names = body.items.map((item: any) => item.name);
      expect(names).toEqual([ ...names ].sort());
    }, 60000);

    it('should support multiple sort fields via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          sort: 'status:asc,name:desc'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
    }, 60000);

    it('should support field selection via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          attributes: 'id,name'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      body.items.forEach((item: any) => {
        expect(Object.keys(item).sort()).toEqual([ 'id', 'name' ].sort());
      });
    }, 60000);

    it('should support pagination via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          hitsPerPage: '2',
          page: '2',
          sort: 'id:asc'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
      expect(body.total).toBe(5);
      expect([ '3', '4' ]).toContain(body.items[ 0 ].id);
    }, 60000);

    it('should combine multiple query parameters', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          q: 'Alpha',
          status: 'active',
          sort: 'name:asc',
          hitsPerPage: '1',
          page: '1'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name.includes('Alpha')).toBe(true);
      expect(body.items[ 0 ].status).toBe('active');
    }, 60000);

    it('should handle empty query parameters gracefully', async () => {
      const response = await harness.get('/search', { queryStringParameters: {} });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
      expect(body.total).toBe(5);
    }, 60000);

    it('should handle invalid pagination parameters gracefully', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          hitsPerPage: 'invalid',
          page: 'notanumber'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Should use default pagination values
      expect(body.items.length).toBeGreaterThan(0);
    }, 60000);
  });
}); 