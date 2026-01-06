"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const manager_1 = require("./manager");
const span_1 = require("./observers/span");
const testing_1 = require("./testing");
const storage_1 = require("../core/runtime/execution-context/storage");
describe('flush-time graph hierarchy (no missing parents)', () => {
    let backend;
    beforeEach(() => {
        backend = (0, testing_1.setupTestObservability)({
            enabled: true,
            // Realistic defaults: skip empties, drop short spans via duration threshold.
            skipEmptySpans: true,
            minSpanDurationMs: 50,
        });
        // Enable buffering so flush-time graph logic is exercised.
        const cfg = manager_1.ObservabilityManager.getConfig();
        if (!cfg)
            throw new Error('test config not initialized');
        manager_1.ObservabilityManager.configure({
            noiseReduction: { ...cfg.noiseReduction, enabled: true, emitSummaries: false },
            sampling: {
                ...(cfg.sampling ?? {
                    enabled: false,
                    smart: false,
                    maxBufferSize: 1000,
                    rates: { critical: 1, error: 1, warn: 1, info: 1, debug: 1, trace: 1 },
                }),
                enabled: false,
                smart: false,
                maxBufferSize: 1000,
                rates: { critical: 1, error: 1, warn: 1, info: 1, debug: 1, trace: 1 },
            },
        });
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    it('force-ends open parent spans at flush and does not emit invariant violation', async () => {
        await (0, testing_1.createTestContext)(async () => {
            // Create a parent span and intentionally DO NOT end it (simulates async bug / forgotten end()).
            const parent = span_1.SpanObserver.start('parent');
            // Make it current and create a child span that references it as parentObservabilityLogId.
            await (0, storage_1.withCurrentSpan)(parent, async () => {
                await span_1.SpanObserver.withSpan('child', async () => {
                    // no-op
                });
            });
            // Flush should force-end the open parent span before enforcing hierarchy integrity.
            await manager_1.ObservabilityManager.flush();
        }, { correlationId: 'corr-test-1' });
        // No invariant violation log should be emitted.
        const violations = backend.getEventsMatching({
            type: 'log',
            operation: 'observability.invariant_violation.missing_parent_span',
        });
        expect(violations.length).toBe(0);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmx1c2gtZ3JhcGgtaGllcmFyY2h5LnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9mbHVzaC1ncmFwaC1oaWVyYXJjaHkudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVDQUFpRDtBQUNqRCwyQ0FBZ0Q7QUFDaEQsdUNBQWtIO0FBQ2xILHVFQUE0RTtBQUU1RSxRQUFRLENBQUMsaURBQWlELEVBQUUsR0FBRyxFQUFFO0lBQy9ELElBQUksT0FBb0IsQ0FBQztJQUV6QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsT0FBTyxHQUFHLElBQUEsZ0NBQXNCLEVBQUM7WUFDL0IsT0FBTyxFQUFFLElBQUk7WUFDYiw2RUFBNkU7WUFDN0UsY0FBYyxFQUFFLElBQUk7WUFDcEIsaUJBQWlCLEVBQUUsRUFBRTtTQUN0QixDQUFDLENBQUM7UUFFSCwyREFBMkQ7UUFDM0QsTUFBTSxHQUFHLEdBQUcsOEJBQW9CLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDN0MsSUFBSSxDQUFDLEdBQUc7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUM7UUFDekQsOEJBQW9CLENBQUMsU0FBUyxDQUFDO1lBQzdCLGNBQWMsRUFBRSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUU7WUFDOUUsUUFBUSxFQUFFO2dCQUNSLEdBQUcsQ0FBQyxHQUFHLENBQUMsUUFBUSxJQUFJO29CQUNsQixPQUFPLEVBQUUsS0FBSztvQkFDZCxLQUFLLEVBQUUsS0FBSztvQkFDWixhQUFhLEVBQUUsSUFBSTtvQkFDbkIsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUU7aUJBQ3ZFLENBQUM7Z0JBQ0YsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLEtBQUs7Z0JBQ1osYUFBYSxFQUFFLElBQUk7Z0JBQ25CLEtBQUssRUFBRSxFQUFFLFFBQVEsRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFO2FBQ3ZFO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLDZFQUE2RSxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQzNGLE1BQU0sSUFBQSwyQkFBaUIsRUFBQyxLQUFLLElBQUksRUFBRTtZQUNqQyxnR0FBZ0c7WUFDaEcsTUFBTSxNQUFNLEdBQUcsbUJBQVksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUM7WUFFNUMsMEZBQTBGO1lBQzFGLE1BQU0sSUFBQSx5QkFBZSxFQUFDLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDdkMsTUFBTSxtQkFBWSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7b0JBQzlDLFFBQVE7Z0JBQ1YsQ0FBQyxDQUFDLENBQUM7WUFDTCxDQUFDLENBQUMsQ0FBQztZQUVILG9GQUFvRjtZQUNwRixNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUMsRUFBRSxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBRXJDLGdEQUFnRDtRQUNoRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUM7WUFDM0MsSUFBSSxFQUFFLEtBQUs7WUFDWCxTQUFTLEVBQUUsdURBQXVEO1NBQ25FLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IHNldHVwVGVzdE9ic2VydmFiaWxpdHksIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSwgY3JlYXRlVGVzdENvbnRleHQsIHR5cGUgTW9ja0JhY2tlbmQgfSBmcm9tICcuL3Rlc3RpbmcnO1xuaW1wb3J0IHsgd2l0aEN1cnJlbnRTcGFuIH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3N0b3JhZ2UnO1xuXG5kZXNjcmliZSgnZmx1c2gtdGltZSBncmFwaCBoaWVyYXJjaHkgKG5vIG1pc3NpbmcgcGFyZW50cyknLCAoKSA9PiB7XG4gIGxldCBiYWNrZW5kOiBNb2NrQmFja2VuZDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBiYWNrZW5kID0gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSh7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgLy8gUmVhbGlzdGljIGRlZmF1bHRzOiBza2lwIGVtcHRpZXMsIGRyb3Agc2hvcnQgc3BhbnMgdmlhIGR1cmF0aW9uIHRocmVzaG9sZC5cbiAgICAgIHNraXBFbXB0eVNwYW5zOiB0cnVlLFxuICAgICAgbWluU3BhbkR1cmF0aW9uTXM6IDUwLFxuICAgIH0pO1xuXG4gICAgLy8gRW5hYmxlIGJ1ZmZlcmluZyBzbyBmbHVzaC10aW1lIGdyYXBoIGxvZ2ljIGlzIGV4ZXJjaXNlZC5cbiAgICBjb25zdCBjZmcgPSBPYnNlcnZhYmlsaXR5TWFuYWdlci5nZXRDb25maWcoKTtcbiAgICBpZiAoIWNmZykgdGhyb3cgbmV3IEVycm9yKCd0ZXN0IGNvbmZpZyBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5jb25maWd1cmUoe1xuICAgICAgbm9pc2VSZWR1Y3Rpb246IHsgLi4uY2ZnLm5vaXNlUmVkdWN0aW9uLCBlbmFibGVkOiB0cnVlLCBlbWl0U3VtbWFyaWVzOiBmYWxzZSB9LFxuICAgICAgc2FtcGxpbmc6IHtcbiAgICAgICAgLi4uKGNmZy5zYW1wbGluZyA/PyB7XG4gICAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgc21hcnQ6IGZhbHNlLFxuICAgICAgICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgICAgICAgcmF0ZXM6IHsgY3JpdGljYWw6IDEsIGVycm9yOiAxLCB3YXJuOiAxLCBpbmZvOiAxLCBkZWJ1ZzogMSwgdHJhY2U6IDEgfSxcbiAgICAgICAgfSksXG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICBzbWFydDogZmFsc2UsXG4gICAgICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgICAgIHJhdGVzOiB7IGNyaXRpY2FsOiAxLCBlcnJvcjogMSwgd2FybjogMSwgaW5mbzogMSwgZGVidWc6IDEsIHRyYWNlOiAxIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSgpO1xuICB9KTtcblxuICBpdCgnZm9yY2UtZW5kcyBvcGVuIHBhcmVudCBzcGFucyBhdCBmbHVzaCBhbmQgZG9lcyBub3QgZW1pdCBpbnZhcmlhbnQgdmlvbGF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIC8vIENyZWF0ZSBhIHBhcmVudCBzcGFuIGFuZCBpbnRlbnRpb25hbGx5IERPIE5PVCBlbmQgaXQgKHNpbXVsYXRlcyBhc3luYyBidWcgLyBmb3Jnb3R0ZW4gZW5kKCkpLlxuICAgICAgY29uc3QgcGFyZW50ID0gU3Bhbk9ic2VydmVyLnN0YXJ0KCdwYXJlbnQnKTtcblxuICAgICAgLy8gTWFrZSBpdCBjdXJyZW50IGFuZCBjcmVhdGUgYSBjaGlsZCBzcGFuIHRoYXQgcmVmZXJlbmNlcyBpdCBhcyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQuXG4gICAgICBhd2FpdCB3aXRoQ3VycmVudFNwYW4ocGFyZW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3BhbignY2hpbGQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgLy8gbm8tb3BcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gRmx1c2ggc2hvdWxkIGZvcmNlLWVuZCB0aGUgb3BlbiBwYXJlbnQgc3BhbiBiZWZvcmUgZW5mb3JjaW5nIGhpZXJhcmNoeSBpbnRlZ3JpdHkuXG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH0sIHsgY29ycmVsYXRpb25JZDogJ2NvcnItdGVzdC0xJyB9KTtcblxuICAgIC8vIE5vIGludmFyaWFudCB2aW9sYXRpb24gbG9nIHNob3VsZCBiZSBlbWl0dGVkLlxuICAgIGNvbnN0IHZpb2xhdGlvbnMgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW4nLFxuICAgIH0pO1xuICAgIGV4cGVjdCh2aW9sYXRpb25zLmxlbmd0aCkudG9CZSgwKTtcbiAgfSk7XG59KTtcblxuXG4iXX0=