import { EntityConfiguration } from "electrodb";

import { BaseEntityService, createEntitySchema, DefaultEntityOperations } from "..";
import { Service } from "../../decorators";
import { DIContainer } from "../../di";
import { MeiliSearchEngine } from "../../search";


const entitySchema = createEntitySchema({
  model: {
    entity: 'test',
    service: 'test-service',
    version: '1',
    entityNamePlural: 'tests',
    entityOperations: DefaultEntityOperations,
  },
  attributes: {
    id: {
      type: 'string',
      required: true,
    },
    name: {
      type: 'string',
      required: true,
    },
    description: {
      type: 'string',
      required: true,
    },
    createdAt: {
      type: 'string',
      required: true,
    },
    updatedAt: {
      type: 'string',
    },
  },
  indexes: {
    primary: {
      pk: {
        composite: [ 'id' ],
        field: 'pk',
      },
      sk: {
        composite: [ 'id' ],
        field: 'sk',
      }
    }
  }
})

@Service()
class TestEntityService extends BaseEntityService<typeof entitySchema> {
  constructor(
    entityConfigurations: EntityConfiguration = {
      table: 'test-table-entity-search-integration-test',
    },
  ) {
    super(entitySchema, entityConfigurations, DIContainer.ROOT);
  }
}

DIContainer.ROOT.setSearchEngine(new MeiliSearchEngine({
  host: 'http://localhost:7700',
  apiKey: 'xxx_your_master_key',
}));

const delay = async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms));

