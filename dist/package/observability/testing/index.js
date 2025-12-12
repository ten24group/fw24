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
exports.createTestObservationContext = createTestObservationContext;
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
    manager_1.ObservabilityManager.initializeForTesting((0, config_1.createObservabilityConfig)({
        enabled: options?.enabled ?? true,
        minLevel: options?.minLevel ?? types_1.ObservabilityLevel.TRACE,
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
 * Create a test observation context and run a function within it
 */
async function createTestContext(fn, options) {
    const context = (0, context_1.createObservationContext)(options?.correlationId ?? `test-${(0, crypto_1.randomUUID)()}`, {
        actor: options?.actor,
        tags: options?.tags,
    });
    return (0, context_1.runWithContext)(context, fn);
}
/**
 * Create a test observation context and run a sync function within it
 */
function createTestContextSync(fn, options) {
    const context = (0, context_1.createObservationContext)(options?.correlationId ?? `test-${(0, crypto_1.randomUUID)()}`, {
        actor: options?.actor,
        tags: options?.tags,
    });
    return (0, context_1.runWithContextSync)(context, fn);
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
 * Create a test observation context object
 */
function createTestObservationContext(overrides) {
    return (0, context_1.createObservationContext)(overrides?.correlationId ?? `test-${(0, crypto_1.randomUUID)()}`, {
        source: overrides?.source ?? 'test',
        actor: overrides?.actor,
        tags: overrides?.tags,
        sampled: overrides?.sampled,
        parentObservabilityLogId: overrides?.parentObservabilityLogId,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS90ZXN0aW5nL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQ0c7OztBQWlJSCx3REF1QkM7QUFLRCw0REFHQztBQUtELDhDQWdCQztBQUtELHNEQWdCQztBQU1ELGtEQWNDO0FBTUQsc0RBWUM7QUFLRCw0Q0FlQztBQU1ELDBDQVVDO0FBS0Qsb0VBV0M7QUFsU0QsbUNBQW9DO0FBRXBDLG9DQUF3RjtBQUN4Rix3Q0FBa0Q7QUFDbEQsc0NBQXNEO0FBQ3RELHdDQUtvQjtBQUNwQix3REFBa0U7QUFFbEU7O0dBRUc7QUFDSCxNQUFhLFdBQVc7SUFDTixJQUFJLEdBQUcsTUFBTSxDQUFDO0lBQ2QsUUFBUSxDQUFzQjtJQUV0QyxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUNsQyxVQUFVLEdBQUcsQ0FBQyxDQUFDO0lBQ2YsZUFBZSxHQUFHLENBQUMsQ0FBQztJQUU1QixZQUFZLE9BQTJDO1FBQ3JELElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxFQUFFLFFBQVEsQ0FBQztJQUNwQyxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUF5QjtRQUNyQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7SUFDcEIsQ0FBQztJQUVELG9CQUFvQjtRQUNsQixJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVELHVCQUF1QjtJQUV2Qjs7T0FFRztJQUNILFNBQVM7UUFDUCxPQUFPLENBQUUsR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFFLENBQUM7SUFDNUIsQ0FBQztJQUVE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QUFPLElBQUEsbUJBQVUsR0FBRSxFQUFFO1FBQ2hDLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtRQUNuQyxPQUFPLEVBQUUsUUFBUSxJQUFBLG1CQUFVLEdBQUUsRUFBRTtRQUMvQixTQUFTLEVBQUUsTUFBTTtRQUNqQixRQUFRLEVBQUUsYUFBYTtRQUN2QixTQUFTLEVBQUUsV0FBVyxJQUFBLG1CQUFVLEdBQUUsRUFBRTtLQUNyQyxDQUFDO0lBQ0YsT0FBTyxFQUFFLEdBQUcsSUFBSSxFQUFFLEdBQUcsU0FBUyxFQUFFLENBQUM7QUFDbkMsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsNEJBQTRCLENBQUMsU0FBdUM7SUFDbEYsT0FBTyxJQUFBLGtDQUF3QixFQUM3QixTQUFTLEVBQUUsYUFBYSxJQUFJLFFBQVEsSUFBQSxtQkFBVSxHQUFFLEVBQUUsRUFDbEQ7UUFDRSxNQUFNLEVBQUUsU0FBUyxFQUFFLE1BQU0sSUFBSSxNQUFNO1FBQ25DLEtBQUssRUFBRSxTQUFTLEVBQUUsS0FBSztRQUN2QixJQUFJLEVBQUUsU0FBUyxFQUFFLElBQUk7UUFDckIsT0FBTyxFQUFFLFNBQVMsRUFBRSxPQUFPO1FBQzNCLHdCQUF3QixFQUFFLFNBQVMsRUFBRSx3QkFBd0I7S0FDOUQsQ0FDRixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGVzdGluZyB1dGlsaXRpZXMgZm9yIG9ic2VydmFiaWxpdHlcbiAqIFxuICogUHJvdmlkZXMgaGVscGVycyBmb3IgdGVzdGluZyBjb2RlIHRoYXQgdXNlcyB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIFVzYWdlOlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgXG4gKiAgIE1vY2tCYWNrZW5kLCBcbiAqICAgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSwgXG4gKiAgIGFzc2VydEV2ZW50Q2FwdHVyZWQsXG4gKiAgIGNyZWF0ZVRlc3RDb250ZXh0IFxuICogfSBmcm9tICdAdGVuMjRncm91cC9mdzI0L29ic2VydmFiaWxpdHkvdGVzdGluZyc7XG4gKiBcbiAqIGRlc2NyaWJlKCdNeVNlcnZpY2UnLCAoKSA9PiB7XG4gKiAgIGxldCBtb2NrQmFja2VuZDogTW9ja0JhY2tlbmQ7XG4gKiAgIFxuICogICBiZWZvcmVFYWNoKCgpID0+IHtcbiAqICAgICBtb2NrQmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAqICAgfSk7XG4gKiAgIFxuICogICBhZnRlckVhY2goKCkgPT4ge1xuICogICAgIG1vY2tCYWNrZW5kLnJlc2V0KCk7XG4gKiAgIH0pO1xuICogICBcbiAqICAgaXQoJ3Nob3VsZCBhdWRpdCB1c2VyIGNyZWF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICogICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAqICAgICAgIGF3YWl0IHNlcnZpY2UuY3JlYXRlVXNlcih7IG5hbWU6ICdUZXN0JyB9KTtcbiAqICAgICAgIFxuICogICAgICAgYXNzZXJ0RXZlbnRDYXB0dXJlZChtb2NrQmFja2VuZCwge1xuICogICAgICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAqICAgICAgICAgc3ViVHlwZTogJ2NyZWF0ZScsXG4gKiAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAqICAgICAgIH0pO1xuICogICAgIH0pO1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKi9cblxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuLi9tYW5hZ2VyJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IHtcbiAgT2JzZXJ2YXRpb25Db250ZXh0LFxuICBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQsXG4gIHJ1bldpdGhDb250ZXh0LFxuICBydW5XaXRoQ29udGV4dFN5bmMsXG59IGZyb20gJy4uL2NvbnRleHQnO1xuaW1wb3J0IHsgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSB9IGZyb20gJy4uL3V0aWxzL3NvdXJjZS11dGlscyc7XG5cbi8qKlxuICogTW9jayBiYWNrZW5kIHRoYXQgY2FwdHVyZXMgYWxsIGV2ZW50cyBmb3IgdGVzdGluZ1xuICovXG5leHBvcnQgY2xhc3MgTW9ja0JhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ21vY2snO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG4gIHByaXZhdGUgZmx1c2hDb3VudCA9IDA7XG4gIHByaXZhdGUgaW52b2NhdGlvbkNvdW50ID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zPzogeyBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbCB9KSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG9wdGlvbnM/Lm1pbkxldmVsO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5ldmVudHMucHVzaCh7IC4uLmV2ZW50IH0pO1xuICB9XG5cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5mbHVzaENvdW50Kys7XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmludm9jYXRpb25Db3VudCsrO1xuICB9XG5cbiAgLy8gPT09IFRlc3QgSGVscGVycyA9PT1cblxuICAvKipcbiAgICogR2V0IGFsbCBjYXB0dXJlZCBldmVudHNcbiAgICovXG4gIGdldEV2ZW50cygpOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gICAgcmV0dXJuIFsgLi4udGhpcy5ldmVudHMgXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnRzIG1hdGNoaW5nIGEgZmlsdGVyXG4gICAqL1xuICBnZXRFdmVudHNNYXRjaGluZyhmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50Pik6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKGV2ZW50ID0+IHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVyKSkge1xuICAgICAgICBpZiAoZXZlbnRbIGtleSBhcyBrZXlvZiBPYnNlcnZhYmlsaXR5RXZlbnQgXSAhPT0gdmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBldmVudHMgYnkgdHlwZVxuICAgKi9cbiAgZ2V0RXZlbnRzQnlUeXBlKHR5cGU6IHN0cmluZyk6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKGUgPT4gZS50eXBlID09PSB0eXBlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnRzIGJ5IGxldmVsXG4gICAqL1xuICBnZXRFdmVudHNCeUxldmVsKGxldmVsOiBzdHJpbmcpOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmZpbHRlcihlID0+IGUubGV2ZWwgPT09IGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIGxhc3QgY2FwdHVyZWQgZXZlbnRcbiAgICovXG4gIGdldExhc3RFdmVudCgpOiBPYnNlcnZhYmlsaXR5RXZlbnQgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmV2ZW50c1sgdGhpcy5ldmVudHMubGVuZ3RoIC0gMSBdO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGFueSBldmVudCBtYXRjaGVzIHRoZSBmaWx0ZXJcbiAgICovXG4gIGhhc0V2ZW50KGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0RXZlbnRzTWF0Y2hpbmcoZmlsdGVyKS5sZW5ndGggPiAwO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBudW1iZXIgb2YgZmx1c2ggY2FsbHNcbiAgICovXG4gIGdldEZsdXNoQ291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5mbHVzaENvdW50O1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBudW1iZXIgb2YgaW52b2NhdGlvbiBpbml0aWFsaXphdGlvbnNcbiAgICovXG4gIGdldEludm9jYXRpb25Db3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmludm9jYXRpb25Db3VudDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhciBhbGwgY2FwdHVyZWQgZXZlbnRzIGFuZCBjb3VudGVyc1xuICAgKi9cbiAgcmVzZXQoKTogdm9pZCB7XG4gICAgdGhpcy5ldmVudHMgPSBbXTtcbiAgICB0aGlzLmZsdXNoQ291bnQgPSAwO1xuICAgIHRoaXMuaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgZXZlbnQgY291bnRcbiAgICovXG4gIGdldCBldmVudENvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzLmxlbmd0aDtcbiAgfVxufVxuXG4vKipcbiAqIFNldCB1cCBvYnNlcnZhYmlsaXR5IGZvciB0ZXN0aW5nXG4gKiBcbiAqIEByZXR1cm5zIE1vY2tCYWNrZW5kIGluc3RhbmNlIGZvciBhc3NlcnRpb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KG9wdGlvbnM/OiB7XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuICBlbmFibGVkPzogYm9vbGVhbjtcbn0pOiBNb2NrQmFja2VuZCB7XG4gIC8vIFJlc2V0IG1hbmFnZXIgc3RhdGVcbiAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcblxuICAvLyBDbGVhciBjYWNoZWQgZW52aXJvbm1lbnQgdGFnc1xuICBjbGVhckVudmlyb25tZW50VGFnc0NhY2hlKCk7XG5cbiAgLy8gQ3JlYXRlIG1vY2sgYmFja2VuZFxuICBjb25zdCBtb2NrQmFja2VuZCA9IG5ldyBNb2NrQmFja2VuZCh7IG1pbkxldmVsOiBvcHRpb25zPy5taW5MZXZlbCB9KTtcblxuICAvLyBJbml0aWFsaXplIGZvciB0ZXN0aW5nIHdpdGggbW9jayBiYWNrZW5kXG4gIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVGb3JUZXN0aW5nKFxuICAgIGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgICAgZW5hYmxlZDogb3B0aW9ucz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgbWluTGV2ZWw6IG9wdGlvbnM/Lm1pbkxldmVsID8/IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICB9KSxcbiAgICBbIG1vY2tCYWNrZW5kIF1cbiAgKTtcblxuICByZXR1cm4gbW9ja0JhY2tlbmQ7XG59XG5cbi8qKlxuICogQ2xlYW4gdXAgdGVzdCBvYnNlcnZhYmlsaXR5IChjYWxsIGluIGFmdGVyRWFjaClcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSgpOiB2b2lkIHtcbiAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgY2xlYXJFbnZpcm9ubWVudFRhZ3NDYWNoZSgpO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHRlc3Qgb2JzZXJ2YXRpb24gY29udGV4dCBhbmQgcnVuIGEgZnVuY3Rpb24gd2l0aGluIGl0XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVUZXN0Q29udGV4dDxUPihcbiAgZm46ICgpID0+IFByb21pc2U8VD4sXG4gIG9wdGlvbnM/OiB7XG4gICAgY29ycmVsYXRpb25JZD86IHN0cmluZztcbiAgICBhY3Rvcj86IEFjdG9yO1xuICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICB9XG4pOiBQcm9taXNlPFQ+IHtcbiAgY29uc3QgY29udGV4dCA9IGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChcbiAgICBvcHRpb25zPy5jb3JyZWxhdGlvbklkID8/IGB0ZXN0LSR7cmFuZG9tVVVJRCgpfWAsXG4gICAge1xuICAgICAgYWN0b3I6IG9wdGlvbnM/LmFjdG9yLFxuICAgICAgdGFnczogb3B0aW9ucz8udGFncyxcbiAgICB9XG4gICk7XG4gIHJldHVybiBydW5XaXRoQ29udGV4dChjb250ZXh0LCBmbik7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgdGVzdCBvYnNlcnZhdGlvbiBjb250ZXh0IGFuZCBydW4gYSBzeW5jIGZ1bmN0aW9uIHdpdGhpbiBpdFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVGVzdENvbnRleHRTeW5jPFQ+KFxuICBmbjogKCkgPT4gVCxcbiAgb3B0aW9ucz86IHtcbiAgICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH1cbik6IFQge1xuICBjb25zdCBjb250ZXh0ID0gY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KFxuICAgIG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQgPz8gYHRlc3QtJHtyYW5kb21VVUlEKCl9YCxcbiAgICB7XG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIHJ1bldpdGhDb250ZXh0U3luYyhjb250ZXh0LCBmbik7XG59XG5cbi8qKlxuICogQXNzZXJ0IHRoYXQgYW4gZXZlbnQgd2FzIGNhcHR1cmVkIG1hdGNoaW5nIHRoZSBmaWx0ZXJcbiAqIEB0aHJvd3MgRXJyb3IgaWYgbm8gbWF0Y2hpbmcgZXZlbnQgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydEV2ZW50Q2FwdHVyZWQoXG4gIGJhY2tlbmQ6IE1vY2tCYWNrZW5kLFxuICBmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PixcbiAgbWVzc2FnZT86IHN0cmluZ1xuKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoaW5nID0gYmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyhmaWx0ZXIpO1xuICBpZiAobWF0Y2hpbmcubGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY2FwdHVyZWQgPSBiYWNrZW5kLmdldEV2ZW50cygpO1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIG1lc3NhZ2UgPz9cbiAgICAgIGBFeHBlY3RlZCBldmVudCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KGZpbHRlcil9IGJ1dCBmb3VuZCBub25lLiBgICtcbiAgICAgIGBDYXB0dXJlZCBldmVudHM6ICR7SlNPTi5zdHJpbmdpZnkoY2FwdHVyZWQubWFwKGUgPT4gKHsgdHlwZTogZS50eXBlLCBzdWJUeXBlOiBlLnN1YlR5cGUsIG9wZXJhdGlvbjogZS5vcGVyYXRpb24gfSkpKX1gXG4gICAgKTtcbiAgfVxufVxuXG4vKipcbiAqIEFzc2VydCB0aGF0IG5vIGV2ZW50IHdhcyBjYXB0dXJlZCBtYXRjaGluZyB0aGUgZmlsdGVyXG4gKiBAdGhyb3dzIEVycm9yIGlmIGEgbWF0Y2hpbmcgZXZlbnQgd2FzIGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnROb0V2ZW50Q2FwdHVyZWQoXG4gIGJhY2tlbmQ6IE1vY2tCYWNrZW5kLFxuICBmaWx0ZXI6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PixcbiAgbWVzc2FnZT86IHN0cmluZ1xuKTogdm9pZCB7XG4gIGNvbnN0IG1hdGNoaW5nID0gYmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyhmaWx0ZXIpO1xuICBpZiAobWF0Y2hpbmcubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIG1lc3NhZ2UgPz9cbiAgICAgIGBFeHBlY3RlZCBubyBldmVudCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KGZpbHRlcil9IGJ1dCBmb3VuZCAke21hdGNoaW5nLmxlbmd0aH1gXG4gICAgKTtcbiAgfVxufVxuXG4vKipcbiAqIEFzc2VydCB0aGUgbnVtYmVyIG9mIGNhcHR1cmVkIGV2ZW50c1xuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0RXZlbnRDb3VudChcbiAgYmFja2VuZDogTW9ja0JhY2tlbmQsXG4gIGNvdW50OiBudW1iZXIsXG4gIGZpbHRlcj86IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PlxuKTogdm9pZCB7XG4gIGNvbnN0IGV2ZW50cyA9IGZpbHRlclxuICAgID8gYmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyhmaWx0ZXIpXG4gICAgOiBiYWNrZW5kLmdldEV2ZW50cygpO1xuXG4gIGlmIChldmVudHMubGVuZ3RoICE9PSBjb3VudCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBFeHBlY3RlZCAke2NvdW50fSBldmVudHMke2ZpbHRlciA/IGAgbWF0Y2hpbmcgJHtKU09OLnN0cmluZ2lmeShmaWx0ZXIpfWAgOiAnJ30gYCArXG4gICAgICBgYnV0IGZvdW5kICR7ZXZlbnRzLmxlbmd0aH1gXG4gICAgKTtcbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZSBhIG1vY2sgYWN0b3IgZm9yIHRlc3RpbmdcbiAqIEFjdG9yIGludGVyZmFjZSByZXF1aXJlcyByZXF1ZXN0SWQgYW5kIHRpbWVzdGFtcCwgd2UgcHJvdmlkZSBkZWZhdWx0cyBmb3IgY29udmVuaWVuY2VcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRlc3RBY3RvcihvdmVycmlkZXM/OiBQYXJ0aWFsPEFjdG9yPik6IEFjdG9yIHtcbiAgY29uc3QgYmFzZTogQWN0b3IgPSB7XG4gICAgcmVxdWVzdElkOiBgcmVxLSR7cmFuZG9tVVVJRCgpfWAsXG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgYWN0b3JJZDogYHVzZXItJHtyYW5kb21VVUlEKCl9YCxcbiAgICBhY3RvclR5cGU6ICd1c2VyJyxcbiAgICB0ZW5hbnRJZDogJ3Rlc3QtdGVuYW50JyxcbiAgICBzZXNzaW9uSWQ6IGBzZXNzaW9uLSR7cmFuZG9tVVVJRCgpfWAsXG4gIH07XG4gIHJldHVybiB7IC4uLmJhc2UsIC4uLm92ZXJyaWRlcyB9O1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIHRlc3Qgb2JzZXJ2YXRpb24gY29udGV4dCBvYmplY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVRlc3RPYnNlcnZhdGlvbkNvbnRleHQob3ZlcnJpZGVzPzogUGFydGlhbDxPYnNlcnZhdGlvbkNvbnRleHQ+KTogT2JzZXJ2YXRpb25Db250ZXh0IHtcbiAgcmV0dXJuIGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dChcbiAgICBvdmVycmlkZXM/LmNvcnJlbGF0aW9uSWQgPz8gYHRlc3QtJHtyYW5kb21VVUlEKCl9YCxcbiAgICB7XG4gICAgICBzb3VyY2U6IG92ZXJyaWRlcz8uc291cmNlID8/ICd0ZXN0JyxcbiAgICAgIGFjdG9yOiBvdmVycmlkZXM/LmFjdG9yLFxuICAgICAgdGFnczogb3ZlcnJpZGVzPy50YWdzLFxuICAgICAgc2FtcGxlZDogb3ZlcnJpZGVzPy5zYW1wbGVkLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBvdmVycmlkZXM/LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICB9XG4gICk7XG59XG5cbiJdfQ==