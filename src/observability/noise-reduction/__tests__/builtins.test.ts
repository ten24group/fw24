/**
 * Unit tests for builtin noise reduction rules.
 * 
 * Tests cover:
 * 1. Task routine success silencing (fw24.hotpaths.task.silent_routine_success)
 * 2. Event processor routine success silencing (fw24.hotpaths.event_processor.silent_routine_success)
 * 3. Health check / warmup silencing
 * 4. Stream processor rules
 * 5. Integration of rules with root suppression in the algorithm
 */

import { applyNoiseReduction, pickNoiseDecision } from '../algorithm';
import type { NoiseReductionConfig, ObservabilityEvent } from '../../types';
import type { EmittedEvent } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

let idCounter = 0;

function makeEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  idCounter++;
  return {
    type: 'span',
    level: 'info',
    correlationId: 'corr-builtin-test',
    timestampMs: Date.now(),
    observabilityLogId: `builtin-evt-${idCounter}`,
    ...overrides,
  };
}

function makeHotpathsConfig(overrides: Partial<NoiseReductionConfig> = {}): NoiseReductionConfig {
  return {
    enabled: true,
    presets: [ 'fw24.hotpaths' ],
    rules: [],
    maxAbsorbedErrorsPerSpan: 20,
    maxAbsorbedCausedByLinksPerSpan: 50,
    maxAbsorbedEntityIdsPerSpan: 100,
    maxAbsorbedOperationKeysPerSpan: 50,
    maxAbsorbedCheckpointsPerSpan: 100,
    ...overrides,
  };
}

function findEmitted(result: { events: readonly EmittedEvent[] }, logId: string): EmittedEvent | undefined {
  return result.events.find(e => e.event.observabilityLogId === logId);
}

