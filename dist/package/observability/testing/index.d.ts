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
import { Actor } from '../../core/types/execution-context';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, ObservationContext } from '../types';
/**
 * Mock backend that captures all events for testing
 */
export declare class MockBackend implements ObservabilityBackend {
    readonly name = "mock";
    readonly minLevel?: ObservabilityLevel;
    private events;
    private flushCount;
    private invocationCount;
    constructor(options?: {
        minLevel?: ObservabilityLevel;
    });
    capture(event: ObservabilityEvent): Promise<void>;
    flush(): Promise<void>;
    initializeInvocation(): void;
    /**
     * Get all captured events
     */
    getEvents(): ObservabilityEvent[];
    /**
     * Get events matching a filter
     */
    getEventsMatching(filter: Partial<ObservabilityEvent>): ObservabilityEvent[];
    /**
     * Get events by type
     */
    getEventsByType(type: string): ObservabilityEvent[];
    /**
     * Get events by level
     */
    getEventsByLevel(level: string): ObservabilityEvent[];
    /**
     * Get the last captured event
     */
    getLastEvent(): ObservabilityEvent | undefined;
    /**
     * Check if any event matches the filter
     */
    hasEvent(filter: Partial<ObservabilityEvent>): boolean;
    /**
     * Get number of flush calls
     */
    getFlushCount(): number;
    /**
     * Get number of invocation initializations
     */
    getInvocationCount(): number;
    /**
     * Clear all captured events and counters
     */
    reset(): void;
    /**
     * Get event count
     */
    get eventCount(): number;
}
/**
 * Set up observability for testing
 *
 * @returns MockBackend instance for assertions
 */
export declare function setupTestObservability(options?: {
    minLevel?: ObservabilityLevel;
    enabled?: boolean;
}): MockBackend;
/**
 * Clean up test observability (call in afterEach)
 */
export declare function cleanupTestObservability(): void;
/**
 * Create a test observation context and run a function within it
 */
export declare function createTestContext<T>(fn: () => Promise<T>, options?: {
    correlationId?: string;
    actor?: Actor;
    tags?: Record<string, string>;
}): Promise<T>;
/**
 * Create a test observation context and run a sync function within it
 */
export declare function createTestContextSync<T>(fn: () => T, options?: {
    correlationId?: string;
    actor?: Actor;
    tags?: Record<string, string>;
}): T;
/**
 * Assert that an event was captured matching the filter
 * @throws Error if no matching event found
 */
export declare function assertEventCaptured(backend: MockBackend, filter: Partial<ObservabilityEvent>, message?: string): void;
/**
 * Assert that no event was captured matching the filter
 * @throws Error if a matching event was found
 */
export declare function assertNoEventCaptured(backend: MockBackend, filter: Partial<ObservabilityEvent>, message?: string): void;
/**
 * Assert the number of captured events
 */
export declare function assertEventCount(backend: MockBackend, count: number, filter?: Partial<ObservabilityEvent>): void;
/**
 * Create a mock actor for testing
 * Actor interface requires requestId and timestamp, we provide defaults for convenience
 */
export declare function createTestActor(overrides?: Partial<Actor>): Actor;
/**
 * Create a test observation context object
 * ObservationContext requires correlationId, we provide a default for convenience
 */
export declare function createTestObservationContext(overrides?: Partial<ObservationContext>): ObservationContext;
