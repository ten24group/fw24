"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const span_1 = require("./observers/span");
const base_1 = require("./observers/base");
const testing_1 = require("./testing");
/**
 * Regression: prevent orphan parentObservabilityLogId when span filtering is enabled.
 *
 * Failure mode:
 * - A child event is captured with parentObservabilityLogId = current span id
 * - Parent span is later considered "empty" and filtered out
 * - UI fetches parent by id and gets 404
 *
 * Fix:
 * - When a span id is emitted as parentObservabilityLogId, we explicitly register that reference
 *   in execution-context state at the time the child event is captured.
 * - Span end filtering consults that reference to avoid dropping the parent due to skipEmpty/minDuration.
 */
describe('Observability orphan parent prevention', () => {
    let backend;
    beforeEach(() => {
        // Enable aggressive filtering to reproduce the bug:
        // - skipEmpty=true
        // - minDuration huge (would normally filter out fast spans)
        backend = (0, testing_1.setupTestObservability)({
            enabled: true,
            skipEmptySpans: true,
            minSpanDurationMs: 999999,
        });
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    it('does not drop parent span when its id is used as parentObservabilityLogId', async () => {
        await (0, testing_1.createTestContext)(async () => {
            await span_1.SpanObserver.withSpan('parent', async () => {
                // Capture a child log while the parent span is current.
                // This will resolve parentObservabilityLogId via getCurrentParentObservabilityLogId()
                // and register a parent reference so the parent span is not filtered out.
                (0, base_1.captureRecord)('test', {
                    type: 'log',
                    level: 'info',
                    operation: 'child',
                });
            });
        });
        const spans = backend.getEventsMatching({ type: 'span', operation: 'parent' });
        expect(spans.length).toBe(1);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JwaGFuLXBhcmVudC1wcmV2ZW50aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9vcnBoYW4tcGFyZW50LXByZXZlbnRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUFnRDtBQUNoRCwyQ0FBaUQ7QUFDakQsdUNBQWtIO0FBRWxIOzs7Ozs7Ozs7Ozs7R0FZRztBQUNILFFBQVEsQ0FBQyx3Q0FBd0MsRUFBRSxHQUFHLEVBQUU7SUFDdEQsSUFBSSxPQUFvQixDQUFDO0lBRXpCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxvREFBb0Q7UUFDcEQsbUJBQW1CO1FBQ25CLDREQUE0RDtRQUM1RCxPQUFPLEdBQUcsSUFBQSxnQ0FBc0IsRUFBQztZQUMvQixPQUFPLEVBQUUsSUFBSTtZQUNiLGNBQWMsRUFBRSxJQUFJO1lBQ3BCLGlCQUFpQixFQUFFLE1BQU07U0FDMUIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLDJFQUEyRSxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ3pGLE1BQU0sSUFBQSwyQkFBaUIsRUFBQyxLQUFLLElBQUksRUFBRTtZQUNqQyxNQUFNLG1CQUFZLENBQUMsUUFBUSxDQUN6QixRQUFRLEVBQ1IsS0FBSyxJQUFJLEVBQUU7Z0JBQ1Qsd0RBQXdEO2dCQUN4RCxzRkFBc0Y7Z0JBQ3RGLDBFQUEwRTtnQkFDMUUsSUFBQSxvQkFBYSxFQUFDLE1BQU0sRUFBRTtvQkFDcEIsSUFBSSxFQUFFLEtBQUs7b0JBQ1gsS0FBSyxFQUFFLE1BQU07b0JBQ2IsU0FBUyxFQUFFLE9BQU87aUJBQ25CLENBQUMsQ0FBQztZQUNMLENBQUMsQ0FHRixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBQy9FLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQy9CLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTcGFuT2JzZXJ2ZXIgfSBmcm9tICcuL29ic2VydmVycy9zcGFuJztcbmltcG9ydCB7IGNhcHR1cmVSZWNvcmQgfSBmcm9tICcuL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IHNldHVwVGVzdE9ic2VydmFiaWxpdHksIGNsZWFudXBUZXN0T2JzZXJ2YWJpbGl0eSwgY3JlYXRlVGVzdENvbnRleHQsIHR5cGUgTW9ja0JhY2tlbmQgfSBmcm9tICcuL3Rlc3RpbmcnO1xuXG4vKipcbiAqIFJlZ3Jlc3Npb246IHByZXZlbnQgb3JwaGFuIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCB3aGVuIHNwYW4gZmlsdGVyaW5nIGlzIGVuYWJsZWQuXG4gKlxuICogRmFpbHVyZSBtb2RlOlxuICogLSBBIGNoaWxkIGV2ZW50IGlzIGNhcHR1cmVkIHdpdGggcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gY3VycmVudCBzcGFuIGlkXG4gKiAtIFBhcmVudCBzcGFuIGlzIGxhdGVyIGNvbnNpZGVyZWQgXCJlbXB0eVwiIGFuZCBmaWx0ZXJlZCBvdXRcbiAqIC0gVUkgZmV0Y2hlcyBwYXJlbnQgYnkgaWQgYW5kIGdldHMgNDA0XG4gKlxuICogRml4OlxuICogLSBXaGVuIGEgc3BhbiBpZCBpcyBlbWl0dGVkIGFzIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCwgd2UgZXhwbGljaXRseSByZWdpc3RlciB0aGF0IHJlZmVyZW5jZVxuICogICBpbiBleGVjdXRpb24tY29udGV4dCBzdGF0ZSBhdCB0aGUgdGltZSB0aGUgY2hpbGQgZXZlbnQgaXMgY2FwdHVyZWQuXG4gKiAtIFNwYW4gZW5kIGZpbHRlcmluZyBjb25zdWx0cyB0aGF0IHJlZmVyZW5jZSB0byBhdm9pZCBkcm9wcGluZyB0aGUgcGFyZW50IGR1ZSB0byBza2lwRW1wdHkvbWluRHVyYXRpb24uXG4gKi9cbmRlc2NyaWJlKCdPYnNlcnZhYmlsaXR5IG9ycGhhbiBwYXJlbnQgcHJldmVudGlvbicsICgpID0+IHtcbiAgbGV0IGJhY2tlbmQ6IE1vY2tCYWNrZW5kO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIEVuYWJsZSBhZ2dyZXNzaXZlIGZpbHRlcmluZyB0byByZXByb2R1Y2UgdGhlIGJ1ZzpcbiAgICAvLyAtIHNraXBFbXB0eT10cnVlXG4gICAgLy8gLSBtaW5EdXJhdGlvbiBodWdlICh3b3VsZCBub3JtYWxseSBmaWx0ZXIgb3V0IGZhc3Qgc3BhbnMpXG4gICAgYmFja2VuZCA9IHNldHVwVGVzdE9ic2VydmFiaWxpdHkoe1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNraXBFbXB0eVNwYW5zOiB0cnVlLFxuICAgICAgbWluU3BhbkR1cmF0aW9uTXM6IDk5OTk5OSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkoKTtcbiAgfSk7XG5cbiAgaXQoJ2RvZXMgbm90IGRyb3AgcGFyZW50IHNwYW4gd2hlbiBpdHMgaWQgaXMgdXNlZCBhcyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQnLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgU3Bhbk9ic2VydmVyLndpdGhTcGFuKFxuICAgICAgICAncGFyZW50JyxcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIC8vIENhcHR1cmUgYSBjaGlsZCBsb2cgd2hpbGUgdGhlIHBhcmVudCBzcGFuIGlzIGN1cnJlbnQuXG4gICAgICAgICAgLy8gVGhpcyB3aWxsIHJlc29sdmUgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHZpYSBnZXRDdXJyZW50UGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKClcbiAgICAgICAgICAvLyBhbmQgcmVnaXN0ZXIgYSBwYXJlbnQgcmVmZXJlbmNlIHNvIHRoZSBwYXJlbnQgc3BhbiBpcyBub3QgZmlsdGVyZWQgb3V0LlxuICAgICAgICAgIGNhcHR1cmVSZWNvcmQoJ3Rlc3QnLCB7XG4gICAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgICAgICBvcGVyYXRpb246ICdjaGlsZCcsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0sXG4gICAgICAgIC8vIERvIE5PVCBhZGQgYW55IG90aGVyIGNvbnRlbnQgdG8gdGhlIHBhcmVudCBzcGFuLiBJZiBjaGlsZCBtYXJraW5nIHdvcmtzLFxuICAgICAgICAvLyB0aGUgc3BhbiBzaG91bGQgc3RpbGwgYmUgY2FwdHVyZWQgZGVzcGl0ZSBza2lwRW1wdHkrbWluRHVyYXRpb24uXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgY29uc3Qgc3BhbnMgPSBiYWNrZW5kLmdldEV2ZW50c01hdGNoaW5nKHsgdHlwZTogJ3NwYW4nLCBvcGVyYXRpb246ICdwYXJlbnQnIH0pO1xuICAgIGV4cGVjdChzcGFucy5sZW5ndGgpLnRvQmUoMSk7XG4gIH0pO1xufSk7XG5cblxuIl19