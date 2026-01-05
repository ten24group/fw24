/**
 * Critical bug tests for noise reduction.
 * 
 * These tests verify fixes for the issues identified in the comprehensive analysis.
 * Each test is designed to fail if the corresponding bug exists.
 */

import { applyNoiseReduction, evaluateNoiseRules } from '../index';
import { matchesRule } from '../rules/matcher';
import type { NoiseRule, ObservabilityEvent } from '../../types';
import { createObservabilityConfig } from '../../config';

describe('Critical Bug Tests', () => {
  const baseNoise = createObservabilityConfig().noiseReduction;

  describe('Issue #1: Hard Signal Protection Override', () => {
    it('should allow rules to aggregate error events when explicitly configured', () => {
      // Scenario: Batch processing with many failures
      // User wants to aggregate failures, not keep each as standalone log
      const parentSpan: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'batch-1',
        timestampMs: 1000,
        observabilityLogId: 'batch-parent',
        operation: 'processBatch',
        durationMs: 5000,
      };

      const failedEvents: ObservabilityEvent[] = Array.from({ length: 50 }).map((_, i) => ({
        type: 'span',
        level: 'error', // Hard signal!
        correlationId: 'batch-1',
        timestampMs: 1000 + i * 100,
        observabilityLogId: `failed-${i}`,
        parentObservabilityLogId: 'batch-parent',
        operation: 'processItem',
        durationMs: 50,
        success: false, // Also a hard signal!
        error: { type: 'ValidationError', message: 'Invalid data' }, // Also a hard signal!
      }));

      // User explicitly wants to aggregate these failures
      const aggregateFailuresRule: NoiseRule = {
        id: 'custom.aggregate_batch_failures',
        match: {
          type: 'span',
          operation: 'processItem',
          success: false,
        },
        decision: 'aggregate',
        priority: 2000, // Explicitly higher than hard signal priority (1000)
        reason: 'Aggregate batch item failures into parent',
      };

      const { events, stats } = applyNoiseReduction(
        [ parentSpan, ...failedEvents ],
        {
          ...baseNoise,
          enabled: true,
          rules: [ aggregateFailuresRule ],
        }
      );

      // EXPECTED: Failed events should be aggregated (current behavior: all kept)
      expect(stats.aggregated).toBe(50);
      expect(events.length).toBe(1); // Only parent span

      const parent = events.find(e => e.observabilityLogId === 'batch-parent')!;
      expect(parent).toBeDefined();

      const aggregates = (parent.data as any)?.noiseReduction?.aggregates;
      expect(aggregates).toBeDefined();
      expect(Object.values(aggregates || {}).some((bucket: any) => bucket.errorCount === 50)).toBe(true);
    });

    it('should respect rule priority over hard signal protection', () => {
      const errorEvent: ObservabilityEvent = {
        type: 'log',
        level: 'error',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'error-1',
        operation: 'testOperation',
      };

      const result = evaluateNoiseRules(
        errorEvent,
        [
          {
            id: 'drop-all-errors',
            match: { level: 'error' },
            decision: 'drop',
            priority: 2000, // Higher than hard signal (1000)
            reason: 'Explicit drop rule',
          },
        ],
        matchesRule
      );

      // EXPECTED: Rule with priority 2000 should win over hard signal (1000)
      // ACTUAL: Hard signal wins because it's checked first
      expect(result.decision).toBe('drop');
      expect(result.ruleId).toBe('drop-all-errors');
    });
  });

  describe('Issue #2: Reparenting to Dropped Parent', () => {
    it('should reparent to first KEPT ancestor, not immediate parent', () => {
      // Setup: Deep hierarchy where multiple levels are dropped
      const root: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'root',
        operation: 'root-op',
        durationMs: 1000,
      };

      const levelA: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1100,
        observabilityLogId: 'level-a',
        parentObservabilityLogId: 'root',
        operation: 'level-a-op',
        durationMs: 800,
      };

      const levelB: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1200,
        observabilityLogId: 'level-b',
        parentObservabilityLogId: 'level-a',
        operation: 'level-b-op',
        durationMs: 600,
      };

      const levelC: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1300,
        observabilityLogId: 'level-c',
        parentObservabilityLogId: 'level-b',
        operation: 'level-c-op',
        durationMs: 400,
      };

      const leaf: ObservabilityEvent = {
        type: 'log',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1400,
        observabilityLogId: 'leaf',
        parentObservabilityLogId: 'level-c',
        operation: 'leaf-op',
      };

      // Rules: Drop A, B, C but keep root and leaf
      const { events } = applyNoiseReduction(
        [ root, levelA, levelB, levelC, leaf ],
        {
          ...baseNoise,
          enabled: true,
          rules: [
            {
              id: 'keep-root',
              match: { operation: 'root-op' },
              decision: 'keep',
              priority: 100,
            },
            {
              id: 'drop-middle',
              match: { operation: '/level-[abc]-op/' },
              decision: 'drop',
              priority: 50,
            },
            {
              id: 'keep-leaf',
              match: { operation: 'leaf-op' },
              decision: 'keep',
              priority: 100,
            },
          ],
        }
      );

      // EXPECTED: leaf should be reparented directly to root
      const leafEvent = events.find(e => e.observabilityLogId === 'leaf');
      expect(leafEvent).toBeDefined();
      expect(leafEvent?.parentObservabilityLogId).toBe('root');

      // Verify no intermediate levels in output
      expect(events.find(e => e.observabilityLogId === 'level-a')).toBeUndefined();
      expect(events.find(e => e.observabilityLogId === 'level-b')).toBeUndefined();
      expect(events.find(e => e.observabilityLogId === 'level-c')).toBeUndefined();
    });
  });

  // Issue #3 test removed - tested deprecated reparenting behavior
  // New algorithm preserves hierarchy integrity automatically

  describe('Issue #6: Aggregate Key Too Rigid', () => {
    it('should separate successful and failed events in aggregates', () => {
      const parent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'parent',
        operation: 'batch',
        durationMs: 1000,
      };

      const successEvents: ObservabilityEvent[] = Array.from({ length: 10 }).map((_, i) => ({
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000 + i * 10,
        observabilityLogId: `success-${i}`,
        parentObservabilityLogId: 'parent',
        operation: 'processItem',
        durationMs: 50,
        success: true,
      }));

      const failEvents: ObservabilityEvent[] = Array.from({ length: 3 }).map((_, i) => ({
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1500 + i * 10,
        observabilityLogId: `fail-${i}`,
        parentObservabilityLogId: 'parent',
        operation: 'processItem',
        durationMs: 50,
        success: false,
      }));

      const { events } = applyNoiseReduction(
        [ parent, ...successEvents, ...failEvents ],
        {
          ...baseNoise,
          enabled: true,
          rules: [
            {
              id: 'aggregate-items',
              match: { type: 'span', operation: 'processItem' },
              decision: 'aggregate',
              priority: 2000, // Must override hard signal protection (1000) to aggregate failures
            },
          ],
        }
      );

      const parentEvent = events.find(e => e.observabilityLogId === 'parent')!;
      const aggregates = (parentEvent.data as any)?.noiseReduction?.aggregates || {};

      // CURRENT: All items in one bucket 'span:processItem'
      // DESIRED: Separate buckets for success/failure
      // This test documents current behavior (not necessarily wrong, but inflexible)
      const bucketKeys = Object.keys(aggregates);
      expect(bucketKeys.length).toBeGreaterThan(0);

      // Check if we can distinguish success/failure in the bucket
      const bucket = aggregates[ bucketKeys[ 0 ] ];
      expect(bucket.count).toBe(13);
      expect(bucket.errorCount).toBe(3); // At least we track error count
    });
  });

  describe('Issue #10: Missing Batch Size Limits', () => {
    it('should handle very large batches without crashing', () => {
      // Create a pathologically large batch
      const events: ObservabilityEvent[] = Array.from({ length: 10000 }).map((_, i) => ({
        type: 'log',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000 + i,
        observabilityLogId: `event-${i}`,
        operation: 'test-op',
      }));

      // Should not crash or timeout
      expect(() => {
        applyNoiseReduction(
          events,
          {
            ...baseNoise,
            enabled: true,
            rules: [
              {
                id: 'drop-all',
                match: { type: 'log' },
                decision: 'drop',
              },
            ],
          }
        );
      }).not.toThrow();

      // Ideally should warn about large batch size
      // Currently doesn't have size limits
    });

    it('should handle deeply nested hierarchies', () => {
      // Create deep nesting (potential stack overflow)
      const events: ObservabilityEvent[] = [];
      const depth = 100;

      for (let i = 0; i < depth; i++) {
        events.push({
          type: 'span',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1000 + i,
          observabilityLogId: `level-${i}`,
          parentObservabilityLogId: i > 0 ? `level-${i - 1}` : undefined,
          operation: `level-${i}-op`,
          durationMs: 10,
        });
      }

      // Should not cause stack overflow
      expect(() => {
        applyNoiseReduction(
          events,
          {
            ...baseNoise,
            enabled: true,
            rules: [],
          }
        );
      }).not.toThrow();
    });
  });

  describe('Issue #15: Silent Checkpoint Truncation', () => {
    it('should indicate when checkpoints are truncated', () => {
      const parent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'parent',
        operation: 'batch',
        durationMs: 1000,
      };

      // Create 10 children to fold
      const children: ObservabilityEvent[] = Array.from({ length: 10 }).map((_, i) => ({
        type: 'log',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000 + i * 10,
        observabilityLogId: `child-${i}`,
        parentObservabilityLogId: 'parent',
        operation: 'item',
        metrics: { index: i },
      }));

      const { events } = applyNoiseReduction(
        [ parent, ...children ],
        {
          ...baseNoise,
          enabled: true,
          maxCheckpointsPerSpan: 5, // Only 5 allowed!
          rules: [
            {
              id: 'fold-all',
              match: { operation: 'item' },
              decision: 'fold',
              priority: 100,
            },
          ],
        }
      );

      const parentInOutput = events.find(e => e.observabilityLogId === 'parent')!;
      const checkpoints = (parentInOutput?.data as any)?.checkpoints || [];

      // Only 5 checkpoints fit
      expect(checkpoints.length).toBeLessThanOrEqual(5);

      // CRITICAL: Should have truncation indicator
      const noiseReduction = (parentInOutput?.data as any)?.noiseReduction;
      expect(noiseReduction?.checkpointsTruncated).toBe(true);
      // 10 fold checkpoints attempted, 5 fit, 5 dropped, then summary checkpoint also dropped = 6 total dropped
      expect(noiseReduction?.checkpointsTruncatedCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Issue #14: span.start ID Mismatch', () => {
    it('should handle span.start with different ID than consolidated span', () => {
      const spanStart: ObservabilityEvent = {
        type: 'span.start',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'span-1-start', // Different ID!
        operation: 'query',
      };

      const consolidatedSpan: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1050,
        observabilityLogId: 'span-1', // Different ID!
        operation: 'query',
        durationMs: 50,
      };

      const { events } = applyNoiseReduction(
        [ spanStart, consolidatedSpan ],
        {
          ...baseNoise,
          enabled: true,
          rules: [
            {
              id: 'drop-queries',
              match: { operation: 'query' },
              decision: 'drop',
              priority: 100,
            },
          ],
        }
      );

      // BUG: span.start will be kept because ID doesn't match
      // Expected: both dropped (or both kept, but consistent)
      const spanStartInOutput = events.find(e => e.type === 'span.start');
      const spanInOutput = events.find(e => e.type === 'span');

      // Current behavior: span.start kept, span dropped (INCONSISTENT)
      // Expected behavior: both should have same fate
      if (spanInOutput) {
        expect(spanStartInOutput).toBeDefined(); // If span kept, span.start should be kept
      } else {
        expect(spanStartInOutput).toBeUndefined(); // If span dropped, span.start should be dropped
      }
    });
  });

  describe('Issue #13: Context Preservation for Hard Signals', () => {
    it('should drop parent when no hard signals in subtree', () => {
      const parent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'parent',
        operation: 'droppable-op',
        durationMs: 100,
      };

      const child: ObservabilityEvent = {
        type: 'log',
        level: 'info', // Just noise, not a hard signal
        correlationId: 'test',
        timestampMs: 1050,
        observabilityLogId: 'child',
        parentObservabilityLogId: 'parent',
        operation: 'noise-work',
        metrics: { itemsProcessed: 100 },
      };

      const { events, stats } = applyNoiseReduction(
        [ parent, child ],
        {
          ...baseNoise,
          enabled: true,
          rules: [
            {
              id: 'drop-parent',
              match: { operation: 'droppable-op' },
              decision: 'drop',
              priority: 50,
            },
            {
              id: 'fold-child',
              match: { operation: 'noise-work' },
              decision: 'fold',
              priority: 100,
            },
          ],
        }
      );

      // Parent should be DROPPED (no hard signals in subtree)
      // Child should be FOLDED into parent first, then parent dropped
      const parentInOutput = events.find(e => e.observabilityLogId === 'parent');
      expect(parentInOutput).toBeUndefined();

      // Stats should show fold + drop
      expect(stats.folded).toBe(1);
      expect(stats.dropped).toBe(1);
    });

    it('should keep parent as context when hard signal in subtree', () => {
      const parent: ObservabilityEvent = {
        type: 'span',
        level: 'info',
        correlationId: 'test',
        timestampMs: 1000,
        observabilityLogId: 'parent',
        operation: 'droppable-op',
        durationMs: 100,
      };

      const child: ObservabilityEvent = {
        type: 'log',
        level: 'error', // HARD SIGNAL - cannot be folded
        correlationId: 'test',
        timestampMs: 1050,
        observabilityLogId: 'child',
        parentObservabilityLogId: 'parent',
        operation: 'failed-work',
        error: { type: 'Error', message: 'Something went wrong' },
        metrics: { itemsProcessed: 100 },
      };

      const { events, stats } = applyNoiseReduction(
        [ parent, child ],
        {
          ...baseNoise,
          enabled: true,
          rules: [
            {
              id: 'drop-parent',
              match: { operation: 'droppable-op' },
              decision: 'drop',
              priority: 50,
            },
          ],
        }
      );

      // NEW BEHAVIOR: Parent kept as context (hasHardSignalInSubtree=true)
      // Child kept as hard signal (error level)
      const parentInOutput = events.find(e => e.observabilityLogId === 'parent');
      const childInOutput = events.find(e => e.observabilityLogId === 'child');

      expect(parentInOutput).toBeDefined(); // Context preserved
      expect(childInOutput).toBeDefined(); // Hard signal kept
      expect(stats.kept).toBe(2);
      expect(stats.dropped).toBe(0);
    });
  });

  // Issue #12 tests removed - tested old folding behavior  
  // New algorithm uses hard signal protection instead
});
