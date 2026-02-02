"use strict";
/**
 * Hierarchy Integrity Tests
 *
 * These tests verify that after noise reduction transformations (fold, drop, aggregate),
 * the parentObservabilityLogId field ALWAYS matches the actual tree structure.
 *
 * Critical invariants:
 * 1. Every non-root event in output must have parentObservabilityLogId set
 * 2. Every parentObservabilityLogId must point to an event that EXISTS in output
 * 3. The hierarchy must form a valid tree (no cycles, no orphans)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
const types_1 = require("../../types");
describe('Hierarchy Integrity After Noise Reduction', () => {
    // Use custom rules for predictable test behavior
    const config = (0, config_1.createObservabilityConfig)({
        enabled: true,
        minLevel: types_1.ObservabilityLevel.INFO,
        noiseReduction: {
            enabled: true,
            minLevel: types_1.ObservabilityLevel.INFO,
            hardSignals: {
                levels: ['error', 'critical'],
                slowThresholdMs: 1000, // Treat >1000ms as hard signal
            },
            rules: [
                // Drop fast successful operations
                {
                    id: 'test.drop_fast',
                    match: { maxDurationMs: 999, success: true },
                    decision: 'drop',
                    reason: 'Fast successful operation',
                },
            ],
            emitSummaries: true,
            includeDebugMetadata: true,
        },
    });
    /**
     * Helper: Verify all events in output have valid hierarchy
     */
    function verifyHierarchyIntegrity(events, scenario, options = {}) {
        const eventMap = new Map();
        const roots = [];
        const children = [];
        // INVARIANT 0: If output is empty, nothing to verify (unless explicitly disallowed)
        if (events.length === 0) {
            if (options.allowEmptyOutput === false) {
                throw new Error(`[${scenario}] Output is empty but was expected to have events`);
            }
            return { roots, children, eventMap };
        }
        // Build map of all events and detect duplicates
        for (const event of events) {
            if (eventMap.has(event.observabilityLogId)) {
                throw new Error(`[${scenario}] DUPLICATE ID: Event ID "${event.observabilityLogId}" appears multiple times in output!`);
            }
            eventMap.set(event.observabilityLogId, event);
            if (event.parentObservabilityLogId) {
                children.push(event);
            }
            else {
                roots.push(event);
            }
        }
        // INVARIANT 1: Every child must have a parent that exists in output
        for (const child of children) {
            const parent = eventMap.get(child.parentObservabilityLogId);
            if (!parent) {
                throw new Error(`[${scenario}] ORPHANED CHILD: Event "${child.observabilityLogId}" ` +
                    `references parent "${child.parentObservabilityLogId}" which does NOT exist in output!\n` +
                    `Child: ${JSON.stringify({ id: child.observabilityLogId, operation: child.operation })}\n` +
                    `Available events: ${Array.from(eventMap.keys()).join(', ')}`);
            }
            expect(parent).toBeDefined();
        }
        // INVARIANT 2: Must have at least one root (if output is not empty)
        if (events.length > 0) {
            expect(roots.length).toBeGreaterThan(0);
            if (options.expectedRoots !== undefined) {
                expect(roots.length).toBe(options.expectedRoots);
            }
        }
        // INVARIANT 3: No cycles (walk from each node to root, max depth = event count)
        for (const event of events) {
            let current = event;
            let depth = 0;
            const visited = new Set();
            while (current.parentObservabilityLogId) {
                if (visited.has(current.observabilityLogId)) {
                    throw new Error(`[${scenario}] CYCLE DETECTED: Event "${current.observabilityLogId}" ` +
                        `appears twice in parent chain!\n` +
                        `Path: ${Array.from(visited).join(' → ')} → ${current.observabilityLogId}`);
                }
                visited.add(current.observabilityLogId);
                const parent = eventMap.get(current.parentObservabilityLogId);
                if (!parent) {
                    // Parent doesn't exist - already caught by INVARIANT 1
                    break;
                }
                current = parent;
                depth++;
                if (depth > events.length) {
                    throw new Error(`[${scenario}] INFINITE LOOP: Depth ${depth} exceeded event count ${events.length} while walking to root`);
                }
            }
        }
        // INVARIANT 4: Tree depth should be reasonable (not pathological)
        const maxDepth = Math.max(...Array.from(eventMap.values()).map(e => {
            let depth = 0;
            let current = e;
            while (current.parentObservabilityLogId && eventMap.has(current.parentObservabilityLogId)) {
                depth++;
                current = eventMap.get(current.parentObservabilityLogId);
                if (depth > events.length)
                    break; // Prevent infinite loop
            }
            return depth;
        }));
        // Warn if tree is suspiciously deep (more than half the event count)
        if (maxDepth > events.length / 2) {
            console.warn(`[${scenario}] WARNING: Tree is very deep (${maxDepth} levels with ${events.length} events). ` +
                `This might indicate a problem with reparenting.`);
        }
        return { roots, children, eventMap, maxDepth };
    }
    it('SCENARIO 1: Fast root with slow query - context preserved via hard signal', () => {
        // Tree:
        //   Root (400ms, INFO, should drop)
        //     └─ Child (150ms, DEBUG, should drop)
        //          └─ SlowQuery (1200ms, INFO, HARD SIGNAL)
        //
        // Expected output (NEW algorithm):
        //   Root (kept as context, INFO >= minLevel)
        //     └─ SlowQuery (kept as hard signal, reparented from Child)
        // Child is dropped (DEBUG < INFO minLevel, even with hard signal in subtree)
        const root = {
            type: 'span',
            observabilityLogId: 'root-123',
            parentObservabilityLogId: undefined,
            correlationId: 'test-correlation',
            operation: 'HTTP GET /admin/entity/observabilitylog',
            source: 'AdminDynamicEntityController.list',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 400,
            success: true,
            status: 'completed',
            data: {},
        };
        const child = {
            type: 'span',
            observabilityLogId: 'child-456',
            parentObservabilityLogId: 'root-123',
            correlationId: 'test-correlation',
            operation: 'BaseEntityService.list',
            source: 'service:BaseEntityService',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 150,
            success: true,
            status: 'completed',
            data: {},
        };
        const slowQuery = {
            type: 'span',
            observabilityLogId: 'query-789',
            parentObservabilityLogId: 'child-456',
            correlationId: 'test-correlation',
            operation: 'dynamodb.query',
            source: 'database',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1200,
            success: true,
            status: 'completed',
            data: { tableName: 'observabilitylogs' },
        };
        const events = [root, child, slowQuery];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO 1: Fast root with slow query');
        console.log(`  Input: ${events.length} events (root → child → slowQuery)`);
        console.log(`  Output: ${result.events.length} events`);
        result.events.forEach((e, i) => {
            console.log(`    [${i}] ${e.observabilityLogId} (parent: ${e.parentObservabilityLogId || 'ROOT'})`);
        });
        // Verify hierarchy integrity
        const { eventMap } = verifyHierarchyIntegrity(result.events, 'SCENARIO 1');
        // Specific assertions
        expect(result.events.length).toBe(2); // Root (context) + SlowQuery (hard signal)
        const rootInOutput = eventMap.get('root-123');
        const queryInOutput = result.events.find(e => e.observabilityLogId === 'query-789');
        const childInOutput = eventMap.get('child-456');
        expect(rootInOutput).toBeDefined(); // KEPT (context for hard signal, INFO >= minLevel)
        expect(queryInOutput).toBeDefined(); // KEPT (hard signal: >1000ms)
        expect(childInOutput).toBeUndefined(); // DROPPED (DEBUG < INFO minLevel)
        // SlowQuery must be reparented to Root (Child was dropped)
        expect(queryInOutput.parentObservabilityLogId).toBe('root-123');
        // SlowQuery must have reparenting checkpoint
        const queryData = queryInOutput.data;
        const queryCheckpoints = queryData?.checkpoints;
        expect(Array.isArray(queryCheckpoints)).toBe(true);
        const reparentCheckpoint = queryCheckpoints?.find((c) => c.name === 'noiseReduction.reparented');
        expect(reparentCheckpoint).toBeDefined();
        expect(reparentCheckpoint?.data?.originalParent).toBe('child-456');
        expect(reparentCheckpoint?.data?.newParent).toBe('root-123');
        // Verify stats
        expect(result.stats.dropped).toBe(1); // Child dropped
        expect(result.stats.kept).toBe(2); // Root + SlowQuery
    });
    it('SCENARIO 2: Multi-level drop with reparenting', () => {
        // Tree:
        //   Root (400ms, should drop)
        //     └─ Level1 (100ms, should drop)
        //          └─ Level2 (80ms, should drop)
        //               └─ SlowQuery (1100ms, MUST KEEP)
        //
        // Expected output:
        //   Root (force-kept, contains all folded metrics)
        //     └─ SlowQuery (reparented through multiple levels)
        const root = {
            type: 'span',
            observabilityLogId: 'root',
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'HTTP GET /api',
            source: 'Controller',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 400,
            success: true,
            status: 'completed',
            data: {},
        };
        const level1 = {
            type: 'span',
            observabilityLogId: 'level1',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'Service.process',
            source: 'Service',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 100,
            success: true,
            status: 'completed',
            data: {},
        };
        const level2 = {
            type: 'span',
            observabilityLogId: 'level2',
            parentObservabilityLogId: 'level1',
            correlationId: 'test',
            operation: 'Repository.query',
            source: 'Repository',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 80,
            success: true,
            status: 'completed',
            data: {},
        };
        const slowQuery = {
            type: 'span',
            observabilityLogId: 'slow-query',
            parentObservabilityLogId: 'level2',
            correlationId: 'test',
            operation: 'dynamodb.query',
            source: 'database',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1100,
            success: true,
            status: 'completed',
            data: {},
        };
        const events = [root, level1, level2, slowQuery];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO 2: Multi-level drop with reparenting');
        console.log(`  Input: ${events.length} events (root → level1 → level2 → slowQuery)`);
        console.log(`  Output: ${result.events.length} events`);
        result.events.forEach((e, i) => {
            console.log(`    [${i}] ${e.observabilityLogId} (parent: ${e.parentObservabilityLogId || 'ROOT'})`);
        });
        // Verify hierarchy integrity
        const { eventMap } = verifyHierarchyIntegrity(result.events, 'SCENARIO 2');
        // Specific assertions
        expect(result.events.length).toBe(2); // Root + SlowQuery (level1, level2 folded)
        const rootInOutput = eventMap.get('root');
        const queryInOutput = eventMap.get('slow-query');
        expect(rootInOutput).toBeDefined(); // KEPT (has kept child - slow query)
        expect(queryInOutput).toBeDefined();
        // CRITICAL: SlowQuery must still have Root as parent (reparented through folded levels)
        expect(queryInOutput.parentObservabilityLogId).toBe('root');
    });
    it('SCENARIO 3: All dropped - no hierarchy violations', () => {
        // Tree:
        //   Root (300ms, should drop)
        //     └─ Child (100ms, should drop)
        //
        // Expected output: Empty (all dropped)
        const root = {
            type: 'span',
            observabilityLogId: 'root',
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'HTTP GET /api',
            source: 'Controller',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 300,
            success: true,
            status: 'completed',
            data: {},
        };
        const child = {
            type: 'span',
            observabilityLogId: 'child',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'Service.process',
            source: 'Service',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 100,
            success: true,
            status: 'completed',
            data: {},
        };
        const events = [root, child];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO 3: All dropped');
        console.log(`  Input: ${events.length} events`);
        console.log(`  Output: ${result.events.length} events`);
        // Verify hierarchy integrity (allow empty output)
        verifyHierarchyIntegrity(result.events, 'SCENARIO 3', { allowEmptyOutput: true });
        // Everything should be dropped
        expect(result.events.length).toBe(0);
        expect(result.stats.dropped).toBe(2);
        expect(result.stats.kept).toBe(0);
    });
    it('SCENARIO 4: Multiple children, some kept, some dropped', () => {
        // Tree:
        //   Root (400ms, should drop)
        //     ├─ FastChild1 (50ms, should drop)
        //     ├─ SlowQuery1 (1100ms, MUST KEEP)
        //     ├─ FastChild2 (60ms, should drop)
        //     └─ SlowQuery2 (1200ms, MUST KEEP)
        //
        // Expected output:
        //   Root (force-kept)
        //     ├─ SlowQuery1 (kept)
        //     └─ SlowQuery2 (kept)
        const root = {
            type: 'span',
            observabilityLogId: 'root',
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'HTTP GET /api',
            source: 'Controller',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 400,
            success: true,
            status: 'completed',
            data: {},
        };
        const fastChild1 = {
            type: 'span',
            observabilityLogId: 'fast1',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'FastOp1',
            source: 'Service',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 50,
            success: true,
            status: 'completed',
            data: {},
        };
        const slowQuery1 = {
            type: 'span',
            observabilityLogId: 'slow1',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'dynamodb.query',
            source: 'database',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1100,
            success: true,
            status: 'completed',
            data: {},
        };
        const fastChild2 = {
            type: 'span',
            observabilityLogId: 'fast2',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'FastOp2',
            source: 'Service',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 60,
            success: true,
            status: 'completed',
            data: {},
        };
        const slowQuery2 = {
            type: 'span',
            observabilityLogId: 'slow2',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'dynamodb.scan',
            source: 'database',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1200,
            success: true,
            status: 'completed',
            data: {},
        };
        const events = [root, fastChild1, slowQuery1, fastChild2, slowQuery2];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO 4: Multiple children (mixed)');
        console.log(`  Input: ${events.length} events`);
        console.log(`  Output: ${result.events.length} events`);
        result.events.forEach((e, i) => {
            console.log(`    [${i}] ${e.observabilityLogId} (parent: ${e.parentObservabilityLogId || 'ROOT'})`);
        });
        // Verify hierarchy integrity
        const { eventMap } = verifyHierarchyIntegrity(result.events, 'SCENARIO 4');
        // Specific assertions
        expect(result.events.length).toBe(3); // Root + 2 slow queries
        const rootInOutput = eventMap.get('root');
        const slow1InOutput = eventMap.get('slow1');
        const slow2InOutput = eventMap.get('slow2');
        expect(rootInOutput).toBeDefined();
        expect(slow1InOutput).toBeDefined();
        expect(slow2InOutput).toBeDefined();
        // Both slow queries must have root as parent
        expect(slow1InOutput.parentObservabilityLogId).toBe('root');
        expect(slow2InOutput.parentObservabilityLogId).toBe('root');
    });
    it('SCENARIO 5: Complex tree with errors (hard signals)', () => {
        // Tree:
        //   Root (400ms, should drop)
        //     ├─ Child1 (100ms, should drop)
        //     │    └─ Error (MUST KEEP - error is hard signal)
        //     └─ Child2 (150ms, should drop)
        //          └─ SlowQuery (1200ms, MUST KEEP)
        //
        // Expected output:
        //   Root (force-kept)
        //     ├─ Error (reparented from Child1)
        //     └─ SlowQuery (reparented from Child2)
        const root = {
            type: 'span',
            observabilityLogId: 'root',
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'HTTP GET /api',
            source: 'Controller',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 400,
            success: true,
            status: 'completed',
            data: {},
        };
        const child1 = {
            type: 'span',
            observabilityLogId: 'child1',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'Service.validate',
            source: 'Service',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 100,
            success: true,
            status: 'completed',
            data: {},
        };
        const errorEvent = {
            type: 'log',
            observabilityLogId: 'error',
            parentObservabilityLogId: 'child1',
            correlationId: 'test',
            operation: 'error',
            source: 'Service',
            level: 'error', // HARD SIGNAL
            timestampMs: Date.now(),
            data: { message: 'Validation failed', error: 'ValidationError' },
        };
        const child2 = {
            type: 'span',
            observabilityLogId: 'child2',
            parentObservabilityLogId: 'root',
            correlationId: 'test',
            operation: 'Service.fetch',
            source: 'Service',
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 150,
            success: true,
            status: 'completed',
            data: {},
        };
        const slowQuery = {
            type: 'span',
            observabilityLogId: 'slow',
            parentObservabilityLogId: 'child2',
            correlationId: 'test',
            operation: 'dynamodb.query',
            source: 'database',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1200,
            success: true,
            status: 'completed',
            data: {},
        };
        const events = [root, child1, errorEvent, child2, slowQuery];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO 5: Complex tree with errors');
        console.log(`  Input: ${events.length} events`);
        console.log(`  Output: ${result.events.length} events`);
        result.events.forEach((e, i) => {
            console.log(`    [${i}] ${e.observabilityLogId} (parent: ${e.parentObservabilityLogId || 'ROOT'})`);
        });
        // Verify hierarchy integrity
        const { eventMap } = verifyHierarchyIntegrity(result.events, 'SCENARIO 5');
        // Specific assertions
        expect(result.events.length).toBe(3); // Root + Error + SlowQuery
        const rootInOutput = eventMap.get('root');
        const errorInOutput = eventMap.get('error');
        const slowInOutput = eventMap.get('slow');
        expect(rootInOutput).toBeDefined(); // KEPT (has kept children)
        expect(errorInOutput).toBeDefined();
        expect(slowInOutput).toBeDefined();
        // Both hard signals must be reparented to Root (context preserved)
        expect(errorInOutput.parentObservabilityLogId).toBe('root');
        expect(slowInOutput.parentObservabilityLogId).toBe('root');
    });
    it('EDGE CASE 2: Very deep tree (10 levels)', () => {
        // Create a 10-level deep tree
        const events = [];
        for (let i = 0; i < 10; i++) {
            events.push({
                type: 'span',
                observabilityLogId: `level-${i}`,
                parentObservabilityLogId: i === 0 ? undefined : `level-${i - 1}`,
                correlationId: 'test',
                operation: `Operation.level${i}`,
                source: 'Service',
                level: 'debug',
                timestampMs: Date.now(),
                durationMs: 100, // Fast - should drop
                success: true,
                status: 'completed',
                data: {},
            });
        }
        // Add a slow query at the bottom
        events.push({
            type: 'span',
            observabilityLogId: 'deep-slow-query',
            parentObservabilityLogId: 'level-9',
            correlationId: 'test',
            operation: 'dynamodb.query',
            source: 'database',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1100, // Slow - must keep
            success: true,
            status: 'completed',
            data: {},
        });
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 EDGE CASE 2: Very deep tree');
        console.log(`  Input: ${events.length} events (10-level tree + slow query)`);
        console.log(`  Output: ${result.events.length} events`);
        // Verify hierarchy integrity
        const { eventMap, maxDepth } = verifyHierarchyIntegrity(result.events, 'EDGE CASE 2', { expectedRoots: 1 });
        // All intermediate levels dropped (DEBUG < INFO minLevel)
        // Only slow query remains (hard signal: durationMs > 1000ms)
        expect(result.events.length).toBe(1);
        const queryInOutput = eventMap.get('deep-slow-query');
        expect(queryInOutput).toBeDefined();
        // Query is orphaned (all parents dropped below minLevel)
        expect(queryInOutput.parentObservabilityLogId).toBeUndefined();
        // Max depth should be 0 (single root, no hierarchy)
        expect(maxDepth).toBe(0);
    });
    it('EDGE CASE 3: Many siblings (50 children of same parent)', () => {
        // Root with 50 children, only 2 are slow
        const root = {
            type: 'span',
            observabilityLogId: 'root',
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'HTTP GET /api',
            source: 'Controller',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 400,
            success: true,
            status: 'completed',
            data: {},
        };
        const children = [];
        for (let i = 0; i < 50; i++) {
            const isSlow = i === 10 || i === 30; // Only 2 are slow
            children.push({
                type: 'span',
                observabilityLogId: `child-${i}`,
                parentObservabilityLogId: 'root',
                correlationId: 'test',
                operation: `Operation${i}`,
                source: 'Service',
                level: 'debug',
                timestampMs: Date.now(),
                durationMs: isSlow ? 1100 : 50,
                success: true,
                status: 'completed',
                data: {},
            });
        }
        const events = [root, ...children];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 EDGE CASE 3: Many siblings');
        console.log(`  Input: ${events.length} events (1 root + 50 children)`);
        console.log(`  Output: ${result.events.length} events`);
        // Verify hierarchy integrity
        const { eventMap } = verifyHierarchyIntegrity(result.events, 'EDGE CASE 3', { expectedRoots: 1 });
        // Root + 2 slow children = 3 events
        expect(result.events.length).toBe(3);
        const rootInOutput = eventMap.get('root');
        const slow1 = eventMap.get('child-10');
        const slow2 = eventMap.get('child-30');
        expect(rootInOutput).toBeDefined();
        expect(slow1).toBeDefined();
        expect(slow2).toBeDefined();
        // Both slow children should still have root as parent
        expect(slow1.parentObservabilityLogId).toBe('root');
        expect(slow2.parentObservabilityLogId).toBe('root');
        // Fast children with no kept descendants are DROPPED (not folded)
        // Only children WITH kept descendants are upgraded to FOLD
        expect(result.stats.dropped).toBe(48); // 48 fast children dropped
        expect(result.stats.folded).toBe(0); // None folded (they have no kept descendants)
        expect(result.stats.kept).toBe(3); // Root (force-kept) + 2 slow children
    });
    it('EDGE CASE 4: Duplicate IDs in input (should handle gracefully)', () => {
        // Create events with duplicate IDs
        const event1 = {
            type: 'span',
            observabilityLogId: 'duplicate',
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'Operation1',
            source: 'Service',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1100,
            success: true,
            status: 'completed',
            data: {},
        };
        const event2 = {
            type: 'span',
            observabilityLogId: 'duplicate', // SAME ID!
            parentObservabilityLogId: undefined,
            correlationId: 'test',
            operation: 'Operation2',
            source: 'Service',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1200,
            success: true,
            status: 'completed',
            data: {},
        };
        const events = [event1, event2];
        // Should not crash
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 EDGE CASE 4: Duplicate IDs');
        console.log(`  Input: ${events.length} events (with duplicate IDs)`);
        console.log(`  Output: ${result.events.length} events`);
        // At least one should be kept (they're both slow)
        expect(result.events.length).toBeGreaterThan(0);
        // If duplicates make it to output, hierarchy check will catch it
        expect(() => {
            verifyHierarchyIntegrity(result.events, 'EDGE CASE 4');
        }).not.toThrow(); // Should not throw (duplicates should be handled during tree building)
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGllcmFyY2h5LWludGVncml0eS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL19fdGVzdHNfXy9oaWVyYXJjaHktaW50ZWdyaXR5LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7O0dBVUc7O0FBRUgsb0NBQStDO0FBQy9DLHlDQUF5RDtBQUN6RCx1Q0FBcUU7QUFFckUsUUFBUSxDQUFDLDJDQUEyQyxFQUFFLEdBQUcsRUFBRTtJQUV6RCxpREFBaUQ7SUFDakQsTUFBTSxNQUFNLEdBQUcsSUFBQSxrQ0FBeUIsRUFBQztRQUN2QyxPQUFPLEVBQUUsSUFBSTtRQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO1FBQ2pDLGNBQWMsRUFBRTtZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUk7WUFDakMsV0FBVyxFQUFFO2dCQUNYLE1BQU0sRUFBRSxDQUFFLE9BQU8sRUFBRSxVQUFVLENBQUU7Z0JBQy9CLGVBQWUsRUFBRSxJQUFJLEVBQUUsK0JBQStCO2FBQ3ZEO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLGtDQUFrQztnQkFDbEM7b0JBQ0UsRUFBRSxFQUFFLGdCQUFnQjtvQkFDcEIsS0FBSyxFQUFFLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO29CQUM1QyxRQUFRLEVBQUUsTUFBTTtvQkFDaEIsTUFBTSxFQUFFLDJCQUEyQjtpQkFDcEM7YUFDRjtZQUNELGFBQWEsRUFBRSxJQUFJO1lBQ25CLG9CQUFvQixFQUFFLElBQUk7U0FDM0I7S0FDRixDQUFDLENBQUM7SUFFSDs7T0FFRztJQUNILFNBQVMsd0JBQXdCLENBQy9CLE1BQTRCLEVBQzVCLFFBQWdCLEVBQ2hCLFVBR0ksRUFBRTtRQUVOLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUE4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KiBUaGVzZSB0ZXN0cyB2ZXJpZnkgdGhhdCBhZnRlciBub2lzZSByZWR1Y3Rpb24gdHJhbnNmb3JtYXRpb25zIChmb2xkLCBkcm9wLCBhZ2dyZWdhdGUpLFxuICogdGhlIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBmaWVsZCBBTFdBWVMgbWF0Y2hlcyB0aGUgYWN0dWFsIHRyZWUgc3RydWN0dXJlLlxuICogXG4gKiBDcml0aWNhbCBpbnZhcmlhbnRzOlxuICogMS4gRXZlcnkgbm9uLXJvb3QgZXZlbnQgaW4gb3V0cHV0IG11c3QgaGF2ZSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgc2V0XG4gKiAyLiBFdmVyeSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgbXVzdCBwb2ludCB0byBhbiBldmVudCB0aGF0IEVYSVNUUyBpbiBvdXRwdXRcbiAqIDMuIFRoZSBoaWVyYXJjaHkgbXVzdCBmb3JtIGEgdmFsaWQgdHJlZSAobm8gY3ljbGVzLCBubyBvcnBoYW5zKVxuICovXG5cbmltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24gfSBmcm9tICcuLi9pbmRleCc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vLi4vY29uZmlnJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG5kZXNjcmliZSgnSGllcmFyY2h5IEludGVncml0eSBBZnRlciBOb2lzZSBSZWR1Y3Rpb24nLCAoKSA9PiB7XG5cbiAgLy8gVXNlIGN1c3RvbSBydWxlcyBmb3IgcHJlZGljdGFibGUgdGVzdCBiZWhhdmlvclxuICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgIGhhcmRTaWduYWxzOiB7XG4gICAgICAgIGxldmVsczogWyAnZXJyb3InLCAnY3JpdGljYWwnIF0sXG4gICAgICAgIHNsb3dUaHJlc2hvbGRNczogMTAwMCwgLy8gVHJlYXQgPjEwMDBtcyBhcyBoYXJkIHNpZ25hbFxuICAgICAgfSxcbiAgICAgIHJ1bGVzOiBbXG4gICAgICAgIC8vIERyb3AgZmFzdCBzdWNjZXNzZnVsIG9wZXJhdGlvbnNcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAndGVzdC5kcm9wX2Zhc3QnLFxuICAgICAgICAgIG1hdGNoOiB7IG1heER1cmF0aW9uTXM6IDk5OSwgc3VjY2VzczogdHJ1ZSB9LFxuICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgcmVhc29uOiAnRmFzdCBzdWNjZXNzZnVsIG9wZXJhdGlvbicsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICAgIH0sXG4gIH0pO1xuXG4gIC8qKlxuICAgKiBIZWxwZXI6IFZlcmlmeSBhbGwgZXZlbnRzIGluIG91dHB1dCBoYXZlIHZhbGlkIGhpZXJhcmNoeVxuICAgKi9cbiAgZnVuY3Rpb24gdmVyaWZ5SGllcmFyY2h5SW50ZWdyaXR5KFxuICAgIGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10sXG4gICAgc2NlbmFyaW86IHN0cmluZyxcbiAgICBvcHRpb25zOiB7XG4gICAgICBleHBlY3RlZFJvb3RzPzogbnVtYmVyO1xuICAgICAgYWxsb3dFbXB0eU91dHB1dD86IGJvb2xlYW47XG4gICAgfSA9IHt9XG4gICkge1xuICAgIGNvbnN0IGV2ZW50TWFwID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlFdmVudD4oKTtcbiAgICBjb25zdCByb290czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgICBjb25zdCBjaGlsZHJlbjogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcblxuICAgIC8vIElOVkFSSUFOVCAwOiBJZiBvdXRwdXQgaXMgZW1wdHksIG5vdGhpbmcgdG8gdmVyaWZ5ICh1bmxlc3MgZXhwbGljaXRseSBkaXNhbGxvd2VkKVxuICAgIGlmIChldmVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBpZiAob3B0aW9ucy5hbGxvd0VtcHR5T3V0cHV0ID09PSBmYWxzZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFske3NjZW5hcmlvfV0gT3V0cHV0IGlzIGVtcHR5IGJ1dCB3YXMgZXhwZWN0ZWQgdG8gaGF2ZSBldmVudHNgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IHJvb3RzLCBjaGlsZHJlbiwgZXZlbnRNYXAgfTtcbiAgICB9XG5cbiAgICAvLyBCdWlsZCBtYXAgb2YgYWxsIGV2ZW50cyBhbmQgZGV0ZWN0IGR1cGxpY2F0ZXNcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgICAgaWYgKGV2ZW50TWFwLmhhcyhldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgWyR7c2NlbmFyaW99XSBEVVBMSUNBVEUgSUQ6IEV2ZW50IElEIFwiJHtldmVudC5vYnNlcnZhYmlsaXR5TG9nSWR9XCIgYXBwZWFycyBtdWx0aXBsZSB0aW1lcyBpbiBvdXRwdXQhYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgZXZlbnRNYXAuc2V0KGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCwgZXZlbnQpO1xuXG4gICAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICAgIGNoaWxkcmVuLnB1c2goZXZlbnQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcm9vdHMucHVzaChldmVudCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSU5WQVJJQU5UIDE6IEV2ZXJ5IGNoaWxkIG11c3QgaGF2ZSBhIHBhcmVudCB0aGF0IGV4aXN0cyBpbiBvdXRwdXRcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkcmVuKSB7XG4gICAgICBjb25zdCBwYXJlbnQgPSBldmVudE1hcC5nZXQoY2hpbGQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkISk7XG5cbiAgICAgIGlmICghcGFyZW50KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgWyR7c2NlbmFyaW99XSBPUlBIQU5FRCBDSElMRDogRXZlbnQgXCIke2NoaWxkLm9ic2VydmFiaWxpdHlMb2dJZH1cIiBgICtcbiAgICAgICAgICBgcmVmZXJlbmNlcyBwYXJlbnQgXCIke2NoaWxkLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZH1cIiB3aGljaCBkb2VzIE5PVCBleGlzdCBpbiBvdXRwdXQhXFxuYCArXG4gICAgICAgICAgYENoaWxkOiAke0pTT04uc3RyaW5naWZ5KHsgaWQ6IGNoaWxkLm9ic2VydmFiaWxpdHlMb2dJZCwgb3BlcmF0aW9uOiBjaGlsZC5vcGVyYXRpb24gfSl9XFxuYCArXG4gICAgICAgICAgYEF2YWlsYWJsZSBldmVudHM6ICR7QXJyYXkuZnJvbShldmVudE1hcC5rZXlzKCkpLmpvaW4oJywgJyl9YFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBleHBlY3QocGFyZW50KS50b0JlRGVmaW5lZCgpO1xuICAgIH1cblxuICAgIC8vIElOVkFSSUFOVCAyOiBNdXN0IGhhdmUgYXQgbGVhc3Qgb25lIHJvb3QgKGlmIG91dHB1dCBpcyBub3QgZW1wdHkpXG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICBleHBlY3Qocm9vdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG5cbiAgICAgIGlmIChvcHRpb25zLmV4cGVjdGVkUm9vdHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBleHBlY3Qocm9vdHMubGVuZ3RoKS50b0JlKG9wdGlvbnMuZXhwZWN0ZWRSb290cyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSU5WQVJJQU5UIDM6IE5vIGN5Y2xlcyAod2FsayBmcm9tIGVhY2ggbm9kZSB0byByb290LCBtYXggZGVwdGggPSBldmVudCBjb3VudClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgICAgbGV0IGN1cnJlbnQgPSBldmVudDtcbiAgICAgIGxldCBkZXB0aCA9IDA7XG4gICAgICBjb25zdCB2aXNpdGVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAgIHdoaWxlIChjdXJyZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgICAgICBpZiAodmlzaXRlZC5oYXMoY3VycmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgYFske3NjZW5hcmlvfV0gQ1lDTEUgREVURUNURUQ6IEV2ZW50IFwiJHtjdXJyZW50Lm9ic2VydmFiaWxpdHlMb2dJZH1cIiBgICtcbiAgICAgICAgICAgIGBhcHBlYXJzIHR3aWNlIGluIHBhcmVudCBjaGFpbiFcXG5gICtcbiAgICAgICAgICAgIGBQYXRoOiAke0FycmF5LmZyb20odmlzaXRlZCkuam9pbignIOKGkiAnKX0g4oaSICR7Y3VycmVudC5vYnNlcnZhYmlsaXR5TG9nSWR9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgdmlzaXRlZC5hZGQoY3VycmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGV2ZW50TWFwLmdldChjdXJyZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICAgIGlmICghcGFyZW50KSB7XG4gICAgICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgLSBhbHJlYWR5IGNhdWdodCBieSBJTlZBUklBTlQgMVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgY3VycmVudCA9IHBhcmVudDtcbiAgICAgICAgZGVwdGgrKztcblxuICAgICAgICBpZiAoZGVwdGggPiBldmVudHMubGVuZ3RoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgYFske3NjZW5hcmlvfV0gSU5GSU5JVEUgTE9PUDogRGVwdGggJHtkZXB0aH0gZXhjZWVkZWQgZXZlbnQgY291bnQgJHtldmVudHMubGVuZ3RofSB3aGlsZSB3YWxraW5nIHRvIHJvb3RgXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElOVkFSSUFOVCA0OiBUcmVlIGRlcHRoIHNob3VsZCBiZSByZWFzb25hYmxlIChub3QgcGF0aG9sb2dpY2FsKVxuICAgIGNvbnN0IG1heERlcHRoID0gTWF0aC5tYXgoLi4uQXJyYXkuZnJvbShldmVudE1hcC52YWx1ZXMoKSkubWFwKGUgPT4ge1xuICAgICAgbGV0IGRlcHRoID0gMDtcbiAgICAgIGxldCBjdXJyZW50ID0gZTtcbiAgICAgIHdoaWxlIChjdXJyZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCAmJiBldmVudE1hcC5oYXMoY3VycmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpKSB7XG4gICAgICAgIGRlcHRoKys7XG4gICAgICAgIGN1cnJlbnQgPSBldmVudE1hcC5nZXQoY3VycmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpITtcbiAgICAgICAgaWYgKGRlcHRoID4gZXZlbnRzLmxlbmd0aCkgYnJlYWs7IC8vIFByZXZlbnQgaW5maW5pdGUgbG9vcFxuICAgICAgfVxuICAgICAgcmV0dXJuIGRlcHRoO1xuICAgIH0pKTtcblxuICAgIC8vIFdhcm4gaWYgdHJlZSBpcyBzdXNwaWNpb3VzbHkgZGVlcCAobW9yZSB0aGFuIGhhbGYgdGhlIGV2ZW50IGNvdW50KVxuICAgIGlmIChtYXhEZXB0aCA+IGV2ZW50cy5sZW5ndGggLyAyKSB7XG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIGBbJHtzY2VuYXJpb31dIFdBUk5JTkc6IFRyZWUgaXMgdmVyeSBkZWVwICgke21heERlcHRofSBsZXZlbHMgd2l0aCAke2V2ZW50cy5sZW5ndGh9IGV2ZW50cykuIGAgK1xuICAgICAgICBgVGhpcyBtaWdodCBpbmRpY2F0ZSBhIHByb2JsZW0gd2l0aCByZXBhcmVudGluZy5gXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiB7IHJvb3RzLCBjaGlsZHJlbiwgZXZlbnRNYXAsIG1heERlcHRoIH07XG4gIH1cblxuICBpdCgnU0NFTkFSSU8gMTogRmFzdCByb290IHdpdGggc2xvdyBxdWVyeSAtIGNvbnRleHQgcHJlc2VydmVkIHZpYSBoYXJkIHNpZ25hbCcsICgpID0+IHtcbiAgICAvLyBUcmVlOlxuICAgIC8vICAgUm9vdCAoNDAwbXMsIElORk8sIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJTilIAgQ2hpbGQgKDE1MG1zLCBERUJVRywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgICAgICAg4pSU4pSAIFNsb3dRdWVyeSAoMTIwMG1zLCBJTkZPLCBIQVJEIFNJR05BTClcbiAgICAvL1xuICAgIC8vIEV4cGVjdGVkIG91dHB1dCAoTkVXIGFsZ29yaXRobSk6XG4gICAgLy8gICBSb290IChrZXB0IGFzIGNvbnRleHQsIElORk8gPj0gbWluTGV2ZWwpXG4gICAgLy8gICAgIOKUlOKUgCBTbG93UXVlcnkgKGtlcHQgYXMgaGFyZCBzaWduYWwsIHJlcGFyZW50ZWQgZnJvbSBDaGlsZClcbiAgICAvLyBDaGlsZCBpcyBkcm9wcGVkIChERUJVRyA8IElORk8gbWluTGV2ZWwsIGV2ZW4gd2l0aCBoYXJkIHNpZ25hbCBpbiBzdWJ0cmVlKVxuXG4gICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdC0xMjMnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYWRtaW4vZW50aXR5L29ic2VydmFiaWxpdHlsb2cnLFxuICAgICAgc291cmNlOiAnQWRtaW5EeW5hbWljRW50aXR5Q29udHJvbGxlci5saXN0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC00NTYnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdC0xMjMnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgb3BlcmF0aW9uOiAnQmFzZUVudGl0eVNlcnZpY2UubGlzdCcsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxNTAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBzbG93UXVlcnk6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3F1ZXJ5LTc4OScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC00NTYnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgb3BlcmF0aW9uOiAnZHluYW1vZGIucXVlcnknLFxuICAgICAgc291cmNlOiAnZGF0YWJhc2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTIwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YTogeyB0YWJsZU5hbWU6ICdvYnNlcnZhYmlsaXR5bG9ncycgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyByb290LCBjaGlsZCwgc2xvd1F1ZXJ5IF07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBTQ0VOQVJJTyAxOiBGYXN0IHJvb3Qgd2l0aCBzbG93IHF1ZXJ5Jyk7XG4gICAgY29uc29sZS5sb2coYCAgSW5wdXQ6ICR7ZXZlbnRzLmxlbmd0aH0gZXZlbnRzIChyb290IOKGkiBjaGlsZCDihpIgc2xvd1F1ZXJ5KWApO1xuICAgIGNvbnNvbGUubG9nKGAgIE91dHB1dDogJHtyZXN1bHQuZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG4gICAgcmVzdWx0LmV2ZW50cy5mb3JFYWNoKChlLCBpKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICAgIFske2l9XSAke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSAocGFyZW50OiAke2UucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHx8ICdST09UJ30pYCk7XG4gICAgfSk7XG5cbiAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGludGVncml0eVxuICAgIGNvbnN0IHsgZXZlbnRNYXAgfSA9IHZlcmlmeUhpZXJhcmNoeUludGVncml0eShcbiAgICAgIHJlc3VsdC5ldmVudHMsXG4gICAgICAnU0NFTkFSSU8gMSdcbiAgICApO1xuXG4gICAgLy8gU3BlY2lmaWMgYXNzZXJ0aW9uc1xuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgyKTsgLy8gUm9vdCAoY29udGV4dCkgKyBTbG93UXVlcnkgKGhhcmQgc2lnbmFsKVxuXG4gICAgY29uc3Qgcm9vdEluT3V0cHV0ID0gZXZlbnRNYXAuZ2V0KCdyb290LTEyMycpO1xuICAgIGNvbnN0IHF1ZXJ5SW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3F1ZXJ5LTc4OScpO1xuICAgIGNvbnN0IGNoaWxkSW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ2NoaWxkLTQ1NicpO1xuXG4gICAgZXhwZWN0KHJvb3RJbk91dHB1dCkudG9CZURlZmluZWQoKTsgLy8gS0VQVCAoY29udGV4dCBmb3IgaGFyZCBzaWduYWwsIElORk8gPj0gbWluTGV2ZWwpXG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7IC8vIEtFUFQgKGhhcmQgc2lnbmFsOiA+MTAwMG1zKVxuICAgIGV4cGVjdChjaGlsZEluT3V0cHV0KS50b0JlVW5kZWZpbmVkKCk7IC8vIERST1BQRUQgKERFQlVHIDwgSU5GTyBtaW5MZXZlbClcblxuICAgIC8vIFNsb3dRdWVyeSBtdXN0IGJlIHJlcGFyZW50ZWQgdG8gUm9vdCAoQ2hpbGQgd2FzIGRyb3BwZWQpXG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdC0xMjMnKTtcblxuICAgIC8vIFNsb3dRdWVyeSBtdXN0IGhhdmUgcmVwYXJlbnRpbmcgY2hlY2twb2ludFxuICAgIGNvbnN0IHF1ZXJ5RGF0YSA9IHF1ZXJ5SW5PdXRwdXQhLmRhdGEgYXMgYW55O1xuICAgIGNvbnN0IHF1ZXJ5Q2hlY2twb2ludHMgPSBxdWVyeURhdGE/LmNoZWNrcG9pbnRzO1xuICAgIGV4cGVjdChBcnJheS5pc0FycmF5KHF1ZXJ5Q2hlY2twb2ludHMpKS50b0JlKHRydWUpO1xuICAgIGNvbnN0IHJlcGFyZW50Q2hlY2twb2ludCA9IHF1ZXJ5Q2hlY2twb2ludHM/LmZpbmQoKGM6IGFueSkgPT5cbiAgICAgIGMubmFtZSA9PT0gJ25vaXNlUmVkdWN0aW9uLnJlcGFyZW50ZWQnXG4gICAgKTtcbiAgICBleHBlY3QocmVwYXJlbnRDaGVja3BvaW50KS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChyZXBhcmVudENoZWNrcG9pbnQ/LmRhdGE/Lm9yaWdpbmFsUGFyZW50KS50b0JlKCdjaGlsZC00NTYnKTtcbiAgICBleHBlY3QocmVwYXJlbnRDaGVja3BvaW50Py5kYXRhPy5uZXdQYXJlbnQpLnRvQmUoJ3Jvb3QtMTIzJyk7XG5cbiAgICAvLyBWZXJpZnkgc3RhdHNcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmRyb3BwZWQpLnRvQmUoMSk7IC8vIENoaWxkIGRyb3BwZWRcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmtlcHQpLnRvQmUoMik7IC8vIFJvb3QgKyBTbG93UXVlcnlcbiAgfSk7XG5cbiAgaXQoJ1NDRU5BUklPIDI6IE11bHRpLWxldmVsIGRyb3Agd2l0aCByZXBhcmVudGluZycsICgpID0+IHtcbiAgICAvLyBUcmVlOlxuICAgIC8vICAgUm9vdCAoNDAwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJTilIAgTGV2ZWwxICgxMDBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgICAgICAg4pSU4pSAIExldmVsMiAoODBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgICAgICAgICAgICDilJTilIAgU2xvd1F1ZXJ5ICgxMTAwbXMsIE1VU1QgS0VFUClcbiAgICAvL1xuICAgIC8vIEV4cGVjdGVkIG91dHB1dDpcbiAgICAvLyAgIFJvb3QgKGZvcmNlLWtlcHQsIGNvbnRhaW5zIGFsbCBmb2xkZWQgbWV0cmljcylcbiAgICAvLyAgICAg4pSU4pSAIFNsb3dRdWVyeSAocmVwYXJlbnRlZCB0aHJvdWdoIG11bHRpcGxlIGxldmVscylcblxuICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYXBpJyxcbiAgICAgIHNvdXJjZTogJ0NvbnRyb2xsZXInLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNDAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgbGV2ZWwxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsZXZlbDEnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdTZXJ2aWNlLnByb2Nlc3MnLFxuICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgbGV2ZWwyOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsZXZlbDInLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbGV2ZWwxJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ1JlcG9zaXRvcnkucXVlcnknLFxuICAgICAgc291cmNlOiAnUmVwb3NpdG9yeScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogODAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBzbG93UXVlcnk6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3ctcXVlcnknLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbGV2ZWwyJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ2R5bmFtb2RiLnF1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDExMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBldmVudHMgPSBbIHJvb3QsIGxldmVsMSwgbGV2ZWwyLCBzbG93UXVlcnkgXTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG7wn5SNIFNDRU5BUklPIDI6IE11bHRpLWxldmVsIGRyb3Agd2l0aCByZXBhcmVudGluZycpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50cyAocm9vdCDihpIgbGV2ZWwxIOKGkiBsZXZlbDIg4oaSIHNsb3dRdWVyeSlgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuICAgIHJlc3VsdC5ldmVudHMuZm9yRWFjaCgoZSwgaSkgPT4ge1xuICAgICAgY29uc29sZS5sb2coYCAgICBbJHtpfV0gJHtlLm9ic2VydmFiaWxpdHlMb2dJZH0gKHBhcmVudDogJHtlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB8fCAnUk9PVCd9KWApO1xuICAgIH0pO1xuXG4gICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCB7IGV2ZW50TWFwIH0gPSB2ZXJpZnlIaWVyYXJjaHlJbnRlZ3JpdHkocmVzdWx0LmV2ZW50cywgJ1NDRU5BUklPIDInKTtcblxuICAgIC8vIFNwZWNpZmljIGFzc2VydGlvbnNcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmUoMik7IC8vIFJvb3QgKyBTbG93UXVlcnkgKGxldmVsMSwgbGV2ZWwyIGZvbGRlZClcblxuICAgIGNvbnN0IHJvb3RJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgncm9vdCcpO1xuICAgIGNvbnN0IHF1ZXJ5SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Nsb3ctcXVlcnknKTtcblxuICAgIGV4cGVjdChyb290SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7IC8vIEtFUFQgKGhhcyBrZXB0IGNoaWxkIC0gc2xvdyBxdWVyeSlcbiAgICBleHBlY3QocXVlcnlJbk91dHB1dCkudG9CZURlZmluZWQoKTtcblxuICAgIC8vIENSSVRJQ0FMOiBTbG93UXVlcnkgbXVzdCBzdGlsbCBoYXZlIFJvb3QgYXMgcGFyZW50IChyZXBhcmVudGVkIHRocm91Z2ggZm9sZGVkIGxldmVscylcbiAgICBleHBlY3QocXVlcnlJbk91dHB1dCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gIH0pO1xuXG4gIGl0KCdTQ0VOQVJJTyAzOiBBbGwgZHJvcHBlZCAtIG5vIGhpZXJhcmNoeSB2aW9sYXRpb25zJywgKCkgPT4ge1xuICAgIC8vIFRyZWU6XG4gICAgLy8gICBSb290ICgzMDBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgIOKUlOKUgCBDaGlsZCAoMTAwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vXG4gICAgLy8gRXhwZWN0ZWQgb3V0cHV0OiBFbXB0eSAoYWxsIGRyb3BwZWQpXG5cbiAgICBjb25zdCByb290OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FwaScsXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDMwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ1NlcnZpY2UucHJvY2VzcycsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBldmVudHMgPSBbIHJvb3QsIGNoaWxkIF07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBTQ0VOQVJJTyAzOiBBbGwgZHJvcHBlZCcpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuICAgIGNvbnNvbGUubG9nKGAgIE91dHB1dDogJHtyZXN1bHQuZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG5cbiAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGludGVncml0eSAoYWxsb3cgZW1wdHkgb3V0cHV0KVxuICAgIHZlcmlmeUhpZXJhcmNoeUludGVncml0eShyZXN1bHQuZXZlbnRzLCAnU0NFTkFSSU8gMycsIHsgYWxsb3dFbXB0eU91dHB1dDogdHJ1ZSB9KTtcblxuICAgIC8vIEV2ZXJ5dGhpbmcgc2hvdWxkIGJlIGRyb3BwZWRcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5kcm9wcGVkKS50b0JlKDIpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMua2VwdCkudG9CZSgwKTtcbiAgfSk7XG5cbiAgaXQoJ1NDRU5BUklPIDQ6IE11bHRpcGxlIGNoaWxkcmVuLCBzb21lIGtlcHQsIHNvbWUgZHJvcHBlZCcsICgpID0+IHtcbiAgICAvLyBUcmVlOlxuICAgIC8vICAgUm9vdCAoNDAwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJzilIAgRmFzdENoaWxkMSAoNTBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgIOKUnOKUgCBTbG93UXVlcnkxICgxMTAwbXMsIE1VU1QgS0VFUClcbiAgICAvLyAgICAg4pSc4pSAIEZhc3RDaGlsZDIgKDYwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJTilIAgU2xvd1F1ZXJ5MiAoMTIwMG1zLCBNVVNUIEtFRVApXG4gICAgLy9cbiAgICAvLyBFeHBlY3RlZCBvdXRwdXQ6XG4gICAgLy8gICBSb290IChmb3JjZS1rZXB0KVxuICAgIC8vICAgICDilJzilIAgU2xvd1F1ZXJ5MSAoa2VwdClcbiAgICAvLyAgICAg4pSU4pSAIFNsb3dRdWVyeTIgKGtlcHQpXG5cbiAgICBjb25zdCByb290OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FwaScsXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGZhc3RDaGlsZDE6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Zhc3QxJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnRmFzdE9wMScsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IHNsb3dRdWVyeTE6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3cxJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnZHluYW1vZGIucXVlcnknLFxuICAgICAgc291cmNlOiAnZGF0YWJhc2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGZhc3RDaGlsZDI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Zhc3QyJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnRmFzdE9wMicsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA2MCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IHNsb3dRdWVyeTI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3cyJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnZHluYW1vZGIuc2NhbicsXG4gICAgICBzb3VyY2U6ICdkYXRhYmFzZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMjAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyByb290LCBmYXN0Q2hpbGQxLCBzbG93UXVlcnkxLCBmYXN0Q2hpbGQyLCBzbG93UXVlcnkyIF07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBTQ0VOQVJJTyA0OiBNdWx0aXBsZSBjaGlsZHJlbiAobWl4ZWQpJyk7XG4gICAgY29uc29sZS5sb2coYCAgSW5wdXQ6ICR7ZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG4gICAgY29uc29sZS5sb2coYCAgT3V0cHV0OiAke3Jlc3VsdC5ldmVudHMubGVuZ3RofSBldmVudHNgKTtcbiAgICByZXN1bHQuZXZlbnRzLmZvckVhY2goKGUsIGkpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKGAgICAgWyR7aX1dICR7ZS5vYnNlcnZhYmlsaXR5TG9nSWR9IChwYXJlbnQ6ICR7ZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgfHwgJ1JPT1QnfSlgKTtcbiAgICB9KTtcblxuICAgIC8vIFZlcmlmeSBoaWVyYXJjaHkgaW50ZWdyaXR5XG4gICAgY29uc3QgeyBldmVudE1hcCB9ID0gdmVyaWZ5SGllcmFyY2h5SW50ZWdyaXR5KHJlc3VsdC5ldmVudHMsICdTQ0VOQVJJTyA0Jyk7XG5cbiAgICAvLyBTcGVjaWZpYyBhc3NlcnRpb25zXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMubGVuZ3RoKS50b0JlKDMpOyAvLyBSb290ICsgMiBzbG93IHF1ZXJpZXNcblxuICAgIGNvbnN0IHJvb3RJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgncm9vdCcpO1xuICAgIGNvbnN0IHNsb3cxSW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Nsb3cxJyk7XG4gICAgY29uc3Qgc2xvdzJJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgnc2xvdzInKTtcblxuICAgIGV4cGVjdChyb290SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNsb3cxSW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNsb3cySW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAvLyBCb3RoIHNsb3cgcXVlcmllcyBtdXN0IGhhdmUgcm9vdCBhcyBwYXJlbnRcbiAgICBleHBlY3Qoc2xvdzFJbk91dHB1dCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gICAgZXhwZWN0KHNsb3cySW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICB9KTtcblxuICBpdCgnU0NFTkFSSU8gNTogQ29tcGxleCB0cmVlIHdpdGggZXJyb3JzIChoYXJkIHNpZ25hbHMpJywgKCkgPT4ge1xuICAgIC8vIFRyZWU6XG4gICAgLy8gICBSb290ICg0MDBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgIOKUnOKUgCBDaGlsZDEgKDEwMG1zLCBzaG91bGQgZHJvcClcbiAgICAvLyAgICAg4pSCICAgIOKUlOKUgCBFcnJvciAoTVVTVCBLRUVQIC0gZXJyb3IgaXMgaGFyZCBzaWduYWwpXG4gICAgLy8gICAgIOKUlOKUgCBDaGlsZDIgKDE1MG1zLCBzaG91bGQgZHJvcClcbiAgICAvLyAgICAgICAgICDilJTilIAgU2xvd1F1ZXJ5ICgxMjAwbXMsIE1VU1QgS0VFUClcbiAgICAvL1xuICAgIC8vIEV4cGVjdGVkIG91dHB1dDpcbiAgICAvLyAgIFJvb3QgKGZvcmNlLWtlcHQpXG4gICAgLy8gICAgIOKUnOKUgCBFcnJvciAocmVwYXJlbnRlZCBmcm9tIENoaWxkMSlcbiAgICAvLyAgICAg4pSU4pSAIFNsb3dRdWVyeSAocmVwYXJlbnRlZCBmcm9tIENoaWxkMilcblxuICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYXBpJyxcbiAgICAgIHNvdXJjZTogJ0NvbnRyb2xsZXInLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNDAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGQxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZDEnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdTZXJ2aWNlLnZhbGlkYXRlJyxcbiAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGVycm9yRXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQxJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsIC8vIEhBUkQgU0lHTkFMXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGRhdGE6IHsgbWVzc2FnZTogJ1ZhbGlkYXRpb24gZmFpbGVkJywgZXJyb3I6ICdWYWxpZGF0aW9uRXJyb3InIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkMjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQyJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnU2VydmljZS5mZXRjaCcsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxNTAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBzbG93UXVlcnk6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3cnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQyJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ2R5bmFtb2RiLnF1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEyMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBldmVudHMgPSBbIHJvb3QsIGNoaWxkMSwgZXJyb3JFdmVudCwgY2hpbGQyLCBzbG93UXVlcnkgXTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG7wn5SNIFNDRU5BUklPIDU6IENvbXBsZXggdHJlZSB3aXRoIGVycm9ycycpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuICAgIGNvbnNvbGUubG9nKGAgIE91dHB1dDogJHtyZXN1bHQuZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG4gICAgcmVzdWx0LmV2ZW50cy5mb3JFYWNoKChlLCBpKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICAgIFske2l9XSAke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSAocGFyZW50OiAke2UucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHx8ICdST09UJ30pYCk7XG4gICAgfSk7XG5cbiAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGludGVncml0eVxuICAgIGNvbnN0IHsgZXZlbnRNYXAgfSA9IHZlcmlmeUhpZXJhcmNoeUludGVncml0eShyZXN1bHQuZXZlbnRzLCAnU0NFTkFSSU8gNScpO1xuXG4gICAgLy8gU3BlY2lmaWMgYXNzZXJ0aW9uc1xuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgzKTsgLy8gUm9vdCArIEVycm9yICsgU2xvd1F1ZXJ5XG5cbiAgICBjb25zdCByb290SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Jvb3QnKTtcbiAgICBjb25zdCBlcnJvckluT3V0cHV0ID0gZXZlbnRNYXAuZ2V0KCdlcnJvcicpO1xuICAgIGNvbnN0IHNsb3dJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgnc2xvdycpO1xuXG4gICAgZXhwZWN0KHJvb3RJbk91dHB1dCkudG9CZURlZmluZWQoKTsgLy8gS0VQVCAoaGFzIGtlcHQgY2hpbGRyZW4pXG4gICAgZXhwZWN0KGVycm9ySW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNsb3dJbk91dHB1dCkudG9CZURlZmluZWQoKTtcblxuICAgIC8vIEJvdGggaGFyZCBzaWduYWxzIG11c3QgYmUgcmVwYXJlbnRlZCB0byBSb290IChjb250ZXh0IHByZXNlcnZlZClcbiAgICBleHBlY3QoZXJyb3JJbk91dHB1dCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gICAgZXhwZWN0KHNsb3dJbk91dHB1dCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gIH0pO1xuXG4gIGl0KCdFREdFIENBU0UgMjogVmVyeSBkZWVwIHRyZWUgKDEwIGxldmVscyknLCAoKSA9PiB7XG4gICAgLy8gQ3JlYXRlIGEgMTAtbGV2ZWwgZGVlcCB0cmVlXG4gICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxMDsgaSsrKSB7XG4gICAgICBldmVudHMucHVzaCh7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgbGV2ZWwtJHtpfWAsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogaSA9PT0gMCA/IHVuZGVmaW5lZCA6IGBsZXZlbC0ke2kgLSAxfWAsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgb3BlcmF0aW9uOiBgT3BlcmF0aW9uLmxldmVsJHtpfWAsXG4gICAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMCwgLy8gRmFzdCAtIHNob3VsZCBkcm9wXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICAgIGRhdGE6IHt9LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQWRkIGEgc2xvdyBxdWVyeSBhdCB0aGUgYm90dG9tXG4gICAgZXZlbnRzLnB1c2goe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZGVlcC1zbG93LXF1ZXJ5JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2xldmVsLTknLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnZHluYW1vZGIucXVlcnknLFxuICAgICAgc291cmNlOiAnZGF0YWJhc2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTEwMCwgLy8gU2xvdyAtIG11c3Qga2VlcFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gRURHRSBDQVNFIDI6IFZlcnkgZGVlcCB0cmVlJyk7XG4gICAgY29uc29sZS5sb2coYCAgSW5wdXQ6ICR7ZXZlbnRzLmxlbmd0aH0gZXZlbnRzICgxMC1sZXZlbCB0cmVlICsgc2xvdyBxdWVyeSlgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuXG4gICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCB7IGV2ZW50TWFwLCBtYXhEZXB0aCB9ID0gdmVyaWZ5SGllcmFyY2h5SW50ZWdyaXR5KFxuICAgICAgcmVzdWx0LmV2ZW50cyxcbiAgICAgICdFREdFIENBU0UgMicsXG4gICAgICB7IGV4cGVjdGVkUm9vdHM6IDEgfVxuICAgICk7XG5cbiAgICAvLyBBbGwgaW50ZXJtZWRpYXRlIGxldmVscyBkcm9wcGVkIChERUJVRyA8IElORk8gbWluTGV2ZWwpXG4gICAgLy8gT25seSBzbG93IHF1ZXJ5IHJlbWFpbnMgKGhhcmQgc2lnbmFsOiBkdXJhdGlvbk1zID4gMTAwMG1zKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgxKTtcblxuICAgIGNvbnN0IHF1ZXJ5SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ2RlZXAtc2xvdy1xdWVyeScpO1xuICAgIGV4cGVjdChxdWVyeUluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgLy8gUXVlcnkgaXMgb3JwaGFuZWQgKGFsbCBwYXJlbnRzIGRyb3BwZWQgYmVsb3cgbWluTGV2ZWwpXG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgLy8gTWF4IGRlcHRoIHNob3VsZCBiZSAwIChzaW5nbGUgcm9vdCwgbm8gaGllcmFyY2h5KVxuICAgIGV4cGVjdChtYXhEZXB0aCkudG9CZSgwKTtcbiAgfSk7XG5cbiAgaXQoJ0VER0UgQ0FTRSAzOiBNYW55IHNpYmxpbmdzICg1MCBjaGlsZHJlbiBvZiBzYW1lIHBhcmVudCknLCAoKSA9PiB7XG4gICAgLy8gUm9vdCB3aXRoIDUwIGNoaWxkcmVuLCBvbmx5IDIgYXJlIHNsb3dcbiAgICBjb25zdCByb290OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FwaScsXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkcmVuOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCA1MDsgaSsrKSB7XG4gICAgICBjb25zdCBpc1Nsb3cgPSBpID09PSAxMCB8fCBpID09PSAzMDsgLy8gT25seSAyIGFyZSBzbG93XG4gICAgICBjaGlsZHJlbi5wdXNoKHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBjaGlsZC0ke2l9YCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgb3BlcmF0aW9uOiBgT3BlcmF0aW9uJHtpfWAsXG4gICAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIGR1cmF0aW9uTXM6IGlzU2xvdyA/IDExMDAgOiA1MCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgZGF0YToge30sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBldmVudHMgPSBbIHJvb3QsIC4uLmNoaWxkcmVuIF07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBFREdFIENBU0UgMzogTWFueSBzaWJsaW5ncycpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50cyAoMSByb290ICsgNTAgY2hpbGRyZW4pYCk7XG4gICAgY29uc29sZS5sb2coYCAgT3V0cHV0OiAke3Jlc3VsdC5ldmVudHMubGVuZ3RofSBldmVudHNgKTtcblxuICAgIC8vIFZlcmlmeSBoaWVyYXJjaHkgaW50ZWdyaXR5XG4gICAgY29uc3QgeyBldmVudE1hcCB9ID0gdmVyaWZ5SGllcmFyY2h5SW50ZWdyaXR5KFxuICAgICAgcmVzdWx0LmV2ZW50cyxcbiAgICAgICdFREdFIENBU0UgMycsXG4gICAgICB7IGV4cGVjdGVkUm9vdHM6IDEgfVxuICAgICk7XG5cbiAgICAvLyBSb290ICsgMiBzbG93IGNoaWxkcmVuID0gMyBldmVudHNcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmUoMyk7XG5cbiAgICBjb25zdCByb290SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Jvb3QnKTtcbiAgICBjb25zdCBzbG93MSA9IGV2ZW50TWFwLmdldCgnY2hpbGQtMTAnKTtcbiAgICBjb25zdCBzbG93MiA9IGV2ZW50TWFwLmdldCgnY2hpbGQtMzAnKTtcblxuICAgIGV4cGVjdChyb290SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNsb3cxKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzbG93MikudG9CZURlZmluZWQoKTtcblxuICAgIC8vIEJvdGggc2xvdyBjaGlsZHJlbiBzaG91bGQgc3RpbGwgaGF2ZSByb290IGFzIHBhcmVudFxuICAgIGV4cGVjdChzbG93MSEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gICAgZXhwZWN0KHNsb3cyIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3Jvb3QnKTtcblxuICAgIC8vIEZhc3QgY2hpbGRyZW4gd2l0aCBubyBrZXB0IGRlc2NlbmRhbnRzIGFyZSBEUk9QUEVEIChub3QgZm9sZGVkKVxuICAgIC8vIE9ubHkgY2hpbGRyZW4gV0lUSCBrZXB0IGRlc2NlbmRhbnRzIGFyZSB1cGdyYWRlZCB0byBGT0xEXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5kcm9wcGVkKS50b0JlKDQ4KTsgLy8gNDggZmFzdCBjaGlsZHJlbiBkcm9wcGVkXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5mb2xkZWQpLnRvQmUoMCk7IC8vIE5vbmUgZm9sZGVkICh0aGV5IGhhdmUgbm8ga2VwdCBkZXNjZW5kYW50cylcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmtlcHQpLnRvQmUoMyk7IC8vIFJvb3QgKGZvcmNlLWtlcHQpICsgMiBzbG93IGNoaWxkcmVuXG4gIH0pO1xuXG4gIGl0KCdFREdFIENBU0UgNDogRHVwbGljYXRlIElEcyBpbiBpbnB1dCAoc2hvdWxkIGhhbmRsZSBncmFjZWZ1bGx5KScsICgpID0+IHtcbiAgICAvLyBDcmVhdGUgZXZlbnRzIHdpdGggZHVwbGljYXRlIElEc1xuICAgIGNvbnN0IGV2ZW50MTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZHVwbGljYXRlJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnT3BlcmF0aW9uMScsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDExMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBldmVudDI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2R1cGxpY2F0ZScsIC8vIFNBTUUgSUQhXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHVuZGVmaW5lZCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ09wZXJhdGlvbjInLFxuICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMjAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyBldmVudDEsIGV2ZW50MiBdO1xuXG4gICAgLy8gU2hvdWxkIG5vdCBjcmFzaFxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gRURHRSBDQVNFIDQ6IER1cGxpY2F0ZSBJRHMnKTtcbiAgICBjb25zb2xlLmxvZyhgICBJbnB1dDogJHtldmVudHMubGVuZ3RofSBldmVudHMgKHdpdGggZHVwbGljYXRlIElEcylgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuXG4gICAgLy8gQXQgbGVhc3Qgb25lIHNob3VsZCBiZSBrZXB0ICh0aGV5J3JlIGJvdGggc2xvdylcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcblxuICAgIC8vIElmIGR1cGxpY2F0ZXMgbWFrZSBpdCB0byBvdXRwdXQsIGhpZXJhcmNoeSBjaGVjayB3aWxsIGNhdGNoIGl0XG4gICAgZXhwZWN0KCgpID0+IHtcbiAgICAgIHZlcmlmeUhpZXJhcmNoeUludGVncml0eShyZXN1bHQuZXZlbnRzLCAnRURHRSBDQVNFIDQnKTtcbiAgICB9KS5ub3QudG9UaHJvdygpOyAvLyBTaG91bGQgbm90IHRocm93IChkdXBsaWNhdGVzIHNob3VsZCBiZSBoYW5kbGVkIGR1cmluZyB0cmVlIGJ1aWxkaW5nKVxuICB9KTtcbn0pO1xuIl19