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
    cleanupTestObservability();
  });

  it('preserves events referencing missing parent (cross-batch linking)', async () => {
    // v2 design: events referencing parents not in the current batch are preserved
    // with their original parentObservabilityLogId intact (for cross-batch/cross-invocation linking).
    // The noise reduction algorithm treats these as root nodes in the batch.
    await createTestContext(async () => {
      ObservabilityManager.capture({
        type: 'log',
        level: 'info',
        operation: 'child',
        parentObservabilityLogId: 'missing-parent',
        correlationId: 'c1',
      });

      await ObservabilityManager.flush();
    });

    // Child event should be emitted (parent may be from another invocation)
    const keptChild = backend.getEventsMatching({ type: 'log', operation: 'child' });
    expect(keptChild.length).toBe(1);

    // parentObservabilityLogId should be preserved for cross-batch linking
    expect(keptChild[0].parentObservabilityLogId).toBe('missing-parent');
  });
});
