"use strict";
/**
 * Hard Signal Algorithm Tests
 *
 * Tests for the enhanced noise reduction algorithm with hard signal detection,
 * propagation, and context preservation per NOISE-REDUCTION-FINAL-SPEC.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
const types_1 = require("../../types");
describe('Hard Signal Algorithm', () => {
    const baseConfig = (0, config_1.createObservabilityConfig)({
        enabled: true,
        minLevel: types_1.ObservabilityLevel.INFO,
        noiseReduction: {
            enabled: true,
            minLevel: types_1.ObservabilityLevel.INFO,
            hardSignals: {
                levels: ['error', 'critical'],
                includeWarn: false,
                slowThresholdMs: 5000,
                slowThresholds: {
                    'database.query': 100,
                },
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
        },
    }).noiseReduction;
    describe('Phase 2: Hard Signal Protection', () => {
        it('should protect error events from being dropped', () => {
            const errorEvent = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'error-1',
                operation: 'test',
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop everything',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([errorEvent], config);
            // Error should be kept despite drop rule
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('error-1');
        });
        it('should protect failed operations from being dropped', () => {
            const failedEvent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'failed-1',
                operation: 'test',
                success: false,
                durationMs: 100,
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop everything',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([failedEvent], config);
            // Failed operation should be kept
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('failed-1');
        });
        it('should protect slow operations from being dropped', () => {
            const slowEvent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'slow-1',
                operation: 'test',
                durationMs: 6000, // > 5000ms default threshold
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop everything',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([slowEvent], config);
            // Slow operation should be kept
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('slow-1');
        });
        it('should allow aggregating hard signals when explicitly configured', () => {
            // Hard signals are protected and KEPT by default
            // Aggregate rules on hard signals are overridden to KEEP
            const parent = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'parent',
                operation: 'batch',
                durationMs: 1000,
            };
            const errors = Array.from({ length: 10 }).map((_, i) => ({
                type: 'span',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1000 + i * 10,
                observabilityLogId: `error-${i}`,
                parentObservabilityLogId: 'parent',
                operation: 'process-item',
                durationMs: 10,
            }));
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'aggregate-errors',
                        match: { level: 'error' },
                        decision: 'aggregate',
                        reason: 'Try to aggregate errors',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([parent, ...errors], config);
            // Hard signals CAN be aggregated per spec (when explicitly configured)
            expect(stats.aggregated).toBe(10);
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('parent');
            const aggregates = events[0].data?.noiseReduction?.aggregates;
            expect(aggregates).toBeDefined();
            expect(Object.values(aggregates || {}).some((bucket) => bucket.errorCount === 10)).toBe(true);
        });
    });
    describe('Phase 2.5: Hard Signal Propagation', () => {
        it('should propagate hard signal flag to ancestors', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'HTTP GET /api',
                durationMs: 500,
                success: true,
            };
            const child = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'child',
                parentObservabilityLogId: 'root',
                operation: 'service.call',
                durationMs: 100,
                success: true,
            };
            const error = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1200,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'child',
                operation: 'payment',
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-get',
                        match: { operation: '/^HTTP GET/' },
                        decision: 'drop',
                        reason: 'Drop successful GETs',
                    },
                    {
                        id: 'drop-service',
                        match: { operation: 'service.call' },
                        decision: 'drop',
                        reason: 'Drop service calls',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, child, error], config);
            // Root should be KEPT (upgraded from DROP, is root with hard signal in subtree)
            // Child should be FOLDED (upgraded from DROP, has parent and hard signal in subtree)
            // Error should be KEPT (hard signal)
            expect(events).toHaveLength(2);
            expect(events.some(e => e.observabilityLogId === 'root')).toBe(true);
            expect(events.some(e => e.observabilityLogId === 'error')).toBe(true);
            expect(stats.folded).toBe(1); // child folded
            expect(stats.kept).toBe(2); // root + error
        });
        it('should NOT propagate hard signal across siblings', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 1000,
            };
            const child1 = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'child1',
                parentObservabilityLogId: 'root',
                operation: 'safe-op',
                durationMs: 100,
                success: true,
            };
            const child2 = {
                type: 'span',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1200,
                observabilityLogId: 'child2',
                parentObservabilityLogId: 'root',
                operation: 'failed-op',
                durationMs: 100,
                success: false,
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-safe',
                        match: { operation: 'safe-op' },
                        decision: 'drop',
                        reason: 'Drop safe operations',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([root, child1, child2], config);
            // child1 should be DROPPED (no hard signal in its own subtree)
            // child2 should be KEPT (error)
            // root should be KEPT (has hard signal in subtree)
            expect(events).toHaveLength(2);
            expect(events.some(e => e.observabilityLogId === 'root')).toBe(true);
            expect(events.some(e => e.observabilityLogId === 'child2')).toBe(true);
            expect(events.some(e => e.observabilityLogId === 'child1')).toBe(false);
        });
    });
    describe('Phase 3: Context-Aware DROP Logic', () => {
        it('should upgrade DROP to KEEP for root with hard signal in subtree (Phase 2)', () => {
            // This tests Phase 3 context preservation, NOT Phase 2 protection
            // Root is NOT a hard signal itself, but has error child
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'HTTP GET /api',
                durationMs: 200,
                // NO error property - root is NOT a hard signal itself
            };
            const errorChild = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1010,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'root',
                operation: 'payment failed',
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-get',
                        match: { operation: '/^HTTP GET/' },
                        decision: 'drop',
                        reason: 'Drop GETs',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, errorChild], config);
            // Expected: Phase 2 evaluates root as DROP (not a hard signal)
            // Phase 2.5 sets hasHardSignalInSubtree=true on root (has error child)
            // Phase 3 upgrades root from DROP to KEEP (root + hasHardSignalInSubtree + minLevel met)
            expect(events).toHaveLength(2); // root + error
            expect(events.find(e => e.observabilityLogId === 'root')).toBeDefined();
            expect(events.find(e => e.observabilityLogId === 'error')).toBeDefined();
            expect(stats.kept).toBe(2);
            expect(stats.dropped).toBe(0);
        });
        it('should upgrade DROP to FOLD for non-root with hard signal', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'batch',
                durationMs: 1000,
            };
            const child = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'child',
                parentObservabilityLogId: 'root',
                operation: 'droppable',
                durationMs: 100,
            };
            const error = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1200,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'child',
                operation: 'payment',
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-child',
                        match: { operation: 'droppable' },
                        decision: 'drop',
                        reason: 'Drop noise',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, child, error], config);
            // child should be FOLDED (upgraded from DROP due to error descendant)
            // error should be KEPT and reparented to root
            expect(stats.folded).toBe(1);
            expect(events).toHaveLength(2);
            expect(events.some(e => e.observabilityLogId === 'root')).toBe(true);
            expect(events.some(e => e.observabilityLogId === 'error')).toBe(true);
            const errorEvent = events.find(e => e.observabilityLogId === 'error');
            expect(errorEvent.parentObservabilityLogId).toBe('root');
        });
        it('should respect minLevel threshold for context preservation', () => {
            const root = {
                type: 'span',
                level: 'debug', // Below INFO minLevel
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'debug-span',
                durationMs: 100,
            };
            const error = {
                type: 'log',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'error',
                parentObservabilityLogId: 'root',
                operation: 'payment',
            };
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.INFO, // Context threshold
                rules: [
                    {
                        id: 'drop-debug',
                        match: { level: 'debug' },
                        decision: 'drop',
                        reason: 'Drop debug logs',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([root, error], config);
            // root has DEBUG level < INFO minLevel, so dropped despite error child
            // error is kept and reparented to become root
            expect(events).toHaveLength(1);
            const errorEvent = events.find(e => e.observabilityLogId === 'error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.parentObservabilityLogId).toBeUndefined();
        });
        it('should drop completely when no hard signal and no kept children', () => {
            const root = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'HTTP GET /api',
                durationMs: 200,
                success: true,
            };
            const child = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'child',
                parentObservabilityLogId: 'root',
                operation: 'db.query',
                durationMs: 50,
                success: true,
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-get',
                        match: { operation: '/^HTTP GET/' },
                        decision: 'drop',
                        reason: 'Drop successful GETs',
                    },
                    {
                        id: 'drop-query',
                        match: { operation: 'db.query' },
                        decision: 'drop',
                        reason: 'Drop fast queries',
                    },
                ],
            };
            const { events, stats } = (0, index_1.applyNoiseReduction)([root, child], config);
            // Everything should be dropped (no hard signals)
            expect(events).toHaveLength(0);
            expect(stats.dropped).toBe(2);
        });
    });
    describe('Per-Type Slow Thresholds', () => {
        it('should use per-type threshold for database queries', () => {
            const dbQuery = {
                type: 'database.query',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'query-1',
                operation: 'SELECT * FROM users',
                durationMs: 150, // > 100ms threshold for database.query
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop everything',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([dbQuery], config);
            // Should be kept (slow for database.query)
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('query-1');
        });
        it('should use global threshold when no per-type threshold defined', () => {
            const genericOp = {
                type: 'span',
                level: 'info',
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'op-1',
                operation: 'process',
                durationMs: 6000, // > 5000ms global threshold
            };
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop everything',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([genericOp], config);
            // Should be kept (slow globally)
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('op-1');
        });
    });
    describe('Reparenting', () => {
        it('should reparent error when parent dropped below minLevel', () => {
            const root = {
                type: 'span',
                level: 'debug', // Below INFO threshold
                correlationId: 'test',
                timestampMs: 1000,
                observabilityLogId: 'root',
                operation: 'droppable',
                durationMs: 100,
            };
            const child = {
                type: 'span',
                level: 'error',
                correlationId: 'test',
                timestampMs: 1100,
                observabilityLogId: 'child',
                parentObservabilityLogId: 'root',
                operation: 'important',
                durationMs: 50,
            };
            const config = {
                ...baseConfig,
                minLevel: types_1.ObservabilityLevel.INFO, // Root DEBUG < INFO, so dropped
                rules: [
                    {
                        id: 'drop-root',
                        match: { operation: 'droppable' },
                        decision: 'drop',
                        reason: 'Drop noise',
                    },
                ],
            };
            const { events } = (0, index_1.applyNoiseReduction)([root, child], config);
            // Root dropped (DEBUG < INFO minLevel)
            // Child kept (error = hard signal) and reparented to root
            expect(events).toHaveLength(1);
            expect(events[0].observabilityLogId).toBe('child');
            expect(events[0].parentObservabilityLogId).toBeUndefined();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGFyZC1zaWduYWwtYWxnb3JpdGhtLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL2hhcmQtc2lnbmFsLWFsZ29yaXRobS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFFSCxvQ0FBK0M7QUFDL0MseUNBQXlEO0FBRXpELHVDQUFpRDtBQUVqRCxRQUFRLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO0lBQ3JDLE1BQU0sVUFBVSxHQUFHLElBQUEsa0NBQXlCLEVBQUM7UUFDM0MsT0FBTyxFQUFFLElBQUk7UUFDYixRQUFRLEVBQUUsMEJBQWtCLENBQUMsSUFBSTtRQUNqQyxjQUFjLEVBQUU7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO1lBQ2pDLFdBQVcsRUFBRTtnQkFDWCxNQUFNLEVBQUUsQ0FBRSxPQUFPLEVBQUUsVUFBVSxDQUFFO2dCQUMvQixXQUFXLEVBQUUsS0FBSztnQkFDbEIsZUFBZSxFQUFFLElBQUk7Z0JBQ3JCLGNBQWMsRUFBRTtvQkFDZCxnQkFBZ0IsRUFBRSxHQUFHO2lCQUN0QjthQUNGO1lBQ0QsT0FBTyxFQUFFLEVBQUU7WUFDWCxLQUFLLEVBQUUsRUFBRTtZQUNULGFBQWEsRUFBRSxLQUFLO1lBQ3BCLHFCQUFxQixFQUFFLEdBQUc7WUFDMUIsdUJBQXVCLEVBQUUsR0FBRztZQUM1QiwwQkFBMEIsRUFBRSxDQUFDO1lBQzdCLCtCQUErQixFQUFFLENBQUM7WUFDbEMsb0JBQW9CLEVBQUUsSUFBSTtZQUMxQixlQUFlLEVBQUUsS0FBSztTQUN2QjtLQUNGLENBQUMsQ0FBQyxjQUFjLENBQUM7SUFFbEIsUUFBUSxDQUFDLGlDQUFpQyxFQUFFLEdBQUcsRUFBRTtRQUMvQyxFQUFFLENBQUMsZ0RBQWdELEVBQUUsR0FBRyxFQUFF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QUUsTUFBTSxFQUFFLEdBQUcsSUFBQSwyQkFBbUIsRUFBQyxDQUFFLElBQUksRUFBRSxLQUFLLENBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQztZQUVoRSx1Q0FBdUM7WUFDdkMsMERBQTBEO1lBQzFELE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDL0IsTUFBTSxDQUFDLE1BQU0sQ0FBRSxDQUFDLENBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNyRCxNQUFNLENBQUMsTUFBTSxDQUFFLENBQUMsQ0FBRSxDQUFDLHdCQUF3QixDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDL0QsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBIYXJkIFNpZ25hbCBBbGdvcml0aG0gVGVzdHNcbiAqIFxuICogVGVzdHMgZm9yIHRoZSBlbmhhbmNlZCBub2lzZSByZWR1Y3Rpb24gYWxnb3JpdGhtIHdpdGggaGFyZCBzaWduYWwgZGV0ZWN0aW9uLFxuICogcHJvcGFnYXRpb24sIGFuZCBjb250ZXh0IHByZXNlcnZhdGlvbiBwZXIgTk9JU0UtUkVEVUNUSU9OLUZJTkFMLVNQRUMubWRcbiAqL1xuXG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uIH0gZnJvbSAnLi4vaW5kZXgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uLy4uL2NvbmZpZyc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCwgTm9pc2VSZWR1Y3Rpb25Db25maWcgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5cbmRlc2NyaWJlKCdIYXJkIFNpZ25hbCBBbGdvcml0aG0nLCAoKSA9PiB7XG4gIGNvbnN0IGJhc2VDb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTyxcbiAgICAgIGhhcmRTaWduYWxzOiB7XG4gICAgICAgIGxldmVsczogWyAnZXJyb3InLCAnY3JpdGljYWwnIF0sXG4gICAgICAgIGluY2x1ZGVXYXJuOiBmYWxzZSxcbiAgICAgICAgc2xvd1RocmVzaG9sZE1zOiA1MDAwLFxuICAgICAgICBzbG93VGhyZXNob2xkczoge1xuICAgICAgICAgICdkYXRhYmFzZS5xdWVyeSc6IDEwMCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwcmVzZXRzOiBbXSxcbiAgICAgIHJ1bGVzOiBbXSxcbiAgICAgIGVtaXRTdW1tYXJpZXM6IGZhbHNlLFxuICAgICAgbWF4Q2hlY2twb2ludHNQZXJTcGFuOiA1MDAsXG4gICAgICBtYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbjogMjAwLFxuICAgICAgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXk6IDUsXG4gICAgICBtYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5OiAzLFxuICAgICAgaW5jbHVkZURlYnVnTWV0YWRhdGE6IHRydWUsXG4gICAgICBpbmNsdWRlRXhhbXBsZXM6IGZhbHNlLFxuICAgIH0sXG4gIH0pLm5vaXNlUmVkdWN0aW9uO1xuXG4gIGRlc2NyaWJlKCdQaGFzZSAyOiBIYXJkIFNpZ25hbCBQcm90ZWN0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcHJvdGVjdCBlcnJvciBldmVudHMgZnJvbSBiZWluZyBkcm9wcGVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXJyb3JFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yLTEnLFxuICAgICAgICBvcGVyYXRpb246ICd0ZXN0JyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWFsbCcsXG4gICAgICAgICAgICBtYXRjaDoge30sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBldmVyeXRoaW5nJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBlcnJvckV2ZW50IF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIEVycm9yIHNob3VsZCBiZSBrZXB0IGRlc3BpdGUgZHJvcCBydWxlXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoZXZlbnRzWyAwIF0ub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdlcnJvci0xJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb3RlY3QgZmFpbGVkIG9wZXJhdGlvbnMgZnJvbSBiZWluZyBkcm9wcGVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgZmFpbGVkRXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYWlsZWQtMScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QnLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7fSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGV2ZXJ5dGhpbmcnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGZhaWxlZEV2ZW50IF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIEZhaWxlZCBvcGVyYXRpb24gc2hvdWxkIGJlIGtlcHRcbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChldmVudHNbIDAgXS5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ2ZhaWxlZC0xJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByb3RlY3Qgc2xvdyBvcGVyYXRpb25zIGZyb20gYmVpbmcgZHJvcHBlZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHNsb3dFdmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3ctMScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Rlc3QnLFxuICAgICAgICBkdXJhdGlvbk1zOiA2MDAwLCAvLyA+IDUwMDBtcyBkZWZhdWx0IHRocmVzaG9sZFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7fSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGV2ZXJ5dGhpbmcnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHNsb3dFdmVudCBdLCBjb25maWcpO1xuXG4gICAgICAvLyBTbG93IG9wZXJhdGlvbiBzaG91bGQgYmUga2VwdFxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgnc2xvdy0xJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFsbG93IGFnZ3JlZ2F0aW5nIGhhcmQgc2lnbmFscyB3aGVuIGV4cGxpY2l0bHkgY29uZmlndXJlZCcsICgpID0+IHtcbiAgICAgIC8vIEhhcmQgc2lnbmFscyBhcmUgcHJvdGVjdGVkIGFuZCBLRVBUIGJ5IGRlZmF1bHRcbiAgICAgIC8vIEFnZ3JlZ2F0ZSBydWxlcyBvbiBoYXJkIHNpZ25hbHMgYXJlIG92ZXJyaWRkZW4gdG8gS0VFUFxuICAgICAgY29uc3QgcGFyZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2gnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgZXJyb3JzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDEwIH0pLm1hcCgoXywgaSkgPT4gKHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCArIGkgKiAxMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgZXJyb3ItJHtpfWAsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3MtaXRlbScsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgICAgfSkpO1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWdncmVnYXRlLWVycm9ycycsXG4gICAgICAgICAgICBtYXRjaDogeyBsZXZlbDogJ2Vycm9yJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgICAgICAgcmVhc29uOiAnVHJ5IHRvIGFnZ3JlZ2F0ZSBlcnJvcnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBwYXJlbnQsIC4uLmVycm9ycyBdLCBjb25maWcpO1xuXG4gICAgICAvLyBIYXJkIHNpZ25hbHMgQ0FOIGJlIGFnZ3JlZ2F0ZWQgcGVyIHNwZWMgKHdoZW4gZXhwbGljaXRseSBjb25maWd1cmVkKVxuICAgICAgZXhwZWN0KHN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmUoMTApO1xuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncGFyZW50Jyk7XG5cbiAgICAgIGNvbnN0IGFnZ3JlZ2F0ZXMgPSAoZXZlbnRzWyAwIF0uZGF0YSBhcyBhbnkpPy5ub2lzZVJlZHVjdGlvbj8uYWdncmVnYXRlcztcbiAgICAgIGV4cGVjdChhZ2dyZWdhdGVzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KE9iamVjdC52YWx1ZXMoYWdncmVnYXRlcyB8fCB7fSkuc29tZSgoYnVja2V0OiBhbnkpID0+IGJ1Y2tldC5lcnJvckNvdW50ID09PSAxMCkpLnRvQmUodHJ1ZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQaGFzZSAyLjU6IEhhcmQgU2lnbmFsIFByb3BhZ2F0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcHJvcGFnYXRlIGhhcmQgc2lnbmFsIGZsYWcgdG8gYW5jZXN0b3JzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYXBpJyxcbiAgICAgICAgZHVyYXRpb25NczogNTAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2hpbGQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMTAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdzZXJ2aWNlLmNhbGwnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvcjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEyMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgICBvcGVyYXRpb246ICdwYXltZW50JyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWdldCcsXG4gICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICcvXkhUVFAgR0VULycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIHN1Y2Nlc3NmdWwgR0VUcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3Atc2VydmljZScsXG4gICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICdzZXJ2aWNlLmNhbGwnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBzZXJ2aWNlIGNhbGxzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgY2hpbGQsIGVycm9yIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIFJvb3Qgc2hvdWxkIGJlIEtFUFQgKHVwZ3JhZGVkIGZyb20gRFJPUCwgaXMgcm9vdCB3aXRoIGhhcmQgc2lnbmFsIGluIHN1YnRyZWUpXG4gICAgICAvLyBDaGlsZCBzaG91bGQgYmUgRk9MREVEICh1cGdyYWRlZCBmcm9tIERST1AsIGhhcyBwYXJlbnQgYW5kIGhhcmQgc2lnbmFsIGluIHN1YnRyZWUpXG4gICAgICAvLyBFcnJvciBzaG91bGQgYmUgS0VQVCAoaGFyZCBzaWduYWwpXG4gICAgICBleHBlY3QoZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoZXZlbnRzLnNvbWUoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Jvb3QnKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChldmVudHMuc29tZShlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3InKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMSk7IC8vIGNoaWxkIGZvbGRlZFxuICAgICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMik7IC8vIHJvb3QgKyBlcnJvclxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBOT1QgcHJvcGFnYXRlIGhhcmQgc2lnbmFsIGFjcm9zcyBzaWJsaW5ncycsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2gnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2hpbGQxOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTEwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQxJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ3NhZmUtb3AnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjaGlsZDI6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTIwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQyJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ2ZhaWxlZC1vcCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1zYWZlJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ3NhZmUtb3AnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBzYWZlIG9wZXJhdGlvbnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIGNoaWxkMSwgY2hpbGQyIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIGNoaWxkMSBzaG91bGQgYmUgRFJPUFBFRCAobm8gaGFyZCBzaWduYWwgaW4gaXRzIG93biBzdWJ0cmVlKVxuICAgICAgLy8gY2hpbGQyIHNob3VsZCBiZSBLRVBUIChlcnJvcilcbiAgICAgIC8vIHJvb3Qgc2hvdWxkIGJlIEtFUFQgKGhhcyBoYXJkIHNpZ25hbCBpbiBzdWJ0cmVlKVxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgICAgZXhwZWN0KGV2ZW50cy5zb21lKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdyb290JykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoZXZlbnRzLnNvbWUoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2NoaWxkMicpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGV2ZW50cy5zb21lKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZDEnKSkudG9CZShmYWxzZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdQaGFzZSAzOiBDb250ZXh0LUF3YXJlIERST1AgTG9naWMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB1cGdyYWRlIERST1AgdG8gS0VFUCBmb3Igcm9vdCB3aXRoIGhhcmQgc2lnbmFsIGluIHN1YnRyZWUgKFBoYXNlIDIpJywgKCkgPT4ge1xuICAgICAgLy8gVGhpcyB0ZXN0cyBQaGFzZSAzIGNvbnRleHQgcHJlc2VydmF0aW9uLCBOT1QgUGhhc2UgMiBwcm90ZWN0aW9uXG4gICAgICAvLyBSb290IGlzIE5PVCBhIGhhcmQgc2lnbmFsIGl0c2VsZiwgYnV0IGhhcyBlcnJvciBjaGlsZFxuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYXBpJyxcbiAgICAgICAgZHVyYXRpb25NczogMjAwLFxuICAgICAgICAvLyBOTyBlcnJvciBwcm9wZXJ0eSAtIHJvb3QgaXMgTk9UIGEgaGFyZCBzaWduYWwgaXRzZWxmXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBlcnJvckNoaWxkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAncGF5bWVudCBmYWlsZWQnLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZ2V0JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJy9eSFRUUCBHRVQvJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgR0VUcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIGVycm9yQ2hpbGQgXSwgY29uZmlnKTtcblxuICAgICAgLy8gRXhwZWN0ZWQ6IFBoYXNlIDIgZXZhbHVhdGVzIHJvb3QgYXMgRFJPUCAobm90IGEgaGFyZCBzaWduYWwpXG4gICAgICAvLyBQaGFzZSAyLjUgc2V0cyBoYXNIYXJkU2lnbmFsSW5TdWJ0cmVlPXRydWUgb24gcm9vdCAoaGFzIGVycm9yIGNoaWxkKVxuICAgICAgLy8gUGhhc2UgMyB1cGdyYWRlcyByb290IGZyb20gRFJPUCB0byBLRUVQIChyb290ICsgaGFzSGFyZFNpZ25hbEluU3VidHJlZSArIG1pbkxldmVsIG1ldClcbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgyKTsgLy8gcm9vdCArIGVycm9yXG4gICAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Jvb3QnKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3InKSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzdGF0cy5rZXB0KS50b0JlKDIpO1xuICAgICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVwZ3JhZGUgRFJPUCB0byBGT0xEIGZvciBub24tcm9vdCB3aXRoIGhhcmQgc2lnbmFsJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdiYXRjaCcsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjaGlsZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDExMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ2Ryb3BwYWJsZScsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGVycm9yOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTIwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ3BheW1lbnQnLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtY2hpbGQnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgb3BlcmF0aW9uOiAnZHJvcHBhYmxlJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3Agbm9pc2UnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290LCBjaGlsZCwgZXJyb3IgXSwgY29uZmlnKTtcblxuICAgICAgLy8gY2hpbGQgc2hvdWxkIGJlIEZPTERFRCAodXBncmFkZWQgZnJvbSBEUk9QIGR1ZSB0byBlcnJvciBkZXNjZW5kYW50KVxuICAgICAgLy8gZXJyb3Igc2hvdWxkIGJlIEtFUFQgYW5kIHJlcGFyZW50ZWQgdG8gcm9vdFxuICAgICAgZXhwZWN0KHN0YXRzLmZvbGRlZCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChldmVudHMuc29tZShlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncm9vdCcpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGV2ZW50cy5zb21lKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdlcnJvcicpKS50b0JlKHRydWUpO1xuXG4gICAgICBjb25zdCBlcnJvckV2ZW50ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Vycm9yJykhO1xuICAgICAgZXhwZWN0KGVycm9yRXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJlc3BlY3QgbWluTGV2ZWwgdGhyZXNob2xkIGZvciBjb250ZXh0IHByZXNlcnZhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IHJvb3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2RlYnVnJywgLy8gQmVsb3cgSU5GTyBtaW5MZXZlbFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZGVidWctc3BhbicsXG4gICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGVycm9yOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTEwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAncGF5bWVudCcsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sIC8vIENvbnRleHQgdGhyZXNob2xkXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWRlYnVnJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBkZWJ1ZyBsb2dzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290LCBlcnJvciBdLCBjb25maWcpO1xuXG4gICAgICAvLyByb290IGhhcyBERUJVRyBsZXZlbCA8IElORk8gbWluTGV2ZWwsIHNvIGRyb3BwZWQgZGVzcGl0ZSBlcnJvciBjaGlsZFxuICAgICAgLy8gZXJyb3IgaXMga2VwdCBhbmQgcmVwYXJlbnRlZCB0byBiZWNvbWUgcm9vdFxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgY29uc3QgZXJyb3JFdmVudCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdlcnJvcicpO1xuICAgICAgZXhwZWN0KGVycm9yRXZlbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoZXJyb3JFdmVudD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGRyb3AgY29tcGxldGVseSB3aGVuIG5vIGhhcmQgc2lnbmFsIGFuZCBubyBrZXB0IGNoaWxkcmVuJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYXBpJyxcbiAgICAgICAgZHVyYXRpb25NczogMjAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2hpbGQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMTAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICBvcGVyYXRpb246ICdkYi5xdWVyeScsXG4gICAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZ2V0JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJy9eSFRUUCBHRVQvJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3Agc3VjY2Vzc2Z1bCBHRVRzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1xdWVyeScsXG4gICAgICAgICAgICBtYXRjaDogeyBvcGVyYXRpb246ICdkYi5xdWVyeScgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGZhc3QgcXVlcmllcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIGNoaWxkIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIEV2ZXJ5dGhpbmcgc2hvdWxkIGJlIGRyb3BwZWQgKG5vIGhhcmQgc2lnbmFscylcbiAgICAgIGV4cGVjdChldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUGVyLVR5cGUgU2xvdyBUaHJlc2hvbGRzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdXNlIHBlci10eXBlIHRocmVzaG9sZCBmb3IgZGF0YWJhc2UgcXVlcmllcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGRiUXVlcnk6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncXVlcnktMScsXG4gICAgICAgIG9wZXJhdGlvbjogJ1NFTEVDVCAqIEZST00gdXNlcnMnLFxuICAgICAgICBkdXJhdGlvbk1zOiAxNTAsIC8vID4gMTAwbXMgdGhyZXNob2xkIGZvciBkYXRhYmFzZS5xdWVyeVxuICAgICAgfTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7fSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGV2ZXJ5dGhpbmcnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGRiUXVlcnkgXSwgY29uZmlnKTtcblxuICAgICAgLy8gU2hvdWxkIGJlIGtlcHQgKHNsb3cgZm9yIGRhdGFiYXNlLnF1ZXJ5KVxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncXVlcnktMScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgZ2xvYmFsIHRocmVzaG9sZCB3aGVuIG5vIHBlci10eXBlIHRocmVzaG9sZCBkZWZpbmVkJywgKCkgPT4ge1xuICAgICAgY29uc3QgZ2VuZXJpY09wOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnb3AtMScsXG4gICAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3MnLFxuICAgICAgICBkdXJhdGlvbk1zOiA2MDAwLCAvLyA+IDUwMDBtcyBnbG9iYWwgdGhyZXNob2xkXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1hbGwnLFxuICAgICAgICAgICAgbWF0Y2g6IHt9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgZXZlcnl0aGluZycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgZ2VuZXJpY09wIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIFNob3VsZCBiZSBrZXB0IChzbG93IGdsb2JhbGx5KVxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgnb3AtMScpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUmVwYXJlbnRpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCByZXBhcmVudCBlcnJvciB3aGVuIHBhcmVudCBkcm9wcGVkIGJlbG93IG1pbkxldmVsJywgKCkgPT4ge1xuICAgICAgY29uc3Qgcm9vdDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIGxldmVsOiAnZGVidWcnLCAvLyBCZWxvdyBJTkZPIHRocmVzaG9sZFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnZHJvcHBhYmxlJyxcbiAgICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2hpbGQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICB0aW1lc3RhbXBNczogMTEwMCxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgb3BlcmF0aW9uOiAnaW1wb3J0YW50JyxcbiAgICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sIC8vIFJvb3QgREVCVUcgPCBJTkZPLCBzbyBkcm9wcGVkXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLXJvb3QnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgb3BlcmF0aW9uOiAnZHJvcHBhYmxlJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3Agbm9pc2UnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIGNoaWxkIF0sIGNvbmZpZyk7XG5cbiAgICAgIC8vIFJvb3QgZHJvcHBlZCAoREVCVUcgPCBJTkZPIG1pbkxldmVsKVxuICAgICAgLy8gQ2hpbGQga2VwdCAoZXJyb3IgPSBoYXJkIHNpZ25hbCkgYW5kIHJlcGFyZW50ZWQgdG8gcm9vdFxuICAgICAgZXhwZWN0KGV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGV2ZW50c1sgMCBdLm9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgnY2hpbGQnKTtcbiAgICAgIGV4cGVjdChldmVudHNbIDAgXS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==