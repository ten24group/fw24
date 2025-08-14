import { BaseSQSEventProcessor } from './base-sqs-event-processor';
import { BaseEventRecord, IEventDataExtractor } from '../../types/event-processor-types';
import { SQSEvent } from 'aws-lambda';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Mock implementation for testing
class MockEventDataExtractor implements IEventDataExtractor<SQSEvent, any> {
  extractData(event: SQSEvent): BaseEventRecord<any>[] {
    return event.Records.map((record, index) => ({
      eventId: record.messageId,
      eventType: 'update',
      entityName: `entity-${index}`,
      entityId: `id-${index}`,
      payload: { data: `payload-${index}` },
      timestamp: Date.now(),
      eventSource: record.eventSource
    }));
  }
}

class TestSQSEventProcessor extends BaseSQSEventProcessor<MockEventDataExtractor> {
  public processRecordCalls: BaseEventRecord<any>[] = [];
  public processRecordsBatchCalls: BaseEventRecord<any>[][] = [];
  public preprocessCalls: BaseEventRecord<any>[] = [];
  public postprocessCalls: BaseEventRecord<any>[] = [];

  constructor(processMode: 'record' | 'batch' = 'record') {
    super(new MockEventDataExtractor(), { processMode });
  }

  async initialize(_event: any, _context: any): Promise<void> {
    // Mock implementation
  }

  protected async processRecord(record: BaseEventRecord<any>): Promise<void> {
    this.processRecordCalls.push(record);
  }

  protected async processRecordsBatch(records: BaseEventRecord<any>[]): Promise<void> {
    this.processRecordsBatchCalls.push(records);
  }

  protected async preprocessRecord(record: BaseEventRecord<any>): Promise<BaseEventRecord<any> | null> {
    this.preprocessCalls.push(record);
    return record; // Accept all records
  }

  protected async postprocessRecord(record: BaseEventRecord<any>): Promise<void> {
    this.postprocessCalls.push(record);
  }

  // Public method to override preprocessRecord for testing
  public setPreprocessFilter(filter: (record: BaseEventRecord<any>) => boolean) {
    this.preprocessRecord = async (record: BaseEventRecord<any>) => {
      this.preprocessCalls.push(record);
      return filter(record) ? record : null;
    };
  }
}

