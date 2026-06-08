/**
 * Manager pipeline tests: noise reduction end-to-end through ObservabilityManager.
 *
 * These tests exercise the REAL manager pipeline:
 *   SpanObserver → capture → buffer → flush → noise reduction → MockBackend
 *
 * They validate that:
 * 1. Routine task invocations are fully suppressed (0 events reach backend)
 * 2. Routine event_processor invocations are fully suppressed
 * 3. Error/failure invocations always survive (hard signals)
 * 4. Controller operations (POST, PUT, DELETE) are never suppressed
 * 5. User rule overrides work through the pipeline
 */

import { ObservabilityManager, Observer } from '../manager';
import { MockBackend, createTestContext, cleanupTestObservability } from '../testing';
import { SpanObserver } from '../observers';
import { createObservabilityConfig } from '../config';
import { ObservabilityLevel } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function setupManagerWithNoiseReduction(extraRules: any[] = []): MockBackend {
  ObservabilityManager.reset();
  const mockBackend = new MockBackend({ minLevel: ObservabilityLevel.TRACE });
  const config = createObservabilityConfig({
    enabled: true,
    serviceName: 'fw24-pipeline-test',
    backends: [{ type: 'cloudwatch' }],
    noiseReduction: {
      enabled: true,
      presets: ['fw24.hotpaths'],
      rules: extraRules,
    },
    spans: { skipEmpty: false, minDurationMs: 0 },
  });
  ObservabilityManager.initializeForTesting(config, [mockBackend]);
  return mockBackend;
}

afterEach(() => {
  cleanupTestObservability();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. TASK SUPPRESSION
// ═══════════════════════════════════════════════════════════════════════════

describe('Manager pipeline: task suppression', () => {
  it('should suppress a successful scheduled task (zero events in backend)', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('Task scheduled-social-publish', {
        level: 'info',
        source: 'task:scheduled-social-publish',
        tags: { handler_type: 'task', task_name: 'scheduled-social-publish' },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    expect(mockBackend.getEvents()).toHaveLength(0);
  });

  it('should suppress a successful frequent-poll task', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('Task data-poll-frequent', {
        level: 'info',
        source: 'task:data-poll-frequent',
        tags: { handler_type: 'task', task_name: 'data-poll-frequent' },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    expect(mockBackend.getEvents()).toHaveLength(0);
  });

  it('should KEEP a failed task (hard signal)', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('Task data-poll-frequent', {
        level: 'info',
        source: 'task:data-poll-frequent',
        tags: { handler_type: 'task' },
      });
      span.recordException(new Error('Scheduler crashed'));
      span.end({ success: false });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const failedSpan = events.find(e => e.type === 'span' && e.success === false);
    expect(failedSpan).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EVENT PROCESSOR SUPPRESSION
// ═══════════════════════════════════════════════════════════════════════════

describe('Manager pipeline: event processor suppression', () => {
  it('should suppress a successful stream-to-SNS processor', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('aws:dynamodb StreamToSNSProcessor', {
        level: 'info',
        source: 'StreamToSNSProcessor.process',
        tags: {
          handler_type: 'event_processor',
          processor_name: 'StreamToSNSProcessor',
          event_source: 'aws:dynamodb',
        },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    expect(mockBackend.getEvents()).toHaveLength(0);
  });

  it('should suppress a successful audit logger processor', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('aws:sqs AuditLoggerProcessor', {
        level: 'info',
        source: 'AuditLoggerProcessor.process',
        tags: {
          handler_type: 'event_processor',
          processor_name: 'AuditLoggerProcessor',
          event_source: 'aws:sqs',
        },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    expect(mockBackend.getEvents()).toHaveLength(0);
  });

  it('should KEEP a failed event processor', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('aws:dynamodb StreamToSNSProcessor', {
        level: 'info',
        source: 'StreamToSNSProcessor.process',
        tags: { handler_type: 'event_processor' },
      });
      span.recordException(new Error('SNS publish failed'));
      span.end({ success: false });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.success === false)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONTROLLER OPERATIONS ARE NEVER SUPPRESSED
// ═══════════════════════════════════════════════════════════════════════════

describe('Manager pipeline: controller operations are never suppressed', () => {
  it('should KEEP POST operations at info level', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('HTTP POST /admin/entity/post', {
        level: 'info',
        source: 'DynamicEntityController.create',
        tags: { handler_type: 'controller' },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.type === 'span')).toBe(true);
  });

  it('should KEEP PUT operations at info level', async () => {
    const mockBackend = setupManagerWithNoiseReduction();

    await createTestContext(async () => {
      const span = SpanObserver.start('HTTP PUT /admin/entity/user/123', {
        level: 'info',
        source: 'DynamicEntityController.update',
        tags: { handler_type: 'controller' },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. USER RULE OVERRIDE
// ═══════════════════════════════════════════════════════════════════════════

describe('Manager pipeline: user rule overrides', () => {
  it('should KEEP a task when user rule forces emit', async () => {
    const mockBackend = setupManagerWithNoiseReduction([
      {
        id: 'app.always_emit_data_export',
        priority: 200,
        match: { type: 'span', operation: '/critical-data-export/' },
        decision: 'emit',
        reason: 'Always emit critical data export tasks',
      },
    ]);

    await createTestContext(async () => {
      const span = SpanObserver.start('Task critical-data-export', {
        level: 'info',
        source: 'task:critical-data-export',
        tags: { handler_type: 'task', task_name: 'critical-data-export' },
      });
      span.end({ success: true });
      await Observer.flush();
    });

    const events = mockBackend.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.type === 'span')).toBe(true);
  });
});
