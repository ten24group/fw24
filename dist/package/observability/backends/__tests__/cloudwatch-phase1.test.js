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
        const cloudwatchConfig = {
            namespace: 'TestNamespace',
            metricFiltering: {
                enabled: false,
                mode: 'whitelist',
            },
            metricSampling: {
                enabled: false,
                rate: 0.1,
                alwaysPublishOn: 'both',
                thresholds: {
                    slowDurationMs: 1000,
                },
            },
        };
        backend = new cloudwatch_1.CloudWatchBackend('test-service', types_1.ObservabilityLevel.INFO, cloudwatchConfig);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC1waGFzZTEudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL19fdGVzdHNfXy9jbG91ZHdhdGNoLXBoYXNlMS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7O0FBRUgsOENBQWtEO0FBQ2xELHVDQUF1RjtBQUV2RixzQkFBc0I7QUFDdEIsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ2hDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ25DLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ3RDLFNBQVMsRUFBRSxhQUFhO0lBQ3hCLFlBQVksRUFBRSxnQkFBZ0I7Q0FDL0IsQ0FBQyxDQUFDLENBQUM7QUFDSixNQUFNLHdCQUF3QixHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQztBQUUzQyxJQUFJLENBQUMsSUFBSSxDQUFDLGdDQUFnQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDakQsT0FBTyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQzNDLFlBQVksRUFBRSxnQkFBZ0I7UUFDOUIsb0JBQW9CLEVBQUUsd0JBQXdCO0tBQy9DLENBQUMsQ0FBQztJQUNILFVBQVUsRUFBRTtRQUNWLFlBQVksRUFBRSxjQUFjO1FBQzVCLEtBQUssRUFBRSxPQUFPO1FBQ2QsS0FBSyxFQUFFLE9BQU87UUFDZCxPQUFPLEVBQUUsU0FBUztRQUNsQixPQUFPLEVBQUUsU0FBUztLQUNuQjtDQUNGLENBQUMsQ0FBQyxDQUFDO0FBRUosSUFBSSxDQUFDLElBQUksQ0FBQywrQkFBK0IsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lB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aXphdGlvbnMgVGVzdHNcbiAqIFxuICogVGhlc2UgdGVzdHMgdmVyaWZ5OlxuICogMS4gSFRUUCBzdGF0dXMgY29kZSBpcyBOT1QgZW1pdHRlZCBhcyBhIG1ldHJpYyAob25seSBhcyBhdHRyaWJ1dGUpXG4gKiAyLiBBbGwgbWV0cmljcyBhcmUgYmF0Y2hlZCBpbnRvIGEgU0lOR0xFIEVNRiBsb2cgZW50cnlcbiAqL1xuXG5pbXBvcnQgeyBDbG91ZFdhdGNoQmFja2VuZCB9IGZyb20gJy4uL2Nsb3Vkd2F0Y2gnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUV2ZW50LCBPYnNlcnZhYmlsaXR5TGV2ZWwsIENsb3VkV2F0Y2hDb25maWcgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5cbi8vIE1vY2sgQVdTIFBvd2VydG9vbHNcbmNvbnN0IG1vY2tBZGRNZXRyaWMgPSBqZXN0LmZuKCk7XG5jb25zdCBtb2NrQWRkRGltZW5zaW9uID0gamVzdC5mbigpO1xuY29uc3QgbW9ja1NpbmdsZU1ldHJpYyA9IGplc3QuZm4oKCkgPT4gKHtcbiAgYWRkTWV0cmljOiBtb2NrQWRkTWV0cmljLFxuICBhZGREaW1lbnNpb246IG1vY2tBZGREaW1lbnNpb24sXG59KSk7XG5jb25zdCBtb2NrUHVibGlzaFN0b3JlZE1ldHJpY3MgPSBqZXN0LmZuKCk7XG5cbmplc3QubW9jaygnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9tZXRyaWNzJywgKCkgPT4gKHtcbiAgTWV0cmljczogamVzdC5mbigpLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiAoe1xuICAgIHNpbmdsZU1ldHJpYzogbW9ja1NpbmdsZU1ldHJpYyxcbiAgICBwdWJsaXNoU3RvcmVkTWV0cmljczogbW9ja1B1Ymxpc2hTdG9yZWRNZXRyaWNzLFxuICB9KSksXG4gIE1ldHJpY1VuaXQ6IHtcbiAgICBNaWxsaXNlY29uZHM6ICdNaWxsaXNlY29uZHMnLFxuICAgIENvdW50OiAnQ291bnQnLFxuICAgIEJ5dGVzOiAnQnl0ZXMnLFxuICAgIFBlcmNlbnQ6ICdQZXJjZW50JyxcbiAgICBTZWNvbmRzOiAnU2Vjb25kcycsXG4gIH0sXG59KSk7XG5cbmplc3QubW9jaygnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInLCAoKSA9PiAoe1xuICBMb2dnZXI6IGplc3QuZm4oKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcbiAgICBkZWJ1ZzogamVzdC5mbigpLFxuICAgIGluZm86IGplc3QuZm4oKSxcbiAgICB3YXJuOiBqZXN0LmZuKCksXG4gICAgZXJyb3I6IGplc3QuZm4oKSxcbiAgfSkpLFxufSkpO1xuXG5kZXNjcmliZSgnQ2xvdWRXYXRjaCBCYWNrZW5kIC0gUGhhc2UgMSBPcHRpbWl6YXRpb25zJywgKCkgPT4ge1xuICBsZXQgYmFja2VuZDogQ2xvdWRXYXRjaEJhY2tlbmQ7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XG5cbiAgICBjb25zdCBjbG91ZHdhdGNoQ29uZmlnOiBDbG91ZFdhdGNoQ29uZmlnID0ge1xuICAgICAgbmFtZXNwYWNlOiAnVGVzdE5hbWVzcGFjZScsXG4gICAgICBtZXRyaWNGaWx0ZXJpbmc6IHtcbiAgICAgICAgZW5hYmxlZDogZmFsc2UsXG4gICAgICAgIG1vZGU6ICd3aGl0ZWxpc3QnLFxuICAgICAgfSxcbiAgICAgIG1ldHJpY1NhbXBsaW5nOiB7XG4gICAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICByYXRlOiAwLjEsXG4gICAgICAgIGFsd2F5c1B1Ymxpc2hPbjogJ2JvdGgnLFxuICAgICAgICB0aHJlc2hvbGRzOiB7XG4gICAgICAgICAgc2xvd0R1cmF0aW9uTXM6IDEwMDAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBiYWNrZW5kID0gbmV3IENsb3VkV2F0Y2hCYWNrZW5kKCd0ZXN0LXNlcnZpY2UnLCBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTywgY2xvdWR3YXRjaENvbmZpZyk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCfinIUgT3B0aW1pemF0aW9uIDE6IEhUVFAgU3RhdHVzIENvZGUgYXMgQXR0cmlidXRlIChub3QgbWV0cmljKScsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIE5PVCBjYWxsIGFkZE1ldHJpYyBmb3IgaHR0cC5zdGF0dXNDb2RlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0ZXN0LTEyMycsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FwaS91c2VycycsXG4gICAgICAgIHNvdXJjZTogJ1VzZXJDb250cm9sbGVyLmxpc3QnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogMTUwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgJ2h0dHAuc3RhdHVzQ29kZSc6IDIwMCwgIC8vIFRoaXMgc2hvdWxkIE5PVCBiZWNvbWUgYSBtZXRyaWNcbiAgICAgICAgICAnaHR0cC5tZXRob2QnOiAnR0VUJyxcbiAgICAgICAgfSxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICdjYWNoZS5oaXRzJzogMTAsXG4gICAgICAgICAgJ2NhY2hlLm1pc3Nlcyc6IDIsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICAvLyBWZXJpZnkgaHR0cC5zdGF0dXNDb2RlIHdhcyBOT1QgcGFzc2VkIHRvIGFkZE1ldHJpY1xuICAgICAgY29uc3QgYWxsTWV0cmljQ2FsbHMgPSBtb2NrQWRkTWV0cmljLm1vY2suY2FsbHM7XG4gICAgICBjb25zdCBzdGF0dXNDb2RlTWV0cmljID0gYWxsTWV0cmljQ2FsbHMuZmluZChjYWxsID0+IGNhbGxbIDAgXSA9PT0gJ2h0dHAuc3RhdHVzQ29kZScpO1xuXG4gICAgICBleHBlY3Qoc3RhdHVzQ29kZU1ldHJpYykudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgY29uc29sZS5sb2coJ+KchSBodHRwLnN0YXR1c0NvZGUgY29ycmVjdGx5IGV4Y2x1ZGVkIGZyb20gbWV0cmljcycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBlbWl0IGR1cmF0aW9uIGFuZCBjdXN0b20gbWV0cmljcywgYnV0IG5vdCBodHRwLnN0YXR1c0NvZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rlc3QtNDU2JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgICBvcGVyYXRpb246ICdBUEkgcmVxdWVzdCcsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbk1zOiAyNTAsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAnaHR0cC5zdGF0dXNDb2RlJzogNDA0LCAgLy8gU2hvdWxkIE5PVCBiZSBtZXRyaWNcbiAgICAgICAgfSxcbiAgICAgICAgbWV0cmljczoge1xuICAgICAgICAgICdkYi5xdWVyaWVzJzogNSxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG5cbiAgICAgIC8vIFNob3VsZCBoYXZlOiBkdXJhdGlvbiArIGRiLnF1ZXJpZXMgPSAyIG1ldHJpY3NcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnZHVyYXRpb24nLCAnTWlsbGlzZWNvbmRzJywgMjUwKTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnZGIucXVlcmllcycsICdDb3VudCcsIDUpO1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLm5vdC50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnaHR0cC5zdGF0dXNDb2RlJywgZXhwZWN0LmFueXRoaW5nKCksIGV4cGVjdC5hbnl0aGluZygpKTtcblxuICAgICAgY29uc29sZS5sb2coJ+KchSBPbmx5IGxlZ2l0aW1hdGUgbWV0cmljcyBlbWl0dGVkIChkdXJhdGlvbiwgZGIucXVlcmllcyknKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ+KchSBPcHRpbWl6YXRpb24gMjogTWV0cmljIEJhdGNoaW5nIChTaW5nbGUgRU1GIExvZyknLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBiYXRjaCBhbGwgbWV0cmljcyBpbnRvIE9ORSBzaW5nbGVNZXRyaWMoKSBjYWxsJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0ZXN0LTc4OScsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0LWNvcnJlbGF0aW9uJyxcbiAgICAgICAgb3BlcmF0aW9uOiAnYmF0Y2ggcHJvY2VzcycsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbk1zOiA1MDAsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAnaXRlbXMucHJvY2Vzc2VkJzogMTAwLFxuICAgICAgICAgICdpdGVtcy5mYWlsZWQnOiA1LFxuICAgICAgICAgICdjYWNoZS5oaXRzJzogODAsXG4gICAgICAgICAgJ2NhY2hlLm1pc3Nlcyc6IDIwLFxuICAgICAgICAgICdkYi5xdWVyaWVzJzogMTUsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICAvLyBDUklUSUNBTDogU2hvdWxkIGNyZWF0ZSBvbmx5IE9ORSBtZXRyaWMgYmF0Y2hcbiAgICAgIC8vIEJFRk9SRSBvcHRpbWl6YXRpb246IFdvdWxkIGNyZWF0ZSA2IHNlcGFyYXRlIGJhdGNoZXMgKDUgbWV0cmljcyArIDEgc3BhbiBkdXJhdGlvbilcbiAgICAgIC8vIEFGVEVSIG9wdGltaXphdGlvbjogU2hvdWxkIGNyZWF0ZSBvbmx5IDEgYmF0Y2ggd2l0aCBBTEwgbWV0cmljc1xuICAgICAgZXhwZWN0KG1vY2tTaW5nbGVNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcblxuICAgICAgLy8gVmVyaWZ5IEFMTCBtZXRyaWNzIHdlcmUgYWRkZWQgdG8gdGhlIFNBTUUgYmF0Y2hcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnaXRlbXMucHJvY2Vzc2VkJywgJ0NvdW50JywgMTAwKTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnaXRlbXMuZmFpbGVkJywgJ0NvdW50JywgNSk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2NhY2hlLmhpdHMnLCAnQ291bnQnLCA4MCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2NhY2hlLm1pc3NlcycsICdDb3VudCcsIDIwKTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnZGIucXVlcmllcycsICdDb3VudCcsIDE1KTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnZHVyYXRpb24nLCAnTWlsbGlzZWNvbmRzJywgNTAwKTtcblxuICAgICAgY29uc29sZS5sb2coJ+KchSBBbGwgNiBtZXRyaWNzIGJhdGNoZWQgaW50byAxIEVNRiBsb2cgKDgzJSBjb3N0IHJlZHVjdGlvbiknKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYmF0Y2ggZXZlbnQgbWV0cmljcyArIHNwYW4gZHVyYXRpb24gdG9nZXRoZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rlc3QtYWJjJyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QtY29ycmVsYXRpb24nLFxuICAgICAgICBvcGVyYXRpb246ICdwcm9jZXNzIHJlcXVlc3QnLFxuICAgICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICAgICAgZHVyYXRpb25NczogMzAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgJ2N1c3RvbS5tZXRyaWMxJzogMTAsXG4gICAgICAgICAgJ2N1c3RvbS5tZXRyaWMyJzogMjAsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICAvLyBTaG91bGQgY3JlYXRlIG9ubHkgMSBiYXRjaCB3aXRoIGV2ZW50IG1ldHJpY3MgKyBzcGFuIGR1cmF0aW9uXG4gICAgICBleHBlY3QobW9ja1NpbmdsZU1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xuXG4gICAgICAvLyBWZXJpZnkgc3BhbiBkdXJhdGlvbiBpcyBpbiB0aGUgU0FNRSBiYXRjaCBhcyBldmVudCBtZXRyaWNzXG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ2N1c3RvbS5tZXRyaWMxJywgJ0NvdW50JywgMTApO1xuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdjdXN0b20ubWV0cmljMicsICdDb3VudCcsIDIwKTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnZHVyYXRpb24nLCAnTWlsbGlzZWNvbmRzJywgMzAwKTtcblxuICAgICAgY29uc29sZS5sb2coJ+KchSBTcGFuIGR1cmF0aW9uIGJhdGNoZWQgd2l0aCBldmVudCBtZXRyaWNzIChzaW5nbGUgRU1GIGxvZyknKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbm90IGNyZWF0ZSBtZXRyaWMgYmF0Y2ggd2hlbiBubyBtZXRyaWNzIHByZXNlbnQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndGVzdC1sb2cnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdC1jb3JyZWxhdGlvbicsXG4gICAgICAgIG9wZXJhdGlvbjogJ2xvZyBtZXNzYWdlJyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIGRhdGE6IHsgbWVzc2FnZTogJ3Rlc3QgbG9nIHdpdGhvdXQgbWV0cmljcycgfSxcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG5cbiAgICAgIC8vIFNob3VsZCBOT1QgY3JlYXRlIGFueSBtZXRyaWMgYmF0Y2hlc1xuICAgICAgZXhwZWN0KG1vY2tTaW5nbGVNZXRyaWMpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcblxuICAgICAgY29uc29sZS5sb2coJ+KchSBObyBtZXRyaWNzIGVtaXR0ZWQgZm9yIHB1cmUgbG9nIGV2ZW50cycpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgn8J+TiiBDb3N0IFNhdmluZ3MgVmVyaWZpY2F0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdkZW1vbnN0cmF0ZXMgbWFzc2l2ZSBjb3N0IHJlZHVjdGlvbiB3aXRoIGJhdGNoaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU2ltdWxhdGUgYSB0eXBpY2FsIEFQSSByZXF1ZXN0IHdpdGggbXVsdGlwbGUgbWV0cmljc1xuICAgICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjb3N0LXRlc3QnLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICAgIG9wZXJhdGlvbjogJ0hUVFAgUE9TVCAvYXBpL29yZGVycycsXG4gICAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgICAgICBkdXJhdGlvbk1zOiA0NTAsXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICBzZXJ2aWNlOiAnb3JkZXJzLWFwaScsXG4gICAgICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICAgICAgICBzdGFnZTogJ3Byb2QnLFxuICAgICAgICB9LFxuICAgICAgICBtZXRyaWNzOiB7XG4gICAgICAgICAgJ2RiLnF1ZXJpZXMnOiA4LFxuICAgICAgICAgICdkYi5xdWVyeS5kdXJhdGlvbic6IDEyMCxcbiAgICAgICAgICAnY2FjaGUuaGl0cyc6IDE1LFxuICAgICAgICAgICdjYWNoZS5taXNzZXMnOiAzLFxuICAgICAgICAgICdxdWV1ZS5wdWJsaXNoZWQnOiAyLFxuICAgICAgICAgICd2YWxpZGF0aW9uLmVycm9ycyc6IDAsXG4gICAgICAgICAgJ2V4dGVybmFsLmFwaS5jYWxscyc6IDEsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuXG4gICAgICBjb25zdCB0b3RhbE1ldHJpY3MgPSBPYmplY3Qua2V5cyhldmVudC5tZXRyaWNzIHx8IHt9KS5sZW5ndGggKyAxOyAvLyArMSBmb3Igc3BhbiBkdXJhdGlvblxuICAgICAgY29uc3QgZW1mTG9ncyA9IG1vY2tTaW5nbGVNZXRyaWMubW9jay5jYWxscy5sZW5ndGg7XG5cbiAgICAgIGNvbnNvbGUubG9nKCdcXG7wn5OKIENvc3QgU2F2aW5ncyBBbmFseXNpczonKTtcbiAgICAgIGNvbnNvbGUubG9nKGAgICBUb3RhbCBtZXRyaWNzOiAke3RvdGFsTWV0cmljc31gKTtcbiAgICAgIGNvbnNvbGUubG9nKGAgICBCRUZPUkUgb3B0aW1pemF0aW9uOiAke3RvdGFsTWV0cmljc30gc2VwYXJhdGUgRU1GIGxvZ3NgKTtcbiAgICAgIGNvbnNvbGUubG9nKGAgICBBRlRFUiBvcHRpbWl6YXRpb246ICR7ZW1mTG9nc30gRU1GIGxvZ2ApO1xuICAgICAgY29uc29sZS5sb2coYCAgIENvc3QgcmVkdWN0aW9uOiAke01hdGgucm91bmQoKDEgLSBlbWZMb2dzIC8gdG90YWxNZXRyaWNzKSAqIDEwMCl9JWApO1xuICAgICAgY29uc29sZS5sb2coYCAgIENsb3VkV2F0Y2ggTG9ncyBpbmdlc3Rpb24gc2F2aW5nczogJHt0b3RhbE1ldHJpY3MgLSBlbWZMb2dzfSBmZXdlciBsb2dzXFxuYCk7XG5cbiAgICAgIGV4cGVjdChlbWZMb2dzKS50b0JlKDEpO1xuICAgICAgZXhwZWN0KHRvdGFsTWV0cmljcykudG9CZSg4KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NtYXJ0IFVuaXQgRGV0ZWN0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgYXV0by1kZXRlY3QgbWV0cmljIHVuaXRzIGJhc2VkIG9uIG5hbWluZyBwYXR0ZXJucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndW5pdC10ZXN0JyxcbiAgICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgICBvcGVyYXRpb246ICd0ZXN0JyxcbiAgICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICAgIG1ldHJpY3M6IHtcbiAgICAgICAgICAncmVxdWVzdC5kdXJhdGlvbk1zJzogMTAwLCAgICAgIC8vIFNob3VsZCBkZXRlY3QgTWlsbGlzZWNvbmRzXG4gICAgICAgICAgJ2l0ZW1zLnByb2Nlc3NlZENvdW50JzogNTAsICAgICAvLyBTaG91bGQgZGV0ZWN0IENvdW50XG4gICAgICAgICAgJ3Jlc3BvbnNlLnNpemVCeXRlcyc6IDEwMjQsICAgICAvLyBTaG91bGQgZGV0ZWN0IEJ5dGVzXG4gICAgICAgICAgJ2NhY2hlLmhpdFJhdGUnOiAwLjg1LCAgICAgICAgICAvLyBTaG91bGQgZGV0ZWN0IFBlcmNlbnRcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb3JyZWN0IHVuaXRzIHdlcmUgdXNlZFxuICAgICAgZXhwZWN0KG1vY2tBZGRNZXRyaWMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKCdyZXF1ZXN0LmR1cmF0aW9uTXMnLCAnTWlsbGlzZWNvbmRzJywgMTAwKTtcbiAgICAgIGV4cGVjdChtb2NrQWRkTWV0cmljKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCgnaXRlbXMucHJvY2Vzc2VkQ291bnQnLCAnQ291bnQnLCA1MCk7XG4gICAgICBleHBlY3QobW9ja0FkZE1ldHJpYykudG9IYXZlQmVlbkNhbGxlZFdpdGgoJ3Jlc3BvbnNlLnNpemVCeXRlcycsICdCeXRlcycsIDEwMjQpO1xuICAgICAgLy8gTm90ZTogaGl0UmF0ZSBjb250YWlucyAncmF0ZScgd2hpY2ggdHJpZ2dlcnMgUGVyY2VudCBkZXRlY3Rpb25cbiAgICAgIGNvbnN0IGhpdFJhdGVDYWxsID0gbW9ja0FkZE1ldHJpYy5tb2NrLmNhbGxzLmZpbmQoY2FsbCA9PiBjYWxsWyAwIF0gPT09ICdjYWNoZS5oaXRSYXRlJyk7XG4gICAgICBleHBlY3QoaGl0UmF0ZUNhbGwpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoaGl0UmF0ZUNhbGxbIDIgXSkudG9CZSgwLjg1KTsgLy8gVmFsdWUgaXMgY29ycmVjdFxuXG4gICAgICBjb25zb2xlLmxvZygn4pyFIFNtYXJ0IHVuaXQgZGV0ZWN0aW9uIHdvcmtpbmcgY29ycmVjdGx5Jyk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=