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

    // VERIFY: Root span kept (has kept descendant)
    const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
    expect(keptRoot).toBeDefined();
    expect(keptRoot?.operation).toContain('GET'); // The actual operation from test data
    expect(keptRoot?.source).toContain('Controller'); // The actual source from test data

    // VERIFY: Child span DROPPED (no absorbed data, ancestor exists for reparenting)
    const keptChild = result.events.find(e => e.observabilityLogId === 'child-1');
    expect(keptChild).toBeUndefined();

    // VERIFY: Query event kept (hard signal)
    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
    expect(keptQuery).toBeDefined();
    expect(keptQuery?.type).toBe('database.query');
    expect(keptQuery?.level).toBe('warn');

    // VERIFY: Query reparented to root-1
    expect(keptQuery!.parentObservabilityLogId).toBe('root-1');

    // VERIFY: Reparenting checkpoint exists
    const checkpoints = (keptQuery!.data as any)?.checkpoints;
    expect(Array.isArray(checkpoints)).toBe(true);
    const reparentCheckpoint = checkpoints.find((c: any) => c.name === 'noiseReduction.reparented');
    expect(reparentCheckpoint).toBeDefined();
    expect(reparentCheckpoint.ts).toBeDefined();
    expect(typeof reparentCheckpoint.ts).toBe('number');
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
      durationMs: 100,
    });

    const queryEvent = createQueryEvent('query-1', 'team.query', {
      parentId: 'level2',
      durationMs: 2000,
    });

    const result = applyNoiseReduction([ rootSpan, level1, level2, queryEvent ], {
      ...config.noiseReduction,
      rules: [
        { id: 'drop-l1', match: { operation: 'TeamService.sync' }, decision: 'drop', priority: 100 },
        { id: 'drop-l2', match: { operation: 'BaseEntityService.query' }, decision: 'drop', priority: 100 }
      ]
    });

    const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
    expect(keptRoot).toBeDefined();

    const keptL1 = result.events.find(e => e.observabilityLogId === 'level1');
    expect(keptL1).toBeUndefined();

    const keptL2 = result.events.find(e => e.observabilityLogId === 'level2');
    expect(keptL2).toBeUndefined();

    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
    expect(keptQuery).toBeDefined();

    // Should skip level1 and level2, directly to root
    expect(keptQuery!.parentObservabilityLogId).toBe('root-1');
  });

  it('should make orphan a root event if all ancestors are dropped', () => {
    const level1 = createSpan('level1', 'BaseEntityService.list', {
      source: 'service:BaseEntityService', // Dropped by rule (no root)
      durationMs: 50,
    });

    const level2 = createSpan('level2', 'BaseEntityService.query', {
      parentId: 'level1',
      source: 'service:BaseEntityService',
      durationMs: 40,
    });

    const queryEvent = createQueryEvent('query-1', 'observabilityLog.query', {
      parentId: 'level2',
      durationMs: 2000,
    });

    const result = applyNoiseReduction([ level1, level2, queryEvent ], {
      ...config.noiseReduction,
      rules: [
        { id: 'drop-l1', match: { operation: 'BaseEntityService.list' }, decision: 'drop', priority: 100 },
        { id: 'drop-l2', match: { operation: 'BaseEntityService.query' }, decision: 'drop', priority: 100 }
      ]
    });

    // Level 1 should be KEPT (it's a root with kept descendant)
    // Level 2 should be folded into Level 1
    // Query remains child of Level 1 (reparented)
    const keptL1 = result.events.find(e => e.observabilityLogId === 'level1');
    expect(keptL1).toBeDefined(); // KEPT (root with kept child)

    expect(result.events.find(e => e.observabilityLogId === 'level2')).toBeUndefined(); // Folded

    const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
    expect(keptQuery).toBeDefined();

    // Should be reparented to level1 (context preserved)
    expect(keptQuery!.parentObservabilityLogId).toBe('level1');
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

    // No reparenting needed
    expect(keptQuery!.parentObservabilityLogId).toBe('child-1');
  });
});
