"use strict";
/**
 * Comprehensive Edge Case Tests
 *
 * Tests for scenarios that might break the implementation:
 * - Empty inputs
 * - Single nodes
 * - Very deep trees
 * - Circular references (should be prevented by tree builder)
 * - All nodes dropped
 * - All nodes kept
 * - Mixed levels and decisions
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const types_1 = require("../../types");
const baseConfig = {
    enabled: true,
    minLevel: types_1.ObservabilityLevel.INFO,
    hardSignals: {
        levels: ['error', 'critical'],
        slowThresholdMs: 5000,
    },
    presets: [],
    rules: [],
    emitSummaries: false,
    maxCheckpointsPerSpan: 500,
    maxAggregateKeysPerSpan: 200,
    maxAggregateExamplesPerKey: 5,
    maxAggregateErrorExamplesPerKey: 3,
    includeDebugMetadata: false,
    includeExamples: false,
};
describe('Edge Cases - Comprehensive', () => {
    describe('Empty and Minimal Inputs', () => {
        it('should handle empty input array', () => {
            const { events, stats } = (0, index_1.applyNoiseReduction)([], baseConfig);
            expect(events).toHaveLength(0);
            expect(stats.kept).toBe(0);
            expect(stats.dropped).toBe(0);
            expect(stats.folded).toBe(0);
        });
        it('should handle single event (root)', () => {
            const event = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'single',
                operation: 'test',
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([event], baseConfig);
            expect(events).toHaveLength(1);
            expect(stats.kept).toBe(1);
        });
        it('should handle single error event', () => {
            const event = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'error',
                operation: 'failed',
            };
            const { events } = (0, index_1.applyNoiseReduction)([event], baseConfig);
            expect(events).toHaveLength(1);
            expect(events[0].level).toBe('error');
        });
    });
    describe('Deep Tree Hierarchies', () => {
        it('should handle 10-level deep tree with error at bottom', () => {
            const events = [];
            // Create 10-level chain
            for (let i = 0; i < 10; i++) {
                events.push({
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000 + i * 10,
                    observabilityLogId: `level-${i}`,
                    parentObservabilityLogId: i === 0 ? undefined : `level-${i - 1}`,
                    operation: `Op level ${i}`,
                    durationMs: 100,
                });
            }
            // Add error at bottom
            events.push({
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'deep-error',
                parentObservabilityLogId: 'level-9',
                operation: 'Error at depth 10',
            });
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-spans',
                        match: { type: 'span' },
                        decision: 'drop',
                        reason: 'Drop spans',
                    },
                ],
            };
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // All spans should be kept as context (or folded), error kept
            expect(output.length).toBeGreaterThan(0);
            expect(output.find(e => e.observabilityLogId === 'deep-error')).toBeDefined();
            expect(output.find(e => e.observabilityLogId === 'level-0')).toBeDefined();
        });
        it('should handle wide tree (100 siblings)', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 1000,
            };
            const children = [];
            for (let i = 0; i < 100; i++) {
                children.push({
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000 + i,
                    observabilityLogId: `child-${i}`,
                    parentObservabilityLogId: 'root',
                    operation: `Item ${i}`,
                    durationMs: 10,
                    success: true, // All successful by default
                });
            }
            // One child has error - this is a HARD SIGNAL
            children[50].level = 'error';
            children[50].success = false;
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'aggregate-items',
                        match: { operation: '/^Item/', success: true },
                        decision: 'aggregate',
                        reason: 'Aggregate successful items',
                    },
                ],
            };
            const { events: output, stats } = (0, index_1.applyNoiseReduction)([root, ...children], config);
            // Expected behavior:
            // - Root: no rule matches -> KEEP
            // - 99 children with success=true: aggregate rule matches -> AGGREGATE into root
            // - child-50 with error: HARD SIGNAL -> KEEP (protected from aggregation)
            expect(output).toHaveLength(2); // root + child-50
            expect(stats.kept).toBe(2); // root + child-50
            expect(stats.aggregated).toBe(99); // all successful children
            // Verify outputs are correct
            const rootOut = output.find(e => e.observabilityLogId === 'root');
            const errorOut = output.find(e => e.observabilityLogId === 'child-50');
            expect(rootOut).toBeDefined();
            expect(errorOut).toBeDefined();
            expect(errorOut.level).toBe('error');
        });
    });
    describe('All Nodes Same Decision', () => {
        it('should handle all nodes dropped (no hard signals)', () => {
            const events = [
                {
                    type: 'span',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'test',
                    durationMs: 100,
                },
                {
                    type: 'log',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'log1',
                    parentObservabilityLogId: 'root',
                    operation: 'debug log',
                },
            ];
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.INFO, // Both are DEBUG < INFO
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop all',
                    },
                ],
            };
            const { events: output, stats } = (0, index_1.applyNoiseReduction)(events, config);
            expect(output).toHaveLength(0);
            expect(stats.dropped).toBe(2);
        });
        it('should handle all nodes kept', () => {
            const events = [
                {
                    type: 'span',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'test',
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'log1',
                    parentObservabilityLogId: 'root',
                    operation: 'error log',
                },
            ];
            const { events: output, stats } = (0, index_1.applyNoiseReduction)(events, baseConfig);
            expect(output).toHaveLength(2);
            expect(stats.kept).toBe(2);
        });
    });
    describe('Explicit Overrides', () => {
        it('should respect capture.noise override to drop hard signal', () => {
            const errorEvent = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'error',
                operation: 'ignorable error',
                capture: {
                    noise: {
                        decision: 'drop',
                        reason: 'Known ignorable error',
                    },
                },
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([errorEvent], baseConfig);
            // Error should be dropped due to explicit override
            expect(events).toHaveLength(0);
            expect(stats.dropped).toBe(1);
        });
        it('should respect capture.noise override to keep non-hard-signal', () => {
            const debugEvent = {
                type: 'log',
                level: 'debug',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'debug',
                operation: 'important debug',
                capture: {
                    noise: {
                        decision: 'keep',
                        reason: 'Important for debugging',
                    },
                },
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-debug',
                        match: { level: 'debug' },
                        decision: 'drop',
                        reason: 'Drop debug',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([debugEvent], config);
            // Debug should be kept due to explicit override
            expect(events).toHaveLength(1);
            expect(stats.kept).toBe(1);
        });
    });
    describe('MinLevel Threshold Edge Cases', () => {
        it('should respect minLevel=TRACE (keep everything)', () => {
            const events = [
                {
                    type: 'span',
                    level: 'trace',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'trace span',
                    durationMs: 100,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'root',
                    operation: 'error',
                },
            ];
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.TRACE,
                rules: [
                    {
                        id: 'drop-trace',
                        match: { level: 'trace' },
                        decision: 'drop',
                        reason: 'Drop trace',
                    },
                ],
            };
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // Trace should be upgraded to fold/keep (has error in subtree, meets minLevel=TRACE)
            expect(output.length).toBeGreaterThan(0);
            expect(output.find(e => e.observabilityLogId === 'error')).toBeDefined();
        });
        it('should respect minLevel=CRITICAL (only critical+ as context)', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'info span',
                    durationMs: 100,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'root',
                    operation: 'error',
                },
            ];
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.CRITICAL,
                rules: [
                    {
                        id: 'drop-info',
                        match: { level: 'info' },
                        decision: 'drop',
                        reason: 'Drop info',
                    },
                ],
            };
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // Root should be dropped (INFO < CRITICAL threshold)
            // Error orphaned and kept
            expect(output).toHaveLength(1);
            expect(output[0].observabilityLogId).toBe('error');
            expect(output[0].parentObservabilityLogId).toBeUndefined();
        });
    });
    describe('Reparenting Edge Cases', () => {
        it('should reparent multiple levels when middle nodes dropped', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 100,
                },
                {
                    type: 'span',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'middle',
                    parentObservabilityLogId: 'root',
                    operation: 'middle',
                    durationMs: 50,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'middle',
                    operation: 'error',
                },
            ];
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.INFO,
                rules: [
                    {
                        id: 'drop-debug',
                        match: { level: 'debug' },
                        decision: 'drop',
                        reason: 'Drop debug',
                    },
                ],
            };
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // Middle should be dropped (DEBUG < INFO)
            // Error should be reparented to root
            expect(output).toHaveLength(2);
            const errorOut = output.find(e => e.observabilityLogId === 'error');
            expect(errorOut).toBeDefined();
            expect(errorOut.parentObservabilityLogId).toBe('root');
        });
        it('should handle multiple children of dropped parent', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 100,
                },
                {
                    type: 'span',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'middle',
                    parentObservabilityLogId: 'root',
                    operation: 'middle',
                    durationMs: 50,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'error1',
                    parentObservabilityLogId: 'middle',
                    operation: 'error 1',
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1030,
                    observabilityLogId: 'error2',
                    parentObservabilityLogId: 'middle',
                    operation: 'error 2',
                },
            ];
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.INFO,
                rules: [
                    {
                        id: 'drop-debug',
                        match: { level: 'debug' },
                        decision: 'drop',
                        reason: 'Drop debug',
                    },
                ],
            };
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // Both errors should be reparented to root
            expect(output).toHaveLength(3); // root + 2 errors
            const error1 = output.find(e => e.observabilityLogId === 'error1');
            const error2 = output.find(e => e.observabilityLogId === 'error2');
            expect(error1.parentObservabilityLogId).toBe('root');
            expect(error2.parentObservabilityLogId).toBe('root');
        });
    });
    describe('Stats Accuracy', () => {
        it('should accurately count all decisions', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 100,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'root',
                    operation: 'error', // kept
                },
                {
                    type: 'log',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'debug',
                    parentObservabilityLogId: 'root',
                    operation: 'debug', // dropped
                },
                {
                    type: 'database.query',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1030,
                    observabilityLogId: 'query',
                    parentObservabilityLogId: 'root',
                    operation: 'SELECT', // folded
                    durationMs: 50,
                },
            ];
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-debug',
                        match: { level: 'debug' },
                        decision: 'drop',
                        reason: 'Drop debug',
                    },
                    {
                        id: 'fold-db',
                        match: { type: 'database.query' },
                        decision: 'fold',
                        reason: 'Fold queries',
                    },
                ],
            };
            const { stats } = (0, index_1.applyNoiseReduction)(events, config);
            // Root kept (no rule matched), error kept (hard signal), debug dropped, query folded
            expect(stats.kept).toBe(2); // root + error
            expect(stats.dropped).toBe(1); // debug
            expect(stats.folded).toBe(1); // query
            expect(stats.aggregated).toBe(0);
            expect(stats.downgraded).toBe(0);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRnZS1jYXNlcy1jb21wcmVoZW5zaXZlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL2VkZ2UtY2FzZXMtY29tcHJlaGVuc2l2ZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7Ozs7R0FXRzs7QUFFSCxvQ0FBK0M7QUFFL0MsdUNBQWlEO0FBRWpELE1BQU0sVUFBVSxHQUF5QjtJQUN2QyxPQUFPLEVBQUUsSUFBSTtJQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO0lBQ2pDLFdBQVcsRUFBRTtRQUNYLE1BQU0sRUFBRSxDQUFFLE9BQU8sRUFBRSxVQUFVLENBQUU7UUFDL0IsZUFBZSxFQUFFLElBQUk7S0FDdEI7SUFDRCxPQUFPLEVBQUUsRUFBRTtJQUNYLEtBQUssRUFBRSxFQUFFO0lBQ1QsYUFBYSxFQUFFLEtBQUs7SUFDcEIscUJBQXFCLEVBQUUsR0FBRztJQUMxQix1QkFBdUIsRUFBRSxHQUFHO0lBQzVCLDBCQUEwQixFQUFFLENBQUM7SUFDN0IsK0JBQStCLEVBQUUsQ0FBQztJQUNsQyxvQkFBb0IsRUFBRSxLQUFLO0lBQzNCLGVBQWUsRUFBRSxLQUFLO0NBQ3ZCLENBQUM7QUFFRixRQUFRLENBQUMsNEJBQTRCLEVBQUUsR0FBRyxFQUFFO0lBQzFDLFFBQVEsQ0FBQywwQkFBMEIsRUFBRSxHQUFHLEVBQUU7UUFDeEMsRUFBRSxDQUFDLGlDQUFpQyxFQUFFLEdBQUcsRUFBRTtZQUN6QyxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLElBQUEsMkJBQW1CLEVBQUMsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBRTlELE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDL0IsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMs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RixNQUFNLE1BQU0sR0FBeUI7Z0JBQ25DLEdBQUcsVUFBVTtnQkFDYixLQUFLLEVBQUU7b0JBQ0w7d0JBQ0UsRUFBRSxFQUFFLFlBQVk7d0JBQ2hCLEtBQUssRUFBRSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUU7d0JBQ3pCLFFBQVEsRUFBRSxNQUFNO3dCQUNoQixNQUFNLEVBQUUsWUFBWTtxQkFDckI7b0JBQ0Q7d0JBQ0UsRUFBRSxFQUFFLFNBQVM7d0JBQ2IsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLGdCQUFnQixFQUFFO3dCQUNqQyxRQUFRLEVBQUUsTUFBTTt3QkFDaEIsTUFBTSxFQUFFLGNBQWM7cUJBQ3ZCO2lCQUNGO2FBQ0YsQ0FBQztZQUVGLE1BQU0sRUFBRSxLQUFLLEVBQUUsR0FBRyxJQUFBLDJCQUFtQixFQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztZQUV0RCxxRkFBcUY7WUFDckYsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlO1lBQzNDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtZQUN2QyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVE7WUFDdEMsTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDakMsTUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbkMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDb21wcmVoZW5zaXZlIEVkZ2UgQ2FzZSBUZXN0c1xuICogXG4gKiBUZXN0cyBmb3Igc2NlbmFyaW9zIHRoYXQgbWlnaHQgYnJlYWsgdGhlIGltcGxlbWVudGF0aW9uOlxuICogLSBFbXB0eSBpbnB1dHNcbiAqIC0gU2luZ2xlIG5vZGVzXG4gKiAtIFZlcnkgZGVlcCB0cmVlc1xuICogLSBDaXJjdWxhciByZWZlcmVuY2VzIChzaG91bGQgYmUgcHJldmVudGVkIGJ5IHRyZWUgYnVpbGRlcilcbiAqIC0gQWxsIG5vZGVzIGRyb3BwZWRcbiAqIC0gQWxsIG5vZGVzIGtlcHRcbiAqIC0gTWl4ZWQgbGV2ZWxzIGFuZCBkZWNpc2lvbnNcbiAqL1xuXG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uIH0gZnJvbSAnLi4vaW5kZXgnO1xuaW1wb3J0IHR5cGUgeyBPYnNlcnZhYmlsaXR5RXZlbnQsIE5vaXNlUmVkdWN0aW9uQ29uZmlnIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG5jb25zdCBiYXNlQ29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgZW5hYmxlZDogdHJ1ZSxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICBoYXJkU2lnbmFsczoge1xuICAgIGxldmVsczogWyAnZXJyb3InLCAnY3JpdGljYWwnIF0sXG4gICAgc2xvd1RocmVzaG9sZE1zOiA1MDAwLFxuICB9LFxuICBwcmVzZXRzOiBbXSxcbiAgcnVsZXM6IFtdLFxuICBlbWl0U3VtbWFyaWVzOiBmYWxzZSxcbiAgbWF4Q2hlY2twb2ludHNQZXJTcGFuOiA1MDAsXG4gIG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuOiAyMDAsXG4gIG1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5OiA1LFxuICBtYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5OiAzLFxuICBpbmNsdWRlRGVidWdNZXRhZGF0YTogZmFsc2UsXG4gIGluY2x1ZGVFeGFtcGxlczogZmFsc2UsXG59O1xuXG5kZXNjcmliZSgnRWRnZSBDYXNlcyAtIENvbXByZWhlbnNpdmUnLCAoKSA9PiB7XG4gIGRlc2NyaWJlKCdFbXB0eSBhbmQgTWluaW1hbCBJbnB1dHMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgaW5wdXQgYXJyYXknLCAoKSA9PiB7XG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oW10sIGJhc2VDb25maWcpO1xuXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDApO1xuICAgICAgZXhwZWN0KHN0YXRzLmZvbGRlZCkudG9CZSgwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHNpbmdsZSBldmVudCAocm9vdCknLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3NpbmdsZScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QnLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgZXZlbnQgXSwgYmFzZUNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChzdGF0cy5rZXB0KS50b0JlKDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgc2luZ2xlIGVycm9yIGV2ZW50JywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2ZhaWxlZCcsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGV2ZW50IF0sIGJhc2VDb25maWcpO1xuXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoZXZlbnRzWyAwIF0ubGV2ZWwpLnRvQmUoJ2Vycm9yJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdEZWVwIFRyZWUgSGllcmFyY2hpZXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgMTAtbGV2ZWwgZGVlcCB0cmVlIHdpdGggZXJyb3IgYXQgYm90dG9tJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuXG4gICAgICAvLyBDcmVhdGUgMTAtbGV2ZWwgY2hhaW5cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTA7IGkrKykge1xuICAgICAgICBldmVudHMucHVzaCh7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwICsgaSAqIDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogYGxldmVsLSR7aX1gLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogaSA9PT0gMCA/IHVuZGVmaW5lZCA6IGBsZXZlbC0ke2kgLSAxfWAsXG4gICAgICAgICAgb3BlcmF0aW9uOiBgT3AgbGV2ZWwgJHtpfWAsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIGVycm9yIGF0IGJvdHRvbVxuICAgICAgZXZlbnRzLnB1c2goe1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDExMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RlZXAtZXJyb3InLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdsZXZlbC05JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnRXJyb3IgYXQgZGVwdGggMTAnLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLXNwYW5zJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3Agc3BhbnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50czogb3V0cHV0IH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnKTtcblxuICAgICAgLy8gQWxsIHNwYW5zIHNob3VsZCBiZSBrZXB0IGFzIGNvbnRleHQgKG9yIGZvbGRlZCksIGVycm9yIGtlcHRcbiAgICAgIGV4cGVjdChvdXRwdXQubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gICAgICBleHBlY3Qob3V0cHV0LmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2RlZXAtZXJyb3InKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChvdXRwdXQuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbGV2ZWwtMCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgd2lkZSB0cmVlICgxMDAgc2libGluZ3MpJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdiYXRjaCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjaGlsZHJlbjogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTAwOyBpKyspIHtcbiAgICAgICAgY2hpbGRyZW4ucHVzaCh7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwICsgaSxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBjaGlsZC0ke2l9YCxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246IGBJdGVtICR7aX1gLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsIC8vIEFsbCBzdWNjZXNzZnVsIGJ5IGRlZmF1bHRcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIE9uZSBjaGlsZCBoYXMgZXJyb3IgLSB0aGlzIGlzIGEgSEFSRCBTSUdOQUxcbiAgICAgIGNoaWxkcmVuWyA1MCBdLmxldmVsID0gJ2Vycm9yJztcbiAgICAgIGNoaWxkcmVuWyA1MCBdLnN1Y2Nlc3MgPSBmYWxzZTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2FnZ3JlZ2F0ZS1pdGVtcycsXG4gICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICcvXkl0ZW0vJywgc3VjY2VzczogdHJ1ZSB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgICAgICAgcmVhc29uOiAnQWdncmVnYXRlIHN1Y2Nlc3NmdWwgaXRlbXMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50czogb3V0cHV0LCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIC4uLmNoaWxkcmVuIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIEV4cGVjdGVkIGJlaGF2aW9yOlxuICAgICAgLy8gLSBSb290OiBubyBydWxlIG1hdGNoZXMgLT4gS0VFUFxuICAgICAgLy8gLSA5OSBjaGlsZHJlbiB3aXRoIHN1Y2Nlc3M9dHJ1ZTogYWdncmVnYXRlIHJ1bGUgbWF0Y2hlcyAtPiBBR0dSRUdBVEUgaW50byByb290XG4gICAgICAvLyAtIGNoaWxkLTUwIHdpdGggZXJyb3I6IEhBUkQgU0lHTkFMIC0+IEtFRVAgKHByb3RlY3RlZCBmcm9tIGFnZ3JlZ2F0aW9uKVxuXG4gICAgICBleHBlY3Qob3V0cHV0KS50b0hhdmVMZW5ndGgoMik7IC8vIHJvb3QgKyBjaGlsZC01MFxuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMik7IC8vIHJvb3QgKyBjaGlsZC01MFxuICAgICAgZXhwZWN0KHN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmUoOTkpOyAvLyBhbGwgc3VjY2Vzc2Z1bCBjaGlsZHJlblxuXG4gICAgICAvLyBWZXJpZnkgb3V0cHV0cyBhcmUgY29ycmVjdFxuICAgICAgY29uc3Qgcm9vdE91dCA9IG91dHB1dC5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdyb290Jyk7XG4gICAgICBjb25zdCBlcnJvck91dCA9IG91dHB1dC5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZC01MCcpO1xuXG4gICAgICBleHBlY3Qocm9vdE91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChlcnJvck91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChlcnJvck91dCEubGV2ZWwpLnRvQmUoJ2Vycm9yJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBbGwgTm9kZXMgU2FtZSBEZWNpc2lvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhbGwgbm9kZXMgZHJvcHBlZCAobm8gaGFyZCBzaWduYWxzKScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsb2cxJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdkZWJ1ZyBsb2cnLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLCAvLyBCb3RoIGFyZSBERUJVRyA8IElORk9cbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7fSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGFsbCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzOiBvdXRwdXQsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnKTtcblxuICAgICAgZXhwZWN0KG91dHB1dCkudG9IYXZlTGVuZ3RoKDApO1xuICAgICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMik7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhbGwgbm9kZXMga2VwdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QnLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xvZzEnLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yIGxvZycsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCB7IGV2ZW50czogb3V0cHV0LCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGJhc2VDb25maWcpO1xuXG4gICAgICBleHBlY3Qob3V0cHV0KS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgyKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0V4cGxpY2l0IE92ZXJyaWRlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJlc3BlY3QgY2FwdHVyZS5ub2lzZSBvdmVycmlkZSB0byBkcm9wIGhhcmQgc2lnbmFsJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXJyb3JFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnaWdub3JhYmxlIGVycm9yJyxcbiAgICAgICAgY2FwdHVyZToge1xuICAgICAgICAgIG5vaXNlOiB7XG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnS25vd24gaWdub3JhYmxlIGVycm9yJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgZXJyb3JFdmVudCBdLCBiYXNlQ29uZmlnKTtcblxuICAgICAgLy8gRXJyb3Igc2hvdWxkIGJlIGRyb3BwZWQgZHVlIHRvIGV4cGxpY2l0IG92ZXJyaWRlXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgxKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVzcGVjdCBjYXB0dXJlLm5vaXNlIG92ZXJyaWRlIHRvIGtlZXAgbm9uLWhhcmQtc2lnbmFsJywgKCkgPT4ge1xuICAgICAgY29uc3QgZGVidWdFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RlYnVnJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnaW1wb3J0YW50IGRlYnVnJyxcbiAgICAgICAgY2FwdHVyZToge1xuICAgICAgICAgIG5vaXNlOiB7XG4gICAgICAgICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgICAgICAgcmVhc29uOiAnSW1wb3J0YW50IGZvciBkZWJ1Z2dpbmcnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1kZWJ1ZycsXG4gICAgICAgICAgICBtYXRjaDogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgZGVidWcnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBkZWJ1Z0V2ZW50IF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIERlYnVnIHNob3VsZCBiZSBrZXB0IGR1ZSB0byBleHBsaWNpdCBvdmVycmlkZVxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdNaW5MZXZlbCBUaHJlc2hvbGQgRWRnZSBDYXNlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJlc3BlY3QgbWluTGV2ZWw9VFJBQ0UgKGtlZXAgZXZlcnl0aGluZyknLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAndHJhY2UnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICd0cmFjZSBzcGFuJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLXRyYWNlJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IGxldmVsOiAndHJhY2UnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCB0cmFjZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzOiBvdXRwdXQgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcpO1xuXG4gICAgICAvLyBUcmFjZSBzaG91bGQgYmUgdXBncmFkZWQgdG8gZm9sZC9rZWVwIChoYXMgZXJyb3IgaW4gc3VidHJlZSwgbWVldHMgbWluTGV2ZWw9VFJBQ0UpXG4gICAgICBleHBlY3Qob3V0cHV0Lmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuICAgICAgZXhwZWN0KG91dHB1dC5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdlcnJvcicpKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXNwZWN0IG1pbkxldmVsPUNSSVRJQ0FMIChvbmx5IGNyaXRpY2FsKyBhcyBjb250ZXh0KScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnaW5mbyBzcGFuJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuQ1JJVElDQUwsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWluZm8nLFxuICAgICAgICAgICAgbWF0Y2g6IHsgbGV2ZWw6ICdpbmZvJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgaW5mbycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzOiBvdXRwdXQgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcpO1xuXG4gICAgICAvLyBSb290IHNob3VsZCBiZSBkcm9wcGVkIChJTkZPIDwgQ1JJVElDQUwgdGhyZXNob2xkKVxuICAgICAgLy8gRXJyb3Igb3JwaGFuZWQgYW5kIGtlcHRcbiAgICAgIGV4cGVjdChvdXRwdXQpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChvdXRwdXRbIDAgXS5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ2Vycm9yJyk7XG4gICAgICBleHBlY3Qob3V0cHV0WyAwIF0ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZXBhcmVudGluZyBFZGdlIENhc2VzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmVwYXJlbnQgbXVsdGlwbGUgbGV2ZWxzIHdoZW4gbWlkZGxlIG5vZGVzIGRyb3BwZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Jvb3QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWlkZGxlJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdtaWRkbGUnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDIwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdtaWRkbGUnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZGVidWcnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGRlYnVnJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHM6IG91dHB1dCB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIC8vIE1pZGRsZSBzaG91bGQgYmUgZHJvcHBlZCAoREVCVUcgPCBJTkZPKVxuICAgICAgLy8gRXJyb3Igc2hvdWxkIGJlIHJlcGFyZW50ZWQgdG8gcm9vdFxuICAgICAgZXhwZWN0KG91dHB1dCkudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgY29uc3QgZXJyb3JPdXQgPSBvdXRwdXQuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3InKSE7XG4gICAgICBleHBlY3QoZXJyb3JPdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXJyb3JPdXQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtdWx0aXBsZSBjaGlsZHJlbiBvZiBkcm9wcGVkIHBhcmVudCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdtaWRkbGUnLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ21pZGRsZScsXG4gICAgICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3IxJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdtaWRkbGUnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yIDEnLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDMwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yMicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWlkZGxlJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdlcnJvciAyJyxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZGVidWcnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGRlYnVnJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHM6IG91dHB1dCB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIC8vIEJvdGggZXJyb3JzIHNob3VsZCBiZSByZXBhcmVudGVkIHRvIHJvb3RcbiAgICAgIGV4cGVjdChvdXRwdXQpLnRvSGF2ZUxlbmd0aCgzKTsgLy8gcm9vdCArIDIgZXJyb3JzXG4gICAgICBjb25zdCBlcnJvcjEgPSBvdXRwdXQuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3IxJykhO1xuICAgICAgY29uc3QgZXJyb3IyID0gb3V0cHV0LmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Vycm9yMicpITtcbiAgICAgIGV4cGVjdChlcnJvcjEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gICAgICBleHBlY3QoZXJyb3IyLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU3RhdHMgQWNjdXJhY3knLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBhY2N1cmF0ZWx5IGNvdW50IGFsbCBkZWNpc2lvbnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Jvb3QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXJyb3InLCAvLyBrZXB0XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZGVidWcnLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2RlYnVnJywgLy8gZHJvcHBlZFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAzMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdxdWVyeScsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnU0VMRUNUJywgLy8gZm9sZGVkXG4gICAgICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1kZWJ1ZycsXG4gICAgICAgICAgICBtYXRjaDogeyBsZXZlbDogJ2RlYnVnJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgZGVidWcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdmb2xkLWRiJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdkYXRhYmFzZS5xdWVyeScgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgICAgICByZWFzb246ICdGb2xkIHF1ZXJpZXMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnKTtcblxuICAgICAgLy8gUm9vdCBrZXB0IChubyBydWxlIG1hdGNoZWQpLCBlcnJvciBrZXB0IChoYXJkIHNpZ25hbCksIGRlYnVnIGRyb3BwZWQsIHF1ZXJ5IGZvbGRlZFxuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMik7IC8vIHJvb3QgKyBlcnJvclxuICAgICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMSk7IC8vIGRlYnVnXG4gICAgICBleHBlY3Qoc3RhdHMuZm9sZGVkKS50b0JlKDEpOyAvLyBxdWVyeVxuICAgICAgZXhwZWN0KHN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmUoMCk7XG4gICAgICBleHBlY3Qoc3RhdHMuZG93bmdyYWRlZCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==