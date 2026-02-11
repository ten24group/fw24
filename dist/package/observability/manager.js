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
const error_fingerprint_1 = require("./utils/error-fingerprint");
const context_1 = require("./context");
const base_1 = require("./observers/base");
const di_1 = require("../di");
const errors_1 = require("../di/errors");
const noise_reduction_1 = require("./noise-reduction");
const span_compression_1 = require("./span-compression");
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
// NOISE REDUCTION INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Unpack EmittedEvent[] from noise reduction into ObservabilityEvent[].
 *
 * For each emitted event:
 * - Sets `_absorbed` if there is absorbed data
 * - Resolves `parentObservabilityLogId` to the nearest emitted ancestor
 */
function unpackEmittedEvents(emittedEvents) {
    const result = [];
    for (const emitted of emittedEvents) {
        // Create a shallow copy to avoid mutating the original event
        const event = { ...emitted.event };
        // Merge absorbed data into event.data (single location, no separate top-level field)
        if (emitted.absorbed) {
            const existingData = event.data ?? {};
            // Convert absorbed checkpoints into GROUPED timeline entries (Elastic APM span compression pattern).
            // Instead of N individual entries for "BaseEntityService.upsert", produces ONE composite entry
            // with aggregate stats and a compact items array of per-item varying fields.
            let checkpoints = existingData.checkpoints ?? [];
            if (emitted.absorbed.checkpoints.length > 0) {
                const groupedEntries = (0, span_compression_1.groupCheckpointsByOperation)(emitted.absorbed.checkpoints);
                checkpoints = [...checkpoints, ...groupedEntries];
            }
            // Store absorbed summary — stripped of byOperation, entityIds, and checkpoints
            // since grouped checkpoint entries now carry that information.
            const absorbedSummary = {
                count: emitted.absorbed.count,
                silentCount: emitted.absorbed.silentCount,
            };
            if (emitted.absorbed.errors.length > 0) {
                absorbedSummary.errors = emitted.absorbed.errors;
            }
            if (emitted.absorbed.causedByLinks.length > 0) {
                absorbedSummary.causedByLinks = emitted.absorbed.causedByLinks;
            }
            event.data = {
                ...existingData,
                checkpoints: checkpoints.length > 0 ? checkpoints : undefined,
                absorbed: absorbedSummary,
            };
        }
        // Attach noise reduction debug info if present
        if (emitted.debugInfo) {
            event.data = {
                ...(event.data ?? {}),
                _noiseDebug: emitted.debugInfo,
            };
        }
        // Resolve parent ID to nearest emitted ancestor.
        // The algorithm's resolvedParentId is authoritative when present.
        if (emitted.resolvedParentId !== undefined) {
            // Algorithm resolved a specific emitted ancestor
            event.parentObservabilityLogId = emitted.resolvedParentId;
        }
        else if (event.parentObservabilityLogId) {
            // resolvedParentId is undefined — check if the original parent is outside this batch
            const parentInBatch = emittedEvents.some(e => e.event.observabilityLogId === event.parentObservabilityLogId);
            if (!parentInBatch) {
                // Parent is outside this batch (cross-batch) — keep original for linking
            }
            else {
                // Parent was in batch but absorbed/silenced — clear stale reference
                event.parentObservabilityLogId = undefined;
            }
        }
        result.push(event);
    }
    return result;
}
// Span compression (groupCheckpointsByOperation) extracted to ./span-compression.ts
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
    // Merge tags: context + input + slow auto-tag
    let mergedTags = (0, source_utils_1.mergeTags)({ ...ctx?.observability?.tags, ...input.tags }, true);
    // Slow request auto-tagging: mark spans exceeding the configured threshold
    const slowThreshold = config?.spans?.slowTagThresholdMs;
    if (slowThreshold != null && input.durationMs != null && input.durationMs > slowThreshold) {
        mergedTags = { ...(mergedTags ?? {}), _slow: 'true' };
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
        tags: mergedTags,
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
        fingerprint: error ? (0, error_fingerprint_1.computeErrorFingerprint)(error) : undefined,
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
            const unpackedEvents = unpackEmittedEvents(reduced.events);
            // Dispatch all events - noise reduction already filtered by minLevel
            for (const bufferedEvent of unpackedEvents) {
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
            const unpackedEvents = unpackEmittedEvents(reduced.events);
            // Dispatch all events - noise reduction already filtered by minLevel
            await Promise.all(unpackedEvents.map(bufferedEvent => {
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
        logger.debug('Source map support enabled - stack traces will show original TypeScript lines');
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
    // Register span lifecycle hooks for backends that implement SpanLifecycleHook.
    // This allows SpanObserver to call OTEL (and other real-time backends) directly
    // instead of routing span.start events through the buffered capture pipeline.
    const hooks = [];
    for (const backend of backends) {
        if (isSpanLifecycleHook(backend)) {
            hooks.push(backend);
        }
    }
    (0, runtime_state_1.setSpanLifecycleHooks)(hooks);
    if (hooks.length > 0) {
        logger.debug(`Registered ${hooks.length} span lifecycle hook(s)`);
    }
}
/** Type guard: check if a backend also implements SpanLifecycleHook. */
function isSpanLifecycleHook(backend) {
    const candidate = backend;
    return typeof candidate.onSpanStart === 'function'
        && typeof candidate.onSpanEnd === 'function';
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
        logger.debug('=== OBSERVABILITY INITIALIZATION COMPLETE ===');
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
            // Block unsupported event types from the capture pipeline.
            // span.start uses SpanLifecycleHook (OTEL), NOT capture pipeline.
            // span.end and span.event are legacy formats.
            if (input.type === 'span.start' || input.type === 'span.end' || input.type === 'span.event') {
                logger.error('Observability: unsupported event type in capture pipeline, dropping.', {
                    type: input.type,
                    operation: input.operation,
                    hint: input.type === 'span.start' ? 'span.start uses SpanLifecycleHook' : 'legacy format not supported',
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
            // Block unsupported event types from the capture pipeline.
            // span.start uses SpanLifecycleHook (OTEL), NOT capture pipeline.
            // span.end and span.event are legacy formats.
            if (input.type === 'span.start' || input.type === 'span.end' || input.type === 'span.event') {
                logger.error('Observability: unsupported event type in capture pipeline, dropping.', {
                    type: input.type,
                    operation: input.operation,
                    hint: input.type === 'span.start' ? 'span.start uses SpanLifecycleHook' : 'legacy format not supported',
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
                // Noise reduction may absorb/silence events, but their parent spans must still be kept
                const referencedParentSpanIds = new Set();
                for (const e of buffer) {
                    const pid = e.parentObservabilityLogId ?? undefined;
                    if (pid)
                        referencedParentSpanIds.add(pid);
                }
                const reduced = (0, noise_reduction_1.applyNoiseReduction)(buffer, config.noiseReduction);
                const reducedEvents = unpackEmittedEvents(reduced.events);
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
                // Enrich root span with invocation summary (compact overview of what happened)
                const rootSpan = maybeDropEmptyLeafSpans.find(e => e.type === 'span' && !e.parentObservabilityLogId);
                if (rootSpan) {
                    const summaryByType = {};
                    const summaryByLevel = {};
                    let errorCount = 0;
                    for (const e of maybeDropEmptyLeafSpans) {
                        summaryByType[e.type] = (summaryByType[e.type] || 0) + 1;
                        summaryByLevel[e.level] = (summaryByLevel[e.level] || 0) + 1;
                        if (e.level === 'error' || e.level === 'critical')
                            errorCount++;
                    }
                    rootSpan.data = {
                        ...(rootSpan.data ?? {}),
                        _invocationSummary: {
                            totalEvents: maybeDropEmptyLeafSpans.length,
                            byType: summaryByType,
                            byLevel: summaryByLevel,
                            hasErrors: errorCount > 0,
                            errorCount,
                            noiseReduction: reduced.stats,
                        },
                    };
                }
                // Track captured events for detailed summary
                const capturedByType = {};
                const capturedByOperation = {};
                const capturedByLevel = {};
                for (const event of maybeDropEmptyLeafSpans) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILHVEQUFrRjtBQUNsRix3Q0FBMEM7QUFDMUMsbUNBU2lCO0FBR2pCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELGlFQUFvRTtBQUNwRSx1Q0FBd0U7QUFDeEUsMkNBQXFFO0FBQ3JFLDhCQUFvQztBQUNwQyx5Q0FBb0Q7QUFDcEQsdURBQTJFO0FBQzNFLHlEQUFpRTtBQUVqRSxxQ0FBb0Y7QUFDcEYsbURBQXlHO0FBQ3pHLHlEQUF1RTtBQUV2RSxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQU9wRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxJQUFJLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0FBQzlDLElBQUksUUFBUSxHQUEyQixFQUFFLENBQUM7QUFDMUMsSUFBSSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQWtELENBQUM7QUFDL0UsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztBQUN4QixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBQ3JELE1BQU0saUJBQWlCLEdBQW9CLEVBQUUsQ0FBQyxDQUFDLDZDQUE2QztBQUU1Rjs7O0dBR0c7QUFDSCxNQUFNLFlBQVksR0FBc0IsRUFBRSxDQUFDO0FBRTNDLDhFQUE4RTtBQUM5RSw4QkFBOEI7QUFDOUIsOEVBQThFO0FBRTlFOzs7Ozs7R0FNRztBQUNILFNBQVMsbUJBQW1CLENBQUMsYUFBc0M7SUFDakUsTUFBTSxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUV4QyxLQUFLLE1BQU0sT0FBTyxJQUFJLGFBQWEsRUFBRSxDQUFDO1FB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QUM7UUFFbkIsSUFBQSx5QkFBa0IsRUFBQztZQUNqQixPQUFPLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDdkQsWUFBWSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDO1NBQ2xFLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWxnQkQsb0RBa2dCQztBQUVEOztHQUVHO0FBQ0ksTUFBTSxpQkFBaUIsR0FBRyxDQUFxRCxPQUFVLEVBQUssRUFBRTtJQUNyRyxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsSUFBbUIsRUFBRSxFQUFFO1FBQ3ZDLElBQUksQ0FBQztZQUNILG9CQUFvQixDQUFDLG9CQUFvQixFQUFFLENBQUM7WUFDNUMsT0FBTyxNQUFNLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO1FBQ2hDLENBQUM7Z0JBQVMsQ0FBQztZQUNULE1BQU0sb0JBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckMsQ0FBQztJQUNILENBQUMsQ0FBTSxDQUFDO0FBQ1YsQ0FBQyxDQUFDO0FBVFcsUUFBQSxpQkFBaUIscUJBUzVCO0FBRVcsUUFBQSxRQUFRLEdBQUcsb0JBQW9CLENBQUM7QUFFN0MsOEVBQThFO0FBQzlFLHFEQUFxRDtBQUNyRCw4RUFBOEU7QUFFOUU7Ozs7R0FJRztBQUNVLFFBQUEsUUFBUSxHQUFHO0lBQ3RCLG1CQUFtQjtJQUNuQixZQUFZO0lBQ1osWUFBWTtJQUNaLGdCQUFnQjtJQUNoQixVQUFVO0NBQ1gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eU1hbmFnZXIgLSBDb3JlIE9ic2VydmVyIGZvciB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW1cbiAqIFxuICogQWxsIGNvbmZpZyBhbmQgYmFja2VuZHMgcmVzb2x2ZWQgZnJvbSBESSAtIG5vIG1hbnVhbCBpbnN0YW50aWF0aW9uLlxuICovXG5cbmltcG9ydCB7IGdlbmVyYXRlU3BhbklkLCBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZCB9IGZyb20gJy4vdXRpbHMvaWQtZ2VuZXJhdG9yJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHtcbiAgQ2FwdHVyZUNvbnRyb2wsXG4gIENhcHR1cmVJbnB1dCxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlFcnJvcixcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBPYnNlcnZhYmlsaXR5TGV2ZWwsXG4gIFNhbXBsaW5nUnVsZSxcbn0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IFNwYW5MaWZlY3ljbGVIb29rIH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgdHlwZSB7IE9ic2VydmFiaWxpdHlTdW1tYXJ5IH0gZnJvbSAnLi4vY29yZS9ydW50aW1lL2V4ZWN1dGlvbi1jb250ZXh0L3R5cGVzJztcbmltcG9ydCB7IHN0cmluZ1RvTGV2ZWwsIGxldmVsVG9TdHJpbmcgfSBmcm9tICcuL3V0aWxzL2xldmVsLXV0aWxzJztcbmltcG9ydCB7IGRldGVjdFNvdXJjZSwgbWVyZ2VUYWdzIH0gZnJvbSAnLi91dGlscy9zb3VyY2UtdXRpbHMnO1xuaW1wb3J0IHsgcmVkYWN0U2Vuc2l0aXZlRGF0YSB9IGZyb20gJy4vdXRpbHMvZGF0YS1wcm90ZWN0aW9uJztcbmltcG9ydCB7IGNvbXB1dGVFcnJvckZpbmdlcnByaW50IH0gZnJvbSAnLi91dGlscy9lcnJvci1maW5nZXJwcmludCc7XG5pbXBvcnQgeyBnZXRDdXJyZW50Q29udGV4dCwgZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzIH0gZnJvbSAnLi9jb250ZXh0JztcbmltcG9ydCB7IGluaXRpYWxpemVDYXB0dXJlciwgcmVzZXRDYXB0dXJlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBOb1Byb3ZpZGVyRm91bmRFcnJvciB9IGZyb20gJy4uL2RpL2Vycm9ycyc7XG5pbXBvcnQgeyBhcHBseU5vaXNlUmVkdWN0aW9uLCB0eXBlIEVtaXR0ZWRFdmVudCB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uJztcbmltcG9ydCB7IGdyb3VwQ2hlY2twb2ludHNCeU9wZXJhdGlvbiB9IGZyb20gJy4vc3Bhbi1jb21wcmVzc2lvbic7XG5pbXBvcnQgeyBidWlsZFRyYWNlR3JhcGggfSBmcm9tICcuL3RyYWNlLWdyYXBoJztcbmltcG9ydCB7IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcsIHR5cGUgT2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0IH0gZnJvbSAnLi9jb25maWcnO1xuaW1wb3J0IHsgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcsIHJ1blNwYW5GaW5hbGl6ZXIsIHNldFNwYW5MaWZlY3ljbGVIb29rcyB9IGZyb20gJy4vcnVudGltZS1zdGF0ZSc7XG5pbXBvcnQgeyBtYXRjaGVzUGF0dGVybiwgcmVwbGFjZVBhdHRlcm4gfSBmcm9tICcuL3V0aWxzL3BhdHRlcm4tdXRpbHMnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmFiaWxpdHlNYW5hZ2VyJyk7XG5cbmludGVyZmFjZSBWYWxpZGF0aW9uRXJyb3Ige1xuICBmaWVsZDogc3RyaW5nO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBNT0RVTEUgU1RBVEVcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5sZXQgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCA9IG51bGw7XG5sZXQgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcbmxldCBiYWNrZW5kQ29uZmlncyA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnYmFja2VuZHMnIF1bIDAgXT4oKTtcbmxldCBpbnZvY2F0aW9uQ291bnQgPSAwO1xubGV0IGluaXRpYWxpemVkID0gZmFsc2U7XG5jb25zdCBzYW1wbGluZ1JlZ2V4Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUmVnRXhwPigpO1xuY29uc3QgcGVuZGluZ0Rpc3BhdGNoZXM6IFByb21pc2U8dm9pZD5bXSA9IFtdOyAvLyBUcmFjayBmaXJlLWFuZC1mb3JnZXQgcHJvbWlzZXMgZm9yIGZsdXNoKClcblxuLyoqXG4gKiBQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgLSBjYWxsYmFja3MgdGhhdCBydW4gYmVmb3JlIGJhY2tlbmRzIGFyZSBpbml0aWFsaXplZC5cbiAqIFVzZWQgdG8gcmVnaXN0ZXIgc2NoZW1hcy9zZXJ2aWNlcyBuZWVkZWQgYnkgYmFja2VuZHMgd2l0aG91dCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gKi9cbmNvbnN0IHByZUluaXRIb29rczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBOT0lTRSBSRURVQ1RJT04gSU5URUdSQVRJT05cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIFVucGFjayBFbWl0dGVkRXZlbnRbXSBmcm9tIG5vaXNlIHJlZHVjdGlvbiBpbnRvIE9ic2VydmFiaWxpdHlFdmVudFtdLlxuICogXG4gKiBGb3IgZWFjaCBlbWl0dGVkIGV2ZW50OlxuICogLSBTZXRzIGBfYWJzb3JiZWRgIGlmIHRoZXJlIGlzIGFic29yYmVkIGRhdGFcbiAqIC0gUmVzb2x2ZXMgYHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZGAgdG8gdGhlIG5lYXJlc3QgZW1pdHRlZCBhbmNlc3RvclxuICovXG5mdW5jdGlvbiB1bnBhY2tFbWl0dGVkRXZlbnRzKGVtaXR0ZWRFdmVudHM6IHJlYWRvbmx5IEVtaXR0ZWRFdmVudFtdKTogT2JzZXJ2YWJpbGl0eUV2ZW50W10ge1xuICBjb25zdCByZXN1bHQ6IE9ic2VydmFiaWxpdHlFdmVudFtdID0gW107XG5cbiAgZm9yIChjb25zdCBlbWl0dGVkIG9mIGVtaXR0ZWRFdmVudHMpIHtcbiAgICAvLyBDcmVhdGUgYSBzaGFsbG93IGNvcHkgdG8gYXZvaWQgbXV0YXRpbmcgdGhlIG9yaWdpbmFsIGV2ZW50XG4gICAgY29uc3QgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCA9IHsgLi4uZW1pdHRlZC5ldmVudCB9O1xuXG4gICAgLy8gTWVyZ2UgYWJzb3JiZWQgZGF0YSBpbnRvIGV2ZW50LmRhdGEgKHNpbmdsZSBsb2NhdGlvbiwgbm8gc2VwYXJhdGUgdG9wLWxldmVsIGZpZWxkKVxuICAgIGlmIChlbWl0dGVkLmFic29yYmVkKSB7XG4gICAgICBjb25zdCBleGlzdGluZ0RhdGEgPSBldmVudC5kYXRhID8/IHt9O1xuXG4gICAgICAvLyBDb252ZXJ0IGFic29yYmVkIGNoZWNrcG9pbnRzIGludG8gR1JPVVBFRCB0aW1lbGluZSBlbnRyaWVzIChFbGFzdGljIEFQTSBzcGFuIGNvbXByZXNzaW9uIHBhdHRlcm4pLlxuICAgICAgLy8gSW5zdGVhZCBvZiBOIGluZGl2aWR1YWwgZW50cmllcyBmb3IgXCJCYXNlRW50aXR5U2VydmljZS51cHNlcnRcIiwgcHJvZHVjZXMgT05FIGNvbXBvc2l0ZSBlbnRyeVxuICAgICAgLy8gd2l0aCBhZ2dyZWdhdGUgc3RhdHMgYW5kIGEgY29tcGFjdCBpdGVtcyBhcnJheSBvZiBwZXItaXRlbSB2YXJ5aW5nIGZpZWxkcy5cbiAgICAgIGxldCBjaGVja3BvaW50cyA9IChleGlzdGluZ0RhdGEuY2hlY2twb2ludHMgYXMgdW5rbm93bltdKSA/PyBbXTtcbiAgICAgIGlmIChlbWl0dGVkLmFic29yYmVkLmNoZWNrcG9pbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgZ3JvdXBlZEVudHJpZXMgPSBncm91cENoZWNrcG9pbnRzQnlPcGVyYXRpb24oZW1pdHRlZC5hYnNvcmJlZC5jaGVja3BvaW50cyk7XG4gICAgICAgIGNoZWNrcG9pbnRzID0gWy4uLmNoZWNrcG9pbnRzLCAuLi5ncm91cGVkRW50cmllc107XG4gICAgICB9XG5cbiAgICAgIC8vIFN0b3JlIGFic29yYmVkIHN1bW1hcnkg4oCUIHN0cmlwcGVkIG9mIGJ5T3BlcmF0aW9uLCBlbnRpdHlJZHMsIGFuZCBjaGVja3BvaW50c1xuICAgICAgLy8gc2luY2UgZ3JvdXBlZCBjaGVja3BvaW50IGVudHJpZXMgbm93IGNhcnJ5IHRoYXQgaW5mb3JtYXRpb24uXG4gICAgICBjb25zdCBhYnNvcmJlZFN1bW1hcnk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgICBjb3VudDogZW1pdHRlZC5hYnNvcmJlZC5jb3VudCxcbiAgICAgICAgc2lsZW50Q291bnQ6IGVtaXR0ZWQuYWJzb3JiZWQuc2lsZW50Q291bnQsXG4gICAgICB9O1xuICAgICAgaWYgKGVtaXR0ZWQuYWJzb3JiZWQuZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYWJzb3JiZWRTdW1tYXJ5LmVycm9ycyA9IGVtaXR0ZWQuYWJzb3JiZWQuZXJyb3JzO1xuICAgICAgfVxuICAgICAgaWYgKGVtaXR0ZWQuYWJzb3JiZWQuY2F1c2VkQnlMaW5rcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGFic29yYmVkU3VtbWFyeS5jYXVzZWRCeUxpbmtzID0gZW1pdHRlZC5hYnNvcmJlZC5jYXVzZWRCeUxpbmtzO1xuICAgICAgfVxuXG4gICAgICBldmVudC5kYXRhID0ge1xuICAgICAgICAuLi5leGlzdGluZ0RhdGEsXG4gICAgICAgIGNoZWNrcG9pbnRzOiBjaGVja3BvaW50cy5sZW5ndGggPiAwID8gY2hlY2twb2ludHMgOiB1bmRlZmluZWQsXG4gICAgICAgIGFic29yYmVkOiBhYnNvcmJlZFN1bW1hcnksXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIEF0dGFjaCBub2lzZSByZWR1Y3Rpb24gZGVidWcgaW5mbyBpZiBwcmVzZW50XG4gICAgaWYgKGVtaXR0ZWQuZGVidWdJbmZvKSB7XG4gICAgICBldmVudC5kYXRhID0ge1xuICAgICAgICAuLi4oZXZlbnQuZGF0YSA/PyB7fSksXG4gICAgICAgIF9ub2lzZURlYnVnOiBlbWl0dGVkLmRlYnVnSW5mbyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBwYXJlbnQgSUQgdG8gbmVhcmVzdCBlbWl0dGVkIGFuY2VzdG9yLlxuICAgIC8vIFRoZSBhbGdvcml0aG0ncyByZXNvbHZlZFBhcmVudElkIGlzIGF1dGhvcml0YXRpdmUgd2hlbiBwcmVzZW50LlxuICAgIGlmIChlbWl0dGVkLnJlc29sdmVkUGFyZW50SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gQWxnb3JpdGhtIHJlc29sdmVkIGEgc3BlY2lmaWMgZW1pdHRlZCBhbmNlc3RvclxuICAgICAgZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gZW1pdHRlZC5yZXNvbHZlZFBhcmVudElkO1xuICAgIH0gZWxzZSBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSB7XG4gICAgICAvLyByZXNvbHZlZFBhcmVudElkIGlzIHVuZGVmaW5lZCDigJQgY2hlY2sgaWYgdGhlIG9yaWdpbmFsIHBhcmVudCBpcyBvdXRzaWRlIHRoaXMgYmF0Y2hcbiAgICAgIGNvbnN0IHBhcmVudEluQmF0Y2ggPSBlbWl0dGVkRXZlbnRzLnNvbWUoZSA9PiBlLmV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCA9PT0gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKTtcbiAgICAgIGlmICghcGFyZW50SW5CYXRjaCkge1xuICAgICAgICAvLyBQYXJlbnQgaXMgb3V0c2lkZSB0aGlzIGJhdGNoIChjcm9zcy1iYXRjaCkg4oCUIGtlZXAgb3JpZ2luYWwgZm9yIGxpbmtpbmdcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFBhcmVudCB3YXMgaW4gYmF0Y2ggYnV0IGFic29yYmVkL3NpbGVuY2VkIOKAlCBjbGVhciBzdGFsZSByZWZlcmVuY2VcbiAgICAgICAgZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJlc3VsdC5wdXNoKGV2ZW50KTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIFNwYW4gY29tcHJlc3Npb24gKGdyb3VwQ2hlY2twb2ludHNCeU9wZXJhdGlvbikgZXh0cmFjdGVkIHRvIC4vc3Bhbi1jb21wcmVzc2lvbi50c1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBSSVZBVEUgSEVMUEVSIEZVTkNUSU9OU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmZ1bmN0aW9uIHZhbGlkYXRlSW5wdXQoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IFZhbGlkYXRpb25FcnJvcltdIHtcbiAgY29uc3QgZXJyb3JzOiBWYWxpZGF0aW9uRXJyb3JbXSA9IFtdO1xuICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICBpZiAoIWlucHV0LnR5cGUpIHtcbiAgICBlcnJvcnMucHVzaCh7IGZpZWxkOiAndHlwZScsIG1lc3NhZ2U6ICd0eXBlIGlzIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGlmICghaW5wdXQubGV2ZWwpIHtcbiAgICBlcnJvcnMucHVzaCh7IGZpZWxkOiAnbGV2ZWwnLCBtZXNzYWdlOiAnbGV2ZWwgaXMgcmVxdWlyZWQnIH0pO1xuICB9XG5cbiAgaWYgKCFpbnB1dC5jb3JyZWxhdGlvbklkICYmICFjb250ZXh0Py5jb3JyZWxhdGlvbklkKSB7XG4gICAgZXJyb3JzLnB1c2goe1xuICAgICAgZmllbGQ6ICdjb3JyZWxhdGlvbklkJyxcbiAgICAgIG1lc3NhZ2U6ICdjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkLiBDb250ZXh0IGlzIGF1dG8tZXN0YWJsaXNoZWQgaW4gY29udHJvbGxlcnMsIG9yIHVzZSBydW5XaXRoRXhlY3V0aW9uQ29udGV4dCgpLidcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBlcnJvcnM7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gIGlucHV0OiBDYXB0dXJlSW5wdXQsXG4gIGRhdGFQcm90ZWN0aW9uPzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ2RhdGFQcm90ZWN0aW9uJyBdXG4pOiB7XG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGVycm9yPzogT2JzZXJ2YWJpbGl0eUVycm9yO1xufSB7XG4gIGlmICghZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZGF0YTogaW5wdXQuZGF0YSxcbiAgICAgIGF0dHJpYnV0ZXM6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgICBtZXRhZGF0YTogaW5wdXQubWV0YWRhdGEsXG4gICAgICBjb250ZXh0OiBpbnB1dC5jb250ZXh0LFxuICAgICAgZXJyb3I6IGlucHV0LmVycm9yLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBmaWVsZHMgPSBkYXRhUHJvdGVjdGlvbi5maWVsZHMgPz8gWyAnZGF0YScsICdhdHRyaWJ1dGVzJywgJ21ldGFkYXRhJywgJ2NvbnRleHQnIF07XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhOiBmaWVsZHMuaW5jbHVkZXMoJ2RhdGEnKSAmJiBpbnB1dC5kYXRhXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuZGF0YSwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmRhdGEsXG4gICAgYXR0cmlidXRlczogZmllbGRzLmluY2x1ZGVzKCdhdHRyaWJ1dGVzJykgJiYgaW5wdXQuYXR0cmlidXRlc1xuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmF0dHJpYnV0ZXMsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgIG1ldGFkYXRhOiBmaWVsZHMuaW5jbHVkZXMoJ21ldGFkYXRhJykgJiYgaW5wdXQubWV0YWRhdGFcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5tZXRhZGF0YSwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0Lm1ldGFkYXRhLFxuICAgIGNvbnRleHQ6IGZpZWxkcy5pbmNsdWRlcygnY29udGV4dCcpICYmIGlucHV0LmNvbnRleHRcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5jb250ZXh0LCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuY29udGV4dCxcbiAgICBlcnJvcjogZmllbGRzLmluY2x1ZGVzKCdlcnJvcicpICYmIGlucHV0LmVycm9yXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuZXJyb3IsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5lcnJvcixcbiAgfTtcbn1cblxuZnVuY3Rpb24gYnVpbGRFdmVudChpbnB1dDogQ2FwdHVyZUlucHV0LCBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD4gfCBudWxsID0gbnVsbCk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gIGNvbnN0IGN0eCA9IGNvbnRleHQgPz8gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcblxuICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW5wdXQuY29ycmVsYXRpb25JZCA/PyBjdHg/LmNvcnJlbGF0aW9uSWQ7XG4gIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZCAtIHRoaXMgc2hvdWxkIGhhdmUgYmVlbiBjYXVnaHQgYnkgdmFsaWRhdGlvbicpO1xuICB9XG5cbiAgY29uc3QgeyBkYXRhLCBhdHRyaWJ1dGVzLCBtZXRhZGF0YSwgY29udGV4dDogZXZlbnRDb250ZXh0LCBlcnJvciB9ID0gYXBwbHlEYXRhUHJvdGVjdGlvbihcbiAgICBpbnB1dCxcbiAgICBjb25maWc/LmRhdGFQcm90ZWN0aW9uXG4gICk7XG5cbiAgLy8gT3BlcmF0aW9uIG5vcm1hbGl6YXRpb24gKHJlZHVjZSBjYXJkaW5hbGl0eSArIGltcHJvdmUgY3Jvc3MtYmFja2VuZCBjb25zaXN0ZW5jeSlcbiAgY29uc3Qgb3BOb3JtID0gY29uZmlnPy5vcGVyYXRpb25Ob3JtYWxpemF0aW9uO1xuICBsZXQgb3BlcmF0aW9uID0gaW5wdXQub3BlcmF0aW9uO1xuICBsZXQgb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICBpZiAob3BOb3JtPy5lbmFibGVkICYmIG9wZXJhdGlvbikge1xuICAgIGNvbnN0IG9yaWdpbmFsT3BlcmF0aW9uID0gb3BlcmF0aW9uO1xuICAgIGNvbnN0IGFwcGxpZWRSdWxlczogQXJyYXk8eyBpZDogc3RyaW5nOyBmcm9tOiBzdHJpbmc7IHRvOiBzdHJpbmc7IHJlYXNvbj86IHN0cmluZyB9PiA9IFtdO1xuICAgIGNvbnN0IHR5cGVNYXRjaCA9IChcbiAgICAgIHJ1bGVUeXBlczogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ29wZXJhdGlvbk5vcm1hbGl6YXRpb24nIF1bICdydWxlcycgXVsgbnVtYmVyIF1bICd0eXBlcycgXSB8IHVuZGVmaW5lZCxcbiAgICAgIGV2ZW50VHlwZTogc3RyaW5nXG4gICAgKSA9PiB7XG4gICAgICBpZiAoIXJ1bGVUeXBlcykgcmV0dXJuIHRydWU7XG4gICAgICBjb25zdCBhcnIgPSBBcnJheS5pc0FycmF5KHJ1bGVUeXBlcykgPyBydWxlVHlwZXMgOiBbIHJ1bGVUeXBlcyBdO1xuICAgICAgLy8gQ29tcGFyZSBieSBzdHJpbmcgdG8gYXZvaWQgdW5zYWZlIGNhc3RpbmcgKE9ic2VydmFiaWxpdHlFdmVudFR5cGUgaXMgc3RyaW5nLWJhc2VkIGFueXdheSkuXG4gICAgICByZXR1cm4gYXJyLm1hcChTdHJpbmcpLmluY2x1ZGVzKGV2ZW50VHlwZSk7XG4gICAgfTtcblxuICAgIGZvciAoY29uc3QgcnVsZSBvZiBvcE5vcm0ucnVsZXMgPz8gW10pIHtcbiAgICAgIGlmICghdHlwZU1hdGNoKHJ1bGUudHlwZXMsIGlucHV0LnR5cGUpKSBjb250aW51ZTtcbiAgICAgIGlmICghbWF0Y2hlc1BhdHRlcm4ob3BlcmF0aW9uLCBydWxlLm1hdGNoKSkgY29udGludWU7XG4gICAgICBjb25zdCBuZXh0ID0gcmVwbGFjZVBhdHRlcm4ob3BlcmF0aW9uLCBydWxlLm1hdGNoLCBydWxlLnJlcGxhY2UpO1xuICAgICAgaWYgKG5leHQgIT09IG9wZXJhdGlvbikge1xuICAgICAgICBhcHBsaWVkUnVsZXMucHVzaCh7IGlkOiBydWxlLmlkLCBmcm9tOiBvcGVyYXRpb24sIHRvOiBuZXh0LCByZWFzb246IHJ1bGUucmVhc29uIH0pO1xuICAgICAgICBvcGVyYXRpb24gPSBuZXh0O1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9ubHkgYXR0YWNoIG1ldGEgaWYgdGhlIG9wZXJhdGlvbiBhY3R1YWxseSBjaGFuZ2VkXG4gICAgaWYgKG9wTm9ybS5zdG9yZU9yaWdpbmFsICE9PSBmYWxzZSAmJiBvcGVyYXRpb24gIT09IG9yaWdpbmFsT3BlcmF0aW9uKSB7XG4gICAgICBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YSA9IHtcbiAgICAgICAgZnJvbTogb3JpZ2luYWxPcGVyYXRpb24sXG4gICAgICAgIHRvOiBvcGVyYXRpb24sXG4gICAgICAgIHJ1bGVJZHM6IGFwcGxpZWRSdWxlcy5tYXAociA9PiByLmlkKSxcbiAgICAgICAgcnVsZXM6IGFwcGxpZWRSdWxlcyxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gTWVyZ2UgdGFnczogY29udGV4dCArIGlucHV0ICsgc2xvdyBhdXRvLXRhZ1xuICBsZXQgbWVyZ2VkVGFncyA9IG1lcmdlVGFncyh7IC4uLmN0eD8ub2JzZXJ2YWJpbGl0eT8udGFncywgLi4uaW5wdXQudGFncyB9LCB0cnVlKTtcblxuICAvLyBTbG93IHJlcXVlc3QgYXV0by10YWdnaW5nOiBtYXJrIHNwYW5zIGV4Y2VlZGluZyB0aGUgY29uZmlndXJlZCB0aHJlc2hvbGRcbiAgY29uc3Qgc2xvd1RocmVzaG9sZCA9IGNvbmZpZz8uc3BhbnM/LnNsb3dUYWdUaHJlc2hvbGRNcztcbiAgaWYgKHNsb3dUaHJlc2hvbGQgIT0gbnVsbCAmJiBpbnB1dC5kdXJhdGlvbk1zICE9IG51bGwgJiYgaW5wdXQuZHVyYXRpb25NcyA+IHNsb3dUaHJlc2hvbGQpIHtcbiAgICBtZXJnZWRUYWdzID0geyAuLi4obWVyZ2VkVGFncyA/PyB7fSksIF9zbG93OiAndHJ1ZScgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICBsZXZlbDogaW5wdXQubGV2ZWwsXG4gICAgY29ycmVsYXRpb25JZCxcbiAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gbm93LFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkKGNvcnJlbGF0aW9uSWQpLFxuICAgIC8vIG51bGwgPSBleHBsaWNpdGx5IG5vIHBhcmVudCAtIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBzaG91bGQgYmUgcmVzb2x2ZWQgYnkgY2FsbGVyIChzcGFuIHRyZWUpXG4gICAgLy8gdW5kZWZpbmVkID0gdXNlIHdoYXQgd2FzIHByb3ZpZGVkXG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgY2F1c2VkQnk6IGlucHV0LmNhdXNlZEJ5LFxuICAgIHJlbGF0ZWRUcmFjZXM6IGlucHV0LnJlbGF0ZWRUcmFjZXMsXG4gICAgYWN0b3I6IGlucHV0LmFjdG9yID8/IGN0eD8uYWN0b3IsXG4gICAgc291cmNlOiBpbnB1dC5zb3VyY2UgPz8gY3R4Py5vYnNlcnZhYmlsaXR5Py5zb3VyY2UgPz8gZGV0ZWN0U291cmNlKCksXG4gICAgdGFnczogbWVyZ2VkVGFncyxcbiAgICBlbnRpdHlOYW1lOiBpbnB1dC5lbnRpdHlOYW1lLFxuICAgIGVudGl0eUlkOiBpbnB1dC5lbnRpdHlJZCxcbiAgICBvcGVyYXRpb24sXG4gICAgc3ViVHlwZTogaW5wdXQuc3ViVHlwZSxcbiAgICBzdGF0dXM6IGlucHV0LnN0YXR1cyxcbiAgICBzdWNjZXNzOiBpbnB1dC5zdWNjZXNzLFxuICAgIGR1cmF0aW9uTXM6IGlucHV0LmR1cmF0aW9uTXMsXG4gICAgZGF0YTogb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGFcbiAgICAgID8geyAuLi4oZGF0YSA/PyB7fSksIG9wZXJhdGlvbk5vcm1hbGl6YXRpb246IG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhIH1cbiAgICAgIDogZGF0YSxcbiAgICBhdHRyaWJ1dGVzLFxuICAgIG1ldGFkYXRhLFxuICAgIG1ldHJpY3M6IGlucHV0Lm1ldHJpY3MsXG4gICAgY29udGV4dDogZXZlbnRDb250ZXh0LFxuICAgIGVycm9yLFxuICAgIGZpbmdlcnByaW50OiBlcnJvciA/IGNvbXB1dGVFcnJvckZpbmdlcnByaW50KGVycm9yKSA6IHVuZGVmaW5lZCxcbiAgICBjYXB0dXJlOiBpbnB1dC5jYXB0dXJlLFxuICB9O1xufVxuXG4vKipcbiAqIENhdGVnb3JpemUgZXZlbnQgdHlwZSBmb3IgYmFja2VuZCByb3V0aW5nIGFuZCBzYW1wbGluZ1xuICogXG4gKiBDdXN0b20gZXZlbnQgdHlwZXMgYXJlIHN1cHBvcnRlZCEgVXNlIGFueSBuYW1pbmcgY29udmVudGlvbjpcbiAqIC0gJ2J1c2luZXNzLm9yZGVyX3BsYWNlZCcg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiAtICdwYXltZW50LnRyYW5zYWN0aW9uJyDihpIgY2F0ZWdvcml6ZWQgYXMgJ2xvZydcbiAqIC0gJ25vdGlmaWNhdGlvbi5zZW50JyDihpIgY2F0ZWdvcml6ZWQgYXMgJ2xvZydcbiAqIFxuICogVG8gY29udHJvbCBiYWNrZW5kIHJvdXRpbmcgZm9yIGN1c3RvbSB0eXBlcywgdXNlIHR5cGUtc3BlY2lmaWMgY29uZmlnOlxuICogYGBgXG4gKiBvYnNlcnZhYmlsaXR5OiB7XG4gKiAgIHR5cGVzOiB7XG4gKiAgICAgbG9nOiB7IGJhY2tlbmRzOiBbJ2Nsb3Vkd2F0Y2gnLCAnZHluYW1vZGInXSB9XG4gKiAgIH1cbiAqIH1cbiAqIGBgYFxuICovXG5mdW5jdGlvbiBnZXRUeXBlQ2F0ZWdvcnkodHlwZTogc3RyaW5nKTogJ3NwYW4nIHwgJ21ldHJpYycgfCAnYXVkaXQnIHwgJ2xvZycge1xuICAvLyAnc3BhbicgPSBjb25zb2xpZGF0ZWQgc3BhbiByZWNvcmQsICdzcGFuLnN0YXJ0JyA9IE9URUwtb25seSBzdGFydCBtYXJrZXIuXG4gIC8vIEZXMjQgZG9lcyBOT1Qgc3VwcG9ydCBsZWdhY3kgc3Bhbi4qIHJlY29yZCBmb3JtYXRzIChubyBjb21wYXRpYmlsaXR5IGd1YXJhbnRlZXMpLlxuICBpZiAodHlwZSA9PT0gJ3NwYW4nIHx8IHR5cGUgPT09ICdzcGFuLnN0YXJ0JykgcmV0dXJuICdzcGFuJztcbiAgaWYgKHR5cGUgPT09ICdtZXRyaWMnKSByZXR1cm4gJ21ldHJpYyc7XG4gIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0JykpIHJldHVybiAnYXVkaXQnO1xuICAvLyBBbGwgY3VzdG9tIGV2ZW50IHR5cGVzIGRlZmF1bHQgdG8gJ2xvZycgY2F0ZWdvcnlcbiAgLy8gVGhpcyBpbmNsdWRlczogJ2J1c2luZXNzLionLCAncGF5bWVudC4qJywgJ25vdGlmaWNhdGlvbi4qJywgZXRjLlxuICByZXR1cm4gJ2xvZyc7XG59XG5cbmZ1bmN0aW9uIGdldEJhY2tlbmRzRm9yVHlwZSh0eXBlOiBzdHJpbmcpOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdIHtcbiAgY29uc3QgdHlwZUNhdGVnb3J5ID0gZ2V0VHlwZUNhdGVnb3J5KHR5cGUpO1xuICBjb25zdCB0eXBlQ29uZmlnID0gY29uZmlnPy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcblxuICBpZiAodHlwZUNvbmZpZz8uYmFja2VuZHMgJiYgdHlwZUNvbmZpZy5iYWNrZW5kcy5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIGJhY2tlbmRzLmZpbHRlcigoYikgPT4gdHlwZUNvbmZpZy5iYWNrZW5kcyEuaW5jbHVkZXMoYi5uYW1lIGFzICdjbG91ZHdhdGNoJyB8ICdkeW5hbW9kYicgfCAnb3RlbCcpKTtcbiAgfVxuXG4gIHJldHVybiBiYWNrZW5kcztcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBiYWNrZW5kIHNob3VsZCBjYXB0dXJlIHRoaXMgZXZlbnQgYmFzZWQgb24gdHlwZSBmaWx0ZXJpbmdcbiAqL1xuZnVuY3Rpb24gc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKFxuICBiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudFxuKTogYm9vbGVhbiB7XG4gIC8vIFBlci1ldmVudCBiYWNrZW5kIGZpbHRlciAodXNlZCBmb3IgT1RFTCBzcGFuIHRyYWNraW5nIGluIGNvbnNvbGlkYXRlZCBtb2RlKVxuICBpZiAoZXZlbnQuY2FwdHVyZT8uYmFja2VuZHMgJiYgZXZlbnQuY2FwdHVyZS5iYWNrZW5kcy5sZW5ndGggPiAwKSB7XG4gICAgaWYgKCFldmVudC5jYXB0dXJlLmJhY2tlbmRzLmluY2x1ZGVzKGJhY2tlbmQubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGJhY2tlbmRDZmcgPSBiYWNrZW5kQ29uZmlncy5nZXQoYmFja2VuZC5uYW1lKTtcbiAgaWYgKCFiYWNrZW5kQ2ZnKSByZXR1cm4gdHJ1ZTsgLy8gTm8gY29uZmlnID0gYWxsb3cgYWxsXG5cbiAgY29uc3QgdHlwZUNhdGVnb3J5ID0gZ2V0VHlwZUNhdGVnb3J5KGV2ZW50LnR5cGUpO1xuICBjb25zdCB0eXBlRmlsdGVyID0gYmFja2VuZENmZy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcblxuICAvLyBDaGVjayBpZiB0eXBlIGlzIGV4cGxpY2l0bHkgZGlzYWJsZWQgZm9yIHRoaXMgYmFja2VuZFxuICBpZiAodHlwZUZpbHRlcj8uZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBldmVudExldmVsID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG5cbiAgLy8gQ2hlY2sgcGVyLXR5cGUgbWluTGV2ZWwgKG92ZXJyaWRlcyBiYWNrZW5kLWxldmVsIG1pbkxldmVsKVxuICBpZiAodHlwZUZpbHRlcj8ubWluTGV2ZWwgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudExldmVsIDwgdHlwZUZpbHRlci5taW5MZXZlbCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIGlmIChiYWNrZW5kLm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBGYWxsIGJhY2sgdG8gYmFja2VuZC1sZXZlbCBtaW5MZXZlbFxuICAgIGlmIChldmVudExldmVsIDwgYmFja2VuZC5taW5MZXZlbCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIHBlci10eXBlIHNhbXBsaW5nXG4gIGlmICh0eXBlRmlsdGVyPy5zYW1wbGluZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCB0eXBlRmlsdGVyLnNhbXBsaW5nO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7IC8vIFBhc3NlZCBhbGwgZmlsdGVyc1xufVxuXG4vKipcbiAqIEFwcGx5IHRhZyBmaWx0ZXJpbmcgdG8gZXZlbnQgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHMuXG4gKiBGaWx0ZXJzIGZyYW1ld29yayB0YWdzIGJhc2VkIG9uIGNvbmZpZywgYWRkcyBjdXN0b20gdGFncywgZW5mb3JjZXMgbWF4VGFncyBsaW1pdC5cbiAqL1xuZnVuY3Rpb24gYXBwbHlUYWdGaWx0ZXJpbmcoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gIGlmICghY29uZmlnPy50YWdGaWx0ZXJpbmcpIHJldHVybiBldmVudDtcblxuICBjb25zdCB0YWdDb25maWcgPSBjb25maWcudGFnRmlsdGVyaW5nO1xuICBjb25zdCBpbmNsdWRlID0gdGFnQ29uZmlnLmluY2x1ZGU7XG4gIGNvbnN0IG1heFRhZ3MgPSB0YWdDb25maWcubWF4VGFncyA/PyAxMDtcblxuICAvLyBLbm93biBmcmFtZXdvcmsgdGFnc1xuICBjb25zdCBmcmFtZXdvcmtUYWdzID0gbmV3IFNldChbXG4gICAgJ3N0YWdlJywgJ3RlbmFudElkJywgJ29wZXJhdGlvbkNhdGVnb3J5JywgJ2F1dGhNZXRob2QnLFxuICAgICdhY3RvclR5cGUnLCAnaGFuZGxlclR5cGUnLCAnZW50aXR5TmFtZScsICdvcGVyYXRpb24nXG4gIF0pO1xuXG4gIGNvbnN0IGZpbHRlcmVkVGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBsZXQgdGFnQ291bnQgPSAwO1xuXG4gIC8vIEZpbHRlciBleGlzdGluZyB0YWdzXG4gIGlmIChldmVudC50YWdzKSB7XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC50YWdzKSkge1xuICAgICAgaWYgKHRhZ0NvdW50ID49IG1heFRhZ3MpIGJyZWFrO1xuXG4gICAgICAvLyBGcmFtZXdvcmsgdGFnczogbXVzdCBiZSBpbiBpbmNsdWRlIGFycmF5XG4gICAgICBpZiAoZnJhbWV3b3JrVGFncy5oYXMoa2V5KSkge1xuICAgICAgICBpZiAoaW5jbHVkZSAmJiAhaW5jbHVkZS5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgY29udGludWU7IC8vIEV4Y2x1ZGVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFVua25vd24gdGFncyAoY3VzdG9tKTogYWx3YXlzIGluY2x1ZGVcblxuICAgICAgLy8gQ29udmVydCB0byBzdHJpbmdcbiAgICAgIGZpbHRlcmVkVGFnc1sga2V5IF0gPSB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnID8gdmFsdWUgOiBTdHJpbmcodmFsdWUpO1xuICAgICAgdGFnQ291bnQrKztcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgY3VzdG9tIHRhZ3MgZnJvbSBjb25maWdcbiAgaWYgKHRhZ0NvbmZpZy5jdXN0b20gJiYgdGFnQ291bnQgPCBtYXhUYWdzKSB7XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWVGbiBdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ0NvbmZpZy5jdXN0b20pKSB7XG4gICAgICBpZiAodGFnQ291bnQgPj0gbWF4VGFncykgYnJlYWs7XG4gICAgICBpZiAoZmlsdGVyZWRUYWdzWyBrZXkgXSAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gQWxyZWFkeSBleGlzdHNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZUZuKGV2ZW50KTtcbiAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgZmlsdGVyZWRUYWdzWyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICAgIHRhZ0NvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gZXZhbHVhdGUgY3VzdG9tIHRhZyAke2tleX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgLi4uZXZlbnQsXG4gICAgdGFnczogZmlsdGVyZWRUYWdzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdGFyZ2V0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10pOiB2b2lkIHtcbiAgLy8gQXBwbHkgdGFnIGZpbHRlcmluZyBiZWZvcmUgc2VuZGluZyB0byBiYWNrZW5kc1xuICBjb25zdCBmaWx0ZXJlZEV2ZW50ID0gYXBwbHlUYWdGaWx0ZXJpbmcoZXZlbnQpO1xuXG4gIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGZpbHRlcmVkRXZlbnQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShmaWx0ZXJlZEV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApLnRoZW4oKCkgPT4geyB9KTsgLy8gQ29udmVydCB0byBQcm9taXNlPHZvaWQ+XG5cbiAgLy8gVHJhY2sgcHJvbWlzZSBzbyBmbHVzaCgpIGNhbiB3YWl0IGZvciBpdFxuICBwZW5kaW5nRGlzcGF0Y2hlcy5wdXNoKHByb21pc2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogUHJvbWlzZTx2b2lkPiB7XG4gIC8vIEFwcGx5IHRhZyBmaWx0ZXJpbmcgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHNcbiAgY29uc3QgZmlsdGVyZWRFdmVudCA9IGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50KTtcblxuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGZpbHRlcmVkRXZlbnQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShmaWx0ZXJlZEV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGFuIGV2ZW50IG1hdGNoZXMgYSBzYW1wbGluZyBydWxlXG4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNSdWxlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHJ1bGU6IFNhbXBsaW5nUnVsZSk6IGJvb2xlYW4ge1xuICBjb25zdCB7IHRhcmdldCwgcGF0dGVybiB9ID0gcnVsZTtcblxuICBsZXQgdmFsdWVUb01hdGNoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgc3dpdGNoICh0YXJnZXQpIHtcbiAgICBjYXNlICd0ZW5hbnQnOlxuICAgICAgLy8gQ2hlY2sgYWN0b3IudGVuYW50SWQgb3IgdGFncy50ZW5hbnRJZFxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LnRlbmFudElkID8/IGV2ZW50LnRhZ3M/LnRlbmFudElkO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdyb3V0ZSc6XG4gICAgICAvLyBDaGVjayBzb3VyY2UgKGUuZy4sIFwiT3JkZXJDb250cm9sbGVyLmNyZWF0ZVwiKSBvciBvcGVyYXRpb25cbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZSA/PyBldmVudC5vcGVyYXRpb247XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3RhZyc6XG4gICAgICAvLyBQYXR0ZXJuIGZvcm1hdDogXCJrZXk6dmFsdWVcIiBvciBcImtleToqXCJcbiAgICAgIGlmICh0eXBlb2YgcGF0dGVybiA9PT0gJ3N0cmluZycgJiYgcGF0dGVybi5pbmNsdWRlcygnOicpKSB7XG4gICAgICAgIGNvbnN0IFsga2V5LCB2YWx1ZVBhdHRlcm4gXSA9IHBhdHRlcm4uc3BsaXQoJzonLCAyKTtcbiAgICAgICAgY29uc3QgdGFnVmFsdWUgPSBldmVudC50YWdzPy5bIGtleSBdO1xuICAgICAgICBpZiAoIXRhZ1ZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgaWYgKHZhbHVlUGF0dGVybiA9PT0gJyonKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgICAvLyBUZXN0IGFnYWluc3QgdmFsdWUgcGF0dGVybiAoc3VwcG9ydHMgd2lsZGNhcmRzKVxuICAgICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleCh2YWx1ZVBhdHRlcm4pO1xuICAgICAgICByZXR1cm4gcmVnZXgudGVzdCh0YWdWYWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICBjYXNlICdhY3Rvcic6XG4gICAgICAvLyBDaGVjayBhY3RvcklkIG9yIGFjdG9yVHlwZVxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LmFjdG9ySWQgPz8gZXZlbnQuYWN0b3I/LmFjdG9yVHlwZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnc291cmNlJzpcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICghdmFsdWVUb01hdGNoKSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gTWF0Y2ggYWdhaW5zdCBwYXR0ZXJuIChzdHJpbmcgb3IgUmVnRXhwKVxuICBpZiAocGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgIHJldHVybiBwYXR0ZXJuLnRlc3QodmFsdWVUb01hdGNoKTtcbiAgfVxuXG4gIC8vIFN0cmluZyBwYXR0ZXJuIHdpdGggd2lsZGNhcmQgc3VwcG9ydFxuICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgcmV0dXJuIHJlZ2V4LnRlc3QodmFsdWVUb01hdGNoKTtcbn1cblxuLyoqXG4gKiBDb250ZW50LWJhc2VkIGZpbHRlcmluZyAtIEFMV0FZUyBydW5zIHJlZ2FyZGxlc3Mgb2Ygc2FtcGxpbmcuZW5hYmxlZFxuICogUmV0dXJucyB0cnVlIGlmIGV2ZW50IHBhc3NlcyBmaWx0ZXJpbmcgcnVsZXMgKGJ5cGFzcywgbGV2ZWwsIGR1cmF0aW9uLCBldGMuKVxuICogUmV0dXJucyBmYWxzZSBpZiBldmVudCBzaG91bGQgYmUgZmlsdGVyZWQgb3V0LlxuICovXG5mdW5jdGlvbiBzaG91bGRGaWx0ZXIoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgb3B0aW9ucz86IHtcbiAgICAvKipcbiAgICAgKiBXaGVuIHRydWUsIHNwYW5zIG1heSBiZSBkcm9wcGVkIGJhc2VkIG9uIGNmZy5zcGFucy5taW5EdXJhdGlvbk1zLlxuICAgICAqIFdoZW4gZmFsc2UsIHNwYW5zIGFyZSBhbHdheXMga2VwdCAobmVlZGVkIHdoZW4gd2UgY2Fubm90IHNlZSB0aGUgZnVsbCBwYXJlbnQvY2hpbGQgZ3JhcGgpLlxuICAgICAqL1xuICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcD86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogUGFyZW50IHNwYW4gSURzIHJlZmVyZW5jZWQgYnkgYnVmZmVyZWQgZXZlbnRzLlxuICAgICAqIElmIGEgc3BhbiBpcyByZWZlcmVuY2VkIGhlcmUsIGl0IG11c3QgTkVWRVIgYmUgZHJvcHBlZC5cbiAgICAgKi9cbiAgICByZWZlcmVuY2VkUGFyZW50U3Bhbklkcz86IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIH1cbik6IGJvb2xlYW4ge1xuICBjb25zdCBsZXZlbFZhbHVlID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuICBjb25zdCBpc1NwYW5SZWNvcmQgPSBldmVudC50eXBlID09PSAnc3Bhbic7XG4gIGNvbnN0IGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9IG9wdGlvbnM/LmFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9PT0gdHJ1ZTtcbiAgY29uc3QgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMgPSBvcHRpb25zPy5yZWZlcmVuY2VkUGFyZW50U3BhbklkcztcblxuICAvLyA9PT0gQllQQVNTIEZJTFRFUlMgKGFsd2F5cyBwYXNzKSA9PT1cblxuICAvLyAxLiBFeHBsaWNpdCBieXBhc3MgZmxhZ1xuICBpZiAoY2FwdHVyZT8uYnlwYXNzKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAyLiBDUklUSUNBTCBsb2cgbGV2ZWwgYWx3YXlzIHBhc3Nlc1xuICBpZiAobGV2ZWxWYWx1ZSA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAzLiBFcnJvcnMgYWx3YXlzIHBhc3NcbiAgaWYgKGV2ZW50LmVycm9yIHx8IGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyA9PT0gU1BBTi1TUEVDSUZJQyBGSUxURVJJTkcgPT09XG4gIGlmIChpc1NwYW5SZWNvcmQpIHtcbiAgICAvLyBSZWZlcmVuY2VkIHBhcmVudHMgbXVzdCBiZSBrZXB0IGZvciBoaWVyYXJjaHkgaW50ZWdyaXR5XG4gICAgY29uc3QgaWQgPSBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKGlkICYmIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzPy5oYXMoaWQpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBGaWx0ZXIgb3V0IGZhc3Qgc3BhbnMgaWYgY29uZmlndXJlZFxuICAgIGlmIChhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3AgJiYgZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBtaW5EdXJhdGlvbiA9IGNhcHR1cmU/Lm1pbkR1cmF0aW9uTXMgPz8gY2ZnLnNwYW5zLm1pbkR1cmF0aW9uTXM7XG4gICAgICBpZiAobWluRHVyYXRpb24gPiAwICYmIGV2ZW50LmR1cmF0aW9uTXMgPCBtaW5EdXJhdGlvbikge1xuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIFRvbyBmYXN0LCBmaWx0ZXIgb3V0XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IE5PTi1TUEFOIERVUkFUSU9OIEZJTFRFUklORyA9PT1cbiAgaWYgKCFpc1NwYW5SZWNvcmQgJiYgY2FwdHVyZT8ubWluRHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zIDwgY2FwdHVyZS5taW5EdXJhdGlvbk1zKSB7XG4gICAgICByZXR1cm4gZmFsc2U7IC8vIEJlbG93IHRocmVzaG9sZCwgZmlsdGVyIG91dFxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBMRVZFTCBGSUxURVJJTkcgPT09XG4gIC8vIFJFTU9WRUQ6IE1hbmFnZXIgbm8gbG9uZ2VyIGZpbHRlcnMgYnkgbWluTGV2ZWxcbiAgLy8gQWxsIGxldmVsLWJhc2VkIGZpbHRlcmluZyBoYXBwZW5zIGluIG5vaXNlIHJlZHVjdGlvbiBmb3IgY29udGV4dC1hd2FyZSBkZWNpc2lvbnNcblxuICAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogUHJvYmFiaWxpc3RpYyBzYW1wbGluZyAtIE9OTFkgcnVucyB3aGVuIHNhbXBsaW5nLmVuYWJsZWQ9dHJ1ZVxuICogUmV0dXJucyB0cnVlIGlmIGV2ZW50IHNob3VsZCBiZSBzYW1wbGVkIChrZXB0KSwgZmFsc2UgaWYgc2FtcGxlZCBvdXQgKGRyb3BwZWQpXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFNhbXBsZShcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnXG4pOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkoZXZlbnQudHlwZSk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuXG4gIC8vID09PSBHUk9VUC1CQVNFRCBTQU1QTElORyAoYmF0Y2ggc2NlbmFyaW9zKSA9PT1cbiAgaWYgKGNhcHR1cmU/Lmdyb3VwKSB7XG4gICAgY29uc3QgeyBpbmRleCwgY2FwdHVyZUZpcnN0ID0gMywgc2FtcGxlUmF0ZSA9IDAuMSB9ID0gY2FwdHVyZS5ncm91cDtcblxuICAgIC8vIENhcHR1cmUgZmlyc3QgTiBpdGVtc1xuICAgIGlmIChpbmRleCA8IGNhcHR1cmVGaXJzdCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIHRoZSByZXN0IHByb2JhYmlsaXN0aWNhbGx5XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBzYW1wbGVSYXRlO1xuICB9XG5cbiAgLy8gPT09IFJVTEUtQkFTRUQgU0FNUExJTkcgKEhpZ2hlc3QgUHJpb3JpdHkpID09PVxuICBpZiAoY2ZnLnNhbXBsaW5nPy5ydWxlcyAmJiBjZmcuc2FtcGxpbmcucnVsZXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcnVsZSBvZiBjZmcuc2FtcGxpbmcucnVsZXMpIHtcbiAgICAgIGlmIChtYXRjaGVzUnVsZShldmVudCwgcnVsZSkpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBydWxlLnJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IFRZUEUtU1BFQ0lGSUMgU0FNUExJTkcgPT09XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG4gIGlmICh0eXBlQ29uZmlnPy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICB9XG5cbiAgLy8gPT09IE9QRVJBVElPTi1CQVNFRCBTQU1QTElORyA9PT1cbiAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjZmcuc2FtcGxpbmc/Lm9wZXJhdGlvbnMpIHtcbiAgICBmb3IgKGNvbnN0IFsgcGF0dGVybiwgcmF0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNmZy5zYW1wbGluZy5vcGVyYXRpb25zKSkge1xuICAgICAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgocGF0dGVybik7XG4gICAgICBpZiAocmVnZXgudGVzdChldmVudC5vcGVyYXRpb24pKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyA9PT0gTEVWRUwtQkFTRUQgU0FNUExJTkcgKEZhbGxiYWNrKSA9PT1cbiAgY29uc3QgbGV2ZWxOYW1lID0gbGV2ZWxUb1N0cmluZyhsZXZlbFZhbHVlKTtcbiAgY29uc3QgcmF0ZSA9IGNmZy5zYW1wbGluZz8ucmF0ZXM/LlsgbGV2ZWxOYW1lIF07XG4gIGlmIChyYXRlID09PSB1bmRlZmluZWQgfHwgcmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJhdGUgPD0gMCkgcmV0dXJuIGZhbHNlO1xuXG4gIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbn1cblxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm46IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGNvbnN0IE1BWF9SRUdFWF9DQUNIRV9TSVpFID0gMTAwO1xuXG4gIGxldCByZWdleCA9IHNhbXBsaW5nUmVnZXhDYWNoZS5nZXQocGF0dGVybik7XG4gIGlmICghcmVnZXgpIHtcbiAgICAvLyBFdmljdCBvbGRlc3QgZW50cnkgaWYgY2FjaGUgaXMgZnVsbCAoRklGTyBldmljdGlvbilcbiAgICBpZiAoc2FtcGxpbmdSZWdleENhY2hlLnNpemUgPj0gTUFYX1JFR0VYX0NBQ0hFX1NJWkUpIHtcbiAgICAgIGNvbnN0IGZpcnN0S2V5ID0gc2FtcGxpbmdSZWdleENhY2hlLmtleXMoKS5uZXh0KCkudmFsdWU7XG4gICAgICBpZiAoZmlyc3RLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuZGVsZXRlKGZpcnN0S2V5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvXFwqL2csICcuKicpfSRgKTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuc2V0KHBhdHRlcm4sIHJlZ2V4KTtcbiAgfVxuICByZXR1cm4gcmVnZXg7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIHByaW9yaXR5IGZvciBidWZmZXIgZXZpY3Rpb24uXG4gKiBIaWdoZXIgcHJpb3JpdHkgPSBrZWVwIGluIGJ1ZmZlclxuICovXG5mdW5jdGlvbiBnZXRFdmVudFByaW9yaXR5KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBudW1iZXIge1xuICAvLyBCeXBhc3MgZXZlbnRzIE5FVkVSIGdldCBldmljdGVkIChtYXggcHJpb3JpdHkpXG4gIGlmIChldmVudC5jYXB0dXJlPy5ieXBhc3MpIHtcbiAgICByZXR1cm4gSW5maW5pdHk7XG4gIH1cblxuICAvLyBVc2UgZXhwbGljaXQgcHJpb3JpdHkgaWYgcHJvdmlkZWRcbiAgbGV0IHByaW9yaXR5ID0gZXZlbnQuY2FwdHVyZT8ucHJpb3JpdHkgPz8gMDtcblxuICBjb25zdCBsZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIEhpZ2hlciBsb2cgbGV2ZWxzID0gaGlnaGVyIHByaW9yaXR5XG4gIHByaW9yaXR5ICs9IGxldmVsICogMTA7XG5cbiAgLy8gQXVkaXQgZXZlbnRzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0JykpIHtcbiAgICBwcmlvcml0eSArPSA1MDtcbiAgfVxuXG4gIC8vIFNwYW5zIHdpdGggZXJyb3JzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ3NwYW4nKSAmJiBldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgIHByaW9yaXR5ICs9IDMwO1xuICB9XG5cbiAgLy8gTG9uZyBkdXJhdGlvbiBvcGVyYXRpb25zIGFyZSBpbnRlcmVzdGluZ1xuICBpZiAoZXZlbnQuZHVyYXRpb25NcyAmJiBldmVudC5kdXJhdGlvbk1zID4gMTAwMCkge1xuICAgIHByaW9yaXR5ICs9IDIwO1xuICB9XG5cbiAgcmV0dXJuIHByaW9yaXR5O1xufVxuXG4vKipcbiAqIEV2aWN0IGxvd2VzdCBwcmlvcml0eSBldmVudCBmcm9tIGJ1ZmZlclxuICogUmV0dXJucyBtZXRhZGF0YSBhYm91dCB0aGUgZXZpY3RlZCBldmVudCBmb3IgbG9nZ2luZ1xuICovXG5mdW5jdGlvbiBldmljdExvd2VzdFByaW9yaXR5KFxuICBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBvcHRpb25zPzogeyBhbGxvd0V2aWN0U3BhbnM/OiBib29sZWFuIH1cbik6IHsgdHlwZTogc3RyaW5nOyBjb3JyZWxhdGlvbklkOiBzdHJpbmc7IG9wZXJhdGlvbj86IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgcmVtb3ZlZENvdW50PzogbnVtYmVyIH0gfCBudWxsIHtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFsbG93RXZpY3RTcGFucyA9IG9wdGlvbnM/LmFsbG93RXZpY3RTcGFucyA9PT0gdHJ1ZTtcblxuICAvLyBTVFJJQ1QgVFJFRSBFVklDVElPTjpcbiAgLy8gV2hlbiB0aGUgYnVmZmVyIGlzIGZ1bGwsIHdlIE1VU1QgTk9UIGV2aWN0IGEgcGFyZW50IHNwYW4gd2hpbGUga2VlcGluZyBpdHMgY2hpbGRyZW4sXG4gIC8vIG90aGVyd2lzZSBmbHVzaCgpIHdpbGwgZW1pdCBgb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW5gLlxuICAvL1xuICAvLyBXZSBzb2x2ZSB0aGlzIGxpa2UgYSByZWFsIHRyZWUgcHJvYmxlbTpcbiAgLy8gMSkgUHJlZmVyIGV2aWN0aW5nIFwibGVhZlwiIGV2ZW50czogZXZlbnRzIHRoYXQgYXJlIE5PVCByZWZlcmVuY2VkIGFzIGEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGJ5IGFueSBvdGhlciBidWZmZXJlZCBldmVudC5cbiAgLy8gMikgUHJlZmVyIGV2aWN0aW5nIG5vbi1zcGFuIGxlYXZlcyAobG9ncy9tZXRyaWNzKSBiZWZvcmUgc3BhbnMuXG4gIC8vIDMpIElmIG5vIGxlYXZlcyBleGlzdCAocmFyZSksIGV2aWN0IGFuIGV2ZW50IEFORCBpdHMgd2hvbGUgZGVzY2VuZGFudCBzdWJ0cmVlIHNvIG5vIG9ycGhhbnMgcmVtYWluLlxuXG4gIGNvbnN0IHJlZmVyZW5jZWRBc1BhcmVudCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBjaGlsZHJlbkJ5UGFyZW50ID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlFdmVudFtdPigpO1xuICBmb3IgKGNvbnN0IGUgb2YgYnVmZmVyKSB7XG4gICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgIGlmICh0eXBlb2YgcGlkID09PSAnc3RyaW5nJyAmJiBwaWQubGVuZ3RoID4gMCkge1xuICAgICAgcmVmZXJlbmNlZEFzUGFyZW50LmFkZChwaWQpO1xuICAgICAgY29uc3QgYXJyID0gY2hpbGRyZW5CeVBhcmVudC5nZXQocGlkKTtcbiAgICAgIGlmIChhcnIpIGFyci5wdXNoKGUpO1xuICAgICAgZWxzZSBjaGlsZHJlbkJ5UGFyZW50LnNldChwaWQsIFsgZSBdKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpc1NwYW4gPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLnR5cGUgPT09ICdzcGFuJyB8fCBlLnR5cGUgPT09ICdzcGFuLnN0YXJ0JztcbiAgY29uc3QgZ2V0SWQgPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgY29uc3QgaXNMZWFmID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4ge1xuICAgIGNvbnN0IGlkID0gZ2V0SWQoZSk7XG4gICAgaWYgKCFpZCkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuICFyZWZlcmVuY2VkQXNQYXJlbnQuaGFzKGlkKTtcbiAgfTtcblxuICBjb25zdCBwaWNrTG93ZXN0ID0gKGNhbmRpZGF0ZXM6IE9ic2VydmFiaWxpdHlFdmVudFtdKSA9PiB7XG4gICAgbGV0IGlkeCA9IC0xO1xuICAgIGxldCBsb3dlc3QgPSBJbmZpbml0eTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhbmRpZGF0ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHAgPSBnZXRFdmVudFByaW9yaXR5KGNhbmRpZGF0ZXNbIGkgXSk7XG4gICAgICBpZiAocCA8IGxvd2VzdCkge1xuICAgICAgICBsb3dlc3QgPSBwO1xuICAgICAgICBpZHggPSBpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gaWR4O1xuICB9O1xuXG4gIC8vIElmIHNwYW5zIGFyZSBub3QgYWxsb3dlZCB0byBiZSBldmljdGVkLCBjb25zdHJhaW4gY2FuZGlkYXRlcyB0byBub24tc3BhbiBldmVudHMgb25seS5cbiAgY29uc3Qgbm9uU3BhbnMgPSBidWZmZXIuZmlsdGVyKChlKSA9PiAhaXNTcGFuKGUpKTtcblxuICAvLyBQYXNzIDE6IG5vbi1zcGFuIGxlYXZlc1xuICBjb25zdCBub25TcGFuTGVhdmVzID0gbm9uU3BhbnMuZmlsdGVyKChlKSA9PiBpc0xlYWYoZSkpO1xuICBsZXQgdGFyZ2V0OiBPYnNlcnZhYmlsaXR5RXZlbnQgfCB1bmRlZmluZWQ7XG4gIGlmIChub25TcGFuTGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KG5vblNwYW5MZWF2ZXMpO1xuICAgIHRhcmdldCA9IG5vblNwYW5MZWF2ZXNbIGlkeCBdO1xuICB9IGVsc2Uge1xuICAgIGlmICghYWxsb3dFdmljdFNwYW5zKSB7XG4gICAgICAvLyBQYXNzIDIgKG5vbi1zcGFuIG9ubHkpOiBldmljdCBsb3dlc3QtcHJpb3JpdHkgbm9uLXNwYW4gdGhhdCBkb2Vzbid0IGhhdmUgc3BhbiBjaGlsZHJlbi5cbiAgICAgIC8vIFdlIG11c3QgY2hlY2sgZm9yIHNwYW4gY2hpbGRyZW4gYmVjYXVzZSBzdWJ0cmVlIHJlbW92YWwgd291bGQgZXZpY3QgdGhvc2Ugc3BhbnMsXG4gICAgICAvLyB2aW9sYXRpbmcgdGhlIGFsbG93RXZpY3RTcGFucz1mYWxzZSBjb250cmFjdC5cbiAgICAgIGlmIChub25TcGFucy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEZpbHRlciB0byBvbmx5IG5vbi1zcGFucyB0aGF0IGFyZSBzYWZlIHRvIGV2aWN0IChubyBzcGFuIGNoaWxkcmVuKVxuICAgICAgICBjb25zdCBzYWZlTm9uU3BhbnMgPSBub25TcGFucy5maWx0ZXIoZSA9PiB7XG4gICAgICAgICAgY29uc3QgaWQgPSBnZXRJZChlKTtcbiAgICAgICAgICBpZiAoIWlkKSByZXR1cm4gdHJ1ZTsgLy8gTm8gSUQgPSBubyBjaGlsZHJlblxuICAgICAgICAgIGNvbnN0IGtpZHMgPSBjaGlsZHJlbkJ5UGFyZW50LmdldChpZCk7XG4gICAgICAgICAgaWYgKCFraWRzKSByZXR1cm4gdHJ1ZTsgLy8gTm8gY2hpbGRyZW4gPSBzYWZlXG4gICAgICAgICAgLy8gUmVqZWN0IGlmIGFueSBjaGlsZCBpcyBhIHNwYW5cbiAgICAgICAgICByZXR1cm4gIWtpZHMuc29tZShjaGlsZCA9PiBpc1NwYW4oY2hpbGQpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHNhZmVOb25TcGFucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChzYWZlTm9uU3BhbnMpO1xuICAgICAgICAgIHRhcmdldCA9IHNhZmVOb25TcGFuc1sgaWR4IF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gQWxsIG5vbi1zcGFucyBoYXZlIHNwYW4gY2hpbGRyZW4gLSBjYW5ub3QgZXZpY3Qgd2l0aG91dCB2aW9sYXRpbmcgYWxsb3dFdmljdFNwYW5zXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEJ1ZmZlciBjb250YWlucyBvbmx5IHNwYW5zIC0gY2FsbGVyIG11c3QgZGVjaWRlIHdoZXRoZXIgdG8gYWxsb3cgc3BhbiBldmljdGlvbiBvciBvdmVyZmxvdy5cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFBhc3MgMjogYW55IGxlYXZlcyAoaW5jbHVkaW5nIHNwYW5zKVxuICAgICAgY29uc3QgYW55TGVhdmVzID0gYnVmZmVyLmZpbHRlcigoZSkgPT4gaXNMZWFmKGUpKTtcbiAgICAgIGlmIChhbnlMZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGFueUxlYXZlcyk7XG4gICAgICAgIHRhcmdldCA9IGFueUxlYXZlc1sgaWR4IF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBQYXNzIDM6IG5vIGxlYXZlcyBleGlzdCAoY3ljbGUvZGVnZW5lcmF0ZSkuIFBpY2sgdGhlIG92ZXJhbGwgbG93ZXN0LXByaW9yaXR5IGV2ZW50LlxuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGJ1ZmZlcik7XG4gICAgICAgIHRhcmdldCA9IGJ1ZmZlclsgaWR4IF07XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0YXJnZXQpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRhcmdldElkID0gZ2V0SWQodGFyZ2V0KTtcbiAgbGV0IHJlbW92ZWRDb3VudCA9IDA7XG5cbiAgLy8gSWYgdGFyZ2V0IGlzIHJlZmVyZW5jZWQgYXMgYSBwYXJlbnQsIHJlbW92ZSBpdHMgZW50aXJlIHN1YnRyZWUgKEJGUykuXG4gIGNvbnN0IHRvUmVtb3ZlID0gbmV3IFNldDxPYnNlcnZhYmlsaXR5RXZlbnQ+KCk7XG4gIGNvbnN0IHF1ZXVlOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFsgdGFyZ2V0IF07XG4gIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgY3VyID0gcXVldWUuc2hpZnQoKSE7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhjdXIpKSBjb250aW51ZTtcbiAgICB0b1JlbW92ZS5hZGQoY3VyKTtcbiAgICBjb25zdCBjdXJJZCA9IGdldElkKGN1cik7XG4gICAgaWYgKGN1cklkKSB7XG4gICAgICBjb25zdCBraWRzID0gY2hpbGRyZW5CeVBhcmVudC5nZXQoY3VySWQpO1xuICAgICAgaWYgKGtpZHMpIHF1ZXVlLnB1c2goLi4ua2lkcyk7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlsdGVyIGJ1ZmZlciBpbi1wbGFjZVxuICBmb3IgKGxldCBpID0gYnVmZmVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhidWZmZXJbIGkgXSkpIHtcbiAgICAgIGJ1ZmZlci5zcGxpY2UoaSwgMSk7XG4gICAgICByZW1vdmVkQ291bnQrKztcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHR5cGU6IHRhcmdldC50eXBlLFxuICAgIGNvcnJlbGF0aW9uSWQ6IHRhcmdldC5jb3JyZWxhdGlvbklkLFxuICAgIG9wZXJhdGlvbjogdGFyZ2V0Lm9wZXJhdGlvbixcbiAgICBsZXZlbDogdGFyZ2V0LmxldmVsLFxuICAgIHJlbW92ZWRDb3VudCxcbiAgfTtcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKHN5bmMgdmVyc2lvbilcbiAqIFJldHVybnM6ICdjYXB0dXJlZCcgaWYgZXZlbnQgd2FzIGNhcHR1cmVkLCAnYnVmZmVyZWQnIGlmIGJ1ZmZlcmVkLCAnc2tpcCcgaWYgbm90IHVzaW5nIHRhaWwtYmFzZWRcbiAqL1xuZnVuY3Rpb24gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdTeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6ICdjYXB0dXJlZCcgfCAnYnVmZmVyZWQnIHwgJ3NraXAnIHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgIGNvbnN0IHVucGFja2VkRXZlbnRzID0gdW5wYWNrRW1pdHRlZEV2ZW50cyhyZWR1Y2VkLmV2ZW50cyk7XG5cbiAgICAgIC8vIERpc3BhdGNoIGFsbCBldmVudHMgLSBub2lzZSByZWR1Y3Rpb24gYWxyZWFkeSBmaWx0ZXJlZCBieSBtaW5MZXZlbFxuICAgICAgZm9yIChjb25zdCBidWZmZXJlZEV2ZW50IG9mIHVucGFja2VkRXZlbnRzKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoYnVmZmVyZWRFdmVudC50eXBlKTtcbiAgICAgICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGJ1ZmZlcmVkRXZlbnQsIHRhcmdldHMpO1xuICAgICAgfVxuICAgIH1cblxuICAgIG9ic1N0YXRlLmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIG9ic1N0YXRlLnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gUE9TVC1FUlJPUiBQQVRIOiBDYXB0dXJlIGltbWVkaWF0ZWx5XG4gIGlmIChjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZyAoZmlsdGVyaW5nIGhhcHBlbnMgQUZURVIgbm9pc2UgcmVkdWN0aW9uKVxuICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuXG4gIC8vIEJ1ZmZlciBzaXplIG1hbmFnZW1lbnQ6IGV2aWN0IGxvd2VzdCBwcmlvcml0eSBpZiBmdWxsXG4gIGNvbnN0IG1heFNpemUgPSBjZmcuc2FtcGxpbmc/Lm1heEJ1ZmZlclNpemUgPz8gMTAwMDtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gbWF4U2l6ZSkge1xuICAgIC8vIElNUE9SVEFOVDpcbiAgICAvLyBEdXJpbmcgYnVmZmVyaW5nIChub2lzZSByZWR1Y3Rpb24gLyBzbWFydCBzYW1wbGluZyksIHNwYW5zIG1heSBiZSBlbWl0dGVkIEFGVEVSIHRoZWlyIGNoaWxkcmVuLlxuICAgIC8vIEV2aWN0aW5nIHNwYW5zIG9wcG9ydHVuaXN0aWNhbGx5IGNhbiB0aGVyZWZvcmUgY3JlYXRlIGZ1dHVyZSBvcnBoYW4gY2hpbGRyZW4gKG1pc3NpbmdfcGFyZW50X3NwYW4pLlxuICAgIC8vIFByZWZlciBldmljdGluZyBub24tc3BhbiBldmVudHMgb25seTsgaWYgdGhlIGJ1ZmZlciBpcyBzcGFucy1vbmx5LCBhbGxvdyBib3VuZGVkIG92ZXJmbG93LlxuICAgIGNvbnN0IGV2aWN0ZWRJbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KTtcbiAgICBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTcGFucy1vbmx5IG92ZXJmbG93OiBhbGxvdyBidWZmZXIgZ3Jvd3RoIHVwIHRvIDJ4IGJlZm9yZSBldmljdGluZyBzcGFuIHN1YnRyZWVzLlxuICAgICAgY29uc3QgaGFyZENhcCA9IG1heFNpemUgKiAyO1xuICAgICAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gaGFyZENhcCkge1xuICAgICAgICBjb25zdCBldmljdGVkU3BhbkluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IHRydWUgfSk7XG4gICAgICAgIGlmIChldmljdGVkU3BhbkluZm8pIHtcbiAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExvZyB3YXJuaW5nIHdpdGggZXZpY3RlZCBldmVudCBkZXRhaWxzXG4gICAgaWYgKG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCA9PT0gMSB8fCBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgJSAxMDAgPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBmdWxsLCBldmljdGluZyBsb3dlc3QgcHJpb3JpdHkgZXZlbnRzJywge1xuICAgICAgICBldmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgIGJ1ZmZlclNpemU6IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgZXZpY3RlZEV2ZW50OiBldmljdGVkSW5mbyxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIC8vIExvZyBlYWNoIGV2aWN0aW9uIGF0IGRlYnVnIGxldmVsIGZvciB0cm91Ymxlc2hvb3RpbmdcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRXZpY3RlZCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZyb20gYnVmZmVyJywge1xuICAgICAgICAuLi5ldmljdGVkSW5mbyxcbiAgICAgICAgdG90YWxFdmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBidWZmZXIucHVzaChldmVudCk7XG4gIG9ic1N0YXRlLnN1bW1hcnkuYnVmZmVyZWQrKztcbiAgcmV0dXJuICdidWZmZXJlZCc7XG59XG5cbi8qKlxuICogSGFuZGxlIHRhaWwtYmFzZWQgc2FtcGxpbmcgbG9naWMgZm9yIGFuIGV2ZW50IChhc3luYyB2ZXJzaW9uKVxuICovXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ0FzeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6IFByb21pc2U8J2NhcHR1cmVkJyB8ICdidWZmZXJlZCcgfCAnc2tpcCc+IHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgIGNvbnN0IHVucGFja2VkRXZlbnRzID0gdW5wYWNrRW1pdHRlZEV2ZW50cyhyZWR1Y2VkLmV2ZW50cyk7XG5cbiAgICAgIC8vIERpc3BhdGNoIGFsbCBldmVudHMgLSBub2lzZSByZWR1Y3Rpb24gYWxyZWFkeSBmaWx0ZXJlZCBieSBtaW5MZXZlbFxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodW5wYWNrZWRFdmVudHMubWFwKGJ1ZmZlcmVkRXZlbnQgPT4ge1xuICAgICAgICBjb25zdCB0YXJnZXRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGJ1ZmZlcmVkRXZlbnQudHlwZSk7XG4gICAgICAgIHJldHVybiBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGJ1ZmZlcmVkRXZlbnQsIHRhcmdldHMpO1xuICAgICAgfSkpO1xuICAgIH1cblxuICAgIG9ic1N0YXRlLmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICBvYnNTdGF0ZS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIFBPU1QtRVJST1IgUEFUSDogQ2FwdHVyZSBpbW1lZGlhdGVseVxuICBpZiAoY29udGV4dC5vYnNlcnZhYmlsaXR5LmVycm9yT2NjdXJyZWQpIHtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5LnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gTk9STUFMIFBBVEg6IEJ1ZmZlciBldmVyeXRoaW5nXG4gIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNmZy5zYW1wbGluZz8ubWF4QnVmZmVyU2l6ZSA/PyAxMDAwO1xuICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBtYXhTaXplKSB7XG4gICAgY29uc3QgZXZpY3RlZEluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IGZhbHNlIH0pO1xuICAgIGlmIChldmljdGVkSW5mbykge1xuICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGhhcmRDYXAgPSBtYXhTaXplICogMjtcbiAgICAgIGlmIChidWZmZXIubGVuZ3RoID49IGhhcmRDYXApIHtcbiAgICAgICAgY29uc3QgZXZpY3RlZFNwYW5JbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiB0cnVlIH0pO1xuICAgICAgICBpZiAoZXZpY3RlZFNwYW5JbmZvKSB7XG4gICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBMb2cgd2FybmluZyBpZiBldmljdGluZyBhIGxvdFxuICAgIGlmIChvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgPT09IDEgfHwgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkICUgMTAwID09PSAwKSB7XG4gICAgICBsb2dnZXIud2FybignT2JzZXJ2YWJpbGl0eSBidWZmZXIgZnVsbCwgZXZpY3RpbmcgbG93ZXN0IHByaW9yaXR5IGV2ZW50cycsIHtcbiAgICAgICAgZXZpY3RlZDogb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICBidWZmZXJTaXplOiBidWZmZXIubGVuZ3RoLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWRcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGJ1ZmZlci5wdXNoKGV2ZW50KTtcbiAgb2JzU3RhdGUuc3VtbWFyeS5idWZmZXJlZCsrO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIHNvdXJjZS1tYXAtc3VwcG9ydCBpZiBlbmFibGVkIGluIGNvbmZpZ1xuICogUHJvdmlkZXMgYmV0dGVyIHN0YWNrIHRyYWNlcyBmb3IgVHlwZVNjcmlwdC90cmFuc3BpbGVkIGNvZGUgaW4gcHJvZHVjdGlvblxuICovXG5mdW5jdGlvbiBpbml0aWFsaXplU291cmNlTWFwU3VwcG9ydChjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgaWYgKCFjZmcuc291cmNlTWFwLmVuYWJsZWQpIHtcbiAgICBsb2dnZXIuZGVidWcoJ1NvdXJjZSBtYXAgc3VwcG9ydCBkaXNhYmxlZCBpbiBjb25maWcnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnQXR0ZW1wdGluZyB0byBsb2FkIHNvdXJjZS1tYXAtc3VwcG9ydC4uLicpO1xuICAgIC8vIER5bmFtaWMgaW1wb3J0IHRvIGF2b2lkIGJ1bmRsaW5nIGlmIG5vdCBuZWVkZWRcbiAgICByZXF1aXJlKCdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInKTtcbiAgICBsb2dnZXIuZGVidWcoJ1NvdXJjZSBtYXAgc3VwcG9ydCBlbmFibGVkIC0gc3RhY2sgdHJhY2VzIHdpbGwgc2hvdyBvcmlnaW5hbCBUeXBlU2NyaXB0IGxpbmVzJyk7XG4gIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgLy8gTm90IGEgY3JpdGljYWwgZXJyb3IgLSBvYnNlcnZhYmlsaXR5IHN0aWxsIHdvcmtzIHdpdGhvdXQgc291cmNlIG1hcHNcbiAgICBpZiAoZXJyb3IgJiYgdHlwZW9mIGVycm9yID09PSAnb2JqZWN0JyAmJiAnY29kZScgaW4gZXJyb3IgJiYgKGVycm9yIGFzIHsgY29kZT86IHVua25vd24gfSkuY29kZSA9PT0gJ01PRFVMRV9OT1RfRk9VTkQnKSB7XG4gICAgICBsb2dnZXIud2FybihcbiAgICAgICAgJ3NvdXJjZS1tYXAtc3VwcG9ydCBwYWNrYWdlIG5vdCBmb3VuZC4gSW5zdGFsbCBpdCBmb3IgYmV0dGVyIGVycm9yIHN0YWNrIHRyYWNlczogbnBtIGluc3RhbGwgc291cmNlLW1hcC1zdXBwb3J0J1xuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgbXNnID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBsb2FkIHNvdXJjZS1tYXAtc3VwcG9ydDonLCBtc2cpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESSBiYXNlZCBvbiBjb25maWdcbiAqL1xuZnVuY3Rpb24gaW5pdGlhbGl6ZUJhY2tlbmRzRnJvbUNvbmZpZyhjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgYmFja2VuZHMgPSBbXTtcbiAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgY29uc3QgZW5hYmxlZEJhY2tlbmRzID0gY2ZnLmJhY2tlbmRzLmZpbHRlcihiID0+IGIuZW5hYmxlZCAhPT0gZmFsc2UpO1xuXG4gIGZvciAoY29uc3QgYmFja2VuZENmZyBvZiBlbmFibGVkQmFja2VuZHMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYmFja2VuZCA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZTxPYnNlcnZhYmlsaXR5QmFja2VuZD4oXG4gICAgICAgICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gICAgICAgIHsgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgYmFja2VuZENmZy50eXBlIF0gfVxuICAgICAgKTtcbiAgICAgIGJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gICAgICBiYWNrZW5kQ29uZmlncy5zZXQoYmFja2VuZC5uYW1lLCBiYWNrZW5kQ2ZnKTtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgSW5pdGlhbGl6ZWQgYmFja2VuZDogJHtiYWNrZW5kLm5hbWV9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIE5vUHJvdmlkZXJGb3VuZEVycm9yKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBCYWNrZW5kICcke2JhY2tlbmRDZmcudHlwZX0nIG5vdCBmb3VuZCBpbiBESSwgc2tpcHBpbmdgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGluaXRpYWxpemUgYmFja2VuZCAnJHtiYWNrZW5kQ2ZnLnR5cGV9JzpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKGJhY2tlbmRzLmxlbmd0aCA9PT0gMCkge1xuICAgIC8vIFNvZnQtZmFpbDogZG8gTk9UIHRocm93IGFuZCBicmVhayBhcHBsaWNhdGlvbiBmbG93LlxuICAgIC8vIFdpdGhvdXQgYmFja2VuZHMsIGNhcHR1cmUgYmVjb21lcyBhIG5vLW9wIGZvciB0aGlzIGludm9jYXRpb24gKGV2ZW50cyBhcmUgZHJvcHBlZCkuXG4gICAgbG9nZ2VyLmVycm9yKCdPYnNlcnZhYmlsaXR5IG1pc2NvbmZpZ3VyZWQ6IG5vIGVuYWJsZWQvYXZhaWxhYmxlIGJhY2tlbmRzIHdlcmUgcmVzb2x2ZWQgZnJvbSBESS4gT2JzZXJ2YWJpbGl0eSB3aWxsIGJlIGRpc2FibGVkIGZvciB0aGlzIGludm9jYXRpb24uJywge1xuICAgICAgZW5hYmxlZEJhY2tlbmRUeXBlczogZW5hYmxlZEJhY2tlbmRzLm1hcChiID0+IGIudHlwZSksXG4gICAgfSk7XG4gIH1cblxuICAvLyBSZWdpc3RlciBzcGFuIGxpZmVjeWNsZSBob29rcyBmb3IgYmFja2VuZHMgdGhhdCBpbXBsZW1lbnQgU3BhbkxpZmVjeWNsZUhvb2suXG4gIC8vIFRoaXMgYWxsb3dzIFNwYW5PYnNlcnZlciB0byBjYWxsIE9URUwgKGFuZCBvdGhlciByZWFsLXRpbWUgYmFja2VuZHMpIGRpcmVjdGx5XG4gIC8vIGluc3RlYWQgb2Ygcm91dGluZyBzcGFuLnN0YXJ0IGV2ZW50cyB0aHJvdWdoIHRoZSBidWZmZXJlZCBjYXB0dXJlIHBpcGVsaW5lLlxuICBjb25zdCBob29rczogU3BhbkxpZmVjeWNsZUhvb2tbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgYmFja2VuZHMpIHtcbiAgICBpZiAoaXNTcGFuTGlmZWN5Y2xlSG9vayhiYWNrZW5kKSkge1xuICAgICAgaG9va3MucHVzaChiYWNrZW5kKTtcbiAgICB9XG4gIH1cbiAgc2V0U3BhbkxpZmVjeWNsZUhvb2tzKGhvb2tzKTtcbiAgaWYgKGhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICBsb2dnZXIuZGVidWcoYFJlZ2lzdGVyZWQgJHtob29rcy5sZW5ndGh9IHNwYW4gbGlmZWN5Y2xlIGhvb2socylgKTtcbiAgfVxufVxuXG4vKiogVHlwZSBndWFyZDogY2hlY2sgaWYgYSBiYWNrZW5kIGFsc28gaW1wbGVtZW50cyBTcGFuTGlmZWN5Y2xlSG9vay4gKi9cbmZ1bmN0aW9uIGlzU3BhbkxpZmVjeWNsZUhvb2soYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQpOiBiYWNrZW5kIGlzIE9ic2VydmFiaWxpdHlCYWNrZW5kICYgU3BhbkxpZmVjeWNsZUhvb2sge1xuICBjb25zdCBjYW5kaWRhdGUgPSBiYWNrZW5kIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHJldHVybiB0eXBlb2YgY2FuZGlkYXRlLm9uU3BhblN0YXJ0ID09PSAnZnVuY3Rpb24nXG4gICAgJiYgdHlwZW9mIGNhbmRpZGF0ZS5vblNwYW5FbmQgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGRvSW5pdGlhbGl6ZSgpOiB2b2lkIHtcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIFNUQVJUID09PScpO1xuXG4gICAgLy8gUnVuIHByZS1pbml0aWFsaXphdGlvbiBob29rcyAoZS5nLiwgc2NoZW1hIHJlZ2lzdHJhdGlvbilcbiAgICBpZiAocHJlSW5pdEhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgUnVubmluZyAke3ByZUluaXRIb29rcy5sZW5ndGh9IHByZS1pbml0aWFsaXphdGlvbiBob29rKHMpLi4uYCk7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgcHJlSW5pdEhvb2tzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaG9vaygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcignUHJlLWluaXRpYWxpemF0aW9uIGhvb2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLmRlYnVnKCdQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBjb25maWcgaW5wdXQgZnJvbSBESSwgdGhlbiBub3JtYWxpemUgaW50byBhIGZ1bGx5LWRlZmluZWQgT2JzZXJ2YWJpbGl0eUNvbmZpZy5cbiAgICAvLyBUaGlzIGF2b2lkcyB1bnNhZmUgY2FzdHMgYW5kIGVuc3VyZXMgdGhlIHNoYXBlIGlzIGNvbnNpc3RlbnQgZXZlbiB3aGVuIGFwcHMgb3ZlcnJpZGUgcGFydGlhbGx5LlxuICAgIGNvbnN0IGlucHV0ID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlQ29uZmlnPE9ic2VydmFiaWxpdHlDb25maWdJbnB1dD4oJ29ic2VydmFiaWxpdHknKTtcbiAgICBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0KTtcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhjb25maWcpO1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBjb25maWcgbG9hZGVkIGZyb20gREknLCB7XG4gICAgICBlbmFibGVkOiBjb25maWcuZW5hYmxlZCxcbiAgICAgIHNlcnZpY2VOYW1lOiBjb25maWcuc2VydmljZU5hbWUsXG4gICAgICBiYWNrZW5kczogY29uZmlnLmJhY2tlbmRzPy5tYXAoYiA9PiBiLnR5cGUpLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkLCBzbWFydDogY29uZmlnLnNhbXBsaW5nPy5zbWFydCB9LFxuICAgICAgc291cmNlTWFwOiBjb25maWcuc291cmNlTWFwPy5lbmFibGVkLFxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBzb3VyY2UtbWFwLXN1cHBvcnQgZm9yIGJldHRlciBzdGFjayB0cmFjZXMgKGlmIGVuYWJsZWQpXG4gICAgaW5pdGlhbGl6ZVNvdXJjZU1hcFN1cHBvcnQoY29uZmlnKTtcblxuICAgIC8vIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESVxuICAgIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY29uZmlnISk7XG5cbiAgICAvLyBSZWdpc3RlciBjYXB0dXJlciBmb3Igb2JzZXJ2ZXJzXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcblxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIENPTVBMRVRFID09PScpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignISEhIE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gRkFJTEVEICEhIScsIGVycm9yKTtcbiAgICAvLyBTb2Z0LWZhaWw6IGRvIE5PVCB0aHJvdyBpbnRvIGFwcGxpY2F0aW9uIGZsb3cuXG4gICAgLy8gTWFyayBpbml0aWFsaXplZCB0byBwcmV2ZW50IHJlcGVhdGVkIGluaXQgYXR0ZW1wdHM7IGxlYXZlIGNhcHR1cmVyIHVuaW5pdGlhbGl6ZWQgc28gb2JzZXJ2ZXJzIGRyb3AgZXZlbnRzLlxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBVQkxJQyBBUEkgLSBPYnNlcnZhYmlsaXR5TWFuYWdlclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TWFuYWdlciB7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHsgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciBhIG5ldyBMYW1iZGEgaW52b2NhdGlvblxuICAgKi9cbiAgc3RhdGljIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKSBjYWxsZWQnLCB7IGluaXRpYWxpemVkLCBpbnZvY2F0aW9uQ291bnQgfSk7XG5cbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ05vdCBpbml0aWFsaXplZCB5ZXQsIGNhbGxpbmcgZG9Jbml0aWFsaXplKCkuLi4nKTtcbiAgICAgIGRvSW5pdGlhbGl6ZSgpO1xuICAgIH1cblxuICAgIGludm9jYXRpb25Db3VudCsrO1xuICAgIGxvZ2dlci5kZWJ1ZyhgSW52b2NhdGlvbiAke2ludm9jYXRpb25Db3VudH0gc3RhcnRpbmcsIGluaXRpYWxpemluZyAke2JhY2tlbmRzLmxlbmd0aH0gYmFja2VuZChzKWApO1xuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIGJhY2tlbmRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBiYWNrZW5kLmluaXRpYWxpemVJbnZvY2F0aW9uPy4oKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmFpbGVkIHRvIGluaXRpYWxpemUgaW52b2NhdGlvbjpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIGlzSW5pdGlhbGl6ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGluaXRpYWxpemVkO1xuICB9XG5cbiAgc3RhdGljIGlzQ29sZFN0YXJ0KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbnZvY2F0aW9uQ291bnQgPT09IDE7XG4gIH1cblxuICBzdGF0aWMgZ2V0SW52b2NhdGlvbkNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudDtcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb25maWcoKTogT2JzZXJ2YWJpbGl0eUNvbmZpZyB8IG51bGwge1xuICAgIHJldHVybiBjb25maWc7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG9ic2VydmFiaWxpdHkgc3VtbWFyeSBmb3IgdGhlIGN1cnJlbnQgaW52b2NhdGlvbi5cbiAgICogUmV0dXJucyBidWZmZXIgc3RhdHM6IGV2aWN0ZWQsIGJ1ZmZlcmVkLCBjYXB0dXJlZCwgc2FtcGxlZE91dCBjb3VudHMuXG4gICAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGV4ZWN1dGlvbiBjb250ZXh0IGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBnZXRTdW1tYXJ5KCk6IE9ic2VydmFiaWxpdHlTdW1tYXJ5IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICByZXR1cm4gY29udGV4dD8ub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5O1xuICB9XG5cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuICAgIGNvbmZpZyA9IHsgLi4uY29uZmlnLCAuLi51cGRhdGVzIH07XG4gIH1cblxuICBzdGF0aWMgcmVnaXN0ZXJCYWNrZW5kKGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kKTogdm9pZCB7XG4gICAgaWYgKGJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICB9XG5cbiAgc3RhdGljIHVucmVnaXN0ZXJCYWNrZW5kKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGJhY2tlbmRzID0gYmFja2VuZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IG5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHJlLWluaXRpYWxpemF0aW9uIGhvb2suXG4gICAqIEhvb2tzIHJ1biBCRUZPUkUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLCBhbGxvd2luZyBzY2hlbWEvc2VydmljZSByZWdpc3RyYXRpb25cbiAgICogbmVlZGVkIGJ5IGJhY2tlbmRzIHdpdGhvdXQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKiBcbiAgICogQHBhcmFtIGhvb2sgLSBDYWxsYmFjayB0byBleGVjdXRlIGR1cmluZyBpbml0aWFsaXphdGlvblxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUHJlSW5pdEhvb2soaG9vazogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHByZUluaXRIb29rcy5wdXNoKGhvb2spO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCAoZmlyZS1hbmQtZm9yZ2V0KVxuICAgKiBcbiAgICogQ2FwdHVyZSBjb250cm9sIGlzIGVtYmVkZGVkIGluIGlucHV0LmNhcHR1cmUgLSBubyBzZXBhcmF0ZSBvcHRpb25zIHBhcmFtLlxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBvYnNlcnZhYmlsaXR5TG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmUoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ+KdjCBPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSwgbGV2ZWw6IGlucHV0LmxldmVsIH0pO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gQmxvY2sgdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZXMgZnJvbSB0aGUgY2FwdHVyZSBwaXBlbGluZS5cbiAgICAgIC8vIHNwYW4uc3RhcnQgdXNlcyBTcGFuTGlmZWN5Y2xlSG9vayAoT1RFTCksIE5PVCBjYXB0dXJlIHBpcGVsaW5lLlxuICAgICAgLy8gc3Bhbi5lbmQgYW5kIHNwYW4uZXZlbnQgYXJlIGxlZ2FjeSBmb3JtYXRzLlxuICAgICAgaWYgKGlucHV0LnR5cGUgPT09ICdzcGFuLnN0YXJ0JyB8fCBpbnB1dC50eXBlID09PSAnc3Bhbi5lbmQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmV2ZW50Jykge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHk6IHVuc3VwcG9ydGVkIGV2ZW50IHR5cGUgaW4gY2FwdHVyZSBwaXBlbGluZSwgZHJvcHBpbmcuJywge1xuICAgICAgICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgICAgICAgb3BlcmF0aW9uOiBpbnB1dC5vcGVyYXRpb24sXG4gICAgICAgICAgaGludDogaW5wdXQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnID8gJ3NwYW4uc3RhcnQgdXNlcyBTcGFuTGlmZWN5Y2xlSG9vaycgOiAnbGVnYWN5IGZvcm1hdCBub3Qgc3VwcG9ydGVkJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlSW5wdXQoaW5wdXQpO1xuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGNhcHR1cmUgaW5wdXQ6JywgeyBlcnJvcnMsIHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghY29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBkaXNhYmxlZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICBjb25zdCBldmVudCA9IGJ1aWxkRXZlbnQoaW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nU3luYyhldmVudCwgY29udGV4dCk7XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2NhcHR1cmVkJykge1xuICAgICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgfVxuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdidWZmZXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgLy8gSEVBRC1CQVNFRCBGSUxURVJJTkcgKyBTQU1QTElOR1xuICAgICAgLy8gQXBwbHkgZmlsdGVyaW5nIGZpcnN0IChhbHdheXMgcnVucylcbiAgICAgIGlmICghc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgLy8gTm8gYnVmZmVyZWQgZ3JhcGggaGVyZTsgbmV2ZXIgZHJvcCBzcGFucyBieSBtaW5EdXJhdGlvbiBpbiBoZWFkLWJhc2VkIG1vZGVcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSBjYW4ndCBwcm92ZSB0aGV5IGFyZW4ndCBwYXJlbnRzIG9mIGFscmVhZHktZW1pdHRlZCBjaGlsZCBldmVudHMuXG4gICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogZmFsc2UsXG4gICAgICB9KSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBGaWx0ZXJlZCBvdXRcbiAgICAgIH1cblxuICAgICAgLy8gQXBwbHkgc2FtcGxpbmcgaWYgZW5hYmxlZCAocHJvYmFiaWxpc3RpYylcbiAgICAgIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgIXNob3VsZFNhbXBsZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBTYW1wbGVkIG91dFxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmU6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhbiBvYnNlcnZhYmlsaXR5IGV2ZW50IGFzeW5jaHJvbm91c2x5ICh3YWl0cyBmb3IgYmFja2VuZCBjYXB0dXJlKVxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBQcm9taXNlPG9ic2VydmFiaWxpdHlMb2dJZD4gaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhcHR1cmVBc3luYyhpbnB1dDogQ2FwdHVyZUlucHV0KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBCbG9jayB1bnN1cHBvcnRlZCBldmVudCB0eXBlcyBmcm9tIHRoZSBjYXB0dXJlIHBpcGVsaW5lLlxuICAgICAgLy8gc3Bhbi5zdGFydCB1c2VzIFNwYW5MaWZlY3ljbGVIb29rIChPVEVMKSwgTk9UIGNhcHR1cmUgcGlwZWxpbmUuXG4gICAgICAvLyBzcGFuLmVuZCBhbmQgc3Bhbi5ldmVudCBhcmUgbGVnYWN5IGZvcm1hdHMuXG4gICAgICBpZiAoaW5wdXQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmVuZCcgfHwgaW5wdXQudHlwZSA9PT0gJ3NwYW4uZXZlbnQnKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eTogdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZSBpbiBjYXB0dXJlIHBpcGVsaW5lLCBkcm9wcGluZy4nLCB7XG4gICAgICAgICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICAgICAgICBvcGVyYXRpb246IGlucHV0Lm9wZXJhdGlvbixcbiAgICAgICAgICBoaW50OiBpbnB1dC50eXBlID09PSAnc3Bhbi5zdGFydCcgPyAnc3Bhbi5zdGFydCB1c2VzIFNwYW5MaWZlY3ljbGVIb29rJyA6ICdsZWdhY3kgZm9ybWF0IG5vdCBzdXBwb3J0ZWQnLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVJbnB1dChpbnB1dCk7XG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ0ludmFsaWQgY2FwdHVyZSBpbnB1dDonLCB7IGVycm9ycywgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjb25maWc/LmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGlucHV0LCBjb250ZXh0KTtcblxuICAgICAgLy8gVHJ5IHRhaWwtYmFzZWQgc2FtcGxpbmcgZmlyc3RcbiAgICAgIGNvbnN0IHRhaWxSZXN1bHQgPSBhd2FpdCBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ0FzeW5jKGV2ZW50LCBjb250ZXh0KTtcbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnY2FwdHVyZWQnKSB7XG4gICAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgICB9XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2J1ZmZlcmVkJykge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICAvLyBIRUFELUJBU0VEIEZJTFRFUklORyArIFNBTVBMSU5HXG4gICAgICBpZiAoIXNob3VsZEZpbHRlcihldmVudCwgY29uZmlnLCB7XG4gICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogZmFsc2UsXG4gICAgICB9KSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBGaWx0ZXJlZCBvdXRcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCAmJiAhc2hvdWxkU2FtcGxlKGV2ZW50LCBjb25maWcpKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIFNhbXBsZWQgb3V0XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmVBc3luYzonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPYnNlcnZlIGFuIGV2ZW50IChjb252ZW5pZW5jZSBtZXRob2QpXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBQYXJ0aWFsIGV2ZW50IHdpdGggcmVxdWlyZWQgdHlwZSBhbmQgbGV2ZWxcbiAgICogQHJldHVybnMgb2JzZXJ2YWJpbGl0eUxvZ0lkIGlmIGNhcHR1cmVkLCB1bmRlZmluZWQgaWYgZmlsdGVyZWQvc2FtcGxlZCBvdXRcbiAgICovXG4gIHN0YXRpYyBvYnNlcnZlKFxuICAgIGV2ZW50OiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4gJiB7IHR5cGU6IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgY29ycmVsYXRpb25JZD86IHN0cmluZyB9XG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGV2ZW50LmNvcnJlbGF0aW9uSWQgPz8gZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzKCk7XG5cbiAgICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdvYnNlcnZlKCkgY2FsbGVkIHdpdGhvdXQgY29ycmVsYXRpb25JZCcpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB0eXBlOiBldmVudC50eXBlIGFzIENhcHR1cmVJbnB1dFsgJ3R5cGUnIF0sXG4gICAgICBsZXZlbDogZXZlbnQubGV2ZWwgYXMgQ2FwdHVyZUlucHV0WyAnbGV2ZWwnIF0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRmx1c2ggYWxsIGJhY2tlbmRzIGFuZCBidWZmZXJlZCBldmVudHMgKGNhbGxlZCBhdCBlbmQgb2YgTGFtYmRhIGludm9jYXRpb24pXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gRkxVU0ggU1RBUlQgPT09Jywge1xuICAgICAgcGVuZGluZ0Rpc3BhdGNoZXM6IHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCxcbiAgICAgIGJhY2tlbmRzOiBiYWNrZW5kcy5sZW5ndGgsXG4gICAgICBzbWFydFNhbXBsaW5nOiBjb25maWc/LnNhbXBsaW5nPy5zbWFydCxcbiAgICB9KTtcblxuICAgIC8vIFdhaXQgZm9yIGFsbCBwZW5kaW5nIGZpcmUtYW5kLWZvcmdldCBkaXNwYXRjaGVzIChmcm9tIGVycm9yIHBhdGggaW4gY2FwdHVyZSgpKVxuICAgIGlmIChwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYFdhaXRpbmcgZm9yICR7cGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RofSBwZW5kaW5nIGRpc3BhdGNoZXNgKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKHBlbmRpbmdEaXNwYXRjaGVzKTtcbiAgICAgIHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA9IDA7IC8vIENsZWFyIGZvciBuZXh0IGludm9jYXRpb25cbiAgICAgIGxvZ2dlci5kZWJ1ZygnUGVuZGluZyBkaXNwYXRjaGVzIGNvbXBsZXRlZCcpO1xuICAgIH1cblxuICAgIC8vIEZvcmNlLWVuZCBhbnkgc3BhbnMgbGVmdCBvcGVuIGluIHRoaXMgaW52b2NhdGlvbiBiZWZvcmUgZmx1c2hpbmcgYnVmZmVyZWQgZXZlbnRzLlxuICAgIC8vIFRoaXMgZ3VhcmFudGVlcyB0aGUgaGllcmFyY2h5IGhhcyBhbGwgcGFyZW50cywgZXZlbiBpZiB1c2VyL2ZyYW1ld29yayBjb2RlIGZvcmdvdCB0byBlbmQgYSBzcGFuLlxuICAgIHJ1blNwYW5GaW5hbGl6ZXIoKTtcblxuICAgIC8vIEF0dGFjaCBvYnNlcnZhYmlsaXR5IHN1bW1hcnkgdG8gY3VycmVudCBzcGFuIChpZiBhbnkpIGJlZm9yZSBmbHVzaGluZ1xuICAgIGNvbnN0IHN1bW1hcnkgPSBPYnNlcnZhYmlsaXR5TWFuYWdlci5nZXRTdW1tYXJ5KCk7XG4gICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgY29uc3QgY3VycmVudFNwYW4gPSBjb250ZXh0Py5vYnNlcnZhYmlsaXR5LmN1cnJlbnRTcGFuO1xuICAgIGlmIChzdW1tYXJ5ICYmIGN1cnJlbnRTcGFuICYmIChzdW1tYXJ5LmNhcHR1cmVkID4gMCB8fCBzdW1tYXJ5LmJ1ZmZlcmVkID4gMCB8fCBzdW1tYXJ5LmV2aWN0ZWQgPiAwIHx8IHN1bW1hcnkuc2FtcGxlZE91dCA+IDApKSB7XG4gICAgICAvLyBBZGQgYmFzaWMgY291bnQgbWV0cmljc1xuICAgICAgY3VycmVudFNwYW4/Lm1ldHJpY3M/Lih7XG4gICAgICAgICdfZncyNC5vYnMuY2FwdHVyZWQnOiBzdW1tYXJ5LmNhcHR1cmVkLFxuICAgICAgICAnX2Z3MjQub2JzLmJ1ZmZlcmVkJzogc3VtbWFyeS5idWZmZXJlZCxcbiAgICAgICAgJ19mdzI0Lm9icy5ldmljdGVkJzogc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICAnX2Z3MjQub2JzLnNhbXBsZWRPdXQnOiBzdW1tYXJ5LnNhbXBsZWRPdXQsXG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGRldGFpbGVkIGJyZWFrZG93biBjaGVja3BvaW50XG4gICAgICBjb25zdCBkZXRhaWxlZFN0YXRzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICAgdG90YWxzOiB7XG4gICAgICAgICAgY2FwdHVyZWQ6IHN1bW1hcnkuY2FwdHVyZWQsXG4gICAgICAgICAgYnVmZmVyZWQ6IHN1bW1hcnkuYnVmZmVyZWQsXG4gICAgICAgICAgZXZpY3RlZDogc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICAgIHNhbXBsZWRPdXQ6IHN1bW1hcnkuc2FtcGxlZE91dCxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIC8vIEFkZCBjYXB0dXJlZCBldmVudHMgYnJlYWtkb3duICh3aGF0IHdhcyBhY3R1YWxseSBlbWl0dGVkKVxuICAgICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Py5vYnNlcnZhYmlsaXR5O1xuICAgICAgaWYgKG9ic1N0YXRlPy5jYXB0dXJlZEJyZWFrZG93bikge1xuICAgICAgICBkZXRhaWxlZFN0YXRzLmNhcHR1cmVkQnJlYWtkb3duID0ge1xuICAgICAgICAgIGJ5VHlwZTogb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlUeXBlLFxuICAgICAgICAgIGJ5T3BlcmF0aW9uOiBPYmplY3Qua2V5cyhvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieU9wZXJhdGlvbiB8fCB7fSkubGVuZ3RoID4gMFxuICAgICAgICAgICAgPyBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieU9wZXJhdGlvblxuICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgYnlMZXZlbDogb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlMZXZlbCxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29tcHV0ZSBicmVha2Rvd24gYnkgdHlwZSBhbmQgb3BlcmF0aW9uIGZyb20gYnVmZmVyICh3aGF0J3Mgc3RpbGwgYnVmZmVyZWQpXG4gICAgICBpZiAoY29udGV4dCAmJiBjb250ZXh0Lm9ic2VydmFiaWxpdHkuYnVmZmVyLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgYnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGJ5T3BlcmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGJ5TGV2ZWw6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5idWZmZXIpIHtcbiAgICAgICAgICBieVR5cGVbIGV2ZW50LnR5cGUgXSA9IChieVR5cGVbIGV2ZW50LnR5cGUgXSB8fCAwKSArIDE7XG4gICAgICAgICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgICAgICAgYnlPcGVyYXRpb25bIGV2ZW50Lm9wZXJhdGlvbiBdID0gKGJ5T3BlcmF0aW9uWyBldmVudC5vcGVyYXRpb24gXSB8fCAwKSArIDE7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJ5TGV2ZWxbIGV2ZW50LmxldmVsIF0gPSAoYnlMZXZlbFsgZXZlbnQubGV2ZWwgXSB8fCAwKSArIDE7XG4gICAgICAgIH1cblxuICAgICAgICBkZXRhaWxlZFN0YXRzLmJ1ZmZlcmVkQnJlYWtkb3duID0ge1xuICAgICAgICAgIGJ5VHlwZSxcbiAgICAgICAgICBieU9wZXJhdGlvbjogT2JqZWN0LmtleXMoYnlPcGVyYXRpb24pLmxlbmd0aCA+IDAgPyBieU9wZXJhdGlvbiA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBieUxldmVsLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgY2hlY2twb2ludCB3aXRoIGRldGFpbGVkIHN0YXRzXG4gICAgICBjdXJyZW50U3Bhbj8uY2hlY2twb2ludD8uKCdvYnNlcnZhYmlsaXR5LnN1bW1hcnkuZGV0YWlsZWQnLCB7IGRhdGE6IGRldGFpbGVkU3RhdHMgfSk7XG4gICAgfVxuXG4gICAgLy8gSWYgYnVmZmVyaW5nIGlzIGVuYWJsZWQgKHNtYXJ0IHNhbXBsaW5nIE9SIG5vaXNlIHJlZHVjdGlvbiksIGZsdXNoIGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICBpZiAoY29uZmlnPy5zYW1wbGluZz8uc21hcnQgfHwgY29uZmlnPy5ub2lzZVJlZHVjdGlvbj8uZW5hYmxlZCkge1xuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgICAgIGlmIChjb250ZXh0ICYmIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5idWZmZXIubGVuZ3RoID4gMCAmJiAhY29udGV4dC5vYnNlcnZhYmlsaXR5LmVycm9yT2NjdXJyZWQpIHtcbiAgICAgICAgLy8gTm8gZXJyb3Igb2NjdXJyZWQ6IGFwcGx5IG5vaXNlIHJlZHVjdGlvbiArIG9wdGlvbmFsIHNhbXBsaW5nIHRvIGJ1ZmZlciBiZWZvcmUgZmx1c2hpbmdcbiAgICAgICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gICAgICAgIGNvbnN0IGJ1ZmZlciA9IG9ic1N0YXRlLmJ1ZmZlcjtcbiAgICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107IC8vIENsZWFyIGJ1ZmZlclxuXG4gICAgICAgIC8vIENSSVRJQ0FMOiBDb21wdXRlIHJlZmVyZW5jZWQgcGFyZW50IElEcyBmcm9tIE9SSUdJTkFMIGJ1ZmZlciBCRUZPUkUgbm9pc2UgcmVkdWN0aW9uXG4gICAgICAgIC8vIE5vaXNlIHJlZHVjdGlvbiBtYXkgYWJzb3JiL3NpbGVuY2UgZXZlbnRzLCBidXQgdGhlaXIgcGFyZW50IHNwYW5zIG11c3Qgc3RpbGwgYmUga2VwdFxuICAgICAgICBjb25zdCByZWZlcmVuY2VkUGFyZW50U3BhbklkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICBmb3IgKGNvbnN0IGUgb2YgYnVmZmVyKSB7XG4gICAgICAgICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgICAgICAgIGlmIChwaWQpIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLmFkZChwaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuICAgICAgICBjb25zdCByZWR1Y2VkRXZlbnRzID0gdW5wYWNrRW1pdHRlZEV2ZW50cyhyZWR1Y2VkLmV2ZW50cyk7XG5cbiAgICAgICAgLy8gRHJvcCBlbXB0eSAqbGVhZiogc3BhbnMgaWYgY29uZmlndXJlZC5cbiAgICAgICAgLy8gQSBzcGFuIGlzIGEgbGVhZiBpZmYgbm9ib2R5IHJlZmVyZW5jZXMgaXQgYXMgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGluIHRoaXMgYnVmZmVyZWQgc2V0LlxuICAgICAgICBjb25zdCBtYXliZURyb3BFbXB0eUxlYWZTcGFucyA9IGNvbmZpZy5zcGFucy5za2lwRW1wdHlcbiAgICAgICAgICA/IHJlZHVjZWRFdmVudHMuZmlsdGVyKChlKSA9PiB7XG4gICAgICAgICAgICBpZiAoZS50eXBlICE9PSAnc3BhbicpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBlLm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgaWYgKHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLmhhcyhpZCkpIHJldHVybiB0cnVlOyAvLyBwYXJlbnQgPT4ga2VlcFxuICAgICAgICAgICAgY29uc3QgZCA9IGUuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbnN0IGZ3ID0gZD8uX2Z3MjQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gZnc/LnNwYW5FbXB0eSAhPT0gdHJ1ZTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogcmVkdWNlZEV2ZW50cztcblxuICAgICAgICAvLyBFbnJpY2ggcm9vdCBzcGFuIHdpdGggaW52b2NhdGlvbiBzdW1tYXJ5IChjb21wYWN0IG92ZXJ2aWV3IG9mIHdoYXQgaGFwcGVuZWQpXG4gICAgICAgIGNvbnN0IHJvb3RTcGFuID0gbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMuZmluZChcbiAgICAgICAgICBlID0+IGUudHlwZSA9PT0gJ3NwYW4nICYmICFlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAgICAgICApO1xuICAgICAgICBpZiAocm9vdFNwYW4pIHtcbiAgICAgICAgICBjb25zdCBzdW1tYXJ5QnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgICAgY29uc3Qgc3VtbWFyeUJ5TGV2ZWw6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgICBsZXQgZXJyb3JDb3VudCA9IDA7XG4gICAgICAgICAgZm9yIChjb25zdCBlIG9mIG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zKSB7XG4gICAgICAgICAgICBzdW1tYXJ5QnlUeXBlW2UudHlwZV0gPSAoc3VtbWFyeUJ5VHlwZVtlLnR5cGVdIHx8IDApICsgMTtcbiAgICAgICAgICAgIHN1bW1hcnlCeUxldmVsW2UubGV2ZWxdID0gKHN1bW1hcnlCeUxldmVsW2UubGV2ZWxdIHx8IDApICsgMTtcbiAgICAgICAgICAgIGlmIChlLmxldmVsID09PSAnZXJyb3InIHx8IGUubGV2ZWwgPT09ICdjcml0aWNhbCcpIGVycm9yQ291bnQrKztcbiAgICAgICAgICB9XG4gICAgICAgICAgcm9vdFNwYW4uZGF0YSA9IHtcbiAgICAgICAgICAgIC4uLihyb290U3Bhbi5kYXRhID8/IHt9KSxcbiAgICAgICAgICAgIF9pbnZvY2F0aW9uU3VtbWFyeToge1xuICAgICAgICAgICAgICB0b3RhbEV2ZW50czogbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMubGVuZ3RoLFxuICAgICAgICAgICAgICBieVR5cGU6IHN1bW1hcnlCeVR5cGUsXG4gICAgICAgICAgICAgIGJ5TGV2ZWw6IHN1bW1hcnlCeUxldmVsLFxuICAgICAgICAgICAgICBoYXNFcnJvcnM6IGVycm9yQ291bnQgPiAwLFxuICAgICAgICAgICAgICBlcnJvckNvdW50LFxuICAgICAgICAgICAgICBub2lzZVJlZHVjdGlvbjogcmVkdWNlZC5zdGF0cyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyYWNrIGNhcHR1cmVkIGV2ZW50cyBmb3IgZGV0YWlsZWQgc3VtbWFyeVxuICAgICAgICBjb25zdCBjYXB0dXJlZEJ5VHlwZTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICBjb25zdCBjYXB0dXJlZEJ5T3BlcmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkQnlMZXZlbDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gICAgICAgIGZvciAoY29uc3QgZXZlbnQgb2YgbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMpIHtcbiAgICAgICAgICAvLyBUQUlMLUJBU0VEIEZJTFRFUklORyArIFNBTVBMSU5HIChhZnRlciBub2lzZSByZWR1Y3Rpb24pXG5cbiAgICAgICAgICAvLyBBcHBseSBmaWx0ZXJpbmcgZmlyc3QgKGFsd2F5cyBydW5zIC0gY29udGVudC1iYXNlZClcbiAgICAgICAgICBjb25zdCBwYXNzZWRGaWx0ZXIgPSBzaG91bGRGaWx0ZXIoZXZlbnQsIGNvbmZpZywge1xuICAgICAgICAgICAgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wOiB0cnVlLFxuICAgICAgICAgICAgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKCFwYXNzZWRGaWx0ZXIpIHtcbiAgICAgICAgICAgIC8vIEZpbHRlcmVkIG91dCAtIGRvbid0IGNvdW50IGFzIHNhbXBsZWQgb3V0XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBBcHBseSBzYW1wbGluZyBpZiBlbmFibGVkIChwcm9iYWJpbGlzdGljKVxuICAgICAgICAgIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgIXNob3VsZFNhbXBsZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5zYW1wbGVkT3V0Kys7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBUcmFjayBjYXB0dXJlZCBldmVudCBicmVha2Rvd25zXG4gICAgICAgICAgY2FwdHVyZWRCeVR5cGVbZXZlbnQudHlwZV0gPSAoY2FwdHVyZWRCeVR5cGVbZXZlbnQudHlwZV0gfHwgMCkgKyAxO1xuICAgICAgICAgIGlmIChldmVudC5vcGVyYXRpb24pIHtcbiAgICAgICAgICAgIGNhcHR1cmVkQnlPcGVyYXRpb25bZXZlbnQub3BlcmF0aW9uXSA9IChjYXB0dXJlZEJ5T3BlcmF0aW9uW2V2ZW50Lm9wZXJhdGlvbl0gfHwgMCkgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYXB0dXJlZEJ5TGV2ZWxbZXZlbnQubGV2ZWxdID0gKGNhcHR1cmVkQnlMZXZlbFtldmVudC5sZXZlbF0gfHwgMCkgKyAxO1xuICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgICAgICAgIC8vIFBhc3NlZCBib3RoIGZpbHRlcmluZyBhbmQgc2FtcGxpbmcgLSBlbWl0XG4gICAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgICAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFN0b3JlIGNhcHR1cmVkIGJyZWFrZG93bnMgaW4gY29udGV4dCBmb3Igc3VtbWFyeSBjaGVja3BvaW50XG4gICAgICAgIGlmICghb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24pIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93biA9IHsgYnlUeXBlOiB7fSwgYnlPcGVyYXRpb246IHt9LCBieUxldmVsOiB7fSB9O1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgWyB0eXBlLCBjb3VudCBdIG9mIE9iamVjdC5lbnRyaWVzKGNhcHR1cmVkQnlUeXBlKSkge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5VHlwZVsgdHlwZSBdID0gKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5VHlwZVsgdHlwZSBdIHx8IDApICsgY291bnQ7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBbIG9wLCBjb3VudCBdIG9mIE9iamVjdC5lbnRyaWVzKGNhcHR1cmVkQnlPcGVyYXRpb24pKSB7XG4gICAgICAgICAgb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlPcGVyYXRpb25bIG9wIF0gPSAob2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlPcGVyYXRpb25bIG9wIF0gfHwgMCkgKyBjb3VudDtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFsgbGV2ZWwsIGNvdW50IF0gb2YgT2JqZWN0LmVudHJpZXMoY2FwdHVyZWRCeUxldmVsKSkge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5TGV2ZWxbIGxldmVsIF0gPSAob2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlMZXZlbFsgbGV2ZWwgXSB8fCAwKSArIGNvdW50O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBJZiBlcnJvck9jY3VycmVkPXRydWUsIGJ1ZmZlciB3YXMgYWxyZWFkeSBmbHVzaGVkIGR1cmluZyBjYXB0dXJlXG4gICAgfVxuXG4gICAgLy8gRmx1c2ggYWxsIGJhY2tlbmRzIHdpdGggcmV0cnkgbG9naWNcbiAgICAvLyBXcmFwIGVhY2ggYmFja2VuZCBmbHVzaCBpbiB0cnktY2F0Y2ggdG8gZW5zdXJlIGFsbCBiYWNrZW5kcyBhdHRlbXB0IHRvIGZsdXNoXG4gICAgLy8gZXZlbiBpZiBvbmUgZmFpbHMgY2F0YXN0cm9waGljYWxseVxuICAgIGNvbnN0IE1BWF9GTFVTSF9SRVRSSUVTID0gMjtcbiAgICBjb25zdCBmbHVzaFByb21pc2VzID0gYmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIWJhY2tlbmQuZmx1c2gpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBhdHRlbXB0ID0gMTsgYXR0ZW1wdCA8PSBNQVhfRkxVU0hfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcbiAgICAgICAgICAgIGJyZWFrOyAvLyBTdWNjZXNzXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChhdHRlbXB0ID09PSBNQVhfRkxVU0hfUkVUUklFUykge1xuICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGZhaWxlZCBhZnRlciAke2F0dGVtcHR9IGF0dGVtcHRzOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgLy8gRXZlbnRzIG1heSBiZSBsb3N0LCBidXQgd2UndmUgZG9uZSBvdXIgYmVzdFxuICAgICAgICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGFsbG93IG90aGVyIGJhY2tlbmRzIHRvIGZsdXNoXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIChhdHRlbXB0ICR7YXR0ZW1wdH0vJHtNQVhfRkxVU0hfUkVUUklFU30pLCByZXRyeWluZy4uLmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgLy8gU2ltcGxlIGV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCAqIGF0dGVtcHQpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENhdGNoIGFueSB1bmV4cGVjdGVkIGVycm9ycyBvdXRzaWRlIHRoZSByZXRyeSBsb29wXG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggY29tcGxldGVseSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGFsbG93IG90aGVyIGJhY2tlbmRzIHRvIGZsdXNoXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChmbHVzaFByb21pc2VzKTtcblxuICAgIGxvZ2dlci5kZWJ1ZygnPT09IEZMVVNIIENPTVBMRVRFID09PScpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IG1hbmFnZXIgc3RhdGUgKGZvciB0ZXN0aW5nKVxuICAgKi9cbiAgc3RhdGljIHJlc2V0KCk6IHZvaWQge1xuICAgIGNvbmZpZyA9IG51bGw7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcobnVsbCk7XG4gICAgYmFja2VuZHMgPSBbXTtcbiAgICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICAgIGludm9jYXRpb25Db3VudCA9IDA7XG4gICAgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuY2xlYXIoKTtcbiAgICBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPSAwO1xuICAgIHJlc2V0Q2FwdHVyZXIoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciB0ZXN0aW5nIHdpdGggbW9jayBjb25maWcgYW5kIGJhY2tlbmRzXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZUZvclRlc3RpbmcoXG4gICAgdGVzdENvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgICB0ZXN0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXVxuICApOiB2b2lkIHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICAgIGNvbmZpZyA9IHRlc3RDb25maWc7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcodGVzdENvbmZpZyk7XG4gICAgYmFja2VuZHMgPSB0ZXN0QmFja2VuZHM7XG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIExhbWJkYSBoYW5kbGVyIHdyYXBwZXIgd2l0aCBvYnNlcnZhYmlsaXR5IGxpZmVjeWNsZSBtYW5hZ2VtZW50XG4gKi9cbmV4cG9ydCBjb25zdCB3aXRoT2JzZXJ2YWJpbGl0eSA9IDxUIGV4dGVuZHMgKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gUHJvbWlzZTx1bmtub3duPj4oaGFuZGxlcjogVCk6IFQgPT4ge1xuICByZXR1cm4gKGFzeW5jICguLi5hcmdzOiBQYXJhbWV0ZXJzPFQ+KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlciguLi5hcmdzKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9XG4gIH0pIGFzIFQ7XG59O1xuXG5leHBvcnQgY29uc3QgT2JzZXJ2ZXIgPSBPYnNlcnZhYmlsaXR5TWFuYWdlcjtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBURVNUIEVYUE9SVFMgLSBPbmx5IGZvciB0ZXN0aW5nIGludGVybmFsIGZ1bmN0aW9uc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogRXhwb3J0IHByaXZhdGUgZnVuY3Rpb25zIGZvciB0ZXN0aW5nLlxuICogVGhlc2Ugc2hvdWxkIE9OTFkgYmUgdXNlZCBpbiB0ZXN0IGZpbGVzLlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjb25zdCBfX3Rlc3RfXyA9IHtcbiAgZXZpY3RMb3dlc3RQcmlvcml0eSxcbiAgc2hvdWxkRmlsdGVyLFxuICBzaG91bGRTYW1wbGUsXG4gIGdldEV2ZW50UHJpb3JpdHksXG4gIGJ1aWxkRXZlbnQsXG59O1xuIl19