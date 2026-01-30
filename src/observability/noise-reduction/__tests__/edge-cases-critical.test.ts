/**
 * Critical Edge Cases - Tests for scenarios that could break the algorithm
 * 
 * These tests verify behavior that is specified but not currently tested.
 */

import { applyNoiseReduction } from '../index';
import type { ObservabilityEvent, NoiseReductionConfig } from '../../types';
import { ObservabilityLevel } from '../../types';

const baseConfig: NoiseReductionConfig = {
  enabled: true,
  minLevel: ObservabilityLevel.INFO,
  hardSignals: {
    levels: [ 'error', 'critical' ],
    slowThresholdMs: 5000,
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
};

describe('Critical Edge Cases', () => {
  describe('Multiple Hard Signals in Same Subtree', () => {
    it('should keep all hard signals and preserve parent as context', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch process',
        durationMs: 1000,
      };

      const error1: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'error1',
        parentObservabilityLogId: 'root',
        operation: 'first failure',
      };

      const error2: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1020,
        observabilityLogId: 'error2',
        parentObservabilityLogId: 'root',
        operation: 'second failure',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-batch',
            match: { operation: 'batch process' },
            decision: 'drop',
            reason: 'Drop batch spans',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, error1, error2 ], config);

      // All should be kept
      expect(events).toHaveLength(3);
      expect(events.find(e => e.observabilityLogId === 'root')).toBeDefined();
      expect(events.find(e => e.observabilityLogId === 'error1')).toBeDefined();
      expect(events.find(e => e.observabilityLogId === 'error2')).toBeDefined();
      expect(stats.kept).toBe(3);
    });

    it('should handle hard signals at different depths', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'root',
        durationMs: 1000,
      };

      const mid: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'mid',
        parentObservabilityLogId: 'root',
        operation: 'middle',
        durationMs: 500,
      };

      const error1: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1020,
        observabilityLogId: 'error1',
        parentObservabilityLogId: 'mid',
        operation: 'deep error',
      };

      const error2: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1030,
        observabilityLogId: 'error2',
        parentObservabilityLogId: 'root',
        operation: 'shallow error',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop all non-errors',
          },
        ],
      };

      const { events } = applyNoiseReduction([ root, mid, error1, error2 ], config);

      // Root kept as context, mid folded (non-root with DROP + hasHardSignal = FOLD)
      // Both errors kept
      expect(events).toHaveLength(3);
      expect(events.find(e => e.observabilityLogId === 'root')).toBeDefined();
      expect(events.find(e => e.observabilityLogId === 'mid')).toBeUndefined(); // Folded
      expect(events.find(e => e.observabilityLogId === 'error1')).toBeDefined();
      expect(events.find(e => e.observabilityLogId === 'error2')).toBeDefined();

      // error1 should be reparented to root (mid was folded)
      const error1Out = events.find(e => e.observabilityLogId === 'error1')!;
      expect(error1Out.parentObservabilityLogId).toBe('root');
    });
  });

  describe('Fold Rule Matching Hard Signal', () => {
    it('should protect hard signal from being folded', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 1000,
      };

      const errorWithFoldRule: ObservabilityEvent = {
        type: 'database.query',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'error-query',
        parentObservabilityLogId: 'root',
        operation: 'SELECT * FROM users',
        durationMs: 50,
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'fold-db',
            match: { type: 'database.query' },
            decision: 'fold',
            reason: 'Fold all DB queries',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, errorWithFoldRule ], config);

      // Error should NOT be folded (hard signal protection in Phase 2)
      expect(events).toHaveLength(2);
      expect(events.find(e => e.observabilityLogId === 'error-query')).toBeDefined();
      expect(stats.folded).toBe(0);
      expect(stats.kept).toBe(2);
    });

    it('should protect failed operation from fold rule', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 1000,
      };

      const failedWithFoldRule: ObservabilityEvent = {
        type: 'api.call',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'failed-api',
        parentObservabilityLogId: 'root',
        operation: 'POST /payment',
        success: false, // Hard signal
        durationMs: 200,
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'fold-api',
            match: { type: 'api.call' },
            decision: 'fold',
            reason: 'Fold API calls',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, failedWithFoldRule ], config);

      // Failed API call should NOT be folded
      expect(events).toHaveLength(2);
      expect(events.find(e => e.observabilityLogId === 'failed-api')).toBeDefined();
      expect(stats.folded).toBe(0);
      expect(stats.kept).toBe(2);
    });
  });

  describe('Context Preservation at Different Levels', () => {
    it('should keep only ancestors meeting minLevel threshold', () => {
      const trace: ObservabilityEvent = {
        type: 'span',
        level: 'trace', // Below INFO
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'trace',
        operation: 'trace',
        durationMs: 1000,
      };

      const debug: ObservabilityEvent = {
        type: 'span',
        level: 'debug', // Below INFO
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'debug',
        parentObservabilityLogId: 'trace',
        operation: 'debug',
        durationMs: 500,
      };

      const info: ObservabilityEvent = {
        type: 'span',
        level: 'info', // Meets INFO threshold
        correlationId: 'test',
        timestampMs: 1020,
        observabilityLogId: 'info',
        parentObservabilityLogId: 'debug',
        operation: 'info',
        durationMs: 200,
      };

      const error: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1030,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'info',
        operation: 'error',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.INFO,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop all',
          },
        ],
      };

      const { events } = applyNoiseReduction([ trace, debug, info, error ], config);

      // All ancestors below INFO minLevel, so all dropped
      // Only error kept (hard signal), becomes orphaned root
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('error');
      expect(events[ 0 ].parentObservabilityLogId).toBeUndefined(); // Orphaned
    });

    it('should preserve all ancestors when minLevel is TRACE', () => {
      const trace: ObservabilityEvent = {
        type: 'span',
        level: 'trace',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'trace',
        operation: 'trace',
        durationMs: 1000,
      };

      const debug: ObservabilityEvent = {
        type: 'span',
        level: 'debug',
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'debug',
        parentObservabilityLogId: 'trace',
        operation: 'debug',
        durationMs: 500,
      };

      const error: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1020,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'debug',
        operation: 'error',
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.TRACE,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop all',
          },
        ],
      };

      const { events } = applyNoiseReduction([ trace, debug, error ], config);

      // Trace kept as root context, debug folded (non-root with DROP + hasHardSignal = FOLD)
      // Error kept
      expect(events).toHaveLength(2);
      expect(events.find(e => e.observabilityLogId === 'trace')).toBeDefined();
      expect(events.find(e => e.observabilityLogId === 'debug')).toBeUndefined(); // Folded
      expect(events.find(e => e.observabilityLogId === 'error')).toBeDefined();

      // Error reparented to trace
      const errorOut = events.find(e => e.observabilityLogId === 'error')!;
      expect(errorOut.parentObservabilityLogId).toBe('trace');
    });
  });

  describe('Explicit Override on Hard Signal', () => {
    it('should allow dropping hard signal with explicit override', () => {
      const errorWithOverride: ObservabilityEvent = {
        type: 'log',
        level: 'error', // Hard signal
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'error',
        operation: 'known ignorable error',
        capture: {
          noise: {
            decision: 'drop',
            reason: 'User explicitly wants to ignore this error',
          },
        },
      };

      const { events, stats } = applyNoiseReduction([ errorWithOverride ], baseConfig);

      // Error should be dropped despite being a hard signal
      expect(events).toHaveLength(0);
      expect(stats.dropped).toBe(1);
    });

    it('should allow folding hard signal with explicit override', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 1000,
      };

      const errorWithOverride: ObservabilityEvent = {
        type: 'log',
        level: 'error', // Hard signal
        correlationId: 'test',
        timestampMs: 1010,
        observabilityLogId: 'error',
        parentObservabilityLogId: 'root',
        operation: 'non-critical error',
        capture: {
          noise: {
            decision: 'fold',
            reason: 'User wants this error folded into parent',
          },
        },
      };

      const { events, stats } = applyNoiseReduction([ root, errorWithOverride ], baseConfig);

      // Error should be folded despite being a hard signal
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('root');
      expect(stats.folded).toBe(1);
      expect(stats.kept).toBe(1);
    });
  });

  describe('Aggregation with Mixed Hard Signals', () => {
    it('should aggregate hard signals separately from non-hard signals', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 5000,
      };

      const items: ObservabilityEvent[] = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          type: 'span',
          level: i === 5 ? 'error' : 'info', // Item 5 is error
          correlationId: 'test',
          timestampMs: 1000 + i * 10,
          observabilityLogId: `item-${i}`,
          parentObservabilityLogId: 'root',
          operation: 'process-item',
          success: i !== 5, // Item 5 failed
          durationMs: 10,
        });
      }

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'aggregate-items',
            match: { operation: 'process-item' },
            decision: 'aggregate',
            reason: 'Aggregate items',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ root, ...items ], config);

      // Per spec: aggregate is ALLOWED for hard signals (errors visible in stats)
      // All 10 items aggregated into root
      expect(events).toHaveLength(1);
      expect(events[ 0 ].observabilityLogId).toBe('root');
      expect(stats.aggregated).toBe(10);
      expect(stats.kept).toBe(1);

      // Verify aggregate data present
      const rootOut = events[ 0 ] as any;
      expect(rootOut.data?.noiseReduction?.aggregated).toBe(10);
    });
  });
});
