import { DeleteOrCancelTasksQuery, type DocumentsQuery, type EnqueuedTask, type Index, type IndexSwap, KeyCreation, KeyUpdate, MeiliSearch, type Config as MeiliSearchClientConfig, type Settings as MeiliSearchIndexSettings, type RecordAny, TasksOrBatchesQuery } from "meilisearch";
import { type SearchIndexConfig, type SearchQuery, type SearchResult } from "../../types";
import { BaseSearchEngine } from "../base";
export interface ExtendedMeiliSearchClientConfig extends MeiliSearchClientConfig {
}
export interface SearchIndexConfigExt extends SearchIndexConfig {
    meiliSearchIndexSettings?: MeiliSearchIndexSettings;
}
export declare class MeiliSearchEngine extends BaseSearchEngine {
    private client;
    private indices;
    private taskTimeoutMs;
    constructor(config: ExtendedMeiliSearchClientConfig);
    getClient(): MeiliSearch;
    /**
     * Creates a new index with the provided configuration or ensures existing index has correct settings
     */
    initIndex(config: SearchIndexConfigExt, synchronous?: boolean): Promise<Index<RecordAny>>;
    /**
     * Ensures index settings are correct with the provided config and updates if needed
     */
    ensureIndexSettings(config: SearchIndexConfigExt, synchronous?: boolean): Promise<Index<RecordAny>>;
    setExperimentalFeaturesStatus(features: {
        metrics: boolean;
        logsRoute: boolean;
        containsFilter: boolean;
        editDocumentsByFunction: boolean;
        network: boolean;
    }): Promise<unknown>;
    getExperimentalFeatures(): Promise<import("meilisearch").RuntimeTogglableFeatures>;
    /**
     * Gets or creates an index instance for the given config
     */
    private getIndex;
    /**
     * Check if an index exists
     */
    indexExists(indexName: string): Promise<boolean>;
    /**
     * Get information about an index
     */
    getIndexInfo(indexName: string): Promise<Index<RecordAny>>;
    /**
     * Get index stats
     */
    getIndexStats(indexName: string): Promise<import("meilisearch").IndexStats>;
    /**
     * List all available indices
     */
    listIndices(limit?: number, offset?: number): Promise<import("meilisearch").IndexesResults<Index<RecordAny>[]>>;
    /**
     * Delete an index
     */
    deleteIndex(indexName: string, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update index settings
     */
    updateIndexSettings(indexName: string, settings: MeiliSearchIndexSettings, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Reset index settings to default
     */
    resetIndexSettings(indexName: string, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Get index settings
     */
    getIndexSettings(indexName: string): Promise<MeiliSearchIndexSettings>;
    /**
     * Update filterable attributes for an index
     */
    updateFilterableAttributes(indexName: string, attributes: string[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update sortable attributes for an index
     */
    updateSortableAttributes(indexName: string, attributes: string[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update searchable attributes for an index
     */
    updateSearchableAttributes(indexName: string, attributes: string[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update displayed attributes for an index
     */
    updateDisplayedAttributes(indexName: string, attributes: string[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update synonyms for an index
     */
    updateSynonyms(indexName: string, synonyms: Record<string, string[]>, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update stop words for an index
     */
    updateStopWords(indexName: string, stopWords: string[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update ranking rules for an index
     */
    updateRankingRules(indexName: string, rankingRules: string[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Swap two indexes
     */
    swapIndexes(indexSwaps: IndexSwap[], synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Add or replace documents in an index
     */
    indexDocuments<T extends Record<string, any>>(docs: T[], config: SearchIndexConfig, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Add documents in batches
     */
    indexInBatches<T extends Record<string, any>>(docs: T[], config: SearchIndexConfig, batchSize?: number, synchronous?: boolean): Promise<void>;
    /**
     * Update existing documents (partial update that preserves existing fields)
     */
    updateDocuments<T extends Record<string, any>>(docs: T[], config: SearchIndexConfig, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Update documents in batches
     */
    updateDocumentsInBatches<T extends Record<string, any>>(docs: T[], config: SearchIndexConfig, batchSize?: number, synchronous?: boolean): Promise<void>;
    /**
     * Get a document by ID
     */
    getDocument<T extends RecordAny>(id: string, indexName: string): Promise<T>;
    /**
     * Get documents with filtering options
     */
    getDocuments<T extends RecordAny>(indexName: string, options?: DocumentsQuery<T>): Promise<T[]>;
    /**
     * Delete documents by ID
     */
    deleteDocuments(ids: string[], indexName: string, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Delete all documents in an index
     */
    deleteAllDocuments(indexName: string, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Delete documents by filter
     */
    deleteDocumentsByFilter(filter: SearchQuery['filters'], indexName: string, synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Create a snapshot
     */
    createSnapshot(synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Create a dump
     */
    createDump(synchronous?: boolean): Promise<EnqueuedTask | import("meilisearch").Task>;
    /**
     * Check server health
     */
    health<T extends any>(): Promise<T>;
    /**
     * Check if server is healthy
     */
    isHealthy(): Promise<boolean>;
    /**
     * Get server stats
     */
    getStats<T extends any = any>(): Promise<T>;
    /**
     * Get server version
     */
    getVersion(): Promise<any>;
    /**
     * Search an index with advanced options
     */
    search<T>(query: SearchQuery, config: SearchIndexConfig): Promise<SearchResult<T>>;
    /**
     * Perform a multi-search query
     */
    multiSearch<T extends any>(queries: Array<{
        indexUid: string;
        query: string;
        searchParams?: Record<string, any>;
    }>): Promise<T>;
    /**
     * Get API keys
     */
    getKeys(): Promise<import("meilisearch").KeysResults>;
    /**
     * Get an API key
     */
    getKey(keyOrUid: string): Promise<import("meilisearch").Key>;
    /**
     * Create an API key
     */
    createKey(options: KeyCreation): Promise<import("meilisearch").Key>;
    /**
     * Update an API key
     */
    updateKey(keyOrUid: string, options: KeyUpdate): Promise<import("meilisearch").Key>;
    /**
     * Delete an API key
     */
    deleteKey(keyOrUid: string): Promise<void>;
    /**
     * Cancel tasks
     */
    cancelTasks(query: DeleteOrCancelTasksQuery): Promise<import("meilisearch").Task>;
    /**
     * Delete tasks
     */
    deleteTasks(query: DeleteOrCancelTasksQuery): Promise<import("meilisearch").Task>;
    /**
     * Wait for a task to complete
     */
    waitForTask(taskId: number, timeoutMs?: number): Promise<import("meilisearch").Task>;
    /**
     * Get batches
     */
    getBatches(params?: TasksOrBatchesQuery): Promise<import("meilisearch").BatchesResults>;
    /**
     * Get a specific batch
     */
    getBatch(batchUid: number): Promise<import("meilisearch").Batch>;
    protected validateConfig(config: SearchIndexConfig): void;
}
