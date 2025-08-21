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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9lbmdpbmVzL21laWxpL2VuZ2luZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBeVM7QUFFelMsa0NBQTJDO0FBQzNDLG1EQUErQztBQUMvQyx1REFBb0Q7QUFDcEQsK0RBQWlFO0FBQ2pFLHlDQUFrSDtBQVNsSCxNQUFhLGlCQUFrQixTQUFRLHVCQUFnQjtJQUM3QyxNQUFNLENBQWM7SUFDcEIsT0FBTyxHQUFHLElBQUksR0FBRyxFQUFpQixDQUFDO0lBQ25DLGFBQWEsR0FBRyxLQUFLLENBQUMsQ0FBQyxpQ0FBaUM7SUFFaEUsWUFBWSxNQUF1QztRQUNqRCxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFZCw2REFBNkQ7UUFDN0QsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUMxQixNQUFNLElBQUksb0NBQTJCLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUN4RSxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLHlCQUFXLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDeEMsQ0FBQztJQUVNLFNBQVM7UUFDZCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDckIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUE0QixFQUFFLGNBQXVCLEtBQUs7UUFDeEUsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUM1QixNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsU0FBVSxDQUFDO1lBRTlCLHdCQUF3QjtZQUN4QixJQUFJLFdBQVcsR0FBRyxLQUFLLENBQUM7WUFDeEIsSUFBSSxDQUFDO2dCQUNILFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7WUFD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QixJQUFJLENBQUMsYUFBYTtRQUN0RSxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFNLEVBQUU7WUFDM0MsT0FBTyxFQUFFLFNBQVM7WUFDbEIsUUFBUSxFQUFFLEdBQUc7U0FDZCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQTRCO1FBQzNDLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxRQUFRLENBQUMsUUFBZ0I7UUFDN0IsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDaEQsQ0FBQztJQUVTLGNBQWMsQ0FBQyxNQUF5QjtRQUNoRCxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sSUFBSSx5QkFBZ0IsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFocEJELDhDQWdwQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEZWxldGVPckNhbmNlbFRhc2tzUXVlcnksIHR5cGUgRG9jdW1lbnRzUXVlcnksIHR5cGUgRW5xdWV1ZWRUYXNrLCB0eXBlIEluZGV4LCB0eXBlIEluZGV4U3dhcCwgS2V5Q3JlYXRpb24sIEtleVVwZGF0ZSwgTWVpbGlTZWFyY2gsIHR5cGUgQ29uZmlnIGFzIE1laWxpU2VhcmNoQ2xpZW50Q29uZmlnLCB0eXBlIFNldHRpbmdzIGFzIE1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncywgdHlwZSBSZWNvcmRBbnksIFRhc2tzT3JCYXRjaGVzUXVlcnksIHR5cGUgVGFza1N0YXR1cyB9IGZyb20gXCJtZWlsaXNlYXJjaFwiO1xuaW1wb3J0IHsgdHlwZSBTZWFyY2hJbmRleENvbmZpZywgdHlwZSBTZWFyY2hRdWVyeSwgdHlwZSBTZWFyY2hSZXN1bHQgfSBmcm9tIFwiLi4vLi4vdHlwZXNcIjtcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tIFwiLi4vYmFzZVwiO1xuaW1wb3J0IHsgUXVlcnlCdWlsZGVyIH0gZnJvbSBcIi4vcXVlcnktYnVpbGRlclwiO1xuaW1wb3J0IHsgYXBwbHlGaWx0ZXJzIH0gZnJvbSBcIi4vdXRpbHMvYXBwbHlGSWx0ZXJzXCI7XG5pbXBvcnQgeyBidWlsZE1laWxpU2VhcmNoUXVlcnkgfSBmcm9tIFwiLi91dGlscy9idWlsZFNlYXJjaFF1ZXJ5XCI7XG5pbXBvcnQgeyBTZWFyY2hFbmdpbmVDb25uZWN0aW9uRXJyb3IsIFNlYXJjaEVuZ2luZUVycm9yLCBTZWFyY2hJbmRleEVycm9yLCBTZWFyY2hRdWVyeUVycm9yIH0gZnJvbSBcIi4uLy4uL2Vycm9yc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEV4dGVuZGVkTWVpbGlTZWFyY2hDbGllbnRDb25maWcgZXh0ZW5kcyBNZWlsaVNlYXJjaENsaWVudENvbmZpZyB7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VhcmNoSW5kZXhDb25maWdFeHQgZXh0ZW5kcyBTZWFyY2hJbmRleENvbmZpZyB7XG4gIG1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncz86IE1laWxpU2VhcmNoSW5kZXhTZXR0aW5nc1xufVxuXG5leHBvcnQgY2xhc3MgTWVpbGlTZWFyY2hFbmdpbmUgZXh0ZW5kcyBCYXNlU2VhcmNoRW5naW5lIHtcbiAgcHJpdmF0ZSBjbGllbnQ6IE1laWxpU2VhcmNoO1xuICBwcml2YXRlIGluZGljZXMgPSBuZXcgTWFwPHN0cmluZywgSW5kZXg+KCk7XG4gIHByaXZhdGUgdGFza1RpbWVvdXRNcyA9IDMwMDAwOyAvLyBEZWZhdWx0IHRpbWVvdXQgZm9yIHRhc2tzOiAzMHNcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IEV4dGVuZGVkTWVpbGlTZWFyY2hDbGllbnRDb25maWcpIHtcbiAgICBzdXBlcihjb25maWcpO1xuICAgIFxuICAgIC8vIEJhc2ljIHZhbGlkYXRpb24gLSBsZXQgTWVpbGlTZWFyY2ggbGlicmFyeSBoYW5kbGUgdGhlIHJlc3RcbiAgICBpZiAoIWNvbmZpZz8uaG9zdD8udHJpbSgpKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lQ29ubmVjdGlvbkVycm9yKCdNZWlsaVNlYXJjaCBob3N0IGlzIHJlcXVpcmVkJyk7XG4gICAgfVxuICAgIFxuICAgIHRoaXMuY2xpZW50ID0gbmV3IE1laWxpU2VhcmNoKGNvbmZpZyk7XG4gIH1cblxuICBwdWJsaWMgZ2V0Q2xpZW50KCk6IE1laWxpU2VhcmNoIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQ7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyBpbmRleCB3aXRoIHRoZSBwcm92aWRlZCBjb25maWd1cmF0aW9uIG9yIGVuc3VyZXMgZXhpc3RpbmcgaW5kZXggaGFzIGNvcnJlY3Qgc2V0dGluZ3NcbiAgICovXG4gIGFzeW5jIGluaXRJbmRleChjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnRXh0LCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgICAgIGNvbnN0IGlkeCA9IGNvbmZpZy5pbmRleE5hbWUhO1xuXG4gICAgICAvLyBDaGVjayBpZiBpbmRleCBleGlzdHNcbiAgICAgIGxldCBpbmRleEV4aXN0cyA9IGZhbHNlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgaW5kZXhFeGlzdHMgPSBhd2FpdCB0aGlzLmluZGV4RXhpc3RzKGlkeCk7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHRocm93IG5ldyBTZWFyY2hJbmRleEVycm9yKGBGYWlsZWQgdG8gY2hlY2sgaW5kZXggZXhpc3RlbmNlOiAke2lkeH1gLCB7IGVycm9yIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBpbmRleCBkb2Vzbid0IGV4aXN0LCBjcmVhdGUgaXRcbiAgICAgIGlmICghaW5kZXhFeGlzdHMpIHtcblxuICAgICAgICBjb25zdCBjcmVhdGVPcHRpb25zOiB7IHByaW1hcnlLZXk/OiBzdHJpbmcgfSA9IHt9O1xuICAgICAgICBjcmVhdGVPcHRpb25zLnByaW1hcnlLZXkgPSBjb25maWcucHJpbWFyeUtleSA/IGNvbmZpZy5wcmltYXJ5S2V5IGFzIHN0cmluZyA6ICdpZCc7XG5cbiAgICAgICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuY2xpZW50LmNyZWF0ZUluZGV4KGlkeCwgY3JlYXRlT3B0aW9ucyk7XG5cbiAgICAgICAgaWYgKCFwcm9taXNlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFNlYXJjaEluZGV4RXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgaW5kZXggJHtpZHh9YCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIGNyZWF0aW9uIHRhc2sgdG8gY29tcGxldGUgKHJlcXVpcmVkIGJlZm9yZSB3ZSBjYW4gdXBkYXRlIHNldHRpbmdzKVxuICAgICAgICBjb25zdCB0YXNrID0gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgICAgfVxuXG4gICAgICAvLyBFbnN1cmUgc2V0dGluZ3MgYXJlIGNvcnJlY3RseSBhcHBsaWVkIGZvciBib3RoIG5ldyBhbmQgZXhpc3RpbmcgaW5kaWNlc1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5zdXJlSW5kZXhTZXR0aW5ncyhjb25maWcsIHN5bmNocm9ub3VzKTtcblxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcblxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgU2VhcmNoSW5kZXhFcnJvcikge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBpbmRleDogJHtlcnJvci5tZXNzYWdlfWAsIHsgZXJyb3IgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgaW5kZXggc2V0dGluZ3MgYXJlIGNvcnJlY3Qgd2l0aCB0aGUgcHJvdmlkZWQgY29uZmlnIGFuZCB1cGRhdGVzIGlmIG5lZWRlZFxuICAgKi9cbiAgYXN5bmMgZW5zdXJlSW5kZXhTZXR0aW5ncyhjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnRXh0LCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgICAgIGNvbnN0IGlkeCA9IGNvbmZpZy5pbmRleE5hbWUhO1xuXG4gICAgICAvLyBHZXQgdGhlIGluZGV4IGluc3RhbmNlXG4gICAgICBjb25zdCBpbmRleCA9IHRoaXMuY2xpZW50LmluZGV4KGlkeCk7XG5cbiAgICAgIC8vIFByZXBhcmUgbmV3IHNldHRpbmdzIGZyb20gY29uZmlnXG4gICAgICBjb25zdCBuZXdTZXR0aW5ncyA9IHtcbiAgICAgICAgLi4uY29uZmlnLnNldHRpbmdzLFxuICAgICAgICAuLi5jb25maWcubWVpbGlTZWFyY2hJbmRleFNldHRpbmdzLFxuICAgICAgfTtcblxuICAgICAgLy8gT25seSB1cGRhdGUgaWYgd2UgaGF2ZSBzZXR0aW5ncyB0byBhcHBseVxuICAgICAgaWYgKG5ld1NldHRpbmdzICYmIE9iamVjdC5rZXlzKG5ld1NldHRpbmdzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBVcGRhdGluZyBpbmRleCBzZXR0aW5ncyBmb3IgJHtpZHh9YCk7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlSW5kZXhTZXR0aW5ncyhpZHgsIG5ld1NldHRpbmdzLCBzeW5jaHJvbm91cyk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBpbmRleDtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYEZhaWxlZCB0byBlbnN1cmUgaW5kZXggc2V0dGluZ3M6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVycm9yIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNldEV4cGVyaW1lbnRhbEZlYXR1cmVzU3RhdHVzKGZlYXR1cmVzOiB7XG4gICAgbWV0cmljczogYm9vbGVhbixcbiAgICBsb2dzUm91dGU6IGJvb2xlYW4sXG4gICAgY29udGFpbnNGaWx0ZXI6IGJvb2xlYW4sXG4gICAgZWRpdERvY3VtZW50c0J5RnVuY3Rpb246IGJvb2xlYW4sXG4gICAgbmV0d29yazogYm9vbGVhblxuICB9KSB7XG4gICAgLy8gUEFUQ0ggL2V4cGVyaW1lbnRhbC1mZWF0dXJlc1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5jbGllbnQuaHR0cFJlcXVlc3QucGF0Y2goe1xuICAgICAgcGF0aDogYC9leHBlcmltZW50YWwtZmVhdHVyZXNgLFxuICAgICAgYm9keToge1xuICAgICAgICAuLi5mZWF0dXJlc1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG5cbiAgYXN5bmMgZ2V0RXhwZXJpbWVudGFsRmVhdHVyZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LmdldEV4cGVyaW1lbnRhbEZlYXR1cmVzKCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyBvciBjcmVhdGVzIGFuIGluZGV4IGluc3RhbmNlIGZvciB0aGUgZ2l2ZW4gY29uZmlnXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGdldEluZGV4KGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWdFeHQpOiBQcm9taXNlPEluZGV4PiB7XG4gICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuICAgIGNvbnN0IGlkeCA9IGNvbmZpZy5pbmRleE5hbWUhO1xuICAgIGlmICghdGhpcy5pbmRpY2VzLmhhcyhpZHgpKSB7XG4gICAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuaW5pdEluZGV4KGNvbmZpZywgdHJ1ZSk7XG4gICAgICB0aGlzLmluZGljZXMuc2V0KGlkeCwgaW5kZXgpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5pbmRpY2VzLmdldChpZHgpITtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBhbiBpbmRleCBleGlzdHNcbiAgICovXG4gIGFzeW5jIGluZGV4RXhpc3RzKGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xpZW50LmdldEluZGV4KGluZGV4TmFtZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIHRoaXMubG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2hlY2sgaWYgaW5kZXggJHtpbmRleE5hbWV9IGV4aXN0czogJHtlcnJ9YCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBpbmZvcm1hdGlvbiBhYm91dCBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgZ2V0SW5kZXhJbmZvKGluZGV4TmFtZTogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5nZXRJbmRleChpbmRleE5hbWUpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gZ2V0IGluZGV4IGluZm86ICR7ZXJyfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgaW5kZXggc3RhdHNcbiAgICovXG4gIGFzeW5jIGdldEluZGV4U3RhdHMoaW5kZXhOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgcmV0dXJuIGF3YWl0IGluZGV4LmdldFN0YXRzKCk7XG4gIH1cblxuICAvKipcbiAgICogTGlzdCBhbGwgYXZhaWxhYmxlIGluZGljZXNcbiAgICovXG4gIGFzeW5jIGxpc3RJbmRpY2VzKCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5nZXRJbmRleGVzKCk7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyBkZWxldGVJbmRleChpbmRleE5hbWU6IHN0cmluZywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC5kZWxldGVJbmRleChpbmRleE5hbWUpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgdGhpcy5pbmRpY2VzLmRlbGV0ZShpbmRleE5hbWUpO1xuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBpbmRleCBzZXR0aW5nc1xuICAgKi9cbiAgYXN5bmMgdXBkYXRlSW5kZXhTZXR0aW5ncyhpbmRleE5hbWU6IHN0cmluZywgc2V0dGluZ3M6IE1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXgudXBkYXRlU2V0dGluZ3Moc2V0dGluZ3MpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogUmVzZXQgaW5kZXggc2V0dGluZ3MgdG8gZGVmYXVsdFxuICAgKi9cbiAgYXN5bmMgcmVzZXRJbmRleFNldHRpbmdzKGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5yZXNldFNldHRpbmdzKCk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgaW5kZXggc2V0dGluZ3NcbiAgICovXG4gIGFzeW5jIGdldEluZGV4U2V0dGluZ3MoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPE1laWxpU2VhcmNoSW5kZXhTZXR0aW5ncz4ge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICByZXR1cm4gYXdhaXQgaW5kZXguZ2V0U2V0dGluZ3MoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgZmlsdGVyYWJsZSBhdHRyaWJ1dGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRmlsdGVyYWJsZUF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVGaWx0ZXJhYmxlQXR0cmlidXRlcyhhdHRyaWJ1dGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHNvcnRhYmxlIGF0dHJpYnV0ZXMgZm9yIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyB1cGRhdGVTb3J0YWJsZUF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTb3J0YWJsZUF0dHJpYnV0ZXMoYXR0cmlidXRlcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgc2VhcmNoYWJsZSBhdHRyaWJ1dGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU2VhcmNoYWJsZUF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTZWFyY2hhYmxlQXR0cmlidXRlcyhhdHRyaWJ1dGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBkaXNwbGF5ZWQgYXR0cmlidXRlcyBmb3IgYW4gaW5kZXhcbiAgICovXG4gIGFzeW5jIHVwZGF0ZURpc3BsYXllZEF0dHJpYnV0ZXMoaW5kZXhOYW1lOiBzdHJpbmcsIGF0dHJpYnV0ZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVEaXNwbGF5ZWRBdHRyaWJ1dGVzKGF0dHJpYnV0ZXMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHN5bm9ueW1zIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU3lub255bXMoaW5kZXhOYW1lOiBzdHJpbmcsIHN5bm9ueW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4sIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoeyBpbmRleE5hbWUgfSk7XG4gICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZVN5bm9ueW1zKHN5bm9ueW1zKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBzdG9wIHdvcmRzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlU3RvcFdvcmRzKGluZGV4TmFtZTogc3RyaW5nLCBzdG9wV29yZHM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVTdG9wV29yZHMoc3RvcFdvcmRzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSByYW5raW5nIHJ1bGVzIGZvciBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgdXBkYXRlUmFua2luZ1J1bGVzKGluZGV4TmFtZTogc3RyaW5nLCByYW5raW5nUnVsZXM6IHN0cmluZ1tdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVSYW5raW5nUnVsZXMocmFua2luZ1J1bGVzKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFN3YXAgdHdvIGluZGV4ZXNcbiAgICovXG4gIGFzeW5jIHN3YXBJbmRleGVzKGluZGV4U3dhcHM6IEluZGV4U3dhcFtdLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuY2xpZW50LnN3YXBJbmRleGVzKGluZGV4U3dhcHMpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogQWRkIG9yIHJlcGxhY2UgZG9jdW1lbnRzIGluIGFuIGluZGV4XG4gICAqL1xuICBhc3luYyBpbmRleERvY3VtZW50czxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZG9jczogVFtdLFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICAgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZVxuICApIHtcbiAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoY29uZmlnKTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXguYWRkRG9jdW1lbnRzKGRvY3MpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGRvY3VtZW50cyBpbiBiYXRjaGVzXG4gICAqL1xuICBhc3luYyBpbmRleEluQmF0Y2hlczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZG9jczogVFtdLFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICAgYmF0Y2hTaXplOiBudW1iZXIgPSAxMDAwLFxuICAgIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2VcbiAgKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KGNvbmZpZyk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRvY3MubGVuZ3RoOyBpICs9IGJhdGNoU2l6ZSkge1xuICAgICAgY29uc3QgYmF0Y2ggPSBkb2NzLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuICAgICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LmFkZERvY3VtZW50cyhiYXRjaCk7XG4gICAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGV4aXN0aW5nIGRvY3VtZW50cyAocGFydGlhbCB1cGRhdGUgdGhhdCBwcmVzZXJ2ZXMgZXhpc3RpbmcgZmllbGRzKVxuICAgKi9cbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzPFQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+PihcbiAgICBkb2NzOiBUW10sXG4gICAgY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyxcbiAgICBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlXG4gICkge1xuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleChjb25maWcpO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC51cGRhdGVEb2N1bWVudHMoZG9jcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgZG9jdW1lbnRzIGluIGJhdGNoZXNcbiAgICovXG4gIGFzeW5jIHVwZGF0ZURvY3VtZW50c0luQmF0Y2hlczxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55Pj4oXG4gICAgZG9jczogVFtdLFxuICAgIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcsXG4gICAgYmF0Y2hTaXplOiBudW1iZXIgPSAxMDAwLFxuICAgIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2VcbiAgKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KGNvbmZpZyk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRvY3MubGVuZ3RoOyBpICs9IGJhdGNoU2l6ZSkge1xuICAgICAgY29uc3QgYmF0Y2ggPSBkb2NzLnNsaWNlKGksIGkgKyBiYXRjaFNpemUpO1xuICAgICAgY29uc3QgcHJvbWlzZSA9IGluZGV4LnVwZGF0ZURvY3VtZW50cyhiYXRjaCk7XG4gICAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgcHJvbWlzZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IGEgZG9jdW1lbnQgYnkgSURcbiAgICovXG4gIGFzeW5jIGdldERvY3VtZW50PFQgZXh0ZW5kcyBSZWNvcmRBbnk+KGlkOiBzdHJpbmcsIGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTxUPiB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIHJldHVybiBhd2FpdCBpbmRleC5nZXREb2N1bWVudDxUPihpZCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGRvY3VtZW50cyB3aXRoIGZpbHRlcmluZyBvcHRpb25zXG4gICAqL1xuICBhc3luYyBnZXREb2N1bWVudHM8VCBleHRlbmRzIFJlY29yZEFueT4oaW5kZXhOYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiBEb2N1bWVudHNRdWVyeTxUPik6IFByb21pc2U8VFtdPiB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGluZGV4LmdldERvY3VtZW50czxUPihvcHRpb25zKTtcbiAgICByZXR1cm4gcmVzdWx0LnJlc3VsdHM7XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlIGRvY3VtZW50cyBieSBJRFxuICAgKi9cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzKGlkczogc3RyaW5nW10sIGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgaWYgKCFpbmRleE5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkluZGV4IG5hbWUgaXMgcmVxdWlyZWQgZm9yIGRlbGV0ZSBvcGVyYXRpb25cIik7XG4gICAgfVxuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcbiAgICBjb25zdCBwcm9taXNlID0gaW5kZXguZGVsZXRlRG9jdW1lbnRzKGlkcyk7XG4gICAgaWYgKHN5bmNocm9ub3VzKSB7XG4gICAgICByZXR1cm4gYXdhaXQgcHJvbWlzZS53YWl0VGFzaygpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgYWxsIGRvY3VtZW50cyBpbiBhbiBpbmRleFxuICAgKi9cbiAgYXN5bmMgZGVsZXRlQWxsRG9jdW1lbnRzKGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKSB7XG4gICAgY29uc3QgaW5kZXggPSBhd2FpdCB0aGlzLmdldEluZGV4KHsgaW5kZXhOYW1lIH0pO1xuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5kZWxldGVBbGxEb2N1bWVudHMoKTtcbiAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBwcm9taXNlO1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBkb2N1bWVudHMgYnkgZmlsdGVyXG4gICAqL1xuICBhc3luYyBkZWxldGVEb2N1bWVudHNCeUZpbHRlcihmaWx0ZXI6IFNlYXJjaFF1ZXJ5WyAnZmlsdGVycycgXSwgaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBpZiAoIWluZGV4TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW5kZXggbmFtZSBpcyByZXF1aXJlZCBmb3IgZGVsZXRlQnlGaWx0ZXIgb3BlcmF0aW9uXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGluZGV4ID0gYXdhaXQgdGhpcy5nZXRJbmRleCh7IGluZGV4TmFtZSB9KTtcblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBRdWVyeUJ1aWxkZXIuY3JlYXRlPGFueT4oKTtcbiAgICBhcHBseUZpbHRlcnMoYnVpbGRlciwgZmlsdGVyKTtcbiAgICBjb25zdCB7IG9wdGlvbnMgfSA9IGJ1aWxkZXIuYnVpbGQoKTtcblxuICAgIGNvbnN0IHByb21pc2UgPSBpbmRleC5kZWxldGVEb2N1bWVudHMoeyBmaWx0ZXI6IG9wdGlvbnMuZmlsdGVyISB9KTtcblxuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBzbmFwc2hvdFxuICAgKi9cbiAgYXN5bmMgY3JlYXRlU25hcHNob3Qoc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdDcmVhdGluZyBzbmFwc2hvdC4uLicsIHsgc3luY2hyb25vdXMgfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC5jcmVhdGVTbmFwc2hvdCgpO1xuICAgICAgXG4gICAgICBpZiAoc3luY2hyb25vdXMpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnV2FpdGluZyBmb3Igc25hcHNob3QgdGFzayB0byBjb21wbGV0ZS4uLicpO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NuYXBzaG90IGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5JywgeyByZXN1bHQgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHByb21pc2U7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdTbmFwc2hvdCBjcmVhdGlvbiB0YXNrIHN0YXJ0ZWQnLCB7IHJlc3VsdCB9KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgc25hcHNob3QnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlLCBzdGFjazogZXJyb3Iuc3RhY2sgfSk7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgc25hcHNob3Q6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVycm9yIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBkdW1wXG4gICAqL1xuICBhc3luYyBjcmVhdGVEdW1wKHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpIHtcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5jbGllbnQuY3JlYXRlRHVtcCgpO1xuICAgIGlmIChzeW5jaHJvbm91cykge1xuICAgICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2U7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgc2VydmVyIGhlYWx0aFxuICAgKi9cbiAgYXN5bmMgaGVhbHRoPFQgZXh0ZW5kcyBhbnk+KCk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5oZWFsdGgoKSBhcyBUO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIHNlcnZlciBpcyBoZWFsdGh5XG4gICAqL1xuICBhc3luYyBpc0hlYWx0aHkoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xpZW50LmhlYWx0aCgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgc2VydmVyIHN0YXRzXG4gICAqL1xuICBhc3luYyBnZXRTdGF0czxUIGV4dGVuZHMgYW55ID0gYW55PigpOiBQcm9taXNlPFQ+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jbGllbnQuZ2V0U3RhdHMoKSBhcyBUO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZXJ2ZXIgdmVyc2lvblxuICAgKi9cbiAgYXN5bmMgZ2V0VmVyc2lvbigpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmNsaWVudC5nZXRWZXJzaW9uKCk7XG4gIH1cblxuICAvKipcbiAgICogU2VhcmNoIGFuIGluZGV4IHdpdGggYWR2YW5jZWQgb3B0aW9uc1xuICAgKi9cbiAgYXN5bmMgc2VhcmNoPFQ+KFxuICAgIHF1ZXJ5OiBTZWFyY2hRdWVyeSxcbiAgICBjb25maWc6IFNlYXJjaEluZGV4Q29uZmlnLFxuICApOiBQcm9taXNlPFNlYXJjaFJlc3VsdDxUPj4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBpbmRleCA9IGF3YWl0IHRoaXMuZ2V0SW5kZXgoY29uZmlnKTtcbiAgICAgIGNvbnN0IG1laWxpU2VhcmNoUXVlcnkgPSBidWlsZE1laWxpU2VhcmNoUXVlcnkocXVlcnkpO1xuICAgICAgY29uc3QgeyBxOiBxUGFyYW0sIG9wdGlvbnMgfSA9IG1laWxpU2VhcmNoUXVlcnk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBpbmRleC5zZWFyY2gocVBhcmFtID8/IFwiXCIsIHtcbiAgICAgICAgLi4ub3B0aW9uc1xuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLnJlc3VsdHMsXG4gICAgICAgIGhpdHM6IHJlc3VsdHMuaGl0cyBhcyBUW10sXG4gICAgICAgIGZhY2V0czogcmVzdWx0cy5mYWNldERpc3RyaWJ1dGlvbixcbiAgICAgICAgZmFjZXRTdGF0czogcmVzdWx0cy5mYWNldFN0YXRzLFxuICAgICAgICB0b3RhbDogcmVzdWx0cy5lc3RpbWF0ZWRUb3RhbEhpdHMgPz8gKHJlc3VsdHMgYXMgYW55KS50b3RhbEhpdHMsXG4gICAgICAgIHByb2Nlc3NpbmdUaW1lTXM6IHJlc3VsdHMucHJvY2Vzc2luZ1RpbWVNcyxcbiAgICAgICAgcXVlcnk6IHJlc3VsdHMucXVlcnksXG4gICAgICAgIC4uLigocmVzdWx0cyBhcyBhbnkpLnBhZ2UgIT09IHVuZGVmaW5lZCAmJiB7XG4gICAgICAgICAgcGFnZTogKHJlc3VsdHMgYXMgYW55KS5wYWdlLFxuICAgICAgICAgIGhpdHNQZXJQYWdlOiAocmVzdWx0cyBhcyBhbnkpLmhpdHNQZXJQYWdlLFxuICAgICAgICAgIHRvdGFsUGFnZXM6IChyZXN1bHRzIGFzIGFueSkudG90YWxQYWdlc1xuICAgICAgICB9KVxuICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBTZWFyY2hRdWVyeUVycm9yKSB7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKGBTZWFyY2ggb3BlcmF0aW9uIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWAsIHsgZXJyb3IgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gYSBtdWx0aS1zZWFyY2ggcXVlcnlcbiAgICovXG4gIGFzeW5jIG11bHRpU2VhcmNoPFQgZXh0ZW5kcyBhbnk+KHF1ZXJpZXM6IEFycmF5PHtcbiAgICBpbmRleFVpZDogc3RyaW5nO1xuICAgIHF1ZXJ5OiBzdHJpbmc7XG4gICAgc2VhcmNoUGFyYW1zPzogUmVjb3JkPHN0cmluZywgYW55PjtcbiAgfT4pIHtcblxuICAgIC8vIE1hcCB0aGUgaW5wdXQgcXVlcmllcyB0byB0aGUgZm9ybWF0IGV4cGVjdGVkIGJ5IHRoZSBNZWlsaVNlYXJjaCBjbGllbnRcbiAgICBjb25zdCBtZWlsaVF1ZXJpZXMgPSBxdWVyaWVzLm1hcChxID0+ICh7XG4gICAgICBpbmRleFVpZDogcS5pbmRleFVpZCxcbiAgICAgIHE6IHEucXVlcnksIC8vIE1laWxpU2VhcmNoIGNsaWVudCBleHBlY3RzICdxJyBpbnN0ZWFkIG9mICdxdWVyeSdcbiAgICAgIC4uLnEuc2VhcmNoUGFyYW1zLCAvLyBTcHJlYWQgYW55IGFkZGl0aW9uYWwgc2VhcmNoIHBhcmFtZXRlcnNcbiAgICB9KSk7XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jbGllbnQubXVsdGlTZWFyY2goeyBxdWVyaWVzOiBtZWlsaVF1ZXJpZXMgfSkgYXMgVDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgQVBJIGtleXNcbiAgICovXG4gIGFzeW5jIGdldEtleXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LmdldEtleXMoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gQVBJIGtleVxuICAgKi9cbiAgYXN5bmMgZ2V0S2V5KGtleU9yVWlkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuZ2V0S2V5KGtleU9yVWlkKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYW4gQVBJIGtleVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlS2V5KG9wdGlvbnM6IEtleUNyZWF0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuY2xpZW50LmNyZWF0ZUtleShvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgYW4gQVBJIGtleVxuICAgKi9cbiAgYXN5bmMgdXBkYXRlS2V5KGtleU9yVWlkOiBzdHJpbmcsIG9wdGlvbnM6IEtleVVwZGF0ZSkge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC51cGRhdGVLZXkoa2V5T3JVaWQsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZSBhbiBBUEkga2V5XG4gICAqL1xuICBhc3luYyBkZWxldGVLZXkoa2V5T3JVaWQ6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNsaWVudC5kZWxldGVLZXkoa2V5T3JVaWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhbmNlbCB0YXNrc1xuICAgKi9cbiAgYXN5bmMgY2FuY2VsVGFza3MocXVlcnk6IERlbGV0ZU9yQ2FuY2VsVGFza3NRdWVyeSkge1xuICAgIGNvbnN0IHByb21pc2UgPSB0aGlzLmNsaWVudC50YXNrcy5jYW5jZWxUYXNrcyhxdWVyeSk7XG4gICAgcmV0dXJuIGF3YWl0IHByb21pc2Uud2FpdFRhc2soKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGUgdGFza3NcbiAgICovXG4gIGFzeW5jIGRlbGV0ZVRhc2tzKHF1ZXJ5OiBEZWxldGVPckNhbmNlbFRhc2tzUXVlcnkpIHtcbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5jbGllbnQudGFza3MuZGVsZXRlVGFza3MocXVlcnkpO1xuICAgIHJldHVybiBhd2FpdCBwcm9taXNlLndhaXRUYXNrKCk7XG4gIH1cblxuICAvKipcbiAgICogV2FpdCBmb3IgYSB0YXNrIHRvIGNvbXBsZXRlXG4gICAqL1xuICBhc3luYyB3YWl0Rm9yVGFzayh0YXNrSWQ6IG51bWJlciwgdGltZW91dE1zOiBudW1iZXIgPSB0aGlzLnRhc2tUaW1lb3V0TXMpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQudGFza3Mud2FpdEZvclRhc2sodGFza0lkLCB7XG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXMsXG4gICAgICBpbnRlcnZhbDogMTAwLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBiYXRjaGVzXG4gICAqL1xuICBhc3luYyBnZXRCYXRjaGVzKHBhcmFtcz86IFRhc2tzT3JCYXRjaGVzUXVlcnkpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuYmF0Y2hlcy5nZXRCYXRjaGVzKHBhcmFtcyk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGEgc3BlY2lmaWMgYmF0Y2hcbiAgICovXG4gIGFzeW5jIGdldEJhdGNoKGJhdGNoVWlkOiBudW1iZXIpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnQuYmF0Y2hlcy5nZXRCYXRjaChiYXRjaFVpZCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgdmFsaWRhdGVDb25maWcoY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyk6IHZvaWQge1xuICAgIGlmICghY29uZmlnLmluZGV4TmFtZSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaFF1ZXJ5RXJyb3IoJ0luZGV4IG5hbWUgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG4gIH1cbn0iXX0=