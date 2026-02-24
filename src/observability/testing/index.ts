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

import { randomUUID } from 'crypto';
import { Actor } from '../../core/types/execution-context';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
import { ObservabilityManager } from '../manager';
import { createObservabilityConfig } from '../config';
import {
  ExecutionContextData,
  createExecutionContext,
  runWithExecutionContext,
  runWithExecutionContextSync,
} from '../context';
import { clearEnvironmentTagsCache } from '../utils/source-utils';
import type { AbsorbedData } from '../noise-reduction/types';

/**
 * Mock backend that captures all events for testing
 */
export class MockBackend implements ObservabilityBackend {
  public readonly name = 'mock';
  public readonly minLevel?: ObservabilityLevel;

  private events: ObservabilityEvent[] = [];
  private flushCount = 0;
  private invocationCount = 0;

  constructor(options?: { minLevel?: ObservabilityLevel }) {
    this.minLevel = options?.minLevel;
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async flush(): Promise<void> {
    this.flushCount++;
  }

  initializeInvocation(): void {
    this.invocationCount++;
  }

  // === Test Helpers ===

  /**
   * Get all captured events
   */
  getEvents(): ObservabilityEvent[] {
    return [ ...this.events ];
  }

  /**
   * Get events matching a filter
   */
  getEventsMatching(filter: Partial<ObservabilityEvent>): ObservabilityEvent[] {
    return this.events.filter(event => {
      for (const [ key, value ] of Object.entries(filter)) {
        if (event[ key as keyof ObservabilityEvent ] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Get events by type
   */
  getEventsByType(type: string): ObservabilityEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Get events by level
   */
  getEventsByLevel(level: string): ObservabilityEvent[] {
    return this.events.filter(e => e.level === level);
  }

  /**
   * Get the last captured event
   */
  getLastEvent(): ObservabilityEvent | undefined {
    return this.events[ this.events.length - 1 ];
  }

  /**
   * Check if any event matches the filter
   */
  hasEvent(filter: Partial<ObservabilityEvent>): boolean {
    return this.getEventsMatching(filter).length > 0;
  }

  /**
   * Get number of flush calls
   */
  getFlushCount(): number {
    return this.flushCount;
  }

  /**
   * Get number of invocation initializations
   */
  getInvocationCount(): number {
    return this.invocationCount;
  }

  /**
   * Clear all captured events and counters
   */
  reset(): void {
    this.events = [];
    this.flushCount = 0;
    this.invocationCount = 0;
  }

  /**
   * Get event count
   */
  get eventCount(): number {
    return this.events.length;
  }

  // === Absorbed Data Helpers ===

  /**
   * Get events that have absorbed data attached (i.e., events that absorbed children).
   * Absorbed data lives at event.data.absorbed.
   */
  getEventsWithAbsorbed(): ObservabilityEvent[] {
    return this.events.filter(e => (e.data as any)?.absorbed != null);
  }

  /**
   * Get the absorbed data for a specific event (by operation or filter).
   * Returns undefined if the event has no absorbed data.
   */
  getAbsorbedData(filter: Partial<ObservabilityEvent>): AbsorbedData | undefined {
    const matching = this.getEventsMatching(filter);
    if (matching.length === 0) return undefined;
    return (matching[0].data as any)?.absorbed as AbsorbedData | undefined;
  }

  /**
   * Assert that a captured event has absorbed children.
   * @throws Error if no matching event or the event has no absorbed data.
   */
  assertHasAbsorbed(filter: Partial<ObservabilityEvent>, message?: string): AbsorbedData {
    const matching = this.getEventsMatching(filter);
    if (matching.length === 0) {
      throw new Error(
        message ?? `Expected event matching ${JSON.stringify(filter)} but found none.`
      );
    }
    const absorbed = (matching[0].data as any)?.absorbed as AbsorbedData | undefined;
    if (!absorbed) {
      throw new Error(
        message ?? `Expected event matching ${JSON.stringify(filter)} to have absorbed data, but data.absorbed is ${absorbed}.`
      );
    }
    return absorbed;
  }

  /**
   * Assert that absorbed data contains a specific number of absorbed children.
   */
  assertAbsorbedCount(filter: Partial<ObservabilityEvent>, expectedCount: number, message?: string): void {
    const absorbed = this.assertHasAbsorbed(filter, message);
    if (absorbed.count !== expectedCount) {
      throw new Error(
        message ?? `Expected absorbed count ${expectedCount} but got ${absorbed.count} for event matching ${JSON.stringify(filter)}.`
      );
    }
  }
}

/**
 * Set up observability for testing
 *
 * @returns MockBackend instance for assertions
 */
export function setupTestObservability(options?: {
  minLevel?: ObservabilityLevel;
  enabled?: boolean;
  /** Skip empty spans (default: false for testing) */
  skipEmptySpans?: boolean;
  /** Minimum span duration to capture in ms (default: 0 for testing to capture all spans) */
  minSpanDurationMs?: number;
}): MockBackend {
  // Reset manager state
  ObservabilityManager.reset();

  // Clear cached environment tags
  clearEnvironmentTagsCache();

  // Create mock backend
  const mockBackend = new MockBackend({ minLevel: options?.minLevel });

  // Initialize for testing with mock backend
  // By default, disable skipEmpty and minDurationMs for testing so all spans are captured
  ObservabilityManager.initializeForTesting(
    createObservabilityConfig({
      enabled: options?.enabled ?? true,
      minLevel: options?.minLevel ?? ObservabilityLevel.TRACE,
      spans: {
        skipEmpty: options?.skipEmptySpans ?? false,  // Default false for testing
        minDurationMs: options?.minSpanDurationMs ?? 0,  // Default 0 for testing - capture all spans
      },
    }),
    [ mockBackend ]
  );

  return mockBackend;
}

/**
 * Clean up test observability (call in afterEach)
 */
export function cleanupTestObservability(): void {
  ObservabilityManager.reset();
  clearEnvironmentTagsCache();
}

/**
 * Create a test execution context and run a function within it
 */
export async function createTestContext<T>(
  fn: () => Promise<T>,
  options?: {
    correlationId?: string;
    causedBy?: string;
    actor?: Actor;
    tags?: Record<string, string>;
  }
): Promise<T> {
  const context = createExecutionContext({
    correlationId: options?.correlationId ?? `test-${randomUUID()}`,
    causedBy: options?.causedBy,
    actor: options?.actor,
    tags: options?.tags,
  });
  return runWithExecutionContext(context, fn);
}

/**
 * Create a test execution context and run a sync function within it
 */
export function createTestContextSync<T>(
  fn: () => T,
  options?: {
    correlationId?: string;
    causedBy?: string;
    actor?: Actor;
    tags?: Record<string, string>;
  }
): T {
  const context = createExecutionContext({
    correlationId: options?.correlationId ?? `test-${randomUUID()}`,
    causedBy: options?.causedBy,
    actor: options?.actor,
    tags: options?.tags,
  });
  return runWithExecutionContextSync(context, fn);
}

/**
 * Assert that an event was captured matching the filter
 * @throws Error if no matching event found
 */
export function assertEventCaptured(
  backend: MockBackend,
  filter: Partial<ObservabilityEvent>,
  message?: string
): void {
  const matching = backend.getEventsMatching(filter);
  if (matching.length === 0) {
    const captured = backend.getEvents();
    throw new Error(
      message ??
      `Expected event matching ${JSON.stringify(filter)} but found none. ` +
      `Captured events: ${JSON.stringify(captured.map(e => ({ type: e.type, subType: e.subType, operation: e.operation })))}`
    );
  }
}

/**
 * Assert that no event was captured matching the filter
 * @throws Error if a matching event was found
 */
export function assertNoEventCaptured(
  backend: MockBackend,
  filter: Partial<ObservabilityEvent>,
  message?: string
): void {
  const matching = backend.getEventsMatching(filter);
  if (matching.length > 0) {
    throw new Error(
      message ??
      `Expected no event matching ${JSON.stringify(filter)} but found ${matching.length}`
    );
  }
}

/**
 * Assert the number of captured events
 */
export function assertEventCount(
  backend: MockBackend,
  count: number,
  filter?: Partial<ObservabilityEvent>
): void {
  const events = filter
    ? backend.getEventsMatching(filter)
    : backend.getEvents();

  if (events.length !== count) {
    throw new Error(
      `Expected ${count} events${filter ? ` matching ${JSON.stringify(filter)}` : ''} ` +
      `but found ${events.length}`
    );
  }
}

/**
 * Create a mock actor for testing
 * Actor interface requires requestId and timestamp, we provide defaults for convenience
 */
export function createTestActor(overrides?: Partial<Actor>): Actor {
  const base: Actor = {
    requestId: `req-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    actorId: `user-${randomUUID()}`,
    actorType: 'user',
    tenantId: 'test-tenant',
    sessionId: `session-${randomUUID()}`,
  };
  return { ...base, ...overrides };
}

/**
 * Create a test execution context object
 */
export function createTestExecutionContext(overrides?: Partial<ExecutionContextData>): ExecutionContextData {
  return createExecutionContext({
    correlationId: overrides?.correlationId ?? `test-${randomUUID()}`,
    source: overrides?.observability?.source ?? 'test',
    actor: overrides?.actor,
    tags: overrides?.observability?.tags,
    sampled: overrides?.observability?.sampled,
  });
}
