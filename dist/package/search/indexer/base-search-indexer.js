"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSearchIndexer = void 0;
const base_sqs_event_processor_1 = require("../../core/runtime/event-processor/base-sqs-event-processor");
const utils_1 = require("../../utils");
const errors_1 = require("../errors");
const search_utils_1 = require("../search-utils");
const interfaces_1 = require("./interfaces");
class BaseSearchIndexer extends base_sqs_event_processor_1.BaseSQSEventProcessor {
    // override this to provide a list of allowed entity names
    getAllowedEntityNames() {
        return undefined;
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
        const allowedEntityNames = this.getAllowedEntityNames();
        if (allowedEntityNames && allowedEntityNames.length > 0) {
            if (!allowedEntityNames.includes(entityName)) {
                this.logger.warn('Skipping search indexing for entity not in allowed list', { entityName, allowedEntityNames });
                return null;
            }
        }
        else if (entityName === 'auditLog' || entityName.includes('search-index')) {
            this.logger.warn('Skipping search indexing for system entity', { entityName });
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
        const startTime = Date.now();
        this.logger.info('Starting batch search indexing', { recordCount: records.length });
        // Group by entityName and eventType to minimize engine calls
        const groups = new Map();
        for (const rec of records) {
            const key = `${rec.entityName || ''}|${rec.eventType}`;
            const arr = groups.get(key) || [];
            arr.push(rec);
            groups.set(key, arr);
        }
        this.logger.info('Records grouped for batch processing', {
            totalGroups: groups.size,
            groupDetails: Array.from(groups.entries()).map(([key, records]) => ({
                group: key,
                recordCount: records.length
            }))
        });
        let totalIndexed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;
        for (const [key, groupRecords] of groups.entries()) {
            const groupStartTime = Date.now();
            const [entityName, eventType] = key.split('|');
            this.logger.info('Processing batch group', { group: key, recordCount: groupRecords.length, entityName, eventType });
            const indexName = this.getIndexName(entityName);
            await this.ensureIndexExists(indexName);
            switch (eventType) {
                case 'create':
                case 'update': {
                    // Build documents from each record's payload (supports object, array, or payload.items)
                    const documents = [];
                    const nowIso = new Date().toISOString();
                    for (const gr of groupRecords) {
                        // Use the same transformation logic as individual record processing
                        const searchIndexEntry = this.createSearchIndexEntry(gr);
                        const transformedData = searchIndexEntry.data;
                        // Handle both array and single item payloads after transformation
                        const items = Array.isArray(transformedData)
                            ? transformedData
                            : (Array.isArray(transformedData?.items) ? transformedData.items : [transformedData]);
                        for (const item of items) {
                            const id = item?.id || item?.[`${entityName}Id`] || gr.entityId;
                            if (!id) {
                                this.logger.warn('Skipping item without id during batch index', { entityName, itemKeys: Object.keys(item || {}) });
                                totalSkipped++;
                                continue;
                            }
                            const doc = item?.id ? { ...item } : { ...item, id };
                            if (!doc._indexedAt) {
                                doc._indexedAt = nowIso;
                            }
                            documents.push(doc);
                        }
                    }
                    if (documents.length === 0) {
                        this.logger.info('No documents to index after payload normalization', { group: key });
                        break;
                    }
                    this.logger.info('Executing batch index operation', { group: key, documentCount: documents.length, indexName });
                    await this.searchEngine.indexDocuments(documents, { indexName }, false);
                    totalIndexed += documents.length;
                    const groupDuration = Date.now() - groupStartTime;
                    this.logger.info('Batch index operation completed', {
                        group: key,
                        indexedCount: documents.length,
                        durationMs: groupDuration,
                        avgTimePerDocument: groupDuration / documents.length
                    });
                    break;
                }
                case 'delete': {
                    const ids = groupRecords.map(gr => gr.entityId);
                    this.logger.info('Executing batch delete operation', { group: key, idCount: ids.length, indexName });
                    await this.searchEngine.deleteDocuments(ids, indexName, false);
                    totalDeleted += ids.length;
                    const groupDuration = Date.now() - groupStartTime;
                    this.logger.info('Batch delete operation completed', {
                        group: key,
                        deletedCount: ids.length,
                        durationMs: groupDuration
                    });
                    break;
                }
                default:
                    this.logger.warn('Unknown event type in batch', { eventType, groupSize: groupRecords.length });
            }
        }
        const totalDuration = Date.now() - startTime;
        this.logger.info('Batch search indexing completed', {
            totalRecords: records.length,
            totalGroups: groups.size,
            totalIndexed,
            totalDeleted,
            totalSkipped,
            durationMs: totalDuration,
            avgTimePerRecord: totalDuration / records.length,
            avgTimePerGroup: totalDuration / groups.size
        });
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
        this.logger.info('tableNameKey', { tableNameKey });
        if (!tableNameKey) {
            throw new errors_1.SearchValidationError(`${interfaces_1.SEARCH_INDEXER_ENV_KEYS.TABLE_NAME_ENV_KEY} environment variable is required to calculate the appropriate index-name`);
        }
        const tableName = (0, utils_1.resolveEnvValueFor)({ key: tableNameKey, suffix: 'table' });
        this.logger.info('tableName', { tableName });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQXFFO0FBQ3JFLGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFFekUsTUFBc0IsaUJBQW9MLFNBQVEsZ0RBQXdCO0lBS3hPLDBEQUEwRDtJQUNoRCxxQkFBcUI7UUFDN0IsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVTLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUE0QjtRQUUzRCxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxHQUFHLE1BQU0sQ0FBQztRQUV6QyxJQUFJLENBQUMsQ0FBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQzFELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDZDQUE2QyxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUMvRSxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBQ3BFLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFFeEQsSUFBSSxrQkFBa0IsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFFeEQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUM3QyxJQUFJLENBQUMs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QUFDLFNBQVMsU0FBUyxpQkFBaUIsRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDbEYsQ0FBQztJQUNILENBQUM7SUFFUyxLQUFLLENBQUMsaUJBQWlCLENBQUMsU0FBaUIsRUFBRSxJQUFTLEVBQUUsRUFBVTtRQUN4RSxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ3RCLGdDQUFnQztZQUNoQyxJQUFJLEdBQUcsRUFBRSxHQUFHLElBQUksRUFBRSxFQUFFLEVBQUUsQ0FBQztRQUN6QixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxDQUFFLElBQUksQ0FBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDdkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBRVMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFpQixFQUFFLEVBQVU7UUFDMUQsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGVBQWUsQ0FBQyxDQUFFLEVBQUUsQ0FBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNsRSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7Q0FFRjtBQXZWRCw4Q0F1VkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQlN0cmVhbUV2ZW50LCBTUVNFdmVudCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuXG5pbXBvcnQgeyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2Jhc2Utc3FzLWV2ZW50LXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSAnLi4vZW5naW5lcy9iYXNlJztcbmltcG9ydCB7IFNlYXJjaEVuZ2luZUVycm9yLCBTZWFyY2hWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuLi9lcnJvcnMnO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC11dGlscyc7XG5pbXBvcnQgeyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUywgU2VhcmNoSW5kZXhFbnRyeSB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlU2VhcmNoSW5kZXhlcjxUIGV4dGVuZHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxURXZlbnQsIFRQYXlsb2FkPiwgVEV2ZW50IGV4dGVuZHMgRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50ID0gYW55LCBUUGF5bG9hZCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4gPSBSZWNvcmQ8c3RyaW5nLCBhbnk+PiBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3NvcjxUPiB7XG5cbiAgYWJzdHJhY3Qgc2VhcmNoRW5naW5lOiBCYXNlU2VhcmNoRW5naW5lO1xuXG5cbiAgLy8gb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIGEgbGlzdCBvZiBhbGxvd2VkIGVudGl0eSBuYW1lc1xuICBwcm90ZWN0ZWQgZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByZXByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55Pik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPGFueT4gfCBudWxsPiB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9ID0gcmVjb3JkO1xuXG4gICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCB1bnN1cHBvcnRlZCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHJlY29yZCB3aXRoIG5vIGVudGl0eSBuYW1lJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuXG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcyAmJiBhbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuXG4gICAgICBpZiAoIWFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBzZWFyY2ggaW5kZXhpbmcgZm9yIGVudGl0eSBub3QgaW4gYWxsb3dlZCBsaXN0JywgeyBlbnRpdHlOYW1lLCBhbGxvd2VkRW50aXR5TmFtZXMgfSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgfSBlbHNlIGlmIChlbnRpdHlOYW1lID09PSAnYXVkaXRMb2cnIHx8IGVudGl0eU5hbWUuaW5jbHVkZXMoJ3NlYXJjaC1pbmRleCcpKSB7XG5cbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHNlYXJjaCBpbmRleGluZyBmb3Igc3lzdGVtIGVudGl0eScsIHsgZW50aXR5TmFtZSB9KTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiByZWNvcmQ7XG4gIH1cblxuICAvLyBJbXBsZW1lbnRhdGlvbiBmb3IgcGVyLXJlY29yZCBwcm9jZXNzaW5nXG4gIHByb3RlY3RlZCBvdmVycmlkZSBhc3luYyBwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkIH0gPSByZWNvcmQ7XG4gICAgXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBzaW5nbGUgcmVjb3JkIGZvciBzZWFyY2ggaW5kZXhpbmcnLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQgfSk7XG4gICAgXG4gICAgY29uc3Qgc2VhcmNoSW5kZXhFbnRyeSA9IHRoaXMuY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShyZWNvcmQpO1xuICAgIGF3YWl0IHRoaXMuaW5kZXhPckRlbGV0ZURvY3VtZW50KHNlYXJjaEluZGV4RW50cnkpO1xuICAgIFxuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdTaW5nbGUgcmVjb3JkIHByb2Nlc3NpbmcgY29tcGxldGVkJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkLCBkdXJhdGlvbk1zOiBkdXJhdGlvbiB9KTtcbiAgfVxuXG4gIC8vIEltcGxlbWVudGF0aW9uIGZvciBiYXRjaCBwcm9jZXNzaW5nXG4gIHByb3RlY3RlZCBvdmVycmlkZSBhc3luYyBwcm9jZXNzUmVjb3Jkc0JhdGNoKHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnU3RhcnRpbmcgYmF0Y2ggc2VhcmNoIGluZGV4aW5nJywgeyByZWNvcmRDb3VudDogcmVjb3Jkcy5sZW5ndGggfSk7XG4gICAgXG4gICAgLy8gR3JvdXAgYnkgZW50aXR5TmFtZSBhbmQgZXZlbnRUeXBlIHRvIG1pbmltaXplIGVuZ2luZSBjYWxsc1xuICAgIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlYyBvZiByZWNvcmRzKSB7XG4gICAgICBjb25zdCBrZXkgPSBgJHtyZWMuZW50aXR5TmFtZSB8fCAnJ318JHtyZWMuZXZlbnRUeXBlfWA7XG4gICAgICBjb25zdCBhcnIgPSBncm91cHMuZ2V0KGtleSkgfHwgW107XG4gICAgICBhcnIucHVzaChyZWMpO1xuICAgICAgZ3JvdXBzLnNldChrZXksIGFycik7XG4gICAgfVxuXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnUmVjb3JkcyBncm91cGVkIGZvciBiYXRjaCBwcm9jZXNzaW5nJywgeyBcbiAgICAgIHRvdGFsR3JvdXBzOiBncm91cHMuc2l6ZSwgXG4gICAgICBncm91cERldGFpbHM6IEFycmF5LmZyb20oZ3JvdXBzLmVudHJpZXMoKSkubWFwKChba2V5LCByZWNvcmRzXSkgPT4gKHtcbiAgICAgICAgZ3JvdXA6IGtleSxcbiAgICAgICAgcmVjb3JkQ291bnQ6IHJlY29yZHMubGVuZ3RoXG4gICAgICB9KSlcbiAgICB9KTtcblxuICAgIGxldCB0b3RhbEluZGV4ZWQgPSAwO1xuICAgIGxldCB0b3RhbERlbGV0ZWQgPSAwO1xuICAgIGxldCB0b3RhbFNraXBwZWQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBbIGtleSwgZ3JvdXBSZWNvcmRzIF0gb2YgZ3JvdXBzLmVudHJpZXMoKSkge1xuICAgICAgY29uc3QgZ3JvdXBTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgWyBlbnRpdHlOYW1lLCBldmVudFR5cGUgXSA9IGtleS5zcGxpdCgnfCcpO1xuXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIGJhdGNoIGdyb3VwJywgeyBncm91cDoga2V5LCByZWNvcmRDb3VudDogZ3JvdXBSZWNvcmRzLmxlbmd0aCwgZW50aXR5TmFtZSwgZXZlbnRUeXBlIH0pO1xuXG4gICAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLmdldEluZGV4TmFtZShlbnRpdHlOYW1lKTtcblxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVJbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuXG4gICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBjYXNlICd1cGRhdGUnOiB7XG4gICAgICAgICAgLy8gQnVpbGQgZG9jdW1lbnRzIGZyb20gZWFjaCByZWNvcmQncyBwYXlsb2FkIChzdXBwb3J0cyBvYmplY3QsIGFycmF5LCBvciBwYXlsb2FkLml0ZW1zKVxuICAgICAgICAgIGNvbnN0IGRvY3VtZW50czogYW55W10gPSBbXTtcbiAgICAgICAgICBjb25zdCBub3dJc28gPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGdyIG9mIGdyb3VwUmVjb3Jkcykge1xuICAgICAgICAgICAgLy8gVXNlIHRoZSBzYW1lIHRyYW5zZm9ybWF0aW9uIGxvZ2ljIGFzIGluZGl2aWR1YWwgcmVjb3JkIHByb2Nlc3NpbmdcbiAgICAgICAgICAgIGNvbnN0IHNlYXJjaEluZGV4RW50cnkgPSB0aGlzLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkoZ3IpO1xuICAgICAgICAgICAgY29uc3QgdHJhbnNmb3JtZWREYXRhID0gc2VhcmNoSW5kZXhFbnRyeS5kYXRhO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBIYW5kbGUgYm90aCBhcnJheSBhbmQgc2luZ2xlIGl0ZW0gcGF5bG9hZHMgYWZ0ZXIgdHJhbnNmb3JtYXRpb25cbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zOiBhbnlbXSA9IEFycmF5LmlzQXJyYXkodHJhbnNmb3JtZWREYXRhKVxuICAgICAgICAgICAgICA/IHRyYW5zZm9ybWVkRGF0YVxuICAgICAgICAgICAgICA6IChBcnJheS5pc0FycmF5KHRyYW5zZm9ybWVkRGF0YT8uaXRlbXMpID8gdHJhbnNmb3JtZWREYXRhLml0ZW1zIDogWyB0cmFuc2Zvcm1lZERhdGEgXSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgICAgICAgICBjb25zdCBpZCA9IGl0ZW0/LmlkIHx8IGl0ZW0/LlsgYCR7ZW50aXR5TmFtZX1JZGAgXSB8fCAoZ3IuZW50aXR5SWQgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKTtcbiAgICAgICAgICAgICAgaWYgKCFpZCkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIGl0ZW0gd2l0aG91dCBpZCBkdXJpbmcgYmF0Y2ggaW5kZXgnLCB7IGVudGl0eU5hbWUsIGl0ZW1LZXlzOiBPYmplY3Qua2V5cyhpdGVtIHx8IHt9KSB9KTtcbiAgICAgICAgICAgICAgICB0b3RhbFNraXBwZWQrKztcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IGRvYyA9IGl0ZW0/LmlkID8geyAuLi5pdGVtIH0gOiB7IC4uLml0ZW0sIGlkIH07XG4gICAgICAgICAgICAgIGlmICghZG9jLl9pbmRleGVkQXQpIHtcbiAgICAgICAgICAgICAgICBkb2MuX2luZGV4ZWRBdCA9IG5vd0lzbztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBkb2N1bWVudHMucHVzaChkb2MpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoZG9jdW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTm8gZG9jdW1lbnRzIHRvIGluZGV4IGFmdGVyIHBheWxvYWQgbm9ybWFsaXphdGlvbicsIHsgZ3JvdXA6IGtleSB9KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdFeGVjdXRpbmcgYmF0Y2ggaW5kZXggb3BlcmF0aW9uJywgeyBncm91cDoga2V5LCBkb2N1bWVudENvdW50OiBkb2N1bWVudHMubGVuZ3RoLCBpbmRleE5hbWUgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHMoZG9jdW1lbnRzLCB7IGluZGV4TmFtZSB9LCBmYWxzZSk7XG4gICAgICAgICAgdG90YWxJbmRleGVkICs9IGRvY3VtZW50cy5sZW5ndGg7XG4gICAgICAgICAgXG4gICAgICAgICAgY29uc3QgZ3JvdXBEdXJhdGlvbiA9IERhdGUubm93KCkgLSBncm91cFN0YXJ0VGltZTtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdCYXRjaCBpbmRleCBvcGVyYXRpb24gY29tcGxldGVkJywgeyBcbiAgICAgICAgICAgIGdyb3VwOiBrZXksIFxuICAgICAgICAgICAgaW5kZXhlZENvdW50OiBkb2N1bWVudHMubGVuZ3RoLCBcbiAgICAgICAgICAgIGR1cmF0aW9uTXM6IGdyb3VwRHVyYXRpb24sXG4gICAgICAgICAgICBhdmdUaW1lUGVyRG9jdW1lbnQ6IGdyb3VwRHVyYXRpb24gLyBkb2N1bWVudHMubGVuZ3RoIFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJ2RlbGV0ZSc6IHtcbiAgICAgICAgICBjb25zdCBpZHMgPSBncm91cFJlY29yZHMubWFwKGdyID0+IGdyLmVudGl0eUlkIGFzIHN0cmluZyk7XG4gICAgICAgICAgXG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnRXhlY3V0aW5nIGJhdGNoIGRlbGV0ZSBvcGVyYXRpb24nLCB7IGdyb3VwOiBrZXksIGlkQ291bnQ6IGlkcy5sZW5ndGgsIGluZGV4TmFtZSB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMoaWRzLCBpbmRleE5hbWUsIGZhbHNlKTtcbiAgICAgICAgICB0b3RhbERlbGV0ZWQgKz0gaWRzLmxlbmd0aDtcbiAgICAgICAgICBcbiAgICAgICAgICBjb25zdCBncm91cER1cmF0aW9uID0gRGF0ZS5ub3coKSAtIGdyb3VwU3RhcnRUaW1lO1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0JhdGNoIGRlbGV0ZSBvcGVyYXRpb24gY29tcGxldGVkJywgeyBcbiAgICAgICAgICAgIGdyb3VwOiBrZXksIFxuICAgICAgICAgICAgZGVsZXRlZENvdW50OiBpZHMubGVuZ3RoLCBcbiAgICAgICAgICAgIGR1cmF0aW9uTXM6IGdyb3VwRHVyYXRpb24gXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVbmtub3duIGV2ZW50IHR5cGUgaW4gYmF0Y2gnLCB7IGV2ZW50VHlwZSwgZ3JvdXBTaXplOiBncm91cFJlY29yZHMubGVuZ3RoIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRvdGFsRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ0JhdGNoIHNlYXJjaCBpbmRleGluZyBjb21wbGV0ZWQnLCB7IFxuICAgICAgdG90YWxSZWNvcmRzOiByZWNvcmRzLmxlbmd0aCxcbiAgICAgIHRvdGFsR3JvdXBzOiBncm91cHMuc2l6ZSxcbiAgICAgIHRvdGFsSW5kZXhlZCxcbiAgICAgIHRvdGFsRGVsZXRlZCxcbiAgICAgIHRvdGFsU2tpcHBlZCxcbiAgICAgIGR1cmF0aW9uTXM6IHRvdGFsRHVyYXRpb24sXG4gICAgICBhdmdUaW1lUGVyUmVjb3JkOiB0b3RhbER1cmF0aW9uIC8gcmVjb3Jkcy5sZW5ndGgsXG4gICAgICBhdmdUaW1lUGVyR3JvdXA6IHRvdGFsRHVyYXRpb24gLyBncm91cHMuc2l6ZVxuICAgIH0pO1xuICB9XG5cbiAgLy8gSGVscGVyIG1ldGhvZCB0byBjcmVhdGUgU2VhcmNoSW5kZXhFbnRyeSBmcm9tIGEgcmVjb3JkXG4gIHByb3RlY3RlZCBjcmVhdGVTZWFyY2hJbmRleEVudHJ5KHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPik6IFNlYXJjaEluZGV4RW50cnkge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCwgdGltZXN0YW1wLCBwYXlsb2FkOiBwYXlsb2FkRGF0YSwgbWV0YWRhdGEgfSA9IHJlY29yZDtcbiAgICBcbiAgICAvLyBFeHRyYWN0IHNlYXJjaGFibGUgZGF0YSBiYXNlZCBvbiB0aGUgc291cmNlIHR5cGVcbiAgICBjb25zdCBzZWFyY2hhYmxlRGF0YSA9IHRoaXMudHJhbnNmb3JtUGF5bG9hZEZvckluZGV4aW5nKHBheWxvYWREYXRhLCBldmVudFR5cGUsIG1ldGFkYXRhPy5zb3VyY2UpO1xuICAgIFxuICAgIC8vIE5vdGU6IHRpbWVzdGFtcCBpcyBhbHJlYWR5IGluIG1pbGxpc2Vjb25kcyAoY29udmVydGVkIGZyb20gRHluYW1vREIgc2Vjb25kcyBpbiB0aGUgZGF0YSBleHRyYWN0b3IpXG4gICAgLy8gRXhhbXBsZTogdGltZXN0YW1wID0gMTczNDU2Nzg5MDAwMCAobWlsbGlzZWNvbmRzKSAtPiBcIjIwMjQtMTItMTlUMTA6MzE6MzAuMDAwWlwiXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBlbnRpdHlJZCBhcyBzdHJpbmcsXG4gICAgICBkYXRhOiBzZWFyY2hhYmxlRGF0YSxcbiAgICAgIGV2ZW50VHlwZTogZXZlbnRUeXBlIGFzICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGVsZXRlJyxcbiAgICAgIHRpbWVzdGFtcDogKHRpbWVzdGFtcCA/IG5ldyBEYXRlKHRpbWVzdGFtcCkgOiBuZXcgRGF0ZSgpKS50b0lTT1N0cmluZygpLFxuICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSBhcyBzdHJpbmcsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm0gcGF5bG9hZCBkYXRhIGZvciBzZWFyY2ggaW5kZXhpbmcgYmFzZWQgb24gc291cmNlIHR5cGVcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgaW4gc3ViY2xhc3NlcyBmb3IgY3VzdG9tIGRhdGEgdHJhbnNmb3JtYXRpb25cbiAgICovXG4gIHByb3RlY3RlZCB0cmFuc2Zvcm1QYXlsb2FkRm9ySW5kZXhpbmcocGF5bG9hZERhdGE6IGFueSwgZXZlbnRUeXBlOiBzdHJpbmcsIHNvdXJjZT86IHN0cmluZyk6IGFueSB7XG4gICAgLy8gRm9yIHN0cmVhbSBzb3VyY2VzLCBwYXlsb2FkIGlzIENoYW5nZVN0cmVhbVBheWxvYWQgZm9ybWF0XG4gICAgaWYgKHNvdXJjZSA9PT0gJ3N0cmVhbScgJiYgcGF5bG9hZERhdGEgJiYgdHlwZW9mIHBheWxvYWREYXRhID09PSAnb2JqZWN0JyAmJiBcbiAgICAgICAgKCdvbGRJbWFnZScgaW4gcGF5bG9hZERhdGEgfHwgJ25ld0ltYWdlJyBpbiBwYXlsb2FkRGF0YSB8fCAna2V5cycgaW4gcGF5bG9hZERhdGEpKSB7XG4gICAgICBjb25zdCB7IG9sZEltYWdlLCBuZXdJbWFnZSB9ID0gcGF5bG9hZERhdGE7XG4gICAgICByZXR1cm4gdGhpcy5leHRyYWN0U2VhcmNoYWJsZURhdGFGcm9tQ2hhbmdlU3RyZWFtKG9sZEltYWdlLCBuZXdJbWFnZSwgZXZlbnRUeXBlKTtcbiAgICB9XG4gICAgXG4gICAgLy8gSGFuZGxlIGFycmF5IHBheWxvYWRzIC0gYWRkIF9pbmRleGVkQXQgdG8gZWFjaCBpdGVtXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGF5bG9hZERhdGEpKSB7XG4gICAgICByZXR1cm4gcGF5bG9hZERhdGEubWFwKGl0ZW0gPT4gKHtcbiAgICAgICAgLi4uaXRlbSxcbiAgICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9KSk7XG4gICAgfVxuICAgIFxuICAgIC8vIEZvciBzaW5nbGUgb2JqZWN0IHBheWxvYWRzLCB1c2UgcGF5bG9hZCBkaXJlY3RseVxuICAgIHJldHVybiB7XG4gICAgICAuLi5wYXlsb2FkRGF0YSxcbiAgICAgIF9pbmRleGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBzZWFyY2hhYmxlIGRhdGEgZnJvbSBEeW5hbW9EQiBjaGFuZ2Ugc3RyZWFtIGZvcm1hdFxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBpbiBzdWJjbGFzc2VzIGZvciBjdXN0b20gZmllbGQgZmlsdGVyaW5nXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdFNlYXJjaGFibGVEYXRhRnJvbUNoYW5nZVN0cmVhbShcbiAgICBvbGRJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBuZXdJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBldmVudFR5cGU6IHN0cmluZ1xuICApOiBhbnkge1xuICAgIC8vIEZvciBkZWxldGlvbnMsIHdlIG9ubHkgbmVlZCB0aGUgSUQgdG8gcmVtb3ZlIGZyb20gaW5kZXhcbiAgICBpZiAoZXZlbnRUeXBlID09PSAnZGVsZXRlJykge1xuICAgICAgcmV0dXJuIHsgaWQ6IG9sZEltYWdlPy5pZCB9O1xuICAgIH1cblxuICAgIC8vIEZvciBjcmVhdGVzIGFuZCB1cGRhdGVzLCB1c2UgdGhlIG5ldyBpbWFnZVxuICAgIGNvbnN0IHNvdXJjZURhdGEgPSBuZXdJbWFnZSB8fCBvbGRJbWFnZTtcbiAgICBpZiAoIXNvdXJjZURhdGEpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBEeW5hbW9EQiBpbnRlcm5hbCBmaWVsZHMgYW5kIHByZXBhcmUgZm9yIHNlYXJjaCBpbmRleGluZ1xuICAgIGNvbnN0IGlnbm9yZWRLZXlzID0gW1xuICAgICAgJ19fRURCX0VfXycsICdfX0VEQl9WX18nLCAnUEsnLCAnU0snLCBcbiAgICAgICdHU0kxUEsnLCAnR1NJMVNLJywgJ0dTSTJQSycsICdHU0kyU0snLCAnR1NJM1BLJywgJ0dTSTNTSycsICdHU0k0UEsnLCAnR1NJNFNLJyxcbiAgICAgICdQQVNTV09SRCdcbiAgICBdO1xuXG4gICAgY29uc3Qgc2VhcmNoYWJsZURhdGE6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7IC4uLnNvdXJjZURhdGEgfTtcblxuICAgIE9iamVjdC5rZXlzKHNvdXJjZURhdGEpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIGlmIChpZ25vcmVkS2V5cy5pbmNsdWRlcyhrZXkudG9VcHBlckNhc2UoKSkgfHwgXG4gICAgICAgICAga2V5LnN0YXJ0c1dpdGgoJ19fJykgfHwgXG4gICAgICAgICAgKGtleS5sZW5ndGggPiAzICYmIFsnR1NJJywgJ0xTSSddLmluY2x1ZGVzKGtleS5zdWJzdHJpbmcoMCwgMykudG9VcHBlckNhc2UoKSkpKSB7XG4gICAgICAgIGRlbGV0ZSBzZWFyY2hhYmxlRGF0YVtrZXldO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnNlYXJjaGFibGVEYXRhLFxuICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBpbmRleE9yRGVsZXRlRG9jdW1lbnQoc2VhcmNoSW5kZXhFbnRyeTogU2VhcmNoSW5kZXhFbnRyeSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBkYXRhLCBpZCB9ID0gc2VhcmNoSW5kZXhFbnRyeTtcblxuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3Npbmcgc2VhcmNoIGluZGV4IG9wZXJhdGlvbicsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBpZCB9KTtcblxuICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEVuc3VyZSB0aGUgaW5kZXggZXhpc3RzXG4gICAgICAvLyB3ZSB3b24ndCBiZSBhYmxlIHRvIGNyZWF0ZSBhbiBpbmRleCBoZXJlIGFzIHdlIGRvLW5vdCBoYXZlIGFjY2VzcyB0byBlbnRpdHktaW5kZXggY29uZmlnLi4gXG4gICAgICAvLyBpbmRleGVzIGFyZSBzdXBwb3NlZCB0byBiZSBzZXR1cCBieSB0aGUgYXBwbGljYXRpb247IFxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVJbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuXG4gICAgICAvLyBIYW5kbGUgZGlmZmVyZW50IGV2ZW50IHR5cGVzXG4gICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgICAgIGF3YWl0IHRoaXMuaW5kZXhEb2N1bWVudERhdGEoaW5kZXhOYW1lLCBkYXRhLCBpZCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVEb2N1bWVudChpbmRleE5hbWUsIGlkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVbmtub3duIGV2ZW50IHR5cGUnLCB7IGV2ZW50VHlwZSB9KTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1N1Y2Nlc3NmdWxseSBwcm9jZXNzZWQgc2VhcmNoIGluZGV4IG9wZXJhdGlvbicsIHsgaW5kZXhOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Vycm9yIHByb2Nlc3Npbmcgc2VhcmNoIGluZGV4IG9wZXJhdGlvbicsIHsgZXJyb3IsIGluZGV4TmFtZSwgZXZlbnRUeXBlLCBpZCB9KTtcblxuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGdldEluZGV4TmFtZShlbnRpdHlOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRhYmxlTmFtZUtleSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuVEFCTEVfTkFNRV9FTlZfS0VZIH0pO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ3RhYmxlTmFtZUtleScsIHsgdGFibGVOYW1lS2V5IH0pO1xuICAgIGlmICghdGFibGVOYW1lS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoVmFsaWRhdGlvbkVycm9yKGAke1NFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lYCk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiB0YWJsZU5hbWVLZXksIHN1ZmZpeDogJ3RhYmxlJyB9KTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCd0YWJsZU5hbWUnLCB7IHRhYmxlTmFtZSB9KTtcblxuICAgIGlmICghdGFibGVOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoVmFsaWRhdGlvbkVycm9yKGAke3RhYmxlTmFtZX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lYCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXhOYW1lID0gbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSh7IHRhYmxlTmFtZSwgZW50aXR5TmFtZSB9KTtcblxuICAgIHJldHVybiBpbmRleE5hbWU7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuICAgIGlmICghZXhpc3RzKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYEluZGV4ICR7aW5kZXhOYW1lfSBkb2VzIG5vdCBleGlzdGAsIHsgaW5kZXhOYW1lIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBpbmRleERvY3VtZW50RGF0YShpbmRleE5hbWU6IHN0cmluZywgZGF0YTogYW55LCBpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFkYXRhIHx8ICFkYXRhLmlkKSB7XG4gICAgICAvLyBFbnN1cmUgdGhlIGRvY3VtZW50IGhhcyBhbiBJRFxuICAgICAgZGF0YSA9IHsgLi4uZGF0YSwgaWQgfTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50cyhbIGRhdGEgXSwgeyBpbmRleE5hbWUgfSwgZmFsc2UpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ0RvY3VtZW50IGluZGV4ZWQgc3VjY2Vzc2Z1bGx5JywgeyBpbmRleE5hbWUsIGlkIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlbGV0ZURvY3VtZW50KGluZGV4TmFtZTogc3RyaW5nLCBpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzKFsgaWQgXSwgaW5kZXhOYW1lLCBmYWxzZSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnRG9jdW1lbnQgZGVsZXRlZCBzdWNjZXNzZnVsbHknLCB7IGluZGV4TmFtZSwgaWQgfSk7XG4gIH1cblxufSJdfQ==