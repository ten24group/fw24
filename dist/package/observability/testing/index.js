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
    // === Absorbed Data Helpers ===
    /**
     * Get events that have absorbed data attached (i.e., events that absorbed children).
     * Absorbed data lives at event.data.absorbed.
     */
    getEventsWithAbsorbed() {
        return this.events.filter(e => e.data?.absorbed != null);
    }
    /**
     * Get the absorbed data for a specific event (by operation or filter).
     * Returns undefined if the event has no absorbed data.
     */
    getAbsorbedData(filter) {
        const matching = this.getEventsMatching(filter);
        if (matching.length === 0)
            return undefined;
        return matching[0].data?.absorbed;
    }
    /**
     * Assert that a captured event has absorbed children.
     * @throws Error if no matching event or the event has no absorbed data.
     */
    assertHasAbsorbed(filter, message) {
        const matching = this.getEventsMatching(filter);
        if (matching.length === 0) {
            throw new Error(message ?? `Expected event matching ${JSON.stringify(filter)} but found none.`);
        }
        const absorbed = matching[0].data?.absorbed;
        if (!absorbed) {
            throw new Error(message ?? `Expected event matching ${JSON.stringify(filter)} to have absorbed data, but data.absorbed is ${absorbed}.`);
        }
        return absorbed;
    }
    /**
     * Assert that absorbed data contains a specific number of absorbed children.
     */
    assertAbsorbedCount(filter, expectedCount, message) {
        const absorbed = this.assertHasAbsorbed(filter, message);
        if (absorbed.count !== expectedCount) {
            throw new Error(message ?? `Expected absorbed count ${expectedCount} but got ${absorbed.count} for event matching ${JSON.stringify(filter)}.`);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS90ZXN0aW5nL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQ0c7OztBQXNMSCx3REFnQ0M7QUFLRCw0REFHQztBQUtELDhDQWdCQztBQUtELHNEQWdCQztBQU1ELGtEQWNDO0FBTUQsc0RBWUM7QUFLRCw0Q0FlQztBQU1ELDBDQVVDO0FBS0QsZ0VBUUM7QUE3VkQsbUNBQW9DO0FBRXBDLG9DQUF3RjtBQUN4Rix3Q0FBa0Q7QUFDbEQsc0NBQXNEO0FBQ3RELHdDQUtvQjtBQUNwQix3REFBa0U7QUFHbEU7O0dBRUc7QUFDSCxNQUFhLFdBQVc7SUFDTixJQUFJLEdBQUcsTUFBTSxDQUFDO0lBQ2QsUUFBUSxDQUFzQjtJQUV0QyxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUNsQyxVQUFVLEdBQUcsQ0FBQyxDQUFDO0lBQ2YsZUFBZSxHQUFHLENBQUMsQ0FBQztJQUU1QixZQUFZLE9BQTJDO1FBQ3JELElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxFQUFFLFFBQVEsQ0FBQztJQUNwQyxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUF5QjtRQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7SUFDcEIsQ0FBQztJQUVELG9CQUFvQjtRQUNsQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVELHVCQUF1QjtJQUV2Qjs7T0FFRztJQUNILFNBQVM7UUFDUCxPQUFPLENBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFFLENBQUM7SUFDNUIsQ0FBQztJQUVE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QU0sRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLE1BQU0sSUFBSSxNQUFNO1FBQ2xELEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSztRQUN2QixJQUFJLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxJQUFJO1FBQ3BDLE9BQU8sRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLE9BQU87S0FDM0MsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGVzdGluZyB1dGlsaXRpZXMgZm9yIG9ic2VydmFiaWxpdHlcbiAqIFxuICogUHJvdmlkZXMgaGVscGVycyBmb3IgdGVzdGluZyBjb2RlIHRoYXQgdXNlcyB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgXG4gKiAgIE1vY2tCYWNrZW5kLCBcbiAqICAgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSwgXG4gKiAgIGFzc2VydEV2ZW50Q2FwdHVyZWQsXG4gKiAgIGNyZWF0ZVRlc3RDb250ZXh0IFxuICogfSBmcm9tICdAdGVuMjRncm91cC9mdzI0L29ic2VydmFiaWxpdHkvdGVzdGluZyc7XG4gKiBcbiAqIGRlc2NyaWJlKCdNeVNlcnZpY2UnLCAoKSA9PiB7XG4gKiAgIGxldCBtb2NrQmFja2VuZDogTW9ja0JhY2tlbmQ7XG4gKiAgIFxuICogICBiZWZvcmVFYWNoKCgpID0+IHtcbiAqICAgICBtb2NrQmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAqICAgfSk7XG4gKiAgIFxuICogICBhZnRlckVhY2goKCkgPT4ge1xuICogICAgIG1vY2tCYWNrZW5kLnJlc2V0KCk7XG4gKiAgIH0pO1xuICogICBcbiAqICAgaXQoJ3Nob3VsZCBhdWRpdCB1c2VyIGNyZWF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICogICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAqICAgICAgIGF3YWl0IHNlcnZpY2UuY3JlYXRlVXNlcih7IG5hbWU6ICdUZXN0JyB9KTtcbiAqICAgICAgIFxuICogICAgICAgYXNzZXJ0RXZlbnRDYXB0dXJlZChtb2NrQmFja2VuZCwge1xuICogICAgICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAqICAgICAgICAgc3ViVHlwZTogJ2NyZWF0ZScsXG4gKiAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAqICAgICAgIH0pO1xuICogICAgIH0pO1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuLi9tYW5hZ2VyJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IHtcbiAgRXhlY3V0aW9uQ29udGV4dERhdGEsXG4gIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsXG4gIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0LFxuICBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMsXG59IGZyb20gJy4uL2NvbnRleHQnO1xuaW1wb3J0IHsgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSB9IGZyb20gJy4uL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgdHlwZSB7IEFic29yYmVkRGF0YSB9IGZyb20gJy4uL25vaXNlLXJlZHVjdGlvbi90eXBlcyc7XG5cbi8qKlxuICogTW9jayBiYWNrZW5kIHRoYXQgY2FwdHVyZXMgYWxsIGV2ZW50cyBmb3IgdGVzdGluZ1xuICovXG5leHBvcnQgY2xhc3MgTW9ja0JhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ21vY2snO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG4gIHByaXZhdGUgZmx1c2hDb3VudCA9IDA7XG4gIHByaXZhdGUgaW52b2NhdGlvbkNvdW50ID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zPzogeyBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbCB9KSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG9wdGlvbnM/Lm1pbkxldmVsO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IC4uLmV2ZW50IH0pO1xuICB9XG5cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5mbHVzaENvdW50Kys7XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmludm9jYXRpb25Db3VudCsrO1xuICB9XG5cbiAgLy8gPT09IFRlc3QgSGVscGVycyA9PT1cblxuICAvKipcbiAgICogR2V0IGFsbCBjYXB0dXJlZCBldmVudHNcbiAgICovXG4gIGdldEV2ZW50cygpOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gICAgcmV0dXJuIFsgLi4udGhpcy5ldmVudHMgXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnRzIG1hdGNoaW5nIGEgZmlsdGVyXG4gICAqL1xuICBnZXRFdmVudHNNYXRjaGluZyhmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50Pik6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKGV2ZW50ID0+IHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVyKSkge1xuICAgICAgICBpZiAoZXZlbnRbIGtleSBhcyBrZXlvZiBPYnNlcnZhYmlsaXR5RXZlbnQgXSAhPT0gdmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBldmVudHMgYnkgdHlwZVxuICAgKi9cbiAgZ2V0RXZlbnRzQnlUeXBlKHR5cGU6IHN0cmluZyk6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKGUgPT4gZS50eXBlID09PSB0eXBlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnRzIGJ5IGxldmVsXG4gICAqL1xuICBnZXRFdmVudHNCeUxldmVsKGxldmVsOiBzdHJpbmcpOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmZpbHRlcihlID0+IGUubGV2ZWwgPT09IGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGxhc3QgY2FwdHVyZWQgZXZlbnRcbiAgICovXG4gIGdldExhc3RFdmVudCgpOiBPYnNlcnZhYmlsaXR5RXZlbnQgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmV2ZW50c1sgdGhpcy5ldmVudHMubGVuZ3RoIC0gMSBdO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGFueSBldmVudCBtYXRjaGVzIHRoZSBmaWx0ZXJcbiAgICovXG4gIGhhc0V2ZW50KGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RXZlbnRzTWF0Y2hpbmcoZmlsdGVyKS5sZW5ndGggPiAwO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBudW1iZXIgb2YgZmx1c2ggY2FsbHNcbiAgICovXG4gIGdldEZsdXNoQ291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5mbHVzaENvdW50O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBudW1iZXIgb2YgaW52b2NhdGlvbiBpbml0aWFsaXphdGlvbnNcbiAgICovXG4gIGdldEludm9jYXRpb25Db3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmludm9jYXRpb25Db3VudDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhciBhbGwgY2FwdHVyZWQgZXZlbnRzIGFuZCBjb3VudGVyc1xuICAgKi9cbiAgcmVzZXQoKTogdm9pZCB7XG4gICAgdGhpcy5ldmVudHMgPSBbXTtcbiAgICB0aGlzLmZsdXNoQ291bnQgPSAwO1xuICAgIHRoaXMuaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnQgY291bnRcbiAgICovXG4gIGdldCBldmVudENvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmxlbmd0aDtcbiAgfVxuXG4gIC8vID09PSBBYnNvcmJlZCBEYXRhIEhlbHBlcnMgPT09XG5cbiAgLyoqXG4gICAqIEdldCBldmVudHMgdGhhdCBoYXZlIGFic29yYmVkIGRhdGEgYXR0YWNoZWQgKGkuZS4sIGV2ZW50cyB0aGF0IGFic29yYmVkIGNoaWxkcmVuKS5cbiAgICogQWJzb3JiZWQgZGF0YSBsaXZlcyBhdCBldmVudC5kYXRhLmFic29yYmVkLlxuICAgKi9cbiAgZ2V0RXZlbnRzV2l0aEFic29yYmVkKCk6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKGUgPT4gKGUuZGF0YSBhcyBhbnkpPy5hYnNvcmJlZCAhPSBudWxsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGFic29yYmVkIGRhdGEgZm9yIGEgc3BlY2lmaWMgZXZlbnQgKGJ5IG9wZXJhdGlvbiBvciBmaWx0ZXIpLlxuICAgKiBSZXR1cm5zIHVuZGVmaW5lZCBpZiB0aGUgZXZlbnQgaGFzIG5vIGFic29yYmVkIGRhdGEuXG4gICAqL1xuICBnZXRBYnNvcmJlZERhdGEoZmlsdGVyOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4pOiBBYnNvcmJlZERhdGEgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG1hdGNoaW5nID0gdGhpcy5nZXRFdmVudHNNYXRjaGluZyhmaWx0ZXIpO1xuICAgIGlmIChtYXRjaGluZy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIChtYXRjaGluZ1swXS5kYXRhIGFzIGFueSk/LmFic29yYmVkIGFzIEFic29yYmVkRGF0YSB8IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnQgdGhhdCBhIGNhcHR1cmVkIGV2ZW50IGhhcyBhYnNvcmJlZCBjaGlsZHJlbi5cbiAgICogQHRocm93cyBFcnJvciBpZiBubyBtYXRjaGluZyBldmVudCBvciB0aGUgZXZlbnQgaGFzIG5vIGFic29yYmVkIGRhdGEuXG4gICAqL1xuICBhc3NlcnRIYXNBYnNvcmJlZChmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiwgbWVzc2FnZT86IHN0cmluZyk6IEFic29yYmVkRGF0YSB7XG4gICAgY29uc3QgbWF0Y2hpbmcgPSB0aGlzLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcik7XG4gICAgaWYgKG1hdGNoaW5nLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBtZXNzYWdlID8/IGBFeHBlY3RlZCBldmVudCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KGZpbHRlcil9IGJ1dCBmb3VuZCBub25lLmBcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGFic29yYmVkID0gKG1hdGNoaW5nWzBdLmRhdGEgYXMgYW55KT8uYWJzb3JiZWQgYXMgQWJzb3JiZWREYXRhIHwgdW5kZWZpbmVkO1xuICAgIGlmICghYWJzb3JiZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgbWVzc2FnZSA/PyBgRXhwZWN0ZWQgZXZlbnQgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShmaWx0ZXIpfSB0byBoYXZlIGFic29yYmVkIGRhdGEsIGJ1dCBkYXRhLmFic29yYmVkIGlzICR7YWJzb3JiZWR9LmBcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBhYnNvcmJlZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NlcnQgdGhhdCBhYnNvcmJlZCBkYXRhIGNvbnRhaW5zIGEgc3BlY2lmaWMgbnVtYmVyIG9mIGFic29yYmVkIGNoaWxkcmVuLlxuICAgKi9cbiAgYXNzZXJ0QWJzb3JiZWRDb3VudChmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiwgZXhwZWN0ZWRDb3VudDogbnVtYmVyLCBtZXNzYWdlPzogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgYWJzb3JiZWQgPSB0aGlzLmFzc2VydEhhc0Fic29yYmVkKGZpbHRlciwgbWVzc2FnZSk7XG4gICAgaWYgKGFic29yYmVkLmNvdW50ICE9PSBleHBlY3RlZENvdW50KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIG1lc3NhZ2UgPz8gYEV4cGVjdGVkIGFic29yYmVkIGNvdW50ICR7ZXhwZWN0ZWRDb3VudH0gYnV0IGdvdCAke2Fic29yYmVkLmNvdW50fSBmb3IgZXZlbnQgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShmaWx0ZXIpfS5gXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFNldCB1cCBvYnNlcnZhYmlsaXR5IGZvciB0ZXN0aW5nXG4gKiBcbiAqIEByZXR1cm5zIE1vY2tCYWNrZW5kIGluc3RhbmNlIGZvciBhc3NlcnRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KG9wdGlvbnM/OiB7XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICBlbmFibGVkPzogYm9vbGVhbjtcbiAgLyoqIFNraXAgZW1wdHkgc3BhbnMgKGRlZmF1bHQ6IGZhbHNlIGZvciB0ZXN0aW5nKSAqL1xuICBza2lwRW1wdHlTcGFucz86IGJvb2xlYW47XG4gIC8qKiBNaW5pbXVtIHNwYW4gZHVyYXRpb24gdG8gY2FwdHVyZSBpbiBtcyAoZGVmYXVsdDogMCBmb3IgdGVzdGluZyB0byBjYXB0dXJlIGFsbCBzcGFucykgKi9cbiAgbWluU3BhbkR1cmF0aW9uTXM/OiBudW1iZXI7XG59KTogTW9ja0JhY2tlbmQge1xuICAvLyBSZXNldCBtYW5hZ2VyIHN0YXRlXG4gIE9ic2VydmFiaWxpdHlNYW5hZ2VyLnJlc2V0KCk7XG5cbiAgLy8gQ2xlYXIgY2FjaGVkIGVudmlyb25tZW50IHRhZ3NcbiAgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSgpO1xuXG4gIC8vIENyZWF0ZSBtb2NrIGJhY2tlbmRcbiAgY29uc3QgbW9ja0JhY2tlbmQgPSBuZXcgTW9ja0JhY2tlbmQoeyBtaW5MZXZlbDogb3B0aW9ucz8ubWluTGV2ZWwgfSk7XG5cbiAgLy8gSW5pdGlhbGl6ZSBmb3IgdGVzdGluZyB3aXRoIG1vY2sgYmFja2VuZFxuICAvLyBCeSBkZWZhdWx0LCBkaXNhYmxlIHNraXBFbXB0eSBhbmQgbWluRHVyYXRpb25NcyBmb3IgdGVzdGluZyBzbyBhbGwgc3BhbnMgYXJlIGNhcHR1cmVkXG4gIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVGb3JUZXN0aW5nKFxuICAgIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgICAgZW5hYmxlZDogb3B0aW9ucz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgbWluTGV2ZWw6IG9wdGlvbnM/Lm1pbkxldmVsID8/IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICAgIHNwYW5zOiB7XG4gICAgICAgIHNraXBFbXB0eTogb3B0aW9ucz8uc2tpcEVtcHR5U3BhbnMgPz8gZmFsc2UsICAvLyBEZWZhdWx0IGZhbHNlIGZvciB0ZXN0aW5nXG4gICAgICAgIG1pbkR1cmF0aW9uTXM6IG9wdGlvbnM/Lm1pblNwYW5EdXJhdGlvbk1zID8/IDAsICAvLyBEZWZhdWx0IDAgZm9yIHRlc3RpbmcgLSBjYXB0dXJlIGFsbCBzcGFuc1xuICAgICAgfSxcbiAgICB9KSxcbiAgICBbIG1vY2tCYWNrZW5kIF1cbiAgKTtcblxuICByZXR1cm4gbW9ja0JhY2tlbmQ7XG59XG5cbi8qKlxuICogQ2xlYW4gdXAgdGVzdCBvYnNlcnZhYmlsaXR5IChjYWxsIGluIGFmdGVyRWFjaClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSgpOiB2b2lkIHtcbiAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSgpO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHRlc3QgZXhlY3V0aW9uIGNvbnRleHQgYW5kIHJ1biBhIGZ1bmN0aW9uIHdpdGhpbiBpdFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlVGVzdENvbnRleHQ8VD4oXG4gIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxuICBvcHRpb25zPzoge1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgY2F1c2VkQnk/OiBzdHJpbmc7XG4gICAgYWN0b3I/OiBBY3RvcjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgfVxuKTogUHJvbWlzZTxUPiB7XG4gIGNvbnN0IGNvbnRleHQgPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICBjb3JyZWxhdGlvbklkOiBvcHRpb25zPy5jb3JyZWxhdGlvbklkID8/IGB0ZXN0LSR7cmFuZG9tVVVJRCgpfWAsXG4gICAgY2F1c2VkQnk6IG9wdGlvbnM/LmNhdXNlZEJ5LFxuICAgIGFjdG9yOiBvcHRpb25zPy5hY3RvcixcbiAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICB9KTtcbiAgcmV0dXJuIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KGNvbnRleHQsIGZuKTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSB0ZXN0IGV4ZWN1dGlvbiBjb250ZXh0IGFuZCBydW4gYSBzeW5jIGZ1bmN0aW9uIHdpdGhpbiBpdFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVGVzdENvbnRleHRTeW5jPFQ+KFxuICBmbjogKCkgPT4gVCxcbiAgb3B0aW9ucz86IHtcbiAgICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAgIGNhdXNlZEJ5Pzogc3RyaW5nO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH1cbik6IFQge1xuICBjb25zdCBjb250ZXh0ID0gY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgY29ycmVsYXRpb25JZDogb3B0aW9ucz8uY29ycmVsYXRpb25JZCA/PyBgdGVzdC0ke3JhbmRvbVVVSUQoKX1gLFxuICAgIGNhdXNlZEJ5OiBvcHRpb25zPy5jYXVzZWRCeSxcbiAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgdGFnczogb3B0aW9ucz8udGFncyxcbiAgfSk7XG4gIHJldHVybiBydW5XaXRoRXhlY3V0aW9uQ29udGV4dFN5bmMoY29udGV4dCwgZm4pO1xufVxuXG4vKipcbiAqIEFzc2VydCB0aGF0IGFuIGV2ZW50IHdhcyBjYXB0dXJlZCBtYXRjaGluZyB0aGUgZmlsdGVyXG4gKiBAdGhyb3dzIEVycm9yIGlmIG5vIG1hdGNoaW5nIGV2ZW50IGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRFdmVudENhcHR1cmVkKFxuICBiYWNrZW5kOiBNb2NrQmFja2VuZCxcbiAgZmlsdGVyOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4sXG4gIG1lc3NhZ2U/OiBzdHJpbmdcbik6IHZvaWQge1xuICBjb25zdCBtYXRjaGluZyA9IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoZmlsdGVyKTtcbiAgaWYgKG1hdGNoaW5nLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGNhcHR1cmVkID0gYmFja2VuZC5nZXRFdmVudHMoKTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBtZXNzYWdlID8/XG4gICAgICBgRXhwZWN0ZWQgZXZlbnQgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShmaWx0ZXIpfSBidXQgZm91bmQgbm9uZS4gYCArXG4gICAgICBgQ2FwdHVyZWQgZXZlbnRzOiAke0pTT04uc3RyaW5naWZ5KGNhcHR1cmVkLm1hcChlID0+ICh7IHR5cGU6IGUudHlwZSwgc3ViVHlwZTogZS5zdWJUeXBlLCBvcGVyYXRpb246IGUub3BlcmF0aW9uIH0pKSl9YFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBBc3NlcnQgdGhhdCBubyBldmVudCB3YXMgY2FwdHVyZWQgbWF0Y2hpbmcgdGhlIGZpbHRlclxuICogQHRocm93cyBFcnJvciBpZiBhIG1hdGNoaW5nIGV2ZW50IHdhcyBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0Tm9FdmVudENhcHR1cmVkKFxuICBiYWNrZW5kOiBNb2NrQmFja2VuZCxcbiAgZmlsdGVyOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4sXG4gIG1lc3NhZ2U/OiBzdHJpbmdcbik6IHZvaWQge1xuICBjb25zdCBtYXRjaGluZyA9IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoZmlsdGVyKTtcbiAgaWYgKG1hdGNoaW5nLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBtZXNzYWdlID8/XG4gICAgICBgRXhwZWN0ZWQgbm8gZXZlbnQgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShmaWx0ZXIpfSBidXQgZm91bmQgJHttYXRjaGluZy5sZW5ndGh9YFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBBc3NlcnQgdGhlIG51bWJlciBvZiBjYXB0dXJlZCBldmVudHNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydEV2ZW50Q291bnQoXG4gIGJhY2tlbmQ6IE1vY2tCYWNrZW5kLFxuICBjb3VudDogbnVtYmVyLFxuICBmaWx0ZXI/OiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD5cbik6IHZvaWQge1xuICBjb25zdCBldmVudHMgPSBmaWx0ZXJcbiAgICA/IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoZmlsdGVyKVxuICAgIDogYmFja2VuZC5nZXRFdmVudHMoKTtcblxuICBpZiAoZXZlbnRzLmxlbmd0aCAhPT0gY291bnQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgRXhwZWN0ZWQgJHtjb3VudH0gZXZlbnRzJHtmaWx0ZXIgPyBgIG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkoZmlsdGVyKX1gIDogJyd9IGAgK1xuICAgICAgYGJ1dCBmb3VuZCAke2V2ZW50cy5sZW5ndGh9YFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBtb2NrIGFjdG9yIGZvciB0ZXN0aW5nXG4gKiBBY3RvciBpbnRlcmZhY2UgcmVxdWlyZXMgcmVxdWVzdElkIGFuZCB0aW1lc3RhbXAsIHdlIHByb3ZpZGUgZGVmYXVsdHMgZm9yIGNvbnZlbmllbmNlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUZXN0QWN0b3Iob3ZlcnJpZGVzPzogUGFydGlhbDxBY3Rvcj4pOiBBY3RvciB7XG4gIGNvbnN0IGJhc2U6IEFjdG9yID0ge1xuICAgIHJlcXVlc3RJZDogYHJlcS0ke3JhbmRvbVVVSUQoKX1gLFxuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIGFjdG9ySWQ6IGB1c2VyLSR7cmFuZG9tVVVJRCgpfWAsXG4gICAgYWN0b3JUeXBlOiAndXNlcicsXG4gICAgdGVuYW50SWQ6ICd0ZXN0LXRlbmFudCcsXG4gICAgc2Vzc2lvbklkOiBgc2Vzc2lvbi0ke3JhbmRvbVVVSUQoKX1gLFxuICB9O1xuICByZXR1cm4geyAuLi5iYXNlLCAuLi5vdmVycmlkZXMgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSB0ZXN0IGV4ZWN1dGlvbiBjb250ZXh0IG9iamVjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVGVzdEV4ZWN1dGlvbkNvbnRleHQob3ZlcnJpZGVzPzogUGFydGlhbDxFeGVjdXRpb25Db250ZXh0RGF0YT4pOiBFeGVjdXRpb25Db250ZXh0RGF0YSB7XG4gIHJldHVybiBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICBjb3JyZWxhdGlvbklkOiBvdmVycmlkZXM/LmNvcnJlbGF0aW9uSWQgPz8gYHRlc3QtJHtyYW5kb21VVUlEKCl9YCxcbiAgICBzb3VyY2U6IG92ZXJyaWRlcz8ub2JzZXJ2YWJpbGl0eT8uc291cmNlID8/ICd0ZXN0JyxcbiAgICBhY3Rvcjogb3ZlcnJpZGVzPy5hY3RvcixcbiAgICB0YWdzOiBvdmVycmlkZXM/Lm9ic2VydmFiaWxpdHk/LnRhZ3MsXG4gICAgc2FtcGxlZDogb3ZlcnJpZGVzPy5vYnNlcnZhYmlsaXR5Py5zYW1wbGVkLFxuICB9KTtcbn1cbiJdfQ==