"use strict";
/**
 * Testing utilities for observability
 *
 * Provides helpers for testing code that uses the observability system.
 *
 * Usage:
 * ```typescript
 * import {
 *   MockBackend,
 *   setupTestObservability,
 *   assertEventCaptured,
 *   createTestContext
 * } from '@ten24group/fw24/observability/testing';
 *
 * describe('MyService', () => {
 *   let mockBackend: MockBackend;
 *
 *   beforeEach(() => {
 *     mockBackend = setupTestObservability();
 *   });
 *
 *   afterEach(() => {
 *     mockBackend.reset();
 *   });
 *
 *   it('should audit user creation', async () => {
 *     await createTestContext(async () => {
 *       await service.createUser({ name: 'Test' });
 *
 *       assertEventCaptured(mockBackend, {
 *         type: 'audit.entity',
 *         subType: 'create',
 *         entityName: 'User',
 *       });
 *     });
 *   });
 * });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockBackend = void 0;
exports.setupTestObservability = setupTestObservability;
exports.cleanupTestObservability = cleanupTestObservability;
exports.createTestContext = createTestContext;
exports.createTestContextSync = createTestContextSync;
exports.assertEventCaptured = assertEventCaptured;
exports.assertNoEventCaptured = assertNoEventCaptured;
exports.assertEventCount = assertEventCount;
exports.createTestActor = createTestActor;
exports.createTestExecutionContext = createTestExecutionContext;
const crypto_1 = require("crypto");
const types_1 = require("../types");
const manager_1 = require("../manager");
const config_1 = require("../config");
const context_1 = require("../context");
const source_utils_1 = require("../utils/source-utils");
/**
 * Mock backend that captures all events for testing
 */
class MockBackend {
    name = 'mock';
    minLevel;
    events = [];
    flushCount = 0;
    invocationCount = 0;
    constructor(options) {
        this.minLevel = options?.minLevel;
    }
    async capture(event) {
        this.events.push({ ...event });
    }
    async flush() {
        this.flushCount++;
    }
    initializeInvocation() {
        this.invocationCount++;
    }
    // === Test Helpers ===
    /**
     * Get all captured events
     */
    getEvents() {
        return [...this.events];
    }
    /**
     * Get events matching a filter
     */
    getEventsMatching(filter) {
        return this.events.filter(event => {
            for (const [key, value] of Object.entries(filter)) {
                if (event[key] !== value) {
                    return false;
                }
            }
            return true;
        });
    }
    /**
     * Get events by type
     */
    getEventsByType(type) {
        return this.events.filter(e => e.type === type);
    }
    /**
     * Get events by level
     */
    getEventsByLevel(level) {
        return this.events.filter(e => e.level === level);
    }
    /**
     * Get the last captured event
     */
    getLastEvent() {
        return this.events[this.events.length - 1];
    }
    /**
     * Check if any event matches the filter
     */
    hasEvent(filter) {
        return this.getEventsMatching(filter).length > 0;
    }
    /**
     * Get number of flush calls
     */
    getFlushCount() {
        return this.flushCount;
    }
    /**
     * Get number of invocation initializations
     */
    getInvocationCount() {
        return this.invocationCount;
    }
    /**
     * Clear all captured events and counters
     */
    reset() {
        this.events = [];
        this.flushCount = 0;
        this.invocationCount = 0;
    }
    /**
     * Get event count
     */
    get eventCount() {
        return this.events.length;
    }
}
exports.MockBackend = MockBackend;
/**
 * Set up observability for testing
 *
 * @returns MockBackend instance for assertions
 */
function setupTestObservability(options) {
    // Reset manager state
    manager_1.ObservabilityManager.reset();
    // Clear cached environment tags
    (0, source_utils_1.clearEnvironmentTagsCache)();
    // Create mock backend
    const mockBackend = new MockBackend({ minLevel: options?.minLevel });
    // Initialize for testing with mock backend
    // By default, disable skipEmpty and minDurationMs for testing so all spans are captured
    manager_1.ObservabilityManager.initializeForTesting((0, config_1.createObservabilityConfig)({
        enabled: options?.enabled ?? true,
        minLevel: options?.minLevel ?? types_1.ObservabilityLevel.TRACE,
        spans: {
            skipEmpty: options?.skipEmptySpans ?? false, // Default false for testing
            minDurationMs: options?.minSpanDurationMs ?? 0, // Default 0 for testing - capture all spans
        },
    }), [mockBackend]);
    return mockBackend;
}
/**
 * Clean up test observability (call in afterEach)
 */
