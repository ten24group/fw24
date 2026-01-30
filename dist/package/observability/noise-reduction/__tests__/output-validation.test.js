"use strict";
/**
 * Output Validation Tests
 *
 * Tests that verify noise reduction output quality beyond just counts.
 * Validates hierarchy integrity, checkpoints, and data completeness.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const types_1 = require("../../types");
const test_helpers_1 = require("./test-helpers");
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
describe('Output Validation', () => {
    describe('Hierarchy Integrity', () => {
        it('should ensure all events have valid parent references', () => {
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
                    level: 'debug',
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
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // Should not throw - all parent references valid
            expect(() => (0, test_helpers_1.verifyKeptHierarchy)(output)).not.toThrow();
            // Mid dropped, error reparented to root
            expect(output).toHaveLength(2);
            const errorOut = (0, test_helpers_1.findEvent)(output, 'error');
            expect(errorOut.parentObservabilityLogId).toBe('root');
        });
        it('should ensure all errors are kept', () => {
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
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            const errors = (0, test_helpers_1.findErrors)(output);
            expect(errors).toHaveLength(2);
            expect(errors.map(e => e.observabilityLogId).sort()).toEqual(['error1', 'error2']);
        });
    });
    describe('Checkpoint Validation', () => {
        it('should create checkpoints when folding children', () => {
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
                    type: 'database.query',
                    level: 'info',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'db',
                    parentObservabilityLogId: 'root',
                    operation: 'SELECT',
                    durationMs: 50,
                },
                {
                    type: 'log',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1020,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'root',
                    operation: 'error',
                },
            ];
            const config = {
                ...baseConfig,
                rules: [
                    {
                        id: 'fold-db',
                        match: { type: 'database.query' },
                        decision: 'fold',
                        reason: 'Fold DB',
                    },
                ],
            };
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            const root = (0, test_helpers_1.findEvent)(output, 'root');
            expect((0, test_helpers_1.hasCheckpoints)(root)).toBe(true);
            const names = (0, test_helpers_1.getCheckpointNames)(root);
            expect(names.some(n => n.includes('fold'))).toBe(true);
        });
        it('should create checkpoints when context is preserved', () => {
            const events = [
                {
                    type: 'span',
                    level: 'info',
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
            const { events: output } = (0, index_1.applyNoiseReduction)(events, config);
            // Root upgraded from DROP to KEEP (context for error)
            const root = (0, test_helpers_1.findEvent)(output, 'root');
            expect(root).toBeDefined();
            const names = (0, test_helpers_1.getCheckpointNames)(root);
            expect(names.some(n => n.includes('context'))).toBe(true);
        });
    });
    describe('Data Completeness', () => {
        it('should preserve all error information', () => {
            const errorData = {
                type: 'ValidationError',
                message: 'Field is required',
                stack: 'Error: Field is required\n  at validate',
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
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1010,
                    observabilityLogId: 'error',
                    parentObservabilityLogId: 'root',
                    operation: 'validation',
                    error: errorData,
                },
            ];
            const { events: output } = (0, index_1.applyNoiseReduction)(events, baseConfig);
            const errorOut = (0, test_helpers_1.findEvent)(output, 'error');
            expect(errorOut.error).toEqual(errorData);
        });
        it('should preserve metrics and tags', () => {
            const metrics = { itemsProcessed: 100, errorCount: 5 };
            const tags = { userId: 'user-123', tenantId: 'tenant-456' };
            const events = [
                {
                    type: 'span',
                    level: 'error',
                    correlationId: 'test',
                    timestampMs: 1000,
                    observabilityLogId: 'span',
                    operation: 'batch',
                    durationMs: 1000,
                    metrics,
                    tags,
                },
            ];
            const { events: output } = (0, index_1.applyNoiseReduction)(events, baseConfig);
            const span = (0, test_helpers_1.findEvent)(output, 'span');
            expect(span.metrics).toEqual(metrics);
            expect(span.tags).toEqual(tags);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3V0cHV0LXZhbGlkYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9fX3Rlc3RzX18vb3V0cHV0LXZhbGlkYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7O0dBS0c7O0FBRUgsb0NBQStDO0FBRS9DLHVDQUFpRDtBQUNqRCxpREFNd0I7QUFFeEIsTUFBTSxVQUFVLEdBQXlCO0lBQ3ZDLE9BQU8sRUFBRSxJQUFJO0lBQ2IsUUFBUSxFQUFFLDBCQUFrQixDQUFDLElBQUk7SUFDakMsV0FBVyxFQUFFO1FBQ1gsTUFBTSxFQUFFLENBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBRTtRQUMvQixlQUFlLEVBQUUsSUFBSTtLQUN0QjtJQUNELE9BQU8sRUFBRSxFQUFFO0lBQ1gsS0FBSyxFQUFFLEVBQUU7SUFDVCxhQUFhLEVBQUUsS0FBSztJQUNwQixxQkFBcUIsRUFBRSxHQUFHO0lBQzFCLHVCQUF1QixFQUFFLEdBQUc7SUFDNUIsMEJBQTBCLEVBQUUsQ0FBQztJQUM3QiwrQkFBK0IsRUFBRSxDQUFDO0lBQ2xDLG9CQUFvQixFQUFFLElBQUk7SUFDMUIsZUFBZSxFQUFFLEtBQUs7Q0FDdkIsQ0FBQztBQUVGLFFBQVEsQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLEVBQUU7SUFDakMsUUFBUSxDQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRTtRQUNuQyxFQUFFLENBQUMsdURBQXVELEVBQUUsR0FBRyxFQUFFO1lBQy9ELE1BQU0sTUFBTSxHQUF5QjtnQkFDbkM7b0JBQ0UsSUFBSSxFQUFFLE1BQU07b0JBQ1osS0FBSyxFQUFFLE1BQU07b0JBQ2IsYUFBYSxFQUFFLE1BQU07b0JBQ3JCLFdBQVcsRUFBRSxJQUFJO29CQUNqQixrQkFBa0IsRUFBRSxNQUFNO29CQUMxQixTQUFTLEVBQUUsTUFBTTtvQkFDakIsVUFBVSxFQUFFLElBQUk7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TztvQkFDZCxhQUFhLEVBQUUsTUFBTTtvQkFDckIsV0FBVyxFQUFFLElBQUk7b0JBQ2pCLGtCQUFrQixFQUFFLE1BQU07b0JBQzFCLFNBQVMsRUFBRSxPQUFPO29CQUNsQixVQUFVLEVBQUUsSUFBSTtvQkFDaEIsT0FBTztvQkFDUCxJQUFJO2lCQUNMO2FBQ0YsQ0FBQztZQUVGLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsSUFBQSwyQkFBbUIsRUFBQyxNQUFNLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFFbkUsTUFBTSxJQUFJLEdBQUcsSUFBQSx3QkFBUyxFQUFDLE1BQU0sRUFBRSxNQUFNLENBQUUsQ0FBQztZQUN4QyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN0QyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNsQyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE91dHB1dCBWYWxpZGF0aW9uIFRlc3RzXG4gKiBcbiAqIFRlc3RzIHRoYXQgdmVyaWZ5IG5vaXNlIHJlZHVjdGlvbiBvdXRwdXQgcXVhbGl0eSBiZXlvbmQganVzdCBjb3VudHMuXG4gKiBWYWxpZGF0ZXMgaGllcmFyY2h5IGludGVncml0eSwgY2hlY2twb2ludHMsIGFuZCBkYXRhIGNvbXBsZXRlbmVzcy5cbiAqL1xuXG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uIH0gZnJvbSAnLi4vaW5kZXgnO1xuaW1wb3J0IHR5cGUgeyBPYnNlcnZhYmlsaXR5RXZlbnQsIE5vaXNlUmVkdWN0aW9uQ29uZmlnIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuaW1wb3J0IHtcbiAgdmVyaWZ5S2VwdEhpZXJhcmNoeSxcbiAgZmluZEV2ZW50LFxuICBoYXNDaGVja3BvaW50cyxcbiAgZ2V0Q2hlY2twb2ludE5hbWVzLFxuICBmaW5kRXJyb3JzLFxufSBmcm9tICcuL3Rlc3QtaGVscGVycyc7XG5cbmNvbnN0IGJhc2VDb25maWc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnID0ge1xuICBlbmFibGVkOiB0cnVlLFxuICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLklORk8sXG4gIGhhcmRTaWduYWxzOiB7XG4gICAgbGV2ZWxzOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSxcbiAgICBzbG93VGhyZXNob2xkTXM6IDUwMDAsXG4gIH0sXG4gIHByZXNldHM6IFtdLFxuICBydWxlczogW10sXG4gIGVtaXRTdW1tYXJpZXM6IGZhbHNlLFxuICBtYXhDaGVja3BvaW50c1BlclNwYW46IDUwMCxcbiAgbWF4QWdncmVnYXRlS2V5c1BlclNwYW46IDIwMCxcbiAgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXk6IDUsXG4gIG1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXk6IDMsXG4gIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICBpbmNsdWRlRXhhbXBsZXM6IGZhbHNlLFxufTtcblxuZGVzY3JpYmUoJ091dHB1dCBWYWxpZGF0aW9uJywgKCkgPT4ge1xuICBkZXNjcmliZSgnSGllcmFyY2h5IEludGVncml0eScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGVuc3VyZSBhbGwgZXZlbnRzIGhhdmUgdmFsaWQgcGFyZW50IHJlZmVyZW5jZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ3Jvb3QnLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDEwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ21pZCcsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnbWlkJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiA1MDAsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3InLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ21pZCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXJyb3InLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZGVidWcnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgbGV2ZWw6ICdkZWJ1ZycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGRlYnVnJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgY29uc3QgeyBldmVudHM6IG91dHB1dCB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihldmVudHMsIGNvbmZpZyk7XG5cbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3cgLSBhbGwgcGFyZW50IHJlZmVyZW5jZXMgdmFsaWRcbiAgICAgIGV4cGVjdCgoKSA9PiB2ZXJpZnlLZXB0SGllcmFyY2h5KG91dHB1dCkpLm5vdC50b1Rocm93KCk7XG5cbiAgICAgIC8vIE1pZCBkcm9wcGVkLCBlcnJvciByZXBhcmVudGVkIHRvIHJvb3RcbiAgICAgIGV4cGVjdChvdXRwdXQpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGNvbnN0IGVycm9yT3V0ID0gZmluZEV2ZW50KG91dHB1dCwgJ2Vycm9yJykhO1xuICAgICAgZXhwZWN0KGVycm9yT3V0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZSgncm9vdCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBlbnN1cmUgYWxsIGVycm9ycyBhcmUga2VwdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcjEnLFxuICAgICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2Vycm9yMScsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMjAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXJyb3IyJyxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdlcnJvcjInLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7fSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGFsbCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzOiBvdXRwdXQgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcpO1xuXG4gICAgICBjb25zdCBlcnJvcnMgPSBmaW5kRXJyb3JzKG91dHB1dCk7XG4gICAgICBleHBlY3QoZXJyb3JzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoZXJyb3JzLm1hcChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkKS5zb3J0KCkpLnRvRXF1YWwoWyAnZXJyb3IxJywgJ2Vycm9yMicgXSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdDaGVja3BvaW50IFZhbGlkYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgY2hlY2twb2ludHMgd2hlbiBmb2xkaW5nIGNoaWxkcmVuJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdyb290JyxcbiAgICAgICAgICBvcGVyYXRpb246ICdyb290JyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiAxMDAwLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdkYicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnU0VMRUNUJyxcbiAgICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAyMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXJyb3InLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2ZvbGQtZGInLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgREInLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBjb25zdCB7IGV2ZW50czogb3V0cHV0IH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnKTtcblxuICAgICAgY29uc3Qgcm9vdCA9IGZpbmRFdmVudChvdXRwdXQsICdyb290JykhO1xuICAgICAgZXhwZWN0KGhhc0NoZWNrcG9pbnRzKHJvb3QpKS50b0JlKHRydWUpO1xuXG4gICAgICBjb25zdCBuYW1lcyA9IGdldENoZWNrcG9pbnROYW1lcyhyb290KTtcbiAgICAgIGV4cGVjdChuYW1lcy5zb21lKG4gPT4gbi5pbmNsdWRlcygnZm9sZCcpKSkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIGNoZWNrcG9pbnRzIHdoZW4gY29udGV4dCBpcyBwcmVzZXJ2ZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICAgIHRpbWVzdGFtcE1zOiAxMDAwLFxuICAgICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hcGknLFxuICAgICAgICAgIGR1cmF0aW9uTXM6IDIwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnZXJyb3InLFxuICAgICAgICB9LFxuICAgICAgXTtcblxuICAgICAgY29uc3QgY29uZmlnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyA9IHtcbiAgICAgICAgLi4uYmFzZUNvbmZpZyxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2Ryb3AtZ2V0JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IG9wZXJhdGlvbjogJy9eSFRUUCBHRVQvJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgR0VUcycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzOiBvdXRwdXQgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcpO1xuXG4gICAgICAvLyBSb290IHVwZ3JhZGVkIGZyb20gRFJPUCB0byBLRUVQIChjb250ZXh0IGZvciBlcnJvcilcbiAgICAgIGNvbnN0IHJvb3QgPSBmaW5kRXZlbnQob3V0cHV0LCAncm9vdCcpITtcbiAgICAgIGV4cGVjdChyb290KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgICBjb25zdCBuYW1lcyA9IGdldENoZWNrcG9pbnROYW1lcyhyb290KTtcbiAgICAgIGV4cGVjdChuYW1lcy5zb21lKG4gPT4gbi5pbmNsdWRlcygnY29udGV4dCcpKSkudG9CZSh0cnVlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0RhdGEgQ29tcGxldGVuZXNzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcHJlc2VydmUgYWxsIGVycm9yIGluZm9ybWF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgZXJyb3JEYXRhID0ge1xuICAgICAgICB0eXBlOiAnVmFsaWRhdGlvbkVycm9yJyxcbiAgICAgICAgbWVzc2FnZTogJ0ZpZWxkIGlzIHJlcXVpcmVkJyxcbiAgICAgICAgc3RhY2s6ICdFcnJvcjogRmllbGQgaXMgcmVxdWlyZWRcXG4gIGF0IHZhbGlkYXRlJyxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXG4gICAgICAgIHtcbiAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgICAgdGltZXN0YW1wTXM6IDEwMDAsXG4gICAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAncm9vdCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAxMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvcicsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICAgICAgb3BlcmF0aW9uOiAndmFsaWRhdGlvbicsXG4gICAgICAgICAgZXJyb3I6IGVycm9yRGF0YSxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgICAgIGNvbnN0IHsgZXZlbnRzOiBvdXRwdXQgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBiYXNlQ29uZmlnKTtcblxuICAgICAgY29uc3QgZXJyb3JPdXQgPSBmaW5kRXZlbnQob3V0cHV0LCAnZXJyb3InKSE7XG4gICAgICBleHBlY3QoZXJyb3JPdXQuZXJyb3IpLnRvRXF1YWwoZXJyb3JEYXRhKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcHJlc2VydmUgbWV0cmljcyBhbmQgdGFncycsICgpID0+IHtcbiAgICAgIGNvbnN0IG1ldHJpY3MgPSB7IGl0ZW1zUHJvY2Vzc2VkOiAxMDAsIGVycm9yQ291bnQ6IDUgfTtcbiAgICAgIGNvbnN0IHRhZ3MgPSB7IHVzZXJJZDogJ3VzZXItMTIzJywgdGVuYW50SWQ6ICd0ZW5hbnQtNDU2JyB9O1xuXG4gICAgICBjb25zdCBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW1xuICAgICAgICB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgICB0aW1lc3RhbXBNczogMTAwMCxcbiAgICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzcGFuJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdiYXRjaCcsXG4gICAgICAgICAgZHVyYXRpb25NczogMTAwMCxcbiAgICAgICAgICBtZXRyaWNzLFxuICAgICAgICAgIHRhZ3MsXG4gICAgICAgIH0sXG4gICAgICBdO1xuXG4gICAgICBjb25zdCB7IGV2ZW50czogb3V0cHV0IH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgYmFzZUNvbmZpZyk7XG5cbiAgICAgIGNvbnN0IHNwYW4gPSBmaW5kRXZlbnQob3V0cHV0LCAnc3BhbicpITtcbiAgICAgIGV4cGVjdChzcGFuLm1ldHJpY3MpLnRvRXF1YWwobWV0cmljcyk7XG4gICAgICBleHBlY3Qoc3Bhbi50YWdzKS50b0VxdWFsKHRhZ3MpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19