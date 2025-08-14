import { DeleteOrCancelTasksQuery, type DocumentsQuery, type EnqueuedTask, type Index, type IndexSwap, KeyCreation, KeyUpdate, MeiliSearch, type Config as MeiliSearchClientConfig, type Settings as MeiliSearchIndexSettings, type RecordAny, TasksOrBatchesQuery, type TaskStatus } from "meilisearch";
import { type SearchIndexConfig, type SearchQuery, type SearchResult } from "../../types";
import { BaseSearchEngine } from "../base";
import { QueryBuilder } from "./query-builder";
import { applyFilters } from "./utils/applyFIlters";
import { buildMeiliSearchQuery } from "./utils/buildSearchQuery";
import { SearchEngineConnectionError, SearchEngineError, SearchIndexError, SearchQueryError } from "../../errors";

export interface ExtendedMeiliSearchClientConfig extends MeiliSearchClientConfig {
}

export interface SearchIndexConfigExt extends SearchIndexConfig {
  meiliSearchIndexSettings?: MeiliSearchIndexSettings
}

export class MeiliSearchEngine extends BaseSearchEngine {
  private client: MeiliSearch;
  private indices = new Map<string, Index>();
  private taskTimeoutMs = 30000; // Default timeout for tasks: 30s

  constructor(config: ExtendedMeiliSearchClientConfig) {
    super(config);
    this.client = new MeiliSearch(config);
  }

  public getClient(): MeiliSearch {
    return this.client;
  }

  /**
   * Creates a new index with the provided configuration or ensures existing index has correct settings
   */
  async initIndex(config: SearchIndexConfigExt, synchronous: boolean = false) {
    try {
      this.validateConfig(config);
      const idx = config.indexName!;

      // Check if index exists
      let indexExists = false;
      try {
        indexExists = await this.indexExists(idx);
      } catch (error: any) {
        throw new SearchIndexError(`Failed to check index existence: ${idx}`, { error });
      }

      // If index doesn't exist, create it
      if (!indexExists) {

        const createOptions: { primaryKey?: string } = {};
        createOptions.primaryKey = config.primaryKey ? config.primaryKey as string : 'id';

        const promise = this.client.createIndex(idx, createOptions);

        if (!promise) {
          throw new SearchIndexError(`Failed to create index ${idx}`);
        }
        // Wait for the creation task to complete (required before we can update settings)
        const task = await promise.waitTask();
      }

      // Ensure settings are correctly applied for both new and existing indices
      return await this.ensureIndexSettings(config, synchronous);

    } catch (error: any) {

      if (error instanceof SearchIndexError) {
        throw error;
      }

      throw new SearchEngineError(`Failed to initialize index: ${error.message}`, { error });
    }
  }

  /**
   * Ensures index settings are correct with the provided config and updates if needed
   */
  async ensureIndexSettings(config: SearchIndexConfigExt, synchronous: boolean = false) {
    try {
      this.validateConfig(config);
      const idx = config.indexName!;

      // Get the index instance
      const index = this.client.index(idx);

      // Prepare new settings from config
      const newSettings = {
        ...config.settings,
        ...config.meiliSearchIndexSettings,
      };

      // Only update if we have settings to apply
      if (newSettings && Object.keys(newSettings).length > 0) {
        this.logger.debug(`Updating index settings for ${idx}`);
        await this.updateIndexSettings(idx, newSettings, synchronous);
      }

      return index;
    } catch (error: any) {
      throw new SearchEngineError(`Failed to ensure index settings: ${error.message}`, { error });
    }
  }

  async setExperimentalFeaturesStatus(features: {
    metrics: boolean,
    logsRoute: boolean,
    containsFilter: boolean,
    editDocumentsByFunction: boolean,
    network: boolean
  }) {
    // PATCH /experimental-features
    const response = await this.client.httpRequest.patch({
      path: `/experimental-features`,
      body: {
        ...features
      }
    });

    return response;
  }

  async getExperimentalFeatures() {
    return this.client.getExperimentalFeatures();
  }

  /**
   * Gets or creates an index instance for the given config
   */
  private async getIndex(config: SearchIndexConfigExt): Promise<Index> {
    this.validateConfig(config);
    const idx = config.indexName!;
    if (!this.indices.has(idx)) {
      const index = await this.initIndex(config, true);
      this.indices.set(idx, index);
    }
    return this.indices.get(idx)!;
  }

  /**
   * Check if an index exists
   */
  async indexExists(indexName: string): Promise<boolean> {
    try {
      await this.client.getIndex(indexName);
      return true;
    } catch (err) {
      // this.logger.error(`Failed to check if index ${indexName} exists: ${err}`);
      return false;
    }
  }

  /**
   * Get information about an index
   */
  async getIndexInfo(indexName: string) {
    try {
      return await this.client.getIndex(indexName);
    } catch (err) {
      throw new Error(`Failed to get index info: ${err}`);
    }
  }

