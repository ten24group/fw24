import { ObservabilityEvent, ObservabilityLevel } from '../types';

// Mock storage for logger calls
const loggerCalls = {
  warn: [] as any[],
  error: [] as any[],
  debug: [] as any[],
  info: [] as any[],
};

// Mock the logger BEFORE any imports that use it
jest.mock('../../logging', () => ({
  createLogger: () => ({
    warn: (...args: any[]) => loggerCalls.warn.push(args),
    error: (...args: any[]) => loggerCalls.error.push(args),
    debug: (...args: any[]) => loggerCalls.debug.push(args),
    info: (...args: any[]) => loggerCalls.info.push(args),
  }),
}));

// Mock the decorators and DI
jest.mock('../../di', () => ({
  Inject: () => () => { },
  Injectable: () => (target: any) => target,
  InjectConfig: () => () => { },
}));

// Mock payload utils
jest.mock('../utils/payload', () => ({
  estimateItemSize: () => 1000, // Small size, always valid
  truncatePayload: (v: any) => v,
}));

// Mock the service import
jest.mock('../storage/service', () => ({
  ObservabilityLogService: class MockService { },
}));

// Now import the backend after mocks are set up
import { DynamoDBObservabilityBackend } from './dynamodb';

describe('DynamoDBObservabilityBackend', () => {
  let backend: DynamoDBObservabilityBackend;
  let mockBatchCreate: jest.Mock;

  beforeEach(() => {
    // Clear logger calls
    loggerCalls.warn = [];
    loggerCalls.error = [];
    loggerCalls.debug = [];
    loggerCalls.info = [];

    // Create mock service
    mockBatchCreate = jest.fn().mockResolvedValue(undefined);
    const mockService = {
      batchCreate: mockBatchCreate,
    };

    // Create backend with mocked service using constructor directly
    // Cast to any to bypass DI decorator requirements
    backend = Object.create(DynamoDBObservabilityBackend.prototype) as DynamoDBObservabilityBackend;
    (backend as any).service = mockService;
    (backend as any).name = 'dynamodb';
    (backend as any).buffer = [];

    (backend as any).config = {
      ttlDays: 7,
      minLevel: ObservabilityLevel.INFO,
      maxBatchSize: 25,
      maxBufferSize: 1000,
      maxItemSize: 400 * 1024,
    };


    backend.initializeInvocation();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Deduplication Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deduplication', () => {
    it('should deduplicate events with same observabilityLogId', async () => {
      const event1 = createTestEvent({
        observabilityLogId: 'same-id',
        type: 'audit.create', // NOT span.start which is now skipped
      });
      const event2 = createTestEvent({
        observabilityLogId: 'same-id',
        type: 'span',
      });
      const event3 = createTestEvent({
        observabilityLogId: 'different-id',
        type: 'log',
      });

      await backend.capture(event1);
      await backend.capture(event2);
      await backend.capture(event3);
      await backend.flush();

      // Should have called batchCreate once
      expect(mockBatchCreate).toHaveBeenCalledTimes(1);

      // Should have deduplicated - only 2 unique items
      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(2);

      // First occurrence wins
      const ids = createdItems.map((item: any) => item.observabilityLogId);
      expect(ids).toContain('same-id');
      expect(ids).toContain('different-id');

      // Should have logged error about invariant violation (duplicates)
      const duplicateError = loggerCalls.error.find(
        call => call[ 0 ] === 'Observability invariant violation: duplicate observabilityLogId(s) in a single DynamoDB batch.'
      );
      expect(duplicateError).toBeDefined();
      expect(duplicateError[ 1 ]).toMatchObject({
        duplicateIdCount: 1,
        totalItems: 3,
        deduplicatedCount: 2,
      });
    });

    it('should not log warning when no duplicates exist', async () => {
      const event1 = createTestEvent({ observabilityLogId: 'id-1', type: 'span' });
      const event2 = createTestEvent({ observabilityLogId: 'id-2', type: 'log' });
      const event3 = createTestEvent({ observabilityLogId: 'id-3', type: 'audit' });

      await backend.capture(event1);
      await backend.capture(event2);
      await backend.capture(event3);
      await backend.flush();

      expect(mockBatchCreate).toHaveBeenCalledTimes(1);
      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(3);

      // Should NOT log duplicate error
      const duplicateError = loggerCalls.error.find(
        call => call[ 0 ] === 'Observability invariant violation: duplicate observabilityLogId(s) in a single DynamoDB batch.'
      );
      expect(duplicateError).toBeUndefined();
    });

    it('should handle multiple duplicates correctly', async () => {
      // 3 events with same ID (NOT span.start which is skipped)
      await backend.capture(createTestEvent({ observabilityLogId: 'dup-id', type: 'audit.create' }));
      await backend.capture(createTestEvent({ observabilityLogId: 'dup-id', type: 'span' }));
      await backend.capture(createTestEvent({ observabilityLogId: 'dup-id', type: 'log' }));
      // 2 unique events
      await backend.capture(createTestEvent({ observabilityLogId: 'unique-1', type: 'log' }));
      await backend.capture(createTestEvent({ observabilityLogId: 'unique-2', type: 'metric' }));

      await backend.flush();

      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(3); // 1 from dup-id + 2 unique

      // Verify error includes correct counts (unique duplicate ids, not total extra occurrences)
      const duplicateError = loggerCalls.error.find(
        call => call[ 0 ] === 'Observability invariant violation: duplicate observabilityLogId(s) in a single DynamoDB batch.'
      );
      expect(duplicateError).toBeDefined();
      expect(duplicateError[ 1 ]).toMatchObject({
        duplicateIdCount: 1,
        totalItems: 5,
        deduplicatedCount: 3,
      });
    });

    it('should keep first occurrence when deduplicating', async () => {
      const firstEvent = createTestEvent({
        observabilityLogId: 'dup-id',
        type: 'audit.create', // NOT span.start which is skipped
        operation: 'first-operation',
      });
      const secondEvent = createTestEvent({
        observabilityLogId: 'dup-id',
        type: 'span',
        operation: 'second-operation',
      });

      await backend.capture(firstEvent);
      await backend.capture(secondEvent);
      await backend.flush();

      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(1);
      expect(createdItems[ 0 ].operation).toBe('first-operation');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // span.start Detection Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('span.start Filtering', () => {
    it('should skip span.start events and not buffer them', async () => {
      const spanStartEvent = createTestEvent({
        observabilityLogId: 'span-id',
        type: 'span.start',
        operation: 'test-operation',
        capture: { backends: [ 'otel' ] },
      });

      await backend.capture(spanStartEvent);
      await backend.flush();

      // span.start should NOT be written to DynamoDB
      expect(mockBatchCreate).not.toHaveBeenCalled();

      // Should log debug (not warn) when skipping
      const skipLog = loggerCalls.debug.find(
        call => call[ 0 ] === 'Skipping span.start event in DynamoDB backend'
      );
      expect(skipLog).toBeDefined();
      expect(skipLog[ 1 ]).toMatchObject({
        observabilityLogId: 'span-id',
        operation: 'test-operation',
      });
    });

    it('should buffer and write span (consolidated) events normally', async () => {
      const spanEvent = createTestEvent({
        observabilityLogId: 'span-id',
        type: 'span',
        operation: 'test-operation',
      });

      await backend.capture(spanEvent);
      await backend.flush();

      // span (consolidated) events SHOULD be written
      expect(mockBatchCreate).toHaveBeenCalled();
      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(1);
      expect(createdItems[ 0 ].observabilityLogId).toBe('span-id');
    });

    it('should not log warning for regular log events', async () => {
      const logEvent = createTestEvent({
        observabilityLogId: 'log-id',
        type: 'log',
      });

      await backend.capture(logEvent);

      const spanStartWarning = loggerCalls.warn.find(
        call => call[ 0 ] === 'span.start event reached DynamoDB backend - should have been filtered:'
      );
      expect(spanStartWarning).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Missing ID Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Missing observabilityLogId', () => {
    it('should skip items without observabilityLogId', async () => {
      const eventWithId = createTestEvent({ observabilityLogId: 'valid-id', type: 'log' });
      const eventWithoutId = { ...createTestEvent({ type: 'log' }) };
      delete (eventWithoutId as any).observabilityLogId;

      await backend.capture(eventWithId);
      await backend.capture(eventWithoutId as any);
      await backend.flush();

      expect(mockBatchCreate).toHaveBeenCalledTimes(1);
      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(1);
      expect(createdItems[ 0 ].observabilityLogId).toBe('valid-id');

      const missingIdWarning = loggerCalls.warn.find(
        call => call[ 0 ] === 'Item missing observabilityLogId, skipping'
      );
      expect(missingIdWarning).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Batching Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Batching', () => {
    it('should auto-flush when batch size reached', async () => {
      // Add 25 events (DYNAMO_BATCH_SIZE)
      for (let i = 0; i < 25; i++) {
        await backend.capture(createTestEvent({
          observabilityLogId: `id-${i}`,
          type: 'log',
        }));
      }

      // Should have auto-flushed
      expect(mockBatchCreate).toHaveBeenCalledTimes(1);
      const createdItems = mockBatchCreate.mock.calls[ 0 ][ 0 ];
      expect(createdItems).toHaveLength(25);
    });

    it('should handle empty buffer gracefully', async () => {
      await backend.flush();
      expect(mockBatchCreate).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Handling Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Error Handling', () => {
    it('should log error when batch write fails', async () => {
      mockBatchCreate.mockRejectedValueOnce(new Error('DynamoDB error'));

      await backend.capture(createTestEvent({
        observabilityLogId: 'id-1',
        type: 'log',
      }));
      await backend.flush();

      const errorLog = loggerCalls.error.find(
        call => call[ 0 ] === 'DynamoDB batch write failed:'
      );
      expect(errorLog).toBeDefined();
      expect(errorLog[ 1 ]).toMatchObject({
        error: 'DynamoDB error',
        eventCount: 1,
      });
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('Throttling');
      (retryableError as any).name = 'ThrottlingException';

      mockBatchCreate
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce(undefined);

      await backend.capture(createTestEvent({
        observabilityLogId: 'id-1',
        type: 'log',
      }));
      await backend.flush();

      // Should have retried
      expect(mockBatchCreate).toHaveBeenCalledTimes(2);

      const retryWarning = loggerCalls.warn.find(
        call => typeof call[ 0 ] === 'string' && call[ 0 ].includes('DynamoDB transient error, retrying')
      );
      expect(retryWarning).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

function createTestEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    observabilityLogId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: 'test-correlation-id',
    type: 'log',
    level: 'info',
    timestampMs: Date.now(),
    ...overrides,
  };
}
