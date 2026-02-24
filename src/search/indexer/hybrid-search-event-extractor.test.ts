import { SQSEvent, SQSRecord } from 'aws-lambda';
import { HybridSearchEventExtractor } from './hybrid-search-event-extractor';
import { BaseEventRecord } from '../../core/types/event-processor-types';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Mock the DynamoDBEventDataExtractor
jest.mock('../../core/runtime/event-processor/dynamodb-event-data-extractor', () => ({
  DynamoDBEventDataExtractor: jest.fn().mockImplementation(() => ({
    extractData: jest.fn()
  }))
}));

const createSQSRecord = (body: any, messageId: string = 'test-msg-id'): SQSRecord => ({
  messageId,
  receiptHandle: 'test-receipt',
  body: JSON.stringify(body),
  attributes: {
    ApproximateReceiveCount: '1',
    SentTimestamp: '1234567890',
    SenderId: 'test-sender',
    ApproximateFirstReceiveTimestamp: '1234567890'
  },
  messageAttributes: {},
  md5OfBody: 'test-md5',
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
  awsRegion: 'us-east-1'
});

describe('HybridSearchEventExtractor', () => {
  let extractor: HybridSearchEventExtractor;
  let mockDynamoExtractor: any;

  beforeEach(() => {
    extractor = new HybridSearchEventExtractor();
    // Get the mocked DynamoDB extractor instance
    mockDynamoExtractor = (extractor as any).dynamoExtractor;
  });

  describe('Resync Event Processing', () => {
    it('should extract resync events with eventName format', () => {
      const resyncBody = {
        eventName: 'RESYNC',
        data: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        eventId: 'test-msg-id',
        eventType: 'update',
        timestamp: expect.any(Number),
        eventSource: 'aws:sqs',
        payload: resyncBody.data,
        entityId: 'user-123',
        entityName: 'user',
        metadata: {
          source: 'resync'
        }
      });
    });

    it('should extract resync events with simple format (no eventName)', () => {
      const resyncBody = {
        data: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        eventId: 'test-msg-id',
        eventType: 'update',
        timestamp: expect.any(Number),
        eventSource: 'aws:sqs',
        payload: resyncBody.data,
        entityId: 'user-456',
        entityName: 'user',
        metadata: {
          source: 'resync'
        }
      });
    });

    it('should extract resync events with array data (batch processing)', () => {
      const resyncBody = {
        eventName: 'RESYNC',
        data: [
          { id: 'user-1', name: 'User 1' },
          { id: 'user-2', name: 'User 2' }
        ],
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      // Array data should create multiple individual records
      expect(records).toHaveLength(2);

      // First record
      expect(records[0]).toEqual({
        eventId: 'test-msg-id-0',
        eventType: 'update',
        timestamp: expect.any(Number),
        eventSource: 'aws:sqs',
        payload: { id: 'user-1', name: 'User 1' },
        entityId: 'user-1',
        entityName: 'user',
        metadata: {
          source: 'resync'
        }
      });

      // Second record
      expect(records[1]).toEqual({
        eventId: 'test-msg-id-1',
        eventType: 'update',
        timestamp: expect.any(Number),
        eventSource: 'aws:sqs',
        payload: { id: 'user-2', name: 'User 2' },
        entityId: 'user-2',
        entityName: 'user',
        metadata: {
          source: 'resync'
        }
      });
    });

    it('should handle resync events with entityName-based ID', () => {
      const resyncBody = {
        eventName: 'RESYNC',
        data: { userId: 'user-456', name: 'Jane Doe' },
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0].entityId).toBe('user-456');
      expect(records[0].payload).toEqual(resyncBody.data);
    });

    it('should handle multiple resync records', () => {
      const sqsEvent: SQSEvent = {
        Records: [
          createSQSRecord({
            eventName: 'RESYNC',
            data: { id: 'user-1', name: 'User 1' },
            entityName: 'user'
          }, 'msg-1'),
          createSQSRecord({
            eventName: 'RESYNC',
            data: { id: 'post-1', title: 'Post 1' },
            entityName: 'post'
          }, 'msg-2')
        ]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(2);
      expect(records[0].entityName).toBe('user');
      expect(records[0].payload.name).toBe('User 1');
      expect(records[1].entityName).toBe('post');
      expect(records[1].payload.title).toBe('Post 1');
    });
  });

  describe('DynamoDB Stream Event Processing', () => {
    it('should delegate to DynamoDBEventDataExtractor for non-resync events', () => {
      const snsBody = {
        Message: JSON.stringify({
          Records: [{
            eventName: 'INSERT',
            dynamodb: {
              NewImage: { id: { S: 'user-123' }, name: { S: 'John' } }
            }
          }]
        })
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const mockDynamoRecords: BaseEventRecord<any>[] = [{
        eventId: 'dynamo-event-1',
        eventType: 'create',
        entityName: 'user',
        entityId: 'user-123',
        payload: {
          newImage: { id: 'user-123', name: 'John' },
          oldImage: undefined,
          keys: { id: 'user-123' }
        },
        timestamp: Date.now(),
        eventSource: 'aws:dynamodb',
        metadata: {}
      }];

      mockDynamoExtractor.extractData.mockReturnValue(mockDynamoRecords);

      const records = extractor.extractData(sqsEvent);

      expect(mockDynamoExtractor.extractData).toHaveBeenCalledWith(sqsEvent);
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        ...mockDynamoRecords[0],
        metadata: {
          source: 'stream'
        }
      });
    });

    it('should preserve DynamoDB stream record structure', () => {
      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord({ someOtherFormat: 'data' })]
      };

      const mockDynamoRecords: BaseEventRecord<any>[] = [{
        eventId: 'dynamo-event-1',
        eventType: 'update',
        entityName: 'post',
        entityId: 'post-456',
        payload: {
          newImage: { id: 'post-456', title: 'Updated Post' },
          oldImage: { id: 'post-456', title: 'Old Post' },
          keys: { id: 'post-456' }
        },
        timestamp: Date.now(),
        eventSource: 'aws:dynamodb'
      }];

      mockDynamoExtractor.extractData.mockReturnValue(mockDynamoRecords);

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0].metadata?.source).toBe('stream');
      expect(records[0].payload).toEqual(mockDynamoRecords[0].payload);
    });
  });

  describe('Mixed Event Processing', () => {
    it('should handle mixed resync and stream events in the same SQS batch', () => {
      const sqsEvent: SQSEvent = {
        Records: [
          createSQSRecord({
            eventName: 'RESYNC',
            data: { id: 'user-resync', name: 'Resync User' },
            entityName: 'user'
          }, 'resync-msg'),
          createSQSRecord({
            Message: 'DynamoDB stream event'
          }, 'stream-msg')
        ]
      };

      const mockDynamoRecords: BaseEventRecord<any>[] = [{
        eventId: 'stream-event',
        eventType: 'delete',
        entityName: 'post',
        entityId: 'post-stream',
        payload: { oldImage: { id: 'post-stream' } },
        timestamp: Date.now(),
        eventSource: 'aws:dynamodb'
      }];

      // Mock to return records only for the second (stream) record
      mockDynamoExtractor.extractData.mockImplementation((event: SQSEvent) => {
        if (event.Records[0].messageId === 'stream-msg') {
          return mockDynamoRecords;
        }
        return [];
      });

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(2);

      // First record should be resync
      expect(records[0].metadata?.source).toBe('resync');
      expect(records[0].entityName).toBe('user');
      expect(records[0].payload.name).toBe('Resync User');

      // Second record should be stream
      expect(records[1].metadata?.source).toBe('stream');
      expect(records[1].entityName).toBe('post');
      expect(records[1].eventType).toBe('delete');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON in SQS record body gracefully', () => {
      const invalidRecord = {
        ...createSQSRecord({}),
        body: 'invalid-json{'
      };

      const sqsEvent: SQSEvent = {
        Records: [invalidRecord]
      };

      // Mock DynamoDB extractor to return empty array for invalid data
      mockDynamoExtractor.extractData.mockReturnValue([]);

      // Should not throw, but delegate to DynamoDB extractor
      expect(() => extractor.extractData(sqsEvent)).not.toThrow();
      expect(mockDynamoExtractor.extractData).toHaveBeenCalled();

      const records = extractor.extractData(sqsEvent);
      expect(records).toEqual([]);
    });

    it('should handle missing required fields in resync events', () => {
      const incompleteResyncBody = {
        eventName: 'RESYNC',
        data: { id: 'user-123' }
        // Missing entityName
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(incompleteResyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0].entityName).toBeUndefined();
      expect(records[0].metadata?.source).toBe('resync');
    });

    it('should handle empty or null data in resync events', () => {
      const emptyResyncBody = {
        eventName: 'RESYNC',
        data: null,
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(emptyResyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0].payload).toBeNull();
      expect(records[0].entityId).toBeUndefined();
    });
  });

  describe('Entity ID Extraction', () => {
    it('should prefer "id" field over entityName-based field', () => {
      const resyncBody = {
        eventName: 'RESYNC',
        data: {
          id: 'primary-id',
          userId: 'secondary-id',
          name: 'Test User'
        },
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records[0].entityId).toBe('primary-id');
    });

    it('should fallback to entityName-based ID when "id" is missing', () => {
      const resyncBody = {
        eventName: 'RESYNC',
        data: {
          postId: 'fallback-id',
          title: 'Test Post'
        },
        entityName: 'post'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records[0].entityId).toBe('fallback-id');
    });

    it('should handle missing ID fields gracefully', () => {
      const resyncBody = {
        eventName: 'RESYNC',
        data: {
          name: 'No ID User'
        },
        entityName: 'user'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(resyncBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records[0].entityId).toBeUndefined();
    });
  });
});
