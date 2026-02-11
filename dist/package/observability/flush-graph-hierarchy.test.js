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
            noiseReduction: { ...cfg.noiseReduction, enabled: true },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmx1c2gtZ3JhcGgtaGllcmFyY2h5LnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9mbHVzaC1ncmFwaC1oaWVyYXJjaHkudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVDQUFpRDtBQUNqRCwyQ0FBZ0Q7QUFDaEQsdUNBQWtIO0FBQ2xILHVFQUE0RTtBQUU1RSxRQUFRLENBQUMsaURBQWlELEVBQUUsR0FBRyxFQUFFO0lBQy9ELElBQUksT0FBb0IsQ0FBQztJQUV6QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsT0FBTyxHQUFHLElBQUEsZ0NBQXNCLEVBQUM7WUFDL0IsT0FBTyxFQUFFLElBQUk7WUFDYiw2RUFBNkU7WUFDN0UsY0FBYyxFQUFFLElBQUk7WUFDcEIsaUJBQWlCLEVBQUUsRUFBRTtTQUN0QixDQUFDLENBQUM7UUFFSCwyREFBMkQ7UUFDM0QsTUFBTSxHQUFHLEdBQUcsOEJBQW9CLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDN0MsSUFBSSxDQUFDLEdBQUc7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUM7UUFDekQsOEJBQW9CLENBQUMsU0FBUyxDQUFDO1lBQzdCLGNBQWMsRUFBRSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO1lBQ3hELFFBQVEsRUFBRTtnQkFDUixHQUFHLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSTtvQkFDbEIsT0FBTyxFQUFFLEtBQUs7b0JBQ2QsS0FBSyxFQUFFLEtBQUs7b0JBQ1osYUFBYSxFQUFFLElBQUk7b0JBQ25CLEtBQUssRUFBRSxFQUFFLFFBQVEsRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFO2lCQUN2RSxDQUFDO2dCQUNGLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxLQUFLO2dCQUNaLGFBQWEsRUFBRSxJQUFJO2dCQUNuQixLQUFLLEVBQUUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRTthQUN2RTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNiLElBQUEsa0NBQXdCLEdBQUUsQ0FBQztJQUM3QixDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyw2RUFBNkUsRUFBRSxLQUFLLElBQUksRUFBRTtRQUMzRixNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsZ0dBQWdHO1lBQ2hHLE1BQU0sTUFBTSxHQUFHLG1CQUFZLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBRTVDLDBGQUEwRjtZQUMxRixNQUFNLElBQUEseUJBQWUsRUFBQyxNQUFNLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ3ZDLE1BQU0sbUJBQVksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLEtBQUssSUFBSSxFQUFFO29CQUM5QyxRQUFRO2dCQUNWLENBQUMsQ0FBQyxDQUFDO1lBQ0wsQ0FBQyxDQUFDLENBQUM7WUFFSCxvRkFBb0Y7WUFDcEYsTUFBTSw4QkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDLEVBQUUsRUFBRSxhQUFhLEVBQUUsYUFBYSxFQUFFLENBQUMsQ0FBQztRQUVyQyxnREFBZ0Q7UUFDaEQsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDO1lBQzNDLElBQUksRUFBRSxLQUFLO1lBQ1gsU0FBUyxFQUFFLHVEQUF1RDtTQUNuRSxDQUFDLENBQUM7UUFDSCxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNwQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuL21hbmFnZXInO1xuaW1wb3J0IHsgU3Bhbk9ic2VydmVyIH0gZnJvbSAnLi9vYnNlcnZlcnMvc3Bhbic7XG5pbXBvcnQgeyBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5LCBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHksIGNyZWF0ZVRlc3RDb250ZXh0LCB0eXBlIE1vY2tCYWNrZW5kIH0gZnJvbSAnLi90ZXN0aW5nJztcbmltcG9ydCB7IHdpdGhDdXJyZW50U3BhbiB9IGZyb20gJy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dC9zdG9yYWdlJztcblxuZGVzY3JpYmUoJ2ZsdXNoLXRpbWUgZ3JhcGggaGllcmFyY2h5IChubyBtaXNzaW5nIHBhcmVudHMpJywgKCkgPT4ge1xuICBsZXQgYmFja2VuZDogTW9ja0JhY2tlbmQ7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgYmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoe1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIC8vIFJlYWxpc3RpYyBkZWZhdWx0czogc2tpcCBlbXB0aWVzLCBkcm9wIHNob3J0IHNwYW5zIHZpYSBkdXJhdGlvbiB0aHJlc2hvbGQuXG4gICAgICBza2lwRW1wdHlTcGFuczogdHJ1ZSxcbiAgICAgIG1pblNwYW5EdXJhdGlvbk1zOiA1MCxcbiAgICB9KTtcblxuICAgIC8vIEVuYWJsZSBidWZmZXJpbmcgc28gZmx1c2gtdGltZSBncmFwaCBsb2dpYyBpcyBleGVyY2lzZWQuXG4gICAgY29uc3QgY2ZnID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZ2V0Q29uZmlnKCk7XG4gICAgaWYgKCFjZmcpIHRocm93IG5ldyBFcnJvcigndGVzdCBjb25maWcgbm90IGluaXRpYWxpemVkJyk7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY29uZmlndXJlKHtcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7IC4uLmNmZy5ub2lzZVJlZHVjdGlvbiwgZW5hYmxlZDogdHJ1ZSB9LFxuICAgICAgc2FtcGxpbmc6IHtcbiAgICAgICAgLi4uKGNmZy5zYW1wbGluZyA/PyB7XG4gICAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgICAgc21hcnQ6IGZhbHNlLFxuICAgICAgICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgICAgICAgcmF0ZXM6IHsgY3JpdGljYWw6IDEsIGVycm9yOiAxLCB3YXJuOiAxLCBpbmZvOiAxLCBkZWJ1ZzogMSwgdHJhY2U6IDEgfSxcbiAgICAgICAgfSksXG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICBzbWFydDogZmFsc2UsXG4gICAgICAgIG1heEJ1ZmZlclNpemU6IDEwMDAsXG4gICAgICAgIHJhdGVzOiB7IGNyaXRpY2FsOiAxLCBlcnJvcjogMSwgd2FybjogMSwgaW5mbzogMSwgZGVidWc6IDEsIHRyYWNlOiAxIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSgpO1xuICB9KTtcblxuICBpdCgnZm9yY2UtZW5kcyBvcGVuIHBhcmVudCBzcGFucyBhdCBmbHVzaCBhbmQgZG9lcyBub3QgZW1pdCBpbnZhcmlhbnQgdmlvbGF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIC8vIENyZWF0ZSBhIHBhcmVudCBzcGFuIGFuZCBpbnRlbnRpb25hbGx5IERPIE5PVCBlbmQgaXQgKHNpbXVsYXRlcyBhc3luYyBidWcgLyBmb3Jnb3R0ZW4gZW5kKCkpLlxuICAgICAgY29uc3QgcGFyZW50ID0gU3Bhbk9ic2VydmVyLnN0YXJ0KCdwYXJlbnQnKTtcblxuICAgICAgLy8gTWFrZSBpdCBjdXJyZW50IGFuZCBjcmVhdGUgYSBjaGlsZCBzcGFuIHRoYXQgcmVmZXJlbmNlcyBpdCBhcyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQuXG4gICAgICBhd2FpdCB3aXRoQ3VycmVudFNwYW4ocGFyZW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IFNwYW5PYnNlcnZlci53aXRoU3BhbignY2hpbGQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgLy8gbm8tb3BcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gRmx1c2ggc2hvdWxkIGZvcmNlLWVuZCB0aGUgb3BlbiBwYXJlbnQgc3BhbiBiZWZvcmUgZW5mb3JjaW5nIGhpZXJhcmNoeSBpbnRlZ3JpdHkuXG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH0sIHsgY29ycmVsYXRpb25JZDogJ2NvcnItdGVzdC0xJyB9KTtcblxuICAgIC8vIE5vIGludmFyaWFudCB2aW9sYXRpb24gbG9nIHNob3VsZCBiZSBlbWl0dGVkLlxuICAgIGNvbnN0IHZpb2xhdGlvbnMgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW4nLFxuICAgIH0pO1xuICAgIGV4cGVjdCh2aW9sYXRpb25zLmxlbmd0aCkudG9CZSgwKTtcbiAgfSk7XG59KTtcblxuXG4iXX0=