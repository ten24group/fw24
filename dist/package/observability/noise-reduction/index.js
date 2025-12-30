"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyNoiseReduction = applyNoiseReduction;
const logging_1 = require("../../logging");
const pattern_utils_1 = require("../utils/pattern-utils");
const priority_1 = require("./priority");
const logger = (0, logging_1.createLogger)('NoiseReduction');
function inc(map, key, by = 1) {
    const k = key ?? '_';
    map[k] = (map[k] ?? 0) + by;
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isCheckpoint(value) {
    if (!isRecord(value))
        return false;
    if (typeof value.name !== 'string')
        return false;
    if (typeof value.ts !== 'number')
        return false;
    if (value.tags !== undefined && !isRecord(value.tags))
        return false;
    if (value.metrics !== undefined && !isRecord(value.metrics))
        return false;
    if (value.data !== undefined && !isRecord(value.data))
        return false;
    if (value.error !== undefined && !isRecord(value.error))
        return false;
    return true;
}
function readAggregateBucket(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.count !== 'number')
        return undefined;
    if (typeof value.errorCount !== 'number')
        return undefined;
    if (typeof value.durationSumMs !== 'number')
        return undefined;
    if (typeof value.durationMaxMs !== 'number')
        return undefined;
    if (!isRecord(value.rules))
        return undefined;
    const rules = {};
    for (const [k, v] of Object.entries(value.rules)) {
        if (typeof v === 'number')
            rules[k] = v;
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
function asArray(v) {
    if (v === undefined)
        return undefined;
    return Array.isArray(v) ? v : [v];
}
function matchesRule(event, match) {
    const types = asArray(match.type);
    if (types && !types.includes(event.type))
        return false;
    const levels = asArray(match.level);
    if (levels && !levels.includes(event.level))
        return false;
    if (!(0, pattern_utils_1.matchesPattern)(event.operation, match.operation))
        return false;
    if (!(0, pattern_utils_1.matchesPattern)(event.source, match.source))
        return false;
    if (match.entityName && event.entityName !== match.entityName)
        return false;
    // Match minimum durationMs (match if event.durationMs >= threshold)
    // Example: durationMs: 100 matches spans with 100ms or longer duration
    if (match.minDurationMs !== undefined) {
        if (event.durationMs === undefined)
            return false; // No duration means no match
        if (event.durationMs < match.minDurationMs)
            return false; // Below threshold
    }
    // Match maximum durationMs (match if event.durationMs < threshold)
    // Example: maxDurationMs: 50 matches spans under 50ms
    if (match.maxDurationMs !== undefined) {
        if (event.durationMs === undefined)
            return false; // No duration means no match
        if (event.durationMs >= match.maxDurationMs)
            return false; // At or above threshold
    }
    // Match success status (true = successful, false = failed)
    if (match.success !== undefined) {
        if (event.success === undefined)
            return false; // No success field means no match
        if (event.success !== match.success)
            return false; // Different success status
    }
    if (match.tags) {
        for (const [k, v] of Object.entries(match.tags)) {
            if (!event.tags)
                return false;
            // Support exact match and regex-string match in tag values
            if (!(0, pattern_utils_1.matchesPattern)(event.tags[k], v))
                return false;
        }
    }
    return true;
}
const builtinRulesCache = new Map();
function getBuiltinRules(presets) {
    const cacheKey = [...presets].sort().join(','); // Create a copy before sorting to avoid mutation
    let rules = builtinRulesCache.get(cacheKey);
    if (rules)
        return rules;
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
            priority: 10, // Low priority - easy to override
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
                { success: false }, // Never drop failures
                { level: ['error', 'critical'] }, // Never drop errors
            ],
            decision: 'drop',
            reason: 'Drop fast successful read operations (<500ms)',
        });
        // Stream processors: fold chatty "done" logs into their parent span.
        rules.push({
            id: 'fw24.hotpaths.stream.fold_publish_done',
            match: { type: 'log', source: '/^DynamoDBStreamToSNSProcessor\\./', level: ['info', 'debug', 'trace'], operation: '/Publish (SNS|FIFO) done/' },
            decision: 'fold',
            reason: 'Fold noisy stream publish completion logs into parent span',
        }, {
            id: 'fw24.hotpaths.stream.fold_audit_done',
            match: { type: 'log', source: '/^DynamoDBStreamAuditLogger\\./', level: ['info', 'debug', 'trace'], operation: '/done|Captured (create|update|delete) audit/' },
            decision: 'fold',
            reason: 'Fold noisy stream audit logger logs into parent span',
        }, {
            id: 'fw24.hotpaths.stream.drop_info_noise',
            match: { type: 'log', source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\./', level: ['trace', 'debug'] },
            decision: 'drop',
            reason: 'Drop low-level stream noise by default (still summarized)',
        }, {
            id: 'fw24.hotpaths.stream.drop_batch_spans',
            match: { type: 'span', source: '/^DynamoDBStream(ToSNSProcessor|AuditLogger)\\.process$/', operation: '/^aws:(sqs|dynamodb) DynamoDBStream/' },
            decision: 'drop',
            reason: 'Drop stream processor batch spans (noisy, audit.entity records are kept separately)',
        }, {
            id: 'fw24.hotpaths.entity.aggregate_upsert_spans',
            priority: 50, // Default aggregate priority
            match: {
                type: 'span',
                operation: '/BaseEntityService\\.(upsert|update)/',
                source: '/^service:BaseEntityService\\./'
            },
            except: [
                { success: false }, // Keep failed writes
                { level: ['error', 'critical'] }, // Keep error writes
            ],
            decision: 'aggregate',
            reason: 'Aggregate successful entity write spans into parent',
        });
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
function pickNoiseDecision(event, cfg) {
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
    const allRules = [...cfg.rules, ...builtinRules];
    // Use priority-based evaluation
    return (0, priority_1.evaluateNoiseRules)(event, allRules, matchesRule);
}
function ensureSpanData(span) {
    const data = isRecord(span.data) ? span.data : {};
    span.data = data;
    return data;
}
function appendCheckpoint(span, name, ts) {
    const data = ensureSpanData(span);
    const cps = [];
    if (Array.isArray(data.checkpoints)) {
        for (const c of data.checkpoints) {
            if (isCheckpoint(c))
                cps.push(c);
        }
    }
    cps.push({ name, ts });
    data.checkpoints = cps;
}
function getBounds(cfg) {
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
function appendCheckpointBounded(span, cfg, checkpoint) {
    const { maxCheckpointsPerSpan } = getBounds(cfg);
    const data = ensureSpanData(span);
    const cps = [];
    if (Array.isArray(data.checkpoints)) {
        for (const c of data.checkpoints) {
            if (isCheckpoint(c))
                cps.push(c);
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
function aggregateIntoParent(parentSpan, cfg, event, kind, meta) {
    const { maxAggregateKeysPerSpan, maxAggregateExamplesPerKey, maxAggregateErrorExamplesPerKey, includeExamples, includeDebugMetadata } = getBounds(cfg);
    const data = ensureSpanData(parentSpan);
    const nrRaw = data.noiseReduction;
    const nr = {};
    if (isRecord(nrRaw)) {
        if (typeof nrRaw.aggregateTruncated === 'boolean')
            nr.aggregateTruncated = nrRaw.aggregateTruncated;
        if (typeof nrRaw.forcedKeep === 'boolean')
            nr.forcedKeep = nrRaw.forcedKeep;
        if (isRecord(nrRaw.aggregates)) {
            const parsedAggs = {};
            for (const [k, v] of Object.entries(nrRaw.aggregates)) {
                const b = readAggregateBucket(v);
                if (b)
                    parsedAggs[k] = b;
            }
            nr.aggregates = parsedAggs;
        }
    }
    const aggs = isRecord(nr.aggregates) ? nr.aggregates : {};
    const key = `${kind}:${event.operation ?? event.type}`;
    // Bound aggregate key cardinality
    const keys = Object.keys(aggs);
    if (!aggs[key] && keys.length >= maxAggregateKeysPerSpan) {
        nr.aggregateTruncated = true;
        nr.aggregates = aggs;
        data.noiseReduction = nr;
        return;
    }
    const bucket = aggs[key] ?? {
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
        bucket.rules[meta.ruleId] = (bucket.rules[meta.ruleId] ?? 0) + 1;
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
    aggs[key] = bucket;
    nr.aggregates = aggs;
    data.noiseReduction = nr;
}
function estimateBytes(value) {
    try {
        if (value === undefined)
            return 0;
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    }
    catch {
        return 0;
    }
}
function estimateEventHeavyBytes(event) {
    // Only count fields we typically consider "payload noise".
    return (estimateBytes(event.data) +
        estimateBytes(event.attributes) +
        estimateBytes(event.metadata) +
        estimateBytes(event.context) +
        estimateBytes(event.actor));
}
function applyNoiseReduction(inputEvents, cfg) {
    const stats = {
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
    const spanById = new Map();
    const spanStartById = new Map();
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
    const spanDecisionById = new Map();
    for (const e of inputEvents) {
        if (e.type !== 'span')
            continue;
        const picked = pickNoiseDecision(e, cfg);
        const isHardSignal = e.level === 'error'
            || e.level === 'critical'
            || e.success === false
            || !!e.error;
        const finalDecision = (isHardSignal && !e.capture?.noise) ? 'keep' : picked.decision;
        spanDecisionById.set(e.observabilityLogId, finalDecision);
    }
    const perParentSummary = new Map();
    const getParentAgg = (parentId) => {
        const existing = perParentSummary.get(parentId);
        if (existing)
            return existing;
        const created = { dropped: 0, folded: 0, aggregated: 0, byOp: {}, byType: {}, byRuleId: {}, approxBytesSaved: 0 };
        perParentSummary.set(parentId, created);
        return created;
    };
    const output = [];
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
                const parentMetrics = parentSpan.metrics ?? {};
                const merged = { ...parentMetrics };
                for (const [k, v] of Object.entries(event.metrics)) {
                    merged[k] = (merged[k] ?? 0) + v;
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
            const agg = getParentAgg(parentId);
            agg.folded++;
            inc(agg.byType, event.type);
            inc(agg.byOp, event.operation);
            if (includeDebugMetadata && picked.ruleId) {
                agg.byRuleId[picked.ruleId] = (agg.byRuleId[picked.ruleId] ?? 0) + 1;
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
                    if (picked.ruleId)
                        agg.byRuleId[picked.ruleId] = (agg.byRuleId[picked.ruleId] ?? 0) + 1;
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
            const kind = event.type === 'span' ? 'span'
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
            const agg = getParentAgg(parentId);
            agg.aggregated++;
            inc(agg.byType, event.type);
            inc(agg.byOp, event.operation);
            if (includeDebugMetadata) {
                if (picked.ruleId)
                    agg.byRuleId[picked.ruleId] = (agg.byRuleId[picked.ruleId] ?? 0) + 1;
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
            const downgraded = {
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
        for (const [parentId, summary] of perParentSummary.entries()) {
            const parent = spanById.get(parentId);
            if (!parent)
                continue;
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
                existing.byRuleId = Object.fromEntries(Object.entries(summary.byRuleId)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10));
                existing.approxBytesSaved = summary.approxBytesSaved;
                // Keep op summary bounded (top 10)
                existing.byOperation = Object.fromEntries(Object.entries(summary.byOp)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10));
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
    const outputSpanIds = new Set();
    const outputById = new Map();
    for (const e of output) {
        const list = outputById.get(e.observabilityLogId);
        if (list)
            list.push(e);
        else
            outputById.set(e.observabilityLogId, [e]);
        if (e.type === 'span')
            outputSpanIds.add(e.observabilityLogId);
    }
    // === REPARENT ORPHANED CHILDREN ===
    // If a child's parent was dropped/aggregated, reparent it to the nearest kept ancestor.
    // This prevents "parent not found" errors in the UI.
    // Track bypassed parents so hierarchy integrity doesn't force-keep them.
    const bypassedParents = new Set(); // Parents that were bypassed during reparenting
    const findKeptAncestor = (parentId, visited = new Set()) => {
        if (!parentId)
            return undefined;
        // If parent is in output, use it
        if (outputSpanIds.has(parentId))
            return parentId;
        // Prevent infinite loops
        if (visited.has(parentId))
            return undefined;
        visited.add(parentId);
        // Parent was dropped - recursively find its kept ancestor
        const parentSpan = spanById.get(parentId);
        if (!parentSpan)
            return undefined; // Parent not in this batch, no reparenting possible
        // Mark this parent as bypassed
        bypassedParents.add(parentId);
        return findKeptAncestor(parentSpan.parentObservabilityLogId ?? undefined, visited);
    };
    for (const e of output) {
        const originalParentId = e.parentObservabilityLogId ?? undefined;
        if (!originalParentId)
            continue; // Root event, no parent
        // If parent exists in output, no reparenting needed
        if (outputSpanIds.has(originalParentId))
            continue;
        // Parent was dropped - find nearest kept ancestor
        const keptAncestorId = findKeptAncestor(originalParentId);
        if (keptAncestorId && keptAncestorId !== originalParentId) {
            // Reparent to kept ancestor
            e.parentObservabilityLogId = keptAncestorId;
            // Add debug checkpoint if enabled
            if (getBounds(cfg).includeDebugMetadata) {
                const data = (e.data || {});
                if (!data.checkpoints) {
                    data.checkpoints = [];
                }
                const checkpoints = data.checkpoints;
                checkpoints.push({
                    name: 'noiseReduction.reparented',
                    ts: Date.now(),
                    data: {
                        originalParent: originalParentId,
                        newParent: keptAncestorId,
                        reason: 'Original parent was dropped by noise reduction'
                    }
                });
                e.data = data;
            }
        }
        else if (!keptAncestorId) {
            // No kept ancestor found - this is now a root event
            e.parentObservabilityLogId = undefined;
            if (getBounds(cfg).includeDebugMetadata) {
                const data = (e.data || {});
                if (!data.checkpoints) {
                    data.checkpoints = [];
                }
                const checkpoints = data.checkpoints;
                checkpoints.push({
                    name: 'noiseReduction.orphaned',
                    ts: Date.now(),
                    data: {
                        originalParent: originalParentId,
                        reason: 'Original parent and all ancestors were dropped by noise reduction'
                    }
                });
                e.data = data;
            }
        }
    }
    const requiredParents = new Set();
    // Parents referenced by emitted events (after reparenting)
    // Exclude bypassed parents (they were intentionally skipped during reparenting)
    for (const e of output) {
        const pid = e.parentObservabilityLogId ?? undefined;
        if (pid && !bypassedParents.has(pid)) {
            requiredParents.add(pid);
        }
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
            }
            else {
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
            if (!parentSpan)
                continue;
            if (!outputSpanIds.has(pid)) {
                // Check if this span was supposed to be suppressed (aggregated/folded/dropped).
                // If so, only force-keep it if it has KEPT children in the output.
                // Don't force-keep it just because it has its own suppressed children.
                const spanDecision = spanDecisionById.get(pid);
                if (spanDecision === 'aggregate' || spanDecision === 'fold' || spanDecision === 'drop') {
                    // This span was suppressed. Check if it has any KEPT children.
                    const hasKeptChildren = output.some(e => e.parentObservabilityLogId === pid);
                    if (!hasKeptChildren) {
                        // No kept children - this span should stay suppressed
                        // Remove from requiredParents so transitive closure doesn't propagate it
                        requiredParents.delete(pid);
                        continue;
                    }
                    // Has kept children - must force-keep for hierarchy integrity
                }
                // Force keep parent span for integrity.
                const d = ensureSpanData(parentSpan);
                const nrRaw = d.noiseReduction;
                const nr = { forcedKeep: true };
                if (isRecord(nrRaw)) {
                    if (typeof nrRaw.aggregateTruncated === 'boolean')
                        nr.aggregateTruncated = nrRaw.aggregateTruncated;
                    if (typeof nrRaw.dropped === 'number')
                        nr.dropped = nrRaw.dropped;
                    if (typeof nrRaw.folded === 'number')
                        nr.folded = nrRaw.folded;
                    if (typeof nrRaw.aggregated === 'number')
                        nr.aggregated = nrRaw.aggregated;
                    if (typeof nrRaw.approxBytesSaved === 'number')
                        nr.approxBytesSaved = nrRaw.approxBytesSaved;
                    if (isRecord(nrRaw.byRuleId)) {
                        const byRuleId = {};
                        for (const [k, v] of Object.entries(nrRaw.byRuleId))
                            if (typeof v === 'number')
                                byRuleId[k] = v;
                        nr.byRuleId = byRuleId;
                    }
                    if (isRecord(nrRaw.byType)) {
                        const byType = {};
                        for (const [k, v] of Object.entries(nrRaw.byType))
                            if (typeof v === 'number')
                                byType[k] = v;
                        nr.byType = byType;
                    }
                    if (isRecord(nrRaw.byOperation)) {
                        const byOperation = {};
                        for (const [k, v] of Object.entries(nrRaw.byOperation))
                            if (typeof v === 'number')
                                byOperation[k] = v;
                        nr.byOperation = byOperation;
                    }
                    if (isRecord(nrRaw.aggregates)) {
                        const parsedAggs = {};
                        for (const [k, v] of Object.entries(nrRaw.aggregates)) {
                            const b = readAggregateBucket(v);
                            if (b)
                                parsedAggs[k] = b;
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
                        }
                        else {
                            outputById.set(pid, [start]);
                        }
                        stats.kept++;
                        changed = true;
                    }
                    else {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEwaUJBLGtEQXdsQkM7QUF4bkNELDJDQUE2QztBQUM3QywwREFBd0Q7QUFDeEQseUNBQWdEO0FBRWhELE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBb0I5QyxTQUFTLEdBQUcsQ0FBQyxHQUEyQixFQUFFLEdBQXVCLEVBQUUsRUFBRSxHQUFHLENBQUM7SUFDdkUsTUFBTSxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUNyQixHQUFHLENBQUUsQ0FBQyxDQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUUsQ0FBQyxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQ2xDLENBQUM7QUFFRCxTQUFTLFFBQVEsQ0FBQyxLQUFjO0lBQzlCLE9BQU8sQ0FBQyxDQUFDLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3ZFLENBQUM7QUFHRCxTQUFTLFlBQVksQ0FBQyxLQUFjO0lBQ2xDLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDbkMsSUFBSSxPQUFPLEtBQUssQ0FBQyxJQUFJLEtBQUssUUFBUTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ2pELElBQUksT0FBTyxLQUFLLENBQUMsRUFBRSxLQUFLLFFBQVE7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUMvQyxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssU0FBUyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUNwRSxJQUFJLEtBQUssQ0FBQyxP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RUQsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLENBQUM7QUFDbkMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuICBOb2lzZURlY2lzaW9uLFxuICBOb2lzZVJ1bGUsXG4gIE5vaXNlUnVsZU1hdGNoLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlFdmVudFR5cGUsXG4gIE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyxcbiAgU3BhbkNoZWNrcG9pbnQsXG59IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgbWF0Y2hlc1BhdHRlcm4gfSBmcm9tICcuLi91dGlscy9wYXR0ZXJuLXV0aWxzJztcbmltcG9ydCB7IGV2YWx1YXRlTm9pc2VSdWxlcyB9IGZyb20gJy4vcHJpb3JpdHknO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ05vaXNlUmVkdWN0aW9uJyk7XG5cbnR5cGUgTm9pc2VTdGF0cyA9IHtcbiAgZHJvcHBlZDogbnVtYmVyO1xuICBmb2xkZWQ6IG51bWJlcjtcbiAgYWdncmVnYXRlZDogbnVtYmVyO1xuICBkb3duZ3JhZGVkOiBudW1iZXI7XG4gIGtlcHQ6IG51bWJlcjtcbiAgYXBwcm94Qnl0ZXNTYXZlZDogbnVtYmVyO1xuICBkcm9wcGVkQnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICBkcm9wcGVkQnlPcGVyYXRpb246IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIGZvbGRlZEJ5VHlwZTogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgZm9sZGVkQnlPcGVyYXRpb246IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG59O1xuXG5leHBvcnQgdHlwZSBOb2lzZVJlZHVjdGlvblJlc3VsdCA9IHtcbiAgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXTtcbiAgc3RhdHM6IE5vaXNlU3RhdHM7XG59O1xuXG5mdW5jdGlvbiBpbmMobWFwOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+LCBrZXk6IHN0cmluZyB8IHVuZGVmaW5lZCwgYnkgPSAxKSB7XG4gIGNvbnN0IGsgPSBrZXkgPz8gJ18nO1xuICBtYXBbIGsgXSA9IChtYXBbIGsgXSA/PyAwKSArIGJ5O1xufVxuXG5mdW5jdGlvbiBpc1JlY29yZCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuICEhdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG5cbnR5cGUgQ2hlY2twb2ludCA9IFNwYW5DaGVja3BvaW50O1xuZnVuY3Rpb24gaXNDaGVja3BvaW50KHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgQ2hlY2twb2ludCB7XG4gIGlmICghaXNSZWNvcmQodmFsdWUpKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0eXBlb2YgdmFsdWUubmFtZSAhPT0gJ3N0cmluZycpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZS50cyAhPT0gJ251bWJlcicpIHJldHVybiBmYWxzZTtcbiAgaWYgKHZhbHVlLnRhZ3MgIT09IHVuZGVmaW5lZCAmJiAhaXNSZWNvcmQodmFsdWUudGFncykpIHJldHVybiBmYWxzZTtcbiAgaWYgKHZhbHVlLm1ldHJpY3MgIT09IHVuZGVmaW5lZCAmJiAhaXNSZWNvcmQodmFsdWUubWV0cmljcykpIHJldHVybiBmYWxzZTtcbiAgaWYgKHZhbHVlLmRhdGEgIT09IHVuZGVmaW5lZCAmJiAhaXNSZWNvcmQodmFsdWUuZGF0YSkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHZhbHVlLmVycm9yICE9PSB1bmRlZmluZWQgJiYgIWlzUmVjb3JkKHZhbHVlLmVycm9yKSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuXG50eXBlIEFnZ3JlZ2F0ZUV4YW1wbGUgPSB7XG4gIG9ic2VydmFiaWxpdHlMb2dJZDogc3RyaW5nO1xuICB0eXBlOiBzdHJpbmc7XG4gIG9wZXJhdGlvbj86IHN0cmluZztcbiAgc291cmNlPzogc3RyaW5nO1xuICBlbnRpdHlOYW1lPzogc3RyaW5nO1xuICBlbnRpdHlJZD86IHN0cmluZztcbiAgZHVyYXRpb25Ncz86IG51bWJlcjtcbiAgc3VjY2Vzcz86IGJvb2xlYW47XG4gIGxldmVsOiBzdHJpbmc7XG4gIHJ1bGVJZD86IHN0cmluZztcbn07XG5cbnR5cGUgQWdncmVnYXRlRXJyb3JFeGFtcGxlID0gQWdncmVnYXRlRXhhbXBsZSAmIHtcbiAgZXJyb3I/OiB7IHR5cGU6IHN0cmluZzsgbWVzc2FnZTogc3RyaW5nIH07XG59O1xuXG50eXBlIEFnZ3JlZ2F0ZUJ1Y2tldCA9IHtcbiAgY291bnQ6IG51bWJlcjtcbiAgZXJyb3JDb3VudDogbnVtYmVyO1xuICBkdXJhdGlvblN1bU1zOiBudW1iZXI7XG4gIGR1cmF0aW9uTWF4TXM6IG51bWJlcjtcbiAgZXhhbXBsZXM6IEFnZ3JlZ2F0ZUV4YW1wbGVbXTtcbiAgZXJyb3JFeGFtcGxlczogQWdncmVnYXRlRXJyb3JFeGFtcGxlW107XG4gIHJ1bGVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xufTtcblxudHlwZSBOb2lzZVJlZHVjdGlvbkRhdGEgPSB7XG4gIGFnZ3JlZ2F0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBBZ2dyZWdhdGVCdWNrZXQ+O1xuICBhZ2dyZWdhdGVUcnVuY2F0ZWQ/OiBib29sZWFuO1xuICBmb3JjZWRLZWVwPzogYm9vbGVhbjtcbiAgLy8gc3VtbWFyeSBmaWVsZHNcbiAgZHJvcHBlZD86IG51bWJlcjtcbiAgZm9sZGVkPzogbnVtYmVyO1xuICBhZ2dyZWdhdGVkPzogbnVtYmVyO1xuICBieVJ1bGVJZD86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIGFwcHJveEJ5dGVzU2F2ZWQ/OiBudW1iZXI7XG4gIGJ5VHlwZT86IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIGJ5T3BlcmF0aW9uPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbn07XG5cbmZ1bmN0aW9uIHJlYWRBZ2dyZWdhdGVCdWNrZXQodmFsdWU6IHVua25vd24pOiBBZ2dyZWdhdGVCdWNrZXQgfCB1bmRlZmluZWQge1xuICBpZiAoIWlzUmVjb3JkKHZhbHVlKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHR5cGVvZiB2YWx1ZS5jb3VudCAhPT0gJ251bWJlcicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0eXBlb2YgdmFsdWUuZXJyb3JDb3VudCAhPT0gJ251bWJlcicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0eXBlb2YgdmFsdWUuZHVyYXRpb25TdW1NcyAhPT0gJ251bWJlcicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0eXBlb2YgdmFsdWUuZHVyYXRpb25NYXhNcyAhPT0gJ251bWJlcicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICghaXNSZWNvcmQodmFsdWUucnVsZXMpKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIGNvbnN0IHJ1bGVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXModmFsdWUucnVsZXMpKSB7XG4gICAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgcnVsZXNbIGsgXSA9IHY7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNvdW50OiB2YWx1ZS5jb3VudCxcbiAgICBlcnJvckNvdW50OiB2YWx1ZS5lcnJvckNvdW50LFxuICAgIGR1cmF0aW9uU3VtTXM6IHZhbHVlLmR1cmF0aW9uU3VtTXMsXG4gICAgZHVyYXRpb25NYXhNczogdmFsdWUuZHVyYXRpb25NYXhNcyxcbiAgICAvLyBXZSBpbnRlbnRpb25hbGx5IGRvIG5vdCBhdHRlbXB0IHRvIHJlaHlkcmF0ZSBleGFtcGxlIGFycmF5cyBmcm9tIHVua25vd24gaW5wdXQuXG4gICAgLy8gVGhpcyBtb2R1bGUgaXMgdGhlIG9ubHkgd3JpdGVyIG9mIGV4YW1wbGVzOyBpZiBkYXRhIGlzIG1hbGZvcm1lZCwgd2UgcmVzZXQgZXhhbXBsZXMgc2FmZWx5LlxuICAgIGV4YW1wbGVzOiBbXSxcbiAgICBlcnJvckV4YW1wbGVzOiBbXSxcbiAgICBydWxlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXNBcnJheTxUPih2OiBUIHwgVFtdIHwgdW5kZWZpbmVkKTogVFtdIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkodikgPyB2IDogWyB2IF07XG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNSdWxlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIG1hdGNoOiBOb2lzZVJ1bGVNYXRjaCk6IGJvb2xlYW4ge1xuICBjb25zdCB0eXBlcyA9IGFzQXJyYXkobWF0Y2gudHlwZSk7XG4gIGlmICh0eXBlcyAmJiAhdHlwZXMuaW5jbHVkZXMoZXZlbnQudHlwZSBhcyBPYnNlcnZhYmlsaXR5RXZlbnRUeXBlKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGxldmVscyA9IGFzQXJyYXkobWF0Y2gubGV2ZWwpO1xuICBpZiAobGV2ZWxzICYmICFsZXZlbHMuaW5jbHVkZXMoZXZlbnQubGV2ZWwgYXMgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGlmICghbWF0Y2hlc1BhdHRlcm4oZXZlbnQub3BlcmF0aW9uLCBtYXRjaC5vcGVyYXRpb24pKSByZXR1cm4gZmFsc2U7XG4gIGlmICghbWF0Y2hlc1BhdHRlcm4oZXZlbnQuc291cmNlLCBtYXRjaC5zb3VyY2UpKSByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKG1hdGNoLmVudGl0eU5hbWUgJiYgZXZlbnQuZW50aXR5TmFtZSAhPT0gbWF0Y2guZW50aXR5TmFtZSkgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIE1hdGNoIG1pbmltdW0gZHVyYXRpb25NcyAobWF0Y2ggaWYgZXZlbnQuZHVyYXRpb25NcyA+PSB0aHJlc2hvbGQpXG4gIC8vIEV4YW1wbGU6IGR1cmF0aW9uTXM6IDEwMCBtYXRjaGVzIHNwYW5zIHdpdGggMTAwbXMgb3IgbG9uZ2VyIGR1cmF0aW9uXG4gIGlmIChtYXRjaC5taW5EdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7IC8vIE5vIGR1cmF0aW9uIG1lYW5zIG5vIG1hdGNoXG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgPCBtYXRjaC5taW5EdXJhdGlvbk1zKSByZXR1cm4gZmFsc2U7IC8vIEJlbG93IHRocmVzaG9sZFxuICB9XG5cbiAgLy8gTWF0Y2ggbWF4aW11bSBkdXJhdGlvbk1zIChtYXRjaCBpZiBldmVudC5kdXJhdGlvbk1zIDwgdGhyZXNob2xkKVxuICAvLyBFeGFtcGxlOiBtYXhEdXJhdGlvbk1zOiA1MCBtYXRjaGVzIHNwYW5zIHVuZGVyIDUwbXNcbiAgaWYgKG1hdGNoLm1heER1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTsgLy8gTm8gZHVyYXRpb24gbWVhbnMgbm8gbWF0Y2hcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA+PSBtYXRjaC5tYXhEdXJhdGlvbk1zKSByZXR1cm4gZmFsc2U7IC8vIEF0IG9yIGFib3ZlIHRocmVzaG9sZFxuICB9XG5cbiAgLy8gTWF0Y2ggc3VjY2VzcyBzdGF0dXMgKHRydWUgPSBzdWNjZXNzZnVsLCBmYWxzZSA9IGZhaWxlZClcbiAgaWYgKG1hdGNoLnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5zdWNjZXNzID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTsgLy8gTm8gc3VjY2VzcyBmaWVsZCBtZWFucyBubyBtYXRjaFxuICAgIGlmIChldmVudC5zdWNjZXNzICE9PSBtYXRjaC5zdWNjZXNzKSByZXR1cm4gZmFsc2U7IC8vIERpZmZlcmVudCBzdWNjZXNzIHN0YXR1c1xuICB9XG5cbiAgaWYgKG1hdGNoLnRhZ3MpIHtcbiAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG1hdGNoLnRhZ3MpKSB7XG4gICAgICBpZiAoIWV2ZW50LnRhZ3MpIHJldHVybiBmYWxzZTtcbiAgICAgIC8vIFN1cHBvcnQgZXhhY3QgbWF0Y2ggYW5kIHJlZ2V4LXN0cmluZyBtYXRjaCBpbiB0YWcgdmFsdWVzXG4gICAgICBpZiAoIW1hdGNoZXNQYXR0ZXJuKGV2ZW50LnRhZ3NbIGsgXSwgdikpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cblxuY29uc3QgYnVpbHRpblJ1bGVzQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgTm9pc2VSdWxlW10+KCk7XG5cbmZ1bmN0aW9uIGdldEJ1aWx0aW5SdWxlcyhwcmVzZXRzOiBzdHJpbmdbXSk6IE5vaXNlUnVsZVtdIHtcbiAgY29uc3QgY2FjaGVLZXkgPSBbIC4uLnByZXNldHMgXS5zb3J0KCkuam9pbignLCcpOyAvLyBDcmVhdGUgYSBjb3B5IGJlZm9yZSBzb3J0aW5nIHRvIGF2b2lkIG11dGF0aW9uXG4gIGxldCBydWxlcyA9IGJ1aWx0aW5SdWxlc0NhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmIChydWxlcykgcmV0dXJuIHJ1bGVzO1xuXG4gIHJ1bGVzID0gW107XG5cbiAgaWYgKHByZXNldHMuaW5jbHVkZXMoJ2Z3MjQuaG90cGF0aHMnKSkge1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBEQVRBQkFTRSBRVUVSWSBOT0lTRSBSRURVQ1RJT04gKGV2YWx1YXRpb24gb3JkZXIgbWF0dGVycyEpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJ1bGVzIGFyZSBldmFsdWF0ZWQgaW4gb3JkZXIgLSBmaXJzdCBtYXRjaCB3aW5zXG4gICAgLy8gUHJpb3JpdHk6IGVycm9ycyA+IHNjYW5zID4gc2xvdyBxdWVyaWVzID4gZmFzdCBxdWVyaWVzXG5cbiAgICAvLyAxLiBISUdIRVNUIFBSSU9SSVRZOiBLZWVwIHF1ZXJ5IGVycm9ycyAobXVzdCBiZSBmaXJzdCEpXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMucXVlcmllcy5rZWVwX2Vycm9ycycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZVxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdLZWVwIHF1ZXJ5IGVycm9ycyBhcyBzdGFuZGFsb25lIGxvZ3MgZm9yIGRlYnVnZ2luZyAtIEhJR0hFU1QgUFJJT1JJVFknLFxuICAgIH0pO1xuXG4gICAgLy8gMi4gS2VlcCB0YWJsZSBzY2FucyAoYWx3YXlzIHdhcm5pbmdzLCBldmVuIGlmIGZhc3QpXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMucXVlcmllcy5rZWVwX3NjYW5zJyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIHRhZ3M6IHsgc2NhbjogJ3RydWUnIH1cbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcmVhc29uOiAnS2VlcCB0YWJsZSBzY2FuIG9wZXJhdGlvbnMgYXMgc3RhbmRhbG9uZSB3YXJuaW5ncyAtIGFsd2F5cyBuZWVkIHZpc2liaWxpdHknLFxuICAgIH0pO1xuXG4gICAgLy8gMy4gS2VlcCBzbG93IHF1ZXJpZXMgYXMgc3RhbmRhbG9uZSBsb2dzIGZvciBpbnZlc3RpZ2F0aW9uXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMucXVlcmllcy5rZWVwX3Nsb3cnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbWluRHVyYXRpb25NczogMTAwXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgIHJlYXNvbjogJ0tlZXAgc2xvdyBxdWVyaWVzICg+PTEwMG1zKSBhcyBzdGFuZGFsb25lIGxvZ3MgZm9yIHBlcmZvcm1hbmNlIGludmVzdGlnYXRpb24nLFxuICAgIH0pO1xuXG4gICAgLy8gNC4gTE9XRVNUIFBSSU9SSVRZOiBGb2xkIGZhc3Qgc3VjY2Vzc2Z1bCBxdWVyaWVzIGludG8gcGFyZW50IHNwYW5cbiAgICAvLyBUaGlzIG9ubHkgbWF0Y2hlcyBpZiBub25lIG9mIHRoZSBhYm92ZSBtYXRjaGVkIChub3QgZXJyb3IsIG5vdCBzY2FuLCBub3Qgc2xvdylcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmZvbGRfZmFzdF9zdWNjZXNzJyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIG1heER1cmF0aW9uTXM6IDEwMCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZVxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICByZWFzb246ICdGb2xkIGZhc3Qgc3VjY2Vzc2Z1bCBxdWVyaWVzICg8MTAwbXMpIGludG8gcGFyZW50IHNwYW4gYXMgdGltZWxpbmUgY2hlY2twb2ludHMnLFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIHJlYWQgb3BlcmF0aW9uczogZHJvcCBzdWNjZXNzZnVsLCBmYXN0IEdFVC9saXN0IHJlcXVlc3RzXG4gICAgLy8gTG93IHByaW9yaXR5ICgxMCkgLSBlYXNpbHkgb3ZlcnJpZGRlbiBieSBjdXN0b20gcnVsZXNcbiAgICAvLyBFeGNlcHRpb25zIGVuc3VyZSBlcnJvcnMgYW5kIGNyaXRpY2FsIGV2ZW50cyBhcmUgbmV2ZXIgZHJvcHBlZFxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLmFwaS5kcm9wX2Zhc3Rfc3VjY2Vzc2Z1bF9yZWFkcycsXG4gICAgICBwcmlvcml0eTogMTAsICAvLyBMb3cgcHJpb3JpdHkgLSBlYXN5IHRvIG92ZXJyaWRlXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnc3BhbicsXG4gICAgICAgIC8vIE1hdGNoZXM6XG4gICAgICAgIC8vIC0gQ29udHJvbGxlciBvcGVyYXRpb25zOiBcIkhUVFAgR0VUIC9wYXRoXCIsIFwiSFRUUCBIRUFEIC9wYXRoXCIsIFwiSFRUUCBPUFRJT05TIC9wYXRoXCJcbiAgICAgICAgLy8gLSBTZXJ2aWNlL3V0aWxpdHkgbWV0aG9kczogXCIubGlzdFwiLCBcIi5nZXRcIiwgXCIucmVhZFwiLCBcIi5mZXRjaFwiLCBcIi5maW5kXCJcbiAgICAgICAgLy8gLSBVUkwgcGF0dGVybnM6IFwiL2xpc3RcIiwgXCIvZ2V0XCIsIFwiL3JlYWRcIiwgXCIvZmV0Y2hcIiwgXCIvZmluZFwiXG4gICAgICAgIC8vIC0gQWxzbyBzdXBwb3J0cyBub24tSFRUUCBmb3JtYXQgZm9yIHRlc3RzOiBcIkdFVCAvcGF0aFwiLCBcIkhFQUQgL3BhdGhcIlxuICAgICAgICBvcGVyYXRpb246ICcvXihIVFRQICk/KEdFVHxIRUFEfE9QVElPTlMpXFxcXHN8XFxcXC4obGlzdHxnZXR8cmVhZHxmZXRjaHxmaW5kKSg/OlsoL118JCl8XFxcXC8obGlzdHxnZXR8cmVhZHxmZXRjaHxmaW5kKSg/OlsvP118JCkvJyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogNTAwXG4gICAgICB9LFxuICAgICAgZXhjZXB0OiBbXG4gICAgICAgIHsgc3VjY2VzczogZmFsc2UgfSwgICAgICAgICAgICAgICAgICAgIC8vIE5ldmVyIGRyb3AgZmFpbHVyZXNcbiAgICAgICAgeyBsZXZlbDogWyAnZXJyb3InLCAnY3JpdGljYWwnIF0gfSwgICAgICAvLyBOZXZlciBkcm9wIGVycm9yc1xuICAgICAgXSxcbiAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICByZWFzb246ICdEcm9wIGZhc3Qgc3VjY2Vzc2Z1bCByZWFkIG9wZXJhdGlvbnMgKDw1MDBtcyknLFxuICAgIH0pO1xuXG4gICAgLy8gU3RyZWFtIHByb2Nlc3NvcnM6IGZvbGQgY2hhdHR5IFwiZG9uZVwiIGxvZ3MgaW50byB0aGVpciBwYXJlbnQgc3Bhbi5cbiAgICBydWxlcy5wdXNoKFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLmZvbGRfcHVibGlzaF9kb25lJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW1Ub1NOU1Byb2Nlc3NvclxcXFwuLycsIGxldmVsOiBbICdpbmZvJywgJ2RlYnVnJywgJ3RyYWNlJyBdLCBvcGVyYXRpb246ICcvUHVibGlzaCAoU05TfEZJRk8pIGRvbmUvJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICByZWFzb246ICdGb2xkIG5vaXN5IHN0cmVhbSBwdWJsaXNoIGNvbXBsZXRpb24gbG9ncyBpbnRvIHBhcmVudCBzcGFuJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uZm9sZF9hdWRpdF9kb25lJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW1BdWRpdExvZ2dlclxcXFwuLycsIGxldmVsOiBbICdpbmZvJywgJ2RlYnVnJywgJ3RyYWNlJyBdLCBvcGVyYXRpb246ICcvZG9uZXxDYXB0dXJlZCAoY3JlYXRlfHVwZGF0ZXxkZWxldGUpIGF1ZGl0LycgfSxcbiAgICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgICAgcmVhc29uOiAnRm9sZCBub2lzeSBzdHJlYW0gYXVkaXQgbG9nZ2VyIGxvZ3MgaW50byBwYXJlbnQgc3BhbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLmRyb3BfaW5mb19ub2lzZScsXG4gICAgICAgIG1hdGNoOiB7IHR5cGU6ICdsb2cnLCBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtKFRvU05TUHJvY2Vzc29yfEF1ZGl0TG9nZ2VyKVxcXFwuLycsIGxldmVsOiBbICd0cmFjZScsICdkZWJ1ZycgXSB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICByZWFzb246ICdEcm9wIGxvdy1sZXZlbCBzdHJlYW0gbm9pc2UgYnkgZGVmYXVsdCAoc3RpbGwgc3VtbWFyaXplZCknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnN0cmVhbS5kcm9wX2JhdGNoX3NwYW5zJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nLCBzb3VyY2U6ICcvXkR5bmFtb0RCU3RyZWFtKFRvU05TUHJvY2Vzc29yfEF1ZGl0TG9nZ2VyKVxcXFwucHJvY2VzcyQvJywgb3BlcmF0aW9uOiAnL15hd3M6KHNxc3xkeW5hbW9kYikgRHluYW1vREJTdHJlYW0vJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2Ryb3AnLFxuICAgICAgICByZWFzb246ICdEcm9wIHN0cmVhbSBwcm9jZXNzb3IgYmF0Y2ggc3BhbnMgKG5vaXN5LCBhdWRpdC5lbnRpdHkgcmVjb3JkcyBhcmUga2VwdCBzZXBhcmF0ZWx5KScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuZW50aXR5LmFnZ3JlZ2F0ZV91cHNlcnRfc3BhbnMnLFxuICAgICAgICBwcmlvcml0eTogNTAsICAvLyBEZWZhdWx0IGFnZ3JlZ2F0ZSBwcmlvcml0eVxuICAgICAgICBtYXRjaDoge1xuICAgICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgICBvcGVyYXRpb246ICcvQmFzZUVudGl0eVNlcnZpY2VcXFxcLih1cHNlcnR8dXBkYXRlKS8nLFxuICAgICAgICAgIHNvdXJjZTogJy9ec2VydmljZTpCYXNlRW50aXR5U2VydmljZVxcXFwuLydcbiAgICAgICAgfSxcbiAgICAgICAgZXhjZXB0OiBbXG4gICAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LCAgICAgICAgICAgICAgICAvLyBLZWVwIGZhaWxlZCB3cml0ZXNcbiAgICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSB9LCAgLy8gS2VlcCBlcnJvciB3cml0ZXNcbiAgICAgICAgXSxcbiAgICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgICByZWFzb246ICdBZ2dyZWdhdGUgc3VjY2Vzc2Z1bCBlbnRpdHkgd3JpdGUgc3BhbnMgaW50byBwYXJlbnQnLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgaWYgKHByZXNldHMuaW5jbHVkZXMoJ2Z3MjQuYmF0Y2hfcHJvY2Vzc29ycycpKSB7XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERBVEFCQVNFIFFVRVJZIE5PSVNFIFJFRFVDVElPTiBGT1IgQkFUQ0ggUFJPQ0VTU0lOR1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBJbiBiYXRjaCBwcm9jZXNzaW5nLCBxdWVyaWVzIGFjY3VtdWxhdGUgcXVpY2tseSAoMTAwMCByZWNvcmRzID0gMTAwMCsgcXVlcmllcylcbiAgICAvLyBSdWxlcyBhcmUgZXZhbHVhdGVkIGluIG9yZGVyIC0gZmlyc3QgbWF0Y2ggd2luc1xuICAgIC8vIFByaW9yaXR5OiBlcnJvcnMgPiBzY2FucyA+IHNsb3cgcXVlcmllcyA+IGZhc3QgcXVlcmllc1xuXG4gICAgLy8gMS4gSElHSEVTVCBQUklPUklUWTogS2VlcCBxdWVyeSBlcnJvcnMgKG11c3QgYmUgZmlyc3QhKVxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmJhdGNoLnF1ZXJpZXMua2VlcF9lcnJvcnMnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgc3VjY2VzczogZmFsc2VcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcmVhc29uOiAnS2VlcCBxdWVyeSBlcnJvcnMgaW4gYmF0Y2ggYXMgc3RhbmRhbG9uZSBsb2dzIC0gSElHSEVTVCBQUklPUklUWScsXG4gICAgfSk7XG5cbiAgICAvLyAyLiBLZWVwIHRhYmxlIHNjYW5zIChhbHdheXMgd2FybmluZ3MsIGV2ZW4gaWYgZmFzdClcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5iYXRjaC5xdWVyaWVzLmtlZXBfc2NhbnMnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgdGFnczogeyBzY2FuOiAndHJ1ZScgfVxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdLZWVwIHRhYmxlIHNjYW5zIGluIGJhdGNoIC0gYWx3YXlzIG5lZWQgdmlzaWJpbGl0eSBmb3IgcGVyZm9ybWFuY2UgaXNzdWVzJyxcbiAgICB9KTtcblxuICAgIC8vIDMuIEtlZXAgc2xvdyBxdWVyaWVzIChwZXJmb3JtYW5jZSBpc3N1ZXMgaW4gYmF0Y2ggcHJvY2Vzc2luZylcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5iYXRjaC5xdWVyaWVzLmtlZXBfc2xvdycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBtaW5EdXJhdGlvbk1zOiA1MDBcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcmVhc29uOiAnS2VlcCBzbG93IHF1ZXJpZXMgKD49NTAwbXMpIGluIGJhdGNoIGFzIHN0YW5kYWxvbmUgbG9ncyAtIHBlcmZvcm1hbmNlIGlzc3VlcycsXG4gICAgfSk7XG5cbiAgICAvLyA0LiBMT1dFU1QgUFJJT1JJVFk6IEFnZ3JlZ2F0ZSBmYXN0IHF1ZXJpZXMgdG8gcHJldmVudCBjaGVja3BvaW50IHNwYW1cbiAgICAvLyBUaGlzIG9ubHkgbWF0Y2hlcyBpZiBub25lIG9mIHRoZSBhYm92ZSBtYXRjaGVkIChub3QgZXJyb3IsIG5vdCBzY2FuLCBub3Qgc2xvdylcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5iYXRjaC5xdWVyaWVzLmFnZ3JlZ2F0ZV9mYXN0JyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIG1heER1cmF0aW9uTXM6IDUwMCxcbiAgICAgICAgc3VjY2VzczogdHJ1ZVxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgIHJlYXNvbjogJ0FnZ3JlZ2F0ZSBmYXN0IHF1ZXJpZXMgKDw1MDBtcykgaW4gYmF0Y2ggdG8gcHJldmVudCBjaGVja3BvaW50IHNwYW0nLFxuICAgIH0pO1xuXG4gICAgLy8gRGVmYXVsdDogYWdncmVnYXRlIHBlci1yZWNvcmQgc3BhbnMgaW4gYmF0Y2ggcHJvY2Vzc29ycyAoc3VtbWFyaXplIG9uIHBhcmVudCBiYXRjaCBzcGFuKS5cbiAgICAvLyBNYXRjaCBhbnkgc3BhbiBlbmRpbmcgd2l0aCBcIiByZWNvcmRcIiAtIGZsZXhpYmxlIGZvciBhbGwgYmF0Y2ggcHJvY2Vzc29yIGltcGxlbWVudGF0aW9ucy5cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5iYXRjaC5hZ2dyZWdhdGVfcmVjb3JkX3NwYW5zJyxcbiAgICAgIG1hdGNoOiB7IHR5cGU6ICdzcGFuJywgb3BlcmF0aW9uOiAnLyByZWNvcmQkLycgfSxcbiAgICAgIGRlY2lzaW9uOiAnYWdncmVnYXRlJyxcbiAgICAgIHJlYXNvbjogJ0FnZ3JlZ2F0ZSBwZXItcmVjb3JkIHNwYW5zIGluIGJhdGNoIHByb2Nlc3NvcnMgYnkgZGVmYXVsdCAoc3VtbWFyaXplIG9uIHBhcmVudCknLFxuICAgIH0pO1xuICB9XG5cbiAgYnVpbHRpblJ1bGVzQ2FjaGUuc2V0KGNhY2hlS2V5LCBydWxlcyk7XG4gIHJldHVybiBydWxlcztcbn1cblxuZnVuY3Rpb24gcGlja05vaXNlRGVjaXNpb24oZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgY2ZnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyk6IHsgZGVjaXNpb246IE5vaXNlRGVjaXNpb247IHJlYXNvbjogc3RyaW5nOyBydWxlSWQ6IHN0cmluZzsgcHJpb3JpdHk6IG51bWJlcjsgbWF0Y2hlZFJ1bGVzQ291bnQ6IG51bWJlciB9IHtcbiAgaWYgKCFjZmcuZW5hYmxlZCkge1xuICAgIHJldHVybiB7XG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcmVhc29uOiAnTm9pc2UgcmVkdWN0aW9uIGRpc2FibGVkJyxcbiAgICAgIHJ1bGVJZDogJ2Rpc2FibGVkJyxcbiAgICAgIHByaW9yaXR5OiAwLFxuICAgICAgbWF0Y2hlZFJ1bGVzQ291bnQ6IDBcbiAgICB9O1xuICB9XG5cbiAgLy8gQ29tYmluZSBjdXN0b20gKyBidWlsdGluIHJ1bGVzXG4gIGNvbnN0IGJ1aWx0aW5SdWxlcyA9IGdldEJ1aWx0aW5SdWxlcyhjZmcucHJlc2V0cyk7XG4gIGNvbnN0IGFsbFJ1bGVzID0gWyAuLi5jZmcucnVsZXMsIC4uLmJ1aWx0aW5SdWxlcyBdO1xuXG4gIC8vIFVzZSBwcmlvcml0eS1iYXNlZCBldmFsdWF0aW9uXG4gIHJldHVybiBldmFsdWF0ZU5vaXNlUnVsZXMoZXZlbnQsIGFsbFJ1bGVzLCBtYXRjaGVzUnVsZSk7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZVNwYW5EYXRhKHNwYW46IE9ic2VydmFiaWxpdHlFdmVudCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgY29uc3QgZGF0YSA9IGlzUmVjb3JkKHNwYW4uZGF0YSkgPyBzcGFuLmRhdGEgOiB7fTtcbiAgc3Bhbi5kYXRhID0gZGF0YTtcbiAgcmV0dXJuIGRhdGE7XG59XG5cbmZ1bmN0aW9uIGFwcGVuZENoZWNrcG9pbnQoc3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50LCBuYW1lOiBzdHJpbmcsIHRzOiBudW1iZXIpOiB2b2lkIHtcbiAgY29uc3QgZGF0YSA9IGVuc3VyZVNwYW5EYXRhKHNwYW4pO1xuICBjb25zdCBjcHM6IENoZWNrcG9pbnRbXSA9IFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShkYXRhLmNoZWNrcG9pbnRzKSkge1xuICAgIGZvciAoY29uc3QgYyBvZiBkYXRhLmNoZWNrcG9pbnRzKSB7XG4gICAgICBpZiAoaXNDaGVja3BvaW50KGMpKSBjcHMucHVzaChjKTtcbiAgICB9XG4gIH1cbiAgY3BzLnB1c2goeyBuYW1lLCB0cyB9KTtcbiAgZGF0YS5jaGVja3BvaW50cyA9IGNwcztcbn1cblxuZnVuY3Rpb24gZ2V0Qm91bmRzKGNmZzogTm9pc2VSZWR1Y3Rpb25Db25maWcpIHtcbiAgLy8gTm8gZGVmZW5zaXZlIGRlZmF1bHRzOiBjZmcgaXMgbm9ybWFsaXplZCBieSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKCkuXG4gIHJldHVybiB7XG4gICAgbWF4Q2hlY2twb2ludHNQZXJTcGFuOiBjZmcubWF4Q2hlY2twb2ludHNQZXJTcGFuLFxuICAgIG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuOiBjZmcubWF4QWdncmVnYXRlS2V5c1BlclNwYW4sXG4gICAgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXk6IGNmZy5tYXhBZ2dyZWdhdGVFeGFtcGxlc1BlcktleSxcbiAgICBtYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5OiBjZmcubWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleSxcbiAgICBpbmNsdWRlRGVidWdNZXRhZGF0YTogY2ZnLmluY2x1ZGVEZWJ1Z01ldGFkYXRhLFxuICAgIGluY2x1ZGVFeGFtcGxlczogY2ZnLmluY2x1ZGVFeGFtcGxlcyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQoXG4gIHNwYW46IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY2ZnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgY2hlY2twb2ludDogQ2hlY2twb2ludFxuKTogdm9pZCB7XG4gIGNvbnN0IHsgbWF4Q2hlY2twb2ludHNQZXJTcGFuIH0gPSBnZXRCb3VuZHMoY2ZnKTtcbiAgY29uc3QgZGF0YSA9IGVuc3VyZVNwYW5EYXRhKHNwYW4pO1xuICBjb25zdCBjcHM6IENoZWNrcG9pbnRbXSA9IFtdO1xuICBpZiAoQXJyYXkuaXNBcnJheShkYXRhLmNoZWNrcG9pbnRzKSkge1xuICAgIGZvciAoY29uc3QgYyBvZiBkYXRhLmNoZWNrcG9pbnRzKSB7XG4gICAgICBpZiAoaXNDaGVja3BvaW50KGMpKSBjcHMucHVzaChjKTtcbiAgICB9XG4gIH1cbiAgaWYgKGNwcy5sZW5ndGggPj0gbWF4Q2hlY2twb2ludHNQZXJTcGFuKSB7XG4gICAgLy8gQWRkIG9uZSB0cnVuY2F0aW9uIG1hcmtlciBpZiBub3QgYWxyZWFkeSBwcmVzZW50XG4gICAgaWYgKCFjcHMuc29tZSgoYykgPT4gYy5uYW1lID09PSAnY2hlY2twb2ludHMudHJ1bmNhdGVkJykpIHtcbiAgICAgIGNwcy5wdXNoKHsgbmFtZTogJ2NoZWNrcG9pbnRzLnRydW5jYXRlZCcsIHRzOiBEYXRlLm5vdygpLCBkYXRhOiB7IHRydW5jYXRlZDogdHJ1ZSB9IH0pO1xuICAgICAgZGF0YS5jaGVja3BvaW50cyA9IGNwcztcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGNwcy5wdXNoKGNoZWNrcG9pbnQpO1xuICBkYXRhLmNoZWNrcG9pbnRzID0gY3BzO1xufVxuXG5cbmZ1bmN0aW9uIGFnZ3JlZ2F0ZUludG9QYXJlbnQoXG4gIHBhcmVudFNwYW46IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY2ZnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZyxcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAga2luZDogJ3NwYW4nIHwgJ2xvZycgfCAnYXVkaXQnIHwgJ21ldHJpYycgfCAnb3RoZXInLFxuICBtZXRhPzogeyBydWxlSWQ/OiBzdHJpbmc7IHJlYXNvbj86IHN0cmluZyB9XG4pIHtcbiAgY29uc3QgeyBtYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbiwgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXksIG1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXksIGluY2x1ZGVFeGFtcGxlcywgaW5jbHVkZURlYnVnTWV0YWRhdGEgfSA9IGdldEJvdW5kcyhjZmcpO1xuICBjb25zdCBkYXRhID0gZW5zdXJlU3BhbkRhdGEocGFyZW50U3Bhbik7XG4gIGNvbnN0IG5yUmF3ID0gZGF0YS5ub2lzZVJlZHVjdGlvbjtcbiAgY29uc3QgbnI6IE5vaXNlUmVkdWN0aW9uRGF0YSA9IHt9O1xuICBpZiAoaXNSZWNvcmQobnJSYXcpKSB7XG4gICAgaWYgKHR5cGVvZiBuclJhdy5hZ2dyZWdhdGVUcnVuY2F0ZWQgPT09ICdib29sZWFuJykgbnIuYWdncmVnYXRlVHJ1bmNhdGVkID0gbnJSYXcuYWdncmVnYXRlVHJ1bmNhdGVkO1xuICAgIGlmICh0eXBlb2YgbnJSYXcuZm9yY2VkS2VlcCA9PT0gJ2Jvb2xlYW4nKSBuci5mb3JjZWRLZWVwID0gbnJSYXcuZm9yY2VkS2VlcDtcblxuICAgIGlmIChpc1JlY29yZChuclJhdy5hZ2dyZWdhdGVzKSkge1xuICAgICAgY29uc3QgcGFyc2VkQWdnczogUmVjb3JkPHN0cmluZywgQWdncmVnYXRlQnVja2V0PiA9IHt9O1xuICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhuclJhdy5hZ2dyZWdhdGVzKSkge1xuICAgICAgICBjb25zdCBiID0gcmVhZEFnZ3JlZ2F0ZUJ1Y2tldCh2KTtcbiAgICAgICAgaWYgKGIpIHBhcnNlZEFnZ3NbIGsgXSA9IGI7XG4gICAgICB9XG4gICAgICBuci5hZ2dyZWdhdGVzID0gcGFyc2VkQWdncztcbiAgICB9XG4gIH1cblxuICBjb25zdCBhZ2dzOiBSZWNvcmQ8c3RyaW5nLCBBZ2dyZWdhdGVCdWNrZXQ+ID0gaXNSZWNvcmQobnIuYWdncmVnYXRlcykgPyBuci5hZ2dyZWdhdGVzIDoge307XG4gIGNvbnN0IGtleSA9IGAke2tpbmR9OiR7ZXZlbnQub3BlcmF0aW9uID8/IGV2ZW50LnR5cGV9YDtcblxuICAvLyBCb3VuZCBhZ2dyZWdhdGUga2V5IGNhcmRpbmFsaXR5XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhhZ2dzKTtcbiAgaWYgKCFhZ2dzWyBrZXkgXSAmJiBrZXlzLmxlbmd0aCA+PSBtYXhBZ2dyZWdhdGVLZXlzUGVyU3Bhbikge1xuICAgIG5yLmFnZ3JlZ2F0ZVRydW5jYXRlZCA9IHRydWU7XG4gICAgbnIuYWdncmVnYXRlcyA9IGFnZ3M7XG4gICAgZGF0YS5ub2lzZVJlZHVjdGlvbiA9IG5yO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGJ1Y2tldDogQWdncmVnYXRlQnVja2V0ID0gYWdnc1sga2V5IF0gPz8ge1xuICAgIGNvdW50OiAwLFxuICAgIGVycm9yQ291bnQ6IDAsXG4gICAgZHVyYXRpb25TdW1NczogMCxcbiAgICBkdXJhdGlvbk1heE1zOiAwLFxuICAgIGV4YW1wbGVzOiBbXSxcbiAgICBlcnJvckV4YW1wbGVzOiBbXSxcbiAgICBydWxlczoge30sXG4gIH07XG4gIGJ1Y2tldC5jb3VudCArPSAxO1xuICBpZiAoZXZlbnQubGV2ZWwgPT09ICdlcnJvcicgfHwgZXZlbnQubGV2ZWwgPT09ICdjcml0aWNhbCcgfHwgZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgISFldmVudC5lcnJvcikge1xuICAgIGJ1Y2tldC5lcnJvckNvdW50ICs9IDE7XG4gIH1cbiAgaWYgKHR5cGVvZiBldmVudC5kdXJhdGlvbk1zID09PSAnbnVtYmVyJykge1xuICAgIGJ1Y2tldC5kdXJhdGlvblN1bU1zICs9IGV2ZW50LmR1cmF0aW9uTXM7XG4gICAgYnVja2V0LmR1cmF0aW9uTWF4TXMgPSBNYXRoLm1heChidWNrZXQuZHVyYXRpb25NYXhNcywgZXZlbnQuZHVyYXRpb25Ncyk7XG4gIH1cblxuICBpZiAoaW5jbHVkZURlYnVnTWV0YWRhdGEgJiYgbWV0YT8ucnVsZUlkKSB7XG4gICAgYnVja2V0LnJ1bGVzWyBtZXRhLnJ1bGVJZCBdID0gKGJ1Y2tldC5ydWxlc1sgbWV0YS5ydWxlSWQgXSA/PyAwKSArIDE7XG4gIH1cblxuICBpZiAoaW5jbHVkZUV4YW1wbGVzKSB7XG4gICAgY29uc3QgZXggPSB7XG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICBvcGVyYXRpb246IGV2ZW50Lm9wZXJhdGlvbixcbiAgICAgIHNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgZW50aXR5TmFtZTogZXZlbnQuZW50aXR5TmFtZSxcbiAgICAgIGVudGl0eUlkOiBldmVudC5lbnRpdHlJZCxcbiAgICAgIGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMsXG4gICAgICBzdWNjZXNzOiBldmVudC5zdWNjZXNzLFxuICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgcnVsZUlkOiBtZXRhPy5ydWxlSWQsXG4gICAgfTtcbiAgICBpZiAoYnVja2V0LmV4YW1wbGVzLmxlbmd0aCA8IG1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5KSB7XG4gICAgICBidWNrZXQuZXhhbXBsZXMucHVzaChleCk7XG4gICAgfVxuICAgIGNvbnN0IGlzRXJyID0gZXZlbnQubGV2ZWwgPT09ICdlcnJvcicgfHwgZXZlbnQubGV2ZWwgPT09ICdjcml0aWNhbCcgfHwgZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgISFldmVudC5lcnJvcjtcbiAgICBpZiAoaXNFcnIgJiYgYnVja2V0LmVycm9yRXhhbXBsZXMubGVuZ3RoIDwgbWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleSkge1xuICAgICAgYnVja2V0LmVycm9yRXhhbXBsZXMucHVzaCh7XG4gICAgICAgIC4uLmV4LFxuICAgICAgICBlcnJvcjogZXZlbnQuZXJyb3IgPyB7IHR5cGU6IGV2ZW50LmVycm9yLnR5cGUsIG1lc3NhZ2U6IGV2ZW50LmVycm9yLm1lc3NhZ2UgfSA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFnZ3NbIGtleSBdID0gYnVja2V0O1xuXG4gIG5yLmFnZ3JlZ2F0ZXMgPSBhZ2dzO1xuICBkYXRhLm5vaXNlUmVkdWN0aW9uID0gbnI7XG59XG5cbmZ1bmN0aW9uIGVzdGltYXRlQnl0ZXModmFsdWU6IHVua25vd24pOiBudW1iZXIge1xuICB0cnkge1xuICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gMDtcbiAgICByZXR1cm4gQnVmZmVyLmJ5dGVMZW5ndGgoSlNPTi5zdHJpbmdpZnkodmFsdWUpLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gMDtcbiAgfVxufVxuXG5mdW5jdGlvbiBlc3RpbWF0ZUV2ZW50SGVhdnlCeXRlcyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogbnVtYmVyIHtcbiAgLy8gT25seSBjb3VudCBmaWVsZHMgd2UgdHlwaWNhbGx5IGNvbnNpZGVyIFwicGF5bG9hZCBub2lzZVwiLlxuICByZXR1cm4gKFxuICAgIGVzdGltYXRlQnl0ZXMoZXZlbnQuZGF0YSkgK1xuICAgIGVzdGltYXRlQnl0ZXMoZXZlbnQuYXR0cmlidXRlcykgK1xuICAgIGVzdGltYXRlQnl0ZXMoZXZlbnQubWV0YWRhdGEpICtcbiAgICBlc3RpbWF0ZUJ5dGVzKGV2ZW50LmNvbnRleHQpICtcbiAgICBlc3RpbWF0ZUJ5dGVzKGV2ZW50LmFjdG9yKVxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlOb2lzZVJlZHVjdGlvbihcbiAgaW5wdXRFdmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBjZmc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnXG4pOiBOb2lzZVJlZHVjdGlvblJlc3VsdCB7XG4gIGNvbnN0IHN0YXRzOiBOb2lzZVN0YXRzID0ge1xuICAgIGRyb3BwZWQ6IDAsXG4gICAgZm9sZGVkOiAwLFxuICAgIGFnZ3JlZ2F0ZWQ6IDAsXG4gICAgZG93bmdyYWRlZDogMCxcbiAgICBrZXB0OiAwLFxuICAgIGFwcHJveEJ5dGVzU2F2ZWQ6IDAsXG4gICAgZHJvcHBlZEJ5VHlwZToge30sXG4gICAgZHJvcHBlZEJ5T3BlcmF0aW9uOiB7fSxcbiAgICBmb2xkZWRCeVR5cGU6IHt9LFxuICAgIGZvbGRlZEJ5T3BlcmF0aW9uOiB7fSxcbiAgfTtcblxuICBpZiAoIWNmZy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHsgZXZlbnRzOiBpbnB1dEV2ZW50cywgc3RhdHM6IHsgLi4uc3RhdHMsIGtlcHQ6IGlucHV0RXZlbnRzLmxlbmd0aCB9IH07XG4gIH1cblxuICAvLyBJbmRleCBzcGFucyBieSBpZCBmb3IgZm9sZGluZyArIHN1bW1hcmllcy5cbiAgY29uc3Qgc3BhbkJ5SWQgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUV2ZW50PigpO1xuICBjb25zdCBzcGFuU3RhcnRCeUlkID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlFdmVudD4oKTtcbiAgZm9yIChjb25zdCBlIG9mIGlucHV0RXZlbnRzKSB7XG4gICAgaWYgKGUudHlwZSA9PT0gJ3NwYW4nICYmIGUub2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICBzcGFuQnlJZC5zZXQoZS5vYnNlcnZhYmlsaXR5TG9nSWQsIGUpO1xuICAgIH1cbiAgICBpZiAoZS50eXBlID09PSAnc3Bhbi5zdGFydCcgJiYgZS5vYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICAgIHNwYW5TdGFydEJ5SWQuc2V0KGUub2JzZXJ2YWJpbGl0eUxvZ0lkLCBlKTtcbiAgICB9XG4gIH1cblxuICAvLyBJZiB3ZSBkZWNpZGUgdG8gRFJPUCBhIGNvbnNvbGlkYXRlZCBzcGFuIHJlY29yZCwgd2UgbXVzdCBhbHNvIERST1AgaXRzIE9URUwtb25seSBzcGFuLnN0YXJ0LFxuICAvLyBvdGhlcndpc2UgT1RFTCBiYWNrZW5kIHdpbGwgY3JlYXRlIHRoZSBzcGFuIGFuZCBsYXRlciBcIm9ycGhhbi1lbmRcIiBpdCBpbiBmbHVzaCgpLCB3aGljaCBpcyBwdXJlIG5vaXNlLlxuICBjb25zdCBzcGFuRGVjaXNpb25CeUlkID0gbmV3IE1hcDxzdHJpbmcsIE5vaXNlRGVjaXNpb24+KCk7XG4gIGZvciAoY29uc3QgZSBvZiBpbnB1dEV2ZW50cykge1xuICAgIGlmIChlLnR5cGUgIT09ICdzcGFuJykgY29udGludWU7XG4gICAgY29uc3QgcGlja2VkID0gcGlja05vaXNlRGVjaXNpb24oZSwgY2ZnKTtcbiAgICBjb25zdCBpc0hhcmRTaWduYWwgPSBlLmxldmVsID09PSAnZXJyb3InXG4gICAgICB8fCBlLmxldmVsID09PSAnY3JpdGljYWwnXG4gICAgICB8fCBlLnN1Y2Nlc3MgPT09IGZhbHNlXG4gICAgICB8fCAhIWUuZXJyb3I7XG4gICAgY29uc3QgZmluYWxEZWNpc2lvbjogTm9pc2VEZWNpc2lvbiA9IChpc0hhcmRTaWduYWwgJiYgIWUuY2FwdHVyZT8ubm9pc2UpID8gJ2tlZXAnIDogcGlja2VkLmRlY2lzaW9uO1xuICAgIHNwYW5EZWNpc2lvbkJ5SWQuc2V0KGUub2JzZXJ2YWJpbGl0eUxvZ0lkLCBmaW5hbERlY2lzaW9uKTtcbiAgfVxuXG4gIC8vIEFnZ3JlZ2F0ZSBkcm9wcGVkL2ZvbGRlZC9hZ2dyZWdhdGVkIGNvdW50cyBieSBwYXJlbnQgc3BhbiBpZCAoKyBydWxlIHN0YXRzICsgYnl0ZXMgc2F2ZWQpLlxuICB0eXBlIFBhcmVudFN1bW1hcnkgPSB7XG4gICAgZHJvcHBlZDogbnVtYmVyO1xuICAgIGZvbGRlZDogbnVtYmVyO1xuICAgIGFnZ3JlZ2F0ZWQ6IG51bWJlcjtcbiAgICBieU9wOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgIGJ5VHlwZTogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgICBieVJ1bGVJZDogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgICBhcHByb3hCeXRlc1NhdmVkOiBudW1iZXI7XG4gIH07XG4gIGNvbnN0IHBlclBhcmVudFN1bW1hcnkgPSBuZXcgTWFwPHN0cmluZywgUGFyZW50U3VtbWFyeT4oKTtcbiAgY29uc3QgZ2V0UGFyZW50QWdnID0gKHBhcmVudElkOiBzdHJpbmcpID0+IHtcbiAgICBjb25zdCBleGlzdGluZyA9IHBlclBhcmVudFN1bW1hcnkuZ2V0KHBhcmVudElkKTtcbiAgICBpZiAoZXhpc3RpbmcpIHJldHVybiBleGlzdGluZztcbiAgICBjb25zdCBjcmVhdGVkOiBQYXJlbnRTdW1tYXJ5ID0geyBkcm9wcGVkOiAwLCBmb2xkZWQ6IDAsIGFnZ3JlZ2F0ZWQ6IDAsIGJ5T3A6IHt9LCBieVR5cGU6IHt9LCBieVJ1bGVJZDoge30sIGFwcHJveEJ5dGVzU2F2ZWQ6IDAgfTtcbiAgICBwZXJQYXJlbnRTdW1tYXJ5LnNldChwYXJlbnRJZCwgY3JlYXRlZCk7XG4gICAgcmV0dXJuIGNyZWF0ZWQ7XG4gIH07XG5cbiAgY29uc3Qgb3V0cHV0OiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZXZlbnQgb2YgaW5wdXRFdmVudHMpIHtcbiAgICBjb25zdCBwaWNrZWQgPSBwaWNrTm9pc2VEZWNpc2lvbihldmVudCwgY2ZnKTtcbiAgICBjb25zdCBkZWNpc2lvbiA9IHBpY2tlZC5kZWNpc2lvbjtcbiAgICBjb25zdCB7IGluY2x1ZGVEZWJ1Z01ldGFkYXRhIH0gPSBnZXRCb3VuZHMoY2ZnKTtcblxuICAgIC8vIEtlZXAvZHJvcCBzcGFuLnN0YXJ0IGJhc2VkIG9uIHRoZSBmaW5hbCBkZWNpc2lvbiBmb3IgaXRzIGNvbnNvbGlkYXRlZCBzcGFuIHJlY29yZC5cbiAgICAvLyBUaGlzIHByZXNlcnZlcyBPVEVMIGNvcnJlY3RuZXNzIGFuZCByZWR1Y2VzIG5vaXNlIChubyBvcnBoYW5lZCBPVEVMIHNwYW5zKS5cbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnKSB7XG4gICAgICBjb25zdCBzcGFuRGVjaXNpb24gPSBzcGFuRGVjaXNpb25CeUlkLmdldChldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgLy8gSWYgd2UgYXJlIG5vdCBlbWl0dGluZyB0aGUgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkIChkcm9wL2FnZ3JlZ2F0ZSksIHdlIHNob3VsZCBub3QgZW1pdCBzcGFuLnN0YXJ0IGVpdGhlci5cbiAgICAgIGlmIChzcGFuRGVjaXNpb24gPT09ICdkcm9wJyB8fCBzcGFuRGVjaXNpb24gPT09ICdhZ2dyZWdhdGUnKSB7XG4gICAgICAgIHN0YXRzLmRyb3BwZWQrKztcbiAgICAgICAgaW5jKHN0YXRzLmRyb3BwZWRCeVR5cGUsIGV2ZW50LnR5cGUpO1xuICAgICAgICBpbmMoc3RhdHMuZHJvcHBlZEJ5T3BlcmF0aW9uLCBldmVudC5vcGVyYXRpb24pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIERlZmF1bHQga2VlcCBmb3Igc3Bhbi5zdGFydCAoT1RFTC1vbmx5KSBpZiB0aGUgc3BhbiBpdHNlbGYgaXMga2VwdC5cbiAgICAgIG91dHB1dC5wdXNoKGV2ZW50KTtcbiAgICAgIHN0YXRzLmtlcHQrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE5PSVNFIFJFRFVDVElPTiBERUNJU0lPTiBIQU5ETElOR1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERlY2lzaW9ucyBhcmUgYXBwbGllZCBpbiB0aGlzIG9yZGVyOlxuICAgIC8vIDEuIEhhcmQgc2lnbmFscyAoZXJyb3JzL2ZhaWx1cmVzKSDihpIgQUxXQVlTIGtlcHQgKHVubGVzcyBleHBsaWNpdGx5IG92ZXJyaWRkZW4pXG4gICAgLy8gMi4ga2VlcCDihpIgRXZlbnQgcGFzc2VzIHRocm91Z2ggdW5jaGFuZ2VkXG4gICAgLy8gMy4gZm9sZCDihpIgRXZlbnQgY29sbGFwc2VkIGludG8gcGFyZW50IHNwYW4gYXMgYSBjaGVja3BvaW50IChjaGlsZCBldmVudHMgb25seSlcbiAgICAvLyA0LiBkcm9wIOKGkiBFdmVudCByZW1vdmVkIGVudGlyZWx5ICh3b3JrcyBmb3Igcm9vdCBvciBjaGlsZClcbiAgICAvLyA1LiBhZ2dyZWdhdGUg4oaSIEV2ZW50IHN1bW1hcml6ZWQgaW50byBwYXJlbnQgc3BhbiAoY2hpbGQgZXZlbnRzIG9ubHkpXG4gICAgLy8gNi4gZG93bmdyYWRlIOKGkiBFdmVudCBrZXB0IGJ1dCBzdHJpcHBlZCBvZiBoZWF2eSBmaWVsZHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIE5ldmVyIGRyb3AgZXJyb3JzL2NyaXRpY2FsIG91dHJpZ2h0IChwb2xpY3kgc2FmZXR5IG5ldCkuIFVzZXJzIGNhbiBzdGlsbCBmb3JjZSBkcm9wIHZpYSBvdmVycmlkZS5cbiAgICBjb25zdCBpc0hhcmRTaWduYWwgPSBldmVudC5sZXZlbCA9PT0gJ2Vycm9yJyB8fCBldmVudC5sZXZlbCA9PT0gJ2NyaXRpY2FsJyB8fCBldmVudC5zdWNjZXNzID09PSBmYWxzZSB8fCAhIWV2ZW50LmVycm9yO1xuICAgIGlmIChpc0hhcmRTaWduYWwgJiYgIWV2ZW50LmNhcHR1cmU/Lm5vaXNlKSB7XG4gICAgICBvdXRwdXQucHVzaChldmVudCk7XG4gICAgICBzdGF0cy5rZXB0Kys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoZGVjaXNpb24gPT09ICdrZWVwJykge1xuICAgICAgb3V0cHV0LnB1c2goZXZlbnQpO1xuICAgICAgc3RhdHMua2VwdCsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgcGFyZW50SWQgPSBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgIGNvbnN0IHBhcmVudFNwYW4gPSBwYXJlbnRJZCA/IHNwYW5CeUlkLmdldChwYXJlbnRJZCkgOiB1bmRlZmluZWQ7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBGT0xEOiBDb2xsYXBzZSBldmVudCBpbnRvIHBhcmVudCBhcyBjaGVja3BvaW50IChjaGlsZCBldmVudHMgb25seSlcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBpZiAoZGVjaXNpb24gPT09ICdmb2xkJyAmJiBwYXJlbnRTcGFuKSB7XG4gICAgICAvLyBQcmVzZXJ2ZSBFTUYvT1RFTCBtZXRyaWNzIHdpdGhvdXQga2VlcGluZyB0aGUgbm9pc3kgc3RhbmRhbG9uZSBldmVudC5cbiAgICAgIGlmIChldmVudC5tZXRyaWNzICYmIE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgcGFyZW50TWV0cmljczogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHBhcmVudFNwYW4ubWV0cmljcyA/PyB7fTtcbiAgICAgICAgY29uc3QgbWVyZ2VkOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0geyAuLi5wYXJlbnRNZXRyaWNzIH07XG4gICAgICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQubWV0cmljcykpIHtcbiAgICAgICAgICBtZXJnZWRbIGsgXSA9IChtZXJnZWRbIGsgXSA/PyAwKSArIHY7XG4gICAgICAgIH1cbiAgICAgICAgcGFyZW50U3Bhbi5tZXRyaWNzID0gbWVyZ2VkO1xuICAgICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChwYXJlbnRTcGFuLCBjZmcsIHtcbiAgICAgICAgICBuYW1lOiBgbWV0cmljcy5mb2xkZWQ6JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX1gLFxuICAgICAgICAgIHRzOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgICAgICBtZXRyaWNzOiB7IC4uLmV2ZW50Lm1ldHJpY3MgfSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEZvbGQgcmVwcmVzZW50YXRpb246IGFkZCBhIHNpbmdsZSBzdHJ1Y3R1cmVkIGNoZWNrcG9pbnQgb250byB0aGUgcGFyZW50IHNwYW4uXG4gICAgICAvLyBDaGVja3BvaW50IGlzIEFMV0FZUyBjcmVhdGVkIChjb3JlIGRlc2lnbiksIGJ1dCBkYXRhIHBheWxvYWQgaXMgbWluaW1hbCBpbiBwcm9kdWN0aW9uLlxuICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQocGFyZW50U3BhbiwgY2ZnLCB7XG4gICAgICAgIG5hbWU6IGBmb2xkOiR7ZXZlbnQudHlwZX06JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX1gLFxuICAgICAgICB0czogZXZlbnQudGltZXN0YW1wTXMsXG4gICAgICAgIHRhZ3M6IHtcbiAgICAgICAgICBmb2xkZWRUeXBlOiBldmVudC50eXBlLFxuICAgICAgICAgIGxldmVsOiBldmVudC5sZXZlbCxcbiAgICAgICAgICAuLi4oZXZlbnQuZW50aXR5TmFtZSA/IHsgZW50aXR5TmFtZTogZXZlbnQuZW50aXR5TmFtZSB9IDoge30pLFxuICAgICAgICB9LFxuICAgICAgICAvLyBPbmx5IGluY2x1ZGUgZGVidWcgbWV0YWRhdGEgaWYgZmxhZyBpcyBlbmFibGVkXG4gICAgICAgIC4uLihpbmNsdWRlRGVidWdNZXRhZGF0YSA/IHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAuLi4oZXZlbnQuZW50aXR5SWQgPyB7IGVudGl0eUlkOiBldmVudC5lbnRpdHlJZCB9IDoge30pLFxuICAgICAgICAgICAgLi4uKGV2ZW50LnNvdXJjZSA/IHsgc291cmNlOiBldmVudC5zb3VyY2UgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihwaWNrZWQucnVsZUlkID8geyBydWxlSWQ6IHBpY2tlZC5ydWxlSWQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihwaWNrZWQucmVhc29uID8geyByZWFzb246IHBpY2tlZC5yZWFzb24gfSA6IHt9KSxcbiAgICAgICAgICB9LFxuICAgICAgICB9IDoge30pLFxuICAgICAgICAuLi4oZXZlbnQuZXJyb3IgPyB7IGVycm9yOiBldmVudC5lcnJvciB9IDoge30pLFxuICAgICAgfSk7XG5cbiAgICAgIHN0YXRzLmZvbGRlZCsrO1xuICAgICAgaW5jKHN0YXRzLmZvbGRlZEJ5VHlwZSwgZXZlbnQudHlwZSk7XG4gICAgICBpbmMoc3RhdHMuZm9sZGVkQnlPcGVyYXRpb24sIGV2ZW50Lm9wZXJhdGlvbik7XG5cbiAgICAgIGNvbnN0IGFnZyA9IGdldFBhcmVudEFnZyhwYXJlbnRJZCEpO1xuICAgICAgYWdnLmZvbGRlZCsrO1xuICAgICAgaW5jKGFnZy5ieVR5cGUsIGV2ZW50LnR5cGUpO1xuICAgICAgaW5jKGFnZy5ieU9wLCBldmVudC5vcGVyYXRpb24pO1xuICAgICAgaWYgKGluY2x1ZGVEZWJ1Z01ldGFkYXRhICYmIHBpY2tlZC5ydWxlSWQpIHtcbiAgICAgICAgYWdnLmJ5UnVsZUlkWyBwaWNrZWQucnVsZUlkIF0gPSAoYWdnLmJ5UnVsZUlkWyBwaWNrZWQucnVsZUlkIF0gPz8gMCkgKyAxO1xuICAgICAgfVxuICAgICAgaWYgKGluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgIGNvbnN0IHNhdmVkID0gZXN0aW1hdGVFdmVudEhlYXZ5Qnl0ZXMoZXZlbnQpO1xuICAgICAgICBhZ2cuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgICAgc3RhdHMuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERST1A6IFJlbW92ZSBldmVudCBlbnRpcmVseSAod29ya3MgZm9yIHJvb3Qgb3IgY2hpbGQgZXZlbnRzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGlmIChkZWNpc2lvbiA9PT0gJ2Ryb3AnKSB7XG4gICAgICBzdGF0cy5kcm9wcGVkKys7XG4gICAgICBpbmMoc3RhdHMuZHJvcHBlZEJ5VHlwZSwgZXZlbnQudHlwZSk7XG4gICAgICBpbmMoc3RhdHMuZHJvcHBlZEJ5T3BlcmF0aW9uLCBldmVudC5vcGVyYXRpb24pO1xuXG4gICAgICAvLyBJZiBldmVudCBoYXMgYSBwYXJlbnQsIHByZXNlcnZlIGl0cyBtZXRyaWNzIGFuZCB1cGRhdGUgcGFyZW50J3Mgbm9pc2Ugc3VtbWFyeVxuICAgICAgaWYgKHBhcmVudFNwYW4gJiYgcGFyZW50SWQpIHtcbiAgICAgICAgLy8gUHJlc2VydmUgbWV0cmljcyBpbiBwYXJlbnQgc3BhblxuICAgICAgICBpZiAoZXZlbnQubWV0cmljcyAmJiBPYmplY3Qua2V5cyhldmVudC5tZXRyaWNzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcGFyZW50U3Bhbi5tZXRyaWNzID0geyAuLi4ocGFyZW50U3Bhbi5tZXRyaWNzID8/IHt9KSwgLi4uZXZlbnQubWV0cmljcyB9O1xuICAgICAgICAgIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKHBhcmVudFNwYW4sIGNmZywge1xuICAgICAgICAgICAgbmFtZTogYG1ldHJpY3MuZm9sZGVkOiR7ZXZlbnQub3BlcmF0aW9uID8/IGV2ZW50LnR5cGV9YCxcbiAgICAgICAgICAgIHRzOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgICAgICAgIG1ldHJpY3M6IGV2ZW50Lm1ldHJpY3MsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVcGRhdGUgcGFyZW50J3Mgbm9pc2UgcmVkdWN0aW9uIHN1bW1hcnlcbiAgICAgICAgY29uc3QgYWdnID0gZ2V0UGFyZW50QWdnKHBhcmVudElkKTtcbiAgICAgICAgYWdnLmRyb3BwZWQrKztcbiAgICAgICAgaW5jKGFnZy5ieVR5cGUsIGV2ZW50LnR5cGUpO1xuICAgICAgICBpbmMoYWdnLmJ5T3AsIGV2ZW50Lm9wZXJhdGlvbik7XG4gICAgICAgIGlmIChpbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICAgIGlmIChwaWNrZWQucnVsZUlkKSBhZ2cuYnlSdWxlSWRbIHBpY2tlZC5ydWxlSWQgXSA9IChhZ2cuYnlSdWxlSWRbIHBpY2tlZC5ydWxlSWQgXSA/PyAwKSArIDE7XG4gICAgICAgICAgY29uc3Qgc2F2ZWQgPSBlc3RpbWF0ZUV2ZW50SGVhdnlCeXRlcyhldmVudCk7XG4gICAgICAgICAgYWdnLmFwcHJveEJ5dGVzU2F2ZWQgKz0gc2F2ZWQ7XG4gICAgICAgICAgc3RhdHMuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29udGludWU7IC8vIEV2ZW50IGlzIGRyb3BwZWQgLSBza2lwIHRvIG5leHRcbiAgICB9XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBR0dSRUdBVEU6IFN1bW1hcml6ZSBldmVudCBpbnRvIHBhcmVudCAoY2hpbGQgZXZlbnRzIG9ubHkpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgaWYgKGRlY2lzaW9uID09PSAnYWdncmVnYXRlJykge1xuICAgICAgaWYgKCFwYXJlbnRTcGFuKSB7XG4gICAgICAgIC8vIENhbid0IGFnZ3JlZ2F0ZSB3aXRob3V0IGEgcGFyZW50IC0ga2VlcCB0aGUgZXZlbnRcbiAgICAgICAgb3V0cHV0LnB1c2goZXZlbnQpO1xuICAgICAgICBzdGF0cy5rZXB0Kys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBQcmVzZXJ2ZSBtZXRyaWNzIGluIHBhcmVudCBzcGFuXG4gICAgICBpZiAoZXZlbnQubWV0cmljcyAmJiBPYmplY3Qua2V5cyhldmVudC5tZXRyaWNzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhcmVudFNwYW4ubWV0cmljcyA9IHsgLi4uKHBhcmVudFNwYW4ubWV0cmljcyA/PyB7fSksIC4uLmV2ZW50Lm1ldHJpY3MgfTtcbiAgICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQocGFyZW50U3BhbiwgY2ZnLCB7XG4gICAgICAgICAgbmFtZTogYG1ldHJpY3MuZm9sZGVkOiR7ZXZlbnQub3BlcmF0aW9uID8/IGV2ZW50LnR5cGV9YCxcbiAgICAgICAgICB0czogZXZlbnQudGltZXN0YW1wTXMsXG4gICAgICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEFnZ3JlZ2F0ZSBldmVudCBkZXRhaWxzIGludG8gcGFyZW50J3Mgc3VtbWFyeVxuICAgICAgY29uc3Qga2luZDogJ3NwYW4nIHwgJ2xvZycgfCAnYXVkaXQnIHwgJ21ldHJpYycgfCAnb3RoZXInID1cbiAgICAgICAgZXZlbnQudHlwZSA9PT0gJ3NwYW4nID8gJ3NwYW4nXG4gICAgICAgICAgOiBldmVudC50eXBlID09PSAnbG9nJyA/ICdsb2cnXG4gICAgICAgICAgICA6IGV2ZW50LnR5cGUuc3RhcnRzV2l0aCgnYXVkaXQnKSA/ICdhdWRpdCdcbiAgICAgICAgICAgICAgOiBldmVudC50eXBlID09PSAnbWV0cmljJyA/ICdtZXRyaWMnXG4gICAgICAgICAgICAgICAgOiAnb3RoZXInO1xuICAgICAgYWdncmVnYXRlSW50b1BhcmVudChwYXJlbnRTcGFuLCBjZmcsIGV2ZW50LCBraW5kLCB7IHJ1bGVJZDogcGlja2VkLnJ1bGVJZCwgcmVhc29uOiBwaWNrZWQucmVhc29uIH0pO1xuXG4gICAgICAvLyBBZGQgY2hlY2twb2ludCBmb3IgdGltZWxpbmUgdHJhY2tpbmdcbiAgICAgIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKHBhcmVudFNwYW4sIGNmZywge1xuICAgICAgICBuYW1lOiBgYWdncmVnYXRlOiR7ZXZlbnQudHlwZX06JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX1gLFxuICAgICAgICB0czogZXZlbnQudGltZXN0YW1wTXMsXG4gICAgICAgIC4uLihpbmNsdWRlRGVidWdNZXRhZGF0YSA/IHtcbiAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAuLi4ocGlja2VkLnJ1bGVJZCA/IHsgcnVsZUlkOiBwaWNrZWQucnVsZUlkIH0gOiB7fSksXG4gICAgICAgICAgICAuLi4ocGlja2VkLnJlYXNvbiA/IHsgcmVhc29uOiBwaWNrZWQucmVhc29uIH0gOiB7fSksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSA6IHt9KSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBVcGRhdGUgc3RhdHNcbiAgICAgIHN0YXRzLmFnZ3JlZ2F0ZWQrKztcbiAgICAgIGNvbnN0IGFnZyA9IGdldFBhcmVudEFnZyhwYXJlbnRJZCEpO1xuICAgICAgYWdnLmFnZ3JlZ2F0ZWQrKztcbiAgICAgIGluYyhhZ2cuYnlUeXBlLCBldmVudC50eXBlKTtcbiAgICAgIGluYyhhZ2cuYnlPcCwgZXZlbnQub3BlcmF0aW9uKTtcbiAgICAgIGlmIChpbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICBpZiAocGlja2VkLnJ1bGVJZCkgYWdnLmJ5UnVsZUlkWyBwaWNrZWQucnVsZUlkIF0gPSAoYWdnLmJ5UnVsZUlkWyBwaWNrZWQucnVsZUlkIF0gPz8gMCkgKyAxO1xuICAgICAgICBjb25zdCBzYXZlZCA9IGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKGV2ZW50KTtcbiAgICAgICAgYWdnLmFwcHJveEJ5dGVzU2F2ZWQgKz0gc2F2ZWQ7XG4gICAgICAgIHN0YXRzLmFwcHJveEJ5dGVzU2F2ZWQgKz0gc2F2ZWQ7XG4gICAgICB9XG4gICAgICBjb250aW51ZTsgLy8gRXZlbnQgaXMgYWdncmVnYXRlZCAtIHNraXAgdG8gbmV4dFxuICAgIH1cblxuICAgIGlmIChkZWNpc2lvbiA9PT0gJ2Rvd25ncmFkZScpIHtcbiAgICAgIC8vIEtlZXAgdGhlIGV2ZW50LCBidXQgc3RyaXAgaGVhdnkgcGF5bG9hZCBmaWVsZHMgdG8gcmVkdWNlIER5bmFtby9DbG91ZFdhdGNoIG5vaXNlLlxuICAgICAgLy8gKEhhcmQgc2lnbmFscyB3ZXJlIGFscmVhZHkgaGFuZGxlZCBlYXJsaWVyLilcbiAgICAgIGNvbnN0IHVuaXQgPSBpc1JlY29yZChldmVudC5hdHRyaWJ1dGVzKSAmJiB0eXBlb2YgZXZlbnQuYXR0cmlidXRlcy51bml0ID09PSAnc3RyaW5nJ1xuICAgICAgICA/IGV2ZW50LmF0dHJpYnV0ZXMudW5pdFxuICAgICAgICA6IHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgZG93bmdyYWRlZDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0ge1xuICAgICAgICAuLi5ldmVudCxcbiAgICAgICAgZGF0YTogdW5kZWZpbmVkLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgbm9pc2VSZWR1Y2VkOiAnZG93bmdyYWRlZCcsXG4gICAgICAgICAgLi4uKHVuaXQgPyB7IHVuaXQgfSA6IHt9KSxcbiAgICAgICAgfSxcbiAgICAgICAgbWV0YWRhdGE6IHVuZGVmaW5lZCxcbiAgICAgICAgY29udGV4dDogdW5kZWZpbmVkLFxuICAgICAgICAvLyBrZWVwIGFjdG9yIG1pbmltYWwgaWYgcHJlc2VudFxuICAgICAgICBhY3RvcjogZXZlbnQuYWN0b3IgPyB7XG4gICAgICAgICAgcmVxdWVzdElkOiBldmVudC5hY3Rvci5yZXF1ZXN0SWQsXG4gICAgICAgICAgdGltZXN0YW1wOiBldmVudC5hY3Rvci50aW1lc3RhbXAsXG4gICAgICAgICAgYWN0b3JJZDogZXZlbnQuYWN0b3IuYWN0b3JJZCxcbiAgICAgICAgICBhY3RvclR5cGU6IGV2ZW50LmFjdG9yLmFjdG9yVHlwZSxcbiAgICAgICAgICB0ZW5hbnRJZDogZXZlbnQuYWN0b3IudGVuYW50SWQsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogZXZlbnQuYWN0b3IuY29ycmVsYXRpb25JZCxcbiAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgICBvdXRwdXQucHVzaChkb3duZ3JhZGVkKTtcbiAgICAgIHN0YXRzLmRvd25ncmFkZWQrKztcbiAgICAgIHN0YXRzLmtlcHQrKztcbiAgICAgIGlmIChpbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICAvLyBBcHByb3ggYnl0ZXMgc2F2ZWQgPSBoZWF2eSBieXRlcyByZW1vdmVkIGZyb20gdGhlIGV2ZW50LlxuICAgICAgICBjb25zdCBzYXZlZCA9IGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKGV2ZW50KTtcbiAgICAgICAgc3RhdHMuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIElmIHdlIGNhbid0IGZvbGQvZHJvcCBzYWZlbHkgKG5vIHBhcmVudCBzcGFuKSwga2VlcCBpdC5cbiAgICBvdXRwdXQucHVzaChldmVudCk7XG4gICAgc3RhdHMua2VwdCsrO1xuICB9XG5cbiAgLy8gQXR0YWNoIHBlci1wYXJlbnQgc3VtbWFyeSBwYXlsb2FkcyAoc21hbGwsIFVJLXZpc2libGUpIGFuZCBhIG1hcmtlciBjaGVja3BvaW50LlxuICBpZiAoY2ZnLmVtaXRTdW1tYXJpZXMgIT09IGZhbHNlKSB7XG4gICAgZm9yIChjb25zdCBbIHBhcmVudElkLCBzdW1tYXJ5IF0gb2YgcGVyUGFyZW50U3VtbWFyeS5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IHBhcmVudCA9IHNwYW5CeUlkLmdldChwYXJlbnRJZCk7XG4gICAgICBpZiAoIXBhcmVudCkgY29udGludWU7XG4gICAgICBjb25zdCBkYXRhID0gZW5zdXJlU3BhbkRhdGEocGFyZW50KTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gaXNSZWNvcmQoZGF0YS5ub2lzZVJlZHVjdGlvbikgPyBkYXRhLm5vaXNlUmVkdWN0aW9uIDoge307XG4gICAgICAvLyBBbHdheXMgaW5jbHVkZSBiYXNpYyBjb3VudHNcbiAgICAgIGV4aXN0aW5nLmRyb3BwZWQgPSBzdW1tYXJ5LmRyb3BwZWQ7XG4gICAgICBleGlzdGluZy5mb2xkZWQgPSBzdW1tYXJ5LmZvbGRlZDtcbiAgICAgIGV4aXN0aW5nLmFnZ3JlZ2F0ZWQgPSBzdW1tYXJ5LmFnZ3JlZ2F0ZWQ7XG4gICAgICAvLyBBbHdheXMgaW5jbHVkZSB0eXBlIGJyZWFrZG93biAobWluaW1hbCBvdmVyaGVhZCwgaGlnaCB2YWx1ZSlcbiAgICAgIGV4aXN0aW5nLmJ5VHlwZSA9IHN1bW1hcnkuYnlUeXBlO1xuXG4gICAgICAvLyBEZWJ1ZyBtZXRhZGF0YTogZGV0YWlsZWQgYnJlYWtkb3duc1xuICAgICAgaWYgKGdldEJvdW5kcyhjZmcpLmluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgIGV4aXN0aW5nLmJ5UnVsZUlkID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHN1bW1hcnkuYnlSdWxlSWQpXG4gICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYlsgMSBdIC0gYVsgMSBdKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgICApO1xuICAgICAgICBleGlzdGluZy5hcHByb3hCeXRlc1NhdmVkID0gc3VtbWFyeS5hcHByb3hCeXRlc1NhdmVkO1xuICAgICAgICAvLyBLZWVwIG9wIHN1bW1hcnkgYm91bmRlZCAodG9wIDEwKVxuICAgICAgICBleGlzdGluZy5ieU9wZXJhdGlvbiA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgICAgICBPYmplY3QuZW50cmllcyhzdW1tYXJ5LmJ5T3ApXG4gICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYlsgMSBdIC0gYVsgMSBdKVxuICAgICAgICAgICAgLnNsaWNlKDAsIDEwKVxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgZGF0YS5ub2lzZVJlZHVjdGlvbiA9IGV4aXN0aW5nO1xuICAgICAgLy8gQWx3YXlzIGFkZCBzdW1tYXJ5IGNoZWNrcG9pbnQgKGNvcmUgZGVzaWduKVxuICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQocGFyZW50LCBjZmcsIHsgbmFtZTogJ25vaXNlUmVkdWN0aW9uLnN1bW1hcnknLCB0czogRGF0ZS5ub3coKSB9KTtcbiAgICB9XG4gIH1cblxuICAvLyA9PT0gSGllcmFyY2h5IGludGVncml0eSAvIGFjY291bnRpbmcgaW50ZWdyaXR5IChjbG9zdXJlKSA9PT1cbiAgLy9cbiAgLy8gSWYgd2UgZW1pdHRlZCBhbnkgZXZlbnQgKG9yIGFueSBub2lzZSBzdW1tYXJ5KSB0aGF0IHJlbGllcyBvbiBwYXJlbnQgc3BhbiBQLFxuICAvLyB0aGVuIFAgbXVzdCBhbHNvIGV4aXN0IGluIHRoZSBmaW5hbCBvdXRwdXQgdG8gYXZvaWQgVUkgNDA0cyBhbmQgdG8gcHJlc2VydmUgYWNjb3VudGluZy5cbiAgLy8gVGhpcyBhbHNvIGFwcGxpZXMgdG8gT1RFTDogaWYgd2UgZm9yY2Uta2VlcCBhIGNvbnNvbGlkYXRlZCBzcGFuLCB3ZSBzaG91bGQgYWxzbyBrZWVwIGl0cyBzcGFuLnN0YXJ0IHdoZW4gcHJlc2VudC5cbiAgY29uc3Qgb3V0cHV0U3BhbklkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBvdXRwdXRCeUlkID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlFdmVudFtdPigpO1xuICBmb3IgKGNvbnN0IGUgb2Ygb3V0cHV0KSB7XG4gICAgY29uc3QgbGlzdCA9IG91dHB1dEJ5SWQuZ2V0KGUub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICBpZiAobGlzdCkgbGlzdC5wdXNoKGUpO1xuICAgIGVsc2Ugb3V0cHV0QnlJZC5zZXQoZS5vYnNlcnZhYmlsaXR5TG9nSWQsIFsgZSBdKTtcbiAgICBpZiAoZS50eXBlID09PSAnc3BhbicpIG91dHB1dFNwYW5JZHMuYWRkKGUub2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgfVxuXG4gIC8vID09PSBSRVBBUkVOVCBPUlBIQU5FRCBDSElMRFJFTiA9PT1cbiAgLy8gSWYgYSBjaGlsZCdzIHBhcmVudCB3YXMgZHJvcHBlZC9hZ2dyZWdhdGVkLCByZXBhcmVudCBpdCB0byB0aGUgbmVhcmVzdCBrZXB0IGFuY2VzdG9yLlxuICAvLyBUaGlzIHByZXZlbnRzIFwicGFyZW50IG5vdCBmb3VuZFwiIGVycm9ycyBpbiB0aGUgVUkuXG4gIC8vIFRyYWNrIGJ5cGFzc2VkIHBhcmVudHMgc28gaGllcmFyY2h5IGludGVncml0eSBkb2Vzbid0IGZvcmNlLWtlZXAgdGhlbS5cbiAgY29uc3QgYnlwYXNzZWRQYXJlbnRzID0gbmV3IFNldDxzdHJpbmc+KCk7IC8vIFBhcmVudHMgdGhhdCB3ZXJlIGJ5cGFzc2VkIGR1cmluZyByZXBhcmVudGluZ1xuXG4gIGNvbnN0IGZpbmRLZXB0QW5jZXN0b3IgPSAocGFyZW50SWQ6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwsIHZpc2l0ZWQ6IFNldDxzdHJpbmc+ID0gbmV3IFNldCgpKTogc3RyaW5nIHwgdW5kZWZpbmVkID0+IHtcbiAgICBpZiAoIXBhcmVudElkKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgLy8gSWYgcGFyZW50IGlzIGluIG91dHB1dCwgdXNlIGl0XG4gICAgaWYgKG91dHB1dFNwYW5JZHMuaGFzKHBhcmVudElkKSkgcmV0dXJuIHBhcmVudElkO1xuXG4gICAgLy8gUHJldmVudCBpbmZpbml0ZSBsb29wc1xuICAgIGlmICh2aXNpdGVkLmhhcyhwYXJlbnRJZCkpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgdmlzaXRlZC5hZGQocGFyZW50SWQpO1xuXG4gICAgLy8gUGFyZW50IHdhcyBkcm9wcGVkIC0gcmVjdXJzaXZlbHkgZmluZCBpdHMga2VwdCBhbmNlc3RvclxuICAgIGNvbnN0IHBhcmVudFNwYW4gPSBzcGFuQnlJZC5nZXQocGFyZW50SWQpO1xuICAgIGlmICghcGFyZW50U3BhbikgcmV0dXJuIHVuZGVmaW5lZDsgLy8gUGFyZW50IG5vdCBpbiB0aGlzIGJhdGNoLCBubyByZXBhcmVudGluZyBwb3NzaWJsZVxuXG4gICAgLy8gTWFyayB0aGlzIHBhcmVudCBhcyBieXBhc3NlZFxuICAgIGJ5cGFzc2VkUGFyZW50cy5hZGQocGFyZW50SWQpO1xuXG4gICAgcmV0dXJuIGZpbmRLZXB0QW5jZXN0b3IocGFyZW50U3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkLCB2aXNpdGVkKTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IGUgb2Ygb3V0cHV0KSB7XG4gICAgY29uc3Qgb3JpZ2luYWxQYXJlbnRJZCA9IGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZDtcbiAgICBpZiAoIW9yaWdpbmFsUGFyZW50SWQpIGNvbnRpbnVlOyAvLyBSb290IGV2ZW50LCBubyBwYXJlbnRcblxuICAgIC8vIElmIHBhcmVudCBleGlzdHMgaW4gb3V0cHV0LCBubyByZXBhcmVudGluZyBuZWVkZWRcbiAgICBpZiAob3V0cHV0U3Bhbklkcy5oYXMob3JpZ2luYWxQYXJlbnRJZCkpIGNvbnRpbnVlO1xuXG4gICAgLy8gUGFyZW50IHdhcyBkcm9wcGVkIC0gZmluZCBuZWFyZXN0IGtlcHQgYW5jZXN0b3JcbiAgICBjb25zdCBrZXB0QW5jZXN0b3JJZCA9IGZpbmRLZXB0QW5jZXN0b3Iob3JpZ2luYWxQYXJlbnRJZCk7XG5cbiAgICBpZiAoa2VwdEFuY2VzdG9ySWQgJiYga2VwdEFuY2VzdG9ySWQgIT09IG9yaWdpbmFsUGFyZW50SWQpIHtcbiAgICAgIC8vIFJlcGFyZW50IHRvIGtlcHQgYW5jZXN0b3JcbiAgICAgIGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0ga2VwdEFuY2VzdG9ySWQ7XG5cbiAgICAgIC8vIEFkZCBkZWJ1ZyBjaGVja3BvaW50IGlmIGVuYWJsZWRcbiAgICAgIGlmIChnZXRCb3VuZHMoY2ZnKS5pbmNsdWRlRGVidWdNZXRhZGF0YSkge1xuICAgICAgICBjb25zdCBkYXRhID0gKGUuZGF0YSB8fCB7fSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIGlmICghZGF0YS5jaGVja3BvaW50cykge1xuICAgICAgICAgIGRhdGEuY2hlY2twb2ludHMgPSBbXTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjaGVja3BvaW50cyA9IGRhdGEuY2hlY2twb2ludHMgYXMgQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgICBjaGVja3BvaW50cy5wdXNoKHtcbiAgICAgICAgICBuYW1lOiAnbm9pc2VSZWR1Y3Rpb24ucmVwYXJlbnRlZCcsXG4gICAgICAgICAgdHM6IERhdGUubm93KCksXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgb3JpZ2luYWxQYXJlbnQ6IG9yaWdpbmFsUGFyZW50SWQsXG4gICAgICAgICAgICBuZXdQYXJlbnQ6IGtlcHRBbmNlc3RvcklkLFxuICAgICAgICAgICAgcmVhc29uOiAnT3JpZ2luYWwgcGFyZW50IHdhcyBkcm9wcGVkIGJ5IG5vaXNlIHJlZHVjdGlvbidcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBlLmRhdGEgPSBkYXRhO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoIWtlcHRBbmNlc3RvcklkKSB7XG4gICAgICAvLyBObyBrZXB0IGFuY2VzdG9yIGZvdW5kIC0gdGhpcyBpcyBub3cgYSByb290IGV2ZW50XG4gICAgICBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKGdldEJvdW5kcyhjZmcpLmluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSAoZS5kYXRhIHx8IHt9KSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgaWYgKCFkYXRhLmNoZWNrcG9pbnRzKSB7XG4gICAgICAgICAgZGF0YS5jaGVja3BvaW50cyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGNoZWNrcG9pbnRzID0gZGF0YS5jaGVja3BvaW50cyBhcyBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICAgIGNoZWNrcG9pbnRzLnB1c2goe1xuICAgICAgICAgIG5hbWU6ICdub2lzZVJlZHVjdGlvbi5vcnBoYW5lZCcsXG4gICAgICAgICAgdHM6IERhdGUubm93KCksXG4gICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgb3JpZ2luYWxQYXJlbnQ6IG9yaWdpbmFsUGFyZW50SWQsXG4gICAgICAgICAgICByZWFzb246ICdPcmlnaW5hbCBwYXJlbnQgYW5kIGFsbCBhbmNlc3RvcnMgd2VyZSBkcm9wcGVkIGJ5IG5vaXNlIHJlZHVjdGlvbidcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBlLmRhdGEgPSBkYXRhO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHJlcXVpcmVkUGFyZW50cyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAvLyBQYXJlbnRzIHJlZmVyZW5jZWQgYnkgZW1pdHRlZCBldmVudHMgKGFmdGVyIHJlcGFyZW50aW5nKVxuICAvLyBFeGNsdWRlIGJ5cGFzc2VkIHBhcmVudHMgKHRoZXkgd2VyZSBpbnRlbnRpb25hbGx5IHNraXBwZWQgZHVyaW5nIHJlcGFyZW50aW5nKVxuICBmb3IgKGNvbnN0IGUgb2Ygb3V0cHV0KSB7XG4gICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgIGlmIChwaWQgJiYgIWJ5cGFzc2VkUGFyZW50cy5oYXMocGlkKSkge1xuICAgICAgcmVxdWlyZWRQYXJlbnRzLmFkZChwaWQpO1xuICAgIH1cbiAgfVxuICAvLyBQYXJlbnRzIHRoYXQgaGFkIHN1cHByZXNzaW9uIHVuZGVyIHRoZW0gKG5lZWQgdG8gZXhpc3Qgc28gc3VtbWFyaWVzL2NoZWNrcG9pbnRzIGFyZSB2aXNpYmxlKVxuICAvLyBCVVQ6IG9ubHkgaWYgdGhlIHBhcmVudCBzcGFuIGl0c2VsZiB3YXNuJ3QgZHJvcHBlZCBieSBhIG5vaXNlIHJlZHVjdGlvbiBydWxlLlxuICAvLyBJZiB0aGUgcGFyZW50IHNwYW4gbWF0Y2hlZCBhICdkcm9wJyBydWxlLCBkb24ndCBmb3JjZS1rZWVwIGl0IGp1c3QgYmVjYXVzZSBjaGlsZHJlbiB3ZXJlIGZvbGRlZCBpbnRvIGl0LlxuICBmb3IgKGNvbnN0IHBpZCBvZiBwZXJQYXJlbnRTdW1tYXJ5LmtleXMoKSkge1xuICAgIGNvbnN0IHBhcmVudFNwYW4gPSBzcGFuQnlJZC5nZXQocGlkKTtcbiAgICBpZiAoIXBhcmVudFNwYW4pIHtcbiAgICAgIHJlcXVpcmVkUGFyZW50cy5hZGQocGlkKTsgLy8gUGFyZW50IG5vdCBpbiB0aGlzIHNsaWNlLCBrZWVwIHJlcXVpcmVtZW50XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBwYXJlbnQgc3BhbiBpcyBhbHJlYWR5IGluIG91dHB1dCBmcm9tIHRoZSBtYWluIHByb2Nlc3NpbmcgbG9vcFxuICAgIGNvbnN0IHBhcmVudEFscmVhZHlLZXB0ID0gb3V0cHV0U3Bhbklkcy5oYXMocGlkKTtcbiAgICBpZiAocGFyZW50QWxyZWFkeUtlcHQpIHtcbiAgICAgIHJlcXVpcmVkUGFyZW50cy5hZGQocGlkKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGlmIHRoZSBwYXJlbnQgc3BhbiB3b3VsZCBiZSBzdXBwcmVzc2VkIGJ5IG5vaXNlIHJlZHVjdGlvbiBydWxlcy5cbiAgICAvLyBVc2UgdGhlIHByZS1jYWxjdWxhdGVkIGRlY2lzaW9uIGZyb20gc3BhbkRlY2lzaW9uQnlJZC5cbiAgICBjb25zdCBwYXJlbnREZWNpc2lvbiA9IHNwYW5EZWNpc2lvbkJ5SWQuZ2V0KHBpZCk7XG5cbiAgICBpZiAocGFyZW50RGVjaXNpb24gPT09ICdkcm9wJyB8fCBwYXJlbnREZWNpc2lvbiA9PT0gJ2ZvbGQnIHx8IHBhcmVudERlY2lzaW9uID09PSAnYWdncmVnYXRlJykge1xuICAgICAgLy8gUGFyZW50IHNwYW4gd2FzIHN1cHBvc2VkIHRvIGJlIHN1cHByZXNzZWQgKGRyb3BwZWQvZm9sZGVkL2FnZ3JlZ2F0ZWQgaW50byBJVFMgcGFyZW50KS5cbiAgICAgIC8vIENoZWNrIGlmIHBhcmVudCB3YXMgYWRkZWQgdG8gcmVxdWlyZWRQYXJlbnRzIGJlY2F1c2Ugb2YgS0VQVCBjaGlsZHJlbiAobm90IGp1c3Qgc3VtbWFyaWVzKS5cbiAgICAgIC8vIElmIHBhcmVudCBoYXMga2VwdCBjaGlsZHJlbiBpbiBvdXRwdXQsIHdlIE1VU1Qga2VlcCB0aGUgcGFyZW50IGZvciBoaWVyYXJjaHkgaW50ZWdyaXR5LlxuICAgICAgLy8gSWYgcGFyZW50IG9ubHkgaGFzIHN1cHByZXNzZWQgY2hpbGRyZW4gKGRyb3BwZWQvZm9sZGVkL2FnZ3JlZ2F0ZWQpLCB3ZSBjYW4gZHJvcCB0aGUgcGFyZW50IHRvby5cbiAgICAgIGNvbnN0IGhhc0tlcHRDaGlsZHJlbiA9IHJlcXVpcmVkUGFyZW50cy5oYXMocGlkKTsgLy8gV2FzIGl0IGFkZGVkIGVhcmxpZXIgKGtlcHQgY2hpbGQgcmVmZXJlbmNlcyk/XG5cbiAgICAgIGlmIChoYXNLZXB0Q2hpbGRyZW4pIHtcbiAgICAgICAgLy8gUGFyZW50IGhhcyBrZXB0IGNoaWxkcmVuIGluIG91dHB1dCAtIE1VU1Qga2VlcCBwYXJlbnQgZm9yIGhpZXJhcmNoeVxuICAgICAgICAvLyBLZWVwIGluIHJlcXVpcmVkUGFyZW50cyAoZG9uJ3QgZGVsZXRlKVxuICAgICAgICByZXF1aXJlZFBhcmVudHMuYWRkKHBpZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBQYXJlbnQgaGFzIE5PIGtlcHQgY2hpbGRyZW4gLSBvbmx5IGhhcyBzdXBwcmVzc2VkIGNoaWxkcmVuIHdpdGggc3VtbWFyaWVzXG4gICAgICAgIC8vIERyb3AgdGhlIHBhcmVudCBhcyBpbnRlbmRlZCBieSB0aGUgcnVsZVxuICAgICAgICAvLyBOb3QgaW4gcmVxdWlyZWRQYXJlbnRzLCBzbyBubyBuZWVkIHRvIGRlbGV0ZVxuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gUGFyZW50IHNwYW4gd2Fzbid0IGRyb3BwZWQsIHNvIGtlZXAgaXQgdG8gcHJlc2VydmUgZm9sZC9hZ2dyZWdhdGUgc3VtbWFyaWVzXG4gICAgcmVxdWlyZWRQYXJlbnRzLmFkZChwaWQpO1xuICB9XG5cbiAgbGV0IGNoYW5nZWQgPSB0cnVlO1xuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHBpZCBvZiBBcnJheS5mcm9tKHJlcXVpcmVkUGFyZW50cykpIHtcbiAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSBzcGFuQnlJZC5nZXQocGlkKTtcbiAgICAgIGlmICghcGFyZW50U3BhbikgY29udGludWU7XG5cbiAgICAgIGlmICghb3V0cHV0U3Bhbklkcy5oYXMocGlkKSkge1xuICAgICAgICAvLyBDaGVjayBpZiB0aGlzIHNwYW4gd2FzIHN1cHBvc2VkIHRvIGJlIHN1cHByZXNzZWQgKGFnZ3JlZ2F0ZWQvZm9sZGVkL2Ryb3BwZWQpLlxuICAgICAgICAvLyBJZiBzbywgb25seSBmb3JjZS1rZWVwIGl0IGlmIGl0IGhhcyBLRVBUIGNoaWxkcmVuIGluIHRoZSBvdXRwdXQuXG4gICAgICAgIC8vIERvbid0IGZvcmNlLWtlZXAgaXQganVzdCBiZWNhdXNlIGl0IGhhcyBpdHMgb3duIHN1cHByZXNzZWQgY2hpbGRyZW4uXG4gICAgICAgIGNvbnN0IHNwYW5EZWNpc2lvbiA9IHNwYW5EZWNpc2lvbkJ5SWQuZ2V0KHBpZCk7XG4gICAgICAgIGlmIChzcGFuRGVjaXNpb24gPT09ICdhZ2dyZWdhdGUnIHx8IHNwYW5EZWNpc2lvbiA9PT0gJ2ZvbGQnIHx8IHNwYW5EZWNpc2lvbiA9PT0gJ2Ryb3AnKSB7XG4gICAgICAgICAgLy8gVGhpcyBzcGFuIHdhcyBzdXBwcmVzc2VkLiBDaGVjayBpZiBpdCBoYXMgYW55IEtFUFQgY2hpbGRyZW4uXG4gICAgICAgICAgY29uc3QgaGFzS2VwdENoaWxkcmVuID0gb3V0cHV0LnNvbWUoZSA9PiBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gcGlkKTtcbiAgICAgICAgICBpZiAoIWhhc0tlcHRDaGlsZHJlbikge1xuICAgICAgICAgICAgLy8gTm8ga2VwdCBjaGlsZHJlbiAtIHRoaXMgc3BhbiBzaG91bGQgc3RheSBzdXBwcmVzc2VkXG4gICAgICAgICAgICAvLyBSZW1vdmUgZnJvbSByZXF1aXJlZFBhcmVudHMgc28gdHJhbnNpdGl2ZSBjbG9zdXJlIGRvZXNuJ3QgcHJvcGFnYXRlIGl0XG4gICAgICAgICAgICByZXF1aXJlZFBhcmVudHMuZGVsZXRlKHBpZCk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSGFzIGtlcHQgY2hpbGRyZW4gLSBtdXN0IGZvcmNlLWtlZXAgZm9yIGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZvcmNlIGtlZXAgcGFyZW50IHNwYW4gZm9yIGludGVncml0eS5cbiAgICAgICAgY29uc3QgZCA9IGVuc3VyZVNwYW5EYXRhKHBhcmVudFNwYW4pO1xuICAgICAgICBjb25zdCBuclJhdyA9IGQubm9pc2VSZWR1Y3Rpb247XG4gICAgICAgIGNvbnN0IG5yOiBOb2lzZVJlZHVjdGlvbkRhdGEgPSB7IGZvcmNlZEtlZXA6IHRydWUgfTtcbiAgICAgICAgaWYgKGlzUmVjb3JkKG5yUmF3KSkge1xuICAgICAgICAgIGlmICh0eXBlb2YgbnJSYXcuYWdncmVnYXRlVHJ1bmNhdGVkID09PSAnYm9vbGVhbicpIG5yLmFnZ3JlZ2F0ZVRydW5jYXRlZCA9IG5yUmF3LmFnZ3JlZ2F0ZVRydW5jYXRlZDtcbiAgICAgICAgICBpZiAodHlwZW9mIG5yUmF3LmRyb3BwZWQgPT09ICdudW1iZXInKSBuci5kcm9wcGVkID0gbnJSYXcuZHJvcHBlZDtcbiAgICAgICAgICBpZiAodHlwZW9mIG5yUmF3LmZvbGRlZCA9PT0gJ251bWJlcicpIG5yLmZvbGRlZCA9IG5yUmF3LmZvbGRlZDtcbiAgICAgICAgICBpZiAodHlwZW9mIG5yUmF3LmFnZ3JlZ2F0ZWQgPT09ICdudW1iZXInKSBuci5hZ2dyZWdhdGVkID0gbnJSYXcuYWdncmVnYXRlZDtcbiAgICAgICAgICBpZiAodHlwZW9mIG5yUmF3LmFwcHJveEJ5dGVzU2F2ZWQgPT09ICdudW1iZXInKSBuci5hcHByb3hCeXRlc1NhdmVkID0gbnJSYXcuYXBwcm94Qnl0ZXNTYXZlZDtcbiAgICAgICAgICBpZiAoaXNSZWNvcmQobnJSYXcuYnlSdWxlSWQpKSB7XG4gICAgICAgICAgICBjb25zdCBieVJ1bGVJZDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhuclJhdy5ieVJ1bGVJZCkpIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIGJ5UnVsZUlkWyBrIF0gPSB2O1xuICAgICAgICAgICAgbnIuYnlSdWxlSWQgPSBieVJ1bGVJZDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlzUmVjb3JkKG5yUmF3LmJ5VHlwZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGJ5VHlwZTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhuclJhdy5ieVR5cGUpKSBpZiAodHlwZW9mIHYgPT09ICdudW1iZXInKSBieVR5cGVbIGsgXSA9IHY7XG4gICAgICAgICAgICBuci5ieVR5cGUgPSBieVR5cGU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChpc1JlY29yZChuclJhdy5ieU9wZXJhdGlvbikpIHtcbiAgICAgICAgICAgIGNvbnN0IGJ5T3BlcmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG5yUmF3LmJ5T3BlcmF0aW9uKSkgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgYnlPcGVyYXRpb25bIGsgXSA9IHY7XG4gICAgICAgICAgICBuci5ieU9wZXJhdGlvbiA9IGJ5T3BlcmF0aW9uO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaXNSZWNvcmQobnJSYXcuYWdncmVnYXRlcykpIHtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZEFnZ3M6IFJlY29yZDxzdHJpbmcsIEFnZ3JlZ2F0ZUJ1Y2tldD4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobnJSYXcuYWdncmVnYXRlcykpIHtcbiAgICAgICAgICAgICAgY29uc3QgYiA9IHJlYWRBZ2dyZWdhdGVCdWNrZXQodik7XG4gICAgICAgICAgICAgIGlmIChiKSBwYXJzZWRBZ2dzWyBrIF0gPSBiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbnIuYWdncmVnYXRlcyA9IHBhcnNlZEFnZ3M7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGQubm9pc2VSZWR1Y3Rpb24gPSBucjtcbiAgICAgICAgLy8gQWx3YXlzIGFkZCBjaGVja3BvaW50IChjb3JlIGRlc2lnbilcbiAgICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQocGFyZW50U3BhbiwgY2ZnLCB7IG5hbWU6ICdub2lzZVJlZHVjdGlvbi5mb3JjZWRLZWVwUGFyZW50JywgdHM6IERhdGUubm93KCkgfSk7XG5cbiAgICAgICAgb3V0cHV0LnB1c2gocGFyZW50U3Bhbik7XG4gICAgICAgIG91dHB1dFNwYW5JZHMuYWRkKHBpZCk7XG4gICAgICAgIHN0YXRzLmtlcHQrKztcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG5cbiAgICAgIC8vIEVuc3VyZSBPVEVMIHNwYW4uc3RhcnQgZXhpc3RzIHdoZW4gd2UgZm9yY2Uta2VlcCBhIHNwYW4gdGhhdCBoYXMgb25lLlxuICAgICAgY29uc3Qgc3RhcnQgPSBzcGFuU3RhcnRCeUlkLmdldChwaWQpO1xuICAgICAgaWYgKHN0YXJ0KSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gb3V0cHV0QnlJZC5nZXQocGlkKTtcbiAgICAgICAgY29uc3QgaGFzU3RhcnQgPSBleGlzdGluZyAmJiBleGlzdGluZy5zb21lKCh4KSA9PiB4LnR5cGUgPT09ICdzcGFuLnN0YXJ0Jyk7XG4gICAgICAgIGlmICghaGFzU3RhcnQpIHtcbiAgICAgICAgICAvLyBTYWZldHk6IHByZXZlbnQgYXJyYXkgb3ZlcmZsb3dcbiAgICAgICAgICBpZiAob3V0cHV0Lmxlbmd0aCA8IDEwMDAwMDApIHtcbiAgICAgICAgICAgIG91dHB1dC5wdXNoKHN0YXJ0KTtcbiAgICAgICAgICAgIC8vIFVwZGF0ZSBvdXRwdXRCeUlkIGluZGV4IHNvIHdlIGRvbid0IHB1c2ggdGhpcyBhZ2FpbiBpbiBuZXh0IGl0ZXJhdGlvblxuICAgICAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgICAgIGV4aXN0aW5nLnB1c2goc3RhcnQpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgb3V0cHV0QnlJZC5zZXQocGlkLCBbIHN0YXJ0IF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3RhdHMua2VwdCsrO1xuICAgICAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvZ2dlci53YXJuKCdOb2lzZSByZWR1Y3Rpb24gb3V0cHV0IGFycmF5IGhpdCBzYWZldHkgY2FwLCBkcm9wcGluZyBzcGFuLnN0YXJ0Jywge1xuICAgICAgICAgICAgICBzcGFuSWQ6IHBpZCxcbiAgICAgICAgICAgICAgb3V0cHV0TGVuZ3RoOiBvdXRwdXQubGVuZ3RoLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIENsb3N1cmU6IGlmIHBhcmVudFNwYW4gaGFzIGl0cyBvd24gcGFyZW50LCByZXF1aXJlIGl0IHRvby5cbiAgICAgIGNvbnN0IHBwID0gcGFyZW50U3Bhbi5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgICAgaWYgKHBwICYmICFyZXF1aXJlZFBhcmVudHMuaGFzKHBwKSkge1xuICAgICAgICByZXF1aXJlZFBhcmVudHMuYWRkKHBwKTtcbiAgICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHsgZXZlbnRzOiBvdXRwdXQsIHN0YXRzIH07XG59XG5cblxuIl19