  /**
   * Get index stats
   */
  async getIndexStats(indexName: string) {
    const index = await this.getIndex({ indexName });
    return await index.getStats();
  }

  /**
   * List all available indices
   */
  async listIndices() {
    return await this.client.getIndexes();
  }

  /**
   * Delete an index
   */
  async deleteIndex(indexName: string, synchronous: boolean = false) {
    const promise = this.client.deleteIndex(indexName);
    if (synchronous) {
      return await promise.waitTask();
    }
    this.indices.delete(indexName);
    return await promise;
  }

  /**
   * Update index settings
   */
  async updateIndexSettings(indexName: string, settings: MeiliSearchIndexSettings, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateSettings(settings);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Reset index settings to default
   */
  async resetIndexSettings(indexName: string, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.resetSettings();
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Get index settings
   */
  async getIndexSettings(indexName: string): Promise<MeiliSearchIndexSettings> {
    const index = await this.getIndex({ indexName });
    return await index.getSettings();
  }

  /**
   * Update filterable attributes for an index
   */
  async updateFilterableAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateFilterableAttributes(attributes);
    if (synchronous) {
      return await promise.waitTask();
    }

    return await promise;
  }

  /**
   * Update sortable attributes for an index
   */
  async updateSortableAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateSortableAttributes(attributes);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Update searchable attributes for an index
   */
  async updateSearchableAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateSearchableAttributes(attributes);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Update displayed attributes for an index
   */
  async updateDisplayedAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateDisplayedAttributes(attributes);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Update synonyms for an index
   */
  async updateSynonyms(indexName: string, synonyms: Record<string, string[]>, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateSynonyms(synonyms);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Update stop words for an index
   */
  async updateStopWords(indexName: string, stopWords: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateStopWords(stopWords);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Update ranking rules for an index
   */
  async updateRankingRules(indexName: string, rankingRules: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.updateRankingRules(rankingRules);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Swap two indexes
   */
  async swapIndexes(indexSwaps: IndexSwap[], synchronous: boolean = false) {
    const promise = this.client.swapIndexes(indexSwaps);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Add or replace documents in an index
   */
  async indexDocuments<T extends Record<string, any>>(
    docs: T[],
    config: SearchIndexConfig,
    synchronous: boolean = false
  ) {
    const index = await this.getIndex(config);
    const promise = index.addDocuments(docs);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Add documents in batches
   */
  async indexInBatches<T extends Record<string, any>>(
    docs: T[],
    config: SearchIndexConfig,
    batchSize: number = 1000,
    synchronous: boolean = false
  ) {
    const index = await this.getIndex(config);

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const promise = index.addDocuments(batch);
      if (synchronous) {
        await promise.waitTask();
      } else {
        await promise;
      }
    }
  }

  /**
   * Update existing documents (partial update that preserves existing fields)
   */
  async updateDocuments<T extends Record<string, any>>(
    docs: T[],
    config: SearchIndexConfig,
    synchronous: boolean = false
  ) {
    const index = await this.getIndex(config);
    const promise = index.updateDocuments(docs);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Update documents in batches
   */
  async updateDocumentsInBatches<T extends Record<string, any>>(
    docs: T[],
    config: SearchIndexConfig,
    batchSize: number = 1000,
    synchronous: boolean = false
  ) {
    const index = await this.getIndex(config);

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const promise = index.updateDocuments(batch);
      if (synchronous) {
        await promise.waitTask();
      } else {
        await promise;
      }
    }
  }

  /**
   * Get a document by ID
   */
  async getDocument<T extends RecordAny>(id: string, indexName: string): Promise<T> {
    const index = await this.getIndex({ indexName });
    return await index.getDocument<T>(id);
  }

  /**
   * Get documents with filtering options
   */
  async getDocuments<T extends RecordAny>(indexName: string, options?: DocumentsQuery<T>): Promise<T[]> {
    const index = await this.getIndex({ indexName });
    const result = await index.getDocuments<T>(options);
    return result.results;
  }

  /**
   * Delete documents by ID
   */
  async deleteDocuments(ids: string[], indexName: string, synchronous: boolean = false) {
    if (!indexName) {
      throw new Error("Index name is required for delete operation");
    }
    const index = await this.getIndex({ indexName });
    const promise = index.deleteDocuments(ids);
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Delete all documents in an index
   */
  async deleteAllDocuments(indexName: string, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const promise = index.deleteAllDocuments();
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Delete documents by filter
   */
  async deleteDocumentsByFilter(filter: SearchQuery[ 'filters' ], indexName: string, synchronous: boolean = false) {
    if (!indexName) {
      throw new Error("Index name is required for deleteByFilter operation");
    }

    const index = await this.getIndex({ indexName });

    const builder = QueryBuilder.create<any>();
    applyFilters(builder, filter);
    const { options } = builder.build();

    const promise = index.deleteDocuments({ filter: options.filter! });

    if (synchronous) {
      return await promise.waitTask();
    }

    return await promise;
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(synchronous: boolean = false) {
    try {
      this.logger.info('Creating snapshot...', { synchronous });
      
      const promise = this.client.createSnapshot();
      
      if (synchronous) {
        this.logger.info('Waiting for snapshot task to complete...');
        const result = await promise.waitTask();
        this.logger.info('Snapshot created successfully', { result });
        return result;
      }
      
      const result = await promise;
      this.logger.info('Snapshot creation task started', { result });
      return result;
    } catch (error: any) {
      this.logger.error('Failed to create snapshot', { error: error.message, stack: error.stack });
      throw new SearchEngineError(`Failed to create snapshot: ${error.message}`, { error });
    }
  }

  /**
   * Create a dump
   */
  async createDump(synchronous: boolean = false) {
    const promise = this.client.createDump();
    if (synchronous) {
      return await promise.waitTask();
    }
    return await promise;
  }

  /**
   * Check server health
   */
  async health<T extends any>(): Promise<T> {
    return await this.client.health() as T;
  }

  /**
   * Check if server is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.health();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get server stats
   */
  async getStats<T extends any = any>(): Promise<T> {
    return await this.client.getStats() as T;
  }

  /**
   * Get server version
   */
  async getVersion(): Promise<any> {
    return await this.client.getVersion();
  }

  /**
   * Search an index with advanced options
   */
  async search<T>(
    query: SearchQuery,
    config: SearchIndexConfig,
  ): Promise<SearchResult<T>> {
    try {
      const index = await this.getIndex(config);
      const meiliSearchQuery = buildMeiliSearchQuery(query);
      const { q: qParam, options } = meiliSearchQuery;

      const results = await index.search(qParam ?? "", {
        ...options
      });

      return {
        ...results,
        hits: results.hits as T[],
        facets: results.facetDistribution,
        facetStats: results.facetStats,
        total: results.estimatedTotalHits ?? (results as any).totalHits,
        processingTimeMs: results.processingTimeMs,
        query: results.query,
        ...((results as any).page !== undefined && {
          page: (results as any).page,
          hitsPerPage: (results as any).hitsPerPage,
          totalPages: (results as any).totalPages
        })
      };
    } catch (error: any) {
      if (error instanceof SearchQueryError) {
        throw error;
      }
      throw new SearchEngineError(`Search operation failed: ${error.message}`, { error });
    }
  }

  /**
   * Perform a multi-search query
   */
  async multiSearch<T extends any>(queries: Array<{
    indexUid: string;
    query: string;
    searchParams?: Record<string, any>;
  }>) {

    // Map the input queries to the format expected by the MeiliSearch client
    const meiliQueries = queries.map(q => ({
      indexUid: q.indexUid,
      q: q.query, // MeiliSearch client expects 'q' instead of 'query'
      ...q.searchParams, // Spread any additional search parameters
    }));

    return await this.client.multiSearch({ queries: meiliQueries }) as T;
  }

  /**
   * Get API keys
   */
  async getKeys() {
    return this.client.getKeys();
  }

  /**
   * Get an API key
   */
  async getKey(keyOrUid: string) {
    return this.client.getKey(keyOrUid);
  }

  /**
   * Create an API key
   */
  async createKey(options: KeyCreation) {
    return this.client.createKey(options);
  }

  /**
   * Update an API key
   */
  async updateKey(keyOrUid: string, options: KeyUpdate) {
    return this.client.updateKey(keyOrUid, options);
  }

  /**
   * Delete an API key
   */
  async deleteKey(keyOrUid: string) {
    return this.client.deleteKey(keyOrUid);
  }

  /**
   * Cancel tasks
   */
  async cancelTasks(query: DeleteOrCancelTasksQuery) {
    const promise = this.client.tasks.cancelTasks(query);
    return await promise.waitTask();
  }

  /**
   * Delete tasks
   */
  async deleteTasks(query: DeleteOrCancelTasksQuery) {
    const promise = this.client.tasks.deleteTasks(query);
    return await promise.waitTask();
  }

  /**
   * Wait for a task to complete
   */
  async waitForTask(taskId: number, timeoutMs: number = this.taskTimeoutMs) {
    return this.client.tasks.waitForTask(taskId, {
      timeout: timeoutMs,
      interval: 100,
    });
  }

  /**
   * Get batches
   */
  async getBatches(params?: TasksOrBatchesQuery) {
    return this.client.batches.getBatches(params);
  }

  /**
   * Get a specific batch
   */
  async getBatch(batchUid: number) {
    return this.client.batches.getBatch(batchUid);
  }

  protected validateConfig(config: SearchIndexConfig): void {
    if (!config.indexName) {
      throw new SearchQueryError('Index name is required');
    }
  }
}