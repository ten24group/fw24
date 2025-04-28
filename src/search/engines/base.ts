import { ISearchEngine, SearchEngineConfig, SearchResult } from '../types';
import { EntityQuery } from '../../entity/query-types';
import { createLogger } from '../../logging';

export abstract class BaseSearchEngine implements ISearchEngine {
  protected readonly logger = createLogger(`BaseSearchEngine:${this.constructor.name}`);

  constructor(protected readonly config: Record<string, any>) { }

  abstract index<T extends Record<string, any>>(documents: T[], config: SearchEngineConfig): Promise<void>;
  abstract search<T>(query: EntityQuery<any>, config: SearchEngineConfig): Promise<SearchResult<T>>;
  abstract delete(ids: string[], indexName: string): Promise<void>;

  protected validateConfig(config: SearchEngineConfig): void {
    if (!config.indexName) {
      throw new Error('Index name is required');
    }
  }

  protected transformSearchQuery(query: EntityQuery<any>): Record<string, any> {
    const { search, filters, pagination, ...rest } = query;

    return {
      query: search,
      filter: filters,
      page: pagination?.pages || 1,
      hitsPerPage: pagination?.count || 20,
      ...rest
    };
  }
} 