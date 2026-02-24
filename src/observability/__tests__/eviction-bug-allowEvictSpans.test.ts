/**
 * Test to prove Bug #5: allowEvictSpans=false violated by subtree removal
 *
 * HYPOTHESIS:
 * When allowEvictSpans=false, evictLowestPriority() should NEVER evict spans.
 * However, if a non-span event with span children is selected for eviction,
 * the subtree removal logic evicts those span children anyway, violating the contract.
 *
 * EXPECTED BEHAVIOR:
 * - When allowEvictSpans=false, NO spans should be removed from buffer
 * - If a non-span has span children, it should not be selected for eviction
 * - OR the eviction should abort when it detects span children
 *
 * ACTUAL BEHAVIOR (BUG):
 * - Non-span parent is selected for eviction
 * - Subtree removal (BFS) includes span children
 * - Spans are evicted despite allowEvictSpans=false
 */

import { ObservabilityManager, __test__ } from '../manager';
import type { ObservabilityEvent } from '../types';
import { ObservabilityLevel } from '../types';
import { createObservabilityConfig } from '../config';

// Extract private functions for testing
const { evictLowestPriority } = __test__;

describe('Bug #5 FIX: evictLowestPriority respects allowEvictSpans=false', () => {
  beforeEach(() => {
    ObservabilityManager.reset();
  });

  afterEach(() => {
    ObservabilityManager.reset();
  });

  /**
   * Core test proving the bug exists.
   *
   * Setup:
   * - Create a log event (non-span) as root
   * - Create 2 span events as children of the log
   * - All events in buffer
   * - Call evictLowestPriority with allowEvictSpans=false
   *
   * Expected: Only the log should be considered for eviction, but since it has span children,
   *           eviction should either abort OR skip this candidate
   *
   * Actual (BUG): Log is evicted along with its span children, violating allowEvictSpans=false
   */
  test('FIX VERIFIED: spans protected when non-span parent has span children and allowEvictSpans=false', () => {
    // ════════════════════════════════════════════════════════════════════════
    // SETUP: Create buffer with log parent and span children
    // ════════════════════════════════════════════════════════════════════════

    const buffer: ObservabilityEvent[] = [];

    // Create log event (non-span) with LOWEST priority to ensure it's selected
    const logEvent: ObservabilityEvent = {
      type: 'log',
      level: 'debug', // Low level = lower priority
      observabilityLogId: 'LOG-001',
      correlationId: 'test-correlation',
      timestampMs: Date.now(),
      operation: 'test-log-operation',
      parentObservabilityLogId: undefined,
      capture: {
        priority: -1000, // VERY LOW priority to guarantee selection
      },
    };

    // Create span1 as child of log
    const span1Event: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      observabilityLogId: 'SPAN-001',
      correlationId: 'test-correlation',
      timestampMs: Date.now(),
      operation: 'test-span-1',
      parentObservabilityLogId: 'LOG-001', // Child of log!
      durationMs: 100,
      capture: {
        priority: 50, // Higher priority
      },
    };

    // Create span2 as child of log
    const span2Event: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      observabilityLogId: 'SPAN-002',
      correlationId: 'test-correlation',
      timestampMs: Date.now(),
      operation: 'test-span-2',
      parentObservabilityLogId: 'LOG-001', // Child of log!
      durationMs: 200,
      capture: {
        priority: 100, // Even higher priority
      },
    };

    buffer.push(logEvent);
    buffer.push(span1Event);
    buffer.push(span2Event);

    // ════════════════════════════════════════════════════════════════════════
    // ASSERTIONS: Pre-eviction state
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n=== PRE-EVICTION STATE ===');
    console.log('Buffer length:', buffer.length);
    console.log('Buffer contents:');
    buffer.forEach((e, idx) => {
      console.log(`  [${idx}] ${e.type} id=${e.observabilityLogId} parent=${e.parentObservabilityLogId || 'null'} priority=${e.capture?.priority || 0}`);
    });

    expect(buffer.length).toBe(3);
    expect(buffer[ 0 ].type).toBe('log');
    expect(buffer[ 0 ].observabilityLogId).toBe('LOG-001');
    expect(buffer[ 1 ].type).toBe('span');
    expect(buffer[ 1 ].parentObservabilityLogId).toBe('LOG-001');
    expect(buffer[ 2 ].type).toBe('span');
    expect(buffer[ 2 ].parentObservabilityLogId).toBe('LOG-001');

    // Verify hierarchy structure
    const spansWithLogParent = buffer.filter(
      e => e.type === 'span' && e.parentObservabilityLogId === 'LOG-001'
    );
    expect(spansWithLogParent.length).toBe(2);
    expect(spansWithLogParent[ 0 ].observabilityLogId).toBe('SPAN-001');
    expect(spansWithLogParent[ 1 ].observabilityLogId).toBe('SPAN-002');

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: Call evictLowestPriority with allowEvictSpans=false
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n=== CALLING evictLowestPriority(buffer, { allowEvictSpans: false }) ===');

    const evictionResult = evictLowestPriority(buffer, { allowEvictSpans: false });

    // ════════════════════════════════════════════════════════════════════════
    // ASSERTIONS: Post-eviction state - PROVING THE BUG
    // ════════════════════════════════════════════════════════════════════════

    console.log('\n=== EVICTION RESULT ===');
    console.log('Eviction metadata:', evictionResult);
    console.log('Removed count:', evictionResult?.removedCount || 0);

    console.log('\n=== POST-EVICTION STATE ===');
    console.log('Buffer length:', buffer.length);
    console.log('Buffer contents:');
    buffer.forEach((e, idx) => {
      console.log(`  [${idx}] ${e.type} id=${e.observabilityLogId} parent=${e.parentObservabilityLogId || 'null'}`);
    });

    // Count events by type
    const remainingLogs = buffer.filter(e => e.type === 'log');
    const remainingSpans = buffer.filter(e => e.type === 'span' || e.type === 'span.start');

    console.log('\nRemaining logs:', remainingLogs.length);
    console.log('Remaining spans:', remainingSpans.length);

    // Check which specific events remain
    const remainingIds = buffer.map(e => e.observabilityLogId);
    console.log('Remaining IDs:', remainingIds);

    // ══════════════════════════════════════════════════════════════════════
    // CRITICAL ASSERTIONS - VERIFYING THE FIX
    // ══════════════════════════════════════════════════════════════════════

    console.log('\n=== CRITICAL ASSERTION (VERIFYING FIX) ===');

    // AFTER FIX: evictionResult should be NULL because the log has span children
    // and allowEvictSpans=false prevents evicting those children via subtree removal
    if (evictionResult === null) {
      console.log('✅ FIX VERIFIED: evictLowestPriority returned null (correctly rejected eviction)');
      console.log('Reason: LOG-001 has span children, cannot evict without violating allowEvictSpans=false');

      // ASSERTION 1: Eviction was rejected (returns null)
      expect(evictionResult).toBeNull();

      // ASSERTION 2: Buffer unchanged (no events evicted)
      expect(buffer.length).toBe(3);

      // ASSERTION 3: All spans remain in buffer
      expect(remainingSpans.length).toBe(2);
      expect(remainingIds).toContain('SPAN-001');
      expect(remainingIds).toContain('SPAN-002');

      // ASSERTION 4: Log also remains (since eviction was rejected)
      expect(remainingIds).toContain('LOG-001');

      console.log('✅ All assertions passed - allowEvictSpans=false is now respected!');
    } else {
      // BUG STILL EXISTS
      console.log('❌ BUG STILL EXISTS: Eviction occurred');
      console.log('Expected: null (rejected)');
      console.log('Actual:', evictionResult);
      console.log('Removed count:', evictionResult.removedCount);
      console.log('Remaining spans:', remainingSpans.length);

      // These would indicate the bug still exists
      expect(evictionResult).toBeNull(); // This will fail if bug still exists
    }
  });

  /**
   * Control test: Verify eviction works correctly when allowEvictSpans=true
   * This proves the issue is specific to allowEvictSpans=false
   */
  test('CONTROL: spans ARE evicted when allowEvictSpans=true (expected behavior)', () => {
    const buffer: ObservabilityEvent[] = [];

    const logEvent: ObservabilityEvent = {
      type: 'log',
      level: 'debug',
      observabilityLogId: 'LOG-001',
      correlationId: 'test-correlation',
      timestampMs: Date.now(),
      operation: 'test-log-operation',
      capture: { priority: -1000 },
    };

    const spanEvent: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      observabilityLogId: 'SPAN-001',
      correlationId: 'test-correlation',
      timestampMs: Date.now(),
      operation: 'test-span',
      parentObservabilityLogId: 'LOG-001',
      durationMs: 100,
      capture: { priority: 50 },
    };

    buffer.push(logEvent);
    buffer.push(spanEvent);

    expect(buffer.length).toBe(2);

    const result = evictLowestPriority(buffer, { allowEvictSpans: true });

    console.log('\n=== CONTROL TEST: allowEvictSpans=true ===');
    console.log('Eviction result:', result);
    console.log('Buffer after eviction:', buffer.length);

    // With allowEvictSpans=true, the span (leaf) will be evicted first
    // The function prefers evicting leaves to avoid unnecessary subtree removal
    expect(result).not.toBeNull();
    expect(result!.type).toBe('span'); // Span was evicted (it's a leaf)
    expect(buffer.length).toBe(1); // Only span removed, log remains
    expect(result!.removedCount).toBe(1);
  });

  /**
   * Edge case test: Verify behavior with deep hierarchy
   * Log -> Span -> Span -> Log
   */
  test('EDGE CASE: deep hierarchy with mixed types', () => {
    const buffer: ObservabilityEvent[] = [];

    // Root log (lowest priority)
    buffer.push({
      type: 'log',
      level: 'debug',
      observabilityLogId: 'LOG-ROOT',
      correlationId: 'test',
      timestampMs: Date.now(),
      capture: { priority: -1000 },
    });

    // Child span
    buffer.push({
      type: 'span',
      level: 'info',
      observabilityLogId: 'SPAN-L1',
      correlationId: 'test',
      timestampMs: Date.now(),
      parentObservabilityLogId: 'LOG-ROOT',
      durationMs: 100,
      capture: { priority: 50 },
    });

    // Grandchild span
    buffer.push({
      type: 'span',
      level: 'info',
      observabilityLogId: 'SPAN-L2',
      correlationId: 'test',
      timestampMs: Date.now(),
      parentObservabilityLogId: 'SPAN-L1',
      durationMs: 50,
      capture: { priority: 100 },
    });

    // Great-grandchild log
    buffer.push({
      type: 'log',
      level: 'info',
      observabilityLogId: 'LOG-L3',
      correlationId: 'test',
      timestampMs: Date.now(),
      parentObservabilityLogId: 'SPAN-L2',
      capture: { priority: 150 },
    });

    expect(buffer.length).toBe(4);

    console.log('\n=== EDGE CASE: Deep hierarchy ===');
    console.log('Pre-eviction buffer length:', buffer.length);

    const result = evictLowestPriority(buffer, { allowEvictSpans: false });

    console.log('Post-eviction buffer length:', buffer.length);
    console.log('Removed count:', result?.removedCount);
    console.log('Remaining IDs:', buffer.map(e => e.observabilityLogId));

    // With allowEvictSpans=false and LOG-ROOT as lowest priority parent,
    // the ENTIRE subtree including spans should NOT be evicted
    // OR only LOG-ROOT should be rejected for eviction

    const remainingSpans = buffer.filter(e => e.type === 'span');
    console.log('Remaining spans count:', remainingSpans.length);

    // BUG: If any spans were evicted, this fails
    expect(remainingSpans.length).toBe(2); // SPAN-L1 and SPAN-L2 should remain
  });

  /**
   * Test via public API: Trigger eviction through buffer overflow
   * This tests the real-world scenario where the bug manifests
   */
  test('PUBLIC API: spans protected during buffer overflow with smart sampling', async () => {
    // Initialize with smart sampling enabled and small buffer
    const config = createObservabilityConfig({
      enabled: true,
      serviceName: 'test-service',
      backends: [ { type: 'cloudwatch', enabled: true } ],
      sampling: {
        enabled: false, // Disable head-based sampling
        smart: true,    // Enable tail-based (buffering)
        maxBufferSize: 5, // Small buffer to trigger eviction
      },
      noiseReduction: {
        enabled: false, // Disable to isolate the bug
      },
      spans: {
        minDurationMs: 0, // Capture all spans
        skipEmpty: false, // Don't skip empty spans
      },
    });

    // Mock backend to capture events
    const capturedEvents: ObservabilityEvent[] = [];
    const mockBackend = {
      name: 'cloudwatch', // Name must match backend type for routing
      capture: async (event: ObservabilityEvent) => {
        console.log('Mock backend capturing:', event.type, event.observabilityLogId);
        capturedEvents.push(event);
      },
      flush: async () => { },
      initializeInvocation: () => { },
    };

    ObservabilityManager.initializeForTesting(config, [ mockBackend ]);

    // Create execution context
    const { runWithExecutionContext, createExecutionContext, getCurrentExecutionContext } = require('../../core/runtime/execution-context');
    const ctx = createExecutionContext({ correlationId: 'test-overflow' });

    await runWithExecutionContext(ctx, async () => {
      // Capture events to fill buffer beyond capacity
      // First, create a SPAN parent with lowest priority
      const parentSpanResult = ObservabilityManager.capture({
        type: 'span',
        level: 'debug',
        correlationId: 'test-overflow',
        observabilityLogId: 'SPAN-PARENT',
        operation: 'low-priority-span',
        durationMs: 50,
        capture: { priority: -1000 },
      });
      console.log('SPAN-PARENT capture result:', parentSpanResult);

      // Create log child (lower priority, should be evicted)
      const logChildResult = ObservabilityManager.capture({
        type: 'log',
        level: 'debug',
        correlationId: 'test-overflow',
        observabilityLogId: 'LOG-CHILD',
        parentObservabilityLogId: 'SPAN-PARENT',
        operation: 'log-under-span',
        capture: { priority: -500 },
      });
      console.log('LOG-CHILD capture result:', logChildResult);

      // Create span children (higher priority, should be preserved)
      const span1Result = ObservabilityManager.capture({
        type: 'span',
        level: 'info',
        correlationId: 'test-overflow',
        observabilityLogId: 'SPAN-CHILD-1',
        parentObservabilityLogId: 'SPAN-PARENT',
        operation: 'child-span-1',
        durationMs: 100,
        capture: { priority: 50 },
      });
      console.log('SPAN-CHILD-1 capture result:', span1Result);

      const span2Result = ObservabilityManager.capture({
        type: 'span',
        level: 'info',
        correlationId: 'test-overflow',
        observabilityLogId: 'SPAN-CHILD-2',
        parentObservabilityLogId: 'SPAN-PARENT',
        operation: 'child-span-2',
        durationMs: 200,
        capture: { priority: 100 },
      });
      console.log('SPAN-CHILD-2 capture result:', span2Result);

      // Check buffer state before adding filler logs
      const ctxBefore = getCurrentExecutionContext();
      console.log('Buffer before filler logs:', ctxBefore?.observability.buffer.length);
      console.log('Buffer events:', ctxBefore?.observability.buffer.map((e: any) => `${e.type}:${e.observabilityLogId}`));

      // Add more events to trigger eviction (buffer size = 5)
      for (let i = 0; i < 5; i++) {
        ObservabilityManager.capture({
          type: 'log',
          level: 'info',
          correlationId: 'test-overflow',
          operation: `filler-log-${i}`,
          capture: { priority: 200 + i },
        });
      }

      // Check buffer state after adding filler logs
      const ctxAfter = getCurrentExecutionContext();
      console.log('Buffer after filler logs:', ctxAfter?.observability.buffer.length);
      console.log('Buffer events:', ctxAfter?.observability.buffer.map((e: any) => `${e.type}:${e.observabilityLogId}`));

      // At this point, buffer is full and eviction should have occurred
      // Check buffer state via summary
      const summary = ObservabilityManager.getSummary();
      console.log('\n=== PUBLIC API TEST: Buffer state ===');
      console.log('Summary:', summary);

      expect(summary).toBeDefined();
      expect(summary!.buffered).toBeGreaterThan(0);

      if (summary!.evicted > 0) {
        console.log('Eviction occurred! Evicted count:', summary!.evicted);

        // Check buffer before flush
        const ctxPreFlush = getCurrentExecutionContext();
        console.log('Buffer before flush:', ctxPreFlush?.observability.buffer.length);
        console.log('Buffer events before flush:', ctxPreFlush?.observability.buffer.map((e: any) => `${e.type}:${e.observabilityLogId}`));

        // Now flush and check what was captured
        await ObservabilityManager.flush();

        console.log('Captured events count:', capturedEvents.length);
        console.log('Captured event IDs:', capturedEvents.map(e => e.observabilityLogId));

        const capturedSpans = capturedEvents.filter(e => e.type === 'span');
        const capturedLogs = capturedEvents.filter(e => e.type === 'log');

        console.log('Captured spans:', capturedSpans.length);
        console.log('Captured logs:', capturedLogs.length);

        // AFTER FIX: SPAN-PARENT with span children should NOT be evicted when allowEvictSpans=false
        // Other filler logs and LOG-CHILD should be evicted instead
        // Parent span and child spans should remain in buffer and be captured at flush
        const hasSpanChild1 = capturedEvents.some(e => e.observabilityLogId === 'SPAN-CHILD-1');
        const hasSpanChild2 = capturedEvents.some(e => e.observabilityLogId === 'SPAN-CHILD-2');
        const hasSpanParent = capturedEvents.some(e => e.observabilityLogId === 'SPAN-PARENT');
        const hasLogChild = capturedEvents.some(e => e.observabilityLogId === 'LOG-CHILD');

        if (hasSpanChild1 && hasSpanChild2 && hasSpanParent) {
          console.log('✅ FIX VERIFIED: Span hierarchy preserved despite buffer overflow!');
          console.log('SPAN-PARENT captured:', hasSpanParent);
          console.log('SPAN-CHILD-1 captured:', hasSpanChild1);
          console.log('SPAN-CHILD-2 captured:', hasSpanChild2);
          console.log('LOG-CHILD captured:', hasLogChild, '(expected: false - lower priority)');
        } else {
          console.log('❌ FIX INCOMPLETE: Spans were still evicted');
          console.log('SPAN-PARENT captured:', hasSpanParent);
          console.log('SPAN-CHILD-1 captured:', hasSpanChild1);
          console.log('SPAN-CHILD-2 captured:', hasSpanChild2);
        }

        // These assertions verify the fix works
        expect(hasSpanChild1).toBe(true);
        expect(hasSpanChild2).toBe(true);
        // Parent span should also be captured (it wasn't evictable due to span children)
        expect(hasSpanParent).toBe(true);
      }
    });
  });
});
