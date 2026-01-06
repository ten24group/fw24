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
            // Noise reduction will decide whether to fold this into a checkpoint,
            // aggregate it, or keep it as a standalone log
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnkudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29ic2VydmVycy9xdWVyeS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsbUNBQXdDO0FBQ3hDLHNDQUFzRDtBQUN0RCxvQ0FBNEQ7QUFDNUQsb0RBQWlFO0FBQ2pFLGlDQUFvRDtBQUNwRCw0RUFBdUc7QUFFdkcsUUFBUSxDQUFDLGVBQWUsRUFBRSxHQUFHLEVBQUU7SUFDN0IsSUFBSSxjQUFjLEdBQW1CLEVBQUUsQ0FBQztJQUV4QyxVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2Qsd0JBQXdCO1FBQ3hCLGNBQWMsR0FBRyxFQUFFLENBQUM7UUFFcEIsMEJBQTBCO1FBQzFCLElBQUEsa0JBQVcsRUFBQztZQUNWLE9BQU8sRUFBRSxDQUFDLEtBQW1CLEVBQUUsRUFBRTtnQkFDL0IsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDM0IsT0FBTyxLQUFLLENBQUMsa0JBQWtCLElBQUksU0FBUyxDQUFDO1lBQy9DLENBQUM7WUFDRCxZQUFZLEVBQUUsS0FBSyxFQUFFLEtBQW1CLEVBQUUsRUFBRTtnQkFDMUMsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDM0IsT0FBTyxLQUFLLENBQUMsa0JBQWtCLElBQUksU0FBUyxDQUFDO1lBQy9DLENBQUM7U0FDRixDQUFDLENBQUM7UUFFSCxrREFBa0Q7UUFDbEQsTUFBTSxNQUFNLEdBQUcsSUFBQSxrQ0FBeUIsRUFBQztZQUN2QyxPQUFPLEVBQUUsSUFBSTtZQUNiLFFBQVEsRUFBRSwwQkFBa0IsQ0FBQyxLQUFLO1lBQ2xDLGdCQUFnQixFQUFFO2dCQUNoQixPQUFPLEVBQUUsSUFBSTtnQkFDYixhQUFhLEVBQUUsR0FBRyxFQUFFLFFBQVE7Z0JBQzVCLHVCQUF1QixFQUFFLElBQUk7Z0JBQzdCLHFFQUFxRTtnQkFDckUsbUJBQW1CLEVBQUUsRUFBRTthQUN4QjtTQUNGLENBQUMsQ0FBQztRQUVILHVDQUF1QztRQUN2QyxJQUFBLDZDQUE2QixFQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxDQUFDO0lBRUgsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNiLElBQUEsNkNBQTZCLEVBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEMsSUFBQSxvQkFBYSxHQUFFLENBQUM7UUFDaEIsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO0lBQ3pCLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLG9EQUFvRCxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ2xFLE1BQU0sSUFBQSwyQ0FBdUIsRUFBQyxJQUFBLDBDQUFzQixFQUFDO1lBQ25ELGFBQWEsRUFBRSxxQkFBcUI7U0FDckMsQ0FBQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2IsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUM5RCxNQUFNLE1BQU0sR0FBRyxNQUFNLHFCQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFFNUQsTUFBTSxDQUFFLE1BQWMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBRTlCLCtCQUErQjtZQUMvQixNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3hDLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLEtBQUssRUFBRSxPQUFPO2dCQUNkLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxNQUFNO29CQUNsQixTQUFTLEVBQUUsS0FBSztpQkFDakI7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLHNEQUFzRCxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQ3BFLE1BQU0sSUFBQSwyQ0FBdUIsRUFBQztZQUM1QixhQUFhLEVBQUUscUJBQXFCO1lBQ3BDLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLGFBQWEsRUFBRSxFQUFTO1NBQ3pCLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDWixNQUFNLHFCQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ25ELE1BQU0sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyw2QkFBNkI7Z0JBQ3JGLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBRSxFQUFFLENBQUM7WUFDaEQsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3hDLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxNQUFNO29CQUNsQixTQUFTLEVBQUUsTUFBTTtvQkFDakIsU0FBUyxFQUFFLE1BQU07aUJBQ2xCO2dCQUNELE9BQU8sRUFBRTtvQkFDUCxTQUFTLEVBQUUsQ0FBQztpQkFDYjthQUNGLENBQUMsQ0FBQztZQUNILE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsVUFBVSxDQUFDLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzlELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMseURBQXlELEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDdkUsTUFBTSxJQUFBLDJDQUF1QixFQUFDO1lBQzVCLGFBQWEsRUFBRSxxQkFBcUI7WUFDcEMsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsYUFBYSxFQUFFLEVBQVM7U0FDekIsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNaLE1BQU0scUJBQWEsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLElBQUksRUFBRTtnQkFDbkQsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFFLEVBQUUsQ0FBQztZQUNuQyxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDeEMsSUFBSSxFQUFFLGdCQUFnQjtnQkFDdEIsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixPQUFPLEVBQUUsSUFBSTtnQkFDYixJQUFJLEVBQUU7b0JBQ0osVUFBVSxFQUFFLE1BQU07b0JBQ2xCLFNBQVMsRUFBRSxNQUFNO29CQUNqQixJQUFJLEVBQUUsTUFBTTtpQkFDYjthQUNGLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsMkRBQTJELEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDekUsTUFBTSxJQUFBLDJDQUF1QixFQUFDO1lBQzVCLGFBQWEsRUFBRSxxQkFBcUI7WUFDcEMsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsYUFBYSxFQUFFLEVBQVM7U0FDekIsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNaLG9CQUFvQjtZQUNwQixNQUFNLHFCQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQ3BELE1BQU0sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7Z0JBQ3ZELE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBRSxFQUFFLENBQUM7WUFDbEMsQ0FBQyxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsY0FBYyxDQUFFLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFFLENBQUMsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUUvRSxxQkFBcUI7WUFDckIsTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNsRCxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUM7WUFDL0IsQ0FBQyxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsY0FBYyxDQUFFLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFFLENBQUMsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUUvRSxlQUFlO1lBQ2YsTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNsRCxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDO1lBQ3hCLENBQUMsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxDQUFDLGNBQWMsQ0FBRSxjQUFjLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBRSxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDakYsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxxQ0FBcUMsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNuRCxNQUFNLElBQUEsMkNBQXVCLEVBQUM7WUFDNUIsYUFBYSxFQUFFLHFCQUFxQjtZQUNwQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixhQUFhLEVBQUUsRUFBUztTQUN6QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ1osTUFBTSxLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsNkJBQTZCLENBQUMsQ0FBQztZQUV2RCxNQUFNLE9BQU8sR0FBRyxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUM1RCxNQUFNLEtBQUssQ0FBQztZQUNkLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDO1lBRXJFLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDeEMsSUFBSSxFQUFFLGdCQUFnQjtnQkFDdEIsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsU0FBUyxFQUFFLFVBQVU7Z0JBQ3JCLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUU7b0JBQ0wsSUFBSSxFQUFFLE9BQU87b0JBQ2IsT0FBTyxFQUFFLDZCQUE2QjtpQkFDdkM7Z0JBQ0QsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxNQUFNO29CQUNsQixTQUFTLEVBQUUsS0FBSztvQkFDaEIsS0FBSyxFQUFFLE1BQU07aUJBQ2Q7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsRUFBRSxDQUFDLCtDQUErQyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQzdELHVEQUF1RDtRQUN2RCxNQUFNLE1BQU0sR0FBRyxJQUFBLGtDQUF5QixFQUFDO1lBQ3ZDLE9BQU8sRUFBRSxJQUFJO1lBQ2IsZ0JBQWdCLEVBQUU7Z0JBQ2hCLE9BQU8sRUFBRSxJQUFJO2dCQUNiLGFBQWEsRUFBRSxHQUFHO2dCQUNsQixlQUFlLEVBQUU7b0JBQ2YsRUFBRSxVQUFVLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxHQUFHLEVBQUU7aUJBQ2xEO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFDSCxJQUFBLDZDQUE2QixFQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRXRDLHNDQUFzQztRQUN0QyxjQUFjLEdBQUcsRUFBRSxDQUFDO1FBRXBCLE1BQU0sSUFBQSwyQ0FBdUIsRUFBQztZQUM1QixhQUFhLEVBQUUscUJBQXFCO1lBQ3BDLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLGFBQWEsRUFBRSxFQUFTO1NBQ3pCLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDWixxRkFBcUY7WUFDckYsTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxhQUFhLEVBQUUsTUFBTSxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUMxRCxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDO1lBQ3RCLENBQUMsQ0FBQyxDQUFDO1lBRUgsNERBQTREO1lBQzVELE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDaEQsTUFBTSxDQUFDLGNBQWMsQ0FBRSxDQUFDLENBQUUsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILEVBQUUsQ0FBQyxvRkFBb0YsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNsRyxNQUFNLElBQUEsMkNBQXVCLEVBQUM7WUFDNUIsYUFBYSxFQUFFLHFCQUFxQjtZQUNwQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixhQUFhLEVBQUUsRUFBUztTQUN6QixFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ1osTUFBTSxxQkFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxFQUFFO2dCQUNsRCxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUM7WUFDL0IsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZDLE1BQU0sQ0FBQyxjQUFjLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQ3hDLElBQUksRUFBRSxnQkFBZ0I7Z0JBQ3RCLEtBQUssRUFBRSxPQUFPO2dCQUNkLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixVQUFVLEVBQUUsTUFBTTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7YUFDZCxDQUFDLENBQUM7WUFDSCxzRUFBc0U7WUFDdEUsK0NBQStDO1FBQ2pELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFF1ZXJ5T2JzZXJ2ZXIgfSBmcm9tICcuL3F1ZXJ5JztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsLCBDYXB0dXJlSW5wdXQgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyB9IGZyb20gJy4uL3J1bnRpbWUtc3RhdGUnO1xuaW1wb3J0IHsgc2V0Q2FwdHVyZXIsIHJlc2V0Q2FwdHVyZXIgfSBmcm9tICcuL2Jhc2UnO1xuaW1wb3J0IHsgY3JlYXRlRXhlY3V0aW9uQ29udGV4dCwgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQnO1xuXG5kZXNjcmliZSgnUXVlcnlPYnNlcnZlcicsICgpID0+IHtcbiAgbGV0IGNhcHR1cmVkRXZlbnRzOiBDYXB0dXJlSW5wdXRbXSA9IFtdO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIFJlc2V0IGNhcHR1cmVkIGV2ZW50c1xuICAgIGNhcHR1cmVkRXZlbnRzID0gW107XG5cbiAgICAvLyBNb2NrIHRoZSBjYXB0dXJlIHN5c3RlbVxuICAgIHNldENhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dDogQ2FwdHVyZUlucHV0KSA9PiB7XG4gICAgICAgIGNhcHR1cmVkRXZlbnRzLnB1c2goaW5wdXQpO1xuICAgICAgICByZXR1cm4gaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkIHx8ICd0ZXN0LWlkJztcbiAgICAgIH0sXG4gICAgICBjYXB0dXJlQXN5bmM6IGFzeW5jIChpbnB1dDogQ2FwdHVyZUlucHV0KSA9PiB7XG4gICAgICAgIGNhcHR1cmVkRXZlbnRzLnB1c2goaW5wdXQpO1xuICAgICAgICByZXR1cm4gaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkIHx8ICd0ZXN0LWlkJztcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgd2l0aCBzcGVjaWZpYyB0aHJlc2hvbGRzIGZvciB0ZXN0aW5nXG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbC5ERUJVRyxcbiAgICAgIHF1ZXJ5UGVyZm9ybWFuY2U6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc2xvd1RocmVzaG9sZDogMTAwLCAvLyAxMDBtc1xuICAgICAgICBjYXB0dXJlU2xvd1F1ZXJ5RGV0YWlsczogdHJ1ZSxcbiAgICAgICAgLy8gQ2xlYXIgZGVmYXVsdCBvcGVyYXRpb24gdGhyZXNob2xkcyBzbyBnbG9iYWwgc2xvd1RocmVzaG9sZCBhcHBsaWVzXG4gICAgICAgIG9wZXJhdGlvblRocmVzaG9sZHM6IFtdXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTZXQgY29uZmlnIGRpcmVjdGx5IGluIHJ1bnRpbWUgc3RhdGVcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhjb25maWcpO1xuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIHJlc2V0Q2FwdHVyZXIoKTtcbiAgICBqZXN0LnJlc3RvcmVBbGxNb2NrcygpO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIHRyYWNrIGZhc3QgcXVlcmllcyBhbmQgZXhlY3V0ZSB0aGUgZnVuY3Rpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoY3JlYXRlRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgfSksIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGZuID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHsgZGF0YTogeyBpZDogJzEnIH0gfSk7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ2dldCcsIGZuKTtcblxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5kYXRhLmlkKS50b0JlKCcxJyk7XG4gICAgICBleHBlY3QoZm4pLnRvSGF2ZUJlZW5DYWxsZWQoKTtcblxuICAgICAgLy8gQ2hlY2sgdGhhdCBldmVudCB3YXMgZW1pdHRlZFxuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIDAgXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIGxldmVsOiAnZGVidWcnLFxuICAgICAgICBvcGVyYXRpb246ICdVc2VyLmdldCcsXG4gICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdnZXQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGlkZW50aWZ5IGFuZCBlbWl0IHdhcm4gbGV2ZWwgZm9yIHNsb3cgcXVlcmllcycsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgICBzdGFydFRpbWU6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5OiB7fSBhcyBhbnlcbiAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ2xpc3QnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxNTApKTsgLy8gRm9yY2Ugc2xvdyBxdWVyeSAoPiAxMDBtcylcbiAgICAgICAgcmV0dXJuIHsgZGF0YTogWyB7IGlkOiAnMScgfSwgeyBpZDogJzInIH0gXSB9O1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyAwIF0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgICBvcGVyYXRpb246ICdVc2VyLmxpc3QnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnbGlzdCcsXG4gICAgICAgICAgc2xvd1F1ZXJ5OiAndHJ1ZSdcbiAgICAgICAgfSxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgIGl0ZW1Db3VudDogMlxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgMCBdLmR1cmF0aW9uTXMpLnRvQmVHcmVhdGVyVGhhbigxMDApO1xuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGlkZW50aWZ5IGFuZCBlbWl0IHdhcm4gbGV2ZWwgZm9yIHNjYW4gb3BlcmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgICBzdGFydFRpbWU6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5OiB7fSBhcyBhbnlcbiAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ3NjYW4nLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIHJldHVybiB7IGRhdGE6IFsgeyBpZDogJzEnIH0gXSB9O1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyAwIF0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgICBvcGVyYXRpb246ICdVc2VyLnNjYW4nLFxuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgICAgb3BlcmF0aW9uOiAnc2NhbicsXG4gICAgICAgICAgc2NhbjogJ3RydWUnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGV4dHJhY3QgaXRlbSBjb3VudHMgZnJvbSB2YXJpb3VzIEVsZWN0cm9EQiBmb3JtYXRzJywgYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uLWlkJyxcbiAgICAgIHN0YXJ0VGltZTogRGF0ZS5ub3coKSxcbiAgICAgIG9ic2VydmFiaWxpdHk6IHt9IGFzIGFueVxuICAgIH0sIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIExpc3QvQXJyYXkgZm9ybWF0XG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ3F1ZXJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTUwKSk7XG4gICAgICAgIHJldHVybiB7IGRhdGE6IFsge30sIHt9LCB7fSBdIH07XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgY2FwdHVyZWRFdmVudHMubGVuZ3RoIC0gMSBdLm1ldHJpY3M/Lml0ZW1Db3VudCkudG9CZSgzKTtcblxuICAgICAgLy8gU2luZ2xlIGl0ZW0gZm9ybWF0XG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ2dldCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDE1MCkpO1xuICAgICAgICByZXR1cm4geyBkYXRhOiB7IGlkOiAnMScgfSB9O1xuICAgICAgfSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIGNhcHR1cmVkRXZlbnRzLmxlbmd0aCAtIDEgXS5tZXRyaWNzPy5pdGVtQ291bnQpLnRvQmUoMSk7XG5cbiAgICAgIC8vIEVtcHR5IHJlc3VsdFxuICAgICAgYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjaygnVXNlcicsICdnZXQnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxNTApKTtcbiAgICAgICAgcmV0dXJuIHsgZGF0YTogbnVsbCB9O1xuICAgICAgfSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIGNhcHR1cmVkRXZlbnRzLmxlbmd0aCAtIDEgXS5tZXRyaWNzPy5pdGVtQ291bnQpLnRvQmUoMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgaGFuZGxlIGFuZCBlbWl0IGVycm9yIGV2ZW50cycsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgICBzdGFydFRpbWU6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5OiB7fSBhcyBhbnlcbiAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignRHluYW1vREIgQ29ubmVjdGlvbiBUaW1lb3V0Jyk7XG5cbiAgICAgIGNvbnN0IHByb21pc2UgPSBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ2dldCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgZXhwZWN0KHByb21pc2UpLnJlamVjdHMudG9UaHJvdygnRHluYW1vREIgQ29ubmVjdGlvbiBUaW1lb3V0Jyk7XG5cbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzWyAwIF0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnVXNlci5nZXQnLFxuICAgICAgICBlbnRpdHlOYW1lOiAnVXNlcicsXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlcnJvcjoge1xuICAgICAgICAgIHR5cGU6ICdFcnJvcicsXG4gICAgICAgICAgbWVzc2FnZTogJ0R5bmFtb0RCIENvbm5lY3Rpb24gVGltZW91dCdcbiAgICAgICAgfSxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGVudGl0eU5hbWU6ICdVc2VyJyxcbiAgICAgICAgICBvcGVyYXRpb246ICdnZXQnLFxuICAgICAgICAgIGVycm9yOiAndHJ1ZSdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGl0KCdzaG91bGQgcmVzcGVjdCBwZXItZW50aXR5IHRocmVzaG9sZCBvdmVycmlkZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgLy8gT3ZlcnJpZGUgdGhyZXNob2xkIGZvciAnTGFyZ2VFbnRpdHknIHRvIGJlIHZlcnkgaGlnaFxuICAgIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIHF1ZXJ5UGVyZm9ybWFuY2U6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc2xvd1RocmVzaG9sZDogMTAwLFxuICAgICAgICBlbnRpdHlPdmVycmlkZXM6IFtcbiAgICAgICAgICB7IGVudGl0eU5hbWU6ICdMYXJnZUVudGl0eScsIHNsb3dUaHJlc2hvbGQ6IDUwMCB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhjb25maWcpO1xuXG4gICAgLy8gUmVzZXQgY2FwdHVyZWQgZXZlbnRzIGZvciB0aGlzIHRlc3RcbiAgICBjYXB0dXJlZEV2ZW50cyA9IFtdO1xuXG4gICAgYXdhaXQgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoe1xuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24taWQnLFxuICAgICAgc3RhcnRUaW1lOiBEYXRlLm5vdygpLFxuICAgICAgb2JzZXJ2YWJpbGl0eToge30gYXMgYW55XG4gICAgfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gVGhpcyBxdWVyeSAoMjAwbXMpIGlzIHNsb3dlciB0aGFuIGRlZmF1bHQgKDEwMG1zKSBidXQgZmFzdGVyIHRoYW4gb3ZlcnJpZGUgKDUwMG1zKVxuICAgICAgYXdhaXQgUXVlcnlPYnNlcnZlci50cmFjaygnTGFyZ2VFbnRpdHknLCAnbGlzdCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDIwMCkpO1xuICAgICAgICByZXR1cm4geyBkYXRhOiBbXSB9O1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFNob3VsZCBiZSBkZWJ1ZyBsZXZlbCwgbm90IHdhcm4gKDIwMG1zIDwgNTAwbXMgdGhyZXNob2xkKVxuICAgICAgZXhwZWN0KGNhcHR1cmVkRXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHNbIDAgXS5sZXZlbCkudG9CZSgnZGVidWcnKTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgMCBdLnRhZ3M/LnNsb3dRdWVyeSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBpdCgnc2hvdWxkIGVtaXQgZXZlbnRzIGZvciBmYXN0IHF1ZXJpZXMgdGhhdCBub2lzZSByZWR1Y3Rpb24gY2FuIGZvbGQgaW50byBjaGVja3BvaW50cycsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCh7XG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbi1pZCcsXG4gICAgICBzdGFydFRpbWU6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5OiB7fSBhcyBhbnlcbiAgICB9LCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBRdWVyeU9ic2VydmVyLnRyYWNrKCdVc2VyJywgJ2dldCcsIGFzeW5jICgpID0+IHtcbiAgICAgICAgcmV0dXJuIHsgZGF0YTogeyBpZDogJzEnIH0gfTtcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QoY2FwdHVyZWRFdmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICAgIGV4cGVjdChjYXB0dXJlZEV2ZW50c1sgMCBdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbGV2ZWw6ICdkZWJ1ZycsXG4gICAgICAgIG9wZXJhdGlvbjogJ1VzZXIuZ2V0JyxcbiAgICAgICAgZW50aXR5TmFtZTogJ1VzZXInLFxuICAgICAgICBzdWNjZXNzOiB0cnVlXG4gICAgICB9KTtcbiAgICAgIC8vIE5vaXNlIHJlZHVjdGlvbiB3aWxsIGRlY2lkZSB3aGV0aGVyIHRvIGZvbGQgdGhpcyBpbnRvIGEgY2hlY2twb2ludCxcbiAgICAgIC8vIGFnZ3JlZ2F0ZSBpdCwgb3Iga2VlcCBpdCBhcyBhIHN0YW5kYWxvbmUgbG9nXG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=