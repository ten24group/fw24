"use strict";
/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * All config and backends resolved from DI - no manual instantiation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observer = exports.withObservability = exports.ObservabilityManager = void 0;
const id_generator_1 = require("./utils/id-generator");
const logging_1 = require("../logging");
const types_1 = require("./types");
const level_utils_1 = require("./utils/level-utils");
const source_utils_1 = require("./utils/source-utils");
const data_protection_1 = require("./utils/data-protection");
const context_1 = require("./context");
const base_1 = require("./observers/base");
const di_1 = require("../di");
const errors_1 = require("../di/errors");
const noise_reduction_1 = require("./noise-reduction");
const trace_graph_1 = require("./trace-graph");
const config_1 = require("./config");
const runtime_state_1 = require("./runtime-state");
const pattern_utils_1 = require("./utils/pattern-utils");
const logger = (0, logging_1.createLogger)('ObservabilityManager');
// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE MODULE STATE
// ═══════════════════════════════════════════════════════════════════════════
let config = null;
let backends = [];
let backendConfigs = new Map();
let invocationCount = 0;
let initialized = false;
const samplingRegexCache = new Map();
const pendingDispatches = []; // Track fire-and-forget promises for flush()
/**
 * Pre-initialization hooks - callbacks that run before backends are initialized.
 * Used to register schemas/services needed by backends without circular dependencies.
 */
const preInitHooks = [];
// ═══════════════════════════════════════════════════════════════════════════
// PRIVATE HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
function validateInput(input) {
    const errors = [];
    const context = (0, context_1.getCurrentContext)();
    if (!input.type) {
        errors.push({ field: 'type', message: 'type is required' });
    }
    if (!input.level) {
        errors.push({ field: 'level', message: 'level is required' });
    }
    if (!input.correlationId && !context?.correlationId) {
        errors.push({
            field: 'correlationId',
            message: 'correlationId is required. Context is auto-established in controllers, or use runWithExecutionContext().'
        });
    }
    return errors;
}
function applyDataProtection(input, dataProtection) {
    if (!dataProtection?.enabled) {
        return {
            data: input.data,
            attributes: input.attributes,
            metadata: input.metadata,
            context: input.context,
            error: input.error,
        };
    }
    const fields = dataProtection.fields ?? ['data', 'attributes', 'metadata', 'context'];
    return {
        data: fields.includes('data') && input.data
            ? (0, data_protection_1.redactSensitiveData)(input.data, dataProtection)
            : input.data,
        attributes: fields.includes('attributes') && input.attributes
            ? (0, data_protection_1.redactSensitiveData)(input.attributes, dataProtection)
            : input.attributes,
        metadata: fields.includes('metadata') && input.metadata
            ? (0, data_protection_1.redactSensitiveData)(input.metadata, dataProtection)
            : input.metadata,
        context: fields.includes('context') && input.context
            ? (0, data_protection_1.redactSensitiveData)(input.context, dataProtection)
            : input.context,
        error: fields.includes('error') && input.error
            ? (0, data_protection_1.redactSensitiveData)(input.error, dataProtection)
            : input.error,
    };
}
function buildEvent(input, context = null) {
    const ctx = context ?? (0, context_1.getCurrentContext)();
    const now = Date.now();
    const correlationId = input.correlationId ?? ctx?.correlationId;
    if (!correlationId) {
        throw new Error('correlationId is required - this should have been caught by validation');
    }
    const { data, attributes, metadata, context: eventContext, error } = applyDataProtection(input, config?.dataProtection);
    // Operation normalization (reduce cardinality + improve cross-backend consistency)
    const opNorm = config?.operationNormalization;
    let operation = input.operation;
    let operationNormalizationMeta;
    if (opNorm?.enabled && operation) {
        const originalOperation = operation;
        const appliedRules = [];
        const typeMatch = (ruleTypes, eventType) => {
            if (!ruleTypes)
                return true;
            const arr = Array.isArray(ruleTypes) ? ruleTypes : [ruleTypes];
            // Compare by string to avoid unsafe casting (ObservabilityEventType is string-based anyway).
            return arr.map(String).includes(eventType);
        };
        for (const rule of opNorm.rules ?? []) {
            if (!typeMatch(rule.types, input.type))
                continue;
            if (!(0, pattern_utils_1.matchesPattern)(operation, rule.match))
                continue;
            const next = (0, pattern_utils_1.replacePattern)(operation, rule.match, rule.replace);
            if (next !== operation) {
                appliedRules.push({ id: rule.id, from: operation, to: next, reason: rule.reason });
                operation = next;
            }
        }
        // Only attach meta if the operation actually changed
        if (opNorm.storeOriginal !== false && operation !== originalOperation) {
            operationNormalizationMeta = {
                from: originalOperation,
                to: operation,
                ruleIds: appliedRules.map(r => r.id),
                rules: appliedRules,
            };
        }
    }
    return {
        type: input.type,
        level: input.level,
        correlationId,
        timestampMs: input.timestampMs ?? now,
        observabilityLogId: input.observabilityLogId ?? (0, id_generator_1.generateObservabilityLogId)(correlationId),
        // null = explicitly no parent - parentObservabilityLogId should be resolved by caller (span tree)
        // undefined = use what was provided
        parentObservabilityLogId: input.parentObservabilityLogId === null ? undefined : input.parentObservabilityLogId,
        causedBy: input.causedBy,
        relatedTraces: input.relatedTraces,
        actor: input.actor ?? ctx?.actor,
        source: input.source ?? ctx?.observability?.source ?? (0, source_utils_1.detectSource)(),
        tags: (0, source_utils_1.mergeTags)({ ...ctx?.observability?.tags, ...input.tags }, true),
        entityName: input.entityName,
        entityId: input.entityId,
        operation,
        subType: input.subType,
        status: input.status,
        success: input.success,
        durationMs: input.durationMs,
        data: operationNormalizationMeta
            ? { ...(data ?? {}), operationNormalization: operationNormalizationMeta }
            : data,
        attributes,
        metadata,
        metrics: input.metrics,
        context: eventContext,
        error,
        capture: input.capture,
    };
}
/**
 * Categorize event type for backend routing and sampling
 *
 * Custom event types are supported! Use any naming convention:
 * - 'business.order_placed' → categorized as 'log'
 * - 'payment.transaction' → categorized as 'log'
 * - 'notification.sent' → categorized as 'log'
 *
 * To control backend routing for custom types, use type-specific config:
 * ```
 * observability: {
 *   types: {
 *     log: { backends: ['cloudwatch', 'dynamodb'] }
 *   }
 * }
 * ```
 */
function getTypeCategory(type) {
    // 'span' = consolidated span record, 'span.start' = OTEL-only start marker.
    // FW24 does NOT support legacy span.* record formats (no compatibility guarantees).
    if (type === 'span' || type === 'span.start')
        return 'span';
    if (type === 'metric')
        return 'metric';
    if (type.startsWith('audit'))
        return 'audit';
    // All custom event types default to 'log' category
    // This includes: 'business.*', 'payment.*', 'notification.*', etc.
    return 'log';
}
function getBackendsForType(type) {
    const typeCategory = getTypeCategory(type);
    const typeConfig = config?.types?.[typeCategory];
    if (typeConfig?.backends && typeConfig.backends.length > 0) {
        return backends.filter((b) => typeConfig.backends.includes(b.name));
    }
    return backends;
}
/**
 * Check if backend should capture this event based on type filtering
 */
function shouldBackendCaptureType(backend, event) {
    // Per-event backend filter (used for OTEL span tracking in consolidated mode)
    if (event.capture?.backends && event.capture.backends.length > 0) {
        if (!event.capture.backends.includes(backend.name)) {
            return false;
        }
    }
    const backendCfg = backendConfigs.get(backend.name);
    if (!backendCfg)
        return true; // No config = allow all
    const typeCategory = getTypeCategory(event.type);
    const typeFilter = backendCfg.types?.[typeCategory];
    // Check if type is explicitly disabled for this backend
    if (typeFilter?.enabled === false) {
        return false;
    }
    const eventLevel = (0, level_utils_1.stringToLevel)(event.level);
    // Check per-type minLevel (overrides backend-level minLevel)
    if (typeFilter?.minLevel !== undefined) {
        if (eventLevel < typeFilter.minLevel) {
            return false;
        }
    }
    else if (backend.minLevel !== undefined) {
        // Fall back to backend-level minLevel
        if (eventLevel < backend.minLevel) {
            return false;
        }
    }
    // Check per-type sampling
    if (typeFilter?.sampling !== undefined) {
        return Math.random() < typeFilter.sampling;
    }
    return true; // Passed all filters
}
function dispatchToBackends(event, targetBackends) {
    const promise = Promise.all(targetBackends.map(async (backend) => {
        try {
            if (!shouldBackendCaptureType(backend, event)) {
                return;
            }
            await backend.capture(event);
        }
        catch (error) {
            logger.error(`Failed to capture in backend ${backend.name}:`, error);
        }
    })).then(() => { }); // Convert to Promise<void>
    // Track promise so flush() can wait for it
    pendingDispatches.push(promise);
}
async function dispatchToBackendsSync(event, targetBackends) {
    await Promise.all(targetBackends.map(async (backend) => {
        try {
            if (!shouldBackendCaptureType(backend, event)) {
                return;
            }
            await backend.capture(event);
        }
        catch (error) {
            logger.error(`Failed to capture in backend ${backend.name}:`, error);
        }
    }));
}
function enforceHierarchyIntegrityOrDrop(events, ctxCorrelationId) {
    // Strict contract: parentObservabilityLogId must always refer to an existing span within this slice.
    // If violated (likely due to manual injection), we drop offending events and emit a single error log.
    const graph = (0, trace_graph_1.buildTraceGraph)(events, { strictParents: false });
    if (graph.missingParentSpanIds.size === 0 && graph.crossSliceParentSpanIds.size === 0)
        return events;
    const missing = graph.missingParentSpanIds;
    const crossSlice = graph.crossSliceParentSpanIds;
    const filtered = events.filter((e) => {
        const pid = e.parentObservabilityLogId ?? undefined;
        return !(pid && (missing.has(pid) || crossSlice.has(pid)));
    });
    const droppedCount = events.length - filtered.length;
    filtered.push({
        type: 'log',
        level: 'error',
        correlationId: ctxCorrelationId,
        timestampMs: Date.now(),
        observabilityLogId: (0, id_generator_1.generateObservabilityLogId)(ctxCorrelationId),
        operation: 'observability.invariant_violation.missing_parent_span',
        success: false,
        capture: { bypass: true },
        data: {
            droppedCount,
            missingParentSpanIds: Array.from(missing).slice(0, 10),
            crossSliceParentSpanIds: Array.from(crossSlice).slice(0, 10),
        },
        source: 'ObservabilityManager.flush',
    });
    return filtered;
}
function getEffectiveLevelForType(type) {
    const typeConfig = config?.types?.[type];
    return typeConfig?.minLevel ?? config?.minLevel ?? types_1.ObservabilityLevel.INFO;
}
/**
 * Check if an event matches a sampling rule
 */
function matchesRule(event, rule) {
    const { target, pattern } = rule;
    let valueToMatch;
    switch (target) {
        case 'tenant':
            // Check actor.tenantId or tags.tenantId
            valueToMatch = event.actor?.tenantId ?? event.tags?.tenantId;
            break;
        case 'route':
            // Check source (e.g., "OrderController.create") or operation
            valueToMatch = event.source ?? event.operation;
            break;
        case 'tag':
            // Pattern format: "key:value" or "key:*"
            if (typeof pattern === 'string' && pattern.includes(':')) {
                const [key, valuePattern] = pattern.split(':', 2);
                const tagValue = event.tags?.[key];
                if (!tagValue)
                    return false;
                if (valuePattern === '*')
                    return true;
                // Test against value pattern (supports wildcards)
                const regex = getOrCreateSamplingRegex(valuePattern);
                return regex.test(tagValue);
            }
            return false;
        case 'actor':
            // Check actorId or actorType
            valueToMatch = event.actor?.actorId ?? event.actor?.actorType;
            break;
        case 'source':
            valueToMatch = event.source;
            break;
        default:
            return false;
    }
    if (!valueToMatch)
        return false;
    // Match against pattern (string or RegExp)
    if (pattern instanceof RegExp) {
        return pattern.test(valueToMatch);
    }
    // String pattern with wildcard support
    const regex = getOrCreateSamplingRegex(pattern);
    return regex.test(valueToMatch);
}
function shouldCapture(event, cfg, options) {
    const levelValue = (0, level_utils_1.stringToLevel)(event.level);
    const typeCategory = getTypeCategory(event.type);
    const effectiveLevel = getEffectiveLevelForType(typeCategory);
    const capture = event.capture;
    const isSpanRecord = event.type === 'span';
    const allowSpanMinDurationDrop = options?.allowSpanMinDurationDrop === true;
    const referencedParentSpanIds = options?.referencedParentSpanIds;
    // === BYPASS SAMPLING (always capture) ===
    // Priority order - if any of these match, capture immediately
    // 1. Explicit bypass flag in CaptureControl
    if (capture?.bypass) {
        return true;
    }
    // 2. CRITICAL log level always captured
    if (levelValue === types_1.ObservabilityLevel.CRITICAL) {
        return true;
    }
    // 3. Errors always captured
    if (event.error || event.success === false) {
        return true;
    }
    // === SPAN-SPECIFIC FILTERING ===
    if (isSpanRecord) {
        const id = event.observabilityLogId;
        if (id && referencedParentSpanIds?.has(id)) {
            return true;
        }
        if (allowSpanMinDurationDrop && event.durationMs !== undefined) {
            // Per-event minDurationMs overrides global config
            // Set capture.minDurationMs = 0 to capture regardless of duration
            const minDuration = capture?.minDurationMs ?? cfg.spans.minDurationMs;
            if (minDuration > 0 && event.durationMs < minDuration) {
                return false;
            }
        }
    }
    // === CAPTURE CONTROL FILTERING ===
    // 4. Duration threshold for non-span events (e.g., slow queries)
    if (!isSpanRecord && capture?.minDurationMs !== undefined && event.durationMs !== undefined) {
        if (event.durationMs < capture.minDurationMs) {
            return false;
        }
    }
    // 5. Group-based sampling for batch scenarios
    if (capture?.group) {
        const { index, captureFirst = 3, sampleRate = 0.1 } = capture.group;
        // Note: Errors already returned true above (line ~360)
        // Capture first N items
        if (index < captureFirst) {
            return true;
        }
        // Sample the rest
        return Math.random() < sampleRate;
    }
    // === STANDARD FILTERING (may reject) ===
    // Check minimum level
    if (levelValue < effectiveLevel) {
        return false;
    }
    // If sampling disabled, capture everything
    if (!cfg.sampling?.enabled) {
        return true;
    }
    // === RULE-BASED SAMPLING (Highest Priority) ===
    // Rules are evaluated in order. First match wins.
    if (cfg.sampling.rules && cfg.sampling.rules.length > 0) {
        for (const rule of cfg.sampling.rules) {
            if (matchesRule(event, rule)) {
                return Math.random() < rule.rate;
            }
        }
    }
    // === TYPE-SPECIFIC SAMPLING ===
    const typeConfig = cfg.types?.[typeCategory];
    if (typeConfig?.sampling?.enabled) {
        return Math.random() < typeConfig.sampling.rate;
    }
    // === OPERATION-BASED SAMPLING ===
    if (event.operation && cfg.sampling.operations) {
        for (const [pattern, rate] of Object.entries(cfg.sampling.operations)) {
            const regex = getOrCreateSamplingRegex(pattern);
            if (regex.test(event.operation)) {
                return Math.random() < rate;
            }
        }
    }
    // === LEVEL-BASED SAMPLING (Fallback) ===
    const levelName = (0, level_utils_1.levelToString)(levelValue);
    const rate = cfg.sampling.rates?.[levelName];
    if (rate === undefined || rate >= 1)
        return true;
    if (rate <= 0)
        return false;
    return Math.random() < rate;
}
function getOrCreateSamplingRegex(pattern) {
    const MAX_REGEX_CACHE_SIZE = 100;
    let regex = samplingRegexCache.get(pattern);
    if (!regex) {
        // Evict oldest entry if cache is full (FIFO eviction)
        if (samplingRegexCache.size >= MAX_REGEX_CACHE_SIZE) {
            const firstKey = samplingRegexCache.keys().next().value;
            if (firstKey !== undefined) {
                samplingRegexCache.delete(firstKey);
            }
        }
        regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        samplingRegexCache.set(pattern, regex);
    }
    return regex;
}
/**
 * Calculate priority for buffer eviction.
 * Higher priority = keep in buffer
 */
function getEventPriority(event) {
    // Bypass events NEVER get evicted (max priority)
    if (event.capture?.bypass) {
        return Infinity;
    }
    // Use explicit priority if provided
    let priority = event.capture?.priority ?? 0;
    const level = (0, level_utils_1.stringToLevel)(event.level);
    // Higher log levels = higher priority
    priority += level * 10;
    // Audit events are high priority
    if (event.type.startsWith('audit')) {
        priority += 50;
    }
    // Spans with errors are high priority
    if (event.type.startsWith('span') && event.success === false) {
        priority += 30;
    }
    // Long duration operations are interesting
    if (event.durationMs && event.durationMs > 1000) {
        priority += 20;
    }
    return priority;
}
/**
 * Evict lowest priority event from buffer
 * Returns metadata about the evicted event for logging
 */
