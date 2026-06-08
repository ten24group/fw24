/**
 * Tests for hierarchy preservation and span.start filtering bugs
 * 
 * These tests reproduce the exact issues seen in production:
 * 1. span.start events reaching DynamoDB (should be OTEL only)
 * 2. Parent spans being filtered while children are captured
 * 3. Broken parent references in the resulting logs
 */

import {
  MockBackend,
  setupTestObservability,
  createTestContext,
  cleanupTestObservability,
} from './testing';
import { SpanObserver, withSpan } from './observers/span';
import { ObservabilityManager } from './manager';
import { ObservabilityLevel } from './types';

describe('Hierarchy Preservation Bugs', () => {
  let mockBackend: MockBackend;

  beforeEach(() => {
    mockBackend = setupTestObservability({
      minLevel: ObservabilityLevel.TRACE,
      // These are the problematic defaults that cause hierarchy issues
      minSpanDurationMs: 50,
      skipEmptySpans: true,
    });
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  describe('span.start DynamoDB filtering', () => {
    it('should NOT include span.start events in non-OTEL backends', async () => {
      await createTestContext(async () => {
        await withSpan('testOperation', async (span) => {
          span.checkpoint('doing_work');
          await new Promise(resolve => setTimeout(resolve, 60)); // Longer than minDurationMs
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      const spanStartEvents = events.filter(e => e.type === 'span.start');
      const spanEvents = events.filter(e => e.type === 'span');

      // span.start should NOT reach MockBackend (simulating DynamoDB)
      // They should be filtered by capture.backends = ['otel']
      expect(spanStartEvents.length).toBe(0);
      expect(spanEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should verify span.start has backends filter set to otel only', async () => {
      await createTestContext(async () => {
        await withSpan('filterTest', async (span) => {
          span.tag('test', 'value');
        });

        await ObservabilityManager.flush();
      });

      const events = mockBackend.getEvents();
      const spanStartEvents = events.filter(e => e.type === 'span.start');

      // If any span.start events reached the backend, check their capture.backends
      for (const event of spanStartEvents) {
        // This should fail if span.start events reach non-OTEL backends
        expect(event.capture?.backends).toEqual([ 'otel' ]);
      }
    });
  });

  describe('Parent span hierarchy preservation', () => {
    it('should capture parent spans even if children take longer', async () => {
      await createTestContext(async () => {
        // Parent span is fast (0ms work)
        // But it has children that do actual work
        await withSpan('fastParent', async () => {
          // Multiple child operations (simulating Promise.allSettled)
          await Promise.all([
            withSpan('child1', async (child) => {
              child.tag('childId', '1');
              await new Promise(resolve => setTimeout(resolve, 60));
            }),
            withSpan('child2', async (child) => {
              child.tag('childId', '2');
              await new Promise(resolve => setTimeout(resolve, 60));
            }),
          ]);
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const operations = spans.map(s => s.operation);

      // Children should be captured (they have content and duration)
      expect(operations).toContain('child1');
      expect(operations).toContain('child2');

      // Parent MUST be captured because it has captured children
      // This is the critical test - parent must exist for hierarchy!
      expect(operations).toContain('fastParent');

      // Verify hierarchy is intact
      const parent = spans.find(s => s.operation === 'fastParent');
      const child1 = spans.find(s => s.operation === 'child1');
      const child2 = spans.find(s => s.operation === 'child2');

      expect(parent).toBeDefined();
      expect(child1).toBeDefined();
      expect(child2).toBeDefined();

      // Children should reference the parent
      expect(child1!.parentObservabilityLogId).toBe(parent!.observabilityLogId);
      expect(child2!.parentObservabilityLogId).toBe(parent!.observabilityLogId);
    });

    it('should capture all parent spans in deeply nested async hierarchy', async () => {
      await createTestContext(async () => {
        // Simulate the real-world case:
        // workflow -> persistence -> upsert
        await withSpan('workflow', async () => {
          await withSpan('persistence', async () => {
            // Multiple upserts in parallel
            await Promise.all([
              withSpan('upsert1', async (span) => {
                span.setData({ entityName: 'standing' });
                await new Promise(resolve => setTimeout(resolve, 60));
              }),
              withSpan('upsert2', async (span) => {
                span.setData({ entityName: 'standing' });
                await new Promise(resolve => setTimeout(resolve, 60));
              }),
            ]);
          });
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const operations = spans.map(s => s.operation);

      // All levels should be captured
      expect(operations).toContain('workflow');
      expect(operations).toContain('persistence');
      expect(operations).toContain('upsert1');
      expect(operations).toContain('upsert2');

      // Build ID map
      const idMap = new Map(spans.map(s => [ s.observabilityLogId, s.operation ]));

      // Verify all parent references exist
      const orphans: string[] = [];
      spans.forEach(span => {
        if (span.parentObservabilityLogId && !idMap.has(span.parentObservabilityLogId)) {
          orphans.push(`${span.operation} -> missing parent ${span.parentObservabilityLogId}`);
        }
      });

      expect(orphans.length).toBe(0);

      // Verify correct hierarchy
      const workflow = spans.find(s => s.operation === 'workflow');
      const persistence = spans.find(s => s.operation === 'persistence');
      const upsert1 = spans.find(s => s.operation === 'upsert1');
      const upsert2 = spans.find(s => s.operation === 'upsert2');

      expect(persistence!.parentObservabilityLogId).toBe(workflow!.observabilityLogId);
      expect(upsert1!.parentObservabilityLogId).toBe(persistence!.observabilityLogId);
      expect(upsert2!.parentObservabilityLogId).toBe(persistence!.observabilityLogId);

      // Root span should NOT have itself as parent
      // This is a critical check - a span pointing to itself is a bug
      expect(workflow!.parentObservabilityLogId).not.toBe(workflow!.observabilityLogId);
    });

    it('should NOT have parent pointing to non-existent span after filtering', async () => {
      // This tests the exact scenario from production logs
      // where upsert spans have parent f73a8cbd7a0f1b2d that doesn't exist
      await createTestContext(async () => {
        await withSpan('outerWrapper', async () => {
          await withSpan('innerWrapper', async () => {
            await Promise.all(
              Array.from({ length: 5 }, (_, i) =>
                withSpan(`operation${i}`, async (span) => {
                  span.tag('index', String(i));
                  await new Promise(resolve => setTimeout(resolve, 60));
                })
              )
            );
          });
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });
      const allIds = new Set(spans.map(s => s.observabilityLogId));

      // Check for broken parent references
      const brokenRefs: Array<{ span: string; missingParent: string }> = [];
      spans.forEach(span => {
        if (span.parentObservabilityLogId && !allIds.has(span.parentObservabilityLogId)) {
          brokenRefs.push({
            span: span.operation ?? 'unknown',
            missingParent: span.parentObservabilityLogId,
          });
        }
      });

      expect(brokenRefs.length).toBe(0);
    });
  });

  describe('AsyncLocalStorage context propagation', () => {
    it('should maintain parent context across Promise.all', async () => {
      await createTestContext(async () => {
        await withSpan('parentSpan', async () => {
          // This is how persistence service calls upserts
          await Promise.all([
            (async () => {
              const span = SpanObserver.getCurrentSpan();
              expect(span?.operation).toBe('parentSpan');
              await withSpan('asyncChild1', async (child) => {
                child.tag('test', 'child1');
                await new Promise(resolve => setTimeout(resolve, 60)); // > minDurationMs
              });
            })(),
            (async () => {
              const span = SpanObserver.getCurrentSpan();
              expect(span?.operation).toBe('parentSpan');
              await withSpan('asyncChild2', async (child) => {
                child.tag('test', 'child2');
                await new Promise(resolve => setTimeout(resolve, 60)); // > minDurationMs
              });
            })(),
          ]);
        });

        await ObservabilityManager.flush();
      });

      const spans = mockBackend.getEventsMatching({ type: 'span' });

      const parent = spans.find(s => s.operation === 'parentSpan');
      const child1 = spans.find(s => s.operation === 'asyncChild1');
      const child2 = spans.find(s => s.operation === 'asyncChild2');

      expect(parent).toBeDefined();
      expect(child1).toBeDefined();
      expect(child2).toBeDefined();

      // Children should have parent as their parent
      expect(child1!.parentObservabilityLogId).toBe(parent!.observabilityLogId);
      expect(child2!.parentObservabilityLogId).toBe(parent!.observabilityLogId);
    });
  });
});

