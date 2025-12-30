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
                emitSummaries: false,
                rules: [],
                maxCheckpointsPerSpan: 50,
                maxAggregateKeysPerSpan: 50,
                maxAggregateExamplesPerKey: 20,
                maxAggregateErrorExamplesPerKey: 10,
                includeDebugMetadata: false,
                includeExamples: false,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVmZmVyLWV2aWN0aW9uLWhpZXJhcmNoeS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvYnVmZmVyLWV2aWN0aW9uLWhpZXJhcmNoeS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsdUNBQWlEO0FBQ2pELDJDQUFnRDtBQUNoRCwyQ0FBaUQ7QUFDakQsdUNBQWtIO0FBRWxILFNBQVMseUJBQXlCLENBQUMsT0FBb0I7SUFDckQsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDO0lBQ25DLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssTUFBTSxDQUFDLENBQUM7SUFDdEQsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztJQUVoRSxNQUFNLE1BQU0sR0FBRyxNQUFNO1NBQ2xCLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztTQUMzQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsd0JBQXlCLENBQUMsQ0FBQztTQUN4RCxLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztTQUNaLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNYLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUNaLFNBQVMsRUFBRSxDQUFDLENBQUMsU0FBUztRQUN0QixNQUFNLEVBQUUsQ0FBQyxDQUFDLHdCQUF3QjtRQUNsQyxFQUFFLEVBQUUsQ0FBQyxD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LEVBQUUsaUJBQWlCLENBQUMsRUFBRTt5QkFDaEMsQ0FBQyxDQUFDO29CQUNMLENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7WUFDTCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckMsQ0FBQyxFQUFFLEVBQUUsYUFBYSxFQUFFLGlCQUFpQixFQUFFLENBQUMsQ0FBQztRQUV6Qyx5QkFBeUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNyQyxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQywyRkFBMkYsRUFBRSxLQUFLLElBQUksRUFBRTtRQUN6RyxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsTUFBTSxtQkFBWSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQzdDLG9HQUFvRztnQkFDcEcsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO29CQUM3Qiw0Q0FBNEM7b0JBQzVDLE1BQU0sbUJBQVksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxLQUFLLElBQUksRUFBRSxHQUFlLENBQUMsQ0FBQyxDQUFDO2dCQUN4RSxDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUMsRUFBRSxFQUFFLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7UUFFMUMseUJBQXlCLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDckMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyIH0gZnJvbSAnLi9tYW5hZ2VyJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL3NwYW4nO1xuaW1wb3J0IHsgY2FwdHVyZVJlY29yZCB9IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSwgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LCBjcmVhdGVUZXN0Q29udGV4dCwgdHlwZSBNb2NrQmFja2VuZCB9IGZyb20gJy4vdGVzdGluZyc7XG5cbmZ1bmN0aW9uIGFzc2VydE5vTWlzc2luZ1BhcmVudFJlZnMoYmFja2VuZDogTW9ja0JhY2tlbmQpOiB2b2lkIHtcbiAgY29uc3QgZXZlbnRzID0gYmFja2VuZC5nZXRFdmVudHMoKTtcbiAgY29uc3Qgc3BhbnMgPSBldmVudHMuZmlsdGVyKChlKSA9PiBlLnR5cGUgPT09ICdzcGFuJyk7XG4gIGNvbnN0IHNwYW5JZHMgPSBuZXcgU2V0KHNwYW5zLm1hcCgocykgPT4gcy5vYnNlcnZhYmlsaXR5TG9nSWQpKTtcblxuICBjb25zdCBicm9rZW4gPSBldmVudHNcbiAgICAuZmlsdGVyKChlKSA9PiAhIWUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKVxuICAgIC5maWx0ZXIoKGUpID0+ICFzcGFuSWRzLmhhcyhlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCEpKVxuICAgIC5zbGljZSgwLCAxMClcbiAgICAubWFwKChlKSA9PiAoe1xuICAgICAgdHlwZTogZS50eXBlLFxuICAgICAgb3BlcmF0aW9uOiBlLm9wZXJhdGlvbixcbiAgICAgIHBhcmVudDogZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICBpZDogZS5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgfSkpO1xuXG4gIGV4cGVjdChicm9rZW4pLnRvRXF1YWwoW10pO1xuXG4gIGNvbnN0IHZpb2xhdGlvbnMgPSBldmVudHMuZmlsdGVyKChlKSA9PlxuICAgIGUudHlwZSA9PT0gJ2xvZydcbiAgICAmJiAoXG4gICAgICBlLm9wZXJhdGlvbiA9PT0gJ29ic2VydmFiaWxpdHkuaW52YXJpYW50X3Zpb2xhdGlvbi5taXNzaW5nX3BhcmVudF9zcGFuJ1xuICAgICAgfHwgZS5vcGVyYXRpb24gPT09ICdvYnNlcnZhYmlsaXR5LmludmFyaWFudF92aW9sYXRpb24uY3Jvc3Nfc2xpY2VfcGFyZW50X3NwYW4nXG4gICAgKVxuICApO1xuICBleHBlY3QodmlvbGF0aW9ucykudG9FcXVhbChbXSk7XG59XG5cbmRlc2NyaWJlKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBldmljdGlvbiAoYm91bmRlZCBtZW1vcnksIG5vIG9ycGhhbiBwYXJlbnRzKScsICgpID0+IHtcbiAgbGV0IGJhY2tlbmQ6IE1vY2tCYWNrZW5kO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGJhY2tlbmQgPSBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KHsgZW5hYmxlZDogdHJ1ZSB9KTtcblxuICAgIC8vIEZvcmNlIGJ1ZmZlcmluZyArIGV2aWN0aW9uOiB0aW55IGJ1ZmZlciwgc21hcnQgc2FtcGxpbmcgb24sIGNhcHR1cmUgZXZlcnl0aGluZy5cbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5jb25maWd1cmUoe1xuICAgICAgc3BhbnM6IHsgbWluRHVyYXRpb25NczogMCwgc2tpcEVtcHR5OiBmYWxzZSB9LFxuICAgICAgc2FtcGxpbmc6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc21hcnQ6IHRydWUsXG4gICAgICAgIG1heEJ1ZmZlclNpemU6IDI1LFxuICAgICAgICByYXRlczogeyBjcml0aWNhbDogMSwgZXJyb3I6IDEsIHdhcm46IDEsIGluZm86IDEsIGRlYnVnOiAxLCB0cmFjZTogMSB9LFxuICAgICAgfSxcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFtdLFxuICAgICAgICBlbWl0U3VtbWFyaWVzOiBmYWxzZSxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBtYXhDaGVja3BvaW50c1BlclNwYW46IDUwLFxuICAgICAgICBtYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbjogNTAsXG4gICAgICAgIG1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5OiAyMCxcbiAgICAgICAgbWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleTogMTAsXG4gICAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiBmYWxzZSxcbiAgICAgICAgaW5jbHVkZUV4YW1wbGVzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gIH0pO1xuXG4gIGl0KCdldmljdHMgdW5kZXIgaGlnaCB2b2x1bWUgd2l0aG91dCBwZXJzaXN0aW5nIGJyb2tlbiBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgcmVmZXJlbmNlcyAobG9nLWhlYXZ5KScsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4oJ3Jvb3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIE1hbnkgY2hpbGQgbG9ncyB1bmRlciBhIHNpbmdsZSBwYXJlbnQ6IHNob3VsZCB0cmlnZ2VyIGV2aWN0aW9ucy5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCAyNTA7IGkrKykge1xuICAgICAgICAgIGNhcHR1cmVSZWNvcmQoJ3Rlc3QnLCB7XG4gICAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgICBvcGVyYXRpb246IGBjaGlsZC5sb2cuJHtpfWAsXG4gICAgICAgICAgICBkYXRhOiB7IGkgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBzb21lIG5lc3RlZCBzcGFucyB3aXRoIGNoaWxkcmVuIHRvIGNyZWF0ZSBhIHNtYWxsIGhpZXJhcmNoeS5cbiAgICAgICAgYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKCdjaGlsZFNwYW4nLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCA1MDsgaSsrKSB7XG4gICAgICAgICAgICBjYXB0dXJlUmVjb3JkKCd0ZXN0Jywge1xuICAgICAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgICAgICAgb3BlcmF0aW9uOiBgY2hpbGRTcGFuLmxvZy4ke2l9YCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9LCB7IGNvcnJlbGF0aW9uSWQ6ICdldmljdC1sb2ctaGVhdnknIH0pO1xuXG4gICAgYXNzZXJ0Tm9NaXNzaW5nUGFyZW50UmVmcyhiYWNrZW5kKTtcbiAgfSk7XG5cbiAgaXQoJ2V2aWN0cyB1bmRlciBzcGFucy1vbmx5IHByZXNzdXJlIHdpdGhvdXQgcGVyc2lzdGluZyBicm9rZW4gcGFyZW50IHJlZmVyZW5jZXMgKHNwYW4taGVhdnkpJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3Bhbigncm9vdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gQ3JlYXRlIG1hbnkgbmVzdGVkIHNwYW5zIChubyBsb2dzKS4gV2l0aCBtaW5EdXJhdGlvbk1zPTAgKyBza2lwRW1wdHk9ZmFsc2UgdGhleSB3aWxsIGJlIGNhcHR1cmVkLlxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IDEyMDsgaSsrKSB7XG4gICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWF3YWl0LWluLWxvb3BcbiAgICAgICAgICBhd2FpdCBTcGFuT2JzZXJ2ZXIud2l0aFNwYW4oYHNwYW4uJHtpfWAsIGFzeW5jICgpID0+IHsgLyogbm8tb3AgKi8gfSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH0sIHsgY29ycmVsYXRpb25JZDogJ2V2aWN0LXNwYW4taGVhdnknIH0pO1xuXG4gICAgYXNzZXJ0Tm9NaXNzaW5nUGFyZW50UmVmcyhiYWNrZW5kKTtcbiAgfSk7XG59KTtcblxuIl19