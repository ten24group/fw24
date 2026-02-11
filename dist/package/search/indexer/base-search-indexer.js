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
        this.logger.info('Records grouped for batch processing', {
            totalGroups: groups.size,
            groupDetails: Array.from(groups.entries()).map(([key, groupRecords]) => ({
                group: key,
                recordCount: groupRecords.length
            }))
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvaW5kZXhlci9iYXNlLXNlYXJjaC1pbmRleGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLDBHQUFvRztBQUVwRyx1Q0FBaUQ7QUFFakQsc0NBQXFFO0FBQ3JFLGtEQUE0RDtBQUM1RCw2Q0FBeUU7QUFDekUsNkVBQXlFO0FBRXpFLE1BQXNCLGlCQUFvTCxTQUFRLGdEQUF3QjtJQUt4TywwREFBMEQ7SUFDaEQscUJBQXFCO1FBQzdCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCwyREFBMkQ7SUFDakQsc0JBQXNCO1FBQzlCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRDs7OztPQUlHO0lBQ08saUJBQWlCLENBQUMsVUFBa0I7UUFDNUMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztRQUN4RCxNQUFNLG1CQUFtQixHQUFHLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1FBRTFELDZDQUE2QztRQUM3QyxJQUFJLG1CQUFtQixJQUFJLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksbUJBQW1CLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDdEcsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO1FBRUQscUVBQXFFO1FBQ3JFLElBQUksa0JBQWtCLElBQUksa0JBQWtCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3hELE9BQU8sa0JBQWtCLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ2pELENBQUM7UUFFRCxvR0FBb0c7UUFDcEcsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDMUQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsdUNBQXVD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QUMsQ0FBQztRQUM5RCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixNQUFNLElBQUksMEJBQWlCLENBQUMsU0FBUyxTQUFTLGlCQUFpQixFQUFFLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNsRixDQUFDO0lBQ0gsQ0FBQztJQUVTLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxTQUFpQixFQUFFLElBQVMsRUFBRSxFQUFVO1FBQ3hFLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDdEIsZ0NBQWdDO1lBQ2hDLElBQUksR0FBRyxFQUFFLEdBQUcsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDO1FBQ3pCLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLENBQUUsSUFBSSxDQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN2RSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7SUFFUyxLQUFLLENBQUMsY0FBYyxDQUFDLFNBQWlCLEVBQUUsRUFBVTtRQUMxRCxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsZUFBZSxDQUFDLENBQUUsRUFBRSxDQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2xFLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLCtCQUErQixFQUFFLEVBQUUsU0FBUyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDdkUsQ0FBQztDQUVGO0FBN1hELDhDQTZYQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCU3RyZWFtRXZlbnQsIFNRU0V2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5cbmltcG9ydCB7IEJhc2VTUVNFdmVudFByb2Nlc3NvciB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9ldmVudC1wcm9jZXNzb3IvYmFzZS1zcXMtZXZlbnQtcHJvY2Vzc29yJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgSUV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IHJlc29sdmVFbnZWYWx1ZUZvciB9IGZyb20gJy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzL2Jhc2UnO1xuaW1wb3J0IHsgU2VhcmNoRW5naW5lRXJyb3IsIFNlYXJjaFZhbGlkYXRpb25FcnJvciB9IGZyb20gJy4uL2Vycm9ycyc7XG5pbXBvcnQgeyBtYWtlRW50aXR5U2VhcmNoSW5kZXhOYW1lIH0gZnJvbSAnLi4vc2VhcmNoLXV0aWxzJztcbmltcG9ydCB7IFNFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLCBTZWFyY2hJbmRleEVudHJ5IH0gZnJvbSAnLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEJhdGNoUHJvZ3Jlc3MgfSBmcm9tICcuLi8uLi9vYnNlcnZhYmlsaXR5L3V0aWxzL2JhdGNoLXByb2dyZXNzJztcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VTZWFyY2hJbmRleGVyPFQgZXh0ZW5kcyBJRXZlbnREYXRhRXh0cmFjdG9yPFRFdmVudCwgVFBheWxvYWQ+LCBURXZlbnQgZXh0ZW5kcyBEeW5hbW9EQlN0cmVhbUV2ZW50IHwgU1FTRXZlbnQgPSBhbnksIFRQYXlsb2FkIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55PiA9IFJlY29yZDxzdHJpbmcsIGFueT4+IGV4dGVuZHMgQmFzZVNRU0V2ZW50UHJvY2Vzc29yPFQ+IHtcblxuICBhYnN0cmFjdCBzZWFyY2hFbmdpbmU6IEJhc2VTZWFyY2hFbmdpbmU7XG5cblxuICAvLyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgYSBsaXN0IG9mIGFsbG93ZWQgZW50aXR5IG5hbWVzXG4gIHByb3RlY3RlZCBnZXRBbGxvd2VkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBvdmVycmlkZSB0aGlzIHRvIHByb3ZpZGUgYSBsaXN0IG9mIGV4Y2x1ZGVkIGVudGl0eSBuYW1lc1xuICBwcm90ZWN0ZWQgZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIGlmIGFuIGVudGl0eSBzaG91bGQgYmUgaW5kZXhlZCBiYXNlZCBvbiBhbGxvd2VkL2V4Y2x1ZGVkIGxpc3RzLlxuICAgKiBPdmVycmlkZSBpbiBzdWJjbGFzc2VzIHRvIGltcGxlbWVudCBjdXN0b20gbG9naWMuXG4gICAqIERlZmF1bHQgYmVoYXZpb3I6IGluZGV4IGFsbCBleGNlcHQgc3lzdGVtIGVudGl0aWVzLlxuICAgKi9cbiAgcHJvdGVjdGVkIHNob3VsZEluZGV4RW50aXR5KGVudGl0eU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk7XG4gICAgY29uc3QgZXhjbHVkZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0RXhjbHVkZWRFbnRpdHlOYW1lcygpO1xuXG4gICAgLy8gRXhjbHVkZWQgbGlzdCBBTFdBWVMgd2lucyAoc2FmZXIgZGVmYXVsdCkuXG4gICAgaWYgKGV4Y2x1ZGVkRW50aXR5TmFtZXMgJiYgZXhjbHVkZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwICYmIGV4Y2x1ZGVkRW50aXR5TmFtZXMuaW5jbHVkZXMoZW50aXR5TmFtZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBJZiBhbGxvd2VkRW50aXR5TmFtZXMgaXMgcHJvdmlkZWQsIHJlc3RyaWN0IGluZGV4aW5nIHRvIHRoYXQgbGlzdC5cbiAgICBpZiAoYWxsb3dlZEVudGl0eU5hbWVzICYmIGFsbG93ZWRFbnRpdHlOYW1lcy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4gYWxsb3dlZEVudGl0eU5hbWVzLmluY2x1ZGVzKGVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8vIE90aGVyd2lzZSwgaWYgZXhjbHVkZWRFbnRpdHlOYW1lcyBpcyBwcm92aWRlZCwgaW5kZXggYWxsIGV4Y2VwdCBleGNsdWRlZCAoYWxyZWFkeSBoYW5kbGVkIGFib3ZlKS5cbiAgICBpZiAoZXhjbHVkZWRFbnRpdHlOYW1lcyAmJiBleGNsdWRlZEVudGl0eU5hbWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIERlZmF1bHQgYmVoYXZpb3I6IGluZGV4IGFsbCBlbnRpdGllc1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByZXByb2Nlc3NSZWNvcmQocmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55Pik6IFByb21pc2U8QmFzZUV2ZW50UmVjb3JkPGFueT4gfCBudWxsPiB7XG5cbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSB9ID0gcmVjb3JkO1xuXG4gICAgaWYgKCFbICdjcmVhdGUnLCAndXBkYXRlJywgJ2RlbGV0ZScgXS5pbmNsdWRlcyhldmVudFR5cGUpKSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyByZWNvcmQgd2l0aCB1bnN1cHBvcnRlZCBldmVudCB0eXBlJywgeyBldmVudFR5cGUgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIWVudGl0eU5hbWUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIHJlY29yZCB3aXRoIG5vIGVudGl0eSBuYW1lJywgeyByZWNvcmQgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuc2hvdWxkSW5kZXhFbnRpdHkoZW50aXR5TmFtZSkpIHtcbiAgICAgIGNvbnN0IGFsbG93ZWRFbnRpdHlOYW1lcyA9IHRoaXMuZ2V0QWxsb3dlZEVudGl0eU5hbWVzKCk7XG4gICAgICBjb25zdCBleGNsdWRlZEVudGl0eU5hbWVzID0gdGhpcy5nZXRFeGNsdWRlZEVudGl0eU5hbWVzKCk7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKCdTa2lwcGluZyBzZWFyY2ggaW5kZXhpbmcgZm9yIGVudGl0eSBiYXNlZCBvbiBmaWx0ZXJpbmcgcnVsZXMnLCB7XG4gICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgIGFsbG93ZWRFbnRpdHlOYW1lcyxcbiAgICAgICAgZXhjbHVkZWRFbnRpdHlOYW1lc1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjb3JkO1xuICB9XG5cbiAgLy8gSW1wbGVtZW50YXRpb24gZm9yIHBlci1yZWNvcmQgcHJvY2Vzc2luZ1xuICBwcm90ZWN0ZWQgb3ZlcnJpZGUgYXN5bmMgcHJvY2Vzc1JlY29yZChyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCB9ID0gcmVjb3JkO1xuXG4gICAgdGhpcy5sb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBzaW5nbGUgcmVjb3JkIGZvciBzZWFyY2ggaW5kZXhpbmcnLCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQgfSk7XG5cbiAgICBjb25zdCBzZWFyY2hJbmRleEVudHJ5ID0gdGhpcy5jcmVhdGVTZWFyY2hJbmRleEVudHJ5KHJlY29yZCk7XG4gICAgYXdhaXQgdGhpcy5pbmRleE9yRGVsZXRlRG9jdW1lbnQoc2VhcmNoSW5kZXhFbnRyeSk7XG5cbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnU2luZ2xlIHJlY29yZCBwcm9jZXNzaW5nIGNvbXBsZXRlZCcsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBlbnRpdHlJZCwgZHVyYXRpb25NczogZHVyYXRpb24gfSk7XG4gIH1cblxuICAvLyBJbXBsZW1lbnRhdGlvbiBmb3IgYmF0Y2ggcHJvY2Vzc2luZ1xuICBwcm90ZWN0ZWQgb3ZlcnJpZGUgYXN5bmMgcHJvY2Vzc1JlY29yZHNCYXRjaChyZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBHcm91cCBieSBlbnRpdHlOYW1lIGFuZCBldmVudFR5cGUgdG8gbWluaW1pemUgZW5naW5lIGNhbGxzXG4gICAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXT4oKTtcblxuICAgIGZvciAoY29uc3QgcmVjIG9mIHJlY29yZHMpIHtcbiAgICAgIGNvbnN0IGtleSA9IGAke3JlYy5lbnRpdHlOYW1lIHx8ICcnfXwke3JlYy5ldmVudFR5cGV9YDtcbiAgICAgIGNvbnN0IGFyciA9IGdyb3Vwcy5nZXQoa2V5KSB8fCBbXTtcbiAgICAgIGFyci5wdXNoKHJlYyk7XG4gICAgICBncm91cHMuc2V0KGtleSwgYXJyKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlci5pbmZvKCdSZWNvcmRzIGdyb3VwZWQgZm9yIGJhdGNoIHByb2Nlc3NpbmcnLCB7XG4gICAgICB0b3RhbEdyb3VwczogZ3JvdXBzLnNpemUsXG4gICAgICBncm91cERldGFpbHM6IEFycmF5LmZyb20oZ3JvdXBzLmVudHJpZXMoKSkubWFwKChbIGtleSwgZ3JvdXBSZWNvcmRzIF0pID0+ICh7XG4gICAgICAgIGdyb3VwOiBrZXksXG4gICAgICAgIHJlY29yZENvdW50OiBncm91cFJlY29yZHMubGVuZ3RoXG4gICAgICB9KSlcbiAgICB9KTtcblxuICAgIC8vIFByb2Nlc3MgZWFjaCBncm91cCB1c2luZyBCYXRjaFByb2dyZXNzXG4gICAgZm9yIChjb25zdCBbIGtleSwgZ3JvdXBSZWNvcmRzIF0gb2YgZ3JvdXBzLmVudHJpZXMoKSkge1xuICAgICAgY29uc3QgWyBlbnRpdHlOYW1lLCBldmVudFR5cGUgXSA9IGtleS5zcGxpdCgnfCcpO1xuXG4gICAgICBpZiAoIVsgJ2NyZWF0ZScsICd1cGRhdGUnLCAnZGVsZXRlJyBdLmluY2x1ZGVzKGV2ZW50VHlwZSkpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybignU2tpcHBpbmcgdW5rbm93biBldmVudCB0eXBlJywgeyBldmVudFR5cGUsIGNvdW50OiBncm91cFJlY29yZHMubGVuZ3RoIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5kZXhOYW1lID0gdGhpcy5nZXRJbmRleE5hbWUoZW50aXR5TmFtZSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKCdJbmRleCBkb2VzIG5vdCBleGlzdCwgc2tpcHBpbmcgZ3JvdXAnLCB7IGluZGV4TmFtZSwgZW50aXR5TmFtZSwgZXJyb3IgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnRUeXBlID09PSAnZGVsZXRlJykge1xuICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3NCYXRjaERlbGV0ZShncm91cFJlY29yZHMsIGluZGV4TmFtZSwgZW50aXR5TmFtZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3NCYXRjaEluZGV4KGdyb3VwUmVjb3JkcywgaW5kZXhOYW1lLCBlbnRpdHlOYW1lKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyBiYXRjaCBpbmRleCB1c2luZyBCYXRjaFByb2dyZXNzLmNodW5rXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NCYXRjaEluZGV4KFxuICAgIHJlY29yZHM6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD5bXSxcbiAgICBpbmRleE5hbWU6IHN0cmluZyxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gVHJhbnNmb3JtIHJlY29yZHMgdG8gZG9jdW1lbnRzXG4gICAgaW50ZXJmYWNlIERvY1dpdGhJZCB7IGRvYzogYW55OyBpZDogc3RyaW5nIH1cbiAgICBjb25zdCBkb2NzOiBEb2NXaXRoSWRbXSA9IFtdO1xuICAgIGNvbnN0IG5vd0lzbyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcbiAgICAgIGNvbnN0IHNlYXJjaEluZGV4RW50cnkgPSB0aGlzLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkocmVjb3JkKTtcbiAgICAgIGNvbnN0IHRyYW5zZm9ybWVkRGF0YSA9IHNlYXJjaEluZGV4RW50cnkuZGF0YTtcblxuICAgICAgY29uc3QgaXRlbXM6IGFueVtdID0gQXJyYXkuaXNBcnJheSh0cmFuc2Zvcm1lZERhdGEpXG4gICAgICAgID8gdHJhbnNmb3JtZWREYXRhXG4gICAgICAgIDogKEFycmF5LmlzQXJyYXkodHJhbnNmb3JtZWREYXRhPy5pdGVtcykgPyB0cmFuc2Zvcm1lZERhdGEuaXRlbXMgOiBbIHRyYW5zZm9ybWVkRGF0YSBdKTtcblxuICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgICAgIGNvbnN0IGlkID0gaXRlbT8uaWQgfHwgaXRlbT8uWyBgJHtlbnRpdHlOYW1lfUlkYCBdIHx8IChyZWNvcmQuZW50aXR5SWQgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKTtcbiAgICAgICAgaWYgKCFpZCkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLndhcm4oJ1NraXBwaW5nIGl0ZW0gd2l0aG91dCBpZCcsIHsgZW50aXR5TmFtZSB9KTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRvYyA9IGl0ZW0/LmlkID8geyAuLi5pdGVtIH0gOiB7IC4uLml0ZW0sIGlkIH07XG4gICAgICAgIGlmICghZG9jLl9pbmRleGVkQXQpIHtcbiAgICAgICAgICBkb2MuX2luZGV4ZWRBdCA9IG5vd0lzbztcbiAgICAgICAgfVxuICAgICAgICBkb2NzLnB1c2goeyBkb2MsIGlkIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChkb2NzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTm8gZG9jdW1lbnRzIHRvIGluZGV4JywgeyBlbnRpdHlOYW1lLCBpbmRleE5hbWUgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSW5kZXggaW4gY2h1bmtzIChkZWZhdWx0IDI1IGRvY3MgcGVyIGJhdGNoKVxuICAgIGF3YWl0IEJhdGNoUHJvZ3Jlc3MuY2h1bmsoXG4gICAgICBgSW5kZXggJHtlbnRpdHlOYW1lfWAsXG4gICAgICBkb2NzLFxuICAgICAgYXN5bmMgKGNodW5rKSA9PiB7XG4gICAgICAgIGNvbnN0IGRvY3NUb0luZGV4ID0gY2h1bmsubWFwKGMgPT4gYy5kb2MpO1xuICAgICAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50cyhkb2NzVG9JbmRleCwgeyBpbmRleE5hbWUgfSwgZmFsc2UpO1xuICAgICAgICByZXR1cm4gY2h1bmsubWFwKGMgPT4gYy5pZCk7XG4gICAgICB9LFxuICAgICAgeyB0YWdzOiB7IGVudGl0eTogZW50aXR5TmFtZSB9IH1cbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3MgYmF0Y2ggZGVsZXRlIHVzaW5nIGNodW5rZWQgZGVsZXRpb24uXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NCYXRjaERlbGV0ZShcbiAgICByZWNvcmRzOiBCYXNlRXZlbnRSZWNvcmQ8VFBheWxvYWQ+W10sXG4gICAgaW5kZXhOYW1lOiBzdHJpbmcsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEV4dHJhY3QgSURzIGZyb20gcmVjb3JkcyB0aGF0IGhhdmUgZW50aXR5SWRcbiAgICBjb25zdCBpZHMgPSByZWNvcmRzXG4gICAgICAuZmlsdGVyKHIgPT4gci5lbnRpdHlJZClcbiAgICAgIC5tYXAociA9PiByLmVudGl0eUlkIGFzIHN0cmluZyk7XG5cbiAgICBpZiAoaWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbygnTm8gcmVjb3JkcyB3aXRoIGVudGl0eUlkIHRvIGRlbGV0ZScsIHsgZW50aXR5TmFtZSB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBEZWxldGUgaW4gY2h1bmtzIChkZWZhdWx0IDI1IElEcyBwZXIgYmF0Y2gpXG4gICAgYXdhaXQgQmF0Y2hQcm9ncmVzcy5jaHVuayhcbiAgICAgIGBEZWxldGUgJHtlbnRpdHlOYW1lfWAsXG4gICAgICBpZHMsXG4gICAgICBhc3luYyAoY2h1bmspID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzKGNodW5rLCBpbmRleE5hbWUsIGZhbHNlKTtcbiAgICAgICAgcmV0dXJuIGNodW5rO1xuICAgICAgfSxcbiAgICAgIHsgdGFnczogeyBlbnRpdHk6IGVudGl0eU5hbWUgfSB9XG4gICAgKTtcbiAgfVxuXG4gIC8vIEhlbHBlciBtZXRob2QgdG8gY3JlYXRlIFNlYXJjaEluZGV4RW50cnkgZnJvbSBhIHJlY29yZFxuICBwcm90ZWN0ZWQgY3JlYXRlU2VhcmNoSW5kZXhFbnRyeShyZWNvcmQ6IEJhc2VFdmVudFJlY29yZDxUUGF5bG9hZD4pOiBTZWFyY2hJbmRleEVudHJ5IHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGV2ZW50VHlwZSwgZW50aXR5SWQsIHRpbWVzdGFtcCwgcGF5bG9hZDogcGF5bG9hZERhdGEsIG1ldGFkYXRhIH0gPSByZWNvcmQ7XG5cbiAgICAvLyBFeHRyYWN0IHNlYXJjaGFibGUgZGF0YSBiYXNlZCBvbiB0aGUgc291cmNlIHR5cGVcbiAgICBjb25zdCBzZWFyY2hhYmxlRGF0YSA9IHRoaXMudHJhbnNmb3JtUGF5bG9hZEZvckluZGV4aW5nKHBheWxvYWREYXRhLCBldmVudFR5cGUsIG1ldGFkYXRhPy5zb3VyY2UpO1xuXG4gICAgLy8gTm90ZTogdGltZXN0YW1wIGlzIGFscmVhZHkgaW4gbWlsbGlzZWNvbmRzIChjb252ZXJ0ZWQgZnJvbSBEeW5hbW9EQiBzZWNvbmRzIGluIHRoZSBkYXRhIGV4dHJhY3RvcilcbiAgICAvLyBFeGFtcGxlOiB0aW1lc3RhbXAgPSAxNzM0NTY3ODkwMDAwIChtaWxsaXNlY29uZHMpIC0+IFwiMjAyNC0xMi0xOVQxMDozMTozMC4wMDBaXCJcbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IGVudGl0eUlkIGFzIHN0cmluZyxcbiAgICAgIGRhdGE6IHNlYXJjaGFibGVEYXRhLFxuICAgICAgZXZlbnRUeXBlOiBldmVudFR5cGUgYXMgJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZWxldGUnLFxuICAgICAgdGltZXN0YW1wOiAodGltZXN0YW1wID8gbmV3IERhdGUodGltZXN0YW1wKSA6IG5ldyBEYXRlKCkpLnRvSVNPU3RyaW5nKCksXG4gICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lIGFzIHN0cmluZyxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFRyYW5zZm9ybSBwYXlsb2FkIGRhdGEgZm9yIHNlYXJjaCBpbmRleGluZyBiYXNlZCBvbiBzb3VyY2UgdHlwZVxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBpbiBzdWJjbGFzc2VzIGZvciBjdXN0b20gZGF0YSB0cmFuc2Zvcm1hdGlvblxuICAgKi9cbiAgcHJvdGVjdGVkIHRyYW5zZm9ybVBheWxvYWRGb3JJbmRleGluZyhwYXlsb2FkRGF0YTogYW55LCBldmVudFR5cGU6IHN0cmluZywgc291cmNlPzogc3RyaW5nKTogYW55IHtcbiAgICAvLyBGb3Igc3RyZWFtIHNvdXJjZXMsIHBheWxvYWQgaXMgQ2hhbmdlU3RyZWFtUGF5bG9hZCBmb3JtYXRcbiAgICBpZiAoc291cmNlID09PSAnc3RyZWFtJyAmJiBwYXlsb2FkRGF0YSAmJiB0eXBlb2YgcGF5bG9hZERhdGEgPT09ICdvYmplY3QnICYmXG4gICAgICAoJ29sZEltYWdlJyBpbiBwYXlsb2FkRGF0YSB8fCAnbmV3SW1hZ2UnIGluIHBheWxvYWREYXRhIHx8ICdrZXlzJyBpbiBwYXlsb2FkRGF0YSkpIHtcbiAgICAgIGNvbnN0IHsgb2xkSW1hZ2UsIG5ld0ltYWdlIH0gPSBwYXlsb2FkRGF0YTtcbiAgICAgIHJldHVybiB0aGlzLmV4dHJhY3RTZWFyY2hhYmxlRGF0YUZyb21DaGFuZ2VTdHJlYW0ob2xkSW1hZ2UsIG5ld0ltYWdlLCBldmVudFR5cGUpO1xuICAgIH1cblxuICAgIC8vIEhhbmRsZSBhcnJheSBwYXlsb2FkcyAtIGFkZCBfaW5kZXhlZEF0IHRvIGVhY2ggaXRlbVxuICAgIGlmIChBcnJheS5pc0FycmF5KHBheWxvYWREYXRhKSkge1xuICAgICAgcmV0dXJuIHBheWxvYWREYXRhLm1hcChpdGVtID0+ICh7XG4gICAgICAgIC4uLml0ZW0sXG4gICAgICAgIF9pbmRleGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIC8vIEZvciBzaW5nbGUgb2JqZWN0IHBheWxvYWRzLCB1c2UgcGF5bG9hZCBkaXJlY3RseVxuICAgIHJldHVybiB7XG4gICAgICAuLi5wYXlsb2FkRGF0YSxcbiAgICAgIF9pbmRleGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogRXh0cmFjdCBzZWFyY2hhYmxlIGRhdGEgZnJvbSBEeW5hbW9EQiBjaGFuZ2Ugc3RyZWFtIGZvcm1hdFxuICAgKiBPdmVycmlkZSB0aGlzIG1ldGhvZCBpbiBzdWJjbGFzc2VzIGZvciBjdXN0b20gZmllbGQgZmlsdGVyaW5nXG4gICAqL1xuICBwcm90ZWN0ZWQgZXh0cmFjdFNlYXJjaGFibGVEYXRhRnJvbUNoYW5nZVN0cmVhbShcbiAgICBvbGRJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBuZXdJbWFnZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCxcbiAgICBldmVudFR5cGU6IHN0cmluZ1xuICApOiBhbnkge1xuICAgIC8vIEZvciBkZWxldGlvbnMsIHdlIG9ubHkgbmVlZCB0aGUgSUQgdG8gcmVtb3ZlIGZyb20gaW5kZXhcbiAgICBpZiAoZXZlbnRUeXBlID09PSAnZGVsZXRlJykge1xuICAgICAgcmV0dXJuIHsgaWQ6IG9sZEltYWdlPy5pZCB9O1xuICAgIH1cblxuICAgIC8vIEZvciBjcmVhdGVzIGFuZCB1cGRhdGVzLCB1c2UgdGhlIG5ldyBpbWFnZVxuICAgIGNvbnN0IHNvdXJjZURhdGEgPSBuZXdJbWFnZSB8fCBvbGRJbWFnZTtcbiAgICBpZiAoIXNvdXJjZURhdGEpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBEeW5hbW9EQiBpbnRlcm5hbCBmaWVsZHMgYW5kIHByZXBhcmUgZm9yIHNlYXJjaCBpbmRleGluZ1xuICAgIGNvbnN0IGlnbm9yZWRLZXlzID0gW1xuICAgICAgJ19fRURCX0VfXycsICdfX0VEQl9WX18nLCAnUEsnLCAnU0snLFxuICAgICAgJ0dTSTFQSycsICdHU0kxU0snLCAnR1NJMlBLJywgJ0dTSTJTSycsICdHU0kzUEsnLCAnR1NJM1NLJywgJ0dTSTRQSycsICdHU0k0U0snLFxuICAgICAgJ1BBU1NXT1JEJ1xuICAgIF07XG5cbiAgICBjb25zdCBzZWFyY2hhYmxlRGF0YTogUmVjb3JkPHN0cmluZywgYW55PiA9IHsgLi4uc291cmNlRGF0YSB9O1xuXG4gICAgT2JqZWN0LmtleXMoc291cmNlRGF0YSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKGlnbm9yZWRLZXlzLmluY2x1ZGVzKGtleS50b1VwcGVyQ2FzZSgpKSB8fFxuICAgICAgICBrZXkuc3RhcnRzV2l0aCgnX18nKSB8fFxuICAgICAgICAoa2V5Lmxlbmd0aCA+IDMgJiYgWyAnR1NJJywgJ0xTSScgXS5pbmNsdWRlcyhrZXkuc3Vic3RyaW5nKDAsIDMpLnRvVXBwZXJDYXNlKCkpKSkge1xuICAgICAgICBkZWxldGUgc2VhcmNoYWJsZURhdGFbIGtleSBdO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLnNlYXJjaGFibGVEYXRhLFxuICAgICAgX2luZGV4ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBpbmRleE9yRGVsZXRlRG9jdW1lbnQoc2VhcmNoSW5kZXhFbnRyeTogU2VhcmNoSW5kZXhFbnRyeSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBkYXRhLCBpZCB9ID0gc2VhcmNoSW5kZXhFbnRyeTtcblxuICAgIHRoaXMubG9nZ2VyLmluZm8oJ1Byb2Nlc3Npbmcgc2VhcmNoIGluZGV4IG9wZXJhdGlvbicsIHsgZW50aXR5TmFtZSwgZXZlbnRUeXBlLCBpZCB9KTtcblxuICAgIGNvbnN0IGluZGV4TmFtZSA9IHRoaXMuZ2V0SW5kZXhOYW1lKGVudGl0eU5hbWUpO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEVuc3VyZSB0aGUgaW5kZXggZXhpc3RzXG4gICAgICAvLyB3ZSB3b24ndCBiZSBhYmxlIHRvIGNyZWF0ZSBhbiBpbmRleCBoZXJlIGFzIHdlIGRvLW5vdCBoYXZlIGFjY2VzcyB0byBlbnRpdHktaW5kZXggY29uZmlnLi4gXG4gICAgICAvLyBpbmRleGVzIGFyZSBzdXBwb3NlZCB0byBiZSBzZXR1cCBieSB0aGUgYXBwbGljYXRpb247IFxuICAgICAgYXdhaXQgdGhpcy5lbnN1cmVJbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuXG4gICAgICAvLyBIYW5kbGUgZGlmZmVyZW50IGV2ZW50IHR5cGVzXG4gICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgICAgIGF3YWl0IHRoaXMuaW5kZXhEb2N1bWVudERhdGEoaW5kZXhOYW1lLCBkYXRhLCBpZCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICAgICAgYXdhaXQgdGhpcy5kZWxldGVEb2N1bWVudChpbmRleE5hbWUsIGlkKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKCdVbmtub3duIGV2ZW50IHR5cGUnLCB7IGV2ZW50VHlwZSB9KTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1N1Y2Nlc3NmdWxseSBwcm9jZXNzZWQgc2VhcmNoIGluZGV4IG9wZXJhdGlvbicsIHsgaW5kZXhOYW1lLCBldmVudFR5cGUsIGlkIH0pO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcblxuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoJ0Vycm9yIHByb2Nlc3Npbmcgc2VhcmNoIGluZGV4IG9wZXJhdGlvbicsIHsgZXJyb3IsIGluZGV4TmFtZSwgZXZlbnRUeXBlLCBpZCB9KTtcblxuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGdldEluZGV4TmFtZShlbnRpdHlOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRhYmxlTmFtZUtleSA9IHJlc29sdmVFbnZWYWx1ZUZvcih7IGtleTogU0VBUkNIX0lOREVYRVJfRU5WX0tFWVMuVEFCTEVfTkFNRV9FTlZfS0VZIH0pO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ3RhYmxlTmFtZUtleScsIHsgdGFibGVOYW1lS2V5IH0pO1xuICAgIGlmICghdGFibGVOYW1lS2V5KSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoVmFsaWRhdGlvbkVycm9yKGAke1NFQVJDSF9JTkRFWEVSX0VOVl9LRVlTLlRBQkxFX05BTUVfRU5WX0tFWX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lYCk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVOYW1lID0gcmVzb2x2ZUVudlZhbHVlRm9yKHsga2V5OiB0YWJsZU5hbWVLZXksIHN1ZmZpeDogJ3RhYmxlJyB9KTtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKCd0YWJsZU5hbWUnLCB7IHRhYmxlTmFtZSB9KTtcblxuICAgIGlmICghdGFibGVOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoVmFsaWRhdGlvbkVycm9yKGAke3RhYmxlTmFtZX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lYCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXhOYW1lID0gbWFrZUVudGl0eVNlYXJjaEluZGV4TmFtZSh7IHRhYmxlTmFtZSwgZW50aXR5TmFtZSB9KTtcblxuICAgIHJldHVybiBpbmRleE5hbWU7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZW5zdXJlSW5kZXhFeGlzdHMoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBleGlzdHMgPSBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0cyhpbmRleE5hbWUpO1xuICAgIGlmICghZXhpc3RzKSB7XG4gICAgICB0aHJvdyBuZXcgU2VhcmNoRW5naW5lRXJyb3IoYEluZGV4ICR7aW5kZXhOYW1lfSBkb2VzIG5vdCBleGlzdGAsIHsgaW5kZXhOYW1lIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBpbmRleERvY3VtZW50RGF0YShpbmRleE5hbWU6IHN0cmluZywgZGF0YTogYW55LCBpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFkYXRhIHx8ICFkYXRhLmlkKSB7XG4gICAgICAvLyBFbnN1cmUgdGhlIGRvY3VtZW50IGhhcyBhbiBJRFxuICAgICAgZGF0YSA9IHsgLi4uZGF0YSwgaWQgfTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50cyhbIGRhdGEgXSwgeyBpbmRleE5hbWUgfSwgZmFsc2UpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oJ0RvY3VtZW50IGluZGV4ZWQgc3VjY2Vzc2Z1bGx5JywgeyBpbmRleE5hbWUsIGlkIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlbGV0ZURvY3VtZW50KGluZGV4TmFtZTogc3RyaW5nLCBpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzKFsgaWQgXSwgaW5kZXhOYW1lLCBmYWxzZSk7XG4gICAgdGhpcy5sb2dnZXIuaW5mbygnRG9jdW1lbnQgZGVsZXRlZCBzdWNjZXNzZnVsbHknLCB7IGluZGV4TmFtZSwgaWQgfSk7XG4gIH1cblxufSJdfQ==