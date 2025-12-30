"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
describe('Verify Fix: Comprehensive scenarios for parent drop behavior', () => {
    const config = (0, config_1.createObservabilityConfig)({
        enabled: true,
        noiseReduction: {
            enabled: true,
            presets: ['fw24.hotpaths'],
            emitSummaries: true,
            includeDebugMetadata: true,
        },
    });
    it('SCENARIO 1: Parent GET + ALL children dropped → Parent SHOULD be dropped', () => {
        const parent = {
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
        const child = {
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
        const result = (0, index_1.applyNoiseReduction)([parent, child], config.noiseReduction);
        // EXPECTED: Both dropped (parent has NO kept children)
        expect(result.events.length).toBe(0);
        expect(result.stats.dropped).toBe(2);
        console.log('✅ SCENARIO 1 PASS: Parent with only dropped children is dropped');
    });
    it('SCENARIO 2: Parent GET + some children kept → Parent MUST be kept', () => {
        const parent = {
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
        const droppedChild = {
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
        const keptChild = {
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
        const result = (0, index_1.applyNoiseReduction)([parent, droppedChild, keptChild], config.noiseReduction);
        // EXPECTED: Parent kept (has kept child), dropped child dropped, kept child kept
        const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent');
        const keptChildInOutput = result.events.find(e => e.observabilityLogId === 'kept-child');
        expect(parentInOutput).toBeDefined();
        expect(keptChildInOutput).toBeDefined();
        expect(parentInOutput?.data?.noiseReduction?.forcedKeep).toBe(true);
        console.log('✅ SCENARIO 2 PASS: Parent with kept child is kept for hierarchy');
    });
    it('SCENARIO 3: Nested hierarchy - grandchild kept → child & parent MUST be kept', () => {
        const grandparent = {
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
        const parent = {
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
        const grandchild = {
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
        const result = (0, index_1.applyNoiseReduction)([grandparent, parent, grandchild], config.noiseReduction);
        // EXPECTED: All kept (transitive closure)
        // grandchild kept → parent kept → grandparent kept
        const grandparentOut = result.events.find(e => e.observabilityLogId === 'grandparent');
        const parentOut = result.events.find(e => e.observabilityLogId === 'parent');
        const grandchildOut = result.events.find(e => e.observabilityLogId === 'grandchild');
        expect(grandchildOut).toBeDefined();
        expect(parentOut).toBeDefined();
        expect(grandparentOut).toBeDefined();
        expect(grandparentOut?.data?.noiseReduction?.forcedKeep).toBe(true);
        expect(parentOut?.data?.noiseReduction?.forcedKeep).toBe(true);
        console.log('✅ SCENARIO 3 PASS: Transitive closure keeps entire hierarchy');
    });
    it('SCENARIO 4: Parent with aggregated children (no drop rule) → Parent kept with aggregates', () => {
        const parent = {
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
            type: 'span',
            observabilityLogId: `child-${i}`,
            parentObservabilityLogId: 'parent',
            correlationId: 'test',
            operation: 'BaseEntityService.upsert',
            source: 'service:BaseEntityService.upsert', // Must match pattern /^service:BaseEntityService\./
            level: 'debug',
            timestampMs: Date.now(),
            durationMs: 50,
            success: true,
            status: 'completed',
            data: {},
        }));
        const result = (0, index_1.applyNoiseReduction)([parent, ...children], config.noiseReduction);
        // EXPECTED: Parent kept with aggregates, children aggregated
        const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent');
        expect(parentInOutput).toBeDefined();
        expect(parentInOutput?.data?.noiseReduction?.aggregates).toBeDefined();
        expect(result.stats.aggregated).toBe(5);
        console.log('✅ SCENARIO 4 PASS: Parent kept with aggregate summaries');
    });
    it('SCENARIO 5: YOUR EXACT CASE - Parent GET with folded child metrics', () => {
        const parent = {
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
        const child = {
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
        const result = (0, index_1.applyNoiseReduction)([parent, child], config.noiseReduction);
        // EXPECTED: BOTH DROPPED (your desired behavior)
        // Child matches drop rule → dropped
        // Parent matches drop rule + has NO kept children → dropped
        expect(result.events.length).toBe(0);
        expect(result.stats.dropped).toBe(2);
        console.log('✅ SCENARIO 5 PASS: Your exact case - parent GET with only dropped children is now dropped');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVyaWZ5LWZpeC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvbm9pc2UtcmVkdWN0aW9uL19fdGVzdHNfXy92ZXJpZnktZml4LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxvQ0FBK0M7QUFDL0MseUNBQXlEO0FBR3pELFFBQVEsQ0FBQyw4REFBOEQsRUFBRSxHQUFHLEVBQUU7SUFFNUUsTUFBTSxNQUFNLEdBQUcsSUFBQSxrQ0FBeUIsRUFBQztRQUN2QyxPQUFPLEVBQUUsSUFBSTtRQUNiLGNBQWMsRUFBRTtZQUNkLE9BQU8sRUFBRSxJQUFJO1lBQ2IsT0FBTyxFQUFFLENBQUUsZUFBZSxDQUFFO1lBQzVCLGFBQWEsRUFBRSxJQUFJO1lBQ25CLG9CQUFvQixFQUFFLElBQUk7U0FDM0I7S0FDRixDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsMEVBQTBFLEVBQUUsR0FBRyxFQUFFO1FBQ2xGLE1BQU0sTUFBTSxHQUF1QjtZQUNqQyxJQUFJLEVBQUUsTUFBTTtZQUNaLGtCQUFrQixFQUFFLFFBQVE7WUFDNUIsd0JBQXdCLEVBQUUsU0FBUztZQUNuQyxhQUFhLEVBQUUsTUFBTTtZQUNyQixTQUFTLEVBQUUsZ0JBQWdCO1lBQzNCLE1BQU0sRUFBRSxpQkFBaUI7WUFDekIsS0FBSyxFQUFFLE1BQU07WUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUN2QixVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxJQUFJO1lBQ2IsTUFBTSxFQUFFLFdBQVc7WUFDbkIsSUFBSSxFQUFFLEVBQUU7U0FDVCxDQUFDO1FBRUYsTUFBTSxLQUFLLEdBQXVCO1lBQ2hDLElBQUksRUFBRSxNQUFNO1lBQ1osa0JBQWtCLEVBQUUsT0FBTztZQUMzQix3QkFBd0IsRUFBRSxRQUFRO1lBQ2xDLGFBQWEsRUFBRSxNQUFNO1lBQ3JCLFNBQVMsRUFBRSx3QkFBd0I7WUFD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QXdCO1lBQ25DLE1BQU0sRUFBRSwyQkFBMkI7WUFDbkMsS0FBSyxFQUFFLE9BQU87WUFDZCxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUN2QixVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxJQUFJO1lBQ2IsTUFBTSxFQUFFLFdBQVc7WUFDbkIsSUFBSSxFQUFFLEVBQUU7WUFDUixPQUFPLEVBQUUsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFO1NBQzdCLENBQUM7UUFFRixNQUFNLE1BQU0sR0FBRyxJQUFBLDJCQUFtQixFQUFDLENBQUUsTUFBTSxFQUFFLEtBQUssQ0FBRSxFQUFFLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUU3RSxpREFBaUQ7UUFDakQsb0NBQW9DO1FBQ3BDLDREQUE0RDtRQUM1RCxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDckMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3JDLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkZBQTJGLENBQUMsQ0FBQztJQUMzRyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4uL2luZGV4JztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi8uLi9jb25maWcnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUV2ZW50IH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG5kZXNjcmliZSgnVmVyaWZ5IEZpeDogQ29tcHJlaGVuc2l2ZSBzY2VuYXJpb3MgZm9yIHBhcmVudCBkcm9wIGJlaGF2aW9yJywgKCkgPT4ge1xuXG4gIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICAgIH0sXG4gIH0pO1xuXG4gIGl0KCdTQ0VOQVJJTyAxOiBQYXJlbnQgR0VUICsgQUxMIGNoaWxkcmVuIGRyb3BwZWQg4oaSIFBhcmVudCBTSE9VTEQgYmUgZHJvcHBlZCcsICgpID0+IHtcbiAgICBjb25zdCBwYXJlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHVuZGVmaW5lZCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9saXN0JyxcbiAgICAgIHNvdXJjZTogJ0NvbnRyb2xsZXIubGlzdCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLmxpc3QnLFxuICAgICAgc291cmNlOiAnc2VydmljZTpCYXNlRW50aXR5U2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcGFyZW50LCBjaGlsZCBdLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgLy8gRVhQRUNURUQ6IEJvdGggZHJvcHBlZCAocGFyZW50IGhhcyBOTyBrZXB0IGNoaWxkcmVuKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmxlbmd0aCkudG9CZSgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLmRyb3BwZWQpLnRvQmUoMik7XG4gICAgY29uc29sZS5sb2coJ+KchSBTQ0VOQVJJTyAxIFBBU1M6IFBhcmVudCB3aXRoIG9ubHkgZHJvcHBlZCBjaGlsZHJlbiBpcyBkcm9wcGVkJyk7XG4gIH0pO1xuXG4gIGl0KCdTQ0VOQVJJTyAyOiBQYXJlbnQgR0VUICsgc29tZSBjaGlsZHJlbiBrZXB0IOKGkiBQYXJlbnQgTVVTVCBiZSBrZXB0JywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2xpc3QnLFxuICAgICAgc291cmNlOiAnQ29udHJvbGxlci5saXN0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGRyb3BwZWRDaGlsZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZHJvcHBlZC1jaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnQmFzZUVudGl0eVNlcnZpY2UubGlzdCcsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGtlcHRDaGlsZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdrZXB0LWNoaWxkJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdzb21ldGhpbmcnLFxuICAgICAgc291cmNlOiAnc2VydmljZScsXG4gICAgICBsZXZlbDogJ3dhcm4nLCAvLyBXQVJOIGxvZ3MgYXJlIGtlcHRcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBwYXJlbnQsIGRyb3BwZWRDaGlsZCwga2VwdENoaWxkIF0sIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICAvLyBFWFBFQ1RFRDogUGFyZW50IGtlcHQgKGhhcyBrZXB0IGNoaWxkKSwgZHJvcHBlZCBjaGlsZCBkcm9wcGVkLCBrZXB0IGNoaWxkIGtlcHRcbiAgICBjb25zdCBwYXJlbnRJbk91dHB1dCA9IHJlc3VsdC5ldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50Jyk7XG4gICAgY29uc3Qga2VwdENoaWxkSW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2tlcHQtY2hpbGQnKTtcblxuICAgIGV4cGVjdChwYXJlbnRJbk91dHB1dCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qoa2VwdENoaWxkSW5PdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KChwYXJlbnRJbk91dHB1dD8uZGF0YSBhcyBhbnkpPy5ub2lzZVJlZHVjdGlvbj8uZm9yY2VkS2VlcCkudG9CZSh0cnVlKTtcbiAgICBjb25zb2xlLmxvZygn4pyFIFNDRU5BUklPIDIgUEFTUzogUGFyZW50IHdpdGgga2VwdCBjaGlsZCBpcyBrZXB0IGZvciBoaWVyYXJjaHknKTtcbiAgfSk7XG5cbiAgaXQoJ1NDRU5BUklPIDM6IE5lc3RlZCBoaWVyYXJjaHkgLSBncmFuZGNoaWxkIGtlcHQg4oaSIGNoaWxkICYgcGFyZW50IE1VU1QgYmUga2VwdCcsICgpID0+IHtcbiAgICBjb25zdCBncmFuZHBhcmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ3JhbmRwYXJlbnQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvbGlzdCcsXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyLmxpc3QnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMjAwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgY29uc3QgcGFyZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ3JhbmRwYXJlbnQnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnQmFzZUVudGl0eVNlcnZpY2UubGlzdCcsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlJyxcbiAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiAxNTAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBncmFuZGNoaWxkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2dyYW5kY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ3F1ZXJ5JyxcbiAgICAgIHNvdXJjZTogJ2RhdGFiYXNlJyxcbiAgICAgIGxldmVsOiAnd2FybicsIC8vIEtlcHRcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBncmFuZHBhcmVudCwgcGFyZW50LCBncmFuZGNoaWxkIF0sIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICAvLyBFWFBFQ1RFRDogQWxsIGtlcHQgKHRyYW5zaXRpdmUgY2xvc3VyZSlcbiAgICAvLyBncmFuZGNoaWxkIGtlcHQg4oaSIHBhcmVudCBrZXB0IOKGkiBncmFuZHBhcmVudCBrZXB0XG4gICAgY29uc3QgZ3JhbmRwYXJlbnRPdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2dyYW5kcGFyZW50Jyk7XG4gICAgY29uc3QgcGFyZW50T3V0ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQnKTtcbiAgICBjb25zdCBncmFuZGNoaWxkT3V0ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdncmFuZGNoaWxkJyk7XG5cbiAgICBleHBlY3QoZ3JhbmRjaGlsZE91dCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QocGFyZW50T3V0KS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChncmFuZHBhcmVudE91dCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoKGdyYW5kcGFyZW50T3V0Py5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5mb3JjZWRLZWVwKS50b0JlKHRydWUpO1xuICAgIGV4cGVjdCgocGFyZW50T3V0Py5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5mb3JjZWRLZWVwKS50b0JlKHRydWUpO1xuICAgIGNvbnNvbGUubG9nKCfinIUgU0NFTkFSSU8gMyBQQVNTOiBUcmFuc2l0aXZlIGNsb3N1cmUga2VlcHMgZW50aXJlIGhpZXJhcmNoeScpO1xuICB9KTtcblxuICBpdCgnU0NFTkFSSU8gNDogUGFyZW50IHdpdGggYWdncmVnYXRlZCBjaGlsZHJlbiAobm8gZHJvcCBydWxlKSDihpIgUGFyZW50IGtlcHQgd2l0aCBhZ2dyZWdhdGVzJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBQT1NUIC9iYXRjaC11cHNlcnQnLCAvLyBQT1NUIGRvZXNuJ3QgbWF0Y2ggZHJvcCBydWxlXG4gICAgICBzb3VyY2U6ICdDb250cm9sbGVyLmJhdGNoVXBzZXJ0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkcmVuID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNSB9LCAoXywgaSkgPT4gKHtcbiAgICAgIHR5cGU6ICdzcGFuJyBhcyBjb25zdCxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogYGNoaWxkLSR7aX1gLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydCcsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydCcsIC8vIE11c3QgbWF0Y2ggcGF0dGVybiAvXnNlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2VcXC4vXG4gICAgICBsZXZlbDogJ2RlYnVnJyBhcyBjb25zdCxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyBhcyBjb25zdCxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH0pKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBwYXJlbnQsIC4uLmNoaWxkcmVuIF0sIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG5cbiAgICAvLyBFWFBFQ1RFRDogUGFyZW50IGtlcHQgd2l0aCBhZ2dyZWdhdGVzLCBjaGlsZHJlbiBhZ2dyZWdhdGVkXG4gICAgY29uc3QgcGFyZW50SW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudCcpO1xuXG4gICAgZXhwZWN0KHBhcmVudEluT3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdCgocGFyZW50SW5PdXRwdXQ/LmRhdGEgYXMgYW55KT8ubm9pc2VSZWR1Y3Rpb24/LmFnZ3JlZ2F0ZXMpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5hZ2dyZWdhdGVkKS50b0JlKDUpO1xuICAgIGNvbnNvbGUubG9nKCfinIUgU0NFTkFSSU8gNCBQQVNTOiBQYXJlbnQga2VwdCB3aXRoIGFnZ3JlZ2F0ZSBzdW1tYXJpZXMnKTtcbiAgfSk7XG5cbiAgaXQoJ1NDRU5BUklPIDU6IFlPVVIgRVhBQ1QgQ0FTRSAtIFBhcmVudCBHRVQgd2l0aCBmb2xkZWQgY2hpbGQgbWV0cmljcycsICgpID0+IHtcbiAgICBjb25zdCBwYXJlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudC0xMjMnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiB1bmRlZmluZWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYWRtaW4vdGVhbWludGVncmF0aW9uY29uZmlnJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluVGVhbUludGVncmF0aW9uQ29uZmlnQ29udHJvbGxlci5saXN0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQyMCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC00NTYnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50LTEyMycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBvcGVyYXRpb246ICdCYXNlRW50aXR5U2VydmljZS5saXN0JyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDI2MCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgICBtZXRyaWNzOiB7IHJlc3VsdENvdW50OiAxMCB9LFxuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcGFyZW50LCBjaGlsZCBdLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgLy8gRVhQRUNURUQ6IEJPVEggRFJPUFBFRCAoeW91ciBkZXNpcmVkIGJlaGF2aW9yKVxuICAgIC8vIENoaWxkIG1hdGNoZXMgZHJvcCBydWxlIOKGkiBkcm9wcGVkXG4gICAgLy8gUGFyZW50IG1hdGNoZXMgZHJvcCBydWxlICsgaGFzIE5PIGtlcHQgY2hpbGRyZW4g4oaSIGRyb3BwZWRcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5sZW5ndGgpLnRvQmUoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5kcm9wcGVkKS50b0JlKDIpO1xuICAgIGNvbnNvbGUubG9nKCfinIUgU0NFTkFSSU8gNSBQQVNTOiBZb3VyIGV4YWN0IGNhc2UgLSBwYXJlbnQgR0VUIHdpdGggb25seSBkcm9wcGVkIGNoaWxkcmVuIGlzIG5vdyBkcm9wcGVkJyk7XG4gIH0pO1xufSk7XG4iXX0=