"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntitySearchService = void 0;
const base_search_service_1 = require("./base-search-service");
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
     * Resync all entity documents from database to search index
     * Uses cursor-based pagination to handle large datasets efficiently
     */
    async resyncAllDocuments(options) {
        const { batchSize = 50, ctx } = options || {};
        const searchConfig = this.getSearchIndexConfig();
        let processedCount = 0;
        let failedCount = 0;
        let cursor = 'init';
        const maxIterations = 10000;
        let iterationCount = 0;
        this.logger.info(`Starting resync for ${this.entityService.getEntityName()}`);
        while (!!cursor && iterationCount < maxIterations) {
            iterationCount++;
            const queryResult = await this.entityService.query({
                pagination: {
                    limit: batchSize,
                    cursor: cursor === 'init' ? undefined : cursor
                }
            }, ctx);
            if (!queryResult.data || queryResult.data.length === 0) {
                break;
            }
            try {
                await this.bulkSync(queryResult.data, searchConfig, ctx, true);
                processedCount += queryResult.data.length;
                this.logger.info(`Synced batch of ${queryResult.data.length} documents`, {
                    entityName: this.entityService.getEntityName(),
                    processedCount,
                    iteration: iterationCount
                });
            }
            catch (error) {
                this.logger.error(`Error syncing batch: ${error.message}`, { error });
                failedCount += queryResult.data.length;
            }
            cursor = queryResult.cursor ?? undefined;
        }
        this.logger.info(`Resync completed for ${this.entityService.getEntityName()}`, {
            processedCount,
            failedCount,
            totalIterations: iterationCount
        });
        return {
            processedCount,
            failedCount,
            totalIterations: iterationCount,
        };
    }
}
exports.EntitySearchService = EntitySearchService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNlYXJjaC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zZXJ2aWNlcy9lbnRpdHktc2VhcmNoLXNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBSUEsK0RBQTBEO0FBRTFELE1BQWEsbUJBQTJELFNBQVEsdUNBQWlCO0lBRzFFO0lBQ0E7SUFGckIsWUFDcUIsYUFBbUMsRUFDbkMsWUFBOEI7UUFFakQsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBSEQsa0JBQWEsR0FBYixhQUFhLENBQXNCO1FBQ25DLGlCQUFZLEdBQVosWUFBWSxDQUFrQjtJQUduRCxDQUFDO0lBRVMscUJBQXFCO1FBQzdCLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO0lBQ3BELENBQUM7SUFFTSxvQkFBb0I7UUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFDbEQsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ2xCLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQztRQUM3QyxDQUFDO1FBRUQsSUFBSSxDQUFDLFlBQVksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUM5QixZQUFZLENBQUMsV0FBVyxHQUFHLEVBQUUsQ0FBQztRQUNoQyxDQUFDO1FBRUQsT0FBTyxZQUFZLENBQUMsV0FBVyxDQUFDO0lBQ2xDLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQTJCLEVBQUUsaUJBQWlCLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEVBQUUsR0FBc0I7UUFDL0csT0FBTyxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxpQkFBaUIsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNyRCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFxQyxFQUFFLGlCQUFpQixHQUFHLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLEdBQXNCLEVBQUUsV0FBcUI7UUFDckosT0FBTyxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxpQkFBaUIsRUFBRSxHQUFHLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFDeEUsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsUUFBZ0IsRUFBRSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsRUFBRSxHQUFzQixFQUFFLFdBQXFCO1FBQ3BJLE9BQU8sS0FBSyxDQUFDLGVBQWUsQ0FBQyxRQUFRLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBQzlFLENBQUM7SUFFRCxLQUFLLENBQUMsUUFBUSxDQUFDLFFBQXlDLEVBQUUsaUJBQWlCLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEVBQUUsR0FBc0IsRUFBRSxXQUFxQjtRQUN0SixPQUFPLEtBQUssQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLGlCQUFpQixFQUFFLEdBQUcsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBRUQsb0VBQW9FO0lBQ3BFLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxNQUFxQztRQUN0RSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUVsRCw4Q0FBOEM7UUFDOUMsSUFBSSxZQUFZLEVBQUUsbUJBQW1CLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywyQ0FBMkMsRUFBRSxFQUFFLFVBQVUsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNsSCxPQUFPLE1BQU0sWUFBWSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3hELENBQUM7UUFFRCxPQUFPLE1BQU0sS0FBSyxDQUFDLDRCQUE0QixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzFELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsa0JBQWtCLENBQUMsT0FHeEI7UUFLQyxNQUFNLEVBQUUsU0FBUyxHQUFHLEVBQUUsRUFBRSxHQUFHLEVBQUUsR0FBRyxPQUFPLElBQUksRUFBRSxDQUFDO1FBQzlDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBRWpELElBQUksY0FBYyxHQUFHLENBQUMsQ0FBQztRQUN2QixJQUFJLFdBQVcsR0FBRyxDQUFDLENBQUM7UUFDcEIsSUFBSSxNQUFNLEdBQXVCLE1BQU0sQ0FBQztRQUN4QyxNQUFNLGFBQWEsR0FBRyxLQUFLLENBQUM7UUFDNUIsSUFBSSxjQUFjLEdBQUcsQ0FBQyxDQUFDO1FBRXZCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHVCQUF1QixJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUU5RSxPQUFPLENBQUMsQ0FBQyxNQUFNLElBQUksY0FBYyxHQUFHLGFBQWEsRUFBRSxDQUFDO1lBQ2xELGNBQWMsRUFBRSxDQUFDO1lBRWpCLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7Z0JBQ2pELFVBQVUsRUFBRTtvQkFDVixLQUFLLEVBQUUsU0FBUztvQkFDaEIsTUFBTSxFQUFFLE1BQU0sS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTTtpQkFDL0M7YUFDRixFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBRVIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksV0FBVyxDQUFDLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZELE1BQU07WUFDUixDQUFDO1lBRUQsSUFBSSxDQUFDO2dCQUNILE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsSUFBdUMsRUFBRSxZQUFZLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUNsRyxjQUFjLElBQUksV0FBVyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7Z0JBRTFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLG1CQUFtQixXQUFXLENBQUMsSUFBSSxDQUFDLE1BQU0sWUFBWSxFQUFFO29CQUN2RSxVQUFVLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUU7b0JBQzlDLGNBQWM7b0JBQ2QsU0FBUyxFQUFFLGNBQWM7aUJBQzFCLENBQUMsQ0FBQztZQUNMLENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNwQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztnQkFDdEUsV0FBVyxJQUFJLFdBQVcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1lBQ3pDLENBQUM7WUFFRCxNQUFNLEdBQUcsV0FBVyxDQUFDLE1BQU0sSUFBSSxTQUFTLENBQUM7UUFDM0MsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHdCQUF3QixJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsRUFBRSxFQUFFLEVBQUU7WUFDN0UsY0FBYztZQUNkLFdBQVc7WUFDWCxlQUFlLEVBQUUsY0FBYztTQUNoQyxDQUFDLENBQUM7UUFFSCxPQUFPO1lBQ0wsY0FBYztZQUNkLFdBQVc7WUFDWCxlQUFlLEVBQUUsY0FBYztTQUNoQyxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBekhELGtEQXlIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHR5cGUgeyBCYXNlRW50aXR5U2VydmljZSwgRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWEsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgdHlwZSB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzJztcbmltcG9ydCB0eXBlIHsgRW50aXR5U2VhcmNoUXVlcnksIFNlYXJjaFJlc3VsdCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi9iYXNlLXNlYXJjaC1zZXJ2aWNlJztcblxuZXhwb3J0IGNsYXNzIEVudGl0eVNlYXJjaFNlcnZpY2U8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55Pj4gZXh0ZW5kcyBCYXNlU2VhcmNoU2VydmljZSB7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJvdGVjdGVkIHJlYWRvbmx5IGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPFM+LFxuICAgIHByb3RlY3RlZCByZWFkb25seSBzZWFyY2hFbmdpbmU6IEJhc2VTZWFyY2hFbmdpbmUsXG4gICkge1xuICAgIHN1cGVyKHNlYXJjaEVuZ2luZSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCkge1xuICAgIHJldHVybiB0aGlzLmVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VhcmNoQ29uZmlnKCk7XG4gIH1cblxuICBwdWJsaWMgZ2V0U2VhcmNoSW5kZXhDb25maWcoKSB7XG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcbiAgICBpZiAoIXNlYXJjaENvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2ggY29uZmlnIG5vdCBmb3VuZCcpO1xuICAgIH1cblxuICAgIGlmICghc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnKSB7XG4gICAgICBzZWFyY2hDb25maWcuaW5kZXhDb25maWcgPSB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VhcmNoQ29uZmlnLmluZGV4Q29uZmlnO1xuICB9XG5cbiAgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxTPiwgc2VhcmNoSW5kZXhDb25maWcgPSB0aGlzLmdldFNlYXJjaEluZGV4Q29uZmlnKCksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpOiBQcm9taXNlPFNlYXJjaFJlc3VsdDxhbnk+PiB7XG4gICAgcmV0dXJuIHN1cGVyLnNlYXJjaChxdWVyeSwgc2VhcmNoSW5kZXhDb25maWcsIGN0eCk7XG4gIH1cblxuICBhc3luYyBzeW5jVG9JbmRleChlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+LCBzZWFyY2hJbmRleENvbmZpZyA9IHRoaXMuZ2V0U2VhcmNoSW5kZXhDb25maWcoKSwgY3R4PzogRXhlY3V0aW9uQ29udGV4dCwgc3luY2hyb25vdXM/OiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHN1cGVyLnN5bmNUb0luZGV4KGVudGl0eSwgc2VhcmNoSW5kZXhDb25maWcsIGN0eCwgc3luY2hyb25vdXMpO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRnJvbUluZGV4KGVudGl0eUlkOiBzdHJpbmcsIHNlYXJjaEluZGV4Q29uZmlnID0gdGhpcy5nZXRTZWFyY2hJbmRleENvbmZpZygpLCBjdHg/OiBFeGVjdXRpb25Db250ZXh0LCBzeW5jaHJvbm91cz86IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gc3VwZXIuZGVsZXRlRnJvbUluZGV4KGVudGl0eUlkLCBzZWFyY2hJbmRleENvbmZpZywgY3R4LCBzeW5jaHJvbm91cyk7XG4gIH1cblxuICBhc3luYyBidWxrU3luYyhlbnRpdGllczogRW50aXR5UmVjb3JkVHlwZUZyb21TY2hlbWE8Uz5bXSwgc2VhcmNoSW5kZXhDb25maWcgPSB0aGlzLmdldFNlYXJjaEluZGV4Q29uZmlnKCksIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQsIHN5bmNocm9ub3VzPzogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBzdXBlci5idWxrU3luYyhlbnRpdGllcywgc2VhcmNoSW5kZXhDb25maWcsIGN0eCwgc3luY2hyb25vdXMpO1xuICB9XG5cbiAgLy8gZXh0ZW5kcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4gPSBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT5cbiAgYXN5bmMgdHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHk6IEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+KTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnID0gdGhpcy5nZXRFbnRpdHlTZWFyY2hDb25maWcoKTtcblxuICAgIC8vIFVzZSBzY2hlbWEtZGVmaW5lZCB0cmFuc2Zvcm1lciBpZiBhdmFpbGFibGVcbiAgICBpZiAoc2VhcmNoQ29uZmlnPy5kb2N1bWVudFRyYW5zZm9ybWVyKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdVc2luZyBzY2hlbWEtZGVmaW5lZCBkb2N1bWVudCB0cmFuc2Zvcm1lcicsIHsgZW50aXR5TmFtZTogdGhpcy5lbnRpdHlTZXJ2aWNlLmdldEVudGl0eU5hbWUoKSB9KTtcbiAgICAgIHJldHVybiBhd2FpdCBzZWFyY2hDb25maWcuZG9jdW1lbnRUcmFuc2Zvcm1lcihlbnRpdHkpO1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBzdXBlci50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG4gIH1cblxuICAvKipcbiAgICogUmVzeW5jIGFsbCBlbnRpdHkgZG9jdW1lbnRzIGZyb20gZGF0YWJhc2UgdG8gc2VhcmNoIGluZGV4XG4gICAqIFVzZXMgY3Vyc29yLWJhc2VkIHBhZ2luYXRpb24gdG8gaGFuZGxlIGxhcmdlIGRhdGFzZXRzIGVmZmljaWVudGx5XG4gICAqL1xuICBhc3luYyByZXN5bmNBbGxEb2N1bWVudHMob3B0aW9ucz86IHtcbiAgICBiYXRjaFNpemU/OiBudW1iZXI7XG4gICAgY3R4PzogRXhlY3V0aW9uQ29udGV4dDtcbiAgfSk6IFByb21pc2U8e1xuICAgIHByb2Nlc3NlZENvdW50OiBudW1iZXI7XG4gICAgZmFpbGVkQ291bnQ6IG51bWJlcjtcbiAgICB0b3RhbEl0ZXJhdGlvbnM6IG51bWJlcjtcbiAgfT4ge1xuICAgIGNvbnN0IHsgYmF0Y2hTaXplID0gNTAsIGN0eCB9ID0gb3B0aW9ucyB8fCB7fTtcbiAgICBjb25zdCBzZWFyY2hDb25maWcgPSB0aGlzLmdldFNlYXJjaEluZGV4Q29uZmlnKCk7XG4gICAgXG4gICAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcbiAgICBsZXQgZmFpbGVkQ291bnQgPSAwO1xuICAgIGxldCBjdXJzb3I6IHN0cmluZyB8IHVuZGVmaW5lZCA9ICdpbml0JztcbiAgICBjb25zdCBtYXhJdGVyYXRpb25zID0gMTAwMDA7XG4gICAgbGV0IGl0ZXJhdGlvbkNvdW50ID0gMDtcblxuICAgIHRoaXMubG9nZ2VyLmluZm8oYFN0YXJ0aW5nIHJlc3luYyBmb3IgJHt0aGlzLmVudGl0eVNlcnZpY2UuZ2V0RW50aXR5TmFtZSgpfWApO1xuXG4gICAgd2hpbGUgKCEhY3Vyc29yICYmIGl0ZXJhdGlvbkNvdW50IDwgbWF4SXRlcmF0aW9ucykge1xuICAgICAgaXRlcmF0aW9uQ291bnQrKztcblxuICAgICAgY29uc3QgcXVlcnlSZXN1bHQgPSBhd2FpdCB0aGlzLmVudGl0eVNlcnZpY2UucXVlcnkoe1xuICAgICAgICBwYWdpbmF0aW9uOiB7XG4gICAgICAgICAgbGltaXQ6IGJhdGNoU2l6ZSxcbiAgICAgICAgICBjdXJzb3I6IGN1cnNvciA9PT0gJ2luaXQnID8gdW5kZWZpbmVkIDogY3Vyc29yXG4gICAgICAgIH1cbiAgICAgIH0sIGN0eCk7XG5cbiAgICAgIGlmICghcXVlcnlSZXN1bHQuZGF0YSB8fCBxdWVyeVJlc3VsdC5kYXRhLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5idWxrU3luYyhxdWVyeVJlc3VsdC5kYXRhIGFzIEVudGl0eVJlY29yZFR5cGVGcm9tU2NoZW1hPFM+W10sIHNlYXJjaENvbmZpZywgY3R4LCB0cnVlKTtcbiAgICAgICAgcHJvY2Vzc2VkQ291bnQgKz0gcXVlcnlSZXN1bHQuZGF0YS5sZW5ndGg7XG4gICAgICAgIFxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBTeW5jZWQgYmF0Y2ggb2YgJHtxdWVyeVJlc3VsdC5kYXRhLmxlbmd0aH0gZG9jdW1lbnRzYCwge1xuICAgICAgICAgIGVudGl0eU5hbWU6IHRoaXMuZW50aXR5U2VydmljZS5nZXRFbnRpdHlOYW1lKCksXG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICAgICAgaXRlcmF0aW9uOiBpdGVyYXRpb25Db3VudFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoYEVycm9yIHN5bmNpbmcgYmF0Y2g6ICR7ZXJyb3IubWVzc2FnZX1gLCB7IGVycm9yIH0pO1xuICAgICAgICBmYWlsZWRDb3VudCArPSBxdWVyeVJlc3VsdC5kYXRhLmxlbmd0aDtcbiAgICAgIH1cblxuICAgICAgY3Vyc29yID0gcXVlcnlSZXN1bHQuY3Vyc29yID8/IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZXN5bmMgY29tcGxldGVkIGZvciAke3RoaXMuZW50aXR5U2VydmljZS5nZXRFbnRpdHlOYW1lKCl9YCwge1xuICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICBmYWlsZWRDb3VudCxcbiAgICAgIHRvdGFsSXRlcmF0aW9uczogaXRlcmF0aW9uQ291bnRcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICBwcm9jZXNzZWRDb3VudCxcbiAgICAgIGZhaWxlZENvdW50LFxuICAgICAgdG90YWxJdGVyYXRpb25zOiBpdGVyYXRpb25Db3VudCxcbiAgICB9O1xuICB9XG59ICJdfQ==