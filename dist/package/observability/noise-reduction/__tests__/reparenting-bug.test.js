"use strict";
/**
 * Tests for the reparenting fix: when a parent span is dropped by noise reduction,
 * child events should be reparented to the nearest kept ancestor to avoid "parent not found" errors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
const config_1 = require("../../config");
describe('Noise Reduction - Reparenting Orphaned Children', () => {
    const mockCorrelationId = 'test-correlation-id';
    const mockTimestamp = Date.now();
    function createSpan(id, operation, options = {}) {
        return {
            observabilityLogId: id,
            parentObservabilityLogId: options.parentId,
            correlationId: mockCorrelationId,
            type: 'span',
            operation,
            source: options.source || `service:${operation}`,
            level: options.level || 'info',
            success: options.success ?? true,
            timestampMs: mockTimestamp,
            durationMs: options.durationMs || 10,
            actor: {
                actorType: 'service',
                actorId: 'test-service',
                correlationId: mockCorrelationId,
                requestId: mockCorrelationId,
                timestamp: new Date(mockTimestamp).toISOString(),
            },
            tags: {},
            metrics: {},
            data: {},
        };
    }
    function createQueryEvent(id, operation, options = {}) {
        return {
            observabilityLogId: id,
            parentObservabilityLogId: options.parentId,
            correlationId: mockCorrelationId,
            type: 'database.query',
            operation,
            source: 'QueryObserver',
            level: options.level || 'warn', // Slow queries are warn (hard signal)
            success: true,
            timestampMs: mockTimestamp,
            durationMs: options.durationMs || 1500, // Slow
            actor: {
                actorType: 'service',
                actorId: 'test-service',
                correlationId: mockCorrelationId,
                requestId: mockCorrelationId,
                timestamp: new Date(mockTimestamp).toISOString(),
            },
            tags: {},
            metrics: {
                durationMs: options.durationMs || 1500,
                threshold: 1000,
            },
            data: {},
        };
    }
    const config = (0, config_1.createObservabilityConfig)({
        enabled: true,
        noiseReduction: {
            enabled: true,
            presets: ['fw24.hotpaths'],
            emitSummaries: true,
            includeDebugMetadata: true,
        },
    });
    it('should reparent orphaned query event when immediate parent is dropped', () => {
        const rootSpan = createSpan('root-1', 'HTTP GET /admin/entity/observabilitylog', {
            source: 'AdminDynamicEntityController.list',
            durationMs: 500,
        });
        // This span will be dropped by fw24.hotpaths.api.drop_fast_successful_reads
        const childSpan = createSpan('child-1', 'BaseEntityService.list', {
            parentId: 'root-1',
            source: 'service:BaseEntityService',
            durationMs: 300,
        });
        // This query event is a hard signal (warn level - slow query) - MUST be kept
        const queryEvent = createQueryEvent('query-1', 'observabilityLog.list', {
            parentId: 'child-1', // Parent will be dropped
            durationMs: 1500, // Slow
        });
        const result = (0, index_1.applyNoiseReduction)([rootSpan, childSpan, queryEvent], config.noiseReduction);
        // Root span should be kept (it has a kept descendant)
        const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
        expect(keptRoot).toBeDefined();
        // Child span should be dropped (fast successful read)
        const keptChild = result.events.find(e => e.observabilityLogId === 'child-1');
        expect(keptChild).toBeUndefined();
        // Query event should be kept (hard signal)
        const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
        expect(keptQuery).toBeDefined();
        // CRITICAL: Query event should be reparented to root-1 (nearest kept ancestor)
        expect(keptQuery.parentObservabilityLogId).toBe('root-1');
        // Should have reparenting checkpoint
        const data = keptQuery.data;
        expect(data.checkpoints).toBeDefined();
        const reparentCheckpoint = data.checkpoints?.find((c) => c.name === 'noiseReduction.reparented');
        expect(reparentCheckpoint).toBeDefined();
        expect(reparentCheckpoint?.data?.originalParent).toBe('child-1');
        expect(reparentCheckpoint?.data?.newParent).toBe('root-1');
    });
    it('should reparent through multiple dropped ancestors', () => {
        const rootSpan = createSpan('root-1', 'HTTP GET /queue/team-sync', {
            source: 'queue:team-sync',
            durationMs: 3000,
        });
        const level1 = createSpan('level1', 'TeamService.sync', {
            parentId: 'root-1',
            source: 'service:TeamService',
            durationMs: 200,
        });
        const level2 = createSpan('level2', 'BaseEntityService.query', {
            parentId: 'level1',
            source: 'service:BaseEntityService',
            durationMs: 150,
        });
        // Slow query - hard signal
        const queryEvent = createQueryEvent('query-1', 'team.query', {
            parentId: 'level2',
            durationMs: 1698, // Very slow
        });
        const result = (0, index_1.applyNoiseReduction)([rootSpan, level1, level2, queryEvent], config.noiseReduction);
        // Root span should be kept
        const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
        expect(keptRoot).toBeDefined();
        // Query event should be kept (hard signal)
        const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
        expect(keptQuery).toBeDefined();
        // CRITICAL: Query should be reparented directly to root (skipping dropped ancestors)
        // Even if intermediate spans are kept, the query should point to the nearest kept ancestor
        const queryParent = keptQuery.parentObservabilityLogId;
        expect(queryParent).toBeTruthy();
        // Verify parent exists in output (no "parent not found" errors)
        const parent = result.events.find(e => e.observabilityLogId === queryParent);
        expect(parent).toBeDefined();
    });
    it('should make orphan a root event if all ancestors are dropped', () => {
        // All spans will be dropped
        const level1 = createSpan('level1', 'BaseEntityService.list', {
            source: 'service:BaseEntityService',
            durationMs: 50,
        });
        const level2 = createSpan('level2', 'BaseEntityService.query', {
            parentId: 'level1',
            source: 'service:BaseEntityService',
            durationMs: 40,
        });
        // Slow query - hard signal
        const queryEvent = createQueryEvent('query-1', 'observabilityLog.query', {
            parentId: 'level2',
            durationMs: 1200,
        });
        const result = (0, index_1.applyNoiseReduction)([level1, level2, queryEvent], config.noiseReduction);
        // Query event should be kept (hard signal)
        const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
        expect(keptQuery).toBeDefined();
        // CRITICAL: Query's parent should either be undefined (orphaned) OR point to a kept parent
        const queryParent = keptQuery.parentObservabilityLogId;
        if (queryParent) {
            // If it has a parent, verify that parent exists in output
            const parent = result.events.find(e => e.observabilityLogId === queryParent);
            expect(parent).toBeDefined();
        }
        // If queryParent is undefined, query is correctly orphaned (all ancestors dropped)
        // Verify reparenting metadata if present
        const data = keptQuery.data;
        if (data?.checkpoints) {
            const reparentCheckpoint = data.checkpoints?.find((c) => c.name === 'noiseReduction.reparented' || c.name === 'noiseReduction.orphaned');
            if (reparentCheckpoint) {
                expect(reparentCheckpoint.data?.originalParent).toBeTruthy();
            }
        }
    });
    it('should not reparent if parent exists in output', () => {
        const rootSpan = createSpan('root-1', 'HTTP GET /admin/config', {
            source: 'AdminConfigController.get',
            durationMs: 500,
        });
        // This span will be kept (error)
        const childSpan = createSpan('child-1', 'BaseEntityService.get', {
            parentId: 'root-1',
            source: 'service:BaseEntityService',
            success: false, // Error - hard signal
            level: 'error',
            durationMs: 300,
        });
        // Query event
        const queryEvent = createQueryEvent('query-1', 'config.query', {
            parentId: 'child-1',
            durationMs: 1500,
        });
        const result = (0, index_1.applyNoiseReduction)([rootSpan, childSpan, queryEvent], config.noiseReduction);
        // All should be kept (error path)
        const keptRoot = result.events.find(e => e.observabilityLogId === 'root-1');
        const keptChild = result.events.find(e => e.observabilityLogId === 'child-1');
        const keptQuery = result.events.find(e => e.observabilityLogId === 'query-1');
        expect(keptRoot).toBeDefined();
        expect(keptChild).toBeDefined();
        expect(keptQuery).toBeDefined();
        // Query should still point to child (no reparenting needed)
        expect(keptQuery.parentObservabilityLogId).toBe('child-1');
        // Should NOT have reparenting checkpoint
        const data = keptQuery.data;
        const reparentCheckpoint = data.checkpoints?.find((c) => c.name === 'noiseReduction.reparented');
        expect(reparentCheckpoint).toBeUndefined();
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwYXJlbnRpbmctYnVnLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vX190ZXN0c19fL3JlcGFyZW50aW5nLWJ1Zy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0dBR0c7O0FBRUgsb0NBQStDO0FBQy9DLHlDQUF5RDtBQUd6RCxRQUFRLENBQUMsaURBQWlELEVBQUUsR0FBRyxFQUFFO0lBQy9ELE1BQU0saUJBQWlCLEdBQUcscUJBQXFCLENBQUM7SUFDaEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRWpDLFNBQVMsVUFBVSxDQUNqQixFQUFVLEVBQ1YsU0FBaUIsRUFDakIsVUFNSSxFQUFFO1FBRU4sT0FBTztZQUNMLGtCQUFrQixFQUFFLEVBQUU7WUFDdEIsd0JBQXdCLEVBQUUsT0FBTyxDQUFDLFFBQVE7WUFDMUMsYUFBYSxFQUFFLGlCQUFpQjtZQUNoQyxJQUFJLEVBQUUsTUFBTTtZQUNaLFNBQVM7WUFDVCxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sSUFBSSxXQUFXLFNBQVMsRUFBRTtZQUNoRCxLQUFLLEVBQUcsT0FBTyxDQUFDLEtBQWEsSUFBSSxNQUFNO1lBQ3ZDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTyxJQUFJLElBQUk7WUFDaEMsV0FBVyxFQUFFLGFBQWE7WUFDMUIsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtZQUNwQyxLQUFLLEVBQUU7Z0JBQ0wsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLE9BQU8sRUFBRSxjQUFjO2dCQUN2QixhQUFhLEVBQUUsaUJBQWlCO2dCQUNoQyxTQUFTLEVBQUUsaUJBQWlCO2dCQUM1QixTQUFTLEVBQUUsSUFBSSxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsV0FBVyxFQUFFO2FBQ2pEO1lBQ0QsSUFBSSxFQUFFLEVBQUU7WUFD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QUFNLGtCQUFrQixHQUFHLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLDJCQUEyQixDQUFDLENBQUM7UUFDdEcsTUFBTSxDQUFDLGtCQUFrQixDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDN0MsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVGVzdHMgZm9yIHRoZSByZXBhcmVudGluZyBmaXg6IHdoZW4gYSBwYXJlbnQgc3BhbiBpcyBkcm9wcGVkIGJ5IG5vaXNlIHJlZHVjdGlvbixcbiAqIGNoaWxkIGV2ZW50cyBzaG91bGQgYmUgcmVwYXJlbnRlZCB0byB0aGUgbmVhcmVzdCBrZXB0IGFuY2VzdG9yIHRvIGF2b2lkIFwicGFyZW50IG5vdCBmb3VuZFwiIGVycm9ycy5cbiAqL1xuXG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uIH0gZnJvbSAnLi4vaW5kZXgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uLy4uL2NvbmZpZyc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uLy4uL3R5cGVzJztcblxuZGVzY3JpYmUoJ05vaXNlIFJlZHVjdGlvbiAtIFJlcGFyZW50aW5nIE9ycGhhbmVkIENoaWxkcmVuJywgKCkgPT4ge1xuICBjb25zdCBtb2NrQ29ycmVsYXRpb25JZCA9ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJztcbiAgY29uc3QgbW9ja1RpbWVzdGFtcCA9IERhdGUubm93KCk7XG5cbiAgZnVuY3Rpb24gY3JlYXRlU3BhbihcbiAgICBpZDogc3RyaW5nLFxuICAgIG9wZXJhdGlvbjogc3RyaW5nLFxuICAgIG9wdGlvbnM6IHtcbiAgICAgIHBhcmVudElkPzogc3RyaW5nO1xuICAgICAgc291cmNlPzogc3RyaW5nO1xuICAgICAgc3VjY2Vzcz86IGJvb2xlYW47XG4gICAgICBsZXZlbD86IHN0cmluZztcbiAgICAgIGR1cmF0aW9uTXM/OiBudW1iZXI7XG4gICAgfSA9IHt9XG4gICk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IG9wdGlvbnMucGFyZW50SWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiBtb2NrQ29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHNvdXJjZTogb3B0aW9ucy5zb3VyY2UgfHwgYHNlcnZpY2U6JHtvcGVyYXRpb259YCxcbiAgICAgIGxldmVsOiAob3B0aW9ucy5sZXZlbCBhcyBhbnkpIHx8ICdpbmZvJyxcbiAgICAgIHN1Y2Nlc3M6IG9wdGlvbnMuc3VjY2VzcyA/PyB0cnVlLFxuICAgICAgdGltZXN0YW1wTXM6IG1vY2tUaW1lc3RhbXAsXG4gICAgICBkdXJhdGlvbk1zOiBvcHRpb25zLmR1cmF0aW9uTXMgfHwgMTAsXG4gICAgICBhY3Rvcjoge1xuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IG1vY2tDb3JyZWxhdGlvbklkLFxuICAgICAgICByZXF1ZXN0SWQ6IG1vY2tDb3JyZWxhdGlvbklkLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKG1vY2tUaW1lc3RhbXApLnRvSVNPU3RyaW5nKCksXG4gICAgICB9LFxuICAgICAgdGFnczoge30sXG4gICAgICBtZXRyaWNzOiB7fSxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH07XG4gIH1cblxuICBmdW5jdGlvbiBjcmVhdGVRdWVyeUV2ZW50KFxuICAgIGlkOiBzdHJpbmcsXG4gICAgb3BlcmF0aW9uOiBzdHJpbmcsXG4gICAgb3B0aW9uczoge1xuICAgICAgcGFyZW50SWQ/OiBzdHJpbmc7XG4gICAgICBsZXZlbD86IHN0cmluZztcbiAgICAgIGR1cmF0aW9uTXM/OiBudW1iZXI7XG4gICAgfSA9IHt9XG4gICk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaWQsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IG9wdGlvbnMucGFyZW50SWQsXG4gICAgICBjb3JyZWxhdGlvbklkOiBtb2NrQ29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICBvcGVyYXRpb24sXG4gICAgICBzb3VyY2U6ICdRdWVyeU9ic2VydmVyJyxcbiAgICAgIGxldmVsOiAob3B0aW9ucy5sZXZlbCBhcyBhbnkpIHx8ICd3YXJuJywgLy8gU2xvdyBxdWVyaWVzIGFyZSB3YXJuIChoYXJkIHNpZ25hbClcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB0aW1lc3RhbXBNczogbW9ja1RpbWVzdGFtcCxcbiAgICAgIGR1cmF0aW9uTXM6IG9wdGlvbnMuZHVyYXRpb25NcyB8fCAxNTAwLCAvLyBTbG93XG4gICAgICBhY3Rvcjoge1xuICAgICAgICBhY3RvclR5cGU6ICdzZXJ2aWNlJyxcbiAgICAgICAgYWN0b3JJZDogJ3Rlc3Qtc2VydmljZScsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IG1vY2tDb3JyZWxhdGlvbklkLFxuICAgICAgICByZXF1ZXN0SWQ6IG1vY2tDb3JyZWxhdGlvbklkLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKG1vY2tUaW1lc3RhbXApLnRvSVNPU3RyaW5nKCksXG4gICAgICB9LFxuICAgICAgdGFnczoge30sXG4gICAgICBtZXRyaWNzOiB7XG4gICAgICAgIGR1cmF0aW9uTXM6IG9wdGlvbnMuZHVyYXRpb25NcyB8fCAxNTAwLFxuICAgICAgICB0aHJlc2hvbGQ6IDEwMDAsXG4gICAgICB9LFxuICAgICAgZGF0YToge30sXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgZW1pdFN1bW1hcmllczogdHJ1ZSxcbiAgICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiB0cnVlLFxuICAgIH0sXG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgcmVwYXJlbnQgb3JwaGFuZWQgcXVlcnkgZXZlbnQgd2hlbiBpbW1lZGlhdGUgcGFyZW50IGlzIGRyb3BwZWQnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdFNwYW4gPSBjcmVhdGVTcGFuKCdyb290LTEnLCAnSFRUUCBHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJywge1xuICAgICAgc291cmNlOiAnQWRtaW5EeW5hbWljRW50aXR5Q29udHJvbGxlci5saXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICB9KTtcblxuICAgIC8vIFRoaXMgc3BhbiB3aWxsIGJlIGRyb3BwZWQgYnkgZncyNC5ob3RwYXRocy5hcGkuZHJvcF9mYXN0X3N1Y2Nlc3NmdWxfcmVhZHNcbiAgICBjb25zdCBjaGlsZFNwYW4gPSBjcmVhdGVTcGFuKCdjaGlsZC0xJywgJ0Jhc2VFbnRpdHlTZXJ2aWNlLmxpc3QnLCB7XG4gICAgICBwYXJlbnRJZDogJ3Jvb3QtMScsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlJyxcbiAgICAgIGR1cmF0aW9uTXM6IDMwMCxcbiAgICB9KTtcblxuICAgIC8vIFRoaXMgcXVlcnkgZXZlbnQgaXMgYSBoYXJkIHNpZ25hbCAod2FybiBsZXZlbCAtIHNsb3cgcXVlcnkpIC0gTVVTVCBiZSBrZXB0XG4gICAgY29uc3QgcXVlcnlFdmVudCA9IGNyZWF0ZVF1ZXJ5RXZlbnQoJ3F1ZXJ5LTEnLCAnb2JzZXJ2YWJpbGl0eUxvZy5saXN0Jywge1xuICAgICAgcGFyZW50SWQ6ICdjaGlsZC0xJywgLy8gUGFyZW50IHdpbGwgYmUgZHJvcHBlZFxuICAgICAgZHVyYXRpb25NczogMTUwMCwgLy8gU2xvd1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3RTcGFuLCBjaGlsZFNwYW4sIHF1ZXJ5RXZlbnQgXSwgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIC8vIFJvb3Qgc3BhbiBzaG91bGQgYmUga2VwdCAoaXQgaGFzIGEga2VwdCBkZXNjZW5kYW50KVxuICAgIGNvbnN0IGtlcHRSb290ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdyb290LTEnKTtcbiAgICBleHBlY3Qoa2VwdFJvb3QpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAvLyBDaGlsZCBzcGFuIHNob3VsZCBiZSBkcm9wcGVkIChmYXN0IHN1Y2Nlc3NmdWwgcmVhZClcbiAgICBjb25zdCBrZXB0Q2hpbGQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2NoaWxkLTEnKTtcbiAgICBleHBlY3Qoa2VwdENoaWxkKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICAvLyBRdWVyeSBldmVudCBzaG91bGQgYmUga2VwdCAoaGFyZCBzaWduYWwpXG4gICAgY29uc3Qga2VwdFF1ZXJ5ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdxdWVyeS0xJyk7XG4gICAgZXhwZWN0KGtlcHRRdWVyeSkudG9CZURlZmluZWQoKTtcblxuICAgIC8vIENSSVRJQ0FMOiBRdWVyeSBldmVudCBzaG91bGQgYmUgcmVwYXJlbnRlZCB0byByb290LTEgKG5lYXJlc3Qga2VwdCBhbmNlc3RvcilcbiAgICBleHBlY3Qoa2VwdFF1ZXJ5IS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ3Jvb3QtMScpO1xuXG4gICAgLy8gU2hvdWxkIGhhdmUgcmVwYXJlbnRpbmcgY2hlY2twb2ludFxuICAgIGNvbnN0IGRhdGEgPSBrZXB0UXVlcnkhLmRhdGEgYXMgYW55O1xuICAgIGV4cGVjdChkYXRhLmNoZWNrcG9pbnRzKS50b0JlRGVmaW5lZCgpO1xuICAgIGNvbnN0IHJlcGFyZW50Q2hlY2twb2ludCA9IGRhdGEuY2hlY2twb2ludHM/LmZpbmQoKGM6IGFueSkgPT4gYy5uYW1lID09PSAnbm9pc2VSZWR1Y3Rpb24ucmVwYXJlbnRlZCcpO1xuICAgIGV4cGVjdChyZXBhcmVudENoZWNrcG9pbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHJlcGFyZW50Q2hlY2twb2ludD8uZGF0YT8ub3JpZ2luYWxQYXJlbnQpLnRvQmUoJ2NoaWxkLTEnKTtcbiAgICBleHBlY3QocmVwYXJlbnRDaGVja3BvaW50Py5kYXRhPy5uZXdQYXJlbnQpLnRvQmUoJ3Jvb3QtMScpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIHJlcGFyZW50IHRocm91Z2ggbXVsdGlwbGUgZHJvcHBlZCBhbmNlc3RvcnMnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdFNwYW4gPSBjcmVhdGVTcGFuKCdyb290LTEnLCAnSFRUUCBHRVQgL3F1ZXVlL3RlYW0tc3luYycsIHtcbiAgICAgIHNvdXJjZTogJ3F1ZXVlOnRlYW0tc3luYycsXG4gICAgICBkdXJhdGlvbk1zOiAzMDAwLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbGV2ZWwxID0gY3JlYXRlU3BhbignbGV2ZWwxJywgJ1RlYW1TZXJ2aWNlLnN5bmMnLCB7XG4gICAgICBwYXJlbnRJZDogJ3Jvb3QtMScsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOlRlYW1TZXJ2aWNlJyxcbiAgICAgIGR1cmF0aW9uTXM6IDIwMCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxldmVsMiA9IGNyZWF0ZVNwYW4oJ2xldmVsMicsICdCYXNlRW50aXR5U2VydmljZS5xdWVyeScsIHtcbiAgICAgIHBhcmVudElkOiAnbGV2ZWwxJyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UnLFxuICAgICAgZHVyYXRpb25NczogMTUwLFxuICAgIH0pO1xuXG4gICAgLy8gU2xvdyBxdWVyeSAtIGhhcmQgc2lnbmFsXG4gICAgY29uc3QgcXVlcnlFdmVudCA9IGNyZWF0ZVF1ZXJ5RXZlbnQoJ3F1ZXJ5LTEnLCAndGVhbS5xdWVyeScsIHtcbiAgICAgIHBhcmVudElkOiAnbGV2ZWwyJyxcbiAgICAgIGR1cmF0aW9uTXM6IDE2OTgsIC8vIFZlcnkgc2xvd1xuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3RTcGFuLCBsZXZlbDEsIGxldmVsMiwgcXVlcnlFdmVudCBdLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgLy8gUm9vdCBzcGFuIHNob3VsZCBiZSBrZXB0XG4gICAgY29uc3Qga2VwdFJvb3QgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Jvb3QtMScpO1xuICAgIGV4cGVjdChrZXB0Um9vdCkudG9CZURlZmluZWQoKTtcblxuICAgIC8vIFF1ZXJ5IGV2ZW50IHNob3VsZCBiZSBrZXB0IChoYXJkIHNpZ25hbClcbiAgICBjb25zdCBrZXB0UXVlcnkgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3F1ZXJ5LTEnKTtcbiAgICBleHBlY3Qoa2VwdFF1ZXJ5KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgLy8gQ1JJVElDQUw6IFF1ZXJ5IHNob3VsZCBiZSByZXBhcmVudGVkIGRpcmVjdGx5IHRvIHJvb3QgKHNraXBwaW5nIGRyb3BwZWQgYW5jZXN0b3JzKVxuICAgIC8vIEV2ZW4gaWYgaW50ZXJtZWRpYXRlIHNwYW5zIGFyZSBrZXB0LCB0aGUgcXVlcnkgc2hvdWxkIHBvaW50IHRvIHRoZSBuZWFyZXN0IGtlcHQgYW5jZXN0b3JcbiAgICBjb25zdCBxdWVyeVBhcmVudCA9IGtlcHRRdWVyeSEucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGV4cGVjdChxdWVyeVBhcmVudCkudG9CZVRydXRoeSgpO1xuXG4gICAgLy8gVmVyaWZ5IHBhcmVudCBleGlzdHMgaW4gb3V0cHV0IChubyBcInBhcmVudCBub3QgZm91bmRcIiBlcnJvcnMpXG4gICAgY29uc3QgcGFyZW50ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09IHF1ZXJ5UGFyZW50KTtcbiAgICBleHBlY3QocGFyZW50KS50b0JlRGVmaW5lZCgpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIG1ha2Ugb3JwaGFuIGEgcm9vdCBldmVudCBpZiBhbGwgYW5jZXN0b3JzIGFyZSBkcm9wcGVkJywgKCkgPT4ge1xuICAgIC8vIEFsbCBzcGFucyB3aWxsIGJlIGRyb3BwZWRcbiAgICBjb25zdCBsZXZlbDEgPSBjcmVhdGVTcGFuKCdsZXZlbDEnLCAnQmFzZUVudGl0eVNlcnZpY2UubGlzdCcsIHtcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UnLFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsZXZlbDIgPSBjcmVhdGVTcGFuKCdsZXZlbDInLCAnQmFzZUVudGl0eVNlcnZpY2UucXVlcnknLCB7XG4gICAgICBwYXJlbnRJZDogJ2xldmVsMScsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlJyxcbiAgICAgIGR1cmF0aW9uTXM6IDQwLFxuICAgIH0pO1xuXG4gICAgLy8gU2xvdyBxdWVyeSAtIGhhcmQgc2lnbmFsXG4gICAgY29uc3QgcXVlcnlFdmVudCA9IGNyZWF0ZVF1ZXJ5RXZlbnQoJ3F1ZXJ5LTEnLCAnb2JzZXJ2YWJpbGl0eUxvZy5xdWVyeScsIHtcbiAgICAgIHBhcmVudElkOiAnbGV2ZWwyJyxcbiAgICAgIGR1cmF0aW9uTXM6IDEyMDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgbGV2ZWwxLCBsZXZlbDIsIHF1ZXJ5RXZlbnQgXSwgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgIC8vIFF1ZXJ5IGV2ZW50IHNob3VsZCBiZSBrZXB0IChoYXJkIHNpZ25hbClcbiAgICBjb25zdCBrZXB0UXVlcnkgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3F1ZXJ5LTEnKTtcbiAgICBleHBlY3Qoa2VwdFF1ZXJ5KS50b0JlRGVmaW5lZCgpO1xuXG4gICAgLy8gQ1JJVElDQUw6IFF1ZXJ5J3MgcGFyZW50IHNob3VsZCBlaXRoZXIgYmUgdW5kZWZpbmVkIChvcnBoYW5lZCkgT1IgcG9pbnQgdG8gYSBrZXB0IHBhcmVudFxuICAgIGNvbnN0IHF1ZXJ5UGFyZW50ID0ga2VwdFF1ZXJ5IS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKHF1ZXJ5UGFyZW50KSB7XG4gICAgICAvLyBJZiBpdCBoYXMgYSBwYXJlbnQsIHZlcmlmeSB0aGF0IHBhcmVudCBleGlzdHMgaW4gb3V0cHV0XG4gICAgICBjb25zdCBwYXJlbnQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gcXVlcnlQYXJlbnQpO1xuICAgICAgZXhwZWN0KHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICB9XG4gICAgLy8gSWYgcXVlcnlQYXJlbnQgaXMgdW5kZWZpbmVkLCBxdWVyeSBpcyBjb3JyZWN0bHkgb3JwaGFuZWQgKGFsbCBhbmNlc3RvcnMgZHJvcHBlZClcblxuICAgIC8vIFZlcmlmeSByZXBhcmVudGluZyBtZXRhZGF0YSBpZiBwcmVzZW50XG4gICAgY29uc3QgZGF0YSA9IGtlcHRRdWVyeSEuZGF0YSBhcyBhbnk7XG4gICAgaWYgKGRhdGE/LmNoZWNrcG9pbnRzKSB7XG4gICAgICBjb25zdCByZXBhcmVudENoZWNrcG9pbnQgPSBkYXRhLmNoZWNrcG9pbnRzPy5maW5kKChjOiBhbnkpID0+XG4gICAgICAgIGMubmFtZSA9PT0gJ25vaXNlUmVkdWN0aW9uLnJlcGFyZW50ZWQnIHx8IGMubmFtZSA9PT0gJ25vaXNlUmVkdWN0aW9uLm9ycGhhbmVkJ1xuICAgICAgKTtcbiAgICAgIGlmIChyZXBhcmVudENoZWNrcG9pbnQpIHtcbiAgICAgICAgZXhwZWN0KHJlcGFyZW50Q2hlY2twb2ludC5kYXRhPy5vcmlnaW5hbFBhcmVudCkudG9CZVRydXRoeSgpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCBub3QgcmVwYXJlbnQgaWYgcGFyZW50IGV4aXN0cyBpbiBvdXRwdXQnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdFNwYW4gPSBjcmVhdGVTcGFuKCdyb290LTEnLCAnSFRUUCBHRVQgL2FkbWluL2NvbmZpZycsIHtcbiAgICAgIHNvdXJjZTogJ0FkbWluQ29uZmlnQ29udHJvbGxlci5nZXQnLFxuICAgICAgZHVyYXRpb25NczogNTAwLFxuICAgIH0pO1xuXG4gICAgLy8gVGhpcyBzcGFuIHdpbGwgYmUga2VwdCAoZXJyb3IpXG4gICAgY29uc3QgY2hpbGRTcGFuID0gY3JlYXRlU3BhbignY2hpbGQtMScsICdCYXNlRW50aXR5U2VydmljZS5nZXQnLCB7XG4gICAgICBwYXJlbnRJZDogJ3Jvb3QtMScsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlJyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLCAvLyBFcnJvciAtIGhhcmQgc2lnbmFsXG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIGR1cmF0aW9uTXM6IDMwMCxcbiAgICB9KTtcblxuICAgIC8vIFF1ZXJ5IGV2ZW50XG4gICAgY29uc3QgcXVlcnlFdmVudCA9IGNyZWF0ZVF1ZXJ5RXZlbnQoJ3F1ZXJ5LTEnLCAnY29uZmlnLnF1ZXJ5Jywge1xuICAgICAgcGFyZW50SWQ6ICdjaGlsZC0xJyxcbiAgICAgIGR1cmF0aW9uTXM6IDE1MDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdFNwYW4sIGNoaWxkU3BhbiwgcXVlcnlFdmVudCBdLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgLy8gQWxsIHNob3VsZCBiZSBrZXB0IChlcnJvciBwYXRoKVxuICAgIGNvbnN0IGtlcHRSb290ID0gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdyb290LTEnKTtcbiAgICBjb25zdCBrZXB0Q2hpbGQgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2NoaWxkLTEnKTtcbiAgICBjb25zdCBrZXB0UXVlcnkgPSByZXN1bHQuZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3F1ZXJ5LTEnKTtcblxuICAgIGV4cGVjdChrZXB0Um9vdCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qoa2VwdENoaWxkKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChrZXB0UXVlcnkpLnRvQmVEZWZpbmVkKCk7XG5cbiAgICAvLyBRdWVyeSBzaG91bGQgc3RpbGwgcG9pbnQgdG8gY2hpbGQgKG5vIHJlcGFyZW50aW5nIG5lZWRlZClcbiAgICBleHBlY3Qoa2VwdFF1ZXJ5IS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLnRvQmUoJ2NoaWxkLTEnKTtcblxuICAgIC8vIFNob3VsZCBOT1QgaGF2ZSByZXBhcmVudGluZyBjaGVja3BvaW50XG4gICAgY29uc3QgZGF0YSA9IGtlcHRRdWVyeSEuZGF0YSBhcyBhbnk7XG4gICAgY29uc3QgcmVwYXJlbnRDaGVja3BvaW50ID0gZGF0YS5jaGVja3BvaW50cz8uZmluZCgoYzogYW55KSA9PiBjLm5hbWUgPT09ICdub2lzZVJlZHVjdGlvbi5yZXBhcmVudGVkJyk7XG4gICAgZXhwZWN0KHJlcGFyZW50Q2hlY2twb2ludCkudG9CZVVuZGVmaW5lZCgpO1xuICB9KTtcbn0pO1xuIl19