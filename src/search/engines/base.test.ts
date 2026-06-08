import { BaseSearchEngine } from "./base";
import { SearchIndexConfig, SearchQuery } from "../types";
import { EntityQuery } from "../../entity/query-types";
import { EntitySchema } from "../../entity";

// Create a concrete implementation of BaseSearchEngine for testing
class TestSearchEngine extends BaseSearchEngine {
  indexExists(_indexName: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  deleteIndex(_indexName: string, _synchronous?: boolean): Promise<any> {
    throw new Error("Method not implemented.");
  }
  getIndexInfo(_indexName: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  getIndexStats(_indexName: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  listIndices(): Promise<any> {
    throw new Error("Method not implemented.");
  }
  updateIndexSettings(_indexName: string, _settings: any, _synchronous?: boolean): Promise<any> {
    throw new Error("Method not implemented.");
  }
  resetIndexSettings(_indexName: string, _synchronous?: boolean): Promise<any> {
    throw new Error("Method not implemented.");
  }
  getIndexSettings(_indexName: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  updateDocuments<T extends Record<string, any> = Record<string, any>>(_docs: T[], _config: SearchIndexConfig, _synchronous?: boolean): Promise<any> {
    throw new Error("Method not implemented.");
  }
  getDocument<T extends Record<string, any> = Record<string, any>>(_id: string, _indexName: string): Promise<T> {
    throw new Error("Method not implemented.");
  }
  getDocuments<T extends Record<string, any> = Record<string, any>>(_indexName: string, _options?: any): Promise<T[]> {
    throw new Error("Method not implemented.");
  }
  deleteAllDocuments(_indexName: string, _synchronous?: boolean): Promise<any> {
    throw new Error("Method not implemented.");
  }
  deleteDocumentsByFilter(_filter: SearchQuery[ "filters" ], _indexName: string, _synchronous?: boolean): Promise<any> {
    throw new Error("Method not implemented.");
  }
  health<T = any>(): Promise<T> {
    throw new Error("Method not implemented.");
  }
  isHealthy(): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  getStats<T = any>(): Promise<T> {
    throw new Error("Method not implemented.");
  }
  getVersion<T = any>(): Promise<T> {
    throw new Error("Method not implemented.");
  }
  multiSearch<T = any>(_queries: any[]): Promise<T> {
    throw new Error("Method not implemented.");
  }
  async indexDocuments<T extends Record<string, any>>(_documents: T[], config: SearchIndexConfig): Promise<void> {
    this.validateConfig(config);
  }

  async search<T extends EntitySchema<any, any, any>>(query: EntityQuery<T>, config: SearchIndexConfig): Promise<any> {
    this.validateConfig(config);
    return { ...query };
  }

  async deleteDocuments(_ids: string[], _indexName: string): Promise<void> {
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
      await expect(engine.indexDocuments([], invalidConfig)).rejects.toThrow('Index name is required');
    });

    it('should not throw error when indexName is provided', async () => {
      await expect(engine.indexDocuments([], config)).resolves.not.toThrow();
    });
  });
});
