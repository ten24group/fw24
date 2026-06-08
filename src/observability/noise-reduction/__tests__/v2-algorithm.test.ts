/**
 * Unit tests for the v2 noise reduction algorithm.
 * 
 * Tests cover:
 * 1. Basic decision application (emit, absorb, silent)
 * 2. Tree building and parent resolution
 * 3. Hard signal protection
 * 4. Hard signal ancestor context preservation
 * 5. Absorption data correctness (errors, causedBy, entityIds, operation stats)
 * 6. Bounds enforcement
 * 7. Edge cases (empty input, single event, orphan roots)
 * 8. span.start handling
 * 9. pickNoiseDecision convenience function
 */

import { applyNoiseReduction, pickNoiseDecision, buildAndEvaluate } from '../algorithm';
import type { NoiseReductionConfig, ObservabilityEvent } from '../../types';
import type { AbsorbedData, EmittedEvent } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

let idCounter = 0;

function makeEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  idCounter++;
  return {
    type: 'span',
    level: 'info',
    correlationId: 'corr-1',
    timestampMs: Date.now(),
    observabilityLogId: `evt-${idCounter}`,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NoiseReductionConfig> = {}): NoiseReductionConfig {
  return {
    enabled: true,
    presets: [],
    rules: [],
    maxAbsorbedErrorsPerSpan: 20,
    maxAbsorbedCausedByLinksPerSpan: 50,
    maxAbsorbedEntityIdsPerSpan: 100,
    maxAbsorbedOperationKeysPerSpan: 50,
    maxAbsorbedCheckpointsPerSpan: 100,
    ...overrides,
  };
}

function findEmitted(result: { events: readonly EmittedEvent[] }, logId: string): EmittedEvent | undefined {
  return result.events.find(e => e.event.observabilityLogId === logId);
}

