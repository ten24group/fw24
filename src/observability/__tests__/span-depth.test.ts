/**
 * Tests for Feature 6: Span Depth Tracking
 *
 * Validates that SpanObserver computes depth from parent chain
 * and emits it as span.depth metric.
 */

import { SpanObserver } from '../observers/span';
import { ObservabilityManager } from '../manager';
import { createObservabilityConfig } from '../config';
import { MockBackend, createTestContext, cleanupTestObservability } from '../testing';
import { ObservabilityLevel } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════

function setupManager(): MockBackend {
  ObservabilityManager.reset();
  const mockBackend = new MockBackend({ minLevel: ObservabilityLevel.TRACE });
  const config = createObservabilityConfig({
    enabled: true,
    serviceName: 'depth-test',
    backends: [{ type: 'cloudwatch' }],
    noiseReduction: { enabled: false },
    spans: { skipEmpty: false, minDurationMs: 0 },
  });
  ObservabilityManager.initializeForTesting(config, [mockBackend]);
  return mockBackend;
}

afterEach(() => {
  cleanupTestObservability();
});

// ═══════════════════════════════════════════════════════════════════════════
// DEPTH TRACKING
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature 6: Span Depth Tracking', () => {
  test('root span has depth 0', async () => {
    setupManager();

    await createTestContext(async () => {
      const root = SpanObserver.start('root-operation');
      expect(root).toBeDefined();
      expect(root!.depth).toBe(0);
      root!.end();
    });
  });

  test('direct child span has depth 1', async () => {
    setupManager();

    await createTestContext(async () => {
      await SpanObserver.withSpan('parent-op', async (parent) => {
        expect(parent.depth).toBe(0);

        const child = SpanObserver.start('child-op');
        expect(child).toBeDefined();
        expect(child!.depth).toBe(1);
        child!.end();
      });
    });
  });

  test('grandchild span has depth 2', async () => {
    setupManager();

    await createTestContext(async () => {
      await SpanObserver.withSpan('root-op', async (root) => {
        expect(root.depth).toBe(0);

        await SpanObserver.withSpan('child-op', async (child) => {
          expect(child.depth).toBe(1);

          const grandchild = SpanObserver.start('grandchild-op');
          expect(grandchild).toBeDefined();
          expect(grandchild!.depth).toBe(2);
          grandchild!.end();
        });
      });
    });
  });

  test('sibling spans have the same depth', async () => {
    setupManager();

    await createTestContext(async () => {
      await SpanObserver.withSpan('parent', async (parent) => {
        expect(parent.depth).toBe(0);

        const child1 = SpanObserver.start('sibling-1');
        expect(child1!.depth).toBe(1);
        child1!.end();

        const child2 = SpanObserver.start('sibling-2');
        expect(child2!.depth).toBe(1);
        child2!.end();

        const child3 = SpanObserver.start('sibling-3');
        expect(child3!.depth).toBe(1);
        child3!.end();
      });
    });
  });

  test('span.depth metric is included in captured event metrics', async () => {
    const mockBackend = setupManager();

    await createTestContext(async () => {
      await SpanObserver.withSpan('test-op', async (span) => {
        expect(span.depth).toBe(0);
      });

      await ObservabilityManager.flush();
    });

    // The root span should have span.depth: 0 in its metrics
    const events = mockBackend.getEvents();
    const rootEvent = events.find(e => e.operation?.includes('test-op'));
    expect(rootEvent).toBeDefined();
    expect(rootEvent?.metrics?.['span.depth']).toBe(0);
  });

  test('child span.depth metric is 1 in captured event', async () => {
    const mockBackend = setupManager();

    await createTestContext(async () => {
      await SpanObserver.withSpan('parent-op', async () => {
        const child = SpanObserver.start('child-op');
        child!.end();
      });

      await ObservabilityManager.flush();
    });

    const events = mockBackend.getEvents();
    const childEvent = events.find(e => e.operation?.includes('child-op'));
    expect(childEvent).toBeDefined();
    expect(childEvent?.metrics?.['span.depth']).toBe(1);
  });
});
