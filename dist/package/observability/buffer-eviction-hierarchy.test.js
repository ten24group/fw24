"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const manager_1 = require("./manager");
const span_1 = require("./observers/span");
const base_1 = require("./observers/base");
const testing_1 = require("./testing");
function assertNoMissingParentRefs(backend) {
    const events = backend.getEvents();
    const spans = events.filter((e) => e.type === 'span');
    const spanIds = new Set(spans.map((s) => s.observabilityLogId));
    const broken = events
        .filter((e) => !!e.parentObservabilityLogId)
        .filter((e) => !spanIds.has(e.parentObservabilityLogId))
        .slice(0, 10)
        .map((e) => ({
        type: e.type,
        operation: e.operation,
        parent: e.parentObservabilityLogId,
        id: e.observabilityLogId,
    }));
    expect(broken).toEqual([]);
    const violations = events.filter((e) => e.type === 'log'
        && (e.operation === 'observability.invariant_violation.missing_parent_span'
            || e.operation === 'observability.invariant_violation.cross_slice_parent_span'));
    expect(violations).toEqual([]);
}
describe('Observability buffer eviction (bounded memory, no orphan parents)', () => {
    let backend;
    beforeEach(() => {
        backend = (0, testing_1.setupTestObservability)({ enabled: true });
        // Force buffering + eviction: tiny buffer, smart sampling on, capture everything.
        manager_1.ObservabilityManager.configure({
            spans: { minDurationMs: 0, skipEmpty: false },
            sampling: {
                enabled: true,
                smart: true,
                maxBufferSize: 25,
                rates: { critical: 1, error: 1, warn: 1, info: 1, debug: 1, trace: 1 },
            },
            noiseReduction: {
                enabled: true,
                presets: [],
                rules: [],
                maxAbsorbedErrorsPerSpan: 20,
                maxAbsorbedCausedByLinksPerSpan: 50,
                maxAbsorbedEntityIdsPerSpan: 100,
                maxAbsorbedOperationKeysPerSpan: 50,
                maxAbsorbedCheckpointsPerSpan: 100,
            },
        });
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    it('evicts under high volume without persisting broken parentObservabilityLogId references (log-heavy)', async () => {
        await (0, testing_1.createTestContext)(async () => {
            await span_1.SpanObserver.withSpan('root', async () => {
                // Many child logs under a single parent: should trigger evictions.
                for (let i = 0; i < 250; i++) {
                    (0, base_1.captureRecord)('test', {
                        type: 'log',
                        level: 'info',
                        operation: `child.log.${i}`,
                        data: { i },
                    });
                }
                // Add some nested spans with children to create a small hierarchy.
                await span_1.SpanObserver.withSpan('childSpan', async () => {
                    for (let i = 0; i < 50; i++) {
                        (0, base_1.captureRecord)('test', {
                            type: 'log',
                            level: 'info',
                            operation: `childSpan.log.${i}`,
                        });
                    }
                });
            });
            await manager_1.ObservabilityManager.flush();
        }, { correlationId: 'evict-log-heavy' });
        assertNoMissingParentRefs(backend);
    });
    it('evicts under spans-only pressure without persisting broken parent references (span-heavy)', async () => {
        await (0, testing_1.createTestContext)(async () => {
            await span_1.SpanObserver.withSpan('root', async () => {
                // Create many nested spans (no logs). With minDurationMs=0 + skipEmpty=false they will be captured.
                for (let i = 0; i < 120; i++) {
                    // eslint-disable-next-line no-await-in-loop
                    await span_1.SpanObserver.withSpan(`span.${i}`, async () => { });
                }
            });
            await manager_1.ObservabilityManager.flush();
        }, { correlationId: 'evict-span-heavy' });
        assertNoMissingParentRefs(backend);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVmZmVyLWV2aWN0aW9uLWhpZXJhcmNoeS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvYnVmZmVyLWV2aWN0aW9uLWhpZXJhcmNoeS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsdUNBQWlEO0FBQ2pELDJDQUFnRDtBQUNoRCwyQ0FBaUQ7QUFDakQsdUNBQWtIO0FBRWxILFNBQVMseUJBQXlCLENBQUMsT0FBb0I7SUFDckQsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDO0lBQ25DLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssTUFBTSxDQUFDLENBQUM7SUFDdEQsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztJQUVoRSxNQUFNLE1BQU0sR0FBRyxNQUFNO1NBQ2xCLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztTQUMzQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsd0JBQXlCLENBQUMsQ0FBQztTQUN4RCxLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztTQUNaLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNYLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUNaLFNBQVMsRUFBRSxDQUFDLENBQUMsU0FBUztRQUN0QixNQUFNLEVBQUUsQ0FBQyxDQUFDLHdCQUF3QjtRQUNsQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLGtCQUFrQjtLQUN6QixDQUFDLENBQUMsQ0FBQztJQUVOLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7SUFFM0IsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQ3JDLENBQUMsQ0FBQyxJQUFJLEtBQUssS0FBSztXQUNiLENBQ0QsQ0FBQyxDQUFDLFNBQVMsS0FBSyx1REFBdUQ7ZUFDcEUsQ0FBQyxDQUFDLFNBQVMsS0FBSywyREFBMkQsQ0FDL0UsQ0FDRixDQUFDO0lBQ0YsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUNqQyxDQUFDO0FBRUQsUUFBUSxDQUFDLG1FQUFtRSxFQUFFLEdBQUcsRUFBRTtJQUNqRixJQUFJLE9BQW9CLENBQUM7SUFFekIsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLE9BQU8sR0FBRyxJQUFBLGdDQUFzQixFQUFDLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFFcEQsa0ZBQWtGO1FBQ2xGLDhCQUFvQixDQUFDLFNBQVMsQ0FBQztZQUM3QixLQUFLLEVBQUUsRUFBRSxhQUFhLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUU7WUFDN0MsUUFBUSxFQUFFO2dCQUNSLE9BQU8sRUFBRSxJQUFJO2dCQUNiLEtBQUssRUFBRSxJQUFJO2dCQUNYLGFBQWEsRUFBRSxFQUFFO2dCQUNqQixLQUFLLEVBQUUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRTthQUN2RTtZQUNELGNBQWMsRUFBRTtnQkFDZCxPQUFPLEVBQUUsSUFBSTtnQkFDYixPQUFPLEVBQUUsRUFBRTtnQkFDWCxLQUFLLEVBQUUsRUFBRTtnQkFDVCx3QkFBd0IsRUFBRSxFQUFFO2dCQUM1QiwrQkFBK0IsRUFBRSxFQUFFO2dCQUNuQywyQkFBMkIsRUFBRSxHQUFHO2dCQUNoQywrQkFBK0IsRUFBRSxFQUFFO2dCQUNuQyw2QkFBNkIsRUFBRSxHQUFHO2FBQ25DO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLG9HQUFvRyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ2xILE1BQU0sSUFBQSwyQkFBaUIsRUFBQyxLQUFLLElBQUksRUFBRTtZQUNqQyxNQUFNLG1CQUFZLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDN0MsbUVBQW1FO2dCQUNuRSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQzdCLElBQUEsb0JBQWEsRUFBQyxNQUFNLEVBQUU7d0JBQ3BCLElBQUksRUFBRSxLQUFLO3dCQUNYLEtBQUssRUFBRSxNQUFNO3dCQUNiLFNBQVMsRUFBRSxhQUFhLENBQUMsRUFBRTt3QkFDM0IsSUFBSSxFQUFFLEVBQUUsQ0FBQyxFQUFFO3FCQUNaLENBQUMsQ0FBQztnQkFDTCxDQUFDO2dCQUVELG1FQUFtRTtnQkFDbkUsTUFBTSxtQkFBWSxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsS0FBSyxJQUFJLEVBQUU7b0JBQ2xELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQzt3QkFDNUIsSUFBQSxvQkFBYSxFQUFDLE1BQU0sRUFBRTs0QkFDcEIsSUFBSSxFQUFFLEtBQUs7NEJBQ1gsS0FBSyxFQUFFLE1BQU07NEJBQ2IsU0FBUyxFQUFFLGlCQUFpQixDQUFDLEVBQUU7eUJBQ2hDLENBQUMsQ0FBQztvQkFDTCxDQUFDO2dCQUNILENBQUMsQ0FBQyxDQUFDO1lBQ0wsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUMsRUFBRSxFQUFFLGFBQWEsRUFBRSxpQkFBaUIsRUFBRSxDQUFDLENBQUM7UUFFekMseUJBQXlCLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDckMsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsMkZBQTJGLEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDekcsTUFBTSxJQUFBLDJCQUFpQixFQUFDLEtBQUssSUFBSSxFQUFFO1lBQ2pDLE1BQU0sbUJBQVksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUM3QyxvR0FBb0c7Z0JBQ3BHLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztvQkFDN0IsNENBQTRDO29CQUM1QyxNQUFNLG1CQUFZLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsS0FBSyxJQUFJLEVBQUUsR0FBZSxDQUFDLENBQUMsQ0FBQztnQkFDeEUsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSw4QkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDLEVBQUUsRUFBRSxhQUFhLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO1FBRTFDLHlCQUF5QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ3JDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IGNhcHR1cmVSZWNvcmQgfSBmcm9tICcuL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IHNldHVwVGVzdE9ic2VydmFiaWxpdHksIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSwgY3JlYXRlVGVzdENvbnRleHQsIHR5cGUgTW9ja0JhY2tlbmQgfSBmcm9tICcuL3Rlc3RpbmcnO1xuXG5mdW5jdGlvbiBhc3NlcnROb01pc3NpbmdQYXJlbnRSZWZzKGJhY2tlbmQ6IE1vY2tCYWNrZW5kKTogdm9pZCB7XG4gIGNvbnN0IGV2ZW50cyA9IGJhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gIGNvbnN0IHNwYW5zID0gZXZlbnRzLmZpbHRlcigoZSkgPT4gZS50eXBlID09PSAnc3BhbicpO1xuICBjb25zdCBzcGFuSWRzID0gbmV3IFNldChzcGFucy5tYXAoKHMpID0+IHMub2JzZXJ2YWJpbGl0eUxvZ0lkKSk7XG5cbiAgY29uc3QgYnJva2VuID0gZXZlbnRzXG4gICAgLmZpbHRlcigoZSkgPT4gISFlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZClcbiAgICAuZmlsdGVyKChlKSA9PiAhc3Bhbklkcy5oYXMoZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQhKSlcbiAgICAuc2xpY2UoMCwgMTApXG4gICAgLm1hcCgoZSkgPT4gKHtcbiAgICAgIHR5cGU6IGUudHlwZSxcbiAgICAgIG9wZXJhdGlvbjogZS5vcGVyYXRpb24sXG4gICAgICBwYXJlbnQ6IGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgaWQ6IGUub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgIH0pKTtcblxuICBleHBlY3QoYnJva2VuKS50b0VxdWFsKFtdKTtcblxuICBjb25zdCB2aW9sYXRpb25zID0gZXZlbnRzLmZpbHRlcigoZSkgPT5cbiAgICBlLnR5cGUgPT09ICdsb2cnXG4gICAgJiYgKFxuICAgICAgZS5vcGVyYXRpb24gPT09ICdvYnNlcnZhYmlsaXR5LmludmFyaWFudF92aW9sYXRpb24ubWlzc2luZ19wYXJlbnRfc3BhbidcbiAgICAgIHx8IGUub3BlcmF0aW9uID09PSAnb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLmNyb3NzX3NsaWNlX3BhcmVudF9zcGFuJ1xuICAgIClcbiAgKTtcbiAgZXhwZWN0KHZpb2xhdGlvbnMpLnRvRXF1YWwoW10pO1xufVxuXG5kZXNjcmliZSgnT2JzZXJ2YWJpbGl0eSBidWZmZXIgZXZpY3Rpb24gKGJvdW5kZWQgbWVtb3J5LCBubyBvcnBoYW4gcGFyZW50cyknLCAoKSA9PiB7XG4gIGxldCBiYWNrZW5kOiBNb2NrQmFja2VuZDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBiYWNrZW5kID0gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSh7IGVuYWJsZWQ6IHRydWUgfSk7XG5cbiAgICAvLyBGb3JjZSBidWZmZXJpbmcgKyBldmljdGlvbjogdGlueSBidWZmZXIsIHNtYXJ0IHNhbXBsaW5nIG9uLCBjYXB0dXJlIGV2ZXJ5dGhpbmcuXG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY29uZmlndXJlKHtcbiAgICAgIHNwYW5zOiB7IG1pbkR1cmF0aW9uTXM6IDAsIHNraXBFbXB0eTogZmFsc2UgfSxcbiAgICAgIHNhbXBsaW5nOiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHNtYXJ0OiB0cnVlLFxuICAgICAgICBtYXhCdWZmZXJTaXplOiAyNSxcbiAgICAgICAgcmF0ZXM6IHsgY3JpdGljYWw6IDEsIGVycm9yOiAxLCB3YXJuOiAxLCBpbmZvOiAxLCBkZWJ1ZzogMSwgdHJhY2U6IDEgfSxcbiAgICAgIH0sXG4gICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbXSxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBtYXhBYnNvcmJlZEVycm9yc1BlclNwYW46IDIwLFxuICAgICAgICBtYXhBYnNvcmJlZENhdXNlZEJ5TGlua3NQZXJTcGFuOiA1MCxcbiAgICAgICAgbWF4QWJzb3JiZWRFbnRpdHlJZHNQZXJTcGFuOiAxMDAsXG4gICAgICAgIG1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW46IDUwLFxuICAgICAgICBtYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbjogMTAwLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgfSk7XG5cbiAgaXQoJ2V2aWN0cyB1bmRlciBoaWdoIHZvbHVtZSB3aXRob3V0IHBlcnNpc3RpbmcgYnJva2VuIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCByZWZlcmVuY2VzIChsb2ctaGVhdnkpJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3Bhbigncm9vdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gTWFueSBjaGlsZCBsb2dzIHVuZGVyIGEgc2luZ2xlIHBhcmVudDogc2hvdWxkIHRyaWdnZXIgZXZpY3Rpb25zLlxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDI1MDsgaSsrKSB7XG4gICAgICAgICAgY2FwdHVyZVJlY29yZCgndGVzdCcsIHtcbiAgICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogYGNoaWxkLmxvZy4ke2l9YCxcbiAgICAgICAgICAgIGRhdGE6IHsgaSB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIHNvbWUgbmVzdGVkIHNwYW5zIHdpdGggY2hpbGRyZW4gdG8gY3JlYXRlIGEgc21hbGwgaGllcmFyY2h5LlxuICAgICAgICBhd2FpdCBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4oJ2NoaWxkU3BhbicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDUwOyBpKyspIHtcbiAgICAgICAgICAgIGNhcHR1cmVSZWNvcmQoJ3Rlc3QnLCB7XG4gICAgICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICAgICAgICBvcGVyYXRpb246IGBjaGlsZFNwYW4ubG9nLiR7aX1gLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH0sIHsgY29ycmVsYXRpb25JZDogJ2V2aWN0LWxvZy1oZWF2eScgfSk7XG5cbiAgICBhc3NlcnROb01pc3NpbmdQYXJlbnRSZWZzKGJhY2tlbmQpO1xuICB9KTtcblxuICBpdCgnZXZpY3RzIHVuZGVyIHNwYW5zLW9ubHkgcHJlc3N1cmUgd2l0aG91dCBwZXJzaXN0aW5nIGJyb2tlbiBwYXJlbnQgcmVmZXJlbmNlcyAoc3Bhbi1oZWF2eSknLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKCdyb290JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBDcmVhdGUgbWFueSBuZXN0ZWQgc3BhbnMgKG5vIGxvZ3MpLiBXaXRoIG1pbkR1cmF0aW9uTXM9MCArIHNraXBFbXB0eT1mYWxzZSB0aGV5IHdpbGwgYmUgY2FwdHVyZWQuXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTIwOyBpKyspIHtcbiAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tYXdhaXQtaW4tbG9vcFxuICAgICAgICAgIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3Bhbihgc3Bhbi4ke2l9YCwgYXN5bmMgKCkgPT4geyAvKiBuby1vcCAqLyB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfSwgeyBjb3JyZWxhdGlvbklkOiAnZXZpY3Qtc3Bhbi1oZWF2eScgfSk7XG5cbiAgICBhc3NlcnROb01pc3NpbmdQYXJlbnRSZWZzKGJhY2tlbmQpO1xuICB9KTtcbn0pO1xuXG4iXX0=