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
            // Dispatch all events - noise reduction already filtered by minLevel
            for (const bufferedEvent of reduced.events) {
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
            // Dispatch all events - noise reduction already filtered by minLevel
            await Promise.all(reduced.events.map(bufferedEvent => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILHVEQUFrRjtBQUNsRix3Q0FBMEM7QUFDMUMsbUNBU2lCO0FBRWpCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELHVDQUF3RTtBQUN4RSwyQ0FBcUU7QUFDckUsOEJBQW9DO0FBQ3BDLHlDQUFvRDtBQUNwRCx1REFBd0Q7QUFFeEQscUNBQW9GO0FBQ3BGLG1EQUFrRjtBQUNsRix5REFBdUU7QUFFdkUsTUFBTSxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLHNCQUFzQixDQUFDLENBQUM7QUFPcEQsOEVBQThFO0FBQzlFLHVCQUF1QjtBQUN2Qiw4RUFBOEU7QUFFOUUsSUFBSSxNQUFNLEdBQStCLElBQUksQ0FBQztBQUM5QyxJQUFJLFFBQVEsR0FBMkIsRUFBRSxDQUFDO0FBQzFDLElBQUksY0FBYyxHQUFHLElBQUksR0FBRyxFQUFrRCxDQUFDO0FBQy9FLElBQUksZUFBZSxHQUFHLENBQUMsQ0FBQztBQUN4QixJQUFJLFdBQVcsR0FBRyxLQUFLLENBQUM7QUFDeEIsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztBQUNyRCxNQUFNLGlCQUFpQixHQUFvQixFQUFFLENBQUMsQ0FBQyw2Q0FBNkM7QUFFNUY7OztHQUdHO0FBQ0gsTUFBTSxZQUFZLEdBQXNCLEVBQUUsQ0FBQztBQUUzQyw4RUFBOEU7QUFDOUUsMkJBQTJCO0FBQzNCLDhFQUE4RTtBQUU5RSxTQUFTLGFBQWEsQ0FBQyxLQUFtQjtJQUN4QyxNQUFNLE1BQU0sR0FBc0IsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztJQUVwQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO1FB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LEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ3ZELFlBQVksRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQztTQUNsRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUEzZUQsb0RBMmVDO0FBRUQ7O0dBRUc7QUFDSSxNQUFNLGlCQUFpQixHQUFHLENBQXFELE9BQVUsRUFBSyxFQUFFO0lBQ3JHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxJQUFtQixFQUFFLEVBQUU7UUFDdkMsSUFBSSxDQUFDO1lBQ0gsb0JBQW9CLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM1QyxPQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQyxDQUFNLENBQUM7QUFDVixDQUFDLENBQUM7QUFUVyxRQUFBLGlCQUFpQixxQkFTNUI7QUFFVyxRQUFBLFFBQVEsR0FBRyxvQkFBb0IsQ0FBQztBQUU3Qyw4RUFBOEU7QUFDOUUscURBQXFEO0FBQ3JELDhFQUE4RTtBQUU5RTs7OztHQUlHO0FBQ1UsUUFBQSxRQUFRLEdBQUc7SUFDdEIsbUJBQW1CO0lBQ25CLFlBQVk7SUFDWixZQUFZO0lBQ1osZ0JBQWdCO0lBQ2hCLFVBQVU7Q0FDWCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPYnNlcnZhYmlsaXR5TWFuYWdlciAtIENvcmUgT2JzZXJ2ZXIgZm9yIHRoZSBvYnNlcnZhYmlsaXR5IHN5c3RlbVxuICogXG4gKiBBbGwgY29uZmlnIGFuZCBiYWNrZW5kcyByZXNvbHZlZCBmcm9tIERJIC0gbm8gbWFudWFsIGluc3RhbnRpYXRpb24uXG4gKi9cblxuaW1wb3J0IHsgZ2VuZXJhdGVTcGFuSWQsIGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkIH0gZnJvbSAnLi91dGlscy9pZC1nZW5lcmF0b3InO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQge1xuICBDYXB0dXJlQ29udHJvbCxcbiAgQ2FwdHVyZUlucHV0LFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdSdWxlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB0eXBlIHsgT2JzZXJ2YWJpbGl0eVN1bW1hcnkgfSBmcm9tICcuLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvdHlwZXMnO1xuaW1wb3J0IHsgc3RyaW5nVG9MZXZlbCwgbGV2ZWxUb1N0cmluZyB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuaW1wb3J0IHsgZGV0ZWN0U291cmNlLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQgeyByZWRhY3RTZW5zaXRpdmVEYXRhIH0gZnJvbSAnLi91dGlscy9kYXRhLXByb3RlY3Rpb24nO1xuaW1wb3J0IHsgZ2V0Q3VycmVudENvbnRleHQsIGdldENvcnJlbGF0aW9uSWRJZkV4aXN0cyB9IGZyb20gJy4vY29udGV4dCc7XG5pbXBvcnQgeyBpbml0aWFsaXplQ2FwdHVyZXIsIHJlc2V0Q2FwdHVyZXIgfSBmcm9tICcuL29ic2VydmVycy9iYXNlJztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vZGknO1xuaW1wb3J0IHsgTm9Qcm92aWRlckZvdW5kRXJyb3IgfSBmcm9tICcuLi9kaS9lcnJvcnMnO1xuaW1wb3J0IHsgYXBwbHlOb2lzZVJlZHVjdGlvbiB9IGZyb20gJy4vbm9pc2UtcmVkdWN0aW9uJztcbmltcG9ydCB7IGJ1aWxkVHJhY2VHcmFwaCB9IGZyb20gJy4vdHJhY2UtZ3JhcGgnO1xuaW1wb3J0IHsgY3JlYXRlT2JzZXJ2YWJpbGl0eUNvbmZpZywgdHlwZSBPYnNlcnZhYmlsaXR5Q29uZmlnSW5wdXQgfSBmcm9tICcuL2NvbmZpZyc7XG5pbXBvcnQgeyBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZywgcnVuU3BhbkZpbmFsaXplciB9IGZyb20gJy4vcnVudGltZS1zdGF0ZSc7XG5pbXBvcnQgeyBtYXRjaGVzUGF0dGVybiwgcmVwbGFjZVBhdHRlcm4gfSBmcm9tICcuL3V0aWxzL3BhdHRlcm4tdXRpbHMnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmFiaWxpdHlNYW5hZ2VyJyk7XG5cbmludGVyZmFjZSBWYWxpZGF0aW9uRXJyb3Ige1xuICBmaWVsZDogc3RyaW5nO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBNT0RVTEUgU1RBVEVcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5sZXQgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCA9IG51bGw7XG5sZXQgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcbmxldCBiYWNrZW5kQ29uZmlncyA9IG5ldyBNYXA8c3RyaW5nLCBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnYmFja2VuZHMnIF1bIDAgXT4oKTtcbmxldCBpbnZvY2F0aW9uQ291bnQgPSAwO1xubGV0IGluaXRpYWxpemVkID0gZmFsc2U7XG5jb25zdCBzYW1wbGluZ1JlZ2V4Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUmVnRXhwPigpO1xuY29uc3QgcGVuZGluZ0Rpc3BhdGNoZXM6IFByb21pc2U8dm9pZD5bXSA9IFtdOyAvLyBUcmFjayBmaXJlLWFuZC1mb3JnZXQgcHJvbWlzZXMgZm9yIGZsdXNoKClcblxuLyoqXG4gKiBQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgLSBjYWxsYmFja3MgdGhhdCBydW4gYmVmb3JlIGJhY2tlbmRzIGFyZSBpbml0aWFsaXplZC5cbiAqIFVzZWQgdG8gcmVnaXN0ZXIgc2NoZW1hcy9zZXJ2aWNlcyBuZWVkZWQgYnkgYmFja2VuZHMgd2l0aG91dCBjaXJjdWxhciBkZXBlbmRlbmNpZXMuXG4gKi9cbmNvbnN0IHByZUluaXRIb29rczogQXJyYXk8KCkgPT4gdm9pZD4gPSBbXTtcblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIEhFTFBFUiBGVU5DVElPTlNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5mdW5jdGlvbiB2YWxpZGF0ZUlucHV0KGlucHV0OiBDYXB0dXJlSW5wdXQpOiBWYWxpZGF0aW9uRXJyb3JbXSB7XG4gIGNvbnN0IGVycm9yczogVmFsaWRhdGlvbkVycm9yW10gPSBbXTtcbiAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgaWYgKCFpbnB1dC50eXBlKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ3R5cGUnLCBtZXNzYWdlOiAndHlwZSBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmxldmVsKSB7XG4gICAgZXJyb3JzLnB1c2goeyBmaWVsZDogJ2xldmVsJywgbWVzc2FnZTogJ2xldmVsIGlzIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGlmICghaW5wdXQuY29ycmVsYXRpb25JZCAmJiAhY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgIGVycm9ycy5wdXNoKHtcbiAgICAgIGZpZWxkOiAnY29ycmVsYXRpb25JZCcsXG4gICAgICBtZXNzYWdlOiAnY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZC4gQ29udGV4dCBpcyBhdXRvLWVzdGFibGlzaGVkIGluIGNvbnRyb2xsZXJzLCBvciB1c2UgcnVuV2l0aEV4ZWN1dGlvbkNvbnRleHQoKS4nXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuXG5mdW5jdGlvbiBhcHBseURhdGFQcm90ZWN0aW9uKFxuICBpbnB1dDogQ2FwdHVyZUlucHV0LFxuICBkYXRhUHJvdGVjdGlvbj86IE9ic2VydmFiaWxpdHlDb25maWdbICdkYXRhUHJvdGVjdGlvbicgXVxuKToge1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBlcnJvcj86IE9ic2VydmFiaWxpdHlFcnJvcjtcbn0ge1xuICBpZiAoIWRhdGFQcm90ZWN0aW9uPy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6IGlucHV0LmRhdGEsXG4gICAgICBhdHRyaWJ1dGVzOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgICAgbWV0YWRhdGE6IGlucHV0Lm1ldGFkYXRhLFxuICAgICAgY29udGV4dDogaW5wdXQuY29udGV4dCxcbiAgICAgIGVycm9yOiBpbnB1dC5lcnJvcixcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZmllbGRzID0gZGF0YVByb3RlY3Rpb24uZmllbGRzID8/IFsgJ2RhdGEnLCAnYXR0cmlidXRlcycsICdtZXRhZGF0YScsICdjb250ZXh0JyBdO1xuXG4gIHJldHVybiB7XG4gICAgZGF0YTogZmllbGRzLmluY2x1ZGVzKCdkYXRhJykgJiYgaW5wdXQuZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5kYXRhLFxuICAgIGF0dHJpYnV0ZXM6IGZpZWxkcy5pbmNsdWRlcygnYXR0cmlidXRlcycpICYmIGlucHV0LmF0dHJpYnV0ZXNcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5hdHRyaWJ1dGVzLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuYXR0cmlidXRlcyxcbiAgICBtZXRhZGF0YTogZmllbGRzLmluY2x1ZGVzKCdtZXRhZGF0YScpICYmIGlucHV0Lm1ldGFkYXRhXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQubWV0YWRhdGEsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5tZXRhZGF0YSxcbiAgICBjb250ZXh0OiBmaWVsZHMuaW5jbHVkZXMoJ2NvbnRleHQnKSAmJiBpbnB1dC5jb250ZXh0XG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuY29udGV4dCwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmNvbnRleHQsXG4gICAgZXJyb3I6IGZpZWxkcy5pbmNsdWRlcygnZXJyb3InKSAmJiBpbnB1dC5lcnJvclxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmVycm9yLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZXJyb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGJ1aWxkRXZlbnQoaW5wdXQ6IENhcHR1cmVJbnB1dCwgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+IHwgbnVsbCA9IG51bGwpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBjb25zdCBjdHggPSBjb250ZXh0ID8/IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG5cbiAgY29uc3QgY29ycmVsYXRpb25JZCA9IGlucHV0LmNvcnJlbGF0aW9uSWQgPz8gY3R4Py5jb3JyZWxhdGlvbklkO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgLSB0aGlzIHNob3VsZCBoYXZlIGJlZW4gY2F1Z2h0IGJ5IHZhbGlkYXRpb24nKTtcbiAgfVxuXG4gIGNvbnN0IHsgZGF0YSwgYXR0cmlidXRlcywgbWV0YWRhdGEsIGNvbnRleHQ6IGV2ZW50Q29udGV4dCwgZXJyb3IgfSA9IGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gICAgaW5wdXQsXG4gICAgY29uZmlnPy5kYXRhUHJvdGVjdGlvblxuICApO1xuXG4gIC8vIE9wZXJhdGlvbiBub3JtYWxpemF0aW9uIChyZWR1Y2UgY2FyZGluYWxpdHkgKyBpbXByb3ZlIGNyb3NzLWJhY2tlbmQgY29uc2lzdGVuY3kpXG4gIGNvbnN0IG9wTm9ybSA9IGNvbmZpZz8ub3BlcmF0aW9uTm9ybWFsaXphdGlvbjtcbiAgbGV0IG9wZXJhdGlvbiA9IGlucHV0Lm9wZXJhdGlvbjtcbiAgbGV0IG9wZXJhdGlvbk5vcm1hbGl6YXRpb25NZXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgaWYgKG9wTm9ybT8uZW5hYmxlZCAmJiBvcGVyYXRpb24pIHtcbiAgICBjb25zdCBvcmlnaW5hbE9wZXJhdGlvbiA9IG9wZXJhdGlvbjtcbiAgICBjb25zdCBhcHBsaWVkUnVsZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgZnJvbTogc3RyaW5nOyB0bzogc3RyaW5nOyByZWFzb24/OiBzdHJpbmcgfT4gPSBbXTtcbiAgICBjb25zdCB0eXBlTWF0Y2ggPSAoXG4gICAgICBydWxlVHlwZXM6IE9ic2VydmFiaWxpdHlDb25maWdbICdvcGVyYXRpb25Ob3JtYWxpemF0aW9uJyBdWyAncnVsZXMnIF1bIG51bWJlciBdWyAndHlwZXMnIF0gfCB1bmRlZmluZWQsXG4gICAgICBldmVudFR5cGU6IHN0cmluZ1xuICAgICkgPT4ge1xuICAgICAgaWYgKCFydWxlVHlwZXMpIHJldHVybiB0cnVlO1xuICAgICAgY29uc3QgYXJyID0gQXJyYXkuaXNBcnJheShydWxlVHlwZXMpID8gcnVsZVR5cGVzIDogWyBydWxlVHlwZXMgXTtcbiAgICAgIC8vIENvbXBhcmUgYnkgc3RyaW5nIHRvIGF2b2lkIHVuc2FmZSBjYXN0aW5nIChPYnNlcnZhYmlsaXR5RXZlbnRUeXBlIGlzIHN0cmluZy1iYXNlZCBhbnl3YXkpLlxuICAgICAgcmV0dXJuIGFyci5tYXAoU3RyaW5nKS5pbmNsdWRlcyhldmVudFR5cGUpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2Ygb3BOb3JtLnJ1bGVzID8/IFtdKSB7XG4gICAgICBpZiAoIXR5cGVNYXRjaChydWxlLnR5cGVzLCBpbnB1dC50eXBlKSkgY29udGludWU7XG4gICAgICBpZiAoIW1hdGNoZXNQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgbmV4dCA9IHJlcGxhY2VQYXR0ZXJuKG9wZXJhdGlvbiwgcnVsZS5tYXRjaCwgcnVsZS5yZXBsYWNlKTtcbiAgICAgIGlmIChuZXh0ICE9PSBvcGVyYXRpb24pIHtcbiAgICAgICAgYXBwbGllZFJ1bGVzLnB1c2goeyBpZDogcnVsZS5pZCwgZnJvbTogb3BlcmF0aW9uLCB0bzogbmV4dCwgcmVhc29uOiBydWxlLnJlYXNvbiB9KTtcbiAgICAgICAgb3BlcmF0aW9uID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPbmx5IGF0dGFjaCBtZXRhIGlmIHRoZSBvcGVyYXRpb24gYWN0dWFsbHkgY2hhbmdlZFxuICAgIGlmIChvcE5vcm0uc3RvcmVPcmlnaW5hbCAhPT0gZmFsc2UgJiYgb3BlcmF0aW9uICE9PSBvcmlnaW5hbE9wZXJhdGlvbikge1xuICAgICAgb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgPSB7XG4gICAgICAgIGZyb206IG9yaWdpbmFsT3BlcmF0aW9uLFxuICAgICAgICB0bzogb3BlcmF0aW9uLFxuICAgICAgICBydWxlSWRzOiBhcHBsaWVkUnVsZXMubWFwKHIgPT4gci5pZCksXG4gICAgICAgIHJ1bGVzOiBhcHBsaWVkUnVsZXMsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICBsZXZlbDogaW5wdXQubGV2ZWwsXG4gICAgY29ycmVsYXRpb25JZCxcbiAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gbm93LFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGdlbmVyYXRlT2JzZXJ2YWJpbGl0eUxvZ0lkKGNvcnJlbGF0aW9uSWQpLFxuICAgIC8vIG51bGwgPSBleHBsaWNpdGx5IG5vIHBhcmVudCAtIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBzaG91bGQgYmUgcmVzb2x2ZWQgYnkgY2FsbGVyIChzcGFuIHRyZWUpXG4gICAgLy8gdW5kZWZpbmVkID0gdXNlIHdoYXQgd2FzIHByb3ZpZGVkXG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09IG51bGwgPyB1bmRlZmluZWQgOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgY2F1c2VkQnk6IGlucHV0LmNhdXNlZEJ5LFxuICAgIHJlbGF0ZWRUcmFjZXM6IGlucHV0LnJlbGF0ZWRUcmFjZXMsXG4gICAgYWN0b3I6IGlucHV0LmFjdG9yID8/IGN0eD8uYWN0b3IsXG4gICAgc291cmNlOiBpbnB1dC5zb3VyY2UgPz8gY3R4Py5vYnNlcnZhYmlsaXR5Py5zb3VyY2UgPz8gZGV0ZWN0U291cmNlKCksXG4gICAgdGFnczogbWVyZ2VUYWdzKHsgLi4uY3R4Py5vYnNlcnZhYmlsaXR5Py50YWdzLCAuLi5pbnB1dC50YWdzIH0sIHRydWUpLFxuICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgZW50aXR5SWQ6IGlucHV0LmVudGl0eUlkLFxuICAgIG9wZXJhdGlvbixcbiAgICBzdWJUeXBlOiBpbnB1dC5zdWJUeXBlLFxuICAgIHN0YXR1czogaW5wdXQuc3RhdHVzLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NczogaW5wdXQuZHVyYXRpb25NcyxcbiAgICBkYXRhOiBvcGVyYXRpb25Ob3JtYWxpemF0aW9uTWV0YVxuICAgICAgPyB7IC4uLihkYXRhID8/IHt9KSwgb3BlcmF0aW9uTm9ybWFsaXphdGlvbjogb3BlcmF0aW9uTm9ybWFsaXphdGlvbk1ldGEgfVxuICAgICAgOiBkYXRhLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGEsXG4gICAgbWV0cmljczogaW5wdXQubWV0cmljcyxcbiAgICBjb250ZXh0OiBldmVudENvbnRleHQsXG4gICAgZXJyb3IsXG4gICAgY2FwdHVyZTogaW5wdXQuY2FwdHVyZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXRlZ29yaXplIGV2ZW50IHR5cGUgZm9yIGJhY2tlbmQgcm91dGluZyBhbmQgc2FtcGxpbmdcbiAqIFxuICogQ3VzdG9tIGV2ZW50IHR5cGVzIGFyZSBzdXBwb3J0ZWQhIFVzZSBhbnkgbmFtaW5nIGNvbnZlbnRpb246XG4gKiAtICdidXNpbmVzcy5vcmRlcl9wbGFjZWQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAncGF5bWVudC50cmFuc2FjdGlvbicg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiAtICdub3RpZmljYXRpb24uc2VudCcg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiBcbiAqIFRvIGNvbnRyb2wgYmFja2VuZCByb3V0aW5nIGZvciBjdXN0b20gdHlwZXMsIHVzZSB0eXBlLXNwZWNpZmljIGNvbmZpZzpcbiAqIGBgYFxuICogb2JzZXJ2YWJpbGl0eToge1xuICogICB0eXBlczoge1xuICogICAgIGxvZzogeyBiYWNrZW5kczogWydjbG91ZHdhdGNoJywgJ2R5bmFtb2RiJ10gfVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZnVuY3Rpb24gZ2V0VHlwZUNhdGVnb3J5KHR5cGU6IHN0cmluZyk6ICdzcGFuJyB8ICdtZXRyaWMnIHwgJ2F1ZGl0JyB8ICdsb2cnIHtcbiAgLy8gJ3NwYW4nID0gY29uc29saWRhdGVkIHNwYW4gcmVjb3JkLCAnc3Bhbi5zdGFydCcgPSBPVEVMLW9ubHkgc3RhcnQgbWFya2VyLlxuICAvLyBGVzI0IGRvZXMgTk9UIHN1cHBvcnQgbGVnYWN5IHNwYW4uKiByZWNvcmQgZm9ybWF0cyAobm8gY29tcGF0aWJpbGl0eSBndWFyYW50ZWVzKS5cbiAgaWYgKHR5cGUgPT09ICdzcGFuJyB8fCB0eXBlID09PSAnc3Bhbi5zdGFydCcpIHJldHVybiAnc3Bhbic7XG4gIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgLy8gQWxsIGN1c3RvbSBldmVudCB0eXBlcyBkZWZhdWx0IHRvICdsb2cnIGNhdGVnb3J5XG4gIC8vIFRoaXMgaW5jbHVkZXM6ICdidXNpbmVzcy4qJywgJ3BheW1lbnQuKicsICdub3RpZmljYXRpb24uKicsIGV0Yy5cbiAgcmV0dXJuICdsb2cnO1xufVxuXG5mdW5jdGlvbiBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgaWYgKHR5cGVDb25maWc/LmJhY2tlbmRzICYmIHR5cGVDb25maWcuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSk7XG4gIH1cblxuICByZXR1cm4gYmFja2VuZHM7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYmFja2VuZCBzaG91bGQgY2FwdHVyZSB0aGlzIGV2ZW50IGJhc2VkIG9uIHR5cGUgZmlsdGVyaW5nXG4gKi9cbmZ1bmN0aW9uIHNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShcbiAgYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnRcbik6IGJvb2xlYW4ge1xuICAvLyBQZXItZXZlbnQgYmFja2VuZCBmaWx0ZXIgKHVzZWQgZm9yIE9URUwgc3BhbiB0cmFja2luZyBpbiBjb25zb2xpZGF0ZWQgbW9kZSlcbiAgaWYgKGV2ZW50LmNhcHR1cmU/LmJhY2tlbmRzICYmIGV2ZW50LmNhcHR1cmUuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIGlmICghZXZlbnQuY2FwdHVyZS5iYWNrZW5kcy5pbmNsdWRlcyhiYWNrZW5kLm5hbWUgYXMgJ2Nsb3Vkd2F0Y2gnIHwgJ2R5bmFtb2RiJyB8ICdvdGVsJykpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBiYWNrZW5kQ2ZnID0gYmFja2VuZENvbmZpZ3MuZ2V0KGJhY2tlbmQubmFtZSk7XG4gIGlmICghYmFja2VuZENmZykgcmV0dXJuIHRydWU7IC8vIE5vIGNvbmZpZyA9IGFsbG93IGFsbFxuXG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgdHlwZUZpbHRlciA9IGJhY2tlbmRDZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgLy8gQ2hlY2sgaWYgdHlwZSBpcyBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIGJhY2tlbmRcbiAgaWYgKHR5cGVGaWx0ZXI/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIENoZWNrIHBlci10eXBlIG1pbkxldmVsIChvdmVycmlkZXMgYmFja2VuZC1sZXZlbCBtaW5MZXZlbClcbiAgaWYgKHR5cGVGaWx0ZXI/Lm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnRMZXZlbCA8IHR5cGVGaWx0ZXIubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoYmFja2VuZC5taW5MZXZlbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gRmFsbCBiYWNrIHRvIGJhY2tlbmQtbGV2ZWwgbWluTGV2ZWxcbiAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBDaGVjayBwZXItdHlwZSBzYW1wbGluZ1xuICBpZiAodHlwZUZpbHRlcj8uc2FtcGxpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUZpbHRlci5zYW1wbGluZztcbiAgfVxuXG4gIHJldHVybiB0cnVlOyAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbn1cblxuLyoqXG4gKiBBcHBseSB0YWcgZmlsdGVyaW5nIHRvIGV2ZW50IGJlZm9yZSBzZW5kaW5nIHRvIGJhY2tlbmRzLlxuICogRmlsdGVycyBmcmFtZXdvcmsgdGFncyBiYXNlZCBvbiBjb25maWcsIGFkZHMgY3VzdG9tIHRhZ3MsIGVuZm9yY2VzIG1heFRhZ3MgbGltaXQuXG4gKi9cbmZ1bmN0aW9uIGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBpZiAoIWNvbmZpZz8udGFnRmlsdGVyaW5nKSByZXR1cm4gZXZlbnQ7XG5cbiAgY29uc3QgdGFnQ29uZmlnID0gY29uZmlnLnRhZ0ZpbHRlcmluZztcbiAgY29uc3QgaW5jbHVkZSA9IHRhZ0NvbmZpZy5pbmNsdWRlO1xuICBjb25zdCBtYXhUYWdzID0gdGFnQ29uZmlnLm1heFRhZ3MgPz8gMTA7XG5cbiAgLy8gS25vd24gZnJhbWV3b3JrIHRhZ3NcbiAgY29uc3QgZnJhbWV3b3JrVGFncyA9IG5ldyBTZXQoW1xuICAgICdzdGFnZScsICd0ZW5hbnRJZCcsICdvcGVyYXRpb25DYXRlZ29yeScsICdhdXRoTWV0aG9kJyxcbiAgICAnYWN0b3JUeXBlJywgJ2hhbmRsZXJUeXBlJywgJ2VudGl0eU5hbWUnLCAnb3BlcmF0aW9uJ1xuICBdKTtcblxuICBjb25zdCBmaWx0ZXJlZFRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgbGV0IHRhZ0NvdW50ID0gMDtcblxuICAvLyBGaWx0ZXIgZXhpc3RpbmcgdGFnc1xuICBpZiAoZXZlbnQudGFncykge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQudGFncykpIHtcbiAgICAgIGlmICh0YWdDb3VudCA+PSBtYXhUYWdzKSBicmVhaztcblxuICAgICAgLy8gRnJhbWV3b3JrIHRhZ3M6IG11c3QgYmUgaW4gaW5jbHVkZSBhcnJheVxuICAgICAgaWYgKGZyYW1ld29ya1RhZ3MuaGFzKGtleSkpIHtcbiAgICAgICAgaWYgKGluY2x1ZGUgJiYgIWluY2x1ZGUuaW5jbHVkZXMoa2V5KSkge1xuICAgICAgICAgIGNvbnRpbnVlOyAvLyBFeGNsdWRlZFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBVbmtub3duIHRhZ3MgKGN1c3RvbSk6IGFsd2F5cyBpbmNsdWRlXG5cbiAgICAgIC8vIENvbnZlcnQgdG8gc3RyaW5nXG4gICAgICBmaWx0ZXJlZFRhZ3NbIGtleSBdID0gdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyA/IHZhbHVlIDogU3RyaW5nKHZhbHVlKTtcbiAgICAgIHRhZ0NvdW50Kys7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGN1c3RvbSB0YWdzIGZyb20gY29uZmlnXG4gIGlmICh0YWdDb25maWcuY3VzdG9tICYmIHRhZ0NvdW50IDwgbWF4VGFncykge1xuICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlRm4gXSBvZiBPYmplY3QuZW50cmllcyh0YWdDb25maWcuY3VzdG9tKSkge1xuICAgICAgaWYgKHRhZ0NvdW50ID49IG1heFRhZ3MpIGJyZWFrO1xuICAgICAgaWYgKGZpbHRlcmVkVGFnc1sga2V5IF0gIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIEFscmVhZHkgZXhpc3RzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVGbihldmVudCk7XG4gICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgIGZpbHRlcmVkVGFnc1sga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICB0YWdDb3VudCsrO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIud2FybihgRmFpbGVkIHRvIGV2YWx1YXRlIGN1c3RvbSB0YWcgJHtrZXl9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIC4uLmV2ZW50LFxuICAgIHRhZ3M6IGZpbHRlcmVkVGFncyxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogdm9pZCB7XG4gIC8vIEFwcGx5IHRhZyBmaWx0ZXJpbmcgYmVmb3JlIHNlbmRpbmcgdG8gYmFja2VuZHNcbiAgY29uc3QgZmlsdGVyZWRFdmVudCA9IGFwcGx5VGFnRmlsdGVyaW5nKGV2ZW50KTtcblxuICBjb25zdCBwcm9taXNlID0gUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBmaWx0ZXJlZEV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlsdGVyZWRFdmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKS50aGVuKCgpID0+IHsgfSk7IC8vIENvbnZlcnQgdG8gUHJvbWlzZTx2b2lkPlxuXG4gIC8vIFRyYWNrIHByb21pc2Ugc28gZmx1c2goKSBjYW4gd2FpdCBmb3IgaXRcbiAgcGVuZGluZ0Rpc3BhdGNoZXMucHVzaChwcm9taXNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCB0YXJnZXRCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSk6IFByb21pc2U8dm9pZD4ge1xuICAvLyBBcHBseSB0YWcgZmlsdGVyaW5nIGJlZm9yZSBzZW5kaW5nIHRvIGJhY2tlbmRzXG4gIGNvbnN0IGZpbHRlcmVkRXZlbnQgPSBhcHBseVRhZ0ZpbHRlcmluZyhldmVudCk7XG5cbiAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBmaWx0ZXJlZEV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZmlsdGVyZWRFdmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gZ2V0RWZmZWN0aXZlTGV2ZWxGb3JUeXBlKHR5cGU6ICdzcGFuJyB8ICdtZXRyaWMnIHwgJ2F1ZGl0JyB8ICdsb2cnKTogT2JzZXJ2YWJpbGl0eUxldmVsIHtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZSBdO1xuICByZXR1cm4gdHlwZUNvbmZpZz8ubWluTGV2ZWwgPz8gY29uZmlnPy5taW5MZXZlbCA/PyBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTztcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhbiBldmVudCBtYXRjaGVzIGEgc2FtcGxpbmcgcnVsZVxuICovXG5mdW5jdGlvbiBtYXRjaGVzUnVsZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBydWxlOiBTYW1wbGluZ1J1bGUpOiBib29sZWFuIHtcbiAgY29uc3QgeyB0YXJnZXQsIHBhdHRlcm4gfSA9IHJ1bGU7XG5cbiAgbGV0IHZhbHVlVG9NYXRjaDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIHN3aXRjaCAodGFyZ2V0KSB7XG4gICAgY2FzZSAndGVuYW50JzpcbiAgICAgIC8vIENoZWNrIGFjdG9yLnRlbmFudElkIG9yIHRhZ3MudGVuYW50SWRcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LmFjdG9yPy50ZW5hbnRJZCA/PyBldmVudC50YWdzPy50ZW5hbnRJZDtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAncm91dGUnOlxuICAgICAgLy8gQ2hlY2sgc291cmNlIChlLmcuLCBcIk9yZGVyQ29udHJvbGxlci5jcmVhdGVcIikgb3Igb3BlcmF0aW9uXG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5zb3VyY2UgPz8gZXZlbnQub3BlcmF0aW9uO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICd0YWcnOlxuICAgICAgLy8gUGF0dGVybiBmb3JtYXQ6IFwia2V5OnZhbHVlXCIgb3IgXCJrZXk6KlwiXG4gICAgICBpZiAodHlwZW9mIHBhdHRlcm4gPT09ICdzdHJpbmcnICYmIHBhdHRlcm4uaW5jbHVkZXMoJzonKSkge1xuICAgICAgICBjb25zdCBbIGtleSwgdmFsdWVQYXR0ZXJuIF0gPSBwYXR0ZXJuLnNwbGl0KCc6JywgMik7XG4gICAgICAgIGNvbnN0IHRhZ1ZhbHVlID0gZXZlbnQudGFncz8uWyBrZXkgXTtcbiAgICAgICAgaWYgKCF0YWdWYWx1ZSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAgIGlmICh2YWx1ZVBhdHRlcm4gPT09ICcqJykgcmV0dXJuIHRydWU7XG5cbiAgICAgICAgLy8gVGVzdCBhZ2FpbnN0IHZhbHVlIHBhdHRlcm4gKHN1cHBvcnRzIHdpbGRjYXJkcylcbiAgICAgICAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgodmFsdWVQYXR0ZXJuKTtcbiAgICAgICAgcmV0dXJuIHJlZ2V4LnRlc3QodGFnVmFsdWUpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuXG4gICAgY2FzZSAnYWN0b3InOlxuICAgICAgLy8gQ2hlY2sgYWN0b3JJZCBvciBhY3RvclR5cGVcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LmFjdG9yPy5hY3RvcklkID8/IGV2ZW50LmFjdG9yPy5hY3RvclR5cGU7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3NvdXJjZSc6XG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5zb3VyY2U7XG4gICAgICBicmVhaztcblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAoIXZhbHVlVG9NYXRjaCkgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIE1hdGNoIGFnYWluc3QgcGF0dGVybiAoc3RyaW5nIG9yIFJlZ0V4cClcbiAgaWYgKHBhdHRlcm4gaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICByZXR1cm4gcGF0dGVybi50ZXN0KHZhbHVlVG9NYXRjaCk7XG4gIH1cblxuICAvLyBTdHJpbmcgcGF0dGVybiB3aXRoIHdpbGRjYXJkIHN1cHBvcnRcbiAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgocGF0dGVybik7XG4gIHJldHVybiByZWdleC50ZXN0KHZhbHVlVG9NYXRjaCk7XG59XG5cbi8qKlxuICogQ29udGVudC1iYXNlZCBmaWx0ZXJpbmcgLSBBTFdBWVMgcnVucyByZWdhcmRsZXNzIG9mIHNhbXBsaW5nLmVuYWJsZWRcbiAqIFJldHVybnMgdHJ1ZSBpZiBldmVudCBwYXNzZXMgZmlsdGVyaW5nIHJ1bGVzIChieXBhc3MsIGxldmVsLCBkdXJhdGlvbiwgZXRjLilcbiAqIFJldHVybnMgZmFsc2UgaWYgZXZlbnQgc2hvdWxkIGJlIGZpbHRlcmVkIG91dC5cbiAqL1xuZnVuY3Rpb24gc2hvdWxkRmlsdGVyKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjZmc6IE9ic2VydmFiaWxpdHlDb25maWcsXG4gIG9wdGlvbnM/OiB7XG4gICAgLyoqXG4gICAgICogV2hlbiB0cnVlLCBzcGFucyBtYXkgYmUgZHJvcHBlZCBiYXNlZCBvbiBjZmcuc3BhbnMubWluRHVyYXRpb25Ncy5cbiAgICAgKiBXaGVuIGZhbHNlLCBzcGFucyBhcmUgYWx3YXlzIGtlcHQgKG5lZWRlZCB3aGVuIHdlIGNhbm5vdCBzZWUgdGhlIGZ1bGwgcGFyZW50L2NoaWxkIGdyYXBoKS5cbiAgICAgKi9cbiAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A/OiBib29sZWFuO1xuICAgIC8qKlxuICAgICAqIFBhcmVudCBzcGFuIElEcyByZWZlcmVuY2VkIGJ5IGJ1ZmZlcmVkIGV2ZW50cy5cbiAgICAgKiBJZiBhIHNwYW4gaXMgcmVmZXJlbmNlZCBoZXJlLCBpdCBtdXN0IE5FVkVSIGJlIGRyb3BwZWQuXG4gICAgICovXG4gICAgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHM/OiBSZWFkb25seVNldDxzdHJpbmc+O1xuICB9XG4pOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkoZXZlbnQudHlwZSk7XG4gIGNvbnN0IGVmZmVjdGl2ZUxldmVsID0gZ2V0RWZmZWN0aXZlTGV2ZWxGb3JUeXBlKHR5cGVDYXRlZ29yeSk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuICBjb25zdCBpc1NwYW5SZWNvcmQgPSBldmVudC50eXBlID09PSAnc3Bhbic7XG4gIGNvbnN0IGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9IG9wdGlvbnM/LmFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcCA9PT0gdHJ1ZTtcbiAgY29uc3QgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMgPSBvcHRpb25zPy5yZWZlcmVuY2VkUGFyZW50U3BhbklkcztcblxuICAvLyA9PT0gQllQQVNTIEZJTFRFUlMgKGFsd2F5cyBwYXNzKSA9PT1cblxuICAvLyAxLiBFeHBsaWNpdCBieXBhc3MgZmxhZ1xuICBpZiAoY2FwdHVyZT8uYnlwYXNzKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAyLiBDUklUSUNBTCBsb2cgbGV2ZWwgYWx3YXlzIHBhc3Nlc1xuICBpZiAobGV2ZWxWYWx1ZSA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAzLiBFcnJvcnMgYWx3YXlzIHBhc3NcbiAgaWYgKGV2ZW50LmVycm9yIHx8IGV2ZW50LnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyA9PT0gU1BBTi1TUEVDSUZJQyBGSUxURVJJTkcgPT09XG4gIGlmIChpc1NwYW5SZWNvcmQpIHtcbiAgICAvLyBSZWZlcmVuY2VkIHBhcmVudHMgbXVzdCBiZSBrZXB0IGZvciBoaWVyYXJjaHkgaW50ZWdyaXR5XG4gICAgY29uc3QgaWQgPSBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKGlkICYmIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzPy5oYXMoaWQpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBGaWx0ZXIgb3V0IGZhc3Qgc3BhbnMgaWYgY29uZmlndXJlZFxuICAgIGlmIChhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3AgJiYgZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBtaW5EdXJhdGlvbiA9IGNhcHR1cmU/Lm1pbkR1cmF0aW9uTXMgPz8gY2ZnLnNwYW5zLm1pbkR1cmF0aW9uTXM7XG4gICAgICBpZiAobWluRHVyYXRpb24gPiAwICYmIGV2ZW50LmR1cmF0aW9uTXMgPCBtaW5EdXJhdGlvbikge1xuICAgICAgICByZXR1cm4gZmFsc2U7IC8vIFRvbyBmYXN0LCBmaWx0ZXIgb3V0XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IE5PTi1TUEFOIERVUkFUSU9OIEZJTFRFUklORyA9PT1cbiAgaWYgKCFpc1NwYW5SZWNvcmQgJiYgY2FwdHVyZT8ubWluRHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zIDwgY2FwdHVyZS5taW5EdXJhdGlvbk1zKSB7XG4gICAgICByZXR1cm4gZmFsc2U7IC8vIEJlbG93IHRocmVzaG9sZCwgZmlsdGVyIG91dFxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBMRVZFTCBGSUxURVJJTkcgPT09XG4gIC8vIFJFTU9WRUQ6IE1hbmFnZXIgbm8gbG9uZ2VyIGZpbHRlcnMgYnkgbWluTGV2ZWxcbiAgLy8gQWxsIGxldmVsLWJhc2VkIGZpbHRlcmluZyBoYXBwZW5zIGluIG5vaXNlIHJlZHVjdGlvbiBmb3IgY29udGV4dC1hd2FyZSBkZWNpc2lvbnNcblxuICAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogUHJvYmFiaWxpc3RpYyBzYW1wbGluZyAtIE9OTFkgcnVucyB3aGVuIHNhbXBsaW5nLmVuYWJsZWQ9dHJ1ZVxuICogUmV0dXJucyB0cnVlIGlmIGV2ZW50IHNob3VsZCBiZSBzYW1wbGVkIChrZXB0KSwgZmFsc2UgaWYgc2FtcGxlZCBvdXQgKGRyb3BwZWQpXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFNhbXBsZShcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnXG4pOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkoZXZlbnQudHlwZSk7XG4gIGNvbnN0IGNhcHR1cmUgPSBldmVudC5jYXB0dXJlO1xuXG4gIC8vID09PSBHUk9VUC1CQVNFRCBTQU1QTElORyAoYmF0Y2ggc2NlbmFyaW9zKSA9PT1cbiAgaWYgKGNhcHR1cmU/Lmdyb3VwKSB7XG4gICAgY29uc3QgeyBpbmRleCwgY2FwdHVyZUZpcnN0ID0gMywgc2FtcGxlUmF0ZSA9IDAuMSB9ID0gY2FwdHVyZS5ncm91cDtcblxuICAgIC8vIENhcHR1cmUgZmlyc3QgTiBpdGVtc1xuICAgIGlmIChpbmRleCA8IGNhcHR1cmVGaXJzdCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIHRoZSByZXN0IHByb2JhYmlsaXN0aWNhbGx5XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBzYW1wbGVSYXRlO1xuICB9XG5cbiAgLy8gPT09IFJVTEUtQkFTRUQgU0FNUExJTkcgKEhpZ2hlc3QgUHJpb3JpdHkpID09PVxuICBpZiAoY2ZnLnNhbXBsaW5nPy5ydWxlcyAmJiBjZmcuc2FtcGxpbmcucnVsZXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcnVsZSBvZiBjZmcuc2FtcGxpbmcucnVsZXMpIHtcbiAgICAgIGlmIChtYXRjaGVzUnVsZShldmVudCwgcnVsZSkpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBydWxlLnJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IFRZUEUtU1BFQ0lGSUMgU0FNUExJTkcgPT09XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG4gIGlmICh0eXBlQ29uZmlnPy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICB9XG5cbiAgLy8gPT09IE9QRVJBVElPTi1CQVNFRCBTQU1QTElORyA9PT1cbiAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjZmcuc2FtcGxpbmc/Lm9wZXJhdGlvbnMpIHtcbiAgICBmb3IgKGNvbnN0IFsgcGF0dGVybiwgcmF0ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGNmZy5zYW1wbGluZy5vcGVyYXRpb25zKSkge1xuICAgICAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVNhbXBsaW5nUmVnZXgocGF0dGVybik7XG4gICAgICBpZiAocmVnZXgudGVzdChldmVudC5vcGVyYXRpb24pKSB7XG4gICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyA9PT0gTEVWRUwtQkFTRUQgU0FNUExJTkcgKEZhbGxiYWNrKSA9PT1cbiAgY29uc3QgbGV2ZWxOYW1lID0gbGV2ZWxUb1N0cmluZyhsZXZlbFZhbHVlKTtcbiAgY29uc3QgcmF0ZSA9IGNmZy5zYW1wbGluZz8ucmF0ZXM/LlsgbGV2ZWxOYW1lIF07XG4gIGlmIChyYXRlID09PSB1bmRlZmluZWQgfHwgcmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJhdGUgPD0gMCkgcmV0dXJuIGZhbHNlO1xuXG4gIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbn1cblxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm46IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGNvbnN0IE1BWF9SRUdFWF9DQUNIRV9TSVpFID0gMTAwO1xuXG4gIGxldCByZWdleCA9IHNhbXBsaW5nUmVnZXhDYWNoZS5nZXQocGF0dGVybik7XG4gIGlmICghcmVnZXgpIHtcbiAgICAvLyBFdmljdCBvbGRlc3QgZW50cnkgaWYgY2FjaGUgaXMgZnVsbCAoRklGTyBldmljdGlvbilcbiAgICBpZiAoc2FtcGxpbmdSZWdleENhY2hlLnNpemUgPj0gTUFYX1JFR0VYX0NBQ0hFX1NJWkUpIHtcbiAgICAgIGNvbnN0IGZpcnN0S2V5ID0gc2FtcGxpbmdSZWdleENhY2hlLmtleXMoKS5uZXh0KCkudmFsdWU7XG4gICAgICBpZiAoZmlyc3RLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuZGVsZXRlKGZpcnN0S2V5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvXFwqL2csICcuKicpfSRgKTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuc2V0KHBhdHRlcm4sIHJlZ2V4KTtcbiAgfVxuICByZXR1cm4gcmVnZXg7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIHByaW9yaXR5IGZvciBidWZmZXIgZXZpY3Rpb24uXG4gKiBIaWdoZXIgcHJpb3JpdHkgPSBrZWVwIGluIGJ1ZmZlclxuICovXG5mdW5jdGlvbiBnZXRFdmVudFByaW9yaXR5KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBudW1iZXIge1xuICAvLyBCeXBhc3MgZXZlbnRzIE5FVkVSIGdldCBldmljdGVkIChtYXggcHJpb3JpdHkpXG4gIGlmIChldmVudC5jYXB0dXJlPy5ieXBhc3MpIHtcbiAgICByZXR1cm4gSW5maW5pdHk7XG4gIH1cblxuICAvLyBVc2UgZXhwbGljaXQgcHJpb3JpdHkgaWYgcHJvdmlkZWRcbiAgbGV0IHByaW9yaXR5ID0gZXZlbnQuY2FwdHVyZT8ucHJpb3JpdHkgPz8gMDtcblxuICBjb25zdCBsZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIEhpZ2hlciBsb2cgbGV2ZWxzID0gaGlnaGVyIHByaW9yaXR5XG4gIHByaW9yaXR5ICs9IGxldmVsICogMTA7XG5cbiAgLy8gQXVkaXQgZXZlbnRzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0JykpIHtcbiAgICBwcmlvcml0eSArPSA1MDtcbiAgfVxuXG4gIC8vIFNwYW5zIHdpdGggZXJyb3JzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ3NwYW4nKSAmJiBldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgIHByaW9yaXR5ICs9IDMwO1xuICB9XG5cbiAgLy8gTG9uZyBkdXJhdGlvbiBvcGVyYXRpb25zIGFyZSBpbnRlcmVzdGluZ1xuICBpZiAoZXZlbnQuZHVyYXRpb25NcyAmJiBldmVudC5kdXJhdGlvbk1zID4gMTAwMCkge1xuICAgIHByaW9yaXR5ICs9IDIwO1xuICB9XG5cbiAgcmV0dXJuIHByaW9yaXR5O1xufVxuXG4vKipcbiAqIEV2aWN0IGxvd2VzdCBwcmlvcml0eSBldmVudCBmcm9tIGJ1ZmZlclxuICogUmV0dXJucyBtZXRhZGF0YSBhYm91dCB0aGUgZXZpY3RlZCBldmVudCBmb3IgbG9nZ2luZ1xuICovXG5mdW5jdGlvbiBldmljdExvd2VzdFByaW9yaXR5KFxuICBidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdLFxuICBvcHRpb25zPzogeyBhbGxvd0V2aWN0U3BhbnM/OiBib29sZWFuIH1cbik6IHsgdHlwZTogc3RyaW5nOyBjb3JyZWxhdGlvbklkOiBzdHJpbmc7IG9wZXJhdGlvbj86IHN0cmluZzsgbGV2ZWw6IHN0cmluZzsgcmVtb3ZlZENvdW50PzogbnVtYmVyIH0gfCBudWxsIHtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFsbG93RXZpY3RTcGFucyA9IG9wdGlvbnM/LmFsbG93RXZpY3RTcGFucyA9PT0gdHJ1ZTtcblxuICAvLyBTVFJJQ1QgVFJFRSBFVklDVElPTjpcbiAgLy8gV2hlbiB0aGUgYnVmZmVyIGlzIGZ1bGwsIHdlIE1VU1QgTk9UIGV2aWN0IGEgcGFyZW50IHNwYW4gd2hpbGUga2VlcGluZyBpdHMgY2hpbGRyZW4sXG4gIC8vIG90aGVyd2lzZSBmbHVzaCgpIHdpbGwgZW1pdCBgb2JzZXJ2YWJpbGl0eS5pbnZhcmlhbnRfdmlvbGF0aW9uLm1pc3NpbmdfcGFyZW50X3NwYW5gLlxuICAvL1xuICAvLyBXZSBzb2x2ZSB0aGlzIGxpa2UgYSByZWFsIHRyZWUgcHJvYmxlbTpcbiAgLy8gMSkgUHJlZmVyIGV2aWN0aW5nIFwibGVhZlwiIGV2ZW50czogZXZlbnRzIHRoYXQgYXJlIE5PVCByZWZlcmVuY2VkIGFzIGEgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkIGJ5IGFueSBvdGhlciBidWZmZXJlZCBldmVudC5cbiAgLy8gMikgUHJlZmVyIGV2aWN0aW5nIG5vbi1zcGFuIGxlYXZlcyAobG9ncy9tZXRyaWNzKSBiZWZvcmUgc3BhbnMuXG4gIC8vIDMpIElmIG5vIGxlYXZlcyBleGlzdCAocmFyZSksIGV2aWN0IGFuIGV2ZW50IEFORCBpdHMgd2hvbGUgZGVzY2VuZGFudCBzdWJ0cmVlIHNvIG5vIG9ycGhhbnMgcmVtYWluLlxuXG4gIGNvbnN0IHJlZmVyZW5jZWRBc1BhcmVudCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBjaGlsZHJlbkJ5UGFyZW50ID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlFdmVudFtdPigpO1xuICBmb3IgKGNvbnN0IGUgb2YgYnVmZmVyKSB7XG4gICAgY29uc3QgcGlkID0gZS5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPz8gdW5kZWZpbmVkO1xuICAgIGlmICh0eXBlb2YgcGlkID09PSAnc3RyaW5nJyAmJiBwaWQubGVuZ3RoID4gMCkge1xuICAgICAgcmVmZXJlbmNlZEFzUGFyZW50LmFkZChwaWQpO1xuICAgICAgY29uc3QgYXJyID0gY2hpbGRyZW5CeVBhcmVudC5nZXQocGlkKTtcbiAgICAgIGlmIChhcnIpIGFyci5wdXNoKGUpO1xuICAgICAgZWxzZSBjaGlsZHJlbkJ5UGFyZW50LnNldChwaWQsIFsgZSBdKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpc1NwYW4gPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLnR5cGUgPT09ICdzcGFuJyB8fCBlLnR5cGUgPT09ICdzcGFuLnN0YXJ0JztcbiAgY29uc3QgZ2V0SWQgPSAoZTogT2JzZXJ2YWJpbGl0eUV2ZW50KSA9PiBlLm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgY29uc3QgaXNMZWFmID0gKGU6IE9ic2VydmFiaWxpdHlFdmVudCkgPT4ge1xuICAgIGNvbnN0IGlkID0gZ2V0SWQoZSk7XG4gICAgaWYgKCFpZCkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuICFyZWZlcmVuY2VkQXNQYXJlbnQuaGFzKGlkKTtcbiAgfTtcblxuICBjb25zdCBwaWNrTG93ZXN0ID0gKGNhbmRpZGF0ZXM6IE9ic2VydmFiaWxpdHlFdmVudFtdKSA9PiB7XG4gICAgbGV0IGlkeCA9IC0xO1xuICAgIGxldCBsb3dlc3QgPSBJbmZpbml0eTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNhbmRpZGF0ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHAgPSBnZXRFdmVudFByaW9yaXR5KGNhbmRpZGF0ZXNbIGkgXSk7XG4gICAgICBpZiAocCA8IGxvd2VzdCkge1xuICAgICAgICBsb3dlc3QgPSBwO1xuICAgICAgICBpZHggPSBpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gaWR4O1xuICB9O1xuXG4gIC8vIElmIHNwYW5zIGFyZSBub3QgYWxsb3dlZCB0byBiZSBldmljdGVkLCBjb25zdHJhaW4gY2FuZGlkYXRlcyB0byBub24tc3BhbiBldmVudHMgb25seS5cbiAgY29uc3Qgbm9uU3BhbnMgPSBidWZmZXIuZmlsdGVyKChlKSA9PiAhaXNTcGFuKGUpKTtcblxuICAvLyBQYXNzIDE6IG5vbi1zcGFuIGxlYXZlc1xuICBjb25zdCBub25TcGFuTGVhdmVzID0gbm9uU3BhbnMuZmlsdGVyKChlKSA9PiBpc0xlYWYoZSkpO1xuICBsZXQgdGFyZ2V0OiBPYnNlcnZhYmlsaXR5RXZlbnQgfCB1bmRlZmluZWQ7XG4gIGlmIChub25TcGFuTGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KG5vblNwYW5MZWF2ZXMpO1xuICAgIHRhcmdldCA9IG5vblNwYW5MZWF2ZXNbIGlkeCBdO1xuICB9IGVsc2Uge1xuICAgIGlmICghYWxsb3dFdmljdFNwYW5zKSB7XG4gICAgICAvLyBQYXNzIDIgKG5vbi1zcGFuIG9ubHkpOiBldmljdCBsb3dlc3QtcHJpb3JpdHkgbm9uLXNwYW4gdGhhdCBkb2Vzbid0IGhhdmUgc3BhbiBjaGlsZHJlbi5cbiAgICAgIC8vIFdlIG11c3QgY2hlY2sgZm9yIHNwYW4gY2hpbGRyZW4gYmVjYXVzZSBzdWJ0cmVlIHJlbW92YWwgd291bGQgZXZpY3QgdGhvc2Ugc3BhbnMsXG4gICAgICAvLyB2aW9sYXRpbmcgdGhlIGFsbG93RXZpY3RTcGFucz1mYWxzZSBjb250cmFjdC5cbiAgICAgIGlmIChub25TcGFucy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIEZpbHRlciB0byBvbmx5IG5vbi1zcGFucyB0aGF0IGFyZSBzYWZlIHRvIGV2aWN0IChubyBzcGFuIGNoaWxkcmVuKVxuICAgICAgICBjb25zdCBzYWZlTm9uU3BhbnMgPSBub25TcGFucy5maWx0ZXIoZSA9PiB7XG4gICAgICAgICAgY29uc3QgaWQgPSBnZXRJZChlKTtcbiAgICAgICAgICBpZiAoIWlkKSByZXR1cm4gdHJ1ZTsgLy8gTm8gSUQgPSBubyBjaGlsZHJlblxuICAgICAgICAgIGNvbnN0IGtpZHMgPSBjaGlsZHJlbkJ5UGFyZW50LmdldChpZCk7XG4gICAgICAgICAgaWYgKCFraWRzKSByZXR1cm4gdHJ1ZTsgLy8gTm8gY2hpbGRyZW4gPSBzYWZlXG4gICAgICAgICAgLy8gUmVqZWN0IGlmIGFueSBjaGlsZCBpcyBhIHNwYW5cbiAgICAgICAgICByZXR1cm4gIWtpZHMuc29tZShjaGlsZCA9PiBpc1NwYW4oY2hpbGQpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHNhZmVOb25TcGFucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgaWR4ID0gcGlja0xvd2VzdChzYWZlTm9uU3BhbnMpO1xuICAgICAgICAgIHRhcmdldCA9IHNhZmVOb25TcGFuc1sgaWR4IF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gQWxsIG5vbi1zcGFucyBoYXZlIHNwYW4gY2hpbGRyZW4gLSBjYW5ub3QgZXZpY3Qgd2l0aG91dCB2aW9sYXRpbmcgYWxsb3dFdmljdFNwYW5zXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEJ1ZmZlciBjb250YWlucyBvbmx5IHNwYW5zIC0gY2FsbGVyIG11c3QgZGVjaWRlIHdoZXRoZXIgdG8gYWxsb3cgc3BhbiBldmljdGlvbiBvciBvdmVyZmxvdy5cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFBhc3MgMjogYW55IGxlYXZlcyAoaW5jbHVkaW5nIHNwYW5zKVxuICAgICAgY29uc3QgYW55TGVhdmVzID0gYnVmZmVyLmZpbHRlcigoZSkgPT4gaXNMZWFmKGUpKTtcbiAgICAgIGlmIChhbnlMZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGFueUxlYXZlcyk7XG4gICAgICAgIHRhcmdldCA9IGFueUxlYXZlc1sgaWR4IF07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBQYXNzIDM6IG5vIGxlYXZlcyBleGlzdCAoY3ljbGUvZGVnZW5lcmF0ZSkuIFBpY2sgdGhlIG92ZXJhbGwgbG93ZXN0LXByaW9yaXR5IGV2ZW50LlxuICAgICAgICBjb25zdCBpZHggPSBwaWNrTG93ZXN0KGJ1ZmZlcik7XG4gICAgICAgIHRhcmdldCA9IGJ1ZmZlclsgaWR4IF07XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0YXJnZXQpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHRhcmdldElkID0gZ2V0SWQodGFyZ2V0KTtcbiAgbGV0IHJlbW92ZWRDb3VudCA9IDA7XG5cbiAgLy8gSWYgdGFyZ2V0IGlzIHJlZmVyZW5jZWQgYXMgYSBwYXJlbnQsIHJlbW92ZSBpdHMgZW50aXJlIHN1YnRyZWUgKEJGUykuXG4gIGNvbnN0IHRvUmVtb3ZlID0gbmV3IFNldDxPYnNlcnZhYmlsaXR5RXZlbnQ+KCk7XG4gIGNvbnN0IHF1ZXVlOiBPYnNlcnZhYmlsaXR5RXZlbnRbXSA9IFsgdGFyZ2V0IF07XG4gIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgY3VyID0gcXVldWUuc2hpZnQoKSE7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhjdXIpKSBjb250aW51ZTtcbiAgICB0b1JlbW92ZS5hZGQoY3VyKTtcbiAgICBjb25zdCBjdXJJZCA9IGdldElkKGN1cik7XG4gICAgaWYgKGN1cklkKSB7XG4gICAgICBjb25zdCBraWRzID0gY2hpbGRyZW5CeVBhcmVudC5nZXQoY3VySWQpO1xuICAgICAgaWYgKGtpZHMpIHF1ZXVlLnB1c2goLi4ua2lkcyk7XG4gICAgfVxuICB9XG5cbiAgLy8gRmlsdGVyIGJ1ZmZlciBpbi1wbGFjZVxuICBmb3IgKGxldCBpID0gYnVmZmVyLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgaWYgKHRvUmVtb3ZlLmhhcyhidWZmZXJbIGkgXSkpIHtcbiAgICAgIGJ1ZmZlci5zcGxpY2UoaSwgMSk7XG4gICAgICByZW1vdmVkQ291bnQrKztcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHR5cGU6IHRhcmdldC50eXBlLFxuICAgIGNvcnJlbGF0aW9uSWQ6IHRhcmdldC5jb3JyZWxhdGlvbklkLFxuICAgIG9wZXJhdGlvbjogdGFyZ2V0Lm9wZXJhdGlvbixcbiAgICBsZXZlbDogdGFyZ2V0LmxldmVsLFxuICAgIHJlbW92ZWRDb3VudCxcbiAgfTtcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKHN5bmMgdmVyc2lvbilcbiAqIFJldHVybnM6ICdjYXB0dXJlZCcgaWYgZXZlbnQgd2FzIGNhcHR1cmVkLCAnYnVmZmVyZWQnIGlmIGJ1ZmZlcmVkLCAnc2tpcCcgaWYgbm90IHVzaW5nIHRhaWwtYmFzZWRcbiAqL1xuZnVuY3Rpb24gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdTeW5jKFxuICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD5cbik6ICdjYXB0dXJlZCcgfCAnYnVmZmVyZWQnIHwgJ3NraXAnIHtcbiAgY29uc3QgY2ZnID0gY29uZmlnO1xuICBpZiAoIWNmZykgcmV0dXJuICdza2lwJztcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yUG9saWN5ID0gY2ZnLm5vaXNlUmVkdWN0aW9uLmVuYWJsZWQ7XG4gIGNvbnN0IHNob3VsZEJ1ZmZlckZvclNhbXBsaW5nID0gISFjZmcuc2FtcGxpbmc/LnNtYXJ0O1xuICBpZiAoKCFzaG91bGRCdWZmZXJGb3JTYW1wbGluZyAmJiAhc2hvdWxkQnVmZmVyRm9yUG9saWN5KSB8fCAhY29udGV4dCkge1xuICAgIHJldHVybiAnc2tpcCc7XG4gIH1cblxuICBjb25zdCBpc0Vycm9yID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCkgPj0gT2JzZXJ2YWJpbGl0eUxldmVsLkVSUk9SO1xuXG4gIC8vIEVSUk9SIFBBVEg6IEZsdXNoIGJ1ZmZlciArIGNhcHR1cmUgZXJyb3IgKyBzZXQgZmxhZ1xuICBpZiAoaXNFcnJvcikge1xuICAgIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICAgIGlmIChvYnNTdGF0ZS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgb2JzU3RhdGUuYnVmZmVyID0gW107XG5cbiAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY2ZnLm5vaXNlUmVkdWN0aW9uKTtcblxuICAgICAgLy8gRGlzcGF0Y2ggYWxsIGV2ZW50cyAtIG5vaXNlIHJlZHVjdGlvbiBhbHJlYWR5IGZpbHRlcmVkIGJ5IG1pbkxldmVsXG4gICAgICBmb3IgKGNvbnN0IGJ1ZmZlcmVkRXZlbnQgb2YgcmVkdWNlZC5ldmVudHMpIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICBkaXNwYXRjaFRvQmFja2VuZHMoYnVmZmVyZWRFdmVudCwgdGFyZ2V0cyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgb2JzU3RhdGUuZXJyb3JPY2N1cnJlZCA9IHRydWU7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgb2JzU3RhdGUuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBQT1NULUVSUk9SIFBBVEg6IENhcHR1cmUgaW1tZWRpYXRlbHlcbiAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eS5lcnJvck9jY3VycmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5LnN1bW1hcnkuY2FwdHVyZWQrKztcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gTk9STUFMIFBBVEg6IEJ1ZmZlciBldmVyeXRoaW5nIChmaWx0ZXJpbmcgaGFwcGVucyBBRlRFUiBub2lzZSByZWR1Y3Rpb24pXG4gIGNvbnN0IG9ic1N0YXRlID0gY29udGV4dC5vYnNlcnZhYmlsaXR5O1xuICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNmZy5zYW1wbGluZz8ubWF4QnVmZmVyU2l6ZSA/PyAxMDAwO1xuICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBtYXhTaXplKSB7XG4gICAgLy8gSU1QT1JUQU5UOlxuICAgIC8vIER1cmluZyBidWZmZXJpbmcgKG5vaXNlIHJlZHVjdGlvbiAvIHNtYXJ0IHNhbXBsaW5nKSwgc3BhbnMgbWF5IGJlIGVtaXR0ZWQgQUZURVIgdGhlaXIgY2hpbGRyZW4uXG4gICAgLy8gRXZpY3Rpbmcgc3BhbnMgb3Bwb3J0dW5pc3RpY2FsbHkgY2FuIHRoZXJlZm9yZSBjcmVhdGUgZnV0dXJlIG9ycGhhbiBjaGlsZHJlbiAobWlzc2luZ19wYXJlbnRfc3BhbikuXG4gICAgLy8gUHJlZmVyIGV2aWN0aW5nIG5vbi1zcGFuIGV2ZW50cyBvbmx5OyBpZiB0aGUgYnVmZmVyIGlzIHNwYW5zLW9ubHksIGFsbG93IGJvdW5kZWQgb3ZlcmZsb3cuXG4gICAgY29uc3QgZXZpY3RlZEluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlciwgeyBhbGxvd0V2aWN0U3BhbnM6IGZhbHNlIH0pO1xuICAgIGlmIChldmljdGVkSW5mbykge1xuICAgICAgb2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkKys7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFNwYW5zLW9ubHkgb3ZlcmZsb3c6IGFsbG93IGJ1ZmZlciBncm93dGggdXAgdG8gMnggYmVmb3JlIGV2aWN0aW5nIHNwYW4gc3VidHJlZXMuXG4gICAgICBjb25zdCBoYXJkQ2FwID0gbWF4U2l6ZSAqIDI7XG4gICAgICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBoYXJkQ2FwKSB7XG4gICAgICAgIGNvbnN0IGV2aWN0ZWRTcGFuSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyLCB7IGFsbG93RXZpY3RTcGFuczogdHJ1ZSB9KTtcbiAgICAgICAgaWYgKGV2aWN0ZWRTcGFuSW5mbykge1xuICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTG9nIHdhcm5pbmcgd2l0aCBldmljdGVkIGV2ZW50IGRldGFpbHNcbiAgICBpZiAob2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkID09PSAxIHx8IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCAlIDEwMCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ09ic2VydmFiaWxpdHkgYnVmZmVyIGZ1bGwsIGV2aWN0aW5nIGxvd2VzdCBwcmlvcml0eSBldmVudHMnLCB7XG4gICAgICAgIGV2aWN0ZWQ6IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCxcbiAgICAgICAgYnVmZmVyU2l6ZTogYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgICBldmljdGVkRXZlbnQ6IGV2aWN0ZWRJbmZvLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChldmljdGVkSW5mbykge1xuICAgICAgLy8gTG9nIGVhY2ggZXZpY3Rpb24gYXQgZGVidWcgbGV2ZWwgZm9yIHRyb3VibGVzaG9vdGluZ1xuICAgICAgbG9nZ2VyLmRlYnVnKCdFdmljdGVkIG9ic2VydmFiaWxpdHkgZXZlbnQgZnJvbSBidWZmZXInLCB7XG4gICAgICAgIC4uLmV2aWN0ZWRJbmZvLFxuICAgICAgICB0b3RhbEV2aWN0ZWQ6IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGJ1ZmZlci5wdXNoKGV2ZW50KTtcbiAgb2JzU3RhdGUuc3VtbWFyeS5idWZmZXJlZCsrO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKGFzeW5jIHZlcnNpb24pXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PlxuKTogUHJvbWlzZTwnY2FwdHVyZWQnIHwgJ2J1ZmZlcmVkJyB8ICdza2lwJz4ge1xuICBjb25zdCBjZmcgPSBjb25maWc7XG4gIGlmICghY2ZnKSByZXR1cm4gJ3NraXAnO1xuICBjb25zdCBzaG91bGRCdWZmZXJGb3JQb2xpY3kgPSBjZmcubm9pc2VSZWR1Y3Rpb24uZW5hYmxlZDtcbiAgY29uc3Qgc2hvdWxkQnVmZmVyRm9yU2FtcGxpbmcgPSAhIWNmZy5zYW1wbGluZz8uc21hcnQ7XG4gIGlmICgoIXNob3VsZEJ1ZmZlckZvclNhbXBsaW5nICYmICFzaG91bGRCdWZmZXJGb3JQb2xpY3kpIHx8ICFjb250ZXh0KSB7XG4gICAgcmV0dXJuICdza2lwJztcbiAgfVxuXG4gIGNvbnN0IGlzRXJyb3IgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKSA+PSBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1I7XG5cbiAgLy8gRVJST1IgUEFUSDogRmx1c2ggYnVmZmVyICsgY2FwdHVyZSBlcnJvciArIHNldCBmbGFnXG4gIGlmIChpc0Vycm9yKSB7XG4gICAgY29uc3Qgb2JzU3RhdGUgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHk7XG4gICAgaWYgKG9ic1N0YXRlLmJ1ZmZlci5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBidWZmZXIgPSBvYnNTdGF0ZS5idWZmZXI7XG4gICAgICBvYnNTdGF0ZS5idWZmZXIgPSBbXTtcblxuICAgICAgY29uc3QgcmVkdWNlZCA9IGFwcGx5Tm9pc2VSZWR1Y3Rpb24oYnVmZmVyLCBjZmcubm9pc2VSZWR1Y3Rpb24pO1xuXG4gICAgICAvLyBEaXNwYXRjaCBhbGwgZXZlbnRzIC0gbm9pc2UgcmVkdWN0aW9uIGFscmVhZHkgZmlsdGVyZWQgYnkgbWluTGV2ZWxcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKHJlZHVjZWQuZXZlbnRzLm1hcChidWZmZXJlZEV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICByZXR1cm4gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBvYnNTdGF0ZS5lcnJvck9jY3VycmVkID0gdHJ1ZTtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgb2JzU3RhdGUuc3VtbWFyeS5jYXB0dXJlZCsrO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBQT1NULUVSUk9SIFBBVEg6IENhcHR1cmUgaW1tZWRpYXRlbHlcbiAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eS5lcnJvck9jY3VycmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZ1xuICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuXG4gIC8vIEJ1ZmZlciBzaXplIG1hbmFnZW1lbnQ6IGV2aWN0IGxvd2VzdCBwcmlvcml0eSBpZiBmdWxsXG4gIGNvbnN0IG1heFNpemUgPSBjZmcuc2FtcGxpbmc/Lm1heEJ1ZmZlclNpemUgPz8gMTAwMDtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gbWF4U2l6ZSkge1xuICAgIGNvbnN0IGV2aWN0ZWRJbmZvID0gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXIsIHsgYWxsb3dFdmljdFNwYW5zOiBmYWxzZSB9KTtcbiAgICBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBoYXJkQ2FwID0gbWF4U2l6ZSAqIDI7XG4gICAgICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBoYXJkQ2FwKSB7XG4gICAgICAgIGNvbnN0IGV2aWN0ZWRTcGFuSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyLCB7IGFsbG93RXZpY3RTcGFuczogdHJ1ZSB9KTtcbiAgICAgICAgaWYgKGV2aWN0ZWRTcGFuSW5mbykge1xuICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCsrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTG9nIHdhcm5pbmcgaWYgZXZpY3RpbmcgYSBsb3RcbiAgICBpZiAob2JzU3RhdGUuc3VtbWFyeS5ldmljdGVkID09PSAxIHx8IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCAlIDEwMCA9PT0gMCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ09ic2VydmFiaWxpdHkgYnVmZmVyIGZ1bGwsIGV2aWN0aW5nIGxvd2VzdCBwcmlvcml0eSBldmVudHMnLCB7XG4gICAgICAgIGV2aWN0ZWQ6IG9ic1N0YXRlLnN1bW1hcnkuZXZpY3RlZCxcbiAgICAgICAgYnVmZmVyU2l6ZTogYnVmZmVyLmxlbmd0aCxcbiAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBidWZmZXIucHVzaChldmVudCk7XG4gIG9ic1N0YXRlLnN1bW1hcnkuYnVmZmVyZWQrKztcbiAgcmV0dXJuICdidWZmZXJlZCc7XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBzb3VyY2UtbWFwLXN1cHBvcnQgaWYgZW5hYmxlZCBpbiBjb25maWdcbiAqIFByb3ZpZGVzIGJldHRlciBzdGFjayB0cmFjZXMgZm9yIFR5cGVTY3JpcHQvdHJhbnNwaWxlZCBjb2RlIGluIHByb2R1Y3Rpb25cbiAqL1xuZnVuY3Rpb24gaW5pdGlhbGl6ZVNvdXJjZU1hcFN1cHBvcnQoY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogdm9pZCB7XG4gIGlmICghY2ZnLnNvdXJjZU1hcC5lbmFibGVkKSB7XG4gICAgbG9nZ2VyLmRlYnVnKCdTb3VyY2UgbWFwIHN1cHBvcnQgZGlzYWJsZWQgaW4gY29uZmlnJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0F0dGVtcHRpbmcgdG8gbG9hZCBzb3VyY2UtbWFwLXN1cHBvcnQuLi4nKTtcbiAgICAvLyBEeW5hbWljIGltcG9ydCB0byBhdm9pZCBidW5kbGluZyBpZiBub3QgbmVlZGVkXG4gICAgcmVxdWlyZSgnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJyk7XG4gICAgbG9nZ2VyLmRlYnVnKCdTb3VyY2UgbWFwIHN1cHBvcnQgZW5hYmxlZCAtIHN0YWNrIHRyYWNlcyB3aWxsIHNob3cgb3JpZ2luYWwgVHlwZVNjcmlwdCBsaW5lcycpO1xuICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgIC8vIE5vdCBhIGNyaXRpY2FsIGVycm9yIC0gb2JzZXJ2YWJpbGl0eSBzdGlsbCB3b3JrcyB3aXRob3V0IHNvdXJjZSBtYXBzXG4gICAgaWYgKGVycm9yICYmIHR5cGVvZiBlcnJvciA9PT0gJ29iamVjdCcgJiYgJ2NvZGUnIGluIGVycm9yICYmIChlcnJvciBhcyB7IGNvZGU/OiB1bmtub3duIH0pLmNvZGUgPT09ICdNT0RVTEVfTk9UX0ZPVU5EJykge1xuICAgICAgbG9nZ2VyLndhcm4oXG4gICAgICAgICdzb3VyY2UtbWFwLXN1cHBvcnQgcGFja2FnZSBub3QgZm91bmQuIEluc3RhbGwgaXQgZm9yIGJldHRlciBlcnJvciBzdGFjayB0cmFjZXM6IG5wbSBpbnN0YWxsIHNvdXJjZS1tYXAtc3VwcG9ydCdcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG1zZyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGxvZ2dlci53YXJuKCdGYWlsZWQgdG8gbG9hZCBzb3VyY2UtbWFwLXN1cHBvcnQ6JywgbXNnKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIGJhY2tlbmRzIGZyb20gREkgYmFzZWQgb24gY29uZmlnXG4gKi9cbmZ1bmN0aW9uIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY2ZnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogdm9pZCB7XG4gIGJhY2tlbmRzID0gW107XG4gIGJhY2tlbmRDb25maWdzLmNsZWFyKCk7XG4gIGNvbnN0IGVuYWJsZWRCYWNrZW5kcyA9IGNmZy5iYWNrZW5kcy5maWx0ZXIoYiA9PiBiLmVuYWJsZWQgIT09IGZhbHNlKTtcblxuICBmb3IgKGNvbnN0IGJhY2tlbmRDZmcgb2YgZW5hYmxlZEJhY2tlbmRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJhY2tlbmQgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmU8T2JzZXJ2YWJpbGl0eUJhY2tlbmQ+KFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICAgICAgICB7IHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsIGJhY2tlbmRDZmcudHlwZSBdIH1cbiAgICAgICk7XG4gICAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICAgICAgYmFja2VuZENvbmZpZ3Muc2V0KGJhY2tlbmQubmFtZSwgYmFja2VuZENmZyk7XG4gICAgICBsb2dnZXIuZGVidWcoYEluaXRpYWxpemVkIGJhY2tlbmQ6ICR7YmFja2VuZC5uYW1lfWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBOb1Byb3ZpZGVyRm91bmRFcnJvcikge1xuICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAnJHtiYWNrZW5kQ2ZnLnR5cGV9JyBub3QgZm91bmQgaW4gREksIHNraXBwaW5nYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGJhY2tlbmQgJyR7YmFja2VuZENmZy50eXBlfSc6YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmIChiYWNrZW5kcy5sZW5ndGggPT09IDApIHtcbiAgICAvLyBTb2Z0LWZhaWw6IGRvIE5PVCB0aHJvdyBhbmQgYnJlYWsgYXBwbGljYXRpb24gZmxvdy5cbiAgICAvLyBXaXRob3V0IGJhY2tlbmRzLCBjYXB0dXJlIGJlY29tZXMgYSBuby1vcCBmb3IgdGhpcyBpbnZvY2F0aW9uIChldmVudHMgYXJlIGRyb3BwZWQpLlxuICAgIGxvZ2dlci5lcnJvcignT2JzZXJ2YWJpbGl0eSBtaXNjb25maWd1cmVkOiBubyBlbmFibGVkL2F2YWlsYWJsZSBiYWNrZW5kcyB3ZXJlIHJlc29sdmVkIGZyb20gREkuIE9ic2VydmFiaWxpdHkgd2lsbCBiZSBkaXNhYmxlZCBmb3IgdGhpcyBpbnZvY2F0aW9uLicsIHtcbiAgICAgIGVuYWJsZWRCYWNrZW5kVHlwZXM6IGVuYWJsZWRCYWNrZW5kcy5tYXAoYiA9PiBiLnR5cGUpLFxuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIGRvSW5pdGlhbGl6ZSgpOiB2b2lkIHtcbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIFNUQVJUID09PScpO1xuXG4gICAgLy8gUnVuIHByZS1pbml0aWFsaXphdGlvbiBob29rcyAoZS5nLiwgc2NoZW1hIHJlZ2lzdHJhdGlvbilcbiAgICBpZiAocHJlSW5pdEhvb2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgUnVubmluZyAke3ByZUluaXRIb29rcy5sZW5ndGh9IHByZS1pbml0aWFsaXphdGlvbiBob29rKHMpLi4uYCk7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgcHJlSW5pdEhvb2tzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaG9vaygpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGxvZ2dlci5lcnJvcignUHJlLWluaXRpYWxpemF0aW9uIGhvb2sgZmFpbGVkOicsIGVycm9yKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgbG9nZ2VyLmRlYnVnKCdQcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBjb25maWcgaW5wdXQgZnJvbSBESSwgdGhlbiBub3JtYWxpemUgaW50byBhIGZ1bGx5LWRlZmluZWQgT2JzZXJ2YWJpbGl0eUNvbmZpZy5cbiAgICAvLyBUaGlzIGF2b2lkcyB1bnNhZmUgY2FzdHMgYW5kIGVuc3VyZXMgdGhlIHNoYXBlIGlzIGNvbnNpc3RlbnQgZXZlbiB3aGVuIGFwcHMgb3ZlcnJpZGUgcGFydGlhbGx5LlxuICAgIGNvbnN0IGlucHV0ID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlQ29uZmlnPE9ic2VydmFiaWxpdHlDb25maWdJbnB1dD4oJ29ic2VydmFiaWxpdHknKTtcbiAgICBjb25maWcgPSBjcmVhdGVPYnNlcnZhYmlsaXR5Q29uZmlnKGlucHV0KTtcbiAgICBzZXRDdXJyZW50T2JzZXJ2YWJpbGl0eUNvbmZpZyhjb25maWcpO1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eSBjb25maWcgbG9hZGVkIGZyb20gREknLCB7XG4gICAgICBlbmFibGVkOiBjb25maWcuZW5hYmxlZCxcbiAgICAgIHNlcnZpY2VOYW1lOiBjb25maWcuc2VydmljZU5hbWUsXG4gICAgICBiYWNrZW5kczogY29uZmlnLmJhY2tlbmRzPy5tYXAoYiA9PiBiLnR5cGUpLFxuICAgICAgc2FtcGxpbmc6IHsgZW5hYmxlZDogY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkLCBzbWFydDogY29uZmlnLnNhbXBsaW5nPy5zbWFydCB9LFxuICAgICAgc291cmNlTWFwOiBjb25maWcuc291cmNlTWFwPy5lbmFibGVkLFxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBzb3VyY2UtbWFwLXN1cHBvcnQgZm9yIGJldHRlciBzdGFjayB0cmFjZXMgKGlmIGVuYWJsZWQpXG4gICAgaW5pdGlhbGl6ZVNvdXJjZU1hcFN1cHBvcnQoY29uZmlnKTtcblxuICAgIC8vIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESVxuICAgIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY29uZmlnISk7XG5cbiAgICAvLyBSZWdpc3RlciBjYXB0dXJlciBmb3Igb2JzZXJ2ZXJzXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCkgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0KSxcbiAgICB9KTtcblxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIENPTVBMRVRFID09PScpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignISEhIE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gRkFJTEVEICEhIScsIGVycm9yKTtcbiAgICAvLyBTb2Z0LWZhaWw6IGRvIE5PVCB0aHJvdyBpbnRvIGFwcGxpY2F0aW9uIGZsb3cuXG4gICAgLy8gTWFyayBpbml0aWFsaXplZCB0byBwcmV2ZW50IHJlcGVhdGVkIGluaXQgYXR0ZW1wdHM7IGxlYXZlIGNhcHR1cmVyIHVuaW5pdGlhbGl6ZWQgc28gb2JzZXJ2ZXJzIGRyb3AgZXZlbnRzLlxuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgfVxufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBVQkxJQyBBUEkgLSBPYnNlcnZhYmlsaXR5TWFuYWdlclxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TWFuYWdlciB7XG5cbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHsgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciBhIG5ldyBMYW1iZGEgaW52b2NhdGlvblxuICAgKi9cbiAgc3RhdGljIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIGxvZ2dlci5kZWJ1ZygnT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKSBjYWxsZWQnLCB7IGluaXRpYWxpemVkLCBpbnZvY2F0aW9uQ291bnQgfSk7XG5cbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ05vdCBpbml0aWFsaXplZCB5ZXQsIGNhbGxpbmcgZG9Jbml0aWFsaXplKCkuLi4nKTtcbiAgICAgIGRvSW5pdGlhbGl6ZSgpO1xuICAgIH1cblxuICAgIGludm9jYXRpb25Db3VudCsrO1xuICAgIGxvZ2dlci5kZWJ1ZyhgSW52b2NhdGlvbiAke2ludm9jYXRpb25Db3VudH0gc3RhcnRpbmcsIGluaXRpYWxpemluZyAke2JhY2tlbmRzLmxlbmd0aH0gYmFja2VuZChzKWApO1xuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kIG9mIGJhY2tlbmRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBiYWNrZW5kLmluaXRpYWxpemVJbnZvY2F0aW9uPy4oKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmFpbGVkIHRvIGluaXRpYWxpemUgaW52b2NhdGlvbjpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIGlzSW5pdGlhbGl6ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGluaXRpYWxpemVkO1xuICB9XG5cbiAgc3RhdGljIGlzQ29sZFN0YXJ0KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbnZvY2F0aW9uQ291bnQgPT09IDE7XG4gIH1cblxuICBzdGF0aWMgZ2V0SW52b2NhdGlvbkNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudDtcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb25maWcoKTogT2JzZXJ2YWJpbGl0eUNvbmZpZyB8IG51bGwge1xuICAgIHJldHVybiBjb25maWc7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG9ic2VydmFiaWxpdHkgc3VtbWFyeSBmb3IgdGhlIGN1cnJlbnQgaW52b2NhdGlvbi5cbiAgICogUmV0dXJucyBidWZmZXIgc3RhdHM6IGV2aWN0ZWQsIGJ1ZmZlcmVkLCBjYXB0dXJlZCwgc2FtcGxlZE91dCBjb3VudHMuXG4gICAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIGV4ZWN1dGlvbiBjb250ZXh0IGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBnZXRTdW1tYXJ5KCk6IE9ic2VydmFiaWxpdHlTdW1tYXJ5IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICByZXR1cm4gY29udGV4dD8ub2JzZXJ2YWJpbGl0eS5zdW1tYXJ5O1xuICB9XG5cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuICAgIGNvbmZpZyA9IHsgLi4uY29uZmlnLCAuLi51cGRhdGVzIH07XG4gIH1cblxuICBzdGF0aWMgcmVnaXN0ZXJCYWNrZW5kKGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kKTogdm9pZCB7XG4gICAgaWYgKGJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICB9XG5cbiAgc3RhdGljIHVucmVnaXN0ZXJCYWNrZW5kKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGJhY2tlbmRzID0gYmFja2VuZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IG5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHJlLWluaXRpYWxpemF0aW9uIGhvb2suXG4gICAqIEhvb2tzIHJ1biBCRUZPUkUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLCBhbGxvd2luZyBzY2hlbWEvc2VydmljZSByZWdpc3RyYXRpb25cbiAgICogbmVlZGVkIGJ5IGJhY2tlbmRzIHdpdGhvdXQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKiBcbiAgICogQHBhcmFtIGhvb2sgLSBDYWxsYmFjayB0byBleGVjdXRlIGR1cmluZyBpbml0aWFsaXphdGlvblxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUHJlSW5pdEhvb2soaG9vazogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHByZUluaXRIb29rcy5wdXNoKGhvb2spO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCAoZmlyZS1hbmQtZm9yZ2V0KVxuICAgKiBcbiAgICogQ2FwdHVyZSBjb250cm9sIGlzIGVtYmVkZGVkIGluIGlucHV0LmNhcHR1cmUgLSBubyBzZXBhcmF0ZSBvcHRpb25zIHBhcmFtLlxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXQgd2l0aCBjYXB0dXJlIGNvbnRyb2wgaW4gaW5wdXQuY2FwdHVyZVxuICAgKiBAcmV0dXJucyBvYnNlcnZhYmlsaXR5TG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmUoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ+KdjCBPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScsIHsgdHlwZTogaW5wdXQudHlwZSwgbGV2ZWw6IGlucHV0LmxldmVsIH0pO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gSGFyZCBkZXByZWNhdGlvbjogRlcyNCBkb2VzIG5vdCBzdXBwb3J0IGxlZ2FjeSBzcGFuLiogcmVjb3JkIGZvcm1hdHMuXG4gICAgICAvLyBJZiBhbnl0aGluZyBlbWl0cyB0aGVzZSwgaXQncyBhIGJ1Zy4gTG9nIGxvdWRseSBhbmQgZHJvcC5cbiAgICAgIGlmIChpbnB1dC50eXBlID09PSAnc3Bhbi5lbmQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmV2ZW50Jykge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHkgaW52YXJpYW50IHZpb2xhdGlvbjogbGVnYWN5IHNwYW4uKiBldmVudCB0eXBlIHdhcyBlbWl0dGVkICh1bnN1cHBvcnRlZCkuIERyb3BwaW5nIGV2ZW50LicsIHtcbiAgICAgICAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgICAgICAgIG9wZXJhdGlvbjogaW5wdXQub3BlcmF0aW9uLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGlucHV0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgZGlzYWJsZWQsIHNraXBwaW5nIGNhcHR1cmUnLCB7IHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGlucHV0LCBjb250ZXh0KTtcblxuICAgICAgLy8gVHJ5IHRhaWwtYmFzZWQgc2FtcGxpbmcgZmlyc3RcbiAgICAgIGNvbnN0IHRhaWxSZXN1bHQgPSBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ1N5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgRklMVEVSSU5HICsgU0FNUExJTkdcbiAgICAgIC8vIEFwcGx5IGZpbHRlcmluZyBmaXJzdCAoYWx3YXlzIHJ1bnMpXG4gICAgICBpZiAoIXNob3VsZEZpbHRlcihldmVudCwgY29uZmlnLCB7XG4gICAgICAgIC8vIE5vIGJ1ZmZlcmVkIGdyYXBoIGhlcmU7IG5ldmVyIGRyb3Agc3BhbnMgYnkgbWluRHVyYXRpb24gaW4gaGVhZC1iYXNlZCBtb2RlXG4gICAgICAgIC8vIGJlY2F1c2Ugd2UgY2FuJ3QgcHJvdmUgdGhleSBhcmVuJ3QgcGFyZW50cyBvZiBhbHJlYWR5LWVtaXR0ZWQgY2hpbGQgZXZlbnRzLlxuICAgICAgICBhbGxvd1NwYW5NaW5EdXJhdGlvbkRyb3A6IGZhbHNlLFxuICAgICAgfSkpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gRmlsdGVyZWQgb3V0XG4gICAgICB9XG5cbiAgICAgIC8vIEFwcGx5IHNhbXBsaW5nIGlmIGVuYWJsZWQgKHByb2JhYmlsaXN0aWMpXG4gICAgICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmICFzaG91bGRTYW1wbGUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gU2FtcGxlZCBvdXRcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcbiAgICAgIHJldHVybiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBpbiBjYXB0dXJlOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCBhc3luY2hyb25vdXNseSAod2FpdHMgZm9yIGJhY2tlbmQgY2FwdHVyZSlcbiAgICogXG4gICAqIEBwYXJhbSBpbnB1dCAtIEV2ZW50IGlucHV0IHdpdGggY2FwdHVyZSBjb250cm9sIGluIGlucHV0LmNhcHR1cmVcbiAgICogQHJldHVybnMgUHJvbWlzZTxvYnNlcnZhYmlsaXR5TG9nSWQ+IGlmIGNhcHR1cmVkLCB1bmRlZmluZWQgaWYgZmlsdGVyZWQvc2FtcGxlZCBvdXRcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlQXN5bmMoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgLy8gSGFyZCBkZXByZWNhdGlvbjogRlcyNCBkb2VzIG5vdCBzdXBwb3J0IGxlZ2FjeSBzcGFuLiogcmVjb3JkIGZvcm1hdHMuXG4gICAgICAvLyBJZiBhbnl0aGluZyBlbWl0cyB0aGVzZSwgaXQncyBhIGJ1Zy4gTG9nIGxvdWRseSBhbmQgZHJvcC5cbiAgICAgIGlmIChpbnB1dC50eXBlID09PSAnc3Bhbi5lbmQnIHx8IGlucHV0LnR5cGUgPT09ICdzcGFuLmV2ZW50Jykge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ09ic2VydmFiaWxpdHkgaW52YXJpYW50IHZpb2xhdGlvbjogbGVnYWN5IHNwYW4uKiBldmVudCB0eXBlIHdhcyBlbWl0dGVkICh1bnN1cHBvcnRlZCkuIERyb3BwaW5nIGV2ZW50LicsIHtcbiAgICAgICAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgICAgICAgIG9wZXJhdGlvbjogaW5wdXQub3BlcmF0aW9uLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IGlucHV0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICBjb25zdCBldmVudCA9IGJ1aWxkRXZlbnQoaW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGF3YWl0IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgRklMVEVSSU5HICsgU0FNUExJTkdcbiAgICAgIGlmICghc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgYWxsb3dTcGFuTWluRHVyYXRpb25Ecm9wOiBmYWxzZSxcbiAgICAgIH0pKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIEZpbHRlcmVkIG91dFxuICAgICAgfVxuXG4gICAgICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmICFzaG91bGRTYW1wbGUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gU2FtcGxlZCBvdXRcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgaW4gY2FwdHVyZUFzeW5jOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE9ic2VydmUgYW4gZXZlbnQgKGNvbnZlbmllbmNlIG1ldGhvZClcbiAgICogXG4gICAqIEBwYXJhbSBldmVudCAtIFBhcnRpYWwgZXZlbnQgd2l0aCByZXF1aXJlZCB0eXBlIGFuZCBsZXZlbFxuICAgKiBAcmV0dXJucyBvYnNlcnZhYmlsaXR5TG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIG9ic2VydmUoXG4gICAgZXZlbnQ6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiAmIHsgdHlwZTogc3RyaW5nOyBsZXZlbDogc3RyaW5nOyBjb3JyZWxhdGlvbklkPzogc3RyaW5nIH1cbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZXZlbnQuY29ycmVsYXRpb25JZCA/PyBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTtcblxuICAgIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ29ic2VydmUoKSBjYWxsZWQgd2l0aG91dCBjb3JyZWxhdGlvbklkJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUgYXMgQ2FwdHVyZUlucHV0WyAndHlwZScgXSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCBhcyBDYXB0dXJlSW5wdXRbICdsZXZlbCcgXSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaCBhbGwgYmFja2VuZHMgYW5kIGJ1ZmZlcmVkIGV2ZW50cyAoY2FsbGVkIGF0IGVuZCBvZiBMYW1iZGEgaW52b2NhdGlvbilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBGTFVTSCBTVEFSVCA9PT0nLCB7XG4gICAgICBwZW5kaW5nRGlzcGF0Y2hlczogcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoLFxuICAgICAgYmFja2VuZHM6IGJhY2tlbmRzLmxlbmd0aCxcbiAgICAgIHNtYXJ0U2FtcGxpbmc6IGNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0LFxuICAgIH0pO1xuXG4gICAgLy8gV2FpdCBmb3IgYWxsIHBlbmRpbmcgZmlyZS1hbmQtZm9yZ2V0IGRpc3BhdGNoZXMgKGZyb20gZXJyb3IgcGF0aCBpbiBjYXB0dXJlKCkpXG4gICAgaWYgKHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgV2FpdGluZyBmb3IgJHtwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGh9IHBlbmRpbmcgZGlzcGF0Y2hlc2ApO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocGVuZGluZ0Rpc3BhdGNoZXMpO1xuICAgICAgcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID0gMDsgLy8gQ2xlYXIgZm9yIG5leHQgaW52b2NhdGlvblxuICAgICAgbG9nZ2VyLmRlYnVnKCdQZW5kaW5nIGRpc3BhdGNoZXMgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gRm9yY2UtZW5kIGFueSBzcGFucyBsZWZ0IG9wZW4gaW4gdGhpcyBpbnZvY2F0aW9uIGJlZm9yZSBmbHVzaGluZyBidWZmZXJlZCBldmVudHMuXG4gICAgLy8gVGhpcyBndWFyYW50ZWVzIHRoZSBoaWVyYXJjaHkgaGFzIGFsbCBwYXJlbnRzLCBldmVuIGlmIHVzZXIvZnJhbWV3b3JrIGNvZGUgZm9yZ290IHRvIGVuZCBhIHNwYW4uXG4gICAgcnVuU3BhbkZpbmFsaXplcigpO1xuXG4gICAgLy8gQXR0YWNoIG9ic2VydmFiaWxpdHkgc3VtbWFyeSB0byBjdXJyZW50IHNwYW4gKGlmIGFueSkgYmVmb3JlIGZsdXNoaW5nXG4gICAgY29uc3Qgc3VtbWFyeSA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmdldFN1bW1hcnkoKTtcbiAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgICBjb25zdCBjdXJyZW50U3BhbiA9IGNvbnRleHQ/Lm9ic2VydmFiaWxpdHkuY3VycmVudFNwYW47XG4gICAgaWYgKHN1bW1hcnkgJiYgY3VycmVudFNwYW4gJiYgKHN1bW1hcnkuY2FwdHVyZWQgPiAwIHx8IHN1bW1hcnkuYnVmZmVyZWQgPiAwIHx8IHN1bW1hcnkuZXZpY3RlZCA+IDAgfHwgc3VtbWFyeS5zYW1wbGVkT3V0ID4gMCkpIHtcbiAgICAgIC8vIEFkZCBiYXNpYyBjb3VudCBtZXRyaWNzXG4gICAgICBjdXJyZW50U3Bhbj8ubWV0cmljcz8uKHtcbiAgICAgICAgJ19mdzI0Lm9icy5jYXB0dXJlZCc6IHN1bW1hcnkuY2FwdHVyZWQsXG4gICAgICAgICdfZncyNC5vYnMuYnVmZmVyZWQnOiBzdW1tYXJ5LmJ1ZmZlcmVkLFxuICAgICAgICAnX2Z3MjQub2JzLmV2aWN0ZWQnOiBzdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgICdfZncyNC5vYnMuc2FtcGxlZE91dCc6IHN1bW1hcnkuc2FtcGxlZE91dCxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgZGV0YWlsZWQgYnJlYWtkb3duIGNoZWNrcG9pbnRcbiAgICAgIGNvbnN0IGRldGFpbGVkU3RhdHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgICB0b3RhbHM6IHtcbiAgICAgICAgICBjYXB0dXJlZDogc3VtbWFyeS5jYXB0dXJlZCxcbiAgICAgICAgICBidWZmZXJlZDogc3VtbWFyeS5idWZmZXJlZCxcbiAgICAgICAgICBldmljdGVkOiBzdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgICAgc2FtcGxlZE91dDogc3VtbWFyeS5zYW1wbGVkT3V0LFxuICAgICAgICB9LFxuICAgICAgfTtcblxuICAgICAgLy8gQWRkIGNhcHR1cmVkIGV2ZW50cyBicmVha2Rvd24gKHdoYXQgd2FzIGFjdHVhbGx5IGVtaXR0ZWQpXG4gICAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQ/Lm9ic2VydmFiaWxpdHk7XG4gICAgICBpZiAob2JzU3RhdGU/LmNhcHR1cmVkQnJlYWtkb3duKSB7XG4gICAgICAgIGRldGFpbGVkU3RhdHMuY2FwdHVyZWRCcmVha2Rvd24gPSB7XG4gICAgICAgICAgYnlUeXBlOiBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieVR5cGUsXG4gICAgICAgICAgYnlPcGVyYXRpb246IE9iamVjdC5rZXlzKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uIHx8IHt9KS5sZW5ndGggPiAwXG4gICAgICAgICAgICA/IG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uXG4gICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBieUxldmVsOiBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieUxldmVsLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDb21wdXRlIGJyZWFrZG93biBieSB0eXBlIGFuZCBvcGVyYXRpb24gZnJvbSBidWZmZXIgKHdoYXQncyBzdGlsbCBidWZmZXJlZClcbiAgICAgIGlmIChjb250ZXh0ICYmIGNvbnRleHQub2JzZXJ2YWJpbGl0eS5idWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBieVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgYnlPcGVyYXRpb246IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgYnlMZXZlbDogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuXG4gICAgICAgIGZvciAoY29uc3QgZXZlbnQgb2YgY29udGV4dC5vYnNlcnZhYmlsaXR5LmJ1ZmZlcikge1xuICAgICAgICAgIGJ5VHlwZVsgZXZlbnQudHlwZSBdID0gKGJ5VHlwZVsgZXZlbnQudHlwZSBdIHx8IDApICsgMTtcbiAgICAgICAgICBpZiAoZXZlbnQub3BlcmF0aW9uKSB7XG4gICAgICAgICAgICBieU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gPSAoYnlPcGVyYXRpb25bIGV2ZW50Lm9wZXJhdGlvbiBdIHx8IDApICsgMTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnlMZXZlbFsgZXZlbnQubGV2ZWwgXSA9IChieUxldmVsWyBldmVudC5sZXZlbCBdIHx8IDApICsgMTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRldGFpbGVkU3RhdHMuYnVmZmVyZWRCcmVha2Rvd24gPSB7XG4gICAgICAgICAgYnlUeXBlLFxuICAgICAgICAgIGJ5T3BlcmF0aW9uOiBPYmplY3Qua2V5cyhieU9wZXJhdGlvbikubGVuZ3RoID4gMCA/IGJ5T3BlcmF0aW9uIDogdW5kZWZpbmVkLFxuICAgICAgICAgIGJ5TGV2ZWwsXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCBjaGVja3BvaW50IHdpdGggZGV0YWlsZWQgc3RhdHNcbiAgICAgIGN1cnJlbnRTcGFuPy5jaGVja3BvaW50Py4oJ29ic2VydmFiaWxpdHkuc3VtbWFyeS5kZXRhaWxlZCcsIHsgZGF0YTogZGV0YWlsZWRTdGF0cyB9KTtcbiAgICB9XG5cbiAgICAvLyBJZiBidWZmZXJpbmcgaXMgZW5hYmxlZCAoc21hcnQgc2FtcGxpbmcgT1Igbm9pc2UgcmVkdWN0aW9uKSwgZmx1c2ggYnVmZmVyZWQgZXZlbnRzLlxuICAgIGlmIChjb25maWc/LnNhbXBsaW5nPy5zbWFydCB8fCBjb25maWc/Lm5vaXNlUmVkdWN0aW9uPy5lbmFibGVkKSB7XG4gICAgICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICAgICAgaWYgKGNvbnRleHQgJiYgY29udGV4dC5vYnNlcnZhYmlsaXR5LmJ1ZmZlci5sZW5ndGggPiAwICYmICFjb250ZXh0Lm9ic2VydmFiaWxpdHkuZXJyb3JPY2N1cnJlZCkge1xuICAgICAgICAvLyBObyBlcnJvciBvY2N1cnJlZDogYXBwbHkgbm9pc2UgcmVkdWN0aW9uICsgb3B0aW9uYWwgc2FtcGxpbmcgdG8gYnVmZmVyIGJlZm9yZSBmbHVzaGluZ1xuICAgICAgICBjb25zdCBvYnNTdGF0ZSA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eTtcbiAgICAgICAgY29uc3QgYnVmZmVyID0gb2JzU3RhdGUuYnVmZmVyO1xuICAgICAgICBvYnNTdGF0ZS5idWZmZXIgPSBbXTsgLy8gQ2xlYXIgYnVmZmVyXG5cbiAgICAgICAgLy8gQ1JJVElDQUw6IENvbXB1dGUgcmVmZXJlbmNlZCBwYXJlbnQgSURzIGZyb20gT1JJR0lOQUwgYnVmZmVyIEJFRk9SRSBub2lzZSByZWR1Y3Rpb25cbiAgICAgICAgLy8gTm9pc2UgcmVkdWN0aW9uIG1heSBhZ2dyZWdhdGUvcmVtb3ZlIGV2ZW50cywgYnV0IHRoZWlyIHBhcmVudCBzcGFucyBtdXN0IHN0aWxsIGJlIGtlcHRcbiAgICAgICAgY29uc3QgcmVmZXJlbmNlZFBhcmVudFNwYW5JZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgZm9yIChjb25zdCBlIG9mIGJ1ZmZlcikge1xuICAgICAgICAgIGNvbnN0IHBpZCA9IGUucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHVuZGVmaW5lZDtcbiAgICAgICAgICBpZiAocGlkKSByZWZlcmVuY2VkUGFyZW50U3Bhbklkcy5hZGQocGlkKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlZHVjZWQgPSBhcHBseU5vaXNlUmVkdWN0aW9uKGJ1ZmZlciwgY29uZmlnLm5vaXNlUmVkdWN0aW9uKTtcbiAgICAgICAgY29uc3QgcmVkdWNlZEV2ZW50cyA9IHJlZHVjZWQuZXZlbnRzO1xuXG4gICAgICAgIC8vIERyb3AgZW1wdHkgKmxlYWYqIHNwYW5zIGlmIGNvbmZpZ3VyZWQuXG4gICAgICAgIC8vIEEgc3BhbiBpcyBhIGxlYWYgaWZmIG5vYm9keSByZWZlcmVuY2VzIGl0IGFzIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCBpbiB0aGlzIGJ1ZmZlcmVkIHNldC5cbiAgICAgICAgY29uc3QgbWF5YmVEcm9wRW1wdHlMZWFmU3BhbnMgPSBjb25maWcuc3BhbnMuc2tpcEVtcHR5XG4gICAgICAgICAgPyByZWR1Y2VkRXZlbnRzLmZpbHRlcigoZSkgPT4ge1xuICAgICAgICAgICAgaWYgKGUudHlwZSAhPT0gJ3NwYW4nKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gZS5vYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgICAgICAgICBpZiAoIWlkKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGlmIChyZWZlcmVuY2VkUGFyZW50U3Bhbklkcy5oYXMoaWQpKSByZXR1cm4gdHJ1ZTsgLy8gcGFyZW50ID0+IGtlZXBcbiAgICAgICAgICAgIGNvbnN0IGQgPSBlLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgICAgICAgICBjb25zdCBmdyA9IGQ/Ll9mdzI0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIGZ3Py5zcGFuRW1wdHkgIT09IHRydWU7XG4gICAgICAgICAgfSlcbiAgICAgICAgICA6IHJlZHVjZWRFdmVudHM7XG5cblxuICAgICAgICAvLyBUcmFjayBjYXB0dXJlZCBldmVudHMgZm9yIGRldGFpbGVkIHN1bW1hcnlcbiAgICAgICAgY29uc3QgY2FwdHVyZWRCeVR5cGU6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcbiAgICAgICAgY29uc3QgY2FwdHVyZWRCeU9wZXJhdGlvbjogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgICAgICBjb25zdCBjYXB0dXJlZEJ5TGV2ZWw6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fTtcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIG1heWJlRHJvcEVtcHR5TGVhZlNwYW5zKSB7XG4gICAgICAgICAgLy8gVEFJTC1CQVNFRCBGSUxURVJJTkcgKyBTQU1QTElORyAoYWZ0ZXIgbm9pc2UgcmVkdWN0aW9uKVxuXG4gICAgICAgICAgLy8gQXBwbHkgZmlsdGVyaW5nIGZpcnN0IChhbHdheXMgcnVucyAtIGNvbnRlbnQtYmFzZWQpXG4gICAgICAgICAgY29uc3QgcGFzc2VkRmlsdGVyID0gc2hvdWxkRmlsdGVyKGV2ZW50LCBjb25maWcsIHtcbiAgICAgICAgICAgIGFsbG93U3Bhbk1pbkR1cmF0aW9uRHJvcDogdHJ1ZSxcbiAgICAgICAgICAgIHJlZmVyZW5jZWRQYXJlbnRTcGFuSWRzLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmICghcGFzc2VkRmlsdGVyKSB7XG4gICAgICAgICAgICAvLyBGaWx0ZXJlZCBvdXQgLSBkb24ndCBjb3VudCBhcyBzYW1wbGVkIG91dFxuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQXBwbHkgc2FtcGxpbmcgaWYgZW5hYmxlZCAocHJvYmFiaWxpc3RpYylcbiAgICAgICAgICBpZiAoY29uZmlnLnNhbXBsaW5nPy5lbmFibGVkICYmICFzaG91bGRTYW1wbGUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgICAgICAgIG9ic1N0YXRlLnN1bW1hcnkuc2FtcGxlZE91dCsrO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gVHJhY2sgY2FwdHVyZWQgZXZlbnQgYnJlYWtkb3duc1xuICAgICAgICAgIGNhcHR1cmVkQnlUeXBlWyBldmVudC50eXBlIF0gPSAoY2FwdHVyZWRCeVR5cGVbIGV2ZW50LnR5cGUgXSB8fCAwKSArIDE7XG4gICAgICAgICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgICAgICAgY2FwdHVyZWRCeU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gPSAoY2FwdHVyZWRCeU9wZXJhdGlvblsgZXZlbnQub3BlcmF0aW9uIF0gfHwgMCkgKyAxO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjYXB0dXJlZEJ5TGV2ZWxbIGV2ZW50LmxldmVsIF0gPSAoY2FwdHVyZWRCeUxldmVsWyBldmVudC5sZXZlbCBdIHx8IDApICsgMTtcbiAgICAgICAgICBvYnNTdGF0ZS5zdW1tYXJ5LmNhcHR1cmVkKys7XG5cbiAgICAgICAgICAvLyBQYXNzZWQgYm90aCBmaWx0ZXJpbmcgYW5kIHNhbXBsaW5nIC0gZW1pdFxuICAgICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0cyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTdG9yZSBjYXB0dXJlZCBicmVha2Rvd25zIGluIGNvbnRleHQgZm9yIHN1bW1hcnkgY2hlY2twb2ludFxuICAgICAgICBpZiAoIW9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duKSB7XG4gICAgICAgICAgb2JzU3RhdGUuY2FwdHVyZWRCcmVha2Rvd24gPSB7IGJ5VHlwZToge30sIGJ5T3BlcmF0aW9uOiB7fSwgYnlMZXZlbDoge30gfTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IFsgdHlwZSwgY291bnQgXSBvZiBPYmplY3QuZW50cmllcyhjYXB0dXJlZEJ5VHlwZSkpIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieVR5cGVbIHR5cGUgXSA9IChvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieVR5cGVbIHR5cGUgXSB8fCAwKSArIGNvdW50O1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgWyBvcCwgY291bnQgXSBvZiBPYmplY3QuZW50cmllcyhjYXB0dXJlZEJ5T3BlcmF0aW9uKSkge1xuICAgICAgICAgIG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uWyBvcCBdID0gKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5T3BlcmF0aW9uWyBvcCBdIHx8IDApICsgY291bnQ7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBbIGxldmVsLCBjb3VudCBdIG9mIE9iamVjdC5lbnRyaWVzKGNhcHR1cmVkQnlMZXZlbCkpIHtcbiAgICAgICAgICBvYnNTdGF0ZS5jYXB0dXJlZEJyZWFrZG93bi5ieUxldmVsWyBsZXZlbCBdID0gKG9ic1N0YXRlLmNhcHR1cmVkQnJlYWtkb3duLmJ5TGV2ZWxbIGxldmVsIF0gfHwgMCkgKyBjb3VudDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gSWYgZXJyb3JPY2N1cnJlZD10cnVlLCBidWZmZXIgd2FzIGFscmVhZHkgZmx1c2hlZCBkdXJpbmcgY2FwdHVyZVxuICAgIH1cblxuICAgIC8vIEZsdXNoIGFsbCBiYWNrZW5kcyB3aXRoIHJldHJ5IGxvZ2ljXG4gICAgLy8gV3JhcCBlYWNoIGJhY2tlbmQgZmx1c2ggaW4gdHJ5LWNhdGNoIHRvIGVuc3VyZSBhbGwgYmFja2VuZHMgYXR0ZW1wdCB0byBmbHVzaFxuICAgIC8vIGV2ZW4gaWYgb25lIGZhaWxzIGNhdGFzdHJvcGhpY2FsbHlcbiAgICBjb25zdCBNQVhfRkxVU0hfUkVUUklFUyA9IDI7XG4gICAgY29uc3QgZmx1c2hQcm9taXNlcyA9IGJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFiYWNrZW5kLmZsdXNoKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChsZXQgYXR0ZW1wdCA9IDE7IGF0dGVtcHQgPD0gTUFYX0ZMVVNIX1JFVFJJRVM7IGF0dGVtcHQrKykge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG4gICAgICAgICAgICBicmVhazsgLy8gU3VjY2Vzc1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAoYXR0ZW1wdCA9PT0gTUFYX0ZMVVNIX1JFVFJJRVMpIHtcbiAgICAgICAgICAgICAgbG9nZ2VyLmVycm9yKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmbHVzaCBmYWlsZWQgYWZ0ZXIgJHthdHRlbXB0fSBhdHRlbXB0czpgLCBlcnJvcik7XG4gICAgICAgICAgICAgIC8vIEV2ZW50cyBtYXkgYmUgbG9zdCwgYnV0IHdlJ3ZlIGRvbmUgb3VyIGJlc3RcbiAgICAgICAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBhbGxvdyBvdGhlciBiYWNrZW5kcyB0byBmbHVzaFxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGZhaWxlZCAoYXR0ZW1wdCAke2F0dGVtcHR9LyR7TUFYX0ZMVVNIX1JFVFJJRVN9KSwgcmV0cnlpbmcuLi5gLCBlcnJvcik7XG4gICAgICAgICAgICAgIC8vIFNpbXBsZSBleHBvbmVudGlhbCBiYWNrb2ZmXG4gICAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAgKiBhdHRlbXB0KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBDYXRjaCBhbnkgdW5leHBlY3RlZCBlcnJvcnMgb3V0c2lkZSB0aGUgcmV0cnkgbG9vcFxuICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZsdXNoIGNvbXBsZXRlbHkgZmFpbGVkOmAsIGVycm9yKTtcbiAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBhbGxvdyBvdGhlciBiYWNrZW5kcyB0byBmbHVzaFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZmx1c2hQcm9taXNlcyk7XG5cbiAgICBsb2dnZXIuZGVidWcoJz09PSBGTFVTSCBDT01QTEVURSA9PT0nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldCBtYW5hZ2VyIHN0YXRlIChmb3IgdGVzdGluZylcbiAgICovXG4gIHN0YXRpYyByZXNldCgpOiB2b2lkIHtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKG51bGwpO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgICBpbnZvY2F0aW9uQ291bnQgPSAwO1xuICAgIGluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgc2FtcGxpbmdSZWdleENhY2hlLmNsZWFyKCk7XG4gICAgcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID0gMDtcbiAgICByZXNldENhcHR1cmVyKCk7XG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmb3IgdGVzdGluZyB3aXRoIG1vY2sgY29uZmlnIGFuZCBiYWNrZW5kc1xuICAgKi9cbiAgc3RhdGljIGluaXRpYWxpemVGb3JUZXN0aW5nKFxuICAgIHRlc3RDb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcsXG4gICAgdGVzdEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdID0gW11cbiAgKTogdm9pZCB7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIucmVzZXQoKTtcbiAgICBjb25maWcgPSB0ZXN0Q29uZmlnO1xuICAgIHNldEN1cnJlbnRPYnNlcnZhYmlsaXR5Q29uZmlnKHRlc3RDb25maWcpO1xuICAgIGJhY2tlbmRzID0gdGVzdEJhY2tlbmRzO1xuICAgIGluaXRpYWxpemVkID0gdHJ1ZTtcblxuICAgIGluaXRpYWxpemVDYXB0dXJlcih7XG4gICAgICBjYXB0dXJlOiAoaW5wdXQpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQpLFxuICAgICAgY2FwdHVyZUFzeW5jOiAoaW5wdXQpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmVBc3luYyhpbnB1dCksXG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciB3cmFwcGVyIHdpdGggb2JzZXJ2YWJpbGl0eSBsaWZlY3ljbGUgbWFuYWdlbWVudFxuICovXG5leHBvcnQgY29uc3Qgd2l0aE9ic2VydmFiaWxpdHkgPSA8VCBleHRlbmRzICguLi5hcmdzOiB1bmtub3duW10pID0+IFByb21pc2U8dW5rbm93bj4+KGhhbmRsZXI6IFQpOiBUID0+IHtcbiAgcmV0dXJuIChhc3luYyAoLi4uYXJnczogUGFyYW1ldGVyczxUPikgPT4ge1xuICAgIHRyeSB7XG4gICAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoLi4uYXJncyk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfVxuICB9KSBhcyBUO1xufTtcblxuZXhwb3J0IGNvbnN0IE9ic2VydmVyID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXI7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gVEVTVCBFWFBPUlRTIC0gT25seSBmb3IgdGVzdGluZyBpbnRlcm5hbCBmdW5jdGlvbnNcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4vKipcbiAqIEV4cG9ydCBwcml2YXRlIGZ1bmN0aW9ucyBmb3IgdGVzdGluZy5cbiAqIFRoZXNlIHNob3VsZCBPTkxZIGJlIHVzZWQgaW4gdGVzdCBmaWxlcy5cbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgX190ZXN0X18gPSB7XG4gIGV2aWN0TG93ZXN0UHJpb3JpdHksXG4gIHNob3VsZEZpbHRlcixcbiAgc2hvdWxkU2FtcGxlLFxuICBnZXRFdmVudFByaW9yaXR5LFxuICBidWlsZEV2ZW50LFxufTtcbiJdfQ==