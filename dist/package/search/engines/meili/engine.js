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
    async listIndices() {
        return await this.client.getIndexes();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9lbmdpbmVzL21laWxpL2VuZ2luZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBeVM7QUFFelMsa0NBQTJDO0FBQzNDLG1EQUErQztBQUMvQyx1REFBb0Q7QUFDcEQsK0RBQWlFO0FBQ2pFLHlDQUFrSDtBQVNsSCxNQUFhLGlCQUFrQixTQUFRLHVCQUFnQjtJQUM3QyxNQUFNLENBQWM7SUFDcEIsT0FBTyxHQUFHLElBQUksR0FBRyxFQUFpQixDQUFDO0lBQ25DLGFBQWEsR0FBRyxLQUFLLENBQUMsQ0FBQyxpQ0FBaUM7SUFFaEUsWUFBWSxNQUF1QztRQUNqRCxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDZCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUkseUJBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN4QyxDQUFDO0lBRU0sU0FBUztRQUNkLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNyQixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQTRCLEVBQUUsY0FBdUIsS0FBSztRQUN4RSxJQUFJLENBQUM7WUFDSCxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQzVCLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxTQUFVLENBQUM7WUFFOUIsd0JBQXdCO1lBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztZQUN4QixJQUFJLENBQUM7Z0JBQ0gsV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUM1QyxDQUFDO1lBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxJQUFJLHlCQUFnQixDQUFDLG9DQUFvQyxHQUFHLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDbkYsQ0FBQztZQUVE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LENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBNEI7UUFDM0MsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDaEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFFBQVEsQ0FBQyxRQUFnQjtRQUM3QixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBRVMsY0FBYyxDQUFDLE1BQXlCO1FBQ2hELElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDdEIsTUFBTSxJQUFJLHlCQUFnQixDQUFDLHdCQUF3QixDQUFDLENBQUM7UUFDdkQsQ0FBQztJQUNILENBQUM7Q0FDRjtBQTFvQkQsOENBMG9CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERlbGV0ZU9yQ2FuY2VsVGFza3NRdWVyeSwgdHlwZSBEb2N1bWVudHNRdWVyeSwgdHlwZSBFbnF1ZXVlZFRhc2ssIHR5cGUgSW5kZXgsIHR5cGUgSW5kZXhTd2FwLCBLZXlDcmVhdGlvbiwgS2V5VXBkYXRlLCBNZWlsaVNlYXJjaCwgdHlwZSBDb25maWcgYXMgTWVpbGlTZWFyY2hDbGllbnRDb25maWcsIHR5cGUgU2V0dGluZ3MgYXMgTWVpbGlTZWFyY2hJbmRleFNldHRpbmdzLCB0eXBlIFJlY29yZEFueSwgVGFza3NPckJhdGNoZXNRdWVyeSwgdHlwZSBUYXNrU3RhdHVzIH0gZnJvbSBcIm1laWxpc2VhcmNoXCI7XG5pbXBvcnQgeyB0eXBlIFNlYXJjaEluZGV4Q29uZmlnLCB0eXBlIFNlYXJjaFF1ZXJ5LCB0eXBlIFNlYXJjaFJlc3VsdCB9IGZyb20gXCIuLi8uLi90eXBlc1wiO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gXCIuLi9iYXNlXCI7XG5pbXBvcnQgeyBRdWVyeUJ1aWxkZXIgfSBmcm9tIFwiLi9xdWVyeS1idWlsZGVyXCI7XG5pbXBvcnQgeyBhcHBseUZpbHRlcnMgfSBmcm9tIFwiLi91dGlscy9hcHBseUZJbHRlcnNcIjtcbmltcG9ydCB7IGJ1aWxkTWVpbGlTZWFyY2hRdWVyeSB9IGZyb20gXCIuL3V0aWxzL2J1aWxkU2VhcmNoUXVlcnlcIjtcbmltcG9ydCB7IFNlYXJjaEVuZ2luZUNvbm5lY3Rpb25FcnJvciwgU2VhcmNoRW5naW5lRXJyb3IsIFNlYXJjaEluZGV4RXJyb3IsIFNlYXJjaFF1ZXJ5RXJyb3IgfSBmcm9tIFwiLi4vLi4vZXJyb3JzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXh0ZW5kZWRNZWlsaVNlYXJjaENsaWVudENvbmZpZyBleHRlbmRzIE1laWxpU2VhcmNoQ2xpZW50Q29uZmlnIHtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZWFyY2hJbmRleENvbmZpZ0V4dCBleHRlbmRzIFNlYXJjaEluZGV4Q29uZmlnIHtcbiAgbWVpbGlTZWFyY2hJbmRleFNldHRpbmdzPzogTWVpbGlTZWFyY2hJbmRleFNldHRpbmdzXG59XG5cbmV4cG9ydCBjbGFzcyBNZWlsaVNlYXJjaEVuZ2luZSBleHRlbmRzIEJhc2VTZWFyY2hFbmdpbmUge1xuICBwcml2YXRlIGNsaWVudDogTWVpbGlTZWFyY2g7XG4gIHByaXZhdGUgaW5kaWNlcyA9IG5ldyBNYXA8c3RyaW5nLCBJbmRleD4oKTtcbiAgcHJpdmF0ZSB0YXNrVGltZW91dE1zID0gMzAwMDA7IC8vIERlZmF1bHQgdGltZW91dCBmb3IgdGFza3M6IDMwc1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogRXh0ZW5kZWRNZWlsaVNlYXJjaENsaWVudENvbmZpZykge1xuICAgIHN1cGVyKGNvbmZpZyk7XG4gICAgdGhpcy5jbGllbnQgPSBuZXcgTWVpbGlTZWFyY2goY29uZmlnKTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRDbGllbnQoKTogTWVpbGlTZWFyY2gge1xuICAgIHJldHVybiB0aGlzLmNsaWVudDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGluZGV4IHdpdGggdGhlIHByb3ZpZGVkIGNvbmZpZ3VyYXRpb24gb3IgZW5zdXJlcyBleGlzdGluZyBpbmRleCBoYXMgY29ycmVjdCBzZXR0aW5nc1xuICAgKi9cbiAgYXN5bmMgaW5pdEluZGV4KGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWdFeHQsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICB0cnkge1xuICAgICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICAgICAgY29uc3QgaWR4ID0gY29uZmlnLmluZGV4TmFtZSE7XG5cbiAgICAgIC8vIENoZWNrIGlmIGluZGV4IGV4aXN0c1xuICAgICAgbGV0IGluZGV4RXhpc3RzID0gZmFsc2U7XG4gICAgICB0cnkge1xuICAgICAgICBpbmRleEV4aXN0cyA9IGF3YWl0IHRoaXMuaW5kZXhFeGlzdHMoaWR4KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFNlYXJjaEluZGV4RXJyb3IoYEZhaWxlZCB0byBjaGVjayBpbmRleCBleGlzdGVuY2U6ICR7aWR4fWAsIHsgZXJyb3IgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGluZGV4IGRvZXNuJ3QgZXhpc3QsIGNyZWF0ZSBpdFxuICAgICAgaWYgKCFpbmRleEV4aXN0cykge1xuXG4gICAgICAgIGNvbnN0IGNyZWF0ZU9wdGlvbnM6IHsgcHJpbWFyeUtleT86IHN0cmluZyB9ID0ge307XG4gICAgICAgIGNyZWF0ZU9wdGlvbnMucHJpbWFyeUtleSA9IGNvbmZpZy5wcmltYXJ5S2V5ID8gY29uZmlnLnByaW1hcnlLZXkgYXMgc3RyaW5nIDogJ2lkJztcblxuICAgICAgICBjb25zdCBwcm9taXNlID0gdGhpcy5jbGllbnQuY3JlYXRlSW5kZXgoaWR4LCBjcmVhdGVPcHRpb25zKTtcblxuICAgICAgICBpZiAoIXByb21pc2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgU2VhcmNoSW5kZXhFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBpbmRleCAke2lkeH1gKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBXYWl0IGZvciB0aGUgY3JlYXRpb24gdGFzayB0byBjb21wbGV0ZSAocmVxdWlyZWQgYmVmb3JlIHdlIGNhbiB1cGRhdGUgc2V0dGluZ3MpXG4gICAgICAgIGNvbnN0IHRhc2sgPSBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEVuc3VyZSBzZXR0aW5ncyBhcmUgY29ycmVjdGx5IGFwcGxpZWQgZm9yIGJvdGggbmV3IGFuZCBleGlzdGluZyBpbmRpY2VzXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbnN1cmVJbmRleFNldHRpbmdzKGNvbmZpZywgc3luY2hyb25vdXMpO1xuXG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuXG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBTZWFyY2hJbmRleEVycm9yKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuXG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGluZGV4OiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBlcnJvciB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBpbmRleCBzZXR0aW5ncyBhcmUgY29ycmVjdCB3aXRoIHRoZSBwcm92aWRlZCBjb25maWcgYW5kIHVwZGF0ZXMgaWYgbmVlZGVkXG4gICAqL1xuICBhc3luYyBlbnN1cmVJbmRleFNldHRpbmdzKGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWdFeHQsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICB0cnkge1xuICAgICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICAgICAgY29uc3QgaWR4ID0gY29uZmlnLmluZGV4TmFtZSE7XG5cbiAgICAgIC8vIEdldCB0aGUgaW5kZXggaW5zdGFuY2VcbiAgICAgIGNvbnN0IGluZGV4ID0gdGhpcy5jbGllbnQuaW5kZXgoaWR4KTtcblxuICAgICAgLy8gUHJlcGFyZSBuZXcgc2V0dGluZ3MgZnJvbSBjb25maWdcbiAgICAgIGNvbnN0IG5ld1NldHRpbmdzID0ge1xuICAgICAgICAuLi5jb25maWcuc2V0dGluZ3MsXG4gICAgICAgIC4uLmNvbmZpZy5tZWlsaVNlYXJjaEluZGV4U2V0dGluZ3MsXG4gICAgICB9O1xuXG4gICAgICAvLyBPbmx5IHVwZGF0ZSBpZiB3ZSBoYXZlIHNldHRpbmdzIHRvIGFwcGx5XG4gICAgICBpZiAobmV3U2V0dGluZ3MgJiYgT2JqZWN0LmtleXMobmV3U2V0dGluZ3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFVwZGF0aW5nIGluZGV4IHNldHRpbmdzIGZvciAke2lkeH1gKTtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVJbmRleFNldHRpbmdzKGlkeCwgbmV3U2V0dGluZ3MsIHN5bmNocm9ub3VzKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hFbmdpbmVFcnJvcihgRmFpbGVkIHRvIGVuc3VyZSBpbmRleCBzZXR0aW5nczogJHtlcnJvci5tZXNzYWdlfWAsIHsgZXJyb3IgfSk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2V0RXhwZXJpbWVudGFsRmVhdHVyZXNTdGF0dXMoZmVhdHVyZXM6IHtcbiAgICBtZXRyaWNzOiBib29sZWFuLFxuICAgIGxvZ3NSb3V0ZTogYm9vbGVhbixcbiAgICBjb250YWluc0ZpbHRlcjogYm9vbGVhbixcbiAgICBlZGl0RG9jdW1lbnRzQnlGdW5jdGlvbjogYm9vbGVhbixcbiAgICBuZXR3b3JrOiBib29sZWFuXG4gIH0pIHtcbiAgICAvLyBQQVRDSCAvZXhwZXJpbWVudGFsLWZlYXR1cmVzXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNsaWVudC5odHRwUmVxdWVzdC5wYXRjaCh7XG4gICAgICBwYXRoOiBgL2V4cGVyaW1lbnRhbC1mZWF0dXJlc2AsXG4gICAgICBib2R5OiB7XG4gICAgICAgIC4uLmZlYXR1cmVzXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBhc3luYyBnZXRFeHBlcmltZW50YWxGZWF0dXJlcygpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuZ2V0RXhwZXJpbWVudGFsRmVhdHVyZXMoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIG9yIGNyZWF0ZXMgYW4gaW5kZXggaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBjb25maWdcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZ2V0SW5kZXgoY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZ0V4dCk6IFByb21pc2U8SW5kZXg+IHtcbiAgICB0aGlzLnZhbGlkYXRlQ29uZmlnKGNvbmZpZyk7XG4gICAgY29uc3QgaWR4ID0gY29uZmlnLmluZGV4TmFtZSE7XG4gICAgaWYgKCF0aGlzLmluZGljZXMuaGFzKGlkeCkpIHtcbiAgICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5pbml0SW5kZXgoY29uZmlnLCB0cnVlKTtcbiAgICAgIHRoaXMuaW5kaWNlcy5zZXQoaWR4LCBpbmRleCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmluZGljZXMuZ2V0KGlkeCkhO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGFuIGluZGV4IGV4aXN0c1xuICAgKi9cbiAgYXN5bmMgaW5kZXhFeGlzdHMoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jbGllbnQuZ2V0SW5kZXgoaW5kZXhOYW1lKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLy8gdGhpcy5sb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjaGVjayBpZiBpbmRleCAke2luZGV4TmFtZX0gZXhpc3RzOiAke2Vycn1gKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IGluZm9ybWF0aW9uIGFib3V0IGFuIGluZGV4XG4gICAqL1xuICBhc3luYyBnZXRJbmRleEluZm8oaW5kZXhOYW1lOiBzdHJpbmcpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY2xpZW50LmdldEluZGV4KGluZGV4TmFtZSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBnZXQgaW5kZXggaW5mbzogJHtlcnJ9YCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBpbmRleCBzdGF0c1xuICAgKi9cbiAgYXN5bmMgZ2V0SW5kZXhTdGF0cyhpbmRleE5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICByZXR1cm4gYXdhaXQgaW5kZXguZ2V0U3RhdHMoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0IGFsbCBhdmFpbGFibGUgaW5kaWNlc1xuICAgKi9cbiAgYXN5bmMgbGlzdEluZGljZXMoKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2xpZW50LmdldEluZGV4ZXMoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgYW4gaW5kZXhcbiAgICovXG4gIGFzeW5jIGRlbGV0ZUluZGV4KGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuY2xpZW50LmRlbGV0ZUluZGV4KGluZGV4TmFtZSk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICB0aGlzLmluZGljZXMuZGVsZXRlKGluZGV4TmFtZSk7XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGluZGV4IHNldHRpbmdzXG4gICAqL1xuICBhc3luYyB1cGRhdGVJbmRleFNldHRpbmdzKGluZGV4TmFtZTogc3RyaW5nLCBzZXR0aW5nczogTWVpbGlTZWFyY2hJbmRleFNldHRpbmdzLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTZXR0aW5ncyhzZXR0aW5ncyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldCBpbmRleCBzZXR0aW5ncyB0byBkZWZhdWx0XG4gICAqL1xuICBhc3luYyByZXNldEluZGV4U2V0dGluZ3MoaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnJlc2V0U2V0dGluZ3MoKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBpbmRleCBzZXR0aW5nc1xuICAgKi9cbiAgYXN5bmMgZ2V0SW5kZXhTZXR0aW5ncyhpbmRleE5hbWU6IHN0cmluZyk6IFByb21pc2U8TWVpbGlTZWFyY2hJbmRleFNldHRpbmdzPiB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIHJldHVybiBhd2FpdCBpbmRleC5nZXRTZXR0aW5ncygpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBmaWx0ZXJhYmxlIGF0dHJpYnV0ZXMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVGaWx0ZXJhYmxlQXR0cmlidXRlcyhpbmRleE5hbWU6IHN0cmluZywgYXR0cmlidXRlczogc3RyaW5nW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZUZpbHRlcmFibGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgc29ydGFibGUgYXR0cmlidXRlcyBmb3IgYW4gaW5kZXhcbiAgICovXG4gIGFzeW5jIHVwZGF0ZVNvcnRhYmxlQXR0cmlidXRlcyhpbmRleE5hbWU6IHN0cmluZywgYXR0cmlidXRlczogc3RyaW5nW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZVNvcnRhYmxlQXR0cmlidXRlcyhhdHRyaWJ1dGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBzZWFyY2hhYmxlIGF0dHJpYnV0ZXMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVTZWFyY2hhYmxlQXR0cmlidXRlcyhpbmRleE5hbWU6IHN0cmluZywgYXR0cmlidXRlczogc3RyaW5nW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZVNlYXJjaGFibGVBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGRpc3BsYXllZCBhdHRyaWJ1dGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRGlzcGxheWVkQXR0cmlidXRlcyhpbmRleE5hbWU6IHN0cmluZywgYXR0cmlidXRlczogc3RyaW5nW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZURpc3BsYXllZEF0dHJpYnV0ZXMoYXR0cmlidXRlcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgc3lub255bXMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVTeW5vbnltcyhpbmRleE5hbWU6IHN0cmluZywgc3lub255bXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPiwgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXgudXBkYXRlU3lub255bXMoc3lub255bXMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHN0b3Agd29yZHMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVTdG9wV29yZHMoaW5kZXhOYW1lOiBzdHJpbmcsIHN0b3BXb3Jkczogc3RyaW5nW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZVN0b3BXb3JkcyhzdG9wV29yZHMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHJhbmtpbmcgcnVsZXMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVSYW5raW5nUnVsZXMoaW5kZXhOYW1lOiBzdHJpbmcsIHJhbmtpbmdSdWxlczogc3RyaW5nW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZVJhbmtpbmdSdWxlcyhyYW5raW5nUnVsZXMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogU3dhcCB0d28gaW5kZXhlc1xuICAgKi9cbiAgYXN5bmMgc3dhcEluZGV4ZXMoaW5kZXhTd2FwczogSW5kZXhTd2FwW10sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5jbGllbnQuc3dhcEluZGV4ZXMoaW5kZXhTd2Fwcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgb3IgcmVwbGFjZSBkb2N1bWVudHMgaW4gYW4gaW5kZXhcbiAgICovXG4gIGFzeW5jIGluZGV4RG9jdW1lbnRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkb2NzOiBUW10sXG4gICAgY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyxcbiAgICBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlXG4gICkge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleChjb25maWcpO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5hZGREb2N1bWVudHMoZG9jcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgZG9jdW1lbnRzIGluIGJhdGNoZXNcbiAgICovXG4gIGFzeW5jIGluZGV4SW5CYXRjaGVzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkb2NzOiBUW10sXG4gICAgY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyxcbiAgICBiYXRjaFNpemU6IG51bWJlciA9IDEwMDAsXG4gICAgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZVxuICApIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoY29uZmlnKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZG9jcy5sZW5ndGg7IGkgKz0gYmF0Y2hTaXplKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IGRvY3Muc2xpY2UoaSwgaSArIGJhdGNoU2l6ZSk7XG4gICAgICBjb25zdCBwcm9taXNlID0gaW5kZXguYWRkRG9jdW1lbnRzKGJhdGNoKTtcbiAgICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgICBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBwcm9taXNlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgZXhpc3RpbmcgZG9jdW1lbnRzIChwYXJ0aWFsIHVwZGF0ZSB0aGF0IHByZXNlcnZlcyBleGlzdGluZyBmaWVsZHMpXG4gICAqL1xuICBhc3luYyB1cGRhdGVEb2N1bWVudHM8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KFxuICAgIGRvY3M6IFRbXSxcbiAgICBjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnLFxuICAgIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2VcbiAgKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KGNvbmZpZyk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZURvY3VtZW50cyhkb2NzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBkb2N1bWVudHMgaW4gYmF0Y2hlc1xuICAgKi9cbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzSW5CYXRjaGVzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkb2NzOiBUW10sXG4gICAgY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyxcbiAgICBiYXRjaFNpemU6IG51bWJlciA9IDEwMDAsXG4gICAgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZVxuICApIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoY29uZmlnKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZG9jcy5sZW5ndGg7IGkgKz0gYmF0Y2hTaXplKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IGRvY3Muc2xpY2UoaSwgaSArIGJhdGNoU2l6ZSk7XG4gICAgICBjb25zdCBwcm9taXNlID0gaW5kZXgudXBkYXRlRG9jdW1lbnRzKGJhdGNoKTtcbiAgICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgICBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBwcm9taXNlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYSBkb2N1bWVudCBieSBJRFxuICAgKi9cbiAgYXN5bmMgZ2V0RG9jdW1lbnQ8VCBleHRlbmRzIFJlY29yZEFueT4oaWQ6IHN0cmluZywgaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFQ+IHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgcmV0dXJuIGF3YWl0IGluZGV4LmdldERvY3VtZW50PFQ+KGlkKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZG9jdW1lbnRzIHdpdGggZmlsdGVyaW5nIG9wdGlvbnNcbiAgICovXG4gIGFzeW5jIGdldERvY3VtZW50czxUIGV4dGVuZHMgUmVjb3JkQW55PihpbmRleE5hbWU6IHN0cmluZywgb3B0aW9ucz86IERvY3VtZW50c1F1ZXJ5PFQ+KTogUHJvbWlzZTxUW10+IHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaW5kZXguZ2V0RG9jdW1lbnRzPFQ+KG9wdGlvbnMpO1xuICAgIHJldHVybiByZXN1bHQucmVzdWx0cztcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgZG9jdW1lbnRzIGJ5IElEXG4gICAqL1xuICBhc3luYyBkZWxldGVEb2N1bWVudHMoaWRzOiBzdHJpbmdbXSwgaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBpZiAoIWluZGV4TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW5kZXggbmFtZSBpcyByZXF1aXJlZCBmb3IgZGVsZXRlIG9wZXJhdGlvblwiKTtcbiAgICB9XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5kZWxldGVEb2N1bWVudHMoaWRzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBhbGwgZG9jdW1lbnRzIGluIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyBkZWxldGVBbGxEb2N1bWVudHMoaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LmRlbGV0ZUFsbERvY3VtZW50cygpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIGRvY3VtZW50cyBieSBmaWx0ZXJcbiAgICovXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKGZpbHRlcjogU2VhcmNoUXVlcnlbICdmaWx0ZXJzJyBdLCBpbmRleE5hbWU6IHN0cmluZywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGlmICghaW5kZXhOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbmRleCBuYW1lIGlzIHJlcXVpcmVkIGZvciBkZWxldGVCeUZpbHRlciBvcGVyYXRpb25cIik7XG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuXG4gICAgY29uc3QgYnVpbGRlciA9IFF1ZXJ5QnVpbGRlci5jcmVhdGU8YW55PigpO1xuICAgIGFwcGx5RmlsdGVycyhidWlsZGVyLCBmaWx0ZXIpO1xuICAgIGNvbnN0IHsgb3B0aW9ucyB9ID0gYnVpbGRlci5idWlsZCgpO1xuXG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LmRlbGV0ZURvY3VtZW50cyh7IGZpbHRlcjogb3B0aW9ucy5maWx0ZXIhIH0pO1xuXG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHNuYXBzaG90XG4gICAqL1xuICBhc3luYyBjcmVhdGVTbmFwc2hvdChzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0NyZWF0aW5nIHNuYXBzaG90Li4uJywgeyBzeW5jaHJvbm91cyB9KTtcbiAgICAgIFxuICAgICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuY2xpZW50LmNyZWF0ZVNuYXBzaG90KCk7XG4gICAgICBcbiAgICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdXYWl0aW5nIGZvciBzbmFwc2hvdCB0YXNrIHRvIGNvbXBsZXRlLi4uJyk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnU25hcHNob3QgY3JlYXRlZCBzdWNjZXNzZnVsbHknLCB7IHJlc3VsdCB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcHJvbWlzZTtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NuYXBzaG90IGNyZWF0aW9uIHRhc2sgc3RhcnRlZCcsIHsgcmVzdWx0IH0pO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRmFpbGVkIHRvIGNyZWF0ZSBzbmFwc2hvdCcsIHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UsIHN0YWNrOiBlcnJvci5zdGFjayB9KTtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hFbmdpbmVFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBzbmFwc2hvdDogJHtlcnJvci5tZXNzYWdlfWAsIHsgZXJyb3IgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIGR1bXBcbiAgICovXG4gIGFzeW5jIGNyZWF0ZUR1bXAoc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC5jcmVhdGVEdW1wKCk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBzZXJ2ZXIgaGVhbHRoXG4gICAqL1xuICBhc3luYyBoZWFsdGg8VCBleHRlbmRzIGFueT4oKTogUHJvbWlzZTxUPiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2xpZW50LmhlYWx0aCgpIGFzIFQ7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgc2VydmVyIGlzIGhlYWx0aHlcbiAgICovXG4gIGFzeW5jIGlzSGVhbHRoeSgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jbGllbnQuaGVhbHRoKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZXJ2ZXIgc3RhdHNcbiAgICovXG4gIGFzeW5jIGdldFN0YXRzPFQgZXh0ZW5kcyBhbnkgPSBhbnk+KCk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5nZXRTdGF0cygpIGFzIFQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHNlcnZlciB2ZXJzaW9uXG4gICAqL1xuICBhc3luYyBnZXRWZXJzaW9uKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2xpZW50LmdldFZlcnNpb24oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWFyY2ggYW4gaW5kZXggd2l0aCBhZHZhbmNlZCBvcHRpb25zXG4gICAqL1xuICBhc3luYyBzZWFyY2g8VD4oXG4gICAgcXVlcnk6IFNlYXJjaFF1ZXJ5LFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICk6IFByb21pc2U8U2VhcmNoUmVzdWx0PFQ+PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleChjb25maWcpO1xuICAgICAgY29uc3QgbWVpbGlTZWFyY2hRdWVyeSA9IGJ1aWxkTWVpbGlTZWFyY2hRdWVyeShxdWVyeSk7XG4gICAgICBjb25zdCB7IHE6IHFQYXJhbSwgb3B0aW9ucyB9ID0gbWVpbGlTZWFyY2hRdWVyeTtcblxuICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGluZGV4LnNlYXJjaChxUGFyYW0gPz8gXCJcIiwge1xuICAgICAgICAuLi5vcHRpb25zXG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4ucmVzdWx0cyxcbiAgICAgICAgaGl0czogcmVzdWx0cy5oaXRzIGFzIFRbXSxcbiAgICAgICAgZmFjZXRzOiByZXN1bHRzLmZhY2V0RGlzdHJpYnV0aW9uLFxuICAgICAgICBmYWNldFN0YXRzOiByZXN1bHRzLmZhY2V0U3RhdHMsXG4gICAgICAgIHRvdGFsOiByZXN1bHRzLmVzdGltYXRlZFRvdGFsSGl0cyA/PyAocmVzdWx0cyBhcyBhbnkpLnRvdGFsSGl0cyxcbiAgICAgICAgcHJvY2Vzc2luZ1RpbWVNczogcmVzdWx0cy5wcm9jZXNzaW5nVGltZU1zLFxuICAgICAgICBxdWVyeTogcmVzdWx0cy5xdWVyeSxcbiAgICAgICAgLi4uKChyZXN1bHRzIGFzIGFueSkucGFnZSAhPT0gdW5kZWZpbmVkICYmIHtcbiAgICAgICAgICBwYWdlOiAocmVzdWx0cyBhcyBhbnkpLnBhZ2UsXG4gICAgICAgICAgaGl0c1BlclBhZ2U6IChyZXN1bHRzIGFzIGFueSkuaGl0c1BlclBhZ2UsXG4gICAgICAgICAgdG90YWxQYWdlczogKHJlc3VsdHMgYXMgYW55KS50b3RhbFBhZ2VzXG4gICAgICAgIH0pXG4gICAgICB9O1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFNlYXJjaFF1ZXJ5RXJyb3IpIHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYFNlYXJjaCBvcGVyYXRpb24gZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCwgeyBlcnJvciB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBhIG11bHRpLXNlYXJjaCBxdWVyeVxuICAgKi9cbiAgYXN5bmMgbXVsdGlTZWFyY2g8VCBleHRlbmRzIGFueT4ocXVlcmllczogQXJyYXk8e1xuICAgIGluZGV4VWlkOiBzdHJpbmc7XG4gICAgcXVlcnk6IHN0cmluZztcbiAgICBzZWFyY2hQYXJhbXM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuICB9Pikge1xuXG4gICAgLy8gTWFwIHRoZSBpbnB1dCBxdWVyaWVzIHRvIHRoZSBmb3JtYXQgZXhwZWN0ZWQgYnkgdGhlIE1laWxpU2VhcmNoIGNsaWVudFxuICAgIGNvbnN0IG1laWxpUXVlcmllcyA9IHF1ZXJpZXMubWFwKHEgPT4gKHtcbiAgICAgIGluZGV4VWlkOiBxLmluZGV4VWlkLFxuICAgICAgcTogcS5xdWVyeSwgLy8gTWVpbGlTZWFyY2ggY2xpZW50IGV4cGVjdHMgJ3EnIGluc3RlYWQgb2YgJ3F1ZXJ5J1xuICAgICAgLi4ucS5zZWFyY2hQYXJhbXMsIC8vIFNwcmVhZCBhbnkgYWRkaXRpb25hbCBzZWFyY2ggcGFyYW1ldGVyc1xuICAgIH0pKTtcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5tdWx0aVNlYXJjaCh7IHF1ZXJpZXM6IG1laWxpUXVlcmllcyB9KSBhcyBUO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBBUEkga2V5c1xuICAgKi9cbiAgYXN5bmMgZ2V0S2V5cygpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuZ2V0S2V5cygpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhbiBBUEkga2V5XG4gICAqL1xuICBhc3luYyBnZXRLZXkoa2V5T3JVaWQ6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC5nZXRLZXkoa2V5T3JVaWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhbiBBUEkga2V5XG4gICAqL1xuICBhc3luYyBjcmVhdGVLZXkob3B0aW9uczogS2V5Q3JlYXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuY3JlYXRlS2V5KG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBhbiBBUEkga2V5XG4gICAqL1xuICBhc3luYyB1cGRhdGVLZXkoa2V5T3JVaWQ6IHN0cmluZywgb3B0aW9uczogS2V5VXBkYXRlKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LnVwZGF0ZUtleShrZXlPclVpZCwgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIGFuIEFQSSBrZXlcbiAgICovXG4gIGFzeW5jIGRlbGV0ZUtleShrZXlPclVpZDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LmRlbGV0ZUtleShrZXlPclVpZCk7XG4gIH1cblxuICAvKipcbiAgICogQ2FuY2VsIHRhc2tzXG4gICAqL1xuICBhc3luYyBjYW5jZWxUYXNrcyhxdWVyeTogRGVsZXRlT3JDYW5jZWxUYXNrc1F1ZXJ5KSB7XG4gICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuY2xpZW50LnRhc2tzLmNhbmNlbFRhc2tzKHF1ZXJ5KTtcbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSB0YXNrc1xuICAgKi9cbiAgYXN5bmMgZGVsZXRlVGFza3MocXVlcnk6IERlbGV0ZU9yQ2FuY2VsVGFza3NRdWVyeSkge1xuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC50YXNrcy5kZWxldGVUYXNrcyhxdWVyeSk7XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0IGZvciBhIHRhc2sgdG8gY29tcGxldGVcbiAgICovXG4gIGFzeW5jIHdhaXRGb3JUYXNrKHRhc2tJZDogbnVtYmVyLCB0aW1lb3V0TXM6IG51bWJlciA9IHRoaXMudGFza1RpbWVvdXRNcykge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC50YXNrcy53YWl0Rm9yVGFzayh0YXNrSWQsIHtcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNcyxcbiAgICAgIGludGVydmFsOiAxMDAsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGJhdGNoZXNcbiAgICovXG4gIGFzeW5jIGdldEJhdGNoZXMocGFyYW1zPzogVGFza3NPckJhdGNoZXNRdWVyeSkge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC5iYXRjaGVzLmdldEJhdGNoZXMocGFyYW1zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYSBzcGVjaWZpYyBiYXRjaFxuICAgKi9cbiAgYXN5bmMgZ2V0QmF0Y2goYmF0Y2hVaWQ6IG51bWJlcikge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC5iYXRjaGVzLmdldEJhdGNoKGJhdGNoVWlkKTtcbiAgfVxuXG4gIHByb3RlY3RlZCB2YWxpZGF0ZUNvbmZpZyhjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnKTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcuaW5kZXhOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoUXVlcnlFcnJvcignSW5kZXggbmFtZSBpcyByZXF1aXJlZCcpO1xuICAgIH1cbiAgfVxufSJdfQ==