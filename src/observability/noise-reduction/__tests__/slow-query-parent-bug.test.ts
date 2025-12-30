import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import { ObservabilityEvent } from '../../types';

describe('Slow query with dropped parent span', () => {
  const config = createObservabilityConfig({
    enabled: true,
    noiseReduction: {
      enabled: true,
      presets: [ 'fw24.hotpaths' ],
      emitSummaries: true,
      includeDebugMetadata: true,
    },
  });

  it('should force-keep parent when slow query child is kept (hard signal)', () => {
    // Parent: fast successful list operation (matches drop rule)
    const listSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'list-parent',
      parentObservabilityLogId: 'controller-root',
      correlationId: 'test',
      operation: 'BaseEntityService.list',
      source: 'service:BaseEntityService.list',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 45, // Fast
      success: true,
      status: 'completed',
      data: {},
    };

    // Child: SLOW database query (hard signal - must be kept)
    const slowQuery: ObservabilityEvent = {
      type: 'database.query',
      observabilityLogId: 'slow-query',
      parentObservabilityLogId: 'list-parent',
      correlationId: 'test',
      operation: 'observabilityLog.list',
      source: 'database',
      level: 'warn', // SLOW query - hard signal
      timestampMs: Date.now(),
      durationMs: 2500, // Very slow!
      success: true,
      entityName: 'observabilityLog',
      data: {},
      metrics: { durationMs: 2500, threshold: 1000 },
    };

    const result = applyNoiseReduction([ listSpan, slowQuery ], config.noiseReduction);

    console.log('\n📊 RESULT:');
    console.log('Input: 2 events (list span + slow query)');
    console.log('Output:', result.events.length, 'events');
    result.events.forEach(e => {
      console.log(`  - ${e.operation} (${e.observabilityLogId})`);
      if ((e.data as any)?.noiseReduction?.forcedKeep) {
        console.log('    ⚠️  forcedKeep: true');
      }
    });

    // ASSERTIONS

    // 1. Slow query MUST be in output (hard signal)
    const queryInOutput = result.events.find(e => e.observabilityLogId === 'slow-query');
    expect(queryInOutput).toBeDefined();
    console.log('\n✅ Slow query kept (hard signal protection)');

    // 2. Parent span MUST be force-kept for hierarchy integrity
    const parentInOutput = result.events.find(e => e.observabilityLogId === 'list-parent');
    expect(parentInOutput).toBeDefined();
    console.log('✅ Parent span force-kept for hierarchy');

    // 3. Parent should have forcedKeep flag
    expect((parentInOutput?.data as any)?.noiseReduction?.forcedKeep).toBe(true);
    console.log('✅ Parent has forcedKeep=true (correct!)');

    // 4. Both events should be in output
    expect(result.events.length).toBe(2);
    console.log('✅ Both events in output');
  });

  it('should NOT force-keep parent when all children are aggregated (no hard signals)', () => {
    // Parent: fast successful list operation
    const listSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'list-parent',
      parentObservabilityLogId: 'controller-root',
      correlationId: 'test',
      operation: 'BaseEntityService.list',
      source: 'service:BaseEntityService.list',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 45,
      success: true,
      status: 'completed',
      data: {},
    };

    // Child: FAST database query (no hard signal - should be aggregated/folded)
    const fastQuery: ObservabilityEvent = {
      type: 'database.query',
      observabilityLogId: 'fast-query',
      parentObservabilityLogId: 'list-parent',
      correlationId: 'test',
      operation: 'observabilityLog.list',
      source: 'database',
      level: 'debug', // Fast query
      timestampMs: Date.now(),
      durationMs: 50, // Fast
      success: true,
      entityName: 'observabilityLog',
      data: {},
      metrics: { durationMs: 50, threshold: 1000 },
    };

    const result = applyNoiseReduction([ listSpan, fastQuery ], config.noiseReduction);

    console.log('\n📊 RESULT:');
    console.log('Input: 2 events (list span + fast query)');
    console.log('Output:', result.events.length, 'events');
    result.events.forEach(e => {
      console.log(`  - ${e.operation} (${e.observabilityLogId})`);
    });

    // ASSERTIONS

    // Both should be dropped/folded (no hard signals)
    const parentInOutput = result.events.find(e => e.observabilityLogId === 'list-parent');
    const queryInOutput = result.events.find(e => e.observabilityLogId === 'fast-query');

    expect(parentInOutput).toBeUndefined();
    expect(queryInOutput).toBeUndefined();
    console.log('\n✅ Both dropped (no hard signals, no force-keep)');
  });

  it('should handle scan query (always warn level) correctly', () => {
    // Parent: query operation
    const querySpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'query-parent',
      parentObservabilityLogId: 'controller-root',
      correlationId: 'test',
      operation: 'BaseEntityService.query',
      source: 'service:BaseEntityService.query',
      level: 'debug',
      timestampMs: Date.now(),
      durationMs: 100,
      success: true,
      status: 'completed',
      data: {},
    };

    // Child: SCAN query (always warn - expensive operation)
    const scanQuery: ObservabilityEvent = {
      type: 'database.query',
      observabilityLogId: 'scan-query',
      parentObservabilityLogId: 'query-parent',
      correlationId: 'test',
      operation: 'entity.scan',
      source: 'database',
      level: 'warn', // Scans are always warnings
      timestampMs: Date.now(),
      durationMs: 1500,
      success: true,
      entityName: 'entity',
      data: {},
      metrics: { durationMs: 1500, threshold: 3000 },
      tags: { scan: 'true' },
    };

    const result = applyNoiseReduction([ querySpan, scanQuery ], config.noiseReduction);

    console.log('\n📊 RESULT:');
    console.log('Input: 2 events (query span + scan)');
    console.log('Output:', result.events.length, 'events');
    result.events.forEach(e => {
      console.log(`  - ${e.operation} (${e.observabilityLogId})`);
    });

    // ASSERTIONS

    // 1. Scan MUST be kept (hard signal - warn level)
    const scanInOutput = result.events.find(e => e.observabilityLogId === 'scan-query');
    expect(scanInOutput).toBeDefined();
    console.log('\n✅ Scan query kept (hard signal: warn level)');

    // 2. Parent MUST be force-kept
    const parentInOutput = result.events.find(e => e.observabilityLogId === 'query-parent');
    expect(parentInOutput).toBeDefined();
    console.log('✅ Parent force-kept for hierarchy');
  });
});
