import { SearchIndexConfig, SearchResult, SearchQuery } from '../types';
import { createLogger } from '../../logging';

export abstract class BaseSearchEngine {
  protected readonly logger = createLogger(`BaseSearchEngine:${this.constructor.name}`);

  constructor(protected readonly config: Record<string, any>) { }

  abstract initIndex(config: SearchIndexConfig): Promise<any>;

  abstract index<T extends Record<string, any>>(documents: T[], config: SearchIndexConfig): Promise<void>;
  abstract search<T>(query: SearchQuery, config: SearchIndexConfig): Promise<SearchResult<T>>;
  abstract delete(ids: string[], indexName: string): Promise<void>;

  protected validateConfig(config: SearchIndexConfig): void {
    if (!config.indexName) {
      throw new Error('Index name is required');
    }
  }
} 