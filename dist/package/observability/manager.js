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
let invocationCount = 0;
let initialized = false;
const samplingRegexCache = new Map();
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
function buildEvent(input) {
    const context = (0, context_1.getCurrentContext)();
    const now = Date.now();
    const correlationId = input.correlationId ?? context?.correlationId;
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
            : (input.parentObservabilityLogId ?? context?.parentObservabilityLogId),
        actor: input.actor ?? context?.actor,
        source: input.source ?? context?.source ?? (0, source_utils_1.detectSource)(),
        tags: (0, source_utils_1.mergeTags)({ ...context?.tags, ...input.tags }, true),
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
    };
}
function getTypeCategory(type) {
    if (type.startsWith('span.'))
        return 'span';
    if (type === 'metric')
        return 'metric';
    if (type.startsWith('audit'))
        return 'audit';
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
function dispatchToBackends(event, targetBackends) {
    void Promise.all(targetBackends.map(async (backend) => {
        try {
            if (backend.minLevel !== undefined) {
                const eventLevel = (0, level_utils_1.stringToLevel)(event.level);
                if (eventLevel < backend.minLevel) {
                    return;
                }
            }
            await backend.capture(event);
        }
        catch (error) {
            logger.error(`Failed to capture in backend ${backend.name}:`, error);
        }
    }));
}
async function dispatchToBackendsSync(event, targetBackends) {
    await Promise.all(targetBackends.map(async (backend) => {
        try {
            if (backend.minLevel !== undefined) {
                const eventLevel = (0, level_utils_1.stringToLevel)(event.level);
                if (eventLevel < backend.minLevel) {
                    return;
                }
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
function shouldCapture(event, cfg) {
    const levelValue = (0, level_utils_1.stringToLevel)(event.level);
    const typeCategory = getTypeCategory(event.type);
    const effectiveLevel = getEffectiveLevelForType(typeCategory);
    if (levelValue < effectiveLevel) {
        return false;
    }
    if (levelValue === types_1.ObservabilityLevel.CRITICAL) {
        return true;
    }
    if (!cfg.sampling?.enabled) {
        return true;
    }
    const typeConfig = cfg.types?.[typeCategory];
    if (typeConfig?.sampling?.enabled) {
        return Math.random() < typeConfig.sampling.rate;
    }
    if (event.operation && cfg.sampling.operations) {
        for (const [pattern, rate] of Object.entries(cfg.sampling.operations)) {
            const regex = getOrCreateSamplingRegex(pattern);
            if (regex.test(event.operation)) {
                return Math.random() < rate;
            }
        }
    }
    const levelName = (0, level_utils_1.levelToString)(levelValue);
    const rate = cfg.sampling.rates?.[levelName];
    if (rate === undefined || rate >= 1)
        return true;
    if (rate <= 0)
        return false;
    return Math.random() < rate;
}
function getOrCreateSamplingRegex(pattern) {
    let regex = samplingRegexCache.get(pattern);
    if (!regex) {
        regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        samplingRegexCache.set(pattern, regex);
    }
    return regex;
}
/**
 * Initialize backends from DI based on config
 */
function initializeBackendsFromConfig(cfg) {
    backends = [];
    const enabledTypes = cfg.backends?.filter(b => b.enabled !== false).map(b => b.type) ?? ['cloudwatch'];
    for (const type of enabledTypes) {
        try {
            const backend = di_1.DIContainer.ROOT.resolve('ObservabilityBackend', { tags: ['observability', 'backend', type] });
            backends.push(backend);
            logger.debug(`Initialized backend: ${backend.name}`);
        }
        catch (error) {
            if (error instanceof errors_1.NoProviderFoundError) {
                logger.warn(`Backend '${type}' not found in DI, skipping`);
            }
            else {
                logger.error(`Failed to initialize backend '${type}':`, error);
            }
        }
    }
    // Fallback to CloudWatch if no backends enabled
    if (backends.length === 0) {
        logger.warn('No backends enabled, attempting CloudWatch fallback');
        try {
            const backend = di_1.DIContainer.ROOT.resolve('ObservabilityBackend', { tags: ['observability', 'backend', 'cloudwatch'] });
            backends.push(backend);
        }
        catch (error) {
            logger.error('Failed to resolve fallback CloudWatch backend:', error);
        }
    }
}
function doInitialize() {
    // Resolve config from DI (defaults registered in index.ts guarantee all required fields)
    config = di_1.DIContainer.ROOT.resolveConfig('observability');
    logger.debug('Observability config loaded from DI');
    // Initialize backends from DI
    initializeBackendsFromConfig(config);
    // Register capturer for observers
    (0, base_1.initializeCapturer)({
        capture: (input, options) => ObservabilityManager.capture(input, options),
        captureAsync: (input, options) => ObservabilityManager.captureAsync(input, options),
    });
    initialized = true;
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
        if (!initialized) {
            doInitialize();
        }
        invocationCount++;
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
            const event = buildEvent(input);
            if (!options?.critical && !shouldCapture(event, config)) {
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
     * Capture an observability event asynchronously
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
            const event = buildEvent(input);
            if (!options?.critical && !shouldCapture(event, config)) {
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
     * Flush all backends
     */
    static async flush() {
        const flushPromises = backends.map(async (backend) => {
            if (backend.flush) {
                try {
                    await backend.flush();
                }
                catch (error) {
                    logger.error(`Failed to flush backend ${backend.name}:`, error);
                }
            }
        });
        await Promise.all(flushPromises);
    }
    /**
     * Reset manager state (for testing)
     */
    static reset() {
        config = null;
        backends = [];
        invocationCount = 0;
        initialized = false;
        samplingRegexCache.clear();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILG1DQUFvQztBQUNwQyx3Q0FBMEM7QUFDMUMsbUNBUWlCO0FBQ2pCLHFEQUFtRTtBQUNuRSx1REFBK0Q7QUFDL0QsNkRBQThEO0FBQzlELHVDQUF3RTtBQUN4RSwyQ0FBcUU7QUFDckUsOEJBQW9DO0FBQ3BDLHlDQUFvRDtBQUVwRCxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQU9wRCw4RUFBOEU7QUFDOUUsdUJBQXVCO0FBQ3ZCLDhFQUE4RTtBQUU5RSxJQUFJLE1BQU0sR0FBK0IsSUFBSSxDQUFDO0FBQzlDLElBQUksUUFBUSxHQUEyQixFQUFFLENBQUM7QUFDMUMsSUFBSSxlQUFlLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLElBQUksV0FBVyxHQUFHLEtBQUssQ0FBQztBQUN4QixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0FBRXJELDhFQUE4RTtBQUM5RSwyQkFBMkI7QUFDM0IsOEVBQThFO0FBRTlFLFNBQVMsYUFBYSxDQUFDLEtBQW1CO0lBQ3hDLE1BQU0sTUFBTSxHQUFzQixFQUFFLENBQUM7SUFDckMsTUFBTSxPQUFPLEdBQUcsSUFBQSwyQkFBaUIsR0FBRSxDQUFDO0lBRXBDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDaEIsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixFQUFFLENBQUMsQ0FBQztJQUM5RCxDQUFDO0lBRUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNqQixNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxP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LENBQ3pCLFVBQStCLEVBQy9CLGVBQXVDLEVBQUU7UUFFekMsb0JBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDN0IsTUFBTSxHQUFHLFVBQVUsQ0FBQztRQUNwQixRQUFRLEdBQUcsWUFBWSxDQUFDO1FBQ3hCLFdBQVcsR0FBRyxJQUFJLENBQUM7UUFFbkIsSUFBQSx5QkFBa0IsRUFBQztZQUNqQixPQUFPLEVBQUUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQztZQUN6RSxZQUFZLEVBQUUsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQztTQUNwRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqTUQsb0RBaU1DO0FBRUQ7O0dBRUc7QUFDSSxNQUFNLGlCQUFpQixHQUFHLENBQXFELE9BQVUsRUFBSyxFQUFFO0lBQ3JHLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxJQUFtQixFQUFFLEVBQUU7UUFDdkMsSUFBSSxDQUFDO1lBQ0gsb0JBQW9CLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztZQUM1QyxPQUFPLE1BQU0sT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDaEMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxvQkFBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQyxDQUFDO0lBQ0gsQ0FBQyxDQUFNLENBQUM7QUFDVixDQUFDLENBQUM7QUFUVyxRQUFBLGlCQUFpQixxQkFTNUI7QUFFVyxRQUFBLFFBQVEsR0FBRyxvQkFBb0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogT2JzZXJ2YWJpbGl0eU1hbmFnZXIgLSBDb3JlIE9ic2VydmVyIGZvciB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW1cbiAqIFxuICogQWxsIGNvbmZpZyBhbmQgYmFja2VuZHMgcmVzb2x2ZWQgZnJvbSBESSAtIG5vIG1hbnVhbCBpbnN0YW50aWF0aW9uLlxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQge1xuICBDYXB0dXJlSW5wdXQsXG4gIENhcHR1cmVPcHRpb25zLFxuICBPYnNlcnZhYmlsaXR5QmFja2VuZCxcbiAgT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgT2JzZXJ2YWJpbGl0eUVycm9yLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbn0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBzdHJpbmdUb0xldmVsLCBsZXZlbFRvU3RyaW5nIH0gZnJvbSAnLi91dGlscy9sZXZlbC11dGlscyc7XG5pbXBvcnQgeyBkZXRlY3RTb3VyY2UsIG1lcmdlVGFncyB9IGZyb20gJy4vdXRpbHMvc291cmNlLXV0aWxzJztcbmltcG9ydCB7IHJlZGFjdFNlbnNpdGl2ZURhdGEgfSBmcm9tICcuL3V0aWxzL2RhdGEtcHJvdGVjdGlvbic7XG5pbXBvcnQgeyBnZXRDdXJyZW50Q29udGV4dCwgZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzIH0gZnJvbSAnLi9jb250ZXh0JztcbmltcG9ydCB7IGluaXRpYWxpemVDYXB0dXJlciwgcmVzZXRDYXB0dXJlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuaW1wb3J0IHsgRElDb250YWluZXIgfSBmcm9tICcuLi9kaSc7XG5pbXBvcnQgeyBOb1Byb3ZpZGVyRm91bmRFcnJvciB9IGZyb20gJy4uL2RpL2Vycm9ycyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignT2JzZXJ2YWJpbGl0eU1hbmFnZXInKTtcblxuaW50ZXJmYWNlIFZhbGlkYXRpb25FcnJvciB7XG4gIGZpZWxkOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQUklWQVRFIE1PRFVMRSBTVEFURVxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG5cbmxldCBjb25maWc6IE9ic2VydmFiaWxpdHlDb25maWcgfCBudWxsID0gbnVsbDtcbmxldCBiYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSA9IFtdO1xubGV0IGludm9jYXRpb25Db3VudCA9IDA7XG5sZXQgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbmNvbnN0IHNhbXBsaW5nUmVnZXhDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWdFeHA+KCk7XG5cbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuLy8gUFJJVkFURSBIRUxQRVIgRlVOQ1RJT05TXG4vLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuZnVuY3Rpb24gdmFsaWRhdGVJbnB1dChpbnB1dDogQ2FwdHVyZUlucHV0KTogVmFsaWRhdGlvbkVycm9yW10ge1xuICBjb25zdCBlcnJvcnM6IFZhbGlkYXRpb25FcnJvcltdID0gW107XG4gIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gIGlmICghaW5wdXQudHlwZSkge1xuICAgIGVycm9ycy5wdXNoKHsgZmllbGQ6ICd0eXBlJywgbWVzc2FnZTogJ3R5cGUgaXMgcmVxdWlyZWQnIH0pO1xuICB9XG5cbiAgaWYgKCFpbnB1dC5sZXZlbCkge1xuICAgIGVycm9ycy5wdXNoKHsgZmllbGQ6ICdsZXZlbCcsIG1lc3NhZ2U6ICdsZXZlbCBpcyByZXF1aXJlZCcgfSk7XG4gIH1cblxuICBpZiAoIWlucHV0LmNvcnJlbGF0aW9uSWQgJiYgIWNvbnRleHQ/LmNvcnJlbGF0aW9uSWQpIHtcbiAgICBlcnJvcnMucHVzaCh7XG4gICAgICBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgbWVzc2FnZTogJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQuIEVzdGFibGlzaCBjb250ZXh0IHdpdGggcnVuV2l0aENvbnRleHQoKSBvciBwcm92aWRlIGV4cGxpY2l0bHkuJ1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGVycm9ycztcbn1cblxuZnVuY3Rpb24gYXBwbHlEYXRhUHJvdGVjdGlvbihcbiAgaW5wdXQ6IENhcHR1cmVJbnB1dCxcbiAgZGF0YVByb3RlY3Rpb24/OiBPYnNlcnZhYmlsaXR5Q29uZmlnWyAnZGF0YVByb3RlY3Rpb24nIF1cbik6IHtcbiAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBhdHRyaWJ1dGVzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgZXJyb3I/OiBPYnNlcnZhYmlsaXR5RXJyb3I7XG59IHtcbiAgaWYgKCFkYXRhUHJvdGVjdGlvbj8uZW5hYmxlZCkge1xuICAgIHJldHVybiB7XG4gICAgICBkYXRhOiBpbnB1dC5kYXRhLFxuICAgICAgYXR0cmlidXRlczogaW5wdXQuYXR0cmlidXRlcyxcbiAgICAgIG1ldGFkYXRhOiBpbnB1dC5tZXRhZGF0YSxcbiAgICAgIGNvbnRleHQ6IGlucHV0LmNvbnRleHQsXG4gICAgICBlcnJvcjogaW5wdXQuZXJyb3IsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IGZpZWxkcyA9IGRhdGFQcm90ZWN0aW9uLmZpZWxkcyA/PyBbICdkYXRhJywgJ2F0dHJpYnV0ZXMnLCAnbWV0YWRhdGEnLCAnY29udGV4dCcgXTtcblxuICByZXR1cm4ge1xuICAgIGRhdGE6IGZpZWxkcy5pbmNsdWRlcygnZGF0YScpICYmIGlucHV0LmRhdGFcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5kYXRhLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQuZGF0YSxcbiAgICBhdHRyaWJ1dGVzOiBmaWVsZHMuaW5jbHVkZXMoJ2F0dHJpYnV0ZXMnKSAmJiBpbnB1dC5hdHRyaWJ1dGVzXG4gICAgICA/IHJlZGFjdFNlbnNpdGl2ZURhdGEoaW5wdXQuYXR0cmlidXRlcywgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGE6IGZpZWxkcy5pbmNsdWRlcygnbWV0YWRhdGEnKSAmJiBpbnB1dC5tZXRhZGF0YVxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0Lm1ldGFkYXRhLCBkYXRhUHJvdGVjdGlvbilcbiAgICAgIDogaW5wdXQubWV0YWRhdGEsXG4gICAgY29udGV4dDogZmllbGRzLmluY2x1ZGVzKCdjb250ZXh0JykgJiYgaW5wdXQuY29udGV4dFxuICAgICAgPyByZWRhY3RTZW5zaXRpdmVEYXRhKGlucHV0LmNvbnRleHQsIGRhdGFQcm90ZWN0aW9uKVxuICAgICAgOiBpbnB1dC5jb250ZXh0LFxuICAgIGVycm9yOiBmaWVsZHMuaW5jbHVkZXMoJ2Vycm9yJykgJiYgaW5wdXQuZXJyb3JcbiAgICAgID8gcmVkYWN0U2Vuc2l0aXZlRGF0YShpbnB1dC5lcnJvciwgZGF0YVByb3RlY3Rpb24pXG4gICAgICA6IGlucHV0LmVycm9yLFxuICB9O1xufVxuXG5mdW5jdGlvbiBidWlsZEV2ZW50KGlucHV0OiBDYXB0dXJlSW5wdXQpOiBPYnNlcnZhYmlsaXR5RXZlbnQge1xuICBjb25zdCBjb250ZXh0ID0gZ2V0Q3VycmVudENvbnRleHQoKTtcbiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcblxuICBjb25zdCBjb3JyZWxhdGlvbklkID0gaW5wdXQuY29ycmVsYXRpb25JZCA/PyBjb250ZXh0Py5jb3JyZWxhdGlvbklkO1xuICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvcnJlbGF0aW9uSWQgaXMgcmVxdWlyZWQgLSB0aGlzIHNob3VsZCBoYXZlIGJlZW4gY2F1Z2h0IGJ5IHZhbGlkYXRpb24nKTtcbiAgfVxuXG4gIGNvbnN0IHsgZGF0YSwgYXR0cmlidXRlcywgbWV0YWRhdGEsIGNvbnRleHQ6IGV2ZW50Q29udGV4dCwgZXJyb3IgfSA9IGFwcGx5RGF0YVByb3RlY3Rpb24oXG4gICAgaW5wdXQsXG4gICAgY29uZmlnPy5kYXRhUHJvdGVjdGlvblxuICApO1xuXG4gIHJldHVybiB7XG4gICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICBsZXZlbDogaW5wdXQubGV2ZWwsXG4gICAgY29ycmVsYXRpb25JZCxcbiAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gbm93LFxuICAgIG9ic2VydmFiaWxpdHlMb2dJZDogaW5wdXQub2JzZXJ2YWJpbGl0eUxvZ0lkID8/IHJhbmRvbVVVSUQoKSxcbiAgICAvLyBudWxsID0gZXhwbGljaXRseSBubyBwYXJlbnQgKGRvbid0IGZhbGwgYmFjayksIHVuZGVmaW5lZCA9IHVzZSBjb250ZXh0XG4gICAgcGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkOiBpbnB1dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPT09IG51bGwgXG4gICAgICA/IHVuZGVmaW5lZCBcbiAgICAgIDogKGlucHV0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA/PyBjb250ZXh0Py5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpLFxuICAgIGFjdG9yOiBpbnB1dC5hY3RvciA/PyBjb250ZXh0Py5hY3RvcixcbiAgICBzb3VyY2U6IGlucHV0LnNvdXJjZSA/PyBjb250ZXh0Py5zb3VyY2UgPz8gZGV0ZWN0U291cmNlKCksXG4gICAgdGFnczogbWVyZ2VUYWdzKHsgLi4uY29udGV4dD8udGFncywgLi4uaW5wdXQudGFncyB9LCB0cnVlKSxcbiAgICBlbnRpdHlOYW1lOiBpbnB1dC5lbnRpdHlOYW1lLFxuICAgIGVudGl0eUlkOiBpbnB1dC5lbnRpdHlJZCxcbiAgICBvcGVyYXRpb246IGlucHV0Lm9wZXJhdGlvbixcbiAgICBzdWJUeXBlOiBpbnB1dC5zdWJUeXBlLFxuICAgIHN0YXR1czogaW5wdXQuc3RhdHVzLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgZHVyYXRpb25NczogaW5wdXQuZHVyYXRpb25NcyxcbiAgICBkYXRhLFxuICAgIGF0dHJpYnV0ZXMsXG4gICAgbWV0YWRhdGEsXG4gICAgbWV0cmljczogaW5wdXQubWV0cmljcyxcbiAgICBjb250ZXh0OiBldmVudENvbnRleHQsXG4gICAgZXJyb3IsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFR5cGVDYXRlZ29yeSh0eXBlOiBzdHJpbmcpOiAnc3BhbicgfCAnbWV0cmljJyB8ICdhdWRpdCcgfCAnbG9nJyB7XG4gIGlmICh0eXBlLnN0YXJ0c1dpdGgoJ3NwYW4uJykpIHJldHVybiAnc3Bhbic7XG4gIGlmICh0eXBlID09PSAnbWV0cmljJykgcmV0dXJuICdtZXRyaWMnO1xuICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgcmV0dXJuICdsb2cnO1xufVxuXG5mdW5jdGlvbiBnZXRCYWNrZW5kc0ZvclR5cGUodHlwZTogc3RyaW5nKTogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSB7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeSh0eXBlKTtcbiAgY29uc3QgdHlwZUNvbmZpZyA9IGNvbmZpZz8udHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG5cbiAgaWYgKHR5cGVDb25maWc/LmJhY2tlbmRzICYmIHR5cGVDb25maWcuYmFja2VuZHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBiYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSk7XG4gIH1cblxuICByZXR1cm4gYmFja2VuZHM7XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoVG9CYWNrZW5kcyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCB0YXJnZXRCYWNrZW5kczogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSk6IHZvaWQge1xuICB2b2lkIFByb21pc2UuYWxsKFxuICAgIHRhcmdldEJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGJhY2tlbmQubWluTGV2ZWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNvbnN0IGV2ZW50TGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcbiAgICAgICAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIHRhcmdldEJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IFByb21pc2UuYWxsKFxuICAgIHRhcmdldEJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGJhY2tlbmQubWluTGV2ZWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNvbnN0IGV2ZW50TGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcbiAgICAgICAgICBpZiAoZXZlbnRMZXZlbCA8IGJhY2tlbmQubWluTGV2ZWwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgYmFja2VuZC5jYXB0dXJlKGV2ZW50KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgRmFpbGVkIHRvIGNhcHR1cmUgaW4gYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xufVxuXG5mdW5jdGlvbiBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZTogJ3NwYW4nIHwgJ21ldHJpYycgfCAnYXVkaXQnIHwgJ2xvZycpOiBPYnNlcnZhYmlsaXR5TGV2ZWwge1xuICBjb25zdCB0eXBlQ29uZmlnID0gY29uZmlnPy50eXBlcz8uWyB0eXBlIF07XG4gIHJldHVybiB0eXBlQ29uZmlnPy5taW5MZXZlbCA/PyBjb25maWc/Lm1pbkxldmVsID8/IE9ic2VydmFiaWxpdHlMZXZlbC5JTkZPO1xufVxuXG5mdW5jdGlvbiBzaG91bGRDYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IGJvb2xlYW4ge1xuICBjb25zdCBsZXZlbFZhbHVlID0gc3RyaW5nVG9MZXZlbChldmVudC5sZXZlbCk7XG4gIGNvbnN0IHR5cGVDYXRlZ29yeSA9IGdldFR5cGVDYXRlZ29yeShldmVudC50eXBlKTtcbiAgY29uc3QgZWZmZWN0aXZlTGV2ZWwgPSBnZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZUNhdGVnb3J5KTtcblxuICBpZiAobGV2ZWxWYWx1ZSA8IGVmZmVjdGl2ZUxldmVsKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgaWYgKGxldmVsVmFsdWUgPT09IE9ic2VydmFiaWxpdHlMZXZlbC5DUklUSUNBTCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaWYgKCFjZmcuc2FtcGxpbmc/LmVuYWJsZWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGNvbnN0IHR5cGVDb25maWcgPSBjZmcudHlwZXM/LlsgdHlwZUNhdGVnb3J5IF07XG4gIGlmICh0eXBlQ29uZmlnPy5zYW1wbGluZz8uZW5hYmxlZCkge1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICB9XG5cbiAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjZmcuc2FtcGxpbmcub3BlcmF0aW9ucykge1xuICAgIGZvciAoY29uc3QgWyBwYXR0ZXJuLCByYXRlIF0gb2YgT2JqZWN0LmVudHJpZXMoY2ZnLnNhbXBsaW5nLm9wZXJhdGlvbnMpKSB7XG4gICAgICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgICAgIGlmIChyZWdleC50ZXN0KGV2ZW50Lm9wZXJhdGlvbikpIHtcbiAgICAgICAgcmV0dXJuIE1hdGgucmFuZG9tKCkgPCByYXRlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGxldmVsTmFtZSA9IGxldmVsVG9TdHJpbmcobGV2ZWxWYWx1ZSk7XG4gIGNvbnN0IHJhdGUgPSBjZmcuc2FtcGxpbmcucmF0ZXM/LlsgbGV2ZWxOYW1lIF07XG4gIGlmIChyYXRlID09PSB1bmRlZmluZWQgfHwgcmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHJhdGUgPD0gMCkgcmV0dXJuIGZhbHNlO1xuXG4gIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbn1cblxuZnVuY3Rpb24gZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm46IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZWdleCA9IHNhbXBsaW5nUmVnZXhDYWNoZS5nZXQocGF0dGVybik7XG4gIGlmICghcmVnZXgpIHtcbiAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvXFwqL2csICcuKicpfSRgKTtcbiAgICBzYW1wbGluZ1JlZ2V4Q2FjaGUuc2V0KHBhdHRlcm4sIHJlZ2V4KTtcbiAgfVxuICByZXR1cm4gcmVnZXg7XG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBiYWNrZW5kcyBmcm9tIERJIGJhc2VkIG9uIGNvbmZpZ1xuICovXG5mdW5jdGlvbiBpbml0aWFsaXplQmFja2VuZHNGcm9tQ29uZmlnKGNmZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyk6IHZvaWQge1xuICBiYWNrZW5kcyA9IFtdO1xuICBjb25zdCBlbmFibGVkVHlwZXMgPSBjZmcuYmFja2VuZHM/LmZpbHRlcihiID0+IGIuZW5hYmxlZCAhPT0gZmFsc2UpLm1hcChiID0+IGIudHlwZSkgPz8gWyAnY2xvdWR3YXRjaCcgXTtcblxuICBmb3IgKGNvbnN0IHR5cGUgb2YgZW5hYmxlZFR5cGVzKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJhY2tlbmQgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmU8T2JzZXJ2YWJpbGl0eUJhY2tlbmQ+KFxuICAgICAgICAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICAgICAgICB7IHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsIHR5cGUgXSB9XG4gICAgICApO1xuICAgICAgYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgICAgIGxvZ2dlci5kZWJ1ZyhgSW5pdGlhbGl6ZWQgYmFja2VuZDogJHtiYWNrZW5kLm5hbWV9YCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIE5vUHJvdmlkZXJGb3VuZEVycm9yKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBCYWNrZW5kICcke3R5cGV9JyBub3QgZm91bmQgaW4gREksIHNraXBwaW5nYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGJhY2tlbmQgJyR7dHlwZX0nOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBGYWxsYmFjayB0byBDbG91ZFdhdGNoIGlmIG5vIGJhY2tlbmRzIGVuYWJsZWRcbiAgaWYgKGJhY2tlbmRzLmxlbmd0aCA9PT0gMCkge1xuICAgIGxvZ2dlci53YXJuKCdObyBiYWNrZW5kcyBlbmFibGVkLCBhdHRlbXB0aW5nIENsb3VkV2F0Y2ggZmFsbGJhY2snKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYmFja2VuZCA9IERJQ29udGFpbmVyLlJPT1QucmVzb2x2ZTxPYnNlcnZhYmlsaXR5QmFja2VuZD4oXG4gICAgICAgICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gICAgICAgIHsgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ2Nsb3Vkd2F0Y2gnIF0gfVxuICAgICAgKTtcbiAgICAgIGJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxvZ2dlci5lcnJvcignRmFpbGVkIHRvIHJlc29sdmUgZmFsbGJhY2sgQ2xvdWRXYXRjaCBiYWNrZW5kOicsIGVycm9yKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZG9Jbml0aWFsaXplKCk6IHZvaWQge1xuICAvLyBSZXNvbHZlIGNvbmZpZyBmcm9tIERJIChkZWZhdWx0cyByZWdpc3RlcmVkIGluIGluZGV4LnRzIGd1YXJhbnRlZSBhbGwgcmVxdWlyZWQgZmllbGRzKVxuICBjb25maWcgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmVDb25maWc8T2JzZXJ2YWJpbGl0eUNvbmZpZz4oJ29ic2VydmFiaWxpdHknKSBhcyBPYnNlcnZhYmlsaXR5Q29uZmlnO1xuICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgY29uZmlnIGxvYWRlZCBmcm9tIERJJyk7XG5cbiAgLy8gSW5pdGlhbGl6ZSBiYWNrZW5kcyBmcm9tIERJXG4gIGluaXRpYWxpemVCYWNrZW5kc0Zyb21Db25maWcoY29uZmlnISk7XG5cbiAgLy8gUmVnaXN0ZXIgY2FwdHVyZXIgZm9yIG9ic2VydmVyc1xuICBpbml0aWFsaXplQ2FwdHVyZXIoe1xuICAgIGNhcHR1cmU6IChpbnB1dCwgb3B0aW9ucykgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCwgb3B0aW9ucyksXG4gICAgY2FwdHVyZUFzeW5jOiAoaW5wdXQsIG9wdGlvbnMpID0+IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmNhcHR1cmVBc3luYyhpbnB1dCwgb3B0aW9ucyksXG4gIH0pO1xuXG4gIGluaXRpYWxpemVkID0gdHJ1ZTtcbn1cblxuLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4vLyBQVUJMSUMgQVBJIC0gT2JzZXJ2YWJpbGl0eU1hbmFnZXJcbi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG5leHBvcnQgY2xhc3MgT2JzZXJ2YWJpbGl0eU1hbmFnZXIge1xuXG4gIHByaXZhdGUgY29uc3RydWN0b3IoKSB7IH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmb3IgYSBuZXcgTGFtYmRhIGludm9jYXRpb25cbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBkb0luaXRpYWxpemUoKTtcbiAgICB9XG5cbiAgICBpbnZvY2F0aW9uQ291bnQrKztcbiAgICBmb3IgKGNvbnN0IGJhY2tlbmQgb2YgYmFja2VuZHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGJhY2tlbmQuaW5pdGlhbGl6ZUludm9jYXRpb24/LigpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBmYWlsZWQgdG8gaW5pdGlhbGl6ZSBpbnZvY2F0aW9uOmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBzdGF0aWMgaXNJbml0aWFsaXplZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gaW5pdGlhbGl6ZWQ7XG4gIH1cblxuICBzdGF0aWMgaXNDb2xkU3RhcnQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGludm9jYXRpb25Db3VudCA9PT0gMTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRJbnZvY2F0aW9uQ291bnQoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gaW52b2NhdGlvbkNvdW50O1xuICB9XG5cbiAgc3RhdGljIGdldENvbmZpZygpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHwgbnVsbCB7XG4gICAgcmV0dXJuIGNvbmZpZztcbiAgfVxuXG4gIHN0YXRpYyBjb25maWd1cmUodXBkYXRlczogUGFydGlhbDxPYnNlcnZhYmlsaXR5Q29uZmlnPik6IHZvaWQge1xuICAgIGlmICghY29uZmlnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ09ic2VydmFiaWxpdHlNYW5hZ2VyIG5vdCBpbml0aWFsaXplZCcpO1xuICAgIH1cbiAgICBjb25maWcgPSB7IC4uLmNvbmZpZywgLi4udXBkYXRlcyB9O1xuICB9XG5cbiAgc3RhdGljIHJlZ2lzdGVyQmFja2VuZChiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCk6IHZvaWQge1xuICAgIGlmIChiYWNrZW5kcy5maW5kKChiKSA9PiBiLm5hbWUgPT09IGJhY2tlbmQubmFtZSkpIHtcbiAgICAgIGxvZ2dlci53YXJuKGBCYWNrZW5kICR7YmFja2VuZC5uYW1lfSBhbHJlYWR5IHJlZ2lzdGVyZWRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYmFja2VuZHMucHVzaChiYWNrZW5kKTtcbiAgfVxuXG4gIHN0YXRpYyB1bnJlZ2lzdGVyQmFja2VuZChuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBiYWNrZW5kcyA9IGJhY2tlbmRzLmZpbHRlcigoYikgPT4gYi5uYW1lICE9PSBuYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlIGFuIG9ic2VydmFiaWxpdHkgZXZlbnQgKGZpcmUtYW5kLWZvcmdldClcbiAgICovXG4gIHN0YXRpYyBjYXB0dXJlKGlucHV0OiBDYXB0dXJlSW5wdXQsIG9wdGlvbnM/OiBDYXB0dXJlT3B0aW9ucyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCFpbml0aWFsaXplZCkge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdPYnNlcnZhYmlsaXR5IG5vdCBpbml0aWFsaXplZCwgc2tpcHBpbmcgY2FwdHVyZScpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZXJyb3JzID0gdmFsaWRhdGVJbnB1dChpbnB1dCk7XG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ0ludmFsaWQgY2FwdHVyZSBpbnB1dDonLCB7IGVycm9ycywgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgaWYgKCFjb25maWc/LmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGV2ZW50ID0gYnVpbGRFdmVudChpbnB1dCk7XG5cbiAgICAgIGlmICghb3B0aW9ucz8uY3JpdGljYWwgJiYgIXNob3VsZENhcHR1cmUoZXZlbnQsIGNvbmZpZykpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFyZ2V0QmFja2VuZHMgPSBnZXRCYWNrZW5kc0ZvclR5cGUoZXZlbnQudHlwZSk7XG4gICAgICBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcblxuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmU6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZSBhbiBvYnNlcnZhYmlsaXR5IGV2ZW50IGFzeW5jaHJvbm91c2x5XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2FwdHVyZUFzeW5jKGlucHV0OiBDYXB0dXJlSW5wdXQsIG9wdGlvbnM/OiBPbWl0PENhcHR1cmVPcHRpb25zLCAnc3luYyc+KTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWluaXRpYWxpemVkKSB7XG4gICAgICBsb2dnZXIuZGVidWcoJ09ic2VydmFiaWxpdHkgbm90IGluaXRpYWxpemVkLCBza2lwcGluZyBjYXB0dXJlJyk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSB2YWxpZGF0ZUlucHV0KGlucHV0KTtcbiAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIud2FybignSW52YWxpZCBjYXB0dXJlIGlucHV0OicsIHsgZXJyb3JzLCB0eXBlOiBpbnB1dC50eXBlIH0pO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZz8uZW5hYmxlZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgZXZlbnQgPSBidWlsZEV2ZW50KGlucHV0KTtcblxuICAgICAgaWYgKCFvcHRpb25zPy5jcml0aWNhbCAmJiAhc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB0YXJnZXRCYWNrZW5kcyA9IGdldEJhY2tlbmRzRm9yVHlwZShldmVudC50eXBlKTtcbiAgICAgIGF3YWl0IGRpc3BhdGNoVG9CYWNrZW5kc1N5bmMoZXZlbnQsIHRhcmdldEJhY2tlbmRzKTtcblxuICAgICAgcmV0dXJuIGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikgeyBcbiAgICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBpbiBjYXB0dXJlQXN5bmM6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT2JzZXJ2ZSBhbiBldmVudFxuICAgKi9cbiAgc3RhdGljIG9ic2VydmUoXG4gICAgZXZlbnQ6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiAmIHsgdHlwZTogc3RyaW5nOyBsZXZlbDogc3RyaW5nOyBjb3JyZWxhdGlvbklkPzogc3RyaW5nIH0sXG4gICAgb3B0aW9ucz86IENhcHR1cmVPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGV2ZW50LmNvcnJlbGF0aW9uSWQgPz8gZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzKCk7XG5cbiAgICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdvYnNlcnZlKCkgY2FsbGVkIHdpdGhvdXQgY29ycmVsYXRpb25JZCcpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZSh7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB0eXBlOiBldmVudC50eXBlIGFzIENhcHR1cmVJbnB1dFsgJ3R5cGUnIF0sXG4gICAgICBsZXZlbDogZXZlbnQubGV2ZWwgYXMgQ2FwdHVyZUlucHV0WyAnbGV2ZWwnIF0sXG4gICAgfSwgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogRmx1c2ggYWxsIGJhY2tlbmRzXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmx1c2hQcm9taXNlcyA9IGJhY2tlbmRzLm1hcChhc3luYyAoYmFja2VuZCkgPT4ge1xuICAgICAgaWYgKGJhY2tlbmQuZmx1c2gpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBiYWNrZW5kLmZsdXNoKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gZmx1c2ggYmFja2VuZCAke2JhY2tlbmQubmFtZX06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChmbHVzaFByb21pc2VzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldCBtYW5hZ2VyIHN0YXRlIChmb3IgdGVzdGluZylcbiAgICovXG4gIHN0YXRpYyByZXNldCgpOiB2b2lkIHtcbiAgICBjb25maWcgPSBudWxsO1xuICAgIGJhY2tlbmRzID0gW107XG4gICAgaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgICBpbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIHNhbXBsaW5nUmVnZXhDYWNoZS5jbGVhcigpO1xuICAgIHJlc2V0Q2FwdHVyZXIoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGZvciB0ZXN0aW5nIHdpdGggbW9jayBjb25maWcgYW5kIGJhY2tlbmRzXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZUZvclRlc3RpbmcoXG4gICAgdGVzdENvbmZpZzogT2JzZXJ2YWJpbGl0eUNvbmZpZyxcbiAgICB0ZXN0QmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXVxuICApOiB2b2lkIHtcbiAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5yZXNldCgpO1xuICAgIGNvbmZpZyA9IHRlc3RDb25maWc7XG4gICAgYmFja2VuZHMgPSB0ZXN0QmFja2VuZHM7XG4gICAgaW5pdGlhbGl6ZWQgPSB0cnVlO1xuXG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCwgb3B0aW9ucykgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZShpbnB1dCwgb3B0aW9ucyksXG4gICAgICBjYXB0dXJlQXN5bmM6IChpbnB1dCwgb3B0aW9ucykgPT4gT2JzZXJ2YWJpbGl0eU1hbmFnZXIuY2FwdHVyZUFzeW5jKGlucHV0LCBvcHRpb25zKSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIExhbWJkYSBoYW5kbGVyIHdyYXBwZXIgd2l0aCBvYnNlcnZhYmlsaXR5IGxpZmVjeWNsZSBtYW5hZ2VtZW50XG4gKi9cbmV4cG9ydCBjb25zdCB3aXRoT2JzZXJ2YWJpbGl0eSA9IDxUIGV4dGVuZHMgKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gUHJvbWlzZTx1bmtub3duPj4oaGFuZGxlcjogVCk6IFQgPT4ge1xuICByZXR1cm4gKGFzeW5jICguLi5hcmdzOiBQYXJhbWV0ZXJzPFQ+KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIE9ic2VydmFiaWxpdHlNYW5hZ2VyLmluaXRpYWxpemVJbnZvY2F0aW9uKCk7XG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlciguLi5hcmdzKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9XG4gIH0pIGFzIFQ7XG59O1xuXG5leHBvcnQgY29uc3QgT2JzZXJ2ZXIgPSBPYnNlcnZhYmlsaXR5TWFuYWdlcjtcbiJdfQ==