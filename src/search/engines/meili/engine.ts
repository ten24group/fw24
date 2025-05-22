import { DeleteOrCancelTasksQuery, DocumentsQuery, EnqueuedTask, SearchParams, Index, IndexSwap, Key, KeyCreation, MeiliSearch, Config as MeiliSearchClientConfig, Settings as MeiliSearchIndexSettings, RecordAny, Task, TasksOrBatchesQuery, TaskStatus } from "meilisearch";
import { SearchIndexConfig, SearchQuery, SearchResult } from "../../types";
import { BaseSearchEngine } from "../base";
import { QueryBuilder } from "./query-builder";
import { createLogger } from "../../../logging";
import { applyFilters } from "./utils/applyFIlters";
import { buildMeiliSearchQuery } from "./utils/buildSearchQuery";
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

  /**
   * Creates a new index with the provided configuration
   */
  async initIndex(config: SearchIndexConfigExt, synchronous: boolean = false) {
    this.validateConfig(config);
    const idx = config.indexName!;

    // Check if index exists
    try {
      const exists = await this.indexExists(idx);
      if (exists) {
        return this.client.index(idx);
      }
    } catch (err) {
      this.logger.error(`Failed to check if index ${idx} exists: ${err}`);
      this.logger.warn(`Continuing with creation of index ${idx}`);
    }

    // Create the index with primaryKey if specified
    const createOptions: { primaryKey?: string } = {};
    createOptions.primaryKey = config.primaryKey ? config.primaryKey as string : 'id';

    const task = await this.client.createIndex(idx, createOptions);
    if (!task) {
      throw new Error(`Failed to create index ${idx}`);
    }

    // Wait for the task to complete
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }

    // Apply settings if provided
    if (config.settings || config.meiliSearchIndexSettings) {
      const indexSettings = {
        ...config.settings,
        ...config.meiliSearchIndexSettings,
      };
      await this.updateIndexSettings(idx, indexSettings, synchronous);
    }

    const index = this.client.index(idx);

    return index;
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
      this.logger.error(`Failed to check if index ${indexName} exists: ${err}`);
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
    const task = await this.client.deleteIndex(indexName);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    this.indices.delete(indexName);
  }

  /**
   * Update index settings
   */
  async updateIndexSettings(indexName: string, settings: MeiliSearchIndexSettings, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSettings(settings);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Reset index settings to default
   */
  async resetIndexSettings(indexName: string, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.resetSettings();
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
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
    const task = await index.updateFilterableAttributes(attributes);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update sortable attributes for an index
   */
  async updateSortableAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSortableAttributes(attributes);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update searchable attributes for an index
   */
  async updateSearchableAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSearchableAttributes(attributes);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update displayed attributes for an index
   */
  async updateDisplayedAttributes(indexName: string, attributes: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateDisplayedAttributes(attributes);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update synonyms for an index
   */
  async updateSynonyms(indexName: string, synonyms: Record<string, string[]>, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSynonyms(synonyms);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update stop words for an index
   */
  async updateStopWords(indexName: string, stopWords: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateStopWords(stopWords);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update ranking rules for an index
   */
  async updateRankingRules(indexName: string, rankingRules: string[], synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateRankingRules(rankingRules);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Swap two indexes
   */
  async swapIndexes(indexSwaps: IndexSwap[], synchronous: boolean = false) {
    const task = await this.client.swapIndexes(indexSwaps);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Wait for a task to complete
   */
  async waitForTask(taskId: number, timeoutMs: number = this.taskTimeoutMs) {
    const startTime = Date.now();
    let status: TaskStatus | null = null;

    while (!!status && status !== 'succeeded' && status !== 'canceled') {
      // Check for timeout
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
      }

      // Get task status
      try {
        // Use index.getTask to get a single task
        const task = await this.client.tasks.getTask(taskId);
        status = task.status as TaskStatus;

        if (status === 'failed') {
          throw new Error(`Task ${taskId} failed: ${JSON.stringify(task.error)}`);
        }
      } catch (err) {
        console.error(`Error checking task status: ${err}`);
        throw err;
      }

      if (status !== 'succeeded') {
        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
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
    const task = await index.addDocuments(docs);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
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
      const task = await index.addDocuments(batch);
      if (synchronous) {
        await this.waitForTask(task.taskUid);
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
    const task = await index.updateDocuments(docs);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
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
      const task = await index.updateDocuments(batch);
      if (synchronous) {
        await this.waitForTask(task.taskUid);
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
    const task = await index.deleteDocuments(ids);
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Delete all documents in an index
   */
  async deleteAllDocuments(indexName: string, synchronous: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.deleteAllDocuments();
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
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

    const task = await index.deleteDocuments({ filter: options.filter! });

    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(synchronous: boolean = false): Promise<EnqueuedTask> {
    const task = await this.client.createSnapshot();
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Create a dump
   */
  async createDump(synchronous: boolean = false): Promise<EnqueuedTask> {
    const task = await this.client.createDump();
    if (synchronous) {
      await this.waitForTask(task.taskUid);
    }
    return task;
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
  async getStats(): Promise<any> {
    return await this.client.getStats();
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

    const index = await this.getIndex(config);

    // ─── Build + execute ──────────────────────────────────────────────────────
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
      total: results.estimatedTotalHits ?? (results as any).totalHits, // in case of FinitePagination result will have totalHits
      processingTimeMs: results.processingTimeMs,
      query: results.query,
      // Include pagination fields if available
      ...((results as any).page !== undefined && {
        page: (results as any).page,
        hitsPerPage: (results as any).hitsPerPage,
        totalPages: (results as any).totalPages
      })
    };
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

}