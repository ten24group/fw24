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
    // Create and register mock backend
    const mockBackend = new MockBackend({ minLevel: options?.minLevel });
    // Initialize with mock backend - disable sampling for tests
    manager_1.ObservabilityManager.initialize({
        enabled: options?.enabled ?? true,
        minLevel: options?.minLevel ?? types_1.ObservabilityLevel.TRACE,
        sampling: {
            enabled: false,
            rates: {
                [types_1.ObservabilityLevel.TRACE]: 1,
                [types_1.ObservabilityLevel.DEBUG]: 1,
                [types_1.ObservabilityLevel.INFO]: 1,
                [types_1.ObservabilityLevel.WARN]: 1,
                [types_1.ObservabilityLevel.ERROR]: 1,
                [types_1.ObservabilityLevel.CRITICAL]: 1,
                [types_1.ObservabilityLevel.OFF]: 0,
            },
        },
        backends: [],
    }, [mockBackend]);
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
 * ObservationContext requires correlationId, we provide a default for convenience
 */
function createTestObservationContext(overrides) {
    const base = {
        correlationId: `test-${(0, crypto_1.randomUUID)()}`,
        source: 'test',
    };
    return { ...base, ...overrides };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS90ZXN0aW5nL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FzQ0c7OztBQStISCx3REFvQ0M7QUFLRCw0REFHQztBQUtELDhDQWdCQztBQUtELHNEQWdCQztBQU1ELGtEQWNDO0FBTUQsc0RBWUM7QUFLRCw0Q0FlQztBQU1ELDBDQVVDO0FBTUQsb0VBTUM7QUF6U0QsbUNBQW9DO0FBRXBDLG9DQUE0RztBQUM1Ryx3Q0FBa0Q7QUFDbEQsd0NBSW9CO0FBQ3BCLHdEQUFrRTtBQUVsRTs7R0FFRztBQUNILE1BQWEsV0FBVztJQUNOLElBQUksR0FBRyxNQUFNLENBQUM7SUFDZCxRQUFRLENBQXNCO0lBRXRDLE1BQU0sR0FBeUIsRUFBRSxDQUFDO0lBQ2xDLFVBQVUsR0FBRyxDQUFDLENBQUM7SUFDZixlQUFlLEdBQUcsQ0FBQyxDQUFDO0lBRTVCLFlBQVksT0FBMkM7UUFDckQsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLEVBQUUsUUFBUSxDQUFDO0lBQ3BDLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQXlCO1FBQ3JDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBQ2pDLENBQUM7SUFFRCxLQUFLLENBQUMsS0FBSztRQUNULElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztJQUNwQixDQUFDO0lBRUQsb0JBQW9CO1FBQ2xCLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztJQUN6QixDQUFDO0lBRUQsdUJBQXVCO0lBRXZCOztPQUVHO0lBQ0gsU0FBUztRQUNQLE9BQU8sQ0FBRSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUUsQ0FBQztJQUM1QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxpQkFBaUIsQ0FBQyxNQUFtQztRQUNuRCxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFO1lBQ2hDLEtBQUssTUFBTSxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQ3BELElBQUksS0FBSyxDQUFFLEdBQStCLENBQUUsS0FBSyxLQUFLLEVBQUUsQ0FBQztvQkFDdkQsT0FBTyxLQUFLLENBQUM7Z0JBQ2YsQ0FBQztZQUNILENBQUM7WUFDRCxPQUFPLElBQUksQ0FBQztRQUNkLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsZUFBZSxDQUFDLElBQVk7UUFDMUIsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUM7SUFDbEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsZ0JBQWdCLENBQUMsS0FBYTtRQUM1QixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssS0FBSyxLQUFLLENBQUMsQ0FBQztJQUNwRCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxZQUFZO1FBQ1YsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBRSxDQUFDO0lBQy9DLENBQUM7SUFFRDs7T0FFRztJQUNILFFBQVEsQ0FBQyxNQUFtQztRQUMxQyxPQUFPLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRDs7T0FFRztJQUNILGFBQWE7UUFDWCxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUM7SUFDekIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsa0JBQWtCO1FBQ2hCLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQztJQUM5QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLO1FBQ0gsSUFBSSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7UUFDakIsSUFBSSxDQUFDLFVBQVUsR0FBRyxDQUFDLENBQUM7UUFDcEIsSUFBSSxDQUFDLGVBQWUsR0FBRyxDQUFDLENBQUM7SUFDM0IsQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBSSxVQUFVO1FBQ1osT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQztJQUM1QixDQUFDO0NBQ0Y7QUF4R0Qsa0NBd0dDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQWdCLHNCQUFzQixDQUFDLE9BR3RDO0lBQ0Msc0JBQXNCO0lBQ3RCLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO0lBRTdCLGdDQUFnQztJQUNoQyxJQUFBLHdDQUF5QixHQUFFLENBQUM7SUFFNUIsbUNBQW1DO0lBQ25DLE1BQU0sV0FBVyxHQUFHLElBQUksV0FBVyxDQUFDLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO0lBRXJFLDREQUE0RDtJQUM1RCw4QkFBb0IsQ0FBQyxVQUFVLENBQzdCO1FBQ0UsT0FBTyxFQUFFLE9BQU8sRUFBRSxPQUFPLElBQUksSUFBSTtRQUNqQyxRQUFRLEVBQUUsT0FBTyxFQUFFLFFBQVEsSUFBSSwwQkFBa0IsQ0FBQyxLQUFLO1FBQ3ZELFFBQVEsRUFBRTtZQUNSLE9BQU8sRUFBRSxLQUFLO1lBQ2QsS0FBSyxFQUFFO2dCQUNMLENBQUUsMEJBQWtCLENBQUMsS0FBSyxDQUFFLEVBQUUsQ0FBQztnQkFDL0IsQ0FBRSwwQkFBa0IsQ0FBQyxLQUFLLENBQUUsRUFBRSxDQUFDO2dCQUMvQixDQUFFLDBCQUFrQixDQUFDLElBQUksQ0FBRSxFQUFFLENBQUM7Z0JBQzlCLENBQUUsMEJBQWtCLENBQUMsSUFBSSxDQUFFLEVBQUUsQ0FBQztnQkFDOUIsQ0FBRSwwQkFBa0IsQ0FBQyxLQUFLLENBQUUsRUFBRSxDQUFDO2dCQUMvQixDQUFFLDBCQUFrQixDQUFDLFFBQVEsQ0FBRSxFQUFFLENBQUM7Z0JBQ2xDLENBQUUsMEJBQWtCLENBQUMsR0FBRyxDQUFFLEVBQUUsQ0FBQzthQUM5QjtTQUNGO1FBQ0QsUUFBUSxFQUFFLEVBQUU7S0FDYixFQUNELENBQUUsV0FBVyxDQUFFLENBQ2hCLENBQUM7SUFFRixPQUFPLFdBQVcsQ0FBQztBQUNyQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQix3QkFBd0I7SUFDdEMsOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDN0IsSUFBQSx3Q0FBeUIsR0FBRSxDQUFDO0FBQzlCLENBQUM7QUFFRDs7R0FFRztBQUNJLEtBQUssVUFBVSxpQkFBaUIsQ0FDckMsRUFBb0IsRUFDcEIsT0FJQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUEsa0NBQXdCLEVBQ3RDLE9BQU8sRUFBRSxhQUFhLElBQUksUUFBUSxJQUFBLG1CQUFVLEdBQUUsRUFBRSxFQUNoRDtRQUNFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSztRQUNyQixJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUk7S0FDcEIsQ0FDRixDQUFDO0lBQ0YsT0FBTyxJQUFBLHdCQUFjLEVBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQ3JDLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLHFCQUFxQixDQUNuQyxFQUFXLEVBQ1gsT0FJQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUEsa0NBQXdCLEVBQ3RDLE9BQU8sRUFBRSxhQUFhLElBQUksUUFBUSxJQUFBLG1CQUFVLEdBQUUsRUFBRSxFQUNoRDtRQUNFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSztRQUNyQixJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUk7S0FDcEIsQ0FDRixDQUFDO0lBQ0YsT0FBTyxJQUFBLDRCQUFrQixFQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztBQUN6QyxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsbUJBQW1CLENBQ2pDLE9BQW9CLEVBQ3BCLE1BQW1DLEVBQ25DLE9BQWdCO0lBRWhCLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNuRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDMUIsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sSUFBSSxLQUFLLENBQ2IsT0FBTztZQUNQLDJCQUEyQixJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUI7Z0JBQ3BFLG9CQUFvQixJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUN4SCxDQUFDO0lBQ0osQ0FBQztBQUNILENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixxQkFBcUIsQ0FDbkMsT0FBb0IsRUFDcEIsTUFBbUMsRUFDbkMsT0FBZ0I7SUFFaEIsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ25ELElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN4QixNQUFNLElBQUksS0FBSyxDQUNiLE9BQU87WUFDUCw4QkFBOEIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsY0FBYyxRQUFRLENBQUMsTUFBTSxFQUFFLENBQ3BGLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsZ0JBQWdCLENBQzlCLE9BQW9CLEVBQ3BCLEtBQWEsRUFDYixNQUFvQztJQUVwQyxNQUFNLE1BQU0sR0FBRyxNQUFNO1FBQ25CLENBQUMsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUMsTUFBTSxDQUFDO1FBQ25DLENBQUMsQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7SUFFeEIsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLEtBQUssRUFBRSxDQUFDO1FBQzVCLE1BQU0sSUFBSSxLQUFLLENBQ2IsWUFBWSxLQUFLLFVBQVUsTUFBTSxDQUFDLENBQUMsQ0FBQyxhQUFhLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHO1lBQ2pGLGFBQWEsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUM3QixDQUFDO0lBQ0osQ0FBQztBQUNILENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFnQixlQUFlLENBQUMsU0FBMEI7SUFDeEQsTUFBTSxJQUFJLEdBQVU7UUFDbEIsU0FBUyxFQUFFLE9BQU8sSUFBQSxtQkFBVSxHQUFFLEVBQUU7UUFDaEMsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1FBQ25DLE9BQU8sRUFBRSxRQUFRLElBQUEsbUJBQVUsR0FBRSxFQUFFO1FBQy9CLFNBQVMsRUFBRSxNQUFNO1FBQ2pCLFFBQVEsRUFBRSxhQUFhO1FBQ3ZCLFNBQVMsRUFBRSxXQUFXLElBQUEsbUJBQVUsR0FBRSxFQUFFO0tBQ3JDLENBQUM7SUFDRixPQUFPLEVBQUUsR0FBRyxJQUFJLEVBQUUsR0FBRyxTQUFTLEVBQUUsQ0FBQztBQUNuQyxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsNEJBQTRCLENBQUMsU0FBdUM7SUFDbEYsTUFBTSxJQUFJLEdBQXVCO1FBQy9CLGFBQWEsRUFBRSxRQUFRLElBQUEsbUJBQVUsR0FBRSxFQUFFO1FBQ3JDLE1BQU0sRUFBRSxNQUFNO0tBQ2YsQ0FBQztJQUNGLE9BQU8sRUFBRSxHQUFHLElBQUksRUFBRSxHQUFHLFNBQVMsRUFBRSxDQUFDO0FBQ25DLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFRlc3RpbmcgdXRpbGl0aWVzIGZvciBvYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFByb3ZpZGVzIGhlbHBlcnMgZm9yIHRlc3RpbmcgY29kZSB0aGF0IHVzZXMgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtLlxuICogXG4gKiBVc2FnZTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IFxuICogICBNb2NrQmFja2VuZCwgXG4gKiAgIHNldHVwVGVzdE9ic2VydmFiaWxpdHksIFxuICogICBhc3NlcnRFdmVudENhcHR1cmVkLFxuICogICBjcmVhdGVUZXN0Q29udGV4dCBcbiAqIH0gZnJvbSAnQHRlbjI0Z3JvdXAvZncyNC9vYnNlcnZhYmlsaXR5L3Rlc3RpbmcnO1xuICogXG4gKiBkZXNjcmliZSgnTXlTZXJ2aWNlJywgKCkgPT4ge1xuICogICBsZXQgbW9ja0JhY2tlbmQ6IE1vY2tCYWNrZW5kO1xuICogICBcbiAqICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gKiAgICAgbW9ja0JhY2tlbmQgPSBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gKiAgIH0pO1xuICogICBcbiAqICAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAqICAgICBtb2NrQmFja2VuZC5yZXNldCgpO1xuICogICB9KTtcbiAqICAgXG4gKiAgIGl0KCdzaG91bGQgYXVkaXQgdXNlciBjcmVhdGlvbicsIGFzeW5jICgpID0+IHtcbiAqICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gKiAgICAgICBhd2FpdCBzZXJ2aWNlLmNyZWF0ZVVzZXIoeyBuYW1lOiAnVGVzdCcgfSk7XG4gKiAgICAgICBcbiAqICAgICAgIGFzc2VydEV2ZW50Q2FwdHVyZWQobW9ja0JhY2tlbmQsIHtcbiAqICAgICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gKiAgICAgICAgIHN1YlR5cGU6ICdjcmVhdGUnLFxuICogICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gKiAgICAgICB9KTtcbiAqICAgICB9KTtcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgQWN0b3IgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgT2JzZXJ2YXRpb25Db250ZXh0IH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuLi9tYW5hZ2VyJztcbmltcG9ydCB7XG4gIGNyZWF0ZU9ic2VydmF0aW9uQ29udGV4dCxcbiAgcnVuV2l0aENvbnRleHQsXG4gIHJ1bldpdGhDb250ZXh0U3luYyxcbn0gZnJvbSAnLi4vY29udGV4dCc7XG5pbXBvcnQgeyBjbGVhckVudmlyb25tZW50VGFnc0NhY2hlIH0gZnJvbSAnLi4vdXRpbHMvc291cmNlLXV0aWxzJztcblxuLyoqXG4gKiBNb2NrIGJhY2tlbmQgdGhhdCBjYXB0dXJlcyBhbGwgZXZlbnRzIGZvciB0ZXN0aW5nXG4gKi9cbmV4cG9ydCBjbGFzcyBNb2NrQmFja2VuZCBpbXBsZW1lbnRzIE9ic2VydmFiaWxpdHlCYWNrZW5kIHtcbiAgcHVibGljIHJlYWRvbmx5IG5hbWUgPSAnbW9jayc7XG4gIHB1YmxpYyByZWFkb25seSBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcblxuICBwcml2YXRlIGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgcHJpdmF0ZSBmbHVzaENvdW50ID0gMDtcbiAgcHJpdmF0ZSBpbnZvY2F0aW9uQ291bnQgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM/OiB7IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsIH0pIHtcbiAgICB0aGlzLm1pbkxldmVsID0gb3B0aW9ucz8ubWluTGV2ZWw7XG4gIH1cblxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmV2ZW50cy5wdXNoKHsgLi4uZXZlbnQgfSk7XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmZsdXNoQ291bnQrKztcbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIHRoaXMuaW52b2NhdGlvbkNvdW50Kys7XG4gIH1cblxuICAvLyA9PT0gVGVzdCBIZWxwZXJzID09PVxuXG4gIC8qKlxuICAgKiBHZXQgYWxsIGNhcHR1cmVkIGV2ZW50c1xuICAgKi9cbiAgZ2V0RXZlbnRzKCk6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gWyAuLi50aGlzLmV2ZW50cyBdO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBldmVudHMgbWF0Y2hpbmcgYSBmaWx0ZXJcbiAgICovXG4gIGdldEV2ZW50c01hdGNoaW5nKGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+KTogT2JzZXJ2YWJpbGl0eUV2ZW50W10ge1xuICAgIHJldHVybiB0aGlzLmV2ZW50cy5maWx0ZXIoZXZlbnQgPT4ge1xuICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhmaWx0ZXIpKSB7XG4gICAgICAgIGlmIChldmVudFsga2V5IGFzIGtleW9mIE9ic2VydmFiaWxpdHlFdmVudCBdICE9PSB2YWx1ZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGV2ZW50cyBieSB0eXBlXG4gICAqL1xuICBnZXRFdmVudHNCeVR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUV2ZW50W10ge1xuICAgIHJldHVybiB0aGlzLmV2ZW50cy5maWx0ZXIoZSA9PiBlLnR5cGUgPT09IHR5cGUpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBldmVudHMgYnkgbGV2ZWxcbiAgICovXG4gIGdldEV2ZW50c0J5TGV2ZWwobGV2ZWw6IHN0cmluZyk6IE9ic2VydmFiaWxpdHlFdmVudFtdIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMuZmlsdGVyKGUgPT4gZS5sZXZlbCA9PT0gbGV2ZWwpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgbGFzdCBjYXB0dXJlZCBldmVudFxuICAgKi9cbiAgZ2V0TGFzdEV2ZW50KCk6IE9ic2VydmFiaWxpdHlFdmVudCB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuZXZlbnRzWyB0aGlzLmV2ZW50cy5sZW5ndGggLSAxIF07XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgYW55IGV2ZW50IG1hdGNoZXMgdGhlIGZpbHRlclxuICAgKi9cbiAgaGFzRXZlbnQoZmlsdGVyOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4pOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5nZXRFdmVudHNNYXRjaGluZyhmaWx0ZXIpLmxlbmd0aCA+IDA7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG51bWJlciBvZiBmbHVzaCBjYWxsc1xuICAgKi9cbiAgZ2V0Rmx1c2hDb3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmZsdXNoQ291bnQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG51bWJlciBvZiBpbnZvY2F0aW9uIGluaXRpYWxpemF0aW9uc1xuICAgKi9cbiAgZ2V0SW52b2NhdGlvbkNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuaW52b2NhdGlvbkNvdW50O1xuICB9XG5cbiAgLyoqXG4gICAqIENsZWFyIGFsbCBjYXB0dXJlZCBldmVudHMgYW5kIGNvdW50ZXJzXG4gICAqL1xuICByZXNldCgpOiB2b2lkIHtcbiAgICB0aGlzLmV2ZW50cyA9IFtdO1xuICAgIHRoaXMuZmx1c2hDb3VudCA9IDA7XG4gICAgdGhpcy5pbnZvY2F0aW9uQ291bnQgPSAwO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBldmVudCBjb3VudFxuICAgKi9cbiAgZ2V0IGV2ZW50Q291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5ldmVudHMubGVuZ3RoO1xuICB9XG59XG5cbi8qKlxuICogU2V0IHVwIG9ic2VydmFiaWxpdHkgZm9yIHRlc3RpbmdcbiAqIFxuICogQHJldHVybnMgTW9ja0JhY2tlbmQgaW5zdGFuY2UgZm9yIGFzc2VydGlvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldHVwVGVzdE9ic2VydmFiaWxpdHkob3B0aW9ucz86IHtcbiAgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG4gIGVuYWJsZWQ/OiBib29sZWFuO1xufSk6IE1vY2tCYWNrZW5kIHtcbiAgLy8gUmVzZXQgbWFuYWdlciBzdGF0ZVxuICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuXG4gIC8vIENsZWFyIGNhY2hlZCBlbnZpcm9ubWVudCB0YWdzXG4gIGNsZWFyRW52aXJvbm1lbnRUYWdzQ2FjaGUoKTtcblxuICAvLyBDcmVhdGUgYW5kIHJlZ2lzdGVyIG1vY2sgYmFja2VuZFxuICBjb25zdCBtb2NrQmFja2VuZCA9IG5ldyBNb2NrQmFja2VuZCh7IG1pbkxldmVsOiBvcHRpb25zPy5taW5MZXZlbCB9KTtcblxuICAvLyBJbml0aWFsaXplIHdpdGggbW9jayBiYWNrZW5kIC0gZGlzYWJsZSBzYW1wbGluZyBmb3IgdGVzdHNcbiAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZShcbiAgICB7XG4gICAgICBlbmFibGVkOiBvcHRpb25zPy5lbmFibGVkID8/IHRydWUsXG4gICAgICBtaW5MZXZlbDogb3B0aW9ucz8ubWluTGV2ZWwgPz8gT2JzZXJ2YWJpbGl0eUxldmVsLlRSQUNFLFxuICAgICAgc2FtcGxpbmc6IHtcbiAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgIHJhdGVzOiB7XG4gICAgICAgICAgWyBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UgXTogMSxcbiAgICAgICAgICBbIE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyBdOiAxLFxuICAgICAgICAgIFsgT2JzZXJ2YWJpbGl0eUxldmVsLklORk8gXTogMSxcbiAgICAgICAgICBbIE9ic2VydmFiaWxpdHlMZXZlbC5XQVJOIF06IDEsXG4gICAgICAgICAgWyBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1IgXTogMSxcbiAgICAgICAgICBbIE9ic2VydmFiaWxpdHlMZXZlbC5DUklUSUNBTCBdOiAxLFxuICAgICAgICAgIFsgT2JzZXJ2YWJpbGl0eUxldmVsLk9GRiBdOiAwLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGJhY2tlbmRzOiBbXSxcbiAgICB9LFxuICAgIFsgbW9ja0JhY2tlbmQgXVxuICApO1xuXG4gIHJldHVybiBtb2NrQmFja2VuZDtcbn1cblxuLyoqXG4gKiBDbGVhbiB1cCB0ZXN0IG9ic2VydmFiaWxpdHkgKGNhbGwgaW4gYWZ0ZXJFYWNoKVxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5KCk6IHZvaWQge1xuICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICBjbGVhckVudmlyb25tZW50VGFnc0NhY2hlKCk7XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgdGVzdCBvYnNlcnZhdGlvbiBjb250ZXh0IGFuZCBydW4gYSBmdW5jdGlvbiB3aXRoaW4gaXRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVRlc3RDb250ZXh0PFQ+KFxuICBmbjogKCkgPT4gUHJvbWlzZTxUPixcbiAgb3B0aW9ucz86IHtcbiAgICBjb3JyZWxhdGlvbklkPzogc3RyaW5nO1xuICAgIGFjdG9yPzogQWN0b3I7XG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIH1cbik6IFByb21pc2U8VD4ge1xuICBjb25zdCBjb250ZXh0ID0gY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KFxuICAgIG9wdGlvbnM/LmNvcnJlbGF0aW9uSWQgPz8gYHRlc3QtJHtyYW5kb21VVUlEKCl9YCxcbiAgICB7XG4gICAgICBhY3Rvcjogb3B0aW9ucz8uYWN0b3IsXG4gICAgICB0YWdzOiBvcHRpb25zPy50YWdzLFxuICAgIH1cbiAgKTtcbiAgcmV0dXJuIHJ1bldpdGhDb250ZXh0KGNvbnRleHQsIGZuKTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSB0ZXN0IG9ic2VydmF0aW9uIGNvbnRleHQgYW5kIHJ1biBhIHN5bmMgZnVuY3Rpb24gd2l0aGluIGl0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVUZXN0Q29udGV4dFN5bmM8VD4oXG4gIGZuOiAoKSA9PiBULFxuICBvcHRpb25zPzoge1xuICAgIGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmc7XG4gICAgYWN0b3I/OiBBY3RvcjtcbiAgICB0YWdzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgfVxuKTogVCB7XG4gIGNvbnN0IGNvbnRleHQgPSBjcmVhdGVPYnNlcnZhdGlvbkNvbnRleHQoXG4gICAgb3B0aW9ucz8uY29ycmVsYXRpb25JZCA/PyBgdGVzdC0ke3JhbmRvbVVVSUQoKX1gLFxuICAgIHtcbiAgICAgIGFjdG9yOiBvcHRpb25zPy5hY3RvcixcbiAgICAgIHRhZ3M6IG9wdGlvbnM/LnRhZ3MsXG4gICAgfVxuICApO1xuICByZXR1cm4gcnVuV2l0aENvbnRleHRTeW5jKGNvbnRleHQsIGZuKTtcbn1cblxuLyoqXG4gKiBBc3NlcnQgdGhhdCBhbiBldmVudCB3YXMgY2FwdHVyZWQgbWF0Y2hpbmcgdGhlIGZpbHRlclxuICogQHRocm93cyBFcnJvciBpZiBubyBtYXRjaGluZyBldmVudCBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0RXZlbnRDYXB0dXJlZChcbiAgYmFja2VuZDogTW9ja0JhY2tlbmQsXG4gIGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+LFxuICBtZXNzYWdlPzogc3RyaW5nXG4pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2hpbmcgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcik7XG4gIGlmIChtYXRjaGluZy5sZW5ndGggPT09IDApIHtcbiAgICBjb25zdCBjYXB0dXJlZCA9IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgbWVzc2FnZSA/P1xuICAgICAgYEV4cGVjdGVkIGV2ZW50IG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkoZmlsdGVyKX0gYnV0IGZvdW5kIG5vbmUuIGAgK1xuICAgICAgYENhcHR1cmVkIGV2ZW50czogJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlZC5tYXAoZSA9PiAoeyB0eXBlOiBlLnR5cGUsIHN1YlR5cGU6IGUuc3ViVHlwZSwgb3BlcmF0aW9uOiBlLm9wZXJhdGlvbiB9KSkpfWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogQXNzZXJ0IHRoYXQgbm8gZXZlbnQgd2FzIGNhcHR1cmVkIG1hdGNoaW5nIHRoZSBmaWx0ZXJcbiAqIEB0aHJvd3MgRXJyb3IgaWYgYSBtYXRjaGluZyBldmVudCB3YXMgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydE5vRXZlbnRDYXB0dXJlZChcbiAgYmFja2VuZDogTW9ja0JhY2tlbmQsXG4gIGZpbHRlcjogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+LFxuICBtZXNzYWdlPzogc3RyaW5nXG4pOiB2b2lkIHtcbiAgY29uc3QgbWF0Y2hpbmcgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcik7XG4gIGlmIChtYXRjaGluZy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgbWVzc2FnZSA/P1xuICAgICAgYEV4cGVjdGVkIG5vIGV2ZW50IG1hdGNoaW5nICR7SlNPTi5zdHJpbmdpZnkoZmlsdGVyKX0gYnV0IGZvdW5kICR7bWF0Y2hpbmcubGVuZ3RofWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogQXNzZXJ0IHRoZSBudW1iZXIgb2YgY2FwdHVyZWQgZXZlbnRzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnRFdmVudENvdW50KFxuICBiYWNrZW5kOiBNb2NrQmFja2VuZCxcbiAgY291bnQ6IG51bWJlcixcbiAgZmlsdGVyPzogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+XG4pOiB2b2lkIHtcbiAgY29uc3QgZXZlbnRzID0gZmlsdGVyXG4gICAgPyBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKGZpbHRlcilcbiAgICA6IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG5cbiAgaWYgKGV2ZW50cy5sZW5ndGggIT09IGNvdW50KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEV4cGVjdGVkICR7Y291bnR9IGV2ZW50cyR7ZmlsdGVyID8gYCBtYXRjaGluZyAke0pTT04uc3RyaW5naWZ5KGZpbHRlcil9YCA6ICcnfSBgICtcbiAgICAgIGBidXQgZm91bmQgJHtldmVudHMubGVuZ3RofWBcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgbW9jayBhY3RvciBmb3IgdGVzdGluZ1xuICogQWN0b3IgaW50ZXJmYWNlIHJlcXVpcmVzIHJlcXVlc3RJZCBhbmQgdGltZXN0YW1wLCB3ZSBwcm92aWRlIGRlZmF1bHRzIGZvciBjb252ZW5pZW5jZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVGVzdEFjdG9yKG92ZXJyaWRlcz86IFBhcnRpYWw8QWN0b3I+KTogQWN0b3Ige1xuICBjb25zdCBiYXNlOiBBY3RvciA9IHtcbiAgICByZXF1ZXN0SWQ6IGByZXEtJHtyYW5kb21VVUlEKCl9YCxcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICBhY3RvcklkOiBgdXNlci0ke3JhbmRvbVVVSUQoKX1gLFxuICAgIGFjdG9yVHlwZTogJ3VzZXInLFxuICAgIHRlbmFudElkOiAndGVzdC10ZW5hbnQnLFxuICAgIHNlc3Npb25JZDogYHNlc3Npb24tJHtyYW5kb21VVUlEKCl9YCxcbiAgfTtcbiAgcmV0dXJuIHsgLi4uYmFzZSwgLi4ub3ZlcnJpZGVzIH07XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgdGVzdCBvYnNlcnZhdGlvbiBjb250ZXh0IG9iamVjdFxuICogT2JzZXJ2YXRpb25Db250ZXh0IHJlcXVpcmVzIGNvcnJlbGF0aW9uSWQsIHdlIHByb3ZpZGUgYSBkZWZhdWx0IGZvciBjb252ZW5pZW5jZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVGVzdE9ic2VydmF0aW9uQ29udGV4dChvdmVycmlkZXM/OiBQYXJ0aWFsPE9ic2VydmF0aW9uQ29udGV4dD4pOiBPYnNlcnZhdGlvbkNvbnRleHQge1xuICBjb25zdCBiYXNlOiBPYnNlcnZhdGlvbkNvbnRleHQgPSB7XG4gICAgY29ycmVsYXRpb25JZDogYHRlc3QtJHtyYW5kb21VVUlEKCl9YCxcbiAgICBzb3VyY2U6ICd0ZXN0JyxcbiAgfTtcbiAgcmV0dXJuIHsgLi4uYmFzZSwgLi4ub3ZlcnJpZGVzIH07XG59XG5cbiJdfQ==