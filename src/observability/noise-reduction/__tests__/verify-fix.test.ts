import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import { ObservabilityEvent } from '../../types';

describe('Verify Fix: Comprehensive scenarios for parent drop behavior', () => {

  const config = createObservabilityConfig({
    enabled: true,
    noiseReduction: {
      enabled: true,
      presets: [ 'fw24.hotpaths' ],
      emitSummaries: true,
      includeDebugMetadata: true,
    },
  });

  it('SCENARIO 1: Parent GET + ALL children dropped → Parent SHOULD be dropped', () => {
    const parent: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent',
      parentObservabilityLogId: undefined,
      correlationId: 'test',
      operation: 'HTTP GET /list',
      source: 'Controller.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 100,
      success: true,
      status: 'completed',
      data: {},
    };

    const child: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      correlationId: 'test',
      operation: 'BaseEntityService.list',
      source: 'service:BaseEntityService',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 50,
      success: true,
      status: 'completed',
      data: {},
    };

    const result = applyNoiseReduction([ parent, child ], config.noiseReduction);

    // EXPECTED: Both dropped (parent has NO kept children)
    expect(result.events.length).toBe(0);
    expect(result.stats.dropped).toBe(2);
    console.log('✅ SCENARIO 1 PASS: Parent with only dropped children is dropped');
  });

  it('SCENARIO 2: Parent GET + some children kept → Parent MUST be kept', () => {
    const parent: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent',
      parentObservabilityLogId: undefined,
      correlationId: 'test',
      operation: 'HTTP GET /list',
      source: 'Controller.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 100,
      success: true,
      status: 'completed',
      data: {},
    };

    const droppedChild: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'dropped-child',
      parentObservabilityLogId: 'parent',
      correlationId: 'test',
      operation: 'BaseEntityService.list',
      source: 'service:BaseEntityService',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 50,
      success: true,
      status: 'completed',
      data: {},
    };

    const keptChild: ObservabilityEvent = {
      type: 'log',
      observabilityLogId: 'kept-child',
      parentObservabilityLogId: 'parent',
      correlationId: 'test',
      operation: 'something',
      source: 'service',
      level: 'warn', // WARN logs are kept
      timestampMs: Date.now(),
      data: {},
    };

    const result = applyNoiseReduction([ parent, droppedChild, keptChild ], config.noiseReduction);

    // EXPECTED: Parent kept (has kept child), dropped child dropped, kept child kept
    const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent');
    const keptChildInOutput = result.events.find(e => e.observabilityLogId === 'kept-child');

    expect(parentInOutput).toBeDefined();
    expect(keptChildInOutput).toBeDefined();
    expect((parentInOutput?.data as any)?.noiseReduction?.forcedKeep).toBe(true);
    console.log('✅ SCENARIO 2 PASS: Parent with kept child is kept for hierarchy');
  });

  it('SCENARIO 3: Nested hierarchy - grandchild kept → child & parent MUST be kept', () => {
    const grandparent: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'grandparent',
      parentObservabilityLogId: undefined,
      correlationId: 'test',
      operation: 'HTTP GET /list',
      source: 'Controller.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 200,
      success: true,
      status: 'completed',
      data: {},
    };

    const parent: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent',
      parentObservabilityLogId: 'grandparent',
      correlationId: 'test',
      operation: 'BaseEntityService.list',
      source: 'service:BaseEntityService',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 150,
      success: true,
      status: 'completed',
      data: {},
    };

    const grandchild: ObservabilityEvent = {
      type: 'log',
      observabilityLogId: 'grandchild',
      parentObservabilityLogId: 'parent',
      correlationId: 'test',
      operation: 'query',
      source: 'database',
      level: 'warn', // Kept
      timestampMs: Date.now(),
      data: {},
    };

    const result = applyNoiseReduction([ grandparent, parent, grandchild ], config.noiseReduction);

    // EXPECTED: All kept (transitive closure)
    // grandchild kept → parent kept → grandparent kept
    const grandparentOut = result.events.find(e => e.observabilityLogId === 'grandparent');
    const parentOut = result.events.find(e => e.observabilityLogId === 'parent');
    const grandchildOut = result.events.find(e => e.observabilityLogId === 'grandchild');

    expect(grandchildOut).toBeDefined();
    expect(parentOut).toBeDefined();
    expect(grandparentOut).toBeDefined();
    expect((grandparentOut?.data as any)?.noiseReduction?.forcedKeep).toBe(true);
    expect((parentOut?.data as any)?.noiseReduction?.forcedKeep).toBe(true);
    console.log('✅ SCENARIO 3 PASS: Transitive closure keeps entire hierarchy');
  });

  it('SCENARIO 4: Parent with aggregated children (no drop rule) → Parent kept with aggregates', () => {
    const parent: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent',
      parentObservabilityLogId: undefined,
      correlationId: 'test',
      operation: 'HTTP POST /batch-upsert', // POST doesn't match drop rule
      source: 'Controller.batchUpsert',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 500,
      success: true,
      status: 'completed',
      data: {},
    };

    const children = Array.from({ length: 5 }, (_, i) => ({
      type: 'span' as const,
      observabilityLogId: `child-${i}`,
      parentObservabilityLogId: 'parent',
      correlationId: 'test',
      operation: 'BaseEntityService.upsert',
      source: 'service:BaseEntityService.upsert', // Must match pattern /^service:BaseEntityService\./
      level: 'debug' as const,
      timestampMs: Date.now(),
      durationMs: 50,
      success: true,
      status: 'completed' as const,
      data: {},
    }));

    const result = applyNoiseReduction([ parent, ...children ], config.noiseReduction);

    // EXPECTED: Parent kept with aggregates, children aggregated
    const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent');

    expect(parentInOutput).toBeDefined();
    expect((parentInOutput?.data as any)?.noiseReduction?.aggregates).toBeDefined();
    expect(result.stats.aggregated).toBe(5);
    console.log('✅ SCENARIO 4 PASS: Parent kept with aggregate summaries');
  });

  it('SCENARIO 5: YOUR EXACT CASE - Parent GET with folded child metrics', () => {
    const parent: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent-123',
      parentObservabilityLogId: undefined,
      correlationId: 'test',
      operation: 'HTTP GET /admin/teamintegrationconfig',
      source: 'AdminTeamIntegrationConfigController.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 420,
      success: true,
      status: 'completed',
      data: {},
    };

    const child: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'child-456',
      parentObservabilityLogId: 'parent-123',
      correlationId: 'test',
      operation: 'BaseEntityService.list',
      source: 'service:BaseEntityService',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 260,
      success: true,
      status: 'completed',
      data: {},
      metrics: { resultCount: 10 },
    };

    const result = applyNoiseReduction([ parent, child ], config.noiseReduction);

    // EXPECTED: BOTH DROPPED (your desired behavior)
    // Child matches drop rule → dropped
    // Parent matches drop rule + has NO kept children → dropped
    expect(result.events.length).toBe(0);
    expect(result.stats.dropped).toBe(2);
    console.log('✅ SCENARIO 5 PASS: Your exact case - parent GET with only dropped children is now dropped');
  });
});
