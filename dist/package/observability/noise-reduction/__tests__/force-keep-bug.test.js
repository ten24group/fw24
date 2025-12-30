"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
describe('Force-Keep Bug: Parent span dropped by rule but force-kept due to child summaries', () => {
    it('REPRODUCES THE BUG: Parent GET span should be dropped but is force-kept', () => {
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            noiseReduction: {
                enabled: true,
                presets: ['fw24.hotpaths'],
                emitSummaries: true,
                includeDebugMetadata: true,
            },
        });
        // Parent span: Controller GET operation (should be dropped by fw24.hotpaths.api.drop_fast_successful_reads)
        const parentSpan = {
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
            metrics: {
                resultCount: 10,
            },
        };
        const events = [parentSpan, childSpan];
        // Apply noise reduction
        const result = (0, index_1.applyNoiseReduction)(events, config.noiseReduction);
        console.log('\n🔍 NOISE REDUCTION RESULT:');
        console.log('  Input events:', events.length);
        console.log('  Output events:', result.events.length);
        console.log('  Stats:', JSON.stringify(result.stats, null, 2));
        console.log('\n📊 OUTPUT EVENTS:');
        result.events.forEach((e, i) => {
            console.log(`  [${i}] ${e.type}: ${e.operation} (${e.observabilityLogId})`);
            if (e.type === 'span' && e.data?.noiseReduction) {
                console.log('      noiseReduction:', JSON.stringify(e.data.noiseReduction, null, 8));
            }
        });
        // BUG ASSERTION: Parent span is force-kept when it should be dropped
        const parentInOutput = result.events.find(e => e.observabilityLogId === 'parent-123');
        const childInOutput = result.events.find(e => e.observabilityLogId === 'child-456');
        console.log('\n🐛 BUG CHECK:');
        console.log('  Parent in output:', !!parentInOutput);
        console.log('  Parent has forcedKeep:', !!(parentInOutput && parentInOutput.data?.noiseReduction?.forcedKeep));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9yY2Uta2VlcC1idWcudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9fX3Rlc3RzX18vZm9yY2Uta2VlcC1idWcudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG9DQUErQztBQUMvQyx5Q0FBeUQ7QUFHekQsUUFBUSxDQUFDLG1GQUFtRixFQUFFLEdBQUcsRUFBRTtJQUVqRyxFQUFFLENBQUMseUVBQXlFLEVBQUUsR0FBRyxFQUFFO1FBQ2pGLE1BQU0sTUFBTSxHQUFHLElBQUEsa0NBQXlCLEVBQUM7WUFDdkMsT0FBTyxFQUFFLElBQUk7WUFDYixjQUFjLEVBQUU7Z0JBQ2QsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLENBQUUsZUFBZSxDQUFFO2dCQUM1QixhQUFhLEVBQUUsSUFBSTtnQkFDbkIsb0JBQW9CLEVBQUUsSUFBSTthQUMzQjtTQUNGLENBQUMsQ0FBQztRQUVILDRHQUE0RztRQUM1RyxNQUFNLFVBQVUsR0FBdUI7WUFDckMsSUFBSSxFQUFFLE1BQU07WUFDWixrQkFBa0IsRUFBRSxZQUFZO1lBQ2hDLHdCQUF3QixFQUFFLFNBQVMsRUFBRSxZQUFZO1lBQ2pELGFBQWEsRUFBRSxrQkFBa0I7WUFDakMsU0FBUyxFQUFFLHVDQUF1QztZQUNsRCxNQUFNLEVBQUUsMkNBQTJDO1lBQ25ELEtBQUssRUFBRSxNQUFNO1lBQ2IsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDdkIsVUFBVSxFQUFFLEdBQUcsRUFBRSx3QkFBd0I7WUFDekMsT0FBTyxFQUFFLElBQUk7WUFDYixNQUFNLEVBQUUsV0FBVztZQUNuQixJQUFJLEVBQUUsRUFBRTtTQUNULENBQUM7UUFFRix5REFBeUQ7UUFDekQsTUFBTSxTQUFTLEdBQXVCO1lBQ3BDLElBQUksRUFBRSxNQUFNO1lBQ1osa0JBQWtCLEVBQUUsV0FBVztZQUMvQix3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QUF1QjtRQUN2Qiw4REFBOEQ7UUFDOUQsa0RBQWtEO1FBRWxELHVDQUF1QztRQUN2QyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUMsQ0FBQywyQkFBMkI7UUFDbkUsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUMsMEJBQTBCO1FBQ2pFLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLHlCQUF5QjtRQUUvRCx3Q0FBd0M7UUFDeEMsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNuQixPQUFPLENBQUMsS0FBSyxDQUFDLDBFQUEwRSxDQUFDLENBQUM7WUFDMUYsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDaEUsT0FBTyxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsRUFBRSxjQUFjLENBQUMsVUFBVSxFQUFFLDRCQUE0QixDQUFDLENBQUM7WUFDOUYsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxjQUFjLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDNUQsT0FBTyxDQUFDLEtBQUssQ0FBQywyRUFBMkUsQ0FBQyxDQUFDO1lBQzNGLE1BQU0sSUFBSSxLQUFLLENBQUMsdURBQXVELENBQUMsQ0FBQztRQUMzRSxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24gfSBmcm9tICcuLi9pbmRleCc7XG5pbXBvcnQgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vLi4vY29uZmlnJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uLy4uL3R5cGVzJztcblxuZGVzY3JpYmUoJ0ZvcmNlLUtlZXAgQnVnOiBQYXJlbnQgc3BhbiBkcm9wcGVkIGJ5IHJ1bGUgYnV0IGZvcmNlLWtlcHQgZHVlIHRvIGNoaWxkIHN1bW1hcmllcycsICgpID0+IHtcblxuICBpdCgnUkVQUk9EVUNFUyBUSEUgQlVHOiBQYXJlbnQgR0VUIHNwYW4gc2hvdWxkIGJlIGRyb3BwZWQgYnV0IGlzIGZvcmNlLWtlcHQnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZURlYnVnTWV0YWRhdGE6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUGFyZW50IHNwYW46IENvbnRyb2xsZXIgR0VUIG9wZXJhdGlvbiAoc2hvdWxkIGJlIGRyb3BwZWQgYnkgZncyNC5ob3RwYXRocy5hcGkuZHJvcF9mYXN0X3N1Y2Nlc3NmdWxfcmVhZHMpXG4gICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50LTEyMycsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IHVuZGVmaW5lZCwgLy8gUm9vdCBzcGFuXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvYWRtaW4vdGVhbWludGVncmF0aW9uY29uZmlnJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluVGVhbUludGVncmF0aW9uQ29uZmlnQ29udHJvbGxlci5saXN0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgIGR1cmF0aW9uTXM6IDQyMCwgLy8gVW5kZXIgNTAwbXMgdGhyZXNob2xkXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG5cbiAgICAvLyBDaGlsZCBzcGFuOiBTZXJ2aWNlIGxpc3Qgb3BlcmF0aW9uIChzaG91bGQgYmUgZHJvcHBlZClcbiAgICBjb25zdCBjaGlsZFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkLTQ1NicsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQtMTIzJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLmxpc3QnLFxuICAgICAgc291cmNlOiAnc2VydmljZTpCYXNlRW50aXR5U2VydmljZScsXG4gICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgZHVyYXRpb25NczogMjYwLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgICBkYXRhOiB7fSxcbiAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgcmVzdWx0Q291bnQ6IDEwLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgZXZlbnRzID0gWyBwYXJlbnRTcGFuLCBjaGlsZFNwYW4gXTtcblxuICAgIC8vIEFwcGx5IG5vaXNlIHJlZHVjdGlvblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oZXZlbnRzLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgY29uc29sZS5sb2coJ1xcbvCflI0gTk9JU0UgUkVEVUNUSU9OIFJFU1VMVDonKTtcbiAgICBjb25zb2xlLmxvZygnICBJbnB1dCBldmVudHM6JywgZXZlbnRzLmxlbmd0aCk7XG4gICAgY29uc29sZS5sb2coJyAgT3V0cHV0IGV2ZW50czonLCByZXN1bHQuZXZlbnRzLmxlbmd0aCk7XG4gICAgY29uc29sZS5sb2coJyAgU3RhdHM6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LnN0YXRzLCBudWxsLCAyKSk7XG4gICAgY29uc29sZS5sb2coJ1xcbvCfk4ogT1VUUFVUIEVWRU5UUzonKTtcbiAgICByZXN1bHQuZXZlbnRzLmZvckVhY2goKGUsIGkpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKGAgIFske2l9XSAke2UudHlwZX06ICR7ZS5vcGVyYXRpb259ICgke2Uub2JzZXJ2YWJpbGl0eUxvZ0lkfSlgKTtcbiAgICAgIGlmIChlLnR5cGUgPT09ICdzcGFuJyAmJiAoZS5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCcgICAgICBub2lzZVJlZHVjdGlvbjonLCBKU09OLnN0cmluZ2lmeSgoZS5kYXRhIGFzIGFueSkubm9pc2VSZWR1Y3Rpb24sIG51bGwsIDgpKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEJVRyBBU1NFUlRJT046IFBhcmVudCBzcGFuIGlzIGZvcmNlLWtlcHQgd2hlbiBpdCBzaG91bGQgYmUgZHJvcHBlZFxuICAgIGNvbnN0IHBhcmVudEluT3V0cHV0ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQtMTIzJyk7XG4gICAgY29uc3QgY2hpbGRJbk91dHB1dCA9IHJlc3VsdC5ldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnY2hpbGQtNDU2Jyk7XG5cbiAgICBjb25zb2xlLmxvZygnXFxu8J+QmyBCVUcgQ0hFQ0s6Jyk7XG4gICAgY29uc29sZS5sb2coJyAgUGFyZW50IGluIG91dHB1dDonLCAhIXBhcmVudEluT3V0cHV0KTtcbiAgICBjb25zb2xlLmxvZygnICBQYXJlbnQgaGFzIGZvcmNlZEtlZXA6JywgISEocGFyZW50SW5PdXRwdXQgJiYgKHBhcmVudEluT3V0cHV0LmRhdGEgYXMgYW55KT8ubm9pc2VSZWR1Y3Rpb24/LmZvcmNlZEtlZXApKTtcbiAgICBjb25zb2xlLmxvZygnICBDaGlsZCBpbiBvdXRwdXQ6JywgISFjaGlsZEluT3V0cHV0KTtcbiAgICBjb25zb2xlLmxvZygnICBEcm9wcGVkIGNvdW50OicsIHJlc3VsdC5zdGF0cy5kcm9wcGVkKTtcblxuICAgIC8vIEVYUEVDVEVEIEJFSEFWSU9SOlxuICAgIC8vIC0gQm90aCBwYXJlbnQgQU5EIGNoaWxkIHNob3VsZCBiZSBkcm9wcGVkIChib3RoIG1hdGNoIGRyb3AgcnVsZXMpXG4gICAgLy8gLSBOZWl0aGVyIHNob3VsZCBiZSBpbiBvdXRwdXRcbiAgICAvLyAtIFN0YXRzIHNob3VsZCBzaG93IDIgZHJvcHBlZCBzcGFuc1xuXG4gICAgLy8gQUNUVUFMIEJFSEFWSU9SIChCVUcpOlxuICAgIC8vIC0gQ2hpbGQgaXMgZHJvcHBlZCDinIVcbiAgICAvLyAtIFBhcmVudCBpcyBmb3JjZS1rZXB0IOKdjCAoYmVjYXVzZSBjaGlsZCB3YXMgZm9sZGVkIGludG8gaXQpXG4gICAgLy8gLSBQYXJlbnQgaGFzIG5vaXNlUmVkdWN0aW9uLmZvcmNlZEtlZXAgPSB0cnVlIOKdjFxuXG4gICAgLy8gVEhJUyBTSE9VTEQgUEFTUyAoY29ycmVjdCBiZWhhdmlvcik6XG4gICAgZXhwZWN0KHBhcmVudEluT3V0cHV0KS50b0JlVW5kZWZpbmVkKCk7IC8vIFBhcmVudCBTSE9VTEQgYmUgZHJvcHBlZFxuICAgIGV4cGVjdChjaGlsZEluT3V0cHV0KS50b0JlVW5kZWZpbmVkKCk7IC8vIENoaWxkIFNIT1VMRCBiZSBkcm9wcGVkXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5kcm9wcGVkKS50b0JlKDIpOyAvLyBCb3RoIHNob3VsZCBiZSBkcm9wcGVkXG5cbiAgICAvLyBUSElTIElTIFdIQVQgQ1VSUkVOVExZIEhBUFBFTlMgKGJ1Zyk6XG4gICAgaWYgKHBhcmVudEluT3V0cHV0KSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdcXG7inYwgQlVHIENPTkZJUk1FRDogUGFyZW50IHNwYW4gd2FzIGZvcmNlLWtlcHQgd2hlbiBpdCBzaG91bGQgYmUgZHJvcHBlZCEnKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyAgIFBhcmVudCBvcGVyYXRpb246JywgcGFyZW50SW5PdXRwdXQub3BlcmF0aW9uKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyAgIFBhcmVudCBkdXJhdGlvbjonLCBwYXJlbnRJbk91dHB1dC5kdXJhdGlvbk1zLCAnbXMgKHVuZGVyIDUwMG1zIHRocmVzaG9sZCknKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyAgIFBhcmVudCBzdWNjZXNzOicsIHBhcmVudEluT3V0cHV0LnN1Y2Nlc3MpO1xuICAgICAgY29uc29sZS5lcnJvcignICAgUGFyZW50IHNob3VsZCBtYXRjaCBydWxlOiBmdzI0LmhvdHBhdGhzLmFwaS5kcm9wX2Zhc3Rfc3VjY2Vzc2Z1bF9yZWFkcycpO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCVUc6IFBhcmVudCBzcGFuIGZvcmNlLWtlcHQgd2hlbiBpdCBzaG91bGQgYmUgZHJvcHBlZCcpO1xuICAgIH1cbiAgfSk7XG59KTtcbiJdfQ==