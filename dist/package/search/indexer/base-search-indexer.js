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
            throw new errors_1.SearchEngineError(`Index ${indexName} does not exist`, { indexName });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQXFFO0FBQ3JFLGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFDekUsNkVBQXlFO0FBRXpFLE1BQXNCLGlCQUFvTCxTQUFRLGdEQUF3QjtJQUt4TywwREFBMEQ7SUFDaEQscUJBQXFCO1FBQzdCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCwyREFBMkQ7SUFDakQsc0JBQXNCO1FBQzlCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ08saUJBQWlCLENBQUMsVUFBa0I7UUFDNUMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUN4RCxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1FBRTFELDZDQUE2QztRQUM3QyxJQUFJLG1CQUFtQixJQUFJLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksbUJBQW1CLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDdEcsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO1FBRUQscUVBQXFFO1FBQ3JFLElBQUksa0JBQWtCLElBQUksa0JBQWtCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hELE9BQU8sa0JBQWtCLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ2pELENBQUM7UUFFRCxvR0FBb0c7UUFDcEcsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsdUNBQXVD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SUFDSCxDQUFDO0lBRVMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLFNBQWlCLEVBQUUsSUFBUyxFQUFFLEVBQVU7UUFDeEUsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUN0QixnQ0FBZ0M7WUFDaEMsSUFBSSxHQUFHLEVBQUUsR0FBRyxJQUFJLEVBQUUsRUFBRSxFQUFFLENBQUM7UUFDekIsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsQ0FBRSxJQUFJLENBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVTLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUIsRUFBRSxFQUFVO1FBQzFELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxlQUFlLENBQUMsQ0FBRSxFQUFFLENBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RSxDQUFDO0NBRUY7QUE3WEQsOENBNlhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBJRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL2VuZ2luZXMvYmFzZSc7XG5pbXBvcnQgeyBTZWFyY2hFbmdpbmVFcnJvciwgU2VhcmNoVmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcbmltcG9ydCB7IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUgfSBmcm9tICcuLi9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMsIFNlYXJjaEluZGV4RW50cnkgfSBmcm9tICcuL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQmF0Y2hQcm9ncmVzcyB9IGZyb20gJy4uLy4uL29ic2VydmFiaWxpdHkvdXRpbHMvYmF0Y2gtcHJvZ3Jlc3MnO1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVNlYXJjaEluZGV4ZXI8VCBleHRlbmRzIElFdmVudERhdGFFeHRyYWN0b3I8VEV2ZW50LCBUUGF5bG9hZD4sIFRFdmVudCBleHRlbmRzIER5bmFtb0RCU3RyZWFtRXZlbnQgfCBTUVNFdmVudCA9IGFueSwgVFBheWxvYWQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0gUmVjb3JkPHN0cmluZywgYW55Pj4gZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8VD4ge1xuXG4gIGFic3RyYWN0IHNlYXJjaEVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZTtcblxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSBhIGxpc3Qgb2YgYWxsb3dlZCBlbnRpdHkgbmFtZXNcbiAgcHJvdGVjdGVkIGdldEFsbG93ZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSBhIGxpc3Qgb2YgZXhjbHVkZWQgZW50aXR5IG5hbWVzXG4gIHByb3RlY3RlZCBnZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgaWYgYW4gZW50aXR5IHNob3VsZCBiZSBpbmRleGVkIGJhc2VkIG9uIGFsbG93ZWQvZXhjbHVkZWQgbGlzdHMuXG4gICAqIE92ZXJyaWRlIGluIHN1YmNsYXNzZXMgdG8gaW1wbGVtZW50IGN1c3RvbSBsb2dpYy5cbiAgICogRGVmYXVsdCBiZWhhdmlvcjogaW5kZXggYWxsIGV4Y2VwdCBzeXN0ZW0gZW50aXRpZXMuXG4gICAqL1xuICBwcm90ZWN0ZWQgc2hvdWxkSW5kZXhFbnRpdHkoZW50aXR5TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcbiAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk7XG5cbiAgICAvLyBFeGNsdWRlZCBsaXN0IEFMV0FZUyB3aW5zIChzYWZlciBkZWZhdWx0KS5cbiAgICBpZiAoZXhjbHVkZWRFbnRpdHlOYW1lcyAmJiBleGNsdWRlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDAgJiYgZXhjbHVkZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIElmIGFsbG93ZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgcmVzdHJpY3QgaW5kZXhpbmcgdG8gdGhhdCBsaXN0LlxuICAgIGlmIChhbGxvd2VkRW50aXR5TmFtZXMgJiYgYWxsb3dlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhbGxvd2VkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gT3RoZXJ3aXNlLCBpZiBleGNsdWRlZEVudGl0eU5hbWVzIGlzIHByb3ZpZGVkLCBpbmRleCBhbGwgZXhjZXB0IGV4Y2x1ZGVkIChhbHJlYWR5IGhhbmRsZWQgYWJvdmUpLlxuICAgIGlmIChleGNsdWRlZEVudGl0eU5hbWVzICYmIGV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCBiZWhhdmlvcjogaW5kZXggYWxsIGVudGl0aWVzXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJlcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxhbnk+KTogUHJvbWlzZTxCYXNlRXZlbnRSZWNvcmQ8YW55PiB8IG51bGw+IHtcblxuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlIH0gPSByZWNvcmQ7XG5cbiAgICBpZiAoIVsgJ2NyZWF0ZScsICd1cGRhdGUnLCAnZGVsZXRlJyBdLmluY2x1ZGVzKGV2ZW50VHlwZSkpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHJlY29yZCB3aXRoIHVuc3VwcG9ydGVkIGV2ZW50IHR5cGUnLCB7IGV2ZW50VHlwZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghZW50aXR5TmFtZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgcmVjb3JkIHdpdGggbm8gZW50aXR5IG5hbWUnLCB7IHJlY29yZCB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5zaG91bGRJbmRleEVudGl0eShlbnRpdHlOYW1lKSkge1xuICAgICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcbiAgICAgIGNvbnN0IGV4Y2x1ZGVkRW50aXR5TmFtZXMgPSB0aGlzLmdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHNlYXJjaCBpbmRleGluZyBmb3IgZW50aXR5IGJhc2VkIG9uIGZpbHRlcmluZyBydWxlcycsIHtcbiAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgYWxsb3dlZEVudGl0eU5hbWVzLFxuICAgICAgICBleGNsdWRlZEVudGl0eU5hbWVzXG4gICAgICB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZWNvcmQ7XG4gIH1cblxuICAvLyBJbXBsZW1lbnRhdGlvbiBmb3IgcGVyLXJlY29yZCBwcm9jZXNzaW5nXG4gIHByb3RlY3RlZCBvdmVycmlkZSBhc3luYyBwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkIH0gPSByZWNvcmQ7XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIHNpbmdsZSByZWNvcmQgZm9yIHNlYXJjaCBpbmRleGluZycsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCB9KTtcblxuICAgIGNvbnN0IHNlYXJjaEluZGV4RW50cnkgPSB0aGlzLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkocmVjb3JkKTtcbiAgICBhd2FpdCB0aGlzLmluZGV4T3JEZWxldGVEb2N1bWVudChzZWFyY2hJbmRleEVudHJ5KTtcblxuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdTaW5nbGUgcmVjb3JkIHByb2Nlc3NpbmcgY29tcGxldGVkJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkLCBkdXJhdGlvbk1zOiBkdXJhdGlvbiB9KTtcbiAgfVxuXG4gIC8vIEltcGxlbWVudGF0aW9uIGZvciBiYXRjaCBwcm9jZXNzaW5nXG4gIHByb3RlY3RlZCBvdmVycmlkZSBhc3luYyBwcm9jZXNzUmVjb3Jkc0JhdGNoKHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEdyb3VwIGJ5IGVudGl0eU5hbWUgYW5kIGV2ZW50VHlwZSB0byBtaW5pbWl6ZSBlbmdpbmUgY2FsbHNcbiAgICBjb25zdCBncm91cHMgPSBuZXcgTWFwPHN0cmluZywgQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdPigpO1xuXG4gICAgZm9yIChjb25zdCByZWMgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3Qga2V5ID0gYCR7cmVjLmVudGl0eU5hbWUgfHwgJyd9fCR7cmVjLmV2ZW50VHlwZX1gO1xuICAgICAgY29uc3QgYXJyID0gZ3JvdXBzLmdldChrZXkpIHx8IFtdO1xuICAgICAgYXJyLnB1c2gocmVjKTtcbiAgICAgIGdyb3Vwcy5zZXQoa2V5LCBhcnIpO1xuICAgIH1cblxuICAgIC8vIEhvdCBwYXRoOiBvbmx5IGEgY2hlYXAgc3VtbWFyeSBhdCBkZWJ1Zy4gVGhlIG9sZCBwZXItZ3JvdXAgYGdyb3VwRGV0YWlsc2AgYXJyYXkgd2FzIGJ1aWx0IG9uXG4gICAgLy8gRVZFUlkgYmF0Y2ggKGFyZ3VtZW50cyBhcmUgZXZhbHVhdGVkIGJlZm9yZSB0aGUgbG9nIGNhbGwsIHNvIGV2ZW4gYSBzdXBwcmVzc2VkIGRlYnVnIHBhaWQgZm9yIGl0KVxuICAgIC8vIGFuZCBhZGRlZCBubyB2YWx1ZSBhdCB0aGUgdm9sdW1lIHRoZSBzdHJlYW0vaW5kZXhlciBydW5zIGF0LlxuICAgIHRoaXMubG9nZ2VyLmRlYnVnKCdSZWNvcmRzIGdyb3VwZWQgZm9yIGJhdGNoIHByb2Nlc3NpbmcnLCB7XG4gICAgICB0b3RhbEdyb3VwczogZ3JvdXBzLnNpemUsXG4gICAgICB0b3RhbFJlY29yZHM6IHJlY29yZHMubGVuZ3RoLFxuICAgIH0pO1xuXG4gICAgLy8gUHJvY2VzcyBlYWNoIGdyb3VwIHVzaW5nIEJhdGNoUHJvZ3Jlc3NcbiAgICBmb3IgKGNvbnN0IFsga2V5LCBncm91cFJlY29yZHMgXSBvZiBncm91cHMuZW50cmllcygpKSB7XG4gICAgICBjb25zdCBbIGVudGl0eU5hbWUsIGV2ZW50VHlwZSBdID0ga2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIGlmICghWyAnY3JlYXRlJywgJ3VwZGF0ZScsICdkZWxldGUnIF0uaW5jbHVkZXMoZXZlbnRUeXBlKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyB1bmtub3duIGV2ZW50IHR5cGUnLCB7IGV2ZW50VHlwZSwgY291bnQ6IGdyb3VwUmVjb3Jkcy5sZW5ndGggfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLmdldEluZGV4TmFtZShlbnRpdHlOYW1lKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5lbnN1cmVJbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0luZGV4IGRvZXMgbm90IGV4aXN0LCBza2lwcGluZyBncm91cCcsIHsgaW5kZXhOYW1lLCBlbnRpdHlOYW1lLCBlcnJvciB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudFR5cGUgPT09ICdkZWxldGUnKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc0JhdGNoRGVsZXRlKGdyb3VwUmVjb3JkcywgaW5kZXhOYW1lLCBlbnRpdHlOYW1lKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc0JhdGNoSW5kZXgoZ3JvdXBSZWNvcmRzLCBpbmRleE5hbWUsIGVudGl0eU5hbWUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzIGJhdGNoIGluZGV4IHVzaW5nIEJhdGNoUHJvZ3Jlc3MuY2h1bmtcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0JhdGNoSW5kZXgoXG4gICAgcmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdLFxuICAgIGluZGV4TmFtZTogc3RyaW5nLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZ1xuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBUcmFuc2Zvcm0gcmVjb3JkcyB0byBkb2N1bWVudHNcbiAgICBpbnRlcmZhY2UgRG9jV2l0aElkIHsgZG9jOiBhbnk7IGlkOiBzdHJpbmcgfVxuICAgIGNvbnN0IGRvY3M6IERvY1dpdGhJZFtdID0gW107XG4gICAgY29uc3Qgbm93SXNvID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3Qgc2VhcmNoSW5kZXhFbnRyeSA9IHRoaXMuY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShyZWNvcmQpO1xuICAgICAgY29uc3QgdHJhbnNmb3JtZWREYXRhID0gc2VhcmNoSW5kZXhFbnRyeS5kYXRhO1xuXG4gICAgICBjb25zdCBpdGVtczogYW55W10gPSBBcnJheS5pc0FycmF5KHRyYW5zZm9ybWVkRGF0YSlcbiAgICAgICAgPyB0cmFuc2Zvcm1lZERhdGFcbiAgICAgICAgOiAoQXJyYXkuaXNBcnJheSh0cmFuc2Zvcm1lZERhdGE/Lml0ZW1zKSA/IHRyYW5zZm9ybWVkRGF0YS5pdGVtcyA6IFsgdHJhbnNmb3JtZWREYXRhIF0pO1xuXG4gICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgICAgY29uc3QgaWQgPSBpdGVtPy5pZCB8fCBpdGVtPy5bIGAke2VudGl0eU5hbWV9SWRgIF0gfHwgKHJlY29yZC5lbnRpdHlJZCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xuICAgICAgICBpZiAoIWlkKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgaXRlbSB3aXRob3V0IGlkJywgeyBlbnRpdHlOYW1lIH0pO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZG9jID0gaXRlbT8uaWQgPyB7IC4uLml0ZW0gfSA6IHsgLi4uaXRlbSwgaWQgfTtcbiAgICAgICAgaWYgKCFkb2MuX2luZGV4ZWRBdCkge1xuICAgICAgICAgIGRvYy5faW5kZXhlZEF0ID0gbm93SXNvO1xuICAgICAgICB9XG4gICAgICAgIGRvY3MucHVzaCh7IGRvYywgaWQgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGRvY3MubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdObyBkb2N1bWVudHMgdG8gaW5kZXgnLCB7IGVudGl0eU5hbWUsIGluZGV4TmFtZSB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBJbmRleCBpbiBjaHVua3MgKGRlZmF1bHQgMjUgZG9jcyBwZXIgYmF0Y2gpXG4gICAgYXdhaXQgQmF0Y2hQcm9ncmVzcy5jaHVuayhcbiAgICAgIGBJbmRleCAke2VudGl0eU5hbWV9YCxcbiAgICAgIGRvY3MsXG4gICAgICBhc3luYyAoY2h1bmspID0+IHtcbiAgICAgICAgY29uc3QgZG9jc1RvSW5kZXggPSBjaHVuay5tYXAoYyA9PiBjLmRvYyk7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzKGRvY3NUb0luZGV4LCB7IGluZGV4TmFtZSB9LCBmYWxzZSk7XG4gICAgICAgIHJldHVybiBjaHVuay5tYXAoYyA9PiBjLmlkKTtcbiAgICAgIH0sXG4gICAgICB7IHRhZ3M6IHsgZW50aXR5OiBlbnRpdHlOYW1lIH0gfVxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyBiYXRjaCBkZWxldGUgdXNpbmcgY2h1bmtlZCBkZWxldGlvbi5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0JhdGNoRGVsZXRlKFxuICAgIHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXSxcbiAgICBpbmRleE5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRXh0cmFjdCBJRHMgZnJvbSByZWNvcmRzIHRoYXQgaGF2ZSBlbnRpdHlJZFxuICAgIGNvbnN0IGlkcyA9IHJlY29yZHNcbiAgICAgIC5maWx0ZXIociA9PiByLmVudGl0eUlkKVxuICAgICAgLm1hcChyID0+IHIuZW50aXR5SWQgYXMgc3RyaW5nKTtcblxuICAgIGlmIChpZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdObyByZWNvcmRzIHdpdGggZW50aXR5SWQgdG8gZGVsZXRlJywgeyBlbnRpdHlOYW1lIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIERlbGV0ZSBpbiBjaHVua3MgKGRlZmF1bHQgMjUgSURzIHBlciBiYXRjaClcbiAgICBhd2FpdCBCYXRjaFByb2dyZXNzLmNodW5rKFxuICAgICAgYERlbGV0ZSAke2VudGl0eU5hbWV9YCxcbiAgICAgIGlkcyxcbiAgICAgIGFzeW5jIChjaHVuaykgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMoY2h1bmssIGluZGV4TmFtZSwgZmFsc2UpO1xuICAgICAgICByZXR1cm4gY2h1bms7XG4gICAgICB9LFxuICAgICAgeyB0YWdzOiB7IGVudGl0eTogZW50aXR5TmFtZSB9IH1cbiAgICApO1xuICB9XG5cbiAgLy8gSGVscGVyIG1ldGhvZCB0byBjcmVhdGUgU2VhcmNoSW5kZXhFbnRyeSBmcm9tIGEgcmVjb3JkXG4gIHByb3RlY3RlZCBjcmVhdGVTZWFyY2hJbmRleEVudHJ5KHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPik6IFNlYXJjaEluZGV4RW50cnkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCwgdGltZXN0YW1wLCBwYXlsb2FkOiBwYXlsb2FkRGF0YSwgbWV0YWRhdGEgfSA9IHJlY29yZDtcblxuICAgIC8vIEV4dHJhY3Qgc2VhcmNoYWJsZSBkYXRhIGJhc2VkIG9uIHRoZSBzb3VyY2UgdHlwZVxuICAgIGNvbnN0IHNlYXJjaGFibGVEYXRhID0gdGhpcy50cmFuc2Zvcm1QYXlsb2FkRm9ySW5kZXhpbmcocGF5bG9hZERhdGEsIGV2ZW50VHlwZSwgbWV0YWRhdGE/LnNvdXJjZSk7XG5cbiAgICAvLyBOb3RlOiB0aW1lc3RhbXAgaXMgYWxyZWFkeSBpbiBtaWxsaXNlY29uZHMgKGNvbnZlcnRlZCBmcm9tIER5bmFtb0RCIHNlY29uZHMgaW4gdGhlIGRhdGEgZXh0cmFjdG9yKVxuICAgIC8vIEV4YW1wbGU6IHRpbWVzdGFtcCA9IDE3MzQ1Njc4OTAwMDAgKG1pbGxpc2Vjb25kcykgLT4gXCIyMDI0LTEyLTE5VDEwOjMxOjMwLjAwMFpcIlxuICAgIHJldHVybiB7XG4gICAgICBpZDogZW50aXR5SWQgYXMgc3RyaW5nLFxuICAgICAgZGF0YTogc2VhcmNoYWJsZURhdGEsXG4gICAgICBldmVudFR5cGU6IGV2ZW50VHlwZSBhcyAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RlbGV0ZScsXG4gICAgICB0aW1lc3RhbXA6ICh0aW1lc3RhbXAgPyBuZXcgRGF0ZSh0aW1lc3RhbXApIDogbmV3IERhdGUoKSkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUgYXMgc3RyaW5nLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVHJhbnNmb3JtIHBheWxvYWQgZGF0YSBmb3Igc2VhcmNoIGluZGV4aW5nIGJhc2VkIG9uIHNvdXJjZSB0eXBlXG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGluIHN1YmNsYXNzZXMgZm9yIGN1c3RvbSBkYXRhIHRyYW5zZm9ybWF0aW9uXG4gICAqL1xuICBwcm90ZWN0ZWQgdHJhbnNmb3JtUGF5bG9hZEZvckluZGV4aW5nKHBheWxvYWREYXRhOiBhbnksIGV2ZW50VHlwZTogc3RyaW5nLCBzb3VyY2U/OiBzdHJpbmcpOiBhbnkge1xuICAgIC8vIEZvciBzdHJlYW0gc291cmNlcywgcGF5bG9hZCBpcyBDaGFuZ2VTdHJlYW1QYXlsb2FkIGZvcm1hdFxuICAgIGlmIChzb3VyY2UgPT09ICdzdHJlYW0nICYmIHBheWxvYWREYXRhICYmIHR5cGVvZiBwYXlsb2FkRGF0YSA9PT0gJ29iamVjdCcgJiZcbiAgICAgICgnb2xkSW1hZ2UnIGluIHBheWxvYWREYXRhIHx8ICduZXdJbWFnZScgaW4gcGF5bG9hZERhdGEgfHwgJ2tleXMnIGluIHBheWxvYWREYXRhKSkge1xuICAgICAgY29uc3QgeyBvbGRJbWFnZSwgbmV3SW1hZ2UgfSA9IHBheWxvYWREYXRhO1xuICAgICAgcmV0dXJuIHRoaXMuZXh0cmFjdFNlYXJjaGFibGVEYXRhRnJvbUNoYW5nZVN0cmVhbShvbGRJbWFnZSwgbmV3SW1hZ2UsIGV2ZW50VHlwZSk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGFycmF5IHBheWxvYWRzIC0gYWRkIF9pbmRleGVkQXQgdG8gZWFjaCBpdGVtXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGF5bG9hZERhdGEpKSB7XG4gICAgICByZXR1cm4gcGF5bG9hZERhdGEubWFwKGl0ZW0gPT4gKHtcbiAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgLy8gRm9yIHNpbmdsZSBvYmplY3QgcGF5bG9hZHMsIHVzZSBwYXlsb2FkIGRpcmVjdGx5XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnBheWxvYWREYXRhLFxuICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHNlYXJjaGFibGUgZGF0YSBmcm9tIER5bmFtb0RCIGNoYW5nZSBzdHJlYW0gZm9ybWF0XG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGluIHN1YmNsYXNzZXMgZm9yIGN1c3RvbSBmaWVsZCBmaWx0ZXJpbmdcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0U2VhcmNoYWJsZURhdGFGcm9tQ2hhbmdlU3RyZWFtKFxuICAgIG9sZEltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGV2ZW50VHlwZTogc3RyaW5nXG4gICk6IGFueSB7XG4gICAgLy8gRm9yIGRlbGV0aW9ucywgd2Ugb25seSBuZWVkIHRoZSBJRCB0byByZW1vdmUgZnJvbSBpbmRleFxuICAgIGlmIChldmVudFR5cGUgPT09ICdkZWxldGUnKSB7XG4gICAgICByZXR1cm4geyBpZDogb2xkSW1hZ2U/LmlkIH07XG4gICAgfVxuXG4gICAgLy8gRm9yIGNyZWF0ZXMgYW5kIHVwZGF0ZXMsIHVzZSB0aGUgbmV3IGltYWdlXG4gICAgY29uc3Qgc291cmNlRGF0YSA9IG5ld0ltYWdlIHx8IG9sZEltYWdlO1xuICAgIGlmICghc291cmNlRGF0YSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIER5bmFtb0RCIGludGVybmFsIGZpZWxkcyBhbmQgcHJlcGFyZSBmb3Igc2VhcmNoIGluZGV4aW5nXG4gICAgY29uc3QgaWdub3JlZEtleXMgPSBbXG4gICAgICAnX19FREJfRV9fJywgJ19fRURCX1ZfXycsICdQSycsICdTSycsXG4gICAgICAnR1NJMVBLJywgJ0dTSTFTSycsICdHU0kyUEsnLCAnR1NJMlNLJywgJ0dTSTNQSycsICdHU0kzU0snLCAnR1NJNFBLJywgJ0dTSTRTSycsXG4gICAgICAnUEFTU1dPUkQnXG4gICAgXTtcblxuICAgIGNvbnN0IHNlYXJjaGFibGVEYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0geyAuLi5zb3VyY2VEYXRhIH07XG5cbiAgICBPYmplY3Qua2V5cyhzb3VyY2VEYXRhKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICBpZiAoaWdub3JlZEtleXMuaW5jbHVkZXMoa2V5LnRvVXBwZXJDYXNlKCkpIHx8XG4gICAgICAgIGtleS5zdGFydHNXaXRoKCdfXycpIHx8XG4gICAgICAgIChrZXkubGVuZ3RoID4gMyAmJiBbICdHU0knLCAnTFNJJyBdLmluY2x1ZGVzKGtleS5zdWJzdHJpbmcoMCwgMykudG9VcHBlckNhc2UoKSkpKSB7XG4gICAgICAgIGRlbGV0ZSBzZWFyY2hhYmxlRGF0YVsga2V5IF07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uc2VhcmNoYWJsZURhdGEsXG4gICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGluZGV4T3JEZWxldGVEb2N1bWVudChzZWFyY2hJbmRleEVudHJ5OiBTZWFyY2hJbmRleEVudHJ5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGRhdGEsIGlkIH0gPSBzZWFyY2hJbmRleEVudHJ5O1xuXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgY29uc3QgaW5kZXhOYW1lID0gdGhpcy5nZXRJbmRleE5hbWUoZW50aXR5TmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgLy8gRW5zdXJlIHRoZSBpbmRleCBleGlzdHNcbiAgICAgIC8vIHdlIHdvbid0IGJlIGFibGUgdG8gY3JlYXRlIGFuIGluZGV4IGhlcmUgYXMgd2UgZG8tbm90IGhhdmUgYWNjZXNzIHRvIGVudGl0eS1pbmRleCBjb25maWcuLiBcbiAgICAgIC8vIGluZGV4ZXMgYXJlIHN1cHBvc2VkIHRvIGJlIHNldHVwIGJ5IHRoZSBhcHBsaWNhdGlvbjsgXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG5cbiAgICAgIC8vIEhhbmRsZSBkaWZmZXJlbnQgZXZlbnQgdHlwZXNcbiAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgICAgYXdhaXQgdGhpcy5pbmRleERvY3VtZW50RGF0YShpbmRleE5hbWUsIGRhdGEsIGlkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZURvY3VtZW50KGluZGV4TmFtZSwgaWQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1Vua25vd24gZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnU3VjY2Vzc2Z1bGx5IHByb2Nlc3NlZCBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBpbmRleE5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgcHJvY2Vzc2luZyBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBlcnJvciwgaW5kZXhOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdGFibGVOYW1lS2V5ID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5UQUJMRV9OQU1FX0VOVl9LRVkgfSk7XG4gICAgdGhpcy5sb2dnZXIuZGVidWcoJ3RhYmxlTmFtZUtleScsIHsgdGFibGVOYW1lS2V5IH0pO1xuICAgIGlmICghdGFibGVOYW1lS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoVmFsaWRhdGlvbkVycm9yKGAke1NFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lYCk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiB0YWJsZU5hbWVLZXksIHN1ZmZpeDogJ3RhYmxlJyB9KTtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZygndGFibGVOYW1lJywgeyB0YWJsZU5hbWUgfSk7XG5cbiAgICBpZiAoIXRhYmxlTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaFZhbGlkYXRpb25FcnJvcihgJHt0YWJsZU5hbWV9IGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkIHRvIGNhbGN1bGF0ZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXgtbmFtZWApO1xuICAgIH1cblxuICAgIGNvbnN0IGluZGV4TmFtZSA9IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUoeyB0YWJsZU5hbWUsIGVudGl0eU5hbWUgfSk7XG5cbiAgICByZXR1cm4gaW5kZXhOYW1lO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZXhpc3RzID0gYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICBpZiAoIWV4aXN0cykge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKGBJbmRleCAke2luZGV4TmFtZX0gZG9lcyBub3QgZXhpc3RgLCB7IGluZGV4TmFtZSB9KTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaW5kZXhEb2N1bWVudERhdGEoaW5kZXhOYW1lOiBzdHJpbmcsIGRhdGE6IGFueSwgaWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghZGF0YSB8fCAhZGF0YS5pZCkge1xuICAgICAgLy8gRW5zdXJlIHRoZSBkb2N1bWVudCBoYXMgYW4gSURcbiAgICAgIGRhdGEgPSB7IC4uLmRhdGEsIGlkIH07XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHMoWyBkYXRhIF0sIHsgaW5kZXhOYW1lIH0sIGZhbHNlKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdEb2N1bWVudCBpbmRleGVkIHN1Y2Nlc3NmdWxseScsIHsgaW5kZXhOYW1lLCBpZCB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWxldGVEb2N1bWVudChpbmRleE5hbWU6IHN0cmluZywgaWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50cyhbIGlkIF0sIGluZGV4TmFtZSwgZmFsc2UpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ0RvY3VtZW50IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5JywgeyBpbmRleE5hbWUsIGlkIH0pO1xuICB9XG5cbn0iXX0=