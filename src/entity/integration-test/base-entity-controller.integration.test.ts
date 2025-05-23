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

  // --- Setup MeiliSearch engine and DI ---
  beforeAll(async () => {
    DIContainer.ROOT.setSearchEngine(new MeiliSearchEngine({
      host: 'http://localhost:7700',
      apiKey: 'xxx_your_master_key',
    }));
  });

  let entityService: TestEntityService;
  let searchService: EntitySearchService<any>;
  let harness: LambdaTestHarness;
  let controller: TestEntityController;
  const indexName = 'testcontroller';

  beforeAll(async () => {
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
    { id: '1', name: 'Alpha', status: 'active', createdAt: '2023-01-01' },
    { id: '2', name: 'Beta', status: 'inactive', createdAt: '2023-01-02' },
    { id: '3', name: 'Gamma', status: 'active', createdAt: '2023-01-03' },
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
      expect(body.items.length).toBe(3);
      expect(body.total).toBe(3);
    }, 60000);

    it('should filter by search string', async () => {
      const response = await harness.post('/search', { body: { search: 'Alpha' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name).toBe('Alpha');
    }, 60000);

    it('should filter by status', async () => {
      const response = await harness.post('/search', { body: { filters: { status: { eq: 'active' } } } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(2);
      expect(body.items.map((i: any) => i.status)).toEqual([ 'active', 'active' ]);
    }, 60000);

    it('should paginate results', async () => {
      const response = await harness.post('/search', { body: { pagination: { page: 2, limit: 1 } } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.total).toBe(3);
    }, 60000);
  });

  describe('GET /search', () => {
    it('should support search via query string', async () => {
      const response = await harness.get('/search', { queryStringParameters: { q: 'Beta' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].name).toBe('Beta');
    }, 60000);

    it('should support filters via query string', async () => {
      const response = await harness.get('/search', { queryStringParameters: { status: 'inactive' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[ 0 ].status).toBe('inactive');
    }, 60000);

    it('should support pagination via query string', async () => {
      const response = await harness.get('/search', { queryStringParameters: { hitsPerPage: '1', page: '3' } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.total).toBe(3);
    }, 60000);
  });
}); 