function cleanupTestObservability() {
    manager_1.ObservabilityManager.reset();
    (0, source_utils_1.clearEnvironmentTagsCache)();
}
/**
 * Create a test execution context and run a function within it
 */
async function createTestContext(fn, options) {
    const context = (0, context_1.createExecutionContext)({
        correlationId: options?.correlationId ?? `test-${(0, crypto_1.randomUUID)()}`,
        causedBy: options?.causedBy,
        actor: options?.actor,
        tags: options?.tags,
    });
    return (0, context_1.runWithExecutionContext)(context, fn);
}
/**
 * Create a test execution context and run a sync function within it
 */
function createTestContextSync(fn, options) {
    const context = (0, context_1.createExecutionContext)({
        correlationId: options?.correlationId ?? `test-${(0, crypto_1.randomUUID)()}`,
        causedBy: options?.causedBy,
        actor: options?.actor,
        tags: options?.tags,
    });
    return (0, context_1.runWithExecutionContextSync)(context, fn);
}
/**
 * Assert that an event was captured matching the filter
 * @throws Error if no matching event found
 */
function assertEventCaptured(backend, filter, message) {
    const matching = backend.getEventsMatching(filter);
    if (matching.length === 0) {
        const captured = backend.getEvents();
        throw new Error(message ??
            `Expected event matching ${JSON.stringify(filter)} but found none. ` +
                `Captured events: ${JSON.stringify(captured.map(e => ({ type: e.type, subType: e.subType, operation: e.operation })))}`);
    }
}
/**
 * Assert that no event was captured matching the filter
 * @throws Error if a matching event was found
 */
function assertNoEventCaptured(backend, filter, message) {
    const matching = backend.getEventsMatching(filter);
    if (matching.length > 0) {
        throw new Error(message ??
            `Expected no event matching ${JSON.stringify(filter)} but found ${matching.length}`);
    }
}
/**
 * Assert the number of captured events
 */
function assertEventCount(backend, count, filter) {
    const events = filter
        ? backend.getEventsMatching(filter)
        : backend.getEvents();
    if (events.length !== count) {
        throw new Error(`Expected ${count} events${filter ? ` matching ${JSON.stringify(filter)}` : ''} ` +
            `but found ${events.length}`);
    }
}
/**
 * Create a mock actor for testing
 * Actor interface requires requestId and timestamp, we provide defaults for convenience
 */
function createTestActor(overrides) {
    const base = {
        requestId: `req-${(0, crypto_1.randomUUID)()}`,
        timestamp: new Date().toISOString(),
        actorId: `user-${(0, crypto_1.randomUUID)()}`,
        actorType: 'user',
        tenantId: 'test-tenant',
        sessionId: `session-${(0, crypto_1.randomUUID)()}`,
    };
    return { ...base, ...overrides };
}
/**
 * Create a test execution context object
 */
