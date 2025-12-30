import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import { ObservabilityEvent } from '../../types';

describe('Force-Keep Bug V2: Test with MULTIPLE children where some are kept', () => {

  it('Parent GET span with multiple children - some dropped, some kept', () => {
    const config = createObservabilityConfig({
      enabled: true,
      noiseReduction: {
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        emitSummaries: true,
        includeDebugMetadata: true,
      },
    });

    // Parent span: Controller GET operation
    const parentSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent-123',
      parentObservabilityLogId: undefined,
      correlationId: 'test-correlation',
      operation: 'HTTP GET /admin/teamintegrationconfig',
      source: 'AdminTeamIntegrationConfigController.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 420,
      success: true,
      status: 'completed',
      data: {},
    };

    // Child 1: Service list operation (dropped)
    const child1: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'child-1',
      parentObservabilityLogId: 'parent-123',
      correlationId: 'test-correlation',
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

    // Child 2: Database query (should be kept - it's an INFO log)
    const child2: ObservabilityEvent = {
      type: 'log',
      observabilityLogId: 'child-2',
      parentObservabilityLogId: 'parent-123',
      correlationId: 'test-correlation',
      operation: 'query',
      source: 'database',
      level: 'info',
      timestampMs: Date.now(),
      data: { message: 'Query executed' },
    };

    const events = [ parentSpan, child1, child2 ];

    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 SCENARIO: Parent with mixed children (some dropped, some kept)');
    console.log('  Output events:', result.events.length);
    console.log('  Dropped:', result.stats.dropped);
    console.log('  Kept:', result.stats.kept);

    result.events.forEach((e, i) => {
      console.log(`  [${i}] ${e.type}: ${e.operation} (${e.observabilityLogId})`);
      if (e.type === 'span' && (e.data as any)?.noiseReduction) {
        console.log('      noiseReduction:', JSON.stringify((e.data as any).noiseReduction, null, 8));
      }
    });

    const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent-123');

    // IN THIS CASE: Parent SHOULD be kept because child2 (log) is kept
    // The parent needs to exist to maintain hierarchy
    expect(parentInOutput).toBeDefined();
    expect((parentInOutput?.data as any)?.noiseReduction?.forcedKeep).toBe(true);
  });

  it('BUG REPRODUCTION: Parent GET with child that gets METRICS FOLDED but parent still dropped', () => {
    const config = createObservabilityConfig({
      enabled: true,
      noiseReduction: {
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        emitSummaries: true,
        includeDebugMetadata: true,
      },
    });

    // THIS IS THE KEY: What if the child is processed FIRST and modifies the parent's data
    // BEFORE the parent's decision is evaluated?

    const parentSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent-123',
      parentObservabilityLogId: undefined,
      correlationId: 'test-correlation',
      operation: 'HTTP GET /admin/teamintegrationconfig',
      source: 'AdminTeamIntegrationConfigController.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 420,
      success: true,
      status: 'completed',
      data: {},
    };

    const childSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'child-456',
      parentObservabilityLogId: 'parent-123',
      correlationId: 'test-correlation',
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

    // Process child FIRST (maybe order matters?)
    const events = [ childSpan, parentSpan ];

    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 SCENARIO: Child processed before parent');
    console.log('  Output events:', result.events.length);

    result.events.forEach((e, i) => {
      console.log(`  [${i}] ${e.type}: ${e.operation} (${e.observabilityLogId})`);
      if (e.type === 'span' && (e.data as any)?.noiseReduction) {
        console.log('      noiseReduction:', JSON.stringify((e.data as any).noiseReduction, null, 8));
      }
    });

    const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent-123');

    // Parent should STILL be dropped regardless of order
    expect(parentInOutput).toBeUndefined();
  });
});
