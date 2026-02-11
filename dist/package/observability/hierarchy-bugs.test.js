"use strict";
/**
 * Tests for hierarchy preservation and span.start filtering bugs
 *
 * These tests reproduce the exact issues seen in production:
 * 1. span.start events reaching DynamoDB (should be OTEL only)
 * 2. Parent spans being filtered while children are captured
 * 3. Broken parent references in the resulting logs
 */
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("./testing");
const span_1 = require("./observers/span");
const manager_1 = require("./manager");
const types_1 = require("./types");
describe('Hierarchy Preservation Bugs', () => {
    let mockBackend;
    beforeEach(() => {
        mockBackend = (0, testing_1.setupTestObservability)({
            minLevel: types_1.ObservabilityLevel.TRACE,
            // These are the problematic defaults that cause hierarchy issues
            minSpanDurationMs: 50,
            skipEmptySpans: true,
        });
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    describe('span.start DynamoDB filtering', () => {
        it('should NOT include span.start events in non-OTEL backends', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('testOperation', async (span) => {
                    span.checkpoint('doing_work');
                    await new Promise(resolve => setTimeout(resolve, 60)); // Longer than minDurationMs
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            const spanStartEvents = events.filter(e => e.type === 'span.start');
            const spanEvents = events.filter(e => e.type === 'span');
            // span.start should NOT reach MockBackend (simulating DynamoDB)
            // They should be filtered by capture.backends = ['otel']
            expect(spanStartEvents.length).toBe(0);
            expect(spanEvents.length).toBeGreaterThanOrEqual(1);
        });
        it('should verify span.start has backends filter set to otel only', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('filterTest', async (span) => {
                    span.tag('test', 'value');
                });
                await manager_1.ObservabilityManager.flush();
            });
            const events = mockBackend.getEvents();
            const spanStartEvents = events.filter(e => e.type === 'span.start');
            // If any span.start events reached the backend, check their capture.backends
            for (const event of spanStartEvents) {
                // This should fail if span.start events reach non-OTEL backends
                expect(event.capture?.backends).toEqual(['otel']);
            }
        });
    });
    describe('Parent span hierarchy preservation', () => {
        it('should capture parent spans even if children take longer', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // Parent span is fast (0ms work)
                // But it has children that do actual work
                await (0, span_1.withSpan)('fastParent', async () => {
                    // Multiple child operations (simulating Promise.allSettled)
                    await Promise.all([
                        (0, span_1.withSpan)('child1', async (child) => {
                            child.tag('childId', '1');
                            await new Promise(resolve => setTimeout(resolve, 60));
                        }),
                        (0, span_1.withSpan)('child2', async (child) => {
                            child.tag('childId', '2');
                            await new Promise(resolve => setTimeout(resolve, 60));
                        }),
                    ]);
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const operations = spans.map(s => s.operation);
            // Children should be captured (they have content and duration)
            expect(operations).toContain('child1');
            expect(operations).toContain('child2');
            // Parent MUST be captured because it has captured children
            // This is the critical test - parent must exist for hierarchy!
            expect(operations).toContain('fastParent');
            // Verify hierarchy is intact
            const parent = spans.find(s => s.operation === 'fastParent');
            const child1 = spans.find(s => s.operation === 'child1');
            const child2 = spans.find(s => s.operation === 'child2');
            expect(parent).toBeDefined();
            expect(child1).toBeDefined();
            expect(child2).toBeDefined();
            // Children should reference the parent
            expect(child1.parentObservabilityLogId).toBe(parent.observabilityLogId);
            expect(child2.parentObservabilityLogId).toBe(parent.observabilityLogId);
        });
        it('should capture all parent spans in deeply nested async hierarchy', async () => {
            await (0, testing_1.createTestContext)(async () => {
                // Simulate the real-world case:
                // workflow -> persistence -> upsert
                await (0, span_1.withSpan)('workflow', async () => {
                    await (0, span_1.withSpan)('persistence', async () => {
                        // Multiple upserts in parallel
                        await Promise.all([
                            (0, span_1.withSpan)('upsert1', async (span) => {
                                span.setData({ entityName: 'standing' });
                                await new Promise(resolve => setTimeout(resolve, 60));
                            }),
                            (0, span_1.withSpan)('upsert2', async (span) => {
                                span.setData({ entityName: 'standing' });
                                await new Promise(resolve => setTimeout(resolve, 60));
                            }),
                        ]);
                    });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const operations = spans.map(s => s.operation);
            // All levels should be captured
            expect(operations).toContain('workflow');
            expect(operations).toContain('persistence');
            expect(operations).toContain('upsert1');
            expect(operations).toContain('upsert2');
            // Build ID map
            const idMap = new Map(spans.map(s => [s.observabilityLogId, s.operation]));
            // Verify all parent references exist
            const orphans = [];
            spans.forEach(span => {
                if (span.parentObservabilityLogId && !idMap.has(span.parentObservabilityLogId)) {
                    orphans.push(`${span.operation} -> missing parent ${span.parentObservabilityLogId}`);
                }
            });
            expect(orphans.length).toBe(0);
            // Verify correct hierarchy
            const workflow = spans.find(s => s.operation === 'workflow');
            const persistence = spans.find(s => s.operation === 'persistence');
            const upsert1 = spans.find(s => s.operation === 'upsert1');
            const upsert2 = spans.find(s => s.operation === 'upsert2');
            expect(persistence.parentObservabilityLogId).toBe(workflow.observabilityLogId);
            expect(upsert1.parentObservabilityLogId).toBe(persistence.observabilityLogId);
            expect(upsert2.parentObservabilityLogId).toBe(persistence.observabilityLogId);
            // Root span should NOT have itself as parent
            // This is a critical check - a span pointing to itself is a bug
            expect(workflow.parentObservabilityLogId).not.toBe(workflow.observabilityLogId);
        });
        it('should NOT have parent pointing to non-existent span after filtering', async () => {
            // This tests the exact scenario from production logs
            // where upsert spans have parent f73a8cbd7a0f1b2d that doesn't exist
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('outerWrapper', async () => {
                    await (0, span_1.withSpan)('innerWrapper', async () => {
                        await Promise.all(Array.from({ length: 5 }, (_, i) => (0, span_1.withSpan)(`operation${i}`, async (span) => {
                            span.tag('index', String(i));
                            await new Promise(resolve => setTimeout(resolve, 60));
                        })));
                    });
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const allIds = new Set(spans.map(s => s.observabilityLogId));
            // Check for broken parent references
            const brokenRefs = [];
            spans.forEach(span => {
                if (span.parentObservabilityLogId && !allIds.has(span.parentObservabilityLogId)) {
                    brokenRefs.push({
                        span: span.operation ?? 'unknown',
                        missingParent: span.parentObservabilityLogId,
                    });
                }
            });
            expect(brokenRefs.length).toBe(0);
        });
    });
    describe('AsyncLocalStorage context propagation', () => {
        it('should maintain parent context across Promise.all', async () => {
            await (0, testing_1.createTestContext)(async () => {
                await (0, span_1.withSpan)('parentSpan', async () => {
                    // This is how persistence service calls upserts
                    await Promise.all([
                        (async () => {
                            const span = span_1.SpanObserver.getCurrentSpan();
                            expect(span?.operation).toBe('parentSpan');
                            await (0, span_1.withSpan)('asyncChild1', async (child) => {
                                child.tag('test', 'child1');
                                await new Promise(resolve => setTimeout(resolve, 60)); // > minDurationMs
                            });
                        })(),
                        (async () => {
                            const span = span_1.SpanObserver.getCurrentSpan();
                            expect(span?.operation).toBe('parentSpan');
                            await (0, span_1.withSpan)('asyncChild2', async (child) => {
                                child.tag('test', 'child2');
                                await new Promise(resolve => setTimeout(resolve, 60)); // > minDurationMs
                            });
                        })(),
                    ]);
                });
                await manager_1.ObservabilityManager.flush();
            });
            const spans = mockBackend.getEventsMatching({ type: 'span' });
            const parent = spans.find(s => s.operation === 'parentSpan');
            const child1 = spans.find(s => s.operation === 'asyncChild1');
            const child2 = spans.find(s => s.operation === 'asyncChild2');
            expect(parent).toBeDefined();
            expect(child1).toBeDefined();
            expect(child2).toBeDefined();
            // Children should have parent as their parent
            expect(child1.parentObservabilityLogId).toBe(parent.observabilityLogId);
            expect(child2.parentObservabilityLogId).toBe(parent.observabilityLogId);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGllcmFyY2h5LWJ1Z3MudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2hpZXJhcmNoeS1idWdzLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7O0dBT0c7O0FBRUgsdUNBS21CO0FBQ25CLDJDQUEwRDtBQUMxRCx1Q0FBaUQ7QUFDakQsbUNBQTZDO0FBRTdDLFFBQVEsQ0FBQyw2QkFBNkIsRUFBRSxHQUFHLEVBQUU7SUFDM0MsSUFBSSxXQUF3QixDQUFDO0lBRTdCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxXQUFXLEdBQUcsSUFBQSxnQ0FBc0IsRUFBQztZQUNuQyxRQUFRLEVBQUUsMEJBQWtCLENBQUMsS0FBSztZQUNsQyxpRUFBaUU7WUFDakUsaUJBQWlCLEVBQUUsRUFBRTtZQUNyQixjQUFjLEVBQUUsSUFBSTtTQUNyQixDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDYixJQUFBLGtDQUF3QixHQUFFLENBQUM7SUFDN0IsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsK0JBQStCLEVBQUUsR0FBRyxFQUFFO1FBQzdDLEVBQUUsQ0FBQywyREFBMkQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN6RSxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7Z0JBQ2pDLE1BQU0sSUFBQSxlQUFRLEVBQUMsZUFBZSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtvQkFDN0MsSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQztvQkFDOUIsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLDRCQUE0QjtnQkFDckYsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsTUFBTSw4QkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNyQyxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUN2QyxNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxZQUFZLENBQUMsQ0FBQztZQUNwRSxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLENBQUMsQ0FBQztZQUV6RCxnRUFBZ0U7WUFDaEUseURBQXlEO1lBQ3pELE1BQU0sQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEQsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsK0RBQStELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDN0UsTUFBTSxJQUFBLDJCQUFpQixFQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNqQyxNQUFNLElBQUEsZUFBUSxFQUFDLFlBQVksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLEVBQUU7b0JBQzFDLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUM1QixDQUFDLENBQUMsQ0FBQztnQkFFSCxNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3JDLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxNQUFNLEdBQUcsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3ZDLE1BQU0sZUFBZSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLFlBQVksQ0FBQyxDQUFDO1lBRXBFLDZFQUE2RTtZQUM3RSxLQUFLLE1BQU0sS0FBSyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUNwQyxnRUFBZ0U7Z0JBQ2hFLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFFLE1BQU0sQ0FBRSxDQUFDLENBQUM7WUFDdEQsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsb0NBQW9DLEVBQUUsR0FBRyxFQUFFO1FBQ2xELEVBQUUsQ0FBQywwREFBMEQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN4RSxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7Z0JBQ2pDLGlDQUFpQztnQkFDakMsMENBQTBDO2dCQUMxQyxNQUFNLElBQUEsZUFBUSxFQUFDLFlBQVksRUFBRSxLQUFLLElBQUksRUFBRTtvQkFDdEMsNERBQTREO29CQUM1RCxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUM7d0JBQ2hCLElBQUEsZUFBUSxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7NEJBQ2pDLEtBQUssQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxDQUFDOzRCQUMxQixNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO3dCQUN4RCxDQUFDLENBQUM7d0JBQ0YsSUFBQSxlQUFRLEVBQUMsUUFBUSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTs0QkFDakMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLENBQUM7NEJBQzFCLE1BQU0sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7d0JBQ3hELENBQUMsQ0FBQztxQkFDSCxDQUFDLENBQUM7Z0JBQ0wsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsTUFBTSw4QkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNyQyxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sS0FBSyxHQUFHLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBQzlELE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUM7WUFFL0MsK0RBQStEO1lBQy9ELE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUV2QywyREFBMkQ7WUFDM0QsK0RBQStEO1lBQy9ELE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7WUFFM0MsNkJBQTZCO1lBQzdCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxLQUFLLFlBQVksQ0FBQyxDQUFDO1lBQzdELE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxLQUFLLFFBQVEsQ0FBQyxDQUFDO1lBQ3pELE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxLQUFLLFFBQVEsQ0FBQyxDQUFDO1lBRXpELE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUM3QixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDN0IsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBRTdCLHVDQUF1QztZQUN2QyxNQUFNLENBQUMsTUFBTyxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1lBQzFFLE1BQU0sQ0FBQyxNQUFPLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTyxDQUFDLGtCQUFrQixDQUFDLENBQUM7UUFDNUUsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsa0VBQWtFLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDaEYsTUFBTSxJQUFBLDJCQUFpQixFQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNqQyxnQ0FBZ0M7Z0JBQ2hDLG9DQUFvQztnQkFDcEMsTUFBTSxJQUFBLGVBQVEsRUFBQyxVQUFVLEVBQUUsS0FBSyxJQUFJLEVBQUU7b0JBQ3BDLE1BQU0sSUFBQSxlQUFRLEVBQUMsYUFBYSxFQUFFLEtBQUssSUFBSSxFQUFFO3dCQUN2QywrQkFBK0I7d0JBQy9CLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQzs0QkFDaEIsSUFBQSxlQUFRLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtnQ0FDakMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO2dDQUN6QyxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDOzRCQUN4RCxDQUFDLENBQUM7NEJBQ0YsSUFBQSxlQUFRLEVBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtnQ0FDakMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO2dDQUN6QyxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDOzRCQUN4RCxDQUFDLENBQUM7eUJBQ0gsQ0FBQyxDQUFDO29CQUNMLENBQUMsQ0FBQyxDQUFDO2dCQUNMLENBQUMsQ0FBQyxDQUFDO2dCQUVILE1BQU0sOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDckMsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsaUJBQWlCLENBQUMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUM5RCxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBRS9DLGdDQUFnQztZQUNoQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQ3pDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLENBQUM7WUFDNUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN4QyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBRXhDLGVBQWU7WUFDZixNQUFNLEtBQUssR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBRSxDQUFDLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBRSxDQUFDLENBQUMsQ0FBQztZQUU3RSxxQ0FBcUM7WUFDckMsTUFBTSxPQUFPLEdBQWEsRUFBRSxDQUFDO1lBQzdCLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQ25CLElBQUksSUFBSSxDQUFDLHdCQUF3QixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLENBQUMsRUFBRSxDQUFDO29CQUMvRSxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsc0JBQXNCLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLENBQUM7Z0JBQ3ZGLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRS9CLDJCQUEyQjtZQUMzQixNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxVQUFVLENBQUMsQ0FBQztZQUM3RCxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxhQUFhLENBQUMsQ0FBQztZQUNuRSxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUMsQ0FBQztZQUMzRCxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUMsQ0FBQztZQUUzRCxNQUFNLENBQUMsV0FBWSxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1lBQ2pGLE1BQU0sQ0FBQyxPQUFRLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBWSxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDaEYsTUFBTSxDQUFDLE9BQVEsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFZLENBQUMsa0JBQWtCLENBQUMsQ0FBQztZQUVoRiw2Q0FBNkM7WUFDN0MsZ0VBQWdFO1lBQ2hFLE1BQU0sQ0FBQyxRQUFTLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQ3BGLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHNFQUFzRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BGLHFEQUFxRDtZQUNyRCxxRUFBcUU7WUFDckUsTUFBTSxJQUFBLDJCQUFpQixFQUFDLEtBQUssSUFBSSxFQUFFO2dCQUNqQyxNQUFNLElBQUEsZUFBUSxFQUFDLGNBQWMsRUFBRSxLQUFLLElBQUksRUFBRTtvQkFDeEMsTUFBTSxJQUFBLGVBQVEsRUFBQyxjQUFjLEVBQUUsS0FBSyxJQUFJLEVBQUU7d0JBQ3hDLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FDZixLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQ2pDLElBQUEsZUFBUSxFQUFDLFlBQVksQ0FBQyxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFOzRCQUN2QyxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs0QkFDN0IsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQzt3QkFDeEQsQ0FBQyxDQUFDLENBQ0gsQ0FDRixDQUFDO29CQUNKLENBQUMsQ0FBQyxDQUFDO2dCQUNMLENBQUMsQ0FBQyxDQUFDO2dCQUVILE1BQU0sOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDckMsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsaUJBQWlCLENBQUMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUM5RCxNQUFNLE1BQU0sR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztZQUU3RCxxQ0FBcUM7WUFDckMsTUFBTSxVQUFVLEdBQW1ELEVBQUUsQ0FBQztZQUN0RSxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUNuQixJQUFJLElBQUksQ0FBQyx3QkFBd0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLEVBQUUsQ0FBQztvQkFDaEYsVUFBVSxDQUFDLElBQUksQ0FBQzt3QkFDZCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsSUFBSSxTQUFTO3dCQUNqQyxhQUFhLEVBQUUsSUFBSSxDQUFDLHdCQUF3QjtxQkFDN0MsQ0FBQyxDQUFDO2dCQUNMLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3BDLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsdUNBQXVDLEVBQUUsR0FBRyxFQUFFO1FBQ3JELEVBQUUsQ0FBQyxtREFBbUQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRSxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7Z0JBQ2pDLE1BQU0sSUFBQSxlQUFRLEVBQUMsWUFBWSxFQUFFLEtBQUssSUFBSSxFQUFFO29CQUN0QyxnREFBZ0Q7b0JBQ2hELE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQzt3QkFDaEIsQ0FBQyxLQUFLLElBQUksRUFBRTs0QkFDVixNQUFNLElBQUksR0FBRyxtQkFBWSxDQUFDLGNBQWMsRUFBRSxDQUFDOzRCQUMzQyxNQUFNLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzs0QkFDM0MsTUFBTSxJQUFBLGVBQVEsRUFBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFO2dDQUM1QyxLQUFLLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQztnQ0FDNUIsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQjs0QkFDM0UsQ0FBQyxDQUFDLENBQUM7d0JBQ0wsQ0FBQyxDQUFDLEVBQUU7d0JBQ0osQ0FBQyxLQUFLLElBQUksRUFBRTs0QkFDVixNQUFNLElBQUksR0FBRyxtQkFBWSxDQUFDLGNBQWMsRUFBRSxDQUFDOzRCQUMzQyxNQUFNLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQzs0QkFDM0MsTUFBTSxJQUFBLGVBQVEsRUFBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFO2dDQUM1QyxLQUFLLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQztnQ0FDNUIsTUFBTSxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLGtCQUFrQjs0QkFDM0UsQ0FBQyxDQUFDLENBQUM7d0JBQ0wsQ0FBQyxDQUFDLEVBQUU7cUJBQ0wsQ0FBQyxDQUFDO2dCQUNMLENBQUMsQ0FBQyxDQUFDO2dCQUVILE1BQU0sOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDckMsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsaUJBQWlCLENBQUMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUU5RCxNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxZQUFZLENBQUMsQ0FBQztZQUM3RCxNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxhQUFhLENBQUMsQ0FBQztZQUM5RCxNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsS0FBSyxhQUFhLENBQUMsQ0FBQztZQUU5RCxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDN0IsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQzdCLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUU3Qiw4Q0FBOEM7WUFDOUMsTUFBTSxDQUFDLE1BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFPLENBQUMsa0JBQWtCLENBQUMsQ0FBQztZQUMxRSxNQUFNLENBQUMsTUFBTyxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQzVFLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGVzdHMgZm9yIGhpZXJhcmNoeSBwcmVzZXJ2YXRpb24gYW5kIHNwYW4uc3RhcnQgZmlsdGVyaW5nIGJ1Z3NcbiAqIFxuICogVGhlc2UgdGVzdHMgcmVwcm9kdWNlIHRoZSBleGFjdCBpc3N1ZXMgc2VlbiBpbiBwcm9kdWN0aW9uOlxuICogMS4gc3Bhbi5zdGFydCBldmVudHMgcmVhY2hpbmcgRHluYW1vREIgKHNob3VsZCBiZSBPVEVMIG9ubHkpXG4gKiAyLiBQYXJlbnQgc3BhbnMgYmVpbmcgZmlsdGVyZWQgd2hpbGUgY2hpbGRyZW4gYXJlIGNhcHR1cmVkXG4gKiAzLiBCcm9rZW4gcGFyZW50IHJlZmVyZW5jZXMgaW4gdGhlIHJlc3VsdGluZyBsb2dzXG4gKi9cblxuaW1wb3J0IHtcbiAgTW9ja0JhY2tlbmQsXG4gIHNldHVwVGVzdE9ic2VydmFiaWxpdHksXG4gIGNyZWF0ZVRlc3RDb250ZXh0LFxuICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHksXG59IGZyb20gJy4vdGVzdGluZyc7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIsIHdpdGhTcGFuIH0gZnJvbSAnLi9vYnNlcnZlcnMvc3Bhbic7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuL3R5cGVzJztcblxuZGVzY3JpYmUoJ0hpZXJhcmNoeSBQcmVzZXJ2YXRpb24gQnVncycsICgpID0+IHtcbiAgbGV0IG1vY2tCYWNrZW5kOiBNb2NrQmFja2VuZDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBtb2NrQmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoe1xuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5UUkFDRSxcbiAgICAgIC8vIFRoZXNlIGFyZSB0aGUgcHJvYmxlbWF0aWMgZGVmYXVsdHMgdGhhdCBjYXVzZSBoaWVyYXJjaHkgaXNzdWVzXG4gICAgICBtaW5TcGFuRHVyYXRpb25NczogNTAsXG4gICAgICBza2lwRW1wdHlTcGFuczogdHJ1ZSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3NwYW4uc3RhcnQgRHluYW1vREIgZmlsdGVyaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgTk9UIGluY2x1ZGUgc3Bhbi5zdGFydCBldmVudHMgaW4gbm9uLU9URUwgYmFja2VuZHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCd0ZXN0T3BlcmF0aW9uJywgYXN5bmMgKHNwYW4pID0+IHtcbiAgICAgICAgICBzcGFuLmNoZWNrcG9pbnQoJ2RvaW5nX3dvcmsnKTtcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNjApKTsgLy8gTG9uZ2VyIHRoYW4gbWluRHVyYXRpb25Nc1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGV2ZW50cyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50cygpO1xuICAgICAgY29uc3Qgc3BhblN0YXJ0RXZlbnRzID0gZXZlbnRzLmZpbHRlcihlID0+IGUudHlwZSA9PT0gJ3NwYW4uc3RhcnQnKTtcbiAgICAgIGNvbnN0IHNwYW5FdmVudHMgPSBldmVudHMuZmlsdGVyKGUgPT4gZS50eXBlID09PSAnc3BhbicpO1xuXG4gICAgICAvLyBzcGFuLnN0YXJ0IHNob3VsZCBOT1QgcmVhY2ggTW9ja0JhY2tlbmQgKHNpbXVsYXRpbmcgRHluYW1vREIpXG4gICAgICAvLyBUaGV5IHNob3VsZCBiZSBmaWx0ZXJlZCBieSBjYXB0dXJlLmJhY2tlbmRzID0gWydvdGVsJ11cbiAgICAgIGV4cGVjdChzcGFuU3RhcnRFdmVudHMubGVuZ3RoKS50b0JlKDApO1xuICAgICAgZXhwZWN0KHNwYW5FdmVudHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2ZXJpZnkgc3Bhbi5zdGFydCBoYXMgYmFja2VuZHMgZmlsdGVyIHNldCB0byBvdGVsIG9ubHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHdpdGhTcGFuKCdmaWx0ZXJUZXN0JywgYXN5bmMgKHNwYW4pID0+IHtcbiAgICAgICAgICBzcGFuLnRhZygndGVzdCcsICd2YWx1ZScpO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGV2ZW50cyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50cygpO1xuICAgICAgY29uc3Qgc3BhblN0YXJ0RXZlbnRzID0gZXZlbnRzLmZpbHRlcihlID0+IGUudHlwZSA9PT0gJ3NwYW4uc3RhcnQnKTtcblxuICAgICAgLy8gSWYgYW55IHNwYW4uc3RhcnQgZXZlbnRzIHJlYWNoZWQgdGhlIGJhY2tlbmQsIGNoZWNrIHRoZWlyIGNhcHR1cmUuYmFja2VuZHNcbiAgICAgIGZvciAoY29uc3QgZXZlbnQgb2Ygc3BhblN0YXJ0RXZlbnRzKSB7XG4gICAgICAgIC8vIFRoaXMgc2hvdWxkIGZhaWwgaWYgc3Bhbi5zdGFydCBldmVudHMgcmVhY2ggbm9uLU9URUwgYmFja2VuZHNcbiAgICAgICAgZXhwZWN0KGV2ZW50LmNhcHR1cmU/LmJhY2tlbmRzKS50b0VxdWFsKFsgJ290ZWwnIF0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUGFyZW50IHNwYW4gaGllcmFyY2h5IHByZXNlcnZhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNhcHR1cmUgcGFyZW50IHNwYW5zIGV2ZW4gaWYgY2hpbGRyZW4gdGFrZSBsb25nZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIFBhcmVudCBzcGFuIGlzIGZhc3QgKDBtcyB3b3JrKVxuICAgICAgICAvLyBCdXQgaXQgaGFzIGNoaWxkcmVuIHRoYXQgZG8gYWN0dWFsIHdvcmtcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ2Zhc3RQYXJlbnQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgLy8gTXVsdGlwbGUgY2hpbGQgb3BlcmF0aW9ucyAoc2ltdWxhdGluZyBQcm9taXNlLmFsbFNldHRsZWQpXG4gICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgd2l0aFNwYW4oJ2NoaWxkMScsIGFzeW5jIChjaGlsZCkgPT4ge1xuICAgICAgICAgICAgICBjaGlsZC50YWcoJ2NoaWxkSWQnLCAnMScpO1xuICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNjApKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgd2l0aFNwYW4oJ2NoaWxkMicsIGFzeW5jIChjaGlsZCkgPT4ge1xuICAgICAgICAgICAgICBjaGlsZC50YWcoJ2NoaWxkSWQnLCAnMicpO1xuICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNjApKTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0pO1xuICAgICAgICB9KTtcblxuICAgICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHNwYW5zID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnc3BhbicgfSk7XG4gICAgICBjb25zdCBvcGVyYXRpb25zID0gc3BhbnMubWFwKHMgPT4gcy5vcGVyYXRpb24pO1xuXG4gICAgICAvLyBDaGlsZHJlbiBzaG91bGQgYmUgY2FwdHVyZWQgKHRoZXkgaGF2ZSBjb250ZW50IGFuZCBkdXJhdGlvbilcbiAgICAgIGV4cGVjdChvcGVyYXRpb25zKS50b0NvbnRhaW4oJ2NoaWxkMScpO1xuICAgICAgZXhwZWN0KG9wZXJhdGlvbnMpLnRvQ29udGFpbignY2hpbGQyJyk7XG5cbiAgICAgIC8vIFBhcmVudCBNVVNUIGJlIGNhcHR1cmVkIGJlY2F1c2UgaXQgaGFzIGNhcHR1cmVkIGNoaWxkcmVuXG4gICAgICAvLyBUaGlzIGlzIHRoZSBjcml0aWNhbCB0ZXN0IC0gcGFyZW50IG11c3QgZXhpc3QgZm9yIGhpZXJhcmNoeSFcbiAgICAgIGV4cGVjdChvcGVyYXRpb25zKS50b0NvbnRhaW4oJ2Zhc3RQYXJlbnQnKTtcblxuICAgICAgLy8gVmVyaWZ5IGhpZXJhcmNoeSBpcyBpbnRhY3RcbiAgICAgIGNvbnN0IHBhcmVudCA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ2Zhc3RQYXJlbnQnKTtcbiAgICAgIGNvbnN0IGNoaWxkMSA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ2NoaWxkMScpO1xuICAgICAgY29uc3QgY2hpbGQyID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnY2hpbGQyJyk7XG5cbiAgICAgIGV4cGVjdChwYXJlbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoY2hpbGQxKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNoaWxkMikudG9CZURlZmluZWQoKTtcblxuICAgICAgLy8gQ2hpbGRyZW4gc2hvdWxkIHJlZmVyZW5jZSB0aGUgcGFyZW50XG4gICAgICBleHBlY3QoY2hpbGQxIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUocGFyZW50IS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgZXhwZWN0KGNoaWxkMiEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKHBhcmVudCEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY2FwdHVyZSBhbGwgcGFyZW50IHNwYW5zIGluIGRlZXBseSBuZXN0ZWQgYXN5bmMgaGllcmFyY2h5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBTaW11bGF0ZSB0aGUgcmVhbC13b3JsZCBjYXNlOlxuICAgICAgICAvLyB3b3JrZmxvdyAtPiBwZXJzaXN0ZW5jZSAtPiB1cHNlcnRcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3dvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdwZXJzaXN0ZW5jZScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIC8vIE11bHRpcGxlIHVwc2VydHMgaW4gcGFyYWxsZWxcbiAgICAgICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgICAgd2l0aFNwYW4oJ3Vwc2VydDEnLCBhc3luYyAoc3BhbikgPT4ge1xuICAgICAgICAgICAgICAgIHNwYW4uc2V0RGF0YSh7IGVudGl0eU5hbWU6ICdzdGFuZGluZycgfSk7XG4gICAgICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDYwKSk7XG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICB3aXRoU3BhbigndXBzZXJ0MicsIGFzeW5jIChzcGFuKSA9PiB7XG4gICAgICAgICAgICAgICAgc3Bhbi5zZXREYXRhKHsgZW50aXR5TmFtZTogJ3N0YW5kaW5nJyB9KTtcbiAgICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNjApKTtcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3Qgb3BlcmF0aW9ucyA9IHNwYW5zLm1hcChzID0+IHMub3BlcmF0aW9uKTtcblxuICAgICAgLy8gQWxsIGxldmVscyBzaG91bGQgYmUgY2FwdHVyZWRcbiAgICAgIGV4cGVjdChvcGVyYXRpb25zKS50b0NvbnRhaW4oJ3dvcmtmbG93Jyk7XG4gICAgICBleHBlY3Qob3BlcmF0aW9ucykudG9Db250YWluKCdwZXJzaXN0ZW5jZScpO1xuICAgICAgZXhwZWN0KG9wZXJhdGlvbnMpLnRvQ29udGFpbigndXBzZXJ0MScpO1xuICAgICAgZXhwZWN0KG9wZXJhdGlvbnMpLnRvQ29udGFpbigndXBzZXJ0MicpO1xuXG4gICAgICAvLyBCdWlsZCBJRCBtYXBcbiAgICAgIGNvbnN0IGlkTWFwID0gbmV3IE1hcChzcGFucy5tYXAocyA9PiBbIHMub2JzZXJ2YWJpbGl0eUxvZ0lkLCBzLm9wZXJhdGlvbiBdKSk7XG5cbiAgICAgIC8vIFZlcmlmeSBhbGwgcGFyZW50IHJlZmVyZW5jZXMgZXhpc3RcbiAgICAgIGNvbnN0IG9ycGhhbnM6IHN0cmluZ1tdID0gW107XG4gICAgICBzcGFucy5mb3JFYWNoKHNwYW4gPT4ge1xuICAgICAgICBpZiAoc3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgJiYgIWlkTWFwLmhhcyhzcGFuLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkpIHtcbiAgICAgICAgICBvcnBoYW5zLnB1c2goYCR7c3Bhbi5vcGVyYXRpb259IC0+IG1pc3NpbmcgcGFyZW50ICR7c3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWR9YCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3Qob3JwaGFucy5sZW5ndGgpLnRvQmUoMCk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb3JyZWN0IGhpZXJhcmNoeVxuICAgICAgY29uc3Qgd29ya2Zsb3cgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICd3b3JrZmxvdycpO1xuICAgICAgY29uc3QgcGVyc2lzdGVuY2UgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICdwZXJzaXN0ZW5jZScpO1xuICAgICAgY29uc3QgdXBzZXJ0MSA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ3Vwc2VydDEnKTtcbiAgICAgIGNvbnN0IHVwc2VydDIgPSBzcGFucy5maW5kKHMgPT4gcy5vcGVyYXRpb24gPT09ICd1cHNlcnQyJyk7XG5cbiAgICAgIGV4cGVjdChwZXJzaXN0ZW5jZSEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKHdvcmtmbG93IS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgZXhwZWN0KHVwc2VydDEhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZShwZXJzaXN0ZW5jZSEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIGV4cGVjdCh1cHNlcnQyIS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUocGVyc2lzdGVuY2UhLm9ic2VydmFiaWxpdHlMb2dJZCk7XG5cbiAgICAgIC8vIFJvb3Qgc3BhbiBzaG91bGQgTk9UIGhhdmUgaXRzZWxmIGFzIHBhcmVudFxuICAgICAgLy8gVGhpcyBpcyBhIGNyaXRpY2FsIGNoZWNrIC0gYSBzcGFuIHBvaW50aW5nIHRvIGl0c2VsZiBpcyBhIGJ1Z1xuICAgICAgZXhwZWN0KHdvcmtmbG93IS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLm5vdC50b0JlKHdvcmtmbG93IS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBOT1QgaGF2ZSBwYXJlbnQgcG9pbnRpbmcgdG8gbm9uLWV4aXN0ZW50IHNwYW4gYWZ0ZXIgZmlsdGVyaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gVGhpcyB0ZXN0cyB0aGUgZXhhY3Qgc2NlbmFyaW8gZnJvbSBwcm9kdWN0aW9uIGxvZ3NcbiAgICAgIC8vIHdoZXJlIHVwc2VydCBzcGFucyBoYXZlIHBhcmVudCBmNzNhOGNiZDdhMGYxYjJkIHRoYXQgZG9lc24ndCBleGlzdFxuICAgICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB3aXRoU3Bhbignb3V0ZXJXcmFwcGVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdpbm5lcldyYXBwZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogNSB9LCAoXywgaSkgPT5cbiAgICAgICAgICAgICAgICB3aXRoU3Bhbihgb3BlcmF0aW9uJHtpfWAsIGFzeW5jIChzcGFuKSA9PiB7XG4gICAgICAgICAgICAgICAgICBzcGFuLnRhZygnaW5kZXgnLCBTdHJpbmcoaSkpO1xuICAgICAgICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDYwKSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzcGFucyA9IG1vY2tCYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nIH0pO1xuICAgICAgY29uc3QgYWxsSWRzID0gbmV3IFNldChzcGFucy5tYXAocyA9PiBzLm9ic2VydmFiaWxpdHlMb2dJZCkpO1xuXG4gICAgICAvLyBDaGVjayBmb3IgYnJva2VuIHBhcmVudCByZWZlcmVuY2VzXG4gICAgICBjb25zdCBicm9rZW5SZWZzOiBBcnJheTx7IHNwYW46IHN0cmluZzsgbWlzc2luZ1BhcmVudDogc3RyaW5nIH0+ID0gW107XG4gICAgICBzcGFucy5mb3JFYWNoKHNwYW4gPT4ge1xuICAgICAgICBpZiAoc3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgJiYgIWFsbElkcy5oYXMoc3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpKSB7XG4gICAgICAgICAgYnJva2VuUmVmcy5wdXNoKHtcbiAgICAgICAgICAgIHNwYW46IHNwYW4ub3BlcmF0aW9uID8/ICd1bmtub3duJyxcbiAgICAgICAgICAgIG1pc3NpbmdQYXJlbnQ6IHNwYW4ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGJyb2tlblJlZnMubGVuZ3RoKS50b0JlKDApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQXN5bmNMb2NhbFN0b3JhZ2UgY29udGV4dCBwcm9wYWdhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIG1haW50YWluIHBhcmVudCBjb250ZXh0IGFjcm9zcyBQcm9taXNlLmFsbCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgd2l0aFNwYW4oJ3BhcmVudFNwYW4nLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBob3cgcGVyc2lzdGVuY2Ugc2VydmljZSBjYWxscyB1cHNlcnRzXG4gICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICAgICAgKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5nZXRDdXJyZW50U3BhbigpO1xuICAgICAgICAgICAgICBleHBlY3Qoc3Bhbj8ub3BlcmF0aW9uKS50b0JlKCdwYXJlbnRTcGFuJyk7XG4gICAgICAgICAgICAgIGF3YWl0IHdpdGhTcGFuKCdhc3luY0NoaWxkMScsIGFzeW5jIChjaGlsZCkgPT4ge1xuICAgICAgICAgICAgICAgIGNoaWxkLnRhZygndGVzdCcsICdjaGlsZDEnKTtcbiAgICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNjApKTsgLy8gPiBtaW5EdXJhdGlvbk1zXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSkoKSxcbiAgICAgICAgICAgIChhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuZ2V0Q3VycmVudFNwYW4oKTtcbiAgICAgICAgICAgICAgZXhwZWN0KHNwYW4/Lm9wZXJhdGlvbikudG9CZSgncGFyZW50U3BhbicpO1xuICAgICAgICAgICAgICBhd2FpdCB3aXRoU3BhbignYXN5bmNDaGlsZDInLCBhc3luYyAoY2hpbGQpID0+IHtcbiAgICAgICAgICAgICAgICBjaGlsZC50YWcoJ3Rlc3QnLCAnY2hpbGQyJyk7XG4gICAgICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDYwKSk7IC8vID4gbWluRHVyYXRpb25Nc1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pKCksXG4gICAgICAgICAgXSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgc3BhbnMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdzcGFuJyB9KTtcblxuICAgICAgY29uc3QgcGFyZW50ID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAncGFyZW50U3BhbicpO1xuICAgICAgY29uc3QgY2hpbGQxID0gc3BhbnMuZmluZChzID0+IHMub3BlcmF0aW9uID09PSAnYXN5bmNDaGlsZDEnKTtcbiAgICAgIGNvbnN0IGNoaWxkMiA9IHNwYW5zLmZpbmQocyA9PiBzLm9wZXJhdGlvbiA9PT0gJ2FzeW5jQ2hpbGQyJyk7XG5cbiAgICAgIGV4cGVjdChwYXJlbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoY2hpbGQxKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGNoaWxkMikudG9CZURlZmluZWQoKTtcblxuICAgICAgLy8gQ2hpbGRyZW4gc2hvdWxkIGhhdmUgcGFyZW50IGFzIHRoZWlyIHBhcmVudFxuICAgICAgZXhwZWN0KGNoaWxkMSEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKHBhcmVudCEub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIGV4cGVjdChjaGlsZDIhLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkudG9CZShwYXJlbnQhLm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbiJdfQ==