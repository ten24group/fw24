/**
 * Intermediate State Validation Tests
 * 
 * These tests verify internal tree state during noise reduction phases.
 * They test what ACTUALLY happens, not just the final output.
 */

import type { ObservabilityEvent, NoiseReductionConfig } from '../../types';
import { ObservabilityLevel } from '../../types';
import {
  buildAndEvaluateTree,
  getNode,
  verifyTreeStructure,
  verifyHardSignalPropagation,
  findNodesByDecision,
  findHardSignalNodes,
  findNodesWithHardSignalInSubtree,
  countNodesByDecision,
  expectNodeDecision,
  expectNodeIsHardSignal,
  expectNodeHasHardSignalInSubtree,
} from '../testing';

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

describe('Intermediate State Validation', () => {
  describe('Phase 1: Tree Building', () => {
    it('should build valid tree structure', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 1000,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'child',
          parentObservabilityLogId: 'root',
          operation: 'child',
          durationMs: 500,
        },
      ];

      const { tree, roots } = buildAndEvaluateTree(events, baseConfig);

      // Should not throw
      expect(() => verifyTreeStructure(tree)).not.toThrow();

      // Should have 1 root
      expect(roots).toHaveLength(1);
      expect(roots[ 0 ].event.observabilityLogId).toBe('root');

      // Root should have 1 child
      const root = getNode(tree, 'root')!;
      expect(root.children).toHaveLength(1);
      expect(root.children[ 0 ].event.observabilityLogId).toBe('child');

      // Child should point to root
      const child = getNode(tree, 'child')!;
      expect(child.parent).toBe(root);
    });

    it('should handle multiple roots', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root1',
          operation: 'root1',
          durationMs: 1000,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'root2',
          operation: 'root2',
          durationMs: 500,
        },
      ];

      const { roots } = buildAndEvaluateTree(events, baseConfig);

      expect(roots).toHaveLength(2);
      expect(roots.map(r => r.event.observabilityLogId).sort()).toEqual([ 'root1', 'root2' ]);
    });
  });

  describe('Phase 2: Hard Signal Detection', () => {
    it('should correctly mark error events as hard signals', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'log',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'info',
          operation: 'info',
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error',
          operation: 'error',
        },
      ];

      const { tree } = buildAndEvaluateTree(events, baseConfig);

      expectNodeIsHardSignal(tree, 'info', false, baseConfig);
      expectNodeIsHardSignal(tree, 'error', true, baseConfig);
    });

    it('should mark failed operations as hard signals', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'success',
          operation: 'success',
          success: true,
          durationMs: 100,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'failure',
          operation: 'failure',
          success: false,
          durationMs: 100,
        },
      ];

      const { tree } = buildAndEvaluateTree(events, baseConfig);

      expectNodeIsHardSignal(tree, 'success', false, baseConfig);
      expectNodeIsHardSignal(tree, 'failure', true, baseConfig);
    });

    it('should mark slow operations as hard signals', () => {
      const config: NoiseReductionConfig = {
        ...baseConfig,
        hardSignals: {
          levels: [ 'error' ],
          slowThresholdMs: 1000,
        },
      };

      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'fast',
          operation: 'fast',
          durationMs: 500,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'slow',
          operation: 'slow',
          durationMs: 2000, // > 1000ms
        },
      ];

      const { tree } = buildAndEvaluateTree(events, config);

      expectNodeIsHardSignal(tree, 'fast', false, config);
      expectNodeIsHardSignal(tree, 'slow', true, config);
    });
  });

  describe('Phase 2: Decision Evaluation', () => {
    it('should assign correct decisions based on rules', () => {
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

      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'info',
          operation: 'info',
          durationMs: 100,
        },
        {
          type: 'log',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'debug',
          operation: 'debug',
        },
        {
          type: 'database.query',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'db',
          operation: 'SELECT',
          durationMs: 50,
        },
      ];

      const { tree } = buildAndEvaluateTree(events, config);

      expectNodeDecision(tree, 'info', 'keep'); // No rule, default keep
      expectNodeDecision(tree, 'debug', 'drop'); // drop-debug rule
      expectNodeDecision(tree, 'db', 'fold'); // fold-db rule
    });

    it('should protect hard signals from drop/fold/downgrade', () => {
      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'drop-all',
            match: {},
            decision: 'drop',
            reason: 'Drop all',
          },
        ],
      };

      const events: ObservabilityEvent[] = [
        {
          type: 'log',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'info',
          operation: 'info',
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error',
          operation: 'error',
        },
      ];

      const { tree } = buildAndEvaluateTree(events, config);

      // Info should be dropped
      expectNodeDecision(tree, 'info', 'drop');

      // Error should be protected (override to keep)
      expectNodeDecision(tree, 'error', 'keep');

      // Verify error is a hard signal
      expectNodeIsHardSignal(tree, 'error', true, config);
    });

    it('should allow aggregate for hard signals', () => {
      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'aggregate-errors',
            match: { level: 'error' },
            decision: 'aggregate',
            reason: 'Aggregate errors',
          },
        ],
      };

      const events: ObservabilityEvent[] = [
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'error',
          operation: 'error',
        },
      ];

      const { tree } = buildAndEvaluateTree(events, config);

      // Aggregate is allowed for hard signals (errors visible in stats)
      expectNodeDecision(tree, 'error', 'aggregate');
      expectNodeIsHardSignal(tree, 'error', true, config);
    });
  });

  describe('Phase 2.5: Hard Signal Propagation', () => {
    it('should propagate hasHardSignalInSubtree to ancestors', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 1000,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'mid',
          parentObservabilityLogId: 'root',
          operation: 'mid',
          durationMs: 500,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'mid',
          operation: 'error',
        },
      ];

      const { tree } = buildAndEvaluateTree(events, baseConfig);

      // Verify propagation worked
      expect(() => verifyHardSignalPropagation(tree, baseConfig)).not.toThrow();

      // Error itself
      expectNodeHasHardSignalInSubtree(tree, 'error', true);
      expectNodeIsHardSignal(tree, 'error', true, baseConfig);

      // Mid (parent)
      expectNodeHasHardSignalInSubtree(tree, 'mid', true);
      expectNodeIsHardSignal(tree, 'mid', false, baseConfig);

      // Root (grandparent)
      expectNodeHasHardSignalInSubtree(tree, 'root', true);
      expectNodeIsHardSignal(tree, 'root', false, baseConfig);
    });

    it('should NOT propagate hard signals across siblings', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 1000,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'child1',
          parentObservabilityLogId: 'root',
          operation: 'child1',
          durationMs: 500,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'child2',
          parentObservabilityLogId: 'root',
          operation: 'child2',
        },
      ];

      const { tree } = buildAndEvaluateTree(events, baseConfig);

      // Root should have flag (has error child)
      expectNodeHasHardSignalInSubtree(tree, 'root', true);

      // child1 should NOT have flag (sibling has error, not descendant)
      expectNodeHasHardSignalInSubtree(tree, 'child1', false);

      // child2 should have flag (is itself error)
      expectNodeHasHardSignalInSubtree(tree, 'child2', true);
      expectNodeIsHardSignal(tree, 'child2', true, baseConfig);
    });

    it('should handle multiple hard signals in same subtree', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 1000,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error1',
          parentObservabilityLogId: 'root',
          operation: 'error1',
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'error2',
          parentObservabilityLogId: 'root',
          operation: 'error2',
        },
      ];

      const { tree, nodes } = buildAndEvaluateTree(events, baseConfig);

      // Find all hard signals
      const hardSignals = findHardSignalNodes(nodes, baseConfig);
      expect(hardSignals).toHaveLength(2);
      expect(hardSignals.map(n => n.event.observabilityLogId).sort()).toEqual([ 'error1', 'error2' ]);

      // Root should have flag
      expectNodeHasHardSignalInSubtree(tree, 'root', true);

      // Both errors should have flag
      expectNodeHasHardSignalInSubtree(tree, 'error1', true);
      expectNodeHasHardSignalInSubtree(tree, 'error2', true);
    });
  });

  describe('Decision Counts', () => {
    it('should correctly count decisions', () => {
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
          {
            id: 'aggregate-items',
            match: { operation: 'process-item' },
            decision: 'aggregate',
            reason: 'Aggregate items',
          },
        ],
      };

      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'root',
          durationMs: 1000,
        },
        {
          type: 'log',
          level: 'debug',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'debug',
          parentObservabilityLogId: 'root',
          operation: 'debug',
        },
        {
          type: 'database.query',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'db',
          parentObservabilityLogId: 'root',
          operation: 'SELECT',
          durationMs: 50,
        },
        {
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1030,
          observabilityLogId: 'item',
          parentObservabilityLogId: 'root',
          operation: 'process-item',
          durationMs: 10,
        },
      ];

      const { nodes } = buildAndEvaluateTree(events, config);
      const counts = countNodesByDecision(nodes);

      expect(counts.keep).toBe(1); // root
      expect(counts.drop).toBe(1); // debug
      expect(counts.fold).toBe(1); // db
      expect(counts.aggregate).toBe(1); // item
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle context preservation detection', () => {
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

      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info', // Meets minLevel
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'root',
          operation: 'HTTP GET /api',
          durationMs: 200,
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

      const { tree } = buildAndEvaluateTree(events, config);

      // Root should be evaluated as DROP (Phase 2)
      expectNodeDecision(tree, 'root', 'drop');

      // But root should have hasHardSignalInSubtree (Phase 2.5)
      expectNodeHasHardSignalInSubtree(tree, 'root', true);

      // Phase 3 will upgrade root from DROP to KEEP (context preservation)
      // This test verifies the PRE-transform state that enables that decision
    });
  });
});
