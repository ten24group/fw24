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
    entityConfigurations: EntityConfiguration,
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
    const indexName = entityService.getEntitySearchConfig().indexConfig.indexName;

    // Clean up and create index
    try {
      console.log('checking if index exists', indexName);
      const exists = await engine.indexExists(indexName as string);
      if (exists) {
        console.log('deleting old index', indexName);
        await engine.deleteIndex(indexName as string, true);
      }
    } catch { }

    await delay(1000);

    console.log('initializing new index', indexName);
    await searchService.initSearchIndex();

    await delay(2000);
  }, 60000);

  afterAll(async () => {

    const searchService = entityService.getSearchService();
    const engine = searchService.getEngine() as MeiliSearchEngine;
    const indexName = entityService.getEntitySearchConfig().indexConfig.indexName;
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

    // wait time to make sure changes are propagated in the search engine
    await delay(1000);

    await entityService.getSearchService().syncToIndex({
      id: '1',
      name: 'test',
      description: 'test',
      createdAt: '2021-01-01',
      updatedAt: '2021-01-01',
    });

    await delay(1000);

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
    await entityService.getSearchService().bulkSync(entities);
    await delay(1000);
    const searchResult = await entityService.search({ search: '' });
    expect(searchResult.total).toBeGreaterThanOrEqual(entities.length);
    const ids = searchResult.hits.map(h => h.id);
    expect(ids).toEqual(expect.arrayContaining([ '2', '3', '4' ]));
  }, 50000);

  it('should filter results by attribute', async () => {

    await entityService.getSearchService().updateIndexSettings({
      filterableAttributes: [ 'name' ],
    }, true);

    await delay(1000);

    await entityService.getSearchService().syncToIndex({
      id: '1',
      name: 'alpha',
      description: 'test',
      createdAt: '2021-01-01',
      updatedAt: '2021-01-01',
    });

    await delay(1000);

    const searchResult = await entityService.search({ filters: { name: { eq: 'alpha' } } });
    expect(searchResult.hits.length).toBe(1);
    expect(searchResult.hits[ 0 ].name).toBe('alpha');
  }, 20000);

  it('should sort results by createdAt descending', async () => {

    await entityService.getSearchService().updateIndexSettings({
      sortableAttributes: [ 'createdAt' ],
    }, true);

    await delay(1000);

    await entityService.getSearchService().bulkSync([ {
      id: '1',
      name: 'alpha',
      description: 'test',
      createdAt: '2021-01-01',
      updatedAt: '2021-01-01',
    },
    {
      id: '2',
      name: 'beta',
      description: 'test',
      createdAt: '2021-01-02',
      updatedAt: '2021-01-02',
    },
    {
      id: '3',
      name: 'gamma',
      description: 'test',
      createdAt: '2021-01-03',
      updatedAt: '2021-01-03',
    } ]);

    await delay(1000);

    const searchResult = await entityService.search({ sort: [ { field: 'createdAt', dir: 'desc' } ] });
    expect(searchResult.hits.length).toBeGreaterThan(1);
    const dates = searchResult.hits.map(h => h.createdAt);
    expect(dates).toEqual([ ...dates ].sort().reverse());
  }, 20000);

  it('should paginate results', async () => {
    await entityService.getSearchService().bulkSync([
      { id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01' },
      { id: '2', name: 'beta', description: 'test', createdAt: '2021-01-02', updatedAt: '2021-01-02' },
      { id: '3', name: 'gamma', description: 'test', createdAt: '2021-01-03', updatedAt: '2021-01-03' },
      { id: '4', name: 'delta', description: 'test', createdAt: '2021-01-04', updatedAt: '2021-01-04' },
      { id: '5', name: 'epsilon', description: 'test', createdAt: '2021-01-05', updatedAt: '2021-01-05' },
      { id: '6', name: 'zeta', description: 'test', createdAt: '2021-01-06', updatedAt: '2021-01-06' },
      { id: '7', name: 'eta', description: 'test', createdAt: '2021-01-07', updatedAt: '2021-01-07' },
      { id: '8', name: 'theta', description: 'test', createdAt: '2021-01-08', updatedAt: '2021-01-08' },
      { id: '9', name: 'iota', description: 'test', createdAt: '2021-01-09', updatedAt: '2021-01-09' },
      { id: '10', name: 'kappa', description: 'test', createdAt: '2021-01-10', updatedAt: '2021-01-10' },
    ]);
    await delay(1000);
    const page1 = await entityService.search({ pagination: { page: 1, limit: 2 } });
    const page2 = await entityService.search({ pagination: { page: 2, limit: 2 } });
    expect(page1.hits.length).toBeLessThanOrEqual(2);
    expect(page2.hits.length).toBeLessThanOrEqual(2);
    if (page1.hits.length > 0 && page2.hits.length > 0) {
      expect(page1.hits[ 0 ].id).not.toBe(page2.hits[ 0 ].id);
    }
  }, 20000);

  it('should select only specific fields', async () => {
    await entityService.getSearchService().bulkSync([
      { id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01' },
      { id: '2', name: 'beta', description: 'test', createdAt: '2021-01-02', updatedAt: '2021-01-02' },
    ]);
    await delay(1000);

    const searchResult = await entityService.search({ select: [ 'id', 'name' ] });
    expect(searchResult.hits.length).toBeGreaterThan(0);
    for (const hit of searchResult.hits) {
      expect(Object.keys(hit)).toEqual(expect.arrayContaining([ 'id', 'name' ]));
    }
  }, 20000);

  it('should return distinct results by name', async () => {
    await entityService.getSearchService().updateIndexSettings({
      filterableAttributes: [ 'name' ],
    }, true);

    await delay(1000);

    await entityService.getSearchService().bulkSync([
      {
        id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'

      },
      {
        id: '5', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
      }
    ]);
    await delay(1000);

    const searchResult = await entityService.search({ distinct: 'name' });
    const names = searchResult.hits.map(h => h.name);
    expect(new Set(names).size).toBe(names.length);
  }, 20000);

  it('should delete an entity from the index', async () => {

    await entityService.getSearchService().updateIndexSettings({
      filterableAttributes: [ 'id' ],
    }, true);

    await delay(1000);

    await entityService.getSearchService().bulkSync([
      {
        id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'

      },
      {
        id: '2', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
      }
    ]);
    await delay(1000);

    await entityService.getSearchService().deleteFromIndex('2');
    await delay(1000);

    const searchResult = await entityService.search({ filters: { id: { eq: '2' } } });
    expect(searchResult.hits.length).toBe(0);
  }, 20000);

  it('should update an indexed entity', async () => {

    await entityService.getSearchService().updateIndexSettings({
      filterableAttributes: [ 'id' ],
    }, true);

    await delay(1000);

    await entityService.getSearchService().bulkSync([
      {
        id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'

      },
      {
        id: '3', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
      }
    ]);
    await delay(1000);

    await entityService.getSearchService().syncToIndex({
      id: '3', name: 'beta-updated', description: 'second-updated', createdAt: '2021-01-03', updatedAt: '2021-01-06',
    });
    await delay(1000);

    const searchResult = await entityService.search({ filters: { id: { eq: '3' } } });
    expect(searchResult.hits.length).toBe(1);

    expect(searchResult.hits[ 0 ].name).toBe('beta-updated');
  }, 20000);

  it('should return empty results for non-existent search', async () => {
    const searchResult = await entityService.search({ search: 'nonexistentterm' });
    expect(searchResult.hits.length).toBe(0);
  }, 10000);

  it('should return all results for empty search', async () => {
    await entityService.getSearchService().bulkSync([
      {
        id: '1', name: 'alpha', description: 'test', createdAt: '2021-01-01', updatedAt: '2021-01-01'

      },
      {
        id: '3', name: 'alpha', description: 'duplicate', createdAt: '2021-01-05', updatedAt: '2021-01-05'
      }
    ]);
    await delay(1000);
    const searchResult = await entityService.search({ search: '' });
    expect(searchResult.hits.length).toBe(2);
  }, 10000);

  describe('Geo Search', () => {
    // ─── Geo Search Tests ───────────────────────────────────────────────────────
    const geoEntities = [
      {
        id: 'geo-1',
        name: 'Eiffel Tower',
        description: 'Landmark in Paris, France',
        createdAt: '2023-01-01',
        _geo: { lat: 48.8584, lng: 2.2945 }, // Paris
      },
      {
        id: 'geo-2',
        name: 'Colosseum',
        description: 'Amphitheatre in Rome, Italy',
        createdAt: '2023-01-02',
        _geo: { lat: 41.8902, lng: 12.4922 }, // Rome
      },
      {
        id: 'geo-3',
        name: 'Brandenburg Gate',
        description: 'Monument in Berlin, Germany',
        createdAt: '2023-01-03',
        _geo: { lat: 52.5163, lng: 13.3777 }, // Berlin
      },
      {
        id: 'geo-4',
        name: 'Louvre Museum',
        description: 'Art museum in Paris, France',
        createdAt: '2023-01-04',
        _geo: { lat: 48.8606, lng: 2.3376 }, // Paris, near Eiffel Tower
      },
    ];

    beforeAll(async () => {
      await entityService.getSearchService().updateIndexSettings({
        filterableAttributes: [ '_geo', 'name' ],
        sortableAttributes: [ '_geo' ], // Also make it sortable for later tests
      }, true);
      await delay(1000);

      await entityService.getSearchService().bulkSync(geoEntities);
      await delay(1000);
    });

    it('should filter results by geoRadius', async () => {

      // Search for locations within 5km of a point in central Paris
      const searchResult = await entityService.search({
        geoRadiusFilter: {
          center: { lat: 48.8570, lng: 2.3400 }, // Approx. central Paris
          distanceInMeters: 5000, // 5km
        },
      });

      expect(searchResult.hits.length).toBe(2); // Eiffel Tower and Louvre Museum
      const names = searchResult.hits.map(h => h.name).sort();
      expect(names).toEqual([ 'Eiffel Tower', 'Louvre Museum' ].sort());
    }, 20000);

    it('should sort results by _geoPoint ascending (nearest first)', async () => {
      // Sort by distance from a point closer to Eiffel Tower than Louvre
      const referencePoint = { lat: 48.8580, lng: 2.2900 }; // Very close to Eiffel Tower

      const searchResult = await entityService.search({
        // No text search, get all relevant geo entities
        geoSort: {
          point: referencePoint,
          direction: 'asc',
        },
        // Filter to only include Paris landmarks for a clearer sort test
        filters: { name: { in: [ 'Eiffel Tower', 'Louvre Museum' ] } }
      });

      // Expect Eiffel Tower to be first, then Louvre
      expect(searchResult.hits.length).toBe(2);
      expect(searchResult.hits[ 0 ].name).toBe('Eiffel Tower');
      expect(searchResult.hits[ 1 ].name).toBe('Louvre Museum');
    }, 20000);

    it('should sort results by _geoPoint descending (farthest first)', async () => {
      const referencePoint = { lat: 48.8580, lng: 2.2900 }; // Very close to Eiffel Tower

      const searchResult = await entityService.search({
        geoSort: {
          point: referencePoint,
          direction: 'desc',
        },
        filters: { name: { in: [ 'Eiffel Tower', 'Louvre Museum' ] } }
      });

      // Expect Louvre to be first (farthest from ref point), then Eiffel Tower
      expect(searchResult.hits.length).toBe(2);
      expect(searchResult.hits[ 0 ].name).toBe('Louvre Museum');
      expect(searchResult.hits[ 1 ].name).toBe('Eiffel Tower');
    }, 20000);
  });
});
