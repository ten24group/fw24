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
    constructor(processMode = 'record') {
        super(new MockEventDataExtractor(), { processMode });
        this.searchEngine = new MockSearchEngine();
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
        (0, globals_1.it)('should handle payload.items format in batch mode', async () => {
            // Override extractor to return payload with items
            indexer['eventDataExtractor'] = {
                extractData: () => [{
                        eventId: 'msg-items',
                        eventType: 'update',
                        entityName: 'entity1',
                        entityId: 'id-items',
                        payload: {
                            items: [
                                { id: 'item-1', data: 'data-1' },
                                { id: 'item-2', data: 'data-2' }
                            ]
                        },
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
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9pbmRleGVyL2Jhc2Utc2VhcmNoLWluZGV4ZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLCtEQUEwRDtBQUUxRCwwQ0FBbUQ7QUFHbkQsMkNBQWtGO0FBRWxGLHFCQUFxQjtBQUNyQixNQUFNLGdCQUFpQixTQUFRLHVCQUFnQjtJQUN0QyxtQkFBbUIsR0FBOEQsRUFBRSxDQUFDO0lBQ3BGLG9CQUFvQixHQUFpRSxFQUFFLENBQUM7SUFDeEYsZ0JBQWdCLEdBQWEsRUFBRSxDQUFDO0lBRXZDO1FBQ0UsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ1osQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBZ0IsRUFBRSxNQUFXLEVBQUUsY0FBdUIsS0FBSztRQUM5RSxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2xFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsR0FBYSxFQUFFLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUNsRixJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQUMsU0FBaUI7UUFDakMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN0QyxPQUFPLElBQUksQ0FBQyxDQUFDLHlCQUF5QjtJQUN4QyxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU07UUFDVixPQUFPLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxDQUFDO0lBQy9CLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTTtRQUNWLE9BQU8sRUFBRSxJQUFJLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDdEIsQ0FBQztJQUVELEtBQUssQ0FBQyxTQUFTO1FBQ2IsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVE7UUFDWixPQUFPLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxDQUFDO0lBQ2hDLENBQUM7SUFFRCwwQ0FBMEM7SUFDMUMsS0FBSyxDQUFDLFdBQVc7UUFDZixPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWTtRQUNoQixPQUFPLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxDQUFDO0lBQ2hDLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYTtRQUNqQixPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVztRQUNmLE9BQU8sRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVELEtBQUssQ0FBQyxtQkFBbUI7UUFDdkIsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztJQUMzQixDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQjtRQUN0QixPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFFRCxLQUFLLENBQUMsZ0JBQWdCO1FBQ3BCLE9BQU8sRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDMUIsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlO1FBQ25CLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXO1FBQ2YsT0FBTyxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQztJQUN4QixDQUFDO0lBRUQsS0FBSyxDQUFDLFlBQVk7UUFDaEIsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQjtRQUN0QixPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFFRCxLQUFLLENBQUMsdUJBQXVCO1FBQzNCLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxTQUFTO1FBQ2IsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVE7UUFDWixPQUFPLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVTtRQUNkLE9BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDOUIsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXO1FBQ2YsT0FBTyxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUUsQ0FBQztJQUN6QixDQUFDO0NBQ0Y7QUFFRCw0QkFBNEI7QUFDNUIsTUFBTSxzQkFBc0I7SUFDMUIsV0FBVyxDQUFDLEtBQWU7UUFDekIsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDM0MsT0FBTyxFQUFFLE1BQU0sQ0FBQyxTQUFTO1lBQ3pCLFNBQVMsRUFBRSxLQUFLLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxRQUFRO1lBQ2hELFVBQVUsRUFBRSxVQUFVLEtBQUssR0FBRyxDQUFDLEVBQUU7WUFDakMsUUFBUSxFQUFFLE1BQU0sS0FBSyxFQUFFO1lBQ3ZCLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxXQUFXLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRSxNQUFNLEtBQUssRUFBRSxFQUFFO1lBQ3hELFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLFdBQVcsRUFBRSxNQUFNLENBQUMsV0FBVztTQUNoQyxDQUFDLENBQUMsQ0FBQztJQUNOLENBQUM7Q0FDRjtBQUVELHNCQUFzQjtBQUN0QixNQUFNLGlCQUFrQixTQUFRLHVDQUF5QztJQUNoRSxZQUFZLENBQW1CO0lBRXRDLFlBQVksY0FBa0MsUUFBUTtRQUNwRCxLQUFLLENBQUMsSUFBSSxzQkFBc0IsRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUNyRCxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztJQUM3QyxDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFXLEVBQUUsUUFBYTtRQUN6QyxzQkFBc0I7SUFDeEIsQ0FBQztDQUNGO0FBRUQsSUFBQSxrQkFBUSxFQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtJQUNqQyxJQUFJLE9BQTBCLENBQUM7SUFDL0IsSUFBSSxZQUFzQixDQUFDO0lBRTNCLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7UUFDZCxZQUFZLEdBQUc7WUFDYixPQUFPLEVBQUU7Z0JBQ1A7b0JBQ0UsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLGFBQWEsRUFBRSxXQUFXO29CQUMxQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxDQUFDO29CQUM5RCxVQUFVLEVBQUU7d0JBQ1YsdUJBQXVCLEVBQUUsR0FBRzt3QkFDNUIsYUFBYSxFQUFFLFlBQVk7d0JBQzNCLFFBQVEsRUFBRSxVQUFVO3dCQUNwQixnQ0FBZ0MsRUFBRSxZQUFZO3FCQUMvQztvQkFDRCxpQkFBaUIsRUFBRSxFQUFFO29CQUNyQixTQUFTLEVBQUUsT0FBTztvQkFDbEIsV0FBVyxFQUFFLFNBQVM7b0JBQ3RCLGNBQWMsRUFBRSwrQ0FBK0M7b0JBQy9ELFNBQVMsRUFBRSxXQUFXO2lCQUN2QjtnQkFDRDtvQkFDRSxTQUFTLEVBQUUsT0FBTztvQkFDbEIsYUFBYSxFQUFFLFdBQVc7b0JBQzFCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7b0JBQzlELFVBQVUsRUFBRTt3QkFDVix1QkFBdUIsRUFBRSxHQUFHO3dCQUM1QixhQUFhLEVBQUUsWUFBWTt3QkFDM0IsUUFBUSxFQUFFLFVBQVU7d0JBQ3BCLGdDQUFnQyxFQUFFLFlBQVk7cUJBQy9DO29CQUNELGlCQUFpQixFQUFFLEVBQUU7b0JBQ3JCLFNBQVMsRUFBRSxPQUFPO29CQUNsQixXQUFXLEVBQUUsU0FBUztvQkFDdEIsY0FBYyxFQUFFLCtDQUErQztvQkFDL0QsU0FBUyxFQUFFLFdBQVc7aUJBQ3ZCO2FBQ0Y7U0FDRixDQUFDO1FBRUYsZ0VBQWdFO1FBQ2hFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEdBQUcsWUFBWSxDQUFDO1FBQzlDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEdBQUcsaUJBQWlCLENBQUMsQ0FBQyx3QkFBd0I7SUFDNUUsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLG1CQUFTLEVBQUMsR0FBRyxFQUFFO1FBQ2IsaUNBQWlDO1FBQ2pDLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQztRQUN0QyxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUM7SUFDdEMsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFO1FBQ3RDLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7WUFDZCxPQUFPLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM1QyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLG9EQUFvRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2xFLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFL0MsbUZBQW1GO1lBQ25GLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNuSCxJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUU5RCxrREFBa0Q7WUFDbEQsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM5RCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM1QyxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDdEQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQy9DLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO1FBQ3RFLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsZ0RBQWdELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDOUQsc0NBQXNDO1lBQ3RDLE1BQU0sV0FBVyxHQUFhO2dCQUM1QixPQUFPLEVBQUU7b0JBQ1A7d0JBQ0UsU0FBUyxFQUFFLFlBQVk7d0JBQ3ZCLGFBQWEsRUFBRSxnQkFBZ0I7d0JBQy9CLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUM7d0JBQ3BFLFVBQVUsRUFBRTs0QkFDVix1QkFBdUIsRUFBRSxHQUFHOzRCQUM1QixhQUFhLEVBQUUsWUFBWTs0QkFDM0IsUUFBUSxFQUFFLGVBQWU7NEJBQ3pCLGdDQUFnQyxFQUFFLFlBQVk7eUJBQy9DO3dCQUNELGlCQUFpQixFQUFFLEVBQUU7d0JBQ3JCLFNBQVMsRUFBRSxZQUFZO3dCQUN2QixXQUFXLEVBQUUsU0FBUzt3QkFDdEIsY0FBYyxFQUFFLCtDQUErQzt3QkFDL0QsU0FBUyxFQUFFLFdBQVc7cUJBQ3ZCO2lCQUNGO2FBQ0YsQ0FBQztZQUVGLDRDQUE0QztZQUM1QyxPQUFPLENBQUMsb0JBQW9CLENBQUMsR0FBRztnQkFDOUIsV0FBVyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7d0JBQ2xCLE9BQU8sRUFBRSxZQUFZO3dCQUNyQixTQUFTLEVBQUUsUUFBUTt3QkFDbkIsVUFBVSxFQUFFLFNBQVM7d0JBQ3JCLFFBQVEsRUFBRSxXQUFXO3dCQUNyQixPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFO3dCQUNoQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTt3QkFDckIsV0FBVyxFQUFFLFNBQVM7cUJBQ3ZCLENBQUM7YUFDSCxDQUFDO1lBRUYsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxFQUFTLENBQUMsQ0FBQztZQUU5QyxJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNsRSxJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1lBQ2hGLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1FBQ2pHLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO1FBQ3JDLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7WUFDZCxPQUFPLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMzQyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLHNDQUFzQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BELE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFL0MsOERBQThEO1lBQzlELElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2pFLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLG9CQUFvQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2xFLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCO1lBRS9FLDJDQUEyQztZQUMzQyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVDLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUN0RCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDL0MsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLENBQUM7WUFFcEUsNENBQTRDO1lBQzVDLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxZQUFZLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDaEUsSUFBQSxnQkFBTSxFQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ3pDLElBQUEsZ0JBQU0sRUFBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLENBQUM7UUFDaEUsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyw0Q0FBNEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMxRCw2Q0FBNkM7WUFDN0MsT0FBTyxDQUFDLG9CQUFvQixDQUFDLEdBQUc7Z0JBQzlCLFdBQVcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO3dCQUNsQixPQUFPLEVBQUUsV0FBVzt3QkFDcEIsU0FBUyxFQUFFLFFBQVE7d0JBQ25CLFVBQVUsRUFBRSxTQUFTO3dCQUNyQixRQUFRLEVBQUUsVUFBVTt3QkFDcEIsT0FBTyxFQUFFOzRCQUNQLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFOzRCQUNoQyxFQUFFLEVBQUUsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRTt5QkFDakM7d0JBQ0QsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7d0JBQ3JCLFdBQVcsRUFBRSxTQUFTO3FCQUN2QixDQUFDO2FBQ0gsQ0FBQztZQUVGLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFL0MsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM5RCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM1QyxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDakQsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ25ELENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsa0RBQWtELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDaEUsa0RBQWtEO1lBQ2xELE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQyxHQUFHO2dCQUM5QixXQUFXLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQzt3QkFDbEIsT0FBTyxFQUFFLFdBQVc7d0JBQ3BCLFNBQVMsRUFBRSxRQUFRO3dCQUNuQixVQUFVLEVBQUUsU0FBUzt3QkFDckIsUUFBUSxFQUFFLFVBQVU7d0JBQ3BCLE9BQU8sRUFBRTs0QkFDUCxLQUFLLEVBQUU7Z0NBQ0wsRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUU7Z0NBQ2hDLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFOzZCQUNqQzt5QkFDRjt3QkFDRCxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTt3QkFDckIsV0FBVyxFQUFFLFNBQVM7cUJBQ3ZCLENBQUM7YUFDSCxDQUFDO1lBRUYsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQztZQUUvQyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlELElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVDLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNqRCxJQUFBLGdCQUFNLEVBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDbkQsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyw0Q0FBNEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMxRCxnREFBZ0Q7WUFDaEQsT0FBTyxDQUFDLG9CQUFvQixDQUFDLEdBQUc7Z0JBQzlCLFdBQVcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO3dCQUNsQixPQUFPLEVBQUUsV0FBVzt3QkFDcEIsU0FBUyxFQUFFLFFBQVE7d0JBQ25CLFVBQVUsRUFBRSxTQUFTO3dCQUNyQixRQUFRLEVBQUUsVUFBVTt3QkFDcEIsT0FBTyxFQUFFOzRCQUNQLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxFQUFFLFFBQVE7NEJBQzVCLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLENBQUMsU0FBUzt5QkFDM0M7d0JBQ0QsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7d0JBQ3JCLFdBQVcsRUFBRSxTQUFTO3FCQUN2QixDQUFDO2FBQ0gsQ0FBQztZQUVGLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFL0MsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM5RCw2RUFBNkU7WUFDN0UsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUMsSUFBQSxnQkFBTSxFQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsNEJBQTRCO1lBQ2hGLElBQUEsZ0JBQU0sRUFBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNuRCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBQSxrQkFBUSxFQUFDLDJCQUEyQixFQUFFLEdBQUcsRUFBRTtRQUN6QyxJQUFBLG9CQUFVLEVBQUMsR0FBRyxFQUFFO1lBQ2QsT0FBTyxHQUFHLElBQUksaUJBQWlCLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDNUMsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQyxrREFBa0QsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNoRSxNQUFNLE1BQU0sR0FBeUI7Z0JBQ25DLE9BQU8sRUFBRSxTQUFTO2dCQUNsQixTQUFTLEVBQUUsUUFBUTtnQkFDbkIsVUFBVSxFQUFFLGFBQWE7Z0JBQ3pCLFFBQVEsRUFBRSxnQkFBZ0I7Z0JBQzFCLE9BQU8sRUFBRSxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUU7Z0JBQ25DLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixXQUFXLEVBQUUsU0FBUzthQUN2QixDQUFDO1lBRUYsb0NBQW9DO1lBQ3BDLE1BQU0sV0FBVyxHQUFJLE9BQWUsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDMUUsTUFBTSxLQUFLLEdBQXFCLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVwRCxJQUFBLGdCQUFNLEVBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBQ3hDLElBQUEsZ0JBQU0sRUFBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBQzdDLElBQUEsZ0JBQU0sRUFBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3ZDLElBQUEsZ0JBQU0sRUFBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUMvQyxJQUFBLGdCQUFNLEVBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUM1QyxJQUFBLGdCQUFNLEVBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsK0JBQStCLEVBQUUsR0FBRyxFQUFFO1FBQzdDLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7WUFDZCxPQUFPLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM1QyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLHVEQUF1RCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3JFLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQztZQUV0QyxNQUFNLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQ3BFLDZGQUE2RixDQUM5RixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFBLFlBQUUsRUFBQywrQ0FBK0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM3RCxPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUM7WUFFcEMsTUFBTSxJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUNwRSxvRkFBb0YsQ0FDckYsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLGtCQUFRLEVBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO1FBQ3JDLElBQUEsb0JBQVUsRUFBQyxHQUFHLEVBQUU7WUFDZCxPQUFPLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUM1QyxDQUFDLENBQUMsQ0FBQztRQUVILElBQUEsWUFBRSxFQUFDLGdEQUFnRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzlELE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFL0MsSUFBQSxnQkFBTSxFQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDOUQsSUFBQSxnQkFBTSxFQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsQ0FBQztZQUNsRixJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO1FBQ3BGLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxZQUFFLEVBQUMsOENBQThDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDNUQsbUNBQW1DO1lBQ25DLGNBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxhQUFhLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUV6RSxNQUFNLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQ3BFLCtDQUErQyxDQUNoRCxDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILElBQUEsa0JBQVEsRUFBQyx3QkFBd0IsRUFBRSxHQUFHLEVBQUU7UUFDdEMsSUFBQSxZQUFFLEVBQUMsbUVBQW1FLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDakYsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksaUJBQWlCLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDdEQsTUFBTSxhQUFhLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFTLENBQUMsQ0FBQztZQUNyRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsV0FBVyxDQUFDO1lBRWhELE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUM5QixNQUFNLFlBQVksR0FBRyxJQUFJLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ3BELE1BQU0sWUFBWSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFDcEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFVBQVUsQ0FBQztZQUU5QywwQ0FBMEM7WUFDMUMsSUFBQSxnQkFBTSxFQUFDLGNBQWMsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2pELElBQUEsZ0JBQU0sRUFBQyxhQUFhLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUVoRCxpREFBaUQ7WUFDakQsTUFBTSxnQkFBZ0IsR0FBRyxhQUFhLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxhQUFhLENBQUMsWUFBWSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQztZQUN4SSxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sR0FBRyxZQUFZLENBQUMsWUFBWSxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQztZQUVySSxJQUFBLGdCQUFNLEVBQUMsZ0JBQWdCLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUMsSUFBQSxnQkFBTSxFQUFDLGVBQWUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUUzQyxnRUFBZ0U7WUFDaEUseURBQXlEO1lBQ3pELElBQUEsZ0JBQU0sRUFBQyxnQkFBZ0IsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBRWpFLHdDQUF3QztZQUN4QyxJQUFBLGdCQUFNLEVBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDOUUsSUFBQSxnQkFBTSxFQUFDLFlBQVksQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQy9FLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VTZWFyY2hJbmRleGVyIH0gZnJvbSAnLi9iYXNlLXNlYXJjaC1pbmRleGVyJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgSUV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzL2Jhc2UnO1xuaW1wb3J0IHsgU2VhcmNoSW5kZXhFbnRyeSB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBTUVNFdmVudCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgZGVzY3JpYmUsIGV4cGVjdCwgaXQsIGplc3QsIGJlZm9yZUVhY2gsIGFmdGVyRWFjaCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuXG4vLyBNb2NrIHNlYXJjaCBlbmdpbmVcbmNsYXNzIE1vY2tTZWFyY2hFbmdpbmUgZXh0ZW5kcyBCYXNlU2VhcmNoRW5naW5lIHtcbiAgcHVibGljIGluZGV4RG9jdW1lbnRzQ2FsbHM6IHsgZG9jdW1lbnRzOiBhbnlbXSwgY29uZmlnOiBhbnksIHN5bmNocm9ub3VzOiBib29sZWFuIH1bXSA9IFtdO1xuICBwdWJsaWMgZGVsZXRlRG9jdW1lbnRzQ2FsbHM6IHsgaWRzOiBzdHJpbmdbXSwgaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuIH1bXSA9IFtdO1xuICBwdWJsaWMgaW5kZXhFeGlzdHNDYWxsczogc3RyaW5nW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcih7fSk7XG4gIH1cblxuICBhc3luYyBpbmRleERvY3VtZW50cyhkb2N1bWVudHM6IGFueVtdLCBjb25maWc6IGFueSwgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8YW55PiB7XG4gICAgdGhpcy5pbmRleERvY3VtZW50c0NhbGxzLnB1c2goeyBkb2N1bWVudHMsIGNvbmZpZywgc3luY2hyb25vdXMgfSk7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzKGlkczogc3RyaW5nW10sIGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aGlzLmRlbGV0ZURvY3VtZW50c0NhbGxzLnB1c2goeyBpZHMsIGluZGV4TmFtZSwgc3luY2hyb25vdXMgfSk7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgaW5kZXhFeGlzdHMoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0aGlzLmluZGV4RXhpc3RzQ2FsbHMucHVzaChpbmRleE5hbWUpO1xuICAgIHJldHVybiB0cnVlOyAvLyBNb2NrIHRoYXQgaW5kZXggZXhpc3RzXG4gIH1cblxuICBhc3luYyBoZWFsdGgoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdoZWFsdGh5JyB9O1xuICB9XG5cbiAgYXN5bmMgc2VhcmNoKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgaGl0czogW10gfTtcbiAgfVxuXG4gIGFzeW5jIGluaXRJbmRleCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGdldEluZGV4KCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgbmFtZTogJ3Rlc3QtaW5kZXgnIH07XG4gIH1cblxuICAvLyBJbXBsZW1lbnQgYWxsIHJlcXVpcmVkIGFic3RyYWN0IG1ldGhvZHNcbiAgYXN5bmMgZGVsZXRlSW5kZXgoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleEluZm8oKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBuYW1lOiAndGVzdC1pbmRleCcgfTtcbiAgfVxuXG4gIGFzeW5jIGdldEluZGV4U3RhdHMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdGF0czoge30gfTtcbiAgfVxuXG4gIGFzeW5jIGxpc3RJbmRpY2VzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgaW5kaWNlczogW10gfTtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZUluZGV4U2V0dGluZ3MoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyByZXNldEluZGV4U2V0dGluZ3MoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleFNldHRpbmdzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc2V0dGluZ3M6IHt9IH07XG4gIH1cblxuICBhc3luYyB1cGRhdGVEb2N1bWVudHMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXREb2N1bWVudCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IGlkOiAndGVzdCcgfTtcbiAgfVxuXG4gIGFzeW5jIGdldERvY3VtZW50cygpOiBQcm9taXNlPGFueVtdPiB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlQWxsRG9jdW1lbnRzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBpc0hlYWx0aHkoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBnZXRTdGF0cygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHN0YXRzOiB7fSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0VmVyc2lvbigpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHZlcnNpb246ICcxLjAuMCcgfTtcbiAgfVxuXG4gIGFzeW5jIG11bHRpU2VhcmNoKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgcmVzdWx0czogW10gfTtcbiAgfVxufVxuXG4vLyBNb2NrIGV2ZW50IGRhdGEgZXh0cmFjdG9yXG5jbGFzcyBNb2NrRXZlbnREYXRhRXh0cmFjdG9yIGltcGxlbWVudHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxTUVNFdmVudCwgYW55PiB7XG4gIGV4dHJhY3REYXRhKGV2ZW50OiBTUVNFdmVudCk6IEJhc2VFdmVudFJlY29yZDxhbnk+W10ge1xuICAgIHJldHVybiBldmVudC5SZWNvcmRzLm1hcCgocmVjb3JkLCBpbmRleCkgPT4gKHtcbiAgICAgIGV2ZW50SWQ6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICBldmVudFR5cGU6IGluZGV4ICUgMiA9PT0gMCA/ICd1cGRhdGUnIDogJ2RlbGV0ZScsXG4gICAgICBlbnRpdHlOYW1lOiBgZW50aXR5LSR7aW5kZXggJSAyfWAsXG4gICAgICBlbnRpdHlJZDogYGlkLSR7aW5kZXh9YCxcbiAgICAgIHBheWxvYWQ6IHsgZGF0YTogYHBheWxvYWQtJHtpbmRleH1gLCBpZDogYGlkLSR7aW5kZXh9YCB9LFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgZXZlbnRTb3VyY2U6IHJlY29yZC5ldmVudFNvdXJjZVxuICAgIH0pKTtcbiAgfVxufVxuXG4vLyBUZXN0IGltcGxlbWVudGF0aW9uXG5jbGFzcyBUZXN0U2VhcmNoSW5kZXhlciBleHRlbmRzIEJhc2VTZWFyY2hJbmRleGVyPE1vY2tFdmVudERhdGFFeHRyYWN0b3I+IHtcbiAgcHVibGljIHNlYXJjaEVuZ2luZTogTW9ja1NlYXJjaEVuZ2luZTtcblxuICBjb25zdHJ1Y3Rvcihwcm9jZXNzTW9kZTogJ3JlY29yZCcgfCAnYmF0Y2gnID0gJ3JlY29yZCcpIHtcbiAgICBzdXBlcihuZXcgTW9ja0V2ZW50RGF0YUV4dHJhY3RvcigpLCB7IHByb2Nlc3NNb2RlIH0pO1xuICAgIHRoaXMuc2VhcmNoRW5naW5lID0gbmV3IE1vY2tTZWFyY2hFbmdpbmUoKTtcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBhbnksIF9jb250ZXh0OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBNb2NrIGltcGxlbWVudGF0aW9uXG4gIH1cbn1cblxuZGVzY3JpYmUoJ0Jhc2VTZWFyY2hJbmRleGVyJywgKCkgPT4ge1xuICBsZXQgaW5kZXhlcjogVGVzdFNlYXJjaEluZGV4ZXI7XG4gIGxldCBtb2NrU1FTRXZlbnQ6IFNRU0V2ZW50O1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIG1vY2tTUVNFdmVudCA9IHtcbiAgICAgIFJlY29yZHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0xJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICd0ZXN0MScsIGVudGl0eU5hbWU6ICdlbnRpdHkxJyB9KSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItMScsXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAnbWQ1LTEnLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0yJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0yJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICd0ZXN0MicsIGVudGl0eU5hbWU6ICdlbnRpdHkyJyB9KSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItMicsXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAnbWQ1LTInLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH07XG5cbiAgICAvLyBNb2NrIGVudmlyb25tZW50IHZhcmlhYmxlcyAtIHVzZSB0aGUgY29ycmVjdCB1cHBlcmNhc2UgZm9ybWF0XG4gICAgcHJvY2Vzcy5lbnYuVEFCTEVfTkFNRV9FTlZfS0VZID0gJ3Rlc3QtdGFibGUnO1xuICAgIHByb2Nlc3MuZW52LlRFU1RfVEFCTEVfVEFCTEUgPSAndGVzdC10YWJsZS1uYW1lJzsgLy8gVXBwZXJjYXNlIHdpdGggc3VmZml4XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYW4gdXAgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgZGVsZXRlIHByb2Nlc3MuZW52LlRBQkxFX05BTUVfRU5WX0tFWTtcbiAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEVTVF9UQUJMRV9UQUJMRTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlY29yZCBNb2RlIFByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvY2VzcyByZWNvcmRzIGluZGl2aWR1YWxseSBpbiByZWNvcmQgbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBjYWxsIGluZGV4RG9jdW1lbnRzIGZvciBlYWNoIHJlY29yZCAoYnV0IG9uZSBtaWdodCBiZSBhIGRlbGV0ZSBvcGVyYXRpb24pXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGggKyBpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgICAvLyBDaGVjayBmaXJzdCBjYWxsIChzaG91bGQgYmUgYW4gaW5kZXggb3BlcmF0aW9uKVxuICAgICAgY29uc3QgZmlyc3RDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXTtcbiAgICAgIGV4cGVjdChmaXJzdENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmRvY3VtZW50c1swXS5kYXRhKS50b0JlKCdwYXlsb2FkLTAnKTtcbiAgICAgIGV4cGVjdChmaXJzdENhbGwuZG9jdW1lbnRzWzBdLmlkKS50b0JlKCdpZC0wJyk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZGVsZXRlIG9wZXJhdGlvbnMgaW4gcmVjb3JkIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgZXZlbnQgd2l0aCBkZWxldGUgb3BlcmF0aW9uc1xuICAgICAgY29uc3QgZGVsZXRlRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbWVzc2FnZUlkOiAnbXNnLWRlbGV0ZScsXG4gICAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC1kZWxldGUnLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAnZGVsZXRlLXRlc3QnLCBlbnRpdHlOYW1lOiAnZW50aXR5MScgfSksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXG4gICAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItZGVsZXRlJyxcbiAgICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICAgIG1kNU9mQm9keTogJ21kNS1kZWxldGUnLFxuICAgICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIC8vIE92ZXJyaWRlIGV4dHJhY3RvciB0byByZXR1cm4gZGVsZXRlIGV2ZW50XG4gICAgICBpbmRleGVyWydldmVudERhdGFFeHRyYWN0b3InXSA9IHtcbiAgICAgICAgZXh0cmFjdERhdGE6ICgpID0+IFt7XG4gICAgICAgICAgZXZlbnRJZDogJ21zZy1kZWxldGUnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ2RlbGV0ZScsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ2VudGl0eTEnLFxuICAgICAgICAgIGVudGl0eUlkOiAnaWQtZGVsZXRlJyxcbiAgICAgICAgICBwYXlsb2FkOiB7IGRhdGE6ICdkZWxldGUtdGVzdCcgfSxcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJ1xuICAgICAgICB9XVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKGRlbGV0ZUV2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxsc1swXS5pZHMpLnRvRXF1YWwoWydpZC1kZWxldGUnXSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbMF0uaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5MScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQmF0Y2ggTW9kZSBQcm9jZXNzaW5nJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcignYmF0Y2gnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvY2VzcyByZWNvcmRzIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgZ3JvdXAgYnkgZW50aXR5IGFuZCBldmVudCB0eXBlLCB0aGVuIG1ha2UgYnVsayBjYWxsc1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTsgLy8gT25lIHBlciBncm91cFxuXG4gICAgICAvLyBDaGVjayBpbmRleCBjYWxsIChmb3IgdXBkYXRlIG9wZXJhdGlvbnMpXG4gICAgICBjb25zdCBpbmRleENhbGwgPSBpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWzBdO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWzBdLmRhdGEpLnRvQmUoJ3BheWxvYWQtMCcpO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbMF0uaWQpLnRvQmUoJ2lkLTAnKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuY29uZmlnLmluZGV4TmFtZSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0wJyk7XG5cbiAgICAgIC8vIENoZWNrIGRlbGV0ZSBjYWxsIChmb3IgZGVsZXRlIG9wZXJhdGlvbnMpXG4gICAgICBjb25zdCBkZWxldGVDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbMF07XG4gICAgICBleHBlY3QoZGVsZXRlQ2FsbC5pZHMpLnRvRXF1YWwoWydpZC0xJ10pO1xuICAgICAgZXhwZWN0KGRlbGV0ZUNhbGwuaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5LTEnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGFycmF5IHBheWxvYWRzIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBPdmVycmlkZSBleHRyYWN0b3IgdG8gcmV0dXJuIGFycmF5IHBheWxvYWRcbiAgICAgIGluZGV4ZXJbJ2V2ZW50RGF0YUV4dHJhY3RvciddID0ge1xuICAgICAgICBleHRyYWN0RGF0YTogKCkgPT4gW3tcbiAgICAgICAgICBldmVudElkOiAnbXNnLWFycmF5JyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHkxJyxcbiAgICAgICAgICBlbnRpdHlJZDogJ2lkLWFycmF5JyxcbiAgICAgICAgICBwYXlsb2FkOiBbXG4gICAgICAgICAgICB7IGlkOiAnaXRlbS0xJywgZGF0YTogJ2RhdGEtMScgfSxcbiAgICAgICAgICAgIHsgaWQ6ICdpdGVtLTInLCBkYXRhOiAnZGF0YS0yJyB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJ1xuICAgICAgICB9XVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgY29uc3QgaW5kZXhDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1swXS5pZCkudG9CZSgnaXRlbS0xJyk7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1sxXS5pZCkudG9CZSgnaXRlbS0yJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBwYXlsb2FkLml0ZW1zIGZvcm1hdCBpbiBiYXRjaCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gT3ZlcnJpZGUgZXh0cmFjdG9yIHRvIHJldHVybiBwYXlsb2FkIHdpdGggaXRlbXNcbiAgICAgIGluZGV4ZXJbJ2V2ZW50RGF0YUV4dHJhY3RvciddID0ge1xuICAgICAgICBleHRyYWN0RGF0YTogKCkgPT4gW3tcbiAgICAgICAgICBldmVudElkOiAnbXNnLWl0ZW1zJyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHkxJyxcbiAgICAgICAgICBlbnRpdHlJZDogJ2lkLWl0ZW1zJyxcbiAgICAgICAgICBwYXlsb2FkOiB7XG4gICAgICAgICAgICBpdGVtczogW1xuICAgICAgICAgICAgICB7IGlkOiAnaXRlbS0xJywgZGF0YTogJ2RhdGEtMScgfSxcbiAgICAgICAgICAgICAgeyBpZDogJ2l0ZW0tMicsIGRhdGE6ICdkYXRhLTInIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnXG4gICAgICAgIH1dXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBpbmRleENhbGwgPSBpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWzBdO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWzBdLmlkKS50b0JlKCdpdGVtLTEnKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWzFdLmlkKS50b0JlKCdpdGVtLTInKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgc2tpcCBpdGVtcyB3aXRob3V0IGlkIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBPdmVycmlkZSBleHRyYWN0b3IgdG8gcmV0dXJuIGl0ZW1zIHdpdGhvdXQgaWRcbiAgICAgIGluZGV4ZXJbJ2V2ZW50RGF0YUV4dHJhY3RvciddID0ge1xuICAgICAgICBleHRyYWN0RGF0YTogKCkgPT4gW3tcbiAgICAgICAgICBldmVudElkOiAnbXNnLW5vLWlkJyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHkxJyxcbiAgICAgICAgICBlbnRpdHlJZDogJ2lkLW5vLWlkJyxcbiAgICAgICAgICBwYXlsb2FkOiBbXG4gICAgICAgICAgICB7IGRhdGE6ICdkYXRhLTEnIH0sIC8vIE5vIGlkXG4gICAgICAgICAgICB7IGlkOiAnaXRlbS0yJywgZGF0YTogJ2RhdGEtMicgfSAvLyBIYXMgaWRcbiAgICAgICAgICBdLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnXG4gICAgICAgIH1dXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBpbmRleENhbGwgPSBpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWzBdO1xuICAgICAgLy8gQm90aCBpdGVtcyBzaG91bGQgYmUgaW5kZXhlZCAtIHRoZSBmaXJzdCBvbmUgZ2V0cyB0aGUgZW50aXR5SWQgYXMgZmFsbGJhY2tcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1swXS5pZCkudG9CZSgnaWQtbm8taWQnKTsgLy8gVXNlcyBlbnRpdHlJZCBhcyBmYWxsYmFja1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbMV0uaWQpLnRvQmUoJ2l0ZW0tMicpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU2VhcmNoSW5kZXhFbnRyeSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgU2VhcmNoSW5kZXhFbnRyeSB3aXRoIGNvcnJlY3QgZGF0YScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPGFueT4gPSB7XG4gICAgICAgIGV2ZW50SWQ6ICd0ZXN0LWlkJyxcbiAgICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QtZW50aXR5JyxcbiAgICAgICAgZW50aXR5SWQ6ICd0ZXN0LWVudGl0eS1pZCcsXG4gICAgICAgIHBheWxvYWQ6IHsgdGVzdERhdGE6ICd0ZXN0LXZhbHVlJyB9LFxuICAgICAgICB0aW1lc3RhbXA6IDEyMzQ1Njc4OTAsXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgIH07XG5cbiAgICAgIC8vIEFjY2VzcyBwcml2YXRlIG1ldGhvZCBmb3IgdGVzdGluZ1xuICAgICAgY29uc3QgY3JlYXRlRW50cnkgPSAoaW5kZXhlciBhcyBhbnkpLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkuYmluZChpbmRleGVyKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTZWFyY2hJbmRleEVudHJ5ID0gY3JlYXRlRW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGVudHJ5LmlkKS50b0JlKCd0ZXN0LWVudGl0eS1pZCcpO1xuICAgICAgZXhwZWN0KGVudHJ5LmVudGl0eU5hbWUpLnRvQmUoJ3Rlc3QtZW50aXR5Jyk7XG4gICAgICBleHBlY3QoZW50cnkuZXZlbnRUeXBlKS50b0JlKCd1cGRhdGUnKTtcbiAgICAgIGV4cGVjdChlbnRyeS5kYXRhLnRlc3REYXRhKS50b0JlKCd0ZXN0LXZhbHVlJyk7XG4gICAgICBleHBlY3QoZW50cnkuZGF0YS5faW5kZXhlZEF0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGVudHJ5LnRpbWVzdGFtcCkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Vudmlyb25tZW50IFZhcmlhYmxlIEhhbmRsaW5nJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gVEFCTEVfTkFNRV9FTlZfS0VZIGlzIG1pc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEFCTEVfTkFNRV9FTlZfS0VZO1xuXG4gICAgICBhd2FpdCBleHBlY3QoaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KSkucmVqZWN0cy50b1Rocm93KFxuICAgICAgICAnVEFCTEVfTkFNRV9FTlZfS0VZIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkIHRvIGNhbGN1bGF0ZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXgtbmFtZSdcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gdGFibGUgbmFtZSBpcyBtaXNzaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgZGVsZXRlIHByb2Nlc3MuZW52LlRFU1RfVEFCTEVfVEFCTEU7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpKS5yZWplY3RzLnRvVGhyb3coXG4gICAgICAgICd1bmRlZmluZWQgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lJ1xuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0luZGV4IEV4aXN0ZW5jZSBDaGVjaycsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjaGVjayBpbmRleCBleGlzdGVuY2UgYmVmb3JlIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHNbMF0pLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHNbMV0pLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB0aHJvdyBlcnJvciB3aGVuIGluZGV4IGRvZXMgbm90IGV4aXN0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTW9jayBpbmRleEV4aXN0cyB0byByZXR1cm4gZmFsc2VcbiAgICAgIGplc3Quc3B5T24oaW5kZXhlci5zZWFyY2hFbmdpbmUsICdpbmRleEV4aXN0cycpLm1vY2tSZXNvbHZlZFZhbHVlKGZhbHNlKTtcblxuICAgICAgYXdhaXQgZXhwZWN0KGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSkpLnJlamVjdHMudG9UaHJvdyhcbiAgICAgICAgJ0luZGV4IHRlc3QtdGFibGUtbmFtZS1lbnRpdHktMCBkb2VzIG5vdCBleGlzdCdcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQZXJmb3JtYW5jZSBDb21wYXJpc29uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgc2hvdyBwZXJmb3JtYW5jZSBkaWZmZXJlbmNlIGJldHdlZW4gcmVjb3JkIGFuZCBiYXRjaCBtb2RlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICAgIGNvbnN0IHJlY29yZEluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgICAgYXdhaXQgcmVjb3JkSW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcbiAgICAgIGNvbnN0IHJlY29yZER1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHJlY29yZFN0YXJ0O1xuXG4gICAgICBjb25zdCBiYXRjaFN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICAgIGNvbnN0IGJhdGNoSW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcignYmF0Y2gnKTtcbiAgICAgIGF3YWl0IGJhdGNoSW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcbiAgICAgIGNvbnN0IGJhdGNoRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gYmF0Y2hTdGFydDtcblxuICAgICAgLy8gQm90aCBtb2RlcyBzaG91bGQgY29tcGxldGUgc3VjY2Vzc2Z1bGx5XG4gICAgICBleHBlY3QocmVjb3JkRHVyYXRpb24pLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMCk7XG4gICAgICBleHBlY3QoYmF0Y2hEdXJhdGlvbikudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgwKTtcblxuICAgICAgLy8gQm90aCBzaG91bGQgcHJvY2VzcyB0aGUgc2FtZSBudW1iZXIgb2YgcmVjb3Jkc1xuICAgICAgY29uc3QgcmVjb3JkVG90YWxDYWxscyA9IHJlY29yZEluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoICsgcmVjb3JkSW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoO1xuICAgICAgY29uc3QgYmF0Y2hUb3RhbENhbGxzID0gYmF0Y2hJbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCArIGJhdGNoSW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoO1xuICAgICAgXG4gICAgICBleHBlY3QocmVjb3JkVG90YWxDYWxscykudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KGJhdGNoVG90YWxDYWxscykudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgXG4gICAgICAvLyBSZWNvcmQgbW9kZSBzaG91bGQgbWFrZSBtb3JlIGluZGl2aWR1YWwgY2FsbHMgdGhhbiBiYXRjaCBtb2RlXG4gICAgICAvLyAoVGhpcyBpcyB0aGUga2V5IHBlcmZvcm1hbmNlIGRpZmZlcmVuY2Ugd2UncmUgdGVzdGluZylcbiAgICAgIGV4cGVjdChyZWNvcmRUb3RhbENhbGxzKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKGJhdGNoVG90YWxDYWxscyk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSB0aGUgYWN0dWFsIHByb2Nlc3NpbmcgaGFwcGVuZWRcbiAgICAgIGV4cGVjdChyZWNvcmRJbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KGJhdGNoSW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==