import { DeleteOrCancelTasksQuery, DocumentsQuery, EnqueuedTask, Index, IndexSwap, Key, KeyCreation, MeiliSearch, Config as MeiliSearchClientConfig, Settings as MeiliSearchIndexSettings, RecordAny, Task, TasksOrBatchesQuery, TaskStatus } from "meilisearch";
import { SearchIndexConfig, SearchOptions, SearchQuery, SearchResult } from "../../types";
import { BaseSearchEngine } from "../base";
import { QueryBuilder } from "./query-builder";

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
  async initIndex(config: SearchIndexConfigExt, waitForTask: boolean = false) {
    this.validateConfig(config);
    const idx = config.indexName!;

    // Check if index exists
    try {
      const exists = await this.indexExists(idx);
      if (exists) {
        return this.client.index(idx);
      }
    } catch (err) {
      // Continue with creation
    }

    // Create the index with primaryKey if specified
    const createOptions: { primaryKey?: string } = {};
    createOptions.primaryKey = config.primaryKey ? config.primaryKey as string : 'id';

    const task = await this.client.createIndex(idx, createOptions);
    if (!task) {
      throw new Error(`Failed to create index ${idx}`);
    }

    // Wait for the task to complete
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }

    // Apply settings if provided
    if (config.settings || config.meiliSearchIndexSettings) {
      const indexSettings = {
        ...config.settings,
        ...config.meiliSearchIndexSettings,
      };
      await this.updateIndexSettings(idx, indexSettings);
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
  async deleteIndex(indexName: string, waitForTask: boolean = false) {
    const task = await this.client.deleteIndex(indexName);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
    this.indices.delete(indexName);
  }

  /**
   * Update index settings
   */
  async updateIndexSettings(indexName: string, settings: MeiliSearchIndexSettings, waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSettings(settings);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Reset index settings to default
   */
  async resetIndexSettings(indexName: string, waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.resetSettings();
    if (waitForTask) {
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
  async updateFilterableAttributes(indexName: string, attributes: string[], waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateFilterableAttributes(attributes);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update sortable attributes for an index
   */
  async updateSortableAttributes(indexName: string, attributes: string[], waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSortableAttributes(attributes);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update searchable attributes for an index
   */
  async updateSearchableAttributes(indexName: string, attributes: string[], waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSearchableAttributes(attributes);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update displayed attributes for an index
   */
  async updateDisplayedAttributes(indexName: string, attributes: string[], waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateDisplayedAttributes(attributes);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update synonyms for an index
   */
  async updateSynonyms(indexName: string, synonyms: Record<string, string[]>, waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateSynonyms(synonyms);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update stop words for an index
   */
  async updateStopWords(indexName: string, stopWords: string[], waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateStopWords(stopWords);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Update ranking rules for an index
   */
  async updateRankingRules(indexName: string, rankingRules: string[], waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.updateRankingRules(rankingRules);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
  }

  /**
   * Swap two indexes
   */
  async swapIndexes(indexSwaps: IndexSwap[], waitForTask: boolean = false) {
    const task = await this.client.swapIndexes(indexSwaps);
    if (waitForTask) {
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
   * Get tasks with filtering options (using client interface)
   */
  async getTasks(params?: TasksOrBatchesQuery) {
    return await this.client.tasks.getTasks(params);
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: number): Promise<Task> {
    return await this.client.tasks.getTask(taskId);
  }

  /**
   * Cancel tasks based on filter criteria
   */
  async cancelTasks(params: DeleteOrCancelTasksQuery): Promise<EnqueuedTask> {
    return await this.client.tasks.cancelTasks(params);
  }

  /**
   * Delete tasks based on filter criteria
   */
  async deleteTasks(params: DeleteOrCancelTasksQuery): Promise<EnqueuedTask> {
    return await this.client.tasks.deleteTasks(params);
  }

  /**
   * Add or replace documents in an index
   */
  async indexDocuments<T extends Record<string, any>>(
    docs: T[],
    config: SearchIndexConfig,
    waitForTask: boolean = false
  ) {
    const index = await this.getIndex(config);
    const task = await index.addDocuments(docs);
    if (waitForTask) {
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
    waitForTask: boolean = false
  ) {
    const index = await this.getIndex(config);

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const task = await index.addDocuments(batch);
      if (waitForTask) {
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
    waitForTask: boolean = false
  ) {
    const index = await this.getIndex(config);
    const task = await index.updateDocuments(docs);
    if (waitForTask) {
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
    waitForTask: boolean = false
  ) {
    const index = await this.getIndex(config);

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      const task = await index.updateDocuments(batch);
      if (waitForTask) {
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
  async deleteDocuments(ids: string[], indexName: string, waitForTask: boolean = false) {
    if (!indexName) {
      throw new Error("Index name is required for delete operation");
    }
    const index = await this.getIndex({ indexName });
    const task = await index.deleteDocuments(ids);
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Delete all documents in an index
   */
  async deleteAllDocuments(indexName: string, waitForTask: boolean = false) {
    const index = await this.getIndex({ indexName });
    const task = await index.deleteAllDocuments();
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Delete documents by filter
   */
  async deleteDocumentsByFilter(filter: string, indexName: string, waitForTask: boolean = false) {
    if (!indexName) {
      throw new Error("Index name is required for deleteByFilter operation");
    }
    const index = await this.getIndex({ indexName });
    const task = await index.deleteDocuments({ filter });
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(waitForTask: boolean = false): Promise<EnqueuedTask> {
    const task = await this.client.createSnapshot();
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Create a dump
   */
  async createDump(waitForTask: boolean = false): Promise<EnqueuedTask> {
    const task = await this.client.createDump();
    if (waitForTask) {
      await this.waitForTask(task.taskUid);
    }
    return task;
  }

  /**
   * Get keys
   */
  async getKeys() {
    return await this.client.getKeys();
  }

  /**
   * Get a key by ID
   */
  async getKey(keyId: string): Promise<Key> {
    return await this.client.getKey(keyId);
  }

  /**
   * Create a key
   */
  async createKey(keyCreation: KeyCreation): Promise<Key> {
    return await this.client.createKey(keyCreation);
  }

  /**
   * Update a key
   */
  async updateKey(keyId: string, keyUpdate: Partial<KeyCreation>): Promise<Key> {
    return await this.client.updateKey(keyId, keyUpdate);
  }

  /**
   * Delete a key
   */
  async deleteKey(keyId: string) {
    return await this.client.deleteKey(keyId);
  }

  /**
   * Check server health
   */
  async health() {
    return await this.client.health();
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
    const builder = QueryBuilder.create<T>();

    // ─── Full-text search ───────────────────────────────────────────────────────
    const phrase = Array.isArray(query.search)
      ? query.search.join(" ")
      : query.search ?? "";
    builder.text(phrase);

    // ─── Filters ────────────────────────────────────────────────────────────────
    if (query.filters) {
      this.applyFilters(builder, query.filters);
    }

    // ─── Post Filters ────────────────────────────────────────────────────────────────
    if (query.postFilters) {
      // Apply post filters (filtering after aggregations)
      builder.withPostFilter(sub => {
        this.applyFilters(sub, query.postFilters);
      });
    }

    // ─── Sorting ───────────────────────────────────────────────────────────────
    if (query.sort) {
      for (const { field, dir } of query.sort) {
        builder.sort(field, dir);
      }
    }

    // ─── Pagination ────────────────────────────────────────────────────────────
    if (query.pagination?.usePagination) {
      // Use page/hitsPerPage pagination for exhaustive results
      const pageSize = query.pagination?.limit ?? 20;
      const pageNum = Number(query.pagination?.page ?? 1);
      builder.hitsPerPage(pageSize).page(pageNum);
    } else {
      // Use limit/offset pagination (default, faster)
      const pageSize = query.pagination?.limit ?? 20;
      const pageNum = Number(query.pagination?.page ?? 1);
      const offset = (pageNum - 1) * pageSize;
      builder.limit(pageSize).offset(offset);
    }

    // ─── Distinct ──────────────────────────────────────────────────────────────
    if (query.distinctAttribute) {
      builder.distinct(query.distinctAttribute);
    }

    // ─── Field selection ──────────────────────────────────────────────────────
    if (query.select) {
      builder.select(query.select);
    }

    // ─── Attributes to search on ───────────────────────────────────────────────
    if (query.searchAttributes) {
      builder.attributesToSearchOn(query.searchAttributes);
    }

    // ─── Highlighting ─────────────────────────────────────────────────────────
    if (query.highlight) {
      const { fields, preTag, postTag, showMatchesPosition } = query.highlight;
      builder.highlight(fields, preTag, postTag);
      if (showMatchesPosition) builder.showMatchesPosition();
    }

    // ─── Cropping ──────────────────────────────────────────────────────────────
    if (query.crop) {
      const { fields, length, marker } = query.crop;
      builder.crop(fields, length, marker);
    }

    // ─── Faceting ──────────────────────────────────────────────────────────────
    if (query.facetFilters) {
      builder.facetFilters(query.facetFilters);
    }

    let returnFacets: string[] = []

    if (query.returnFacets) {
      returnFacets = query.returnFacets;
    } else if (config.faceting?.facets) {
      returnFacets = Object.keys(config.faceting.facets);
    }

    if (returnFacets.length > 0) {
      builder.facets(returnFacets);
    }

    // ─── Matching strategy ────────────────────────────────────────────────────
    if (query.matchingStrategy) {
      builder.matchingStrategy(query.matchingStrategy);
    }

    // ─── Geo-search ───────────────────────────────────────────────────────────
    if (query.geo) {
      const { lat, lng, radius, precision } = query.geo;
      builder.around(lat, lng, radius, precision);
    }

    // ─── Ranking Score ─────────────────────────────────────────────────────────
    if (query.showRankingScore) {
      builder.showRankingScore(true);
    }

    if (query.showRankingScoreDetails) {
      builder.showRankingScoreDetails(true);
    }

    if (query.rankingScoreThreshold !== undefined) {
      builder.rankingScoreThreshold(query.rankingScoreThreshold);
    }

    // ─── Hybrid & Vector Search ───────────────────────────────────────────────
    if (query.hybrid) {
      const { embedder, semanticRatio } = query.hybrid;
      builder.hybrid(embedder, semanticRatio);
    }

    if (query.vector) {
      builder.vectorSearch(query.vector);

      if (query.retrieveVectors) {
        builder.retrieveVectors(true);
      }
    }

    // ─── Locales ────────────────────────────────────────────────────────────
    if (query.locales && query.locales.length > 0) {
      builder.locales(query.locales);
    }

    // ─── Any custom raw options ───────────────────────────────────────────────
    if (query.rawOptions) {
      for (const [ key, val ] of Object.entries(query.rawOptions)) {
        builder.rawOption(key, val);
      }
    }

    // ─── Build + execute ──────────────────────────────────────────────────────
    const { q: qParam, options } = builder.build();
    const searchOpts: SearchOptions = {
      ...options
    };

    const results = await index.search(qParam ?? "", searchOpts);

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
  async multiSearch(queries: Array<{
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
    return await this.client.multiSearch({ queries: meiliQueries });
  }

  protected applyFilters(qb: QueryBuilder<any>, filters: SearchQuery[ 'filters' ]) {
    if (!filters) return;

    // 1) Group filters
    if (filters.and) {
      qb.andGroup(sub => {
        for (const clause of [].concat(filters.and as [])) {
          sub.andGroup(sub2 => this.applyFilters(sub2, clause));
        }
      });
      return;
    }

    if (filters.or) {
      qb.orGroup(sub => {
        for (const clause of [].concat(filters.or as [])) {
          sub.orGroup(sub2 => this.applyFilters(sub2, clause));
        }
      });
      return;
    }

    if (filters.not) {
      qb.notGroup(sub => {
        for (const clause of [].concat(filters.not as [])) {
          sub.andGroup(sub2 => this.applyFilters(sub2, clause));
        }
      });
      return;
    }

    // 2) Leaf filter: an object mapping field -> operator object
    //    (ignoring metadata keys)
    for (const [ field, criteria ] of Object.entries(filters)) {
      if ([ 'filterId', 'filterLabel', 'logicalOp' ].includes(field)) continue;

      // If it's a primitive, treat as eq
      if (
        typeof criteria !== 'object' ||
        criteria === null ||
        Array.isArray(criteria)
      ) {
        qb.where(field).eq(criteria as any);
        continue;
      }

      // It's an object of operators:
      for (const [ op, rawVal ] of Object.entries(criteria)) {
        const val = (rawVal && (rawVal as any).val != null)
          ? (rawVal as any).val
          : rawVal;

        switch (op) {
          case 'eq': qb.where(field).eq(val); break;
          case 'neq': qb.where(field).neq(val); break;
          case 'gt': qb.where(field).gt(Number(val)); break;
          case 'gte': qb.where(field).gte(Number(val)); break;
          case 'lt': qb.where(field).lt(Number(val)); break;
          case 'lte': qb.where(field).lte(Number(val)); break;
          case 'in': qb.where(field).in([].concat(val)); break;
          case 'notIn': qb.where(field).notIn([].concat(val)); break;
          case 'between':
            // support both [min,max] and {from,to}
            const [ min, max ] = Array.isArray(val)
              ? val
              : [ (val as any).from, (val as any).to ];
            qb.where(field).rangeTo(Number(min), Number(max));
            break;
          case 'exists': qb.where(field).exists(); break;
          case 'isEmpty': qb.where(field).isEmpty(); break;
          case 'isNull': qb.where(field).isNull(); break;
          case 'contains': qb.where(field).contains(String(val)); break;
          case 'startsWith':
            qb.where(field).startsWith(String(val));
            break;
          default:
            // unknown -> raw
            qb.filterRaw(`${field} ${op} ${JSON.stringify(val)}`);
        }
      }
    }
  }
}