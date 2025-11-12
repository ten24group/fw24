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
        // If allowedEntityNames is provided, use it exclusively
        if (allowedEntityNames && allowedEntityNames.length > 0) {
            return allowedEntityNames.includes(entityName);
        }
        // If excludedEntityNames is provided, index all except excluded
        if (excludedEntityNames && excludedEntityNames.length > 0) {
            return !excludedEntityNames.includes(entityName);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQXFFO0FBQ3JFLGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFFekUsTUFBc0IsaUJBQW9MLFNBQVEsZ0RBQXdCO0lBS3hPLDBEQUEwRDtJQUNoRCxxQkFBcUI7UUFDN0IsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELDJEQUEyRDtJQUNqRCxzQkFBc0I7UUFDOUIsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVEOzs7O09BSUc7SUFDTyxpQkFBaUIsQ0FBQyxVQUFrQjtRQUM1QyxNQUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQ3hELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFFMUQsd0RBQXdEO1FBQ3hELElBQUksa0JBQWtCLElBQUksa0JBQWtCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hELE9BQU8sa0JBQWtCLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ2pELENBQUM7UUFFRCxnRUFBZ0U7UUFDaEUsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUQsT0FBTyxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNuRCxDQUFDO1FBRUQsdUNBQXVDO1FBQ3ZDLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVTLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUE0QjtRQUUzRCxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxHQUFHLE1BQU0sQ0FBQztRQUV6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bEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RSxDQUFDO0NBRUY7QUEvV0QsOENBK1dDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBJRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL2VuZ2luZXMvYmFzZSc7XG5pbXBvcnQgeyBTZWFyY2hFbmdpbmVFcnJvciwgU2VhcmNoVmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcbmltcG9ydCB7IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUgfSBmcm9tICcuLi9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMsIFNlYXJjaEluZGV4RW50cnkgfSBmcm9tICcuL2ludGVyZmFjZXMnO1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVNlYXJjaEluZGV4ZXI8VCBleHRlbmRzIElFdmVudERhdGFFeHRyYWN0b3I8VEV2ZW50LCBUUGF5bG9hZD4sIFRFdmVudCBleHRlbmRzIER5bmFtb0RCU3RyZWFtRXZlbnQgfCBTUVNFdmVudCA9IGFueSwgVFBheWxvYWQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0gUmVjb3JkPHN0cmluZywgYW55Pj4gZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8VD4ge1xuXG4gIGFic3RyYWN0IHNlYXJjaEVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZTtcblxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSBhIGxpc3Qgb2YgYWxsb3dlZCBlbnRpdHkgbmFtZXNcbiAgcHJvdGVjdGVkIGdldEFsbG93ZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSBhIGxpc3Qgb2YgZXhjbHVkZWQgZW50aXR5IG5hbWVzXG4gIHByb3RlY3RlZCBnZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgaWYgYW4gZW50aXR5IHNob3VsZCBiZSBpbmRleGVkIGJhc2VkIG9uIGFsbG93ZWQvZXhjbHVkZWQgbGlzdHMuXG4gICAqIE92ZXJyaWRlIGluIHN1YmNsYXNzZXMgdG8gaW1wbGVtZW50IGN1c3RvbSBsb2dpYy5cbiAgICogRGVmYXVsdCBiZWhhdmlvcjogaW5kZXggYWxsIGV4Y2VwdCBzeXN0ZW0gZW50aXRpZXMuXG4gICAqL1xuICBwcm90ZWN0ZWQgc2hvdWxkSW5kZXhFbnRpdHkoZW50aXR5TmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcbiAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk7XG5cbiAgICAvLyBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIHVzZSBpdCBleGNsdXNpdmVseVxuICAgIGlmIChhbGxvd2VkRW50aXR5TmFtZXMgJiYgYWxsb3dlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiBhbGxvd2VkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgLy8gSWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgaW5kZXggYWxsIGV4Y2VwdCBleGNsdWRlZFxuICAgIGlmIChleGNsdWRlZEVudGl0eU5hbWVzICYmIGV4Y2x1ZGVkRW50aXR5TmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuICFleGNsdWRlZEVudGl0eU5hbWVzLmluY2x1ZGVzKGVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8vIERlZmF1bHQgYmVoYXZpb3I6IGluZGV4IGFsbCBlbnRpdGllc1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByZXByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55Pik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPGFueT4gfCBudWxsPiB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9ID0gcmVjb3JkO1xuXG4gICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCB1bnN1cHBvcnRlZCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHJlY29yZCB3aXRoIG5vIGVudGl0eSBuYW1lJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuc2hvdWxkSW5kZXhFbnRpdHkoZW50aXR5TmFtZSkpIHtcbiAgICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk7XG4gICAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBzZWFyY2ggaW5kZXhpbmcgZm9yIGVudGl0eSBiYXNlZCBvbiBmaWx0ZXJpbmcgcnVsZXMnLCB7IFxuICAgICAgICBlbnRpdHlOYW1lLCBcbiAgICAgICAgYWxsb3dlZEVudGl0eU5hbWVzLCBcbiAgICAgICAgZXhjbHVkZWRFbnRpdHlOYW1lcyBcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlY29yZDtcbiAgfVxuXG4gIC8vIEltcGxlbWVudGF0aW9uIGZvciBwZXItcmVjb3JkIHByb2Nlc3NpbmdcbiAgcHJvdGVjdGVkIG92ZXJyaWRlIGFzeW5jIHByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQgfSA9IHJlY29yZDtcbiAgICBcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIHNpbmdsZSByZWNvcmQgZm9yIHNlYXJjaCBpbmRleGluZycsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCB9KTtcbiAgICBcbiAgICBjb25zdCBzZWFyY2hJbmRleEVudHJ5ID0gdGhpcy5jcmVhdGVTZWFyY2hJbmRleEVudHJ5KHJlY29yZCk7XG4gICAgYXdhaXQgdGhpcy5pbmRleE9yRGVsZXRlRG9jdW1lbnQoc2VhcmNoSW5kZXhFbnRyeSk7XG4gICAgXG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1NpbmdsZSByZWNvcmQgcHJvY2Vzc2luZyBjb21wbGV0ZWQnLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQsIGR1cmF0aW9uTXM6IGR1cmF0aW9uIH0pO1xuICB9XG5cbiAgLy8gSW1wbGVtZW50YXRpb24gZm9yIGJhdGNoIHByb2Nlc3NpbmdcbiAgcHJvdGVjdGVkIG92ZXJyaWRlIGFzeW5jIHByb2Nlc3NSZWNvcmRzQmF0Y2gocmVjb3JkczogQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdTdGFydGluZyBiYXRjaCBzZWFyY2ggaW5kZXhpbmcnLCB7IHJlY29yZENvdW50OiByZWNvcmRzLmxlbmd0aCB9KTtcbiAgICBcbiAgICAvLyBHcm91cCBieSBlbnRpdHlOYW1lIGFuZCBldmVudFR5cGUgdG8gbWluaW1pemUgZW5naW5lIGNhbGxzXG4gICAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXT4oKTtcblxuICAgIGZvciAoY29uc3QgcmVjIG9mIHJlY29yZHMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGAke3JlYy5lbnRpdHlOYW1lIHx8ICcnfXwke3JlYy5ldmVudFR5cGV9YDtcbiAgICAgIGNvbnN0IGFyciA9IGdyb3Vwcy5nZXQoa2V5KSB8fCBbXTtcbiAgICAgIGFyci5wdXNoKHJlYyk7XG4gICAgICBncm91cHMuc2V0KGtleSwgYXJyKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdSZWNvcmRzIGdyb3VwZWQgZm9yIGJhdGNoIHByb2Nlc3NpbmcnLCB7IFxuICAgICAgdG90YWxHcm91cHM6IGdyb3Vwcy5zaXplLCBcbiAgICAgIGdyb3VwRGV0YWlsczogQXJyYXkuZnJvbShncm91cHMuZW50cmllcygpKS5tYXAoKFtrZXksIHJlY29yZHNdKSA9PiAoe1xuICAgICAgICBncm91cDoga2V5LFxuICAgICAgICByZWNvcmRDb3VudDogcmVjb3Jkcy5sZW5ndGhcbiAgICAgIH0pKVxuICAgIH0pO1xuXG4gICAgbGV0IHRvdGFsSW5kZXhlZCA9IDA7XG4gICAgbGV0IHRvdGFsRGVsZXRlZCA9IDA7XG4gICAgbGV0IHRvdGFsU2tpcHBlZCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IFsga2V5LCBncm91cFJlY29yZHMgXSBvZiBncm91cHMuZW50cmllcygpKSB7XG4gICAgICBjb25zdCBncm91cFN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgICBjb25zdCBbIGVudGl0eU5hbWUsIGV2ZW50VHlwZSBdID0ga2V5LnNwbGl0KCd8Jyk7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3NpbmcgYmF0Y2ggZ3JvdXAnLCB7IGdyb3VwOiBrZXksIHJlY29yZENvdW50OiBncm91cFJlY29yZHMubGVuZ3RoLCBlbnRpdHlOYW1lLCBldmVudFR5cGUgfSk7XG5cbiAgICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG5cbiAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGNhc2UgJ3VwZGF0ZSc6IHtcbiAgICAgICAgICAvLyBCdWlsZCBkb2N1bWVudHMgZnJvbSBlYWNoIHJlY29yZCdzIHBheWxvYWQgKHN1cHBvcnRzIG9iamVjdCwgYXJyYXksIG9yIHBheWxvYWQuaXRlbXMpXG4gICAgICAgICAgY29uc3QgZG9jdW1lbnRzOiBhbnlbXSA9IFtdO1xuICAgICAgICAgIGNvbnN0IG5vd0lzbyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgZ3Igb2YgZ3JvdXBSZWNvcmRzKSB7XG4gICAgICAgICAgICAvLyBVc2UgdGhlIHNhbWUgdHJhbnNmb3JtYXRpb24gbG9naWMgYXMgaW5kaXZpZHVhbCByZWNvcmQgcHJvY2Vzc2luZ1xuICAgICAgICAgICAgY29uc3Qgc2VhcmNoSW5kZXhFbnRyeSA9IHRoaXMuY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShncik7XG4gICAgICAgICAgICBjb25zdCB0cmFuc2Zvcm1lZERhdGEgPSBzZWFyY2hJbmRleEVudHJ5LmRhdGE7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEhhbmRsZSBib3RoIGFycmF5IGFuZCBzaW5nbGUgaXRlbSBwYXlsb2FkcyBhZnRlciB0cmFuc2Zvcm1hdGlvblxuICAgICAgICAgICAgY29uc3QgaXRlbXM6IGFueVtdID0gQXJyYXkuaXNBcnJheSh0cmFuc2Zvcm1lZERhdGEpXG4gICAgICAgICAgICAgID8gdHJhbnNmb3JtZWREYXRhXG4gICAgICAgICAgICAgIDogKEFycmF5LmlzQXJyYXkodHJhbnNmb3JtZWREYXRhPy5pdGVtcykgPyB0cmFuc2Zvcm1lZERhdGEuaXRlbXMgOiBbIHRyYW5zZm9ybWVkRGF0YSBdKTtcblxuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGlkID0gaXRlbT8uaWQgfHwgaXRlbT8uWyBgJHtlbnRpdHlOYW1lfUlkYCBdIHx8IChnci5lbnRpdHlJZCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xuICAgICAgICAgICAgICBpZiAoIWlkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgaXRlbSB3aXRob3V0IGlkIGR1cmluZyBiYXRjaCBpbmRleCcsIHsgZW50aXR5TmFtZSwgaXRlbUtleXM6IE9iamVjdC5rZXlzKGl0ZW0gfHwge30pIH0pO1xuICAgICAgICAgICAgICAgIHRvdGFsU2tpcHBlZCsrO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgZG9jID0gaXRlbT8uaWQgPyB7IC4uLml0ZW0gfSA6IHsgLi4uaXRlbSwgaWQgfTtcbiAgICAgICAgICAgICAgaWYgKCFkb2MuX2luZGV4ZWRBdCkge1xuICAgICAgICAgICAgICAgIGRvYy5faW5kZXhlZEF0ID0gbm93SXNvO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGRvY3VtZW50cy5wdXNoKGRvYyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIGlmIChkb2N1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdObyBkb2N1bWVudHMgdG8gaW5kZXggYWZ0ZXIgcGF5bG9hZCBub3JtYWxpemF0aW9uJywgeyBncm91cDoga2V5IH0pO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0V4ZWN1dGluZyBiYXRjaCBpbmRleCBvcGVyYXRpb24nLCB7IGdyb3VwOiBrZXksIGRvY3VtZW50Q291bnQ6IGRvY3VtZW50cy5sZW5ndGgsIGluZGV4TmFtZSB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50cyhkb2N1bWVudHMsIHsgaW5kZXhOYW1lIH0sIGZhbHNlKTtcbiAgICAgICAgICB0b3RhbEluZGV4ZWQgKz0gZG9jdW1lbnRzLmxlbmd0aDtcbiAgICAgICAgICBcbiAgICAgICAgICBjb25zdCBncm91cER1cmF0aW9uID0gRGF0ZS5ub3coKSAtIGdyb3VwU3RhcnRUaW1lO1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0JhdGNoIGluZGV4IG9wZXJhdGlvbiBjb21wbGV0ZWQnLCB7IFxuICAgICAgICAgICAgZ3JvdXA6IGtleSwgXG4gICAgICAgICAgICBpbmRleGVkQ291bnQ6IGRvY3VtZW50cy5sZW5ndGgsIFxuICAgICAgICAgICAgZHVyYXRpb25NczogZ3JvdXBEdXJhdGlvbixcbiAgICAgICAgICAgIGF2Z1RpbWVQZXJEb2N1bWVudDogZ3JvdXBEdXJhdGlvbiAvIGRvY3VtZW50cy5sZW5ndGggXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnZGVsZXRlJzoge1xuICAgICAgICAgIGNvbnN0IGlkcyA9IGdyb3VwUmVjb3Jkcy5tYXAoZ3IgPT4gZ3IuZW50aXR5SWQgYXMgc3RyaW5nKTtcbiAgICAgICAgICBcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdFeGVjdXRpbmcgYmF0Y2ggZGVsZXRlIG9wZXJhdGlvbicsIHsgZ3JvdXA6IGtleSwgaWRDb3VudDogaWRzLmxlbmd0aCwgaW5kZXhOYW1lIH0pO1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50cyhpZHMsIGluZGV4TmFtZSwgZmFsc2UpO1xuICAgICAgICAgIHRvdGFsRGVsZXRlZCArPSBpZHMubGVuZ3RoO1xuICAgICAgICAgIFxuICAgICAgICAgIGNvbnN0IGdyb3VwRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gZ3JvdXBTdGFydFRpbWU7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQmF0Y2ggZGVsZXRlIG9wZXJhdGlvbiBjb21wbGV0ZWQnLCB7IFxuICAgICAgICAgICAgZ3JvdXA6IGtleSwgXG4gICAgICAgICAgICBkZWxldGVkQ291bnQ6IGlkcy5sZW5ndGgsIFxuICAgICAgICAgICAgZHVyYXRpb25NczogZ3JvdXBEdXJhdGlvbiBcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1Vua25vd24gZXZlbnQgdHlwZSBpbiBiYXRjaCcsIHsgZXZlbnRUeXBlLCBncm91cFNpemU6IGdyb3VwUmVjb3Jkcy5sZW5ndGggfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdG90YWxEdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnQmF0Y2ggc2VhcmNoIGluZGV4aW5nIGNvbXBsZXRlZCcsIHsgXG4gICAgICB0b3RhbFJlY29yZHM6IHJlY29yZHMubGVuZ3RoLFxuICAgICAgdG90YWxHcm91cHM6IGdyb3Vwcy5zaXplLFxuICAgICAgdG90YWxJbmRleGVkLFxuICAgICAgdG90YWxEZWxldGVkLFxuICAgICAgdG90YWxTa2lwcGVkLFxuICAgICAgZHVyYXRpb25NczogdG90YWxEdXJhdGlvbixcbiAgICAgIGF2Z1RpbWVQZXJSZWNvcmQ6IHRvdGFsRHVyYXRpb24gLyByZWNvcmRzLmxlbmd0aCxcbiAgICAgIGF2Z1RpbWVQZXJHcm91cDogdG90YWxEdXJhdGlvbiAvIGdyb3Vwcy5zaXplXG4gICAgfSk7XG4gIH1cblxuICAvLyBIZWxwZXIgbWV0aG9kIHRvIGNyZWF0ZSBTZWFyY2hJbmRleEVudHJ5IGZyb20gYSByZWNvcmRcbiAgcHJvdGVjdGVkIGNyZWF0ZVNlYXJjaEluZGV4RW50cnkocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+KTogU2VhcmNoSW5kZXhFbnRyeSB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkLCB0aW1lc3RhbXAsIHBheWxvYWQ6IHBheWxvYWREYXRhLCBtZXRhZGF0YSB9ID0gcmVjb3JkO1xuICAgIFxuICAgIC8vIEV4dHJhY3Qgc2VhcmNoYWJsZSBkYXRhIGJhc2VkIG9uIHRoZSBzb3VyY2UgdHlwZVxuICAgIGNvbnN0IHNlYXJjaGFibGVEYXRhID0gdGhpcy50cmFuc2Zvcm1QYXlsb2FkRm9ySW5kZXhpbmcocGF5bG9hZERhdGEsIGV2ZW50VHlwZSwgbWV0YWRhdGE/LnNvdXJjZSk7XG4gICAgXG4gICAgLy8gTm90ZTogdGltZXN0YW1wIGlzIGFscmVhZHkgaW4gbWlsbGlzZWNvbmRzIChjb252ZXJ0ZWQgZnJvbSBEeW5hbW9EQiBzZWNvbmRzIGluIHRoZSBkYXRhIGV4dHJhY3RvcilcbiAgICAvLyBFeGFtcGxlOiB0aW1lc3RhbXAgPSAxNzM0NTY3ODkwMDAwIChtaWxsaXNlY29uZHMpIC0+IFwiMjAyNC0xMi0xOVQxMDozMTozMC4wMDBaXCJcbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGVudGl0eUlkIGFzIHN0cmluZyxcbiAgICAgIGRhdGE6IHNlYXJjaGFibGVEYXRhLFxuICAgICAgZXZlbnRUeXBlOiBldmVudFR5cGUgYXMgJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZWxldGUnLFxuICAgICAgdGltZXN0YW1wOiAodGltZXN0YW1wID8gbmV3IERhdGUodGltZXN0YW1wKSA6IG5ldyBEYXRlKCkpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lIGFzIHN0cmluZyxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFRyYW5zZm9ybSBwYXlsb2FkIGRhdGEgZm9yIHNlYXJjaCBpbmRleGluZyBiYXNlZCBvbiBzb3VyY2UgdHlwZVxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBpbiBzdWJjbGFzc2VzIGZvciBjdXN0b20gZGF0YSB0cmFuc2Zvcm1hdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIHRyYW5zZm9ybVBheWxvYWRGb3JJbmRleGluZyhwYXlsb2FkRGF0YTogYW55LCBldmVudFR5cGU6IHN0cmluZywgc291cmNlPzogc3RyaW5nKTogYW55IHtcbiAgICAvLyBGb3Igc3RyZWFtIHNvdXJjZXMsIHBheWxvYWQgaXMgQ2hhbmdlU3RyZWFtUGF5bG9hZCBmb3JtYXRcbiAgICBpZiAoc291cmNlID09PSAnc3RyZWFtJyAmJiBwYXlsb2FkRGF0YSAmJiB0eXBlb2YgcGF5bG9hZERhdGEgPT09ICdvYmplY3QnICYmIFxuICAgICAgICAoJ29sZEltYWdlJyBpbiBwYXlsb2FkRGF0YSB8fCAnbmV3SW1hZ2UnIGluIHBheWxvYWREYXRhIHx8ICdrZXlzJyBpbiBwYXlsb2FkRGF0YSkpIHtcbiAgICAgIGNvbnN0IHsgb2xkSW1hZ2UsIG5ld0ltYWdlIH0gPSBwYXlsb2FkRGF0YTtcbiAgICAgIHJldHVybiB0aGlzLmV4dHJhY3RTZWFyY2hhYmxlRGF0YUZyb21DaGFuZ2VTdHJlYW0ob2xkSW1hZ2UsIG5ld0ltYWdlLCBldmVudFR5cGUpO1xuICAgIH1cbiAgICBcbiAgICAvLyBIYW5kbGUgYXJyYXkgcGF5bG9hZHMgLSBhZGQgX2luZGV4ZWRBdCB0byBlYWNoIGl0ZW1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShwYXlsb2FkRGF0YSkpIHtcbiAgICAgIHJldHVybiBwYXlsb2FkRGF0YS5tYXAoaXRlbSA9PiAoe1xuICAgICAgICAuLi5pdGVtLFxuICAgICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgIH0pKTtcbiAgICB9XG4gICAgXG4gICAgLy8gRm9yIHNpbmdsZSBvYmplY3QgcGF5bG9hZHMsIHVzZSBwYXlsb2FkIGRpcmVjdGx5XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnBheWxvYWREYXRhLFxuICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHNlYXJjaGFibGUgZGF0YSBmcm9tIER5bmFtb0RCIGNoYW5nZSBzdHJlYW0gZm9ybWF0XG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGluIHN1YmNsYXNzZXMgZm9yIGN1c3RvbSBmaWVsZCBmaWx0ZXJpbmdcbiAgICovXG4gIHByb3RlY3RlZCBleHRyYWN0U2VhcmNoYWJsZURhdGFGcm9tQ2hhbmdlU3RyZWFtKFxuICAgIG9sZEltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIG5ld0ltYWdlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkLFxuICAgIGV2ZW50VHlwZTogc3RyaW5nXG4gICk6IGFueSB7XG4gICAgLy8gRm9yIGRlbGV0aW9ucywgd2Ugb25seSBuZWVkIHRoZSBJRCB0byByZW1vdmUgZnJvbSBpbmRleFxuICAgIGlmIChldmVudFR5cGUgPT09ICdkZWxldGUnKSB7XG4gICAgICByZXR1cm4geyBpZDogb2xkSW1hZ2U/LmlkIH07XG4gICAgfVxuXG4gICAgLy8gRm9yIGNyZWF0ZXMgYW5kIHVwZGF0ZXMsIHVzZSB0aGUgbmV3IGltYWdlXG4gICAgY29uc3Qgc291cmNlRGF0YSA9IG5ld0ltYWdlIHx8IG9sZEltYWdlO1xuICAgIGlmICghc291cmNlRGF0YSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIER5bmFtb0RCIGludGVybmFsIGZpZWxkcyBhbmQgcHJlcGFyZSBmb3Igc2VhcmNoIGluZGV4aW5nXG4gICAgY29uc3QgaWdub3JlZEtleXMgPSBbXG4gICAgICAnX19FREJfRV9fJywgJ19fRURCX1ZfXycsICdQSycsICdTSycsIFxuICAgICAgJ0dTSTFQSycsICdHU0kxU0snLCAnR1NJMlBLJywgJ0dTSTJTSycsICdHU0kzUEsnLCAnR1NJM1NLJywgJ0dTSTRQSycsICdHU0k0U0snLFxuICAgICAgJ1BBU1NXT1JEJ1xuICAgIF07XG5cbiAgICBjb25zdCBzZWFyY2hhYmxlRGF0YTogUmVjb3JkPHN0cmluZywgYW55PiA9IHsgLi4uc291cmNlRGF0YSB9O1xuXG4gICAgT2JqZWN0LmtleXMoc291cmNlRGF0YSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGlnbm9yZWRLZXlzLmluY2x1ZGVzKGtleS50b1VwcGVyQ2FzZSgpKSB8fCBcbiAgICAgICAgICBrZXkuc3RhcnRzV2l0aCgnX18nKSB8fCBcbiAgICAgICAgICAoa2V5Lmxlbmd0aCA+IDMgJiYgWydHU0knLCAnTFNJJ10uaW5jbHVkZXMoa2V5LnN1YnN0cmluZygwLCAzKS50b1VwcGVyQ2FzZSgpKSkpIHtcbiAgICAgICAgZGVsZXRlIHNlYXJjaGFibGVEYXRhW2tleV07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uc2VhcmNoYWJsZURhdGEsXG4gICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGluZGV4T3JEZWxldGVEb2N1bWVudChzZWFyY2hJbmRleEVudHJ5OiBTZWFyY2hJbmRleEVudHJ5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGRhdGEsIGlkIH0gPSBzZWFyY2hJbmRleEVudHJ5O1xuXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgY29uc3QgaW5kZXhOYW1lID0gdGhpcy5nZXRJbmRleE5hbWUoZW50aXR5TmFtZSk7XG5cbiAgICB0cnkge1xuICAgICAgLy8gRW5zdXJlIHRoZSBpbmRleCBleGlzdHNcbiAgICAgIC8vIHdlIHdvbid0IGJlIGFibGUgdG8gY3JlYXRlIGFuIGluZGV4IGhlcmUgYXMgd2UgZG8tbm90IGhhdmUgYWNjZXNzIHRvIGVudGl0eS1pbmRleCBjb25maWcuLiBcbiAgICAgIC8vIGluZGV4ZXMgYXJlIHN1cHBvc2VkIHRvIGJlIHNldHVwIGJ5IHRoZSBhcHBsaWNhdGlvbjsgXG4gICAgICBhd2FpdCB0aGlzLmVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG5cbiAgICAgIC8vIEhhbmRsZSBkaWZmZXJlbnQgZXZlbnQgdHlwZXNcbiAgICAgIHN3aXRjaCAoZXZlbnRUeXBlKSB7XG4gICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgIGNhc2UgJ3VwZGF0ZSc6XG4gICAgICAgICAgYXdhaXQgdGhpcy5pbmRleERvY3VtZW50RGF0YShpbmRleE5hbWUsIGRhdGEsIGlkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZURvY3VtZW50KGluZGV4TmFtZSwgaWQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1Vua25vd24gZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnU3VjY2Vzc2Z1bGx5IHByb2Nlc3NlZCBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBpbmRleE5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuXG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcignRXJyb3IgcHJvY2Vzc2luZyBzZWFyY2ggaW5kZXggb3BlcmF0aW9uJywgeyBlcnJvciwgaW5kZXhOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdGFibGVOYW1lS2V5ID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiBTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5UQUJMRV9OQU1FX0VOVl9LRVkgfSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygndGFibGVOYW1lS2V5JywgeyB0YWJsZU5hbWVLZXkgfSk7XG4gICAgaWYgKCF0YWJsZU5hbWVLZXkpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hWYWxpZGF0aW9uRXJyb3IoYCR7U0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuVEFCTEVfTkFNRV9FTlZfS0VZfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCB0byBjYWxjdWxhdGUgdGhlIGFwcHJvcHJpYXRlIGluZGV4LW5hbWVgKTtcbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZU5hbWUgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IHRhYmxlTmFtZUtleSwgc3VmZml4OiAndGFibGUnIH0pO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ3RhYmxlTmFtZScsIHsgdGFibGVOYW1lIH0pO1xuXG4gICAgaWYgKCF0YWJsZU5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hWYWxpZGF0aW9uRXJyb3IoYCR7dGFibGVOYW1lfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCB0byBjYWxjdWxhdGUgdGhlIGFwcHJvcHJpYXRlIGluZGV4LW5hbWVgKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbmRleE5hbWUgPSBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lKHsgdGFibGVOYW1lLCBlbnRpdHlOYW1lIH0pO1xuXG4gICAgcmV0dXJuIGluZGV4TmFtZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBlbnN1cmVJbmRleEV4aXN0cyhpbmRleE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGV4aXN0cyA9IGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzKGluZGV4TmFtZSk7XG4gICAgaWYgKCFleGlzdHMpIHtcbiAgICAgIHRocm93IG5ldyBTZWFyY2hFbmdpbmVFcnJvcihgSW5kZXggJHtpbmRleE5hbWV9IGRvZXMgbm90IGV4aXN0YCwgeyBpbmRleE5hbWUgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGluZGV4RG9jdW1lbnREYXRhKGluZGV4TmFtZTogc3RyaW5nLCBkYXRhOiBhbnksIGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWRhdGEgfHwgIWRhdGEuaWQpIHtcbiAgICAgIC8vIEVuc3VyZSB0aGUgZG9jdW1lbnQgaGFzIGFuIElEXG4gICAgICBkYXRhID0geyAuLi5kYXRhLCBpZCB9O1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzKFsgZGF0YSBdLCB7IGluZGV4TmFtZSB9LCBmYWxzZSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnRG9jdW1lbnQgaW5kZXhlZCBzdWNjZXNzZnVsbHknLCB7IGluZGV4TmFtZSwgaWQgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVsZXRlRG9jdW1lbnQoaW5kZXhOYW1lOiBzdHJpbmcsIGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMoWyBpZCBdLCBpbmRleE5hbWUsIGZhbHNlKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdEb2N1bWVudCBkZWxldGVkIHN1Y2Nlc3NmdWxseScsIHsgaW5kZXhOYW1lLCBpZCB9KTtcbiAgfVxuXG59Il19