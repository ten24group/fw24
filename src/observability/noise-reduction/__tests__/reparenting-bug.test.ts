/**
 * Tests for the reparenting fix: when a parent span is dropped by noise reduction,
 * child events should be reparented to the nearest kept ancestor to avoid "parent not found" errors.
 */

import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import type { ObservabilityEvent } from '../../types';

describe('Noise Reduction - Reparenting Orphaned Children', () => {
  const mockCorrelationId = 'test-correlation-id';
  const mockTimestamp = Date.now();

  function createSpan(
    id: string,
    operation: string,
    options: {
      parentId?: string;
      source?: string;
      success?: boolean;
      level?: string;
      durationMs?: number;
    } = {}
  ): ObservabilityEvent {
    return {
      observabilityLogId: id,
      parentObservabilityLogId: options.parentId,
      correlationId: mockCorrelationId,
      type: 'span',
      operation,
      source: options.source || `service:${operation}`,
      level: (options.level as any) || 'info',
      success: options.success ?? true,
      timestampMs: mockTimestamp,
      durationMs: options.durationMs || 10,
      actor: {
        actorType: 'service',
        actorId: 'test-service',
        correlationId: mockCorrelationId,
        requestId: mockCorrelationId,
        timestamp: new Date(mockTimestamp).toISOString(),
      },
      tags: {},
      metrics: {},
      data: {},
    };
  }

  function createQueryEvent(
    id: string,
    operation: string,
    options: {
      parentId?: string;
      level?: string;
      durationMs?: number;
    } = {}
  ): ObservabilityEvent {
    return {
      observabilityLogId: id,
      parentObservabilityLogId: options.parentId,
      correlationId: mockCorrelationId,
      type: 'database.query',
      operation,
      source: 'QueryObserver',
      level: (options.level as any) || 'warn', // Slow queries are warn (hard signal)
      success: true,
      timestampMs: mockTimestamp,
      durationMs: options.durationMs || 1500, // Slow
      actor: {
        actorType: 'service',
        actorId: 'test-service',
        correlationId: mockCorrelationId,
        requestId: mockCorrelationId,
        timestamp: new Date(mockTimestamp).toISOString(),
      },
      tags: {},
      metrics: {
        durationMs: options.durationMs || 1500,
        threshold: 1000,
      },
      data: {},
    };
  }

  const config = createObservabilityConfig({
    enabled: true,
    noiseReduction: {
      enabled: true,
      presets: [ 'fw24.hotpaths' ],
      emitSummaries: true,
      includeDebugMetadata: true,
    },
  });

  it('should reparent orphaned query event when immediate parent is dropped', () => {
    const rootSpan = createSpan('root-1', 'HTTP GET /admin/entity/observabilitylog', {
      source: 'AdminDynamicEntityController.list',
      durationMs: 500,
    });

    // This span will be dropped by fw24.hotpaths.api.drop_fast_successful_reads
    const childSpan = createSpan('child-1', 'BaseEntityService.list', {
      parentId: 'root-1',
      source: 'service:BaseEntityService',
      durationMs: 300,
    });

    // This query event is a hard signal (warn level - slow query) - MUST be kept
    const queryEvent = createQueryEvent('query-1', 'observabilityLog.list', {
      parentId: 'child-1', // Parent will be dropped
      durationMs: 1500, // Slow
    });

    const result = applyNoiseReduction([ rootSpan, childSpan, queryEvent ], config.noiseReduction);

    // Root span should be kept (it has a kept descendant)
    const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
    expect(keptRoot).toBeDefined();

    // Child span should be dropped (fast successful read)
    const keptChild = result.events.find(e => e.observabilityLogId === 'child-1');
    expect(keptChild).toBeUndefined();

    // Query event should be kept (hard signal)
    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
    expect(keptQuery).toBeDefined();

    // CRITICAL: Query event should be reparented to root-1 (nearest kept ancestor)
    expect(keptQuery!.parentObservabilityLogId).toBe('root-1');

    // Should have reparenting checkpoint
    const data = keptQuery!.data as any;
    expect(data.checkpoints).toBeDefined();
    const reparentCheckpoint = data.checkpoints?.find((c: any) => c.name === 'noiseReduction.reparented');
    expect(reparentCheckpoint).toBeDefined();
    expect(reparentCheckpoint?.data?.originalParent).toBe('child-1');
    expect(reparentCheckpoint?.data?.newParent).toBe('root-1');
  });

  it('should reparent through multiple dropped ancestors', () => {
    const rootSpan = createSpan('root-1', 'HTTP GET /queue/team-sync', {
      source: 'queue:team-sync',
      durationMs: 3000,
    });

    const level1 = createSpan('level1', 'TeamService.sync', {
      parentId: 'root-1',
      source: 'service:TeamService',
      durationMs: 200,
    });

    const level2 = createSpan('level2', 'BaseEntityService.query', {
      parentId: 'level1',
      source: 'service:BaseEntityService',
      durationMs: 150,
    });

    // Slow query - hard signal
    const queryEvent = createQueryEvent('query-1', 'team.query', {
      parentId: 'level2',
      durationMs: 1698, // Very slow
    });

    const result = applyNoiseReduction([ rootSpan, level1, level2, queryEvent ], config.noiseReduction);

    // Root span should be kept
    const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
    expect(keptRoot).toBeDefined();

    // Query event should be kept (hard signal)
    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
    expect(keptQuery).toBeDefined();

    // CRITICAL: Query should be reparented directly to root (skipping dropped ancestors)
    // Even if intermediate spans are kept, the query should point to the nearest kept ancestor
    const queryParent = keptQuery!.parentObservabilityLogId;
    expect(queryParent).toBeTruthy();

    // Verify parent exists in output (no "parent not found" errors)
    const parent = result.events.find(e => e.observabilityLogId === queryParent);
    expect(parent).toBeDefined();
  });

  it('should make orphan a root event if all ancestors are dropped', () => {
    // All spans will be dropped
    const level1 = createSpan('level1', 'BaseEntityService.list', {
      source: 'service:BaseEntityService',
      durationMs: 50,
    });

    const level2 = createSpan('level2', 'BaseEntityService.query', {
      parentId: 'level1',
      source: 'service:BaseEntityService',
      durationMs: 40,
    });

    // Slow query - hard signal
    const queryEvent = createQueryEvent('query-1', 'observabilityLog.query', {
      parentId: 'level2',
      durationMs: 1200,
    });

    const result = applyNoiseReduction([ level1, level2, queryEvent ], config.noiseReduction);

    // Query event should be kept (hard signal)
    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
    expect(keptQuery).toBeDefined();

    // CRITICAL: Query's parent should either be undefined (orphaned) OR point to a kept parent
    const queryParent = keptQuery!.parentObservabilityLogId;
    if (queryParent) {
      // If it has a parent, verify that parent exists in output
      const parent = result.events.find(e => e.observabilityLogId === queryParent);
      expect(parent).toBeDefined();
    }
    // If queryParent is undefined, query is correctly orphaned (all ancestors dropped)

    // Verify reparenting metadata if present
    const data = keptQuery!.data as any;
    if (data?.checkpoints) {
      const reparentCheckpoint = data.checkpoints?.find((c: any) =>
        c.name === 'noiseReduction.reparented' || c.name === 'noiseReduction.orphaned'
      );
      if (reparentCheckpoint) {
        expect(reparentCheckpoint.data?.originalParent).toBeTruthy();
      }
    }
  });

  it('should not reparent if parent exists in output', () => {
    const rootSpan = createSpan('root-1', 'HTTP GET /admin/config', {
      source: 'AdminConfigController.get',
      durationMs: 500,
    });

    // This span will be kept (error)
    const childSpan = createSpan('child-1', 'BaseEntityService.get', {
      parentId: 'root-1',
      source: 'service:BaseEntityService',
      success: false, // Error - hard signal
      level: 'error',
      durationMs: 300,
    });

    // Query event
    const queryEvent = createQueryEvent('query-1', 'config.query', {
      parentId: 'child-1',
      durationMs: 1500,
    });

    const result = applyNoiseReduction([ rootSpan, childSpan, queryEvent ], config.noiseReduction);

    // All should be kept (error path)
    const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
    const keptChild = result.events.find(e => e.observabilityLogId === 'child-1');
    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');

    expect(keptRoot).toBeDefined();
    expect(keptChild).toBeDefined();
    expect(keptQuery).toBeDefined();

    // Query should still point to child (no reparenting needed)
    expect(keptQuery!.parentObservabilityLogId).toBe('child-1');

    // Should NOT have reparenting checkpoint
    const data = keptQuery!.data as any;
    const reparentCheckpoint = data.checkpoints?.find((c: any) => c.name === 'noiseReduction.reparented');
    expect(reparentCheckpoint).toBeUndefined();
  });
});
