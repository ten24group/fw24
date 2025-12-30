import {
  NoiseReductionConfig,
  NoiseDecision,
  NoiseRule,
  NoiseRuleMatch,
  ObservabilityEvent,
  ObservabilityEventType,
  ObservabilityLevelString,
  SpanCheckpoint,
} from '../types';
import { createLogger } from '../../logging';
import { matchesPattern } from '../utils/pattern-utils';
import { evaluateNoiseRules } from './priority';

const logger = createLogger('NoiseReduction');

type NoiseStats = {
  dropped: number;
  folded: number;
  aggregated: number;
  downgraded: number;
  kept: number;
  approxBytesSaved: number;
  droppedByType: Record<string, number>;
  droppedByOperation: Record<string, number>;
  foldedByType: Record<string, number>;
  foldedByOperation: Record<string, number>;
};

export type NoiseReductionResult = {
  events: ObservabilityEvent[];
  stats: NoiseStats;
};

function inc(map: Record<string, number>, key: string | undefined, by = 1) {
  const k = key ?? '_';
  map[ k ] = (map[ k ] ?? 0) + by;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type Checkpoint = SpanCheckpoint;
function isCheckpoint(value: unknown): value is Checkpoint {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string') return false;
  if (typeof value.ts !== 'number') return false;
  if (value.tags !== undefined && !isRecord(value.tags)) return false;
  if (value.metrics !== undefined && !isRecord(value.metrics)) return false;
  if (value.data !== undefined && !isRecord(value.data)) return false;
  if (value.error !== undefined && !isRecord(value.error)) return false;
  return true;
}


type AggregateExample = {
  observabilityLogId: string;
  type: string;
  operation?: string;
  source?: string;
  entityName?: string;
  entityId?: string;
  durationMs?: number;
  success?: boolean;
  level: string;
  ruleId?: string;
};

type AggregateErrorExample = AggregateExample & {
  error?: { type: string; message: string };
};

type AggregateBucket = {
  count: number;
  errorCount: number;
  durationSumMs: number;
  durationMaxMs: number;
  examples: AggregateExample[];
  errorExamples: AggregateErrorExample[];
  rules: Record<string, number>;
};

type NoiseReductionData = {
  aggregates?: Record<string, AggregateBucket>;
  aggregateTruncated?: boolean;
  forcedKeep?: boolean;
  // summary fields
  dropped?: number;
  folded?: number;
  aggregated?: number;
  byRuleId?: Record<string, number>;
  approxBytesSaved?: number;
  byType?: Record<string, number>;
  byOperation?: Record<string, number>;
};

function readAggregateBucket(value: unknown): AggregateBucket | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.count !== 'number') return undefined;
  if (typeof value.errorCount !== 'number') return undefined;
  if (typeof value.durationSumMs !== 'number') return undefined;
  if (typeof value.durationMaxMs !== 'number') return undefined;
  if (!isRecord(value.rules)) return undefined;

  const rules: Record<string, number> = {};
  for (const [ k, v ] of Object.entries(value.rules)) {
    if (typeof v === 'number') rules[ k ] = v;
  }

  return {
    count: value.count,
    errorCount: value.errorCount,
    durationSumMs: value.durationSumMs,
    durationMaxMs: value.durationMaxMs,
    // We intentionally do not attempt to rehydrate example arrays from unknown input.
    // This module is the only writer of examples; if data is malformed, we reset examples safely.
    examples: [],
    errorExamples: [],
    rules,
  };
}

function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [ v ];
}

function matchesRule(event: ObservabilityEvent, match: NoiseRuleMatch): boolean {
  const types = asArray(match.type);
  if (types && !types.includes(event.type as ObservabilityEventType)) return false;

  const levels = asArray(match.level);
  if (levels && !levels.includes(event.level as ObservabilityLevelString)) return false;

  if (!matchesPattern(event.operation, match.operation)) return false;
  if (!matchesPattern(event.source, match.source)) return false;

  if (match.entityName && event.entityName !== match.entityName) return false;

  // Match minimum durationMs (match if event.durationMs >= threshold)
  // Example: durationMs: 100 matches spans with 100ms or longer duration
  if (match.minDurationMs !== undefined) {
    if (event.durationMs === undefined) return false; // No duration means no match
    if (event.durationMs < match.minDurationMs) return false; // Below threshold
  }

  // Match maximum durationMs (match if event.durationMs < threshold)
  // Example: maxDurationMs: 50 matches spans under 50ms
  if (match.maxDurationMs !== undefined) {
    if (event.durationMs === undefined) return false; // No duration means no match
    if (event.durationMs >= match.maxDurationMs) return false; // At or above threshold
  }

  // Match success status (true = successful, false = failed)
  if (match.success !== undefined) {
    if (event.success === undefined) return false; // No success field means no match
    if (event.success !== match.success) return false; // Different success status
  }

  if (match.tags) {
    for (const [ k, v ] of Object.entries(match.tags)) {
      if (!event.tags) return false;
      // Support exact match and regex-string match in tag values
      if (!matchesPattern(event.tags[ k ], v)) return false;
    }
  }

  return true;
}

