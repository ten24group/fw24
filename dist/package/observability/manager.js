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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILHVEQUFrRjtBQUNsRix3Q0FBMEM7QUFDMUMsbUNBVWlCO0FBR2pCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELGlFQUFvRTtBQUNwRSx1Q0FBd0U7QUFDeEUsMkNBQXFFO0FBQ3JFLDhCQUFvQztBQUNwQyx5Q0FBb0Q7QUFDcEQsdURBQTJFO0FBQzNFLHlEQUFpRTtBQUVqRSxxQ0FBb0Y7QUFDcEYsbURBQXlHO0FBQ3pHLHlEQUF1RTtBQUV2RSxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQU9wRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxJQUFJLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0FBQzlDLElBQUksUUFBUSxHQUEyQixFQUFFLENBQUM7QUFDMUMsSUFBSSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQWtELENBQUM7QUFDL0UsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztBQUN4QixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBQ3JELE1BQU0saUJBQWlCLEdBQW9CLEVBQUUsQ0FBQyxDQUFDLDZDQUE2QztBQUU1Rjs7O0dBR0c7QUFDSCxNQUFNLFlBQVksR0FBc0IsRUFBRSxDQUFDO0FBRTNDLDhFQUE4RTtBQUM5RSw4QkFBOEI7QUFDOUIsOEVBQThFO0FBRTlFOzs7Ozs7R0FNRztBQUNILFNBQVMsbUJBQW1CLENBQUMsYUFBc0M7SUFDakUsTUFBTSxNQUFNLEdBQXlCLEVBQUUsQ0FBQztJQUV4QyxLQUFLLE1BQU0sT0FBTyxJQUFJLGFBQWEsRUFBRSxDQUFDO1FB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UUFDMUMsUUFBUSxHQUFHLFlBQVksQ0FBQztRQUN4QixXQUFXLEdBQUcsSUFBSSxDQUFDO1FBRW5CLElBQUEseUJBQWtCLEVBQUM7WUFDakIsT0FBTyxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ3ZELFlBQVksRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQztTQUNsRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsZ0JELG9EQWtnQkM7QUFFRDs7R0FFRztBQUNJLE1BQU0saUJBQWlCLEdBQUcsQ0FBcUQsT0FBVSxFQUFLLEVBQUU7SUFDckcsT0FBTyxDQUFDLEtBQUssRUFBRSxHQUFHLElBQW1CLEVBQUUsRUFBRTtRQUN2QyxJQUFJLENBQUM7WUFDSCxvQkFBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzVDLE9BQU8sTUFBTSxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUNoQyxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLG9CQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDLENBQU0sQ0FBQztBQUNWLENBQUMsQ0FBQztBQVRXLFFBQUEsaUJBQWlCLHFCQVM1QjtBQUVXLFFBQUEsUUFBUSxHQUFHLG9CQUFvQixDQUFDO0FBRTdDLDhFQUE4RTtBQUM5RSxxREFBcUQ7QUFDckQsOEVBQThFO0FBRTlFOzs7O0dBSUc7QUFDVSxRQUFBLFFBQVEsR0FBRztJQUN0QixtQkFBbUI7SUFDbkIsWUFBWTtJQUNaLFlBQVk7SUFDWixnQkFBZ0I7SUFDaEIsVUFBVTtDQUNYLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHlNYW5hZ2VyIC0gQ29yZSBPYnNlcnZlciBmb3IgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtXG4gKiBcbiAqIEFsbCBjb25maWcgYW5kIGJhY2tlbmRzIHJlc29sdmVkIGZyb20gREkgLSBubyBtYW51YWwgaW5zdGFudGlhdGlvbi5cbiAqL1xuXG5pbXBvcnQgeyBnZW5lcmF0ZVNwYW5JZCwgZ2VuZXJhdGVPYnNlcnZhYmlsaXR5TG9nSWQgfSBmcm9tICcuL3V0aWxzL2lkLWdlbmVyYXRvcic7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7XG4gIENhcHR1cmVDb250cm9sLFxuICBDYXB0dXJlSW5wdXQsXG4gIHR5cGUgT2JzZXJ2YWJpbGl0eUJhY2tlbmROYW1lLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdSdWxlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgU3BhbkxpZmVjeWNsZUhvb2sgfSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvdHlwZXMnO1xuaW1wb3J0IHsgc3RyaW5nVG9MZXZlbCwgbGV2ZWxUb1N0cmluZyB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuaW1wb3J0IHsgZGV0ZWN0U291cmNlLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuaW1wb3J0IHsgY29tcHV0ZUVycm9yRmluZ2VycHJpbnQgfSBmcm9tICcuL3V0aWxzL2Vycm9yLWZpbmdlcnByaW50JztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0LCBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMgfSBmcm9tICcuL2NvbnRleHQnO1xuaW1wb3J0IHsgaW5pdGlhbGl6ZUNhcHR1cmVyLCByZXNldENhcHR1cmVyIH0gZnJvbSAnLi9vYnNlcnZlcnMvYmFzZSc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IE5vUHJvdmlkZXJGb3VuZEVycm9yIH0gZnJvbSAnLi4vZGkvZXJyb3JzJztcbmltcG9ydCB7IGFwcGx5Tm9pc2VSZWR1Y3Rpb24sIHR5cGUgRW1pdHRlZEV2ZW50IH0gZnJvbSAnLi9ub2lzZS1yZWR1Y3Rpb24nO1xuaW1wb3J0IHsgZ3JvdXBDaGVja3BvaW50c0J5T3BlcmF0aW9uIH0gZnJvbSAnLi9zcGFuLWNvbXByZXNzaW9uJztcbmltcG9ydCB7IGJ1aWxkVHJhY2VHcmFwaCB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZywgdHlwZSBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQgfSBmcm9tICcuL2NvbmZpZyc7XG5pbXBvcnQgeyBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgcnVuU3BhbkZpbmFsaXplciwgc2V0U3BhbkxpZmVjeWNsZUhvb2tzIH0gZnJvbSAnLi9ydW50aW1lLXN0YXRlJztcbmltcG9ydCB7IG1hdGNoZXNQYXR0ZXJuLCByZXBsYWNlUGF0dGVybiB9IGZyb20gJy4vdXRpbHMvcGF0dGVybi11dGlscyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2YWJpbGl0eU1hbmFnZXInKTtcblxuaW50ZXJmYWNlIFZhbGlkYXRpb25FcnJvciB7XG4gIGZpZWxkOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIE1PRFVMRSBTVEFURVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmxldCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsID0gbnVsbDtcbmxldCBiYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdO1xubGV0IGJhY2tlbmRDb25maWdzID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlDb25maWdbICdiYWNrZW5kcycgXVsgMCBdPigpO1xubGV0IGludm9jYXRpb25Db3VudCA9IDA7XG5sZXQgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbmNvbnN0IHNhbXBsaW5nUmVnZXhDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWdFeHA+KCk7XG5jb25zdCBwZW5kaW5nRGlzcGF0Y2hlczogUHJvbWlzZTx2b2lkPltdID0gW107IC8vIFRyYWNrIGZpcmUtYW5kLWZvcmdldCBwcm9taXNlcyBmb3IgZmx1c2goKVxuXG4vKipcbiAqIFByZS1pbml0aWFsaXphdGlvbiBob29rcyAtIGNhbGxiYWNrcyB0aGF0IHJ1biBiZWZvcmUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLlxuICogVXNlZCB0byByZWdpc3RlciBzY2hlbWFzL3NlcnZpY2VzIG5lZWRlZCBieSBiYWNrZW5kcyB3aXRob3V0IGNpcmN1bGFyIGRlcGVuZGVuY2llcy5cbiAqL1xuY29uc3QgcHJlSW5pdEhvb2tzOiBBcnJheTwoKSA9PiB2b2lkPiA9IFtdO1xuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIE5PSVNFIFJFRFVDVElPTiBJTlRFR1JBVElPTlxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbi8qKlxuICogVW5wYWNrIEVtaXR0ZWRFdmVudFtdIGZyb20gbm9pc2UgcmVkdWN0aW9uIGludG8gT2JzZXJ2YWJpbGl0eUV2ZW50W10uXG4gKiBcbiAqIEZvciBlYWNoIGVtaXR0ZWQgZXZlbnQ6XG4gKiAtIFNldHMgYF9hYnNvcmJlZGAgaWYgdGhlcmUgaXMgYWJzb3JiZWQgZGF0YVxuICogLSBSZXNvbHZlcyBgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkYCB0byB0aGUgbmVhcmVzdCBlbWl0dGVkIGFuY2VzdG9yXG4gKi9cbmZ1bmN0aW9uIHVucGFja0VtaXR0ZWRFdmVudHMoZW1pdHRlZEV2ZW50czogcmVhZG9ubHkgRW1pdHRlZEV2ZW50W10pOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSB7XG4gIGNvbnN0IHJlc3VsdDogT2JzZXJ2YWJpbGl0eUV2ZW50W10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGVtaXR0ZWQgb2YgZW1pdHRlZEV2ZW50cykge1xuICAgIC8vIENyZWF0ZSBhIHNoYWxsb3cgY29weSB0byBhdm9pZCBtdXRhdGluZyB0aGUgb3JpZ2luYWwgZXZlbnRcbiAgICBjb25zdCBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50ID0geyAuLi5lbWl0dGVkLmV2ZW50IH07XG5cbiAgICAvLyBNZXJnZSBhYnNvcmJlZCBkYXRhIGludG8gZXZlbnQuZGF0YSAoc2luZ2xlIGxvY2F0aW9uLCBubyBzZXBhcmF0ZSB0b3AtbGV2ZWwgZmllbGQpXG4gICAgaWYgKGVtaXR0ZWQuYWJzb3JiZWQpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nRGF0YSA9IGV2ZW50LmRhdGEgPz8ge307XG5cbiAgICAgIC8vIENvbnZlcnQgYWJzb3JiZWQgY2hlY2twb2ludHMgaW50byBHUk9VUEVEIHRpbWVsaW5lIGVudHJpZXMgKEVsYXN0aWMgQVBNIHNwYW4gY29tcHJlc3Npb24gcGF0dGVybikuXG4gICAgICAvLyBJbnN0ZWFkIG9mIE4gaW5kaXZpZHVhbCBlbnRyaWVzIGZvciBcIkJhc2VFbnRpdHlTZXJ2aWNlLnVwc2VydFwiLCBwcm9kdWNlcyBPTkUgY29tcG9zaXRlIGVudHJ5XG4gICAgICAvLyB3aXRoIGFnZ3JlZ2F0ZSBzdGF0cyBhbmQgYSBjb21wYWN0IGl0ZW1zIGFycmF5IG9mIHBlci1pdGVtIHZhcnlpbmcgZmllbGRzLlxuICAgICAgbGV0IGNoZWNrcG9pbnRzID0gKGV4aXN0aW5nRGF0YS5jaGVja3BvaW50cyBhcyB1bmtub3duW10pID8/IFtdO1xuICAgICAgaWYgKGVtaXR0ZWQuYWJzb3JiZWQuY2hlY2twb2ludHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBncm91cGVkRW50cmllcyA9IGdyb3VwQ2hlY2twb2ludHNCeU9wZXJhdGlvbihlbWl0dGVkLmFic29yYmVkLmNoZWNrcG9pbnRzKTtcbiAgICAgICAgY2hlY2twb2ludHMgPSBbIC4uLmNoZWNrcG9pbnRzLCAuLi5ncm91cGVkRW50cmllcyBdO1xuICAgICAgfVxuXG4gICAgICAvLyBTdG9yZSBhYnNvcmJlZCBzdW1tYXJ5IOKAlCBzdHJpcHBlZCBvZiBieU9wZXJhdGlvbiwgZW50aXR5SWRzLCBhbmQgY2hlY2twb2ludHNcbiAgICAgIC8vIHNpbmNlIGdyb3VwZWQgY2hlY2twb2ludCBlbnRyaWVzIG5vdyBjYXJyeSB0aGF0IGluZm9ybWF0aW9uLlxuICAgICAgY29uc3QgYWJzb3JiZWRTdW1tYXJ5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgICAgY291bnQ6IGVtaXR0ZWQuYWJzb3JiZWQuY291bnQsXG4gICAgICAgIHNpbGVudENvdW50OiBlbWl0dGVkLmFic29yYmVkLnNpbGVudENvdW50LFxuICAgICAgfTtcbiAgICAgIGlmIChlbWl0dGVkLmFic29yYmVkLmVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGFic29yYmVkU3VtbWFyeS5lcnJvcnMgPSBlbWl0dGVkLmFic29yYmVkLmVycm9ycztcbiAgICAgIH1cbiAgICAgIGlmIChlbWl0dGVkLmFic29yYmVkLmNhdXNlZEJ5TGlua3MubGVuZ3RoID4gMCkge1xuICAgICAgICBhYnNvcmJlZFN1bW1hcnkuY2F1c2VkQnlMaW5rcyA9IGVtaXR0ZWQuYWJzb3JiZWQuY2F1c2VkQnlMaW5rcztcbiAgICAgIH1cblxuICAgICAgZXZlbnQuZGF0YSA9IHtcbiAgICAgICAgLi4uZXhpc3RpbmdEYXRhLFxuICAgICAgICBjaGVja3BvaW50czogY2hlY2twb2ludHMubGVuZ3RoID4gMCA/IGNoZWNrcG9pbnRzIDogdW5kZWZpbmVkLFxuICAgICAgICBhYnNvcmJlZDogYWJzb3JiZWRTdW1tYXJ5LFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBdHRhY2ggbm9pc2UgcmVkdWN0aW9uIGRlYnVnIGluZm8gaWYgcHJlc2VudFxuICAgIGlmIChlbWl0dGVkLmRlYnVnSW5mbykge1xuICAgICAgZXZlbnQuZGF0YSA9IHtcbiAgICAgICAgLi4uKGV2ZW50LmRhdGEgPz8ge30pLFxuICAgICAgICBfbm9pc2VEZWJ1ZzogZW1pdHRlZC5kZWJ1Z0luZm8sXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgcGFyZW50IElEIHRvIG5lYXJlc3QgZW1pdHRlZCBhbmNlc3Rvci5cbiAgICAvLyBUaGUgYWxnb3JpdGhtJ3MgcmVzb2x2ZWRQYXJlbnRJZCBpcyBhdXRob3JpdGF0aXZlIHdoZW4gcHJlc2VudC5cbiAgICBpZiAoZW1pdHRlZC5yZXNvbHZlZFBhcmVudElkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIEFsZ29yaXRobSByZXNvbHZlZCBhIHNwZWNpZmljIGVtaXR0ZWQgYW5jZXN0b3JcbiAgICAgIGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IGVtaXR0ZWQucmVzb2x2ZWRQYXJlbnRJZDtcbiAgICB9IGVsc2UgaWYgKGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkge1xuICAgICAgLy8gcmVzb2x2ZWRQYXJlbnRJZCBpcyB1bmRlZmluZWQg4oCUIGNoZWNrIGlmIHRoZSBvcmlnaW5hbCBwYXJlbnQgaXMgb3V0c2lkZSB0aGlzIGJhdGNoXG4gICAgICBjb25zdCBwYXJlbnRJbkJhdGNoID0gZW1pdHRlZEV2ZW50cy5zb21lKGUgPT4gZS5ldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQgPT09IGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCk7XG4gICAgICBpZiAoIXBhcmVudEluQmF0Y2gpIHtcbiAgICAgICAgLy8gUGFyZW50IGlzIG91dHNpZGUgdGhpcyBiYXRjaCAoY3Jvc3MtYmF0Y2gpIOKAlCBrZWVwIG9yaWdpbmFsIGZvciBsaW5raW5nXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBQYXJlbnQgd2FzIGluIGJhdGNoIGJ1dCBhYnNvcmJlZC9zaWxlbmNlZCDigJQgY2xlYXIgc3RhbGUgcmVmZXJlbmNlXG4gICAgICAgIGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXN1bHQucHVzaChldmVudCk7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBTcGFuIGNvbXByZXNzaW9uIChncm91cENoZWNrcG9pbnRzQnlPcGVyYXRpb24pIGV4dHJhY3RlZCB0byAuL3NwYW4tY29tcHJlc3Npb24udHNcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIEhFTFBFUiBGVU5DVElPTlNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5mdW5jdGlvbiB2YWxpZGF0ZUlucHV0KGlucHV0OiBDYXB0dXJlSW5wdXQpOiBWYWxpZGF0aW9uRXJyb3JbXSB7XG4gIGNvbnN0IGVycm9yczogVmFsaWRhdGlvbkVycm9yW10gPSBbXTtcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgaWYgKCFpbnB1dC50eXBlKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ3R5cGUnLCBtZXNzYWdlOiAndHlwZSBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmxldmVsKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ2xldmVsJywgbWVzc2FnZTogJ2xldmVsIGlzIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGlmICghaW5wdXQuY29ycmVsYXRpb25JZCAmJiAhY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgIGVycm9ycy5wdXNoKHtcbiAgICAgIGZpZWxkOiAnY29ycmVsYXRpb25JZCcsXG4gICAgICBtZXNzYWdlOiAnY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZC4gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzLCBvciB1c2UgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoKS4nXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuXG5mdW5jdGlvbiBhcHBseURhdGFQcm90ZWN0aW9uKFxuICBpbnB1dDogQ2FwdHVyZUlucHV0LFxuICBkYXRhUHJvdGVjdGlvbj86IE9ic2VydmFiaWxpdHlDb25maWdbICdkYXRhUHJvdGVjdGlvbicgXVxuKToge1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBlcnJvcj86IE9ic2VydmFiaWxpdHlFcnJvcjtcbn0ge1xuICBpZiAoIWRhdGFQcm90ZWN0aW9uPy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6IGlucHV0LmRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgICAgbWV0YWRhdGE6IGlucHV0Lm1ldGFkYXRhLFxuICAgICAgY29udGV4dDogaW5wdXQuY29udGV4dCxcbiAgICAgIGVycm9yOiBpbnB1dC5lcnJvcixcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZmllbGRzID0gZGF0YVByb3RlY3Rpb24uZmllbGRzID8/IFsgJ2RhdGEnLCAnYXR0cmlidXRlcycsICdtZXRhZGF0YScsICdjb250ZXh0JyBdO1xuXG4gIHJldHVybiB7XG4gICAgZGF0YTogZmllbGRzLmluY2x1ZGVzKCdkYXRhJykgJiYgaW5wdXQuZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5kYXRhLFxuICAgIGF0dHJpYnV0ZXM6IGZpZWxkcy5pbmNsdWRlcygnYXR0cmlidXRlcycpICYmIGlucHV0LmF0dHJpYnV0ZXNcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5hdHRyaWJ1dGVzLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuYXR0cmlidXRlcyxcbiAgICBtZXRhZGF0YTogZmllbGRzLmluY2x1ZGVzKCdtZXRhZGF0YScpICYmIGlucHV0Lm1ldGFkYXRhXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQubWV0YWRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5tZXRhZGF0YSxcbiAgICBjb250ZXh0OiBmaWVsZHMuaW5jbHVkZXMoJ2NvbnRleHQnKSAmJiBpbnB1dC5jb250ZXh0XG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuY29udGV4dCwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmNvbnRleHQsXG4gICAgZXJyb3I6IGZpZWxkcy5pbmNsdWRlcygnZXJyb3InKSAmJiBpbnB1dC5lcnJvclxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmVycm9yLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZXJyb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRXZlbnQoaW5wdXQ6IENhcHR1cmVJbnB1dCwgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+IHwgbnVsbCA9IG51bGwpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBjb25zdCBjdHggPSBjb250ZXh0ID8/IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG5cbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGlucHV0LmNvcnJlbGF0aW9uSWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgLSB0aGlzIHNob3VsZCBoYXZlIGJlZW4gY2F1Z2h0IGJ5IHZhbGlkYXRpb24nKTtcbiAgfVxuXG4gIGNvbnN0IHsgZGF0YSwgYXR0cmlidXRlcywgbWV0YWRhdGEsIGNvbnRleHQ6IGV2ZW50Q29udGV4dCwgZXJyb3IgfSA9IGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gICAgaW5wdXQsXG4gICAgY29uZmlnPy5kYXRhUHJvdGVjdGlvblxuICApO1xuXG4gIC8vIE9wZXJhdGlvbiBub3JtYWxpemF0aW9uIChyZWR1Y2UgY2FyZGluYWxpdHkgKyBpbXByb3ZlIGNyb3NzLWJhY2tlbmQgY29uc2lzdGVuY3kpXG4gIGNvbnN0IG9wTm9ybSA9IGNvbmZpZz8ub3BlcmF0aW9uTm9ybWFsaXphdGlvbjtcbiAgbGV0IG9wZXJhdGlvbiA9IGlucHV0Lm9wZXJhdGlvbjtcbiAgbGV0IG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKG9wTm9ybT8uZW5hYmxlZCAmJiBvcGVyYXRpb24pIHtcbiAgICBjb25zdCBvcmlnaW5hbE9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICBjb25zdCBhcHBsaWVkUnVsZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgZnJvbTogc3RyaW5nOyB0bzogc3RyaW5nOyByZWFzb24/OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCB0eXBlTWF0Y2ggPSAoXG4gICAgICBydWxlVHlwZXM6IE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdWyAncnVsZXMnIF1bIG51bWJlciBdWyAndHlwZXMnIF0gfCB1bmRlZmluZWQsXG4gICAgICBldmVudFR5cGU6IHN0cmluZ1xuICAgICkgPT4ge1xuICAgICAgaWYgKCFydWxlVHlwZXMpIHJldHVybiB0cnVlO1xuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShydWxlVHlwZXMpID8gcnVsZVR5cGVzIDogWyBydWxlVHlwZXMgXTtcbiAgICAgIC8vIENvbXBhcmUgYnkgc3RyaW5nIHRvIGF2b2lkIHVuc2FmZSBjYXN0aW5nIChPYnNlcnZhYmlsaXR5RXZlbnRUeXBlIGlzIHN0cmluZy1iYXNlZCBhbnl3YXkpLlxuICAgICAgcmV0dXJuIGFyci5tYXAoU3RyaW5nKS5pbmNsdWRlcyhldmVudFR5cGUpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2Ygb3BOb3JtLnJ1bGVzID8/IFtdKSB7XG4gICAgICBpZiAoIXR5cGVNYXRjaChydWxlLnR5cGVzLCBpbnB1dC50eXBlKSkgY29udGludWU7XG4gICAgICBpZiAoIW1hdGNoZXNQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgbmV4dCA9IHJlcGxhY2VQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCwgcnVsZS5yZXBsYWNlKTtcbiAgICAgIGlmIChuZXh0ICE9PSBvcGVyYXRpb24pIHtcbiAgICAgICAgYXBwbGllZFJ1bGVzLnB1c2goeyBpZDogcnVsZS5pZCwgZnJvbTogb3BlcmF0aW9uLCB0bzogbmV4dCwgcmVhc29uOiBydWxlLnJlYXNvbiB9KTtcbiAgICAgICAgb3BlcmF0aW9uID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPbmx5IGF0dGFjaCBtZXRhIGlmIHRoZSBvcGVyYXRpb24gYWN0dWFsbHkgY2hhbmdlZFxuICAgIGlmIChvcE5vcm0uc3RvcmVPcmlnaW5hbCAhPT0gZmFsc2UgJiYgb3BlcmF0aW9uICE9PSBvcmlnaW5hbE9wZXJhdGlvbikge1xuICAgICAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgPSB7XG4gICAgICAgIGZyb206IG9yaWdpbmFsT3BlcmF0aW9uLFxuICAgICAgICB0bzogb3BlcmF0aW9uLFxuICAgICAgICBydWxlSWRzOiBhcHBsaWVkUnVsZXMubWFwKHIgPT4gci5pZCksXG4gICAgICAgIHJ1bGVzOiBhcHBsaWVkUnVsZXMsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIE1lcmdlIHRhZ3M6IGNvbnRleHQgKyBpbnB1dCArIHNsb3cgYXV0by10YWdcbiAgbGV0IG1lcmdlZFRhZ3MgPSBtZXJnZVRhZ3MoeyAuLi5jdHg/Lm9ic2VydmFiaWxpdHk/LnRhZ3MsIC4uLmlucHV0LnRhZ3MgfSwgdHJ1ZSk7XG5cbiAgLy8gU2xvdyByZXF1ZXN0IGF1dG8tdGFnZ2luZzogbWFyayBzcGFucyBleGNlZWRpbmcgdGhlIGNvbmZpZ3VyZWQgdGhyZXNob2xkXG4gIGNvbnN0IHNsb3dUaHJlc2hvbGQgPSBjb25maWc/LnNwYW5zPy5zbG93VGFnVGhyZXNob2xkTXM7XG4gIGlmIChzbG93VGhyZXNob2xkICE9IG51bGwgJiYgaW5wdXQuZHVyYXRpb25NcyAhPSBudWxsICYmIGlucHV0LmR1cmF0aW9uTXMgPiBzbG93VGhyZXNob2xkKSB7XG4gICAgbWVyZ2VkVGFncyA9IHsgLi4uKG1lcmdlZFRhZ3MgPz8ge30pLCBfc2xvdzogJ3RydWUnIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgbGV2ZWw6IGlucHV0LmxldmVsLFxuICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgdGltZXN0YW1wTXM6IGlucHV0LnRpbWVzdGFtcE1zID8/IG5vdyxcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0Lm9ic2VydmFiaWxpdHlMb2dJZCA/PyBnZW5lcmF0ZU9ic2VydmFiaWxpdHlMb2dJZChjb3JyZWxhdGlvbklkKSxcbiAgICAvLyBudWxsID0gZXhwbGljaXRseSBubyBwYXJlbnQgLSBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgc2hvdWxkIGJlIHJlc29sdmVkIGJ5IGNhbGxlciAoc3BhbiB0cmVlKVxuICAgIC8vIHVuZGVmaW5lZCA9IHVzZSB3aGF0IHdhcyBwcm92aWRlZFxuICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSBudWxsID8gdW5kZWZpbmVkIDogaW5wdXQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgIGNhdXNlZEJ5OiBpbnB1dC5jYXVzZWRCeSxcbiAgICByZWxhdGVkVHJhY2VzOiBpbnB1dC5yZWxhdGVkVHJhY2VzLFxuICAgIGFjdG9yOiBpbnB1dC5hY3RvciA/PyBjdHg/LmFjdG9yLFxuICAgIHNvdXJjZTogaW5wdXQuc291cmNlID8/IGN0eD8ub2JzZXJ2YWJpbGl0eT8uc291cmNlID8/IGRldGVjdFNvdXJjZSgpLFxuICAgIHRhZ3M6IG1lcmdlZFRhZ3MsXG4gICAgZW50aXR5TmFtZTogaW5wdXQuZW50aXR5TmFtZSxcbiAgICBlbnRpdHlJZDogaW5wdXQuZW50aXR5SWQsXG4gICAgb3BlcmF0aW9uLFxuICAgIHN1YlR5cGU6IGlucHV0LnN1YlR5cGUsXG4gICAgc3RhdHVzOiBpbnB1dC5zdGF0dXMsXG4gICAgc3VjY2VzczogaW5wdXQuc3VjY2VzcyxcbiAgICBkdXJhdGlvbk1zOiBpbnB1dC5kdXJhdGlvbk1zLFxuICAgIGRhdGE6IG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhXG4gICAgICA/IHsgLi4uKGRhdGEgPz8ge30pLCBvcGVyYXRpb25Ob3JtYWxpemF0aW9uOiBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YSB9XG4gICAgICA6IGRhdGEsXG4gICAgYXR0cmlidXRlcyxcbiAgICBtZXRhZGF0YSxcbiAgICBtZXRyaWNzOiBpbnB1dC5tZXRyaWNzLFxuICAgIGNvbnRleHQ6IGV2ZW50Q29udGV4dCxcbiAgICBlcnJvcixcbiAgICBmaW5nZXJwcmludDogZXJyb3IgPyBjb21wdXRlRXJyb3JGaW5nZXJwcmludChlcnJvcikgOiB1bmRlZmluZWQsXG4gICAgY2FwdHVyZTogaW5wdXQuY2FwdHVyZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXRlZ29yaXplIGV2ZW50IHR5cGUgZm9yIGJhY2tlbmQgcm91dGluZyBhbmQgc2FtcGxpbmdcbiAqIFxuICogQ3VzdG9tIGV2ZW50IHR5cGVzIGFyZSBzdXBwb3J0ZWQhIFVzZSBhbnkgbmFtaW5nIGNvbnZlbnRpb246XG4gKiAtICdidXNpbmVzcy5vcmRlcl9wbGFjZWQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAncGF5bWVudC50cmFuc2FjdGlvbicg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiAtICdub3RpZmljYXRpb24uc2VudCcg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiBcbiAqIFRvIGNvbnRyb2wgYmFja2VuZCByb3V0aW5nIGZvciBjdXN0b20gdHlwZXMsIHVzZSB0eXBlLXNwZWNpZmljIGNvbmZpZzpcbiAqIGBgYFxuICogb2JzZXJ2YWJpbGl0eToge1xuICogICB0eXBlczoge1xuICogICAgIGxvZzogeyBiYWNrZW5kczogWydjbG91ZHdhdGNoJywgJ2R5bmFtb2RiJ10gfVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZnVuY3Rpb24gZ2V0VHlwZUNhdGVnb3J5KHR5cGU6IHN0cmluZyk6ICdzcGFuJyB8ICdtZXRyaWMnIHwgJ2F1ZGl0JyB8ICdsb2cnIHtcbiAgLy8gJ3NwYW4nID0gY29uc29saWRhdGVkIHNwYW4gcmVjb3JkLCAnc3Bhbi5zdGFydCcgPSBPVEVMLW9ubHkgc3RhcnQgbWFya2VyLlxuICAvLyBGVzI0IGRvZXMgTk9UIHN1cHBvcnQgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cyAobm8gY29tcGF0aWJpbGl0eSBndWFyYW50ZWVzKS5cbiAgaWYgKHR5cGUgPT09ICdzcGFuJyB8fCB0eXBlID09PSAnc3Bhbi5zdGFydCcpIHJldHVybiAnc3Bhbic7XG4gIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgLy8gQWxsIGN1c3RvbSBldmVudCB0eXBlcyBkZWZhdWx0IHRvICdsb2cnIGNhdGVnb3J5XG4gIC8vIFRoaXMgaW5jbHVkZXM6ICdidXNpbmVzcy4qJywgJ3BheW1lbnQuKicsICdub3RpZmljYXRpb24uKicsIGV0Yy5cbiAgcmV0dXJuICdsb2cnO1xufVxuXG5mdW5jdGlvbiBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgaWYgKHR5cGVDb25maWc/LmJhY2tlbmRzICYmIHR5cGVDb25maWcuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBiYWNrZW5kcy5maWx0ZXIoKGIpID0+XG4gICAgICB0eXBlQ29uZmlnLmJhY2tlbmRzIS5pbmNsdWRlcyhiLm5hbWUgYXMgT2JzZXJ2YWJpbGl0eUJhY2tlbmROYW1lKSk7XG4gIH1cblxuICByZXR1cm4gYmFja2VuZHM7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYmFja2VuZCBzaG91bGQgY2FwdHVyZSB0aGlzIGV2ZW50IGJhc2VkIG9uIHR5cGUgZmlsdGVyaW5nXG4gKi9cbmZ1bmN0aW9uIHNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShcbiAgYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnRcbik6IGJvb2xlYW4ge1xuICAvLyBQZXItZXZlbnQgYmFja2VuZCBmaWx0ZXIgKHVzZWQgZm9yIE9URUwgc3BhbiB0cmFja2luZyBpbiBjb25zb2xpZGF0ZWQgbW9kZSlcbiAgaWYgKGV2ZW50LmNhcHR1cmU/LmJhY2tlbmRzICYmIGV2ZW50LmNhcHR1cmUuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIGlmICghZXZlbnQuY2FwdHVyZS5iYWNrZW5kcy5pbmNsdWRlcyhiYWNrZW5kLm5hbWUgYXMgT2JzZXJ2YWJpbGl0eUJhY2tlbmROYW1lKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGJhY2tlbmRDZmcgPSBiYWNrZW5kQ29uZmlncy5nZXQoYmFja2VuZC5uYW1lKTtcbiAgaWYgKCFiYWNrZW5kQ2ZnKSByZXR1cm4gdHJ1ZTsgLy8gTm8gY29uZmlnID0gYWxsb3cgYWxsXG5cbiAgY29uc3QgdHlwZUNhdGVnb3J5ID0gZ2V0VHlwZUNhdGVnb3J5KGV2ZW50LnR5cGUpO1xuICBjb25zdCB0eXBlRmlsdGVyID0gYmFja2VuZENmZy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcblxuICAvLyBDaGVjayBpZiB0eXBlIGlzIGV4cGxpY2l0bHkgZGlzYWJsZWQgZm9yIHRoaXMgYmFja2VuZFxuICBpZiAodHlwZUZpbHRlcj8uZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBldmVudExldmVsID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG5cbiAgLy8gQ2hlY2sgcGVyLXR5cGUgbWluTGV2ZWwgKG92ZXJyaWRlcyBiYWNrZW5kLWxldmVsIG1pbkxldmVsKVxuICBpZiAodHlwZUZpbHRlcj8ubWluTGV2ZWwgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudExldmVsIDwgdHlwZUZpbHRlci5taW5MZXZlbCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIGlmIChiYWNrZW5kLm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBGYWxsIGJhY2sgdG8gYmFja2VuZC1sZXZlbCBtaW5MZXZlbFxuICAgIGlmIChldmVudExldmVsIDwgYmFja2VuZC5taW5MZXZlbCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIHBlci10eXBlIHNhbXBsaW5nXG4gIGlmICh0eXBlRmlsdGVyPy5zYW1wbGluZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCB0eXBlRmlsdGVyLnNhbXBsaW5nO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7IC8vIFBhc3NlZCBhbGwgZmlsdGVyc1xufVxuXG4vKipcbiAqIEFwcGx5IHRhZyBmaWx0ZXJpbmcgdG8gZXZlbnQgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHMuXG4gKiBGaWx0ZXJzIGZyYW1ld29yayB0YWdzIGJhc2VkIG9uIGNvbmZpZywgYWRkcyBjdXN0b20gdGFncywgZW5mb3JjZXMgbWF4VGFncyBsaW1pdC5cbiAqL1xuZnVuY3Rpb24gYXBwbHlUYWdGaWx0ZXJpbmcoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gIGlmICghY29uZmlnPy50YWdGaWx0ZXJpbmcpIHJldHVybiBldmVudDtcblxuICBjb25zdCB0YWdDb25maWcgPSBjb25maWcudGFnRmlsdGVyaW5nO1xuICBjb25zdCBpbmNsdWRlID0gdGFnQ29uZmlnLmluY2x1ZGU7XG4gIGNvbnN0IG1heFRhZ3MgPSB0YWdDb25maWcubWF4VGFncyA/PyAxMDtcblxuICAvLyBLbm93biBmcmFtZXdvcmsgdGFnc1xuICBjb25zdCBmcmFtZXdvcmtUYWdzID0gbmV3IFNldChbXG4gICAgJ3N0YWdlJywgJ3RlbmFudElkJywgJ29wZXJhdGlvbkNhdGVnb3J5JywgJ2F1dGhNZXRob2QnLFxuICAgICdhY3RvclR5cGUnLCAnaGFuZGxlclR5cGUnLCAnZW50aXR5TmFtZScsICdvcGVyYXRpb24nXG4gIF0pO1xuXG4gIGNvbnN0IGZpbHRlcmVkVGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBsZXQgdGFnQ291bnQgPSAwO1xuXG4gIC8vIEZpbHRlciBleGlzdGluZyB0YWdzXG4gIGlmIChldmVudC50YWdzKSB7XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC50YWdzKSkge1xuICAgICAgaWYgKHRhZ0NvdW50ID49IG1heFRhZ3MpIGJyZWFrO1xuXG4gICAgICAvLyBGcmFtZXdvcmsgdGFnczogbXVzdCBiZSBpbiBpbmNsdWRlIGFycmF5XG4gICAgICBpZiAoZnJhbWV3b3JrVGFncy5oYXMoa2V5KSkge1xuICAgICAgICBpZiAoaW5jbHVkZSAmJiAhaW5jbHVkZS5pbmNsdWRlcyhrZXkpKSB7XG4gICAgICAgICAgY29udGludWU7IC8vIEV4Y2x1ZGVkXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFVua25vd24gdGFncyAoY3VzdG9tKTogYWx3YXlzIGluY2x1ZGVcblxuICAgICAgLy8gQ29udmVydCB0byBzdHJpbmdcbiAgICAgIGZpbHRlcmVkVGFnc1sga2V5IF0gPSB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnID8gdmFsdWUgOiBTdHJpbmcodmFsdWUpO1xuICAgICAgdGFnQ291bnQrKztcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgY3VzdG9tIHRhZ3MgZnJvbSBjb25maWdcbiAgaWYgKHRhZ0NvbmZpZy5jdXN0b20gJiYgdGFnQ291bnQgPCBtYXhUYWdzKSB7XG4gICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWVGbiBdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ0NvbmZpZy5jdXN0b20pKSB7XG4gICAgICBpZiAodGFnQ291bnQgPj0gbWF4VGFncykgYnJlYWs7XG4gICAgICBpZiAoZmlsdGVyZWRUYWdzWyBrZXkgXSAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gQWxyZWFkeSBleGlzdHNcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZUZuKGV2ZW50KTtcbiAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgZmlsdGVyZWRUYWdzWyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICAgIHRhZ0NvdW50Kys7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBGYWlsZWQgdG8gZXZhbHVhdGUgY3VzdG9tIHRhZyAke2tleX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgLi4uZXZlbnQsXG4gICAgdGFnczogZmlsdGVyZWRUYWdzLFxuICB9O1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdGFyZ2V0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10pOiB2b2lkIHtcbiAgLy8gQXBwbHkgdGFnIGZpbHRlcmluZyBiZWZvcmUgc2VuZGluZyB0byBiYWNrZW5kc1xuICBjb25zdCBmaWx0ZXJlZEV2ZW50ID0gYXBwbHlUYWdGaWx0ZXJpbmcoZXZlbnQpO1xuXG4gIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGZpbHRlcmVkRXZlbnQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShmaWx0ZXJlZEV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApLnRoZW4oKCkgPT4geyB9KTsgLy8gQ29udmVydCB0byBQcm9taXNlPHZvaWQ+XG5cbiAgLy8gVHJhY2sgcHJvbWlzZSBzbyBmbHVzaCgpIGNhbiB3YWl0IGZvciBpdFxuICBwZW5kaW5nRGlzcGF0Y2hlcy5wdXNoKHByb21pc2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogUHJvbWlzZTx2b2lkPiB7XG4gIC8vIEFwcGx5IHRhZyBmaWx0ZXJpbmcgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHNcbiAgY29uc3QgZmlsdGVyZWRFdmVudCA9IGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50KTtcblxuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGZpbHRlcmVkRXZlbnQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShmaWx0ZXJlZEV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGFuIGV2ZW50IG1hdGNoZXMgYSBzYW1wbGluZyBydWxlXG4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNSdWxlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHJ1bGU6IFNhbXBsaW5nUnVsZSk6IGJvb2xlYW4ge1xuICBjb25zdCB7IHRhcmdldCwgcGF0dGVybiB9ID0gcnVsZTtcblxuICBsZXQgdmFsdWVUb01hdGNoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgc3dpdGNoICh0YXJnZXQpIHtcbiAgICBjYXNlICd0ZW5hbnQnOlxuICAgICAgLy8gQ2hlY2sgYWN0b3IudGVuYW50SWQgb3IgdGFncy50ZW5hbnRJZFxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LnRlbmFudElkID8/IGV2ZW50LnRhZ3M/LnRlbmFudElkO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdyb3V0ZSc6XG4gICAgICAvLyBDaGVjayBzb3VyY2UgKGUuZy4sIFwiT3JkZXJDb250cm9sbGVyLmNyZWF0ZVwiKSBvciBvcGVyYXRpb25cbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZSA/PyBldmVudC5vcGVyYXRpb247XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3RhZyc6XG4gICAgICAvLyBQYXR0ZXJuIGZvcm1hdDogXCJrZXk6dmFsdWVcIiBvciBcImtleToqXCJcbiAgICAgIGlmICh0eXBlb2YgcGF0dGVybiA9PT0gJ3N0cmluZycgJiYgcGF0dGVybi5pbmNsdWRlcygnOicpKSB7XG4gICAgICAgIGNvbnN0IFsga2V5LCB2YWx1ZVBhdHRlcm4gXSA9IHBhdHRlcm4uc3BsaXQoJzonLCAyKTtcbiAgICAgICAgY29uc3QgdGFnVmFsdWUgPSBldmVudC50YWdzPy5bIGtleSBdO1xuICAgICAgICBpZiAoIXRhZ1ZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgaWYgKHZhbHVlUGF0dGVybiA9PT0gJyonKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgICAvLyBUZXN0IGFnYWluc3QgdmFsdWUgcGF0dGVybiAoc3VwcG9ydHMgd2lsZGNhcmRzKVxuICAgICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleCh2YWx1ZVBhdHRlcm4pO1xuICAgICAgICByZXR1cm4gcmVnZXgudGVzdCh0YWdWYWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICBjYXNlICdhY3Rvcic6XG4gICAgICAvLyBDaGVjayBhY3RvcklkIG9yIGFjdG9yVHlwZVxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LmFjdG9ySWQgPz8gZXZlbnQuYWN0b3I/LmFjdG9yVHlwZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnc291cmNlJzpcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICghdmFsdWVUb01hdGNoKSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gTWF0Y2ggYWdhaW5zdCBwYXR0ZXJuIChzdHJpbmcgb3IgUmVnRXhwKVxuICBpZiAocGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgIHJldHVybiBwYXR0ZXJuLnRlc3QodmFsdWVUb01hdGNoKTtcbiAgfVxuXG4gIC8vIFN0cmluZyBwYXR0ZXJuIHdpdGggd2lsZGNhcmQgc3VwcG9ydFxuICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgcmV0dXJuIHJlZ2V4LnRlc3QodmFsdWVUb01hdGNoKTtcbn1cblxuLyoqXG4gKiBDb250ZW50LWJhc2VkIGZpbHRlcmluZyAtIEFMV0FZUyBydW5zIHJlZ2FyZGxlc3Mgb2Ygc2FtcGxpbmcuZW5hYmxlZFxuICogUmV0dXJucyB0cnVlIGlmIGV2ZW50IHBhc3NlcyBmaWx0ZXJpbmcgcnVsZXMgKGJ5cGFzcywgbGV2ZWwsIGR1cmF0aW9uLCBldGMuKVxuICogUmV0dXJucyBmYWxzZSBpZiBldmVudCBzaG91bGQgYmUgZmlsdGVyZWQgb3V0LlxuICovXG5mdW5jdGlvbiBzaG91bGRGaWx0ZXIoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgb3B0aW9ucz86IHtcbiAgICAvKipcbiAgICAgKiBXaGVuIHRydWUsIHNwYW5zIG1heSBiZSBkcm9wcGVkIGJhc2VkIG9uIGNmZy5zcGFucy5taW5EdXJhdGlvbk1zLlxuICAgICAqIFdoZW4gZmFsc2UsIHNwYW5zIGFyZSBhbHdheXMga2VwdCAobmVlZGVkIHdoZW4gd2UgY2Fubm90IHNlZSB0aGUgZnVsbCBwYXJlbnQvY2hpbGQgZ3JhcGgpLlxuICAgICAqL1xuICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcD86IGJvb2xlYW47XG4gICAgLyoqXG4gICAgICogUGFyZW50IHNwYW4gSURzIHJlZmVyZW5jZWQgYnkgYnVmZmVyZWQgZXZlbnRzLlxuICAgICAqIElmIGEgc3BhbiBpcyByZWZlcmVuY2VkIGhlcmUsIGl0IG11c3QgTkVWRVIgYmUgZHJvcHBlZC5cbiAgICAgKi9cbiAgICByZWZlcmVuY2VkUGFyZW50U3Bhbklkcz86IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIH1cbik6IGJvb2xlYW4ge1xuICBjb25zdCBsZXZlbFZhbHVlID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuICBjb25zdCBpc1NwYW5SZWNvcmQgPSBldmVudC50eXBlID09PSAnc3Bhbic7XG4gIGNvbnN0IGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9IG9wdGlvbnM/LmFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9PT0gdHJ1ZTtcbiAgY29uc3QgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMgPSBvcHRpb25zPy5yZWZlcmVuY2VkUGFyZW50U3BhbklkcztcblxuICAvLyA9PT0gQllQQVNTIEZJTFRFUlMgKGFsd2F5cyBwYXNzKSA9PT1cblxuICAvLyAxLiBFeHBsaWNpdCBieXBhc3MgZmxhZ1xuICBpZiAoY2FwdHVyZT8uYnlwYXNzKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAyLiBDUklUSUNBTCBsb2cgbGV2ZWwgYWx3YXlzIHBhc3Nlc1xuICBpZiAobGV2ZWxWYWx1ZSA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAzLiBFcnJvcnMgYWx3YXlzIHBhc3NcbiAgaWYgKGV2ZW50LmVycm9yIHx8IGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyA9PT0gU1BBTi1TUEVDSUZJQyBGSUxURVJJTkcgPT09XG4gIGlmIChpc1NwYW5SZWNvcmQpIHtcbiAgICAvLyBSZWZlcmVuY2VkIHBhcmVudHMgbXVzdCBiZSBrZXB0IGZvciBoaWVyYXJjaHkgaW50ZWdyaXR5XG4gICAgY29uc3QgaWQgPSBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKGlkICYmIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzPy5oYXMoaWQpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBGaWx0ZXIgb3V0IGZhc3Qgc3BhbnMgaWYgY29uZmlndXJlZFxuICAgIGlmIChhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3AgJiYgZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBtaW5EdXJhdGlvbiA9IGNhcHR1cmU/Lm1pbkR1cmF0aW9uTXMgPz8gY2ZnLnNwYW5zLm1pbkR1cmF0aW9uTXM7XG4gICAgICBpZiAobWluRHVyYXRpb24gPiAwICYmIGV2ZW50LmR1cmF0aW9uTXMgPCBtaW5EdXJhdGlvbikge1xuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIFRvbyBmYXN0LCBmaWx0ZXIgb3V0XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IE5PTi1TUEFOIERVUkFUSU9OIEZJTFRFUklORyA9PT1cbiAgaWYgKCFpc1NwYW5SZWNvcmQgJiYgY2FwdHVyZT8ubWluRHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zIDwgY2FwdHVyZS5taW5EdXJhdGlvbk1zKSB7XG4gICAgICByZXR1cm4gZmFsc2U7IC8vIEJlbG93IHRocmVzaG9sZCwgZmlsdGVyIG91dFxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBMRVZFTCBGSUxURVJJTkcgPT09XG4gIC8vIFJFTU9WRUQ6IE1hbmFnZXIgbm8gbG9uZ2VyIGZpbHRlcnMgYnkgbWluTGV2ZWxcbiAgLy8gQWxsIGxldmVsLWJhc2VkIGZpbHRlcmluZyBoYXBwZW5zIGluIG5vaXNlIHJlZHVjdGlvbiBmb3IgY29udGV4dC1hd2FyZSBkZWNpc2lvbnNcblxuICAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogUHJvYmFiaWxpc3RpYyBzYW1wbGluZyAtIE9OTFkgcnVucyB3aGVuIHNhbXBsaW5nLmVuYWJsZWQ9dHJ1ZVxuICogUmV0dXJucyB0cnVlIGlmIGV2ZW50IHNob3VsZCBiZSBzYW1wbGVkIChrZXB0KSwgZmFsc2UgaWYgc2FtcGxlZCBvdXQgKGRyb3BwZWQpXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFNhbXBsZShcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnXG4pOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkoZXZlbnQudHlwZSk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuXG4gIC8vID09PSBHUk9VUC1CQVNFRCBTQU1QTElORyAoYmF0Y2ggc2NlbmFyaW9zKSA9PT1cbiAgaWYgKGNhcHR1cmU/Lmdyb3VwKSB7XG4gICAgY29uc3QgeyBpbmRleCwgY2FwdHVyZUZpcnN0ID0gMywgc2FtcGxlUmF0ZSA9IDAuMSB9ID0gY2FwdHVyZS5ncm91cDtcblxuICAgIC8vIENhcHR1cmUgZmlyc3QgTiBpdGVtc1xuICAgIGlmIChpbmRleCA8IGNhcHR1cmVGaXJzdCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIHRoZSByZXN0IHByb2JhYmlsaXN0aWNhbGx5XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBzYW1wbGVSYXRlO1xuICB9XG5cbiAgLy8gPT09IFJVTEUtQkFTRUQgU0FNUExJTkcgKEhpZ2hlc3QgUHJpb3JpdHkpID09PVxuICBpZiAoY2ZnLnNhbXBsaW5nPy5ydWxlcyAmJiBjZmcuc2FtcGxpbmcucnVsZXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcnVsZSBvZiBjZmcuc2FtcGxpbmcucnVsZXMpIHtcbiAgICAgIGlmIChtYXRjaGVzUnVsZShldmVudCwgcnVsZSkpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBydWxlLnJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IFRZUEUtU1BFQ0lGSUMgU0FNUExJTkcgPT09XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG4gIGlmICh0eXBlQ29uZmlnPy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICB9XG5cbiAgLy8gPT09IE9QRVJBVElPTi1CQVNFRCBTQU1QTElORyA9PT1cbiAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjZmcuc2FtcGxpbmc/Lm9wZXJhdGlvbnMpIHtcbiAgICBmb3IgKGNvbnN0IFsgcGF0dGVybiwgcmF0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNmZy5zYW1wbGluZy5vcGVyYXRpb25zKSkge1xuICAgICAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgocGF0dGVybik7XG4gICAgICBpZiAocmVnZXgudGVzdChldmVudC5vcGVyYXRpb24pKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyA9PT0gTEVWRUwtQkFTRUQgU0FNUExJTkcgKEZhbGxiYWNrKSA9PT1cbiAgY29uc3QgbGV2ZWxOYW1lID0gbGV2ZWxUb1N0cmluZyhsZXZlbFZhbHVlKTtcbiAgY29uc3QgcmF0ZSA9IGNmZy5zYW1wbGluZz8ucmF0ZXM/LlsgbGV2ZWxOYW1lIF07XG4gIGlmIChyYXRlID09PSB1bmRlZmluZWQgfHwgcmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJhdGUgPD0gMCkgcmV0dXJuIGZhbHNlO1xuXG4gIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbn1cblxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm46IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGNvbnN0IE1BWF9SRUdFWF9DQUNIRV9TSVpFID0gMTAwO1xuXG4gIGxldCByZWdleCA9IHNhbXBsaW5nUmVnZXhDYWNoZS5nZXQocGF0dGVybik7XG4gIGlmICghcmVnZXgpIHtcbiAgICAvLyBFdmljdCBvbGRlc3QgZW50cnkgaWYgY2FjaGUgaXMgZnVsbCAoRklGTyBldmljdGlvbilcbiAgICBpZiAoc2FtcGxpbmdSZWdleENhY2hlLnNpemUgPj0gTUFYX1JFR0VYX0NBQ0hFX1NJWkUpIHtcbiAgICAgIGNvbnN0IGZpcnN0S2V5ID0gc2FtcGxpbmdSZWdleENhY2hlLmtleXMoKS5uZXh0KCkudmFsdWU7XG4gICAgICBpZiAoZmlyc3RLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuZGVsZXRlKGZpcnN0S2V5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvXFwqL2csICcuKicpfSRgKTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuc2V0KHBhdHRlcm4sIHJlZ2V4KTtcbiAgfVxuICByZXR1cm4gcmVnZXg7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIHByaW9yaXR5IGZvciBidWZmZXIgZXZpY3Rpb24uXG4gKiBIaWdoZXIgcHJpb3JpdHkgPSBrZWVwIGluIGJ1ZmZlclxuICovXG5mdW5jdGlvbiBnZXRFdmVudFByaW9yaXR5KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBudW1iZXIge1xuICAvLyBCeXBhc3MgZXZlbnRzIE5FVkVSIGdldCBldmljdGVkIChtYXggcHJpb3JpdHkpXG4gIGlmIChldmVudC5jYXB0dXJlPy5ieXBhc3MpIHtcbiAgICByZXR1cm4gSW5maW5pdHk7XG4gIH1cblxuICAvLyBVc2UgZXhwbGljaXQgcHJpb3JpdHkgaWYgcHJvdmlkZWRcbiAgbGV0IHByaW9yaXR5ID0gZXZlbnQuY2FwdHVyZT8ucHJpb3JpdHkgPz8gMDtcblxuICBjb25zdCBsZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIEhpZ2hlciBsb2cgbGV2ZWxzID0gaGlnaGVyIHByaW9yaXR5XG4gIHByaW9yaXR5ICs9IGxldmVsICogMTA7XG5cbiAgLy8gQXVkaXQgZXZlbnRzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0JykpIHtcbiAgICBwcmlvcml0eSArPSA1MDtcbiAgfVxuXG4gIC8vIFNwYW5zIHdpdGggZXJyb3JzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ3NwYW4nKSAmJiBldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgIHByaW9yaXR5ICs9IDMwO1xuICB9XG5cbiAgLy8gTG9uZyBkdXJhdGlvbiBvcGVyYXRpb25zIGFyZSBpbnRlcmVzdGluZ1xuICBpZiAoZXZlbnQuZHVyYXRpb25NcyAmJiBldmVudC5kdXJhdGlvbk1zID4gMTAwMCkge1xuICAgIHByaW9yaXR5ICs9IDIwO1xuICB9XG5cbiAgcmV0dXJuIHByaW9yaXR5O1xufVxuXG4vKipcbiAqIEV2aWN0IGxvd2VzdCBwcmlvcml0eSBldmVudCBmcm9tIGJ1ZmZlclxuICogUmV0dXJucyBtZXRhZGF0YSBhYm91dCB0aGUgZXZpY3RlZCBldmVudCBmb3IgbG9nZ2luZ1xuICovXG5mdW5jdGlvbiBldmljdExvd2VzdFByaW9yaXR5KFxuICBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBvcHRpb25zPzogeyBhbGxvd0V2aWN0U3BhbnM/OiBib29sZWFuIH1cbik6IHsgdHlwZTogc3RyaW5nOyBjb3JyZWxhdGlvbklkOiBzdHJpbmc7IG9wZXJhdGlvbj86IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgcmVtb3ZlZENvdW50PzogbnVtYmVyIH0gfCBudWxsIHtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFsbG93RXZpY3RTcGFucyA9IG9wdGlvbnM/LmFsbG93RXZpY3RTcGFucyA9PT0gdHJ1ZTtcblxuICAvLyBTVFJJQ1QgVFJFRSBFVklDVElPTjpcbiAgLy8gV2hlbiB0aGUgYnVmZmVyIGlzIGZ1bGwsIHdlIE1VU1QgTk9UIGV2aWN0IGEgcGFyZW50IHNwYW4gd2hpbGUga2VlcGluZyBpdHMgY2hpbGRyZW4sXG4gIC8vIG90aGVyd2lzZSBmbHVzaCgpIHdpbGwgZW1pdCBgb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW5gLlxuICAvL1xuICAvLyBXZSBzb2x2ZSB0aGlzIGxpa2UgYSByZWFsIHRyZWUgcHJvYmxlbTpcbiAgLy8gMSkgUHJlZmVyIGV2aWN0aW5nIFwibGVhZlwiIGV2ZW50czogZXZlbnRzIHRoYXQgYXJlIE5PVCByZWZlcmVuY2VkIGFzIGEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGJ5IGFueSBvdGhlciBidWZmZXJlZCBldmVudC5cbiAgLy8gMikgUHJlZmVyIGV2aWN0aW5nIG5vbi1zcGFuIGxlYXZlcyAobG9ncy9tZXRyaWNzKSBiZWZvcmUgc3BhbnMuXG4gIC8vIDMpIElmIG5vIGxlYXZlcyBleGlzdCAocmFyZSksIGV2aWN0IGFuIGV2ZW50IEFORCBpdHMgd2hvbGUgZGVzY2VuZGFudCBzdWJ0cmVlIHNvIG5vIG9ycGhhbnMgcmVtYWluLlxuXG4gIGNvbnN0IHJlZmVyZW5jZWRBc1BhcmVudCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBjaGlsZHJlbkJ5UGFyZW50ID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlFdmVudFtdPigpO1xuICBmb3IgKGNvbnN0IGUgb2YgYnVmZmVyKSB7XG4gICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgIGlmICh0eXBlb2YgcGlkID09PSAnc3RyaW5nJyAmJiBwaWQubGVuZ3RoID4gMCkge1xuICAgICAgcmVmZXJlbmNlZEFzUGFyZW50LmFkZChwaWQpO1xuICAgICAgY29uc3QgYXJyID0gY2hpbGRyZW5CeVBhcmVudC5nZXQocGlkKTtcbiAgICAgIGlmIChhcnIpIGFyci5wdXNoKGUpO1xuICAgICAgZWxzZSBjaGlsZHJlbkJ5UGFyZW50LnNldChwaWQsIFsgZSBdKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpc1NwYW4gPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLnR5cGUgPT09ICdzcGFuJyB8fCBlLnR5cGUgPT09ICdzcGFuLnN0YXJ0JztcbiAgY29uc3QgZ2V0SWQgPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgY29uc3QgaXNMZWFmID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4ge1xuICAgIGNvbnN0IGlkID0gZ2V0SWQoZSk7XG4gICAgaWYgKCFpZCkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuICFyZWZlcmVuY2VkQXNQYXJlbnQuaGFzKGlkKTtcbiAgfTtcblxuICBjb25zdCBwaWNrTG93ZXN0ID0gKGNhbmRpZGF0ZXM6IE9ic2VydmFiaWxpdHlFdmVudFtdKSA9PiB7XG4gICAgbGV0IGlkeCA9IC0xO1xuICAgIGxldCBsb3dlc3QgPSBJbmZpbml0eTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhbmRpZGF0ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHAgPSBnZXRFdmVudFByaW9yaXR5KGNhbmRpZGF0ZXNbIGkgXSk7XG4gICAgICBpZiAocCA8IGxvd2VzdCkge1xuICAgICAgICBsb3dlc3QgPSBwO1xuICAgICAgICBpZHggPSBpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gaWR4O1xuICB9O1xuXG4gIC8vIElmIHNwYW5zIGFyZSBub3QgYWxsb3dlZCB0byBiZSBldmljdGVkLCBjb25zdHJhaW4gY2FuZGlkYXRlcyB0byBub24tc3BhbiBldmVudHMgb25seS5cbiAgY29uc3Qgbm9uU3BhbnMgPSBidWZmZXIuZmlsdGVyKChlKSA9PiAhaXNTcGFuKGUpKTtcblxuICAvLyBQYXNzIDE6IG5vbi1zcGFuIGxlYXZlc1xuICBjb25zdCBub25TcGFuTGVhdmVzID0gbm9uU3BhbnMuZmlsdGVyKChlKSA9PiBpc0xlYWYoZSkpO1xuICBsZXQgdGFyZ2V0OiBPYnNlcnZhYmlsaXR5RXZlbnQgfCB1bmRlZmluZWQ7XG4gIGlmIChub25TcGFuTGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KG5vblNwYW5MZWF2ZXMpO1xuICAgIHRhcmdldCA9IG5vblNwYW5MZWF2ZXNbIGlkeCBdO1xuICB9IGVsc2Uge1xuICAgIGlmICghYWxsb3dFdmljdFNwYW5zKSB7XG4gICAgICAvLyBQYXNzIDIgKG5vbi1zcGFuIG9ubHkpOiBldmljdCBsb3dlc3QtcHJpb3JpdHkgbm9uLXNwYW4gdGhhdCBkb2Vzbid0IGhhdmUgc3BhbiBjaGlsZHJlbi5cbiAgICAgIC8vIFdlIG11c3QgY2hlY2sgZm9yIHNwYW4gY2hpbGRyZW4gYmVjYXVzZSBzdWJ0cmVlIHJlbW92YWwgd291bGQgZXZpY3QgdGhvc2Ugc3BhbnMsXG4gICAgICAvLyB2aW9sYXRpbmcgdGhlIGFsbG93RXZpY3RTcGFucz1mYWxzZSBjb250cmFjdC5cbiAgICAgIGlmIChub25TcGFucy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEZpbHRlciB0byBvbmx5IG5vbi1zcGFucyB0aGF0IGFyZSBzYWZlIHRvIGV2aWN0IChubyBzcGFuIGNoaWxkcmVuKVxuICAgICAgICBjb25zdCBzYWZlTm9uU3BhbnMgPSBub25TcGFucy5maWx0ZXIoZSA9PiB7XG4gICAgICAgICAgY29uc3QgaWQgPSBnZXRJZChlKTtcbiAgICAgICAgICBpZiAoIWlkKSByZXR1cm4gdHJ1ZTsgLy8gTm8gSUQgPSBubyBjaGlsZHJlblxuICAgICAgICAgIGNvbnN0IGtpZHMgPSBjaGlsZHJlbkJ5UGFyZW50LmdldChpZCk7XG4gICAgICAgICAgaWYgKCFraWRzKSByZXR1cm4gdHJ1ZTsgLy8gTm8gY2hpbGRyZW4gPSBzYWZlXG4gICAgICAgICAgLy8gUmVqZWN0IGlmIGFueSBjaGlsZCBpcyBhIHNwYW5cbiAgICAgICAgICByZXR1cm4gIWtpZHMuc29tZShjaGlsZCA9PiBpc1NwYW4oY2hpbGQpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHNhZmVOb25TcGFucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChzYWZlTm9uU3BhbnMpO1xuICAgICAgICAgIHRhcmdldCA9IHNhZmVOb25TcGFuc1sgaWR4IF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gQWxsIG5vbi1zcGFucyBoYXZlIHNwYW4gY2hpbGRyZW4gLSBjYW5ub3QgZXZpY3Qgd2l0aG91dCB2aW9sYXRpbmcgYWxsb3dFdmljdFNwYW5zXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEJ1ZmZlciBjb250YWlucyBvbmx5IHNwYW5zIC0gY2FsbGVyIG11c3QgZGVjaWRlIHdoZXRoZXIgdG8gYWxsb3cgc3BhbiBldmljdGlvbiBvciBvdmVyZmxvdy5cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFBhc3MgMjogYW55IGxlYXZlcyAoaW5jbHVkaW5nIHNwYW5zKVxuICAgICAgY29uc3QgYW55TGVhdmVzID0gYnVmZmVyLmZpbHRlcigoZSkgPT4gaXNMZWFmKGUpKTtcbiAgICAgIGlmIChhbnlMZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGFueUxlYXZlcyk7XG4gICAgICAgIHRhcmdldCA9IGFueUxlYXZlc1sgaWR4IF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBQYXNzIDM6IG5vIGxlYXZlcyBleGlzdCAoY3ljbGUvZGVnZW5lcmF0ZSkuIFBpY2sgdGhlIG92ZXJhbGwgbG93ZXN0LXByaW9yaXR5IGV2ZW50LlxuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGJ1ZmZlcik7XG4gICAgICAgIHRhcmdldCA9IGJ1ZmZlclsgaWR4IF07XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0YXJnZXQpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRhcmdldElkID0gZ2V0SWQodGFyZ2V0KTtcbiAgbGV0IHJlbW92ZWRDb3VudCA9IDA7XG5cbiAgLy8gSWYgdGFyZ2V0IGlzIHJlZmVyZW5jZWQgYXMgYSBwYXJlbnQsIHJlbW92ZSBpdHMgZW50aXJlIHN1YnRyZWUgKEJGUykuXG4gIGNvbnN0IHRvUmVtb3ZlID0gbmV3IFNldDxPYnNlcnZhYmlsaXR5RXZlbnQ+KCk7XG4gIGNvbnN0IHF1ZXVlOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFsgdGFyZ2V0IF07XG4gIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgY3VyID0gcXVldWUuc2hpZnQoKSE7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhjdXIpKSBjb250aW51ZTtcbiAgICB0b1JlbW92ZS5hZGQoY3VyKTtcbiAgICBjb25zdCBjdXJJZCA9IGdldElkKGN1cik7XG4gICAgaWYgKGN1cklkKSB7XG4gICAgICBjb25zdCBraWRzID0gY2hpbGRyZW5CeVBhcmVudC5nZXQoY3VySWQpO1xuICAgICAgaWYgKGtpZHMpIHF1ZXVlLnB1c2goLi4ua2lkcyk7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlsdGVyIGJ1ZmZlciBpbi1wbGFjZVxuICBmb3IgKGxldCBpID0gYnVmZmVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhidWZmZXJbIGkgXSkpIHtcbiAgICAgIGJ1ZmZlci5zcGxpY2UoaSwgMSk7XG4gICAgICByZW1vdmVkQ291bnQrKztcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHR5cGU6IHRhcmdldC50eXBlLFxuICAgIGNvcnJlbGF0aW9uSWQ6IHRhcmdldC5jb3JyZWxhdGlvbklkLFxuICAgIG9wZXJhdGlvbjogdGFyZ2V0Lm9wZXJhdGlvbixcbiAgICBsZXZlbDogdGFyZ2V0LmxldmVsLFxuICAgIHJlbW92ZWRDb3VudCxcbiAgfTtcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKHN5bmMgdmVyc2lvbilcbiAqIFJldHVybnM6ICdjYXB0dXJlZCcgaWYgZXZlbnQgd2FzIGNhcHR1cmVkLCAnYnVmZmVyZWQnIGlmIGJ1ZmZlcmVkLCAnc2tpcCcgaWYgbm90IHVzaW5nIHRhaWwtYmFzZWRcbiAqL1xuZnVuY3Rpb24gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdTeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6ICdjYXB0dXJlZCcgfCAnYnVmZmVyZWQnIHwgJ3NraXAnIHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgIGNvbnN0IHVucGFja2VkRXZlbnRzID0gdW5wYWNrRW1pdHRlZEV2ZW50cyhyZWR1Y2VkLmV2ZW50cyk7XG5cbiAgICAgIC8vIERpc3BhdGNoIGFsbCBldmVudHMgLSBub2lzZSByZWR1Y3Rpb24gYWxyZWFkeSBmaWx0ZXJlZCBieSBtaW5MZXZlbFxuICAgICAgZm9yIChjb25zdCBidWZmZXJlZEV2ZW50IG9mIHVucGFja2VkRXZlbnRzKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoYnVmZmVyZWRFdmVudC50eXBlKTtcbiAgICAgICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGJ1ZmZlcmVkRXZlbnQsIHRhcmdldHMpO1xuICAgICAgfVxuICAgIH1cblxuICAgIG9ic1N0YXRlLmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIG9ic1N0YXRlLnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gUE9TVC1FUlJPUiBQQVRIOiBDYXB0dXJlIGltbWVkaWF0ZWx5XG4gIGlmIChjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZyAoZmlsdGVyaW5nIGhhcHBlbnMgQUZURVIgbm9pc2UgcmVkdWN0aW9uKVxuICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuXG4gIC8vIEJ1ZmZlciBzaXplIG1hbmFnZW1lbnQ6IGV2aWN0IGxvd2VzdCBwcmlvcml0eSBpZiBmdWxsXG4gIGNvbnN0IG1heFNpemUgPSBjZmcuc2FtcGxpbmc/Lm1heEJ1ZmZlclNpemUgPz8gMTAwMDtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gbWF4U2l6ZSkge1xuICAgIC8vIElNUE9SVEFOVDpcbiAgICAvLyBEdXJpbmcgYnVmZmVyaW5nIChub2lzZSByZWR1Y3Rpb24gLyBzbWFydCBzYW1wbGluZyksIHNwYW5zIG1heSBiZSBlbWl0dGVkIEFGVEVSIHRoZWlyIGNoaWxkcmVuLlxuICAgIC8vIEV2aWN0aW5nIHNwYW5zIG9wcG9ydHVuaXN0aWNhbGx5IGNhbiB0aGVyZWZvcmUgY3JlYXRlIGZ1dHVyZSBvcnBoYW4gY2hpbGRyZW4gKG1pc3NpbmdfcGFyZW50X3NwYW4pLlxuICAgIC8vIFByZWZlciBldmljdGluZyBub24tc3BhbiBldmVudHMgb25seTsgaWYgdGhlIGJ1ZmZlciBpcyBzcGFucy1vbmx5LCBhbGxvdyBib3VuZGVkIG92ZXJmbG93LlxuICAgIGNvbnN0IGV2aWN0ZWRJbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KTtcbiAgICBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBTcGFucy1vbmx5IG92ZXJmbG93OiBhbGxvdyBidWZmZXIgZ3Jvd3RoIHVwIHRvIDJ4IGJlZm9yZSBldmljdGluZyBzcGFuIHN1YnRyZWVzLlxuICAgICAgY29uc3QgaGFyZENhcCA9IG1heFNpemUgKiAyO1xuICAgICAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gaGFyZENhcCkge1xuICAgICAgICBjb25zdCBldmljdGVkU3BhbkluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IHRydWUgfSk7XG4gICAgICAgIGlmIChldmljdGVkU3BhbkluZm8pIHtcbiAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExvZyB3YXJuaW5nIHdpdGggZXZpY3RlZCBldmVudCBkZXRhaWxzXG4gICAgaWYgKG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCA9PT0gMSB8fCBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgJSAxMDAgPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBmdWxsLCBldmljdGluZyBsb3dlc3QgcHJpb3JpdHkgZXZlbnRzJywge1xuICAgICAgICBldmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgIGJ1ZmZlclNpemU6IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgZXZpY3RlZEV2ZW50OiBldmljdGVkSW5mbyxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIC8vIExvZyBlYWNoIGV2aWN0aW9uIGF0IGRlYnVnIGxldmVsIGZvciB0cm91Ymxlc2hvb3RpbmdcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRXZpY3RlZCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZyb20gYnVmZmVyJywge1xuICAgICAgICAuLi5ldmljdGVkSW5mbyxcbiAgICAgICAgdG90YWxFdmljdGVkOiBvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBidWZmZXIucHVzaChldmVudCk7XG4gIG9ic1N0YXRlLnN1bW1hcnkuYnVmZmVyZWQrKztcbiAgcmV0dXJuICdidWZmZXJlZCc7XG59XG5cbi8qKlxuICogSGFuZGxlIHRhaWwtYmFzZWQgc2FtcGxpbmcgbG9naWMgZm9yIGFuIGV2ZW50IChhc3luYyB2ZXJzaW9uKVxuICovXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ0FzeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6IFByb21pc2U8J2NhcHR1cmVkJyB8ICdidWZmZXJlZCcgfCAnc2tpcCc+IHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgIGNvbnN0IHVucGFja2VkRXZlbnRzID0gdW5wYWNrRW1pdHRlZEV2ZW50cyhyZWR1Y2VkLmV2ZW50cyk7XG5cbiAgICAgIC8vIERpc3BhdGNoIGFsbCBldmVudHMgLSBub2lzZSByZWR1Y3Rpb24gYWxyZWFkeSBmaWx0ZXJlZCBieSBtaW5MZXZlbFxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodW5wYWNrZWRFdmVudHMubWFwKGJ1ZmZlcmVkRXZlbnQgPT4ge1xuICAgICAgICBjb25zdCB0YXJnZXRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGJ1ZmZlcmVkRXZlbnQudHlwZSk7XG4gICAgICAgIHJldHVybiBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGJ1ZmZlcmVkRXZlbnQsIHRhcmdldHMpO1xuICAgICAgfSkpO1xuICAgIH1cblxuICAgIG9ic1N0YXRlLmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICBvYnNTdGF0ZS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIFBPU1QtRVJST1IgUEFUSDogQ2FwdHVyZSBpbW1lZGlhdGVseVxuICBpZiAoY29udGV4dC5vYnNlcnZhYmlsaXR5LmVycm9yT2NjdXJyZWQpIHtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5LnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gTk9STUFMIFBBVEg6IEJ1ZmZlciBldmVyeXRoaW5nXG4gIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNmZy5zYW1wbGluZz8ubWF4QnVmZmVyU2l6ZSA/PyAxMDAwO1xuICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBtYXhTaXplKSB7XG4gICAgY29uc3QgZXZpY3RlZEluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IGZhbHNlIH0pO1xuICAgIGlmIChldmljdGVkSW5mbykge1xuICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGhhcmRDYXAgPSBtYXhTaXplICogMjtcbiAgICAgIGlmIChidWZmZXIubGVuZ3RoID49IGhhcmRDYXApIHtcbiAgICAgICAgY29uc3QgZXZpY3RlZFNwYW5JbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiB0cnVlIH0pO1xuICAgICAgICBpZiAoZXZpY3RlZFNwYW5JbmZvKSB7XG4gICAgICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBMb2cgd2FybmluZyBpZiBldmljdGluZyBhIGxvdFxuICAgIGlmIChvYnNTdGF0ZS5zdW1tYXJ5LmV2aWN0ZWQgPT09IDEgfHwgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkICUgMTAwID09PSAwKSB7XG4gICAgICBsb2dnZXIud2FybignT2JzZXJ2YWJpbGl0eSBidWZmZXIgZnVsbCwgZXZpY3RpbmcgbG93ZXN0IHByaW9yaXR5IGV2ZW50cycsIHtcbiAgICAgICAgZXZpY3RlZDogb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkLFxuICAgICAgICBidWZmZXJTaXplOiBidWZmZXIubGVuZ3RoLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWRcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGJ1ZmZlci5wdXNoKGV2ZW50KTtcbiAgb2JzU3RhdGUuc3VtbWFyeS5idWZmZXJlZCsrO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIHNvdXJjZS1tYXAtc3VwcG9ydCBpZiBlbmFibGVkIGluIGNvbmZpZ1xuICogUHJvdmlkZXMgYmV0dGVyIHN0YWNrIHRyYWNlcyBmb3IgVHlwZVNjcmlwdC90cmFuc3BpbGVkIGNvZGUgaW4gcHJvZHVjdGlvblxuICovXG5mdW5jdGlvbiBpbml0aWFsaXplU291cmNlTWFwU3VwcG9ydChjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgaWYgKCFjZmcuc291cmNlTWFwLmVuYWJsZWQpIHtcbiAgICBsb2dnZXIuZGVidWcoJ1NvdXJjZSBtYXAgc3VwcG9ydCBkaXNhYmxlZCBpbiBjb25maWcnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnQXR0ZW1wdGluZyB0byBsb2FkIHNvdXJjZS1tYXAtc3VwcG9ydC4uLicpO1xuICAgIC8vIER5bmFtaWMgaW1wb3J0IHRvIGF2b2lkIGJ1bmRsaW5nIGlmIG5vdCBuZWVkZWRcbiAgICByZXF1aXJlKCdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInKTtcbiAgICBsb2dnZXIuZGVidWcoJ1NvdXJjZSBtYXAgc3VwcG9ydCBlbmFibGVkIC0gc3RhY2sgdHJhY2VzIHdpbGwgc2hvdyBvcmlnaW5hbCBUeXBlU2NyaXB0IGxpbmVzJyk7XG4gIH0gY2F0Y2ggKGVycm9yOiB1bmtub3duKSB7XG4gICAgLy8gTm90IGEgY3JpdGljYWwgZXJyb3IgLSBvYnNlcnZhYmlsaXR5IHN0aWxsIHdvcmtzIHdpdGhvdXQgc291cmNlIG1hcHNcbiAgICBpZiAoZXJyb3IgJiYgdHlwZW9mIGVycm9yID09PSAnb2JqZWN0JyAmJiAnY29kZScgaW4gZXJyb3IgJiYgKGVycm9yIGFzIHsgY29kZT86IHVua25vd24gfSkuY29kZSA9PT0gJ01PRFVMRV9OT1RfRk9VTkQnKSB7XG4gICAgICBsb2dnZXIud2FybihcbiAgICAgICAgJ3NvdXJjZS1tYXAtc3VwcG9ydCBwYWNrYWdlIG5vdCBmb3VuZC4gSW5zdGFsbCBpdCBmb3IgYmV0dGVyIGVycm9yIHN0YWNrIHRyYWNlczogbnBtIGluc3RhbGwgc291cmNlLW1hcC1zdXBwb3J0J1xuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgbXNnID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgbG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBsb2FkIHNvdXJjZS1tYXAtc3VwcG9ydDonLCBtc2cpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESSBiYXNlZCBvbiBjb25maWdcbiAqL1xuZnVuY3Rpb24gaW5pdGlhbGl6ZUJhY2tlbmRzRnJvbUNvbmZpZyhjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgYmFja2VuZHMgPSBbXTtcbiAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgY29uc3QgZW5hYmxlZEJhY2tlbmRzID0gY2ZnLmJhY2tlbmRzLmZpbHRlcihiID0+IGIuZW5hYmxlZCAhPT0gZmFsc2UpO1xuXG4gIGZvciAoY29uc3QgYmFja2VuZENmZyBvZiBlbmFibGVkQmFja2VuZHMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYmFja2VuZCA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZTxPYnNlcnZhYmlsaXR5QmFja2VuZD4oXG4gICAgICAgICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gICAgICAgIHsgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgYmFja2VuZENmZy50eXBlIF0gfVxuICAgICAgKTtcbiAgICAgIGJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gICAgICBiYWNrZW5kQ29uZmlncy5zZXQoYmFja2VuZC5uYW1lLCBiYWNrZW5kQ2ZnKTtcbiAgICAgIGJhY2tlbmQuY29uZmlndXJlRnJvbUJhY2tlbmRFbnRyeT8uKGJhY2tlbmRDZmcpO1xuICAgICAgbG9nZ2VyLmRlYnVnKGBJbml0aWFsaXplZCBiYWNrZW5kOiAke2JhY2tlbmQubmFtZX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgTm9Qcm92aWRlckZvdW5kRXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJyR7YmFja2VuZENmZy50eXBlfScgbm90IGZvdW5kIGluIERJLCBza2lwcGluZ2ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBiYWNrZW5kICcke2JhY2tlbmRDZmcudHlwZX0nOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoYmFja2VuZHMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gU29mdC1mYWlsOiBkbyBOT1QgdGhyb3cgYW5kIGJyZWFrIGFwcGxpY2F0aW9uIGZsb3cuXG4gICAgLy8gV2l0aG91dCBiYWNrZW5kcywgY2FwdHVyZSBiZWNvbWVzIGEgbm8tb3AgZm9yIHRoaXMgaW52b2NhdGlvbiAoZXZlbnRzIGFyZSBkcm9wcGVkKS5cbiAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHkgbWlzY29uZmlndXJlZDogbm8gZW5hYmxlZC9hdmFpbGFibGUgYmFja2VuZHMgd2VyZSByZXNvbHZlZCBmcm9tIERJLiBPYnNlcnZhYmlsaXR5IHdpbGwgYmUgZGlzYWJsZWQgZm9yIHRoaXMgaW52b2NhdGlvbi4nLCB7XG4gICAgICBlbmFibGVkQmFja2VuZFR5cGVzOiBlbmFibGVkQmFja2VuZHMubWFwKGIgPT4gYi50eXBlKSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJlZ2lzdGVyIHNwYW4gbGlmZWN5Y2xlIGhvb2tzIGZvciBiYWNrZW5kcyB0aGF0IGltcGxlbWVudCBTcGFuTGlmZWN5Y2xlSG9vay5cbiAgLy8gVGhpcyBhbGxvd3MgU3Bhbk9ic2VydmVyIHRvIGNhbGwgT1RFTCAoYW5kIG90aGVyIHJlYWwtdGltZSBiYWNrZW5kcykgZGlyZWN0bHlcbiAgLy8gaW5zdGVhZCBvZiByb3V0aW5nIHNwYW4uc3RhcnQgZXZlbnRzIHRocm91Z2ggdGhlIGJ1ZmZlcmVkIGNhcHR1cmUgcGlwZWxpbmUuXG4gIGNvbnN0IGhvb2tzOiBTcGFuTGlmZWN5Y2xlSG9va1tdID0gW107XG4gIGZvciAoY29uc3QgYmFja2VuZCBvZiBiYWNrZW5kcykge1xuICAgIGlmIChpc1NwYW5MaWZlY3ljbGVIb29rKGJhY2tlbmQpKSB7XG4gICAgICBob29rcy5wdXNoKGJhY2tlbmQpO1xuICAgIH1cbiAgfVxuICBzZXRTcGFuTGlmZWN5Y2xlSG9va3MoaG9va3MpO1xuICBpZiAoaG9va3MubGVuZ3RoID4gMCkge1xuICAgIGxvZ2dlci5kZWJ1ZyhgUmVnaXN0ZXJlZCAke2hvb2tzLmxlbmd0aH0gc3BhbiBsaWZlY3ljbGUgaG9vayhzKWApO1xuICB9XG59XG5cbi8qKiBUeXBlIGd1YXJkOiBjaGVjayBpZiBhIGJhY2tlbmQgYWxzbyBpbXBsZW1lbnRzIFNwYW5MaWZlY3ljbGVIb29rLiAqL1xuZnVuY3Rpb24gaXNTcGFuTGlmZWN5Y2xlSG9vayhiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCk6IGJhY2tlbmQgaXMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQgJiBTcGFuTGlmZWN5Y2xlSG9vayB7XG4gIGNvbnN0IGNhbmRpZGF0ZSA9IGJhY2tlbmQgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgcmV0dXJuIHR5cGVvZiBjYW5kaWRhdGUub25TcGFuU3RhcnQgPT09ICdmdW5jdGlvbidcbiAgICAmJiB0eXBlb2YgY2FuZGlkYXRlLm9uU3BhbkVuZCA9PT0gJ2Z1bmN0aW9uJztcbn1cblxuZnVuY3Rpb24gZG9Jbml0aWFsaXplKCk6IHZvaWQge1xuICB0cnkge1xuICAgIGxvZ2dlci5kZWJ1ZygnPT09IE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gU1RBUlQgPT09Jyk7XG5cbiAgICAvLyBSdW4gcHJlLWluaXRpYWxpemF0aW9uIGhvb2tzIChlLmcuLCBzY2hlbWEgcmVnaXN0cmF0aW9uKVxuICAgIGlmIChwcmVJbml0SG9va3MubGVuZ3RoID4gMCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKGBSdW5uaW5nICR7cHJlSW5pdEhvb2tzLmxlbmd0aH0gcHJlLWluaXRpYWxpemF0aW9uIGhvb2socykuLi5gKTtcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBwcmVJbml0SG9va3MpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBob29rKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKCdQcmUtaW5pdGlhbGl6YXRpb24gaG9vayBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBsb2dnZXIuZGVidWcoJ1ByZS1pbml0aWFsaXphdGlvbiBob29rcyBjb21wbGV0ZWQnKTtcbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIGNvbmZpZyBpbnB1dCBmcm9tIERJLCB0aGVuIG5vcm1hbGl6ZSBpbnRvIGEgZnVsbHktZGVmaW5lZCBPYnNlcnZhYmlsaXR5Q29uZmlnLlxuICAgIC8vIFRoaXMgYXZvaWRzIHVuc2FmZSBjYXN0cyBhbmQgZW5zdXJlcyB0aGUgc2hhcGUgaXMgY29uc2lzdGVudCBldmVuIHdoZW4gYXBwcyBvdmVycmlkZSBwYXJ0aWFsbHkuXG4gICAgY29uc3QgaW5wdXQgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmVDb25maWc8T2JzZXJ2YWJpbGl0eUNvbmZpZ0lucHV0Pignb2JzZXJ2YWJpbGl0eScpO1xuICAgIGNvbmZpZyA9IGNyZWF0ZU9ic2VydmFiaWxpdHlDb25maWcoaW5wdXQpO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKGNvbmZpZyk7XG4gICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5IGNvbmZpZyBsb2FkZWQgZnJvbSBESScsIHtcbiAgICAgIGVuYWJsZWQ6IGNvbmZpZy5lbmFibGVkLFxuICAgICAgc2VydmljZU5hbWU6IGNvbmZpZy5zZXJ2aWNlTmFtZSxcbiAgICAgIGJhY2tlbmRzOiBjb25maWcuYmFja2VuZHM/Lm1hcChiID0+IGIudHlwZSksXG4gICAgICBzYW1wbGluZzogeyBlbmFibGVkOiBjb25maWcuc2FtcGxpbmc/LmVuYWJsZWQsIHNtYXJ0OiBjb25maWcuc2FtcGxpbmc/LnNtYXJ0IH0sXG4gICAgICBzb3VyY2VNYXA6IGNvbmZpZy5zb3VyY2VNYXA/LmVuYWJsZWQsXG4gICAgfSk7XG5cbiAgICAvLyBJbml0aWFsaXplIHNvdXJjZS1tYXAtc3VwcG9ydCBmb3IgYmV0dGVyIHN0YWNrIHRyYWNlcyAoaWYgZW5hYmxlZClcbiAgICBpbml0aWFsaXplU291cmNlTWFwU3VwcG9ydChjb25maWcpO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBiYWNrZW5kcyBmcm9tIERJXG4gICAgaW5pdGlhbGl6ZUJhY2tlbmRzRnJvbUNvbmZpZyhjb25maWchKTtcblxuICAgIC8vIFJlZ2lzdGVyIGNhcHR1cmVyIGZvciBvYnNlcnZlcnNcbiAgICBpbml0aWFsaXplQ2FwdHVyZXIoe1xuICAgICAgY2FwdHVyZTogKGlucHV0KSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKGlucHV0KSxcbiAgICAgIGNhcHR1cmVBc3luYzogKGlucHV0KSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlQXN5bmMoaW5wdXQpLFxuICAgIH0pO1xuXG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgIGxvZ2dlci5kZWJ1ZygnPT09IE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gQ09NUExFVEUgPT09Jyk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKCchISEgT0JTRVJWQUJJTElUWSBJTklUSUFMSVpBVElPTiBGQUlMRUQgISEhJywgZXJyb3IpO1xuICAgIC8vIFNvZnQtZmFpbDogZG8gTk9UIHRocm93IGludG8gYXBwbGljYXRpb24gZmxvdy5cbiAgICAvLyBNYXJrIGluaXRpYWxpemVkIHRvIHByZXZlbnQgcmVwZWF0ZWQgaW5pdCBhdHRlbXB0czsgbGVhdmUgY2FwdHVyZXIgdW5pbml0aWFsaXplZCBzbyBvYnNlcnZlcnMgZHJvcCBldmVudHMuXG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgIGNvbmZpZyA9IG51bGw7XG4gICAgc2V0Q3VycmVudE9ic2VydmFiaWxpdHlDb25maWcobnVsbCk7XG4gICAgYmFja2VuZHMgPSBbXTtcbiAgICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICB9XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFVCTElDIEFQSSAtIE9ic2VydmFiaWxpdHlNYW5hZ2VyXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZXhwb3J0IGNsYXNzIE9ic2VydmFiaWxpdHlNYW5hZ2VyIHtcblxuICBwcml2YXRlIGNvbnN0cnVjdG9yKCkgeyB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgZm9yIGEgbmV3IExhbWJkYSBpbnZvY2F0aW9uXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpIGNhbGxlZCcsIHsgaW5pdGlhbGl6ZWQsIGludm9jYXRpb25Db3VudCB9KTtcblxuICAgIGlmICghaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnTm90IGluaXRpYWxpemVkIHlldCwgY2FsbGluZyBkb0luaXRpYWxpemUoKS4uLicpO1xuICAgICAgZG9Jbml0aWFsaXplKCk7XG4gICAgfVxuXG4gICAgaW52b2NhdGlvbkNvdW50Kys7XG4gICAgbG9nZ2VyLmRlYnVnKGBJbnZvY2F0aW9uICR7aW52b2NhdGlvbkNvdW50fSBzdGFydGluZywgaW5pdGlhbGl6aW5nICR7YmFja2VuZHMubGVuZ3RofSBiYWNrZW5kKHMpYCk7XG5cbiAgICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgYmFja2VuZHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGJhY2tlbmQuaW5pdGlhbGl6ZUludm9jYXRpb24/LigpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmYWlsZWQgdG8gaW5pdGlhbGl6ZSBpbnZvY2F0aW9uOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzdGF0aWMgaXNJbml0aWFsaXplZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaW5pdGlhbGl6ZWQ7XG4gIH1cblxuICBzdGF0aWMgaXNDb2xkU3RhcnQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudCA9PT0gMTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRJbnZvY2F0aW9uQ291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gaW52b2NhdGlvbkNvdW50O1xuICB9XG5cbiAgc3RhdGljIGdldENvbmZpZygpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCB7XG4gICAgcmV0dXJuIGNvbmZpZztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgb2JzZXJ2YWJpbGl0eSBzdW1tYXJ5IGZvciB0aGUgY3VycmVudCBpbnZvY2F0aW9uLlxuICAgKiBSZXR1cm5zIGJ1ZmZlciBzdGF0czogZXZpY3RlZCwgYnVmZmVyZWQsIGNhcHR1cmVkLCBzYW1wbGVkT3V0IGNvdW50cy5cbiAgICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gZXhlY3V0aW9uIGNvbnRleHQgZXhpc3RzLlxuICAgKi9cbiAgc3RhdGljIGdldFN1bW1hcnkoKTogT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgIHJldHVybiBjb250ZXh0Py5vYnNlcnZhYmlsaXR5LnN1bW1hcnk7XG4gIH1cblxuICBzdGF0aWMgY29uZmlndXJlKHVwZGF0ZXM6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZz4pOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdPYnNlcnZhYmlsaXR5TWFuYWdlciBub3QgaW5pdGlhbGl6ZWQnKTtcbiAgICB9XG4gICAgY29uZmlnID0geyAuLi5jb25maWcsIC4uLnVwZGF0ZXMgfTtcbiAgfVxuXG4gIHN0YXRpYyByZWdpc3RlckJhY2tlbmQoYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQpOiB2b2lkIHtcbiAgICBpZiAoYmFja2VuZHMuZmluZCgoYikgPT4gYi5uYW1lID09PSBiYWNrZW5kLm5hbWUpKSB7XG4gICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gYWxyZWFkeSByZWdpc3RlcmVkYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gIH1cblxuICBzdGF0aWMgdW5yZWdpc3RlckJhY2tlbmQobmFtZTogc3RyaW5nKTogdm9pZCB7XG4gICAgYmFja2VuZHMgPSBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IGIubmFtZSAhPT0gbmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBwcmUtaW5pdGlhbGl6YXRpb24gaG9vay5cbiAgICogSG9va3MgcnVuIEJFRk9SRSBiYWNrZW5kcyBhcmUgaW5pdGlhbGl6ZWQsIGFsbG93aW5nIHNjaGVtYS9zZXJ2aWNlIHJlZ2lzdHJhdGlvblxuICAgKiBuZWVkZWQgYnkgYmFja2VuZHMgd2l0aG91dCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gICAqIFxuICAgKiBAcGFyYW0gaG9vayAtIENhbGxiYWNrIHRvIGV4ZWN1dGUgZHVyaW5nIGluaXRpYWxpemF0aW9uXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJQcmVJbml0SG9vayhob29rOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgcHJlSW5pdEhvb2tzLnB1c2goaG9vayk7XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhbiBvYnNlcnZhYmlsaXR5IGV2ZW50IChmaXJlLWFuZC1mb3JnZXQpXG4gICAqIFxuICAgKiBDYXB0dXJlIGNvbnRyb2wgaXMgZW1iZWRkZWQgaW4gaW5wdXQuY2FwdHVyZSAtIG5vIHNlcGFyYXRlIG9wdGlvbnMgcGFyYW0uXG4gICAqIFxuICAgKiBAcGFyYW0gaW5wdXQgLSBFdmVudCBpbnB1dCB3aXRoIGNhcHR1cmUgY29udHJvbCBpbiBpbnB1dC5jYXB0dXJlXG4gICAqIEByZXR1cm5zIG9ic2VydmFiaWxpdHlMb2dJZCBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIGlmIGZpbHRlcmVkL3NhbXBsZWQgb3V0XG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZShpbnB1dDogQ2FwdHVyZUlucHV0KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIud2Fybign4p2MIE9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJywgeyB0eXBlOiBpbnB1dC50eXBlLCBsZXZlbDogaW5wdXQubGV2ZWwgfSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBCbG9jayB1bnN1cHBvcnRlZCBldmVudCB0eXBlcyBmcm9tIHRoZSBjYXB0dXJlIHBpcGVsaW5lLlxuICAgICAgLy8gc3Bhbi5zdGFydCB1c2VzIFNwYW5MaWZlY3ljbGVIb29rIChPVEVMKSwgTk9UIGNhcHR1cmUgcGlwZWxpbmUuXG4gICAgICAvLyBzcGFuLmVuZCBhbmQgc3Bhbi5ldmVudCBhcmUgbGVnYWN5IGZvcm1hdHMuXG4gICAgICBpZiAoaW5wdXQudHlwZSA9PT0gJ3NwYW4uc3RhcnQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmVuZCcgfHwgaW5wdXQudHlwZSA9PT0gJ3NwYW4uZXZlbnQnKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eTogdW5zdXBwb3J0ZWQgZXZlbnQgdHlwZSBpbiBjYXB0dXJlIHBpcGVsaW5lLCBkcm9wcGluZy4nLCB7XG4gICAgICAgICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICAgICAgICBvcGVyYXRpb246IGlucHV0Lm9wZXJhdGlvbixcbiAgICAgICAgICBoaW50OiBpbnB1dC50eXBlID09PSAnc3Bhbi5zdGFydCcgPyAnc3Bhbi5zdGFydCB1c2VzIFNwYW5MaWZlY3ljbGVIb29rJyA6ICdsZWdhY3kgZm9ybWF0IG5vdCBzdXBwb3J0ZWQnLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVJbnB1dChpbnB1dCk7XG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ0ludmFsaWQgY2FwdHVyZSBpbnB1dDonLCB7IGVycm9ycywgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjb25maWc/LmVuYWJsZWQpIHtcbiAgICAgICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5IGRpc2FibGVkLCBza2lwcGluZyBjYXB0dXJlJywgeyB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICAgIGNvbnN0IGV2ZW50ID0gYnVpbGRFdmVudChpbnB1dCwgY29udGV4dCk7XG5cbiAgICAgIC8vIFRyeSB0YWlsLWJhc2VkIHNhbXBsaW5nIGZpcnN0XG4gICAgICBjb25zdCB0YWlsUmVzdWx0ID0gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdTeW5jKGV2ZW50LCBjb250ZXh0KTtcbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnY2FwdHVyZWQnKSB7XG4gICAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgICB9XG4gICAgICBpZiAodGFpbFJlc3VsdCA9PT0gJ2J1ZmZlcmVkJykge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICAvLyBIRUFELUJBU0VEIEZJTFRFUklORyArIFNBTVBMSU5HXG4gICAgICAvLyBBcHBseSBmaWx0ZXJpbmcgZmlyc3QgKGFsd2F5cyBydW5zKVxuICAgICAgaWYgKCFzaG91bGRGaWx0ZXIoZXZlbnQsIGNvbmZpZywge1xuICAgICAgICAvLyBObyBidWZmZXJlZCBncmFwaCBoZXJlOyBuZXZlciBkcm9wIHNwYW5zIGJ5IG1pbkR1cmF0aW9uIGluIGhlYWQtYmFzZWQgbW9kZVxuICAgICAgICAvLyBiZWNhdXNlIHdlIGNhbid0IHByb3ZlIHRoZXkgYXJlbid0IHBhcmVudHMgb2YgYWxyZWFkeS1lbWl0dGVkIGNoaWxkIGV2ZW50cy5cbiAgICAgICAgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wOiBmYWxzZSxcbiAgICAgIH0pKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIEZpbHRlcmVkIG91dFxuICAgICAgfVxuXG4gICAgICAvLyBBcHBseSBzYW1wbGluZyBpZiBlbmFibGVkIChwcm9iYWJpbGlzdGljKVxuICAgICAgaWYgKGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCAmJiAhc2hvdWxkU2FtcGxlKGV2ZW50LCBjb25maWcpKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIFNhbXBsZWQgb3V0XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgaW4gY2FwdHVyZTonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlIGFuIG9ic2VydmFiaWxpdHkgZXZlbnQgYXN5bmNocm9ub3VzbHkgKHdhaXRzIGZvciBiYWNrZW5kIGNhcHR1cmUpXG4gICAqIFxuICAgKiBAcGFyYW0gaW5wdXQgLSBFdmVudCBpbnB1dCB3aXRoIGNhcHR1cmUgY29udHJvbCBpbiBpbnB1dC5jYXB0dXJlXG4gICAqIEByZXR1cm5zIFByb21pc2U8b2JzZXJ2YWJpbGl0eUxvZ0lkPiBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIGlmIGZpbHRlcmVkL3NhbXBsZWQgb3V0XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2FwdHVyZUFzeW5jKGlucHV0OiBDYXB0dXJlSW5wdXQpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICghaW5pdGlhbGl6ZWQpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBub3QgaW5pdGlhbGl6ZWQsIHNraXBwaW5nIGNhcHR1cmUnKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEJsb2NrIHVuc3VwcG9ydGVkIGV2ZW50IHR5cGVzIGZyb20gdGhlIGNhcHR1cmUgcGlwZWxpbmUuXG4gICAgICAvLyBzcGFuLnN0YXJ0IHVzZXMgU3BhbkxpZmVjeWNsZUhvb2sgKE9URUwpLCBOT1QgY2FwdHVyZSBwaXBlbGluZS5cbiAgICAgIC8vIHNwYW4uZW5kIGFuZCBzcGFuLmV2ZW50IGFyZSBsZWdhY3kgZm9ybWF0cy5cbiAgICAgIGlmIChpbnB1dC50eXBlID09PSAnc3Bhbi5zdGFydCcgfHwgaW5wdXQudHlwZSA9PT0gJ3NwYW4uZW5kJyB8fCBpbnB1dC50eXBlID09PSAnc3Bhbi5ldmVudCcpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdPYnNlcnZhYmlsaXR5OiB1bnN1cHBvcnRlZCBldmVudCB0eXBlIGluIGNhcHR1cmUgcGlwZWxpbmUsIGRyb3BwaW5nLicsIHtcbiAgICAgICAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgICAgICAgIG9wZXJhdGlvbjogaW5wdXQub3BlcmF0aW9uLFxuICAgICAgICAgIGhpbnQ6IGlucHV0LnR5cGUgPT09ICdzcGFuLnN0YXJ0JyA/ICdzcGFuLnN0YXJ0IHVzZXMgU3BhbkxpZmVjeWNsZUhvb2snIDogJ2xlZ2FjeSBmb3JtYXQgbm90IHN1cHBvcnRlZCcsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICBjb25zdCBldmVudCA9IGJ1aWxkRXZlbnQoaW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGF3YWl0IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgRklMVEVSSU5HICsgU0FNUExJTkdcbiAgICAgIGlmICghc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wOiBmYWxzZSxcbiAgICAgIH0pKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIEZpbHRlcmVkIG91dFxuICAgICAgfVxuXG4gICAgICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmICFzaG91bGRTYW1wbGUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gU2FtcGxlZCBvdXRcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgaW4gY2FwdHVyZUFzeW5jOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE9ic2VydmUgYW4gZXZlbnQgKGNvbnZlbmllbmNlIG1ldGhvZClcbiAgICogXG4gICAqIEBwYXJhbSBldmVudCAtIFBhcnRpYWwgZXZlbnQgd2l0aCByZXF1aXJlZCB0eXBlIGFuZCBsZXZlbFxuICAgKiBAcmV0dXJucyBvYnNlcnZhYmlsaXR5TG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIG9ic2VydmUoXG4gICAgZXZlbnQ6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiAmIHsgdHlwZTogc3RyaW5nOyBsZXZlbDogc3RyaW5nOyBjb3JyZWxhdGlvbklkPzogc3RyaW5nIH1cbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZXZlbnQuY29ycmVsYXRpb25JZCA/PyBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTtcblxuICAgIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ29ic2VydmUoKSBjYWxsZWQgd2l0aG91dCBjb3JyZWxhdGlvbklkJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUgYXMgQ2FwdHVyZUlucHV0WyAndHlwZScgXSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCBhcyBDYXB0dXJlSW5wdXRbICdsZXZlbCcgXSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaCBhbGwgYmFja2VuZHMgYW5kIGJ1ZmZlcmVkIGV2ZW50cyAoY2FsbGVkIGF0IGVuZCBvZiBMYW1iZGEgaW52b2NhdGlvbilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBGTFVTSCBTVEFSVCA9PT0nLCB7XG4gICAgICBwZW5kaW5nRGlzcGF0Y2hlczogcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoLFxuICAgICAgYmFja2VuZHM6IGJhY2tlbmRzLmxlbmd0aCxcbiAgICAgIHNtYXJ0U2FtcGxpbmc6IGNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0LFxuICAgIH0pO1xuXG4gICAgLy8gV2FpdCBmb3IgYWxsIHBlbmRpbmcgZmlyZS1hbmQtZm9yZ2V0IGRpc3BhdGNoZXMgKGZyb20gZXJyb3IgcGF0aCBpbiBjYXB0dXJlKCkpXG4gICAgaWYgKHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgV2FpdGluZyBmb3IgJHtwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGh9IHBlbmRpbmcgZGlzcGF0Y2hlc2ApO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocGVuZGluZ0Rpc3BhdGNoZXMpO1xuICAgICAgcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID0gMDsgLy8gQ2xlYXIgZm9yIG5leHQgaW52b2NhdGlvblxuICAgICAgbG9nZ2VyLmRlYnVnKCdQZW5kaW5nIGRpc3BhdGNoZXMgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gRm9yY2UtZW5kIGFueSBzcGFucyBsZWZ0IG9wZW4gaW4gdGhpcyBpbnZvY2F0aW9uIGJlZm9yZSBmbHVzaGluZyBidWZmZXJlZCBldmVudHMuXG4gICAgLy8gVGhpcyBndWFyYW50ZWVzIHRoZSBoaWVyYXJjaHkgaGFzIGFsbCBwYXJlbnRzLCBldmVuIGlmIHVzZXIvZnJhbWV3b3JrIGNvZGUgZm9yZ290IHRvIGVuZCBhIHNwYW4uXG4gICAgcnVuU3BhbkZpbmFsaXplcigpO1xuXG4gICAgLy8gQXR0YWNoIG9ic2VydmFiaWxpdHkgc3VtbWFyeSB0byBjdXJyZW50IHNwYW4gKGlmIGFueSkgYmVmb3JlIGZsdXNoaW5nXG4gICAgY29uc3Qgc3VtbWFyeSA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmdldFN1bW1hcnkoKTtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICBjb25zdCBjdXJyZW50U3BhbiA9IGNvbnRleHQ/Lm9ic2VydmFiaWxpdHkuY3VycmVudFNwYW47XG4gICAgaWYgKHN1bW1hcnkgJiYgY3VycmVudFNwYW4gJiYgKHN1bW1hcnkuY2FwdHVyZWQgPiAwIHx8IHN1bW1hcnkuYnVmZmVyZWQgPiAwIHx8IHN1bW1hcnkuZXZpY3RlZCA+IDAgfHwgc3VtbWFyeS5zYW1wbGVkT3V0ID4gMCkpIHtcbiAgICAgIC8vIEFkZCBiYXNpYyBjb3VudCBtZXRyaWNzXG4gICAgICBjdXJyZW50U3Bhbj8ubWV0cmljcz8uKHtcbiAgICAgICAgJ19mdzI0Lm9icy5jYXB0dXJlZCc6IHN1bW1hcnkuY2FwdHVyZWQsXG4gICAgICAgICdfZncyNC5vYnMuYnVmZmVyZWQnOiBzdW1tYXJ5LmJ1ZmZlcmVkLFxuICAgICAgICAnX2Z3MjQub2JzLmV2aWN0ZWQnOiBzdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgICdfZncyNC5vYnMuc2FtcGxlZE91dCc6IHN1bW1hcnkuc2FtcGxlZE91dCxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZGV0YWlsZWQgYnJlYWtkb3duIGNoZWNrcG9pbnRcbiAgICAgIGNvbnN0IGRldGFpbGVkU3RhdHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgICB0b3RhbHM6IHtcbiAgICAgICAgICBjYXB0dXJlZDogc3VtbWFyeS5jYXB0dXJlZCxcbiAgICAgICAgICBidWZmZXJlZDogc3VtbWFyeS5idWZmZXJlZCxcbiAgICAgICAgICBldmljdGVkOiBzdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgICAgc2FtcGxlZE91dDogc3VtbWFyeS5zYW1wbGVkT3V0LFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgLy8gQWRkIGNhcHR1cmVkIGV2ZW50cyBicmVha2Rvd24gKHdoYXQgd2FzIGFjdHVhbGx5IGVtaXR0ZWQpXG4gICAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQ/Lm9ic2VydmFiaWxpdHk7XG4gICAgICBpZiAob2JzU3RhdGU/LmNhcHR1cmVkQnJlYWtkb3duKSB7XG4gICAgICAgIGRldGFpbGVkU3RhdHMuY2FwdHVyZWRCcmVha2Rvd24gPSB7XG4gICAgICAgICAgYnlUeXBlOiBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieVR5cGUsXG4gICAgICAgICAgYnlPcGVyYXRpb246IE9iamVjdC5rZXlzKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uIHx8IHt9KS5sZW5ndGggPiAwXG4gICAgICAgICAgICA/IG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uXG4gICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBieUxldmVsOiBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieUxldmVsLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDb21wdXRlIGJyZWFrZG93biBieSB0eXBlIGFuZCBvcGVyYXRpb24gZnJvbSBidWZmZXIgKHdoYXQncyBzdGlsbCBidWZmZXJlZClcbiAgICAgIGlmIChjb250ZXh0ICYmIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBieVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgYnlPcGVyYXRpb246IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgYnlMZXZlbDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gICAgICAgIGZvciAoY29uc3QgZXZlbnQgb2YgY29udGV4dC5vYnNlcnZhYmlsaXR5LmJ1ZmZlcikge1xuICAgICAgICAgIGJ5VHlwZVsgZXZlbnQudHlwZSBdID0gKGJ5VHlwZVsgZXZlbnQudHlwZSBdIHx8IDApICsgMTtcbiAgICAgICAgICBpZiAoZXZlbnQub3BlcmF0aW9uKSB7XG4gICAgICAgICAgICBieU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gPSAoYnlPcGVyYXRpb25bIGV2ZW50Lm9wZXJhdGlvbiBdIHx8IDApICsgMTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnlMZXZlbFsgZXZlbnQubGV2ZWwgXSA9IChieUxldmVsWyBldmVudC5sZXZlbCBdIHx8IDApICsgMTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRldGFpbGVkU3RhdHMuYnVmZmVyZWRCcmVha2Rvd24gPSB7XG4gICAgICAgICAgYnlUeXBlLFxuICAgICAgICAgIGJ5T3BlcmF0aW9uOiBPYmplY3Qua2V5cyhieU9wZXJhdGlvbikubGVuZ3RoID4gMCA/IGJ5T3BlcmF0aW9uIDogdW5kZWZpbmVkLFxuICAgICAgICAgIGJ5TGV2ZWwsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCBjaGVja3BvaW50IHdpdGggZGV0YWlsZWQgc3RhdHNcbiAgICAgIGN1cnJlbnRTcGFuPy5jaGVja3BvaW50Py4oJ29ic2VydmFiaWxpdHkuc3VtbWFyeS5kZXRhaWxlZCcsIHsgZGF0YTogZGV0YWlsZWRTdGF0cyB9KTtcbiAgICB9XG5cbiAgICAvLyBJZiBidWZmZXJpbmcgaXMgZW5hYmxlZCAoc21hcnQgc2FtcGxpbmcgT1Igbm9pc2UgcmVkdWN0aW9uKSwgZmx1c2ggYnVmZmVyZWQgZXZlbnRzLlxuICAgIGlmIChjb25maWc/LnNhbXBsaW5nPy5zbWFydCB8fCBjb25maWc/Lm5vaXNlUmVkdWN0aW9uPy5lbmFibGVkKSB7XG4gICAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICAgICAgaWYgKGNvbnRleHQgJiYgY29udGV4dC5vYnNlcnZhYmlsaXR5LmJ1ZmZlci5sZW5ndGggPiAwICYmICFjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgICAgICAvLyBObyBlcnJvciBvY2N1cnJlZDogYXBwbHkgbm9pc2UgcmVkdWN0aW9uICsgb3B0aW9uYWwgc2FtcGxpbmcgdG8gYnVmZmVyIGJlZm9yZSBmbHVzaGluZ1xuICAgICAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgICBvYnNTdGF0ZS5idWZmZXIgPSBbXTsgLy8gQ2xlYXIgYnVmZmVyXG5cbiAgICAgICAgLy8gQ1JJVElDQUw6IENvbXB1dGUgcmVmZXJlbmNlZCBwYXJlbnQgSURzIGZyb20gT1JJR0lOQUwgYnVmZmVyIEJFRk9SRSBub2lzZSByZWR1Y3Rpb25cbiAgICAgICAgLy8gTm9pc2UgcmVkdWN0aW9uIG1heSBhYnNvcmIvc2lsZW5jZSBldmVudHMsIGJ1dCB0aGVpciBwYXJlbnQgc3BhbnMgbXVzdCBzdGlsbCBiZSBrZXB0XG4gICAgICAgIGNvbnN0IHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICAgIGZvciAoY29uc3QgZSBvZiBidWZmZXIpIHtcbiAgICAgICAgICBjb25zdCBwaWQgPSBlLnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyB1bmRlZmluZWQ7XG4gICAgICAgICAgaWYgKHBpZCkgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMuYWRkKHBpZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZWR1Y2VkID0gYXBwbHlOb2lzZVJlZHVjdGlvbihidWZmZXIsIGNvbmZpZy5ub2lzZVJlZHVjdGlvbik7XG4gICAgICAgIGNvbnN0IHJlZHVjZWRFdmVudHMgPSB1bnBhY2tFbWl0dGVkRXZlbnRzKHJlZHVjZWQuZXZlbnRzKTtcblxuICAgICAgICAvLyBEcm9wIGVtcHR5ICpsZWFmKiBzcGFucyBpZiBjb25maWd1cmVkLlxuICAgICAgICAvLyBBIHNwYW4gaXMgYSBsZWFmIGlmZiBub2JvZHkgcmVmZXJlbmNlcyBpdCBhcyBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgaW4gdGhpcyBidWZmZXJlZCBzZXQuXG4gICAgICAgIGNvbnN0IG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zID0gY29uZmlnLnNwYW5zLnNraXBFbXB0eVxuICAgICAgICAgID8gcmVkdWNlZEV2ZW50cy5maWx0ZXIoKGUpID0+IHtcbiAgICAgICAgICAgIGlmIChlLnR5cGUgIT09ICdzcGFuJykgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjb25zdCBpZCA9IGUub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgICAgICAgICAgaWYgKCFpZCkgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBpZiAocmVmZXJlbmNlZFBhcmVudFNwYW5JZHMuaGFzKGlkKSkgcmV0dXJuIHRydWU7IC8vIHBhcmVudCA9PiBrZWVwXG4gICAgICAgICAgICBjb25zdCBkID0gZS5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgY29uc3QgZncgPSBkPy5fZncyNCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiBmdz8uc3BhbkVtcHR5ICE9PSB0cnVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgOiByZWR1Y2VkRXZlbnRzO1xuXG4gICAgICAgIC8vIEVucmljaCByb290IHNwYW4gd2l0aCBpbnZvY2F0aW9uIHN1bW1hcnkgKGNvbXBhY3Qgb3ZlcnZpZXcgb2Ygd2hhdCBoYXBwZW5lZClcbiAgICAgICAgY29uc3Qgcm9vdFNwYW4gPSBtYXliZURyb3BFbXB0eUxlYWZTcGFucy5maW5kKFxuICAgICAgICAgIGUgPT4gZS50eXBlID09PSAnc3BhbicgJiYgIWUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkXG4gICAgICAgICk7XG4gICAgICAgIGlmIChyb290U3Bhbikge1xuICAgICAgICAgIGNvbnN0IHN1bW1hcnlCeVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgICBjb25zdCBzdW1tYXJ5QnlMZXZlbDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICAgIGxldCBlcnJvckNvdW50ID0gMDtcbiAgICAgICAgICBmb3IgKGNvbnN0IGUgb2YgbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMpIHtcbiAgICAgICAgICAgIHN1bW1hcnlCeVR5cGVbIGUudHlwZSBdID0gKHN1bW1hcnlCeVR5cGVbIGUudHlwZSBdIHx8IDApICsgMTtcbiAgICAgICAgICAgIHN1bW1hcnlCeUxldmVsWyBlLmxldmVsIF0gPSAoc3VtbWFyeUJ5TGV2ZWxbIGUubGV2ZWwgXSB8fCAwKSArIDE7XG4gICAgICAgICAgICBpZiAoZS5sZXZlbCA9PT0gJ2Vycm9yJyB8fCBlLmxldmVsID09PSAnY3JpdGljYWwnKSBlcnJvckNvdW50Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJvb3RTcGFuLmRhdGEgPSB7XG4gICAgICAgICAgICAuLi4ocm9vdFNwYW4uZGF0YSA/PyB7fSksXG4gICAgICAgICAgICBfaW52b2NhdGlvblN1bW1hcnk6IHtcbiAgICAgICAgICAgICAgdG90YWxFdmVudHM6IG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zLmxlbmd0aCxcbiAgICAgICAgICAgICAgYnlUeXBlOiBzdW1tYXJ5QnlUeXBlLFxuICAgICAgICAgICAgICBieUxldmVsOiBzdW1tYXJ5QnlMZXZlbCxcbiAgICAgICAgICAgICAgaGFzRXJyb3JzOiBlcnJvckNvdW50ID4gMCxcbiAgICAgICAgICAgICAgZXJyb3JDb3VudCxcbiAgICAgICAgICAgICAgbm9pc2VSZWR1Y3Rpb246IHJlZHVjZWQuc3RhdHMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUcmFjayBjYXB0dXJlZCBldmVudHMgZm9yIGRldGFpbGVkIHN1bW1hcnlcbiAgICAgICAgY29uc3QgY2FwdHVyZWRCeVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgY2FwdHVyZWRCeU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICBjb25zdCBjYXB0dXJlZEJ5TGV2ZWw6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zKSB7XG4gICAgICAgICAgLy8gVEFJTC1CQVNFRCBGSUxURVJJTkcgKyBTQU1QTElORyAoYWZ0ZXIgbm9pc2UgcmVkdWN0aW9uKVxuXG4gICAgICAgICAgLy8gQXBwbHkgZmlsdGVyaW5nIGZpcnN0IChhbHdheXMgcnVucyAtIGNvbnRlbnQtYmFzZWQpXG4gICAgICAgICAgY29uc3QgcGFzc2VkRmlsdGVyID0gc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogdHJ1ZSxcbiAgICAgICAgICAgIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmICghcGFzc2VkRmlsdGVyKSB7XG4gICAgICAgICAgICAvLyBGaWx0ZXJlZCBvdXQgLSBkb24ndCBjb3VudCBhcyBzYW1wbGVkIG91dFxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQXBwbHkgc2FtcGxpbmcgaWYgZW5hYmxlZCAocHJvYmFiaWxpc3RpYylcbiAgICAgICAgICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmICFzaG91bGRTYW1wbGUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuc2FtcGxlZE91dCsrO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVHJhY2sgY2FwdHVyZWQgZXZlbnQgYnJlYWtkb3duc1xuICAgICAgICAgIGNhcHR1cmVkQnlUeXBlWyBldmVudC50eXBlIF0gPSAoY2FwdHVyZWRCeVR5cGVbIGV2ZW50LnR5cGUgXSB8fCAwKSArIDE7XG4gICAgICAgICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgICAgICAgY2FwdHVyZWRCeU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gPSAoY2FwdHVyZWRCeU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gfHwgMCkgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYXB0dXJlZEJ5TGV2ZWxbIGV2ZW50LmxldmVsIF0gPSAoY2FwdHVyZWRCeUxldmVsWyBldmVudC5sZXZlbCBdIHx8IDApICsgMTtcbiAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICAgICAgICAvLyBQYXNzZWQgYm90aCBmaWx0ZXJpbmcgYW5kIHNhbXBsaW5nIC0gZW1pdFxuICAgICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0cyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTdG9yZSBjYXB0dXJlZCBicmVha2Rvd25zIGluIGNvbnRleHQgZm9yIHN1bW1hcnkgY2hlY2twb2ludFxuICAgICAgICBpZiAoIW9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duKSB7XG4gICAgICAgICAgb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24gPSB7IGJ5VHlwZToge30sIGJ5T3BlcmF0aW9uOiB7fSwgYnlMZXZlbDoge30gfTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFsgdHlwZSwgY291bnQgXSBvZiBPYmplY3QuZW50cmllcyhjYXB0dXJlZEJ5VHlwZSkpIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieVR5cGVbIHR5cGUgXSA9IChvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieVR5cGVbIHR5cGUgXSB8fCAwKSArIGNvdW50O1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgWyBvcCwgY291bnQgXSBvZiBPYmplY3QuZW50cmllcyhjYXB0dXJlZEJ5T3BlcmF0aW9uKSkge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uWyBvcCBdID0gKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uWyBvcCBdIHx8IDApICsgY291bnQ7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBbIGxldmVsLCBjb3VudCBdIG9mIE9iamVjdC5lbnRyaWVzKGNhcHR1cmVkQnlMZXZlbCkpIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieUxldmVsWyBsZXZlbCBdID0gKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5TGV2ZWxbIGxldmVsIF0gfHwgMCkgKyBjb3VudDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gSWYgZXJyb3JPY2N1cnJlZD10cnVlLCBidWZmZXIgd2FzIGFscmVhZHkgZmx1c2hlZCBkdXJpbmcgY2FwdHVyZVxuICAgIH1cblxuICAgIC8vIEZsdXNoIGFsbCBiYWNrZW5kcyB3aXRoIHJldHJ5IGxvZ2ljXG4gICAgLy8gV3JhcCBlYWNoIGJhY2tlbmQgZmx1c2ggaW4gdHJ5LWNhdGNoIHRvIGVuc3VyZSBhbGwgYmFja2VuZHMgYXR0ZW1wdCB0byBmbHVzaFxuICAgIC8vIGV2ZW4gaWYgb25lIGZhaWxzIGNhdGFzdHJvcGhpY2FsbHlcbiAgICBjb25zdCBNQVhfRkxVU0hfUkVUUklFUyA9IDI7XG4gICAgY29uc3QgZmx1c2hQcm9taXNlcyA9IGJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFiYWNrZW5kLmZsdXNoKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChsZXQgYXR0ZW1wdCA9IDE7IGF0dGVtcHQgPD0gTUFYX0ZMVVNIX1JFVFJJRVM7IGF0dGVtcHQrKykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG4gICAgICAgICAgICBicmVhazsgLy8gU3VjY2Vzc1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAoYXR0ZW1wdCA9PT0gTUFYX0ZMVVNIX1JFVFJJRVMpIHtcbiAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmbHVzaCBmYWlsZWQgYWZ0ZXIgJHthdHRlbXB0fSBhdHRlbXB0czpgLCBlcnJvcik7XG4gICAgICAgICAgICAgIC8vIEV2ZW50cyBtYXkgYmUgbG9zdCwgYnV0IHdlJ3ZlIGRvbmUgb3VyIGJlc3RcbiAgICAgICAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBhbGxvdyBvdGhlciBiYWNrZW5kcyB0byBmbHVzaFxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGZhaWxlZCAoYXR0ZW1wdCAke2F0dGVtcHR9LyR7TUFYX0ZMVVNIX1JFVFJJRVN9KSwgcmV0cnlpbmcuLi5gLCBlcnJvcik7XG4gICAgICAgICAgICAgIC8vIFNpbXBsZSBleHBvbmVudGlhbCBiYWNrb2ZmXG4gICAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAgKiBhdHRlbXB0KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBDYXRjaCBhbnkgdW5leHBlY3RlZCBlcnJvcnMgb3V0c2lkZSB0aGUgcmV0cnkgbG9vcFxuICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGNvbXBsZXRlbHkgZmFpbGVkOmAsIGVycm9yKTtcbiAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBhbGxvdyBvdGhlciBiYWNrZW5kcyB0byBmbHVzaFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZmx1c2hQcm9taXNlcyk7XG5cbiAgICBsb2dnZXIuZGVidWcoJz09PSBGTFVTSCBDT01QTEVURSA9PT0nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldCBtYW5hZ2VyIHN0YXRlIChmb3IgdGVzdGluZylcbiAgICovXG4gIHN0YXRpYyByZXNldCgpOiB2b2lkIHtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgICBpbnZvY2F0aW9uQ291bnQgPSAwO1xuICAgIGluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgc2FtcGxpbmdSZWdleENhY2hlLmNsZWFyKCk7XG4gICAgcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID0gMDtcbiAgICByZXNldENhcHR1cmVyKCk7XG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmb3IgdGVzdGluZyB3aXRoIG1vY2sgY29uZmlnIGFuZCBiYWNrZW5kc1xuICAgKi9cbiAgc3RhdGljIGluaXRpYWxpemVGb3JUZXN0aW5nKFxuICAgIHRlc3RDb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcsXG4gICAgdGVzdEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdID0gW11cbiAgKTogdm9pZCB7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgICBjb25maWcgPSB0ZXN0Q29uZmlnO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKHRlc3RDb25maWcpO1xuICAgIGJhY2tlbmRzID0gdGVzdEJhY2tlbmRzO1xuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcblxuICAgIGluaXRpYWxpemVDYXB0dXJlcih7XG4gICAgICBjYXB0dXJlOiAoaW5wdXQpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQpLFxuICAgICAgY2FwdHVyZUFzeW5jOiAoaW5wdXQpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmVBc3luYyhpbnB1dCksXG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciB3cmFwcGVyIHdpdGggb2JzZXJ2YWJpbGl0eSBsaWZlY3ljbGUgbWFuYWdlbWVudFxuICovXG5leHBvcnQgY29uc3Qgd2l0aE9ic2VydmFiaWxpdHkgPSA8VCBleHRlbmRzICguLi5hcmdzOiB1bmtub3duW10pID0+IFByb21pc2U8dW5rbm93bj4+KGhhbmRsZXI6IFQpOiBUID0+IHtcbiAgcmV0dXJuIChhc3luYyAoLi4uYXJnczogUGFyYW1ldGVyczxUPikgPT4ge1xuICAgIHRyeSB7XG4gICAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoLi4uYXJncyk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfVxuICB9KSBhcyBUO1xufTtcblxuZXhwb3J0IGNvbnN0IE9ic2VydmVyID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXI7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gVEVTVCBFWFBPUlRTIC0gT25seSBmb3IgdGVzdGluZyBpbnRlcm5hbCBmdW5jdGlvbnNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIEV4cG9ydCBwcml2YXRlIGZ1bmN0aW9ucyBmb3IgdGVzdGluZy5cbiAqIFRoZXNlIHNob3VsZCBPTkxZIGJlIHVzZWQgaW4gdGVzdCBmaWxlcy5cbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgX190ZXN0X18gPSB7XG4gIGV2aWN0TG93ZXN0UHJpb3JpdHksXG4gIHNob3VsZEZpbHRlcixcbiAgc2hvdWxkU2FtcGxlLFxuICBnZXRFdmVudFByaW9yaXR5LFxuICBidWlsZEV2ZW50LFxufTtcbiJdfQ==