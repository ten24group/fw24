/**
 * Hard Signal Algorithm Tests
 * 
 * Tests for the enhanced noise reduction algorithm with hard signal detection,
 * propagation, and context preservation per NOISE-REDUCTION-FINAL-SPEC.md
 */

import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import type { ObservabilityEvent, NoiseReductionConfig } from '../../types';
import { ObservabilityLevel } from '../../types';

describe('Hard Signal Algorithm', () => {
  const baseConfig = createObservabilityConfig({
    enabled: true,
    minLevel: ObservabilityLevel.INFO,
    noiseReduction: {
      enabled: true,
      minLevel: ObservabilityLevel.INFO,
      hardSignals: {
        levels: [ 'error', 'critical' ],
        includeWarn: false,
        slowThresholdMs: 5000,
        slowThresholds: {
          'database.query': 100,
        },
      },
      presets: [],
      rules: [],
      emitSummaries: false,
      maxCheckpointsPerSpan: 500,
      maxAggregateKeysPerSpan: 200,
      maxAggregateExamplesPerKey: 5,
      maxAggregateErrorExamplesPerKey: 3,
      includeDebugMetadata: true,
      includeExamples: false,
    },
  }).noiseReduction;

  describe('Phase 2: Hard Signal Protection', () => {
    it('should protect error events from being dropped', () => {
      const errorEvent: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'error-1',
        operation: 'test',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop everything',
          },
        ],
      };

      const { events } = applyNoiseReduction([ errorEvent ], config);

      // Error should be kept despite drop rule
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('error-1');
    });

    it('should protect failed operations from being dropped', () => {
      const failedEvent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'failed-1',
        operation: 'test',
        success: false,
        durationMs: 100,
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop everything',
          },
        ],
      };

      const { events } = applyNoiseReduction([ failedEvent ], config);

      // Failed operation should be kept
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('failed-1');
    });

    it('should protect slow operations from being dropped', () => {
      const slowEvent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'slow-1',
        operation: 'test',
        durationMs: 6000, // > 5000ms default threshold
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop everything',
          },
        ],
      };

      const { events } = applyNoiseReduction([ slowEvent ], config);

      // Slow operation should be kept
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('slow-1');
    });

    it('should allow aggregating hard signals when explicitly configured', () => {
      // Hard signals are protected and KEPT by default
      // Aggregate rules on hard signals are overridden to KEEP
      const parent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'parent',
        operation: 'batch',
        durationMs: 1000,
      };

      const errors: ObservabilityEvent[] = Array.from({ length: 10 }).map((_, i) => ({
        type: 'span',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1000 + i * 10,
        observabilityLogId: `error-${i}`,
        parentObservabilityLogId: 'parent',
        operation: 'process-item',
        durationMs: 10,
      }));

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'aggregate-errors',
            match: { level: 'error' },
            decision: 'aggregate',
            reason: 'Try to aggregate errors',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ parent, ...errors ], config);

      // Hard signals CAN be aggregated per spec (when explicitly configured)
      expect(stats.aggregated).toBe(10);
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('parent');

      const aggregates = (events[ 0 ].data as any)?.noiseReduction?.aggregates;
      expect(aggregates).toBeDefined();
      expect(Object.values(aggregates || {}).some((bucket: any) => bucket.errorCount === 10)).toBe(true);
    });
  });

  describe('Phase 2.5: Hard Signal Propagation', () => {
    it('should propagate hard signal flag to ancestors', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'HTTP GET /api',
        durationMs: 500,
        success: true,
      };

      const child: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'child',
        parentObservabilityLogId: 'root',
        operation: 'service.call',
        durationMs: 100,
        success: true,
      };

      const error: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1200,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'child',
        operation: 'payment',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-get',
            match: { operation: '/^HTTP GET/' },
            decision: 'drop',
            reason: 'Drop successful GETs',
          },
          {
            id: 'drop-service',
            match: { operation: 'service.call' },
            decision: 'drop',
            reason: 'Drop service calls',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, child, error ], config);

      // Root should be KEPT (upgraded from DROP, is root with hard signal in subtree)
      // Child should be FOLDED (upgraded from DROP, has parent and hard signal in subtree)
      // Error should be KEPT (hard signal)
      expect(events).toHaveLength(2);
      expect(events.some(e => e.observabilityLogId === 'root')).toBe(true);
      expect(events.some(e => e.observabilityLogId === 'error')).toBe(true);
      expect(stats.folded).toBe(1); // child folded
      expect(stats.kept).toBe(2); // root + error
    });

    it('should NOT propagate hard signal across siblings', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 1000,
      };

      const child1: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'child1',
        parentObservabilityLogId: 'root',
        operation: 'safe-op',
        durationMs: 100,
        success: true,
      };

      const child2: ObservabilityEvent = {
        type: 'span',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1200,
        observabilityLogId: 'child2',
        parentObservabilityLogId: 'root',
        operation: 'failed-op',
        durationMs: 100,
        success: false,
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-safe',
            match: { operation: 'safe-op' },
            decision: 'drop',
            reason: 'Drop safe operations',
          },
        ],
      };

      const { events } = applyNoiseReduction([ root, child1, child2 ], config);

      // child1 should be DROPPED (no hard signal in its own subtree)
      // child2 should be KEPT (error)
      // root should be KEPT (has hard signal in subtree)
      expect(events).toHaveLength(2);
      expect(events.some(e => e.observabilityLogId === 'root')).toBe(true);
      expect(events.some(e => e.observabilityLogId === 'child2')).toBe(true);
      expect(events.some(e => e.observabilityLogId === 'child1')).toBe(false);
    });
  });

  describe('Phase 3: Context-Aware DROP Logic', () => {
    it('should upgrade DROP to KEEP for root with hard signal in subtree (Phase 2)', () => {
      // This tests Phase 3 context preservation, NOT Phase 2 protection
      // Root is NOT a hard signal itself, but has error child
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'HTTP GET /api',
        durationMs: 200,
        // NO error property - root is NOT a hard signal itself
      };

      const errorChild: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'root',
        operation: 'payment failed',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-get',
            match: { operation: '/^HTTP GET/' },
            decision: 'drop',
            reason: 'Drop GETs',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, errorChild ], config);

      // Expected: Phase 2 evaluates root as DROP (not a hard signal)
      // Phase 2.5 sets hasHardSignalInSubtree=true on root (has error child)
      // Phase 3 upgrades root from DROP to KEEP (root + hasHardSignalInSubtree + minLevel met)
      expect(events).toHaveLength(2); // root + error
      expect(events.find(e => e.observabilityLogId === 'root')).toBeDefined();
      expect(events.find(e => e.observabilityLogId === 'error')).toBeDefined();
      expect(stats.kept).toBe(2);
      expect(stats.dropped).toBe(0);
    });

    it('should upgrade DROP to FOLD for non-root with hard signal', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 1000,
      };

      const child: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'child',
        parentObservabilityLogId: 'root',
        operation: 'droppable',
        durationMs: 100,
      };

      const error: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1200,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'child',
        operation: 'payment',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-child',
            match: { operation: 'droppable' },
            decision: 'drop',
            reason: 'Drop noise',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, child, error ], config);

      // child should be FOLDED (upgraded from DROP due to error descendant)
      // error should be KEPT and reparented to root
      expect(stats.folded).toBe(1);
      expect(events).toHaveLength(2);
      expect(events.some(e => e.observabilityLogId === 'root')).toBe(true);
      expect(events.some(e => e.observabilityLogId === 'error')).toBe(true);

      const errorEvent = events.find(e => e.observabilityLogId === 'error')!;
      expect(errorEvent.parentObservabilityLogId).toBe('root');
    });

    it('should respect minLevel threshold for context preservation', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'debug', // Below INFO minLevel
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'debug-span',
        durationMs: 100,
      };

      const error: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'root',
        operation: 'payment',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.INFO, // Context threshold
        rules: [
          {
            id: 'drop-debug',
            match: { level: 'debug' },
            decision: 'drop',
            reason: 'Drop debug logs',
          },
        ],
      };

      const { events } = applyNoiseReduction([ root, error ], config);

      // root has DEBUG level < INFO minLevel, so dropped despite error child
      // error is kept and reparented to become root
      expect(events).toHaveLength(1);
      const errorEvent = events.find(e => e.observabilityLogId === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.parentObservabilityLogId).toBeUndefined();
    });

    it('should drop completely when no hard signal and no kept children', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'HTTP GET /api',
        durationMs: 200,
        success: true,
      };

      const child: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'child',
        parentObservabilityLogId: 'root',
        operation: 'db.query',
        durationMs: 50,
        success: true,
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-get',
            match: { operation: '/^HTTP GET/' },
            decision: 'drop',
            reason: 'Drop successful GETs',
          },
          {
            id: 'drop-query',
            match: { operation: 'db.query' },
            decision: 'drop',
            reason: 'Drop fast queries',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, child ], config);

      // Everything should be dropped (no hard signals)
      expect(events).toHaveLength(0);
      expect(stats.dropped).toBe(2);
    });
  });

  describe('Per-Type Slow Thresholds', () => {
    it('should use per-type threshold for database queries', () => {
      const dbQuery: ObservabilityEvent = {
        type: 'database.query',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'query-1',
        operation: 'SELECT * FROM users',
        durationMs: 150, // > 100ms threshold for database.query
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop everything',
          },
        ],
      };

      const { events } = applyNoiseReduction([ dbQuery ], config);

      // Should be kept (slow for database.query)
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('query-1');
    });

    it('should use global threshold when no per-type threshold defined', () => {
      const genericOp: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'op-1',
        operation: 'process',
        durationMs: 6000, // > 5000ms global threshold
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop everything',
          },
        ],
      };

      const { events } = applyNoiseReduction([ genericOp ], config);

      // Should be kept (slow globally)
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('op-1');
    });
  });

  describe('Reparenting', () => {
    it('should reparent error when parent dropped below minLevel', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'debug', // Below INFO threshold
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'droppable',
        durationMs: 100,
      };

      const child: ObservabilityEvent = {
        type: 'span',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'child',
        parentObservabilityLogId: 'root',
        operation: 'important',
        durationMs: 50,
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.INFO, // Root DEBUG < INFO, so dropped
        rules: [
          {
            id: 'drop-root',
            match: { operation: 'droppable' },
            decision: 'drop',
            reason: 'Drop noise',
          },
        ],
      };

      const { events } = applyNoiseReduction([ root, child ], config);

      // Root dropped (DEBUG < INFO minLevel)
      // Child kept (error = hard signal) and reparented to root
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('child');
      expect(events[ 0 ].parentObservabilityLogId).toBeUndefined();
    });
  });
});
