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

import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import { ObservabilityEvent, ObservabilityLevel } from '../../types';

describe('Hierarchy Integrity After Noise Reduction', () => {

  // Use custom rules for predictable test behavior
  const config = createObservabilityConfig({
    enabled: true,
    minLevel: ObservabilityLevel.INFO,
    noiseReduction: {
      enabled: true,
      minLevel: ObservabilityLevel.INFO,
      hardSignals: {
        levels: [ 'error', 'critical' ],
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
  function verifyHierarchyIntegrity(
    events: ObservabilityEvent[],
    scenario: string,
    options: {
      expectedRoots?: number;
      allowEmptyOutput?: boolean;
    } = {}
  ) {
    const eventMap = new Map<string, ObservabilityEvent>();
    const roots: ObservabilityEvent[] = [];
    const children: ObservabilityEvent[] = [];

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
        throw new Error(
          `[${scenario}] DUPLICATE ID: Event ID "${event.observabilityLogId}" appears multiple times in output!`
        );
      }
      eventMap.set(event.observabilityLogId, event);

      if (event.parentObservabilityLogId) {
        children.push(event);
      } else {
        roots.push(event);
      }
    }

    // INVARIANT 1: Every child must have a parent that exists in output
    for (const child of children) {
      const parent = eventMap.get(child.parentObservabilityLogId!);

      if (!parent) {
        throw new Error(
          `[${scenario}] ORPHANED CHILD: Event "${child.observabilityLogId}" ` +
          `references parent "${child.parentObservabilityLogId}" which does NOT exist in output!\n` +
          `Child: ${JSON.stringify({ id: child.observabilityLogId, operation: child.operation })}\n` +
          `Available events: ${Array.from(eventMap.keys()).join(', ')}`
        );
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
      const visited = new Set<string>();

      while (current.parentObservabilityLogId) {
        if (visited.has(current.observabilityLogId)) {
          throw new Error(
            `[${scenario}] CYCLE DETECTED: Event "${current.observabilityLogId}" ` +
            `appears twice in parent chain!\n` +
            `Path: ${Array.from(visited).join(' → ')} → ${current.observabilityLogId}`
          );
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
          throw new Error(
            `[${scenario}] INFINITE LOOP: Depth ${depth} exceeded event count ${events.length} while walking to root`
          );
        }
      }
    }

    // INVARIANT 4: Tree depth should be reasonable (not pathological)
    const maxDepth = Math.max(...Array.from(eventMap.values()).map(e => {
      let depth = 0;
      let current = e;
      while (current.parentObservabilityLogId && eventMap.has(current.parentObservabilityLogId)) {
        depth++;
        current = eventMap.get(current.parentObservabilityLogId)!;
        if (depth > events.length) break; // Prevent infinite loop
      }
      return depth;
    }));

    // Warn if tree is suspiciously deep (more than half the event count)
    if (maxDepth > events.length / 2) {
      console.warn(
        `[${scenario}] WARNING: Tree is very deep (${maxDepth} levels with ${events.length} events). ` +
        `This might indicate a problem with reparenting.`
      );
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

    const root: ObservabilityEvent = {
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

    const child: ObservabilityEvent = {
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

    const slowQuery: ObservabilityEvent = {
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

    const events = [ root, child, slowQuery ];
    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 SCENARIO 1: Fast root with slow query');
    console.log(`  Input: ${events.length} events (root → child → slowQuery)`);
    console.log(`  Output: ${result.events.length} events`);
    result.events.forEach((e, i) => {
      console.log(`    [${i}] ${e.observabilityLogId} (parent: ${e.parentObservabilityLogId || 'ROOT'})`);
    });

    // Verify hierarchy integrity
    const { eventMap } = verifyHierarchyIntegrity(
      result.events,
      'SCENARIO 1'
    );

    // Specific assertions
    expect(result.events.length).toBe(2); // Root (context) + SlowQuery (hard signal)

    const rootInOutput = eventMap.get('root-123');
    const queryInOutput = result.events.find(e => e.observabilityLogId === 'query-789');
    const childInOutput = eventMap.get('child-456');

    expect(rootInOutput).toBeDefined(); // KEPT (context for hard signal, INFO >= minLevel)
    expect(queryInOutput).toBeDefined(); // KEPT (hard signal: >1000ms)
    expect(childInOutput).toBeUndefined(); // DROPPED (DEBUG < INFO minLevel)

    // SlowQuery must be reparented to Root (Child was dropped)
    expect(queryInOutput!.parentObservabilityLogId).toBe('root-123');

    // SlowQuery must have reparenting checkpoint
    const queryData = queryInOutput!.data as any;
    const queryCheckpoints = queryData?.checkpoints;
    expect(Array.isArray(queryCheckpoints)).toBe(true);
    const reparentCheckpoint = queryCheckpoints?.find((c: any) =>
      c.name === 'noiseReduction.reparented'
    );
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

    const root: ObservabilityEvent = {
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

    const level1: ObservabilityEvent = {
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

    const level2: ObservabilityEvent = {
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

    const slowQuery: ObservabilityEvent = {
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

    const events = [ root, level1, level2, slowQuery ];
    const result = applyNoiseReduction(events, config.noiseReduction);

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
    expect(queryInOutput!.parentObservabilityLogId).toBe('root');
  });

  it('SCENARIO 3: All dropped - no hierarchy violations', () => {
    // Tree:
    //   Root (300ms, should drop)
    //     └─ Child (100ms, should drop)
    //
    // Expected output: Empty (all dropped)

    const root: ObservabilityEvent = {
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

    const child: ObservabilityEvent = {
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

    const events = [ root, child ];
    const result = applyNoiseReduction(events, config.noiseReduction);

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

    const root: ObservabilityEvent = {
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

    const fastChild1: ObservabilityEvent = {
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

    const slowQuery1: ObservabilityEvent = {
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

    const fastChild2: ObservabilityEvent = {
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

    const slowQuery2: ObservabilityEvent = {
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

    const events = [ root, fastChild1, slowQuery1, fastChild2, slowQuery2 ];
    const result = applyNoiseReduction(events, config.noiseReduction);

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
    expect(slow1InOutput!.parentObservabilityLogId).toBe('root');
    expect(slow2InOutput!.parentObservabilityLogId).toBe('root');
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

    const root: ObservabilityEvent = {
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

    const child1: ObservabilityEvent = {
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

    const errorEvent: ObservabilityEvent = {
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

    const child2: ObservabilityEvent = {
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

    const slowQuery: ObservabilityEvent = {
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

    const events = [ root, child1, errorEvent, child2, slowQuery ];
    const result = applyNoiseReduction(events, config.noiseReduction);

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
    expect(errorInOutput!.parentObservabilityLogId).toBe('root');
    expect(slowInOutput!.parentObservabilityLogId).toBe('root');
  });

  it('EDGE CASE 1: Invalid input - child references non-existent parent', () => {
    // This should NOT crash - noise reduction should handle gracefully
    const orphan: ObservabilityEvent = {
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

    const events = [ orphan ];

    // Should not crash
    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 EDGE CASE 1: Invalid parent reference');
    console.log(`  Input: ${events.length} events`);
    console.log(`  Output: ${result.events.length} events`);

    // Orphan should be kept (it's slow) and PRESERVE invalid parent reference
    // (Hierarchy enforcement will detect and handle this later in the flush flow)
    expect(result.events.length).toBe(1);
    const orphanInOutput = result.events[ 0 ];
    expect(orphanInOutput.observabilityLogId).toBe('orphan');

    // BEHAVIOR: Invalid parent reference is PRESERVED (not normalized)
    // This allows enforceHierarchyIntegrityOrDrop() to detect and handle missing parents
    // during the full flush flow, preventing dangling references in the database
    expect(orphanInOutput.parentObservabilityLogId).toBe('non-existent-parent');
  });

  it('EDGE CASE 2: Very deep tree (10 levels)', () => {
    // Create a 10-level deep tree
    const events: ObservabilityEvent[] = [];

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

    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 EDGE CASE 2: Very deep tree');
    console.log(`  Input: ${events.length} events (10-level tree + slow query)`);
    console.log(`  Output: ${result.events.length} events`);

    // Verify hierarchy integrity
    const { eventMap, maxDepth } = verifyHierarchyIntegrity(
      result.events,
      'EDGE CASE 2',
      { expectedRoots: 1 }
    );

    // All intermediate levels dropped (DEBUG < INFO minLevel)
    // Only slow query remains (hard signal: durationMs > 1000ms)
    expect(result.events.length).toBe(1);

    const queryInOutput = eventMap.get('deep-slow-query');
    expect(queryInOutput).toBeDefined();

    // Query is orphaned (all parents dropped below minLevel)
    expect(queryInOutput!.parentObservabilityLogId).toBeUndefined();

    // Max depth should be 0 (single root, no hierarchy)
    expect(maxDepth).toBe(0);
  });

  it('EDGE CASE 3: Many siblings (50 children of same parent)', () => {
    // Root with 50 children, only 2 are slow
    const root: ObservabilityEvent = {
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

    const children: ObservabilityEvent[] = [];

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

    const events = [ root, ...children ];
    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 EDGE CASE 3: Many siblings');
    console.log(`  Input: ${events.length} events (1 root + 50 children)`);
    console.log(`  Output: ${result.events.length} events`);

    // Verify hierarchy integrity
    const { eventMap } = verifyHierarchyIntegrity(
      result.events,
      'EDGE CASE 3',
      { expectedRoots: 1 }
    );

    // Root + 2 slow children = 3 events
    expect(result.events.length).toBe(3);

    const rootInOutput = eventMap.get('root');
    const slow1 = eventMap.get('child-10');
    const slow2 = eventMap.get('child-30');

    expect(rootInOutput).toBeDefined();
    expect(slow1).toBeDefined();
    expect(slow2).toBeDefined();

    // Both slow children should still have root as parent
    expect(slow1!.parentObservabilityLogId).toBe('root');
    expect(slow2!.parentObservabilityLogId).toBe('root');

    // Fast children with no kept descendants are DROPPED (not folded)
    // Only children WITH kept descendants are upgraded to FOLD
    expect(result.stats.dropped).toBe(48); // 48 fast children dropped
    expect(result.stats.folded).toBe(0); // None folded (they have no kept descendants)
    expect(result.stats.kept).toBe(3); // Root (force-kept) + 2 slow children
  });

  it('EDGE CASE 4: Duplicate IDs in input (should handle gracefully)', () => {
    // Create events with duplicate IDs
    const event1: ObservabilityEvent = {
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

    const event2: ObservabilityEvent = {
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

    const events = [ event1, event2 ];

    // Should not crash
    const result = applyNoiseReduction(events, config.noiseReduction);

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
