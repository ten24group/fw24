"use strict";
/**
 * Manager pipeline tests: HTTP GET request filtering via noise reduction.
 *
 * Exercises the REAL manager pipeline:
 *   SpanObserver/LogObserver → capture → buffer → flush → noise reduction → MockBackend
 *
 * Validates that user-defined rules for silencing routine HTTP GET operations
 * work correctly end-to-end, including except clauses for errors/warnings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const manager_1 = require("../manager");
const testing_1 = require("../testing");
const observers_1 = require("../observers");
const config_1 = require("../config");
const types_1 = require("../types");
describe('Manager pipeline: HTTP GET filtering', () => {
    let mockBackend;
    beforeEach(() => {
        manager_1.ObservabilityManager.reset();
        mockBackend = new testing_1.MockBackend({ minLevel: types_1.ObservabilityLevel.TRACE });
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            serviceName: 'fw24-pipeline-test',
            backends: [{ type: 'cloudwatch' }],
            noiseReduction: {
                enabled: true,
                presets: ['fw24.hotpaths'],
                rules: [
                    {
                        id: 'test.http.silent_info_get_spans',
                        priority: 150,
                        match: {
                            type: 'span',
                            operation: '/^HTTP (GET|HEAD|OPTIONS)\\s/',
                            level: ['info', 'debug', 'trace'],
                        },
                        except: [{ success: false }],
                        decision: 'silent',
                        reason: 'Silence INFO-level HTTP GET spans',
                    },
                    {
                        id: 'test.controller.silent_info_read_methods',
                        priority: 150,
                        match: {
                            type: 'span',
                            source: '/Controller\\.(list|get)/',
                            level: ['info', 'debug', 'trace'],
                        },
                        except: [{ success: false }],
                        decision: 'silent',
                        reason: 'Silence INFO-level controller read methods',
                    },
                    {
                        id: 'test.log.silent_info_logs',
                        priority: 150,
                        match: {
                            type: 'log',
                            level: ['info', 'debug', 'trace'],
                        },
                        decision: 'silent',
                        reason: 'Silence INFO-level logs',
                    },
                ],
            },
            spans: { skipEmpty: false, minDurationMs: 0 },
        });
        manager_1.ObservabilityManager.initializeForTesting(config, [mockBackend]);
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    it('should silence successful HTTP GET span', async () => {
        await (0, testing_1.createTestContext)(async () => {
            const span = observers_1.SpanObserver.start('HTTP GET /admin/entity/observabilitylog', {
                level: 'info',
                source: 'DynamicEntityController.list',
            });
            span.end({ success: true });
            await manager_1.Observer.flush();
        });
        expect(mockBackend.getEvents()).toHaveLength(0);
    });
    it('should KEEP HTTP GET span with ERROR', async () => {
        await (0, testing_1.createTestContext)(async () => {
            const span = observers_1.SpanObserver.start('HTTP GET /admin/entity/observabilitylog', {
                level: 'error',
                source: 'DynamicEntityController.list',
            });
            span.recordException(new Error('Database connection failed'));
            span.end({ success: false });
            await manager_1.Observer.flush();
        });
        const events = mockBackend.getEvents();
        expect(events.length).toBeGreaterThanOrEqual(1);
        const span = events.find(e => e.type === 'span');
        expect(span).toBeDefined();
        expect(span.success).toBe(false);
    });
    it('should KEEP warn-level HTTP GET span', async () => {
        await (0, testing_1.createTestContext)(async () => {
            const span = observers_1.SpanObserver.start('HTTP GET /admin/entity/observabilitylog', {
                level: 'warn',
                source: 'DynamicEntityController.list',
            });
            span.end({ success: true });
            await manager_1.Observer.flush();
        });
        const events = mockBackend.getEvents();
        expect(events.length).toBeGreaterThanOrEqual(1);
        const span = events.find(e => e.type === 'span');
        expect(span).toBeDefined();
    });
    it('should KEEP POST/PUT/DELETE operations', async () => {
        await (0, testing_1.createTestContext)(async () => {
            const span = observers_1.SpanObserver.start('HTTP POST /admin/entity/user', {
                level: 'warn',
                source: 'DynamicEntityController.create',
            });
            span.end({ success: true });
            await manager_1.Observer.flush();
        });
        const events = mockBackend.getEvents();
        expect(events.length).toBeGreaterThanOrEqual(1);
        const span = events.find(e => e.type === 'span');
        expect(span).toBeDefined();
        expect(span.operation).toContain('POST');
    });
    it('should silence GET operation log messages', async () => {
        await (0, testing_1.createTestContext)(async () => {
            observers_1.LogObserver.info('Processing GET request', {
                operation: 'HTTP GET /admin/entity/observabilitylog',
            });
            await manager_1.Observer.flush();
        });
        expect(mockBackend.getEvents()).toHaveLength(0);
    });
    it('should KEEP GET operation log with warning level', async () => {
        await (0, testing_1.createTestContext)(async () => {
            observers_1.LogObserver.warn('Slow GET request detected', {
                operation: 'HTTP GET /admin/entity/observabilitylog',
                durationMs: 6000,
            });
            await manager_1.Observer.flush();
        });
        const events = mockBackend.getEvents();
        expect(events.length).toBeGreaterThanOrEqual(1);
        const log = events.find(e => e.type === 'log');
        expect(log).toBeDefined();
        expect(log.level).toBe('warn');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci1waXBlbGluZS1nZXQtZmlsdGVyaW5nLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9fX3Rlc3RzX18vbWFuYWdlci1waXBlbGluZS1nZXQtZmlsdGVyaW5nLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOztBQUVILHdDQUE0RDtBQUM1RCx3Q0FBc0Y7QUFDdEYsNENBQXlEO0FBQ3pELHNDQUFzRDtBQUN0RCxvQ0FBOEM7QUFFOUMsUUFBUSxDQUFDLHNDQUFzQyxFQUFFLEdBQUcsRUFBRTtJQUNwRCxJQUFJLFdBQXdCLENBQUM7SUFFN0IsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLDhCQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQzdCLFdBQVcsR0FBRyxJQUFJLHFCQUFXLENBQUMsRUFBRSxRQUFRLEVBQUUsMEJBQWtCLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztRQUV0RSxNQUFNLE1BQU0sR0FBRyxJQUFBLGtDQUF5QixFQUFDO1lBQ3ZDLE9BQU8sRUFBRSxJQUFJO1lBQ2IsV0FBVyxFQUFFLG9CQUFvQjtZQUNqQyxRQUFRLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUsQ0FBQztZQUNsQyxjQUFjLEVBQUU7Z0JBQ2QsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsT0FBTyxFQUFFLENBQUMsZUFBZSxDQUFDO2dCQUMxQixLQUFLLEVBQUU7b0JBQ0w7d0JBQ0UsRUFBRSxFQUFFLGlDQUFpQzt3QkFDckMsUUFBUSxFQUFFLEdBQUc7d0JBQ2IsS0FBSyxFQUFFOzRCQUNMLElBQUksRUFBRSxNQUFNOzRCQUNaLFNBQVMsRUFBRSwrQkFBK0I7NEJBQzFDLEtBQUssRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDO3lCQUNsQzt3QkFDRCxNQUFNLEVBQUUsQ0FBQyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQzt3QkFDNUIsUUFBUSxFQUFFLFFBQVE7d0JBQ2xCLE1BQU0sRUFBRSxtQ0FBbUM7cUJBQzVDO29CQUNEO3dCQUNFLEVBQUUsRUFBRSwwQ0FBMEM7d0JBQzlDLFFBQVEsRUFBRSxHQUFHO3dCQUNiLEtBQUssRUFBRTs0QkFDTCxJQUFJLEVBQUUsTUFBTTs0QkFDWixNQUFNLEVBQUUsMkJBQTJCOzRCQUNuQyxLQUFLLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQzt5QkFDbEM7d0JBQ0QsTUFBTSxFQUFFLENBQUMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7d0JBQzVCLFFBQVEsRUFBRSxRQUFRO3dCQUNsQixNQUFNLEVBQUUsNENBQTRDO3FCQUNyRDtvQkFDRDt3QkFDRSxFQUFFLEVBQUUsMkJBQTJCO3dCQUMvQixRQUFRLEVBQUUsR0FBRzt3QkFDYixLQUFLLEVBQUU7NEJBQ0wsSUFBSSxFQUFFLEtBQUs7NEJBQ1gsS0FBSyxFQUFFLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLENBQUM7eUJBQ2xDO3dCQUNELFFBQVEsRUFBRSxRQUFRO3dCQUNsQixNQUFNLEVBQUUseUJBQXlCO3FCQUNsQztpQkFDRjthQUNGO1lBQ0QsS0FBSyxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsQ0FBQyxFQUFFO1NBQzlDLENBQUMsQ0FBQztRQUVILDhCQUFvQixDQUFDLG9CQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDbkUsQ0FBQyxDQUFDLENBQUM7SUFFSCxTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHlDQUF5QyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ3ZELE1BQU0sSUFBQSwyQkFBaUIsRUFBQyxLQUFLLElBQUksRUFBRTtZQUNqQyxNQUFNLElBQUksR0FBRyx3QkFBWSxDQUFDLEtBQUssQ0FBQyx5Q0FBeUMsRUFBRTtnQkFDekUsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsTUFBTSxFQUFFLDhCQUE4QjthQUN2QyxDQUFDLENBQUM7WUFDSCxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7WUFDNUIsTUFBTSxrQkFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3pCLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNsRCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNwRCxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsTUFBTSxJQUFJLEdBQUcsd0JBQVksQ0FBQyxLQUFLLENBQUMseUNBQXlDLEVBQUU7Z0JBQ3pFLEtBQUssRUFBRSxPQUFPO2dCQUNkLE1BQU0sRUFBRSw4QkFBOEI7YUFDdkMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDLENBQUM7WUFDOUQsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQzdCLE1BQU0sa0JBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN6QixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUN2QyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxDQUFDO1FBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMzQixNQUFNLENBQUMsSUFBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNwQyxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNwRCxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsTUFBTSxJQUFJLEdBQUcsd0JBQVksQ0FBQyxLQUFLLENBQUMseUNBQXlDLEVBQUU7Z0JBQ3pFLEtBQUssRUFBRSxNQUFNO2dCQUNiLE1BQU0sRUFBRSw4QkFBOEI7YUFDdkMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQzVCLE1BQU0sa0JBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN6QixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUN2QyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxDQUFDO1FBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUM3QixDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRSxLQUFLLElBQUksRUFBRTtRQUN0RCxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsTUFBTSxJQUFJLEdBQUcsd0JBQVksQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUU7Z0JBQzlELEtBQUssRUFBRSxNQUFNO2dCQUNiLE1BQU0sRUFBRSxnQ0FBZ0M7YUFDekMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQzVCLE1BQU0sa0JBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN6QixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUN2QyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxDQUFDO1FBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMzQixNQUFNLENBQUMsSUFBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUM1QyxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQywyQ0FBMkMsRUFBRSxLQUFLLElBQUksRUFBRTtRQUN6RCxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsdUJBQVcsQ0FBQyxJQUFJLENBQUMsd0JBQXdCLEVBQUU7Z0JBQ3pDLFNBQVMsRUFBRSx5Q0FBeUM7YUFDckQsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxrQkFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3pCLENBQUMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNsRCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxrREFBa0QsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNoRSxNQUFNLElBQUEsMkJBQWlCLEVBQUMsS0FBSyxJQUFJLEVBQUU7WUFDakMsdUJBQVcsQ0FBQyxJQUFJLENBQUMsMkJBQTJCLEVBQUU7Z0JBQzVDLFNBQVMsRUFBRSx5Q0FBeUM7Z0JBQ3BELFVBQVUsRUFBRSxJQUFJO2FBQ2pCLENBQUMsQ0FBQztZQUNILE1BQU0sa0JBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN6QixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUN2QyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO1FBQy9DLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMxQixNQUFNLENBQUMsR0FBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNsQyxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBNYW5hZ2VyIHBpcGVsaW5lIHRlc3RzOiBIVFRQIEdFVCByZXF1ZXN0IGZpbHRlcmluZyB2aWEgbm9pc2UgcmVkdWN0aW9uLlxuICpcbiAqIEV4ZXJjaXNlcyB0aGUgUkVBTCBtYW5hZ2VyIHBpcGVsaW5lOlxuICogICBTcGFuT2JzZXJ2ZXIvTG9nT2JzZXJ2ZXIg4oaSIGNhcHR1cmUg4oaSIGJ1ZmZlciDihpIgZmx1c2gg4oaSIG5vaXNlIHJlZHVjdGlvbiDihpIgTW9ja0JhY2tlbmRcbiAqXG4gKiBWYWxpZGF0ZXMgdGhhdCB1c2VyLWRlZmluZWQgcnVsZXMgZm9yIHNpbGVuY2luZyByb3V0aW5lIEhUVFAgR0VUIG9wZXJhdGlvbnNcbiAqIHdvcmsgY29ycmVjdGx5IGVuZC10by1lbmQsIGluY2x1ZGluZyBleGNlcHQgY2xhdXNlcyBmb3IgZXJyb3JzL3dhcm5pbmdzLlxuICovXG5cbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyLCBPYnNlcnZlciB9IGZyb20gJy4uL21hbmFnZXInO1xuaW1wb3J0IHsgTW9ja0JhY2tlbmQsIGNyZWF0ZVRlc3RDb250ZXh0LCBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHkgfSBmcm9tICcuLi90ZXN0aW5nJztcbmltcG9ydCB7IFNwYW5PYnNlcnZlciwgTG9nT2JzZXJ2ZXIgfSBmcm9tICcuLi9vYnNlcnZlcnMnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uL2NvbmZpZyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi90eXBlcyc7XG5cbmRlc2NyaWJlKCdNYW5hZ2VyIHBpcGVsaW5lOiBIVFRQIEdFVCBmaWx0ZXJpbmcnLCAoKSA9PiB7XG4gIGxldCBtb2NrQmFja2VuZDogTW9ja0JhY2tlbmQ7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgICBtb2NrQmFja2VuZCA9IG5ldyBNb2NrQmFja2VuZCh7IG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWwuVFJBQ0UgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXJ2aWNlTmFtZTogJ2Z3MjQtcGlwZWxpbmUtdGVzdCcsXG4gICAgICBiYWNrZW5kczogW3sgdHlwZTogJ2Nsb3Vkd2F0Y2gnIH1dLFxuICAgICAgbm9pc2VSZWR1Y3Rpb246IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWydmdzI0LmhvdHBhdGhzJ10sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0Lmh0dHAuc2lsZW50X2luZm9fZ2V0X3NwYW5zJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxNTAsXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgICAgICAgIG9wZXJhdGlvbjogJy9eSFRUUCAoR0VUfEhFQUR8T1BUSU9OUylcXFxccy8nLFxuICAgICAgICAgICAgICBsZXZlbDogWydpbmZvJywgJ2RlYnVnJywgJ3RyYWNlJ10sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXhjZXB0OiBbeyBzdWNjZXNzOiBmYWxzZSB9XSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgICAgIHJlYXNvbjogJ1NpbGVuY2UgSU5GTy1sZXZlbCBIVFRQIEdFVCBzcGFucycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuY29udHJvbGxlci5zaWxlbnRfaW5mb19yZWFkX21ldGhvZHMnLFxuICAgICAgICAgICAgcHJpb3JpdHk6IDE1MCxcbiAgICAgICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICAgICAgc291cmNlOiAnL0NvbnRyb2xsZXJcXFxcLihsaXN0fGdldCkvJyxcbiAgICAgICAgICAgICAgbGV2ZWw6IFsnaW5mbycsICdkZWJ1ZycsICd0cmFjZSddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGV4Y2VwdDogW3sgc3VjY2VzczogZmFsc2UgfV0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ3NpbGVudCcsXG4gICAgICAgICAgICByZWFzb246ICdTaWxlbmNlIElORk8tbGV2ZWwgY29udHJvbGxlciByZWFkIG1ldGhvZHMnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmxvZy5zaWxlbnRfaW5mb19sb2dzJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxNTAsXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICAgICAgbGV2ZWw6IFsnaW5mbycsICdkZWJ1ZycsICd0cmFjZSddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnc2lsZW50JyxcbiAgICAgICAgICAgIHJlYXNvbjogJ1NpbGVuY2UgSU5GTy1sZXZlbCBsb2dzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIHNwYW5zOiB7IHNraXBFbXB0eTogZmFsc2UsIG1pbkR1cmF0aW9uTXM6IDAgfSxcbiAgICB9KTtcblxuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVGb3JUZXN0aW5nKGNvbmZpZywgW21vY2tCYWNrZW5kXSk7XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgc2lsZW5jZSBzdWNjZXNzZnVsIEhUVFAgR0VUIHNwYW4nLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc3BhbiA9IFNwYW5PYnNlcnZlci5zdGFydCgnSFRUUCBHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJywge1xuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICBzb3VyY2U6ICdEeW5hbWljRW50aXR5Q29udHJvbGxlci5saXN0JyxcbiAgICAgIH0pO1xuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiB0cnVlIH0pO1xuICAgICAgYXdhaXQgT2JzZXJ2ZXIuZmx1c2goKTtcbiAgICB9KTtcblxuICAgIGV4cGVjdChtb2NrQmFja2VuZC5nZXRFdmVudHMoKSkudG9IYXZlTGVuZ3RoKDApO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIEtFRVAgSFRUUCBHRVQgc3BhbiB3aXRoIEVSUk9SJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ0hUVFAgR0VUIC9hZG1pbi9lbnRpdHkvb2JzZXJ2YWJpbGl0eWxvZycsIHtcbiAgICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICAgIHNvdXJjZTogJ0R5bmFtaWNFbnRpdHlDb250cm9sbGVyLmxpc3QnLFxuICAgICAgfSk7XG4gICAgICBzcGFuLnJlY29yZEV4Y2VwdGlvbihuZXcgRXJyb3IoJ0RhdGFiYXNlIGNvbm5lY3Rpb24gZmFpbGVkJykpO1xuICAgICAgc3Bhbi5lbmQoeyBzdWNjZXNzOiBmYWxzZSB9KTtcbiAgICAgIGF3YWl0IE9ic2VydmVyLmZsdXNoKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBldmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHMoKTtcbiAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgICBjb25zdCBzcGFuID0gZXZlbnRzLmZpbmQoZSA9PiBlLnR5cGUgPT09ICdzcGFuJyk7XG4gICAgZXhwZWN0KHNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHNwYW4hLnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIEtFRVAgd2Fybi1sZXZlbCBIVFRQIEdFVCBzcGFuJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHNwYW4gPSBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ0hUVFAgR0VUIC9hZG1pbi9lbnRpdHkvb2JzZXJ2YWJpbGl0eWxvZycsIHtcbiAgICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgICAgc291cmNlOiAnRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICB9KTtcbiAgICAgIHNwYW4uZW5kKHsgc3VjY2VzczogdHJ1ZSB9KTtcbiAgICAgIGF3YWl0IE9ic2VydmVyLmZsdXNoKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBldmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHMoKTtcbiAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgICBjb25zdCBzcGFuID0gZXZlbnRzLmZpbmQoZSA9PiBlLnR5cGUgPT09ICdzcGFuJyk7XG4gICAgZXhwZWN0KHNwYW4pLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgS0VFUCBQT1NUL1BVVC9ERUxFVEUgb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzcGFuID0gU3Bhbk9ic2VydmVyLnN0YXJ0KCdIVFRQIFBPU1QgL2FkbWluL2VudGl0eS91c2VyJywge1xuICAgICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgICBzb3VyY2U6ICdEeW5hbWljRW50aXR5Q29udHJvbGxlci5jcmVhdGUnLFxuICAgICAgfSk7XG4gICAgICBzcGFuLmVuZCh7IHN1Y2Nlc3M6IHRydWUgfSk7XG4gICAgICBhd2FpdCBPYnNlcnZlci5mbHVzaCgpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgZXZlbnRzID0gbW9ja0JhY2tlbmQuZ2V0RXZlbnRzKCk7XG4gICAgZXhwZWN0KGV2ZW50cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gICAgY29uc3Qgc3BhbiA9IGV2ZW50cy5maW5kKGUgPT4gZS50eXBlID09PSAnc3BhbicpO1xuICAgIGV4cGVjdChzcGFuKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzcGFuIS5vcGVyYXRpb24pLnRvQ29udGFpbignUE9TVCcpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIHNpbGVuY2UgR0VUIG9wZXJhdGlvbiBsb2cgbWVzc2FnZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgY3JlYXRlVGVzdENvbnRleHQoYXN5bmMgKCkgPT4ge1xuICAgICAgTG9nT2JzZXJ2ZXIuaW5mbygnUHJvY2Vzc2luZyBHRVQgcmVxdWVzdCcsIHtcbiAgICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgT2JzZXJ2ZXIuZmx1c2goKTtcbiAgICB9KTtcblxuICAgIGV4cGVjdChtb2NrQmFja2VuZC5nZXRFdmVudHMoKSkudG9IYXZlTGVuZ3RoKDApO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIEtFRVAgR0VUIG9wZXJhdGlvbiBsb2cgd2l0aCB3YXJuaW5nIGxldmVsJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IGNyZWF0ZVRlc3RDb250ZXh0KGFzeW5jICgpID0+IHtcbiAgICAgIExvZ09ic2VydmVyLndhcm4oJ1Nsb3cgR0VUIHJlcXVlc3QgZGV0ZWN0ZWQnLCB7XG4gICAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hZG1pbi9lbnRpdHkvb2JzZXJ2YWJpbGl0eWxvZycsXG4gICAgICAgIGR1cmF0aW9uTXM6IDYwMDAsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IE9ic2VydmVyLmZsdXNoKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBldmVudHMgPSBtb2NrQmFja2VuZC5nZXRFdmVudHMoKTtcbiAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgICBjb25zdCBsb2cgPSBldmVudHMuZmluZChlID0+IGUudHlwZSA9PT0gJ2xvZycpO1xuICAgIGV4cGVjdChsb2cpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGxvZyEubGV2ZWwpLnRvQmUoJ3dhcm4nKTtcbiAgfSk7XG59KTtcbiJdfQ==