const builtinRulesCache = new Map<string, NoiseRule[]>();

function getBuiltinRules(presets: string[]): NoiseRule[] {
  const cacheKey = [ ...presets ].sort().join(','); // Create a copy before sorting to avoid mutation
  let rules = builtinRulesCache.get(cacheKey);
  if (rules) return rules;

  rules = [];

  if (presets.includes('fw24.hotpaths')) {
    // =========================================================================
    // DATABASE QUERY NOISE REDUCTION (evaluation order matters!)
    // =========================================================================
    // Rules are evaluated in order - first match wins
    // Priority: errors > scans > slow queries > fast queries

    // 1. HIGHEST PRIORITY: Keep query errors (must be first!)
    rules.push({
      id: 'fw24.hotpaths.queries.keep_errors',
      match: {
        type: 'database.query',
        success: false
      },
      decision: 'keep',
      reason: 'Keep query errors as standalone logs for debugging - HIGHEST PRIORITY',
    });

    // 2. Keep table scans (always warnings, even if fast)
    rules.push({
      id: 'fw24.hotpaths.queries.keep_scans',
      match: {
        type: 'database.query',
        tags: { scan: 'true' }
      },
      decision: 'keep',
      reason: 'Keep table scan operations as standalone warnings - always need visibility',
    });

    // 3. Keep slow queries as standalone logs for investigation
    rules.push({
      id: 'fw24.hotpaths.queries.keep_slow',
      match: {
        type: 'database.query',
        minDurationMs: 100
      },
      decision: 'keep',
      reason: 'Keep slow queries (>=100ms) as standalone logs for performance investigation',
    });

    // 4. LOWEST PRIORITY: Fold fast successful queries into parent span
    // This only matches if none of the above matched (not error, not scan, not slow)
    rules.push({
      id: 'fw24.hotpaths.queries.fold_fast_success',
      match: {
        type: 'database.query',
        maxDurationMs: 100,
        success: true
      },
      decision: 'fold',
      reason: 'Fold fast successful queries (<100ms) into parent span as timeline checkpoints',
    });

    // API read operations: drop successful, fast GET/list requests
    // Low priority (10) - easily overridden by custom rules
    // Exceptions ensure errors and critical events are never dropped
    rules.push({
      id: 'fw24.hotpaths.api.drop_fast_successful_reads',
      priority: 10,  // Low priority - easy to override
      match: {
        type: 'span',
        // Matches:
        // - Controller operations: "HTTP GET /path", "HTTP HEAD /path", "HTTP OPTIONS /path"
        // - Service/utility methods: ".list", ".get", ".read", ".fetch", ".find"
        // - URL patterns: "/list", "/get", "/read", "/fetch", "/find"
        // - Also supports non-HTTP format for tests: "GET /path", "HEAD /path"
        operation: '/^(HTTP )?(GET|HEAD|OPTIONS)\\s|\\.(list|get|read|fetch|find)(?:[(/]|$)|\\/(list|get|read|fetch|find)(?:[/?]|$)/',
        maxDurationMs: 500
      },
      except: [
        { success: false },                    // Never drop failures
        { level: [ 'error', 'critical' ] },      // Never drop errors
      ],
      decision: 'drop',
      reason: 'Drop fast successful read operations (<500ms)',
    });

    // Stream processors: fold chatty "done" logs into their parent span.
    rules.push(
      {
        id: 'fw24.hotpaths.stream.fold_publish_done',
        match: { type: 'log', source: '/^DynamoDBStreamToSNSProcessor\\./', level: [ 'info', 'debug', 'trace' ], operation: '/Publish (SNS|FIFO) done/' },
        decision: 'fold',
        reason: 'Fold noisy stream publish completion logs into parent span',
      },
      {
        id: 'fw24.hotpaths.stream.fold_audit_done',
        match: { type: 'log', source: '/^DynamoDBStreamAuditLogger\\./', level: [ 'info', 'debug', 'trace' ], operation: '/done|Captured (create|update|delete) audit/' },
        decision: 'fold',
        reason: 'Fold noisy stream audit logger logs into parent span',
      },
      {
        id: 'fw24.hotpaths.stream.drop_info_noise',
        match: { type: 'log', source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\./', level: [ 'trace', 'debug' ] },
        decision: 'drop',
        reason: 'Drop low-level stream noise by default (still summarized)',
      },
      {
        id: 'fw24.hotpaths.stream.drop_batch_spans',
        match: { type: 'span', source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\.process$/', operation: '/^aws:(sqs|dynamodb) DynamoDBStream/' },
        decision: 'drop',
        reason: 'Drop stream processor batch spans (noisy, audit.entity records are kept separately)',
      },
      {
        id: 'fw24.hotpaths.entity.aggregate_upsert_spans',
        priority: 50,  // Default aggregate priority
        match: {
          type: 'span',
          operation: '/BaseEntityService\\.(upsert|update)/',
          source: '/^service:BaseEntityService\\./'
        },
        except: [
          { success: false },                // Keep failed writes
          { level: [ 'error', 'critical' ] },  // Keep error writes
        ],
        decision: 'aggregate',
        reason: 'Aggregate successful entity write spans into parent',
      },
    );
  }

  if (presets.includes('fw24.batch_processors')) {
    // =========================================================================
    // DATABASE QUERY NOISE REDUCTION FOR BATCH PROCESSING
    // =========================================================================
    // In batch processing, queries accumulate quickly (1000 records = 1000+ queries)
    // Rules are evaluated in order - first match wins
    // Priority: errors > scans > slow queries > fast queries

    // 1. HIGHEST PRIORITY: Keep query errors (must be first!)
    rules.push({
      id: 'fw24.batch.queries.keep_errors',
      match: {
        type: 'database.query',
        success: false
      },
      decision: 'keep',
      reason: 'Keep query errors in batch as standalone logs - HIGHEST PRIORITY',
    });

    // 2. Keep table scans (always warnings, even if fast)
    rules.push({
      id: 'fw24.batch.queries.keep_scans',
      match: {
        type: 'database.query',
        tags: { scan: 'true' }
      },
      decision: 'keep',
      reason: 'Keep table scans in batch - always need visibility for performance issues',
    });

    // 3. Keep slow queries (performance issues in batch processing)
    rules.push({
      id: 'fw24.batch.queries.keep_slow',
      match: {
        type: 'database.query',
        minDurationMs: 500
      },
      decision: 'keep',
      reason: 'Keep slow queries (>=500ms) in batch as standalone logs - performance issues',
    });

    // 4. LOWEST PRIORITY: Aggregate fast queries to prevent checkpoint spam
    // This only matches if none of the above matched (not error, not scan, not slow)
    rules.push({
      id: 'fw24.batch.queries.aggregate_fast',
      match: {
        type: 'database.query',
        maxDurationMs: 500,
        success: true
      },
      decision: 'aggregate',
      reason: 'Aggregate fast queries (<500ms) in batch to prevent checkpoint spam',
    });

    // Default: aggregate per-record spans in batch processors (summarize on parent batch span).
    // Match any span ending with " record" - flexible for all batch processor implementations.
    rules.push({
      id: 'fw24.batch.aggregate_record_spans',
      match: { type: 'span', operation: '/ record$/' },
      decision: 'aggregate',
      reason: 'Aggregate per-record spans in batch processors by default (summarize on parent)',
    });
  }

  builtinRulesCache.set(cacheKey, rules);
  return rules;
}

function pickNoiseDecision(event: ObservabilityEvent, cfg: NoiseReductionConfig): { decision: NoiseDecision; reason: string; ruleId: string; priority: number; matchedRulesCount: number } {
  if (!cfg.enabled) {
    return {
      decision: 'keep',
      reason: 'Noise reduction disabled',
      ruleId: 'disabled',
      priority: 0,
      matchedRulesCount: 0
    };
  }

  // Combine custom + builtin rules
  const builtinRules = getBuiltinRules(cfg.presets);
  const allRules = [ ...cfg.rules, ...builtinRules ];

  // Use priority-based evaluation
  return evaluateNoiseRules(event, allRules, matchesRule);
}

function ensureSpanData(span: ObservabilityEvent): Record<string, unknown> {
  const data = isRecord(span.data) ? span.data : {};
  span.data = data;
  return data;
}

function appendCheckpoint(span: ObservabilityEvent, name: string, ts: number): void {
  const data = ensureSpanData(span);
  const cps: Checkpoint[] = [];
  if (Array.isArray(data.checkpoints)) {
    for (const c of data.checkpoints) {
      if (isCheckpoint(c)) cps.push(c);
    }
  }
  cps.push({ name, ts });
  data.checkpoints = cps;
}

function getBounds(cfg: NoiseReductionConfig) {
  // No defensive defaults: cfg is normalized by createObservabilityConfig().
  return {
    maxCheckpointsPerSpan: cfg.maxCheckpointsPerSpan,
    maxAggregateKeysPerSpan: cfg.maxAggregateKeysPerSpan,
    maxAggregateExamplesPerKey: cfg.maxAggregateExamplesPerKey,
    maxAggregateErrorExamplesPerKey: cfg.maxAggregateErrorExamplesPerKey,
    includeDebugMetadata: cfg.includeDebugMetadata,
    includeExamples: cfg.includeExamples,
  };
}

function appendCheckpointBounded(
  span: ObservabilityEvent,
  cfg: NoiseReductionConfig,
  checkpoint: Checkpoint
): void {
  const { maxCheckpointsPerSpan } = getBounds(cfg);
  const data = ensureSpanData(span);
  const cps: Checkpoint[] = [];
  if (Array.isArray(data.checkpoints)) {
    for (const c of data.checkpoints) {
      if (isCheckpoint(c)) cps.push(c);
    }
  }
  if (cps.length >= maxCheckpointsPerSpan) {
    // Add one truncation marker if not already present
    if (!cps.some((c) => c.name === 'checkpoints.truncated')) {
      cps.push({ name: 'checkpoints.truncated', ts: Date.now(), data: { truncated: true } });
      data.checkpoints = cps;
    }
    return;
  }
  cps.push(checkpoint);
  data.checkpoints = cps;
}


function aggregateIntoParent(
  parentSpan: ObservabilityEvent,
  cfg: NoiseReductionConfig,
  event: ObservabilityEvent,
  kind: 'span' | 'log' | 'audit' | 'metric' | 'other',
  meta?: { ruleId?: string; reason?: string }
) {
  const { maxAggregateKeysPerSpan, maxAggregateExamplesPerKey, maxAggregateErrorExamplesPerKey, includeExamples, includeDebugMetadata } = getBounds(cfg);
  const data = ensureSpanData(parentSpan);
  const nrRaw = data.noiseReduction;
  const nr: NoiseReductionData = {};
  if (isRecord(nrRaw)) {
    if (typeof nrRaw.aggregateTruncated === 'boolean') nr.aggregateTruncated = nrRaw.aggregateTruncated;
    if (typeof nrRaw.forcedKeep === 'boolean') nr.forcedKeep = nrRaw.forcedKeep;

    if (isRecord(nrRaw.aggregates)) {
      const parsedAggs: Record<string, AggregateBucket> = {};
      for (const [ k, v ] of Object.entries(nrRaw.aggregates)) {
        const b = readAggregateBucket(v);
        if (b) parsedAggs[ k ] = b;
      }
      nr.aggregates = parsedAggs;
    }
  }

  const aggs: Record<string, AggregateBucket> = isRecord(nr.aggregates) ? nr.aggregates : {};
  const key = `${kind}:${event.operation ?? event.type}`;

  // Bound aggregate key cardinality
  const keys = Object.keys(aggs);
  if (!aggs[ key ] && keys.length >= maxAggregateKeysPerSpan) {
    nr.aggregateTruncated = true;
    nr.aggregates = aggs;
    data.noiseReduction = nr;
    return;
  }

  const bucket: AggregateBucket = aggs[ key ] ?? {
    count: 0,
    errorCount: 0,
    durationSumMs: 0,
    durationMaxMs: 0,
    examples: [],
    errorExamples: [],
    rules: {},
  };
  bucket.count += 1;
  if (event.level === 'error' || event.level === 'critical' || event.success === false || !!event.error) {
    bucket.errorCount += 1;
  }
  if (typeof event.durationMs === 'number') {
    bucket.durationSumMs += event.durationMs;
    bucket.durationMaxMs = Math.max(bucket.durationMaxMs, event.durationMs);
  }

  if (includeDebugMetadata && meta?.ruleId) {
    bucket.rules[ meta.ruleId ] = (bucket.rules[ meta.ruleId ] ?? 0) + 1;
  }

  if (includeExamples) {
    const ex = {
      observabilityLogId: event.observabilityLogId,
      type: event.type,
      operation: event.operation,
      source: event.source,
      entityName: event.entityName,
      entityId: event.entityId,
      durationMs: event.durationMs,
      success: event.success,
      level: event.level,
      ruleId: meta?.ruleId,
    };
    if (bucket.examples.length < maxAggregateExamplesPerKey) {
      bucket.examples.push(ex);
    }
    const isErr = event.level === 'error' || event.level === 'critical' || event.success === false || !!event.error;
    if (isErr && bucket.errorExamples.length < maxAggregateErrorExamplesPerKey) {
      bucket.errorExamples.push({
        ...ex,
        error: event.error ? { type: event.error.type, message: event.error.message } : undefined,
      });
    }
  }

  aggs[ key ] = bucket;

  nr.aggregates = aggs;
  data.noiseReduction = nr;
}

function estimateBytes(value: unknown): number {
  try {
    if (value === undefined) return 0;
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

function estimateEventHeavyBytes(event: ObservabilityEvent): number {
  // Only count fields we typically consider "payload noise".
  return (
    estimateBytes(event.data) +
    estimateBytes(event.attributes) +
    estimateBytes(event.metadata) +
    estimateBytes(event.context) +
    estimateBytes(event.actor)
  );
}

export function applyNoiseReduction(
  inputEvents: ObservabilityEvent[],
  cfg: NoiseReductionConfig
): NoiseReductionResult {
  const stats: NoiseStats = {
    dropped: 0,
    folded: 0,
    aggregated: 0,
    downgraded: 0,
    kept: 0,
    approxBytesSaved: 0,
    droppedByType: {},
    droppedByOperation: {},
    foldedByType: {},
    foldedByOperation: {},
  };

  if (!cfg.enabled) {
    return { events: inputEvents, stats: { ...stats, kept: inputEvents.length } };
  }

  // Index spans by id for folding + summaries.
  const spanById = new Map<string, ObservabilityEvent>();
  const spanStartById = new Map<string, ObservabilityEvent>();
  for (const e of inputEvents) {
    if (e.type === 'span' && e.observabilityLogId) {
      spanById.set(e.observabilityLogId, e);
    }
    if (e.type === 'span.start' && e.observabilityLogId) {
      spanStartById.set(e.observabilityLogId, e);
    }
  }

  // If we decide to DROP a consolidated span record, we must also DROP its OTEL-only span.start,
  // otherwise OTEL backend will create the span and later "orphan-end" it in flush(), which is pure noise.
  const spanDecisionById = new Map<string, NoiseDecision>();
  for (const e of inputEvents) {
    if (e.type !== 'span') continue;
    const picked = pickNoiseDecision(e, cfg);
    const isHardSignal = e.level === 'error'
      || e.level === 'critical'
      || e.success === false
      || !!e.error;
    const finalDecision: NoiseDecision = (isHardSignal && !e.capture?.noise) ? 'keep' : picked.decision;
    spanDecisionById.set(e.observabilityLogId, finalDecision);
  }

  // Aggregate dropped/folded/aggregated counts by parent span id (+ rule stats + bytes saved).
  type ParentSummary = {
    dropped: number;
    folded: number;
    aggregated: number;
    byOp: Record<string, number>;
    byType: Record<string, number>;
    byRuleId: Record<string, number>;
    approxBytesSaved: number;
  };
  const perParentSummary = new Map<string, ParentSummary>();
  const getParentAgg = (parentId: string) => {
    const existing = perParentSummary.get(parentId);
    if (existing) return existing;
    const created: ParentSummary = { dropped: 0, folded: 0, aggregated: 0, byOp: {}, byType: {}, byRuleId: {}, approxBytesSaved: 0 };
    perParentSummary.set(parentId, created);
    return created;
  };

  const output: ObservabilityEvent[] = [];

  for (const event of inputEvents) {
    const picked = pickNoiseDecision(event, cfg);
    const decision = picked.decision;
    const { includeDebugMetadata } = getBounds(cfg);

    // Keep/drop span.start based on the final decision for its consolidated span record.
    // This preserves OTEL correctness and reduces noise (no orphaned OTEL spans).
    if (event.type === 'span.start') {
      const spanDecision = spanDecisionById.get(event.observabilityLogId);
      // If we are not emitting the consolidated span record (drop/aggregate), we should not emit span.start either.
      if (spanDecision === 'drop' || spanDecision === 'aggregate') {
        stats.dropped++;
        inc(stats.droppedByType, event.type);
        inc(stats.droppedByOperation, event.operation);
        continue;
      }
      // Default keep for span.start (OTEL-only) if the span itself is kept.
      output.push(event);
      stats.kept++;
      continue;
    }

    // ========================================================================
    // NOISE REDUCTION DECISION HANDLING
    // ========================================================================
    // Decisions are applied in this order:
    // 1. Hard signals (errors/failures) → ALWAYS kept (unless explicitly overridden)
    // 2. keep → Event passes through unchanged
    // 3. fold → Event collapsed into parent span as a checkpoint (child events only)
    // 4. drop → Event removed entirely (works for root or child)
    // 5. aggregate → Event summarized into parent span (child events only)
    // 6. downgrade → Event kept but stripped of heavy fields
    // ========================================================================

    // Never drop errors/critical outright (policy safety net). Users can still force drop via override.
    const isHardSignal = event.level === 'error' || event.level === 'critical' || event.success === false || !!event.error;
    if (isHardSignal && !event.capture?.noise) {
      output.push(event);
      stats.kept++;
      continue;
    }

    if (decision === 'keep') {
      output.push(event);
      stats.kept++;
      continue;
    }

    const parentId = event.parentObservabilityLogId ?? undefined;
    const parentSpan = parentId ? spanById.get(parentId) : undefined;

    // ========================================================================
    // FOLD: Collapse event into parent as checkpoint (child events only)
    // ========================================================================
    if (decision === 'fold' && parentSpan) {
      // Preserve EMF/OTEL metrics without keeping the noisy standalone event.
      if (event.metrics && Object.keys(event.metrics).length > 0) {
        const parentMetrics: Record<string, number> = parentSpan.metrics ?? {};
        const merged: Record<string, number> = { ...parentMetrics };
        for (const [ k, v ] of Object.entries(event.metrics)) {
          merged[ k ] = (merged[ k ] ?? 0) + v;
        }
        parentSpan.metrics = merged;
        appendCheckpointBounded(parentSpan, cfg, {
          name: `metrics.folded:${event.operation ?? event.type}`,
          ts: event.timestampMs,
          metrics: { ...event.metrics },
        });
      }

      // Fold representation: add a single structured checkpoint onto the parent span.
      // Checkpoint is ALWAYS created (core design), but data payload is minimal in production.
      appendCheckpointBounded(parentSpan, cfg, {
        name: `fold:${event.type}:${event.operation ?? event.type}`,
        ts: event.timestampMs,
        tags: {
          foldedType: event.type,
          level: event.level,
          ...(event.entityName ? { entityName: event.entityName } : {}),
        },
        // Only include debug metadata if flag is enabled
        ...(includeDebugMetadata ? {
          data: {
            ...(event.entityId ? { entityId: event.entityId } : {}),
            ...(event.source ? { source: event.source } : {}),
            ...(picked.ruleId ? { ruleId: picked.ruleId } : {}),
            ...(picked.reason ? { reason: picked.reason } : {}),
          },
        } : {}),
        ...(event.error ? { error: event.error } : {}),
      });

      stats.folded++;
      inc(stats.foldedByType, event.type);
      inc(stats.foldedByOperation, event.operation);

      const agg = getParentAgg(parentId!);
      agg.folded++;
      inc(agg.byType, event.type);
      inc(agg.byOp, event.operation);
      if (includeDebugMetadata && picked.ruleId) {
        agg.byRuleId[ picked.ruleId ] = (agg.byRuleId[ picked.ruleId ] ?? 0) + 1;
      }
      if (includeDebugMetadata) {
        const saved = estimateEventHeavyBytes(event);
        agg.approxBytesSaved += saved;
        stats.approxBytesSaved += saved;
      }
      continue;
    }

    // ========================================================================
    // DROP: Remove event entirely (works for root or child events)
    // ========================================================================
    if (decision === 'drop') {
      stats.dropped++;
      inc(stats.droppedByType, event.type);
      inc(stats.droppedByOperation, event.operation);

      // If event has a parent, preserve its metrics and update parent's noise summary
      if (parentSpan && parentId) {
        // Preserve metrics in parent span
        if (event.metrics && Object.keys(event.metrics).length > 0) {
          parentSpan.metrics = { ...(parentSpan.metrics ?? {}), ...event.metrics };
          appendCheckpointBounded(parentSpan, cfg, {
            name: `metrics.folded:${event.operation ?? event.type}`,
            ts: event.timestampMs,
            metrics: event.metrics,
          });
        }

        // Update parent's noise reduction summary
        const agg = getParentAgg(parentId);
        agg.dropped++;
        inc(agg.byType, event.type);
        inc(agg.byOp, event.operation);
        if (includeDebugMetadata) {
          if (picked.ruleId) agg.byRuleId[ picked.ruleId ] = (agg.byRuleId[ picked.ruleId ] ?? 0) + 1;
          const saved = estimateEventHeavyBytes(event);
          agg.approxBytesSaved += saved;
          stats.approxBytesSaved += saved;
        }
      }
      continue; // Event is dropped - skip to next
    }

    // ========================================================================
    // AGGREGATE: Summarize event into parent (child events only)
    // ========================================================================
    if (decision === 'aggregate') {
      if (!parentSpan) {
        // Can't aggregate without a parent - keep the event
        output.push(event);
        stats.kept++;
        continue;
      }

      // Preserve metrics in parent span
      if (event.metrics && Object.keys(event.metrics).length > 0) {
        parentSpan.metrics = { ...(parentSpan.metrics ?? {}), ...event.metrics };
        appendCheckpointBounded(parentSpan, cfg, {
          name: `metrics.folded:${event.operation ?? event.type}`,
          ts: event.timestampMs,
          metrics: event.metrics,
        });
      }

      // Aggregate event details into parent's summary
      const kind: 'span' | 'log' | 'audit' | 'metric' | 'other' =
        event.type === 'span' ? 'span'
          : event.type === 'log' ? 'log'
            : event.type.startsWith('audit') ? 'audit'
              : event.type === 'metric' ? 'metric'
                : 'other';
      aggregateIntoParent(parentSpan, cfg, event, kind, { ruleId: picked.ruleId, reason: picked.reason });

      // Add checkpoint for timeline tracking
      appendCheckpointBounded(parentSpan, cfg, {
        name: `aggregate:${event.type}:${event.operation ?? event.type}`,
        ts: event.timestampMs,
        ...(includeDebugMetadata ? {
          data: {
            ...(picked.ruleId ? { ruleId: picked.ruleId } : {}),
            ...(picked.reason ? { reason: picked.reason } : {}),
          },
        } : {}),
      });

      // Update stats
      stats.aggregated++;
      const agg = getParentAgg(parentId!);
      agg.aggregated++;
      inc(agg.byType, event.type);
      inc(agg.byOp, event.operation);
      if (includeDebugMetadata) {
        if (picked.ruleId) agg.byRuleId[ picked.ruleId ] = (agg.byRuleId[ picked.ruleId ] ?? 0) + 1;
        const saved = estimateEventHeavyBytes(event);
        agg.approxBytesSaved += saved;
        stats.approxBytesSaved += saved;
      }
      continue; // Event is aggregated - skip to next
    }

    if (decision === 'downgrade') {
      // Keep the event, but strip heavy payload fields to reduce Dynamo/CloudWatch noise.
      // (Hard signals were already handled earlier.)
      const unit = isRecord(event.attributes) && typeof event.attributes.unit === 'string'
        ? event.attributes.unit
        : undefined;

      const downgraded: ObservabilityEvent = {
        ...event,
        data: undefined,
        attributes: {
          noiseReduced: 'downgraded',
          ...(unit ? { unit } : {}),
        },
        metadata: undefined,
        context: undefined,
        // keep actor minimal if present
        actor: event.actor ? {
          requestId: event.actor.requestId,
          timestamp: event.actor.timestamp,
          actorId: event.actor.actorId,
          actorType: event.actor.actorType,
          tenantId: event.actor.tenantId,
          correlationId: event.actor.correlationId,
        } : undefined,
      };
      output.push(downgraded);
      stats.downgraded++;
      stats.kept++;
      if (includeDebugMetadata) {
        // Approx bytes saved = heavy bytes removed from the event.
        const saved = estimateEventHeavyBytes(event);
        stats.approxBytesSaved += saved;
      }
      continue;
    }

    // If we can't fold/drop safely (no parent span), keep it.
    output.push(event);
    stats.kept++;
  }

  // Attach per-parent summary payloads (small, UI-visible) and a marker checkpoint.
  if (cfg.emitSummaries !== false) {
    for (const [ parentId, summary ] of perParentSummary.entries()) {
      const parent = spanById.get(parentId);
      if (!parent) continue;
      const data = ensureSpanData(parent);
      const existing = isRecord(data.noiseReduction) ? data.noiseReduction : {};
      // Always include basic counts
      existing.dropped = summary.dropped;
      existing.folded = summary.folded;
      existing.aggregated = summary.aggregated;
      // Always include type breakdown (minimal overhead, high value)
      existing.byType = summary.byType;

      // Debug metadata: detailed breakdowns
      if (getBounds(cfg).includeDebugMetadata) {
        existing.byRuleId = Object.fromEntries(
          Object.entries(summary.byRuleId)
            .sort((a, b) => b[ 1 ] - a[ 1 ])
            .slice(0, 10)
        );
        existing.approxBytesSaved = summary.approxBytesSaved;
        // Keep op summary bounded (top 10)
        existing.byOperation = Object.fromEntries(
          Object.entries(summary.byOp)
            .sort((a, b) => b[ 1 ] - a[ 1 ])
            .slice(0, 10)
        );
      }
      data.noiseReduction = existing;
      // Always add summary checkpoint (core design)
      appendCheckpointBounded(parent, cfg, { name: 'noiseReduction.summary', ts: Date.now() });
    }
  }

  // === Hierarchy integrity / accounting integrity (closure) ===
  //
  // If we emitted any event (or any noise summary) that relies on parent span P,
  // then P must also exist in the final output to avoid UI 404s and to preserve accounting.
  // This also applies to OTEL: if we force-keep a consolidated span, we should also keep its span.start when present.
  const outputSpanIds = new Set<string>();
  const outputById = new Map<string, ObservabilityEvent[]>();
  for (const e of output) {
    const list = outputById.get(e.observabilityLogId);
    if (list) list.push(e);
    else outputById.set(e.observabilityLogId, [ e ]);
    if (e.type === 'span') outputSpanIds.add(e.observabilityLogId);
  }

  const requiredParents = new Set<string>();
  // Parents referenced by emitted events
  for (const e of output) {
    const pid = e.parentObservabilityLogId ?? undefined;
    if (pid) requiredParents.add(pid);
  }
  // Parents that had suppression under them (need to exist so summaries/checkpoints are visible)
  // BUT: only if the parent span itself wasn't dropped by a noise reduction rule.
  // If the parent span matched a 'drop' rule, don't force-keep it just because children were folded into it.
  for (const pid of perParentSummary.keys()) {
    const parentSpan = spanById.get(pid);
    if (!parentSpan) {
      requiredParents.add(pid); // Parent not in this slice, keep requirement
      continue;
    }

    // Check if parent span is already in output from the main processing loop
    const parentAlreadyKept = outputSpanIds.has(pid);
    if (parentAlreadyKept) {
      requiredParents.add(pid);
      continue;
    }

    // Check if the parent span would be suppressed by noise reduction rules.
    // Use the pre-calculated decision from spanDecisionById.
    const parentDecision = spanDecisionById.get(pid);

    if (parentDecision === 'drop' || parentDecision === 'fold' || parentDecision === 'aggregate') {
      // Parent span was supposed to be suppressed (dropped/folded/aggregated into ITS parent).
      // Check if parent was added to requiredParents because of KEPT children (not just summaries).
      // If parent has kept children in output, we MUST keep the parent for hierarchy integrity.
      // If parent only has suppressed children (dropped/folded/aggregated), we can drop the parent too.
      const hasKeptChildren = requiredParents.has(pid); // Was it added earlier (kept child references)?

      if (hasKeptChildren) {
        // Parent has kept children in output - MUST keep parent for hierarchy
        // Keep in requiredParents (don't delete)
        requiredParents.add(pid);
      } else {
        // Parent has NO kept children - only has suppressed children with summaries
        // Drop the parent as intended by the rule
        // Not in requiredParents, so no need to delete
      }
      continue;
    }

    // Parent span wasn't dropped, so keep it to preserve fold/aggregate summaries
    requiredParents.add(pid);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const pid of Array.from(requiredParents)) {
      const parentSpan = spanById.get(pid);
      if (!parentSpan) continue;

      if (!outputSpanIds.has(pid)) {
        // Force keep parent span for integrity.
        const d = ensureSpanData(parentSpan);
        const nrRaw = d.noiseReduction;
        const nr: NoiseReductionData = { forcedKeep: true };
        if (isRecord(nrRaw)) {
          if (typeof nrRaw.aggregateTruncated === 'boolean') nr.aggregateTruncated = nrRaw.aggregateTruncated;
          if (typeof nrRaw.dropped === 'number') nr.dropped = nrRaw.dropped;
          if (typeof nrRaw.folded === 'number') nr.folded = nrRaw.folded;
          if (typeof nrRaw.aggregated === 'number') nr.aggregated = nrRaw.aggregated;
          if (typeof nrRaw.approxBytesSaved === 'number') nr.approxBytesSaved = nrRaw.approxBytesSaved;
          if (isRecord(nrRaw.byRuleId)) {
            const byRuleId: Record<string, number> = {};
            for (const [ k, v ] of Object.entries(nrRaw.byRuleId)) if (typeof v === 'number') byRuleId[ k ] = v;
            nr.byRuleId = byRuleId;
          }
          if (isRecord(nrRaw.byType)) {
            const byType: Record<string, number> = {};
            for (const [ k, v ] of Object.entries(nrRaw.byType)) if (typeof v === 'number') byType[ k ] = v;
            nr.byType = byType;
          }
          if (isRecord(nrRaw.byOperation)) {
            const byOperation: Record<string, number> = {};
            for (const [ k, v ] of Object.entries(nrRaw.byOperation)) if (typeof v === 'number') byOperation[ k ] = v;
            nr.byOperation = byOperation;
          }
          if (isRecord(nrRaw.aggregates)) {
            const parsedAggs: Record<string, AggregateBucket> = {};
            for (const [ k, v ] of Object.entries(nrRaw.aggregates)) {
              const b = readAggregateBucket(v);
              if (b) parsedAggs[ k ] = b;
            }
            nr.aggregates = parsedAggs;
          }
        }
        d.noiseReduction = nr;
        // Always add checkpoint (core design)
        appendCheckpointBounded(parentSpan, cfg, { name: 'noiseReduction.forcedKeepParent', ts: Date.now() });

        output.push(parentSpan);
        outputSpanIds.add(pid);
        stats.kept++;
        changed = true;
      }

      // Ensure OTEL span.start exists when we force-keep a span that has one.
      const start = spanStartById.get(pid);
      if (start) {
        const existing = outputById.get(pid);
        const hasStart = existing && existing.some((x) => x.type === 'span.start');
        if (!hasStart) {
          // Safety: prevent array overflow
          if (output.length < 1000000) {
            output.push(start);
            // Update outputById index so we don't push this again in next iteration
            if (existing) {
              existing.push(start);
            } else {
              outputById.set(pid, [ start ]);
            }
            stats.kept++;
            changed = true;
          } else {
            logger.warn('Noise reduction output array hit safety cap, dropping span.start', {
              spanId: pid,
              outputLength: output.length,
            });
          }
        }
      }

      // Closure: if parentSpan has its own parent, require it too.
      const pp = parentSpan.parentObservabilityLogId ?? undefined;
      if (pp && !requiredParents.has(pp)) {
        requiredParents.add(pp);
        changed = true;
      }
    }
  }

  return { events: output, stats };
}


