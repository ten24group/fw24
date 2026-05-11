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
            backend.configureFromBackendEntry?.(backendCfg);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILHVEQUFrRjtBQUNsRix3Q0FBMEM7QUFDMUMsbUNBVWlCO0FBR2pCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELGlFQUFvRTtBQUNwRSx1Q0FBd0U7QUFDeEUsMkNBQXFFO0FBQ3JFLDhCQUFvQztBQUNwQyx5Q0FBb0Q7QUFDcEQsdURBQTJFO0FBQzNFLHlEQUFpRTtBQUVqRSxxQ0FBb0Y7QUFDcEYsbURBQXlHO0FBQ3pHLHlEQUF1RTtBQUV2RSxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQU9wRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxJQUFJLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0FBQzlDLElBQUksUUFBUSxHQUEyQixFQUFFLENBQUM7QUFDMUMsSUFBSSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQWtELENBQUM7QUFDL0UsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztBQUN4QixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBQ3JELE1BQU0saUJBQWlCLEdBQW9CLEVBQUUsQ0FBQyxDQUFDLDZDQUE2QztBQUU1Rjs7O0dBR0c7QUFDSCxNQUFNLFlBQVksR0FBc0IsRUFBRSxDQUFDO0FBRTNDLDhFQUE4RTtBQUM5RSw4QkFBOEI7QUFDOUIsOEVBQThFO0FBRTlFOzs7Ozs7R0FNRztBQUNILFNBQVMsbUJBQW1CLENBQUMsYUFBc0M7SUFDakUsTUFBTSxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUV4QyxLQUFLLE1BQU0sT0FBTyxJQUFJLGFBQWEsRUFBRSxDQUFDO1FBQ3BDLDZEQUE2RDtRQUM3RCxNQUFNLEtBQUssR0FBdUIsRUFBRSxHQUFHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUV2RCxxRkFBcUY7UUFDckYsSUFBSSxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDckIsTUFBTSxZQUFZLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7WUFFdEMscUdBQXFHO1lBQ3JHLCtGQUErRjtZQUMvRiw2RUFBNkU7WUFDN0UsSUFBSSxXQUFXLEdBQUksWUFBWSxDQUFDLFdBQXlCLElBQUksRUFBRSxDQUFDO1lBQ2hFLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUM1QyxNQUFNLGNBQWMsR0FBRyxJQUFBLDhDQUEyQixFQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLENBQUM7Z0JBQ2pGLFdBQVcsR0FBRyxDQUFDLEdBQUcsV0FBVyxFQUFFLEdBQUcsY0FBYyxDQUFDLENBQUM7WUFDcEQsQ0FBQztZQUVELCtFQUErRTtZQUMvRSwrREFBK0Q7WUFDL0QsTUFBTSxlQUFlLEdBQTRCO2dCQUMvQyxLQUFLLEVBQUUsT0FBTyxDQUFDLFFBQVEsQ0FBQyxLQUFLO2dCQUM3QixXQUFXLEVBQUUsT0FBTyxDQUFDLFFBQVEsQ0FBQyxXQUFXO2FBQzFDLENBQUM7WUFDRixJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDdkMsZUFBZSxDQUFDLE1BQU0sR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQztZQUNuRCxDQUFDO1lBQ0QsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzlDLGVBQWUsQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUM7WUFDakUsQ0FBQztZQUVELEtBQUssQ0FBQyxJQUFJLEdBQUc7Z0JBQ1gsR0FBRyxZQUFZO2dCQUNmLFdBQVcsRUFBRSxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxTQUFTO2dCQUM3RCxRQUFRLEVBQUUsZUFBZTthQUMxQixDQUFDO1FBQ0osQ0FBQztRQUVELCtDQUErQztRQUMvQyxJQUFJLE9BQU8sQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUN0QixLQUFLLENBQUMsSUFBSSxHQUFHO2dCQUNYLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDckIsV0FBVyxFQUFFLE9BQU8sQ0FBQyxTQUFTO2FBQy9CLENBQUM7UUFDSixDQUFDO1FBRUQsaURBQWlEO1FBQ2pELGtFQUFrRTtRQUNsRSxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUMzQyxpREFBaUQ7WUFDakQsS0FBSyxDQUFDLHdCQUF3QixHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztRQUM1RCxDQUFDO2FBQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLEVBQUUsQ0FBQztZQUMxQyxxRkFBcUY7WUFDckYsTUFBTSxhQUFhLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEtBQUssS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7WUFDN0csSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO2dCQUNuQix5RUFBeUU7WUFDM0UsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLG9FQUFvRTtnQkFDcEUsS0FBSyxDQUFDLHdCQUF3QixHQUFHLFNBQVMsQ0FBQztZQUM3QyxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDckIsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFFRCxvRkFBb0Y7QUFFcEYsOEVBQThFO0FBQzlFLDJCQUEyQjtBQUMzQiw4RUFBOEU7QUFFOUUsU0FBUyxhQUFhLENBQUMsS0FBbUI7SUFDeEMsTUFBTSxNQUFNLEdBQXNCLEVBQUUsQ0FBQztJQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFpQixHQUFFLENBQUM7SUFFcEMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNoQixNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDO0lBQzlELENBQUM7SUFFRCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2pCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxDQUFDLENBQUM7SUFDaEUsQ0FBQztJQUVELElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxJQUFJLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxDQUFDO1FBQ3BELE1BQU0sQ0FBQyxJQUFJLENBQUM7WUFDVixLQUFLLEVBQUUsZUFBZTtZQUN0QixPQUFPLEVBQUUsMEdBQTBHO1NBQ3BILENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBRUQsU0FBUyxtQkFBbUIsQ0FDMUIsS0FBbUIsRUFDbkIsY0FBd0Q7SUFReEQsSUFBSSxDQUFDLGNBQWMsRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUM3QixPQUFPO1lBQ0wsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1lBQ2hCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7WUFDeEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1lBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztTQUNuQixDQUFDO0lBQ0osQ0FBQztJQUVELE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxNQUFNLElBQUksQ0FBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUUsQ0FBQztJQUV4RixPQUFPO1FBQ0wsSUFBSSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUk7WUFDekMsQ0FBQyxDQUFDLElBQUEscUNBQW1CLEVBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxjQUFjLENBQUM7WUFDakQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJO1FBQ2QsVUFBVSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVU7WUFDM0QsQ0FBQyxDQUFDLElBQUEscUNBQW1CLEVBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRSxjQUFjLENBQUM7WUFDdkQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVO1FBQ3BCLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRO1lBQ3JELENBQUMsQ0FBQyxJQUFBLHFDQUFtQixFQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsY0FBYyxDQUFDO1lBQ3JELENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUTtRQUNsQixPQUFPLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTztZQUNsRCxDQUFDLENBQUMsSUFBQSxxQ0FBbUIsRUFBQyxLQUFLLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQztZQUNwRCxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU87UUFDakIsS0FBSyxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUs7WUFDNUMsQ0FBQyxDQUFDLElBQUEscUNBQW1CLEVBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxjQUFjLENBQUM7WUFDbEQsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLO0tBQ2hCLENBQUM7QUFDSixDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsS0FBbUIsRUFBRSxVQUF1RCxJQUFJO0lBQ2xHLE1BQU0sR0FBRyxHQUFHLE9BQU8sSUFBSSxJQUFBLDJCQUFpQixHQUFFLENBQUM7SUFDM0MsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRXZCLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLElBQUksR0FBRyxFQUFFLGFBQWEsQ0FBQztJQUNoRSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQyx3RUFBd0UsQ0FBQyxDQUFDO0lBQzVGLENBQUM7SUFFRCxNQUFNLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsR0FBRyxtQkFBbUIsQ0FDdEYsS0FBSyxFQUNMLE1BQU0sRUFBRSxjQUFjLENBQ3ZCLENBQUM7SUFFRixtRkFBbUY7SUFDbkYsTUFBTSxNQUFNLEdBQUcsTUFBTSxFQUFFLHNCQUFzQixDQUFDO0lBQzlDLElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7SUFDaEMsSUFBSSwwQkFBK0QsQ0FBQztJQUNwRSxJQUFJLE1BQU0sRUFBRSxPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7UUFDakMsTUFBTSxpQkFBaUIsR0FBRyxTQUFTLENBQUM7UUFDcEMsTUFBTSxZQUFZLEdBQXFFLEVBQUUsQ0FBQztRQUMxRixNQUFNLFNBQVMsR0FBRyxDQUNoQixTQUFzRyxFQUN0RyxTQUFpQixFQUNqQixFQUFFO1lBQ0YsSUFBSSxDQUFDLFNBQVM7Z0JBQUUsT0FBTyxJQUFJLENBQUM7WUFDNUIsTUFBTSxHQUFHLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFFLFNBQVMsQ0FBRSxDQUFDO1lBQ2pFLDZGQUE2RjtZQUM3RixPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzdDLENBQUMsQ0FBQztRQUVGLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQztnQkFBRSxTQUFTO1lBQ2pELElBQUksQ0FBQyxJQUFBLDhCQUFjLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7Z0JBQUUsU0FBUztZQUNyRCxNQUFNLElBQUksR0FBRyxJQUFBLDhCQUFjLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2pFLElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUN2QixZQUFZLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztnQkFDbkYsU0FBUyxHQUFHLElBQUksQ0FBQztZQUNuQixDQUFDO1FBQ0gsQ0FBQztRQUVELHFEQUFxRDtRQUNyRCxJQUFJLE1BQU0sQ0FBQyxhQUFhLEtBQUssS0FBSyxJQUFJLFNBQVMsS0FBSyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3RFLDBCQUEwQixHQUFHO2dCQUMzQixJQUFJLEVBQUUsaUJBQWlCO2dCQUN2QixFQUFFLEVBQUUsU0FBUztnQkFDYixPQUFPLEVBQUUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3BDLEtBQUssRUFBRSxZQUFZO2FBQ3BCLENBQUM7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVELDhDQUE4QztJQUM5QyxJQUFJLFVBQVUsR0FBRyxJQUFBLHdCQUFTLEVBQUMsRUFBRSxHQUFHLEdBQUcsRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLEdBQUcsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRWpGLDJFQUEyRTtJQUMzRSxNQUFNLGFBQWEsR0FBRyxNQUFNLEVBQUUsS0FBSyxFQUFFLGtCQUFrQixDQUFDO0lBQ3hELElBQUksYUFBYSxJQUFJLElBQUksSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLElBQUksSUFBSSxLQUFLLENBQUMsVUFBVSxHQUFHLGFBQWEsRUFBRSxDQUFDO1FBQzFGLFVBQVUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxDQUFDO0lBQ3hELENBQUM7SUFFRCxPQUFPO1FBQ0wsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1FBQ2hCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztRQUNsQixhQUFhO1FBQ2IsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXLElBQUksR0FBRztRQUNyQyxrQkFBa0IsRUFBRSxLQUFLLENBQUMsa0JBQWtCLElBQUksSUFBQSx5Q0FBMEIsRUFBQyxhQUFhLENBQUM7UUFDekYsa0dBQWtHO1FBQ2xHLG9DQUFvQztRQUNwQyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsd0JBQXdCLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyx3QkFBd0I7UUFDOUcsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRO1FBQ3hCLGFBQWEsRUFBRSxLQUFLLENBQUMsYUFBYTtRQUNsQyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUssSUFBSSxHQUFHLEVBQUUsS0FBSztRQUNoQyxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU0sSUFBSSxHQUFHLEVBQUUsYUFBYSxFQUFFLE1BQU0sSUFBSSxJQUFBLDJCQUFZLEdBQUU7UUFDcEUsSUFBSSxFQUFFLFVBQVU7UUFDaEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1FBQzVCLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUTtRQUN4QixTQUFTO1FBQ1QsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtRQUNwQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87UUFDdEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1FBQzVCLElBQUksRUFBRSwwQkFBMEI7WUFDOUIsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsRUFBRSxzQkFBc0IsRUFBRSwwQkFBMEIsRUFBRTtZQUN6RSxDQUFDLENBQUMsSUFBSTtRQUNSLFVBQVU7UUFDVixRQUFRO1FBQ1IsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLE9BQU8sRUFBRSxZQUFZO1FBQ3JCLEtBQUs7UUFDTCxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFBLDJDQUF1QixFQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1FBQy9ELE9BQU8sRUFBRSxLQUFLLENBQUMsT0FBTztLQUN2QixDQUFDO0FBQ0osQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBQ0gsU0FBUyxlQUFlLENBQUMsSUFBWTtJQUNuQyw0RUFBNEU7SUFDNUUsb0ZBQW9GO0lBQ3BGLElBQUksSUFBSSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssWUFBWTtRQUFFLE9BQU8sTUFBTSxDQUFDO0lBQzVELElBQUksSUFBSSxLQUFLLFFBQVE7UUFBRSxPQUFPLFFBQVEsQ0FBQztJQUN2QyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDO1FBQUUsT0FBTyxPQUFPLENBQUM7SUFDN0MsbURBQW1EO0lBQ25ELG1FQUFtRTtJQUNuRSxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRCxTQUFTLGtCQUFrQixDQUFDLElBQVk7SUFDdEMsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNDLE1BQU0sVUFBVSxHQUFHLE1BQU0sRUFBRSxLQUFLLEVBQUUsQ0FBRSxZQUFZLENBQUUsQ0FBQztJQUVuRCxJQUFJLFVBQVUsRUFBRSxRQUFRLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDM0QsT0FBTyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FDM0IsVUFBVSxDQUFDLFFBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQWdDLENBQUMsQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7SUFFRCxPQUFPLFFBQVEsQ0FBQztBQUNsQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLHdCQUF3QixDQUMvQixPQUE2QixFQUM3QixLQUF5QjtJQUV6Qiw4RUFBOEU7SUFDOUUsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDakUsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBZ0MsQ0FBQyxFQUFFLENBQUM7WUFDL0UsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU0sVUFBVSxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3BELElBQUksQ0FBQyxVQUFVO1FBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyx3QkFBd0I7SUFFdEQsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNqRCxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLENBQUUsWUFBWSxDQUFFLENBQUM7SUFFdEQsd0RBQXdEO0lBQ3hELElBQUksVUFBVSxFQUFFLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztRQUNsQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxNQUFNLFVBQVUsR0FBRyxJQUFBLDJCQUFhLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRTlDLDZEQUE2RDtJQUM3RCxJQUFJLFVBQVUsRUFBRSxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDdkMsSUFBSSxVQUFVLEdBQUcsVUFBVSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3JDLE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7U0FBTSxJQUFJLE9BQU8sQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDMUMsc0NBQXNDO1FBQ3RDLElBQUksVUFBVSxHQUFHLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNsQyxPQUFPLEtBQUssQ0FBQztRQUNmLENBQUM7SUFDSCxDQUFDO0lBRUQsMEJBQTBCO0lBQzFCLElBQUksVUFBVSxFQUFFLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUN2QyxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzdDLENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQyxDQUFDLHFCQUFxQjtBQUNwQyxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBUyxpQkFBaUIsQ0FBQyxLQUF5QjtJQUNsRCxJQUFJLENBQUMsTUFBTSxFQUFFLFlBQVk7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUV4QyxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO0lBQ3RDLE1BQU0sT0FBTyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUM7SUFDbEMsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDLE9BQU8sSUFBSSxFQUFFLENBQUM7SUFFeEMsdUJBQXVCO0lBQ3ZCLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDO1FBQzVCLE9BQU8sRUFBRSxVQUFVLEVBQUUsbUJBQW1CLEVBQUUsWUFBWTtRQUN0RCxXQUFXLEVBQUUsYUFBYSxFQUFFLFlBQVksRUFBRSxXQUFXO0tBQ3RELENBQUMsQ0FBQztJQUVILE1BQU0sWUFBWSxHQUEyQixFQUFFLENBQUM7SUFDaEQsSUFBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDO0lBRWpCLHVCQUF1QjtJQUN2QixJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNmLEtBQUssTUFBTSxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3hELElBQUksUUFBUSxJQUFJLE9BQU87Z0JBQUUsTUFBTTtZQUUvQiwyQ0FBMkM7WUFDM0MsSUFBSSxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzNCLElBQUksT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUN0QyxTQUFTLENBQUMsV0FBVztnQkFDdkIsQ0FBQztZQUNILENBQUM7WUFDRCx3Q0FBd0M7WUFFeEMsb0JBQW9CO1lBQ3BCLFlBQVksQ0FBRSxHQUFHLENBQUUsR0FBRyxPQUFPLEtBQUssS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3hFLFFBQVEsRUFBRSxDQUFDO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRCw4QkFBOEI7SUFDOUIsSUFBSSxTQUFTLENBQUMsTUFBTSxJQUFJLFFBQVEsR0FBRyxPQUFPLEVBQUUsQ0FBQztRQUMzQyxLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsT0FBTyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUNoRSxJQUFJLFFBQVEsSUFBSSxPQUFPO2dCQUFFLE1BQU07WUFDL0IsSUFBSSxZQUFZLENBQUUsR0FBRyxDQUFFLEtBQUssU0FBUztnQkFBRSxTQUFTLENBQUMsaUJBQWlCO1lBRWxFLElBQUksQ0FBQztnQkFDSCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzdCLElBQUksS0FBSyxFQUFFLENBQUM7b0JBQ1YsWUFBWSxDQUFFLEdBQUcsQ0FBRSxHQUFHLEtBQUssQ0FBQztvQkFDNUIsUUFBUSxFQUFFLENBQUM7Z0JBQ2IsQ0FBQztZQUNILENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sQ0FBQyxJQUFJLENBQUMsaUNBQWlDLEdBQUcsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzlELENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU87UUFDTCxHQUFHLEtBQUs7UUFDUixJQUFJLEVBQUUsWUFBWTtLQUNuQixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsa0JBQWtCLENBQUMsS0FBeUIsRUFBRSxjQUFzQztJQUMzRixpREFBaUQ7SUFDakQsTUFBTSxhQUFhLEdBQUcsaUJBQWlCLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFL0MsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FDekIsY0FBYyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUU7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLHdCQUF3QixDQUFDLE9BQU8sRUFBRSxhQUFhLENBQUMsRUFBRSxDQUFDO2dCQUN0RCxPQUFPO1lBQ1QsQ0FBQztZQUNELE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUN2QyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN2RSxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQ0gsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQywyQkFBMkI7SUFFOUMsMkNBQTJDO0lBQzNDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNsQyxDQUFDO0FBRUQsS0FBSyxVQUFVLHNCQUFzQixDQUFDLEtBQXlCLEVBQUUsY0FBc0M7SUFDckcsaURBQWlEO0lBQ2pELE1BQU0sYUFBYSxHQUFHLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxDQUFDO0lBRS9DLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FDZixjQUFjLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsRUFBRTtRQUNuQyxJQUFJLENBQUM7WUFDSCxJQUFJLENBQUMsd0JBQXdCLENBQUMsT0FBTyxFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RELE9BQU87WUFDVCxDQUFDO1lBQ0QsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsT0FBTyxDQUFDLElBQUksR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7SUFDSCxDQUFDLENBQUMsQ0FDSCxDQUFDO0FBQ0osQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxXQUFXLENBQUMsS0FBeUIsRUFBRSxJQUFrQjtJQUNoRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxHQUFHLElBQUksQ0FBQztJQUVqQyxJQUFJLFlBQWdDLENBQUM7SUFFckMsUUFBUSxNQUFNLEVBQUUsQ0FBQztRQUNmLEtBQUssUUFBUTtZQUNYLHdDQUF3QztZQUN4QyxZQUFZLEdBQUcsS0FBSyxDQUFDLEtBQUssRUFBRSxRQUFRLElBQUksS0FBSyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUM7WUFDN0QsTUFBTTtRQUVSLEtBQUssT0FBTztZQUNWLDZEQUE2RDtZQUM3RCxZQUFZLEdBQUcsS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQy9DLE1BQU07UUFFUixLQUFLLEtBQUs7WUFDUix5Q0FBeUM7WUFDekMsSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN6RCxNQUFNLENBQUUsR0FBRyxFQUFFLFlBQVksQ0FBRSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO2dCQUNwRCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUUsR0FBRyxDQUFFLENBQUM7Z0JBQ3JDLElBQUksQ0FBQyxRQUFRO29CQUFFLE9BQU8sS0FBSyxDQUFDO2dCQUU1QixJQUFJLFlBQVksS0FBSyxHQUFHO29CQUFFLE9BQU8sSUFBSSxDQUFDO2dCQUV0QyxrREFBa0Q7Z0JBQ2xELE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLFlBQVksQ0FBQyxDQUFDO2dCQUNyRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDOUIsQ0FBQztZQUNELE9BQU8sS0FBSyxDQUFDO1FBRWYsS0FBSyxPQUFPO1lBQ1YsNkJBQTZCO1lBQzdCLFlBQVksR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFFLE9BQU8sSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLFNBQVMsQ0FBQztZQUM5RCxNQUFNO1FBRVIsS0FBSyxRQUFRO1lBQ1gsWUFBWSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7WUFDNUIsTUFBTTtRQUVSO1lBQ0UsT0FBTyxLQUFLLENBQUM7SUFDakIsQ0FBQztJQUVELElBQUksQ0FBQyxZQUFZO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFaEMsMkNBQTJDO0lBQzNDLElBQUksT0FBTyxZQUFZLE1BQU0sRUFBRSxDQUFDO1FBQzlCLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNwQyxDQUFDO0lBRUQsdUNBQXVDO0lBQ3ZDLE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2hELE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUNsQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsWUFBWSxDQUNuQixLQUF5QixFQUN6QixHQUF3QixFQUN4QixPQVdDO0lBRUQsTUFBTSxVQUFVLEdBQUcsSUFBQSwyQkFBYSxFQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM5QyxNQUFNLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDO0lBQzlCLE1BQU0sWUFBWSxHQUFHLEtBQUssQ0FBQyxJQUFJLEtBQUssTUFBTSxDQUFDO0lBQzNDLE1BQU0sd0JBQXdCLEdBQUcsT0FBTyxFQUFFLHdCQUF3QixLQUFLLElBQUksQ0FBQztJQUM1RSxNQUFNLHVCQUF1QixHQUFHLE9BQU8sRUFBRSx1QkFBdUIsQ0FBQztJQUVqRSx1Q0FBdUM7SUFFdkMsMEJBQTBCO0lBQzFCLElBQUksT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDO1FBQ3BCLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVELHNDQUFzQztJQUN0QyxJQUFJLFVBQVUsS0FBSywwQkFBa0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUMvQyxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCx3QkFBd0I7SUFDeEIsSUFBSSxLQUFLLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQyxPQUFPLEtBQUssS0FBSyxFQUFFLENBQUM7UUFDM0MsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsa0NBQWtDO0lBQ2xDLElBQUksWUFBWSxFQUFFLENBQUM7UUFDakIsMERBQTBEO1FBQzFELE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztRQUNwQyxJQUFJLEVBQUUsSUFBSSx1QkFBdUIsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUMzQyxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxzQ0FBc0M7UUFDdEMsSUFBSSx3QkFBd0IsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQy9ELE1BQU0sV0FBVyxHQUFHLE9BQU8sRUFBRSxhQUFhLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUM7WUFDdEUsSUFBSSxXQUFXLEdBQUcsQ0FBQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEdBQUcsV0FBVyxFQUFFLENBQUM7Z0JBQ3RELE9BQU8sS0FBSyxDQUFDLENBQUMsdUJBQXVCO1lBQ3ZDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELHNDQUFzQztJQUN0QyxJQUFJLENBQUMsWUFBWSxJQUFJLE9BQU8sRUFBRSxhQUFhLEtBQUssU0FBUyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDNUYsSUFBSSxLQUFLLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUM3QyxPQUFPLEtBQUssQ0FBQyxDQUFDLDhCQUE4QjtRQUM5QyxDQUFDO0lBQ0gsQ0FBQztJQUVELDBCQUEwQjtJQUMxQixpREFBaUQ7SUFDakQsbUZBQW1GO0lBRW5GLHFCQUFxQjtJQUNyQixPQUFPLElBQUksQ0FBQztBQUNkLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLFlBQVksQ0FDbkIsS0FBeUIsRUFDekIsR0FBd0I7SUFFeEIsTUFBTSxVQUFVLEdBQUcsSUFBQSwyQkFBYSxFQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM5QyxNQUFNLFlBQVksR0FBRyxlQUFlLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2pELE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUM7SUFFOUIsaURBQWlEO0lBQ2pELElBQUksT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQ25CLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxHQUFHLENBQUMsRUFBRSxVQUFVLEdBQUcsR0FBRyxFQUFFLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQztRQUVwRSx3QkFBd0I7UUFDeEIsSUFBSSxLQUFLLEdBQUcsWUFBWSxFQUFFLENBQUM7WUFDekIsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsb0NBQW9DO1FBQ3BDLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLFVBQVUsQ0FBQztJQUNwQyxDQUFDO0lBRUQsaURBQWlEO0lBQ2pELElBQUksR0FBRyxDQUFDLFFBQVEsRUFBRSxLQUFLLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3pELEtBQUssTUFBTSxJQUFJLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUN0QyxJQUFJLFdBQVcsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDN0IsT0FBTyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQztZQUNuQyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxpQ0FBaUM7SUFDakMsTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFFLFlBQVksQ0FBRSxDQUFDO0lBQy9DLElBQUksVUFBVSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUNsQyxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsR0FBRyxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztJQUNsRCxDQUFDO0lBRUQsbUNBQW1DO0lBQ25DLElBQUksS0FBSyxDQUFDLFNBQVMsSUFBSSxHQUFHLENBQUMsUUFBUSxFQUFFLFVBQVUsRUFBRSxDQUFDO1FBQ2hELEtBQUssTUFBTSxDQUFFLE9BQU8sRUFBRSxJQUFJLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUN4RSxNQUFNLEtBQUssR0FBRyx3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNoRCxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUM7Z0JBQ2hDLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQztZQUM5QixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCwwQ0FBMEM7SUFDMUMsTUFBTSxTQUFTLEdBQUcsSUFBQSwyQkFBYSxFQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzVDLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLENBQUUsU0FBUyxDQUFFLENBQUM7SUFDaEQsSUFBSSxJQUFJLEtBQUssU0FBUyxJQUFJLElBQUksSUFBSSxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUM7SUFDakQsSUFBSSxJQUFJLElBQUksQ0FBQztRQUFFLE9BQU8sS0FBSyxDQUFDO0lBRTVCLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQztBQUM5QixDQUFDO0FBRUQsU0FBUyx3QkFBd0IsQ0FBQyxPQUFlO0lBQy9DLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxDQUFDO0lBRWpDLElBQUksS0FBSyxHQUFHLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM1QyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDWCxzREFBc0Q7UUFDdEQsSUFBSSxrQkFBa0IsQ0FBQyxJQUFJLElBQUksb0JBQW9CLEVBQUUsQ0FBQztZQUNwRCxNQUFNLFFBQVEsR0FBRyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUM7WUFDeEQsSUFBSSxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQzNCLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUN0QyxDQUFDO1FBQ0gsQ0FBQztRQUVELEtBQUssR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN4RCxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3pDLENBQUM7SUFDRCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQXlCO0lBQ2pELGlEQUFpRDtJQUNqRCxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUM7UUFDMUIsT0FBTyxRQUFRLENBQUM7SUFDbEIsQ0FBQztJQUVELG9DQUFvQztJQUNwQyxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUMsT0FBTyxFQUFFLFFBQVEsSUFBSSxDQUFDLENBQUM7SUFFNUMsTUFBTSxLQUFLLEdBQUcsSUFBQSwyQkFBYSxFQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUV6QyxzQ0FBc0M7SUFDdEMsUUFBUSxJQUFJLEtBQUssR0FBRyxFQUFFLENBQUM7SUFFdkIsaUNBQWlDO0lBQ2pDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNuQyxRQUFRLElBQUksRUFBRSxDQUFDO0lBQ2pCLENBQUM7SUFFRCxzQ0FBc0M7SUFDdEMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTyxLQUFLLEtBQUssRUFBRSxDQUFDO1FBQzdELFFBQVEsSUFBSSxFQUFFLENBQUM7SUFDakIsQ0FBQztJQUVELDJDQUEyQztJQUMzQyxJQUFJLEtBQUssQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLFVBQVUsR0FBRyxJQUFJLEVBQUUsQ0FBQztRQUNoRCxRQUFRLElBQUksRUFBRSxDQUFDO0lBQ2pCLENBQUM7SUFFRCxPQUFPLFFBQVEsQ0FBQztBQUNsQixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FDMUIsTUFBNEIsRUFDNUIsT0FBdUM7SUFFdkMsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUM7UUFBRSxPQUFPLElBQUksQ0FBQztJQUVyQyxNQUFNLGVBQWUsR0FBRyxPQUFPLEVBQUUsZUFBZSxLQUFLLElBQUksQ0FBQztJQUUxRCx3QkFBd0I7SUFDeEIsdUZBQXVGO0lBQ3ZGLHVGQUF1RjtJQUN2RixFQUFFO0lBQ0YsMENBQTBDO0lBQzFDLDhIQUE4SDtJQUM5SCxrRUFBa0U7SUFDbEUsc0dBQXNHO0lBRXRHLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztJQUM3QyxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFnQyxDQUFDO0lBQ2pFLEtBQUssTUFBTSxDQUFDLElBQUksTUFBTSxFQUFFLENBQUM7UUFDdkIsTUFBTSxHQUFHLEdBQUcsQ0FBQyxDQUFDLHdCQUF3QixJQUFJLFNBQVMsQ0FBQztRQUNwRCxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxHQUFHLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzlDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUM1QixNQUFNLEdBQUcsR0FBRyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEMsSUFBSSxHQUFHO2dCQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7O2dCQUNoQixnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQztRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU0sTUFBTSxHQUFHLENBQUMsQ0FBcUIsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxZQUFZLENBQUM7SUFDdkYsTUFBTSxLQUFLLEdBQUcsQ0FBQyxDQUFxQixFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUM7SUFDOUQsTUFBTSxNQUFNLEdBQUcsQ0FBQyxDQUFxQixFQUFFLEVBQUU7UUFDdkMsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxFQUFFO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFDckIsT0FBTyxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNyQyxDQUFDLENBQUM7SUFFRixNQUFNLFVBQVUsR0FBRyxDQUFDLFVBQWdDLEVBQUUsRUFBRTtRQUN0RCxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNiLElBQUksTUFBTSxHQUFHLFFBQVEsQ0FBQztRQUN0QixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQzNDLE1BQU0sQ0FBQyxHQUFHLGdCQUFnQixDQUFDLFVBQVUsQ0FBRSxDQUFDLENBQUUsQ0FBQyxDQUFDO1lBQzVDLElBQUksQ0FBQyxHQUFHLE1BQU0sRUFBRSxDQUFDO2dCQUNmLE1BQU0sR0FBRyxDQUFDLENBQUM7Z0JBQ1gsR0FBRyxHQUFHLENBQUMsQ0FBQztZQUNWLENBQUM7UUFDSCxDQUFDO1FBQ0QsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDLENBQUM7SUFFRix3RkFBd0Y7SUFDeEYsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVsRCwwQkFBMEI7SUFDMUIsTUFBTSxhQUFhLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDeEQsSUFBSSxNQUFzQyxDQUFDO0lBQzNDLElBQUksYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM3QixNQUFNLEdBQUcsR0FBRyxVQUFVLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDdEMsTUFBTSxHQUFHLGFBQWEsQ0FBRSxHQUFHLENBQUUsQ0FBQztJQUNoQyxDQUFDO1NBQU0sQ0FBQztRQUNOLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyQiwwRkFBMEY7WUFDMUYsbUZBQW1GO1lBQ25GLGdEQUFnRDtZQUNoRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hCLHFFQUFxRTtnQkFDckUsTUFBTSxZQUFZLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRTtvQkFDdkMsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUNwQixJQUFJLENBQUMsRUFBRTt3QkFBRSxPQUFPLElBQUksQ0FBQyxDQUFDLHNCQUFzQjtvQkFDNUMsTUFBTSxJQUFJLEdBQUcsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUN0QyxJQUFJLENBQUMsSUFBSTt3QkFBRSxPQUFPLElBQUksQ0FBQyxDQUFDLHFCQUFxQjtvQkFDN0MsZ0NBQWdDO29CQUNoQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO2dCQUM1QyxDQUFDLENBQUMsQ0FBQztnQkFFSCxJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQzVCLE1BQU0sR0FBRyxHQUFHLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQztvQkFDckMsTUFBTSxHQUFHLFlBQVksQ0FBRSxHQUFHLENBQUUsQ0FBQztnQkFDL0IsQ0FBQztxQkFBTSxDQUFDO29CQUNOLG9GQUFvRjtvQkFDcEYsT0FBTyxJQUFJLENBQUM7Z0JBQ2QsQ0FBQztZQUNILENBQUM7aUJBQU0sQ0FBQztnQkFDTiw4RkFBOEY7Z0JBQzlGLE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztRQUNILENBQUM7YUFBTSxDQUFDO1lBQ04sdUNBQXVDO1lBQ3ZDLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2xELElBQUksU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDekIsTUFBTSxHQUFHLEdBQUcsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNsQyxNQUFNLEdBQUcsU0FBUyxDQUFFLEdBQUcsQ0FBRSxDQUFDO1lBQzVCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixzRkFBc0Y7Z0JBQ3RGLE1BQU0sR0FBRyxHQUFHLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDL0IsTUFBTSxHQUFHLE1BQU0sQ0FBRSxHQUFHLENBQUUsQ0FBQztZQUN6QixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLENBQUMsTUFBTTtRQUFFLE9BQU8sSUFBSSxDQUFDO0lBRXpCLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUMvQixJQUFJLFlBQVksR0FBRyxDQUFDLENBQUM7SUFFckIsd0VBQXdFO0lBQ3hFLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUFzQixDQUFDO0lBQy9DLE1BQU0sS0FBSyxHQUF5QixDQUFFLE1BQU0sQ0FBRSxDQUFDO0lBQy9DLE9BQU8sS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN4QixNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsS0FBSyxFQUFHLENBQUM7UUFDM0IsSUFBSSxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztZQUFFLFNBQVM7UUFDaEMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNsQixNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDekIsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNWLE1BQU0sSUFBSSxHQUFHLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN6QyxJQUFJLElBQUk7Z0JBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO1FBQ2hDLENBQUM7SUFDSCxDQUFDO0lBRUQseUJBQXlCO0lBQ3pCLEtBQUssSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1FBQzVDLElBQUksUUFBUSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUUsQ0FBQyxDQUFFLENBQUMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQ3BCLFlBQVksRUFBRSxDQUFDO1FBQ2pCLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTztRQUNMLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtRQUNqQixhQUFhLEVBQUUsTUFBTSxDQUFDLGFBQWE7UUFDbkMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTO1FBQzNCLEtBQUssRUFBRSxNQUFNLENBQUMsS0FBSztRQUNuQixZQUFZO0tBQ2IsQ0FBQztBQUNKLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLDJCQUEyQixDQUNsQyxLQUF5QixFQUN6QixPQUE2QztJQUU3QyxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUM7SUFDbkIsSUFBSSxDQUFDLEdBQUc7UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUN4QixNQUFNLHFCQUFxQixHQUFHLEdBQUcsQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDO0lBQ3pELE1BQU0sdUJBQXVCLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDO0lBQ3RELElBQUksQ0FBQyxDQUFDLHVCQUF1QixJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3JFLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFhLEVBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLDBCQUFrQixDQUFDLEtBQUssQ0FBQztJQUV2RSxzREFBc0Q7SUFDdEQsSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUNaLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxhQUFhLENBQUM7UUFDdkMsSUFBSSxRQUFRLENBQUMsTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUMvQixNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO1lBQy9CLFFBQVEsQ0FBQyxNQUFNLEdBQUcsRUFBRSxDQUFDO1lBRXJCLE1BQU0sT0FBTyxHQUFHLElBQUEscUNBQW1CLEVBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUNoRSxNQUFNLGNBQWMsR0FBRyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFM0QscUVBQXFFO1lBQ3JFLEtBQUssTUFBTSxhQUFhLElBQUksY0FBYyxFQUFFLENBQUM7Z0JBQzNDLE1BQU0sT0FBTyxHQUFHLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDdkQsa0JBQWtCLENBQUMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQzdDLENBQUM7UUFDSCxDQUFDO1FBRUQsUUFBUSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUM7UUFDOUIsTUFBTSxjQUFjLEdBQUcsa0JBQWtCLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3RELGtCQUFrQixDQUFDLEtBQUssRUFBRSxjQUFjLENBQUMsQ0FBQztRQUMxQyxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBRTVCLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUM7SUFFRCx1Q0FBdUM7SUFDdkMsSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sY0FBYyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN0RCxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDMUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFFekMsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQztJQUVELDJFQUEyRTtJQUMzRSxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDO0lBQ3ZDLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7SUFFL0Isd0RBQXdEO0lBQ3hELE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxRQUFRLEVBQUUsYUFBYSxJQUFJLElBQUksQ0FBQztJQUNwRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7UUFDN0IsYUFBYTtRQUNiLGtHQUFrRztRQUNsRyxzR0FBc0c7UUFDdEcsNkZBQTZGO1FBQzdGLE1BQU0sV0FBVyxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxFQUFFLGVBQWUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQzVFLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUM3QixDQUFDO2FBQU0sQ0FBQztZQUNOLG1GQUFtRjtZQUNuRixNQUFNLE9BQU8sR0FBRyxPQUFPLEdBQUcsQ0FBQyxDQUFDO1lBQzVCLElBQUksTUFBTSxDQUFDLE1BQU0sSUFBSSxPQUFPLEVBQUUsQ0FBQztnQkFDN0IsTUFBTSxlQUFlLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQy9FLElBQUksZUFBZSxFQUFFLENBQUM7b0JBQ3BCLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQzdCLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELHlDQUF5QztRQUN6QyxJQUFJLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTyxLQUFLLENBQUMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxHQUFHLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDM0UsTUFBTSxDQUFDLElBQUksQ0FBQyw0REFBNEQsRUFBRTtnQkFDeEUsT0FBTyxFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTztnQkFDakMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxNQUFNO2dCQUN6QixhQUFhLEVBQUUsT0FBTyxDQUFDLGFBQWE7Z0JBQ3BDLFlBQVksRUFBRSxXQUFXO2FBQzFCLENBQUMsQ0FBQztRQUNMLENBQUM7YUFBTSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ3ZCLHVEQUF1RDtZQUN2RCxNQUFNLENBQUMsS0FBSyxDQUFDLHlDQUF5QyxFQUFFO2dCQUN0RCxHQUFHLFdBQVc7Z0JBQ2QsWUFBWSxFQUFFLFFBQVEsQ0FBQyxPQUFPLENBQUMsT0FBTzthQUN2QyxDQUFDLENBQUM7UUFDTCxDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbkIsUUFBUSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztJQUM1QixPQUFPLFVBQVUsQ0FBQztBQUNwQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUsNEJBQTRCLENBQ3pDLEtBQXlCLEVBQ3pCLE9BQTZDO0lBRTdDLE1BQU0sR0FBRyxHQUFHLE1BQU0sQ0FBQztJQUNuQixJQUFJLENBQUMsR0FBRztRQUFFLE9BQU8sTUFBTSxDQUFDO0lBQ3hCLE1BQU0scUJBQXFCLEdBQUcsR0FBRyxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUM7SUFDekQsTUFBTSx1QkFBdUIsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUM7SUFDdEQsSUFBSSxDQUFDLENBQUMsdUJBQXVCLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDckUsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWEsRUFBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksMEJBQWtCLENBQUMsS0FBSyxDQUFDO0lBRXZFLHNEQUFzRDtJQUN0RCxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBQ1osTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQztRQUN2QyxJQUFJLFFBQVEsQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFDL0IsUUFBUSxDQUFDLE1BQU0sR0FBRyxFQUFFLENBQUM7WUFFckIsTUFBTSxPQUFPLEdBQUcsSUFBQSxxQ0FBbUIsRUFBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ2hFLE1BQU0sY0FBYyxHQUFHLG1CQUFtQixDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUUzRCxxRUFBcUU7WUFDckUsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLEVBQUU7Z0JBQ25ELE1BQU0sT0FBTyxHQUFHLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDdkQsT0FBTyxzQkFBc0IsQ0FBQyxhQUFhLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDeEQsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNOLENBQUM7UUFFRCxRQUFRLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQztRQUM5QixNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEQsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDcEQsUUFBUSxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUU1QixPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDO0lBRUQsdUNBQXVDO0lBQ3ZDLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN4QyxNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEQsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFDcEQsT0FBTyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7UUFFekMsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQztJQUVELGlDQUFpQztJQUNqQyxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDO0lBQ3ZDLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUM7SUFFL0Isd0RBQXdEO0lBQ3hELE1BQU0sT0FBTyxHQUFHLEdBQUcsQ0FBQyxRQUFRLEVBQUUsYUFBYSxJQUFJLElBQUksQ0FBQztJQUNwRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7UUFDN0IsTUFBTSxXQUFXLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLEVBQUUsZUFBZSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7UUFDNUUsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzdCLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxPQUFPLEdBQUcsT0FBTyxHQUFHLENBQUMsQ0FBQztZQUM1QixJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQzdCLE1BQU0sZUFBZSxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUMvRSxJQUFJLGVBQWUsRUFBRSxDQUFDO29CQUNwQixRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUM3QixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxnQ0FBZ0M7UUFDaEMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sS0FBSyxDQUFDLElBQUksUUFBUSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzNFLE1BQU0sQ0FBQyxJQUFJLENBQUMsNERBQTRELEVBQUU7Z0JBQ3hFLE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU87Z0JBQ2pDLFVBQVUsRUFBRSxNQUFNLENBQUMsTUFBTTtnQkFDekIsYUFBYSxFQUFFLE9BQU8sQ0FBQyxhQUFhO2FBQ3JDLENBQUMsQ0FBQztRQUNMLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNuQixRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQzVCLE9BQU8sVUFBVSxDQUFDO0FBQ3BCLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLDBCQUEwQixDQUFDLEdBQXdCO0lBQzFELElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzNCLE1BQU0sQ0FBQyxLQUFLLENBQUMsdUNBQXVDLENBQUMsQ0FBQztRQUN0RCxPQUFPO0lBQ1QsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsMENBQTBDLENBQUMsQ0FBQztRQUN6RCxpREFBaUQ7UUFDakQsT0FBTyxDQUFDLDZCQUE2QixDQUFDLENBQUM7UUFDdkMsTUFBTSxDQUFDLEtBQUssQ0FBQywrRUFBK0UsQ0FBQyxDQUFDO0lBQ2hHLENBQUM7SUFBQyxPQUFPLEtBQWMsRUFBRSxDQUFDO1FBQ3hCLHVFQUF1RTtRQUN2RSxJQUFJLEtBQUssSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxJQUFJLEtBQUssSUFBSyxLQUE0QixDQUFDLElBQUksS0FBSyxrQkFBa0IsRUFBRSxDQUFDO1lBQ3ZILE1BQU0sQ0FBQyxJQUFJLENBQ1QsZ0hBQWdILENBQ2pILENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sR0FBRyxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuRSxNQUFNLENBQUMsSUFBSSxDQUFDLG9DQUFvQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3pELENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyw0QkFBNEIsQ0FBQyxHQUF3QjtJQUM1RCxRQUFRLEdBQUcsRUFBRSxDQUFDO0lBQ2QsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDO0lBQ3ZCLE1BQU0sZUFBZSxHQUFHLEdBQUcsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxLQUFLLENBQUMsQ0FBQztJQUV0RSxLQUFLLE1BQU0sVUFBVSxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQ3pDLElBQUksQ0FBQztZQUNILE1BQU0sT0FBTyxHQUFHLGdCQUFXLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FDdEMsc0JBQXNCLEVBQ3RCLEVBQUUsSUFBSSxFQUFFLENBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxVQUFVLENBQUMsSUFBSSxDQUFFLEVBQUUsQ0FDMUQsQ0FBQztZQUNGLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDdkIsY0FBYyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQzdDLE9BQU8sQ0FBQyx5QkFBeUIsRUFBRSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQ2hELE1BQU0sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxLQUFLLFlBQVksNkJBQW9CLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLFVBQVUsQ0FBQyxJQUFJLDZCQUE2QixDQUFDLENBQUM7WUFDeEUsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLFVBQVUsQ0FBQyxJQUFJLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztZQUM1RSxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDMUIsc0RBQXNEO1FBQ3RELHNGQUFzRjtRQUN0RixNQUFNLENBQUMsS0FBSyxDQUFDLHVJQUF1SSxFQUFFO1lBQ3BKLG1CQUFtQixFQUFFLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1NBQ3RELENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCwrRUFBK0U7SUFDL0UsZ0ZBQWdGO0lBQ2hGLDhFQUE4RTtJQUM5RSxNQUFNLEtBQUssR0FBd0IsRUFBRSxDQUFDO0lBQ3RDLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDL0IsSUFBSSxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDdEIsQ0FBQztJQUNILENBQUM7SUFDRCxJQUFBLHFDQUFxQixFQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzdCLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNyQixNQUFNLENBQUMsS0FBSyxDQUFDLGNBQWMsS0FBSyxDQUFDLE1BQU0seUJBQXlCLENBQUMsQ0FBQztJQUNwRSxDQUFDO0FBQ0gsQ0FBQztBQUVELHdFQUF3RTtBQUN4RSxTQUFTLG1CQUFtQixDQUFDLE9BQTZCO0lBQ3hELE1BQU0sU0FBUyxHQUFHLE9BQTZDLENBQUM7SUFDaEUsT0FBTyxPQUFPLFNBQVMsQ0FBQyxXQUFXLEtBQUssVUFBVTtXQUM3QyxPQUFPLFNBQVMsQ0FBQyxTQUFTLEtBQUssVUFBVSxDQUFDO0FBQ2pELENBQUM7QUFFRCxTQUFTLFlBQVk7SUFDbkIsSUFBSSxDQUFDO1FBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO1FBRTNELDJEQUEyRDtRQUMzRCxJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDNUIsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLFlBQVksQ0FBQyxNQUFNLGdDQUFnQyxDQUFDLENBQUM7WUFDN0UsS0FBSyxNQUFNLElBQUksSUFBSSxZQUFZLEVBQUUsQ0FBQztnQkFDaEMsSUFBSSxDQUFDO29CQUNILElBQUksRUFBRSxDQUFDO2dCQUNULENBQUM7Z0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztvQkFDZixNQUFNLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxFQUFFLEtBQUssQ0FBQyxDQUFDO29CQUN2RCxNQUFNLEtBQUssQ0FBQztnQkFDZCxDQUFDO1lBQ0gsQ0FBQztZQUNELE1BQU0sQ0FBQyxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQztRQUNyRCxDQUFDO1FBRUQseUZBQXlGO1FBQ3pGLGtHQUFrRztRQUNsRyxNQUFNLEtBQUssR0FBRyxnQkFBVyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQTJCLGVBQWUsQ0FBQyxDQUFDO1FBQ3hGLE1BQU0sR0FBRyxJQUFBLGtDQUF5QixFQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzFDLElBQUEsNkNBQTZCLEVBQUMsTUFBTSxDQUFDLENBQUM7UUFDdEMsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsRUFBRTtZQUNsRCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU87WUFDdkIsV0FBVyxFQUFFLE1BQU0sQ0FBQyxXQUFXO1lBQy9CLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7WUFDM0MsUUFBUSxFQUFFLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFLEtBQUssRUFBRTtZQUM5RSxTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVMsRUFBRSxPQUFPO1NBQ3JDLENBQUMsQ0FBQztRQUVILHFFQUFxRTtRQUNyRSwwQkFBMEIsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUVuQyw4QkFBOEI7UUFDOUIsNEJBQTRCLENBQUMsTUFBTyxDQUFDLENBQUM7UUFFdEMsa0NBQWtDO1FBQ2xDLElBQUEseUJBQWtCLEVBQUM7WUFDakIsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ3ZELFlBQVksRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQztTQUNsRSxDQUFDLENBQUM7UUFFSCxXQUFXLEdBQUcsSUFBSSxDQUFDO1FBQ25CLE1BQU0sQ0FBQyxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztJQUNoRSxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsNkNBQTZDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbkUsaURBQWlEO1FBQ2pELDZHQUE2RztRQUM3RyxXQUFXLEdBQUcsSUFBSSxDQUFDO1FBQ25CLE1BQU0sR0FBRyxJQUFJLENBQUM7UUFDZCxJQUFBLDZDQUE2QixFQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3BDLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDZCxjQUFjLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDekIsQ0FBQztBQUNILENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsb0NBQW9DO0FBQ3BDLDhFQUE4RTtBQUU5RSxNQUFhLG9CQUFvQjtJQUUvQixnQkFBd0IsQ0FBQztJQUV6Qjs7T0FFRztJQUNILE1BQU0sQ0FBQyxvQkFBb0I7UUFDekIsTUFBTSxDQUFDLEtBQUssQ0FBQyxvREFBb0QsRUFBRSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsQ0FBQyxDQUFDO1FBRXJHLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqQixNQUFNLENBQUMsS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7WUFDL0QsWUFBWSxFQUFFLENBQUM7UUFDakIsQ0FBQztRQUVELGVBQWUsRUFBRSxDQUFDO1FBQ2xCLE1BQU0sQ0FBQyxLQUFLLENBQUMsY0FBYyxlQUFlLDJCQUEyQixRQUFRLENBQUMsTUFBTSxhQUFhLENBQUMsQ0FBQztRQUVuRyxLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDO1lBQy9CLElBQUksQ0FBQztnQkFDSCxPQUFPLENBQUMsb0JBQW9CLEVBQUUsRUFBRSxDQUFDO1lBQ25DLENBQUM7WUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO2dCQUNmLE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxPQUFPLENBQUMsSUFBSSxtQ0FBbUMsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNsRixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxNQUFNLENBQUMsYUFBYTtRQUNsQixPQUFPLFdBQVcsQ0FBQztJQUNyQixDQUFDO0lBRUQsTUFBTSxDQUFDLFdBQVc7UUFDaEIsT0FBTyxlQUFlLEtBQUssQ0FBQyxDQUFDO0lBQy9CLENBQUM7SUFFRCxNQUFNLENBQUMsa0JBQWtCO1FBQ3ZCLE9BQU8sZUFBZSxDQUFDO0lBQ3pCLENBQUM7SUFFRCxNQUFNLENBQUMsU0FBUztRQUNkLE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLFVBQVU7UUFDZixNQUFNLE9BQU8sR0FBRyxJQUFBLDJCQUFpQixHQUFFLENBQUM7UUFDcEMsT0FBTyxPQUFPLEVBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQztJQUN4QyxDQUFDO0lBRUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFxQztRQUNwRCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUM7UUFDMUQsQ0FBQztRQUNELE1BQU0sR0FBRyxFQUFFLEdBQUcsTUFBTSxFQUFFLEdBQUcsT0FBTyxFQUFFLENBQUM7SUFDckMsQ0FBQztJQUVELE1BQU0sQ0FBQyxlQUFlLENBQUMsT0FBNkI7UUFDbEQsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xELE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxPQUFPLENBQUMsSUFBSSxxQkFBcUIsQ0FBQyxDQUFDO1lBQzFELE9BQU87UUFDVCxDQUFDO1FBQ0QsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN6QixDQUFDO0lBRUQsTUFBTSxDQUFDLGlCQUFpQixDQUFDLElBQVk7UUFDbkMsUUFBUSxHQUFHLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxJQUFnQjtRQUN6QyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzFCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFtQjtRQUNoQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsTUFBTSxDQUFDLElBQUksQ0FBQyxtREFBbUQsRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUMzRyxPQUFPLFNBQVMsQ0FBQztRQUNuQixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0gsMkRBQTJEO1lBQzNELGtFQUFrRTtZQUNsRSw4Q0FBOEM7WUFDOUMsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFlBQVksSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFVBQVUsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFlBQVksRUFBRSxDQUFDO2dCQUM1RixNQUFNLENBQUMsS0FBSyxDQUFDLHNFQUFzRSxFQUFFO29CQUNuRixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7b0JBQ2hCLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztvQkFDMUIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLENBQUMsNkJBQTZCO2lCQUN4RyxDQUFDLENBQUM7Z0JBQ0gsT0FBTyxTQUFTLENBQUM7WUFDbkIsQ0FBQztZQUVELE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNwQyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RCLE1BQU0sQ0FBQyxJQUFJLENBQUMsd0JBQXdCLEVBQUUsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUNwRSxPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBRUQsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQztnQkFDckIsTUFBTSxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztnQkFDL0UsT0FBTyxTQUFTLENBQUM7WUFDbkIsQ0FBQztZQUVELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztZQUNwQyxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRXpDLGdDQUFnQztZQUNoQyxNQUFNLFVBQVUsR0FBRywyQkFBMkIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDL0QsSUFBSSxVQUFVLEtBQUssVUFBVSxFQUFFLENBQUM7Z0JBQzlCLE9BQU8sS0FBSyxDQUFDLGtCQUFrQixDQUFDO1lBQ2xDLENBQUM7WUFDRCxJQUFJLFVBQVUsS0FBSyxVQUFVLEVBQUUsQ0FBQztnQkFDOUIsT0FBTyxTQUFTLENBQUM7WUFDbkIsQ0FBQztZQUVELGtDQUFrQztZQUNsQyxzQ0FBc0M7WUFDdEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFO2dCQUMvQiw2RUFBNkU7Z0JBQzdFLDhFQUE4RTtnQkFDOUUsd0JBQXdCLEVBQUUsS0FBSzthQUNoQyxDQUFDLEVBQUUsQ0FBQztnQkFDSCxPQUFPLFNBQVMsQ0FBQyxDQUFDLGVBQWU7WUFDbkMsQ0FBQztZQUVELDRDQUE0QztZQUM1QyxJQUFJLE1BQU0sQ0FBQyxRQUFRLEVBQUUsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUM3RCxPQUFPLFNBQVMsQ0FBQyxDQUFDLGNBQWM7WUFDbEMsQ0FBQztZQUVELE1BQU0sY0FBYyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUN0RCxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7WUFDMUMsT0FBTyxLQUFLLENBQUMsa0JBQWtCLENBQUM7UUFDbEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLENBQUMsS0FBSyxDQUFDLDhCQUE4QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3BELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxLQUFtQjtRQUMzQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDakIsTUFBTSxDQUFDLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO1lBQ2hFLE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCwyREFBMkQ7WUFDM0Qsa0VBQWtFO1lBQ2xFLDhDQUE4QztZQUM5QyxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssVUFBVSxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssWUFBWSxFQUFFLENBQUM7Z0JBQzVGLE1BQU0sQ0FBQyxLQUFLLENBQUMsc0VBQXNFLEVBQUU7b0JBQ25GLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtvQkFDaEIsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO29CQUMxQixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksS0FBSyxZQUFZLENBQUMsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLENBQUMsQ0FBQyw2QkFBNkI7aUJBQ3hHLENBQUMsQ0FBQztnQkFDSCxPQUFPLFNBQVMsQ0FBQztZQUNuQixDQUFDO1lBRUQsTUFBTSxNQUFNLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3BDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDdEIsTUFBTSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBQ3BFLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFFRCxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQU87Z0JBQUUsT0FBTyxTQUFTLENBQUM7WUFFdkMsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO1lBQ3BDLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFekMsZ0NBQWdDO1lBQ2hDLE1BQU0sVUFBVSxHQUFHLE1BQU0sNEJBQTRCLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ3RFLElBQUksVUFBVSxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUM5QixPQUFPLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQztZQUNsQyxDQUFDO1lBQ0QsSUFBSSxVQUFVLEtBQUssVUFBVSxFQUFFLENBQUM7Z0JBQzlCLE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFFRCxrQ0FBa0M7WUFDbEMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFO2dCQUMvQix3QkFBd0IsRUFBRSxLQUFLO2FBQ2hDLENBQUMsRUFBRSxDQUFDO2dCQUNILE9BQU8sU0FBUyxDQUFDLENBQUMsZUFBZTtZQUNuQyxDQUFDO1lBRUQsSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFLE9BQU8sSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQztnQkFDN0QsT0FBTyxTQUFTLENBQUMsQ0FBQyxjQUFjO1lBQ2xDLENBQUM7WUFFRCxNQUFNLGNBQWMsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDdEQsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7WUFDcEQsT0FBTyxLQUFLLENBQUMsa0JBQWtCLENBQUM7UUFDbEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3pELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsT0FBTyxDQUNaLEtBQTRGO1FBRTVGLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLElBQUksSUFBQSxrQ0FBd0IsR0FBRSxDQUFDO1FBRXhFLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixNQUFNLENBQUMsSUFBSSxDQUFDLHdDQUF3QyxDQUFDLENBQUM7WUFDdEQsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztRQUVELE9BQU8sb0JBQW9CLENBQUMsT0FBTyxDQUFDO1lBQ2xDLEdBQUcsS0FBSztZQUNSLGFBQWE7WUFDYixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQThCO1lBQzFDLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBZ0M7U0FDOUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLO1FBQ2hCLE1BQU0sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUU7WUFDbEMsaUJBQWlCLEVBQUUsaUJBQWlCLENBQUMsTUFBTTtZQUMzQyxRQUFRLEVBQUUsUUFBUSxDQUFDLE1BQU07WUFDekIsYUFBYSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsS0FBSztTQUN2QyxDQUFDLENBQUM7UUFFSCxpRkFBaUY7UUFDakYsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDakMsTUFBTSxDQUFDLEtBQUssQ0FBQyxlQUFlLGlCQUFpQixDQUFDLE1BQU0scUJBQXFCLENBQUMsQ0FBQztZQUMzRSxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUNyQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsNEJBQTRCO1lBQzFELE1BQU0sQ0FBQyxLQUFLLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUMvQyxDQUFDO1FBRUQsb0ZBQW9GO1FBQ3BGLG1HQUFtRztRQUNuRyxJQUFBLGdDQUFnQixHQUFFLENBQUM7UUFFbkIsd0VBQXdFO1FBQ3hFLE1BQU0sT0FBTyxHQUFHLG9CQUFvQixDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ2xELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztRQUNwQyxNQUFNLFdBQVcsR0FBRyxPQUFPLEVBQUUsYUFBYSxDQUFDLFdBQVcsQ0FBQztRQUN2RCxJQUFJLE9BQU8sSUFBSSxXQUFXLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsUUFBUSxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsT0FBTyxHQUFHLENBQUMsSUFBSSxPQUFPLENBQUMsVUFBVSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDOUgsMEJBQTBCO1lBQzFCLFdBQVcsRUFBRSxPQUFPLEVBQUUsQ0FBQztnQkFDckIsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLFFBQVE7Z0JBQ3RDLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxRQUFRO2dCQUN0QyxtQkFBbUIsRUFBRSxPQUFPLENBQUMsT0FBTztnQkFDcEMsc0JBQXNCLEVBQUUsT0FBTyxDQUFDLFVBQVU7YUFDM0MsQ0FBQyxDQUFDO1lBRUgsb0NBQW9DO1lBQ3BDLE1BQU0sYUFBYSxHQUE0QjtnQkFDN0MsTUFBTSxFQUFFO29CQUNOLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtvQkFDMUIsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO29CQUMxQixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87b0JBQ3hCLFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVTtpQkFDL0I7YUFDRixDQUFDO1lBRUYsNERBQTREO1lBQzVELE1BQU0sUUFBUSxHQUFHLE9BQU8sRUFBRSxhQUFhLENBQUM7WUFDeEMsSUFBSSxRQUFRLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztnQkFDaEMsYUFBYSxDQUFDLGlCQUFpQixHQUFHO29CQUNoQyxNQUFNLEVBQUUsUUFBUSxDQUFDLGlCQUFpQixDQUFDLE1BQU07b0JBQ3pDLFdBQVcsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUM7d0JBQy9FLENBQUMsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsV0FBVzt3QkFDeEMsQ0FBQyxDQUFDLFNBQVM7b0JBQ2IsT0FBTyxFQUFFLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPO2lCQUM1QyxDQUFDO1lBQ0osQ0FBQztZQUVELDhFQUE4RTtZQUM5RSxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZELE1BQU0sTUFBTSxHQUEyQixFQUFFLENBQUM7Z0JBQzFDLE1BQU0sV0FBVyxHQUEyQixFQUFFLENBQUM7Z0JBQy9DLE1BQU0sT0FBTyxHQUEyQixFQUFFLENBQUM7Z0JBRTNDLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDakQsTUFBTSxDQUFFLEtBQUssQ0FBQyxJQUFJLENBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBRSxLQUFLLENBQUMsSUFBSSxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUN2RCxJQUFJLEtBQUssQ0FBQyxTQUFTLEVBQUUsQ0FBQzt3QkFDcEIsV0FBVyxDQUFFLEtBQUssQ0FBQyxTQUFTLENBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBRSxLQUFLLENBQUMsU0FBUyxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUM3RSxDQUFDO29CQUNELE9BQU8sQ0FBRSxLQUFLLENBQUMsS0FBSyxDQUFFLEdBQUcsQ0FBQyxPQUFPLENBQUUsS0FBSyxDQUFDLEtBQUssQ0FBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDN0QsQ0FBQztnQkFFRCxhQUFhLENBQUMsaUJBQWlCLEdBQUc7b0JBQ2hDLE1BQU07b0JBQ04sV0FBVyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxTQUFTO29CQUMxRSxPQUFPO2lCQUNSLENBQUM7WUFDSixDQUFDO1lBRUQscUNBQXFDO1lBQ3JDLFdBQVcsRUFBRSxVQUFVLEVBQUUsQ0FBQyxnQ0FBZ0MsRUFBRSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZGLENBQUM7UUFFRCxzRkFBc0Y7UUFDdEYsSUFBSSxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUssSUFBSSxNQUFNLEVBQUUsY0FBYyxFQUFFLE9BQU8sRUFBRSxDQUFDO1lBQy9ELE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztZQUVwQyxJQUFJLE9BQU8sSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsQ0FBQztnQkFDL0YseUZBQXlGO2dCQUN6RixNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDO2dCQUN2QyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDO2dCQUMvQixRQUFRLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQyxDQUFDLGVBQWU7Z0JBRXJDLHNGQUFzRjtnQkFDdEYsdUZBQXVGO2dCQUN2RixNQUFNLHVCQUF1QixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7Z0JBQ2xELEtBQUssTUFBTSxDQUFDLElBQUksTUFBTSxFQUFFLENBQUM7b0JBQ3ZCLE1BQU0sR0FBRyxHQUFHLENBQUMsQ0FBQyx3QkFBd0IsSUFBSSxTQUFTLENBQUM7b0JBQ3BELElBQUksR0FBRzt3QkFBRSx1QkFBdUIsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQzVDLENBQUM7Z0JBRUQsTUFBTSxPQUFPLEdBQUcsSUFBQSxxQ0FBbUIsRUFBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO2dCQUNuRSxNQUFNLGFBQWEsR0FBRyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBRTFELHlDQUF5QztnQkFDekMsOEZBQThGO2dCQUM5RixNQUFNLHVCQUF1QixHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsU0FBUztvQkFDcEQsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTt3QkFDM0IsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU07NEJBQUUsT0FBTyxJQUFJLENBQUM7d0JBQ25DLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQzt3QkFDaEMsSUFBSSxDQUFDLEVBQUU7NEJBQUUsT0FBTyxJQUFJLENBQUM7d0JBQ3JCLElBQUksdUJBQXVCLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQzs0QkFBRSxPQUFPLElBQUksQ0FBQyxDQUFDLGlCQUFpQjt3QkFDbkUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQTJDLENBQUM7d0JBQ3hELE1BQU0sRUFBRSxHQUFHLENBQUMsRUFBRSxLQUE0QyxDQUFDO3dCQUMzRCxPQUFPLEVBQUUsRUFBRSxTQUFTLEtBQUssSUFBSSxDQUFDO29CQUNoQyxDQUFDLENBQUM7b0JBQ0YsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFFbEIsK0VBQStFO2dCQUMvRSxNQUFNLFFBQVEsR0FBRyx1QkFBdUIsQ0FBQyxJQUFJLENBQzNDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQ3RELENBQUM7Z0JBQ0YsSUFBSSxRQUFRLEVBQUUsQ0FBQztvQkFDYixNQUFNLGFBQWEsR0FBMkIsRUFBRSxDQUFDO29CQUNqRCxNQUFNLGNBQWMsR0FBMkIsRUFBRSxDQUFDO29CQUNsRCxJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUM7b0JBQ25CLEtBQUssTUFBTSxDQUFDLElBQUksdUJBQXVCLEVBQUUsQ0FBQzt3QkFDeEMsYUFBYSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3dCQUN6RCxjQUFjLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7d0JBQzdELElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyxPQUFPLElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyxVQUFVOzRCQUFFLFVBQVUsRUFBRSxDQUFDO29CQUNsRSxDQUFDO29CQUNELFFBQVEsQ0FBQyxJQUFJLEdBQUc7d0JBQ2QsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO3dCQUN4QixrQkFBa0IsRUFBRTs0QkFDbEIsV0FBVyxFQUFFLHVCQUF1QixDQUFDLE1BQU07NEJBQzNDLE1BQU0sRUFBRSxhQUFhOzRCQUNyQixPQUFPLEVBQUUsY0FBYzs0QkFDdkIsU0FBUyxFQUFFLFVBQVUsR0FBRyxDQUFDOzRCQUN6QixVQUFVOzRCQUNWLGNBQWMsRUFBRSxPQUFPLENBQUMsS0FBSzt5QkFDOUI7cUJBQ0YsQ0FBQztnQkFDSixDQUFDO2dCQUVELDZDQUE2QztnQkFDN0MsTUFBTSxjQUFjLEdBQTJCLEVBQUUsQ0FBQztnQkFDbEQsTUFBTSxtQkFBbUIsR0FBMkIsRUFBRSxDQUFDO2dCQUN2RCxNQUFNLGVBQWUsR0FBMkIsRUFBRSxDQUFDO2dCQUVuRCxLQUFLLE1BQU0sS0FBSyxJQUFJLHVCQUF1QixFQUFFLENBQUM7b0JBQzVDLDBEQUEwRDtvQkFFMUQsc0RBQXNEO29CQUN0RCxNQUFNLFlBQVksR0FBRyxZQUFZLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRTt3QkFDL0Msd0JBQXdCLEVBQUUsSUFBSTt3QkFDOUIsdUJBQXVCO3FCQUN4QixDQUFDLENBQUM7b0JBQ0gsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO3dCQUNsQiw0Q0FBNEM7d0JBQzVDLFNBQVM7b0JBQ1gsQ0FBQztvQkFFRCw0Q0FBNEM7b0JBQzVDLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRSxPQUFPLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUM7d0JBQzdELFFBQVEsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUM7d0JBQzlCLFNBQVM7b0JBQ1gsQ0FBQztvQkFFRCxrQ0FBa0M7b0JBQ2xDLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDbkUsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7d0JBQ3BCLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ3pGLENBQUM7b0JBQ0QsZUFBZSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUN2RSxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxDQUFDO29CQUU1Qiw0Q0FBNEM7b0JBQzVDLE1BQU0sT0FBTyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztvQkFDL0MsTUFBTSxzQkFBc0IsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQy9DLENBQUM7Z0JBRUQsOERBQThEO2dCQUM5RCxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixFQUFFLENBQUM7b0JBQ2hDLFFBQVEsQ0FBQyxpQkFBaUIsR0FBRyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsV0FBVyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLENBQUM7Z0JBQzVFLENBQUM7Z0JBQ0QsS0FBSyxNQUFNLENBQUUsSUFBSSxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztvQkFDN0QsUUFBUSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBRSxJQUFJLENBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUUsSUFBSSxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDO2dCQUN2RyxDQUFDO2dCQUNELEtBQUssTUFBTSxDQUFFLEVBQUUsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztvQkFDaEUsUUFBUSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsQ0FBRSxFQUFFLENBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUUsRUFBRSxDQUFFLElBQUksQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDO2dCQUM3RyxDQUFDO2dCQUNELEtBQUssTUFBTSxDQUFFLEtBQUssRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7b0JBQy9ELFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxPQUFPLENBQUUsS0FBSyxDQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFFLEtBQUssQ0FBRSxJQUFJLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQztnQkFDM0csQ0FBQztZQUNILENBQUM7WUFDRCxtRUFBbUU7UUFDckUsQ0FBQztRQUVELHNDQUFzQztRQUN0QywrRUFBK0U7UUFDL0UscUNBQXFDO1FBQ3JDLE1BQU0saUJBQWlCLEdBQUcsQ0FBQyxDQUFDO1FBQzVCLE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxFQUFFO1lBQ25ELElBQUksQ0FBQztnQkFDSCxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO29CQUNuQixPQUFPO2dCQUNULENBQUM7Z0JBRUQsS0FBSyxJQUFJLE9BQU8sR0FBRyxDQUFDLEVBQUUsT0FBTyxJQUFJLGlCQUFpQixFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUM7b0JBQzlELElBQUksQ0FBQzt3QkFDSCxNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQzt3QkFDdEIsTUFBTSxDQUFDLFVBQVU7b0JBQ25CLENBQUM7b0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQzt3QkFDZixJQUFJLE9BQU8sS0FBSyxpQkFBaUIsRUFBRSxDQUFDOzRCQUNsQyxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsT0FBTyxDQUFDLElBQUksdUJBQXVCLE9BQU8sWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDOzRCQUN2Riw4Q0FBOEM7NEJBQzlDLDhDQUE4Qzt3QkFDaEQsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE1BQU0sQ0FBQyxJQUFJLENBQUMsV0FBVyxPQUFPLENBQUMsSUFBSSwwQkFBMEIsT0FBTyxJQUFJLGlCQUFpQixnQkFBZ0IsRUFBRSxLQUFLLENBQUMsQ0FBQzs0QkFDbEgsNkJBQTZCOzRCQUM3QixNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQzt3QkFDbkUsQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUM7WUFDSCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixxREFBcUQ7Z0JBQ3JELE1BQU0sQ0FBQyxLQUFLLENBQUMsV0FBVyxPQUFPLENBQUMsSUFBSSwyQkFBMkIsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDeEUsOENBQThDO1lBQ2hELENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUVqQyxNQUFNLENBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7SUFDekMsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEtBQUs7UUFDVixNQUFNLEdBQUcsSUFBSSxDQUFDO1FBQ2QsSUFBQSw2Q0FBNkIsRUFBQyxJQUFJLENBQUMsQ0FBQztRQUNwQyxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBQ2QsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3ZCLGVBQWUsR0FBRyxDQUFDLENBQUM7UUFDcEIsV0FBVyxHQUFHLEtBQUssQ0FBQztRQUNwQixrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMzQixpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBQzdCLElBQUEsb0JBQWEsR0FBRSxDQUFDO0lBQ2xCLENBQUM7SUFFRDs7T0FFRztJQUNILE1BQU0sQ0FBQyxvQkFBb0IsQ0FDekIsVUFBK0IsRUFDL0IsZUFBdUMsRUFBRTtRQUV6QyxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUM3QixNQUFNLEdBQUcsVUFBVSxDQUFDO1FBQ3BCLElBQUEsNkNBQTZCLEVBQUMsVUFBVSxDQUFDLENBQUM7UUFDMUMsUUFBUSxHQUFHLFlBQVksQ0FBQztRQUN4QixXQUFXLEdBQUcsSUFBSSxDQUFDO1FBRW5CLElBQUEseUJBQWtCLEVBQUM7WUFDakIsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ3ZELFlBQVksRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQztTQUNsRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsZ0JELG9EQWtnQkM7QUFFRDs7R0FFRztBQUNJLE1BQU0saUJBQWlCLEdBQUcsQ0FBcUQsT0FBVSxFQUFLLEVBQUU7SUFDckcsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLElBQW1CLEVBQUUsRUFBRTtRQUN2QyxJQUFJLENBQUM7WUFDSCxvQkFBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzVDLE9BQU8sTUFBTSxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUNoQyxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLG9CQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDLENBQU0sQ0FBQztBQUNWLENBQUMsQ0FBQztBQVRXLFFBQUEsaUJBQWlCLHFCQVM1QjtBQUVXLFFBQUEsUUFBUSxHQUFHLG9CQUFvQixDQUFDO0FBRTdDLDhFQUE4RTtBQUM5RSxxREFBcUQ7QUFDckQsOEVBQThFO0FBRTlFOzs7O0dBSUc7QUFDVSxRQUFBLFFBQVEsR0FBRztJQUN0QixtQkFBbUI7SUFDbkIsWUFBWTtJQUNaLFlBQVk7SUFDWixnQkFBZ0I7SUFDaEIsVUFBVTtDQUNYLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHlNYW5hZ2VyIC0gQ29yZSBPYnNlcnZlciBmb3IgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtXG4gKiBcbiAqIEFsbCBjb25maWcgYW5kIGJhY2tlbmRzIHJlc29sdmVkIGZyb20gREkgLSBubyBtYW51YWwgaW5zdGFudGlhdGlvbi5cbiAqL1xuXG5pbXBvcnQgeyBnZW5lcmF0ZVNwYW5JZCwgZ2VuZXJhdGVPYnNlcnZhYmlsaXR5TG9nSWQgfSBmcm9tICcuL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7XG4gIENhcHR1cmVDb250cm9sLFxuICBDYXB0dXJlSW5wdXQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmROYW1lLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdSdWxlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgU3BhbkxpZmVjeWNsZUhvb2sgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvdHlwZXMnO1xuaW1wb3J0IHsgc3RyaW5nVG9MZXZlbCwgbGV2ZWxUb1N0cmluZyB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuaW1wb3J0IHsgZGV0ZWN0U291cmNlLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuaW1wb3J0IHsgY29tcHV0ZUVycm9yRmluZ2VycHJpbnQgfSBmcm9tICcuL3V0aWxzL2Vycm9yLWZpbmdlcnByaW50JztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0LCBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMgfSBmcm9tICcuL2NvbnRleHQnO1xuaW1wb3J0IHsgaW5pdGlhbGl6ZUNhcHR1cmVyLCByZXNldENhcHR1cmVyIH0gZnJvbSAnLi9vYnNlcnZlcnMvYmFzZSc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IE5vUHJvdmlkZXJGb3VuZEVycm9yIH0gZnJvbSAnLi4vZGkvZXJyb3JzJztcbmltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24sIHR5cGUgRW1pdHRlZEV2ZW50IH0gZnJvbSAnLi9ub2lzZS1yZWR1Y3Rpb24nO1xuaW1wb3J0IHsgZ3JvdXBDaGVja3BvaW50c0J5T3BlcmF0aW9uIH0gZnJvbSAnLi9zcGFuLWNvbXByZXNzaW9uJztcbmltcG9ydCB7IGJ1aWxkVHJhY2VHcmFwaCB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZywgdHlwZSBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQgfSBmcm9tICcuL2NvbmZpZyc7XG5pbXBvcnQgeyBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgcnVuU3BhbkZpbmFsaXplciwgc2V0U3BhbkxpZmVjeWNsZUhvb2tzIH0gZnJvbSAnLi9ydW50aW1lLXN0YXRlJztcbmltcG9ydCB7IG1hdGNoZXNQYXR0ZXJuLCByZXBsYWNlUGF0dGVybiB9IGZyb20gJy4vdXRpbHMvcGF0dGVybi11dGlscyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2YWJpbGl0eU1hbmFnZXInKTtcblxuaW50ZXJmYWNlIFZhbGlkYXRpb25FcnJvciB7XG4gIGZpZWxkOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIE1PRFVMRSBTVEFURVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmxldCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsID0gbnVsbDtcbmxldCBiYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdO1xubGV0IGJhY2tlbmRDb25maWdzID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlDb25maWdbICdiYWNrZW5kcycgXVsgMCBdPigpO1xubGV0IGludm9jYXRpb25Db3VudCA9IDA7XG5sZXQgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbmNvbnN0IHNhbXBsaW5nUmVnZXhDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWdFeHA+KCk7XG5jb25zdCBwZW5kaW5nRGlzcGF0Y2hlczogUHJvbWlzZTx2b2lkPltdID0gW107IC8vIFRyYWNrIGZpcmUtYW5kLWZvcmdldCBwcm9taXNlcyBmb3IgZmx1c2goKVxuXG4vKipcbiAqIFByZS1pbml0aWFsaXphdGlvbiBob29rcyAtIGNhbGxiYWNrcyB0aGF0IHJ1biBiZWZvcmUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLlxuICogVXNlZCB0byByZWdpc3RlciBzY2hlbWFzL3NlcnZpY2VzIG5lZWRlZCBieSBiYWNrZW5kcyB3aXRob3V0IGNpcmN1bGFyIGRlcGVuZGVuY2llcy5cbiAqL1xuY29uc3QgcHJlSW5pdEhvb2tzOiBBcnJheTwoKSA9PiB2b2lkPiA9IFtdO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIE5PSVNFIFJFRFVDVElPTiBJTlRFR1JBVElPTlxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogVW5wYWNrIEVtaXR0ZWRFdmVudFtdIGZyb20gbm9pc2UgcmVkdWN0aW9uIGludG8gT2JzZXJ2YWJpbGl0eUV2ZW50W10uXG4gKiBcbiAqIEZvciBlYWNoIGVtaXR0ZWQgZXZlbnQ6XG4gKiAtIFNldHMgYF9hYnNvcmJlZGAgaWYgdGhlcmUgaXMgYWJzb3JiZWQgZGF0YVxuICogLSBSZXNvbHZlcyBgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkYCB0byB0aGUgbmVhcmVzdCBlbWl0dGVkIGFuY2VzdG9yXG4gKi9cbmZ1bmN0aW9uIHVucGFja0VtaXR0ZWRFdmVudHMoZW1pdHRlZEV2ZW50czogcmVhZG9ubHkgRW1pdHRlZEV2ZW50W10pOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gIGNvbnN0IHJlc3VsdDogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGVtaXR0ZWQgb2YgZW1pdHRlZEV2ZW50cykge1xuICAgIC8vIENyZWF0ZSBhIHNoYWxsb3cgY29weSB0byBhdm9pZCBtdXRhdGluZyB0aGUgb3JpZ2luYWwgZXZlbnRcbiAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0geyAuLi5lbWl0dGVkLmV2ZW50IH07XG5cbiAgICAvLyBNZXJnZSBhYnNvcmJlZCBkYXRhIGludG8gZXZlbnQuZGF0YSAoc2luZ2xlIGxvY2F0aW9uLCBubyBzZXBhcmF0ZSB0b3AtbGV2ZWwgZmllbGQpXG4gICAgaWYgKGVtaXR0ZWQuYWJzb3JiZWQpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nRGF0YSA9IGV2ZW50LmRhdGEgPz8ge307XG5cbiAgICAgIC8vIENvbnZlcnQgYWJzb3JiZWQgY2hlY2twb2ludHMgaW50byBHUk9VUEVEIHRpbWVsaW5lIGVudHJpZXMgKEVsYXN0aWMgQVBNIHNwYW4gY29tcHJlc3Npb24gcGF0dGVybikuXG4gICAgICAvLyBJbnN0ZWFkIG9mIE4gaW5kaXZpZHVhbCBlbnRyaWVzIGZvciBcIkJhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydFwiLCBwcm9kdWNlcyBPTkUgY29tcG9zaXRlIGVudHJ5XG4gICAgICAvLyB3aXRoIGFnZ3JlZ2F0ZSBzdGF0cyBhbmQgYSBjb21wYWN0IGl0ZW1zIGFycmF5IG9mIHBlci1pdGVtIHZhcnlpbmcgZmllbGRzLlxuICAgICAgbGV0IGNoZWNrcG9pbnRzID0gKGV4aXN0aW5nRGF0YS5jaGVja3BvaW50cyBhcyB1bmtub3duW10pID8/IFtdO1xuICAgICAgaWYgKGVtaXR0ZWQuYWJzb3JiZWQuY2hlY2twb2ludHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBncm91cGVkRW50cmllcyA9IGdyb3VwQ2hlY2twb2ludHNCeU9wZXJhdGlvbihlbWl0dGVkLmFic29yYmVkLmNoZWNrcG9pbnRzKTtcbiAgICAgICAgY2hlY2twb2ludHMgPSBbLi4uY2hlY2twb2ludHMsIC4uLmdyb3VwZWRFbnRyaWVzXTtcbiAgICAgIH1cblxuICAgICAgLy8gU3RvcmUgYWJzb3JiZWQgc3VtbWFyeSDigJQgc3RyaXBwZWQgb2YgYnlPcGVyYXRpb24sIGVudGl0eUlkcywgYW5kIGNoZWNrcG9pbnRzXG4gICAgICAvLyBzaW5jZSBncm91cGVkIGNoZWNrcG9pbnQgZW50cmllcyBub3cgY2FycnkgdGhhdCBpbmZvcm1hdGlvbi5cbiAgICAgIGNvbnN0IGFic29yYmVkU3VtbWFyeTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICAgIGNvdW50OiBlbWl0dGVkLmFic29yYmVkLmNvdW50LFxuICAgICAgICBzaWxlbnRDb3VudDogZW1pdHRlZC5hYnNvcmJlZC5zaWxlbnRDb3VudCxcbiAgICAgIH07XG4gICAgICBpZiAoZW1pdHRlZC5hYnNvcmJlZC5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBhYnNvcmJlZFN1bW1hcnkuZXJyb3JzID0gZW1pdHRlZC5hYnNvcmJlZC5lcnJvcnM7XG4gICAgICB9XG4gICAgICBpZiAoZW1pdHRlZC5hYnNvcmJlZC5jYXVzZWRCeUxpbmtzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYWJzb3JiZWRTdW1tYXJ5LmNhdXNlZEJ5TGlua3MgPSBlbWl0dGVkLmFic29yYmVkLmNhdXNlZEJ5TGlua3M7XG4gICAgICB9XG5cbiAgICAgIGV2ZW50LmRhdGEgPSB7XG4gICAgICAgIC4uLmV4aXN0aW5nRGF0YSxcbiAgICAgICAgY2hlY2twb2ludHM6IGNoZWNrcG9pbnRzLmxlbmd0aCA+IDAgPyBjaGVja3BvaW50cyA6IHVuZGVmaW5lZCxcbiAgICAgICAgYWJzb3JiZWQ6IGFic29yYmVkU3VtbWFyeSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQXR0YWNoIG5vaXNlIHJlZHVjdGlvbiBkZWJ1ZyBpbmZvIGlmIHByZXNlbnRcbiAgICBpZiAoZW1pdHRlZC5kZWJ1Z0luZm8pIHtcbiAgICAgIGV2ZW50LmRhdGEgPSB7XG4gICAgICAgIC4uLihldmVudC5kYXRhID8/IHt9KSxcbiAgICAgICAgX25vaXNlRGVidWc6IGVtaXR0ZWQuZGVidWdJbmZvLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIHBhcmVudCBJRCB0byBuZWFyZXN0IGVtaXR0ZWQgYW5jZXN0b3IuXG4gICAgLy8gVGhlIGFsZ29yaXRobSdzIHJlc29sdmVkUGFyZW50SWQgaXMgYXV0aG9yaXRhdGl2ZSB3aGVuIHByZXNlbnQuXG4gICAgaWYgKGVtaXR0ZWQucmVzb2x2ZWRQYXJlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBBbGdvcml0aG0gcmVzb2x2ZWQgYSBzcGVjaWZpYyBlbWl0dGVkIGFuY2VzdG9yXG4gICAgICBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBlbWl0dGVkLnJlc29sdmVkUGFyZW50SWQ7XG4gICAgfSBlbHNlIGlmIChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIHtcbiAgICAgIC8vIHJlc29sdmVkUGFyZW50SWQgaXMgdW5kZWZpbmVkIOKAlCBjaGVjayBpZiB0aGUgb3JpZ2luYWwgcGFyZW50IGlzIG91dHNpZGUgdGhpcyBiYXRjaFxuICAgICAgY29uc3QgcGFyZW50SW5CYXRjaCA9IGVtaXR0ZWRFdmVudHMuc29tZShlID0+IGUuZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkID09PSBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpO1xuICAgICAgaWYgKCFwYXJlbnRJbkJhdGNoKSB7XG4gICAgICAgIC8vIFBhcmVudCBpcyBvdXRzaWRlIHRoaXMgYmF0Y2ggKGNyb3NzLWJhdGNoKSDigJQga2VlcCBvcmlnaW5hbCBmb3IgbGlua2luZ1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gUGFyZW50IHdhcyBpbiBiYXRjaCBidXQgYWJzb3JiZWQvc2lsZW5jZWQg4oCUIGNsZWFyIHN0YWxlIHJlZmVyZW5jZVxuICAgICAgICBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmVzdWx0LnB1c2goZXZlbnQpO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gU3BhbiBjb21wcmVzc2lvbiAoZ3JvdXBDaGVja3BvaW50c0J5T3BlcmF0aW9uKSBleHRyYWN0ZWQgdG8gLi9zcGFuLWNvbXByZXNzaW9uLnRzXG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBIRUxQRVIgRlVOQ1RJT05TXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZnVuY3Rpb24gdmFsaWRhdGVJbnB1dChpbnB1dDogQ2FwdHVyZUlucHV0KTogVmFsaWRhdGlvbkVycm9yW10ge1xuICBjb25zdCBlcnJvcnM6IFZhbGlkYXRpb25FcnJvcltdID0gW107XG4gIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gIGlmICghaW5wdXQudHlwZSkge1xuICAgIGVycm9ycy5wdXNoKHsgZmllbGQ6ICd0eXBlJywgbWVzc2FnZTogJ3R5cGUgaXMgcmVxdWlyZWQnIH0pO1xuICB9XG5cbiAgaWYgKCFpbnB1dC5sZXZlbCkge1xuICAgIGVycm9ycy5wdXNoKHsgZmllbGQ6ICdsZXZlbCcsIG1lc3NhZ2U6ICdsZXZlbCBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmNvcnJlbGF0aW9uSWQgJiYgIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICBlcnJvcnMucHVzaCh7XG4gICAgICBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgbWVzc2FnZTogJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQuIENvbnRleHQgaXMgYXV0by1lc3RhYmxpc2hlZCBpbiBjb250cm9sbGVycywgb3IgdXNlIHJ1bldpdGhFeGVjdXRpb25Db250ZXh0KCkuJ1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGVycm9ycztcbn1cblxuZnVuY3Rpb24gYXBwbHlEYXRhUHJvdGVjdGlvbihcbiAgaW5wdXQ6IENhcHR1cmVJbnB1dCxcbiAgZGF0YVByb3RlY3Rpb24/OiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnZGF0YVByb3RlY3Rpb24nIF1cbik6IHtcbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgZXJyb3I/OiBPYnNlcnZhYmlsaXR5RXJyb3I7XG59IHtcbiAgaWYgKCFkYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCkge1xuICAgIHJldHVybiB7XG4gICAgICBkYXRhOiBpbnB1dC5kYXRhLFxuICAgICAgYXR0cmlidXRlczogaW5wdXQuYXR0cmlidXRlcyxcbiAgICAgIG1ldGFkYXRhOiBpbnB1dC5tZXRhZGF0YSxcbiAgICAgIGNvbnRleHQ6IGlucHV0LmNvbnRleHQsXG4gICAgICBlcnJvcjogaW5wdXQuZXJyb3IsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGZpZWxkcyA9IGRhdGFQcm90ZWN0aW9uLmZpZWxkcyA/PyBbICdkYXRhJywgJ2F0dHJpYnV0ZXMnLCAnbWV0YWRhdGEnLCAnY29udGV4dCcgXTtcblxuICByZXR1cm4ge1xuICAgIGRhdGE6IGZpZWxkcy5pbmNsdWRlcygnZGF0YScpICYmIGlucHV0LmRhdGFcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5kYXRhLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZGF0YSxcbiAgICBhdHRyaWJ1dGVzOiBmaWVsZHMuaW5jbHVkZXMoJ2F0dHJpYnV0ZXMnKSAmJiBpbnB1dC5hdHRyaWJ1dGVzXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuYXR0cmlidXRlcywgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGE6IGZpZWxkcy5pbmNsdWRlcygnbWV0YWRhdGEnKSAmJiBpbnB1dC5tZXRhZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0Lm1ldGFkYXRhLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQubWV0YWRhdGEsXG4gICAgY29udGV4dDogZmllbGRzLmluY2x1ZGVzKCdjb250ZXh0JykgJiYgaW5wdXQuY29udGV4dFxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmNvbnRleHQsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5jb250ZXh0LFxuICAgIGVycm9yOiBmaWVsZHMuaW5jbHVkZXMoJ2Vycm9yJykgJiYgaW5wdXQuZXJyb3JcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5lcnJvciwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmVycm9yLFxuICB9O1xufVxuXG5mdW5jdGlvbiBidWlsZEV2ZW50KGlucHV0OiBDYXB0dXJlSW5wdXQsIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PiB8IG51bGwgPSBudWxsKTogT2JzZXJ2YWJpbGl0eUV2ZW50IHtcbiAgY29uc3QgY3R4ID0gY29udGV4dCA/PyBnZXRDdXJyZW50Q29udGV4dCgpO1xuICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBpbnB1dC5jb3JyZWxhdGlvbklkID8/IGN0eD8uY29ycmVsYXRpb25JZDtcbiAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkIC0gdGhpcyBzaG91bGQgaGF2ZSBiZWVuIGNhdWdodCBieSB2YWxpZGF0aW9uJyk7XG4gIH1cblxuICBjb25zdCB7IGRhdGEsIGF0dHJpYnV0ZXMsIG1ldGFkYXRhLCBjb250ZXh0OiBldmVudENvbnRleHQsIGVycm9yIH0gPSBhcHBseURhdGFQcm90ZWN0aW9uKFxuICAgIGlucHV0LFxuICAgIGNvbmZpZz8uZGF0YVByb3RlY3Rpb25cbiAgKTtcblxuICAvLyBPcGVyYXRpb24gbm9ybWFsaXphdGlvbiAocmVkdWNlIGNhcmRpbmFsaXR5ICsgaW1wcm92ZSBjcm9zcy1iYWNrZW5kIGNvbnNpc3RlbmN5KVxuICBjb25zdCBvcE5vcm0gPSBjb25maWc/Lm9wZXJhdGlvbk5vcm1hbGl6YXRpb247XG4gIGxldCBvcGVyYXRpb24gPSBpbnB1dC5vcGVyYXRpb247XG4gIGxldCBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGlmIChvcE5vcm0/LmVuYWJsZWQgJiYgb3BlcmF0aW9uKSB7XG4gICAgY29uc3Qgb3JpZ2luYWxPcGVyYXRpb24gPSBvcGVyYXRpb247XG4gICAgY29uc3QgYXBwbGllZFJ1bGVzOiBBcnJheTx7IGlkOiBzdHJpbmc7IGZyb206IHN0cmluZzsgdG86IHN0cmluZzsgcmVhc29uPzogc3RyaW5nIH0+ID0gW107XG4gICAgY29uc3QgdHlwZU1hdGNoID0gKFxuICAgICAgcnVsZVR5cGVzOiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnb3BlcmF0aW9uTm9ybWFsaXphdGlvbicgXVsgJ3J1bGVzJyBdWyBudW1iZXIgXVsgJ3R5cGVzJyBdIHwgdW5kZWZpbmVkLFxuICAgICAgZXZlbnRUeXBlOiBzdHJpbmdcbiAgICApID0+IHtcbiAgICAgIGlmICghcnVsZVR5cGVzKSByZXR1cm4gdHJ1ZTtcbiAgICAgIGNvbnN0IGFyciA9IEFycmF5LmlzQXJyYXkocnVsZVR5cGVzKSA/IHJ1bGVUeXBlcyA6IFsgcnVsZVR5cGVzIF07XG4gICAgICAvLyBDb21wYXJlIGJ5IHN0cmluZyB0byBhdm9pZCB1bnNhZmUgY2FzdGluZyAoT2JzZXJ2YWJpbGl0eUV2ZW50VHlwZSBpcyBzdHJpbmctYmFzZWQgYW55d2F5KS5cbiAgICAgIHJldHVybiBhcnIubWFwKFN0cmluZykuaW5jbHVkZXMoZXZlbnRUeXBlKTtcbiAgICB9O1xuXG4gICAgZm9yIChjb25zdCBydWxlIG9mIG9wTm9ybS5ydWxlcyA/PyBbXSkge1xuICAgICAgaWYgKCF0eXBlTWF0Y2gocnVsZS50eXBlcywgaW5wdXQudHlwZSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFtYXRjaGVzUGF0dGVybihvcGVyYXRpb24sIHJ1bGUubWF0Y2gpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG5leHQgPSByZXBsYWNlUGF0dGVybihvcGVyYXRpb24sIHJ1bGUubWF0Y2gsIHJ1bGUucmVwbGFjZSk7XG4gICAgICBpZiAobmV4dCAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICAgIGFwcGxpZWRSdWxlcy5wdXNoKHsgaWQ6IHJ1bGUuaWQsIGZyb206IG9wZXJhdGlvbiwgdG86IG5leHQsIHJlYXNvbjogcnVsZS5yZWFzb24gfSk7XG4gICAgICAgIG9wZXJhdGlvbiA9IG5leHQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT25seSBhdHRhY2ggbWV0YSBpZiB0aGUgb3BlcmF0aW9uIGFjdHVhbGx5IGNoYW5nZWRcbiAgICBpZiAob3BOb3JtLnN0b3JlT3JpZ2luYWwgIT09IGZhbHNlICYmIG9wZXJhdGlvbiAhPT0gb3JpZ2luYWxPcGVyYXRpb24pIHtcbiAgICAgIG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhID0ge1xuICAgICAgICBmcm9tOiBvcmlnaW5hbE9wZXJhdGlvbixcbiAgICAgICAgdG86IG9wZXJhdGlvbixcbiAgICAgICAgcnVsZUlkczogYXBwbGllZFJ1bGVzLm1hcChyID0+IHIuaWQpLFxuICAgICAgICBydWxlczogYXBwbGllZFJ1bGVzLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyBNZXJnZSB0YWdzOiBjb250ZXh0ICsgaW5wdXQgKyBzbG93IGF1dG8tdGFnXG4gIGxldCBtZXJnZWRUYWdzID0gbWVyZ2VUYWdzKHsgLi4uY3R4Py5vYnNlcnZhYmlsaXR5Py50YWdzLCAuLi5pbnB1dC50YWdzIH0sIHRydWUpO1xuXG4gIC8vIFNsb3cgcmVxdWVzdCBhdXRvLXRhZ2dpbmc6IG1hcmsgc3BhbnMgZXhjZWVkaW5nIHRoZSBjb25maWd1cmVkIHRocmVzaG9sZFxuICBjb25zdCBzbG93VGhyZXNob2xkID0gY29uZmlnPy5zcGFucz8uc2xvd1RhZ1RocmVzaG9sZE1zO1xuICBpZiAoc2xvd1RocmVzaG9sZCAhPSBudWxsICYmIGlucHV0LmR1cmF0aW9uTXMgIT0gbnVsbCAmJiBpbnB1dC5kdXJhdGlvbk1zID4gc2xvd1RocmVzaG9sZCkge1xuICAgIG1lcmdlZFRhZ3MgPSB7IC4uLihtZXJnZWRUYWdzID8/IHt9KSwgX3Nsb3c6ICd0cnVlJyB9O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgIGxldmVsOiBpbnB1dC5sZXZlbCxcbiAgICBjb3JyZWxhdGlvbklkLFxuICAgIHRpbWVzdGFtcE1zOiBpbnB1dC50aW1lc3RhbXBNcyA/PyBub3csXG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5vYnNlcnZhYmlsaXR5TG9nSWQgPz8gZ2VuZXJhdGVPYnNlcnZhYmlsaXR5TG9nSWQoY29ycmVsYXRpb25JZCksXG4gICAgLy8gbnVsbCA9IGV4cGxpY2l0bHkgbm8gcGFyZW50IC0gcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIHNob3VsZCBiZSByZXNvbHZlZCBieSBjYWxsZXIgKHNwYW4gdHJlZSlcbiAgICAvLyB1bmRlZmluZWQgPSB1c2Ugd2hhdCB3YXMgcHJvdmlkZWRcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gbnVsbCA/IHVuZGVmaW5lZCA6IGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICBjYXVzZWRCeTogaW5wdXQuY2F1c2VkQnksXG4gICAgcmVsYXRlZFRyYWNlczogaW5wdXQucmVsYXRlZFRyYWNlcyxcbiAgICBhY3RvcjogaW5wdXQuYWN0b3IgPz8gY3R4Py5hY3RvcixcbiAgICBzb3VyY2U6IGlucHV0LnNvdXJjZSA/PyBjdHg/Lm9ic2VydmFiaWxpdHk/LnNvdXJjZSA/PyBkZXRlY3RTb3VyY2UoKSxcbiAgICB0YWdzOiBtZXJnZWRUYWdzLFxuICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgZW50aXR5SWQ6IGlucHV0LmVudGl0eUlkLFxuICAgIG9wZXJhdGlvbixcbiAgICBzdWJUeXBlOiBpbnB1dC5zdWJUeXBlLFxuICAgIHN0YXR1czogaW5wdXQuc3RhdHVzLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NczogaW5wdXQuZHVyYXRpb25NcyxcbiAgICBkYXRhOiBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YVxuICAgICAgPyB7IC4uLihkYXRhID8/IHt9KSwgb3BlcmF0aW9uTm9ybWFsaXphdGlvbjogb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgfVxuICAgICAgOiBkYXRhLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGEsXG4gICAgbWV0cmljczogaW5wdXQubWV0cmljcyxcbiAgICBjb250ZXh0OiBldmVudENvbnRleHQsXG4gICAgZXJyb3IsXG4gICAgZmluZ2VycHJpbnQ6IGVycm9yID8gY29tcHV0ZUVycm9yRmluZ2VycHJpbnQoZXJyb3IpIDogdW5kZWZpbmVkLFxuICAgIGNhcHR1cmU6IGlucHV0LmNhcHR1cmUsXG4gIH07XG59XG5cbi8qKlxuICogQ2F0ZWdvcml6ZSBldmVudCB0eXBlIGZvciBiYWNrZW5kIHJvdXRpbmcgYW5kIHNhbXBsaW5nXG4gKiBcbiAqIEN1c3RvbSBldmVudCB0eXBlcyBhcmUgc3VwcG9ydGVkISBVc2UgYW55IG5hbWluZyBjb252ZW50aW9uOlxuICogLSAnYnVzaW5lc3Mub3JkZXJfcGxhY2VkJyDihpIgY2F0ZWdvcml6ZWQgYXMgJ2xvZydcbiAqIC0gJ3BheW1lbnQudHJhbnNhY3Rpb24nIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAnbm90aWZpY2F0aW9uLnNlbnQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogXG4gKiBUbyBjb250cm9sIGJhY2tlbmQgcm91dGluZyBmb3IgY3VzdG9tIHR5cGVzLCB1c2UgdHlwZS1zcGVjaWZpYyBjb25maWc6XG4gKiBgYGBcbiAqIG9ic2VydmFiaWxpdHk6IHtcbiAqICAgdHlwZXM6IHtcbiAqICAgICBsb2c6IHsgYmFja2VuZHM6IFsnY2xvdWR3YXRjaCcsICdkeW5hbW9kYiddIH1cbiAqICAgfVxuICogfVxuICogYGBgXG4gKi9cbmZ1bmN0aW9uIGdldFR5cGVDYXRlZ29yeSh0eXBlOiBzdHJpbmcpOiAnc3BhbicgfCAnbWV0cmljJyB8ICdhdWRpdCcgfCAnbG9nJyB7XG4gIC8vICdzcGFuJyA9IGNvbnNvbGlkYXRlZCBzcGFuIHJlY29yZCwgJ3NwYW4uc3RhcnQnID0gT1RFTC1vbmx5IHN0YXJ0IG1hcmtlci5cbiAgLy8gRlcyNCBkb2VzIE5PVCBzdXBwb3J0IGxlZ2FjeSBzcGFuLiogcmVjb3JkIGZvcm1hdHMgKG5vIGNvbXBhdGliaWxpdHkgZ3VhcmFudGVlcykuXG4gIGlmICh0eXBlID09PSAnc3BhbicgfHwgdHlwZSA9PT0gJ3NwYW4uc3RhcnQnKSByZXR1cm4gJ3NwYW4nO1xuICBpZiAodHlwZSA9PT0gJ21ldHJpYycpIHJldHVybiAnbWV0cmljJztcbiAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnYXVkaXQnKSkgcmV0dXJuICdhdWRpdCc7XG4gIC8vIEFsbCBjdXN0b20gZXZlbnQgdHlwZXMgZGVmYXVsdCB0byAnbG9nJyBjYXRlZ29yeVxuICAvLyBUaGlzIGluY2x1ZGVzOiAnYnVzaW5lc3MuKicsICdwYXltZW50LionLCAnbm90aWZpY2F0aW9uLionLCBldGMuXG4gIHJldHVybiAnbG9nJztcbn1cblxuZnVuY3Rpb24gZ2V0QmFja2VuZHNGb3JUeXBlKHR5cGU6IHN0cmluZyk6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10ge1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkodHlwZSk7XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjb25maWc/LnR5cGVzPy5bIHR5cGVDYXRlZ29yeSBdO1xuXG4gIGlmICh0eXBlQ29uZmlnPy5iYWNrZW5kcyAmJiB0eXBlQ29uZmlnLmJhY2tlbmRzLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gYmFja2VuZHMuZmlsdGVyKChiKSA9PlxuICAgICAgdHlwZUNvbmZpZy5iYWNrZW5kcyEuaW5jbHVkZXMoYi5uYW1lIGFzIE9ic2VydmFiaWxpdHlCYWNrZW5kTmFtZSkpO1xuICB9XG5cbiAgcmV0dXJuIGJhY2tlbmRzO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGJhY2tlbmQgc2hvdWxkIGNhcHR1cmUgdGhpcyBldmVudCBiYXNlZCBvbiB0eXBlIGZpbHRlcmluZ1xuICovXG5mdW5jdGlvbiBzaG91bGRCYWNrZW5kQ2FwdHVyZVR5cGUoXG4gIGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kLFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50XG4pOiBib29sZWFuIHtcbiAgLy8gUGVyLWV2ZW50IGJhY2tlbmQgZmlsdGVyICh1c2VkIGZvciBPVEVMIHNwYW4gdHJhY2tpbmcgaW4gY29uc29saWRhdGVkIG1vZGUpXG4gIGlmIChldmVudC5jYXB0dXJlPy5iYWNrZW5kcyAmJiBldmVudC5jYXB0dXJlLmJhY2tlbmRzLmxlbmd0aCA+IDApIHtcbiAgICBpZiAoIWV2ZW50LmNhcHR1cmUuYmFja2VuZHMuaW5jbHVkZXMoYmFja2VuZC5uYW1lIGFzIE9ic2VydmFiaWxpdHlCYWNrZW5kTmFtZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBiYWNrZW5kQ2ZnID0gYmFja2VuZENvbmZpZ3MuZ2V0KGJhY2tlbmQubmFtZSk7XG4gIGlmICghYmFja2VuZENmZykgcmV0dXJuIHRydWU7IC8vIE5vIGNvbmZpZyA9IGFsbG93IGFsbFxuXG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgdHlwZUZpbHRlciA9IGJhY2tlbmRDZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgLy8gQ2hlY2sgaWYgdHlwZSBpcyBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIGJhY2tlbmRcbiAgaWYgKHR5cGVGaWx0ZXI/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIENoZWNrIHBlci10eXBlIG1pbkxldmVsIChvdmVycmlkZXMgYmFja2VuZC1sZXZlbCBtaW5MZXZlbClcbiAgaWYgKHR5cGVGaWx0ZXI/Lm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnRMZXZlbCA8IHR5cGVGaWx0ZXIubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoYmFja2VuZC5taW5MZXZlbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gRmFsbCBiYWNrIHRvIGJhY2tlbmQtbGV2ZWwgbWluTGV2ZWxcbiAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBDaGVjayBwZXItdHlwZSBzYW1wbGluZ1xuICBpZiAodHlwZUZpbHRlcj8uc2FtcGxpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUZpbHRlci5zYW1wbGluZztcbiAgfVxuXG4gIHJldHVybiB0cnVlOyAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbn1cblxuLyoqXG4gKiBBcHBseSB0YWcgZmlsdGVyaW5nIHRvIGV2ZW50IGJlZm9yZSBzZW5kaW5nIHRvIGJhY2tlbmRzLlxuICogRmlsdGVycyBmcmFtZXdvcmsgdGFncyBiYXNlZCBvbiBjb25maWcsIGFkZHMgY3VzdG9tIHRhZ3MsIGVuZm9yY2VzIG1heFRhZ3MgbGltaXQuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBpZiAoIWNvbmZpZz8udGFnRmlsdGVyaW5nKSByZXR1cm4gZXZlbnQ7XG5cbiAgY29uc3QgdGFnQ29uZmlnID0gY29uZmlnLnRhZ0ZpbHRlcmluZztcbiAgY29uc3QgaW5jbHVkZSA9IHRhZ0NvbmZpZy5pbmNsdWRlO1xuICBjb25zdCBtYXhUYWdzID0gdGFnQ29uZmlnLm1heFRhZ3MgPz8gMTA7XG5cbiAgLy8gS25vd24gZnJhbWV3b3JrIHRhZ3NcbiAgY29uc3QgZnJhbWV3b3JrVGFncyA9IG5ldyBTZXQoW1xuICAgICdzdGFnZScsICd0ZW5hbnRJZCcsICdvcGVyYXRpb25DYXRlZ29yeScsICdhdXRoTWV0aG9kJyxcbiAgICAnYWN0b3JUeXBlJywgJ2hhbmRsZXJUeXBlJywgJ2VudGl0eU5hbWUnLCAnb3BlcmF0aW9uJ1xuICBdKTtcblxuICBjb25zdCBmaWx0ZXJlZFRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgbGV0IHRhZ0NvdW50ID0gMDtcblxuICAvLyBGaWx0ZXIgZXhpc3RpbmcgdGFnc1xuICBpZiAoZXZlbnQudGFncykge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQudGFncykpIHtcbiAgICAgIGlmICh0YWdDb3VudCA+PSBtYXhUYWdzKSBicmVhaztcblxuICAgICAgLy8gRnJhbWV3b3JrIHRhZ3M6IG11c3QgYmUgaW4gaW5jbHVkZSBhcnJheVxuICAgICAgaWYgKGZyYW1ld29ya1RhZ3MuaGFzKGtleSkpIHtcbiAgICAgICAgaWYgKGluY2x1ZGUgJiYgIWluY2x1ZGUuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgIGNvbnRpbnVlOyAvLyBFeGNsdWRlZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBVbmtub3duIHRhZ3MgKGN1c3RvbSk6IGFsd2F5cyBpbmNsdWRlXG5cbiAgICAgIC8vIENvbnZlcnQgdG8gc3RyaW5nXG4gICAgICBmaWx0ZXJlZFRhZ3NbIGtleSBdID0gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IHZhbHVlIDogU3RyaW5nKHZhbHVlKTtcbiAgICAgIHRhZ0NvdW50Kys7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGN1c3RvbSB0YWdzIGZyb20gY29uZmlnXG4gIGlmICh0YWdDb25maWcuY3VzdG9tICYmIHRhZ0NvdW50IDwgbWF4VGFncykge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlRm4gXSBvZiBPYmplY3QuZW50cmllcyh0YWdDb25maWcuY3VzdG9tKSkge1xuICAgICAgaWYgKHRhZ0NvdW50ID49IG1heFRhZ3MpIGJyZWFrO1xuICAgICAgaWYgKGZpbHRlcmVkVGFnc1sga2V5IF0gIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIEFscmVhZHkgZXhpc3RzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVGbihldmVudCk7XG4gICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgIGZpbHRlcmVkVGFnc1sga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICB0YWdDb3VudCsrO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIud2FybihgRmFpbGVkIHRvIGV2YWx1YXRlIGN1c3RvbSB0YWcgJHtrZXl9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIC4uLmV2ZW50LFxuICAgIHRhZ3M6IGZpbHRlcmVkVGFncyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogdm9pZCB7XG4gIC8vIEFwcGx5IHRhZyBmaWx0ZXJpbmcgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHNcbiAgY29uc3QgZmlsdGVyZWRFdmVudCA9IGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50KTtcblxuICBjb25zdCBwcm9taXNlID0gUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBmaWx0ZXJlZEV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlsdGVyZWRFdmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKS50aGVuKCgpID0+IHsgfSk7IC8vIENvbnZlcnQgdG8gUHJvbWlzZTx2b2lkPlxuXG4gIC8vIFRyYWNrIHByb21pc2Ugc28gZmx1c2goKSBjYW4gd2FpdCBmb3IgaXRcbiAgcGVuZGluZ0Rpc3BhdGNoZXMucHVzaChwcm9taXNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCB0YXJnZXRCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSk6IFByb21pc2U8dm9pZD4ge1xuICAvLyBBcHBseSB0YWcgZmlsdGVyaW5nIGJlZm9yZSBzZW5kaW5nIHRvIGJhY2tlbmRzXG4gIGNvbnN0IGZpbHRlcmVkRXZlbnQgPSBhcHBseVRhZ0ZpbHRlcmluZyhldmVudCk7XG5cbiAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBmaWx0ZXJlZEV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlsdGVyZWRFdmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKTtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhbiBldmVudCBtYXRjaGVzIGEgc2FtcGxpbmcgcnVsZVxuICovXG5mdW5jdGlvbiBtYXRjaGVzUnVsZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBydWxlOiBTYW1wbGluZ1J1bGUpOiBib29sZWFuIHtcbiAgY29uc3QgeyB0YXJnZXQsIHBhdHRlcm4gfSA9IHJ1bGU7XG5cbiAgbGV0IHZhbHVlVG9NYXRjaDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIHN3aXRjaCAodGFyZ2V0KSB7XG4gICAgY2FzZSAndGVuYW50JzpcbiAgICAgIC8vIENoZWNrIGFjdG9yLnRlbmFudElkIG9yIHRhZ3MudGVuYW50SWRcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LmFjdG9yPy50ZW5hbnRJZCA/PyBldmVudC50YWdzPy50ZW5hbnRJZDtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAncm91dGUnOlxuICAgICAgLy8gQ2hlY2sgc291cmNlIChlLmcuLCBcIk9yZGVyQ29udHJvbGxlci5jcmVhdGVcIikgb3Igb3BlcmF0aW9uXG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5zb3VyY2UgPz8gZXZlbnQub3BlcmF0aW9uO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICd0YWcnOlxuICAgICAgLy8gUGF0dGVybiBmb3JtYXQ6IFwia2V5OnZhbHVlXCIgb3IgXCJrZXk6KlwiXG4gICAgICBpZiAodHlwZW9mIHBhdHRlcm4gPT09ICdzdHJpbmcnICYmIHBhdHRlcm4uaW5jbHVkZXMoJzonKSkge1xuICAgICAgICBjb25zdCBbIGtleSwgdmFsdWVQYXR0ZXJuIF0gPSBwYXR0ZXJuLnNwbGl0KCc6JywgMik7XG4gICAgICAgIGNvbnN0IHRhZ1ZhbHVlID0gZXZlbnQudGFncz8uWyBrZXkgXTtcbiAgICAgICAgaWYgKCF0YWdWYWx1ZSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGlmICh2YWx1ZVBhdHRlcm4gPT09ICcqJykgcmV0dXJuIHRydWU7XG5cbiAgICAgICAgLy8gVGVzdCBhZ2FpbnN0IHZhbHVlIHBhdHRlcm4gKHN1cHBvcnRzIHdpbGRjYXJkcylcbiAgICAgICAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgodmFsdWVQYXR0ZXJuKTtcbiAgICAgICAgcmV0dXJuIHJlZ2V4LnRlc3QodGFnVmFsdWUpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuXG4gICAgY2FzZSAnYWN0b3InOlxuICAgICAgLy8gQ2hlY2sgYWN0b3JJZCBvciBhY3RvclR5cGVcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LmFjdG9yPy5hY3RvcklkID8/IGV2ZW50LmFjdG9yPy5hY3RvclR5cGU7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3NvdXJjZSc6XG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5zb3VyY2U7XG4gICAgICBicmVhaztcblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAoIXZhbHVlVG9NYXRjaCkgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIE1hdGNoIGFnYWluc3QgcGF0dGVybiAoc3RyaW5nIG9yIFJlZ0V4cClcbiAgaWYgKHBhdHRlcm4gaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICByZXR1cm4gcGF0dGVybi50ZXN0KHZhbHVlVG9NYXRjaCk7XG4gIH1cblxuICAvLyBTdHJpbmcgcGF0dGVybiB3aXRoIHdpbGRjYXJkIHN1cHBvcnRcbiAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgocGF0dGVybik7XG4gIHJldHVybiByZWdleC50ZXN0KHZhbHVlVG9NYXRjaCk7XG59XG5cbi8qKlxuICogQ29udGVudC1iYXNlZCBmaWx0ZXJpbmcgLSBBTFdBWVMgcnVucyByZWdhcmRsZXNzIG9mIHNhbXBsaW5nLmVuYWJsZWRcbiAqIFJldHVybnMgdHJ1ZSBpZiBldmVudCBwYXNzZXMgZmlsdGVyaW5nIHJ1bGVzIChieXBhc3MsIGxldmVsLCBkdXJhdGlvbiwgZXRjLilcbiAqIFJldHVybnMgZmFsc2UgaWYgZXZlbnQgc2hvdWxkIGJlIGZpbHRlcmVkIG91dC5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkRmlsdGVyKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjZmc6IE9ic2VydmFiaWxpdHlDb25maWcsXG4gIG9wdGlvbnM/OiB7XG4gICAgLyoqXG4gICAgICogV2hlbiB0cnVlLCBzcGFucyBtYXkgYmUgZHJvcHBlZCBiYXNlZCBvbiBjZmcuc3BhbnMubWluRHVyYXRpb25Ncy5cbiAgICAgKiBXaGVuIGZhbHNlLCBzcGFucyBhcmUgYWx3YXlzIGtlcHQgKG5lZWRlZCB3aGVuIHdlIGNhbm5vdCBzZWUgdGhlIGZ1bGwgcGFyZW50L2NoaWxkIGdyYXBoKS5cbiAgICAgKi9cbiAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A/OiBib29sZWFuO1xuICAgIC8qKlxuICAgICAqIFBhcmVudCBzcGFuIElEcyByZWZlcmVuY2VkIGJ5IGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICAgKiBJZiBhIHNwYW4gaXMgcmVmZXJlbmNlZCBoZXJlLCBpdCBtdXN0IE5FVkVSIGJlIGRyb3BwZWQuXG4gICAgICovXG4gICAgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHM/OiBSZWFkb25seVNldDxzdHJpbmc+O1xuICB9XG4pOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCBjYXB0dXJlID0gZXZlbnQuY2FwdHVyZTtcbiAgY29uc3QgaXNTcGFuUmVjb3JkID0gZXZlbnQudHlwZSA9PT0gJ3NwYW4nO1xuICBjb25zdCBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3AgPSBvcHRpb25zPy5hbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3AgPT09IHRydWU7XG4gIGNvbnN0IHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzID0gb3B0aW9ucz8ucmVmZXJlbmNlZFBhcmVudFNwYW5JZHM7XG5cbiAgLy8gPT09IEJZUEFTUyBGSUxURVJTIChhbHdheXMgcGFzcykgPT09XG5cbiAgLy8gMS4gRXhwbGljaXQgYnlwYXNzIGZsYWdcbiAgaWYgKGNhcHR1cmU/LmJ5cGFzcykge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gMi4gQ1JJVElDQUwgbG9nIGxldmVsIGFsd2F5cyBwYXNzZXNcbiAgaWYgKGxldmVsVmFsdWUgPT09IE9ic2VydmFiaWxpdHlMZXZlbC5DUklUSUNBTCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gMy4gRXJyb3JzIGFsd2F5cyBwYXNzXG4gIGlmIChldmVudC5lcnJvciB8fCBldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gPT09IFNQQU4tU1BFQ0lGSUMgRklMVEVSSU5HID09PVxuICBpZiAoaXNTcGFuUmVjb3JkKSB7XG4gICAgLy8gUmVmZXJlbmNlZCBwYXJlbnRzIG11c3QgYmUga2VwdCBmb3IgaGllcmFyY2h5IGludGVncml0eVxuICAgIGNvbnN0IGlkID0gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGlmIChpZCAmJiByZWZlcmVuY2VkUGFyZW50U3Bhbklkcz8uaGFzKGlkKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gRmlsdGVyIG91dCBmYXN0IHNwYW5zIGlmIGNvbmZpZ3VyZWRcbiAgICBpZiAoYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgbWluRHVyYXRpb24gPSBjYXB0dXJlPy5taW5EdXJhdGlvbk1zID8/IGNmZy5zcGFucy5taW5EdXJhdGlvbk1zO1xuICAgICAgaWYgKG1pbkR1cmF0aW9uID4gMCAmJiBldmVudC5kdXJhdGlvbk1zIDwgbWluRHVyYXRpb24pIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBUb28gZmFzdCwgZmlsdGVyIG91dFxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBOT04tU1BBTiBEVVJBVElPTiBGSUxURVJJTkcgPT09XG4gIGlmICghaXNTcGFuUmVjb3JkICYmIGNhcHR1cmU/Lm1pbkR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCAmJiBldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyA8IGNhcHR1cmUubWluRHVyYXRpb25Ncykge1xuICAgICAgcmV0dXJuIGZhbHNlOyAvLyBCZWxvdyB0aHJlc2hvbGQsIGZpbHRlciBvdXRcbiAgICB9XG4gIH1cblxuICAvLyA9PT0gTEVWRUwgRklMVEVSSU5HID09PVxuICAvLyBSRU1PVkVEOiBNYW5hZ2VyIG5vIGxvbmdlciBmaWx0ZXJzIGJ5IG1pbkxldmVsXG4gIC8vIEFsbCBsZXZlbC1iYXNlZCBmaWx0ZXJpbmcgaGFwcGVucyBpbiBub2lzZSByZWR1Y3Rpb24gZm9yIGNvbnRleHQtYXdhcmUgZGVjaXNpb25zXG5cbiAgLy8gUGFzc2VkIGFsbCBmaWx0ZXJzXG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIFByb2JhYmlsaXN0aWMgc2FtcGxpbmcgLSBPTkxZIHJ1bnMgd2hlbiBzYW1wbGluZy5lbmFibGVkPXRydWVcbiAqIFJldHVybnMgdHJ1ZSBpZiBldmVudCBzaG91bGQgYmUgc2FtcGxlZCAoa2VwdCksIGZhbHNlIGlmIHNhbXBsZWQgb3V0IChkcm9wcGVkKVxuICovXG5mdW5jdGlvbiBzaG91bGRTYW1wbGUoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1xuKTogYm9vbGVhbiB7XG4gIGNvbnN0IGxldmVsVmFsdWUgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcbiAgY29uc3QgdHlwZUNhdGVnb3J5ID0gZ2V0VHlwZUNhdGVnb3J5KGV2ZW50LnR5cGUpO1xuICBjb25zdCBjYXB0dXJlID0gZXZlbnQuY2FwdHVyZTtcblxuICAvLyA9PT0gR1JPVVAtQkFTRUQgU0FNUExJTkcgKGJhdGNoIHNjZW5hcmlvcykgPT09XG4gIGlmIChjYXB0dXJlPy5ncm91cCkge1xuICAgIGNvbnN0IHsgaW5kZXgsIGNhcHR1cmVGaXJzdCA9IDMsIHNhbXBsZVJhdGUgPSAwLjEgfSA9IGNhcHR1cmUuZ3JvdXA7XG5cbiAgICAvLyBDYXB0dXJlIGZpcnN0IE4gaXRlbXNcbiAgICBpZiAoaW5kZXggPCBjYXB0dXJlRmlyc3QpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIFNhbXBsZSB0aGUgcmVzdCBwcm9iYWJpbGlzdGljYWxseVxuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgc2FtcGxlUmF0ZTtcbiAgfVxuXG4gIC8vID09PSBSVUxFLUJBU0VEIFNBTVBMSU5HIChIaWdoZXN0IFByaW9yaXR5KSA9PT1cbiAgaWYgKGNmZy5zYW1wbGluZz8ucnVsZXMgJiYgY2ZnLnNhbXBsaW5nLnJ1bGVzLmxlbmd0aCA+IDApIHtcbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2YgY2ZnLnNhbXBsaW5nLnJ1bGVzKSB7XG4gICAgICBpZiAobWF0Y2hlc1J1bGUoZXZlbnQsIHJ1bGUpKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcnVsZS5yYXRlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBUWVBFLVNQRUNJRklDIFNBTVBMSU5HID09PVxuICBjb25zdCB0eXBlQ29uZmlnID0gY2ZnLnR5cGVzPy5bIHR5cGVDYXRlZ29yeSBdO1xuICBpZiAodHlwZUNvbmZpZz8uc2FtcGxpbmc/LmVuYWJsZWQpIHtcbiAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHR5cGVDb25maWcuc2FtcGxpbmcucmF0ZTtcbiAgfVxuXG4gIC8vID09PSBPUEVSQVRJT04tQkFTRUQgU0FNUExJTkcgPT09XG4gIGlmIChldmVudC5vcGVyYXRpb24gJiYgY2ZnLnNhbXBsaW5nPy5vcGVyYXRpb25zKSB7XG4gICAgZm9yIChjb25zdCBbIHBhdHRlcm4sIHJhdGUgXSBvZiBPYmplY3QuZW50cmllcyhjZmcuc2FtcGxpbmcub3BlcmF0aW9ucykpIHtcbiAgICAgIGNvbnN0IHJlZ2V4ID0gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm4pO1xuICAgICAgaWYgKHJlZ2V4LnRlc3QoZXZlbnQub3BlcmF0aW9uKSkge1xuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IExFVkVMLUJBU0VEIFNBTVBMSU5HIChGYWxsYmFjaykgPT09XG4gIGNvbnN0IGxldmVsTmFtZSA9IGxldmVsVG9TdHJpbmcobGV2ZWxWYWx1ZSk7XG4gIGNvbnN0IHJhdGUgPSBjZmcuc2FtcGxpbmc/LnJhdGVzPy5bIGxldmVsTmFtZSBdO1xuICBpZiAocmF0ZSA9PT0gdW5kZWZpbmVkIHx8IHJhdGUgPj0gMSkgcmV0dXJuIHRydWU7XG4gIGlmIChyYXRlIDw9IDApIHJldHVybiBmYWxzZTtcblxuICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG59XG5cbmZ1bmN0aW9uIGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuOiBzdHJpbmcpOiBSZWdFeHAge1xuICBjb25zdCBNQVhfUkVHRVhfQ0FDSEVfU0laRSA9IDEwMDtcblxuICBsZXQgcmVnZXggPSBzYW1wbGluZ1JlZ2V4Q2FjaGUuZ2V0KHBhdHRlcm4pO1xuICBpZiAoIXJlZ2V4KSB7XG4gICAgLy8gRXZpY3Qgb2xkZXN0IGVudHJ5IGlmIGNhY2hlIGlzIGZ1bGwgKEZJRk8gZXZpY3Rpb24pXG4gICAgaWYgKHNhbXBsaW5nUmVnZXhDYWNoZS5zaXplID49IE1BWF9SRUdFWF9DQUNIRV9TSVpFKSB7XG4gICAgICBjb25zdCBmaXJzdEtleSA9IHNhbXBsaW5nUmVnZXhDYWNoZS5rZXlzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgaWYgKGZpcnN0S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FtcGxpbmdSZWdleENhY2hlLmRlbGV0ZShmaXJzdEtleSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmVnZXggPSBuZXcgUmVnRXhwKGBeJHtwYXR0ZXJuLnJlcGxhY2UoL1xcKi9nLCAnLionKX0kYCk7XG4gICAgc2FtcGxpbmdSZWdleENhY2hlLnNldChwYXR0ZXJuLCByZWdleCk7XG4gIH1cbiAgcmV0dXJuIHJlZ2V4O1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBwcmlvcml0eSBmb3IgYnVmZmVyIGV2aWN0aW9uLlxuICogSGlnaGVyIHByaW9yaXR5ID0ga2VlcCBpbiBidWZmZXJcbiAqL1xuZnVuY3Rpb24gZ2V0RXZlbnRQcmlvcml0eShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogbnVtYmVyIHtcbiAgLy8gQnlwYXNzIGV2ZW50cyBORVZFUiBnZXQgZXZpY3RlZCAobWF4IHByaW9yaXR5KVxuICBpZiAoZXZlbnQuY2FwdHVyZT8uYnlwYXNzKSB7XG4gICAgcmV0dXJuIEluZmluaXR5O1xuICB9XG5cbiAgLy8gVXNlIGV4cGxpY2l0IHByaW9yaXR5IGlmIHByb3ZpZGVkXG4gIGxldCBwcmlvcml0eSA9IGV2ZW50LmNhcHR1cmU/LnByaW9yaXR5ID8/IDA7XG5cbiAgY29uc3QgbGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcblxuICAvLyBIaWdoZXIgbG9nIGxldmVscyA9IGhpZ2hlciBwcmlvcml0eVxuICBwcmlvcml0eSArPSBsZXZlbCAqIDEwO1xuXG4gIC8vIEF1ZGl0IGV2ZW50cyBhcmUgaGlnaCBwcmlvcml0eVxuICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSB7XG4gICAgcHJpb3JpdHkgKz0gNTA7XG4gIH1cblxuICAvLyBTcGFucyB3aXRoIGVycm9ycyBhcmUgaGlnaCBwcmlvcml0eVxuICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdzcGFuJykgJiYgZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UpIHtcbiAgICBwcmlvcml0eSArPSAzMDtcbiAgfVxuXG4gIC8vIExvbmcgZHVyYXRpb24gb3BlcmF0aW9ucyBhcmUgaW50ZXJlc3RpbmdcbiAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgJiYgZXZlbnQuZHVyYXRpb25NcyA+IDEwMDApIHtcbiAgICBwcmlvcml0eSArPSAyMDtcbiAgfVxuXG4gIHJldHVybiBwcmlvcml0eTtcbn1cblxuLyoqXG4gKiBFdmljdCBsb3dlc3QgcHJpb3JpdHkgZXZlbnQgZnJvbSBidWZmZXJcbiAqIFJldHVybnMgbWV0YWRhdGEgYWJvdXQgdGhlIGV2aWN0ZWQgZXZlbnQgZm9yIGxvZ2dpbmdcbiAqL1xuZnVuY3Rpb24gZXZpY3RMb3dlc3RQcmlvcml0eShcbiAgYnVmZmVyOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSxcbiAgb3B0aW9ucz86IHsgYWxsb3dFdmljdFNwYW5zPzogYm9vbGVhbiB9XG4pOiB7IHR5cGU6IHN0cmluZzsgY29ycmVsYXRpb25JZDogc3RyaW5nOyBvcGVyYXRpb24/OiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IHJlbW92ZWRDb3VudD86IG51bWJlciB9IHwgbnVsbCB7XG4gIGlmIChidWZmZXIubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBhbGxvd0V2aWN0U3BhbnMgPSBvcHRpb25zPy5hbGxvd0V2aWN0U3BhbnMgPT09IHRydWU7XG5cbiAgLy8gU1RSSUNUIFRSRUUgRVZJQ1RJT046XG4gIC8vIFdoZW4gdGhlIGJ1ZmZlciBpcyBmdWxsLCB3ZSBNVVNUIE5PVCBldmljdCBhIHBhcmVudCBzcGFuIHdoaWxlIGtlZXBpbmcgaXRzIGNoaWxkcmVuLFxuICAvLyBvdGhlcndpc2UgZmx1c2goKSB3aWxsIGVtaXQgYG9ic2VydmFiaWxpdHkuaW52YXJpYW50X3Zpb2xhdGlvbi5taXNzaW5nX3BhcmVudF9zcGFuYC5cbiAgLy9cbiAgLy8gV2Ugc29sdmUgdGhpcyBsaWtlIGEgcmVhbCB0cmVlIHByb2JsZW06XG4gIC8vIDEpIFByZWZlciBldmljdGluZyBcImxlYWZcIiBldmVudHM6IGV2ZW50cyB0aGF0IGFyZSBOT1QgcmVmZXJlbmNlZCBhcyBhIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBieSBhbnkgb3RoZXIgYnVmZmVyZWQgZXZlbnQuXG4gIC8vIDIpIFByZWZlciBldmljdGluZyBub24tc3BhbiBsZWF2ZXMgKGxvZ3MvbWV0cmljcykgYmVmb3JlIHNwYW5zLlxuICAvLyAzKSBJZiBubyBsZWF2ZXMgZXhpc3QgKHJhcmUpLCBldmljdCBhbiBldmVudCBBTkQgaXRzIHdob2xlIGRlc2NlbmRhbnQgc3VidHJlZSBzbyBubyBvcnBoYW5zIHJlbWFpbi5cblxuICBjb25zdCByZWZlcmVuY2VkQXNQYXJlbnQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgY2hpbGRyZW5CeVBhcmVudCA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5RXZlbnRbXT4oKTtcbiAgZm9yIChjb25zdCBlIG9mIGJ1ZmZlcikge1xuICAgIGNvbnN0IHBpZCA9IGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZDtcbiAgICBpZiAodHlwZW9mIHBpZCA9PT0gJ3N0cmluZycgJiYgcGlkLmxlbmd0aCA+IDApIHtcbiAgICAgIHJlZmVyZW5jZWRBc1BhcmVudC5hZGQocGlkKTtcbiAgICAgIGNvbnN0IGFyciA9IGNoaWxkcmVuQnlQYXJlbnQuZ2V0KHBpZCk7XG4gICAgICBpZiAoYXJyKSBhcnIucHVzaChlKTtcbiAgICAgIGVsc2UgY2hpbGRyZW5CeVBhcmVudC5zZXQocGlkLCBbIGUgXSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaXNTcGFuID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS50eXBlID09PSAnc3BhbicgfHwgZS50eXBlID09PSAnc3Bhbi5zdGFydCc7XG4gIGNvbnN0IGdldElkID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4gZS5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gIGNvbnN0IGlzTGVhZiA9IChlOiBPYnNlcnZhYmlsaXR5RXZlbnQpID0+IHtcbiAgICBjb25zdCBpZCA9IGdldElkKGUpO1xuICAgIGlmICghaWQpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiAhcmVmZXJlbmNlZEFzUGFyZW50LmhhcyhpZCk7XG4gIH07XG5cbiAgY29uc3QgcGlja0xvd2VzdCA9IChjYW5kaWRhdGVzOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSkgPT4ge1xuICAgIGxldCBpZHggPSAtMTtcbiAgICBsZXQgbG93ZXN0ID0gSW5maW5pdHk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjYW5kaWRhdGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwID0gZ2V0RXZlbnRQcmlvcml0eShjYW5kaWRhdGVzWyBpIF0pO1xuICAgICAgaWYgKHAgPCBsb3dlc3QpIHtcbiAgICAgICAgbG93ZXN0ID0gcDtcbiAgICAgICAgaWR4ID0gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGlkeDtcbiAgfTtcblxuICAvLyBJZiBzcGFucyBhcmUgbm90IGFsbG93ZWQgdG8gYmUgZXZpY3RlZCwgY29uc3RyYWluIGNhbmRpZGF0ZXMgdG8gbm9uLXNwYW4gZXZlbnRzIG9ubHkuXG4gIGNvbnN0IG5vblNwYW5zID0gYnVmZmVyLmZpbHRlcigoZSkgPT4gIWlzU3BhbihlKSk7XG5cbiAgLy8gUGFzcyAxOiBub24tc3BhbiBsZWF2ZXNcbiAgY29uc3Qgbm9uU3BhbkxlYXZlcyA9IG5vblNwYW5zLmZpbHRlcigoZSkgPT4gaXNMZWFmKGUpKTtcbiAgbGV0IHRhcmdldDogT2JzZXJ2YWJpbGl0eUV2ZW50IHwgdW5kZWZpbmVkO1xuICBpZiAobm9uU3BhbkxlYXZlcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChub25TcGFuTGVhdmVzKTtcbiAgICB0YXJnZXQgPSBub25TcGFuTGVhdmVzWyBpZHggXTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIWFsbG93RXZpY3RTcGFucykge1xuICAgICAgLy8gUGFzcyAyIChub24tc3BhbiBvbmx5KTogZXZpY3QgbG93ZXN0LXByaW9yaXR5IG5vbi1zcGFuIHRoYXQgZG9lc24ndCBoYXZlIHNwYW4gY2hpbGRyZW4uXG4gICAgICAvLyBXZSBtdXN0IGNoZWNrIGZvciBzcGFuIGNoaWxkcmVuIGJlY2F1c2Ugc3VidHJlZSByZW1vdmFsIHdvdWxkIGV2aWN0IHRob3NlIHNwYW5zLFxuICAgICAgLy8gdmlvbGF0aW5nIHRoZSBhbGxvd0V2aWN0U3BhbnM9ZmFsc2UgY29udHJhY3QuXG4gICAgICBpZiAobm9uU3BhbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBGaWx0ZXIgdG8gb25seSBub24tc3BhbnMgdGhhdCBhcmUgc2FmZSB0byBldmljdCAobm8gc3BhbiBjaGlsZHJlbilcbiAgICAgICAgY29uc3Qgc2FmZU5vblNwYW5zID0gbm9uU3BhbnMuZmlsdGVyKGUgPT4ge1xuICAgICAgICAgIGNvbnN0IGlkID0gZ2V0SWQoZSk7XG4gICAgICAgICAgaWYgKCFpZCkgcmV0dXJuIHRydWU7IC8vIE5vIElEID0gbm8gY2hpbGRyZW5cbiAgICAgICAgICBjb25zdCBraWRzID0gY2hpbGRyZW5CeVBhcmVudC5nZXQoaWQpO1xuICAgICAgICAgIGlmICgha2lkcykgcmV0dXJuIHRydWU7IC8vIE5vIGNoaWxkcmVuID0gc2FmZVxuICAgICAgICAgIC8vIFJlamVjdCBpZiBhbnkgY2hpbGQgaXMgYSBzcGFuXG4gICAgICAgICAgcmV0dXJuICFraWRzLnNvbWUoY2hpbGQgPT4gaXNTcGFuKGNoaWxkKSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChzYWZlTm9uU3BhbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGlkeCA9IHBpY2tMb3dlc3Qoc2FmZU5vblNwYW5zKTtcbiAgICAgICAgICB0YXJnZXQgPSBzYWZlTm9uU3BhbnNbIGlkeCBdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEFsbCBub24tc3BhbnMgaGF2ZSBzcGFuIGNoaWxkcmVuIC0gY2Fubm90IGV2aWN0IHdpdGhvdXQgdmlvbGF0aW5nIGFsbG93RXZpY3RTcGFuc1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBCdWZmZXIgY29udGFpbnMgb25seSBzcGFucyAtIGNhbGxlciBtdXN0IGRlY2lkZSB3aGV0aGVyIHRvIGFsbG93IHNwYW4gZXZpY3Rpb24gb3Igb3ZlcmZsb3cuXG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBQYXNzIDI6IGFueSBsZWF2ZXMgKGluY2x1ZGluZyBzcGFucylcbiAgICAgIGNvbnN0IGFueUxlYXZlcyA9IGJ1ZmZlci5maWx0ZXIoKGUpID0+IGlzTGVhZihlKSk7XG4gICAgICBpZiAoYW55TGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChhbnlMZWF2ZXMpO1xuICAgICAgICB0YXJnZXQgPSBhbnlMZWF2ZXNbIGlkeCBdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gUGFzcyAzOiBubyBsZWF2ZXMgZXhpc3QgKGN5Y2xlL2RlZ2VuZXJhdGUpLiBQaWNrIHRoZSBvdmVyYWxsIGxvd2VzdC1wcmlvcml0eSBldmVudC5cbiAgICAgICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChidWZmZXIpO1xuICAgICAgICB0YXJnZXQgPSBidWZmZXJbIGlkeCBdO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICghdGFyZ2V0KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCB0YXJnZXRJZCA9IGdldElkKHRhcmdldCk7XG4gIGxldCByZW1vdmVkQ291bnQgPSAwO1xuXG4gIC8vIElmIHRhcmdldCBpcyByZWZlcmVuY2VkIGFzIGEgcGFyZW50LCByZW1vdmUgaXRzIGVudGlyZSBzdWJ0cmVlIChCRlMpLlxuICBjb25zdCB0b1JlbW92ZSA9IG5ldyBTZXQ8T2JzZXJ2YWJpbGl0eUV2ZW50PigpO1xuICBjb25zdCBxdWV1ZTogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbIHRhcmdldCBdO1xuICB3aGlsZSAocXVldWUubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGN1ciA9IHF1ZXVlLnNoaWZ0KCkhO1xuICAgIGlmICh0b1JlbW92ZS5oYXMoY3VyKSkgY29udGludWU7XG4gICAgdG9SZW1vdmUuYWRkKGN1cik7XG4gICAgY29uc3QgY3VySWQgPSBnZXRJZChjdXIpO1xuICAgIGlmIChjdXJJZCkge1xuICAgICAgY29uc3Qga2lkcyA9IGNoaWxkcmVuQnlQYXJlbnQuZ2V0KGN1cklkKTtcbiAgICAgIGlmIChraWRzKSBxdWV1ZS5wdXNoKC4uLmtpZHMpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZpbHRlciBidWZmZXIgaW4tcGxhY2VcbiAgZm9yIChsZXQgaSA9IGJ1ZmZlci5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGlmICh0b1JlbW92ZS5oYXMoYnVmZmVyWyBpIF0pKSB7XG4gICAgICBidWZmZXIuc3BsaWNlKGksIDEpO1xuICAgICAgcmVtb3ZlZENvdW50Kys7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0eXBlOiB0YXJnZXQudHlwZSxcbiAgICBjb3JyZWxhdGlvbklkOiB0YXJnZXQuY29ycmVsYXRpb25JZCxcbiAgICBvcGVyYXRpb246IHRhcmdldC5vcGVyYXRpb24sXG4gICAgbGV2ZWw6IHRhcmdldC5sZXZlbCxcbiAgICByZW1vdmVkQ291bnQsXG4gIH07XG59XG5cbi8qKlxuICogSGFuZGxlIHRhaWwtYmFzZWQgc2FtcGxpbmcgbG9naWMgZm9yIGFuIGV2ZW50IChzeW5jIHZlcnNpb24pXG4gKiBSZXR1cm5zOiAnY2FwdHVyZWQnIGlmIGV2ZW50IHdhcyBjYXB0dXJlZCwgJ2J1ZmZlcmVkJyBpZiBidWZmZXJlZCwgJ3NraXAnIGlmIG5vdCB1c2luZyB0YWlsLWJhc2VkXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nU3luYyhcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+XG4pOiAnY2FwdHVyZWQnIHwgJ2J1ZmZlcmVkJyB8ICdza2lwJyB7XG4gIGNvbnN0IGNmZyA9IGNvbmZpZztcbiAgaWYgKCFjZmcpIHJldHVybiAnc2tpcCc7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclBvbGljeSA9IGNmZy5ub2lzZVJlZHVjdGlvbi5lbmFibGVkO1xuICBjb25zdCBzaG91bGRCdWZmZXJGb3JTYW1wbGluZyA9ICEhY2ZnLnNhbXBsaW5nPy5zbWFydDtcbiAgaWYgKCghc2hvdWxkQnVmZmVyRm9yU2FtcGxpbmcgJiYgIXNob3VsZEJ1ZmZlckZvclBvbGljeSkgfHwgIWNvbnRleHQpIHtcbiAgICByZXR1cm4gJ3NraXAnO1xuICB9XG5cbiAgY29uc3QgaXNFcnJvciA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpID49IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUjtcblxuICAvLyBFUlJPUiBQQVRIOiBGbHVzaCBidWZmZXIgKyBjYXB0dXJlIGVycm9yICsgc2V0IGZsYWdcbiAgaWYgKGlzRXJyb3IpIHtcbiAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgICBpZiAob2JzU3RhdGUuYnVmZmVyLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGJ1ZmZlciA9IG9ic1N0YXRlLmJ1ZmZlcjtcbiAgICAgIG9ic1N0YXRlLmJ1ZmZlciA9IFtdO1xuXG4gICAgICBjb25zdCByZWR1Y2VkID0gYXBwbHlOb2lzZVJlZHVjdGlvbihidWZmZXIsIGNmZy5ub2lzZVJlZHVjdGlvbik7XG4gICAgICBjb25zdCB1bnBhY2tlZEV2ZW50cyA9IHVucGFja0VtaXR0ZWRFdmVudHMocmVkdWNlZC5ldmVudHMpO1xuXG4gICAgICAvLyBEaXNwYXRjaCBhbGwgZXZlbnRzIC0gbm9pc2UgcmVkdWN0aW9uIGFscmVhZHkgZmlsdGVyZWQgYnkgbWluTGV2ZWxcbiAgICAgIGZvciAoY29uc3QgYnVmZmVyZWRFdmVudCBvZiB1bnBhY2tlZEV2ZW50cykge1xuICAgICAgICBjb25zdCB0YXJnZXRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGJ1ZmZlcmVkRXZlbnQudHlwZSk7XG4gICAgICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBvYnNTdGF0ZS5lcnJvck9jY3VycmVkID0gdHJ1ZTtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICBvYnNTdGF0ZS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIFBPU1QtRVJST1IgUEFUSDogQ2FwdHVyZSBpbW1lZGlhdGVseVxuICBpZiAoY29udGV4dC5vYnNlcnZhYmlsaXR5LmVycm9yT2NjdXJyZWQpIHtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHkuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBOT1JNQUwgUEFUSDogQnVmZmVyIGV2ZXJ5dGhpbmcgKGZpbHRlcmluZyBoYXBwZW5zIEFGVEVSIG5vaXNlIHJlZHVjdGlvbilcbiAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gIGNvbnN0IGJ1ZmZlciA9IG9ic1N0YXRlLmJ1ZmZlcjtcblxuICAvLyBCdWZmZXIgc2l6ZSBtYW5hZ2VtZW50OiBldmljdCBsb3dlc3QgcHJpb3JpdHkgaWYgZnVsbFxuICBjb25zdCBtYXhTaXplID0gY2ZnLnNhbXBsaW5nPy5tYXhCdWZmZXJTaXplID8/IDEwMDA7XG4gIGlmIChidWZmZXIubGVuZ3RoID49IG1heFNpemUpIHtcbiAgICAvLyBJTVBPUlRBTlQ6XG4gICAgLy8gRHVyaW5nIGJ1ZmZlcmluZyAobm9pc2UgcmVkdWN0aW9uIC8gc21hcnQgc2FtcGxpbmcpLCBzcGFucyBtYXkgYmUgZW1pdHRlZCBBRlRFUiB0aGVpciBjaGlsZHJlbi5cbiAgICAvLyBFdmljdGluZyBzcGFucyBvcHBvcnR1bmlzdGljYWxseSBjYW4gdGhlcmVmb3JlIGNyZWF0ZSBmdXR1cmUgb3JwaGFuIGNoaWxkcmVuIChtaXNzaW5nX3BhcmVudF9zcGFuKS5cbiAgICAvLyBQcmVmZXIgZXZpY3Rpbmcgbm9uLXNwYW4gZXZlbnRzIG9ubHk7IGlmIHRoZSBidWZmZXIgaXMgc3BhbnMtb25seSwgYWxsb3cgYm91bmRlZCBvdmVyZmxvdy5cbiAgICBjb25zdCBldmljdGVkSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyLCB7IGFsbG93RXZpY3RTcGFuczogZmFsc2UgfSk7XG4gICAgaWYgKGV2aWN0ZWRJbmZvKSB7XG4gICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQrKztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU3BhbnMtb25seSBvdmVyZmxvdzogYWxsb3cgYnVmZmVyIGdyb3d0aCB1cCB0byAyeCBiZWZvcmUgZXZpY3Rpbmcgc3BhbiBzdWJ0cmVlcy5cbiAgICAgIGNvbnN0IGhhcmRDYXAgPSBtYXhTaXplICogMjtcbiAgICAgIGlmIChidWZmZXIubGVuZ3RoID49IGhhcmRDYXApIHtcbiAgICAgICAgY29uc3QgZXZpY3RlZFNwYW5JbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiB0cnVlIH0pO1xuICAgICAgICBpZiAoZXZpY3RlZFNwYW5JbmZvKSB7XG4gICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBMb2cgd2FybmluZyB3aXRoIGV2aWN0ZWQgZXZlbnQgZGV0YWlsc1xuICAgIGlmIChvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgPT09IDEgfHwgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkICUgMTAwID09PSAwKSB7XG4gICAgICBsb2dnZXIud2FybignT2JzZXJ2YWJpbGl0eSBidWZmZXIgZnVsbCwgZXZpY3RpbmcgbG93ZXN0IHByaW9yaXR5IGV2ZW50cycsIHtcbiAgICAgICAgZXZpY3RlZDogb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICBidWZmZXJTaXplOiBidWZmZXIubGVuZ3RoLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIGV2aWN0ZWRFdmVudDogZXZpY3RlZEluZm8sXG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKGV2aWN0ZWRJbmZvKSB7XG4gICAgICAvLyBMb2cgZWFjaCBldmljdGlvbiBhdCBkZWJ1ZyBsZXZlbCBmb3IgdHJvdWJsZXNob290aW5nXG4gICAgICBsb2dnZXIuZGVidWcoJ0V2aWN0ZWQgb2JzZXJ2YWJpbGl0eSBldmVudCBmcm9tIGJ1ZmZlcicsIHtcbiAgICAgICAgLi4uZXZpY3RlZEluZm8sXG4gICAgICAgIHRvdGFsRXZpY3RlZDogb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYnVmZmVyLnB1c2goZXZlbnQpO1xuICBvYnNTdGF0ZS5zdW1tYXJ5LmJ1ZmZlcmVkKys7XG4gIHJldHVybiAnYnVmZmVyZWQnO1xufVxuXG4vKipcbiAqIEhhbmRsZSB0YWlsLWJhc2VkIHNhbXBsaW5nIGxvZ2ljIGZvciBhbiBldmVudCAoYXN5bmMgdmVyc2lvbilcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdBc3luYyhcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+XG4pOiBQcm9taXNlPCdjYXB0dXJlZCcgfCAnYnVmZmVyZWQnIHwgJ3NraXAnPiB7XG4gIGNvbnN0IGNmZyA9IGNvbmZpZztcbiAgaWYgKCFjZmcpIHJldHVybiAnc2tpcCc7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclBvbGljeSA9IGNmZy5ub2lzZVJlZHVjdGlvbi5lbmFibGVkO1xuICBjb25zdCBzaG91bGRCdWZmZXJGb3JTYW1wbGluZyA9ICEhY2ZnLnNhbXBsaW5nPy5zbWFydDtcbiAgaWYgKCghc2hvdWxkQnVmZmVyRm9yU2FtcGxpbmcgJiYgIXNob3VsZEJ1ZmZlckZvclBvbGljeSkgfHwgIWNvbnRleHQpIHtcbiAgICByZXR1cm4gJ3NraXAnO1xuICB9XG5cbiAgY29uc3QgaXNFcnJvciA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpID49IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUjtcblxuICAvLyBFUlJPUiBQQVRIOiBGbHVzaCBidWZmZXIgKyBjYXB0dXJlIGVycm9yICsgc2V0IGZsYWdcbiAgaWYgKGlzRXJyb3IpIHtcbiAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgICBpZiAob2JzU3RhdGUuYnVmZmVyLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGJ1ZmZlciA9IG9ic1N0YXRlLmJ1ZmZlcjtcbiAgICAgIG9ic1N0YXRlLmJ1ZmZlciA9IFtdO1xuXG4gICAgICBjb25zdCByZWR1Y2VkID0gYXBwbHlOb2lzZVJlZHVjdGlvbihidWZmZXIsIGNmZy5ub2lzZVJlZHVjdGlvbik7XG4gICAgICBjb25zdCB1bnBhY2tlZEV2ZW50cyA9IHVucGFja0VtaXR0ZWRFdmVudHMocmVkdWNlZC5ldmVudHMpO1xuXG4gICAgICAvLyBEaXNwYXRjaCBhbGwgZXZlbnRzIC0gbm9pc2UgcmVkdWN0aW9uIGFscmVhZHkgZmlsdGVyZWQgYnkgbWluTGV2ZWxcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKHVucGFja2VkRXZlbnRzLm1hcChidWZmZXJlZEV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICByZXR1cm4gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBvYnNTdGF0ZS5lcnJvck9jY3VycmVkID0gdHJ1ZTtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgb2JzU3RhdGUuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBQT1NULUVSUk9SIFBBVEg6IENhcHR1cmUgaW1tZWRpYXRlbHlcbiAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eS5lcnJvck9jY3VycmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZ1xuICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuXG4gIC8vIEJ1ZmZlciBzaXplIG1hbmFnZW1lbnQ6IGV2aWN0IGxvd2VzdCBwcmlvcml0eSBpZiBmdWxsXG4gIGNvbnN0IG1heFNpemUgPSBjZmcuc2FtcGxpbmc/Lm1heEJ1ZmZlclNpemUgPz8gMTAwMDtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gbWF4U2l6ZSkge1xuICAgIGNvbnN0IGV2aWN0ZWRJbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KTtcbiAgICBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBoYXJkQ2FwID0gbWF4U2l6ZSAqIDI7XG4gICAgICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBoYXJkQ2FwKSB7XG4gICAgICAgIGNvbnN0IGV2aWN0ZWRTcGFuSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyLCB7IGFsbG93RXZpY3RTcGFuczogdHJ1ZSB9KTtcbiAgICAgICAgaWYgKGV2aWN0ZWRTcGFuSW5mbykge1xuICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTG9nIHdhcm5pbmcgaWYgZXZpY3RpbmcgYSBsb3RcbiAgICBpZiAob2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkID09PSAxIHx8IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCAlIDEwMCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ09ic2VydmFiaWxpdHkgYnVmZmVyIGZ1bGwsIGV2aWN0aW5nIGxvd2VzdCBwcmlvcml0eSBldmVudHMnLCB7XG4gICAgICAgIGV2aWN0ZWQ6IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCxcbiAgICAgICAgYnVmZmVyU2l6ZTogYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBidWZmZXIucHVzaChldmVudCk7XG4gIG9ic1N0YXRlLnN1bW1hcnkuYnVmZmVyZWQrKztcbiAgcmV0dXJuICdidWZmZXJlZCc7XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBzb3VyY2UtbWFwLXN1cHBvcnQgaWYgZW5hYmxlZCBpbiBjb25maWdcbiAqIFByb3ZpZGVzIGJldHRlciBzdGFjayB0cmFjZXMgZm9yIFR5cGVTY3JpcHQvdHJhbnNwaWxlZCBjb2RlIGluIHByb2R1Y3Rpb25cbiAqL1xuZnVuY3Rpb24gaW5pdGlhbGl6ZVNvdXJjZU1hcFN1cHBvcnQoY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogdm9pZCB7XG4gIGlmICghY2ZnLnNvdXJjZU1hcC5lbmFibGVkKSB7XG4gICAgbG9nZ2VyLmRlYnVnKCdTb3VyY2UgbWFwIHN1cHBvcnQgZGlzYWJsZWQgaW4gY29uZmlnJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0F0dGVtcHRpbmcgdG8gbG9hZCBzb3VyY2UtbWFwLXN1cHBvcnQuLi4nKTtcbiAgICAvLyBEeW5hbWljIGltcG9ydCB0byBhdm9pZCBidW5kbGluZyBpZiBub3QgbmVlZGVkXG4gICAgcmVxdWlyZSgnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJyk7XG4gICAgbG9nZ2VyLmRlYnVnKCdTb3VyY2UgbWFwIHN1cHBvcnQgZW5hYmxlZCAtIHN0YWNrIHRyYWNlcyB3aWxsIHNob3cgb3JpZ2luYWwgVHlwZVNjcmlwdCBsaW5lcycpO1xuICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgIC8vIE5vdCBhIGNyaXRpY2FsIGVycm9yIC0gb2JzZXJ2YWJpbGl0eSBzdGlsbCB3b3JrcyB3aXRob3V0IHNvdXJjZSBtYXBzXG4gICAgaWYgKGVycm9yICYmIHR5cGVvZiBlcnJvciA9PT0gJ29iamVjdCcgJiYgJ2NvZGUnIGluIGVycm9yICYmIChlcnJvciBhcyB7IGNvZGU/OiB1bmtub3duIH0pLmNvZGUgPT09ICdNT0RVTEVfTk9UX0ZPVU5EJykge1xuICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgICdzb3VyY2UtbWFwLXN1cHBvcnQgcGFja2FnZSBub3QgZm91bmQuIEluc3RhbGwgaXQgZm9yIGJldHRlciBlcnJvciBzdGFjayB0cmFjZXM6IG5wbSBpbnN0YWxsIHNvdXJjZS1tYXAtc3VwcG9ydCdcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG1zZyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gbG9hZCBzb3VyY2UtbWFwLXN1cHBvcnQ6JywgbXNnKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIGJhY2tlbmRzIGZyb20gREkgYmFzZWQgb24gY29uZmlnXG4gKi9cbmZ1bmN0aW9uIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogdm9pZCB7XG4gIGJhY2tlbmRzID0gW107XG4gIGJhY2tlbmRDb25maWdzLmNsZWFyKCk7XG4gIGNvbnN0IGVuYWJsZWRCYWNrZW5kcyA9IGNmZy5iYWNrZW5kcy5maWx0ZXIoYiA9PiBiLmVuYWJsZWQgIT09IGZhbHNlKTtcblxuICBmb3IgKGNvbnN0IGJhY2tlbmRDZmcgb2YgZW5hYmxlZEJhY2tlbmRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJhY2tlbmQgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmU8T2JzZXJ2YWJpbGl0eUJhY2tlbmQ+KFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICAgICAgICB7IHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsIGJhY2tlbmRDZmcudHlwZSBdIH1cbiAgICAgICk7XG4gICAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICAgICAgYmFja2VuZENvbmZpZ3Muc2V0KGJhY2tlbmQubmFtZSwgYmFja2VuZENmZyk7XG4gICAgICBiYWNrZW5kLmNvbmZpZ3VyZUZyb21CYWNrZW5kRW50cnk/LihiYWNrZW5kQ2ZnKTtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgSW5pdGlhbGl6ZWQgYmFja2VuZDogJHtiYWNrZW5kLm5hbWV9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIE5vUHJvdmlkZXJGb3VuZEVycm9yKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBCYWNrZW5kICcke2JhY2tlbmRDZmcudHlwZX0nIG5vdCBmb3VuZCBpbiBESSwgc2tpcHBpbmdgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGluaXRpYWxpemUgYmFja2VuZCAnJHtiYWNrZW5kQ2ZnLnR5cGV9JzpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKGJhY2tlbmRzLmxlbmd0aCA9PT0gMCkge1xuICAgIC8vIFNvZnQtZmFpbDogZG8gTk9UIHRocm93IGFuZCBicmVhayBhcHBsaWNhdGlvbiBmbG93LlxuICAgIC8vIFdpdGhvdXQgYmFja2VuZHMsIGNhcHR1cmUgYmVjb21lcyBhIG5vLW9wIGZvciB0aGlzIGludm9jYXRpb24gKGV2ZW50cyBhcmUgZHJvcHBlZCkuXG4gICAgbG9nZ2VyLmVycm9yKCdPYnNlcnZhYmlsaXR5IG1pc2NvbmZpZ3VyZWQ6IG5vIGVuYWJsZWQvYXZhaWxhYmxlIGJhY2tlbmRzIHdlcmUgcmVzb2x2ZWQgZnJvbSBESS4gT2JzZXJ2YWJpbGl0eSB3aWxsIGJlIGRpc2FibGVkIGZvciB0aGlzIGludm9jYXRpb24uJywge1xuICAgICAgZW5hYmxlZEJhY2tlbmRUeXBlczogZW5hYmxlZEJhY2tlbmRzLm1hcChiID0+IGIudHlwZSksXG4gICAgfSk7XG4gIH1cblxuICAvLyBSZWdpc3RlciBzcGFuIGxpZmVjeWNsZSBob29rcyBmb3IgYmFja2VuZHMgdGhhdCBpbXBsZW1lbnQgU3BhbkxpZmVjeWNsZUhvb2suXG4gIC8vIFRoaXMgYWxsb3dzIFNwYW5PYnNlcnZlciB0byBjYWxsIE9URUwgKGFuZCBvdGhlciByZWFsLXRpbWUgYmFja2VuZHMpIGRpcmVjdGx5XG4gIC8vIGluc3RlYWQgb2Ygcm91dGluZyBzcGFuLnN0YXJ0IGV2ZW50cyB0aHJvdWdoIHRoZSBidWZmZXJlZCBjYXB0dXJlIHBpcGVsaW5lLlxuICBjb25zdCBob29rczogU3BhbkxpZmVjeWNsZUhvb2tbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgYmFja2VuZHMpIHtcbiAgICBpZiAoaXNTcGFuTGlmZWN5Y2xlSG9vayhiYWNrZW5kKSkge1xuICAgICAgaG9va3MucHVzaChiYWNrZW5kKTtcbiAgICB9XG4gIH1cbiAgc2V0U3BhbkxpZmVjeWNsZUhvb2tzKGhvb2tzKTtcbiAgaWYgKGhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICBsb2dnZXIuZGVidWcoYFJlZ2lzdGVyZWQgJHtob29rcy5sZW5ndGh9IHNwYW4gbGlmZWN5Y2xlIGhvb2socylgKTtcbiAgfVxufVxuXG4vKiogVHlwZSBndWFyZDogY2hlY2sgaWYgYSBiYWNrZW5kIGFsc28gaW1wbGVtZW50cyBTcGFuTGlmZWN5Y2xlSG9vay4gKi9cbmZ1bmN0aW9uIGlzU3BhbkxpZmVjeWNsZUhvb2soYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQpOiBiYWNrZW5kIGlzIE9ic2VydmFiaWxpdHlCYWNrZW5kICYgU3BhbkxpZmVjeWNsZUhvb2sge1xuICBjb25zdCBjYW5kaWRhdGUgPSBiYWNrZW5kIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHJldHVybiB0eXBlb2YgY2FuZGlkYXRlLm9uU3BhblN0YXJ0ID09PSAnZnVuY3Rpb24nXG4gICAgJiYgdHlwZW9mIGNhbmRpZGF0ZS5vblNwYW5FbmQgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGRvSW5pdGlhbGl6ZSgpOiB2b2lkIHtcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIFNUQVJUID09PScpO1xuXG4gICAgLy8gUnVuIHByZS1pbml0aWFsaXphdGlvbiBob29rcyAoZS5nLiwgc2NoZW1hIHJlZ2lzdHJhdGlvbilcbiAgICBpZiAocHJlSW5pdEhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgUnVubmluZyAke3ByZUluaXRIb29rcy5sZW5ndGh9IHByZS1pbml0aWFsaXphdGlvbiBob29rKHMpLi4uYCk7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgcHJlSW5pdEhvb2tzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaG9vaygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcignUHJlLWluaXRpYWxpemF0aW9uIGhvb2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLmRlYnVnKCdQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBjb25maWcgaW5wdXQgZnJvbSBESSwgdGhlbiBub3JtYWxpemUgaW50byBhIGZ1bGx5LWRlZmluZWQgT2JzZXJ2YWJpbGl0eUNvbmZpZy5cbiAgICAvLyBUaGlzIGF2b2lkcyB1bnNhZmUgY2FzdHMgYW5kIGVuc3VyZXMgdGhlIHNoYXBlIGlzIGNvbnNpc3RlbnQgZXZlbiB3aGVuIGFwcHMgb3ZlcnJpZGUgcGFydGlhbGx5LlxuICAgIGNvbnN0IGlucHV0ID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlQ29uZmlnPE9ic2VydmFiaWxpdHlDb25maWdJbnB1dD4oJ29ic2VydmFiaWxpdHknKTtcbiAgICBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0KTtcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhjb25maWcpO1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBjb25maWcgbG9hZGVkIGZyb20gREknLCB7XG4gICAgICBlbmFibGVkOiBjb25maWcuZW5hYmxlZCxcbiAgICAgIHNlcnZpY2VOYW1lOiBjb25maWcuc2VydmljZU5hbWUsXG4gICAgICBiYWNrZW5kczogY29uZmlnLmJhY2tlbmRzPy5tYXAoYiA9PiBiLnR5cGUpLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkLCBzbWFydDogY29uZmlnLnNhbXBsaW5nPy5zbWFydCB9LFxuICAgICAgc291cmNlTWFwOiBjb25maWcuc291cmNlTWFwPy5lbmFibGVkLFxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBzb3VyY2UtbWFwLXN1cHBvcnQgZm9yIGJldHRlciBzdGFjayB0cmFjZXMgKGlmIGVuYWJsZWQpXG4gICAgaW5pdGlhbGl6ZVNvdXJjZU1hcFN1cHBvcnQoY29uZmlnKTtcblxuICAgIC8vIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESVxuICAgIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY29uZmlnISk7XG5cbiAgICAvLyBSZWdpc3RlciBjYXB0dXJlciBmb3Igb2JzZXJ2ZXJzXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcblxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIENPTVBMRVRFID09PScpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignISEhIE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gRkFJTEVEICEhIScsIGVycm9yKTtcbiAgICAvLyBTb2Z0LWZhaWw6IGRvIE5PVCB0aHJvdyBpbnRvIGFwcGxpY2F0aW9uIGZsb3cuXG4gICAgLy8gTWFyayBpbml0aWFsaXplZCB0byBwcmV2ZW50IHJlcGVhdGVkIGluaXQgYXR0ZW1wdHM7IGxlYXZlIGNhcHR1cmVyIHVuaW5pdGlhbGl6ZWQgc28gb2JzZXJ2ZXJzIGRyb3AgZXZlbnRzLlxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBVQkxJQyBBUEkgLSBPYnNlcnZhYmlsaXR5TWFuYWdlclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TWFuYWdlciB7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHsgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciBhIG5ldyBMYW1iZGEgaW52b2NhdGlvblxuICAgKi9cbiAgc3RhdGljIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKSBjYWxsZWQnLCB7IGluaXRpYWxpemVkLCBpbnZvY2F0aW9uQ291bnQgfSk7XG5cbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ05vdCBpbml0aWFsaXplZCB5ZXQsIGNhbGxpbmcgZG9Jbml0aWFsaXplKCkuLi4nKTtcbiAgICAgIGRvSW5pdGlhbGl6ZSgpO1xuICAgIH1cblxuICAgIGludm9jYXRpb25Db3VudCsrO1xuICAgIGxvZ2dlci5kZWJ1ZyhgSW52b2NhdGlvbiAke2ludm9jYXRpb25Db3VudH0gc3RhcnRpbmcsIGluaXRpYWxpemluZyAke2JhY2tlbmRzLmxlbmd0aH0gYmFja2VuZChzKWApO1xuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIGJhY2tlbmRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBiYWNrZW5kLmluaXRpYWxpemVJbnZvY2F0aW9uPy4oKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmFpbGVkIHRvIGluaXRpYWxpemUgaW52b2NhdGlvbjpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIGlzSW5pdGlhbGl6ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGluaXRpYWxpemVkO1xuICB9XG5cbiAgc3RhdGljIGlzQ29sZFN0YXJ0KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbnZvY2F0aW9uQ291bnQgPT09IDE7XG4gIH1cblxuICBzdGF0aWMgZ2V0SW52b2NhdGlvbkNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudDtcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb25maWcoKTogT2JzZXJ2YWJpbGl0eUNvbmZpZyB8IG51bGwge1xuICAgIHJldHVybiBjb25maWc7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG9ic2VydmFiaWxpdHkgc3VtbWFyeSBmb3IgdGhlIGN1cnJlbnQgaW52b2NhdGlvbi5cbiAgICogUmV0dXJucyBidWZmZXIgc3RhdHM6IGV2aWN0ZWQsIGJ1ZmZlcmVkLCBjYXB0dXJlZCwgc2FtcGxlZE91dCBjb3VudHMuXG4gICAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGV4ZWN1dGlvbiBjb250ZXh0IGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBnZXRTdW1tYXJ5KCk6IE9ic2VydmFiaWxpdHlTdW1tYXJ5IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICByZXR1cm4gY29udGV4dD8ub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5O1xuICB9XG5cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuICAgIGNvbmZpZyA9IHsgLi4uY29uZmlnLCAuLi51cGRhdGVzIH07XG4gIH1cblxuICBzdGF0aWMgcmVnaXN0ZXJCYWNrZW5kKGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kKTogdm9pZCB7XG4gICAgaWYgKGJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICB9XG5cbiAgc3RhdGljIHVucmVnaXN0ZXJCYWNrZW5kKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGJhY2tlbmRzID0gYmFja2VuZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IG5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHJlLWluaXRpYWxpemF0aW9uIGhvb2suXG4gICAqIEhvb2tzIHJ1biBCRUZPUkUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLCBhbGxvd2luZyBzY2hlbWEvc2VydmljZSByZWdpc3RyYXRpb25cbiAgICogbmVlZGVkIGJ5IGJhY2tlbmRzIHdpdGhvdXQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKiBcbiAgICogQHBhcmFtIGhvb2sgLSBDYWxsYmFjayB0byBleGVjdXRlIGR1cmluZyBpbml0aWFsaXphdGlvblxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUHJlSW5pdEhvb2soaG9vazogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHByZUluaXRIb29rcy5wdXNoKGhvb2spO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCAoZmlyZS1hbmQtZm9yZ2V0KVxuICAgKiBcbiAgICogQ2FwdHVyZSBjb250cm9sIGlzIGVtYmVkZGVkIGluIGlucHV0LmNhcHR1cmUgLSBubyBzZXBhcmF0ZSBvcHRpb25zIHBhcmFtLlxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBvYnNlcnZhYmlsaXR5TG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmUoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ+KdjCBPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSwgbGV2ZWw6IGlucHV0LmxldmVsIH0pO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gQmxvY2sgdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZXMgZnJvbSB0aGUgY2FwdHVyZSBwaXBlbGluZS5cbiAgICAgIC8vIHNwYW4uc3RhcnQgdXNlcyBTcGFuTGlmZWN5Y2xlSG9vayAoT1RFTCksIE5PVCBjYXB0dXJlIHBpcGVsaW5lLlxuICAgICAgLy8gc3Bhbi5lbmQgYW5kIHNwYW4uZXZlbnQgYXJlIGxlZ2FjeSBmb3JtYXRzLlxuICAgICAgaWYgKGlucHV0LnR5cGUgPT09ICdzcGFuLnN0YXJ0JyB8fCBpbnB1dC50eXBlID09PSAnc3Bhbi5lbmQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmV2ZW50Jykge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHk6IHVuc3VwcG9ydGVkIGV2ZW50IHR5cGUgaW4gY2FwdHVyZSBwaXBlbGluZSwgZHJvcHBpbmcuJywge1xuICAgICAgICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgICAgICAgb3BlcmF0aW9uOiBpbnB1dC5vcGVyYXRpb24sXG4gICAgICAgICAgaGludDogaW5wdXQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnID8gJ3NwYW4uc3RhcnQgdXNlcyBTcGFuTGlmZWN5Y2xlSG9vaycgOiAnbGVnYWN5IGZvcm1hdCBub3Qgc3VwcG9ydGVkJyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlSW5wdXQoaW5wdXQpO1xuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGNhcHR1cmUgaW5wdXQ6JywgeyBlcnJvcnMsIHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGlmICghY29uZmlnPy5lbmFibGVkKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBkaXNhYmxlZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICBjb25zdCBldmVudCA9IGJ1aWxkRXZlbnQoaW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nU3luYyhldmVudCwgY29udGV4dCk7XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2NhcHR1cmVkJykge1xuICAgICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgfVxuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdidWZmZXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgLy8gSEVBRC1CQVNFRCBGSUxURVJJTkcgKyBTQU1QTElOR1xuICAgICAgLy8gQXBwbHkgZmlsdGVyaW5nIGZpcnN0IChhbHdheXMgcnVucylcbiAgICAgIGlmICghc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgLy8gTm8gYnVmZmVyZWQgZ3JhcGggaGVyZTsgbmV2ZXIgZHJvcCBzcGFucyBieSBtaW5EdXJhdGlvbiBpbiBoZWFkLWJhc2VkIG1vZGVcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSBjYW4ndCBwcm92ZSB0aGV5IGFyZW4ndCBwYXJlbnRzIG9mIGFscmVhZHktZW1pdHRlZCBjaGlsZCBldmVudHMuXG4gICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogZmFsc2UsXG4gICAgICB9KSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBGaWx0ZXJlZCBvdXRcbiAgICAgIH1cblxuICAgICAgLy8gQXBwbHkgc2FtcGxpbmcgaWYgZW5hYmxlZCAocHJvYmFiaWxpc3RpYylcbiAgICAgIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgIXNob3VsZFNhbXBsZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBTYW1wbGVkIG91dFxuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmU6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhbiBvYnNlcnZhYmlsaXR5IGV2ZW50IGFzeW5jaHJvbm91c2x5ICh3YWl0cyBmb3IgYmFja2VuZCBjYXB0dXJlKVxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBQcm9taXNlPG9ic2VydmFiaWxpdHlMb2dJZD4gaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNhcHR1cmVBc3luYyhpbnB1dDogQ2FwdHVyZUlucHV0KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBCbG9jayB1bnN1cHBvcnRlZCBldmVudCB0eXBlcyBmcm9tIHRoZSBjYXB0dXJlIHBpcGVsaW5lLlxuICAgICAgLy8gc3Bhbi5zdGFydCB1c2VzIFNwYW5MaWZlY3ljbGVIb29rIChPVEVMKSwgTk9UIGNhcHR1cmUgcGlwZWxpbmUuXG4gICAgICAvLyBzcGFuLmVuZCBhbmQgc3Bhbi5ldmVudCBhcmUgbGVnYWN5IGZvcm1hdHMuXG4gICAgICBpZiAoaW5wdXQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmVuZCcgfHwgaW5wdXQudHlwZSA9PT0gJ3NwYW4uZXZlbnQnKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eTogdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZSBpbiBjYXB0dXJlIHBpcGVsaW5lLCBkcm9wcGluZy4nLCB7XG4gICAgICAgICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICAgICAgICBvcGVyYXRpb246IGlucHV0Lm9wZXJhdGlvbixcbiAgICAgICAgICBoaW50OiBpbnB1dC50eXBlID09PSAnc3Bhbi5zdGFydCcgPyAnc3Bhbi5zdGFydCB1c2VzIFNwYW5MaWZlY3ljbGVIb29rJyA6ICdsZWdhY3kgZm9ybWF0IG5vdCBzdXBwb3J0ZWQnLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVJbnB1dChpbnB1dCk7XG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ0ludmFsaWQgY2FwdHVyZSBpbnB1dDonLCB7IGVycm9ycywgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjb25maWc/LmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGlucHV0LCBjb250ZXh0KTtcblxuICAgICAgLy8gVHJ5IHRhaWwtYmFzZWQgc2FtcGxpbmcgZmlyc3RcbiAgICAgIGNvbnN0IHRhaWxSZXN1bHQgPSBhd2FpdCBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ0FzeW5jKGV2ZW50LCBjb250ZXh0KTtcbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnY2FwdHVyZWQnKSB7XG4gICAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgICB9XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2J1ZmZlcmVkJykge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICAvLyBIRUFELUJBU0VEIEZJTFRFUklORyArIFNBTVBMSU5HXG4gICAgICBpZiAoIXNob3VsZEZpbHRlcihldmVudCwgY29uZmlnLCB7XG4gICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogZmFsc2UsXG4gICAgICB9KSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBGaWx0ZXJlZCBvdXRcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCAmJiAhc2hvdWxkU2FtcGxlKGV2ZW50LCBjb25maWcpKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIFNhbXBsZWQgb3V0XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmVBc3luYzonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPYnNlcnZlIGFuIGV2ZW50IChjb252ZW5pZW5jZSBtZXRob2QpXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBQYXJ0aWFsIGV2ZW50IHdpdGggcmVxdWlyZWQgdHlwZSBhbmQgbGV2ZWxcbiAgICogQHJldHVybnMgb2JzZXJ2YWJpbGl0eUxvZ0lkIGlmIGNhcHR1cmVkLCB1bmRlZmluZWQgaWYgZmlsdGVyZWQvc2FtcGxlZCBvdXRcbiAgICovXG4gIHN0YXRpYyBvYnNlcnZlKFxuICAgIGV2ZW50OiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlFdmVudD4gJiB7IHR5cGU6IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgY29ycmVsYXRpb25JZD86IHN0cmluZyB9XG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGV2ZW50LmNvcnJlbGF0aW9uSWQgPz8gZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzKCk7XG5cbiAgICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdvYnNlcnZlKCkgY2FsbGVkIHdpdGhvdXQgY29ycmVsYXRpb25JZCcpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB0eXBlOiBldmVudC50eXBlIGFzIENhcHR1cmVJbnB1dFsgJ3R5cGUnIF0sXG4gICAgICBsZXZlbDogZXZlbnQubGV2ZWwgYXMgQ2FwdHVyZUlucHV0WyAnbGV2ZWwnIF0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogRmx1c2ggYWxsIGJhY2tlbmRzIGFuZCBidWZmZXJlZCBldmVudHMgKGNhbGxlZCBhdCBlbmQgb2YgTGFtYmRhIGludm9jYXRpb24pXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gRkxVU0ggU1RBUlQgPT09Jywge1xuICAgICAgcGVuZGluZ0Rpc3BhdGNoZXM6IHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCxcbiAgICAgIGJhY2tlbmRzOiBiYWNrZW5kcy5sZW5ndGgsXG4gICAgICBzbWFydFNhbXBsaW5nOiBjb25maWc/LnNhbXBsaW5nPy5zbWFydCxcbiAgICB9KTtcblxuICAgIC8vIFdhaXQgZm9yIGFsbCBwZW5kaW5nIGZpcmUtYW5kLWZvcmdldCBkaXNwYXRjaGVzIChmcm9tIGVycm9yIHBhdGggaW4gY2FwdHVyZSgpKVxuICAgIGlmIChwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYFdhaXRpbmcgZm9yICR7cGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RofSBwZW5kaW5nIGRpc3BhdGNoZXNgKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKHBlbmRpbmdEaXNwYXRjaGVzKTtcbiAgICAgIHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA9IDA7IC8vIENsZWFyIGZvciBuZXh0IGludm9jYXRpb25cbiAgICAgIGxvZ2dlci5kZWJ1ZygnUGVuZGluZyBkaXNwYXRjaGVzIGNvbXBsZXRlZCcpO1xuICAgIH1cblxuICAgIC8vIEZvcmNlLWVuZCBhbnkgc3BhbnMgbGVmdCBvcGVuIGluIHRoaXMgaW52b2NhdGlvbiBiZWZvcmUgZmx1c2hpbmcgYnVmZmVyZWQgZXZlbnRzLlxuICAgIC8vIFRoaXMgZ3VhcmFudGVlcyB0aGUgaGllcmFyY2h5IGhhcyBhbGwgcGFyZW50cywgZXZlbiBpZiB1c2VyL2ZyYW1ld29yayBjb2RlIGZvcmdvdCB0byBlbmQgYSBzcGFuLlxuICAgIHJ1blNwYW5GaW5hbGl6ZXIoKTtcblxuICAgIC8vIEF0dGFjaCBvYnNlcnZhYmlsaXR5IHN1bW1hcnkgdG8gY3VycmVudCBzcGFuIChpZiBhbnkpIGJlZm9yZSBmbHVzaGluZ1xuICAgIGNvbnN0IHN1bW1hcnkgPSBPYnNlcnZhYmlsaXR5TWFuYWdlci5nZXRTdW1tYXJ5KCk7XG4gICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgY29uc3QgY3VycmVudFNwYW4gPSBjb250ZXh0Py5vYnNlcnZhYmlsaXR5LmN1cnJlbnRTcGFuO1xuICAgIGlmIChzdW1tYXJ5ICYmIGN1cnJlbnRTcGFuICYmIChzdW1tYXJ5LmNhcHR1cmVkID4gMCB8fCBzdW1tYXJ5LmJ1ZmZlcmVkID4gMCB8fCBzdW1tYXJ5LmV2aWN0ZWQgPiAwIHx8IHN1bW1hcnkuc2FtcGxlZE91dCA+IDApKSB7XG4gICAgICAvLyBBZGQgYmFzaWMgY291bnQgbWV0cmljc1xuICAgICAgY3VycmVudFNwYW4/Lm1ldHJpY3M/Lih7XG4gICAgICAgICdfZncyNC5vYnMuY2FwdHVyZWQnOiBzdW1tYXJ5LmNhcHR1cmVkLFxuICAgICAgICAnX2Z3MjQub2JzLmJ1ZmZlcmVkJzogc3VtbWFyeS5idWZmZXJlZCxcbiAgICAgICAgJ19mdzI0Lm9icy5ldmljdGVkJzogc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICAnX2Z3MjQub2JzLnNhbXBsZWRPdXQnOiBzdW1tYXJ5LnNhbXBsZWRPdXQsXG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGRldGFpbGVkIGJyZWFrZG93biBjaGVja3BvaW50XG4gICAgICBjb25zdCBkZXRhaWxlZFN0YXRzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICAgdG90YWxzOiB7XG4gICAgICAgICAgY2FwdHVyZWQ6IHN1bW1hcnkuY2FwdHVyZWQsXG4gICAgICAgICAgYnVmZmVyZWQ6IHN1bW1hcnkuYnVmZmVyZWQsXG4gICAgICAgICAgZXZpY3RlZDogc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICAgIHNhbXBsZWRPdXQ6IHN1bW1hcnkuc2FtcGxlZE91dCxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIC8vIEFkZCBjYXB0dXJlZCBldmVudHMgYnJlYWtkb3duICh3aGF0IHdhcyBhY3R1YWxseSBlbWl0dGVkKVxuICAgICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Py5vYnNlcnZhYmlsaXR5O1xuICAgICAgaWYgKG9ic1N0YXRlPy5jYXB0dXJlZEJyZWFrZG93bikge1xuICAgICAgICBkZXRhaWxlZFN0YXRzLmNhcHR1cmVkQnJlYWtkb3duID0ge1xuICAgICAgICAgIGJ5VHlwZTogb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlUeXBlLFxuICAgICAgICAgIGJ5T3BlcmF0aW9uOiBPYmplY3Qua2V5cyhvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieU9wZXJhdGlvbiB8fCB7fSkubGVuZ3RoID4gMFxuICAgICAgICAgICAgPyBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieU9wZXJhdGlvblxuICAgICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICAgICAgYnlMZXZlbDogb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlMZXZlbCxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29tcHV0ZSBicmVha2Rvd24gYnkgdHlwZSBhbmQgb3BlcmF0aW9uIGZyb20gYnVmZmVyICh3aGF0J3Mgc3RpbGwgYnVmZmVyZWQpXG4gICAgICBpZiAoY29udGV4dCAmJiBjb250ZXh0Lm9ic2VydmFiaWxpdHkuYnVmZmVyLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgYnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGJ5T3BlcmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGJ5TGV2ZWw6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5idWZmZXIpIHtcbiAgICAgICAgICBieVR5cGVbIGV2ZW50LnR5cGUgXSA9IChieVR5cGVbIGV2ZW50LnR5cGUgXSB8fCAwKSArIDE7XG4gICAgICAgICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgICAgICAgYnlPcGVyYXRpb25bIGV2ZW50Lm9wZXJhdGlvbiBdID0gKGJ5T3BlcmF0aW9uWyBldmVudC5vcGVyYXRpb24gXSB8fCAwKSArIDE7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJ5TGV2ZWxbIGV2ZW50LmxldmVsIF0gPSAoYnlMZXZlbFsgZXZlbnQubGV2ZWwgXSB8fCAwKSArIDE7XG4gICAgICAgIH1cblxuICAgICAgICBkZXRhaWxlZFN0YXRzLmJ1ZmZlcmVkQnJlYWtkb3duID0ge1xuICAgICAgICAgIGJ5VHlwZSxcbiAgICAgICAgICBieU9wZXJhdGlvbjogT2JqZWN0LmtleXMoYnlPcGVyYXRpb24pLmxlbmd0aCA+IDAgPyBieU9wZXJhdGlvbiA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBieUxldmVsLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBBZGQgY2hlY2twb2ludCB3aXRoIGRldGFpbGVkIHN0YXRzXG4gICAgICBjdXJyZW50U3Bhbj8uY2hlY2twb2ludD8uKCdvYnNlcnZhYmlsaXR5LnN1bW1hcnkuZGV0YWlsZWQnLCB7IGRhdGE6IGRldGFpbGVkU3RhdHMgfSk7XG4gICAgfVxuXG4gICAgLy8gSWYgYnVmZmVyaW5nIGlzIGVuYWJsZWQgKHNtYXJ0IHNhbXBsaW5nIE9SIG5vaXNlIHJlZHVjdGlvbiksIGZsdXNoIGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICBpZiAoY29uZmlnPy5zYW1wbGluZz8uc21hcnQgfHwgY29uZmlnPy5ub2lzZVJlZHVjdGlvbj8uZW5hYmxlZCkge1xuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgICAgIGlmIChjb250ZXh0ICYmIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5idWZmZXIubGVuZ3RoID4gMCAmJiAhY29udGV4dC5vYnNlcnZhYmlsaXR5LmVycm9yT2NjdXJyZWQpIHtcbiAgICAgICAgLy8gTm8gZXJyb3Igb2NjdXJyZWQ6IGFwcGx5IG5vaXNlIHJlZHVjdGlvbiArIG9wdGlvbmFsIHNhbXBsaW5nIHRvIGJ1ZmZlciBiZWZvcmUgZmx1c2hpbmdcbiAgICAgICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gICAgICAgIGNvbnN0IGJ1ZmZlciA9IG9ic1N0YXRlLmJ1ZmZlcjtcbiAgICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107IC8vIENsZWFyIGJ1ZmZlclxuXG4gICAgICAgIC8vIENSSVRJQ0FMOiBDb21wdXRlIHJlZmVyZW5jZWQgcGFyZW50IElEcyBmcm9tIE9SSUdJTkFMIGJ1ZmZlciBCRUZPUkUgbm9pc2UgcmVkdWN0aW9uXG4gICAgICAgIC8vIE5vaXNlIHJlZHVjdGlvbiBtYXkgYWJzb3JiL3NpbGVuY2UgZXZlbnRzLCBidXQgdGhlaXIgcGFyZW50IHNwYW5zIG11c3Qgc3RpbGwgYmUga2VwdFxuICAgICAgICBjb25zdCByZWZlcmVuY2VkUGFyZW50U3BhbklkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICBmb3IgKGNvbnN0IGUgb2YgYnVmZmVyKSB7XG4gICAgICAgICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgICAgICAgIGlmIChwaWQpIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLmFkZChwaWQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjb25maWcubm9pc2VSZWR1Y3Rpb24pO1xuICAgICAgICBjb25zdCByZWR1Y2VkRXZlbnRzID0gdW5wYWNrRW1pdHRlZEV2ZW50cyhyZWR1Y2VkLmV2ZW50cyk7XG5cbiAgICAgICAgLy8gRHJvcCBlbXB0eSAqbGVhZiogc3BhbnMgaWYgY29uZmlndXJlZC5cbiAgICAgICAgLy8gQSBzcGFuIGlzIGEgbGVhZiBpZmYgbm9ib2R5IHJlZmVyZW5jZXMgaXQgYXMgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGluIHRoaXMgYnVmZmVyZWQgc2V0LlxuICAgICAgICBjb25zdCBtYXliZURyb3BFbXB0eUxlYWZTcGFucyA9IGNvbmZpZy5zcGFucy5za2lwRW1wdHlcbiAgICAgICAgICA/IHJlZHVjZWRFdmVudHMuZmlsdGVyKChlKSA9PiB7XG4gICAgICAgICAgICBpZiAoZS50eXBlICE9PSAnc3BhbicpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY29uc3QgaWQgPSBlLm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgaWYgKHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLmhhcyhpZCkpIHJldHVybiB0cnVlOyAvLyBwYXJlbnQgPT4ga2VlcFxuICAgICAgICAgICAgY29uc3QgZCA9IGUuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNvbnN0IGZ3ID0gZD8uX2Z3MjQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gZnc/LnNwYW5FbXB0eSAhPT0gdHJ1ZTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIDogcmVkdWNlZEV2ZW50cztcblxuICAgICAgICAvLyBFbnJpY2ggcm9vdCBzcGFuIHdpdGggaW52b2NhdGlvbiBzdW1tYXJ5IChjb21wYWN0IG92ZXJ2aWV3IG9mIHdoYXQgaGFwcGVuZWQpXG4gICAgICAgIGNvbnN0IHJvb3RTcGFuID0gbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMuZmluZChcbiAgICAgICAgICBlID0+IGUudHlwZSA9PT0gJ3NwYW4nICYmICFlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZFxuICAgICAgICApO1xuICAgICAgICBpZiAocm9vdFNwYW4pIHtcbiAgICAgICAgICBjb25zdCBzdW1tYXJ5QnlUeXBlOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgICAgY29uc3Qgc3VtbWFyeUJ5TGV2ZWw6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgICBsZXQgZXJyb3JDb3VudCA9IDA7XG4gICAgICAgICAgZm9yIChjb25zdCBlIG9mIG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zKSB7XG4gICAgICAgICAgICBzdW1tYXJ5QnlUeXBlW2UudHlwZV0gPSAoc3VtbWFyeUJ5VHlwZVtlLnR5cGVdIHx8IDApICsgMTtcbiAgICAgICAgICAgIHN1bW1hcnlCeUxldmVsW2UubGV2ZWxdID0gKHN1bW1hcnlCeUxldmVsW2UubGV2ZWxdIHx8IDApICsgMTtcbiAgICAgICAgICAgIGlmIChlLmxldmVsID09PSAnZXJyb3InIHx8IGUubGV2ZWwgPT09ICdjcml0aWNhbCcpIGVycm9yQ291bnQrKztcbiAgICAgICAgICB9XG4gICAgICAgICAgcm9vdFNwYW4uZGF0YSA9IHtcbiAgICAgICAgICAgIC4uLihyb290U3Bhbi5kYXRhID8/IHt9KSxcbiAgICAgICAgICAgIF9pbnZvY2F0aW9uU3VtbWFyeToge1xuICAgICAgICAgICAgICB0b3RhbEV2ZW50czogbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMubGVuZ3RoLFxuICAgICAgICAgICAgICBieVR5cGU6IHN1bW1hcnlCeVR5cGUsXG4gICAgICAgICAgICAgIGJ5TGV2ZWw6IHN1bW1hcnlCeUxldmVsLFxuICAgICAgICAgICAgICBoYXNFcnJvcnM6IGVycm9yQ291bnQgPiAwLFxuICAgICAgICAgICAgICBlcnJvckNvdW50LFxuICAgICAgICAgICAgICBub2lzZVJlZHVjdGlvbjogcmVkdWNlZC5zdGF0cyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRyYWNrIGNhcHR1cmVkIGV2ZW50cyBmb3IgZGV0YWlsZWQgc3VtbWFyeVxuICAgICAgICBjb25zdCBjYXB0dXJlZEJ5VHlwZTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICBjb25zdCBjYXB0dXJlZEJ5T3BlcmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge307XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkQnlMZXZlbDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gICAgICAgIGZvciAoY29uc3QgZXZlbnQgb2YgbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMpIHtcbiAgICAgICAgICAvLyBUQUlMLUJBU0VEIEZJTFRFUklORyArIFNBTVBMSU5HIChhZnRlciBub2lzZSByZWR1Y3Rpb24pXG5cbiAgICAgICAgICAvLyBBcHBseSBmaWx0ZXJpbmcgZmlyc3QgKGFsd2F5cyBydW5zIC0gY29udGVudC1iYXNlZClcbiAgICAgICAgICBjb25zdCBwYXNzZWRGaWx0ZXIgPSBzaG91bGRGaWx0ZXIoZXZlbnQsIGNvbmZpZywge1xuICAgICAgICAgICAgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wOiB0cnVlLFxuICAgICAgICAgICAgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKCFwYXNzZWRGaWx0ZXIpIHtcbiAgICAgICAgICAgIC8vIEZpbHRlcmVkIG91dCAtIGRvbid0IGNvdW50IGFzIHNhbXBsZWQgb3V0XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBBcHBseSBzYW1wbGluZyBpZiBlbmFibGVkIChwcm9iYWJpbGlzdGljKVxuICAgICAgICAgIGlmIChjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQgJiYgIXNob3VsZFNhbXBsZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5zYW1wbGVkT3V0Kys7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBUcmFjayBjYXB0dXJlZCBldmVudCBicmVha2Rvd25zXG4gICAgICAgICAgY2FwdHVyZWRCeVR5cGVbZXZlbnQudHlwZV0gPSAoY2FwdHVyZWRCeVR5cGVbZXZlbnQudHlwZV0gfHwgMCkgKyAxO1xuICAgICAgICAgIGlmIChldmVudC5vcGVyYXRpb24pIHtcbiAgICAgICAgICAgIGNhcHR1cmVkQnlPcGVyYXRpb25bZXZlbnQub3BlcmF0aW9uXSA9IChjYXB0dXJlZEJ5T3BlcmF0aW9uW2V2ZW50Lm9wZXJhdGlvbl0gfHwgMCkgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYXB0dXJlZEJ5TGV2ZWxbZXZlbnQubGV2ZWxdID0gKGNhcHR1cmVkQnlMZXZlbFtldmVudC5sZXZlbF0gfHwgMCkgKyAxO1xuICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgICAgICAgIC8vIFBhc3NlZCBib3RoIGZpbHRlcmluZyBhbmQgc2FtcGxpbmcgLSBlbWl0XG4gICAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgICAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFN0b3JlIGNhcHR1cmVkIGJyZWFrZG93bnMgaW4gY29udGV4dCBmb3Igc3VtbWFyeSBjaGVja3BvaW50XG4gICAgICAgIGlmICghb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24pIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93biA9IHsgYnlUeXBlOiB7fSwgYnlPcGVyYXRpb246IHt9LCBieUxldmVsOiB7fSB9O1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgWyB0eXBlLCBjb3VudCBdIG9mIE9iamVjdC5lbnRyaWVzKGNhcHR1cmVkQnlUeXBlKSkge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5VHlwZVsgdHlwZSBdID0gKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5VHlwZVsgdHlwZSBdIHx8IDApICsgY291bnQ7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBbIG9wLCBjb3VudCBdIG9mIE9iamVjdC5lbnRyaWVzKGNhcHR1cmVkQnlPcGVyYXRpb24pKSB7XG4gICAgICAgICAgb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlPcGVyYXRpb25bIG9wIF0gPSAob2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlPcGVyYXRpb25bIG9wIF0gfHwgMCkgKyBjb3VudDtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFsgbGV2ZWwsIGNvdW50IF0gb2YgT2JqZWN0LmVudHJpZXMoY2FwdHVyZWRCeUxldmVsKSkge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5TGV2ZWxbIGxldmVsIF0gPSAob2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24uYnlMZXZlbFsgbGV2ZWwgXSB8fCAwKSArIGNvdW50O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBJZiBlcnJvck9jY3VycmVkPXRydWUsIGJ1ZmZlciB3YXMgYWxyZWFkeSBmbHVzaGVkIGR1cmluZyBjYXB0dXJlXG4gICAgfVxuXG4gICAgLy8gRmx1c2ggYWxsIGJhY2tlbmRzIHdpdGggcmV0cnkgbG9naWNcbiAgICAvLyBXcmFwIGVhY2ggYmFja2VuZCBmbHVzaCBpbiB0cnktY2F0Y2ggdG8gZW5zdXJlIGFsbCBiYWNrZW5kcyBhdHRlbXB0IHRvIGZsdXNoXG4gICAgLy8gZXZlbiBpZiBvbmUgZmFpbHMgY2F0YXN0cm9waGljYWxseVxuICAgIGNvbnN0IE1BWF9GTFVTSF9SRVRSSUVTID0gMjtcbiAgICBjb25zdCBmbHVzaFByb21pc2VzID0gYmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIWJhY2tlbmQuZmx1c2gpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBhdHRlbXB0ID0gMTsgYXR0ZW1wdCA8PSBNQVhfRkxVU0hfUkVUUklFUzsgYXR0ZW1wdCsrKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcbiAgICAgICAgICAgIGJyZWFrOyAvLyBTdWNjZXNzXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGlmIChhdHRlbXB0ID09PSBNQVhfRkxVU0hfUkVUUklFUykge1xuICAgICAgICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGZhaWxlZCBhZnRlciAke2F0dGVtcHR9IGF0dGVtcHRzOmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgLy8gRXZlbnRzIG1heSBiZSBsb3N0LCBidXQgd2UndmUgZG9uZSBvdXIgYmVzdFxuICAgICAgICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGFsbG93IG90aGVyIGJhY2tlbmRzIHRvIGZsdXNoXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIChhdHRlbXB0ICR7YXR0ZW1wdH0vJHtNQVhfRkxVU0hfUkVUUklFU30pLCByZXRyeWluZy4uLmAsIGVycm9yKTtcbiAgICAgICAgICAgICAgLy8gU2ltcGxlIGV4cG9uZW50aWFsIGJhY2tvZmZcbiAgICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDEwMCAqIGF0dGVtcHQpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENhdGNoIGFueSB1bmV4cGVjdGVkIGVycm9ycyBvdXRzaWRlIHRoZSByZXRyeSBsb29wXG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggY29tcGxldGVseSBmYWlsZWQ6YCwgZXJyb3IpO1xuICAgICAgICAvLyBEb24ndCB0aHJvdyAtIGFsbG93IG90aGVyIGJhY2tlbmRzIHRvIGZsdXNoXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChmbHVzaFByb21pc2VzKTtcblxuICAgIGxvZ2dlci5kZWJ1ZygnPT09IEZMVVNIIENPTVBMRVRFID09PScpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IG1hbmFnZXIgc3RhdGUgKGZvciB0ZXN0aW5nKVxuICAgKi9cbiAgc3RhdGljIHJlc2V0KCk6IHZvaWQge1xuICAgIGNvbmZpZyA9IG51bGw7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcobnVsbCk7XG4gICAgYmFja2VuZHMgPSBbXTtcbiAgICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICAgIGludm9jYXRpb25Db3VudCA9IDA7XG4gICAgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuY2xlYXIoKTtcbiAgICBwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGggPSAwO1xuICAgIHJlc2V0Q2FwdHVyZXIoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciB0ZXN0aW5nIHdpdGggbW9jayBjb25maWcgYW5kIGJhY2tlbmRzXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZUZvclRlc3RpbmcoXG4gICAgdGVzdENvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgICB0ZXN0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXVxuICApOiB2b2lkIHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICAgIGNvbmZpZyA9IHRlc3RDb25maWc7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcodGVzdENvbmZpZyk7XG4gICAgYmFja2VuZHMgPSB0ZXN0QmFja2VuZHM7XG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIExhbWJkYSBoYW5kbGVyIHdyYXBwZXIgd2l0aCBvYnNlcnZhYmlsaXR5IGxpZmVjeWNsZSBtYW5hZ2VtZW50XG4gKi9cbmV4cG9ydCBjb25zdCB3aXRoT2JzZXJ2YWJpbGl0eSA9IDxUIGV4dGVuZHMgKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gUHJvbWlzZTx1bmtub3duPj4oaGFuZGxlcjogVCk6IFQgPT4ge1xuICByZXR1cm4gKGFzeW5jICguLi5hcmdzOiBQYXJhbWV0ZXJzPFQ+KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlciguLi5hcmdzKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9XG4gIH0pIGFzIFQ7XG59O1xuXG5leHBvcnQgY29uc3QgT2JzZXJ2ZXIgPSBPYnNlcnZhYmlsaXR5TWFuYWdlcjtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBURVNUIEVYUE9SVFMgLSBPbmx5IGZvciB0ZXN0aW5nIGludGVybmFsIGZ1bmN0aW9uc1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogRXhwb3J0IHByaXZhdGUgZnVuY3Rpb25zIGZvciB0ZXN0aW5nLlxuICogVGhlc2Ugc2hvdWxkIE9OTFkgYmUgdXNlZCBpbiB0ZXN0IGZpbGVzLlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjb25zdCBfX3Rlc3RfXyA9IHtcbiAgZXZpY3RMb3dlc3RQcmlvcml0eSxcbiAgc2hvdWxkRmlsdGVyLFxuICBzaG91bGRTYW1wbGUsXG4gIGdldEV2ZW50UHJpb3JpdHksXG4gIGJ1aWxkRXZlbnQsXG59O1xuIl19