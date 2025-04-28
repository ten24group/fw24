import { BaseSearchEngine } from "../engines/base";

import { SearchEngineConfig } from "../types";
import { DefaultSearchService } from "./default";
import { BaseEntityService, createEntitySchema, DefaultEntityOperations, EntitySchema } from '../../entity';
import { ISearchEngine } from '../types';
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

describe('DefaultSearchService', () => {
  let service: DefaultSearchService<TestSchema>;
  let mockEntityService: jest.Mocked<BaseEntityService<TestSchema>>;
  let mockSearchEngine: jest.Mocked<ISearchEngine>;
  let searchConfig: SearchEngineConfig;
  let mockContext: any;

  beforeEach(() => {
    // Setup mocks
    mockEntityService = {
      getEntitySchema: jest.fn().mockReturnValue(testSchema),
      hydrateRecords: jest.fn(),
    } as any;

    mockSearchEngine = {
      search: jest.fn(),
      index: jest.fn(),
      delete: jest.fn(),
    };

    searchConfig = {
      provider: 'meili',
      indexName: 'test-index',
      settings: {
        searchableAttributes: [ 'title', 'description' ],
        filterableAttributes: [ 'category', 'status' ]
      }
    };

    mockContext = {
      event: {} as APIGatewayEvent,
      lambdaContext: {} as Context,
      request: {} as Request,
      response: {} as Response
    };

    service = new DefaultSearchService(mockEntityService, mockSearchEngine, searchConfig);
  });

  describe('transformDocumentForIndexing', () => {
    it('should use schema-defined transformer if available', async () => {
      const entity = { id: 1, title: 'Test Document' };
      const schema = { ...testSchema };

      mockEntityService.getEntitySchema.mockReturnValue(schema);

      const result = await service.transformDocumentForIndexing(entity);

      expect(result).toEqual({
        ...entity,
        transformed: true
      });
    });

    it('should handle searchable relations', async () => {
      const entity = {
        id: 1,
        title: 'Test Document',
        author: {
          name: 'John Doe',
          email: 'john@example.com'
        }
      };

      const schema = { ...testSchema };
      mockEntityService.getEntitySchema.mockReturnValue(schema);

      const result = await service.transformDocumentForIndexing(entity);

      expect(result).toEqual({
        ...entity,
        author: {
          name: 'John Doe',
          email: 'john@example.com'
        },
        transformed: true
      });
    });

    it('should handle missing relations gracefully', async () => {
      const entity = {
        id: 1,
        title: 'Test Document'
      };

      const schema = { ...testSchema };
      mockEntityService.getEntitySchema.mockReturnValue(schema);

      const result = await service.transformDocumentForIndexing(entity);

      expect(result).toEqual({
        ...entity,
        transformed: true
      });
    });

    it('should use default transformation when no schema transformer is defined', async () => {
      const entity = { id: 1, title: 'Test Document' };
      const schema = { ...testSchema };

      // @ts-ignore-next-line
      schema.model.search.documentTransformer = undefined;

      mockEntityService.getEntitySchema.mockReturnValue(schema);

      const result = await service.transformDocumentForIndexing(entity);

      expect(result).toEqual(entity);
    });
  });
});
