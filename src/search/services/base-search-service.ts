import { createLogger } from '../../logging';
import { SearchIndexConfig, SearchResult, SearchQuery } from '../types';
import { ExecutionContext } from '../../core/types/execution-context';
import { BaseSearchEngine } from '../engines/base';


export class BaseSearchService {
  protected readonly logger = createLogger(`BaseSearchService:${this.constructor.name}`);

  constructor(
    protected readonly searchEngine: BaseSearchEngine,
    protected readonly searchIndexConfig?: SearchIndexConfig
  ) { }

  public getEngine() {
    return this.searchEngine;
  }

  protected getSearchIndexConfig(): SearchIndexConfig {
    if (!this.searchIndexConfig) {
      throw new Error('Search index config not found');
    }
    return this.searchIndexConfig;
  }

  async transformDocumentForIndexing(entity: Record<string, any>): Promise<Record<string, any>> {
    // Default transformation
    const document: Record<string, any> = { ...entity };
    return Promise.resolve(document);
  }

  async search(
    query: SearchQuery,
    searchIndexConfig = this.getSearchIndexConfig(),
    _ctx?: ExecutionContext
  ): Promise<SearchResult<any>> {
    this.logger.debug('Executing search:', query);

    const results = await this.searchEngine.search(query, searchIndexConfig);

    return results;
  }

  async initSearchIndex() {
    const searchIndexConfig = this.getSearchIndexConfig();
    await this.searchEngine.initIndex(searchIndexConfig);
  }

  async syncToIndex(entity: Record<string, any>, searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext) {
    const document = await this.transformDocumentForIndexing(entity);
    await this.searchEngine.indexDocuments([ document ], searchIndexConfig);
  }

  async deleteFromIndex(entityId: string, searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext) {
    await this.searchEngine.deleteDocuments([ entityId ], searchIndexConfig.indexName!);
  }

  async bulkSync(entities: Record<string, any>[], searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext) {
    const documents = await Promise.all(
      entities.map(entity => this.transformDocumentForIndexing(entity))
    );
    await this.searchEngine.indexDocuments(documents, searchIndexConfig);
  }
} 