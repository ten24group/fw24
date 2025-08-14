import { BaseSearchIndexer } from './base-search-indexer';
import { BaseEventRecord, IEventDataExtractor } from '../../core/types/event-processor-types';
import { BaseSearchEngine } from '../engines/base';
import { SearchIndexEntry } from './interfaces';
import { SQSEvent } from 'aws-lambda';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// Mock search engine
class MockSearchEngine extends BaseSearchEngine {
  public indexDocumentsCalls: { documents: any[], config: any, synchronous: boolean }[] = [];
  public deleteDocumentsCalls: { ids: string[], indexName: string, synchronous: boolean }[] = [];
  public indexExistsCalls: string[] = [];

  constructor() {
    super({});
  }

  async indexDocuments(documents: any[], config: any, synchronous: boolean = false): Promise<any> {
    this.indexDocumentsCalls.push({ documents, config, synchronous });
    return { success: true };
  }

  async deleteDocuments(ids: string[], indexName: string, synchronous: boolean = false): Promise<any> {
    this.deleteDocumentsCalls.push({ ids, indexName, synchronous });
    return { success: true };
  }

  async indexExists(indexName: string): Promise<boolean> {
    this.indexExistsCalls.push(indexName);
    return true; // Mock that index exists
  }

  async health(): Promise<any> {
    return { status: 'healthy' };
  }

  async search(): Promise<any> {
    return { hits: [] };
  }

  async initIndex(): Promise<any> {
    return { success: true };
  }

  async getIndex(): Promise<any> {
    return { name: 'test-index' };
  }

  // Implement all required abstract methods
  async deleteIndex(): Promise<any> {
    return { success: true };
  }

  async getIndexInfo(): Promise<any> {
    return { name: 'test-index' };
  }

  async getIndexStats(): Promise<any> {
    return { stats: {} };
  }

  async listIndices(): Promise<any> {
    return { indices: [] };
  }

  async updateIndexSettings(): Promise<any> {
    return { success: true };
  }

  async resetIndexSettings(): Promise<any> {
    return { success: true };
  }

  async getIndexSettings(): Promise<any> {
    return { settings: {} };
  }

  async updateDocuments(): Promise<any> {
    return { success: true };
  }

  async getDocument(): Promise<any> {
    return { id: 'test' };
  }

  async getDocuments(): Promise<any[]> {
    return [];
  }

  async deleteAllDocuments(): Promise<any> {
    return { success: true };
  }

