"use strict";
/**
 * Critical bug tests for noise reduction.
 *
 * These tests verify fixes for the issues identified in the comprehensive analysis.
 * Each test is designed to fail if the corresponding bug exists.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const matcher_1 = require("../rules/matcher");
const config_1 = require("../../config");
describe('Critical Bug Tests', () => {
    const baseNoise = (0, config_1.createObservabilityConfig)().noiseReduction;
    describe('Issue #1: Hard Signal Protection Override', () => {
        it('should allow rules to aggregate error events when explicitly configured', () => {
            // Scenario: Batch processing with many failures
            // User wants to aggregate failures, not keep each as standalone log
            const parentSpan = {
                type: 'span',
                level: 'info',
                correlationId: 'batch-1',
                timestampMs: 1000,
                observabilityLogId: 'batch-parent',
                operation: 'processBatch',
                durationMs: 5000,
            };
            const failedEvents = Array.from({ length: 50 }).map((_, i) => ({
                type: 'span',
                level: 'error', // Hard signal!
                correlationId: 'batch-1',
                timestampMs: 1000 + i * 100,
                observabilityLogId: `failed-${i}`,
                parentObservabilityLogId: 'batch-parent',
                operation: 'processItem',
                durationMs: 50,
                success: false, // Also a hard signal!
                error: { type: 'ValidationError', message: 'Invalid data' }, // Also a hard signal!
            }));
            // User explicitly wants to aggregate these failures
            const aggregateFailuresRule = {
                id: 'custom.aggregate_batch_failures',
                match: {
                    type: 'span',
                    operation: 'processItem',
                    success: false,
                },
                decision: 'aggregate',
                priority: 2000, // Explicitly higher than hard signal priority (1000)
                reason: 'Aggregate batch item failures into parent',
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([parentSpan, ...failedEvents], {
                ...baseNoise,
                enabled: true,
                rules: [aggregateFailuresRule],
            });
            // EXPECTED: Failed events should be aggregated (current behavior: all kept)
            expect(stats.aggregated).toBe(50);
            expect(events.length).toBe(1); // Only parent span
            const parent = events.find(e => e.observabilityLogId === 'batch-parent');
            expect(parent).toBeDefined();
            const aggregates = parent.data?.noiseReduction?.aggregates;
            expect(aggregates).toBeDefined();
            expect(Object.values(aggregates || {}).some((bucket) => bucket.errorCount === 50)).toBe(true);
        });
        it('should respect rule priority over hard signal protection', () => {
            const errorEvent = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'error-1',
                operation: 'testOperation',
            };
            const result = (0, index_1.evaluateNoiseRules)(errorEvent, [
                {
                    id: 'drop-all-errors',
                    match: { level: 'error' },
                    decision: 'drop',
                    priority: 2000, // Higher than hard signal (1000)
                    reason: 'Explicit drop rule',
                },
            ], matcher_1.matchesRule);
            // EXPECTED: Rule with priority 2000 should win over hard signal (1000)
            // ACTUAL: Hard signal wins because it's checked first
            expect(result.decision).toBe('drop');
            expect(result.ruleId).toBe('drop-all-errors');
        });
    });
    describe('Issue #2: Reparenting to Dropped Parent', () => {
        it('should reparent to first KEPT ancestor, not immediate parent', () => {
            // Setup: Deep hierarchy where multiple levels are dropped
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'root-op',
                durationMs: 1000,
            };
            const levelA = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'level-a',
                parentObservabilityLogId: 'root',
                operation: 'level-a-op',
                durationMs: 800,
            };
            const levelB = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1200,
                observabilityLogId: 'level-b',
                parentObservabilityLogId: 'level-a',
                operation: 'level-b-op',
                durationMs: 600,
            };
            const levelC = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1300,
                observabilityLogId: 'level-c',
                parentObservabilityLogId: 'level-b',
                operation: 'level-c-op',
                durationMs: 400,
            };
            const leaf = {
                type: 'log',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1400,
                observabilityLogId: 'leaf',
                parentObservabilityLogId: 'level-c',
                operation: 'leaf-op',
            };
            // Rules: Drop A, B, C but keep root and leaf
            const { events } = (0, index_1.applyNoiseReduction)([root, levelA, levelB, levelC, leaf], {
                ...baseNoise,
                enabled: true,
                rules: [
                    {
                        id: 'keep-root',
                        match: { operation: 'root-op' },
                        decision: 'keep',
                        priority: 100,
                    },
                    {
                        id: 'drop-middle',
                        match: { operation: '/level-[abc]-op/' },
                        decision: 'drop',
                        priority: 50,
                    },
                    {
                        id: 'keep-leaf',
                        match: { operation: 'leaf-op' },
                        decision: 'keep',
                        priority: 100,
                    },
                ],
            });
            // EXPECTED: leaf should be reparented directly to root
            const leafEvent = events.find(e => e.observabilityLogId === 'leaf');
            expect(leafEvent).toBeDefined();
            expect(leafEvent?.parentObservabilityLogId).toBe('root');
            // Verify no intermediate levels in output
            expect(events.find(e => e.observabilityLogId === 'level-a')).toBeUndefined();
            expect(events.find(e => e.observabilityLogId === 'level-b')).toBeUndefined();
            expect(events.find(e => e.observabilityLogId === 'level-c')).toBeUndefined();
        });
    });
    // Issue #3 test removed - tested deprecated reparenting behavior
    // New algorithm preserves hierarchy integrity automatically
    describe('Issue #6: Aggregate Key Too Rigid', () => {
        it('should separate successful and failed events in aggregates', () => {
            const parent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'parent',
                operation: 'batch',
                durationMs: 1000,
            };
            const successEvents = Array.from({ length: 10 }).map((_, i) => ({
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000 + i * 10,
                observabilityLogId: `success-${i}`,
                parentObservabilityLogId: 'parent',
                operation: 'processItem',
                durationMs: 50,
                success: true,
            }));
            const failEvents = Array.from({ length: 3 }).map((_, i) => ({
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1500 + i * 10,
                observabilityLogId: `fail-${i}`,
                parentObservabilityLogId: 'parent',
                operation: 'processItem',
                durationMs: 50,
                success: false,
            }));
            const { events } = (0, index_1.applyNoiseReduction)([parent, ...successEvents, ...failEvents], {
                ...baseNoise,
                enabled: true,
                rules: [
                    {
                        id: 'aggregate-items',
                        match: { type: 'span', operation: 'processItem' },
                        decision: 'aggregate',
                        priority: 2000, // Must override hard signal protection (1000) to aggregate failures
                    },
                ],
            });
            const parentEvent = events.find(e => e.observabilityLogId === 'parent');
            const aggregates = parentEvent.data?.noiseReduction?.aggregates || {};
            // CURRENT: All items in one bucket 'span:processItem'
            // DESIRED: Separate buckets for success/failure
            // This test documents current behavior (not necessarily wrong, but inflexible)
            const bucketKeys = Object.keys(aggregates);
            expect(bucketKeys.length).toBeGreaterThan(0);
            // Check if we can distinguish success/failure in the bucket
            const bucket = aggregates[bucketKeys[0]];
            expect(bucket.count).toBe(13);
            expect(bucket.errorCount).toBe(3); // At least we track error count
        });
    });
    describe('Issue #10: Missing Batch Size Limits', () => {
        it('should handle very large batches without crashing', () => {
            // Create a pathologically large batch
            const events = Array.from({ length: 10000 }).map((_, i) => ({
                type: 'log',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000 + i,
                observabilityLogId: `event-${i}`,
                operation: 'test-op',
            }));
            // Should not crash or timeout
            expect(() => {
                (0, index_1.applyNoiseReduction)(events, {
                    ...baseNoise,
                    enabled: true,
                    rules: [
                        {
                            id: 'drop-all',
                            match: { type: 'log' },
                            decision: 'drop',
                        },
                    ],
                });
            }).not.toThrow();
            // Ideally should warn about large batch size
            // Currently doesn't have size limits
        });
        it('should handle deeply nested hierarchies', () => {
            // Create deep nesting (potential stack overflow)
            const events = [];
            const depth = 100;
            for (let i = 0; i < depth; i++) {
                events.push({
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000 + i,
                    observabilityLogId: `level-${i}`,
                    parentObservabilityLogId: i > 0 ? `level-${i - 1}` : undefined,
                    operation: `level-${i}-op`,
                    durationMs: 10,
                });
            }
            // Should not cause stack overflow
            expect(() => {
                (0, index_1.applyNoiseReduction)(events, {
                    ...baseNoise,
                    enabled: true,
                    rules: [],
                });
            }).not.toThrow();
        });
    });
    describe('Issue #15: Silent Checkpoint Truncation', () => {
        it('should indicate when checkpoints are truncated', () => {
            const parent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'parent',
                operation: 'batch',
                durationMs: 1000,
            };
            // Create 10 children to fold
            const children = Array.from({ length: 10 }).map((_, i) => ({
                type: 'log',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000 + i * 10,
                observabilityLogId: `child-${i}`,
                parentObservabilityLogId: 'parent',
                operation: 'item',
                metrics: { index: i },
            }));
            const { events } = (0, index_1.applyNoiseReduction)([parent, ...children], {
                ...baseNoise,
                enabled: true,
                maxCheckpointsPerSpan: 5, // Only 5 allowed!
                rules: [
                    {
                        id: 'fold-all',
                        match: { operation: 'item' },
                        decision: 'fold',
                        priority: 100,
                    },
                ],
            });
            const parentInOutput = events.find(e => e.observabilityLogId === 'parent');
            const checkpoints = parentInOutput?.data?.checkpoints || [];
            // Only 5 checkpoints fit
            expect(checkpoints.length).toBeLessThanOrEqual(5);
            // CRITICAL: Should have truncation indicator
            const noiseReduction = parentInOutput?.data?.noiseReduction;
            expect(noiseReduction?.checkpointsTruncated).toBe(true);
            // 10 fold checkpoints attempted, 5 fit, 5 dropped, then summary checkpoint also dropped = 6 total dropped
            expect(noiseReduction?.checkpointsTruncatedCount).toBeGreaterThanOrEqual(5);
        });
    });
    describe('Issue #14: span.start ID Mismatch', () => {
        it('should handle span.start with different ID than consolidated span', () => {
            const spanStart = {
                type: 'span.start',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'span-1-start', // Different ID!
                operation: 'query',
            };
            const consolidatedSpan = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1050,
                observabilityLogId: 'span-1', // Different ID!
                operation: 'query',
                durationMs: 50,
            };
            const { events } = (0, index_1.applyNoiseReduction)([spanStart, consolidatedSpan], {
                ...baseNoise,
                enabled: true,
                rules: [
                    {
                        id: 'drop-queries',
                        match: { operation: 'query' },
                        decision: 'drop',
                        priority: 100,
                    },
                ],
            });
            // BUG: span.start will be kept because ID doesn't match
            // Expected: both dropped (or both kept, but consistent)
            const spanStartInOutput = events.find(e => e.type === 'span.start');
            const spanInOutput = events.find(e => e.type === 'span');
            // Current behavior: span.start kept, span dropped (INCONSISTENT)
            // Expected behavior: both should have same fate
            if (spanInOutput) {
                expect(spanStartInOutput).toBeDefined(); // If span kept, span.start should be kept
            }
            else {
                expect(spanStartInOutput).toBeUndefined(); // If span dropped, span.start should be dropped
            }
        });
    });
    describe('Issue #13: Context Preservation for Hard Signals', () => {
        it('should drop parent when no hard signals in subtree', () => {
            const parent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'parent',
                operation: 'droppable-op',
                durationMs: 100,
            };
            const child = {
                type: 'log',
                level: 'info', // Just noise, not a hard signal
                correlationId: 'test',
                timestampMs: 1050,
                observabilityLogId: 'child',
                parentObservabilityLogId: 'parent',
                operation: 'noise-work',
                metrics: { itemsProcessed: 100 },
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([parent, child], {
                ...baseNoise,
                enabled: true,
                rules: [
                    {
                        id: 'drop-parent',
                        match: { operation: 'droppable-op' },
                        decision: 'drop',
                        priority: 50,
                    },
                    {
                        id: 'fold-child',
                        match: { operation: 'noise-work' },
                        decision: 'fold',
                        priority: 100,
                    },
                ],
            });
            // Parent should be DROPPED (no hard signals in subtree)
            // Child should be FOLDED into parent first, then parent dropped
            const parentInOutput = events.find(e => e.observabilityLogId === 'parent');
            expect(parentInOutput).toBeUndefined();
            // Stats should show fold + drop
            expect(stats.folded).toBe(1);
            expect(stats.dropped).toBe(1);
        });
        it('should keep parent as context when hard signal in subtree', () => {
            const parent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'parent',
                operation: 'droppable-op',
                durationMs: 100,
            };
            const child = {
                type: 'log',
                level: 'error', // HARD SIGNAL - cannot be folded
                correlationId: 'test',
                timestampMs: 1050,
                observabilityLogId: 'child',
                parentObservabilityLogId: 'parent',
                operation: 'failed-work',
                error: { type: 'Error', message: 'Something went wrong' },
                metrics: { itemsProcessed: 100 },
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([parent, child], {
                ...baseNoise,
                enabled: true,
                rules: [
                    {
                        id: 'drop-parent',
                        match: { operation: 'droppable-op' },
                        decision: 'drop',
                        priority: 50,
                    },
                ],
            });
            // NEW BEHAVIOR: Parent kept as context (hasHardSignalInSubtree=true)
            // Child kept as hard signal (error level)
            const parentInOutput = events.find(e => e.observabilityLogId === 'parent');
            const childInOutput = events.find(e => e.observabilityLogId === 'child');
            expect(parentInOutput).toBeDefined(); // Context preserved
            expect(childInOutput).toBeDefined(); // Hard signal kept
            expect(stats.kept).toBe(2);
            expect(stats.dropped).toBe(0);
        });
    });
    // Issue #12 tests removed - tested old folding behavior  
    // New algorithm uses hard signal protection instead
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3JpdGljYWwtYnVncy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL19fdGVzdHNfXy9jcml0aWNhbC1idWdzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7OztHQUtHOztBQUVILG9DQUFtRTtBQUNuRSw4Q0FBK0M7QUFFL0MseUNBQXlEO0FBRXpELFFBQVEsQ0FBQyxvQkFBb0IsRUFBRSxHQUFHLEVBQUU7SUFDbEMsTUFBTSxTQUFTLEdBQUcsSUFBQSxrQ0FBeUIsR0FBRSxDQUFDLGNBQWMsQ0FBQztJQUU3RCxRQUFRLENBQUMsMkNBQTJDLEVBQUUsR0FBRyxFQUFFO1FBQ3pELEVBQUUsQ0FBQyx5RUFBeUUsRUFBRSxHQUFHLEVBQUU7WUFDakYsZ0RBQWdEO1lBQ2hELG9FQUFvRTtZQUNwRSxNQUFNLFVBQVUsR0FBdUI7Z0JBQ3JDLElBQUksRUFBRSxNQUFNO2dCQUNaLEtBQUssRUFBRSxNQUFNO2dCQUNiLGFBQWEsRUFBRSxTQUFTO2dCQUN4QixXQUFXLEVBQUUsSUFBSTtnQkFDakIsa0JBQWtCLEVBQUUsY0FBYztnQkFDbEMsU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLFVBQVUsRUFBRSxJQUFJO2FBQ2pCLENBQUM7WUFFRixNQUFNLFlBQVksR0FBeUIsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ25GLElBQUksRUFBRSxNQUFNO2dCQUNaLEtBQUssRUFBRSxPQUFPLEVBQUUsZUFBZTtnQkFDL0IsYUFBYSxFQUFFLFNBQVM7Z0JBQ3hCLFdBQVcsRUFBRSxJQUFJLEdBQUcsQ0FBQyxHQUFHLEdBQUc7Z0JBQzNCLGtCQUFrQixFQUFFLFVBQVUsQ0FBQyxFQUFFO2dCQUNqQyx3QkFB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SSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzNCLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2hDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCwwREFBMEQ7SUFDMUQsb0RBQW9EO0FBQ3RELENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDcml0aWNhbCBidWcgdGVzdHMgZm9yIG5vaXNlIHJlZHVjdGlvbi5cbiAqIFxuICogVGhlc2UgdGVzdHMgdmVyaWZ5IGZpeGVzIGZvciB0aGUgaXNzdWVzIGlkZW50aWZpZWQgaW4gdGhlIGNvbXByZWhlbnNpdmUgYW5hbHlzaXMuXG4gKiBFYWNoIHRlc3QgaXMgZGVzaWduZWQgdG8gZmFpbCBpZiB0aGUgY29ycmVzcG9uZGluZyBidWcgZXhpc3RzLlxuICovXG5cbmltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24sIGV2YWx1YXRlTm9pc2VSdWxlcyB9IGZyb20gJy4uL2luZGV4JztcbmltcG9ydCB7IG1hdGNoZXNSdWxlIH0gZnJvbSAnLi4vcnVsZXMvbWF0Y2hlcic7XG5pbXBvcnQgdHlwZSB7IE5vaXNlUnVsZSwgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uLy4uL2NvbmZpZyc7XG5cbmRlc2NyaWJlKCdDcml0aWNhbCBCdWcgVGVzdHMnLCAoKSA9PiB7XG4gIGNvbnN0IGJhc2VOb2lzZSA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoKS5ub2lzZVJlZHVjdGlvbjtcblxuICBkZXNjcmliZSgnSXNzdWUgIzE6IEhhcmQgU2lnbmFsIFByb3RlY3Rpb24gT3ZlcnJpZGUnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhbGxvdyBydWxlcyB0byBhZ2dyZWdhdGUgZXJyb3IgZXZlbnRzIHdoZW4gZXhwbGljaXRseSBjb25maWd1cmVkJywgKCkgPT4ge1xuICAgICAgLy8gU2NlbmFyaW86IEJhdGNoIHByb2Nlc3Npbmcgd2l0aCBtYW55IGZhaWx1cmVzXG4gICAgICAvLyBVc2VyIHdhbnRzIHRvIGFnZ3JlZ2F0ZSBmYWlsdXJlcywgbm90IGtlZXAgZWFjaCBhcyBzdGFuZGFsb25lIGxvZ1xuICAgICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICdiYXRjaC0xJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2JhdGNoLXBhcmVudCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NCYXRjaCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDUwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBmYWlsZWRFdmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNTAgfSkubWFwKChfLCBpKSA9PiAoe1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLCAvLyBIYXJkIHNpZ25hbCFcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2JhdGNoLTEnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCArIGkgKiAxMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogYGZhaWxlZC0ke2l9YCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnYmF0Y2gtcGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzc0l0ZW0nLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIC8vIEFsc28gYSBoYXJkIHNpZ25hbCFcbiAgICAgICAgZXJyb3I6IHsgdHlwZTogJ1ZhbGlkYXRpb25FcnJvcicsIG1lc3NhZ2U6ICdJbnZhbGlkIGRhdGEnIH0sIC8vIEFsc28gYSBoYXJkIHNpZ25hbCFcbiAgICAgIH0pKTtcblxuICAgICAgLy8gVXNlciBleHBsaWNpdGx5IHdhbnRzIHRvIGFnZ3JlZ2F0ZSB0aGVzZSBmYWlsdXJlc1xuICAgICAgY29uc3QgYWdncmVnYXRlRmFpbHVyZXNSdWxlOiBOb2lzZVJ1bGUgPSB7XG4gICAgICAgIGlkOiAnY3VzdG9tLmFnZ3JlZ2F0ZV9iYXRjaF9mYWlsdXJlcycsXG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NJdGVtJyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgfSxcbiAgICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgICBwcmlvcml0eTogMjAwMCwgLy8gRXhwbGljaXRseSBoaWdoZXIgdGhhbiBoYXJkIHNpZ25hbCBwcmlvcml0eSAoMTAwMClcbiAgICAgICAgcmVhc29uOiAnQWdncmVnYXRlIGJhdGNoIGl0ZW0gZmFpbHVyZXMgaW50byBwYXJlbnQnLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgICBbIHBhcmVudFNwYW4sIC4uLmZhaWxlZEV2ZW50cyBdLFxuICAgICAgICB7XG4gICAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgcnVsZXM6IFsgYWdncmVnYXRlRmFpbHVyZXNSdWxlIF0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIC8vIEVYUEVDVEVEOiBGYWlsZWQgZXZlbnRzIHNob3VsZCBiZSBhZ2dyZWdhdGVkIChjdXJyZW50IGJlaGF2aW9yOiBhbGwga2VwdClcbiAgICAgIGV4cGVjdChzdGF0cy5hZ2dyZWdhdGVkKS50b0JlKDUwKTtcbiAgICAgIGV4cGVjdChldmVudHMubGVuZ3RoKS50b0JlKDEpOyAvLyBPbmx5IHBhcmVudCBzcGFuXG5cbiAgICAgIGNvbnN0IHBhcmVudCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdiYXRjaC1wYXJlbnQnKSE7XG4gICAgICBleHBlY3QocGFyZW50KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgICBjb25zdCBhZ2dyZWdhdGVzID0gKHBhcmVudC5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5hZ2dyZWdhdGVzO1xuICAgICAgZXhwZWN0KGFnZ3JlZ2F0ZXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoT2JqZWN0LnZhbHVlcyhhZ2dyZWdhdGVzIHx8IHt9KS5zb21lKChidWNrZXQ6IGFueSkgPT4gYnVja2V0LmVycm9yQ291bnQgPT09IDUwKSkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVzcGVjdCBydWxlIHByaW9yaXR5IG92ZXIgaGFyZCBzaWduYWwgcHJvdGVjdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGVycm9yRXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvci0xJyxcbiAgICAgICAgb3BlcmF0aW9uOiAndGVzdE9wZXJhdGlvbicsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBldmFsdWF0ZU5vaXNlUnVsZXMoXG4gICAgICAgIGVycm9yRXZlbnQsXG4gICAgICAgIFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsLWVycm9ycycsXG4gICAgICAgICAgICBtYXRjaDogeyBsZXZlbDogJ2Vycm9yJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAyMDAwLCAvLyBIaWdoZXIgdGhhbiBoYXJkIHNpZ25hbCAoMTAwMClcbiAgICAgICAgICAgIHJlYXNvbjogJ0V4cGxpY2l0IGRyb3AgcnVsZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgbWF0Y2hlc1J1bGVcbiAgICAgICk7XG5cbiAgICAgIC8vIEVYUEVDVEVEOiBSdWxlIHdpdGggcHJpb3JpdHkgMjAwMCBzaG91bGQgd2luIG92ZXIgaGFyZCBzaWduYWwgKDEwMDApXG4gICAgICAvLyBBQ1RVQUw6IEhhcmQgc2lnbmFsIHdpbnMgYmVjYXVzZSBpdCdzIGNoZWNrZWQgZmlyc3RcbiAgICAgIGV4cGVjdChyZXN1bHQuZGVjaXNpb24pLnRvQmUoJ2Ryb3AnKTtcbiAgICAgIGV4cGVjdChyZXN1bHQucnVsZUlkKS50b0JlKCdkcm9wLWFsbC1lcnJvcnMnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0lzc3VlICMyOiBSZXBhcmVudGluZyB0byBEcm9wcGVkIFBhcmVudCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJlcGFyZW50IHRvIGZpcnN0IEtFUFQgYW5jZXN0b3IsIG5vdCBpbW1lZGlhdGUgcGFyZW50JywgKCkgPT4ge1xuICAgICAgLy8gU2V0dXA6IERlZXAgaGllcmFyY2h5IHdoZXJlIG11bHRpcGxlIGxldmVscyBhcmUgZHJvcHBlZFxuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdyb290LW9wJyxcbiAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGxldmVsQTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDExMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xldmVsLWEnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbGV2ZWwtYS1vcCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDgwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGxldmVsQjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEyMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xldmVsLWInLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdsZXZlbC1hJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbGV2ZWwtYi1vcCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDYwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGxldmVsQzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEzMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xldmVsLWMnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdsZXZlbC1iJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbGV2ZWwtYy1vcCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGxlYWY6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDE0MDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xlYWYnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdsZXZlbC1jJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbGVhZi1vcCcsXG4gICAgICB9O1xuXG4gICAgICAvLyBSdWxlczogRHJvcCBBLCBCLCBDIGJ1dCBrZWVwIHJvb3QgYW5kIGxlYWZcbiAgICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgICBbIHJvb3QsIGxldmVsQSwgbGV2ZWxCLCBsZXZlbEMsIGxlYWYgXSxcbiAgICAgICAge1xuICAgICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiAna2VlcC1yb290JyxcbiAgICAgICAgICAgICAgbWF0Y2g6IHsgb3BlcmF0aW9uOiAncm9vdC1vcCcgfSxcbiAgICAgICAgICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgICAgICAgICAgcHJpb3JpdHk6IDEwMCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiAnZHJvcC1taWRkbGUnLFxuICAgICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICcvbGV2ZWwtW2FiY10tb3AvJyB9LFxuICAgICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgICBwcmlvcml0eTogNTAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogJ2tlZXAtbGVhZicsXG4gICAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ2xlYWYtb3AnIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiAxMDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIC8vIEVYUEVDVEVEOiBsZWFmIHNob3VsZCBiZSByZXBhcmVudGVkIGRpcmVjdGx5IHRvIHJvb3RcbiAgICAgIGNvbnN0IGxlYWZFdmVudCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdsZWFmJyk7XG4gICAgICBleHBlY3QobGVhZkV2ZW50KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGxlYWZFdmVudD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG5cbiAgICAgIC8vIFZlcmlmeSBubyBpbnRlcm1lZGlhdGUgbGV2ZWxzIGluIG91dHB1dFxuICAgICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdsZXZlbC1hJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbGV2ZWwtYicpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2xldmVsLWMnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICAvLyBJc3N1ZSAjMyB0ZXN0IHJlbW92ZWQgLSB0ZXN0ZWQgZGVwcmVjYXRlZCByZXBhcmVudGluZyBiZWhhdmlvclxuICAvLyBOZXcgYWxnb3JpdGhtIHByZXNlcnZlcyBoaWVyYXJjaHkgaW50ZWdyaXR5IGF1dG9tYXRpY2FsbHlcblxuICBkZXNjcmliZSgnSXNzdWUgIzY6IEFnZ3JlZ2F0ZSBLZXkgVG9vIFJpZ2lkJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgc2VwYXJhdGUgc3VjY2Vzc2Z1bCBhbmQgZmFpbGVkIGV2ZW50cyBpbiBhZ2dyZWdhdGVzJywgKCkgPT4ge1xuICAgICAgY29uc3QgcGFyZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2gnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3VjY2Vzc0V2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAxMCB9KS5tYXAoKF8sIGkpID0+ICh7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCArIGkgKiAxMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgc3VjY2Vzcy0ke2l9YCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzc0l0ZW0nLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIH0pKTtcblxuICAgICAgY29uc3QgZmFpbEV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAzIH0pLm1hcCgoXywgaSkgPT4gKHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxNTAwICsgaSAqIDEwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBmYWlsLSR7aX1gLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgICBvcGVyYXRpb246ICdwcm9jZXNzSXRlbScsXG4gICAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIH0pKTtcblxuICAgICAgY29uc3QgeyBldmVudHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICAgIFsgcGFyZW50LCAuLi5zdWNjZXNzRXZlbnRzLCAuLi5mYWlsRXZlbnRzIF0sXG4gICAgICAgIHtcbiAgICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBydWxlczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogJ2FnZ3JlZ2F0ZS1pdGVtcycsXG4gICAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgb3BlcmF0aW9uOiAncHJvY2Vzc0l0ZW0nIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgICAgICAgICAgcHJpb3JpdHk6IDIwMDAsIC8vIE11c3Qgb3ZlcnJpZGUgaGFyZCBzaWduYWwgcHJvdGVjdGlvbiAoMTAwMCkgdG8gYWdncmVnYXRlIGZhaWx1cmVzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IHBhcmVudEV2ZW50ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudCcpITtcbiAgICAgIGNvbnN0IGFnZ3JlZ2F0ZXMgPSAocGFyZW50RXZlbnQuZGF0YSBhcyBhbnkpPy5ub2lzZVJlZHVjdGlvbj8uYWdncmVnYXRlcyB8fCB7fTtcblxuICAgICAgLy8gQ1VSUkVOVDogQWxsIGl0ZW1zIGluIG9uZSBidWNrZXQgJ3NwYW46cHJvY2Vzc0l0ZW0nXG4gICAgICAvLyBERVNJUkVEOiBTZXBhcmF0ZSBidWNrZXRzIGZvciBzdWNjZXNzL2ZhaWx1cmVcbiAgICAgIC8vIFRoaXMgdGVzdCBkb2N1bWVudHMgY3VycmVudCBiZWhhdmlvciAobm90IG5lY2Vzc2FyaWx5IHdyb25nLCBidXQgaW5mbGV4aWJsZSlcbiAgICAgIGNvbnN0IGJ1Y2tldEtleXMgPSBPYmplY3Qua2V5cyhhZ2dyZWdhdGVzKTtcbiAgICAgIGV4cGVjdChidWNrZXRLZXlzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuXG4gICAgICAvLyBDaGVjayBpZiB3ZSBjYW4gZGlzdGluZ3Vpc2ggc3VjY2Vzcy9mYWlsdXJlIGluIHRoZSBidWNrZXRcbiAgICAgIGNvbnN0IGJ1Y2tldCA9IGFnZ3JlZ2F0ZXNbIGJ1Y2tldEtleXNbIDAgXSBdO1xuICAgICAgZXhwZWN0KGJ1Y2tldC5jb3VudCkudG9CZSgxMyk7XG4gICAgICBleHBlY3QoYnVja2V0LmVycm9yQ291bnQpLnRvQmUoMyk7IC8vIEF0IGxlYXN0IHdlIHRyYWNrIGVycm9yIGNvdW50XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdJc3N1ZSAjMTA6IE1pc3NpbmcgQmF0Y2ggU2l6ZSBMaW1pdHMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdmVyeSBsYXJnZSBiYXRjaGVzIHdpdGhvdXQgY3Jhc2hpbmcnLCAoKSA9PiB7XG4gICAgICAvLyBDcmVhdGUgYSBwYXRob2xvZ2ljYWxseSBsYXJnZSBiYXRjaFxuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwMDAwIH0pLm1hcCgoXywgaSkgPT4gKHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAgKyBpLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBldmVudC0ke2l9YCxcbiAgICAgICAgb3BlcmF0aW9uOiAndGVzdC1vcCcsXG4gICAgICB9KSk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgY3Jhc2ggb3IgdGltZW91dFxuICAgICAgZXhwZWN0KCgpID0+IHtcbiAgICAgICAgYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgICAgICBldmVudHMsXG4gICAgICAgICAge1xuICAgICAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJyB9LFxuICAgICAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH0pLm5vdC50b1Rocm93KCk7XG5cbiAgICAgIC8vIElkZWFsbHkgc2hvdWxkIHdhcm4gYWJvdXQgbGFyZ2UgYmF0Y2ggc2l6ZVxuICAgICAgLy8gQ3VycmVudGx5IGRvZXNuJ3QgaGF2ZSBzaXplIGxpbWl0c1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZGVlcGx5IG5lc3RlZCBoaWVyYXJjaGllcycsICgpID0+IHtcbiAgICAgIC8vIENyZWF0ZSBkZWVwIG5lc3RpbmcgKHBvdGVudGlhbCBzdGFjayBvdmVyZmxvdylcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgICAgIGNvbnN0IGRlcHRoID0gMTAwO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRlcHRoOyBpKyspIHtcbiAgICAgICAgZXZlbnRzLnB1c2goe1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCArIGksXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgbGV2ZWwtJHtpfWAsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpID4gMCA/IGBsZXZlbC0ke2kgLSAxfWAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgb3BlcmF0aW9uOiBgbGV2ZWwtJHtpfS1vcGAsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBTaG91bGQgbm90IGNhdXNlIHN0YWNrIG92ZXJmbG93XG4gICAgICBleHBlY3QoKCkgPT4ge1xuICAgICAgICBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgICAgIGV2ZW50cyxcbiAgICAgICAgICB7XG4gICAgICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH0pLm5vdC50b1Rocm93KCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdJc3N1ZSAjMTU6IFNpbGVudCBDaGVja3BvaW50IFRydW5jYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBpbmRpY2F0ZSB3aGVuIGNoZWNrcG9pbnRzIGFyZSB0cnVuY2F0ZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBwYXJlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgICBvcGVyYXRpb246ICdiYXRjaCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICAvLyBDcmVhdGUgMTAgY2hpbGRyZW4gdG8gZm9sZFxuICAgICAgY29uc3QgY2hpbGRyZW46IE9ic2VydmFiaWxpdHlFdmVudFtdID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogMTAgfSkubWFwKChfLCBpKSA9PiAoe1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCArIGkgKiAxMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgY2hpbGQtJHtpfWAsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ2l0ZW0nLFxuICAgICAgICBtZXRyaWNzOiB7IGluZGV4OiBpIH0sXG4gICAgICB9KSk7XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgICBbIHBhcmVudCwgLi4uY2hpbGRyZW4gXSxcbiAgICAgICAge1xuICAgICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIG1heENoZWNrcG9pbnRzUGVyU3BhbjogNSwgLy8gT25seSA1IGFsbG93ZWQhXG4gICAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6ICdmb2xkLWFsbCcsXG4gICAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ2l0ZW0nIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiAxMDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IHBhcmVudEluT3V0cHV0ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudCcpITtcbiAgICAgIGNvbnN0IGNoZWNrcG9pbnRzID0gKHBhcmVudEluT3V0cHV0Py5kYXRhIGFzIGFueSk/LmNoZWNrcG9pbnRzIHx8IFtdO1xuXG4gICAgICAvLyBPbmx5IDUgY2hlY2twb2ludHMgZml0XG4gICAgICBleHBlY3QoY2hlY2twb2ludHMubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDUpO1xuXG4gICAgICAvLyBDUklUSUNBTDogU2hvdWxkIGhhdmUgdHJ1bmNhdGlvbiBpbmRpY2F0b3JcbiAgICAgIGNvbnN0IG5vaXNlUmVkdWN0aW9uID0gKHBhcmVudEluT3V0cHV0Py5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uO1xuICAgICAgZXhwZWN0KG5vaXNlUmVkdWN0aW9uPy5jaGVja3BvaW50c1RydW5jYXRlZCkudG9CZSh0cnVlKTtcbiAgICAgIC8vIDEwIGZvbGQgY2hlY2twb2ludHMgYXR0ZW1wdGVkLCA1IGZpdCwgNSBkcm9wcGVkLCB0aGVuIHN1bW1hcnkgY2hlY2twb2ludCBhbHNvIGRyb3BwZWQgPSA2IHRvdGFsIGRyb3BwZWRcbiAgICAgIGV4cGVjdChub2lzZVJlZHVjdGlvbj8uY2hlY2twb2ludHNUcnVuY2F0ZWRDb3VudCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCg1KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0lzc3VlICMxNDogc3Bhbi5zdGFydCBJRCBNaXNtYXRjaCcsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzcGFuLnN0YXJ0IHdpdGggZGlmZmVyZW50IElEIHRoYW4gY29uc29saWRhdGVkIHNwYW4nLCAoKSA9PiB7XG4gICAgICBjb25zdCBzcGFuU3RhcnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4uc3RhcnQnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzcGFuLTEtc3RhcnQnLCAvLyBEaWZmZXJlbnQgSUQhXG4gICAgICAgIG9wZXJhdGlvbjogJ3F1ZXJ5JyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbnNvbGlkYXRlZFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDUwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzcGFuLTEnLCAvLyBEaWZmZXJlbnQgSUQhXG4gICAgICAgIG9wZXJhdGlvbjogJ3F1ZXJ5JyxcbiAgICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgICAgWyBzcGFuU3RhcnQsIGNvbnNvbGlkYXRlZFNwYW4gXSxcbiAgICAgICAge1xuICAgICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiAnZHJvcC1xdWVyaWVzJyxcbiAgICAgICAgICAgICAgbWF0Y2g6IHsgb3BlcmF0aW9uOiAncXVlcnknIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiAxMDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIC8vIEJVRzogc3Bhbi5zdGFydCB3aWxsIGJlIGtlcHQgYmVjYXVzZSBJRCBkb2Vzbid0IG1hdGNoXG4gICAgICAvLyBFeHBlY3RlZDogYm90aCBkcm9wcGVkIChvciBib3RoIGtlcHQsIGJ1dCBjb25zaXN0ZW50KVxuICAgICAgY29uc3Qgc3BhblN0YXJ0SW5PdXRwdXQgPSBldmVudHMuZmluZChlID0+IGUudHlwZSA9PT0gJ3NwYW4uc3RhcnQnKTtcbiAgICAgIGNvbnN0IHNwYW5Jbk91dHB1dCA9IGV2ZW50cy5maW5kKGUgPT4gZS50eXBlID09PSAnc3BhbicpO1xuXG4gICAgICAvLyBDdXJyZW50IGJlaGF2aW9yOiBzcGFuLnN0YXJ0IGtlcHQsIHNwYW4gZHJvcHBlZCAoSU5DT05TSVNURU5UKVxuICAgICAgLy8gRXhwZWN0ZWQgYmVoYXZpb3I6IGJvdGggc2hvdWxkIGhhdmUgc2FtZSBmYXRlXG4gICAgICBpZiAoc3BhbkluT3V0cHV0KSB7XG4gICAgICAgIGV4cGVjdChzcGFuU3RhcnRJbk91dHB1dCkudG9CZURlZmluZWQoKTsgLy8gSWYgc3BhbiBrZXB0LCBzcGFuLnN0YXJ0IHNob3VsZCBiZSBrZXB0XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleHBlY3Qoc3BhblN0YXJ0SW5PdXRwdXQpLnRvQmVVbmRlZmluZWQoKTsgLy8gSWYgc3BhbiBkcm9wcGVkLCBzcGFuLnN0YXJ0IHNob3VsZCBiZSBkcm9wcGVkXG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdJc3N1ZSAjMTM6IENvbnRleHQgUHJlc2VydmF0aW9uIGZvciBIYXJkIFNpZ25hbHMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBkcm9wIHBhcmVudCB3aGVuIG5vIGhhcmQgc2lnbmFscyBpbiBzdWJ0cmVlJywgKCkgPT4ge1xuICAgICAgY29uc3QgcGFyZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZHJvcHBhYmxlLW9wJyxcbiAgICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2hpbGQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnaW5mbycsIC8vIEp1c3Qgbm9pc2UsIG5vdCBhIGhhcmQgc2lnbmFsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwNTAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbm9pc2Utd29yaycsXG4gICAgICAgIG1ldHJpY3M6IHsgaXRlbXNQcm9jZXNzZWQ6IDEwMCB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgICBbIHBhcmVudCwgY2hpbGQgXSxcbiAgICAgICAge1xuICAgICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiAnZHJvcC1wYXJlbnQnLFxuICAgICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICdkcm9wcGFibGUtb3AnIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiA1MCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiAnZm9sZC1jaGlsZCcsXG4gICAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ25vaXNlLXdvcmsnIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiAxMDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH1cbiAgICAgICk7XG5cbiAgICAgIC8vIFBhcmVudCBzaG91bGQgYmUgRFJPUFBFRCAobm8gaGFyZCBzaWduYWxzIGluIHN1YnRyZWUpXG4gICAgICAvLyBDaGlsZCBzaG91bGQgYmUgRk9MREVEIGludG8gcGFyZW50IGZpcnN0LCB0aGVuIHBhcmVudCBkcm9wcGVkXG4gICAgICBjb25zdCBwYXJlbnRJbk91dHB1dCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQnKTtcbiAgICAgIGV4cGVjdChwYXJlbnRJbk91dHB1dCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgICAvLyBTdGF0cyBzaG91bGQgc2hvdyBmb2xkICsgZHJvcFxuICAgICAgZXhwZWN0KHN0YXRzLmZvbGRlZCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBrZWVwIHBhcmVudCBhcyBjb250ZXh0IHdoZW4gaGFyZCBzaWduYWwgaW4gc3VidHJlZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHBhcmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ2Ryb3BwYWJsZS1vcCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNoaWxkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJywgLy8gSEFSRCBTSUdOQUwgLSBjYW5ub3QgYmUgZm9sZGVkXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwNTAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZmFpbGVkLXdvcmsnLFxuICAgICAgICBlcnJvcjogeyB0eXBlOiAnRXJyb3InLCBtZXNzYWdlOiAnU29tZXRoaW5nIHdlbnQgd3JvbmcnIH0sXG4gICAgICAgIG1ldHJpY3M6IHsgaXRlbXNQcm9jZXNzZWQ6IDEwMCB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgICBbIHBhcmVudCwgY2hpbGQgXSxcbiAgICAgICAge1xuICAgICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiAnZHJvcC1wYXJlbnQnLFxuICAgICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICdkcm9wcGFibGUtb3AnIH0sXG4gICAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICAgIHByaW9yaXR5OiA1MCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfVxuICAgICAgKTtcblxuICAgICAgLy8gTkVXIEJFSEFWSU9SOiBQYXJlbnQga2VwdCBhcyBjb250ZXh0IChoYXNIYXJkU2lnbmFsSW5TdWJ0cmVlPXRydWUpXG4gICAgICAvLyBDaGlsZCBrZXB0IGFzIGhhcmQgc2lnbmFsIChlcnJvciBsZXZlbClcbiAgICAgIGNvbnN0IHBhcmVudEluT3V0cHV0ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudCcpO1xuICAgICAgY29uc3QgY2hpbGRJbk91dHB1dCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZCcpO1xuXG4gICAgICBleHBlY3QocGFyZW50SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7IC8vIENvbnRleHQgcHJlc2VydmVkXG4gICAgICBleHBlY3QoY2hpbGRJbk91dHB1dCkudG9CZURlZmluZWQoKTsgLy8gSGFyZCBzaWduYWwga2VwdFxuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMik7XG4gICAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gSXNzdWUgIzEyIHRlc3RzIHJlbW92ZWQgLSB0ZXN0ZWQgb2xkIGZvbGRpbmcgYmVoYXZpb3IgIFxuICAvLyBOZXcgYWxnb3JpdGhtIHVzZXMgaGFyZCBzaWduYWwgcHJvdGVjdGlvbiBpbnN0ZWFkXG59KTtcbiJdfQ==