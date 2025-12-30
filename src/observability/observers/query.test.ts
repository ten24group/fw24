import { QueryObserver } from './query';
import { createObservabilityConfig } from '../config';
import { ObservabilityLevel, CaptureInput } from '../types';
import { setCurrentObservabilityConfig } from '../runtime-state';
import { setCapturer, resetCapturer } from './base';
import { createExecutionContext, runWithExecutionContext } from '../../core/runtime/execution-context';

describe('QueryObserver', () => {
  let capturedEvents: CaptureInput[] = [];

  beforeEach(() => {
    // Reset captured events
    capturedEvents = [];

    // Mock the capture system
    setCapturer({
      capture: (input: CaptureInput) => {
        capturedEvents.push(input);
        return input.observabilityLogId || 'test-id';
      },
      captureAsync: async (input: CaptureInput) => {
        capturedEvents.push(input);
        return input.observabilityLogId || 'test-id';
      }
    });

    // Initialize with specific thresholds for testing
    const config = createObservabilityConfig({
      enabled: true,
      minLevel: ObservabilityLevel.DEBUG,
      queryPerformance: {
        enabled: true,
        slowThreshold: 100, // 100ms
        captureSlowQueryDetails: true,
        // Clear default operation thresholds so global slowThreshold applies
        operationThresholds: []
      }
    });

    // Set config directly in runtime state
    setCurrentObservabilityConfig(config);
  });

  afterEach(() => {
    setCurrentObservabilityConfig(null);
    resetCapturer();
    jest.restoreAllMocks();
  });

  it('should track fast queries and execute the function', async () => {
    await runWithExecutionContext(createExecutionContext({
      correlationId: 'test-correlation-id',
    }), async () => {
      const fn = jest.fn().mockResolvedValue({ data: { id: '1' } });
      const result = await QueryObserver.track('User', 'get', fn);

      expect((result as any).data.id).toBe('1');
      expect(fn).toHaveBeenCalled();

      // Check that event was emitted
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[ 0 ]).toMatchObject({
        type: 'database.query',
        level: 'debug',
        operation: 'User.get',
        entityName: 'User',
        success: true,
        tags: {
          entityName: 'User',
          operation: 'get'
        }
      });
    });
  });

  it('should identify and emit warn level for slow queries', async () => {
    await runWithExecutionContext({
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      observability: {} as any
    }, async () => {
      await QueryObserver.track('User', 'list', async () => {
        await new Promise(resolve => setTimeout(resolve, 150)); // Force slow query (> 100ms)
        return { data: [ { id: '1' }, { id: '2' } ] };
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[ 0 ]).toMatchObject({
        type: 'database.query',
        level: 'warn',
        operation: 'User.list',
        entityName: 'User',
        success: true,
        tags: {
          entityName: 'User',
          operation: 'list',
          slowQuery: 'true'
        },
        metrics: {
          itemCount: 2
        }
      });
      expect(capturedEvents[ 0 ].durationMs).toBeGreaterThan(100);
    });
  });

  it('should identify and emit warn level for scan operations', async () => {
    await runWithExecutionContext({
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      observability: {} as any
    }, async () => {
      await QueryObserver.track('User', 'scan', async () => {
        return { data: [ { id: '1' } ] };
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[ 0 ]).toMatchObject({
        type: 'database.query',
        level: 'warn',
        operation: 'User.scan',
        entityName: 'User',
        success: true,
        tags: {
          entityName: 'User',
          operation: 'scan',
          scan: 'true'
        }
      });
    });
  });

  it('should extract item counts from various ElectroDB formats', async () => {
    await runWithExecutionContext({
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      observability: {} as any
    }, async () => {
      // List/Array format
      await QueryObserver.track('User', 'query', async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return { data: [ {}, {}, {} ] };
      });
      expect(capturedEvents[ capturedEvents.length - 1 ].metrics?.itemCount).toBe(3);

      // Single item format
      await QueryObserver.track('User', 'get', async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return { data: { id: '1' } };
      });
      expect(capturedEvents[ capturedEvents.length - 1 ].metrics?.itemCount).toBe(1);

      // Empty result
      await QueryObserver.track('User', 'get', async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return { data: null };
      });
      expect(capturedEvents[ capturedEvents.length - 1 ].metrics?.itemCount).toBe(0);
    });
  });

  it('should handle and emit error events', async () => {
    await runWithExecutionContext({
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      observability: {} as any
    }, async () => {
      const error = new Error('DynamoDB Connection Timeout');

      const promise = QueryObserver.track('User', 'get', async () => {
        throw error;
      });

      await expect(promise).rejects.toThrow('DynamoDB Connection Timeout');

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[ 0 ]).toMatchObject({
        type: 'database.query',
        level: 'error',
        operation: 'User.get',
        entityName: 'User',
        success: false,
        error: {
          type: 'Error',
          message: 'DynamoDB Connection Timeout'
        },
        tags: {
          entityName: 'User',
          operation: 'get',
          error: 'true'
        }
      });
    });
  });

  it('should respect per-entity threshold overrides', async () => {
    // Override threshold for 'LargeEntity' to be very high
    const config = createObservabilityConfig({
      enabled: true,
      queryPerformance: {
        enabled: true,
        slowThreshold: 100,
        entityOverrides: [
          { entityName: 'LargeEntity', slowThreshold: 500 }
        ]
      }
    });
    setCurrentObservabilityConfig(config);

    // Reset captured events for this test
    capturedEvents = [];

    await runWithExecutionContext({
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      observability: {} as any
    }, async () => {
      // This query (200ms) is slower than default (100ms) but faster than override (500ms)
      await QueryObserver.track('LargeEntity', 'list', async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { data: [] };
      });

      // Should be debug level, not warn (200ms < 500ms threshold)
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[ 0 ].level).toBe('debug');
      expect(capturedEvents[ 0 ].tags?.slowQuery).toBeUndefined();
    });
  });

  it('should emit events for fast queries that noise reduction can fold into checkpoints', async () => {
    await runWithExecutionContext({
      correlationId: 'test-correlation-id',
      startTime: Date.now(),
      observability: {} as any
    }, async () => {
      await QueryObserver.track('User', 'get', async () => {
        return { data: { id: '1' } };
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[ 0 ]).toMatchObject({
        type: 'database.query',
        level: 'debug',
        operation: 'User.get',
        entityName: 'User',
        success: true
      });
      // Noise reduction will decide whether to fold this into a checkpoint,
      // aggregate it, or keep it as a standalone log
    });
  });
});
