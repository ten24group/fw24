import { createLogger } from '../../logging';
import { ISearchEngine, SearchIndexConfig, SearchResult, SearchQuery } from '../types';
import { ExecutionContext } from '../../core/types/execution-context';

export class BaseSearchService {
  protected readonly logger = createLogger(`BaseSearchService:${this.constructor.name}`);

  constructor(
    protected readonly searchEngine: ISearchEngine,
    protected readonly searchIndexConfig?: SearchIndexConfig
  ) { }

  protected getSearchIndexConfig(): SearchIndexConfig {
    if (!this.searchIndexConfig) {
      throw new Error('Search index config not found');
    }
    return this.searchIndexConfig;
  }

  async transformDocumentForIndexing(entity: Record<string, any>): Promise<Record<string, any>> {
    return Promise.resolve(entity);
  }

  async search(
    query: SearchQuery,
    searchIndexConfig = this.getSearchIndexConfig(),
    _ctx?: ExecutionContext): Promise<SearchResult<any>> {
    this.logger.debug('Executing search:', query);

    const results = await this.searchEngine.search(query, searchIndexConfig);

    return results;
  }

  async syncToIndex(entity: Record<string, any>, searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext) {
    const document = await this.transformDocumentForIndexing(entity);
    await this.searchEngine.index([ document ], searchIndexConfig);
  }

  async deleteFromIndex(entityId: string, searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext) {
    await this.searchEngine.delete([ entityId ], searchIndexConfig.indexName!);
  }

  async bulkSync(entities: Record<string, any>[], searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext) {
    const documents = await Promise.all(
      entities.map(entity => this.transformDocumentForIndexing(entity))
    );
    await this.searchEngine.index(documents, searchIndexConfig);
  }
} 