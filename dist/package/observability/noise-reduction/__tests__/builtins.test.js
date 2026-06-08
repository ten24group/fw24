"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const algorithm_1 = require("../algorithm");
// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
let idCounter = 0;
function makeEvent(overrides = {}) {
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
function makeHotpathsConfig(overrides = {}) {
    return {
        enabled: true,
        presets: ['fw24.hotpaths'],
        rules: [],
        maxAbsorbedErrorsPerSpan: 20,
        maxAbsorbedCausedByLinksPerSpan: 50,
        maxAbsorbedEntityIdsPerSpan: 100,
        maxAbsorbedOperationKeysPerSpan: 50,
        maxAbsorbedCheckpointsPerSpan: 100,
        ...overrides,
    };
}
function findEmitted(result, logId) {
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
        const result = (0, algorithm_1.applyNoiseReduction)([taskRoot], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([taskRoot], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([taskRoot], config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(taskRoot, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(taskRoot, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, child], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, auditChild], config);
        // Root is silent (event_processor rule) → promoted → stripped from output
        // audit.entity is genuinely emitted → kept, becomes a new root (no parent ref)
        expect(result.events).toHaveLength(1);
        expect(findEmitted(result, 'audit-entity-1')).toBeDefined();
        expect(findEmitted(result, 'audit-entity-1').resolvedParentId).toBeUndefined();
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
        const decision = (0, algorithm_1.pickNoiseDecision)(root, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(root, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root], config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(log, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(log, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(auditEvent, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, publishChild], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, oauthRefresh, httpCall], config);
        // Root: task handler_type → silent rule matches → promoted → stripped (noise root)
        // oauthRefresh: no matching silent rule → default emit (genuine!) → becomes new root
        // httpCall: no matching silent rule → default emit (genuine!) → kept under oauthRefresh
        // Noise root stripped, 2 genuine children emitted.
        expect(result.events).toHaveLength(2);
        expect(findEmitted(result, 'token-root')).toBeUndefined();
        expect(findEmitted(result, 'oauth-refresh')).toBeDefined();
        expect(findEmitted(result, 'oauth-refresh').resolvedParentId).toBeUndefined(); // parent was stripped
        expect(findEmitted(result, 'http-call')).toBeDefined();
        expect(findEmitted(result, 'http-call').resolvedParentId).toBe('oauth-refresh'); // still linked
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, errorChild], config);
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
    const entityOps = ['create', 'upsert', 'update'];
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
            const decision = (0, algorithm_1.pickNoiseDecision)(event, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(event, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, ...children], config);
        // Root: no rule matches (queue handler without task/event_processor handler_type) → emit
        // All children: absorbed into root
        expect(result.events).toHaveLength(1);
        expect(findEmitted(result, 'queue-root')).toBeDefined();
        const absorbed = findEmitted(result, 'queue-root').absorbed;
        expect(absorbed).toBeDefined();
        expect(absorbed.count).toBe(5);
        expect(absorbed.byOperation['BaseEntityService.create']).toBeDefined();
        expect(absorbed.byOperation['BaseEntityService.create'].count).toBe(5);
        // Checkpoints: each absorbed child becomes a timeline checkpoint on the parent
        expect(absorbed.checkpoints).toHaveLength(5);
        for (let i = 0; i < 5; i++) {
            const cp = absorbed.checkpoints[i];
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
        const decision = (0, algorithm_1.pickNoiseDecision)(healthCheck, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(warmup, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(query, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(query, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(query, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(query, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(query, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, listSpan, dbQuery], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([root, dbQuery], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([taskRoot], config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([optionsRoot], config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(optionsEvent, config);
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
        const result = (0, algorithm_1.applyNoiseReduction)([faviconRoot], config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(faviconEvent, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(writeQuery, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(failedWrite, config);
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
        const decision = (0, algorithm_1.pickNoiseDecision)(slowWrite, config);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbHRpbnMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L25vaXNlLXJlZHVjdGlvbi9fX3Rlc3RzX18vYnVpbHRpbnMudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7Ozs7OztHQVNHOztBQUVILDRDQUFzRTtBQUl0RSw4RUFBOEU7QUFDOUUsVUFBVTtBQUNWLDhFQUE4RTtBQUU5RSxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUM7QUFFbEIsU0FBUyxTQUFTLENBQUMsWUFBeUMsRUFBRTtJQUM1RCxTQUFTLEVBQUUsQ0FBQztJQUNaLE9BQU87UUFDTCxJQUFJLEVBQUUsTUFBTTtRQUNaLEtBQUssRUFBRSxNQUFNO1FBQ2IsYUFBYSxFQUFFLG1CQUFtQjtRQUNsQyxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtRQUN2QixrQkFBa0IsRUFBRSxlQUFlLFNBQVMsRUFBRTtRQUM5QyxHQUFHLFNBQVM7S0FDYixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsWUFBMkMsRUFBRTtJQUN2RSxPQUFPO1FBQ0wsT0FBTyxFQUFFLElBQUk7UUFDYixPQUFPLEVBQUUsQ0FBRSxlQUFlLENBQUU7UUFDNUIsS0FBSyxFQUFFLEVBQUU7UUFDVCx3QkFBd0IsRUFBRSxFQUFFO1FBQzVCLCtCQUErQixFQUFFLEVBQUU7UUFDbkMsMkJBQTJCLEVBQUUsR0FBRztRQUNoQywrQkFBK0IsRUFBRSxFQUFFO1FBQ25DLDZCQUE2QixFQUFFLEdBQUc7UUFDbEMsR0FBRyxTQUFTO0tBQ2IsQ0FBQztBQUNKLENBQUM7QUFFRCxTQUFTLFdBQVcsQ0FBQyxNQUEyQyxFQUFFLEtBQWE7SUFDN0UsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEtBQUssS0FBSyxDQUFD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Y3Rpb24gcnVsZXMuXG4gKiBcbiAqIFRlc3RzIGNvdmVyOlxuICogMS4gVGFzayByb3V0aW5lIHN1Y2Nlc3Mgc2lsZW5jaW5nIChmdzI0LmhvdHBhdGhzLnRhc2suc2lsZW50X3JvdXRpbmVfc3VjY2VzcylcbiAqIDIuIEV2ZW50IHByb2Nlc3NvciByb3V0aW5lIHN1Y2Nlc3Mgc2lsZW5jaW5nIChmdzI0LmhvdHBhdGhzLmV2ZW50X3Byb2Nlc3Nvci5zaWxlbnRfcm91dGluZV9zdWNjZXNzKVxuICogMy4gSGVhbHRoIGNoZWNrIC8gd2FybXVwIHNpbGVuY2luZ1xuICogNC4gU3RyZWFtIHByb2Nlc3NvciBydWxlc1xuICogNS4gSW50ZWdyYXRpb24gb2YgcnVsZXMgd2l0aCByb290IHN1cHByZXNzaW9uIGluIHRoZSBhbGdvcml0aG1cbiAqL1xuXG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uLCBwaWNrTm9pc2VEZWNpc2lvbiB9IGZyb20gJy4uL2FsZ29yaXRobSc7XG5pbXBvcnQgdHlwZSB7IE5vaXNlUmVkdWN0aW9uQ29uZmlnLCBPYnNlcnZhYmlsaXR5RXZlbnQgfSBmcm9tICcuLi8uLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IEVtaXR0ZWRFdmVudCB9IGZyb20gJy4uL3R5cGVzJztcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBIRUxQRVJTXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxubGV0IGlkQ291bnRlciA9IDA7XG5cbmZ1bmN0aW9uIG1ha2VFdmVudChvdmVycmlkZXM6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiA9IHt9KTogT2JzZXJ2YWJpbGl0eUV2ZW50IHtcbiAgaWRDb3VudGVyKys7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ3NwYW4nLFxuICAgIGxldmVsOiAnaW5mbycsXG4gICAgY29ycmVsYXRpb25JZDogJ2NvcnItYnVpbHRpbi10ZXN0JyxcbiAgICB0aW1lc3RhbXBNczogRGF0ZS5ub3coKSxcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBidWlsdGluLWV2dC0ke2lkQ291bnRlcn1gLFxuICAgIC4uLm92ZXJyaWRlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gbWFrZUhvdHBhdGhzQ29uZmlnKG92ZXJyaWRlczogUGFydGlhbDxOb2lzZVJlZHVjdGlvbkNvbmZpZz4gPSB7fSk6IE5vaXNlUmVkdWN0aW9uQ29uZmlnIHtcbiAgcmV0dXJuIHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnIF0sXG4gICAgcnVsZXM6IFtdLFxuICAgIG1heEFic29yYmVkRXJyb3JzUGVyU3BhbjogMjAsXG4gICAgbWF4QWJzb3JiZWRDYXVzZWRCeUxpbmtzUGVyU3BhbjogNTAsXG4gICAgbWF4QWJzb3JiZWRFbnRpdHlJZHNQZXJTcGFuOiAxMDAsXG4gICAgbWF4QWJzb3JiZWRPcGVyYXRpb25LZXlzUGVyU3BhbjogNTAsXG4gICAgbWF4QWJzb3JiZWRDaGVja3BvaW50c1BlclNwYW46IDEwMCxcbiAgICAuLi5vdmVycmlkZXMsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGZpbmRFbWl0dGVkKHJlc3VsdDogeyBldmVudHM6IHJlYWRvbmx5IEVtaXR0ZWRFdmVudFtdIH0sIGxvZ0lkOiBzdHJpbmcpOiBFbWl0dGVkRXZlbnQgfCB1bmRlZmluZWQge1xuICByZXR1cm4gcmVzdWx0LmV2ZW50cy5maW5kKGUgPT4gZS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQgPT09IGxvZ0lkKTtcbn1cblxuYmVmb3JlRWFjaCgoKSA9PiB7XG4gIGlkQ291bnRlciA9IDA7XG59KTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyAxLiBUQVNLIFJPVVRJTkUgU1VDQ0VTUyBTSUxFTkNJTkdcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgnZncyNC5ob3RwYXRocy50YXNrLnNpbGVudF9yb3V0aW5lX3N1Y2Nlc3MnLCAoKSA9PiB7XG4gIHRlc3QoJ3N1Y2Nlc3NmdWwgdGFzayByb290IHNwYW4gaXMgc2lsZW5jZWQgKGFuZCBzdXBwcmVzc2VkIGFzIGxvbmUgcm9vdCknLCAoKSA9PiB7XG4gICAgY29uc3QgdGFza1Jvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAndGFzay1yb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ1Rhc2sgc2NoZWR1bGVkLXNvY2lhbC1wdWJsaXNoJyxcbiAgICAgIHNvdXJjZTogJ3Rhc2s6c2NoZWR1bGVkLXNvY2lhbC1wdWJsaXNoJyxcbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgaGFuZGxlcl90eXBlOiAndGFzaycsXG4gICAgICAgIHRhc2tfbmFtZTogJ3NjaGVkdWxlZC1zb2NpYWwtcHVibGlzaCcsXG4gICAgICAgIHNjaGVkdWxlOiAncmF0ZSgxIG1pbnV0ZSknLFxuICAgICAgICBzZXJ2aWNlOiAncGx1c2ZhbicsXG4gICAgICB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgdGFza1Jvb3QgXSwgY29uZmlnKTtcblxuICAgIC8vIExvbmUgcm9vdCB3aXRoIHNpbGVudCBkZWNpc2lvbiDihpIgc3VwcHJlc3NlZFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ3N1Y2Nlc3NmdWwgc3BvcnRzIHNjaGVkdWxlciB0YXNrIGlzIHNpbGVuY2VkJywgKCkgPT4ge1xuICAgIGNvbnN0IHRhc2tSb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nwb3J0cy1yb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ1Rhc2sgc3BvcnRzLWRhdGEtcG9sbC1mcmVxdWVudCcsXG4gICAgICBzb3VyY2U6ICd0YXNrOnNwb3J0cy1kYXRhLXBvbGwtZnJlcXVlbnQnLFxuICAgICAgdGFnczoge1xuICAgICAgICBoYW5kbGVyX3R5cGU6ICd0YXNrJyxcbiAgICAgICAgdGFza19uYW1lOiAnc3BvcnRzLWRhdGEtcG9sbC1mcmVxdWVudCcsXG4gICAgICAgIHNjaGVkdWxlOiAncmF0ZSgxIG1pbnV0ZSknLFxuICAgICAgICBzZXJ2aWNlOiAncGx1c2ZhbicsXG4gICAgICB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDI4OSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyB0YXNrUm9vdCBdLCBjb25maWcpO1xuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnZmFpbGVkIHRhc2sgcm9vdCBzcGFuIGlzIE5PVCBzaWxlbmNlZCAoaGFyZCBzaWduYWwpJywgKCkgPT4ge1xuICAgIGNvbnN0IHRhc2tSb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rhc2stZmFpbCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdUYXNrIHNvY2lhbC10b2tlbi1yZWZyZXNoJyxcbiAgICAgIHNvdXJjZTogJ3Rhc2s6c29jaWFsLXRva2VuLXJlZnJlc2gnLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJywgdGFza19uYW1lOiAnc29jaWFsLXRva2VuLXJlZnJlc2gnIH0sXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiB7IHR5cGU6ICdFcnJvcicsIG1lc3NhZ2U6ICdUb2tlbiByZWZyZXNoIGZhaWxlZCcgfSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwMCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyB0YXNrUm9vdCBdLCBjb25maWcpO1xuXG4gICAgLy8gSGFyZCBzaWduYWw6IGZhaWx1cmUg4oaSIGZvcmNlZCBlbWl0LCBub3Qgc3VwcHJlc3NlZFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3N1Y2Nlc3NmdWwgdGFzayBtYXRjaGVzIHRoZSBjb3JyZWN0IGJ1aWx0aW4gcnVsZScsICgpID0+IHtcbiAgICBjb25zdCB0YXNrUm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbih0YXNrUm9vdCwgY29uZmlnKTtcblxuICAgIGV4cGVjdChkZWNpc2lvbi5kZWNpc2lvbikudG9CZSgnc2lsZW50Jyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy50YXNrLnNpbGVudF9yb3V0aW5lX3N1Y2Nlc3MnKTtcbiAgfSk7XG5cbiAgdGVzdCgndGFzayByb290IHNwYW4gd2l0aCB3YXJuIGxldmVsIGlzIE5PVCBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCB0YXNrUm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0YXNrLXdhcm4nLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnVGFzayBzbG93LXRhc2snLFxuICAgICAgc291cmNlOiAndGFzazpzbG93LXRhc2snLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICd0YXNrJyB9LFxuICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAxMDAwMCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuXG4gICAgLy8gcGlja05vaXNlRGVjaXNpb24gdGVsbHMgdXMgdGhlIHJ1bGUtbGV2ZWwgZGVjaXNpb25cbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKHRhc2tSb290LCBjb25maWcpO1xuXG4gICAgLy8gVGhlIHRhc2sgcnVsZSBtYXRjaGVzIGhhbmRsZXJfdHlwZTogJ3Rhc2snICsgc3VjY2VzczogdHJ1ZSwgYnV0IGhhcyBleGNlcHQgZm9yIGxldmVsIHdhcm5cbiAgICAvLyBUaGUgJ2V4Y2VwdCcgYmxvY2sgW3tzdWNjZXNzOiBmYWxzZX0sIHtsZXZlbDogWydlcnJvcicsJ2NyaXRpY2FsJywnd2FybiddfV0gbWVhbnNcbiAgICAvLyBpZiBsZXZlbCBpcyB3YXJuLCB0aGUgZXhjZXB0IGNsYXVzZSBtYXRjaGVzIOKGkiBydWxlIGRvZXMgTk9UIGFwcGx5IOKGkiBkZWZhdWx0IGVtaXRcbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgfSk7XG59KTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyAyLiBFVkVOVCBQUk9DRVNTT1IgUk9VVElORSBTVUNDRVNTIFNJTEVOQ0lOR1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdmdzI0LmhvdHBhdGhzLmV2ZW50X3Byb2Nlc3Nvci5zaWxlbnRfcm91dGluZV9zdWNjZXNzJywgKCkgPT4ge1xuICB0ZXN0KCdzdWNjZXNzZnVsIER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3Igcm9vdCBzcGFuIGlzIHNpbGVuY2VkJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc3RyZWFtLXNucy1yb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ2F3czpkeW5hbW9kYiBEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgICB0YWdzOiB7XG4gICAgICAgIGhhbmRsZXJfdHlwZTogJ2V2ZW50X3Byb2Nlc3NvcicsXG4gICAgICAgIHByb2Nlc3Nvcl9uYW1lOiAnRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvcicsXG4gICAgICAgIGV2ZW50X3NvdXJjZTogJ2F3czpkeW5hbW9kYicsXG4gICAgICAgIHNlcnZpY2U6ICdwbHVzZmFuJyxcbiAgICAgIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMTEsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCBdLCBjb25maWcpO1xuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnc3VjY2Vzc2Z1bCBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyIHJvb3Qgd2l0aCBhYnNvcmJlZCBjaGlsZCDihpIgc3VwcHJlc3NlZCcsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2F1ZGl0LWxvZ2dlci1yb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ2F3czpzcXMgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlcicsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyLnByb2Nlc3MnLFxuICAgICAgdGFnczoge1xuICAgICAgICBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InLFxuICAgICAgICBwcm9jZXNzb3JfbmFtZTogJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXInLFxuICAgICAgICBldmVudF9zb3VyY2U6ICdhd3M6c3FzJyxcbiAgICAgICAgc2VydmljZTogJ3BsdXNmYW4nLFxuICAgICAgfSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAyLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2hpbGQgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnYmF0Y2gtZG9uZScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdhdWRpdC1sb2dnZXItcm9vdCcsXG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIG9wZXJhdGlvbjogJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgQmF0Y2ggZG9uZScsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyLnByb2Nlc3MnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290LCBjaGlsZCBdLCBjb25maWcpO1xuXG4gICAgLy8gUm9vdDogZXZlbnRfcHJvY2Vzc29yIHNpbGVudCDihpIgcHJvbW90ZWQuIENoaWxkOiBsb2cgYWJzb3JiZWQgYnkgc3RyZWFtIHJ1bGVzIOKGkiBpbnRvIHJvb3QuXG4gICAgLy8gQWxsIGVtaXR0ZWQgYXJlIHByb21vdGVkIOKGkiBzdXBwcmVzc2VkLlxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIgcm9vdCBzdHJpcHBlZCwgZ2VudWluZSBhdWRpdC5lbnRpdHkgY2hpbGQgS0VQVCcsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2F1ZGl0LXJvb3Qtc3RyaXBwZWQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnYXdzOnNxcyBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIucHJvY2VzcycsXG4gICAgICB0YWdzOiB7XG4gICAgICAgIGhhbmRsZXJfdHlwZTogJ2V2ZW50X3Byb2Nlc3NvcicsXG4gICAgICAgIHByb2Nlc3Nvcl9uYW1lOiAnRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlcicsXG4gICAgICAgIGV2ZW50X3NvdXJjZTogJ2F3czpzcXMnLFxuICAgICAgICBzZXJ2aWNlOiAncGx1c2ZhbicsXG4gICAgICB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhdWRpdENoaWxkID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2F1ZGl0LWVudGl0eS0xJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2F1ZGl0LXJvb3Qtc3RyaXBwZWQnLFxuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBzdWJUeXBlOiAndXBkYXRlJyxcbiAgICAgIG9wZXJhdGlvbjogJ3RlYW1JbnRlZ3JhdGlvbkNvbmZpZy51cGRhdGUnLFxuICAgICAgZW50aXR5TmFtZTogJ3RlYW1JbnRlZ3JhdGlvbkNvbmZpZycsXG4gICAgICBlbnRpdHlJZDogJzcwMjEzMjEyLWQyMzktNDhjYS1iN2YxLWI4ZGE5MzE5OWExNCcsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIGF1ZGl0Q2hpbGQgXSwgY29uZmlnKTtcblxuICAgIC8vIFJvb3QgaXMgc2lsZW50IChldmVudF9wcm9jZXNzb3IgcnVsZSkg4oaSIHByb21vdGVkIOKGkiBzdHJpcHBlZCBmcm9tIG91dHB1dFxuICAgIC8vIGF1ZGl0LmVudGl0eSBpcyBnZW51aW5lbHkgZW1pdHRlZCDihpIga2VwdCwgYmVjb21lcyBhIG5ldyByb290IChubyBwYXJlbnQgcmVmKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2F1ZGl0LWVudGl0eS0xJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2F1ZGl0LWVudGl0eS0xJykhLnJlc29sdmVkUGFyZW50SWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnYXVkaXQtcm9vdC1zdHJpcHBlZCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3dhcm4tbGV2ZWwgZXZlbnQgcHJvY2Vzc29yIHJvb3Qgc3BhbiBpcyBOT1Qgc2lsZW5jZWQgKGV4Y2VwdCBjbGF1c2UpJywgKCkgPT4ge1xuICAgIC8vIFVzZSBhIGdlbmVyaWMgZXZlbnRfcHJvY2Vzc29yIChub3QgRHluYW1vREJTdHJlYW0qKSB0byBhdm9pZCBtYXRjaGluZ1xuICAgIC8vIHRoZSBzdHJlYW0tc3BlY2lmaWMgc2lsZW50X2JhdGNoX3NwYW5zIHJ1bGUgd2hpY2ggaGFzIG5vIHdhcm4gZXhjZXB0XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwcm9jLXdhcm4nLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnY3VzdG9tOnNxcyBHZW5lcmljRXZlbnRQcm9jZXNzb3InLFxuICAgICAgc291cmNlOiAnR2VuZXJpY0V2ZW50UHJvY2Vzc29yLnByb2Nlc3MnLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0sXG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihyb290LCBjb25maWcpO1xuXG4gICAgLy8gVGhlIGV2ZW50X3Byb2Nlc3NvciBydWxlIGhhcyBleGNlcHQ6IFt7c3VjY2VzczogZmFsc2V9LCB7bGV2ZWw6IFsnZXJyb3InLCdjcml0aWNhbCcsJ3dhcm4nXX1dXG4gICAgLy8gV2Fybi1sZXZlbCBldmVudHMgYXJlIGV4Y2x1ZGVkIGZyb20gdGhlIHNpbGVudCBydWxlIOKGkiBkZWZhdWx0IGVtaXRcbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdkZWZhdWx0Jyk7XG4gIH0pO1xuXG4gIHRlc3QoJ3N1Y2Nlc3NmdWwgZXZlbnQgcHJvY2Vzc29yIG1hdGNoZXMgdGhlIGNvcnJlY3QgYnVpbHRpbiBydWxlJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihyb290LCBjb25maWcpO1xuXG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdzaWxlbnQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLmV2ZW50X3Byb2Nlc3Nvci5zaWxlbnRfcm91dGluZV9zdWNjZXNzJyk7XG4gIH0pO1xuXG4gIHRlc3QoJ2ZhaWxlZCBldmVudCBwcm9jZXNzb3Igcm9vdCBzcGFuIGlzIE5PVCBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Byb2MtZmFpbCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdhd3M6ZHluYW1vZGIgRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvcicsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yLnByb2Nlc3MnLFxuICAgICAgdGFnczogeyBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InIH0sXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiB7IHR5cGU6ICdFcnJvcicsIG1lc3NhZ2U6ICdTTlMgcHVibGlzaCBmYWlsZWQnIH0sXG4gICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290IF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDEpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDApO1xuICB9KTtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDMuIFNUUkVBTSBQUk9DRVNTT1IgKyBBQlNPUkJFRCBDSElMRFJFTiAocmVhbGlzdGljIHNjZW5hcmlvKVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdzdHJlYW0gcnVsZSBtYXRjaGluZyAocGlja05vaXNlRGVjaXNpb24pJywgKCkgPT4ge1xuICB0ZXN0KCdcIlB1Ymxpc2ggU05TIGRvbmVcIiBsb2cgbWF0Y2hlcyB0aGUgYWJzb3JiX3B1Ymxpc2hfZG9uZSBydWxlJywgKCkgPT4ge1xuICAgIGNvbnN0IGxvZyA9IG1ha2VFdmVudCh7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIG9wZXJhdGlvbjogJ1B1Ymxpc2ggU05TIGRvbmUnLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3Nvci5wcm9jZXNzJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKGxvZywgY29uZmlnKTtcblxuICAgIGV4cGVjdChkZWNpc2lvbi5kZWNpc2lvbikudG9CZSgnYWJzb3JiJyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy5zdHJlYW0uYWJzb3JiX3B1Ymxpc2hfZG9uZScpO1xuICB9KTtcblxuICB0ZXN0KCdcIkJhdGNoIGRvbmVcIiBsb2cgbWF0Y2hlcyB0aGUgYWJzb3JiX2F1ZGl0X2RvbmUgcnVsZScsICgpID0+IHtcbiAgICBjb25zdCBsb2cgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBvcGVyYXRpb246ICdEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyIEJhdGNoIGRvbmUnLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlci5wcm9jZXNzJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKGxvZywgY29uZmlnKTtcblxuICAgIGV4cGVjdChkZWNpc2lvbi5kZWNpc2lvbikudG9CZSgnYWJzb3JiJyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy5zdHJlYW0uYWJzb3JiX2F1ZGl0X2RvbmUnKTtcbiAgfSk7XG5cbiAgdGVzdCgnYXVkaXQuZW50aXR5IGV2ZW50cyBkbyBOT1QgbWF0Y2ggYW55IGZyYW1ld29yay1sZXZlbCBzaWxlbmNlL2Fic29yYiBydWxlJywgKCkgPT4ge1xuICAgIGNvbnN0IGF1ZGl0RXZlbnQgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ2F1ZGl0LmVudGl0eScsXG4gICAgICBvcGVyYXRpb246ICd0ZWFtSW50ZWdyYXRpb25Db25maWcudXBkYXRlJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtQXVkaXRMb2dnZXIucHJvY2VzcycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihhdWRpdEV2ZW50LCBjb25maWcpO1xuXG4gICAgLy8gYXVkaXQuZW50aXR5IGV2ZW50cyBhcmUgZ2VudWluZSBhdWRpdCB0cmFpbCBkYXRhIOKAlCB0aGUgZnJhbWV3b3JrIGRvZXMgbm90XG4gICAgLy8gYWJzb3JiIG9yIHNpbGVuY2UgdGhlbS4gQXBwbGljYXRpb25zIGNhbiBhZGQgY3VzdG9tIHJ1bGVzIGZvciBub2lzeSBwYXR0ZXJucy5cbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdkZWZhdWx0Jyk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdzdHJlYW0gcHJvY2Vzc29yIHdpdGggY2hpbGRyZW4gKHJlYWxpc3RpYyknLCAoKSA9PiB7XG4gIHRlc3QoJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3Igd2l0aCBcIlB1Ymxpc2ggU05TIGRvbmVcIiBjaGlsZCDihpIgYWxsIHN1cHByZXNzZWQnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzdHJlYW0tcm9vdCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdhd3M6ZHluYW1vZGIgRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvcicsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yLnByb2Nlc3MnLFxuICAgICAgdGFnczoge1xuICAgICAgICBoYW5kbGVyX3R5cGU6ICdldmVudF9wcm9jZXNzb3InLFxuICAgICAgICBwcm9jZXNzb3JfbmFtZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3InLFxuICAgICAgICBldmVudF9zb3VyY2U6ICdhd3M6ZHluYW1vZGInLFxuICAgICAgfSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAxNyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHB1Ymxpc2hDaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwdWJsaXNoLWRvbmUnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc3RyZWFtLXJvb3QnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBvcGVyYXRpb246ICdQdWJsaXNoIFNOUyBkb25lJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgZHVyYXRpb25NczogMTUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgcHVibGlzaENoaWxkIF0sIGNvbmZpZyk7XG5cbiAgICAvLyBSb290OiBldmVudF9wcm9jZXNzb3Igc2lsZW50IChvciBzdHJlYW0gcnVsZSBzaWxlbnQpIOKGkiBwcm9tb3RlZFxuICAgIC8vIENoaWxkOiBhYnNvcmJlZCBieSBmdzI0LmhvdHBhdGhzLnN0cmVhbS5hYnNvcmJfcHVibGlzaF9kb25lIOKGkiBpbnRvIHJvb3RcbiAgICAvLyBBbGwgZW1pdHRlZCA9IHByb21vdGVkIOKGkiBzdXBwcmVzc2VkXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgxKTtcbiAgfSk7XG59KTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyA0LiBUQVNLIFdJVEggTUVBTklOR0ZVTCBDSElMRFJFTiAoc2hvdWxkIE5PVCBzdXBwcmVzcylcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgndGFzayB3aXRoIG1lYW5pbmdmdWwgY2hpbGRyZW4nLCAoKSA9PiB7XG4gIHRlc3QoJ3NvY2lhbC10b2tlbi1yZWZyZXNoIHRhc2s6IG5vaXNlIHJvb3Qgc3RyaXBwZWQsIGdlbnVpbmUgY2hpbGRyZW4ga2VwdCcsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rva2VuLXJvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnVGFzayBzb2NpYWwtdG9rZW4tcmVmcmVzaCcsXG4gICAgICBzb3VyY2U6ICd0YXNrOnNvY2lhbC10b2tlbi1yZWZyZXNoJyxcbiAgICAgIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAndGFzaycsIHRhc2tfbmFtZTogJ3NvY2lhbC10b2tlbi1yZWZyZXNoJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMjMsXG4gICAgfSk7XG5cbiAgICBjb25zdCBvYXV0aFJlZnJlc2ggPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnb2F1dGgtcmVmcmVzaCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICd0b2tlbi1yb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ29hdXRoLnR3aXR0ZXIucmVmcmVzaCcsXG4gICAgICBzb3VyY2U6ICd0YXNrOnNvY2lhbC10b2tlbi1yZWZyZXNoJyxcbiAgICAgIHRhZ3M6IHsgcGxhdGZvcm06ICd0d2l0dGVyJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDM4OCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGh0dHBDYWxsID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2h0dHAtY2FsbCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdvYXV0aC1yZWZyZXNoJyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ29hdXRoLnR3aXR0ZXIucmVmcmVzaFJlcXVlc3QnLFxuICAgICAgc291cmNlOiAndGFzazpzb2NpYWwtdG9rZW4tcmVmcmVzaCcsXG4gICAgICB0YWdzOiB7ICdodHRwLnVybCc6ICdodHRwczovL2FwaS54LmNvbS8yL29hdXRoMi90b2tlbicsICdodHRwLnN0YXR1cyc6ICcyMDAnLCAnaHR0cC5tZXRob2QnOiAnUE9TVCcgfSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAzODYsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgb2F1dGhSZWZyZXNoLCBodHRwQ2FsbCBdLCBjb25maWcpO1xuXG4gICAgLy8gUm9vdDogdGFzayBoYW5kbGVyX3R5cGUg4oaSIHNpbGVudCBydWxlIG1hdGNoZXMg4oaSIHByb21vdGVkIOKGkiBzdHJpcHBlZCAobm9pc2Ugcm9vdClcbiAgICAvLyBvYXV0aFJlZnJlc2g6IG5vIG1hdGNoaW5nIHNpbGVudCBydWxlIOKGkiBkZWZhdWx0IGVtaXQgKGdlbnVpbmUhKSDihpIgYmVjb21lcyBuZXcgcm9vdFxuICAgIC8vIGh0dHBDYWxsOiBubyBtYXRjaGluZyBzaWxlbnQgcnVsZSDihpIgZGVmYXVsdCBlbWl0IChnZW51aW5lISkg4oaSIGtlcHQgdW5kZXIgb2F1dGhSZWZyZXNoXG4gICAgLy8gTm9pc2Ugcm9vdCBzdHJpcHBlZCwgMiBnZW51aW5lIGNoaWxkcmVuIGVtaXR0ZWQuXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAndG9rZW4tcm9vdCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ29hdXRoLXJlZnJlc2gnKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnb2F1dGgtcmVmcmVzaCcpIS5yZXNvbHZlZFBhcmVudElkKS50b0JlVW5kZWZpbmVkKCk7IC8vIHBhcmVudCB3YXMgc3RyaXBwZWRcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnaHR0cC1jYWxsJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ2h0dHAtY2FsbCcpIS5yZXNvbHZlZFBhcmVudElkKS50b0JlKCdvYXV0aC1yZWZyZXNoJyk7IC8vIHN0aWxsIGxpbmtlZFxuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDApO1xuICB9KTtcblxuICB0ZXN0KCd0YXNrIHdpdGggZXJyb3IgY2hpbGQg4oaSIHJvb3QgZm9yY2VkIHRvIGVtaXQgKGhhcmQgc2lnbmFsIGFuY2VzdG9yKScsICgpID0+IHtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rhc2stZXJyb3Itcm9vdCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdUYXNrIGZhaWxpbmctdGFzaycsXG4gICAgICBzb3VyY2U6ICd0YXNrOmZhaWxpbmctdGFzaycsXG4gICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3Rhc2snIH0sXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMjAwLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZXJyb3JDaGlsZCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvci1jaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICd0YXNrLWVycm9yLXJvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnZXh0ZXJuYWwuYXBpLmNhbGwnLFxuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvcjogeyB0eXBlOiAnRXJyb3InLCBtZXNzYWdlOiAnQVBJIHRpbWVvdXQnIH0sXG4gICAgICBkdXJhdGlvbk1zOiA1MDAwLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgZXJyb3JDaGlsZCBdLCBjb25maWcpO1xuXG4gICAgLy8gRXJyb3IgY2hpbGQgaXMgaGFyZCBzaWduYWwg4oaSIGZvcmNlcyByb290IHRvIGVtaXQgYXMgaGFyZC1zaWduYWwtYW5jZXN0b3JcbiAgICAvLyBSb290IGlzIGdlbnVpbmVseSBlbWl0dGVkIChub3QgcHJvbW90ZWQpIOKGkiBub3Qgc3VwcHJlc3NlZFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KGZpbmRFbWl0dGVkKHJlc3VsdCwgJ3Rhc2stZXJyb3Itcm9vdCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChmaW5kRW1pdHRlZChyZXN1bHQsICdlcnJvci1jaGlsZCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDApO1xuICB9KTtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDUuIEVOVElUWSBXUklURSBPUEVSQVRJT05TIChhYnNvcmJlZCBpbnRvIHBhcmVudClcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgnZW50aXR5IHdyaXRlIG9wZXJhdGlvbiBhYnNvcnB0aW9uJywgKCkgPT4ge1xuICBjb25zdCBlbnRpdHlPcHMgPSBbICdjcmVhdGUnLCAndXBzZXJ0JywgJ3VwZGF0ZScgXTtcblxuICBmb3IgKGNvbnN0IG9wIG9mIGVudGl0eU9wcykge1xuICAgIHRlc3QoYEJhc2VFbnRpdHlTZXJ2aWNlLiR7b3B9IGlzIGFic29yYmVkIChzdWNjZXNzZnVsKWAsICgpID0+IHtcbiAgICAgIGNvbnN0IGV2ZW50ID0gbWFrZUV2ZW50KHtcbiAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICBvcGVyYXRpb246IGBCYXNlRW50aXR5U2VydmljZS4ke29wfWAsXG4gICAgICAgIHNvdXJjZTogYHNlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UuJHtvcH1gLFxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBkdXJhdGlvbk1zOiAyMCxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICAgIGNvbnN0IGRlY2lzaW9uID0gcGlja05vaXNlRGVjaXNpb24oZXZlbnQsIGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChkZWNpc2lvbi5kZWNpc2lvbikudG9CZSgnYWJzb3JiJyk7XG4gICAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLmVudGl0eS5hYnNvcmJfd3JpdGVfc3BhbnMnKTtcbiAgICB9KTtcbiAgfVxuXG4gIHRlc3QoJ2ZhaWxlZCBCYXNlRW50aXR5U2VydmljZS5jcmVhdGUgaXMgTk9UIGFic29yYmVkIChlcnJvciknLCAoKSA9PiB7XG4gICAgY29uc3QgZXZlbnQgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnQmFzZUVudGl0eVNlcnZpY2UuY3JlYXRlJyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UuY3JlYXRlJyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBlcnJvcjogeyB0eXBlOiAnRXJyb3InLCBtZXNzYWdlOiAnRHluYW1vREIgQ29uZGl0aW9uYWxDaGVja0ZhaWxlZCcgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IGRlY2lzaW9uID0gcGlja05vaXNlRGVjaXNpb24oZXZlbnQsIGNvbmZpZyk7XG5cbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLm5vdC50b0JlKCdhYnNvcmInKTtcbiAgfSk7XG5cbiAgdGVzdCgncXVldWUgaGFuZGxlciB3aXRoIG11bHRpcGxlIEJhc2VFbnRpdHlTZXJ2aWNlLmNyZWF0ZSBjaGlsZHJlbiDihpIgYWxsIGFic29yYmVkIHdpdGggY2hlY2twb2ludHMnLCAoKSA9PiB7XG4gICAgY29uc3QgYmFzZVRzID0gRGF0ZS5ub3coKTtcbiAgICBjb25zdCByb290ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3F1ZXVlLXJvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnU1FTIHBvc3Qtc3luYycsXG4gICAgICB0YWdzOiB7IGhhbmRsZXJfdHlwZTogJ3F1ZXVlJywgcXVldWVfbmFtZTogJ3Bvc3Qtc3luYycgfSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAzMDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGlsZHJlbiA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDUgfSwgKF8sIGkpID0+IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBjcmVhdGUtJHtpfWAsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdxdWV1ZS1yb290JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ0Jhc2VFbnRpdHlTZXJ2aWNlLmNyZWF0ZScsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlLmNyZWF0ZScsXG4gICAgICB0YWdzOiB7IG9wZXJhdGlvbl9jYXRlZ29yeTogJ3dyaXRlJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDIwICsgaSAqIDUsXG4gICAgICB0aW1lc3RhbXBNczogYmFzZVRzICsgaSAqIDUwLFxuICAgIH0pKTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyByb290LCAuLi5jaGlsZHJlbiBdLCBjb25maWcpO1xuXG4gICAgLy8gUm9vdDogbm8gcnVsZSBtYXRjaGVzIChxdWV1ZSBoYW5kbGVyIHdpdGhvdXQgdGFzay9ldmVudF9wcm9jZXNzb3IgaGFuZGxlcl90eXBlKSDihpIgZW1pdFxuICAgIC8vIEFsbCBjaGlsZHJlbjogYWJzb3JiZWQgaW50byByb290XG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAncXVldWUtcm9vdCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIGNvbnN0IGFic29yYmVkID0gZmluZEVtaXR0ZWQocmVzdWx0LCAncXVldWUtcm9vdCcpIS5hYnNvcmJlZDtcbiAgICBleHBlY3QoYWJzb3JiZWQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGFic29yYmVkIS5jb3VudCkudG9CZSg1KTtcbiAgICBleHBlY3QoYWJzb3JiZWQhLmJ5T3BlcmF0aW9uWyAnQmFzZUVudGl0eVNlcnZpY2UuY3JlYXRlJyBdKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChhYnNvcmJlZCEuYnlPcGVyYXRpb25bICdCYXNlRW50aXR5U2VydmljZS5jcmVhdGUnIF0uY291bnQpLnRvQmUoNSk7XG5cbiAgICAvLyBDaGVja3BvaW50czogZWFjaCBhYnNvcmJlZCBjaGlsZCBiZWNvbWVzIGEgdGltZWxpbmUgY2hlY2twb2ludCBvbiB0aGUgcGFyZW50XG4gICAgZXhwZWN0KGFic29yYmVkIS5jaGVja3BvaW50cykudG9IYXZlTGVuZ3RoKDUpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgNTsgaSsrKSB7XG4gICAgICBjb25zdCBjcCA9IGFic29yYmVkIS5jaGVja3BvaW50c1sgaSBdO1xuICAgICAgZXhwZWN0KGNwLm5hbWUpLnRvQmUoJ0Jhc2VFbnRpdHlTZXJ2aWNlLmNyZWF0ZScpO1xuICAgICAgZXhwZWN0KGNwLnRzKS50b0JlKGJhc2VUcyArIGkgKiA1MCk7XG4gICAgICBleHBlY3QoY3AuZHVyYXRpb25NcykudG9CZSgyMCArIGkgKiA1KTtcbiAgICAgIGV4cGVjdChjcC5zdWNjZXNzKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGNwLnRhZ3M/Lm9wZXJhdGlvbl9jYXRlZ29yeSkudG9CZSgnd3JpdGUnKTtcbiAgICB9XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gNi4gSEVBTFRIIENIRUNLICYgV0FSTVVQIFNJTEVOQ0lOR1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdpbmZyYXN0cnVjdHVyZSBub2lzZSBydWxlcycsICgpID0+IHtcbiAgdGVzdCgnaGVhbHRoIGNoZWNrIEdFVCBpcyBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCBoZWFsdGhDaGVjayA9IG1ha2VFdmVudCh7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIEdFVCAvaGVhbHRoJyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKGhlYWx0aENoZWNrLCBjb25maWcpO1xuXG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdzaWxlbnQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLmluZnJhLnNpbGVudF9oZWFsdGhjaGVjaycpO1xuICB9KTtcblxuICB0ZXN0KCd3YXJtdXAgaW52b2NhdGlvbiBpcyBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCB3YXJtdXAgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnTGFtYmRhIHdhcm11cCcsXG4gICAgICB0YWdzOiB7IHNvdXJjZTogJ3dhcm11cCcgfSxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKHdhcm11cCwgY29uZmlnKTtcblxuICAgIGV4cGVjdChkZWNpc2lvbi5kZWNpc2lvbikudG9CZSgnc2lsZW50Jyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy5pbmZyYS5zaWxlbnRfd2FybXVwJyk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gNy4gREFUQUJBU0UgUVVFUlkgQUJTT1JQVElPTlxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdkYXRhYmFzZSBxdWVyeSBhYnNvcnB0aW9uJywgKCkgPT4ge1xuICAvLyDilIDilIAgUkVBRCBxdWVyaWVzIOKGkiBhYnNvcmJlZCDilIDilIBcbiAgdGVzdC5lYWNoKFtcbiAgICBbJ2VudGl0eS5nZXQnLCA1MF0sXG4gICAgWydlbnRpdHkuYmF0Y2hHZXQnLCA4MF0sXG4gICAgWydvYnNlcnZhYmlsaXR5bG9nLmxpc3QnLCAyNTBdLFxuICAgIFsnb2JzZXJ2YWJpbGl0eWxvZy5xdWVyeScsIDM1MF0sXG4gICAgWyd1c2VyLmZpbmQnLCA0MF0sXG4gICAgWydwcm9kdWN0LmZldGNoJywgOTBdLFxuICAgIFsnc2Vzc2lvbi5yZWFkJywgNjBdLFxuICBdKSgnc3VjY2Vzc2Z1bCBSRUFEIHF1ZXJ5IFwiJXNcIiAoJWRtcykgaXMgYWJzb3JiZWQnLCAob3BlcmF0aW9uLCBkdXJhdGlvbk1zKSA9PiB7XG4gICAgY29uc3QgcXVlcnkgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihxdWVyeSwgY29uZmlnKTtcblxuICAgIGV4cGVjdChkZWNpc2lvbi5kZWNpc2lvbikudG9CZSgnYWJzb3JiJyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy5xdWVyaWVzLmFic29yYl9yZWFkX3F1ZXJpZXMnKTtcbiAgfSk7XG5cbiAgLy8g4pSA4pSAIFdSSVRFIHF1ZXJpZXMg4oaSIGFic29yYmVkIGludG8gcGFyZW50IChhYnNvcmJfd3JpdGVfc3VjY2VzcyBydWxlKSDilIDilIBcbiAgdGVzdC5lYWNoKFtcbiAgICBbJ3N0YW5kaW5nLnVwc2VydCcsIDUwXSxcbiAgICBbJ3N0YW5kaW5nLmNyZWF0ZScsIDQ1XSxcbiAgICBbJ3RlYW0udXBkYXRlJywgNjBdLFxuICAgIFsnZ2FtZS5kZWxldGUnLCAzMF0sXG4gIF0pKCdzdWNjZXNzZnVsIFdSSVRFIHF1ZXJ5IFwiJXNcIiAoJWRtcykgaXMgYWJzb3JiZWQgaW50byBwYXJlbnQnLCAob3BlcmF0aW9uLCBkdXJhdGlvbk1zKSA9PiB7XG4gICAgY29uc3QgcXVlcnkgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgIG9wZXJhdGlvbixcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihxdWVyeSwgY29uZmlnKTtcblxuICAgIC8vIE5ldyBydWxlOiBhYnNvcmJfd3JpdGVfc3VjY2VzcyBhYnNvcmJzIHN1Y2Nlc3NmdWwgd3JpdGVzIGludG8gcGFyZW50XG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdhYnNvcmInKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuYWJzb3JiX3dyaXRlX3N1Y2Nlc3MnKTtcbiAgfSk7XG5cbiAgLy8g4pSA4pSAIEVycm9yL3Nsb3cvc2NhbiBleGNlcHRpb25zIHN0aWxsIHdvcmsg4pSA4pSAXG4gIHRlc3QoJ3Nsb3cgcXVlcnkgKD49MTAwMG1zKSBpcyBlbWl0dGVkLCBub3QgYWJzb3JiZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgcXVlcnkgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgIG9wZXJhdGlvbjogJ29ic2VydmFiaWxpdHlsb2cucXVlcnknLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDEyMDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKHF1ZXJ5LCBjb25maWcpO1xuXG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdlbWl0Jyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy5xdWVyaWVzLmVtaXRfc2xvdycpO1xuICB9KTtcblxuICB0ZXN0KCdmYWlsZWQgcXVlcnkgaXMgZW1pdHRlZCByZWdhcmRsZXNzIG9mIHNwZWVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHF1ZXJ5ID0gbWFrZUV2ZW50KHtcbiAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICBvcGVyYXRpb246ICdvYnNlcnZhYmlsaXR5bG9nLnF1ZXJ5JyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZHVyYXRpb25NczogMjAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKHF1ZXJ5LCBjb25maWcpO1xuXG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdlbWl0Jyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLnJ1bGVJZCkudG9CZSgnZncyNC5ob3RwYXRocy5xdWVyaWVzLmVtaXRfZXJyb3JzJyk7XG4gIH0pO1xuXG4gIHRlc3QoJ3RhYmxlIHNjYW4gcXVlcnkgaXMgZW1pdHRlZCByZWdhcmRsZXNzIG9mIHN1Y2Nlc3MnLCAoKSA9PiB7XG4gICAgY29uc3QgcXVlcnkgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgIG9wZXJhdGlvbjogJ29ic2VydmFiaWxpdHlsb2cucXVlcnknLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDMwLFxuICAgICAgdGFnczogeyBzY2FuOiAndHJ1ZScgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbmZpZyA9IG1ha2VIb3RwYXRoc0NvbmZpZygpO1xuICAgIGNvbnN0IGRlY2lzaW9uID0gcGlja05vaXNlRGVjaXNpb24ocXVlcnksIGNvbmZpZyk7XG5cbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuZW1pdF9zY2FucycpO1xuICB9KTtcbn0pO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIDguIEFETUlOIEdFVCBDT05UUk9MTEVSIEZVTEwgU1VQUFJFU1NJT04gKGVuZC10by1lbmQgc2NlbmFyaW8pXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZGVzY3JpYmUoJ2FkbWluIEdFVCBjb250cm9sbGVyIGZ1bGwgc3VwcHJlc3Npb24nLCAoKSA9PiB7XG4gIHRlc3QoJ0hUVFAgR0VUIC9hZG1pbi9lbnRpdHkvKiB3aXRoIGRhdGFiYXNlLnF1ZXJ5IGNoaWxkIOKGkiBlbnRpcmUgaW52b2NhdGlvbiBzdXBwcmVzc2VkJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ2V0LWFkbWluLXJvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICB0YWdzOiB7ICdodHRwLm1ldGhvZCc6ICdHRVQnLCBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDQwMCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxpc3RTcGFuID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2xpc3Qtc3BhbicsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdCYXNlRW50aXR5U2VydmljZS5saXN0JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2dldC1hZG1pbi1yb290JyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAzMDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBkYlF1ZXJ5ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RiLXF1ZXJ5JyxcbiAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICBvcGVyYXRpb246ICdvYnNlcnZhYmlsaXR5bG9nLnF1ZXJ5JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2xpc3Qtc3BhbicsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMjUwLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHJvb3QsIGxpc3RTcGFuLCBkYlF1ZXJ5IF0sIGNvbmZpZyk7XG5cbiAgICAvLyByb290OiBzaWxlbmNlZCAoZmFzdCBzdWNjZXNzZnVsIEdFVCByZWFkKVxuICAgIC8vIGxpc3RTcGFuOiBzaWxlbmNlZCAoQmFzZUVudGl0eVNlcnZpY2UubGlzdClcbiAgICAvLyBkYlF1ZXJ5OiBhYnNvcmJlZCAoc3VjY2Vzc2Z1bCBxdWVyeSlcbiAgICAvLyDihpIgbm8gZ2VudWluZSBlbWl0cyDihpIgZW50aXJlIGludm9jYXRpb24gc3VwcHJlc3NlZFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMCk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0hUVFAgR0VUIC9hZG1pbi9lbnRpdHkvKiB3aXRoIEZBSUxFRCBxdWVyeSBjaGlsZCDihpIgcm9vdCBrZXB0IGJlY2F1c2Ugb2YgaGFyZCBzaWduYWwnLCAoKSA9PiB7XG4gICAgY29uc3Qgcm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdnZXQtYWRtaW4tcm9vdC1lcnInLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICB0YWdzOiB7ICdodHRwLm1ldGhvZCc6ICdHRVQnLCBvcGVyYXRpb25fY2F0ZWdvcnk6ICdyZWFkJyB9LFxuICAgICAgc3VjY2VzczogZmFsc2UsIC8vIGNvbnRyb2xsZXIgZmFpbGVkXG4gICAgICBkdXJhdGlvbk1zOiA0MDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBkYlF1ZXJ5ID0gbWFrZUV2ZW50KHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2RiLXF1ZXJ5LWVycicsXG4gICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eWxvZy5xdWVyeScsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdnZXQtYWRtaW4tcm9vdC1lcnInLFxuICAgICAgc3VjY2VzczogZmFsc2UsIC8vIHF1ZXJ5IGZhaWxlZFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgcm9vdCwgZGJRdWVyeSBdLCBjb25maWcpO1xuXG4gICAgLy8gQm90aCBoYXZlIGhhcmQgc2lnbmFscyAoc3VjY2VzczogZmFsc2UpIOKGkiBlbWl0dGVkXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgIGV4cGVjdChmaW5kRW1pdHRlZChyZXN1bHQsICdnZXQtYWRtaW4tcm9vdC1lcnInKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZmluZEVtaXR0ZWQocmVzdWx0LCAnZGItcXVlcnktZXJyJykpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gOS4gUlVMRSBQUklPUklUWTogdXNlciBydWxlcyBjYW4gb3ZlcnJpZGUgYnVpbHRpbiB0YXNrL3Byb2Nlc3NvciBydWxlc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmRlc2NyaWJlKCdydWxlIHByaW9yaXR5IG92ZXJyaWRlJywgKCkgPT4ge1xuICB0ZXN0KCd1c2VyIHJ1bGUgd2l0aCBoaWdoZXIgcHJpb3JpdHkgY2FuIGZvcmNlLWVtaXQgYSB0YXNrIHJvb3QnLCAoKSA9PiB7XG4gICAgY29uc3QgdGFza1Jvb3QgPSBtYWtlRXZlbnQoe1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaW1wb3J0YW50LXRhc2snLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnVGFzayBjcml0aWNhbC1kYXRhLWV4cG9ydCcsXG4gICAgICBzb3VyY2U6ICd0YXNrOmNyaXRpY2FsLWRhdGEtZXhwb3J0JyxcbiAgICAgIHRhZ3M6IHsgaGFuZGxlcl90eXBlOiAndGFzaycsIHRhc2tfbmFtZTogJ2NyaXRpY2FsLWRhdGEtZXhwb3J0JyB9LFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDUwMDAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoe1xuICAgICAgcnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAndXNlci5hbHdheXNfZW1pdF9jcml0aWNhbF90YXNrcycsXG4gICAgICAgICAgcHJpb3JpdHk6IDIwMCwgLy8gSGlnaGVyIHRoYW4gYnVpbHRpbiBwcmlvcml0eSBvZiA1XG4gICAgICAgICAgbWF0Y2g6IHtcbiAgICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJy9jcml0aWNhbC1kYXRhLWV4cG9ydC8nLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgZGVjaXNpb246ICdlbWl0JyxcbiAgICAgICAgICByZWFzb246ICdBbHdheXMgZW1pdCBjcml0aWNhbCBkYXRhIGV4cG9ydCB0YXNrcycsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHRhc2tSb290IF0sIGNvbmZpZyk7XG5cbiAgICAvLyBVc2VyIHJ1bGUgb3ZlcnJpZGVzIGJ1aWx0aW4gc2lsZW50IHJ1bGUg4oaSIGdlbnVpbmVseSBlbWl0dGVkIOKGkiBub3Qgc3VwcHJlc3NlZFxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0cy5zdXBwcmVzc2VkUm9vdHMpLnRvQmUoMCk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gTkVXIEJVSUxUSU4gUlVMRVMgKEZlYXR1cmUgNSlcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgnZncyNC5ob3RwYXRocy5hcGkuc2lsZW50X29wdGlvbnNfY29ycycsICgpID0+IHtcbiAgdGVzdCgnT1BUSU9OUyBwcmVmbGlnaHQgcmVxdWVzdCBpcyBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCBvcHRpb25zUm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdvcHRpb25zLXJvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBPUFRJT05TIC9hcGkvdXNlcnMnLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgb3B0aW9uc1Jvb3QgXSwgY29uZmlnKTtcblxuICAgIC8vIE9QVElPTlMgcmVxdWVzdCBzaG91bGQgYmUgc2lsZW5jZWQgKGFuZCBzdXBwcmVzc2VkIGFzIGxvbmUgc2lsZW50IHJvb3QpXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMpLnRvSGF2ZUxlbmd0aCgwKTtcbiAgICBleHBlY3QocmVzdWx0LnN0YXRzLnN1cHByZXNzZWRSb290cykudG9CZSgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnT1BUSU9OUyBwcmVmbGlnaHQgd2l0aCBlcnJvciBpcyBTVElMTCBzaWxlbmNlZCAocHJpb3JpdHkgOTUgb3ZlcnJpZGVzKScsICgpID0+IHtcbiAgICAvLyBUaGUgT1BUSU9OUyBzaWxlbnQgcnVsZSBoYXMgcHJpb3JpdHkgOTUsIHdoaWNoIGlzIHZlcnkgaGlnaC5cbiAgICAvLyBFdmVuIGVycm9ycyB3b24ndCBlc2NhcGUgdW5sZXNzIGhhcmQgc2lnbmFscyBraWNrIGluLlxuICAgIGNvbnN0IG9wdGlvbnNFdmVudCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdvcHRpb25zLWVycicsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIE9QVElPTlMgL2FwaS9yZXNvdXJjZXMnLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihvcHRpb25zRXZlbnQsIGNvbmZpZyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdzaWxlbnQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLmFwaS5zaWxlbnRfb3B0aW9uc19jb3JzJyk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdmdzI0LmhvdHBhdGhzLmFwaS5zaWxlbnRfZmF2aWNvbicsICgpID0+IHtcbiAgdGVzdCgnZmF2aWNvbi5pY28gcmVxdWVzdCBpcyBzaWxlbmNlZCcsICgpID0+IHtcbiAgICBjb25zdCBmYXZpY29uUm9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXZpY29uLXJvb3QnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2Zhdmljb24uaWNvJyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAyLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGZhdmljb25Sb290IF0sIGNvbmZpZyk7XG5cbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cykudG9IYXZlTGVuZ3RoKDApO1xuICAgIGV4cGVjdChyZXN1bHQuc3RhdHMuc3VwcHJlc3NlZFJvb3RzKS50b0JlKDEpO1xuICB9KTtcblxuICB0ZXN0KCdmYXZpY29uIGRlY2lzaW9uIGlzIHNpbGVudCB3aXRoIGNvcnJlY3QgcnVsZSBpZCcsICgpID0+IHtcbiAgICBjb25zdCBmYXZpY29uRXZlbnQgPSBtYWtlRXZlbnQoe1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnSFRUUCBHRVQgL2Zhdmljb24uaWNvJyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKGZhdmljb25FdmVudCwgY29uZmlnKTtcbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ3NpbGVudCcpO1xuICAgIGV4cGVjdChkZWNpc2lvbi5ydWxlSWQpLnRvQmUoJ2Z3MjQuaG90cGF0aHMuYXBpLnNpbGVudF9mYXZpY29uJyk7XG4gIH0pO1xufSk7XG5cbmRlc2NyaWJlKCdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuYWJzb3JiX3dyaXRlX3N1Y2Nlc3MnLCAoKSA9PiB7XG4gIHRlc3QoJ3N1Y2Nlc3NmdWwgd3JpdGUgcXVlcnkgaXMgYWJzb3JiZWQgaW50byBwYXJlbnQnLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50Um9vdCA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdhcGktcm9vdCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBvcGVyYXRpb246ICdIVFRQIFBPU1QgL2FwaS91c2VycycsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMjAwLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgd3JpdGVRdWVyeSA9IG1ha2VFdmVudCh7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd3cml0ZS1xdWVyeScsXG4gICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgb3BlcmF0aW9uOiAnVXNlci5jcmVhdGUoaWQ9YWJjKScsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMTUsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdhcGktcm9vdCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKHdyaXRlUXVlcnksIGNvbmZpZyk7XG4gICAgZXhwZWN0KGRlY2lzaW9uLmRlY2lzaW9uKS50b0JlKCdhYnNvcmInKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuYWJzb3JiX3dyaXRlX3N1Y2Nlc3MnKTtcbiAgfSk7XG5cbiAgdGVzdCgnZmFpbGVkIHdyaXRlIHF1ZXJ5IGlzIE5PVCBhYnNvcmJlZCAoZW1pdF9lcnJvcnMgcnVsZSB3aW5zKScsICgpID0+IHtcbiAgICBjb25zdCBmYWlsZWRXcml0ZSA9IG1ha2VFdmVudCh7XG4gICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgb3BlcmF0aW9uOiAnVXNlci5jcmVhdGUoaWQ9YWJjKScsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGR1cmF0aW9uTXM6IDE1LFxuICAgIH0pO1xuXG4gICAgY29uc3QgY29uZmlnID0gbWFrZUhvdHBhdGhzQ29uZmlnKCk7XG4gICAgY29uc3QgZGVjaXNpb24gPSBwaWNrTm9pc2VEZWNpc2lvbihmYWlsZWRXcml0ZSwgY29uZmlnKTtcbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuZW1pdF9lcnJvcnMnKTtcbiAgfSk7XG5cbiAgdGVzdCgnc2xvdyB3cml0ZSBxdWVyeSBpcyBOT1QgYWJzb3JiZWQgKGVtaXRfc2xvdyBydWxlIHdpbnMpJywgKCkgPT4ge1xuICAgIGNvbnN0IHNsb3dXcml0ZSA9IG1ha2VFdmVudCh7XG4gICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgb3BlcmF0aW9uOiAnVXNlci51cHNlcnQoaWQ9YWJjKScsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMjAwMCwgLy8gPiAxMDAwbXMgdGhyZXNob2xkXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb25maWcgPSBtYWtlSG90cGF0aHNDb25maWcoKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tOb2lzZURlY2lzaW9uKHNsb3dXcml0ZSwgY29uZmlnKTtcbiAgICBleHBlY3QoZGVjaXNpb24uZGVjaXNpb24pLnRvQmUoJ2VtaXQnKTtcbiAgICBleHBlY3QoZGVjaXNpb24ucnVsZUlkKS50b0JlKCdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuZW1pdF9zbG93Jyk7XG4gIH0pO1xufSk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gTk9JU0UgUkVEVUNUSU9OIFBSRVNFVCBMRVZFTFMgKEZlYXR1cmUgNSlcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5kZXNjcmliZSgnTm9pc2UgUmVkdWN0aW9uIFByZXNldCBMZXZlbHMnLCAoKSA9PiB7XG4gIC8vIEltcG9ydCBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIHRvIHRlc3QgcHJlc2V0IHJlc29sdXRpb25cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby12YXItcmVxdWlyZXNcbiAgY29uc3QgeyBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnIH0gPSByZXF1aXJlKCcuLi8uLi9jb25maWcnKTtcblxuICB0ZXN0KCdwcmVzZXQgXCJvZmZcIiBrZWVwcyBub2lzZSByZWR1Y3Rpb24gZGlzYWJsZWQnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBub2lzZVJlZHVjdGlvbjogeyBwcmVzZXQ6ICdvZmYnIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KGNvbmZpZy5ub2lzZVJlZHVjdGlvbi5lbmFibGVkKS50b0JlKGZhbHNlKTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLnByZXNldCkudG9CZSgnb2ZmJyk7XG4gIH0pO1xuXG4gIHRlc3QoJ3ByZXNldCBcInJlY29tbWVuZGVkXCIgZW5hYmxlcyBub2lzZSByZWR1Y3Rpb24gd2l0aCBkZWZhdWx0IGJvdW5kcycsICgpID0+IHtcbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7IHByZXNldDogJ3JlY29tbWVuZGVkJyB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLnByZXNldCkudG9CZSgncmVjb21tZW5kZWQnKTtcbiAgICAvLyBEZWZhdWx0IGJvdW5kc1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24ubWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuKS50b0JlKDIwKTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLm1heEFic29yYmVkQ2hlY2twb2ludHNQZXJTcGFuKS50b0JlKDEwMCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3ByZXNldCBcImFnZ3Jlc3NpdmVcIiBlbmFibGVzIG5vaXNlIHJlZHVjdGlvbiB3aXRoIHRpZ2h0ZXIgYm91bmRzJywgKCkgPT4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgICAgbm9pc2VSZWR1Y3Rpb246IHsgcHJlc2V0OiAnYWdncmVzc2l2ZScgfSxcbiAgICB9KTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQpLnRvQmUodHJ1ZSk7XG4gICAgZXhwZWN0KGNvbmZpZy5ub2lzZVJlZHVjdGlvbi5wcmVzZXQpLnRvQmUoJ2FnZ3Jlc3NpdmUnKTtcbiAgICAvLyBBZ2dyZXNzaXZlIGJvdW5kc1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24ubWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuKS50b0JlKDEwKTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLm1heEFic29yYmVkQ2hlY2twb2ludHNQZXJTcGFuKS50b0JlKDUwKTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLm1heEFic29yYmVkQ2F1c2VkQnlMaW5rc1BlclNwYW4pLnRvQmUoMjUpO1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24ubWF4QWJzb3JiZWRFbnRpdHlJZHNQZXJTcGFuKS50b0JlKDUwKTtcbiAgICBleHBlY3QoY29uZmlnLm5vaXNlUmVkdWN0aW9uLm1heEFic29yYmVkT3BlcmF0aW9uS2V5c1BlclNwYW4pLnRvQmUoMjUpO1xuICB9KTtcblxuICB0ZXN0KCdleHBsaWNpdCBlbmFibGVkPWZhbHNlIG92ZXJyaWRlcyByZWNvbW1lbmRlZCBwcmVzZXQnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBub2lzZVJlZHVjdGlvbjogeyBwcmVzZXQ6ICdyZWNvbW1lbmRlZCcsIGVuYWJsZWQ6IGZhbHNlIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KGNvbmZpZy5ub2lzZVJlZHVjdGlvbi5lbmFibGVkKS50b0JlKGZhbHNlKTtcbiAgfSk7XG5cbiAgdGVzdCgnZXhwbGljaXQgZW5hYmxlZD10cnVlIG92ZXJyaWRlcyBvZmYgcHJlc2V0JywgKCkgPT4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoe1xuICAgICAgbm9pc2VSZWR1Y3Rpb246IHsgcHJlc2V0OiAnb2ZmJywgZW5hYmxlZDogdHJ1ZSB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgfSk7XG5cbiAgdGVzdCgnYWdncmVzc2l2ZSBwcmVzZXQgdXNlcyBsb3dlciBzbG93VGhyZXNob2xkTXMnLCAoKSA9PiB7XG4gICAgY29uc3QgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyh7XG4gICAgICBub2lzZVJlZHVjdGlvbjogeyBwcmVzZXQ6ICdhZ2dyZXNzaXZlJyB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24uaGFyZFNpZ25hbHM/LnNsb3dUaHJlc2hvbGRNcykudG9CZSgyMDAwKTtcbiAgfSk7XG5cbiAgdGVzdCgnZXhwbGljaXQgYm91bmRzIG92ZXJyaWRlIGFnZ3Jlc3NpdmUgcHJlc2V0IGJvdW5kcycsICgpID0+IHtcbiAgICBjb25zdCBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKHtcbiAgICAgIG5vaXNlUmVkdWN0aW9uOiB7XG4gICAgICAgIHByZXNldDogJ2FnZ3Jlc3NpdmUnLFxuICAgICAgICBtYXhBYnNvcmJlZEVycm9yc1BlclNwYW46IDUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChjb25maWcubm9pc2VSZWR1Y3Rpb24ubWF4QWJzb3JiZWRFcnJvcnNQZXJTcGFuKS50b0JlKDUpO1xuICAgIC8vIE90aGVyIGFnZ3Jlc3NpdmUgYm91bmRzIGFyZSBzdGlsbCBhcHBsaWVkXG4gICAgZXhwZWN0KGNvbmZpZy5ub2lzZVJlZHVjdGlvbi5tYXhBYnNvcmJlZENoZWNrcG9pbnRzUGVyU3BhbikudG9CZSg1MCk7XG4gIH0pO1xufSk7XG4iXX0=