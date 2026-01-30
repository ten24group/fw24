"use strict";
/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * All config and backends resolved from DI - no manual instantiation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.__test__ = exports.Observer = exports.withObservability = exports.ObservabilityManager = void 0;
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
/**
 * Apply tag filtering to event before sending to backends.
 * Filters framework tags based on config, adds custom tags, enforces maxTags limit.
 */
function applyTagFiltering(event) {
    if (!config?.tagFiltering)
        return event;
    const tagConfig = config.tagFiltering;
    const include = tagConfig.include;
    const maxTags = tagConfig.maxTags ?? 10;
    // Known framework tags
    const frameworkTags = new Set([
        'stage', 'tenantId', 'operationCategory', 'authMethod',
        'actorType', 'handlerType', 'entityName', 'operation'
    ]);
    const filteredTags = {};
    let tagCount = 0;
    // Filter existing tags
    if (event.tags) {
        for (const [key, value] of Object.entries(event.tags)) {
            if (tagCount >= maxTags)
                break;
            // Framework tags: must be in include array
            if (frameworkTags.has(key)) {
                if (include && !include.includes(key)) {
                    continue; // Excluded
                }
            }
            // Unknown tags (custom): always include
            // Convert to string
            filteredTags[key] = typeof value === 'string' ? value : String(value);
            tagCount++;
        }
    }
    // Add custom tags from config
    if (tagConfig.custom && tagCount < maxTags) {
        for (const [key, valueFn] of Object.entries(tagConfig.custom)) {
            if (tagCount >= maxTags)
                break;
            if (filteredTags[key] !== undefined)
                continue; // Already exists
            try {
                const value = valueFn(event);
                if (value) {
                    filteredTags[key] = value;
                    tagCount++;
                }
            }
            catch (error) {
                logger.warn(`Failed to evaluate custom tag ${key}:`, error);
            }
        }
    }
    return {
        ...event,
        tags: filteredTags,
    };
}
function dispatchToBackends(event, targetBackends) {
    // Apply tag filtering before sending to backends
    const filteredEvent = applyTagFiltering(event);
    const promise = Promise.all(targetBackends.map(async (backend) => {
        try {
            if (!shouldBackendCaptureType(backend, filteredEvent)) {
                return;
            }
            await backend.capture(filteredEvent);
        }
        catch (error) {
            logger.error(`Failed to capture in backend ${backend.name}:`, error);
        }
    })).then(() => { }); // Convert to Promise<void>
    // Track promise so flush() can wait for it
    pendingDispatches.push(promise);
}
async function dispatchToBackendsSync(event, targetBackends) {
    // Apply tag filtering before sending to backends
    const filteredEvent = applyTagFiltering(event);
    await Promise.all(targetBackends.map(async (backend) => {
        try {
            if (!shouldBackendCaptureType(backend, filteredEvent)) {
                return;
            }
            await backend.capture(filteredEvent);
        }
        catch (error) {
            logger.error(`Failed to capture in backend ${backend.name}:`, error);
        }
    }));
}
function enforceHierarchyIntegrityOrDrop(events, ctxCorrelationId) {
    // CONTRACT: parentObservabilityLogId should ONLY reference spans in THIS slice (same correlationId).
    // Cross-invocation linkage should use causedBy, not parentObservabilityLogId.
    //
    // However, for backward compatibility and graceful degradation:
    // - If a parent is referenced but NOT in this batch (cross-slice reference), we KEEP the event
    //   but the parent link will be stale/unresolvable in the UI. This is suboptimal but not fatal.
    // - If a parent is referenced and should be in this batch but is missing (noise reduction bug),
    //   we DROP the event and emit an error.
    //
    // Only drop case #2 (truly missing), tolerate case #1 (cross-slice).
    const graph = (0, trace_graph_1.buildTraceGraph)(events, { strictParents: false });
    if (graph.missingParentSpanIds.size === 0)
        return events;
    const missing = graph.missingParentSpanIds;
    const crossSlice = graph.crossSliceParentSpanIds;
    const filtered = events.filter((e) => {
        const pid = e.parentObservabilityLogId ?? undefined;
        // ONLY drop if parent is truly missing (not just in a different slice)
        return !(pid && missing.has(pid));
    });
    const droppedCount = events.length - filtered.length;
    if (droppedCount > 0) {
        // Only emit error if we actually dropped events
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
                // Include cross-slice info for debugging (these are valid, not errors)
                crossSliceParentCount: crossSlice.size,
            },
            source: 'ObservabilityManager.flush',
        });
    }
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
/**
 * Content-based filtering - ALWAYS runs regardless of sampling.enabled
 * Returns true if event passes filtering rules (bypass, level, duration, etc.)
 * Returns false if event should be filtered out.
 */
function shouldFilter(event, cfg, options) {
    const levelValue = (0, level_utils_1.stringToLevel)(event.level);
    const typeCategory = getTypeCategory(event.type);
    const effectiveLevel = getEffectiveLevelForType(typeCategory);
    const capture = event.capture;
    const isSpanRecord = event.type === 'span';
    const allowSpanMinDurationDrop = options?.allowSpanMinDurationDrop === true;
    const referencedParentSpanIds = options?.referencedParentSpanIds;
    // === BYPASS FILTERS (always pass) ===
    // 1. Explicit bypass flag
    if (capture?.bypass) {
        return true;
    }
    // 2. CRITICAL log level always passes
    if (levelValue === types_1.ObservabilityLevel.CRITICAL) {
        return true;
    }
    // 3. Errors always pass
    if (event.error || event.success === false) {
        return true;
    }
    // === SPAN-SPECIFIC FILTERING ===
    if (isSpanRecord) {
        // Referenced parents must be kept for hierarchy integrity
        const id = event.observabilityLogId;
        if (id && referencedParentSpanIds?.has(id)) {
            return true;
        }
        // Filter out fast spans if configured
        if (allowSpanMinDurationDrop && event.durationMs !== undefined) {
            const minDuration = capture?.minDurationMs ?? cfg.spans.minDurationMs;
            if (minDuration > 0 && event.durationMs < minDuration) {
                return false; // Too fast, filter out
            }
        }
    }
    // === NON-SPAN DURATION FILTERING ===
    if (!isSpanRecord && capture?.minDurationMs !== undefined && event.durationMs !== undefined) {
        if (event.durationMs < capture.minDurationMs) {
            return false; // Below threshold, filter out
        }
    }
    // === LEVEL FILTERING ===
    // REMOVED: Manager no longer filters by minLevel
    // All level-based filtering happens in noise reduction for context-aware decisions
    // Passed all filters
    return true;
}
/**
 * Probabilistic sampling - ONLY runs when sampling.enabled=true
 * Returns true if event should be sampled (kept), false if sampled out (dropped)
 */
