import { BaseSearchEngine } from "./base";
import { SearchEngineConfig } from "../types";
import { EntityQuery } from "../../entity/query-types";
import { EntitySchema } from "../../entity";

// Create a concrete implementation of BaseSearchEngine for testing
class TestSearchEngine extends BaseSearchEngine {
  async index<T extends Record<string, any>>(_documents: T[], config: SearchEngineConfig): Promise<void> {
    this.validateConfig(config);
  }

  async search<T extends EntitySchema<any, any, any>>(query: EntityQuery<T>, config: SearchEngineConfig): Promise<any> {
    this.validateConfig(config);
    return this.transformSearchQuery(query);
  }

  async delete(_ids: string[]): Promise<void> {
    // Implementation not needed for tests
  }
}

describe('BaseSearchEngine', () => {
  let engine: TestSearchEngine;
  let config: SearchEngineConfig;

  beforeEach(() => {
    engine = new TestSearchEngine({});
    config = {
      provider: 'meili',
      indexName: 'test-index',
      settings: {
        searchableAttributes: [ 'title', 'description' ],
        filterableAttributes: [ 'category', 'status' ]
      }
    };
  });

  describe('validateConfig', () => {
    it('should throw error when indexName is missing', async () => {
      const invalidConfig = { ...config, indexName: undefined };
      await expect(engine.index([], invalidConfig)).rejects.toThrow('Index name is required');
    });

    it('should not throw error when indexName is provided', async () => {
      await expect(engine.index([], config)).resolves.not.toThrow();
    });
  });

  describe('transformSearchQuery', () => {
    it('should transform basic search query correctly', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        filters: { category: 'books' },
        pagination: {
          pages: 2,
          count: 10
        }
      };

      const result = await engine.search(query, config);
      expect(result).toEqual({
        query: 'test query',
        filter: { category: 'books' },
        page: 2,
        hitsPerPage: 10
      });
    });

    it('should handle query without pagination', async () => {
      const query: EntityQuery<any> = {
        search: 'test query',
        filters: { category: 'books' }
      };

      const result = await engine.search(query, config);
      expect(result).toEqual({
        query: 'test query',
        filter: { category: 'books' },
        page: 1,
        hitsPerPage: 20
      });
    });

    it('should handle query with only search term', async () => {
      const query: EntityQuery<any> = {
        search: 'test query'
      };

      const result = await engine.search(query, config);
      expect(result).toEqual({
        query: 'test query',
        page: 1,
        hitsPerPage: 20
      });
    });
  });
});
