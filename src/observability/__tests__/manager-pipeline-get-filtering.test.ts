/**
 * Manager pipeline tests: HTTP GET request filtering via noise reduction.
 *
 * Exercises the REAL manager pipeline:
 *   SpanObserver/LogObserver → capture → buffer → flush → noise reduction → MockBackend
 *
 * Validates that user-defined rules for silencing routine HTTP GET operations
 * work correctly end-to-end, including except clauses for errors/warnings.
 */

import { ObservabilityManager, Observer } from '../manager';
import { MockBackend, createTestContext, cleanupTestObservability } from '../testing';
import { SpanObserver, LogObserver } from '../observers';
import { createObservabilityConfig } from '../config';
import { ObservabilityLevel } from '../types';

describe('Manager pipeline: HTTP GET filtering', () => {
  let mockBackend: MockBackend;

  beforeEach(() => {
    ObservabilityManager.reset();
    mockBackend = new MockBackend({ minLevel: ObservabilityLevel.TRACE });

    const config = createObservabilityConfig({
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

    ObservabilityManager.initializeForTesting(config, [mockBackend]);
  });

  afterEach(() => {
    cleanupTestObservability();
  });

  it('should silence successful HTTP GET span', async () => {
    await createTestContext(async () => {
      const span = SpanObserver.start('HTTP GET /admin/entity/observabilitylog', {
        level: 'info',
        source: 'DynamicEntityController.list',
      });
      span.end({ success: true });
      await Observer.flush();
    });

    expect(mockBackend.getEvents()).toHaveLength(0);
  });

  it('should KEEP HTTP GET span with ERROR', async () => {
    await createTestContext(async () => {
      const span = SpanObserver.start('HTTP GET /admin/entity/observabilitylog', {
        level: 'error',
        source: 'DynamicEntityController.list',
      });
      span.recordException(new Error('Database connection failed'));
      span.end({ success: false });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const span = events.find(e => e.type === 'span');
    expect(span).toBeDefined();
    expect(span!.success).toBe(false);
  });

  it('should KEEP warn-level HTTP GET span', async () => {
    await createTestContext(async () => {
      const span = SpanObserver.start('HTTP GET /admin/entity/observabilitylog', {
        level: 'warn',
        source: 'DynamicEntityController.list',
      });
      span.end({ success: true });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const span = events.find(e => e.type === 'span');
    expect(span).toBeDefined();
  });

  it('should KEEP POST/PUT/DELETE operations', async () => {
    await createTestContext(async () => {
      const span = SpanObserver.start('HTTP POST /admin/entity/user', {
        level: 'warn',
        source: 'DynamicEntityController.create',
      });
      span.end({ success: true });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const span = events.find(e => e.type === 'span');
    expect(span).toBeDefined();
    expect(span!.operation).toContain('POST');
  });

  it('should silence GET operation log messages', async () => {
    await createTestContext(async () => {
      LogObserver.info('Processing GET request', {
        operation: 'HTTP GET /admin/entity/observabilitylog',
      });
      await Observer.flush();
    });

    expect(mockBackend.getEvents()).toHaveLength(0);
  });

  it('should KEEP GET operation log with warning level', async () => {
    await createTestContext(async () => {
      LogObserver.warn('Slow GET request detected', {
        operation: 'HTTP GET /admin/entity/observabilitylog',
        durationMs: 6000,
      });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const log = events.find(e => e.type === 'log');
    expect(log).toBeDefined();
    expect(log!.level).toBe('warn');
  });
});
