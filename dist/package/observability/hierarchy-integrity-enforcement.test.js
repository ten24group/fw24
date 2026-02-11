"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const manager_1 = require("./manager");
const testing_1 = require("./testing");
describe('Hierarchy integrity enforcement', () => {
    let backend;
    beforeEach(() => {
        backend = (0, testing_1.setupTestObservability)({
            enabled: true,
        });
        // Enable buffering so events go through flush-time enforcement.
        manager_1.ObservabilityManager.configure({
            sampling: {
                enabled: false,
                smart: false,
                maxBufferSize: 1000,
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
    it('preserves events referencing missing parent (cross-batch linking)', async () => {
        // v2 design: events referencing parents not in the current batch are preserved
        // with their original parentObservabilityLogId intact (for cross-batch/cross-invocation linking).
        // The noise reduction algorithm treats these as root nodes in the batch.
        await (0, testing_1.createTestContext)(async () => {
            manager_1.ObservabilityManager.capture({
                type: 'log',
                level: 'info',
                operation: 'child',
                parentObservabilityLogId: 'missing-parent',
                correlationId: 'c1',
            });
            await manager_1.ObservabilityManager.flush();
        });
        // Child event should be emitted (parent may be from another invocation)
        const keptChild = backend.getEventsMatching({ type: 'log', operation: 'child' });
        expect(keptChild.length).toBe(1);
        // parentObservabilityLogId should be preserved for cross-batch linking
        expect(keptChild[0].parentObservabilityLogId).toBe('missing-parent');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGllcmFyY2h5LWludGVncml0eS1lbmZvcmNlbWVudC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvaGllcmFyY2h5LWludGVncml0eS1lbmZvcmNlbWVudC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsdUNBQWlEO0FBQ2pELHVDQUFrSDtBQUVsSCxRQUFRLENBQUMsaUNBQWlDLEVBQUUsR0FBRyxFQUFFO0lBQy9DLElBQUksT0FBb0IsQ0FBQztJQUV6QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsT0FBTyxHQUFHLElBQUEsZ0NBQXNCLEVBQUM7WUFDL0IsT0FBTyxFQUFFLElBQUk7U0FDZCxDQUFDLENBQUM7UUFFSCxnRUFBZ0U7UUFDaEUsOEJBQW9CLENBQUMsU0FBUyxDQUFDO1lBQzdCLFFBQVEsRUFBRTtnQkFDUixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUUsS0FBSztnQkFDWixhQUFhLEVBQUUsSUFBSTtnQkFDbkIsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUU7YUFDdkU7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLEVBQUU7Z0JBQ1gsS0FBSyxFQUFFLEVBQUU7Z0JBQ1Qsd0JBQXdCLEVBQUUsRUFBRTtnQkFDNUIsK0JBQStCLEVBQUUsRUFBRTtnQkFDbkMsMkJBQTJCLEVBQUUsR0FBRztnQkFDaEMsK0JBQStCLEVBQUUsRUFBRTtnQkFDbkMsNkJBQTZCLEVBQUUsR0FBRzthQUNuQztTQUNGLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNiLElBQUEsa0NBQXdCLEdBQUUsQ0FBQztJQUM3QixDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxtRUFBbUUsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNqRiwrRUFBK0U7UUFDL0Usa0dBQWtHO1FBQ2xHLHlFQUF5RTtRQUN6RSxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsOEJBQW9CLENBQUMsT0FBTyxDQUFDO2dCQUMzQixJQUFJLEVBQUUsS0FBSztnQkFDWCxLQUFLLEVBQUUsTUFBTTtnQkFDYixTQUFTLEVBQUUsT0FBTztnQkFDbEIsd0JBQXdCLEVBQUUsZ0JBQWdCO2dCQUMxQyxhQUFhLEVBQUUsSUFBSTthQUNwQixDQUFDLENBQUM7WUFFSCxNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUMsQ0FBQyxDQUFDO1FBRUgsd0VBQXdFO1FBQ3hFLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFDakYsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFakMsdUVBQXVFO1FBQ3ZFLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztJQUN2RSxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tICcuL21hbmFnZXInO1xuaW1wb3J0IHsgc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSwgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5LCBjcmVhdGVUZXN0Q29udGV4dCwgdHlwZSBNb2NrQmFja2VuZCB9IGZyb20gJy4vdGVzdGluZyc7XG5cbmRlc2NyaWJlKCdIaWVyYXJjaHkgaW50ZWdyaXR5IGVuZm9yY2VtZW50JywgKCkgPT4ge1xuICBsZXQgYmFja2VuZDogTW9ja0JhY2tlbmQ7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgYmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoe1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEVuYWJsZSBidWZmZXJpbmcgc28gZXZlbnRzIGdvIHRocm91Z2ggZmx1c2gtdGltZSBlbmZvcmNlbWVudC5cbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5jb25maWd1cmUoe1xuICAgICAgc2FtcGxpbmc6IHtcbiAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgIHNtYXJ0OiBmYWxzZSxcbiAgICAgICAgbWF4QnVmZmVyU2l6ZTogMTAwMCxcbiAgICAgICAgcmF0ZXM6IHsgY3JpdGljYWw6IDEsIGVycm9yOiAxLCB3YXJuOiAxLCBpbmZvOiAxLCBkZWJ1ZzogMSwgdHJhY2U6IDEgfSxcbiAgICAgIH0sXG4gICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbXSxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBtYXhBYnNvcmJlZEVycm9yc1BlclNwYW46IDIwLFxuICAgICAgICBtYXhBYnNvcmJlZENhdXNlZEJ5TGlua3NQZXJTcGFuOiA1MCxcbiAgICAgICAgbWF4QWJzb3JiZWRFbnRpdHlJZHNQZXJTcGFuOiAxMDAsXG4gICAgICAgIG1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW46IDUwLFxuICAgICAgICBtYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbjogMTAwLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgfSk7XG5cbiAgaXQoJ3ByZXNlcnZlcyBldmVudHMgcmVmZXJlbmNpbmcgbWlzc2luZyBwYXJlbnQgKGNyb3NzLWJhdGNoIGxpbmtpbmcpJywgYXN5bmMgKCkgPT4ge1xuICAgIC8vIHYyIGRlc2lnbjogZXZlbnRzIHJlZmVyZW5jaW5nIHBhcmVudHMgbm90IGluIHRoZSBjdXJyZW50IGJhdGNoIGFyZSBwcmVzZXJ2ZWRcbiAgICAvLyB3aXRoIHRoZWlyIG9yaWdpbmFsIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpbnRhY3QgKGZvciBjcm9zcy1iYXRjaC9jcm9zcy1pbnZvY2F0aW9uIGxpbmtpbmcpLlxuICAgIC8vIFRoZSBub2lzZSByZWR1Y3Rpb24gYWxnb3JpdGhtIHRyZWF0cyB0aGVzZSBhcyByb290IG5vZGVzIGluIHRoZSBiYXRjaC5cbiAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIG9wZXJhdGlvbjogJ2NoaWxkJyxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWlzc2luZy1wYXJlbnQnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfSk7XG5cbiAgICAvLyBDaGlsZCBldmVudCBzaG91bGQgYmUgZW1pdHRlZCAocGFyZW50IG1heSBiZSBmcm9tIGFub3RoZXIgaW52b2NhdGlvbilcbiAgICBjb25zdCBrZXB0Q2hpbGQgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ2xvZycsIG9wZXJhdGlvbjogJ2NoaWxkJyB9KTtcbiAgICBleHBlY3Qoa2VwdENoaWxkLmxlbmd0aCkudG9CZSgxKTtcblxuICAgIC8vIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBzaG91bGQgYmUgcHJlc2VydmVkIGZvciBjcm9zcy1iYXRjaCBsaW5raW5nXG4gICAgZXhwZWN0KGtlcHRDaGlsZFswXS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ21pc3NpbmctcGFyZW50Jyk7XG4gIH0pO1xufSk7XG5cblxuIl19