function evictLowestPriority(buffer, options) {
    if (buffer.length === 0)
        return null;
    const allowEvictSpans = options?.allowEvictSpans === true;
    // STRICT TREE EVICTION:
    // When the buffer is full, we MUST NOT evict a parent span while keeping its children,
    // otherwise flush() will emit `observability.invariant_violation.missing_parent_span`.
    //
    // We solve this like a real tree problem:
    // 1) Prefer evicting "leaf" events: events that are NOT referenced as a parentObservabilityLogId by any other buffered event.
    // 2) Prefer evicting non-span leaves (logs/metrics) before spans.
    // 3) If no leaves exist (rare), evict an event AND its whole descendant subtree so no orphans remain.
    const referencedAsParent = new Set();
    const childrenByParent = new Map();
    for (const e of buffer) {
        const pid = e.parentObservabilityLogId ?? undefined;
        if (typeof pid === 'string' && pid.length > 0) {
            referencedAsParent.add(pid);
            const arr = childrenByParent.get(pid);
            if (arr)
                arr.push(e);
            else
                childrenByParent.set(pid, [e]);
        }
    }
    const isSpan = (e) => e.type === 'span' || e.type === 'span.start';
    const getId = (e) => e.observabilityLogId;
    const isLeaf = (e) => {
        const id = getId(e);
        if (!id)
            return true;
        return !referencedAsParent.has(id);
    };
    const pickLowest = (candidates) => {
        let idx = -1;
        let lowest = Infinity;
        for (let i = 0; i < candidates.length; i++) {
            const p = getEventPriority(candidates[i]);
            if (p < lowest) {
                lowest = p;
                idx = i;
            }
        }
        return idx;
    };
    // If spans are not allowed to be evicted, constrain candidates to non-span events only.
    const nonSpans = buffer.filter((e) => !isSpan(e));
    // Pass 1: non-span leaves
    const nonSpanLeaves = nonSpans.filter((e) => isLeaf(e));
    let target;
    if (nonSpanLeaves.length > 0) {
        const idx = pickLowest(nonSpanLeaves);
        target = nonSpanLeaves[idx];
    }
    else {
        if (!allowEvictSpans) {
            // Pass 2 (non-span only): if we can't find a non-span leaf, evict the lowest-priority non-span.
            // This preserves hierarchy because non-spans are not expected to be parents.
            if (nonSpans.length > 0) {
                const idx = pickLowest(nonSpans);
                target = nonSpans[idx];
            }
            else {
                // Buffer contains only spans - caller must decide whether to allow span eviction or overflow.
                return null;
            }
        }
        else {
            // Pass 2: any leaves (including spans)
            const anyLeaves = buffer.filter((e) => isLeaf(e));
            if (anyLeaves.length > 0) {
                const idx = pickLowest(anyLeaves);
                target = anyLeaves[idx];
            }
            else {
                // Pass 3: no leaves exist (cycle/degenerate). Pick the overall lowest-priority event.
                const idx = pickLowest(buffer);
                target = buffer[idx];
            }
        }
    }
    if (!target)
        return null;
    const targetId = getId(target);
    let removedCount = 0;
    // If target is referenced as a parent, remove its entire subtree (BFS).
    const toRemove = new Set();
    const queue = [target];
    while (queue.length > 0) {
        const cur = queue.shift();
        if (toRemove.has(cur))
            continue;
        toRemove.add(cur);
        const curId = getId(cur);
        if (curId) {
            const kids = childrenByParent.get(curId);
            if (kids)
                queue.push(...kids);
        }
    }
    // Filter buffer in-place
    for (let i = buffer.length - 1; i >= 0; i--) {
        if (toRemove.has(buffer[i])) {
            buffer.splice(i, 1);
            removedCount++;
        }
    }
    return {
        type: target.type,
        correlationId: target.correlationId,
        operation: target.operation,
        level: target.level,
        removedCount,
    };
}
/**
 * Handle tail-based sampling logic for an event (sync version)
 * Returns: 'captured' if event was captured, 'buffered' if buffered, 'skip' if not using tail-based
 */
function handleTailBasedSamplingSync(event, context) {
    const cfg = config;
    if (!cfg)
        return 'skip';
    const shouldBufferForPolicy = cfg.noiseReduction.enabled;
    const shouldBufferForSampling = !!cfg.sampling?.smart;
    if ((!shouldBufferForSampling && !shouldBufferForPolicy) || !context) {
        return 'skip';
    }
    const isError = (0, level_utils_1.stringToLevel)(event.level) >= types_1.ObservabilityLevel.ERROR;
    // ERROR PATH: Flush buffer + capture error + set flag
    if (isError) {
        const obsState = context.observability;
        if (obsState.buffer.length > 0) {
            const buffer = obsState.buffer;
            obsState.buffer = [];
            const reduced = (0, noise_reduction_1.applyNoiseReduction)(buffer, cfg.noiseReduction);
            const reducedBuffer = enforceHierarchyIntegrityOrDrop(reduced.events, context.correlationId);
            // Apply level filtering to avoid overwhelming backends with thousands of debug/trace events
            // On error, capture INFO+ events, drop TRACE/DEBUG to prevent cost spikes
            const minLevelOnError = cfg.sampling?.minLevelOnError ?? types_1.ObservabilityLevel.INFO;
            let dropped = 0;
            for (const bufferedEvent of reducedBuffer) {
                const eventLevel = (0, level_utils_1.stringToLevel)(bufferedEvent.level);
                if (eventLevel >= minLevelOnError) {
                    const targets = getBackendsForType(bufferedEvent.type);
                    dispatchToBackends(bufferedEvent, targets);
                }
                else {
                    dropped++;
                }
            }
            if (dropped > 0) {
                logger.debug(`Dropped ${dropped} low-level events from error buffer flush`, {
                    minLevel: (0, level_utils_1.levelToString)(minLevelOnError),
                    correlationId: context.correlationId,
                });
            }
        }
        obsState.errorOccurred = true;
        const targetBackends = getBackendsForType(event.type);
        dispatchToBackends(event, targetBackends);
        obsState.summary.captured++;
        return 'captured';
    }
    // POST-ERROR PATH: Capture immediately
    if (context.observability.errorOccurred) {
        const targetBackends = getBackendsForType(event.type);
        dispatchToBackends(event, targetBackends);
        context.observability.summary.captured++;
        return 'captured';
    }
    // NORMAL PATH: Buffer everything
    const obsState = context.observability;
    const buffer = obsState.buffer;
    // Buffer size management: evict lowest priority if full
    const maxSize = cfg.sampling?.maxBufferSize ?? 1000;
    if (buffer.length >= maxSize) {
        // IMPORTANT:
        // During buffering (noise reduction / smart sampling), spans may be emitted AFTER their children.
        // Evicting spans opportunistically can therefore create future orphan children (missing_parent_span).
        // Prefer evicting non-span events only; if the buffer is spans-only, allow bounded overflow.
        const evictedInfo = evictLowestPriority(buffer, { allowEvictSpans: false });
        if (evictedInfo) {
            obsState.summary.evicted++;
        }
        else {
            // Spans-only overflow: allow buffer growth up to 2x before evicting span subtrees.
            const hardCap = maxSize * 2;
            if (buffer.length >= hardCap) {
                const evictedSpanInfo = evictLowestPriority(buffer, { allowEvictSpans: true });
                if (evictedSpanInfo) {
                    obsState.summary.evicted++;
                }
            }
        }
        // Log warning with evicted event details
        if (obsState.summary.evicted === 1 || obsState.summary.evicted % 100 === 0) {
            logger.warn('Observability buffer full, evicting lowest priority events', {
                evicted: obsState.summary.evicted,
                bufferSize: buffer.length,
                correlationId: context.correlationId,
                evictedEvent: evictedInfo,
            });
        }
        else if (evictedInfo) {
            // Log each eviction at debug level for troubleshooting
            logger.debug('Evicted observability event from buffer', {
                ...evictedInfo,
                totalEvicted: obsState.summary.evicted,
            });
        }
    }
    buffer.push(event);
    obsState.summary.buffered++;
    return 'buffered';
}
/**
 * Handle tail-based sampling logic for an event (async version)
 */
async function handleTailBasedSamplingAsync(event, context) {
    const cfg = config;
    if (!cfg)
        return 'skip';
    const shouldBufferForPolicy = cfg.noiseReduction.enabled;
    const shouldBufferForSampling = !!cfg.sampling?.smart;
    if ((!shouldBufferForSampling && !shouldBufferForPolicy) || !context) {
        return 'skip';
    }
    const isError = (0, level_utils_1.stringToLevel)(event.level) >= types_1.ObservabilityLevel.ERROR;
    // ERROR PATH: Flush buffer + capture error + set flag
    if (isError) {
        const obsState = context.observability;
        if (obsState.buffer.length > 0) {
            const buffer = obsState.buffer;
            obsState.buffer = [];
            const reduced = (0, noise_reduction_1.applyNoiseReduction)(buffer, cfg.noiseReduction);
            const reducedBuffer = enforceHierarchyIntegrityOrDrop(reduced.events, context.correlationId);
            // Apply level filtering to avoid overwhelming backends
            const minLevelOnError = cfg.sampling?.minLevelOnError ?? types_1.ObservabilityLevel.INFO;
            let dropped = 0;
            const filteredEvents = reducedBuffer.filter(bufferedEvent => {
                const eventLevel = (0, level_utils_1.stringToLevel)(bufferedEvent.level);
                if (eventLevel >= minLevelOnError) {
                    return true;
                }
                dropped++;
                return false;
            });
            await Promise.all(filteredEvents.map(bufferedEvent => {
                const targets = getBackendsForType(bufferedEvent.type);
                return dispatchToBackendsSync(bufferedEvent, targets);
            }));
            if (dropped > 0) {
                logger.debug(`Dropped ${dropped} low-level events from error buffer flush`, {
                    minLevel: (0, level_utils_1.levelToString)(minLevelOnError),
                    correlationId: context.correlationId,
                });
            }
        }
        obsState.errorOccurred = true;
        const targetBackends = getBackendsForType(event.type);
        await dispatchToBackendsSync(event, targetBackends);
        obsState.summary.captured++;
        return 'captured';
    }
    // POST-ERROR PATH: Capture immediately
    if (context.observability.errorOccurred) {
        const targetBackends = getBackendsForType(event.type);
        await dispatchToBackendsSync(event, targetBackends);
        context.observability.summary.captured++;
        return 'captured';
    }
    // NORMAL PATH: Buffer everything
    const obsState = context.observability;
    const buffer = obsState.buffer;
    // Buffer size management: evict lowest priority if full
    const maxSize = cfg.sampling?.maxBufferSize ?? 1000;
    if (buffer.length >= maxSize) {
        const evictedInfo = evictLowestPriority(buffer, { allowEvictSpans: false });
        if (evictedInfo) {
            obsState.summary.evicted++;
        }
        else {
            const hardCap = maxSize * 2;
            if (buffer.length >= hardCap) {
                const evictedSpanInfo = evictLowestPriority(buffer, { allowEvictSpans: true });
                if (evictedSpanInfo) {
                    obsState.summary.evicted++;
                }
            }
        }
        // Log warning if evicting a lot
        if (obsState.summary.evicted === 1 || obsState.summary.evicted % 100 === 0) {
            logger.warn('Observability buffer full, evicting lowest priority events', {
                evicted: obsState.summary.evicted,
                bufferSize: buffer.length,
                correlationId: context.correlationId
            });
        }
    }
    buffer.push(event);
    obsState.summary.buffered++;
    return 'buffered';
}
/**
 * Initialize source-map-support if enabled in config
 * Provides better stack traces for TypeScript/transpiled code in production
 */
function initializeSourceMapSupport(cfg) {
    if (!cfg.sourceMap.enabled) {
        logger.debug('Source map support disabled in config');
        return;
    }
    try {
        logger.debug('Attempting to load source-map-support...');
        // Dynamic import to avoid bundling if not needed
        require('source-map-support/register');
        logger.info('Source map support enabled - stack traces will show original TypeScript lines');
    }
    catch (error) {
        // Not a critical error - observability still works without source maps
        if (error && typeof error === 'object' && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
            logger.warn('source-map-support package not found. Install it for better error stack traces: npm install source-map-support');
        }
        else {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn('Failed to load source-map-support:', msg);
        }
    }
}
/**
 * Initialize backends from DI based on config
 */
