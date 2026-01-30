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
                emitSummaries: false,
                rules: [],
                maxCheckpointsPerSpan: 10,
                maxAggregateKeysPerSpan: 10,
                maxAggregateExamplesPerKey: 10,
                maxAggregateErrorExamplesPerKey: 10,
                includeDebugMetadata: false,
                includeExamples: false,
            },
        });
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    it('drops events that reference missing parentObservabilityLogId and emits a single invariant violation log', async () => {
        await (0, testing_1.createTestContext)(async () => {
            // Buffer an event that references a missing parent span id.
            manager_1.ObservabilityManager.capture({
                type: 'log',
                level: 'info',
                operation: 'child',
                parentObservabilityLogId: 'missing-parent',
                correlationId: 'c1',
            });
            await manager_1.ObservabilityManager.flush();
        });
        const keptChild = backend.getEventsMatching({ type: 'log', operation: 'child' });
        expect(keptChild.length).toBe(0);
        const violation = backend.getEventsMatching({
            type: 'log',
            operation: 'observability.invariant_violation.missing_parent_span',
        });
        expect(violation.length).toBe(1);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGllcmFyY2h5LWludGVncml0eS1lbmZvcmNlbWVudC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvaGllcmFyY2h5LWludGVncml0eS1lbmZvcmNlbWVudC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsdUNBQWlEO0FBQ2pELHVDQUFrSDtBQUVsSCxRQUFRLENBQUMsaUNBQWlDLEVBQUUsR0FBRyxFQUFFO0lBQy9DLElBQUksT0FBb0IsQ0FBQztJQUV6QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsT0FBTyxHQUFHLElBQUEsZ0NBQXNCLEVBQUM7WUFDL0IsT0FBTyxFQUFFLElBQUk7U0FDZCxDQUFDLENBQUM7UUFFSCxnRUFBZ0U7UUFDaEUsOEJBQW9CLENBQUMsU0FBUyxDQUFDO1lBQzdCLFFBQVEsRUFBRTtnQkFDUixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUUsS0FBSztnQkFDWixhQUFhLEVBQUUsSUFBSTtnQkFDbkIsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxLQUFLLEVBQUUsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUU7YUFDdkU7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLEVBQUU7Z0JBQ1gsYUFBYSxFQUFFLEtBQUs7Z0JBQ3BCLEtBQUssRUFBRSxFQUFFO2dCQUNULHFCQUFxQixFQUFFLEVBQUU7Z0JBQ3pCLHVCQUF1QixFQUFFLEVBQUU7Z0JBQzNCLDBCQUEwQixFQUFFLEVBQUU7Z0JBQzlCLCtCQUErQixFQUFFLEVBQUU7Z0JBQ25DLG9CQUFvQixFQUFFLEtBQUs7Z0JBQzNCLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHlHQUF5RyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ3ZILE1BQU0sSUFBQSwyQkFBaUIsRUFBQyxLQUFLLElBQUksRUFBRTtZQUNqQyw0REFBNEQ7WUFDNUQsOEJBQW9CLENBQUMsT0FBTyxDQUFDO2dCQUMzQixJQUFJLEVBQUUsS0FBSztnQkFDWCxLQUFLLEVBQUUsTUFBTTtnQkFDYixTQUFTLEVBQUUsT0FBTztnQkFDbEIsd0JBQXdCLEVBQUUsZ0JBQWdCO2dCQUMxQyxhQUFhLEVBQUUsSUFBSTthQUNwQixDQUFDLENBQUM7WUFFSCxNQUFNLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUNqRixNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVqQyxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUM7WUFDMUMsSUFBSSxFQUFFLEtBQUs7WUFDWCxTQUFTLEVBQUUsdURBQXVEO1NBQ25FLENBQUMsQ0FBQztRQUNILE1BQU0sQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25DLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5pbXBvcnQgeyBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5LCBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHksIGNyZWF0ZVRlc3RDb250ZXh0LCB0eXBlIE1vY2tCYWNrZW5kIH0gZnJvbSAnLi90ZXN0aW5nJztcblxuZGVzY3JpYmUoJ0hpZXJhcmNoeSBpbnRlZ3JpdHkgZW5mb3JjZW1lbnQnLCAoKSA9PiB7XG4gIGxldCBiYWNrZW5kOiBNb2NrQmFja2VuZDtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBiYWNrZW5kID0gc2V0dXBUZXN0T2JzZXJ2YWJpbGl0eSh7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gRW5hYmxlIGJ1ZmZlcmluZyBzbyBldmVudHMgZ28gdGhyb3VnaCBmbHVzaC10aW1lIGVuZm9yY2VtZW50LlxuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNvbmZpZ3VyZSh7XG4gICAgICBzYW1wbGluZzoge1xuICAgICAgICBlbmFibGVkOiBmYWxzZSxcbiAgICAgICAgc21hcnQ6IGZhbHNlLFxuICAgICAgICBtYXhCdWZmZXJTaXplOiAxMDAwLFxuICAgICAgICByYXRlczogeyBjcml0aWNhbDogMSwgZXJyb3I6IDEsIHdhcm46IDEsIGluZm86IDEsIGRlYnVnOiAxLCB0cmFjZTogMSB9LFxuICAgICAgfSxcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFtdLFxuICAgICAgICBlbWl0U3VtbWFyaWVzOiBmYWxzZSxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBtYXhDaGVja3BvaW50c1BlclNwYW46IDEwLFxuICAgICAgICBtYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbjogMTAsXG4gICAgICAgIG1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5OiAxMCxcbiAgICAgICAgbWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleTogMTAsXG4gICAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiBmYWxzZSxcbiAgICAgICAgaW5jbHVkZUV4YW1wbGVzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gIH0pO1xuXG4gIGl0KCdkcm9wcyBldmVudHMgdGhhdCByZWZlcmVuY2UgbWlzc2luZyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgYW5kIGVtaXRzIGEgc2luZ2xlIGludmFyaWFudCB2aW9sYXRpb24gbG9nJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEJ1ZmZlciBhbiBldmVudCB0aGF0IHJlZmVyZW5jZXMgYSBtaXNzaW5nIHBhcmVudCBzcGFuIGlkLlxuICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBvcGVyYXRpb246ICdjaGlsZCcsXG4gICAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ21pc3NpbmctcGFyZW50JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH0pO1xuXG4gICAgY29uc3Qga2VwdENoaWxkID0gYmFja2VuZC5nZXRFdmVudHNNYXRjaGluZyh7IHR5cGU6ICdsb2cnLCBvcGVyYXRpb246ICdjaGlsZCcgfSk7XG4gICAgZXhwZWN0KGtlcHRDaGlsZC5sZW5ndGgpLnRvQmUoMCk7XG5cbiAgICBjb25zdCB2aW9sYXRpb24gPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW4nLFxuICAgIH0pO1xuICAgIGV4cGVjdCh2aW9sYXRpb24ubGVuZ3RoKS50b0JlKDEpO1xuICB9KTtcbn0pO1xuXG5cbiJdfQ==