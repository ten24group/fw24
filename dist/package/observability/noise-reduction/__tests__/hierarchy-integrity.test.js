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
    it('EDGE CASE 1: Invalid input - child references non-existent parent', () => {
        // This should NOT crash - noise reduction should handle gracefully
        const orphan = {
            type: 'span',
            observabilityLogId: 'orphan',
            parentObservabilityLogId: 'non-existent-parent', // INVALID!
            correlationId: 'test',
            operation: 'OrphanOperation',
            source: 'Service',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 1100,
            success: true,
            status: 'completed',
            data: {},
        };
        const events = [orphan];
        // Should not crash
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 EDGE CASE 1: Invalid parent reference');
        console.log(`  Input: ${events.length} events`);
        console.log(`  Output: ${result.events.length} events`);
        // Orphan should be kept (it's slow) and PRESERVE invalid parent reference
        // (Hierarchy enforcement will detect and handle this later in the flush flow)
        expect(result.events.length).toBe(1);
        const orphanInOutput = result.events[0];
        expect(orphanInOutput.observabilityLogId).toBe('orphan');
        // BEHAVIOR: Invalid parent reference is PRESERVED (not normalized)
        // This allows enforceHierarchyIntegrityOrDrop() to detect and handle missing parents
        // during the full flush flow, preventing dangling references in the database
        expect(orphanInOutput.parentObservabilityLogId).toBe('non-existent-parent');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGllcmFyY2h5LWludGVncml0eS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL19fdGVzdHNfXy9oaWVyYXJjaHktaW50ZWdyaXR5LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7O0dBVUc7O0FBRUgsb0NBQStDO0FBQy9DLHlDQUF5RDtBQUN6RCx1Q0FBcUU7QUFFckUsUUFBUSxDQUFDLDJDQUEyQyxFQUFFLEdBQUcsRUFBRTtJQUV6RCxpREFBaUQ7SUFDakQsTUFBTSxNQUFNLEdBQUcsSUFBQSxrQ0FBeUIsRUFBQztRQUN2QyxPQUFPLEVBQUUsSUFBSTtRQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO1FBQ2pDLGNBQWMsRUFBRTtZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUk7WUFDakMsV0FBVyxFQUFFO2dCQUNYLE1BQU0sRUFBRSxDQUFFLE9BQU8sRUFBRSxVQUFVLENBQUU7Z0JBQy9CLGVBQWUsRUFBRSxJQUFJLEVBQUUsK0JBQStCO2FBQ3ZEO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLGtDQUFrQztnQkFDbEM7b0JBQ0UsRUFBRSxFQUFFLGdCQUFnQjtvQkFDcEIsS0FBSyxFQUFFLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO29CQUM1QyxRQUFRLEVBQUUsTUFBTTtvQkFDaEIsTUFBTSxFQUFFLDJCQUEyQjtpQkFDcEM7YUFDRjtZQUNELGFBQWEsRUFBRSxJQUFJO1lBQ25CLG9CQUFvQixFQUFFLElBQUk7U0FDM0I7S0FDRixDQUFDLENBQUM7SUFFSDs7T0FFRztJQUNILFNBQVMsd0JBQXdCLENBQy9CLE1BQTRCLEVBQzVCLFFBQWdCLEVBQ2hCLFVBR0ksRUFBRTtRQUVOLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUE4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RSxDQUFDLENBQUMsdUVBQXVFO0lBQzNGLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEhpZXJhcmNoeSBJbnRlZ3JpdHkgVGVzdHNcbiAqIFxuICogVGhlc2UgdGVzdHMgdmVyaWZ5IHRoYXQgYWZ0ZXIgbm9pc2UgcmVkdWN0aW9uIHRyYW5zZm9ybWF0aW9ucyAoZm9sZCwgZHJvcCwgYWdncmVnYXRlKSxcbiAqIHRoZSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgZmllbGQgQUxXQVlTIG1hdGNoZXMgdGhlIGFjdHVhbCB0cmVlIHN0cnVjdHVyZS5cbiAqIFxuICogQ3JpdGljYWwgaW52YXJpYW50czpcbiAqIDEuIEV2ZXJ5IG5vbi1yb290IGV2ZW50IGluIG91dHB1dCBtdXN0IGhhdmUgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHNldFxuICogMi4gRXZlcnkgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIG11c3QgcG9pbnQgdG8gYW4gZXZlbnQgdGhhdCBFWElTVFMgaW4gb3V0cHV0XG4gKiAzLiBUaGUgaGllcmFyY2h5IG11c3QgZm9ybSBhIHZhbGlkIHRyZWUgKG5vIGN5Y2xlcywgbm8gb3JwaGFucylcbiAqL1xuXG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uIH0gZnJvbSAnLi4vaW5kZXgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uLy4uL2NvbmZpZyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCB9IGZyb20gJy4uLy4uL3R5cGVzJztcblxuZGVzY3JpYmUoJ0hpZXJhcmNoeSBJbnRlZ3JpdHkgQWZ0ZXIgTm9pc2UgUmVkdWN0aW9uJywgKCkgPT4ge1xuXG4gIC8vIFVzZSBjdXN0b20gcnVsZXMgZm9yIHByZWRpY3RhYmxlIHRlc3QgYmVoYXZpb3JcbiAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgICBoYXJkU2lnbmFsczoge1xuICAgICAgICBsZXZlbHM6IFsgJ2Vycm9yJywgJ2NyaXRpY2FsJyBdLFxuICAgICAgICBzbG93VGhyZXNob2xkTXM6IDEwMDAsIC8vIFRyZWF0ID4xMDAwbXMgYXMgaGFyZCBzaWduYWxcbiAgICAgIH0sXG4gICAgICBydWxlczogW1xuICAgICAgICAvLyBEcm9wIGZhc3Qgc3VjY2Vzc2Z1bCBvcGVyYXRpb25zXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3Rlc3QuZHJvcF9mYXN0JyxcbiAgICAgICAgICBtYXRjaDogeyBtYXhEdXJhdGlvbk1zOiA5OTksIHN1Y2Nlc3M6IHRydWUgfSxcbiAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgIHJlYXNvbjogJ0Zhc3Qgc3VjY2Vzc2Z1bCBvcGVyYXRpb24nLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGVtaXRTdW1tYXJpZXM6IHRydWUsXG4gICAgICBpbmNsdWRlRGVidWdNZXRhZGF0YTogdHJ1ZSxcbiAgICB9LFxuICB9KTtcblxuICAvKipcbiAgICogSGVscGVyOiBWZXJpZnkgYWxsIGV2ZW50cyBpbiBvdXRwdXQgaGF2ZSB2YWxpZCBoaWVyYXJjaHlcbiAgICovXG4gIGZ1bmN0aW9uIHZlcmlmeUhpZXJhcmNoeUludGVncml0eShcbiAgICBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICAgIHNjZW5hcmlvOiBzdHJpbmcsXG4gICAgb3B0aW9uczoge1xuICAgICAgZXhwZWN0ZWRSb290cz86IG51bWJlcjtcbiAgICAgIGFsbG93RW1wdHlPdXRwdXQ/OiBib29sZWFuO1xuICAgIH0gPSB7fVxuICApIHtcbiAgICBjb25zdCBldmVudE1hcCA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5RXZlbnQ+KCk7XG4gICAgY29uc3Qgcm9vdHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG4gICAgY29uc3QgY2hpbGRyZW46IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgICAvLyBJTlZBUklBTlQgMDogSWYgb3V0cHV0IGlzIGVtcHR5LCBub3RoaW5nIHRvIHZlcmlmeSAodW5sZXNzIGV4cGxpY2l0bHkgZGlzYWxsb3dlZClcbiAgICBpZiAoZXZlbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKG9wdGlvbnMuYWxsb3dFbXB0eU91dHB1dCA9PT0gZmFsc2UpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBbJHtzY2VuYXJpb31dIE91dHB1dCBpcyBlbXB0eSBidXQgd2FzIGV4cGVjdGVkIHRvIGhhdmUgZXZlbnRzYCk7XG4gICAgICB9XG4gICAgICByZXR1cm4geyByb290cywgY2hpbGRyZW4sIGV2ZW50TWFwIH07XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgbWFwIG9mIGFsbCBldmVudHMgYW5kIGRldGVjdCBkdXBsaWNhdGVzXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBldmVudHMpIHtcbiAgICAgIGlmIChldmVudE1hcC5oYXMoZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYFske3NjZW5hcmlvfV0gRFVQTElDQVRFIElEOiBFdmVudCBJRCBcIiR7ZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkfVwiIGFwcGVhcnMgbXVsdGlwbGUgdGltZXMgaW4gb3V0cHV0IWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGV2ZW50TWFwLnNldChldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsIGV2ZW50KTtcblxuICAgICAgaWYgKGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgICAgICBjaGlsZHJlbi5wdXNoKGV2ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJvb3RzLnB1c2goZXZlbnQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElOVkFSSUFOVCAxOiBFdmVyeSBjaGlsZCBtdXN0IGhhdmUgYSBwYXJlbnQgdGhhdCBleGlzdHMgaW4gb3V0cHV0XG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xuICAgICAgY29uc3QgcGFyZW50ID0gZXZlbnRNYXAuZ2V0KGNoaWxkLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCEpO1xuXG4gICAgICBpZiAoIXBhcmVudCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYFske3NjZW5hcmlvfV0gT1JQSEFORUQgQ0hJTEQ6IEV2ZW50IFwiJHtjaGlsZC5vYnNlcnZhYmlsaXR5TG9nSWR9XCIgYCArXG4gICAgICAgICAgYHJlZmVyZW5jZXMgcGFyZW50IFwiJHtjaGlsZC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWR9XCIgd2hpY2ggZG9lcyBOT1QgZXhpc3QgaW4gb3V0cHV0IVxcbmAgK1xuICAgICAgICAgIGBDaGlsZDogJHtKU09OLnN0cmluZ2lmeSh7IGlkOiBjaGlsZC5vYnNlcnZhYmlsaXR5TG9nSWQsIG9wZXJhdGlvbjogY2hpbGQub3BlcmF0aW9uIH0pfVxcbmAgK1xuICAgICAgICAgIGBBdmFpbGFibGUgZXZlbnRzOiAke0FycmF5LmZyb20oZXZlbnRNYXAua2V5cygpKS5qb2luKCcsICcpfWBcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgZXhwZWN0KHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICB9XG5cbiAgICAvLyBJTlZBUklBTlQgMjogTXVzdCBoYXZlIGF0IGxlYXN0IG9uZSByb290IChpZiBvdXRwdXQgaXMgbm90IGVtcHR5KVxuICAgIGlmIChldmVudHMubGVuZ3RoID4gMCkge1xuICAgICAgZXhwZWN0KHJvb3RzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuXG4gICAgICBpZiAob3B0aW9ucy5leHBlY3RlZFJvb3RzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZXhwZWN0KHJvb3RzLmxlbmd0aCkudG9CZShvcHRpb25zLmV4cGVjdGVkUm9vdHMpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElOVkFSSUFOVCAzOiBObyBjeWNsZXMgKHdhbGsgZnJvbSBlYWNoIG5vZGUgdG8gcm9vdCwgbWF4IGRlcHRoID0gZXZlbnQgY291bnQpXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBldmVudHMpIHtcbiAgICAgIGxldCBjdXJyZW50ID0gZXZlbnQ7XG4gICAgICBsZXQgZGVwdGggPSAwO1xuICAgICAgY29uc3QgdmlzaXRlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgICB3aGlsZSAoY3VycmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICAgICAgaWYgKHZpc2l0ZWQuaGFzKGN1cnJlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgIGBbJHtzY2VuYXJpb31dIENZQ0xFIERFVEVDVEVEOiBFdmVudCBcIiR7Y3VycmVudC5vYnNlcnZhYmlsaXR5TG9nSWR9XCIgYCArXG4gICAgICAgICAgICBgYXBwZWFycyB0d2ljZSBpbiBwYXJlbnQgY2hhaW4hXFxuYCArXG4gICAgICAgICAgICBgUGF0aDogJHtBcnJheS5mcm9tKHZpc2l0ZWQpLmpvaW4oJyDihpIgJyl9IOKGkiAke2N1cnJlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkfWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHZpc2l0ZWQuYWRkKGN1cnJlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcblxuICAgICAgICBjb25zdCBwYXJlbnQgPSBldmVudE1hcC5nZXQoY3VycmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgICBpZiAoIXBhcmVudCkge1xuICAgICAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IC0gYWxyZWFkeSBjYXVnaHQgYnkgSU5WQVJJQU5UIDFcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGN1cnJlbnQgPSBwYXJlbnQ7XG4gICAgICAgIGRlcHRoKys7XG5cbiAgICAgICAgaWYgKGRlcHRoID4gZXZlbnRzLmxlbmd0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgIGBbJHtzY2VuYXJpb31dIElORklOSVRFIExPT1A6IERlcHRoICR7ZGVwdGh9IGV4Y2VlZGVkIGV2ZW50IGNvdW50ICR7ZXZlbnRzLmxlbmd0aH0gd2hpbGUgd2Fsa2luZyB0byByb290YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJTlZBUklBTlQgNDogVHJlZSBkZXB0aCBzaG91bGQgYmUgcmVhc29uYWJsZSAobm90IHBhdGhvbG9naWNhbClcbiAgICBjb25zdCBtYXhEZXB0aCA9IE1hdGgubWF4KC4uLkFycmF5LmZyb20oZXZlbnRNYXAudmFsdWVzKCkpLm1hcChlID0+IHtcbiAgICAgIGxldCBkZXB0aCA9IDA7XG4gICAgICBsZXQgY3VycmVudCA9IGU7XG4gICAgICB3aGlsZSAoY3VycmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgJiYgZXZlbnRNYXAuaGFzKGN1cnJlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSkge1xuICAgICAgICBkZXB0aCsrO1xuICAgICAgICBjdXJyZW50ID0gZXZlbnRNYXAuZ2V0KGN1cnJlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSE7XG4gICAgICAgIGlmIChkZXB0aCA+IGV2ZW50cy5sZW5ndGgpIGJyZWFrOyAvLyBQcmV2ZW50IGluZmluaXRlIGxvb3BcbiAgICAgIH1cbiAgICAgIHJldHVybiBkZXB0aDtcbiAgICB9KSk7XG5cbiAgICAvLyBXYXJuIGlmIHRyZWUgaXMgc3VzcGljaW91c2x5IGRlZXAgKG1vcmUgdGhhbiBoYWxmIHRoZSBldmVudCBjb3VudClcbiAgICBpZiAobWF4RGVwdGggPiBldmVudHMubGVuZ3RoIC8gMikge1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBgWyR7c2NlbmFyaW99XSBXQVJOSU5HOiBUcmVlIGlzIHZlcnkgZGVlcCAoJHttYXhEZXB0aH0gbGV2ZWxzIHdpdGggJHtldmVudHMubGVuZ3RofSBldmVudHMpLiBgICtcbiAgICAgICAgYFRoaXMgbWlnaHQgaW5kaWNhdGUgYSBwcm9ibGVtIHdpdGggcmVwYXJlbnRpbmcuYFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyByb290cywgY2hpbGRyZW4sIGV2ZW50TWFwLCBtYXhEZXB0aCB9O1xuICB9XG5cbiAgaXQoJ1NDRU5BUklPIDE6IEZhc3Qgcm9vdCB3aXRoIHNsb3cgcXVlcnkgLSBjb250ZXh0IHByZXNlcnZlZCB2aWEgaGFyZCBzaWduYWwnLCAoKSA9PiB7XG4gICAgLy8gVHJlZTpcbiAgICAvLyAgIFJvb3QgKDQwMG1zLCBJTkZPLCBzaG91bGQgZHJvcClcbiAgICAvLyAgICAg4pSU4pSAIENoaWxkICgxNTBtcywgREVCVUcsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICAgICAgIOKUlOKUgCBTbG93UXVlcnkgKDEyMDBtcywgSU5GTywgSEFSRCBTSUdOQUwpXG4gICAgLy9cbiAgICAvLyBFeHBlY3RlZCBvdXRwdXQgKE5FVyBhbGdvcml0aG0pOlxuICAgIC8vICAgUm9vdCAoa2VwdCBhcyBjb250ZXh0LCBJTkZPID49IG1pbkxldmVsKVxuICAgIC8vICAgICDilJTilIAgU2xvd1F1ZXJ5IChrZXB0IGFzIGhhcmQgc2lnbmFsLCByZXBhcmVudGVkIGZyb20gQ2hpbGQpXG4gICAgLy8gQ2hpbGQgaXMgZHJvcHBlZCAoREVCVUcgPCBJTkZPIG1pbkxldmVsLCBldmVuIHdpdGggaGFyZCBzaWduYWwgaW4gc3VidHJlZSlcblxuICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QtMTIzJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA0MDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQtNDU2JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QtMTIzJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLmxpc3QnLFxuICAgICAgc291cmNlOiAnc2VydmljZTpCYXNlRW50aXR5U2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTUwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3Qgc2xvd1F1ZXJ5OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdxdWVyeS03ODknLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQtNDU2JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgIG9wZXJhdGlvbjogJ2R5bmFtb2RiLnF1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEyMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHsgdGFibGVOYW1lOiAnb2JzZXJ2YWJpbGl0eWxvZ3MnIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IGV2ZW50cyA9IFsgcm9vdCwgY2hpbGQsIHNsb3dRdWVyeSBdO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gU0NFTkFSSU8gMTogRmFzdCByb290IHdpdGggc2xvdyBxdWVyeScpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50cyAocm9vdCDihpIgY2hpbGQg4oaSIHNsb3dRdWVyeSlgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuICAgIHJlc3VsdC5ldmVudHMuZm9yRWFjaCgoZSwgaSkgPT4ge1xuICAgICAgY29uc29sZS5sb2coYCAgICBbJHtpfV0gJHtlLm9ic2VydmFiaWxpdHlMb2dJZH0gKHBhcmVudDogJHtlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB8fCAnUk9PVCd9KWApO1xuICAgIH0pO1xuXG4gICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCB7IGV2ZW50TWFwIH0gPSB2ZXJpZnlIaWVyYXJjaHlJbnRlZ3JpdHkoXG4gICAgICByZXN1bHQuZXZlbnRzLFxuICAgICAgJ1NDRU5BUklPIDEnXG4gICAgKTtcblxuICAgIC8vIFNwZWNpZmljIGFzc2VydGlvbnNcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmUoMik7IC8vIFJvb3QgKGNvbnRleHQpICsgU2xvd1F1ZXJ5IChoYXJkIHNpZ25hbClcblxuICAgIGNvbnN0IHJvb3RJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgncm9vdC0xMjMnKTtcbiAgICBjb25zdCBxdWVyeUluT3V0cHV0ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdxdWVyeS03ODknKTtcbiAgICBjb25zdCBjaGlsZEluT3V0cHV0ID0gZXZlbnRNYXAuZ2V0KCdjaGlsZC00NTYnKTtcblxuICAgIGV4cGVjdChyb290SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7IC8vIEtFUFQgKGNvbnRleHQgZm9yIGhhcmQgc2lnbmFsLCBJTkZPID49IG1pbkxldmVsKVxuICAgIGV4cGVjdChxdWVyeUluT3V0cHV0KS50b0JlRGVmaW5lZCgpOyAvLyBLRVBUIChoYXJkIHNpZ25hbDogPjEwMDBtcylcbiAgICBleHBlY3QoY2hpbGRJbk91dHB1dCkudG9CZVVuZGVmaW5lZCgpOyAvLyBEUk9QUEVEIChERUJVRyA8IElORk8gbWluTGV2ZWwpXG5cbiAgICAvLyBTbG93UXVlcnkgbXVzdCBiZSByZXBhcmVudGVkIHRvIFJvb3QgKENoaWxkIHdhcyBkcm9wcGVkKVxuICAgIGV4cGVjdChxdWVyeUluT3V0cHV0IS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3Jvb3QtMTIzJyk7XG5cbiAgICAvLyBTbG93UXVlcnkgbXVzdCBoYXZlIHJlcGFyZW50aW5nIGNoZWNrcG9pbnRcbiAgICBjb25zdCBxdWVyeURhdGEgPSBxdWVyeUluT3V0cHV0IS5kYXRhIGFzIGFueTtcbiAgICBjb25zdCBxdWVyeUNoZWNrcG9pbnRzID0gcXVlcnlEYXRhPy5jaGVja3BvaW50cztcbiAgICBleHBlY3QoQXJyYXkuaXNBcnJheShxdWVyeUNoZWNrcG9pbnRzKSkudG9CZSh0cnVlKTtcbiAgICBjb25zdCByZXBhcmVudENoZWNrcG9pbnQgPSBxdWVyeUNoZWNrcG9pbnRzPy5maW5kKChjOiBhbnkpID0+XG4gICAgICBjLm5hbWUgPT09ICdub2lzZVJlZHVjdGlvbi5yZXBhcmVudGVkJ1xuICAgICk7XG4gICAgZXhwZWN0KHJlcGFyZW50Q2hlY2twb2ludCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QocmVwYXJlbnRDaGVja3BvaW50Py5kYXRhPy5vcmlnaW5hbFBhcmVudCkudG9CZSgnY2hpbGQtNDU2Jyk7XG4gICAgZXhwZWN0KHJlcGFyZW50Q2hlY2twb2ludD8uZGF0YT8ubmV3UGFyZW50KS50b0JlKCdyb290LTEyMycpO1xuXG4gICAgLy8gVmVyaWZ5IHN0YXRzXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5kcm9wcGVkKS50b0JlKDEpOyAvLyBDaGlsZCBkcm9wcGVkXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5rZXB0KS50b0JlKDIpOyAvLyBSb290ICsgU2xvd1F1ZXJ5XG4gIH0pO1xuXG4gIGl0KCdTQ0VOQVJJTyAyOiBNdWx0aS1sZXZlbCBkcm9wIHdpdGggcmVwYXJlbnRpbmcnLCAoKSA9PiB7XG4gICAgLy8gVHJlZTpcbiAgICAvLyAgIFJvb3QgKDQwMG1zLCBzaG91bGQgZHJvcClcbiAgICAvLyAgICAg4pSU4pSAIExldmVsMSAoMTAwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICAgICAgIOKUlOKUgCBMZXZlbDIgKDgwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICAgICAgICAgICAg4pSU4pSAIFNsb3dRdWVyeSAoMTEwMG1zLCBNVVNUIEtFRVApXG4gICAgLy9cbiAgICAvLyBFeHBlY3RlZCBvdXRwdXQ6XG4gICAgLy8gICBSb290IChmb3JjZS1rZXB0LCBjb250YWlucyBhbGwgZm9sZGVkIG1ldHJpY3MpXG4gICAgLy8gICAgIOKUlOKUgCBTbG93UXVlcnkgKHJlcGFyZW50ZWQgdGhyb3VnaCBtdWx0aXBsZSBsZXZlbHMpXG5cbiAgICBjb25zdCByb290OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FwaScsXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGxldmVsMTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbGV2ZWwxJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnU2VydmljZS5wcm9jZXNzJyxcbiAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGxldmVsMjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbGV2ZWwyJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2xldmVsMScsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdSZXBvc2l0b3J5LnF1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ1JlcG9zaXRvcnknLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDgwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3Qgc2xvd1F1ZXJ5OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93LXF1ZXJ5JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2xldmVsMicsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdkeW5hbW9kYi5xdWVyeScsXG4gICAgICBzb3VyY2U6ICdkYXRhYmFzZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMTAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyByb290LCBsZXZlbDEsIGxldmVsMiwgc2xvd1F1ZXJ5IF07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBTQ0VOQVJJTyAyOiBNdWx0aS1sZXZlbCBkcm9wIHdpdGggcmVwYXJlbnRpbmcnKTtcbiAgICBjb25zb2xlLmxvZyhgICBJbnB1dDogJHtldmVudHMubGVuZ3RofSBldmVudHMgKHJvb3Qg4oaSIGxldmVsMSDihpIgbGV2ZWwyIOKGkiBzbG93UXVlcnkpYCk7XG4gICAgY29uc29sZS5sb2coYCAgT3V0cHV0OiAke3Jlc3VsdC5ldmVudHMubGVuZ3RofSBldmVudHNgKTtcbiAgICByZXN1bHQuZXZlbnRzLmZvckVhY2goKGUsIGkpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKGAgICAgWyR7aX1dICR7ZS5vYnNlcnZhYmlsaXR5TG9nSWR9IChwYXJlbnQ6ICR7ZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgfHwgJ1JPT1QnfSlgKTtcbiAgICB9KTtcblxuICAgIC8vIFZlcmlmeSBoaWVyYXJjaHkgaW50ZWdyaXR5XG4gICAgY29uc3QgeyBldmVudE1hcCB9ID0gdmVyaWZ5SGllcmFyY2h5SW50ZWdyaXR5KHJlc3VsdC5ldmVudHMsICdTQ0VOQVJJTyAyJyk7XG5cbiAgICAvLyBTcGVjaWZpYyBhc3NlcnRpb25zXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMubGVuZ3RoKS50b0JlKDIpOyAvLyBSb290ICsgU2xvd1F1ZXJ5IChsZXZlbDEsIGxldmVsMiBmb2xkZWQpXG5cbiAgICBjb25zdCByb290SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Jvb3QnKTtcbiAgICBjb25zdCBxdWVyeUluT3V0cHV0ID0gZXZlbnRNYXAuZ2V0KCdzbG93LXF1ZXJ5Jyk7XG5cbiAgICBleHBlY3Qocm9vdEluT3V0cHV0KS50b0JlRGVmaW5lZCgpOyAvLyBLRVBUIChoYXMga2VwdCBjaGlsZCAtIHNsb3cgcXVlcnkpXG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAvLyBDUklUSUNBTDogU2xvd1F1ZXJ5IG11c3Qgc3RpbGwgaGF2ZSBSb290IGFzIHBhcmVudCAocmVwYXJlbnRlZCB0aHJvdWdoIGZvbGRlZCBsZXZlbHMpXG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICB9KTtcblxuICBpdCgnU0NFTkFSSU8gMzogQWxsIGRyb3BwZWQgLSBubyBoaWVyYXJjaHkgdmlvbGF0aW9ucycsICgpID0+IHtcbiAgICAvLyBUcmVlOlxuICAgIC8vICAgUm9vdCAoMzAwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJTilIAgQ2hpbGQgKDEwMG1zLCBzaG91bGQgZHJvcClcbiAgICAvL1xuICAgIC8vIEV4cGVjdGVkIG91dHB1dDogRW1wdHkgKGFsbCBkcm9wcGVkKVxuXG4gICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHVuZGVmaW5lZCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hcGknLFxuICAgICAgc291cmNlOiAnQ29udHJvbGxlcicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAzMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdTZXJ2aWNlLnByb2Nlc3MnLFxuICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyByb290LCBjaGlsZCBdO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gU0NFTkFSSU8gMzogQWxsIGRyb3BwZWQnKTtcbiAgICBjb25zb2xlLmxvZyhgICBJbnB1dDogJHtldmVudHMubGVuZ3RofSBldmVudHNgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuXG4gICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpbnRlZ3JpdHkgKGFsbG93IGVtcHR5IG91dHB1dClcbiAgICB2ZXJpZnlIaWVyYXJjaHlJbnRlZ3JpdHkocmVzdWx0LmV2ZW50cywgJ1NDRU5BUklPIDMnLCB7IGFsbG93RW1wdHlPdXRwdXQ6IHRydWUgfSk7XG5cbiAgICAvLyBFdmVyeXRoaW5nIHNob3VsZCBiZSBkcm9wcGVkXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMubGVuZ3RoKS50b0JlKDApO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuZHJvcHBlZCkudG9CZSgyKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmtlcHQpLnRvQmUoMCk7XG4gIH0pO1xuXG4gIGl0KCdTQ0VOQVJJTyA0OiBNdWx0aXBsZSBjaGlsZHJlbiwgc29tZSBrZXB0LCBzb21lIGRyb3BwZWQnLCAoKSA9PiB7XG4gICAgLy8gVHJlZTpcbiAgICAvLyAgIFJvb3QgKDQwMG1zLCBzaG91bGQgZHJvcClcbiAgICAvLyAgICAg4pSc4pSAIEZhc3RDaGlsZDEgKDUwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJzilIAgU2xvd1F1ZXJ5MSAoMTEwMG1zLCBNVVNUIEtFRVApXG4gICAgLy8gICAgIOKUnOKUgCBGYXN0Q2hpbGQyICg2MG1zLCBzaG91bGQgZHJvcClcbiAgICAvLyAgICAg4pSU4pSAIFNsb3dRdWVyeTIgKDEyMDBtcywgTVVTVCBLRUVQKVxuICAgIC8vXG4gICAgLy8gRXhwZWN0ZWQgb3V0cHV0OlxuICAgIC8vICAgUm9vdCAoZm9yY2Uta2VwdClcbiAgICAvLyAgICAg4pSc4pSAIFNsb3dRdWVyeTEgKGtlcHQpXG4gICAgLy8gICAgIOKUlOKUgCBTbG93UXVlcnkyIChrZXB0KVxuXG4gICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHVuZGVmaW5lZCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hcGknLFxuICAgICAgc291cmNlOiAnQ29udHJvbGxlcicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA0MDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBmYXN0Q2hpbGQxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXN0MScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0Zhc3RPcDEnLFxuICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBzbG93UXVlcnkxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93MScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ2R5bmFtb2RiLnF1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDExMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBmYXN0Q2hpbGQyOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXN0MicsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0Zhc3RPcDInLFxuICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNjAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBzbG93UXVlcnkyOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93MicsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ2R5bmFtb2RiLnNjYW4nLFxuICAgICAgc291cmNlOiAnZGF0YWJhc2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTIwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGV2ZW50cyA9IFsgcm9vdCwgZmFzdENoaWxkMSwgc2xvd1F1ZXJ5MSwgZmFzdENoaWxkMiwgc2xvd1F1ZXJ5MiBdO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gU0NFTkFSSU8gNDogTXVsdGlwbGUgY2hpbGRyZW4gKG1peGVkKScpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuICAgIGNvbnNvbGUubG9nKGAgIE91dHB1dDogJHtyZXN1bHQuZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG4gICAgcmVzdWx0LmV2ZW50cy5mb3JFYWNoKChlLCBpKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICAgIFske2l9XSAke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSAocGFyZW50OiAke2UucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHx8ICdST09UJ30pYCk7XG4gICAgfSk7XG5cbiAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGludGVncml0eVxuICAgIGNvbnN0IHsgZXZlbnRNYXAgfSA9IHZlcmlmeUhpZXJhcmNoeUludGVncml0eShyZXN1bHQuZXZlbnRzLCAnU0NFTkFSSU8gNCcpO1xuXG4gICAgLy8gU3BlY2lmaWMgYXNzZXJ0aW9uc1xuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgzKTsgLy8gUm9vdCArIDIgc2xvdyBxdWVyaWVzXG5cbiAgICBjb25zdCByb290SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Jvb3QnKTtcbiAgICBjb25zdCBzbG93MUluT3V0cHV0ID0gZXZlbnRNYXAuZ2V0KCdzbG93MScpO1xuICAgIGNvbnN0IHNsb3cySW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Nsb3cyJyk7XG5cbiAgICBleHBlY3Qocm9vdEluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzbG93MUluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzbG93MkluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgLy8gQm90aCBzbG93IHF1ZXJpZXMgbXVzdCBoYXZlIHJvb3QgYXMgcGFyZW50XG4gICAgZXhwZWN0KHNsb3cxSW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICAgIGV4cGVjdChzbG93MkluT3V0cHV0IS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3Jvb3QnKTtcbiAgfSk7XG5cbiAgaXQoJ1NDRU5BUklPIDU6IENvbXBsZXggdHJlZSB3aXRoIGVycm9ycyAoaGFyZCBzaWduYWxzKScsICgpID0+IHtcbiAgICAvLyBUcmVlOlxuICAgIC8vICAgUm9vdCAoNDAwbXMsIHNob3VsZCBkcm9wKVxuICAgIC8vICAgICDilJzilIAgQ2hpbGQxICgxMDBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgIOKUgiAgICDilJTilIAgRXJyb3IgKE1VU1QgS0VFUCAtIGVycm9yIGlzIGhhcmQgc2lnbmFsKVxuICAgIC8vICAgICDilJTilIAgQ2hpbGQyICgxNTBtcywgc2hvdWxkIGRyb3ApXG4gICAgLy8gICAgICAgICAg4pSU4pSAIFNsb3dRdWVyeSAoMTIwMG1zLCBNVVNUIEtFRVApXG4gICAgLy9cbiAgICAvLyBFeHBlY3RlZCBvdXRwdXQ6XG4gICAgLy8gICBSb290IChmb3JjZS1rZXB0KVxuICAgIC8vICAgICDilJzilIAgRXJyb3IgKHJlcGFyZW50ZWQgZnJvbSBDaGlsZDEpXG4gICAgLy8gICAgIOKUlOKUgCBTbG93UXVlcnkgKHJlcGFyZW50ZWQgZnJvbSBDaGlsZDIpXG5cbiAgICBjb25zdCByb290OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FwaScsXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkMTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQxJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnU2VydmljZS52YWxpZGF0ZScsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBlcnJvckV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkMScsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdlcnJvcicsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZXJyb3InLCAvLyBIQVJEIFNJR05BTFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkYXRhOiB7IG1lc3NhZ2U6ICdWYWxpZGF0aW9uIGZhaWxlZCcsIGVycm9yOiAnVmFsaWRhdGlvbkVycm9yJyB9LFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZDI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkMicsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ1NlcnZpY2UuZmV0Y2gnLFxuICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTUwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3Qgc2xvd1F1ZXJ5OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkMicsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdkeW5hbW9kYi5xdWVyeScsXG4gICAgICBzb3VyY2U6ICdkYXRhYmFzZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMjAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyByb290LCBjaGlsZDEsIGVycm9yRXZlbnQsIGNoaWxkMiwgc2xvd1F1ZXJ5IF07XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBTQ0VOQVJJTyA1OiBDb21wbGV4IHRyZWUgd2l0aCBlcnJvcnMnKTtcbiAgICBjb25zb2xlLmxvZyhgICBJbnB1dDogJHtldmVudHMubGVuZ3RofSBldmVudHNgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuICAgIHJlc3VsdC5ldmVudHMuZm9yRWFjaCgoZSwgaSkgPT4ge1xuICAgICAgY29uc29sZS5sb2coYCAgICBbJHtpfV0gJHtlLm9ic2VydmFiaWxpdHlMb2dJZH0gKHBhcmVudDogJHtlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB8fCAnUk9PVCd9KWApO1xuICAgIH0pO1xuXG4gICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCB7IGV2ZW50TWFwIH0gPSB2ZXJpZnlIaWVyYXJjaHlJbnRlZ3JpdHkocmVzdWx0LmV2ZW50cywgJ1NDRU5BUklPIDUnKTtcblxuICAgIC8vIFNwZWNpZmljIGFzc2VydGlvbnNcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmUoMyk7IC8vIFJvb3QgKyBFcnJvciArIFNsb3dRdWVyeVxuXG4gICAgY29uc3Qgcm9vdEluT3V0cHV0ID0gZXZlbnRNYXAuZ2V0KCdyb290Jyk7XG4gICAgY29uc3QgZXJyb3JJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgnZXJyb3InKTtcbiAgICBjb25zdCBzbG93SW5PdXRwdXQgPSBldmVudE1hcC5nZXQoJ3Nsb3cnKTtcblxuICAgIGV4cGVjdChyb290SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7IC8vIEtFUFQgKGhhcyBrZXB0IGNoaWxkcmVuKVxuICAgIGV4cGVjdChlcnJvckluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzbG93SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAvLyBCb3RoIGhhcmQgc2lnbmFscyBtdXN0IGJlIHJlcGFyZW50ZWQgdG8gUm9vdCAoY29udGV4dCBwcmVzZXJ2ZWQpXG4gICAgZXhwZWN0KGVycm9ySW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICAgIGV4cGVjdChzbG93SW5PdXRwdXQhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICB9KTtcblxuICBpdCgnRURHRSBDQVNFIDE6IEludmFsaWQgaW5wdXQgLSBjaGlsZCByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBwYXJlbnQnLCAoKSA9PiB7XG4gICAgLy8gVGhpcyBzaG91bGQgTk9UIGNyYXNoIC0gbm9pc2UgcmVkdWN0aW9uIHNob3VsZCBoYW5kbGUgZ3JhY2VmdWxseVxuICAgIGNvbnN0IG9ycGhhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnb3JwaGFuJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ25vbi1leGlzdGVudC1wYXJlbnQnLCAvLyBJTlZBTElEIVxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnT3JwaGFuT3BlcmF0aW9uJyxcbiAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGV2ZW50cyA9IFsgb3JwaGFuIF07XG5cbiAgICAvLyBTaG91bGQgbm90IGNyYXNoXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBFREdFIENBU0UgMTogSW52YWxpZCBwYXJlbnQgcmVmZXJlbmNlJyk7XG4gICAgY29uc29sZS5sb2coYCAgSW5wdXQ6ICR7ZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG4gICAgY29uc29sZS5sb2coYCAgT3V0cHV0OiAke3Jlc3VsdC5ldmVudHMubGVuZ3RofSBldmVudHNgKTtcblxuICAgIC8vIE9ycGhhbiBzaG91bGQgYmUga2VwdCAoaXQncyBzbG93KSBhbmQgUFJFU0VSVkUgaW52YWxpZCBwYXJlbnQgcmVmZXJlbmNlXG4gICAgLy8gKEhpZXJhcmNoeSBlbmZvcmNlbWVudCB3aWxsIGRldGVjdCBhbmQgaGFuZGxlIHRoaXMgbGF0ZXIgaW4gdGhlIGZsdXNoIGZsb3cpXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMubGVuZ3RoKS50b0JlKDEpO1xuICAgIGNvbnN0IG9ycGhhbkluT3V0cHV0ID0gcmVzdWx0LmV2ZW50c1sgMCBdO1xuICAgIGV4cGVjdChvcnBoYW5Jbk91dHB1dC5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ29ycGhhbicpO1xuXG4gICAgLy8gQkVIQVZJT1I6IEludmFsaWQgcGFyZW50IHJlZmVyZW5jZSBpcyBQUkVTRVJWRUQgKG5vdCBub3JtYWxpemVkKVxuICAgIC8vIFRoaXMgYWxsb3dzIGVuZm9yY2VIaWVyYXJjaHlJbnRlZ3JpdHlPckRyb3AoKSB0byBkZXRlY3QgYW5kIGhhbmRsZSBtaXNzaW5nIHBhcmVudHNcbiAgICAvLyBkdXJpbmcgdGhlIGZ1bGwgZmx1c2ggZmxvdywgcHJldmVudGluZyBkYW5nbGluZyByZWZlcmVuY2VzIGluIHRoZSBkYXRhYmFzZVxuICAgIGV4cGVjdChvcnBoYW5Jbk91dHB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ25vbi1leGlzdGVudC1wYXJlbnQnKTtcbiAgfSk7XG5cbiAgaXQoJ0VER0UgQ0FTRSAyOiBWZXJ5IGRlZXAgdHJlZSAoMTAgbGV2ZWxzKScsICgpID0+IHtcbiAgICAvLyBDcmVhdGUgYSAxMC1sZXZlbCBkZWVwIHRyZWVcbiAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHtcbiAgICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBsZXZlbC0ke2l9YCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpID09PSAwID8gdW5kZWZpbmVkIDogYGxldmVsLSR7aSAtIDF9YCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICBvcGVyYXRpb246IGBPcGVyYXRpb24ubGV2ZWwke2l9YCxcbiAgICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogMTAwLCAvLyBGYXN0IC0gc2hvdWxkIGRyb3BcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgICAgZGF0YToge30sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBBZGQgYSBzbG93IHF1ZXJ5IGF0IHRoZSBib3R0b21cbiAgICBldmVudHMucHVzaCh7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdkZWVwLXNsb3ctcXVlcnknLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbGV2ZWwtOScsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdkeW5hbW9kYi5xdWVyeScsXG4gICAgICBzb3VyY2U6ICdkYXRhYmFzZScsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMTAwLCAvLyBTbG93IC0gbXVzdCBrZWVwXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBFREdFIENBU0UgMjogVmVyeSBkZWVwIHRyZWUnKTtcbiAgICBjb25zb2xlLmxvZyhgICBJbnB1dDogJHtldmVudHMubGVuZ3RofSBldmVudHMgKDEwLWxldmVsIHRyZWUgKyBzbG93IHF1ZXJ5KWApO1xuICAgIGNvbnNvbGUubG9nKGAgIE91dHB1dDogJHtyZXN1bHQuZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG5cbiAgICAvLyBWZXJpZnkgaGllcmFyY2h5IGludGVncml0eVxuICAgIGNvbnN0IHsgZXZlbnRNYXAsIG1heERlcHRoIH0gPSB2ZXJpZnlIaWVyYXJjaHlJbnRlZ3JpdHkoXG4gICAgICByZXN1bHQuZXZlbnRzLFxuICAgICAgJ0VER0UgQ0FTRSAyJyxcbiAgICAgIHsgZXhwZWN0ZWRSb290czogMSB9XG4gICAgKTtcblxuICAgIC8vIEFsbCBpbnRlcm1lZGlhdGUgbGV2ZWxzIGRyb3BwZWQgKERFQlVHIDwgSU5GTyBtaW5MZXZlbClcbiAgICAvLyBPbmx5IHNsb3cgcXVlcnkgcmVtYWlucyAoaGFyZCBzaWduYWw6IGR1cmF0aW9uTXMgPiAxMDAwbXMpXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMubGVuZ3RoKS50b0JlKDEpO1xuXG4gICAgY29uc3QgcXVlcnlJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgnZGVlcC1zbG93LXF1ZXJ5Jyk7XG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAvLyBRdWVyeSBpcyBvcnBoYW5lZCAoYWxsIHBhcmVudHMgZHJvcHBlZCBiZWxvdyBtaW5MZXZlbClcbiAgICBleHBlY3QocXVlcnlJbk91dHB1dCEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICAvLyBNYXggZGVwdGggc2hvdWxkIGJlIDAgKHNpbmdsZSByb290LCBubyBoaWVyYXJjaHkpXG4gICAgZXhwZWN0KG1heERlcHRoKS50b0JlKDApO1xuICB9KTtcblxuICBpdCgnRURHRSBDQVNFIDM6IE1hbnkgc2libGluZ3MgKDUwIGNoaWxkcmVuIG9mIHNhbWUgcGFyZW50KScsICgpID0+IHtcbiAgICAvLyBSb290IHdpdGggNTAgY2hpbGRyZW4sIG9ubHkgMiBhcmUgc2xvd1xuICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYXBpJyxcbiAgICAgIHNvdXJjZTogJ0NvbnRyb2xsZXInLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNDAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRyZW46IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDUwOyBpKyspIHtcbiAgICAgIGNvbnN0IGlzU2xvdyA9IGkgPT09IDEwIHx8IGkgPT09IDMwOyAvLyBPbmx5IDIgYXJlIHNsb3dcbiAgICAgIGNoaWxkcmVuLnB1c2goe1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogYGNoaWxkLSR7aX1gLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICBvcGVyYXRpb246IGBPcGVyYXRpb24ke2l9YCxcbiAgICAgICAgc291cmNlOiAnU2VydmljZScsXG4gICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogaXNTbG93ID8gMTEwMCA6IDUwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgICBkYXRhOiB7fSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGV2ZW50cyA9IFsgcm9vdCwgLi4uY2hpbGRyZW4gXTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG7wn5SNIEVER0UgQ0FTRSAzOiBNYW55IHNpYmxpbmdzJyk7XG4gICAgY29uc29sZS5sb2coYCAgSW5wdXQ6ICR7ZXZlbnRzLmxlbmd0aH0gZXZlbnRzICgxIHJvb3QgKyA1MCBjaGlsZHJlbilgKTtcbiAgICBjb25zb2xlLmxvZyhgICBPdXRwdXQ6ICR7cmVzdWx0LmV2ZW50cy5sZW5ndGh9IGV2ZW50c2ApO1xuXG4gICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCB7IGV2ZW50TWFwIH0gPSB2ZXJpZnlIaWVyYXJjaHlJbnRlZ3JpdHkoXG4gICAgICByZXN1bHQuZXZlbnRzLFxuICAgICAgJ0VER0UgQ0FTRSAzJyxcbiAgICAgIHsgZXhwZWN0ZWRSb290czogMSB9XG4gICAgKTtcblxuICAgIC8vIFJvb3QgKyAyIHNsb3cgY2hpbGRyZW4gPSAzIGV2ZW50c1xuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgzKTtcblxuICAgIGNvbnN0IHJvb3RJbk91dHB1dCA9IGV2ZW50TWFwLmdldCgncm9vdCcpO1xuICAgIGNvbnN0IHNsb3cxID0gZXZlbnRNYXAuZ2V0KCdjaGlsZC0xMCcpO1xuICAgIGNvbnN0IHNsb3cyID0gZXZlbnRNYXAuZ2V0KCdjaGlsZC0zMCcpO1xuXG4gICAgZXhwZWN0KHJvb3RJbk91dHB1dCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qoc2xvdzEpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNsb3cyKS50b0JlRGVmaW5lZCgpO1xuXG4gICAgLy8gQm90aCBzbG93IGNoaWxkcmVuIHNob3VsZCBzdGlsbCBoYXZlIHJvb3QgYXMgcGFyZW50XG4gICAgZXhwZWN0KHNsb3cxIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3Jvb3QnKTtcbiAgICBleHBlY3Qoc2xvdzIhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuXG4gICAgLy8gRmFzdCBjaGlsZHJlbiB3aXRoIG5vIGtlcHQgZGVzY2VuZGFudHMgYXJlIERST1BQRUQgKG5vdCBmb2xkZWQpXG4gICAgLy8gT25seSBjaGlsZHJlbiBXSVRIIGtlcHQgZGVzY2VuZGFudHMgYXJlIHVwZ3JhZGVkIHRvIEZPTERcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmRyb3BwZWQpLnRvQmUoNDgpOyAvLyA0OCBmYXN0IGNoaWxkcmVuIGRyb3BwZWRcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmZvbGRlZCkudG9CZSgwKTsgLy8gTm9uZSBmb2xkZWQgKHRoZXkgaGF2ZSBubyBrZXB0IGRlc2NlbmRhbnRzKVxuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMua2VwdCkudG9CZSgzKTsgLy8gUm9vdCAoZm9yY2Uta2VwdCkgKyAyIHNsb3cgY2hpbGRyZW5cbiAgfSk7XG5cbiAgaXQoJ0VER0UgQ0FTRSA0OiBEdXBsaWNhdGUgSURzIGluIGlucHV0IChzaG91bGQgaGFuZGxlIGdyYWNlZnVsbHkpJywgKCkgPT4ge1xuICAgIC8vIENyZWF0ZSBldmVudHMgd2l0aCBkdXBsaWNhdGUgSURzXG4gICAgY29uc3QgZXZlbnQxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdkdXBsaWNhdGUnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdPcGVyYXRpb24xJyxcbiAgICAgIHNvdXJjZTogJ1NlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMTEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGV2ZW50MjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZHVwbGljYXRlJywgLy8gU0FNRSBJRCFcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnT3BlcmF0aW9uMicsXG4gICAgICBzb3VyY2U6ICdTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEyMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBldmVudHMgPSBbIGV2ZW50MSwgZXZlbnQyIF07XG5cbiAgICAvLyBTaG91bGQgbm90IGNyYXNoXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+UjSBFREdFIENBU0UgNDogRHVwbGljYXRlIElEcycpO1xuICAgIGNvbnNvbGUubG9nKGAgIElucHV0OiAke2V2ZW50cy5sZW5ndGh9IGV2ZW50cyAod2l0aCBkdXBsaWNhdGUgSURzKWApO1xuICAgIGNvbnNvbGUubG9nKGAgIE91dHB1dDogJHtyZXN1bHQuZXZlbnRzLmxlbmd0aH0gZXZlbnRzYCk7XG5cbiAgICAvLyBBdCBsZWFzdCBvbmUgc2hvdWxkIGJlIGtlcHQgKHRoZXkncmUgYm90aCBzbG93KVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuXG4gICAgLy8gSWYgZHVwbGljYXRlcyBtYWtlIGl0IHRvIG91dHB1dCwgaGllcmFyY2h5IGNoZWNrIHdpbGwgY2F0Y2ggaXRcbiAgICBleHBlY3QoKCkgPT4ge1xuICAgICAgdmVyaWZ5SGllcmFyY2h5SW50ZWdyaXR5KHJlc3VsdC5ldmVudHMsICdFREdFIENBU0UgNCcpO1xuICAgIH0pLm5vdC50b1Rocm93KCk7IC8vIFNob3VsZCBub3QgdGhyb3cgKGR1cGxpY2F0ZXMgc2hvdWxkIGJlIGhhbmRsZWQgZHVyaW5nIHRyZWUgYnVpbGRpbmcpXG4gIH0pO1xufSk7XG4iXX0=