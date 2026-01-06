import { ObservabilityManager } from './manager';
import { setupTestObservability, cleanupTestObservability, createTestContext, type MockBackend } from './testing';

describe('Hierarchy integrity enforcement', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = setupTestObservability({
      enabled: true,
    });

    // Enable buffering so events go through flush-time enforcement.
    ObservabilityManager.configure({
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
    cleanupTestObservability();
  });

  it('drops events that reference missing parentObservabilityLogId and emits a single invariant violation log', async () => {
    await createTestContext(async () => {
      // Buffer an event that references a missing parent span id.
      ObservabilityManager.capture({
        type: 'log',
        level: 'info',
        operation: 'child',
        parentObservabilityLogId: 'missing-parent',
        correlationId: 'c1',
      });

      await ObservabilityManager.flush();
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


