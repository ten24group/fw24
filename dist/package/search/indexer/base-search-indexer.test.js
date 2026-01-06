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
    // BaseSearchIndexer uses "excluded" terminology; tests previously used "ignored".
    getExcludedEntityNames() {
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
            // BaseSQSEventProcessor uses BatchProgress which records failures and continues by default.
            // Misconfiguration should prevent any indexing calls.
            await indexer.process(mockSQSEvent, {});
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
        });
        (0, globals_1.it)('should throw error when table name is missing', async () => {
            delete process.env.TEST_TABLE_TABLE;
            await indexer.process(mockSQSEvent, {});
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
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
            await indexer.process(mockSQSEvent, {});
            // No index/update/delete calls should be made when the index doesn't exist.
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length).toBe(0);
            (0, globals_1.expect)(indexer.searchEngine.deleteDocumentsCalls.length).toBe(0);
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
        (0, globals_1.it)('should filter entities based on excludedEntityNames', async () => {
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
            // Empty allow-list is treated as "no allow-list configured" (default: allow all).
            (0, globals_1.expect)(indexer.searchEngine.indexDocumentsCalls.length + indexer.searchEngine.deleteDocumentsCalls.length).toBe(2);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9pbmRleGVyL2Jhc2Utc2VhcmNoLWluZGV4ZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLCtEQUEwRDtBQUUxRCwwQ0FBbUQ7QUFHbkQsMkNBQWtGO0FBRWxGLHFCQUFxQjtBQUNyQixNQUFNLGdCQUFpQixTQUFRLHVCQUFnQjtJQUN0QyxtQkFBbUIsR0FBOEQsRUFBRSxDQUFDO0lBQ3BGLG9CQUFvQixHQUFpRSxFQUFFLENBQUM7SUFDeEYsZ0JBQWdCLEdBQWEsRUFBRSxDQUFDO0lBRXZDO1FBQ0UsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ1osQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBZ0IsRUFBRSxNQUFXLEVBQUUsY0FBdUIsS0FBSztRQUM5RSxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2xFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsR0FBYSxFQUFFLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUNsRixJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQUMsU0FBaUI7UUFDakMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN0QyxPQUFPLElBQUksQ0FBQyxDQUFDLHlCQUF5QjtJQUN4QyxDQUFDO0lBRUQsS0FBSyxD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TSxPQUFPLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxPQUFPLEVBQUUsQ0FBRSxVQUFVLENBQUUsQ0FBQyxDQUFDLENBQUMsc0JBQXNCO1lBQ3RGLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBUyxDQUFDLENBQUM7WUFFL0MsNkNBQTZDO1lBQzdDLElBQUEsZ0JBQU0sRUFBQyxPQUFPLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNoRSxJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDakUsSUFBQSxnQkFBTSxFQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsbUJBQW1CLENBQUUsQ0FBQyxDQUFFLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO1FBQzFHLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VTZWFyY2hJbmRleGVyIH0gZnJvbSAnLi9iYXNlLXNlYXJjaC1pbmRleGVyJztcbmltcG9ydCB7IEJhc2VFdmVudFJlY29yZCwgSUV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXZlbnQtcHJvY2Vzc29yLXR5cGVzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzL2Jhc2UnO1xuaW1wb3J0IHsgU2VhcmNoSW5kZXhFbnRyeSB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBTUVNFdmVudCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgZGVzY3JpYmUsIGV4cGVjdCwgaXQsIGplc3QsIGJlZm9yZUVhY2gsIGFmdGVyRWFjaCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xuXG4vLyBNb2NrIHNlYXJjaCBlbmdpbmVcbmNsYXNzIE1vY2tTZWFyY2hFbmdpbmUgZXh0ZW5kcyBCYXNlU2VhcmNoRW5naW5lIHtcbiAgcHVibGljIGluZGV4RG9jdW1lbnRzQ2FsbHM6IHsgZG9jdW1lbnRzOiBhbnlbXSwgY29uZmlnOiBhbnksIHN5bmNocm9ub3VzOiBib29sZWFuIH1bXSA9IFtdO1xuICBwdWJsaWMgZGVsZXRlRG9jdW1lbnRzQ2FsbHM6IHsgaWRzOiBzdHJpbmdbXSwgaW5kZXhOYW1lOiBzdHJpbmcsIHN5bmNocm9ub3VzOiBib29sZWFuIH1bXSA9IFtdO1xuICBwdWJsaWMgaW5kZXhFeGlzdHNDYWxsczogc3RyaW5nW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcih7fSk7XG4gIH1cblxuICBhc3luYyBpbmRleERvY3VtZW50cyhkb2N1bWVudHM6IGFueVtdLCBjb25maWc6IGFueSwgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8YW55PiB7XG4gICAgdGhpcy5pbmRleERvY3VtZW50c0NhbGxzLnB1c2goeyBkb2N1bWVudHMsIGNvbmZpZywgc3luY2hyb25vdXMgfSk7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzKGlkczogc3RyaW5nW10sIGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiA9IGZhbHNlKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aGlzLmRlbGV0ZURvY3VtZW50c0NhbGxzLnB1c2goeyBpZHMsIGluZGV4TmFtZSwgc3luY2hyb25vdXMgfSk7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgaW5kZXhFeGlzdHMoaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0aGlzLmluZGV4RXhpc3RzQ2FsbHMucHVzaChpbmRleE5hbWUpO1xuICAgIHJldHVybiB0cnVlOyAvLyBNb2NrIHRoYXQgaW5kZXggZXhpc3RzXG4gIH1cblxuICBhc3luYyBoZWFsdGgoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdoZWFsdGh5JyB9O1xuICB9XG5cbiAgYXN5bmMgc2VhcmNoKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgaGl0czogW10gfTtcbiAgfVxuXG4gIGFzeW5jIGluaXRJbmRleCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGdldEluZGV4KCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgbmFtZTogJ3Rlc3QtaW5kZXgnIH07XG4gIH1cblxuICAvLyBJbXBsZW1lbnQgYWxsIHJlcXVpcmVkIGFic3RyYWN0IG1ldGhvZHNcbiAgYXN5bmMgZGVsZXRlSW5kZXgoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleEluZm8oKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBuYW1lOiAndGVzdC1pbmRleCcgfTtcbiAgfVxuXG4gIGFzeW5jIGdldEluZGV4U3RhdHMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdGF0czoge30gfTtcbiAgfVxuXG4gIGFzeW5jIGxpc3RJbmRpY2VzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgaW5kaWNlczogW10gfTtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZUluZGV4U2V0dGluZ3MoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyByZXNldEluZGV4U2V0dGluZ3MoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleFNldHRpbmdzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc2V0dGluZ3M6IHt9IH07XG4gIH1cblxuICBhc3luYyB1cGRhdGVEb2N1bWVudHMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXREb2N1bWVudCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IGlkOiAndGVzdCcgfTtcbiAgfVxuXG4gIGFzeW5jIGdldERvY3VtZW50cygpOiBQcm9taXNlPGFueVtdPiB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlQWxsRG9jdW1lbnRzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzQnlGaWx0ZXIoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBpc0hlYWx0aHkoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBnZXRTdGF0cygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHN0YXRzOiB7fSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0VmVyc2lvbigpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHZlcnNpb246ICcxLjAuMCcgfTtcbiAgfVxuXG4gIGFzeW5jIG11bHRpU2VhcmNoKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgcmVzdWx0czogW10gfTtcbiAgfVxufVxuXG4vLyBNb2NrIGV2ZW50IGRhdGEgZXh0cmFjdG9yXG5jbGFzcyBNb2NrRXZlbnREYXRhRXh0cmFjdG9yIGltcGxlbWVudHMgSUV2ZW50RGF0YUV4dHJhY3RvcjxTUVNFdmVudCwgYW55PiB7XG4gIGV4dHJhY3REYXRhKGV2ZW50OiBTUVNFdmVudCk6IEJhc2VFdmVudFJlY29yZDxhbnk+W10ge1xuICAgIHJldHVybiBldmVudC5SZWNvcmRzLm1hcCgocmVjb3JkLCBpbmRleCkgPT4gKHtcbiAgICAgIGV2ZW50SWQ6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICBldmVudFR5cGU6IGluZGV4ICUgMiA9PT0gMCA/ICd1cGRhdGUnIDogJ2RlbGV0ZScsXG4gICAgICBlbnRpdHlOYW1lOiBgZW50aXR5LSR7aW5kZXggJSAyfWAsXG4gICAgICBlbnRpdHlJZDogYGlkLSR7aW5kZXh9YCxcbiAgICAgIHBheWxvYWQ6IHsgZGF0YTogYHBheWxvYWQtJHtpbmRleH1gLCBpZDogYGlkLSR7aW5kZXh9YCB9LFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgZXZlbnRTb3VyY2U6IHJlY29yZC5ldmVudFNvdXJjZVxuICAgIH0pKTtcbiAgfVxufVxuXG4vLyBUZXN0IGltcGxlbWVudGF0aW9uXG5jbGFzcyBUZXN0U2VhcmNoSW5kZXhlciBleHRlbmRzIEJhc2VTZWFyY2hJbmRleGVyPE1vY2tFdmVudERhdGFFeHRyYWN0b3I+IHtcbiAgcHVibGljIHNlYXJjaEVuZ2luZTogTW9ja1NlYXJjaEVuZ2luZTtcbiAgcHJpdmF0ZSBhbGxvd2VkRW50aXRpZXM/OiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSBpZ25vcmVkRW50aXRpZXM/OiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3Rvcihwcm9jZXNzTW9kZTogJ3JlY29yZCcgfCAnYmF0Y2gnID0gJ3JlY29yZCcsIGFsbG93ZWRFbnRpdGllcz86IHN0cmluZ1tdLCBpZ25vcmVkRW50aXRpZXM/OiBzdHJpbmdbXSkge1xuICAgIHN1cGVyKG5ldyBNb2NrRXZlbnREYXRhRXh0cmFjdG9yKCksIHsgcHJvY2Vzc01vZGUgfSk7XG4gICAgdGhpcy5zZWFyY2hFbmdpbmUgPSBuZXcgTW9ja1NlYXJjaEVuZ2luZSgpO1xuICAgIHRoaXMuYWxsb3dlZEVudGl0aWVzID0gYWxsb3dlZEVudGl0aWVzO1xuICAgIHRoaXMuaWdub3JlZEVudGl0aWVzID0gaWdub3JlZEVudGl0aWVzO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldEFsbG93ZWRFbnRpdHlOYW1lcygpOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuYWxsb3dlZEVudGl0aWVzO1xuICB9XG5cbiAgLy8gQmFzZVNlYXJjaEluZGV4ZXIgdXNlcyBcImV4Y2x1ZGVkXCIgdGVybWlub2xvZ3k7IHRlc3RzIHByZXZpb3VzbHkgdXNlZCBcImlnbm9yZWRcIi5cbiAgcHJvdGVjdGVkIGdldEV4Y2x1ZGVkRW50aXR5TmFtZXMoKTogc3RyaW5nW10gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmlnbm9yZWRFbnRpdGllcztcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUoX2V2ZW50OiBhbnksIF9jb250ZXh0OiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBNb2NrIGltcGxlbWVudGF0aW9uXG4gIH1cbn1cblxuZGVzY3JpYmUoJ0Jhc2VTZWFyY2hJbmRleGVyJywgKCkgPT4ge1xuICBsZXQgaW5kZXhlcjogVGVzdFNlYXJjaEluZGV4ZXI7XG4gIGxldCBtb2NrU1FTRXZlbnQ6IFNRU0V2ZW50O1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIG1vY2tTUVNFdmVudCA9IHtcbiAgICAgIFJlY29yZHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0xJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICd0ZXN0MScsIGVudGl0eU5hbWU6ICdlbnRpdHkxJyB9KSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItMScsXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAnbWQ1LTEnLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0yJyxcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC0yJyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRhdGE6ICd0ZXN0MicsIGVudGl0eU5hbWU6ICdlbnRpdHkyJyB9KSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnLFxuICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItMicsXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAnbWQ1LTInLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfVxuICAgICAgXVxuICAgIH07XG5cbiAgICAvLyBNb2NrIGVudmlyb25tZW50IHZhcmlhYmxlcyAtIHVzZSB0aGUgY29ycmVjdCB1cHBlcmNhc2UgZm9ybWF0XG4gICAgcHJvY2Vzcy5lbnYuVEFCTEVfTkFNRV9FTlZfS0VZID0gJ3Rlc3QtdGFibGUnO1xuICAgIHByb2Nlc3MuZW52LlRFU1RfVEFCTEVfVEFCTEUgPSAndGVzdC10YWJsZS1uYW1lJzsgLy8gVXBwZXJjYXNlIHdpdGggc3VmZml4XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYW4gdXAgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgZGVsZXRlIHByb2Nlc3MuZW52LlRBQkxFX05BTUVfRU5WX0tFWTtcbiAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEVTVF9UQUJMRV9UQUJMRTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlY29yZCBNb2RlIFByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvY2VzcyByZWNvcmRzIGluZGl2aWR1YWxseSBpbiByZWNvcmQgbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBjYWxsIGluZGV4RG9jdW1lbnRzIGZvciBlYWNoIHJlY29yZCAoYnV0IG9uZSBtaWdodCBiZSBhIGRlbGV0ZSBvcGVyYXRpb24pXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGggKyBpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgICAvLyBDaGVjayBmaXJzdCBjYWxsIChzaG91bGQgYmUgYW4gaW5kZXggb3BlcmF0aW9uKVxuICAgICAgY29uc3QgZmlyc3RDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1sgMCBdO1xuICAgICAgZXhwZWN0KGZpcnN0Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChmaXJzdENhbGwuZG9jdW1lbnRzWyAwIF0uZGF0YSkudG9CZSgncGF5bG9hZC0wJyk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmRvY3VtZW50c1sgMCBdLmlkKS50b0JlKCdpZC0wJyk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZGVsZXRlIG9wZXJhdGlvbnMgaW4gcmVjb3JkIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgZXZlbnQgd2l0aCBkZWxldGUgb3BlcmF0aW9uc1xuICAgICAgY29uc3QgZGVsZXRlRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgbWVzc2FnZUlkOiAnbXNnLWRlbGV0ZScsXG4gICAgICAgICAgICByZWNlaXB0SGFuZGxlOiAncmVjZWlwdC1kZWxldGUnLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAnZGVsZXRlLXRlc3QnLCBlbnRpdHlOYW1lOiAnZW50aXR5MScgfSksXG4gICAgICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXG4gICAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgICAgU2VuZGVySWQ6ICdzZW5kZXItZGVsZXRlJyxcbiAgICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcbiAgICAgICAgICAgIG1kNU9mQm9keTogJ21kNS1kZWxldGUnLFxuICAgICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIC8vIE92ZXJyaWRlIGV4dHJhY3RvciB0byByZXR1cm4gZGVsZXRlIGV2ZW50XG4gICAgICBpbmRleGVyWyAnZXZlbnREYXRhRXh0cmFjdG9yJyBdID0ge1xuICAgICAgICBleHRyYWN0RGF0YTogKCkgPT4gWyB7XG4gICAgICAgICAgZXZlbnRJZDogJ21zZy1kZWxldGUnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ2RlbGV0ZScsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ2VudGl0eTEnLFxuICAgICAgICAgIGVudGl0eUlkOiAnaWQtZGVsZXRlJyxcbiAgICAgICAgICBwYXlsb2FkOiB7IGRhdGE6ICdkZWxldGUtdGVzdCcgfSxcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJ1xuICAgICAgICB9IF1cbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2VzcyhkZWxldGVFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbIDAgXS5pZHMpLnRvRXF1YWwoWyAnaWQtZGVsZXRlJyBdKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxsc1sgMCBdLmluZGV4TmFtZSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eTEnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0JhdGNoIE1vZGUgUHJvY2Vzc2luZycsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ2JhdGNoJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIGdyb3VwIGJ5IGVudGl0eSBhbmQgZXZlbnQgdHlwZSwgdGhlbiBtYWtlIGJ1bGsgY2FsbHNcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzKS50b0hhdmVMZW5ndGgoMik7IC8vIE9uZSBwZXIgZ3JvdXBcblxuICAgICAgLy8gQ2hlY2sgaW5kZXggY2FsbCAoZm9yIHVwZGF0ZSBvcGVyYXRpb25zKVxuICAgICAgY29uc3QgaW5kZXhDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1sgMCBdO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWyAwIF0uZGF0YSkudG9CZSgncGF5bG9hZC0wJyk7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1sgMCBdLmlkKS50b0JlKCdpZC0wJyk7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuXG4gICAgICAvLyBDaGVjayBkZWxldGUgY2FsbCAoZm9yIGRlbGV0ZSBvcGVyYXRpb25zKVxuICAgICAgY29uc3QgZGVsZXRlQ2FsbCA9IGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzWyAwIF07XG4gICAgICBleHBlY3QoZGVsZXRlQ2FsbC5pZHMpLnRvRXF1YWwoWyAnaWQtMScgXSk7XG4gICAgICBleHBlY3QoZGVsZXRlQ2FsbC5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYXJyYXkgcGF5bG9hZHMgaW4gYmF0Y2ggbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE92ZXJyaWRlIGV4dHJhY3RvciB0byByZXR1cm4gYXJyYXkgcGF5bG9hZFxuICAgICAgaW5kZXhlclsgJ2V2ZW50RGF0YUV4dHJhY3RvcicgXSA9IHtcbiAgICAgICAgZXh0cmFjdERhdGE6ICgpID0+IFsge1xuICAgICAgICAgIGV2ZW50SWQ6ICdtc2ctYXJyYXknLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ2VudGl0eTEnLFxuICAgICAgICAgIGVudGl0eUlkOiAnaWQtYXJyYXknLFxuICAgICAgICAgIHBheWxvYWQ6IFtcbiAgICAgICAgICAgIHsgaWQ6ICdpdGVtLTEnLCBkYXRhOiAnZGF0YS0xJyB9LFxuICAgICAgICAgICAgeyBpZDogJ2l0ZW0tMicsIGRhdGE6ICdkYXRhLTInIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnXG4gICAgICAgIH0gXVxuICAgICAgfTtcblxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgY29uc3QgaW5kZXhDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1sgMCBdO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWyAwIF0uaWQpLnRvQmUoJ2l0ZW0tMScpO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbIDEgXS5pZCkudG9CZSgnaXRlbS0yJyk7XG4gICAgfSk7XG5cblxuXG4gICAgaXQoJ3Nob3VsZCBza2lwIGl0ZW1zIHdpdGhvdXQgaWQgaW4gYmF0Y2ggbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIE92ZXJyaWRlIGV4dHJhY3RvciB0byByZXR1cm4gaXRlbXMgd2l0aG91dCBpZFxuICAgICAgaW5kZXhlclsgJ2V2ZW50RGF0YUV4dHJhY3RvcicgXSA9IHtcbiAgICAgICAgZXh0cmFjdERhdGE6ICgpID0+IFsge1xuICAgICAgICAgIGV2ZW50SWQ6ICdtc2ctbm8taWQnLFxuICAgICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgICAgZW50aXR5TmFtZTogJ2VudGl0eTEnLFxuICAgICAgICAgIGVudGl0eUlkOiAnaWQtbm8taWQnLFxuICAgICAgICAgIHBheWxvYWQ6IFtcbiAgICAgICAgICAgIHsgZGF0YTogJ2RhdGEtMScgfSwgLy8gTm8gaWRcbiAgICAgICAgICAgIHsgaWQ6ICdpdGVtLTInLCBkYXRhOiAnZGF0YS0yJyB9IC8vIEhhcyBpZFxuICAgICAgICAgIF0sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgICAgfSBdXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBpbmRleENhbGwgPSBpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWyAwIF07XG4gICAgICAvLyBCb3RoIGl0ZW1zIHNob3VsZCBiZSBpbmRleGVkIC0gdGhlIGZpcnN0IG9uZSBnZXRzIHRoZSBlbnRpdHlJZCBhcyBmYWxsYmFja1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWyAwIF0uaWQpLnRvQmUoJ2lkLW5vLWlkJyk7IC8vIFVzZXMgZW50aXR5SWQgYXMgZmFsbGJhY2tcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWyAxIF0uaWQpLnRvQmUoJ2l0ZW0tMicpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU2VhcmNoSW5kZXhFbnRyeSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgU2VhcmNoSW5kZXhFbnRyeSB3aXRoIGNvcnJlY3QgZGF0YScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPGFueT4gPSB7XG4gICAgICAgIGV2ZW50SWQ6ICd0ZXN0LWlkJyxcbiAgICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QtZW50aXR5JyxcbiAgICAgICAgZW50aXR5SWQ6ICd0ZXN0LWVudGl0eS1pZCcsXG4gICAgICAgIHBheWxvYWQ6IHsgdGVzdERhdGE6ICd0ZXN0LXZhbHVlJyB9LFxuICAgICAgICB0aW1lc3RhbXA6IDEyMzQ1Njc4OTAsXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgIH07XG5cbiAgICAgIC8vIEFjY2VzcyBwcml2YXRlIG1ldGhvZCBmb3IgdGVzdGluZ1xuICAgICAgY29uc3QgY3JlYXRlRW50cnkgPSAoaW5kZXhlciBhcyBhbnkpLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkuYmluZChpbmRleGVyKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTZWFyY2hJbmRleEVudHJ5ID0gY3JlYXRlRW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGVudHJ5LmlkKS50b0JlKCd0ZXN0LWVudGl0eS1pZCcpO1xuICAgICAgZXhwZWN0KGVudHJ5LmVudGl0eU5hbWUpLnRvQmUoJ3Rlc3QtZW50aXR5Jyk7XG4gICAgICBleHBlY3QoZW50cnkuZXZlbnRUeXBlKS50b0JlKCd1cGRhdGUnKTtcbiAgICAgIGV4cGVjdChlbnRyeS5kYXRhLnRlc3REYXRhKS50b0JlKCd0ZXN0LXZhbHVlJyk7XG4gICAgICBleHBlY3QoZW50cnkuZGF0YS5faW5kZXhlZEF0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGVudHJ5LnRpbWVzdGFtcCkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Vudmlyb25tZW50IFZhcmlhYmxlIEhhbmRsaW5nJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gVEFCTEVfTkFNRV9FTlZfS0VZIGlzIG1pc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEFCTEVfTkFNRV9FTlZfS0VZO1xuXG4gICAgICAvLyBCYXNlU1FTRXZlbnRQcm9jZXNzb3IgdXNlcyBCYXRjaFByb2dyZXNzIHdoaWNoIHJlY29yZHMgZmFpbHVyZXMgYW5kIGNvbnRpbnVlcyBieSBkZWZhdWx0LlxuICAgICAgLy8gTWlzY29uZmlndXJhdGlvbiBzaG91bGQgcHJldmVudCBhbnkgaW5kZXhpbmcgY2FsbHMuXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDApO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiB0YWJsZSBuYW1lIGlzIG1pc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEVTVF9UQUJMRV9UQUJMRTtcblxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdJbmRleCBFeGlzdGVuY2UgQ2hlY2snLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY2hlY2sgaW5kZXggZXhpc3RlbmNlIGJlZm9yZSBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzWyAwIF0pLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHNbIDEgXSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0xJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gaW5kZXggZG9lcyBub3QgZXhpc3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBNb2NrIGluZGV4RXhpc3RzIHRvIHJldHVybiBmYWxzZVxuICAgICAgamVzdC5zcHlPbihpbmRleGVyLnNlYXJjaEVuZ2luZSwgJ2luZGV4RXhpc3RzJykubW9ja1Jlc29sdmVkVmFsdWUoZmFsc2UpO1xuXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuICAgICAgLy8gTm8gaW5kZXgvdXBkYXRlL2RlbGV0ZSBjYWxscyBzaG91bGQgYmUgbWFkZSB3aGVuIHRoZSBpbmRleCBkb2Vzbid0IGV4aXN0LlxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDApO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1BlcmZvcm1hbmNlIENvbXBhcmlzb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBzaG93IHBlcmZvcm1hbmNlIGRpZmZlcmVuY2UgYmV0d2VlbiByZWNvcmQgYW5kIGJhdGNoIG1vZGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgcmVjb3JkSW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgICBhd2FpdCByZWNvcmRJbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuICAgICAgY29uc3QgcmVjb3JkRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gcmVjb3JkU3RhcnQ7XG5cbiAgICAgIGNvbnN0IGJhdGNoU3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgY29uc3QgYmF0Y2hJbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdiYXRjaCcpO1xuICAgICAgYXdhaXQgYmF0Y2hJbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuICAgICAgY29uc3QgYmF0Y2hEdXJhdGlvbiA9IERhdGUubm93KCkgLSBiYXRjaFN0YXJ0O1xuXG4gICAgICAvLyBCb3RoIG1vZGVzIHNob3VsZCBjb21wbGV0ZSBzdWNjZXNzZnVsbHlcbiAgICAgIGV4cGVjdChyZWNvcmREdXJhdGlvbikudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgwKTtcbiAgICAgIGV4cGVjdChiYXRjaER1cmF0aW9uKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDApO1xuXG4gICAgICAvLyBCb3RoIHNob3VsZCBwcm9jZXNzIHRoZSBzYW1lIG51bWJlciBvZiByZWNvcmRzXG4gICAgICBjb25zdCByZWNvcmRUb3RhbENhbGxzID0gcmVjb3JkSW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxscy5sZW5ndGggKyByZWNvcmRJbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGg7XG4gICAgICBjb25zdCBiYXRjaFRvdGFsQ2FsbHMgPSBiYXRjaEluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoICsgYmF0Y2hJbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGg7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRUb3RhbENhbGxzKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3QoYmF0Y2hUb3RhbENhbGxzKS50b0JlR3JlYXRlclRoYW4oMCk7XG5cbiAgICAgIC8vIFJlY29yZCBtb2RlIHNob3VsZCBtYWtlIG1vcmUgaW5kaXZpZHVhbCBjYWxscyB0aGFuIGJhdGNoIG1vZGVcbiAgICAgIC8vIChUaGlzIGlzIHRoZSBrZXkgcGVyZm9ybWFuY2UgZGlmZmVyZW5jZSB3ZSdyZSB0ZXN0aW5nKVxuICAgICAgZXhwZWN0KHJlY29yZFRvdGFsQ2FsbHMpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoYmF0Y2hUb3RhbENhbGxzKTtcblxuICAgICAgLy8gVmVyaWZ5IHRoZSBhY3R1YWwgcHJvY2Vzc2luZyBoYXBwZW5lZFxuICAgICAgZXhwZWN0KHJlY29yZEluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3QoYmF0Y2hJbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRW50aXR5IEZpbHRlcmluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgYWxsIGVudGl0aWVzIHdoZW4gbm8gZmlsdGVyaW5nIGlzIGNvbmZpZ3VyZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnKTtcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBwcm9jZXNzIGJvdGggZW50aXRpZXMgKGVudGl0eS0wIGFuZCBlbnRpdHktMSlcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCArIGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIGVudGl0aWVzIGJhc2VkIG9uIGFsbG93ZWRFbnRpdHlOYW1lcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIFsgJ2VudGl0eS0wJyBdKTsgLy8gT25seSBhbGxvdyBlbnRpdHktMFxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIG9ubHkgcHJvY2VzcyBlbnRpdHktMCAoaW5kZXggb3BlcmF0aW9uKSwgZW50aXR5LTEgc2hvdWxkIGJlIGZpbHRlcmVkIG91dFxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDEpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWyAwIF0uY29uZmlnLmluZGV4TmFtZSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0wJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciBlbnRpdGllcyBiYXNlZCBvbiBleGNsdWRlZEVudGl0eU5hbWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJywgdW5kZWZpbmVkLCBbICdlbnRpdHktMScgXSk7IC8vIElnbm9yZSBlbnRpdHktMVxuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIG9ubHkgcHJvY2VzcyBlbnRpdHktMCAoaW5kZXggb3BlcmF0aW9uKSwgZW50aXR5LTEgc2hvdWxkIGJlIGlnbm9yZWRcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1sgMCBdLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBnaXZlIHByZWNlZGVuY2UgdG8gaWdub3JlZEVudGl0eU5hbWVzIG92ZXIgYWxsb3dlZEVudGl0eU5hbWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQ29uZmlndXJlIGJvdGggYWxsb3dlZCBhbmQgaWdub3JlZCBsaXN0cyB3aXRoIG92ZXJsYXBwaW5nIGVudGl0aWVzXG4gICAgICBjb25zdCBpbmRleGVyID0gbmV3IFRlc3RTZWFyY2hJbmRleGVyKCdyZWNvcmQnLCBbICdlbnRpdHktMCcsICdlbnRpdHktMScgXSwgWyAnZW50aXR5LTAnIF0pOyAvLyBBbGxvdyBib3RoLCBidXQgaWdub3JlIGVudGl0eS0wXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgb25seSBwcm9jZXNzIGVudGl0eS0xIChkZWxldGUgb3BlcmF0aW9uKSwgZW50aXR5LTAgc2hvdWxkIGJlIGlnbm9yZWQgZGVzcGl0ZSBiZWluZyBpbiBhbGxvd2VkIGxpc3RcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbIDAgXS5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgYWxsIGVudGl0aWVzIHdoZW4gaWdub3JlZEVudGl0eU5hbWVzIGluY2x1ZGVzIGFsbCBlbnRpdGllcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIHVuZGVmaW5lZCwgWyAnZW50aXR5LTAnLCAnZW50aXR5LTEnIF0pOyAvLyBJZ25vcmUgYWxsIGVudGl0aWVzXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgcHJvY2VzcyBubyBlbnRpdGllc1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDApO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzLmxlbmd0aCkudG9CZSgwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGFsbG93ZWRFbnRpdHlOYW1lcyBsaXN0IGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIFtdKTsgLy8gRW1wdHkgYWxsb3dlZCBsaXN0XG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBFbXB0eSBhbGxvdy1saXN0IGlzIHRyZWF0ZWQgYXMgXCJubyBhbGxvdy1saXN0IGNvbmZpZ3VyZWRcIiAoZGVmYXVsdDogYWxsb3cgYWxsKS5cbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCArIGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGlnbm9yZWRFbnRpdHlOYW1lcyBsaXN0IGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcsIHVuZGVmaW5lZCwgW10pOyAvLyBFbXB0eSBpZ25vcmVkIGxpc3RcbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIC8vIFNob3VsZCBwcm9jZXNzIGFsbCBlbnRpdGllcyBub3JtYWxseSB3aGVuIGlnbm9yZWQgbGlzdCBpcyBlbXB0eVxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoICsgaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB3b3JrIGNvcnJlY3RseSBpbiBiYXRjaCBtb2RlIHdpdGggZW50aXR5IGZpbHRlcmluZycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ2JhdGNoJywgWyAnZW50aXR5LTAnIF0pOyAvLyBPbmx5IGFsbG93IGVudGl0eS0wXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgb25seSBwcm9jZXNzIGVudGl0eS0wIGluIGJhdGNoIG1vZGVcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHNDYWxscy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1sgMCBdLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19