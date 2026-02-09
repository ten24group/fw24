import { ObservabilityManager } from './manager';
import { SpanObserver } from './observers/span';
import { captureRecord } from './observers/base';
import { setupTestObservability, cleanupTestObservability, createTestContext, type MockBackend } from './testing';

function assertNoMissingParentRefs(backend: MockBackend): void {
  const events = backend.getEvents();
  const spans = events.filter((e) => e.type === 'span');
  const spanIds = new Set(spans.map((s) => s.observabilityLogId));

  const broken = events
    .filter((e) => !!e.parentObservabilityLogId)
    .filter((e) => !spanIds.has(e.parentObservabilityLogId!))
    .slice(0, 10)
    .map((e) => ({
      type: e.type,
      operation: e.operation,
      parent: e.parentObservabilityLogId,
      id: e.observabilityLogId,
    }));

  expect(broken).toEqual([]);

  const violations = events.filter((e) =>
    e.type === 'log'
    && (
      e.operation === 'observability.invariant_violation.missing_parent_span'
      || e.operation === 'observability.invariant_violation.cross_slice_parent_span'
    )
  );
  expect(violations).toEqual([]);
}

describe('Observability buffer eviction (bounded memory, no orphan parents)', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = setupTestObservability({ enabled: true });

    // Force buffering + eviction: tiny buffer, smart sampling on, capture everything.
    ObservabilityManager.configure({
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
      },
    });
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  it('evicts under high volume without persisting broken parentObservabilityLogId references (log-heavy)', async () => {
    await createTestContext(async () => {
      await SpanObserver.withSpan('root', async () => {
        // Many child logs under a single parent: should trigger evictions.
        for (let i = 0; i < 250; i++) {
          captureRecord('test', {
            type: 'log',
            level: 'info',
            operation: `child.log.${i}`,
            data: { i },
          });
        }

        // Add some nested spans with children to create a small hierarchy.
        await SpanObserver.withSpan('childSpan', async () => {
          for (let i = 0; i < 50; i++) {
            captureRecord('test', {
              type: 'log',
              level: 'info',
              operation: `childSpan.log.${i}`,
            });
          }
        });
      });

      await ObservabilityManager.flush();
    }, { correlationId: 'evict-log-heavy' });

    assertNoMissingParentRefs(backend);
  });

  it('evicts under spans-only pressure without persisting broken parent references (span-heavy)', async () => {
    await createTestContext(async () => {
      await SpanObserver.withSpan('root', async () => {
        // Create many nested spans (no logs). With minDurationMs=0 + skipEmpty=false they will be captured.
        for (let i = 0; i < 120; i++) {
          // eslint-disable-next-line no-await-in-loop
          await SpanObserver.withSpan(`span.${i}`, async () => { /* no-op */ });
        }
      });

      await ObservabilityManager.flush();
    }, { correlationId: 'evict-span-heavy' });

    assertNoMissingParentRefs(backend);
  });
});

