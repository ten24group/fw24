import { BatchProgress } from './batch-progress';
import { ObservabilityManager } from '../../manager';
import { createObservabilityConfig } from '../../config';
import { createExecutionContext, runWithExecutionContext } from '../../context';
import { ObservabilityLevel } from '../../types';
import { CloudWatchBackend } from '../../backends/cloudwatch';

// CloudWatch backend uses Powertools Logger which outputs JSON to console
const cloudwatchBackend = new (CloudWatchBackend as any)(
  'batch-progress-test',  // serviceName
  'BatchProgressTests',   // namespace
  ObservabilityLevel.DEBUG
);

// Initialize observability with CloudWatch backend
ObservabilityManager.initializeForTesting(
  createObservabilityConfig({ enabled: true }),
  [ cloudwatchBackend ]
);

describe('BatchProgress', () => {
  const ctx = createExecutionContext({ correlationId: 'test' });
  const run = <T>(fn: () => Promise<T>) => {
    return runWithExecutionContext(ctx, fn);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Core Processing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('process()', () => {
    it('should process items sequentially and return results', () => run(async () => {
      const { results, summary } = await BatchProgress.process(
        'Sequential',
        [ 1, 2, 3 ],
        async (item) => item * 2
      );

      expect(results).toEqual([ 2, 4, 6 ]);
      expect(summary.succeeded).toBe(3);
      expect(summary.failed).toBe(0);
    }));

    it('should continue on errors by default', () => run(async () => {
      const { results, summary } = await BatchProgress.process(
        'ContinueOnError',
        [ 1, 2, 3, 4 ],
        async (item) => {
          if (item === 2) throw new Error('Item 2 failed');
          return item;
        }
      );

      expect(results).toEqual([ 1, 3, 4 ]);
      expect(summary.succeeded).toBe(3);
      expect(summary.failed).toBe(1);
      expect(summary.failedItems[ 0 ].itemId).toBe('2');
    }));

    it('should stop on error with continueOnError=false', () => run(async () => {
      await expect(
        BatchProgress.process(
          'StopOnError',
          [ 1, 2, 3 ],
          async (item) => {
            if (item === 2) throw new Error('Stop');
            return item;
          },
          { continueOnError: false }
        )
      ).rejects.toThrow('Stop');
    }));

    it('should process concurrently', () => run(async () => {
      const startTimes: number[] = [];

      await BatchProgress.process(
        'Concurrent',
        [ 1, 2, 3, 4 ],
        async () => {
          startTimes.push(Date.now());
          await new Promise(r => setTimeout(r, 30));
        },
        { concurrency: 2 }
      );

      expect(startTimes[ 1 ] - startTimes[ 0 ]).toBeLessThan(10);
      expect(startTimes[ 2 ] - startTimes[ 0 ]).toBeGreaterThanOrEqual(25);
    }));

    it('should stop after maxFailures', () => run(async () => {
      let processed = 0;

      const { summary } = await BatchProgress.process(
        'MaxFailures',
        [ 1, 2, 3, 4, 5, 6, 7, 8 ],
        async (item) => {
          processed++;
          if (item % 2 === 0) throw new Error('Even');
          return item;
        },
        { maxFailures: 2 }
      );

      expect(summary.failed).toBe(2);
      expect(processed).toBeLessThan(8);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Chunk Processing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('chunk()', () => {
    it('should split items into chunks', () => run(async () => {
      const chunks: number[][] = [];

      const { summary } = await BatchProgress.chunk(
        'Chunked',
        [ 1, 2, 3, 4, 5, 6, 7 ],
        async (chunk) => {
          chunks.push([ ...chunk ]);
          return chunk;
        },
        { size: 3 }
      );

      expect(chunks).toEqual([ [ 1, 2, 3 ], [ 4, 5, 6 ], [ 7 ] ]);
      expect(summary.succeeded).toBe(7);
    }));

    it('should mark all chunk items as failed on chunk error', () => run(async () => {
      let chunkNum = 0;

      const { summary } = await BatchProgress.chunk(
        'ChunkError',
        [ 1, 2, 3, 4, 5, 6 ],
        async (chunk) => {
          chunkNum++;
          if (chunkNum === 2) throw new Error('Chunk 2 failed');
          return chunk;
        },
        { size: 2 }
      );

      expect(summary.succeeded).toBe(4);
      expect(summary.failed).toBe(2);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Batch Processing (all at once)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('all()', () => {
    it('should process all items at once', () => run(async () => {
      let received: number[] = [];

      const { results, summary } = await BatchProgress.all(
        'AllAtOnce',
        [ 1, 2, 3 ],
        async (items) => {
          received = items;
          return items.map(x => x * 10);
        }
      );

      expect(received).toEqual([ 1, 2, 3 ]);
      expect(results).toEqual([ 10, 20, 30 ]);
      expect(summary.succeeded).toBe(3);
    }));

    it('should mark all items failed on error', () => run(async () => {
      const { summary } = await BatchProgress.all(
        'AllFailed',
        [ 1, 2, 3, 4, 5 ],
        async () => {
          throw new Error('Batch failed');
        }
      );

      expect(summary.failed).toBe(5);
      expect(summary.failedItems).toHaveLength(5);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Convenience Methods
  // ═══════════════════════════════════════════════════════════════════════════

  describe('forEach()', () => {
    it('should process without collecting results', () => run(async () => {
      const processed: number[] = [];

      const summary = await BatchProgress.forEach(
        'ForEach',
        [ 1, 2, 3 ],
        async (item) => { processed.push(item); }
      );

      expect(processed).toEqual([ 1, 2, 3 ]);
      expect(summary.succeeded).toBe(3);
    }));
  });

  describe('map()', () => {
    it('should transform items and fail fast', () => run(async () => {
      const results = await BatchProgress.map(
        'Map',
        [ 1, 2, 3 ],
        async (item) => `item-${item}`
      );

      expect(results).toEqual([ 'item-1', 'item-2', 'item-3' ]);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Item ID Detection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Item ID detection', () => {
    it('should auto-detect id field', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'AutoId',
        [ { id: 'a' }, { id: 'b' }, { id: 'c' } ],
        async (item) => {
          if (item.id === 'b') throw new Error('Failed');
          return item;
        }
      );

      expect(summary.failedItems[ 0 ].itemId).toBe('b');
    }));

    it('should auto-detect eventId field', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'EventId',
        [ { eventId: 'evt-1' }, { eventId: 'evt-2' } ],
        async (item) => {
          if (item.eventId === 'evt-2') throw new Error('Failed');
          return item;
        }
      );

      expect(summary.failedItems[ 0 ].itemId).toBe('evt-2');
    }));

    it('should use string items as IDs directly', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'StringIds',
        [ 'alpha', 'beta', 'gamma' ],
        async (item) => {
          if (item === 'beta') throw new Error('Failed');
          return item;
        }
      );

      expect(summary.failedItems[ 0 ].itemId).toBe('beta');
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metrics & Context
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Custom metrics', () => {
    it('should aggregate metrics across items', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'Metrics',
        [ { size: 100 }, { size: 200 }, { size: 150 } ],
        async (item, ctx) => {
          ctx.addMetric('bytes', item.size);
          ctx.addMetric('count', 1);
          return item;
        }
      );

      expect(summary.metrics.bytes.sum).toBe(450);
      expect(summary.metrics.bytes.min).toBe(100);
      expect(summary.metrics.bytes.max).toBe(200);
      expect(summary.metrics.count.sum).toBe(3);
    }));
  });

  describe('Context', () => {
    it('should provide itemIndex, total, and batchId', () => run(async () => {
      const contexts: { itemIndex: number; total: number; batchId: string }[] = [];

      await BatchProgress.process(
        'Context',
        [ 'a', 'b', 'c' ],
        async (_, ctx) => {
          contexts.push({ itemIndex: ctx.itemIndex, total: ctx.total, batchId: ctx.batchId });
        }
      );

      expect(contexts[ 0 ].itemIndex).toBe(0);
      expect(contexts[ 1 ].itemIndex).toBe(1);
      expect(contexts[ 2 ].itemIndex).toBe(2);
      expect(contexts[ 0 ].total).toBe(3);
      expect(contexts[ 0 ].batchId).toMatch(/^Context-\d+$/);
      // All contexts share same batchId
      expect(contexts[ 0 ].batchId).toBe(contexts[ 1 ].batchId);
    }));

    it('should provide capture control regardless of observe mode', () => run(async () => {
      let controlProgress: any;
      let controlErrors: any;

      // With observe='progress' (NOT 'all')
      await BatchProgress.process(
        'CaptureControl1',
        [ 1, 2, 3 ],
        async (item, ctx) => {
          if (item === 2) controlProgress = ctx.getCaptureControl();
          return item;
        },
        { observe: 'progress' }
      );

      // With observe='errors'
      await BatchProgress.process(
        'CaptureControl2',
        [ 1, 2, 3 ],
        async (item, ctx) => {
          if (item === 2) controlErrors = ctx.getCaptureControl();
          return item;
        },
        { observe: 'errors' }
      );

      // Both should have group config (decoupled from observe mode)
      expect(controlProgress.group).toBeDefined();
      expect(controlProgress.group.index).toBe(1);
      expect(controlErrors.group).toBeDefined();
      expect(controlErrors.group.index).toBe(1);
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Timing & Summary
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Timing', () => {
    it('should track timing statistics', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'Timing',
        Array.from({ length: 25 }, (_, i) => i),
        async (i) => {
          await new Promise(r => setTimeout(r, (i % 3) + 1));
          return i;
        }
      );

      expect(summary.timing.avgMs).toBeGreaterThan(0);
      expect(summary.timing.minMs).toBeLessThanOrEqual(summary.timing.maxMs);
      expect(summary.timing.p95Ms).toBeDefined();
      expect(summary.durationMs).toBeGreaterThan(0);
      expect(summary.itemsPerSecond).toBeGreaterThan(0);
    }));

    it('should track slowest item', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'SlowestItem',
        [ { id: 'fast', delay: 5 }, { id: 'slow', delay: 50 }, { id: 'med', delay: 20 } ],
        async (item) => {
          await new Promise(r => setTimeout(r, item.delay));
          return item;
        }
      );

      expect(summary.timing.slowestItemId).toBe('slow');
    }));
  });

  describe('Error tracking', () => {
    it('should track error types', () => run(async () => {
      class CustomError extends Error {
        constructor(msg: string) { super(msg); this.name = 'CustomError'; }
      }

      const { summary } = await BatchProgress.process(
        'ErrorTypes',
        [ 1, 2, 3, 4, 5 ],
        async (item) => {
          if (item === 2) throw new CustomError('Custom');
          if (item === 4) throw new TypeError('Type');
          return item;
        }
      );

      expect(summary.errorsByType).toEqual({ CustomError: 1, TypeError: 1 });
    }));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge cases', () => {
    it('should handle empty array', () => run(async () => {
      const { results, summary } = await BatchProgress.process(
        'Empty',
        [],
        async (item) => item
      );

      expect(results).toEqual([]);
      expect(summary.total).toBe(0);
    }));

    it('should handle single item', () => run(async () => {
      const { results } = await BatchProgress.process(
        'Single',
        [ 42 ],
        async (item) => item * 2
      );

      expect(results).toEqual([ 84 ]);
    }));

    it('should handle non-Error throws', () => run(async () => {
      const { summary } = await BatchProgress.process(
        'NonError',
        [ 1 ],
        async () => { throw 'string error'; }
      );

      expect(summary.failedItems[ 0 ].error).toBe('string error');
    }));
  });
});
