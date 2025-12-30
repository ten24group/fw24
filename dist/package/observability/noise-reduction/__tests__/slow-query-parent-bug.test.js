"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
describe('Slow query with dropped parent span', () => {
    const config = (0, config_1.createObservabilityConfig)({
        enabled: true,
        noiseReduction: {
            enabled: true,
            presets: ['fw24.hotpaths'],
            emitSummaries: true,
            includeDebugMetadata: true,
        },
    });
    it('should force-keep parent when slow query child is kept (hard signal)', () => {
        // Parent: fast successful list operation (matches drop rule)
        const listSpan = {
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
        const slowQuery = {
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
        const result = (0, index_1.applyNoiseReduction)([listSpan, slowQuery], config.noiseReduction);
        console.log('\n📊 RESULT:');
        console.log('Input: 2 events (list span + slow query)');
        console.log('Output:', result.events.length, 'events');
        result.events.forEach(e => {
            console.log(`  - ${e.operation} (${e.observabilityLogId})`);
            if (e.data?.noiseReduction?.forcedKeep) {
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
        expect(parentInOutput?.data?.noiseReduction?.forcedKeep).toBe(true);
        console.log('✅ Parent has forcedKeep=true (correct!)');
        // 4. Both events should be in output
        expect(result.events.length).toBe(2);
        console.log('✅ Both events in output');
    });
    it('should NOT force-keep parent when all children are aggregated (no hard signals)', () => {
        // Parent: fast successful list operation
        const listSpan = {
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
        const fastQuery = {
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
        const result = (0, index_1.applyNoiseReduction)([listSpan, fastQuery], config.noiseReduction);
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
        const querySpan = {
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
        const scanQuery = {
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
        const result = (0, index_1.applyNoiseReduction)([querySpan, scanQuery], config.noiseReduction);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2xvdy1xdWVyeS1wYXJlbnQtYnVnLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL3Nsb3ctcXVlcnktcGFyZW50LWJ1Zy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsb0NBQStDO0FBQy9DLHlDQUF5RDtBQUd6RCxRQUFRLENBQUMscUNBQXFDLEVBQUUsR0FBRyxFQUFFO0lBQ25ELE1BQU0sTUFBTSxHQUFHLElBQUEsa0NBQXlCLEVBQUM7UUFDdkMsT0FBTyxFQUFFLElBQUk7UUFDYixjQUFjLEVBQUU7WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLE9BQU8sRUFBRSxDQUFFLGVBQWUsQ0FBRTtZQUM1QixhQUFhLEVBQUUsSUFBSTtZQUNuQixvQkFBb0IsRUFBRSxJQUFJO1NBQzNCO0tBQ0YsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHNFQUFzRSxFQUFFLEdBQUcsRUFBRTtRQUM5RSw2REFBNkQ7UUFDN0QsTUFBTSxRQUFRLEdBQXVCO1lBQ25DLElBQUksRUFBRSxNQUFNO1lBQ1osa0JBQWtCLEVBQUUsYUFBYTtZQUNqQyx3QkFBd0IsRUFBRSxpQkFBaUI7WUFDM0MsYUFBYSxFQUFFLE1BQU07WUFDckIsU0FBUyxFQUFFLHdCQUF3QjtZQUNuQyxNQUFNLEVBQUUsZ0NBQWdDO1lBQ3hDLEtBQUssRUFBRSxPQUFPO1lBQ2QsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDdkIsVUFBVSxFQUFFLEVBQUUsRUFBRSxPQUFPO1lBQ3ZCLE9BQU8sRUFBRSxJQUFJO1lBQ2IsTUFBTSxFQUFFLFdBQVc7WUFDbkIsSUFBSSxFQUFFLEVBQUU7U0FDVCxDQUFDO1FBRUYsMERBQTBEO1FBQzFELE1BQU0sU0FBUyxHQUF1QjtZQUNwQyxJQUFJLEVBQUUsZ0JBQWdCO1lBQ3RCLGtCQUFrQixFQUFFLFlBQVk7WUFDaEMs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Q25DLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLENBQUMsQ0FBQztRQUU3RCwrQkFBK0I7UUFDL0IsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLEtBQUssY0FBYyxDQUFDLENBQUM7UUFDeEYsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUNBQW1DLENBQUMsQ0FBQztJQUNuRCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4uL2luZGV4JztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi8uLi9jb25maWcnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG5kZXNjcmliZSgnU2xvdyBxdWVyeSB3aXRoIGRyb3BwZWQgcGFyZW50IHNwYW4nLCAoKSA9PiB7XG4gIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICAgIH0sXG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgZm9yY2Uta2VlcCBwYXJlbnQgd2hlbiBzbG93IHF1ZXJ5IGNoaWxkIGlzIGtlcHQgKGhhcmQgc2lnbmFsKScsICgpID0+IHtcbiAgICAvLyBQYXJlbnQ6IGZhc3Qgc3VjY2Vzc2Z1bCBsaXN0IG9wZXJhdGlvbiAobWF0Y2hlcyBkcm9wIHJ1bGUpXG4gICAgY29uc3QgbGlzdFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xpc3QtcGFyZW50JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2NvbnRyb2xsZXItcm9vdCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdCYXNlRW50aXR5U2VydmljZS5saXN0JyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UubGlzdCcsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNDUsIC8vIEZhc3RcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIC8vIENoaWxkOiBTTE9XIGRhdGFiYXNlIHF1ZXJ5IChoYXJkIHNpZ25hbCAtIG11c3QgYmUga2VwdClcbiAgICBjb25zdCBzbG93UXVlcnk6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93LXF1ZXJ5JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2xpc3QtcGFyZW50JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ29ic2VydmFiaWxpdHlMb2cubGlzdCcsXG4gICAgICBzb3VyY2U6ICdkYXRhYmFzZScsXG4gICAgICBsZXZlbDogJ3dhcm4nLCAvLyBTTE9XIHF1ZXJ5IC0gaGFyZCBzaWduYWxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMjUwMCwgLy8gVmVyeSBzbG93IVxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWU6ICdvYnNlcnZhYmlsaXR5TG9nJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgICAgbWV0cmljczogeyBkdXJhdGlvbk1zOiAyNTAwLCB0aHJlc2hvbGQ6IDEwMDAgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGxpc3RTcGFuLCBzbG93UXVlcnkgXSwgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG7wn5OKIFJFU1VMVDonKTtcbiAgICBjb25zb2xlLmxvZygnSW5wdXQ6IDIgZXZlbnRzIChsaXN0IHNwYW4gKyBzbG93IHF1ZXJ5KScpO1xuICAgIGNvbnNvbGUubG9nKCdPdXRwdXQ6JywgcmVzdWx0LmV2ZW50cy5sZW5ndGgsICdldmVudHMnKTtcbiAgICByZXN1bHQuZXZlbnRzLmZvckVhY2goZSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICAtICR7ZS5vcGVyYXRpb259ICgke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSlgKTtcbiAgICAgIGlmICgoZS5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5mb3JjZWRLZWVwKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCcgICAg4pqg77iPICBmb3JjZWRLZWVwOiB0cnVlJyk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBBU1NFUlRJT05TXG5cbiAgICAvLyAxLiBTbG93IHF1ZXJ5IE1VU1QgYmUgaW4gb3V0cHV0IChoYXJkIHNpZ25hbClcbiAgICBjb25zdCBxdWVyeUluT3V0cHV0ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzbG93LXF1ZXJ5Jyk7XG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgY29uc29sZS5sb2coJ1xcbuKchSBTbG93IHF1ZXJ5IGtlcHQgKGhhcmQgc2lnbmFsIHByb3RlY3Rpb24pJyk7XG5cbiAgICAvLyAyLiBQYXJlbnQgc3BhbiBNVVNUIGJlIGZvcmNlLWtlcHQgZm9yIGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCBwYXJlbnRJbk91dHB1dCA9IHJlc3VsdC5ldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbGlzdC1wYXJlbnQnKTtcbiAgICBleHBlY3QocGFyZW50SW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgY29uc29sZS5sb2coJ+KchSBQYXJlbnQgc3BhbiBmb3JjZS1rZXB0IGZvciBoaWVyYXJjaHknKTtcblxuICAgIC8vIDMuIFBhcmVudCBzaG91bGQgaGF2ZSBmb3JjZWRLZWVwIGZsYWdcbiAgICBleHBlY3QoKHBhcmVudEluT3V0cHV0Py5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5mb3JjZWRLZWVwKS50b0JlKHRydWUpO1xuICAgIGNvbnNvbGUubG9nKCfinIUgUGFyZW50IGhhcyBmb3JjZWRLZWVwPXRydWUgKGNvcnJlY3QhKScpO1xuXG4gICAgLy8gNC4gQm90aCBldmVudHMgc2hvdWxkIGJlIGluIG91dHB1dFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBjb25zb2xlLmxvZygn4pyFIEJvdGggZXZlbnRzIGluIG91dHB1dCcpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIE5PVCBmb3JjZS1rZWVwIHBhcmVudCB3aGVuIGFsbCBjaGlsZHJlbiBhcmUgYWdncmVnYXRlZCAobm8gaGFyZCBzaWduYWxzKScsICgpID0+IHtcbiAgICAvLyBQYXJlbnQ6IGZhc3Qgc3VjY2Vzc2Z1bCBsaXN0IG9wZXJhdGlvblxuICAgIGNvbnN0IGxpc3RTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdsaXN0LXBhcmVudCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdjb250cm9sbGVyLXJvb3QnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnQmFzZUVudGl0eVNlcnZpY2UubGlzdCcsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlLmxpc3QnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQ1LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgLy8gQ2hpbGQ6IEZBU1QgZGF0YWJhc2UgcXVlcnkgKG5vIGhhcmQgc2lnbmFsIC0gc2hvdWxkIGJlIGFnZ3JlZ2F0ZWQvZm9sZGVkKVxuICAgIGNvbnN0IGZhc3RRdWVyeTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Zhc3QtcXVlcnknLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbGlzdC1wYXJlbnQnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eUxvZy5saXN0JyxcbiAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLCAvLyBGYXN0IHF1ZXJ5XG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwLCAvLyBGYXN0XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZW50aXR5TmFtZTogJ29ic2VydmFiaWxpdHlMb2cnLFxuICAgICAgZGF0YToge30sXG4gICAgICBtZXRyaWNzOiB7IGR1cmF0aW9uTXM6IDUwLCB0aHJlc2hvbGQ6IDEwMDAgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGxpc3RTcGFuLCBmYXN0UXVlcnkgXSwgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG7wn5OKIFJFU1VMVDonKTtcbiAgICBjb25zb2xlLmxvZygnSW5wdXQ6IDIgZXZlbnRzIChsaXN0IHNwYW4gKyBmYXN0IHF1ZXJ5KScpO1xuICAgIGNvbnNvbGUubG9nKCdPdXRwdXQ6JywgcmVzdWx0LmV2ZW50cy5sZW5ndGgsICdldmVudHMnKTtcbiAgICByZXN1bHQuZXZlbnRzLmZvckVhY2goZSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICAtICR7ZS5vcGVyYXRpb259ICgke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSlgKTtcbiAgICB9KTtcblxuICAgIC8vIEFTU0VSVElPTlNcblxuICAgIC8vIEJvdGggc2hvdWxkIGJlIGRyb3BwZWQvZm9sZGVkIChubyBoYXJkIHNpZ25hbHMpXG4gICAgY29uc3QgcGFyZW50SW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2xpc3QtcGFyZW50Jyk7XG4gICAgY29uc3QgcXVlcnlJbk91dHB1dCA9IHJlc3VsdC5ldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZmFzdC1xdWVyeScpO1xuXG4gICAgZXhwZWN0KHBhcmVudEluT3V0cHV0KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHF1ZXJ5SW5PdXRwdXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBjb25zb2xlLmxvZygnXFxu4pyFIEJvdGggZHJvcHBlZCAobm8gaGFyZCBzaWduYWxzLCBubyBmb3JjZS1rZWVwKScpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGhhbmRsZSBzY2FuIHF1ZXJ5IChhbHdheXMgd2FybiBsZXZlbCkgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgIC8vIFBhcmVudDogcXVlcnkgb3BlcmF0aW9uXG4gICAgY29uc3QgcXVlcnlTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdxdWVyeS1wYXJlbnQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY29udHJvbGxlci1yb290JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLnF1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UucXVlcnknLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIC8vIENoaWxkOiBTQ0FOIHF1ZXJ5IChhbHdheXMgd2FybiAtIGV4cGVuc2l2ZSBvcGVyYXRpb24pXG4gICAgY29uc3Qgc2NhblF1ZXJ5OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc2Nhbi1xdWVyeScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdxdWVyeS1wYXJlbnQnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnZW50aXR5LnNjYW4nLFxuICAgICAgc291cmNlOiAnZGF0YWJhc2UnLFxuICAgICAgbGV2ZWw6ICd3YXJuJywgLy8gU2NhbnMgYXJlIGFsd2F5cyB3YXJuaW5nc1xuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxNTAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGVudGl0eU5hbWU6ICdlbnRpdHknLFxuICAgICAgZGF0YToge30sXG4gICAgICBtZXRyaWNzOiB7IGR1cmF0aW9uTXM6IDE1MDAsIHRocmVzaG9sZDogMzAwMCB9LFxuICAgICAgdGFnczogeyBzY2FuOiAndHJ1ZScgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHF1ZXJ5U3Bhbiwgc2NhblF1ZXJ5IF0sIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+TiiBSRVNVTFQ6Jyk7XG4gICAgY29uc29sZS5sb2coJ0lucHV0OiAyIGV2ZW50cyAocXVlcnkgc3BhbiArIHNjYW4pJyk7XG4gICAgY29uc29sZS5sb2coJ091dHB1dDonLCByZXN1bHQuZXZlbnRzLmxlbmd0aCwgJ2V2ZW50cycpO1xuICAgIHJlc3VsdC5ldmVudHMuZm9yRWFjaChlID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKGAgIC0gJHtlLm9wZXJhdGlvbn0gKCR7ZS5vYnNlcnZhYmlsaXR5TG9nSWR9KWApO1xuICAgIH0pO1xuXG4gICAgLy8gQVNTRVJUSU9OU1xuXG4gICAgLy8gMS4gU2NhbiBNVVNUIGJlIGtlcHQgKGhhcmQgc2lnbmFsIC0gd2FybiBsZXZlbClcbiAgICBjb25zdCBzY2FuSW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3NjYW4tcXVlcnknKTtcbiAgICBleHBlY3Qoc2NhbkluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIGNvbnNvbGUubG9nKCdcXG7inIUgU2NhbiBxdWVyeSBrZXB0IChoYXJkIHNpZ25hbDogd2FybiBsZXZlbCknKTtcblxuICAgIC8vIDIuIFBhcmVudCBNVVNUIGJlIGZvcmNlLWtlcHRcbiAgICBjb25zdCBwYXJlbnRJbk91dHB1dCA9IHJlc3VsdC5ldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncXVlcnktcGFyZW50Jyk7XG4gICAgZXhwZWN0KHBhcmVudEluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIGNvbnNvbGUubG9nKCfinIUgUGFyZW50IGZvcmNlLWtlcHQgZm9yIGhpZXJhcmNoeScpO1xuICB9KTtcbn0pO1xuIl19