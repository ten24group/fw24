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
            operation: 'processRecord',
            source: 'BatchProcessor.processRecord',
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
            operation: 'processRecord',
            source: 'BatchProcessor.processRecord',
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
            operation: 'processRecord',
            source: 'BatchProcessor.processRecord',
            capture: { backends: ['otel'] },
        };
        const childSpan = {
            type: 'span',
            level: 'info',
            correlationId: 'c1',
            timestampMs: 2,
            observabilityLogId: 'child',
            parentObservabilityLogId: 'parent',
            operation: 'processRecord',
            source: 'BatchProcessor.processRecord',
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
        expect(data.checkpoints.some((cp) => cp.name?.startsWith('metrics.folded:'))).toBe(true);
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
    test('drops parent span when children are folded into it but no hard signals (aggressive noise reduction)', () => {
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
            rules: [],
        });
        // CORRECT BEHAVIOR: Parent span is DROPPED because absorbed data is only NOISE
        // Rationale: Child was folded (just noise), no hard signals → entire tree can be dropped
        // This maximizes noise reduction while preserving hard signal data
        const keptParent = events.find(e => e.observabilityLogId === 'sns-parent');
        expect(keptParent).toBeUndefined();
        // Child log should also be dropped (folded then parent dropped)
        expect(events.find(e => e.observabilityLogId === 'child-log')).toBeUndefined();
        // Entire tree pruned - no hard signals
        expect(events.length).toBe(0);
        expect(stats.folded).toBe(1); // Child was folded
        expect(stats.dropped).toBe(1); // Parent was dropped
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
        // VERIFY: Parent span should be aggregated (not kept)
        expect(events.find(e => e.observabilityLogId === 'parent')).toBeUndefined();
        // VERIFY: Grandparent is kept with aggregation summary
        const grandparent = events.find(e => e.observabilityLogId === 'grandparent');
        expect(grandparent).toBeDefined();
        expect(grandparent?.operation).toBe('workflow.batch');
        expect(grandparent?.source).toBe('WorkflowController.process');
        const noiseReduction = grandparent?.data?.noiseReduction;
        expect(noiseReduction).toBeDefined();
        expect(noiseReduction.aggregates).toBeDefined();
        // VERIFY: Exact stats
        expect(stats.aggregated).toBe(1); // 1 parent span aggregated
        expect(stats.folded).toBe(1); // 1 child log folded
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
        // VERIFY: Failed GET is kept (hard signal protection)
        const failedGet = events.find(e => e.observabilityLogId === 'fast-get-fail');
        expect(failedGet).toBeDefined();
        expect(failedGet?.success).toBe(false);
        expect(failedGet?.level).toBe('error');
        // VERIFY: Exact stats
        expect(stats.dropped).toBe(1); // 1 fast successful GET dropped
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
        // VERIFY: Parent has fold checkpoint from child
        const checkpoints = parent?.data?.checkpoints;
        expect(checkpoints).toBeDefined();
        expect(Array.isArray(checkpoints)).toBe(true);
        expect(checkpoints.length).toBeGreaterThanOrEqual(1); // At least 1 fold checkpoint
        // VERIFY: Contains fold checkpoint with correct structure
        const foldCheckpoint = checkpoints.find((cp) => cp.name?.includes('folded') || cp.name?.includes('fold'));
        expect(foldCheckpoint).toBeDefined();
        expect(foldCheckpoint.ts).toBeDefined();
        expect(typeof foldCheckpoint.ts).toBe('number');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9pc2UtcmVkdWN0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vbm9pc2UtcmVkdWN0aW9uLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBOEM7QUFFOUMsc0NBQXNEO0FBRXRELFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUU7SUFDL0IsTUFBTSxTQUFTLEdBQUcsSUFBQSxrQ0FBeUIsR0FBRSxDQUFDLGNBQWMsQ0FBQztJQUU3RCxFQUFFLENBQUMsc0VBQXNFLEVBQUUsR0FBRyxFQUFFO1FBQzlFLE1BQU0sVUFBVSxHQUF1QjtZQUNyQyxJQUFJLEVBQUUsTUFBTTtZQUNaLEtBQUssRUFBRSxNQUFNO1lBQ2IsYUFBYSxFQUFFLElBQUk7WUFDbkIsV0FBVyxFQUFFLENBQUM7WUFDZCxrQkFBa0IsRUFBRSxRQUFRO1lBQzVCLFNBQVMsRUFBRSxRQUFRO1lBQ25CLFVBQVUsRUFBRSxFQUFFO1NBQ2YsQ0FBQztRQUVGLE1BQU0sY0FBYyxHQUF1QjtZQUN6QyxJQUFJLEVBQUUsWUFBWTtZQUNsQixLQUFLLEVBQUUsTUFBTTtZQUNiLGFBQWEsRUFBRSxJQUFJO1lBQ25CLFdBQVcsRUFBRSxDQUFDO1lBQ2Qsa0JBQWtCLEVBQUUsT0FBTztZQUMzQix3QkFBd0IsRUFBRSxRQUFRO1lBQ2xDLFNBQVMsRUFBRSxlQUFlO1lBQzFCLE1BQU0sRUFBRSw4QkFBOEI7WUFDdEMsT0FBTyxFQUFFLEVBQUUsUUFBUSxFQUFFLENBQUUsTUFBTSxDQUFFLEVBQUU7WUFDakMsVUFBVSxFQUFFLFNBQVM7U0FDdEIsQ0FBQztRQUVGLE1BQU0sU0FBUyxHQUF1QjtZQUNwQyxJQUFJLEVBQUUsTUFBTTtZQUNaLEtBQUssRUFBRSxNQUFNO1lBQ2IsYUFBYSxFQUFFLElBQUk7WUFDbkIsV0FBVyxFQUFFLENBQUM7WUFDZCxrQkFBa0IsRUFBRSxP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QyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7UUFDL0csTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDeEMsTUFBTSxDQUFDLE9BQU8sY0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUNsRCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4vaW5kZXgnO1xuaW1wb3J0IHR5cGUgeyBOb2lzZVJ1bGUsIE9ic2VydmFiaWxpdHlFdmVudCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcgfSBmcm9tICcuLi9jb25maWcnO1xuXG5kZXNjcmliZSgnbm9pc2UgcmVkdWN0aW9uJywgKCkgPT4ge1xuICBjb25zdCBiYXNlTm9pc2UgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKCkubm9pc2VSZWR1Y3Rpb247XG5cbiAgaXQoJ2Ryb3BzIHNwYW4uc3RhcnQgd2hlbiB0aGUgY29ycmVzcG9uZGluZyBjb25zb2xpZGF0ZWQgc3BhbiBpcyBkcm9wcGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAncGFyZW50JyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZFNwYW5TdGFydDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4uc3RhcnQnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMixcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2NoaWxkJyxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICBvcGVyYXRpb246ICdwcm9jZXNzUmVjb3JkJyxcbiAgICAgIHNvdXJjZTogJ0JhdGNoUHJvY2Vzc29yLnByb2Nlc3NSZWNvcmQnLFxuICAgICAgY2FwdHVyZTogeyBiYWNrZW5kczogWyAnb3RlbCcgXSB9LFxuICAgICAgZHVyYXRpb25NczogdW5kZWZpbmVkLFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDIsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzc1JlY29yZCcsXG4gICAgICBzb3VyY2U6ICdCYXRjaFByb2Nlc3Nvci5wcm9jZXNzUmVjb3JkJyxcbiAgICAgIGR1cmF0aW9uTXM6IDEsXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBwYXJlbnRTcGFuLCBjaGlsZFNwYW5TdGFydCwgY2hpbGRTcGFuIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5iYXRjaF9wcm9jZXNzb3JzJyBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnY2hpbGQnICYmIGUudHlwZSA9PT0gJ3NwYW4nKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZCcgJiYgZS50eXBlID09PSAnc3Bhbi5zdGFydCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudCcgJiYgZS50eXBlID09PSAnc3BhbicpKS50b0JlRGVmaW5lZCgpO1xuICB9KTtcblxuICBpdCgnZHJvcHMgc3RyZWFtIHByb2Nlc3NvciBiYXRjaCBzcGFucyAocm9vdCBzcGFucyBhcmUgbm9pc3ksIGF1ZGl0LmVudGl0eSBrZXB0IHNlcGFyYXRlbHkpJywgKCkgPT4ge1xuICAgIGNvbnN0IGF1ZGl0QmF0Y2hTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnYXVkaXQtYmF0Y2gnLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlci5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ2F3czpzcXMgRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlcicsXG4gICAgICBkdXJhdGlvbk1zOiAxLFxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcbiAgICB9O1xuXG4gICAgY29uc3Qgc25zQmF0Y2hTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc25zLWJhdGNoJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICdhd3M6ZHluYW1vZGIgRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvcicsXG4gICAgICBkdXJhdGlvbk1zOiAyMCxcbiAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXG4gICAgfTtcblxuICAgIGNvbnN0IGF1ZGl0RW50aXR5OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnYXVkaXQuZW50aXR5JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdhdWRpdC1lbnRpdHknLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlci5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ3VzZXIudXBkYXRlJyxcbiAgICAgIGVudGl0eU5hbWU6ICd1c2VyJyxcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIGF1ZGl0QmF0Y2hTcGFuLCBzbnNCYXRjaFNwYW4sIGF1ZGl0RW50aXR5IF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gQmF0Y2ggc3BhbnMgc2hvdWxkIGJlIGRyb3BwZWRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnYXVkaXQtYmF0Y2gnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzbnMtYmF0Y2gnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIGF1ZGl0LmVudGl0eSBzaG91bGQgYmUga2VwdFxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdhdWRpdC1lbnRpdHknKSkudG9CZURlZmluZWQoKTtcbiAgfSk7XG5cbiAgaXQoJ2FnZ3JlZ2F0ZXMgcGVyLXJlY29yZCBzcGFucyBpbnRvIHBhcmVudCBzcGFuIGluc3RlYWQgb2YgZW1pdHRpbmcgdGhlbScsICgpID0+IHtcbiAgICBjb25zdCBwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ3BhcmVudCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMCxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRTcGFuU3RhcnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuLnN0YXJ0JyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDIsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzc1JlY29yZCcsXG4gICAgICBzb3VyY2U6ICdCYXRjaFByb2Nlc3Nvci5wcm9jZXNzUmVjb3JkJyxcbiAgICAgIGNhcHR1cmU6IHsgYmFja2VuZHM6IFsgJ290ZWwnIF0gfSxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ3Byb2Nlc3NSZWNvcmQnLFxuICAgICAgc291cmNlOiAnQmF0Y2hQcm9jZXNzb3IucHJvY2Vzc1JlY29yZCcsXG4gICAgICBkdXJhdGlvbk1zOiAzLFxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgcGFyZW50U3BhbiwgY2hpbGRTcGFuU3RhcnQsIGNoaWxkU3BhbiBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFsgJ2Z3MjQuYmF0Y2hfcHJvY2Vzc29ycycgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gYm90aCBjaGlsZCBzcGFuIGFuZCBpdHMgc3Bhbi5zdGFydCBzaG91bGQgYmUgcmVtb3ZlZFxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZCcpKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBwYXJlbnQgPSBldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQnICYmIGUudHlwZSA9PT0gJ3NwYW4nKSE7XG4gICAgY29uc3QgZGF0YSA9IHBhcmVudC5kYXRhIGFzIGFueTtcbiAgICBleHBlY3QoZGF0YT8ubm9pc2VSZWR1Y3Rpb24/LmFnZ3JlZ2F0ZXMpLnRvQmVUcnV0aHkoKTtcbiAgICAvLyBJbmNsdWRlcyByaWNoZXIgYWdncmVnYXRlIHBheWxvYWRzIChleGFtcGxlcyArIHJ1bGUgaWRzKSBieSBkZWZhdWx0XG4gICAgY29uc3QgZmlyc3RLZXkgPSBPYmplY3Qua2V5cyhkYXRhLm5vaXNlUmVkdWN0aW9uLmFnZ3JlZ2F0ZXMpWyAwIF07XG4gICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoZGF0YS5ub2lzZVJlZHVjdGlvbi5hZ2dyZWdhdGVzWyBmaXJzdEtleSBdPy5leGFtcGxlcykpLnRvQmUodHJ1ZSk7XG4gIH0pO1xuXG4gIGl0KCdib3VuZHMgZm9sZGVkIGNoZWNrcG9pbnRzIHRvIGF2b2lkIHJ1bmF3YXkgZ3Jvd3RoJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAncGFyZW50JyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgIH07XG5cbiAgICBjb25zdCBsb2dzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDIwIH0pLm1hcCgoXywgaSkgPT4gKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMiArIGksXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGBsJHtpfWAsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgb3BlcmF0aW9uOiAnUHVibGlzaCBTTlMgZG9uZScsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yLnByb2Nlc3MnLFxuICAgIH0pKTtcblxuICAgIGNvbnN0IHsgZXZlbnRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBwYXJlbnRTcGFuLCAuLi5sb2dzIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgICAgbWF4Q2hlY2twb2ludHNQZXJTcGFuOiA1LFxuICAgICAgfVxuICAgICk7XG5cbiAgICBjb25zdCBwYXJlbnQgPSBldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdwYXJlbnQnICYmIGUudHlwZSA9PT0gJ3NwYW4nKSE7XG4gICAgY29uc3QgZGF0YSA9IHBhcmVudC5kYXRhIGFzIGFueTtcbiAgICBleHBlY3QoQXJyYXkuaXNBcnJheShkYXRhPy5jaGVja3BvaW50cykpLnRvQmUodHJ1ZSk7XG4gICAgZXhwZWN0KChkYXRhLmNoZWNrcG9pbnRzIGFzIGFueVtdKS5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoNik7IC8vIGluY2x1ZGVzIHBvc3NpYmxlIHRydW5jYXRpb24gbWFya2VyXG4gIH0pO1xuXG4gIGl0KCdtYXRjaGVzIGR1cmF0aW9uTXMgYXMgbWluaW11bSB0aHJlc2hvbGQgKD49KScsICgpID0+IHtcbiAgICBjb25zdCBmYXN0U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMSxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2Zhc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnZmFzdC1vcCcsXG4gICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICB9O1xuXG4gICAgY29uc3Qgc2xvd1NwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDIsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93JyxcbiAgICAgIG9wZXJhdGlvbjogJ3Nsb3ctb3AnLFxuICAgICAgZHVyYXRpb25NczogMTUwLFxuICAgIH07XG5cbiAgICBjb25zdCBleGFjdFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDMsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdleGFjdCcsXG4gICAgICBvcGVyYXRpb246ICdleGFjdC1vcCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgfTtcblxuICAgIC8vIFJ1bGU6IGRyb3Agc3BhbnMgd2l0aCBkdXJhdGlvbiA+PSAxMDBtc1xuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgZmFzdFNwYW4sIHNsb3dTcGFuLCBleGFjdFNwYW4gXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5kcm9wX3Nsb3cnLFxuICAgICAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nLCBtaW5EdXJhdGlvbk1zOiAxMDAgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIHNsb3cgc3BhbnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEZhc3Qgc3BhbiBzaG91bGQgYmUga2VwdCAoNTBtcyA8IDEwMG1zIHRocmVzaG9sZClcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZmFzdCcpKS50b0JlRGVmaW5lZCgpO1xuICAgIC8vIFNsb3cgc3BhbiBzaG91bGQgYmUgZHJvcHBlZCAoMTUwbXMgPj0gMTAwbXMgdGhyZXNob2xkKVxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzbG93JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAvLyBFeGFjdCBzcGFuIHNob3VsZCBiZSBkcm9wcGVkICgxMDBtcyA+PSAxMDBtcyB0aHJlc2hvbGQpXG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2V4YWN0JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgyKTtcbiAgICBleHBlY3Qoc3RhdHMua2VwdCkudG9CZSgxKTtcbiAgfSk7XG5cbiAgaXQoJ2ZvbGRzIGxvZ3MgaW50byBwYXJlbnQgc3BhbiBhcyBjaGVja3BvaW50cycsICgpID0+IHtcbiAgICBjb25zdCBwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIG9wZXJhdGlvbjogJ3BhcmVudC1vcCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMDAsXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICB0eXBlOiAnbG9nJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDIsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC1sb2cnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50JyxcbiAgICAgIHNvdXJjZTogJ1Rlc3RTZXJ2aWNlLnByb2Nlc3MnLFxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZm9sZF9sb2dzJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBzb3VyY2U6ICdUZXN0U2VydmljZS5wcm9jZXNzJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgcHJvY2Vzc2luZyBsb2dzJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBDaGlsZCBsb2cgc2hvdWxkIGJlIGZvbGRlZCAocmVtb3ZlZCBmcm9tIG91dHB1dClcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnY2hpbGQtbG9nJykpLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIC8vIFBhcmVudCBzaG91bGQgaGF2ZSBjaGVja3BvaW50IGZvciBmb2xkZWQgbG9nXG4gICAgY29uc3QgcGFyZW50ID0gZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50JykhO1xuICAgIGNvbnN0IGRhdGEgPSBwYXJlbnQuZGF0YSBhcyBhbnk7XG4gICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoZGF0YT8uY2hlY2twb2ludHMpKS50b0JlKHRydWUpO1xuICAgIGV4cGVjdChkYXRhLmNoZWNrcG9pbnRzLnNvbWUoKGNwOiBhbnkpID0+IGNwLm5hbWU/LnN0YXJ0c1dpdGgoJ21ldHJpY3MuZm9sZGVkOicpKSkudG9CZSh0cnVlKTtcblxuICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG4gIH0pO1xuXG4gIGl0KCduZXZlciBkcm9wcyBlcnJvciBldmVudHMgKGhhcmQgc2lnbmFsIHByb3RlY3Rpb24pJywgKCkgPT4ge1xuICAgIGNvbnN0IGVycm9yU3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdlcnJvci1zcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ2ZhaWxpbmctb3AnLFxuICAgICAgZHVyYXRpb25NczogMTAsXG4gICAgICBlcnJvcjogeyB0eXBlOiAnRXJyb3InLCBtZXNzYWdlOiAnU29tZXRoaW5nIGZhaWxlZCcgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgZmFpbGVkU3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMixcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ2ZhaWxlZC1zcGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ2Fub3RoZXItb3AnLFxuICAgICAgZHVyYXRpb25NczogMTAsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICB9O1xuXG4gICAgLy8gUnVsZTogZHJvcCBhbGwgc3BhbnMgKGJ1dCBlcnJvcnMgc2hvdWxkIGJlIHByb3RlY3RlZClcbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIGVycm9yU3BhbiwgZmFpbGVkU3BhbiBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmRyb3BfYWxsJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0Ryb3AgYWxsIHNwYW5zJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBCb3RoIGVycm9yIHNpZ25hbHMgc2hvdWxkIGJlIGtlcHQgZGVzcGl0ZSBkcm9wIHJ1bGVcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZXJyb3Itc3BhbicpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdmYWlsZWQtc3BhbicpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5rZXB0KS50b0JlKDIpO1xuICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDApO1xuICB9KTtcblxuICBpdCgnbWF0Y2hlcyB0YWdzIGNvcnJlY3RseScsICgpID0+IHtcbiAgICBjb25zdCBtYXRjaGluZ1NwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBjb3JyZWxhdGlvbklkOiAnYzEnLFxuICAgICAgdGltZXN0YW1wTXM6IDEsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdtYXRjaGluZycsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0LW9wJyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgICAgdGFnczogeyBwcm9jZXNzb3I6ICdhdWRpdCcsIGVudGl0eTogJ3VzZXInIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IG5vbk1hdGNoaW5nU3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMixcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ25vbi1tYXRjaGluZycsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0LW9wJyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwLFxuICAgICAgdGFnczogeyBwcm9jZXNzb3I6ICdzbnMnLCBlbnRpdHk6ICdwb3N0JyB9LFxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIG1hdGNoaW5nU3Bhbiwgbm9uTWF0Y2hpbmdTcGFuIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZHJvcF9hdWRpdF91c2VyJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgdGFnczogeyBwcm9jZXNzb3I6ICdhdWRpdCcsIGVudGl0eTogJ3VzZXInIH0gfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIGF1ZGl0IHVzZXIgc3BhbnMnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIE1hdGNoaW5nIHNwYW4gc2hvdWxkIGJlIGRyb3BwZWRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnbWF0Y2hpbmcnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIE5vbi1tYXRjaGluZyBzcGFuIHNob3VsZCBiZSBrZXB0XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ25vbi1tYXRjaGluZycpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDEpO1xuICAgIGV4cGVjdChzdGF0cy5rZXB0KS50b0JlKDEpO1xuICB9KTtcblxuICBpdCgnbWF0Y2hlcyByZWdleCBwYXR0ZXJucyBpbiBzb3VyY2UgYW5kIG9wZXJhdGlvbicsICgpID0+IHtcbiAgICBjb25zdCBtYXRjaGluZ0xvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWF0Y2hpbmcnLFxuICAgICAgb3BlcmF0aW9uOiAnUHVibGlzaCBTTlMgZG9uZScsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yLnByb2Nlc3MnLFxuICAgIH07XG5cbiAgICBjb25zdCBub25NYXRjaGluZ0xvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAyLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbm9uLW1hdGNoaW5nJyxcbiAgICAgIG9wZXJhdGlvbjogJ1Byb2Nlc3NpbmcgaXRlbScsXG4gICAgICBzb3VyY2U6ICdNeVNlcnZpY2UucHJvY2VzcycsXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgbWF0Y2hpbmdMb2csIG5vbk1hdGNoaW5nTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZHJvcF9zbnNfcHVibGlzaCcsXG4gICAgICAgICAgICBwcmlvcml0eTogMTAwLCAvLyBIaWdoZXIgdGhhbiBidWlsdGluIGZvbGQgcnVsZSAoNDApXG4gICAgICAgICAgICBtYXRjaDoge1xuICAgICAgICAgICAgICB0eXBlOiAnbG9nJyxcbiAgICAgICAgICAgICAgc291cmNlOiAnL15EeW5hbW9EQlN0cmVhbS4qUHJvY2Vzc29yXFxcXC5wcm9jZXNzJC8nLFxuICAgICAgICAgICAgICBvcGVyYXRpb246ICcvUHVibGlzaC4qZG9uZS8nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgICAgICByZWFzb246ICdEcm9wIFNOUyBwdWJsaXNoIGNvbXBsZXRpb24gbG9ncycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gTWF0Y2hpbmcgbG9nIHNob3VsZCBiZSBkcm9wcGVkXG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ21hdGNoaW5nJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAvLyBOb24tbWF0Y2hpbmcgbG9nIHNob3VsZCBiZSBrZXB0XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ25vbi1tYXRjaGluZycpKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDEpO1xuICAgIGV4cGVjdChzdGF0cy5rZXB0KS50b0JlKDEpO1xuICB9KTtcblxuICBpdCgnZG93bmdyYWRlcyBldmVudHMgYnkgc3RyaXBwaW5nIGhlYXZ5IGZpZWxkcycsICgpID0+IHtcbiAgICBjb25zdCBoZWF2eUxvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaGVhdnknLFxuICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzc2luZycsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGxhcmdlUGF5bG9hZDogQXJyYXkoMTAwMCkuZmlsbCgneCcpLmpvaW4oJycpLFxuICAgICAgICBtZXRhZGF0YTogeyBrZXk6ICd2YWx1ZScgfSxcbiAgICAgIH0sXG4gICAgICB0YWdzOiB7IGltcG9ydGFudDogJ3RhZycgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBoZWF2eUxvZyBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmRvd25ncmFkZV9oZWF2eScsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJywgb3BlcmF0aW9uOiAncHJvY2Vzc2luZycgfSxcbiAgICAgICAgICAgIGRlY2lzaW9uOiAnZG93bmdyYWRlJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ1N0cmlwIGhlYXZ5IGZpZWxkcyBmcm9tIHByb2Nlc3NpbmcgbG9ncycsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgY29uc3QgZG93bmdyYWRlZCA9IGV2ZW50cy5maW5kKChlKSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2hlYXZ5JykhO1xuICAgIGV4cGVjdChkb3duZ3JhZGVkKS50b0JlRGVmaW5lZCgpO1xuICAgIC8vIGRhdGEgc2hvdWxkIGJlIHN0cmlwcGVkXG4gICAgZXhwZWN0KGRvd25ncmFkZWQuZGF0YSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIHRhZ3Mgc2hvdWxkIGJlIGtlcHRcbiAgICBleHBlY3QoZG93bmdyYWRlZC50YWdzKS50b0VxdWFsKHsgaW1wb3J0YW50OiAndGFnJyB9KTtcbiAgICBleHBlY3Qoc3RhdHMuZG93bmdyYWRlZCkudG9CZSgxKTtcbiAgfSk7XG5cbiAgaXQoJ2Ryb3BzIHJvb3Qgc3BhbnMgd2l0aG91dCBwYXJlbnQgKHJlZ3Jlc3Npb24gdGVzdCBmb3IgY3JpdGljYWwgYnVnKScsICgpID0+IHtcbiAgICBjb25zdCByb290U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICdjMScsXG4gICAgICB0aW1lc3RhbXBNczogMSxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Jvb3QnLFxuICAgICAgb3BlcmF0aW9uOiAncm9vdC1vcGVyYXRpb24nLFxuICAgICAgZHVyYXRpb25NczogMTAwLFxuICAgICAgLy8gTm8gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIC0gdGhpcyBpcyBhIHJvb3Qgc3BhblxuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHJvb3RTcGFuIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZHJvcF9yb290JyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgb3BlcmF0aW9uOiAncm9vdC1vcGVyYXRpb24nIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICAgICAgcmVhc29uOiAnRHJvcCByb290IHNwYW5zJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBSb290IHNwYW4gTVVTVCBiZSBkcm9wcGVkIChyZWdyZXNzaW9uIHRlc3QgLSB0aGlzIHdhcyBicm9rZW4gYmVmb3JlKVxuICAgIGV4cGVjdChldmVudHMuZmluZCgoZSkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdyb290JykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgxKTtcbiAgfSk7XG5cbiAgaXQoJ2FnZ3JlZ2F0ZSBncmFjZWZ1bGx5IGhhbmRsZXMgZXZlbnRzIHdpdGhvdXQgcGFyZW50JywgKCkgPT4ge1xuICAgIGNvbnN0IG9ycGhhbkxvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgY29ycmVsYXRpb25JZDogJ2MxJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnb3JwaGFuJyxcbiAgICAgIG9wZXJhdGlvbjogJ29ycGhhbi1vcCcsXG4gICAgICAvLyBObyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWRcbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBvcnBoYW5Mb2cgXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5hZ2dyZWdhdGVfb3JwaGFuJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBvcGVyYXRpb246ICdvcnBoYW4tb3AnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2FnZ3JlZ2F0ZScsXG4gICAgICAgICAgICByZWFzb246ICdUcnkgdG8gYWdncmVnYXRlIG9ycGhhbicsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gRXZlbnQgd2l0aG91dCBwYXJlbnQgc2hvdWxkIGJlIGtlcHQgKGNhbid0IGFnZ3JlZ2F0ZSB3aXRob3V0IHBhcmVudClcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoKGUpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnb3JwaGFuJykpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0YXRzLmtlcHQpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHN0YXRzLmFnZ3JlZ2F0ZWQpLnRvQmUoMCk7XG4gIH0pO1xuXG4gIHRlc3QoJ3J1bGUgY29ycmVjdGx5IG1hdGNoZXMgRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvciBzcGFuIGZvciBkcm9wcGluZycsICgpID0+IHtcbiAgICBjb25zdCBwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbnMtcGFyZW50JyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBzb3VyY2U6ICdEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yLnByb2Nlc3MnLFxuICAgICAgb3BlcmF0aW9uOiAnYXdzOmR5bmFtb2RiIER5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3InLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwXG4gICAgfTtcblxuICAgIC8vIEFwcGx5IG5vaXNlIHJlZHVjdGlvbiB0byBqdXN0IHRoZSBzcGFuIChubyBjaGlsZHJlbilcbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4gXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgICBydWxlczogW11cbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gV2l0aG91dCBjaGlsZHJlbiwgdGhlIHNwYW4gc2hvdWxkIGJlIGRyb3BwZWRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Nucy1wYXJlbnQnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5kcm9wcGVkKS50b0JlKDEpO1xuICB9KTtcblxuICB0ZXN0KCdkcm9wcyBwYXJlbnQgc3BhbiB3aGVuIGNoaWxkcmVuIGFyZSBmb2xkZWQgaW50byBpdCBidXQgbm8gaGFyZCBzaWduYWxzIChhZ2dyZXNzaXZlIG5vaXNlIHJlZHVjdGlvbiknLCAoKSA9PiB7XG4gICAgY29uc3QgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnc25zLXBhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3Nvci5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ2F3czpkeW5hbW9kYiBEeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiA1MFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZExvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQtbG9nJyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ0R5bmFtb0RCU3RyZWFtVG9TTlNQcm9jZXNzb3IucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICdQdWJsaXNoIFNOUyBkb25lJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMjAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbnMtcGFyZW50J1xuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBDT1JSRUNUIEJFSEFWSU9SOiBQYXJlbnQgc3BhbiBpcyBEUk9QUEVEIGJlY2F1c2UgYWJzb3JiZWQgZGF0YSBpcyBvbmx5IE5PSVNFXG4gICAgLy8gUmF0aW9uYWxlOiBDaGlsZCB3YXMgZm9sZGVkIChqdXN0IG5vaXNlKSwgbm8gaGFyZCBzaWduYWxzIOKGkiBlbnRpcmUgdHJlZSBjYW4gYmUgZHJvcHBlZFxuICAgIC8vIFRoaXMgbWF4aW1pemVzIG5vaXNlIHJlZHVjdGlvbiB3aGlsZSBwcmVzZXJ2aW5nIGhhcmQgc2lnbmFsIGRhdGFcbiAgICBjb25zdCBrZXB0UGFyZW50ID0gZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Nucy1wYXJlbnQnKTtcbiAgICBleHBlY3Qoa2VwdFBhcmVudCkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgLy8gQ2hpbGQgbG9nIHNob3VsZCBhbHNvIGJlIGRyb3BwZWQgKGZvbGRlZCB0aGVuIHBhcmVudCBkcm9wcGVkKVxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnY2hpbGQtbG9nJykpLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIC8vIEVudGlyZSB0cmVlIHBydW5lZCAtIG5vIGhhcmQgc2lnbmFsc1xuICAgIGV4cGVjdChldmVudHMubGVuZ3RoKS50b0JlKDApO1xuICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMSk7IC8vIENoaWxkIHdhcyBmb2xkZWRcbiAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgxKTsgLy8gUGFyZW50IHdhcyBkcm9wcGVkXG4gIH0pO1xuXG4gIHRlc3QoJ2RvZXMgbm90IGZvcmNlLWtlZXAgcGFyZW50IHdpdGggYWdncmVnYXRlIGRlY2lzaW9uIGV2ZW4gd2hlbiBjaGlsZHJlbiBhcmUgZm9sZGVkIGludG8gaXQnLCAoKSA9PiB7XG4gICAgY29uc3QgZ3JhbmRwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdncmFuZHBhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnV29ya2Zsb3dDb250cm9sbGVyLnByb2Nlc3MnLFxuICAgICAgb3BlcmF0aW9uOiAnd29ya2Zsb3cuYmF0Y2gnLFxuICAgICAgdGltZXN0YW1wTXM6IDUwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogMTAwXG4gICAgfTtcblxuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnc2VydmljZTpCYXNlRW50aXR5U2VydmljZS51cHNlcnQnLFxuICAgICAgb3BlcmF0aW9uOiAnQmFzZUVudGl0eVNlcnZpY2UudXBzZXJ0JyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiA1MCxcbiAgICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogJ2dyYW5kcGFyZW50J1xuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZExvZzogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnY2hpbGQtbG9nJyxcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ3NlcnZpY2U6QmFzZUVudGl0eVNlcnZpY2UudXBzZXJ0JyxcbiAgICAgIG9wZXJhdGlvbjogJ0VudGl0eSB1cHNlcnRlZCcsXG4gICAgICB0aW1lc3RhbXBNczogMTIwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50J1xuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIGdyYW5kcGFyZW50U3BhbiwgcGFyZW50U3BhbiwgY2hpbGRMb2cgXSxcbiAgICAgIHtcbiAgICAgICAgLi4uYmFzZU5vaXNlLFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwcmVzZXRzOiBbICdmdzI0LmhvdHBhdGhzJyBdLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5mb2xkX2VudGl0eV9sb2dzJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBvcGVyYXRpb246ICdFbnRpdHkgdXBzZXJ0ZWQnIH0sXG4gICAgICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICAgICAgcmVhc29uOiAnRm9sZCBlbnRpdHkgb3BlcmF0aW9uIGxvZ3MnXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFZFUklGWTogUGFyZW50IHNwYW4gc2hvdWxkIGJlIGFnZ3JlZ2F0ZWQgKG5vdCBrZXB0KVxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50JykpLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIC8vIFZFUklGWTogR3JhbmRwYXJlbnQgaXMga2VwdCB3aXRoIGFnZ3JlZ2F0aW9uIHN1bW1hcnlcbiAgICBjb25zdCBncmFuZHBhcmVudCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdncmFuZHBhcmVudCcpO1xuICAgIGV4cGVjdChncmFuZHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZ3JhbmRwYXJlbnQ/Lm9wZXJhdGlvbikudG9CZSgnd29ya2Zsb3cuYmF0Y2gnKTtcbiAgICBleHBlY3QoZ3JhbmRwYXJlbnQ/LnNvdXJjZSkudG9CZSgnV29ya2Zsb3dDb250cm9sbGVyLnByb2Nlc3MnKTtcblxuICAgIGNvbnN0IG5vaXNlUmVkdWN0aW9uID0gKGdyYW5kcGFyZW50Py5kYXRhIGFzIGFueSk/Lm5vaXNlUmVkdWN0aW9uO1xuICAgIGV4cGVjdChub2lzZVJlZHVjdGlvbikudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3Qobm9pc2VSZWR1Y3Rpb24uYWdncmVnYXRlcykudG9CZURlZmluZWQoKTtcblxuICAgIC8vIFZFUklGWTogRXhhY3Qgc3RhdHNcbiAgICBleHBlY3Qoc3RhdHMuYWdncmVnYXRlZCkudG9CZSgxKTsgLy8gMSBwYXJlbnQgc3BhbiBhZ2dyZWdhdGVkXG4gICAgZXhwZWN0KHN0YXRzLmZvbGRlZCkudG9CZSgxKTsgLy8gMSBjaGlsZCBsb2cgZm9sZGVkXG4gIH0pO1xuXG4gIHRlc3QoJ2RvZXMgbm90IGZvcmNlLWtlZXAgcGFyZW50IHdpdGggZm9sZCBkZWNpc2lvbiBldmVuIHdoZW4gY2hpbGRyZW4gYXJlIGZvbGRlZCBpbnRvIGl0JywgKCkgPT4ge1xuICAgIGNvbnN0IGdyYW5kcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ3JhbmRwYXJlbnQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ1dvcmtmbG93Q29udHJvbGxlci5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ3dvcmtmbG93LmJhdGNoJyxcbiAgICAgIHRpbWVzdGFtcE1zOiA1MCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDEwMFxuICAgIH07XG5cbiAgICBjb25zdCBwYXJlbnRTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ1NvbWVTZXJ2aWNlLnByb2Nlc3MnLFxuICAgICAgb3BlcmF0aW9uOiAncHJvY2Vzcy5yZWNvcmQnLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZ3JhbmRwYXJlbnQnXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC1sb2cnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnU29tZVNlcnZpY2UucHJvY2VzcycsXG4gICAgICBvcGVyYXRpb246ICdSZWNvcmQgcHJvY2Vzc2VkJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMjAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6ICdwYXJlbnQnXG4gICAgfTtcblxuICAgIGNvbnN0IHsgZXZlbnRzLCBzdGF0cyB9ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgICAgIFsgZ3JhbmRwYXJlbnRTcGFuLCBwYXJlbnRTcGFuLCBjaGlsZExvZyBdLFxuICAgICAge1xuICAgICAgICAuLi5iYXNlTm9pc2UsXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIHByZXNldHM6IFtdLFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiAndGVzdC5mb2xkX3JlY29yZF9zcGFucycsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicsIG9wZXJhdGlvbjogJ3Byb2Nlc3MucmVjb3JkJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgcmVjb3JkIHByb2Nlc3Npbmcgc3BhbnMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ3Rlc3QuZm9sZF9jaGlsZF9sb2dzJyxcbiAgICAgICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBvcGVyYXRpb246ICdSZWNvcmQgcHJvY2Vzc2VkJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgY29tcGxldGlvbiBsb2dzJ1xuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBQYXJlbnQgc3BhbiBzaG91bGQgYmUgZm9sZGVkIChub3Qga2VwdCkgZXZlbiB0aG91Z2ggaXQgaGFkIGEgY2hpbGQgZm9sZGVkIGludG8gaXRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3BhcmVudCcpKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgLy8gQ2hpbGQgbG9nIHNob3VsZCBhbHNvIGJlIGZvbGRlZFxuICAgIGV4cGVjdChldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnY2hpbGQtbG9nJykpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAvLyBHcmFuZHBhcmVudCBzaG91bGQgYmUga2VwdCBhbmQgaGF2ZSBmb2xkIGNoZWNrcG9pbnRzXG4gICAgY29uc3QgZ3JhbmRwYXJlbnQgPSBldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnZ3JhbmRwYXJlbnQnKTtcbiAgICBleHBlY3QoZ3JhbmRwYXJlbnQpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KChncmFuZHBhcmVudD8uZGF0YSBhcyBhbnkpPy5jaGVja3BvaW50cykudG9CZURlZmluZWQoKTtcbiAgICAvLyBTdGF0cyBzaG91bGQgc2hvdyBmb2xkaW5nXG4gICAgZXhwZWN0KHN0YXRzLmZvbGRlZCkudG9CZSgyKTsgLy8gYm90aCBwYXJlbnQgYW5kIGNoaWxkIGZvbGRlZFxuICB9KTtcblxuICB0ZXN0KCdtYXRjaGVzIHN1Y2Nlc3MgZmllbGQgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgIGNvbnN0IHN1Y2Nlc3NTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzdWNjZXNzLTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBzdWNjZXNzOiB0cnVlXG4gICAgfTtcblxuICAgIGNvbnN0IGZhaWxTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYWlsLTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIC8vIEV4cGxpY2l0bHkgYWxsb3cgZHJvcHBpbmcgdGhpcyBmYWlsdXJlIChvdmVycmlkZSBoYXJkIHNpZ25hbCBwcm90ZWN0aW9uKVxuICAgICAgY2FwdHVyZTogeyBub2lzZTogeyBkZWNpc2lvbjogJ2Ryb3AnLCByZWFzb246ICd0ZXN0IG92ZXJyaWRlJyB9IH1cbiAgICB9O1xuXG4gICAgY29uc3Qgbm9TdWNjZXNzU3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbm8tc3VjY2Vzcy0xJyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0Lm9wZXJhdGlvbicsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnXG4gICAgfTtcblxuICAgIC8vIFJ1bGUgbWF0Y2hpbmcgc3VjY2VzczogdHJ1ZSBzaG91bGQgb25seSBtYXRjaCBzdWNjZXNzU3BhblxuICAgIGNvbnN0IHN1Y2Nlc3NSdWxlOiBOb2lzZVJ1bGUgPSB7XG4gICAgICBpZDogJ3Rlc3Quc3VjY2VzcycsXG4gICAgICBtYXRjaDogeyBzdWNjZXNzOiB0cnVlIH0sXG4gICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgcmVhc29uOiAndGVzdCdcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0MSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyBzdWNjZXNzU3BhbiwgZmFpbFNwYW4sIG5vU3VjY2Vzc1NwYW4gXSwgeyAuLi5iYXNlTm9pc2UsIGVuYWJsZWQ6IHRydWUsIHJ1bGVzOiBbIHN1Y2Nlc3NSdWxlIF0gfSk7XG4gICAgZXhwZWN0KHJlc3VsdDEuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdzdWNjZXNzLTEnKSkudG9CZVVuZGVmaW5lZCgpOyAvLyBkcm9wcGVkXG4gICAgZXhwZWN0KHJlc3VsdDEuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdmYWlsLTEnKSkudG9CZVVuZGVmaW5lZCgpOyAvLyBkcm9wcGVkICh2aWEgb3ZlcnJpZGUpXG4gICAgZXhwZWN0KHJlc3VsdDEuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICduby1zdWNjZXNzLTEnKSkudG9CZURlZmluZWQoKTsgLy8ga2VwdFxuXG4gICAgLy8gUnVsZSBtYXRjaGluZyBzdWNjZXNzOiBmYWxzZSBzaG91bGQgb25seSBtYXRjaCBmYWlsU3BhblxuICAgIGNvbnN0IGZhaWxSdWxlOiBOb2lzZVJ1bGUgPSB7XG4gICAgICBpZDogJ3Rlc3QuZmFpbCcsXG4gICAgICBtYXRjaDogeyBzdWNjZXNzOiBmYWxzZSB9LFxuICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgIHJlYXNvbjogJ3Rlc3QnXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3VsdDIgPSBhcHBseU5vaXNlUmVkdWN0aW9uKFsgc3VjY2Vzc1NwYW4sIGZhaWxTcGFuLCBub1N1Y2Nlc3NTcGFuIF0sIHsgLi4uYmFzZU5vaXNlLCBlbmFibGVkOiB0cnVlLCBydWxlczogWyBmYWlsUnVsZSBdIH0pO1xuICAgIGV4cGVjdChyZXN1bHQyLmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc3VjY2Vzcy0xJykpLnRvQmVEZWZpbmVkKCk7IC8vIGtlcHRcbiAgICBleHBlY3QocmVzdWx0Mi5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2ZhaWwtMScpKS50b0JlVW5kZWZpbmVkKCk7IC8vIGRyb3BwZWQgKG1hdGNoZWQgKyBvdmVycmlkZSlcbiAgICBleHBlY3QocmVzdWx0Mi5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ25vLXN1Y2Nlc3MtMScpKS50b0JlRGVmaW5lZCgpOyAvLyBrZXB0XG4gIH0pO1xuXG4gIHRlc3QoJ21hdGNoZXMgbWF4RHVyYXRpb25NcyBjb3JyZWN0bHkgKHVwcGVyIGJvdW5kKScsICgpID0+IHtcbiAgICBjb25zdCBmYXN0U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZmFzdC0xJyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBvcGVyYXRpb246ICd0ZXN0Lm9wZXJhdGlvbicsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgZHVyYXRpb25NczogMzBcbiAgICB9O1xuXG4gICAgY29uc3QgbWVkaXVtU3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnbWVkaXVtLTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiA1MCAvLyBleGFjdGx5IGF0IHRocmVzaG9sZCAtIHNob3VsZCBOT1QgbWF0Y2ggKDwgNTApXG4gICAgfTtcblxuICAgIGNvbnN0IHNsb3dTcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdzbG93LTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiAxMDBcbiAgICB9O1xuXG4gICAgLy8gTWF0Y2ggc3BhbnMgdW5kZXIgNTBtc1xuICAgIGNvbnN0IHJ1bGU6IE5vaXNlUnVsZSA9IHtcbiAgICAgIGlkOiAndGVzdC5mYXN0JyxcbiAgICAgIG1hdGNoOiB7IG1heER1cmF0aW9uTXM6IDUwIH0sXG4gICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgcmVhc29uOiAndGVzdCdcbiAgICB9O1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXBwbHlOb2lzZVJlZHVjdGlvbihbIGZhc3RTcGFuLCBtZWRpdW1TcGFuLCBzbG93U3BhbiBdLCB7IC4uLmJhc2VOb2lzZSwgZW5hYmxlZDogdHJ1ZSwgcnVsZXM6IFsgcnVsZSBdIH0pO1xuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdmYXN0LTEnKSkudG9CZVVuZGVmaW5lZCgpOyAvLyBkcm9wcGVkICgzMCA8IDUwKVxuICAgIGV4cGVjdChyZXN1bHQuZXZlbnRzLmZpbmQoKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdtZWRpdW0tMScpKS50b0JlRGVmaW5lZCgpOyAvLyBrZXB0ICg1MCA+PSA1MClcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc2xvdy0xJykpLnRvQmVEZWZpbmVkKCk7IC8vIGtlcHQgKDEwMCA+PSA1MClcbiAgfSk7XG5cbiAgdGVzdCgnbWF0Y2hlcyBkdXJhdGlvbiByYW5nZSBjb3JyZWN0bHkgKGR1cmF0aW9uTXMgKyBtYXhEdXJhdGlvbk1zKScsICgpID0+IHtcbiAgICBjb25zdCB0b29GYXN0OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0b28tZmFzdCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDVcbiAgICB9O1xuXG4gICAgY29uc3QgaW5SYW5nZTogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnaW4tcmFuZ2UnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIG9wZXJhdGlvbjogJ3Rlc3Qub3BlcmF0aW9uJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBkdXJhdGlvbk1zOiA1MFxuICAgIH07XG5cbiAgICBjb25zdCB0b29TbG93OiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICd0b28tc2xvdycsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgb3BlcmF0aW9uOiAndGVzdC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDE1MFxuICAgIH07XG5cbiAgICAvLyBNYXRjaCBzcGFucyBiZXR3ZWVuIDEwbXMgYW5kIDEwMG1zIChpbmNsdXNpdmUgbG93ZXIsIGV4Y2x1c2l2ZSB1cHBlcilcbiAgICBjb25zdCBydWxlOiBOb2lzZVJ1bGUgPSB7XG4gICAgICBpZDogJ3Rlc3QucmFuZ2UnLFxuICAgICAgbWF0Y2g6IHsgbWluRHVyYXRpb25NczogMTAsIG1heER1cmF0aW9uTXM6IDEwMCB9LFxuICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgIHJlYXNvbjogJ3Rlc3QnXG4gICAgfTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oWyB0b29GYXN0LCBpblJhbmdlLCB0b29TbG93IF0sIHsgLi4uYmFzZU5vaXNlLCBlbmFibGVkOiB0cnVlLCBydWxlczogWyBydWxlIF0gfSk7XG4gICAgZXhwZWN0KHJlc3VsdC5ldmVudHMuZmluZCgoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ3Rvby1mYXN0JykpLnRvQmVEZWZpbmVkKCk7IC8vIGtlcHQgKDUgPCAxMClcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnaW4tcmFuZ2UnKSkudG9CZVVuZGVmaW5lZCgpOyAvLyBkcm9wcGVkICgxMCA8PSA1MCA8IDEwMClcbiAgICBleHBlY3QocmVzdWx0LmV2ZW50cy5maW5kKChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAndG9vLXNsb3cnKSkudG9CZURlZmluZWQoKTsgLy8ga2VwdCAoMTUwID49IDEwMClcbiAgfSk7XG5cbiAgdGVzdCgnZHJvcHMgc3VjY2Vzc2Z1bCBmYXN0IEdFVCByZXF1ZXN0cyAoZncyNC5ob3RwYXRocyBwcmVzZXQpJywgKCkgPT4ge1xuICAgIGNvbnN0IGZhc3RHZXRTdWNjZXNzOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdmYXN0LWdldC0xJyxcbiAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgIGxldmVsOiAnaW5mbycsXG4gICAgICBzb3VyY2U6ICdBZG1pbkR5bmFtaWNFbnRpdHlDb250cm9sbGVyLmxpc3QnLFxuICAgICAgb3BlcmF0aW9uOiAnR0VUIC9hZG1pbi9lbnRpdHkvb2JzZXJ2YWJpbGl0eWxvZycsXG4gICAgICB0aW1lc3RhbXBNczogMTAwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGR1cmF0aW9uTXM6IDhcbiAgICB9O1xuXG4gICAgY29uc3Qgc2xvd0dldFN1Y2Nlc3M6IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3Nsb3ctZ2V0LTEnLFxuICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgbGV2ZWw6ICdpbmZvJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICBvcGVyYXRpb246ICdHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgZHVyYXRpb25NczogMTUwMFxuICAgIH07XG5cbiAgICBjb25zdCBmYXN0R2V0RmFpbDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiAnZmFzdC1nZXQtZmFpbCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIHNvdXJjZTogJ0FkbWluRHluYW1pY0VudGl0eUNvbnRyb2xsZXIubGlzdCcsXG4gICAgICBvcGVyYXRpb246ICdHRVQgL2FkbWluL2VudGl0eS9vYnNlcnZhYmlsaXR5bG9nJyxcbiAgICAgIHRpbWVzdGFtcE1zOiAxMDAsXG4gICAgICBjb3JyZWxhdGlvbklkOiAndGVzdCcsXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGR1cmF0aW9uTXM6IDgsXG4gICAgICBlcnJvcjogeyB0eXBlOiAnTm90Rm91bmRFcnJvcicsIG1lc3NhZ2U6ICdOb3QgZm91bmQnIH1cbiAgICB9O1xuXG4gICAgY29uc3QgeyBldmVudHMsIHN0YXRzIH0gPSBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICAgICAgWyBmYXN0R2V0U3VjY2Vzcywgc2xvd0dldFN1Y2Nlc3MsIGZhc3RHZXRGYWlsIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogWyAnZncyNC5ob3RwYXRocycgXSxcbiAgICAgICAgcnVsZXM6IFtdXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEZhc3Qgc3VjY2Vzc2Z1bCBHRVQgc2hvdWxkIGJlIGRyb3BwZWRcbiAgICBleHBlY3QoZXZlbnRzLmZpbmQoZSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gJ2Zhc3QtZ2V0LTEnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIC8vIFNsb3cgc3VjY2Vzc2Z1bCBHRVQgc2hvdWxkIGJlIGRvd25ncmFkZWQgKGtlcHQgYnV0IHN0cmlwcGVkKVxuICAgIGNvbnN0IHNsb3dHZXQgPSBldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAnc2xvdy1nZXQtMScpO1xuICAgIGV4cGVjdChzbG93R2V0KS50b0JlRGVmaW5lZCgpO1xuICAgIC8vIFZFUklGWTogRmFpbGVkIEdFVCBpcyBrZXB0IChoYXJkIHNpZ25hbCBwcm90ZWN0aW9uKVxuICAgIGNvbnN0IGZhaWxlZEdldCA9IGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdmYXN0LWdldC1mYWlsJyk7XG4gICAgZXhwZWN0KGZhaWxlZEdldCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZmFpbGVkR2V0Py5zdWNjZXNzKS50b0JlKGZhbHNlKTtcbiAgICBleHBlY3QoZmFpbGVkR2V0Py5sZXZlbCkudG9CZSgnZXJyb3InKTtcblxuICAgIC8vIFZFUklGWTogRXhhY3Qgc3RhdHNcbiAgICBleHBlY3Qoc3RhdHMuZHJvcHBlZCkudG9CZSgxKTsgLy8gMSBmYXN0IHN1Y2Nlc3NmdWwgR0VUIGRyb3BwZWRcbiAgfSk7XG5cbiAgdGVzdCgnZm9yY2Uta2VlcHMgcGFyZW50IHdpdGgga2VlcC9kb3duZ3JhZGUgZGVjaXNpb24gd2hlbiBjaGlsZHJlbiBhcmUgZm9sZGVkJywgKCkgPT4ge1xuICAgIGNvbnN0IHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogJ3BhcmVudCcsXG4gICAgICB0eXBlOiAnc3BhbicsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnSW1wb3J0YW50U2VydmljZS5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ2ltcG9ydGFudC5vcGVyYXRpb24nLFxuICAgICAgdGltZXN0YW1wTXM6IDEwMCxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6ICd0ZXN0JyxcbiAgICAgIGR1cmF0aW9uTXM6IDUwXG4gICAgfTtcblxuICAgIGNvbnN0IGNoaWxkTG9nOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6ICdjaGlsZC1sb2cnLFxuICAgICAgdHlwZTogJ2xvZycsXG4gICAgICBsZXZlbDogJ2luZm8nLFxuICAgICAgc291cmNlOiAnSW1wb3J0YW50U2VydmljZS5wcm9jZXNzJyxcbiAgICAgIG9wZXJhdGlvbjogJ1Byb2Nlc3NpbmcgZG9uZScsXG4gICAgICB0aW1lc3RhbXBNczogMTIwLFxuICAgICAgY29ycmVsYXRpb25JZDogJ3Rlc3QnLFxuICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiAncGFyZW50J1xuICAgIH07XG5cbiAgICBjb25zdCB7IGV2ZW50cywgc3RhdHMgfSA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oXG4gICAgICBbIHBhcmVudFNwYW4sIGNoaWxkTG9nIF0sXG4gICAgICB7XG4gICAgICAgIC4uLmJhc2VOb2lzZSxcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcHJlc2V0czogW10sXG4gICAgICAgIHJ1bGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6ICd0ZXN0LmZvbGRfY2hpbGRfbG9ncycsXG4gICAgICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJywgb3BlcmF0aW9uOiAnUHJvY2Vzc2luZyBkb25lJyB9LFxuICAgICAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgICAgIHJlYXNvbjogJ0ZvbGQgY29tcGxldGlvbiBsb2dzJ1xuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBQYXJlbnQgc3BhbiBzaG91bGQgYmUga2VwdCB0byBwcmVzZXJ2ZSBmb2xkIHN1bW1hcnlcbiAgICAvLyAoSXQncyBrZXB0IG5hdHVyYWxseSBieSBpdHMgJ2tlZXAnIGRlY2lzaW9uLCBub3QgZm9yY2Uta2VwdClcbiAgICBjb25zdCBwYXJlbnQgPSBldmVudHMuZmluZChlID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSAncGFyZW50Jyk7XG4gICAgZXhwZWN0KHBhcmVudCkudG9CZURlZmluZWQoKTtcbiAgICAvLyBDaGlsZCBzaG91bGQgYmUgZm9sZGVkIGludG8gcGFyZW50XG4gICAgZXhwZWN0KGV2ZW50cy5maW5kKGUgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQgPT09ICdjaGlsZC1sb2cnKSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdGF0cy5mb2xkZWQpLnRvQmUoMSk7XG5cbiAgICAvLyBWRVJJRlk6IFBhcmVudCBoYXMgZm9sZCBjaGVja3BvaW50IGZyb20gY2hpbGRcbiAgICBjb25zdCBjaGVja3BvaW50cyA9IChwYXJlbnQ/LmRhdGEgYXMgYW55KT8uY2hlY2twb2ludHM7XG4gICAgZXhwZWN0KGNoZWNrcG9pbnRzKS50b0JlRGVmaW5lZCgpO1xuICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGNoZWNrcG9pbnRzKSkudG9CZSh0cnVlKTtcbiAgICBleHBlY3QoY2hlY2twb2ludHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpOyAvLyBBdCBsZWFzdCAxIGZvbGQgY2hlY2twb2ludFxuXG4gICAgLy8gVkVSSUZZOiBDb250YWlucyBmb2xkIGNoZWNrcG9pbnQgd2l0aCBjb3JyZWN0IHN0cnVjdHVyZVxuICAgIGNvbnN0IGZvbGRDaGVja3BvaW50ID0gY2hlY2twb2ludHMuZmluZCgoY3A6IGFueSkgPT4gY3AubmFtZT8uaW5jbHVkZXMoJ2ZvbGRlZCcpIHx8IGNwLm5hbWU/LmluY2x1ZGVzKCdmb2xkJykpO1xuICAgIGV4cGVjdChmb2xkQ2hlY2twb2ludCkudG9CZURlZmluZWQoKTtcbiAgICBleHBlY3QoZm9sZENoZWNrcG9pbnQudHMpLnRvQmVEZWZpbmVkKCk7XG4gICAgZXhwZWN0KHR5cGVvZiBmb2xkQ2hlY2twb2ludC50cykudG9CZSgnbnVtYmVyJyk7XG4gIH0pO1xufSk7XG5cblxuIl19