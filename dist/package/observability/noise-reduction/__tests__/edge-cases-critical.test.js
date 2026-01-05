"use strict";
/**
 * Critical Edge Cases - Tests for scenarios that could break the algorithm
 *
 * These tests verify behavior that is specified but not currently tested.
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
    includeDebugMetadata: true,
    includeExamples: false,
};
describe('Critical Edge Cases', () => {
    describe('Multiple Hard Signals in Same Subtree', () => {
        it('should keep all hard signals and preserve parent as context', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch process',
                durationMs: 1000,
            };
            const error1 = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'error1',
                parentObservabilityLogId: 'root',
                operation: 'first failure',
            };
            const error2 = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1020,
                observabilityLogId: 'error2',
                parentObservabilityLogId: 'root',
                operation: 'second failure',
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-batch',
                        match: { operation: 'batch process' },
                        decision: 'drop',
                        reason: 'Drop batch spans',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, error1, error2], config);
            // All should be kept
            expect(events).toHaveLength(3);
            expect(events.find(e => e.observabilityLogId === 'root')).toBeDefined();
            expect(events.find(e => e.observabilityLogId === 'error1')).toBeDefined();
            expect(events.find(e => e.observabilityLogId === 'error2')).toBeDefined();
            expect(stats.kept).toBe(3);
        });
        it('should handle hard signals at different depths', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'root',
                durationMs: 1000,
            };
            const mid = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'mid',
                parentObservabilityLogId: 'root',
                operation: 'middle',
                durationMs: 500,
            };
            const error1 = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1020,
                observabilityLogId: 'error1',
                parentObservabilityLogId: 'mid',
                operation: 'deep error',
            };
            const error2 = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1030,
                observabilityLogId: 'error2',
                parentObservabilityLogId: 'root',
                operation: 'shallow error',
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop all non-errors',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([root, mid, error1, error2], config);
            // Root kept as context, mid folded (non-root with DROP + hasHardSignal = FOLD)
            // Both errors kept
            expect(events).toHaveLength(3);
            expect(events.find(e => e.observabilityLogId === 'root')).toBeDefined();
            expect(events.find(e => e.observabilityLogId === 'mid')).toBeUndefined(); // Folded
            expect(events.find(e => e.observabilityLogId === 'error1')).toBeDefined();
            expect(events.find(e => e.observabilityLogId === 'error2')).toBeDefined();
            // error1 should be reparented to root (mid was folded)
            const error1Out = events.find(e => e.observabilityLogId === 'error1');
            expect(error1Out.parentObservabilityLogId).toBe('root');
        });
    });
    describe('Fold Rule Matching Hard Signal', () => {
        it('should protect hard signal from being folded', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 1000,
            };
            const errorWithFoldRule = {
                type: 'database.query',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'error-query',
                parentObservabilityLogId: 'root',
                operation: 'SELECT * FROM users',
                durationMs: 50,
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'fold-db',
                        match: { type: 'database.query' },
                        decision: 'fold',
                        reason: 'Fold all DB queries',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, errorWithFoldRule], config);
            // Error should NOT be folded (hard signal protection in Phase 2)
            expect(events).toHaveLength(2);
            expect(events.find(e => e.observabilityLogId === 'error-query')).toBeDefined();
            expect(stats.folded).toBe(0);
            expect(stats.kept).toBe(2);
        });
        it('should protect failed operation from fold rule', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 1000,
            };
            const failedWithFoldRule = {
                type: 'api.call',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'failed-api',
                parentObservabilityLogId: 'root',
                operation: 'POST /payment',
                success: false, // Hard signal
                durationMs: 200,
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'fold-api',
                        match: { type: 'api.call' },
                        decision: 'fold',
                        reason: 'Fold API calls',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, failedWithFoldRule], config);
            // Failed API call should NOT be folded
            expect(events).toHaveLength(2);
            expect(events.find(e => e.observabilityLogId === 'failed-api')).toBeDefined();
            expect(stats.folded).toBe(0);
            expect(stats.kept).toBe(2);
        });
    });
    describe('Context Preservation at Different Levels', () => {
        it('should keep only ancestors meeting minLevel threshold', () => {
            const trace = {
                type: 'span',
                level: 'trace', // Below INFO
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'trace',
                operation: 'trace',
                durationMs: 1000,
            };
            const debug = {
                type: 'span',
                level: 'debug', // Below INFO
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'debug',
                parentObservabilityLogId: 'trace',
                operation: 'debug',
                durationMs: 500,
            };
            const info = {
                type: 'span',
                level: 'info', // Meets INFO threshold
                correlationId: 'test',
                timestampMs: 1020,
                observabilityLogId: 'info',
                parentObservabilityLogId: 'debug',
                operation: 'info',
                durationMs: 200,
            };
            const error = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1030,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'info',
                operation: 'error',
            };
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.INFO,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop all',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([trace, debug, info, error], config);
            // All ancestors below INFO minLevel, so all dropped
            // Only error kept (hard signal), becomes orphaned root
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('error');
            expect(events[0].parentObservabilityLogId).toBeUndefined(); // Orphaned
        });
        it('should preserve all ancestors when minLevel is TRACE', () => {
            const trace = {
                type: 'span',
                level: 'trace',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'trace',
                operation: 'trace',
                durationMs: 1000,
            };
            const debug = {
                type: 'span',
                level: 'debug',
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'debug',
                parentObservabilityLogId: 'trace',
                operation: 'debug',
                durationMs: 500,
            };
            const error = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1020,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'debug',
                operation: 'error',
            };
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.TRACE,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop all',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([trace, debug, error], config);
            // Trace kept as root context, debug folded (non-root with DROP + hasHardSignal = FOLD)
            // Error kept
            expect(events).toHaveLength(2);
            expect(events.find(e => e.observabilityLogId === 'trace')).toBeDefined();
            expect(events.find(e => e.observabilityLogId === 'debug')).toBeUndefined(); // Folded
            expect(events.find(e => e.observabilityLogId === 'error')).toBeDefined();
            // Error reparented to trace
            const errorOut = events.find(e => e.observabilityLogId === 'error');
            expect(errorOut.parentObservabilityLogId).toBe('trace');
        });
    });
    describe('Explicit Override on Hard Signal', () => {
        it('should allow dropping hard signal with explicit override', () => {
            const errorWithOverride = {
                type: 'log',
                level: 'error', // Hard signal
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'error',
                operation: 'known ignorable error',
                capture: {
                    noise: {
                        decision: 'drop',
                        reason: 'User explicitly wants to ignore this error',
                    },
                },
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([errorWithOverride], baseConfig);
            // Error should be dropped despite being a hard signal
            expect(events).toHaveLength(0);
            expect(stats.dropped).toBe(1);
        });
        it('should allow folding hard signal with explicit override', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 1000,
            };
            const errorWithOverride = {
                type: 'log',
                level: 'error', // Hard signal
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'root',
                operation: 'non-critical error',
                capture: {
                    noise: {
                        decision: 'fold',
                        reason: 'User wants this error folded into parent',
                    },
                },
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, errorWithOverride], baseConfig);
            // Error should be folded despite being a hard signal
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('root');
            expect(stats.folded).toBe(1);
            expect(stats.kept).toBe(1);
        });
    });
    describe('Aggregation with Mixed Hard Signals', () => {
        it('should aggregate hard signals separately from non-hard signals', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 5000,
            };
            const items = [];
            for (let i = 0; i < 10; i++) {
                items.push({
                    type: 'span',
                    level: i === 5 ? 'error' : 'info', // Item 5 is error
                    correlationId: 'test',
                    timestampMs: 1000 + i * 10,
                    observabilityLogId: `item-${i}`,
                    parentObservabilityLogId: 'root',
                    operation: 'process-item',
                    success: i !== 5, // Item 5 failed
                    durationMs: 10,
                });
            }
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'aggregate-items',
                        match: { operation: 'process-item' },
                        decision: 'aggregate',
                        reason: 'Aggregate items',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, ...items], config);
            // Per spec: aggregate is ALLOWED for hard signals (errors visible in stats)
            // All 10 items aggregated into root
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('root');
            expect(stats.aggregated).toBe(10);
            expect(stats.kept).toBe(1);
            // Verify aggregate data present
            const rootOut = events[0];
            expect(rootOut.data?.noiseReduction?.aggregated).toBe(10);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWRnZS1jYXNlcy1jcml0aWNhbC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL19fdGVzdHNfXy9lZGdlLWNhc2VzLWNyaXRpY2FsLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7O0FBRUgsb0NBQStDO0FBRS9DLHVDQUFpRDtBQUVqRCxNQUFNLFVBQVUsR0FBeUI7SUFDdkMsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtJQUNqQyxXQUFXLEVBQUU7UUFDWCxNQUFNLEVBQUUsQ0FBRSxPQUFPLEVBQUUsVUFBVSxDQUFFO1FBQy9CLGVBQWUsRUFBRSxJQUFJO0tBQ3RCO0lBQ0QsT0FBTyxFQUFFLEVBQUU7SUFDWCxLQUFLLEVBQUUsRUFBRTtJQUNULGFBQWEsRUFBRSxLQUFLO0lBQ3BCLHFCQUFxQixFQUFFLEdBQUc7SUFDMUIsdUJBQXVCLEVBQUUsR0FBRztJQUM1QiwwQkFBMEIsRUFBRSxDQUFDO0lBQzdCLCtCQUErQixFQUFFLENBQUM7SUFDbEMsb0JBQW9CLEVBQUUsSUFBSTtJQUMxQixlQUFlLEVBQUUsS0FBSztDQUN2QixDQUFDO0FBRUYsUUFBUSxDQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRTtJQUNuQyxRQUFRLENBQUMsdUNBQXVDLEVBQUUsR0FBRyxFQUFFO1FBQ3JELEVBQUUsQ0FBQyw2REFBNkQsRUFBRSxHQUFHLEVBQUU7WUFDckUsTUFBTSxJQUFJLEdBQXVCO2dCQUMvQixJQUFJLEVBQUUsTUFBTTtnQkFDWixLQUFLLEVBQUUsTUFBTTtnQkFDYixhQUFhLEVBQUUsTUFBTTtnQkFDckIsV0FBVyxFQUFFLElBQUk7Z0JBQ2pCLGtCQUFrQixFQUFFLE1BQU07Z0JBQzFCLFNBQVMsRUFBRSxlQUFlO2dCQUMxQixVQUFVLEVBQUUsSUFBSTthQUNqQixDQUFDO1lBRUYs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RUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsSUFBQSwyQkFBbUIsRUFBQyxDQUFFLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBRTFFLDRFQUE0RTtZQUM1RSxvQ0FBb0M7WUFDcEMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMvQixNQUFNLENBQUMsTUFBTSxDQUFFLENBQUMsQ0FBRSxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3BELE1BQU0sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ2xDLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRTNCLGdDQUFnQztZQUNoQyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUUsQ0FBQyxDQUFTLENBQUM7WUFDbkMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM1RCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENyaXRpY2FsIEVkZ2UgQ2FzZXMgLSBUZXN0cyBmb3Igc2NlbmFyaW9zIHRoYXQgY291bGQgYnJlYWsgdGhlIGFsZ29yaXRobVxuICogXG4gKiBUaGVzZSB0ZXN0cyB2ZXJpZnkgYmVoYXZpb3IgdGhhdCBpcyBzcGVjaWZpZWQgYnV0IG5vdCBjdXJyZW50bHkgdGVzdGVkLlxuICovXG5cbmltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24gfSBmcm9tICcuLi9pbmRleCc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCwgTm9pc2VSZWR1Y3Rpb25Db25maWcgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5cbmNvbnN0IGJhc2VDb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gIGhhcmRTaWduYWxzOiB7XG4gICAgbGV2ZWxzOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSxcbiAgICBzbG93VGhyZXNob2xkTXM6IDUwMDAsXG4gIH0sXG4gIHByZXNldHM6IFtdLFxuICBydWxlczogW10sXG4gIGVtaXRTdW1tYXJpZXM6IGZhbHNlLFxuICBtYXhDaGVja3BvaW50c1BlclNwYW46IDUwMCxcbiAgbWF4QWdncmVnYXRlS2V5c1BlclNwYW46IDIwMCxcbiAgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXk6IDUsXG4gIG1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXk6IDMsXG4gIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICBpbmNsdWRlRXhhbXBsZXM6IGZhbHNlLFxufTtcblxuZGVzY3JpYmUoJ0NyaXRpY2FsIEVkZ2UgQ2FzZXMnLCAoKSA9PiB7XG4gIGRlc2NyaWJlKCdNdWx0aXBsZSBIYXJkIFNpZ25hbHMgaW4gU2FtZSBTdWJ0cmVlJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQga2VlcCBhbGwgaGFyZCBzaWduYWxzIGFuZCBwcmVzZXJ2ZSBwYXJlbnQgYXMgY29udGV4dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2ggcHJvY2VzcycsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvcjE6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcjEnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZmlyc3QgZmFpbHVyZScsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvcjI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDIwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcjInLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnc2Vjb25kIGZhaWx1cmUnLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYmF0Y2gnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgb3BlcmF0aW9uOiAnYmF0Y2ggcHJvY2VzcycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGJhdGNoIHNwYW5zJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgZXJyb3IxLCBlcnJvcjIgXSwgY29uZmlnKTtcblxuICAgICAgLy8gQWxsIHNob3VsZCBiZSBrZXB0XG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMyk7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Jvb3QnKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3IxJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Vycm9yMicpKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBoYXJkIHNpZ25hbHMgYXQgZGlmZmVyZW50IGRlcHRocycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBtaWQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdtaWQnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnbWlkZGxlJyxcbiAgICAgICAgZHVyYXRpb25NczogNTAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgZXJyb3IxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAyMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3IxJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWlkJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZGVlcCBlcnJvcicsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvcjI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDMwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcjInLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnc2hhbGxvdyBlcnJvcicsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1hbGwnLFxuICAgICAgICAgICAgbWF0Y2g6IHt9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgYWxsIG5vbi1lcnJvcnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIG1pZCwgZXJyb3IxLCBlcnJvcjIgXSwgY29uZmlnKTtcblxuICAgICAgLy8gUm9vdCBrZXB0IGFzIGNvbnRleHQsIG1pZCBmb2xkZWQgKG5vbi1yb290IHdpdGggRFJPUCArIGhhc0hhcmRTaWduYWwgPSBGT0xEKVxuICAgICAgLy8gQm90aCBlcnJvcnMga2VwdFxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDMpO1xuICAgICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdyb290JykpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ21pZCcpKS50b0JlVW5kZWZpbmVkKCk7IC8vIEZvbGRlZFxuICAgICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdlcnJvcjEnKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3IyJykpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAgIC8vIGVycm9yMSBzaG91bGQgYmUgcmVwYXJlbnRlZCB0byByb290IChtaWQgd2FzIGZvbGRlZClcbiAgICAgIGNvbnN0IGVycm9yMU91dCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdlcnJvcjEnKSE7XG4gICAgICBleHBlY3QoZXJyb3IxT3V0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRm9sZCBSdWxlIE1hdGNoaW5nIEhhcmQgU2lnbmFsJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcHJvdGVjdCBoYXJkIHNpZ25hbCBmcm9tIGJlaW5nIGZvbGRlZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2gnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgZXJyb3JXaXRoRm9sZFJ1bGU6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yLXF1ZXJ5JyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ1NFTEVDVCAqIEZST00gdXNlcnMnLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdmb2xkLWRiJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdkYXRhYmFzZS5xdWVyeScgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgICAgICByZWFzb246ICdGb2xkIGFsbCBEQiBxdWVyaWVzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgZXJyb3JXaXRoRm9sZFJ1bGUgXSwgY29uZmlnKTtcblxuICAgICAgLy8gRXJyb3Igc2hvdWxkIE5PVCBiZSBmb2xkZWQgKGhhcmQgc2lnbmFsIHByb3RlY3Rpb24gaW4gUGhhc2UgMilcbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3ItcXVlcnknKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMCk7XG4gICAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgyKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJvdGVjdCBmYWlsZWQgb3BlcmF0aW9uIGZyb20gZm9sZCBydWxlJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdiYXRjaCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBmYWlsZWRXaXRoRm9sZFJ1bGU6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2FwaS5jYWxsJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZmFpbGVkLWFwaScsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdQT1NUIC9wYXltZW50JyxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIC8vIEhhcmQgc2lnbmFsXG4gICAgICAgIGR1cmF0aW9uTXM6IDIwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdmb2xkLWFwaScsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnYXBpLmNhbGwnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgICAgcmVhc29uOiAnRm9sZCBBUEkgY2FsbHMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290LCBmYWlsZWRXaXRoRm9sZFJ1bGUgXSwgY29uZmlnKTtcblxuICAgICAgLy8gRmFpbGVkIEFQSSBjYWxsIHNob3VsZCBOT1QgYmUgZm9sZGVkXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2ZhaWxlZC1hcGknKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMCk7XG4gICAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgyKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0NvbnRleHQgUHJlc2VydmF0aW9uIGF0IERpZmZlcmVudCBMZXZlbHMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBrZWVwIG9ubHkgYW5jZXN0b3JzIG1lZXRpbmcgbWluTGV2ZWwgdGhyZXNob2xkJywgKCkgPT4ge1xuICAgICAgY29uc3QgdHJhY2U6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ3RyYWNlJywgLy8gQmVsb3cgSU5GT1xuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0cmFjZScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3RyYWNlJyxcbiAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGRlYnVnOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsIC8vIEJlbG93IElORk9cbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZGVidWcnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICd0cmFjZScsXG4gICAgICAgIG9wZXJhdGlvbjogJ2RlYnVnJyxcbiAgICAgICAgZHVyYXRpb25NczogNTAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgaW5mbzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsIC8vIE1lZXRzIElORk8gdGhyZXNob2xkXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2luZm8nLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdkZWJ1ZycsXG4gICAgICAgIG9wZXJhdGlvbjogJ2luZm8nLFxuICAgICAgICBkdXJhdGlvbk1zOiAyMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvcjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMzAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaW5mbycsXG4gICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7fSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGFsbCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgdHJhY2UsIGRlYnVnLCBpbmZvLCBlcnJvciBdLCBjb25maWcpO1xuXG4gICAgICAvLyBBbGwgYW5jZXN0b3JzIGJlbG93IElORk8gbWluTGV2ZWwsIHNvIGFsbCBkcm9wcGVkXG4gICAgICAvLyBPbmx5IGVycm9yIGtlcHQgKGhhcmQgc2lnbmFsKSwgYmVjb21lcyBvcnBoYW5lZCByb290XG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoZXZlbnRzWyAwIF0ub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdlcnJvcicpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZVVuZGVmaW5lZCgpOyAvLyBPcnBoYW5lZFxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmVzZXJ2ZSBhbGwgYW5jZXN0b3JzIHdoZW4gbWluTGV2ZWwgaXMgVFJBQ0UnLCAoKSA9PiB7XG4gICAgICBjb25zdCB0cmFjZTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAndHJhY2UnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0cmFjZScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3RyYWNlJyxcbiAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGRlYnVnOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RlYnVnJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAndHJhY2UnLFxuICAgICAgICBvcGVyYXRpb246ICdkZWJ1ZycsXG4gICAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGVycm9yOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAyMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdkZWJ1ZycsXG4gICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWFsbCcsXG4gICAgICAgICAgICBtYXRjaDoge30sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBhbGwnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHRyYWNlLCBkZWJ1ZywgZXJyb3IgXSwgY29uZmlnKTtcblxuICAgICAgLy8gVHJhY2Uga2VwdCBhcyByb290IGNvbnRleHQsIGRlYnVnIGZvbGRlZCAobm9uLXJvb3Qgd2l0aCBEUk9QICsgaGFzSGFyZFNpZ25hbCA9IEZPTEQpXG4gICAgICAvLyBFcnJvciBrZXB0XG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3RyYWNlJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2RlYnVnJykpLnRvQmVVbmRlZmluZWQoKTsgLy8gRm9sZGVkXG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Vycm9yJykpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAgIC8vIEVycm9yIHJlcGFyZW50ZWQgdG8gdHJhY2VcbiAgICAgIGNvbnN0IGVycm9yT3V0ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Vycm9yJykhO1xuICAgICAgZXhwZWN0KGVycm9yT3V0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgndHJhY2UnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0V4cGxpY2l0IE92ZXJyaWRlIG9uIEhhcmQgU2lnbmFsJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgYWxsb3cgZHJvcHBpbmcgaGFyZCBzaWduYWwgd2l0aCBleHBsaWNpdCBvdmVycmlkZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGVycm9yV2l0aE92ZXJyaWRlOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJywgLy8gSGFyZCBzaWduYWxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICBvcGVyYXRpb246ICdrbm93biBpZ25vcmFibGUgZXJyb3InLFxuICAgICAgICBjYXB0dXJlOiB7XG4gICAgICAgICAgbm9pc2U6IHtcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdVc2VyIGV4cGxpY2l0bHkgd2FudHMgdG8gaWdub3JlIHRoaXMgZXJyb3InLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBlcnJvcldpdGhPdmVycmlkZSBdLCBiYXNlQ29uZmlnKTtcblxuICAgICAgLy8gRXJyb3Igc2hvdWxkIGJlIGRyb3BwZWQgZGVzcGl0ZSBiZWluZyBhIGhhcmQgc2lnbmFsXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgxKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYWxsb3cgZm9sZGluZyBoYXJkIHNpZ25hbCB3aXRoIGV4cGxpY2l0IG92ZXJyaWRlJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdiYXRjaCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvcldpdGhPdmVycmlkZTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsIC8vIEhhcmQgc2lnbmFsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ25vbi1jcml0aWNhbCBlcnJvcicsXG4gICAgICAgIGNhcHR1cmU6IHtcbiAgICAgICAgICBub2lzZToge1xuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ1VzZXIgd2FudHMgdGhpcyBlcnJvciBmb2xkZWQgaW50byBwYXJlbnQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290LCBlcnJvcldpdGhPdmVycmlkZSBdLCBiYXNlQ29uZmlnKTtcblxuICAgICAgLy8gRXJyb3Igc2hvdWxkIGJlIGZvbGRlZCBkZXNwaXRlIGJlaW5nIGEgaGFyZCBzaWduYWxcbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChldmVudHNbIDAgXS5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3Jvb3QnKTtcbiAgICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMSk7XG4gICAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgxKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0FnZ3JlZ2F0aW9uIHdpdGggTWl4ZWQgSGFyZCBTaWduYWxzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgYWdncmVnYXRlIGhhcmQgc2lnbmFscyBzZXBhcmF0ZWx5IGZyb20gbm9uLWhhcmQgc2lnbmFscycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2gnLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MDAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgaXRlbXM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEwOyBpKyspIHtcbiAgICAgICAgaXRlbXMucHVzaCh7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiBpID09PSA1ID8gJ2Vycm9yJyA6ICdpbmZvJywgLy8gSXRlbSA1IGlzIGVycm9yXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwICsgaSAqIDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogYGl0ZW0tJHtpfWAsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzcy1pdGVtJyxcbiAgICAgICAgICBzdWNjZXNzOiBpICE9PSA1LCAvLyBJdGVtIDUgZmFpbGVkXG4gICAgICAgICAgZHVyYXRpb25NczogMTAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWdncmVnYXRlLWl0ZW1zJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ3Byb2Nlc3MtaXRlbScgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0FnZ3JlZ2F0ZSBpdGVtcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIC4uLml0ZW1zIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIFBlciBzcGVjOiBhZ2dyZWdhdGUgaXMgQUxMT1dFRCBmb3IgaGFyZCBzaWduYWxzIChlcnJvcnMgdmlzaWJsZSBpbiBzdGF0cylcbiAgICAgIC8vIEFsbCAxMCBpdGVtcyBhZ2dyZWdhdGVkIGludG8gcm9vdFxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICAgICAgZXhwZWN0KHN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmUoMTApO1xuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG5cbiAgICAgIC8vIFZlcmlmeSBhZ2dyZWdhdGUgZGF0YSBwcmVzZW50XG4gICAgICBjb25zdCByb290T3V0ID0gZXZlbnRzWyAwIF0gYXMgYW55O1xuICAgICAgZXhwZWN0KHJvb3RPdXQuZGF0YT8ubm9pc2VSZWR1Y3Rpb24/LmFnZ3JlZ2F0ZWQpLnRvQmUoMTApO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19