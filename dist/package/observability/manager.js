"use strict";
/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * All config and backends resolved from DI - no manual instantiation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observer = exports.withObservability = exports.ObservabilityManager = void 0;
const crypto_1 = require("crypto");
const logging_1 = require("../logging");
const types_1 = require("./types");
const level_utils_1 = require("./utils/level-utils");
const source_utils_1 = require("./utils/source-utils");
const data_protection_1 = require("./utils/data-protection");
const context_1 = require("./context");
const base_1 = require("./observers/base");
const di_1 = require("../di");
const errors_1 = require("../di/errors");
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
            message: 'correlationId is required. Establish context with runWithContext() or provide explicitly.'
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
    return {
        type: input.type,
        level: input.level,
        correlationId,
        timestampMs: input.timestampMs ?? now,
        observabilityLogId: input.observabilityLogId ?? (0, crypto_1.randomUUID)(),
        // null = explicitly no parent (don't fall back), undefined = use context
        parentObservabilityLogId: input.parentObservabilityLogId === null
            ? undefined
            : (input.parentObservabilityLogId ?? ctx?.parentObservabilityLogId),
        causedBy: input.causedBy,
        relatedTraces: input.relatedTraces,
        actor: input.actor ?? ctx?.actor,
        source: input.source ?? ctx?.source ?? (0, source_utils_1.detectSource)(),
        tags: (0, source_utils_1.mergeTags)({ ...ctx?.tags, ...input.tags }, true),
        entityName: input.entityName,
        entityId: input.entityId,
        operation: input.operation,
        subType: input.subType,
        status: input.status,
        success: input.success,
        durationMs: input.durationMs,
        data,
        attributes,
        metadata,
        metrics: input.metrics,
        context: eventContext,
        error,
        critical: input.critical,
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
    if (type.startsWith('span.'))
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
function shouldCapture(event, cfg) {
    const levelValue = (0, level_utils_1.stringToLevel)(event.level);
    const typeCategory = getTypeCategory(event.type);
    const effectiveLevel = getEffectiveLevelForType(typeCategory);
    // Check minimum level first
    if (levelValue < effectiveLevel) {
        return false;
    }
    // CRITICAL always captured
    if (levelValue === types_1.ObservabilityLevel.CRITICAL) {
        return true;
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
    // CRITICAL events NEVER get evicted (max priority)
    if (event.critical) {
        return Infinity;
    }
    let priority = 0;
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
function evictLowestPriority(buffer) {
    if (buffer.length === 0)
        return null;
    // Find lowest priority event
    let lowestPriority = Infinity;
    let lowestIndex = 0;
    for (let i = 0; i < buffer.length; i++) {
        const priority = getEventPriority(buffer[i]);
        if (priority < lowestPriority) {
            lowestPriority = priority;
            lowestIndex = i;
        }
    }
    // Remove and return info about evicted event
    const evicted = buffer.splice(lowestIndex, 1)[0];
    return {
        type: evicted.type,
        correlationId: evicted.correlationId,
        operation: evicted.operation,
        level: evicted.level,
    };
}
/**
 * Handle tail-based sampling logic for an event (sync version)
 * Returns: 'captured' if event was captured, 'buffered' if buffered, 'skip' if not using tail-based
 */
function handleTailBasedSamplingSync(event, context) {
    if (!config?.sampling?.smart || !context) {
        return 'skip';
    }
    const isError = (0, level_utils_1.stringToLevel)(event.level) >= types_1.ObservabilityLevel.ERROR;
    // ERROR PATH: Flush buffer + capture error + set flag
    if (isError) {
        if (context.observabilityBuffer?.length) {
            const buffer = context.observabilityBuffer;
            context.observabilitySummary = context.observabilitySummary || { evicted: 0, buffered: 0, captured: 0 };
            context.observabilityBuffer = [];
            // Apply level filtering to avoid overwhelming backends with thousands of debug/trace events
            // On error, capture INFO+ events, drop TRACE/DEBUG to prevent cost spikes
            const minLevelOnError = config.sampling?.minLevelOnError ?? types_1.ObservabilityLevel.INFO;
            let dropped = 0;
            for (const bufferedEvent of buffer) {
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
        context.errorOccurred = true;
        const targetBackends = getBackendsForType(event.type);
        dispatchToBackends(event, targetBackends);
        // Track captured count
        if (!context.observabilitySummary) {
            context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
        }
        context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;
        return 'captured';
    }
    // POST-ERROR PATH: Capture immediately
    if (context.errorOccurred) {
        const targetBackends = getBackendsForType(event.type);
        dispatchToBackends(event, targetBackends);
        // Track captured count
        if (!context.observabilitySummary) {
            context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
        }
        context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;
        return 'captured';
    }
    // NORMAL PATH: Buffer everything
    if (!context.observabilityBuffer)
        context.observabilityBuffer = [];
    const buffer = context.observabilityBuffer;
    // Initialize summary if needed
    if (!context.observabilitySummary) {
        context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
    }
    // Buffer size management: evict lowest priority if full
    const maxSize = config.sampling.maxBufferSize ?? 1000;
    if (buffer.length >= maxSize) {
        const evictedInfo = evictLowestPriority(buffer);
        context.observabilitySummary.evicted = (context.observabilitySummary.evicted || 0) + 1;
        // Log warning with evicted event details
        if (context.observabilitySummary.evicted === 1 || context.observabilitySummary.evicted % 100 === 0) {
            logger.warn('Observability buffer full, evicting lowest priority events', {
                evicted: context.observabilitySummary.evicted,
                bufferSize: buffer.length,
                correlationId: context.correlationId,
                evictedEvent: evictedInfo,
            });
        }
        else if (evictedInfo) {
            // Log each eviction at debug level for troubleshooting
            logger.debug('Evicted observability event from buffer', {
                ...evictedInfo,
                totalEvicted: context.observabilitySummary.evicted,
            });
        }
    }
    buffer.push(event);
    context.observabilitySummary.buffered = (context.observabilitySummary.buffered || 0) + 1;
    return 'buffered';
}
/**
 * Handle tail-based sampling logic for an event (async version)
 */
async function handleTailBasedSamplingAsync(event, context) {
    if (!config?.sampling?.smart || !context) {
        return 'skip';
    }
    const isError = (0, level_utils_1.stringToLevel)(event.level) >= types_1.ObservabilityLevel.ERROR;
    // ERROR PATH: Flush buffer + capture error + set flag
    if (isError) {
        if (context.observabilityBuffer?.length) {
            const buffer = context.observabilityBuffer;
            context.observabilitySummary = context.observabilitySummary || { evicted: 0, buffered: 0, captured: 0 };
            context.observabilityBuffer = [];
            // Apply level filtering to avoid overwhelming backends
            const minLevelOnError = config.sampling?.minLevelOnError ?? types_1.ObservabilityLevel.INFO;
            let dropped = 0;
            const filteredEvents = buffer.filter(bufferedEvent => {
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
        context.errorOccurred = true;
        const targetBackends = getBackendsForType(event.type);
        await dispatchToBackendsSync(event, targetBackends);
        // Track captured count
        if (!context.observabilitySummary) {
            context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
        }
        context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;
        return 'captured';
    }
    // POST-ERROR PATH: Capture immediately
    if (context.errorOccurred) {
        const targetBackends = getBackendsForType(event.type);
        await dispatchToBackendsSync(event, targetBackends);
        // Track captured count
        if (!context.observabilitySummary) {
            context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
        }
        context.observabilitySummary.captured = (context.observabilitySummary.captured || 0) + 1;
        return 'captured';
    }
    // NORMAL PATH: Buffer everything
    if (!context.observabilityBuffer)
        context.observabilityBuffer = [];
    const buffer = context.observabilityBuffer;
    // Initialize summary if needed
    if (!context.observabilitySummary) {
        context.observabilitySummary = { evicted: 0, buffered: 0, captured: 0 };
    }
    // Buffer size management: evict lowest priority if full
    const maxSize = config.sampling.maxBufferSize ?? 1000;
    if (buffer.length >= maxSize) {
        evictLowestPriority(buffer);
        context.observabilitySummary.evicted = (context.observabilitySummary.evicted || 0) + 1;
        // Log warning if evicting a lot
        if (context.observabilitySummary.evicted === 1 || context.observabilitySummary.evicted % 100 === 0) {
            logger.warn('Observability buffer full, evicting lowest priority events', {
                evicted: context.observabilitySummary.evicted,
                bufferSize: buffer.length,
                correlationId: context.correlationId
            });
        }
    }
    buffer.push(event);
    context.observabilitySummary.buffered = (context.observabilitySummary.buffered || 0) + 1;
    return 'buffered';
}
/**
 * Initialize backends from DI based on config
 */
function initializeBackendsFromConfig(cfg) {
    backends = [];
    backendConfigs.clear();
    const enabledBackends = cfg.backends?.filter(b => b.enabled !== false) ?? [];
    const enabledTypes = enabledBackends.map(b => b.type);
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
    // Fallback to CloudWatch if no backends enabled
    if (backends.length === 0) {
        logger.warn('No backends enabled, attempting CloudWatch fallback');
        try {
            const backend = di_1.DIContainer.ROOT.resolve('ObservabilityBackend', { tags: ['observability', 'backend', 'cloudwatch'] });
            backends.push(backend);
            // Create default config for fallback
            backendConfigs.set(backend.name, { type: 'cloudwatch', enabled: true });
        }
        catch (error) {
            logger.error('Failed to resolve fallback CloudWatch backend:', error);
        }
    }
}
function doInitialize() {
    try {
        logger.info('=== OBSERVABILITY INITIALIZATION START ===');
        // Resolve config from DI (defaults registered in index.ts guarantee all required fields)
        config = di_1.DIContainer.ROOT.resolveConfig('observability');
        logger.info('Observability config loaded from DI', {
            enabled: config.enabled,
            serviceName: config.serviceName,
            backends: config.backends?.map(b => b.type),
            sampling: { enabled: config.sampling?.enabled, smart: config.sampling?.smart },
        });
        // Initialize backends from DI
        initializeBackendsFromConfig(config);
        logger.info(`Initialized ${backends.length} backend(s):`, backends.map(b => b.name));
        // Register capturer for observers
        (0, base_1.initializeCapturer)({
            capture: (input, options) => ObservabilityManager.capture(input, options),
            captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
        });
        initialized = true;
        logger.info('=== OBSERVABILITY INITIALIZATION COMPLETE ===');
    }
    catch (error) {
        logger.error('!!! OBSERVABILITY INITIALIZATION FAILED !!!', error);
        // Set initialized = true anyway to prevent repeated init attempts
        initialized = true;
        // Re-throw so we know something is broken
        throw error;
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
     * Capture an observability event (fire-and-forget)
     */
    static capture(input, options) {
        if (!initialized) {
            logger.warn('❌ Observability not initialized, skipping capture', { type: input.type, level: input.level });
            return undefined;
        }
        try {
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
            // Merge critical flag from options into input for event creation
            const eventInput = options?.critical ? { ...input, critical: true } : input;
            const event = buildEvent(eventInput, context);
            // Try tail-based sampling first
            const tailResult = handleTailBasedSamplingSync(event, context);
            if (tailResult === 'captured') {
                return event.observabilityLogId;
            }
            if (tailResult === 'buffered') {
                return undefined;
            }
            // HEAD-BASED SAMPLING (Standard)
            const isSampled = event.critical || shouldCapture(event, config);
            if (!isSampled) {
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
     */
    static async captureAsync(input, options) {
        if (!initialized) {
            logger.debug('Observability not initialized, skipping capture');
            return undefined;
        }
        try {
            const errors = validateInput(input);
            if (errors.length > 0) {
                logger.warn('Invalid capture input:', { errors, type: input.type });
                return undefined;
            }
            if (!config?.enabled)
                return undefined;
            const context = (0, context_1.getCurrentContext)();
            // Merge critical flag from options into input for event creation
            const eventInput = options?.critical ? { ...input, critical: true } : input;
            const event = buildEvent(eventInput, context);
            // Try tail-based sampling first
            const tailResult = await handleTailBasedSamplingAsync(event, context);
            if (tailResult === 'captured') {
                return event.observabilityLogId;
            }
            if (tailResult === 'buffered') {
                return undefined;
            }
            // HEAD-BASED SAMPLING (Standard)
            const isSampled = event.critical || shouldCapture(event, config);
            if (!isSampled) {
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
     * Observe an event
     */
    static observe(event, options) {
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
        }, options);
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
        // If smart sampling is enabled, flush buffered events with sampling applied
        if (config?.sampling?.smart) {
            const context = (0, context_1.getCurrentContext)();
            if (context?.observabilityBuffer?.length && !context.errorOccurred) {
                // No error occurred: apply sampling to buffer before flushing
                const buffer = context.observabilityBuffer;
                context.observabilityBuffer = []; // Clear buffer
                for (const event of buffer) {
                    // Apply sampling rules to buffered event
                    const isSampled = shouldCapture(event, config);
                    if (isSampled) {
                        const targets = getBackendsForType(event.type);
                        await dispatchToBackendsSync(event, targets);
                    }
                    // else: dropped by sampling
                }
            }
            // If errorOccurred=true, buffer was already flushed during capture
        }
        // Flush all backends with retry logic
        const MAX_FLUSH_RETRIES = 2;
        const flushPromises = backends.map(async (backend) => {
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
                    }
                    else {
                        logger.warn(`Backend ${backend.name} flush failed (attempt ${attempt}/${MAX_FLUSH_RETRIES}), retrying...`, error);
                        // Simple exponential backoff
                        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                    }
                }
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
        backends = testBackends;
        initialized = true;
        (0, base_1.initializeCapturer)({
            capture: (input, options) => ObservabilityManager.capture(input, options),
            captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILG1DQUFvQztBQUNwQyx3Q0FBMEM7QUFDMUMsbUNBU2lCO0FBQ2pCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELHVDQUF3RTtBQUN4RSwyQ0FBcUU7QUFDckUsOEJBQW9DO0FBQ3BDLHlDQUFvRDtBQUVwRCxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQU9wRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxJQUFJLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0FBQzlDLElBQUksUUFBUSxHQUEyQixFQUFFLENBQUM7QUFDMUMsSUFBSSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQWtELENBQUM7QUFDL0UsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztBQUN4QixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBQ3JELE1BQU0saUJBQWlCLEdBQW9CLEVBQUUsQ0FBQyxDQUFDLDZDQUE2QztBQUU1Riw4RUFBOEU7QUFDOUUsMkJBQTJCO0FBQzNCLDhFQUE4RTtBQUU5RSxTQUFTLGFBQWEsQ0FBQyxLQUFtQjtJQUN4QyxNQUFNLE1BQU0sR0FBc0IsRUFBRSxDQUFDO0lBQ3JDLE1BQU0sT0FBTyxHQUFHLElBQUEsMkJBQWlCLEdBQUUsQ0FBQztJQUVwQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2hCLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxDQUFDLENBQUM7SUFDOUQsQ0FBQztJQUVE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O0FBVFcsUUFBQSxpQkFBaUIscUJBUzVCO0FBRVcsUUFBQSxRQUFRLEdBQUcsb0JBQW9CLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHlNYW5hZ2VyIC0gQ29yZSBPYnNlcnZlciBmb3IgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtXG4gKiBcbiAqIEFsbCBjb25maWcgYW5kIGJhY2tlbmRzIHJlc29sdmVkIGZyb20gREkgLSBubyBtYW51YWwgaW5zdGFudGlhdGlvbi5cbiAqL1xuXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHtcbiAgQ2FwdHVyZUlucHV0LFxuICBDYXB0dXJlT3B0aW9ucyxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlDb25maWcsXG4gIE9ic2VydmFiaWxpdHlFcnJvcixcbiAgT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICBPYnNlcnZhYmlsaXR5TGV2ZWwsXG4gIFNhbXBsaW5nUnVsZSxcbn0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBzdHJpbmdUb0xldmVsLCBsZXZlbFRvU3RyaW5nIH0gZnJvbSAnLi91dGlscy9sZXZlbC11dGlscyc7XG5pbXBvcnQgeyBkZXRlY3RTb3VyY2UsIG1lcmdlVGFncyB9IGZyb20gJy4vdXRpbHMvc291cmNlLXV0aWxzJztcbmltcG9ydCB7IHJlZGFjdFNlbnNpdGl2ZURhdGEgfSBmcm9tICcuL3V0aWxzL2RhdGEtcHJvdGVjdGlvbic7XG5pbXBvcnQgeyBnZXRDdXJyZW50Q29udGV4dCwgZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzIH0gZnJvbSAnLi9jb250ZXh0JztcbmltcG9ydCB7IGluaXRpYWxpemVDYXB0dXJlciwgcmVzZXRDYXB0dXJlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBOb1Byb3ZpZGVyRm91bmRFcnJvciB9IGZyb20gJy4uL2RpL2Vycm9ycyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2YWJpbGl0eU1hbmFnZXInKTtcblxuaW50ZXJmYWNlIFZhbGlkYXRpb25FcnJvciB7XG4gIGZpZWxkOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIE1PRFVMRSBTVEFURVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmxldCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsID0gbnVsbDtcbmxldCBiYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdO1xubGV0IGJhY2tlbmRDb25maWdzID0gbmV3IE1hcDxzdHJpbmcsIE9ic2VydmFiaWxpdHlDb25maWdbICdiYWNrZW5kcycgXVsgMCBdPigpO1xubGV0IGludm9jYXRpb25Db3VudCA9IDA7XG5sZXQgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbmNvbnN0IHNhbXBsaW5nUmVnZXhDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWdFeHA+KCk7XG5jb25zdCBwZW5kaW5nRGlzcGF0Y2hlczogUHJvbWlzZTx2b2lkPltdID0gW107IC8vIFRyYWNrIGZpcmUtYW5kLWZvcmdldCBwcm9taXNlcyBmb3IgZmx1c2goKVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBSSVZBVEUgSEVMUEVSIEZVTkNUSU9OU1xuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmZ1bmN0aW9uIHZhbGlkYXRlSW5wdXQoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IFZhbGlkYXRpb25FcnJvcltdIHtcbiAgY29uc3QgZXJyb3JzOiBWYWxpZGF0aW9uRXJyb3JbXSA9IFtdO1xuICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcblxuICBpZiAoIWlucHV0LnR5cGUpIHtcbiAgICBlcnJvcnMucHVzaCh7IGZpZWxkOiAndHlwZScsIG1lc3NhZ2U6ICd0eXBlIGlzIHJlcXVpcmVkJyB9KTtcbiAgfVxuXG4gIGlmICghaW5wdXQubGV2ZWwpIHtcbiAgICBlcnJvcnMucHVzaCh7IGZpZWxkOiAnbGV2ZWwnLCBtZXNzYWdlOiAnbGV2ZWwgaXMgcmVxdWlyZWQnIH0pO1xuICB9XG5cbiAgaWYgKCFpbnB1dC5jb3JyZWxhdGlvbklkICYmICFjb250ZXh0Py5jb3JyZWxhdGlvbklkKSB7XG4gICAgZXJyb3JzLnB1c2goe1xuICAgICAgZmllbGQ6ICdjb3JyZWxhdGlvbklkJyxcbiAgICAgIG1lc3NhZ2U6ICdjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkLiBFc3RhYmxpc2ggY29udGV4dCB3aXRoIHJ1bldpdGhDb250ZXh0KCkgb3IgcHJvdmlkZSBleHBsaWNpdGx5LidcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBlcnJvcnM7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gIGlucHV0OiBDYXB0dXJlSW5wdXQsXG4gIGRhdGFQcm90ZWN0aW9uPzogT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ2RhdGFQcm90ZWN0aW9uJyBdXG4pOiB7XG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgYXR0cmlidXRlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGVycm9yPzogT2JzZXJ2YWJpbGl0eUVycm9yO1xufSB7XG4gIGlmICghZGF0YVByb3RlY3Rpb24/LmVuYWJsZWQpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZGF0YTogaW5wdXQuZGF0YSxcbiAgICAgIGF0dHJpYnV0ZXM6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgICBtZXRhZGF0YTogaW5wdXQubWV0YWRhdGEsXG4gICAgICBjb250ZXh0OiBpbnB1dC5jb250ZXh0LFxuICAgICAgZXJyb3I6IGlucHV0LmVycm9yLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBmaWVsZHMgPSBkYXRhUHJvdGVjdGlvbi5maWVsZHMgPz8gWyAnZGF0YScsICdhdHRyaWJ1dGVzJywgJ21ldGFkYXRhJywgJ2NvbnRleHQnIF07XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhOiBmaWVsZHMuaW5jbHVkZXMoJ2RhdGEnKSAmJiBpbnB1dC5kYXRhXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuZGF0YSwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmRhdGEsXG4gICAgYXR0cmlidXRlczogZmllbGRzLmluY2x1ZGVzKCdhdHRyaWJ1dGVzJykgJiYgaW5wdXQuYXR0cmlidXRlc1xuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmF0dHJpYnV0ZXMsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5hdHRyaWJ1dGVzLFxuICAgIG1ldGFkYXRhOiBmaWVsZHMuaW5jbHVkZXMoJ21ldGFkYXRhJykgJiYgaW5wdXQubWV0YWRhdGFcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5tZXRhZGF0YSwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0Lm1ldGFkYXRhLFxuICAgIGNvbnRleHQ6IGZpZWxkcy5pbmNsdWRlcygnY29udGV4dCcpICYmIGlucHV0LmNvbnRleHRcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5jb250ZXh0LCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuY29udGV4dCxcbiAgICBlcnJvcjogZmllbGRzLmluY2x1ZGVzKCdlcnJvcicpICYmIGlucHV0LmVycm9yXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuZXJyb3IsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5lcnJvcixcbiAgfTtcbn1cblxuZnVuY3Rpb24gYnVpbGRFdmVudChpbnB1dDogQ2FwdHVyZUlucHV0LCBjb250ZXh0OiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRDdXJyZW50Q29udGV4dD4gfCBudWxsID0gbnVsbCk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gIGNvbnN0IGN0eCA9IGNvbnRleHQgPz8gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcblxuICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW5wdXQuY29ycmVsYXRpb25JZCA/PyBjdHg/LmNvcnJlbGF0aW9uSWQ7XG4gIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZCAtIHRoaXMgc2hvdWxkIGhhdmUgYmVlbiBjYXVnaHQgYnkgdmFsaWRhdGlvbicpO1xuICB9XG5cbiAgY29uc3QgeyBkYXRhLCBhdHRyaWJ1dGVzLCBtZXRhZGF0YSwgY29udGV4dDogZXZlbnRDb250ZXh0LCBlcnJvciB9ID0gYXBwbHlEYXRhUHJvdGVjdGlvbihcbiAgICBpbnB1dCxcbiAgICBjb25maWc/LmRhdGFQcm90ZWN0aW9uXG4gICk7XG5cbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBpbnB1dC50eXBlLFxuICAgIGxldmVsOiBpbnB1dC5sZXZlbCxcbiAgICBjb3JyZWxhdGlvbklkLFxuICAgIHRpbWVzdGFtcE1zOiBpbnB1dC50aW1lc3RhbXBNcyA/PyBub3csXG4gICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5vYnNlcnZhYmlsaXR5TG9nSWQgPz8gcmFuZG9tVVVJRCgpLFxuICAgIC8vIG51bGwgPSBleHBsaWNpdGx5IG5vIHBhcmVudCAoZG9uJ3QgZmFsbCBiYWNrKSwgdW5kZWZpbmVkID0gdXNlIGNvbnRleHRcbiAgICBwYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9PT0gbnVsbFxuICAgICAgPyB1bmRlZmluZWRcbiAgICAgIDogKGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyBjdHg/LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCksXG4gICAgY2F1c2VkQnk6IGlucHV0LmNhdXNlZEJ5LFxuICAgIHJlbGF0ZWRUcmFjZXM6IGlucHV0LnJlbGF0ZWRUcmFjZXMsXG4gICAgYWN0b3I6IGlucHV0LmFjdG9yID8/IGN0eD8uYWN0b3IsXG4gICAgc291cmNlOiBpbnB1dC5zb3VyY2UgPz8gY3R4Py5zb3VyY2UgPz8gZGV0ZWN0U291cmNlKCksXG4gICAgdGFnczogbWVyZ2VUYWdzKHsgLi4uY3R4Py50YWdzLCAuLi5pbnB1dC50YWdzIH0sIHRydWUpLFxuICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgZW50aXR5SWQ6IGlucHV0LmVudGl0eUlkLFxuICAgIG9wZXJhdGlvbjogaW5wdXQub3BlcmF0aW9uLFxuICAgIHN1YlR5cGU6IGlucHV0LnN1YlR5cGUsXG4gICAgc3RhdHVzOiBpbnB1dC5zdGF0dXMsXG4gICAgc3VjY2VzczogaW5wdXQuc3VjY2VzcyxcbiAgICBkdXJhdGlvbk1zOiBpbnB1dC5kdXJhdGlvbk1zLFxuICAgIGRhdGEsXG4gICAgYXR0cmlidXRlcyxcbiAgICBtZXRhZGF0YSxcbiAgICBtZXRyaWNzOiBpbnB1dC5tZXRyaWNzLFxuICAgIGNvbnRleHQ6IGV2ZW50Q29udGV4dCxcbiAgICBlcnJvcixcbiAgICBjcml0aWNhbDogaW5wdXQuY3JpdGljYWwsXG4gIH07XG59XG5cbi8qKlxuICogQ2F0ZWdvcml6ZSBldmVudCB0eXBlIGZvciBiYWNrZW5kIHJvdXRpbmcgYW5kIHNhbXBsaW5nXG4gKiBcbiAqIEN1c3RvbSBldmVudCB0eXBlcyBhcmUgc3VwcG9ydGVkISBVc2UgYW55IG5hbWluZyBjb252ZW50aW9uOlxuICogLSAnYnVzaW5lc3Mub3JkZXJfcGxhY2VkJyDihpIgY2F0ZWdvcml6ZWQgYXMgJ2xvZydcbiAqIC0gJ3BheW1lbnQudHJhbnNhY3Rpb24nIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAnbm90aWZpY2F0aW9uLnNlbnQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogXG4gKiBUbyBjb250cm9sIGJhY2tlbmQgcm91dGluZyBmb3IgY3VzdG9tIHR5cGVzLCB1c2UgdHlwZS1zcGVjaWZpYyBjb25maWc6XG4gKiBgYGBcbiAqIG9ic2VydmFiaWxpdHk6IHtcbiAqICAgdHlwZXM6IHtcbiAqICAgICBsb2c6IHsgYmFja2VuZHM6IFsnY2xvdWR3YXRjaCcsICdkeW5hbW9kYiddIH1cbiAqICAgfVxuICogfVxuICogYGBgXG4gKi9cbmZ1bmN0aW9uIGdldFR5cGVDYXRlZ29yeSh0eXBlOiBzdHJpbmcpOiAnc3BhbicgfCAnbWV0cmljJyB8ICdhdWRpdCcgfCAnbG9nJyB7XG4gIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ3NwYW4uJykpIHJldHVybiAnc3Bhbic7XG4gIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgLy8gQWxsIGN1c3RvbSBldmVudCB0eXBlcyBkZWZhdWx0IHRvICdsb2cnIGNhdGVnb3J5XG4gIC8vIFRoaXMgaW5jbHVkZXM6ICdidXNpbmVzcy4qJywgJ3BheW1lbnQuKicsICdub3RpZmljYXRpb24uKicsIGV0Yy5cbiAgcmV0dXJuICdsb2cnO1xufVxuXG5mdW5jdGlvbiBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgaWYgKHR5cGVDb25maWc/LmJhY2tlbmRzICYmIHR5cGVDb25maWcuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSk7XG4gIH1cblxuICByZXR1cm4gYmFja2VuZHM7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYmFja2VuZCBzaG91bGQgY2FwdHVyZSB0aGlzIGV2ZW50IGJhc2VkIG9uIHR5cGUgZmlsdGVyaW5nXG4gKi9cbmZ1bmN0aW9uIHNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShcbiAgYmFja2VuZDogT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnRcbik6IGJvb2xlYW4ge1xuICBjb25zdCBiYWNrZW5kQ2ZnID0gYmFja2VuZENvbmZpZ3MuZ2V0KGJhY2tlbmQubmFtZSk7XG4gIGlmICghYmFja2VuZENmZykgcmV0dXJuIHRydWU7IC8vIE5vIGNvbmZpZyA9IGFsbG93IGFsbFxuXG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgdHlwZUZpbHRlciA9IGJhY2tlbmRDZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgLy8gQ2hlY2sgaWYgdHlwZSBpcyBleHBsaWNpdGx5IGRpc2FibGVkIGZvciB0aGlzIGJhY2tlbmRcbiAgaWYgKHR5cGVGaWx0ZXI/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIENoZWNrIHBlci10eXBlIG1pbkxldmVsIChvdmVycmlkZXMgYmFja2VuZC1sZXZlbCBtaW5MZXZlbClcbiAgaWYgKHR5cGVGaWx0ZXI/Lm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZXZlbnRMZXZlbCA8IHR5cGVGaWx0ZXIubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoYmFja2VuZC5taW5MZXZlbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gRmFsbCBiYWNrIHRvIGJhY2tlbmQtbGV2ZWwgbWluTGV2ZWxcbiAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyBDaGVjayBwZXItdHlwZSBzYW1wbGluZ1xuICBpZiAodHlwZUZpbHRlcj8uc2FtcGxpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUZpbHRlci5zYW1wbGluZztcbiAgfVxuXG4gIHJldHVybiB0cnVlOyAvLyBQYXNzZWQgYWxsIGZpbHRlcnNcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogdm9pZCB7XG4gIGNvbnN0IHByb21pc2UgPSBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2FwdHVyZSBpbiBiYWNrZW5kICR7YmFja2VuZC5uYW1lfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfSksXG4gICkudGhlbigoKSA9PiB7IH0pOyAvLyBDb252ZXJ0IHRvIFByb21pc2U8dm9pZD5cblxuICAvLyBUcmFjayBwcm9taXNlIHNvIGZsdXNoKCkgY2FuIHdhaXQgZm9yIGl0XG4gIHBlbmRpbmdEaXNwYXRjaGVzLnB1c2gocHJvbWlzZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdGFyZ2V0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgdGFyZ2V0QmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIXNob3VsZEJhY2tlbmRDYXB0dXJlVHlwZShiYWNrZW5kLCBldmVudCkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZTogJ3NwYW4nIHwgJ21ldHJpYycgfCAnYXVkaXQnIHwgJ2xvZycpOiBPYnNlcnZhYmlsaXR5TGV2ZWwge1xuICBjb25zdCB0eXBlQ29uZmlnID0gY29uZmlnPy50eXBlcz8uWyB0eXBlIF07XG4gIHJldHVybiB0eXBlQ29uZmlnPy5taW5MZXZlbCA/PyBjb25maWc/Lm1pbkxldmVsID8/IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGFuIGV2ZW50IG1hdGNoZXMgYSBzYW1wbGluZyBydWxlXG4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNSdWxlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHJ1bGU6IFNhbXBsaW5nUnVsZSk6IGJvb2xlYW4ge1xuICBjb25zdCB7IHRhcmdldCwgcGF0dGVybiB9ID0gcnVsZTtcblxuICBsZXQgdmFsdWVUb01hdGNoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgc3dpdGNoICh0YXJnZXQpIHtcbiAgICBjYXNlICd0ZW5hbnQnOlxuICAgICAgLy8gQ2hlY2sgYWN0b3IudGVuYW50SWQgb3IgdGFncy50ZW5hbnRJZFxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LnRlbmFudElkID8/IGV2ZW50LnRhZ3M/LnRlbmFudElkO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdyb3V0ZSc6XG4gICAgICAvLyBDaGVjayBzb3VyY2UgKGUuZy4sIFwiT3JkZXJDb250cm9sbGVyLmNyZWF0ZVwiKSBvciBvcGVyYXRpb25cbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZSA/PyBldmVudC5vcGVyYXRpb247XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3RhZyc6XG4gICAgICAvLyBQYXR0ZXJuIGZvcm1hdDogXCJrZXk6dmFsdWVcIiBvciBcImtleToqXCJcbiAgICAgIGlmICh0eXBlb2YgcGF0dGVybiA9PT0gJ3N0cmluZycgJiYgcGF0dGVybi5pbmNsdWRlcygnOicpKSB7XG4gICAgICAgIGNvbnN0IFsga2V5LCB2YWx1ZVBhdHRlcm4gXSA9IHBhdHRlcm4uc3BsaXQoJzonLCAyKTtcbiAgICAgICAgY29uc3QgdGFnVmFsdWUgPSBldmVudC50YWdzPy5bIGtleSBdO1xuICAgICAgICBpZiAoIXRhZ1ZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgaWYgKHZhbHVlUGF0dGVybiA9PT0gJyonKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgICAvLyBUZXN0IGFnYWluc3QgdmFsdWUgcGF0dGVybiAoc3VwcG9ydHMgd2lsZGNhcmRzKVxuICAgICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleCh2YWx1ZVBhdHRlcm4pO1xuICAgICAgICByZXR1cm4gcmVnZXgudGVzdCh0YWdWYWx1ZSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICBjYXNlICdhY3Rvcic6XG4gICAgICAvLyBDaGVjayBhY3RvcklkIG9yIGFjdG9yVHlwZVxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuYWN0b3I/LmFjdG9ySWQgPz8gZXZlbnQuYWN0b3I/LmFjdG9yVHlwZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnc291cmNlJzpcbiAgICAgIHZhbHVlVG9NYXRjaCA9IGV2ZW50LnNvdXJjZTtcbiAgICAgIGJyZWFrO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICghdmFsdWVUb01hdGNoKSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gTWF0Y2ggYWdhaW5zdCBwYXR0ZXJuIChzdHJpbmcgb3IgUmVnRXhwKVxuICBpZiAocGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgIHJldHVybiBwYXR0ZXJuLnRlc3QodmFsdWVUb01hdGNoKTtcbiAgfVxuXG4gIC8vIFN0cmluZyBwYXR0ZXJuIHdpdGggd2lsZGNhcmQgc3VwcG9ydFxuICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgcmV0dXJuIHJlZ2V4LnRlc3QodmFsdWVUb01hdGNoKTtcbn1cblxuZnVuY3Rpb24gc2hvdWxkQ2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiBib29sZWFuIHtcbiAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuICBjb25zdCB0eXBlQ2F0ZWdvcnkgPSBnZXRUeXBlQ2F0ZWdvcnkoZXZlbnQudHlwZSk7XG4gIGNvbnN0IGVmZmVjdGl2ZUxldmVsID0gZ2V0RWZmZWN0aXZlTGV2ZWxGb3JUeXBlKHR5cGVDYXRlZ29yeSk7XG5cbiAgLy8gQ2hlY2sgbWluaW11bSBsZXZlbCBmaXJzdFxuICBpZiAobGV2ZWxWYWx1ZSA8IGVmZmVjdGl2ZUxldmVsKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gQ1JJVElDQUwgYWx3YXlzIGNhcHR1cmVkXG4gIGlmIChsZXZlbFZhbHVlID09PSBPYnNlcnZhYmlsaXR5TGV2ZWwuQ1JJVElDQUwpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIElmIHNhbXBsaW5nIGRpc2FibGVkLCBjYXB0dXJlIGV2ZXJ5dGhpbmdcbiAgaWYgKCFjZmcuc2FtcGxpbmc/LmVuYWJsZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vID09PSBSVUxFLUJBU0VEIFNBTVBMSU5HIChIaWdoZXN0IFByaW9yaXR5KSA9PT1cbiAgLy8gUnVsZXMgYXJlIGV2YWx1YXRlZCBpbiBvcmRlci4gRmlyc3QgbWF0Y2ggd2lucy5cbiAgaWYgKGNmZy5zYW1wbGluZy5ydWxlcyAmJiBjZmcuc2FtcGxpbmcucnVsZXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcnVsZSBvZiBjZmcuc2FtcGxpbmcucnVsZXMpIHtcbiAgICAgIGlmIChtYXRjaGVzUnVsZShldmVudCwgcnVsZSkpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCBydWxlLnJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IFRZUEUtU1BFQ0lGSUMgU0FNUExJTkcgPT09XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG4gIGlmICh0eXBlQ29uZmlnPy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICB9XG5cbiAgLy8gPT09IE9QRVJBVElPTi1CQVNFRCBTQU1QTElORyA9PT1cbiAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjZmcuc2FtcGxpbmcub3BlcmF0aW9ucykge1xuICAgIGZvciAoY29uc3QgWyBwYXR0ZXJuLCByYXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY2ZnLnNhbXBsaW5nLm9wZXJhdGlvbnMpKSB7XG4gICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgICAgIGlmIChyZWdleC50ZXN0KGV2ZW50Lm9wZXJhdGlvbikpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vID09PSBMRVZFTC1CQVNFRCBTQU1QTElORyAoRmFsbGJhY2spID09PVxuICBjb25zdCBsZXZlbE5hbWUgPSBsZXZlbFRvU3RyaW5nKGxldmVsVmFsdWUpO1xuICBjb25zdCByYXRlID0gY2ZnLnNhbXBsaW5nLnJhdGVzPy5bIGxldmVsTmFtZSBdO1xuICBpZiAocmF0ZSA9PT0gdW5kZWZpbmVkIHx8IHJhdGUgPj0gMSkgcmV0dXJuIHRydWU7XG4gIGlmIChyYXRlIDw9IDApIHJldHVybiBmYWxzZTtcblxuICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG59XG5cbmZ1bmN0aW9uIGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuOiBzdHJpbmcpOiBSZWdFeHAge1xuICBjb25zdCBNQVhfUkVHRVhfQ0FDSEVfU0laRSA9IDEwMDtcblxuICBsZXQgcmVnZXggPSBzYW1wbGluZ1JlZ2V4Q2FjaGUuZ2V0KHBhdHRlcm4pO1xuICBpZiAoIXJlZ2V4KSB7XG4gICAgLy8gRXZpY3Qgb2xkZXN0IGVudHJ5IGlmIGNhY2hlIGlzIGZ1bGwgKEZJRk8gZXZpY3Rpb24pXG4gICAgaWYgKHNhbXBsaW5nUmVnZXhDYWNoZS5zaXplID49IE1BWF9SRUdFWF9DQUNIRV9TSVpFKSB7XG4gICAgICBjb25zdCBmaXJzdEtleSA9IHNhbXBsaW5nUmVnZXhDYWNoZS5rZXlzKCkubmV4dCgpLnZhbHVlO1xuICAgICAgaWYgKGZpcnN0S2V5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2FtcGxpbmdSZWdleENhY2hlLmRlbGV0ZShmaXJzdEtleSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmVnZXggPSBuZXcgUmVnRXhwKGBeJHtwYXR0ZXJuLnJlcGxhY2UoL1xcKi9nLCAnLionKX0kYCk7XG4gICAgc2FtcGxpbmdSZWdleENhY2hlLnNldChwYXR0ZXJuLCByZWdleCk7XG4gIH1cbiAgcmV0dXJuIHJlZ2V4O1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBwcmlvcml0eSBmb3IgYnVmZmVyIGV2aWN0aW9uLlxuICogSGlnaGVyIHByaW9yaXR5ID0ga2VlcCBpbiBidWZmZXJcbiAqL1xuZnVuY3Rpb24gZ2V0RXZlbnRQcmlvcml0eShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogbnVtYmVyIHtcbiAgLy8gQ1JJVElDQUwgZXZlbnRzIE5FVkVSIGdldCBldmljdGVkIChtYXggcHJpb3JpdHkpXG4gIGlmIChldmVudC5jcml0aWNhbCkge1xuICAgIHJldHVybiBJbmZpbml0eTtcbiAgfVxuXG4gIGxldCBwcmlvcml0eSA9IDA7XG5cbiAgY29uc3QgbGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcblxuICAvLyBIaWdoZXIgbG9nIGxldmVscyA9IGhpZ2hlciBwcmlvcml0eVxuICBwcmlvcml0eSArPSBsZXZlbCAqIDEwO1xuXG4gIC8vIEF1ZGl0IGV2ZW50cyBhcmUgaGlnaCBwcmlvcml0eVxuICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSB7XG4gICAgcHJpb3JpdHkgKz0gNTA7XG4gIH1cblxuICAvLyBTcGFucyB3aXRoIGVycm9ycyBhcmUgaGlnaCBwcmlvcml0eVxuICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdzcGFuJykgJiYgZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UpIHtcbiAgICBwcmlvcml0eSArPSAzMDtcbiAgfVxuXG4gIC8vIExvbmcgZHVyYXRpb24gb3BlcmF0aW9ucyBhcmUgaW50ZXJlc3RpbmdcbiAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgJiYgZXZlbnQuZHVyYXRpb25NcyA+IDEwMDApIHtcbiAgICBwcmlvcml0eSArPSAyMDtcbiAgfVxuXG4gIHJldHVybiBwcmlvcml0eTtcbn1cblxuLyoqXG4gKiBFdmljdCBsb3dlc3QgcHJpb3JpdHkgZXZlbnQgZnJvbSBidWZmZXJcbiAqIFJldHVybnMgbWV0YWRhdGEgYWJvdXQgdGhlIGV2aWN0ZWQgZXZlbnQgZm9yIGxvZ2dpbmdcbiAqL1xuZnVuY3Rpb24gZXZpY3RMb3dlc3RQcmlvcml0eShidWZmZXI6IE9ic2VydmFiaWxpdHlFdmVudFtdKTogeyB0eXBlOiBzdHJpbmc7IGNvcnJlbGF0aW9uSWQ6IHN0cmluZzsgb3BlcmF0aW9uPzogc3RyaW5nOyBsZXZlbDogc3RyaW5nIH0gfCBudWxsIHtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEZpbmQgbG93ZXN0IHByaW9yaXR5IGV2ZW50XG4gIGxldCBsb3dlc3RQcmlvcml0eSA9IEluZmluaXR5O1xuICBsZXQgbG93ZXN0SW5kZXggPSAwO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYnVmZmVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgcHJpb3JpdHkgPSBnZXRFdmVudFByaW9yaXR5KGJ1ZmZlclsgaSBdKTtcbiAgICBpZiAocHJpb3JpdHkgPCBsb3dlc3RQcmlvcml0eSkge1xuICAgICAgbG93ZXN0UHJpb3JpdHkgPSBwcmlvcml0eTtcbiAgICAgIGxvd2VzdEluZGV4ID0gaTtcbiAgICB9XG4gIH1cblxuICAvLyBSZW1vdmUgYW5kIHJldHVybiBpbmZvIGFib3V0IGV2aWN0ZWQgZXZlbnRcbiAgY29uc3QgZXZpY3RlZCA9IGJ1ZmZlci5zcGxpY2UobG93ZXN0SW5kZXgsIDEpWyAwIF07XG4gIHJldHVybiB7XG4gICAgdHlwZTogZXZpY3RlZC50eXBlLFxuICAgIGNvcnJlbGF0aW9uSWQ6IGV2aWN0ZWQuY29ycmVsYXRpb25JZCxcbiAgICBvcGVyYXRpb246IGV2aWN0ZWQub3BlcmF0aW9uLFxuICAgIGxldmVsOiBldmljdGVkLmxldmVsLFxuICB9O1xufVxuXG4vKipcbiAqIEhhbmRsZSB0YWlsLWJhc2VkIHNhbXBsaW5nIGxvZ2ljIGZvciBhbiBldmVudCAoc3luYyB2ZXJzaW9uKVxuICogUmV0dXJuczogJ2NhcHR1cmVkJyBpZiBldmVudCB3YXMgY2FwdHVyZWQsICdidWZmZXJlZCcgaWYgYnVmZmVyZWQsICdza2lwJyBpZiBub3QgdXNpbmcgdGFpbC1iYXNlZFxuICovXG5mdW5jdGlvbiBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ1N5bmMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PlxuKTogJ2NhcHR1cmVkJyB8ICdidWZmZXJlZCcgfCAnc2tpcCcge1xuICBpZiAoIWNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0IHx8ICFjb250ZXh0KSB7XG4gICAgcmV0dXJuICdza2lwJztcbiAgfVxuXG4gIGNvbnN0IGlzRXJyb3IgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKSA+PSBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1I7XG5cbiAgLy8gRVJST1IgUEFUSDogRmx1c2ggYnVmZmVyICsgY2FwdHVyZSBlcnJvciArIHNldCBmbGFnXG4gIGlmIChpc0Vycm9yKSB7XG4gICAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlcj8ubGVuZ3RoKSB7XG4gICAgICBjb25zdCBidWZmZXIgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgYXMgT2JzZXJ2YWJpbGl0eUV2ZW50W107XG4gICAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5ID0gY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSB8fCB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICAgICAgY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyID0gW107XG5cbiAgICAgIC8vIEFwcGx5IGxldmVsIGZpbHRlcmluZyB0byBhdm9pZCBvdmVyd2hlbG1pbmcgYmFja2VuZHMgd2l0aCB0aG91c2FuZHMgb2YgZGVidWcvdHJhY2UgZXZlbnRzXG4gICAgICAvLyBPbiBlcnJvciwgY2FwdHVyZSBJTkZPKyBldmVudHMsIGRyb3AgVFJBQ0UvREVCVUcgdG8gcHJldmVudCBjb3N0IHNwaWtlc1xuICAgICAgY29uc3QgbWluTGV2ZWxPbkVycm9yID0gY29uZmlnLnNhbXBsaW5nPy5taW5MZXZlbE9uRXJyb3IgPz8gT2JzZXJ2YWJpbGl0eUxldmVsLklORk87XG4gICAgICBsZXQgZHJvcHBlZCA9IDA7XG5cbiAgICAgIGZvciAoY29uc3QgYnVmZmVyZWRFdmVudCBvZiBidWZmZXIpIHtcbiAgICAgICAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoYnVmZmVyZWRFdmVudC5sZXZlbCk7XG4gICAgICAgIGlmIChldmVudExldmVsID49IG1pbkxldmVsT25FcnJvcikge1xuICAgICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoYnVmZmVyZWRFdmVudC50eXBlKTtcbiAgICAgICAgICBkaXNwYXRjaFRvQmFja2VuZHMoYnVmZmVyZWRFdmVudCwgdGFyZ2V0cyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZHJvcHBlZCsrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChkcm9wcGVkID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYERyb3BwZWQgJHtkcm9wcGVkfSBsb3ctbGV2ZWwgZXZlbnRzIGZyb20gZXJyb3IgYnVmZmVyIGZsdXNoYCwge1xuICAgICAgICAgIG1pbkxldmVsOiBsZXZlbFRvU3RyaW5nKG1pbkxldmVsT25FcnJvciksXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb250ZXh0LmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuXG4gICAgLy8gVHJhY2sgY2FwdHVyZWQgY291bnRcbiAgICBpZiAoIWNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkpIHtcbiAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICAgIH1cbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmNhcHR1cmVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuY2FwdHVyZWQgfHwgMCkgKyAxO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBQT1NULUVSUk9SIFBBVEg6IENhcHR1cmUgaW1tZWRpYXRlbHlcbiAgaWYgKGNvbnRleHQuZXJyb3JPY2N1cnJlZCkge1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuXG4gICAgLy8gVHJhY2sgY2FwdHVyZWQgY291bnRcbiAgICBpZiAoIWNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkpIHtcbiAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICAgIH1cbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmNhcHR1cmVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuY2FwdHVyZWQgfHwgMCkgKyAxO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBOT1JNQUwgUEFUSDogQnVmZmVyIGV2ZXJ5dGhpbmdcbiAgaWYgKCFjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIpIGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciA9IFtdO1xuICBjb25zdCBidWZmZXIgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgYXMgT2JzZXJ2YWJpbGl0eUV2ZW50W107XG5cbiAgLy8gSW5pdGlhbGl6ZSBzdW1tYXJ5IGlmIG5lZWRlZFxuICBpZiAoIWNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkpIHtcbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5ID0geyBldmljdGVkOiAwLCBidWZmZXJlZDogMCwgY2FwdHVyZWQ6IDAgfTtcbiAgfVxuXG4gIC8vIEJ1ZmZlciBzaXplIG1hbmFnZW1lbnQ6IGV2aWN0IGxvd2VzdCBwcmlvcml0eSBpZiBmdWxsXG4gIGNvbnN0IG1heFNpemUgPSBjb25maWcuc2FtcGxpbmcubWF4QnVmZmVyU2l6ZSA/PyAxMDAwO1xuICBpZiAoYnVmZmVyLmxlbmd0aCA+PSBtYXhTaXplKSB7XG4gICAgY29uc3QgZXZpY3RlZEluZm8gPSBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlcik7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuZXZpY3RlZCB8fCAwKSArIDE7XG5cbiAgICAvLyBMb2cgd2FybmluZyB3aXRoIGV2aWN0ZWQgZXZlbnQgZGV0YWlsc1xuICAgIGlmIChjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQgPT09IDEgfHwgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkICUgMTAwID09PSAwKSB7XG4gICAgICBsb2dnZXIud2FybignT2JzZXJ2YWJpbGl0eSBidWZmZXIgZnVsbCwgZXZpY3RpbmcgbG93ZXN0IHByaW9yaXR5IGV2ZW50cycsIHtcbiAgICAgICAgZXZpY3RlZDogY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkLFxuICAgICAgICBidWZmZXJTaXplOiBidWZmZXIubGVuZ3RoLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIGV2aWN0ZWRFdmVudDogZXZpY3RlZEluZm8sXG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKGV2aWN0ZWRJbmZvKSB7XG4gICAgICAvLyBMb2cgZWFjaCBldmljdGlvbiBhdCBkZWJ1ZyBsZXZlbCBmb3IgdHJvdWJsZXNob290aW5nXG4gICAgICBsb2dnZXIuZGVidWcoJ0V2aWN0ZWQgb2JzZXJ2YWJpbGl0eSBldmVudCBmcm9tIGJ1ZmZlcicsIHtcbiAgICAgICAgLi4uZXZpY3RlZEluZm8sXG4gICAgICAgIHRvdGFsRXZpY3RlZDogY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYnVmZmVyLnB1c2goZXZlbnQpO1xuICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmJ1ZmZlcmVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuYnVmZmVyZWQgfHwgMCkgKyAxO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBIYW5kbGUgdGFpbC1iYXNlZCBzYW1wbGluZyBsb2dpYyBmb3IgYW4gZXZlbnQgKGFzeW5jIHZlcnNpb24pXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoXG4gIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PlxuKTogUHJvbWlzZTwnY2FwdHVyZWQnIHwgJ2J1ZmZlcmVkJyB8ICdza2lwJz4ge1xuICBpZiAoIWNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0IHx8ICFjb250ZXh0KSB7XG4gICAgcmV0dXJuICdza2lwJztcbiAgfVxuXG4gIGNvbnN0IGlzRXJyb3IgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKSA+PSBPYnNlcnZhYmlsaXR5TGV2ZWwuRVJST1I7XG5cbiAgLy8gRVJST1IgUEFUSDogRmx1c2ggYnVmZmVyICsgY2FwdHVyZSBlcnJvciArIHNldCBmbGFnXG4gIGlmIChpc0Vycm9yKSB7XG4gICAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlcj8ubGVuZ3RoKSB7XG4gICAgICBjb25zdCBidWZmZXIgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgYXMgT2JzZXJ2YWJpbGl0eUV2ZW50W107XG4gICAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5ID0gY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSB8fCB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICAgICAgY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyID0gW107XG5cbiAgICAgIC8vIEFwcGx5IGxldmVsIGZpbHRlcmluZyB0byBhdm9pZCBvdmVyd2hlbG1pbmcgYmFja2VuZHNcbiAgICAgIGNvbnN0IG1pbkxldmVsT25FcnJvciA9IGNvbmZpZy5zYW1wbGluZz8ubWluTGV2ZWxPbkVycm9yID8/IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPO1xuICAgICAgbGV0IGRyb3BwZWQgPSAwO1xuXG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IGJ1ZmZlci5maWx0ZXIoYnVmZmVyZWRFdmVudCA9PiB7XG4gICAgICAgIGNvbnN0IGV2ZW50TGV2ZWwgPSBzdHJpbmdUb0xldmVsKGJ1ZmZlcmVkRXZlbnQubGV2ZWwpO1xuICAgICAgICBpZiAoZXZlbnRMZXZlbCA+PSBtaW5MZXZlbE9uRXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBkcm9wcGVkKys7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChmaWx0ZXJlZEV2ZW50cy5tYXAoYnVmZmVyZWRFdmVudCA9PiB7XG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoYnVmZmVyZWRFdmVudC50eXBlKTtcbiAgICAgICAgcmV0dXJuIGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoYnVmZmVyZWRFdmVudCwgdGFyZ2V0cyk7XG4gICAgICB9KSk7XG5cbiAgICAgIGlmIChkcm9wcGVkID4gMCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoYERyb3BwZWQgJHtkcm9wcGVkfSBsb3ctbGV2ZWwgZXZlbnRzIGZyb20gZXJyb3IgYnVmZmVyIGZsdXNoYCwge1xuICAgICAgICAgIG1pbkxldmVsOiBsZXZlbFRvU3RyaW5nKG1pbkxldmVsT25FcnJvciksXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogY29udGV4dC5jb3JyZWxhdGlvbklkLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb250ZXh0LmVycm9yT2NjdXJyZWQgPSB0cnVlO1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcblxuICAgIC8vIFRyYWNrIGNhcHR1cmVkIGNvdW50XG4gICAgaWYgKCFjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5KSB7XG4gICAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5ID0geyBldmljdGVkOiAwLCBidWZmZXJlZDogMCwgY2FwdHVyZWQ6IDAgfTtcbiAgICB9XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5jYXB0dXJlZCA9IChjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmNhcHR1cmVkIHx8IDApICsgMTtcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gUE9TVC1FUlJPUiBQQVRIOiBDYXB0dXJlIGltbWVkaWF0ZWx5XG4gIGlmIChjb250ZXh0LmVycm9yT2NjdXJyZWQpIHtcbiAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICBhd2FpdCBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG5cbiAgICAvLyBUcmFjayBjYXB0dXJlZCBjb3VudFxuICAgIGlmICghY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSkge1xuICAgICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSA9IHsgZXZpY3RlZDogMCwgYnVmZmVyZWQ6IDAsIGNhcHR1cmVkOiAwIH07XG4gICAgfVxuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuY2FwdHVyZWQgPSAoY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5jYXB0dXJlZCB8fCAwKSArIDE7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZ1xuICBpZiAoIWNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlcikgY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyID0gW107XG4gIGNvbnN0IGJ1ZmZlciA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciBhcyBPYnNlcnZhYmlsaXR5RXZlbnRbXTtcblxuICAvLyBJbml0aWFsaXplIHN1bW1hcnkgaWYgbmVlZGVkXG4gIGlmICghY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSkge1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICB9XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNvbmZpZy5zYW1wbGluZy5tYXhCdWZmZXJTaXplID8/IDEwMDA7XG4gIGlmIChidWZmZXIubGVuZ3RoID49IG1heFNpemUpIHtcbiAgICBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlcik7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuZXZpY3RlZCB8fCAwKSArIDE7XG5cbiAgICAvLyBMb2cgd2FybmluZyBpZiBldmljdGluZyBhIGxvdFxuICAgIGlmIChjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQgPT09IDEgfHwgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkICUgMTAwID09PSAwKSB7XG4gICAgICBsb2dnZXIud2FybignT2JzZXJ2YWJpbGl0eSBidWZmZXIgZnVsbCwgZXZpY3RpbmcgbG93ZXN0IHByaW9yaXR5IGV2ZW50cycsIHtcbiAgICAgICAgZXZpY3RlZDogY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkLFxuICAgICAgICBidWZmZXJTaXplOiBidWZmZXIubGVuZ3RoLFxuICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWRcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGJ1ZmZlci5wdXNoKGV2ZW50KTtcbiAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5idWZmZXJlZCA9IChjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmJ1ZmZlcmVkIHx8IDApICsgMTtcbiAgcmV0dXJuICdidWZmZXJlZCc7XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBiYWNrZW5kcyBmcm9tIERJIGJhc2VkIG9uIGNvbmZpZ1xuICovXG5mdW5jdGlvbiBpbml0aWFsaXplQmFja2VuZHNGcm9tQ29uZmlnKGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHZvaWQge1xuICBiYWNrZW5kcyA9IFtdO1xuICBiYWNrZW5kQ29uZmlncy5jbGVhcigpO1xuICBjb25zdCBlbmFibGVkQmFja2VuZHMgPSBjZmcuYmFja2VuZHM/LmZpbHRlcihiID0+IGIuZW5hYmxlZCAhPT0gZmFsc2UpID8/IFtdO1xuICBjb25zdCBlbmFibGVkVHlwZXMgPSBlbmFibGVkQmFja2VuZHMubWFwKGIgPT4gYi50eXBlKTtcblxuICBmb3IgKGNvbnN0IGJhY2tlbmRDZmcgb2YgZW5hYmxlZEJhY2tlbmRzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJhY2tlbmQgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmU8T2JzZXJ2YWJpbGl0eUJhY2tlbmQ+KFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICAgICAgICB7IHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsIGJhY2tlbmRDZmcudHlwZSBdIH1cbiAgICAgICk7XG4gICAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICAgICAgYmFja2VuZENvbmZpZ3Muc2V0KGJhY2tlbmQubmFtZSwgYmFja2VuZENmZyk7XG4gICAgICBsb2dnZXIuZGVidWcoYEluaXRpYWxpemVkIGJhY2tlbmQ6ICR7YmFja2VuZC5uYW1lfWApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBOb1Byb3ZpZGVyRm91bmRFcnJvcikge1xuICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAnJHtiYWNrZW5kQ2ZnLnR5cGV9JyBub3QgZm91bmQgaW4gREksIHNraXBwaW5nYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGJhY2tlbmQgJyR7YmFja2VuZENmZy50eXBlfSc6YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEZhbGxiYWNrIHRvIENsb3VkV2F0Y2ggaWYgbm8gYmFja2VuZHMgZW5hYmxlZFxuICBpZiAoYmFja2VuZHMubGVuZ3RoID09PSAwKSB7XG4gICAgbG9nZ2VyLndhcm4oJ05vIGJhY2tlbmRzIGVuYWJsZWQsIGF0dGVtcHRpbmcgQ2xvdWRXYXRjaCBmYWxsYmFjaycpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBiYWNrZW5kID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlPE9ic2VydmFiaWxpdHlCYWNrZW5kPihcbiAgICAgICAgJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgICAgICAgeyB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnY2xvdWR3YXRjaCcgXSB9XG4gICAgICApO1xuICAgICAgYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgICAgIC8vIENyZWF0ZSBkZWZhdWx0IGNvbmZpZyBmb3IgZmFsbGJhY2tcbiAgICAgIGJhY2tlbmRDb25maWdzLnNldChiYWNrZW5kLm5hbWUsIHsgdHlwZTogJ2Nsb3Vkd2F0Y2gnLCBlbmFibGVkOiB0cnVlIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byByZXNvbHZlIGZhbGxiYWNrIENsb3VkV2F0Y2ggYmFja2VuZDonLCBlcnJvcik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRvSW5pdGlhbGl6ZSgpOiB2b2lkIHtcbiAgdHJ5IHtcbiAgICBsb2dnZXIuaW5mbygnPT09IE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gU1RBUlQgPT09Jyk7XG5cbiAgICAvLyBSZXNvbHZlIGNvbmZpZyBmcm9tIERJIChkZWZhdWx0cyByZWdpc3RlcmVkIGluIGluZGV4LnRzIGd1YXJhbnRlZSBhbGwgcmVxdWlyZWQgZmllbGRzKVxuICAgIGNvbmZpZyA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZUNvbmZpZzxPYnNlcnZhYmlsaXR5Q29uZmlnPignb2JzZXJ2YWJpbGl0eScpIGFzIE9ic2VydmFiaWxpdHlDb25maWc7XG4gICAgbG9nZ2VyLmluZm8oJ09ic2VydmFiaWxpdHkgY29uZmlnIGxvYWRlZCBmcm9tIERJJywge1xuICAgICAgZW5hYmxlZDogY29uZmlnLmVuYWJsZWQsXG4gICAgICBzZXJ2aWNlTmFtZTogY29uZmlnLnNlcnZpY2VOYW1lLFxuICAgICAgYmFja2VuZHM6IGNvbmZpZy5iYWNrZW5kcz8ubWFwKGIgPT4gYi50eXBlKSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCwgc21hcnQ6IGNvbmZpZy5zYW1wbGluZz8uc21hcnQgfSxcbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESVxuICAgIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY29uZmlnISk7XG4gICAgbG9nZ2VyLmluZm8oYEluaXRpYWxpemVkICR7YmFja2VuZHMubGVuZ3RofSBiYWNrZW5kKHMpOmAsIGJhY2tlbmRzLm1hcChiID0+IGIubmFtZSkpO1xuXG4gICAgLy8gUmVnaXN0ZXIgY2FwdHVyZXIgZm9yIG9ic2VydmVyc1xuICAgIGluaXRpYWxpemVDYXB0dXJlcih7XG4gICAgICBjYXB0dXJlOiAoaW5wdXQsIG9wdGlvbnMpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQsIG9wdGlvbnMpLFxuICAgICAgY2FwdHVyZUFzeW5jOiAoaW5wdXQsIG9wdGlvbnMpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmVBc3luYyhpbnB1dCwgb3B0aW9ucyksXG4gICAgfSk7XG5cbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG4gICAgbG9nZ2VyLmluZm8oJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIENPTVBMRVRFID09PScpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignISEhIE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gRkFJTEVEICEhIScsIGVycm9yKTtcbiAgICAvLyBTZXQgaW5pdGlhbGl6ZWQgPSB0cnVlIGFueXdheSB0byBwcmV2ZW50IHJlcGVhdGVkIGluaXQgYXR0ZW1wdHNcbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG4gICAgLy8gUmUtdGhyb3cgc28gd2Uga25vdyBzb21ldGhpbmcgaXMgYnJva2VuXG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQVUJMSUMgQVBJIC0gT2JzZXJ2YWJpbGl0eU1hbmFnZXJcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eU1hbmFnZXIge1xuXG4gIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmb3IgYSBuZXcgTGFtYmRhIGludm9jYXRpb25cbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCkgY2FsbGVkJywgeyBpbml0aWFsaXplZCwgaW52b2NhdGlvbkNvdW50IH0pO1xuXG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdOb3QgaW5pdGlhbGl6ZWQgeWV0LCBjYWxsaW5nIGRvSW5pdGlhbGl6ZSgpLi4uJyk7XG4gICAgICBkb0luaXRpYWxpemUoKTtcbiAgICB9XG5cbiAgICBpbnZvY2F0aW9uQ291bnQrKztcbiAgICBsb2dnZXIuZGVidWcoYEludm9jYXRpb24gJHtpbnZvY2F0aW9uQ291bnR9IHN0YXJ0aW5nLCBpbml0aWFsaXppbmcgJHtiYWNrZW5kcy5sZW5ndGh9IGJhY2tlbmQocylgKTtcblxuICAgIGZvciAoY29uc3QgYmFja2VuZCBvZiBiYWNrZW5kcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYmFja2VuZC5pbml0aWFsaXplSW52b2NhdGlvbj8uKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZhaWxlZCB0byBpbml0aWFsaXplIGludm9jYXRpb246YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyBpc0luaXRpYWxpemVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbml0aWFsaXplZDtcbiAgfVxuXG4gIHN0YXRpYyBpc0NvbGRTdGFydCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaW52b2NhdGlvbkNvdW50ID09PSAxO1xuICB9XG5cbiAgc3RhdGljIGdldEludm9jYXRpb25Db3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiBpbnZvY2F0aW9uQ291bnQ7XG4gIH1cblxuICBzdGF0aWMgZ2V0Q29uZmlnKCk6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsIHtcbiAgICByZXR1cm4gY29uZmlnO1xuICB9XG5cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuICAgIGNvbmZpZyA9IHsgLi4uY29uZmlnLCAuLi51cGRhdGVzIH07XG4gIH1cblxuICBzdGF0aWMgcmVnaXN0ZXJCYWNrZW5kKGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kKTogdm9pZCB7XG4gICAgaWYgKGJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICB9XG5cbiAgc3RhdGljIHVucmVnaXN0ZXJCYWNrZW5kKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGJhY2tlbmRzID0gYmFja2VuZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IG5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCAoZmlyZS1hbmQtZm9yZ2V0KVxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmUoaW5wdXQ6IENhcHR1cmVJbnB1dCwgb3B0aW9ucz86IENhcHR1cmVPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIud2Fybign4p2MIE9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJywgeyB0eXBlOiBpbnB1dC50eXBlLCBsZXZlbDogaW5wdXQubGV2ZWwgfSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgZGlzYWJsZWQsIHNraXBwaW5nIGNhcHR1cmUnLCB7IHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgLy8gTWVyZ2UgY3JpdGljYWwgZmxhZyBmcm9tIG9wdGlvbnMgaW50byBpbnB1dCBmb3IgZXZlbnQgY3JlYXRpb25cbiAgICAgIGNvbnN0IGV2ZW50SW5wdXQgPSBvcHRpb25zPy5jcml0aWNhbCA/IHsgLi4uaW5wdXQsIGNyaXRpY2FsOiB0cnVlIH0gOiBpbnB1dDtcbiAgICAgIGNvbnN0IGV2ZW50ID0gYnVpbGRFdmVudChldmVudElucHV0LCBjb250ZXh0KTtcblxuICAgICAgLy8gVHJ5IHRhaWwtYmFzZWQgc2FtcGxpbmcgZmlyc3RcbiAgICAgIGNvbnN0IHRhaWxSZXN1bHQgPSBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ1N5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgU0FNUExJTkcgKFN0YW5kYXJkKVxuICAgICAgY29uc3QgaXNTYW1wbGVkID0gZXZlbnQuY3JpdGljYWwgfHwgc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKTtcbiAgICAgIGlmICghaXNTYW1wbGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgaW4gY2FwdHVyZTonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlIGFuIG9ic2VydmFiaWxpdHkgZXZlbnQgYXN5bmNocm9ub3VzbHkgKHdhaXRzIGZvciBiYWNrZW5kIGNhcHR1cmUpXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2FwdHVyZUFzeW5jKGlucHV0OiBDYXB0dXJlSW5wdXQsIG9wdGlvbnM/OiBPbWl0PENhcHR1cmVPcHRpb25zLCAnc3luYyc+KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICAvLyBNZXJnZSBjcml0aWNhbCBmbGFnIGZyb20gb3B0aW9ucyBpbnRvIGlucHV0IGZvciBldmVudCBjcmVhdGlvblxuICAgICAgY29uc3QgZXZlbnRJbnB1dCA9IG9wdGlvbnM/LmNyaXRpY2FsID8geyAuLi5pbnB1dCwgY3JpdGljYWw6IHRydWUgfSA6IGlucHV0O1xuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGV2ZW50SW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGF3YWl0IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgU0FNUExJTkcgKFN0YW5kYXJkKVxuICAgICAgY29uc3QgaXNTYW1wbGVkID0gZXZlbnQuY3JpdGljYWwgfHwgc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKTtcbiAgICAgIGlmICghaXNTYW1wbGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmVBc3luYzonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPYnNlcnZlIGFuIGV2ZW50XG4gICAqL1xuICBzdGF0aWMgb2JzZXJ2ZShcbiAgICBldmVudDogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+ICYgeyB0eXBlOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmcgfSxcbiAgICBvcHRpb25zPzogQ2FwdHVyZU9wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZXZlbnQuY29ycmVsYXRpb25JZCA/PyBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTtcblxuICAgIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ29ic2VydmUoKSBjYWxsZWQgd2l0aG91dCBjb3JyZWxhdGlvbklkJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUgYXMgQ2FwdHVyZUlucHV0WyAndHlwZScgXSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCBhcyBDYXB0dXJlSW5wdXRbICdsZXZlbCcgXSxcbiAgICB9LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaCBhbGwgYmFja2VuZHMgYW5kIGJ1ZmZlcmVkIGV2ZW50cyAoY2FsbGVkIGF0IGVuZCBvZiBMYW1iZGEgaW52b2NhdGlvbilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBGTFVTSCBTVEFSVCA9PT0nLCB7XG4gICAgICBwZW5kaW5nRGlzcGF0Y2hlczogcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoLFxuICAgICAgYmFja2VuZHM6IGJhY2tlbmRzLmxlbmd0aCxcbiAgICAgIHNtYXJ0U2FtcGxpbmc6IGNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0LFxuICAgIH0pO1xuXG4gICAgLy8gV2FpdCBmb3IgYWxsIHBlbmRpbmcgZmlyZS1hbmQtZm9yZ2V0IGRpc3BhdGNoZXMgKGZyb20gZXJyb3IgcGF0aCBpbiBjYXB0dXJlKCkpXG4gICAgaWYgKHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgV2FpdGluZyBmb3IgJHtwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGh9IHBlbmRpbmcgZGlzcGF0Y2hlc2ApO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocGVuZGluZ0Rpc3BhdGNoZXMpO1xuICAgICAgcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID0gMDsgLy8gQ2xlYXIgZm9yIG5leHQgaW52b2NhdGlvblxuICAgICAgbG9nZ2VyLmRlYnVnKCdQZW5kaW5nIGRpc3BhdGNoZXMgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gSWYgc21hcnQgc2FtcGxpbmcgaXMgZW5hYmxlZCwgZmx1c2ggYnVmZmVyZWQgZXZlbnRzIHdpdGggc2FtcGxpbmcgYXBwbGllZFxuICAgIGlmIChjb25maWc/LnNhbXBsaW5nPy5zbWFydCkge1xuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgICAgIGlmIChjb250ZXh0Py5vYnNlcnZhYmlsaXR5QnVmZmVyPy5sZW5ndGggJiYgIWNvbnRleHQuZXJyb3JPY2N1cnJlZCkge1xuICAgICAgICAvLyBObyBlcnJvciBvY2N1cnJlZDogYXBwbHkgc2FtcGxpbmcgdG8gYnVmZmVyIGJlZm9yZSBmbHVzaGluZ1xuICAgICAgICBjb25zdCBidWZmZXIgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgYXMgT2JzZXJ2YWJpbGl0eUV2ZW50W107XG4gICAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciA9IFtdOyAvLyBDbGVhciBidWZmZXJcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGJ1ZmZlcikge1xuICAgICAgICAgIC8vIEFwcGx5IHNhbXBsaW5nIHJ1bGVzIHRvIGJ1ZmZlcmVkIGV2ZW50XG4gICAgICAgICAgY29uc3QgaXNTYW1wbGVkID0gc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKTtcbiAgICAgICAgICBpZiAoaXNTYW1wbGVkKSB7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0cyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGVsc2U6IGRyb3BwZWQgYnkgc2FtcGxpbmdcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gSWYgZXJyb3JPY2N1cnJlZD10cnVlLCBidWZmZXIgd2FzIGFscmVhZHkgZmx1c2hlZCBkdXJpbmcgY2FwdHVyZVxuICAgIH1cblxuICAgIC8vIEZsdXNoIGFsbCBiYWNrZW5kcyB3aXRoIHJldHJ5IGxvZ2ljXG4gICAgY29uc3QgTUFYX0ZMVVNIX1JFVFJJRVMgPSAyO1xuICAgIGNvbnN0IGZsdXNoUHJvbWlzZXMgPSBiYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIGlmICghYmFja2VuZC5mbHVzaCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGF0dGVtcHQgPSAxOyBhdHRlbXB0IDw9IE1BWF9GTFVTSF9SRVRSSUVTOyBhdHRlbXB0KyspIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG4gICAgICAgICAgYnJlYWs7IC8vIFN1Y2Nlc3NcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoYXR0ZW1wdCA9PT0gTUFYX0ZMVVNIX1JFVFJJRVMpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIGFmdGVyICR7YXR0ZW1wdH0gYXR0ZW1wdHM6YCwgZXJyb3IpO1xuICAgICAgICAgICAgLy8gRXZlbnRzIG1heSBiZSBsb3N0LCBidXQgd2UndmUgZG9uZSBvdXIgYmVzdFxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIChhdHRlbXB0ICR7YXR0ZW1wdH0vJHtNQVhfRkxVU0hfUkVUUklFU30pLCByZXRyeWluZy4uLmAsIGVycm9yKTtcbiAgICAgICAgICAgIC8vIFNpbXBsZSBleHBvbmVudGlhbCBiYWNrb2ZmXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwICogYXR0ZW1wdCkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZmx1c2hQcm9taXNlcyk7XG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gRkxVU0ggQ09NUExFVEUgPT09Jyk7XG4gIH1cblxuICAvKipcbiAgICogUmVzZXQgbWFuYWdlciBzdGF0ZSAoZm9yIHRlc3RpbmcpXG4gICAqL1xuICBzdGF0aWMgcmVzZXQoKTogdm9pZCB7XG4gICAgY29uZmlnID0gbnVsbDtcbiAgICBiYWNrZW5kcyA9IFtdO1xuICAgIGJhY2tlbmRDb25maWdzLmNsZWFyKCk7XG4gICAgaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgICBpbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIHNhbXBsaW5nUmVnZXhDYWNoZS5jbGVhcigpO1xuICAgIHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA9IDA7XG4gICAgcmVzZXRDYXB0dXJlcigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgZm9yIHRlc3Rpbmcgd2l0aCBtb2NrIGNvbmZpZyBhbmQgYmFja2VuZHNcbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplRm9yVGVzdGluZyhcbiAgICB0ZXN0Q29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICAgIHRlc3RCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdXG4gICk6IHZvaWQge1xuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLnJlc2V0KCk7XG4gICAgY29uZmlnID0gdGVzdENvbmZpZztcbiAgICBiYWNrZW5kcyA9IHRlc3RCYWNrZW5kcztcbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG5cbiAgICBpbml0aWFsaXplQ2FwdHVyZXIoe1xuICAgICAgY2FwdHVyZTogKGlucHV0LCBvcHRpb25zKSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKGlucHV0LCBvcHRpb25zKSxcbiAgICAgIGNhcHR1cmVBc3luYzogKGlucHV0LCBvcHRpb25zKSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlQXN5bmMoaW5wdXQsIG9wdGlvbnMpLFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogTGFtYmRhIGhhbmRsZXIgd3JhcHBlciB3aXRoIG9ic2VydmFiaWxpdHkgbGlmZWN5Y2xlIG1hbmFnZW1lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHdpdGhPYnNlcnZhYmlsaXR5ID0gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiBQcm9taXNlPHVua25vd24+PihoYW5kbGVyOiBUKTogVCA9PiB7XG4gIHJldHVybiAoYXN5bmMgKC4uLmFyZ3M6IFBhcmFtZXRlcnM8VD4pID0+IHtcbiAgICB0cnkge1xuICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH1cbiAgfSkgYXMgVDtcbn07XG5cbmV4cG9ydCBjb25zdCBPYnNlcnZlciA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyO1xuIl19