function initializeBackendsFromConfig(cfg) {
    backends = [];
    backendConfigs.clear();
    const enabledBackends = cfg.backends.filter(b => b.enabled !== false);
    for (const backendCfg of enabledBackends) {
        try {
            const backend = di_1.DIContainer.ROOT.resolve('ObservabilityBackend', { tags: ['observability', 'backend', backendCfg.type] });
            backends.push(backend);
            backendConfigs.set(backend.name, backendCfg);
            logger.debug(`Initialized backend: ${backend.name}`);
        }
        catch (error) {
            if (error instanceof errors_1.NoProviderFoundError) {
                logger.warn(`Backend '${backendCfg.type}' not found in DI, skipping`);
            }
            else {
                logger.error(`Failed to initialize backend '${backendCfg.type}':`, error);
            }
        }
    }
    if (backends.length === 0) {
        // Soft-fail: do NOT throw and break application flow.
        // Without backends, capture becomes a no-op for this invocation (events are dropped).
        logger.error('Observability misconfigured: no enabled/available backends were resolved from DI. Observability will be disabled for this invocation.', {
            enabledBackendTypes: enabledBackends.map(b => b.type),
        });
    }
}
function doInitialize() {
    try {
        logger.debug('=== OBSERVABILITY INITIALIZATION START ===');
        // Run pre-initialization hooks (e.g., schema registration)
        if (preInitHooks.length > 0) {
            logger.debug(`Running ${preInitHooks.length} pre-initialization hook(s)...`);
            for (const hook of preInitHooks) {
                try {
                    hook();
                }
                catch (error) {
                    logger.error('Pre-initialization hook failed:', error);
                    throw error;
                }
            }
            logger.debug('Pre-initialization hooks completed');
        }
        // Resolve config input from DI, then normalize into a fully-defined ObservabilityConfig.
        // This avoids unsafe casts and ensures the shape is consistent even when apps override partially.
        const input = di_1.DIContainer.ROOT.resolveConfig('observability');
        config = (0, config_1.createObservabilityConfig)(input);
        (0, runtime_state_1.setCurrentObservabilityConfig)(config);
        logger.debug('Observability config loaded from DI', {
            enabled: config.enabled,
            serviceName: config.serviceName,
            backends: config.backends?.map(b => b.type),
            sampling: { enabled: config.sampling?.enabled, smart: config.sampling?.smart },
            sourceMap: config.sourceMap?.enabled,
        });
        // Initialize source-map-support for better stack traces (if enabled)
        initializeSourceMapSupport(config);
        // Initialize backends from DI
        initializeBackendsFromConfig(config);
        // Register capturer for observers
        (0, base_1.initializeCapturer)({
            capture: (input) => ObservabilityManager.capture(input),
            captureAsync: (input) => ObservabilityManager.captureAsync(input),
        });
        initialized = true;
        logger.info('=== OBSERVABILITY INITIALIZATION COMPLETE ===');
    }
    catch (error) {
        logger.error('!!! OBSERVABILITY INITIALIZATION FAILED !!!', error);
        // Soft-fail: do NOT throw into application flow.
        // Mark initialized to prevent repeated init attempts; leave capturer uninitialized so observers drop events.
        initialized = true;
        config = null;
        (0, runtime_state_1.setCurrentObservabilityConfig)(null);
        backends = [];
        backendConfigs.clear();
    }
}
// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API - ObservabilityManager
// ═══════════════════════════════════════════════════════════════════════════
class ObservabilityManager {
    constructor() { }
    /**
     * Initialize for a new Lambda invocation
     */
    static initializeInvocation() {
        logger.debug('ObservabilityManager.initializeInvocation() called', { initialized, invocationCount });
        if (!initialized) {
            logger.debug('Not initialized yet, calling doInitialize()...');
            doInitialize();
        }
        invocationCount++;
        logger.debug(`Invocation ${invocationCount} starting, initializing ${backends.length} backend(s)`);
        for (const backend of backends) {
            try {
                backend.initializeInvocation?.();
            }
            catch (error) {
                logger.error(`Backend ${backend.name} failed to initialize invocation:`, error);
            }
        }
    }
    static isInitialized() {
        return initialized;
    }
    static isColdStart() {
        return invocationCount === 1;
    }
    static getInvocationCount() {
        return invocationCount;
    }
    static getConfig() {
        return config;
    }
    /**
     * Get observability summary for the current invocation.
     * Returns buffer stats: evicted, buffered, captured, sampledOut counts.
     * Returns undefined if no execution context exists.
     */
    static getSummary() {
        const context = (0, context_1.getCurrentContext)();
        return context?.observability.summary;
    }
    static configure(updates) {
        if (!config) {
            throw new Error('ObservabilityManager not initialized');
        }
        config = { ...config, ...updates };
    }
    static registerBackend(backend) {
        if (backends.find((b) => b.name === backend.name)) {
            logger.warn(`Backend ${backend.name} already registered`);
            return;
        }
        backends.push(backend);
    }
    static unregisterBackend(name) {
        backends = backends.filter((b) => b.name !== name);
    }
    /**
     * Register a pre-initialization hook.
     * Hooks run BEFORE backends are initialized, allowing schema/service registration
     * needed by backends without circular dependencies.
     *
     * @param hook - Callback to execute during initialization
     */
    static registerPreInitHook(hook) {
        preInitHooks.push(hook);
    }
    /**
     * Capture an observability event (fire-and-forget)
     *
     * Capture control is embedded in input.capture - no separate options param.
     *
     * @param input - Event input with capture control in input.capture
     * @returns observabilityLogId if captured, undefined if filtered/sampled out
     */
    static capture(input) {
        if (!initialized) {
            logger.warn('❌ Observability not initialized, skipping capture', { type: input.type, level: input.level });
            return undefined;
        }
        try {
            // Hard deprecation: FW24 does not support legacy span.* record formats.
            // If anything emits these, it's a bug. Log loudly and drop.
            if (input.type === 'span.end' || input.type === 'span.event') {
                logger.error('Observability invariant violation: legacy span.* event type was emitted (unsupported). Dropping event.', {
                    type: input.type,
                    operation: input.operation,
                    correlationId: input.correlationId,
                    parentObservabilityLogId: input.parentObservabilityLogId,
                    source: input.source,
                });
                return undefined;
            }
            const errors = validateInput(input);
            if (errors.length > 0) {
                logger.warn('Invalid capture input:', { errors, type: input.type });
                return undefined;
            }
            if (!config?.enabled) {
                logger.debug('Observability disabled, skipping capture', { type: input.type });
                return undefined;
            }
            const context = (0, context_1.getCurrentContext)();
            const event = buildEvent(input, context);
            // Try tail-based sampling first
            const tailResult = handleTailBasedSamplingSync(event, context);
            if (tailResult === 'captured') {
                return event.observabilityLogId;
            }
            if (tailResult === 'buffered') {
                return undefined;
            }
            // HEAD-BASED SAMPLING (all bypass/level/sampling logic in shouldCapture)
            if (!shouldCapture(event, config, {
                // No buffered graph here; never drop spans by minDuration in head-based mode
                // because we can't prove they aren't parents of already-emitted child events.
                allowSpanMinDurationDrop: false,
            })) {
                return undefined;
            }
            const targetBackends = getBackendsForType(event.type);
            dispatchToBackends(event, targetBackends);
            return event.observabilityLogId;
        }
        catch (error) {
            logger.error('Unexpected error in capture:', error);
            return undefined;
        }
    }
    /**
     * Capture an observability event asynchronously (waits for backend capture)
     *
     * @param input - Event input with capture control in input.capture
     * @returns Promise<observabilityLogId> if captured, undefined if filtered/sampled out
     */
    static async captureAsync(input) {
        if (!initialized) {
            logger.debug('Observability not initialized, skipping capture');
            return undefined;
        }
        try {
            // Hard deprecation: FW24 does not support legacy span.* record formats.
            // If anything emits these, it's a bug. Log loudly and drop.
            if (input.type === 'span.end' || input.type === 'span.event') {
                logger.error('Observability invariant violation: legacy span.* event type was emitted (unsupported). Dropping event.', {
                    type: input.type,
                    operation: input.operation,
                    correlationId: input.correlationId,
                    parentObservabilityLogId: input.parentObservabilityLogId,
                    source: input.source,
                });
                return undefined;
            }
            const errors = validateInput(input);
            if (errors.length > 0) {
                logger.warn('Invalid capture input:', { errors, type: input.type });
                return undefined;
            }
            if (!config?.enabled)
                return undefined;
            const context = (0, context_1.getCurrentContext)();
            const event = buildEvent(input, context);
            // Try tail-based sampling first
            const tailResult = await handleTailBasedSamplingAsync(event, context);
            if (tailResult === 'captured') {
                return event.observabilityLogId;
            }
            if (tailResult === 'buffered') {
                return undefined;
            }
            // HEAD-BASED SAMPLING (all bypass/level/sampling logic in shouldCapture)
            if (!shouldCapture(event, config, {
                allowSpanMinDurationDrop: false,
            })) {
                return undefined;
            }
            const targetBackends = getBackendsForType(event.type);
            await dispatchToBackendsSync(event, targetBackends);
            return event.observabilityLogId;
        }
        catch (error) {
            logger.error('Unexpected error in captureAsync:', error);
            return undefined;
        }
    }
    /**
     * Observe an event (convenience method)
     *
     * @param event - Partial event with required type and level
     * @returns observabilityLogId if captured, undefined if filtered/sampled out
     */
    static observe(event) {
        const correlationId = event.correlationId ?? (0, context_1.getCorrelationIdIfExists)();
        if (!correlationId) {
            logger.warn('observe() called without correlationId');
            return undefined;
        }
        return ObservabilityManager.capture({
            ...event,
            correlationId,
            type: event.type,
            level: event.level,
        });
    }
    /**
     * Flush all backends and buffered events (called at end of Lambda invocation)
     */
    static async flush() {
        logger.debug('=== FLUSH START ===', {
            pendingDispatches: pendingDispatches.length,
            backends: backends.length,
            smartSampling: config?.sampling?.smart,
        });
        // Wait for all pending fire-and-forget dispatches (from error path in capture())
        if (pendingDispatches.length > 0) {
            logger.debug(`Waiting for ${pendingDispatches.length} pending dispatches`);
            await Promise.all(pendingDispatches);
            pendingDispatches.length = 0; // Clear for next invocation
            logger.debug('Pending dispatches completed');
        }
        // Force-end any spans left open in this invocation before flushing buffered events.
        // This guarantees the hierarchy has all parents, even if user/framework code forgot to end a span.
        (0, runtime_state_1.runSpanFinalizer)();
        // Attach observability summary to current span (if any) before flushing
        const summary = ObservabilityManager.getSummary();
        const context = (0, context_1.getCurrentContext)();
        const currentSpan = context?.observability.currentSpan;
        if (summary && currentSpan && (summary.captured > 0 || summary.buffered > 0 || summary.evicted > 0 || summary.sampledOut > 0)) {
            currentSpan?.metrics?.({
                '_fw24.obs.captured': summary.captured,
                '_fw24.obs.buffered': summary.buffered,
                '_fw24.obs.evicted': summary.evicted,
                '_fw24.obs.sampledOut': summary.sampledOut,
            });
        }
        // If buffering is enabled (smart sampling OR noise reduction), flush buffered events.
        if (config?.sampling?.smart || config?.noiseReduction?.enabled) {
            const context = (0, context_1.getCurrentContext)();
            if (context && context.observability.buffer.length > 0 && !context.observability.errorOccurred) {
                // No error occurred: apply noise reduction + optional sampling to buffer before flushing
                const obsState = context.observability;
                const buffer = obsState.buffer;
                obsState.buffer = []; // Clear buffer
                const reduced = (0, noise_reduction_1.applyNoiseReduction)(buffer, config.noiseReduction);
                const reducedEvents = reduced.events;
                // Compute referenced parent IDs from the buffered set (graph-based, no manual tracking).
                const referencedParentSpanIds = new Set();
                for (const e of reducedEvents) {
                    const pid = e.parentObservabilityLogId ?? undefined;
                    if (pid)
                        referencedParentSpanIds.add(pid);
                }
                // Drop empty *leaf* spans if configured.
                // A span is a leaf iff nobody references it as parentObservabilityLogId in this buffered set.
                const maybeDropEmptyLeafSpans = config.spans.skipEmpty
                    ? reducedEvents.filter((e) => {
                        if (e.type !== 'span')
                            return true;
                        const id = e.observabilityLogId;
                        if (!id)
                            return true;
                        if (referencedParentSpanIds.has(id))
                            return true; // parent => keep
                        const d = e.data;
                        const fw = d?._fw24;
                        return fw?.spanEmpty !== true;
                    })
                    : reducedEvents;
                const finalEvents = enforceHierarchyIntegrityOrDrop(maybeDropEmptyLeafSpans, context.correlationId);
                for (const event of finalEvents) {
                    // Bypass events skip sampling (e.g., audit events marked as critical)
                    const shouldBypass = event.capture?.bypass === true;
                    // Apply sampling rules to buffered event (unless bypass is set)
                    const isSampled = shouldBypass
                        || !config?.sampling?.enabled
                        || shouldCapture(event, config, {
                            allowSpanMinDurationDrop: true,
                            referencedParentSpanIds,
                        });
                    if (isSampled) {
                        const targets = getBackendsForType(event.type);
                        await dispatchToBackendsSync(event, targets);
                    }
                    else {
                        obsState.summary.sampledOut++;
                    }
                }
            }
            // If errorOccurred=true, buffer was already flushed during capture
        }
        // Flush all backends with retry logic
        // Wrap each backend flush in try-catch to ensure all backends attempt to flush
        // even if one fails catastrophically
        const MAX_FLUSH_RETRIES = 2;
        const flushPromises = backends.map(async (backend) => {
            try {
                if (!backend.flush) {
                    return;
                }
                for (let attempt = 1; attempt <= MAX_FLUSH_RETRIES; attempt++) {
                    try {
                        await backend.flush();
                        break; // Success
                    }
                    catch (error) {
                        if (attempt === MAX_FLUSH_RETRIES) {
                            logger.error(`Backend ${backend.name} flush failed after ${attempt} attempts:`, error);
                            // Events may be lost, but we've done our best
                            // Don't throw - allow other backends to flush
                        }
                        else {
                            logger.warn(`Backend ${backend.name} flush failed (attempt ${attempt}/${MAX_FLUSH_RETRIES}), retrying...`, error);
                            // Simple exponential backoff
                            await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                        }
                    }
                }
            }
            catch (error) {
                // Catch any unexpected errors outside the retry loop
                logger.error(`Backend ${backend.name} flush completely failed:`, error);
                // Don't throw - allow other backends to flush
            }
        });
        await Promise.all(flushPromises);
        logger.debug('=== FLUSH COMPLETE ===');
    }
    /**
     * Reset manager state (for testing)
     */
    static reset() {
        config = null;
        (0, runtime_state_1.setCurrentObservabilityConfig)(null);
        backends = [];
        backendConfigs.clear();
        invocationCount = 0;
        initialized = false;
        samplingRegexCache.clear();
        pendingDispatches.length = 0;
        (0, base_1.resetCapturer)();
    }
    /**
     * Initialize for testing with mock config and backends
     */
    static initializeForTesting(testConfig, testBackends = []) {
        ObservabilityManager.reset();
        config = testConfig;
        (0, runtime_state_1.setCurrentObservabilityConfig)(testConfig);
        backends = testBackends;
        initialized = true;
        (0, base_1.initializeCapturer)({
            capture: (input) => ObservabilityManager.capture(input),
            captureAsync: (input) => ObservabilityManager.captureAsync(input),
        });
    }
}
exports.ObservabilityManager = ObservabilityManager;
/**
 * Lambda handler wrapper with observability lifecycle management
 */
