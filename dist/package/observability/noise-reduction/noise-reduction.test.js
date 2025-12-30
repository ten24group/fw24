"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const config_1 = require("../config");
describe('noise reduction', () => {
    const baseNoise = (0, config_1.createObservabilityConfig)().noiseReduction;
    it('drops span.start when the corresponding consolidated span is dropped', () => {
        const parentSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'parent',
            operation: 'parent',
            durationMs: 10,
        };
        const childSpanStart = {
            type: 'span.start',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'child',
            parentObservabilityLogId: 'parent',
            operation: 'processor record',
            capture: { backends: ['otel'] },
            durationMs: undefined,
        };
        const childSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'child',
            parentObservabilityLogId: 'parent',
            operation: 'processor record',
            durationMs: 1,
        };
        const { events } = (0, index_1.applyNoiseReduction)([parentSpan, childSpanStart, childSpan], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.batch_processors'],
        });
        expect(events.find((e) => e.observabilityLogId === 'child' && e.type === 'span')).toBeUndefined();
        expect(events.find((e) => e.observabilityLogId === 'child' && e.type === 'span.start')).toBeUndefined();
        expect(events.find((e) => e.observabilityLogId === 'parent' && e.type === 'span')).toBeDefined();
    });
    it('drops stream processor batch spans (root spans are noisy, audit.entity kept separately)', () => {
        const auditBatchSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'audit-batch',
            source: 'DynamoDBStreamAuditLogger.process',
            operation: 'aws:sqs DynamoDBStreamAuditLogger',
            durationMs: 1,
            status: 'completed',
        };
        const snsBatchSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'sns-batch',
            source: 'DynamoDBStreamToSNSProcessor.process',
            operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
            durationMs: 20,
            status: 'completed',
        };
        const auditEntity = {
            type: 'audit.entity',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'audit-entity',
            source: 'DynamoDBStreamAuditLogger.process',
            operation: 'user.update',
            entityName: 'user',
        };
        const { events } = (0, index_1.applyNoiseReduction)([auditBatchSpan, snsBatchSpan, auditEntity], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.hotpaths'],
        });
        // Batch spans should be dropped
        expect(events.find((e) => e.observabilityLogId === 'audit-batch')).toBeUndefined();
        expect(events.find((e) => e.observabilityLogId === 'sns-batch')).toBeUndefined();
        // audit.entity should be kept
        expect(events.find((e) => e.observabilityLogId === 'audit-entity')).toBeDefined();
    });
    it('aggregates per-record spans into parent span instead of emitting them', () => {
        const parentSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'parent',
            operation: 'parent',
            durationMs: 10,
        };
        const childSpanStart = {
            type: 'span.start',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'child',
            parentObservabilityLogId: 'parent',
            operation: 'processor record',
            capture: { backends: ['otel'] },
        };
        const childSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'child',
            parentObservabilityLogId: 'parent',
            operation: 'processor record',
            durationMs: 3,
        };
        const { events } = (0, index_1.applyNoiseReduction)([parentSpan, childSpanStart, childSpan], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.batch_processors'],
        });
        // both child span and its span.start should be removed
        expect(events.find((e) => e.observabilityLogId === 'child')).toBeUndefined();
        const parent = events.find((e) => e.observabilityLogId === 'parent' && e.type === 'span');
        const data = parent.data;
        expect(data?.noiseReduction?.aggregates).toBeTruthy();
        // Includes richer aggregate payloads (examples + rule ids) by default
        const firstKey = Object.keys(data.noiseReduction.aggregates)[0];
        expect(Array.isArray(data.noiseReduction.aggregates[firstKey]?.examples)).toBe(true);
    });
    it('bounds folded checkpoints to avoid runaway growth', () => {
        const parentSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'parent',
            operation: 'parent',
            durationMs: 10,
        };
        const logs = Array.from({ length: 20 }).map((_, i) => ({
            type: 'log',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2 + i,
            observabilityLogId: `l${i}`,
            parentObservabilityLogId: 'parent',
            operation: 'Publish SNS done',
            source: 'DynamoDBStreamToSNSProcessor.process',
        }));
        const { events } = (0, index_1.applyNoiseReduction)([parentSpan, ...logs], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.hotpaths'],
            maxCheckpointsPerSpan: 5,
        });
        const parent = events.find((e) => e.observabilityLogId === 'parent' && e.type === 'span');
        const data = parent.data;
        expect(Array.isArray(data?.checkpoints)).toBe(true);
        expect(data.checkpoints.length).toBeLessThanOrEqual(6); // includes possible truncation marker
    });
    it('matches durationMs as minimum threshold (>=)', () => {
        const fastSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'fast',
            operation: 'fast-op',
            durationMs: 50,
        };
        const slowSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'slow',
            operation: 'slow-op',
            durationMs: 150,
        };
        const exactSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 3,
            observabilityLogId: 'exact',
            operation: 'exact-op',
            durationMs: 100,
        };
        // Rule: drop spans with duration >= 100ms
        const { events, stats } = (0, index_1.applyNoiseReduction)([fastSpan, slowSpan, exactSpan], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.drop_slow',
                    match: { type: 'span', minDurationMs: 100 },
                    decision: 'drop',
                    reason: 'Drop slow spans',
                },
            ],
        });
        // Fast span should be kept (50ms < 100ms threshold)
        expect(events.find((e) => e.observabilityLogId === 'fast')).toBeDefined();
        // Slow span should be dropped (150ms >= 100ms threshold)
        expect(events.find((e) => e.observabilityLogId === 'slow')).toBeUndefined();
        // Exact span should be dropped (100ms >= 100ms threshold)
        expect(events.find((e) => e.observabilityLogId === 'exact')).toBeUndefined();
        expect(stats.dropped).toBe(2);
        expect(stats.kept).toBe(1);
    });
    it('folds logs into parent span as checkpoints', () => {
        const parentSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'parent',
            operation: 'parent-op',
            durationMs: 100,
        };
        const childLog = {
            type: 'log',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'child-log',
            parentObservabilityLogId: 'parent',
            operation: 'processing item',
            source: 'TestService.process',
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([parentSpan, childLog], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.fold_logs',
                    match: { type: 'log', source: 'TestService.process' },
                    decision: 'fold',
                    reason: 'Fold processing logs',
                },
            ],
        });
        // Child log should be folded (removed from output)
        expect(events.find((e) => e.observabilityLogId === 'child-log')).toBeUndefined();
        // Parent should have checkpoint for folded log
        const parent = events.find((e) => e.observabilityLogId === 'parent');
        const data = parent.data;
        expect(Array.isArray(data?.checkpoints)).toBe(true);
        expect(data.checkpoints.some((cp) => cp.name?.includes('fold:log'))).toBe(true);
        expect(stats.folded).toBe(1);
        expect(stats.kept).toBe(1);
    });
    it('never drops error events (hard signal protection)', () => {
        const errorSpan = {
            type: 'span',
            level: 'error',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'error-span',
            operation: 'failing-op',
            durationMs: 10,
            error: { type: 'Error', message: 'Something failed' },
        };
        const failedSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'failed-span',
            operation: 'another-op',
            durationMs: 10,
            success: false,
        };
        // Rule: drop all spans (but errors should be protected)
        const { events, stats } = (0, index_1.applyNoiseReduction)([errorSpan, failedSpan], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.drop_all',
                    match: { type: 'span' },
                    decision: 'drop',
                    reason: 'Drop all spans',
                },
            ],
        });
        // Both error signals should be kept despite drop rule
        expect(events.find((e) => e.observabilityLogId === 'error-span')).toBeDefined();
        expect(events.find((e) => e.observabilityLogId === 'failed-span')).toBeDefined();
        expect(stats.kept).toBe(2);
        expect(stats.dropped).toBe(0);
    });
    it('matches tags correctly', () => {
        const matchingSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'matching',
            operation: 'test-op',
            durationMs: 10,
            tags: { processor: 'audit', entity: 'user' },
        };
        const nonMatchingSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'non-matching',
            operation: 'test-op',
            durationMs: 10,
            tags: { processor: 'sns', entity: 'post' },
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([matchingSpan, nonMatchingSpan], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.drop_audit_user',
                    match: { type: 'span', tags: { processor: 'audit', entity: 'user' } },
                    decision: 'drop',
                    reason: 'Drop audit user spans',
                },
            ],
        });
        // Matching span should be dropped
        expect(events.find((e) => e.observabilityLogId === 'matching')).toBeUndefined();
        // Non-matching span should be kept
        expect(events.find((e) => e.observabilityLogId === 'non-matching')).toBeDefined();
        expect(stats.dropped).toBe(1);
        expect(stats.kept).toBe(1);
    });
    it('matches regex patterns in source and operation', () => {
        const matchingLog = {
            type: 'log',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'matching',
            operation: 'Publish SNS done',
            source: 'DynamoDBStreamToSNSProcessor.process',
        };
        const nonMatchingLog = {
            type: 'log',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'non-matching',
            operation: 'Processing item',
            source: 'MyService.process',
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([matchingLog, nonMatchingLog], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.drop_sns_publish',
                    priority: 100, // Higher than builtin fold rule (40)
                    match: {
                        type: 'log',
                        source: '/^DynamoDBStream.*Processor\\.process$/',
                        operation: '/Publish.*done/',
                    },
                    decision: 'drop',
                    reason: 'Drop SNS publish completion logs',
                },
            ],
        });
        // Matching log should be dropped
        expect(events.find((e) => e.observabilityLogId === 'matching')).toBeUndefined();
        // Non-matching log should be kept
        expect(events.find((e) => e.observabilityLogId === 'non-matching')).toBeDefined();
        expect(stats.dropped).toBe(1);
        expect(stats.kept).toBe(1);
    });
    it('downgrades events by stripping heavy fields', () => {
        const heavyLog = {
            type: 'log',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'heavy',
            operation: 'processing',
            data: {
                largePayload: Array(1000).fill('x').join(''),
                metadata: { key: 'value' },
            },
            tags: { important: 'tag' },
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([heavyLog], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.downgrade_heavy',
                    match: { type: 'log', operation: 'processing' },
                    decision: 'downgrade',
                    reason: 'Strip heavy fields from processing logs',
                },
            ],
        });
        const downgraded = events.find((e) => e.observabilityLogId === 'heavy');
        expect(downgraded).toBeDefined();
        // data should be stripped
        expect(downgraded.data).toBeUndefined();
        // tags should be kept
        expect(downgraded.tags).toEqual({ important: 'tag' });
        expect(stats.downgraded).toBe(1);
    });
    it('drops root spans without parent (regression test for critical bug)', () => {
        const rootSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'root',
            operation: 'root-operation',
            durationMs: 100,
            // No parentObservabilityLogId - this is a root span
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([rootSpan], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.drop_root',
                    match: { type: 'span', operation: 'root-operation' },
                    decision: 'drop',
                    reason: 'Drop root spans',
                },
            ],
        });
        // Root span MUST be dropped (regression test - this was broken before)
        expect(events.find((e) => e.observabilityLogId === 'root')).toBeUndefined();
        expect(stats.dropped).toBe(1);
    });
    it('aggregate gracefully handles events without parent', () => {
        const orphanLog = {
            type: 'log',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 1,
            observabilityLogId: 'orphan',
            operation: 'orphan-op',
            // No parentObservabilityLogId
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([orphanLog], {
            ...baseNoise,
            enabled: true,
            rules: [
                {
                    id: 'test.aggregate_orphan',
                    match: { type: 'log', operation: 'orphan-op' },
                    decision: 'aggregate',
                    reason: 'Try to aggregate orphan',
                },
            ],
        });
        // Event without parent should be kept (can't aggregate without parent)
        expect(events.find((e) => e.observabilityLogId === 'orphan')).toBeDefined();
        expect(stats.kept).toBe(1);
        expect(stats.aggregated).toBe(0);
    });
    test('rule correctly matches DynamoDBStreamToSNSProcessor span for dropping', () => {
        const parentSpan = {
            observabilityLogId: 'sns-parent',
            type: 'span',
            level: 'info',
            source: 'DynamoDBStreamToSNSProcessor.process',
            operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50
        };
        // Apply noise reduction to just the span (no children)
        const { events, stats } = (0, index_1.applyNoiseReduction)([parentSpan], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.hotpaths'],
            rules: []
        });
        // Without children, the span should be dropped
        expect(events.find(e => e.observabilityLogId === 'sns-parent')).toBeUndefined();
        expect(stats.dropped).toBe(1);
    });
    test('drops parent span even when children are folded into it (DynamoDBStreamToSNSProcessor case)', () => {
        const parentSpan = {
            observabilityLogId: 'sns-parent',
            type: 'span',
            level: 'info',
            source: 'DynamoDBStreamToSNSProcessor.process',
            operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50
        };
        const childLog = {
            observabilityLogId: 'child-log',
            type: 'log',
            level: 'info',
            source: 'DynamoDBStreamToSNSProcessor.process',
            operation: 'Publish SNS done',
            timestampMs: 120,
            correlationId: 'test',
            parentObservabilityLogId: 'sns-parent'
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([parentSpan, childLog], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.hotpaths'],
            rules: []
        });
        // Parent span should be dropped even though child was folded into it
        expect(events.find(e => e.observabilityLogId === 'sns-parent')).toBeUndefined();
        // Child log should be folded (and thus not in output as standalone)
        expect(events.find(e => e.observabilityLogId === 'child-log')).toBeUndefined();
        // Both should be counted as processed
        expect(stats.dropped).toBe(1); // parent span
        expect(stats.folded).toBe(1); // child log
    });
    test('does not force-keep parent with aggregate decision even when children are folded into it', () => {
        const grandparentSpan = {
            observabilityLogId: 'grandparent',
            type: 'span',
            level: 'info',
            source: 'WorkflowController.process',
            operation: 'workflow.batch',
            timestampMs: 50,
            correlationId: 'test',
            durationMs: 100
        };
        const parentSpan = {
            observabilityLogId: 'parent',
            type: 'span',
            level: 'info',
            source: 'service:BaseEntityService.upsert',
            operation: 'BaseEntityService.upsert',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50,
            parentObservabilityLogId: 'grandparent'
        };
        const childLog = {
            observabilityLogId: 'child-log',
            type: 'log',
            level: 'info',
            source: 'service:BaseEntityService.upsert',
            operation: 'Entity upserted',
            timestampMs: 120,
            correlationId: 'test',
            parentObservabilityLogId: 'parent'
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([grandparentSpan, parentSpan, childLog], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.hotpaths'],
            rules: [
                {
                    id: 'test.fold_entity_logs',
                    match: { type: 'log', operation: 'Entity upserted' },
                    decision: 'fold',
                    reason: 'Fold entity operation logs'
                }
            ]
        });
        // Parent span should be aggregated (not kept) even though child was processed
        expect(events.find(e => e.observabilityLogId === 'parent')).toBeUndefined();
        // Grandparent should be kept and have aggregation summary
        const grandparent = events.find(e => e.observabilityLogId === 'grandparent');
        expect(grandparent).toBeDefined();
        expect(grandparent?.data).toHaveProperty('noiseReduction');
        // Stats should show aggregation
        expect(stats.aggregated).toBeGreaterThan(0);
    });
    test('does not force-keep parent with fold decision even when children are folded into it', () => {
        const grandparentSpan = {
            observabilityLogId: 'grandparent',
            type: 'span',
            level: 'info',
            source: 'WorkflowController.process',
            operation: 'workflow.batch',
            timestampMs: 50,
            correlationId: 'test',
            durationMs: 100
        };
        const parentSpan = {
            observabilityLogId: 'parent',
            type: 'span',
            level: 'info',
            source: 'SomeService.process',
            operation: 'process.record',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50,
            parentObservabilityLogId: 'grandparent'
        };
        const childLog = {
            observabilityLogId: 'child-log',
            type: 'log',
            level: 'info',
            source: 'SomeService.process',
            operation: 'Record processed',
            timestampMs: 120,
            correlationId: 'test',
            parentObservabilityLogId: 'parent'
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([grandparentSpan, parentSpan, childLog], {
            ...baseNoise,
            enabled: true,
            presets: [],
            rules: [
                {
                    id: 'test.fold_record_spans',
                    match: { type: 'span', operation: 'process.record' },
                    decision: 'fold',
                    reason: 'Fold record processing spans'
                },
                {
                    id: 'test.fold_child_logs',
                    match: { type: 'log', operation: 'Record processed' },
                    decision: 'fold',
                    reason: 'Fold completion logs'
                }
            ]
        });
        // Parent span should be folded (not kept) even though it had a child folded into it
        expect(events.find(e => e.observabilityLogId === 'parent')).toBeUndefined();
        // Child log should also be folded
        expect(events.find(e => e.observabilityLogId === 'child-log')).toBeUndefined();
        // Grandparent should be kept and have fold checkpoints
        const grandparent = events.find(e => e.observabilityLogId === 'grandparent');
        expect(grandparent).toBeDefined();
        expect(grandparent?.data?.checkpoints).toBeDefined();
        // Stats should show folding
        expect(stats.folded).toBe(2); // both parent and child folded
    });
    test('matches success field correctly', () => {
        const successSpan = {
            observabilityLogId: 'success-1',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            success: true
        };
        const failSpan = {
            observabilityLogId: 'fail-1',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            success: false,
            // Explicitly allow dropping this failure (override hard signal protection)
            capture: { noise: { decision: 'drop', reason: 'test override' } }
        };
        const noSuccessSpan = {
            observabilityLogId: 'no-success-1',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test'
        };
        // Rule matching success: true should only match successSpan
        const successRule = {
            id: 'test.success',
            match: { success: true },
            decision: 'drop',
            reason: 'test'
        };
        const result1 = (0, index_1.applyNoiseReduction)([successSpan, failSpan, noSuccessSpan], { ...baseNoise, enabled: true, rules: [successRule] });
        expect(result1.events.find((e) => e.observabilityLogId === 'success-1')).toBeUndefined(); // dropped
        expect(result1.events.find((e) => e.observabilityLogId === 'fail-1')).toBeUndefined(); // dropped (via override)
        expect(result1.events.find((e) => e.observabilityLogId === 'no-success-1')).toBeDefined(); // kept
        // Rule matching success: false should only match failSpan
        const failRule = {
            id: 'test.fail',
            match: { success: false },
            decision: 'drop',
            reason: 'test'
        };
        const result2 = (0, index_1.applyNoiseReduction)([successSpan, failSpan, noSuccessSpan], { ...baseNoise, enabled: true, rules: [failRule] });
        expect(result2.events.find((e) => e.observabilityLogId === 'success-1')).toBeDefined(); // kept
        expect(result2.events.find((e) => e.observabilityLogId === 'fail-1')).toBeUndefined(); // dropped (matched + override)
        expect(result2.events.find((e) => e.observabilityLogId === 'no-success-1')).toBeDefined(); // kept
    });
    test('matches maxDurationMs correctly (upper bound)', () => {
        const fastSpan = {
            observabilityLogId: 'fast-1',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 30
        };
        const mediumSpan = {
            observabilityLogId: 'medium-1',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50 // exactly at threshold - should NOT match (< 50)
        };
        const slowSpan = {
            observabilityLogId: 'slow-1',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 100
        };
        // Match spans under 50ms
        const rule = {
            id: 'test.fast',
            match: { maxDurationMs: 50 },
            decision: 'drop',
            reason: 'test'
        };
        const result = (0, index_1.applyNoiseReduction)([fastSpan, mediumSpan, slowSpan], { ...baseNoise, enabled: true, rules: [rule] });
        expect(result.events.find((e) => e.observabilityLogId === 'fast-1')).toBeUndefined(); // dropped (30 < 50)
        expect(result.events.find((e) => e.observabilityLogId === 'medium-1')).toBeDefined(); // kept (50 >= 50)
        expect(result.events.find((e) => e.observabilityLogId === 'slow-1')).toBeDefined(); // kept (100 >= 50)
    });
    test('matches duration range correctly (durationMs + maxDurationMs)', () => {
        const tooFast = {
            observabilityLogId: 'too-fast',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 5
        };
        const inRange = {
            observabilityLogId: 'in-range',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50
        };
        const tooSlow = {
            observabilityLogId: 'too-slow',
            type: 'span',
            level: 'info',
            operation: 'test.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 150
        };
        // Match spans between 10ms and 100ms (inclusive lower, exclusive upper)
        const rule = {
            id: 'test.range',
            match: { minDurationMs: 10, maxDurationMs: 100 },
            decision: 'drop',
            reason: 'test'
        };
        const result = (0, index_1.applyNoiseReduction)([tooFast, inRange, tooSlow], { ...baseNoise, enabled: true, rules: [rule] });
        expect(result.events.find((e) => e.observabilityLogId === 'too-fast')).toBeDefined(); // kept (5 < 10)
        expect(result.events.find((e) => e.observabilityLogId === 'in-range')).toBeUndefined(); // dropped (10 <= 50 < 100)
        expect(result.events.find((e) => e.observabilityLogId === 'too-slow')).toBeDefined(); // kept (150 >= 100)
    });
    test('drops successful fast GET requests (fw24.hotpaths preset)', () => {
        const fastGetSuccess = {
            observabilityLogId: 'fast-get-1',
            type: 'span',
            level: 'info',
            source: 'AdminDynamicEntityController.list',
            operation: 'GET /admin/entity/observabilitylog',
            timestampMs: 100,
            correlationId: 'test',
            success: true,
            durationMs: 8
        };
        const slowGetSuccess = {
            observabilityLogId: 'slow-get-1',
            type: 'span',
            level: 'info',
            source: 'AdminDynamicEntityController.list',
            operation: 'GET /admin/entity/observabilitylog',
            timestampMs: 100,
            correlationId: 'test',
            success: true,
            durationMs: 1500
        };
        const fastGetFail = {
            observabilityLogId: 'fast-get-fail',
            type: 'span',
            level: 'error',
            source: 'AdminDynamicEntityController.list',
            operation: 'GET /admin/entity/observabilitylog',
            timestampMs: 100,
            correlationId: 'test',
            success: false,
            durationMs: 8,
            error: { type: 'NotFoundError', message: 'Not found' }
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([fastGetSuccess, slowGetSuccess, fastGetFail], {
            ...baseNoise,
            enabled: true,
            presets: ['fw24.hotpaths'],
            rules: []
        });
        // Fast successful GET should be dropped
        expect(events.find(e => e.observabilityLogId === 'fast-get-1')).toBeUndefined();
        // Slow successful GET should be downgraded (kept but stripped)
        const slowGet = events.find(e => e.observabilityLogId === 'slow-get-1');
        expect(slowGet).toBeDefined();
        // Failed GET should be kept (hard signal protection)
        expect(events.find(e => e.observabilityLogId === 'fast-get-fail')).toBeDefined();
        expect(stats.dropped).toBeGreaterThanOrEqual(1);
    });
    test('force-keeps parent with keep/downgrade decision when children are folded', () => {
        const parentSpan = {
            observabilityLogId: 'parent',
            type: 'span',
            level: 'info',
            source: 'ImportantService.process',
            operation: 'important.operation',
            timestampMs: 100,
            correlationId: 'test',
            durationMs: 50
        };
        const childLog = {
            observabilityLogId: 'child-log',
            type: 'log',
            level: 'info',
            source: 'ImportantService.process',
            operation: 'Processing done',
            timestampMs: 120,
            correlationId: 'test',
            parentObservabilityLogId: 'parent'
        };
        const { events, stats } = (0, index_1.applyNoiseReduction)([parentSpan, childLog], {
            ...baseNoise,
            enabled: true,
            presets: [],
            rules: [
                {
                    id: 'test.fold_child_logs',
                    match: { type: 'log', operation: 'Processing done' },
                    decision: 'fold',
                    reason: 'Fold completion logs'
                }
            ]
        });
        // Parent span should be kept to preserve fold summary
        // (It's kept naturally by its 'keep' decision, not force-kept)
        const parent = events.find(e => e.observabilityLogId === 'parent');
        expect(parent).toBeDefined();
        // Child should be folded into parent
        expect(events.find(e => e.observabilityLogId === 'child-log')).toBeUndefined();
        expect(stats.folded).toBe(1);
        // Parent should have fold checkpoint from child
        expect(parent?.data?.checkpoints).toBeDefined();
        expect(parent?.data?.checkpoints.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9pc2UtcmVkdWN0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vbm9pc2UtcmVkdWN0aW9uLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBOEM7QUFFOUMsc0NBQXNEO0FBRXRELFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUU7SUFDL0IsTUFBTSxTQUFTLEdBQUcsSUFBQSxrQ0FBeUIsR0FBRSxDQUFDLGNBQWMsQ0FBQztJQUU3RCxFQUFFLENBQUMsc0VBQXNFLEVBQUUsR0FBRyxFQUFFO1FBQzlFLE1BQU0sVUFBVSxHQUF1QjtZQUNyQyxJQUFJLEVBQUUsTUFBTTtZQUNaLEtBQUssRUFBRSxNQUFNO1lBQ2IsYUFBYSxFQUFFLElBQUk7WUFDbkIsV0FBVyxFQUFFLENBQUM7WUFDZCxrQkFBa0IsRUFBRSxRQUFRO1lBQzVCLFNBQVMsRUFBRSxRQUFRO1lBQ25CLFVBQVUsRUFBRSxFQUFFO1NBQ2YsQ0FBQztRQUVGLE1BQU0sY0FBYyxHQUF1QjtZQUN6QyxJQUFJLEVBQUUsWUFBWTtZQUNsQixLQUFLLEVBQUUsTUFBTTtZQUNiLGFBQWEsRUFBRSxJQUFJO1lBQ25CLFdBQVcsRUFBRSxDQUFDO1lBQ2Qsa0JBQWtCLEVBQUUsT0FBTztZQUMzQix3QkFBd0IsRUFBRSxRQUFRO1lBQ2xDLFNBQVMsRUFBRSxrQkFBa0I7WUFDN0IsT0FBTyxFQUFFLEVBQUUsUUFBUSxFQUFFLENBQUUsTUFBTSxDQUFFLEVBQUU7WUFDakMsVUFBVSxFQUFFLFNBQVM7U0FDdEIsQ0FBQztRQUVGLE1BQU0sU0FBUyxHQUF1QjtZQUNwQyxJQUFJLEVBQUUsTUFBTTtZQUNaLEtBQUssRUFBRSxNQUFNO1lBQ2IsYUFBYSxFQUFFLElBQUk7WUFDbkIsV0FBVyxFQUFFLENBQUM7WUFDZCxrQkFBa0IsRUFBRSxPQUFPO1lBQzNCLHdCQUF3QixFQUFF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LENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4vaW5kZXgnO1xuaW1wb3J0IHR5cGUgeyBOb2lzZVJ1bGUsIE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9jb25maWcnO1xuXG5kZXNjcmliZSgnbm9pc2UgcmVkdWN0aW9uJywgKCkgPT4ge1xuICBjb25zdCBiYXNlTm9pc2UgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKCkubm9pc2VSZWR1Y3Rpb247XG5cbiAgaXQoJ2Ryb3BzIHNwYW4uc3RhcnQgd2hlbiB0aGUgY29ycmVzcG9uZGluZyBjb25zb2xpZGF0ZWQgc3BhbiBpcyBkcm9wcGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAncGFyZW50JyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZFNwYW5TdGFydDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4uc3RhcnQnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMixcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBvcGVyYXRpb246ICdwcm9jZXNzb3IgcmVjb3JkJyxcbiAgICAgIGNhcHR1cmU6IHsgYmFja2VuZHM6IFsgJ290ZWwnIF0gfSxcbiAgICAgIGR1cmF0aW9uTXM6IHVuZGVmaW5lZCxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NvciByZWNvcmQnLFxuICAgICAgZHVyYXRpb25NczogMSxcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkU3BhblN0YXJ0LCBjaGlsZFNwYW4gXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmJhdGNoX3Byb2Nlc3NvcnMnIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZCcgJiYgZS50eXBlID09PSAnc3BhbicpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2NoaWxkJyAmJiBlLnR5cGUgPT09ICdzcGFuLnN0YXJ0JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50JyAmJiBlLnR5cGUgPT09ICdzcGFuJykpLnRvQmVEZWZpbmVkKCk7XG4gIH0pO1xuXG4gIGl0KCdkcm9wcyBzdHJlYW0gcHJvY2Vzc29yIGJhdGNoIHNwYW5zIChyb290IHNwYW5zIGFyZSBub2lzeSwgYXVkaXQuZW50aXR5IGtlcHQgc2VwYXJhdGVseSknLCAoKSA9PiB7XG4gICAgY29uc3QgYXVkaXRCYXRjaFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdhdWRpdC1iYXRjaCcsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyLnByb2Nlc3MnLFxuICAgICAgb3BlcmF0aW9uOiAnYXdzOnNxcyBEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyJyxcbiAgICAgIGR1cmF0aW9uTXM6IDEsXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxuICAgIH07XG5cbiAgICBjb25zdCBzbnNCYXRjaFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbnMtYmF0Y2gnLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3Nvci5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ2F3czpkeW5hbW9kYiBEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yJyxcbiAgICAgIGR1cmF0aW9uTXM6IDIwLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICB9O1xuXG4gICAgY29uc3QgYXVkaXRFbnRpdHk6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdhdWRpdC5lbnRpdHknLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMSxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2F1ZGl0LWVudGl0eScsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyLnByb2Nlc3MnLFxuICAgICAgb3BlcmF0aW9uOiAndXNlci51cGRhdGUnLFxuICAgICAgZW50aXR5TmFtZTogJ3VzZXInLFxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgYXVkaXRCYXRjaFNwYW4sIHNuc0JhdGNoU3BhbiwgYXVkaXRFbnRpdHkgXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBCYXRjaCBzcGFucyBzaG91bGQgYmUgZHJvcHBlZFxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdhdWRpdC1iYXRjaCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Nucy1iYXRjaCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gYXVkaXQuZW50aXR5IHNob3VsZCBiZSBrZXB0XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2F1ZGl0LWVudGl0eScpKS50b0JlRGVmaW5lZCgpO1xuICB9KTtcblxuICBpdCgnYWdncmVnYXRlcyBwZXItcmVjb3JkIHNwYW5zIGludG8gcGFyZW50IHNwYW4gaW5zdGVhZCBvZiBlbWl0dGluZyB0aGVtJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAncGFyZW50JyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZFNwYW5TdGFydDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4uc3RhcnQnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMixcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBvcGVyYXRpb246ICdwcm9jZXNzb3IgcmVjb3JkJyxcbiAgICAgIGNhcHR1cmU6IHsgYmFja2VuZHM6IFsgJ290ZWwnIF0gfSxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NvciByZWNvcmQnLFxuICAgICAgZHVyYXRpb25NczogMyxcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkU3BhblN0YXJ0LCBjaGlsZFNwYW4gXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmJhdGNoX3Byb2Nlc3NvcnMnIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIGJvdGggY2hpbGQgc3BhbiBhbmQgaXRzIHNwYW4uc3RhcnQgc2hvdWxkIGJlIHJlbW92ZWRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnY2hpbGQnKSkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgY29uc3QgcGFyZW50ID0gZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50JyAmJiBlLnR5cGUgPT09ICdzcGFuJykhO1xuICAgIGNvbnN0IGRhdGEgPSBwYXJlbnQuZGF0YSBhcyBhbnk7XG4gICAgZXhwZWN0KGRhdGE/Lm5vaXNlUmVkdWN0aW9uPy5hZ2dyZWdhdGVzKS50b0JlVHJ1dGh5KCk7XG4gICAgLy8gSW5jbHVkZXMgcmljaGVyIGFnZ3JlZ2F0ZSBwYXlsb2FkcyAoZXhhbXBsZXMgKyBydWxlIGlkcykgYnkgZGVmYXVsdFxuICAgIGNvbnN0IGZpcnN0S2V5ID0gT2JqZWN0LmtleXMoZGF0YS5ub2lzZVJlZHVjdGlvbi5hZ2dyZWdhdGVzKVsgMCBdO1xuICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGRhdGEubm9pc2VSZWR1Y3Rpb24uYWdncmVnYXRlc1sgZmlyc3RLZXkgXT8uZXhhbXBsZXMpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICBpdCgnYm91bmRzIGZvbGRlZCBjaGVja3BvaW50cyB0byBhdm9pZCBydW5hd2F5IGdyb3d0aCcsICgpID0+IHtcbiAgICBjb25zdCBwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ3BhcmVudCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMCxcbiAgICB9O1xuXG4gICAgY29uc3QgbG9nczogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiAyMCB9KS5tYXAoKF8sIGkpID0+ICh7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDIgKyBpLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBgbCR7aX1gLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ1B1Ymxpc2ggU05TIGRvbmUnLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3Nvci5wcm9jZXNzJyxcbiAgICB9KSk7XG5cbiAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgcGFyZW50U3BhbiwgLi4ubG9ncyBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnIF0sXG4gICAgICAgIG1heENoZWNrcG9pbnRzUGVyU3BhbjogNSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgY29uc3QgcGFyZW50ID0gZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50JyAmJiBlLnR5cGUgPT09ICdzcGFuJykhO1xuICAgIGNvbnN0IGRhdGEgPSBwYXJlbnQuZGF0YSBhcyBhbnk7XG4gICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoZGF0YT8uY2hlY2twb2ludHMpKS50b0JlKHRydWUpO1xuICAgIGV4cGVjdCgoZGF0YS5jaGVja3BvaW50cyBhcyBhbnlbXSkubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDYpOyAvLyBpbmNsdWRlcyBwb3NzaWJsZSB0cnVuY2F0aW9uIG1hcmtlclxuICB9KTtcblxuICBpdCgnbWF0Y2hlcyBkdXJhdGlvbk1zIGFzIG1pbmltdW0gdGhyZXNob2xkICg+PSknLCAoKSA9PiB7XG4gICAgY29uc3QgZmFzdFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ2Zhc3Qtb3AnLFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgfTtcblxuICAgIGNvbnN0IHNsb3dTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc2xvdycsXG4gICAgICBvcGVyYXRpb246ICdzbG93LW9wJyxcbiAgICAgIGR1cmF0aW9uTXM6IDE1MCxcbiAgICB9O1xuXG4gICAgY29uc3QgZXhhY3RTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAzLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZXhhY3QnLFxuICAgICAgb3BlcmF0aW9uOiAnZXhhY3Qtb3AnLFxuICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgIH07XG5cbiAgICAvLyBSdWxlOiBkcm9wIHNwYW5zIHdpdGggZHVyYXRpb24gPj0gMTAwbXNcbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIGZhc3RTcGFuLCBzbG93U3BhbiwgZXhhY3RTcGFuIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZHJvcF9zbG93JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgbWluRHVyYXRpb25NczogMTAwIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBzbG93IHNwYW5zJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBGYXN0IHNwYW4gc2hvdWxkIGJlIGtlcHQgKDUwbXMgPCAxMDBtcyB0aHJlc2hvbGQpXG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Zhc3QnKSkudG9CZURlZmluZWQoKTtcbiAgICAvLyBTbG93IHNwYW4gc2hvdWxkIGJlIGRyb3BwZWQgKDE1MG1zID49IDEwMG1zIHRocmVzaG9sZClcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc2xvdycpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gRXhhY3Qgc3BhbiBzaG91bGQgYmUgZHJvcHBlZCAoMTAwbXMgPj0gMTAwbXMgdGhyZXNob2xkKVxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdleGFjdCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIGl0KCdmb2xkcyBsb2dzIGludG8gcGFyZW50IHNwYW4gYXMgY2hlY2twb2ludHMnLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMSxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBvcGVyYXRpb246ICdwYXJlbnQtb3AnLFxuICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZExvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQtbG9nJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBvcGVyYXRpb246ICdwcm9jZXNzaW5nIGl0ZW0nLFxuICAgICAgc291cmNlOiAnVGVzdFNlcnZpY2UucHJvY2VzcycsXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgcGFyZW50U3BhbiwgY2hpbGRMb2cgXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5mb2xkX2xvZ3MnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIHNvdXJjZTogJ1Rlc3RTZXJ2aWNlLnByb2Nlc3MnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgICAgcmVhc29uOiAnRm9sZCBwcm9jZXNzaW5nIGxvZ3MnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIENoaWxkIGxvZyBzaG91bGQgYmUgZm9sZGVkIChyZW1vdmVkIGZyb20gb3V0cHV0KVxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZC1sb2cnKSkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgLy8gUGFyZW50IHNob3VsZCBoYXZlIGNoZWNrcG9pbnQgZm9yIGZvbGRlZCBsb2dcbiAgICBjb25zdCBwYXJlbnQgPSBldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQnKSE7XG4gICAgY29uc3QgZGF0YSA9IHBhcmVudC5kYXRhIGFzIGFueTtcbiAgICBleHBlY3QoQXJyYXkuaXNBcnJheShkYXRhPy5jaGVja3BvaW50cykpLnRvQmUodHJ1ZSk7XG4gICAgZXhwZWN0KGRhdGEuY2hlY2twb2ludHMuc29tZSgoY3A6IGFueSkgPT4gY3AubmFtZT8uaW5jbHVkZXMoJ2ZvbGQ6bG9nJykpKS50b0JlKHRydWUpO1xuXG4gICAgZXhwZWN0KHN0YXRzLmZvbGRlZCkudG9CZSgxKTtcbiAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgxKTtcbiAgfSk7XG5cbiAgaXQoJ25ldmVyIGRyb3BzIGVycm9yIGV2ZW50cyAoaGFyZCBzaWduYWwgcHJvdGVjdGlvbiknLCAoKSA9PiB7XG4gICAgY29uc3QgZXJyb3JTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMSxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Vycm9yLXNwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnZmFpbGluZy1vcCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMCxcbiAgICAgIGVycm9yOiB7IHR5cGU6ICdFcnJvcicsIG1lc3NhZ2U6ICdTb21ldGhpbmcgZmFpbGVkJyB9LFxuICAgIH07XG5cbiAgICBjb25zdCBmYWlsZWRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZmFpbGVkLXNwYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnYW5vdGhlci1vcCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMCxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgIH07XG5cbiAgICAvLyBSdWxlOiBkcm9wIGFsbCBzcGFucyAoYnV0IGVycm9ycyBzaG91bGQgYmUgcHJvdGVjdGVkKVxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgZXJyb3JTcGFuLCBmYWlsZWRTcGFuIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZHJvcF9hbGwnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCBhbGwgc3BhbnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEJvdGggZXJyb3Igc2lnbmFscyBzaG91bGQgYmUga2VwdCBkZXNwaXRlIGRyb3AgcnVsZVxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdlcnJvci1zcGFuJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2ZhaWxlZC1zcGFuJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMCk7XG4gIH0pO1xuXG4gIGl0KCdtYXRjaGVzIHRhZ3MgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgIGNvbnN0IG1hdGNoaW5nU3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMSxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ21hdGNoaW5nJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qtb3AnLFxuICAgICAgZHVyYXRpb25NczogMTAsXG4gICAgICB0YWdzOiB7IHByb2Nlc3NvcjogJ2F1ZGl0JywgZW50aXR5OiAndXNlcicgfSxcbiAgICB9O1xuXG4gICAgY29uc3Qgbm9uTWF0Y2hpbmdTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbm9uLW1hdGNoaW5nJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qtb3AnLFxuICAgICAgZHVyYXRpb25NczogMTAsXG4gICAgICB0YWdzOiB7IHByb2Nlc3NvcjogJ3NucycsIGVudGl0eTogJ3Bvc3QnIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgbWF0Y2hpbmdTcGFuLCBub25NYXRjaGluZ1NwYW4gXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5kcm9wX2F1ZGl0X3VzZXInLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nLCB0YWdzOiB7IHByb2Nlc3NvcjogJ2F1ZGl0JywgZW50aXR5OiAndXNlcicgfSB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgYXVkaXQgdXNlciBzcGFucycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gTWF0Y2hpbmcgc3BhbiBzaG91bGQgYmUgZHJvcHBlZFxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdtYXRjaGluZycpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gTm9uLW1hdGNoaW5nIHNwYW4gc2hvdWxkIGJlIGtlcHRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbm9uLW1hdGNoaW5nJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIGl0KCdtYXRjaGVzIHJlZ2V4IHBhdHRlcm5zIGluIHNvdXJjZSBhbmQgb3BlcmF0aW9uJywgKCkgPT4ge1xuICAgIGNvbnN0IG1hdGNoaW5nTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdtYXRjaGluZycsXG4gICAgICBvcGVyYXRpb246ICdQdWJsaXNoIFNOUyBkb25lJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgfTtcblxuICAgIGNvbnN0IG5vbk1hdGNoaW5nTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDIsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdub24tbWF0Y2hpbmcnLFxuICAgICAgb3BlcmF0aW9uOiAnUHJvY2Vzc2luZyBpdGVtJyxcbiAgICAgIHNvdXJjZTogJ015U2VydmljZS5wcm9jZXNzJyxcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBtYXRjaGluZ0xvZywgbm9uTWF0Y2hpbmdMb2cgXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5kcm9wX3Nuc19wdWJsaXNoJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxMDAsIC8vIEhpZ2hlciB0aGFuIGJ1aWx0aW4gZm9sZCBydWxlICg0MClcbiAgICAgICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgICAgICAgICBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtLipQcm9jZXNzb3JcXFxcLnByb2Nlc3MkLycsXG4gICAgICAgICAgICAgIG9wZXJhdGlvbjogJy9QdWJsaXNoLipkb25lLycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgU05TIHB1Ymxpc2ggY29tcGxldGlvbiBsb2dzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBNYXRjaGluZyBsb2cgc2hvdWxkIGJlIGRyb3BwZWRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbWF0Y2hpbmcnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIE5vbi1tYXRjaGluZyBsb2cgc2hvdWxkIGJlIGtlcHRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbm9uLW1hdGNoaW5nJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIGl0KCdkb3duZ3JhZGVzIGV2ZW50cyBieSBzdHJpcHBpbmcgaGVhdnkgZmllbGRzJywgKCkgPT4ge1xuICAgIGNvbnN0IGhlYXZ5TG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdoZWF2eScsXG4gICAgICBvcGVyYXRpb246ICdwcm9jZXNzaW5nJyxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgbGFyZ2VQYXlsb2FkOiBBcnJheSgxMDAwKS5maWxsKCd4Jykuam9pbignJyksXG4gICAgICAgIG1ldGFkYXRhOiB7IGtleTogJ3ZhbHVlJyB9LFxuICAgICAgfSxcbiAgICAgIHRhZ3M6IHsgaW1wb3J0YW50OiAndGFnJyB9LFxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIGhlYXZ5TG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZG93bmdyYWRlX2hlYXZ5JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBvcGVyYXRpb246ICdwcm9jZXNzaW5nJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkb3duZ3JhZGUnLFxuICAgICAgICAgICAgcmVhc29uOiAnU3RyaXAgaGVhdnkgZmllbGRzIGZyb20gcHJvY2Vzc2luZyBsb2dzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBkb3duZ3JhZGVkID0gZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnaGVhdnknKSE7XG4gICAgZXhwZWN0KGRvd25ncmFkZWQpLnRvQmVEZWZpbmVkKCk7XG4gICAgLy8gZGF0YSBzaG91bGQgYmUgc3RyaXBwZWRcbiAgICBleHBlY3QoZG93bmdyYWRlZC5kYXRhKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gdGFncyBzaG91bGQgYmUga2VwdFxuICAgIGV4cGVjdChkb3duZ3JhZGVkLnRhZ3MpLnRvRXF1YWwoeyBpbXBvcnRhbnQ6ICd0YWcnIH0pO1xuICAgIGV4cGVjdChzdGF0cy5kb3duZ3JhZGVkKS50b0JlKDEpO1xuICB9KTtcblxuICBpdCgnZHJvcHMgcm9vdCBzcGFucyB3aXRob3V0IHBhcmVudCAocmVncmVzc2lvbiB0ZXN0IGZvciBjcml0aWNhbCBidWcpJywgKCkgPT4ge1xuICAgIGNvbnN0IHJvb3RTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncm9vdCcsXG4gICAgICBvcGVyYXRpb246ICdyb290LW9wZXJhdGlvbicsXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgICAvLyBObyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgLSB0aGlzIGlzIGEgcm9vdCBzcGFuXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgcm9vdFNwYW4gXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5kcm9wX3Jvb3QnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nLCBvcGVyYXRpb246ICdyb290LW9wZXJhdGlvbicgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIHJvb3Qgc3BhbnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFJvb3Qgc3BhbiBNVVNUIGJlIGRyb3BwZWQgKHJlZ3Jlc3Npb24gdGVzdCAtIHRoaXMgd2FzIGJyb2tlbiBiZWZvcmUpXG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Jvb3QnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDEpO1xuICB9KTtcblxuICBpdCgnYWdncmVnYXRlIGdyYWNlZnVsbHkgaGFuZGxlcyBldmVudHMgd2l0aG91dCBwYXJlbnQnLCAoKSA9PiB7XG4gICAgY29uc3Qgb3JwaGFuTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdvcnBoYW4nLFxuICAgICAgb3BlcmF0aW9uOiAnb3JwaGFuLW9wJyxcbiAgICAgIC8vIE5vIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIG9ycGhhbkxvZyBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmFnZ3JlZ2F0ZV9vcnBoYW4nLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIG9wZXJhdGlvbjogJ29ycGhhbi1vcCcgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ1RyeSB0byBhZ2dyZWdhdGUgb3JwaGFuJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBFdmVudCB3aXRob3V0IHBhcmVudCBzaG91bGQgYmUga2VwdCAoY2FuJ3QgYWdncmVnYXRlIHdpdGhvdXQgcGFyZW50KVxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdvcnBoYW4nKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgxKTtcbiAgICBleHBlY3Qoc3RhdHMuYWdncmVnYXRlZCkudG9CZSgwKTtcbiAgfSk7XG5cbiAgdGVzdCgncnVsZSBjb3JyZWN0bHkgbWF0Y2hlcyBEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yIHNwYW4gZm9yIGRyb3BwaW5nJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nucy1wYXJlbnQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICdhd3M6ZHluYW1vZGIgRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvcicsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogNTBcbiAgICB9O1xuXG4gICAgLy8gQXBwbHkgbm9pc2UgcmVkdWN0aW9uIHRvIGp1c3QgdGhlIHNwYW4gKG5vIGNoaWxkcmVuKVxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgcGFyZW50U3BhbiBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnIF0sXG4gICAgICAgIHJ1bGVzOiBbXVxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBXaXRob3V0IGNoaWxkcmVuLCB0aGUgc3BhbiBzaG91bGQgYmUgZHJvcHBlZFxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc25zLXBhcmVudCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0YXRzLmRyb3BwZWQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIHRlc3QoJ2Ryb3BzIHBhcmVudCBzcGFuIGV2ZW4gd2hlbiBjaGlsZHJlbiBhcmUgZm9sZGVkIGludG8gaXQgKER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IgY2FzZSknLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc25zLXBhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3Nvci5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ2F3czpkeW5hbW9kYiBEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiA1MFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZExvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQtbG9nJyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICdQdWJsaXNoIFNOUyBkb25lJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMjAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbnMtcGFyZW50J1xuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgICAgcnVsZXM6IFtdXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFBhcmVudCBzcGFuIHNob3VsZCBiZSBkcm9wcGVkIGV2ZW4gdGhvdWdoIGNoaWxkIHdhcyBmb2xkZWQgaW50byBpdFxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc25zLXBhcmVudCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gQ2hpbGQgbG9nIHNob3VsZCBiZSBmb2xkZWQgKGFuZCB0aHVzIG5vdCBpbiBvdXRwdXQgYXMgc3RhbmRhbG9uZSlcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2NoaWxkLWxvZycpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gQm90aCBzaG91bGQgYmUgY291bnRlZCBhcyBwcm9jZXNzZWRcbiAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgxKTsgLy8gcGFyZW50IHNwYW5cbiAgICBleHBlY3Qoc3RhdHMuZm9sZGVkKS50b0JlKDEpOyAvLyBjaGlsZCBsb2dcbiAgfSk7XG5cbiAgdGVzdCgnZG9lcyBub3QgZm9yY2Uta2VlcCBwYXJlbnQgd2l0aCBhZ2dyZWdhdGUgZGVjaXNpb24gZXZlbiB3aGVuIGNoaWxkcmVuIGFyZSBmb2xkZWQgaW50byBpdCcsICgpID0+IHtcbiAgICBjb25zdCBncmFuZHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2dyYW5kcGFyZW50JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBzb3VyY2U6ICdXb3JrZmxvd0NvbnRyb2xsZXIucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICd3b3JrZmxvdy5iYXRjaCcsXG4gICAgICB0aW1lc3RhbXBNczogNTAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMDBcbiAgICB9O1xuXG4gICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBzb3VyY2U6ICdzZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydCcsXG4gICAgICBvcGVyYXRpb246ICdCYXNlRW50aXR5U2VydmljZS51cHNlcnQnLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ3JhbmRwYXJlbnQnXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC1sb2cnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnc2VydmljZTpCYXNlRW50aXR5U2VydmljZS51cHNlcnQnLFxuICAgICAgb3BlcmF0aW9uOiAnRW50aXR5IHVwc2VydGVkJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMjAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgZ3JhbmRwYXJlbnRTcGFuLCBwYXJlbnRTcGFuLCBjaGlsZExvZyBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFsgJ2Z3MjQuaG90cGF0aHMnIF0sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmZvbGRfZW50aXR5X2xvZ3MnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIG9wZXJhdGlvbjogJ0VudGl0eSB1cHNlcnRlZCcgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgICAgICByZWFzb246ICdGb2xkIGVudGl0eSBvcGVyYXRpb24gbG9ncydcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gUGFyZW50IHNwYW4gc2hvdWxkIGJlIGFnZ3JlZ2F0ZWQgKG5vdCBrZXB0KSBldmVuIHRob3VnaCBjaGlsZCB3YXMgcHJvY2Vzc2VkXG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIEdyYW5kcGFyZW50IHNob3VsZCBiZSBrZXB0IGFuZCBoYXZlIGFnZ3JlZ2F0aW9uIHN1bW1hcnlcbiAgICBjb25zdCBncmFuZHBhcmVudCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdncmFuZHBhcmVudCcpO1xuICAgIGV4cGVjdChncmFuZHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZ3JhbmRwYXJlbnQ/LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCdub2lzZVJlZHVjdGlvbicpO1xuICAgIC8vIFN0YXRzIHNob3VsZCBzaG93IGFnZ3JlZ2F0aW9uXG4gICAgZXhwZWN0KHN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmVHcmVhdGVyVGhhbigwKTtcbiAgfSk7XG5cbiAgdGVzdCgnZG9lcyBub3QgZm9yY2Uta2VlcCBwYXJlbnQgd2l0aCBmb2xkIGRlY2lzaW9uIGV2ZW4gd2hlbiBjaGlsZHJlbiBhcmUgZm9sZGVkIGludG8gaXQnLCAoKSA9PiB7XG4gICAgY29uc3QgZ3JhbmRwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdncmFuZHBhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnV29ya2Zsb3dDb250cm9sbGVyLnByb2Nlc3MnLFxuICAgICAgb3BlcmF0aW9uOiAnd29ya2Zsb3cuYmF0Y2gnLFxuICAgICAgdGltZXN0YW1wTXM6IDUwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogMTAwXG4gICAgfTtcblxuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnU29tZVNlcnZpY2UucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICdwcm9jZXNzLnJlY29yZCcsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogNTAsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdncmFuZHBhcmVudCdcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRMb2c6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkLWxvZycsXG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBzb3VyY2U6ICdTb21lU2VydmljZS5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ1JlY29yZCBwcm9jZXNzZWQnLFxuICAgICAgdGltZXN0YW1wTXM6IDEyMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCdcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBncmFuZHBhcmVudFNwYW4sIHBhcmVudFNwYW4sIGNoaWxkTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogW10sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmZvbGRfcmVjb3JkX3NwYW5zJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgb3BlcmF0aW9uOiAncHJvY2Vzcy5yZWNvcmQnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgICAgcmVhc29uOiAnRm9sZCByZWNvcmQgcHJvY2Vzc2luZyBzcGFucydcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5mb2xkX2NoaWxkX2xvZ3MnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIG9wZXJhdGlvbjogJ1JlY29yZCBwcm9jZXNzZWQnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgICAgcmVhc29uOiAnRm9sZCBjb21wbGV0aW9uIGxvZ3MnXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFBhcmVudCBzcGFuIHNob3VsZCBiZSBmb2xkZWQgKG5vdCBrZXB0KSBldmVuIHRob3VnaCBpdCBoYWQgYSBjaGlsZCBmb2xkZWQgaW50byBpdFxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAvLyBDaGlsZCBsb2cgc2hvdWxkIGFsc28gYmUgZm9sZGVkXG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZC1sb2cnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIEdyYW5kcGFyZW50IHNob3VsZCBiZSBrZXB0IGFuZCBoYXZlIGZvbGQgY2hlY2twb2ludHNcbiAgICBjb25zdCBncmFuZHBhcmVudCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdncmFuZHBhcmVudCcpO1xuICAgIGV4cGVjdChncmFuZHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoKGdyYW5kcGFyZW50Py5kYXRhIGFzIGFueSk/LmNoZWNrcG9pbnRzKS50b0JlRGVmaW5lZCgpO1xuICAgIC8vIFN0YXRzIHNob3VsZCBzaG93IGZvbGRpbmdcbiAgICBleHBlY3Qoc3RhdHMuZm9sZGVkKS50b0JlKDIpOyAvLyBib3RoIHBhcmVudCBhbmQgY2hpbGQgZm9sZGVkXG4gIH0pO1xuXG4gIHRlc3QoJ21hdGNoZXMgc3VjY2VzcyBmaWVsZCBjb3JyZWN0bHknLCAoKSA9PiB7XG4gICAgY29uc3Qgc3VjY2Vzc1NwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3N1Y2Nlc3MtMScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIHN1Y2Nlc3M6IHRydWVcbiAgICB9O1xuXG4gICAgY29uc3QgZmFpbFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2ZhaWwtMScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgLy8gRXhwbGljaXRseSBhbGxvdyBkcm9wcGluZyB0aGlzIGZhaWx1cmUgKG92ZXJyaWRlIGhhcmQgc2lnbmFsIHByb3RlY3Rpb24pXG4gICAgICBjYXB0dXJlOiB7IG5vaXNlOiB7IGRlY2lzaW9uOiAnZHJvcCcsIHJlYXNvbjogJ3Rlc3Qgb3ZlcnJpZGUnIH0gfVxuICAgIH07XG5cbiAgICBjb25zdCBub1N1Y2Nlc3NTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICduby1zdWNjZXNzLTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCdcbiAgICB9O1xuXG4gICAgLy8gUnVsZSBtYXRjaGluZyBzdWNjZXNzOiB0cnVlIHNob3VsZCBvbmx5IG1hdGNoIHN1Y2Nlc3NTcGFuXG4gICAgY29uc3Qgc3VjY2Vzc1J1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgIGlkOiAndGVzdC5zdWNjZXNzJyxcbiAgICAgIG1hdGNoOiB7IHN1Y2Nlc3M6IHRydWUgfSxcbiAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICByZWFzb246ICd0ZXN0J1xuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQxID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHN1Y2Nlc3NTcGFuLCBmYWlsU3Bhbiwgbm9TdWNjZXNzU3BhbiBdLCB7IC4uLmJhc2VOb2lzZSwgZW5hYmxlZDogdHJ1ZSwgcnVsZXM6IFsgc3VjY2Vzc1J1bGUgXSB9KTtcbiAgICBleHBlY3QocmVzdWx0MS5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3N1Y2Nlc3MtMScpKS50b0JlVW5kZWZpbmVkKCk7IC8vIGRyb3BwZWRcbiAgICBleHBlY3QocmVzdWx0MS5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2ZhaWwtMScpKS50b0JlVW5kZWZpbmVkKCk7IC8vIGRyb3BwZWQgKHZpYSBvdmVycmlkZSlcbiAgICBleHBlY3QocmVzdWx0MS5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ25vLXN1Y2Nlc3MtMScpKS50b0JlRGVmaW5lZCgpOyAvLyBrZXB0XG5cbiAgICAvLyBSdWxlIG1hdGNoaW5nIHN1Y2Nlc3M6IGZhbHNlIHNob3VsZCBvbmx5IG1hdGNoIGZhaWxTcGFuXG4gICAgY29uc3QgZmFpbFJ1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgIGlkOiAndGVzdC5mYWlsJyxcbiAgICAgIG1hdGNoOiB7IHN1Y2Nlc3M6IGZhbHNlIH0sXG4gICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgcmVhc29uOiAndGVzdCdcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0MiA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBzdWNjZXNzU3BhbiwgZmFpbFNwYW4sIG5vU3VjY2Vzc1NwYW4gXSwgeyAuLi5iYXNlTm9pc2UsIGVuYWJsZWQ6IHRydWUsIHJ1bGVzOiBbIGZhaWxSdWxlIF0gfSk7XG4gICAgZXhwZWN0KHJlc3VsdDIuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdWNjZXNzLTEnKSkudG9CZURlZmluZWQoKTsgLy8ga2VwdFxuICAgIGV4cGVjdChyZXN1bHQyLmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZmFpbC0xJykpLnRvQmVVbmRlZmluZWQoKTsgLy8gZHJvcHBlZCAobWF0Y2hlZCArIG92ZXJyaWRlKVxuICAgIGV4cGVjdChyZXN1bHQyLmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbm8tc3VjY2Vzcy0xJykpLnRvQmVEZWZpbmVkKCk7IC8vIGtlcHRcbiAgfSk7XG5cbiAgdGVzdCgnbWF0Y2hlcyBtYXhEdXJhdGlvbk1zIGNvcnJlY3RseSAodXBwZXIgYm91bmQpJywgKCkgPT4ge1xuICAgIGNvbnN0IGZhc3RTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXN0LTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiAzMFxuICAgIH07XG5cbiAgICBjb25zdCBtZWRpdW1TcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdtZWRpdW0tMScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwIC8vIGV4YWN0bHkgYXQgdGhyZXNob2xkIC0gc2hvdWxkIE5PVCBtYXRjaCAoPCA1MClcbiAgICB9O1xuXG4gICAgY29uc3Qgc2xvd1NwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3ctMScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMFxuICAgIH07XG5cbiAgICAvLyBNYXRjaCBzcGFucyB1bmRlciA1MG1zXG4gICAgY29uc3QgcnVsZTogTm9pc2VSdWxlID0ge1xuICAgICAgaWQ6ICd0ZXN0LmZhc3QnLFxuICAgICAgbWF0Y2g6IHsgbWF4RHVyYXRpb25NczogNTAgfSxcbiAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICByZWFzb246ICd0ZXN0J1xuICAgIH07XG5cbiAgICBjb25zdCByZXN1bHQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgZmFzdFNwYW4sIG1lZGl1bVNwYW4sIHNsb3dTcGFuIF0sIHsgLi4uYmFzZU5vaXNlLCBlbmFibGVkOiB0cnVlLCBydWxlczogWyBydWxlIF0gfSk7XG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Zhc3QtMScpKS50b0JlVW5kZWZpbmVkKCk7IC8vIGRyb3BwZWQgKDMwIDwgNTApXG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ21lZGl1bS0xJykpLnRvQmVEZWZpbmVkKCk7IC8vIGtlcHQgKDUwID49IDUwKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzbG93LTEnKSkudG9CZURlZmluZWQoKTsgLy8ga2VwdCAoMTAwID49IDUwKVxuICB9KTtcblxuICB0ZXN0KCdtYXRjaGVzIGR1cmF0aW9uIHJhbmdlIGNvcnJlY3RseSAoZHVyYXRpb25NcyArIG1heER1cmF0aW9uTXMpJywgKCkgPT4ge1xuICAgIGNvbnN0IHRvb0Zhc3Q6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rvby1mYXN0JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0Lm9wZXJhdGlvbicsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogNVxuICAgIH07XG5cbiAgICBjb25zdCBpblJhbmdlOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdpbi1yYW5nZScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwXG4gICAgfTtcblxuICAgIGNvbnN0IHRvb1Nsb3c6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Rvby1zbG93JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0Lm9wZXJhdGlvbicsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogMTUwXG4gICAgfTtcblxuICAgIC8vIE1hdGNoIHNwYW5zIGJldHdlZW4gMTBtcyBhbmQgMTAwbXMgKGluY2x1c2l2ZSBsb3dlciwgZXhjbHVzaXZlIHVwcGVyKVxuICAgIGNvbnN0IHJ1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgIGlkOiAndGVzdC5yYW5nZScsXG4gICAgICBtYXRjaDogeyBtaW5EdXJhdGlvbk1zOiAxMCwgbWF4RHVyYXRpb25NczogMTAwIH0sXG4gICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgcmVhc29uOiAndGVzdCdcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIHRvb0Zhc3QsIGluUmFuZ2UsIHRvb1Nsb3cgXSwgeyAuLi5iYXNlTm9pc2UsIGVuYWJsZWQ6IHRydWUsIHJ1bGVzOiBbIHJ1bGUgXSB9KTtcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAndG9vLWZhc3QnKSkudG9CZURlZmluZWQoKTsgLy8ga2VwdCAoNSA8IDEwKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdpbi1yYW5nZScpKS50b0JlVW5kZWZpbmVkKCk7IC8vIGRyb3BwZWQgKDEwIDw9IDUwIDwgMTAwKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICd0b28tc2xvdycpKS50b0JlRGVmaW5lZCgpOyAvLyBrZXB0ICgxNTAgPj0gMTAwKVxuICB9KTtcblxuICB0ZXN0KCdkcm9wcyBzdWNjZXNzZnVsIGZhc3QgR0VUIHJlcXVlc3RzIChmdzI0LmhvdHBhdGhzIHByZXNldCknLCAoKSA9PiB7XG4gICAgY29uc3QgZmFzdEdldFN1Y2Nlc3M6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Zhc3QtZ2V0LTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICBvcGVyYXRpb246ICdHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogOFxuICAgIH07XG5cbiAgICBjb25zdCBzbG93R2V0U3VjY2VzczogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc2xvdy1nZXQtMScsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnQWRtaW5EeW5hbWljRW50aXR5Q29udHJvbGxlci5saXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0dFVCAvYWRtaW4vZW50aXR5L29ic2VydmFiaWxpdHlsb2cnLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICBkdXJhdGlvbk1zOiAxNTAwXG4gICAgfTtcblxuICAgIGNvbnN0IGZhc3RHZXRGYWlsOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXN0LWdldC1mYWlsJyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgc291cmNlOiAnQWRtaW5EeW5hbWljRW50aXR5Q29udHJvbGxlci5saXN0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0dFVCAvYWRtaW4vZW50aXR5L29ic2VydmFiaWxpdHlsb2cnLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZHVyYXRpb25NczogOCxcbiAgICAgIGVycm9yOiB7IHR5cGU6ICdOb3RGb3VuZEVycm9yJywgbWVzc2FnZTogJ05vdCBmb3VuZCcgfVxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIGZhc3RHZXRTdWNjZXNzLCBzbG93R2V0U3VjY2VzcywgZmFzdEdldEZhaWwgXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgICBydWxlczogW11cbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gRmFzdCBzdWNjZXNzZnVsIEdFVCBzaG91bGQgYmUgZHJvcHBlZFxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZmFzdC1nZXQtMScpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gU2xvdyBzdWNjZXNzZnVsIEdFVCBzaG91bGQgYmUgZG93bmdyYWRlZCAoa2VwdCBidXQgc3RyaXBwZWQpXG4gICAgY29uc3Qgc2xvd0dldCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzbG93LWdldC0xJyk7XG4gICAgZXhwZWN0KHNsb3dHZXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgLy8gRmFpbGVkIEdFVCBzaG91bGQgYmUga2VwdCAoaGFyZCBzaWduYWwgcHJvdGVjdGlvbilcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Zhc3QtZ2V0LWZhaWwnKSkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgxKTtcbiAgfSk7XG5cbiAgdGVzdCgnZm9yY2Uta2VlcHMgcGFyZW50IHdpdGgga2VlcC9kb3duZ3JhZGUgZGVjaXNpb24gd2hlbiBjaGlsZHJlbiBhcmUgZm9sZGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnSW1wb3J0YW50U2VydmljZS5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ2ltcG9ydGFudC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC1sb2cnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnSW1wb3J0YW50U2VydmljZS5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ1Byb2Nlc3NpbmcgZG9uZScsXG4gICAgICB0aW1lc3RhbXBNczogMTIwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50J1xuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogW10sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmZvbGRfY2hpbGRfbG9ncycsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJywgb3BlcmF0aW9uOiAnUHJvY2Vzc2luZyBkb25lJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgY29tcGxldGlvbiBsb2dzJ1xuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBQYXJlbnQgc3BhbiBzaG91bGQgYmUga2VwdCB0byBwcmVzZXJ2ZSBmb2xkIHN1bW1hcnlcbiAgICAvLyAoSXQncyBrZXB0IG5hdHVyYWxseSBieSBpdHMgJ2tlZXAnIGRlY2lzaW9uLCBub3QgZm9yY2Uta2VwdClcbiAgICBjb25zdCBwYXJlbnQgPSBldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50Jyk7XG4gICAgZXhwZWN0KHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICAvLyBDaGlsZCBzaG91bGQgYmUgZm9sZGVkIGludG8gcGFyZW50XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZC1sb2cnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMSk7XG4gICAgLy8gUGFyZW50IHNob3VsZCBoYXZlIGZvbGQgY2hlY2twb2ludCBmcm9tIGNoaWxkXG4gICAgZXhwZWN0KChwYXJlbnQ/LmRhdGEgYXMgYW55KT8uY2hlY2twb2ludHMpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KChwYXJlbnQ/LmRhdGEgYXMgYW55KT8uY2hlY2twb2ludHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW4oMCk7XG4gIH0pO1xufSk7XG5cblxuIl19