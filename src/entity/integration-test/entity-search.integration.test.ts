import { Entity, EntityConfiguration } from "electrodb";

import { BaseEntityService, createEntitySchema, DefaultEntityOperations } from "..";
import { IDIContainer } from "../../interfaces";
import { DIContainer, OnInit } from "../../di";
import { Service } from "../../decorators";
import { EntitySearchService, MeiliSearchEngine } from "../../search";
import { EntitySchemaValidator } from "../entity-schema-validator";


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


// DIContainer.ROOT.register({
//   provide: EntitySearchService,
//   useFactory: (entityService: TestEntityService) => {
//     const searchEngine = DIContainer.ROOT.resolveSearchEngine();
//     return new EntitySearchService(entityService, searchEngine);
//   },
//   deps: [ TestEntityService ],
// });

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
});