const withObservability = (handler) => {
    return (async (...args) => {
        try {
            ObservabilityManager.initializeInvocation();
            return await handler(...args);
        }
        finally {
            await ObservabilityManager.flush();
        }
    });
};
exports.withObservability = withObservability;
exports.Observer = ObservabilityManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILHVEQUFrRjtBQUNsRix3Q0FBMEM7QUFDMUMsbUNBU2lCO0FBRWpCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELHVDQUF3RTtBQUN4RSwyQ0FBcUU7QUFDckUsOEJBQW9DO0FBQ3BDLHlDQUFvRDtBQUNwRCx1REFBd0Q7QUFDeEQsK0NBQWdEO0FBQ2hELHFDQUFvRjtBQUNwRixtREFBa0Y7QUFDbEYseURBQXVFO0FBRXZFLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBT3BELDhFQUE4RTtBQUM5RSx1QkFBdUI7QUFDdkIsOEVBQThFO0FBRTlFLElBQUksTUFBTSxHQUErQixJQUFJLENBQUM7QUFDOUMsSUFBSSxRQUFRLEdBQTJCLEVBQUUsQ0FBQztBQUMxQyxJQUFJLGNBQWMsR0FBRyxJQUFJLEdBQUcsRUFBa0QsQ0FBQztBQUMvRSxJQUFJLGVBQWUsR0FBRyxDQUFDLENBQUM7QUFDeEIsSUFBSSxXQUFXLEdBQUcsS0FBSyxDQUFDO0FBQ3hCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7QUFDckQsTUFBTSxpQkFBaUIsR0FBb0IsRUFBRSxDQUFDLENBQUMsNkNBQTZDO0FBRTVGOzs7R0FHRztBQUNILE1BQU0sWUFBWSxHQUFzQixFQUFFLENBQUM7QUFFM0MsOEVBQThFO0FBQzlFLDJCQUEyQjtBQUMzQiw4RUFBOEU7QUFFOUUsU0FBUyxhQUFhLENBQUMsS0FBbUI7SUFDeEMsTUFBTSxNQUFNLEdBQXNCLEVBQUUsQ0FBQztJQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFpQixHQUFFLENBQUM7SUFFcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJ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LG9CQUFvQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5TWFuYWdlciAtIENvcmUgT2JzZXJ2ZXIgZm9yIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbVxuICogXG4gKiBBbGwgY29uZmlnIGFuZCBiYWNrZW5kcyByZXNvbHZlZCBmcm9tIERJIC0gbm8gbWFudWFsIGluc3RhbnRpYXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZ2VuZXJhdGVTcGFuSWQsIGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkIH0gZnJvbSAnLi91dGlscy9pZC1nZW5lcmF0b3InO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQge1xuICBDYXB0dXJlQ29udHJvbCxcbiAgQ2FwdHVyZUlucHV0LFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdSdWxlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvdHlwZXMnO1xuaW1wb3J0IHsgc3RyaW5nVG9MZXZlbCwgbGV2ZWxUb1N0cmluZyB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuaW1wb3J0IHsgZGV0ZWN0U291cmNlLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQsIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyB9IGZyb20gJy4vY29udGV4dCc7XG5pbXBvcnQgeyBpbml0aWFsaXplQ2FwdHVyZXIsIHJlc2V0Q2FwdHVyZXIgfSBmcm9tICcuL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGknO1xuaW1wb3J0IHsgTm9Qcm92aWRlckZvdW5kRXJyb3IgfSBmcm9tICcuLi9kaS9lcnJvcnMnO1xuaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uJztcbmltcG9ydCB7IGJ1aWxkVHJhY2VHcmFwaCB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZywgdHlwZSBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQgfSBmcm9tICcuL2NvbmZpZyc7XG5pbXBvcnQgeyBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgcnVuU3BhbkZpbmFsaXplciB9IGZyb20gJy4vcnVudGltZS1zdGF0ZSc7XG5pbXBvcnQgeyBtYXRjaGVzUGF0dGVybiwgcmVwbGFjZVBhdHRlcm4gfSBmcm9tICcuL3V0aWxzL3BhdHRlcm4tdXRpbHMnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmFiaWxpdHlNYW5hZ2VyJyk7XG5cbmludGVyZmFjZSBWYWxpZGF0aW9uRXJyb3Ige1xuICBmaWVsZDogc3RyaW5nO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBNT0RVTEUgU1RBVEVcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5sZXQgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCA9IG51bGw7XG5sZXQgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcbmxldCBiYWNrZW5kQ29uZmlncyA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnYmFja2VuZHMnIF1bIDAgXT4oKTtcbmxldCBpbnZvY2F0aW9uQ291bnQgPSAwO1xubGV0IGluaXRpYWxpemVkID0gZmFsc2U7XG5jb25zdCBzYW1wbGluZ1JlZ2V4Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUmVnRXhwPigpO1xuY29uc3QgcGVuZGluZ0Rpc3BhdGNoZXM6IFByb21pc2U8dm9pZD5bXSA9IFtdOyAvLyBUcmFjayBmaXJlLWFuZC1mb3JnZXQgcHJvbWlzZXMgZm9yIGZsdXNoKClcblxuLyoqXG4gKiBQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgLSBjYWxsYmFja3MgdGhhdCBydW4gYmVmb3JlIGJhY2tlbmRzIGFyZSBpbml0aWFsaXplZC5cbiAqIFVzZWQgdG8gcmVnaXN0ZXIgc2NoZW1hcy9zZXJ2aWNlcyBuZWVkZWQgYnkgYmFja2VuZHMgd2l0aG91dCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gKi9cbmNvbnN0IHByZUluaXRIb29rczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIEhFTFBFUiBGVU5DVElPTlNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5mdW5jdGlvbiB2YWxpZGF0ZUlucHV0KGlucHV0OiBDYXB0dXJlSW5wdXQpOiBWYWxpZGF0aW9uRXJyb3JbXSB7XG4gIGNvbnN0IGVycm9yczogVmFsaWRhdGlvbkVycm9yW10gPSBbXTtcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgaWYgKCFpbnB1dC50eXBlKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ3R5cGUnLCBtZXNzYWdlOiAndHlwZSBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmxldmVsKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ2xldmVsJywgbWVzc2FnZTogJ2xldmVsIGlzIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGlmICghaW5wdXQuY29ycmVsYXRpb25JZCAmJiAhY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgIGVycm9ycy5wdXNoKHtcbiAgICAgIGZpZWxkOiAnY29ycmVsYXRpb25JZCcsXG4gICAgICBtZXNzYWdlOiAnY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZC4gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzLCBvciB1c2UgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoKS4nXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuXG5mdW5jdGlvbiBhcHBseURhdGFQcm90ZWN0aW9uKFxuICBpbnB1dDogQ2FwdHVyZUlucHV0LFxuICBkYXRhUHJvdGVjdGlvbj86IE9ic2VydmFiaWxpdHlDb25maWdbICdkYXRhUHJvdGVjdGlvbicgXVxuKToge1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBlcnJvcj86IE9ic2VydmFiaWxpdHlFcnJvcjtcbn0ge1xuICBpZiAoIWRhdGFQcm90ZWN0aW9uPy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6IGlucHV0LmRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgICAgbWV0YWRhdGE6IGlucHV0Lm1ldGFkYXRhLFxuICAgICAgY29udGV4dDogaW5wdXQuY29udGV4dCxcbiAgICAgIGVycm9yOiBpbnB1dC5lcnJvcixcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZmllbGRzID0gZGF0YVByb3RlY3Rpb24uZmllbGRzID8/IFsgJ2RhdGEnLCAnYXR0cmlidXRlcycsICdtZXRhZGF0YScsICdjb250ZXh0JyBdO1xuXG4gIHJldHVybiB7XG4gICAgZGF0YTogZmllbGRzLmluY2x1ZGVzKCdkYXRhJykgJiYgaW5wdXQuZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5kYXRhLFxuICAgIGF0dHJpYnV0ZXM6IGZpZWxkcy5pbmNsdWRlcygnYXR0cmlidXRlcycpICYmIGlucHV0LmF0dHJpYnV0ZXNcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5hdHRyaWJ1dGVzLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuYXR0cmlidXRlcyxcbiAgICBtZXRhZGF0YTogZmllbGRzLmluY2x1ZGVzKCdtZXRhZGF0YScpICYmIGlucHV0Lm1ldGFkYXRhXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQubWV0YWRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5tZXRhZGF0YSxcbiAgICBjb250ZXh0OiBmaWVsZHMuaW5jbHVkZXMoJ2NvbnRleHQnKSAmJiBpbnB1dC5jb250ZXh0XG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuY29udGV4dCwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmNvbnRleHQsXG4gICAgZXJyb3I6IGZpZWxkcy5pbmNsdWRlcygnZXJyb3InKSAmJiBpbnB1dC5lcnJvclxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmVycm9yLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZXJyb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRXZlbnQoaW5wdXQ6IENhcHR1cmVJbnB1dCwgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+IHwgbnVsbCA9IG51bGwpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBjb25zdCBjdHggPSBjb250ZXh0ID8/IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG5cbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGlucHV0LmNvcnJlbGF0aW9uSWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgLSB0aGlzIHNob3VsZCBoYXZlIGJlZW4gY2F1Z2h0IGJ5IHZhbGlkYXRpb24nKTtcbiAgfVxuXG4gIGNvbnN0IHsgZGF0YSwgYXR0cmlidXRlcywgbWV0YWRhdGEsIGNvbnRleHQ6IGV2ZW50Q29udGV4dCwgZXJyb3IgfSA9IGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gICAgaW5wdXQsXG4gICAgY29uZmlnPy5kYXRhUHJvdGVjdGlvblxuICApO1xuXG4gIC8vIE9wZXJhdGlvbiBub3JtYWxpemF0aW9uIChyZWR1Y2UgY2FyZGluYWxpdHkgKyBpbXByb3ZlIGNyb3NzLWJhY2tlbmQgY29uc2lzdGVuY3kpXG4gIGNvbnN0IG9wTm9ybSA9IGNvbmZpZz8ub3BlcmF0aW9uTm9ybWFsaXphdGlvbjtcbiAgbGV0IG9wZXJhdGlvbiA9IGlucHV0Lm9wZXJhdGlvbjtcbiAgbGV0IG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKG9wTm9ybT8uZW5hYmxlZCAmJiBvcGVyYXRpb24pIHtcbiAgICBjb25zdCBvcmlnaW5hbE9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICBjb25zdCBhcHBsaWVkUnVsZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgZnJvbTogc3RyaW5nOyB0bzogc3RyaW5nOyByZWFzb24/OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCB0eXBlTWF0Y2ggPSAoXG4gICAgICBydWxlVHlwZXM6IE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdWyAncnVsZXMnIF1bIG51bWJlciBdWyAndHlwZXMnIF0gfCB1bmRlZmluZWQsXG4gICAgICBldmVudFR5cGU6IHN0cmluZ1xuICAgICkgPT4ge1xuICAgICAgaWYgKCFydWxlVHlwZXMpIHJldHVybiB0cnVlO1xuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShydWxlVHlwZXMpID8gcnVsZVR5cGVzIDogWyBydWxlVHlwZXMgXTtcbiAgICAgIC8vIENvbXBhcmUgYnkgc3RyaW5nIHRvIGF2b2lkIHVuc2FmZSBjYXN0aW5nIChPYnNlcnZhYmlsaXR5RXZlbnRUeXBlIGlzIHN0cmluZy1iYXNlZCBhbnl3YXkpLlxuICAgICAgcmV0dXJuIGFyci5tYXAoU3RyaW5nKS5pbmNsdWRlcyhldmVudFR5cGUpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2Ygb3BOb3JtLnJ1bGVzID8/IFtdKSB7XG4gICAgICBpZiAoIXR5cGVNYXRjaChydWxlLnR5cGVzLCBpbnB1dC50eXBlKSkgY29udGludWU7XG4gICAgICBpZiAoIW1hdGNoZXNQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgbmV4dCA9IHJlcGxhY2VQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCwgcnVsZS5yZXBsYWNlKTtcbiAgICAgIGlmIChuZXh0ICE9PSBvcGVyYXRpb24pIHtcbiAgICAgICAgYXBwbGllZFJ1bGVzLnB1c2goeyBpZDogcnVsZS5pZCwgZnJvbTogb3BlcmF0aW9uLCB0bzogbmV4dCwgcmVhc29uOiBydWxlLnJlYXNvbiB9KTtcbiAgICAgICAgb3BlcmF0aW9uID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPbmx5IGF0dGFjaCBtZXRhIGlmIHRoZSBvcGVyYXRpb24gYWN0dWFsbHkgY2hhbmdlZFxuICAgIGlmIChvcE5vcm0uc3RvcmVPcmlnaW5hbCAhPT0gZmFsc2UgJiYgb3BlcmF0aW9uICE9PSBvcmlnaW5hbE9wZXJhdGlvbikge1xuICAgICAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgPSB7XG4gICAgICAgIGZyb206IG9yaWdpbmFsT3BlcmF0aW9uLFxuICAgICAgICB0bzogb3BlcmF0aW9uLFxuICAgICAgICBydWxlSWRzOiBhcHBsaWVkUnVsZXMubWFwKHIgPT4gci5pZCksXG4gICAgICAgIHJ1bGVzOiBhcHBsaWVkUnVsZXMsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICBsZXZlbDogaW5wdXQubGV2ZWwsXG4gICAgY29ycmVsYXRpb25JZCxcbiAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gbm93LFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkKGNvcnJlbGF0aW9uSWQpLFxuICAgIC8vIG51bGwgPSBleHBsaWNpdGx5IG5vIHBhcmVudCAtIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBzaG91bGQgYmUgcmVzb2x2ZWQgYnkgY2FsbGVyIChzcGFuIHRyZWUpXG4gICAgLy8gdW5kZWZpbmVkID0gdXNlIHdoYXQgd2FzIHByb3ZpZGVkXG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgY2F1c2VkQnk6IGlucHV0LmNhdXNlZEJ5LFxuICAgIHJlbGF0ZWRUcmFjZXM6IGlucHV0LnJlbGF0ZWRUcmFjZXMsXG4gICAgYWN0b3I6IGlucHV0LmFjdG9yID8/IGN0eD8uYWN0b3IsXG4gICAgc291cmNlOiBpbnB1dC5zb3VyY2UgPz8gY3R4Py5vYnNlcnZhYmlsaXR5Py5zb3VyY2UgPz8gZGV0ZWN0U291cmNlKCksXG4gICAgdGFnczogbWVyZ2VUYWdzKHsgLi4uY3R4Py5vYnNlcnZhYmlsaXR5Py50YWdzLCAuLi5pbnB1dC50YWdzIH0sIHRydWUpLFxuICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgZW50aXR5SWQ6IGlucHV0LmVudGl0eUlkLFxuICAgIG9wZXJhdGlvbixcbiAgICBzdWJUeXBlOiBpbnB1dC5zdWJUeXBlLFxuICAgIHN0YXR1czogaW5wdXQuc3RhdHVzLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NczogaW5wdXQuZHVyYXRpb25NcyxcbiAgICBkYXRhOiBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YVxuICAgICAgPyB7IC4uLihkYXRhID8/IHt9KSwgb3BlcmF0aW9uTm9ybWFsaXphdGlvbjogb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgfVxuICAgICAgOiBkYXRhLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGEsXG4gICAgbWV0cmljczogaW5wdXQubWV0cmljcyxcbiAgICBjb250ZXh0OiBldmVudENvbnRleHQsXG4gICAgZXJyb3IsXG4gICAgY2FwdHVyZTogaW5wdXQuY2FwdHVyZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXRlZ29yaXplIGV2ZW50IHR5cGUgZm9yIGJhY2tlbmQgcm91dGluZyBhbmQgc2FtcGxpbmdcbiAqIFxuICogQ3VzdG9tIGV2ZW50IHR5cGVzIGFyZSBzdXBwb3J0ZWQhIFVzZSBhbnkgbmFtaW5nIGNvbnZlbnRpb246XG4gKiAtICdidXNpbmVzcy5vcmRlcl9wbGFjZWQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAncGF5bWVudC50cmFuc2FjdGlvbicg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiAtICdub3RpZmljYXRpb24uc2VudCcg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiBcbiAqIFRvIGNvbnRyb2wgYmFja2VuZCByb3V0aW5nIGZvciBjdXN0b20gdHlwZXMsIHVzZSB0eXBlLXNwZWNpZmljIGNvbmZpZzpcbiAqIGBgYFxuICogb2JzZXJ2YWJpbGl0eToge1xuICogICB0eXBlczoge1xuICogICAgIGxvZzogeyBiYWNrZW5kczogWydjbG91ZHdhdGNoJywgJ2R5bmFtb2RiJ10gfVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZnVuY3Rpb24gZ2V0VHlwZUNhdGVnb3J5KHR5cGU6IHN0cmluZyk6ICdzcGFuJyB8ICdtZXRyaWMnIHwgJ2F1ZGl0JyB8ICdsb2cnIHtcbiAgLy8gJ3NwYW4nID0gY29uc29saWRhdGVkIHNwYW4gcmVjb3JkLCAnc3Bhbi5zdGFydCcgPSBPVEVMLW9ubHkgc3RhcnQgbWFya2VyLlxuICAvLyBGVzI0IGRvZXMgTk9UIHN1cHBvcnQgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cyAobm8gY29tcGF0aWJpbGl0eSBndWFyYW50ZWVzKS5cbiAgaWYgKHR5cGUgPT09ICdzcGFuJyB8fCB0eXBlID09PSAnc3Bhbi5zdGFydCcpIHJldHVybiAnc3Bhbic7XG4gIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgLy8gQWxsIGN1c3RvbSBldmVudCB0eXBlcyBkZWZhdWx0IHRvICdsb2cnIGNhdGVnb3J5XG4gIC8vIFRoaXMgaW5jbHVkZXM6ICdidXNpbmVzcy4qJywgJ3BheW1lbnQuKicsICdub3RpZmljYXRpb24uKicsIGV0Yy5cbiAgcmV0dXJuICdsb2cnO1xufVxuXG5mdW5jdGlvbiBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgaWYgKHR5cGVDb25maWc/LmJhY2tlbmRzICYmIHR5cGVDb25maWcuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSk7XG4gIH1cblxuICByZXR1cm4gYmFja2VuZHM7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYmFja2VuZCBzaG91bGQgY2FwdHVyZSB0aGlzIGV2ZW50IGJhc2VkIG9uIHR5cGUgZmlsdGVyaW5nXG4gKi9cbmZ1bmN0aW9uIHNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShcbiAgYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnRcbik6IGJvb2xlYW4ge1xuICAvLyBQZXItZXZlbnQgYmFja2VuZCBmaWx0ZXIgKHVzZWQgZm9yIE9URUwgc3BhbiB0cmFja2luZyBpbiBjb25zb2xpZGF0ZWQgbW9kZSlcbiAgaWYgKGV2ZW50LmNhcHR1cmU/LmJhY2tlbmRzICYmIGV2ZW50LmNhcHR1cmUuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIGlmICghZXZlbnQuY2FwdHVyZS5iYWNrZW5kcy5pbmNsdWRlcyhiYWNrZW5kLm5hbWUgYXMgJ2Nsb3Vkd2F0Y2gnIHwgJ2R5bmFtb2RiJyB8ICdvdGVsJykpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBiYWNrZW5kQ2ZnID0gYmFja2VuZENvbmZpZ3MuZ2V0KGJhY2tlbmQubmFtZSk7XG4gIGlmICghYmFja2VuZENmZykgcmV0dXJuIHRydWU7IC8vIE5vIGNvbmZpZyA9IGFsbG93IGFsbFxuXG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgdHlwZUZpbHRlciA9IGJhY2tlbmRDZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgLy8gQ2hlY2sgaWYgdHlwZSBpcyBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIGJhY2tlbmRcbiAgaWYgKHR5cGVGaWx0ZXI/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIENoZWNrIHBlci10eXBlIG1pbkxldmVsIChvdmVycmlkZXMgYmFja2VuZC1sZXZlbCBtaW5MZXZlbClcbiAgaWYgKHR5cGVGaWx0ZXI/Lm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnRMZXZlbCA8IHR5cGVGaWx0ZXIubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoYmFja2VuZC5taW5MZXZlbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gRmFsbCBiYWNrIHRvIGJhY2tlbmQtbGV2ZWwgbWluTGV2ZWxcbiAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBDaGVjayBwZXItdHlwZSBzYW1wbGluZ1xuICBpZiAodHlwZUZpbHRlcj8uc2FtcGxpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUZpbHRlci5zYW1wbGluZztcbiAgfVxuXG4gIHJldHVybiB0cnVlOyAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogdm9pZCB7XG4gIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2FwdHVyZSBpbiBiYWNrZW5kICR7YmFja2VuZC5uYW1lfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfSksXG4gICkudGhlbigoKSA9PiB7IH0pOyAvLyBDb252ZXJ0IHRvIFByb21pc2U8dm9pZD5cblxuICAvLyBUcmFjayBwcm9taXNlIHNvIGZsdXNoKCkgY2FuIHdhaXQgZm9yIGl0XG4gIHBlbmRpbmdEaXNwYXRjaGVzLnB1c2gocHJvbWlzZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdGFyZ2V0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBldmVudCkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBlbmZvcmNlSGllcmFyY2h5SW50ZWdyaXR5T3JEcm9wKFxuICBldmVudHM6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBjdHhDb3JyZWxhdGlvbklkOiBzdHJpbmcsXG4pOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gIC8vIFN0cmljdCBjb250cmFjdDogcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIG11c3QgYWx3YXlzIHJlZmVyIHRvIGFuIGV4aXN0aW5nIHNwYW4gd2l0aGluIHRoaXMgc2xpY2UuXG4gIC8vIElmIHZpb2xhdGVkIChsaWtlbHkgZHVlIHRvIG1hbnVhbCBpbmplY3Rpb24pLCB3ZSBkcm9wIG9mZmVuZGluZyBldmVudHMgYW5kIGVtaXQgYSBzaW5nbGUgZXJyb3IgbG9nLlxuICBjb25zdCBncmFwaCA9IGJ1aWxkVHJhY2VHcmFwaChldmVudHMsIHsgc3RyaWN0UGFyZW50czogZmFsc2UgfSk7XG4gIGlmIChncmFwaC5taXNzaW5nUGFyZW50U3Bhbklkcy5zaXplID09PSAwICYmIGdyYXBoLmNyb3NzU2xpY2VQYXJlbnRTcGFuSWRzLnNpemUgPT09IDApIHJldHVybiBldmVudHM7XG5cbiAgY29uc3QgbWlzc2luZyA9IGdyYXBoLm1pc3NpbmdQYXJlbnRTcGFuSWRzO1xuICBjb25zdCBjcm9zc1NsaWNlID0gZ3JhcGguY3Jvc3NTbGljZVBhcmVudFNwYW5JZHM7XG4gIGNvbnN0IGZpbHRlcmVkID0gZXZlbnRzLmZpbHRlcigoZSkgPT4ge1xuICAgIGNvbnN0IHBpZCA9IGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gIShwaWQgJiYgKG1pc3NpbmcuaGFzKHBpZCkgfHwgY3Jvc3NTbGljZS5oYXMocGlkKSkpO1xuICB9KTtcblxuICBjb25zdCBkcm9wcGVkQ291bnQgPSBldmVudHMubGVuZ3RoIC0gZmlsdGVyZWQubGVuZ3RoO1xuICBmaWx0ZXJlZC5wdXNoKHtcbiAgICB0eXBlOiAnbG9nJyxcbiAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICBjb3JyZWxhdGlvbklkOiBjdHhDb3JyZWxhdGlvbklkLFxuICAgIHRpbWVzdGFtcE1zOiBEYXRlLm5vdygpLFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZ2VuZXJhdGVPYnNlcnZhYmlsaXR5TG9nSWQoY3R4Q29ycmVsYXRpb25JZCksXG4gICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW4nLFxuICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgIGNhcHR1cmU6IHsgYnlwYXNzOiB0cnVlIH0sXG4gICAgZGF0YToge1xuICAgICAgZHJvcHBlZENvdW50LFxuICAgICAgbWlzc2luZ1BhcmVudFNwYW5JZHM6IEFycmF5LmZyb20obWlzc2luZykuc2xpY2UoMCwgMTApLFxuICAgICAgY3Jvc3NTbGljZVBhcmVudFNwYW5JZHM6IEFycmF5LmZyb20oY3Jvc3NTbGljZSkuc2xpY2UoMCwgMTApLFxuICAgIH0sXG4gICAgc291cmNlOiAnT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2gnLFxuICB9KTtcblxuICByZXR1cm4gZmlsdGVyZWQ7XG59XG5cbmZ1bmN0aW9uIGdldEVmZmVjdGl2ZUxldmVsRm9yVHlwZSh0eXBlOiAnc3BhbicgfCAnbWV0cmljJyB8ICdhdWRpdCcgfCAnbG9nJyk6IE9ic2VydmFiaWxpdHlMZXZlbCB7XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjb25maWc/LnR5cGVzPy5bIHR5cGUgXTtcbiAgcmV0dXJuIHR5cGVDb25maWc/Lm1pbkxldmVsID8/IGNvbmZpZz8ubWluTGV2ZWwgPz8gT2JzZXJ2YWJpbGl0eUxldmVsLklORk87XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYW4gZXZlbnQgbWF0Y2hlcyBhIHNhbXBsaW5nIHJ1bGVcbiAqL1xuZnVuY3Rpb24gbWF0Y2hlc1J1bGUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgcnVsZTogU2FtcGxpbmdSdWxlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgdGFyZ2V0LCBwYXR0ZXJuIH0gPSBydWxlO1xuXG4gIGxldCB2YWx1ZVRvTWF0Y2g6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBzd2l0Y2ggKHRhcmdldCkge1xuICAgIGNhc2UgJ3RlbmFudCc6XG4gICAgICAvLyBDaGVjayBhY3Rvci50ZW5hbnRJZCBvciB0YWdzLnRlbmFudElkXG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5hY3Rvcj8udGVuYW50SWQgPz8gZXZlbnQudGFncz8udGVuYW50SWQ7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3JvdXRlJzpcbiAgICAgIC8vIENoZWNrIHNvdXJjZSAoZS5nLiwgXCJPcmRlckNvbnRyb2xsZXIuY3JlYXRlXCIpIG9yIG9wZXJhdGlvblxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuc291cmNlID8/IGV2ZW50Lm9wZXJhdGlvbjtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAndGFnJzpcbiAgICAgIC8vIFBhdHRlcm4gZm9ybWF0OiBcImtleTp2YWx1ZVwiIG9yIFwia2V5OipcIlxuICAgICAgaWYgKHR5cGVvZiBwYXR0ZXJuID09PSAnc3RyaW5nJyAmJiBwYXR0ZXJuLmluY2x1ZGVzKCc6JykpIHtcbiAgICAgICAgY29uc3QgWyBrZXksIHZhbHVlUGF0dGVybiBdID0gcGF0dGVybi5zcGxpdCgnOicsIDIpO1xuICAgICAgICBjb25zdCB0YWdWYWx1ZSA9IGV2ZW50LnRhZ3M/Llsga2V5IF07XG4gICAgICAgIGlmICghdGFnVmFsdWUpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBpZiAodmFsdWVQYXR0ZXJuID09PSAnKicpIHJldHVybiB0cnVlO1xuXG4gICAgICAgIC8vIFRlc3QgYWdhaW5zdCB2YWx1ZSBwYXR0ZXJuIChzdXBwb3J0cyB3aWxkY2FyZHMpXG4gICAgICAgIGNvbnN0IHJlZ2V4ID0gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHZhbHVlUGF0dGVybik7XG4gICAgICAgIHJldHVybiByZWdleC50ZXN0KHRhZ1ZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcblxuICAgIGNhc2UgJ2FjdG9yJzpcbiAgICAgIC8vIENoZWNrIGFjdG9ySWQgb3IgYWN0b3JUeXBlXG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5hY3Rvcj8uYWN0b3JJZCA/PyBldmVudC5hY3Rvcj8uYWN0b3JUeXBlO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdzb3VyY2UnOlxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuc291cmNlO1xuICAgICAgYnJlYWs7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgaWYgKCF2YWx1ZVRvTWF0Y2gpIHJldHVybiBmYWxzZTtcblxuICAvLyBNYXRjaCBhZ2FpbnN0IHBhdHRlcm4gKHN0cmluZyBvciBSZWdFeHApXG4gIGlmIChwYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgcmV0dXJuIHBhdHRlcm4udGVzdCh2YWx1ZVRvTWF0Y2gpO1xuICB9XG5cbiAgLy8gU3RyaW5nIHBhdHRlcm4gd2l0aCB3aWxkY2FyZCBzdXBwb3J0XG4gIGNvbnN0IHJlZ2V4ID0gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm4pO1xuICByZXR1cm4gcmVnZXgudGVzdCh2YWx1ZVRvTWF0Y2gpO1xufVxuXG5mdW5jdGlvbiBzaG91bGRDYXB0dXJlKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjZmc6IE9ic2VydmFiaWxpdHlDb25maWcsXG4gIG9wdGlvbnM/OiB7XG4gICAgLyoqXG4gICAgICogV2hlbiB0cnVlLCBzcGFucyBtYXkgYmUgZHJvcHBlZCBiYXNlZCBvbiBjZmcuc3BhbnMubWluRHVyYXRpb25Ncy5cbiAgICAgKiBXaGVuIGZhbHNlLCBzcGFucyBhcmUgYWx3YXlzIGtlcHQgKG5lZWRlZCB3aGVuIHdlIGNhbm5vdCBzZWUgdGhlIGZ1bGwgcGFyZW50L2NoaWxkIGdyYXBoKS5cbiAgICAgKi9cbiAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A/OiBib29sZWFuO1xuICAgIC8qKlxuICAgICAqIFBhcmVudCBzcGFuIElEcyByZWZlcmVuY2VkIGJ5IGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICAgKiBJZiBhIHNwYW4gaXMgcmVmZXJlbmNlZCBoZXJlLCBpdCBtdXN0IE5FVkVSIGJlIGRyb3BwZWQuXG4gICAgICovXG4gICAgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHM/OiBSZWFkb25seVNldDxzdHJpbmc+O1xuICB9XG4pOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkoZXZlbnQudHlwZSk7XG4gIGNvbnN0IGVmZmVjdGl2ZUxldmVsID0gZ2V0RWZmZWN0aXZlTGV2ZWxGb3JUeXBlKHR5cGVDYXRlZ29yeSk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuICBjb25zdCBpc1NwYW5SZWNvcmQgPSBldmVudC50eXBlID09PSAnc3Bhbic7XG4gIGNvbnN0IGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9IG9wdGlvbnM/LmFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9PT0gdHJ1ZTtcbiAgY29uc3QgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMgPSBvcHRpb25zPy5yZWZlcmVuY2VkUGFyZW50U3BhbklkcztcblxuICAvLyA9PT0gQllQQVNTIFNBTVBMSU5HIChhbHdheXMgY2FwdHVyZSkgPT09XG4gIC8vIFByaW9yaXR5IG9yZGVyIC0gaWYgYW55IG9mIHRoZXNlIG1hdGNoLCBjYXB0dXJlIGltbWVkaWF0ZWx5XG5cbiAgLy8gMS4gRXhwbGljaXQgYnlwYXNzIGZsYWcgaW4gQ2FwdHVyZUNvbnRyb2xcbiAgaWYgKGNhcHR1cmU/LmJ5cGFzcykge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gMi4gQ1JJVElDQUwgbG9nIGxldmVsIGFsd2F5cyBjYXB0dXJlZFxuICBpZiAobGV2ZWxWYWx1ZSA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAzLiBFcnJvcnMgYWx3YXlzIGNhcHR1cmVkXG4gIGlmIChldmVudC5lcnJvciB8fCBldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gPT09IFNQQU4tU1BFQ0lGSUMgRklMVEVSSU5HID09PVxuICBpZiAoaXNTcGFuUmVjb3JkKSB7XG4gICAgY29uc3QgaWQgPSBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKGlkICYmIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzPy5oYXMoaWQpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gUGVyLWV2ZW50IG1pbkR1cmF0aW9uTXMgb3ZlcnJpZGVzIGdsb2JhbCBjb25maWdcbiAgICAgIC8vIFNldCBjYXB0dXJlLm1pbkR1cmF0aW9uTXMgPSAwIHRvIGNhcHR1cmUgcmVnYXJkbGVzcyBvZiBkdXJhdGlvblxuICAgICAgY29uc3QgbWluRHVyYXRpb24gPSBjYXB0dXJlPy5taW5EdXJhdGlvbk1zID8/IGNmZy5zcGFucy5taW5EdXJhdGlvbk1zO1xuXG4gICAgICBpZiAobWluRHVyYXRpb24gPiAwICYmIGV2ZW50LmR1cmF0aW9uTXMgPCBtaW5EdXJhdGlvbikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IENBUFRVUkUgQ09OVFJPTCBGSUxURVJJTkcgPT09XG5cbiAgLy8gNC4gRHVyYXRpb24gdGhyZXNob2xkIGZvciBub24tc3BhbiBldmVudHMgKGUuZy4sIHNsb3cgcXVlcmllcylcbiAgaWYgKCFpc1NwYW5SZWNvcmQgJiYgY2FwdHVyZT8ubWluRHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zIDwgY2FwdHVyZS5taW5EdXJhdGlvbk1zKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gNS4gR3JvdXAtYmFzZWQgc2FtcGxpbmcgZm9yIGJhdGNoIHNjZW5hcmlvc1xuICBpZiAoY2FwdHVyZT8uZ3JvdXApIHtcbiAgICBjb25zdCB7IGluZGV4LCBjYXB0dXJlRmlyc3QgPSAzLCBzYW1wbGVSYXRlID0gMC4xIH0gPSBjYXB0dXJlLmdyb3VwO1xuXG4gICAgLy8gTm90ZTogRXJyb3JzIGFscmVhZHkgcmV0dXJuZWQgdHJ1ZSBhYm92ZSAobGluZSB+MzYwKVxuICAgIC8vIENhcHR1cmUgZmlyc3QgTiBpdGVtc1xuICAgIGlmIChpbmRleCA8IGNhcHR1cmVGaXJzdCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIHRoZSByZXN0XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBzYW1wbGVSYXRlO1xuICB9XG5cbiAgLy8gPT09IFNUQU5EQVJEIEZJTFRFUklORyAobWF5IHJlamVjdCkgPT09XG4gIC8vIENoZWNrIG1pbmltdW0gbGV2ZWxcbiAgaWYgKGxldmVsVmFsdWUgPCBlZmZlY3RpdmVMZXZlbCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIElmIHNhbXBsaW5nIGRpc2FibGVkLCBjYXB0dXJlIGV2ZXJ5dGhpbmdcbiAgaWYgKCFjZmcuc2FtcGxpbmc/LmVuYWJsZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vID09PSBSVUxFLUJBU0VEIFNBTVBMSU5HIChIaWdoZXN0IFByaW9yaXR5KSA9PT1cbiAgLy8gUnVsZXMgYXJlIGV2YWx1YXRlZCBpbiBvcmRlci4gRmlyc3QgbWF0Y2ggd2lucy5cbiAgaWYgKGNmZy5zYW1wbGluZy5ydWxlcyAmJiBjZmcuc2FtcGxpbmcucnVsZXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcnVsZSBvZiBjZmcuc2FtcGxpbmcucnVsZXMpIHtcbiAgICAgIGlmIChtYXRjaGVzUnVsZShldmVudCwgcnVsZSkpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBydWxlLnJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IFRZUEUtU1BFQ0lGSUMgU0FNUExJTkcgPT09XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG4gIGlmICh0eXBlQ29uZmlnPy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICB9XG5cbiAgLy8gPT09IE9QRVJBVElPTi1CQVNFRCBTQU1QTElORyA9PT1cbiAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjZmcuc2FtcGxpbmcub3BlcmF0aW9ucykge1xuICAgIGZvciAoY29uc3QgWyBwYXR0ZXJuLCByYXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY2ZnLnNhbXBsaW5nLm9wZXJhdGlvbnMpKSB7XG4gICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgICAgIGlmIChyZWdleC50ZXN0KGV2ZW50Lm9wZXJhdGlvbikpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBMRVZFTC1CQVNFRCBTQU1QTElORyAoRmFsbGJhY2spID09PVxuICBjb25zdCBsZXZlbE5hbWUgPSBsZXZlbFRvU3RyaW5nKGxldmVsVmFsdWUpO1xuICBjb25zdCByYXRlID0gY2ZnLnNhbXBsaW5nLnJhdGVzPy5bIGxldmVsTmFtZSBdO1xuICBpZiAocmF0ZSA9PT0gdW5kZWZpbmVkIHx8IHJhdGUgPj0gMSkgcmV0dXJuIHRydWU7XG4gIGlmIChyYXRlIDw9IDApIHJldHVybiBmYWxzZTtcblxuICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG59XG5cbmZ1bmN0aW9uIGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuOiBzdHJpbmcpOiBSZWdFeHAge1xuICBjb25zdCBNQVhfUkVHRVhfQ0FDSEVfU0laRSA9IDEwMDtcblxuICBsZXQgcmVnZXggPSBzYW1wbGluZ1JlZ2V4Q2FjaGUuZ2V0KHBhdHRlcm4pO1xuICBpZiAoIXJlZ2V4KSB7XG4gICAgLy8gRXZpY3Qgb2xkZXN0IGVudHJ5IGlmIGNhY2hlIGlzIGZ1bGwgKEZJRk8gZXZpY3Rpb24pXG4gICAgaWYgKHNhbXBsaW5nUmVnZXhDYWNoZS5zaXplID49IE1BWF9SRUdFWF9DQUNIRV9TSVpFKSB7XG4gICAgICBjb25zdCBmaXJzdEtleSA9IHNhbXBsaW5nUmVnZXhDYWNoZS5rZXlzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgaWYgKGZpcnN0S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FtcGxpbmdSZWdleENhY2hlLmRlbGV0ZShmaXJzdEtleSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmVnZXggPSBuZXcgUmVnRXhwKGBeJHtwYXR0ZXJuLnJlcGxhY2UoL1xcKi9nLCAnLionKX0kYCk7XG4gICAgc2FtcGxpbmdSZWdleENhY2hlLnNldChwYXR0ZXJuLCByZWdleCk7XG4gIH1cbiAgcmV0dXJuIHJlZ2V4O1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBwcmlvcml0eSBmb3IgYnVmZmVyIGV2aWN0aW9uLlxuICogSGlnaGVyIHByaW9yaXR5ID0ga2VlcCBpbiBidWZmZXJcbiAqL1xuZnVuY3Rpb24gZ2V0RXZlbnRQcmlvcml0eShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogbnVtYmVyIHtcbiAgLy8gQnlwYXNzIGV2ZW50cyBORVZFUiBnZXQgZXZpY3RlZCAobWF4IHByaW9yaXR5KVxuICBpZiAoZXZlbnQuY2FwdHVyZT8uYnlwYXNzKSB7XG4gICAgcmV0dXJuIEluZmluaXR5O1xuICB9XG5cbiAgLy8gVXNlIGV4cGxpY2l0IHByaW9yaXR5IGlmIHByb3ZpZGVkXG4gIGxldCBwcmlvcml0eSA9IGV2ZW50LmNhcHR1cmU/LnByaW9yaXR5ID8/IDA7XG5cbiAgY29uc3QgbGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcblxuICAvLyBIaWdoZXIgbG9nIGxldmVscyA9IGhpZ2hlciBwcmlvcml0eVxuICBwcmlvcml0eSArPSBsZXZlbCAqIDEwO1xuXG4gIC8vIEF1ZGl0IGV2ZW50cyBhcmUgaGlnaCBwcmlvcml0eVxuICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSB7XG4gICAgcHJpb3JpdHkgKz0gNTA7XG4gIH1cblxuICAvLyBTcGFucyB3aXRoIGVycm9ycyBhcmUgaGlnaCBwcmlvcml0eVxuICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdzcGFuJykgJiYgZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UpIHtcbiAgICBwcmlvcml0eSArPSAzMDtcbiAgfVxuXG4gIC8vIExvbmcgZHVyYXRpb24gb3BlcmF0aW9ucyBhcmUgaW50ZXJlc3RpbmdcbiAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgJiYgZXZlbnQuZHVyYXRpb25NcyA+IDEwMDApIHtcbiAgICBwcmlvcml0eSArPSAyMDtcbiAgfVxuXG4gIHJldHVybiBwcmlvcml0eTtcbn1cblxuLyoqXG4gKiBFdmljdCBsb3dlc3QgcHJpb3JpdHkgZXZlbnQgZnJvbSBidWZmZXJcbiAqIFJldHVybnMgbWV0YWRhdGEgYWJvdXQgdGhlIGV2aWN0ZWQgZXZlbnQgZm9yIGxvZ2dpbmdcbiAqL1xuZnVuY3Rpb24gZXZpY3RMb3dlc3RQcmlvcml0eShcbiAgYnVmZmVyOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSxcbiAgb3B0aW9ucz86IHsgYWxsb3dFdmljdFNwYW5zPzogYm9vbGVhbiB9XG4pOiB7IHR5cGU6IHN0cmluZzsgY29ycmVsYXRpb25JZDogc3RyaW5nOyBvcGVyYXRpb24/OiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IHJlbW92ZWRDb3VudD86IG51bWJlciB9IHwgbnVsbCB7XG4gIGlmIChidWZmZXIubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBhbGxvd0V2aWN0U3BhbnMgPSBvcHRpb25zPy5hbGxvd0V2aWN0U3BhbnMgPT09IHRydWU7XG5cbiAgLy8gU1RSSUNUIFRSRUUgRVZJQ1RJT046XG4gIC8vIFdoZW4gdGhlIGJ1ZmZlciBpcyBmdWxsLCB3ZSBNVVNUIE5PVCBldmljdCBhIHBhcmVudCBzcGFuIHdoaWxlIGtlZXBpbmcgaXRzIGNoaWxkcmVuLFxuICAvLyBvdGhlcndpc2UgZmx1c2goKSB3aWxsIGVtaXQgYG9ic2VydmFiaWxpdHkuaW52YXJpYW50X3Zpb2xhdGlvbi5taXNzaW5nX3BhcmVudF9zcGFuYC5cbiAgLy9cbiAgLy8gV2Ugc29sdmUgdGhpcyBsaWtlIGEgcmVhbCB0cmVlIHByb2JsZW06XG4gIC8vIDEpIFByZWZlciBldmljdGluZyBcImxlYWZcIiBldmVudHM6IGV2ZW50cyB0aGF0IGFyZSBOT1QgcmVmZXJlbmNlZCBhcyBhIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBieSBhbnkgb3RoZXIgYnVmZmVyZWQgZXZlbnQuXG4gIC8vIDIpIFByZWZlciBldmljdGluZyBub24tc3BhbiBsZWF2ZXMgKGxvZ3MvbWV0cmljcykgYmVmb3JlIHNwYW5zLlxuICAvLyAzKSBJZiBubyBsZWF2ZXMgZXhpc3QgKHJhcmUpLCBldmljdCBhbiBldmVudCBBTkQgaXRzIHdob2xlIGRlc2NlbmRhbnQgc3VidHJlZSBzbyBubyBvcnBoYW5zIHJlbWFpbi5cblxuICBjb25zdCByZWZlcmVuY2VkQXNQYXJlbnQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgY2hpbGRyZW5CeVBhcmVudCA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5RXZlbnRbXT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIGJ1ZmZlcikge1xuICAgIGNvbnN0IHBpZCA9IGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZDtcbiAgICBpZiAodHlwZW9mIHBpZCA9PT0gJ3N0cmluZycgJiYgcGlkLmxlbmd0aCA+IDApIHtcbiAgICAgIHJlZmVyZW5jZWRBc1BhcmVudC5hZGQocGlkKTtcbiAgICAgIGNvbnN0IGFyciA9IGNoaWxkcmVuQnlQYXJlbnQuZ2V0KHBpZCk7XG4gICAgICBpZiAoYXJyKSBhcnIucHVzaChlKTtcbiAgICAgIGVsc2UgY2hpbGRyZW5CeVBhcmVudC5zZXQocGlkLCBbIGUgXSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaXNTcGFuID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS50eXBlID09PSAnc3BhbicgfHwgZS50eXBlID09PSAnc3Bhbi5zdGFydCc7XG4gIGNvbnN0IGdldElkID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gIGNvbnN0IGlzTGVhZiA9IChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IHtcbiAgICBjb25zdCBpZCA9IGdldElkKGUpO1xuICAgIGlmICghaWQpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiAhcmVmZXJlbmNlZEFzUGFyZW50LmhhcyhpZCk7XG4gIH07XG5cbiAgY29uc3QgcGlja0xvd2VzdCA9IChjYW5kaWRhdGVzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSkgPT4ge1xuICAgIGxldCBpZHggPSAtMTtcbiAgICBsZXQgbG93ZXN0ID0gSW5maW5pdHk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYW5kaWRhdGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwID0gZ2V0RXZlbnRQcmlvcml0eShjYW5kaWRhdGVzWyBpIF0pO1xuICAgICAgaWYgKHAgPCBsb3dlc3QpIHtcbiAgICAgICAgbG93ZXN0ID0gcDtcbiAgICAgICAgaWR4ID0gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGlkeDtcbiAgfTtcblxuICAvLyBJZiBzcGFucyBhcmUgbm90IGFsbG93ZWQgdG8gYmUgZXZpY3RlZCwgY29uc3RyYWluIGNhbmRpZGF0ZXMgdG8gbm9uLXNwYW4gZXZlbnRzIG9ubHkuXG4gIGNvbnN0IG5vblNwYW5zID0gYnVmZmVyLmZpbHRlcigoZSkgPT4gIWlzU3BhbihlKSk7XG5cbiAgLy8gUGFzcyAxOiBub24tc3BhbiBsZWF2ZXNcbiAgY29uc3Qgbm9uU3BhbkxlYXZlcyA9IG5vblNwYW5zLmZpbHRlcigoZSkgPT4gaXNMZWFmKGUpKTtcbiAgbGV0IHRhcmdldDogT2JzZXJ2YWJpbGl0eUV2ZW50IHwgdW5kZWZpbmVkO1xuICBpZiAobm9uU3BhbkxlYXZlcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChub25TcGFuTGVhdmVzKTtcbiAgICB0YXJnZXQgPSBub25TcGFuTGVhdmVzWyBpZHggXTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIWFsbG93RXZpY3RTcGFucykge1xuICAgICAgLy8gUGFzcyAyIChub24tc3BhbiBvbmx5KTogaWYgd2UgY2FuJ3QgZmluZCBhIG5vbi1zcGFuIGxlYWYsIGV2aWN0IHRoZSBsb3dlc3QtcHJpb3JpdHkgbm9uLXNwYW4uXG4gICAgICAvLyBUaGlzIHByZXNlcnZlcyBoaWVyYXJjaHkgYmVjYXVzZSBub24tc3BhbnMgYXJlIG5vdCBleHBlY3RlZCB0byBiZSBwYXJlbnRzLlxuICAgICAgaWYgKG5vblNwYW5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChub25TcGFucyk7XG4gICAgICAgIHRhcmdldCA9IG5vblNwYW5zWyBpZHggXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEJ1ZmZlciBjb250YWlucyBvbmx5IHNwYW5zIC0gY2FsbGVyIG11c3QgZGVjaWRlIHdoZXRoZXIgdG8gYWxsb3cgc3BhbiBldmljdGlvbiBvciBvdmVyZmxvdy5cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFBhc3MgMjogYW55IGxlYXZlcyAoaW5jbHVkaW5nIHNwYW5zKVxuICAgICAgY29uc3QgYW55TGVhdmVzID0gYnVmZmVyLmZpbHRlcigoZSkgPT4gaXNMZWFmKGUpKTtcbiAgICAgIGlmIChhbnlMZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGFueUxlYXZlcyk7XG4gICAgICAgIHRhcmdldCA9IGFueUxlYXZlc1sgaWR4IF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBQYXNzIDM6IG5vIGxlYXZlcyBleGlzdCAoY3ljbGUvZGVnZW5lcmF0ZSkuIFBpY2sgdGhlIG92ZXJhbGwgbG93ZXN0LXByaW9yaXR5IGV2ZW50LlxuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGJ1ZmZlcik7XG4gICAgICAgIHRhcmdldCA9IGJ1ZmZlclsgaWR4IF07XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0YXJnZXQpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRhcmdldElkID0gZ2V0SWQodGFyZ2V0KTtcbiAgbGV0IHJlbW92ZWRDb3VudCA9IDA7XG5cbiAgLy8gSWYgdGFyZ2V0IGlzIHJlZmVyZW5jZWQgYXMgYSBwYXJlbnQsIHJlbW92ZSBpdHMgZW50aXJlIHN1YnRyZWUgKEJGUykuXG4gIGNvbnN0IHRvUmVtb3ZlID0gbmV3IFNldDxPYnNlcnZhYmlsaXR5RXZlbnQ+KCk7XG4gIGNvbnN0IHF1ZXVlOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFsgdGFyZ2V0IF07XG4gIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgY3VyID0gcXVldWUuc2hpZnQoKSE7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhjdXIpKSBjb250aW51ZTtcbiAgICB0b1JlbW92ZS5hZGQoY3VyKTtcbiAgICBjb25zdCBjdXJJZCA9IGdldElkKGN1cik7XG4gICAgaWYgKGN1cklkKSB7XG4gICAgICBjb25zdCBraWRzID0gY2hpbGRyZW5CeVBhcmVudC5nZXQoY3VySWQpO1xuICAgICAgaWYgKGtpZHMpIHF1ZXVlLnB1c2goLi4ua2lkcyk7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlsdGVyIGJ1ZmZlciBpbi1wbGFjZVxuICBmb3IgKGxldCBpID0gYnVmZmVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhidWZmZXJbIGkgXSkpIHtcbiAgICAgIGJ1ZmZlci5zcGxpY2UoaSwgMSk7XG4gICAgICByZW1vdmVkQ291bnQrKztcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHR5cGU6IHRhcmdldC50eXBlLFxuICAgIGNvcnJlbGF0aW9uSWQ6IHRhcmdldC5jb3JyZWxhdGlvbklkLFxuICAgIG9wZXJhdGlvbjogdGFyZ2V0Lm9wZXJhdGlvbixcbiAgICBsZXZlbDogdGFyZ2V0LmxldmVsLFxuICAgIHJlbW92ZWRDb3VudCxcbiAgfTtcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKHN5bmMgdmVyc2lvbilcbiAqIFJldHVybnM6ICdjYXB0dXJlZCcgaWYgZXZlbnQgd2FzIGNhcHR1cmVkLCAnYnVmZmVyZWQnIGlmIGJ1ZmZlcmVkLCAnc2tpcCcgaWYgbm90IHVzaW5nIHRhaWwtYmFzZWRcbiAqL1xuZnVuY3Rpb24gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdTeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6ICdjYXB0dXJlZCcgfCAnYnVmZmVyZWQnIHwgJ3NraXAnIHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgIGNvbnN0IHJlZHVjZWRCdWZmZXIgPSBlbmZvcmNlSGllcmFyY2h5SW50ZWdyaXR5T3JEcm9wKHJlZHVjZWQuZXZlbnRzLCBjb250ZXh0LmNvcnJlbGF0aW9uSWQpO1xuXG4gICAgICAvLyBBcHBseSBsZXZlbCBmaWx0ZXJpbmcgdG8gYXZvaWQgb3ZlcndoZWxtaW5nIGJhY2tlbmRzIHdpdGggdGhvdXNhbmRzIG9mIGRlYnVnL3RyYWNlIGV2ZW50c1xuICAgICAgLy8gT24gZXJyb3IsIGNhcHR1cmUgSU5GTysgZXZlbnRzLCBkcm9wIFRSQUNFL0RFQlVHIHRvIHByZXZlbnQgY29zdCBzcGlrZXNcbiAgICAgIGNvbnN0IG1pbkxldmVsT25FcnJvciA9IGNmZy5zYW1wbGluZz8ubWluTGV2ZWxPbkVycm9yID8/IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPO1xuICAgICAgbGV0IGRyb3BwZWQgPSAwO1xuXG4gICAgICBmb3IgKGNvbnN0IGJ1ZmZlcmVkRXZlbnQgb2YgcmVkdWNlZEJ1ZmZlcikge1xuICAgICAgICBjb25zdCBldmVudExldmVsID0gc3RyaW5nVG9MZXZlbChidWZmZXJlZEV2ZW50LmxldmVsKTtcbiAgICAgICAgaWYgKGV2ZW50TGV2ZWwgPj0gbWluTGV2ZWxPbkVycm9yKSB7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkcm9wcGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGRyb3BwZWQgPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgRHJvcHBlZCAke2Ryb3BwZWR9IGxvdy1sZXZlbCBldmVudHMgZnJvbSBlcnJvciBidWZmZXIgZmx1c2hgLCB7XG4gICAgICAgICAgbWluTGV2ZWw6IGxldmVsVG9TdHJpbmcobWluTGV2ZWxPbkVycm9yKSxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIG9ic1N0YXRlLmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIG9ic1N0YXRlLnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gUE9TVC1FUlJPUiBQQVRIOiBDYXB0dXJlIGltbWVkaWF0ZWx5XG4gIGlmIChjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZ1xuICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuXG4gIC8vIEJ1ZmZlciBzaXplIG1hbmFnZW1lbnQ6IGV2aWN0IGxvd2VzdCBwcmlvcml0eSBpZiBmdWxsXG4gIGNvbnN0IG1heFNpemUgPSBjZmcuc2FtcGxpbmc/Lm1heEJ1ZmZlclNpemUgPz8gMTAwMDtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gbWF4U2l6ZSkge1xuICAgIC8vIElNUE9SVEFOVDpcbiAgICAvLyBEdXJpbmcgYnVmZmVyaW5nIChub2lzZSByZWR1Y3Rpb24gLyBzbWFydCBzYW1wbGluZyksIHNwYW5zIG1heSBiZSBlbWl0dGVkIEFGVEVSIHRoZWlyIGNoaWxkcmVuLlxuICAgIC8vIEV2aWN0aW5nIHNwYW5zIG9wcG9ydHVuaXN0aWNhbGx5IGNhbiB0aGVyZWZvcmUgY3JlYXRlIGZ1dHVyZSBvcnBoYW4gY2hpbGRyZW4gKG1pc3NpbmdfcGFyZW50X3NwYW4pLlxuICAgIC8vIFByZWZlciBldmljdGluZyBub24tc3BhbiBldmVudHMgb25seTsgaWYgdGhlIGJ1ZmZlciBpcyBzcGFucy1vbmx5LCBhbGxvdyBib3VuZGVkIG92ZXJmbG93LlxuICAgIGNvbnN0IGV2aWN0ZWRJbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KTtcbiAgICBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTcGFucy1vbmx5IG92ZXJmbG93OiBhbGxvdyBidWZmZXIgZ3Jvd3RoIHVwIHRvIDJ4IGJlZm9yZSBldmljdGluZyBzcGFuIHN1YnRyZWVzLlxuICAgICAgY29uc3QgaGFyZENhcCA9IG1heFNpemUgKiAyO1xuICAgICAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gaGFyZENhcCkge1xuICAgICAgICBjb25zdCBldmljdGVkU3BhbkluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IHRydWUgfSk7XG4gICAgICAgIGlmIChldmljdGVkU3BhbkluZm8pIHtcbiAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExvZyB3YXJuaW5nIHdpdGggZXZpY3RlZCBldmVudCBkZXRhaWxzXG4gICAgaWYgKG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCA9PT0gMSB8fCBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgJSAxMDAgPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBmdWxsLCBldmljdGluZyBsb3dlc3QgcHJpb3JpdHkgZXZlbnRzJywge1xuICAgICAgICBldmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgIGJ1ZmZlclNpemU6IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgZXZpY3RlZEV2ZW50OiBldmljdGVkSW5mbyxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIC8vIExvZyBlYWNoIGV2aWN0aW9uIGF0IGRlYnVnIGxldmVsIGZvciB0cm91Ymxlc2hvb3RpbmdcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRXZpY3RlZCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZyb20gYnVmZmVyJywge1xuICAgICAgICAuLi5ldmljdGVkSW5mbyxcbiAgICAgICAgdG90YWxFdmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBidWZmZXIucHVzaChldmVudCk7XG4gIG9ic1N0YXRlLnN1bW1hcnkuYnVmZmVyZWQrKztcbiAgcmV0dXJuICdidWZmZXJlZCc7XG59XG5cbi8qKlxuICogSGFuZGxlIHRhaWwtYmFzZWQgc2FtcGxpbmcgbG9naWMgZm9yIGFuIGV2ZW50IChhc3luYyB2ZXJzaW9uKVxuICovXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ0FzeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6IFByb21pc2U8J2NhcHR1cmVkJyB8ICdidWZmZXJlZCcgfCAnc2tpcCc+IHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgIGNvbnN0IHJlZHVjZWRCdWZmZXIgPSBlbmZvcmNlSGllcmFyY2h5SW50ZWdyaXR5T3JEcm9wKHJlZHVjZWQuZXZlbnRzLCBjb250ZXh0LmNvcnJlbGF0aW9uSWQpO1xuXG4gICAgICAvLyBBcHBseSBsZXZlbCBmaWx0ZXJpbmcgdG8gYXZvaWQgb3ZlcndoZWxtaW5nIGJhY2tlbmRzXG4gICAgICBjb25zdCBtaW5MZXZlbE9uRXJyb3IgPSBjZmcuc2FtcGxpbmc/Lm1pbkxldmVsT25FcnJvciA/PyBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTztcbiAgICAgIGxldCBkcm9wcGVkID0gMDtcblxuICAgICAgY29uc3QgZmlsdGVyZWRFdmVudHMgPSByZWR1Y2VkQnVmZmVyLmZpbHRlcihidWZmZXJlZEV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoYnVmZmVyZWRFdmVudC5sZXZlbCk7XG4gICAgICAgIGlmIChldmVudExldmVsID49IG1pbkxldmVsT25FcnJvcikge1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGRyb3BwZWQrKztcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKGZpbHRlcmVkRXZlbnRzLm1hcChidWZmZXJlZEV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICByZXR1cm4gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgIH0pKTtcblxuICAgICAgaWYgKGRyb3BwZWQgPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgRHJvcHBlZCAke2Ryb3BwZWR9IGxvdy1sZXZlbCBldmVudHMgZnJvbSBlcnJvciBidWZmZXIgZmx1c2hgLCB7XG4gICAgICAgICAgbWluTGV2ZWw6IGxldmVsVG9TdHJpbmcobWluTGV2ZWxPbkVycm9yKSxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIG9ic1N0YXRlLmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICBvYnNTdGF0ZS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIFBPU1QtRVJST1IgUEFUSDogQ2FwdHVyZSBpbW1lZGlhdGVseVxuICBpZiAoY29udGV4dC5vYnNlcnZhYmlsaXR5LmVycm9yT2NjdXJyZWQpIHtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5LnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gTk9STUFMIFBBVEg6IEJ1ZmZlciBldmVyeXRoaW5nXG4gIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNmZy5zYW1wbGluZz8ubWF4QnVmZmVyU2l6ZSA/PyAxMDAwO1xuICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBtYXhTaXplKSB7XG4gICAgY29uc3QgZXZpY3RlZEluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IGZhbHNlIH0pO1xuICAgIGlmIChldmljdGVkSW5mbykge1xuICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGhhcmRDYXAgPSBtYXhTaXplICogMjtcbiAgICAgIGlmIChidWZmZXIubGVuZ3RoID49IGhhcmRDYXApIHtcbiAgICAgICAgY29uc3QgZXZpY3RlZFNwYW5JbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiB0cnVlIH0pO1xuICAgICAgICBpZiAoZXZpY3RlZFNwYW5JbmZvKSB7XG4gICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBMb2cgd2FybmluZyBpZiBldmljdGluZyBhIGxvdFxuICAgIGlmIChvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgPT09IDEgfHwgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkICUgMTAwID09PSAwKSB7XG4gICAgICBsb2dnZXIud2FybignT2JzZXJ2YWJpbGl0eSBidWZmZXIgZnVsbCwgZXZpY3RpbmcgbG93ZXN0IHByaW9yaXR5IGV2ZW50cycsIHtcbiAgICAgICAgZXZpY3RlZDogb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICBidWZmZXJTaXplOiBidWZmZXIubGVuZ3RoLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWRcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGJ1ZmZlci5wdXNoKGV2ZW50KTtcbiAgb2JzU3RhdGUuc3VtbWFyeS5idWZmZXJlZCsrO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIHNvdXJjZS1tYXAtc3VwcG9ydCBpZiBlbmFibGVkIGluIGNvbmZpZ1xuICogUHJvdmlkZXMgYmV0dGVyIHN0YWNrIHRyYWNlcyBmb3IgVHlwZVNjcmlwdC90cmFuc3BpbGVkIGNvZGUgaW4gcHJvZHVjdGlvblxuICovXG5mdW5jdGlvbiBpbml0aWFsaXplU291cmNlTWFwU3VwcG9ydChjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgaWYgKCFjZmcuc291cmNlTWFwLmVuYWJsZWQpIHtcbiAgICBsb2dnZXIuZGVidWcoJ1NvdXJjZSBtYXAgc3VwcG9ydCBkaXNhYmxlZCBpbiBjb25maWcnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnQXR0ZW1wdGluZyB0byBsb2FkIHNvdXJjZS1tYXAtc3VwcG9ydC4uLicpO1xuICAgIC8vIER5bmFtaWMgaW1wb3J0IHRvIGF2b2lkIGJ1bmRsaW5nIGlmIG5vdCBuZWVkZWRcbiAgICByZXF1aXJlKCdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInKTtcbiAgICBsb2dnZXIuaW5mbygnU291cmNlIG1hcCBzdXBwb3J0IGVuYWJsZWQgLSBzdGFjayB0cmFjZXMgd2lsbCBzaG93IG9yaWdpbmFsIFR5cGVTY3JpcHQgbGluZXMnKTtcbiAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICAvLyBOb3QgYSBjcml0aWNhbCBlcnJvciAtIG9ic2VydmFiaWxpdHkgc3RpbGwgd29ya3Mgd2l0aG91dCBzb3VyY2UgbWFwc1xuICAgIGlmIChlcnJvciAmJiB0eXBlb2YgZXJyb3IgPT09ICdvYmplY3QnICYmICdjb2RlJyBpbiBlcnJvciAmJiAoZXJyb3IgYXMgeyBjb2RlPzogdW5rbm93biB9KS5jb2RlID09PSAnTU9EVUxFX05PVF9GT1VORCcpIHtcbiAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAnc291cmNlLW1hcC1zdXBwb3J0IHBhY2thZ2Ugbm90IGZvdW5kLiBJbnN0YWxsIGl0IGZvciBiZXR0ZXIgZXJyb3Igc3RhY2sgdHJhY2VzOiBucG0gaW5zdGFsbCBzb3VyY2UtbWFwLXN1cHBvcnQnXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBtc2cgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICBsb2dnZXIud2FybignRmFpbGVkIHRvIGxvYWQgc291cmNlLW1hcC1zdXBwb3J0OicsIG1zZyk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBiYWNrZW5kcyBmcm9tIERJIGJhc2VkIG9uIGNvbmZpZ1xuICovXG5mdW5jdGlvbiBpbml0aWFsaXplQmFja2VuZHNGcm9tQ29uZmlnKGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHZvaWQge1xuICBiYWNrZW5kcyA9IFtdO1xuICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICBjb25zdCBlbmFibGVkQmFja2VuZHMgPSBjZmcuYmFja2VuZHMuZmlsdGVyKGIgPT4gYi5lbmFibGVkICE9PSBmYWxzZSk7XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kQ2ZnIG9mIGVuYWJsZWRCYWNrZW5kcykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBiYWNrZW5kID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlPE9ic2VydmFiaWxpdHlCYWNrZW5kPihcbiAgICAgICAgJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgICAgICAgeyB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCBiYWNrZW5kQ2ZnLnR5cGUgXSB9XG4gICAgICApO1xuICAgICAgYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgICAgIGJhY2tlbmRDb25maWdzLnNldChiYWNrZW5kLm5hbWUsIGJhY2tlbmRDZmcpO1xuICAgICAgbG9nZ2VyLmRlYnVnKGBJbml0aWFsaXplZCBiYWNrZW5kOiAke2JhY2tlbmQubmFtZX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgTm9Qcm92aWRlckZvdW5kRXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJyR7YmFja2VuZENmZy50eXBlfScgbm90IGZvdW5kIGluIERJLCBza2lwcGluZ2ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBiYWNrZW5kICcke2JhY2tlbmRDZmcudHlwZX0nOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoYmFja2VuZHMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gU29mdC1mYWlsOiBkbyBOT1QgdGhyb3cgYW5kIGJyZWFrIGFwcGxpY2F0aW9uIGZsb3cuXG4gICAgLy8gV2l0aG91dCBiYWNrZW5kcywgY2FwdHVyZSBiZWNvbWVzIGEgbm8tb3AgZm9yIHRoaXMgaW52b2NhdGlvbiAoZXZlbnRzIGFyZSBkcm9wcGVkKS5cbiAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHkgbWlzY29uZmlndXJlZDogbm8gZW5hYmxlZC9hdmFpbGFibGUgYmFja2VuZHMgd2VyZSByZXNvbHZlZCBmcm9tIERJLiBPYnNlcnZhYmlsaXR5IHdpbGwgYmUgZGlzYWJsZWQgZm9yIHRoaXMgaW52b2NhdGlvbi4nLCB7XG4gICAgICBlbmFibGVkQmFja2VuZFR5cGVzOiBlbmFibGVkQmFja2VuZHMubWFwKGIgPT4gYi50eXBlKSxcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkb0luaXRpYWxpemUoKTogdm9pZCB7XG4gIHRyeSB7XG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gT0JTRVJWQUJJTElUWSBJTklUSUFMSVpBVElPTiBTVEFSVCA9PT0nKTtcblxuICAgIC8vIFJ1biBwcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgKGUuZy4sIHNjaGVtYSByZWdpc3RyYXRpb24pXG4gICAgaWYgKHByZUluaXRIb29rcy5sZW5ndGggPiAwKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYFJ1bm5pbmcgJHtwcmVJbml0SG9va3MubGVuZ3RofSBwcmUtaW5pdGlhbGl6YXRpb24gaG9vayhzKS4uLmApO1xuICAgICAgZm9yIChjb25zdCBob29rIG9mIHByZUluaXRIb29rcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGhvb2soKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoJ1ByZS1pbml0aWFsaXphdGlvbiBob29rIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxvZ2dlci5kZWJ1ZygnUHJlLWluaXRpYWxpemF0aW9uIGhvb2tzIGNvbXBsZXRlZCcpO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgY29uZmlnIGlucHV0IGZyb20gREksIHRoZW4gbm9ybWFsaXplIGludG8gYSBmdWxseS1kZWZpbmVkIE9ic2VydmFiaWxpdHlDb25maWcuXG4gICAgLy8gVGhpcyBhdm9pZHMgdW5zYWZlIGNhc3RzIGFuZCBlbnN1cmVzIHRoZSBzaGFwZSBpcyBjb25zaXN0ZW50IGV2ZW4gd2hlbiBhcHBzIG92ZXJyaWRlIHBhcnRpYWxseS5cbiAgICBjb25zdCBpbnB1dCA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZUNvbmZpZzxPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQ+KCdvYnNlcnZhYmlsaXR5Jyk7XG4gICAgY29uZmlnID0gY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZyhpbnB1dCk7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcoY29uZmlnKTtcbiAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgY29uZmlnIGxvYWRlZCBmcm9tIERJJywge1xuICAgICAgZW5hYmxlZDogY29uZmlnLmVuYWJsZWQsXG4gICAgICBzZXJ2aWNlTmFtZTogY29uZmlnLnNlcnZpY2VOYW1lLFxuICAgICAgYmFja2VuZHM6IGNvbmZpZy5iYWNrZW5kcz8ubWFwKGIgPT4gYi50eXBlKSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCwgc21hcnQ6IGNvbmZpZy5zYW1wbGluZz8uc21hcnQgfSxcbiAgICAgIHNvdXJjZU1hcDogY29uZmlnLnNvdXJjZU1hcD8uZW5hYmxlZCxcbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgc291cmNlLW1hcC1zdXBwb3J0IGZvciBiZXR0ZXIgc3RhY2sgdHJhY2VzIChpZiBlbmFibGVkKVxuICAgIGluaXRpYWxpemVTb3VyY2VNYXBTdXBwb3J0KGNvbmZpZyk7XG5cbiAgICAvLyBJbml0aWFsaXplIGJhY2tlbmRzIGZyb20gRElcbiAgICBpbml0aWFsaXplQmFja2VuZHNGcm9tQ29uZmlnKGNvbmZpZyEpO1xuXG4gICAgLy8gUmVnaXN0ZXIgY2FwdHVyZXIgZm9yIG9ic2VydmVyc1xuICAgIGluaXRpYWxpemVDYXB0dXJlcih7XG4gICAgICBjYXB0dXJlOiAoaW5wdXQpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQpLFxuICAgICAgY2FwdHVyZUFzeW5jOiAoaW5wdXQpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmVBc3luYyhpbnB1dCksXG4gICAgfSk7XG5cbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG4gICAgbG9nZ2VyLmluZm8oJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIENPTVBMRVRFID09PScpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignISEhIE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gRkFJTEVEICEhIScsIGVycm9yKTtcbiAgICAvLyBTb2Z0LWZhaWw6IGRvIE5PVCB0aHJvdyBpbnRvIGFwcGxpY2F0aW9uIGZsb3cuXG4gICAgLy8gTWFyayBpbml0aWFsaXplZCB0byBwcmV2ZW50IHJlcGVhdGVkIGluaXQgYXR0ZW1wdHM7IGxlYXZlIGNhcHR1cmVyIHVuaW5pdGlhbGl6ZWQgc28gb2JzZXJ2ZXJzIGRyb3AgZXZlbnRzLlxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBVQkxJQyBBUEkgLSBPYnNlcnZhYmlsaXR5TWFuYWdlclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TWFuYWdlciB7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHsgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciBhIG5ldyBMYW1iZGEgaW52b2NhdGlvblxuICAgKi9cbiAgc3RhdGljIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKSBjYWxsZWQnLCB7IGluaXRpYWxpemVkLCBpbnZvY2F0aW9uQ291bnQgfSk7XG5cbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ05vdCBpbml0aWFsaXplZCB5ZXQsIGNhbGxpbmcgZG9Jbml0aWFsaXplKCkuLi4nKTtcbiAgICAgIGRvSW5pdGlhbGl6ZSgpO1xuICAgIH1cblxuICAgIGludm9jYXRpb25Db3VudCsrO1xuICAgIGxvZ2dlci5kZWJ1ZyhgSW52b2NhdGlvbiAke2ludm9jYXRpb25Db3VudH0gc3RhcnRpbmcsIGluaXRpYWxpemluZyAke2JhY2tlbmRzLmxlbmd0aH0gYmFja2VuZChzKWApO1xuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIGJhY2tlbmRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBiYWNrZW5kLmluaXRpYWxpemVJbnZvY2F0aW9uPy4oKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmFpbGVkIHRvIGluaXRpYWxpemUgaW52b2NhdGlvbjpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIGlzSW5pdGlhbGl6ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGluaXRpYWxpemVkO1xuICB9XG5cbiAgc3RhdGljIGlzQ29sZFN0YXJ0KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbnZvY2F0aW9uQ291bnQgPT09IDE7XG4gIH1cblxuICBzdGF0aWMgZ2V0SW52b2NhdGlvbkNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudDtcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb25maWcoKTogT2JzZXJ2YWJpbGl0eUNvbmZpZyB8IG51bGwge1xuICAgIHJldHVybiBjb25maWc7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG9ic2VydmFiaWxpdHkgc3VtbWFyeSBmb3IgdGhlIGN1cnJlbnQgaW52b2NhdGlvbi5cbiAgICogUmV0dXJucyBidWZmZXIgc3RhdHM6IGV2aWN0ZWQsIGJ1ZmZlcmVkLCBjYXB0dXJlZCwgc2FtcGxlZE91dCBjb3VudHMuXG4gICAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGV4ZWN1dGlvbiBjb250ZXh0IGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBnZXRTdW1tYXJ5KCk6IE9ic2VydmFiaWxpdHlTdW1tYXJ5IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICByZXR1cm4gY29udGV4dD8ub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5O1xuICB9XG5cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuICAgIGNvbmZpZyA9IHsgLi4uY29uZmlnLCAuLi51cGRhdGVzIH07XG4gIH1cblxuICBzdGF0aWMgcmVnaXN0ZXJCYWNrZW5kKGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kKTogdm9pZCB7XG4gICAgaWYgKGJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICB9XG5cbiAgc3RhdGljIHVucmVnaXN0ZXJCYWNrZW5kKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGJhY2tlbmRzID0gYmFja2VuZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IG5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHJlLWluaXRpYWxpemF0aW9uIGhvb2suXG4gICAqIEhvb2tzIHJ1biBCRUZPUkUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLCBhbGxvd2luZyBzY2hlbWEvc2VydmljZSByZWdpc3RyYXRpb25cbiAgICogbmVlZGVkIGJ5IGJhY2tlbmRzIHdpdGhvdXQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKiBcbiAgICogQHBhcmFtIGhvb2sgLSBDYWxsYmFjayB0byBleGVjdXRlIGR1cmluZyBpbml0aWFsaXphdGlvblxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUHJlSW5pdEhvb2soaG9vazogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHByZUluaXRIb29rcy5wdXNoKGhvb2spO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCAoZmlyZS1hbmQtZm9yZ2V0KVxuICAgKiBcbiAgICogQ2FwdHVyZSBjb250cm9sIGlzIGVtYmVkZGVkIGluIGlucHV0LmNhcHR1cmUgLSBubyBzZXBhcmF0ZSBvcHRpb25zIHBhcmFtLlxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBvYnNlcnZhYmlsaXR5TG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmUoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ+KdjCBPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSwgbGV2ZWw6IGlucHV0LmxldmVsIH0pO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gSGFyZCBkZXByZWNhdGlvbjogRlcyNCBkb2VzIG5vdCBzdXBwb3J0IGxlZ2FjeSBzcGFuLiogcmVjb3JkIGZvcm1hdHMuXG4gICAgICAvLyBJZiBhbnl0aGluZyBlbWl0cyB0aGVzZSwgaXQncyBhIGJ1Zy4gTG9nIGxvdWRseSBhbmQgZHJvcC5cbiAgICAgIGlmIChpbnB1dC50eXBlID09PSAnc3Bhbi5lbmQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmV2ZW50Jykge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHkgaW52YXJpYW50IHZpb2xhdGlvbjogbGVnYWN5IHNwYW4uKiBldmVudCB0eXBlIHdhcyBlbWl0dGVkICh1bnN1cHBvcnRlZCkuIERyb3BwaW5nIGV2ZW50LicsIHtcbiAgICAgICAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgICAgICAgIG9wZXJhdGlvbjogaW5wdXQub3BlcmF0aW9uLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGlucHV0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgZGlzYWJsZWQsIHNraXBwaW5nIGNhcHR1cmUnLCB7IHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGlucHV0LCBjb250ZXh0KTtcblxuICAgICAgLy8gVHJ5IHRhaWwtYmFzZWQgc2FtcGxpbmcgZmlyc3RcbiAgICAgIGNvbnN0IHRhaWxSZXN1bHQgPSBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ1N5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgU0FNUExJTkcgKGFsbCBieXBhc3MvbGV2ZWwvc2FtcGxpbmcgbG9naWMgaW4gc2hvdWxkQ2FwdHVyZSlcbiAgICAgIGlmICghc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnLCB7XG4gICAgICAgIC8vIE5vIGJ1ZmZlcmVkIGdyYXBoIGhlcmU7IG5ldmVyIGRyb3Agc3BhbnMgYnkgbWluRHVyYXRpb24gaW4gaGVhZC1iYXNlZCBtb2RlXG4gICAgICAgIC8vIGJlY2F1c2Ugd2UgY2FuJ3QgcHJvdmUgdGhleSBhcmVuJ3QgcGFyZW50cyBvZiBhbHJlYWR5LWVtaXR0ZWQgY2hpbGQgZXZlbnRzLlxuICAgICAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A6IGZhbHNlLFxuICAgICAgfSkpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBpbiBjYXB0dXJlOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCBhc3luY2hyb25vdXNseSAod2FpdHMgZm9yIGJhY2tlbmQgY2FwdHVyZSlcbiAgICogXG4gICAqIEBwYXJhbSBpbnB1dCAtIEV2ZW50IGlucHV0IHdpdGggY2FwdHVyZSBjb250cm9sIGluIGlucHV0LmNhcHR1cmVcbiAgICogQHJldHVybnMgUHJvbWlzZTxvYnNlcnZhYmlsaXR5TG9nSWQ+IGlmIGNhcHR1cmVkLCB1bmRlZmluZWQgaWYgZmlsdGVyZWQvc2FtcGxlZCBvdXRcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlQXN5bmMoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gSGFyZCBkZXByZWNhdGlvbjogRlcyNCBkb2VzIG5vdCBzdXBwb3J0IGxlZ2FjeSBzcGFuLiogcmVjb3JkIGZvcm1hdHMuXG4gICAgICAvLyBJZiBhbnl0aGluZyBlbWl0cyB0aGVzZSwgaXQncyBhIGJ1Zy4gTG9nIGxvdWRseSBhbmQgZHJvcC5cbiAgICAgIGlmIChpbnB1dC50eXBlID09PSAnc3Bhbi5lbmQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmV2ZW50Jykge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHkgaW52YXJpYW50IHZpb2xhdGlvbjogbGVnYWN5IHNwYW4uKiBldmVudCB0eXBlIHdhcyBlbWl0dGVkICh1bnN1cHBvcnRlZCkuIERyb3BwaW5nIGV2ZW50LicsIHtcbiAgICAgICAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgICAgICAgIG9wZXJhdGlvbjogaW5wdXQub3BlcmF0aW9uLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGlucHV0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICBjb25zdCBldmVudCA9IGJ1aWxkRXZlbnQoaW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGF3YWl0IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgU0FNUExJTkcgKGFsbCBieXBhc3MvbGV2ZWwvc2FtcGxpbmcgbG9naWMgaW4gc2hvdWxkQ2FwdHVyZSlcbiAgICAgIGlmICghc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnLCB7XG4gICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogZmFsc2UsXG4gICAgICB9KSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBpbiBjYXB0dXJlQXN5bmM6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT2JzZXJ2ZSBhbiBldmVudCAoY29udmVuaWVuY2UgbWV0aG9kKVxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gUGFydGlhbCBldmVudCB3aXRoIHJlcXVpcmVkIHR5cGUgYW5kIGxldmVsXG4gICAqIEByZXR1cm5zIG9ic2VydmFiaWxpdHlMb2dJZCBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIGlmIGZpbHRlcmVkL3NhbXBsZWQgb3V0XG4gICAqL1xuICBzdGF0aWMgb2JzZXJ2ZShcbiAgICBldmVudDogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+ICYgeyB0eXBlOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmcgfVxuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBldmVudC5jb3JyZWxhdGlvbklkID8/IGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cygpO1xuXG4gICAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgICBsb2dnZXIud2Fybignb2JzZXJ2ZSgpIGNhbGxlZCB3aXRob3V0IGNvcnJlbGF0aW9uSWQnKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgLi4uZXZlbnQsXG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgdHlwZTogZXZlbnQudHlwZSBhcyBDYXB0dXJlSW5wdXRbICd0eXBlJyBdLFxuICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsIGFzIENhcHR1cmVJbnB1dFsgJ2xldmVsJyBdLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEZsdXNoIGFsbCBiYWNrZW5kcyBhbmQgYnVmZmVyZWQgZXZlbnRzIChjYWxsZWQgYXQgZW5kIG9mIExhbWJkYSBpbnZvY2F0aW9uKVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxvZ2dlci5kZWJ1ZygnPT09IEZMVVNIIFNUQVJUID09PScsIHtcbiAgICAgIHBlbmRpbmdEaXNwYXRjaGVzOiBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGgsXG4gICAgICBiYWNrZW5kczogYmFja2VuZHMubGVuZ3RoLFxuICAgICAgc21hcnRTYW1wbGluZzogY29uZmlnPy5zYW1wbGluZz8uc21hcnQsXG4gICAgfSk7XG5cbiAgICAvLyBXYWl0IGZvciBhbGwgcGVuZGluZyBmaXJlLWFuZC1mb3JnZXQgZGlzcGF0Y2hlcyAoZnJvbSBlcnJvciBwYXRoIGluIGNhcHR1cmUoKSlcbiAgICBpZiAocGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBXYWl0aW5nIGZvciAke3BlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aH0gcGVuZGluZyBkaXNwYXRjaGVzYCk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChwZW5kaW5nRGlzcGF0Y2hlcyk7XG4gICAgICBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPSAwOyAvLyBDbGVhciBmb3IgbmV4dCBpbnZvY2F0aW9uXG4gICAgICBsb2dnZXIuZGVidWcoJ1BlbmRpbmcgZGlzcGF0Y2hlcyBjb21wbGV0ZWQnKTtcbiAgICB9XG5cbiAgICAvLyBGb3JjZS1lbmQgYW55IHNwYW5zIGxlZnQgb3BlbiBpbiB0aGlzIGludm9jYXRpb24gYmVmb3JlIGZsdXNoaW5nIGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICAvLyBUaGlzIGd1YXJhbnRlZXMgdGhlIGhpZXJhcmNoeSBoYXMgYWxsIHBhcmVudHMsIGV2ZW4gaWYgdXNlci9mcmFtZXdvcmsgY29kZSBmb3Jnb3QgdG8gZW5kIGEgc3Bhbi5cbiAgICBydW5TcGFuRmluYWxpemVyKCk7XG5cbiAgICAvLyBBdHRhY2ggb2JzZXJ2YWJpbGl0eSBzdW1tYXJ5IHRvIGN1cnJlbnQgc3BhbiAoaWYgYW55KSBiZWZvcmUgZmx1c2hpbmdcbiAgICBjb25zdCBzdW1tYXJ5ID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZ2V0U3VtbWFyeSgpO1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgIGNvbnN0IGN1cnJlbnRTcGFuID0gY29udGV4dD8ub2JzZXJ2YWJpbGl0eS5jdXJyZW50U3BhbjtcbiAgICBpZiAoc3VtbWFyeSAmJiBjdXJyZW50U3BhbiAmJiAoc3VtbWFyeS5jYXB0dXJlZCA+IDAgfHwgc3VtbWFyeS5idWZmZXJlZCA+IDAgfHwgc3VtbWFyeS5ldmljdGVkID4gMCB8fCBzdW1tYXJ5LnNhbXBsZWRPdXQgPiAwKSkge1xuICAgICAgY3VycmVudFNwYW4/Lm1ldHJpY3M/Lih7XG4gICAgICAgICdfZncyNC5vYnMuY2FwdHVyZWQnOiBzdW1tYXJ5LmNhcHR1cmVkLFxuICAgICAgICAnX2Z3MjQub2JzLmJ1ZmZlcmVkJzogc3VtbWFyeS5idWZmZXJlZCxcbiAgICAgICAgJ19mdzI0Lm9icy5ldmljdGVkJzogc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICAnX2Z3MjQub2JzLnNhbXBsZWRPdXQnOiBzdW1tYXJ5LnNhbXBsZWRPdXQsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBJZiBidWZmZXJpbmcgaXMgZW5hYmxlZCAoc21hcnQgc2FtcGxpbmcgT1Igbm9pc2UgcmVkdWN0aW9uKSwgZmx1c2ggYnVmZmVyZWQgZXZlbnRzLlxuICAgIGlmIChjb25maWc/LnNhbXBsaW5nPy5zbWFydCB8fCBjb25maWc/Lm5vaXNlUmVkdWN0aW9uPy5lbmFibGVkKSB7XG4gICAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICAgICAgaWYgKGNvbnRleHQgJiYgY29udGV4dC5vYnNlcnZhYmlsaXR5LmJ1ZmZlci5sZW5ndGggPiAwICYmICFjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgICAgICAvLyBObyBlcnJvciBvY2N1cnJlZDogYXBwbHkgbm9pc2UgcmVkdWN0aW9uICsgb3B0aW9uYWwgc2FtcGxpbmcgdG8gYnVmZmVyIGJlZm9yZSBmbHVzaGluZ1xuICAgICAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgICBvYnNTdGF0ZS5idWZmZXIgPSBbXTsgLy8gQ2xlYXIgYnVmZmVyXG5cbiAgICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuICAgICAgICBjb25zdCByZWR1Y2VkRXZlbnRzID0gcmVkdWNlZC5ldmVudHM7XG5cbiAgICAgICAgLy8gQ29tcHV0ZSByZWZlcmVuY2VkIHBhcmVudCBJRHMgZnJvbSB0aGUgYnVmZmVyZWQgc2V0IChncmFwaC1iYXNlZCwgbm8gbWFudWFsIHRyYWNraW5nKS5cbiAgICAgICAgY29uc3QgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgZm9yIChjb25zdCBlIG9mIHJlZHVjZWRFdmVudHMpIHtcbiAgICAgICAgICBjb25zdCBwaWQgPSBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyB1bmRlZmluZWQ7XG4gICAgICAgICAgaWYgKHBpZCkgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMuYWRkKHBpZCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEcm9wIGVtcHR5ICpsZWFmKiBzcGFucyBpZiBjb25maWd1cmVkLlxuICAgICAgICAvLyBBIHNwYW4gaXMgYSBsZWFmIGlmZiBub2JvZHkgcmVmZXJlbmNlcyBpdCBhcyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaW4gdGhpcyBidWZmZXJlZCBzZXQuXG4gICAgICAgIGNvbnN0IG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zID0gY29uZmlnLnNwYW5zLnNraXBFbXB0eVxuICAgICAgICAgID8gcmVkdWNlZEV2ZW50cy5maWx0ZXIoKGUpID0+IHtcbiAgICAgICAgICAgIGlmIChlLnR5cGUgIT09ICdzcGFuJykgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjb25zdCBpZCA9IGUub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgICAgICAgaWYgKCFpZCkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBpZiAocmVmZXJlbmNlZFBhcmVudFNwYW5JZHMuaGFzKGlkKSkgcmV0dXJuIHRydWU7IC8vIHBhcmVudCA9PiBrZWVwXG4gICAgICAgICAgICBjb25zdCBkID0gZS5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29uc3QgZncgPSBkPy5fZncyNCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiBmdz8uc3BhbkVtcHR5ICE9PSB0cnVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgOiByZWR1Y2VkRXZlbnRzO1xuXG4gICAgICAgIGNvbnN0IGZpbmFsRXZlbnRzID0gZW5mb3JjZUhpZXJhcmNoeUludGVncml0eU9yRHJvcChtYXliZURyb3BFbXB0eUxlYWZTcGFucywgY29udGV4dC5jb3JyZWxhdGlvbklkKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGZpbmFsRXZlbnRzKSB7XG4gICAgICAgICAgLy8gQnlwYXNzIGV2ZW50cyBza2lwIHNhbXBsaW5nIChlLmcuLCBhdWRpdCBldmVudHMgbWFya2VkIGFzIGNyaXRpY2FsKVxuICAgICAgICAgIGNvbnN0IHNob3VsZEJ5cGFzcyA9IGV2ZW50LmNhcHR1cmU/LmJ5cGFzcyA9PT0gdHJ1ZTtcblxuICAgICAgICAgIC8vIEFwcGx5IHNhbXBsaW5nIHJ1bGVzIHRvIGJ1ZmZlcmVkIGV2ZW50ICh1bmxlc3MgYnlwYXNzIGlzIHNldClcbiAgICAgICAgICBjb25zdCBpc1NhbXBsZWQgPSBzaG91bGRCeXBhc3NcbiAgICAgICAgICAgIHx8ICFjb25maWc/LnNhbXBsaW5nPy5lbmFibGVkXG4gICAgICAgICAgICB8fCBzaG91bGRDYXB0dXJlKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgICAgICAgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wOiB0cnVlLFxuICAgICAgICAgICAgICByZWZlcmVuY2VkUGFyZW50U3BhbklkcyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChpc1NhbXBsZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICAgICAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRzKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5zYW1wbGVkT3V0Kys7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBJZiBlcnJvck9jY3VycmVkPXRydWUsIGJ1ZmZlciB3YXMgYWxyZWFkeSBmbHVzaGVkIGR1cmluZyBjYXB0dXJlXG4gICAgfVxuXG4gICAgLy8gRmx1c2ggYWxsIGJhY2tlbmRzIHdpdGggcmV0cnkgbG9naWNcbiAgICAvLyBXcmFwIGVhY2ggYmFja2VuZCBmbHVzaCBpbiB0cnktY2F0Y2ggdG8gZW5zdXJlIGFsbCBiYWNrZW5kcyBhdHRlbXB0IHRvIGZsdXNoXG4gICAgLy8gZXZlbiBpZiBvbmUgZmFpbHMgY2F0YXN0cm9waGljYWxseVxuICAgIGNvbnN0IE1BWF9GTFVTSF9SRVRSSUVTID0gMjtcbiAgICBjb25zdCBmbHVzaFByb21pc2VzID0gYmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIWJhY2tlbmQuZmx1c2gpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBhdHRlbXB0ID0gMTsgYXR0ZW1wdCA8PSBNQVhfRkxVU0hfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcbiAgICAgICAgICAgIGJyZWFrOyAvLyBTdWNjZXNzXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChhdHRlbXB0ID09PSBNQVhfRkxVU0hfUkVUUklFUykge1xuICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGZhaWxlZCBhZnRlciAke2F0dGVtcHR9IGF0dGVtcHRzOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgLy8gRXZlbnRzIG1heSBiZSBsb3N0LCBidXQgd2UndmUgZG9uZSBvdXIgYmVzdFxuICAgICAgICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGFsbG93IG90aGVyIGJhY2tlbmRzIHRvIGZsdXNoXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIChhdHRlbXB0ICR7YXR0ZW1wdH0vJHtNQVhfRkxVU0hfUkVUUklFU30pLCByZXRyeWluZy4uLmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgLy8gU2ltcGxlIGV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCAqIGF0dGVtcHQpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENhdGNoIGFueSB1bmV4cGVjdGVkIGVycm9ycyBvdXRzaWRlIHRoZSByZXRyeSBsb29wXG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggY29tcGxldGVseSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGFsbG93IG90aGVyIGJhY2tlbmRzIHRvIGZsdXNoXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChmbHVzaFByb21pc2VzKTtcblxuICAgIGxvZ2dlci5kZWJ1ZygnPT09IEZMVVNIIENPTVBMRVRFID09PScpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IG1hbmFnZXIgc3RhdGUgKGZvciB0ZXN0aW5nKVxuICAgKi9cbiAgc3RhdGljIHJlc2V0KCk6IHZvaWQge1xuICAgIGNvbmZpZyA9IG51bGw7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcobnVsbCk7XG4gICAgYmFja2VuZHMgPSBbXTtcbiAgICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICAgIGludm9jYXRpb25Db3VudCA9IDA7XG4gICAgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuY2xlYXIoKTtcbiAgICBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPSAwO1xuICAgIHJlc2V0Q2FwdHVyZXIoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciB0ZXN0aW5nIHdpdGggbW9jayBjb25maWcgYW5kIGJhY2tlbmRzXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZUZvclRlc3RpbmcoXG4gICAgdGVzdENvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgICB0ZXN0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXVxuICApOiB2b2lkIHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICAgIGNvbmZpZyA9IHRlc3RDb25maWc7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcodGVzdENvbmZpZyk7XG4gICAgYmFja2VuZHMgPSB0ZXN0QmFja2VuZHM7XG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIExhbWJkYSBoYW5kbGVyIHdyYXBwZXIgd2l0aCBvYnNlcnZhYmlsaXR5IGxpZmVjeWNsZSBtYW5hZ2VtZW50XG4gKi9cbmV4cG9ydCBjb25zdCB3aXRoT2JzZXJ2YWJpbGl0eSA9IDxUIGV4dGVuZHMgKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gUHJvbWlzZTx1bmtub3duPj4oaGFuZGxlcjogVCk6IFQgPT4ge1xuICByZXR1cm4gKGFzeW5jICguLi5hcmdzOiBQYXJhbWV0ZXJzPFQ+KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlciguLi5hcmdzKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9XG4gIH0pIGFzIFQ7XG59O1xuXG5leHBvcnQgY29uc3QgT2JzZXJ2ZXIgPSBPYnNlcnZhYmlsaXR5TWFuYWdlcjtcbiJdfQ==