beforeEach(() => {
  idCounter = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. BASIC DECISION APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('basic decisions', () => {
  test('disabled config passes all events through', () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const config = makeConfig({ enabled: false });

    const result = applyNoiseReduction(events, config);

    expect(result.events).toHaveLength(3);
    expect(result.stats.emitted).toBe(3);
    expect(result.stats.absorbed).toBe(0);
    expect(result.stats.silenced).toBe(0);
  });

  test('no matching rules → all events emitted', () => {
    const events = [makeEvent(), makeEvent()];
    const config = makeConfig();

    const result = applyNoiseReduction(events, config);

    expect(result.events).toHaveLength(2);
    expect(result.stats.emitted).toBe(2);
  });

  test('absorb rule removes event from output and adds data to parent', () => {
    const parent = makeEvent({ observabilityLogId: 'parent', operation: 'parentOp' });
    const child = makeEvent({
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      operation: 'childOp',
      type: 'log',
      durationMs: 42,
    });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([parent, child], config);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.observabilityLogId).toBe('parent');
    expect(result.stats.emitted).toBe(1);
    expect(result.stats.absorbed).toBe(1);

    const absorbed = result.events[0].absorbed;
    expect(absorbed).toBeDefined();
    expect(absorbed!.count).toBe(1);
    expect(absorbed!.byOperation['childOp']).toBeDefined();
    expect(absorbed!.byOperation['childOp'].count).toBe(1);
    expect(absorbed!.byOperation['childOp'].duration?.sum).toBe(42);
  });

  test('silent rule removes event from output and increments counter', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const child = makeEvent({
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      type: 'log',
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-logs',
        match: { type: 'log' },
        decision: 'silent',
      }],
    });

    const result = applyNoiseReduction([parent, child], config);

    expect(result.events).toHaveLength(1);
    expect(result.stats.silenced).toBe(1);

    const absorbed = result.events[0].absorbed;
    expect(absorbed).toBeDefined();
    expect(absorbed!.silentCount).toBe(1);
    expect(absorbed!.count).toBe(0); // silent doesn't count as absorbed
  });

  test('emit rule keeps event as standalone record', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const child = makeEvent({
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      type: 'log',
    });

    const config = makeConfig({
      rules: [{
        id: 'emit-logs',
        match: { type: 'log' },
        decision: 'emit',
      }],
    });

    const result = applyNoiseReduction([parent, child], config);

    expect(result.events).toHaveLength(2);
    expect(result.stats.emitted).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TREE BUILDING AND PARENT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

describe('tree building and parent resolution', () => {
  test('resolved parent ID skips absorbed ancestors', () => {
    const grandparent = makeEvent({ observabilityLogId: 'gp' });
    const parent = makeEvent({
      observabilityLogId: 'p',
      parentObservabilityLogId: 'gp',
      type: 'log',
    });
    const child = makeEvent({
      observabilityLogId: 'c',
      parentObservabilityLogId: 'p',
    });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([grandparent, parent, child], config);

    // grandparent emitted, parent absorbed, child emitted
    expect(result.events).toHaveLength(2);

    const childResult = findEmitted(result, 'c');
    expect(childResult).toBeDefined();
    // Child's resolved parent should be grandparent (skipping absorbed parent)
    expect(childResult!.resolvedParentId).toBe('gp');
  });

  test('events with missing parent become roots', () => {
    const orphan = makeEvent({
      observabilityLogId: 'orphan',
      parentObservabilityLogId: 'nonexistent',
    });

    const result = applyNoiseReduction([orphan], makeConfig());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].resolvedParentId).toBeUndefined();
  });

  test('events with no parent are roots', () => {
    const root = makeEvent({ observabilityLogId: 'root' });

    const result = applyNoiseReduction([root], makeConfig());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].resolvedParentId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. HARD SIGNAL PROTECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('hard signal protection', () => {
  test('error events are forced to emit even when rule says silent', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const errorChild = makeEvent({
      observabilityLogId: 'error-child',
      parentObservabilityLogId: 'parent',
      type: 'log',
      level: 'error',
      success: false,
      error: { type: 'Error', message: 'Something failed' },
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-all-logs',
        match: { type: 'log' },
        decision: 'silent',
      }],
    });

    const result = applyNoiseReduction([parent, errorChild], config);

    // Both should be emitted (error is hard signal)
    expect(result.events).toHaveLength(2);
    expect(findEmitted(result, 'error-child')).toBeDefined();
  });

  test('slow operations are forced to emit', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const slowChild = makeEvent({
      observabilityLogId: 'slow-child',
      parentObservabilityLogId: 'parent',
      type: 'span',
      durationMs: 10000, // 10s, way over default 5s threshold
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-spans',
        match: { type: 'span' },
        decision: 'silent',
      }],
      hardSignals: {
        slowThresholdMs: 5000,
      },
    });

    const result = applyNoiseReduction([parent, slowChild], config);

    expect(findEmitted(result, 'slow-child')).toBeDefined();
  });

  test('duration exactly at threshold is NOT a hard signal (strict >)', () => {
    const root = makeEvent({
      observabilityLogId: 'at-threshold',
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
      durationMs: 5000, // exactly at threshold
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-tasks',
        match: { type: 'span', tags: { handler_type: 'task' } },
        decision: 'silent',
      }],
      hardSignals: { slowThresholdMs: 5000 },
    });

    const result = applyNoiseReduction([root], config);

    // 5000 is NOT > 5000, so not a hard signal → silent → suppressed
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('duration 1ms over threshold IS a hard signal', () => {
    const root = makeEvent({
      observabilityLogId: 'over-threshold',
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
      durationMs: 5001,
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-tasks',
        match: { type: 'span', tags: { handler_type: 'task' } },
        decision: 'silent',
      }],
      hardSignals: { slowThresholdMs: 5000 },
    });

    const result = applyNoiseReduction([root], config);

    // 5001 > 5000 → hard signal → forced emit → not suppressed
    expect(result.events).toHaveLength(1);
    expect(findEmitted(result, 'over-threshold')).toBeDefined();
    expect(result.stats.suppressedRoots).toBe(0);
  });

  test('high-priority rule can override hard signal protection', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const errorChild = makeEvent({
      observabilityLogId: 'error-child',
      parentObservabilityLogId: 'parent',
      type: 'log',
      level: 'error',
    });

    const config = makeConfig({
      rules: [{
        id: 'force-absorb-errors',
        match: { type: 'log', level: ['error'] },
        decision: 'absorb',
        priority: 2000, // Higher than HARD_SIGNAL_PRIORITY (1000)
      }],
    });

    const result = applyNoiseReduction([parent, errorChild], config);

    // Error should be absorbed because rule priority > HARD_SIGNAL_PRIORITY
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.observabilityLogId).toBe('parent');
    expect(result.stats.absorbed).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. HARD SIGNAL ANCESTOR CONTEXT PRESERVATION
