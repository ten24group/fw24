import { applyNoiseReduction } from './index';
import type { NoiseRule, ObservabilityEvent } from '../types';
import { createObservabilityConfig } from '../config';

describe('noise reduction', () => {
  const baseNoise = createObservabilityConfig().noiseReduction;

  it('drops span.start when the corresponding consolidated span is dropped', () => {
    const parentSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'parent',
      operation: 'parent',
      durationMs: 10,
    };

    const childSpanStart: ObservabilityEvent = {
      type: 'span.start',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2,
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      operation: 'processRecord',
      source: 'BatchProcessor.processRecord',
      capture: { backends: [ 'otel' ] },
      durationMs: undefined,
    };

    const childSpan: ObservabilityEvent = {
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

    const { events } = applyNoiseReduction(
      [ parentSpan, childSpanStart, childSpan ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.batch_processors' ],
      }
    );

    expect(events.find((e) => e.observabilityLogId === 'child' && e.type === 'span')).toBeUndefined();
    expect(events.find((e) => e.observabilityLogId === 'child' && e.type === 'span.start')).toBeUndefined();
    expect(events.find((e) => e.observabilityLogId === 'parent' && e.type === 'span')).toBeDefined();
  });

  it('drops stream processor batch spans (root spans are noisy, audit.entity kept separately)', () => {
    const auditBatchSpan: ObservabilityEvent = {
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

    const snsBatchSpan: ObservabilityEvent = {
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

    const auditEntity: ObservabilityEvent = {
      type: 'audit.entity',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'audit-entity',
      source: 'DynamoDBStreamAuditLogger.process',
      operation: 'user.update',
      entityName: 'user',
    };

    const { events } = applyNoiseReduction(
      [ auditBatchSpan, snsBatchSpan, auditEntity ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
      }
    );

    // Batch spans should be dropped
    expect(events.find((e) => e.observabilityLogId === 'audit-batch')).toBeUndefined();
    expect(events.find((e) => e.observabilityLogId === 'sns-batch')).toBeUndefined();
    // audit.entity should be kept
    expect(events.find((e) => e.observabilityLogId === 'audit-entity')).toBeDefined();
  });

  it('aggregates per-record spans into parent span instead of emitting them', () => {
    const parentSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'parent',
      operation: 'parent',
      durationMs: 10,
    };

    const childSpanStart: ObservabilityEvent = {
      type: 'span.start',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2,
      observabilityLogId: 'child',
      parentObservabilityLogId: 'parent',
      operation: 'processRecord',
      source: 'BatchProcessor.processRecord',
      capture: { backends: [ 'otel' ] },
    };

    const childSpan: ObservabilityEvent = {
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

    const { events } = applyNoiseReduction(
      [ parentSpan, childSpanStart, childSpan ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.batch_processors' ],
      }
    );

    // both child span and its span.start should be removed
    expect(events.find((e) => e.observabilityLogId === 'child')).toBeUndefined();

    const parent = events.find((e) => e.observabilityLogId === 'parent' && e.type === 'span')!;
    const data = parent.data as any;
    expect(data?.noiseReduction?.aggregates).toBeTruthy();
    // Includes richer aggregate payloads (examples + rule ids) by default
    const firstKey = Object.keys(data.noiseReduction.aggregates)[ 0 ];
    expect(Array.isArray(data.noiseReduction.aggregates[ firstKey ]?.examples)).toBe(true);
  });

  it('bounds folded checkpoints to avoid runaway growth', () => {
    const parentSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'parent',
      operation: 'parent',
      durationMs: 10,
    };

    const logs: ObservabilityEvent[] = Array.from({ length: 20 }).map((_, i) => ({
      type: 'log',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2 + i,
      observabilityLogId: `l${i}`,
      parentObservabilityLogId: 'parent',
      operation: 'Publish SNS done',
      source: 'DynamoDBStreamToSNSProcessor.process',
    }));

    const { events } = applyNoiseReduction(
      [ parentSpan, ...logs ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        maxCheckpointsPerSpan: 5,
      }
    );

    const parent = events.find((e) => e.observabilityLogId === 'parent' && e.type === 'span')!;
    const data = parent.data as any;
    expect(Array.isArray(data?.checkpoints)).toBe(true);
    expect((data.checkpoints as any[]).length).toBeLessThanOrEqual(6); // includes possible truncation marker
  });

  it('matches durationMs as minimum threshold (>=)', () => {
    const fastSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'fast',
      operation: 'fast-op',
      durationMs: 50,
    };

    const slowSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2,
      observabilityLogId: 'slow',
      operation: 'slow-op',
      durationMs: 150,
    };

    const exactSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 3,
      observabilityLogId: 'exact',
      operation: 'exact-op',
      durationMs: 100,
    };

    // Rule: drop spans with duration >= 100ms
    const { events, stats } = applyNoiseReduction(
      [ fastSpan, slowSpan, exactSpan ],
      {
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
      }
    );

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
    const parentSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'parent',
      operation: 'parent-op',
      durationMs: 100,
    };

    const childLog: ObservabilityEvent = {
      type: 'log',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2,
      observabilityLogId: 'child-log',
      parentObservabilityLogId: 'parent',
      source: 'TestService.process',
    };

    const { events, stats } = applyNoiseReduction(
      [ parentSpan, childLog ],
      {
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
      }
    );

    // Child log should be folded (removed from output)
    expect(events.find((e) => e.observabilityLogId === 'child-log')).toBeUndefined();

    // Parent should have checkpoint for folded log
    const parent = events.find((e) => e.observabilityLogId === 'parent')!;
    const data = parent.data as any;
    expect(Array.isArray(data?.checkpoints)).toBe(true);
    expect(data.checkpoints.some((cp: any) => cp.name?.startsWith('metrics.folded:'))).toBe(true);

    expect(stats.folded).toBe(1);
    expect(stats.kept).toBe(1);
  });

  it('never drops error events (hard signal protection)', () => {
    const errorSpan: ObservabilityEvent = {
      type: 'span',
      level: 'error',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'error-span',
      operation: 'failing-op',
      durationMs: 10,
      error: { type: 'Error', message: 'Something failed' },
    };

    const failedSpan: ObservabilityEvent = {
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
    const { events, stats } = applyNoiseReduction(
      [ errorSpan, failedSpan ],
      {
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
      }
    );

    // Both error signals should be kept despite drop rule
    expect(events.find((e) => e.observabilityLogId === 'error-span')).toBeDefined();
    expect(events.find((e) => e.observabilityLogId === 'failed-span')).toBeDefined();
    expect(stats.kept).toBe(2);
    expect(stats.dropped).toBe(0);
  });

  it('matches tags correctly', () => {
    const matchingSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'matching',
      operation: 'test-op',
      durationMs: 10,
      tags: { processor: 'audit', entity: 'user' },
    };

    const nonMatchingSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2,
      observabilityLogId: 'non-matching',
      operation: 'test-op',
      durationMs: 10,
      tags: { processor: 'sns', entity: 'post' },
    };

    const { events, stats } = applyNoiseReduction(
      [ matchingSpan, nonMatchingSpan ],
      {
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
      }
    );

    // Matching span should be dropped
    expect(events.find((e) => e.observabilityLogId === 'matching')).toBeUndefined();
    // Non-matching span should be kept
    expect(events.find((e) => e.observabilityLogId === 'non-matching')).toBeDefined();
    expect(stats.dropped).toBe(1);
    expect(stats.kept).toBe(1);
  });

  it('matches regex patterns in source and operation', () => {
    const matchingLog: ObservabilityEvent = {
      type: 'log',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'matching',
      operation: 'Publish SNS done',
      source: 'DynamoDBStreamToSNSProcessor.process',
    };

    const nonMatchingLog: ObservabilityEvent = {
      type: 'log',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 2,
      observabilityLogId: 'non-matching',
      operation: 'Processing item',
      source: 'MyService.process',
    };

    const { events, stats } = applyNoiseReduction(
      [ matchingLog, nonMatchingLog ],
      {
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
      }
    );

    // Matching log should be dropped
    expect(events.find((e) => e.observabilityLogId === 'matching')).toBeUndefined();
    // Non-matching log should be kept
    expect(events.find((e) => e.observabilityLogId === 'non-matching')).toBeDefined();
    expect(stats.dropped).toBe(1);
    expect(stats.kept).toBe(1);
  });

  it('downgrades events by stripping heavy fields', () => {
    const heavyLog: ObservabilityEvent = {
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

    const { events, stats } = applyNoiseReduction(
      [ heavyLog ],
      {
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
      }
    );

    const downgraded = events.find((e) => e.observabilityLogId === 'heavy')!;
    expect(downgraded).toBeDefined();
    // data should be stripped
    expect(downgraded.data).toBeUndefined();
    // tags should be kept
    expect(downgraded.tags).toEqual({ important: 'tag' });
    expect(stats.downgraded).toBe(1);
  });

  it('drops root spans without parent (regression test for critical bug)', () => {
    const rootSpan: ObservabilityEvent = {
      type: 'span',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'root',
      operation: 'root-operation',
      durationMs: 100,
      // No parentObservabilityLogId - this is a root span
    };

    const { events, stats } = applyNoiseReduction(
      [ rootSpan ],
      {
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
      }
    );

    // Root span MUST be dropped (regression test - this was broken before)
    expect(events.find((e) => e.observabilityLogId === 'root')).toBeUndefined();
    expect(stats.dropped).toBe(1);
  });

  it('aggregate gracefully handles events without parent', () => {
    const orphanLog: ObservabilityEvent = {
      type: 'log',
      level: 'info',
      correlationId: 'c1',
      timestampMs: 1,
      observabilityLogId: 'orphan',
      operation: 'orphan-op',
      // No parentObservabilityLogId
    };

    const { events, stats } = applyNoiseReduction(
      [ orphanLog ],
      {
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
      }
    );

    // Event without parent should be kept (can't aggregate without parent)
    expect(events.find((e) => e.observabilityLogId === 'orphan')).toBeDefined();
    expect(stats.kept).toBe(1);
    expect(stats.aggregated).toBe(0);
  });

  test('rule correctly matches DynamoDBStreamToSNSProcessor span for dropping', () => {
    const parentSpan: ObservabilityEvent = {
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
    const { events, stats } = applyNoiseReduction(
      [ parentSpan ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        rules: []
      }
    );

    // Without children, the span should be dropped
    expect(events.find(e => e.observabilityLogId === 'sns-parent')).toBeUndefined();
    expect(stats.dropped).toBe(1);
  });

  test('drops parent span when children are folded into it but no hard signals (aggressive noise reduction)', () => {
    const parentSpan: ObservabilityEvent = {
      observabilityLogId: 'sns-parent',
      type: 'span',
      level: 'info',
      source: 'DynamoDBStreamToSNSProcessor.process',
      operation: 'aws:dynamodb DynamoDBStreamToSNSProcessor',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 50
    };

    const childLog: ObservabilityEvent = {
      observabilityLogId: 'child-log',
      type: 'log',
      level: 'info',
      source: 'DynamoDBStreamToSNSProcessor.process',
      operation: 'Publish SNS done',
      timestampMs: 120,
      correlationId: 'test',
      parentObservabilityLogId: 'sns-parent'
    };

    const { events, stats } = applyNoiseReduction(
      [ parentSpan, childLog ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        rules: [],
      }
    );

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
    const grandparentSpan: ObservabilityEvent = {
      observabilityLogId: 'grandparent',
      type: 'span',
      level: 'info',
      source: 'WorkflowController.process',
      operation: 'workflow.batch',
      timestampMs: 50,
      correlationId: 'test',
      durationMs: 100
    };

    const parentSpan: ObservabilityEvent = {
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

    const childLog: ObservabilityEvent = {
      observabilityLogId: 'child-log',
      type: 'log',
      level: 'info',
      source: 'service:BaseEntityService.upsert',
      operation: 'Entity upserted',
      timestampMs: 120,
      correlationId: 'test',
      parentObservabilityLogId: 'parent'
    };

    const { events, stats } = applyNoiseReduction(
      [ grandparentSpan, parentSpan, childLog ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        rules: [
          {
            id: 'test.fold_entity_logs',
            match: { type: 'log', operation: 'Entity upserted' },
            decision: 'fold',
            reason: 'Fold entity operation logs'
          }
        ]
      }
    );

    // VERIFY: Parent span should be aggregated (not kept)
    expect(events.find(e => e.observabilityLogId === 'parent')).toBeUndefined();

    // VERIFY: Grandparent is kept with aggregation summary
    const grandparent = events.find(e => e.observabilityLogId === 'grandparent');
    expect(grandparent).toBeDefined();
    expect(grandparent?.operation).toBe('workflow.batch');
    expect(grandparent?.source).toBe('WorkflowController.process');

    const noiseReduction = (grandparent?.data as any)?.noiseReduction;
    expect(noiseReduction).toBeDefined();
    expect(noiseReduction.aggregates).toBeDefined();

    // VERIFY: Exact stats
    expect(stats.aggregated).toBe(1); // 1 parent span aggregated
    expect(stats.folded).toBe(1); // 1 child log folded
  });

  test('does not force-keep parent with fold decision even when children are folded into it', () => {
    const grandparentSpan: ObservabilityEvent = {
      observabilityLogId: 'grandparent',
      type: 'span',
      level: 'info',
      source: 'WorkflowController.process',
      operation: 'workflow.batch',
      timestampMs: 50,
      correlationId: 'test',
      durationMs: 100
    };

    const parentSpan: ObservabilityEvent = {
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

    const childLog: ObservabilityEvent = {
      observabilityLogId: 'child-log',
      type: 'log',
      level: 'info',
      source: 'SomeService.process',
      operation: 'Record processed',
      timestampMs: 120,
      correlationId: 'test',
      parentObservabilityLogId: 'parent'
    };

    const { events, stats } = applyNoiseReduction(
      [ grandparentSpan, parentSpan, childLog ],
      {
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
      }
    );

    // Parent span should be folded (not kept) even though it had a child folded into it
    expect(events.find(e => e.observabilityLogId === 'parent')).toBeUndefined();
    // Child log should also be folded
    expect(events.find(e => e.observabilityLogId === 'child-log')).toBeUndefined();
    // Grandparent should be kept and have fold checkpoints
    const grandparent = events.find(e => e.observabilityLogId === 'grandparent');
    expect(grandparent).toBeDefined();
    expect((grandparent?.data as any)?.checkpoints).toBeDefined();
    // Stats should show folding
    expect(stats.folded).toBe(2); // both parent and child folded
  });

  test('matches success field correctly', () => {
    const successSpan: ObservabilityEvent = {
      observabilityLogId: 'success-1',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      success: true
    };

    const failSpan: ObservabilityEvent = {
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

    const noSuccessSpan: ObservabilityEvent = {
      observabilityLogId: 'no-success-1',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test'
    };

    // Rule matching success: true should only match successSpan
    const successRule: NoiseRule = {
      id: 'test.success',
      match: { success: true },
      decision: 'drop',
      reason: 'test'
    };

    const result1 = applyNoiseReduction([ successSpan, failSpan, noSuccessSpan ], { ...baseNoise, enabled: true, rules: [ successRule ] });
    expect(result1.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'success-1')).toBeUndefined(); // dropped
    expect(result1.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'fail-1')).toBeUndefined(); // dropped (via override)
    expect(result1.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'no-success-1')).toBeDefined(); // kept

    // Rule matching success: false should only match failSpan
    const failRule: NoiseRule = {
      id: 'test.fail',
      match: { success: false },
      decision: 'drop',
      reason: 'test'
    };

    const result2 = applyNoiseReduction([ successSpan, failSpan, noSuccessSpan ], { ...baseNoise, enabled: true, rules: [ failRule ] });
    expect(result2.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'success-1')).toBeDefined(); // kept
    expect(result2.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'fail-1')).toBeUndefined(); // dropped (matched + override)
    expect(result2.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'no-success-1')).toBeDefined(); // kept
  });

  test('matches maxDurationMs correctly (upper bound)', () => {
    const fastSpan: ObservabilityEvent = {
      observabilityLogId: 'fast-1',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 30
    };

    const mediumSpan: ObservabilityEvent = {
      observabilityLogId: 'medium-1',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 50 // exactly at threshold - should NOT match (< 50)
    };

    const slowSpan: ObservabilityEvent = {
      observabilityLogId: 'slow-1',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 100
    };

    // Match spans under 50ms
    const rule: NoiseRule = {
      id: 'test.fast',
      match: { maxDurationMs: 50 },
      decision: 'drop',
      reason: 'test'
    };

    const result = applyNoiseReduction([ fastSpan, mediumSpan, slowSpan ], { ...baseNoise, enabled: true, rules: [ rule ] });
    expect(result.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'fast-1')).toBeUndefined(); // dropped (30 < 50)
    expect(result.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'medium-1')).toBeDefined(); // kept (50 >= 50)
    expect(result.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'slow-1')).toBeDefined(); // kept (100 >= 50)
  });

  test('matches duration range correctly (durationMs + maxDurationMs)', () => {
    const tooFast: ObservabilityEvent = {
      observabilityLogId: 'too-fast',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 5
    };

    const inRange: ObservabilityEvent = {
      observabilityLogId: 'in-range',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 50
    };

    const tooSlow: ObservabilityEvent = {
      observabilityLogId: 'too-slow',
      type: 'span',
      level: 'info',
      operation: 'test.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 150
    };

    // Match spans between 10ms and 100ms (inclusive lower, exclusive upper)
    const rule: NoiseRule = {
      id: 'test.range',
      match: { minDurationMs: 10, maxDurationMs: 100 },
      decision: 'drop',
      reason: 'test'
    };

    const result = applyNoiseReduction([ tooFast, inRange, tooSlow ], { ...baseNoise, enabled: true, rules: [ rule ] });
    expect(result.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'too-fast')).toBeDefined(); // kept (5 < 10)
    expect(result.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'in-range')).toBeUndefined(); // dropped (10 <= 50 < 100)
    expect(result.events.find((e: ObservabilityEvent) => e.observabilityLogId === 'too-slow')).toBeDefined(); // kept (150 >= 100)
  });

  test('drops successful fast GET requests (fw24.hotpaths preset)', () => {
    const fastGetSuccess: ObservabilityEvent = {
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

    const slowGetSuccess: ObservabilityEvent = {
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

    const fastGetFail: ObservabilityEvent = {
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

    const { events, stats } = applyNoiseReduction(
      [ fastGetSuccess, slowGetSuccess, fastGetFail ],
      {
        ...baseNoise,
        enabled: true,
        presets: [ 'fw24.hotpaths' ],
        rules: []
      }
    );

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
    const parentSpan: ObservabilityEvent = {
      observabilityLogId: 'parent',
      type: 'span',
      level: 'info',
      source: 'ImportantService.process',
      operation: 'important.operation',
      timestampMs: 100,
      correlationId: 'test',
      durationMs: 50
    };

    const childLog: ObservabilityEvent = {
      observabilityLogId: 'child-log',
      type: 'log',
      level: 'info',
      source: 'ImportantService.process',
      operation: 'Processing done',
      timestampMs: 120,
      correlationId: 'test',
      parentObservabilityLogId: 'parent'
    };

    const { events, stats } = applyNoiseReduction(
      [ parentSpan, childLog ],
      {
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
      }
    );

    // Parent span should be kept to preserve fold summary
    // (It's kept naturally by its 'keep' decision, not force-kept)
    const parent = events.find(e => e.observabilityLogId === 'parent');
    expect(parent).toBeDefined();
    // Child should be folded into parent
    expect(events.find(e => e.observabilityLogId === 'child-log')).toBeUndefined();
    expect(stats.folded).toBe(1);

    // VERIFY: Parent has fold checkpoint from child
    const checkpoints = (parent?.data as any)?.checkpoints;
    expect(checkpoints).toBeDefined();
    expect(Array.isArray(checkpoints)).toBe(true);
    expect(checkpoints.length).toBeGreaterThanOrEqual(1); // At least 1 fold checkpoint

    // VERIFY: Contains fold checkpoint with correct structure
    const foldCheckpoint = checkpoints.find((cp: any) => cp.name?.includes('folded') || cp.name?.includes('fold'));
    expect(foldCheckpoint).toBeDefined();
    expect(foldCheckpoint.ts).toBeDefined();
    expect(typeof foldCheckpoint.ts).toBe('number');
  });
});


