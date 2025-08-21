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
                        const payload = gr.payload;
                        const items = Array.isArray(payload)
                            ? payload
                            : (Array.isArray(payload?.items) ? payload.items : [payload]);
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
        // For resync sources or fallback, use payload directly
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQXFFO0FBQ3JFLGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFFekUsTUFBc0IsaUJBQW9MLFNBQVEsZ0RBQXdCO0lBS3hPLDBEQUEwRDtJQUNoRCxxQkFBcUI7UUFDN0IsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVTLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxNQUE0QjtRQUUzRCxNQUFNLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxHQUFHLE1BQU0sQ0FBQztRQUV6QyxJQUFJLENBQUMsQ0FBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFFBQVEsQ0FBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQzFELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDZDQUE2QyxFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztZQUMvRSxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUNBQXFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBQ3BFLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFFeEQsSUFBSSxrQkFBa0IsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFFeEQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO2dCQUM3QyxJQUFJLENBQUMs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LENBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVTLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUIsRUFBRSxFQUFVO1FBQzFELE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxlQUFlLENBQUMsQ0FBRSxFQUFFLENBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsK0JBQStCLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RSxDQUFDO0NBRUY7QUEzVUQsOENBMlVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJTdHJlYW1FdmVudCwgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuaW1wb3J0IHsgQmFzZVNRU0V2ZW50UHJvY2Vzc29yIH0gZnJvbSAnLi4vLi4vY29yZS9ydW50aW1lL2V2ZW50LXByb2Nlc3Nvci9iYXNlLXNxcy1ldmVudC1wcm9jZXNzb3InO1xuaW1wb3J0IHsgQmFzZUV2ZW50UmVjb3JkLCBJRXZlbnREYXRhRXh0cmFjdG9yIH0gZnJvbSAnLi4vLi4vY29yZS90eXBlcy9ldmVudC1wcm9jZXNzb3ItdHlwZXMnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudlZhbHVlRm9yIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gJy4uL2VuZ2luZXMvYmFzZSc7XG5pbXBvcnQgeyBTZWFyY2hFbmdpbmVFcnJvciwgU2VhcmNoVmFsaWRhdGlvbkVycm9yIH0gZnJvbSAnLi4vZXJyb3JzJztcbmltcG9ydCB7IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUgfSBmcm9tICcuLi9zZWFyY2gtdXRpbHMnO1xuaW1wb3J0IHsgU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMsIFNlYXJjaEluZGV4RW50cnkgfSBmcm9tICcuL2ludGVyZmFjZXMnO1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVNlYXJjaEluZGV4ZXI8VCBleHRlbmRzIElFdmVudERhdGFFeHRyYWN0b3I8VEV2ZW50LCBUUGF5bG9hZD4sIFRFdmVudCBleHRlbmRzIER5bmFtb0RCU3RyZWFtRXZlbnQgfCBTUVNFdmVudCA9IGFueSwgVFBheWxvYWQgZXh0ZW5kcyBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0gUmVjb3JkPHN0cmluZywgYW55Pj4gZXh0ZW5kcyBCYXNlU1FTRXZlbnRQcm9jZXNzb3I8VD4ge1xuXG4gIGFic3RyYWN0IHNlYXJjaEVuZ2luZTogQmFzZVNlYXJjaEVuZ2luZTtcblxuXG4gIC8vIG92ZXJyaWRlIHRoaXMgdG8gcHJvdmlkZSBhIGxpc3Qgb2YgYWxsb3dlZCBlbnRpdHkgbmFtZXNcbiAgcHJvdGVjdGVkIGdldEFsbG93ZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBwcmVwcm9jZXNzUmVjb3JkKHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPGFueT4pOiBQcm9taXNlPEJhc2VFdmVudFJlY29yZDxhbnk+IHwgbnVsbD4ge1xuXG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUgfSA9IHJlY29yZDtcblxuICAgIGlmICghWyAnY3JlYXRlJywgJ3VwZGF0ZScsICdkZWxldGUnIF0uaW5jbHVkZXMoZXZlbnRUeXBlKSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgcmVjb3JkIHdpdGggdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZScsIHsgZXZlbnRUeXBlIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFlbnRpdHlOYW1lKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCBubyBlbnRpdHkgbmFtZScsIHsgcmVjb3JkIH0pO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgYWxsb3dlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRBbGxvd2VkRW50aXR5TmFtZXMoKTtcblxuICAgIGlmIChhbGxvd2VkRW50aXR5TmFtZXMgJiYgYWxsb3dlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcblxuICAgICAgaWYgKCFhbGxvd2VkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgc2VhcmNoIGluZGV4aW5nIGZvciBlbnRpdHkgbm90IGluIGFsbG93ZWQgbGlzdCcsIHsgZW50aXR5TmFtZSwgYWxsb3dlZEVudGl0eU5hbWVzIH0pO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAoZW50aXR5TmFtZSA9PT0gJ2F1ZGl0TG9nJyB8fCBlbnRpdHlOYW1lLmluY2x1ZGVzKCdzZWFyY2gtaW5kZXgnKSkge1xuXG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBzZWFyY2ggaW5kZXhpbmcgZm9yIHN5c3RlbSBlbnRpdHknLCB7IGVudGl0eU5hbWUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkO1xuICB9XG5cbiAgLy8gSW1wbGVtZW50YXRpb24gZm9yIHBlci1yZWNvcmQgcHJvY2Vzc2luZ1xuICBwcm90ZWN0ZWQgb3ZlcnJpZGUgYXN5bmMgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCB9ID0gcmVjb3JkO1xuICAgIFxuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3Npbmcgc2luZ2xlIHJlY29yZCBmb3Igc2VhcmNoIGluZGV4aW5nJywgeyBlbnRpdHlOYW1lLCBldmVudFR5cGUsIGVudGl0eUlkIH0pO1xuICAgIFxuICAgIGNvbnN0IHNlYXJjaEluZGV4RW50cnkgPSB0aGlzLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkocmVjb3JkKTtcbiAgICBhd2FpdCB0aGlzLmluZGV4T3JEZWxldGVEb2N1bWVudChzZWFyY2hJbmRleEVudHJ5KTtcbiAgICBcbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnU2luZ2xlIHJlY29yZCBwcm9jZXNzaW5nIGNvbXBsZXRlZCcsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCwgZHVyYXRpb25NczogZHVyYXRpb24gfSk7XG4gIH1cblxuICAvLyBJbXBsZW1lbnRhdGlvbiBmb3IgYmF0Y2ggcHJvY2Vzc2luZ1xuICBwcm90ZWN0ZWQgb3ZlcnJpZGUgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaChyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1N0YXJ0aW5nIGJhdGNoIHNlYXJjaCBpbmRleGluZycsIHsgcmVjb3JkQ291bnQ6IHJlY29yZHMubGVuZ3RoIH0pO1xuICAgIFxuICAgIC8vIEdyb3VwIGJ5IGVudGl0eU5hbWUgYW5kIGV2ZW50VHlwZSB0byBtaW5pbWl6ZSBlbmdpbmUgY2FsbHNcbiAgICBjb25zdCBncm91cHMgPSBuZXcgTWFwPHN0cmluZywgQmFzZUV2ZW50UmVjb3JkPFRQYXlsb2FkPltdPigpO1xuXG4gICAgZm9yIChjb25zdCByZWMgb2YgcmVjb3Jkcykge1xuICAgICAgY29uc3Qga2V5ID0gYCR7cmVjLmVudGl0eU5hbWUgfHwgJyd9fCR7cmVjLmV2ZW50VHlwZX1gO1xuICAgICAgY29uc3QgYXJyID0gZ3JvdXBzLmdldChrZXkpIHx8IFtdO1xuICAgICAgYXJyLnB1c2gocmVjKTtcbiAgICAgIGdyb3Vwcy5zZXQoa2V5LCBhcnIpO1xuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1JlY29yZHMgZ3JvdXBlZCBmb3IgYmF0Y2ggcHJvY2Vzc2luZycsIHsgXG4gICAgICB0b3RhbEdyb3VwczogZ3JvdXBzLnNpemUsIFxuICAgICAgZ3JvdXBEZXRhaWxzOiBBcnJheS5mcm9tKGdyb3Vwcy5lbnRyaWVzKCkpLm1hcCgoW2tleSwgcmVjb3Jkc10pID0+ICh7XG4gICAgICAgIGdyb3VwOiBrZXksXG4gICAgICAgIHJlY29yZENvdW50OiByZWNvcmRzLmxlbmd0aFxuICAgICAgfSkpXG4gICAgfSk7XG5cbiAgICBsZXQgdG90YWxJbmRleGVkID0gMDtcbiAgICBsZXQgdG90YWxEZWxldGVkID0gMDtcbiAgICBsZXQgdG90YWxTa2lwcGVkID0gMDtcblxuICAgIGZvciAoY29uc3QgWyBrZXksIGdyb3VwUmVjb3JkcyBdIG9mIGdyb3Vwcy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IGdyb3VwU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgICAgIGNvbnN0IFsgZW50aXR5TmFtZSwgZXZlbnRUeXBlIF0gPSBrZXkuc3BsaXQoJ3wnKTtcblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBiYXRjaCBncm91cCcsIHsgZ3JvdXA6IGtleSwgcmVjb3JkQ291bnQ6IGdyb3VwUmVjb3Jkcy5sZW5ndGgsIGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9KTtcblxuICAgICAgY29uc3QgaW5kZXhOYW1lID0gdGhpcy5nZXRJbmRleE5hbWUoZW50aXR5TmFtZSk7XG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcblxuICAgICAgc3dpdGNoIChldmVudFR5cGUpIHtcbiAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgY2FzZSAndXBkYXRlJzoge1xuICAgICAgICAgIC8vIEJ1aWxkIGRvY3VtZW50cyBmcm9tIGVhY2ggcmVjb3JkJ3MgcGF5bG9hZCAoc3VwcG9ydHMgb2JqZWN0LCBhcnJheSwgb3IgcGF5bG9hZC5pdGVtcylcbiAgICAgICAgICBjb25zdCBkb2N1bWVudHM6IGFueVtdID0gW107XG4gICAgICAgICAgY29uc3Qgbm93SXNvID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgICAgICAgZm9yIChjb25zdCBnciBvZiBncm91cFJlY29yZHMpIHtcbiAgICAgICAgICAgIGNvbnN0IHBheWxvYWQ6IGFueSA9IGdyLnBheWxvYWQ7XG4gICAgICAgICAgICBjb25zdCBpdGVtczogYW55W10gPSBBcnJheS5pc0FycmF5KHBheWxvYWQpXG4gICAgICAgICAgICAgID8gcGF5bG9hZFxuICAgICAgICAgICAgICA6IChBcnJheS5pc0FycmF5KHBheWxvYWQ/Lml0ZW1zKSA/IHBheWxvYWQuaXRlbXMgOiBbIHBheWxvYWQgXSk7XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgICAgICAgICAgICBjb25zdCBpZCA9IGl0ZW0/LmlkIHx8IGl0ZW0/LlsgYCR7ZW50aXR5TmFtZX1JZGAgXSB8fCAoZ3IuZW50aXR5SWQgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKTtcbiAgICAgICAgICAgICAgaWYgKCFpZCkge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIGl0ZW0gd2l0aG91dCBpZCBkdXJpbmcgYmF0Y2ggaW5kZXgnLCB7IGVudGl0eU5hbWUsIGl0ZW1LZXlzOiBPYmplY3Qua2V5cyhpdGVtIHx8IHt9KSB9KTtcbiAgICAgICAgICAgICAgICB0b3RhbFNraXBwZWQrKztcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IGRvYyA9IGl0ZW0/LmlkID8geyAuLi5pdGVtIH0gOiB7IC4uLml0ZW0sIGlkIH07XG4gICAgICAgICAgICAgIGlmICghZG9jLl9pbmRleGVkQXQpIHtcbiAgICAgICAgICAgICAgICBkb2MuX2luZGV4ZWRBdCA9IG5vd0lzbztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBkb2N1bWVudHMucHVzaChkb2MpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoZG9jdW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTm8gZG9jdW1lbnRzIHRvIGluZGV4IGFmdGVyIHBheWxvYWQgbm9ybWFsaXphdGlvbicsIHsgZ3JvdXA6IGtleSB9KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdFeGVjdXRpbmcgYmF0Y2ggaW5kZXggb3BlcmF0aW9uJywgeyBncm91cDoga2V5LCBkb2N1bWVudENvdW50OiBkb2N1bWVudHMubGVuZ3RoLCBpbmRleE5hbWUgfSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHMoZG9jdW1lbnRzLCB7IGluZGV4TmFtZSB9LCBmYWxzZSk7XG4gICAgICAgICAgdG90YWxJbmRleGVkICs9IGRvY3VtZW50cy5sZW5ndGg7XG4gICAgICAgICAgXG4gICAgICAgICAgY29uc3QgZ3JvdXBEdXJhdGlvbiA9IERhdGUubm93KCkgLSBncm91cFN0YXJ0VGltZTtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKCdCYXRjaCBpbmRleCBvcGVyYXRpb24gY29tcGxldGVkJywgeyBcbiAgICAgICAgICAgIGdyb3VwOiBrZXksIFxuICAgICAgICAgICAgaW5kZXhlZENvdW50OiBkb2N1bWVudHMubGVuZ3RoLCBcbiAgICAgICAgICAgIGR1cmF0aW9uTXM6IGdyb3VwRHVyYXRpb24sXG4gICAgICAgICAgICBhdmdUaW1lUGVyRG9jdW1lbnQ6IGdyb3VwRHVyYXRpb24gLyBkb2N1bWVudHMubGVuZ3RoIFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJ2RlbGV0ZSc6IHtcbiAgICAgICAgICBjb25zdCBpZHMgPSBncm91cFJlY29yZHMubWFwKGdyID0+IGdyLmVudGl0eUlkIGFzIHN0cmluZyk7XG4gICAgICAgICAgXG4gICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnRXhlY3V0aW5nIGJhdGNoIGRlbGV0ZSBvcGVyYXRpb24nLCB7IGdyb3VwOiBrZXksIGlkQ291bnQ6IGlkcy5sZW5ndGgsIGluZGV4TmFtZSB9KTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMoaWRzLCBpbmRleE5hbWUsIGZhbHNlKTtcbiAgICAgICAgICB0b3RhbERlbGV0ZWQgKz0gaWRzLmxlbmd0aDtcbiAgICAgICAgICBcbiAgICAgICAgICBjb25zdCBncm91cER1cmF0aW9uID0gRGF0ZS5ub3coKSAtIGdyb3VwU3RhcnRUaW1lO1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ0JhdGNoIGRlbGV0ZSBvcGVyYXRpb24gY29tcGxldGVkJywgeyBcbiAgICAgICAgICAgIGdyb3VwOiBrZXksIFxuICAgICAgICAgICAgZGVsZXRlZENvdW50OiBpZHMubGVuZ3RoLCBcbiAgICAgICAgICAgIGR1cmF0aW9uTXM6IGdyb3VwRHVyYXRpb24gXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVbmtub3duIGV2ZW50IHR5cGUgaW4gYmF0Y2gnLCB7IGV2ZW50VHlwZSwgZ3JvdXBTaXplOiBncm91cFJlY29yZHMubGVuZ3RoIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRvdGFsRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ0JhdGNoIHNlYXJjaCBpbmRleGluZyBjb21wbGV0ZWQnLCB7IFxuICAgICAgdG90YWxSZWNvcmRzOiByZWNvcmRzLmxlbmd0aCxcbiAgICAgIHRvdGFsR3JvdXBzOiBncm91cHMuc2l6ZSxcbiAgICAgIHRvdGFsSW5kZXhlZCxcbiAgICAgIHRvdGFsRGVsZXRlZCxcbiAgICAgIHRvdGFsU2tpcHBlZCxcbiAgICAgIGR1cmF0aW9uTXM6IHRvdGFsRHVyYXRpb24sXG4gICAgICBhdmdUaW1lUGVyUmVjb3JkOiB0b3RhbER1cmF0aW9uIC8gcmVjb3Jkcy5sZW5ndGgsXG4gICAgICBhdmdUaW1lUGVyR3JvdXA6IHRvdGFsRHVyYXRpb24gLyBncm91cHMuc2l6ZVxuICAgIH0pO1xuICB9XG5cbiAgLy8gSGVscGVyIG1ldGhvZCB0byBjcmVhdGUgU2VhcmNoSW5kZXhFbnRyeSBmcm9tIGEgcmVjb3JkXG4gIHByaXZhdGUgY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBTZWFyY2hJbmRleEVudHJ5IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQsIHRpbWVzdGFtcCwgcGF5bG9hZDogcGF5bG9hZERhdGEsIG1ldGFkYXRhIH0gPSByZWNvcmQ7XG4gICAgXG4gICAgLy8gRXh0cmFjdCBzZWFyY2hhYmxlIGRhdGEgYmFzZWQgb24gdGhlIHNvdXJjZSB0eXBlXG4gICAgY29uc3Qgc2VhcmNoYWJsZURhdGEgPSB0aGlzLnRyYW5zZm9ybVBheWxvYWRGb3JJbmRleGluZyhwYXlsb2FkRGF0YSwgZXZlbnRUeXBlLCBtZXRhZGF0YT8uc291cmNlKTtcbiAgICBcbiAgICAvLyBOb3RlOiB0aW1lc3RhbXAgaXMgYWxyZWFkeSBpbiBtaWxsaXNlY29uZHMgKGNvbnZlcnRlZCBmcm9tIER5bmFtb0RCIHNlY29uZHMgaW4gdGhlIGRhdGEgZXh0cmFjdG9yKVxuICAgIC8vIEV4YW1wbGU6IHRpbWVzdGFtcCA9IDE3MzQ1Njc4OTAwMDAgKG1pbGxpc2Vjb25kcykgLT4gXCIyMDI0LTEyLTE5VDEwOjMxOjMwLjAwMFpcIlxuICAgIHJldHVybiB7XG4gICAgICBpZDogZW50aXR5SWQgYXMgc3RyaW5nLFxuICAgICAgZGF0YTogc2VhcmNoYWJsZURhdGEsXG4gICAgICBldmVudFR5cGU6IGV2ZW50VHlwZSBhcyAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RlbGV0ZScsXG4gICAgICB0aW1lc3RhbXA6ICh0aW1lc3RhbXAgPyBuZXcgRGF0ZSh0aW1lc3RhbXApIDogbmV3IERhdGUoKSkudG9JU09TdHJpbmcoKSxcbiAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUgYXMgc3RyaW5nLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVHJhbnNmb3JtIHBheWxvYWQgZGF0YSBmb3Igc2VhcmNoIGluZGV4aW5nIGJhc2VkIG9uIHNvdXJjZSB0eXBlXG4gICAqIE92ZXJyaWRlIHRoaXMgbWV0aG9kIGluIHN1YmNsYXNzZXMgZm9yIGN1c3RvbSBkYXRhIHRyYW5zZm9ybWF0aW9uXG4gICAqL1xuICBwcm90ZWN0ZWQgdHJhbnNmb3JtUGF5bG9hZEZvckluZGV4aW5nKHBheWxvYWREYXRhOiBhbnksIGV2ZW50VHlwZTogc3RyaW5nLCBzb3VyY2U/OiBzdHJpbmcpOiBhbnkge1xuICAgIC8vIEZvciBzdHJlYW0gc291cmNlcywgcGF5bG9hZCBpcyBDaGFuZ2VTdHJlYW1QYXlsb2FkIGZvcm1hdFxuICAgIGlmIChzb3VyY2UgPT09ICdzdHJlYW0nICYmIHBheWxvYWREYXRhICYmIHR5cGVvZiBwYXlsb2FkRGF0YSA9PT0gJ29iamVjdCcgJiYgXG4gICAgICAgICgnb2xkSW1hZ2UnIGluIHBheWxvYWREYXRhIHx8ICduZXdJbWFnZScgaW4gcGF5bG9hZERhdGEgfHwgJ2tleXMnIGluIHBheWxvYWREYXRhKSkge1xuICAgICAgY29uc3QgeyBvbGRJbWFnZSwgbmV3SW1hZ2UgfSA9IHBheWxvYWREYXRhO1xuICAgICAgcmV0dXJuIHRoaXMuZXh0cmFjdFNlYXJjaGFibGVEYXRhRnJvbUNoYW5nZVN0cmVhbShvbGRJbWFnZSwgbmV3SW1hZ2UsIGV2ZW50VHlwZSk7XG4gICAgfVxuICAgIFxuICAgIC8vIEZvciByZXN5bmMgc291cmNlcyBvciBmYWxsYmFjaywgdXNlIHBheWxvYWQgZGlyZWN0bHlcbiAgICByZXR1cm4ge1xuICAgICAgLi4ucGF5bG9hZERhdGEsXG4gICAgICBfaW5kZXhlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3Qgc2VhcmNoYWJsZSBkYXRhIGZyb20gRHluYW1vREIgY2hhbmdlIHN0cmVhbSBmb3JtYXRcbiAgICogT3ZlcnJpZGUgdGhpcyBtZXRob2QgaW4gc3ViY2xhc3NlcyBmb3IgY3VzdG9tIGZpZWxkIGZpbHRlcmluZ1xuICAgKi9cbiAgcHJvdGVjdGVkIGV4dHJhY3RTZWFyY2hhYmxlRGF0YUZyb21DaGFuZ2VTdHJlYW0oXG4gICAgb2xkSW1hZ2U6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgbmV3SW1hZ2U6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQsXG4gICAgZXZlbnRUeXBlOiBzdHJpbmdcbiAgKTogYW55IHtcbiAgICAvLyBGb3IgZGVsZXRpb25zLCB3ZSBvbmx5IG5lZWQgdGhlIElEIHRvIHJlbW92ZSBmcm9tIGluZGV4XG4gICAgaWYgKGV2ZW50VHlwZSA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIHJldHVybiB7IGlkOiBvbGRJbWFnZT8uaWQgfTtcbiAgICB9XG5cbiAgICAvLyBGb3IgY3JlYXRlcyBhbmQgdXBkYXRlcywgdXNlIHRoZSBuZXcgaW1hZ2VcbiAgICBjb25zdCBzb3VyY2VEYXRhID0gbmV3SW1hZ2UgfHwgb2xkSW1hZ2U7XG4gICAgaWYgKCFzb3VyY2VEYXRhKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgRHluYW1vREIgaW50ZXJuYWwgZmllbGRzIGFuZCBwcmVwYXJlIGZvciBzZWFyY2ggaW5kZXhpbmdcbiAgICBjb25zdCBpZ25vcmVkS2V5cyA9IFtcbiAgICAgICdfX0VEQl9FX18nLCAnX19FREJfVl9fJywgJ1BLJywgJ1NLJywgXG4gICAgICAnR1NJMVBLJywgJ0dTSTFTSycsICdHU0kyUEsnLCAnR1NJMlNLJywgJ0dTSTNQSycsICdHU0kzU0snLCAnR1NJNFBLJywgJ0dTSTRTSycsXG4gICAgICAnUEFTU1dPUkQnXG4gICAgXTtcblxuICAgIGNvbnN0IHNlYXJjaGFibGVEYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0geyAuLi5zb3VyY2VEYXRhIH07XG5cbiAgICBPYmplY3Qua2V5cyhzb3VyY2VEYXRhKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICBpZiAoaWdub3JlZEtleXMuaW5jbHVkZXMoa2V5LnRvVXBwZXJDYXNlKCkpIHx8IFxuICAgICAgICAgIGtleS5zdGFydHNXaXRoKCdfXycpIHx8IFxuICAgICAgICAgIChrZXkubGVuZ3RoID4gMyAmJiBbJ0dTSScsICdMU0knXS5pbmNsdWRlcyhrZXkuc3Vic3RyaW5nKDAsIDMpLnRvVXBwZXJDYXNlKCkpKSkge1xuICAgICAgICBkZWxldGUgc2VhcmNoYWJsZURhdGFba2V5XTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5zZWFyY2hhYmxlRGF0YSxcbiAgICAgIF9pbmRleGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaW5kZXhPckRlbGV0ZURvY3VtZW50KHNlYXJjaEluZGV4RW50cnk6IFNlYXJjaEluZGV4RW50cnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZGF0YSwgaWQgfSA9IHNlYXJjaEluZGV4RW50cnk7XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIHNlYXJjaCBpbmRleCBvcGVyYXRpb24nLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICBjb25zdCBpbmRleE5hbWUgPSB0aGlzLmdldEluZGV4TmFtZShlbnRpdHlOYW1lKTtcblxuICAgIHRyeSB7XG4gICAgICAvLyBFbnN1cmUgdGhlIGluZGV4IGV4aXN0c1xuICAgICAgLy8gd2Ugd29uJ3QgYmUgYWJsZSB0byBjcmVhdGUgYW4gaW5kZXggaGVyZSBhcyB3ZSBkby1ub3QgaGF2ZSBhY2Nlc3MgdG8gZW50aXR5LWluZGV4IGNvbmZpZy4uIFxuICAgICAgLy8gaW5kZXhlcyBhcmUgc3VwcG9zZWQgdG8gYmUgc2V0dXAgYnkgdGhlIGFwcGxpY2F0aW9uOyBcbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcblxuICAgICAgLy8gSGFuZGxlIGRpZmZlcmVudCBldmVudCB0eXBlc1xuICAgICAgc3dpdGNoIChldmVudFR5cGUpIHtcbiAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgICBhd2FpdCB0aGlzLmluZGV4RG9jdW1lbnREYXRhKGluZGV4TmFtZSwgZGF0YSwgaWQpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlRG9jdW1lbnQoaW5kZXhOYW1lLCBpZCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybignVW5rbm93biBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKCdTdWNjZXNzZnVsbHkgcHJvY2Vzc2VkIHNlYXJjaCBpbmRleCBvcGVyYXRpb24nLCB7IGluZGV4TmFtZSwgZXZlbnRUeXBlLCBpZCB9KTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIHNlYXJjaCBpbmRleCBvcGVyYXRpb24nLCB7IGVycm9yLCBpbmRleE5hbWUsIGV2ZW50VHlwZSwgaWQgfSk7XG5cbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRJbmRleE5hbWUoZW50aXR5TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCB0YWJsZU5hbWVLZXkgPSByZXNvbHZlRW52VmFsdWVGb3IoeyBrZXk6IFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWSB9KTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCd0YWJsZU5hbWVLZXknLCB7IHRhYmxlTmFtZUtleSB9KTtcbiAgICBpZiAoIXRhYmxlTmFtZUtleSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaFZhbGlkYXRpb25FcnJvcihgJHtTRUFSQ0hfSU5ERVhFUl9FTlZfS0VZUy5UQUJMRV9OQU1FX0VOVl9LRVl9IGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkIHRvIGNhbGN1bGF0ZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXgtbmFtZWApO1xuICAgIH1cblxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogdGFibGVOYW1lS2V5LCBzdWZmaXg6ICd0YWJsZScgfSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygndGFibGVOYW1lJywgeyB0YWJsZU5hbWUgfSk7XG5cbiAgICBpZiAoIXRhYmxlTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaFZhbGlkYXRpb25FcnJvcihgJHt0YWJsZU5hbWV9IGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkIHRvIGNhbGN1bGF0ZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXgtbmFtZWApO1xuICAgIH1cblxuICAgIGNvbnN0IGluZGV4TmFtZSA9IG1ha2VFbnRpdHlTZWFyY2hJbmRleE5hbWUoeyB0YWJsZU5hbWUsIGVudGl0eU5hbWUgfSk7XG5cbiAgICByZXR1cm4gaW5kZXhOYW1lO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGVuc3VyZUluZGV4RXhpc3RzKGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZXhpc3RzID0gYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICBpZiAoIWV4aXN0cykge1xuICAgICAgdGhyb3cgbmV3IFNlYXJjaEVuZ2luZUVycm9yKGBJbmRleCAke2luZGV4TmFtZX0gZG9lcyBub3QgZXhpc3RgLCB7IGluZGV4TmFtZSB9KTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaW5kZXhEb2N1bWVudERhdGEoaW5kZXhOYW1lOiBzdHJpbmcsIGRhdGE6IGFueSwgaWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghZGF0YSB8fCAhZGF0YS5pZCkge1xuICAgICAgLy8gRW5zdXJlIHRoZSBkb2N1bWVudCBoYXMgYW4gSURcbiAgICAgIGRhdGEgPSB7IC4uLmRhdGEsIGlkIH07XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHMoWyBkYXRhIF0sIHsgaW5kZXhOYW1lIH0sIGZhbHNlKTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdEb2N1bWVudCBpbmRleGVkIHN1Y2Nlc3NmdWxseScsIHsgaW5kZXhOYW1lLCBpZCB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWxldGVEb2N1bWVudChpbmRleE5hbWU6IHN0cmluZywgaWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50cyhbIGlkIF0sIGluZGV4TmFtZSwgZmFsc2UpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ0RvY3VtZW50IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5JywgeyBpbmRleE5hbWUsIGlkIH0pO1xuICB9XG5cbn0iXX0=