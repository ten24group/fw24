"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const query_1 = require("./query");
const config_1 = require("../config");
const types_1 = require("../types");
const runtime_state_1 = require("../runtime-state");
const base_1 = require("./base");
const execution_context_1 = require("../../core/runtime/execution-context");
describe('QueryObserver', () => {
    let capturedEvents = [];
    beforeEach(() => {
        // Reset captured events
        capturedEvents = [];
        // Mock the capture system
        (0, base_1.setCapturer)({
            capture: (input) => {
                capturedEvents.push(input);
                return input.observabilityLogId || 'test-id';
            },
            captureAsync: async (input) => {
                capturedEvents.push(input);
                return input.observabilityLogId || 'test-id';
            }
        });
        // Initialize with specific thresholds for testing
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            minLevel: types_1.ObservabilityLevel.DEBUG,
            queryPerformance: {
                enabled: true,
                slowThreshold: 100, // 100ms
                captureSlowQueryDetails: true,
                // Clear default operation thresholds so global slowThreshold applies
                operationThresholds: []
            }
        });
        // Set config directly in runtime state
        (0, runtime_state_1.setCurrentObservabilityConfig)(config);
    });
    afterEach(() => {
        (0, runtime_state_1.setCurrentObservabilityConfig)(null);
        (0, base_1.resetCapturer)();
        jest.restoreAllMocks();
    });
    it('should track fast queries and execute the function', async () => {
        await (0, execution_context_1.runWithExecutionContext)((0, execution_context_1.createExecutionContext)({
            correlationId: 'test-correlation-id',
        }), async () => {
            const fn = jest.fn().mockResolvedValue({ data: { id: '1' } });
            const result = await query_1.QueryObserver.track('User', 'get', fn);
            expect(result.data.id).toBe('1');
            expect(fn).toHaveBeenCalled();
            // Check that event was emitted
            expect(capturedEvents).toHaveLength(1);
            expect(capturedEvents[0]).toMatchObject({
                type: 'database.query',
                level: 'debug',
                operation: 'User.get',
                entityName: 'User',
                success: true,
                tags: {
                    entityName: 'User',
                    operation: 'get'
                }
            });
        });
    });
    it('should identify and emit warn level for slow queries', async () => {
        await (0, execution_context_1.runWithExecutionContext)({
            correlationId: 'test-correlation-id',
            startTime: Date.now(),
            observability: {}
        }, async () => {
            await query_1.QueryObserver.track('User', 'list', async () => {
                await new Promise(resolve => setTimeout(resolve, 150)); // Force slow query (> 100ms)
                return { data: [{ id: '1' }, { id: '2' }] };
            });
            expect(capturedEvents).toHaveLength(1);
            expect(capturedEvents[0]).toMatchObject({
                type: 'database.query',
                level: 'warn',
                operation: 'User.list',
                entityName: 'User',
                success: true,
                tags: {
                    entityName: 'User',
                    operation: 'list',
                    slowQuery: 'true'
                },
                metrics: {
                    itemCount: 2
                }
            });
            expect(capturedEvents[0].durationMs).toBeGreaterThan(100);
        });
    });
    it('should identify and emit warn level for scan operations', async () => {
        await (0, execution_context_1.runWithExecutionContext)({
            correlationId: 'test-correlation-id',
            startTime: Date.now(),
            observability: {}
        }, async () => {
            await query_1.QueryObserver.track('User', 'scan', async () => {
                return { data: [{ id: '1' }] };
            });
            expect(capturedEvents).toHaveLength(1);
            expect(capturedEvents[0]).toMatchObject({
                type: 'database.query',
                level: 'warn',
                operation: 'User.scan',
                entityName: 'User',
                success: true,
                tags: {
                    entityName: 'User',
                    operation: 'scan',
                    scan: 'true'
                }
            });
        });
    });
    it('should extract item counts from various ElectroDB formats', async () => {
        await (0, execution_context_1.runWithExecutionContext)({
            correlationId: 'test-correlation-id',
            startTime: Date.now(),
            observability: {}
        }, async () => {
            // List/Array format
            await query_1.QueryObserver.track('User', 'query', async () => {
                await new Promise(resolve => setTimeout(resolve, 150));
                return { data: [{}, {}, {}] };
            });
            expect(capturedEvents[capturedEvents.length - 1].metrics?.itemCount).toBe(3);
            // Single item format
            await query_1.QueryObserver.track('User', 'get', async () => {
                await new Promise(resolve => setTimeout(resolve, 150));
                return { data: { id: '1' } };
            });
            expect(capturedEvents[capturedEvents.length - 1].metrics?.itemCount).toBe(1);
            // Empty result
            await query_1.QueryObserver.track('User', 'get', async () => {
                await new Promise(resolve => setTimeout(resolve, 150));
                return { data: null };
            });
            expect(capturedEvents[capturedEvents.length - 1].metrics?.itemCount).toBe(0);
        });
    });
    it('should handle and emit error events', async () => {
        await (0, execution_context_1.runWithExecutionContext)({
            correlationId: 'test-correlation-id',
            startTime: Date.now(),
            observability: {}
        }, async () => {
            const error = new Error('DynamoDB Connection Timeout');
            const promise = query_1.QueryObserver.track('User', 'get', async () => {
                throw error;
            });
            await expect(promise).rejects.toThrow('DynamoDB Connection Timeout');
            expect(capturedEvents).toHaveLength(1);
            expect(capturedEvents[0]).toMatchObject({
                type: 'database.query',
                level: 'error',
                operation: 'User.get',
                entityName: 'User',
                success: false,
                error: {
                    type: 'Error',
                    message: 'DynamoDB Connection Timeout'
                },
                tags: {
                    entityName: 'User',
                    operation: 'get',
                    error: 'true'
                }
            });
        });
    });
    it('should respect per-entity threshold overrides', async () => {
        // Override threshold for 'LargeEntity' to be very high
        const config = (0, config_1.createObservabilityConfig)({
            enabled: true,
            queryPerformance: {
                enabled: true,
                slowThreshold: 100,
                entityOverrides: [
                    { entityName: 'LargeEntity', slowThreshold: 500 }
                ]
            }
        });
        (0, runtime_state_1.setCurrentObservabilityConfig)(config);
        // Reset captured events for this test
        capturedEvents = [];
        await (0, execution_context_1.runWithExecutionContext)({
            correlationId: 'test-correlation-id',
            startTime: Date.now(),
            observability: {}
        }, async () => {
            // This query (200ms) is slower than default (100ms) but faster than override (500ms)
            await query_1.QueryObserver.track('LargeEntity', 'list', async () => {
                await new Promise(resolve => setTimeout(resolve, 200));
                return { data: [] };
            });
            // Should be debug level, not warn (200ms < 500ms threshold)
            expect(capturedEvents).toHaveLength(1);
            expect(capturedEvents[0].level).toBe('debug');
            expect(capturedEvents[0].tags?.slowQuery).toBeUndefined();
        });
    });
    it('should emit events for fast queries that noise reduction can fold into checkpoints', async () => {
        await (0, execution_context_1.runWithExecutionContext)({
            correlationId: 'test-correlation-id',
            startTime: Date.now(),
            observability: {}
        }, async () => {
            await query_1.QueryObserver.track('User', 'get', async () => {
                return { data: { id: '1' } };
            });
            expect(capturedEvents).toHaveLength(1);
            expect(capturedEvents[0]).toMatchObject({
                type: 'database.query',
                level: 'debug',
                operation: 'User.get',
                entityName: 'User',
                success: true
            });
            // Noise reduction will decide whether to emit, absorb into parent, or silence this event
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9xdWVyeS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQXdDO0FBQ3hDLHNDQUFzRDtBQUN0RCxvQ0FBNEQ7QUFDNUQsb0RBQWlFO0FBQ2pFLGlDQUFvRDtBQUNwRCw0RUFBdUc7QUFFdkcsUUFBUSxDQUFDLGVBQWUsRUFBRSxHQUFHLEVBQUU7SUFDN0IsSUFBSSxjQUFjLEdBQW1CLEVBQUUsQ0FBQztJQUV4QyxVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2Qsd0JBQXdCO1FBQ3hCLGNBQWMsR0FBRyxFQUFFLENBQUM7UUFFcEIsMEJBQTBCO1FBQzFCLElBQUEsa0JBQVcsRUFBQztZQUNWLE9BQU8sRUFBRSxDQUFDLEtBQW1CLEVBQUUsRUFBRTtnQkFDL0IsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDM0IsT0FBTyxLQUFLLENBQUMsa0JBQWtCLElBQUksU0FBUyxDQUFDO1lBQy9DLENBQUM7WUFDRCxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQW1CLEVBQUUsRUFBRTtnQkFDMUMsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDM0IsT0FBTyxLQUFLLENBQUMsa0JBQWtCLElBQUksU0FBUyxDQUFDO1lBQy9DLENBQUM7U0FDRixDQUFDLENBQUM7UUFFSCxrREFBa0Q7UUFDbEQsTUFBTSxNQUFNLEdBQUcsSUFBQSxrQ0FBeUIsRUFBQztZQUN2QyxPQUFPLEVBQUUsSUFBSTtZQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxLQUFLO1lBQ2xDLGdCQUFnQixFQUFFO2dCQUNoQixPQUFPLEVBQUUsSUFBSTtnQkFDYixhQUFhLEVBQUUsR0FBRyxFQUFFLFFBQVE7Z0JBQzVCLHVCQUF1QixFQUFFLElBQUk7Z0JBQzdCLHFFQUFxRTtnQkFDckUsbUJBQW1CLEVBQUUsRUFBRTthQUN4QjtTQUNGLENBQUMsQ0FBQztRQUVILHVDQUF1QztRQUN2QyxJQUFBLDZDQUE2QixFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBRUgsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNiLElBQUEsNkNBQTZCLEVBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEMsSUFBQSxvQkFBYSxHQUFFLENBQUM7UUFDaEIsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO0lBQ3pCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLG9EQUFvRCxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ2xFLE1BQU0sSUFBQSwyQ0FBdUIsRUFBQyxJQUFBLDBDQUFzQixFQUFDO1lBQ25ELGFBQWEsRUFBRSxxQkFBcUI7U0FDckMsQ0FBQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2IsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUM5RCxNQUFNLE1BQU0sR0FBRyxNQUFNLHFCQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFFNUQsTUFBTSxDQUFFLE1BQWMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBRTlCLCtCQUErQjtZQUMvQixNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3hDLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLEtBQUssRUFBRSxPQUFPO2dCQUNkLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxNQUFNO29CQUNsQixTQUFTLEVBQUUsS0FBSztpQkFDakI7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHNEQUFzRCxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ3BFLE1BQU0sSUFBQSwyQ0FBdUIsRUFBQztZQUM1QixhQUFhLEVBQUUscUJBQXFCO1lBQ3BDLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLGFBQWEsRUFBRSxFQUFTO1NBQ3pCLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDWixNQUFNLHFCQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ25ELE1BQU0sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyw2QkFBNkI7Z0JBQ3JGLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBRSxFQUFFLENBQUM7WUFDaEQsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3hDLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxNQUFNO29CQUNsQixTQUFTLEVBQUUsTUFBTTtvQkFDakIsU0FBUyxFQUFFLE1BQU07aUJBQ2xCO2dCQUNELE9BQU8sRUFBRTtvQkFDUCxTQUFTLEVBQUUsQ0FBQztpQkFDYjthQUNGLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsVUFBVSxDQUFDLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzlELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMseURBQXlELEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDdkUsTUFBTSxJQUFBLDJDQUF1QixFQUFDO1lBQzVCLGFBQWEsRUFBRSxxQkFBcUI7WUFDcEMsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsYUFBYSxFQUFFLEVBQVM7U0FDekIsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNaLE1BQU0scUJBQWEsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkQsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFFLEVBQUUsQ0FBQztZQUNuQyxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDeEMsSUFBSSxFQUFFLGdCQUFnQjtnQkFDdEIsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixPQUFPLEVBQUUsSUFBSTtnQkFDYixJQUFJLEVBQUU7b0JBQ0osVUFBVSxFQUFFLE1BQU07b0JBQ2xCLFNBQVMsRUFBRSxNQUFNO29CQUNqQixJQUFJLEVBQUUsTUFBTTtpQkFDYjthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsMkRBQTJELEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDekUsTUFBTSxJQUFBLDJDQUF1QixFQUFDO1lBQzVCLGFBQWEsRUFBRSxxQkFBcUI7WUFDcEMsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsYUFBYSxFQUFFLEVBQVM7U0FDekIsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNaLG9CQUFvQjtZQUNwQixNQUFNLHFCQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ3BELE1BQU0sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7Z0JBQ3ZELE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBRSxFQUFFLENBQUM7WUFDbEMsQ0FBQyxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsY0FBYyxDQUFFLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFFLENBQUMsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUUvRSxxQkFBcUI7WUFDckIsTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNsRCxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUM7WUFDL0IsQ0FBQyxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsY0FBYyxDQUFFLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFFLENBQUMsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUUvRSxlQUFlO1lBQ2YsTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNsRCxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLGNBQWMsQ0FBRSxjQUFjLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBRSxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDakYsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxxQ0FBcUMsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNuRCxNQUFNLElBQUEsMkNBQXVCLEVBQUM7WUFDNUIsYUFBYSxFQUFFLHFCQUFxQjtZQUNwQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixhQUFhLEVBQUUsRUFBUztTQUN6QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ1osTUFBTSxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQztZQUV2RCxNQUFNLE9BQU8sR0FBRyxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUM1RCxNQUFNLEtBQUssQ0FBQztZQUNkLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO1lBRXJFLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDeEMsSUFBSSxFQUFFLGdCQUFnQjtnQkFDdEIsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsU0FBUyxFQUFFLFVBQVU7Z0JBQ3JCLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUU7b0JBQ0wsSUFBSSxFQUFFLE9BQU87b0JBQ2IsT0FBTyxFQUFFLDZCQUE2QjtpQkFDdkM7Z0JBQ0QsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxNQUFNO29CQUNsQixTQUFTLEVBQUUsS0FBSztvQkFDaEIsS0FBSyxFQUFFLE1BQU07aUJBQ2Q7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLCtDQUErQyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQzdELHVEQUF1RDtRQUN2RCxNQUFNLE1BQU0sR0FBRyxJQUFBLGtDQUF5QixFQUFDO1lBQ3ZDLE9BQU8sRUFBRSxJQUFJO1lBQ2IsZ0JBQWdCLEVBQUU7Z0JBQ2hCLE9BQU8sRUFBRSxJQUFJO2dCQUNiLGFBQWEsRUFBRSxHQUFHO2dCQUNsQixlQUFlLEVBQUU7b0JBQ2YsRUFBRSxVQUFVLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxHQUFHLEVBQUU7aUJBQ2xEO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFDSCxJQUFBLDZDQUE2QixFQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRXRDLHNDQUFzQztRQUN0QyxjQUFjLEdBQUcsRUFBRSxDQUFDO1FBRXBCLE1BQU0sSUFBQSwyQ0FBdUIsRUFBQztZQUM1QixhQUFhLEVBQUUscUJBQXFCO1lBQ3BDLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLGFBQWEsRUFBRSxFQUFTO1NBQ3pCLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDWixxRkFBcUY7WUFDckYsTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUMxRCxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDO1lBQ3RCLENBQUMsQ0FBQyxDQUFDO1lBRUgsNERBQTREO1lBQzVELE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDaEQsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxvRkFBb0YsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNsRyxNQUFNLElBQUEsMkNBQXVCLEVBQUM7WUFDNUIsYUFBYSxFQUFFLHFCQUFxQjtZQUNwQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixhQUFhLEVBQUUsRUFBUztTQUN6QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ1osTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNsRCxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUM7WUFDL0IsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3hDLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLEtBQUssRUFBRSxPQUFPO2dCQUNkLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7YUFDZCxDQUFDLENBQUM7WUFDSCx5RkFBeUY7UUFDM0YsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUXVlcnlPYnNlcnZlciB9IGZyb20gJy4vcXVlcnknO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uL2NvbmZpZyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TGV2ZWwsIENhcHR1cmVJbnB1dCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnIH0gZnJvbSAnLi4vcnVudGltZS1zdGF0ZSc7XG5pbXBvcnQgeyBzZXRDYXB0dXJlciwgcmVzZXRDYXB0dXJlciB9IGZyb20gJy4vYmFzZSc7XG5pbXBvcnQgeyBjcmVhdGVFeGVjdXRpb25Db250ZXh0LCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvcnVudGltZS9leGVjdXRpb24tY29udGV4dCc7XG5cbmRlc2NyaWJlKCdRdWVyeU9ic2VydmVyJywgKCkgPT4ge1xuICBsZXQgY2FwdHVyZWRFdmVudHM6IENhcHR1cmVJbnB1dFtdID0gW107XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgLy8gUmVzZXQgY2FwdHVyZWQgZXZlbnRzXG4gICAgY2FwdHVyZWRFdmVudHMgPSBbXTtcblxuICAgIC8vIE1vY2sgdGhlIGNhcHR1cmUgc3lzdGVtXG4gICAgc2V0Q2FwdHVyZXIoe1xuICAgICAgY2FwdHVyZTogKGlucHV0OiBDYXB0dXJlSW5wdXQpID0+IHtcbiAgICAgICAgY2FwdHVyZWRFdmVudHMucHVzaChpbnB1dCk7XG4gICAgICAgIHJldHVybiBpbnB1dC5vYnNlcnZhYmlsaXR5TG9nSWQgfHwgJ3Rlc3QtaWQnO1xuICAgICAgfSxcbiAgICAgIGNhcHR1cmVBc3luYzogYXN5bmMgKGlucHV0OiBDYXB0dXJlSW5wdXQpID0+IHtcbiAgICAgICAgY2FwdHVyZWRFdmVudHMucHVzaChpbnB1dCk7XG4gICAgICAgIHJldHVybiBpbnB1dC5vYnNlcnZhYmlsaXR5TG9nSWQgfHwgJ3Rlc3QtaWQnO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSB3aXRoIHNwZWNpZmljIHRocmVzaG9sZHMgZm9yIHRlc3RpbmdcbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsLkRFQlVHLFxuICAgICAgcXVlcnlQZXJmb3JtYW5jZToge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBzbG93VGhyZXNob2xkOiAxMDAsIC8vIDEwMG1zXG4gICAgICAgIGNhcHR1cmVTbG93UXVlcnlEZXRhaWxzOiB0cnVlLFxuICAgICAgICAvLyBDbGVhciBkZWZhdWx0IG9wZXJhdGlvbiB0aHJlc2hvbGRzIHNvIGdsb2JhbCBzbG93VGhyZXNob2xkIGFwcGxpZXNcbiAgICAgICAgb3BlcmF0aW9uVGhyZXNob2xkczogW11cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFNldCBjb25maWcgZGlyZWN0bHkgaW4gcnVudGltZSBzdGF0ZVxuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKGNvbmZpZyk7XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcobnVsbCk7XG4gICAgcmVzZXRDYXB0dXJlcigpO1xuICAgIGplc3QucmVzdG9yZUFsbE1vY2tzKCk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgdHJhY2sgZmFzdCBxdWVyaWVzIGFuZCBleGVjdXRlIHRoZSBmdW5jdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dChjcmVhdGVFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJyxcbiAgICB9KSwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZm4gPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoeyBkYXRhOiB7IGlkOiAnMScgfSB9KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAnZ2V0JywgZm4pO1xuXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLmRhdGEuaWQpLnRvQmUoJzEnKTtcbiAgICAgIGV4cGVjdChmbikudG9IYXZlQmVlbkNhbGxlZCgpO1xuXG4gICAgICAvLyBDaGVjayB0aGF0IGV2ZW50IHdhcyBlbWl0dGVkXG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgMCBdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgIG9wZXJhdGlvbjogJ1VzZXIuZ2V0JyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldCdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgaWRlbnRpZnkgYW5kIGVtaXQgd2FybiBsZXZlbCBmb3Igc2xvdyBxdWVyaWVzJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJyxcbiAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgICAgIG9ic2VydmFiaWxpdHk6IHt9IGFzIGFueVxuICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAnbGlzdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDE1MCkpOyAvLyBGb3JjZSBzbG93IHF1ZXJ5ICg+IDEwMG1zKVxuICAgICAgICByZXR1cm4geyBkYXRhOiBbIHsgaWQ6ICcxJyB9LCB7IGlkOiAnMicgfSBdIH07XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIDAgXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIG9wZXJhdGlvbjogJ1VzZXIubGlzdCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdsaXN0JyxcbiAgICAgICAgICBzbG93UXVlcnk6ICd0cnVlJ1xuICAgICAgICB9LFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgaXRlbUNvdW50OiAyXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyAwIF0uZHVyYXRpb25NcykudG9CZUdyZWF0ZXJUaGFuKDEwMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgaWRlbnRpZnkgYW5kIGVtaXQgd2FybiBsZXZlbCBmb3Igc2NhbiBvcGVyYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJyxcbiAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgICAgIG9ic2VydmFiaWxpdHk6IHt9IGFzIGFueVxuICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAnc2NhbicsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIHsgZGF0YTogWyB7IGlkOiAnMScgfSBdIH07XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIDAgXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICAgIG9wZXJhdGlvbjogJ1VzZXIuc2NhbicsXG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdzY2FuJyxcbiAgICAgICAgICBzY2FuOiAndHJ1ZSdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgZXh0cmFjdCBpdGVtIGNvdW50cyBmcm9tIHZhcmlvdXMgRWxlY3Ryb0RCIGZvcm1hdHMnLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24taWQnLFxuICAgICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpLFxuICAgICAgb2JzZXJ2YWJpbGl0eToge30gYXMgYW55XG4gICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTGlzdC9BcnJheSBmb3JtYXRcbiAgICAgIGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAncXVlcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxNTApKTtcbiAgICAgICAgcmV0dXJuIHsgZGF0YTogWyB7fSwge30sIHt9IF0gfTtcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyBjYXB0dXJlZEV2ZW50cy5sZW5ndGggLSAxIF0ubWV0cmljcz8uaXRlbUNvdW50KS50b0JlKDMpO1xuXG4gICAgICAvLyBTaW5nbGUgaXRlbSBmb3JtYXRcbiAgICAgIGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAnZ2V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTUwKSk7XG4gICAgICAgIHJldHVybiB7IGRhdGE6IHsgaWQ6ICcxJyB9IH07XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgY2FwdHVyZWRFdmVudHMubGVuZ3RoIC0gMSBdLm1ldHJpY3M/Lml0ZW1Db3VudCkudG9CZSgxKTtcblxuICAgICAgLy8gRW1wdHkgcmVzdWx0XG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ2dldCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDE1MCkpO1xuICAgICAgICByZXR1cm4geyBkYXRhOiBudWxsIH07XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgY2FwdHVyZWRFdmVudHMubGVuZ3RoIC0gMSBdLm1ldHJpY3M/Lml0ZW1Db3VudCkudG9CZSgwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCBoYW5kbGUgYW5kIGVtaXQgZXJyb3IgZXZlbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJyxcbiAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgICAgIG9ic2VydmFiaWxpdHk6IHt9IGFzIGFueVxuICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdEeW5hbW9EQiBDb25uZWN0aW9uIFRpbWVvdXQnKTtcblxuICAgICAgY29uc3QgcHJvbWlzZSA9IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAnZ2V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBleHBlY3QocHJvbWlzZSkucmVqZWN0cy50b1Rocm93KCdEeW5hbW9EQiBDb25uZWN0aW9uIFRpbWVvdXQnKTtcblxuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIDAgXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgICBvcGVyYXRpb246ICdVc2VyLmdldCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOiB7XG4gICAgICAgICAgdHlwZTogJ0Vycm9yJyxcbiAgICAgICAgICBtZXNzYWdlOiAnRHluYW1vREIgQ29ubmVjdGlvbiBUaW1lb3V0J1xuICAgICAgICB9LFxuICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICAgIG9wZXJhdGlvbjogJ2dldCcsXG4gICAgICAgICAgZXJyb3I6ICd0cnVlJ1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgaXQoJ3Nob3VsZCByZXNwZWN0IHBlci1lbnRpdHkgdGhyZXNob2xkIG92ZXJyaWRlcycsIGFzeW5jICgpID0+IHtcbiAgICAvLyBPdmVycmlkZSB0aHJlc2hvbGQgZm9yICdMYXJnZUVudGl0eScgdG8gYmUgdmVyeSBoaWdoXG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgcXVlcnlQZXJmb3JtYW5jZToge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBzbG93VGhyZXNob2xkOiAxMDAsXG4gICAgICAgIGVudGl0eU92ZXJyaWRlczogW1xuICAgICAgICAgIHsgZW50aXR5TmFtZTogJ0xhcmdlRW50aXR5Jywgc2xvd1RocmVzaG9sZDogNTAwIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgIH0pO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKGNvbmZpZyk7XG5cbiAgICAvLyBSZXNldCBjYXB0dXJlZCBldmVudHMgZm9yIHRoaXMgdGVzdFxuICAgIGNhcHR1cmVkRXZlbnRzID0gW107XG5cbiAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgICBzdGFydFRpbWU6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5OiB7fSBhcyBhbnlcbiAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBUaGlzIHF1ZXJ5ICgyMDBtcykgaXMgc2xvd2VyIHRoYW4gZGVmYXVsdCAoMTAwbXMpIGJ1dCBmYXN0ZXIgdGhhbiBvdmVycmlkZSAoNTAwbXMpXG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdMYXJnZUVudGl0eScsICdsaXN0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMjAwKSk7XG4gICAgICAgIHJldHVybiB7IGRhdGE6IFtdIH07XG4gICAgICB9KTtcblxuICAgICAgLy8gU2hvdWxkIGJlIGRlYnVnIGxldmVsLCBub3Qgd2FybiAoMjAwbXMgPCA1MDBtcyB0aHJlc2hvbGQpXG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgMCBdLmxldmVsKS50b0JlKCdkZWJ1ZycpO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyAwIF0udGFncz8uc2xvd1F1ZXJ5KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgZW1pdCBldmVudHMgZm9yIGZhc3QgcXVlcmllcyB0aGF0IG5vaXNlIHJlZHVjdGlvbiBjYW4gZm9sZCBpbnRvIGNoZWNrcG9pbnRzJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJyxcbiAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgICAgIG9ic2VydmFiaWxpdHk6IHt9IGFzIGFueVxuICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IFF1ZXJ5T2JzZXJ2ZXIudHJhY2soJ1VzZXInLCAnZ2V0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXR1cm4geyBkYXRhOiB7IGlkOiAnMScgfSB9O1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyAwIF0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBsZXZlbDogJ2RlYnVnJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnVXNlci5nZXQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWVcbiAgICAgIH0pO1xuICAgICAgLy8gTm9pc2UgcmVkdWN0aW9uIHdpbGwgZGVjaWRlIHdoZXRoZXIgdG8gZW1pdCwgYWJzb3JiIGludG8gcGFyZW50LCBvciBzaWxlbmNlIHRoaXMgZXZlbnRcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==