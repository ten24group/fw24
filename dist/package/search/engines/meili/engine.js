"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeiliSearchEngine = void 0;
const meilisearch_1 = require("meilisearch");
const base_1 = require("../base");
const query_builder_1 = require("./query-builder");
const applyFIlters_1 = require("./utils/applyFIlters");
const buildSearchQuery_1 = require("./utils/buildSearchQuery");
const errors_1 = require("../../errors");
class MeiliSearchEngine extends base_1.BaseSearchEngine {
    client;
    indices = new Map();
    taskTimeoutMs = 30000; // Default timeout for tasks: 30s
    constructor(config) {
        super(config);
        // Basic validation - let MeiliSearch library handle the rest
        if (!config?.host?.trim()) {
            throw new errors_1.SearchEngineConnectionError('MeiliSearch host is required');
        }
        this.client = new meilisearch_1.MeiliSearch(config);
    }
    getClient() {
        return this.client;
    }
    /**
     * Creates a new index with the provided configuration or ensures existing index has correct settings
     */
    async initIndex(config, synchronous = false) {
        try {
            this.validateConfig(config);
            const idx = config.indexName;
            // Check if index exists
            let indexExists = false;
            try {
                indexExists = await this.indexExists(idx);
            }
            catch (error) {
                throw new errors_1.SearchIndexError(`Failed to check index existence: ${idx}`, { error });
            }
            // If index doesn't exist, create it
            if (!indexExists) {
                const createOptions = {};
                createOptions.primaryKey = config.primaryKey ? config.primaryKey : 'id';
                const promise = this.client.createIndex(idx, createOptions);
                if (!promise) {
                    throw new errors_1.SearchIndexError(`Failed to create index ${idx}`);
                }
                // Wait for the creation task to complete (required before we can update settings)
                const task = await promise.waitTask();
            }
            // Ensure settings are correctly applied for both new and existing indices
            return await this.ensureIndexSettings(config, synchronous);
        }
        catch (error) {
            if (error instanceof errors_1.SearchIndexError) {
                throw error;
            }
            throw new errors_1.SearchEngineError(`Failed to initialize index: ${error.message}`, { error });
        }
    }
    /**
     * Ensures index settings are correct with the provided config and updates if needed
     */
    async ensureIndexSettings(config, synchronous = false) {
        try {
            this.validateConfig(config);
            const idx = config.indexName;
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
        }
        catch (error) {
            throw new errors_1.SearchEngineError(`Failed to ensure index settings: ${error.message}`, { error });
        }
    }
    async setExperimentalFeaturesStatus(features) {
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
    async getIndex(config) {
        this.validateConfig(config);
        const idx = config.indexName;
        if (!this.indices.has(idx)) {
            const index = await this.initIndex(config, true);
            this.indices.set(idx, index);
        }
        return this.indices.get(idx);
    }
    /**
     * Check if an index exists
     */
    async indexExists(indexName) {
        try {
            await this.client.getIndex(indexName);
            return true;
        }
        catch (err) {
            // this.logger.error(`Failed to check if index ${indexName} exists: ${err}`);
            return false;
        }
    }
    /**
     * Get information about an index
     */
    async getIndexInfo(indexName) {
        try {
            return await this.client.getIndex(indexName);
        }
        catch (err) {
            throw new Error(`Failed to get index info: ${err}`);
        }
    }
    /**
     * Get index stats
     */
    async getIndexStats(indexName) {
        const index = await this.getIndex({ indexName });
        return await index.getStats();
    }
    /**
     * List all available indices
     */
    async listIndices(limit, offset) {
        // Use a higher limit to ensure we get all indices, including test indices
        const options = limit ? { limit, offset: offset || 0 } : { limit: 1000 };
        return await this.client.getIndexes(options);
    }
    /**
     * Delete an index
     */
    async deleteIndex(indexName, synchronous = false) {
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
    async updateIndexSettings(indexName, settings, synchronous = false) {
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
    async resetIndexSettings(indexName, synchronous = false) {
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
    async getIndexSettings(indexName) {
        const index = await this.getIndex({ indexName });
        return await index.getSettings();
    }
    /**
     * Update filterable attributes for an index
     */
    async updateFilterableAttributes(indexName, attributes, synchronous = false) {
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
    async updateSortableAttributes(indexName, attributes, synchronous = false) {
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
    async updateSearchableAttributes(indexName, attributes, synchronous = false) {
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
    async updateDisplayedAttributes(indexName, attributes, synchronous = false) {
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
    async updateSynonyms(indexName, synonyms, synchronous = false) {
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
    async updateStopWords(indexName, stopWords, synchronous = false) {
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
    async updateRankingRules(indexName, rankingRules, synchronous = false) {
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
    async swapIndexes(indexSwaps, synchronous = false) {
        const promise = this.client.swapIndexes(indexSwaps);
        if (synchronous) {
            return await promise.waitTask();
        }
        return await promise;
    }
    /**
     * Add or replace documents in an index
     */
    async indexDocuments(docs, config, synchronous = false) {
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
    async indexInBatches(docs, config, batchSize = 1000, synchronous = false) {
        const index = await this.getIndex(config);
        for (let i = 0; i < docs.length; i += batchSize) {
            const batch = docs.slice(i, i + batchSize);
            const promise = index.addDocuments(batch);
            if (synchronous) {
                await promise.waitTask();
            }
            else {
                await promise;
            }
        }
    }
    /**
     * Update existing documents (partial update that preserves existing fields)
     */
    async updateDocuments(docs, config, synchronous = false) {
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
    async updateDocumentsInBatches(docs, config, batchSize = 1000, synchronous = false) {
        const index = await this.getIndex(config);
        for (let i = 0; i < docs.length; i += batchSize) {
            const batch = docs.slice(i, i + batchSize);
            const promise = index.updateDocuments(batch);
            if (synchronous) {
                await promise.waitTask();
            }
            else {
                await promise;
            }
        }
    }
    /**
     * Get a document by ID
     */
    async getDocument(id, indexName) {
        const index = await this.getIndex({ indexName });
        return await index.getDocument(id);
    }
    /**
     * Get documents with filtering options
     */
    async getDocuments(indexName, options) {
        const index = await this.getIndex({ indexName });
        const result = await index.getDocuments(options);
        return result.results;
    }
    /**
     * Delete documents by ID
     */
    async deleteDocuments(ids, indexName, synchronous = false) {
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
    async deleteAllDocuments(indexName, synchronous = false) {
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
    async deleteDocumentsByFilter(filter, indexName, synchronous = false) {
        if (!indexName) {
            throw new Error("Index name is required for deleteByFilter operation");
        }
        const index = await this.getIndex({ indexName });
        const builder = query_builder_1.QueryBuilder.create();
        (0, applyFIlters_1.applyFilters)(builder, filter);
        const { options } = builder.build();
        const promise = index.deleteDocuments({ filter: options.filter });
        if (synchronous) {
            return await promise.waitTask();
        }
        return await promise;
    }
    /**
     * Create a snapshot
     */
    async createSnapshot(synchronous = false) {
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
        }
        catch (error) {
            this.logger.error('Failed to create snapshot', { error: error.message, stack: error.stack });
            throw new errors_1.SearchEngineError(`Failed to create snapshot: ${error.message}`, { error });
        }
    }
    /**
     * Create a dump
     */
    async createDump(synchronous = false) {
        const promise = this.client.createDump();
        if (synchronous) {
            return await promise.waitTask();
        }
        return await promise;
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
    async isHealthy() {
        try {
            await this.client.health();
            return true;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Get server stats
     */
    async getStats() {
        return await this.client.getStats();
    }
    /**
     * Get server version
     */
    async getVersion() {
        return await this.client.getVersion();
    }
    /**
     * Search an index with advanced options
     */
    async search(query, config) {
        try {
            const index = await this.getIndex(config);
            const meiliSearchQuery = (0, buildSearchQuery_1.buildMeiliSearchQuery)(query);
            const { q: qParam, options } = meiliSearchQuery;
            const results = await index.search(qParam ?? "", {
                ...options
            });
            return {
                ...results,
                hits: results.hits,
                facets: results.facetDistribution,
                facetStats: results.facetStats,
                total: results.estimatedTotalHits ?? results.totalHits,
                processingTimeMs: results.processingTimeMs,
                query: results.query,
                ...(results.page !== undefined && {
                    page: results.page,
                    hitsPerPage: results.hitsPerPage,
                    totalPages: results.totalPages
                })
            };
        }
        catch (error) {
            if (error instanceof errors_1.SearchQueryError) {
                throw error;
            }
            throw new errors_1.SearchEngineError(`Search operation failed: ${error.message}`, { error });
        }
    }
    /**
     * Perform a multi-search query
     */
    async multiSearch(queries) {
        // Map the input queries to the format expected by the MeiliSearch client
        const meiliQueries = queries.map(q => ({
            indexUid: q.indexUid,
            q: q.query, // MeiliSearch client expects 'q' instead of 'query'
            ...q.searchParams, // Spread any additional search parameters
        }));
        return await this.client.multiSearch({ queries: meiliQueries });
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
    async getKey(keyOrUid) {
        return this.client.getKey(keyOrUid);
    }
    /**
     * Create an API key
     */
    async createKey(options) {
        return this.client.createKey(options);
    }
    /**
     * Update an API key
     */
    async updateKey(keyOrUid, options) {
        return this.client.updateKey(keyOrUid, options);
    }
    /**
     * Delete an API key
     */
    async deleteKey(keyOrUid) {
        return this.client.deleteKey(keyOrUid);
    }
    /**
     * Cancel tasks
     */
    async cancelTasks(query) {
        const promise = this.client.tasks.cancelTasks(query);
        return await promise.waitTask();
    }
    /**
     * Delete tasks
     */
    async deleteTasks(query) {
        const promise = this.client.tasks.deleteTasks(query);
        return await promise.waitTask();
    }
    /**
     * Wait for a task to complete
     */
    async waitForTask(taskId, timeoutMs = this.taskTimeoutMs) {
        return this.client.tasks.waitForTask(taskId, {
            timeout: timeoutMs,
            interval: 100,
        });
    }
    /**
     * Get batches
     */
    async getBatches(params) {
        return this.client.batches.getBatches(params);
    }
    /**
     * Get a specific batch
     */
    async getBatch(batchUid) {
        return this.client.batches.getBatch(batchUid);
    }
    validateConfig(config) {
        if (!config.indexName) {
            throw new errors_1.SearchQueryError('Index name is required');
        }
    }
}
exports.MeiliSearchEngine = MeiliSearchEngine;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9lbmdpbmVzL21laWxpL2VuZ2luZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBeVM7QUFFelMsa0NBQTJDO0FBQzNDLG1EQUErQztBQUMvQyx1REFBb0Q7QUFDcEQsK0RBQWlFO0FBQ2pFLHlDQUFrSDtBQVNsSCxNQUFhLGlCQUFrQixTQUFRLHVCQUFnQjtJQUM3QyxNQUFNLENBQWM7SUFDcEIsT0FBTyxHQUFHLElBQUksR0FBRyxFQUFpQixDQUFDO0lBQ25DLGFBQWEsR0FBRyxLQUFLLENBQUMsQ0FBQyxpQ0FBaUM7SUFFaEUsWUFBWSxNQUF1QztRQUNqRCxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFZCw2REFBNkQ7UUFDN0QsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUMxQixNQUFNLElBQUksb0NBQTJCLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUN4RSxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLHlCQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDeEMsQ0FBQztJQUVNLFNBQVM7UUFDZCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDckIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUE0QixFQUFFLGNBQXVCLEtBQUs7UUFDeEUsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUM1QixNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsU0FBVSxDQUFDO1lBRTlCLHdCQUF3QjtZQUN4QixJQUFJLFdBQVcsR0FBRyxLQUFLLENBQUM7WUFDeEIsSUFBSSxDQUFDO2dCQUNILFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDNUMsQ0FBQztZQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7Z0JBQ3BCLE1BQU0sSUFBSSx5QkFBZ0IsQ0FBQyxvQ0FBb0MsR0FBRyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ25GLENBQUM7WUFFRCxvQ0FBb0M7WUFDcEMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUVqQixNQUFNLGFBQWEsR0FBNEIsRUFBRSxDQUFDO2dCQUNsRCxhQUFhLENBQUMsVUFBVSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFvQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7Z0JBRWxGLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxhQUFhLENBQUMsQ0FBQztnQkFFNUQsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO29CQUNiLE1BQU0sSUFBSSx5QkFBZ0IsQ0FBQywwQkFBMEIsR0FBRyxFQUFFLENBQUMsQ0FBQztnQkFDOUQsQ0FBQztnQkFDRCxrRkFBa0Y7Z0JBQ2xGLE1BQU0sSUFBSSxHQUFHLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3hDLENBQUM7WUFFRCwwRUFBMEU7WUFDMUUsT0FBTyxNQUFNLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFFN0QsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFFcEIsSUFBSSxLQUFLLFlBQVkseUJBQWdCLEVBQUUsQ0FBQztnQkFDdEMsTUFBTSxLQUFLLENBQUM7WUFDZCxDQUFDO1lBRUQsTUFBTSxJQUFJLDBCQUFpQixDQUFDLCtCQUErQixLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsbUJBQW1CLENBQUMsTUFBNEIsRUFBRSxjQUF1QixLQUFLO1FBQ2xGLElBQUksQ0FBQztZQUNILElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDNUIsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLFNBQVUsQ0FBQztZQUU5Qix5QkFBeUI7WUFDekIsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFFckMsbUNBQW1DO1lBQ25DLE1BQU0sV0FBVyxHQUFHO2dCQUNsQixHQUFHLE1BQU0sQ0FBQyxRQUFRO2dCQUNsQixHQUFHLE1BQU0sQ0FBQyx3QkFBd0I7YUFDbkMsQ0FBQztZQUVGLDJDQUEyQztZQUMzQyxJQUFJLFdBQVcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDdkQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsK0JBQStCLEdBQUcsRUFBRSxDQUFDLENBQUM7Z0JBQ3hELE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLEdBQUcsRUFBRSxXQUFXLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFDaEUsQ0FBQztZQUVELE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsTUFBTSxJQUFJLDBCQUFpQixDQUFDLG9DQUFvQyxLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQzlGLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLDZCQUE2QixDQUFDLFFBTW5DO1FBQ0MsK0JBQStCO1FBQy9CLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDO1lBQ25ELElBQUksRUFBRSx3QkFBd0I7WUFDOUIsSUFBSSxFQUFFO2dCQUNKLEdBQUcsUUFBUTthQUNaO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsT0FBTyxRQUFRLENBQUM7SUFDbEIsQ0FBQztJQUVELEtBQUssQ0FBQyx1QkFBdUI7UUFDM0IsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLHVCQUF1QixFQUFFLENBQUM7SUFDL0MsQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLFFBQVEsQ0FBQyxNQUE0QjtRQUNqRCxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzVCLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxTQUFVLENBQUM7UUFDOUIsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDM0IsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNqRCxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDL0IsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFFLENBQUM7SUFDaEMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxTQUFpQjtRQUNqQyxJQUFJLENBQUM7WUFDSCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ3RDLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYiw2RUFBNkU7WUFDN0UsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxTQUFpQjtRQUNsQyxJQUFJLENBQUM7WUFDSCxPQUFPLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDL0MsQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYixNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQ3RELENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLFNBQWlCO1FBQ25DLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsT0FBTyxNQUFNLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztJQUNoQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLEtBQWMsRUFBRSxNQUFlO1FBQy9DLDBFQUEwRTtRQUMxRSxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDO1FBQ3pFLE9BQU8sTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUMvQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUMvRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNuRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQy9CLE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLFNBQWlCLEVBQUUsUUFBa0MsRUFBRSxjQUF1QixLQUFLO1FBQzNHLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMvQyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUN0RSxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ2pELE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN0QyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGdCQUFnQixDQUFDLFNBQWlCO1FBQ3RDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsT0FBTyxNQUFNLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNuQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsU0FBaUIsRUFBRSxVQUFvQixFQUFFLGNBQXVCLEtBQUs7UUFDcEcsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRCxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsMEJBQTBCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDN0QsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixPQUFPLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2xDLENBQUM7UUFFRCxPQUFPLE1BQU0sT0FBTyxDQUFDO0lBQ3ZCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxTQUFpQixFQUFFLFVBQW9CLEVBQUUsY0FBdUIsS0FBSztRQUNsRyxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ2pELE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUMzRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLDBCQUEwQixDQUFDLFNBQWlCLEVBQUUsVUFBb0IsRUFBRSxjQUF1QixLQUFLO1FBQ3BHLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLDBCQUEwQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzdELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsT0FBTyxNQUFNLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxDQUFDO1FBQ0QsT0FBTyxNQUFNLE9BQU8sQ0FBQztJQUN2QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMseUJBQXlCLENBQUMsU0FBaUIsRUFBRSxVQUFvQixFQUFFLGNBQXVCLEtBQUs7UUFDbkcsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRCxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMseUJBQXlCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDNUQsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixPQUFPLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2xDLENBQUM7UUFDRCxPQUFPLE1BQU0sT0FBTyxDQUFDO0lBQ3ZCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUIsRUFBRSxRQUFrQyxFQUFFLGNBQXVCLEtBQUs7UUFDdEcsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRCxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQy9DLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsT0FBTyxNQUFNLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxDQUFDO1FBQ0QsT0FBTyxNQUFNLE9BQU8sQ0FBQztJQUN2QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUFDLFNBQWlCLEVBQUUsU0FBbUIsRUFBRSxjQUF1QixLQUFLO1FBQ3hGLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNqRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFNBQWlCLEVBQUUsWUFBc0IsRUFBRSxjQUF1QixLQUFLO1FBQzlGLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3ZELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsT0FBTyxNQUFNLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxDQUFDO1FBQ0QsT0FBTyxNQUFNLE9BQU8sQ0FBQztJQUN2QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLFVBQXVCLEVBQUUsY0FBdUIsS0FBSztRQUNyRSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNwRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FDbEIsSUFBUyxFQUNULE1BQXlCLEVBQ3pCLGNBQXVCLEtBQUs7UUFFNUIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzFDLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDekMsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixPQUFPLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2xDLENBQUM7UUFDRCxPQUFPLE1BQU0sT0FBTyxDQUFDO0lBQ3ZCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQ2xCLElBQVMsRUFDVCxNQUF5QixFQUN6QixZQUFvQixJQUFJLEVBQ3hCLGNBQXVCLEtBQUs7UUFFNUIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTFDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNoRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsU0FBUyxDQUFDLENBQUM7WUFDM0MsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUMxQyxJQUFJLFdBQVcsRUFBRSxDQUFDO2dCQUNoQixNQUFNLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUMzQixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxPQUFPLENBQUM7WUFDaEIsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsZUFBZSxDQUNuQixJQUFTLEVBQ1QsTUFBeUIsRUFDekIsY0FBdUIsS0FBSztRQUU1QixNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDMUMsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUM1QyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHdCQUF3QixDQUM1QixJQUFTLEVBQ1QsTUFBeUIsRUFDekIsWUFBb0IsSUFBSSxFQUN4QixjQUF1QixLQUFLO1FBRTVCLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUUxQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksU0FBUyxFQUFFLENBQUM7WUFDaEQsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDO1lBQzNDLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDN0MsSUFBSSxXQUFXLEVBQUUsQ0FBQztnQkFDaEIsTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDM0IsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sT0FBTyxDQUFDO1lBQ2hCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBc0IsRUFBVSxFQUFFLFNBQWlCO1FBQ2xFLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsT0FBTyxNQUFNLEtBQUssQ0FBQyxXQUFXLENBQUksRUFBRSxDQUFDLENBQUM7SUFDeEMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBc0IsU0FBaUIsRUFBRSxPQUEyQjtRQUNwRixNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ2pELE1BQU0sTUFBTSxHQUFHLE1BQU0sS0FBSyxDQUFDLFlBQVksQ0FBSSxPQUFPLENBQUMsQ0FBQztRQUNwRCxPQUFPLE1BQU0sQ0FBQyxPQUFPLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGVBQWUsQ0FBQyxHQUFhLEVBQUUsU0FBaUIsRUFBRSxjQUF1QixLQUFLO1FBQ2xGLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNmLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQztRQUNqRSxDQUFDO1FBQ0QsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNqRCxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzNDLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsT0FBTyxNQUFNLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNsQyxDQUFDO1FBQ0QsT0FBTyxNQUFNLE9BQU8sQ0FBQztJQUN2QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsU0FBaUIsRUFBRSxjQUF1QixLQUFLO1FBQ3RFLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGtCQUFrQixFQUFFLENBQUM7UUFDM0MsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixPQUFPLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2xDLENBQUM7UUFDRCxPQUFPLE1BQU0sT0FBTyxDQUFDO0lBQ3ZCLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxNQUFnQyxFQUFFLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUM3RyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDZixNQUFNLElBQUksS0FBSyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7UUFDekUsQ0FBQztRQUVELE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFFakQsTUFBTSxPQUFPLEdBQUcsNEJBQVksQ0FBQyxNQUFNLEVBQU8sQ0FBQztRQUMzQyxJQUFBLDJCQUFZLEVBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQzlCLE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxPQUFPLENBQUMsS0FBSyxFQUFFLENBQUM7UUFFcEMsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLGVBQWUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTyxFQUFFLENBQUMsQ0FBQztRQUVuRSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUVELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxjQUF1QixLQUFLO1FBQy9DLElBQUksQ0FBQztZQUNILElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHNCQUFzQixFQUFFLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztZQUUxRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBRTdDLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2hCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDBDQUEwQyxDQUFDLENBQUM7Z0JBQzdELE1BQU0sTUFBTSxHQUFHLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUN4QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7Z0JBQzlELE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUM7WUFFRCxNQUFNLE1BQU0sR0FBRyxNQUFNLE9BQU8sQ0FBQztZQUM3QixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDL0QsT0FBTyxNQUFNLENBQUM7UUFDaEIsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsMkJBQTJCLEVBQUUsRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDN0YsTUFBTSxJQUFJLDBCQUFpQixDQUFDLDhCQUE4QixLQUFLLENBQUMsT0FBTyxFQUFFLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ3hGLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLGNBQXVCLEtBQUs7UUFDM0MsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUN6QyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDbEMsQ0FBQztRQUNELE9BQU8sTUFBTSxPQUFPLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLE1BQU07UUFDVixPQUFPLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQU8sQ0FBQztJQUN6QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsU0FBUztRQUNiLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUMzQixPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ1gsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFFBQVE7UUFDWixPQUFPLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQU8sQ0FBQztJQUMzQyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsVUFBVTtRQUNkLE9BQU8sTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDO0lBQ3hDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQ1YsS0FBa0IsRUFDbEIsTUFBeUI7UUFFekIsSUFBSSxDQUFDO1lBQ0gsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQzFDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBQSx3Q0FBcUIsRUFBQyxLQUFLLENBQUMsQ0FBQztZQUN0RCxNQUFNLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxnQkFBZ0IsQ0FBQztZQUVoRCxNQUFNLE9BQU8sR0FBRyxNQUFNLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxJQUFJLEVBQUUsRUFBRTtnQkFDL0MsR0FBRyxPQUFPO2FBQ1gsQ0FBQyxDQUFDO1lBRUgsT0FBTztnQkFDTCxHQUFHLE9BQU87Z0JBQ1YsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFXO2dCQUN6QixNQUFNLEVBQUUsT0FBTyxDQUFDLGlCQUFpQjtnQkFDakMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO2dCQUM5QixLQUFLLEVBQUUsT0FBTyxDQUFDLGtCQUFrQixJQUFLLE9BQWUsQ0FBQyxTQUFTO2dCQUMvRCxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsZ0JBQWdCO2dCQUMxQyxLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7Z0JBQ3BCLEdBQUcsQ0FBRSxPQUFlLENBQUMsSUFBSSxLQUFLLFNBQVMsSUFBSTtvQkFDekMsSUFBSSxFQUFHLE9BQWUsQ0FBQyxJQUFJO29CQUMzQixXQUFXLEVBQUcsT0FBZSxDQUFDLFdBQVc7b0JBQ3pDLFVBQVUsRUFBRyxPQUFlLENBQUMsVUFBVTtpQkFDeEMsQ0FBQzthQUNILENBQUM7UUFDSixDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNwQixJQUFJLEtBQUssWUFBWSx5QkFBZ0IsRUFBRSxDQUFDO2dCQUN0QyxNQUFNLEtBQUssQ0FBQztZQUNkLENBQUM7WUFDRCxNQUFNLElBQUksMEJBQWlCLENBQUMsNEJBQTRCLEtBQUssQ0FBQyxPQUFPLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7UUFDdEYsQ0FBQztJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQWdCLE9BSS9CO1FBRUEseUVBQXlFO1FBQ3pFLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3JDLFFBQVEsRUFBRSxDQUFDLENBQUMsUUFBUTtZQUNwQixDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxvREFBb0Q7WUFDaEUsR0FBRyxDQUFDLENBQUMsWUFBWSxFQUFFLDBDQUEwQztTQUM5RCxDQUFDLENBQUMsQ0FBQztRQUVKLE9BQU8sTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxZQUFZLEVBQUUsQ0FBTSxDQUFDO0lBQ3ZFLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQy9CLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxNQUFNLENBQUMsUUFBZ0I7UUFDM0IsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN0QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQW9CO1FBQ2xDLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDeEMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFnQixFQUFFLE9BQWtCO1FBQ2xELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ2xELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBZ0I7UUFDOUIsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN6QyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLEtBQStCO1FBQy9DLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNyRCxPQUFPLE1BQU0sT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQ2xDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBK0I7UUFDL0MsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ3JELE9BQU8sTUFBTSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDbEMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFjLEVBQUUsWUFBb0IsSUFBSSxDQUFDLGFBQWE7UUFDdEUsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFO1lBQzNDLE9BQU8sRUFBRSxTQUFTO1lBQ2xCLFFBQVEsRUFBRSxHQUFHO1NBQ2QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUE0QjtRQUMzQyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsUUFBUSxDQUFDLFFBQWdCO1FBQzdCLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFUyxjQUFjLENBQUMsTUFBeUI7UUFDaEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUN0QixNQUFNLElBQUkseUJBQWdCLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUN2RCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBbHBCRCw4Q0FrcEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGVsZXRlT3JDYW5jZWxUYXNrc1F1ZXJ5LCB0eXBlIERvY3VtZW50c1F1ZXJ5LCB0eXBlIEVucXVldWVkVGFzaywgdHlwZSBJbmRleCwgdHlwZSBJbmRleFN3YXAsIEtleUNyZWF0aW9uLCBLZXlVcGRhdGUsIE1laWxpU2VhcmNoLCB0eXBlIENvbmZpZyBhcyBNZWlsaVNlYXJjaENsaWVudENvbmZpZywgdHlwZSBTZXR0aW5ncyBhcyBNZWlsaVNlYXJjaEluZGV4U2V0dGluZ3MsIHR5cGUgUmVjb3JkQW55LCBUYXNrc09yQmF0Y2hlc1F1ZXJ5LCB0eXBlIFRhc2tTdGF0dXMgfSBmcm9tIFwibWVpbGlzZWFyY2hcIjtcbmltcG9ydCB7IHR5cGUgU2VhcmNoSW5kZXhDb25maWcsIHR5cGUgU2VhcmNoUXVlcnksIHR5cGUgU2VhcmNoUmVzdWx0IH0gZnJvbSBcIi4uLy4uL3R5cGVzXCI7XG5pbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSBcIi4uL2Jhc2VcIjtcbmltcG9ydCB7IFF1ZXJ5QnVpbGRlciB9IGZyb20gXCIuL3F1ZXJ5LWJ1aWxkZXJcIjtcbmltcG9ydCB7IGFwcGx5RmlsdGVycyB9IGZyb20gXCIuL3V0aWxzL2FwcGx5RklsdGVyc1wiO1xuaW1wb3J0IHsgYnVpbGRNZWlsaVNlYXJjaFF1ZXJ5IH0gZnJvbSBcIi4vdXRpbHMvYnVpbGRTZWFyY2hRdWVyeVwiO1xuaW1wb3J0IHsgU2VhcmNoRW5naW5lQ29ubmVjdGlvbkVycm9yLCBTZWFyY2hFbmdpbmVFcnJvciwgU2VhcmNoSW5kZXhFcnJvciwgU2VhcmNoUXVlcnlFcnJvciB9IGZyb20gXCIuLi8uLi9lcnJvcnNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBFeHRlbmRlZE1laWxpU2VhcmNoQ2xpZW50Q29uZmlnIGV4dGVuZHMgTWVpbGlTZWFyY2hDbGllbnRDb25maWcge1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlYXJjaEluZGV4Q29uZmlnRXh0IGV4dGVuZHMgU2VhcmNoSW5kZXhDb25maWcge1xuICBtZWlsaVNlYXJjaEluZGV4U2V0dGluZ3M/OiBNZWlsaVNlYXJjaEluZGV4U2V0dGluZ3Ncbn1cblxuZXhwb3J0IGNsYXNzIE1laWxpU2VhcmNoRW5naW5lIGV4dGVuZHMgQmFzZVNlYXJjaEVuZ2luZSB7XG4gIHByaXZhdGUgY2xpZW50OiBNZWlsaVNlYXJjaDtcbiAgcHJpdmF0ZSBpbmRpY2VzID0gbmV3IE1hcDxzdHJpbmcsIEluZGV4PigpO1xuICBwcml2YXRlIHRhc2tUaW1lb3V0TXMgPSAzMDAwMDsgLy8gRGVmYXVsdCB0aW1lb3V0IGZvciB0YXNrczogMzBzXG5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBFeHRlbmRlZE1laWxpU2VhcmNoQ2xpZW50Q29uZmlnKSB7XG4gICAgc3VwZXIoY29uZmlnKTtcbiAgICBcbiAgICAvLyBCYXNpYyB2YWxpZGF0aW9uIC0gbGV0IE1laWxpU2VhcmNoIGxpYnJhcnkgaGFuZGxlIHRoZSByZXN0XG4gICAgaWYgKCFjb25maWc/Lmhvc3Q/LnRyaW0oKSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUNvbm5lY3Rpb25FcnJvcignTWVpbGlTZWFyY2ggaG9zdCBpcyByZXF1aXJlZCcpO1xuICAgIH1cbiAgICBcbiAgICB0aGlzLmNsaWVudCA9IG5ldyBNZWlsaVNlYXJjaChjb25maWcpO1xuICB9XG5cbiAgcHVibGljIGdldENsaWVudCgpOiBNZWlsaVNlYXJjaCB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgaW5kZXggd2l0aCB0aGUgcHJvdmlkZWQgY29uZmlndXJhdGlvbiBvciBlbnN1cmVzIGV4aXN0aW5nIGluZGV4IGhhcyBjb3JyZWN0IHNldHRpbmdzXG4gICAqL1xuICBhc3luYyBpbml0SW5kZXgoY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZ0V4dCwgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnZhbGlkYXRlQ29uZmlnKGNvbmZpZyk7XG4gICAgICBjb25zdCBpZHggPSBjb25maWcuaW5kZXhOYW1lITtcblxuICAgICAgLy8gQ2hlY2sgaWYgaW5kZXggZXhpc3RzXG4gICAgICBsZXQgaW5kZXhFeGlzdHMgPSBmYWxzZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGluZGV4RXhpc3RzID0gYXdhaXQgdGhpcy5pbmRleEV4aXN0cyhpZHgpO1xuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICB0aHJvdyBuZXcgU2VhcmNoSW5kZXhFcnJvcihgRmFpbGVkIHRvIGNoZWNrIGluZGV4IGV4aXN0ZW5jZTogJHtpZHh9YCwgeyBlcnJvciB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgaW5kZXggZG9lc24ndCBleGlzdCwgY3JlYXRlIGl0XG4gICAgICBpZiAoIWluZGV4RXhpc3RzKSB7XG5cbiAgICAgICAgY29uc3QgY3JlYXRlT3B0aW9uczogeyBwcmltYXJ5S2V5Pzogc3RyaW5nIH0gPSB7fTtcbiAgICAgICAgY3JlYXRlT3B0aW9ucy5wcmltYXJ5S2V5ID0gY29uZmlnLnByaW1hcnlLZXkgPyBjb25maWcucHJpbWFyeUtleSBhcyBzdHJpbmcgOiAnaWQnO1xuXG4gICAgICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC5jcmVhdGVJbmRleChpZHgsIGNyZWF0ZU9wdGlvbnMpO1xuXG4gICAgICAgIGlmICghcHJvbWlzZSkge1xuICAgICAgICAgIHRocm93IG5ldyBTZWFyY2hJbmRleEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIGluZGV4ICR7aWR4fWApO1xuICAgICAgICB9XG4gICAgICAgIC8vIFdhaXQgZm9yIHRoZSBjcmVhdGlvbiB0YXNrIHRvIGNvbXBsZXRlIChyZXF1aXJlZCBiZWZvcmUgd2UgY2FuIHVwZGF0ZSBzZXR0aW5ncylcbiAgICAgICAgY29uc3QgdGFzayA9IGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICAgIH1cblxuICAgICAgLy8gRW5zdXJlIHNldHRpbmdzIGFyZSBjb3JyZWN0bHkgYXBwbGllZCBmb3IgYm90aCBuZXcgYW5kIGV4aXN0aW5nIGluZGljZXNcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmVuc3VyZUluZGV4U2V0dGluZ3MoY29uZmlnLCBzeW5jaHJvbm91cyk7XG5cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG5cbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFNlYXJjaEluZGV4RXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBTZWFyY2hFbmdpbmVFcnJvcihgRmFpbGVkIHRvIGluaXRpYWxpemUgaW5kZXg6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVycm9yIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGluZGV4IHNldHRpbmdzIGFyZSBjb3JyZWN0IHdpdGggdGhlIHByb3ZpZGVkIGNvbmZpZyBhbmQgdXBkYXRlcyBpZiBuZWVkZWRcbiAgICovXG4gIGFzeW5jIGVuc3VyZUluZGV4U2V0dGluZ3MoY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZ0V4dCwgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnZhbGlkYXRlQ29uZmlnKGNvbmZpZyk7XG4gICAgICBjb25zdCBpZHggPSBjb25maWcuaW5kZXhOYW1lITtcblxuICAgICAgLy8gR2V0IHRoZSBpbmRleCBpbnN0YW5jZVxuICAgICAgY29uc3QgaW5kZXggPSB0aGlzLmNsaWVudC5pbmRleChpZHgpO1xuXG4gICAgICAvLyBQcmVwYXJlIG5ldyBzZXR0aW5ncyBmcm9tIGNvbmZpZ1xuICAgICAgY29uc3QgbmV3U2V0dGluZ3MgPSB7XG4gICAgICAgIC4uLmNvbmZpZy5zZXR0aW5ncyxcbiAgICAgICAgLi4uY29uZmlnLm1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncyxcbiAgICAgIH07XG5cbiAgICAgIC8vIE9ubHkgdXBkYXRlIGlmIHdlIGhhdmUgc2V0dGluZ3MgdG8gYXBwbHlcbiAgICAgIGlmIChuZXdTZXR0aW5ncyAmJiBPYmplY3Qua2V5cyhuZXdTZXR0aW5ncykubGVuZ3RoID4gMCkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgVXBkYXRpbmcgaW5kZXggc2V0dGluZ3MgZm9yICR7aWR4fWApO1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZUluZGV4U2V0dGluZ3MoaWR4LCBuZXdTZXR0aW5ncywgc3luY2hyb25vdXMpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gaW5kZXg7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKGBGYWlsZWQgdG8gZW5zdXJlIGluZGV4IHNldHRpbmdzOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBlcnJvciB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZXRFeHBlcmltZW50YWxGZWF0dXJlc1N0YXR1cyhmZWF0dXJlczoge1xuICAgIG1ldHJpY3M6IGJvb2xlYW4sXG4gICAgbG9nc1JvdXRlOiBib29sZWFuLFxuICAgIGNvbnRhaW5zRmlsdGVyOiBib29sZWFuLFxuICAgIGVkaXREb2N1bWVudHNCeUZ1bmN0aW9uOiBib29sZWFuLFxuICAgIG5ldHdvcms6IGJvb2xlYW5cbiAgfSkge1xuICAgIC8vIFBBVENIIC9leHBlcmltZW50YWwtZmVhdHVyZXNcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2xpZW50Lmh0dHBSZXF1ZXN0LnBhdGNoKHtcbiAgICAgIHBhdGg6IGAvZXhwZXJpbWVudGFsLWZlYXR1cmVzYCxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgLi4uZmVhdHVyZXNcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIGFzeW5jIGdldEV4cGVyaW1lbnRhbEZlYXR1cmVzKCkge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC5nZXRFeHBlcmltZW50YWxGZWF0dXJlcygpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgb3IgY3JlYXRlcyBhbiBpbmRleCBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIGNvbmZpZ1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBnZXRJbmRleChjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnRXh0KTogUHJvbWlzZTxJbmRleD4ge1xuICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgICBjb25zdCBpZHggPSBjb25maWcuaW5kZXhOYW1lITtcbiAgICBpZiAoIXRoaXMuaW5kaWNlcy5oYXMoaWR4KSkge1xuICAgICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmluaXRJbmRleChjb25maWcsIHRydWUpO1xuICAgICAgdGhpcy5pbmRpY2VzLnNldChpZHgsIGluZGV4KTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuaW5kaWNlcy5nZXQoaWR4KSE7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgYW4gaW5kZXggZXhpc3RzXG4gICAqL1xuICBhc3luYyBpbmRleEV4aXN0cyhpbmRleE5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNsaWVudC5nZXRJbmRleChpbmRleE5hbWUpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAvLyB0aGlzLmxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNoZWNrIGlmIGluZGV4ICR7aW5kZXhOYW1lfSBleGlzdHM6ICR7ZXJyfWApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgaW5mb3JtYXRpb24gYWJvdXQgYW4gaW5kZXhcbiAgICovXG4gIGFzeW5jIGdldEluZGV4SW5mbyhpbmRleE5hbWU6IHN0cmluZykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jbGllbnQuZ2V0SW5kZXgoaW5kZXhOYW1lKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGdldCBpbmRleCBpbmZvOiAke2Vycn1gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IGluZGV4IHN0YXRzXG4gICAqL1xuICBhc3luYyBnZXRJbmRleFN0YXRzKGluZGV4TmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIHJldHVybiBhd2FpdCBpbmRleC5nZXRTdGF0cygpO1xuICB9XG5cbiAgLyoqXG4gICAqIExpc3QgYWxsIGF2YWlsYWJsZSBpbmRpY2VzXG4gICAqL1xuICBhc3luYyBsaXN0SW5kaWNlcyhsaW1pdD86IG51bWJlciwgb2Zmc2V0PzogbnVtYmVyKSB7XG4gICAgLy8gVXNlIGEgaGlnaGVyIGxpbWl0IHRvIGVuc3VyZSB3ZSBnZXQgYWxsIGluZGljZXMsIGluY2x1ZGluZyB0ZXN0IGluZGljZXNcbiAgICBjb25zdCBvcHRpb25zID0gbGltaXQgPyB7IGxpbWl0LCBvZmZzZXQ6IG9mZnNldCB8fCAwIH0gOiB7IGxpbWl0OiAxMDAwIH07XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2xpZW50LmdldEluZGV4ZXMob3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyBkZWxldGVJbmRleChpbmRleE5hbWU6IHN0cmluZywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC5kZWxldGVJbmRleChpbmRleE5hbWUpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgdGhpcy5pbmRpY2VzLmRlbGV0ZShpbmRleE5hbWUpO1xuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBpbmRleCBzZXR0aW5nc1xuICAgKi9cbiAgYXN5bmMgdXBkYXRlSW5kZXhTZXR0aW5ncyhpbmRleE5hbWU6IHN0cmluZywgc2V0dGluZ3M6IE1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXgudXBkYXRlU2V0dGluZ3Moc2V0dGluZ3MpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogUmVzZXQgaW5kZXggc2V0dGluZ3MgdG8gZGVmYXVsdFxuICAgKi9cbiAgYXN5bmMgcmVzZXRJbmRleFNldHRpbmdzKGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5yZXNldFNldHRpbmdzKCk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgaW5kZXggc2V0dGluZ3NcbiAgICovXG4gIGFzeW5jIGdldEluZGV4U2V0dGluZ3MoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPE1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncz4ge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICByZXR1cm4gYXdhaXQgaW5kZXguZ2V0U2V0dGluZ3MoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRmlsdGVyYWJsZUF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVGaWx0ZXJhYmxlQXR0cmlidXRlcyhhdHRyaWJ1dGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHNvcnRhYmxlIGF0dHJpYnV0ZXMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVTb3J0YWJsZUF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTb3J0YWJsZUF0dHJpYnV0ZXMoYXR0cmlidXRlcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU2VhcmNoYWJsZUF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTZWFyY2hhYmxlQXR0cmlidXRlcyhhdHRyaWJ1dGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBkaXNwbGF5ZWQgYXR0cmlidXRlcyBmb3IgYW4gaW5kZXhcbiAgICovXG4gIGFzeW5jIHVwZGF0ZURpc3BsYXllZEF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVEaXNwbGF5ZWRBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHN5bm9ueW1zIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU3lub255bXMoaW5kZXhOYW1lOiBzdHJpbmcsIHN5bm9ueW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZVN5bm9ueW1zKHN5bm9ueW1zKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBzdG9wIHdvcmRzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU3RvcFdvcmRzKGluZGV4TmFtZTogc3RyaW5nLCBzdG9wV29yZHM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTdG9wV29yZHMoc3RvcFdvcmRzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSByYW5raW5nIHJ1bGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlUmFua2luZ1J1bGVzKGluZGV4TmFtZTogc3RyaW5nLCByYW5raW5nUnVsZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVSYW5raW5nUnVsZXMocmFua2luZ1J1bGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFN3YXAgdHdvIGluZGV4ZXNcbiAgICovXG4gIGFzeW5jIHN3YXBJbmRleGVzKGluZGV4U3dhcHM6IEluZGV4U3dhcFtdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuY2xpZW50LnN3YXBJbmRleGVzKGluZGV4U3dhcHMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogQWRkIG9yIHJlcGxhY2UgZG9jdW1lbnRzIGluIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyBpbmRleERvY3VtZW50czxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZG9jczogVFtdLFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICAgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZVxuICApIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoY29uZmlnKTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXguYWRkRG9jdW1lbnRzKGRvY3MpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGRvY3VtZW50cyBpbiBiYXRjaGVzXG4gICAqL1xuICBhc3luYyBpbmRleEluQmF0Y2hlczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZG9jczogVFtdLFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICAgYmF0Y2hTaXplOiBudW1iZXIgPSAxMDAwLFxuICAgIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2VcbiAgKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KGNvbmZpZyk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRvY3MubGVuZ3RoOyBpICs9IGJhdGNoU2l6ZSkge1xuICAgICAgY29uc3QgYmF0Y2ggPSBkb2NzLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuICAgICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LmFkZERvY3VtZW50cyhiYXRjaCk7XG4gICAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGV4aXN0aW5nIGRvY3VtZW50cyAocGFydGlhbCB1cGRhdGUgdGhhdCBwcmVzZXJ2ZXMgZXhpc3RpbmcgZmllbGRzKVxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkb2NzOiBUW10sXG4gICAgY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyxcbiAgICBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlXG4gICkge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleChjb25maWcpO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVEb2N1bWVudHMoZG9jcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgZG9jdW1lbnRzIGluIGJhdGNoZXNcbiAgICovXG4gIGFzeW5jIHVwZGF0ZURvY3VtZW50c0luQmF0Y2hlczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZG9jczogVFtdLFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICAgYmF0Y2hTaXplOiBudW1iZXIgPSAxMDAwLFxuICAgIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2VcbiAgKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KGNvbmZpZyk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRvY3MubGVuZ3RoOyBpICs9IGJhdGNoU2l6ZSkge1xuICAgICAgY29uc3QgYmF0Y2ggPSBkb2NzLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuICAgICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZURvY3VtZW50cyhiYXRjaCk7XG4gICAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IGEgZG9jdW1lbnQgYnkgSURcbiAgICovXG4gIGFzeW5jIGdldERvY3VtZW50PFQgZXh0ZW5kcyBSZWNvcmRBbnk+KGlkOiBzdHJpbmcsIGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTxUPiB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIHJldHVybiBhd2FpdCBpbmRleC5nZXREb2N1bWVudDxUPihpZCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGRvY3VtZW50cyB3aXRoIGZpbHRlcmluZyBvcHRpb25zXG4gICAqL1xuICBhc3luYyBnZXREb2N1bWVudHM8VCBleHRlbmRzIFJlY29yZEFueT4oaW5kZXhOYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiBEb2N1bWVudHNRdWVyeTxUPik6IFByb21pc2U8VFtdPiB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGluZGV4LmdldERvY3VtZW50czxUPihvcHRpb25zKTtcbiAgICByZXR1cm4gcmVzdWx0LnJlc3VsdHM7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIGRvY3VtZW50cyBieSBJRFxuICAgKi9cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzKGlkczogc3RyaW5nW10sIGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgaWYgKCFpbmRleE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkluZGV4IG5hbWUgaXMgcmVxdWlyZWQgZm9yIGRlbGV0ZSBvcGVyYXRpb25cIik7XG4gICAgfVxuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXguZGVsZXRlRG9jdW1lbnRzKGlkcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgYWxsIGRvY3VtZW50cyBpbiBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgZGVsZXRlQWxsRG9jdW1lbnRzKGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5kZWxldGVBbGxEb2N1bWVudHMoKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBkb2N1bWVudHMgYnkgZmlsdGVyXG4gICAqL1xuICBhc3luYyBkZWxldGVEb2N1bWVudHNCeUZpbHRlcihmaWx0ZXI6IFNlYXJjaFF1ZXJ5WyAnZmlsdGVycycgXSwgaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBpZiAoIWluZGV4TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW5kZXggbmFtZSBpcyByZXF1aXJlZCBmb3IgZGVsZXRlQnlGaWx0ZXIgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlPGFueT4oKTtcbiAgICBhcHBseUZpbHRlcnMoYnVpbGRlciwgZmlsdGVyKTtcbiAgICBjb25zdCB7IG9wdGlvbnMgfSA9IGJ1aWxkZXIuYnVpbGQoKTtcblxuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5kZWxldGVEb2N1bWVudHMoeyBmaWx0ZXI6IG9wdGlvbnMuZmlsdGVyISB9KTtcblxuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBzbmFwc2hvdFxuICAgKi9cbiAgYXN5bmMgY3JlYXRlU25hcHNob3Qoc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdDcmVhdGluZyBzbmFwc2hvdC4uLicsIHsgc3luY2hyb25vdXMgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC5jcmVhdGVTbmFwc2hvdCgpO1xuICAgICAgXG4gICAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnV2FpdGluZyBmb3Igc25hcHNob3QgdGFzayB0byBjb21wbGV0ZS4uLicpO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NuYXBzaG90IGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5JywgeyByZXN1bHQgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHByb21pc2U7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdTbmFwc2hvdCBjcmVhdGlvbiB0YXNrIHN0YXJ0ZWQnLCB7IHJlc3VsdCB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgc25hcHNob3QnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlLCBzdGFjazogZXJyb3Iuc3RhY2sgfSk7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgc25hcHNob3Q6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVycm9yIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBkdW1wXG4gICAqL1xuICBhc3luYyBjcmVhdGVEdW1wKHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5jbGllbnQuY3JlYXRlRHVtcCgpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgc2VydmVyIGhlYWx0aFxuICAgKi9cbiAgYXN5bmMgaGVhbHRoPFQgZXh0ZW5kcyBhbnk+KCk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5oZWFsdGgoKSBhcyBUO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHNlcnZlciBpcyBoZWFsdGh5XG4gICAqL1xuICBhc3luYyBpc0hlYWx0aHkoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xpZW50LmhlYWx0aCgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgc2VydmVyIHN0YXRzXG4gICAqL1xuICBhc3luYyBnZXRTdGF0czxUIGV4dGVuZHMgYW55ID0gYW55PigpOiBQcm9taXNlPFQ+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jbGllbnQuZ2V0U3RhdHMoKSBhcyBUO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZXJ2ZXIgdmVyc2lvblxuICAgKi9cbiAgYXN5bmMgZ2V0VmVyc2lvbigpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5nZXRWZXJzaW9uKCk7XG4gIH1cblxuICAvKipcbiAgICogU2VhcmNoIGFuIGluZGV4IHdpdGggYWR2YW5jZWQgb3B0aW9uc1xuICAgKi9cbiAgYXN5bmMgc2VhcmNoPFQ+KFxuICAgIHF1ZXJ5OiBTZWFyY2hRdWVyeSxcbiAgICBjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnLFxuICApOiBQcm9taXNlPFNlYXJjaFJlc3VsdDxUPj4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoY29uZmlnKTtcbiAgICAgIGNvbnN0IG1laWxpU2VhcmNoUXVlcnkgPSBidWlsZE1laWxpU2VhcmNoUXVlcnkocXVlcnkpO1xuICAgICAgY29uc3QgeyBxOiBxUGFyYW0sIG9wdGlvbnMgfSA9IG1laWxpU2VhcmNoUXVlcnk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBpbmRleC5zZWFyY2gocVBhcmFtID8/IFwiXCIsIHtcbiAgICAgICAgLi4ub3B0aW9uc1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLnJlc3VsdHMsXG4gICAgICAgIGhpdHM6IHJlc3VsdHMuaGl0cyBhcyBUW10sXG4gICAgICAgIGZhY2V0czogcmVzdWx0cy5mYWNldERpc3RyaWJ1dGlvbixcbiAgICAgICAgZmFjZXRTdGF0czogcmVzdWx0cy5mYWNldFN0YXRzLFxuICAgICAgICB0b3RhbDogcmVzdWx0cy5lc3RpbWF0ZWRUb3RhbEhpdHMgPz8gKHJlc3VsdHMgYXMgYW55KS50b3RhbEhpdHMsXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNcyxcbiAgICAgICAgcXVlcnk6IHJlc3VsdHMucXVlcnksXG4gICAgICAgIC4uLigocmVzdWx0cyBhcyBhbnkpLnBhZ2UgIT09IHVuZGVmaW5lZCAmJiB7XG4gICAgICAgICAgcGFnZTogKHJlc3VsdHMgYXMgYW55KS5wYWdlLFxuICAgICAgICAgIGhpdHNQZXJQYWdlOiAocmVzdWx0cyBhcyBhbnkpLmhpdHNQZXJQYWdlLFxuICAgICAgICAgIHRvdGFsUGFnZXM6IChyZXN1bHRzIGFzIGFueSkudG90YWxQYWdlc1xuICAgICAgICB9KVxuICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBTZWFyY2hRdWVyeUVycm9yKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKGBTZWFyY2ggb3BlcmF0aW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWAsIHsgZXJyb3IgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gYSBtdWx0aS1zZWFyY2ggcXVlcnlcbiAgICovXG4gIGFzeW5jIG11bHRpU2VhcmNoPFQgZXh0ZW5kcyBhbnk+KHF1ZXJpZXM6IEFycmF5PHtcbiAgICBpbmRleFVpZDogc3RyaW5nO1xuICAgIHF1ZXJ5OiBzdHJpbmc7XG4gICAgc2VhcmNoUGFyYW1zPzogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgfT4pIHtcblxuICAgIC8vIE1hcCB0aGUgaW5wdXQgcXVlcmllcyB0byB0aGUgZm9ybWF0IGV4cGVjdGVkIGJ5IHRoZSBNZWlsaVNlYXJjaCBjbGllbnRcbiAgICBjb25zdCBtZWlsaVF1ZXJpZXMgPSBxdWVyaWVzLm1hcChxID0+ICh7XG4gICAgICBpbmRleFVpZDogcS5pbmRleFVpZCxcbiAgICAgIHE6IHEucXVlcnksIC8vIE1laWxpU2VhcmNoIGNsaWVudCBleHBlY3RzICdxJyBpbnN0ZWFkIG9mICdxdWVyeSdcbiAgICAgIC4uLnEuc2VhcmNoUGFyYW1zLCAvLyBTcHJlYWQgYW55IGFkZGl0aW9uYWwgc2VhcmNoIHBhcmFtZXRlcnNcbiAgICB9KSk7XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jbGllbnQubXVsdGlTZWFyY2goeyBxdWVyaWVzOiBtZWlsaVF1ZXJpZXMgfSkgYXMgVDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgQVBJIGtleXNcbiAgICovXG4gIGFzeW5jIGdldEtleXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LmdldEtleXMoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gQVBJIGtleVxuICAgKi9cbiAgYXN5bmMgZ2V0S2V5KGtleU9yVWlkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuZ2V0S2V5KGtleU9yVWlkKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYW4gQVBJIGtleVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlS2V5KG9wdGlvbnM6IEtleUNyZWF0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LmNyZWF0ZUtleShvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgYW4gQVBJIGtleVxuICAgKi9cbiAgYXN5bmMgdXBkYXRlS2V5KGtleU9yVWlkOiBzdHJpbmcsIG9wdGlvbnM6IEtleVVwZGF0ZSkge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC51cGRhdGVLZXkoa2V5T3JVaWQsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBhbiBBUEkga2V5XG4gICAqL1xuICBhc3luYyBkZWxldGVLZXkoa2V5T3JVaWQ6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC5kZWxldGVLZXkoa2V5T3JVaWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbCB0YXNrc1xuICAgKi9cbiAgYXN5bmMgY2FuY2VsVGFza3MocXVlcnk6IERlbGV0ZU9yQ2FuY2VsVGFza3NRdWVyeSkge1xuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC50YXNrcy5jYW5jZWxUYXNrcyhxdWVyeSk7XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgdGFza3NcbiAgICovXG4gIGFzeW5jIGRlbGV0ZVRhc2tzKHF1ZXJ5OiBEZWxldGVPckNhbmNlbFRhc2tzUXVlcnkpIHtcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5jbGllbnQudGFza3MuZGVsZXRlVGFza3MocXVlcnkpO1xuICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gIH1cblxuICAvKipcbiAgICogV2FpdCBmb3IgYSB0YXNrIHRvIGNvbXBsZXRlXG4gICAqL1xuICBhc3luYyB3YWl0Rm9yVGFzayh0YXNrSWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIgPSB0aGlzLnRhc2tUaW1lb3V0TXMpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQudGFza3Mud2FpdEZvclRhc2sodGFza0lkLCB7XG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXMsXG4gICAgICBpbnRlcnZhbDogMTAwLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBiYXRjaGVzXG4gICAqL1xuICBhc3luYyBnZXRCYXRjaGVzKHBhcmFtcz86IFRhc2tzT3JCYXRjaGVzUXVlcnkpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuYmF0Y2hlcy5nZXRCYXRjaGVzKHBhcmFtcyk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGEgc3BlY2lmaWMgYmF0Y2hcbiAgICovXG4gIGFzeW5jIGdldEJhdGNoKGJhdGNoVWlkOiBudW1iZXIpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuYmF0Y2hlcy5nZXRCYXRjaChiYXRjaFVpZCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgdmFsaWRhdGVDb25maWcoY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyk6IHZvaWQge1xuICAgIGlmICghY29uZmlnLmluZGV4TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaFF1ZXJ5RXJyb3IoJ0luZGV4IG5hbWUgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG4gIH1cbn0iXX0=