"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSearchIndexer = void 0;
const base_sqs_event_processor_1 = require("../../core/runtime/event-processor/base-sqs-event-processor");
const utils_1 = require("../../utils");
const errors_1 = require("../errors");
const search_utils_1 = require("../search-utils");
const interfaces_1 = require("./interfaces");
const batch_progress_1 = require("../../observability/utils/batch-progress");
class BaseSearchIndexer extends base_sqs_event_processor_1.BaseSQSEventProcessor {
    // override this to provide a list of allowed entity names
    getAllowedEntityNames() {
        return undefined;
    }
    // override this to provide a list of excluded entity names
    getExcludedEntityNames() {
        return undefined;
    }
    /**
     * Determines if an entity should be indexed based on allowed/excluded lists.
     * Override in subclasses to implement custom logic.
     * Default behavior: index all except system entities.
     */
    shouldIndexEntity(entityName) {
        const allowedEntityNames = this.getAllowedEntityNames();
        const excludedEntityNames = this.getExcludedEntityNames();
        // Excluded list ALWAYS wins (safer default).
        if (excludedEntityNames && excludedEntityNames.length > 0 && excludedEntityNames.includes(entityName)) {
            return false;
        }
        // If allowedEntityNames is provided, restrict indexing to that list.
        if (allowedEntityNames && allowedEntityNames.length > 0) {
            return allowedEntityNames.includes(entityName);
        }
        // Otherwise, if excludedEntityNames is provided, index all except excluded (already handled above).
        if (excludedEntityNames && excludedEntityNames.length > 0) {
            return true;
        }
        // Default behavior: index all entities
        return true;
    }
    async preprocessRecord(record) {
        const { entityName, eventType } = record;
        if (!['create', 'update', 'delete'].includes(eventType)) {
            this.logger.warn('Skipping record with unsupported event type', { eventType });
            return null;
        }
        if (!entityName) {
            this.logger.warn('Skipping record with no entity name', { record });
            return null;
        }
        if (!this.shouldIndexEntity(entityName)) {
            const allowedEntityNames = this.getAllowedEntityNames();
            const excludedEntityNames = this.getExcludedEntityNames();
            this.logger.warn('Skipping search indexing for entity based on filtering rules', {
                entityName,
                allowedEntityNames,
                excludedEntityNames
            });
            return null;
        }
        return record;
    }
    // Implementation for per-record processing
    async processRecord(record) {
        const startTime = Date.now();
        const { entityName, eventType, entityId } = record;
        this.logger.info('Processing single record for search indexing', { entityName, eventType, entityId });
        const searchIndexEntry = this.createSearchIndexEntry(record);
        await this.indexOrDeleteDocument(searchIndexEntry);
        const duration = Date.now() - startTime;
        this.logger.info('Single record processing completed', { entityName, eventType, entityId, durationMs: duration });
    }
    // Implementation for batch processing
    async processRecordsBatch(records) {
        // Group by entityName and eventType to minimize engine calls
        const groups = new Map();
        for (const rec of records) {
            const key = `${rec.entityName || ''}|${rec.eventType}`;
            const arr = groups.get(key) || [];
            arr.push(rec);
            groups.set(key, arr);
        }
        // Hot path: only a cheap summary at debug. The old per-group `groupDetails` array was built on
        // EVERY batch (arguments are evaluated before the log call, so even a suppressed debug paid for it)
        // and added no value at the volume the stream/indexer runs at.
        this.logger.debug('Records grouped for batch processing', {
            totalGroups: groups.size,
            totalRecords: records.length,
        });
        // Process each group using BatchProgress
        for (const [key, groupRecords] of groups.entries()) {
            const [entityName, eventType] = key.split('|');
            if (!['create', 'update', 'delete'].includes(eventType)) {
                this.logger.warn('Skipping unknown event type', { eventType, count: groupRecords.length });
                continue;
            }
            const indexName = this.getIndexName(entityName);
            try {
                await this.ensureIndexExists(indexName);
            }
            catch (error) {
                this.logger.error('Index does not exist, skipping group', { indexName, entityName, error });
                continue;
            }
            if (eventType === 'delete') {
                await this.processBatchDelete(groupRecords, indexName, entityName);
            }
            else {
                await this.processBatchIndex(groupRecords, indexName, entityName);
            }
        }
    }
    /**
     * Process batch index using BatchProgress.chunk
     */
    async processBatchIndex(records, indexName, entityName) {
        const docs = [];
        const nowIso = new Date().toISOString();
        for (const record of records) {
            const searchIndexEntry = this.createSearchIndexEntry(record);
            const transformedData = searchIndexEntry.data;
            const items = Array.isArray(transformedData)
                ? transformedData
                : (Array.isArray(transformedData?.items) ? transformedData.items : [transformedData]);
            for (const item of items) {
                const id = item?.id || item?.[`${entityName}Id`] || record.entityId;
                if (!id) {
                    this.logger.warn('Skipping item without id', { entityName });
                    continue;
                }
                const doc = item?.id ? { ...item } : { ...item, id };
                if (!doc._indexedAt) {
                    doc._indexedAt = nowIso;
                }
                docs.push({ doc, id });
            }
        }
        if (docs.length === 0) {
            this.logger.info('No documents to index', { entityName, indexName });
            return;
        }
        // Index in chunks (default 25 docs per batch)
        await batch_progress_1.BatchProgress.chunk(`Index ${entityName}`, docs, async (chunk) => {
            const docsToIndex = chunk.map(c => c.doc);
            await this.searchEngine.indexDocuments(docsToIndex, { indexName }, false);
            return chunk.map(c => c.id);
        }, { tags: { entity: entityName } });
    }
    /**
     * Process batch delete using chunked deletion.
     */
    async processBatchDelete(records, indexName, entityName) {
        // Extract IDs from records that have entityId
        const ids = records
            .filter(r => r.entityId)
            .map(r => r.entityId);
        if (ids.length === 0) {
            this.logger.info('No records with entityId to delete', { entityName });
            return;
        }
        // Delete in chunks (default 25 IDs per batch)
        await batch_progress_1.BatchProgress.chunk(`Delete ${entityName}`, ids, async (chunk) => {
            await this.searchEngine.deleteDocuments(chunk, indexName, false);
            return chunk;
        }, { tags: { entity: entityName } });
    }
    // Helper method to create SearchIndexEntry from a record
    createSearchIndexEntry(record) {
        const { entityName, eventType, entityId, timestamp, payload: payloadData, metadata } = record;
        // Extract searchable data based on the source type
        const searchableData = this.transformPayloadForIndexing(payloadData, eventType, metadata?.source);
        // Note: timestamp is already in milliseconds (converted from DynamoDB seconds in the data extractor)
        // Example: timestamp = 1734567890000 (milliseconds) -> "2024-12-19T10:31:30.000Z"
        return {
            id: entityId,
            data: searchableData,
            eventType: eventType,
            timestamp: (timestamp ? new Date(timestamp) : new Date()).toISOString(),
            entityName: entityName,
        };
    }
    /**
     * Transform payload data for search indexing based on source type
     * Override this method in subclasses for custom data transformation
     */
    transformPayloadForIndexing(payloadData, eventType, source) {
        // For stream sources, payload is ChangeStreamPayload format
        if (source === 'stream' && payloadData && typeof payloadData === 'object' &&
            ('oldImage' in payloadData || 'newImage' in payloadData || 'keys' in payloadData)) {
            const { oldImage, newImage } = payloadData;
            return this.extractSearchableDataFromChangeStream(oldImage, newImage, eventType);
        }
        // Handle array payloads - add _indexedAt to each item
        if (Array.isArray(payloadData)) {
            return payloadData.map(item => ({
                ...item,
                _indexedAt: new Date().toISOString()
            }));
        }
        // For single object payloads, use payload directly
        return {
            ...payloadData,
            _indexedAt: new Date().toISOString()
        };
    }
    /**
     * Extract searchable data from DynamoDB change stream format
     * Override this method in subclasses for custom field filtering
     */
    extractSearchableDataFromChangeStream(oldImage, newImage, eventType) {
        // For deletions, we only need the ID to remove from index
        if (eventType === 'delete') {
            return { id: oldImage?.id };
        }
        // For creates and updates, use the new image
        const sourceData = newImage || oldImage;
        if (!sourceData) {
            return null;
        }
        // Remove DynamoDB internal fields and prepare for search indexing
        const ignoredKeys = [
            '__EDB_E__', '__EDB_V__', 'PK', 'SK',
            'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
            'PASSWORD'
        ];
        const searchableData = { ...sourceData };
        Object.keys(sourceData).forEach(key => {
            if (ignoredKeys.includes(key.toUpperCase()) ||
                key.startsWith('__') ||
                (key.length > 3 && ['GSI', 'LSI'].includes(key.substring(0, 3).toUpperCase()))) {
                delete searchableData[key];
            }
        });
        return {
            ...searchableData,
            _indexedAt: new Date().toISOString()
        };
    }
    async indexOrDeleteDocument(searchIndexEntry) {
        const { entityName, eventType, data, id } = searchIndexEntry;
        this.logger.info('Processing search index operation', { entityName, eventType, id });
        const indexName = this.getIndexName(entityName);
        try {
            // Ensure the index exists
            // we won't be able to create an index here as we do-not have access to entity-index config.. 
            // indexes are supposed to be setup by the application; 
            await this.ensureIndexExists(indexName);
            // Handle different event types
            switch (eventType) {
                case 'create':
                case 'update':
                    await this.indexDocumentData(indexName, data, id);
                    break;
                case 'delete':
                    await this.deleteDocument(indexName, id);
                    break;
                default:
                    this.logger.warn('Unknown event type', { eventType });
                    return;
            }
            this.logger.info('Successfully processed search index operation', { indexName, eventType, id });
        }
        catch (error) {
            this.logger.error('Error processing search index operation', { error, indexName, eventType, id });
            throw error;
        }
    }
    getIndexName(entityName) {
        const tableNameKey = (0, utils_1.resolveEnvValueFor)({ key: interfaces_1.SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY });
        this.logger.debug('tableNameKey', { tableNameKey });
        if (!tableNameKey) {
            throw new errors_1.SearchValidationError(`${interfaces_1.SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY} environment variable is required to calculate the appropriate index-name`);
        }
        const tableName = (0, utils_1.resolveEnvValueFor)({ key: tableNameKey, suffix: 'table' });
        this.logger.debug('tableName', { tableName });
        if (!tableName) {
            throw new errors_1.SearchValidationError(`${tableName} environment variable is required to calculate the appropriate index-name`);
        }
        const indexName = (0, search_utils_1.makeEntitySearchIndexName)({ tableName, entityName });
        return indexName;
    }
    async ensureIndexExists(indexName) {
        const exists = await this.searchEngine.indexExists(indexName);
        if (!exists) {
            // Auto-provision instead of erroring. Previously this threw "Index does not exist", so any
            // searchable entity whose index was never provisioned (added after initial setup, or a fresh
            // deploy) errored on EVERY sync forever with no self-heal. The engine creates the index
            // (primaryKey defaults to `id`, which the indexer stamps on every document) and applies
            // default settings; a richer per-entity config can still be applied via the entity search
            // service's initSearchIndex(). Entities that should NOT be indexed are filtered upstream by
            // shouldIndexEntity(), so this only creates indexes for entities meant to be searchable.
            this.logger.info('Index does not exist — auto-creating', { indexName });
            await this.searchEngine.initIndex({ indexName }, true);
        }
    }
    async indexDocumentData(indexName, data, id) {
        if (!data || !data.id) {
            // Ensure the document has an ID
            data = { ...data, id };
        }
        await this.searchEngine.indexDocuments([data], { indexName }, false);
        this.logger.info('Document indexed successfully', { indexName, id });
    }
    async deleteDocument(indexName, id) {
        await this.searchEngine.deleteDocuments([id], indexName, false);
        this.logger.info('Document deleted successfully', { indexName, id });
    }
}
exports.BaseSearchIndexer = BaseSearchIndexer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQWtEO0FBQ2xELGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFDekUsNkVBQXlFO0FBRXpFLE1BQXNCLGlCQUFvTCxTQUFRLGdEQUF3QjtJQUt4TywwREFBMEQ7SUFDaEQscUJBQXFCO1FBQzdCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCwyREFBMkQ7SUFDakQsc0JBQXNCO1FBQzlCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ08saUJBQWlCLENBQUMsVUFBa0I7UUFDNUMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUN4RCxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1FBRTFELDZDQUE2QztRQUM3QyxJQUFJLG1CQUFtQixJQUFJLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksbUJBQW1CLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDdEcsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO1FBRUQscUVBQXFFO1FBQ3JFLElBQUksa0JBQWtCLElBQUksa0JBQWtCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hELE9BQU8sa0JBQWtCLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ2pELENBQUM7UUFFRCxvR0FBb0c7UUFDcEcsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsdUNBQXVD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QUF5RjtZQUN6RixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxzQ0FBc0MsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7WUFDeEUsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3pELENBQUM7SUFDSCxDQUFDO0lBRVMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLFNBQWlCLEVBQUUsSUFBUyxFQUFFLEVBQVU7UUFDeEUsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUN0QixnQ0FBZ0M7WUFDaEMsSUFBSSxHQUFHLEVBQUUsR0FBRyxJQUFJLEVBQUUsRUFBRSxFQUFFLENBQUM7UUFDekIsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsQ0FBRSxJQUFJLENBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVTLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUIsRUFBRSxFQUFVO1FBQzFELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxlQUFlLENBQUMsQ0FBRSxFQUFFLENBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RSxDQUFDO0NBRUY7QUFyWUQsOENBcVlDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBJRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL2VuZ2luZXMvYmFzZSc7XG5pbXBvcnQgeyBTZWFyY2hWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuLi9lcnJvcnMnO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC11dGlscyc7XG5pbXBvcnQgeyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUywgU2VhcmNoSW5kZXhFbnRyeSB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBCYXRjaFByb2dyZXNzIH0gZnJvbSAnLi4vLi4vb2JzZXJ2YWJpbGl0eS91dGlscy9iYXRjaC1wcm9ncmVzcyc7XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlU2VhcmNoSW5kZXhlcjxUIGV4dGVuZHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxURXZlbnQsIFRQYXlsb2FkPiwgVEV2ZW50IGV4dGVuZHMgRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50ID0gYW55LCBUUGF5bG9hZCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4gPSBSZWNvcmQ8c3RyaW5nLCBhbnk+PiBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3NvcjxUPiB7XG5cbiAgYWJzdHJhY3Qgc2VhcmNoRW5naW5lOiBCYXNlU2VhcmNoRW5naW5lO1xuXG5cbiAgLy8gb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIGEgbGlzdCBvZiBhbGxvd2VkIGVudGl0eSBuYW1lc1xuICBwcm90ZWN0ZWQgZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIGEgbGlzdCBvZiBleGNsdWRlZCBlbnRpdHkgbmFtZXNcbiAgcHJvdGVjdGVkIGdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyBpZiBhbiBlbnRpdHkgc2hvdWxkIGJlIGluZGV4ZWQgYmFzZWQgb24gYWxsb3dlZC9leGNsdWRlZCBsaXN0cy5cbiAgICogT3ZlcnJpZGUgaW4gc3ViY2xhc3NlcyB0byBpbXBsZW1lbnQgY3VzdG9tIGxvZ2ljLlxuICAgKiBEZWZhdWx0IGJlaGF2aW9yOiBpbmRleCBhbGwgZXhjZXB0IHN5c3RlbSBlbnRpdGllcy5cbiAgICovXG4gIHByb3RlY3RlZCBzaG91bGRJbmRleEVudGl0eShlbnRpdHlOYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSB0aGlzLmdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTtcblxuICAgIC8vIEV4Y2x1ZGVkIGxpc3QgQUxXQVlTIHdpbnMgKHNhZmVyIGRlZmF1bHQpLlxuICAgIGlmIChleGNsdWRlZEVudGl0eU5hbWVzICYmIGV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCAmJiBleGNsdWRlZEVudGl0eU5hbWVzLmluY2x1ZGVzKGVudGl0eU5hbWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gSWYgYWxsb3dlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCByZXN0cmljdCBpbmRleGluZyB0byB0aGF0IGxpc3QuXG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcyAmJiBhbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIGFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKTtcbiAgICB9XG5cbiAgICAvLyBPdGhlcndpc2UsIGlmIGV4Y2x1ZGVkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIGluZGV4IGFsbCBleGNlcHQgZXhjbHVkZWQgKGFscmVhZHkgaGFuZGxlZCBhYm92ZSkuXG4gICAgaWYgKGV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgZXhjbHVkZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IGJlaGF2aW9yOiBpbmRleCBhbGwgZW50aXRpZXNcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcmVwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPGFueT4pOiBQcm9taXNlPEJhc2VFdmVudFJlY29yZDxhbnk+IHwgbnVsbD4ge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUgfSA9IHJlY29yZDtcblxuICAgIGlmICghWyAnY3JlYXRlJywgJ3VwZGF0ZScsICdkZWxldGUnIF0uaW5jbHVkZXMoZXZlbnRUeXBlKSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgcmVjb3JkIHdpdGggdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFlbnRpdHlOYW1lKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCBubyBlbnRpdHkgbmFtZScsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLnNob3VsZEluZGV4RW50aXR5KGVudGl0eU5hbWUpKSB7XG4gICAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuICAgICAgY29uc3QgZXhjbHVkZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpO1xuICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgc2VhcmNoIGluZGV4aW5nIGZvciBlbnRpdHkgYmFzZWQgb24gZmlsdGVyaW5nIHJ1bGVzJywge1xuICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICBhbGxvd2VkRW50aXR5TmFtZXMsXG4gICAgICAgIGV4Y2x1ZGVkRW50aXR5TmFtZXNcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIC8vIEltcGxlbWVudGF0aW9uIGZvciBwZXItcmVjb3JkIHByb2Nlc3NpbmdcbiAgcHJvdGVjdGVkIG92ZXJyaWRlIGFzeW5jIHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQgfSA9IHJlY29yZDtcblxuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3Npbmcgc2luZ2xlIHJlY29yZCBmb3Igc2VhcmNoIGluZGV4aW5nJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkIH0pO1xuXG4gICAgY29uc3Qgc2VhcmNoSW5kZXhFbnRyeSA9IHRoaXMuY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShyZWNvcmQpO1xuICAgIGF3YWl0IHRoaXMuaW5kZXhPckRlbGV0ZURvY3VtZW50KHNlYXJjaEluZGV4RW50cnkpO1xuXG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NpbmdsZSByZWNvcmQgcHJvY2Vzc2luZyBjb21wbGV0ZWQnLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQsIGR1cmF0aW9uTXM6IGR1cmF0aW9uIH0pO1xuICB9XG5cbiAgLy8gSW1wbGVtZW50YXRpb24gZm9yIGJhdGNoIHByb2Nlc3NpbmdcbiAgcHJvdGVjdGVkIG92ZXJyaWRlIGFzeW5jIHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gR3JvdXAgYnkgZW50aXR5TmFtZSBhbmQgZXZlbnRUeXBlIHRvIG1pbmltaXplIGVuZ2luZSBjYWxsc1xuICAgIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlYyBvZiByZWNvcmRzKSB7XG4gICAgICBjb25zdCBrZXkgPSBgJHtyZWMuZW50aXR5TmFtZSB8fCAnJ318JHtyZWMuZXZlbnRUeXBlfWA7XG4gICAgICBjb25zdCBhcnIgPSBncm91cHMuZ2V0KGtleSkgfHwgW107XG4gICAgICBhcnIucHVzaChyZWMpO1xuICAgICAgZ3JvdXBzLnNldChrZXksIGFycik7XG4gICAgfVxuXG4gICAgLy8gSG90IHBhdGg6IG9ubHkgYSBjaGVhcCBzdW1tYXJ5IGF0IGRlYnVnLiBUaGUgb2xkIHBlci1ncm91cCBgZ3JvdXBEZXRhaWxzYCBhcnJheSB3YXMgYnVpbHQgb25cbiAgICAvLyBFVkVSWSBiYXRjaCAoYXJndW1lbnRzIGFyZSBldmFsdWF0ZWQgYmVmb3JlIHRoZSBsb2cgY2FsbCwgc28gZXZlbiBhIHN1cHByZXNzZWQgZGVidWcgcGFpZCBmb3IgaXQpXG4gICAgLy8gYW5kIGFkZGVkIG5vIHZhbHVlIGF0IHRoZSB2b2x1bWUgdGhlIHN0cmVhbS9pbmRleGVyIHJ1bnMgYXQuXG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ1JlY29yZHMgZ3JvdXBlZCBmb3IgYmF0Y2ggcHJvY2Vzc2luZycsIHtcbiAgICAgIHRvdGFsR3JvdXBzOiBncm91cHMuc2l6ZSxcbiAgICAgIHRvdGFsUmVjb3JkczogcmVjb3Jkcy5sZW5ndGgsXG4gICAgfSk7XG5cbiAgICAvLyBQcm9jZXNzIGVhY2ggZ3JvdXAgdXNpbmcgQmF0Y2hQcm9ncmVzc1xuICAgIGZvciAoY29uc3QgWyBrZXksIGdyb3VwUmVjb3JkcyBdIG9mIGdyb3Vwcy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IFsgZW50aXR5TmFtZSwgZXZlbnRUeXBlIF0gPSBrZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHVua25vd24gZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlLCBjb3VudDogZ3JvdXBSZWNvcmRzLmxlbmd0aCB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcignSW5kZXggZG9lcyBub3QgZXhpc3QsIHNraXBwaW5nIGdyb3VwJywgeyBpbmRleE5hbWUsIGVudGl0eU5hbWUsIGVycm9yIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50VHlwZSA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzQmF0Y2hEZWxldGUoZ3JvdXBSZWNvcmRzLCBpbmRleE5hbWUsIGVudGl0eU5hbWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzQmF0Y2hJbmRleChncm91cFJlY29yZHMsIGluZGV4TmFtZSwgZW50aXR5TmFtZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgYmF0Y2ggaW5kZXggdXNpbmcgQmF0Y2hQcm9ncmVzcy5jaHVua1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzQmF0Y2hJbmRleChcbiAgICByZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10sXG4gICAgaW5kZXhOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFRyYW5zZm9ybSByZWNvcmRzIHRvIGRvY3VtZW50c1xuICAgIGludGVyZmFjZSBEb2NXaXRoSWQgeyBkb2M6IGFueTsgaWQ6IHN0cmluZyB9XG4gICAgY29uc3QgZG9jczogRG9jV2l0aElkW10gPSBbXTtcbiAgICBjb25zdCBub3dJc28gPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgICBjb25zdCBzZWFyY2hJbmRleEVudHJ5ID0gdGhpcy5jcmVhdGVTZWFyY2hJbmRleEVudHJ5KHJlY29yZCk7XG4gICAgICBjb25zdCB0cmFuc2Zvcm1lZERhdGEgPSBzZWFyY2hJbmRleEVudHJ5LmRhdGE7XG5cbiAgICAgIGNvbnN0IGl0ZW1zOiBhbnlbXSA9IEFycmF5LmlzQXJyYXkodHJhbnNmb3JtZWREYXRhKVxuICAgICAgICA/IHRyYW5zZm9ybWVkRGF0YVxuICAgICAgICA6IChBcnJheS5pc0FycmF5KHRyYW5zZm9ybWVkRGF0YT8uaXRlbXMpID8gdHJhbnNmb3JtZWREYXRhLml0ZW1zIDogWyB0cmFuc2Zvcm1lZERhdGEgXSk7XG5cbiAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgICBjb25zdCBpZCA9IGl0ZW0/LmlkIHx8IGl0ZW0/LlsgYCR7ZW50aXR5TmFtZX1JZGAgXSB8fCAocmVjb3JkLmVudGl0eUlkIGFzIHN0cmluZyB8IHVuZGVmaW5lZCk7XG4gICAgICAgIGlmICghaWQpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBpdGVtIHdpdGhvdXQgaWQnLCB7IGVudGl0eU5hbWUgfSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkb2MgPSBpdGVtPy5pZCA/IHsgLi4uaXRlbSB9IDogeyAuLi5pdGVtLCBpZCB9O1xuICAgICAgICBpZiAoIWRvYy5faW5kZXhlZEF0KSB7XG4gICAgICAgICAgZG9jLl9pbmRleGVkQXQgPSBub3dJc287XG4gICAgICAgIH1cbiAgICAgICAgZG9jcy5wdXNoKHsgZG9jLCBpZCB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZG9jcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ05vIGRvY3VtZW50cyB0byBpbmRleCcsIHsgZW50aXR5TmFtZSwgaW5kZXhOYW1lIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEluZGV4IGluIGNodW5rcyAoZGVmYXVsdCAyNSBkb2NzIHBlciBiYXRjaClcbiAgICBhd2FpdCBCYXRjaFByb2dyZXNzLmNodW5rKFxuICAgICAgYEluZGV4ICR7ZW50aXR5TmFtZX1gLFxuICAgICAgZG9jcyxcbiAgICAgIGFzeW5jIChjaHVuaykgPT4ge1xuICAgICAgICBjb25zdCBkb2NzVG9JbmRleCA9IGNodW5rLm1hcChjID0+IGMuZG9jKTtcbiAgICAgICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHMoZG9jc1RvSW5kZXgsIHsgaW5kZXhOYW1lIH0sIGZhbHNlKTtcbiAgICAgICAgcmV0dXJuIGNodW5rLm1hcChjID0+IGMuaWQpO1xuICAgICAgfSxcbiAgICAgIHsgdGFnczogeyBlbnRpdHk6IGVudGl0eU5hbWUgfSB9XG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIGJhdGNoIGRlbGV0ZSB1c2luZyBjaHVua2VkIGRlbGV0aW9uLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzQmF0Y2hEZWxldGUoXG4gICAgcmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdLFxuICAgIGluZGV4TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZ1xuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBFeHRyYWN0IElEcyBmcm9tIHJlY29yZHMgdGhhdCBoYXZlIGVudGl0eUlkXG4gICAgY29uc3QgaWRzID0gcmVjb3Jkc1xuICAgICAgLmZpbHRlcihyID0+IHIuZW50aXR5SWQpXG4gICAgICAubWFwKHIgPT4gci5lbnRpdHlJZCBhcyBzdHJpbmcpO1xuXG4gICAgaWYgKGlkcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ05vIHJlY29yZHMgd2l0aCBlbnRpdHlJZCB0byBkZWxldGUnLCB7IGVudGl0eU5hbWUgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRGVsZXRlIGluIGNodW5rcyAoZGVmYXVsdCAyNSBJRHMgcGVyIGJhdGNoKVxuICAgIGF3YWl0IEJhdGNoUHJvZ3Jlc3MuY2h1bmsoXG4gICAgICBgRGVsZXRlICR7ZW50aXR5TmFtZX1gLFxuICAgICAgaWRzLFxuICAgICAgYXN5bmMgKGNodW5rKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50cyhjaHVuaywgaW5kZXhOYW1lLCBmYWxzZSk7XG4gICAgICAgIHJldHVybiBjaHVuaztcbiAgICAgIH0sXG4gICAgICB7IHRhZ3M6IHsgZW50aXR5OiBlbnRpdHlOYW1lIH0gfVxuICAgICk7XG4gIH1cblxuICAvLyBIZWxwZXIgbWV0aG9kIHRvIGNyZWF0ZSBTZWFyY2hJbmRleEVudHJ5IGZyb20gYSByZWNvcmRcbiAgcHJvdGVjdGVkIGNyZWF0ZVNlYXJjaEluZGV4RW50cnkocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogU2VhcmNoSW5kZXhFbnRyeSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkLCB0aW1lc3RhbXAsIHBheWxvYWQ6IHBheWxvYWREYXRhLCBtZXRhZGF0YSB9ID0gcmVjb3JkO1xuXG4gICAgLy8gRXh0cmFjdCBzZWFyY2hhYmxlIGRhdGEgYmFzZWQgb24gdGhlIHNvdXJjZSB0eXBlXG4gICAgY29uc3Qgc2VhcmNoYWJsZURhdGEgPSB0aGlzLnRyYW5zZm9ybVBheWxvYWRGb3JJbmRleGluZyhwYXlsb2FkRGF0YSwgZXZlbnRUeXBlLCBtZXRhZGF0YT8uc291cmNlKTtcblxuICAgIC8vIE5vdGU6IHRpbWVzdGFtcCBpcyBhbHJlYWR5IGluIG1pbGxpc2Vjb25kcyAoY29udmVydGVkIGZyb20gRHluYW1vREIgc2Vjb25kcyBpbiB0aGUgZGF0YSBleHRyYWN0b3IpXG4gICAgLy8gRXhhbXBsZTogdGltZXN0YW1wID0gMTczNDU2Nzg5MDAwMCAobWlsbGlzZWNvbmRzKSAtPiBcIjIwMjQtMTItMTlUMTA6MzE6MzAuMDAwWlwiXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBlbnRpdHlJZCBhcyBzdHJpbmcsXG4gICAgICBkYXRhOiBzZWFyY2hhYmxlRGF0YSxcbiAgICAgIGV2ZW50VHlwZTogZXZlbnRUeXBlIGFzICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGVsZXRlJyxcbiAgICAgIHRpbWVzdGFtcDogKHRpbWVzdGFtcCA/IG5ldyBEYXRlKHRpbWVzdGFtcCkgOiBuZXcgRGF0ZSgpKS50b0lTT1N0cmluZygpLFxuICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSBhcyBzdHJpbmcsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gcGF5bG9hZCBkYXRhIGZvciBzZWFyY2ggaW5kZXhpbmcgYmFzZWQgb24gc291cmNlIHR5cGVcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgaW4gc3ViY2xhc3NlcyBmb3IgY3VzdG9tIGRhdGEgdHJhbnNmb3JtYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCB0cmFuc2Zvcm1QYXlsb2FkRm9ySW5kZXhpbmcocGF5bG9hZERhdGE6IGFueSwgZXZlbnRUeXBlOiBzdHJpbmcsIHNvdXJjZT86IHN0cmluZyk6IGFueSB7XG4gICAgLy8gRm9yIHN0cmVhbSBzb3VyY2VzLCBwYXlsb2FkIGlzIENoYW5nZVN0cmVhbVBheWxvYWQgZm9ybWF0XG4gICAgaWYgKHNvdXJjZSA9PT0gJ3N0cmVhbScgJiYgcGF5bG9hZERhdGEgJiYgdHlwZW9mIHBheWxvYWREYXRhID09PSAnb2JqZWN0JyAmJlxuICAgICAgKCdvbGRJbWFnZScgaW4gcGF5bG9hZERhdGEgfHwgJ25ld0ltYWdlJyBpbiBwYXlsb2FkRGF0YSB8fCAna2V5cycgaW4gcGF5bG9hZERhdGEpKSB7XG4gICAgICBjb25zdCB7IG9sZEltYWdlLCBuZXdJbWFnZSB9ID0gcGF5bG9hZERhdGE7XG4gICAgICByZXR1cm4gdGhpcy5leHRyYWN0U2VhcmNoYWJsZURhdGFGcm9tQ2hhbmdlU3RyZWFtKG9sZEltYWdlLCBuZXdJbWFnZSwgZXZlbnRUeXBlKTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgYXJyYXkgcGF5bG9hZHMgLSBhZGQgX2luZGV4ZWRBdCB0byBlYWNoIGl0ZW1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXlsb2FkRGF0YSkpIHtcbiAgICAgIHJldHVybiBwYXlsb2FkRGF0YS5tYXAoaXRlbSA9PiAoe1xuICAgICAgICAuLi5pdGVtLFxuICAgICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvLyBGb3Igc2luZ2xlIG9iamVjdCBwYXlsb2FkcywgdXNlIHBheWxvYWQgZGlyZWN0bHlcbiAgICByZXR1cm4ge1xuICAgICAgLi4ucGF5bG9hZERhdGEsXG4gICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3Qgc2VhcmNoYWJsZSBkYXRhIGZyb20gRHluYW1vREIgY2hhbmdlIHN0cmVhbSBmb3JtYXRcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgaW4gc3ViY2xhc3NlcyBmb3IgY3VzdG9tIGZpZWxkIGZpbHRlcmluZ1xuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZWFyY2hhYmxlRGF0YUZyb21DaGFuZ2VTdHJlYW0oXG4gICAgb2xkSW1hZ2U6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgbmV3SW1hZ2U6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgZXZlbnRUeXBlOiBzdHJpbmdcbiAgKTogYW55IHtcbiAgICAvLyBGb3IgZGVsZXRpb25zLCB3ZSBvbmx5IG5lZWQgdGhlIElEIHRvIHJlbW92ZSBmcm9tIGluZGV4XG4gICAgaWYgKGV2ZW50VHlwZSA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIHJldHVybiB7IGlkOiBvbGRJbWFnZT8uaWQgfTtcbiAgICB9XG5cbiAgICAvLyBGb3IgY3JlYXRlcyBhbmQgdXBkYXRlcywgdXNlIHRoZSBuZXcgaW1hZ2VcbiAgICBjb25zdCBzb3VyY2VEYXRhID0gbmV3SW1hZ2UgfHwgb2xkSW1hZ2U7XG4gICAgaWYgKCFzb3VyY2VEYXRhKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgRHluYW1vREIgaW50ZXJuYWwgZmllbGRzIGFuZCBwcmVwYXJlIGZvciBzZWFyY2ggaW5kZXhpbmdcbiAgICBjb25zdCBpZ25vcmVkS2V5cyA9IFtcbiAgICAgICdfX0VEQl9FX18nLCAnX19FREJfVl9fJywgJ1BLJywgJ1NLJyxcbiAgICAgICdHU0kxUEsnLCAnR1NJMVNLJywgJ0dTSTJQSycsICdHU0kyU0snLCAnR1NJM1BLJywgJ0dTSTNTSycsICdHU0k0UEsnLCAnR1NJNFNLJyxcbiAgICAgICdQQVNTV09SRCdcbiAgICBdO1xuXG4gICAgY29uc3Qgc2VhcmNoYWJsZURhdGE6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7IC4uLnNvdXJjZURhdGEgfTtcblxuICAgIE9iamVjdC5rZXlzKHNvdXJjZURhdGEpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmIChpZ25vcmVkS2V5cy5pbmNsdWRlcyhrZXkudG9VcHBlckNhc2UoKSkgfHxcbiAgICAgICAga2V5LnN0YXJ0c1dpdGgoJ19fJykgfHxcbiAgICAgICAgKGtleS5sZW5ndGggPiAzICYmIFsgJ0dTSScsICdMU0knIF0uaW5jbHVkZXMoa2V5LnN1YnN0cmluZygwLCAzKS50b1VwcGVyQ2FzZSgpKSkpIHtcbiAgICAgICAgZGVsZXRlIHNlYXJjaGFibGVEYXRhWyBrZXkgXTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5zZWFyY2hhYmxlRGF0YSxcbiAgICAgIF9pbmRleGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaW5kZXhPckRlbGV0ZURvY3VtZW50KHNlYXJjaEluZGV4RW50cnk6IFNlYXJjaEluZGV4RW50cnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZGF0YSwgaWQgfSA9IHNlYXJjaEluZGV4RW50cnk7XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIHNlYXJjaCBpbmRleCBvcGVyYXRpb24nLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLmdldEluZGV4TmFtZShlbnRpdHlOYW1lKTtcblxuICAgIHRyeSB7XG4gICAgICAvLyBFbnN1cmUgdGhlIGluZGV4IGV4aXN0c1xuICAgICAgLy8gd2Ugd29uJ3QgYmUgYWJsZSB0byBjcmVhdGUgYW4gaW5kZXggaGVyZSBhcyB3ZSBkby1ub3QgaGF2ZSBhY2Nlc3MgdG8gZW50aXR5LWluZGV4IGNvbmZpZy4uIFxuICAgICAgLy8gaW5kZXhlcyBhcmUgc3VwcG9zZWQgdG8gYmUgc2V0dXAgYnkgdGhlIGFwcGxpY2F0aW9uOyBcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcblxuICAgICAgLy8gSGFuZGxlIGRpZmZlcmVudCBldmVudCB0eXBlc1xuICAgICAgc3dpdGNoIChldmVudFR5cGUpIHtcbiAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgICBhd2FpdCB0aGlzLmluZGV4RG9jdW1lbnREYXRhKGluZGV4TmFtZSwgZGF0YSwgaWQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlRG9jdW1lbnQoaW5kZXhOYW1lLCBpZCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybignVW5rbm93biBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdTdWNjZXNzZnVsbHkgcHJvY2Vzc2VkIHNlYXJjaCBpbmRleCBvcGVyYXRpb24nLCB7IGluZGV4TmFtZSwgZXZlbnRUeXBlLCBpZCB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIHNlYXJjaCBpbmRleCBvcGVyYXRpb24nLCB7IGVycm9yLCBpbmRleE5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRJbmRleE5hbWUoZW50aXR5TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB0YWJsZU5hbWVLZXkgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWSB9KTtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygndGFibGVOYW1lS2V5JywgeyB0YWJsZU5hbWVLZXkgfSk7XG4gICAgaWYgKCF0YWJsZU5hbWVLZXkpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hWYWxpZGF0aW9uRXJyb3IoYCR7U0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuVEFCTEVfTkFNRV9FTlZfS0VZfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCB0byBjYWxjdWxhdGUgdGhlIGFwcHJvcHJpYXRlIGluZGV4LW5hbWVgKTtcbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IHRhYmxlTmFtZUtleSwgc3VmZml4OiAndGFibGUnIH0pO1xuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCd0YWJsZU5hbWUnLCB7IHRhYmxlTmFtZSB9KTtcblxuICAgIGlmICghdGFibGVOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoVmFsaWRhdGlvbkVycm9yKGAke3RhYmxlTmFtZX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lYCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXhOYW1lID0gbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSh7IHRhYmxlTmFtZSwgZW50aXR5TmFtZSB9KTtcblxuICAgIHJldHVybiBpbmRleE5hbWU7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuICAgIGlmICghZXhpc3RzKSB7XG4gICAgICAvLyBBdXRvLXByb3Zpc2lvbiBpbnN0ZWFkIG9mIGVycm9yaW5nLiBQcmV2aW91c2x5IHRoaXMgdGhyZXcgXCJJbmRleCBkb2VzIG5vdCBleGlzdFwiLCBzbyBhbnlcbiAgICAgIC8vIHNlYXJjaGFibGUgZW50aXR5IHdob3NlIGluZGV4IHdhcyBuZXZlciBwcm92aXNpb25lZCAoYWRkZWQgYWZ0ZXIgaW5pdGlhbCBzZXR1cCwgb3IgYSBmcmVzaFxuICAgICAgLy8gZGVwbG95KSBlcnJvcmVkIG9uIEVWRVJZIHN5bmMgZm9yZXZlciB3aXRoIG5vIHNlbGYtaGVhbC4gVGhlIGVuZ2luZSBjcmVhdGVzIHRoZSBpbmRleFxuICAgICAgLy8gKHByaW1hcnlLZXkgZGVmYXVsdHMgdG8gYGlkYCwgd2hpY2ggdGhlIGluZGV4ZXIgc3RhbXBzIG9uIGV2ZXJ5IGRvY3VtZW50KSBhbmQgYXBwbGllc1xuICAgICAgLy8gZGVmYXVsdCBzZXR0aW5nczsgYSByaWNoZXIgcGVyLWVudGl0eSBjb25maWcgY2FuIHN0aWxsIGJlIGFwcGxpZWQgdmlhIHRoZSBlbnRpdHkgc2VhcmNoXG4gICAgICAvLyBzZXJ2aWNlJ3MgaW5pdFNlYXJjaEluZGV4KCkuIEVudGl0aWVzIHRoYXQgc2hvdWxkIE5PVCBiZSBpbmRleGVkIGFyZSBmaWx0ZXJlZCB1cHN0cmVhbSBieVxuICAgICAgLy8gc2hvdWxkSW5kZXhFbnRpdHkoKSwgc28gdGhpcyBvbmx5IGNyZWF0ZXMgaW5kZXhlcyBmb3IgZW50aXRpZXMgbWVhbnQgdG8gYmUgc2VhcmNoYWJsZS5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0luZGV4IGRvZXMgbm90IGV4aXN0IOKAlCBhdXRvLWNyZWF0aW5nJywgeyBpbmRleE5hbWUgfSk7XG4gICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbml0SW5kZXgoeyBpbmRleE5hbWUgfSwgdHJ1ZSk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGluZGV4RG9jdW1lbnREYXRhKGluZGV4TmFtZTogc3RyaW5nLCBkYXRhOiBhbnksIGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWRhdGEgfHwgIWRhdGEuaWQpIHtcbiAgICAgIC8vIEVuc3VyZSB0aGUgZG9jdW1lbnQgaGFzIGFuIElEXG4gICAgICBkYXRhID0geyAuLi5kYXRhLCBpZCB9O1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzKFsgZGF0YSBdLCB7IGluZGV4TmFtZSB9LCBmYWxzZSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnRG9jdW1lbnQgaW5kZXhlZCBzdWNjZXNzZnVsbHknLCB7IGluZGV4TmFtZSwgaWQgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVsZXRlRG9jdW1lbnQoaW5kZXhOYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMoWyBpZCBdLCBpbmRleE5hbWUsIGZhbHNlKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdEb2N1bWVudCBkZWxldGVkIHN1Y2Nlc3NmdWxseScsIHsgaW5kZXhOYW1lLCBpZCB9KTtcbiAgfVxuXG59Il19