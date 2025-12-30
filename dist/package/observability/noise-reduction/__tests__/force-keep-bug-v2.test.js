"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
describe('Force-Keep Bug V2: Test with MULTIPLE children where some are kept', () => {
    it('Parent GET span with multiple children - some dropped, some kept', () => {
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            noiseReduction: {
                enabled: true,
                presets: ['fw24.hotpaths'],
                emitSummaries: true,
                includeDebugMetadata: true,
            },
        });
        // Parent span: Controller GET operation
        const parentSpan = {
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
        const child1 = {
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
        const child2 = {
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
        const events = [parentSpan, child1, child2];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO: Parent with mixed children (some dropped, some kept)');
        console.log('  Output events:', result.events.length);
        console.log('  Dropped:', result.stats.dropped);
        console.log('  Kept:', result.stats.kept);
        result.events.forEach((e, i) => {
            console.log(`  [${i}] ${e.type}: ${e.operation} (${e.observabilityLogId})`);
            if (e.type === 'span' && e.data?.noiseReduction) {
                console.log('      noiseReduction:', JSON.stringify(e.data.noiseReduction, null, 8));
            }
        });
        const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent-123');
        // IN THIS CASE: Parent SHOULD be kept because child2 (log) is kept
        // The parent needs to exist to maintain hierarchy
        expect(parentInOutput).toBeDefined();
        expect(parentInOutput?.data?.noiseReduction?.forcedKeep).toBe(true);
    });
    it('BUG REPRODUCTION: Parent GET with child that gets METRICS FOLDED but parent still dropped', () => {
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            noiseReduction: {
                enabled: true,
                presets: ['fw24.hotpaths'],
                emitSummaries: true,
                includeDebugMetadata: true,
            },
        });
        // THIS IS THE KEY: What if the child is processed FIRST and modifies the parent's data
        // BEFORE the parent's decision is evaluated?
        const parentSpan = {
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
        const childSpan = {
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
        const events = [childSpan, parentSpan];
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 SCENARIO: Child processed before parent');
        console.log('  Output events:', result.events.length);
        result.events.forEach((e, i) => {
            console.log(`  [${i}] ${e.type}: ${e.operation} (${e.observabilityLogId})`);
            if (e.type === 'span' && e.data?.noiseReduction) {
                console.log('      noiseReduction:', JSON.stringify(e.data.noiseReduction, null, 8));
            }
        });
        const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent-123');
        // Parent should STILL be dropped regardless of order
        expect(parentInOutput).toBeUndefined();
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9yY2Uta2VlcC1idWctdjIudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9fX3Rlc3RzX18vZm9yY2Uta2VlcC1idWctdjIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG9DQUErQztBQUMvQyx5Q0FBeUQ7QUFHekQsUUFBUSxDQUFDLG9FQUFvRSxFQUFFLEdBQUcsRUFBRTtJQUVsRixFQUFFLENBQUMsa0VBQWtFLEVBQUUsR0FBRyxFQUFFO1FBQzFFLE1BQU0sTUFBTSxHQUFHLElBQUEsa0NBQXlCLEVBQUM7WUFDdkMsT0FBTyxFQUFFLElBQUk7WUFDYixjQUFjLEVBQUU7Z0JBQ2QsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLENBQUUsZUFBZSxDQUFFO2dCQUM1QixhQUFhLEVBQUUsSUFBSTtnQkFDbkIsb0JBQW9CLEVBQUUsSUFBSTthQUMzQjtTQUNGLENBQUMsQ0FBQztRQUVILHdDQUF3QztRQUN4QyxNQUFNLFVBQVUsR0FBdUI7WUFDckMsSUFBSSxFQUFFLE1BQU07WUFDWixrQkFBa0IsRUFBRSxZQUFZO1lBQ2hDLHdCQUF3QixFQUFFLFNBQVM7WUFDbkMsYUFBYSxFQUFFLGtCQUFrQjtZQUNqQyxTQUFTLEVBQUUsdUNBQXVDO1lBQ2xELE1BQU0sRUFBRSwyQ0FBMkM7WUFDbkQsS0FBSyxFQUFFLE1BQU07WUFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUN2QixVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxJQUFJO1lBQ2IsTUFBTSxFQUFFLFdBQVc7WUFDbkIsSUFBSSxFQUFFLEVBQUU7U0FDVCxDQUFDO1FBRUYsNENBQTRDO1FBQzVDLE1BQU0sTUFBTSxHQUF1QjtZQUNqQyxJQUFJLEVBQUUsTUFBTTtZQUNaLGtCQUFrQixFQUFFLFNBQVM7WUFDN0Isd0JBQXdCLEVBQUUsWUFBWTtZ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QzVELE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV0RCxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUM3QixPQUFPLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDLFNBQVMsS0FBSyxDQUFDLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxDQUFDO1lBQzVFLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLElBQUssQ0FBQyxDQUFDLElBQVksRUFBRSxjQUFjLEVBQUUsQ0FBQztnQkFDekQsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFFLENBQUMsQ0FBQyxJQUFZLENBQUMsY0FBYyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2hHLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixLQUFLLFlBQVksQ0FBQyxDQUFDO1FBRXRGLHFEQUFxRDtRQUNyRCxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDekMsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24gfSBmcm9tICcuLi9pbmRleCc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vLi4vY29uZmlnJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uLy4uL3R5cGVzJztcblxuZGVzY3JpYmUoJ0ZvcmNlLUtlZXAgQnVnIFYyOiBUZXN0IHdpdGggTVVMVElQTEUgY2hpbGRyZW4gd2hlcmUgc29tZSBhcmUga2VwdCcsICgpID0+IHtcblxuICBpdCgnUGFyZW50IEdFVCBzcGFuIHdpdGggbXVsdGlwbGUgY2hpbGRyZW4gLSBzb21lIGRyb3BwZWQsIHNvbWUga2VwdCcsICgpID0+IHtcbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBub2lzZVJlZHVjdGlvbjoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgICBlbWl0U3VtbWFyaWVzOiB0cnVlLFxuICAgICAgICBpbmNsdWRlRGVidWdNZXRhZGF0YTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBQYXJlbnQgc3BhbjogQ29udHJvbGxlciBHRVQgb3BlcmF0aW9uXG4gICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50LTEyMycsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHVuZGVmaW5lZCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hZG1pbi90ZWFtaW50ZWdyYXRpb25jb25maWcnLFxuICAgICAgc291cmNlOiAnQWRtaW5UZWFtSW50ZWdyYXRpb25Db25maWdDb250cm9sbGVyLmxpc3QnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogNDIwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICB9O1xuXG4gICAgLy8gQ2hpbGQgMTogU2VydmljZSBsaXN0IG9wZXJhdGlvbiAoZHJvcHBlZClcbiAgICBjb25zdCBjaGlsZDE6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkLTEnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50LTEyMycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICBvcGVyYXRpb246ICdCYXNlRW50aXR5U2VydmljZS5saXN0JyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UnLFxuICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDI2MCxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgICAgZGF0YToge30sXG4gICAgICBtZXRyaWNzOiB7IHJlc3VsdENvdW50OiAxMCB9LFxuICAgIH07XG5cbiAgICAvLyBDaGlsZCAyOiBEYXRhYmFzZSBxdWVyeSAoc2hvdWxkIGJlIGtlcHQgLSBpdCdzIGFuIElORk8gbG9nKVxuICAgIGNvbnN0IGNoaWxkMjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC0yJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudC0xMjMnLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgb3BlcmF0aW9uOiAncXVlcnknLFxuICAgICAgc291cmNlOiAnZGF0YWJhc2UnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZGF0YTogeyBtZXNzYWdlOiAnUXVlcnkgZXhlY3V0ZWQnIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IGV2ZW50cyA9IFsgcGFyZW50U3BhbiwgY2hpbGQxLCBjaGlsZDIgXTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gU0NFTkFSSU86IFBhcmVudCB3aXRoIG1peGVkIGNoaWxkcmVuIChzb21lIGRyb3BwZWQsIHNvbWUga2VwdCknKTtcbiAgICBjb25zb2xlLmxvZygnICBPdXRwdXQgZXZlbnRzOicsIHJlc3VsdC5ldmVudHMubGVuZ3RoKTtcbiAgICBjb25zb2xlLmxvZygnICBEcm9wcGVkOicsIHJlc3VsdC5zdGF0cy5kcm9wcGVkKTtcbiAgICBjb25zb2xlLmxvZygnICBLZXB0OicsIHJlc3VsdC5zdGF0cy5rZXB0KTtcblxuICAgIHJlc3VsdC5ldmVudHMuZm9yRWFjaCgoZSwgaSkgPT4ge1xuICAgICAgY29uc29sZS5sb2coYCAgWyR7aX1dICR7ZS50eXBlfTogJHtlLm9wZXJhdGlvbn0gKCR7ZS5vYnNlcnZhYmlsaXR5TG9nSWR9KWApO1xuICAgICAgaWYgKGUudHlwZSA9PT0gJ3NwYW4nICYmIChlLmRhdGEgYXMgYW55KT8ubm9pc2VSZWR1Y3Rpb24pIHtcbiAgICAgICAgY29uc29sZS5sb2coJyAgICAgIG5vaXNlUmVkdWN0aW9uOicsIEpTT04uc3RyaW5naWZ5KChlLmRhdGEgYXMgYW55KS5ub2lzZVJlZHVjdGlvbiwgbnVsbCwgOCkpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgcGFyZW50SW5PdXRwdXQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudC0xMjMnKTtcblxuICAgIC8vIElOIFRISVMgQ0FTRTogUGFyZW50IFNIT1VMRCBiZSBrZXB0IGJlY2F1c2UgY2hpbGQyIChsb2cpIGlzIGtlcHRcbiAgICAvLyBUaGUgcGFyZW50IG5lZWRzIHRvIGV4aXN0IHRvIG1haW50YWluIGhpZXJhcmNoeVxuICAgIGV4cGVjdChwYXJlbnRJbk91dHB1dCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoKHBhcmVudEluT3V0cHV0Py5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uPy5mb3JjZWRLZWVwKS50b0JlKHRydWUpO1xuICB9KTtcblxuICBpdCgnQlVHIFJFUFJPRFVDVElPTjogUGFyZW50IEdFVCB3aXRoIGNoaWxkIHRoYXQgZ2V0cyBNRVRSSUNTIEZPTERFRCBidXQgcGFyZW50IHN0aWxsIGRyb3BwZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZURlYnVnTWV0YWRhdGE6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gVEhJUyBJUyBUSEUgS0VZOiBXaGF0IGlmIHRoZSBjaGlsZCBpcyBwcm9jZXNzZWQgRklSU1QgYW5kIG1vZGlmaWVzIHRoZSBwYXJlbnQncyBkYXRhXG4gICAgLy8gQkVGT1JFIHRoZSBwYXJlbnQncyBkZWNpc2lvbiBpcyBldmFsdWF0ZWQ/XG5cbiAgICBjb25zdCBwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQtMTIzJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogdW5kZWZpbmVkLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FkbWluL3RlYW1pbnRlZ3JhdGlvbmNvbmZpZycsXG4gICAgICBzb3VyY2U6ICdBZG1pblRlYW1JbnRlZ3JhdGlvbkNvbmZpZ0NvbnRyb2xsZXIubGlzdCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBkdXJhdGlvbk1zOiA0MjAsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkLTQ1NicsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQtMTIzJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLmxpc3QnLFxuICAgICAgc291cmNlOiAnc2VydmljZTpCYXNlRW50aXR5U2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMjYwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICAgIG1ldHJpY3M6IHsgcmVzdWx0Q291bnQ6IDEwIH0sXG4gICAgfTtcblxuICAgIC8vIFByb2Nlc3MgY2hpbGQgRklSU1QgKG1heWJlIG9yZGVyIG1hdHRlcnM/KVxuICAgIGNvbnN0IGV2ZW50cyA9IFsgY2hpbGRTcGFuLCBwYXJlbnRTcGFuIF07XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGV2ZW50cywgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIGNvbnNvbGUubG9nKCdcXG7wn5SNIFNDRU5BUklPOiBDaGlsZCBwcm9jZXNzZWQgYmVmb3JlIHBhcmVudCcpO1xuICAgIGNvbnNvbGUubG9nKCcgIE91dHB1dCBldmVudHM6JywgcmVzdWx0LmV2ZW50cy5sZW5ndGgpO1xuXG4gICAgcmVzdWx0LmV2ZW50cy5mb3JFYWNoKChlLCBpKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZyhgICBbJHtpfV0gJHtlLnR5cGV9OiAke2Uub3BlcmF0aW9ufSAoJHtlLm9ic2VydmFiaWxpdHlMb2dJZH0pYCk7XG4gICAgICBpZiAoZS50eXBlID09PSAnc3BhbicgJiYgKGUuZGF0YSBhcyBhbnkpPy5ub2lzZVJlZHVjdGlvbikge1xuICAgICAgICBjb25zb2xlLmxvZygnICAgICAgbm9pc2VSZWR1Y3Rpb246JywgSlNPTi5zdHJpbmdpZnkoKGUuZGF0YSBhcyBhbnkpLm5vaXNlUmVkdWN0aW9uLCBudWxsLCA4KSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBwYXJlbnRJbk91dHB1dCA9IHJlc3VsdC5ldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50LTEyMycpO1xuXG4gICAgLy8gUGFyZW50IHNob3VsZCBTVElMTCBiZSBkcm9wcGVkIHJlZ2FyZGxlc3Mgb2Ygb3JkZXJcbiAgICBleHBlY3QocGFyZW50SW5PdXRwdXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgfSk7XG59KTtcbiJdfQ==