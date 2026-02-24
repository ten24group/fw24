import { ObservabilityManager } from '../../manager';
import { createObservabilityConfig } from '../../config';
import { createExecutionContext, runWithExecutionContext } from '../../context';
import { ObservabilityLevel } from '../../types';
import { CloudWatchBackend } from '../../backends/cloudwatch';
import { calcProgressInterval, Tracker } from './tracker';

// CloudWatch backend uses Powertools Logger which outputs JSON to console
const cloudwatchBackend = new (CloudWatchBackend as any)(
  'tracker-test',        // serviceName
  'TrackerTests',        // namespace
  ObservabilityLevel.DEBUG
);

// Initialize observability with CloudWatch backend
ObservabilityManager.initializeForTesting(
  createObservabilityConfig({ enabled: true }),
  [ cloudwatchBackend ]
);

describe('Tracker', () => {
  const ctx = createExecutionContext({ correlationId: 'test' });
  const run = <T>(fn: () => Promise<T>) => runWithExecutionContext(ctx, fn);

  // ═══════════════════════════════════════════════════════════════════════════
  // Core Tracking
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Recording', () => {
    it('should track success/failure/skipped counts and include batchId', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 5 });

      tracker.recordSuccess(10, 'item-1');
      tracker.recordSuccess(20, 'item-2');
      tracker.recordFailure(15, new Error('Failed'), 'item-3');
      tracker.recordSkipped();
      tracker.recordSuccess(25, 'item-5');

      const summary = tracker.complete();

      expect(summary.succeeded).toBe(3);
      expect(summary.failed).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.total).toBe(5);
      expect(summary.batchId).toMatch(/^Test-\d+$/);
      expect(summary.name).toBe('Test');
    }));

    it('should track failed item details', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 2, observe: 'none' });

      tracker.recordFailure(10, new Error('First error'), 'id-1');
      tracker.recordFailure(20, new TypeError('Type error'), 'id-2');

      const summary = tracker.complete();

      expect(summary.failedItems).toEqual([
        { itemId: 'id-1', error: 'First error', errorType: 'Error' },
        { itemId: 'id-2', error: 'Type error', errorType: 'TypeError' },
      ]);
      expect(summary.errorsByType).toEqual({ Error: 1, TypeError: 1 });
    }));

    it('should return failed count', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 5, observe: 'none' });

      tracker.recordSuccess(10);
      tracker.recordFailure(10, new Error('E1'), 'id-1');
      tracker.recordFailure(10, new Error('E2'), 'id-2');

      expect(tracker.getFailedCount()).toBe(2);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Timing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Timing', () => {
    it('should calculate timing stats', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 4, observe: 'none' });

      tracker.recordSuccess(10);
      tracker.recordSuccess(20);
      tracker.recordSuccess(30);
      tracker.recordSuccess(40);

      const summary = tracker.complete();

      expect(summary.timing.avgMs).toBe(25);
      expect(summary.timing.minMs).toBe(10);
      expect(summary.timing.maxMs).toBe(40);
    }));

    it('should track slowest item ID', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 3, observe: 'none' });

      tracker.recordSuccess(10, 'fast');
      tracker.recordSuccess(100, 'slowest');
      tracker.recordSuccess(50, 'medium');

      const summary = tracker.complete();

      expect(summary.timing.slowestItemId).toBe('slowest');
    }));

    it('should calculate p95 for 20+ items', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 25, observe: 'none' });

      for (let i = 1; i <= 25; i++) {
        tracker.recordSuccess(i);
      }

      const summary = tracker.complete();

      expect(summary.timing.p95Ms).toBeDefined();
      expect(summary.timing.p95Ms).toBeGreaterThanOrEqual(23);
      expect(summary.timing.p99Ms).toBeUndefined(); // Not enough items for p99
    }));

    it('should calculate p99 for 100+ items', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 100, observe: 'none' });

      for (let i = 1; i <= 100; i++) {
        tracker.recordSuccess(i);
      }

      const summary = tracker.complete();

      expect(summary.timing.p95Ms).toBeDefined();
      expect(summary.timing.p99Ms).toBeDefined();
      expect(summary.timing.p99Ms).toBeGreaterThanOrEqual(99);
    }));

    it('should calculate items per second', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 2, observe: 'none' });

      await new Promise(r => setTimeout(r, 60));
      tracker.recordSuccess(10);
      tracker.recordSuccess(10);

      const summary = tracker.complete();

      expect(summary.durationMs).toBeGreaterThanOrEqual(50);
      expect(summary.itemsPerSecond).toBeGreaterThan(0);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metrics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Metrics', () => {
    it('should aggregate metrics', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 3, observe: 'none' });

      tracker.addMetric('bytes', 100);
      tracker.recordSuccess(10);

      tracker.addMetric('bytes', 200);
      tracker.recordSuccess(10);

      tracker.addMetric('bytes', 150);
      tracker.recordSuccess(10);

      const summary = tracker.complete();

      expect(summary.metrics.bytes).toEqual({
        sum: 450,
        min: 100,
        max: 200,
        avg: 150,
        count: 3,
      });
    }));

    it('should accumulate metrics within same item', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 1, observe: 'none' });

      tracker.addMetric('bytes', 50);
      tracker.addMetric('bytes', 50);
      tracker.addMetric('bytes', 100);
      tracker.recordSuccess(10);

      const summary = tracker.complete();

      expect(summary.metrics.bytes.sum).toBe(200);
      expect(summary.metrics.bytes.count).toBe(1);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Context & Capture Control
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Context', () => {
    it('should create context with correct values', () => run(async () => {
      const tracker = new Tracker({ name: 'Test', total: 10, observe: 'none' });

      const ctx = tracker.createContext(5);

      expect(ctx.itemIndex).toBe(5);
      expect(ctx.total).toBe(10);
      expect(ctx.batchId).toMatch(/^Test-\d+$/);
      expect(typeof ctx.getCaptureControl).toBe('function');
      expect(typeof ctx.addMetric).toBe('function');
    }));

    it('should provide capture control regardless of observe mode', () => run(async () => {
      const tracker = new Tracker({
        name: 'Test',
        total: 10,
        observe: 'progress',  // NOT 'all'
        sampleFirst: 5,
        sampleRate: 0.2,
      });

      tracker.recordSuccess(10);
      tracker.recordSuccess(10);

      const control = tracker.getCaptureControl();

      // Should still have group config (decoupled from observe mode)
      expect(control.group).toMatchObject({
        key: expect.stringContaining('Test-'),
        index: 2,
        total: 10,
        captureFirst: 5,
        sampleRate: 0.2,
      });
    }));

    it('should provide batchId via getBatchId()', () => run(async () => {
      const tracker = new Tracker({ name: 'MyBatch', total: 5, observe: 'none' });

      expect(tracker.getBatchId()).toMatch(/^MyBatch-\d+$/);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Logging Behavior (observe modes)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Observe modes', () => {
    it('observe=progress: logs at intervals + summary', () => run(async () => {
      console.log('\n--- observe=progress (100 items, every 25) ---');

      const tracker = new Tracker({
        name: 'ProgressTest',
        total: 100,
        observe: 'progress',
        progressEvery: 25,
      });

      for (let i = 0; i < 100; i++) {
        tracker.recordSuccess(10);
      }

      tracker.complete();
    }));

    it('observe=errors: logs errors + summary', () => run(async () => {
      console.log('\n--- observe=errors ---');

      const tracker = new Tracker({
        name: 'ErrorsOnly',
        total: 5,
        observe: 'errors',
      });

      tracker.recordSuccess(10, 'item-1');
      tracker.recordFailure(10, new Error('This should log'), 'item-2');
      tracker.recordSuccess(10, 'item-3');
      tracker.recordFailure(10, new Error('This too'), 'item-4');
      tracker.recordSuccess(10, 'item-5');

      tracker.complete();
    }));

    it('observe=summary: logs only summary', () => run(async () => {
      console.log('\n--- observe=summary ---');

      const tracker = new Tracker({
        name: 'SummaryOnly',
        total: 10,
        observe: 'summary',
      });

      for (let i = 0; i < 10; i++) {
        tracker.recordSuccess(10);
      }

      tracker.complete();
    }));

    it('observe=none: no logs', () => run(async () => {
      console.log('\n--- observe=none (no log output) ---');

      const tracker = new Tracker({
        name: 'Silent',
        total: 10,
        observe: 'none',
      });

      for (let i = 0; i < 5; i++) {
        tracker.recordSuccess(10);
        tracker.recordFailure(10, new Error('Silent'), `id-${i}`);
      }

      tracker.complete();
    }));

    it('should include tags in logs', () => run(async () => {
      console.log('\n--- with tags ---');

      const tracker = new Tracker({
        name: 'Tagged',
        total: 3,
        observe: 'progress',
        tags: { entity: 'User', operation: 'sync' },
      });

      tracker.recordSuccess(10);
      tracker.recordSuccess(10);
      tracker.recordSuccess(10);

      tracker.complete();
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// calcProgressInterval
// ═══════════════════════════════════════════════════════════════════════════

describe('calcProgressInterval', () => {
  it('should return smart intervals based on total', () => {
    expect(calcProgressInterval(5)).toBe(0);
    expect(calcProgressInterval(10)).toBe(0);
    expect(calcProgressInterval(50)).toBe(10);
    expect(calcProgressInterval(100)).toBe(25);
    expect(calcProgressInterval(500)).toBe(50);
    expect(calcProgressInterval(1000)).toBe(100);
    expect(calcProgressInterval(5000)).toBe(500);
  });

  it('should respect custom interval', () => {
    expect(calcProgressInterval(1000, 42)).toBe(42);
    expect(calcProgressInterval(100, 0)).toBe(0);
  });
});
