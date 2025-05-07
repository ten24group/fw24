import { BaseSearchEngine } from "./base";
import { SearchIndexConfig } from "../types";
import { EntityQuery } from "../../entity/query-types";
import { EntitySchema } from "../../entity";

// Create a concrete implementation of BaseSearchEngine for testing
class TestSearchEngine extends BaseSearchEngine {
  async index<T extends Record<string, any>>(_documents: T[], config: SearchIndexConfig): Promise<void> {
    this.validateConfig(config);
  }

  async search<T extends EntitySchema<any, any, any>>(query: EntityQuery<T>, config: SearchIndexConfig): Promise<any> {
    this.validateConfig(config);
    return { ...query };
  }

  async delete(_ids: string[]): Promise<void> {
    // Implementation not needed for tests
  }

  async initIndex(_config: SearchIndexConfig): Promise<any> {
    // Implementation not needed for tests
  }
}

describe('BaseSearchEngine', () => {
  let engine: TestSearchEngine;
  let config: SearchIndexConfig;

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
});
