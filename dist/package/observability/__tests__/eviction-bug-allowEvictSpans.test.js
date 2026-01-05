"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const manager_1 = require("../manager");
const config_1 = require("../config");
// Extract private functions for testing
const { evictLowestPriority } = manager_1.__test__;
describe('Bug #5 FIX: evictLowestPriority respects allowEvictSpans=false', () => {
    beforeEach(() => {
        manager_1.ObservabilityManager.reset();
    });
    afterEach(() => {
        manager_1.ObservabilityManager.reset();
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
        const buffer = [];
        // Create log event (non-span) with LOWEST priority to ensure it's selected
        const logEvent = {
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
        const span1Event = {
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
        const span2Event = {
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
        expect(buffer[0].type).toBe('log');
        expect(buffer[0].observabilityLogId).toBe('LOG-001');
        expect(buffer[1].type).toBe('span');
        expect(buffer[1].parentObservabilityLogId).toBe('LOG-001');
        expect(buffer[2].type).toBe('span');
        expect(buffer[2].parentObservabilityLogId).toBe('LOG-001');
        // Verify hierarchy structure
        const spansWithLogParent = buffer.filter(e => e.type === 'span' && e.parentObservabilityLogId === 'LOG-001');
        expect(spansWithLogParent.length).toBe(2);
        expect(spansWithLogParent[0].observabilityLogId).toBe('SPAN-001');
        expect(spansWithLogParent[1].observabilityLogId).toBe('SPAN-002');
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
        }
        else {
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
        const buffer = [];
        const logEvent = {
            type: 'log',
            level: 'debug',
            observabilityLogId: 'LOG-001',
            correlationId: 'test-correlation',
            timestampMs: Date.now(),
            operation: 'test-log-operation',
            capture: { priority: -1000 },
        };
        const spanEvent = {
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
        expect(result.type).toBe('span'); // Span was evicted (it's a leaf)
        expect(buffer.length).toBe(1); // Only span removed, log remains
        expect(result.removedCount).toBe(1);
    });
    /**
     * Edge case test: Verify behavior with deep hierarchy
     * Log -> Span -> Span -> Log
     */
    test('EDGE CASE: deep hierarchy with mixed types', () => {
        const buffer = [];
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
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            serviceName: 'test-service',
            backends: [{ type: 'cloudwatch', enabled: true }],
            sampling: {
                enabled: false, // Disable head-based sampling
                smart: true, // Enable tail-based (buffering)
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
        const capturedEvents = [];
        const mockBackend = {
            name: 'cloudwatch', // Name must match backend type for routing
            capture: async (event) => {
                console.log('Mock backend capturing:', event.type, event.observabilityLogId);
                capturedEvents.push(event);
            },
            flush: async () => { },
            initializeInvocation: () => { },
        };
        manager_1.ObservabilityManager.initializeForTesting(config, [mockBackend]);
        // Create execution context
        const { runWithExecutionContext, createExecutionContext, getCurrentExecutionContext } = require('../../core/runtime/execution-context');
        const ctx = createExecutionContext({ correlationId: 'test-overflow' });
        await runWithExecutionContext(ctx, async () => {
            // Capture events to fill buffer beyond capacity
            // First, create a SPAN parent with lowest priority
            const parentSpanResult = manager_1.ObservabilityManager.capture({
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
            const logChildResult = manager_1.ObservabilityManager.capture({
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
            const span1Result = manager_1.ObservabilityManager.capture({
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
            const span2Result = manager_1.ObservabilityManager.capture({
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
            console.log('Buffer events:', ctxBefore?.observability.buffer.map((e) => `${e.type}:${e.observabilityLogId}`));
            // Add more events to trigger eviction (buffer size = 5)
            for (let i = 0; i < 5; i++) {
                manager_1.ObservabilityManager.capture({
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
            console.log('Buffer events:', ctxAfter?.observability.buffer.map((e) => `${e.type}:${e.observabilityLogId}`));
            // At this point, buffer is full and eviction should have occurred
            // Check buffer state via summary
            const summary = manager_1.ObservabilityManager.getSummary();
            console.log('\n=== PUBLIC API TEST: Buffer state ===');
            console.log('Summary:', summary);
            expect(summary).toBeDefined();
            expect(summary.buffered).toBeGreaterThan(0);
            if (summary.evicted > 0) {
                console.log('Eviction occurred! Evicted count:', summary.evicted);
                // Check buffer before flush
                const ctxPreFlush = getCurrentExecutionContext();
                console.log('Buffer before flush:', ctxPreFlush?.observability.buffer.length);
                console.log('Buffer events before flush:', ctxPreFlush?.observability.buffer.map((e) => `${e.type}:${e.observabilityLogId}`));
                // Now flush and check what was captured
                await manager_1.ObservabilityManager.flush();
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
                }
                else {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZpY3Rpb24tYnVnLWFsbG93RXZpY3RTcGFucy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvX190ZXN0c19fL2V2aWN0aW9uLWJ1Zy1hbGxvd0V2aWN0U3BhbnMudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHOztBQUVILHdDQUE0RDtBQUc1RCxzQ0FBc0Q7QUFFdEQsd0NBQXdDO0FBQ3hDLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxHQUFHLGtCQUFRLENBQUM7QUFFekMsUUFBUSxDQUFDLGdFQUFnRSxFQUFFLEdBQUcsRUFBRTtJQUM5RSxVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDL0IsQ0FBQyxDQUFDLENBQUM7SUFFSDs7Ozs7Ozs7Ozs7OztPQWFHO0lBQ0gsSUFBSSxDQUFDLGdHQUFnRyxFQUFFLEdBQUcsRUFBRTtRQUMxRywyRUFBMkU7UUFDM0UseURBQXlEO1FBQ3pELDJFQUEyRTtRQUUzRSxNQUFNLE1BQU0sR0FBeUIsRUFBRSxDQUFDO1FBRXhDLDJFQUEyRTtRQUMzRSxNQUFNLFFBQVEsR0FBdUI7WUFDbkMsSUFBSSxFQUFFLEtBQUs7WUFDWCxLQUFLLEVBQUUsT0FBTyxFQUFFLDZCQUE2QjtZQUM3QyxrQkFBa0IsRUFBRSxTQUFTO1lBQzdCLGFBQWEsRUFBRSxrQkFBa0I7WUFDakMsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDdkIsU0FBUyxFQUFFLG9CQUFvQjtZQUMvQix3QkFBd0IsRUFBRSxTQUFTO1lBQ25DLE9BQU8sRUFBRTtnQkFDUCxRQUFRLEVBQUUsQ0FBQyxJQUFJLEVBQUUsMkNBQTJDO2FBQzdE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QUMsdUJBQXVCLEVBQUUsYUFBYSxDQUFDLENBQUM7b0JBQ3BELE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsYUFBYSxDQUFDLENBQUM7b0JBQ3JELE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsYUFBYSxDQUFDLENBQUM7b0JBQ3JELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLEVBQUUsV0FBVyxFQUFFLG9DQUFvQyxDQUFDLENBQUM7Z0JBQ3hGLENBQUM7cUJBQU0sQ0FBQztvQkFDTixPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7b0JBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLEVBQUUsYUFBYSxDQUFDLENBQUM7b0JBQ3BELE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsYUFBYSxDQUFDLENBQUM7b0JBQ3JELE9BQU8sQ0FBQyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsYUFBYSxDQUFDLENBQUM7Z0JBQ3ZELENBQUM7Z0JBRUQsd0NBQXdDO2dCQUN4QyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNqQyxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNqQyxpRkFBaUY7Z0JBQ2pGLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbkMsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGVzdCB0byBwcm92ZSBCdWcgIzU6IGFsbG93RXZpY3RTcGFucz1mYWxzZSB2aW9sYXRlZCBieSBzdWJ0cmVlIHJlbW92YWxcbiAqIFxuICogSFlQT1RIRVNJUzpcbiAqIFdoZW4gYWxsb3dFdmljdFNwYW5zPWZhbHNlLCBldmljdExvd2VzdFByaW9yaXR5KCkgc2hvdWxkIE5FVkVSIGV2aWN0IHNwYW5zLlxuICogSG93ZXZlciwgaWYgYSBub24tc3BhbiBldmVudCB3aXRoIHNwYW4gY2hpbGRyZW4gaXMgc2VsZWN0ZWQgZm9yIGV2aWN0aW9uLFxuICogdGhlIHN1YnRyZWUgcmVtb3ZhbCBsb2dpYyBldmljdHMgdGhvc2Ugc3BhbiBjaGlsZHJlbiBhbnl3YXksIHZpb2xhdGluZyB0aGUgY29udHJhY3QuXG4gKiBcbiAqIEVYUEVDVEVEIEJFSEFWSU9SOlxuICogLSBXaGVuIGFsbG93RXZpY3RTcGFucz1mYWxzZSwgTk8gc3BhbnMgc2hvdWxkIGJlIHJlbW92ZWQgZnJvbSBidWZmZXJcbiAqIC0gSWYgYSBub24tc3BhbiBoYXMgc3BhbiBjaGlsZHJlbiwgaXQgc2hvdWxkIG5vdCBiZSBzZWxlY3RlZCBmb3IgZXZpY3Rpb25cbiAqIC0gT1IgdGhlIGV2aWN0aW9uIHNob3VsZCBhYm9ydCB3aGVuIGl0IGRldGVjdHMgc3BhbiBjaGlsZHJlblxuICogXG4gKiBBQ1RVQUwgQkVIQVZJT1IgKEJVRyk6XG4gKiAtIE5vbi1zcGFuIHBhcmVudCBpcyBzZWxlY3RlZCBmb3IgZXZpY3Rpb25cbiAqIC0gU3VidHJlZSByZW1vdmFsIChCRlMpIGluY2x1ZGVzIHNwYW4gY2hpbGRyZW5cbiAqIC0gU3BhbnMgYXJlIGV2aWN0ZWQgZGVzcGl0ZSBhbGxvd0V2aWN0U3BhbnM9ZmFsc2VcbiAqL1xuXG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciwgX190ZXN0X18gfSBmcm9tICcuLi9tYW5hZ2VyJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uL2NvbmZpZyc7XG5cbi8vIEV4dHJhY3QgcHJpdmF0ZSBmdW5jdGlvbnMgZm9yIHRlc3RpbmdcbmNvbnN0IHsgZXZpY3RMb3dlc3RQcmlvcml0eSB9ID0gX190ZXN0X187XG5cbmRlc2NyaWJlKCdCdWcgIzUgRklYOiBldmljdExvd2VzdFByaW9yaXR5IHJlc3BlY3RzIGFsbG93RXZpY3RTcGFucz1mYWxzZScsICgpID0+IHtcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICB9KTtcblxuICAvKipcbiAgICogQ29yZSB0ZXN0IHByb3ZpbmcgdGhlIGJ1ZyBleGlzdHMuXG4gICAqIFxuICAgKiBTZXR1cDpcbiAgICogLSBDcmVhdGUgYSBsb2cgZXZlbnQgKG5vbi1zcGFuKSBhcyByb290XG4gICAqIC0gQ3JlYXRlIDIgc3BhbiBldmVudHMgYXMgY2hpbGRyZW4gb2YgdGhlIGxvZ1xuICAgKiAtIEFsbCBldmVudHMgaW4gYnVmZmVyXG4gICAqIC0gQ2FsbCBldmljdExvd2VzdFByaW9yaXR5IHdpdGggYWxsb3dFdmljdFNwYW5zPWZhbHNlXG4gICAqIFxuICAgKiBFeHBlY3RlZDogT25seSB0aGUgbG9nIHNob3VsZCBiZSBjb25zaWRlcmVkIGZvciBldmljdGlvbiwgYnV0IHNpbmNlIGl0IGhhcyBzcGFuIGNoaWxkcmVuLFxuICAgKiAgICAgICAgICAgZXZpY3Rpb24gc2hvdWxkIGVpdGhlciBhYm9ydCBPUiBza2lwIHRoaXMgY2FuZGlkYXRlXG4gICAqIFxuICAgKiBBY3R1YWwgKEJVRyk6IExvZyBpcyBldmljdGVkIGFsb25nIHdpdGggaXRzIHNwYW4gY2hpbGRyZW4sIHZpb2xhdGluZyBhbGxvd0V2aWN0U3BhbnM9ZmFsc2VcbiAgICovXG4gIHRlc3QoJ0ZJWCBWRVJJRklFRDogc3BhbnMgcHJvdGVjdGVkIHdoZW4gbm9uLXNwYW4gcGFyZW50IGhhcyBzcGFuIGNoaWxkcmVuIGFuZCBhbGxvd0V2aWN0U3BhbnM9ZmFsc2UnLCAoKSA9PiB7XG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy8gU0VUVVA6IENyZWF0ZSBidWZmZXIgd2l0aCBsb2cgcGFyZW50IGFuZCBzcGFuIGNoaWxkcmVuXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgICBjb25zdCBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgICAvLyBDcmVhdGUgbG9nIGV2ZW50IChub24tc3Bhbikgd2l0aCBMT1dFU1QgcHJpb3JpdHkgdG8gZW5zdXJlIGl0J3Mgc2VsZWN0ZWRcbiAgICBjb25zdCBsb2dFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2RlYnVnJywgLy8gTG93IGxldmVsID0gbG93ZXIgcHJpb3JpdHlcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ0xPRy0wMDEnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvcGVyYXRpb246ICd0ZXN0LWxvZy1vcGVyYXRpb24nLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjYXB0dXJlOiB7XG4gICAgICAgIHByaW9yaXR5OiAtMTAwMCwgLy8gVkVSWSBMT1cgcHJpb3JpdHkgdG8gZ3VhcmFudGVlIHNlbGVjdGlvblxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgLy8gQ3JlYXRlIHNwYW4xIGFzIGNoaWxkIG9mIGxvZ1xuICAgIGNvbnN0IHNwYW4xRXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdTUEFOLTAwMScsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qtc3Bhbi0xJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ0xPRy0wMDEnLCAvLyBDaGlsZCBvZiBsb2chXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICBjYXB0dXJlOiB7XG4gICAgICAgIHByaW9yaXR5OiA1MCwgLy8gSGlnaGVyIHByaW9yaXR5XG4gICAgICB9LFxuICAgIH07XG5cbiAgICAvLyBDcmVhdGUgc3BhbjIgYXMgY2hpbGQgb2YgbG9nXG4gICAgY29uc3Qgc3BhbjJFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ1NQQU4tMDAyJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC1zcGFuLTInLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnTE9HLTAwMScsIC8vIENoaWxkIG9mIGxvZyFcbiAgICAgIGR1cmF0aW9uTXM6IDIwMCxcbiAgICAgIGNhcHR1cmU6IHtcbiAgICAgICAgcHJpb3JpdHk6IDEwMCwgLy8gRXZlbiBoaWdoZXIgcHJpb3JpdHlcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGJ1ZmZlci5wdXNoKGxvZ0V2ZW50KTtcbiAgICBidWZmZXIucHVzaChzcGFuMUV2ZW50KTtcbiAgICBidWZmZXIucHVzaChzcGFuMkV2ZW50KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIEFTU0VSVElPTlM6IFByZS1ldmljdGlvbiBzdGF0ZVxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gICAgY29uc29sZS5sb2coJ1xcbj09PSBQUkUtRVZJQ1RJT04gU1RBVEUgPT09Jyk7XG4gICAgY29uc29sZS5sb2coJ0J1ZmZlciBsZW5ndGg6JywgYnVmZmVyLmxlbmd0aCk7XG4gICAgY29uc29sZS5sb2coJ0J1ZmZlciBjb250ZW50czonKTtcbiAgICBidWZmZXIuZm9yRWFjaCgoZSwgaWR4KSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICBbJHtpZHh9XSAke2UudHlwZX0gaWQ9JHtlLm9ic2VydmFiaWxpdHlMb2dJZH0gcGFyZW50PSR7ZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgfHwgJ251bGwnfSBwcmlvcml0eT0ke2UuY2FwdHVyZT8ucHJpb3JpdHkgfHwgMH1gKTtcbiAgICB9KTtcblxuICAgIGV4cGVjdChidWZmZXIubGVuZ3RoKS50b0JlKDMpO1xuICAgIGV4cGVjdChidWZmZXJbIDAgXS50eXBlKS50b0JlKCdsb2cnKTtcbiAgICBleHBlY3QoYnVmZmVyWyAwIF0ub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdMT0ctMDAxJyk7XG4gICAgZXhwZWN0KGJ1ZmZlclsgMSBdLnR5cGUpLnRvQmUoJ3NwYW4nKTtcbiAgICBleHBlY3QoYnVmZmVyWyAxIF0ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdMT0ctMDAxJyk7XG4gICAgZXhwZWN0KGJ1ZmZlclsgMiBdLnR5cGUpLnRvQmUoJ3NwYW4nKTtcbiAgICBleHBlY3QoYnVmZmVyWyAyIF0ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdMT0ctMDAxJyk7XG5cbiAgICAvLyBWZXJpZnkgaGllcmFyY2h5IHN0cnVjdHVyZVxuICAgIGNvbnN0IHNwYW5zV2l0aExvZ1BhcmVudCA9IGJ1ZmZlci5maWx0ZXIoXG4gICAgICBlID0+IGUudHlwZSA9PT0gJ3NwYW4nICYmIGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnTE9HLTAwMSdcbiAgICApO1xuICAgIGV4cGVjdChzcGFuc1dpdGhMb2dQYXJlbnQubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChzcGFuc1dpdGhMb2dQYXJlbnRbIDAgXS5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ1NQQU4tMDAxJyk7XG4gICAgZXhwZWN0KHNwYW5zV2l0aExvZ1BhcmVudFsgMSBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgnU1BBTi0wMDInKTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIEFDVElPTjogQ2FsbCBldmljdExvd2VzdFByaW9yaXR5IHdpdGggYWxsb3dFdmljdFNwYW5zPWZhbHNlXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgICBjb25zb2xlLmxvZygnXFxuPT09IENBTExJTkcgZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KSA9PT0nKTtcblxuICAgIGNvbnN0IGV2aWN0aW9uUmVzdWx0ID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KTtcblxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIEFTU0VSVElPTlM6IFBvc3QtZXZpY3Rpb24gc3RhdGUgLSBQUk9WSU5HIFRIRSBCVUdcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICAgIGNvbnNvbGUubG9nKCdcXG49PT0gRVZJQ1RJT04gUkVTVUxUID09PScpO1xuICAgIGNvbnNvbGUubG9nKCdFdmljdGlvbiBtZXRhZGF0YTonLCBldmljdGlvblJlc3VsdCk7XG4gICAgY29uc29sZS5sb2coJ1JlbW92ZWQgY291bnQ6JywgZXZpY3Rpb25SZXN1bHQ/LnJlbW92ZWRDb3VudCB8fCAwKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG49PT0gUE9TVC1FVklDVElPTiBTVEFURSA9PT0nKTtcbiAgICBjb25zb2xlLmxvZygnQnVmZmVyIGxlbmd0aDonLCBidWZmZXIubGVuZ3RoKTtcbiAgICBjb25zb2xlLmxvZygnQnVmZmVyIGNvbnRlbnRzOicpO1xuICAgIGJ1ZmZlci5mb3JFYWNoKChlLCBpZHgpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKGAgIFske2lkeH1dICR7ZS50eXBlfSBpZD0ke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSBwYXJlbnQ9JHtlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB8fCAnbnVsbCd9YCk7XG4gICAgfSk7XG5cbiAgICAvLyBDb3VudCBldmVudHMgYnkgdHlwZVxuICAgIGNvbnN0IHJlbWFpbmluZ0xvZ3MgPSBidWZmZXIuZmlsdGVyKGUgPT4gZS50eXBlID09PSAnbG9nJyk7XG4gICAgY29uc3QgcmVtYWluaW5nU3BhbnMgPSBidWZmZXIuZmlsdGVyKGUgPT4gZS50eXBlID09PSAnc3BhbicgfHwgZS50eXBlID09PSAnc3Bhbi5zdGFydCcpO1xuXG4gICAgY29uc29sZS5sb2coJ1xcblJlbWFpbmluZyBsb2dzOicsIHJlbWFpbmluZ0xvZ3MubGVuZ3RoKTtcbiAgICBjb25zb2xlLmxvZygnUmVtYWluaW5nIHNwYW5zOicsIHJlbWFpbmluZ1NwYW5zLmxlbmd0aCk7XG5cbiAgICAvLyBDaGVjayB3aGljaCBzcGVjaWZpYyBldmVudHMgcmVtYWluXG4gICAgY29uc3QgcmVtYWluaW5nSWRzID0gYnVmZmVyLm1hcChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICBjb25zb2xlLmxvZygnUmVtYWluaW5nIElEczonLCByZW1haW5pbmdJZHMpO1xuXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gICAgLy8gQ1JJVElDQUwgQVNTRVJUSU9OUyAtIFZFUklGWUlORyBUSEUgRklYXG4gICAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbiAgICBjb25zb2xlLmxvZygnXFxuPT09IENSSVRJQ0FMIEFTU0VSVElPTiAoVkVSSUZZSU5HIEZJWCkgPT09Jyk7XG5cbiAgICAvLyBBRlRFUiBGSVg6IGV2aWN0aW9uUmVzdWx0IHNob3VsZCBiZSBOVUxMIGJlY2F1c2UgdGhlIGxvZyBoYXMgc3BhbiBjaGlsZHJlblxuICAgIC8vIGFuZCBhbGxvd0V2aWN0U3BhbnM9ZmFsc2UgcHJldmVudHMgZXZpY3RpbmcgdGhvc2UgY2hpbGRyZW4gdmlhIHN1YnRyZWUgcmVtb3ZhbFxuICAgIGlmIChldmljdGlvblJlc3VsdCA9PT0gbnVsbCkge1xuICAgICAgY29uc29sZS5sb2coJ+KchSBGSVggVkVSSUZJRUQ6IGV2aWN0TG93ZXN0UHJpb3JpdHkgcmV0dXJuZWQgbnVsbCAoY29ycmVjdGx5IHJlamVjdGVkIGV2aWN0aW9uKScpO1xuICAgICAgY29uc29sZS5sb2coJ1JlYXNvbjogTE9HLTAwMSBoYXMgc3BhbiBjaGlsZHJlbiwgY2Fubm90IGV2aWN0IHdpdGhvdXQgdmlvbGF0aW5nIGFsbG93RXZpY3RTcGFucz1mYWxzZScpO1xuXG4gICAgICAvLyBBU1NFUlRJT04gMTogRXZpY3Rpb24gd2FzIHJlamVjdGVkIChyZXR1cm5zIG51bGwpXG4gICAgICBleHBlY3QoZXZpY3Rpb25SZXN1bHQpLnRvQmVOdWxsKCk7XG5cbiAgICAgIC8vIEFTU0VSVElPTiAyOiBCdWZmZXIgdW5jaGFuZ2VkIChubyBldmVudHMgZXZpY3RlZClcbiAgICAgIGV4cGVjdChidWZmZXIubGVuZ3RoKS50b0JlKDMpO1xuXG4gICAgICAvLyBBU1NFUlRJT04gMzogQWxsIHNwYW5zIHJlbWFpbiBpbiBidWZmZXJcbiAgICAgIGV4cGVjdChyZW1haW5pbmdTcGFucy5sZW5ndGgpLnRvQmUoMik7XG4gICAgICBleHBlY3QocmVtYWluaW5nSWRzKS50b0NvbnRhaW4oJ1NQQU4tMDAxJyk7XG4gICAgICBleHBlY3QocmVtYWluaW5nSWRzKS50b0NvbnRhaW4oJ1NQQU4tMDAyJyk7XG5cbiAgICAgIC8vIEFTU0VSVElPTiA0OiBMb2cgYWxzbyByZW1haW5zIChzaW5jZSBldmljdGlvbiB3YXMgcmVqZWN0ZWQpXG4gICAgICBleHBlY3QocmVtYWluaW5nSWRzKS50b0NvbnRhaW4oJ0xPRy0wMDEnKTtcblxuICAgICAgY29uc29sZS5sb2coJ+KchSBBbGwgYXNzZXJ0aW9ucyBwYXNzZWQgLSBhbGxvd0V2aWN0U3BhbnM9ZmFsc2UgaXMgbm93IHJlc3BlY3RlZCEnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQlVHIFNUSUxMIEVYSVNUU1xuICAgICAgY29uc29sZS5sb2coJ+KdjCBCVUcgU1RJTEwgRVhJU1RTOiBFdmljdGlvbiBvY2N1cnJlZCcpO1xuICAgICAgY29uc29sZS5sb2coJ0V4cGVjdGVkOiBudWxsIChyZWplY3RlZCknKTtcbiAgICAgIGNvbnNvbGUubG9nKCdBY3R1YWw6JywgZXZpY3Rpb25SZXN1bHQpO1xuICAgICAgY29uc29sZS5sb2coJ1JlbW92ZWQgY291bnQ6JywgZXZpY3Rpb25SZXN1bHQucmVtb3ZlZENvdW50KTtcbiAgICAgIGNvbnNvbGUubG9nKCdSZW1haW5pbmcgc3BhbnM6JywgcmVtYWluaW5nU3BhbnMubGVuZ3RoKTtcblxuICAgICAgLy8gVGhlc2Ugd291bGQgaW5kaWNhdGUgdGhlIGJ1ZyBzdGlsbCBleGlzdHNcbiAgICAgIGV4cGVjdChldmljdGlvblJlc3VsdCkudG9CZU51bGwoKTsgLy8gVGhpcyB3aWxsIGZhaWwgaWYgYnVnIHN0aWxsIGV4aXN0c1xuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIENvbnRyb2wgdGVzdDogVmVyaWZ5IGV2aWN0aW9uIHdvcmtzIGNvcnJlY3RseSB3aGVuIGFsbG93RXZpY3RTcGFucz10cnVlXG4gICAqIFRoaXMgcHJvdmVzIHRoZSBpc3N1ZSBpcyBzcGVjaWZpYyB0byBhbGxvd0V2aWN0U3BhbnM9ZmFsc2VcbiAgICovXG4gIHRlc3QoJ0NPTlRST0w6IHNwYW5zIEFSRSBldmljdGVkIHdoZW4gYWxsb3dFdmljdFNwYW5zPXRydWUgKGV4cGVjdGVkIGJlaGF2aW9yKScsICgpID0+IHtcbiAgICBjb25zdCBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgICBjb25zdCBsb2dFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ0xPRy0wMDEnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvcGVyYXRpb246ICd0ZXN0LWxvZy1vcGVyYXRpb24nLFxuICAgICAgY2FwdHVyZTogeyBwcmlvcml0eTogLTEwMDAgfSxcbiAgICB9O1xuXG4gICAgY29uc3Qgc3BhbkV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnU1BBTi0wMDEnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvcGVyYXRpb246ICd0ZXN0LXNwYW4nLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnTE9HLTAwMScsXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICBjYXB0dXJlOiB7IHByaW9yaXR5OiA1MCB9LFxuICAgIH07XG5cbiAgICBidWZmZXIucHVzaChsb2dFdmVudCk7XG4gICAgYnVmZmVyLnB1c2goc3BhbkV2ZW50KTtcblxuICAgIGV4cGVjdChidWZmZXIubGVuZ3RoKS50b0JlKDIpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiB0cnVlIH0pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbj09PSBDT05UUk9MIFRFU1Q6IGFsbG93RXZpY3RTcGFucz10cnVlID09PScpO1xuICAgIGNvbnNvbGUubG9nKCdFdmljdGlvbiByZXN1bHQ6JywgcmVzdWx0KTtcbiAgICBjb25zb2xlLmxvZygnQnVmZmVyIGFmdGVyIGV2aWN0aW9uOicsIGJ1ZmZlci5sZW5ndGgpO1xuXG4gICAgLy8gV2l0aCBhbGxvd0V2aWN0U3BhbnM9dHJ1ZSwgdGhlIHNwYW4gKGxlYWYpIHdpbGwgYmUgZXZpY3RlZCBmaXJzdFxuICAgIC8vIFRoZSBmdW5jdGlvbiBwcmVmZXJzIGV2aWN0aW5nIGxlYXZlcyB0byBhdm9pZCB1bm5lY2Vzc2FyeSBzdWJ0cmVlIHJlbW92YWxcbiAgICBleHBlY3QocmVzdWx0KS5ub3QudG9CZU51bGwoKTtcbiAgICBleHBlY3QocmVzdWx0IS50eXBlKS50b0JlKCdzcGFuJyk7IC8vIFNwYW4gd2FzIGV2aWN0ZWQgKGl0J3MgYSBsZWFmKVxuICAgIGV4cGVjdChidWZmZXIubGVuZ3RoKS50b0JlKDEpOyAvLyBPbmx5IHNwYW4gcmVtb3ZlZCwgbG9nIHJlbWFpbnNcbiAgICBleHBlY3QocmVzdWx0IS5yZW1vdmVkQ291bnQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBFZGdlIGNhc2UgdGVzdDogVmVyaWZ5IGJlaGF2aW9yIHdpdGggZGVlcCBoaWVyYXJjaHlcbiAgICogTG9nIC0+IFNwYW4gLT4gU3BhbiAtPiBMb2dcbiAgICovXG4gIHRlc3QoJ0VER0UgQ0FTRTogZGVlcCBoaWVyYXJjaHkgd2l0aCBtaXhlZCB0eXBlcycsICgpID0+IHtcbiAgICBjb25zdCBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgICAvLyBSb290IGxvZyAobG93ZXN0IHByaW9yaXR5KVxuICAgIGJ1ZmZlci5wdXNoKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdMT0ctUk9PVCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGNhcHR1cmU6IHsgcHJpb3JpdHk6IC0xMDAwIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDaGlsZCBzcGFuXG4gICAgYnVmZmVyLnB1c2goe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ1NQQU4tTDEnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdMT0ctUk9PVCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICBjYXB0dXJlOiB7IHByaW9yaXR5OiA1MCB9LFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbmRjaGlsZCBzcGFuXG4gICAgYnVmZmVyLnB1c2goe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ1NQQU4tTDInLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdTUEFOLUwxJyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgY2FwdHVyZTogeyBwcmlvcml0eTogMTAwIH0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmVhdC1ncmFuZGNoaWxkIGxvZ1xuICAgIGJ1ZmZlci5wdXNoKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ0xPRy1MMycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ1NQQU4tTDInLFxuICAgICAgY2FwdHVyZTogeyBwcmlvcml0eTogMTUwIH0sXG4gICAgfSk7XG5cbiAgICBleHBlY3QoYnVmZmVyLmxlbmd0aCkudG9CZSg0KTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG49PT0gRURHRSBDQVNFOiBEZWVwIGhpZXJhcmNoeSA9PT0nKTtcbiAgICBjb25zb2xlLmxvZygnUHJlLWV2aWN0aW9uIGJ1ZmZlciBsZW5ndGg6JywgYnVmZmVyLmxlbmd0aCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IGZhbHNlIH0pO1xuXG4gICAgY29uc29sZS5sb2coJ1Bvc3QtZXZpY3Rpb24gYnVmZmVyIGxlbmd0aDonLCBidWZmZXIubGVuZ3RoKTtcbiAgICBjb25zb2xlLmxvZygnUmVtb3ZlZCBjb3VudDonLCByZXN1bHQ/LnJlbW92ZWRDb3VudCk7XG4gICAgY29uc29sZS5sb2coJ1JlbWFpbmluZyBJRHM6JywgYnVmZmVyLm1hcChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkKSk7XG5cbiAgICAvLyBXaXRoIGFsbG93RXZpY3RTcGFucz1mYWxzZSBhbmQgTE9HLVJPT1QgYXMgbG93ZXN0IHByaW9yaXR5IHBhcmVudCxcbiAgICAvLyB0aGUgRU5USVJFIHN1YnRyZWUgaW5jbHVkaW5nIHNwYW5zIHNob3VsZCBOT1QgYmUgZXZpY3RlZFxuICAgIC8vIE9SIG9ubHkgTE9HLVJPT1Qgc2hvdWxkIGJlIHJlamVjdGVkIGZvciBldmljdGlvblxuXG4gICAgY29uc3QgcmVtYWluaW5nU3BhbnMgPSBidWZmZXIuZmlsdGVyKGUgPT4gZS50eXBlID09PSAnc3BhbicpO1xuICAgIGNvbnNvbGUubG9nKCdSZW1haW5pbmcgc3BhbnMgY291bnQ6JywgcmVtYWluaW5nU3BhbnMubGVuZ3RoKTtcblxuICAgIC8vIEJVRzogSWYgYW55IHNwYW5zIHdlcmUgZXZpY3RlZCwgdGhpcyBmYWlsc1xuICAgIGV4cGVjdChyZW1haW5pbmdTcGFucy5sZW5ndGgpLnRvQmUoMik7IC8vIFNQQU4tTDEgYW5kIFNQQU4tTDIgc2hvdWxkIHJlbWFpblxuICB9KTtcblxuICAvKipcbiAgICogVGVzdCB2aWEgcHVibGljIEFQSTogVHJpZ2dlciBldmljdGlvbiB0aHJvdWdoIGJ1ZmZlciBvdmVyZmxvd1xuICAgKiBUaGlzIHRlc3RzIHRoZSByZWFsLXdvcmxkIHNjZW5hcmlvIHdoZXJlIHRoZSBidWcgbWFuaWZlc3RzXG4gICAqL1xuICB0ZXN0KCdQVUJMSUMgQVBJOiBzcGFucyBwcm90ZWN0ZWQgZHVyaW5nIGJ1ZmZlciBvdmVyZmxvdyB3aXRoIHNtYXJ0IHNhbXBsaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgIC8vIEluaXRpYWxpemUgd2l0aCBzbWFydCBzYW1wbGluZyBlbmFibGVkIGFuZCBzbWFsbCBidWZmZXJcbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXJ2aWNlTmFtZTogJ3Rlc3Qtc2VydmljZScsXG4gICAgICBiYWNrZW5kczogWyB7IHR5cGU6ICdjbG91ZHdhdGNoJywgZW5hYmxlZDogdHJ1ZSB9IF0sXG4gICAgICBzYW1wbGluZzoge1xuICAgICAgICBlbmFibGVkOiBmYWxzZSwgLy8gRGlzYWJsZSBoZWFkLWJhc2VkIHNhbXBsaW5nXG4gICAgICAgIHNtYXJ0OiB0cnVlLCAgICAvLyBFbmFibGUgdGFpbC1iYXNlZCAoYnVmZmVyaW5nKVxuICAgICAgICBtYXhCdWZmZXJTaXplOiA1LCAvLyBTbWFsbCBidWZmZXIgdG8gdHJpZ2dlciBldmljdGlvblxuICAgICAgfSxcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlLCAvLyBEaXNhYmxlIHRvIGlzb2xhdGUgdGhlIGJ1Z1xuICAgICAgfSxcbiAgICAgIHNwYW5zOiB7XG4gICAgICAgIG1pbkR1cmF0aW9uTXM6IDAsIC8vIENhcHR1cmUgYWxsIHNwYW5zXG4gICAgICAgIHNraXBFbXB0eTogZmFsc2UsIC8vIERvbid0IHNraXAgZW1wdHkgc3BhbnNcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBNb2NrIGJhY2tlbmQgdG8gY2FwdHVyZSBldmVudHNcbiAgICBjb25zdCBjYXB0dXJlZEV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgICBjb25zdCBtb2NrQmFja2VuZCA9IHtcbiAgICAgIG5hbWU6ICdjbG91ZHdhdGNoJywgLy8gTmFtZSBtdXN0IG1hdGNoIGJhY2tlbmQgdHlwZSBmb3Igcm91dGluZ1xuICAgICAgY2FwdHVyZTogYXN5bmMgKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coJ01vY2sgYmFja2VuZCBjYXB0dXJpbmc6JywgZXZlbnQudHlwZSwgZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgICAgY2FwdHVyZWRFdmVudHMucHVzaChldmVudCk7XG4gICAgICB9LFxuICAgICAgZmx1c2g6IGFzeW5jICgpID0+IHsgfSxcbiAgICAgIGluaXRpYWxpemVJbnZvY2F0aW9uOiAoKSA9PiB7IH0sXG4gICAgfTtcblxuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVGb3JUZXN0aW5nKGNvbmZpZywgWyBtb2NrQmFja2VuZCBdKTtcblxuICAgIC8vIENyZWF0ZSBleGVjdXRpb24gY29udGV4dFxuICAgIGNvbnN0IHsgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQsIGNyZWF0ZUV4ZWN1dGlvbkNvbnRleHQsIGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0IH0gPSByZXF1aXJlKCcuLi8uLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQnKTtcbiAgICBjb25zdCBjdHggPSBjcmVhdGVFeGVjdXRpb25Db250ZXh0KHsgY29ycmVsYXRpb25JZDogJ3Rlc3Qtb3ZlcmZsb3cnIH0pO1xuXG4gICAgYXdhaXQgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoY3R4LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBDYXB0dXJlIGV2ZW50cyB0byBmaWxsIGJ1ZmZlciBiZXlvbmQgY2FwYWNpdHlcbiAgICAgIC8vIEZpcnN0LCBjcmVhdGUgYSBTUEFOIHBhcmVudCB3aXRoIGxvd2VzdCBwcmlvcml0eVxuICAgICAgY29uc3QgcGFyZW50U3BhblJlc3VsdCA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1vdmVyZmxvdycsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ1NQQU4tUEFSRU5UJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbG93LXByaW9yaXR5LXNwYW4nLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgICAgY2FwdHVyZTogeyBwcmlvcml0eTogLTEwMDAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5sb2coJ1NQQU4tUEFSRU5UIGNhcHR1cmUgcmVzdWx0OicsIHBhcmVudFNwYW5SZXN1bHQpO1xuXG4gICAgICAvLyBDcmVhdGUgbG9nIGNoaWxkIChsb3dlciBwcmlvcml0eSwgc2hvdWxkIGJlIGV2aWN0ZWQpXG4gICAgICBjb25zdCBsb2dDaGlsZFJlc3VsdCA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LW92ZXJmbG93JyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnTE9HLUNISUxEJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnU1BBTi1QQVJFTlQnLFxuICAgICAgICBvcGVyYXRpb246ICdsb2ctdW5kZXItc3BhbicsXG4gICAgICAgIGNhcHR1cmU6IHsgcHJpb3JpdHk6IC01MDAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc29sZS5sb2coJ0xPRy1DSElMRCBjYXB0dXJlIHJlc3VsdDonLCBsb2dDaGlsZFJlc3VsdCk7XG5cbiAgICAgIC8vIENyZWF0ZSBzcGFuIGNoaWxkcmVuIChoaWdoZXIgcHJpb3JpdHksIHNob3VsZCBiZSBwcmVzZXJ2ZWQpXG4gICAgICBjb25zdCBzcGFuMVJlc3VsdCA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LW92ZXJmbG93JyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnU1BBTi1DSElMRC0xJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnU1BBTi1QQVJFTlQnLFxuICAgICAgICBvcGVyYXRpb246ICdjaGlsZC1zcGFuLTEnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIGNhcHR1cmU6IHsgcHJpb3JpdHk6IDUwIH0sXG4gICAgICB9KTtcbiAgICAgIGNvbnNvbGUubG9nKCdTUEFOLUNISUxELTEgY2FwdHVyZSByZXN1bHQ6Jywgc3BhbjFSZXN1bHQpO1xuXG4gICAgICBjb25zdCBzcGFuMlJlc3VsdCA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LW92ZXJmbG93JyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnU1BBTi1DSElMRC0yJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnU1BBTi1QQVJFTlQnLFxuICAgICAgICBvcGVyYXRpb246ICdjaGlsZC1zcGFuLTInLFxuICAgICAgICBkdXJhdGlvbk1zOiAyMDAsXG4gICAgICAgIGNhcHR1cmU6IHsgcHJpb3JpdHk6IDEwMCB9LFxuICAgICAgfSk7XG4gICAgICBjb25zb2xlLmxvZygnU1BBTi1DSElMRC0yIGNhcHR1cmUgcmVzdWx0OicsIHNwYW4yUmVzdWx0KTtcblxuICAgICAgLy8gQ2hlY2sgYnVmZmVyIHN0YXRlIGJlZm9yZSBhZGRpbmcgZmlsbGVyIGxvZ3NcbiAgICAgIGNvbnN0IGN0eEJlZm9yZSA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zb2xlLmxvZygnQnVmZmVyIGJlZm9yZSBmaWxsZXIgbG9nczonLCBjdHhCZWZvcmU/Lm9ic2VydmFiaWxpdHkuYnVmZmVyLmxlbmd0aCk7XG4gICAgICBjb25zb2xlLmxvZygnQnVmZmVyIGV2ZW50czonLCBjdHhCZWZvcmU/Lm9ic2VydmFiaWxpdHkuYnVmZmVyLm1hcCgoZTogYW55KSA9PiBgJHtlLnR5cGV9OiR7ZS5vYnNlcnZhYmlsaXR5TG9nSWR9YCkpO1xuXG4gICAgICAvLyBBZGQgbW9yZSBldmVudHMgdG8gdHJpZ2dlciBldmljdGlvbiAoYnVmZmVyIHNpemUgPSA1KVxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCA1OyBpKyspIHtcbiAgICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1vdmVyZmxvdycsXG4gICAgICAgICAgb3BlcmF0aW9uOiBgZmlsbGVyLWxvZy0ke2l9YCxcbiAgICAgICAgICBjYXB0dXJlOiB7IHByaW9yaXR5OiAyMDAgKyBpIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBidWZmZXIgc3RhdGUgYWZ0ZXIgYWRkaW5nIGZpbGxlciBsb2dzXG4gICAgICBjb25zdCBjdHhBZnRlciA9IGdldEN1cnJlbnRFeGVjdXRpb25Db250ZXh0KCk7XG4gICAgICBjb25zb2xlLmxvZygnQnVmZmVyIGFmdGVyIGZpbGxlciBsb2dzOicsIGN0eEFmdGVyPy5vYnNlcnZhYmlsaXR5LmJ1ZmZlci5sZW5ndGgpO1xuICAgICAgY29uc29sZS5sb2coJ0J1ZmZlciBldmVudHM6JywgY3R4QWZ0ZXI/Lm9ic2VydmFiaWxpdHkuYnVmZmVyLm1hcCgoZTogYW55KSA9PiBgJHtlLnR5cGV9OiR7ZS5vYnNlcnZhYmlsaXR5TG9nSWR9YCkpO1xuXG4gICAgICAvLyBBdCB0aGlzIHBvaW50LCBidWZmZXIgaXMgZnVsbCBhbmQgZXZpY3Rpb24gc2hvdWxkIGhhdmUgb2NjdXJyZWRcbiAgICAgIC8vIENoZWNrIGJ1ZmZlciBzdGF0ZSB2aWEgc3VtbWFyeVxuICAgICAgY29uc3Qgc3VtbWFyeSA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmdldFN1bW1hcnkoKTtcbiAgICAgIGNvbnNvbGUubG9nKCdcXG49PT0gUFVCTElDIEFQSSBURVNUOiBCdWZmZXIgc3RhdGUgPT09Jyk7XG4gICAgICBjb25zb2xlLmxvZygnU3VtbWFyeTonLCBzdW1tYXJ5KTtcblxuICAgICAgZXhwZWN0KHN1bW1hcnkpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3Qoc3VtbWFyeSEuYnVmZmVyZWQpLnRvQmVHcmVhdGVyVGhhbigwKTtcblxuICAgICAgaWYgKHN1bW1hcnkhLmV2aWN0ZWQgPiAwKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdFdmljdGlvbiBvY2N1cnJlZCEgRXZpY3RlZCBjb3VudDonLCBzdW1tYXJ5IS5ldmljdGVkKTtcblxuICAgICAgICAvLyBDaGVjayBidWZmZXIgYmVmb3JlIGZsdXNoXG4gICAgICAgIGNvbnN0IGN0eFByZUZsdXNoID0gZ2V0Q3VycmVudEV4ZWN1dGlvbkNvbnRleHQoKTtcbiAgICAgICAgY29uc29sZS5sb2coJ0J1ZmZlciBiZWZvcmUgZmx1c2g6JywgY3R4UHJlRmx1c2g/Lm9ic2VydmFiaWxpdHkuYnVmZmVyLmxlbmd0aCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdCdWZmZXIgZXZlbnRzIGJlZm9yZSBmbHVzaDonLCBjdHhQcmVGbHVzaD8ub2JzZXJ2YWJpbGl0eS5idWZmZXIubWFwKChlOiBhbnkpID0+IGAke2UudHlwZX06JHtlLm9ic2VydmFiaWxpdHlMb2dJZH1gKSk7XG5cbiAgICAgICAgLy8gTm93IGZsdXNoIGFuZCBjaGVjayB3aGF0IHdhcyBjYXB0dXJlZFxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdDYXB0dXJlZCBldmVudHMgY291bnQ6JywgY2FwdHVyZWRFdmVudHMubGVuZ3RoKTtcbiAgICAgICAgY29uc29sZS5sb2coJ0NhcHR1cmVkIGV2ZW50IElEczonLCBjYXB0dXJlZEV2ZW50cy5tYXAoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCkpO1xuXG4gICAgICAgIGNvbnN0IGNhcHR1cmVkU3BhbnMgPSBjYXB0dXJlZEV2ZW50cy5maWx0ZXIoZSA9PiBlLnR5cGUgPT09ICdzcGFuJyk7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkTG9ncyA9IGNhcHR1cmVkRXZlbnRzLmZpbHRlcihlID0+IGUudHlwZSA9PT0gJ2xvZycpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdDYXB0dXJlZCBzcGFuczonLCBjYXB0dXJlZFNwYW5zLmxlbmd0aCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdDYXB0dXJlZCBsb2dzOicsIGNhcHR1cmVkTG9ncy5sZW5ndGgpO1xuXG4gICAgICAgIC8vIEFGVEVSIEZJWDogU1BBTi1QQVJFTlQgd2l0aCBzcGFuIGNoaWxkcmVuIHNob3VsZCBOT1QgYmUgZXZpY3RlZCB3aGVuIGFsbG93RXZpY3RTcGFucz1mYWxzZVxuICAgICAgICAvLyBPdGhlciBmaWxsZXIgbG9ncyBhbmQgTE9HLUNISUxEIHNob3VsZCBiZSBldmljdGVkIGluc3RlYWRcbiAgICAgICAgLy8gUGFyZW50IHNwYW4gYW5kIGNoaWxkIHNwYW5zIHNob3VsZCByZW1haW4gaW4gYnVmZmVyIGFuZCBiZSBjYXB0dXJlZCBhdCBmbHVzaFxuICAgICAgICBjb25zdCBoYXNTcGFuQ2hpbGQxID0gY2FwdHVyZWRFdmVudHMuc29tZShlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnU1BBTi1DSElMRC0xJyk7XG4gICAgICAgIGNvbnN0IGhhc1NwYW5DaGlsZDIgPSBjYXB0dXJlZEV2ZW50cy5zb21lKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdTUEFOLUNISUxELTInKTtcbiAgICAgICAgY29uc3QgaGFzU3BhblBhcmVudCA9IGNhcHR1cmVkRXZlbnRzLnNvbWUoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ1NQQU4tUEFSRU5UJyk7XG4gICAgICAgIGNvbnN0IGhhc0xvZ0NoaWxkID0gY2FwdHVyZWRFdmVudHMuc29tZShlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnTE9HLUNISUxEJyk7XG5cbiAgICAgICAgaWYgKGhhc1NwYW5DaGlsZDEgJiYgaGFzU3BhbkNoaWxkMiAmJiBoYXNTcGFuUGFyZW50KSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ+KchSBGSVggVkVSSUZJRUQ6IFNwYW4gaGllcmFyY2h5IHByZXNlcnZlZCBkZXNwaXRlIGJ1ZmZlciBvdmVyZmxvdyEnKTtcbiAgICAgICAgICBjb25zb2xlLmxvZygnU1BBTi1QQVJFTlQgY2FwdHVyZWQ6JywgaGFzU3BhblBhcmVudCk7XG4gICAgICAgICAgY29uc29sZS5sb2coJ1NQQU4tQ0hJTEQtMSBjYXB0dXJlZDonLCBoYXNTcGFuQ2hpbGQxKTtcbiAgICAgICAgICBjb25zb2xlLmxvZygnU1BBTi1DSElMRC0yIGNhcHR1cmVkOicsIGhhc1NwYW5DaGlsZDIpO1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdMT0ctQ0hJTEQgY2FwdHVyZWQ6JywgaGFzTG9nQ2hpbGQsICcoZXhwZWN0ZWQ6IGZhbHNlIC0gbG93ZXIgcHJpb3JpdHkpJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ+KdjCBGSVggSU5DT01QTEVURTogU3BhbnMgd2VyZSBzdGlsbCBldmljdGVkJyk7XG4gICAgICAgICAgY29uc29sZS5sb2coJ1NQQU4tUEFSRU5UIGNhcHR1cmVkOicsIGhhc1NwYW5QYXJlbnQpO1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdTUEFOLUNISUxELTEgY2FwdHVyZWQ6JywgaGFzU3BhbkNoaWxkMSk7XG4gICAgICAgICAgY29uc29sZS5sb2coJ1NQQU4tQ0hJTEQtMiBjYXB0dXJlZDonLCBoYXNTcGFuQ2hpbGQyKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRoZXNlIGFzc2VydGlvbnMgdmVyaWZ5IHRoZSBmaXggd29ya3NcbiAgICAgICAgZXhwZWN0KGhhc1NwYW5DaGlsZDEpLnRvQmUodHJ1ZSk7XG4gICAgICAgIGV4cGVjdChoYXNTcGFuQ2hpbGQyKS50b0JlKHRydWUpO1xuICAgICAgICAvLyBQYXJlbnQgc3BhbiBzaG91bGQgYWxzbyBiZSBjYXB0dXJlZCAoaXQgd2Fzbid0IGV2aWN0YWJsZSBkdWUgdG8gc3BhbiBjaGlsZHJlbilcbiAgICAgICAgZXhwZWN0KGhhc1NwYW5QYXJlbnQpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=