function createTestExecutionContext(overrides) {
    return (0, context_1.createExecutionContext)({
        correlationId: overrides?.correlationId ?? `test-${(0, crypto_1.randomUUID)()}`,
        source: overrides?.observability?.source ?? 'test',
        actor: overrides?.actor,
        tags: overrides?.observability?.tags,
        sampled: overrides?.observability?.sampled,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS90ZXN0aW5nL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQ0c7OztBQWlJSCx3REFnQ0M7QUFLRCw0REFHQztBQUtELDhDQWdCQztBQUtELHNEQWdCQztBQU1ELGtEQWNDO0FBTUQsc0RBWUM7QUFLRCw0Q0FlQztBQU1ELDBDQVVDO0FBS0QsZ0VBUUM7QUF4U0QsbUNBQW9DO0FBRXBDLG9DQUF3RjtBQUN4Rix3Q0FBa0Q7QUFDbEQsc0NBQXNEO0FBQ3RELHdDQUtvQjtBQUNwQix3REFBa0U7QUFFbEU7O0dBRUc7QUFDSCxNQUFhLFdBQVc7SUFDTixJQUFJLEdBQUcsTUFBTSxDQUFDO0lBQ2QsUUFBUSxDQUFzQjtJQUV0QyxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUNsQyxVQUFVLEdBQUcsQ0FBQyxDQUFDO0lBQ2YsZUFBZSxHQUFHLENBQUMsQ0FBQztJQUU1QixZQUFZLE9BQTJDO1FBQ3JELElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxFQUFFLFFBQVEsQ0FBQztJQUNwQyxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUF5QjtRQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7SUFDcEIsQ0FBQztJQUVELG9CQUFvQjtRQUNsQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVELHVCQUF1QjtJQUV2Qjs7T0FFRztJQUNILFNBQVM7UUFDUCxPQUFPLENBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFFLENBQUM7SUFDNUIsQ0FBQztJQUVE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TUFBTSxDQUFDLENBQUMsQ0FBQyxhQUFhLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHO1lBQ2pGLGFBQWEsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUM3QixDQUFDO0lBQ0osQ0FBQztBQUNILENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixlQUFlLENBQUMsU0FBMEI7SUFDeEQsTUFBTSxJQUFJLEdBQVU7UUFDbEIsU0FBUyxFQUFFLE9BQU8sSUFBQSxtQkFBVSxHQUFFLEVBQUU7UUFDaEMsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1FBQ25DLE9BQU8sRUFBRSxRQUFRLElBQUEsbUJBQVUsR0FBRSxFQUFFO1FBQy9CLFNBQVMsRUFBRSxNQUFNO1FBQ2pCLFFBQVEsRUFBRSxhQUFhO1FBQ3ZCLFNBQVMsRUFBRSxXQUFXLElBQUEsbUJBQVUsR0FBRSxFQUFFO0tBQ3JDLENBQUM7SUFDRixPQUFPLEVBQUUsR0FBRyxJQUFJLEVBQUUsR0FBRyxTQUFTLEVBQUUsQ0FBQztBQUNuQyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQiwwQkFBMEIsQ0FBQyxTQUF5QztJQUNsRixPQUFPLElBQUEsZ0NBQXNCLEVBQUM7UUFDNUIsYUFBYSxFQUFFLFNBQVMsRUFBRSxhQUFhLElBQUksUUFBUSxJQUFBLG1CQUFVLEdBQUUsRUFBRTtRQUNqRSxNQUFNLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxNQUFNLElBQUksTUFBTTtRQUNsRCxLQUFLLEVBQUUsU0FBUyxFQUFFLEtBQUs7UUFDdkIsSUFBSSxFQUFFLFNBQVMsRUFBRSxhQUFhLEVBQUUsSUFBSTtRQUNwQyxPQUFPLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxPQUFPO0tBQzNDLENBQUMsQ0FBQztBQUNMLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFRlc3RpbmcgdXRpbGl0aWVzIGZvciBvYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFByb3ZpZGVzIGhlbHBlcnMgZm9yIHRlc3RpbmcgY29kZSB0aGF0IHVzZXMgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IFxuICogICBNb2NrQmFja2VuZCwgXG4gKiAgIHNldHVwVGVzdE9ic2VydmFiaWxpdHksIFxuICogICBhc3NlcnRFdmVudENhcHR1cmVkLFxuICogICBjcmVhdGVUZXN0Q29udGV4dCBcbiAqIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5L3Rlc3RpbmcnO1xuICogXG4gKiBkZXNjcmliZSgnTXlTZXJ2aWNlJywgKCkgPT4ge1xuICogICBsZXQgbW9ja0JhY2tlbmQ6IE1vY2tCYWNrZW5kO1xuICogICBcbiAqICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gKiAgICAgbW9ja0JhY2tlbmQgPSBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gKiAgIH0pO1xuICogICBcbiAqICAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAqICAgICBtb2NrQmFja2VuZC5yZXNldCgpO1xuICogICB9KTtcbiAqICAgXG4gKiAgIGl0KCdzaG91bGQgYXVkaXQgdXNlciBjcmVhdGlvbicsIGFzeW5jICgpID0+IHtcbiAqICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gKiAgICAgICBhd2FpdCBzZXJ2aWNlLmNyZWF0ZVVzZXIoeyBuYW1lOiAnVGVzdCcgfSk7XG4gKiAgICAgICBcbiAqICAgICAgIGFzc2VydEV2ZW50Q2FwdHVyZWQobW9ja0JhY2tlbmQsIHtcbiAqICAgICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gKiAgICAgICAgIHN1YlR5cGU6ICdjcmVhdGUnLFxuICogICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gKiAgICAgICB9KTtcbiAqICAgICB9KTtcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyIH0gZnJvbSAnLi4vbWFuYWdlcic7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vY29uZmlnJztcbmltcG9ydCB7XG4gIEV4ZWN1dGlvbkNvbnRleHREYXRhLFxuICBjcmVhdGVFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCxcbiAgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jLFxufSBmcm9tICcuLi9jb250ZXh0JztcbmltcG9ydCB7IGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUgfSBmcm9tICcuLi91dGlscy9zb3VyY2UtdXRpbHMnO1xuXG4vKipcbiAqIE1vY2sgYmFja2VuZCB0aGF0IGNhcHR1cmVzIGFsbCBldmVudHMgZm9yIHRlc3RpbmdcbiAqL1xuZXhwb3J0IGNsYXNzIE1vY2tCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdtb2NrJztcbiAgcHVibGljIHJlYWRvbmx5IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuXG4gIHByaXZhdGUgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuICBwcml2YXRlIGZsdXNoQ291bnQgPSAwO1xuICBwcml2YXRlIGludm9jYXRpb25Db3VudCA9IDA7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9ucz86IHsgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWwgfSkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBvcHRpb25zPy5taW5MZXZlbDtcbiAgfVxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZXZlbnRzLnB1c2goeyAuLi5ldmVudCB9KTtcbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZmx1c2hDb3VudCsrO1xuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgdGhpcy5pbnZvY2F0aW9uQ291bnQrKztcbiAgfVxuXG4gIC8vID09PSBUZXN0IEhlbHBlcnMgPT09XG5cbiAgLyoqXG4gICAqIEdldCBhbGwgY2FwdHVyZWQgZXZlbnRzXG4gICAqL1xuICBnZXRFdmVudHMoKTogT2JzZXJ2YWJpbGl0eUV2ZW50W10ge1xuICAgIHJldHVybiBbIC4uLnRoaXMuZXZlbnRzIF07XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV2ZW50cyBtYXRjaGluZyBhIGZpbHRlclxuICAgKi9cbiAgZ2V0RXZlbnRzTWF0Y2hpbmcoZmlsdGVyOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4pOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmZpbHRlcihldmVudCA9PiB7XG4gICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGZpbHRlcikpIHtcbiAgICAgICAgaWYgKGV2ZW50WyBrZXkgYXMga2V5b2YgT2JzZXJ2YWJpbGl0eUV2ZW50IF0gIT09IHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnRzIGJ5IHR5cGVcbiAgICovXG4gIGdldEV2ZW50c0J5VHlwZSh0eXBlOiBzdHJpbmcpOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmZpbHRlcihlID0+IGUudHlwZSA9PT0gdHlwZSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV2ZW50cyBieSBsZXZlbFxuICAgKi9cbiAgZ2V0RXZlbnRzQnlMZXZlbChsZXZlbDogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUV2ZW50W10ge1xuICAgIHJldHVybiB0aGlzLmV2ZW50cy5maWx0ZXIoZSA9PiBlLmxldmVsID09PSBsZXZlbCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBsYXN0IGNhcHR1cmVkIGV2ZW50XG4gICAqL1xuICBnZXRMYXN0RXZlbnQoKTogT2JzZXJ2YWJpbGl0eUV2ZW50IHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHNbIHRoaXMuZXZlbnRzLmxlbmd0aCAtIDEgXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBhbnkgZXZlbnQgbWF0Y2hlcyB0aGUgZmlsdGVyXG4gICAqL1xuICBoYXNFdmVudChmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50Pik6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcikubGVuZ3RoID4gMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgbnVtYmVyIG9mIGZsdXNoIGNhbGxzXG4gICAqL1xuICBnZXRGbHVzaENvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuZmx1c2hDb3VudDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgbnVtYmVyIG9mIGludm9jYXRpb24gaW5pdGlhbGl6YXRpb25zXG4gICAqL1xuICBnZXRJbnZvY2F0aW9uQ291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5pbnZvY2F0aW9uQ291bnQ7XG4gIH1cblxuICAvKipcbiAgICogQ2xlYXIgYWxsIGNhcHR1cmVkIGV2ZW50cyBhbmQgY291bnRlcnNcbiAgICovXG4gIHJlc2V0KCk6IHZvaWQge1xuICAgIHRoaXMuZXZlbnRzID0gW107XG4gICAgdGhpcy5mbHVzaENvdW50ID0gMDtcbiAgICB0aGlzLmludm9jYXRpb25Db3VudCA9IDA7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV2ZW50IGNvdW50XG4gICAqL1xuICBnZXQgZXZlbnRDb3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmV2ZW50cy5sZW5ndGg7XG4gIH1cbn1cblxuLyoqXG4gKiBTZXQgdXAgb2JzZXJ2YWJpbGl0eSBmb3IgdGVzdGluZ1xuICogXG4gKiBAcmV0dXJucyBNb2NrQmFja2VuZCBpbnN0YW5jZSBmb3IgYXNzZXJ0aW9uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eShvcHRpb25zPzoge1xuICBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcbiAgZW5hYmxlZD86IGJvb2xlYW47XG4gIC8qKiBTa2lwIGVtcHR5IHNwYW5zIChkZWZhdWx0OiBmYWxzZSBmb3IgdGVzdGluZykgKi9cbiAgc2tpcEVtcHR5U3BhbnM/OiBib29sZWFuO1xuICAvKiogTWluaW11bSBzcGFuIGR1cmF0aW9uIHRvIGNhcHR1cmUgaW4gbXMgKGRlZmF1bHQ6IDAgZm9yIHRlc3RpbmcgdG8gY2FwdHVyZSBhbGwgc3BhbnMpICovXG4gIG1pblNwYW5EdXJhdGlvbk1zPzogbnVtYmVyO1xufSk6IE1vY2tCYWNrZW5kIHtcbiAgLy8gUmVzZXQgbWFuYWdlciBzdGF0ZVxuICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuXG4gIC8vIENsZWFyIGNhY2hlZCBlbnZpcm9ubWVudCB0YWdzXG4gIGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUoKTtcblxuICAvLyBDcmVhdGUgbW9jayBiYWNrZW5kXG4gIGNvbnN0IG1vY2tCYWNrZW5kID0gbmV3IE1vY2tCYWNrZW5kKHsgbWluTGV2ZWw6IG9wdGlvbnM/Lm1pbkxldmVsIH0pO1xuXG4gIC8vIEluaXRpYWxpemUgZm9yIHRlc3Rpbmcgd2l0aCBtb2NrIGJhY2tlbmRcbiAgLy8gQnkgZGVmYXVsdCwgZGlzYWJsZSBza2lwRW1wdHkgYW5kIG1pbkR1cmF0aW9uTXMgZm9yIHRlc3Rpbmcgc28gYWxsIHNwYW5zIGFyZSBjYXB0dXJlZFxuICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplRm9yVGVzdGluZyhcbiAgICBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIGVuYWJsZWQ6IG9wdGlvbnM/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBvcHRpb25zPy5taW5MZXZlbCA/PyBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICBzcGFuczoge1xuICAgICAgICBza2lwRW1wdHk6IG9wdGlvbnM/LnNraXBFbXB0eVNwYW5zID8/IGZhbHNlLCAgLy8gRGVmYXVsdCBmYWxzZSBmb3IgdGVzdGluZ1xuICAgICAgICBtaW5EdXJhdGlvbk1zOiBvcHRpb25zPy5taW5TcGFuRHVyYXRpb25NcyA/PyAwLCAgLy8gRGVmYXVsdCAwIGZvciB0ZXN0aW5nIC0gY2FwdHVyZSBhbGwgc3BhbnNcbiAgICAgIH0sXG4gICAgfSksXG4gICAgWyBtb2NrQmFja2VuZCBdXG4gICk7XG5cbiAgcmV0dXJuIG1vY2tCYWNrZW5kO1xufVxuXG4vKipcbiAqIENsZWFuIHVwIHRlc3Qgb2JzZXJ2YWJpbGl0eSAoY2FsbCBpbiBhZnRlckVhY2gpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTogdm9pZCB7XG4gIE9ic2VydmFiaWxpdHlNYW5hZ2VyLnJlc2V0KCk7XG4gIGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUoKTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSB0ZXN0IGV4ZWN1dGlvbiBjb250ZXh0IGFuZCBydW4gYSBmdW5jdGlvbiB3aXRoaW4gaXRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVRlc3RDb250ZXh0PFQ+KFxuICBmbjogKCkgPT4gUHJvbWlzZTxUPixcbiAgb3B0aW9ucz86IHtcbiAgICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAgIGNhdXNlZEJ5Pzogc3RyaW5nO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH1cbik6IFByb21pc2U8VD4ge1xuICBjb25zdCBjb250ZXh0ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgY29ycmVsYXRpb25JZDogb3B0aW9ucz8uY29ycmVsYXRpb25JZCA/PyBgdGVzdC0ke3JhbmRvbVVVSUQoKX1gLFxuICAgIGNhdXNlZEJ5OiBvcHRpb25zPy5jYXVzZWRCeSxcbiAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgdGFnczogb3B0aW9ucz8udGFncyxcbiAgfSk7XG4gIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChjb250ZXh0LCBmbik7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgdGVzdCBleGVjdXRpb24gY29udGV4dCBhbmQgcnVuIGEgc3luYyBmdW5jdGlvbiB3aXRoaW4gaXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRlc3RDb250ZXh0U3luYzxUPihcbiAgZm46ICgpID0+IFQsXG4gIG9wdGlvbnM/OiB7XG4gICAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgICBjYXVzZWRCeT86IHN0cmluZztcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICB9XG4pOiBUIHtcbiAgY29uc3QgY29udGV4dCA9IGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQoe1xuICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQgPz8gYHRlc3QtJHtyYW5kb21VVUlEKCl9YCxcbiAgICBjYXVzZWRCeTogb3B0aW9ucz8uY2F1c2VkQnksXG4gICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yLFxuICAgIHRhZ3M6IG9wdGlvbnM/LnRhZ3MsXG4gIH0pO1xuICByZXR1cm4gcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHRTeW5jKGNvbnRleHQsIGZuKTtcbn1cblxuLyoqXG4gKiBBc3NlcnQgdGhhdCBhbiBldmVudCB3YXMgY2FwdHVyZWQgbWF0Y2hpbmcgdGhlIGZpbHRlclxuICogQHRocm93cyBFcnJvciBpZiBubyBtYXRjaGluZyBldmVudCBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0RXZlbnRDYXB0dXJlZChcbiAgYmFja2VuZDogTW9ja0JhY2tlbmQsXG4gIGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+LFxuICBtZXNzYWdlPzogc3RyaW5nXG4pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2hpbmcgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcik7XG4gIGlmIChtYXRjaGluZy5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBjYXB0dXJlZCA9IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgbWVzc2FnZSA/P1xuICAgICAgYEV4cGVjdGVkIGV2ZW50IG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkoZmlsdGVyKX0gYnV0IGZvdW5kIG5vbmUuIGAgK1xuICAgICAgYENhcHR1cmVkIGV2ZW50czogJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlZC5tYXAoZSA9PiAoeyB0eXBlOiBlLnR5cGUsIHN1YlR5cGU6IGUuc3ViVHlwZSwgb3BlcmF0aW9uOiBlLm9wZXJhdGlvbiB9KSkpfWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogQXNzZXJ0IHRoYXQgbm8gZXZlbnQgd2FzIGNhcHR1cmVkIG1hdGNoaW5nIHRoZSBmaWx0ZXJcbiAqIEB0aHJvd3MgRXJyb3IgaWYgYSBtYXRjaGluZyBldmVudCB3YXMgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydE5vRXZlbnRDYXB0dXJlZChcbiAgYmFja2VuZDogTW9ja0JhY2tlbmQsXG4gIGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+LFxuICBtZXNzYWdlPzogc3RyaW5nXG4pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2hpbmcgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcik7XG4gIGlmIChtYXRjaGluZy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgbWVzc2FnZSA/P1xuICAgICAgYEV4cGVjdGVkIG5vIGV2ZW50IG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkoZmlsdGVyKX0gYnV0IGZvdW5kICR7bWF0Y2hpbmcubGVuZ3RofWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogQXNzZXJ0IHRoZSBudW1iZXIgb2YgY2FwdHVyZWQgZXZlbnRzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRFdmVudENvdW50KFxuICBiYWNrZW5kOiBNb2NrQmFja2VuZCxcbiAgY291bnQ6IG51bWJlcixcbiAgZmlsdGVyPzogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+XG4pOiB2b2lkIHtcbiAgY29uc3QgZXZlbnRzID0gZmlsdGVyXG4gICAgPyBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcilcbiAgICA6IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG5cbiAgaWYgKGV2ZW50cy5sZW5ndGggIT09IGNvdW50KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEV4cGVjdGVkICR7Y291bnR9IGV2ZW50cyR7ZmlsdGVyID8gYCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KGZpbHRlcil9YCA6ICcnfSBgICtcbiAgICAgIGBidXQgZm91bmQgJHtldmVudHMubGVuZ3RofWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgbW9jayBhY3RvciBmb3IgdGVzdGluZ1xuICogQWN0b3IgaW50ZXJmYWNlIHJlcXVpcmVzIHJlcXVlc3RJZCBhbmQgdGltZXN0YW1wLCB3ZSBwcm92aWRlIGRlZmF1bHRzIGZvciBjb252ZW5pZW5jZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVGVzdEFjdG9yKG92ZXJyaWRlcz86IFBhcnRpYWw8QWN0b3I+KTogQWN0b3Ige1xuICBjb25zdCBiYXNlOiBBY3RvciA9IHtcbiAgICByZXF1ZXN0SWQ6IGByZXEtJHtyYW5kb21VVUlEKCl9YCxcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBhY3RvcklkOiBgdXNlci0ke3JhbmRvbVVVSUQoKX1gLFxuICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgIHRlbmFudElkOiAndGVzdC10ZW5hbnQnLFxuICAgIHNlc3Npb25JZDogYHNlc3Npb24tJHtyYW5kb21VVUlEKCl9YCxcbiAgfTtcbiAgcmV0dXJuIHsgLi4uYmFzZSwgLi4ub3ZlcnJpZGVzIH07XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgdGVzdCBleGVjdXRpb24gY29udGV4dCBvYmplY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRlc3RFeGVjdXRpb25Db250ZXh0KG92ZXJyaWRlcz86IFBhcnRpYWw8RXhlY3V0aW9uQ29udGV4dERhdGE+KTogRXhlY3V0aW9uQ29udGV4dERhdGEge1xuICByZXR1cm4gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgY29ycmVsYXRpb25JZDogb3ZlcnJpZGVzPy5jb3JyZWxhdGlvbklkID8/IGB0ZXN0LSR7cmFuZG9tVVVJRCgpfWAsXG4gICAgc291cmNlOiBvdmVycmlkZXM/Lm9ic2VydmFiaWxpdHk/LnNvdXJjZSA/PyAndGVzdCcsXG4gICAgYWN0b3I6IG92ZXJyaWRlcz8uYWN0b3IsXG4gICAgdGFnczogb3ZlcnJpZGVzPy5vYnNlcnZhYmlsaXR5Py50YWdzLFxuICAgIHNhbXBsZWQ6IG92ZXJyaWRlcz8ub2JzZXJ2YWJpbGl0eT8uc2FtcGxlZCxcbiAgfSk7XG59XG4iXX0=