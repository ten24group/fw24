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
    const requiredParents = new Set();
    // Parents referenced by emitted events
    for (const e of output) {
        const pid = e.parentObservabilityLogId ?? undefined;
        if (pid)
            requiredParents.add(pid);
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
            // Don't force-keep it just because children were folded into it.
            // The nested fold/aggregate data is lost, but that's acceptable since the parent is noise.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvb2JzZXJ2YWJpbGl0eS9ub2lzZS1yZWR1Y3Rpb24vaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEwaUJBLGtEQXVlQztBQXZnQ0QsMkNBQTZDO0FBQzdDLDBEQUF3RDtBQUN4RCx5Q0FBZ0Q7QUFFaEQsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLGdCQUFnQixDQUFDLENBQUM7QUFvQjlDLFNBQVMsR0FBRyxDQUFDLEdBQTJCLEVBQUUsR0FBdUIsRUFBRSxFQUFFLEdBQUcsQ0FBQztJQUN2RSxNQUFNLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDO0lBQ3JCLEdBQUcsQ0FBRSxDQUFDLENBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBRSxDQUFDLENBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7QUFDbEMsQ0FBQztBQUVELFNBQVMsUUFBUSxDQUFDLEtBQWM7SUFDOUIsT0FBTyxDQUFDLENBQUMsS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDdkUsQ0FBQztBQUdELFNBQVMsWUFBWSxDQUFDLEtBQWM7SUFDbEMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUNuQyxJQUFJLE9BQU8sS0FBSyxDQUFDLElBQUksS0FBSyxRQUFRO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDakQsSUFBSSxPQUFPLEtBQUssQ0FBQyxFQUFFLEtBQUssUUFBUTtRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQy9DLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxTQUFTLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBQ3BFLElBQUksS0FBSyxDQUFDLE9B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akMsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLE9BQU8sRUFBRSxDQUFDO3dCQUM1QixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO3dCQUNuQix3RUFBd0U7d0JBQ3hFLElBQUksUUFBUSxFQUFFLENBQUM7NEJBQ2IsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQzt3QkFDdkIsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUUsS0FBSyxDQUFFLENBQUMsQ0FBQzt3QkFDakMsQ0FBQzt3QkFDRCxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7d0JBQ2IsT0FBTyxHQUFHLElBQUksQ0FBQztvQkFDakIsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0VBQWtFLEVBQUU7NEJBQzlFLE1BQU0sRUFBRSxHQUFHOzRCQUNYLFlBQVksRUFBRSxNQUFNLENBQUMsTUFBTTt5QkFDNUIsQ0FBQyxDQUFDO29CQUNMLENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUM7WUFFRCw2REFBNkQ7WUFDN0QsTUFBTSxFQUFFLEdBQUcsVUFBVSxDQUFDLHdCQUF3QixJQUFJLFNBQVMsQ0FBQztZQUM1RCxJQUFJLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztnQkFDbkMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDeEIsT0FBTyxHQUFHLElBQUksQ0FBQztZQUNqQixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUNuQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgTm9pc2VSZWR1Y3Rpb25Db25maWcsXG4gIE5vaXNlRGVjaXNpb24sXG4gIE5vaXNlUnVsZSxcbiAgTm9pc2VSdWxlTWF0Y2gsXG4gIE9ic2VydmFiaWxpdHlFdmVudCxcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50VHlwZSxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBTcGFuQ2hlY2twb2ludCxcbn0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBtYXRjaGVzUGF0dGVybiB9IGZyb20gJy4uL3V0aWxzL3BhdHRlcm4tdXRpbHMnO1xuaW1wb3J0IHsgZXZhbHVhdGVOb2lzZVJ1bGVzIH0gZnJvbSAnLi9wcmlvcml0eSc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignTm9pc2VSZWR1Y3Rpb24nKTtcblxudHlwZSBOb2lzZVN0YXRzID0ge1xuICBkcm9wcGVkOiBudW1iZXI7XG4gIGZvbGRlZDogbnVtYmVyO1xuICBhZ2dyZWdhdGVkOiBudW1iZXI7XG4gIGRvd25ncmFkZWQ6IG51bWJlcjtcbiAga2VwdDogbnVtYmVyO1xuICBhcHByb3hCeXRlc1NhdmVkOiBudW1iZXI7XG4gIGRyb3BwZWRCeVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gIGRyb3BwZWRCeU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgZm9sZGVkQnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICBmb2xkZWRCeU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbn07XG5cbmV4cG9ydCB0eXBlIE5vaXNlUmVkdWN0aW9uUmVzdWx0ID0ge1xuICBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdO1xuICBzdGF0czogTm9pc2VTdGF0cztcbn07XG5cbmZ1bmN0aW9uIGluYyhtYXA6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIGtleTogc3RyaW5nIHwgdW5kZWZpbmVkLCBieSA9IDEpIHtcbiAgY29uc3QgayA9IGtleSA/PyAnXyc7XG4gIG1hcFsgayBdID0gKG1hcFsgayBdID8/IDApICsgYnk7XG59XG5cbmZ1bmN0aW9uIGlzUmVjb3JkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cblxudHlwZSBDaGVja3BvaW50ID0gU3BhbkNoZWNrcG9pbnQ7XG5mdW5jdGlvbiBpc0NoZWNrcG9pbnQodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBDaGVja3BvaW50IHtcbiAgaWYgKCFpc1JlY29yZCh2YWx1ZSkpIHJldHVybiBmYWxzZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZS5uYW1lICE9PSAnc3RyaW5nJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodHlwZW9mIHZhbHVlLnRzICE9PSAnbnVtYmVyJykgcmV0dXJuIGZhbHNlO1xuICBpZiAodmFsdWUudGFncyAhPT0gdW5kZWZpbmVkICYmICFpc1JlY29yZCh2YWx1ZS50YWdzKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAodmFsdWUubWV0cmljcyAhPT0gdW5kZWZpbmVkICYmICFpc1JlY29yZCh2YWx1ZS5tZXRyaWNzKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAodmFsdWUuZGF0YSAhPT0gdW5kZWZpbmVkICYmICFpc1JlY29yZCh2YWx1ZS5kYXRhKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAodmFsdWUuZXJyb3IgIT09IHVuZGVmaW5lZCAmJiAhaXNSZWNvcmQodmFsdWUuZXJyb3IpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiB0cnVlO1xufVxuXG5cbnR5cGUgQWdncmVnYXRlRXhhbXBsZSA9IHtcbiAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBzdHJpbmc7XG4gIHR5cGU6IHN0cmluZztcbiAgb3BlcmF0aW9uPzogc3RyaW5nO1xuICBzb3VyY2U/OiBzdHJpbmc7XG4gIGVudGl0eU5hbWU/OiBzdHJpbmc7XG4gIGVudGl0eUlkPzogc3RyaW5nO1xuICBkdXJhdGlvbk1zPzogbnVtYmVyO1xuICBzdWNjZXNzPzogYm9vbGVhbjtcbiAgbGV2ZWw6IHN0cmluZztcbiAgcnVsZUlkPzogc3RyaW5nO1xufTtcblxudHlwZSBBZ2dyZWdhdGVFcnJvckV4YW1wbGUgPSBBZ2dyZWdhdGVFeGFtcGxlICYge1xuICBlcnJvcj86IHsgdHlwZTogc3RyaW5nOyBtZXNzYWdlOiBzdHJpbmcgfTtcbn07XG5cbnR5cGUgQWdncmVnYXRlQnVja2V0ID0ge1xuICBjb3VudDogbnVtYmVyO1xuICBlcnJvckNvdW50OiBudW1iZXI7XG4gIGR1cmF0aW9uU3VtTXM6IG51bWJlcjtcbiAgZHVyYXRpb25NYXhNczogbnVtYmVyO1xuICBleGFtcGxlczogQWdncmVnYXRlRXhhbXBsZVtdO1xuICBlcnJvckV4YW1wbGVzOiBBZ2dyZWdhdGVFcnJvckV4YW1wbGVbXTtcbiAgcnVsZXM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG59O1xuXG50eXBlIE5vaXNlUmVkdWN0aW9uRGF0YSA9IHtcbiAgYWdncmVnYXRlcz86IFJlY29yZDxzdHJpbmcsIEFnZ3JlZ2F0ZUJ1Y2tldD47XG4gIGFnZ3JlZ2F0ZVRydW5jYXRlZD86IGJvb2xlYW47XG4gIGZvcmNlZEtlZXA/OiBib29sZWFuO1xuICAvLyBzdW1tYXJ5IGZpZWxkc1xuICBkcm9wcGVkPzogbnVtYmVyO1xuICBmb2xkZWQ/OiBudW1iZXI7XG4gIGFnZ3JlZ2F0ZWQ/OiBudW1iZXI7XG4gIGJ5UnVsZUlkPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgYXBwcm94Qnl0ZXNTYXZlZD86IG51bWJlcjtcbiAgYnlUeXBlPzogUmVjb3JkPHN0cmluZywgbnVtYmVyPjtcbiAgYnlPcGVyYXRpb24/OiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xufTtcblxuZnVuY3Rpb24gcmVhZEFnZ3JlZ2F0ZUJ1Y2tldCh2YWx1ZTogdW5rbm93bik6IEFnZ3JlZ2F0ZUJ1Y2tldCB8IHVuZGVmaW5lZCB7XG4gIGlmICghaXNSZWNvcmQodmFsdWUpKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAodHlwZW9mIHZhbHVlLmNvdW50ICE9PSAnbnVtYmVyJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHR5cGVvZiB2YWx1ZS5lcnJvckNvdW50ICE9PSAnbnVtYmVyJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHR5cGVvZiB2YWx1ZS5kdXJhdGlvblN1bU1zICE9PSAnbnVtYmVyJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHR5cGVvZiB2YWx1ZS5kdXJhdGlvbk1heE1zICE9PSAnbnVtYmVyJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKCFpc1JlY29yZCh2YWx1ZS5ydWxlcykpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgcnVsZXM6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZS5ydWxlcykpIHtcbiAgICBpZiAodHlwZW9mIHYgPT09ICdudW1iZXInKSBydWxlc1sgayBdID0gdjtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY291bnQ6IHZhbHVlLmNvdW50LFxuICAgIGVycm9yQ291bnQ6IHZhbHVlLmVycm9yQ291bnQsXG4gICAgZHVyYXRpb25TdW1NczogdmFsdWUuZHVyYXRpb25TdW1NcyxcbiAgICBkdXJhdGlvbk1heE1zOiB2YWx1ZS5kdXJhdGlvbk1heE1zLFxuICAgIC8vIFdlIGludGVudGlvbmFsbHkgZG8gbm90IGF0dGVtcHQgdG8gcmVoeWRyYXRlIGV4YW1wbGUgYXJyYXlzIGZyb20gdW5rbm93biBpbnB1dC5cbiAgICAvLyBUaGlzIG1vZHVsZSBpcyB0aGUgb25seSB3cml0ZXIgb2YgZXhhbXBsZXM7IGlmIGRhdGEgaXMgbWFsZm9ybWVkLCB3ZSByZXNldCBleGFtcGxlcyBzYWZlbHkuXG4gICAgZXhhbXBsZXM6IFtdLFxuICAgIGVycm9yRXhhbXBsZXM6IFtdLFxuICAgIHJ1bGVzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBhc0FycmF5PFQ+KHY6IFQgfCBUW10gfCB1bmRlZmluZWQpOiBUW10gfCB1bmRlZmluZWQge1xuICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2KSA/IHYgOiBbIHYgXTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hlc1J1bGUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgbWF0Y2g6IE5vaXNlUnVsZU1hdGNoKTogYm9vbGVhbiB7XG4gIGNvbnN0IHR5cGVzID0gYXNBcnJheShtYXRjaC50eXBlKTtcbiAgaWYgKHR5cGVzICYmICF0eXBlcy5pbmNsdWRlcyhldmVudC50eXBlIGFzIE9ic2VydmFiaWxpdHlFdmVudFR5cGUpKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgbGV2ZWxzID0gYXNBcnJheShtYXRjaC5sZXZlbCk7XG4gIGlmIChsZXZlbHMgJiYgIWxldmVscy5pbmNsdWRlcyhldmVudC5sZXZlbCBhcyBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcpKSByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKCFtYXRjaGVzUGF0dGVybihldmVudC5vcGVyYXRpb24sIG1hdGNoLm9wZXJhdGlvbikpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFtYXRjaGVzUGF0dGVybihldmVudC5zb3VyY2UsIG1hdGNoLnNvdXJjZSkpIHJldHVybiBmYWxzZTtcblxuICBpZiAobWF0Y2guZW50aXR5TmFtZSAmJiBldmVudC5lbnRpdHlOYW1lICE9PSBtYXRjaC5lbnRpdHlOYW1lKSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gTWF0Y2ggbWluaW11bSBkdXJhdGlvbk1zIChtYXRjaCBpZiBldmVudC5kdXJhdGlvbk1zID49IHRocmVzaG9sZClcbiAgLy8gRXhhbXBsZTogZHVyYXRpb25NczogMTAwIG1hdGNoZXMgc3BhbnMgd2l0aCAxMDBtcyBvciBsb25nZXIgZHVyYXRpb25cbiAgaWYgKG1hdGNoLm1pbkR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTsgLy8gTm8gZHVyYXRpb24gbWVhbnMgbm8gbWF0Y2hcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA8IG1hdGNoLm1pbkR1cmF0aW9uTXMpIHJldHVybiBmYWxzZTsgLy8gQmVsb3cgdGhyZXNob2xkXG4gIH1cblxuICAvLyBNYXRjaCBtYXhpbXVtIGR1cmF0aW9uTXMgKG1hdGNoIGlmIGV2ZW50LmR1cmF0aW9uTXMgPCB0aHJlc2hvbGQpXG4gIC8vIEV4YW1wbGU6IG1heER1cmF0aW9uTXM6IDUwIG1hdGNoZXMgc3BhbnMgdW5kZXIgNTBtc1xuICBpZiAobWF0Y2gubWF4RHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlOyAvLyBObyBkdXJhdGlvbiBtZWFucyBubyBtYXRjaFxuICAgIGlmIChldmVudC5kdXJhdGlvbk1zID49IG1hdGNoLm1heER1cmF0aW9uTXMpIHJldHVybiBmYWxzZTsgLy8gQXQgb3IgYWJvdmUgdGhyZXNob2xkXG4gIH1cblxuICAvLyBNYXRjaCBzdWNjZXNzIHN0YXR1cyAodHJ1ZSA9IHN1Y2Nlc3NmdWwsIGZhbHNlID0gZmFpbGVkKVxuICBpZiAobWF0Y2guc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGV2ZW50LnN1Y2Nlc3MgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlOyAvLyBObyBzdWNjZXNzIGZpZWxkIG1lYW5zIG5vIG1hdGNoXG4gICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IG1hdGNoLnN1Y2Nlc3MpIHJldHVybiBmYWxzZTsgLy8gRGlmZmVyZW50IHN1Y2Nlc3Mgc3RhdHVzXG4gIH1cblxuICBpZiAobWF0Y2gudGFncykge1xuICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobWF0Y2gudGFncykpIHtcbiAgICAgIGlmICghZXZlbnQudGFncykgcmV0dXJuIGZhbHNlO1xuICAgICAgLy8gU3VwcG9ydCBleGFjdCBtYXRjaCBhbmQgcmVnZXgtc3RyaW5nIG1hdGNoIGluIHRhZyB2YWx1ZXNcbiAgICAgIGlmICghbWF0Y2hlc1BhdHRlcm4oZXZlbnQudGFnc1sgayBdLCB2KSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG5jb25zdCBidWlsdGluUnVsZXNDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBOb2lzZVJ1bGVbXT4oKTtcblxuZnVuY3Rpb24gZ2V0QnVpbHRpblJ1bGVzKHByZXNldHM6IHN0cmluZ1tdKTogTm9pc2VSdWxlW10ge1xuICBjb25zdCBjYWNoZUtleSA9IFsgLi4ucHJlc2V0cyBdLnNvcnQoKS5qb2luKCcsJyk7IC8vIENyZWF0ZSBhIGNvcHkgYmVmb3JlIHNvcnRpbmcgdG8gYXZvaWQgbXV0YXRpb25cbiAgbGV0IHJ1bGVzID0gYnVpbHRpblJ1bGVzQ2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKHJ1bGVzKSByZXR1cm4gcnVsZXM7XG5cbiAgcnVsZXMgPSBbXTtcblxuICBpZiAocHJlc2V0cy5pbmNsdWRlcygnZncyNC5ob3RwYXRocycpKSB7XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERBVEFCQVNFIFFVRVJZIE5PSVNFIFJFRFVDVElPTiAoZXZhbHVhdGlvbiBvcmRlciBtYXR0ZXJzISlcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUnVsZXMgYXJlIGV2YWx1YXRlZCBpbiBvcmRlciAtIGZpcnN0IG1hdGNoIHdpbnNcbiAgICAvLyBQcmlvcml0eTogZXJyb3JzID4gc2NhbnMgPiBzbG93IHF1ZXJpZXMgPiBmYXN0IHF1ZXJpZXNcblxuICAgIC8vIDEuIEhJR0hFU1QgUFJJT1JJVFk6IEtlZXAgcXVlcnkgZXJyb3JzIChtdXN0IGJlIGZpcnN0ISlcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmtlZXBfZXJyb3JzJyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgIHJlYXNvbjogJ0tlZXAgcXVlcnkgZXJyb3JzIGFzIHN0YW5kYWxvbmUgbG9ncyBmb3IgZGVidWdnaW5nIC0gSElHSEVTVCBQUklPUklUWScsXG4gICAgfSk7XG5cbiAgICAvLyAyLiBLZWVwIHRhYmxlIHNjYW5zIChhbHdheXMgd2FybmluZ3MsIGV2ZW4gaWYgZmFzdClcbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmtlZXBfc2NhbnMnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgdGFnczogeyBzY2FuOiAndHJ1ZScgfVxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdLZWVwIHRhYmxlIHNjYW4gb3BlcmF0aW9ucyBhcyBzdGFuZGFsb25lIHdhcm5pbmdzIC0gYWx3YXlzIG5lZWQgdmlzaWJpbGl0eScsXG4gICAgfSk7XG5cbiAgICAvLyAzLiBLZWVwIHNsb3cgcXVlcmllcyBhcyBzdGFuZGFsb25lIGxvZ3MgZm9yIGludmVzdGlnYXRpb25cbiAgICBydWxlcy5wdXNoKHtcbiAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5xdWVyaWVzLmtlZXBfc2xvdycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBtaW5EdXJhdGlvbk1zOiAxMDBcbiAgICAgIH0sXG4gICAgICBkZWNpc2lvbjogJ2tlZXAnLFxuICAgICAgcmVhc29uOiAnS2VlcCBzbG93IHF1ZXJpZXMgKD49MTAwbXMpIGFzIHN0YW5kYWxvbmUgbG9ncyBmb3IgcGVyZm9ybWFuY2UgaW52ZXN0aWdhdGlvbicsXG4gICAgfSk7XG5cbiAgICAvLyA0LiBMT1dFU1QgUFJJT1JJVFk6IEZvbGQgZmFzdCBzdWNjZXNzZnVsIHF1ZXJpZXMgaW50byBwYXJlbnQgc3BhblxuICAgIC8vIFRoaXMgb25seSBtYXRjaGVzIGlmIG5vbmUgb2YgdGhlIGFib3ZlIG1hdGNoZWQgKG5vdCBlcnJvciwgbm90IHNjYW4sIG5vdCBzbG93KVxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnF1ZXJpZXMuZm9sZF9mYXN0X3N1Y2Nlc3MnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogMTAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdmb2xkJyxcbiAgICAgIHJlYXNvbjogJ0ZvbGQgZmFzdCBzdWNjZXNzZnVsIHF1ZXJpZXMgKDwxMDBtcykgaW50byBwYXJlbnQgc3BhbiBhcyB0aW1lbGluZSBjaGVja3BvaW50cycsXG4gICAgfSk7XG5cbiAgICAvLyBBUEkgcmVhZCBvcGVyYXRpb25zOiBkcm9wIHN1Y2Nlc3NmdWwsIGZhc3QgR0VUL2xpc3QgcmVxdWVzdHNcbiAgICAvLyBMb3cgcHJpb3JpdHkgKDEwKSAtIGVhc2lseSBvdmVycmlkZGVuIGJ5IGN1c3RvbSBydWxlc1xuICAgIC8vIEV4Y2VwdGlvbnMgZW5zdXJlIGVycm9ycyBhbmQgY3JpdGljYWwgZXZlbnRzIGFyZSBuZXZlciBkcm9wcGVkXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuYXBpLmRyb3BfZmFzdF9zdWNjZXNzZnVsX3JlYWRzJyxcbiAgICAgIHByaW9yaXR5OiAxMCwgIC8vIExvdyBwcmlvcml0eSAtIGVhc3kgdG8gb3ZlcnJpZGVcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdzcGFuJyxcbiAgICAgICAgLy8gTWF0Y2hlczpcbiAgICAgICAgLy8gLSBDb250cm9sbGVyIG9wZXJhdGlvbnM6IFwiSFRUUCBHRVQgL3BhdGhcIiwgXCJIVFRQIEhFQUQgL3BhdGhcIiwgXCJIVFRQIE9QVElPTlMgL3BhdGhcIlxuICAgICAgICAvLyAtIFNlcnZpY2UvdXRpbGl0eSBtZXRob2RzOiBcIi5saXN0XCIsIFwiLmdldFwiLCBcIi5yZWFkXCIsIFwiLmZldGNoXCIsIFwiLmZpbmRcIlxuICAgICAgICAvLyAtIFVSTCBwYXR0ZXJuczogXCIvbGlzdFwiLCBcIi9nZXRcIiwgXCIvcmVhZFwiLCBcIi9mZXRjaFwiLCBcIi9maW5kXCJcbiAgICAgICAgLy8gLSBBbHNvIHN1cHBvcnRzIG5vbi1IVFRQIGZvcm1hdCBmb3IgdGVzdHM6IFwiR0VUIC9wYXRoXCIsIFwiSEVBRCAvcGF0aFwiXG4gICAgICAgIG9wZXJhdGlvbjogJy9eKEhUVFAgKT8oR0VUfEhFQUR8T1BUSU9OUylcXFxcc3xcXFxcLihsaXN0fGdldHxyZWFkfGZldGNofGZpbmQpKD86WygvXXwkKXxcXFxcLyhsaXN0fGdldHxyZWFkfGZldGNofGZpbmQpKD86Wy8/XXwkKS8nLFxuICAgICAgICBtYXhEdXJhdGlvbk1zOiA1MDBcbiAgICAgIH0sXG4gICAgICBleGNlcHQ6IFtcbiAgICAgICAgeyBzdWNjZXNzOiBmYWxzZSB9LCAgICAgICAgICAgICAgICAgICAgLy8gTmV2ZXIgZHJvcCBmYWlsdXJlc1xuICAgICAgICB7IGxldmVsOiBbICdlcnJvcicsICdjcml0aWNhbCcgXSB9LCAgICAgIC8vIE5ldmVyIGRyb3AgZXJyb3JzXG4gICAgICBdLFxuICAgICAgZGVjaXNpb246ICdkcm9wJyxcbiAgICAgIHJlYXNvbjogJ0Ryb3AgZmFzdCBzdWNjZXNzZnVsIHJlYWQgb3BlcmF0aW9ucyAoPDUwMG1zKScsXG4gICAgfSk7XG5cbiAgICAvLyBTdHJlYW0gcHJvY2Vzc29yczogZm9sZCBjaGF0dHkgXCJkb25lXCIgbG9ncyBpbnRvIHRoZWlyIHBhcmVudCBzcGFuLlxuICAgIHJ1bGVzLnB1c2goXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uZm9sZF9wdWJsaXNoX2RvbmUnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJywgc291cmNlOiAnL15EeW5hbW9EQlN0cmVhbVRvU05TUHJvY2Vzc29yXFxcXC4vJywgbGV2ZWw6IFsgJ2luZm8nLCAnZGVidWcnLCAndHJhY2UnIF0sIG9wZXJhdGlvbjogJy9QdWJsaXNoIChTTlN8RklGTykgZG9uZS8nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZm9sZCcsXG4gICAgICAgIHJlYXNvbjogJ0ZvbGQgbm9pc3kgc3RyZWFtIHB1Ymxpc2ggY29tcGxldGlvbiBsb2dzIGludG8gcGFyZW50IHNwYW4nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmdzI0LmhvdHBhdGhzLnN0cmVhbS5mb2xkX2F1ZGl0X2RvbmUnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnbG9nJywgc291cmNlOiAnL15EeW5hbW9EQlN0cmVhbUF1ZGl0TG9nZ2VyXFxcXC4vJywgbGV2ZWw6IFsgJ2luZm8nLCAnZGVidWcnLCAndHJhY2UnIF0sIG9wZXJhdGlvbjogJy9kb25lfENhcHR1cmVkIChjcmVhdGV8dXBkYXRlfGRlbGV0ZSkgYXVkaXQvJyB9LFxuICAgICAgICBkZWNpc2lvbjogJ2ZvbGQnLFxuICAgICAgICByZWFzb246ICdGb2xkIG5vaXN5IHN0cmVhbSBhdWRpdCBsb2dnZXIgbG9ncyBpbnRvIHBhcmVudCBzcGFuJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5zdHJlYW0uZHJvcF9pbmZvX25vaXNlJyxcbiAgICAgICAgbWF0Y2g6IHsgdHlwZTogJ2xvZycsIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW0oVG9TTlNQcm9jZXNzb3J8QXVkaXRMb2dnZXIpXFxcXC4vJywgbGV2ZWw6IFsgJ3RyYWNlJywgJ2RlYnVnJyBdIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgIHJlYXNvbjogJ0Ryb3AgbG93LWxldmVsIHN0cmVhbSBub2lzZSBieSBkZWZhdWx0IChzdGlsbCBzdW1tYXJpemVkKScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ2Z3MjQuaG90cGF0aHMuc3RyZWFtLmRyb3BfYmF0Y2hfc3BhbnMnLFxuICAgICAgICBtYXRjaDogeyB0eXBlOiAnc3BhbicsIHNvdXJjZTogJy9eRHluYW1vREJTdHJlYW0oVG9TTlNQcm9jZXNzb3J8QXVkaXRMb2dnZXIpXFxcXC5wcm9jZXNzJC8nLCBvcGVyYXRpb246ICcvXmF3czooc3FzfGR5bmFtb2RiKSBEeW5hbW9EQlN0cmVhbS8nIH0sXG4gICAgICAgIGRlY2lzaW9uOiAnZHJvcCcsXG4gICAgICAgIHJlYXNvbjogJ0Ryb3Agc3RyZWFtIHByb2Nlc3NvciBiYXRjaCBzcGFucyAobm9pc3ksIGF1ZGl0LmVudGl0eSByZWNvcmRzIGFyZSBrZXB0IHNlcGFyYXRlbHkpJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnZncyNC5ob3RwYXRocy5lbnRpdHkuYWdncmVnYXRlX3Vwc2VydF9zcGFucycsXG4gICAgICAgIHByaW9yaXR5OiA1MCwgIC8vIERlZmF1bHQgYWdncmVnYXRlIHByaW9yaXR5XG4gICAgICAgIG1hdGNoOiB7XG4gICAgICAgICAgdHlwZTogJ3NwYW4nLFxuICAgICAgICAgIG9wZXJhdGlvbjogJy9CYXNlRW50aXR5U2VydmljZVxcXFwuKHVwc2VydHx1cGRhdGUpLycsXG4gICAgICAgICAgc291cmNlOiAnL15zZXJ2aWNlOkJhc2VFbnRpdHlTZXJ2aWNlXFxcXC4vJ1xuICAgICAgICB9LFxuICAgICAgICBleGNlcHQ6IFtcbiAgICAgICAgICB7IHN1Y2Nlc3M6IGZhbHNlIH0sICAgICAgICAgICAgICAgIC8vIEtlZXAgZmFpbGVkIHdyaXRlc1xuICAgICAgICAgIHsgbGV2ZWw6IFsgJ2Vycm9yJywgJ2NyaXRpY2FsJyBdIH0sICAvLyBLZWVwIGVycm9yIHdyaXRlc1xuICAgICAgICBdLFxuICAgICAgICBkZWNpc2lvbjogJ2FnZ3JlZ2F0ZScsXG4gICAgICAgIHJlYXNvbjogJ0FnZ3JlZ2F0ZSBzdWNjZXNzZnVsIGVudGl0eSB3cml0ZSBzcGFucyBpbnRvIHBhcmVudCcsXG4gICAgICB9LFxuICAgICk7XG4gIH1cblxuICBpZiAocHJlc2V0cy5pbmNsdWRlcygnZncyNC5iYXRjaF9wcm9jZXNzb3JzJykpIHtcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gREFUQUJBU0UgUVVFUlkgTk9JU0UgUkVEVUNUSU9OIEZPUiBCQVRDSCBQUk9DRVNTSU5HXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEluIGJhdGNoIHByb2Nlc3NpbmcsIHF1ZXJpZXMgYWNjdW11bGF0ZSBxdWlja2x5ICgxMDAwIHJlY29yZHMgPSAxMDAwKyBxdWVyaWVzKVxuICAgIC8vIFJ1bGVzIGFyZSBldmFsdWF0ZWQgaW4gb3JkZXIgLSBmaXJzdCBtYXRjaCB3aW5zXG4gICAgLy8gUHJpb3JpdHk6IGVycm9ycyA+IHNjYW5zID4gc2xvdyBxdWVyaWVzID4gZmFzdCBxdWVyaWVzXG5cbiAgICAvLyAxLiBISUdIRVNUIFBSSU9SSVRZOiBLZWVwIHF1ZXJ5IGVycm9ycyAobXVzdCBiZSBmaXJzdCEpXG4gICAgcnVsZXMucHVzaCh7XG4gICAgICBpZDogJ2Z3MjQuYmF0Y2gucXVlcmllcy5rZWVwX2Vycm9ycycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICBzdWNjZXNzOiBmYWxzZVxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdLZWVwIHF1ZXJ5IGVycm9ycyBpbiBiYXRjaCBhcyBzdGFuZGFsb25lIGxvZ3MgLSBISUdIRVNUIFBSSU9SSVRZJyxcbiAgICB9KTtcblxuICAgIC8vIDIuIEtlZXAgdGFibGUgc2NhbnMgKGFsd2F5cyB3YXJuaW5ncywgZXZlbiBpZiBmYXN0KVxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmJhdGNoLnF1ZXJpZXMua2VlcF9zY2FucycsXG4gICAgICBtYXRjaDoge1xuICAgICAgICB0eXBlOiAnZGF0YWJhc2UucXVlcnknLFxuICAgICAgICB0YWdzOiB7IHNjYW46ICd0cnVlJyB9XG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdrZWVwJyxcbiAgICAgIHJlYXNvbjogJ0tlZXAgdGFibGUgc2NhbnMgaW4gYmF0Y2ggLSBhbHdheXMgbmVlZCB2aXNpYmlsaXR5IGZvciBwZXJmb3JtYW5jZSBpc3N1ZXMnLFxuICAgIH0pO1xuXG4gICAgLy8gMy4gS2VlcCBzbG93IHF1ZXJpZXMgKHBlcmZvcm1hbmNlIGlzc3VlcyBpbiBiYXRjaCBwcm9jZXNzaW5nKVxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmJhdGNoLnF1ZXJpZXMua2VlcF9zbG93JyxcbiAgICAgIG1hdGNoOiB7XG4gICAgICAgIHR5cGU6ICdkYXRhYmFzZS5xdWVyeScsXG4gICAgICAgIG1pbkR1cmF0aW9uTXM6IDUwMFxuICAgICAgfSxcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdLZWVwIHNsb3cgcXVlcmllcyAoPj01MDBtcykgaW4gYmF0Y2ggYXMgc3RhbmRhbG9uZSBsb2dzIC0gcGVyZm9ybWFuY2UgaXNzdWVzJyxcbiAgICB9KTtcblxuICAgIC8vIDQuIExPV0VTVCBQUklPUklUWTogQWdncmVnYXRlIGZhc3QgcXVlcmllcyB0byBwcmV2ZW50IGNoZWNrcG9pbnQgc3BhbVxuICAgIC8vIFRoaXMgb25seSBtYXRjaGVzIGlmIG5vbmUgb2YgdGhlIGFib3ZlIG1hdGNoZWQgKG5vdCBlcnJvciwgbm90IHNjYW4sIG5vdCBzbG93KVxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmJhdGNoLnF1ZXJpZXMuYWdncmVnYXRlX2Zhc3QnLFxuICAgICAgbWF0Y2g6IHtcbiAgICAgICAgdHlwZTogJ2RhdGFiYXNlLnF1ZXJ5JyxcbiAgICAgICAgbWF4RHVyYXRpb25NczogNTAwLFxuICAgICAgICBzdWNjZXNzOiB0cnVlXG4gICAgICB9LFxuICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgcmVhc29uOiAnQWdncmVnYXRlIGZhc3QgcXVlcmllcyAoPDUwMG1zKSBpbiBiYXRjaCB0byBwcmV2ZW50IGNoZWNrcG9pbnQgc3BhbScsXG4gICAgfSk7XG5cbiAgICAvLyBEZWZhdWx0OiBhZ2dyZWdhdGUgcGVyLXJlY29yZCBzcGFucyBpbiBiYXRjaCBwcm9jZXNzb3JzIChzdW1tYXJpemUgb24gcGFyZW50IGJhdGNoIHNwYW4pLlxuICAgIC8vIE1hdGNoIGFueSBzcGFuIGVuZGluZyB3aXRoIFwiIHJlY29yZFwiIC0gZmxleGlibGUgZm9yIGFsbCBiYXRjaCBwcm9jZXNzb3IgaW1wbGVtZW50YXRpb25zLlxuICAgIHJ1bGVzLnB1c2goe1xuICAgICAgaWQ6ICdmdzI0LmJhdGNoLmFnZ3JlZ2F0ZV9yZWNvcmRfc3BhbnMnLFxuICAgICAgbWF0Y2g6IHsgdHlwZTogJ3NwYW4nLCBvcGVyYXRpb246ICcvIHJlY29yZCQvJyB9LFxuICAgICAgZGVjaXNpb246ICdhZ2dyZWdhdGUnLFxuICAgICAgcmVhc29uOiAnQWdncmVnYXRlIHBlci1yZWNvcmQgc3BhbnMgaW4gYmF0Y2ggcHJvY2Vzc29ycyBieSBkZWZhdWx0IChzdW1tYXJpemUgb24gcGFyZW50KScsXG4gICAgfSk7XG4gIH1cblxuICBidWlsdGluUnVsZXNDYWNoZS5zZXQoY2FjaGVLZXksIHJ1bGVzKTtcbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG5mdW5jdGlvbiBwaWNrTm9pc2VEZWNpc2lvbihldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBjZmc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnKTogeyBkZWNpc2lvbjogTm9pc2VEZWNpc2lvbjsgcmVhc29uOiBzdHJpbmc7IHJ1bGVJZDogc3RyaW5nOyBwcmlvcml0eTogbnVtYmVyOyBtYXRjaGVkUnVsZXNDb3VudDogbnVtYmVyIH0ge1xuICBpZiAoIWNmZy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRlY2lzaW9uOiAna2VlcCcsXG4gICAgICByZWFzb246ICdOb2lzZSByZWR1Y3Rpb24gZGlzYWJsZWQnLFxuICAgICAgcnVsZUlkOiAnZGlzYWJsZWQnLFxuICAgICAgcHJpb3JpdHk6IDAsXG4gICAgICBtYXRjaGVkUnVsZXNDb3VudDogMFxuICAgIH07XG4gIH1cblxuICAvLyBDb21iaW5lIGN1c3RvbSArIGJ1aWx0aW4gcnVsZXNcbiAgY29uc3QgYnVpbHRpblJ1bGVzID0gZ2V0QnVpbHRpblJ1bGVzKGNmZy5wcmVzZXRzKTtcbiAgY29uc3QgYWxsUnVsZXMgPSBbIC4uLmNmZy5ydWxlcywgLi4uYnVpbHRpblJ1bGVzIF07XG5cbiAgLy8gVXNlIHByaW9yaXR5LWJhc2VkIGV2YWx1YXRpb25cbiAgcmV0dXJuIGV2YWx1YXRlTm9pc2VSdWxlcyhldmVudCwgYWxsUnVsZXMsIG1hdGNoZXNSdWxlKTtcbn1cblxuZnVuY3Rpb24gZW5zdXJlU3BhbkRhdGEoc3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBjb25zdCBkYXRhID0gaXNSZWNvcmQoc3Bhbi5kYXRhKSA/IHNwYW4uZGF0YSA6IHt9O1xuICBzcGFuLmRhdGEgPSBkYXRhO1xuICByZXR1cm4gZGF0YTtcbn1cblxuZnVuY3Rpb24gYXBwZW5kQ2hlY2twb2ludChzcGFuOiBPYnNlcnZhYmlsaXR5RXZlbnQsIG5hbWU6IHN0cmluZywgdHM6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBkYXRhID0gZW5zdXJlU3BhbkRhdGEoc3Bhbik7XG4gIGNvbnN0IGNwczogQ2hlY2twb2ludFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KGRhdGEuY2hlY2twb2ludHMpKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGRhdGEuY2hlY2twb2ludHMpIHtcbiAgICAgIGlmIChpc0NoZWNrcG9pbnQoYykpIGNwcy5wdXNoKGMpO1xuICAgIH1cbiAgfVxuICBjcHMucHVzaCh7IG5hbWUsIHRzIH0pO1xuICBkYXRhLmNoZWNrcG9pbnRzID0gY3BzO1xufVxuXG5mdW5jdGlvbiBnZXRCb3VuZHMoY2ZnOiBOb2lzZVJlZHVjdGlvbkNvbmZpZykge1xuICAvLyBObyBkZWZlbnNpdmUgZGVmYXVsdHM6IGNmZyBpcyBub3JtYWxpemVkIGJ5IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoKS5cbiAgcmV0dXJuIHtcbiAgICBtYXhDaGVja3BvaW50c1BlclNwYW46IGNmZy5tYXhDaGVja3BvaW50c1BlclNwYW4sXG4gICAgbWF4QWdncmVnYXRlS2V5c1BlclNwYW46IGNmZy5tYXhBZ2dyZWdhdGVLZXlzUGVyU3BhbixcbiAgICBtYXhBZ2dyZWdhdGVFeGFtcGxlc1BlcktleTogY2ZnLm1heEFnZ3JlZ2F0ZUV4YW1wbGVzUGVyS2V5LFxuICAgIG1heEFnZ3JlZ2F0ZUVycm9yRXhhbXBsZXNQZXJLZXk6IGNmZy5tYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5LFxuICAgIGluY2x1ZGVEZWJ1Z01ldGFkYXRhOiBjZmcuaW5jbHVkZURlYnVnTWV0YWRhdGEsXG4gICAgaW5jbHVkZUV4YW1wbGVzOiBjZmcuaW5jbHVkZUV4YW1wbGVzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChcbiAgc3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjZmc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuICBjaGVja3BvaW50OiBDaGVja3BvaW50XG4pOiB2b2lkIHtcbiAgY29uc3QgeyBtYXhDaGVja3BvaW50c1BlclNwYW4gfSA9IGdldEJvdW5kcyhjZmcpO1xuICBjb25zdCBkYXRhID0gZW5zdXJlU3BhbkRhdGEoc3Bhbik7XG4gIGNvbnN0IGNwczogQ2hlY2twb2ludFtdID0gW107XG4gIGlmIChBcnJheS5pc0FycmF5KGRhdGEuY2hlY2twb2ludHMpKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGRhdGEuY2hlY2twb2ludHMpIHtcbiAgICAgIGlmIChpc0NoZWNrcG9pbnQoYykpIGNwcy5wdXNoKGMpO1xuICAgIH1cbiAgfVxuICBpZiAoY3BzLmxlbmd0aCA+PSBtYXhDaGVja3BvaW50c1BlclNwYW4pIHtcbiAgICAvLyBBZGQgb25lIHRydW5jYXRpb24gbWFya2VyIGlmIG5vdCBhbHJlYWR5IHByZXNlbnRcbiAgICBpZiAoIWNwcy5zb21lKChjKSA9PiBjLm5hbWUgPT09ICdjaGVja3BvaW50cy50cnVuY2F0ZWQnKSkge1xuICAgICAgY3BzLnB1c2goeyBuYW1lOiAnY2hlY2twb2ludHMudHJ1bmNhdGVkJywgdHM6IERhdGUubm93KCksIGRhdGE6IHsgdHJ1bmNhdGVkOiB0cnVlIH0gfSk7XG4gICAgICBkYXRhLmNoZWNrcG9pbnRzID0gY3BzO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgY3BzLnB1c2goY2hlY2twb2ludCk7XG4gIGRhdGEuY2hlY2twb2ludHMgPSBjcHM7XG59XG5cblxuZnVuY3Rpb24gYWdncmVnYXRlSW50b1BhcmVudChcbiAgcGFyZW50U3BhbjogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjZmc6IE5vaXNlUmVkdWN0aW9uQ29uZmlnLFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBraW5kOiAnc3BhbicgfCAnbG9nJyB8ICdhdWRpdCcgfCAnbWV0cmljJyB8ICdvdGhlcicsXG4gIG1ldGE/OiB7IHJ1bGVJZD86IHN0cmluZzsgcmVhc29uPzogc3RyaW5nIH1cbikge1xuICBjb25zdCB7IG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuLCBtYXhBZ2dyZWdhdGVFeGFtcGxlc1BlcktleSwgbWF4QWdncmVnYXRlRXJyb3JFeGFtcGxlc1BlcktleSwgaW5jbHVkZUV4YW1wbGVzLCBpbmNsdWRlRGVidWdNZXRhZGF0YSB9ID0gZ2V0Qm91bmRzKGNmZyk7XG4gIGNvbnN0IGRhdGEgPSBlbnN1cmVTcGFuRGF0YShwYXJlbnRTcGFuKTtcbiAgY29uc3QgbnJSYXcgPSBkYXRhLm5vaXNlUmVkdWN0aW9uO1xuICBjb25zdCBucjogTm9pc2VSZWR1Y3Rpb25EYXRhID0ge307XG4gIGlmIChpc1JlY29yZChuclJhdykpIHtcbiAgICBpZiAodHlwZW9mIG5yUmF3LmFnZ3JlZ2F0ZVRydW5jYXRlZCA9PT0gJ2Jvb2xlYW4nKSBuci5hZ2dyZWdhdGVUcnVuY2F0ZWQgPSBuclJhdy5hZ2dyZWdhdGVUcnVuY2F0ZWQ7XG4gICAgaWYgKHR5cGVvZiBuclJhdy5mb3JjZWRLZWVwID09PSAnYm9vbGVhbicpIG5yLmZvcmNlZEtlZXAgPSBuclJhdy5mb3JjZWRLZWVwO1xuXG4gICAgaWYgKGlzUmVjb3JkKG5yUmF3LmFnZ3JlZ2F0ZXMpKSB7XG4gICAgICBjb25zdCBwYXJzZWRBZ2dzOiBSZWNvcmQ8c3RyaW5nLCBBZ2dyZWdhdGVCdWNrZXQ+ID0ge307XG4gICAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG5yUmF3LmFnZ3JlZ2F0ZXMpKSB7XG4gICAgICAgIGNvbnN0IGIgPSByZWFkQWdncmVnYXRlQnVja2V0KHYpO1xuICAgICAgICBpZiAoYikgcGFyc2VkQWdnc1sgayBdID0gYjtcbiAgICAgIH1cbiAgICAgIG5yLmFnZ3JlZ2F0ZXMgPSBwYXJzZWRBZ2dzO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGFnZ3M6IFJlY29yZDxzdHJpbmcsIEFnZ3JlZ2F0ZUJ1Y2tldD4gPSBpc1JlY29yZChuci5hZ2dyZWdhdGVzKSA/IG5yLmFnZ3JlZ2F0ZXMgOiB7fTtcbiAgY29uc3Qga2V5ID0gYCR7a2luZH06JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX1gO1xuXG4gIC8vIEJvdW5kIGFnZ3JlZ2F0ZSBrZXkgY2FyZGluYWxpdHlcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGFnZ3MpO1xuICBpZiAoIWFnZ3NbIGtleSBdICYmIGtleXMubGVuZ3RoID49IG1heEFnZ3JlZ2F0ZUtleXNQZXJTcGFuKSB7XG4gICAgbnIuYWdncmVnYXRlVHJ1bmNhdGVkID0gdHJ1ZTtcbiAgICBuci5hZ2dyZWdhdGVzID0gYWdncztcbiAgICBkYXRhLm5vaXNlUmVkdWN0aW9uID0gbnI7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYnVja2V0OiBBZ2dyZWdhdGVCdWNrZXQgPSBhZ2dzWyBrZXkgXSA/PyB7XG4gICAgY291bnQ6IDAsXG4gICAgZXJyb3JDb3VudDogMCxcbiAgICBkdXJhdGlvblN1bU1zOiAwLFxuICAgIGR1cmF0aW9uTWF4TXM6IDAsXG4gICAgZXhhbXBsZXM6IFtdLFxuICAgIGVycm9yRXhhbXBsZXM6IFtdLFxuICAgIHJ1bGVzOiB7fSxcbiAgfTtcbiAgYnVja2V0LmNvdW50ICs9IDE7XG4gIGlmIChldmVudC5sZXZlbCA9PT0gJ2Vycm9yJyB8fCBldmVudC5sZXZlbCA9PT0gJ2NyaXRpY2FsJyB8fCBldmVudC5zdWNjZXNzID09PSBmYWxzZSB8fCAhIWV2ZW50LmVycm9yKSB7XG4gICAgYnVja2V0LmVycm9yQ291bnQgKz0gMTtcbiAgfVxuICBpZiAodHlwZW9mIGV2ZW50LmR1cmF0aW9uTXMgPT09ICdudW1iZXInKSB7XG4gICAgYnVja2V0LmR1cmF0aW9uU3VtTXMgKz0gZXZlbnQuZHVyYXRpb25NcztcbiAgICBidWNrZXQuZHVyYXRpb25NYXhNcyA9IE1hdGgubWF4KGJ1Y2tldC5kdXJhdGlvbk1heE1zLCBldmVudC5kdXJhdGlvbk1zKTtcbiAgfVxuXG4gIGlmIChpbmNsdWRlRGVidWdNZXRhZGF0YSAmJiBtZXRhPy5ydWxlSWQpIHtcbiAgICBidWNrZXQucnVsZXNbIG1ldGEucnVsZUlkIF0gPSAoYnVja2V0LnJ1bGVzWyBtZXRhLnJ1bGVJZCBdID8/IDApICsgMTtcbiAgfVxuXG4gIGlmIChpbmNsdWRlRXhhbXBsZXMpIHtcbiAgICBjb25zdCBleCA9IHtcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgIG9wZXJhdGlvbjogZXZlbnQub3BlcmF0aW9uLFxuICAgICAgc291cmNlOiBldmVudC5zb3VyY2UsXG4gICAgICBlbnRpdHlOYW1lOiBldmVudC5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IGV2ZW50LmVudGl0eUlkLFxuICAgICAgZHVyYXRpb25NczogZXZlbnQuZHVyYXRpb25NcyxcbiAgICAgIHN1Y2Nlc3M6IGV2ZW50LnN1Y2Nlc3MsXG4gICAgICBsZXZlbDogZXZlbnQubGV2ZWwsXG4gICAgICBydWxlSWQ6IG1ldGE/LnJ1bGVJZCxcbiAgICB9O1xuICAgIGlmIChidWNrZXQuZXhhbXBsZXMubGVuZ3RoIDwgbWF4QWdncmVnYXRlRXhhbXBsZXNQZXJLZXkpIHtcbiAgICAgIGJ1Y2tldC5leGFtcGxlcy5wdXNoKGV4KTtcbiAgICB9XG4gICAgY29uc3QgaXNFcnIgPSBldmVudC5sZXZlbCA9PT0gJ2Vycm9yJyB8fCBldmVudC5sZXZlbCA9PT0gJ2NyaXRpY2FsJyB8fCBldmVudC5zdWNjZXNzID09PSBmYWxzZSB8fCAhIWV2ZW50LmVycm9yO1xuICAgIGlmIChpc0VyciAmJiBidWNrZXQuZXJyb3JFeGFtcGxlcy5sZW5ndGggPCBtYXhBZ2dyZWdhdGVFcnJvckV4YW1wbGVzUGVyS2V5KSB7XG4gICAgICBidWNrZXQuZXJyb3JFeGFtcGxlcy5wdXNoKHtcbiAgICAgICAgLi4uZXgsXG4gICAgICAgIGVycm9yOiBldmVudC5lcnJvciA/IHsgdHlwZTogZXZlbnQuZXJyb3IudHlwZSwgbWVzc2FnZTogZXZlbnQuZXJyb3IubWVzc2FnZSB9IDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYWdnc1sga2V5IF0gPSBidWNrZXQ7XG5cbiAgbnIuYWdncmVnYXRlcyA9IGFnZ3M7XG4gIGRhdGEubm9pc2VSZWR1Y3Rpb24gPSBucjtcbn1cblxuZnVuY3Rpb24gZXN0aW1hdGVCeXRlcyh2YWx1ZTogdW5rbm93bik6IG51bWJlciB7XG4gIHRyeSB7XG4gICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiAwO1xuICAgIHJldHVybiBCdWZmZXIuYnl0ZUxlbmd0aChKU09OLnN0cmluZ2lmeSh2YWx1ZSksICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAwO1xuICB9XG59XG5cbmZ1bmN0aW9uIGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBudW1iZXIge1xuICAvLyBPbmx5IGNvdW50IGZpZWxkcyB3ZSB0eXBpY2FsbHkgY29uc2lkZXIgXCJwYXlsb2FkIG5vaXNlXCIuXG4gIHJldHVybiAoXG4gICAgZXN0aW1hdGVCeXRlcyhldmVudC5kYXRhKSArXG4gICAgZXN0aW1hdGVCeXRlcyhldmVudC5hdHRyaWJ1dGVzKSArXG4gICAgZXN0aW1hdGVCeXRlcyhldmVudC5tZXRhZGF0YSkgK1xuICAgIGVzdGltYXRlQnl0ZXMoZXZlbnQuY29udGV4dCkgK1xuICAgIGVzdGltYXRlQnl0ZXMoZXZlbnQuYWN0b3IpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseU5vaXNlUmVkdWN0aW9uKFxuICBpbnB1dEV2ZW50czogT2JzZXJ2YWJpbGl0eUV2ZW50W10sXG4gIGNmZzogTm9pc2VSZWR1Y3Rpb25Db25maWdcbik6IE5vaXNlUmVkdWN0aW9uUmVzdWx0IHtcbiAgY29uc3Qgc3RhdHM6IE5vaXNlU3RhdHMgPSB7XG4gICAgZHJvcHBlZDogMCxcbiAgICBmb2xkZWQ6IDAsXG4gICAgYWdncmVnYXRlZDogMCxcbiAgICBkb3duZ3JhZGVkOiAwLFxuICAgIGtlcHQ6IDAsXG4gICAgYXBwcm94Qnl0ZXNTYXZlZDogMCxcbiAgICBkcm9wcGVkQnlUeXBlOiB7fSxcbiAgICBkcm9wcGVkQnlPcGVyYXRpb246IHt9LFxuICAgIGZvbGRlZEJ5VHlwZToge30sXG4gICAgZm9sZGVkQnlPcGVyYXRpb246IHt9LFxuICB9O1xuXG4gIGlmICghY2ZnLmVuYWJsZWQpIHtcbiAgICByZXR1cm4geyBldmVudHM6IGlucHV0RXZlbnRzLCBzdGF0czogeyAuLi5zdGF0cywga2VwdDogaW5wdXRFdmVudHMubGVuZ3RoIH0gfTtcbiAgfVxuXG4gIC8vIEluZGV4IHNwYW5zIGJ5IGlkIGZvciBmb2xkaW5nICsgc3VtbWFyaWVzLlxuICBjb25zdCBzcGFuQnlJZCA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5RXZlbnQ+KCk7XG4gIGNvbnN0IHNwYW5TdGFydEJ5SWQgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUV2ZW50PigpO1xuICBmb3IgKGNvbnN0IGUgb2YgaW5wdXRFdmVudHMpIHtcbiAgICBpZiAoZS50eXBlID09PSAnc3BhbicgJiYgZS5vYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICAgIHNwYW5CeUlkLnNldChlLm9ic2VydmFiaWxpdHlMb2dJZCwgZSk7XG4gICAgfVxuICAgIGlmIChlLnR5cGUgPT09ICdzcGFuLnN0YXJ0JyAmJiBlLm9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgICAgc3BhblN0YXJ0QnlJZC5zZXQoZS5vYnNlcnZhYmlsaXR5TG9nSWQsIGUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIElmIHdlIGRlY2lkZSB0byBEUk9QIGEgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkLCB3ZSBtdXN0IGFsc28gRFJPUCBpdHMgT1RFTC1vbmx5IHNwYW4uc3RhcnQsXG4gIC8vIG90aGVyd2lzZSBPVEVMIGJhY2tlbmQgd2lsbCBjcmVhdGUgdGhlIHNwYW4gYW5kIGxhdGVyIFwib3JwaGFuLWVuZFwiIGl0IGluIGZsdXNoKCksIHdoaWNoIGlzIHB1cmUgbm9pc2UuXG4gIGNvbnN0IHNwYW5EZWNpc2lvbkJ5SWQgPSBuZXcgTWFwPHN0cmluZywgTm9pc2VEZWNpc2lvbj4oKTtcbiAgZm9yIChjb25zdCBlIG9mIGlucHV0RXZlbnRzKSB7XG4gICAgaWYgKGUudHlwZSAhPT0gJ3NwYW4nKSBjb250aW51ZTtcbiAgICBjb25zdCBwaWNrZWQgPSBwaWNrTm9pc2VEZWNpc2lvbihlLCBjZmcpO1xuICAgIGNvbnN0IGlzSGFyZFNpZ25hbCA9IGUubGV2ZWwgPT09ICdlcnJvcidcbiAgICAgIHx8IGUubGV2ZWwgPT09ICdjcml0aWNhbCdcbiAgICAgIHx8IGUuc3VjY2VzcyA9PT0gZmFsc2VcbiAgICAgIHx8ICEhZS5lcnJvcjtcbiAgICBjb25zdCBmaW5hbERlY2lzaW9uOiBOb2lzZURlY2lzaW9uID0gKGlzSGFyZFNpZ25hbCAmJiAhZS5jYXB0dXJlPy5ub2lzZSkgPyAna2VlcCcgOiBwaWNrZWQuZGVjaXNpb247XG4gICAgc3BhbkRlY2lzaW9uQnlJZC5zZXQoZS5vYnNlcnZhYmlsaXR5TG9nSWQsIGZpbmFsRGVjaXNpb24pO1xuICB9XG5cbiAgLy8gQWdncmVnYXRlIGRyb3BwZWQvZm9sZGVkL2FnZ3JlZ2F0ZWQgY291bnRzIGJ5IHBhcmVudCBzcGFuIGlkICgrIHJ1bGUgc3RhdHMgKyBieXRlcyBzYXZlZCkuXG4gIHR5cGUgUGFyZW50U3VtbWFyeSA9IHtcbiAgICBkcm9wcGVkOiBudW1iZXI7XG4gICAgZm9sZGVkOiBudW1iZXI7XG4gICAgYWdncmVnYXRlZDogbnVtYmVyO1xuICAgIGJ5T3A6IFJlY29yZDxzdHJpbmcsIG51bWJlcj47XG4gICAgYnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgIGJ5UnVsZUlkOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+O1xuICAgIGFwcHJveEJ5dGVzU2F2ZWQ6IG51bWJlcjtcbiAgfTtcbiAgY29uc3QgcGVyUGFyZW50U3VtbWFyeSA9IG5ldyBNYXA8c3RyaW5nLCBQYXJlbnRTdW1tYXJ5PigpO1xuICBjb25zdCBnZXRQYXJlbnRBZ2cgPSAocGFyZW50SWQ6IHN0cmluZykgPT4ge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gcGVyUGFyZW50U3VtbWFyeS5nZXQocGFyZW50SWQpO1xuICAgIGlmIChleGlzdGluZykgcmV0dXJuIGV4aXN0aW5nO1xuICAgIGNvbnN0IGNyZWF0ZWQ6IFBhcmVudFN1bW1hcnkgPSB7IGRyb3BwZWQ6IDAsIGZvbGRlZDogMCwgYWdncmVnYXRlZDogMCwgYnlPcDoge30sIGJ5VHlwZToge30sIGJ5UnVsZUlkOiB7fSwgYXBwcm94Qnl0ZXNTYXZlZDogMCB9O1xuICAgIHBlclBhcmVudFN1bW1hcnkuc2V0KHBhcmVudElkLCBjcmVhdGVkKTtcbiAgICByZXR1cm4gY3JlYXRlZDtcbiAgfTtcblxuICBjb25zdCBvdXRwdXQ6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgZm9yIChjb25zdCBldmVudCBvZiBpbnB1dEV2ZW50cykge1xuICAgIGNvbnN0IHBpY2tlZCA9IHBpY2tOb2lzZURlY2lzaW9uKGV2ZW50LCBjZmcpO1xuICAgIGNvbnN0IGRlY2lzaW9uID0gcGlja2VkLmRlY2lzaW9uO1xuICAgIGNvbnN0IHsgaW5jbHVkZURlYnVnTWV0YWRhdGEgfSA9IGdldEJvdW5kcyhjZmcpO1xuXG4gICAgLy8gS2VlcC9kcm9wIHNwYW4uc3RhcnQgYmFzZWQgb24gdGhlIGZpbmFsIGRlY2lzaW9uIGZvciBpdHMgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkLlxuICAgIC8vIFRoaXMgcHJlc2VydmVzIE9URUwgY29ycmVjdG5lc3MgYW5kIHJlZHVjZXMgbm9pc2UgKG5vIG9ycGhhbmVkIE9URUwgc3BhbnMpLlxuICAgIGlmIChldmVudC50eXBlID09PSAnc3Bhbi5zdGFydCcpIHtcbiAgICAgIGNvbnN0IHNwYW5EZWNpc2lvbiA9IHNwYW5EZWNpc2lvbkJ5SWQuZ2V0KGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICAvLyBJZiB3ZSBhcmUgbm90IGVtaXR0aW5nIHRoZSBjb25zb2xpZGF0ZWQgc3BhbiByZWNvcmQgKGRyb3AvYWdncmVnYXRlKSwgd2Ugc2hvdWxkIG5vdCBlbWl0IHNwYW4uc3RhcnQgZWl0aGVyLlxuICAgICAgaWYgKHNwYW5EZWNpc2lvbiA9PT0gJ2Ryb3AnIHx8IHNwYW5EZWNpc2lvbiA9PT0gJ2FnZ3JlZ2F0ZScpIHtcbiAgICAgICAgc3RhdHMuZHJvcHBlZCsrO1xuICAgICAgICBpbmMoc3RhdHMuZHJvcHBlZEJ5VHlwZSwgZXZlbnQudHlwZSk7XG4gICAgICAgIGluYyhzdGF0cy5kcm9wcGVkQnlPcGVyYXRpb24sIGV2ZW50Lm9wZXJhdGlvbik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gRGVmYXVsdCBrZWVwIGZvciBzcGFuLnN0YXJ0IChPVEVMLW9ubHkpIGlmIHRoZSBzcGFuIGl0c2VsZiBpcyBrZXB0LlxuICAgICAgb3V0cHV0LnB1c2goZXZlbnQpO1xuICAgICAgc3RhdHMua2VwdCsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTk9JU0UgUkVEVUNUSU9OIERFQ0lTSU9OIEhBTkRMSU5HXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRGVjaXNpb25zIGFyZSBhcHBsaWVkIGluIHRoaXMgb3JkZXI6XG4gICAgLy8gMS4gSGFyZCBzaWduYWxzIChlcnJvcnMvZmFpbHVyZXMpIOKGkiBBTFdBWVMga2VwdCAodW5sZXNzIGV4cGxpY2l0bHkgb3ZlcnJpZGRlbilcbiAgICAvLyAyLiBrZWVwIOKGkiBFdmVudCBwYXNzZXMgdGhyb3VnaCB1bmNoYW5nZWRcbiAgICAvLyAzLiBmb2xkIOKGkiBFdmVudCBjb2xsYXBzZWQgaW50byBwYXJlbnQgc3BhbiBhcyBhIGNoZWNrcG9pbnQgKGNoaWxkIGV2ZW50cyBvbmx5KVxuICAgIC8vIDQuIGRyb3Ag4oaSIEV2ZW50IHJlbW92ZWQgZW50aXJlbHkgKHdvcmtzIGZvciByb290IG9yIGNoaWxkKVxuICAgIC8vIDUuIGFnZ3JlZ2F0ZSDihpIgRXZlbnQgc3VtbWFyaXplZCBpbnRvIHBhcmVudCBzcGFuIChjaGlsZCBldmVudHMgb25seSlcbiAgICAvLyA2LiBkb3duZ3JhZGUg4oaSIEV2ZW50IGtlcHQgYnV0IHN0cmlwcGVkIG9mIGhlYXZ5IGZpZWxkc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gTmV2ZXIgZHJvcCBlcnJvcnMvY3JpdGljYWwgb3V0cmlnaHQgKHBvbGljeSBzYWZldHkgbmV0KS4gVXNlcnMgY2FuIHN0aWxsIGZvcmNlIGRyb3AgdmlhIG92ZXJyaWRlLlxuICAgIGNvbnN0IGlzSGFyZFNpZ25hbCA9IGV2ZW50LmxldmVsID09PSAnZXJyb3InIHx8IGV2ZW50LmxldmVsID09PSAnY3JpdGljYWwnIHx8IGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlIHx8ICEhZXZlbnQuZXJyb3I7XG4gICAgaWYgKGlzSGFyZFNpZ25hbCAmJiAhZXZlbnQuY2FwdHVyZT8ubm9pc2UpIHtcbiAgICAgIG91dHB1dC5wdXNoKGV2ZW50KTtcbiAgICAgIHN0YXRzLmtlcHQrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChkZWNpc2lvbiA9PT0gJ2tlZXAnKSB7XG4gICAgICBvdXRwdXQucHVzaChldmVudCk7XG4gICAgICBzdGF0cy5rZXB0Kys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBwYXJlbnRJZCA9IGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyB1bmRlZmluZWQ7XG4gICAgY29uc3QgcGFyZW50U3BhbiA9IHBhcmVudElkID8gc3BhbkJ5SWQuZ2V0KHBhcmVudElkKSA6IHVuZGVmaW5lZDtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEZPTEQ6IENvbGxhcHNlIGV2ZW50IGludG8gcGFyZW50IGFzIGNoZWNrcG9pbnQgKGNoaWxkIGV2ZW50cyBvbmx5KVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGlmIChkZWNpc2lvbiA9PT0gJ2ZvbGQnICYmIHBhcmVudFNwYW4pIHtcbiAgICAgIC8vIFByZXNlcnZlIEVNRi9PVEVMIG1ldHJpY3Mgd2l0aG91dCBrZWVwaW5nIHRoZSBub2lzeSBzdGFuZGFsb25lIGV2ZW50LlxuICAgICAgaWYgKGV2ZW50Lm1ldHJpY3MgJiYgT2JqZWN0LmtleXMoZXZlbnQubWV0cmljcykubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBwYXJlbnRNZXRyaWNzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0gcGFyZW50U3Bhbi5tZXRyaWNzID8/IHt9O1xuICAgICAgICBjb25zdCBtZXJnZWQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7IC4uLnBhcmVudE1ldHJpY3MgfTtcbiAgICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC5tZXRyaWNzKSkge1xuICAgICAgICAgIG1lcmdlZFsgayBdID0gKG1lcmdlZFsgayBdID8/IDApICsgdjtcbiAgICAgICAgfVxuICAgICAgICBwYXJlbnRTcGFuLm1ldHJpY3MgPSBtZXJnZWQ7XG4gICAgICAgIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKHBhcmVudFNwYW4sIGNmZywge1xuICAgICAgICAgIG5hbWU6IGBtZXRyaWNzLmZvbGRlZDoke2V2ZW50Lm9wZXJhdGlvbiA/PyBldmVudC50eXBlfWAsXG4gICAgICAgICAgdHM6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICAgIG1ldHJpY3M6IHsgLi4uZXZlbnQubWV0cmljcyB9LFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRm9sZCByZXByZXNlbnRhdGlvbjogYWRkIGEgc2luZ2xlIHN0cnVjdHVyZWQgY2hlY2twb2ludCBvbnRvIHRoZSBwYXJlbnQgc3Bhbi5cbiAgICAgIC8vIENoZWNrcG9pbnQgaXMgQUxXQVlTIGNyZWF0ZWQgKGNvcmUgZGVzaWduKSwgYnV0IGRhdGEgcGF5bG9hZCBpcyBtaW5pbWFsIGluIHByb2R1Y3Rpb24uXG4gICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChwYXJlbnRTcGFuLCBjZmcsIHtcbiAgICAgICAgbmFtZTogYGZvbGQ6JHtldmVudC50eXBlfToke2V2ZW50Lm9wZXJhdGlvbiA/PyBldmVudC50eXBlfWAsXG4gICAgICAgIHRzOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgICAgdGFnczoge1xuICAgICAgICAgIGZvbGRlZFR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsLFxuICAgICAgICAgIC4uLihldmVudC5lbnRpdHlOYW1lID8geyBlbnRpdHlOYW1lOiBldmVudC5lbnRpdHlOYW1lIH0gOiB7fSksXG4gICAgICAgIH0sXG4gICAgICAgIC8vIE9ubHkgaW5jbHVkZSBkZWJ1ZyBtZXRhZGF0YSBpZiBmbGFnIGlzIGVuYWJsZWRcbiAgICAgICAgLi4uKGluY2x1ZGVEZWJ1Z01ldGFkYXRhID8ge1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIC4uLihldmVudC5lbnRpdHlJZCA/IHsgZW50aXR5SWQ6IGV2ZW50LmVudGl0eUlkIH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oZXZlbnQuc291cmNlID8geyBzb3VyY2U6IGV2ZW50LnNvdXJjZSB9IDoge30pLFxuICAgICAgICAgICAgLi4uKHBpY2tlZC5ydWxlSWQgPyB7IHJ1bGVJZDogcGlja2VkLnJ1bGVJZCB9IDoge30pLFxuICAgICAgICAgICAgLi4uKHBpY2tlZC5yZWFzb24gPyB7IHJlYXNvbjogcGlja2VkLnJlYXNvbiB9IDoge30pLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0gOiB7fSksXG4gICAgICAgIC4uLihldmVudC5lcnJvciA/IHsgZXJyb3I6IGV2ZW50LmVycm9yIH0gOiB7fSksXG4gICAgICB9KTtcblxuICAgICAgc3RhdHMuZm9sZGVkKys7XG4gICAgICBpbmMoc3RhdHMuZm9sZGVkQnlUeXBlLCBldmVudC50eXBlKTtcbiAgICAgIGluYyhzdGF0cy5mb2xkZWRCeU9wZXJhdGlvbiwgZXZlbnQub3BlcmF0aW9uKTtcblxuICAgICAgY29uc3QgYWdnID0gZ2V0UGFyZW50QWdnKHBhcmVudElkISk7XG4gICAgICBhZ2cuZm9sZGVkKys7XG4gICAgICBpbmMoYWdnLmJ5VHlwZSwgZXZlbnQudHlwZSk7XG4gICAgICBpbmMoYWdnLmJ5T3AsIGV2ZW50Lm9wZXJhdGlvbik7XG4gICAgICBpZiAoaW5jbHVkZURlYnVnTWV0YWRhdGEgJiYgcGlja2VkLnJ1bGVJZCkge1xuICAgICAgICBhZ2cuYnlSdWxlSWRbIHBpY2tlZC5ydWxlSWQgXSA9IChhZ2cuYnlSdWxlSWRbIHBpY2tlZC5ydWxlSWQgXSA/PyAwKSArIDE7XG4gICAgICB9XG4gICAgICBpZiAoaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICAgICAgY29uc3Qgc2F2ZWQgPSBlc3RpbWF0ZUV2ZW50SGVhdnlCeXRlcyhldmVudCk7XG4gICAgICAgIGFnZy5hcHByb3hCeXRlc1NhdmVkICs9IHNhdmVkO1xuICAgICAgICBzdGF0cy5hcHByb3hCeXRlc1NhdmVkICs9IHNhdmVkO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRFJPUDogUmVtb3ZlIGV2ZW50IGVudGlyZWx5ICh3b3JrcyBmb3Igcm9vdCBvciBjaGlsZCBldmVudHMpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgaWYgKGRlY2lzaW9uID09PSAnZHJvcCcpIHtcbiAgICAgIHN0YXRzLmRyb3BwZWQrKztcbiAgICAgIGluYyhzdGF0cy5kcm9wcGVkQnlUeXBlLCBldmVudC50eXBlKTtcbiAgICAgIGluYyhzdGF0cy5kcm9wcGVkQnlPcGVyYXRpb24sIGV2ZW50Lm9wZXJhdGlvbik7XG5cbiAgICAgIC8vIElmIGV2ZW50IGhhcyBhIHBhcmVudCwgcHJlc2VydmUgaXRzIG1ldHJpY3MgYW5kIHVwZGF0ZSBwYXJlbnQncyBub2lzZSBzdW1tYXJ5XG4gICAgICBpZiAocGFyZW50U3BhbiAmJiBwYXJlbnRJZCkge1xuICAgICAgICAvLyBQcmVzZXJ2ZSBtZXRyaWNzIGluIHBhcmVudCBzcGFuXG4gICAgICAgIGlmIChldmVudC5tZXRyaWNzICYmIE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBwYXJlbnRTcGFuLm1ldHJpY3MgPSB7IC4uLihwYXJlbnRTcGFuLm1ldHJpY3MgPz8ge30pLCAuLi5ldmVudC5tZXRyaWNzIH07XG4gICAgICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQocGFyZW50U3BhbiwgY2ZnLCB7XG4gICAgICAgICAgICBuYW1lOiBgbWV0cmljcy5mb2xkZWQ6JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX1gLFxuICAgICAgICAgICAgdHM6IGV2ZW50LnRpbWVzdGFtcE1zLFxuICAgICAgICAgICAgbWV0cmljczogZXZlbnQubWV0cmljcyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFVwZGF0ZSBwYXJlbnQncyBub2lzZSByZWR1Y3Rpb24gc3VtbWFyeVxuICAgICAgICBjb25zdCBhZ2cgPSBnZXRQYXJlbnRBZ2cocGFyZW50SWQpO1xuICAgICAgICBhZ2cuZHJvcHBlZCsrO1xuICAgICAgICBpbmMoYWdnLmJ5VHlwZSwgZXZlbnQudHlwZSk7XG4gICAgICAgIGluYyhhZ2cuYnlPcCwgZXZlbnQub3BlcmF0aW9uKTtcbiAgICAgICAgaWYgKGluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgICAgaWYgKHBpY2tlZC5ydWxlSWQpIGFnZy5ieVJ1bGVJZFsgcGlja2VkLnJ1bGVJZCBdID0gKGFnZy5ieVJ1bGVJZFsgcGlja2VkLnJ1bGVJZCBdID8/IDApICsgMTtcbiAgICAgICAgICBjb25zdCBzYXZlZCA9IGVzdGltYXRlRXZlbnRIZWF2eUJ5dGVzKGV2ZW50KTtcbiAgICAgICAgICBhZ2cuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgICAgICBzdGF0cy5hcHByb3hCeXRlc1NhdmVkICs9IHNhdmVkO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb250aW51ZTsgLy8gRXZlbnQgaXMgZHJvcHBlZCAtIHNraXAgdG8gbmV4dFxuICAgIH1cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFHR1JFR0FURTogU3VtbWFyaXplIGV2ZW50IGludG8gcGFyZW50IChjaGlsZCBldmVudHMgb25seSlcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBpZiAoZGVjaXNpb24gPT09ICdhZ2dyZWdhdGUnKSB7XG4gICAgICBpZiAoIXBhcmVudFNwYW4pIHtcbiAgICAgICAgLy8gQ2FuJ3QgYWdncmVnYXRlIHdpdGhvdXQgYSBwYXJlbnQgLSBrZWVwIHRoZSBldmVudFxuICAgICAgICBvdXRwdXQucHVzaChldmVudCk7XG4gICAgICAgIHN0YXRzLmtlcHQrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIFByZXNlcnZlIG1ldHJpY3MgaW4gcGFyZW50IHNwYW5cbiAgICAgIGlmIChldmVudC5tZXRyaWNzICYmIE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcGFyZW50U3Bhbi5tZXRyaWNzID0geyAuLi4ocGFyZW50U3Bhbi5tZXRyaWNzID8/IHt9KSwgLi4uZXZlbnQubWV0cmljcyB9O1xuICAgICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChwYXJlbnRTcGFuLCBjZmcsIHtcbiAgICAgICAgICBuYW1lOiBgbWV0cmljcy5mb2xkZWQ6JHtldmVudC5vcGVyYXRpb24gPz8gZXZlbnQudHlwZX1gLFxuICAgICAgICAgIHRzOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgICAgICBtZXRyaWNzOiBldmVudC5tZXRyaWNzLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQWdncmVnYXRlIGV2ZW50IGRldGFpbHMgaW50byBwYXJlbnQncyBzdW1tYXJ5XG4gICAgICBjb25zdCBraW5kOiAnc3BhbicgfCAnbG9nJyB8ICdhdWRpdCcgfCAnbWV0cmljJyB8ICdvdGhlcicgPVxuICAgICAgICBldmVudC50eXBlID09PSAnc3BhbicgPyAnc3BhbidcbiAgICAgICAgICA6IGV2ZW50LnR5cGUgPT09ICdsb2cnID8gJ2xvZydcbiAgICAgICAgICAgIDogZXZlbnQudHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpID8gJ2F1ZGl0J1xuICAgICAgICAgICAgICA6IGV2ZW50LnR5cGUgPT09ICdtZXRyaWMnID8gJ21ldHJpYydcbiAgICAgICAgICAgICAgICA6ICdvdGhlcic7XG4gICAgICBhZ2dyZWdhdGVJbnRvUGFyZW50KHBhcmVudFNwYW4sIGNmZywgZXZlbnQsIGtpbmQsIHsgcnVsZUlkOiBwaWNrZWQucnVsZUlkLCByZWFzb246IHBpY2tlZC5yZWFzb24gfSk7XG5cbiAgICAgIC8vIEFkZCBjaGVja3BvaW50IGZvciB0aW1lbGluZSB0cmFja2luZ1xuICAgICAgYXBwZW5kQ2hlY2twb2ludEJvdW5kZWQocGFyZW50U3BhbiwgY2ZnLCB7XG4gICAgICAgIG5hbWU6IGBhZ2dyZWdhdGU6JHtldmVudC50eXBlfToke2V2ZW50Lm9wZXJhdGlvbiA/PyBldmVudC50eXBlfWAsXG4gICAgICAgIHRzOiBldmVudC50aW1lc3RhbXBNcyxcbiAgICAgICAgLi4uKGluY2x1ZGVEZWJ1Z01ldGFkYXRhID8ge1xuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIC4uLihwaWNrZWQucnVsZUlkID8geyBydWxlSWQ6IHBpY2tlZC5ydWxlSWQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihwaWNrZWQucmVhc29uID8geyByZWFzb246IHBpY2tlZC5yZWFzb24gfSA6IHt9KSxcbiAgICAgICAgICB9LFxuICAgICAgICB9IDoge30pLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFVwZGF0ZSBzdGF0c1xuICAgICAgc3RhdHMuYWdncmVnYXRlZCsrO1xuICAgICAgY29uc3QgYWdnID0gZ2V0UGFyZW50QWdnKHBhcmVudElkISk7XG4gICAgICBhZ2cuYWdncmVnYXRlZCsrO1xuICAgICAgaW5jKGFnZy5ieVR5cGUsIGV2ZW50LnR5cGUpO1xuICAgICAgaW5jKGFnZy5ieU9wLCBldmVudC5vcGVyYXRpb24pO1xuICAgICAgaWYgKGluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgIGlmIChwaWNrZWQucnVsZUlkKSBhZ2cuYnlSdWxlSWRbIHBpY2tlZC5ydWxlSWQgXSA9IChhZ2cuYnlSdWxlSWRbIHBpY2tlZC5ydWxlSWQgXSA/PyAwKSArIDE7XG4gICAgICAgIGNvbnN0IHNhdmVkID0gZXN0aW1hdGVFdmVudEhlYXZ5Qnl0ZXMoZXZlbnQpO1xuICAgICAgICBhZ2cuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgICAgc3RhdHMuYXBwcm94Qnl0ZXNTYXZlZCArPSBzYXZlZDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlOyAvLyBFdmVudCBpcyBhZ2dyZWdhdGVkIC0gc2tpcCB0byBuZXh0XG4gICAgfVxuXG4gICAgaWYgKGRlY2lzaW9uID09PSAnZG93bmdyYWRlJykge1xuICAgICAgLy8gS2VlcCB0aGUgZXZlbnQsIGJ1dCBzdHJpcCBoZWF2eSBwYXlsb2FkIGZpZWxkcyB0byByZWR1Y2UgRHluYW1vL0Nsb3VkV2F0Y2ggbm9pc2UuXG4gICAgICAvLyAoSGFyZCBzaWduYWxzIHdlcmUgYWxyZWFkeSBoYW5kbGVkIGVhcmxpZXIuKVxuICAgICAgY29uc3QgdW5pdCA9IGlzUmVjb3JkKGV2ZW50LmF0dHJpYnV0ZXMpICYmIHR5cGVvZiBldmVudC5hdHRyaWJ1dGVzLnVuaXQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gZXZlbnQuYXR0cmlidXRlcy51bml0XG4gICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBkb3duZ3JhZGVkOiBPYnNlcnZhYmlsaXR5RXZlbnQgPSB7XG4gICAgICAgIC4uLmV2ZW50LFxuICAgICAgICBkYXRhOiB1bmRlZmluZWQsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICBub2lzZVJlZHVjZWQ6ICdkb3duZ3JhZGVkJyxcbiAgICAgICAgICAuLi4odW5pdCA/IHsgdW5pdCB9IDoge30pLFxuICAgICAgICB9LFxuICAgICAgICBtZXRhZGF0YTogdW5kZWZpbmVkLFxuICAgICAgICBjb250ZXh0OiB1bmRlZmluZWQsXG4gICAgICAgIC8vIGtlZXAgYWN0b3IgbWluaW1hbCBpZiBwcmVzZW50XG4gICAgICAgIGFjdG9yOiBldmVudC5hY3RvciA/IHtcbiAgICAgICAgICByZXF1ZXN0SWQ6IGV2ZW50LmFjdG9yLnJlcXVlc3RJZCxcbiAgICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LmFjdG9yLnRpbWVzdGFtcCxcbiAgICAgICAgICBhY3RvcklkOiBldmVudC5hY3Rvci5hY3RvcklkLFxuICAgICAgICAgIGFjdG9yVHlwZTogZXZlbnQuYWN0b3IuYWN0b3JUeXBlLFxuICAgICAgICAgIHRlbmFudElkOiBldmVudC5hY3Rvci50ZW5hbnRJZCxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBldmVudC5hY3Rvci5jb3JyZWxhdGlvbklkLFxuICAgICAgICB9IDogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICAgIG91dHB1dC5wdXNoKGRvd25ncmFkZWQpO1xuICAgICAgc3RhdHMuZG93bmdyYWRlZCsrO1xuICAgICAgc3RhdHMua2VwdCsrO1xuICAgICAgaWYgKGluY2x1ZGVEZWJ1Z01ldGFkYXRhKSB7XG4gICAgICAgIC8vIEFwcHJveCBieXRlcyBzYXZlZCA9IGhlYXZ5IGJ5dGVzIHJlbW92ZWQgZnJvbSB0aGUgZXZlbnQuXG4gICAgICAgIGNvbnN0IHNhdmVkID0gZXN0aW1hdGVFdmVudEhlYXZ5Qnl0ZXMoZXZlbnQpO1xuICAgICAgICBzdGF0cy5hcHByb3hCeXRlc1NhdmVkICs9IHNhdmVkO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gSWYgd2UgY2FuJ3QgZm9sZC9kcm9wIHNhZmVseSAobm8gcGFyZW50IHNwYW4pLCBrZWVwIGl0LlxuICAgIG91dHB1dC5wdXNoKGV2ZW50KTtcbiAgICBzdGF0cy5rZXB0Kys7XG4gIH1cblxuICAvLyBBdHRhY2ggcGVyLXBhcmVudCBzdW1tYXJ5IHBheWxvYWRzIChzbWFsbCwgVUktdmlzaWJsZSkgYW5kIGEgbWFya2VyIGNoZWNrcG9pbnQuXG4gIGlmIChjZmcuZW1pdFN1bW1hcmllcyAhPT0gZmFsc2UpIHtcbiAgICBmb3IgKGNvbnN0IFsgcGFyZW50SWQsIHN1bW1hcnkgXSBvZiBwZXJQYXJlbnRTdW1tYXJ5LmVudHJpZXMoKSkge1xuICAgICAgY29uc3QgcGFyZW50ID0gc3BhbkJ5SWQuZ2V0KHBhcmVudElkKTtcbiAgICAgIGlmICghcGFyZW50KSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGRhdGEgPSBlbnN1cmVTcGFuRGF0YShwYXJlbnQpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBpc1JlY29yZChkYXRhLm5vaXNlUmVkdWN0aW9uKSA/IGRhdGEubm9pc2VSZWR1Y3Rpb24gOiB7fTtcbiAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIGJhc2ljIGNvdW50c1xuICAgICAgZXhpc3RpbmcuZHJvcHBlZCA9IHN1bW1hcnkuZHJvcHBlZDtcbiAgICAgIGV4aXN0aW5nLmZvbGRlZCA9IHN1bW1hcnkuZm9sZGVkO1xuICAgICAgZXhpc3RpbmcuYWdncmVnYXRlZCA9IHN1bW1hcnkuYWdncmVnYXRlZDtcbiAgICAgIC8vIEFsd2F5cyBpbmNsdWRlIHR5cGUgYnJlYWtkb3duIChtaW5pbWFsIG92ZXJoZWFkLCBoaWdoIHZhbHVlKVxuICAgICAgZXhpc3RpbmcuYnlUeXBlID0gc3VtbWFyeS5ieVR5cGU7XG5cbiAgICAgIC8vIERlYnVnIG1ldGFkYXRhOiBkZXRhaWxlZCBicmVha2Rvd25zXG4gICAgICBpZiAoZ2V0Qm91bmRzKGNmZykuaW5jbHVkZURlYnVnTWV0YWRhdGEpIHtcbiAgICAgICAgZXhpc3RpbmcuYnlSdWxlSWQgPSBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgICAgICAgT2JqZWN0LmVudHJpZXMoc3VtbWFyeS5ieVJ1bGVJZClcbiAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBiWyAxIF0gLSBhWyAxIF0pXG4gICAgICAgICAgICAuc2xpY2UoMCwgMTApXG4gICAgICAgICk7XG4gICAgICAgIGV4aXN0aW5nLmFwcHJveEJ5dGVzU2F2ZWQgPSBzdW1tYXJ5LmFwcHJveEJ5dGVzU2F2ZWQ7XG4gICAgICAgIC8vIEtlZXAgb3Agc3VtbWFyeSBib3VuZGVkICh0b3AgMTApXG4gICAgICAgIGV4aXN0aW5nLmJ5T3BlcmF0aW9uID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHN1bW1hcnkuYnlPcClcbiAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBiWyAxIF0gLSBhWyAxIF0pXG4gICAgICAgICAgICAuc2xpY2UoMCwgMTApXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBkYXRhLm5vaXNlUmVkdWN0aW9uID0gZXhpc3Rpbmc7XG4gICAgICAvLyBBbHdheXMgYWRkIHN1bW1hcnkgY2hlY2twb2ludCAoY29yZSBkZXNpZ24pXG4gICAgICBhcHBlbmRDaGVja3BvaW50Qm91bmRlZChwYXJlbnQsIGNmZywgeyBuYW1lOiAnbm9pc2VSZWR1Y3Rpb24uc3VtbWFyeScsIHRzOiBEYXRlLm5vdygpIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vID09PSBIaWVyYXJjaHkgaW50ZWdyaXR5IC8gYWNjb3VudGluZyBpbnRlZ3JpdHkgKGNsb3N1cmUpID09PVxuICAvL1xuICAvLyBJZiB3ZSBlbWl0dGVkIGFueSBldmVudCAob3IgYW55IG5vaXNlIHN1bW1hcnkpIHRoYXQgcmVsaWVzIG9uIHBhcmVudCBzcGFuIFAsXG4gIC8vIHRoZW4gUCBtdXN0IGFsc28gZXhpc3QgaW4gdGhlIGZpbmFsIG91dHB1dCB0byBhdm9pZCBVSSA0MDRzIGFuZCB0byBwcmVzZXJ2ZSBhY2NvdW50aW5nLlxuICAvLyBUaGlzIGFsc28gYXBwbGllcyB0byBPVEVMOiBpZiB3ZSBmb3JjZS1rZWVwIGEgY29uc29saWRhdGVkIHNwYW4sIHdlIHNob3VsZCBhbHNvIGtlZXAgaXRzIHNwYW4uc3RhcnQgd2hlbiBwcmVzZW50LlxuICBjb25zdCBvdXRwdXRTcGFuSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG91dHB1dEJ5SWQgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUV2ZW50W10+KCk7XG4gIGZvciAoY29uc3QgZSBvZiBvdXRwdXQpIHtcbiAgICBjb25zdCBsaXN0ID0gb3V0cHV0QnlJZC5nZXQoZS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgIGlmIChsaXN0KSBsaXN0LnB1c2goZSk7XG4gICAgZWxzZSBvdXRwdXRCeUlkLnNldChlLm9ic2VydmFiaWxpdHlMb2dJZCwgWyBlIF0pO1xuICAgIGlmIChlLnR5cGUgPT09ICdzcGFuJykgb3V0cHV0U3Bhbklkcy5hZGQoZS5vYnNlcnZhYmlsaXR5TG9nSWQpO1xuICB9XG5cbiAgY29uc3QgcmVxdWlyZWRQYXJlbnRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIC8vIFBhcmVudHMgcmVmZXJlbmNlZCBieSBlbWl0dGVkIGV2ZW50c1xuICBmb3IgKGNvbnN0IGUgb2Ygb3V0cHV0KSB7XG4gICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgIGlmIChwaWQpIHJlcXVpcmVkUGFyZW50cy5hZGQocGlkKTtcbiAgfVxuICAvLyBQYXJlbnRzIHRoYXQgaGFkIHN1cHByZXNzaW9uIHVuZGVyIHRoZW0gKG5lZWQgdG8gZXhpc3Qgc28gc3VtbWFyaWVzL2NoZWNrcG9pbnRzIGFyZSB2aXNpYmxlKVxuICAvLyBCVVQ6IG9ubHkgaWYgdGhlIHBhcmVudCBzcGFuIGl0c2VsZiB3YXNuJ3QgZHJvcHBlZCBieSBhIG5vaXNlIHJlZHVjdGlvbiBydWxlLlxuICAvLyBJZiB0aGUgcGFyZW50IHNwYW4gbWF0Y2hlZCBhICdkcm9wJyBydWxlLCBkb24ndCBmb3JjZS1rZWVwIGl0IGp1c3QgYmVjYXVzZSBjaGlsZHJlbiB3ZXJlIGZvbGRlZCBpbnRvIGl0LlxuICBmb3IgKGNvbnN0IHBpZCBvZiBwZXJQYXJlbnRTdW1tYXJ5LmtleXMoKSkge1xuICAgIGNvbnN0IHBhcmVudFNwYW4gPSBzcGFuQnlJZC5nZXQocGlkKTtcbiAgICBpZiAoIXBhcmVudFNwYW4pIHtcbiAgICAgIHJlcXVpcmVkUGFyZW50cy5hZGQocGlkKTsgLy8gUGFyZW50IG5vdCBpbiB0aGlzIHNsaWNlLCBrZWVwIHJlcXVpcmVtZW50XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBwYXJlbnQgc3BhbiBpcyBhbHJlYWR5IGluIG91dHB1dCBmcm9tIHRoZSBtYWluIHByb2Nlc3NpbmcgbG9vcFxuICAgIGNvbnN0IHBhcmVudEFscmVhZHlLZXB0ID0gb3V0cHV0U3Bhbklkcy5oYXMocGlkKTtcbiAgICBpZiAocGFyZW50QWxyZWFkeUtlcHQpIHtcbiAgICAgIHJlcXVpcmVkUGFyZW50cy5hZGQocGlkKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGlmIHRoZSBwYXJlbnQgc3BhbiB3b3VsZCBiZSBzdXBwcmVzc2VkIGJ5IG5vaXNlIHJlZHVjdGlvbiBydWxlcy5cbiAgICAvLyBVc2UgdGhlIHByZS1jYWxjdWxhdGVkIGRlY2lzaW9uIGZyb20gc3BhbkRlY2lzaW9uQnlJZC5cbiAgICBjb25zdCBwYXJlbnREZWNpc2lvbiA9IHNwYW5EZWNpc2lvbkJ5SWQuZ2V0KHBpZCk7XG4gICAgaWYgKHBhcmVudERlY2lzaW9uID09PSAnZHJvcCcgfHwgcGFyZW50RGVjaXNpb24gPT09ICdmb2xkJyB8fCBwYXJlbnREZWNpc2lvbiA9PT0gJ2FnZ3JlZ2F0ZScpIHtcbiAgICAgIC8vIFBhcmVudCBzcGFuIHdhcyBzdXBwb3NlZCB0byBiZSBzdXBwcmVzc2VkIChkcm9wcGVkL2ZvbGRlZC9hZ2dyZWdhdGVkIGludG8gSVRTIHBhcmVudCkuXG4gICAgICAvLyBEb24ndCBmb3JjZS1rZWVwIGl0IGp1c3QgYmVjYXVzZSBjaGlsZHJlbiB3ZXJlIGZvbGRlZCBpbnRvIGl0LlxuICAgICAgLy8gVGhlIG5lc3RlZCBmb2xkL2FnZ3JlZ2F0ZSBkYXRhIGlzIGxvc3QsIGJ1dCB0aGF0J3MgYWNjZXB0YWJsZSBzaW5jZSB0aGUgcGFyZW50IGlzIG5vaXNlLlxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gUGFyZW50IHNwYW4gd2Fzbid0IGRyb3BwZWQsIHNvIGtlZXAgaXQgdG8gcHJlc2VydmUgZm9sZC9hZ2dyZWdhdGUgc3VtbWFyaWVzXG4gICAgcmVxdWlyZWRQYXJlbnRzLmFkZChwaWQpO1xuICB9XG5cbiAgbGV0IGNoYW5nZWQgPSB0cnVlO1xuICB3aGlsZSAoY2hhbmdlZCkge1xuICAgIGNoYW5nZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IHBpZCBvZiBBcnJheS5mcm9tKHJlcXVpcmVkUGFyZW50cykpIHtcbiAgICAgIGNvbnN0IHBhcmVudFNwYW4gPSBzcGFuQnlJZC5nZXQocGlkKTtcbiAgICAgIGlmICghcGFyZW50U3BhbikgY29udGludWU7XG5cbiAgICAgIGlmICghb3V0cHV0U3Bhbklkcy5oYXMocGlkKSkge1xuICAgICAgICAvLyBGb3JjZSBrZWVwIHBhcmVudCBzcGFuIGZvciBpbnRlZ3JpdHkuXG4gICAgICAgIGNvbnN0IGQgPSBlbnN1cmVTcGFuRGF0YShwYXJlbnRTcGFuKTtcbiAgICAgICAgY29uc3QgbnJSYXcgPSBkLm5vaXNlUmVkdWN0aW9uO1xuICAgICAgICBjb25zdCBucjogTm9pc2VSZWR1Y3Rpb25EYXRhID0geyBmb3JjZWRLZWVwOiB0cnVlIH07XG4gICAgICAgIGlmIChpc1JlY29yZChuclJhdykpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIG5yUmF3LmFnZ3JlZ2F0ZVRydW5jYXRlZCA9PT0gJ2Jvb2xlYW4nKSBuci5hZ2dyZWdhdGVUcnVuY2F0ZWQgPSBuclJhdy5hZ2dyZWdhdGVUcnVuY2F0ZWQ7XG4gICAgICAgICAgaWYgKHR5cGVvZiBuclJhdy5kcm9wcGVkID09PSAnbnVtYmVyJykgbnIuZHJvcHBlZCA9IG5yUmF3LmRyb3BwZWQ7XG4gICAgICAgICAgaWYgKHR5cGVvZiBuclJhdy5mb2xkZWQgPT09ICdudW1iZXInKSBuci5mb2xkZWQgPSBuclJhdy5mb2xkZWQ7XG4gICAgICAgICAgaWYgKHR5cGVvZiBuclJhdy5hZ2dyZWdhdGVkID09PSAnbnVtYmVyJykgbnIuYWdncmVnYXRlZCA9IG5yUmF3LmFnZ3JlZ2F0ZWQ7XG4gICAgICAgICAgaWYgKHR5cGVvZiBuclJhdy5hcHByb3hCeXRlc1NhdmVkID09PSAnbnVtYmVyJykgbnIuYXBwcm94Qnl0ZXNTYXZlZCA9IG5yUmF3LmFwcHJveEJ5dGVzU2F2ZWQ7XG4gICAgICAgICAgaWYgKGlzUmVjb3JkKG5yUmF3LmJ5UnVsZUlkKSkge1xuICAgICAgICAgICAgY29uc3QgYnlSdWxlSWQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobnJSYXcuYnlSdWxlSWQpKSBpZiAodHlwZW9mIHYgPT09ICdudW1iZXInKSBieVJ1bGVJZFsgayBdID0gdjtcbiAgICAgICAgICAgIG5yLmJ5UnVsZUlkID0gYnlSdWxlSWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChpc1JlY29yZChuclJhdy5ieVR5cGUpKSB7XG4gICAgICAgICAgICBjb25zdCBieVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgWyBrLCB2IF0gb2YgT2JqZWN0LmVudHJpZXMobnJSYXcuYnlUeXBlKSkgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykgYnlUeXBlWyBrIF0gPSB2O1xuICAgICAgICAgICAgbnIuYnlUeXBlID0gYnlUeXBlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaXNSZWNvcmQobnJSYXcuYnlPcGVyYXRpb24pKSB7XG4gICAgICAgICAgICBjb25zdCBieU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBbIGssIHYgXSBvZiBPYmplY3QuZW50cmllcyhuclJhdy5ieU9wZXJhdGlvbikpIGlmICh0eXBlb2YgdiA9PT0gJ251bWJlcicpIGJ5T3BlcmF0aW9uWyBrIF0gPSB2O1xuICAgICAgICAgICAgbnIuYnlPcGVyYXRpb24gPSBieU9wZXJhdGlvbjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlzUmVjb3JkKG5yUmF3LmFnZ3JlZ2F0ZXMpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWRBZ2dzOiBSZWNvcmQ8c3RyaW5nLCBBZ2dyZWdhdGVCdWNrZXQ+ID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFsgaywgdiBdIG9mIE9iamVjdC5lbnRyaWVzKG5yUmF3LmFnZ3JlZ2F0ZXMpKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGIgPSByZWFkQWdncmVnYXRlQnVja2V0KHYpO1xuICAgICAgICAgICAgICBpZiAoYikgcGFyc2VkQWdnc1sgayBdID0gYjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG5yLmFnZ3JlZ2F0ZXMgPSBwYXJzZWRBZ2dzO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBkLm5vaXNlUmVkdWN0aW9uID0gbnI7XG4gICAgICAgIC8vIEFsd2F5cyBhZGQgY2hlY2twb2ludCAoY29yZSBkZXNpZ24pXG4gICAgICAgIGFwcGVuZENoZWNrcG9pbnRCb3VuZGVkKHBhcmVudFNwYW4sIGNmZywgeyBuYW1lOiAnbm9pc2VSZWR1Y3Rpb24uZm9yY2VkS2VlcFBhcmVudCcsIHRzOiBEYXRlLm5vdygpIH0pO1xuXG4gICAgICAgIG91dHB1dC5wdXNoKHBhcmVudFNwYW4pO1xuICAgICAgICBvdXRwdXRTcGFuSWRzLmFkZChwaWQpO1xuICAgICAgICBzdGF0cy5rZXB0Kys7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBFbnN1cmUgT1RFTCBzcGFuLnN0YXJ0IGV4aXN0cyB3aGVuIHdlIGZvcmNlLWtlZXAgYSBzcGFuIHRoYXQgaGFzIG9uZS5cbiAgICAgIGNvbnN0IHN0YXJ0ID0gc3BhblN0YXJ0QnlJZC5nZXQocGlkKTtcbiAgICAgIGlmIChzdGFydCkge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IG91dHB1dEJ5SWQuZ2V0KHBpZCk7XG4gICAgICAgIGNvbnN0IGhhc1N0YXJ0ID0gZXhpc3RpbmcgJiYgZXhpc3Rpbmcuc29tZSgoeCkgPT4geC50eXBlID09PSAnc3Bhbi5zdGFydCcpO1xuICAgICAgICBpZiAoIWhhc1N0YXJ0KSB7XG4gICAgICAgICAgLy8gU2FmZXR5OiBwcmV2ZW50IGFycmF5IG92ZXJmbG93XG4gICAgICAgICAgaWYgKG91dHB1dC5sZW5ndGggPCAxMDAwMDAwKSB7XG4gICAgICAgICAgICBvdXRwdXQucHVzaChzdGFydCk7XG4gICAgICAgICAgICAvLyBVcGRhdGUgb3V0cHV0QnlJZCBpbmRleCBzbyB3ZSBkb24ndCBwdXNoIHRoaXMgYWdhaW4gaW4gbmV4dCBpdGVyYXRpb25cbiAgICAgICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgICAgICBleGlzdGluZy5wdXNoKHN0YXJ0KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG91dHB1dEJ5SWQuc2V0KHBpZCwgWyBzdGFydCBdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRzLmtlcHQrKztcbiAgICAgICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2dnZXIud2FybignTm9pc2UgcmVkdWN0aW9uIG91dHB1dCBhcnJheSBoaXQgc2FmZXR5IGNhcCwgZHJvcHBpbmcgc3Bhbi5zdGFydCcsIHtcbiAgICAgICAgICAgICAgc3BhbklkOiBwaWQsXG4gICAgICAgICAgICAgIG91dHB1dExlbmd0aDogb3V0cHV0Lmxlbmd0aCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBDbG9zdXJlOiBpZiBwYXJlbnRTcGFuIGhhcyBpdHMgb3duIHBhcmVudCwgcmVxdWlyZSBpdCB0b28uXG4gICAgICBjb25zdCBwcCA9IHBhcmVudFNwYW4ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZDtcbiAgICAgIGlmIChwcCAmJiAhcmVxdWlyZWRQYXJlbnRzLmhhcyhwcCkpIHtcbiAgICAgICAgcmVxdWlyZWRQYXJlbnRzLmFkZChwcCk7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7IGV2ZW50czogb3V0cHV0LCBzdGF0cyB9O1xufVxuXG5cbiJdfQ==