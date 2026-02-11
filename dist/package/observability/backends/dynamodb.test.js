"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../types");
// Mock storage for logger calls
const loggerCalls = {
    warn: [],
    error: [],
    debug: [],
    info: [],
};
// Mock the logger BEFORE any imports that use it
jest.mock('../../logging', () => ({
    createLogger: () => ({
        warn: (...args) => loggerCalls.warn.push(args),
        error: (...args) => loggerCalls.error.push(args),
        debug: (...args) => loggerCalls.debug.push(args),
        info: (...args) => loggerCalls.info.push(args),
    }),
}));
// Mock the decorators and DI
jest.mock('../../di', () => ({
    Inject: () => () => { },
    Injectable: () => (target) => target,
    InjectConfig: () => () => { },
}));
// Mock payload utils
jest.mock('../utils/payload', () => ({
    estimateItemSize: () => 1000, // Small size, always valid
    truncatePayload: (v) => v,
}));
// Mock the service import
jest.mock('../storage/service', () => ({
    ObservabilityLogService: class MockService {
    },
}));
// Now import the backend after mocks are set up
const dynamodb_1 = require("./dynamodb");
describe('DynamoDBObservabilityBackend', () => {
    let backend;
    let mockBatchCreate;
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
        backend = Object.create(dynamodb_1.DynamoDBObservabilityBackend.prototype);
        backend.service = mockService;
        backend.name = 'dynamodb';
        backend.buffer = [];
        backend.config = {
            ttlDays: 7,
            minLevel: types_1.ObservabilityLevel.INFO,
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
            const createdItems = mockBatchCreate.mock.calls[0][0];
            expect(createdItems).toHaveLength(2);
            // First occurrence wins
            const ids = createdItems.map((item) => item.observabilityLogId);
            expect(ids).toContain('same-id');
            expect(ids).toContain('different-id');
            // Should have logged debug about deduplication
            const deduplicateLog = loggerCalls.debug.find(call => call[0] === 'Deduplicating observability events with same ID in batch (repeated operations).');
            expect(deduplicateLog).toBeDefined();
            expect(deduplicateLog[1]).toMatchObject({
                duplicateIdCount: 1,
                totalItems: 3,
                deduplicatedCount: 2,
            });
        });
        it('should not log when no duplicates exist', async () => {
            const event1 = createTestEvent({ observabilityLogId: 'id-1', type: 'span' });
            const event2 = createTestEvent({ observabilityLogId: 'id-2', type: 'log' });
            const event3 = createTestEvent({ observabilityLogId: 'id-3', type: 'audit' });
            await backend.capture(event1);
            await backend.capture(event2);
            await backend.capture(event3);
            await backend.flush();
            expect(mockBatchCreate).toHaveBeenCalledTimes(1);
            const createdItems = mockBatchCreate.mock.calls[0][0];
            expect(createdItems).toHaveLength(3);
            // Should NOT log deduplication message
            const deduplicateLog = loggerCalls.debug.find(call => call[0] === 'Deduplicating observability events with same ID in batch (repeated operations).');
            expect(deduplicateLog).toBeUndefined();
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
            const createdItems = mockBatchCreate.mock.calls[0][0];
            expect(createdItems).toHaveLength(3); // 1 from dup-id + 2 unique
            // Verify debug log includes correct counts
            const deduplicateLog = loggerCalls.debug.find(call => call[0] === 'Deduplicating observability events with same ID in batch (repeated operations).');
            expect(deduplicateLog).toBeDefined();
            expect(deduplicateLog[1]).toMatchObject({
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
            const createdItems = mockBatchCreate.mock.calls[0][0];
            expect(createdItems).toHaveLength(1);
            expect(createdItems[0].operation).toBe('first-operation');
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
                capture: { backends: ['otel'] },
            });
            await backend.capture(spanStartEvent);
            await backend.flush();
            // span.start should NOT be written to DynamoDB
            expect(mockBatchCreate).not.toHaveBeenCalled();
            // Should log debug (not warn) when skipping
            const skipLog = loggerCalls.debug.find(call => call[0] === 'Skipping span.start event in DynamoDB backend');
            expect(skipLog).toBeDefined();
            expect(skipLog[1]).toMatchObject({
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
            const createdItems = mockBatchCreate.mock.calls[0][0];
            expect(createdItems).toHaveLength(1);
            expect(createdItems[0].observabilityLogId).toBe('span-id');
        });
        it('should not log warning for regular log events', async () => {
            const logEvent = createTestEvent({
                observabilityLogId: 'log-id',
                type: 'log',
            });
            await backend.capture(logEvent);
            const spanStartWarning = loggerCalls.warn.find(call => call[0] === 'span.start event reached DynamoDB backend - should have been filtered:');
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
            delete eventWithoutId.observabilityLogId;
            await backend.capture(eventWithId);
            await backend.capture(eventWithoutId);
            await backend.flush();
            expect(mockBatchCreate).toHaveBeenCalledTimes(1);
            const createdItems = mockBatchCreate.mock.calls[0][0];
            expect(createdItems).toHaveLength(1);
            expect(createdItems[0].observabilityLogId).toBe('valid-id');
            const missingIdWarning = loggerCalls.warn.find(call => call[0] === 'Item missing observabilityLogId, skipping');
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
            const createdItems = mockBatchCreate.mock.calls[0][0];
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
            const errorLog = loggerCalls.error.find(call => call[0] === 'DynamoDB batch write failed:');
            expect(errorLog).toBeDefined();
            expect(errorLog[1]).toMatchObject({
                error: 'DynamoDB error',
                eventCount: 1,
            });
        });
        it('should retry on retryable errors', async () => {
            const retryableError = new Error('Throttling');
            retryableError.name = 'ThrottlingException';
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
            const retryWarning = loggerCalls.warn.find(call => typeof call[0] === 'string' && call[0].includes('DynamoDB transient error, retrying'));
            expect(retryWarning).toBeDefined();
        });
    });
});
// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════
function createTestEvent(overrides = {}) {
    return {
        observabilityLogId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        correlationId: 'test-correlation-id',
        type: 'log',
        level: 'info',
        timestampMs: Date.now(),
        ...overrides,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2R5bmFtb2RiLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxvQ0FBa0U7QUFFbEUsZ0NBQWdDO0FBQ2hDLE1BQU0sV0FBVyxHQUFHO0lBQ2xCLElBQUksRUFBRSxFQUFXO0lBQ2pCLEtBQUssRUFBRSxFQUFXO0lBQ2xCLEtBQUssRUFBRSxFQUFXO0lBQ2xCLElBQUksRUFBRSxFQUFXO0NBQ2xCLENBQUM7QUFFRixpREFBaUQ7QUFDakQsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUNoQyxZQUFZLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUNuQixJQUFJLEVBQUUsQ0FBQyxHQUFHLElBQVcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQ3JELEtBQUssRUFBRSxDQUFDLEdBQUcsSUFBVyxFQUFFLEVBQUUsQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDdkQsS0FBSyxFQUFFLENBQUMsR0FBRyxJQUFXLEVBQUUsRUFBRSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztRQUN2RCxJQUFJLEVBQUUsQ0FBQyxHQUFHLElBQVcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0tBQ3RELENBQUM7Q0FDSCxDQUFDLENBQUMsQ0FBQztBQUVKLDZCQUE2QjtBQUM3QixJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQzNCLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDO0lBQ3ZCLFVBQVUs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QUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUM7QUFFSCw4RUFBOEU7QUFDOUUsZUFBZTtBQUNmLDhFQUE4RTtBQUU5RSxTQUFTLGVBQWUsQ0FBQyxZQUF5QyxFQUFFO0lBQ2xFLE9BQU87UUFDTCxrQkFBa0IsRUFBRSxRQUFRLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRTtRQUMvRSxhQUFhLEVBQUUscUJBQXFCO1FBQ3BDLElBQUksRUFBRSxLQUFLO1FBQ1gsS0FBSyxFQUFFLE1BQU07UUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUN2QixHQUFHLFNBQVM7S0FDYixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuXG4vLyBNb2NrIHN0b3JhZ2UgZm9yIGxvZ2dlciBjYWxsc1xuY29uc3QgbG9nZ2VyQ2FsbHMgPSB7XG4gIHdhcm46IFtdIGFzIGFueVtdLFxuICBlcnJvcjogW10gYXMgYW55W10sXG4gIGRlYnVnOiBbXSBhcyBhbnlbXSxcbiAgaW5mbzogW10gYXMgYW55W10sXG59O1xuXG4vLyBNb2NrIHRoZSBsb2dnZXIgQkVGT1JFIGFueSBpbXBvcnRzIHRoYXQgdXNlIGl0XG5qZXN0Lm1vY2soJy4uLy4uL2xvZ2dpbmcnLCAoKSA9PiAoe1xuICBjcmVhdGVMb2dnZXI6ICgpID0+ICh7XG4gICAgd2FybjogKC4uLmFyZ3M6IGFueVtdKSA9PiBsb2dnZXJDYWxscy53YXJuLnB1c2goYXJncyksXG4gICAgZXJyb3I6ICguLi5hcmdzOiBhbnlbXSkgPT4gbG9nZ2VyQ2FsbHMuZXJyb3IucHVzaChhcmdzKSxcbiAgICBkZWJ1ZzogKC4uLmFyZ3M6IGFueVtdKSA9PiBsb2dnZXJDYWxscy5kZWJ1Zy5wdXNoKGFyZ3MpLFxuICAgIGluZm86ICguLi5hcmdzOiBhbnlbXSkgPT4gbG9nZ2VyQ2FsbHMuaW5mby5wdXNoKGFyZ3MpLFxuICB9KSxcbn0pKTtcblxuLy8gTW9jayB0aGUgZGVjb3JhdG9ycyBhbmQgRElcbmplc3QubW9jaygnLi4vLi4vZGknLCAoKSA9PiAoe1xuICBJbmplY3Q6ICgpID0+ICgpID0+IHsgfSxcbiAgSW5qZWN0YWJsZTogKCkgPT4gKHRhcmdldDogYW55KSA9PiB0YXJnZXQsXG4gIEluamVjdENvbmZpZzogKCkgPT4gKCkgPT4geyB9LFxufSkpO1xuXG4vLyBNb2NrIHBheWxvYWQgdXRpbHNcbmplc3QubW9jaygnLi4vdXRpbHMvcGF5bG9hZCcsICgpID0+ICh7XG4gIGVzdGltYXRlSXRlbVNpemU6ICgpID0+IDEwMDAsIC8vIFNtYWxsIHNpemUsIGFsd2F5cyB2YWxpZFxuICB0cnVuY2F0ZVBheWxvYWQ6ICh2OiBhbnkpID0+IHYsXG59KSk7XG5cbi8vIE1vY2sgdGhlIHNlcnZpY2UgaW1wb3J0XG5qZXN0Lm1vY2soJy4uL3N0b3JhZ2Uvc2VydmljZScsICgpID0+ICh7XG4gIE9ic2VydmFiaWxpdHlMb2dTZXJ2aWNlOiBjbGFzcyBNb2NrU2VydmljZSB7IH0sXG59KSk7XG5cbi8vIE5vdyBpbXBvcnQgdGhlIGJhY2tlbmQgYWZ0ZXIgbW9ja3MgYXJlIHNldCB1cFxuaW1wb3J0IHsgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vZHluYW1vZGInO1xuXG5kZXNjcmliZSgnRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCcsICgpID0+IHtcbiAgbGV0IGJhY2tlbmQ6IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQ7XG4gIGxldCBtb2NrQmF0Y2hDcmVhdGU6IGplc3QuTW9jaztcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAvLyBDbGVhciBsb2dnZXIgY2FsbHNcbiAgICBsb2dnZXJDYWxscy53YXJuID0gW107XG4gICAgbG9nZ2VyQ2FsbHMuZXJyb3IgPSBbXTtcbiAgICBsb2dnZXJDYWxscy5kZWJ1ZyA9IFtdO1xuICAgIGxvZ2dlckNhbGxzLmluZm8gPSBbXTtcblxuICAgIC8vIENyZWF0ZSBtb2NrIHNlcnZpY2VcbiAgICBtb2NrQmF0Y2hDcmVhdGUgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKTtcbiAgICBjb25zdCBtb2NrU2VydmljZSA9IHtcbiAgICAgIGJhdGNoQ3JlYXRlOiBtb2NrQmF0Y2hDcmVhdGUsXG4gICAgfTtcblxuICAgIC8vIENyZWF0ZSBiYWNrZW5kIHdpdGggbW9ja2VkIHNlcnZpY2UgdXNpbmcgY29uc3RydWN0b3IgZGlyZWN0bHlcbiAgICAvLyBDYXN0IHRvIGFueSB0byBieXBhc3MgREkgZGVjb3JhdG9yIHJlcXVpcmVtZW50c1xuICAgIGJhY2tlbmQgPSBPYmplY3QuY3JlYXRlKER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQucHJvdG90eXBlKSBhcyBEeW5hbW9EQk9ic2VydmFiaWxpdHlCYWNrZW5kO1xuICAgIChiYWNrZW5kIGFzIGFueSkuc2VydmljZSA9IG1vY2tTZXJ2aWNlO1xuICAgIChiYWNrZW5kIGFzIGFueSkubmFtZSA9ICdkeW5hbW9kYic7XG4gICAgKGJhY2tlbmQgYXMgYW55KS5idWZmZXIgPSBbXTtcblxuICAgIChiYWNrZW5kIGFzIGFueSkuY29uZmlnID0ge1xuICAgICAgdHRsRGF5czogNyxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgIG1heEJhdGNoU2l6ZTogMjUsXG4gICAgICBtYXhCdWZmZXJTaXplOiAxMDAwLFxuICAgICAgbWF4SXRlbVNpemU6IDQwMCAqIDEwMjQsXG4gICAgfTtcblxuXG4gICAgYmFja2VuZC5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICB9KTtcblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gRGVkdXBsaWNhdGlvbiBUZXN0c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnRGVkdXBsaWNhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGRlZHVwbGljYXRlIGV2ZW50cyB3aXRoIHNhbWUgb2JzZXJ2YWJpbGl0eUxvZ0lkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQxID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc2FtZS1pZCcsXG4gICAgICAgIHR5cGU6ICdhdWRpdC5jcmVhdGUnLCAvLyBOT1Qgc3Bhbi5zdGFydCB3aGljaCBpcyBub3cgc2tpcHBlZFxuICAgICAgfSk7XG4gICAgICBjb25zdCBldmVudDIgPSBjcmVhdGVUZXN0RXZlbnQoe1xuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzYW1lLWlkJyxcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBldmVudDMgPSBjcmVhdGVUZXN0RXZlbnQoe1xuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdkaWZmZXJlbnQtaWQnLFxuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQxKTtcbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudDIpO1xuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50Myk7XG4gICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG5cbiAgICAgIC8vIFNob3VsZCBoYXZlIGNhbGxlZCBiYXRjaENyZWF0ZSBvbmNlXG4gICAgICBleHBlY3QobW9ja0JhdGNoQ3JlYXRlKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XG5cbiAgICAgIC8vIFNob3VsZCBoYXZlIGRlZHVwbGljYXRlZCAtIG9ubHkgMiB1bmlxdWUgaXRlbXNcbiAgICAgIGNvbnN0IGNyZWF0ZWRJdGVtcyA9IG1vY2tCYXRjaENyZWF0ZS5tb2NrLmNhbGxzWyAwIF1bIDAgXTtcbiAgICAgIGV4cGVjdChjcmVhdGVkSXRlbXMpLnRvSGF2ZUxlbmd0aCgyKTtcblxuICAgICAgLy8gRmlyc3Qgb2NjdXJyZW5jZSB3aW5zXG4gICAgICBjb25zdCBpZHMgPSBjcmVhdGVkSXRlbXMubWFwKChpdGVtOiBhbnkpID0+IGl0ZW0ub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIGV4cGVjdChpZHMpLnRvQ29udGFpbignc2FtZS1pZCcpO1xuICAgICAgZXhwZWN0KGlkcykudG9Db250YWluKCdkaWZmZXJlbnQtaWQnKTtcblxuICAgICAgLy8gU2hvdWxkIGhhdmUgbG9nZ2VkIGRlYnVnIGFib3V0IGRlZHVwbGljYXRpb25cbiAgICAgIGNvbnN0IGRlZHVwbGljYXRlTG9nID0gbG9nZ2VyQ2FsbHMuZGVidWcuZmluZChcbiAgICAgICAgY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdEZWR1cGxpY2F0aW5nIG9ic2VydmFiaWxpdHkgZXZlbnRzIHdpdGggc2FtZSBJRCBpbiBiYXRjaCAocmVwZWF0ZWQgb3BlcmF0aW9ucykuJ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChkZWR1cGxpY2F0ZUxvZykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChkZWR1cGxpY2F0ZUxvZ1sgMSBdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgZHVwbGljYXRlSWRDb3VudDogMSxcbiAgICAgICAgdG90YWxJdGVtczogMyxcbiAgICAgICAgZGVkdXBsaWNhdGVkQ291bnQ6IDIsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbm90IGxvZyB3aGVuIG5vIGR1cGxpY2F0ZXMgZXhpc3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudDEgPSBjcmVhdGVUZXN0RXZlbnQoeyBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdpZC0xJywgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3QgZXZlbnQyID0gY3JlYXRlVGVzdEV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaWQtMicsIHR5cGU6ICdsb2cnIH0pO1xuICAgICAgY29uc3QgZXZlbnQzID0gY3JlYXRlVGVzdEV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaWQtMycsIHR5cGU6ICdhdWRpdCcgfSk7XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudDEpO1xuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50Mik7XG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQzKTtcbiAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcblxuICAgICAgZXhwZWN0KG1vY2tCYXRjaENyZWF0ZSkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xuICAgICAgY29uc3QgY3JlYXRlZEl0ZW1zID0gbW9ja0JhdGNoQ3JlYXRlLm1vY2suY2FsbHNbIDAgXVsgMCBdO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRJdGVtcykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgICAvLyBTaG91bGQgTk9UIGxvZyBkZWR1cGxpY2F0aW9uIG1lc3NhZ2VcbiAgICAgIGNvbnN0IGRlZHVwbGljYXRlTG9nID0gbG9nZ2VyQ2FsbHMuZGVidWcuZmluZChcbiAgICAgICAgY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdEZWR1cGxpY2F0aW5nIG9ic2VydmFiaWxpdHkgZXZlbnRzIHdpdGggc2FtZSBJRCBpbiBiYXRjaCAocmVwZWF0ZWQgb3BlcmF0aW9ucykuJ1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChkZWR1cGxpY2F0ZUxvZykudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbXVsdGlwbGUgZHVwbGljYXRlcyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyAzIGV2ZW50cyB3aXRoIHNhbWUgSUQgKE5PVCBzcGFuLnN0YXJ0IHdoaWNoIGlzIHNraXBwZWQpXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoY3JlYXRlVGVzdEV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZHVwLWlkJywgdHlwZTogJ2F1ZGl0LmNyZWF0ZScgfSkpO1xuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGNyZWF0ZVRlc3RFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ2R1cC1pZCcsIHR5cGU6ICdzcGFuJyB9KSk7XG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoY3JlYXRlVGVzdEV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZHVwLWlkJywgdHlwZTogJ2xvZycgfSkpO1xuICAgICAgLy8gMiB1bmlxdWUgZXZlbnRzXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoY3JlYXRlVGVzdEV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndW5pcXVlLTEnLCB0eXBlOiAnbG9nJyB9KSk7XG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoY3JlYXRlVGVzdEV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndW5pcXVlLTInLCB0eXBlOiAnbWV0cmljJyB9KSk7XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcblxuICAgICAgY29uc3QgY3JlYXRlZEl0ZW1zID0gbW9ja0JhdGNoQ3JlYXRlLm1vY2suY2FsbHNbIDAgXVsgMCBdO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRJdGVtcykudG9IYXZlTGVuZ3RoKDMpOyAvLyAxIGZyb20gZHVwLWlkICsgMiB1bmlxdWVcblxuICAgICAgLy8gVmVyaWZ5IGRlYnVnIGxvZyBpbmNsdWRlcyBjb3JyZWN0IGNvdW50c1xuICAgICAgY29uc3QgZGVkdXBsaWNhdGVMb2cgPSBsb2dnZXJDYWxscy5kZWJ1Zy5maW5kKFxuICAgICAgICBjYWxsID0+IGNhbGxbIDAgXSA9PT0gJ0RlZHVwbGljYXRpbmcgb2JzZXJ2YWJpbGl0eSBldmVudHMgd2l0aCBzYW1lIElEIGluIGJhdGNoIChyZXBlYXRlZCBvcGVyYXRpb25zKS4nXG4gICAgICApO1xuICAgICAgZXhwZWN0KGRlZHVwbGljYXRlTG9nKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGRlZHVwbGljYXRlTG9nWyAxIF0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBkdXBsaWNhdGVJZENvdW50OiAxLFxuICAgICAgICB0b3RhbEl0ZW1zOiA1LFxuICAgICAgICBkZWR1cGxpY2F0ZWRDb3VudDogMyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBrZWVwIGZpcnN0IG9jY3VycmVuY2Ugd2hlbiBkZWR1cGxpY2F0aW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZmlyc3RFdmVudCA9IGNyZWF0ZVRlc3RFdmVudCh7XG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2R1cC1pZCcsXG4gICAgICAgIHR5cGU6ICdhdWRpdC5jcmVhdGUnLCAvLyBOT1Qgc3Bhbi5zdGFydCB3aGljaCBpcyBza2lwcGVkXG4gICAgICAgIG9wZXJhdGlvbjogJ2ZpcnN0LW9wZXJhdGlvbicsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHNlY29uZEV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZHVwLWlkJyxcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246ICdzZWNvbmQtb3BlcmF0aW9uJyxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlyc3RFdmVudCk7XG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoc2Vjb25kRXZlbnQpO1xuICAgICAgYXdhaXQgYmFja2VuZC5mbHVzaCgpO1xuXG4gICAgICBjb25zdCBjcmVhdGVkSXRlbXMgPSBtb2NrQmF0Y2hDcmVhdGUubW9jay5jYWxsc1sgMCBdWyAwIF07XG4gICAgICBleHBlY3QoY3JlYXRlZEl0ZW1zKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoY3JlYXRlZEl0ZW1zWyAwIF0ub3BlcmF0aW9uKS50b0JlKCdmaXJzdC1vcGVyYXRpb24nKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIHNwYW4uc3RhcnQgRGV0ZWN0aW9uIFRlc3RzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGRlc2NyaWJlKCdzcGFuLnN0YXJ0IEZpbHRlcmluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHNraXAgc3Bhbi5zdGFydCBldmVudHMgYW5kIG5vdCBidWZmZXIgdGhlbScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNwYW5TdGFydEV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc3Bhbi1pZCcsXG4gICAgICAgIHR5cGU6ICdzcGFuLnN0YXJ0JyxcbiAgICAgICAgb3BlcmF0aW9uOiAndGVzdC1vcGVyYXRpb24nLFxuICAgICAgICBjYXB0dXJlOiB7IGJhY2tlbmRzOiBbICdvdGVsJyBdIH0sXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKHNwYW5TdGFydEV2ZW50KTtcbiAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcblxuICAgICAgLy8gc3Bhbi5zdGFydCBzaG91bGQgTk9UIGJlIHdyaXR0ZW4gdG8gRHluYW1vREJcbiAgICAgIGV4cGVjdChtb2NrQmF0Y2hDcmVhdGUpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG5cbiAgICAgIC8vIFNob3VsZCBsb2cgZGVidWcgKG5vdCB3YXJuKSB3aGVuIHNraXBwaW5nXG4gICAgICBjb25zdCBza2lwTG9nID0gbG9nZ2VyQ2FsbHMuZGVidWcuZmluZChcbiAgICAgICAgY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdTa2lwcGluZyBzcGFuLnN0YXJ0IGV2ZW50IGluIER5bmFtb0RCIGJhY2tlbmQnXG4gICAgICApO1xuICAgICAgZXhwZWN0KHNraXBMb2cpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc2tpcExvZ1sgMSBdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc3Bhbi1pZCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qtb3BlcmF0aW9uJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBidWZmZXIgYW5kIHdyaXRlIHNwYW4gKGNvbnNvbGlkYXRlZCkgZXZlbnRzIG5vcm1hbGx5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3BhbkV2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc3Bhbi1pZCcsXG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb3BlcmF0aW9uOiAndGVzdC1vcGVyYXRpb24nLFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShzcGFuRXZlbnQpO1xuICAgICAgYXdhaXQgYmFja2VuZC5mbHVzaCgpO1xuXG4gICAgICAvLyBzcGFuIChjb25zb2xpZGF0ZWQpIGV2ZW50cyBTSE9VTEQgYmUgd3JpdHRlblxuICAgICAgZXhwZWN0KG1vY2tCYXRjaENyZWF0ZSkudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgY29uc3QgY3JlYXRlZEl0ZW1zID0gbW9ja0JhdGNoQ3JlYXRlLm1vY2suY2FsbHNbIDAgXVsgMCBdO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRJdGVtcykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRJdGVtc1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgnc3Bhbi1pZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBub3QgbG9nIHdhcm5pbmcgZm9yIHJlZ3VsYXIgbG9nIGV2ZW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGxvZ0V2ZW50ID0gY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbG9nLWlkJyxcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGxvZ0V2ZW50KTtcblxuICAgICAgY29uc3Qgc3BhblN0YXJ0V2FybmluZyA9IGxvZ2dlckNhbGxzLndhcm4uZmluZChcbiAgICAgICAgY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdzcGFuLnN0YXJ0IGV2ZW50IHJlYWNoZWQgRHluYW1vREIgYmFja2VuZCAtIHNob3VsZCBoYXZlIGJlZW4gZmlsdGVyZWQ6J1xuICAgICAgKTtcbiAgICAgIGV4cGVjdChzcGFuU3RhcnRXYXJuaW5nKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBNaXNzaW5nIElEIFRlc3RzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGRlc2NyaWJlKCdNaXNzaW5nIG9ic2VydmFiaWxpdHlMb2dJZCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHNraXAgaXRlbXMgd2l0aG91dCBvYnNlcnZhYmlsaXR5TG9nSWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudFdpdGhJZCA9IGNyZWF0ZVRlc3RFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3ZhbGlkLWlkJywgdHlwZTogJ2xvZycgfSk7XG4gICAgICBjb25zdCBldmVudFdpdGhvdXRJZCA9IHsgLi4uY3JlYXRlVGVzdEV2ZW50KHsgdHlwZTogJ2xvZycgfSkgfTtcbiAgICAgIGRlbGV0ZSAoZXZlbnRXaXRob3V0SWQgYXMgYW55KS5vYnNlcnZhYmlsaXR5TG9nSWQ7XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudFdpdGhJZCk7XG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnRXaXRob3V0SWQgYXMgYW55KTtcbiAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcblxuICAgICAgZXhwZWN0KG1vY2tCYXRjaENyZWF0ZSkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xuICAgICAgY29uc3QgY3JlYXRlZEl0ZW1zID0gbW9ja0JhdGNoQ3JlYXRlLm1vY2suY2FsbHNbIDAgXVsgMCBdO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRJdGVtcykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNyZWF0ZWRJdGVtc1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgndmFsaWQtaWQnKTtcblxuICAgICAgY29uc3QgbWlzc2luZ0lkV2FybmluZyA9IGxvZ2dlckNhbGxzLndhcm4uZmluZChcbiAgICAgICAgY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdJdGVtIG1pc3Npbmcgb2JzZXJ2YWJpbGl0eUxvZ0lkLCBza2lwcGluZydcbiAgICAgICk7XG4gICAgICBleHBlY3QobWlzc2luZ0lkV2FybmluZykudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEJhdGNoaW5nIFRlc3RzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGRlc2NyaWJlKCdCYXRjaGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGF1dG8tZmx1c2ggd2hlbiBiYXRjaCBzaXplIHJlYWNoZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBBZGQgMjUgZXZlbnRzIChEWU5BTU9fQkFUQ0hfU0laRSlcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMjU7IGkrKykge1xuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoY3JlYXRlVGVzdEV2ZW50KHtcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBpZC0ke2l9YCxcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgfSkpO1xuICAgICAgfVxuXG4gICAgICAvLyBTaG91bGQgaGF2ZSBhdXRvLWZsdXNoZWRcbiAgICAgIGV4cGVjdChtb2NrQmF0Y2hDcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcbiAgICAgIGNvbnN0IGNyZWF0ZWRJdGVtcyA9IG1vY2tCYXRjaENyZWF0ZS5tb2NrLmNhbGxzWyAwIF1bIDAgXTtcbiAgICAgIGV4cGVjdChjcmVhdGVkSXRlbXMpLnRvSGF2ZUxlbmd0aCgyNSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBidWZmZXIgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcbiAgICAgIGV4cGVjdChtb2NrQmF0Y2hDcmVhdGUpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAvLyBFcnJvciBIYW5kbGluZyBUZXN0c1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBsb2cgZXJyb3Igd2hlbiBiYXRjaCB3cml0ZSBmYWlscycsIGFzeW5jICgpID0+IHtcbiAgICAgIG1vY2tCYXRjaENyZWF0ZS5tb2NrUmVqZWN0ZWRWYWx1ZU9uY2UobmV3IEVycm9yKCdEeW5hbW9EQiBlcnJvcicpKTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGNyZWF0ZVRlc3RFdmVudCh7XG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2lkLTEnLFxuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIH0pKTtcbiAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcblxuICAgICAgY29uc3QgZXJyb3JMb2cgPSBsb2dnZXJDYWxscy5lcnJvci5maW5kKFxuICAgICAgICBjYWxsID0+IGNhbGxbIDAgXSA9PT0gJ0R5bmFtb0RCIGJhdGNoIHdyaXRlIGZhaWxlZDonXG4gICAgICApO1xuICAgICAgZXhwZWN0KGVycm9yTG9nKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGVycm9yTG9nWyAxIF0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICBlcnJvcjogJ0R5bmFtb0RCIGVycm9yJyxcbiAgICAgICAgZXZlbnRDb3VudDogMSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXRyeSBvbiByZXRyeWFibGUgZXJyb3JzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmV0cnlhYmxlRXJyb3IgPSBuZXcgRXJyb3IoJ1Rocm90dGxpbmcnKTtcbiAgICAgIChyZXRyeWFibGVFcnJvciBhcyBhbnkpLm5hbWUgPSAnVGhyb3R0bGluZ0V4Y2VwdGlvbic7XG5cbiAgICAgIG1vY2tCYXRjaENyZWF0ZVxuICAgICAgICAubW9ja1JlamVjdGVkVmFsdWVPbmNlKHJldHJ5YWJsZUVycm9yKVxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHVuZGVmaW5lZCk7XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShjcmVhdGVUZXN0RXZlbnQoe1xuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdpZC0xJyxcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICB9KSk7XG4gICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG5cbiAgICAgIC8vIFNob3VsZCBoYXZlIHJldHJpZWRcbiAgICAgIGV4cGVjdChtb2NrQmF0Y2hDcmVhdGUpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcblxuICAgICAgY29uc3QgcmV0cnlXYXJuaW5nID0gbG9nZ2VyQ2FsbHMud2Fybi5maW5kKFxuICAgICAgICBjYWxsID0+IHR5cGVvZiBjYWxsWyAwIF0gPT09ICdzdHJpbmcnICYmIGNhbGxbIDAgXS5pbmNsdWRlcygnRHluYW1vREIgdHJhbnNpZW50IGVycm9yLCByZXRyeWluZycpXG4gICAgICApO1xuICAgICAgZXhwZWN0KHJldHJ5V2FybmluZykudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBUZXN0IEhlbHBlcnNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5mdW5jdGlvbiBjcmVhdGVUZXN0RXZlbnQob3ZlcnJpZGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4gPSB7fSk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gIHJldHVybiB7XG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgdGVzdC0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMil9YCxcbiAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgdHlwZTogJ2xvZycsXG4gICAgbGV2ZWw6ICdpbmZvJyxcbiAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAuLi5vdmVycmlkZXMsXG4gIH07XG59XG4iXX0=