// ═══════════════════════════════════════════════════════════════════════════

describe('hard signal ancestor preservation', () => {
  test('ancestor span of error is forced to emit to preserve hierarchy', () => {
    const root = makeEvent({ observabilityLogId: 'root', type: 'span' });
    const middleSpan = makeEvent({
      observabilityLogId: 'middle',
      parentObservabilityLogId: 'root',
      type: 'span',
    });
    const errorLeaf = makeEvent({
      observabilityLogId: 'error-leaf',
      parentObservabilityLogId: 'middle',
      type: 'span',
      level: 'error',
      success: false,
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-spans',
        match: { type: 'span' },
        decision: 'silent',
        priority: 10,
      }],
    });

    const result = applyNoiseReduction([root, middleSpan, errorLeaf], config);

    // All three should be emitted:
    // - error-leaf: hard signal
    // - middle: ancestor of hard signal
    // - root: ancestor of hard signal
    expect(result.events).toHaveLength(3);
    expect(findEmitted(result, 'root')).toBeDefined();
    expect(findEmitted(result, 'middle')).toBeDefined();
    expect(findEmitted(result, 'error-leaf')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ABSORPTION DATA CORRECTNESS
// ═══════════════════════════════════════════════════════════════════════════

describe('absorption data', () => {
  test('error details are preserved in absorbed data', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const errorChild = makeEvent({
      observabilityLogId: 'error-child',
      parentObservabilityLogId: 'parent',
      type: 'log',
      operation: 'doStuff',
      entityId: 'entity-123',
      error: { type: 'ValidationError', message: 'Invalid input' },
      success: false,
    });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
        priority: 2000, // Override hard signal
      }],
    });

    const result = applyNoiseReduction([parent, errorChild], config);

    const absorbed = result.events[0].absorbed!;
    expect(absorbed.errors).toHaveLength(1);
    expect(absorbed.errors[0].observabilityLogId).toBe('error-child');
    expect(absorbed.errors[0].error.type).toBe('ValidationError');
    expect(absorbed.errors[0].error.message).toBe('Invalid input');
    expect(absorbed.errors[0].entityId).toBe('entity-123');
    expect(absorbed.errors[0].operation).toBe('doStuff');
  });

  test('causedBy links are preserved and deduplicated', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const child1 = makeEvent({
      observabilityLogId: 'child1',
      parentObservabilityLogId: 'parent',
      type: 'log',
      causedBy: 'upstream-1',
    });
    const child2 = makeEvent({
      observabilityLogId: 'child2',
      parentObservabilityLogId: 'parent',
      type: 'log',
      causedBy: 'upstream-1', // Same causedBy - should be deduplicated
    });
    const child3 = makeEvent({
      observabilityLogId: 'child3',
      parentObservabilityLogId: 'parent',
      type: 'log',
      causedBy: 'upstream-2',
    });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([parent, child1, child2, child3], config);

    const absorbed = result.events[0].absorbed!;
    expect(absorbed.causedByLinks).toEqual(['upstream-1', 'upstream-2']);
  });

  test('entity IDs are preserved and deduplicated', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const child1 = makeEvent({
      observabilityLogId: 'child1',
      parentObservabilityLogId: 'parent',
      type: 'log',
      entityId: 'entity-A',
    });
    const child2 = makeEvent({
      observabilityLogId: 'child2',
      parentObservabilityLogId: 'parent',
      type: 'log',
      entityId: 'entity-A', // Duplicate
    });
    const child3 = makeEvent({
      observabilityLogId: 'child3',
      parentObservabilityLogId: 'parent',
      type: 'log',
      entityId: 'entity-B',
    });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([parent, child1, child2, child3], config);

    const absorbed = result.events[0].absorbed!;
    expect(absorbed.entityIds).toEqual(['entity-A', 'entity-B']);
  });

  test('operation stats track duration correctly', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const children = [
      makeEvent({
        parentObservabilityLogId: 'parent',
        type: 'log',
        operation: 'query',
        durationMs: 10,
      }),
      makeEvent({
        parentObservabilityLogId: 'parent',
        type: 'log',
        operation: 'query',
        durationMs: 50,
      }),
      makeEvent({
        parentObservabilityLogId: 'parent',
        type: 'log',
        operation: 'query',
        durationMs: 30,
      }),
    ];

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([parent, ...children], config);

    const absorbed = result.events[0].absorbed!;
    const queryStats = absorbed.byOperation['query'];
    expect(queryStats.count).toBe(3);
    expect(queryStats.duration!.sum).toBe(90);
    expect(queryStats.duration!.min).toBe(10);
    expect(queryStats.duration!.max).toBe(50);
    expect(queryStats.duration!.count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. BOUNDS ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('bounds enforcement', () => {
  test('errors array is capped at maxAbsorbedErrorsPerSpan', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const errorChildren = Array.from({ length: 5 }, (_, i) =>
      makeEvent({
        parentObservabilityLogId: 'parent',
        type: 'log',
        operation: `op-${i}`,
        success: false,
        error: { type: 'Error', message: `Error ${i}` },
      }),
    );

    const config = makeConfig({
      maxAbsorbedErrorsPerSpan: 3,
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
        priority: 2000,
      }],
    });

    const result = applyNoiseReduction([parent, ...errorChildren], config);

    const absorbed = result.events[0].absorbed!;
    expect(absorbed.count).toBe(5); // All counted
    expect(absorbed.errors).toHaveLength(3); // But errors capped
  });

  test('operation keys are capped at maxAbsorbedOperationKeysPerSpan', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const children = Array.from({ length: 10 }, (_, i) =>
      makeEvent({
        parentObservabilityLogId: 'parent',
        type: 'log',
        operation: `unique-op-${i}`,
      }),
    );

    const config = makeConfig({
      maxAbsorbedOperationKeysPerSpan: 5,
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([parent, ...children], config);

    const absorbed = result.events[0].absorbed!;
    expect(absorbed.count).toBe(10); // All counted
    expect(Object.keys(absorbed.byOperation).length).toBeLessThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  test('empty input returns empty output', () => {
    const result = applyNoiseReduction([], makeConfig());

    expect(result.events).toHaveLength(0);
    expect(result.stats.totalInput).toBe(0);
  });

  test('single event is always emitted', () => {
    const event = makeEvent();
    const result = applyNoiseReduction([event], makeConfig());

    expect(result.events).toHaveLength(1);
    expect(result.stats.emitted).toBe(1);
  });

  test('root node with absorb decision is suppressed (entire tree is noise)', () => {
    const root = makeEvent({ observabilityLogId: 'root', type: 'log' });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = applyNoiseReduction([root], config);

    // Root suppression: all emitted events are promoted, entire invocation is noise → dropped
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
    expect(result.stats.absorbed).toBe(1);
  });

  test('per-event override takes precedence over rules', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const child = makeEvent({
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      type: 'log',
      capture: { noise: { decision: 'emit', reason: 'Important log' } },
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-logs',
        match: { type: 'log' },
        decision: 'silent',
      }],
    });

    const result = applyNoiseReduction([parent, child], config);

    expect(result.events).toHaveLength(2);
    expect(findEmitted(result, 'child')).toBeDefined();
  });

  test('deep tree with mixed decisions resolves correctly', () => {
    const root = makeEvent({ observabilityLogId: 'root', type: 'span' });
    const l1 = makeEvent({ observabilityLogId: 'l1', parentObservabilityLogId: 'root', type: 'span' });
    const l2Silent = makeEvent({ observabilityLogId: 'l2s', parentObservabilityLogId: 'l1', type: 'log' });
    const l2Absorb = makeEvent({ observabilityLogId: 'l2a', parentObservabilityLogId: 'l1', type: 'metric' });
    const l2Emit = makeEvent({ observabilityLogId: 'l2e', parentObservabilityLogId: 'l1', type: 'audit' });

    const config = makeConfig({
      rules: [
        { id: 'silent-logs', match: { type: 'log' }, decision: 'silent' },
        { id: 'absorb-metrics', match: { type: 'metric' }, decision: 'absorb' },
        { id: 'emit-audits', match: { type: 'audit' }, decision: 'emit' },
      ],
    });

    const result = applyNoiseReduction([root, l1, l2Silent, l2Absorb, l2Emit], config);

    // root: emitted, l1: emitted, l2e: emitted, l2s: silenced, l2a: absorbed
    expect(result.stats.emitted).toBe(3);
    expect(result.stats.absorbed).toBe(1);
    expect(result.stats.silenced).toBe(1);

    // l2e should have l1 as resolved parent
    const l2eResult = findEmitted(result, 'l2e');
    expect(l2eResult!.resolvedParentId).toBe('l1');

    // l1 should have absorbed data from l2a and silent count from l2s
    const l1Result = findEmitted(result, 'l1');
    expect(l1Result!.absorbed).toBeDefined();
    expect(l1Result!.absorbed!.count).toBe(1); // l2Absorb
    expect(l1Result!.absorbed!.silentCount).toBe(1); // l2Silent
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. SPAN.START HANDLING
// ═══════════════════════════════════════════════════════════════════════════

describe('span.start handling', () => {
  test('span.start is emitted when its span is emitted', () => {
    const spanStart = makeEvent({
      observabilityLogId: 'span-1',
      type: 'span.start',
      operation: 'myOp',
    });
    const span = makeEvent({
      observabilityLogId: 'span-1',
      type: 'span',
      operation: 'myOp',
    });

    const result = applyNoiseReduction([spanStart, span], makeConfig());

    expect(result.events).toHaveLength(2);
  });

  test('span.start is dropped when its span is silenced', () => {
    const spanStart = makeEvent({
      observabilityLogId: 'span-1',
      type: 'span.start',
      operation: 'myOp',
    });
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const span = makeEvent({
      observabilityLogId: 'span-1',
      parentObservabilityLogId: 'parent',
      type: 'span',
      operation: 'myOp',
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-spans',
        match: { type: 'span', operation: 'myOp' },
        decision: 'silent',
      }],
    });

    const result = applyNoiseReduction([spanStart, parent, span], config);

    // parent emitted, span.start silenced along with span
    const hasSpanStart = result.events.some(e => e.event.type === 'span.start');
    expect(hasSpanStart).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. PICK NOISE DECISION
// ═══════════════════════════════════════════════════════════════════════════

describe('pickNoiseDecision', () => {
  test('returns emit when no rules match', () => {
    const event = makeEvent();
    const config = makeConfig();

    const result = pickNoiseDecision(event, config);

    expect(result.decision).toBe('emit');
    expect(result.ruleId).toBe('default');
  });

  test('returns matching rule decision', () => {
    const event = makeEvent({ type: 'log' });
    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const result = pickNoiseDecision(event, config);

    expect(result.decision).toBe('absorb');
    expect(result.ruleId).toBe('absorb-logs');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. STATS
// ═══════════════════════════════════════════════════════════════════════════

describe('stats', () => {
  test('totalInput is correct', () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const result = applyNoiseReduction(events, makeConfig());

    expect(result.stats.totalInput).toBe(3);
  });

  test('operation breakdowns track absorbed and silenced operations', () => {
    const parent = makeEvent({ observabilityLogId: 'parent' });
    const absorbedChild = makeEvent({
      parentObservabilityLogId: 'parent',
      type: 'log',
      operation: 'queryDB',
    });
    const silencedChild = makeEvent({
      parentObservabilityLogId: 'parent',
      type: 'metric',
      operation: 'healthcheck',
    });

    const config = makeConfig({
      rules: [
        { id: 'absorb-logs', match: { type: 'log' }, decision: 'absorb' },
        { id: 'silent-metrics', match: { type: 'metric' }, decision: 'silent' },
      ],
    });

    const result = applyNoiseReduction([parent, absorbedChild, silencedChild], config);

    expect(result.stats.absorbedByOperation['queryDB']).toBe(1);
    expect(result.stats.silencedByOperation['healthcheck']).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. ROOT SUPPRESSION
// ═══════════════════════════════════════════════════════════════════════════

describe('root suppression', () => {
  test('single root with silent decision → entire invocation suppressed', () => {
    const root = makeEvent({
      observabilityLogId: 'root',
      type: 'span',
      tags: { handler_type: 'event_processor' },
      success: true,
    });

    const config = makeConfig({
      rules: [{
        id: 'silent-processors',
        match: { type: 'span', tags: { handler_type: 'event_processor' } },
        decision: 'silent',
      }],
    });

    const result = applyNoiseReduction([root], config);

    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
    expect(result.stats.silenced).toBe(1);
  });

  test('root with silent decision + all children absorbed → suppressed', () => {
    const root = makeEvent({
      observabilityLogId: 'root',
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
    });
    const child = makeEvent({
      observabilityLogId: 'child',
      parentObservabilityLogId: 'root',
      type: 'log',
      operation: 'Publish SNS done',
    });

    const config = makeConfig({
      rules: [
        { id: 'silent-tasks', match: { type: 'span', tags: { handler_type: 'task' } }, decision: 'silent' },
        { id: 'absorb-logs', match: { type: 'log' }, decision: 'absorb' },
      ],
    });

    const result = applyNoiseReduction([root, child], config);

    // Root is promoted from silent, child is absorbed into root. All emitted = promoted → suppressed.
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('silent root stripped, genuinely emitted child kept as new root', () => {
    const root = makeEvent({
      observabilityLogId: 'root',
      type: 'span',
      tags: { handler_type: 'event_processor' },
      success: true,
    });
    const auditChild = makeEvent({
      observabilityLogId: 'audit',
      parentObservabilityLogId: 'root',
      type: 'audit',
      operation: 'entity.update',
    });

    const config = makeConfig({
      rules: [
        { id: 'silent-processors', match: { type: 'span', tags: { handler_type: 'event_processor' } }, decision: 'silent' },
        // No rule for audit → defaults to emit
      ],
    });

    const result = applyNoiseReduction([root, auditChild], config);

    // Root is silent → promoted → stripped from output
    // Audit child is genuinely emitted → kept, parent ref cleared (becomes new root)
    expect(result.events).toHaveLength(1);
    expect(result.stats.suppressedRoots).toBe(0);
    expect(findEmitted(result, 'root')).toBeUndefined();
    expect(findEmitted(result, 'audit')).toBeDefined();
    expect(findEmitted(result, 'audit')!.resolvedParentId).toBeUndefined();
  });

  test('hard signal child prevents root suppression', () => {
    const root = makeEvent({
      observabilityLogId: 'root',
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
    });
    const errorChild = makeEvent({
      observabilityLogId: 'error-child',
      parentObservabilityLogId: 'root',
      type: 'span',
      success: false,
      error: { type: 'Error', message: 'Something broke' },
    });

    const config = makeConfig({
      rules: [
        { id: 'silent-tasks', match: { type: 'span', tags: { handler_type: 'task' }, success: true }, decision: 'silent' },
      ],
    });

    const result = applyNoiseReduction([root, errorChild], config);

    // Error child is a hard signal → forces root to emit via hard-signal-ancestor
    // Neither are promoted → not suppressed
    expect(result.events).toHaveLength(2);
    expect(result.stats.suppressedRoots).toBe(0);
  });

  test('multiple roots all silenced → all suppressed', () => {
    const root1 = makeEvent({
      observabilityLogId: 'root1',
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
    });
    const root2 = makeEvent({
      observabilityLogId: 'root2',
      type: 'span',
      tags: { handler_type: 'event_processor' },
      success: true,
    });

    const config = makeConfig({
      rules: [
        { id: 'silent-tasks', match: { tags: { handler_type: 'task' } }, decision: 'silent' },
        { id: 'silent-processors', match: { tags: { handler_type: 'event_processor' } }, decision: 'silent' },
      ],
    });

    const result = applyNoiseReduction([root1, root2], config);

    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(2);
  });

  test('noise root stripped + genuine root kept (mixed batch)', () => {
    const noiseRoot = makeEvent({
      observabilityLogId: 'noise',
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
    });
    const importantRoot = makeEvent({
      observabilityLogId: 'important',
      type: 'span',
      operation: 'POST /api/users',
    });

    const config = makeConfig({
      rules: [
        { id: 'silent-tasks', match: { tags: { handler_type: 'task' } }, decision: 'silent' },
        // No rule for the API span → defaults to emit
      ],
    });

    const result = applyNoiseReduction([noiseRoot, importantRoot], config);

    // Noise root is silent → promoted → stripped from output
    // Important root is genuinely emitted → kept
    expect(result.events).toHaveLength(1);
    expect(findEmitted(result, 'noise')).toBeUndefined();
    expect(findEmitted(result, 'important')).toBeDefined();
    expect(result.stats.suppressedRoots).toBe(0);
  });

  test('suppressedRoots stat correctly reflects count', () => {
    const root = makeEvent({
      observabilityLogId: 'r',
      type: 'log',
    });

    const config = makeConfig({
      rules: [{ id: 'absorb-all', match: { type: 'log' }, decision: 'absorb' }],
    });

    const result = applyNoiseReduction([root], config);

    expect(result.stats.suppressedRoots).toBe(1);
    expect(result.stats.totalInput).toBe(1);
    expect(result.stats.emitted).toBe(0);
    expect(result.stats.absorbed).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. BUILD AND EVALUATE (inspection helper)
// ═══════════════════════════════════════════════════════════════════════════

describe('buildAndEvaluate', () => {
  test('returns tree with evaluations', () => {
    const parent = makeEvent({ observabilityLogId: 'parent', type: 'span' });
    const child = makeEvent({
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      type: 'log',
    });

    const config = makeConfig({
      rules: [{
        id: 'absorb-logs',
        match: { type: 'log' },
        decision: 'absorb',
      }],
    });

    const { roots, nodeById } = buildAndEvaluate([parent, child], config);

    expect(roots).toHaveLength(1);
    expect(roots[0].event.observabilityLogId).toBe('parent');
    expect(roots[0].evaluation?.decision).toBe('emit');
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].evaluation?.decision).toBe('absorb');

    const childNode = nodeById.get('child');
    expect(childNode?.evaluation?.ruleId).toBe('absorb-logs');
  });
});
