"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const algorithm_1 = require("../algorithm");
// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
let idCounter = 0;
function makeEvent(overrides = {}) {
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
function makeConfig(overrides = {}) {
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
function findEmitted(result, logId) {
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
        const result = (0, algorithm_1.applyNoiseReduction)(events, config);
        expect(result.events).toHaveLength(3);
        expect(result.stats.emitted).toBe(3);
        expect(result.stats.absorbed).toBe(0);
        expect(result.stats.silenced).toBe(0);
    });
    test('no matching rules → all events emitted', () => {
        const events = [makeEvent(), makeEvent()];
        const config = makeConfig();
        const result = (0, algorithm_1.applyNoiseReduction)(events, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, child], config);
        expect(result.events).toHaveLength(1);
        expect(result.events[0].event.observabilityLogId).toBe('parent');
        expect(result.stats.emitted).toBe(1);
        expect(result.stats.absorbed).toBe(1);
        const absorbed = result.events[0].absorbed;
        expect(absorbed).toBeDefined();
        expect(absorbed.count).toBe(1);
        expect(absorbed.byOperation['childOp']).toBeDefined();
        expect(absorbed.byOperation['childOp'].count).toBe(1);
        expect(absorbed.byOperation['childOp'].duration?.sum).toBe(42);
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, child], config);
        expect(result.events).toHaveLength(1);
        expect(result.stats.silenced).toBe(1);
        const absorbed = result.events[0].absorbed;
        expect(absorbed).toBeDefined();
        expect(absorbed.silentCount).toBe(1);
        expect(absorbed.count).toBe(0); // silent doesn't count as absorbed
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, child], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([grandparent, parent, child], config);
        // grandparent emitted, parent absorbed, child emitted
        expect(result.events).toHaveLength(2);
        const childResult = findEmitted(result, 'c');
        expect(childResult).toBeDefined();
        // Child's resolved parent should be grandparent (skipping absorbed parent)
        expect(childResult.resolvedParentId).toBe('gp');
    });
    test('events with missing parent become roots', () => {
        const orphan = makeEvent({
            observabilityLogId: 'orphan',
            parentObservabilityLogId: 'nonexistent',
        });
        const result = (0, algorithm_1.applyNoiseReduction)([orphan], makeConfig());
        expect(result.events).toHaveLength(1);
        expect(result.events[0].resolvedParentId).toBeUndefined();
    });
    test('events with no parent are roots', () => {
        const root = makeEvent({ observabilityLogId: 'root' });
        const result = (0, algorithm_1.applyNoiseReduction)([root], makeConfig());
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, errorChild], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, slowChild], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, errorChild], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, middleSpan, errorLeaf], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, errorChild], config);
        const absorbed = result.events[0].absorbed;
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, child1, child2, child3], config);
        const absorbed = result.events[0].absorbed;
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, child1, child2, child3], config);
        const absorbed = result.events[0].absorbed;
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, ...children], config);
        const absorbed = result.events[0].absorbed;
        const queryStats = absorbed.byOperation['query'];
        expect(queryStats.count).toBe(3);
        expect(queryStats.duration.sum).toBe(90);
        expect(queryStats.duration.min).toBe(10);
        expect(queryStats.duration.max).toBe(50);
        expect(queryStats.duration.count).toBe(3);
    });
});
// ═══════════════════════════════════════════════════════════════════════════
// 6. BOUNDS ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════
describe('bounds enforcement', () => {
    test('errors array is capped at maxAbsorbedErrorsPerSpan', () => {
        const parent = makeEvent({ observabilityLogId: 'parent' });
        const errorChildren = Array.from({ length: 5 }, (_, i) => makeEvent({
            parentObservabilityLogId: 'parent',
            type: 'log',
            operation: `op-${i}`,
            success: false,
            error: { type: 'Error', message: `Error ${i}` },
        }));
        const config = makeConfig({
            maxAbsorbedErrorsPerSpan: 3,
            rules: [{
                    id: 'absorb-logs',
                    match: { type: 'log' },
                    decision: 'absorb',
                    priority: 2000,
                }],
        });
        const result = (0, algorithm_1.applyNoiseReduction)([parent, ...errorChildren], config);
        const absorbed = result.events[0].absorbed;
        expect(absorbed.count).toBe(5); // All counted
        expect(absorbed.errors).toHaveLength(3); // But errors capped
    });
    test('operation keys are capped at maxAbsorbedOperationKeysPerSpan', () => {
        const parent = makeEvent({ observabilityLogId: 'parent' });
        const children = Array.from({ length: 10 }, (_, i) => makeEvent({
            parentObservabilityLogId: 'parent',
            type: 'log',
            operation: `unique-op-${i}`,
        }));
        const config = makeConfig({
            maxAbsorbedOperationKeysPerSpan: 5,
            rules: [{
                    id: 'absorb-logs',
                    match: { type: 'log' },
                    decision: 'absorb',
                }],
        });
        const result = (0, algorithm_1.applyNoiseReduction)([parent, ...children], config);
        const absorbed = result.events[0].absorbed;
        expect(absorbed.count).toBe(10); // All counted
        expect(Object.keys(absorbed.byOperation).length).toBeLessThanOrEqual(5);
    });
});
// ═══════════════════════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════
describe('edge cases', () => {
    test('empty input returns empty output', () => {
        const result = (0, algorithm_1.applyNoiseReduction)([], makeConfig());
        expect(result.events).toHaveLength(0);
        expect(result.stats.totalInput).toBe(0);
    });
    test('single event is always emitted', () => {
        const event = makeEvent();
        const result = (0, algorithm_1.applyNoiseReduction)([event], makeConfig());
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, child], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, l1, l2Silent, l2Absorb, l2Emit], config);
        // root: emitted, l1: emitted, l2e: emitted, l2s: silenced, l2a: absorbed
        expect(result.stats.emitted).toBe(3);
        expect(result.stats.absorbed).toBe(1);
        expect(result.stats.silenced).toBe(1);
        // l2e should have l1 as resolved parent
        const l2eResult = findEmitted(result, 'l2e');
        expect(l2eResult.resolvedParentId).toBe('l1');
        // l1 should have absorbed data from l2a and silent count from l2s
        const l1Result = findEmitted(result, 'l1');
        expect(l1Result.absorbed).toBeDefined();
        expect(l1Result.absorbed.count).toBe(1); // l2Absorb
        expect(l1Result.absorbed.silentCount).toBe(1); // l2Silent
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
        const result = (0, algorithm_1.applyNoiseReduction)([spanStart, span], makeConfig());
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
        const result = (0, algorithm_1.applyNoiseReduction)([spanStart, parent, span], config);
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
        const result = (0, algorithm_1.pickNoiseDecision)(event, config);
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
        const result = (0, algorithm_1.pickNoiseDecision)(event, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)(events, makeConfig());
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
        const result = (0, algorithm_1.applyNoiseReduction)([parent, absorbedChild, silencedChild], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, child], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, auditChild], config);
        // Root is silent → promoted → stripped from output
        // Audit child is genuinely emitted → kept, parent ref cleared (becomes new root)
        expect(result.events).toHaveLength(1);
        expect(result.stats.suppressedRoots).toBe(0);
        expect(findEmitted(result, 'root')).toBeUndefined();
        expect(findEmitted(result, 'audit')).toBeDefined();
        expect(findEmitted(result, 'audit').resolvedParentId).toBeUndefined();
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, errorChild], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root1, root2], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([noiseRoot, importantRoot], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const { roots, nodeById } = (0, algorithm_1.buildAndEvaluate)([parent, child], config);
        expect(roots).toHaveLength(1);
        expect(roots[0].event.observabilityLogId).toBe('parent');
        expect(roots[0].evaluation?.decision).toBe('emit');
        expect(roots[0].children).toHaveLength(1);
        expect(roots[0].children[0].evaluation?.decision).toBe('absorb');
        const childNode = nodeById.get('child');
        expect(childNode?.evaluation?.ruleId).toBe('absorb-logs');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidjItYWxnb3JpdGhtLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL3YyLWFsZ29yaXRobS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7OztHQWFHOztBQUVILDRDQUF3RjtBQUl4Riw4RUFBOEU7QUFDOUUsVUFBVTtBQUNWLDhFQUE4RTtBQUU5RSxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUM7QUFFbEIsU0FBUyxTQUFTLENBQUMsWUFBeUMsRUFBRTtJQUM1RCxTQUFTLEVBQUUsQ0FBQztJQUNaLE9BQU87UUFDTCxJQUFJLEVBQUUsTUFBTTtRQUNaLEtBQUssRUFBRSxNQUFNO1FBQ2IsYUFBYSxFQUFFLFFBQVE7UUFDdkIsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7UUFDdkIsa0JBQWtCLEVBQUUsT0FBTyxTQUFTLEVBQUU7UUFDdEMsR0FBRyxTQUFTO0tBQ2IsQ0FBQztBQUNKLENBQUM7QUFFRCxTQUFTLFVBQVUsQ0FBQyxZQUEyQyxFQUFFO0lBQy9ELE9BQU87UUFDTCxPQUFPLEVBQUUsSUFBSTtRQUNiLE9BQU8sRUFBRSxFQUFFO1FBQ1gsS0FBSyxFQUFFLEVBQUU7UUFDVCx3QkFBd0IsRUFBRSxFQUFFO1FBQzVCLCtCQUErQixFQUFFLEVBQUU7UUFDbkMsMkJBQTJCLEVBQUUsR0FBRztRQUNoQywrQkFBK0IsRUFBRSxFQUFFO1FBQ25DLDZCQUE2QixFQUFFLEdBQUc7UUFDbEMsR0FBRyxTQUFTO0tBQ2IsQ0FBQztBQUNKLENBQUM7QUFFRCxTQUFTLFdBQVcsQ0FBQyxNQUEyQyxFQUFFLEtBQWE7SUFDN0UsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEtBQUssS0FBSyxDQUFDLENB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QUNuQixDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsTUFBTSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxJQUFBLDRCQUFnQixFQUFDLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRXRFLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDOUIsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDekQsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ25ELE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFakUsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN4QyxNQUFNLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDNUQsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVW5pdCB0ZXN0cyBmb3IgdGhlIHYyIG5vaXNlIHJlZHVjdGlvbiBhbGdvcml0aG0uXG4gKiBcbiAqIFRlc3RzIGNvdmVyOlxuICogMS4gQmFzaWMgZGVjaXNpb24gYXBwbGljYXRpb24gKGVtaXQsIGFic29yYiwgc2lsZW50KVxuICogMi4gVHJlZSBidWlsZGluZyBhbmQgcGFyZW50IHJlc29sdXRpb25cbiAqIDMuIEhhcmQgc2lnbmFsIHByb3RlY3Rpb25cbiAqIDQuIEhhcmQgc2lnbmFsIGFuY2VzdG9yIGNvbnRleHQgcHJlc2VydmF0aW9uXG4gKiA1LiBBYnNvcnB0aW9uIGRhdGEgY29ycmVjdG5lc3MgKGVycm9ycywgY2F1c2VkQnksIGVudGl0eUlkcywgb3BlcmF0aW9uIHN0YXRzKVxuICogNi4gQm91bmRzIGVuZm9yY2VtZW50XG4gKiA3LiBFZGdlIGNhc2VzIChlbXB0eSBpbnB1dCwgc2luZ2xlIGV2ZW50LCBvcnBoYW4gcm9vdHMpXG4gKiA4LiBzcGFuLnN0YXJ0IGhhbmRsaW5nXG4gKiA5LiBwaWNrTm9pc2VEZWNpc2lvbiBjb252ZW5pZW5jZSBmdW5jdGlvblxuICovXG5cbmltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24sIHBpY2tOb2lzZURlY2lzaW9uLCBidWlsZEFuZEV2YWx1YXRlIH0gZnJvbSAnLi4vYWxnb3JpdGhtJztcbmltcG9ydCB0eXBlIHsgTm9pc2VSZWR1Y3Rpb25Db25maWcsIE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uLy4uL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgQWJzb3JiZWREYXRhLCBFbWl0dGVkRXZlbnQgfSBmcm9tICcuLi90eXBlcyc7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gSEVMUEVSU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmxldCBpZENvdW50ZXIgPSAwO1xuXG5mdW5jdGlvbiBtYWtlRXZlbnQob3ZlcnJpZGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4gPSB7fSk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gIGlkQ291bnRlcisrO1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdzcGFuJyxcbiAgICBsZXZlbDogJ2luZm8nLFxuICAgIGNvcnJlbGF0aW9uSWQ6ICdjb3JyLTEnLFxuICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogYGV2dC0ke2lkQ291bnRlcn1gLFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFrZUNvbmZpZyhvdmVycmlkZXM6IFBhcnRpYWw8Tm9pc2VSZWR1Y3Rpb25Db25maWc+ID0ge30pOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyB7XG4gIHJldHVybiB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBwcmVzZXRzOiBbXSxcbiAgICBydWxlczogW10sXG4gICAgbWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuOiAyMCxcbiAgICBtYXhBYnNvcmJlZENhdXNlZEJ5TGlua3NQZXJTcGFuOiA1MCxcbiAgICBtYXhBYnNvcmJlZEVudGl0eUlkc1BlclNwYW46IDEwMCxcbiAgICBtYXhBYnNvcmJlZE9wZXJhdGlvbktleXNQZXJTcGFuOiA1MCxcbiAgICBtYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbjogMTAwLFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZmluZEVtaXR0ZWQocmVzdWx0OiB7IGV2ZW50czogcmVhZG9ubHkgRW1pdHRlZEV2ZW50W10gfSwgbG9nSWQ6IHN0cmluZyk6IEVtaXR0ZWRFdmVudCB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gbG9nSWQpO1xufVxuXG5iZWZvcmVFYWNoKCgpID0+IHtcbiAgaWRDb3VudGVyID0gMDtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDEuIEJBU0lDIERFQ0lTSU9OIEFQUExJQ0FUSU9OXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZGVzY3JpYmUoJ2Jhc2ljIGRlY2lzaW9ucycsICgpID0+IHtcbiAgdGVzdCgnZGlzYWJsZWQgY29uZmlnIHBhc3NlcyBhbGwgZXZlbnRzIHRocm91Z2gnLCAoKSA9PiB7XG4gICAgY29uc3QgZXZlbnRzID0gW21ha2VFdmVudCgpLCBtYWtlRXZlbnQoKSwgbWFrZUV2ZW50KCldO1xuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoeyBlbmFibGVkOiBmYWxzZSB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcpO1xuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmVtaXR0ZWQpLnRvQmUoMyk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5hYnNvcmJlZCkudG9CZSgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnNpbGVuY2VkKS50b0JlKDApO1xuICB9KTtcblxuICB0ZXN0KCdubyBtYXRjaGluZyBydWxlcyDihpIgYWxsIGV2ZW50cyBlbWl0dGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IGV2ZW50cyA9IFttYWtlRXZlbnQoKSwgbWFrZUV2ZW50KCldO1xuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcpO1xuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmVtaXR0ZWQpLnRvQmUoMik7XG4gIH0pO1xuXG4gIHRlc3QoJ2Fic29yYiBydWxlIHJlbW92ZXMgZXZlbnQgZnJvbSBvdXRwdXQgYW5kIGFkZHMgZGF0YSB0byBwYXJlbnQnLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50Jywgb3BlcmF0aW9uOiAncGFyZW50T3AnIH0pO1xuICAgIGNvbnN0IGNoaWxkID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBvcGVyYXRpb246ICdjaGlsZE9wJyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgZHVyYXRpb25NczogNDIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ2Fic29yYi1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGNoaWxkXSwgY29uZmlnKTtcblxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHNbMF0uZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdwYXJlbnQnKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmVtaXR0ZWQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5hYnNvcmJlZCkudG9CZSgxKTtcblxuICAgIGNvbnN0IGFic29yYmVkID0gcmVzdWx0LmV2ZW50c1swXS5hYnNvcmJlZDtcbiAgICBleHBlY3QoYWJzb3JiZWQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGFic29yYmVkIS5jb3VudCkudG9CZSgxKTtcbiAgICBleHBlY3QoYWJzb3JiZWQhLmJ5T3BlcmF0aW9uWydjaGlsZE9wJ10pLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGFic29yYmVkIS5ieU9wZXJhdGlvblsnY2hpbGRPcCddLmNvdW50KS50b0JlKDEpO1xuICAgIGV4cGVjdChhYnNvcmJlZCEuYnlPcGVyYXRpb25bJ2NoaWxkT3AnXS5kdXJhdGlvbj8uc3VtKS50b0JlKDQyKTtcbiAgfSk7XG5cbiAgdGVzdCgnc2lsZW50IHJ1bGUgcmVtb3ZlcyBldmVudCBmcm9tIG91dHB1dCBhbmQgaW5jcmVtZW50cyBjb3VudGVyJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgY2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW3tcbiAgICAgICAgaWQ6ICdzaWxlbnQtbG9ncycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcGFyZW50LCBjaGlsZF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc2lsZW5jZWQpLnRvQmUoMSk7XG5cbiAgICBjb25zdCBhYnNvcmJlZCA9IHJlc3VsdC5ldmVudHNbMF0uYWJzb3JiZWQ7XG4gICAgZXhwZWN0KGFic29yYmVkKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChhYnNvcmJlZCEuc2lsZW50Q291bnQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KGFic29yYmVkIS5jb3VudCkudG9CZSgwKTsgLy8gc2lsZW50IGRvZXNuJ3QgY291bnQgYXMgYWJzb3JiZWRcbiAgfSk7XG5cbiAgdGVzdCgnZW1pdCBydWxlIGtlZXBzIGV2ZW50IGFzIHN0YW5kYWxvbmUgcmVjb3JkJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgY2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW3tcbiAgICAgICAgaWQ6ICdlbWl0LWxvZ3MnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2VtaXQnLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGNoaWxkXSwgY29uZmlnKTtcblxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5lbWl0dGVkKS50b0JlKDIpO1xuICB9KTtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDIuIFRSRUUgQlVJTERJTkcgQU5EIFBBUkVOVCBSRVNPTFVUSU9OXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZGVzY3JpYmUoJ3RyZWUgYnVpbGRpbmcgYW5kIHBhcmVudCByZXNvbHV0aW9uJywgKCkgPT4ge1xuICB0ZXN0KCdyZXNvbHZlZCBwYXJlbnQgSUQgc2tpcHMgYWJzb3JiZWQgYW5jZXN0b3JzJywgKCkgPT4ge1xuICAgIGNvbnN0IGdyYW5kcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ3AnIH0pO1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2dwJyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgIH0pO1xuICAgIGNvbnN0IGNoaWxkID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2MnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ2Fic29yYi1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtncmFuZHBhcmVudCwgcGFyZW50LCBjaGlsZF0sIGNvbmZpZyk7XG5cbiAgICAvLyBncmFuZHBhcmVudCBlbWl0dGVkLCBwYXJlbnQgYWJzb3JiZWQsIGNoaWxkIGVtaXR0ZWRcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgY29uc3QgY2hpbGRSZXN1bHQgPSBmaW5kRW1pdHRlZChyZXN1bHQsICdjJyk7XG4gICAgZXhwZWN0KGNoaWxkUmVzdWx0KS50b0JlRGVmaW5lZCgpO1xuICAgIC8vIENoaWxkJ3MgcmVzb2x2ZWQgcGFyZW50IHNob3VsZCBiZSBncmFuZHBhcmVudCAoc2tpcHBpbmcgYWJzb3JiZWQgcGFyZW50KVxuICAgIGV4cGVjdChjaGlsZFJlc3VsdCEucmVzb2x2ZWRQYXJlbnRJZCkudG9CZSgnZ3AnKTtcbiAgfSk7XG5cbiAgdGVzdCgnZXZlbnRzIHdpdGggbWlzc2luZyBwYXJlbnQgYmVjb21lIHJvb3RzJywgKCkgPT4ge1xuICAgIGNvbnN0IG9ycGhhbiA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdvcnBoYW4nLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbm9uZXhpc3RlbnQnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbb3JwaGFuXSwgbWFrZUNvbmZpZygpKTtcblxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHNbMF0ucmVzb2x2ZWRQYXJlbnRJZCkudG9CZVVuZGVmaW5lZCgpO1xuICB9KTtcblxuICB0ZXN0KCdldmVudHMgd2l0aCBubyBwYXJlbnQgYXJlIHJvb3RzJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoeyBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW3Jvb3RdLCBtYWtlQ29uZmlnKCkpO1xuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50c1swXS5yZXNvbHZlZFBhcmVudElkKS50b0JlVW5kZWZpbmVkKCk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gMy4gSEFSRCBTSUdOQUwgUFJPVEVDVElPTlxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdoYXJkIHNpZ25hbCBwcm90ZWN0aW9uJywgKCkgPT4ge1xuICB0ZXN0KCdlcnJvciBldmVudHMgYXJlIGZvcmNlZCB0byBlbWl0IGV2ZW4gd2hlbiBydWxlIHNheXMgc2lsZW50JywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgZXJyb3JDaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvci1jaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IHsgdHlwZTogJ0Vycm9yJywgbWVzc2FnZTogJ1NvbWV0aGluZyBmYWlsZWQnIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ3NpbGVudC1hbGwtbG9ncycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcGFyZW50LCBlcnJvckNoaWxkXSwgY29uZmlnKTtcblxuICAgIC8vIEJvdGggc2hvdWxkIGJlIGVtaXR0ZWQgKGVycm9yIGlzIGhhcmQgc2lnbmFsKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2Vycm9yLWNoaWxkJykpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3Nsb3cgb3BlcmF0aW9ucyBhcmUgZm9yY2VkIHRvIGVtaXQnLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyB9KTtcbiAgICBjb25zdCBzbG93Q2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc2xvdy1jaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgZHVyYXRpb25NczogMTAwMDAsIC8vIDEwcywgd2F5IG92ZXIgZGVmYXVsdCA1cyB0aHJlc2hvbGRcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIGlkOiAnc2lsZW50LXNwYW5zJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgICAgaGFyZFNpZ25hbHM6IHtcbiAgICAgICAgc2xvd1RocmVzaG9sZE1zOiA1MDAwLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW3BhcmVudCwgc2xvd0NoaWxkXSwgY29uZmlnKTtcblxuICAgIGV4cGVjdChmaW5kRW1pdHRlZChyZXN1bHQsICdzbG93LWNoaWxkJykpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIHRlc3QoJ2R1cmF0aW9uIGV4YWN0bHkgYXQgdGhyZXNob2xkIGlzIE5PVCBhIGhhcmQgc2lnbmFsIChzdHJpY3QgPiknLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdhdC10aHJlc2hvbGQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwMDAsIC8vIGV4YWN0bHkgYXQgdGhyZXNob2xkXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ3NpbGVudC10YXNrcycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJyB9IH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgICAgaGFyZFNpZ25hbHM6IHsgc2xvd1RocmVzaG9sZE1zOiA1MDAwIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtyb290XSwgY29uZmlnKTtcblxuICAgIC8vIDUwMDAgaXMgTk9UID4gNTAwMCwgc28gbm90IGEgaGFyZCBzaWduYWwg4oaSIHNpbGVudCDihpIgc3VwcHJlc3NlZFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2R1cmF0aW9uIDFtcyBvdmVyIHRocmVzaG9sZCBJUyBhIGhhcmQgc2lnbmFsJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnb3Zlci10aHJlc2hvbGQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwMDEsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ3NpbGVudC10YXNrcycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJyB9IH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgICAgaGFyZFNpZ25hbHM6IHsgc2xvd1RocmVzaG9sZE1zOiA1MDAwIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtyb290XSwgY29uZmlnKTtcblxuICAgIC8vIDUwMDEgPiA1MDAwIOKGkiBoYXJkIHNpZ25hbCDihpIgZm9yY2VkIGVtaXQg4oaSIG5vdCBzdXBwcmVzc2VkXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnb3Zlci10aHJlc2hvbGQnKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgwKTtcbiAgfSk7XG5cbiAgdGVzdCgnaGlnaC1wcmlvcml0eSBydWxlIGNhbiBvdmVycmlkZSBoYXJkIHNpZ25hbCBwcm90ZWN0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgZXJyb3JDaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvci1jaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIGlkOiAnZm9yY2UtYWJzb3JiLWVycm9ycycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBsZXZlbDogWydlcnJvciddIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgICAgcHJpb3JpdHk6IDIwMDAsIC8vIEhpZ2hlciB0aGFuIEhBUkRfU0lHTkFMX1BSSU9SSVRZICgxMDAwKVxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGVycm9yQ2hpbGRdLCBjb25maWcpO1xuXG4gICAgLy8gRXJyb3Igc2hvdWxkIGJlIGFic29yYmVkIGJlY2F1c2UgcnVsZSBwcmlvcml0eSA+IEhBUkRfU0lHTkFMX1BSSU9SSVRZXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50c1swXS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3BhcmVudCcpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuYWJzb3JiZWQpLnRvQmUoMSk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gNC4gSEFSRCBTSUdOQUwgQU5DRVNUT1IgQ09OVEVYVCBQUkVTRVJWQVRJT05cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgnaGFyZCBzaWduYWwgYW5jZXN0b3IgcHJlc2VydmF0aW9uJywgKCkgPT4ge1xuICB0ZXN0KCdhbmNlc3RvciBzcGFuIG9mIGVycm9yIGlzIGZvcmNlZCB0byBlbWl0IHRvIHByZXNlcnZlIGhpZXJhcmNoeScsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsIHR5cGU6ICdzcGFuJyB9KTtcbiAgICBjb25zdCBtaWRkbGVTcGFuID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ21pZGRsZScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICB9KTtcbiAgICBjb25zdCBlcnJvckxlYWYgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3ItbGVhZicsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdtaWRkbGUnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIGlkOiAnc2lsZW50LXNwYW5zJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgcHJpb3JpdHk6IDEwLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtyb290LCBtaWRkbGVTcGFuLCBlcnJvckxlYWZdLCBjb25maWcpO1xuXG4gICAgLy8gQWxsIHRocmVlIHNob3VsZCBiZSBlbWl0dGVkOlxuICAgIC8vIC0gZXJyb3ItbGVhZjogaGFyZCBzaWduYWxcbiAgICAvLyAtIG1pZGRsZTogYW5jZXN0b3Igb2YgaGFyZCBzaWduYWxcbiAgICAvLyAtIHJvb3Q6IGFuY2VzdG9yIG9mIGhhcmQgc2lnbmFsXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAncm9vdCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChmaW5kRW1pdHRlZChyZXN1bHQsICdtaWRkbGUnKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnZXJyb3ItbGVhZicpKS50b0JlRGVmaW5lZCgpO1xuICB9KTtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDUuIEFCU09SUFRJT04gREFUQSBDT1JSRUNUTkVTU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdhYnNvcnB0aW9uIGRhdGEnLCAoKSA9PiB7XG4gIHRlc3QoJ2Vycm9yIGRldGFpbHMgYXJlIHByZXNlcnZlZCBpbiBhYnNvcmJlZCBkYXRhJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgZXJyb3JDaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvci1jaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBvcGVyYXRpb246ICdkb1N0dWZmJyxcbiAgICAgIGVudGl0eUlkOiAnZW50aXR5LTEyMycsXG4gICAgICBlcnJvcjogeyB0eXBlOiAnVmFsaWRhdGlvbkVycm9yJywgbWVzc2FnZTogJ0ludmFsaWQgaW5wdXQnIH0sXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIGlkOiAnYWJzb3JiLWxvZ3MnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICAgIHByaW9yaXR5OiAyMDAwLCAvLyBPdmVycmlkZSBoYXJkIHNpZ25hbFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGVycm9yQ2hpbGRdLCBjb25maWcpO1xuXG4gICAgY29uc3QgYWJzb3JiZWQgPSByZXN1bHQuZXZlbnRzWzBdLmFic29yYmVkITtcbiAgICBleHBlY3QoYWJzb3JiZWQuZXJyb3JzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KGFic29yYmVkLmVycm9yc1swXS5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ2Vycm9yLWNoaWxkJyk7XG4gICAgZXhwZWN0KGFic29yYmVkLmVycm9yc1swXS5lcnJvci50eXBlKS50b0JlKCdWYWxpZGF0aW9uRXJyb3InKTtcbiAgICBleHBlY3QoYWJzb3JiZWQuZXJyb3JzWzBdLmVycm9yLm1lc3NhZ2UpLnRvQmUoJ0ludmFsaWQgaW5wdXQnKTtcbiAgICBleHBlY3QoYWJzb3JiZWQuZXJyb3JzWzBdLmVudGl0eUlkKS50b0JlKCdlbnRpdHktMTIzJyk7XG4gICAgZXhwZWN0KGFic29yYmVkLmVycm9yc1swXS5vcGVyYXRpb24pLnRvQmUoJ2RvU3R1ZmYnKTtcbiAgfSk7XG5cbiAgdGVzdCgnY2F1c2VkQnkgbGlua3MgYXJlIHByZXNlcnZlZCBhbmQgZGVkdXBsaWNhdGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgY2hpbGQxID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkMScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBjYXVzZWRCeTogJ3Vwc3RyZWFtLTEnLFxuICAgIH0pO1xuICAgIGNvbnN0IGNoaWxkMiA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZDInLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgY2F1c2VkQnk6ICd1cHN0cmVhbS0xJywgLy8gU2FtZSBjYXVzZWRCeSAtIHNob3VsZCBiZSBkZWR1cGxpY2F0ZWRcbiAgICB9KTtcbiAgICBjb25zdCBjaGlsZDMgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQzJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGNhdXNlZEJ5OiAndXBzdHJlYW0tMicsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ2Fic29yYi1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGNoaWxkMSwgY2hpbGQyLCBjaGlsZDNdLCBjb25maWcpO1xuXG4gICAgY29uc3QgYWJzb3JiZWQgPSByZXN1bHQuZXZlbnRzWzBdLmFic29yYmVkITtcbiAgICBleHBlY3QoYWJzb3JiZWQuY2F1c2VkQnlMaW5rcykudG9FcXVhbChbJ3Vwc3RyZWFtLTEnLCAndXBzdHJlYW0tMiddKTtcbiAgfSk7XG5cbiAgdGVzdCgnZW50aXR5IElEcyBhcmUgcHJlc2VydmVkIGFuZCBkZWR1cGxpY2F0ZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyB9KTtcbiAgICBjb25zdCBjaGlsZDEgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQxJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGVudGl0eUlkOiAnZW50aXR5LUEnLFxuICAgIH0pO1xuICAgIGNvbnN0IGNoaWxkMiA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZDInLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgZW50aXR5SWQ6ICdlbnRpdHktQScsIC8vIER1cGxpY2F0ZVxuICAgIH0pO1xuICAgIGNvbnN0IGNoaWxkMyA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZDMnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgZW50aXR5SWQ6ICdlbnRpdHktQicsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ2Fic29yYi1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGNoaWxkMSwgY2hpbGQyLCBjaGlsZDNdLCBjb25maWcpO1xuXG4gICAgY29uc3QgYWJzb3JiZWQgPSByZXN1bHQuZXZlbnRzWzBdLmFic29yYmVkITtcbiAgICBleHBlY3QoYWJzb3JiZWQuZW50aXR5SWRzKS50b0VxdWFsKFsnZW50aXR5LUEnLCAnZW50aXR5LUInXSk7XG4gIH0pO1xuXG4gIHRlc3QoJ29wZXJhdGlvbiBzdGF0cyB0cmFjayBkdXJhdGlvbiBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyB9KTtcbiAgICBjb25zdCBjaGlsZHJlbiA9IFtcbiAgICAgIG1ha2VFdmVudCh7XG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBvcGVyYXRpb246ICdxdWVyeScsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgICAgfSksXG4gICAgICBtYWtlRXZlbnQoe1xuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgb3BlcmF0aW9uOiAncXVlcnknLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgIH0pLFxuICAgICAgbWFrZUV2ZW50KHtcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIG9wZXJhdGlvbjogJ3F1ZXJ5JyxcbiAgICAgICAgZHVyYXRpb25NczogMzAsXG4gICAgICB9KSxcbiAgICBdO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW3tcbiAgICAgICAgaWQ6ICdhYnNvcmItbG9ncycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcGFyZW50LCAuLi5jaGlsZHJlbl0sIGNvbmZpZyk7XG5cbiAgICBjb25zdCBhYnNvcmJlZCA9IHJlc3VsdC5ldmVudHNbMF0uYWJzb3JiZWQhO1xuICAgIGNvbnN0IHF1ZXJ5U3RhdHMgPSBhYnNvcmJlZC5ieU9wZXJhdGlvblsncXVlcnknXTtcbiAgICBleHBlY3QocXVlcnlTdGF0cy5jb3VudCkudG9CZSgzKTtcbiAgICBleHBlY3QocXVlcnlTdGF0cy5kdXJhdGlvbiEuc3VtKS50b0JlKDkwKTtcbiAgICBleHBlY3QocXVlcnlTdGF0cy5kdXJhdGlvbiEubWluKS50b0JlKDEwKTtcbiAgICBleHBlY3QocXVlcnlTdGF0cy5kdXJhdGlvbiEubWF4KS50b0JlKDUwKTtcbiAgICBleHBlY3QocXVlcnlTdGF0cy5kdXJhdGlvbiEuY291bnQpLnRvQmUoMyk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gNi4gQk9VTkRTIEVORk9SQ0VNRU5UXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZGVzY3JpYmUoJ2JvdW5kcyBlbmZvcmNlbWVudCcsICgpID0+IHtcbiAgdGVzdCgnZXJyb3JzIGFycmF5IGlzIGNhcHBlZCBhdCBtYXhBYnNvcmJlZEVycm9yc1BlclNwYW4nLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyB9KTtcbiAgICBjb25zdCBlcnJvckNoaWxkcmVuID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNSB9LCAoXywgaSkgPT5cbiAgICAgIG1ha2VFdmVudCh7XG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBvcGVyYXRpb246IGBvcC0ke2l9YCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiB7IHR5cGU6ICdFcnJvcicsIG1lc3NhZ2U6IGBFcnJvciAke2l9YCB9LFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgbWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuOiAzLFxuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIGlkOiAnYWJzb3JiLWxvZ3MnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Fic29yYicsXG4gICAgICAgIHByaW9yaXR5OiAyMDAwLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIC4uLmVycm9yQ2hpbGRyZW5dLCBjb25maWcpO1xuXG4gICAgY29uc3QgYWJzb3JiZWQgPSByZXN1bHQuZXZlbnRzWzBdLmFic29yYmVkITtcbiAgICBleHBlY3QoYWJzb3JiZWQuY291bnQpLnRvQmUoNSk7IC8vIEFsbCBjb3VudGVkXG4gICAgZXhwZWN0KGFic29yYmVkLmVycm9ycykudG9IYXZlTGVuZ3RoKDMpOyAvLyBCdXQgZXJyb3JzIGNhcHBlZFxuICB9KTtcblxuICB0ZXN0KCdvcGVyYXRpb24ga2V5cyBhcmUgY2FwcGVkIGF0IG1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW4nLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50ID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyB9KTtcbiAgICBjb25zdCBjaGlsZHJlbiA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0sIChfLCBpKSA9PlxuICAgICAgbWFrZUV2ZW50KHtcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIG9wZXJhdGlvbjogYHVuaXF1ZS1vcC0ke2l9YCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIG1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW46IDUsXG4gICAgICBydWxlczogW3tcbiAgICAgICAgaWQ6ICdhYnNvcmItbG9ncycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcGFyZW50LCAuLi5jaGlsZHJlbl0sIGNvbmZpZyk7XG5cbiAgICBjb25zdCBhYnNvcmJlZCA9IHJlc3VsdC5ldmVudHNbMF0uYWJzb3JiZWQhO1xuICAgIGV4cGVjdChhYnNvcmJlZC5jb3VudCkudG9CZSgxMCk7IC8vIEFsbCBjb3VudGVkXG4gICAgZXhwZWN0KE9iamVjdC5rZXlzKGFic29yYmVkLmJ5T3BlcmF0aW9uKS5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoNSk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gNy4gRURHRSBDQVNFU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdlZGdlIGNhc2VzJywgKCkgPT4ge1xuICB0ZXN0KCdlbXB0eSBpbnB1dCByZXR1cm5zIGVtcHR5IG91dHB1dCcsICgpID0+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtdLCBtYWtlQ29uZmlnKCkpO1xuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnRvdGFsSW5wdXQpLnRvQmUoMCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3NpbmdsZSBldmVudCBpcyBhbHdheXMgZW1pdHRlZCcsICgpID0+IHtcbiAgICBjb25zdCBldmVudCA9IG1ha2VFdmVudCgpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW2V2ZW50XSwgbWFrZUNvbmZpZygpKTtcblxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5lbWl0dGVkKS50b0JlKDEpO1xuICB9KTtcblxuICB0ZXN0KCdyb290IG5vZGUgd2l0aCBhYnNvcmIgZGVjaXNpb24gaXMgc3VwcHJlc3NlZCAoZW50aXJlIHRyZWUgaXMgbm9pc2UpJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoeyBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JywgdHlwZTogJ2xvZycgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ2Fic29yYi1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtyb290XSwgY29uZmlnKTtcblxuICAgIC8vIFJvb3Qgc3VwcHJlc3Npb246IGFsbCBlbWl0dGVkIGV2ZW50cyBhcmUgcHJvbW90ZWQsIGVudGlyZSBpbnZvY2F0aW9uIGlzIG5vaXNlIOKGkiBkcm9wcGVkXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgxKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmFic29yYmVkKS50b0JlKDEpO1xuICB9KTtcblxuICB0ZXN0KCdwZXItZXZlbnQgb3ZlcnJpZGUgdGFrZXMgcHJlY2VkZW5jZSBvdmVyIHJ1bGVzJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgY2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgY2FwdHVyZTogeyBub2lzZTogeyBkZWNpc2lvbjogJ2VtaXQnLCByZWFzb246ICdJbXBvcnRhbnQgbG9nJyB9IH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ3NpbGVudC1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdzaWxlbnQnLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtwYXJlbnQsIGNoaWxkXSwgY29uZmlnKTtcblxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2NoaWxkJykpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIHRlc3QoJ2RlZXAgdHJlZSB3aXRoIG1peGVkIGRlY2lzaW9ucyByZXNvbHZlcyBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLCB0eXBlOiAnc3BhbicgfSk7XG4gICAgY29uc3QgbDEgPSBtYWtlRXZlbnQoeyBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsMScsIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLCB0eXBlOiAnc3BhbicgfSk7XG4gICAgY29uc3QgbDJTaWxlbnQgPSBtYWtlRXZlbnQoeyBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsMnMnLCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdsMScsIHR5cGU6ICdsb2cnIH0pO1xuICAgIGNvbnN0IGwyQWJzb3JiID0gbWFrZUV2ZW50KHsgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbDJhJywgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbDEnLCB0eXBlOiAnbWV0cmljJyB9KTtcbiAgICBjb25zdCBsMkVtaXQgPSBtYWtlRXZlbnQoeyBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsMmUnLCBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdsMScsIHR5cGU6ICdhdWRpdCcgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIHsgaWQ6ICdzaWxlbnQtbG9ncycsIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sIGRlY2lzaW9uOiAnc2lsZW50JyB9LFxuICAgICAgICB7IGlkOiAnYWJzb3JiLW1ldHJpY3MnLCBtYXRjaDogeyB0eXBlOiAnbWV0cmljJyB9LCBkZWNpc2lvbjogJ2Fic29yYicgfSxcbiAgICAgICAgeyBpZDogJ2VtaXQtYXVkaXRzJywgbWF0Y2g6IHsgdHlwZTogJ2F1ZGl0JyB9LCBkZWNpc2lvbjogJ2VtaXQnIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcm9vdCwgbDEsIGwyU2lsZW50LCBsMkFic29yYiwgbDJFbWl0XSwgY29uZmlnKTtcblxuICAgIC8vIHJvb3Q6IGVtaXR0ZWQsIGwxOiBlbWl0dGVkLCBsMmU6IGVtaXR0ZWQsIGwyczogc2lsZW5jZWQsIGwyYTogYWJzb3JiZWRcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmVtaXR0ZWQpLnRvQmUoMyk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5hYnNvcmJlZCkudG9CZSgxKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnNpbGVuY2VkKS50b0JlKDEpO1xuXG4gICAgLy8gbDJlIHNob3VsZCBoYXZlIGwxIGFzIHJlc29sdmVkIHBhcmVudFxuICAgIGNvbnN0IGwyZVJlc3VsdCA9IGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2wyZScpO1xuICAgIGV4cGVjdChsMmVSZXN1bHQhLnJlc29sdmVkUGFyZW50SWQpLnRvQmUoJ2wxJyk7XG5cbiAgICAvLyBsMSBzaG91bGQgaGF2ZSBhYnNvcmJlZCBkYXRhIGZyb20gbDJhIGFuZCBzaWxlbnQgY291bnQgZnJvbSBsMnNcbiAgICBjb25zdCBsMVJlc3VsdCA9IGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2wxJyk7XG4gICAgZXhwZWN0KGwxUmVzdWx0IS5hYnNvcmJlZCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QobDFSZXN1bHQhLmFic29yYmVkIS5jb3VudCkudG9CZSgxKTsgLy8gbDJBYnNvcmJcbiAgICBleHBlY3QobDFSZXN1bHQhLmFic29yYmVkIS5zaWxlbnRDb3VudCkudG9CZSgxKTsgLy8gbDJTaWxlbnRcbiAgfSk7XG59KTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyA4LiBTUEFOLlNUQVJUIEhBTkRMSU5HXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZGVzY3JpYmUoJ3NwYW4uc3RhcnQgaGFuZGxpbmcnLCAoKSA9PiB7XG4gIHRlc3QoJ3NwYW4uc3RhcnQgaXMgZW1pdHRlZCB3aGVuIGl0cyBzcGFuIGlzIGVtaXR0ZWQnLCAoKSA9PiB7XG4gICAgY29uc3Qgc3BhblN0YXJ0ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3NwYW4tMScsXG4gICAgICB0eXBlOiAnc3Bhbi5zdGFydCcsXG4gICAgICBvcGVyYXRpb246ICdteU9wJyxcbiAgICB9KTtcbiAgICBjb25zdCBzcGFuID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3NwYW4tMScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdteU9wJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW3NwYW5TdGFydCwgc3Bhbl0sIG1ha2VDb25maWcoKSk7XG5cbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDIpO1xuICB9KTtcblxuICB0ZXN0KCdzcGFuLnN0YXJ0IGlzIGRyb3BwZWQgd2hlbiBpdHMgc3BhbiBpcyBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCBzcGFuU3RhcnQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc3Bhbi0xJyxcbiAgICAgIHR5cGU6ICdzcGFuLnN0YXJ0JyxcbiAgICAgIG9wZXJhdGlvbjogJ215T3AnLFxuICAgIH0pO1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3Qgc3BhbiA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzcGFuLTEnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ215T3AnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW3tcbiAgICAgICAgaWQ6ICdzaWxlbnQtc3BhbnMnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicsIG9wZXJhdGlvbjogJ215T3AnIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbc3BhblN0YXJ0LCBwYXJlbnQsIHNwYW5dLCBjb25maWcpO1xuXG4gICAgLy8gcGFyZW50IGVtaXR0ZWQsIHNwYW4uc3RhcnQgc2lsZW5jZWQgYWxvbmcgd2l0aCBzcGFuXG4gICAgY29uc3QgaGFzU3BhblN0YXJ0ID0gcmVzdWx0LmV2ZW50cy5zb21lKGUgPT4gZS5ldmVudC50eXBlID09PSAnc3Bhbi5zdGFydCcpO1xuICAgIGV4cGVjdChoYXNTcGFuU3RhcnQpLnRvQmUoZmFsc2UpO1xuICB9KTtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDkuIFBJQ0sgTk9JU0UgREVDSVNJT05cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgncGlja05vaXNlRGVjaXNpb24nLCAoKSA9PiB7XG4gIHRlc3QoJ3JldHVybnMgZW1pdCB3aGVuIG5vIHJ1bGVzIG1hdGNoJywgKCkgPT4ge1xuICAgIGNvbnN0IGV2ZW50ID0gbWFrZUV2ZW50KCk7XG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZygpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gcGlja05vaXNlRGVjaXNpb24oZXZlbnQsIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdlbWl0Jyk7XG4gICAgZXhwZWN0KHJlc3VsdC5ydWxlSWQpLnRvQmUoJ2RlZmF1bHQnKTtcbiAgfSk7XG5cbiAgdGVzdCgncmV0dXJucyBtYXRjaGluZyBydWxlIGRlY2lzaW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IGV2ZW50ID0gbWFrZUV2ZW50KHsgdHlwZTogJ2xvZycgfSk7XG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW3tcbiAgICAgICAgaWQ6ICdhYnNvcmItbG9ncycsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnYWJzb3JiJyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gcGlja05vaXNlRGVjaXNpb24oZXZlbnQsIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LmRlY2lzaW9uKS50b0JlKCdhYnNvcmInKTtcbiAgICBleHBlY3QocmVzdWx0LnJ1bGVJZCkudG9CZSgnYWJzb3JiLWxvZ3MnKTtcbiAgfSk7XG59KTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyAxMC4gU1RBVFNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgnc3RhdHMnLCAoKSA9PiB7XG4gIHRlc3QoJ3RvdGFsSW5wdXQgaXMgY29ycmVjdCcsICgpID0+IHtcbiAgICBjb25zdCBldmVudHMgPSBbbWFrZUV2ZW50KCksIG1ha2VFdmVudCgpLCBtYWtlRXZlbnQoKV07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIG1ha2VDb25maWcoKSk7XG5cbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnRvdGFsSW5wdXQpLnRvQmUoMyk7XG4gIH0pO1xuXG4gIHRlc3QoJ29wZXJhdGlvbiBicmVha2Rvd25zIHRyYWNrIGFic29yYmVkIGFuZCBzaWxlbmNlZCBvcGVyYXRpb25zJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcgfSk7XG4gICAgY29uc3QgYWJzb3JiZWRDaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBvcGVyYXRpb246ICdxdWVyeURCJyxcbiAgICB9KTtcbiAgICBjb25zdCBzaWxlbmNlZENoaWxkID0gbWFrZUV2ZW50KHtcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnbWV0cmljJyxcbiAgICAgIG9wZXJhdGlvbjogJ2hlYWx0aGNoZWNrJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFtcbiAgICAgICAgeyBpZDogJ2Fic29yYi1sb2dzJywgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSwgZGVjaXNpb246ICdhYnNvcmInIH0sXG4gICAgICAgIHsgaWQ6ICdzaWxlbnQtbWV0cmljcycsIG1hdGNoOiB7IHR5cGU6ICdtZXRyaWMnIH0sIGRlY2lzaW9uOiAnc2lsZW50JyB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW3BhcmVudCwgYWJzb3JiZWRDaGlsZCwgc2lsZW5jZWRDaGlsZF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmFic29yYmVkQnlPcGVyYXRpb25bJ3F1ZXJ5REInXSkudG9CZSgxKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnNpbGVuY2VkQnlPcGVyYXRpb25bJ2hlYWx0aGNoZWNrJ10pLnRvQmUoMSk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gMTEuIFJPT1QgU1VQUFJFU1NJT05cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgncm9vdCBzdXBwcmVzc2lvbicsICgpID0+IHtcbiAgdGVzdCgnc2luZ2xlIHJvb3Qgd2l0aCBzaWxlbnQgZGVjaXNpb24g4oaSIGVudGlyZSBpbnZvY2F0aW9uIHN1cHByZXNzZWQnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAnZXZlbnRfcHJvY2Vzc29yJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFt7XG4gICAgICAgIGlkOiAnc2lsZW50LXByb2Nlc3NvcnMnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicsIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAnZXZlbnRfcHJvY2Vzc29yJyB9IH0sXG4gICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcm9vdF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDApO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDEpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc2lsZW5jZWQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ3Jvb3Qgd2l0aCBzaWxlbnQgZGVjaXNpb24gKyBhbGwgY2hpbGRyZW4gYWJzb3JiZWQg4oaSIHN1cHByZXNzZWQnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAndGFzaycgfSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgfSk7XG4gICAgY29uc3QgY2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIG9wZXJhdGlvbjogJ1B1Ymxpc2ggU05TIGRvbmUnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW1xuICAgICAgICB7IGlkOiAnc2lsZW50LXRhc2tzJywgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nLCB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0gfSwgZGVjaXNpb246ICdzaWxlbnQnIH0sXG4gICAgICAgIHsgaWQ6ICdhYnNvcmItbG9ncycsIG1hdGNoOiB7IHR5cGU6ICdsb2cnIH0sIGRlY2lzaW9uOiAnYWJzb3JiJyB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW3Jvb3QsIGNoaWxkXSwgY29uZmlnKTtcblxuICAgIC8vIFJvb3QgaXMgcHJvbW90ZWQgZnJvbSBzaWxlbnQsIGNoaWxkIGlzIGFic29yYmVkIGludG8gcm9vdC4gQWxsIGVtaXR0ZWQgPSBwcm9tb3RlZCDihpIgc3VwcHJlc3NlZC5cbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDApO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDEpO1xuICB9KTtcblxuICB0ZXN0KCdzaWxlbnQgcm9vdCBzdHJpcHBlZCwgZ2VudWluZWx5IGVtaXR0ZWQgY2hpbGQga2VwdCBhcyBuZXcgcm9vdCcsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgIH0pO1xuICAgIGNvbnN0IGF1ZGl0Q2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnYXVkaXQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICB0eXBlOiAnYXVkaXQnLFxuICAgICAgb3BlcmF0aW9uOiAnZW50aXR5LnVwZGF0ZScsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIHsgaWQ6ICdzaWxlbnQtcHJvY2Vzc29ycycsIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0gfSwgZGVjaXNpb246ICdzaWxlbnQnIH0sXG4gICAgICAgIC8vIE5vIHJ1bGUgZm9yIGF1ZGl0IOKGkiBkZWZhdWx0cyB0byBlbWl0XG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcm9vdCwgYXVkaXRDaGlsZF0sIGNvbmZpZyk7XG5cbiAgICAvLyBSb290IGlzIHNpbGVudCDihpIgcHJvbW90ZWQg4oaSIHN0cmlwcGVkIGZyb20gb3V0cHV0XG4gICAgLy8gQXVkaXQgY2hpbGQgaXMgZ2VudWluZWx5IGVtaXR0ZWQg4oaSIGtlcHQsIHBhcmVudCByZWYgY2xlYXJlZCAoYmVjb21lcyBuZXcgcm9vdClcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDApO1xuICAgIGV4cGVjdChmaW5kRW1pdHRlZChyZXN1bHQsICdyb290JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnYXVkaXQnKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnYXVkaXQnKSEucmVzb2x2ZWRQYXJlbnRJZCkudG9CZVVuZGVmaW5lZCgpO1xuICB9KTtcblxuICB0ZXN0KCdoYXJkIHNpZ25hbCBjaGlsZCBwcmV2ZW50cyByb290IHN1cHByZXNzaW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgIH0pO1xuICAgIGNvbnN0IGVycm9yQ2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3ItY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiB7IHR5cGU6ICdFcnJvcicsIG1lc3NhZ2U6ICdTb21ldGhpbmcgYnJva2UnIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIHsgaWQ6ICdzaWxlbnQtdGFza3MnLCBtYXRjaDogeyB0eXBlOiAnc3BhbicsIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAndGFzaycgfSwgc3VjY2VzczogdHJ1ZSB9LCBkZWNpc2lvbjogJ3NpbGVudCcgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFtyb290LCBlcnJvckNoaWxkXSwgY29uZmlnKTtcblxuICAgIC8vIEVycm9yIGNoaWxkIGlzIGEgaGFyZCBzaWduYWwg4oaSIGZvcmNlcyByb290IHRvIGVtaXQgdmlhIGhhcmQtc2lnbmFsLWFuY2VzdG9yXG4gICAgLy8gTmVpdGhlciBhcmUgcHJvbW90ZWQg4oaSIG5vdCBzdXBwcmVzc2VkXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgwKTtcbiAgfSk7XG5cbiAgdGVzdCgnbXVsdGlwbGUgcm9vdHMgYWxsIHNpbGVuY2VkIOKGkiBhbGwgc3VwcHJlc3NlZCcsICgpID0+IHtcbiAgICBjb25zdCByb290MSA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290MScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgIH0pO1xuICAgIGNvbnN0IHJvb3QyID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QyJyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAnZXZlbnRfcHJvY2Vzc29yJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VDb25maWcoe1xuICAgICAgcnVsZXM6IFtcbiAgICAgICAgeyBpZDogJ3NpbGVudC10YXNrcycsIG1hdGNoOiB7IHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAndGFzaycgfSB9LCBkZWNpc2lvbjogJ3NpbGVudCcgfSxcbiAgICAgICAgeyBpZDogJ3NpbGVudC1wcm9jZXNzb3JzJywgbWF0Y2g6IHsgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0gfSwgZGVjaXNpb246ICdzaWxlbnQnIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcm9vdDEsIHJvb3QyXSwgY29uZmlnKTtcblxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMik7XG4gIH0pO1xuXG4gIHRlc3QoJ25vaXNlIHJvb3Qgc3RyaXBwZWQgKyBnZW51aW5lIHJvb3Qga2VwdCAobWl4ZWQgYmF0Y2gpJywgKCkgPT4ge1xuICAgIGNvbnN0IG5vaXNlUm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdub2lzZScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgIH0pO1xuICAgIGNvbnN0IGltcG9ydGFudFJvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaW1wb3J0YW50JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ1BPU1QgL2FwaS91c2VycycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIHsgaWQ6ICdzaWxlbnQtdGFza3MnLCBtYXRjaDogeyB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0gfSwgZGVjaXNpb246ICdzaWxlbnQnIH0sXG4gICAgICAgIC8vIE5vIHJ1bGUgZm9yIHRoZSBBUEkgc3BhbiDihpIgZGVmYXVsdHMgdG8gZW1pdFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW25vaXNlUm9vdCwgaW1wb3J0YW50Um9vdF0sIGNvbmZpZyk7XG5cbiAgICAvLyBOb2lzZSByb290IGlzIHNpbGVudCDihpIgcHJvbW90ZWQg4oaSIHN0cmlwcGVkIGZyb20gb3V0cHV0XG4gICAgLy8gSW1wb3J0YW50IHJvb3QgaXMgZ2VudWluZWx5IGVtaXR0ZWQg4oaSIGtlcHRcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChmaW5kRW1pdHRlZChyZXN1bHQsICdub2lzZScpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2ltcG9ydGFudCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDApO1xuICB9KTtcblxuICB0ZXN0KCdzdXBwcmVzc2VkUm9vdHMgc3RhdCBjb3JyZWN0bHkgcmVmbGVjdHMgY291bnQnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyJyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUNvbmZpZyh7XG4gICAgICBydWxlczogW3sgaWQ6ICdhYnNvcmItYWxsJywgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSwgZGVjaXNpb246ICdhYnNvcmInIH1dLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbcm9vdF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgxKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnRvdGFsSW5wdXQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5lbWl0dGVkKS50b0JlKDApO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuYWJzb3JiZWQpLnRvQmUoMSk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gMTIuIEJVSUxEIEFORCBFVkFMVUFURSAoaW5zcGVjdGlvbiBoZWxwZXIpXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZGVzY3JpYmUoJ2J1aWxkQW5kRXZhbHVhdGUnLCAoKSA9PiB7XG4gIHRlc3QoJ3JldHVybnMgdHJlZSB3aXRoIGV2YWx1YXRpb25zJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudCA9IG1ha2VFdmVudCh7IG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsIHR5cGU6ICdzcGFuJyB9KTtcbiAgICBjb25zdCBjaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlQ29uZmlnKHtcbiAgICAgIHJ1bGVzOiBbe1xuICAgICAgICBpZDogJ2Fic29yYi1sb2dzJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycgfSxcbiAgICAgICAgZGVjaXNpb246ICdhYnNvcmInLFxuICAgICAgfV0sXG4gICAgfSk7XG5cbiAgICBjb25zdCB7IHJvb3RzLCBub2RlQnlJZCB9ID0gYnVpbGRBbmRFdmFsdWF0ZShbcGFyZW50LCBjaGlsZF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3Qocm9vdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3Qocm9vdHNbMF0uZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdwYXJlbnQnKTtcbiAgICBleHBlY3Qocm9vdHNbMF0uZXZhbHVhdGlvbj8uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgICBleHBlY3Qocm9vdHNbMF0uY2hpbGRyZW4pLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3Qocm9vdHNbMF0uY2hpbGRyZW5bMF0uZXZhbHVhdGlvbj8uZGVjaXNpb24pLnRvQmUoJ2Fic29yYicpO1xuXG4gICAgY29uc3QgY2hpbGROb2RlID0gbm9kZUJ5SWQuZ2V0KCdjaGlsZCcpO1xuICAgIGV4cGVjdChjaGlsZE5vZGU/LmV2YWx1YXRpb24/LnJ1bGVJZCkudG9CZSgnYWJzb3JiLWxvZ3MnKTtcbiAgfSk7XG59KTtcbiJdfQ==