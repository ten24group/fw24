import { ObservabilityManager } from './manager';
import { SpanObserver } from './observers/span';
import { setupTestObservability, cleanupTestObservability, createTestContext, type MockBackend } from './testing';
import { withCurrentSpan } from '../core/runtime/execution-context/storage';

describe('flush-time graph hierarchy (no missing parents)', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = setupTestObservability({
      enabled: true,
      // Realistic defaults: skip empties, drop short spans via duration threshold.
      skipEmptySpans: true,
      minSpanDurationMs: 50,
    });

    // Enable buffering so flush-time graph logic is exercised.
    const cfg = ObservabilityManager.getConfig();
    if (!cfg) throw new Error('test config not initialized');
    ObservabilityManager.configure({
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
    cleanupTestObservability();
  });

  it('force-ends open parent spans at flush and does not emit invariant violation', async () => {
    await createTestContext(async () => {
      // Create a parent span and intentionally DO NOT end it (simulates async bug / forgotten end()).
      const parent = SpanObserver.start('parent');

      // Make it current and create a child span that references it as parentObservabilityLogId.
      await withCurrentSpan(parent, async () => {
        await SpanObserver.withSpan('child', async () => {
          // no-op
        });
      });

      // Flush should force-end the open parent span before enforcing hierarchy integrity.
      await ObservabilityManager.flush();
    }, { correlationId: 'corr-test-1' });

    // No invariant violation log should be emitted.
    const violations = backend.getEventsMatching({
      type: 'log',
      operation: 'observability.invariant_violation.missing_parent_span',
    });
    expect(violations.length).toBe(0);
  });
});