function shouldSample(event, cfg) {
    const levelValue = (0, level_utils_1.stringToLevel)(event.level);
    const typeCategory = getTypeCategory(event.type);
    const capture = event.capture;
    // === GROUP-BASED SAMPLING (batch scenarios) ===
    if (capture?.group) {
        const { index, captureFirst = 3, sampleRate = 0.1 } = capture.group;
        // Capture first N items
        if (index < captureFirst) {
            return true;
        }
        // Sample the rest probabilistically
        return Math.random() < sampleRate;
    }
    // === RULE-BASED SAMPLING (Highest Priority) ===
    if (cfg.sampling?.rules && cfg.sampling.rules.length > 0) {
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
    if (event.operation && cfg.sampling?.operations) {
        for (const [pattern, rate] of Object.entries(cfg.sampling.operations)) {
            const regex = getOrCreateSamplingRegex(pattern);
            if (regex.test(event.operation)) {
                return Math.random() < rate;
            }
        }
    }
    // === LEVEL-BASED SAMPLING (Fallback) ===
    const levelName = (0, level_utils_1.levelToString)(levelValue);
    const rate = cfg.sampling?.rates?.[levelName];
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
            // Pass 2 (non-span only): evict lowest-priority non-span that doesn't have span children.
            // We must check for span children because subtree removal would evict those spans,
            // violating the allowEvictSpans=false contract.
            if (nonSpans.length > 0) {
                // Filter to only non-spans that are safe to evict (no span children)
                const safeNonSpans = nonSpans.filter(e => {
                    const id = getId(e);
                    if (!id)
                        return true; // No ID = no children
                    const kids = childrenByParent.get(id);
                    if (!kids)
                        return true; // No children = safe
                    // Reject if any child is a span
                    return !kids.some(child => isSpan(child));
                });
                if (safeNonSpans.length > 0) {
                    const idx = pickLowest(safeNonSpans);
                    target = safeNonSpans[idx];
                }
                else {
                    // All non-spans have span children - cannot evict without violating allowEvictSpans
                    return null;
                }
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
            // Dispatch all events - noise reduction already filtered by minLevel
            for (const bufferedEvent of reducedBuffer) {
                const targets = getBackendsForType(bufferedEvent.type);
                dispatchToBackends(bufferedEvent, targets);
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
    // NORMAL PATH: Buffer everything (filtering happens AFTER noise reduction)
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
            // Dispatch all events - noise reduction already filtered by minLevel
            await Promise.all(reducedBuffer.map(bufferedEvent => {
                const targets = getBackendsForType(bufferedEvent.type);
                return dispatchToBackendsSync(bufferedEvent, targets);
            }));
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
            // HEAD-BASED FILTERING + SAMPLING
            // Apply filtering first (always runs)
            if (!shouldFilter(event, config, {
                // No buffered graph here; never drop spans by minDuration in head-based mode
                // because we can't prove they aren't parents of already-emitted child events.
                allowSpanMinDurationDrop: false,
            })) {
                return undefined; // Filtered out
            }
            // Apply sampling if enabled (probabilistic)
            if (config.sampling?.enabled && !shouldSample(event, config)) {
                return undefined; // Sampled out
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
            // HEAD-BASED FILTERING + SAMPLING
            if (!shouldFilter(event, config, {
                allowSpanMinDurationDrop: false,
            })) {
                return undefined; // Filtered out
            }
            if (config.sampling?.enabled && !shouldSample(event, config)) {
                return undefined; // Sampled out
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
            // Add basic count metrics
            currentSpan?.metrics?.({
                '_fw24.obs.captured': summary.captured,
                '_fw24.obs.buffered': summary.buffered,
                '_fw24.obs.evicted': summary.evicted,
                '_fw24.obs.sampledOut': summary.sampledOut,
            });
            // Add detailed breakdown checkpoint
            const detailedStats = {
                totals: {
                    captured: summary.captured,
                    buffered: summary.buffered,
                    evicted: summary.evicted,
                    sampledOut: summary.sampledOut,
                },
            };
            // Add captured events breakdown (what was actually emitted)
            const obsState = context?.observability;
            if (obsState?.capturedBreakdown) {
                detailedStats.capturedBreakdown = {
                    byType: obsState.capturedBreakdown.byType,
                    byOperation: Object.keys(obsState.capturedBreakdown.byOperation || {}).length > 0
                        ? obsState.capturedBreakdown.byOperation
                        : undefined,
                    byLevel: obsState.capturedBreakdown.byLevel,
                };
            }
            // Compute breakdown by type and operation from buffer (what's still buffered)
            if (context && context.observability.buffer.length > 0) {
                const byType = {};
                const byOperation = {};
                const byLevel = {};
                for (const event of context.observability.buffer) {
                    byType[event.type] = (byType[event.type] || 0) + 1;
                    if (event.operation) {
                        byOperation[event.operation] = (byOperation[event.operation] || 0) + 1;
                    }
                    byLevel[event.level] = (byLevel[event.level] || 0) + 1;
                }
                detailedStats.bufferedBreakdown = {
                    byType,
                    byOperation: Object.keys(byOperation).length > 0 ? byOperation : undefined,
                    byLevel,
                };
            }
            // Add checkpoint with detailed stats
            currentSpan?.checkpoint?.('observability.summary.detailed', { data: detailedStats });
        }
        // If buffering is enabled (smart sampling OR noise reduction), flush buffered events.
        if (config?.sampling?.smart || config?.noiseReduction?.enabled) {
            const context = (0, context_1.getCurrentContext)();
            if (context && context.observability.buffer.length > 0 && !context.observability.errorOccurred) {
                // No error occurred: apply noise reduction + optional sampling to buffer before flushing
                const obsState = context.observability;
                const buffer = obsState.buffer;
                obsState.buffer = []; // Clear buffer
                // CRITICAL: Compute referenced parent IDs from ORIGINAL buffer BEFORE noise reduction
                // Noise reduction may aggregate/remove events, but their parent spans must still be kept
                const referencedParentSpanIds = new Set();
                for (const e of buffer) {
                    const pid = e.parentObservabilityLogId ?? undefined;
                    if (pid)
                        referencedParentSpanIds.add(pid);
                }
                const reduced = (0, noise_reduction_1.applyNoiseReduction)(buffer, config.noiseReduction);
                const reducedEvents = reduced.events;
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
                // Track captured events for detailed summary
                const capturedByType = {};
                const capturedByOperation = {};
                const capturedByLevel = {};
                for (const event of finalEvents) {
                    // TAIL-BASED FILTERING + SAMPLING (after noise reduction)
                    // Apply filtering first (always runs - content-based)
                    const passedFilter = shouldFilter(event, config, {
                        allowSpanMinDurationDrop: true,
                        referencedParentSpanIds,
                    });
                    if (!passedFilter) {
                        // Filtered out - don't count as sampled out
                        continue;
                    }
                    // Apply sampling if enabled (probabilistic)
                    if (config.sampling?.enabled && !shouldSample(event, config)) {
                        obsState.summary.sampledOut++;
                        continue;
                    }
                    // Track captured event breakdowns
                    capturedByType[event.type] = (capturedByType[event.type] || 0) + 1;
                    if (event.operation) {
                        capturedByOperation[event.operation] = (capturedByOperation[event.operation] || 0) + 1;
                    }
                    capturedByLevel[event.level] = (capturedByLevel[event.level] || 0) + 1;
                    obsState.summary.captured++;
                    // Passed both filtering and sampling - emit
                    const targets = getBackendsForType(event.type);
                    await dispatchToBackendsSync(event, targets);
                }
                // Store captured breakdowns in context for summary checkpoint
                if (!obsState.capturedBreakdown) {
                    obsState.capturedBreakdown = { byType: {}, byOperation: {}, byLevel: {} };
                }
                for (const [type, count] of Object.entries(capturedByType)) {
                    obsState.capturedBreakdown.byType[type] = (obsState.capturedBreakdown.byType[type] || 0) + count;
                }
                for (const [op, count] of Object.entries(capturedByOperation)) {
                    obsState.capturedBreakdown.byOperation[op] = (obsState.capturedBreakdown.byOperation[op] || 0) + count;
                }
                for (const [level, count] of Object.entries(capturedByLevel)) {
                    obsState.capturedBreakdown.byLevel[level] = (obsState.capturedBreakdown.byLevel[level] || 0) + count;
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
// ═══════════════════════════════════════════════════════════════════════════
// TEST EXPORTS - Only for testing internal functions
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Export private functions for testing.
 * These should ONLY be used in test files.
 * @internal
 */
exports.__test__ = {
    evictLowestPriority,
    shouldFilter,
    shouldSample,
    getEventPriority,
    buildEvent,
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILHVEQUFrRjtBQUNsRix3Q0FBMEM7QUFDMUMsbUNBU2lCO0FBRWpCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELHVDQUF3RTtBQUN4RSwyQ0FBcUU7QUFDckUsOEJBQW9DO0FBQ3BDLHlDQUFvRDtBQUNwRCx1REFBd0Q7QUFDeEQsK0NBQWdEO0FBQ2hELHFDQUFvRjtBQUNwRixtREFBa0Y7QUFDbEYseURBQXVFO0FBRXZFLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBT3BELDhFQUE4RTtBQUM5RSx1QkFBdUI7QUFDdkIsOEVBQThFO0FBRTlFLElBQUksTUFBTSxHQUErQixJQUFJLENBQUM7QUFDOUMsSUFBSSxRQUFRLEdBQTJCLEVBQUUsQ0FBQztBQUMxQyxJQUFJLGNBQWMsR0FBRyxJQUFJLEdBQUcsRUFBa0QsQ0FBQztBQUMvRSxJQUFJLGVBQWUsR0FBRyxDQUFDLENBQUM7QUFDeEIsSUFBSSxXQUFXLEdBQUcsS0FBSyxDQUFDO0FBQ3hCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQWtCLENBQUM7QUFDckQsTUFBTSxpQkFBaUIsR0FBb0IsRUFBRSxDQUFDLENBQUMsNkNBQTZDO0FBRTVGOzs7R0FHRztBQUNILE1BQU0sWUFBWSxHQUFzQixFQUFFLENBQUM7QUFFM0MsOEVBQThFO0FBQzlFLDJCQUEyQjtBQUMzQiw4RUFBOEU7QUFFOUUsU0FBUyxhQUFhLENBQUMsS0FBbUI7SUFDeEMsTUFBTSxNQUFNLEdBQXNCLEVBQUUsQ0FBQztJQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFpQixHQUFFLENBQUM7SUFFcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNoQixNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO0lBQzlELENBQUM7SUFFRCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxDQUFDLENBQUM7SUFDaEUsQ0FBQztJQUVELElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxJQUFJLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxDQUFDO1FBQ3BELE1BQU0sQ0FBQyxJQUFJLENBQUM7WUFDVixLQUFLLEVBQUUsZUFBZTtZQUN0QixPQUFPLEVBQUUsMEdBQTBHO1NBQ3BILENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBRUQsU0FBUyxtQkFBbUIsQ0FDMUIsS0FBbUIsRUFDbkIsY0FBd0Q7SUFReEQsSUFBSSxDQUFDLGNBQWMsRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUM3QixPQUFPO1lBQ0wsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1lBQ2hCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7WUFDeEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1lBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztTQUNuQixDQUFDO0lBQ0osQ0FBQztJQUVELE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxNQUFNLElBQUksQ0FBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUUsQ0FBQztJQUV4RixPQUFPO1FBQ0wsSUFBSSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUk7WUFDekMsQ0FBQyxDQUFDLElBQUEscUNBQW1CLEVBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxjQUFjLENBQUM7WUFDakQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJO1FBQ2QsVUFBVSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVU7WUFDM0QsQ0FBQyxDQUFDLElBQUEscUNBQW1CLEVBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxjQUFjLENBQUM7WUFDdkQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVO1FBQ3BCLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRO1lBQ3JELENBQUMsQ0FBQyxJQUFBLHFDQUFtQixFQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsY0FBYyxDQUFDO1lBQ3JELENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUTtRQUNsQixPQUFPLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTztZQUNsRCxDQUFDLENBQUMsSUFBQSxxQ0FBbUIsRUFBQyxLQUFLLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQztZQUNwRCxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU87UUFDakIsS0FBSyxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUs7WUFDNUMsQ0FBQyxDQUFDLElBQUEscUNBQW1CLEVBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxjQUFjLENBQUM7WUFDbEQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLO0tBQ2hCLENBQUM7QUFDSixDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsS0FBbUIsRUFBRSxVQUF1RCxJQUFJO0lBQ2xHLE1BQU0sR0FBRyxHQUFHLE9BQU8sSUFBSSxJQUFBLDJCQUFpQixHQUFFLENBQUM7SUFDM0MsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRXZCLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLElBQUksR0FBRyxFQUFFLGFBQWEsQ0FBQztJQUNoRSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDO0lBQzVGLENBQUM7SUFFRCxNQUFNLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsR0FBRyxtQkFBbUIsQ0FDdEYsS0FBSyxFQUNMLE1BQU0sRUFBRSxjQUFjLENBQ3ZCLENBQUM7SUFFRixtRkFBbUY7SUFDbkYsTUFBTSxNQUFNLEdBQUcsTUFBTSxFQUFFLHNCQUFzQixDQUFDO0lBQzlDLElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7SUFDaEMsSUFBSSwwQkFBK0QsQ0FBQztJQUNwRSxJQUFJLE1BQU0sRUFBRSxPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7UUFDakMsTUFBTSxpQkFBaUIsR0FBRyxTQUFTLENBQUM7UUFDcEMsTUFBTSxZQUFZLEdBQXFFLEVBQUUsQ0FBQztRQUMxRixNQUFNLFNBQVMsR0FBRyxDQUNoQixTQUFzRyxFQUN0RyxTQUFpQixFQUNqQixFQUFFO1lBQ0YsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsT0FBTyxJQUFJLENBQUM7WUFDNUIsTUFBTSxHQUFHLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFFLFNBQVMsQ0FBRSxDQUFDO1lBQ2pFLDZGQUE2RjtZQUM3RixPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzdDLENBQUMsQ0FBQztRQUVGLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQztnQkFBRSxTQUFTO1lBQ2pELElBQUksQ0FBQyxJQUFBLDhCQUFjLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7Z0JBQUUsU0FBUztZQUNyRCxNQUFNLElBQUksR0FBRyxJQUFBLDhCQUFjLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2pFLElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUN2QixZQUFZLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztnQkFDbkYsU0FBUyxHQUFHLElBQUksQ0FBQztZQUNuQixDQUFDO1FBQ0gsQ0FBQztRQUVELHFEQUFxRDtRQUNyRCxJQUFJLE1BQU0sQ0FBQyxhQUFhLEtBQUssS0FBSyxJQUFJLFNBQVMsS0FBSyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3RFLDBCQUEwQixHQUFHO2dCQUMzQixJQUFJLEVBQUUsaUJBQWlCO2dCQUN2QixFQUFFLEVBQUUsU0FBUztnQkFDYixPQUFPLEVBQUUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3BDLEtBQUssRUFBRSxZQUFZO2FBQ3BCLENBQUM7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU87UUFDTCxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7UUFDaEIsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1FBQ2xCLGFBQWE7UUFDYixXQUFXLEVBQUUsS0FBSyxDQUFDLFdBQVcsSUFBSSxHQUFHO1FBQ3JDLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxrQkFBa0IsSUFBSSxJQUFBLHlDQUEwQixFQUFDLGFBQWEsQ0FBQztRQUN6RixrR0FBa0c7UUFDbEcsb0NBQW9DO1FBQ3BDLHdCQUF3QixFQUFFLEtBQUssQ0FBQyx3QkFBd0IsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLHdCQUF3QjtRQUM5RyxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7UUFDeEIsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO1FBQ2xDLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSyxJQUFJLEdBQUcsRUFBRSxLQUFLO1FBQ2hDLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTSxJQUFJLEdBQUcsRUFBRSxhQUFhLEVBQUUsTUFBTSxJQUFJLElBQUEsMkJBQVksR0FBRTtRQUNwRSxJQUFJLEVBQUUsSUFBQSx3QkFBUyxFQUFDLEVBQUUsR0FBRyxHQUFHLEVBQUUsYUFBYSxFQUFFLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUM7UUFDckUsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1FBQzVCLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUTtRQUN4QixTQUFTO1FBQ1QsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtRQUNwQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87UUFDdEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1FBQzVCLElBQUksRUFBRSwwQkFBMEI7WUFDOUIsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsRUFBRSxzQkFBc0IsRUFBRSwwQkFBMEIsRUFBRTtZQUN6RSxDQUFDLENBQUMsSUFBSTtRQUNSLFVBQVU7UUFDVixRQUFRO1FBQ1IsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLE9BQU8sRUFBRSxZQUFZO1FBQ3JCLEtBQUs7UUFDTCxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87S0FDdkIsQ0FBQztBQUNKLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILFNBQVMsZUFBZSxDQUFDLElBQVk7SUFDbkMsNEVBQTRFO0lBQzVFLG9GQUFvRjtJQUNwRixJQUFJLElBQUksS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLFlBQVk7UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUM1RCxJQUFJLElBQUksS0FBSyxRQUFRO1FBQUUsT0FBTyxRQUFRLENBQUM7SUFDdkMsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQztRQUFFLE9BQU8sT0FBTyxDQUFDO0lBQzdDLG1EQUFtRDtJQUNuRCxtRUFBbUU7SUFDbkUsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBRUQsU0FBUyxrQkFBa0IsQ0FBQyxJQUFZO0lBQ3RDLE1BQU0sWUFBWSxHQUFHLGVBQWUsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMzQyxNQUFNLFVBQVUsR0FBRyxNQUFNLEVBQUUsS0FBSyxFQUFFLENBQUUsWUFBWSxDQUFFLENBQUM7SUFFbkQsSUFBSSxVQUFVLEVBQUUsUUFBUSxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzNELE9BQU8sUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQTBDLENBQUMsQ0FBQyxDQUFDO0lBQzdHLENBQUM7SUFFRCxPQUFPLFFBQVEsQ0FBQztBQUNsQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLHdCQUF3QixDQUMvQixPQUE2QixFQUM3QixLQUF5QjtJQUV6Qiw4RUFBOEU7SUFDOUUsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakUsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBMEMsQ0FBQyxFQUFFLENBQUM7WUFDekYsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU0sVUFBVSxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3BELElBQUksQ0FBQyxVQUFVO1FBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyx3QkFBd0I7SUFFdEQsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNqRCxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUUsWUFBWSxDQUFFLENBQUM7SUFFdEQsd0RBQXdEO0lBQ3hELElBQUksVUFBVSxFQUFFLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztRQUNsQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxNQUFNLFVBQVUsR0FBRyxJQUFBLDJCQUFhLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRTlDLDZEQUE2RDtJQUM3RCxJQUFJLFVBQVUsRUFBRSxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDdkMsSUFBSSxVQUFVLEdBQUcsVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3JDLE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7U0FBTSxJQUFJLE9BQU8sQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDMUMsc0NBQXNDO1FBQ3RDLElBQUksVUFBVSxHQUFHLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNsQyxPQUFPLEtBQUssQ0FBQztRQUNmLENBQUM7SUFDSCxDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLElBQUksVUFBVSxFQUFFLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUN2QyxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzdDLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQyxDQUFDLHFCQUFxQjtBQUNwQyxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxLQUF5QjtJQUNsRCxJQUFJLENBQUMsTUFBTSxFQUFFLFlBQVk7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUV4QyxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO0lBQ3RDLE1BQU0sT0FBTyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUM7SUFDbEMsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUM7SUFFeEMsdUJBQXVCO0lBQ3ZCLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDO1FBQzVCLE9BQU8sRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsWUFBWTtRQUN0RCxXQUFXLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxXQUFXO0tBQ3RELENBQUMsQ0FBQztJQUVILE1BQU0sWUFBWSxHQUEyQixFQUFFLENBQUM7SUFDaEQsSUFBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDO0lBRWpCLHVCQUF1QjtJQUN2QixJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNmLEtBQUssTUFBTSxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3hELElBQUksUUFBUSxJQUFJLE9BQU87Z0JBQUUsTUFBTTtZQUUvQiwyQ0FBMkM7WUFDM0MsSUFBSSxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzNCLElBQUksT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUN0QyxTQUFTLENBQUMsV0FBVztnQkFDdkIsQ0FBQztZQUNILENBQUM7WUFDRCx3Q0FBd0M7WUFFeEMsb0JBQW9CO1lBQ3BCLFlBQVksQ0FBRSxHQUFHLENBQUUsR0FBRyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3hFLFFBQVEsRUFBRSxDQUFDO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRCw4QkFBOEI7SUFDOUIsSUFBSSxTQUFTLENBQUMsTUFBTSxJQUFJLFFBQVEsR0FBRyxPQUFPLEVBQUUsQ0FBQztRQUMzQyxLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsT0FBTyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUNoRSxJQUFJLFFBQVEsSUFBSSxPQUFPO2dCQUFFLE1BQU07WUFDL0IsSUFBSSxZQUFZLENBQUUsR0FBRyxDQUFFLEtBQUssU0FBUztnQkFBRSxTQUFTLENBQUMsaUJBQWlCO1lBRWxFLElBQUksQ0FBQztnQkFDSCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzdCLElBQUksS0FBSyxFQUFFLENBQUM7b0JBQ1YsWUFBWSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztvQkFDNUIsUUFBUSxFQUFFLENBQUM7Z0JBQ2IsQ0FBQztZQUNILENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sQ0FBQyxJQUFJLENBQUMsaUNBQWlDLEdBQUcsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzlELENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU87UUFDTCxHQUFHLEtBQUs7UUFDUixJQUFJLEVBQUUsWUFBWTtLQUNuQixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsS0FBeUIsRUFBRSxjQUFzQztJQUMzRixpREFBaUQ7SUFDakQsTUFBTSxhQUFhLEdBQUcsaUJBQWlCLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFL0MsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FDekIsY0FBYyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUU7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUN0RCxPQUFPO1lBQ1QsQ0FBQztZQUNELE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUN2QyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN2RSxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQ0gsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQywyQkFBMkI7SUFFOUMsMkNBQTJDO0lBQzNDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNsQyxDQUFDO0FBRUQsS0FBSyxVQUFVLHNCQUFzQixDQUFDLEtBQXlCLEVBQUUsY0FBc0M7SUFDckcsaURBQWlEO0lBQ2pELE1BQU0sYUFBYSxHQUFHLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRS9DLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FDZixjQUFjLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsRUFBRTtRQUNuQyxJQUFJLENBQUM7WUFDSCxJQUFJLENBQUMsd0JBQXdCLENBQUMsT0FBTyxFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELE9BQU87WUFDVCxDQUFDO1lBQ0QsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsT0FBTyxDQUFDLElBQUksR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7SUFDSCxDQUFDLENBQUMsQ0FDSCxDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsK0JBQStCLENBQ3RDLE1BQTRCLEVBQzVCLGdCQUF3QjtJQUV4QixxR0FBcUc7SUFDckcsOEVBQThFO0lBQzlFLEVBQUU7SUFDRixnRUFBZ0U7SUFDaEUsK0ZBQStGO0lBQy9GLGdHQUFnRztJQUNoRyxnR0FBZ0c7SUFDaEcseUNBQXlDO0lBQ3pDLEVBQUU7SUFDRixxRUFBcUU7SUFDckUsTUFBTSxLQUFLLEdBQUcsSUFBQSw2QkFBZSxFQUFDLE1BQU0sRUFBRSxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBQ2hFLElBQUksS0FBSyxDQUFDLG9CQUFvQixDQUFDLElBQUksS0FBSyxDQUFDO1FBQUUsT0FBTyxNQUFNLENBQUM7SUFFekQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLG9CQUFvQixDQUFDO0lBQzNDLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQztJQUNqRCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7UUFDbkMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxDQUFDLHdCQUF3QixJQUFJLFNBQVMsQ0FBQztRQUNwRCx1RUFBdUU7UUFDdkUsT0FBTyxDQUFDLENBQUMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNwQyxDQUFDLENBQUMsQ0FBQztJQUVILE1BQU0sWUFBWSxHQUFHLE1BQU0sQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQztJQUVyRCxJQUFJLFlBQVksR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNyQixnREFBZ0Q7UUFDaEQsUUFBUSxDQUFDLElBQUksQ0FBQztZQUNaLElBQUksRUFBRSxLQUFLO1lBQ1gsS0FBSyxFQUFFLE9BQU87WUFDZCxhQUFhLEVBQUUsZ0JBQWdCO1lBQy9CLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3ZCLGtCQUFrQixFQUFFLElBQUEseUNBQTBCLEVBQUMsZ0JBQWdCLENBQUM7WUFDaEUsU0FBUyxFQUFFLHVEQUF1RDtZQUNsRSxPQUFPLEVBQUUsS0FBSztZQUNkLE9BQU8sRUFBRSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUU7WUFDekIsSUFBSSxFQUFFO2dCQUNKLFlBQVk7Z0JBQ1osb0JBQW9CLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQkFDdEQsdUVBQXVFO2dCQUN2RSxxQkFBcUIsRUFBRSxVQUFVLENBQUMsSUFBSTthQUN2QztZQUNELE1BQU0sRUFBRSw0QkFBNEI7U0FDckMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sUUFBUSxDQUFDO0FBQ2xCLENBQUM7QUFFRCxTQUFTLHdCQUF3QixDQUFDLElBQXlDO0lBQ3pFLE1BQU0sVUFBVSxHQUFHLE1BQU0sRUFBRSxLQUFLLEVBQUUsQ0FBRSxJQUFJLENBQUUsQ0FBQztJQUMzQyxPQUFPLFVBQVUsRUFBRSxRQUFRLElBQUksTUFBTSxFQUFFLFFBQVEsSUFBSSwwQkFBa0IsQ0FBQyxJQUFJLENBQUM7QUFDN0UsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxXQUFXLENBQUMsS0FBeUIsRUFBRSxJQUFrQjtJQUNoRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLElBQUksQ0FBQztJQUVqQyxJQUFJLFlBQWdDLENBQUM7SUFFckMsUUFBUSxNQUFNLEVBQUUsQ0FBQztRQUNmLEtBQUssUUFBUTtZQUNYLHdDQUF3QztZQUN4QyxZQUFZLEdBQUcsS0FBSyxDQUFDLEtBQUssRUFBRSxRQUFRLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUM7WUFDN0QsTUFBTTtRQUVSLEtBQUssT0FBTztZQUNWLDZEQUE2RDtZQUM3RCxZQUFZLEdBQUcsS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQy9DLE1BQU07UUFFUixLQUFLLEtBQUs7WUFDUix5Q0FBeUM7WUFDekMsSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN6RCxNQUFNLENBQUUsR0FBRyxFQUFFLFlBQVksQ0FBRSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUNwRCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUUsR0FBRyxDQUFFLENBQUM7Z0JBQ3JDLElBQUksQ0FBQyxRQUFRO29CQUFFLE9BQU8sS0FBSyxDQUFDO2dCQUU1QixJQUFJLFlBQVksS0FBSyxHQUFHO29CQUFFLE9BQU8sSUFBSSxDQUFDO2dCQUV0QyxrREFBa0Q7Z0JBQ2xELE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUNyRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDOUIsQ0FBQztZQUNELE9BQU8sS0FBSyxDQUFDO1FBRWYsS0FBSyxPQUFPO1lBQ1YsNkJBQTZCO1lBQzdCLFlBQVksR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLE9BQU8sSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLFNBQVMsQ0FBQztZQUM5RCxNQUFNO1FBRVIsS0FBSyxRQUFRO1lBQ1gsWUFBWSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7WUFDNUIsTUFBTTtRQUVSO1lBQ0UsT0FBTyxLQUFLLENBQUM7SUFDakIsQ0FBQztJQUVELElBQUksQ0FBQyxZQUFZO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFaEMsMkNBQTJDO0lBQzNDLElBQUksT0FBTyxZQUFZLE1BQU0sRUFBRSxDQUFDO1FBQzlCLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNwQyxDQUFDO0lBRUQsdUNBQXVDO0lBQ3ZDLE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2hELE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUNsQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsWUFBWSxDQUNuQixLQUF5QixFQUN6QixHQUF3QixFQUN4QixPQVdDO0lBRUQsTUFBTSxVQUFVLEdBQUcsSUFBQSwyQkFBYSxFQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM5QyxNQUFNLFlBQVksR0FBRyxlQUFlLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2pELE1BQU0sY0FBYyxHQUFHLHdCQUF3QixDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQzlELE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUM7SUFDOUIsTUFBTSxZQUFZLEdBQUcsS0FBSyxDQUFDLElBQUksS0FBSyxNQUFNLENBQUM7SUFDM0MsTUFBTSx3QkFBd0IsR0FBRyxPQUFPLEVBQUUsd0JBQXdCLEtBQUssSUFBSSxDQUFDO0lBQzVFLE1BQU0sdUJBQXVCLEdBQUcsT0FBTyxFQUFFLHVCQUF1QixDQUFDO0lBRWpFLHVDQUF1QztJQUV2QywwQkFBMEI7SUFDMUIsSUFBSSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUM7UUFDcEIsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsc0NBQXNDO0lBQ3RDLElBQUksVUFBVSxLQUFLLDBCQUFrQixDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQy9DLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVELHdCQUF3QjtJQUN4QixJQUFJLEtBQUssQ0FBQyxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztRQUMzQyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxrQ0FBa0M7SUFDbEMsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNqQiwwREFBMEQ7UUFDMUQsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLGtCQUFrQixDQUFDO1FBQ3BDLElBQUksRUFBRSxJQUFJLHVCQUF1QixFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQzNDLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUVELHNDQUFzQztRQUN0QyxJQUFJLHdCQUF3QixJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDL0QsTUFBTSxXQUFXLEdBQUcsT0FBTyxFQUFFLGFBQWEsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQztZQUN0RSxJQUFJLFdBQVcsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVUsR0FBRyxXQUFXLEVBQUUsQ0FBQztnQkFDdEQsT0FBTyxLQUFLLENBQUMsQ0FBQyx1QkFBdUI7WUFDdkMsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsc0NBQXNDO0lBQ3RDLElBQUksQ0FBQyxZQUFZLElBQUksT0FBTyxFQUFFLGFBQWEsS0FBSyxTQUFTLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM1RixJQUFJLEtBQUssQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzdDLE9BQU8sS0FBSyxDQUFDLENBQUMsOEJBQThCO1FBQzlDLENBQUM7SUFDSCxDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLGlEQUFpRDtJQUNqRCxtRkFBbUY7SUFFbkYscUJBQXFCO0lBQ3JCLE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsWUFBWSxDQUNuQixLQUF5QixFQUN6QixHQUF3QjtJQUV4QixNQUFNLFVBQVUsR0FBRyxJQUFBLDJCQUFhLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzlDLE1BQU0sWUFBWSxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQztJQUU5QixpREFBaUQ7SUFDakQsSUFBSSxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDbkIsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEdBQUcsQ0FBQyxFQUFFLFVBQVUsR0FBRyxHQUFHLEVBQUUsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBRXBFLHdCQUF3QjtRQUN4QixJQUFJLEtBQUssR0FBRyxZQUFZLEVBQUUsQ0FBQztZQUN6QixPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxvQ0FBb0M7UUFDcEMsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsVUFBVSxDQUFDO0lBQ3BDLENBQUM7SUFFRCxpREFBaUQ7SUFDakQsSUFBSSxHQUFHLENBQUMsUUFBUSxFQUFFLEtBQUssSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDekQsS0FBSyxNQUFNLElBQUksSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3RDLElBQUksV0FBVyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUM3QixPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO1lBQ25DLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELGlDQUFpQztJQUNqQyxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUUsWUFBWSxDQUFFLENBQUM7SUFDL0MsSUFBSSxVQUFVLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxDQUFDO1FBQ2xDLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQ2xELENBQUM7SUFFRCxtQ0FBbUM7SUFDbkMsSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLEdBQUcsQ0FBQyxRQUFRLEVBQUUsVUFBVSxFQUFFLENBQUM7UUFDaEQsS0FBSyxNQUFNLENBQUUsT0FBTyxFQUFFLElBQUksQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ3hFLE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2hELElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztnQkFDaEMsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDO1lBQzlCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELDBDQUEwQztJQUMxQyxNQUFNLFNBQVMsR0FBRyxJQUFBLDJCQUFhLEVBQUMsVUFBVSxDQUFDLENBQUM7SUFDNUMsTUFBTSxJQUFJLEdBQUcsR0FBRyxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsQ0FBRSxTQUFTLENBQUUsQ0FBQztJQUNoRCxJQUFJLElBQUksS0FBSyxTQUFTLElBQUksSUFBSSxJQUFJLENBQUM7UUFBRSxPQUFPLElBQUksQ0FBQztJQUNqRCxJQUFJLElBQUksSUFBSSxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFNUIsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBQzlCLENBQUM7QUFFRCxTQUFTLHdCQUF3QixDQUFDLE9BQWU7SUFDL0MsTUFBTSxvQkFBb0IsR0FBRyxHQUFHLENBQUM7SUFFakMsSUFBSSxLQUFLLEdBQUcsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQzVDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNYLHNEQUFzRDtRQUN0RCxJQUFJLGtCQUFrQixDQUFDLElBQUksSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1lBQ3BELE1BQU0sUUFBUSxHQUFHLGtCQUFrQixDQUFDLElBQUksRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQztZQUN4RCxJQUFJLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDM0Isa0JBQWtCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3RDLENBQUM7UUFDSCxDQUFDO1FBRUQsS0FBSyxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3hELGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsS0FBeUI7SUFDakQsaURBQWlEO0lBQ2pELElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQztRQUMxQixPQUFPLFFBQVEsQ0FBQztJQUNsQixDQUFDO0lBRUQsb0NBQW9DO0lBQ3BDLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxPQUFPLEVBQUUsUUFBUSxJQUFJLENBQUMsQ0FBQztJQUU1QyxNQUFNLEtBQUssR0FBRyxJQUFBLDJCQUFhLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRXpDLHNDQUFzQztJQUN0QyxRQUFRLElBQUksS0FBSyxHQUFHLEVBQUUsQ0FBQztJQUV2QixpQ0FBaUM7SUFDakMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ25DLFFBQVEsSUFBSSxFQUFFLENBQUM7SUFDakIsQ0FBQztJQUVELHNDQUFzQztJQUN0QyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLEtBQUssS0FBSyxFQUFFLENBQUM7UUFDN0QsUUFBUSxJQUFJLEVBQUUsQ0FBQztJQUNqQixDQUFDO0lBRUQsMkNBQTJDO0lBQzNDLElBQUksS0FBSyxDQUFDLFVBQVUsSUFBSSxLQUFLLENBQUMsVUFBVSxHQUFHLElBQUksRUFBRSxDQUFDO1FBQ2hELFFBQVEsSUFBSSxFQUFFLENBQUM7SUFDakIsQ0FBQztJQUVELE9BQU8sUUFBUSxDQUFDO0FBQ2xCLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLG1CQUFtQixDQUMxQixNQUE0QixFQUM1QixPQUF1QztJQUV2QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztRQUFFLE9BQU8sSUFBSSxDQUFDO0lBRXJDLE1BQU0sZUFBZSxHQUFHLE9BQU8sRUFBRSxlQUFlLEtBQUssSUFBSSxDQUFDO0lBRTFELHdCQUF3QjtJQUN4Qix1RkFBdUY7SUFDdkYsdUZBQXVGO0lBQ3ZGLEVBQUU7SUFDRiwwQ0FBMEM7SUFDMUMsOEhBQThIO0lBQzlILGtFQUFrRTtJQUNsRSxzR0FBc0c7SUFFdEcsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBQzdDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLEVBQWdDLENBQUM7SUFDakUsS0FBSyxNQUFNLENBQUMsSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUN2QixNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsd0JBQXdCLElBQUksU0FBUyxDQUFDO1FBQ3BELElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDOUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQzVCLE1BQU0sR0FBRyxHQUFHLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUN0QyxJQUFJLEdBQUc7Z0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQzs7Z0JBQ2hCLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxNQUFNLEdBQUcsQ0FBQyxDQUFxQixFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU0sSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFlBQVksQ0FBQztJQUN2RixNQUFNLEtBQUssR0FBRyxDQUFDLENBQXFCLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQztJQUM5RCxNQUFNLE1BQU0sR0FBRyxDQUFDLENBQXFCLEVBQUUsRUFBRTtRQUN2QyxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEIsSUFBSSxDQUFDLEVBQUU7WUFBRSxPQUFPLElBQUksQ0FBQztRQUNyQixPQUFPLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3JDLENBQUMsQ0FBQztJQUVGLE1BQU0sVUFBVSxHQUFHLENBQUMsVUFBZ0MsRUFBRSxFQUFFO1FBQ3RELElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ2IsSUFBSSxNQUFNLEdBQUcsUUFBUSxDQUFDO1FBQ3RCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDM0MsTUFBTSxDQUFDLEdBQUcsZ0JBQWdCLENBQUMsVUFBVSxDQUFFLENBQUMsQ0FBRSxDQUFDLENBQUM7WUFDNUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxFQUFFLENBQUM7Z0JBQ2YsTUFBTSxHQUFHLENBQUMsQ0FBQztnQkFDWCxHQUFHLEdBQUcsQ0FBQyxDQUFDO1lBQ1YsQ0FBQztRQUNILENBQUM7UUFDRCxPQUFPLEdBQUcsQ0FBQztJQUNiLENBQUMsQ0FBQztJQUVGLHdGQUF3RjtJQUN4RixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRWxELDBCQUEwQjtJQUMxQixNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN4RCxJQUFJLE1BQXNDLENBQUM7SUFDM0MsSUFBSSxhQUFhLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzdCLE1BQU0sR0FBRyxHQUFHLFVBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUN0QyxNQUFNLEdBQUcsYUFBYSxDQUFFLEdBQUcsQ0FBRSxDQUFDO0lBQ2hDLENBQUM7U0FBTSxDQUFDO1FBQ04sSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3JCLDBGQUEwRjtZQUMxRixtRkFBbUY7WUFDbkYsZ0RBQWdEO1lBQ2hELElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDeEIscUVBQXFFO2dCQUNyRSxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO29CQUN2QyxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxFQUFFO3dCQUFFLE9BQU8sSUFBSSxDQUFDLENBQUMsc0JBQXNCO29CQUM1QyxNQUFNLElBQUksR0FBRyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7b0JBQ3RDLElBQUksQ0FBQyxJQUFJO3dCQUFFLE9BQU8sSUFBSSxDQUFDLENBQUMscUJBQXFCO29CQUM3QyxnQ0FBZ0M7b0JBQ2hDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7Z0JBQzVDLENBQUMsQ0FBQyxDQUFDO2dCQUVILElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDNUIsTUFBTSxHQUFHLEdBQUcsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO29CQUNyQyxNQUFNLEdBQUcsWUFBWSxDQUFFLEdBQUcsQ0FBRSxDQUFDO2dCQUMvQixDQUFDO3FCQUFNLENBQUM7b0JBQ04sb0ZBQW9GO29CQUNwRixPQUFPLElBQUksQ0FBQztnQkFDZCxDQUFDO1lBQ0gsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLDhGQUE4RjtnQkFDOUYsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTix1Q0FBdUM7WUFDdkMsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbEQsSUFBSSxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN6QixNQUFNLEdBQUcsR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ2xDLE1BQU0sR0FBRyxTQUFTLENBQUUsR0FBRyxDQUFFLENBQUM7WUFDNUIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLHNGQUFzRjtnQkFDdEYsTUFBTSxHQUFHLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUMvQixNQUFNLEdBQUcsTUFBTSxDQUFFLEdBQUcsQ0FBRSxDQUFDO1lBQ3pCLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksQ0FBQyxNQUFNO1FBQUUsT0FBTyxJQUFJLENBQUM7SUFFekIsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQy9CLElBQUksWUFBWSxHQUFHLENBQUMsQ0FBQztJQUVyQix3RUFBd0U7SUFDeEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQXNCLENBQUM7SUFDL0MsTUFBTSxLQUFLLEdBQXlCLENBQUUsTUFBTSxDQUFFLENBQUM7SUFDL0MsT0FBTyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3hCLE1BQU0sR0FBRyxHQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUcsQ0FBQztRQUMzQixJQUFJLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO1lBQUUsU0FBUztRQUNoQyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2xCLE1BQU0sS0FBSyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN6QixJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ1YsTUFBTSxJQUFJLEdBQUcsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3pDLElBQUksSUFBSTtnQkFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQztJQUNILENBQUM7SUFFRCx5QkFBeUI7SUFDekIsS0FBSyxJQUFJLENBQUMsR0FBRyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDNUMsSUFBSSxRQUFRLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFLENBQUM7WUFDOUIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDcEIsWUFBWSxFQUFFLENBQUM7UUFDakIsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPO1FBQ0wsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJO1FBQ2pCLGFBQWEsRUFBRSxNQUFNLENBQUMsYUFBYTtRQUNuQyxTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7UUFDM0IsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1FBQ25CLFlBQVk7S0FDYixDQUFDO0FBQ0osQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsMkJBQTJCLENBQ2xDLEtBQXlCLEVBQ3pCLE9BQTZDO0lBRTdDLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQztJQUNuQixJQUFJLENBQUMsR0FBRztRQUFFLE9BQU8sTUFBTSxDQUFDO0lBQ3hCLE1BQU0scUJBQXFCLEdBQUcsR0FBRyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUM7SUFDekQsTUFBTSx1QkFBdUIsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUM7SUFDdEQsSUFBSSxDQUFDLENBQUMsdUJBQXVCLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDckUsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWEsRUFBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksMEJBQWtCLENBQUMsS0FBSyxDQUFDO0lBRXZFLHNEQUFzRDtJQUN0RCxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQ1osTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQztRQUN2QyxJQUFJLFFBQVEsQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFDL0IsUUFBUSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7WUFFckIsTUFBTSxPQUFPLEdBQUcsSUFBQSxxQ0FBbUIsRUFBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ2hFLE1BQU0sYUFBYSxHQUFHLCtCQUErQixDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBRTdGLHFFQUFxRTtZQUNyRSxLQUFLLE1BQU0sYUFBYSxJQUFJLGFBQWEsRUFBRSxDQUFDO2dCQUMxQyxNQUFNLE9BQU8sR0FBRyxrQkFBa0IsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3ZELGtCQUFrQixDQUFDLGFBQWEsRUFBRSxPQUFPLENBQUMsQ0FBQztZQUM3QyxDQUFDO1FBQ0gsQ0FBQztRQUVELFFBQVEsQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDO1FBQzlCLE1BQU0sY0FBYyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN0RCxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDMUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUU1QixPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDO0lBRUQsdUNBQXVDO0lBQ3ZDLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN4QyxNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEQsa0JBQWtCLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQzFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBRXpDLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUM7SUFFRCwyRUFBMkU7SUFDM0UsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQztJQUN2QyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO0lBRS9CLHdEQUF3RDtJQUN4RCxNQUFNLE9BQU8sR0FBRyxHQUFHLENBQUMsUUFBUSxFQUFFLGFBQWEsSUFBSSxJQUFJLENBQUM7SUFDcEQsSUFBSSxNQUFNLENBQUMsTUFBTSxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQzdCLGFBQWE7UUFDYixrR0FBa0c7UUFDbEcsc0dBQXNHO1FBQ3RHLDZGQUE2RjtRQUM3RixNQUFNLFdBQVcsR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsRUFBRSxlQUFlLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztRQUM1RSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDN0IsQ0FBQzthQUFNLENBQUM7WUFDTixtRkFBbUY7WUFDbkYsTUFBTSxPQUFPLEdBQUcsT0FBTyxHQUFHLENBQUMsQ0FBQztZQUM1QixJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQzdCLE1BQU0sZUFBZSxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUMvRSxJQUFJLGVBQWUsRUFBRSxDQUFDO29CQUNwQixRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUM3QixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCx5Q0FBeUM7UUFDekMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sS0FBSyxDQUFDLElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzNFLE1BQU0sQ0FBQyxJQUFJLENBQUMsNERBQTRELEVBQUU7Z0JBQ3hFLE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU87Z0JBQ2pDLFVBQVUsRUFBRSxNQUFNLENBQUMsTUFBTTtnQkFDekIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO2dCQUNwQyxZQUFZLEVBQUUsV0FBVzthQUMxQixDQUFDLENBQUM7UUFDTCxDQUFDO2FBQU0sSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUN2Qix1REFBdUQ7WUFDdkQsTUFBTSxDQUFDLEtBQUssQ0FBQyx5Q0FBeUMsRUFBRTtnQkFDdEQsR0FBRyxXQUFXO2dCQUNkLFlBQVksRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU87YUFDdkMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFRCxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25CLFFBQVEsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDNUIsT0FBTyxVQUFVLENBQUM7QUFDcEIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLDRCQUE0QixDQUN6QyxLQUF5QixFQUN6QixPQUE2QztJQUU3QyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUM7SUFDbkIsSUFBSSxDQUFDLEdBQUc7UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUN4QixNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDO0lBQ3pELE1BQU0sdUJBQXVCLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDO0lBQ3RELElBQUksQ0FBQyxDQUFDLHVCQUF1QixJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3JFLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFhLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLDBCQUFrQixDQUFDLEtBQUssQ0FBQztJQUV2RSxzREFBc0Q7SUFDdEQsSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUNaLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxhQUFhLENBQUM7UUFDdkMsSUFBSSxRQUFRLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMvQixNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO1lBQy9CLFFBQVEsQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDO1lBRXJCLE1BQU0sT0FBTyxHQUFHLElBQUEscUNBQW1CLEVBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUNoRSxNQUFNLGFBQWEsR0FBRywrQkFBK0IsQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUU3RixxRUFBcUU7WUFDckUsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUU7Z0JBQ2xELE1BQU0sT0FBTyxHQUFHLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDdkQsT0FBTyxzQkFBc0IsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDeEQsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNOLENBQUM7UUFFRCxRQUFRLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQztRQUM5QixNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEQsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDcEQsUUFBUSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUU1QixPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDO0lBRUQsdUNBQXVDO0lBQ3ZDLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN4QyxNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEQsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDcEQsT0FBTyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFFekMsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQztJQUVELGlDQUFpQztJQUNqQyxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDO0lBQ3ZDLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7SUFFL0Isd0RBQXdEO0lBQ3hELE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxRQUFRLEVBQUUsYUFBYSxJQUFJLElBQUksQ0FBQztJQUNwRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7UUFDN0IsTUFBTSxXQUFXLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7UUFDNUUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzdCLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxPQUFPLEdBQUcsT0FBTyxHQUFHLENBQUMsQ0FBQztZQUM1QixJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQzdCLE1BQU0sZUFBZSxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUMvRSxJQUFJLGVBQWUsRUFBRSxDQUFDO29CQUNwQixRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUM3QixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxnQ0FBZ0M7UUFDaEMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sS0FBSyxDQUFDLElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzNFLE1BQU0sQ0FBQyxJQUFJLENBQUMsNERBQTRELEVBQUU7Z0JBQ3hFLE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU87Z0JBQ2pDLFVBQVUsRUFBRSxNQUFNLENBQUMsTUFBTTtnQkFDekIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO2FBQ3JDLENBQUMsQ0FBQztRQUNMLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNuQixRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQzVCLE9BQU8sVUFBVSxDQUFDO0FBQ3BCLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLDBCQUEwQixDQUFDLEdBQXdCO0lBQzFELElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzNCLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUNBQXVDLENBQUMsQ0FBQztRQUN0RCxPQUFPO0lBQ1QsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztRQUN6RCxpREFBaUQ7UUFDakQsT0FBTyxDQUFDLDZCQUE2QixDQUFDLENBQUM7UUFDdkMsTUFBTSxDQUFDLElBQUksQ0FBQywrRUFBK0UsQ0FBQyxDQUFDO0lBQy9GLENBQUM7SUFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO1FBQ3hCLHVFQUF1RTtRQUN2RSxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxJQUFJLEtBQUssSUFBSyxLQUE0QixDQUFDLElBQUksS0FBSyxrQkFBa0IsRUFBRSxDQUFDO1lBQ3ZILE1BQU0sQ0FBQyxJQUFJLENBQ1QsZ0hBQWdILENBQ2pILENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sR0FBRyxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuRSxNQUFNLENBQUMsSUFBSSxDQUFDLG9DQUFvQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3pELENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyw0QkFBNEIsQ0FBQyxHQUF3QjtJQUM1RCxRQUFRLEdBQUcsRUFBRSxDQUFDO0lBQ2QsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3ZCLE1BQU0sZUFBZSxHQUFHLEdBQUcsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxLQUFLLENBQUMsQ0FBQztJQUV0RSxLQUFLLE1BQU0sVUFBVSxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQ3pDLElBQUksQ0FBQztZQUNILE1BQU0sT0FBTyxHQUFHLGdCQUFXLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FDdEMsc0JBQXNCLEVBQ3RCLEVBQUUsSUFBSSxFQUFFLENBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUMsSUFBSSxDQUFFLEVBQUUsQ0FDMUQsQ0FBQztZQUNGLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDdkIsY0FBYyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQzdDLE1BQU0sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksNkJBQW9CLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLFVBQVUsQ0FBQyxJQUFJLDZCQUE2QixDQUFDLENBQUM7WUFDeEUsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLFVBQVUsQ0FBQyxJQUFJLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztZQUM1RSxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDMUIsc0RBQXNEO1FBQ3RELHNGQUFzRjtRQUN0RixNQUFNLENBQUMsS0FBSyxDQUFDLHVJQUF1SSxFQUFFO1lBQ3BKLG1CQUFtQixFQUFFLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1NBQ3RELENBQUMsQ0FBQztJQUNMLENBQUM7QUFDSCxDQUFDO0FBRUQsU0FBUyxZQUFZO0lBQ25CLElBQUksQ0FBQztRQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsNENBQTRDLENBQUMsQ0FBQztRQUUzRCwyREFBMkQ7UUFDM0QsSUFBSSxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzVCLE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxZQUFZLENBQUMsTUFBTSxnQ0FBZ0MsQ0FBQyxDQUFDO1lBQzdFLEtBQUssTUFBTSxJQUFJLElBQUksWUFBWSxFQUFFLENBQUM7Z0JBQ2hDLElBQUksQ0FBQztvQkFDSCxJQUFJLEVBQUUsQ0FBQztnQkFDVCxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsTUFBTSxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsRUFBRSxLQUFLLENBQUMsQ0FBQztvQkFDdkQsTUFBTSxLQUFLLENBQUM7Z0JBQ2QsQ0FBQztZQUNILENBQUM7WUFDRCxNQUFNLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7UUFDckQsQ0FBQztRQUVELHlGQUF5RjtRQUN6RixrR0FBa0c7UUFDbEcsTUFBTSxLQUFLLEdBQUcsZ0JBQVcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUEyQixlQUFlLENBQUMsQ0FBQztRQUN4RixNQUFNLEdBQUcsSUFBQSxrQ0FBeUIsRUFBQyxLQUFLLENBQUMsQ0FBQztRQUMxQyxJQUFBLDZDQUE2QixFQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3RDLE1BQU0sQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUU7WUFDbEQsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPO1lBQ3ZCLFdBQVcsRUFBRSxNQUFNLENBQUMsV0FBVztZQUMvQixRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1lBQzNDLFFBQVEsRUFBRSxFQUFFLE9BQU8sRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUU7WUFDOUUsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTLEVBQUUsT0FBTztTQUNyQyxDQUFDLENBQUM7UUFFSCxxRUFBcUU7UUFDckUsMEJBQTBCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFbkMsOEJBQThCO1FBQzlCLDRCQUE0QixDQUFDLE1BQU8sQ0FBQyxDQUFDO1FBRXRDLGtDQUFrQztRQUNsQyxJQUFBLHlCQUFrQixFQUFDO1lBQ2pCLE9BQU8sRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUN2RCxZQUFZLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUM7U0FDbEUsQ0FBQyxDQUFDO1FBRUgsV0FBVyxHQUFHLElBQUksQ0FBQztRQUNuQixNQUFNLENBQUMsSUFBSSxDQUFDLCtDQUErQyxDQUFDLENBQUM7SUFDL0QsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLENBQUMsS0FBSyxDQUFDLDZDQUE2QyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ25FLGlEQUFpRDtRQUNqRCw2R0FBNkc7UUFDN0csV0FBVyxHQUFHLElBQUksQ0FBQztRQUNuQixNQUFNLEdBQUcsSUFBSSxDQUFDO1FBQ2QsSUFBQSw2Q0FBNkIsRUFBQyxJQUFJLENBQUMsQ0FBQztRQUNwQyxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBQ2QsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3pCLENBQUM7QUFDSCxDQUFDO0FBRUQsOEVBQThFO0FBQzlFLG9DQUFvQztBQUNwQyw4RUFBOEU7QUFFOUUsTUFBYSxvQkFBb0I7SUFFL0IsZ0JBQXdCLENBQUM7SUFFekI7O09BRUc7SUFDSCxNQUFNLENBQUMsb0JBQW9CO1FBQ3pCLE1BQU0sQ0FBQyxLQUFLLENBQUMsb0RBQW9ELEVBQUUsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFLENBQUMsQ0FBQztRQUVyRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsTUFBTSxDQUFDLEtBQUssQ0FBQyxnREFBZ0QsQ0FBQyxDQUFDO1lBQy9ELFlBQVksRUFBRSxDQUFDO1FBQ2pCLENBQUM7UUFFRCxlQUFlLEVBQUUsQ0FBQztRQUNsQixNQUFNLENBQUMsS0FBSyxDQUFDLGNBQWMsZUFBZSwyQkFBMkIsUUFBUSxDQUFDLE1BQU0sYUFBYSxDQUFDLENBQUM7UUFFbkcsS0FBSyxNQUFNLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUMvQixJQUFJLENBQUM7Z0JBQ0gsT0FBTyxDQUFDLG9CQUFvQixFQUFFLEVBQUUsQ0FBQztZQUNuQyxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsT0FBTyxDQUFDLElBQUksbUNBQW1DLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDbEYsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxDQUFDLGFBQWE7UUFDbEIsT0FBTyxXQUFXLENBQUM7SUFDckIsQ0FBQztJQUVELE1BQU0sQ0FBQyxXQUFXO1FBQ2hCLE9BQU8sZUFBZSxLQUFLLENBQUMsQ0FBQztJQUMvQixDQUFDO0lBRUQsTUFBTSxDQUFDLGtCQUFrQjtRQUN2QixPQUFPLGVBQWUsQ0FBQztJQUN6QixDQUFDO0lBRUQsTUFBTSxDQUFDLFNBQVM7UUFDZCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxVQUFVO1FBQ2YsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO1FBQ3BDLE9BQU8sT0FBTyxFQUFFLGFBQWEsQ0FBQyxPQUFPLENBQUM7SUFDeEMsQ0FBQztJQUVELE1BQU0sQ0FBQyxTQUFTLENBQUMsT0FBcUM7UUFDcEQsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO1FBQzFELENBQUM7UUFDRCxNQUFNLEdBQUcsRUFBRSxHQUFHLE1BQU0sRUFBRSxHQUFHLE9BQU8sRUFBRSxDQUFDO0lBQ3JDLENBQUM7SUFFRCxNQUFNLENBQUMsZUFBZSxDQUFDLE9BQTZCO1FBQ2xELElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNsRCxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsT0FBTyxDQUFDLElBQUkscUJBQXFCLENBQUMsQ0FBQztZQUMxRCxPQUFPO1FBQ1QsQ0FBQztRQUNELFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDekIsQ0FBQztJQUVELE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxJQUFZO1FBQ25DLFFBQVEsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLENBQUMsSUFBZ0I7UUFDekMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMxQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBbUI7UUFDaEMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sQ0FBQyxJQUFJLENBQUMsbURBQW1ELEVBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDM0csT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILHdFQUF3RTtZQUN4RSw0REFBNEQ7WUFDNUQsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFVBQVUsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFlBQVksRUFBRSxDQUFDO2dCQUM3RCxNQUFNLENBQUMsS0FBSyxDQUFDLHdHQUF3RyxFQUFFO29CQUNySCxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7b0JBQ2hCLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztvQkFDMUIsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO29CQUNsQyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsd0JBQXdCO29CQUN4RCxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07aUJBQ3JCLENBQUMsQ0FBQztnQkFDSCxPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBRUQsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3BDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQ3BFLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFFRCxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxDQUFDO2dCQUNyQixNQUFNLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUMvRSxPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO1lBQ3BDLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFekMsZ0NBQWdDO1lBQ2hDLE1BQU0sVUFBVSxHQUFHLDJCQUEyQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztZQUMvRCxJQUFJLFVBQVUsS0FBSyxVQUFVLEVBQUUsQ0FBQztnQkFDOUIsT0FBTyxLQUFLLENBQUMsa0JBQWtCLENBQUM7WUFDbEMsQ0FBQztZQUNELElBQUksVUFBVSxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUM5QixPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBRUQsa0NBQWtDO1lBQ2xDLHNDQUFzQztZQUN0QyxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUU7Z0JBQy9CLDZFQUE2RTtnQkFDN0UsOEVBQThFO2dCQUM5RSx3QkFBd0IsRUFBRSxLQUFLO2FBQ2hDLENBQUMsRUFBRSxDQUFDO2dCQUNILE9BQU8sU0FBUyxDQUFDLENBQUMsZUFBZTtZQUNuQyxDQUFDO1lBRUQsNENBQTRDO1lBQzVDLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRSxPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQzdELE9BQU8sU0FBUyxDQUFDLENBQUMsY0FBYztZQUNsQyxDQUFDO1lBRUQsTUFBTSxjQUFjLEdBQUcsa0JBQWtCLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3RELGtCQUFrQixDQUFDLEtBQUssRUFBRSxjQUFjLENBQUMsQ0FBQztZQUMxQyxPQUFPLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztRQUNsQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDcEQsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQW1CO1FBQzNDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqQixNQUFNLENBQUMsS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUM7WUFDaEUsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILHdFQUF3RTtZQUN4RSw0REFBNEQ7WUFDNUQsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFVBQVUsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFlBQVksRUFBRSxDQUFDO2dCQUM3RCxNQUFNLENBQUMsS0FBSyxDQUFDLHdHQUF3RyxFQUFFO29CQUNySCxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7b0JBQ2hCLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztvQkFDMUIsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO29CQUNsQyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsd0JBQXdCO29CQUN4RCxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07aUJBQ3JCLENBQUMsQ0FBQztnQkFDSCxPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBRUQsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3BDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQ3BFLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFFRCxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU87Z0JBQUUsT0FBTyxTQUFTLENBQUM7WUFFdkMsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO1lBQ3BDLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFekMsZ0NBQWdDO1lBQ2hDLE1BQU0sVUFBVSxHQUFHLE1BQU0sNEJBQTRCLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ3RFLElBQUksVUFBVSxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUM5QixPQUFPLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztZQUNsQyxDQUFDO1lBQ0QsSUFBSSxVQUFVLEtBQUssVUFBVSxFQUFFLENBQUM7Z0JBQzlCLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFFRCxrQ0FBa0M7WUFDbEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFO2dCQUMvQix3QkFBd0IsRUFBRSxLQUFLO2FBQ2hDLENBQUMsRUFBRSxDQUFDO2dCQUNILE9BQU8sU0FBUyxDQUFDLENBQUMsZUFBZTtZQUNuQyxDQUFDO1lBRUQsSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQztnQkFDN0QsT0FBTyxTQUFTLENBQUMsQ0FBQyxjQUFjO1lBQ2xDLENBQUM7WUFFRCxNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDdEQsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7WUFDcEQsT0FBTyxLQUFLLENBQUMsa0JBQWtCLENBQUM7UUFDbEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3pELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsT0FBTyxDQUNaLEtBQTRGO1FBRTVGLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLElBQUksSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO1FBRXhFLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixNQUFNLENBQUMsSUFBSSxDQUFDLHdDQUF3QyxDQUFDLENBQUM7WUFDdEQsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztRQUVELE9BQU8sb0JBQW9CLENBQUMsT0FBTyxDQUFDO1lBQ2xDLEdBQUcsS0FBSztZQUNSLGFBQWE7WUFDYixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQThCO1lBQzFDLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBZ0M7U0FDOUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLO1FBQ2hCLE1BQU0sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUU7WUFDbEMsaUJBQWlCLEVBQUUsaUJBQWlCLENBQUMsTUFBTTtZQUMzQyxRQUFRLEVBQUUsUUFBUSxDQUFDLE1BQU07WUFDekIsYUFBYSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsS0FBSztTQUN2QyxDQUFDLENBQUM7UUFFSCxpRkFBaUY7UUFDakYsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDakMsTUFBTSxDQUFDLEtBQUssQ0FBQyxlQUFlLGlCQUFpQixDQUFDLE1BQU0scUJBQXFCLENBQUMsQ0FBQztZQUMzRSxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUNyQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsNEJBQTRCO1lBQzFELE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUMvQyxDQUFDO1FBRUQsb0ZBQW9GO1FBQ3BGLG1HQUFtRztRQUNuRyxJQUFBLGdDQUFnQixHQUFFLENBQUM7UUFFbkIsd0VBQXdFO1FBQ3hFLE1BQU0sT0FBTyxHQUFHLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2xELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztRQUNwQyxNQUFNLFdBQVcsR0FBRyxPQUFPLEVBQUUsYUFBYSxDQUFDLFdBQVcsQ0FBQztRQUN2RCxJQUFJLE9BQU8sSUFBSSxXQUFXLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsUUFBUSxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsT0FBTyxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsVUFBVSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDOUgsMEJBQTBCO1lBQzFCLFdBQVcsRUFBRSxPQUFPLEVBQUUsQ0FBQztnQkFDckIsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQ3RDLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxRQUFRO2dCQUN0QyxtQkFBbUIsRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDcEMsc0JBQXNCLEVBQUUsT0FBTyxDQUFDLFVBQVU7YUFDM0MsQ0FBQyxDQUFDO1lBRUgsb0NBQW9DO1lBQ3BDLE1BQU0sYUFBYSxHQUE0QjtnQkFDN0MsTUFBTSxFQUFFO29CQUNOLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtvQkFDMUIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO29CQUMxQixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87b0JBQ3hCLFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVTtpQkFDL0I7YUFDRixDQUFDO1lBRUYsNERBQTREO1lBQzVELE1BQU0sUUFBUSxHQUFHLE9BQU8sRUFBRSxhQUFhLENBQUM7WUFDeEMsSUFBSSxRQUFRLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztnQkFDaEMsYUFBYSxDQUFDLGlCQUFpQixHQUFHO29CQUNoQyxNQUFNLEVBQUUsUUFBUSxDQUFDLGlCQUFpQixDQUFDLE1BQU07b0JBQ3pDLFdBQVcsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUM7d0JBQy9FLENBQUMsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsV0FBVzt3QkFDeEMsQ0FBQyxDQUFDLFNBQVM7b0JBQ2IsT0FBTyxFQUFFLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPO2lCQUM1QyxDQUFDO1lBQ0osQ0FBQztZQUVELDhFQUE4RTtZQUM5RSxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZELE1BQU0sTUFBTSxHQUEyQixFQUFFLENBQUM7Z0JBQzFDLE1BQU0sV0FBVyxHQUEyQixFQUFFLENBQUM7Z0JBQy9DLE1BQU0sT0FBTyxHQUEyQixFQUFFLENBQUM7Z0JBRTNDLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDakQsTUFBTSxDQUFFLEtBQUssQ0FBQyxJQUFJLENBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBRSxLQUFLLENBQUMsSUFBSSxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUN2RCxJQUFJLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQzt3QkFDcEIsV0FBVyxDQUFFLEtBQUssQ0FBQyxTQUFTLENBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBRSxLQUFLLENBQUMsU0FBUyxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUM3RSxDQUFDO29CQUNELE9BQU8sQ0FBRSxLQUFLLENBQUMsS0FBSyxDQUFFLEdBQUcsQ0FBQyxPQUFPLENBQUUsS0FBSyxDQUFDLEtBQUssQ0FBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDN0QsQ0FBQztnQkFFRCxhQUFhLENBQUMsaUJBQWlCLEdBQUc7b0JBQ2hDLE1BQU07b0JBQ04sV0FBVyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxTQUFTO29CQUMxRSxPQUFPO2lCQUNSLENBQUM7WUFDSixDQUFDO1lBRUQscUNBQXFDO1lBQ3JDLFdBQVcsRUFBRSxVQUFVLEVBQUUsQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZGLENBQUM7UUFFRCxzRkFBc0Y7UUFDdEYsSUFBSSxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUssSUFBSSxNQUFNLEVBQUUsY0FBYyxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQy9ELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztZQUVwQyxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztnQkFDL0YseUZBQXlGO2dCQUN6RixNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDO2dCQUN2QyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO2dCQUMvQixRQUFRLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQyxDQUFDLGVBQWU7Z0JBRXJDLHNGQUFzRjtnQkFDdEYseUZBQXlGO2dCQUN6RixNQUFNLHVCQUF1QixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7Z0JBQ2xELEtBQUssTUFBTSxDQUFDLElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ3ZCLE1BQU0sR0FBRyxHQUFHLENBQUMsQ0FBQyx3QkFBd0IsSUFBSSxTQUFTLENBQUM7b0JBQ3BELElBQUksR0FBRzt3QkFBRSx1QkFBdUIsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQzVDLENBQUM7Z0JBRUQsTUFBTSxPQUFPLEdBQUcsSUFBQSxxQ0FBbUIsRUFBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO2dCQUNuRSxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO2dCQUVyQyx5Q0FBeUM7Z0JBQ3pDLDhGQUE4RjtnQkFDOUYsTUFBTSx1QkFBdUIsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLFNBQVM7b0JBQ3BELENBQUMsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7d0JBQzNCLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNOzRCQUFFLE9BQU8sSUFBSSxDQUFDO3dCQUNuQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUMsa0JBQWtCLENBQUM7d0JBQ2hDLElBQUksQ0FBQyxFQUFFOzRCQUFFLE9BQU8sSUFBSSxDQUFDO3dCQUNyQixJQUFJLHVCQUF1QixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7NEJBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyxpQkFBaUI7d0JBQ25FLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUEyQyxDQUFDO3dCQUN4RCxNQUFNLEVBQUUsR0FBRyxDQUFDLEVBQUUsS0FBNEMsQ0FBQzt3QkFDM0QsT0FBTyxFQUFFLEVBQUUsU0FBUyxLQUFLLElBQUksQ0FBQztvQkFDaEMsQ0FBQyxDQUFDO29CQUNGLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBRWxCLE1BQU0sV0FBVyxHQUFHLCtCQUErQixDQUFDLHVCQUF1QixFQUFFLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztnQkFFcEcsNkNBQTZDO2dCQUM3QyxNQUFNLGNBQWMsR0FBMkIsRUFBRSxDQUFDO2dCQUNsRCxNQUFNLG1CQUFtQixHQUEyQixFQUFFLENBQUM7Z0JBQ3ZELE1BQU0sZUFBZSxHQUEyQixFQUFFLENBQUM7Z0JBRW5ELEtBQUssTUFBTSxLQUFLLElBQUksV0FBVyxFQUFFLENBQUM7b0JBQ2hDLDBEQUEwRDtvQkFFMUQsc0RBQXNEO29CQUN0RCxNQUFNLFlBQVksR0FBRyxZQUFZLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRTt3QkFDL0Msd0JBQXdCLEVBQUUsSUFBSTt3QkFDOUIsdUJBQXVCO3FCQUN4QixDQUFDLENBQUM7b0JBQ0gsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO3dCQUNsQiw0Q0FBNEM7d0JBQzVDLFNBQVM7b0JBQ1gsQ0FBQztvQkFFRCw0Q0FBNEM7b0JBQzVDLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRSxPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUM7d0JBQzdELFFBQVEsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUM7d0JBQzlCLFNBQVM7b0JBQ1gsQ0FBQztvQkFFRCxrQ0FBa0M7b0JBQ2xDLGNBQWMsQ0FBRSxLQUFLLENBQUMsSUFBSSxDQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUUsS0FBSyxDQUFDLElBQUksQ0FBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDdkUsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7d0JBQ3BCLG1CQUFtQixDQUFFLEtBQUssQ0FBQyxTQUFTLENBQUUsR0FBRyxDQUFDLG1CQUFtQixDQUFFLEtBQUssQ0FBQyxTQUFTLENBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQzdGLENBQUM7b0JBQ0QsZUFBZSxDQUFFLEtBQUssQ0FBQyxLQUFLLENBQUUsR0FBRyxDQUFDLGVBQWUsQ0FBRSxLQUFLLENBQUMsS0FBSyxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUMzRSxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO29CQUU1Qiw0Q0FBNEM7b0JBQzVDLE1BQU0sT0FBTyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztvQkFDL0MsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQy9DLENBQUM7Z0JBRUQsOERBQThEO2dCQUM5RCxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixFQUFFLENBQUM7b0JBQ2hDLFFBQVEsQ0FBQyxpQkFBaUIsR0FBRyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLENBQUM7Z0JBQzVFLENBQUM7Z0JBQ0QsS0FBSyxNQUFNLENBQUUsSUFBSSxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztvQkFDN0QsUUFBUSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBRSxJQUFJLENBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUUsSUFBSSxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDO2dCQUN2RyxDQUFDO2dCQUNELEtBQUssTUFBTSxDQUFFLEVBQUUsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztvQkFDaEUsUUFBUSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsQ0FBRSxFQUFFLENBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUUsRUFBRSxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDO2dCQUM3RyxDQUFDO2dCQUNELEtBQUssTUFBTSxDQUFFLEtBQUssRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7b0JBQy9ELFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUUsS0FBSyxDQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFFLEtBQUssQ0FBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQztnQkFDM0csQ0FBQztZQUNILENBQUM7WUFDRCxtRUFBbUU7UUFDckUsQ0FBQztRQUVELHNDQUFzQztRQUN0QywrRUFBK0U7UUFDL0UscUNBQXFDO1FBQ3JDLE1BQU0saUJBQWlCLEdBQUcsQ0FBQyxDQUFDO1FBQzVCLE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxFQUFFO1lBQ25ELElBQUksQ0FBQztnQkFDSCxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO29CQUNuQixPQUFPO2dCQUNULENBQUM7Z0JBRUQsS0FBSyxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsT0FBTyxJQUFJLGlCQUFpQixFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUM7b0JBQzlELElBQUksQ0FBQzt3QkFDSCxNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQzt3QkFDdEIsTUFBTSxDQUFDLFVBQVU7b0JBQ25CLENBQUM7b0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQzt3QkFDZixJQUFJLE9BQU8sS0FBSyxpQkFBaUIsRUFBRSxDQUFDOzRCQUNsQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsT0FBTyxDQUFDLElBQUksdUJBQXVCLE9BQU8sWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDOzRCQUN2Riw4Q0FBOEM7NEJBQzlDLDhDQUE4Qzt3QkFDaEQsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxPQUFPLENBQUMsSUFBSSwwQkFBMEIsT0FBTyxJQUFJLGlCQUFpQixnQkFBZ0IsRUFBRSxLQUFLLENBQUMsQ0FBQzs0QkFDbEgsNkJBQTZCOzRCQUM3QixNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQzt3QkFDbkUsQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUM7WUFDSCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixxREFBcUQ7Z0JBQ3JELE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxPQUFPLENBQUMsSUFBSSwyQkFBMkIsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDeEUsOENBQThDO1lBQ2hELENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUVqQyxNQUFNLENBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7SUFDekMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUs7UUFDVixNQUFNLEdBQUcsSUFBSSxDQUFDO1FBQ2QsSUFBQSw2Q0FBNkIsRUFBQyxJQUFJLENBQUMsQ0FBQztRQUNwQyxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBQ2QsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3ZCLGVBQWUsR0FBRyxDQUFDLENBQUM7UUFDcEIsV0FBVyxHQUFHLEtBQUssQ0FBQztRQUNwQixrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBQzdCLElBQUEsb0JBQWEsR0FBRSxDQUFDO0lBQ2xCLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxvQkFBb0IsQ0FDekIsVUFBK0IsRUFDL0IsZUFBdUMsRUFBRTtRQUV6QyxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUM3QixNQUFNLEdBQUcsVUFBVSxDQUFDO1FBQ3BCLElBQUEsNkNBQTZCLEVBQUMsVUFBVSxDQUFDLENBQUM7UUFDMUMsUUFBUSxHQUFHLFlBQVksQ0FBQztRQUN4QixXQUFXLEdBQUcsSUFBSSxDQUFDO1FBRW5CLElBQUEseUJBQWtCLEVBQUM7WUFDakIsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ3ZELFlBQVksRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQztTQUNsRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE1ZUQsb0RBNGVDO0FBRUQ7O0dBRUc7QUFDSSxNQUFNLGlCQUFpQixHQUFHLENBQXFELE9BQVUsRUFBSyxFQUFFO0lBQ3JHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxJQUFtQixFQUFFLEVBQUU7UUFDdkMsSUFBSSxDQUFDO1lBQ0gsb0JBQW9CLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM1QyxPQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQyxDQUFNLENBQUM7QUFDVixDQUFDLENBQUM7QUFUVyxRQUFBLGlCQUFpQixxQkFTNUI7QUFFVyxRQUFBLFFBQVEsR0FBRyxvQkFBb0IsQ0FBQztBQUU3Qyw4RUFBOEU7QUFDOUUscURBQXFEO0FBQ3JELDhFQUE4RTtBQUU5RTs7OztHQUlHO0FBQ1UsUUFBQSxRQUFRLEdBQUc7SUFDdEIsbUJBQW1CO0lBQ25CLFlBQVk7SUFDWixZQUFZO0lBQ1osZ0JBQWdCO0lBQ2hCLFVBQVU7Q0FDWCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5TWFuYWdlciAtIENvcmUgT2JzZXJ2ZXIgZm9yIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbVxuICogXG4gKiBBbGwgY29uZmlnIGFuZCBiYWNrZW5kcyByZXNvbHZlZCBmcm9tIERJIC0gbm8gbWFudWFsIGluc3RhbnRpYXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZ2VuZXJhdGVTcGFuSWQsIGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkIH0gZnJvbSAnLi91dGlscy9pZC1nZW5lcmF0b3InO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQge1xuICBDYXB0dXJlQ29udHJvbCxcbiAgQ2FwdHVyZUlucHV0LFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdSdWxlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvdHlwZXMnO1xuaW1wb3J0IHsgc3RyaW5nVG9MZXZlbCwgbGV2ZWxUb1N0cmluZyB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuaW1wb3J0IHsgZGV0ZWN0U291cmNlLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQsIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyB9IGZyb20gJy4vY29udGV4dCc7XG5pbXBvcnQgeyBpbml0aWFsaXplQ2FwdHVyZXIsIHJlc2V0Q2FwdHVyZXIgfSBmcm9tICcuL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGknO1xuaW1wb3J0IHsgTm9Qcm92aWRlckZvdW5kRXJyb3IgfSBmcm9tICcuLi9kaS9lcnJvcnMnO1xuaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uJztcbmltcG9ydCB7IGJ1aWxkVHJhY2VHcmFwaCB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZywgdHlwZSBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQgfSBmcm9tICcuL2NvbmZpZyc7XG5pbXBvcnQgeyBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgcnVuU3BhbkZpbmFsaXplciB9IGZyb20gJy4vcnVudGltZS1zdGF0ZSc7XG5pbXBvcnQgeyBtYXRjaGVzUGF0dGVybiwgcmVwbGFjZVBhdHRlcm4gfSBmcm9tICcuL3V0aWxzL3BhdHRlcm4tdXRpbHMnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmFiaWxpdHlNYW5hZ2VyJyk7XG5cbmludGVyZmFjZSBWYWxpZGF0aW9uRXJyb3Ige1xuICBmaWVsZDogc3RyaW5nO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBNT0RVTEUgU1RBVEVcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5sZXQgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCA9IG51bGw7XG5sZXQgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcbmxldCBiYWNrZW5kQ29uZmlncyA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnYmFja2VuZHMnIF1bIDAgXT4oKTtcbmxldCBpbnZvY2F0aW9uQ291bnQgPSAwO1xubGV0IGluaXRpYWxpemVkID0gZmFsc2U7XG5jb25zdCBzYW1wbGluZ1JlZ2V4Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUmVnRXhwPigpO1xuY29uc3QgcGVuZGluZ0Rpc3BhdGNoZXM6IFByb21pc2U8dm9pZD5bXSA9IFtdOyAvLyBUcmFjayBmaXJlLWFuZC1mb3JnZXQgcHJvbWlzZXMgZm9yIGZsdXNoKClcblxuLyoqXG4gKiBQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgLSBjYWxsYmFja3MgdGhhdCBydW4gYmVmb3JlIGJhY2tlbmRzIGFyZSBpbml0aWFsaXplZC5cbiAqIFVzZWQgdG8gcmVnaXN0ZXIgc2NoZW1hcy9zZXJ2aWNlcyBuZWVkZWQgYnkgYmFja2VuZHMgd2l0aG91dCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gKi9cbmNvbnN0IHByZUluaXRIb29rczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIEhFTFBFUiBGVU5DVElPTlNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5mdW5jdGlvbiB2YWxpZGF0ZUlucHV0KGlucHV0OiBDYXB0dXJlSW5wdXQpOiBWYWxpZGF0aW9uRXJyb3JbXSB7XG4gIGNvbnN0IGVycm9yczogVmFsaWRhdGlvbkVycm9yW10gPSBbXTtcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgaWYgKCFpbnB1dC50eXBlKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ3R5cGUnLCBtZXNzYWdlOiAndHlwZSBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmxldmVsKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ2xldmVsJywgbWVzc2FnZTogJ2xldmVsIGlzIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGlmICghaW5wdXQuY29ycmVsYXRpb25JZCAmJiAhY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgIGVycm9ycy5wdXNoKHtcbiAgICAgIGZpZWxkOiAnY29ycmVsYXRpb25JZCcsXG4gICAgICBtZXNzYWdlOiAnY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZC4gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzLCBvciB1c2UgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoKS4nXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuXG5mdW5jdGlvbiBhcHBseURhdGFQcm90ZWN0aW9uKFxuICBpbnB1dDogQ2FwdHVyZUlucHV0LFxuICBkYXRhUHJvdGVjdGlvbj86IE9ic2VydmFiaWxpdHlDb25maWdbICdkYXRhUHJvdGVjdGlvbicgXVxuKToge1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBlcnJvcj86IE9ic2VydmFiaWxpdHlFcnJvcjtcbn0ge1xuICBpZiAoIWRhdGFQcm90ZWN0aW9uPy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6IGlucHV0LmRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgICAgbWV0YWRhdGE6IGlucHV0Lm1ldGFkYXRhLFxuICAgICAgY29udGV4dDogaW5wdXQuY29udGV4dCxcbiAgICAgIGVycm9yOiBpbnB1dC5lcnJvcixcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZmllbGRzID0gZGF0YVByb3RlY3Rpb24uZmllbGRzID8/IFsgJ2RhdGEnLCAnYXR0cmlidXRlcycsICdtZXRhZGF0YScsICdjb250ZXh0JyBdO1xuXG4gIHJldHVybiB7XG4gICAgZGF0YTogZmllbGRzLmluY2x1ZGVzKCdkYXRhJykgJiYgaW5wdXQuZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5kYXRhLFxuICAgIGF0dHJpYnV0ZXM6IGZpZWxkcy5pbmNsdWRlcygnYXR0cmlidXRlcycpICYmIGlucHV0LmF0dHJpYnV0ZXNcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5hdHRyaWJ1dGVzLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuYXR0cmlidXRlcyxcbiAgICBtZXRhZGF0YTogZmllbGRzLmluY2x1ZGVzKCdtZXRhZGF0YScpICYmIGlucHV0Lm1ldGFkYXRhXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQubWV0YWRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5tZXRhZGF0YSxcbiAgICBjb250ZXh0OiBmaWVsZHMuaW5jbHVkZXMoJ2NvbnRleHQnKSAmJiBpbnB1dC5jb250ZXh0XG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuY29udGV4dCwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmNvbnRleHQsXG4gICAgZXJyb3I6IGZpZWxkcy5pbmNsdWRlcygnZXJyb3InKSAmJiBpbnB1dC5lcnJvclxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmVycm9yLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZXJyb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRXZlbnQoaW5wdXQ6IENhcHR1cmVJbnB1dCwgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+IHwgbnVsbCA9IG51bGwpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBjb25zdCBjdHggPSBjb250ZXh0ID8/IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG5cbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGlucHV0LmNvcnJlbGF0aW9uSWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgLSB0aGlzIHNob3VsZCBoYXZlIGJlZW4gY2F1Z2h0IGJ5IHZhbGlkYXRpb24nKTtcbiAgfVxuXG4gIGNvbnN0IHsgZGF0YSwgYXR0cmlidXRlcywgbWV0YWRhdGEsIGNvbnRleHQ6IGV2ZW50Q29udGV4dCwgZXJyb3IgfSA9IGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gICAgaW5wdXQsXG4gICAgY29uZmlnPy5kYXRhUHJvdGVjdGlvblxuICApO1xuXG4gIC8vIE9wZXJhdGlvbiBub3JtYWxpemF0aW9uIChyZWR1Y2UgY2FyZGluYWxpdHkgKyBpbXByb3ZlIGNyb3NzLWJhY2tlbmQgY29uc2lzdGVuY3kpXG4gIGNvbnN0IG9wTm9ybSA9IGNvbmZpZz8ub3BlcmF0aW9uTm9ybWFsaXphdGlvbjtcbiAgbGV0IG9wZXJhdGlvbiA9IGlucHV0Lm9wZXJhdGlvbjtcbiAgbGV0IG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKG9wTm9ybT8uZW5hYmxlZCAmJiBvcGVyYXRpb24pIHtcbiAgICBjb25zdCBvcmlnaW5hbE9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICBjb25zdCBhcHBsaWVkUnVsZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgZnJvbTogc3RyaW5nOyB0bzogc3RyaW5nOyByZWFzb24/OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCB0eXBlTWF0Y2ggPSAoXG4gICAgICBydWxlVHlwZXM6IE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdWyAncnVsZXMnIF1bIG51bWJlciBdWyAndHlwZXMnIF0gfCB1bmRlZmluZWQsXG4gICAgICBldmVudFR5cGU6IHN0cmluZ1xuICAgICkgPT4ge1xuICAgICAgaWYgKCFydWxlVHlwZXMpIHJldHVybiB0cnVlO1xuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShydWxlVHlwZXMpID8gcnVsZVR5cGVzIDogWyBydWxlVHlwZXMgXTtcbiAgICAgIC8vIENvbXBhcmUgYnkgc3RyaW5nIHRvIGF2b2lkIHVuc2FmZSBjYXN0aW5nIChPYnNlcnZhYmlsaXR5RXZlbnRUeXBlIGlzIHN0cmluZy1iYXNlZCBhbnl3YXkpLlxuICAgICAgcmV0dXJuIGFyci5tYXAoU3RyaW5nKS5pbmNsdWRlcyhldmVudFR5cGUpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2Ygb3BOb3JtLnJ1bGVzID8/IFtdKSB7XG4gICAgICBpZiAoIXR5cGVNYXRjaChydWxlLnR5cGVzLCBpbnB1dC50eXBlKSkgY29udGludWU7XG4gICAgICBpZiAoIW1hdGNoZXNQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgbmV4dCA9IHJlcGxhY2VQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCwgcnVsZS5yZXBsYWNlKTtcbiAgICAgIGlmIChuZXh0ICE9PSBvcGVyYXRpb24pIHtcbiAgICAgICAgYXBwbGllZFJ1bGVzLnB1c2goeyBpZDogcnVsZS5pZCwgZnJvbTogb3BlcmF0aW9uLCB0bzogbmV4dCwgcmVhc29uOiBydWxlLnJlYXNvbiB9KTtcbiAgICAgICAgb3BlcmF0aW9uID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPbmx5IGF0dGFjaCBtZXRhIGlmIHRoZSBvcGVyYXRpb24gYWN0dWFsbHkgY2hhbmdlZFxuICAgIGlmIChvcE5vcm0uc3RvcmVPcmlnaW5hbCAhPT0gZmFsc2UgJiYgb3BlcmF0aW9uICE9PSBvcmlnaW5hbE9wZXJhdGlvbikge1xuICAgICAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgPSB7XG4gICAgICAgIGZyb206IG9yaWdpbmFsT3BlcmF0aW9uLFxuICAgICAgICB0bzogb3BlcmF0aW9uLFxuICAgICAgICBydWxlSWRzOiBhcHBsaWVkUnVsZXMubWFwKHIgPT4gci5pZCksXG4gICAgICAgIHJ1bGVzOiBhcHBsaWVkUnVsZXMsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICBsZXZlbDogaW5wdXQubGV2ZWwsXG4gICAgY29ycmVsYXRpb25JZCxcbiAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gbm93LFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkKGNvcnJlbGF0aW9uSWQpLFxuICAgIC8vIG51bGwgPSBleHBsaWNpdGx5IG5vIHBhcmVudCAtIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBzaG91bGQgYmUgcmVzb2x2ZWQgYnkgY2FsbGVyIChzcGFuIHRyZWUpXG4gICAgLy8gdW5kZWZpbmVkID0gdXNlIHdoYXQgd2FzIHByb3ZpZGVkXG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgY2F1c2VkQnk6IGlucHV0LmNhdXNlZEJ5LFxuICAgIHJlbGF0ZWRUcmFjZXM6IGlucHV0LnJlbGF0ZWRUcmFjZXMsXG4gICAgYWN0b3I6IGlucHV0LmFjdG9yID8/IGN0eD8uYWN0b3IsXG4gICAgc291cmNlOiBpbnB1dC5zb3VyY2UgPz8gY3R4Py5vYnNlcnZhYmlsaXR5Py5zb3VyY2UgPz8gZGV0ZWN0U291cmNlKCksXG4gICAgdGFnczogbWVyZ2VUYWdzKHsgLi4uY3R4Py5vYnNlcnZhYmlsaXR5Py50YWdzLCAuLi5pbnB1dC50YWdzIH0sIHRydWUpLFxuICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgZW50aXR5SWQ6IGlucHV0LmVudGl0eUlkLFxuICAgIG9wZXJhdGlvbixcbiAgICBzdWJUeXBlOiBpbnB1dC5zdWJUeXBlLFxuICAgIHN0YXR1czogaW5wdXQuc3RhdHVzLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NczogaW5wdXQuZHVyYXRpb25NcyxcbiAgICBkYXRhOiBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YVxuICAgICAgPyB7IC4uLihkYXRhID8/IHt9KSwgb3BlcmF0aW9uTm9ybWFsaXphdGlvbjogb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgfVxuICAgICAgOiBkYXRhLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGEsXG4gICAgbWV0cmljczogaW5wdXQubWV0cmljcyxcbiAgICBjb250ZXh0OiBldmVudENvbnRleHQsXG4gICAgZXJyb3IsXG4gICAgY2FwdHVyZTogaW5wdXQuY2FwdHVyZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXRlZ29yaXplIGV2ZW50IHR5cGUgZm9yIGJhY2tlbmQgcm91dGluZyBhbmQgc2FtcGxpbmdcbiAqIFxuICogQ3VzdG9tIGV2ZW50IHR5cGVzIGFyZSBzdXBwb3J0ZWQhIFVzZSBhbnkgbmFtaW5nIGNvbnZlbnRpb246XG4gKiAtICdidXNpbmVzcy5vcmRlcl9wbGFjZWQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAncGF5bWVudC50cmFuc2FjdGlvbicg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiAtICdub3RpZmljYXRpb24uc2VudCcg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiBcbiAqIFRvIGNvbnRyb2wgYmFja2VuZCByb3V0aW5nIGZvciBjdXN0b20gdHlwZXMsIHVzZSB0eXBlLXNwZWNpZmljIGNvbmZpZzpcbiAqIGBgYFxuICogb2JzZXJ2YWJpbGl0eToge1xuICogICB0eXBlczoge1xuICogICAgIGxvZzogeyBiYWNrZW5kczogWydjbG91ZHdhdGNoJywgJ2R5bmFtb2RiJ10gfVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZnVuY3Rpb24gZ2V0VHlwZUNhdGVnb3J5KHR5cGU6IHN0cmluZyk6ICdzcGFuJyB8ICdtZXRyaWMnIHwgJ2F1ZGl0JyB8ICdsb2cnIHtcbiAgLy8gJ3NwYW4nID0gY29uc29saWRhdGVkIHNwYW4gcmVjb3JkLCAnc3Bhbi5zdGFydCcgPSBPVEVMLW9ubHkgc3RhcnQgbWFya2VyLlxuICAvLyBGVzI0IGRvZXMgTk9UIHN1cHBvcnQgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cyAobm8gY29tcGF0aWJpbGl0eSBndWFyYW50ZWVzKS5cbiAgaWYgKHR5cGUgPT09ICdzcGFuJyB8fCB0eXBlID09PSAnc3Bhbi5zdGFydCcpIHJldHVybiAnc3Bhbic7XG4gIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgLy8gQWxsIGN1c3RvbSBldmVudCB0eXBlcyBkZWZhdWx0IHRvICdsb2cnIGNhdGVnb3J5XG4gIC8vIFRoaXMgaW5jbHVkZXM6ICdidXNpbmVzcy4qJywgJ3BheW1lbnQuKicsICdub3RpZmljYXRpb24uKicsIGV0Yy5cbiAgcmV0dXJuICdsb2cnO1xufVxuXG5mdW5jdGlvbiBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgaWYgKHR5cGVDb25maWc/LmJhY2tlbmRzICYmIHR5cGVDb25maWcuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSk7XG4gIH1cblxuICByZXR1cm4gYmFja2VuZHM7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYmFja2VuZCBzaG91bGQgY2FwdHVyZSB0aGlzIGV2ZW50IGJhc2VkIG9uIHR5cGUgZmlsdGVyaW5nXG4gKi9cbmZ1bmN0aW9uIHNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShcbiAgYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnRcbik6IGJvb2xlYW4ge1xuICAvLyBQZXItZXZlbnQgYmFja2VuZCBmaWx0ZXIgKHVzZWQgZm9yIE9URUwgc3BhbiB0cmFja2luZyBpbiBjb25zb2xpZGF0ZWQgbW9kZSlcbiAgaWYgKGV2ZW50LmNhcHR1cmU/LmJhY2tlbmRzICYmIGV2ZW50LmNhcHR1cmUuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIGlmICghZXZlbnQuY2FwdHVyZS5iYWNrZW5kcy5pbmNsdWRlcyhiYWNrZW5kLm5hbWUgYXMgJ2Nsb3Vkd2F0Y2gnIHwgJ2R5bmFtb2RiJyB8ICdvdGVsJykpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBiYWNrZW5kQ2ZnID0gYmFja2VuZENvbmZpZ3MuZ2V0KGJhY2tlbmQubmFtZSk7XG4gIGlmICghYmFja2VuZENmZykgcmV0dXJuIHRydWU7IC8vIE5vIGNvbmZpZyA9IGFsbG93IGFsbFxuXG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgdHlwZUZpbHRlciA9IGJhY2tlbmRDZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgLy8gQ2hlY2sgaWYgdHlwZSBpcyBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIGJhY2tlbmRcbiAgaWYgKHR5cGVGaWx0ZXI/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIENoZWNrIHBlci10eXBlIG1pbkxldmVsIChvdmVycmlkZXMgYmFja2VuZC1sZXZlbCBtaW5MZXZlbClcbiAgaWYgKHR5cGVGaWx0ZXI/Lm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnRMZXZlbCA8IHR5cGVGaWx0ZXIubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoYmFja2VuZC5taW5MZXZlbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gRmFsbCBiYWNrIHRvIGJhY2tlbmQtbGV2ZWwgbWluTGV2ZWxcbiAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBDaGVjayBwZXItdHlwZSBzYW1wbGluZ1xuICBpZiAodHlwZUZpbHRlcj8uc2FtcGxpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUZpbHRlci5zYW1wbGluZztcbiAgfVxuXG4gIHJldHVybiB0cnVlOyAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbn1cblxuLyoqXG4gKiBBcHBseSB0YWcgZmlsdGVyaW5nIHRvIGV2ZW50IGJlZm9yZSBzZW5kaW5nIHRvIGJhY2tlbmRzLlxuICogRmlsdGVycyBmcmFtZXdvcmsgdGFncyBiYXNlZCBvbiBjb25maWcsIGFkZHMgY3VzdG9tIHRhZ3MsIGVuZm9yY2VzIG1heFRhZ3MgbGltaXQuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBpZiAoIWNvbmZpZz8udGFnRmlsdGVyaW5nKSByZXR1cm4gZXZlbnQ7XG5cbiAgY29uc3QgdGFnQ29uZmlnID0gY29uZmlnLnRhZ0ZpbHRlcmluZztcbiAgY29uc3QgaW5jbHVkZSA9IHRhZ0NvbmZpZy5pbmNsdWRlO1xuICBjb25zdCBtYXhUYWdzID0gdGFnQ29uZmlnLm1heFRhZ3MgPz8gMTA7XG5cbiAgLy8gS25vd24gZnJhbWV3b3JrIHRhZ3NcbiAgY29uc3QgZnJhbWV3b3JrVGFncyA9IG5ldyBTZXQoW1xuICAgICdzdGFnZScsICd0ZW5hbnRJZCcsICdvcGVyYXRpb25DYXRlZ29yeScsICdhdXRoTWV0aG9kJyxcbiAgICAnYWN0b3JUeXBlJywgJ2hhbmRsZXJUeXBlJywgJ2VudGl0eU5hbWUnLCAnb3BlcmF0aW9uJ1xuICBdKTtcblxuICBjb25zdCBmaWx0ZXJlZFRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgbGV0IHRhZ0NvdW50ID0gMDtcblxuICAvLyBGaWx0ZXIgZXhpc3RpbmcgdGFnc1xuICBpZiAoZXZlbnQudGFncykge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQudGFncykpIHtcbiAgICAgIGlmICh0YWdDb3VudCA+PSBtYXhUYWdzKSBicmVhaztcblxuICAgICAgLy8gRnJhbWV3b3JrIHRhZ3M6IG11c3QgYmUgaW4gaW5jbHVkZSBhcnJheVxuICAgICAgaWYgKGZyYW1ld29ya1RhZ3MuaGFzKGtleSkpIHtcbiAgICAgICAgaWYgKGluY2x1ZGUgJiYgIWluY2x1ZGUuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgIGNvbnRpbnVlOyAvLyBFeGNsdWRlZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBVbmtub3duIHRhZ3MgKGN1c3RvbSk6IGFsd2F5cyBpbmNsdWRlXG5cbiAgICAgIC8vIENvbnZlcnQgdG8gc3RyaW5nXG4gICAgICBmaWx0ZXJlZFRhZ3NbIGtleSBdID0gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IHZhbHVlIDogU3RyaW5nKHZhbHVlKTtcbiAgICAgIHRhZ0NvdW50Kys7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGN1c3RvbSB0YWdzIGZyb20gY29uZmlnXG4gIGlmICh0YWdDb25maWcuY3VzdG9tICYmIHRhZ0NvdW50IDwgbWF4VGFncykge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlRm4gXSBvZiBPYmplY3QuZW50cmllcyh0YWdDb25maWcuY3VzdG9tKSkge1xuICAgICAgaWYgKHRhZ0NvdW50ID49IG1heFRhZ3MpIGJyZWFrO1xuICAgICAgaWYgKGZpbHRlcmVkVGFnc1sga2V5IF0gIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIEFscmVhZHkgZXhpc3RzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVGbihldmVudCk7XG4gICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgIGZpbHRlcmVkVGFnc1sga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICB0YWdDb3VudCsrO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIud2FybihgRmFpbGVkIHRvIGV2YWx1YXRlIGN1c3RvbSB0YWcgJHtrZXl9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIC4uLmV2ZW50LFxuICAgIHRhZ3M6IGZpbHRlcmVkVGFncyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogdm9pZCB7XG4gIC8vIEFwcGx5IHRhZyBmaWx0ZXJpbmcgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHNcbiAgY29uc3QgZmlsdGVyZWRFdmVudCA9IGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50KTtcblxuICBjb25zdCBwcm9taXNlID0gUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBmaWx0ZXJlZEV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlsdGVyZWRFdmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKS50aGVuKCgpID0+IHsgfSk7IC8vIENvbnZlcnQgdG8gUHJvbWlzZTx2b2lkPlxuXG4gIC8vIFRyYWNrIHByb21pc2Ugc28gZmx1c2goKSBjYW4gd2FpdCBmb3IgaXRcbiAgcGVuZGluZ0Rpc3BhdGNoZXMucHVzaChwcm9taXNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCB0YXJnZXRCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSk6IFByb21pc2U8dm9pZD4ge1xuICAvLyBBcHBseSB0YWcgZmlsdGVyaW5nIGJlZm9yZSBzZW5kaW5nIHRvIGJhY2tlbmRzXG4gIGNvbnN0IGZpbHRlcmVkRXZlbnQgPSBhcHBseVRhZ0ZpbHRlcmluZyhldmVudCk7XG5cbiAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBmaWx0ZXJlZEV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlsdGVyZWRFdmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZW5mb3JjZUhpZXJhcmNoeUludGVncml0eU9yRHJvcChcbiAgZXZlbnRzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSxcbiAgY3R4Q29ycmVsYXRpb25JZDogc3RyaW5nLFxuKTogT2JzZXJ2YWJpbGl0eUV2ZW50W10ge1xuICAvLyBDT05UUkFDVDogcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHNob3VsZCBPTkxZIHJlZmVyZW5jZSBzcGFucyBpbiBUSElTIHNsaWNlIChzYW1lIGNvcnJlbGF0aW9uSWQpLlxuICAvLyBDcm9zcy1pbnZvY2F0aW9uIGxpbmthZ2Ugc2hvdWxkIHVzZSBjYXVzZWRCeSwgbm90IHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZC5cbiAgLy9cbiAgLy8gSG93ZXZlciwgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgYW5kIGdyYWNlZnVsIGRlZ3JhZGF0aW9uOlxuICAvLyAtIElmIGEgcGFyZW50IGlzIHJlZmVyZW5jZWQgYnV0IE5PVCBpbiB0aGlzIGJhdGNoIChjcm9zcy1zbGljZSByZWZlcmVuY2UpLCB3ZSBLRUVQIHRoZSBldmVudFxuICAvLyAgIGJ1dCB0aGUgcGFyZW50IGxpbmsgd2lsbCBiZSBzdGFsZS91bnJlc29sdmFibGUgaW4gdGhlIFVJLiBUaGlzIGlzIHN1Ym9wdGltYWwgYnV0IG5vdCBmYXRhbC5cbiAgLy8gLSBJZiBhIHBhcmVudCBpcyByZWZlcmVuY2VkIGFuZCBzaG91bGQgYmUgaW4gdGhpcyBiYXRjaCBidXQgaXMgbWlzc2luZyAobm9pc2UgcmVkdWN0aW9uIGJ1ZyksXG4gIC8vICAgd2UgRFJPUCB0aGUgZXZlbnQgYW5kIGVtaXQgYW4gZXJyb3IuXG4gIC8vXG4gIC8vIE9ubHkgZHJvcCBjYXNlICMyICh0cnVseSBtaXNzaW5nKSwgdG9sZXJhdGUgY2FzZSAjMSAoY3Jvc3Mtc2xpY2UpLlxuICBjb25zdCBncmFwaCA9IGJ1aWxkVHJhY2VHcmFwaChldmVudHMsIHsgc3RyaWN0UGFyZW50czogZmFsc2UgfSk7XG4gIGlmIChncmFwaC5taXNzaW5nUGFyZW50U3Bhbklkcy5zaXplID09PSAwKSByZXR1cm4gZXZlbnRzO1xuXG4gIGNvbnN0IG1pc3NpbmcgPSBncmFwaC5taXNzaW5nUGFyZW50U3BhbklkcztcbiAgY29uc3QgY3Jvc3NTbGljZSA9IGdyYXBoLmNyb3NzU2xpY2VQYXJlbnRTcGFuSWRzO1xuICBjb25zdCBmaWx0ZXJlZCA9IGV2ZW50cy5maWx0ZXIoKGUpID0+IHtcbiAgICBjb25zdCBwaWQgPSBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyB1bmRlZmluZWQ7XG4gICAgLy8gT05MWSBkcm9wIGlmIHBhcmVudCBpcyB0cnVseSBtaXNzaW5nIChub3QganVzdCBpbiBhIGRpZmZlcmVudCBzbGljZSlcbiAgICByZXR1cm4gIShwaWQgJiYgbWlzc2luZy5oYXMocGlkKSk7XG4gIH0pO1xuXG4gIGNvbnN0IGRyb3BwZWRDb3VudCA9IGV2ZW50cy5sZW5ndGggLSBmaWx0ZXJlZC5sZW5ndGg7XG5cbiAgaWYgKGRyb3BwZWRDb3VudCA+IDApIHtcbiAgICAvLyBPbmx5IGVtaXQgZXJyb3IgaWYgd2UgYWN0dWFsbHkgZHJvcHBlZCBldmVudHNcbiAgICBmaWx0ZXJlZC5wdXNoKHtcbiAgICAgIHR5cGU6ICdsb2cnLFxuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBjb3JyZWxhdGlvbklkOiBjdHhDb3JyZWxhdGlvbklkLFxuICAgICAgdGltZXN0YW1wTXM6IERhdGUubm93KCksXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkKGN0eENvcnJlbGF0aW9uSWQpLFxuICAgICAgb3BlcmF0aW9uOiAnb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW4nLFxuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBjYXB0dXJlOiB7IGJ5cGFzczogdHJ1ZSB9LFxuICAgICAgZGF0YToge1xuICAgICAgICBkcm9wcGVkQ291bnQsXG4gICAgICAgIG1pc3NpbmdQYXJlbnRTcGFuSWRzOiBBcnJheS5mcm9tKG1pc3NpbmcpLnNsaWNlKDAsIDEwKSxcbiAgICAgICAgLy8gSW5jbHVkZSBjcm9zcy1zbGljZSBpbmZvIGZvciBkZWJ1Z2dpbmcgKHRoZXNlIGFyZSB2YWxpZCwgbm90IGVycm9ycylcbiAgICAgICAgY3Jvc3NTbGljZVBhcmVudENvdW50OiBjcm9zc1NsaWNlLnNpemUsXG4gICAgICB9LFxuICAgICAgc291cmNlOiAnT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2gnLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGZpbHRlcmVkO1xufVxuXG5mdW5jdGlvbiBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZTogJ3NwYW4nIHwgJ21ldHJpYycgfCAnYXVkaXQnIHwgJ2xvZycpOiBPYnNlcnZhYmlsaXR5TGV2ZWwge1xuICBjb25zdCB0eXBlQ29uZmlnID0gY29uZmlnPy50eXBlcz8uWyB0eXBlIF07XG4gIHJldHVybiB0eXBlQ29uZmlnPy5taW5MZXZlbCA/PyBjb25maWc/Lm1pbkxldmVsID8/IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGFuIGV2ZW50IG1hdGNoZXMgYSBzYW1wbGluZyBydWxlXG4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNSdWxlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHJ1bGU6IFNhbXBsaW5nUnVsZSk6IGJvb2xlYW4ge1xuICBjb25zdCB7IHRhcmdldCwgcGF0dGVybiB9ID0gcnVsZTtcblxuICBsZXQgdmFsdWVUb01hdGNoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgc3dpdGNoICh0YXJnZXQpIHtcbiAgICBjYXNlICd0ZW5hbnQnOlxuICAgICAgLy8gQ2hlY2sgYWN0b3IudGVuYW50SWQgb3IgdGFncy50ZW5hbnRJZFxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LnRlbmFudElkID8/IGV2ZW50LnRhZ3M/LnRlbmFudElkO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdyb3V0ZSc6XG4gICAgICAvLyBDaGVjayBzb3VyY2UgKGUuZy4sIFwiT3JkZXJDb250cm9sbGVyLmNyZWF0ZVwiKSBvciBvcGVyYXRpb25cbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZSA/PyBldmVudC5vcGVyYXRpb247XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3RhZyc6XG4gICAgICAvLyBQYXR0ZXJuIGZvcm1hdDogXCJrZXk6dmFsdWVcIiBvciBcImtleToqXCJcbiAgICAgIGlmICh0eXBlb2YgcGF0dGVybiA9PT0gJ3N0cmluZycgJiYgcGF0dGVybi5pbmNsdWRlcygnOicpKSB7XG4gICAgICAgIGNvbnN0IFsga2V5LCB2YWx1ZVBhdHRlcm4gXSA9IHBhdHRlcm4uc3BsaXQoJzonLCAyKTtcbiAgICAgICAgY29uc3QgdGFnVmFsdWUgPSBldmVudC50YWdzPy5bIGtleSBdO1xuICAgICAgICBpZiAoIXRhZ1ZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgaWYgKHZhbHVlUGF0dGVybiA9PT0gJyonKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgICAvLyBUZXN0IGFnYWluc3QgdmFsdWUgcGF0dGVybiAoc3VwcG9ydHMgd2lsZGNhcmRzKVxuICAgICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleCh2YWx1ZVBhdHRlcm4pO1xuICAgICAgICByZXR1cm4gcmVnZXgudGVzdCh0YWdWYWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICBjYXNlICdhY3Rvcic6XG4gICAgICAvLyBDaGVjayBhY3RvcklkIG9yIGFjdG9yVHlwZVxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LmFjdG9ySWQgPz8gZXZlbnQuYWN0b3I/LmFjdG9yVHlwZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnc291cmNlJzpcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICghdmFsdWVUb01hdGNoKSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gTWF0Y2ggYWdhaW5zdCBwYXR0ZXJuIChzdHJpbmcgb3IgUmVnRXhwKVxuICBpZiAocGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgIHJldHVybiBwYXR0ZXJuLnRlc3QodmFsdWVUb01hdGNoKTtcbiAgfVxuXG4gIC8vIFN0cmluZyBwYXR0ZXJuIHdpdGggd2lsZGNhcmQgc3VwcG9ydFxuICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgcmV0dXJuIHJlZ2V4LnRlc3QodmFsdWVUb01hdGNoKTtcbn1cblxuLyoqXG4gKiBDb250ZW50LWJhc2VkIGZpbHRlcmluZyAtIEFMV0FZUyBydW5zIHJlZ2FyZGxlc3Mgb2Ygc2FtcGxpbmcuZW5hYmxlZFxuICogUmV0dXJucyB0cnVlIGlmIGV2ZW50IHBhc3NlcyBmaWx0ZXJpbmcgcnVsZXMgKGJ5cGFzcywgbGV2ZWwsIGR1cmF0aW9uLCBldGMuKVxuICogUmV0dXJucyBmYWxzZSBpZiBldmVudCBzaG91bGQgYmUgZmlsdGVyZWQgb3V0LlxuICovXG5mdW5jdGlvbiBzaG91bGRGaWx0ZXIoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgb3B0aW9ucz86IHtcbiAgICAvKipcbiAgICAgKiBXaGVuIHRydWUsIHNwYW5zIG1heSBiZSBkcm9wcGVkIGJhc2VkIG9uIGNmZy5zcGFucy5taW5EdXJhdGlvbk1zLlxuICAgICAqIFdoZW4gZmFsc2UsIHNwYW5zIGFyZSBhbHdheXMga2VwdCAobmVlZGVkIHdoZW4gd2UgY2Fubm90IHNlZSB0aGUgZnVsbCBwYXJlbnQvY2hpbGQgZ3JhcGgpLlxuICAgICAqL1xuICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcD86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogUGFyZW50IHNwYW4gSURzIHJlZmVyZW5jZWQgYnkgYnVmZmVyZWQgZXZlbnRzLlxuICAgICAqIElmIGEgc3BhbiBpcyByZWZlcmVuY2VkIGhlcmUsIGl0IG11c3QgTkVWRVIgYmUgZHJvcHBlZC5cbiAgICAgKi9cbiAgICByZWZlcmVuY2VkUGFyZW50U3Bhbklkcz86IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIH1cbik6IGJvb2xlYW4ge1xuICBjb25zdCBsZXZlbFZhbHVlID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgZWZmZWN0aXZlTGV2ZWwgPSBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZUNhdGVnb3J5KTtcbiAgY29uc3QgY2FwdHVyZSA9IGV2ZW50LmNhcHR1cmU7XG4gIGNvbnN0IGlzU3BhblJlY29yZCA9IGV2ZW50LnR5cGUgPT09ICdzcGFuJztcbiAgY29uc3QgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wID0gb3B0aW9ucz8uYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wID09PSB0cnVlO1xuICBjb25zdCByZWZlcmVuY2VkUGFyZW50U3BhbklkcyA9IG9wdGlvbnM/LnJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzO1xuXG4gIC8vID09PSBCWVBBU1MgRklMVEVSUyAoYWx3YXlzIHBhc3MpID09PVxuXG4gIC8vIDEuIEV4cGxpY2l0IGJ5cGFzcyBmbGFnXG4gIGlmIChjYXB0dXJlPy5ieXBhc3MpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIDIuIENSSVRJQ0FMIGxvZyBsZXZlbCBhbHdheXMgcGFzc2VzXG4gIGlmIChsZXZlbFZhbHVlID09PSBPYnNlcnZhYmlsaXR5TGV2ZWwuQ1JJVElDQUwpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIDMuIEVycm9ycyBhbHdheXMgcGFzc1xuICBpZiAoZXZlbnQuZXJyb3IgfHwgZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vID09PSBTUEFOLVNQRUNJRklDIEZJTFRFUklORyA9PT1cbiAgaWYgKGlzU3BhblJlY29yZCkge1xuICAgIC8vIFJlZmVyZW5jZWQgcGFyZW50cyBtdXN0IGJlIGtlcHQgZm9yIGhpZXJhcmNoeSBpbnRlZ3JpdHlcbiAgICBjb25zdCBpZCA9IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICBpZiAoaWQgJiYgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHM/LmhhcyhpZCkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIEZpbHRlciBvdXQgZmFzdCBzcGFucyBpZiBjb25maWd1cmVkXG4gICAgaWYgKGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCAmJiBldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IG1pbkR1cmF0aW9uID0gY2FwdHVyZT8ubWluRHVyYXRpb25NcyA/PyBjZmcuc3BhbnMubWluRHVyYXRpb25NcztcbiAgICAgIGlmIChtaW5EdXJhdGlvbiA+IDAgJiYgZXZlbnQuZHVyYXRpb25NcyA8IG1pbkR1cmF0aW9uKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTsgLy8gVG9vIGZhc3QsIGZpbHRlciBvdXRcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyA9PT0gTk9OLVNQQU4gRFVSQVRJT04gRklMVEVSSU5HID09PVxuICBpZiAoIWlzU3BhblJlY29yZCAmJiBjYXB0dXJlPy5taW5EdXJhdGlvbk1zICE9PSB1bmRlZmluZWQgJiYgZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgPCBjYXB0dXJlLm1pbkR1cmF0aW9uTXMpIHtcbiAgICAgIHJldHVybiBmYWxzZTsgLy8gQmVsb3cgdGhyZXNob2xkLCBmaWx0ZXIgb3V0XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IExFVkVMIEZJTFRFUklORyA9PT1cbiAgLy8gUkVNT1ZFRDogTWFuYWdlciBubyBsb25nZXIgZmlsdGVycyBieSBtaW5MZXZlbFxuICAvLyBBbGwgbGV2ZWwtYmFzZWQgZmlsdGVyaW5nIGhhcHBlbnMgaW4gbm9pc2UgcmVkdWN0aW9uIGZvciBjb250ZXh0LWF3YXJlIGRlY2lzaW9uc1xuXG4gIC8vIFBhc3NlZCBhbGwgZmlsdGVyc1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBQcm9iYWJpbGlzdGljIHNhbXBsaW5nIC0gT05MWSBydW5zIHdoZW4gc2FtcGxpbmcuZW5hYmxlZD10cnVlXG4gKiBSZXR1cm5zIHRydWUgaWYgZXZlbnQgc2hvdWxkIGJlIHNhbXBsZWQgKGtlcHQpLCBmYWxzZSBpZiBzYW1wbGVkIG91dCAoZHJvcHBlZClcbiAqL1xuZnVuY3Rpb24gc2hvdWxkU2FtcGxlKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjZmc6IE9ic2VydmFiaWxpdHlDb25maWdcbik6IGJvb2xlYW4ge1xuICBjb25zdCBsZXZlbFZhbHVlID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgY2FwdHVyZSA9IGV2ZW50LmNhcHR1cmU7XG5cbiAgLy8gPT09IEdST1VQLUJBU0VEIFNBTVBMSU5HIChiYXRjaCBzY2VuYXJpb3MpID09PVxuICBpZiAoY2FwdHVyZT8uZ3JvdXApIHtcbiAgICBjb25zdCB7IGluZGV4LCBjYXB0dXJlRmlyc3QgPSAzLCBzYW1wbGVSYXRlID0gMC4xIH0gPSBjYXB0dXJlLmdyb3VwO1xuXG4gICAgLy8gQ2FwdHVyZSBmaXJzdCBOIGl0ZW1zXG4gICAgaWYgKGluZGV4IDwgY2FwdHVyZUZpcnN0KSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBTYW1wbGUgdGhlIHJlc3QgcHJvYmFiaWxpc3RpY2FsbHlcbiAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHNhbXBsZVJhdGU7XG4gIH1cblxuICAvLyA9PT0gUlVMRS1CQVNFRCBTQU1QTElORyAoSGlnaGVzdCBQcmlvcml0eSkgPT09XG4gIGlmIChjZmcuc2FtcGxpbmc/LnJ1bGVzICYmIGNmZy5zYW1wbGluZy5ydWxlcy5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBydWxlIG9mIGNmZy5zYW1wbGluZy5ydWxlcykge1xuICAgICAgaWYgKG1hdGNoZXNSdWxlKGV2ZW50LCBydWxlKSkge1xuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJ1bGUucmF0ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyA9PT0gVFlQRS1TUEVDSUZJQyBTQU1QTElORyA9PT1cbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNmZy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcbiAgaWYgKHR5cGVDb25maWc/LnNhbXBsaW5nPy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCB0eXBlQ29uZmlnLnNhbXBsaW5nLnJhdGU7XG4gIH1cblxuICAvLyA9PT0gT1BFUkFUSU9OLUJBU0VEIFNBTVBMSU5HID09PVxuICBpZiAoZXZlbnQub3BlcmF0aW9uICYmIGNmZy5zYW1wbGluZz8ub3BlcmF0aW9ucykge1xuICAgIGZvciAoY29uc3QgWyBwYXR0ZXJuLCByYXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY2ZnLnNhbXBsaW5nLm9wZXJhdGlvbnMpKSB7XG4gICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgICAgIGlmIChyZWdleC50ZXN0KGV2ZW50Lm9wZXJhdGlvbikpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBMRVZFTC1CQVNFRCBTQU1QTElORyAoRmFsbGJhY2spID09PVxuICBjb25zdCBsZXZlbE5hbWUgPSBsZXZlbFRvU3RyaW5nKGxldmVsVmFsdWUpO1xuICBjb25zdCByYXRlID0gY2ZnLnNhbXBsaW5nPy5yYXRlcz8uWyBsZXZlbE5hbWUgXTtcbiAgaWYgKHJhdGUgPT09IHVuZGVmaW5lZCB8fCByYXRlID49IDEpIHJldHVybiB0cnVlO1xuICBpZiAocmF0ZSA8PSAwKSByZXR1cm4gZmFsc2U7XG5cbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xufVxuXG5mdW5jdGlvbiBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgocGF0dGVybjogc3RyaW5nKTogUmVnRXhwIHtcbiAgY29uc3QgTUFYX1JFR0VYX0NBQ0hFX1NJWkUgPSAxMDA7XG5cbiAgbGV0IHJlZ2V4ID0gc2FtcGxpbmdSZWdleENhY2hlLmdldChwYXR0ZXJuKTtcbiAgaWYgKCFyZWdleCkge1xuICAgIC8vIEV2aWN0IG9sZGVzdCBlbnRyeSBpZiBjYWNoZSBpcyBmdWxsIChGSUZPIGV2aWN0aW9uKVxuICAgIGlmIChzYW1wbGluZ1JlZ2V4Q2FjaGUuc2l6ZSA+PSBNQVhfUkVHRVhfQ0FDSEVfU0laRSkge1xuICAgICAgY29uc3QgZmlyc3RLZXkgPSBzYW1wbGluZ1JlZ2V4Q2FjaGUua2V5cygpLm5leHQoKS52YWx1ZTtcbiAgICAgIGlmIChmaXJzdEtleSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNhbXBsaW5nUmVnZXhDYWNoZS5kZWxldGUoZmlyc3RLZXkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJlZ2V4ID0gbmV3IFJlZ0V4cChgXiR7cGF0dGVybi5yZXBsYWNlKC9cXCovZywgJy4qJyl9JGApO1xuICAgIHNhbXBsaW5nUmVnZXhDYWNoZS5zZXQocGF0dGVybiwgcmVnZXgpO1xuICB9XG4gIHJldHVybiByZWdleDtcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgcHJpb3JpdHkgZm9yIGJ1ZmZlciBldmljdGlvbi5cbiAqIEhpZ2hlciBwcmlvcml0eSA9IGtlZXAgaW4gYnVmZmVyXG4gKi9cbmZ1bmN0aW9uIGdldEV2ZW50UHJpb3JpdHkoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IG51bWJlciB7XG4gIC8vIEJ5cGFzcyBldmVudHMgTkVWRVIgZ2V0IGV2aWN0ZWQgKG1heCBwcmlvcml0eSlcbiAgaWYgKGV2ZW50LmNhcHR1cmU/LmJ5cGFzcykge1xuICAgIHJldHVybiBJbmZpbml0eTtcbiAgfVxuXG4gIC8vIFVzZSBleHBsaWNpdCBwcmlvcml0eSBpZiBwcm92aWRlZFxuICBsZXQgcHJpb3JpdHkgPSBldmVudC5jYXB0dXJlPy5wcmlvcml0eSA/PyAwO1xuXG4gIGNvbnN0IGxldmVsID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG5cbiAgLy8gSGlnaGVyIGxvZyBsZXZlbHMgPSBoaWdoZXIgcHJpb3JpdHlcbiAgcHJpb3JpdHkgKz0gbGV2ZWwgKiAxMDtcblxuICAvLyBBdWRpdCBldmVudHMgYXJlIGhpZ2ggcHJpb3JpdHlcbiAgaWYgKGV2ZW50LnR5cGUuc3RhcnRzV2l0aCgnYXVkaXQnKSkge1xuICAgIHByaW9yaXR5ICs9IDUwO1xuICB9XG5cbiAgLy8gU3BhbnMgd2l0aCBlcnJvcnMgYXJlIGhpZ2ggcHJpb3JpdHlcbiAgaWYgKGV2ZW50LnR5cGUuc3RhcnRzV2l0aCgnc3BhbicpICYmIGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgcHJpb3JpdHkgKz0gMzA7XG4gIH1cblxuICAvLyBMb25nIGR1cmF0aW9uIG9wZXJhdGlvbnMgYXJlIGludGVyZXN0aW5nXG4gIGlmIChldmVudC5kdXJhdGlvbk1zICYmIGV2ZW50LmR1cmF0aW9uTXMgPiAxMDAwKSB7XG4gICAgcHJpb3JpdHkgKz0gMjA7XG4gIH1cblxuICByZXR1cm4gcHJpb3JpdHk7XG59XG5cbi8qKlxuICogRXZpY3QgbG93ZXN0IHByaW9yaXR5IGV2ZW50IGZyb20gYnVmZmVyXG4gKiBSZXR1cm5zIG1ldGFkYXRhIGFib3V0IHRoZSBldmljdGVkIGV2ZW50IGZvciBsb2dnaW5nXG4gKi9cbmZ1bmN0aW9uIGV2aWN0TG93ZXN0UHJpb3JpdHkoXG4gIGJ1ZmZlcjogT2JzZXJ2YWJpbGl0eUV2ZW50W10sXG4gIG9wdGlvbnM/OiB7IGFsbG93RXZpY3RTcGFucz86IGJvb2xlYW4gfVxuKTogeyB0eXBlOiBzdHJpbmc7IGNvcnJlbGF0aW9uSWQ6IHN0cmluZzsgb3BlcmF0aW9uPzogc3RyaW5nOyBsZXZlbDogc3RyaW5nOyByZW1vdmVkQ291bnQ/OiBudW1iZXIgfSB8IG51bGwge1xuICBpZiAoYnVmZmVyLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWxsb3dFdmljdFNwYW5zID0gb3B0aW9ucz8uYWxsb3dFdmljdFNwYW5zID09PSB0cnVlO1xuXG4gIC8vIFNUUklDVCBUUkVFIEVWSUNUSU9OOlxuICAvLyBXaGVuIHRoZSBidWZmZXIgaXMgZnVsbCwgd2UgTVVTVCBOT1QgZXZpY3QgYSBwYXJlbnQgc3BhbiB3aGlsZSBrZWVwaW5nIGl0cyBjaGlsZHJlbixcbiAgLy8gb3RoZXJ3aXNlIGZsdXNoKCkgd2lsbCBlbWl0IGBvYnNlcnZhYmlsaXR5LmludmFyaWFudF92aW9sYXRpb24ubWlzc2luZ19wYXJlbnRfc3BhbmAuXG4gIC8vXG4gIC8vIFdlIHNvbHZlIHRoaXMgbGlrZSBhIHJlYWwgdHJlZSBwcm9ibGVtOlxuICAvLyAxKSBQcmVmZXIgZXZpY3RpbmcgXCJsZWFmXCIgZXZlbnRzOiBldmVudHMgdGhhdCBhcmUgTk9UIHJlZmVyZW5jZWQgYXMgYSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgYnkgYW55IG90aGVyIGJ1ZmZlcmVkIGV2ZW50LlxuICAvLyAyKSBQcmVmZXIgZXZpY3Rpbmcgbm9uLXNwYW4gbGVhdmVzIChsb2dzL21ldHJpY3MpIGJlZm9yZSBzcGFucy5cbiAgLy8gMykgSWYgbm8gbGVhdmVzIGV4aXN0IChyYXJlKSwgZXZpY3QgYW4gZXZlbnQgQU5EIGl0cyB3aG9sZSBkZXNjZW5kYW50IHN1YnRyZWUgc28gbm8gb3JwaGFucyByZW1haW4uXG5cbiAgY29uc3QgcmVmZXJlbmNlZEFzUGFyZW50ID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IGNoaWxkcmVuQnlQYXJlbnQgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUV2ZW50W10+KCk7XG4gIGZvciAoY29uc3QgZSBvZiBidWZmZXIpIHtcbiAgICBjb25zdCBwaWQgPSBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyB1bmRlZmluZWQ7XG4gICAgaWYgKHR5cGVvZiBwaWQgPT09ICdzdHJpbmcnICYmIHBpZC5sZW5ndGggPiAwKSB7XG4gICAgICByZWZlcmVuY2VkQXNQYXJlbnQuYWRkKHBpZCk7XG4gICAgICBjb25zdCBhcnIgPSBjaGlsZHJlbkJ5UGFyZW50LmdldChwaWQpO1xuICAgICAgaWYgKGFycikgYXJyLnB1c2goZSk7XG4gICAgICBlbHNlIGNoaWxkcmVuQnlQYXJlbnQuc2V0KHBpZCwgWyBlIF0pO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGlzU3BhbiA9IChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUudHlwZSA9PT0gJ3NwYW4nIHx8IGUudHlwZSA9PT0gJ3NwYW4uc3RhcnQnO1xuICBjb25zdCBnZXRJZCA9IChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IGUub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICBjb25zdCBpc0xlYWYgPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiB7XG4gICAgY29uc3QgaWQgPSBnZXRJZChlKTtcbiAgICBpZiAoIWlkKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gIXJlZmVyZW5jZWRBc1BhcmVudC5oYXMoaWQpO1xuICB9O1xuXG4gIGNvbnN0IHBpY2tMb3dlc3QgPSAoY2FuZGlkYXRlczogT2JzZXJ2YWJpbGl0eUV2ZW50W10pID0+IHtcbiAgICBsZXQgaWR4ID0gLTE7XG4gICAgbGV0IGxvd2VzdCA9IEluZmluaXR5O1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2FuZGlkYXRlcy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgcCA9IGdldEV2ZW50UHJpb3JpdHkoY2FuZGlkYXRlc1sgaSBdKTtcbiAgICAgIGlmIChwIDwgbG93ZXN0KSB7XG4gICAgICAgIGxvd2VzdCA9IHA7XG4gICAgICAgIGlkeCA9IGk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBpZHg7XG4gIH07XG5cbiAgLy8gSWYgc3BhbnMgYXJlIG5vdCBhbGxvd2VkIHRvIGJlIGV2aWN0ZWQsIGNvbnN0cmFpbiBjYW5kaWRhdGVzIHRvIG5vbi1zcGFuIGV2ZW50cyBvbmx5LlxuICBjb25zdCBub25TcGFucyA9IGJ1ZmZlci5maWx0ZXIoKGUpID0+ICFpc1NwYW4oZSkpO1xuXG4gIC8vIFBhc3MgMTogbm9uLXNwYW4gbGVhdmVzXG4gIGNvbnN0IG5vblNwYW5MZWF2ZXMgPSBub25TcGFucy5maWx0ZXIoKGUpID0+IGlzTGVhZihlKSk7XG4gIGxldCB0YXJnZXQ6IE9ic2VydmFiaWxpdHlFdmVudCB8IHVuZGVmaW5lZDtcbiAgaWYgKG5vblNwYW5MZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGlkeCA9IHBpY2tMb3dlc3Qobm9uU3BhbkxlYXZlcyk7XG4gICAgdGFyZ2V0ID0gbm9uU3BhbkxlYXZlc1sgaWR4IF07XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFhbGxvd0V2aWN0U3BhbnMpIHtcbiAgICAgIC8vIFBhc3MgMiAobm9uLXNwYW4gb25seSk6IGV2aWN0IGxvd2VzdC1wcmlvcml0eSBub24tc3BhbiB0aGF0IGRvZXNuJ3QgaGF2ZSBzcGFuIGNoaWxkcmVuLlxuICAgICAgLy8gV2UgbXVzdCBjaGVjayBmb3Igc3BhbiBjaGlsZHJlbiBiZWNhdXNlIHN1YnRyZWUgcmVtb3ZhbCB3b3VsZCBldmljdCB0aG9zZSBzcGFucyxcbiAgICAgIC8vIHZpb2xhdGluZyB0aGUgYWxsb3dFdmljdFNwYW5zPWZhbHNlIGNvbnRyYWN0LlxuICAgICAgaWYgKG5vblNwYW5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgLy8gRmlsdGVyIHRvIG9ubHkgbm9uLXNwYW5zIHRoYXQgYXJlIHNhZmUgdG8gZXZpY3QgKG5vIHNwYW4gY2hpbGRyZW4pXG4gICAgICAgIGNvbnN0IHNhZmVOb25TcGFucyA9IG5vblNwYW5zLmZpbHRlcihlID0+IHtcbiAgICAgICAgICBjb25zdCBpZCA9IGdldElkKGUpO1xuICAgICAgICAgIGlmICghaWQpIHJldHVybiB0cnVlOyAvLyBObyBJRCA9IG5vIGNoaWxkcmVuXG4gICAgICAgICAgY29uc3Qga2lkcyA9IGNoaWxkcmVuQnlQYXJlbnQuZ2V0KGlkKTtcbiAgICAgICAgICBpZiAoIWtpZHMpIHJldHVybiB0cnVlOyAvLyBObyBjaGlsZHJlbiA9IHNhZmVcbiAgICAgICAgICAvLyBSZWplY3QgaWYgYW55IGNoaWxkIGlzIGEgc3BhblxuICAgICAgICAgIHJldHVybiAha2lkcy5zb21lKGNoaWxkID0+IGlzU3BhbihjaGlsZCkpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoc2FmZU5vblNwYW5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KHNhZmVOb25TcGFucyk7XG4gICAgICAgICAgdGFyZ2V0ID0gc2FmZU5vblNwYW5zWyBpZHggXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBBbGwgbm9uLXNwYW5zIGhhdmUgc3BhbiBjaGlsZHJlbiAtIGNhbm5vdCBldmljdCB3aXRob3V0IHZpb2xhdGluZyBhbGxvd0V2aWN0U3BhbnNcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQnVmZmVyIGNvbnRhaW5zIG9ubHkgc3BhbnMgLSBjYWxsZXIgbXVzdCBkZWNpZGUgd2hldGhlciB0byBhbGxvdyBzcGFuIGV2aWN0aW9uIG9yIG92ZXJmbG93LlxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gUGFzcyAyOiBhbnkgbGVhdmVzIChpbmNsdWRpbmcgc3BhbnMpXG4gICAgICBjb25zdCBhbnlMZWF2ZXMgPSBidWZmZXIuZmlsdGVyKChlKSA9PiBpc0xlYWYoZSkpO1xuICAgICAgaWYgKGFueUxlYXZlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGlkeCA9IHBpY2tMb3dlc3QoYW55TGVhdmVzKTtcbiAgICAgICAgdGFyZ2V0ID0gYW55TGVhdmVzWyBpZHggXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFBhc3MgMzogbm8gbGVhdmVzIGV4aXN0IChjeWNsZS9kZWdlbmVyYXRlKS4gUGljayB0aGUgb3ZlcmFsbCBsb3dlc3QtcHJpb3JpdHkgZXZlbnQuXG4gICAgICAgIGNvbnN0IGlkeCA9IHBpY2tMb3dlc3QoYnVmZmVyKTtcbiAgICAgICAgdGFyZ2V0ID0gYnVmZmVyWyBpZHggXTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoIXRhcmdldCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgdGFyZ2V0SWQgPSBnZXRJZCh0YXJnZXQpO1xuICBsZXQgcmVtb3ZlZENvdW50ID0gMDtcblxuICAvLyBJZiB0YXJnZXQgaXMgcmVmZXJlbmNlZCBhcyBhIHBhcmVudCwgcmVtb3ZlIGl0cyBlbnRpcmUgc3VidHJlZSAoQkZTKS5cbiAgY29uc3QgdG9SZW1vdmUgPSBuZXcgU2V0PE9ic2VydmFiaWxpdHlFdmVudD4oKTtcbiAgY29uc3QgcXVldWU6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gWyB0YXJnZXQgXTtcbiAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBjdXIgPSBxdWV1ZS5zaGlmdCgpITtcbiAgICBpZiAodG9SZW1vdmUuaGFzKGN1cikpIGNvbnRpbnVlO1xuICAgIHRvUmVtb3ZlLmFkZChjdXIpO1xuICAgIGNvbnN0IGN1cklkID0gZ2V0SWQoY3VyKTtcbiAgICBpZiAoY3VySWQpIHtcbiAgICAgIGNvbnN0IGtpZHMgPSBjaGlsZHJlbkJ5UGFyZW50LmdldChjdXJJZCk7XG4gICAgICBpZiAoa2lkcykgcXVldWUucHVzaCguLi5raWRzKTtcbiAgICB9XG4gIH1cblxuICAvLyBGaWx0ZXIgYnVmZmVyIGluLXBsYWNlXG4gIGZvciAobGV0IGkgPSBidWZmZXIubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBpZiAodG9SZW1vdmUuaGFzKGJ1ZmZlclsgaSBdKSkge1xuICAgICAgYnVmZmVyLnNwbGljZShpLCAxKTtcbiAgICAgIHJlbW92ZWRDb3VudCsrO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdHlwZTogdGFyZ2V0LnR5cGUsXG4gICAgY29ycmVsYXRpb25JZDogdGFyZ2V0LmNvcnJlbGF0aW9uSWQsXG4gICAgb3BlcmF0aW9uOiB0YXJnZXQub3BlcmF0aW9uLFxuICAgIGxldmVsOiB0YXJnZXQubGV2ZWwsXG4gICAgcmVtb3ZlZENvdW50LFxuICB9O1xufVxuXG4vKipcbiAqIEhhbmRsZSB0YWlsLWJhc2VkIHNhbXBsaW5nIGxvZ2ljIGZvciBhbiBldmVudCAoc3luYyB2ZXJzaW9uKVxuICogUmV0dXJuczogJ2NhcHR1cmVkJyBpZiBldmVudCB3YXMgY2FwdHVyZWQsICdidWZmZXJlZCcgaWYgYnVmZmVyZWQsICdza2lwJyBpZiBub3QgdXNpbmcgdGFpbC1iYXNlZFxuICovXG5mdW5jdGlvbiBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ1N5bmMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PlxuKTogJ2NhcHR1cmVkJyB8ICdidWZmZXJlZCcgfCAnc2tpcCcge1xuICBjb25zdCBjZmcgPSBjb25maWc7XG4gIGlmICghY2ZnKSByZXR1cm4gJ3NraXAnO1xuICBjb25zdCBzaG91bGRCdWZmZXJGb3JQb2xpY3kgPSBjZmcubm9pc2VSZWR1Y3Rpb24uZW5hYmxlZDtcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yU2FtcGxpbmcgPSAhIWNmZy5zYW1wbGluZz8uc21hcnQ7XG4gIGlmICgoIXNob3VsZEJ1ZmZlckZvclNhbXBsaW5nICYmICFzaG91bGRCdWZmZXJGb3JQb2xpY3kpIHx8ICFjb250ZXh0KSB7XG4gICAgcmV0dXJuICdza2lwJztcbiAgfVxuXG4gIGNvbnN0IGlzRXJyb3IgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKSA+PSBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1I7XG5cbiAgLy8gRVJST1IgUEFUSDogRmx1c2ggYnVmZmVyICsgY2FwdHVyZSBlcnJvciArIHNldCBmbGFnXG4gIGlmIChpc0Vycm9yKSB7XG4gICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gICAgaWYgKG9ic1N0YXRlLmJ1ZmZlci5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG4gICAgICBvYnNTdGF0ZS5idWZmZXIgPSBbXTtcblxuICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjZmcubm9pc2VSZWR1Y3Rpb24pO1xuICAgICAgY29uc3QgcmVkdWNlZEJ1ZmZlciA9IGVuZm9yY2VIaWVyYXJjaHlJbnRlZ3JpdHlPckRyb3AocmVkdWNlZC5ldmVudHMsIGNvbnRleHQuY29ycmVsYXRpb25JZCk7XG5cbiAgICAgIC8vIERpc3BhdGNoIGFsbCBldmVudHMgLSBub2lzZSByZWR1Y3Rpb24gYWxyZWFkeSBmaWx0ZXJlZCBieSBtaW5MZXZlbFxuICAgICAgZm9yIChjb25zdCBidWZmZXJlZEV2ZW50IG9mIHJlZHVjZWRCdWZmZXIpIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICBkaXNwYXRjaFRvQmFja2VuZHMoYnVmZmVyZWRFdmVudCwgdGFyZ2V0cyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgb2JzU3RhdGUuZXJyb3JPY2N1cnJlZCA9IHRydWU7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgb2JzU3RhdGUuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBQT1NULUVSUk9SIFBBVEg6IENhcHR1cmUgaW1tZWRpYXRlbHlcbiAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eS5lcnJvck9jY3VycmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5LnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gTk9STUFMIFBBVEg6IEJ1ZmZlciBldmVyeXRoaW5nIChmaWx0ZXJpbmcgaGFwcGVucyBBRlRFUiBub2lzZSByZWR1Y3Rpb24pXG4gIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNmZy5zYW1wbGluZz8ubWF4QnVmZmVyU2l6ZSA/PyAxMDAwO1xuICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBtYXhTaXplKSB7XG4gICAgLy8gSU1QT1JUQU5UOlxuICAgIC8vIER1cmluZyBidWZmZXJpbmcgKG5vaXNlIHJlZHVjdGlvbiAvIHNtYXJ0IHNhbXBsaW5nKSwgc3BhbnMgbWF5IGJlIGVtaXR0ZWQgQUZURVIgdGhlaXIgY2hpbGRyZW4uXG4gICAgLy8gRXZpY3Rpbmcgc3BhbnMgb3Bwb3J0dW5pc3RpY2FsbHkgY2FuIHRoZXJlZm9yZSBjcmVhdGUgZnV0dXJlIG9ycGhhbiBjaGlsZHJlbiAobWlzc2luZ19wYXJlbnRfc3BhbikuXG4gICAgLy8gUHJlZmVyIGV2aWN0aW5nIG5vbi1zcGFuIGV2ZW50cyBvbmx5OyBpZiB0aGUgYnVmZmVyIGlzIHNwYW5zLW9ubHksIGFsbG93IGJvdW5kZWQgb3ZlcmZsb3cuXG4gICAgY29uc3QgZXZpY3RlZEluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IGZhbHNlIH0pO1xuICAgIGlmIChldmljdGVkSW5mbykge1xuICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNwYW5zLW9ubHkgb3ZlcmZsb3c6IGFsbG93IGJ1ZmZlciBncm93dGggdXAgdG8gMnggYmVmb3JlIGV2aWN0aW5nIHNwYW4gc3VidHJlZXMuXG4gICAgICBjb25zdCBoYXJkQ2FwID0gbWF4U2l6ZSAqIDI7XG4gICAgICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBoYXJkQ2FwKSB7XG4gICAgICAgIGNvbnN0IGV2aWN0ZWRTcGFuSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyLCB7IGFsbG93RXZpY3RTcGFuczogdHJ1ZSB9KTtcbiAgICAgICAgaWYgKGV2aWN0ZWRTcGFuSW5mbykge1xuICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTG9nIHdhcm5pbmcgd2l0aCBldmljdGVkIGV2ZW50IGRldGFpbHNcbiAgICBpZiAob2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkID09PSAxIHx8IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCAlIDEwMCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ09ic2VydmFiaWxpdHkgYnVmZmVyIGZ1bGwsIGV2aWN0aW5nIGxvd2VzdCBwcmlvcml0eSBldmVudHMnLCB7XG4gICAgICAgIGV2aWN0ZWQ6IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCxcbiAgICAgICAgYnVmZmVyU2l6ZTogYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgICBldmljdGVkRXZlbnQ6IGV2aWN0ZWRJbmZvLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChldmljdGVkSW5mbykge1xuICAgICAgLy8gTG9nIGVhY2ggZXZpY3Rpb24gYXQgZGVidWcgbGV2ZWwgZm9yIHRyb3VibGVzaG9vdGluZ1xuICAgICAgbG9nZ2VyLmRlYnVnKCdFdmljdGVkIG9ic2VydmFiaWxpdHkgZXZlbnQgZnJvbSBidWZmZXInLCB7XG4gICAgICAgIC4uLmV2aWN0ZWRJbmZvLFxuICAgICAgICB0b3RhbEV2aWN0ZWQ6IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGJ1ZmZlci5wdXNoKGV2ZW50KTtcbiAgb2JzU3RhdGUuc3VtbWFyeS5idWZmZXJlZCsrO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKGFzeW5jIHZlcnNpb24pXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PlxuKTogUHJvbWlzZTwnY2FwdHVyZWQnIHwgJ2J1ZmZlcmVkJyB8ICdza2lwJz4ge1xuICBjb25zdCBjZmcgPSBjb25maWc7XG4gIGlmICghY2ZnKSByZXR1cm4gJ3NraXAnO1xuICBjb25zdCBzaG91bGRCdWZmZXJGb3JQb2xpY3kgPSBjZmcubm9pc2VSZWR1Y3Rpb24uZW5hYmxlZDtcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yU2FtcGxpbmcgPSAhIWNmZy5zYW1wbGluZz8uc21hcnQ7XG4gIGlmICgoIXNob3VsZEJ1ZmZlckZvclNhbXBsaW5nICYmICFzaG91bGRCdWZmZXJGb3JQb2xpY3kpIHx8ICFjb250ZXh0KSB7XG4gICAgcmV0dXJuICdza2lwJztcbiAgfVxuXG4gIGNvbnN0IGlzRXJyb3IgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKSA+PSBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1I7XG5cbiAgLy8gRVJST1IgUEFUSDogRmx1c2ggYnVmZmVyICsgY2FwdHVyZSBlcnJvciArIHNldCBmbGFnXG4gIGlmIChpc0Vycm9yKSB7XG4gICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gICAgaWYgKG9ic1N0YXRlLmJ1ZmZlci5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG4gICAgICBvYnNTdGF0ZS5idWZmZXIgPSBbXTtcblxuICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjZmcubm9pc2VSZWR1Y3Rpb24pO1xuICAgICAgY29uc3QgcmVkdWNlZEJ1ZmZlciA9IGVuZm9yY2VIaWVyYXJjaHlJbnRlZ3JpdHlPckRyb3AocmVkdWNlZC5ldmVudHMsIGNvbnRleHQuY29ycmVsYXRpb25JZCk7XG5cbiAgICAgIC8vIERpc3BhdGNoIGFsbCBldmVudHMgLSBub2lzZSByZWR1Y3Rpb24gYWxyZWFkeSBmaWx0ZXJlZCBieSBtaW5MZXZlbFxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocmVkdWNlZEJ1ZmZlci5tYXAoYnVmZmVyZWRFdmVudCA9PiB7XG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoYnVmZmVyZWRFdmVudC50eXBlKTtcbiAgICAgICAgcmV0dXJuIGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoYnVmZmVyZWRFdmVudCwgdGFyZ2V0cyk7XG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgb2JzU3RhdGUuZXJyb3JPY2N1cnJlZCA9IHRydWU7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIG9ic1N0YXRlLnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gUE9TVC1FUlJPUiBQQVRIOiBDYXB0dXJlIGltbWVkaWF0ZWx5XG4gIGlmIChjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHkuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBOT1JNQUwgUEFUSDogQnVmZmVyIGV2ZXJ5dGhpbmdcbiAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gIGNvbnN0IGJ1ZmZlciA9IG9ic1N0YXRlLmJ1ZmZlcjtcblxuICAvLyBCdWZmZXIgc2l6ZSBtYW5hZ2VtZW50OiBldmljdCBsb3dlc3QgcHJpb3JpdHkgaWYgZnVsbFxuICBjb25zdCBtYXhTaXplID0gY2ZnLnNhbXBsaW5nPy5tYXhCdWZmZXJTaXplID8/IDEwMDA7XG4gIGlmIChidWZmZXIubGVuZ3RoID49IG1heFNpemUpIHtcbiAgICBjb25zdCBldmljdGVkSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyLCB7IGFsbG93RXZpY3RTcGFuczogZmFsc2UgfSk7XG4gICAgaWYgKGV2aWN0ZWRJbmZvKSB7XG4gICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQrKztcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgaGFyZENhcCA9IG1heFNpemUgKiAyO1xuICAgICAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gaGFyZENhcCkge1xuICAgICAgICBjb25zdCBldmljdGVkU3BhbkluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IHRydWUgfSk7XG4gICAgICAgIGlmIChldmljdGVkU3BhbkluZm8pIHtcbiAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExvZyB3YXJuaW5nIGlmIGV2aWN0aW5nIGEgbG90XG4gICAgaWYgKG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCA9PT0gMSB8fCBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgJSAxMDAgPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBmdWxsLCBldmljdGluZyBsb3dlc3QgcHJpb3JpdHkgZXZlbnRzJywge1xuICAgICAgICBldmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgIGJ1ZmZlclNpemU6IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYnVmZmVyLnB1c2goZXZlbnQpO1xuICBvYnNTdGF0ZS5zdW1tYXJ5LmJ1ZmZlcmVkKys7XG4gIHJldHVybiAnYnVmZmVyZWQnO1xufVxuXG4vKipcbiAqIEluaXRpYWxpemUgc291cmNlLW1hcC1zdXBwb3J0IGlmIGVuYWJsZWQgaW4gY29uZmlnXG4gKiBQcm92aWRlcyBiZXR0ZXIgc3RhY2sgdHJhY2VzIGZvciBUeXBlU2NyaXB0L3RyYW5zcGlsZWQgY29kZSBpbiBwcm9kdWN0aW9uXG4gKi9cbmZ1bmN0aW9uIGluaXRpYWxpemVTb3VyY2VNYXBTdXBwb3J0KGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHZvaWQge1xuICBpZiAoIWNmZy5zb3VyY2VNYXAuZW5hYmxlZCkge1xuICAgIGxvZ2dlci5kZWJ1ZygnU291cmNlIG1hcCBzdXBwb3J0IGRpc2FibGVkIGluIGNvbmZpZycpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRyeSB7XG4gICAgbG9nZ2VyLmRlYnVnKCdBdHRlbXB0aW5nIHRvIGxvYWQgc291cmNlLW1hcC1zdXBwb3J0Li4uJyk7XG4gICAgLy8gRHluYW1pYyBpbXBvcnQgdG8gYXZvaWQgYnVuZGxpbmcgaWYgbm90IG5lZWRlZFxuICAgIHJlcXVpcmUoJ3NvdXJjZS1tYXAtc3VwcG9ydC9yZWdpc3RlcicpO1xuICAgIGxvZ2dlci5pbmZvKCdTb3VyY2UgbWFwIHN1cHBvcnQgZW5hYmxlZCAtIHN0YWNrIHRyYWNlcyB3aWxsIHNob3cgb3JpZ2luYWwgVHlwZVNjcmlwdCBsaW5lcycpO1xuICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgIC8vIE5vdCBhIGNyaXRpY2FsIGVycm9yIC0gb2JzZXJ2YWJpbGl0eSBzdGlsbCB3b3JrcyB3aXRob3V0IHNvdXJjZSBtYXBzXG4gICAgaWYgKGVycm9yICYmIHR5cGVvZiBlcnJvciA9PT0gJ29iamVjdCcgJiYgJ2NvZGUnIGluIGVycm9yICYmIChlcnJvciBhcyB7IGNvZGU/OiB1bmtub3duIH0pLmNvZGUgPT09ICdNT0RVTEVfTk9UX0ZPVU5EJykge1xuICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgICdzb3VyY2UtbWFwLXN1cHBvcnQgcGFja2FnZSBub3QgZm91bmQuIEluc3RhbGwgaXQgZm9yIGJldHRlciBlcnJvciBzdGFjayB0cmFjZXM6IG5wbSBpbnN0YWxsIHNvdXJjZS1tYXAtc3VwcG9ydCdcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG1zZyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gbG9hZCBzb3VyY2UtbWFwLXN1cHBvcnQ6JywgbXNnKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIGJhY2tlbmRzIGZyb20gREkgYmFzZWQgb24gY29uZmlnXG4gKi9cbmZ1bmN0aW9uIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogdm9pZCB7XG4gIGJhY2tlbmRzID0gW107XG4gIGJhY2tlbmRDb25maWdzLmNsZWFyKCk7XG4gIGNvbnN0IGVuYWJsZWRCYWNrZW5kcyA9IGNmZy5iYWNrZW5kcy5maWx0ZXIoYiA9PiBiLmVuYWJsZWQgIT09IGZhbHNlKTtcblxuICBmb3IgKGNvbnN0IGJhY2tlbmRDZmcgb2YgZW5hYmxlZEJhY2tlbmRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJhY2tlbmQgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmU8T2JzZXJ2YWJpbGl0eUJhY2tlbmQ+KFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICAgICAgICB7IHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsIGJhY2tlbmRDZmcudHlwZSBdIH1cbiAgICAgICk7XG4gICAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICAgICAgYmFja2VuZENvbmZpZ3Muc2V0KGJhY2tlbmQubmFtZSwgYmFja2VuZENmZyk7XG4gICAgICBsb2dnZXIuZGVidWcoYEluaXRpYWxpemVkIGJhY2tlbmQ6ICR7YmFja2VuZC5uYW1lfWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBOb1Byb3ZpZGVyRm91bmRFcnJvcikge1xuICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAnJHtiYWNrZW5kQ2ZnLnR5cGV9JyBub3QgZm91bmQgaW4gREksIHNraXBwaW5nYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGJhY2tlbmQgJyR7YmFja2VuZENmZy50eXBlfSc6YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChiYWNrZW5kcy5sZW5ndGggPT09IDApIHtcbiAgICAvLyBTb2Z0LWZhaWw6IGRvIE5PVCB0aHJvdyBhbmQgYnJlYWsgYXBwbGljYXRpb24gZmxvdy5cbiAgICAvLyBXaXRob3V0IGJhY2tlbmRzLCBjYXB0dXJlIGJlY29tZXMgYSBuby1vcCBmb3IgdGhpcyBpbnZvY2F0aW9uIChldmVudHMgYXJlIGRyb3BwZWQpLlxuICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eSBtaXNjb25maWd1cmVkOiBubyBlbmFibGVkL2F2YWlsYWJsZSBiYWNrZW5kcyB3ZXJlIHJlc29sdmVkIGZyb20gREkuIE9ic2VydmFiaWxpdHkgd2lsbCBiZSBkaXNhYmxlZCBmb3IgdGhpcyBpbnZvY2F0aW9uLicsIHtcbiAgICAgIGVuYWJsZWRCYWNrZW5kVHlwZXM6IGVuYWJsZWRCYWNrZW5kcy5tYXAoYiA9PiBiLnR5cGUpLFxuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGRvSW5pdGlhbGl6ZSgpOiB2b2lkIHtcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIFNUQVJUID09PScpO1xuXG4gICAgLy8gUnVuIHByZS1pbml0aWFsaXphdGlvbiBob29rcyAoZS5nLiwgc2NoZW1hIHJlZ2lzdHJhdGlvbilcbiAgICBpZiAocHJlSW5pdEhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgUnVubmluZyAke3ByZUluaXRIb29rcy5sZW5ndGh9IHByZS1pbml0aWFsaXphdGlvbiBob29rKHMpLi4uYCk7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgcHJlSW5pdEhvb2tzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaG9vaygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcignUHJlLWluaXRpYWxpemF0aW9uIGhvb2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLmRlYnVnKCdQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBjb25maWcgaW5wdXQgZnJvbSBESSwgdGhlbiBub3JtYWxpemUgaW50byBhIGZ1bGx5LWRlZmluZWQgT2JzZXJ2YWJpbGl0eUNvbmZpZy5cbiAgICAvLyBUaGlzIGF2b2lkcyB1bnNhZmUgY2FzdHMgYW5kIGVuc3VyZXMgdGhlIHNoYXBlIGlzIGNvbnNpc3RlbnQgZXZlbiB3aGVuIGFwcHMgb3ZlcnJpZGUgcGFydGlhbGx5LlxuICAgIGNvbnN0IGlucHV0ID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlQ29uZmlnPE9ic2VydmFiaWxpdHlDb25maWdJbnB1dD4oJ29ic2VydmFiaWxpdHknKTtcbiAgICBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0KTtcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhjb25maWcpO1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBjb25maWcgbG9hZGVkIGZyb20gREknLCB7XG4gICAgICBlbmFibGVkOiBjb25maWcuZW5hYmxlZCxcbiAgICAgIHNlcnZpY2VOYW1lOiBjb25maWcuc2VydmljZU5hbWUsXG4gICAgICBiYWNrZW5kczogY29uZmlnLmJhY2tlbmRzPy5tYXAoYiA9PiBiLnR5cGUpLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkLCBzbWFydDogY29uZmlnLnNhbXBsaW5nPy5zbWFydCB9LFxuICAgICAgc291cmNlTWFwOiBjb25maWcuc291cmNlTWFwPy5lbmFibGVkLFxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBzb3VyY2UtbWFwLXN1cHBvcnQgZm9yIGJldHRlciBzdGFjayB0cmFjZXMgKGlmIGVuYWJsZWQpXG4gICAgaW5pdGlhbGl6ZVNvdXJjZU1hcFN1cHBvcnQoY29uZmlnKTtcblxuICAgIC8vIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESVxuICAgIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY29uZmlnISk7XG5cbiAgICAvLyBSZWdpc3RlciBjYXB0dXJlciBmb3Igb2JzZXJ2ZXJzXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcblxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBsb2dnZXIuaW5mbygnPT09IE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gQ09NUExFVEUgPT09Jyk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKCchISEgT0JTRVJWQUJJTElUWSBJTklUSUFMSVpBVElPTiBGQUlMRUQgISEhJywgZXJyb3IpO1xuICAgIC8vIFNvZnQtZmFpbDogZG8gTk9UIHRocm93IGludG8gYXBwbGljYXRpb24gZmxvdy5cbiAgICAvLyBNYXJrIGluaXRpYWxpemVkIHRvIHByZXZlbnQgcmVwZWF0ZWQgaW5pdCBhdHRlbXB0czsgbGVhdmUgY2FwdHVyZXIgdW5pbml0aWFsaXplZCBzbyBvYnNlcnZlcnMgZHJvcCBldmVudHMuXG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgIGNvbmZpZyA9IG51bGw7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcobnVsbCk7XG4gICAgYmFja2VuZHMgPSBbXTtcbiAgICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICB9XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFVCTElDIEFQSSAtIE9ic2VydmFiaWxpdHlNYW5hZ2VyXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGNsYXNzIE9ic2VydmFiaWxpdHlNYW5hZ2VyIHtcblxuICBwcml2YXRlIGNvbnN0cnVjdG9yKCkgeyB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgZm9yIGEgbmV3IExhbWJkYSBpbnZvY2F0aW9uXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpIGNhbGxlZCcsIHsgaW5pdGlhbGl6ZWQsIGludm9jYXRpb25Db3VudCB9KTtcblxuICAgIGlmICghaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnTm90IGluaXRpYWxpemVkIHlldCwgY2FsbGluZyBkb0luaXRpYWxpemUoKS4uLicpO1xuICAgICAgZG9Jbml0aWFsaXplKCk7XG4gICAgfVxuXG4gICAgaW52b2NhdGlvbkNvdW50Kys7XG4gICAgbG9nZ2VyLmRlYnVnKGBJbnZvY2F0aW9uICR7aW52b2NhdGlvbkNvdW50fSBzdGFydGluZywgaW5pdGlhbGl6aW5nICR7YmFja2VuZHMubGVuZ3RofSBiYWNrZW5kKHMpYCk7XG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgYmFja2VuZHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGJhY2tlbmQuaW5pdGlhbGl6ZUludm9jYXRpb24/LigpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmYWlsZWQgdG8gaW5pdGlhbGl6ZSBpbnZvY2F0aW9uOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzdGF0aWMgaXNJbml0aWFsaXplZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaW5pdGlhbGl6ZWQ7XG4gIH1cblxuICBzdGF0aWMgaXNDb2xkU3RhcnQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudCA9PT0gMTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRJbnZvY2F0aW9uQ291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gaW52b2NhdGlvbkNvdW50O1xuICB9XG5cbiAgc3RhdGljIGdldENvbmZpZygpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCB7XG4gICAgcmV0dXJuIGNvbmZpZztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgb2JzZXJ2YWJpbGl0eSBzdW1tYXJ5IGZvciB0aGUgY3VycmVudCBpbnZvY2F0aW9uLlxuICAgKiBSZXR1cm5zIGJ1ZmZlciBzdGF0czogZXZpY3RlZCwgYnVmZmVyZWQsIGNhcHR1cmVkLCBzYW1wbGVkT3V0IGNvdW50cy5cbiAgICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gZXhlY3V0aW9uIGNvbnRleHQgZXhpc3RzLlxuICAgKi9cbiAgc3RhdGljIGdldFN1bW1hcnkoKTogT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgIHJldHVybiBjb250ZXh0Py5vYnNlcnZhYmlsaXR5LnN1bW1hcnk7XG4gIH1cblxuICBzdGF0aWMgY29uZmlndXJlKHVwZGF0ZXM6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZz4pOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdPYnNlcnZhYmlsaXR5TWFuYWdlciBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICB9XG4gICAgY29uZmlnID0geyAuLi5jb25maWcsIC4uLnVwZGF0ZXMgfTtcbiAgfVxuXG4gIHN0YXRpYyByZWdpc3RlckJhY2tlbmQoYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQpOiB2b2lkIHtcbiAgICBpZiAoYmFja2VuZHMuZmluZCgoYikgPT4gYi5uYW1lID09PSBiYWNrZW5kLm5hbWUpKSB7XG4gICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gYWxyZWFkeSByZWdpc3RlcmVkYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gIH1cblxuICBzdGF0aWMgdW5yZWdpc3RlckJhY2tlbmQobmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgYmFja2VuZHMgPSBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IGIubmFtZSAhPT0gbmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBwcmUtaW5pdGlhbGl6YXRpb24gaG9vay5cbiAgICogSG9va3MgcnVuIEJFRk9SRSBiYWNrZW5kcyBhcmUgaW5pdGlhbGl6ZWQsIGFsbG93aW5nIHNjaGVtYS9zZXJ2aWNlIHJlZ2lzdHJhdGlvblxuICAgKiBuZWVkZWQgYnkgYmFja2VuZHMgd2l0aG91dCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gICAqIFxuICAgKiBAcGFyYW0gaG9vayAtIENhbGxiYWNrIHRvIGV4ZWN1dGUgZHVyaW5nIGluaXRpYWxpemF0aW9uXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJQcmVJbml0SG9vayhob29rOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgcHJlSW5pdEhvb2tzLnB1c2goaG9vayk7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhbiBvYnNlcnZhYmlsaXR5IGV2ZW50IChmaXJlLWFuZC1mb3JnZXQpXG4gICAqIFxuICAgKiBDYXB0dXJlIGNvbnRyb2wgaXMgZW1iZWRkZWQgaW4gaW5wdXQuY2FwdHVyZSAtIG5vIHNlcGFyYXRlIG9wdGlvbnMgcGFyYW0uXG4gICAqIFxuICAgKiBAcGFyYW0gaW5wdXQgLSBFdmVudCBpbnB1dCB3aXRoIGNhcHR1cmUgY29udHJvbCBpbiBpbnB1dC5jYXB0dXJlXG4gICAqIEByZXR1cm5zIG9ic2VydmFiaWxpdHlMb2dJZCBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIGlmIGZpbHRlcmVkL3NhbXBsZWQgb3V0XG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZShpbnB1dDogQ2FwdHVyZUlucHV0KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIud2Fybign4p2MIE9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJywgeyB0eXBlOiBpbnB1dC50eXBlLCBsZXZlbDogaW5wdXQubGV2ZWwgfSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBIYXJkIGRlcHJlY2F0aW9uOiBGVzI0IGRvZXMgbm90IHN1cHBvcnQgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cy5cbiAgICAgIC8vIElmIGFueXRoaW5nIGVtaXRzIHRoZXNlLCBpdCdzIGEgYnVnLiBMb2cgbG91ZGx5IGFuZCBkcm9wLlxuICAgICAgaWYgKGlucHV0LnR5cGUgPT09ICdzcGFuLmVuZCcgfHwgaW5wdXQudHlwZSA9PT0gJ3NwYW4uZXZlbnQnKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eSBpbnZhcmlhbnQgdmlvbGF0aW9uOiBsZWdhY3kgc3Bhbi4qIGV2ZW50IHR5cGUgd2FzIGVtaXR0ZWQgKHVuc3VwcG9ydGVkKS4gRHJvcHBpbmcgZXZlbnQuJywge1xuICAgICAgICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgICAgICAgb3BlcmF0aW9uOiBpbnB1dC5vcGVyYXRpb24sXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogaW5wdXQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgICBzb3VyY2U6IGlucHV0LnNvdXJjZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlSW5wdXQoaW5wdXQpO1xuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGNhcHR1cmUgaW5wdXQ6JywgeyBlcnJvcnMsIHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghY29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBkaXNhYmxlZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICBjb25zdCBldmVudCA9IGJ1aWxkRXZlbnQoaW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nU3luYyhldmVudCwgY29udGV4dCk7XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2NhcHR1cmVkJykge1xuICAgICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgfVxuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdidWZmZXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgLy8gSEVBRC1CQVNFRCBGSUxURVJJTkcgKyBTQU1QTElOR1xuICAgICAgLy8gQXBwbHkgZmlsdGVyaW5nIGZpcnN0IChhbHdheXMgcnVucylcbiAgICAgIGlmICghc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgLy8gTm8gYnVmZmVyZWQgZ3JhcGggaGVyZTsgbmV2ZXIgZHJvcCBzcGFucyBieSBtaW5EdXJhdGlvbiBpbiBoZWFkLWJhc2VkIG1vZGVcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSBjYW4ndCBwcm92ZSB0aGV5IGFyZW4ndCBwYXJlbnRzIG9mIGFscmVhZHktZW1pdHRlZCBjaGlsZCBldmVudHMuXG4gICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogZmFsc2UsXG4gICAgICB9KSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBGaWx0ZXJlZCBvdXRcbiAgICAgIH1cblxuICAgICAgLy8gQXBwbHkgc2FtcGxpbmcgaWYgZW5hYmxlZCAocHJvYmFiaWxpc3RpYylcbiAgICAgIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgIXNob3VsZFNhbXBsZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBTYW1wbGVkIG91dFxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmU6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhbiBvYnNlcnZhYmlsaXR5IGV2ZW50IGFzeW5jaHJvbm91c2x5ICh3YWl0cyBmb3IgYmFja2VuZCBjYXB0dXJlKVxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBQcm9taXNlPG9ic2VydmFiaWxpdHlMb2dJZD4gaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhcHR1cmVBc3luYyhpbnB1dDogQ2FwdHVyZUlucHV0KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBIYXJkIGRlcHJlY2F0aW9uOiBGVzI0IGRvZXMgbm90IHN1cHBvcnQgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cy5cbiAgICAgIC8vIElmIGFueXRoaW5nIGVtaXRzIHRoZXNlLCBpdCdzIGEgYnVnLiBMb2cgbG91ZGx5IGFuZCBkcm9wLlxuICAgICAgaWYgKGlucHV0LnR5cGUgPT09ICdzcGFuLmVuZCcgfHwgaW5wdXQudHlwZSA9PT0gJ3NwYW4uZXZlbnQnKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eSBpbnZhcmlhbnQgdmlvbGF0aW9uOiBsZWdhY3kgc3Bhbi4qIGV2ZW50IHR5cGUgd2FzIGVtaXR0ZWQgKHVuc3VwcG9ydGVkKS4gRHJvcHBpbmcgZXZlbnQuJywge1xuICAgICAgICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgICAgICAgb3BlcmF0aW9uOiBpbnB1dC5vcGVyYXRpb24sXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogaW5wdXQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICAgICAgICBzb3VyY2U6IGlucHV0LnNvdXJjZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlSW5wdXQoaW5wdXQpO1xuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGNhcHR1cmUgaW5wdXQ6JywgeyBlcnJvcnMsIHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghY29uZmlnPy5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICAgIGNvbnN0IGV2ZW50ID0gYnVpbGRFdmVudChpbnB1dCwgY29udGV4dCk7XG5cbiAgICAgIC8vIFRyeSB0YWlsLWJhc2VkIHNhbXBsaW5nIGZpcnN0XG4gICAgICBjb25zdCB0YWlsUmVzdWx0ID0gYXdhaXQgaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdBc3luYyhldmVudCwgY29udGV4dCk7XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2NhcHR1cmVkJykge1xuICAgICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgfVxuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdidWZmZXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgLy8gSEVBRC1CQVNFRCBGSUxURVJJTkcgKyBTQU1QTElOR1xuICAgICAgaWYgKCFzaG91bGRGaWx0ZXIoZXZlbnQsIGNvbmZpZywge1xuICAgICAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A6IGZhbHNlLFxuICAgICAgfSkpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gRmlsdGVyZWQgb3V0XG4gICAgICB9XG5cbiAgICAgIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgIXNob3VsZFNhbXBsZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBTYW1wbGVkIG91dFxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBpbiBjYXB0dXJlQXN5bmM6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT2JzZXJ2ZSBhbiBldmVudCAoY29udmVuaWVuY2UgbWV0aG9kKVxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gUGFydGlhbCBldmVudCB3aXRoIHJlcXVpcmVkIHR5cGUgYW5kIGxldmVsXG4gICAqIEByZXR1cm5zIG9ic2VydmFiaWxpdHlMb2dJZCBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIGlmIGZpbHRlcmVkL3NhbXBsZWQgb3V0XG4gICAqL1xuICBzdGF0aWMgb2JzZXJ2ZShcbiAgICBldmVudDogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+ICYgeyB0eXBlOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmcgfVxuICApOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBldmVudC5jb3JyZWxhdGlvbklkID8/IGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cygpO1xuXG4gICAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgICBsb2dnZXIud2Fybignb2JzZXJ2ZSgpIGNhbGxlZCB3aXRob3V0IGNvcnJlbGF0aW9uSWQnKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoe1xuICAgICAgLi4uZXZlbnQsXG4gICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgdHlwZTogZXZlbnQudHlwZSBhcyBDYXB0dXJlSW5wdXRbICd0eXBlJyBdLFxuICAgICAgbGV2ZWw6IGV2ZW50LmxldmVsIGFzIENhcHR1cmVJbnB1dFsgJ2xldmVsJyBdLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEZsdXNoIGFsbCBiYWNrZW5kcyBhbmQgYnVmZmVyZWQgZXZlbnRzIChjYWxsZWQgYXQgZW5kIG9mIExhbWJkYSBpbnZvY2F0aW9uKVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxvZ2dlci5kZWJ1ZygnPT09IEZMVVNIIFNUQVJUID09PScsIHtcbiAgICAgIHBlbmRpbmdEaXNwYXRjaGVzOiBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGgsXG4gICAgICBiYWNrZW5kczogYmFja2VuZHMubGVuZ3RoLFxuICAgICAgc21hcnRTYW1wbGluZzogY29uZmlnPy5zYW1wbGluZz8uc21hcnQsXG4gICAgfSk7XG5cbiAgICAvLyBXYWl0IGZvciBhbGwgcGVuZGluZyBmaXJlLWFuZC1mb3JnZXQgZGlzcGF0Y2hlcyAoZnJvbSBlcnJvciBwYXRoIGluIGNhcHR1cmUoKSlcbiAgICBpZiAocGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBXYWl0aW5nIGZvciAke3BlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aH0gcGVuZGluZyBkaXNwYXRjaGVzYCk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChwZW5kaW5nRGlzcGF0Y2hlcyk7XG4gICAgICBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPSAwOyAvLyBDbGVhciBmb3IgbmV4dCBpbnZvY2F0aW9uXG4gICAgICBsb2dnZXIuZGVidWcoJ1BlbmRpbmcgZGlzcGF0Y2hlcyBjb21wbGV0ZWQnKTtcbiAgICB9XG5cbiAgICAvLyBGb3JjZS1lbmQgYW55IHNwYW5zIGxlZnQgb3BlbiBpbiB0aGlzIGludm9jYXRpb24gYmVmb3JlIGZsdXNoaW5nIGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICAvLyBUaGlzIGd1YXJhbnRlZXMgdGhlIGhpZXJhcmNoeSBoYXMgYWxsIHBhcmVudHMsIGV2ZW4gaWYgdXNlci9mcmFtZXdvcmsgY29kZSBmb3Jnb3QgdG8gZW5kIGEgc3Bhbi5cbiAgICBydW5TcGFuRmluYWxpemVyKCk7XG5cbiAgICAvLyBBdHRhY2ggb2JzZXJ2YWJpbGl0eSBzdW1tYXJ5IHRvIGN1cnJlbnQgc3BhbiAoaWYgYW55KSBiZWZvcmUgZmx1c2hpbmdcbiAgICBjb25zdCBzdW1tYXJ5ID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZ2V0U3VtbWFyeSgpO1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgIGNvbnN0IGN1cnJlbnRTcGFuID0gY29udGV4dD8ub2JzZXJ2YWJpbGl0eS5jdXJyZW50U3BhbjtcbiAgICBpZiAoc3VtbWFyeSAmJiBjdXJyZW50U3BhbiAmJiAoc3VtbWFyeS5jYXB0dXJlZCA+IDAgfHwgc3VtbWFyeS5idWZmZXJlZCA+IDAgfHwgc3VtbWFyeS5ldmljdGVkID4gMCB8fCBzdW1tYXJ5LnNhbXBsZWRPdXQgPiAwKSkge1xuICAgICAgLy8gQWRkIGJhc2ljIGNvdW50IG1ldHJpY3NcbiAgICAgIGN1cnJlbnRTcGFuPy5tZXRyaWNzPy4oe1xuICAgICAgICAnX2Z3MjQub2JzLmNhcHR1cmVkJzogc3VtbWFyeS5jYXB0dXJlZCxcbiAgICAgICAgJ19mdzI0Lm9icy5idWZmZXJlZCc6IHN1bW1hcnkuYnVmZmVyZWQsXG4gICAgICAgICdfZncyNC5vYnMuZXZpY3RlZCc6IHN1bW1hcnkuZXZpY3RlZCxcbiAgICAgICAgJ19mdzI0Lm9icy5zYW1wbGVkT3V0Jzogc3VtbWFyeS5zYW1wbGVkT3V0LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBkZXRhaWxlZCBicmVha2Rvd24gY2hlY2twb2ludFxuICAgICAgY29uc3QgZGV0YWlsZWRTdGF0czogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICAgIHRvdGFsczoge1xuICAgICAgICAgIGNhcHR1cmVkOiBzdW1tYXJ5LmNhcHR1cmVkLFxuICAgICAgICAgIGJ1ZmZlcmVkOiBzdW1tYXJ5LmJ1ZmZlcmVkLFxuICAgICAgICAgIGV2aWN0ZWQ6IHN1bW1hcnkuZXZpY3RlZCxcbiAgICAgICAgICBzYW1wbGVkT3V0OiBzdW1tYXJ5LnNhbXBsZWRPdXQsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICAvLyBBZGQgY2FwdHVyZWQgZXZlbnRzIGJyZWFrZG93biAod2hhdCB3YXMgYWN0dWFsbHkgZW1pdHRlZClcbiAgICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dD8ub2JzZXJ2YWJpbGl0eTtcbiAgICAgIGlmIChvYnNTdGF0ZT8uY2FwdHVyZWRCcmVha2Rvd24pIHtcbiAgICAgICAgZGV0YWlsZWRTdGF0cy5jYXB0dXJlZEJyZWFrZG93biA9IHtcbiAgICAgICAgICBieVR5cGU6IG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5VHlwZSxcbiAgICAgICAgICBieU9wZXJhdGlvbjogT2JqZWN0LmtleXMob2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlPcGVyYXRpb24gfHwge30pLmxlbmd0aCA+IDBcbiAgICAgICAgICAgID8gb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlPcGVyYXRpb25cbiAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIGJ5TGV2ZWw6IG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5TGV2ZWwsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENvbXB1dGUgYnJlYWtkb3duIGJ5IHR5cGUgYW5kIG9wZXJhdGlvbiBmcm9tIGJ1ZmZlciAod2hhdCdzIHN0aWxsIGJ1ZmZlcmVkKVxuICAgICAgaWYgKGNvbnRleHQgJiYgY29udGV4dC5vYnNlcnZhYmlsaXR5LmJ1ZmZlci5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGJ5VHlwZTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICBjb25zdCBieU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICBjb25zdCBieUxldmVsOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG5cbiAgICAgICAgZm9yIChjb25zdCBldmVudCBvZiBjb250ZXh0Lm9ic2VydmFiaWxpdHkuYnVmZmVyKSB7XG4gICAgICAgICAgYnlUeXBlWyBldmVudC50eXBlIF0gPSAoYnlUeXBlWyBldmVudC50eXBlIF0gfHwgMCkgKyAxO1xuICAgICAgICAgIGlmIChldmVudC5vcGVyYXRpb24pIHtcbiAgICAgICAgICAgIGJ5T3BlcmF0aW9uWyBldmVudC5vcGVyYXRpb24gXSA9IChieU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gfHwgMCkgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICBieUxldmVsWyBldmVudC5sZXZlbCBdID0gKGJ5TGV2ZWxbIGV2ZW50LmxldmVsIF0gfHwgMCkgKyAxO1xuICAgICAgICB9XG5cbiAgICAgICAgZGV0YWlsZWRTdGF0cy5idWZmZXJlZEJyZWFrZG93biA9IHtcbiAgICAgICAgICBieVR5cGUsXG4gICAgICAgICAgYnlPcGVyYXRpb246IE9iamVjdC5rZXlzKGJ5T3BlcmF0aW9uKS5sZW5ndGggPiAwID8gYnlPcGVyYXRpb24gOiB1bmRlZmluZWQsXG4gICAgICAgICAgYnlMZXZlbCxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIGNoZWNrcG9pbnQgd2l0aCBkZXRhaWxlZCBzdGF0c1xuICAgICAgY3VycmVudFNwYW4/LmNoZWNrcG9pbnQ/Lignb2JzZXJ2YWJpbGl0eS5zdW1tYXJ5LmRldGFpbGVkJywgeyBkYXRhOiBkZXRhaWxlZFN0YXRzIH0pO1xuICAgIH1cblxuICAgIC8vIElmIGJ1ZmZlcmluZyBpcyBlbmFibGVkIChzbWFydCBzYW1wbGluZyBPUiBub2lzZSByZWR1Y3Rpb24pLCBmbHVzaCBidWZmZXJlZCBldmVudHMuXG4gICAgaWYgKGNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0IHx8IGNvbmZpZz8ubm9pc2VSZWR1Y3Rpb24/LmVuYWJsZWQpIHtcbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gICAgICBpZiAoY29udGV4dCAmJiBjb250ZXh0Lm9ic2VydmFiaWxpdHkuYnVmZmVyLmxlbmd0aCA+IDAgJiYgIWNvbnRleHQub2JzZXJ2YWJpbGl0eS5lcnJvck9jY3VycmVkKSB7XG4gICAgICAgIC8vIE5vIGVycm9yIG9jY3VycmVkOiBhcHBseSBub2lzZSByZWR1Y3Rpb24gKyBvcHRpb25hbCBzYW1wbGluZyB0byBidWZmZXIgYmVmb3JlIGZsdXNoaW5nXG4gICAgICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgICAgICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG4gICAgICAgIG9ic1N0YXRlLmJ1ZmZlciA9IFtdOyAvLyBDbGVhciBidWZmZXJcblxuICAgICAgICAvLyBDUklUSUNBTDogQ29tcHV0ZSByZWZlcmVuY2VkIHBhcmVudCBJRHMgZnJvbSBPUklHSU5BTCBidWZmZXIgQkVGT1JFIG5vaXNlIHJlZHVjdGlvblxuICAgICAgICAvLyBOb2lzZSByZWR1Y3Rpb24gbWF5IGFnZ3JlZ2F0ZS9yZW1vdmUgZXZlbnRzLCBidXQgdGhlaXIgcGFyZW50IHNwYW5zIG11c3Qgc3RpbGwgYmUga2VwdFxuICAgICAgICBjb25zdCByZWZlcmVuY2VkUGFyZW50U3BhbklkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICBmb3IgKGNvbnN0IGUgb2YgYnVmZmVyKSB7XG4gICAgICAgICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgICAgICAgIGlmIChwaWQpIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLmFkZChwaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuICAgICAgICBjb25zdCByZWR1Y2VkRXZlbnRzID0gcmVkdWNlZC5ldmVudHM7XG5cbiAgICAgICAgLy8gRHJvcCBlbXB0eSAqbGVhZiogc3BhbnMgaWYgY29uZmlndXJlZC5cbiAgICAgICAgLy8gQSBzcGFuIGlzIGEgbGVhZiBpZmYgbm9ib2R5IHJlZmVyZW5jZXMgaXQgYXMgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGluIHRoaXMgYnVmZmVyZWQgc2V0LlxuICAgICAgICBjb25zdCBtYXliZURyb3BFbXB0eUxlYWZTcGFucyA9IGNvbmZpZy5zcGFucy5za2lwRW1wdHlcbiAgICAgICAgICA/IHJlZHVjZWRFdmVudHMuZmlsdGVyKChlKSA9PiB7XG4gICAgICAgICAgICBpZiAoZS50eXBlICE9PSAnc3BhbicpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBlLm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgaWYgKHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLmhhcyhpZCkpIHJldHVybiB0cnVlOyAvLyBwYXJlbnQgPT4ga2VlcFxuICAgICAgICAgICAgY29uc3QgZCA9IGUuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbnN0IGZ3ID0gZD8uX2Z3MjQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gZnc/LnNwYW5FbXB0eSAhPT0gdHJ1ZTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogcmVkdWNlZEV2ZW50cztcblxuICAgICAgICBjb25zdCBmaW5hbEV2ZW50cyA9IGVuZm9yY2VIaWVyYXJjaHlJbnRlZ3JpdHlPckRyb3AobWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMsIGNvbnRleHQuY29ycmVsYXRpb25JZCk7XG5cbiAgICAgICAgLy8gVHJhY2sgY2FwdHVyZWQgZXZlbnRzIGZvciBkZXRhaWxlZCBzdW1tYXJ5XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkQnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkQnlPcGVyYXRpb246IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgY2FwdHVyZWRCeUxldmVsOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG5cbiAgICAgICAgZm9yIChjb25zdCBldmVudCBvZiBmaW5hbEV2ZW50cykge1xuICAgICAgICAgIC8vIFRBSUwtQkFTRUQgRklMVEVSSU5HICsgU0FNUExJTkcgKGFmdGVyIG5vaXNlIHJlZHVjdGlvbilcblxuICAgICAgICAgIC8vIEFwcGx5IGZpbHRlcmluZyBmaXJzdCAoYWx3YXlzIHJ1bnMgLSBjb250ZW50LWJhc2VkKVxuICAgICAgICAgIGNvbnN0IHBhc3NlZEZpbHRlciA9IHNob3VsZEZpbHRlcihldmVudCwgY29uZmlnLCB7XG4gICAgICAgICAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A6IHRydWUsXG4gICAgICAgICAgICByZWZlcmVuY2VkUGFyZW50U3BhbklkcyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAoIXBhc3NlZEZpbHRlcikge1xuICAgICAgICAgICAgLy8gRmlsdGVyZWQgb3V0IC0gZG9uJ3QgY291bnQgYXMgc2FtcGxlZCBvdXRcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEFwcGx5IHNhbXBsaW5nIGlmIGVuYWJsZWQgKHByb2JhYmlsaXN0aWMpXG4gICAgICAgICAgaWYgKGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCAmJiAhc2hvdWxkU2FtcGxlKGV2ZW50LCBjb25maWcpKSB7XG4gICAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LnNhbXBsZWRPdXQrKztcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFRyYWNrIGNhcHR1cmVkIGV2ZW50IGJyZWFrZG93bnNcbiAgICAgICAgICBjYXB0dXJlZEJ5VHlwZVsgZXZlbnQudHlwZSBdID0gKGNhcHR1cmVkQnlUeXBlWyBldmVudC50eXBlIF0gfHwgMCkgKyAxO1xuICAgICAgICAgIGlmIChldmVudC5vcGVyYXRpb24pIHtcbiAgICAgICAgICAgIGNhcHR1cmVkQnlPcGVyYXRpb25bIGV2ZW50Lm9wZXJhdGlvbiBdID0gKGNhcHR1cmVkQnlPcGVyYXRpb25bIGV2ZW50Lm9wZXJhdGlvbiBdIHx8IDApICsgMTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY2FwdHVyZWRCeUxldmVsWyBldmVudC5sZXZlbCBdID0gKGNhcHR1cmVkQnlMZXZlbFsgZXZlbnQubGV2ZWwgXSB8fCAwKSArIDE7XG4gICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgICAgICAgLy8gUGFzc2VkIGJvdGggZmlsdGVyaW5nIGFuZCBzYW1wbGluZyAtIGVtaXRcbiAgICAgICAgICBjb25zdCB0YXJnZXRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldHMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU3RvcmUgY2FwdHVyZWQgYnJlYWtkb3ducyBpbiBjb250ZXh0IGZvciBzdW1tYXJ5IGNoZWNrcG9pbnRcbiAgICAgICAgaWYgKCFvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bikge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duID0geyBieVR5cGU6IHt9LCBieU9wZXJhdGlvbjoge30sIGJ5TGV2ZWw6IHt9IH07XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBbIHR5cGUsIGNvdW50IF0gb2YgT2JqZWN0LmVudHJpZXMoY2FwdHVyZWRCeVR5cGUpKSB7XG4gICAgICAgICAgb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlUeXBlWyB0eXBlIF0gPSAob2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlUeXBlWyB0eXBlIF0gfHwgMCkgKyBjb3VudDtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFsgb3AsIGNvdW50IF0gb2YgT2JqZWN0LmVudHJpZXMoY2FwdHVyZWRCeU9wZXJhdGlvbikpIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieU9wZXJhdGlvblsgb3AgXSA9IChvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieU9wZXJhdGlvblsgb3AgXSB8fCAwKSArIGNvdW50O1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgWyBsZXZlbCwgY291bnQgXSBvZiBPYmplY3QuZW50cmllcyhjYXB0dXJlZEJ5TGV2ZWwpKSB7XG4gICAgICAgICAgb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlMZXZlbFsgbGV2ZWwgXSA9IChvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieUxldmVsWyBsZXZlbCBdIHx8IDApICsgY291bnQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIElmIGVycm9yT2NjdXJyZWQ9dHJ1ZSwgYnVmZmVyIHdhcyBhbHJlYWR5IGZsdXNoZWQgZHVyaW5nIGNhcHR1cmVcbiAgICB9XG5cbiAgICAvLyBGbHVzaCBhbGwgYmFja2VuZHMgd2l0aCByZXRyeSBsb2dpY1xuICAgIC8vIFdyYXAgZWFjaCBiYWNrZW5kIGZsdXNoIGluIHRyeS1jYXRjaCB0byBlbnN1cmUgYWxsIGJhY2tlbmRzIGF0dGVtcHQgdG8gZmx1c2hcbiAgICAvLyBldmVuIGlmIG9uZSBmYWlscyBjYXRhc3Ryb3BoaWNhbGx5XG4gICAgY29uc3QgTUFYX0ZMVVNIX1JFVFJJRVMgPSAyO1xuICAgIGNvbnN0IGZsdXNoUHJvbWlzZXMgPSBiYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghYmFja2VuZC5mbHVzaCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAobGV0IGF0dGVtcHQgPSAxOyBhdHRlbXB0IDw9IE1BWF9GTFVTSF9SRVRSSUVTOyBhdHRlbXB0KyspIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgYmFja2VuZC5mbHVzaCgpO1xuICAgICAgICAgICAgYnJlYWs7IC8vIFN1Y2Nlc3NcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgaWYgKGF0dGVtcHQgPT09IE1BWF9GTFVTSF9SRVRSSUVTKSB7XG4gICAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIGFmdGVyICR7YXR0ZW1wdH0gYXR0ZW1wdHM6YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAvLyBFdmVudHMgbWF5IGJlIGxvc3QsIGJ1dCB3ZSd2ZSBkb25lIG91ciBiZXN0XG4gICAgICAgICAgICAgIC8vIERvbid0IHRocm93IC0gYWxsb3cgb3RoZXIgYmFja2VuZHMgdG8gZmx1c2hcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGxvZ2dlci53YXJuKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmbHVzaCBmYWlsZWQgKGF0dGVtcHQgJHthdHRlbXB0fS8ke01BWF9GTFVTSF9SRVRSSUVTfSksIHJldHJ5aW5nLi4uYCwgZXJyb3IpO1xuICAgICAgICAgICAgICAvLyBTaW1wbGUgZXhwb25lbnRpYWwgYmFja29mZlxuICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwICogYXR0ZW1wdCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQ2F0Y2ggYW55IHVuZXhwZWN0ZWQgZXJyb3JzIG91dHNpZGUgdGhlIHJldHJ5IGxvb3BcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmbHVzaCBjb21wbGV0ZWx5IGZhaWxlZDpgLCBlcnJvcik7XG4gICAgICAgIC8vIERvbid0IHRocm93IC0gYWxsb3cgb3RoZXIgYmFja2VuZHMgdG8gZmx1c2hcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGZsdXNoUHJvbWlzZXMpO1xuXG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gRkxVU0ggQ09NUExFVEUgPT09Jyk7XG4gIH1cblxuICAvKipcbiAgICogUmVzZXQgbWFuYWdlciBzdGF0ZSAoZm9yIHRlc3RpbmcpXG4gICAqL1xuICBzdGF0aWMgcmVzZXQoKTogdm9pZCB7XG4gICAgY29uZmlnID0gbnVsbDtcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhudWxsKTtcbiAgICBiYWNrZW5kcyA9IFtdO1xuICAgIGJhY2tlbmRDb25maWdzLmNsZWFyKCk7XG4gICAgaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgICBpbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIHNhbXBsaW5nUmVnZXhDYWNoZS5jbGVhcigpO1xuICAgIHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA9IDA7XG4gICAgcmVzZXRDYXB0dXJlcigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgZm9yIHRlc3Rpbmcgd2l0aCBtb2NrIGNvbmZpZyBhbmQgYmFja2VuZHNcbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplRm9yVGVzdGluZyhcbiAgICB0ZXN0Q29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICAgIHRlc3RCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdXG4gICk6IHZvaWQge1xuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLnJlc2V0KCk7XG4gICAgY29uZmlnID0gdGVzdENvbmZpZztcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyh0ZXN0Q29uZmlnKTtcbiAgICBiYWNrZW5kcyA9IHRlc3RCYWNrZW5kcztcbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG5cbiAgICBpbml0aWFsaXplQ2FwdHVyZXIoe1xuICAgICAgY2FwdHVyZTogKGlucHV0KSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKGlucHV0KSxcbiAgICAgIGNhcHR1cmVBc3luYzogKGlucHV0KSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlQXN5bmMoaW5wdXQpLFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogTGFtYmRhIGhhbmRsZXIgd3JhcHBlciB3aXRoIG9ic2VydmFiaWxpdHkgbGlmZWN5Y2xlIG1hbmFnZW1lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHdpdGhPYnNlcnZhYmlsaXR5ID0gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiBQcm9taXNlPHVua25vd24+PihoYW5kbGVyOiBUKTogVCA9PiB7XG4gIHJldHVybiAoYXN5bmMgKC4uLmFyZ3M6IFBhcmFtZXRlcnM8VD4pID0+IHtcbiAgICB0cnkge1xuICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH1cbiAgfSkgYXMgVDtcbn07XG5cbmV4cG9ydCBjb25zdCBPYnNlcnZlciA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFRFU1QgRVhQT1JUUyAtIE9ubHkgZm9yIHRlc3RpbmcgaW50ZXJuYWwgZnVuY3Rpb25zXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuLyoqXG4gKiBFeHBvcnQgcHJpdmF0ZSBmdW5jdGlvbnMgZm9yIHRlc3RpbmcuXG4gKiBUaGVzZSBzaG91bGQgT05MWSBiZSB1c2VkIGluIHRlc3QgZmlsZXMuXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IF9fdGVzdF9fID0ge1xuICBldmljdExvd2VzdFByaW9yaXR5LFxuICBzaG91bGRGaWx0ZXIsXG4gIHNob3VsZFNhbXBsZSxcbiAgZ2V0RXZlbnRQcmlvcml0eSxcbiAgYnVpbGRFdmVudCxcbn07XG4iXX0=