describe('BaseSQSEventProcessor', () => {
  let processor: TestSQSEventProcessor;
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
  });

  describe('Constructor', () => {
    it('should initialize with default record mode', () => {
      processor = new TestSQSEventProcessor();
      expect(processor['processMode']).toBe('record');
    });

    it('should initialize with batch mode when specified', () => {
      processor = new TestSQSEventProcessor('batch');
      expect(processor['processMode']).toBe('batch');
    });

    it('should throw error when extractor is not provided', () => {
      expect(() => {
        new (class extends BaseSQSEventProcessor<any> {
          async initialize(): Promise<void> {}
          protected async processRecord(): Promise<void> {}
          protected async processRecordsBatch(): Promise<void> {}
        })(null as any);
      }).toThrow('IEventDataExtractor is required for BaseSQSEventProcessor');
    });
  });

  describe('Record Mode Processing', () => {
    beforeEach(() => {
      processor = new TestSQSEventProcessor('record');
    });

    it('should process records individually in record mode', async () => {
      await processor.process(mockSQSEvent, {} as any);

      expect(processor.processRecordCalls).toHaveLength(2);
      expect(processor.processRecordsBatchCalls).toHaveLength(0);
      expect(processor.preprocessCalls).toHaveLength(2);
      expect(processor.postprocessCalls).toHaveLength(2);

      expect(processor.processRecordCalls[0].entityName).toBe('entity-0');
      expect(processor.processRecordCalls[1].entityName).toBe('entity-1');
    });

    it('should handle empty records array', async () => {
      const emptyEvent: SQSEvent = { Records: [] };
      await processor.process(emptyEvent, {} as any);

      expect(processor.processRecordCalls).toHaveLength(0);
      expect(processor.processRecordsBatchCalls).toHaveLength(0);
    });

    it('should filter out records during preprocessing', async () => {
      // Use the public method to set filter
      processor.setPreprocessFilter((record) => record.entityName === 'entity-0');

      await processor.process(mockSQSEvent, {} as any);

      expect(processor.processRecordCalls).toHaveLength(1);
      expect(processor.processRecordCalls[0].entityName).toBe('entity-0');
    });
  });

  describe('Batch Mode Processing', () => {
    beforeEach(() => {
      processor = new TestSQSEventProcessor('batch');
    });

    it('should process records in batch mode', async () => {
      await processor.process(mockSQSEvent, {} as any);

      expect(processor.processRecordCalls).toHaveLength(0);
      expect(processor.processRecordsBatchCalls).toHaveLength(1);
      expect(processor.preprocessCalls).toHaveLength(2);
      expect(processor.postprocessCalls).toHaveLength(2);

      const batchCall = processor.processRecordsBatchCalls[0];
      expect(batchCall).toHaveLength(2);
      expect(batchCall[0].entityName).toBe('entity-0');
      expect(batchCall[1].entityName).toBe('entity-1');
    });

    it('should handle empty records array in batch mode', async () => {
      const emptyEvent: SQSEvent = { Records: [] };
      await processor.process(emptyEvent, {} as any);

      expect(processor.processRecordCalls).toHaveLength(0);
      expect(processor.processRecordsBatchCalls).toHaveLength(0);
    });

    it('should filter out records during preprocessing in batch mode', async () => {
      // Use the public method to set filter
      processor.setPreprocessFilter((record) => record.entityName === 'entity-0');

      await processor.process(mockSQSEvent, {} as any);

      expect(processor.processRecordCalls).toHaveLength(0);
      expect(processor.processRecordsBatchCalls).toHaveLength(1);
      expect(processor.processRecordsBatchCalls[0]).toHaveLength(1);
      expect(processor.processRecordsBatchCalls[0][0].entityName).toBe('entity-0');
    });
  });

  describe('LambdaHandler', () => {
    beforeEach(() => {
      processor = new TestSQSEventProcessor('record');
    });

    it('should call initialize and process', async () => {
      const initializeSpy = jest.spyOn(processor, 'initialize');
      const processSpy = jest.spyOn(processor, 'process');

      const mockContext = {
        callbackWaitsForEmptyEventLoop: true,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '128',
        awsRequestId: 'test-request-id',
        logGroupName: 'test-log-group',
        logStreamName: 'test-log-stream',
        getRemainingTimeInMillis: () => 30000,
        done: () => {},
        fail: () => {},
        succeed: () => {}
      };

      await processor.LambdaHandler(mockSQSEvent, mockContext);

      expect(initializeSpy).toHaveBeenCalledWith(mockSQSEvent, mockContext);
      expect(processSpy).toHaveBeenCalledWith(mockSQSEvent, mockContext);
    });
  });

  describe('Performance Tracking', () => {
    it('should track processing time in record mode', async () => {
      processor = new TestSQSEventProcessor('record');
      const startTime = Date.now();
      
      await processor.process(mockSQSEvent, {} as any);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time (less than 1 second)
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(1000);
      
      // Should have processed the expected number of records
      expect(processor.processRecordCalls).toHaveLength(2);
    });

    it('should track processing time in batch mode', async () => {
      processor = new TestSQSEventProcessor('batch');
      const startTime = Date.now();
      
      await processor.process(mockSQSEvent, {} as any);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time (less than 1 second)
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(1000);
      
      // Should have processed records in batch mode
      expect(processor.processRecordsBatchCalls).toHaveLength(1);
      expect(processor.processRecordsBatchCalls[0]).toHaveLength(2);
    });
  });
});
