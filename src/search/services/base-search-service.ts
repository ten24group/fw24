import { createLogger } from '../../logging';
import { SearchIndexConfig, SearchResult, SearchQuery, SearchIndexSettings } from '../types';
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

  async initSearchIndex(synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    await this.searchEngine.initIndex(searchIndexConfig, synchronous);
  }

  async syncToIndex(entity: Record<string, any>, searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext, synchronous?: boolean) {
    const document = await this.transformDocumentForIndexing(entity);
    await this.searchEngine.indexDocuments([ document ], searchIndexConfig, synchronous);
  }

  async deleteFromIndex(entityId: string, searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext, synchronous?: boolean) {
    await this.searchEngine.deleteDocuments([ entityId ], searchIndexConfig.indexName!, synchronous);
  }

  async bulkSync(entities: Record<string, any>[], searchIndexConfig = this.getSearchIndexConfig(), _ctx?: ExecutionContext, synchronous?: boolean) {
    const documents = await Promise.all(
      entities.map(entity => this.transformDocumentForIndexing(entity))
    );
    await this.searchEngine.indexDocuments(documents, searchIndexConfig, synchronous);
  }

  // Index management
  async deleteSearchIndex(synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.deleteIndex(searchIndexConfig.indexName!, synchronous);
  }
  async indexExists() {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.indexExists(searchIndexConfig.indexName!);
  }

  // --- Index Management ---
  async getIndexInfo() {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.getIndexInfo(searchIndexConfig.indexName!);
  }
  async getIndexStats() {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.getIndexStats(searchIndexConfig.indexName!);
  }
  async listIndices() {
    return this.searchEngine.listIndices();
  }
  async updateIndexSettings(settings: SearchIndexSettings, synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.updateIndexSettings(searchIndexConfig.indexName!, settings, synchronous);
  }
  async resetIndexSettings(synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.resetIndexSettings(searchIndexConfig.indexName!, synchronous);
  }
  async getIndexSettings() {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.getIndexSettings(searchIndexConfig.indexName!);
  }

  // --- Document Management ---
  async updateDocuments(docs: any[], synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.updateDocuments(docs, searchIndexConfig, synchronous);
  }
  async getDocument(id: string) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.getDocument(id, searchIndexConfig.indexName!);
  }
  async getDocuments(options?: any) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.getDocuments(searchIndexConfig.indexName!, options);
  }
  async deleteAllDocuments(synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.deleteAllDocuments(searchIndexConfig.indexName!, synchronous);
  }
  async deleteDocumentsByFilter(filter: SearchQuery[ 'filters' ], synchronous?: boolean) {
    const searchIndexConfig = this.getSearchIndexConfig();
    return this.searchEngine.deleteDocumentsByFilter(filter, searchIndexConfig.indexName!, synchronous);
  }

  // --- Engine/Server Info ---
  async health() {
    return this.searchEngine.health();
  }
  async isHealthy() {
    return this.searchEngine.isHealthy();
  }
  async getStats() {
    return this.searchEngine.getStats();
  }
  async getVersion() {
    return this.searchEngine.getVersion();
  }
  async multiSearch(queries: any[]) {
    return this.searchEngine.multiSearch(queries);
  }
} 