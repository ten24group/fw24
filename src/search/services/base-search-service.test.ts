import { BaseSearchService } from './base-search-service';
import { BaseEntityService, EntitySchema, EntityQuery, createEntitySchema, DefaultEntityOperations } from '../../entity';
import { ISearchEngine, SearchIndexConfig, SearchResult } from '../types';
import { ExecutionContext } from '../../core/types/execution-context';
import { APIGatewayEvent, Context } from 'aws-lambda';
import { Request, Response } from '../../interfaces';


// Create a test schema
const testSchema = createEntitySchema({
  model: {
    entity: 'test',
    service: 'test',
    version: '1',
    entityNamePlural: 'Tests',
    entityOperations: DefaultEntityOperations,
    search: {
      enabled: true,
      config: {
        provider: 'meili',
        settings: {
          searchableAttributes: [ 'title', 'description', 'author.name', 'author.email' ]
        }
      },
      documentTransformer: (entity: any) => ({
        ...entity,
        transformed: true
      })
    }
  },
  attributes: {
    id: {
      type: 'number',
      required: true
    },
    title: {
      type: 'string',
    },
    author: {
      type: 'map',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' }
      }
    }
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: [ 'id' ]
      },
      sk: {
        field: 'sk',
        composite: [ 'id' ]
      }
    }
  },
} as const);

type TestSchema = typeof testSchema;

// Create a concrete implementation of BaseSearchService for testing
class TestSearchService extends BaseSearchService {
  async transformDocumentForIndexing(entity: any): Promise<Record<string, any>> {
    return { ...entity };
  }
}

let service: TestSearchService;
let mockEntityService: jest.Mocked<BaseEntityService<TestSchema>>;
let mockSearchEngine: jest.Mocked<ISearchEngine>;
let searchConfig: SearchIndexConfig;
let mockContext: ExecutionContext;

describe('BaseSearchService', () => {
  describe('search', () => {
    beforeEach(() => {
      mockEntityService = {
        hydrateRecords: jest.fn(),
      } as any;

      mockSearchEngine = {
        search: jest.fn(),
        index: jest.fn(),
        delete: jest.fn(),
      } as any;

      searchConfig = {
        provider: 'meili',
        indexName: 'test-index',
        settings: {
          searchableAttributes: [ 'title', 'description', 'author.name', 'author.email' ]
        }
      };

      mockContext = {
        request: {} as Request,
        response: {} as Response,
        event: {} as APIGatewayEvent,
        lambdaContext: {} as Context
      };

      service = new TestSearchService(mockSearchEngine, searchConfig);
    });

    it('should perform basic search without attributes', async () => {
      const query: EntityQuery<TestSchema> = {
        search: 'test query'
      };

      const mockResults: SearchResult<any> = {
        hits: [ { id: 1, title: 'Test Document' } ],
        total: 1
      };

      mockSearchEngine.search.mockResolvedValue(mockResults);

      const result = await service.search(query, searchConfig, mockContext);

      expect(mockSearchEngine.search).toHaveBeenCalledWith(query, searchConfig);
      expect(result).toEqual(mockResults);
      expect(mockEntityService.hydrateRecords).not.toHaveBeenCalled();
    });
  });

  describe('syncToIndex', () => {
    beforeEach(() => {
      mockSearchEngine = {
        search: jest.fn(),
        index: jest.fn(),
        delete: jest.fn(),
      } as any;

      searchConfig = {
        provider: 'meili',
        indexName: 'test-index',
        settings: {
          searchableAttributes: [ 'title', 'description', 'author.name', 'author.email' ]
        }
      };

      service = new TestSearchService(mockSearchEngine, searchConfig);
    });

    it('should index a single document', async () => {
      const entity = { id: 1, title: 'Test Document' } as any;
      const transformedDoc = { id: 1, title: 'Test Document' };

      jest.spyOn(service, 'transformDocumentForIndexing').mockResolvedValue(transformedDoc);

      await service.syncToIndex(entity);

      expect(service.transformDocumentForIndexing).toHaveBeenCalledWith(entity);
      expect(mockSearchEngine.index).toHaveBeenCalledWith([ transformedDoc ], searchConfig);
    });
  });

  describe('bulkSync', () => {
    beforeEach(() => {
      mockSearchEngine = {
        search: jest.fn(),
        index: jest.fn(),
        delete: jest.fn(),
      } as any;

      searchConfig = {
        provider: 'meili',
        indexName: 'test-index',
        settings: {
          searchableAttributes: [ 'title', 'description', 'author.name', 'author.email' ]
        }
      };

      service = new TestSearchService(mockSearchEngine, searchConfig);
    });

    it('should index multiple documents', async () => {
      const entities = [
        { id: 1, title: 'Doc 1' },
        { id: 2, title: 'Doc 2' }
      ] as any[];

      const transformedDocs = [
        { id: 1, title: 'Doc 1' },
        { id: 2, title: 'Doc 2' }
      ];

      jest.spyOn(service, 'transformDocumentForIndexing')
        .mockResolvedValueOnce(transformedDocs[ 0 ])
        .mockResolvedValueOnce(transformedDocs[ 1 ]);

      await service.bulkSync(entities);

      expect(service.transformDocumentForIndexing).toHaveBeenCalledTimes(2);
      expect(mockSearchEngine.index).toHaveBeenCalledWith(transformedDocs, searchConfig);
    });
  });

  describe('deleteFromIndex', () => {
    beforeEach(() => {
      mockSearchEngine = {
        search: jest.fn(),
        index: jest.fn(),
        delete: jest.fn(),
      } as any;

      searchConfig = {
        provider: 'meili',
        indexName: 'test-index',
        settings: {
          searchableAttributes: [ 'title', 'description', 'author.name', 'author.email' ]
        }
      };

      service = new TestSearchService(mockSearchEngine, searchConfig);
    });

    it('should delete a document by id', async () => {
      const entityId = '1';

      await service.deleteFromIndex(entityId);

      expect(mockSearchEngine.delete).toHaveBeenCalledWith([ entityId ], searchConfig.indexName!);
    });
  });
});