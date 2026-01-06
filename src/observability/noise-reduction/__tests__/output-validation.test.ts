/**
 * Output Validation Tests
 * 
 * Tests that verify noise reduction output quality beyond just counts.
 * Validates hierarchy integrity, checkpoints, and data completeness.
 */

import { applyNoiseReduction } from '../index';
import type { ObservabilityEvent, NoiseReductionConfig } from '../../types';
import { ObservabilityLevel } from '../../types';
import {
  verifyKeptHierarchy,
  findEvent,
  hasCheckpoints,
  getCheckpointNames,
  findErrors,
} from './test-helpers';

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

describe('Output Validation', () => {
  describe('Hierarchy Integrity', () => {
    it('should ensure all events have valid parent references', () => {
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
          level: 'debug',
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

      const { events: output } = applyNoiseReduction(events, config);

      // Should not throw - all parent references valid
      expect(() => verifyKeptHierarchy(output)).not.toThrow();

      // Mid dropped, error reparented to root
      expect(output).toHaveLength(2);
      const errorOut = findEvent(output, 'error')!;
      expect(errorOut.parentObservabilityLogId).toBe('root');
    });

    it('should ensure all errors are kept', () => {
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

      const { events: output } = applyNoiseReduction(events, config);

      const errors = findErrors(output);
      expect(errors).toHaveLength(2);
      expect(errors.map(e => e.observabilityLogId).sort()).toEqual([ 'error1', 'error2' ]);
    });
  });

  describe('Checkpoint Validation', () => {
    it('should create checkpoints when folding children', () => {
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
          type: 'database.query',
          level: 'info',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'db',
          parentObservabilityLogId: 'root',
          operation: 'SELECT',
          durationMs: 50,
        },
        {
          type: 'log',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1020,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'root',
          operation: 'error',
        },
      ];

      const config: NoiseReductionConfig = {
        ...baseConfig,
        rules: [
          {
            id: 'fold-db',
            match: { type: 'database.query' },
            decision: 'fold',
            reason: 'Fold DB',
          },
        ],
      };

      const { events: output } = applyNoiseReduction(events, config);

      const root = findEvent(output, 'root')!;
      expect(hasCheckpoints(root)).toBe(true);

      const names = getCheckpointNames(root);
      expect(names.some(n => n.includes('fold'))).toBe(true);
    });

    it('should create checkpoints when context is preserved', () => {
      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'info',
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

      const { events: output } = applyNoiseReduction(events, config);

      // Root upgraded from DROP to KEEP (context for error)
      const root = findEvent(output, 'root')!;
      expect(root).toBeDefined();

      const names = getCheckpointNames(root);
      expect(names.some(n => n.includes('context'))).toBe(true);
    });
  });

  describe('Data Completeness', () => {
    it('should preserve all error information', () => {
      const errorData = {
        type: 'ValidationError',
        message: 'Field is required',
        stack: 'Error: Field is required\n  at validate',
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
          level: 'error',
          correlationId: 'test',
          timestampMs: 1010,
          observabilityLogId: 'error',
          parentObservabilityLogId: 'root',
          operation: 'validation',
          error: errorData,
        },
      ];

      const { events: output } = applyNoiseReduction(events, baseConfig);

      const errorOut = findEvent(output, 'error')!;
      expect(errorOut.error).toEqual(errorData);
    });

    it('should preserve metrics and tags', () => {
      const metrics = { itemsProcessed: 100, errorCount: 5 };
      const tags = { userId: 'user-123', tenantId: 'tenant-456' };

      const events: ObservabilityEvent[] = [
        {
          type: 'span',
          level: 'error',
          correlationId: 'test',
          timestampMs: 1000,
          observabilityLogId: 'span',
          operation: 'batch',
          durationMs: 1000,
          metrics,
          tags,
        },
      ];

      const { events: output } = applyNoiseReduction(events, baseConfig);

      const span = findEvent(output, 'span')!;
      expect(span.metrics).toEqual(metrics);
      expect(span.tags).toEqual(tags);
    });
  });
});
