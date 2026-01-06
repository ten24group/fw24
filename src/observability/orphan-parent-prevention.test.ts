import { SpanObserver } from './observers/span';
import { captureRecord } from './observers/base';
import { setupTestObservability, cleanupTestObservability, createTestContext, type MockBackend } from './testing';

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
  let backend: MockBackend;

  beforeEach(() => {
    // Enable aggressive filtering to reproduce the bug:
    // - skipEmpty=true
    // - minDuration huge (would normally filter out fast spans)
    backend = setupTestObservability({
      enabled: true,
      skipEmptySpans: true,
      minSpanDurationMs: 999999,
    });
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  it('does not drop parent span when its id is used as parentObservabilityLogId', async () => {
    await createTestContext(async () => {
      await SpanObserver.withSpan(
        'parent',
        async () => {
          // Capture a child log while the parent span is current.
          // This will resolve parentObservabilityLogId via getCurrentParentObservabilityLogId()
          // and register a parent reference so the parent span is not filtered out.
          captureRecord('test', {
            type: 'log',
            level: 'info',
            operation: 'child',
          });
        },
        // Do NOT add any other content to the parent span. If child marking works,
        // the span should still be captured despite skipEmpty+minDuration.
      );
    });

    const spans = backend.getEventsMatching({ type: 'span', operation: 'parent' });
    expect(spans.length).toBe(1);
  });
});


