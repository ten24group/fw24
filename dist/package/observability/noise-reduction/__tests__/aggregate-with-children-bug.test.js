"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
describe('Aggregation with nested children bug', () => {
    const config = (0, config_1.createObservabilityConfig)({
        enabled: true,
        noiseReduction: {
            enabled: true,
            presets: ['fw24.hotpaths'],
            emitSummaries: true,
            includeDebugMetadata: true,
        },
    });
    it('aggregated upsert spans with aggregated query children should NOT be force-kept', () => {
        // This is YOUR EXACT CASE from the queue handler
        // Parent: persistence span (kept, has aggregates)
        const persistenceSpan = {
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
        const upsertSpans = Array.from({ length: 24 }, (_, i) => ({
            type: 'span',
            observabilityLogId: `upsert-${i}`,
            parentObservabilityLogId: 'persistence-parent',
            correlationId: 'test',
            operation: 'BaseEntityService.upsert',
            source: 'service:BaseEntityService.upsert',
            level: 'info',
            timestampMs: Date.now(),
            durationMs: 70 + i * 5, // 70-185ms
            success: true,
            status: 'completed',
            data: {},
            tags: { entityName: 'standing' },
        }));
        // Grandchildren: each upsert has a database.query child (also should be aggregated/folded)
        const querySpans = upsertSpans.flatMap((upsert, i) => [
            {
                type: 'database.query',
                observabilityLogId: `query-${i}`,
                parentObservabilityLogId: upsert.observabilityLogId,
                correlationId: 'test',
                operation: 'standing.upsert',
                source: 'database',
                level: 'debug',
                timestampMs: Date.now(),
                durationMs: 50,
                success: true,
                entityName: 'standing',
                data: {},
            },
        ]);
        const allEvents = [persistenceSpan, ...upsertSpans, ...querySpans];
        const result = (0, index_1.applyNoiseReduction)(allEvents, config.noiseReduction);
        console.log('\n📊 RESULT SUMMARY:');
        console.log('Total input events:', allEvents.length);
        console.log('Total output events:', result.events.length);
        console.log('Aggregated:', result.stats.aggregated);
        console.log('Kept:', result.stats.kept);
        console.log('\nOutput event operations:');
        result.events.forEach(e => {
            console.log(`  - ${e.operation} (${e.observabilityLogId})`);
            if (e.data?.noiseReduction?.aggregates) {
                const aggs = e.data.noiseReduction.aggregates;
                console.log('    ✅ Has aggregates:', Object.keys(aggs).map(k => `${k}(${aggs[k].count})`).join(', '));
            }
        });
        // ASSERTIONS
        // VERIFY: Only persistence span in output
        expect(result.events.length).toBe(1);
        const persistenceInOutput = result.events[0];
        expect(persistenceInOutput.observabilityLogId).toBe('persistence-parent');
        expect(persistenceInOutput.operation).toBe('sports.persistence');
        expect(persistenceInOutput.source).toBe('service:SportsPersistenceService.persistEntities');
        // VERIFY: Aggregates structure
        const aggregates = persistenceInOutput.data?.noiseReduction?.aggregates;
        expect(aggregates).toBeDefined();
        expect(aggregates['span:BaseEntityService.upsert']).toEqual({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWdncmVnYXRlLXdpdGgtY2hpbGRyZW4tYnVnLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL2FnZ3JlZ2F0ZS13aXRoLWNoaWxkcmVuLWJ1Zy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsb0NBQStDO0FBQy9DLHlDQUF5RDtBQUd6RCxRQUFRLENBQUMsc0NBQXNDLEVBQUUsR0FBRyxFQUFFO0lBQ3BELE1BQU0sTUFBTSxHQUFHLElBQUEsa0NBQXlCLEVBQUM7UUFDdkMsT0FBTyxFQUFFLElBQUk7UUFDYixjQUFjLEVBQUU7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLE9BQU8sRUFBRSxDQUFFLGVBQWUsQ0FBRTtZQUM1QixhQUFhLEVBQUUsSUFBSTtZQUNuQixvQkFBb0IsRUFBRSxJQUFJO1NBQzNCO0tBQ0YsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLGlGQUFpRixFQUFFLEdBQUcsRUFBRTtRQUN6RixpREFBaUQ7UUFFakQsa0RBQWtEO1FBQ2xELE1BQU0sZUFBZSxHQUF1QjtZQUMxQyxJQUFJLEVBQUUsTUFBTTtZQUNaLGtCQUFrQixFQUFFLG9CQUFvQjtZQUN4Qyx3QkFBd0IsRUFBRSxZQUFZLEVBQUUsa0JBQWtCO1lBQzFELGFBQWEsRUFBRSxNQUFNO1lBQ3JCLFNBQVMsRUFBRSxvQkFBb0I7WUFDL0IsTUFBTSxFQUFFLGtEQUFrRDtZQUMxRCxLQUFLLEVBQUUsTUFBTTtZQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3ZCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLElBQUk7WUFDYixNQUFNLEVBQUUsV0FBVztZQUNuQixJQUFJLEVBQUUsRUFBRTtTQUNULENBQUM7UUFFRixtREFBbUQ7UUFDbkQsTUFBTSxXQUFXLEdBQXlCLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxN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TUFBTSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQywyQ0FBMkM7UUFDckYsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1FBRXRELGlEQUFpRDtRQUNqRCxPQUFPLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxDQUFDLENBQUM7SUFDbEQsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24gfSBmcm9tICcuLi9pbmRleCc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vLi4vY29uZmlnJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uLy4uL3R5cGVzJztcblxuZGVzY3JpYmUoJ0FnZ3JlZ2F0aW9uIHdpdGggbmVzdGVkIGNoaWxkcmVuIGJ1ZycsICgpID0+IHtcbiAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnIF0sXG4gICAgICBlbWl0U3VtbWFyaWVzOiB0cnVlLFxuICAgICAgaW5jbHVkZURlYnVnTWV0YWRhdGE6IHRydWUsXG4gICAgfSxcbiAgfSk7XG5cbiAgaXQoJ2FnZ3JlZ2F0ZWQgdXBzZXJ0IHNwYW5zIHdpdGggYWdncmVnYXRlZCBxdWVyeSBjaGlsZHJlbiBzaG91bGQgTk9UIGJlIGZvcmNlLWtlcHQnLCAoKSA9PiB7XG4gICAgLy8gVGhpcyBpcyBZT1VSIEVYQUNUIENBU0UgZnJvbSB0aGUgcXVldWUgaGFuZGxlclxuXG4gICAgLy8gUGFyZW50OiBwZXJzaXN0ZW5jZSBzcGFuIChrZXB0LCBoYXMgYWdncmVnYXRlcylcbiAgICBjb25zdCBwZXJzaXN0ZW5jZVNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BlcnNpc3RlbmNlLXBhcmVudCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdxdWV1ZS1yb290JywgLy8gUm9vdCBxdWV1ZSBzcGFuXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdzcG9ydHMucGVyc2lzdGVuY2UnLFxuICAgICAgc291cmNlOiAnc2VydmljZTpTcG9ydHNQZXJzaXN0ZW5jZVNlcnZpY2UucGVyc2lzdEVudGl0aWVzJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDE5OCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIC8vIENoaWxkcmVuOiAyNCB1cHNlcnQgc3BhbnMgKHNob3VsZCBiZSBhZ2dyZWdhdGVkKVxuICAgIGNvbnN0IHVwc2VydFNwYW5zOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDI0IH0sIChfLCBpKSA9PiAoe1xuICAgICAgdHlwZTogJ3NwYW4nIGFzIGNvbnN0LFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgdXBzZXJ0LSR7aX1gLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGVyc2lzdGVuY2UtcGFyZW50JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydCcsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydCcsXG4gICAgICBsZXZlbDogJ2luZm8nIGFzIGNvbnN0LFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA3MCArIGkgKiA1LCAvLyA3MC0xODVtc1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcgYXMgY29uc3QsXG4gICAgICBkYXRhOiB7fSxcbiAgICAgIHRhZ3M6IHsgZW50aXR5TmFtZTogJ3N0YW5kaW5nJyB9LFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW5kY2hpbGRyZW46IGVhY2ggdXBzZXJ0IGhhcyBhIGRhdGFiYXNlLnF1ZXJ5IGNoaWxkIChhbHNvIHNob3VsZCBiZSBhZ2dyZWdhdGVkL2ZvbGRlZClcbiAgICBjb25zdCBxdWVyeVNwYW5zOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IHVwc2VydFNwYW5zLmZsYXRNYXAoKHVwc2VydCwgaSkgPT4gW1xuICAgICAge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknIGFzIGNvbnN0LFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBxdWVyeS0ke2l9YCxcbiAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1cHNlcnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ3N0YW5kaW5nLnVwc2VydCcsXG4gICAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycgYXMgY29uc3QsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgZW50aXR5TmFtZTogJ3N0YW5kaW5nJyxcbiAgICAgICAgZGF0YToge30sXG4gICAgICB9IGFzIE9ic2VydmFiaWxpdHlFdmVudCxcbiAgICBdKTtcblxuICAgIGNvbnN0IGFsbEV2ZW50cyA9IFsgcGVyc2lzdGVuY2VTcGFuLCAuLi51cHNlcnRTcGFucywgLi4ucXVlcnlTcGFucyBdO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYWxsRXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCfk4ogUkVTVUxUIFNVTU1BUlk6Jyk7XG4gICAgY29uc29sZS5sb2coJ1RvdGFsIGlucHV0IGV2ZW50czonLCBhbGxFdmVudHMubGVuZ3RoKTtcbiAgICBjb25zb2xlLmxvZygnVG90YWwgb3V0cHV0IGV2ZW50czonLCByZXN1bHQuZXZlbnRzLmxlbmd0aCk7XG4gICAgY29uc29sZS5sb2coJ0FnZ3JlZ2F0ZWQ6JywgcmVzdWx0LnN0YXRzLmFnZ3JlZ2F0ZWQpO1xuICAgIGNvbnNvbGUubG9nKCdLZXB0OicsIHJlc3VsdC5zdGF0cy5rZXB0KTtcbiAgICBjb25zb2xlLmxvZygnXFxuT3V0cHV0IGV2ZW50IG9wZXJhdGlvbnM6Jyk7XG4gICAgcmVzdWx0LmV2ZW50cy5mb3JFYWNoKGUgPT4ge1xuICAgICAgY29uc29sZS5sb2coYCAgLSAke2Uub3BlcmF0aW9ufSAoJHtlLm9ic2VydmFiaWxpdHlMb2dJZH0pYCk7XG4gICAgICBpZiAoKGUuZGF0YSBhcyBhbnkpPy5ub2lzZVJlZHVjdGlvbj8uYWdncmVnYXRlcykge1xuICAgICAgICBjb25zdCBhZ2dzID0gKGUuZGF0YSBhcyBhbnkpLm5vaXNlUmVkdWN0aW9uLmFnZ3JlZ2F0ZXM7XG4gICAgICAgIGNvbnNvbGUubG9nKCcgICAg4pyFIEhhcyBhZ2dyZWdhdGVzOicsIE9iamVjdC5rZXlzKGFnZ3MpLm1hcChrID0+IGAke2t9KCR7YWdnc1sgayBdLmNvdW50fSlgKS5qb2luKCcsICcpKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEFTU0VSVElPTlNcblxuICAgIC8vIFZFUklGWTogT25seSBwZXJzaXN0ZW5jZSBzcGFuIGluIG91dHB1dFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgxKTtcblxuICAgIGNvbnN0IHBlcnNpc3RlbmNlSW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzWyAwIF07XG4gICAgZXhwZWN0KHBlcnNpc3RlbmNlSW5PdXRwdXQub2JzZXJ2YWJpbGl0eUxvZ0lkKS50b0JlKCdwZXJzaXN0ZW5jZS1wYXJlbnQnKTtcbiAgICBleHBlY3QocGVyc2lzdGVuY2VJbk91dHB1dC5vcGVyYXRpb24pLnRvQmUoJ3Nwb3J0cy5wZXJzaXN0ZW5jZScpO1xuICAgIGV4cGVjdChwZXJzaXN0ZW5jZUluT3V0cHV0LnNvdXJjZSkudG9CZSgnc2VydmljZTpTcG9ydHNQZXJzaXN0ZW5jZVNlcnZpY2UucGVyc2lzdEVudGl0aWVzJyk7XG5cbiAgICAvLyBWRVJJRlk6IEFnZ3JlZ2F0ZXMgc3RydWN0dXJlXG4gICAgY29uc3QgYWdncmVnYXRlcyA9IChwZXJzaXN0ZW5jZUluT3V0cHV0LmRhdGEgYXMgYW55KT8ubm9pc2VSZWR1Y3Rpb24/LmFnZ3JlZ2F0ZXM7XG4gICAgZXhwZWN0KGFnZ3JlZ2F0ZXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGFnZ3JlZ2F0ZXNbICdzcGFuOkJhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydCcgXSkudG9FcXVhbCh7XG4gICAgICBjb3VudDogMjQsXG4gICAgICBlcnJvckNvdW50OiAwLFxuICAgICAgZHVyYXRpb25TdW1NczogZXhwZWN0LmFueShOdW1iZXIpLFxuICAgICAgZHVyYXRpb25NYXhNczogZXhwZWN0LmFueShOdW1iZXIpLFxuICAgICAgZXhhbXBsZXM6IFtdLFxuICAgICAgZXJyb3JFeGFtcGxlczogW10sXG4gICAgICBydWxlczogeyAnZncyNC5ob3RwYXRocy5lbnRpdHkuYWdncmVnYXRlX3Vwc2VydF9zcGFucyc6IDI0IH1cbiAgICB9KTtcbiAgICBjb25zb2xlLmxvZygnXFxu4pyFIFBlcnNpc3RlbmNlIHNwYW4ga2VwdCB3aXRoIGFnZ3JlZ2F0ZXMnKTtcblxuICAgIC8vIFZFUklGWTogRXhhY3Qgc3RhdHNcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmUoMjQpOyAvLyBFeGFjdGx5IDI0IHVwc2VydCBzcGFucyArIDI0IHF1ZXJ5IHNwYW5zXG4gICAgY29uc29sZS5sb2coJ+KchSBTdGF0cyBzaG93IGNvcnJlY3QgYWdncmVnYXRpb24gY291bnQnKTtcblxuICAgIC8vIDUuIEFsbCBrZXB0IGV2ZW50cyBzaG91bGQgaGF2ZSB2YWxpZCBzdHJ1Y3R1cmVcbiAgICBjb25zb2xlLmxvZygn4pyFIEFsbCBldmVudHMgcHJvcGVybHkgc3RydWN0dXJlZCcpO1xuICB9KTtcbn0pO1xuIl19