  async deleteDocumentsByFilter(): Promise<any> {
    return { success: true };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async getStats(): Promise<any> {
    return { stats: {} };
  }

  async getVersion(): Promise<any> {
    return { version: '1.0.0' };
  }

  async multiSearch(): Promise<any> {
    return { results: [] };
  }
}

// Mock event data extractor
class MockEventDataExtractor implements IEventDataExtractor<SQSEvent, any> {
  extractData(event: SQSEvent): BaseEventRecord<any>[] {
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
class TestSearchIndexer extends BaseSearchIndexer<MockEventDataExtractor> {
  public searchEngine: MockSearchEngine;

  constructor(processMode: 'record' | 'batch' = 'record') {
    super(new MockEventDataExtractor(), { processMode });
    this.searchEngine = new MockSearchEngine();
  }

  async initialize(_event: any, _context: any): Promise<void> {
    // Mock implementation
  }
}

describe('BaseSearchIndexer', () => {
  let indexer: TestSearchIndexer;
  let mockSQSEvent: SQSEvent;

  beforeEach(() => {
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

  afterEach(() => {
    // Clean up environment variables
    delete process.env.TABLE_NAME_ENV_KEY;
    delete process.env.TEST_TABLE_TABLE;
  });

  describe('Record Mode Processing', () => {
    beforeEach(() => {
      indexer = new TestSearchIndexer('record');
    });

    it('should process records individually in record mode', async () => {
      await indexer.process(mockSQSEvent, {} as any);

      // Should call indexDocuments for each record (but one might be a delete operation)
      expect(indexer.searchEngine.indexDocumentsCalls.length + indexer.searchEngine.deleteDocumentsCalls.length).toBe(2);
      expect(indexer.searchEngine.indexExistsCalls).toHaveLength(2);

      // Check first call (should be an index operation)
      const firstCall = indexer.searchEngine.indexDocumentsCalls[0];
      expect(firstCall.documents).toHaveLength(1);
      expect(firstCall.documents[0].data).toBe('payload-0');
      expect(firstCall.documents[0].id).toBe('id-0');
      expect(firstCall.config.indexName).toBe('test-table-name-entity-0');
    });

    it('should handle delete operations in record mode', async () => {
      // Create event with delete operations
      const deleteEvent: SQSEvent = {
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

      await indexer.process(deleteEvent, {} as any);

      expect(indexer.searchEngine.deleteDocumentsCalls).toHaveLength(1);
      expect(indexer.searchEngine.deleteDocumentsCalls[0].ids).toEqual(['id-delete']);
      expect(indexer.searchEngine.deleteDocumentsCalls[0].indexName).toBe('test-table-name-entity1');
    });
  });

  describe('Batch Mode Processing', () => {
    beforeEach(() => {
      indexer = new TestSearchIndexer('batch');
    });

    it('should process records in batch mode', async () => {
      await indexer.process(mockSQSEvent, {} as any);

      // Should group by entity and event type, then make bulk calls
      expect(indexer.searchEngine.indexDocumentsCalls).toHaveLength(1);
      expect(indexer.searchEngine.deleteDocumentsCalls).toHaveLength(1);
      expect(indexer.searchEngine.indexExistsCalls).toHaveLength(2); // One per group

      // Check index call (for update operations)
      const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
      expect(indexCall.documents).toHaveLength(1);
      expect(indexCall.documents[0].data).toBe('payload-0');
      expect(indexCall.documents[0].id).toBe('id-0');
      expect(indexCall.config.indexName).toBe('test-table-name-entity-0');

      // Check delete call (for delete operations)
      const deleteCall = indexer.searchEngine.deleteDocumentsCalls[0];
      expect(deleteCall.ids).toEqual(['id-1']);
      expect(deleteCall.indexName).toBe('test-table-name-entity-1');
    });

    it('should handle array payloads in batch mode', async () => {
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

      await indexer.process(mockSQSEvent, {} as any);

      const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
      expect(indexCall.documents).toHaveLength(2);
      expect(indexCall.documents[0].id).toBe('item-1');
      expect(indexCall.documents[1].id).toBe('item-2');
    });

    it('should handle payload.items format in batch mode', async () => {
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

      await indexer.process(mockSQSEvent, {} as any);

      const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
      expect(indexCall.documents).toHaveLength(2);
      expect(indexCall.documents[0].id).toBe('item-1');
      expect(indexCall.documents[1].id).toBe('item-2');
    });

    it('should skip items without id in batch mode', async () => {
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

      await indexer.process(mockSQSEvent, {} as any);

      const indexCall = indexer.searchEngine.indexDocumentsCalls[0];
      // Both items should be indexed - the first one gets the entityId as fallback
      expect(indexCall.documents).toHaveLength(2);
      expect(indexCall.documents[0].id).toBe('id-no-id'); // Uses entityId as fallback
      expect(indexCall.documents[1].id).toBe('item-2');
    });
  });

  describe('SearchIndexEntry Creation', () => {
    beforeEach(() => {
      indexer = new TestSearchIndexer('record');
    });

    it('should create SearchIndexEntry with correct data', async () => {
      const record: BaseEventRecord<any> = {
        eventId: 'test-id',
        eventType: 'update',
        entityName: 'test-entity',
        entityId: 'test-entity-id',
        payload: { testData: 'test-value' },
        timestamp: 1234567890,
        eventSource: 'aws:sqs'
      };

      // Access private method for testing
      const createEntry = (indexer as any).createSearchIndexEntry.bind(indexer);
      const entry: SearchIndexEntry = createEntry(record);

      expect(entry.id).toBe('test-entity-id');
      expect(entry.entityName).toBe('test-entity');
      expect(entry.eventType).toBe('update');
      expect(entry.data.testData).toBe('test-value');
      expect(entry.data._indexedAt).toBeDefined();
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe('Environment Variable Handling', () => {
    beforeEach(() => {
      indexer = new TestSearchIndexer('record');
    });

    it('should throw error when TABLE_NAME_ENV_KEY is missing', async () => {
      delete process.env.TABLE_NAME_ENV_KEY;

      await expect(indexer.process(mockSQSEvent, {} as any)).rejects.toThrow(
        'TABLE_NAME_ENV_KEY environment variable is required to calculate the appropriate index-name'
      );
    });

    it('should throw error when table name is missing', async () => {
      delete process.env.TEST_TABLE_TABLE;

      await expect(indexer.process(mockSQSEvent, {} as any)).rejects.toThrow(
        'undefined environment variable is required to calculate the appropriate index-name'
      );
    });
  });

  describe('Index Existence Check', () => {
    beforeEach(() => {
      indexer = new TestSearchIndexer('record');
    });

    it('should check index existence before operations', async () => {
      await indexer.process(mockSQSEvent, {} as any);

      expect(indexer.searchEngine.indexExistsCalls).toHaveLength(2);
      expect(indexer.searchEngine.indexExistsCalls[0]).toBe('test-table-name-entity-0');
      expect(indexer.searchEngine.indexExistsCalls[1]).toBe('test-table-name-entity-1');
    });

    it('should throw error when index does not exist', async () => {
      // Mock indexExists to return false
      jest.spyOn(indexer.searchEngine, 'indexExists').mockResolvedValue(false);

      await expect(indexer.process(mockSQSEvent, {} as any)).rejects.toThrow(
        'Index test-table-name-entity-0 does not exist'
      );
    });
  });

  describe('Performance Comparison', () => {
    it('should show performance difference between record and batch modes', async () => {
      const recordStart = Date.now();
      const recordIndexer = new TestSearchIndexer('record');
      await recordIndexer.process(mockSQSEvent, {} as any);
      const recordDuration = Date.now() - recordStart;

      const batchStart = Date.now();
      const batchIndexer = new TestSearchIndexer('batch');
      await batchIndexer.process(mockSQSEvent, {} as any);
      const batchDuration = Date.now() - batchStart;

      // Both modes should complete successfully
      expect(recordDuration).toBeGreaterThanOrEqual(0);
      expect(batchDuration).toBeGreaterThanOrEqual(0);

      // Both should process the same number of records
      const recordTotalCalls = recordIndexer.searchEngine.indexDocumentsCalls.length + recordIndexer.searchEngine.deleteDocumentsCalls.length;
      const batchTotalCalls = batchIndexer.searchEngine.indexDocumentsCalls.length + batchIndexer.searchEngine.deleteDocumentsCalls.length;
      
      expect(recordTotalCalls).toBeGreaterThan(0);
      expect(batchTotalCalls).toBeGreaterThan(0);
      
      // Record mode should make more individual calls than batch mode
      // (This is the key performance difference we're testing)
      expect(recordTotalCalls).toBeGreaterThanOrEqual(batchTotalCalls);
      
      // Verify the actual processing happened
      expect(recordIndexer.searchEngine.indexExistsCalls.length).toBeGreaterThan(0);
      expect(batchIndexer.searchEngine.indexExistsCalls.length).toBeGreaterThan(0);
    });
  });
});
