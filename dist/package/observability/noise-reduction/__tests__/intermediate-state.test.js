"use strict";
/**
 * Intermediate State Validation Tests
 *
 * These tests verify internal tree state during noise reduction phases.
 * They test what ACTUALLY happens, not just the final output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../../types");
const testing_1 = require("../testing");
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
describe('Intermediate State Validation', () => {
    describe('Phase 1: Tree Building', () => {
        it('should build valid tree structure', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 1000,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'child',
                    parentObservabilityLogId: 'root',
                    operation: 'child',
                    durationMs: 500,
                },
            ];
            const { tree, roots } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            // Should not throw
            expect(() => (0, testing_1.verifyTreeStructure)(tree)).not.toThrow();
            // Should have 1 root
            expect(roots).toHaveLength(1);
            expect(roots[0].event.observabilityLogId).toBe('root');
            // Root should have 1 child
            const root = (0, testing_1.getNode)(tree, 'root');
            expect(root.children).toHaveLength(1);
            expect(root.children[0].event.observabilityLogId).toBe('child');
            // Child should point to root
            const child = (0, testing_1.getNode)(tree, 'child');
            expect(child.parent).toBe(root);
        });
        it('should handle multiple roots', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root1',
                    operation: 'root1',
                    durationMs: 1000,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'root2',
                    operation: 'root2',
                    durationMs: 500,
                },
            ];
            const { roots } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            expect(roots).toHaveLength(2);
            expect(roots.map(r => r.event.observabilityLogId).sort()).toEqual(['root1', 'root2']);
        });
    });
    describe('Phase 2: Hard Signal Detection', () => {
        it('should correctly mark error events as hard signals', () => {
            const events = [
                {
                    type: 'log',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'info',
                    operation: 'info',
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error',
                    operation: 'error',
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'info', false, baseConfig);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'error', true, baseConfig);
        });
        it('should mark failed operations as hard signals', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'success',
                    operation: 'success',
                    success: true,
                    durationMs: 100,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'failure',
                    operation: 'failure',
                    success: false,
                    durationMs: 100,
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'success', false, baseConfig);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'failure', true, baseConfig);
        });
        it('should mark slow operations as hard signals', () => {
            const config = {
                ...baseConfig,
                hardSignals: {
                    levels: ['error'],
                    slowThresholdMs: 1000,
                },
            };
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'fast',
                    operation: 'fast',
                    durationMs: 500,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'slow',
                    operation: 'slow',
                    durationMs: 2000, // > 1000ms
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, config);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'fast', false, config);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'slow', true, config);
        });
    });
    describe('Phase 2: Decision Evaluation', () => {
        it('should assign correct decisions based on rules', () => {
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
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'info',
                    operation: 'info',
                    durationMs: 100,
                },
                {
                    type: 'log',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'debug',
                    operation: 'debug',
                },
                {
                    type: 'database.query',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'db',
                    operation: 'SELECT',
                    durationMs: 50,
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, config);
            (0, testing_1.expectNodeDecision)(tree, 'info', 'keep'); // No rule, default keep
            (0, testing_1.expectNodeDecision)(tree, 'debug', 'drop'); // drop-debug rule
            (0, testing_1.expectNodeDecision)(tree, 'db', 'fold'); // fold-db rule
        });
        it('should protect hard signals from drop/fold/downgrade', () => {
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'drop-all',
                        match: {},
                        decision: 'drop',
                        reason: 'Drop all',
                    },
                ],
            };
            const events = [
                {
                    type: 'log',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'info',
                    operation: 'info',
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error',
                    operation: 'error',
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, config);
            // Info should be dropped
            (0, testing_1.expectNodeDecision)(tree, 'info', 'drop');
            // Error should be protected (override to keep)
            (0, testing_1.expectNodeDecision)(tree, 'error', 'keep');
            // Verify error is a hard signal
            (0, testing_1.expectNodeIsHardSignal)(tree, 'error', true, config);
        });
        it('should allow aggregate for hard signals', () => {
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'aggregate-errors',
                        match: { level: 'error' },
                        decision: 'aggregate',
                        reason: 'Aggregate errors',
                    },
                ],
            };
            const events = [
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'error',
                    operation: 'error',
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, config);
            // Aggregate is allowed for hard signals (errors visible in stats)
            (0, testing_1.expectNodeDecision)(tree, 'error', 'aggregate');
            (0, testing_1.expectNodeIsHardSignal)(tree, 'error', true, config);
        });
    });
    describe('Phase 2.5: Hard Signal Propagation', () => {
        it('should propagate hasHardSignalInSubtree to ancestors', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 1000,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'mid',
                    parentObservabilityLogId: 'root',
                    operation: 'mid',
                    durationMs: 500,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'mid',
                    operation: 'error',
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            // Verify propagation worked
            expect(() => (0, testing_1.verifyHardSignalPropagation)(tree, baseConfig)).not.toThrow();
            // Error itself
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'error', true);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'error', true, baseConfig);
            // Mid (parent)
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'mid', true);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'mid', false, baseConfig);
            // Root (grandparent)
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'root', true);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'root', false, baseConfig);
        });
        it('should NOT propagate hard signals across siblings', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 1000,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'child1',
                    parentObservabilityLogId: 'root',
                    operation: 'child1',
                    durationMs: 500,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'child2',
                    parentObservabilityLogId: 'root',
                    operation: 'child2',
                },
            ];
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            // Root should have flag (has error child)
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'root', true);
            // child1 should NOT have flag (sibling has error, not descendant)
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'child1', false);
            // child2 should have flag (is itself error)
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'child2', true);
            (0, testing_1.expectNodeIsHardSignal)(tree, 'child2', true, baseConfig);
        });
        it('should handle multiple hard signals in same subtree', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 1000,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error1',
                    parentObservabilityLogId: 'root',
                    operation: 'error1',
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'error2',
                    parentObservabilityLogId: 'root',
                    operation: 'error2',
                },
            ];
            const { tree, nodes } = (0, testing_1.buildAndEvaluateTree)(events, baseConfig);
            // Find all hard signals
            const hardSignals = (0, testing_1.findHardSignalNodes)(nodes, baseConfig);
            expect(hardSignals).toHaveLength(2);
            expect(hardSignals.map(n => n.event.observabilityLogId).sort()).toEqual(['error1', 'error2']);
            // Root should have flag
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'root', true);
            // Both errors should have flag
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'error1', true);
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'error2', true);
        });
    });
    describe('Decision Counts', () => {
        it('should correctly count decisions', () => {
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
                    {
                        id: 'aggregate-items',
                        match: { operation: 'process-item' },
                        decision: 'aggregate',
                        reason: 'Aggregate items',
                    },
                ],
            };
            const events = [
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'root',
                    durationMs: 1000,
                },
                {
                    type: 'log',
                    level: 'debug',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'debug',
                    parentObservabilityLogId: 'root',
                    operation: 'debug',
                },
                {
                    type: 'database.query',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'db',
                    parentObservabilityLogId: 'root',
                    operation: 'SELECT',
                    durationMs: 50,
                },
                {
                    type: 'span',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1030,
                    observabilityLogId: 'item',
                    parentObservabilityLogId: 'root',
                    operation: 'process-item',
                    durationMs: 10,
                },
            ];
            const { nodes } = (0, testing_1.buildAndEvaluateTree)(events, config);
            const counts = (0, testing_1.countNodesByDecision)(nodes);
            expect(counts.keep).toBe(1); // root
            expect(counts.drop).toBe(1); // debug
            expect(counts.fold).toBe(1); // db
            expect(counts.aggregate).toBe(1); // item
        });
    });
    describe('Complex Scenarios', () => {
        it('should handle context preservation detection', () => {
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
            const events = [
                {
                    type: 'span',
                    level: 'info', // Meets minLevel
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'root',
                    operation: 'HTTP GET /api',
                    durationMs: 200,
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
            const { tree } = (0, testing_1.buildAndEvaluateTree)(events, config);
            // Root should be evaluated as DROP (Phase 2)
            (0, testing_1.expectNodeDecision)(tree, 'root', 'drop');
            // But root should have hasHardSignalInSubtree (Phase 2.5)
            (0, testing_1.expectNodeHasHardSignalInSubtree)(tree, 'root', true);
            // Phase 3 will upgrade root from DROP to KEEP (context preservation)
            // This test verifies the PRE-transform state that enables that decision
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZXJtZWRpYXRlLXN0YXRlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL2ludGVybWVkaWF0ZS1zdGF0ZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7R0FLRzs7QUFHSCx1Q0FBaUQ7QUFDakQsd0NBWW9CO0FBRXBCLE1BQU0sVUFBVSxHQUF5QjtJQUN2QyxPQUFPLEVBQUUsSUFBSTtJQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxJQUFJO0lBQ2pDLFdBQVcsRUFBRTtRQUNYLE1BQU0sRUFBRSxDQUFFLE9BQU8sRUFBRSxVQUFVLENBQUU7UUFDL0IsZUFBZSxFQUFFLElBQUk7S0FDdEI7SUFDRCxPQUFPLEVBQUUsRUFBRTtJQUNYLEtBQUssRUFBRSxFQUFFO0lBQ1QsYUFBYSxFQUFFLEtBQUs7SUFDcEIscUJBQXFCLEVBQUUsR0FBRztJQUMxQix1QkFBdUIsRUFBRSxHQUFHO0lBQzVCLDBCQUEwQixFQUFFLENBQUM7SUFDN0IsK0JBQStCLEVBQUUsQ0FBQztJQUNsQyxvQkFBb0IsRUFBRSxJQUFJO0lBQzFCLGVBQWUsRUFBRSxLQUFLO0NBQ3ZCLENBQUM7QUFFRixRQUFRLENBQUMsK0JBQStCLEVBQUUsR0FBRyxFQUFFO0lBQzdDLFFBQVEsQ0FBQyx3QkFBd0IsRUFBRSxHQUFHLEVBQUU7UUFDdEMsRUFBRSxDQUFDLG1DQUFtQyxFQUFFLEdBQUcsRUFBRTtZQUMzQyxNQUFNLE1BQU0sR0FBeUI7Z0JBQ25DO29CQUNFLElBQUksRUFBRSxNQUFNO29CQUNaLEtBQUssRUFBRSxNQUFNO29CQUNiLGFBQWEsRUFBRSxNQUFNO29CQUNyQixXQUFXLEVBQUUsSUFBSTtvQkFDakIsa0JBQWtCLEVBQUUsTUFBTTtvQkFDMUIsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLFVBQVUsRUFBRSxJQUFJO2lCQUNqQjtnQkFD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ZSBWYWxpZGF0aW9uIFRlc3RzXG4gKiBcbiAqIFRoZXNlIHRlc3RzIHZlcmlmeSBpbnRlcm5hbCB0cmVlIHN0YXRlIGR1cmluZyBub2lzZSByZWR1Y3Rpb24gcGhhc2VzLlxuICogVGhleSB0ZXN0IHdoYXQgQUNUVUFMTFkgaGFwcGVucywgbm90IGp1c3QgdGhlIGZpbmFsIG91dHB1dC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCwgTm9pc2VSZWR1Y3Rpb25Db25maWcgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQge1xuICBidWlsZEFuZEV2YWx1YXRlVHJlZSxcbiAgZ2V0Tm9kZSxcbiAgdmVyaWZ5VHJlZVN0cnVjdHVyZSxcbiAgdmVyaWZ5SGFyZFNpZ25hbFByb3BhZ2F0aW9uLFxuICBmaW5kTm9kZXNCeURlY2lzaW9uLFxuICBmaW5kSGFyZFNpZ25hbE5vZGVzLFxuICBmaW5kTm9kZXNXaXRoSGFyZFNpZ25hbEluU3VidHJlZSxcbiAgY291bnROb2Rlc0J5RGVjaXNpb24sXG4gIGV4cGVjdE5vZGVEZWNpc2lvbixcbiAgZXhwZWN0Tm9kZUlzSGFyZFNpZ25hbCxcbiAgZXhwZWN0Tm9kZUhhc0hhcmRTaWduYWxJblN1YnRyZWUsXG59IGZyb20gJy4uL3Rlc3RpbmcnO1xuXG5jb25zdCBiYXNlQ29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgZW5hYmxlZDogdHJ1ZSxcbiAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPLFxuICBoYXJkU2lnbmFsczoge1xuICAgIGxldmVsczogWyAnZXJyb3InLCAnY3JpdGljYWwnIF0sXG4gICAgc2xvd1RocmVzaG9sZE1zOiA1MDAwLFxuICB9LFxuICBwcmVzZXRzOiBbXSxcbiAgcnVsZXM6IFtdLFxuICBlbWl0U3VtbWFyaWVzOiBmYWxzZSxcbiAgbWF4Q2hlY2twb2ludHNQZXJTcGFuOiA1MDAsXG4gIG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuOiAyMDAsXG4gIG1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5OiA1LFxuICBtYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5OiAzLFxuICBpbmNsdWRlRGVidWdNZXRhZGF0YTogdHJ1ZSxcbiAgaW5jbHVkZUV4YW1wbGVzOiBmYWxzZSxcbn07XG5cbmRlc2NyaWJlKCdJbnRlcm1lZGlhdGUgU3RhdGUgVmFsaWRhdGlvbicsICgpID0+IHtcbiAgZGVzY3JpYmUoJ1BoYXNlIDE6IFRyZWUgQnVpbGRpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBidWlsZCB2YWxpZCB0cmVlIHN0cnVjdHVyZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnY2hpbGQnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IHsgdHJlZSwgcm9vdHMgfSA9IGJ1aWxkQW5kRXZhbHVhdGVUcmVlKGV2ZW50cywgYmFzZUNvbmZpZyk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3dcbiAgICAgIGV4cGVjdCgoKSA9PiB2ZXJpZnlUcmVlU3RydWN0dXJlKHRyZWUpKS5ub3QudG9UaHJvdygpO1xuXG4gICAgICAvLyBTaG91bGQgaGF2ZSAxIHJvb3RcbiAgICAgIGV4cGVjdChyb290cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJvb3RzWyAwIF0uZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdyb290Jyk7XG5cbiAgICAgIC8vIFJvb3Qgc2hvdWxkIGhhdmUgMSBjaGlsZFxuICAgICAgY29uc3Qgcm9vdCA9IGdldE5vZGUodHJlZSwgJ3Jvb3QnKSE7XG4gICAgICBleHBlY3Qocm9vdC5jaGlsZHJlbikudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KHJvb3QuY2hpbGRyZW5bIDAgXS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ2NoaWxkJyk7XG5cbiAgICAgIC8vIENoaWxkIHNob3VsZCBwb2ludCB0byByb290XG4gICAgICBjb25zdCBjaGlsZCA9IGdldE5vZGUodHJlZSwgJ2NoaWxkJykhO1xuICAgICAgZXhwZWN0KGNoaWxkLnBhcmVudCkudG9CZShyb290KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG11bHRpcGxlIHJvb3RzJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290MScsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdDEnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdDInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Jvb3QyJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiA1MDAsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCB7IHJvb3RzIH0gPSBidWlsZEFuZEV2YWx1YXRlVHJlZShldmVudHMsIGJhc2VDb25maWcpO1xuXG4gICAgICBleHBlY3Qocm9vdHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdChyb290cy5tYXAociA9PiByLmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCkuc29ydCgpKS50b0VxdWFsKFsgJ3Jvb3QxJywgJ3Jvb3QyJyBdKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1BoYXNlIDI6IEhhcmQgU2lnbmFsIERldGVjdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNvcnJlY3RseSBtYXJrIGVycm9yIGV2ZW50cyBhcyBoYXJkIHNpZ25hbHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaW5mbycsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnaW5mbycsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yJyxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IHsgdHJlZSB9ID0gYnVpbGRBbmRFdmFsdWF0ZVRyZWUoZXZlbnRzLCBiYXNlQ29uZmlnKTtcblxuICAgICAgZXhwZWN0Tm9kZUlzSGFyZFNpZ25hbCh0cmVlLCAnaW5mbycsIGZhbHNlLCBiYXNlQ29uZmlnKTtcbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ2Vycm9yJywgdHJ1ZSwgYmFzZUNvbmZpZyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1hcmsgZmFpbGVkIG9wZXJhdGlvbnMgYXMgaGFyZCBzaWduYWxzJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzdWNjZXNzJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdzdWNjZXNzJyxcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYWlsdXJlJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdmYWlsdXJlJyxcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCB7IHRyZWUgfSA9IGJ1aWxkQW5kRXZhbHVhdGVUcmVlKGV2ZW50cywgYmFzZUNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ3N1Y2Nlc3MnLCBmYWxzZSwgYmFzZUNvbmZpZyk7XG4gICAgICBleHBlY3ROb2RlSXNIYXJkU2lnbmFsKHRyZWUsICdmYWlsdXJlJywgdHJ1ZSwgYmFzZUNvbmZpZyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG1hcmsgc2xvdyBvcGVyYXRpb25zIGFzIGhhcmQgc2lnbmFscycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIGhhcmRTaWduYWxzOiB7XG4gICAgICAgICAgbGV2ZWxzOiBbICdlcnJvcicgXSxcbiAgICAgICAgICBzbG93VGhyZXNob2xkTXM6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Zhc3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Zhc3QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdzbG93JyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAyMDAwLCAvLyA+IDEwMDBtc1xuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyB0cmVlIH0gPSBidWlsZEFuZEV2YWx1YXRlVHJlZShldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ2Zhc3QnLCBmYWxzZSwgY29uZmlnKTtcbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ3Nsb3cnLCB0cnVlLCBjb25maWcpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUGhhc2UgMjogRGVjaXNpb24gRXZhbHVhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGFzc2lnbiBjb3JyZWN0IGRlY2lzaW9ucyBiYXNlZCBvbiBydWxlcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWRlYnVnJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IGxldmVsOiAnZGVidWcnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBkZWJ1ZycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2ZvbGQtZGInLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgcXVlcmllcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaW5mbycsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnaW5mbycsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RlYnVnJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdkZWJ1ZycsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDIwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RiJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdTRUxFQ1QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyB0cmVlIH0gPSBidWlsZEFuZEV2YWx1YXRlVHJlZShldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdE5vZGVEZWNpc2lvbih0cmVlLCAnaW5mbycsICdrZWVwJyk7IC8vIE5vIHJ1bGUsIGRlZmF1bHQga2VlcFxuICAgICAgZXhwZWN0Tm9kZURlY2lzaW9uKHRyZWUsICdkZWJ1ZycsICdkcm9wJyk7IC8vIGRyb3AtZGVidWcgcnVsZVxuICAgICAgZXhwZWN0Tm9kZURlY2lzaW9uKHRyZWUsICdkYicsICdmb2xkJyk7IC8vIGZvbGQtZGIgcnVsZVxuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcm90ZWN0IGhhcmQgc2lnbmFscyBmcm9tIGRyb3AvZm9sZC9kb3duZ3JhZGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZHJvcC1hbGwnLFxuICAgICAgICAgICAgbWF0Y2g6IHt9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgYWxsJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2luZm8nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2luZm8nLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdlcnJvcicsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCB7IHRyZWUgfSA9IGJ1aWxkQW5kRXZhbHVhdGVUcmVlKGV2ZW50cywgY29uZmlnKTtcblxuICAgICAgLy8gSW5mbyBzaG91bGQgYmUgZHJvcHBlZFxuICAgICAgZXhwZWN0Tm9kZURlY2lzaW9uKHRyZWUsICdpbmZvJywgJ2Ryb3AnKTtcblxuICAgICAgLy8gRXJyb3Igc2hvdWxkIGJlIHByb3RlY3RlZCAob3ZlcnJpZGUgdG8ga2VlcClcbiAgICAgIGV4cGVjdE5vZGVEZWNpc2lvbih0cmVlLCAnZXJyb3InLCAna2VlcCcpO1xuXG4gICAgICAvLyBWZXJpZnkgZXJyb3IgaXMgYSBoYXJkIHNpZ25hbFxuICAgICAgZXhwZWN0Tm9kZUlzSGFyZFNpZ25hbCh0cmVlLCAnZXJyb3InLCB0cnVlLCBjb25maWcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBhbGxvdyBhZ2dyZWdhdGUgZm9yIGhhcmQgc2lnbmFscycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogTm9pc2VSZWR1Y3Rpb25Db25maWcgPSB7XG4gICAgICAgIC4uLmJhc2VDb25maWcsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdhZ2dyZWdhdGUtZXJyb3JzJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IGxldmVsOiAnZXJyb3InIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2FnZ3JlZ2F0ZScsXG4gICAgICAgICAgICByZWFzb246ICdBZ2dyZWdhdGUgZXJyb3JzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXJyb3InLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyB0cmVlIH0gPSBidWlsZEFuZEV2YWx1YXRlVHJlZShldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIC8vIEFnZ3JlZ2F0ZSBpcyBhbGxvd2VkIGZvciBoYXJkIHNpZ25hbHMgKGVycm9ycyB2aXNpYmxlIGluIHN0YXRzKVxuICAgICAgZXhwZWN0Tm9kZURlY2lzaW9uKHRyZWUsICdlcnJvcicsICdhZ2dyZWdhdGUnKTtcbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ2Vycm9yJywgdHJ1ZSwgY29uZmlnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1BoYXNlIDIuNTogSGFyZCBTaWduYWwgUHJvcGFnYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBwcm9wYWdhdGUgaGFzSGFyZFNpZ25hbEluU3VidHJlZSB0byBhbmNlc3RvcnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Jvb3QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMTAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWlkJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdtaWQnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAyMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWlkJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdlcnJvcicsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCB7IHRyZWUgfSA9IGJ1aWxkQW5kRXZhbHVhdGVUcmVlKGV2ZW50cywgYmFzZUNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBwcm9wYWdhdGlvbiB3b3JrZWRcbiAgICAgIGV4cGVjdCgoKSA9PiB2ZXJpZnlIYXJkU2lnbmFsUHJvcGFnYXRpb24odHJlZSwgYmFzZUNvbmZpZykpLm5vdC50b1Rocm93KCk7XG5cbiAgICAgIC8vIEVycm9yIGl0c2VsZlxuICAgICAgZXhwZWN0Tm9kZUhhc0hhcmRTaWduYWxJblN1YnRyZWUodHJlZSwgJ2Vycm9yJywgdHJ1ZSk7XG4gICAgICBleHBlY3ROb2RlSXNIYXJkU2lnbmFsKHRyZWUsICdlcnJvcicsIHRydWUsIGJhc2VDb25maWcpO1xuXG4gICAgICAvLyBNaWQgKHBhcmVudClcbiAgICAgIGV4cGVjdE5vZGVIYXNIYXJkU2lnbmFsSW5TdWJ0cmVlKHRyZWUsICdtaWQnLCB0cnVlKTtcbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ21pZCcsIGZhbHNlLCBiYXNlQ29uZmlnKTtcblxuICAgICAgLy8gUm9vdCAoZ3JhbmRwYXJlbnQpXG4gICAgICBleHBlY3ROb2RlSGFzSGFyZFNpZ25hbEluU3VidHJlZSh0cmVlLCAncm9vdCcsIHRydWUpO1xuICAgICAgZXhwZWN0Tm9kZUlzSGFyZFNpZ25hbCh0cmVlLCAncm9vdCcsIGZhbHNlLCBiYXNlQ29uZmlnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIHByb3BhZ2F0ZSBoYXJkIHNpZ25hbHMgYWNyb3NzIHNpYmxpbmdzJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdyb290JyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkMScsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnY2hpbGQxJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiA1MDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQyJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdjaGlsZDInLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyB0cmVlIH0gPSBidWlsZEFuZEV2YWx1YXRlVHJlZShldmVudHMsIGJhc2VDb25maWcpO1xuXG4gICAgICAvLyBSb290IHNob3VsZCBoYXZlIGZsYWcgKGhhcyBlcnJvciBjaGlsZClcbiAgICAgIGV4cGVjdE5vZGVIYXNIYXJkU2lnbmFsSW5TdWJ0cmVlKHRyZWUsICdyb290JywgdHJ1ZSk7XG5cbiAgICAgIC8vIGNoaWxkMSBzaG91bGQgTk9UIGhhdmUgZmxhZyAoc2libGluZyBoYXMgZXJyb3IsIG5vdCBkZXNjZW5kYW50KVxuICAgICAgZXhwZWN0Tm9kZUhhc0hhcmRTaWduYWxJblN1YnRyZWUodHJlZSwgJ2NoaWxkMScsIGZhbHNlKTtcblxuICAgICAgLy8gY2hpbGQyIHNob3VsZCBoYXZlIGZsYWcgKGlzIGl0c2VsZiBlcnJvcilcbiAgICAgIGV4cGVjdE5vZGVIYXNIYXJkU2lnbmFsSW5TdWJ0cmVlKHRyZWUsICdjaGlsZDInLCB0cnVlKTtcbiAgICAgIGV4cGVjdE5vZGVJc0hhcmRTaWduYWwodHJlZSwgJ2NoaWxkMicsIHRydWUsIGJhc2VDb25maWcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbXVsdGlwbGUgaGFyZCBzaWduYWxzIGluIHNhbWUgc3VidHJlZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcjEnLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yMScsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3IyJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdlcnJvcjInLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyB0cmVlLCBub2RlcyB9ID0gYnVpbGRBbmRFdmFsdWF0ZVRyZWUoZXZlbnRzLCBiYXNlQ29uZmlnKTtcblxuICAgICAgLy8gRmluZCBhbGwgaGFyZCBzaWduYWxzXG4gICAgICBjb25zdCBoYXJkU2lnbmFscyA9IGZpbmRIYXJkU2lnbmFsTm9kZXMobm9kZXMsIGJhc2VDb25maWcpO1xuICAgICAgZXhwZWN0KGhhcmRTaWduYWxzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoaGFyZFNpZ25hbHMubWFwKG4gPT4gbi5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpLnNvcnQoKSkudG9FcXVhbChbICdlcnJvcjEnLCAnZXJyb3IyJyBdKTtcblxuICAgICAgLy8gUm9vdCBzaG91bGQgaGF2ZSBmbGFnXG4gICAgICBleHBlY3ROb2RlSGFzSGFyZFNpZ25hbEluU3VidHJlZSh0cmVlLCAncm9vdCcsIHRydWUpO1xuXG4gICAgICAvLyBCb3RoIGVycm9ycyBzaG91bGQgaGF2ZSBmbGFnXG4gICAgICBleHBlY3ROb2RlSGFzSGFyZFNpZ25hbEluU3VidHJlZSh0cmVlLCAnZXJyb3IxJywgdHJ1ZSk7XG4gICAgICBleHBlY3ROb2RlSGFzSGFyZFNpZ25hbEluU3VidHJlZSh0cmVlLCAnZXJyb3IyJywgdHJ1ZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdEZWNpc2lvbiBDb3VudHMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjb3JyZWN0bHkgY291bnQgZGVjaXNpb25zJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZGVidWcnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGRlYnVnJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnZm9sZC1kYicsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnZGF0YWJhc2UucXVlcnknIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgICAgcmVhc29uOiAnRm9sZCBxdWVyaWVzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAnYWdncmVnYXRlLWl0ZW1zJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJ3Byb2Nlc3MtaXRlbScgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0FnZ3JlZ2F0ZSBpdGVtcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdkZWJ1ZycsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZGVidWcnLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAyMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdkYicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnU0VMRUNUJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAzMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdpdGVtJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdwcm9jZXNzLWl0ZW0nLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyBub2RlcyB9ID0gYnVpbGRBbmRFdmFsdWF0ZVRyZWUoZXZlbnRzLCBjb25maWcpO1xuICAgICAgY29uc3QgY291bnRzID0gY291bnROb2Rlc0J5RGVjaXNpb24obm9kZXMpO1xuXG4gICAgICBleHBlY3QoY291bnRzLmtlZXApLnRvQmUoMSk7IC8vIHJvb3RcbiAgICAgIGV4cGVjdChjb3VudHMuZHJvcCkudG9CZSgxKTsgLy8gZGVidWdcbiAgICAgIGV4cGVjdChjb3VudHMuZm9sZCkudG9CZSgxKTsgLy8gZGJcbiAgICAgIGV4cGVjdChjb3VudHMuYWdncmVnYXRlKS50b0JlKDEpOyAvLyBpdGVtXG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDb21wbGV4IFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb250ZXh0IHByZXNlcnZhdGlvbiBkZXRlY3Rpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlQ29uZmlnLFxuICAgICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICdkcm9wLWFsbCcsXG4gICAgICAgICAgICBtYXRjaDoge30sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBhbGwnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsIC8vIE1lZXRzIG1pbkxldmVsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hcGknLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDIwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXJyb3InLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgeyB0cmVlIH0gPSBidWlsZEFuZEV2YWx1YXRlVHJlZShldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIC8vIFJvb3Qgc2hvdWxkIGJlIGV2YWx1YXRlZCBhcyBEUk9QIChQaGFzZSAyKVxuICAgICAgZXhwZWN0Tm9kZURlY2lzaW9uKHRyZWUsICdyb290JywgJ2Ryb3AnKTtcblxuICAgICAgLy8gQnV0IHJvb3Qgc2hvdWxkIGhhdmUgaGFzSGFyZFNpZ25hbEluU3VidHJlZSAoUGhhc2UgMi41KVxuICAgICAgZXhwZWN0Tm9kZUhhc0hhcmRTaWduYWxJblN1YnRyZWUodHJlZSwgJ3Jvb3QnLCB0cnVlKTtcblxuICAgICAgLy8gUGhhc2UgMyB3aWxsIHVwZ3JhZGUgcm9vdCBmcm9tIERST1AgdG8gS0VFUCAoY29udGV4dCBwcmVzZXJ2YXRpb24pXG4gICAgICAvLyBUaGlzIHRlc3QgdmVyaWZpZXMgdGhlIFBSRS10cmFuc2Zvcm0gc3RhdGUgdGhhdCBlbmFibGVzIHRoYXQgZGVjaXNpb25cbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==