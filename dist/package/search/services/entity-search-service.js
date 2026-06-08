"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntitySearchService = void 0;
const base_search_service_1 = require("./base-search-service");
const batch_progress_1 = require("../../observability/utils/batch-progress");
class EntitySearchService extends base_search_service_1.BaseSearchService {
    entityService;
    searchEngine;
    constructor(entityService, searchEngine) {
        super(searchEngine);
        this.entityService = entityService;
        this.searchEngine = searchEngine;
    }
    getEntitySearchConfig() {
        return this.entityService.getEntitySearchConfig();
    }
    getSearchIndexConfig() {
        const searchConfig = this.getEntitySearchConfig();
        if (!searchConfig) {
            throw new Error('Search config not found');
        }
        if (!searchConfig.indexConfig) {
            searchConfig.indexConfig = {};
        }
        return searchConfig.indexConfig;
    }
    async search(query, searchIndexConfig = this.getSearchIndexConfig(), ctx) {
        return super.search(query, searchIndexConfig, ctx);
    }
    async syncToIndex(entity, searchIndexConfig = this.getSearchIndexConfig(), ctx, synchronous) {
        return super.syncToIndex(entity, searchIndexConfig, ctx, synchronous);
    }
    async deleteFromIndex(entityId, searchIndexConfig = this.getSearchIndexConfig(), ctx, synchronous) {
        return super.deleteFromIndex(entityId, searchIndexConfig, ctx, synchronous);
    }
    async bulkSync(entities, searchIndexConfig = this.getSearchIndexConfig(), ctx, synchronous) {
        return super.bulkSync(entities, searchIndexConfig, ctx, synchronous);
    }
    // extends EntitySchema<any, any, any> = EntitySchema<any, any, any>
    async transformDocumentForIndexing(entity) {
        const searchConfig = this.getEntitySearchConfig();
        // Use schema-defined transformer if available
        if (searchConfig?.documentTransformer) {
            this.logger.info('Using schema-defined document transformer', { entityName: this.entityService.getEntityName() });
            return await searchConfig.documentTransformer(entity);
        }
        return await super.transformDocumentForIndexing(entity);
    }
    /**
     * Resync all entity documents from database to search index.
     * Uses cursor-based pagination to handle large datasets efficiently.
     *
     * @param options.batchSize - Number of records to fetch per iteration (default: 50)
     * @param options.ctx - Execution context for the operation
     * @param options.maxIterations - Safety limit on number of iterations (default: 10000)
     */
    async resyncAllDocuments(options) {
        const { batchSize = 50, ctx, maxIterations = 10000 } = options || {};
        const searchConfig = this.getSearchIndexConfig();
        const entityName = this.entityService.getEntityName();
        let cursor = 'init';
        let iterationCount = 0;
        let processedCount = 0;
        let failedCount = 0;
        this.logger.info(`Starting resync for ${entityName}`);
        // Iterate through all records using cursor-based pagination
        while (cursor && iterationCount < maxIterations) {
            iterationCount++;
            // Fetch next batch
            const queryResult = await this.entityService.query({
                pagination: {
                    limit: batchSize,
                    cursor: cursor === 'init' ? undefined : cursor
                }
            }, ctx);
            if (!queryResult.data?.length) {
                break;
            }
            // Sync batch to search index
            const { summary } = await batch_progress_1.BatchProgress.all(`Resync ${entityName}`, queryResult.data, async (docs) => {
                await this.bulkSync(docs, searchConfig, ctx, true);
                return docs;
            }, {
                // Show progress on first iteration, then only errors
                observe: iterationCount === 1 ? 'progress' : 'errors',
                tags: { entity: entityName },
            });
            processedCount += summary.succeeded;
            failedCount += summary.failed;
            cursor = queryResult.cursor ?? undefined;
        }
        this.logger.info(`Resync completed for ${entityName}`, {
            processedCount,
            failedCount,
            iterations: iterationCount
        });
        return { processedCount, failedCount, totalIterations: iterationCount };
    }
}
exports.EntitySearchService = EntitySearchService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNlYXJjaC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zZXJ2aWNlcy9lbnRpdHktc2VhcmNoLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBSUEsK0RBQTBEO0FBQzFELDZFQUF5RTtBQUV6RSxNQUFhLG1CQUEyRCxTQUFRLHVDQUFpQjtJQUcxRTtJQUNBO0lBRnJCLFlBQ3FCLGFBQW1DLEVBQ25DLFlBQThCO1FBRWpELEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUhELGtCQUFhLEdBQWIsYUFBYSxDQUFzQjtRQUNuQyxpQkFBWSxHQUFaLFlBQVksQ0FBa0I7SUFHbkQsQ0FBQztJQUVTLHFCQUFxQjtRQUM3QixPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQztJQUNwRCxDQUFDO0lBRU0sb0JBQW9CO1FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQ2xELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFDN0MsQ0FBQztRQUVELElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDOUIsWUFBWSxDQUFDLFdBQVcsR0FBRyxFQUFFLENBQUM7UUFDaEMsQ0FBQztRQUVELE9BQU8sWUFBWSxDQUFDLFdBQVcsQ0FBQztJQUNsQyxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUEyQixFQUFFLGlCQUFpQixHQUFHLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLEdBQXNCO1FBQy9HLE9BQU8sS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQUMsTUFBcUMsRUFBRSxpQkFBaUIs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LEVBQUUsRUFBRTtnQkFDYixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBdUMsRUFBRSxZQUFZLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUN0RixPQUFPLElBQUksQ0FBQztZQUNkLENBQUMsRUFDRDtnQkFDRSxxREFBcUQ7Z0JBQ3JELE9BQU8sRUFBRSxjQUFjLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLFFBQVE7Z0JBQ3JELElBQUksRUFBRSxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUU7YUFDN0IsQ0FDRixDQUFDO1lBRUYsY0FBYyxJQUFJLE9BQU8sQ0FBQyxTQUFTLENBQUM7WUFDcEMsV0FBVyxJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUM7WUFDOUIsTUFBTSxHQUFHLFdBQVcsQ0FBQyxNQUFNLElBQUksU0FBUyxDQUFDO1FBQzNDLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsVUFBVSxFQUFFLEVBQUU7WUFDckQsY0FBYztZQUNkLFdBQVc7WUFDWCxVQUFVLEVBQUUsY0FBYztTQUMzQixDQUFDLENBQUM7UUFFSCxPQUFPLEVBQUUsY0FBYyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsY0FBYyxFQUFFLENBQUM7SUFDMUUsQ0FBQztDQUNGO0FBL0hELGtEQStIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHR5cGUgeyBCYXNlRW50aXR5U2VydmljZSwgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgdHlwZSB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzJztcbmltcG9ydCB0eXBlIHsgRW50aXR5U2VhcmNoUXVlcnksIFNlYXJjaFJlc3VsdCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi9iYXNlLXNlYXJjaC1zZXJ2aWNlJztcbmltcG9ydCB7IEJhdGNoUHJvZ3Jlc3MgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5L3V0aWxzL2JhdGNoLXByb2dyZXNzJztcblxuZXhwb3J0IGNsYXNzIEVudGl0eVNlYXJjaFNlcnZpY2U8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlU2VhcmNoU2VydmljZSB7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPFM+LFxuICAgIHByb3RlY3RlZCByZWFkb25seSBzZWFyY2hFbmdpbmU6IEJhc2VTZWFyY2hFbmdpbmUsXG4gICkge1xuICAgIHN1cGVyKHNlYXJjaEVuZ2luZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCkge1xuICAgIHJldHVybiB0aGlzLmVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG4gIH1cblxuICBwdWJsaWMgZ2V0U2VhcmNoSW5kZXhDb25maWcoKSB7XG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcbiAgICBpZiAoIXNlYXJjaENvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlnIG5vdCBmb3VuZCcpO1xuICAgIH1cblxuICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcgPSB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnO1xuICB9XG5cbiAgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxTPiwgc2VhcmNoSW5kZXhDb25maWcgPSB0aGlzLmdldFNlYXJjaEluZGV4Q29uZmlnKCksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFNlYXJjaFJlc3VsdDxhbnk+PiB7XG4gICAgcmV0dXJuIHN1cGVyLnNlYXJjaChxdWVyeSwgc2VhcmNoSW5kZXhDb25maWcsIGN0eCk7XG4gIH1cblxuICBhc3luYyBzeW5jVG9JbmRleChlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+LCBzZWFyY2hJbmRleENvbmZpZyA9IHRoaXMuZ2V0U2VhcmNoSW5kZXhDb25maWcoKSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCwgc3luY2hyb25vdXM/OiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHN1cGVyLnN5bmNUb0luZGV4KGVudGl0eSwgc2VhcmNoSW5kZXhDb25maWcsIGN0eCwgc3luY2hyb25vdXMpO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRnJvbUluZGV4KGVudGl0eUlkOiBzdHJpbmcsIHNlYXJjaEluZGV4Q29uZmlnID0gdGhpcy5nZXRTZWFyY2hJbmRleENvbmZpZygpLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0LCBzeW5jaHJvbm91cz86IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gc3VwZXIuZGVsZXRlRnJvbUluZGV4KGVudGl0eUlkLCBzZWFyY2hJbmRleENvbmZpZywgY3R4LCBzeW5jaHJvbm91cyk7XG4gIH1cblxuICBhc3luYyBidWxrU3luYyhlbnRpdGllczogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz5bXSwgc2VhcmNoSW5kZXhDb25maWcgPSB0aGlzLmdldFNlYXJjaEluZGV4Q29uZmlnKCksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsIHN5bmNocm9ub3VzPzogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBzdXBlci5idWxrU3luYyhlbnRpdGllcywgc2VhcmNoSW5kZXhDb25maWcsIGN0eCwgc3luY2hyb25vdXMpO1xuICB9XG5cbiAgLy8gZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT5cbiAgYXN5bmMgdHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+KTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcblxuICAgIC8vIFVzZSBzY2hlbWEtZGVmaW5lZCB0cmFuc2Zvcm1lciBpZiBhdmFpbGFibGVcbiAgICBpZiAoc2VhcmNoQ29uZmlnPy5kb2N1bWVudFRyYW5zZm9ybWVyKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdVc2luZyBzY2hlbWEtZGVmaW5lZCBkb2N1bWVudCB0cmFuc2Zvcm1lcicsIHsgZW50aXR5TmFtZTogdGhpcy5lbnRpdHlTZXJ2aWNlLmdldEVudGl0eU5hbWUoKSB9KTtcbiAgICAgIHJldHVybiBhd2FpdCBzZWFyY2hDb25maWcuZG9jdW1lbnRUcmFuc2Zvcm1lcihlbnRpdHkpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBzdXBlci50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogUmVzeW5jIGFsbCBlbnRpdHkgZG9jdW1lbnRzIGZyb20gZGF0YWJhc2UgdG8gc2VhcmNoIGluZGV4LlxuICAgKiBVc2VzIGN1cnNvci1iYXNlZCBwYWdpbmF0aW9uIHRvIGhhbmRsZSBsYXJnZSBkYXRhc2V0cyBlZmZpY2llbnRseS5cbiAgICogXG4gICAqIEBwYXJhbSBvcHRpb25zLmJhdGNoU2l6ZSAtIE51bWJlciBvZiByZWNvcmRzIHRvIGZldGNoIHBlciBpdGVyYXRpb24gKGRlZmF1bHQ6IDUwKVxuICAgKiBAcGFyYW0gb3B0aW9ucy5jdHggLSBFeGVjdXRpb24gY29udGV4dCBmb3IgdGhlIG9wZXJhdGlvblxuICAgKiBAcGFyYW0gb3B0aW9ucy5tYXhJdGVyYXRpb25zIC0gU2FmZXR5IGxpbWl0IG9uIG51bWJlciBvZiBpdGVyYXRpb25zIChkZWZhdWx0OiAxMDAwMClcbiAgICovXG4gIGFzeW5jIHJlc3luY0FsbERvY3VtZW50cyhvcHRpb25zPzoge1xuICAgIGJhdGNoU2l6ZT86IG51bWJlcjtcbiAgICBjdHg/OiBFeGVjdXRpb25Db250ZXh0O1xuICAgIG1heEl0ZXJhdGlvbnM/OiBudW1iZXI7XG4gIH0pOiBQcm9taXNlPHtcbiAgICBwcm9jZXNzZWRDb3VudDogbnVtYmVyO1xuICAgIGZhaWxlZENvdW50OiBudW1iZXI7XG4gICAgdG90YWxJdGVyYXRpb25zOiBudW1iZXI7XG4gIH0+IHtcbiAgICBjb25zdCB7IGJhdGNoU2l6ZSA9IDUwLCBjdHgsIG1heEl0ZXJhdGlvbnMgPSAxMDAwMCB9ID0gb3B0aW9ucyB8fCB7fTtcbiAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZSA9IHRoaXMuZW50aXR5U2VydmljZS5nZXRFbnRpdHlOYW1lKCk7XG5cbiAgICBsZXQgY3Vyc29yOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnaW5pdCc7XG4gICAgbGV0IGl0ZXJhdGlvbkNvdW50ID0gMDtcbiAgICBsZXQgcHJvY2Vzc2VkQ291bnQgPSAwO1xuICAgIGxldCBmYWlsZWRDb3VudCA9IDA7XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBTdGFydGluZyByZXN5bmMgZm9yICR7ZW50aXR5TmFtZX1gKTtcblxuICAgIC8vIEl0ZXJhdGUgdGhyb3VnaCBhbGwgcmVjb3JkcyB1c2luZyBjdXJzb3ItYmFzZWQgcGFnaW5hdGlvblxuICAgIHdoaWxlIChjdXJzb3IgJiYgaXRlcmF0aW9uQ291bnQgPCBtYXhJdGVyYXRpb25zKSB7XG4gICAgICBpdGVyYXRpb25Db3VudCsrO1xuXG4gICAgICAvLyBGZXRjaCBuZXh0IGJhdGNoXG4gICAgICBjb25zdCBxdWVyeVJlc3VsdCA9IGF3YWl0IHRoaXMuZW50aXR5U2VydmljZS5xdWVyeSh7XG4gICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgICAgIGN1cnNvcjogY3Vyc29yID09PSAnaW5pdCcgPyB1bmRlZmluZWQgOiBjdXJzb3JcbiAgICAgICAgfVxuICAgICAgfSwgY3R4KTtcblxuICAgICAgaWYgKCFxdWVyeVJlc3VsdC5kYXRhPy5sZW5ndGgpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIC8vIFN5bmMgYmF0Y2ggdG8gc2VhcmNoIGluZGV4XG4gICAgICBjb25zdCB7IHN1bW1hcnkgfSA9IGF3YWl0IEJhdGNoUHJvZ3Jlc3MuYWxsKFxuICAgICAgICBgUmVzeW5jICR7ZW50aXR5TmFtZX1gLFxuICAgICAgICBxdWVyeVJlc3VsdC5kYXRhLFxuICAgICAgICBhc3luYyAoZG9jcykgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuYnVsa1N5bmMoZG9jcyBhcyBFbnRpdHlSZWNvcmRUeXBlRnJvbVNjaGVtYTxTPltdLCBzZWFyY2hDb25maWcsIGN0eCwgdHJ1ZSk7XG4gICAgICAgICAgcmV0dXJuIGRvY3M7XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICAvLyBTaG93IHByb2dyZXNzIG9uIGZpcnN0IGl0ZXJhdGlvbiwgdGhlbiBvbmx5IGVycm9yc1xuICAgICAgICAgIG9ic2VydmU6IGl0ZXJhdGlvbkNvdW50ID09PSAxID8gJ3Byb2dyZXNzJyA6ICdlcnJvcnMnLFxuICAgICAgICAgIHRhZ3M6IHsgZW50aXR5OiBlbnRpdHlOYW1lIH0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIHByb2Nlc3NlZENvdW50ICs9IHN1bW1hcnkuc3VjY2VlZGVkO1xuICAgICAgZmFpbGVkQ291bnQgKz0gc3VtbWFyeS5mYWlsZWQ7XG4gICAgICBjdXJzb3IgPSBxdWVyeVJlc3VsdC5jdXJzb3IgPz8gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmluZm8oYFJlc3luYyBjb21wbGV0ZWQgZm9yICR7ZW50aXR5TmFtZX1gLCB7XG4gICAgICBwcm9jZXNzZWRDb3VudCxcbiAgICAgIGZhaWxlZENvdW50LFxuICAgICAgaXRlcmF0aW9uczogaXRlcmF0aW9uQ291bnRcbiAgICB9KTtcblxuICAgIHJldHVybiB7IHByb2Nlc3NlZENvdW50LCBmYWlsZWRDb3VudCwgdG90YWxJdGVyYXRpb25zOiBpdGVyYXRpb25Db3VudCB9O1xuICB9XG59ICJdfQ==