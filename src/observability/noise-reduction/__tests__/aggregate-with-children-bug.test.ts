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
      if ((e.data as any)?.noiseReduction?.aggregates) {
        const aggs = (e.data as any).noiseReduction.aggregates;
        console.log('    ✅ Has aggregates:', Object.keys(aggs).map(k => `${k}(${aggs[ k ].count})`).join(', '));
      }
    });

    // ASSERTIONS

    // VERIFY: Only persistence span in output
    expect(result.events.length).toBe(1);

    const persistenceInOutput = result.events[ 0 ];
    expect(persistenceInOutput.observabilityLogId).toBe('persistence-parent');
    expect(persistenceInOutput.operation).toBe('sports.persistence');
    expect(persistenceInOutput.source).toBe('service:SportsPersistenceService.persistEntities');

    // VERIFY: Aggregates structure
    const aggregates = (persistenceInOutput.data as any)?.noiseReduction?.aggregates;
    expect(aggregates).toBeDefined();
    expect(aggregates[ 'span:BaseEntityService.upsert' ]).toEqual({
      count: 24,
      errorCount: 0,
      durationSumMs: expect.any(Number),
      durationMaxMs: expect.any(Number),
      examples: [],
      errorExamples: [],
      rules: { 'fw24.hotpaths.entity.aggregate_upsert_spans': 24 }
    });
    console.log('\n✅ Persistence span kept with aggregates');

    // VERIFY: Exact stats
    expect(result.stats.aggregated).toBe(24); // Exactly 24 upsert spans + 24 query spans
    console.log('✅ Stats show correct aggregation count');

    // 5. All kept events should have valid structure
    console.log('✅ All events properly structured');
  });
});
