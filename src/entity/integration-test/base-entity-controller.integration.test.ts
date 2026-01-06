import { Entity, EntityConfiguration } from "electrodb";
import { BaseEntityService, createEntitySchema, DefaultEntityOperations } from "..";
import { DIContainer, OnInit } from "../../di";
import { Service } from "../../decorators";
import { EntitySearchService, MeiliSearchEngine } from "../../search";
import { LambdaTestHarness } from '../../testing/lambda-test-harness';
import { Controller } from '../../decorators';
import { BaseEntityController } from '../base-entity-controller';

describe('BaseEntityController Search Integration (real MeiliSearch)', () => {
  const indexName = `testcontroller-${Math.random().toString(36).substring(2, 9)}`;

  // --- Setup test entity schema and service ---
  const entitySchema = createEntitySchema({
    model: {
      entity: 'testcontroller',
      service: 'testcontroller-service',
      version: '1',
      entityNamePlural: 'testcontrollers',
      entityOperations: DefaultEntityOperations,
      search: {
        enabled: true,
        indexConfig: {
          indexName
        }
      }
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
    constructor(entityConfigurations: EntityConfiguration = {
      table: 'test-table-base-entity-controller-integration-test',
    }) {
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

  beforeAll(async () => {
    // Use 127.0.0.1 for better stability in some environments
    DIContainer.ROOT.setSearchEngine(new MeiliSearchEngine({
      host: 'http://127.0.0.1:7700',
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

    await searchService.initSearchIndex(true);
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
    await searchService.bulkSync(testEntities, undefined, undefined, true);
  });

  afterEach(async () => {
    await searchService.deleteAllDocuments(true);
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
      expect(Object.keys(body.items[ 0 ]).sort()).toEqual([ 'id', 'name' ].sort());
    }, 60000);

    it('should combine search, filters, sort, and pagination', async () => {
      const response = await harness.post('/search', {
        body: {
          search: 'Alpha',
          filters: { status: { eq: 'active' } },
          sort: [ { field: 'createdAt', dir: 'desc' } ],
          pagination: { limit: 1 }
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name).toBe('Alpha Beta Mix');
    }, 60000);

    it('should paginate results correctly', async () => {
      const response1 = await harness.post('/search', {
        body: { pagination: { page: 1, limit: 2 } }
      });
      const response2 = await harness.post('/search', {
        body: { pagination: { page: 2, limit: 2 } }
      });
      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(body1.items.length).toBe(2);
      expect(body2.items.length).toBe(2);
      expect(body1.items[ 0 ].id).not.toBe(body2.items[ 0 ].id);
    }, 60000);

    it('should return empty results for non-matching search', async () => {
      const response = await harness.post('/search', {
        body: { search: 'NonExistent' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(0);
      expect(body.total).toBe(0);
    }, 60000);

    it('should handle special characters in search', async () => {
      const response = await harness.post('/search', {
        body: { search: '@!#$%' }
      });
      expect(response.statusCode).toBe(200);
    }, 60000);
  });

  describe('GET /search', () => {
    it('should support search via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { search: 'Alpha' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
    }, 60000);

    it('should support filters via query string with eq operator', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { 'status.eq': 'active' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(3);
    }, 60000);

    it('should support in filter via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { 'status.in': 'active,pending' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(4);
    }, 60000);

    it('should support sorting via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { sort: 'name:asc' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const names = body.items.map((item: any) => item.name);
      expect(names).toEqual([ ...names ].sort());
    }, 60000);

    it('should support multiple sort fields via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { sort: 'status:asc,name:desc' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
    }, 60000);

    it('should support field selection via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { attributes: 'id,name' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Object.keys(body.items[ 0 ]).sort()).toEqual([ 'id', 'name' ].sort());
    }, 60000);

    it('should support pagination via query string', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { page: '1', limit: '2' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
    }, 60000);

    it('should combine multiple query parameters', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {
          search: 'Alpha',
          'status.eq': 'active',
          sort: 'createdAt:desc',
          limit: '1'
        }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name).toBe('Alpha Beta Mix');
    }, 60000);

    it('should handle empty query parameters gracefully', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: {}
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(5);
    }, 60000);

    it('should handle invalid pagination parameters gracefully', async () => {
      const response = await harness.get('/search', {
        queryStringParameters: { page: 'invalid', limit: 'invalid' }
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeGreaterThan(0);
    }, 60000);
  });
});
