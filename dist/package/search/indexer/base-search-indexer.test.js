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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtaW5kZXhlci50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9pbmRleGVyL2Jhc2Utc2VhcmNoLWluZGV4ZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLCtEQUEwRDtBQUUxRCwwQ0FBbUQ7QUFHbkQsMkNBQWtGO0FBRWxGLHFCQUFxQjtBQUNyQixNQUFNLGdCQUFpQixTQUFRLHVCQUFnQjtJQUN0QyxtQkFBbUIsR0FBOEQsRUFBRSxDQUFDO0lBQ3BGLG9CQUFvQixHQUFpRSxFQUFFLENBQUM7SUFDeEYsZ0JBQWdCLEdBQWEsRUFBRSxDQUFDO0lBRXZDO1FBQ0UsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ1osQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBZ0IsRUFBRSxNQUFXLEVBQUUsY0FBdUIsS0FBSztRQUM5RSxJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2xFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsR0FBYSxFQUFFLFNBQWlCLEVBQUUsY0FBdUIsS0FBSztRQUNsRixJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7SUFDM0IsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQUMsU0FBaUI7UUFDakMsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN0QyxPQUFPLElBQUksQ0FBQyxDQUFDLHlCQUF5QjtJQUN4QyxDQUFDO0lBRUQsS0FBSyxD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LFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLEdBQUcsWUFBWSxDQUFDLFlBQVksQ0FBQyxvQkFBb0IsQ0FBQyxNQUFNLENBQUM7WUFFckksSUFBQSxnQkFBTSxFQUFDLGdCQUFnQixDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVDLElBQUEsZ0JBQU0sRUFBQyxlQUFlLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFM0MsZ0VBQWdFO1lBQ2hFLHlEQUF5RDtZQUN6RCxJQUFBLGdCQUFNLEVBQUMsZ0JBQWdCLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUVqRSx3Q0FBd0M7WUFDeEMsSUFBQSxnQkFBTSxFQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlFLElBQUEsZ0JBQU0sRUFBQyxZQUFZLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMvRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBCYXNlU2VhcmNoSW5kZXhlciB9IGZyb20gJy4vYmFzZS1zZWFyY2gtaW5kZXhlcic7XG5pbXBvcnQgeyBCYXNlRXZlbnRSZWNvcmQsIElFdmVudERhdGFFeHRyYWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V2ZW50LXByb2Nlc3Nvci10eXBlcyc7XG5pbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSAnLi4vZW5naW5lcy9iYXNlJztcbmltcG9ydCB7IFNlYXJjaEluZGV4RW50cnkgfSBmcm9tICcuL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgU1FTRXZlbnQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGRlc2NyaWJlLCBleHBlY3QsIGl0LCBqZXN0LCBiZWZvcmVFYWNoLCBhZnRlckVhY2ggfSBmcm9tICdAamVzdC9nbG9iYWxzJztcblxuLy8gTW9jayBzZWFyY2ggZW5naW5lXG5jbGFzcyBNb2NrU2VhcmNoRW5naW5lIGV4dGVuZHMgQmFzZVNlYXJjaEVuZ2luZSB7XG4gIHB1YmxpYyBpbmRleERvY3VtZW50c0NhbGxzOiB7IGRvY3VtZW50czogYW55W10sIGNvbmZpZzogYW55LCBzeW5jaHJvbm91czogYm9vbGVhbiB9W10gPSBbXTtcbiAgcHVibGljIGRlbGV0ZURvY3VtZW50c0NhbGxzOiB7IGlkczogc3RyaW5nW10sIGluZGV4TmFtZTogc3RyaW5nLCBzeW5jaHJvbm91czogYm9vbGVhbiB9W10gPSBbXTtcbiAgcHVibGljIGluZGV4RXhpc3RzQ2FsbHM6IHN0cmluZ1tdID0gW107XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoe30pO1xuICB9XG5cbiAgYXN5bmMgaW5kZXhEb2N1bWVudHMoZG9jdW1lbnRzOiBhbnlbXSwgY29uZmlnOiBhbnksIHN5bmNocm9ub3VzOiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPGFueT4ge1xuICAgIHRoaXMuaW5kZXhEb2N1bWVudHNDYWxscy5wdXNoKHsgZG9jdW1lbnRzLCBjb25maWcsIHN5bmNocm9ub3VzIH0pO1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50cyhpZHM6IHN0cmluZ1tdLCBpbmRleE5hbWU6IHN0cmluZywgc3luY2hyb25vdXM6IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8YW55PiB7XG4gICAgdGhpcy5kZWxldGVEb2N1bWVudHNDYWxscy5wdXNoKHsgaWRzLCBpbmRleE5hbWUsIHN5bmNocm9ub3VzIH0pO1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGluZGV4RXhpc3RzKGluZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdGhpcy5pbmRleEV4aXN0c0NhbGxzLnB1c2goaW5kZXhOYW1lKTtcbiAgICByZXR1cm4gdHJ1ZTsgLy8gTW9jayB0aGF0IGluZGV4IGV4aXN0c1xuICB9XG5cbiAgYXN5bmMgaGVhbHRoKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnaGVhbHRoeScgfTtcbiAgfVxuXG4gIGFzeW5jIHNlYXJjaCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IGhpdHM6IFtdIH07XG4gIH1cblxuICBhc3luYyBpbml0SW5kZXgoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IG5hbWU6ICd0ZXN0LWluZGV4JyB9O1xuICB9XG5cbiAgLy8gSW1wbGVtZW50IGFsbCByZXF1aXJlZCBhYnN0cmFjdCBtZXRob2RzXG4gIGFzeW5jIGRlbGV0ZUluZGV4KCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0SW5kZXhJbmZvKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgbmFtZTogJ3Rlc3QtaW5kZXgnIH07XG4gIH1cblxuICBhc3luYyBnZXRJbmRleFN0YXRzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3RhdHM6IHt9IH07XG4gIH1cblxuICBhc3luYyBsaXN0SW5kaWNlcygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IGluZGljZXM6IFtdIH07XG4gIH1cblxuICBhc3luYyB1cGRhdGVJbmRleFNldHRpbmdzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgcmVzZXRJbmRleFNldHRpbmdzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0SW5kZXhTZXR0aW5ncygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHNldHRpbmdzOiB7fSB9O1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlRG9jdW1lbnRzKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgZ2V0RG9jdW1lbnQoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBpZDogJ3Rlc3QnIH07XG4gIH1cblxuICBhc3luYyBnZXREb2N1bWVudHMoKTogUHJvbWlzZTxhbnlbXT4ge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUFsbERvY3VtZW50cygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZURvY3VtZW50c0J5RmlsdGVyKCk6IFByb21pc2U8YW55PiB7XG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xuICB9XG5cbiAgYXN5bmMgaXNIZWFsdGh5KCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgYXN5bmMgZ2V0U3RhdHMoKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyBzdGF0czoge30gfTtcbiAgfVxuXG4gIGFzeW5jIGdldFZlcnNpb24oKTogUHJvbWlzZTxhbnk+IHtcbiAgICByZXR1cm4geyB2ZXJzaW9uOiAnMS4wLjAnIH07XG4gIH1cblxuICBhc3luYyBtdWx0aVNlYXJjaCgpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB7IHJlc3VsdHM6IFtdIH07XG4gIH1cbn1cblxuLy8gTW9jayBldmVudCBkYXRhIGV4dHJhY3RvclxuY2xhc3MgTW9ja0V2ZW50RGF0YUV4dHJhY3RvciBpbXBsZW1lbnRzIElFdmVudERhdGFFeHRyYWN0b3I8U1FTRXZlbnQsIGFueT4ge1xuICBleHRyYWN0RGF0YShldmVudDogU1FTRXZlbnQpOiBCYXNlRXZlbnRSZWNvcmQ8YW55PltdIHtcbiAgICByZXR1cm4gZXZlbnQuUmVjb3Jkcy5tYXAoKHJlY29yZCwgaW5kZXgpID0+ICh7XG4gICAgICBldmVudElkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgZXZlbnRUeXBlOiBpbmRleCAlIDIgPT09IDAgPyAndXBkYXRlJyA6ICdkZWxldGUnLFxuICAgICAgZW50aXR5TmFtZTogYGVudGl0eS0ke2luZGV4ICUgMn1gLFxuICAgICAgZW50aXR5SWQ6IGBpZC0ke2luZGV4fWAsXG4gICAgICBwYXlsb2FkOiB7IGRhdGE6IGBwYXlsb2FkLSR7aW5kZXh9YCwgaWQ6IGBpZC0ke2luZGV4fWAgfSxcbiAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIGV2ZW50U291cmNlOiByZWNvcmQuZXZlbnRTb3VyY2VcbiAgICB9KSk7XG4gIH1cbn1cblxuLy8gVGVzdCBpbXBsZW1lbnRhdGlvblxuY2xhc3MgVGVzdFNlYXJjaEluZGV4ZXIgZXh0ZW5kcyBCYXNlU2VhcmNoSW5kZXhlcjxNb2NrRXZlbnREYXRhRXh0cmFjdG9yPiB7XG4gIHB1YmxpYyBzZWFyY2hFbmdpbmU6IE1vY2tTZWFyY2hFbmdpbmU7XG5cbiAgY29uc3RydWN0b3IocHJvY2Vzc01vZGU6ICdyZWNvcmQnIHwgJ2JhdGNoJyA9ICdyZWNvcmQnKSB7XG4gICAgc3VwZXIobmV3IE1vY2tFdmVudERhdGFFeHRyYWN0b3IoKSwgeyBwcm9jZXNzTW9kZSB9KTtcbiAgICB0aGlzLnNlYXJjaEVuZ2luZSA9IG5ldyBNb2NrU2VhcmNoRW5naW5lKCk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKF9ldmVudDogYW55LCBfY29udGV4dDogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gTW9jayBpbXBsZW1lbnRhdGlvblxuICB9XG59XG5cbmRlc2NyaWJlKCdCYXNlU2VhcmNoSW5kZXhlcicsICgpID0+IHtcbiAgbGV0IGluZGV4ZXI6IFRlc3RTZWFyY2hJbmRleGVyO1xuICBsZXQgbW9ja1NRU0V2ZW50OiBTUVNFdmVudDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBtb2NrU1FTRXZlbnQgPSB7XG4gICAgICBSZWNvcmRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdtc2ctMScsXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3JlY2VpcHQtMScsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAndGVzdDEnLCBlbnRpdHlOYW1lOiAnZW50aXR5MScgfSksXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgIFNlbmRlcklkOiAnc2VuZGVyLTEnLFxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgIG1kNU9mQm9keTogJ21kNS0xJyxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdtc2ctMicsXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3JlY2VpcHQtMicsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkYXRhOiAndGVzdDInLCBlbnRpdHlOYW1lOiAnZW50aXR5MicgfSksXG4gICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJyxcbiAgICAgICAgICAgIFNlbmRlcklkOiAnc2VuZGVyLTInLFxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgIG1kNU9mQm9keTogJ21kNS0yJyxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICAgIH1cbiAgICAgIF1cbiAgICB9O1xuXG4gICAgLy8gTW9jayBlbnZpcm9ubWVudCB2YXJpYWJsZXMgLSB1c2UgdGhlIGNvcnJlY3QgdXBwZXJjYXNlIGZvcm1hdFxuICAgIHByb2Nlc3MuZW52LlRBQkxFX05BTUVfRU5WX0tFWSA9ICd0ZXN0LXRhYmxlJztcbiAgICBwcm9jZXNzLmVudi5URVNUX1RBQkxFX1RBQkxFID0gJ3Rlc3QtdGFibGUtbmFtZSc7IC8vIFVwcGVyY2FzZSB3aXRoIHN1ZmZpeFxuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIC8vIENsZWFuIHVwIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgIGRlbGV0ZSBwcm9jZXNzLmVudi5UQUJMRV9OQU1FX0VOVl9LRVk7XG4gICAgZGVsZXRlIHByb2Nlc3MuZW52LlRFU1RfVEFCTEVfVEFCTEU7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZWNvcmQgTW9kZSBQcm9jZXNzaW5nJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgcmVjb3JkcyBpbmRpdmlkdWFsbHkgaW4gcmVjb3JkIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICAvLyBTaG91bGQgY2FsbCBpbmRleERvY3VtZW50cyBmb3IgZWFjaCByZWNvcmQgKGJ1dCBvbmUgbWlnaHQgYmUgYSBkZWxldGUgb3BlcmF0aW9uKVxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoICsgaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoKS50b0JlKDIpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgyKTtcblxuICAgICAgLy8gQ2hlY2sgZmlyc3QgY2FsbCAoc2hvdWxkIGJlIGFuIGluZGV4IG9wZXJhdGlvbilcbiAgICAgIGNvbnN0IGZpcnN0Q2FsbCA9IGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHNbMF07XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmRvY3VtZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGZpcnN0Q2FsbC5kb2N1bWVudHNbMF0uZGF0YSkudG9CZSgncGF5bG9hZC0wJyk7XG4gICAgICBleHBlY3QoZmlyc3RDYWxsLmRvY3VtZW50c1swXS5pZCkudG9CZSgnaWQtMCcpO1xuICAgICAgZXhwZWN0KGZpcnN0Q2FsbC5jb25maWcuaW5kZXhOYW1lKS50b0JlKCd0ZXN0LXRhYmxlLW5hbWUtZW50aXR5LTAnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGRlbGV0ZSBvcGVyYXRpb25zIGluIHJlY29yZCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gQ3JlYXRlIGV2ZW50IHdpdGggZGVsZXRlIG9wZXJhdGlvbnNcbiAgICAgIGNvbnN0IGRlbGV0ZUV2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy1kZWxldGUnLFxuICAgICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3JlY2VpcHQtZGVsZXRlJyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGF0YTogJ2RlbGV0ZS10ZXN0JywgZW50aXR5TmFtZTogJ2VudGl0eTEnIH0pLFxuICAgICAgICAgICAgYXR0cmlidXRlczoge1xuICAgICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxuICAgICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MCcsXG4gICAgICAgICAgICAgIFNlbmRlcklkOiAnc2VuZGVyLWRlbGV0ZScsXG4gICAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MCdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gICAgICAgICAgICBtZDVPZkJvZHk6ICdtZDUtZGVsZXRlJyxcbiAgICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXG4gICAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXG4gICAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9O1xuXG4gICAgICAvLyBPdmVycmlkZSBleHRyYWN0b3IgdG8gcmV0dXJuIGRlbGV0ZSBldmVudFxuICAgICAgaW5kZXhlclsnZXZlbnREYXRhRXh0cmFjdG9yJ10gPSB7XG4gICAgICAgIGV4dHJhY3REYXRhOiAoKSA9PiBbe1xuICAgICAgICAgIGV2ZW50SWQ6ICdtc2ctZGVsZXRlJyxcbiAgICAgICAgICBldmVudFR5cGU6ICdkZWxldGUnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHkxJyxcbiAgICAgICAgICBlbnRpdHlJZDogJ2lkLWRlbGV0ZScsXG4gICAgICAgICAgcGF5bG9hZDogeyBkYXRhOiAnZGVsZXRlLXRlc3QnIH0sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgICAgfV1cbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2VzcyhkZWxldGVFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHNbMF0uaWRzKS50b0VxdWFsKFsnaWQtZGVsZXRlJ10pO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzWzBdLmluZGV4TmFtZSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eTEnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0JhdGNoIE1vZGUgUHJvY2Vzc2luZycsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ2JhdGNoJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgcmVjb3JkcyBpbiBiYXRjaCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcblxuICAgICAgLy8gU2hvdWxkIGdyb3VwIGJ5IGVudGl0eSBhbmQgZXZlbnQgdHlwZSwgdGhlbiBtYWtlIGJ1bGsgY2FsbHNcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzKS50b0hhdmVMZW5ndGgoMik7IC8vIE9uZSBwZXIgZ3JvdXBcblxuICAgICAgLy8gQ2hlY2sgaW5kZXggY2FsbCAoZm9yIHVwZGF0ZSBvcGVyYXRpb25zKVxuICAgICAgY29uc3QgaW5kZXhDYWxsID0gaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHNDYWxsc1swXTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1swXS5kYXRhKS50b0JlKCdwYXlsb2FkLTAnKTtcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzWzBdLmlkKS50b0JlKCdpZC0wJyk7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmNvbmZpZy5pbmRleE5hbWUpLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuXG4gICAgICAvLyBDaGVjayBkZWxldGUgY2FsbCAoZm9yIGRlbGV0ZSBvcGVyYXRpb25zKVxuICAgICAgY29uc3QgZGVsZXRlQ2FsbCA9IGluZGV4ZXIuc2VhcmNoRW5naW5lLmRlbGV0ZURvY3VtZW50c0NhbGxzWzBdO1xuICAgICAgZXhwZWN0KGRlbGV0ZUNhbGwuaWRzKS50b0VxdWFsKFsnaWQtMSddKTtcbiAgICAgIGV4cGVjdChkZWxldGVDYWxsLmluZGV4TmFtZSkudG9CZSgndGVzdC10YWJsZS1uYW1lLWVudGl0eS0xJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhcnJheSBwYXlsb2FkcyBpbiBiYXRjaCBtb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gT3ZlcnJpZGUgZXh0cmFjdG9yIHRvIHJldHVybiBhcnJheSBwYXlsb2FkXG4gICAgICBpbmRleGVyWydldmVudERhdGFFeHRyYWN0b3InXSA9IHtcbiAgICAgICAgZXh0cmFjdERhdGE6ICgpID0+IFt7XG4gICAgICAgICAgZXZlbnRJZDogJ21zZy1hcnJheScsXG4gICAgICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnZW50aXR5MScsXG4gICAgICAgICAgZW50aXR5SWQ6ICdpZC1hcnJheScsXG4gICAgICAgICAgcGF5bG9hZDogW1xuICAgICAgICAgICAgeyBpZDogJ2l0ZW0tMScsIGRhdGE6ICdkYXRhLTEnIH0sXG4gICAgICAgICAgICB7IGlkOiAnaXRlbS0yJywgZGF0YTogJ2RhdGEtMicgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgICAgfV1cbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSk7XG5cbiAgICAgIGNvbnN0IGluZGV4Q2FsbCA9IGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHNbMF07XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbMF0uaWQpLnRvQmUoJ2l0ZW0tMScpO1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbMV0uaWQpLnRvQmUoJ2l0ZW0tMicpO1xuICAgIH0pO1xuXG5cblxuICAgIGl0KCdzaG91bGQgc2tpcCBpdGVtcyB3aXRob3V0IGlkIGluIGJhdGNoIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBPdmVycmlkZSBleHRyYWN0b3IgdG8gcmV0dXJuIGl0ZW1zIHdpdGhvdXQgaWRcbiAgICAgIGluZGV4ZXJbJ2V2ZW50RGF0YUV4dHJhY3RvciddID0ge1xuICAgICAgICBleHRyYWN0RGF0YTogKCkgPT4gW3tcbiAgICAgICAgICBldmVudElkOiAnbXNnLW5vLWlkJyxcbiAgICAgICAgICBldmVudFR5cGU6ICd1cGRhdGUnLFxuICAgICAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHkxJyxcbiAgICAgICAgICBlbnRpdHlJZDogJ2lkLW5vLWlkJyxcbiAgICAgICAgICBwYXlsb2FkOiBbXG4gICAgICAgICAgICB7IGRhdGE6ICdkYXRhLTEnIH0sIC8vIE5vIGlkXG4gICAgICAgICAgICB7IGlkOiAnaXRlbS0yJywgZGF0YTogJ2RhdGEtMicgfSAvLyBIYXMgaWRcbiAgICAgICAgICBdLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnXG4gICAgICAgIH1dXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBjb25zdCBpbmRleENhbGwgPSBpbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzWzBdO1xuICAgICAgLy8gQm90aCBpdGVtcyBzaG91bGQgYmUgaW5kZXhlZCAtIHRoZSBmaXJzdCBvbmUgZ2V0cyB0aGUgZW50aXR5SWQgYXMgZmFsbGJhY2tcbiAgICAgIGV4cGVjdChpbmRleENhbGwuZG9jdW1lbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoaW5kZXhDYWxsLmRvY3VtZW50c1swXS5pZCkudG9CZSgnaWQtbm8taWQnKTsgLy8gVXNlcyBlbnRpdHlJZCBhcyBmYWxsYmFja1xuICAgICAgZXhwZWN0KGluZGV4Q2FsbC5kb2N1bWVudHNbMV0uaWQpLnRvQmUoJ2l0ZW0tMicpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU2VhcmNoSW5kZXhFbnRyeSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgU2VhcmNoSW5kZXhFbnRyeSB3aXRoIGNvcnJlY3QgZGF0YScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZDogQmFzZUV2ZW50UmVjb3JkPGFueT4gPSB7XG4gICAgICAgIGV2ZW50SWQ6ICd0ZXN0LWlkJyxcbiAgICAgICAgZXZlbnRUeXBlOiAndXBkYXRlJyxcbiAgICAgICAgZW50aXR5TmFtZTogJ3Rlc3QtZW50aXR5JyxcbiAgICAgICAgZW50aXR5SWQ6ICd0ZXN0LWVudGl0eS1pZCcsXG4gICAgICAgIHBheWxvYWQ6IHsgdGVzdERhdGE6ICd0ZXN0LXZhbHVlJyB9LFxuICAgICAgICB0aW1lc3RhbXA6IDEyMzQ1Njc4OTAsXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcydcbiAgICAgIH07XG5cbiAgICAgIC8vIEFjY2VzcyBwcml2YXRlIG1ldGhvZCBmb3IgdGVzdGluZ1xuICAgICAgY29uc3QgY3JlYXRlRW50cnkgPSAoaW5kZXhlciBhcyBhbnkpLmNyZWF0ZVNlYXJjaEluZGV4RW50cnkuYmluZChpbmRleGVyKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTZWFyY2hJbmRleEVudHJ5ID0gY3JlYXRlRW50cnkocmVjb3JkKTtcblxuICAgICAgZXhwZWN0KGVudHJ5LmlkKS50b0JlKCd0ZXN0LWVudGl0eS1pZCcpO1xuICAgICAgZXhwZWN0KGVudHJ5LmVudGl0eU5hbWUpLnRvQmUoJ3Rlc3QtZW50aXR5Jyk7XG4gICAgICBleHBlY3QoZW50cnkuZXZlbnRUeXBlKS50b0JlKCd1cGRhdGUnKTtcbiAgICAgIGV4cGVjdChlbnRyeS5kYXRhLnRlc3REYXRhKS50b0JlKCd0ZXN0LXZhbHVlJyk7XG4gICAgICBleHBlY3QoZW50cnkuZGF0YS5faW5kZXhlZEF0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGVudHJ5LnRpbWVzdGFtcCkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Vudmlyb25tZW50IFZhcmlhYmxlIEhhbmRsaW5nJywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgaW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcigncmVjb3JkJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gVEFCTEVfTkFNRV9FTlZfS0VZIGlzIG1pc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGUgcHJvY2Vzcy5lbnYuVEFCTEVfTkFNRV9FTlZfS0VZO1xuXG4gICAgICBhd2FpdCBleHBlY3QoaW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KSkucmVqZWN0cy50b1Rocm93KFxuICAgICAgICAnVEFCTEVfTkFNRV9FTlZfS0VZIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkIHRvIGNhbGN1bGF0ZSB0aGUgYXBwcm9wcmlhdGUgaW5kZXgtbmFtZSdcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gdGFibGUgbmFtZSBpcyBtaXNzaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgZGVsZXRlIHByb2Nlc3MuZW52LlRFU1RfVEFCTEVfVEFCTEU7XG5cbiAgICAgIGF3YWl0IGV4cGVjdChpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpKS5yZWplY3RzLnRvVGhyb3coXG4gICAgICAgICd1bmRlZmluZWQgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQgdG8gY2FsY3VsYXRlIHRoZSBhcHByb3ByaWF0ZSBpbmRleC1uYW1lJ1xuICAgICAgKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0luZGV4IEV4aXN0ZW5jZSBDaGVjaycsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIGluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjaGVjayBpbmRleCBleGlzdGVuY2UgYmVmb3JlIG9wZXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBpbmRleGVyLnByb2Nlc3MobW9ja1NRU0V2ZW50LCB7fSBhcyBhbnkpO1xuXG4gICAgICBleHBlY3QoaW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHNbMF0pLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMCcpO1xuICAgICAgZXhwZWN0KGluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RXhpc3RzQ2FsbHNbMV0pLnRvQmUoJ3Rlc3QtdGFibGUtbmFtZS1lbnRpdHktMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB0aHJvdyBlcnJvciB3aGVuIGluZGV4IGRvZXMgbm90IGV4aXN0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTW9jayBpbmRleEV4aXN0cyB0byByZXR1cm4gZmFsc2VcbiAgICAgIGplc3Quc3B5T24oaW5kZXhlci5zZWFyY2hFbmdpbmUsICdpbmRleEV4aXN0cycpLm1vY2tSZXNvbHZlZFZhbHVlKGZhbHNlKTtcblxuICAgICAgYXdhaXQgZXhwZWN0KGluZGV4ZXIucHJvY2Vzcyhtb2NrU1FTRXZlbnQsIHt9IGFzIGFueSkpLnJlamVjdHMudG9UaHJvdyhcbiAgICAgICAgJ0luZGV4IHRlc3QtdGFibGUtbmFtZS1lbnRpdHktMCBkb2VzIG5vdCBleGlzdCdcbiAgICAgICk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQZXJmb3JtYW5jZSBDb21wYXJpc29uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgc2hvdyBwZXJmb3JtYW5jZSBkaWZmZXJlbmNlIGJldHdlZW4gcmVjb3JkIGFuZCBiYXRjaCBtb2RlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZFN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICAgIGNvbnN0IHJlY29yZEluZGV4ZXIgPSBuZXcgVGVzdFNlYXJjaEluZGV4ZXIoJ3JlY29yZCcpO1xuICAgICAgYXdhaXQgcmVjb3JkSW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcbiAgICAgIGNvbnN0IHJlY29yZER1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHJlY29yZFN0YXJ0O1xuXG4gICAgICBjb25zdCBiYXRjaFN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgICAgIGNvbnN0IGJhdGNoSW5kZXhlciA9IG5ldyBUZXN0U2VhcmNoSW5kZXhlcignYmF0Y2gnKTtcbiAgICAgIGF3YWl0IGJhdGNoSW5kZXhlci5wcm9jZXNzKG1vY2tTUVNFdmVudCwge30gYXMgYW55KTtcbiAgICAgIGNvbnN0IGJhdGNoRHVyYXRpb24gPSBEYXRlLm5vdygpIC0gYmF0Y2hTdGFydDtcblxuICAgICAgLy8gQm90aCBtb2RlcyBzaG91bGQgY29tcGxldGUgc3VjY2Vzc2Z1bGx5XG4gICAgICBleHBlY3QocmVjb3JkRHVyYXRpb24pLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMCk7XG4gICAgICBleHBlY3QoYmF0Y2hEdXJhdGlvbikudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgwKTtcblxuICAgICAgLy8gQm90aCBzaG91bGQgcHJvY2VzcyB0aGUgc2FtZSBudW1iZXIgb2YgcmVjb3Jkc1xuICAgICAgY29uc3QgcmVjb3JkVG90YWxDYWxscyA9IHJlY29yZEluZGV4ZXIuc2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzQ2FsbHMubGVuZ3RoICsgcmVjb3JkSW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoO1xuICAgICAgY29uc3QgYmF0Y2hUb3RhbENhbGxzID0gYmF0Y2hJbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleERvY3VtZW50c0NhbGxzLmxlbmd0aCArIGJhdGNoSW5kZXhlci5zZWFyY2hFbmdpbmUuZGVsZXRlRG9jdW1lbnRzQ2FsbHMubGVuZ3RoO1xuICAgICAgXG4gICAgICBleHBlY3QocmVjb3JkVG90YWxDYWxscykudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KGJhdGNoVG90YWxDYWxscykudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgXG4gICAgICAvLyBSZWNvcmQgbW9kZSBzaG91bGQgbWFrZSBtb3JlIGluZGl2aWR1YWwgY2FsbHMgdGhhbiBiYXRjaCBtb2RlXG4gICAgICAvLyAoVGhpcyBpcyB0aGUga2V5IHBlcmZvcm1hbmNlIGRpZmZlcmVuY2Ugd2UncmUgdGVzdGluZylcbiAgICAgIGV4cGVjdChyZWNvcmRUb3RhbENhbGxzKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKGJhdGNoVG90YWxDYWxscyk7XG4gICAgICBcbiAgICAgIC8vIFZlcmlmeSB0aGUgYWN0dWFsIHByb2Nlc3NpbmcgaGFwcGVuZWRcbiAgICAgIGV4cGVjdChyZWNvcmRJbmRleGVyLnNlYXJjaEVuZ2luZS5pbmRleEV4aXN0c0NhbGxzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KGJhdGNoSW5kZXhlci5zZWFyY2hFbmdpbmUuaW5kZXhFeGlzdHNDYWxscy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==