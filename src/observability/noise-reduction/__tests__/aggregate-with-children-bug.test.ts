import { applyNoiseReduction } from '../index';
import { createObservabilityConfig } from '../../config';
import { ObservabilityEvent } from '../../types';

describe('Aggregation with nested children bug', () => {
  const config = createObservabilityConfig({
    enabled: true,
    noiseReduction: {
      enabled: true,
      presets: [ 'fw24.hotpaths' ],
      emitSummaries: true,
      includeDebugMetadata: true,
    },
  });

  it('aggregated upsert spans with aggregated query children should NOT be force-kept', () => {
    // This is YOUR EXACT CASE from the queue handler

    // Parent: persistence span (kept, has aggregates)
    const persistenceSpan: ObservabilityEvent = {
      type: 'span',
      observabilityLogId: 'persistence-parent',
      parentObservabilityLogId: 'queue-root', // Root queue span
      correlationId: 'test',
      operation: 'sports.persistence',
      source: 'service:SportsPersistenceService.persistEntities',
      level: 'info',
      timestampMs: Date.now(),
      durationMs: 198,
      success: true,
      status: 'completed',
      data: {},
    };

    // Children: 24 upsert spans (should be aggregated)
    const upsertSpans: ObservabilityEvent[] = Array.from({ length: 24 }, (_, i) => ({
      type: 'span' as const,
      observabilityLogId: `upsert-${i}`,
      parentObservabilityLogId: 'persistence-parent',
      correlationId: 'test',
      operation: 'BaseEntityService.upsert',
      source: 'service:BaseEntityService.upsert',
      level: 'info' as const,
      timestampMs: Date.now(),
      durationMs: 70 + i * 5, // 70-185ms
      success: true,
      status: 'completed' as const,
      data: {},
      tags: { entityName: 'standing' },
    }));

    // Grandchildren: each upsert has a database.query child (also should be aggregated/folded)
    const querySpans: ObservabilityEvent[] = upsertSpans.flatMap((upsert, i) => [
      {
        type: 'database.query' as const,
        observabilityLogId: `query-${i}`,
        parentObservabilityLogId: upsert.observabilityLogId,
        correlationId: 'test',
        operation: 'standing.upsert',
        source: 'database',
        level: 'debug' as const,
        timestampMs: Date.now(),
        durationMs: 50,
        success: true,
        entityName: 'standing',
        data: {},
      } as ObservabilityEvent,
    ]);

    const allEvents = [ persistenceSpan, ...upsertSpans, ...querySpans ];
    const result = applyNoiseReduction(allEvents, config.noiseReduction);

    console.log('\n📊 RESULT SUMMARY:');
    console.log('Total input events:', allEvents.length);
    console.log('Total output events:', result.events.length);
    console.log('Aggregated:', result.stats.aggregated);
    console.log('Kept:', result.stats.kept);
    console.log('\nOutput event operations:');
    result.events.forEach(e => {
      console.log(`  - ${e.operation} (${e.observabilityLogId})`);
      if ((e.data as any)?.noiseReduction?.forcedKeep) {
        console.log('    ⚠️  HAS forcedKeep: true');
      }
      if ((e.data as any)?.noiseReduction?.aggregates) {
        const aggs = (e.data as any).noiseReduction.aggregates;
        console.log('    ✅ Has aggregates:', Object.keys(aggs).map(k => `${k}(${aggs[ k ].count})`).join(', '));
      }
    });

    // ASSERTIONS

    // 1. Persistence span should be kept (has aggregated children)
    const persistenceInOutput = result.events.find(e => e.observabilityLogId === 'persistence-parent');
    expect(persistenceInOutput).toBeDefined();
    expect((persistenceInOutput?.data as any)?.noiseReduction?.aggregates).toBeDefined();
    console.log('\n✅ Persistence span kept with aggregates');

    // 2. NO upsert spans should be in output (they were aggregated)
    const upsertInOutput = result.events.filter(e => e.observabilityLogId?.startsWith('upsert-'));
    expect(upsertInOutput.length).toBe(0);
    console.log('✅ No upsert spans in output (properly aggregated)');

    // 3. NO query spans should be in output (they were folded/aggregated)
    const queryInOutput = result.events.filter(e => e.observabilityLogId?.startsWith('query-'));
    expect(queryInOutput.length).toBe(0);
    console.log('✅ No query spans in output (properly aggregated/folded)');

    // 4. Stats should show correct aggregation count
    expect(result.stats.aggregated).toBeGreaterThanOrEqual(24); // At least 24 upsert spans
    console.log('✅ Stats show correct aggregation count');

    // 5. CRITICAL: No forcedKeep on any event
    const forcedKeepEvents = result.events.filter(e => (e.data as any)?.noiseReduction?.forcedKeep === true);
    expect(forcedKeepEvents.length).toBe(0);
    console.log('✅ No events have forcedKeep=true');
  });
});
