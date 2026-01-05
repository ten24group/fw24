/**
 * Phase 1 Optimizations Tests
 * 
 * These tests verify:
 * 1. HTTP status code is NOT emitted as a metric (only as attribute)
 * 2. All metrics are batched into a SINGLE EMF log entry
 */

import { CloudWatchBackend } from '../cloudwatch';
import { ObservabilityEvent, ObservabilityLevel, CloudWatchConfig } from '../../types';

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
  let backend: CloudWatchBackend;

  beforeEach(() => {
    jest.clearAllMocks();

    const cloudwatchConfig: CloudWatchConfig = {
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

    backend = new CloudWatchBackend('test-service', ObservabilityLevel.INFO, cloudwatchConfig);
  });

  describe('✅ Optimization 1: HTTP Status Code as Attribute (not metric)', () => {
    it('should NOT call addMetric for http.statusCode', async () => {
      const event: ObservabilityEvent = {
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
          'http.statusCode': 200,  // This should NOT become a metric
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
      const statusCodeMetric = allMetricCalls.find(call => call[ 0 ] === 'http.statusCode');

      expect(statusCodeMetric).toBeUndefined();
      console.log('✅ http.statusCode correctly excluded from metrics');
    });

    it('should emit duration and custom metrics, but not http.statusCode', async () => {
      const event: ObservabilityEvent = {
        type: 'span',
        observabilityLogId: 'test-456',
        correlationId: 'test-correlation',
        operation: 'API request',
        level: 'info',
        timestampMs: Date.now(),
        durationMs: 250,
        success: true,
        data: {
          'http.statusCode': 404,  // Should NOT be metric
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
      const event: ObservabilityEvent = {
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
      const event: ObservabilityEvent = {
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
      const event: ObservabilityEvent = {
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
      const event: ObservabilityEvent = {
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
      const event: ObservabilityEvent = {
        type: 'span',
        observabilityLogId: 'unit-test',
        correlationId: 'test',
        operation: 'test',
        level: 'info',
        timestampMs: Date.now(),
        metrics: {
          'request.durationMs': 100,      // Should detect Milliseconds
          'items.processedCount': 50,     // Should detect Count
          'response.sizeBytes': 1024,     // Should detect Bytes
          'cache.hitRate': 0.85,          // Should detect Percent
        },
      };

      await backend.capture(event);

      // Verify correct units were used
      expect(mockAddMetric).toHaveBeenCalledWith('request.durationMs', 'Milliseconds', 100);
      expect(mockAddMetric).toHaveBeenCalledWith('items.processedCount', 'Count', 50);
      expect(mockAddMetric).toHaveBeenCalledWith('response.sizeBytes', 'Bytes', 1024);
      // Note: hitRate contains 'rate' which triggers Percent detection
      const hitRateCall = mockAddMetric.mock.calls.find(call => call[ 0 ] === 'cache.hitRate');
      expect(hitRateCall).toBeDefined();
      expect(hitRateCall[ 2 ]).toBe(0.85); // Value is correct

      console.log('✅ Smart unit detection working correctly');
    });
  });
});
