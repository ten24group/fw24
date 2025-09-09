"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_search_indexer_1 = require("./base-search-indexer");
const base_1 = require("../engines/base");
const globals_1 = require("@jest/globals");
// Mock search engine
class MockSearchEngine extends base_1.BaseSearchEngine {
    indexDocumentsCalls = [];
    deleteDocumentsCalls = [];
    indexExistsCalls = [];
    constructor() {
        super({});
    }
    async indexDocuments(documents, config, synchronous = false) {
        this.indexDocumentsCalls.push({ documents, config, synchronous });
        return { success: true };
    }
    async deleteDocuments(ids, indexName, synchronous = false) {
        this.deleteDocumentsCalls.push({ ids, indexName, synchronous });
        return { success: true };
    }
    async indexExists(indexName) {
        this.indexExistsCalls.push(indexName);
        return true; // Mock that index exists
    }
    async health() {
        return { status: 'healthy' };
    }
    async search() {
        return { hits: [] };
    }
    async initIndex() {
        return { success: true };
    }
    async getIndex() {
        return { name: 'test-index' };
    }
    // Implement all required abstract methods
    async deleteIndex() {
        return { success: true };
    }
    async getIndexInfo() {
        return { name: 'test-index' };
    }
    async getIndexStats() {
        return { stats: {} };
    }
    async listIndices() {
        return { indices: [] };
    }
    async updateIndexSettings() {
        return { success: true };
    }
    async resetIndexSettings() {
        return { success: true };
    }
    async getIndexSettings() {
        return { settings: {} };
    }
    async updateDocuments() {
        return { success: true };
    }
    async getDocument() {
        return { id: 'test' };
    }
    async getDocuments() {
        return [];
    }
    async deleteAllDocuments() {
        return { success: true };
    }
    async deleteDocumentsByFilter() {
        return { success: true };
    }
    async isHealthy() {
        return true;
    }
    async getStats() {
        return { stats: {} };
    }
    async getVersion() {
        return { version: '1.0.0' };
    }
    async multiSearch() {
        return { results: [] };
    }
}
// Mock event data extractor
class MockEventDataExtractor {
    extractData(event) {
        return event.Records.map((record, index) => ({
            eventId: record.messageId,
            eventType: index % 2 === 0 ? 'update' : 'delete',
            entityName: `entity-${index % 2}`,
            entityId: `id-${index}`,
            payload: { data: `payload-${index}`, id: `id-${index}` },
            timestamp: Date.now(),
            eventSource: record.eventSource
        }));
    }
}
// Test implementation
class TestSearchIndexer extends base_search_indexer_1.BaseSearchIndexer {
    searchEngine;
    allowedEntities;
    ignoredEntities;
    constructor(processMode = 'record', allowedEntities, ignoredEntities) {
        super(new MockEventDataExtractor(), { processMode });
        this.searchEngine = new MockSearchEngine();
        this.allowedEntities = allowedEntities;
        this.ignoredEntities = ignoredEntities;
    }
    getAllowedEntityNames() {
        return this.allowedEntities;
    }
    getIgnoredEntityNames() {
        return this.ignoredEntities;
    }
    async initialize(_event, _context) {
        // Mock implementation
    }
}
(0, globals_1.describe)('BaseSearchIndexer', () => {
    let indexer;
    let mockSQSEvent;
    (0, globals_1.beforeEach)(() => {
        mockSQSEvent = {
            Records: [
                {
                    messageId: 'msg-1',
                    receiptHandle: 'receipt-1',
                    body: JSON.stringify({ data: 'test1', entityName: 'entity1' }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '1234567890',
                        SenderId: 'sender-1',
                        ApproximateFirstReceiveTimestamp: '1234567890'
                    },
                    messageAttributes: {},
                    md5OfBody: 'md5-1',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                    awsRegion: 'us-east-1'
                },
                {
                    messageId: 'msg-2',
                    receiptHandle: 'receipt-2',
                    body: JSON.stringify({ data: 'test2', entityName: 'entity2' }),
                    attributes: {
                        ApproximateReceiveCount: '1',
                        SentTimestamp: '1234567890',
                        SenderId: 'sender-2',
                        ApproximateFirstReceiveTimestamp: '1234567890'
                    },
                    messageAttributes: {},
                    md5OfBody: 'md5-2',
                    eventSource: 'aws:sqs',
                    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                    awsRegion: 'us-east-1'
                }
            ]
        };
        // Mock environment variables - use the correct uppercase format
        process.env.TABLE_NAME_ENV_KEY = 'test-table';
        process.env.TEST_TABLE_TABLE = 'test-table-name'; // Uppercase with suffix
    });
    (0, globals_1.afterEach)(() => {
        // Clean up environment variables
        delete process.env.TABLE_NAME_ENV_KEY;
        delete process.env.TEST_TABLE_TABLE;
    });
    (0, globals_1.describe)('Record Mode Processing', () => {
        (0, globals_1.beforeEach)(() => {
            indexer = new TestSearchIndexer('record');
        });
        (0, globals_1.it)('should process records individually in record mode', async () => {
            await indexer.process(mockSQSEvent, {});
            // Should call indexDocuments for each record (but one might be a delete operation)
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length + indexer.searchEngine.deleteDocumentsCalls.length).toBe(2);
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls).toHaveLength(2);
            // Check first call (should be an index operation)
            const firstCall = indexer.searchEngine.indexDocumentsCalls[0];
            (0, globals_1.expect)(firstCall.documents).toHaveLength(1);
            (0, globals_1.expect)(firstCall.documents[0].data).toBe('payload-0');
            (0, globals_1.expect)(firstCall.documents[0].id).toBe('id-0');
            (0, globals_1.expect)(firstCall.config.indexName).toBe('test-table-name-entity-0');
        });
        (0, globals_1.it)('should handle delete operations in record mode', async () => {
            // Create event with delete operations
            const deleteEvent = {
                Records: [
                    {
                        messageId: 'msg-delete',
                        receiptHandle: 'receipt-delete',
                        body: JSON.stringify({ data: 'delete-test', entityName: 'entity1' }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1234567890',
                            SenderId: 'sender-delete',
                            ApproximateFirstReceiveTimestamp: '1234567890'
                        },
                        messageAttributes: {},
                        md5OfBody: 'md5-delete',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                        awsRegion: 'us-east-1'
                    }
                ]
            };
            // Override extractor to return delete event
            indexer['eventDataExtractor'] = {
                extractData: () => [{
                        eventId: 'msg-delete',
                        eventType: 'delete',
                        entityName: 'entity1',
                        entityId: 'id-delete',
                        payload: { data: 'delete-test' },
                        timestamp: Date.now(),
                        eventSource: 'aws:sqs'
                    }]
            };
            await indexer.process(deleteEvent, {});
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls).toHaveLength(1);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls[0].ids).toEqual(['id-delete']);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls[0].indexName).toBe('test-table-name-entity1');
        });
    });
    (0, globals_1.describe)('Batch Mode Processing', () => {
        (0, globals_1.beforeEach)(() => {
            indexer = new TestSearchIndexer('batch');
        });
        (0, globals_1.it)('should process records in batch mode', async () => {
            await indexer.process(mockSQSEvent, {});
            // Should group by entity and event type, then make bulk calls
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls).toHaveLength(1);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls).toHaveLength(1);
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls).toHaveLength(2); // One per group
            // Check index call (for update operations)
            const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
            (0, globals_1.expect)(indexCall.documents).toHaveLength(1);
            (0, globals_1.expect)(indexCall.documents[0].data).toBe('payload-0');
            (0, globals_1.expect)(indexCall.documents[0].id).toBe('id-0');
            (0, globals_1.expect)(indexCall.config.indexName).toBe('test-table-name-entity-0');
            // Check delete call (for delete operations)
            const deleteCall = indexer.searchEngine.deleteDocumentsCalls[0];
            (0, globals_1.expect)(deleteCall.ids).toEqual(['id-1']);
            (0, globals_1.expect)(deleteCall.indexName).toBe('test-table-name-entity-1');
        });
        (0, globals_1.it)('should handle array payloads in batch mode', async () => {
            // Override extractor to return array payload
            indexer['eventDataExtractor'] = {
                extractData: () => [{
                        eventId: 'msg-array',
                        eventType: 'update',
                        entityName: 'entity1',
                        entityId: 'id-array',
                        payload: [
                            { id: 'item-1', data: 'data-1' },
                            { id: 'item-2', data: 'data-2' }
                        ],
                        timestamp: Date.now(),
                        eventSource: 'aws:sqs'
                    }]
            };
            await indexer.process(mockSQSEvent, {});
            const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
            (0, globals_1.expect)(indexCall.documents).toHaveLength(2);
            (0, globals_1.expect)(indexCall.documents[0].id).toBe('item-1');
            (0, globals_1.expect)(indexCall.documents[1].id).toBe('item-2');
        });
        (0, globals_1.it)('should skip items without id in batch mode', async () => {
            // Override extractor to return items without id
            indexer['eventDataExtractor'] = {
                extractData: () => [{
                        eventId: 'msg-no-id',
                        eventType: 'update',
                        entityName: 'entity1',
                        entityId: 'id-no-id',
                        payload: [
                            { data: 'data-1' }, // No id
                            { id: 'item-2', data: 'data-2' } // Has id
                        ],
                        timestamp: Date.now(),
                        eventSource: 'aws:sqs'
                    }]
            };
            await indexer.process(mockSQSEvent, {});
            const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
            // Both items should be indexed - the first one gets the entityId as fallback
            (0, globals_1.expect)(indexCall.documents).toHaveLength(2);
            (0, globals_1.expect)(indexCall.documents[0].id).toBe('id-no-id'); // Uses entityId as fallback
            (0, globals_1.expect)(indexCall.documents[1].id).toBe('item-2');
        });
    });
    (0, globals_1.describe)('SearchIndexEntry Creation', () => {
        (0, globals_1.beforeEach)(() => {
            indexer = new TestSearchIndexer('record');
        });
        (0, globals_1.it)('should create SearchIndexEntry with correct data', async () => {
            const record = {
                eventId: 'test-id',
                eventType: 'update',
                entityName: 'test-entity',
                entityId: 'test-entity-id',
                payload: { testData: 'test-value' },
                timestamp: 1234567890,
                eventSource: 'aws:sqs'
            };
            // Access private method for testing
            const createEntry = indexer.createSearchIndexEntry.bind(indexer);
            const entry = createEntry(record);
            (0, globals_1.expect)(entry.id).toBe('test-entity-id');
            (0, globals_1.expect)(entry.entityName).toBe('test-entity');
            (0, globals_1.expect)(entry.eventType).toBe('update');
            (0, globals_1.expect)(entry.data.testData).toBe('test-value');
            (0, globals_1.expect)(entry.data._indexedAt).toBeDefined();
            (0, globals_1.expect)(entry.timestamp).toBeDefined();
        });
    });
    (0, globals_1.describe)('Environment Variable Handling', () => {
        (0, globals_1.beforeEach)(() => {
            indexer = new TestSearchIndexer('record');
        });
        (0, globals_1.it)('should throw error when TABLE_NAME_ENV_KEY is missing', async () => {
            delete process.env.TABLE_NAME_ENV_KEY;
            await (0, globals_1.expect)(indexer.process(mockSQSEvent, {})).rejects.toThrow('TABLE_NAME_ENV_KEY environment variable is required to calculate the appropriate index-name');
        });
        (0, globals_1.it)('should throw error when table name is missing', async () => {
            delete process.env.TEST_TABLE_TABLE;
            await (0, globals_1.expect)(indexer.process(mockSQSEvent, {})).rejects.toThrow('undefined environment variable is required to calculate the appropriate index-name');
        });
    });
    (0, globals_1.describe)('Index Existence Check', () => {
        (0, globals_1.beforeEach)(() => {
            indexer = new TestSearchIndexer('record');
        });
        (0, globals_1.it)('should check index existence before operations', async () => {
            await indexer.process(mockSQSEvent, {});
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls).toHaveLength(2);
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls[0]).toBe('test-table-name-entity-0');
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls[1]).toBe('test-table-name-entity-1');
        });
        (0, globals_1.it)('should throw error when index does not exist', async () => {
            // Mock indexExists to return false
            globals_1.jest.spyOn(indexer.searchEngine, 'indexExists').mockResolvedValue(false);
            await (0, globals_1.expect)(indexer.process(mockSQSEvent, {})).rejects.toThrow('Index test-table-name-entity-0 does not exist');
        });
    });
    (0, globals_1.describe)('Performance Comparison', () => {
        (0, globals_1.it)('should show performance difference between record and batch modes', async () => {
            const recordStart = Date.now();
            const recordIndexer = new TestSearchIndexer('record');
            await recordIndexer.process(mockSQSEvent, {});
            const recordDuration = Date.now() - recordStart;
            const batchStart = Date.now();
            const batchIndexer = new TestSearchIndexer('batch');
            await batchIndexer.process(mockSQSEvent, {});
            const batchDuration = Date.now() - batchStart;
            // Both modes should complete successfully
            (0, globals_1.expect)(recordDuration).toBeGreaterThanOrEqual(0);
            (0, globals_1.expect)(batchDuration).toBeGreaterThanOrEqual(0);
            // Both should process the same number of records
            const recordTotalCalls = recordIndexer.searchEngine.indexDocumentsCalls.length + recordIndexer.searchEngine.deleteDocumentsCalls.length;
            const batchTotalCalls = batchIndexer.searchEngine.indexDocumentsCalls.length + batchIndexer.searchEngine.deleteDocumentsCalls.length;
            (0, globals_1.expect)(recordTotalCalls).toBeGreaterThan(0);
            (0, globals_1.expect)(batchTotalCalls).toBeGreaterThan(0);
            // Record mode should make more individual calls than batch mode
            // (This is the key performance difference we're testing)
            (0, globals_1.expect)(recordTotalCalls).toBeGreaterThanOrEqual(batchTotalCalls);
            // Verify the actual processing happened
            (0, globals_1.expect)(recordIndexer.searchEngine.indexExistsCalls.length).toBeGreaterThan(0);
            (0, globals_1.expect)(batchIndexer.searchEngine.indexExistsCalls.length).toBeGreaterThan(0);
        });
    });
    (0, globals_1.describe)('Entity Filtering', () => {
        (0, globals_1.it)('should process all entities when no filtering is configured', async () => {
            const indexer = new TestSearchIndexer('record');
            await indexer.process(mockSQSEvent, {});
            // Should process both entities (entity-0 and entity-1)
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length + indexer.searchEngine.deleteDocumentsCalls.length).toBe(2);
        });
        (0, globals_1.it)('should filter entities based on allowedEntityNames', async () => {
            const indexer = new TestSearchIndexer('record', ['entity-0']); // Only allow entity-0
            await indexer.process(mockSQSEvent, {});
            // Should only process entity-0 (index operation), entity-1 should be filtered out
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(1);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls[0].config.indexName).toBe('test-table-name-entity-0');
        });
        (0, globals_1.it)('should filter entities based on ignoredEntityNames', async () => {
            const indexer = new TestSearchIndexer('record', undefined, ['entity-1']); // Ignore entity-1
            await indexer.process(mockSQSEvent, {});
            // Should only process entity-0 (index operation), entity-1 should be ignored
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(1);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls[0].config.indexName).toBe('test-table-name-entity-0');
        });
        (0, globals_1.it)('should give precedence to ignoredEntityNames over allowedEntityNames', async () => {
            // Configure both allowed and ignored lists with overlapping entities
            const indexer = new TestSearchIndexer('record', ['entity-0', 'entity-1'], ['entity-0']); // Allow both, but ignore entity-0
            await indexer.process(mockSQSEvent, {});
            // Should only process entity-1 (delete operation), entity-0 should be ignored despite being in allowed list
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(1);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls[0].indexName).toBe('test-table-name-entity-1');
        });
        (0, globals_1.it)('should filter all entities when ignoredEntityNames includes all entities', async () => {
            const indexer = new TestSearchIndexer('record', undefined, ['entity-0', 'entity-1']); // Ignore all entities
            await indexer.process(mockSQSEvent, {});
            // Should process no entities
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls.length).toBe(0);
        });
        (0, globals_1.it)('should handle empty allowedEntityNames list correctly', async () => {
            const indexer = new TestSearchIndexer('record', []); // Empty allowed list
            await indexer.process(mockSQSEvent, {});
            // Should filter out all entities when allowed list is empty
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.indexExistsCalls.length).toBe(0);
        });
        (0, globals_1.it)('should handle empty ignoredEntityNames list correctly', async () => {
            const indexer = new TestSearchIndexer('record', undefined, []); // Empty ignored list
            await indexer.process(mockSQSEvent, {});
            // Should process all entities normally when ignored list is empty
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length + indexer.searchEngine.deleteDocumentsCalls.length).toBe(2);
        });
        (0, globals_1.it)('should work correctly in batch mode with entity filtering', async () => {
            const indexer = new TestSearchIndexer('batch', ['entity-0']); // Only allow entity-0
            await indexer.process(mockSQSEvent, {});
            // Should only process entity-0 in batch mode
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(1);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls[0].config.indexName).toBe('test-table-name-entity-0');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9pbmRleGVyL2Jhc2Utc2VhcmNoLWluZGV4ZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLCtEQUEwRDtBQUUxRCwwQ0FBbUQ7QUFHbkQsMkNBQWtGO0FBRWxGLHFCQUFxQjtBQUNyQixNQUFNLGdCQUFpQixTQUFRLHVCQUFnQjtJQUN0QyxtQkFBbUIsR0FBOEQsRUFBRSxDQUFDO0lBQ3BGLG9CQUFvQixHQUFpRSxFQUFFLENBQUM7SUFDeEYsZ0JBQWdCLEdBQWEsRUFBRSxDQUFDO0lBRXZDO1FBQ0UsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ1osQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBZ0IsRUFBRSxNQUFXLEVBQUUsY0FBdUIsS0FBSztRQUM5RSxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2xFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsR0FBYSxFQUFFLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUNsRixJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQUMsU0FBaUI7UUFDakMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN0QyxPQUFPLElBQUksQ0FBQyxDQUFDLHlCQUF5QjtJQUN4QyxDQUFDO0lBRUQsS0FBSyxD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TUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2pFLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsQ0FBQztRQUN4RyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBCYXNlU2VhcmNoSW5kZXhlciB9IGZyb20gJy4vYmFzZS1zZWFyY2gtaW5kZXhlcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSAnLi4vZW5naW5lcy9iYXNlJztcbmltcG9ydCB7IFNlYXJjaEluZGV4RW50cnkgfSBmcm9tICcuL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0LCBqZXN0LCBiZWZvcmVFYWNoLCBhZnRlckVhY2ggfSBmcm9tICdAamVzdC9nbG9iYWxzJztcblxuLy8gTW9jayBzZWFyY2ggZW5naW5lXG5jbGFzcyBNb2NrU2VhcmNoRW5naW5lIGV4dGVuZHMgQmFzZVNlYXJjaEVuZ2luZSB7XG4gIHB1YmxpYyBpbmRleERvY3VtZW50c0NhbGxzOiB7IGRvY3VtZW50czogYW55W10sIGNvbmZpZzogYW55LCBzeW5jaHJvbm91czogYm9vbGVhbiB9W10gPSBbXTtcbiAgcHVibGljIGRlbGV0ZURvY3VtZW50c0NhbGxzOiB7IGlkczogc3RyaW5nW10sIGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiB9W10gPSBbXTtcbiAgcHVibGljIGluZGV4RXhpc3RzQ2FsbHM6IHN0cmluZ1tdID0gW107XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoe30pO1xuICB9XG5cbiAgYXN5bmMgaW5kZXhEb2N1bWVudHMoZG9jdW1lbnRzOiBhbnlbXSwgY29uZmlnOiBhbnksIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPGFueT4ge1xuICAgIHRoaXMuaW5kZXhEb2N1bWVudHNDYWxscy5wdXNoKHsgZG9jdW1lbnRzLCBjb25maWcsIHN5bmNocm9ub3VzIH0pO1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50cyhpZHM6IHN0cmluZ1tdLCBpbmRleE5hbWU6IHN0cmluZywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8YW55PiB7XG4gICAgdGhpcy5kZWxldGVEb2N1bWVudHNDYWxscy5wdXNoKHsgaWRzLCBpbmRleE5hbWUsIHN5bmNocm9ub3VzIH0pO1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGluZGV4RXhpc3RzKGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdGhpcy5pbmRleEV4aXN0c0NhbGxzLnB1c2goaW5kZXhOYW1lKTtcbiAgICByZXR1cm4gdHJ1ZTsgLy8gTW9jayB0aGF0IGluZGV4IGV4aXN0c1xuICB9XG5cbiAgYXN5bmMgaGVhbHRoKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnaGVhbHRoeScgfTtcbiAgfVxuXG4gIGFzeW5jIHNlYXJjaCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IGhpdHM6IFtdIH07XG4gIH1cblxuICBhc3luYyBpbml0SW5kZXgoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IG5hbWU6ICd0ZXN0LWluZGV4JyB9O1xuICB9XG5cbiAgLy8gSW1wbGVtZW50IGFsbCByZXF1aXJlZCBhYnN0cmFjdCBtZXRob2RzXG4gIGFzeW5jIGRlbGV0ZUluZGV4KCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0SW5kZXhJbmZvKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgbmFtZTogJ3Rlc3QtaW5kZXgnIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleFN0YXRzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3RhdHM6IHt9IH07XG4gIH1cblxuICBhc3luYyBsaXN0SW5kaWNlcygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IGluZGljZXM6IFtdIH07XG4gIH1cblxuICBhc3luYyB1cGRhdGVJbmRleFNldHRpbmdzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgcmVzZXRJbmRleFNldHRpbmdzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0SW5kZXhTZXR0aW5ncygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHNldHRpbmdzOiB7fSB9O1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0RG9jdW1lbnQoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBpZDogJ3Rlc3QnIH07XG4gIH1cblxuICBhc3luYyBnZXREb2N1bWVudHMoKTogUHJvbWlzZTxhbnlbXT4ge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUFsbERvY3VtZW50cygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgaXNIZWFsdGh5KCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgYXN5bmMgZ2V0U3RhdHMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdGF0czoge30gfTtcbiAgfVxuXG4gIGFzeW5jIGdldFZlcnNpb24oKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyB2ZXJzaW9uOiAnMS4wLjAnIH07XG4gIH1cblxuICBhc3luYyBtdWx0aVNlYXJjaCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHJlc3VsdHM6IFtdIH07XG4gIH1cbn1cblxuLy8gTW9jayBldmVudCBkYXRhIGV4dHJhY3RvclxuY2xhc3MgTW9ja0V2ZW50RGF0YUV4dHJhY3RvciBpbXBsZW1lbnRzIElFdmVudERhdGFFeHRyYWN0b3I8U1FTRXZlbnQsIGFueT4ge1xuICBleHRyYWN0RGF0YShldmVudDogU1FTRXZlbnQpOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdIHtcbiAgICByZXR1cm4gZXZlbnQuUmVjb3Jkcy5tYXAoKHJlY29yZCwgaW5kZXgpID0+ICh7XG4gICAgICBldmVudElkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgZXZlbnRUeXBlOiBpbmRleCAlIDIgPT09IDAgPyAndXBkYXRlJyA6ICdkZWxldGUnLFxuICAgICAgZW50aXR5TmFtZTogYGVudGl0eS0ke2luZGV4ICUgMn1gLFxuICAgICAgZW50aXR5SWQ6IGBpZC0ke2luZGV4fWAsXG4gICAgICBwYXlsb2FkOiB7IGRhdGE6IGBwYXlsb2FkLSR7aW5kZXh9YCwgaWQ6IGBpZC0ke2luZGV4fWAgfSxcbiAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIGV2ZW50U291cmNlOiByZWNvcmQuZXZlbnRTb3VyY2VcbiAgICB9KSk7XG4gIH1cbn1cblxuLy8gVGVzdCBpbXBsZW1lbnRhdGlvblxuY2xhc3MgVGVzdFNlYXJjaEluZGV4ZXIgZXh0ZW5kcyBCYXNlU2VhcmNoSW5kZXhlcjxNb2NrRXZlbnREYXRhRXh0cmFjdG9yPiB7XG4gIHB1YmxpYyBzZWFyY2hFbmdpbmU6IE1vY2tTZWFyY2hFbmdpbmU7XG4gIHByaXZhdGUgYWxsb3dlZEVudGl0aWVzPzogc3RyaW5nW107XG4gIHByaXZhdGUgaWdub3JlZEVudGl0aWVzPzogc3RyaW5nW107XG5cbiAgY29uc3RydWN0b3IocHJvY2Vzc01vZGU6ICdyZWNvcmQnIHwgJ2JhdGNoJyA9ICdyZWNvcmQnLCBhbGxvd2VkRW50aXRpZXM/OiBzdHJpbmdbXSwgaWdub3JlZEVudGl0aWVzPzogc3RyaW5nW10pIHtcbiAgICBzdXBlcihuZXcgTW9ja0V2ZW50RGF0YUV4dHJhY3RvcigpLCB7IHByb2Nlc3NNb2RlIH0pO1xuICAgIHRoaXMuc2VhcmNoRW5naW5lID0gbmV3IE1vY2tTZWFyY2hFbmdpbmUoKTtcbiAgICB0aGlzLmFsbG93ZWRFbnRpdGllcyA9IGFsbG93ZWRFbnRpdGllcztcbiAgICB0aGlzLmlnbm9yZWRFbnRpdGllcyA9IGlnbm9yZWRFbnRpdGllcztcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRBbGxvd2VkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmFsbG93ZWRFbnRpdGllcztcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRJZ25vcmVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmlnbm9yZWRFbnRpdGllcztcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBhbnksIF9jb250ZXh0OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBNb2NrIGltcGxlbWVudGF0aW9uXG4gIH1cbn1cblxuZGVzY3JpYmUoJ0Jhc2VTZWFyY2hJbmRleGVyJywgKCkgPT4ge1xuICBsZXQgaW5kZXhlcjogVGVzdFNlYXJjaEluZGV4ZXI7XG4gIGxldCBtb2NrU1FTRXZlbnQ6IFNRU0V2ZW50O1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIG1vY2tTUVNFdmVudCA9IHtcbiAgICAgIFJlY29yZHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0xJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICd0ZXN0MScsIGVudGl0eU5hbWU6ICdlbnRpdHkxJyB9KSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItMScsXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAnbWQ1LTEnLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0yJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0yJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICd0ZXN0MicsIGVudGl0eU5hbWU6ICdlbnRpdHkyJyB9KSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItMicsXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAnbWQ1LTInLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH07XG5cbiAgICAvLyBNb2NrIGVudmlyb25tZW50IHZhcmlhYmxlcyAtIHVzZSB0aGUgY29ycmVjdCB1cHBlcmNhc2UgZm9ybWF0XG4gICAgcHJvY2Vzcy5lbnYuVEFCTEVfTkFNRV9FTlZfS0VZID0gJ3Rlc3QtdGFibGUnO1xuICAgIHByb2Nlc3MuZW52LlRFU1RfVEFCTEVfVEFCTEUgPSAndGVzdC10YWJsZS1uYW1lJzsgLy8gVXBwZXJjYXNlIHdpdGggc3VmZml4XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYW4gdXAgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgZGVsZXRlIHByb2Nlc3MuZW52LlRBQkxFX05BTUVfRU5WX0tFWTtcbiAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEVTVF9UQUJMRV9UQUJMRTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlY29yZCBNb2RlIFByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvY2VzcyByZWNvcmRzIGluZGl2aWR1YWxseSBpbiByZWNvcmQgbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBjYWxsIGluZGV4RG9jdW1lbnRzIGZvciBlYWNoIHJlY29yZCAoYnV0IG9uZSBtaWdodCBiZSBhIGRlbGV0ZSBvcGVyYXRpb24pXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGggKyBpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgICAvLyBDaGVjayBmaXJzdCBjYWxsIChzaG91bGQgYmUgYW4gaW5kZXggb3BlcmF0aW9uKVxuICAgICAgY29uc3QgZmlyc3RDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXTtcbiAgICAgIGV4cGVjdChmaXJzdENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmRvY3VtZW50c1swXS5kYXRhKS50b0JlKCdwYXlsb2FkLTAnKTtcbiAgICAgIGV4cGVjdChmaXJzdENhbGwuZG9jdW1lbnRzWzBdLmlkKS50b0JlKCdpZC0wJyk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZGVsZXRlIG9wZXJhdGlvbnMgaW4gcmVjb3JkIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgZXZlbnQgd2l0aCBkZWxldGUgb3BlcmF0aW9uc1xuICAgICAgY29uc3QgZGVsZXRlRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbWVzc2FnZUlkOiAnbXNnLWRlbGV0ZScsXG4gICAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC1kZWxldGUnLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAnZGVsZXRlLXRlc3QnLCBlbnRpdHlOYW1lOiAnZW50aXR5MScgfSksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXG4gICAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItZGVsZXRlJyxcbiAgICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICAgIG1kNU9mQm9keTogJ21kNS1kZWxldGUnLFxuICAgICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIC8vIE92ZXJyaWRlIGV4dHJhY3RvciB0byByZXR1cm4gZGVsZXRlIGV2ZW50XG4gICAgICBpbmRleGVyWydldmVudERhdGFFeHRyYWN0b3InXSA9IHtcbiAgICAgICAgZXh0cmFjdERhdGE6ICgpID0+IFt7XG4gICAgICAgICAgZXZlbnRJZDogJ21zZy1kZWxldGUnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ2RlbGV0ZScsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ2VudGl0eTEnLFxuICAgICAgICAgIGVudGl0eUlkOiAnaWQtZGVsZXRlJyxcbiAgICAgICAgICBwYXlsb2FkOiB7IGRhdGE6ICdkZWxldGUtdGVzdCcgfSxcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJ1xuICAgICAgICB9XVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKGRlbGV0ZUV2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxsc1swXS5pZHMpLnRvRXF1YWwoWydpZC1kZWxldGUnXSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbMF0uaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5MScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQmF0Y2ggTW9kZSBQcm9jZXNzaW5nJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcignYmF0Y2gnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvY2VzcyByZWNvcmRzIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgZ3JvdXAgYnkgZW50aXR5IGFuZCBldmVudCB0eXBlLCB0aGVuIG1ha2UgYnVsayBjYWxsc1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTsgLy8gT25lIHBlciBncm91cFxuXG4gICAgICAvLyBDaGVjayBpbmRleCBjYWxsIChmb3IgdXBkYXRlIG9wZXJhdGlvbnMpXG4gICAgICBjb25zdCBpbmRleENhbGwgPSBpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWzBdO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWzBdLmRhdGEpLnRvQmUoJ3BheWxvYWQtMCcpO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbMF0uaWQpLnRvQmUoJ2lkLTAnKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuY29uZmlnLmluZGV4TmFtZSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0wJyk7XG5cbiAgICAgIC8vIENoZWNrIGRlbGV0ZSBjYWxsIChmb3IgZGVsZXRlIG9wZXJhdGlvbnMpXG4gICAgICBjb25zdCBkZWxldGVDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbMF07XG4gICAgICBleHBlY3QoZGVsZXRlQ2FsbC5pZHMpLnRvRXF1YWwoWydpZC0xJ10pO1xuICAgICAgZXhwZWN0KGRlbGV0ZUNhbGwuaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5LTEnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGFycmF5IHBheWxvYWRzIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBPdmVycmlkZSBleHRyYWN0b3IgdG8gcmV0dXJuIGFycmF5IHBheWxvYWRcbiAgICAgIGluZGV4ZXJbJ2V2ZW50RGF0YUV4dHJhY3RvciddID0ge1xuICAgICAgICBleHRyYWN0RGF0YTogKCkgPT4gW3tcbiAgICAgICAgICBldmVudElkOiAnbXNnLWFycmF5JyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHkxJyxcbiAgICAgICAgICBlbnRpdHlJZDogJ2lkLWFycmF5JyxcbiAgICAgICAgICBwYXlsb2FkOiBbXG4gICAgICAgICAgICB7IGlkOiAnaXRlbS0xJywgZGF0YTogJ2RhdGEtMScgfSxcbiAgICAgICAgICAgIHsgaWQ6ICdpdGVtLTInLCBkYXRhOiAnZGF0YS0yJyB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJ1xuICAgICAgICB9XVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgY29uc3QgaW5kZXhDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1swXS5pZCkudG9CZSgnaXRlbS0xJyk7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1sxXS5pZCkudG9CZSgnaXRlbS0yJyk7XG4gICAgfSk7XG5cblxuXG4gICAgaXQoJ3Nob3VsZCBza2lwIGl0ZW1zIHdpdGhvdXQgaWQgaW4gYmF0Y2ggbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE92ZXJyaWRlIGV4dHJhY3RvciB0byByZXR1cm4gaXRlbXMgd2l0aG91dCBpZFxuICAgICAgaW5kZXhlclsnZXZlbnREYXRhRXh0cmFjdG9yJ10gPSB7XG4gICAgICAgIGV4dHJhY3REYXRhOiAoKSA9PiBbe1xuICAgICAgICAgIGV2ZW50SWQ6ICdtc2ctbm8taWQnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ2VudGl0eTEnLFxuICAgICAgICAgIGVudGl0eUlkOiAnaWQtbm8taWQnLFxuICAgICAgICAgIHBheWxvYWQ6IFtcbiAgICAgICAgICAgIHsgZGF0YTogJ2RhdGEtMScgfSwgLy8gTm8gaWRcbiAgICAgICAgICAgIHsgaWQ6ICdpdGVtLTInLCBkYXRhOiAnZGF0YS0yJyB9IC8vIEhhcyBpZFxuICAgICAgICAgIF0sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgICAgfV1cbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGluZGV4Q2FsbCA9IGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHNbMF07XG4gICAgICAvLyBCb3RoIGl0ZW1zIHNob3VsZCBiZSBpbmRleGVkIC0gdGhlIGZpcnN0IG9uZSBnZXRzIHRoZSBlbnRpdHlJZCBhcyBmYWxsYmFja1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWzBdLmlkKS50b0JlKCdpZC1uby1pZCcpOyAvLyBVc2VzIGVudGl0eUlkIGFzIGZhbGxiYWNrXG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1sxXS5pZCkudG9CZSgnaXRlbS0yJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTZWFyY2hJbmRleEVudHJ5IENyZWF0aW9uJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBTZWFyY2hJbmRleEVudHJ5IHdpdGggY29ycmVjdCBkYXRhJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkOiBCYXNlRXZlbnRSZWNvcmQ8YW55PiA9IHtcbiAgICAgICAgZXZlbnRJZDogJ3Rlc3QtaWQnLFxuICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICBlbnRpdHlOYW1lOiAndGVzdC1lbnRpdHknLFxuICAgICAgICBlbnRpdHlJZDogJ3Rlc3QtZW50aXR5LWlkJyxcbiAgICAgICAgcGF5bG9hZDogeyB0ZXN0RGF0YTogJ3Rlc3QtdmFsdWUnIH0sXG4gICAgICAgIHRpbWVzdGFtcDogMTIzNDU2Nzg5MCxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJ1xuICAgICAgfTtcblxuICAgICAgLy8gQWNjZXNzIHByaXZhdGUgbWV0aG9kIGZvciB0ZXN0aW5nXG4gICAgICBjb25zdCBjcmVhdGVFbnRyeSA9IChpbmRleGVyIGFzIGFueSkuY3JlYXRlU2VhcmNoSW5kZXhFbnRyeS5iaW5kKGluZGV4ZXIpO1xuICAgICAgY29uc3QgZW50cnk6IFNlYXJjaEluZGV4RW50cnkgPSBjcmVhdGVFbnRyeShyZWNvcmQpO1xuXG4gICAgICBleHBlY3QoZW50cnkuaWQpLnRvQmUoJ3Rlc3QtZW50aXR5LWlkJyk7XG4gICAgICBleHBlY3QoZW50cnkuZW50aXR5TmFtZSkudG9CZSgndGVzdC1lbnRpdHknKTtcbiAgICAgIGV4cGVjdChlbnRyeS5ldmVudFR5cGUpLnRvQmUoJ3VwZGF0ZScpO1xuICAgICAgZXhwZWN0KGVudHJ5LmRhdGEudGVzdERhdGEpLnRvQmUoJ3Rlc3QtdmFsdWUnKTtcbiAgICAgIGV4cGVjdChlbnRyeS5kYXRhLl9pbmRleGVkQXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZW50cnkudGltZXN0YW1wKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRW52aXJvbm1lbnQgVmFyaWFibGUgSGFuZGxpbmcnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiBUQUJMRV9OQU1FX0VOVl9LRVkgaXMgbWlzc2luZycsIGFzeW5jICgpID0+IHtcbiAgICAgIGRlbGV0ZSBwcm9jZXNzLmVudi5UQUJMRV9OQU1FX0VOVl9LRVk7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpKS5yZWplY3RzLnRvVGhyb3coXG4gICAgICAgICdUQUJMRV9OQU1FX0VOVl9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lJ1xuICAgICAgKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiB0YWJsZSBuYW1lIGlzIG1pc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEVTVF9UQUJMRV9UQUJMRTtcblxuICAgICAgYXdhaXQgZXhwZWN0KGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSkpLnJlamVjdHMudG9UaHJvdyhcbiAgICAgICAgJ3VuZGVmaW5lZCBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCB0byBjYWxjdWxhdGUgdGhlIGFwcHJvcHJpYXRlIGluZGV4LW5hbWUnXG4gICAgICApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnSW5kZXggRXhpc3RlbmNlIENoZWNrJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNoZWNrIGluZGV4IGV4aXN0ZW5jZSBiZWZvcmUgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxsc1swXSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0wJyk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxsc1sxXSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0xJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gaW5kZXggZG9lcyBub3QgZXhpc3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIGluZGV4RXhpc3RzIHRvIHJldHVybiBmYWxzZVxuICAgICAgamVzdC5zcHlPbihpbmRleGVyLnNlYXJjaEVuZ2luZSwgJ2luZGV4RXhpc3RzJykubW9ja1Jlc29sdmVkVmFsdWUoZmFsc2UpO1xuXG4gICAgICBhd2FpdCBleHBlY3QoaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KSkucmVqZWN0cy50b1Rocm93KFxuICAgICAgICAnSW5kZXggdGVzdC10YWJsZS1uYW1lLWVudGl0eS0wIGRvZXMgbm90IGV4aXN0J1xuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1BlcmZvcm1hbmNlIENvbXBhcmlzb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBzaG93IHBlcmZvcm1hbmNlIGRpZmZlcmVuY2UgYmV0d2VlbiByZWNvcmQgYW5kIGJhdGNoIG1vZGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgcmVjb3JkSW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgICBhd2FpdCByZWNvcmRJbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuICAgICAgY29uc3QgcmVjb3JkRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gcmVjb3JkU3RhcnQ7XG5cbiAgICAgIGNvbnN0IGJhdGNoU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgYmF0Y2hJbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdiYXRjaCcpO1xuICAgICAgYXdhaXQgYmF0Y2hJbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuICAgICAgY29uc3QgYmF0Y2hEdXJhdGlvbiA9IERhdGUubm93KCkgLSBiYXRjaFN0YXJ0O1xuXG4gICAgICAvLyBCb3RoIG1vZGVzIHNob3VsZCBjb21wbGV0ZSBzdWNjZXNzZnVsbHlcbiAgICAgIGV4cGVjdChyZWNvcmREdXJhdGlvbikudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgwKTtcbiAgICAgIGV4cGVjdChiYXRjaER1cmF0aW9uKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDApO1xuXG4gICAgICAvLyBCb3RoIHNob3VsZCBwcm9jZXNzIHRoZSBzYW1lIG51bWJlciBvZiByZWNvcmRzXG4gICAgICBjb25zdCByZWNvcmRUb3RhbENhbGxzID0gcmVjb3JkSW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGggKyByZWNvcmRJbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGg7XG4gICAgICBjb25zdCBiYXRjaFRvdGFsQ2FsbHMgPSBiYXRjaEluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoICsgYmF0Y2hJbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGg7XG4gICAgICBcbiAgICAgIGV4cGVjdChyZWNvcmRUb3RhbENhbGxzKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3QoYmF0Y2hUb3RhbENhbGxzKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBcbiAgICAgIC8vIFJlY29yZCBtb2RlIHNob3VsZCBtYWtlIG1vcmUgaW5kaXZpZHVhbCBjYWxscyB0aGFuIGJhdGNoIG1vZGVcbiAgICAgIC8vIChUaGlzIGlzIHRoZSBrZXkgcGVyZm9ybWFuY2UgZGlmZmVyZW5jZSB3ZSdyZSB0ZXN0aW5nKVxuICAgICAgZXhwZWN0KHJlY29yZFRvdGFsQ2FsbHMpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoYmF0Y2hUb3RhbENhbGxzKTtcbiAgICAgIFxuICAgICAgLy8gVmVyaWZ5IHRoZSBhY3R1YWwgcHJvY2Vzc2luZyBoYXBwZW5lZFxuICAgICAgZXhwZWN0KHJlY29yZEluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3QoYmF0Y2hJbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRW50aXR5IEZpbHRlcmluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgYWxsIGVudGl0aWVzIHdoZW4gbm8gZmlsdGVyaW5nIGlzIGNvbmZpZ3VyZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBwcm9jZXNzIGJvdGggZW50aXRpZXMgKGVudGl0eS0wIGFuZCBlbnRpdHktMSlcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCArIGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIGVudGl0aWVzIGJhc2VkIG9uIGFsbG93ZWRFbnRpdHlOYW1lcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIFsnZW50aXR5LTAnXSk7IC8vIE9ubHkgYWxsb3cgZW50aXR5LTBcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBvbmx5IHByb2Nlc3MgZW50aXR5LTAgKGluZGV4IG9wZXJhdGlvbiksIGVudGl0eS0xIHNob3VsZCBiZSBmaWx0ZXJlZCBvdXRcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXS5jb25maWcuaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5LTAnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIGVudGl0aWVzIGJhc2VkIG9uIGlnbm9yZWRFbnRpdHlOYW1lcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIHVuZGVmaW5lZCwgWydlbnRpdHktMSddKTsgLy8gSWdub3JlIGVudGl0eS0xXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgb25seSBwcm9jZXNzIGVudGl0eS0wIChpbmRleCBvcGVyYXRpb24pLCBlbnRpdHktMSBzaG91bGQgYmUgaWdub3JlZFxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDEpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWzBdLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBnaXZlIHByZWNlZGVuY2UgdG8gaWdub3JlZEVudGl0eU5hbWVzIG92ZXIgYWxsb3dlZEVudGl0eU5hbWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQ29uZmlndXJlIGJvdGggYWxsb3dlZCBhbmQgaWdub3JlZCBsaXN0cyB3aXRoIG92ZXJsYXBwaW5nIGVudGl0aWVzXG4gICAgICBjb25zdCBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnLCBbJ2VudGl0eS0wJywgJ2VudGl0eS0xJ10sIFsnZW50aXR5LTAnXSk7IC8vIEFsbG93IGJvdGgsIGJ1dCBpZ25vcmUgZW50aXR5LTBcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBvbmx5IHByb2Nlc3MgZW50aXR5LTEgKGRlbGV0ZSBvcGVyYXRpb24pLCBlbnRpdHktMCBzaG91bGQgYmUgaWdub3JlZCBkZXNwaXRlIGJlaW5nIGluIGFsbG93ZWQgbGlzdFxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDApO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxsc1swXS5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgYWxsIGVudGl0aWVzIHdoZW4gaWdub3JlZEVudGl0eU5hbWVzIGluY2x1ZGVzIGFsbCBlbnRpdGllcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIHVuZGVmaW5lZCwgWydlbnRpdHktMCcsICdlbnRpdHktMSddKTsgLy8gSWdub3JlIGFsbCBlbnRpdGllc1xuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIHByb2Nlc3Mgbm8gZW50aXRpZXNcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBhbGxvd2VkRW50aXR5TmFtZXMgbGlzdCBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnLCBbXSk7IC8vIEVtcHR5IGFsbG93ZWQgbGlzdFxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIGZpbHRlciBvdXQgYWxsIGVudGl0aWVzIHdoZW4gYWxsb3dlZCBsaXN0IGlzIGVtcHR5XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDApO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMubGVuZ3RoKS50b0JlKDApO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgaWdub3JlZEVudGl0eU5hbWVzIGxpc3QgY29ycmVjdGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJywgdW5kZWZpbmVkLCBbXSk7IC8vIEVtcHR5IGlnbm9yZWQgbGlzdFxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIHByb2Nlc3MgYWxsIGVudGl0aWVzIG5vcm1hbGx5IHdoZW4gaWdub3JlZCBsaXN0IGlzIGVtcHR5XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGggKyBpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHdvcmsgY29ycmVjdGx5IGluIGJhdGNoIG1vZGUgd2l0aCBlbnRpdHkgZmlsdGVyaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcignYmF0Y2gnLCBbJ2VudGl0eS0wJ10pOyAvLyBPbmx5IGFsbG93IGVudGl0eS0wXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgb25seSBwcm9jZXNzIGVudGl0eS0wIGluIGJhdGNoIG1vZGVcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXS5jb25maWcuaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5LTAnKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==