describe('Entity Search', () => {

  let entityService: TestEntityService;

  beforeAll(async () => {

    entityService = DIContainer.ROOT.resolve(TestEntityService);

    const searchService = entityService.getSearchService();
    const engine = searchService.getEngine() as MeiliSearchEngine;
    const indexName = entityService.getEntitySearchConfig().indexConfig?.indexName;

    // Clean up and create index
    try {
      console.log('checking if index exists', indexName);
      const exists = await engine.indexExists(indexName as string);
      if (exists) {
        console.log('deleting old index', indexName);
        await engine.deleteIndex(indexName as string, true);
      }
    } catch { }

    console.log('initializing new index', indexName);
    await searchService.initSearchIndex(true);
  }, 60000);

  beforeEach(async () => {
    // Clear all documents from the index before each test to ensure isolation
    const searchService = entityService.getSearchService();
    const engine = searchService.getEngine() as MeiliSearchEngine;
    const indexName = entityService.getEntitySearchConfig().indexConfig?.indexName;
    try {
      await engine.deleteAllDocuments(indexName as string, true);
    } catch (error) {
      // Ignore errors during cleanup
    }
  }, 10000);

  afterAll(async () => {

    const searchService = entityService.getSearchService();
    const engine = searchService.getEngine() as MeiliSearchEngine;
    const indexName = entityService.getEntitySearchConfig().indexConfig?.indexName;
    try {
      await engine.deleteIndex(indexName as string, true);
    } catch { }
  }, 60000);


  it('should be able to search for an entity', async () => {
    const searchResult = await entityService.search({ search: 'abcd' });
    console.log(searchResult);
    expect(searchResult).toBeDefined();
    expect(searchResult.hits).toBeDefined();
  }, 50000);

  it('should index an entity', async () => {
    await entityService.getSearchService().syncToIndex({
      id: '1',
      name: 'test',
      description: 'test',
      createdAt: '2021-01-01',
      updatedAt: '2021-01-01',
    }, undefined, undefined, true);

    const searchResult = await entityService.getSearchService().search({
      search: 'test',
    });
    console.log(searchResult);
    expect(searchResult).toBeDefined();
    expect(searchResult.hits).toBeDefined();
    expect(searchResult.hits.length).toBe(1);
    expect(searchResult.hits[ 0 ].id).toBe('1');

  }, 50000);

  it('should bulk index multiple entities and search them all', async () => {
    const entities = [
      { id: '2', name: 'alpha', description: 'first', createdAt: '2021-01-02', updatedAt: '2021-01-02' },
      { id: '3', name: 'beta', description: 'second', createdAt: '2021-01-03', updatedAt: '2021-01-03' },
      { id: '4', name: 'gamma', description: 'third', createdAt: '2021-01-04', updatedAt: '2021-01-04' },
    ];
    await entityService.getSearchService().bulkSync(entities, undefined, undefined, true);
    const searchResult = await entityService.search({ search: '' });
    expect(searchResult.total).toBeGreaterThanOrEqual(entities.length);
    const ids = searchResult.hits.map(h => h.id);
    expect(ids).toEqual(expect.arrayContaining([ '2', '3', '4' ]));
  }, 50000);

  it('should filter results by attribute', async () => {

    await entityService.getSearchService().updateIndexSettings({
      filterableAttributes: [ 'name' ],
    }, true);

    await entityService.getSearchService().bulkSync([
      { id: '5', name: 'active', description: 'desc', createdAt: '2021-01-05', updatedAt: '2021-01-05' },
      { id: '6', name: 'inactive', description: 'desc', createdAt: '2021-01-06', updatedAt: '2021-01-06' },
    ], undefined, undefined, true);

    const searchResult = await entityService.search({
      filters: {
        name: { eq: 'active' },
      },
    });
    expect(searchResult.hits.length).toBe(1);
    expect(searchResult.hits[ 0 ].id).toBe('5');
  }, 50000);

  it('should sort results by createdAt descending', async () => {
    await entityService.getSearchService().updateIndexSettings({
      sortableAttributes: [ 'createdAt' ],
    }, true);

    await entityService.getSearchService().bulkSync([
      { id: '7', name: 'sort1', description: 'desc', createdAt: '2021-01-07', updatedAt: '2021-01-07' },
      { id: '8', name: 'sort2', description: 'desc', createdAt: '2021-01-08', updatedAt: '2021-01-08' },
    ], undefined, undefined, true);

    const searchResult = await entityService.search({
      sort: [ { field: 'createdAt', dir: 'desc' } ],
    });
    expect(searchResult.hits[ 0 ].id).toBe('8');
    expect(searchResult.hits[ 1 ].id).toBe('7');
  }, 50000);

  it('should paginate results', async () => {
    await entityService.getSearchService().bulkSync([
      { id: '9', name: 'page1', description: 'desc', createdAt: '2021-01-09', updatedAt: '2021-01-09' },
      { id: '10', name: 'page2', description: 'desc', createdAt: '2021-01-10', updatedAt: '2021-01-10' },
      { id: '11', name: 'page3', description: 'desc', createdAt: '2021-01-11', updatedAt: '2021-01-11' },
    ], undefined, undefined, true);

    const searchResult = await entityService.search({
      pagination: { page: 1, limit: 2 },
    });
    expect(searchResult.hits.length).toBe(2);
  }, 50000);

  it('should select only specific fields', async () => {
    await entityService.getSearchService().syncToIndex({
      id: '12',
      name: 'select',
      description: 'desc',
      createdAt: '2021-01-12',
      updatedAt: '2021-01-12',
    }, undefined, undefined, true);

    const searchResult = await entityService.search({
      select: [ 'id', 'name' ],
    });
    expect(Object.keys(searchResult.hits[ 0 ]).sort()).toEqual([ 'id', 'name' ].sort());
  }, 50000);

  it('should return distinct results by name', async () => {
    await entityService.getSearchService().updateIndexSettings({
      filterableAttributes: [ 'name' ],
    }, true);

    await entityService.getSearchService().bulkSync([
      { id: '13', name: 'distinct', description: 'desc', createdAt: '2021-01-13', updatedAt: '2021-01-13' },
      { id: '14', name: 'distinct', description: 'desc', createdAt: '2021-01-14', updatedAt: '2021-01-14' },
    ], undefined, undefined, true);

    const searchResult = await entityService.search({
      distinct: 'name',
    });
    // Meilisearch distinct returns 1 hit per distinct value
    expect(searchResult.hits.length).toBe(1);
  }, 50000);

  it('should delete an entity from the index', async () => {
    await entityService.getSearchService().syncToIndex({
      id: '15',
      name: 'delete',
      description: 'desc',
      createdAt: '2021-01-15',
      updatedAt: '2021-01-15',
    }, undefined, undefined, true);

    await entityService.getSearchService().deleteFromIndex('15', undefined, undefined, true);

    const searchResult = await entityService.search({
      search: 'delete',
    });
    expect(searchResult.hits.length).toBe(0);
  }, 50000);

  it('should update an indexed entity', async () => {
    await entityService.getSearchService().syncToIndex({
      id: '16',
      name: 'update',
      description: 'old desc',
      createdAt: '2021-01-16',
      updatedAt: '2021-01-16',
    }, undefined, undefined, true);

    await entityService.getSearchService().syncToIndex({
      id: '16',
      name: 'update',
      description: 'new desc',
      createdAt: '2021-01-16',
      updatedAt: '2021-01-16',
    }, undefined, undefined, true);

    const searchResult = await entityService.search({
      search: 'update',
    });
    expect(searchResult.hits[ 0 ].description).toBe('new desc');
  }, 50000);

  it('should return empty results for non-existent search', async () => {
    const searchResult = await entityService.search({
      search: 'nonexistentkeywordthatshouldnotmatchanything',
    });
    expect(searchResult.hits.length).toBe(0);
  }, 50000);

  it('should return all results for empty search', async () => {
    await entityService.getSearchService().bulkSync([
      { id: '17', name: 'all1', description: 'desc', createdAt: '2021-01-17', updatedAt: '2021-01-17' },
      { id: '18', name: 'all2', description: 'desc', createdAt: '2021-01-18', updatedAt: '2021-01-18' },
    ], undefined, undefined, true);

    const searchResult = await entityService.search({
      search: '',
    });
    expect(searchResult.total).toBeGreaterThanOrEqual(2);
  }, 50000);

  describe('Geo Search', () => {
    beforeEach(async () => {
      // Set geo attributes as filterable and sortable
      await entityService.getSearchService().updateIndexSettings({
        filterableAttributes: [ '_geo' ],
        sortableAttributes: [ '_geo' ],
      }, true);

      // Add some geo-tagged entities
      await entityService.getSearchService().bulkSync([
        { id: 'geo1', name: 'Near', description: 'desc', createdAt: '2021-01-19', _geo: { lat: 40.7128, lng: -74.0060 } }, // New York
        { id: 'geo2', name: 'Mid', description: 'desc', createdAt: '2021-01-20', _geo: { lat: 34.0522, lng: -118.2437 } }, // Los Angeles
        { id: 'geo3', name: 'Far', description: 'desc', createdAt: '2021-01-21', _geo: { lat: 51.5074, lng: -0.1278 } },   // London
      ] as any[], undefined, undefined, true);
    });

    it('should filter results by geoRadius', async () => {
      const searchResult = await entityService.search({
        geoRadiusFilter: {
          center: { lat: 40.7128, lng: -74.0060 },
          distanceInMeters: 100000, // 100km
        },
      });
      expect(searchResult.hits.length).toBe(1);
      expect(searchResult.hits[ 0 ].id).toBe('geo1');
    }, 50000);

    it('should sort results by _geoPoint ascending (nearest first)', async () => {
      const searchResult = await entityService.search({
        geoSort: {
          point: { lat: 40.7128, lng: -74.0060 }, // New York
          direction: 'asc',
        },
      });
      expect(searchResult.hits[ 0 ].id).toBe('geo1'); // New York
      expect(searchResult.hits[ 1 ].id).toBe('geo2'); // LA
      expect(searchResult.hits[ 2 ].id).toBe('geo3'); // London
    }, 50000);

    it('should sort results by _geoPoint descending (farthest first)', async () => {
      const searchResult = await entityService.search({
        geoSort: {
          point: { lat: 40.7128, lng: -74.0060 }, // New York
          direction: 'desc',
        },
      });
      expect(searchResult.hits[ 0 ].id).toBe('geo3'); // London
      expect(searchResult.hits[ 1 ].id).toBe('geo2'); // LA
      expect(searchResult.hits[ 2 ].id).toBe('geo1'); // New York
    }, 50000);
  });
});
