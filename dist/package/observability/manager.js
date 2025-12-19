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
 * Initialize source-map-support if enabled in config
 * Provides better stack traces for TypeScript/transpiled code in production
 */
function initializeSourceMapSupport(cfg) {
    if (!cfg.sourceMap?.enabled) {
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
        if (error.code === 'MODULE_NOT_FOUND') {
            logger.warn('source-map-support package not found. Install it for better error stack traces: npm install source-map-support');
        }
        else {
            logger.warn('Failed to load source-map-support:', error.message);
        }
    }
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
        // Resolve config from DI (defaults registered in index.ts guarantee all required fields)
        config = di_1.DIContainer.ROOT.resolveConfig('observability');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILG1DQUFvQztBQUNwQyx3Q0FBMEM7QUFDMUMsbUNBU2lCO0FBQ2pCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELHVDQUF3RTtBQUN4RSwyQ0FBcUU7QUFDckUsOEJBQW9DO0FBQ3BDLHlDQUFvRDtBQUVwRCxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQU9wRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxJQUFJLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0FBQzlDLElBQUksUUFBUSxHQUEyQixFQUFFLENBQUM7QUFDMUMsSUFBSSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQWtELENBQUM7QUFDL0UsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztBQUN4QixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBQ3JELE1BQU0saUJBQWlCLEdBQW9CLEVBQUUsQ0FBQyxDQUFDLDZDQUE2QztBQUU1Rjs7O0dBR0c7QUFDSCxNQUFNLFlBQVksR0FBc0IsRUFBRSxDQUFDO0FBRTNDLDhFQUE4RTtBQUM5RSwyQkFBMkI7QUFDM0IsOEVBQThFO0FBRTlFLFNBQVMsYUFBYSxDQUFDLEtBQW1CO0lBQ3hDLE1BQU0sTUFBTSxHQUFzQixFQUFFLENBQUM7SUFDckMsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO0lBRXBDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDaEIsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FB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QyxPQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQyxDQUFNLENBQUM7QUFDVixDQUFDLENBQUM7QUFUVyxRQUFBLGlCQUFpQixxQkFTNUI7QUFFVyxRQUFBLFFBQVEsR0FBRyxvQkFBb0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eU1hbmFnZXIgLSBDb3JlIE9ic2VydmVyIGZvciB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW1cbiAqIFxuICogQWxsIGNvbmZpZyBhbmQgYmFja2VuZHMgcmVzb2x2ZWQgZnJvbSBESSAtIG5vIG1hbnVhbCBpbnN0YW50aWF0aW9uLlxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQge1xuICBDYXB0dXJlSW5wdXQsXG4gIENhcHR1cmVPcHRpb25zLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgU2FtcGxpbmdSdWxlLFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IHN0cmluZ1RvTGV2ZWwsIGxldmVsVG9TdHJpbmcgfSBmcm9tICcuL3V0aWxzL2xldmVsLXV0aWxzJztcbmltcG9ydCB7IGRldGVjdFNvdXJjZSwgbWVyZ2VUYWdzIH0gZnJvbSAnLi91dGlscy9zb3VyY2UtdXRpbHMnO1xuaW1wb3J0IHsgcmVkYWN0U2Vuc2l0aXZlRGF0YSB9IGZyb20gJy4vdXRpbHMvZGF0YS1wcm90ZWN0aW9uJztcbmltcG9ydCB7IGdldEN1cnJlbnRDb250ZXh0LCBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMgfSBmcm9tICcuL2NvbnRleHQnO1xuaW1wb3J0IHsgaW5pdGlhbGl6ZUNhcHR1cmVyLCByZXNldENhcHR1cmVyIH0gZnJvbSAnLi9vYnNlcnZlcnMvYmFzZSc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uL2RpJztcbmltcG9ydCB7IE5vUHJvdmlkZXJGb3VuZEVycm9yIH0gZnJvbSAnLi4vZGkvZXJyb3JzJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdPYnNlcnZhYmlsaXR5TWFuYWdlcicpO1xuXG5pbnRlcmZhY2UgVmFsaWRhdGlvbkVycm9yIHtcbiAgZmllbGQ6IHN0cmluZztcbiAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbi8vIFBSSVZBVEUgTU9EVUxFIFNUQVRFXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxubGV0IGNvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyB8IG51bGwgPSBudWxsO1xubGV0IGJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdID0gW107XG5sZXQgYmFja2VuZENvbmZpZ3MgPSBuZXcgTWFwPHN0cmluZywgT2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ2JhY2tlbmRzJyBdWyAwIF0+KCk7XG5sZXQgaW52b2NhdGlvbkNvdW50ID0gMDtcbmxldCBpbml0aWFsaXplZCA9IGZhbHNlO1xuY29uc3Qgc2FtcGxpbmdSZWdleENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIFJlZ0V4cD4oKTtcbmNvbnN0IHBlbmRpbmdEaXNwYXRjaGVzOiBQcm9taXNlPHZvaWQ+W10gPSBbXTsgLy8gVHJhY2sgZmlyZS1hbmQtZm9yZ2V0IHByb21pc2VzIGZvciBmbHVzaCgpXG5cbi8qKlxuICogUHJlLWluaXRpYWxpemF0aW9uIGhvb2tzIC0gY2FsbGJhY2tzIHRoYXQgcnVuIGJlZm9yZSBiYWNrZW5kcyBhcmUgaW5pdGlhbGl6ZWQuXG4gKiBVc2VkIHRvIHJlZ2lzdGVyIHNjaGVtYXMvc2VydmljZXMgbmVlZGVkIGJ5IGJhY2tlbmRzIHdpdGhvdXQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICovXG5jb25zdCBwcmVJbml0SG9va3M6IEFycmF5PCgpID0+IHZvaWQ+ID0gW107XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBIRUxQRVIgRlVOQ1RJT05TXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZnVuY3Rpb24gdmFsaWRhdGVJbnB1dChpbnB1dDogQ2FwdHVyZUlucHV0KTogVmFsaWRhdGlvbkVycm9yW10ge1xuICBjb25zdCBlcnJvcnM6IFZhbGlkYXRpb25FcnJvcltdID0gW107XG4gIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gIGlmICghaW5wdXQudHlwZSkge1xuICAgIGVycm9ycy5wdXNoKHsgZmllbGQ6ICd0eXBlJywgbWVzc2FnZTogJ3R5cGUgaXMgcmVxdWlyZWQnIH0pO1xuICB9XG5cbiAgaWYgKCFpbnB1dC5sZXZlbCkge1xuICAgIGVycm9ycy5wdXNoKHsgZmllbGQ6ICdsZXZlbCcsIG1lc3NhZ2U6ICdsZXZlbCBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmNvcnJlbGF0aW9uSWQgJiYgIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICBlcnJvcnMucHVzaCh7XG4gICAgICBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgbWVzc2FnZTogJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQuIEVzdGFibGlzaCBjb250ZXh0IHdpdGggcnVuV2l0aENvbnRleHQoKSBvciBwcm92aWRlIGV4cGxpY2l0bHkuJ1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGVycm9ycztcbn1cblxuZnVuY3Rpb24gYXBwbHlEYXRhUHJvdGVjdGlvbihcbiAgaW5wdXQ6IENhcHR1cmVJbnB1dCxcbiAgZGF0YVByb3RlY3Rpb24/OiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnZGF0YVByb3RlY3Rpb24nIF1cbik6IHtcbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgZXJyb3I/OiBPYnNlcnZhYmlsaXR5RXJyb3I7XG59IHtcbiAgaWYgKCFkYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCkge1xuICAgIHJldHVybiB7XG4gICAgICBkYXRhOiBpbnB1dC5kYXRhLFxuICAgICAgYXR0cmlidXRlczogaW5wdXQuYXR0cmlidXRlcyxcbiAgICAgIG1ldGFkYXRhOiBpbnB1dC5tZXRhZGF0YSxcbiAgICAgIGNvbnRleHQ6IGlucHV0LmNvbnRleHQsXG4gICAgICBlcnJvcjogaW5wdXQuZXJyb3IsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGZpZWxkcyA9IGRhdGFQcm90ZWN0aW9uLmZpZWxkcyA/PyBbICdkYXRhJywgJ2F0dHJpYnV0ZXMnLCAnbWV0YWRhdGEnLCAnY29udGV4dCcgXTtcblxuICByZXR1cm4ge1xuICAgIGRhdGE6IGZpZWxkcy5pbmNsdWRlcygnZGF0YScpICYmIGlucHV0LmRhdGFcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5kYXRhLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZGF0YSxcbiAgICBhdHRyaWJ1dGVzOiBmaWVsZHMuaW5jbHVkZXMoJ2F0dHJpYnV0ZXMnKSAmJiBpbnB1dC5hdHRyaWJ1dGVzXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuYXR0cmlidXRlcywgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGE6IGZpZWxkcy5pbmNsdWRlcygnbWV0YWRhdGEnKSAmJiBpbnB1dC5tZXRhZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0Lm1ldGFkYXRhLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQubWV0YWRhdGEsXG4gICAgY29udGV4dDogZmllbGRzLmluY2x1ZGVzKCdjb250ZXh0JykgJiYgaW5wdXQuY29udGV4dFxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmNvbnRleHQsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5jb250ZXh0LFxuICAgIGVycm9yOiBmaWVsZHMuaW5jbHVkZXMoJ2Vycm9yJykgJiYgaW5wdXQuZXJyb3JcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5lcnJvciwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmVycm9yLFxuICB9O1xufVxuXG5mdW5jdGlvbiBidWlsZEV2ZW50KGlucHV0OiBDYXB0dXJlSW5wdXQsIGNvbnRleHQ6IFJldHVyblR5cGU8dHlwZW9mIGdldEN1cnJlbnRDb250ZXh0PiB8IG51bGwgPSBudWxsKTogT2JzZXJ2YWJpbGl0eUV2ZW50IHtcbiAgY29uc3QgY3R4ID0gY29udGV4dCA/PyBnZXRDdXJyZW50Q29udGV4dCgpO1xuICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuXG4gIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBpbnB1dC5jb3JyZWxhdGlvbklkID8/IGN0eD8uY29ycmVsYXRpb25JZDtcbiAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkIC0gdGhpcyBzaG91bGQgaGF2ZSBiZWVuIGNhdWdodCBieSB2YWxpZGF0aW9uJyk7XG4gIH1cblxuICBjb25zdCB7IGRhdGEsIGF0dHJpYnV0ZXMsIG1ldGFkYXRhLCBjb250ZXh0OiBldmVudENvbnRleHQsIGVycm9yIH0gPSBhcHBseURhdGFQcm90ZWN0aW9uKFxuICAgIGlucHV0LFxuICAgIGNvbmZpZz8uZGF0YVByb3RlY3Rpb25cbiAgKTtcblxuICByZXR1cm4ge1xuICAgIHR5cGU6IGlucHV0LnR5cGUsXG4gICAgbGV2ZWw6IGlucHV0LmxldmVsLFxuICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgdGltZXN0YW1wTXM6IGlucHV0LnRpbWVzdGFtcE1zID8/IG5vdyxcbiAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGlucHV0Lm9ic2VydmFiaWxpdHlMb2dJZCA/PyByYW5kb21VVUlEKCksXG4gICAgLy8gbnVsbCA9IGV4cGxpY2l0bHkgbm8gcGFyZW50IChkb24ndCBmYWxsIGJhY2spLCB1bmRlZmluZWQgPSB1c2UgY29udGV4dFxuICAgIHBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID09PSBudWxsXG4gICAgICA/IHVuZGVmaW5lZFxuICAgICAgOiAoaW5wdXQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID8/IGN0eD8ucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSxcbiAgICBjYXVzZWRCeTogaW5wdXQuY2F1c2VkQnksXG4gICAgcmVsYXRlZFRyYWNlczogaW5wdXQucmVsYXRlZFRyYWNlcyxcbiAgICBhY3RvcjogaW5wdXQuYWN0b3IgPz8gY3R4Py5hY3RvcixcbiAgICBzb3VyY2U6IGlucHV0LnNvdXJjZSA/PyBjdHg/LnNvdXJjZSA/PyBkZXRlY3RTb3VyY2UoKSxcbiAgICB0YWdzOiBtZXJnZVRhZ3MoeyAuLi5jdHg/LnRhZ3MsIC4uLmlucHV0LnRhZ3MgfSwgdHJ1ZSksXG4gICAgZW50aXR5TmFtZTogaW5wdXQuZW50aXR5TmFtZSxcbiAgICBlbnRpdHlJZDogaW5wdXQuZW50aXR5SWQsXG4gICAgb3BlcmF0aW9uOiBpbnB1dC5vcGVyYXRpb24sXG4gICAgc3ViVHlwZTogaW5wdXQuc3ViVHlwZSxcbiAgICBzdGF0dXM6IGlucHV0LnN0YXR1cyxcbiAgICBzdWNjZXNzOiBpbnB1dC5zdWNjZXNzLFxuICAgIGR1cmF0aW9uTXM6IGlucHV0LmR1cmF0aW9uTXMsXG4gICAgZGF0YSxcbiAgICBhdHRyaWJ1dGVzLFxuICAgIG1ldGFkYXRhLFxuICAgIG1ldHJpY3M6IGlucHV0Lm1ldHJpY3MsXG4gICAgY29udGV4dDogZXZlbnRDb250ZXh0LFxuICAgIGVycm9yLFxuICAgIGNyaXRpY2FsOiBpbnB1dC5jcml0aWNhbCxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXRlZ29yaXplIGV2ZW50IHR5cGUgZm9yIGJhY2tlbmQgcm91dGluZyBhbmQgc2FtcGxpbmdcbiAqIFxuICogQ3VzdG9tIGV2ZW50IHR5cGVzIGFyZSBzdXBwb3J0ZWQhIFVzZSBhbnkgbmFtaW5nIGNvbnZlbnRpb246XG4gKiAtICdidXNpbmVzcy5vcmRlcl9wbGFjZWQnIOKGkiBjYXRlZ29yaXplZCBhcyAnbG9nJ1xuICogLSAncGF5bWVudC50cmFuc2FjdGlvbicg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiAtICdub3RpZmljYXRpb24uc2VudCcg4oaSIGNhdGVnb3JpemVkIGFzICdsb2cnXG4gKiBcbiAqIFRvIGNvbnRyb2wgYmFja2VuZCByb3V0aW5nIGZvciBjdXN0b20gdHlwZXMsIHVzZSB0eXBlLXNwZWNpZmljIGNvbmZpZzpcbiAqIGBgYFxuICogb2JzZXJ2YWJpbGl0eToge1xuICogICB0eXBlczoge1xuICogICAgIGxvZzogeyBiYWNrZW5kczogWydjbG91ZHdhdGNoJywgJ2R5bmFtb2RiJ10gfVxuICogICB9XG4gKiB9XG4gKiBgYGBcbiAqL1xuZnVuY3Rpb24gZ2V0VHlwZUNhdGVnb3J5KHR5cGU6IHN0cmluZyk6ICdzcGFuJyB8ICdtZXRyaWMnIHwgJ2F1ZGl0JyB8ICdsb2cnIHtcbiAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnc3Bhbi4nKSkgcmV0dXJuICdzcGFuJztcbiAgaWYgKHR5cGUgPT09ICdtZXRyaWMnKSByZXR1cm4gJ21ldHJpYyc7XG4gIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0JykpIHJldHVybiAnYXVkaXQnO1xuICAvLyBBbGwgY3VzdG9tIGV2ZW50IHR5cGVzIGRlZmF1bHQgdG8gJ2xvZycgY2F0ZWdvcnlcbiAgLy8gVGhpcyBpbmNsdWRlczogJ2J1c2luZXNzLionLCAncGF5bWVudC4qJywgJ25vdGlmaWNhdGlvbi4qJywgZXRjLlxuICByZXR1cm4gJ2xvZyc7XG59XG5cbmZ1bmN0aW9uIGdldEJhY2tlbmRzRm9yVHlwZSh0eXBlOiBzdHJpbmcpOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdIHtcbiAgY29uc3QgdHlwZUNhdGVnb3J5ID0gZ2V0VHlwZUNhdGVnb3J5KHR5cGUpO1xuICBjb25zdCB0eXBlQ29uZmlnID0gY29uZmlnPy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcblxuICBpZiAodHlwZUNvbmZpZz8uYmFja2VuZHMgJiYgdHlwZUNvbmZpZy5iYWNrZW5kcy5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIGJhY2tlbmRzLmZpbHRlcigoYikgPT4gdHlwZUNvbmZpZy5iYWNrZW5kcyEuaW5jbHVkZXMoYi5uYW1lIGFzICdjbG91ZHdhdGNoJyB8ICdkeW5hbW9kYicgfCAnb3RlbCcpKTtcbiAgfVxuXG4gIHJldHVybiBiYWNrZW5kcztcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBiYWNrZW5kIHNob3VsZCBjYXB0dXJlIHRoaXMgZXZlbnQgYmFzZWQgb24gdHlwZSBmaWx0ZXJpbmdcbiAqL1xuZnVuY3Rpb24gc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKFxuICBiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudFxuKTogYm9vbGVhbiB7XG4gIGNvbnN0IGJhY2tlbmRDZmcgPSBiYWNrZW5kQ29uZmlncy5nZXQoYmFja2VuZC5uYW1lKTtcbiAgaWYgKCFiYWNrZW5kQ2ZnKSByZXR1cm4gdHJ1ZTsgLy8gTm8gY29uZmlnID0gYWxsb3cgYWxsXG5cbiAgY29uc3QgdHlwZUNhdGVnb3J5ID0gZ2V0VHlwZUNhdGVnb3J5KGV2ZW50LnR5cGUpO1xuICBjb25zdCB0eXBlRmlsdGVyID0gYmFja2VuZENmZy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcblxuICAvLyBDaGVjayBpZiB0eXBlIGlzIGV4cGxpY2l0bHkgZGlzYWJsZWQgZm9yIHRoaXMgYmFja2VuZFxuICBpZiAodHlwZUZpbHRlcj8uZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBldmVudExldmVsID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG5cbiAgLy8gQ2hlY2sgcGVyLXR5cGUgbWluTGV2ZWwgKG92ZXJyaWRlcyBiYWNrZW5kLWxldmVsIG1pbkxldmVsKVxuICBpZiAodHlwZUZpbHRlcj8ubWluTGV2ZWwgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChldmVudExldmVsIDwgdHlwZUZpbHRlci5taW5MZXZlbCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIGlmIChiYWNrZW5kLm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBGYWxsIGJhY2sgdG8gYmFja2VuZC1sZXZlbCBtaW5MZXZlbFxuICAgIGlmIChldmVudExldmVsIDwgYmFja2VuZC5taW5MZXZlbCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIENoZWNrIHBlci10eXBlIHNhbXBsaW5nXG4gIGlmICh0eXBlRmlsdGVyPy5zYW1wbGluZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCB0eXBlRmlsdGVyLnNhbXBsaW5nO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7IC8vIFBhc3NlZCBhbGwgZmlsdGVyc1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgdGFyZ2V0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10pOiB2b2lkIHtcbiAgY29uc3QgcHJvbWlzZSA9IFByb21pc2UuYWxsKFxuICAgIHRhcmdldEJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFzaG91bGRCYWNrZW5kQ2FwdHVyZVR5cGUoYmFja2VuZCwgZXZlbnQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBjYXB0dXJlIGluIGJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KSxcbiAgKS50aGVuKCgpID0+IHsgfSk7IC8vIENvbnZlcnQgdG8gUHJvbWlzZTx2b2lkPlxuXG4gIC8vIFRyYWNrIHByb21pc2Ugc28gZmx1c2goKSBjYW4gd2FpdCBmb3IgaXRcbiAgcGVuZGluZ0Rpc3BhdGNoZXMucHVzaChwcm9taXNlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCB0YXJnZXRCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICB0YXJnZXRCYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICghc2hvdWxkQmFja2VuZENhcHR1cmVUeXBlKGJhY2tlbmQsIGV2ZW50KSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBiYWNrZW5kLmNhcHR1cmUoZXZlbnQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2FwdHVyZSBpbiBiYWNrZW5kICR7YmFja2VuZC5uYW1lfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfSksXG4gICk7XG59XG5cbmZ1bmN0aW9uIGdldEVmZmVjdGl2ZUxldmVsRm9yVHlwZSh0eXBlOiAnc3BhbicgfCAnbWV0cmljJyB8ICdhdWRpdCcgfCAnbG9nJyk6IE9ic2VydmFiaWxpdHlMZXZlbCB7XG4gIGNvbnN0IHR5cGVDb25maWcgPSBjb25maWc/LnR5cGVzPy5bIHR5cGUgXTtcbiAgcmV0dXJuIHR5cGVDb25maWc/Lm1pbkxldmVsID8/IGNvbmZpZz8ubWluTGV2ZWwgPz8gT2JzZXJ2YWJpbGl0eUxldmVsLklORk87XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYW4gZXZlbnQgbWF0Y2hlcyBhIHNhbXBsaW5nIHJ1bGVcbiAqL1xuZnVuY3Rpb24gbWF0Y2hlc1J1bGUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgcnVsZTogU2FtcGxpbmdSdWxlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgdGFyZ2V0LCBwYXR0ZXJuIH0gPSBydWxlO1xuXG4gIGxldCB2YWx1ZVRvTWF0Y2g6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBzd2l0Y2ggKHRhcmdldCkge1xuICAgIGNhc2UgJ3RlbmFudCc6XG4gICAgICAvLyBDaGVjayBhY3Rvci50ZW5hbnRJZCBvciB0YWdzLnRlbmFudElkXG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5hY3Rvcj8udGVuYW50SWQgPz8gZXZlbnQudGFncz8udGVuYW50SWQ7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3JvdXRlJzpcbiAgICAgIC8vIENoZWNrIHNvdXJjZSAoZS5nLiwgXCJPcmRlckNvbnRyb2xsZXIuY3JlYXRlXCIpIG9yIG9wZXJhdGlvblxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuc291cmNlID8/IGV2ZW50Lm9wZXJhdGlvbjtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAndGFnJzpcbiAgICAgIC8vIFBhdHRlcm4gZm9ybWF0OiBcImtleTp2YWx1ZVwiIG9yIFwia2V5OipcIlxuICAgICAgaWYgKHR5cGVvZiBwYXR0ZXJuID09PSAnc3RyaW5nJyAmJiBwYXR0ZXJuLmluY2x1ZGVzKCc6JykpIHtcbiAgICAgICAgY29uc3QgWyBrZXksIHZhbHVlUGF0dGVybiBdID0gcGF0dGVybi5zcGxpdCgnOicsIDIpO1xuICAgICAgICBjb25zdCB0YWdWYWx1ZSA9IGV2ZW50LnRhZ3M/Llsga2V5IF07XG4gICAgICAgIGlmICghdGFnVmFsdWUpIHJldHVybiBmYWxzZTtcblxuICAgICAgICBpZiAodmFsdWVQYXR0ZXJuID09PSAnKicpIHJldHVybiB0cnVlO1xuXG4gICAgICAgIC8vIFRlc3QgYWdhaW5zdCB2YWx1ZSBwYXR0ZXJuIChzdXBwb3J0cyB3aWxkY2FyZHMpXG4gICAgICAgIGNvbnN0IHJlZ2V4ID0gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHZhbHVlUGF0dGVybik7XG4gICAgICAgIHJldHVybiByZWdleC50ZXN0KHRhZ1ZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcblxuICAgIGNhc2UgJ2FjdG9yJzpcbiAgICAgIC8vIENoZWNrIGFjdG9ySWQgb3IgYWN0b3JUeXBlXG4gICAgICB2YWx1ZVRvTWF0Y2ggPSBldmVudC5hY3Rvcj8uYWN0b3JJZCA/PyBldmVudC5hY3Rvcj8uYWN0b3JUeXBlO1xuICAgICAgYnJlYWs7XG5cbiAgICBjYXNlICdzb3VyY2UnOlxuICAgICAgdmFsdWVUb01hdGNoID0gZXZlbnQuc291cmNlO1xuICAgICAgYnJlYWs7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgaWYgKCF2YWx1ZVRvTWF0Y2gpIHJldHVybiBmYWxzZTtcblxuICAvLyBNYXRjaCBhZ2FpbnN0IHBhdHRlcm4gKHN0cmluZyBvciBSZWdFeHApXG4gIGlmIChwYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgcmV0dXJuIHBhdHRlcm4udGVzdCh2YWx1ZVRvTWF0Y2gpO1xuICB9XG5cbiAgLy8gU3RyaW5nIHBhdHRlcm4gd2l0aCB3aWxkY2FyZCBzdXBwb3J0XG4gIGNvbnN0IHJlZ2V4ID0gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm4pO1xuICByZXR1cm4gcmVnZXgudGVzdCh2YWx1ZVRvTWF0Y2gpO1xufVxuXG5mdW5jdGlvbiBzaG91bGRDYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IGJvb2xlYW4ge1xuICBjb25zdCBsZXZlbFZhbHVlID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgZWZmZWN0aXZlTGV2ZWwgPSBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZUNhdGVnb3J5KTtcblxuICAvLyBDaGVjayBtaW5pbXVtIGxldmVsIGZpcnN0XG4gIGlmIChsZXZlbFZhbHVlIDwgZWZmZWN0aXZlTGV2ZWwpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBDUklUSUNBTCBhbHdheXMgY2FwdHVyZWRcbiAgaWYgKGxldmVsVmFsdWUgPT09IE9ic2VydmFiaWxpdHlMZXZlbC5DUklUSUNBTCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gSWYgc2FtcGxpbmcgZGlzYWJsZWQsIGNhcHR1cmUgZXZlcnl0aGluZ1xuICBpZiAoIWNmZy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gPT09IFJVTEUtQkFTRUQgU0FNUExJTkcgKEhpZ2hlc3QgUHJpb3JpdHkpID09PVxuICAvLyBSdWxlcyBhcmUgZXZhbHVhdGVkIGluIG9yZGVyLiBGaXJzdCBtYXRjaCB3aW5zLlxuICBpZiAoY2ZnLnNhbXBsaW5nLnJ1bGVzICYmIGNmZy5zYW1wbGluZy5ydWxlcy5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBydWxlIG9mIGNmZy5zYW1wbGluZy5ydWxlcykge1xuICAgICAgaWYgKG1hdGNoZXNSdWxlKGV2ZW50LCBydWxlKSkge1xuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJ1bGUucmF0ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyA9PT0gVFlQRS1TUEVDSUZJQyBTQU1QTElORyA9PT1cbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNmZy50eXBlcz8uWyB0eXBlQ2F0ZWdvcnkgXTtcbiAgaWYgKHR5cGVDb25maWc/LnNhbXBsaW5nPy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCB0eXBlQ29uZmlnLnNhbXBsaW5nLnJhdGU7XG4gIH1cblxuICAvLyA9PT0gT1BFUkFUSU9OLUJBU0VEIFNBTVBMSU5HID09PVxuICBpZiAoZXZlbnQub3BlcmF0aW9uICYmIGNmZy5zYW1wbGluZy5vcGVyYXRpb25zKSB7XG4gICAgZm9yIChjb25zdCBbIHBhdHRlcm4sIHJhdGUgXSBvZiBPYmplY3QuZW50cmllcyhjZmcuc2FtcGxpbmcub3BlcmF0aW9ucykpIHtcbiAgICAgIGNvbnN0IHJlZ2V4ID0gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm4pO1xuICAgICAgaWYgKHJlZ2V4LnRlc3QoZXZlbnQub3BlcmF0aW9uKSkge1xuICAgICAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gPT09IExFVkVMLUJBU0VEIFNBTVBMSU5HIChGYWxsYmFjaykgPT09XG4gIGNvbnN0IGxldmVsTmFtZSA9IGxldmVsVG9TdHJpbmcobGV2ZWxWYWx1ZSk7XG4gIGNvbnN0IHJhdGUgPSBjZmcuc2FtcGxpbmcucmF0ZXM/LlsgbGV2ZWxOYW1lIF07XG4gIGlmIChyYXRlID09PSB1bmRlZmluZWQgfHwgcmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJhdGUgPD0gMCkgcmV0dXJuIGZhbHNlO1xuXG4gIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbn1cblxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm46IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGNvbnN0IE1BWF9SRUdFWF9DQUNIRV9TSVpFID0gMTAwO1xuXG4gIGxldCByZWdleCA9IHNhbXBsaW5nUmVnZXhDYWNoZS5nZXQocGF0dGVybik7XG4gIGlmICghcmVnZXgpIHtcbiAgICAvLyBFdmljdCBvbGRlc3QgZW50cnkgaWYgY2FjaGUgaXMgZnVsbCAoRklGTyBldmljdGlvbilcbiAgICBpZiAoc2FtcGxpbmdSZWdleENhY2hlLnNpemUgPj0gTUFYX1JFR0VYX0NBQ0hFX1NJWkUpIHtcbiAgICAgIGNvbnN0IGZpcnN0S2V5ID0gc2FtcGxpbmdSZWdleENhY2hlLmtleXMoKS5uZXh0KCkudmFsdWU7XG4gICAgICBpZiAoZmlyc3RLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuZGVsZXRlKGZpcnN0S2V5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvXFwqL2csICcuKicpfSRgKTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuc2V0KHBhdHRlcm4sIHJlZ2V4KTtcbiAgfVxuICByZXR1cm4gcmVnZXg7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIHByaW9yaXR5IGZvciBidWZmZXIgZXZpY3Rpb24uXG4gKiBIaWdoZXIgcHJpb3JpdHkgPSBrZWVwIGluIGJ1ZmZlclxuICovXG5mdW5jdGlvbiBnZXRFdmVudFByaW9yaXR5KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBudW1iZXIge1xuICAvLyBDUklUSUNBTCBldmVudHMgTkVWRVIgZ2V0IGV2aWN0ZWQgKG1heCBwcmlvcml0eSlcbiAgaWYgKGV2ZW50LmNyaXRpY2FsKSB7XG4gICAgcmV0dXJuIEluZmluaXR5O1xuICB9XG5cbiAgbGV0IHByaW9yaXR5ID0gMDtcblxuICBjb25zdCBsZXZlbCA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gIC8vIEhpZ2hlciBsb2cgbGV2ZWxzID0gaGlnaGVyIHByaW9yaXR5XG4gIHByaW9yaXR5ICs9IGxldmVsICogMTA7XG5cbiAgLy8gQXVkaXQgZXZlbnRzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ2F1ZGl0JykpIHtcbiAgICBwcmlvcml0eSArPSA1MDtcbiAgfVxuXG4gIC8vIFNwYW5zIHdpdGggZXJyb3JzIGFyZSBoaWdoIHByaW9yaXR5XG4gIGlmIChldmVudC50eXBlLnN0YXJ0c1dpdGgoJ3NwYW4nKSAmJiBldmVudC5zdWNjZXNzID09PSBmYWxzZSkge1xuICAgIHByaW9yaXR5ICs9IDMwO1xuICB9XG5cbiAgLy8gTG9uZyBkdXJhdGlvbiBvcGVyYXRpb25zIGFyZSBpbnRlcmVzdGluZ1xuICBpZiAoZXZlbnQuZHVyYXRpb25NcyAmJiBldmVudC5kdXJhdGlvbk1zID4gMTAwMCkge1xuICAgIHByaW9yaXR5ICs9IDIwO1xuICB9XG5cbiAgcmV0dXJuIHByaW9yaXR5O1xufVxuXG4vKipcbiAqIEV2aWN0IGxvd2VzdCBwcmlvcml0eSBldmVudCBmcm9tIGJ1ZmZlclxuICogUmV0dXJucyBtZXRhZGF0YSBhYm91dCB0aGUgZXZpY3RlZCBldmVudCBmb3IgbG9nZ2luZ1xuICovXG5mdW5jdGlvbiBldmljdExvd2VzdFByaW9yaXR5KGJ1ZmZlcjogT2JzZXJ2YWJpbGl0eUV2ZW50W10pOiB7IHR5cGU6IHN0cmluZzsgY29ycmVsYXRpb25JZDogc3RyaW5nOyBvcGVyYXRpb24/OiBzdHJpbmc7IGxldmVsOiBzdHJpbmcgfSB8IG51bGwge1xuICBpZiAoYnVmZmVyLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRmluZCBsb3dlc3QgcHJpb3JpdHkgZXZlbnRcbiAgbGV0IGxvd2VzdFByaW9yaXR5ID0gSW5maW5pdHk7XG4gIGxldCBsb3dlc3RJbmRleCA9IDA7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBidWZmZXIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBwcmlvcml0eSA9IGdldEV2ZW50UHJpb3JpdHkoYnVmZmVyWyBpIF0pO1xuICAgIGlmIChwcmlvcml0eSA8IGxvd2VzdFByaW9yaXR5KSB7XG4gICAgICBsb3dlc3RQcmlvcml0eSA9IHByaW9yaXR5O1xuICAgICAgbG93ZXN0SW5kZXggPSBpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSBhbmQgcmV0dXJuIGluZm8gYWJvdXQgZXZpY3RlZCBldmVudFxuICBjb25zdCBldmljdGVkID0gYnVmZmVyLnNwbGljZShsb3dlc3RJbmRleCwgMSlbIDAgXTtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiBldmljdGVkLnR5cGUsXG4gICAgY29ycmVsYXRpb25JZDogZXZpY3RlZC5jb3JyZWxhdGlvbklkLFxuICAgIG9wZXJhdGlvbjogZXZpY3RlZC5vcGVyYXRpb24sXG4gICAgbGV2ZWw6IGV2aWN0ZWQubGV2ZWwsXG4gIH07XG59XG5cbi8qKlxuICogSGFuZGxlIHRhaWwtYmFzZWQgc2FtcGxpbmcgbG9naWMgZm9yIGFuIGV2ZW50IChzeW5jIHZlcnNpb24pXG4gKiBSZXR1cm5zOiAnY2FwdHVyZWQnIGlmIGV2ZW50IHdhcyBjYXB0dXJlZCwgJ2J1ZmZlcmVkJyBpZiBidWZmZXJlZCwgJ3NraXAnIGlmIG5vdCB1c2luZyB0YWlsLWJhc2VkXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nU3luYyhcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+XG4pOiAnY2FwdHVyZWQnIHwgJ2J1ZmZlcmVkJyB8ICdza2lwJyB7XG4gIGlmICghY29uZmlnPy5zYW1wbGluZz8uc21hcnQgfHwgIWNvbnRleHQpIHtcbiAgICByZXR1cm4gJ3NraXAnO1xuICB9XG5cbiAgY29uc3QgaXNFcnJvciA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpID49IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUjtcblxuICAvLyBFUlJPUiBQQVRIOiBGbHVzaCBidWZmZXIgKyBjYXB0dXJlIGVycm9yICsgc2V0IGZsYWdcbiAgaWYgKGlzRXJyb3IpIHtcbiAgICBpZiAoY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyPy5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IGJ1ZmZlciA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciBhcyBPYnNlcnZhYmlsaXR5RXZlbnRbXTtcbiAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5IHx8IHsgZXZpY3RlZDogMCwgYnVmZmVyZWQ6IDAsIGNhcHR1cmVkOiAwIH07XG4gICAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgPSBbXTtcblxuICAgICAgLy8gQXBwbHkgbGV2ZWwgZmlsdGVyaW5nIHRvIGF2b2lkIG92ZXJ3aGVsbWluZyBiYWNrZW5kcyB3aXRoIHRob3VzYW5kcyBvZiBkZWJ1Zy90cmFjZSBldmVudHNcbiAgICAgIC8vIE9uIGVycm9yLCBjYXB0dXJlIElORk8rIGV2ZW50cywgZHJvcCBUUkFDRS9ERUJVRyB0byBwcmV2ZW50IGNvc3Qgc3Bpa2VzXG4gICAgICBjb25zdCBtaW5MZXZlbE9uRXJyb3IgPSBjb25maWcuc2FtcGxpbmc/Lm1pbkxldmVsT25FcnJvciA/PyBPYnNlcnZhYmlsaXR5TGV2ZWwuSU5GTztcbiAgICAgIGxldCBkcm9wcGVkID0gMDtcblxuICAgICAgZm9yIChjb25zdCBidWZmZXJlZEV2ZW50IG9mIGJ1ZmZlcikge1xuICAgICAgICBjb25zdCBldmVudExldmVsID0gc3RyaW5nVG9MZXZlbChidWZmZXJlZEV2ZW50LmxldmVsKTtcbiAgICAgICAgaWYgKGV2ZW50TGV2ZWwgPj0gbWluTGV2ZWxPbkVycm9yKSB7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICAgIGRpc3BhdGNoVG9CYWNrZW5kcyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkcm9wcGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGRyb3BwZWQgPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgRHJvcHBlZCAke2Ryb3BwZWR9IGxvdy1sZXZlbCBldmVudHMgZnJvbSBlcnJvciBidWZmZXIgZmx1c2hgLCB7XG4gICAgICAgICAgbWluTGV2ZWw6IGxldmVsVG9TdHJpbmcobWluTGV2ZWxPbkVycm9yKSxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnRleHQuZXJyb3JPY2N1cnJlZCA9IHRydWU7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG5cbiAgICAvLyBUcmFjayBjYXB0dXJlZCBjb3VudFxuICAgIGlmICghY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSkge1xuICAgICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSA9IHsgZXZpY3RlZDogMCwgYnVmZmVyZWQ6IDAsIGNhcHR1cmVkOiAwIH07XG4gICAgfVxuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuY2FwdHVyZWQgPSAoY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5jYXB0dXJlZCB8fCAwKSArIDE7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIFBPU1QtRVJST1IgUEFUSDogQ2FwdHVyZSBpbW1lZGlhdGVseVxuICBpZiAoY29udGV4dC5lcnJvck9jY3VycmVkKSB7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG5cbiAgICAvLyBUcmFjayBjYXB0dXJlZCBjb3VudFxuICAgIGlmICghY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSkge1xuICAgICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSA9IHsgZXZpY3RlZDogMCwgYnVmZmVyZWQ6IDAsIGNhcHR1cmVkOiAwIH07XG4gICAgfVxuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuY2FwdHVyZWQgPSAoY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5jYXB0dXJlZCB8fCAwKSArIDE7XG5cbiAgICByZXR1cm4gJ2NhcHR1cmVkJztcbiAgfVxuXG4gIC8vIE5PUk1BTCBQQVRIOiBCdWZmZXIgZXZlcnl0aGluZ1xuICBpZiAoIWNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlcikgY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyID0gW107XG4gIGNvbnN0IGJ1ZmZlciA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciBhcyBPYnNlcnZhYmlsaXR5RXZlbnRbXTtcblxuICAvLyBJbml0aWFsaXplIHN1bW1hcnkgaWYgbmVlZGVkXG4gIGlmICghY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSkge1xuICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICB9XG5cbiAgLy8gQnVmZmVyIHNpemUgbWFuYWdlbWVudDogZXZpY3QgbG93ZXN0IHByaW9yaXR5IGlmIGZ1bGxcbiAgY29uc3QgbWF4U2l6ZSA9IGNvbmZpZy5zYW1wbGluZy5tYXhCdWZmZXJTaXplID8/IDEwMDA7XG4gIGlmIChidWZmZXIubGVuZ3RoID49IG1heFNpemUpIHtcbiAgICBjb25zdCBldmljdGVkSW5mbyA9IGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyKTtcbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQgPSAoY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkIHx8IDApICsgMTtcblxuICAgIC8vIExvZyB3YXJuaW5nIHdpdGggZXZpY3RlZCBldmVudCBkZXRhaWxzXG4gICAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuZXZpY3RlZCA9PT0gMSB8fCBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQgJSAxMDAgPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBmdWxsLCBldmljdGluZyBsb3dlc3QgcHJpb3JpdHkgZXZlbnRzJywge1xuICAgICAgICBldmljdGVkOiBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgIGJ1ZmZlclNpemU6IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZCxcbiAgICAgICAgZXZpY3RlZEV2ZW50OiBldmljdGVkSW5mbyxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoZXZpY3RlZEluZm8pIHtcbiAgICAgIC8vIExvZyBlYWNoIGV2aWN0aW9uIGF0IGRlYnVnIGxldmVsIGZvciB0cm91Ymxlc2hvb3RpbmdcbiAgICAgIGxvZ2dlci5kZWJ1ZygnRXZpY3RlZCBvYnNlcnZhYmlsaXR5IGV2ZW50IGZyb20gYnVmZmVyJywge1xuICAgICAgICAuLi5ldmljdGVkSW5mbyxcbiAgICAgICAgdG90YWxFdmljdGVkOiBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBidWZmZXIucHVzaChldmVudCk7XG4gIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuYnVmZmVyZWQgPSAoY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5idWZmZXJlZCB8fCAwKSArIDE7XG4gIHJldHVybiAnYnVmZmVyZWQnO1xufVxuXG4vKipcbiAqIEhhbmRsZSB0YWlsLWJhc2VkIHNhbXBsaW5nIGxvZ2ljIGZvciBhbiBldmVudCAoYXN5bmMgdmVyc2lvbilcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVGFpbEJhc2VkU2FtcGxpbmdBc3luYyhcbiAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgY29udGV4dDogUmV0dXJuVHlwZTx0eXBlb2YgZ2V0Q3VycmVudENvbnRleHQ+XG4pOiBQcm9taXNlPCdjYXB0dXJlZCcgfCAnYnVmZmVyZWQnIHwgJ3NraXAnPiB7XG4gIGlmICghY29uZmlnPy5zYW1wbGluZz8uc21hcnQgfHwgIWNvbnRleHQpIHtcbiAgICByZXR1cm4gJ3NraXAnO1xuICB9XG5cbiAgY29uc3QgaXNFcnJvciA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpID49IE9ic2VydmFiaWxpdHlMZXZlbC5FUlJPUjtcblxuICAvLyBFUlJPUiBQQVRIOiBGbHVzaCBidWZmZXIgKyBjYXB0dXJlIGVycm9yICsgc2V0IGZsYWdcbiAgaWYgKGlzRXJyb3IpIHtcbiAgICBpZiAoY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyPy5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IGJ1ZmZlciA9IGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciBhcyBPYnNlcnZhYmlsaXR5RXZlbnRbXTtcbiAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5IHx8IHsgZXZpY3RlZDogMCwgYnVmZmVyZWQ6IDAsIGNhcHR1cmVkOiAwIH07XG4gICAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgPSBbXTtcblxuICAgICAgLy8gQXBwbHkgbGV2ZWwgZmlsdGVyaW5nIHRvIGF2b2lkIG92ZXJ3aGVsbWluZyBiYWNrZW5kc1xuICAgICAgY29uc3QgbWluTGV2ZWxPbkVycm9yID0gY29uZmlnLnNhbXBsaW5nPy5taW5MZXZlbE9uRXJyb3IgPz8gT2JzZXJ2YWJpbGl0eUxldmVsLklORk87XG4gICAgICBsZXQgZHJvcHBlZCA9IDA7XG5cbiAgICAgIGNvbnN0IGZpbHRlcmVkRXZlbnRzID0gYnVmZmVyLmZpbHRlcihidWZmZXJlZEV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgZXZlbnRMZXZlbCA9IHN0cmluZ1RvTGV2ZWwoYnVmZmVyZWRFdmVudC5sZXZlbCk7XG4gICAgICAgIGlmIChldmVudExldmVsID49IG1pbkxldmVsT25FcnJvcikge1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGRyb3BwZWQrKztcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG5cbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKGZpbHRlcmVkRXZlbnRzLm1hcChidWZmZXJlZEV2ZW50ID0+IHtcbiAgICAgICAgY29uc3QgdGFyZ2V0cyA9IGdldEJhY2tlbmRzRm9yVHlwZShidWZmZXJlZEV2ZW50LnR5cGUpO1xuICAgICAgICByZXR1cm4gZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhidWZmZXJlZEV2ZW50LCB0YXJnZXRzKTtcbiAgICAgIH0pKTtcblxuICAgICAgaWYgKGRyb3BwZWQgPiAwKSB7XG4gICAgICAgIGxvZ2dlci5kZWJ1ZyhgRHJvcHBlZCAke2Ryb3BwZWR9IGxvdy1sZXZlbCBldmVudHMgZnJvbSBlcnJvciBidWZmZXIgZmx1c2hgLCB7XG4gICAgICAgICAgbWluTGV2ZWw6IGxldmVsVG9TdHJpbmcobWluTGV2ZWxPbkVycm9yKSxcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBjb250ZXh0LmNvcnJlbGF0aW9uSWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnRleHQuZXJyb3JPY2N1cnJlZCA9IHRydWU7XG4gICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuXG4gICAgLy8gVHJhY2sgY2FwdHVyZWQgY291bnRcbiAgICBpZiAoIWNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkpIHtcbiAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkgPSB7IGV2aWN0ZWQ6IDAsIGJ1ZmZlcmVkOiAwLCBjYXB0dXJlZDogMCB9O1xuICAgIH1cbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmNhcHR1cmVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuY2FwdHVyZWQgfHwgMCkgKyAxO1xuXG4gICAgcmV0dXJuICdjYXB0dXJlZCc7XG4gIH1cblxuICAvLyBQT1NULUVSUk9SIFBBVEg6IENhcHR1cmUgaW1tZWRpYXRlbHlcbiAgaWYgKGNvbnRleHQuZXJyb3JPY2N1cnJlZCkge1xuICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcblxuICAgIC8vIFRyYWNrIGNhcHR1cmVkIGNvdW50XG4gICAgaWYgKCFjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5KSB7XG4gICAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5ID0geyBldmljdGVkOiAwLCBidWZmZXJlZDogMCwgY2FwdHVyZWQ6IDAgfTtcbiAgICB9XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5jYXB0dXJlZCA9IChjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmNhcHR1cmVkIHx8IDApICsgMTtcblxuICAgIHJldHVybiAnY2FwdHVyZWQnO1xuICB9XG5cbiAgLy8gTk9STUFMIFBBVEg6IEJ1ZmZlciBldmVyeXRoaW5nXG4gIGlmICghY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyKSBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgPSBbXTtcbiAgY29uc3QgYnVmZmVyID0gY29udGV4dC5vYnNlcnZhYmlsaXR5QnVmZmVyIGFzIE9ic2VydmFiaWxpdHlFdmVudFtdO1xuXG4gIC8vIEluaXRpYWxpemUgc3VtbWFyeSBpZiBuZWVkZWRcbiAgaWYgKCFjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5KSB7XG4gICAgY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeSA9IHsgZXZpY3RlZDogMCwgYnVmZmVyZWQ6IDAsIGNhcHR1cmVkOiAwIH07XG4gIH1cblxuICAvLyBCdWZmZXIgc2l6ZSBtYW5hZ2VtZW50OiBldmljdCBsb3dlc3QgcHJpb3JpdHkgaWYgZnVsbFxuICBjb25zdCBtYXhTaXplID0gY29uZmlnLnNhbXBsaW5nLm1heEJ1ZmZlclNpemUgPz8gMTAwMDtcbiAgaWYgKGJ1ZmZlci5sZW5ndGggPj0gbWF4U2l6ZSkge1xuICAgIGV2aWN0TG93ZXN0UHJpb3JpdHkoYnVmZmVyKTtcbiAgICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQgPSAoY29udGV4dC5vYnNlcnZhYmlsaXR5U3VtbWFyeS5ldmljdGVkIHx8IDApICsgMTtcblxuICAgIC8vIExvZyB3YXJuaW5nIGlmIGV2aWN0aW5nIGEgbG90XG4gICAgaWYgKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuZXZpY3RlZCA9PT0gMSB8fCBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQgJSAxMDAgPT09IDApIHtcbiAgICAgIGxvZ2dlci53YXJuKCdPYnNlcnZhYmlsaXR5IGJ1ZmZlciBmdWxsLCBldmljdGluZyBsb3dlc3QgcHJpb3JpdHkgZXZlbnRzJywge1xuICAgICAgICBldmljdGVkOiBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmV2aWN0ZWQsXG4gICAgICAgIGJ1ZmZlclNpemU6IGJ1ZmZlci5sZW5ndGgsXG4gICAgICAgIGNvcnJlbGF0aW9uSWQ6IGNvbnRleHQuY29ycmVsYXRpb25JZFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYnVmZmVyLnB1c2goZXZlbnQpO1xuICBjb250ZXh0Lm9ic2VydmFiaWxpdHlTdW1tYXJ5LmJ1ZmZlcmVkID0gKGNvbnRleHQub2JzZXJ2YWJpbGl0eVN1bW1hcnkuYnVmZmVyZWQgfHwgMCkgKyAxO1xuICByZXR1cm4gJ2J1ZmZlcmVkJztcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplIHNvdXJjZS1tYXAtc3VwcG9ydCBpZiBlbmFibGVkIGluIGNvbmZpZ1xuICogUHJvdmlkZXMgYmV0dGVyIHN0YWNrIHRyYWNlcyBmb3IgVHlwZVNjcmlwdC90cmFuc3BpbGVkIGNvZGUgaW4gcHJvZHVjdGlvblxuICovXG5mdW5jdGlvbiBpbml0aWFsaXplU291cmNlTWFwU3VwcG9ydChjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgaWYgKCFjZmcuc291cmNlTWFwPy5lbmFibGVkKSB7XG4gICAgbG9nZ2VyLmRlYnVnKCdTb3VyY2UgbWFwIHN1cHBvcnQgZGlzYWJsZWQgaW4gY29uZmlnJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBsb2dnZXIuZGVidWcoJ0F0dGVtcHRpbmcgdG8gbG9hZCBzb3VyY2UtbWFwLXN1cHBvcnQuLi4nKTtcbiAgICAvLyBEeW5hbWljIGltcG9ydCB0byBhdm9pZCBidW5kbGluZyBpZiBub3QgbmVlZGVkXG4gICAgcmVxdWlyZSgnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJyk7XG4gICAgbG9nZ2VyLmluZm8oJ1NvdXJjZSBtYXAgc3VwcG9ydCBlbmFibGVkIC0gc3RhY2sgdHJhY2VzIHdpbGwgc2hvdyBvcmlnaW5hbCBUeXBlU2NyaXB0IGxpbmVzJyk7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAvLyBOb3QgYSBjcml0aWNhbCBlcnJvciAtIG9ic2VydmFiaWxpdHkgc3RpbGwgd29ya3Mgd2l0aG91dCBzb3VyY2UgbWFwc1xuICAgIGlmIChlcnJvci5jb2RlID09PSAnTU9EVUxFX05PVF9GT1VORCcpIHtcbiAgICAgIGxvZ2dlci53YXJuKFxuICAgICAgICAnc291cmNlLW1hcC1zdXBwb3J0IHBhY2thZ2Ugbm90IGZvdW5kLiBJbnN0YWxsIGl0IGZvciBiZXR0ZXIgZXJyb3Igc3RhY2sgdHJhY2VzOiBucG0gaW5zdGFsbCBzb3VyY2UtbWFwLXN1cHBvcnQnXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnZXIud2FybignRmFpbGVkIHRvIGxvYWQgc291cmNlLW1hcC1zdXBwb3J0OicsIGVycm9yLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEluaXRpYWxpemUgYmFja2VuZHMgZnJvbSBESSBiYXNlZCBvbiBjb25maWdcbiAqL1xuZnVuY3Rpb24gaW5pdGlhbGl6ZUJhY2tlbmRzRnJvbUNvbmZpZyhjZmc6IE9ic2VydmFiaWxpdHlDb25maWcpOiB2b2lkIHtcbiAgYmFja2VuZHMgPSBbXTtcbiAgYmFja2VuZENvbmZpZ3MuY2xlYXIoKTtcbiAgY29uc3QgZW5hYmxlZEJhY2tlbmRzID0gY2ZnLmJhY2tlbmRzPy5maWx0ZXIoYiA9PiBiLmVuYWJsZWQgIT09IGZhbHNlKSA/PyBbXTtcbiAgY29uc3QgZW5hYmxlZFR5cGVzID0gZW5hYmxlZEJhY2tlbmRzLm1hcChiID0+IGIudHlwZSk7XG5cbiAgZm9yIChjb25zdCBiYWNrZW5kQ2ZnIG9mIGVuYWJsZWRCYWNrZW5kcykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBiYWNrZW5kID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlPE9ic2VydmFiaWxpdHlCYWNrZW5kPihcbiAgICAgICAgJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgICAgICAgeyB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCBiYWNrZW5kQ2ZnLnR5cGUgXSB9XG4gICAgICApO1xuICAgICAgYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgICAgIGJhY2tlbmRDb25maWdzLnNldChiYWNrZW5kLm5hbWUsIGJhY2tlbmRDZmcpO1xuICAgICAgbG9nZ2VyLmRlYnVnKGBJbml0aWFsaXplZCBiYWNrZW5kOiAke2JhY2tlbmQubmFtZX1gKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgTm9Qcm92aWRlckZvdW5kRXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJyR7YmFja2VuZENmZy50eXBlfScgbm90IGZvdW5kIGluIERJLCBza2lwcGluZ2ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBiYWNrZW5kICcke2JhY2tlbmRDZmcudHlwZX0nOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBGYWxsYmFjayB0byBDbG91ZFdhdGNoIGlmIG5vIGJhY2tlbmRzIGVuYWJsZWRcbiAgaWYgKGJhY2tlbmRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGxvZ2dlci53YXJuKCdObyBiYWNrZW5kcyBlbmFibGVkLCBhdHRlbXB0aW5nIENsb3VkV2F0Y2ggZmFsbGJhY2snKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYmFja2VuZCA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZTxPYnNlcnZhYmlsaXR5QmFja2VuZD4oXG4gICAgICAgICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gICAgICAgIHsgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ2Nsb3Vkd2F0Y2gnIF0gfVxuICAgICAgKTtcbiAgICAgIGJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gICAgICAvLyBDcmVhdGUgZGVmYXVsdCBjb25maWcgZm9yIGZhbGxiYWNrXG4gICAgICBiYWNrZW5kQ29uZmlncy5zZXQoYmFja2VuZC5uYW1lLCB7IHR5cGU6ICdjbG91ZHdhdGNoJywgZW5hYmxlZDogdHJ1ZSB9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcmVzb2x2ZSBmYWxsYmFjayBDbG91ZFdhdGNoIGJhY2tlbmQ6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBkb0luaXRpYWxpemUoKTogdm9pZCB7XG4gIHRyeSB7XG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gT0JTRVJWQUJJTElUWSBJTklUSUFMSVpBVElPTiBTVEFSVCA9PT0nKTtcblxuICAgIC8vIFJ1biBwcmUtaW5pdGlhbGl6YXRpb24gaG9va3MgKGUuZy4sIHNjaGVtYSByZWdpc3RyYXRpb24pXG4gICAgaWYgKHByZUluaXRIb29rcy5sZW5ndGggPiAwKSB7XG4gICAgICBsb2dnZXIuZGVidWcoYFJ1bm5pbmcgJHtwcmVJbml0SG9va3MubGVuZ3RofSBwcmUtaW5pdGlhbGl6YXRpb24gaG9vayhzKS4uLmApO1xuICAgICAgZm9yIChjb25zdCBob29rIG9mIHByZUluaXRIb29rcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGhvb2soKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoJ1ByZS1pbml0aWFsaXphdGlvbiBob29rIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxvZ2dlci5kZWJ1ZygnUHJlLWluaXRpYWxpemF0aW9uIGhvb2tzIGNvbXBsZXRlZCcpO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgY29uZmlnIGZyb20gREkgKGRlZmF1bHRzIHJlZ2lzdGVyZWQgaW4gaW5kZXgudHMgZ3VhcmFudGVlIGFsbCByZXF1aXJlZCBmaWVsZHMpXG4gICAgY29uZmlnID0gRElDb250YWluZXIuUk9PVC5yZXNvbHZlQ29uZmlnPE9ic2VydmFiaWxpdHlDb25maWc+KCdvYnNlcnZhYmlsaXR5JykgYXMgT2JzZXJ2YWJpbGl0eUNvbmZpZztcbiAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgY29uZmlnIGxvYWRlZCBmcm9tIERJJywge1xuICAgICAgZW5hYmxlZDogY29uZmlnLmVuYWJsZWQsXG4gICAgICBzZXJ2aWNlTmFtZTogY29uZmlnLnNlcnZpY2VOYW1lLFxuICAgICAgYmFja2VuZHM6IGNvbmZpZy5iYWNrZW5kcz8ubWFwKGIgPT4gYi50eXBlKSxcbiAgICAgIHNhbXBsaW5nOiB7IGVuYWJsZWQ6IGNvbmZpZy5zYW1wbGluZz8uZW5hYmxlZCwgc21hcnQ6IGNvbmZpZy5zYW1wbGluZz8uc21hcnQgfSxcbiAgICAgIHNvdXJjZU1hcDogY29uZmlnLnNvdXJjZU1hcD8uZW5hYmxlZCxcbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgc291cmNlLW1hcC1zdXBwb3J0IGZvciBiZXR0ZXIgc3RhY2sgdHJhY2VzIChpZiBlbmFibGVkKVxuICAgIGluaXRpYWxpemVTb3VyY2VNYXBTdXBwb3J0KGNvbmZpZyk7XG5cbiAgICAvLyBJbml0aWFsaXplIGJhY2tlbmRzIGZyb20gRElcbiAgICBpbml0aWFsaXplQmFja2VuZHNGcm9tQ29uZmlnKGNvbmZpZyEpO1xuXG4gICAgLy8gUmVnaXN0ZXIgY2FwdHVyZXIgZm9yIG9ic2VydmVyc1xuICAgIGluaXRpYWxpemVDYXB0dXJlcih7XG4gICAgICBjYXB0dXJlOiAoaW5wdXQsIG9wdGlvbnMpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmUoaW5wdXQsIG9wdGlvbnMpLFxuICAgICAgY2FwdHVyZUFzeW5jOiAoaW5wdXQsIG9wdGlvbnMpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmVBc3luYyhpbnB1dCwgb3B0aW9ucyksXG4gICAgfSk7XG5cbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG4gICAgbG9nZ2VyLmluZm8oJz09PSBPQlNFUlZBQklMSVRZIElOSVRJQUxJWkFUSU9OIENPTVBMRVRFID09PScpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGxvZ2dlci5lcnJvcignISEhIE9CU0VSVkFCSUxJVFkgSU5JVElBTElaQVRJT04gRkFJTEVEICEhIScsIGVycm9yKTtcbiAgICAvLyBTZXQgaW5pdGlhbGl6ZWQgPSB0cnVlIGFueXdheSB0byBwcmV2ZW50IHJlcGVhdGVkIGluaXQgYXR0ZW1wdHNcbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG4gICAgLy8gUmUtdGhyb3cgc28gd2Uga25vdyBzb21ldGhpbmcgaXMgYnJva2VuXG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQVUJMSUMgQVBJIC0gT2JzZXJ2YWJpbGl0eU1hbmFnZXJcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eU1hbmFnZXIge1xuXG4gIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmb3IgYSBuZXcgTGFtYmRhIGludm9jYXRpb25cbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCkgY2FsbGVkJywgeyBpbml0aWFsaXplZCwgaW52b2NhdGlvbkNvdW50IH0pO1xuXG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdOb3QgaW5pdGlhbGl6ZWQgeWV0LCBjYWxsaW5nIGRvSW5pdGlhbGl6ZSgpLi4uJyk7XG4gICAgICBkb0luaXRpYWxpemUoKTtcbiAgICB9XG5cbiAgICBpbnZvY2F0aW9uQ291bnQrKztcbiAgICBsb2dnZXIuZGVidWcoYEludm9jYXRpb24gJHtpbnZvY2F0aW9uQ291bnR9IHN0YXJ0aW5nLCBpbml0aWFsaXppbmcgJHtiYWNrZW5kcy5sZW5ndGh9IGJhY2tlbmQocylgKTtcblxuICAgIGZvciAoY29uc3QgYmFja2VuZCBvZiBiYWNrZW5kcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYmFja2VuZC5pbml0aWFsaXplSW52b2NhdGlvbj8uKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGZhaWxlZCB0byBpbml0aWFsaXplIGludm9jYXRpb246YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHN0YXRpYyBpc0luaXRpYWxpemVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpbml0aWFsaXplZDtcbiAgfVxuXG4gIHN0YXRpYyBpc0NvbGRTdGFydCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaW52b2NhdGlvbkNvdW50ID09PSAxO1xuICB9XG5cbiAgc3RhdGljIGdldEludm9jYXRpb25Db3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiBpbnZvY2F0aW9uQ291bnQ7XG4gIH1cblxuICBzdGF0aWMgZ2V0Q29uZmlnKCk6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsIHtcbiAgICByZXR1cm4gY29uZmlnO1xuICB9XG5cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgaWYgKCFjb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignT2JzZXJ2YWJpbGl0eU1hbmFnZXIgbm90IGluaXRpYWxpemVkJyk7XG4gICAgfVxuICAgIGNvbmZpZyA9IHsgLi4uY29uZmlnLCAuLi51cGRhdGVzIH07XG4gIH1cblxuICBzdGF0aWMgcmVnaXN0ZXJCYWNrZW5kKGJhY2tlbmQ6IE9ic2VydmFiaWxpdHlCYWNrZW5kKTogdm9pZCB7XG4gICAgaWYgKGJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBiYWNrZW5kcy5wdXNoKGJhY2tlbmQpO1xuICB9XG5cbiAgc3RhdGljIHVucmVnaXN0ZXJCYWNrZW5kKG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGJhY2tlbmRzID0gYmFja2VuZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IG5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHJlLWluaXRpYWxpemF0aW9uIGhvb2suXG4gICAqIEhvb2tzIHJ1biBCRUZPUkUgYmFja2VuZHMgYXJlIGluaXRpYWxpemVkLCBhbGxvd2luZyBzY2hlbWEvc2VydmljZSByZWdpc3RyYXRpb25cbiAgICogbmVlZGVkIGJ5IGJhY2tlbmRzIHdpdGhvdXQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzLlxuICAgKiBcbiAgICogQHBhcmFtIGhvb2sgLSBDYWxsYmFjayB0byBleGVjdXRlIGR1cmluZyBpbml0aWFsaXphdGlvblxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUHJlSW5pdEhvb2soaG9vazogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHByZUluaXRIb29rcy5wdXNoKGhvb2spO1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCAoZmlyZS1hbmQtZm9yZ2V0KVxuICAgKi9cbiAgc3RhdGljIGNhcHR1cmUoaW5wdXQ6IENhcHR1cmVJbnB1dCwgb3B0aW9ucz86IENhcHR1cmVPcHRpb25zKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIud2Fybign4p2MIE9ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJywgeyB0eXBlOiBpbnB1dC50eXBlLCBsZXZlbDogaW5wdXQubGV2ZWwgfSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkge1xuICAgICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgZGlzYWJsZWQsIHNraXBwaW5nIGNhcHR1cmUnLCB7IHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuICAgICAgLy8gTWVyZ2UgY3JpdGljYWwgZmxhZyBmcm9tIG9wdGlvbnMgaW50byBpbnB1dCBmb3IgZXZlbnQgY3JlYXRpb25cbiAgICAgIGNvbnN0IGV2ZW50SW5wdXQgPSBvcHRpb25zPy5jcml0aWNhbCA/IHsgLi4uaW5wdXQsIGNyaXRpY2FsOiB0cnVlIH0gOiBpbnB1dDtcbiAgICAgIGNvbnN0IGV2ZW50ID0gYnVpbGRFdmVudChldmVudElucHV0LCBjb250ZXh0KTtcblxuICAgICAgLy8gVHJ5IHRhaWwtYmFzZWQgc2FtcGxpbmcgZmlyc3RcbiAgICAgIGNvbnN0IHRhaWxSZXN1bHQgPSBoYW5kbGVUYWlsQmFzZWRTYW1wbGluZ1N5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgU0FNUExJTkcgKFN0YW5kYXJkKVxuICAgICAgY29uc3QgaXNTYW1wbGVkID0gZXZlbnQuY3JpdGljYWwgfHwgc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKTtcbiAgICAgIGlmICghaXNTYW1wbGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgZGlzcGF0Y2hUb0JhY2tlbmRzKGV2ZW50LCB0YXJnZXRCYWNrZW5kcyk7XG4gICAgICByZXR1cm4gZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgaW4gY2FwdHVyZTonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlIGFuIG9ic2VydmFiaWxpdHkgZXZlbnQgYXN5bmNocm9ub3VzbHkgKHdhaXRzIGZvciBiYWNrZW5kIGNhcHR1cmUpXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2FwdHVyZUFzeW5jKGlucHV0OiBDYXB0dXJlSW5wdXQsIG9wdGlvbnM/OiBPbWl0PENhcHR1cmVPcHRpb25zLCAnc3luYyc+KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgICAvLyBNZXJnZSBjcml0aWNhbCBmbGFnIGZyb20gb3B0aW9ucyBpbnRvIGlucHV0IGZvciBldmVudCBjcmVhdGlvblxuICAgICAgY29uc3QgZXZlbnRJbnB1dCA9IG9wdGlvbnM/LmNyaXRpY2FsID8geyAuLi5pbnB1dCwgY3JpdGljYWw6IHRydWUgfSA6IGlucHV0O1xuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGV2ZW50SW5wdXQsIGNvbnRleHQpO1xuXG4gICAgICAvLyBUcnkgdGFpbC1iYXNlZCBzYW1wbGluZyBmaXJzdFxuICAgICAgY29uc3QgdGFpbFJlc3VsdCA9IGF3YWl0IGhhbmRsZVRhaWxCYXNlZFNhbXBsaW5nQXN5bmMoZXZlbnQsIGNvbnRleHQpO1xuICAgICAgaWYgKHRhaWxSZXN1bHQgPT09ICdjYXB0dXJlZCcpIHtcbiAgICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICAgIH1cbiAgICAgIGlmICh0YWlsUmVzdWx0ID09PSAnYnVmZmVyZWQnKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEhFQUQtQkFTRUQgU0FNUExJTkcgKFN0YW5kYXJkKVxuICAgICAgY29uc3QgaXNTYW1wbGVkID0gZXZlbnQuY3JpdGljYWwgfHwgc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKTtcbiAgICAgIGlmICghaXNTYW1wbGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhcmdldEJhY2tlbmRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0QmFja2VuZHMpO1xuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmVBc3luYzonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPYnNlcnZlIGFuIGV2ZW50XG4gICAqL1xuICBzdGF0aWMgb2JzZXJ2ZShcbiAgICBldmVudDogUGFydGlhbDxPYnNlcnZhYmlsaXR5RXZlbnQ+ICYgeyB0eXBlOiBzdHJpbmc7IGxldmVsOiBzdHJpbmc7IGNvcnJlbGF0aW9uSWQ/OiBzdHJpbmcgfSxcbiAgICBvcHRpb25zPzogQ2FwdHVyZU9wdGlvbnNcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gZXZlbnQuY29ycmVsYXRpb25JZCA/PyBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMoKTtcblxuICAgIGlmICghY29ycmVsYXRpb25JZCkge1xuICAgICAgbG9nZ2VyLndhcm4oJ29ic2VydmUoKSBjYWxsZWQgd2l0aG91dCBjb3JyZWxhdGlvbklkJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUgYXMgQ2FwdHVyZUlucHV0WyAndHlwZScgXSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCBhcyBDYXB0dXJlSW5wdXRbICdsZXZlbCcgXSxcbiAgICB9LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaCBhbGwgYmFja2VuZHMgYW5kIGJ1ZmZlcmVkIGV2ZW50cyAoY2FsbGVkIGF0IGVuZCBvZiBMYW1iZGEgaW52b2NhdGlvbilcbiAgICovXG4gIHN0YXRpYyBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsb2dnZXIuZGVidWcoJz09PSBGTFVTSCBTVEFSVCA9PT0nLCB7XG4gICAgICBwZW5kaW5nRGlzcGF0Y2hlczogcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoLFxuICAgICAgYmFja2VuZHM6IGJhY2tlbmRzLmxlbmd0aCxcbiAgICAgIHNtYXJ0U2FtcGxpbmc6IGNvbmZpZz8uc2FtcGxpbmc/LnNtYXJ0LFxuICAgIH0pO1xuXG4gICAgLy8gV2FpdCBmb3IgYWxsIHBlbmRpbmcgZmlyZS1hbmQtZm9yZ2V0IGRpc3BhdGNoZXMgKGZyb20gZXJyb3IgcGF0aCBpbiBjYXB0dXJlKCkpXG4gICAgaWYgKHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgV2FpdGluZyBmb3IgJHtwZW5kaW5nRGlzcGF0Y2hlcy5sZW5ndGh9IHBlbmRpbmcgZGlzcGF0Y2hlc2ApO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwocGVuZGluZ0Rpc3BhdGNoZXMpO1xuICAgICAgcGVuZGluZ0Rpc3BhdGNoZXMubGVuZ3RoID0gMDsgLy8gQ2xlYXIgZm9yIG5leHQgaW52b2NhdGlvblxuICAgICAgbG9nZ2VyLmRlYnVnKCdQZW5kaW5nIGRpc3BhdGNoZXMgY29tcGxldGVkJyk7XG4gICAgfVxuXG4gICAgLy8gSWYgc21hcnQgc2FtcGxpbmcgaXMgZW5hYmxlZCwgZmx1c2ggYnVmZmVyZWQgZXZlbnRzIHdpdGggc2FtcGxpbmcgYXBwbGllZFxuICAgIGlmIChjb25maWc/LnNhbXBsaW5nPy5zbWFydCkge1xuICAgICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG5cbiAgICAgIGlmIChjb250ZXh0Py5vYnNlcnZhYmlsaXR5QnVmZmVyPy5sZW5ndGggJiYgIWNvbnRleHQuZXJyb3JPY2N1cnJlZCkge1xuICAgICAgICAvLyBObyBlcnJvciBvY2N1cnJlZDogYXBwbHkgc2FtcGxpbmcgdG8gYnVmZmVyIGJlZm9yZSBmbHVzaGluZ1xuICAgICAgICBjb25zdCBidWZmZXIgPSBjb250ZXh0Lm9ic2VydmFiaWxpdHlCdWZmZXIgYXMgT2JzZXJ2YWJpbGl0eUV2ZW50W107XG4gICAgICAgIGNvbnRleHQub2JzZXJ2YWJpbGl0eUJ1ZmZlciA9IFtdOyAvLyBDbGVhciBidWZmZXJcblxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGJ1ZmZlcikge1xuICAgICAgICAgIC8vIEFwcGx5IHNhbXBsaW5nIHJ1bGVzIHRvIGJ1ZmZlcmVkIGV2ZW50XG4gICAgICAgICAgY29uc3QgaXNTYW1wbGVkID0gc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKTtcbiAgICAgICAgICBpZiAoaXNTYW1wbGVkKSB7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRzID0gZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgICAgICAgYXdhaXQgZGlzcGF0Y2hUb0JhY2tlbmRzU3luYyhldmVudCwgdGFyZ2V0cyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGVsc2U6IGRyb3BwZWQgYnkgc2FtcGxpbmdcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gSWYgZXJyb3JPY2N1cnJlZD10cnVlLCBidWZmZXIgd2FzIGFscmVhZHkgZmx1c2hlZCBkdXJpbmcgY2FwdHVyZVxuICAgIH1cblxuICAgIC8vIEZsdXNoIGFsbCBiYWNrZW5kcyB3aXRoIHJldHJ5IGxvZ2ljXG4gICAgY29uc3QgTUFYX0ZMVVNIX1JFVFJJRVMgPSAyO1xuICAgIGNvbnN0IGZsdXNoUHJvbWlzZXMgPSBiYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgIGlmICghYmFja2VuZC5mbHVzaCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZvciAobGV0IGF0dGVtcHQgPSAxOyBhdHRlbXB0IDw9IE1BWF9GTFVTSF9SRVRSSUVTOyBhdHRlbXB0KyspIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG4gICAgICAgICAgYnJlYWs7IC8vIFN1Y2Nlc3NcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBpZiAoYXR0ZW1wdCA9PT0gTUFYX0ZMVVNIX1JFVFJJRVMpIHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIGFmdGVyICR7YXR0ZW1wdH0gYXR0ZW1wdHM6YCwgZXJyb3IpO1xuICAgICAgICAgICAgLy8gRXZlbnRzIG1heSBiZSBsb3N0LCBidXQgd2UndmUgZG9uZSBvdXIgYmVzdFxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2dnZXIud2FybihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmx1c2ggZmFpbGVkIChhdHRlbXB0ICR7YXR0ZW1wdH0vJHtNQVhfRkxVU0hfUkVUUklFU30pLCByZXRyeWluZy4uLmAsIGVycm9yKTtcbiAgICAgICAgICAgIC8vIFNpbXBsZSBleHBvbmVudGlhbCBiYWNrb2ZmXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwICogYXR0ZW1wdCkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoZmx1c2hQcm9taXNlcyk7XG4gICAgbG9nZ2VyLmRlYnVnKCc9PT0gRkxVU0ggQ09NUExFVEUgPT09Jyk7XG4gIH1cblxuICAvKipcbiAgICogUmVzZXQgbWFuYWdlciBzdGF0ZSAoZm9yIHRlc3RpbmcpXG4gICAqL1xuICBzdGF0aWMgcmVzZXQoKTogdm9pZCB7XG4gICAgY29uZmlnID0gbnVsbDtcbiAgICBiYWNrZW5kcyA9IFtdO1xuICAgIGJhY2tlbmRDb25maWdzLmNsZWFyKCk7XG4gICAgaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgICBpbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIHNhbXBsaW5nUmVnZXhDYWNoZS5jbGVhcigpO1xuICAgIHBlbmRpbmdEaXNwYXRjaGVzLmxlbmd0aCA9IDA7XG4gICAgcmVzZXRDYXB0dXJlcigpO1xuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgZm9yIHRlc3Rpbmcgd2l0aCBtb2NrIGNvbmZpZyBhbmQgYmFja2VuZHNcbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplRm9yVGVzdGluZyhcbiAgICB0ZXN0Q29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICAgIHRlc3RCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdXG4gICk6IHZvaWQge1xuICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLnJlc2V0KCk7XG4gICAgY29uZmlnID0gdGVzdENvbmZpZztcbiAgICBiYWNrZW5kcyA9IHRlc3RCYWNrZW5kcztcbiAgICBpbml0aWFsaXplZCA9IHRydWU7XG5cbiAgICBpbml0aWFsaXplQ2FwdHVyZXIoe1xuICAgICAgY2FwdHVyZTogKGlucHV0LCBvcHRpb25zKSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlKGlucHV0LCBvcHRpb25zKSxcbiAgICAgIGNhcHR1cmVBc3luYzogKGlucHV0LCBvcHRpb25zKSA9PiBPYnNlcnZhYmlsaXR5TWFuYWdlci5jYXB0dXJlQXN5bmMoaW5wdXQsIG9wdGlvbnMpLFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogTGFtYmRhIGhhbmRsZXIgd3JhcHBlciB3aXRoIG9ic2VydmFiaWxpdHkgbGlmZWN5Y2xlIG1hbmFnZW1lbnRcbiAqL1xuZXhwb3J0IGNvbnN0IHdpdGhPYnNlcnZhYmlsaXR5ID0gPFQgZXh0ZW5kcyAoLi4uYXJnczogdW5rbm93bltdKSA9PiBQcm9taXNlPHVua25vd24+PihoYW5kbGVyOiBUKTogVCA9PiB7XG4gIHJldHVybiAoYXN5bmMgKC4uLmFyZ3M6IFBhcmFtZXRlcnM8VD4pID0+IHtcbiAgICB0cnkge1xuICAgICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVyKC4uLmFyZ3MpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBPYnNlcnZhYmlsaXR5TWFuYWdlci5mbHVzaCgpO1xuICAgIH1cbiAgfSkgYXMgVDtcbn07XG5cbmV4cG9ydCBjb25zdCBPYnNlcnZlciA9IE9ic2VydmFiaWxpdHlNYW5hZ2VyO1xuIl19