beforeEach(() => {
  idCounter = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. TASK ROUTINE SUCCESS SILENCING
// ═══════════════════════════════════════════════════════════════════════════

describe('fw24.hotpaths.task.silent_routine_success', () => {
  test('successful task root span is silenced (and suppressed as lone root)', () => {
    const taskRoot = makeEvent({
      observabilityLogId: 'task-root',
      type: 'span',
      operation: 'Task scheduled-social-publish',
      source: 'task:scheduled-social-publish',
      tags: {
        handler_type: 'task',
        task_name: 'scheduled-social-publish',
        schedule: 'rate(1 minute)',
        service: 'plusfan',
      },
      success: true,
      durationMs: 5,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ taskRoot ], config);

    // Lone root with silent decision → suppressed
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('successful sports scheduler task is silenced', () => {
    const taskRoot = makeEvent({
      observabilityLogId: 'sports-root',
      type: 'span',
      operation: 'Task sports-data-poll-frequent',
      source: 'task:sports-data-poll-frequent',
      tags: {
        handler_type: 'task',
        task_name: 'sports-data-poll-frequent',
        schedule: 'rate(1 minute)',
        service: 'plusfan',
      },
      success: true,
      durationMs: 289,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ taskRoot ], config);

    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('failed task root span is NOT silenced (hard signal)', () => {
    const taskRoot = makeEvent({
      observabilityLogId: 'task-fail',
      type: 'span',
      operation: 'Task social-token-refresh',
      source: 'task:social-token-refresh',
      tags: { handler_type: 'task', task_name: 'social-token-refresh' },
      success: false,
      error: { type: 'Error', message: 'Token refresh failed' },
      durationMs: 500,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ taskRoot ], config);

    // Hard signal: failure → forced emit, not suppressed
    expect(result.events).toHaveLength(1);
    expect(result.stats.suppressedRoots).toBe(0);
  });

  test('successful task matches the correct builtin rule', () => {
    const taskRoot = makeEvent({
      type: 'span',
      tags: { handler_type: 'task' },
      success: true,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(taskRoot, config);

    expect(decision.decision).toBe('silent');
    expect(decision.ruleId).toBe('fw24.hotpaths.task.silent_routine_success');
  });

  test('task root span with warn level is NOT silenced', () => {
    const taskRoot = makeEvent({
      observabilityLogId: 'task-warn',
      type: 'span',
      operation: 'Task slow-task',
      source: 'task:slow-task',
      tags: { handler_type: 'task' },
      level: 'warn',
      success: true,
      durationMs: 10000,
    });

    const config = makeHotpathsConfig();

    // pickNoiseDecision tells us the rule-level decision
    const decision = pickNoiseDecision(taskRoot, config);

    // The task rule matches handler_type: 'task' + success: true, but has except for level warn
    // The 'except' block [{success: false}, {level: ['error','critical','warn']}] means
    // if level is warn, the except clause matches → rule does NOT apply → default emit
    expect(decision.decision).toBe('emit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EVENT PROCESSOR ROUTINE SUCCESS SILENCING
// ═══════════════════════════════════════════════════════════════════════════

describe('fw24.hotpaths.event_processor.silent_routine_success', () => {
  test('successful DynamoDBStreamToSNSProcessor root span is silenced', () => {
    const root = makeEvent({
      observabilityLogId: 'stream-sns-root',
      type: 'span',
      operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
      source: 'DynamoDBStreamToSNSProcessor.process',
      tags: {
        handler_type: 'event_processor',
        processor_name: 'DynamoDBStreamToSNSProcessor',
        event_source: 'aws:dynamodb',
        service: 'plusfan',
      },
      success: true,
      durationMs: 11,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root ], config);

    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('successful DynamoDBStreamAuditLogger root with absorbed child → suppressed', () => {
    const root = makeEvent({
      observabilityLogId: 'audit-logger-root',
      type: 'span',
      operation: 'aws:sqs DynamoDBStreamAuditLogger',
      source: 'DynamoDBStreamAuditLogger.process',
      tags: {
        handler_type: 'event_processor',
        processor_name: 'DynamoDBStreamAuditLogger',
        event_source: 'aws:sqs',
        service: 'plusfan',
      },
      success: true,
      durationMs: 2,
    });

    const child = makeEvent({
      observabilityLogId: 'batch-done',
      parentObservabilityLogId: 'audit-logger-root',
      type: 'log',
      operation: 'DynamoDBStreamAuditLogger Batch done',
      source: 'DynamoDBStreamAuditLogger.process',
      level: 'info',
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, child ], config);

    // Root: event_processor silent → promoted. Child: log absorbed by stream rules → into root.
    // All emitted are promoted → suppressed.
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('DynamoDBStreamAuditLogger root stripped, genuine audit.entity child KEPT', () => {
    const root = makeEvent({
      observabilityLogId: 'audit-root-stripped',
      type: 'span',
      operation: 'aws:sqs DynamoDBStreamAuditLogger',
      source: 'DynamoDBStreamAuditLogger.process',
      tags: {
        handler_type: 'event_processor',
        processor_name: 'DynamoDBStreamAuditLogger',
        event_source: 'aws:sqs',
        service: 'plusfan',
      },
      success: true,
      durationMs: 2,
    });

    const auditChild = makeEvent({
      observabilityLogId: 'audit-entity-1',
      parentObservabilityLogId: 'audit-root-stripped',
      type: 'audit.entity',
      subType: 'update',
      operation: 'teamIntegrationConfig.update',
      entityName: 'teamIntegrationConfig',
      entityId: '70213212-d239-48ca-b7f1-b8da93199a14',
      level: 'info',
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, auditChild ], config);

    // Root is silent (event_processor rule) → promoted → stripped from output
    // audit.entity is genuinely emitted → kept, becomes a new root (no parent ref)
    expect(result.events).toHaveLength(1);
    expect(findEmitted(result, 'audit-entity-1')).toBeDefined();
    expect(findEmitted(result, 'audit-entity-1')!.resolvedParentId).toBeUndefined();
    expect(findEmitted(result, 'audit-root-stripped')).toBeUndefined();
    expect(result.stats.suppressedRoots).toBe(0);
  });

  test('warn-level event processor root span is NOT silenced (except clause)', () => {
    // Use a generic event_processor (not DynamoDBStream*) to avoid matching
    // the stream-specific silent_batch_spans rule which has no warn except
    const root = makeEvent({
      observabilityLogId: 'proc-warn',
      type: 'span',
      operation: 'custom:sqs GenericEventProcessor',
      source: 'GenericEventProcessor.process',
      tags: { handler_type: 'event_processor' },
      level: 'warn',
      success: true,
      durationMs: 50,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(root, config);

    // The event_processor rule has except: [{success: false}, {level: ['error','critical','warn']}]
    // Warn-level events are excluded from the silent rule → default emit
    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('default');
  });

  test('successful event processor matches the correct builtin rule', () => {
    const root = makeEvent({
      type: 'span',
      tags: { handler_type: 'event_processor' },
      success: true,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(root, config);

    expect(decision.decision).toBe('silent');
    expect(decision.ruleId).toBe('fw24.hotpaths.event_processor.silent_routine_success');
  });

  test('failed event processor root span is NOT silenced', () => {
    const root = makeEvent({
      observabilityLogId: 'proc-fail',
      type: 'span',
      operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
      source: 'DynamoDBStreamToSNSProcessor.process',
      tags: { handler_type: 'event_processor' },
      success: false,
      error: { type: 'Error', message: 'SNS publish failed' },
      durationMs: 50,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root ], config);

    expect(result.events).toHaveLength(1);
    expect(result.stats.suppressedRoots).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. STREAM PROCESSOR + ABSORBED CHILDREN (realistic scenario)
// ═══════════════════════════════════════════════════════════════════════════

describe('stream rule matching (pickNoiseDecision)', () => {
  test('"Publish SNS done" log matches the absorb_publish_done rule', () => {
    const log = makeEvent({
      type: 'log',
      operation: 'Publish SNS done',
      source: 'DynamoDBStreamToSNSProcessor.process',
      level: 'info',
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(log, config);

    expect(decision.decision).toBe('absorb');
    expect(decision.ruleId).toBe('fw24.hotpaths.stream.absorb_publish_done');
  });

  test('"Batch done" log matches the absorb_audit_done rule', () => {
    const log = makeEvent({
      type: 'log',
      operation: 'DynamoDBStreamAuditLogger Batch done',
      source: 'DynamoDBStreamAuditLogger.process',
      level: 'info',
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(log, config);

    expect(decision.decision).toBe('absorb');
    expect(decision.ruleId).toBe('fw24.hotpaths.stream.absorb_audit_done');
  });

  test('audit.entity events do NOT match any framework-level silence/absorb rule', () => {
    const auditEvent = makeEvent({
      type: 'audit.entity',
      operation: 'teamIntegrationConfig.update',
      source: 'DynamoDBStreamAuditLogger.process',
      level: 'info',
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(auditEvent, config);

    // audit.entity events are genuine audit trail data — the framework does not
    // absorb or silence them. Applications can add custom rules for noisy patterns.
    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('default');
  });
});

describe('stream processor with children (realistic)', () => {
  test('DynamoDBStreamToSNSProcessor with "Publish SNS done" child → all suppressed', () => {
    const root = makeEvent({
      observabilityLogId: 'stream-root',
      type: 'span',
      operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
      source: 'DynamoDBStreamToSNSProcessor.process',
      tags: {
        handler_type: 'event_processor',
        processor_name: 'DynamoDBStreamToSNSProcessor',
        event_source: 'aws:dynamodb',
      },
      success: true,
      durationMs: 17,
    });

    const publishChild = makeEvent({
      observabilityLogId: 'publish-done',
      parentObservabilityLogId: 'stream-root',
      type: 'log',
      operation: 'Publish SNS done',
      source: 'DynamoDBStreamToSNSProcessor.process',
      level: 'info',
      durationMs: 15,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, publishChild ], config);

    // Root: event_processor silent (or stream rule silent) → promoted
    // Child: absorbed by fw24.hotpaths.stream.absorb_publish_done → into root
    // All emitted = promoted → suppressed
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. TASK WITH MEANINGFUL CHILDREN (should NOT suppress)
// ═══════════════════════════════════════════════════════════════════════════

describe('task with meaningful children', () => {
  test('social-token-refresh task: noise root stripped, genuine children kept', () => {
    const root = makeEvent({
      observabilityLogId: 'token-root',
      type: 'span',
      operation: 'Task social-token-refresh',
      source: 'task:social-token-refresh',
      tags: { handler_type: 'task', task_name: 'social-token-refresh' },
      success: true,
      durationMs: 1023,
    });

    const oauthRefresh = makeEvent({
      observabilityLogId: 'oauth-refresh',
      parentObservabilityLogId: 'token-root',
      type: 'span',
      operation: 'oauth.twitter.refresh',
      source: 'task:social-token-refresh',
      tags: { platform: 'twitter' },
      success: true,
      durationMs: 388,
    });

    const httpCall = makeEvent({
      observabilityLogId: 'http-call',
      parentObservabilityLogId: 'oauth-refresh',
      type: 'span',
      operation: 'oauth.twitter.refreshRequest',
      source: 'task:social-token-refresh',
      tags: { 'http.url': 'https://api.x.com/2/oauth2/token', 'http.status': '200', 'http.method': 'POST' },
      success: true,
      durationMs: 386,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, oauthRefresh, httpCall ], config);

    // Root: task handler_type → silent rule matches → promoted → stripped (noise root)
    // oauthRefresh: no matching silent rule → default emit (genuine!) → becomes new root
    // httpCall: no matching silent rule → default emit (genuine!) → kept under oauthRefresh
    // Noise root stripped, 2 genuine children emitted.
    expect(result.events).toHaveLength(2);
    expect(findEmitted(result, 'token-root')).toBeUndefined();
    expect(findEmitted(result, 'oauth-refresh')).toBeDefined();
    expect(findEmitted(result, 'oauth-refresh')!.resolvedParentId).toBeUndefined(); // parent was stripped
    expect(findEmitted(result, 'http-call')).toBeDefined();
    expect(findEmitted(result, 'http-call')!.resolvedParentId).toBe('oauth-refresh'); // still linked
    expect(result.stats.suppressedRoots).toBe(0);
  });

  test('task with error child → root forced to emit (hard signal ancestor)', () => {
    const root = makeEvent({
      observabilityLogId: 'task-error-root',
      type: 'span',
      operation: 'Task failing-task',
      source: 'task:failing-task',
      tags: { handler_type: 'task' },
      success: true,
      durationMs: 200,
    });

    const errorChild = makeEvent({
      observabilityLogId: 'error-child',
      parentObservabilityLogId: 'task-error-root',
      type: 'span',
      operation: 'external.api.call',
      success: false,
      error: { type: 'Error', message: 'API timeout' },
      durationMs: 5000,
      level: 'error',
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, errorChild ], config);

    // Error child is hard signal → forces root to emit as hard-signal-ancestor
    // Root is genuinely emitted (not promoted) → not suppressed
    expect(result.events).toHaveLength(2);
    expect(findEmitted(result, 'task-error-root')).toBeDefined();
    expect(findEmitted(result, 'error-child')).toBeDefined();
    expect(result.stats.suppressedRoots).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ENTITY WRITE OPERATIONS (absorbed into parent)
// ═══════════════════════════════════════════════════════════════════════════

describe('entity write operation absorption', () => {
  const entityOps = [ 'create', 'upsert', 'update' ];

  for (const op of entityOps) {
    test(`BaseEntityService.${op} is absorbed (successful)`, () => {
      const event = makeEvent({
        type: 'span',
        operation: `BaseEntityService.${op}`,
        source: `service:BaseEntityService.${op}`,
        success: true,
        durationMs: 20,
      });

      const config = makeHotpathsConfig();
      const decision = pickNoiseDecision(event, config);

      expect(decision.decision).toBe('absorb');
      expect(decision.ruleId).toBe('fw24.hotpaths.entity.absorb_write_spans');
    });
  }

  test('failed BaseEntityService.create is NOT absorbed (error)', () => {
    const event = makeEvent({
      type: 'span',
      operation: 'BaseEntityService.create',
      source: 'service:BaseEntityService.create',
      success: false,
      level: 'error',
      error: { type: 'Error', message: 'DynamoDB ConditionalCheckFailed' },
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(event, config);

    expect(decision.decision).not.toBe('absorb');
  });

  test('queue handler with multiple BaseEntityService.create children → all absorbed with checkpoints', () => {
    const baseTs = Date.now();
    const root = makeEvent({
      observabilityLogId: 'queue-root',
      type: 'span',
      operation: 'SQS post-sync',
      tags: { handler_type: 'queue', queue_name: 'post-sync' },
      success: true,
      durationMs: 300,
    });

    const children = Array.from({ length: 5 }, (_, i) => makeEvent({
      observabilityLogId: `create-${i}`,
      parentObservabilityLogId: 'queue-root',
      type: 'span',
      operation: 'BaseEntityService.create',
      source: 'service:BaseEntityService.create',
      tags: { operation_category: 'write' },
      success: true,
      durationMs: 20 + i * 5,
      timestampMs: baseTs + i * 50,
    }));

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, ...children ], config);

    // Root: no rule matches (queue handler without task/event_processor handler_type) → emit
    // All children: absorbed into root
    expect(result.events).toHaveLength(1);
    expect(findEmitted(result, 'queue-root')).toBeDefined();
    const absorbed = findEmitted(result, 'queue-root')!.absorbed;
    expect(absorbed).toBeDefined();
    expect(absorbed!.count).toBe(5);
    expect(absorbed!.byOperation[ 'BaseEntityService.create' ]).toBeDefined();
    expect(absorbed!.byOperation[ 'BaseEntityService.create' ].count).toBe(5);

    // Checkpoints: each absorbed child becomes a timeline checkpoint on the parent
    expect(absorbed!.checkpoints).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const cp = absorbed!.checkpoints[ i ];
      expect(cp.name).toBe('BaseEntityService.create');
      expect(cp.ts).toBe(baseTs + i * 50);
      expect(cp.durationMs).toBe(20 + i * 5);
      expect(cp.success).toBe(true);
      expect(cp.tags?.operation_category).toBe('write');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. HEALTH CHECK & WARMUP SILENCING
// ═══════════════════════════════════════════════════════════════════════════

describe('infrastructure noise rules', () => {
  test('health check GET is silenced', () => {
    const healthCheck = makeEvent({
      type: 'span',
      operation: 'HTTP GET /health',
      success: true,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(healthCheck, config);

    expect(decision.decision).toBe('silent');
    expect(decision.ruleId).toBe('fw24.hotpaths.infra.silent_healthcheck');
  });

  test('warmup invocation is silenced', () => {
    const warmup = makeEvent({
      type: 'span',
      operation: 'Lambda warmup',
      tags: { source: 'warmup' },
      success: true,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(warmup, config);

    expect(decision.decision).toBe('silent');
    expect(decision.ruleId).toBe('fw24.hotpaths.infra.silent_warmup');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. DATABASE QUERY ABSORPTION
// ═══════════════════════════════════════════════════════════════════════════

describe('database query absorption', () => {
  // ── READ queries → absorbed ──
  test.each([
    ['entity.get', 50],
    ['entity.batchGet', 80],
    ['observabilitylog.list', 250],
    ['observabilitylog.query', 350],
    ['user.find', 40],
    ['product.fetch', 90],
    ['session.read', 60],
  ])('successful READ query "%s" (%dms) is absorbed', (operation, durationMs) => {
    const query = makeEvent({
      type: 'database.query',
      operation,
      success: true,
      durationMs,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(query, config);

    expect(decision.decision).toBe('absorb');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.absorb_read_queries');
  });

  // ── WRITE queries → absorbed into parent (absorb_write_success rule) ──
  test.each([
    ['standing.upsert', 50],
    ['standing.create', 45],
    ['team.update', 60],
    ['game.delete', 30],
  ])('successful WRITE query "%s" (%dms) is absorbed into parent', (operation, durationMs) => {
    const query = makeEvent({
      type: 'database.query',
      operation,
      success: true,
      durationMs,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(query, config);

    // New rule: absorb_write_success absorbs successful writes into parent
    expect(decision.decision).toBe('absorb');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.absorb_write_success');
  });

  // ── Error/slow/scan exceptions still work ──
  test('slow query (>=1000ms) is emitted, not absorbed', () => {
    const query = makeEvent({
      type: 'database.query',
      operation: 'observabilitylog.query',
      success: true,
      durationMs: 1200,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(query, config);

    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.emit_slow');
  });

  test('failed query is emitted regardless of speed', () => {
    const query = makeEvent({
      type: 'database.query',
      operation: 'observabilitylog.query',
      success: false,
      durationMs: 20,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(query, config);

    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.emit_errors');
  });

  test('table scan query is emitted regardless of success', () => {
    const query = makeEvent({
      type: 'database.query',
      operation: 'observabilitylog.query',
      success: true,
      durationMs: 30,
      tags: { scan: 'true' },
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(query, config);

    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.emit_scans');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. ADMIN GET CONTROLLER FULL SUPPRESSION (end-to-end scenario)
// ═══════════════════════════════════════════════════════════════════════════

describe('admin GET controller full suppression', () => {
  test('HTTP GET /admin/entity/* with database.query child → entire invocation suppressed', () => {
    const root = makeEvent({
      observabilityLogId: 'get-admin-root',
      type: 'span',
      operation: 'HTTP GET /admin/entity/observabilitylog',
      source: 'AdminDynamicEntityController.list',
      tags: { 'http.method': 'GET', operation_category: 'read' },
      success: true,
      durationMs: 400,
    });

    const listSpan = makeEvent({
      observabilityLogId: 'list-span',
      type: 'span',
      operation: 'BaseEntityService.list',
      parentObservabilityLogId: 'get-admin-root',
      success: true,
      durationMs: 300,
    });

    const dbQuery = makeEvent({
      observabilityLogId: 'db-query',
      type: 'database.query',
      operation: 'observabilitylog.query',
      parentObservabilityLogId: 'list-span',
      success: true,
      durationMs: 250,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, listSpan, dbQuery ], config);

    // root: silenced (fast successful GET read)
    // listSpan: silenced (BaseEntityService.list)
    // dbQuery: absorbed (successful query)
    // → no genuine emits → entire invocation suppressed
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('HTTP GET /admin/entity/* with FAILED query child → root kept because of hard signal', () => {
    const root = makeEvent({
      observabilityLogId: 'get-admin-root-err',
      type: 'span',
      operation: 'HTTP GET /admin/entity/observabilitylog',
      source: 'AdminDynamicEntityController.list',
      tags: { 'http.method': 'GET', operation_category: 'read' },
      success: false, // controller failed
      durationMs: 400,
    });

    const dbQuery = makeEvent({
      observabilityLogId: 'db-query-err',
      type: 'database.query',
      operation: 'observabilitylog.query',
      parentObservabilityLogId: 'get-admin-root-err',
      success: false, // query failed
      durationMs: 50,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ root, dbQuery ], config);

    // Both have hard signals (success: false) → emitted
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(findEmitted(result, 'get-admin-root-err')).toBeDefined();
    expect(findEmitted(result, 'db-query-err')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. RULE PRIORITY: user rules can override builtin task/processor rules
// ═══════════════════════════════════════════════════════════════════════════

describe('rule priority override', () => {
  test('user rule with higher priority can force-emit a task root', () => {
    const taskRoot = makeEvent({
      observabilityLogId: 'important-task',
      type: 'span',
      operation: 'Task critical-data-export',
      source: 'task:critical-data-export',
      tags: { handler_type: 'task', task_name: 'critical-data-export' },
      success: true,
      durationMs: 5000,
    });

    const config = makeHotpathsConfig({
      rules: [
        {
          id: 'user.always_emit_critical_tasks',
          priority: 200, // Higher than builtin priority of 5
          match: {
            type: 'span',
            operation: '/critical-data-export/',
          },
          decision: 'emit',
          reason: 'Always emit critical data export tasks',
        },
      ],
    });

    const result = applyNoiseReduction([ taskRoot ], config);

    // User rule overrides builtin silent rule → genuinely emitted → not suppressed
    expect(result.events).toHaveLength(1);
    expect(result.stats.suppressedRoots).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NEW BUILTIN RULES (Feature 5)
// ═══════════════════════════════════════════════════════════════════════════

describe('fw24.hotpaths.api.silent_options_cors', () => {
  test('OPTIONS preflight request is silenced', () => {
    const optionsRoot = makeEvent({
      observabilityLogId: 'options-root',
      type: 'span',
      operation: 'HTTP OPTIONS /api/users',
      success: true,
      durationMs: 5,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ optionsRoot ], config);

    // OPTIONS request should be silenced (and suppressed as lone silent root)
    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('OPTIONS preflight with error is STILL silenced (priority 95 overrides)', () => {
    // The OPTIONS silent rule has priority 95, which is very high.
    // Even errors won't escape unless hard signals kick in.
    const optionsEvent = makeEvent({
      observabilityLogId: 'options-err',
      type: 'span',
      operation: 'HTTP OPTIONS /api/resources',
      success: true,
      durationMs: 10,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(optionsEvent, config);
    expect(decision.decision).toBe('silent');
    expect(decision.ruleId).toBe('fw24.hotpaths.api.silent_options_cors');
  });
});

describe('fw24.hotpaths.api.silent_favicon', () => {
  test('favicon.ico request is silenced', () => {
    const faviconRoot = makeEvent({
      observabilityLogId: 'favicon-root',
      type: 'span',
      operation: 'HTTP GET /favicon.ico',
      success: true,
      durationMs: 2,
    });

    const config = makeHotpathsConfig();
    const result = applyNoiseReduction([ faviconRoot ], config);

    expect(result.events).toHaveLength(0);
    expect(result.stats.suppressedRoots).toBe(1);
  });

  test('favicon decision is silent with correct rule id', () => {
    const faviconEvent = makeEvent({
      type: 'span',
      operation: 'HTTP GET /favicon.ico',
      success: true,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(faviconEvent, config);
    expect(decision.decision).toBe('silent');
    expect(decision.ruleId).toBe('fw24.hotpaths.api.silent_favicon');
  });
});

describe('fw24.hotpaths.queries.absorb_write_success', () => {
  test('successful write query is absorbed into parent', () => {
    const parentRoot = makeEvent({
      observabilityLogId: 'api-root',
      type: 'span',
      operation: 'HTTP POST /api/users',
      success: true,
      durationMs: 200,
    });

    const writeQuery = makeEvent({
      observabilityLogId: 'write-query',
      type: 'database.query',
      operation: 'User.create(id=abc)',
      success: true,
      durationMs: 15,
      parentObservabilityLogId: 'api-root',
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(writeQuery, config);
    expect(decision.decision).toBe('absorb');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.absorb_write_success');
  });

  test('failed write query is NOT absorbed (emit_errors rule wins)', () => {
    const failedWrite = makeEvent({
      type: 'database.query',
      operation: 'User.create(id=abc)',
      success: false,
      durationMs: 15,
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(failedWrite, config);
    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.emit_errors');
  });

  test('slow write query is NOT absorbed (emit_slow rule wins)', () => {
    const slowWrite = makeEvent({
      type: 'database.query',
      operation: 'User.upsert(id=abc)',
      success: true,
      durationMs: 2000, // > 1000ms threshold
    });

    const config = makeHotpathsConfig();
    const decision = pickNoiseDecision(slowWrite, config);
    expect(decision.decision).toBe('emit');
    expect(decision.ruleId).toBe('fw24.hotpaths.queries.emit_slow');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NOISE REDUCTION PRESET LEVELS (Feature 5)
// ═══════════════════════════════════════════════════════════════════════════

describe('Noise Reduction Preset Levels', () => {
  // Import createObservabilityConfig to test preset resolution
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createObservabilityConfig } = require('../../config');

  test('preset "off" keeps noise reduction disabled', () => {
    const config = createObservabilityConfig({
      noiseReduction: { preset: 'off' },
    });
    expect(config.noiseReduction.enabled).toBe(false);
    expect(config.noiseReduction.preset).toBe('off');
  });

  test('preset "recommended" enables noise reduction with default bounds', () => {
    const config = createObservabilityConfig({
      noiseReduction: { preset: 'recommended' },
    });
    expect(config.noiseReduction.enabled).toBe(true);
    expect(config.noiseReduction.preset).toBe('recommended');
    // Default bounds
    expect(config.noiseReduction.maxAbsorbedErrorsPerSpan).toBe(20);
    expect(config.noiseReduction.maxAbsorbedCheckpointsPerSpan).toBe(100);
  });

  test('preset "aggressive" enables noise reduction with tighter bounds', () => {
    const config = createObservabilityConfig({
      noiseReduction: { preset: 'aggressive' },
    });
    expect(config.noiseReduction.enabled).toBe(true);
    expect(config.noiseReduction.preset).toBe('aggressive');
    // Aggressive bounds
    expect(config.noiseReduction.maxAbsorbedErrorsPerSpan).toBe(10);
    expect(config.noiseReduction.maxAbsorbedCheckpointsPerSpan).toBe(50);
    expect(config.noiseReduction.maxAbsorbedCausedByLinksPerSpan).toBe(25);
    expect(config.noiseReduction.maxAbsorbedEntityIdsPerSpan).toBe(50);
    expect(config.noiseReduction.maxAbsorbedOperationKeysPerSpan).toBe(25);
  });

  test('explicit enabled=false overrides recommended preset', () => {
    const config = createObservabilityConfig({
      noiseReduction: { preset: 'recommended', enabled: false },
    });
    expect(config.noiseReduction.enabled).toBe(false);
  });

  test('explicit enabled=true overrides off preset', () => {
    const config = createObservabilityConfig({
      noiseReduction: { preset: 'off', enabled: true },
    });
    expect(config.noiseReduction.enabled).toBe(true);
  });

  test('aggressive preset uses lower slowThresholdMs', () => {
    const config = createObservabilityConfig({
      noiseReduction: { preset: 'aggressive' },
    });
    expect(config.noiseReduction.hardSignals?.slowThresholdMs).toBe(2000);
  });

  test('explicit bounds override aggressive preset bounds', () => {
    const config = createObservabilityConfig({
      noiseReduction: {
        preset: 'aggressive',
        maxAbsorbedErrorsPerSpan: 5,
      },
    });
    expect(config.noiseReduction.maxAbsorbedErrorsPerSpan).toBe(5);
    // Other aggressive bounds are still applied
    expect(config.noiseReduction.maxAbsorbedCheckpointsPerSpan).toBe(50);
  });
});
