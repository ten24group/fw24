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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQXFFO0FBQ3JFLGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFFekUsTUFBc0IsaUJBQW9MLFNBQVEsZ0RBQXdCO0lBS3hPLDBEQUEwRDtJQUNoRCxxQkFBcUI7UUFDN0IsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVTLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUE0QjtRQUUzRCxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxHQUFHLE1BQU0sQ0FBQztRQUV6QyxJQUFJLENBQUMsQ0FBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQzFELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDZDQUE2QyxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUMvRSxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBQ3BFLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFFeEQsSUFBSSxrQkFBa0IsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFFeEQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUM3QyxJQUFJLENBQUMs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RSxDQUFDO1lBQ3RCLGdDQUFnQztZQUNoQyxJQUFJLEdBQUcsRUFBRSxHQUFHLElBQUksRUFBRSxFQUFFLEVBQUUsQ0FBQztRQUN6QixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxDQUFFLElBQUksQ0FBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDdkUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBRVMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFpQixFQUFFLEVBQVU7UUFDMUQsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGVBQWUsQ0FBQyxDQUFFLEVBQUUsQ0FBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNsRSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7Q0FFRjtBQW5WRCw4Q0FtVkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQlN0cmVhbUV2ZW50LCBTUVNFdmVudCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuXG5pbXBvcnQgeyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2Jhc2Utc3FzLWV2ZW50LXByb2Nlc3Nvcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyByZXNvbHZlRW52VmFsdWVGb3IgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSAnLi4vZW5naW5lcy9iYXNlJztcbmltcG9ydCB7IFNlYXJjaEVuZ2luZUVycm9yLCBTZWFyY2hWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuLi9lcnJvcnMnO1xuaW1wb3J0IHsgbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSB9IGZyb20gJy4uL3NlYXJjaC11dGlscyc7XG5pbXBvcnQgeyBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUywgU2VhcmNoSW5kZXhFbnRyeSB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlU2VhcmNoSW5kZXhlcjxUIGV4dGVuZHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxURXZlbnQsIFRQYXlsb2FkPiwgVEV2ZW50IGV4dGVuZHMgRHluYW1vREJTdHJlYW1FdmVudCB8IFNRU0V2ZW50ID0gYW55LCBUUGF5bG9hZCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4gPSBSZWNvcmQ8c3RyaW5nLCBhbnk+PiBleHRlbmRzIEJhc2VTUVNFdmVudFByb2Nlc3NvcjxUPiB7XG5cbiAgYWJzdHJhY3Qgc2VhcmNoRW5naW5lOiBCYXNlU2VhcmNoRW5naW5lO1xuXG5cbiAgLy8gb3ZlcnJpZGUgdGhpcyB0byBwcm92aWRlIGEgbGlzdCBvZiBhbGxvd2VkIGVudGl0eSBuYW1lc1xuICBwcm90ZWN0ZWQgZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByZXByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55Pik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPGFueT4gfCBudWxsPiB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9ID0gcmVjb3JkO1xuXG4gICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCB1bnN1cHBvcnRlZCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHJlY29yZCB3aXRoIG5vIGVudGl0eSBuYW1lJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCBhbGxvd2VkRW50aXR5TmFtZXMgPSB0aGlzLmdldEFsbG93ZWRFbnRpdHlOYW1lcygpO1xuXG4gICAgaWYgKGFsbG93ZWRFbnRpdHlOYW1lcyAmJiBhbGxvd2VkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuXG4gICAgICBpZiAoIWFsbG93ZWRFbnRpdHlOYW1lcy5pbmNsdWRlcyhlbnRpdHlOYW1lKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBzZWFyY2ggaW5kZXhpbmcgZm9yIGVudGl0eSBub3QgaW4gYWxsb3dlZCBsaXN0JywgeyBlbnRpdHlOYW1lLCBhbGxvd2VkRW50aXR5TmFtZXMgfSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIC8vIEltcGxlbWVudGF0aW9uIGZvciBwZXItcmVjb3JkIHByb2Nlc3NpbmdcbiAgcHJvdGVjdGVkIG92ZXJyaWRlIGFzeW5jIHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQgfSA9IHJlY29yZDtcbiAgICBcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIHNpbmdsZSByZWNvcmQgZm9yIHNlYXJjaCBpbmRleGluZycsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCB9KTtcbiAgICBcbiAgICBjb25zdCBzZWFyY2hJbmRleEVudHJ5ID0gdGhpcy5jcmVhdGVTZWFyY2hJbmRleEVudHJ5KHJlY29yZCk7XG4gICAgYXdhaXQgdGhpcy5pbmRleE9yRGVsZXRlRG9jdW1lbnQoc2VhcmNoSW5kZXhFbnRyeSk7XG4gICAgXG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NpbmdsZSByZWNvcmQgcHJvY2Vzc2luZyBjb21wbGV0ZWQnLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQsIGR1cmF0aW9uTXM6IGR1cmF0aW9uIH0pO1xuICB9XG5cbiAgLy8gSW1wbGVtZW50YXRpb24gZm9yIGJhdGNoIHByb2Nlc3NpbmdcbiAgcHJvdGVjdGVkIG92ZXJyaWRlIGFzeW5jIHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdTdGFydGluZyBiYXRjaCBzZWFyY2ggaW5kZXhpbmcnLCB7IHJlY29yZENvdW50OiByZWNvcmRzLmxlbmd0aCB9KTtcbiAgICBcbiAgICAvLyBHcm91cCBieSBlbnRpdHlOYW1lIGFuZCBldmVudFR5cGUgdG8gbWluaW1pemUgZW5naW5lIGNhbGxzXG4gICAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXT4oKTtcblxuICAgIGZvciAoY29uc3QgcmVjIG9mIHJlY29yZHMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGAke3JlYy5lbnRpdHlOYW1lIHx8ICcnfXwke3JlYy5ldmVudFR5cGV9YDtcbiAgICAgIGNvbnN0IGFyciA9IGdyb3Vwcy5nZXQoa2V5KSB8fCBbXTtcbiAgICAgIGFyci5wdXNoKHJlYyk7XG4gICAgICBncm91cHMuc2V0KGtleSwgYXJyKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdSZWNvcmRzIGdyb3VwZWQgZm9yIGJhdGNoIHByb2Nlc3NpbmcnLCB7IFxuICAgICAgdG90YWxHcm91cHM6IGdyb3Vwcy5zaXplLCBcbiAgICAgIGdyb3VwRGV0YWlsczogQXJyYXkuZnJvbShncm91cHMuZW50cmllcygpKS5tYXAoKFtrZXksIHJlY29yZHNdKSA9PiAoe1xuICAgICAgICBncm91cDoga2V5LFxuICAgICAgICByZWNvcmRDb3VudDogcmVjb3Jkcy5sZW5ndGhcbiAgICAgIH0pKVxuICAgIH0pO1xuXG4gICAgbGV0IHRvdGFsSW5kZXhlZCA9IDA7XG4gICAgbGV0IHRvdGFsRGVsZXRlZCA9IDA7XG4gICAgbGV0IHRvdGFsU2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IFsga2V5LCBncm91cFJlY29yZHMgXSBvZiBncm91cHMuZW50cmllcygpKSB7XG4gICAgICBjb25zdCBncm91cFN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICBjb25zdCBbIGVudGl0eU5hbWUsIGV2ZW50VHlwZSBdID0ga2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3NpbmcgYmF0Y2ggZ3JvdXAnLCB7IGdyb3VwOiBrZXksIHJlY29yZENvdW50OiBncm91cFJlY29yZHMubGVuZ3RoLCBlbnRpdHlOYW1lLCBldmVudFR5cGUgfSk7XG5cbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG5cbiAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGNhc2UgJ3VwZGF0ZSc6IHtcbiAgICAgICAgICAvLyBCdWlsZCBkb2N1bWVudHMgZnJvbSBlYWNoIHJlY29yZCdzIHBheWxvYWQgKHN1cHBvcnRzIG9iamVjdCwgYXJyYXksIG9yIHBheWxvYWQuaXRlbXMpXG4gICAgICAgICAgY29uc3QgZG9jdW1lbnRzOiBhbnlbXSA9IFtdO1xuICAgICAgICAgIGNvbnN0IG5vd0lzbyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgZ3Igb2YgZ3JvdXBSZWNvcmRzKSB7XG4gICAgICAgICAgICAvLyBVc2UgdGhlIHNhbWUgdHJhbnNmb3JtYXRpb24gbG9naWMgYXMgaW5kaXZpZHVhbCByZWNvcmQgcHJvY2Vzc2luZ1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoSW5kZXhFbnRyeSA9IHRoaXMuY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShncik7XG4gICAgICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZERhdGEgPSBzZWFyY2hJbmRleEVudHJ5LmRhdGE7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEhhbmRsZSBib3RoIGFycmF5IGFuZCBzaW5nbGUgaXRlbSBwYXlsb2FkcyBhZnRlciB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgY29uc3QgaXRlbXM6IGFueVtdID0gQXJyYXkuaXNBcnJheSh0cmFuc2Zvcm1lZERhdGEpXG4gICAgICAgICAgICAgID8gdHJhbnNmb3JtZWREYXRhXG4gICAgICAgICAgICAgIDogKEFycmF5LmlzQXJyYXkodHJhbnNmb3JtZWREYXRhPy5pdGVtcykgPyB0cmFuc2Zvcm1lZERhdGEuaXRlbXMgOiBbIHRyYW5zZm9ybWVkRGF0YSBdKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGlkID0gaXRlbT8uaWQgfHwgaXRlbT8uWyBgJHtlbnRpdHlOYW1lfUlkYCBdIHx8IChnci5lbnRpdHlJZCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xuICAgICAgICAgICAgICBpZiAoIWlkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgaXRlbSB3aXRob3V0IGlkIGR1cmluZyBiYXRjaCBpbmRleCcsIHsgZW50aXR5TmFtZSwgaXRlbUtleXM6IE9iamVjdC5rZXlzKGl0ZW0gfHwge30pIH0pO1xuICAgICAgICAgICAgICAgIHRvdGFsU2tpcHBlZCsrO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgZG9jID0gaXRlbT8uaWQgPyB7IC4uLml0ZW0gfSA6IHsgLi4uaXRlbSwgaWQgfTtcbiAgICAgICAgICAgICAgaWYgKCFkb2MuX2luZGV4ZWRBdCkge1xuICAgICAgICAgICAgICAgIGRvYy5faW5kZXhlZEF0ID0gbm93SXNvO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGRvY3VtZW50cy5wdXNoKGRvYyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIGlmIChkb2N1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdObyBkb2N1bWVudHMgdG8gaW5kZXggYWZ0ZXIgcGF5bG9hZCBub3JtYWxpemF0aW9uJywgeyBncm91cDoga2V5IH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0V4ZWN1dGluZyBiYXRjaCBpbmRleCBvcGVyYXRpb24nLCB7IGdyb3VwOiBrZXksIGRvY3VtZW50Q291bnQ6IGRvY3VtZW50cy5sZW5ndGgsIGluZGV4TmFtZSB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50cyhkb2N1bWVudHMsIHsgaW5kZXhOYW1lIH0sIGZhbHNlKTtcbiAgICAgICAgICB0b3RhbEluZGV4ZWQgKz0gZG9jdW1lbnRzLmxlbmd0aDtcbiAgICAgICAgICBcbiAgICAgICAgICBjb25zdCBncm91cER1cmF0aW9uID0gRGF0ZS5ub3coKSAtIGdyb3VwU3RhcnRUaW1lO1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0JhdGNoIGluZGV4IG9wZXJhdGlvbiBjb21wbGV0ZWQnLCB7IFxuICAgICAgICAgICAgZ3JvdXA6IGtleSwgXG4gICAgICAgICAgICBpbmRleGVkQ291bnQ6IGRvY3VtZW50cy5sZW5ndGgsIFxuICAgICAgICAgICAgZHVyYXRpb25NczogZ3JvdXBEdXJhdGlvbixcbiAgICAgICAgICAgIGF2Z1RpbWVQZXJEb2N1bWVudDogZ3JvdXBEdXJhdGlvbiAvIGRvY3VtZW50cy5sZW5ndGggXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnZGVsZXRlJzoge1xuICAgICAgICAgIGNvbnN0IGlkcyA9IGdyb3VwUmVjb3Jkcy5tYXAoZ3IgPT4gZ3IuZW50aXR5SWQgYXMgc3RyaW5nKTtcbiAgICAgICAgICBcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdFeGVjdXRpbmcgYmF0Y2ggZGVsZXRlIG9wZXJhdGlvbicsIHsgZ3JvdXA6IGtleSwgaWRDb3VudDogaWRzLmxlbmd0aCwgaW5kZXhOYW1lIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50cyhpZHMsIGluZGV4TmFtZSwgZmFsc2UpO1xuICAgICAgICAgIHRvdGFsRGVsZXRlZCArPSBpZHMubGVuZ3RoO1xuICAgICAgICAgIFxuICAgICAgICAgIGNvbnN0IGdyb3VwRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gZ3JvdXBTdGFydFRpbWU7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQmF0Y2ggZGVsZXRlIG9wZXJhdGlvbiBjb21wbGV0ZWQnLCB7IFxuICAgICAgICAgICAgZ3JvdXA6IGtleSwgXG4gICAgICAgICAgICBkZWxldGVkQ291bnQ6IGlkcy5sZW5ndGgsIFxuICAgICAgICAgICAgZHVyYXRpb25NczogZ3JvdXBEdXJhdGlvbiBcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1Vua25vd24gZXZlbnQgdHlwZSBpbiBiYXRjaCcsIHsgZXZlbnRUeXBlLCBncm91cFNpemU6IGdyb3VwUmVjb3Jkcy5sZW5ndGggfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdG90YWxEdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnQmF0Y2ggc2VhcmNoIGluZGV4aW5nIGNvbXBsZXRlZCcsIHsgXG4gICAgICB0b3RhbFJlY29yZHM6IHJlY29yZHMubGVuZ3RoLFxuICAgICAgdG90YWxHcm91cHM6IGdyb3Vwcy5zaXplLFxuICAgICAgdG90YWxJbmRleGVkLFxuICAgICAgdG90YWxEZWxldGVkLFxuICAgICAgdG90YWxTa2lwcGVkLFxuICAgICAgZHVyYXRpb25NczogdG90YWxEdXJhdGlvbixcbiAgICAgIGF2Z1RpbWVQZXJSZWNvcmQ6IHRvdGFsRHVyYXRpb24gLyByZWNvcmRzLmxlbmd0aCxcbiAgICAgIGF2Z1RpbWVQZXJHcm91cDogdG90YWxEdXJhdGlvbiAvIGdyb3Vwcy5zaXplXG4gICAgfSk7XG4gIH1cblxuICAvLyBIZWxwZXIgbWV0aG9kIHRvIGNyZWF0ZSBTZWFyY2hJbmRleEVudHJ5IGZyb20gYSByZWNvcmRcbiAgcHJvdGVjdGVkIGNyZWF0ZVNlYXJjaEluZGV4RW50cnkocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogU2VhcmNoSW5kZXhFbnRyeSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkLCB0aW1lc3RhbXAsIHBheWxvYWQ6IHBheWxvYWREYXRhLCBtZXRhZGF0YSB9ID0gcmVjb3JkO1xuICAgIFxuICAgIC8vIEV4dHJhY3Qgc2VhcmNoYWJsZSBkYXRhIGJhc2VkIG9uIHRoZSBzb3VyY2UgdHlwZVxuICAgIGNvbnN0IHNlYXJjaGFibGVEYXRhID0gdGhpcy50cmFuc2Zvcm1QYXlsb2FkRm9ySW5kZXhpbmcocGF5bG9hZERhdGEsIGV2ZW50VHlwZSwgbWV0YWRhdGE/LnNvdXJjZSk7XG4gICAgXG4gICAgLy8gTm90ZTogdGltZXN0YW1wIGlzIGFscmVhZHkgaW4gbWlsbGlzZWNvbmRzIChjb252ZXJ0ZWQgZnJvbSBEeW5hbW9EQiBzZWNvbmRzIGluIHRoZSBkYXRhIGV4dHJhY3RvcilcbiAgICAvLyBFeGFtcGxlOiB0aW1lc3RhbXAgPSAxNzM0NTY3ODkwMDAwIChtaWxsaXNlY29uZHMpIC0+IFwiMjAyNC0xMi0xOVQxMDozMTozMC4wMDBaXCJcbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGVudGl0eUlkIGFzIHN0cmluZyxcbiAgICAgIGRhdGE6IHNlYXJjaGFibGVEYXRhLFxuICAgICAgZXZlbnRUeXBlOiBldmVudFR5cGUgYXMgJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZWxldGUnLFxuICAgICAgdGltZXN0YW1wOiAodGltZXN0YW1wID8gbmV3IERhdGUodGltZXN0YW1wKSA6IG5ldyBEYXRlKCkpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lIGFzIHN0cmluZyxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFRyYW5zZm9ybSBwYXlsb2FkIGRhdGEgZm9yIHNlYXJjaCBpbmRleGluZyBiYXNlZCBvbiBzb3VyY2UgdHlwZVxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBpbiBzdWJjbGFzc2VzIGZvciBjdXN0b20gZGF0YSB0cmFuc2Zvcm1hdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIHRyYW5zZm9ybVBheWxvYWRGb3JJbmRleGluZyhwYXlsb2FkRGF0YTogYW55LCBldmVudFR5cGU6IHN0cmluZywgc291cmNlPzogc3RyaW5nKTogYW55IHtcbiAgICAvLyBGb3Igc3RyZWFtIHNvdXJjZXMsIHBheWxvYWQgaXMgQ2hhbmdlU3RyZWFtUGF5bG9hZCBmb3JtYXRcbiAgICBpZiAoc291cmNlID09PSAnc3RyZWFtJyAmJiBwYXlsb2FkRGF0YSAmJiB0eXBlb2YgcGF5bG9hZERhdGEgPT09ICdvYmplY3QnICYmIFxuICAgICAgICAoJ29sZEltYWdlJyBpbiBwYXlsb2FkRGF0YSB8fCAnbmV3SW1hZ2UnIGluIHBheWxvYWREYXRhIHx8ICdrZXlzJyBpbiBwYXlsb2FkRGF0YSkpIHtcbiAgICAgIGNvbnN0IHsgb2xkSW1hZ2UsIG5ld0ltYWdlIH0gPSBwYXlsb2FkRGF0YTtcbiAgICAgIHJldHVybiB0aGlzLmV4dHJhY3RTZWFyY2hhYmxlRGF0YUZyb21DaGFuZ2VTdHJlYW0ob2xkSW1hZ2UsIG5ld0ltYWdlLCBldmVudFR5cGUpO1xuICAgIH1cbiAgICBcbiAgICAvLyBIYW5kbGUgYXJyYXkgcGF5bG9hZHMgLSBhZGQgX2luZGV4ZWRBdCB0byBlYWNoIGl0ZW1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXlsb2FkRGF0YSkpIHtcbiAgICAgIHJldHVybiBwYXlsb2FkRGF0YS5tYXAoaXRlbSA9PiAoe1xuICAgICAgICAuLi5pdGVtLFxuICAgICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0pKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRm9yIHNpbmdsZSBvYmplY3QgcGF5bG9hZHMsIHVzZSBwYXlsb2FkIGRpcmVjdGx5XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnBheWxvYWREYXRhLFxuICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHNlYXJjaGFibGUgZGF0YSBmcm9tIER5bmFtb0RCIGNoYW5nZSBzdHJlYW0gZm9ybWF0XG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGluIHN1YmNsYXNzZXMgZm9yIGN1c3RvbSBmaWVsZCBmaWx0ZXJpbmdcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0U2VhcmNoYWJsZURhdGFGcm9tQ2hhbmdlU3RyZWFtKFxuICAgIG9sZEltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGV2ZW50VHlwZTogc3RyaW5nXG4gICk6IGFueSB7XG4gICAgLy8gRm9yIGRlbGV0aW9ucywgd2Ugb25seSBuZWVkIHRoZSBJRCB0byByZW1vdmUgZnJvbSBpbmRleFxuICAgIGlmIChldmVudFR5cGUgPT09ICdkZWxldGUnKSB7XG4gICAgICByZXR1cm4geyBpZDogb2xkSW1hZ2U/LmlkIH07XG4gICAgfVxuXG4gICAgLy8gRm9yIGNyZWF0ZXMgYW5kIHVwZGF0ZXMsIHVzZSB0aGUgbmV3IGltYWdlXG4gICAgY29uc3Qgc291cmNlRGF0YSA9IG5ld0ltYWdlIHx8IG9sZEltYWdlO1xuICAgIGlmICghc291cmNlRGF0YSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIER5bmFtb0RCIGludGVybmFsIGZpZWxkcyBhbmQgcHJlcGFyZSBmb3Igc2VhcmNoIGluZGV4aW5nXG4gICAgY29uc3QgaWdub3JlZEtleXMgPSBbXG4gICAgICAnX19FREJfRV9fJywgJ19fRURCX1ZfXycsICdQSycsICdTSycsIFxuICAgICAgJ0dTSTFQSycsICdHU0kxU0snLCAnR1NJMlBLJywgJ0dTSTJTSycsICdHU0kzUEsnLCAnR1NJM1NLJywgJ0dTSTRQSycsICdHU0k0U0snLFxuICAgICAgJ1BBU1NXT1JEJ1xuICAgIF07XG5cbiAgICBjb25zdCBzZWFyY2hhYmxlRGF0YTogUmVjb3JkPHN0cmluZywgYW55PiA9IHsgLi4uc291cmNlRGF0YSB9O1xuXG4gICAgT2JqZWN0LmtleXMoc291cmNlRGF0YSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGlnbm9yZWRLZXlzLmluY2x1ZGVzKGtleS50b1VwcGVyQ2FzZSgpKSB8fCBcbiAgICAgICAgICBrZXkuc3RhcnRzV2l0aCgnX18nKSB8fCBcbiAgICAgICAgICAoa2V5Lmxlbmd0aCA+IDMgJiYgWydHU0knLCAnTFNJJ10uaW5jbHVkZXMoa2V5LnN1YnN0cmluZygwLCAzKS50b1VwcGVyQ2FzZSgpKSkpIHtcbiAgICAgICAgZGVsZXRlIHNlYXJjaGFibGVEYXRhW2tleV07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uc2VhcmNoYWJsZURhdGEsXG4gICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGluZGV4T3JEZWxldGVEb2N1bWVudChzZWFyY2hJbmRleEVudHJ5OiBTZWFyY2hJbmRleEVudHJ5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGRhdGEsIGlkIH0gPSBzZWFyY2hJbmRleEVudHJ5O1xuXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgY29uc3QgaW5kZXhOYW1lID0gdGhpcy5nZXRJbmRleE5hbWUoZW50aXR5TmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgLy8gRW5zdXJlIHRoZSBpbmRleCBleGlzdHNcbiAgICAgIC8vIHdlIHdvbid0IGJlIGFibGUgdG8gY3JlYXRlIGFuIGluZGV4IGhlcmUgYXMgd2UgZG8tbm90IGhhdmUgYWNjZXNzIHRvIGVudGl0eS1pbmRleCBjb25maWcuLiBcbiAgICAgIC8vIGluZGV4ZXMgYXJlIHN1cHBvc2VkIHRvIGJlIHNldHVwIGJ5IHRoZSBhcHBsaWNhdGlvbjsgXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG5cbiAgICAgIC8vIEhhbmRsZSBkaWZmZXJlbnQgZXZlbnQgdHlwZXNcbiAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgICAgYXdhaXQgdGhpcy5pbmRleERvY3VtZW50RGF0YShpbmRleE5hbWUsIGRhdGEsIGlkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZURvY3VtZW50KGluZGV4TmFtZSwgaWQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1Vua25vd24gZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnU3VjY2Vzc2Z1bGx5IHByb2Nlc3NlZCBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBpbmRleE5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgcHJvY2Vzc2luZyBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBlcnJvciwgaW5kZXhOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdGFibGVOYW1lS2V5ID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5UQUJMRV9OQU1FX0VOVl9LRVkgfSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygndGFibGVOYW1lS2V5JywgeyB0YWJsZU5hbWVLZXkgfSk7XG4gICAgaWYgKCF0YWJsZU5hbWVLZXkpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hWYWxpZGF0aW9uRXJyb3IoYCR7U0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuVEFCTEVfTkFNRV9FTlZfS0VZfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCB0byBjYWxjdWxhdGUgdGhlIGFwcHJvcHJpYXRlIGluZGV4LW5hbWVgKTtcbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IHRhYmxlTmFtZUtleSwgc3VmZml4OiAndGFibGUnIH0pO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ3RhYmxlTmFtZScsIHsgdGFibGVOYW1lIH0pO1xuXG4gICAgaWYgKCF0YWJsZU5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hWYWxpZGF0aW9uRXJyb3IoYCR7dGFibGVOYW1lfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCB0byBjYWxjdWxhdGUgdGhlIGFwcHJvcHJpYXRlIGluZGV4LW5hbWVgKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbmRleE5hbWUgPSBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHsgdGFibGVOYW1lLCBlbnRpdHlOYW1lIH0pO1xuXG4gICAgcmV0dXJuIGluZGV4TmFtZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBlbnN1cmVJbmRleEV4aXN0cyhpbmRleE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGV4aXN0cyA9IGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG4gICAgaWYgKCFleGlzdHMpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hFbmdpbmVFcnJvcihgSW5kZXggJHtpbmRleE5hbWV9IGRvZXMgbm90IGV4aXN0YCwgeyBpbmRleE5hbWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGluZGV4RG9jdW1lbnREYXRhKGluZGV4TmFtZTogc3RyaW5nLCBkYXRhOiBhbnksIGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWRhdGEgfHwgIWRhdGEuaWQpIHtcbiAgICAgIC8vIEVuc3VyZSB0aGUgZG9jdW1lbnQgaGFzIGFuIElEXG4gICAgICBkYXRhID0geyAuLi5kYXRhLCBpZCB9O1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzKFsgZGF0YSBdLCB7IGluZGV4TmFtZSB9LCBmYWxzZSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnRG9jdW1lbnQgaW5kZXhlZCBzdWNjZXNzZnVsbHknLCB7IGluZGV4TmFtZSwgaWQgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVsZXRlRG9jdW1lbnQoaW5kZXhOYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMoWyBpZCBdLCBpbmRleE5hbWUsIGZhbHNlKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdEb2N1bWVudCBkZWxldGVkIHN1Y2Nlc3NmdWxseScsIHsgaW5kZXhOYW1lLCBpZCB9KTtcbiAgfVxuXG59Il19