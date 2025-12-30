import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import { ObservabilityEvent } from '../../types';

describe('Force-Keep Bug: Parent span dropped by rule but force-kept due to child summaries', () => {

  it('REPRODUCES THE BUG: Parent GET span should be dropped but is force-kept', () => {
    const config = createObservabilityConfig({
      enabled: true,
      noiseReduction: {
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        emitSummaries: true,
        includeDebugMetadata: true,
      },
    });

    // Parent span: Controller GET operation (should be dropped by fw24.hotpaths.api.drop_fast_successful_reads)
    const parentSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'parent-123',
      parentObservabilityLogId: undefined, // Root span
      correlationId: 'test-correlation',
      operation: 'HTTP GET /admin/teamintegrationconfig',
      source: 'AdminTeamIntegrationConfigController.list',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 420, // Under 500ms threshold
      success: true,
      status: 'completed',
      data: {},
    };

    // Child span: Service list operation (should be dropped)
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
      metrics: {
        resultCount: 10,
      },
    };

    const events = [ parentSpan, childSpan ];

    // Apply noise reduction
    const result = applyNoiseReduction(events, config.noiseReduction);

    console.log('\n🔍 NOISE REDUCTION RESULT:');
    console.log('  Input events:', events.length);
    console.log('  Output events:', result.events.length);
    console.log('  Stats:', JSON.stringify(result.stats, null, 2));
    console.log('\n📊 OUTPUT EVENTS:');
    result.events.forEach((e, i) => {
      console.log(`  [${i}] ${e.type}: ${e.operation} (${e.observabilityLogId})`);
      if (e.type === 'span' && (e.data as any)?.noiseReduction) {
        console.log('      noiseReduction:', JSON.stringify((e.data as any).noiseReduction, null, 8));
      }
    });

    // BUG ASSERTION: Parent span is force-kept when it should be dropped
    const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent-123');
    const childInOutput = result.events.find(e => e.observabilityLogId === 'child-456');

    console.log('\n🐛 BUG CHECK:');
    console.log('  Parent in output:', !!parentInOutput);
    console.log('  Parent has forcedKeep:', !!(parentInOutput && (parentInOutput.data as any)?.noiseReduction?.forcedKeep));
    console.log('  Child in output:', !!childInOutput);
    console.log('  Dropped count:', result.stats.dropped);

    // EXPECTED BEHAVIOR:
    // - Both parent AND child should be dropped (both match drop rules)
    // - Neither should be in output
    // - Stats should show 2 dropped spans

    // ACTUAL BEHAVIOR (BUG):
    // - Child is dropped ✅
    // - Parent is force-kept ❌ (because child was folded into it)
    // - Parent has noiseReduction.forcedKeep = true ❌

    // THIS SHOULD PASS (correct behavior):
    expect(parentInOutput).toBeUndefined(); // Parent SHOULD be dropped
    expect(childInOutput).toBeUndefined(); // Child SHOULD be dropped
    expect(result.stats.dropped).toBe(2); // Both should be dropped

    // THIS IS WHAT CURRENTLY HAPPENS (bug):
    if (parentInOutput) {
      console.error('\n❌ BUG CONFIRMED: Parent span was force-kept when it should be dropped!');
      console.error('   Parent operation:', parentInOutput.operation);
      console.error('   Parent duration:', parentInOutput.durationMs, 'ms (under 500ms threshold)');
      console.error('   Parent success:', parentInOutput.success);
      console.error('   Parent should match rule: fw24.hotpaths.api.drop_fast_successful_reads');
      throw new Error('BUG: Parent span force-kept when it should be dropped');
    }
  });
});
