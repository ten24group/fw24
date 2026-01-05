/**
 * Comprehensive Edge Case Tests
 * 
 * Tests for scenarios that might break the implementation:
 * - Empty inputs
 * - Single nodes
 * - Very deep trees
 * - Circular references (should be prevented by tree builder)
 * - All nodes dropped
 * - All nodes kept
 * - Mixed levels and decisions
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
  includeDebugMetadata: false,
  includeExamples: false,
};

describe('Edge Cases - Comprehensive', () => {
  describe('Empty and Minimal Inputs', () => {
    it('should handle empty input array', () => {
      const { events, stats } = applyNoiseReduction([], baseConfig);

      expect(events).toHaveLength(0);
      expect(stats.kept).toBe(0);
      expect(stats.dropped).toBe(0);
      expect(stats.folded).toBe(0);
    });

    it('should handle single event (root)', () => {
      const event: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'single',
        operation: 'test',
      };

      const { events, stats } = applyNoiseReduction([ event ], baseConfig);

      expect(events).toHaveLength(1);
      expect(stats.kept).toBe(1);
    });

    it('should handle single error event', () => {
      const event: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'error',
        operation: 'failed',
      };

      const { events } = applyNoiseReduction([ event ], baseConfig);

      expect(events).toHaveLength(1);
      expect(events[ 0 ].level).toBe('error');
    });
  });

  describe('Deep Tree Hierarchies', () => {
    it('should handle 10-level deep tree with error at bottom', () => {
      const events: ObservabilityEvent[] = [];

      // Create 10-level chain
      for (let i = 0; i < 10; i++) {
        events.push({
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000 + i * 10,
          observabilityLogId: `level-${i}`,
          parentObservabilityLogId: i === 0 ? undefined : `level-${i - 1}`,
          operation: `Op level ${i}`,
          durationMs: 100,
        });
      }

      // Add error at bottom
      events.push({
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'deep-error',
        parentObservabilityLogId: 'level-9',
        operation: 'Error at depth 10',
      });

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-spans',
            match: { type: 'span' },
            decision: 'drop',
            reason: 'Drop spans',
          },
        ],
      };

      const { events: output } = applyNoiseReduction(events, config);

      // All spans should be kept as context (or folded), error kept
      expect(output.length).toBeGreaterThan(0);
      expect(output.find(e => e.observabilityLogId === 'deep-error')).toBeDefined();
      expect(output.find(e => e.observabilityLogId === 'level-0')).toBeDefined();
    });

    it('should handle wide tree (100 siblings)', () => {
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'batch',
        durationMs: 1000,
      };

      const children: ObservabilityEvent[] = [];
      for (let i = 0; i < 100; i++) {
        children.push({
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000 + i,
          observabilityLogId: `child-${i}`,
          parentObservabilityLogId: 'root',
          operation: `Item ${i}`,
          durationMs: 10,
          success: true, // All successful by default
        });
      }

      // One child has error - this is a HARD SIGNAL
      children[ 50 ].level = 'error';
      children[ 50 ].success = false;

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'aggregate-items',
            match: { operation: '/^Item/', success: true },
            decision: 'aggregate',
            reason: 'Aggregate successful items',
          },
        ],
      };

      const { events: output, stats } = applyNoiseReduction([ root, ...children ], config);

      // Expected behavior:
      // - Root: no rule matches -> KEEP
      // - 99 children with success=true: aggregate rule matches -> AGGREGATE into root
      // - child-50 with error: HARD SIGNAL -> KEEP (protected from aggregation)

      expect(output).toHaveLength(2); // root + child-50
      expect(stats.kept).toBe(2); // root + child-50
      expect(stats.aggregated).toBe(99); // all successful children

      // Verify outputs are correct
      const rootOut = output.find(e => e.observabilityLogId === 'root');
      const errorOut = output.find(e => e.observabilityLogId === 'child-50');

      expect(rootOut).toBeDefined();
      expect(errorOut).toBeDefined();
      expect(errorOut!.level).toBe('error');
    });
  });

  describe('All Nodes Same Decision', () => {
    it('should handle all nodes dropped (no hard signals)', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'test',
          durationMs: 100,
        },
        {
          type: 'log',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'log1',
          parentObservabilityLogId: 'root',
          operation: 'debug log',
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.INFO, // Both are DEBUG < INFO
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop all',
          },
        ],
      };

      const { events: output, stats } = applyNoiseReduction(events, config);

      expect(output).toHaveLength(0);
      expect(stats.dropped).toBe(2);
    });

    it('should handle all nodes kept', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'test',
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'log1',
          parentObservabilityLogId: 'root',
          operation: 'error log',
        },
      ];

      const { events: output, stats } = applyNoiseReduction(events, baseConfig);

      expect(output).toHaveLength(2);
      expect(stats.kept).toBe(2);
    });
  });

  describe('Explicit Overrides', () => {
    it('should respect capture.noise override to drop hard signal', () => {
      const errorEvent: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'error',
        operation: 'ignorable error',
        capture: {
          noise: {
            decision: 'drop',
            reason: 'Known ignorable error',
          },
        },
      };

      const { events, stats } = applyNoiseReduction([ errorEvent ], baseConfig);

      // Error should be dropped due to explicit override
      expect(events).toHaveLength(0);
      expect(stats.dropped).toBe(1);
    });

    it('should respect capture.noise override to keep non-hard-signal', () => {
      const debugEvent: ObservabilityEvent = {
        type: 'log',
        level: 'debug',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'debug',
        operation: 'important debug',
        capture: {
          noise: {
            decision: 'keep',
            reason: 'Important for debugging',
          },
        },
      };

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-debug',
            match: { level: 'debug' },
            decision: 'drop',
            reason: 'Drop debug',
          },
        ],
      };

      const { events, stats } = applyNoiseReduction([ debugEvent ], config);

      // Debug should be kept due to explicit override
      expect(events).toHaveLength(1);
      expect(stats.kept).toBe(1);
    });
  });

  describe('MinLevel Threshold Edge Cases', () => {
    it('should respect minLevel=TRACE (keep everything)', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'trace',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'trace span',
          durationMs: 100,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'root',
          operation: 'error',
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.TRACE,
        rules: [
          {
            id: 'drop-trace',
            match: { level: 'trace' },
            decision: 'drop',
            reason: 'Drop trace',
          },
        ],
      };

      const { events: output } = applyNoiseReduction(events, config);

      // Trace should be upgraded to fold/keep (has error in subtree, meets minLevel=TRACE)
      expect(output.length).toBeGreaterThan(0);
      expect(output.find(e => e.observabilityLogId === 'error')).toBeDefined();
    });

    it('should respect minLevel=CRITICAL (only critical+ as context)', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'info span',
          durationMs: 100,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'root',
          operation: 'error',
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.CRITICAL,
        rules: [
          {
            id: 'drop-info',
            match: { level: 'info' },
            decision: 'drop',
            reason: 'Drop info',
          },
        ],
      };

      const { events: output } = applyNoiseReduction(events, config);

      // Root should be dropped (INFO < CRITICAL threshold)
      // Error orphaned and kept
      expect(output).toHaveLength(1);
      expect(output[ 0 ].observabilityLogId).toBe('error');
      expect(output[ 0 ].parentObservabilityLogId).toBeUndefined();
    });
  });

  describe('Reparenting Edge Cases', () => {
    it('should reparent multiple levels when middle nodes dropped', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 100,
        },
        {
          type: 'span',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'middle',
          parentObservabilityLogId: 'root',
          operation: 'middle',
          durationMs: 50,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'middle',
          operation: 'error',
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.INFO,
        rules: [
          {
            id: 'drop-debug',
            match: { level: 'debug' },
            decision: 'drop',
            reason: 'Drop debug',
          },
        ],
      };

      const { events: output } = applyNoiseReduction(events, config);

      // Middle should be dropped (DEBUG < INFO)
      // Error should be reparented to root
      expect(output).toHaveLength(2);
      const errorOut = output.find(e => e.observabilityLogId === 'error')!;
      expect(errorOut).toBeDefined();
      expect(errorOut.parentObservabilityLogId).toBe('root');
    });

    it('should handle multiple children of dropped parent', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 100,
        },
        {
          type: 'span',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'middle',
          parentObservabilityLogId: 'root',
          operation: 'middle',
          durationMs: 50,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'error1',
          parentObservabilityLogId: 'middle',
          operation: 'error 1',
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1030,
          observabilityLogId: 'error2',
          parentObservabilityLogId: 'middle',
          operation: 'error 2',
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        minLevel: ObservabilityLevel.INFO,
        rules: [
          {
            id: 'drop-debug',
            match: { level: 'debug' },
            decision: 'drop',
            reason: 'Drop debug',
          },
        ],
      };

      const { events: output } = applyNoiseReduction(events, config);

      // Both errors should be reparented to root
      expect(output).toHaveLength(3); // root + 2 errors
      const error1 = output.find(e => e.observabilityLogId === 'error1')!;
      const error2 = output.find(e => e.observabilityLogId === 'error2')!;
      expect(error1.parentObservabilityLogId).toBe('root');
      expect(error2.parentObservabilityLogId).toBe('root');
    });
  });

  describe('Stats Accuracy', () => {
    it('should accurately count all decisions', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 100,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'root',
          operation: 'error', // kept
        },
        {
          type: 'log',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'debug',
          parentObservabilityLogId: 'root',
          operation: 'debug', // dropped
        },
        {
          type: 'database.query',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1030,
          observabilityLogId: 'query',
          parentObservabilityLogId: 'root',
          operation: 'SELECT', // folded
          durationMs: 50,
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-debug',
            match: { level: 'debug' },
            decision: 'drop',
            reason: 'Drop debug',
          },
          {
            id: 'fold-db',
            match: { type: 'database.query' },
            decision: 'fold',
            reason: 'Fold queries',
          },
        ],
      };

      const { stats } = applyNoiseReduction(events, config);

      // Root kept (no rule matched), error kept (hard signal), debug dropped, query folded
      expect(stats.kept).toBe(2); // root + error
      expect(stats.dropped).toBe(1); // debug
      expect(stats.folded).toBe(1); // query
      expect(stats.aggregated).toBe(0);
      expect(stats.downgraded).toBe(0);
    });
  });
});
