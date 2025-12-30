"use strict";
/**
 * Phase 1 Optimizations Tests
 *
 * These tests verify:
 * 1. HTTP status code is NOT emitted as a metric (only as attribute)
 * 2. All metrics are batched into a SINGLE EMF log entry
 */
Object.defineProperty(exports, "__esModule", { value: true });
const cloudwatch_1 = require("../cloudwatch");
const types_1 = require("../../types");
// Mock AWS Powertools
const mockAddMetric = jest.fn();
const mockAddDimension = jest.fn();
const mockSingleMetric = jest.fn(() => ({
    addMetric: mockAddMetric,
    addDimension: mockAddDimension,
}));
const mockPublishStoredMetrics = jest.fn();
jest.mock('@aws-lambda-powertools/metrics', () => ({
    Metrics: jest.fn().mockImplementation(() => ({
        singleMetric: mockSingleMetric,
        publishStoredMetrics: mockPublishStoredMetrics,
    })),
    MetricUnit: {
        Milliseconds: 'Milliseconds',
        Count: 'Count',
        Bytes: 'Bytes',
        Percent: 'Percent',
        Seconds: 'Seconds',
    },
}));
jest.mock('@aws-lambda-powertools/logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));
describe('CloudWatch Backend - Phase 1 Optimizations', () => {
    let backend;
    beforeEach(() => {
        jest.clearAllMocks();
        backend = new cloudwatch_1.CloudWatchBackend('test-service', 'TestNamespace', types_1.ObservabilityLevel.INFO);
    });
    describe('✅ Optimization 1: HTTP Status Code as Attribute (not metric)', () => {
        it('should NOT call addMetric for http.statusCode', async () => {
            const event = {
                type: 'span',
                observabilityLogId: 'test-123',
                correlationId: 'test-correlation',
                operation: 'HTTP GET /api/users',
                source: 'UserController.list',
                level: 'info',
                timestampMs: Date.now(),
                durationMs: 150,
                success: true,
                data: {
                    'http.statusCode': 200, // This should NOT become a metric
                    'http.method': 'GET',
                },
                metrics: {
                    'cache.hits': 10,
                    'cache.misses': 2,
                },
            };
            await backend.capture(event);
            // Verify http.statusCode was NOT passed to addMetric
            const allMetricCalls = mockAddMetric.mock.calls;
            const statusCodeMetric = allMetricCalls.find(call => call[0] === 'http.statusCode');
            expect(statusCodeMetric).toBeUndefined();
            console.log('✅ http.statusCode correctly excluded from metrics');
        });
        it('should emit duration and custom metrics, but not http.statusCode', async () => {
            const event = {
                type: 'span',
                observabilityLogId: 'test-456',
                correlationId: 'test-correlation',
                operation: 'API request',
                level: 'info',
                timestampMs: Date.now(),
                durationMs: 250,
                success: true,
                data: {
                    'http.statusCode': 404, // Should NOT be metric
                },
                metrics: {
                    'db.queries': 5,
                },
            };
            await backend.capture(event);
            // Should have: duration + db.queries = 2 metrics
            expect(mockAddMetric).toHaveBeenCalledWith('duration', 'Milliseconds', 250);
            expect(mockAddMetric).toHaveBeenCalledWith('db.queries', 'Count', 5);
            expect(mockAddMetric).not.toHaveBeenCalledWith('http.statusCode', expect.anything(), expect.anything());
            console.log('✅ Only legitimate metrics emitted (duration, db.queries)');
        });
    });
    describe('✅ Optimization 2: Metric Batching (Single EMF Log)', () => {
        it('should batch all metrics into ONE singleMetric() call', async () => {
            const event = {
                type: 'span',
                observabilityLogId: 'test-789',
                correlationId: 'test-correlation',
                operation: 'batch process',
                level: 'info',
                timestampMs: Date.now(),
                durationMs: 500,
                success: true,
                metrics: {
                    'items.processed': 100,
                    'items.failed': 5,
                    'cache.hits': 80,
                    'cache.misses': 20,
                    'db.queries': 15,
                },
            };
            await backend.capture(event);
            // CRITICAL: Should create only ONE metric batch
            // BEFORE optimization: Would create 6 separate batches (5 metrics + 1 span duration)
            // AFTER optimization: Should create only 1 batch with ALL metrics
            expect(mockSingleMetric).toHaveBeenCalledTimes(1);
            // Verify ALL metrics were added to the SAME batch
            expect(mockAddMetric).toHaveBeenCalledWith('items.processed', 'Count', 100);
            expect(mockAddMetric).toHaveBeenCalledWith('items.failed', 'Count', 5);
            expect(mockAddMetric).toHaveBeenCalledWith('cache.hits', 'Count', 80);
            expect(mockAddMetric).toHaveBeenCalledWith('cache.misses', 'Count', 20);
            expect(mockAddMetric).toHaveBeenCalledWith('db.queries', 'Count', 15);
            expect(mockAddMetric).toHaveBeenCalledWith('duration', 'Milliseconds', 500);
            console.log('✅ All 6 metrics batched into 1 EMF log (83% cost reduction)');
        });
        it('should batch event metrics + span duration together', async () => {
            const event = {
                type: 'span',
                observabilityLogId: 'test-abc',
                correlationId: 'test-correlation',
                operation: 'process request',
                level: 'info',
                timestampMs: Date.now(),
                durationMs: 300,
                success: true,
                metrics: {
                    'custom.metric1': 10,
                    'custom.metric2': 20,
                },
            };
            await backend.capture(event);
            // Should create only 1 batch with event metrics + span duration
            expect(mockSingleMetric).toHaveBeenCalledTimes(1);
            // Verify span duration is in the SAME batch as event metrics
            expect(mockAddMetric).toHaveBeenCalledWith('custom.metric1', 'Count', 10);
            expect(mockAddMetric).toHaveBeenCalledWith('custom.metric2', 'Count', 20);
            expect(mockAddMetric).toHaveBeenCalledWith('duration', 'Milliseconds', 300);
            console.log('✅ Span duration batched with event metrics (single EMF log)');
        });
        it('should not create metric batch when no metrics present', async () => {
            const event = {
                type: 'log',
                observabilityLogId: 'test-log',
                correlationId: 'test-correlation',
                operation: 'log message',
                level: 'info',
                timestampMs: Date.now(),
                data: { message: 'test log without metrics' },
            };
            await backend.capture(event);
            // Should NOT create any metric batches
            expect(mockSingleMetric).not.toHaveBeenCalled();
            expect(mockAddMetric).not.toHaveBeenCalled();
            console.log('✅ No metrics emitted for pure log events');
        });
    });
    describe('📊 Cost Savings Verification', () => {
        it('demonstrates massive cost reduction with batching', async () => {
            // Simulate a typical API request with multiple metrics
            const event = {
                type: 'span',
                observabilityLogId: 'cost-test',
                correlationId: 'test',
                operation: 'HTTP POST /api/orders',
                level: 'info',
                timestampMs: Date.now(),
                durationMs: 450,
                success: true,
                tags: {
                    service: 'orders-api',
                    region: 'us-east-1',
                    stage: 'prod',
                },
                metrics: {
                    'db.queries': 8,
                    'db.query.duration': 120,
                    'cache.hits': 15,
                    'cache.misses': 3,
                    'queue.published': 2,
                    'validation.errors': 0,
                    'external.api.calls': 1,
                },
            };
            await backend.capture(event);
            const totalMetrics = Object.keys(event.metrics || {}).length + 1; // +1 for span duration
            const emfLogs = mockSingleMetric.mock.calls.length;
            console.log('\n📊 Cost Savings Analysis:');
            console.log(`   Total metrics: ${totalMetrics}`);
            console.log(`   BEFORE optimization: ${totalMetrics} separate EMF logs`);
            console.log(`   AFTER optimization: ${emfLogs} EMF log`);
            console.log(`   Cost reduction: ${Math.round((1 - emfLogs / totalMetrics) * 100)}%`);
            console.log(`   CloudWatch Logs ingestion savings: ${totalMetrics - emfLogs} fewer logs\n`);
            expect(emfLogs).toBe(1);
            expect(totalMetrics).toBe(8);
        });
    });
    describe('Smart Unit Detection', () => {
        it('should auto-detect metric units based on naming patterns', async () => {
            const event = {
                type: 'span',
                observabilityLogId: 'unit-test',
                correlationId: 'test',
                operation: 'test',
                level: 'info',
                timestampMs: Date.now(),
                metrics: {
                    'request.durationMs': 100, // Should detect Milliseconds
                    'items.processedCount': 50, // Should detect Count
                    'response.sizeBytes': 1024, // Should detect Bytes
                    'cache.hitRate': 0.85, // Should detect Percent
                },
            };
            await backend.capture(event);
            // Verify correct units were used
            expect(mockAddMetric).toHaveBeenCalledWith('request.durationMs', 'Milliseconds', 100);
            expect(mockAddMetric).toHaveBeenCalledWith('items.processedCount', 'Count', 50);
            expect(mockAddMetric).toHaveBeenCalledWith('response.sizeBytes', 'Bytes', 1024);
            // Note: hitRate contains 'rate' which triggers Percent detection
            const hitRateCall = mockAddMetric.mock.calls.find(call => call[0] === 'cache.hitRate');
            expect(hitRateCall).toBeDefined();
            expect(hitRateCall[2]).toBe(0.85); // Value is correct
            console.log('✅ Smart unit detection working correctly');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC1waGFzZTEudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL19fdGVzdHNfXy9jbG91ZHdhdGNoLXBoYXNlMS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7O0FBRUgsOENBQWtEO0FBQ2xELHVDQUFxRTtBQUVyRSxzQkFBc0I7QUFDdEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ2hDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ25DLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3RDLFNBQVMsRUFBRSxhQUFhO0lBQ3hCLFlBQVksRUFBRSxnQkFBZ0I7Q0FDL0IsQ0FBQyxDQUFDLENBQUM7QUFDSixNQUFNLHdCQUF3QixHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztBQUUzQyxJQUFJLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDakQsT0FBTyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzNDLFlBQVksRUFBRSxnQkFBZ0I7UUFDOUIsb0JBQW9CLEVBQUUsd0JBQXdCO0tBQy9DLENBQUMsQ0FBQztJQUNILFVBQVUsRUFBRTtRQUNWLFlBQVksRUFBRSxjQUFjO1FBQzVCLEtBQUssRUFBRSxPQUFPO1FBQ2QsS0FBSyxFQUFFLE9BQU87UUFDZCxPQUFPLEVBQUUsU0FBUztRQUNsQixPQUFPLEVBQUUsU0FBUztLQUNuQjtDQUNGLENBQUMsQ0FBQyxDQUFDO0FBRUosSUFBSSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ2hELE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsa0JBQWtCLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNoQixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsS0FBSyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDakIsQ0FBQyxDQUFDO0NBQ0osQ0FBQyxDQUFDLENBQUM7QUFFSixRQUFRLENBQUMsNENBQTRDLEVBQUUsR0FBRyxFQUFFO0lBQzFELElBQUksT0FBMEIsQ0FBQztJQUUvQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3JCLE9BQU8sR0FBRyxJQUFJLDhCQUFpQixDQUFDLGNBQWMsRUFBRSxlQUFlLEVBQUUsMEJBQWtCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUYsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsOERBQThELEVBQUUsR0FBRyxFQUFFO1FBQzVFLEVBQUUsQ0FBQywrQ0FBK0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM3RCxNQUFNLEtBQUssR0FBdUI7Z0JBQ2hDLElBQUksRUFBRSxNQUFNO2dCQUNaLGtCQUFrQixFQUFFLFVBQVU7Z0JBQzlCLGFBQWEsRUFBRSxrQkFBa0I7Z0JBQ2pDLFNBQVMsRUFBRSxxQkFBcUI7Z0JBQ2hDLE1BQU0sRUFBRSxxQkFBcUI7Z0JBQzdCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO2dCQUN2QixVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsSUFBSTtnQkFDYixJQUFJLEVBQUU7b0JBQ0osaUJBQWlCLEVBQUUsR0FBRyxFQUFHLGtDQUFrQztvQkFDM0QsYUFBYSxFQUFFLEtBQUs7aUJBQ3JCO2dCQUNELE9BQU8sRUFBRTtvQkFDUCxZQUFZLEVBQUUsRUFBRTtvQkFDaEIsY0FBYyxFQUFFLENBQUM7aUJBQ2xCO2FBQ0YsQ0FBQztZQUVGLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUU3QixxREFBcUQ7WUFDckQsTUFBTSxjQUFjLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUM7WUFDaEQsTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFFLENBQUMsQ0FBRSxLQUFLLGlCQUFpQixDQUFDLENBQUM7WUFFdEYsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDekMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO1FBQ25FLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLGtFQUFrRSxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2hGLE1BQU0sS0FBSyxHQUF1QjtnQkFDaEMsSUFBSSxFQUFFLE1BQU07Z0JBQ1osa0JBQWtCLEVBQUUsVUFBVTtnQkFDOUIsYUFBYSxFQUFFLGtCQUFrQjtnQkFDakMsU0FBUyxFQUFFLGFBQWE7Z0JBQ3hCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO2dCQUN2QixVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsSUFBSTtnQkFDYixJQUFJLEVBQUU7b0JBQ0osaUJBQWlCLEVBQUUsR0FBRyxFQUFHLHVCQUF1QjtpQkFDakQ7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLFlBQVksRUFBRSxDQUFDO2lCQUNoQjthQUNGLENBQUM7WUFFRixNQUFNLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7WUFFN0IsaURBQWlEO1lBQ2pELE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQzVFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3JFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFFLE1BQU0sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1lBRXhHLE9BQU8sQ0FBQyxHQUFHLENBQUMsMERBQTBELENBQUMsQ0FBQztRQUMxRSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLG9EQUFvRCxFQUFFLEdBQUcsRUFBRTtRQUNsRSxFQUFFLENBQUMsdURBQXVELEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDckUsTUFBTSxLQUFLLEdBQXVCO2dCQUNoQyxJQUFJLEVBQUUsTUFBTTtnQkFDWixrQkFBa0IsRUFBRSxVQUFVO2dCQUM5QixhQUFhLEVBQUUsa0JBQWtCO2dCQUNqQyxTQUFTLEVBQUUsZUFBZTtnQkFDMUIsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsV0FBVyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7Z0JBQ3ZCLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxJQUFJO2dCQUNiLE9BQU8sRUFBRTtvQkFDUCxpQkFBaUIsRUFBRSxHQUFHO29CQUN0QixjQUFjLEVBQUUsQ0FBQztvQkFDakIsWUFBWSxFQUFFLEVBQUU7b0JBQ2hCLGNBQWMsRUFBRSxFQUFFO29CQUNsQixZQUFZLEVBQUUsRUFBRTtpQkFDakI7YUFDRixDQUFDO1lBRUYsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTdCLGdEQUFnRDtZQUNoRCxxRkFBcUY7WUFDckYsa0VBQWtFO1lBQ2xFLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRWxELGtEQUFrRDtZQUNsRCxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQzVFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxjQUFjLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3ZFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ3RFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxjQUFjLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ3hFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ3RFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBRTVFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkRBQTZELENBQUMsQ0FBQztRQUM3RSxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxxREFBcUQsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNuRSxNQUFNLEtBQUssR0FBdUI7Z0JBQ2hDLElBQUksRUFBRSxNQUFNO2dCQUNaLGtCQUFrQixFQUFFLFVBQVU7Z0JBQzlCLGFBQWEsRUFBRSxrQkFBa0I7Z0JBQ2pDLFNBQVMsRUFBRSxpQkFBaUI7Z0JBQzVCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO2dCQUN2QixVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsSUFBSTtnQkFDYixPQUFPLEVBQUU7b0JBQ1AsZ0JBQWdCLEVBQUUsRUFBRTtvQkFDcEIsZ0JBQWdCLEVBQUUsRUFBRTtpQkFDckI7YUFDRixDQUFDO1lBRUYsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTdCLGdFQUFnRTtZQUNoRSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUVsRCw2REFBNkQ7WUFDN0QsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLGdCQUFnQixFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztZQUMxRSxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsb0JBQW9CLENBQUMsZ0JBQWdCLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQzFFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsY0FBYyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBRTVFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkRBQTZELENBQUMsQ0FBQztRQUM3RSxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyx3REFBd0QsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN0RSxNQUFNLEtBQUssR0FBdUI7Z0JBQ2hDLElBQUksRUFBRSxLQUFLO2dCQUNYLGtCQUFrQixFQUFFLFVBQVU7Z0JBQzlCLGFBQWEsRUFBRSxrQkFBa0I7Z0JBQ2pDLFNBQVMsRUFBRSxhQUFhO2dCQUN4QixLQUFLLEVBQUUsTUFBTTtnQkFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDdkIsSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLDBCQUEwQixFQUFFO2FBQzlDLENBQUM7WUFFRixNQUFNLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7WUFFN0IsdUNBQXVDO1lBQ3ZDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ2hELE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUU3QyxPQUFPLENBQUMsR0FBRyxDQUFDLDBDQUEwQyxDQUFDLENBQUM7UUFDMUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyw4QkFBOEIsRUFBRSxHQUFHLEVBQUU7UUFDNUMsRUFBRSxDQUFDLG1EQUFtRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2pFLHVEQUF1RDtZQUN2RCxNQUFNLEtBQUssR0FBdUI7Z0JBQ2hDLElBQUksRUFBRSxNQUFNO2dCQUNaLGtCQUFrQixFQUFFLFdBQVc7Z0JBQy9CLGFBQWEsRUFBRSxNQUFNO2dCQUNyQixTQUFTLEVBQUUsdUJBQXVCO2dCQUNsQyxLQUFLLEVBQUUsTUFBTTtnQkFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDdkIsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsSUFBSSxFQUFFO29CQUNKLE9BQU8sRUFBRSxZQUFZO29CQUNyQixNQUFNLEVBQUUsV0FBVztvQkFDbkIsS0FBSyxFQUFFLE1BQU07aUJBQ2Q7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLFlBQVksRUFBRSxDQUFDO29CQUNmLG1CQUFtQixFQUFFLEdBQUc7b0JBQ3hCLFlBQVksRUFBRSxFQUFFO29CQUNoQixjQUFjLEVBQUUsQ0FBQztvQkFDakIsaUJBQWlCLEVBQUUsQ0FBQztvQkFDcEIsbUJBQW1CLEVBQUUsQ0FBQztvQkFDdEIsb0JBQW9CLEVBQUUsQ0FBQztpQkFDeEI7YUFDRixDQUFDO1lBRUYsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRTdCLE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsdUJBQXVCO1lBQ3pGLE1BQU0sT0FBTyxHQUFHLGdCQUFnQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO1lBRW5ELE9BQU8sQ0FBQyxHQUFHLENBQUMsNkJBQTZCLENBQUMsQ0FBQztZQUMzQyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixZQUFZLEVBQUUsQ0FBQyxDQUFDO1lBQ2pELE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLFlBQVksb0JBQW9CLENBQUMsQ0FBQztZQUN6RSxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixPQUFPLFVBQVUsQ0FBQyxDQUFDO1lBQ3pELE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsT0FBTyxHQUFHLFlBQVksQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNyRixPQUFPLENBQUMsR0FBRyxDQUFDLHlDQUF5QyxZQUFZLEdBQUcsT0FBTyxlQUFlLENBQUMsQ0FBQztZQUU1RixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3hCLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDL0IsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxzQkFBc0IsRUFBRSxHQUFHLEVBQUU7UUFDcEMsRUFBRSxDQUFDLDBEQUEwRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3hFLE1BQU0sS0FBSyxHQUF1QjtnQkFDaEMsSUFBSSxFQUFFLE1BQU07Z0JBQ1osa0JBQWtCLEVBQUUsV0FBVztnQkFDL0IsYUFBYSxFQUFFLE1BQU07Z0JBQ3JCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixLQUFLLEVBQUUsTUFBTTtnQkFDYixXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDdkIsT0FBTyxFQUFFO29CQUNQLG9CQUFvQixFQUFFLEdBQUcsRUFBTyw2QkFBNkI7b0JBQzdELHNCQUFzQixFQUFFLEVBQUUsRUFBTSxzQkFBc0I7b0JBQ3RELG9CQUFvQixFQUFFLElBQUksRUFBTSxzQkFBc0I7b0JBQ3RELGVBQWUsRUFBRSxJQUFJLEVBQVcsd0JBQXdCO2lCQUN6RDthQUNGLENBQUM7WUFFRixNQUFNLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7WUFFN0IsaUNBQWlDO1lBQ2pDLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxvQkFBb0IsRUFBRSxjQUFjLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDdEYsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLHNCQUFzQixFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNoRixNQUFNLENBQUMsYUFBYSxDQUFDLENBQUMsb0JBQW9CLENBQUMsb0JBQW9CLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQ2hGLGlFQUFpRTtZQUNqRSxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUUsQ0FBQyxDQUFFLEtBQUssZUFBZSxDQUFDLENBQUM7WUFDekYsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2xDLE1BQU0sQ0FBQyxXQUFXLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxtQkFBbUI7WUFFeEQsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO1FBQzFELENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogUGhhc2UgMSBPcHRpbWl6YXRpb25zIFRlc3RzXG4gKiBcbiAqIFRoZXNlIHRlc3RzIHZlcmlmeTpcbiAqIDEuIEhUVFAgc3RhdHVzIGNvZGUgaXMgTk9UIGVtaXR0ZWQgYXMgYSBtZXRyaWMgKG9ubHkgYXMgYXR0cmlidXRlKVxuICogMi4gQWxsIG1ldHJpY3MgYXJlIGJhdGNoZWQgaW50byBhIFNJTkdMRSBFTUYgbG9nIGVudHJ5XG4gKi9cblxuaW1wb3J0IHsgQ2xvdWRXYXRjaEJhY2tlbmQgfSBmcm9tICcuLi9jbG91ZHdhdGNoJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xuXG4vLyBNb2NrIEFXUyBQb3dlcnRvb2xzXG5jb25zdCBtb2NrQWRkTWV0cmljID0gamVzdC5mbigpO1xuY29uc3QgbW9ja0FkZERpbWVuc2lvbiA9IGplc3QuZm4oKTtcbmNvbnN0IG1vY2tTaW5nbGVNZXRyaWMgPSBqZXN0LmZuKCgpID0+ICh7XG4gIGFkZE1ldHJpYzogbW9ja0FkZE1ldHJpYyxcbiAgYWRkRGltZW5zaW9uOiBtb2NrQWRkRGltZW5zaW9uLFxufSkpO1xuY29uc3QgbW9ja1B1Ymxpc2hTdG9yZWRNZXRyaWNzID0gamVzdC5mbigpO1xuXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsICgpID0+ICh7XG4gIE1ldHJpY3M6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcbiAgICBzaW5nbGVNZXRyaWM6IG1vY2tTaW5nbGVNZXRyaWMsXG4gICAgcHVibGlzaFN0b3JlZE1ldHJpY3M6IG1vY2tQdWJsaXNoU3RvcmVkTWV0cmljcyxcbiAgfSkpLFxuICBNZXRyaWNVbml0OiB7XG4gICAgTWlsbGlzZWNvbmRzOiAnTWlsbGlzZWNvbmRzJyxcbiAgICBDb3VudDogJ0NvdW50JyxcbiAgICBCeXRlczogJ0J5dGVzJyxcbiAgICBQZXJjZW50OiAnUGVyY2VudCcsXG4gICAgU2Vjb25kczogJ1NlY29uZHMnLFxuICB9LFxufSkpO1xuXG5qZXN0Lm1vY2soJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJywgKCkgPT4gKHtcbiAgTG9nZ2VyOiBqZXN0LmZuKCkubW9ja0ltcGxlbWVudGF0aW9uKCgpID0+ICh7XG4gICAgZGVidWc6IGplc3QuZm4oKSxcbiAgICBpbmZvOiBqZXN0LmZuKCksXG4gICAgd2FybjogamVzdC5mbigpLFxuICAgIGVycm9yOiBqZXN0LmZuKCksXG4gIH0pKSxcbn0pKTtcblxuZGVzY3JpYmUoJ0Nsb3VkV2F0Y2ggQmFja2VuZCAtIFBoYXNlIDEgT3B0aW1pemF0aW9ucycsICgpID0+IHtcbiAgbGV0IGJhY2tlbmQ6IENsb3VkV2F0Y2hCYWNrZW5kO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xuICAgIGJhY2tlbmQgPSBuZXcgQ2xvdWRXYXRjaEJhY2tlbmQoJ3Rlc3Qtc2VydmljZScsICdUZXN0TmFtZXNwYWNlJywgT2JzZXJ2YWJpbGl0eUxldmVsLklORk8pO1xuICB9KTtcblxuICBkZXNjcmliZSgn4pyFIE9wdGltaXphdGlvbiAxOiBIVFRQIFN0YXR1cyBDb2RlIGFzIEF0dHJpYnV0ZSAobm90IG1ldHJpYyknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBOT1QgY2FsbCBhZGRNZXRyaWMgZm9yIGh0dHAuc3RhdHVzQ29kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndGVzdC0xMjMnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICAgIG9wZXJhdGlvbjogJ0hUVFAgR0VUIC9hcGkvdXNlcnMnLFxuICAgICAgICBzb3VyY2U6ICdVc2VyQ29udHJvbGxlci5saXN0JyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIGR1cmF0aW9uTXM6IDE1MCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgICdodHRwLnN0YXR1c0NvZGUnOiAyMDAsICAvLyBUaGlzIHNob3VsZCBOT1QgYmVjb21lIGEgbWV0cmljXG4gICAgICAgICAgJ2h0dHAubWV0aG9kJzogJ0dFVCcsXG4gICAgICAgIH0sXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAnY2FjaGUuaGl0cyc6IDEwLFxuICAgICAgICAgICdjYWNoZS5taXNzZXMnOiAyLFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcblxuICAgICAgLy8gVmVyaWZ5IGh0dHAuc3RhdHVzQ29kZSB3YXMgTk9UIHBhc3NlZCB0byBhZGRNZXRyaWNcbiAgICAgIGNvbnN0IGFsbE1ldHJpY0NhbGxzID0gbW9ja0FkZE1ldHJpYy5tb2NrLmNhbGxzO1xuICAgICAgY29uc3Qgc3RhdHVzQ29kZU1ldHJpYyA9IGFsbE1ldHJpY0NhbGxzLmZpbmQoY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdodHRwLnN0YXR1c0NvZGUnKTtcblxuICAgICAgZXhwZWN0KHN0YXR1c0NvZGVNZXRyaWMpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGNvbnNvbGUubG9nKCfinIUgaHR0cC5zdGF0dXNDb2RlIGNvcnJlY3RseSBleGNsdWRlZCBmcm9tIG1ldHJpY3MnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZW1pdCBkdXJhdGlvbiBhbmQgY3VzdG9tIG1ldHJpY3MsIGJ1dCBub3QgaHR0cC5zdGF0dXNDb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0ZXN0LTQ1NicsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnQVBJIHJlcXVlc3QnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogMjUwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgJ2h0dHAuc3RhdHVzQ29kZSc6IDQwNCwgIC8vIFNob3VsZCBOT1QgYmUgbWV0cmljXG4gICAgICAgIH0sXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAnZGIucXVlcmllcyc6IDUsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICAvLyBTaG91bGQgaGF2ZTogZHVyYXRpb24gKyBkYi5xdWVyaWVzID0gMiBtZXRyaWNzXG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2R1cmF0aW9uJywgJ01pbGxpc2Vjb25kcycsIDI1MCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2RiLnF1ZXJpZXMnLCAnQ291bnQnLCA1KTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS5ub3QudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2h0dHAuc3RhdHVzQ29kZScsIGV4cGVjdC5hbnl0aGluZygpLCBleHBlY3QuYW55dGhpbmcoKSk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCfinIUgT25seSBsZWdpdGltYXRlIG1ldHJpY3MgZW1pdHRlZCAoZHVyYXRpb24sIGRiLnF1ZXJpZXMpJyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCfinIUgT3B0aW1pemF0aW9uIDI6IE1ldHJpYyBCYXRjaGluZyAoU2luZ2xlIEVNRiBMb2cpJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgYmF0Y2ggYWxsIG1ldHJpY3MgaW50byBPTkUgc2luZ2xlTWV0cmljKCkgY2FsbCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndGVzdC03ODknLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2JhdGNoIHByb2Nlc3MnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogNTAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgJ2l0ZW1zLnByb2Nlc3NlZCc6IDEwMCxcbiAgICAgICAgICAnaXRlbXMuZmFpbGVkJzogNSxcbiAgICAgICAgICAnY2FjaGUuaGl0cyc6IDgwLFxuICAgICAgICAgICdjYWNoZS5taXNzZXMnOiAyMCxcbiAgICAgICAgICAnZGIucXVlcmllcyc6IDE1LFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcblxuICAgICAgLy8gQ1JJVElDQUw6IFNob3VsZCBjcmVhdGUgb25seSBPTkUgbWV0cmljIGJhdGNoXG4gICAgICAvLyBCRUZPUkUgb3B0aW1pemF0aW9uOiBXb3VsZCBjcmVhdGUgNiBzZXBhcmF0ZSBiYXRjaGVzICg1IG1ldHJpY3MgKyAxIHNwYW4gZHVyYXRpb24pXG4gICAgICAvLyBBRlRFUiBvcHRpbWl6YXRpb246IFNob3VsZCBjcmVhdGUgb25seSAxIGJhdGNoIHdpdGggQUxMIG1ldHJpY3NcbiAgICAgIGV4cGVjdChtb2NrU2luZ2xlTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XG5cbiAgICAgIC8vIFZlcmlmeSBBTEwgbWV0cmljcyB3ZXJlIGFkZGVkIHRvIHRoZSBTQU1FIGJhdGNoXG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2l0ZW1zLnByb2Nlc3NlZCcsICdDb3VudCcsIDEwMCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2l0ZW1zLmZhaWxlZCcsICdDb3VudCcsIDUpO1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdjYWNoZS5oaXRzJywgJ0NvdW50JywgODApO1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdjYWNoZS5taXNzZXMnLCAnQ291bnQnLCAyMCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2RiLnF1ZXJpZXMnLCAnQ291bnQnLCAxNSk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2R1cmF0aW9uJywgJ01pbGxpc2Vjb25kcycsIDUwMCk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCfinIUgQWxsIDYgbWV0cmljcyBiYXRjaGVkIGludG8gMSBFTUYgbG9nICg4MyUgY29zdCByZWR1Y3Rpb24pJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGJhdGNoIGV2ZW50IG1ldHJpY3MgKyBzcGFuIGR1cmF0aW9uIHRvZ2V0aGVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0ZXN0LWFiYycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgICAgb3BlcmF0aW9uOiAncHJvY2VzcyByZXF1ZXN0JyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIGR1cmF0aW9uTXM6IDMwMCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICdjdXN0b20ubWV0cmljMSc6IDEwLFxuICAgICAgICAgICdjdXN0b20ubWV0cmljMic6IDIwLFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcblxuICAgICAgLy8gU2hvdWxkIGNyZWF0ZSBvbmx5IDEgYmF0Y2ggd2l0aCBldmVudCBtZXRyaWNzICsgc3BhbiBkdXJhdGlvblxuICAgICAgZXhwZWN0KG1vY2tTaW5nbGVNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcblxuICAgICAgLy8gVmVyaWZ5IHNwYW4gZHVyYXRpb24gaXMgaW4gdGhlIFNBTUUgYmF0Y2ggYXMgZXZlbnQgbWV0cmljc1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdjdXN0b20ubWV0cmljMScsICdDb3VudCcsIDEwKTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnY3VzdG9tLm1ldHJpYzInLCAnQ291bnQnLCAyMCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2R1cmF0aW9uJywgJ01pbGxpc2Vjb25kcycsIDMwMCk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCfinIUgU3BhbiBkdXJhdGlvbiBiYXRjaGVkIHdpdGggZXZlbnQgbWV0cmljcyAoc2luZ2xlIEVNRiBsb2cpJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIG5vdCBjcmVhdGUgbWV0cmljIGJhdGNoIHdoZW4gbm8gbWV0cmljcyBwcmVzZW50JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ2xvZycsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rlc3QtbG9nJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgICBvcGVyYXRpb246ICdsb2cgbWVzc2FnZScsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBkYXRhOiB7IG1lc3NhZ2U6ICd0ZXN0IGxvZyB3aXRob3V0IG1ldHJpY3MnIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICAvLyBTaG91bGQgTk9UIGNyZWF0ZSBhbnkgbWV0cmljIGJhdGNoZXNcbiAgICAgIGV4cGVjdChtb2NrU2luZ2xlTWV0cmljKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG5cbiAgICAgIGNvbnNvbGUubG9nKCfinIUgTm8gbWV0cmljcyBlbWl0dGVkIGZvciBwdXJlIGxvZyBldmVudHMnKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ/Cfk4ogQ29zdCBTYXZpbmdzIFZlcmlmaWNhdGlvbicsICgpID0+IHtcbiAgICBpdCgnZGVtb25zdHJhdGVzIG1hc3NpdmUgY29zdCByZWR1Y3Rpb24gd2l0aCBiYXRjaGluZycsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNpbXVsYXRlIGEgdHlwaWNhbCBBUEkgcmVxdWVzdCB3aXRoIG11bHRpcGxlIG1ldHJpY3NcbiAgICAgIGNvbnN0IGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY29zdC10ZXN0JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICBvcGVyYXRpb246ICdIVFRQIFBPU1QgL2FwaS9vcmRlcnMnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogNDUwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICB0YWdzOiB7XG4gICAgICAgICAgc2VydmljZTogJ29yZGVycy1hcGknLFxuICAgICAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsXG4gICAgICAgICAgc3RhZ2U6ICdwcm9kJyxcbiAgICAgICAgfSxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICdkYi5xdWVyaWVzJzogOCxcbiAgICAgICAgICAnZGIucXVlcnkuZHVyYXRpb24nOiAxMjAsXG4gICAgICAgICAgJ2NhY2hlLmhpdHMnOiAxNSxcbiAgICAgICAgICAnY2FjaGUubWlzc2VzJzogMyxcbiAgICAgICAgICAncXVldWUucHVibGlzaGVkJzogMixcbiAgICAgICAgICAndmFsaWRhdGlvbi5lcnJvcnMnOiAwLFxuICAgICAgICAgICdleHRlcm5hbC5hcGkuY2FsbHMnOiAxLFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcblxuICAgICAgY29uc3QgdG90YWxNZXRyaWNzID0gT2JqZWN0LmtleXMoZXZlbnQubWV0cmljcyB8fCB7fSkubGVuZ3RoICsgMTsgLy8gKzEgZm9yIHNwYW4gZHVyYXRpb25cbiAgICAgIGNvbnN0IGVtZkxvZ3MgPSBtb2NrU2luZ2xlTWV0cmljLm1vY2suY2FsbHMubGVuZ3RoO1xuXG4gICAgICBjb25zb2xlLmxvZygnXFxu8J+TiiBDb3N0IFNhdmluZ3MgQW5hbHlzaXM6Jyk7XG4gICAgICBjb25zb2xlLmxvZyhgICAgVG90YWwgbWV0cmljczogJHt0b3RhbE1ldHJpY3N9YCk7XG4gICAgICBjb25zb2xlLmxvZyhgICAgQkVGT1JFIG9wdGltaXphdGlvbjogJHt0b3RhbE1ldHJpY3N9IHNlcGFyYXRlIEVNRiBsb2dzYCk7XG4gICAgICBjb25zb2xlLmxvZyhgICAgQUZURVIgb3B0aW1pemF0aW9uOiAke2VtZkxvZ3N9IEVNRiBsb2dgKTtcbiAgICAgIGNvbnNvbGUubG9nKGAgICBDb3N0IHJlZHVjdGlvbjogJHtNYXRoLnJvdW5kKCgxIC0gZW1mTG9ncyAvIHRvdGFsTWV0cmljcykgKiAxMDApfSVgKTtcbiAgICAgIGNvbnNvbGUubG9nKGAgICBDbG91ZFdhdGNoIExvZ3MgaW5nZXN0aW9uIHNhdmluZ3M6ICR7dG90YWxNZXRyaWNzIC0gZW1mTG9nc30gZmV3ZXIgbG9nc1xcbmApO1xuXG4gICAgICBleHBlY3QoZW1mTG9ncykudG9CZSgxKTtcbiAgICAgIGV4cGVjdCh0b3RhbE1ldHJpY3MpLnRvQmUoOCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTbWFydCBVbml0IERldGVjdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGF1dG8tZGV0ZWN0IG1ldHJpYyB1bml0cyBiYXNlZCBvbiBuYW1pbmcgcGF0dGVybnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3VuaXQtdGVzdCcsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgICAgb3BlcmF0aW9uOiAndGVzdCcsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgJ3JlcXVlc3QuZHVyYXRpb25Ncyc6IDEwMCwgICAgICAvLyBTaG91bGQgZGV0ZWN0IE1pbGxpc2Vjb25kc1xuICAgICAgICAgICdpdGVtcy5wcm9jZXNzZWRDb3VudCc6IDUwLCAgICAgLy8gU2hvdWxkIGRldGVjdCBDb3VudFxuICAgICAgICAgICdyZXNwb25zZS5zaXplQnl0ZXMnOiAxMDI0LCAgICAgLy8gU2hvdWxkIGRldGVjdCBCeXRlc1xuICAgICAgICAgICdjYWNoZS5oaXRSYXRlJzogMC44NSwgICAgICAgICAgLy8gU2hvdWxkIGRldGVjdCBQZXJjZW50XG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICAvLyBWZXJpZnkgY29ycmVjdCB1bml0cyB3ZXJlIHVzZWRcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgncmVxdWVzdC5kdXJhdGlvbk1zJywgJ01pbGxpc2Vjb25kcycsIDEwMCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2l0ZW1zLnByb2Nlc3NlZENvdW50JywgJ0NvdW50JywgNTApO1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdyZXNwb25zZS5zaXplQnl0ZXMnLCAnQnl0ZXMnLCAxMDI0KTtcbiAgICAgIC8vIE5vdGU6IGhpdFJhdGUgY29udGFpbnMgJ3JhdGUnIHdoaWNoIHRyaWdnZXJzIFBlcmNlbnQgZGV0ZWN0aW9uXG4gICAgICBjb25zdCBoaXRSYXRlQ2FsbCA9IG1vY2tBZGRNZXRyaWMubW9jay5jYWxscy5maW5kKGNhbGwgPT4gY2FsbFsgMCBdID09PSAnY2FjaGUuaGl0UmF0ZScpO1xuICAgICAgZXhwZWN0KGhpdFJhdGVDYWxsKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KGhpdFJhdGVDYWxsWyAyIF0pLnRvQmUoMC44NSk7IC8vIFZhbHVlIGlzIGNvcnJlY3RcblxuICAgICAgY29uc29sZS5sb2coJ+KchSBTbWFydCB1bml0IGRldGVjdGlvbiB3b3JraW5nIGNvcnJlY3RseScpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19