"use strict";
/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * DESIGN PRINCIPLES:
 * - Required fields (correlationId, type, level) must be provided - no auto-generation
 * - Never crash the application - log errors and continue
 * - Synchronous initialization from environment
 * - Fire-and-forget capture for non-blocking operation
 *
 * Usage:
 * ```typescript
 * // REQUIRED: Establish context with correlationId first
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Then use observers
 *     SpanObserver.start('operation');
 *     AuditObserver.entityCreate('User', userId, data);
 *   }
 * );
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observer = exports.withObservability = exports.ObservabilityManager = void 0;
const crypto_1 = require("crypto");
const logging_1 = require("../logging");
const types_1 = require("./types");
const config_1 = require("./config");
const level_utils_1 = require("./utils/level-utils");
const source_utils_1 = require("./utils/source-utils");
const context_1 = require("./context");
// Static imports for backends (enables tree-shaking and compile-time type checking)
const cloudwatch_1 = require("./backends/cloudwatch");
const dynamodb_1 = require("./backends/dynamodb");
const otel_1 = require("./backends/otel");
// Import base observer utilities to inject ourselves
const base_1 = require("./observers/base");
const logger = (0, logging_1.createLogger)('ObservabilityManager');
/**
 * ObservabilityManager - core static class for the observability system.
 *
 * For testability, use the IEventCapture interface via base.ts setCapturer().
 * This class's static methods satisfy IEventCapture when wrapped.
 */
class ObservabilityManager {
    static configManager = null;
    static backends = [];
    static invocationCount = 0;
    static initialized = false;
    // Pre-compiled sampling regexes for operation patterns
    static samplingRegexCache = new Map();
    /**
     * Initialize with explicit configuration
     */
    static initialize(config, backends) {
        const fullConfig = new config_1.ConfigManager(config).getAll();
        const errors = (0, config_1.validateConfig)(fullConfig);
        if (errors.length > 0) {
            logger.error('Invalid observability config:', errors);
            throw new Error(`Invalid observability config: ${errors.join(', ')}`);
        }
        this.configManager = new config_1.ConfigManager(config);
        if (backends) {
            this.backends = backends;
        }
        this.initialized = true;
    }
    /**
     * Get current configuration
     * Initializes from environment if not already initialized
     */
    static getConfig() {
        this.ensureInitialized();
        return this.configManager.getAll();
    }
    /**
     * Update configuration at runtime
     */
    static configure(updates) {
        this.ensureInitialized();
        this.configManager.update(updates);
    }
    /**
     * Register a backend
     */
    static registerBackend(backend) {
        if (this.backends.find((b) => b.name === backend.name)) {
            logger.warn(`Backend ${backend.name} already registered`);
            return;
        }
        this.backends.push(backend);
    }
    /**
     * Unregister a backend
     */
    static unregisterBackend(name) {
        this.backends = this.backends.filter((b) => b.name !== name);
    }
    /**
     * Initialize for a new Lambda invocation
     * Called at the start of each invocation
     */
    static initializeInvocation() {
        this.ensureInitialized();
        this.invocationCount++;
        for (const backend of this.backends) {
            try {
                backend.initializeInvocation?.();
            }
            catch (error) {
                logger.error(`Backend ${backend.name} failed to initialize invocation:`, error);
                // Don't throw - continue with other backends
            }
        }
    }
    /**
     * Check if this is a cold start
     */
    static isColdStart() {
        return this.invocationCount === 1;
    }
    /**
     * Get current invocation count
     */
    static getInvocationCount() {
        return this.invocationCount;
    }
    /**
     * Capture an observability event
     *
     * REQUIRED fields (must be in input or context):
     * - type: Event type
     * - level: Severity level
     * - correlationId: From context or explicit
     *
     * @param input - Event input
     * @param options - Capture options (critical, sync)
     * @returns logId if captured, undefined if filtered/sampled out or invalid
     */
    static capture(input, options) {
        try {
            // Validate required fields
            const errors = this.validateInput(input);
            if (errors.length > 0) {
                logger.warn('Invalid capture input:', { errors, type: input.type });
                return undefined;
            }
            const config = this.getConfig();
            if (!config.enabled)
                return undefined;
            // Build complete event
            const event = this.buildEvent(input);
            // Check if should capture (sampling, level) - skip if critical
            if (!options?.critical && !this.shouldCapture(event, config)) {
                return undefined;
            }
            // Get backends for this specific type
            const backends = this.getBackendsForType(event.type);
            // Dispatch to backends (fire-and-forget, batched by flush())
            // Use captureAsync() if you need guaranteed persistence
            this.dispatchToBackends(event, backends);
            return event.logId;
        }
        catch (error) {
            // NEVER crash the application
            logger.error('Unexpected error in capture:', error);
            return undefined;
        }
    }
    /**
     * Capture an observability event asynchronously
     *
     * Use this when you need to await backend completion (e.g., for critical audits).
     *
     * @param input - Event input
     * @param options - Capture options (critical bypasses sampling)
     * @returns Promise<logId> if captured, undefined if filtered/sampled out or invalid
     */
    static async captureAsync(input, options) {
        try {
            const errors = this.validateInput(input);
            if (errors.length > 0) {
                logger.warn('Invalid capture input:', { errors, type: input.type });
                return undefined;
            }
            const config = this.getConfig();
            if (!config.enabled)
                return undefined;
            const event = this.buildEvent(input);
            if (!options?.critical && !this.shouldCapture(event, config)) {
                return undefined;
            }
            const backends = this.getBackendsForType(event.type);
            await this.dispatchToBackendsSync(event, backends);
            return event.logId;
        }
        catch (error) {
            logger.error('Unexpected error in captureAsync:', error);
            return undefined;
        }
    }
    /**
     * Observe an event (alias for capture with Partial<ObservabilityEvent>)
     *
     * This is the primary method for recording observations.
     * Prefer using specialized observers (SpanObserver, AuditObserver, etc.)
     *
     * @param event - Partial event (correlationId, type, level required)
     * @param options - Capture options
     * @returns logId if captured, undefined if filtered/sampled out
     */
    static observe(event, options) {
        const correlationId = event.correlationId ?? (0, context_1.getCorrelationIdIfExists)();
        if (!correlationId) {
            logger.warn('observe() called without correlationId. Establish context with runWithContext() first.');
            return undefined;
        }
        return this.capture({
            ...event,
            correlationId,
            type: event.type,
            level: event.level,
        }, options);
    }
    /**
     * Validate capture input
     */
    static validateInput(input) {
        const errors = [];
        const context = (0, context_1.getCurrentContext)();
        if (!input.type) {
            errors.push({ field: 'type', message: 'type is required' });
        }
        if (!input.level) {
            errors.push({ field: 'level', message: 'level is required' });
        }
        // correlationId must come from input or context
        if (!input.correlationId && !context?.correlationId) {
            errors.push({
                field: 'correlationId',
                message: 'correlationId is required. Establish context with runWithContext() or provide explicitly.'
            });
        }
        return errors;
    }
    /**
     * Build complete event from input
     */
    static buildEvent(input) {
        const context = (0, context_1.getCurrentContext)();
        const now = Date.now();
        // correlationId is validated to exist in either input or context before buildEvent is called
        const correlationId = input.correlationId ?? context?.correlationId;
        if (!correlationId) {
            // This should never happen due to validateInput, but TypeScript needs assurance
            throw new Error('correlationId is required - this should have been caught by validation');
        }
        return {
            // Required fields
            type: input.type,
            level: input.level,
            correlationId,
            timestampMs: input.timestampMs ?? now,
            logId: input.logId ?? (0, crypto_1.randomUUID)(),
            // Context inheritance (input takes precedence)
            parentLogId: input.parentLogId ?? context?.parentLogId,
            actor: input.actor ?? context?.actor,
            source: input.source ?? context?.source ?? (0, source_utils_1.detectSource)(),
            tags: (0, source_utils_1.mergeTags)({ ...context?.tags, ...input.tags }, true),
            // Pass through optional fields
            entityName: input.entityName,
            entityId: input.entityId,
            operation: input.operation,
            subType: input.subType,
            status: input.status,
            success: input.success,
            durationMs: input.durationMs,
            data: input.data,
            attributes: input.attributes,
            metadata: input.metadata,
            metrics: input.metrics,
            context: input.context,
            error: input.error,
        };
    }
    /**
     * Dispatch event to backends (fire-and-forget)
     */
    static dispatchToBackends(event, backends) {
        // Fire-and-forget - don't await
        void Promise.all(backends.map(async (backend) => {
            try {
                // Check backend-specific level filter
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
                // Don't throw - continue with other backends
            }
        }));
    }
    /**
     * Dispatch event to backends (synchronous - waits for completion)
     */
    static async dispatchToBackendsSync(event, backends) {
        await Promise.all(backends.map(async (backend) => {
            try {
                // Check backend-specific level filter
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
                // Don't throw - continue with other backends
            }
        }));
    }
    /**
     * Get backends configured for a specific event type
     */
    static getBackendsForType(type) {
        const typeCategory = this.getTypeCategory(type);
        const typeConfig = this.configManager?.getTypeConfig(typeCategory);
        if (typeConfig?.backends && typeConfig.backends.length > 0) {
            // Use type-specific backends
            return this.backends.filter((b) => typeConfig.backends.includes(b.name));
        }
        // Use all backends
        return this.backends;
    }
    /**
     * Map event type to category
     */
    static getTypeCategory(type) {
        if (type.startsWith('span.'))
            return 'span';
        if (type === 'metric')
            return 'metric';
        if (type.startsWith('audit'))
            return 'audit';
        if (type.startsWith('workflow.'))
            return 'workflow';
        if (type.startsWith('decision'))
            return 'decision';
        if (type.startsWith('access.'))
            return 'access';
        return 'log';
    }
    /**
     * Flush all backends
     * Called before Lambda returns
     */
    static async flush() {
        const flushPromises = this.backends.map(async (backend) => {
            if (backend.flush) {
                try {
                    await backend.flush();
                }
                catch (error) {
                    logger.error(`Failed to flush backend ${backend.name}:`, error);
                    // Don't throw - continue with other backends
                }
            }
        });
        await Promise.all(flushPromises);
    }
    /**
     * Check if event should be captured based on level and sampling
     */
    static shouldCapture(event, config) {
        const levelValue = (0, level_utils_1.stringToLevel)(event.level);
        // Check type-specific level first
        const typeCategory = this.getTypeCategory(event.type);
        const effectiveLevel = this.configManager?.getEffectiveLevelForType(typeCategory) ?? config.minLevel;
        // Level check
        if (levelValue < effectiveLevel) {
            return false;
        }
        // CRITICAL always captured
        if (levelValue === types_1.ObservabilityLevel.CRITICAL) {
            return true;
        }
        // Sampling disabled = capture all
        if (!config.sampling.enabled) {
            return true;
        }
        // Type-specific sampling
        const typeConfig = this.configManager?.getTypeConfig(typeCategory);
        if (typeConfig?.sampling?.enabled) {
            return Math.random() < typeConfig.sampling.rate;
        }
        // Operation-specific sampling (with cached regex)
        if (event.operation && config.sampling.operations) {
            for (const [pattern, rate] of Object.entries(config.sampling.operations)) {
                const regex = this.getOrCreateSamplingRegex(pattern);
                if (regex.test(event.operation)) {
                    return Math.random() < rate;
                }
            }
        }
        // Level-based sampling
        const rate = config.sampling.rates[levelValue];
        if (rate === undefined || rate >= 1)
            return true;
        if (rate <= 0)
            return false;
        return Math.random() < rate;
    }
    /**
     * Initialize from environment (synchronous)
     */
    static ensureInitialized() {
        if (this.initialized)
            return;
        // Parse environment configuration using ConfigManager
        const envConfig = config_1.ConfigManager.fromEnvironment();
        this.configManager = new config_1.ConfigManager(envConfig);
        const config = this.configManager.getAll();
        const minLevel = config.minLevel;
        const backendConfigs = config.backends;
        const backendNames = backendConfigs.map(b => b.type);
        // Initialize backend instances using static imports (enables tree-shaking)
        for (const type of backendNames) {
            try {
                switch (type) {
                    case 'dynamodb':
                        this.backends.push(new dynamodb_1.DynamoDBObservabilityBackend({
                            minLevel,
                            ttlDays: config.dynamodb.ttlDays,
                        }));
                        break;
                    case 'otel':
                        this.backends.push(new otel_1.OTELObservabilityBackend({
                            serviceName: config.serviceName,
                            minLevel,
                        }));
                        break;
                    case 'cloudwatch':
                        this.backends.push(new cloudwatch_1.CloudWatchBackend({
                            serviceName: config.serviceName,
                            minLevel,
                            namespace: config.cloudwatch.namespace,
                        }));
                        break;
                    default:
                        logger.warn(`Unknown backend type: ${type}`);
                }
            }
            catch (error) {
                logger.error(`Failed to initialize backend ${type}:`, error);
            }
        }
        // Default to cloudwatch if no backends configured
        if (this.backends.length === 0) {
            try {
                this.backends.push(new cloudwatch_1.CloudWatchBackend({
                    serviceName: config.serviceName,
                    minLevel,
                    namespace: config.cloudwatch.namespace,
                }));
            }
            catch (error) {
                logger.error('Failed to initialize default CloudWatch backend:', error);
            }
        }
        this.initialized = true;
        // Inject ourselves into base.ts to break circular dependency
        // This allows observers to use capture() without importing manager directly
        (0, base_1.initializeCapturer)({
            capture: (input, options) => this.capture(input, options),
            captureAsync: (input, options) => this.captureAsync(input, options),
        });
    }
    /**
     * Get or create a cached regex for sampling pattern
     */
    static getOrCreateSamplingRegex(pattern) {
        let regex = this.samplingRegexCache.get(pattern);
        if (!regex) {
            regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
            this.samplingRegexCache.set(pattern, regex);
        }
        return regex;
    }
    /**
     * Reset manager state (for testing)
     *
     * IMPORTANT: This also resets the capturer in base.ts to ensure
     * observers can be properly re-initialized in tests.
     */
    static reset() {
        this.configManager = null;
        this.backends = [];
        this.invocationCount = 0;
        this.initialized = false;
        this.samplingRegexCache.clear();
        // Also reset the capturer in base.ts - critical for test isolation
        (0, base_1.resetCapturer)();
    }
    // ============================================
    // CONTEXT CONVENIENCE METHODS
    // These delegate to context.ts but provide a unified API
    // ============================================
    /**
     * Create a new observation context
     *
     * @param correlationId - REQUIRED - the trace/correlation ID
     * @param options - Optional context options
     */
    static createContext(correlationId, options) {
        return (0, context_1.createObservationContext)(correlationId, options);
    }
    /**
     * Get current observation context
     */
    static currentContext() {
        return (0, context_1.getCurrentContext)();
    }
    /**
     * Run a function within an observation context
     *
     * @example
     * ```typescript
     * await Observer.withContext(
     *   Observer.createContext(requestId, { actor }),
     *   async () => {
     *     // All observations here share correlationId
     *   }
     * );
     * ```
     */
    static async withContext(context, fn) {
        return (0, context_1.runWithContext)(context, fn);
    }
    /**
     * Run a function within an observation context (sync)
     */
    static withContextSync(context, fn) {
        return (0, context_1.runWithContextSync)(context, fn);
    }
    /**
     * Set actor on current context
     *
     * Useful when actor becomes available mid-flow (e.g., after authentication)
     */
    static setActor(actor) {
        (0, context_1.setContextActor)(actor);
    }
    /**
     * Add tags to current context
     */
    static addTags(tags) {
        (0, context_1.addContextTags)(tags);
    }
}
exports.ObservabilityManager = ObservabilityManager;
/**
 * Lambda handler wrapper with observability lifecycle management
 *
 * Ensures:
 * - Manager is initialized
 * - Invocation is tracked
 * - Backends are flushed before returning
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
/**
 * Alias for ObservabilityManager
 */
exports.Observer = ObservabilityManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L21hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FxQkc7OztBQUVILG1DQUFvQztBQUNwQyx3Q0FBMEM7QUFFMUMsbUNBVWlCO0FBQ2pCLHFDQUF5RDtBQUN6RCxxREFBb0Q7QUFDcEQsdURBQStEO0FBQy9ELHVDQVFtQjtBQUVuQixvRkFBb0Y7QUFDcEYsc0RBQTBEO0FBQzFELGtEQUFtRTtBQUNuRSwwQ0FBMkQ7QUFFM0QscURBQXFEO0FBQ3JELDJDQUFxRTtBQUVyRSxNQUFNLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsc0JBQXNCLENBQUMsQ0FBQztBQVVwRDs7Ozs7R0FLRztBQUNILE1BQWEsb0JBQW9CO0lBQ3ZCLE1BQU0sQ0FBQyxhQUFhLEdBQXlCLElBQUksQ0FBQztJQUNsRCxNQUFNLENBQUMsUUFBUSxHQUEyQixFQUFFLENBQUM7SUFDN0MsTUFBTSxDQUFDLGVBQWUsR0FBRyxDQUFDLENBQUM7SUFDM0IsTUFBTSxDQUFDLFdBQVcsR0FBRyxLQUFLLENBQUM7SUFFbkMsdURBQXVEO0lBQy9DLE1BQU0sQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUU5RDs7T0FFRztJQUNILE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBb0MsRUFBRSxRQUFpQztRQUN2RixNQUFNLFVBQVUsR0FBRyxJQUFJLHNCQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDdEQsTUFBTSxNQUFNLEdBQUcsSUFBQSx1QkFBYyxFQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzFDLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN0QixNQUFNLENBQUMsS0FBSyxDQUFDLCtCQUErQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ3RELE1B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QUN2QyxJQUFJLENBQUM7WUFDSCxvQkFBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQzVDLE9BQU8sTUFBTSxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUNoQyxDQUFDO2dCQUFTLENBQUM7WUFDVCxNQUFNLG9CQUFvQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDLENBQU0sQ0FBQztBQUNWLENBQUMsQ0FBQztBQVRXLFFBQUEsaUJBQWlCLHFCQVM1QjtBQUVGOztHQUVHO0FBQ1UsUUFBQSxRQUFRLEdBQUcsb0JBQW9CLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE9ic2VydmFiaWxpdHlNYW5hZ2VyIC0gQ29yZSBPYnNlcnZlciBmb3IgdGhlIG9ic2VydmFiaWxpdHkgc3lzdGVtXG4gKiBcbiAqIERFU0lHTiBQUklOQ0lQTEVTOlxuICogLSBSZXF1aXJlZCBmaWVsZHMgKGNvcnJlbGF0aW9uSWQsIHR5cGUsIGxldmVsKSBtdXN0IGJlIHByb3ZpZGVkIC0gbm8gYXV0by1nZW5lcmF0aW9uXG4gKiAtIE5ldmVyIGNyYXNoIHRoZSBhcHBsaWNhdGlvbiAtIGxvZyBlcnJvcnMgYW5kIGNvbnRpbnVlXG4gKiAtIFN5bmNocm9ub3VzIGluaXRpYWxpemF0aW9uIGZyb20gZW52aXJvbm1lbnRcbiAqIC0gRmlyZS1hbmQtZm9yZ2V0IGNhcHR1cmUgZm9yIG5vbi1ibG9ja2luZyBvcGVyYXRpb25cbiAqIFxuICogVXNhZ2U6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBSRVFVSVJFRDogRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBjb3JyZWxhdGlvbklkIGZpcnN0XG4gKiBhd2FpdCBydW5XaXRoQ29udGV4dChcbiAqICAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KHJlcXVlc3RJZCksXG4gKiAgIGFzeW5jICgpID0+IHtcbiAqICAgICAvLyBUaGVuIHVzZSBvYnNlcnZlcnNcbiAqICAgICBTcGFuT2JzZXJ2ZXIuc3RhcnQoJ29wZXJhdGlvbicpO1xuICogICAgIEF1ZGl0T2JzZXJ2ZXIuZW50aXR5Q3JlYXRlKCdVc2VyJywgdXNlcklkLCBkYXRhKTtcbiAqICAgfVxuICogKTtcbiAqIGBgYFxuICovXG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBBY3RvciB9IGZyb20gJy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHtcbiAgQ2FwdHVyZUlucHV0LFxuICBDYXB0dXJlT3B0aW9ucyxcbiAgSUV2ZW50Q2FwdHVyZSxcbiAgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsXG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kQ29uZmlnLFxuICBPYnNlcnZhYmlsaXR5Q29uZmlnLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YXRpb25Db250ZXh0LFxufSBmcm9tICcuL3R5cGVzJztcbmltcG9ydCB7IENvbmZpZ01hbmFnZXIsIHZhbGlkYXRlQ29uZmlnIH0gZnJvbSAnLi9jb25maWcnO1xuaW1wb3J0IHsgc3RyaW5nVG9MZXZlbCB9IGZyb20gJy4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuaW1wb3J0IHsgZGV0ZWN0U291cmNlLCBtZXJnZVRhZ3MgfSBmcm9tICcuL3V0aWxzL3NvdXJjZS11dGlscyc7XG5pbXBvcnQge1xuICBnZXRDdXJyZW50Q29udGV4dCxcbiAgY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0LFxuICBydW5XaXRoQ29udGV4dCxcbiAgcnVuV2l0aENvbnRleHRTeW5jLFxuICBzZXRDb250ZXh0QWN0b3IsXG4gIGFkZENvbnRleHRUYWdzLFxuICBnZXRDb3JyZWxhdGlvbklkSWZFeGlzdHMsXG59IGZyb20gJy4vY29udGV4dCc7XG5cbi8vIFN0YXRpYyBpbXBvcnRzIGZvciBiYWNrZW5kcyAoZW5hYmxlcyB0cmVlLXNoYWtpbmcgYW5kIGNvbXBpbGUtdGltZSB0eXBlIGNoZWNraW5nKVxuaW1wb3J0IHsgQ2xvdWRXYXRjaEJhY2tlbmQgfSBmcm9tICcuL2JhY2tlbmRzL2Nsb3Vkd2F0Y2gnO1xuaW1wb3J0IHsgRHluYW1vREJPYnNlcnZhYmlsaXR5QmFja2VuZCB9IGZyb20gJy4vYmFja2VuZHMvZHluYW1vZGInO1xuaW1wb3J0IHsgT1RFTE9ic2VydmFiaWxpdHlCYWNrZW5kIH0gZnJvbSAnLi9iYWNrZW5kcy9vdGVsJztcblxuLy8gSW1wb3J0IGJhc2Ugb2JzZXJ2ZXIgdXRpbGl0aWVzIHRvIGluamVjdCBvdXJzZWx2ZXNcbmltcG9ydCB7IGluaXRpYWxpemVDYXB0dXJlciwgcmVzZXRDYXB0dXJlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2Jhc2UnO1xuXG5jb25zdCBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ09ic2VydmFiaWxpdHlNYW5hZ2VyJyk7XG5cbi8qKlxuICogVmFsaWRhdGlvbiBlcnJvciBzdHJ1Y3R1cmVcbiAqL1xuaW50ZXJmYWNlIFZhbGlkYXRpb25FcnJvciB7XG4gIGZpZWxkOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqXG4gKiBPYnNlcnZhYmlsaXR5TWFuYWdlciAtIGNvcmUgc3RhdGljIGNsYXNzIGZvciB0aGUgb2JzZXJ2YWJpbGl0eSBzeXN0ZW0uXG4gKiBcbiAqIEZvciB0ZXN0YWJpbGl0eSwgdXNlIHRoZSBJRXZlbnRDYXB0dXJlIGludGVyZmFjZSB2aWEgYmFzZS50cyBzZXRDYXB0dXJlcigpLlxuICogVGhpcyBjbGFzcydzIHN0YXRpYyBtZXRob2RzIHNhdGlzZnkgSUV2ZW50Q2FwdHVyZSB3aGVuIHdyYXBwZWQuXG4gKi9cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5TWFuYWdlciB7XG4gIHByaXZhdGUgc3RhdGljIGNvbmZpZ01hbmFnZXI6IENvbmZpZ01hbmFnZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0aWMgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10gPSBbXTtcbiAgcHJpdmF0ZSBzdGF0aWMgaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgcHJpdmF0ZSBzdGF0aWMgaW5pdGlhbGl6ZWQgPSBmYWxzZTtcblxuICAvLyBQcmUtY29tcGlsZWQgc2FtcGxpbmcgcmVnZXhlcyBmb3Igb3BlcmF0aW9uIHBhdHRlcm5zXG4gIHByaXZhdGUgc3RhdGljIHNhbXBsaW5nUmVnZXhDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBSZWdFeHA+KCk7XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgd2l0aCBleHBsaWNpdCBjb25maWd1cmF0aW9uXG4gICAqL1xuICBzdGF0aWMgaW5pdGlhbGl6ZShjb25maWc6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUNvbmZpZz4sIGJhY2tlbmRzPzogT2JzZXJ2YWJpbGl0eUJhY2tlbmRbXSk6IHZvaWQge1xuICAgIGNvbnN0IGZ1bGxDb25maWcgPSBuZXcgQ29uZmlnTWFuYWdlcihjb25maWcpLmdldEFsbCgpO1xuICAgIGNvbnN0IGVycm9ycyA9IHZhbGlkYXRlQ29uZmlnKGZ1bGxDb25maWcpO1xuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgbG9nZ2VyLmVycm9yKCdJbnZhbGlkIG9ic2VydmFiaWxpdHkgY29uZmlnOicsIGVycm9ycyk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb2JzZXJ2YWJpbGl0eSBjb25maWc6ICR7ZXJyb3JzLmpvaW4oJywgJyl9YCk7XG4gICAgfVxuICAgIHRoaXMuY29uZmlnTWFuYWdlciA9IG5ldyBDb25maWdNYW5hZ2VyKGNvbmZpZyk7XG4gICAgaWYgKGJhY2tlbmRzKSB7XG4gICAgICB0aGlzLmJhY2tlbmRzID0gYmFja2VuZHM7XG4gICAgfVxuICAgIHRoaXMuaW5pdGlhbGl6ZWQgPSB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBjdXJyZW50IGNvbmZpZ3VyYXRpb25cbiAgICogSW5pdGlhbGl6ZXMgZnJvbSBlbnZpcm9ubWVudCBpZiBub3QgYWxyZWFkeSBpbml0aWFsaXplZFxuICAgKi9cbiAgc3RhdGljIGdldENvbmZpZygpOiBPYnNlcnZhYmlsaXR5Q29uZmlnIHtcbiAgICB0aGlzLmVuc3VyZUluaXRpYWxpemVkKCk7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnTWFuYWdlciEuZ2V0QWxsKCk7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGNvbmZpZ3VyYXRpb24gYXQgcnVudGltZVxuICAgKi9cbiAgc3RhdGljIGNvbmZpZ3VyZSh1cGRhdGVzOiBQYXJ0aWFsPE9ic2VydmFiaWxpdHlDb25maWc+KTogdm9pZCB7XG4gICAgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpO1xuICAgIHRoaXMuY29uZmlnTWFuYWdlciEudXBkYXRlKHVwZGF0ZXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgYmFja2VuZFxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyQmFja2VuZChiYWNrZW5kOiBPYnNlcnZhYmlsaXR5QmFja2VuZCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmJhY2tlbmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gYmFja2VuZC5uYW1lKSkge1xuICAgICAgbG9nZ2VyLndhcm4oYEJhY2tlbmQgJHtiYWNrZW5kLm5hbWV9IGFscmVhZHkgcmVnaXN0ZXJlZGApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmJhY2tlbmRzLnB1c2goYmFja2VuZCk7XG4gIH1cblxuICAvKipcbiAgICogVW5yZWdpc3RlciBhIGJhY2tlbmRcbiAgICovXG4gIHN0YXRpYyB1bnJlZ2lzdGVyQmFja2VuZChuYW1lOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmJhY2tlbmRzID0gdGhpcy5iYWNrZW5kcy5maWx0ZXIoKGIpID0+IGIubmFtZSAhPT0gbmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmb3IgYSBuZXcgTGFtYmRhIGludm9jYXRpb25cbiAgICogQ2FsbGVkIGF0IHRoZSBzdGFydCBvZiBlYWNoIGludm9jYXRpb25cbiAgICovXG4gIHN0YXRpYyBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmVuc3VyZUluaXRpYWxpemVkKCk7XG4gICAgdGhpcy5pbnZvY2F0aW9uQ291bnQrKztcblxuICAgIGZvciAoY29uc3QgYmFja2VuZCBvZiB0aGlzLmJhY2tlbmRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBiYWNrZW5kLmluaXRpYWxpemVJbnZvY2F0aW9uPy4oKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxvZ2dlci5lcnJvcihgQmFja2VuZCAke2JhY2tlbmQubmFtZX0gZmFpbGVkIHRvIGluaXRpYWxpemUgaW52b2NhdGlvbjpgLCBlcnJvcik7XG4gICAgICAgIC8vIERvbid0IHRocm93IC0gY29udGludWUgd2l0aCBvdGhlciBiYWNrZW5kc1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiB0aGlzIGlzIGEgY29sZCBzdGFydFxuICAgKi9cbiAgc3RhdGljIGlzQ29sZFN0YXJ0KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmludm9jYXRpb25Db3VudCA9PT0gMTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgY3VycmVudCBpbnZvY2F0aW9uIGNvdW50XG4gICAqL1xuICBzdGF0aWMgZ2V0SW52b2NhdGlvbkNvdW50KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuaW52b2NhdGlvbkNvdW50O1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudFxuICAgKiBcbiAgICogUkVRVUlSRUQgZmllbGRzIChtdXN0IGJlIGluIGlucHV0IG9yIGNvbnRleHQpOlxuICAgKiAtIHR5cGU6IEV2ZW50IHR5cGVcbiAgICogLSBsZXZlbDogU2V2ZXJpdHkgbGV2ZWxcbiAgICogLSBjb3JyZWxhdGlvbklkOiBGcm9tIGNvbnRleHQgb3IgZXhwbGljaXRcbiAgICogXG4gICAqIEBwYXJhbSBpbnB1dCAtIEV2ZW50IGlucHV0XG4gICAqIEBwYXJhbSBvcHRpb25zIC0gQ2FwdHVyZSBvcHRpb25zIChjcml0aWNhbCwgc3luYylcbiAgICogQHJldHVybnMgbG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dCBvciBpbnZhbGlkXG4gICAqL1xuICBzdGF0aWMgY2FwdHVyZShpbnB1dDogQ2FwdHVyZUlucHV0LCBvcHRpb25zPzogQ2FwdHVyZU9wdGlvbnMpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRyeSB7XG4gICAgICAvLyBWYWxpZGF0ZSByZXF1aXJlZCBmaWVsZHNcbiAgICAgIGNvbnN0IGVycm9ycyA9IHRoaXMudmFsaWRhdGVJbnB1dChpbnB1dCk7XG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ0ludmFsaWQgY2FwdHVyZSBpbnB1dDonLCB7IGVycm9ycywgdHlwZTogaW5wdXQudHlwZSB9KTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29uZmlnID0gdGhpcy5nZXRDb25maWcoKTtcbiAgICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIC8vIEJ1aWxkIGNvbXBsZXRlIGV2ZW50XG4gICAgICBjb25zdCBldmVudCA9IHRoaXMuYnVpbGRFdmVudChpbnB1dCk7XG5cbiAgICAgIC8vIENoZWNrIGlmIHNob3VsZCBjYXB0dXJlIChzYW1wbGluZywgbGV2ZWwpIC0gc2tpcCBpZiBjcml0aWNhbFxuICAgICAgaWYgKCFvcHRpb25zPy5jcml0aWNhbCAmJiAhdGhpcy5zaG91bGRDYXB0dXJlKGV2ZW50LCBjb25maWcpKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEdldCBiYWNrZW5kcyBmb3IgdGhpcyBzcGVjaWZpYyB0eXBlXG4gICAgICBjb25zdCBiYWNrZW5kcyA9IHRoaXMuZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuXG4gICAgICAvLyBEaXNwYXRjaCB0byBiYWNrZW5kcyAoZmlyZS1hbmQtZm9yZ2V0LCBiYXRjaGVkIGJ5IGZsdXNoKCkpXG4gICAgICAvLyBVc2UgY2FwdHVyZUFzeW5jKCkgaWYgeW91IG5lZWQgZ3VhcmFudGVlZCBwZXJzaXN0ZW5jZVxuICAgICAgdGhpcy5kaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQsIGJhY2tlbmRzKTtcblxuICAgICAgcmV0dXJuIGV2ZW50LmxvZ0lkO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBORVZFUiBjcmFzaCB0aGUgYXBwbGljYXRpb25cbiAgICAgIGxvZ2dlci5lcnJvcignVW5leHBlY3RlZCBlcnJvciBpbiBjYXB0dXJlOicsIGVycm9yKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmUgYW4gb2JzZXJ2YWJpbGl0eSBldmVudCBhc3luY2hyb25vdXNseVxuICAgKiBcbiAgICogVXNlIHRoaXMgd2hlbiB5b3UgbmVlZCB0byBhd2FpdCBiYWNrZW5kIGNvbXBsZXRpb24gKGUuZy4sIGZvciBjcml0aWNhbCBhdWRpdHMpLlxuICAgKiBcbiAgICogQHBhcmFtIGlucHV0IC0gRXZlbnQgaW5wdXRcbiAgICogQHBhcmFtIG9wdGlvbnMgLSBDYXB0dXJlIG9wdGlvbnMgKGNyaXRpY2FsIGJ5cGFzc2VzIHNhbXBsaW5nKVxuICAgKiBAcmV0dXJucyBQcm9taXNlPGxvZ0lkPiBpZiBjYXB0dXJlZCwgdW5kZWZpbmVkIGlmIGZpbHRlcmVkL3NhbXBsZWQgb3V0IG9yIGludmFsaWRcbiAgICovXG4gIHN0YXRpYyBhc3luYyBjYXB0dXJlQXN5bmMoaW5wdXQ6IENhcHR1cmVJbnB1dCwgb3B0aW9ucz86IE9taXQ8Q2FwdHVyZU9wdGlvbnMsICdzeW5jJz4pOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSB0aGlzLnZhbGlkYXRlSW5wdXQoaW5wdXQpO1xuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdJbnZhbGlkIGNhcHR1cmUgaW5wdXQ6JywgeyBlcnJvcnMsIHR5cGU6IGlucHV0LnR5cGUgfSk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuZ2V0Q29uZmlnKCk7XG4gICAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBldmVudCA9IHRoaXMuYnVpbGRFdmVudChpbnB1dCk7XG5cbiAgICAgIGlmICghb3B0aW9ucz8uY3JpdGljYWwgJiYgIXRoaXMuc2hvdWxkQ2FwdHVyZShldmVudCwgY29uZmlnKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBiYWNrZW5kcyA9IHRoaXMuZ2V0QmFja2VuZHNGb3JUeXBlKGV2ZW50LnR5cGUpO1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50LCBiYWNrZW5kcyk7XG5cbiAgICAgIHJldHVybiBldmVudC5sb2dJZDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbG9nZ2VyLmVycm9yKCdVbmV4cGVjdGVkIGVycm9yIGluIGNhcHR1cmVBc3luYzonLCBlcnJvcik7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBPYnNlcnZlIGFuIGV2ZW50IChhbGlhcyBmb3IgY2FwdHVyZSB3aXRoIFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PilcbiAgICogXG4gICAqIFRoaXMgaXMgdGhlIHByaW1hcnkgbWV0aG9kIGZvciByZWNvcmRpbmcgb2JzZXJ2YXRpb25zLlxuICAgKiBQcmVmZXIgdXNpbmcgc3BlY2lhbGl6ZWQgb2JzZXJ2ZXJzIChTcGFuT2JzZXJ2ZXIsIEF1ZGl0T2JzZXJ2ZXIsIGV0Yy4pXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBQYXJ0aWFsIGV2ZW50IChjb3JyZWxhdGlvbklkLCB0eXBlLCBsZXZlbCByZXF1aXJlZClcbiAgICogQHBhcmFtIG9wdGlvbnMgLSBDYXB0dXJlIG9wdGlvbnNcbiAgICogQHJldHVybnMgbG9nSWQgaWYgY2FwdHVyZWQsIHVuZGVmaW5lZCBpZiBmaWx0ZXJlZC9zYW1wbGVkIG91dFxuICAgKi9cbiAgc3RhdGljIG9ic2VydmUoXG4gICAgZXZlbnQ6IFBhcnRpYWw8T2JzZXJ2YWJpbGl0eUV2ZW50PiAmIHsgdHlwZTogc3RyaW5nOyBsZXZlbDogc3RyaW5nOyBjb3JyZWxhdGlvbklkPzogc3RyaW5nIH0sXG4gICAgb3B0aW9ucz86IENhcHR1cmVPcHRpb25zXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgY29ycmVsYXRpb25JZCA9IGV2ZW50LmNvcnJlbGF0aW9uSWQgPz8gZ2V0Q29ycmVsYXRpb25JZElmRXhpc3RzKCk7XG5cbiAgICBpZiAoIWNvcnJlbGF0aW9uSWQpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdvYnNlcnZlKCkgY2FsbGVkIHdpdGhvdXQgY29ycmVsYXRpb25JZC4gRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBydW5XaXRoQ29udGV4dCgpIGZpcnN0LicpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5jYXB0dXJlKHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUgYXMgQ2FwdHVyZUlucHV0WyAndHlwZScgXSxcbiAgICAgIGxldmVsOiBldmVudC5sZXZlbCBhcyBDYXB0dXJlSW5wdXRbICdsZXZlbCcgXSxcbiAgICB9LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZSBjYXB0dXJlIGlucHV0XG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyB2YWxpZGF0ZUlucHV0KGlucHV0OiBDYXB0dXJlSW5wdXQpOiBWYWxpZGF0aW9uRXJyb3JbXSB7XG4gICAgY29uc3QgZXJyb3JzOiBWYWxpZGF0aW9uRXJyb3JbXSA9IFtdO1xuICAgIGNvbnN0IGNvbnRleHQgPSBnZXRDdXJyZW50Q29udGV4dCgpO1xuXG4gICAgaWYgKCFpbnB1dC50eXBlKSB7XG4gICAgICBlcnJvcnMucHVzaCh7IGZpZWxkOiAndHlwZScsIG1lc3NhZ2U6ICd0eXBlIGlzIHJlcXVpcmVkJyB9KTtcbiAgICB9XG5cbiAgICBpZiAoIWlucHV0LmxldmVsKSB7XG4gICAgICBlcnJvcnMucHVzaCh7IGZpZWxkOiAnbGV2ZWwnLCBtZXNzYWdlOiAnbGV2ZWwgaXMgcmVxdWlyZWQnIH0pO1xuICAgIH1cblxuICAgIC8vIGNvcnJlbGF0aW9uSWQgbXVzdCBjb21lIGZyb20gaW5wdXQgb3IgY29udGV4dFxuICAgIGlmICghaW5wdXQuY29ycmVsYXRpb25JZCAmJiAhY29udGV4dD8uY29ycmVsYXRpb25JZCkge1xuICAgICAgZXJyb3JzLnB1c2goe1xuICAgICAgICBmaWVsZDogJ2NvcnJlbGF0aW9uSWQnLFxuICAgICAgICBtZXNzYWdlOiAnY29ycmVsYXRpb25JZCBpcyByZXF1aXJlZC4gRXN0YWJsaXNoIGNvbnRleHQgd2l0aCBydW5XaXRoQ29udGV4dCgpIG9yIHByb3ZpZGUgZXhwbGljaXRseS4nXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXJyb3JzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGNvbXBsZXRlIGV2ZW50IGZyb20gaW5wdXRcbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGJ1aWxkRXZlbnQoaW5wdXQ6IENhcHR1cmVJbnB1dCk6IE9ic2VydmFiaWxpdHlFdmVudCB7XG4gICAgY29uc3QgY29udGV4dCA9IGdldEN1cnJlbnRDb250ZXh0KCk7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcblxuICAgIC8vIGNvcnJlbGF0aW9uSWQgaXMgdmFsaWRhdGVkIHRvIGV4aXN0IGluIGVpdGhlciBpbnB1dCBvciBjb250ZXh0IGJlZm9yZSBidWlsZEV2ZW50IGlzIGNhbGxlZFxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBpbnB1dC5jb3JyZWxhdGlvbklkID8/IGNvbnRleHQ/LmNvcnJlbGF0aW9uSWQ7XG4gICAgaWYgKCFjb3JyZWxhdGlvbklkKSB7XG4gICAgICAvLyBUaGlzIHNob3VsZCBuZXZlciBoYXBwZW4gZHVlIHRvIHZhbGlkYXRlSW5wdXQsIGJ1dCBUeXBlU2NyaXB0IG5lZWRzIGFzc3VyYW5jZVxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdjb3JyZWxhdGlvbklkIGlzIHJlcXVpcmVkIC0gdGhpcyBzaG91bGQgaGF2ZSBiZWVuIGNhdWdodCBieSB2YWxpZGF0aW9uJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC8vIFJlcXVpcmVkIGZpZWxkc1xuICAgICAgdHlwZTogaW5wdXQudHlwZSxcbiAgICAgIGxldmVsOiBpbnB1dC5sZXZlbCxcbiAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB0aW1lc3RhbXBNczogaW5wdXQudGltZXN0YW1wTXMgPz8gbm93LFxuICAgICAgbG9nSWQ6IGlucHV0LmxvZ0lkID8/IHJhbmRvbVVVSUQoKSxcblxuICAgICAgLy8gQ29udGV4dCBpbmhlcml0YW5jZSAoaW5wdXQgdGFrZXMgcHJlY2VkZW5jZSlcbiAgICAgIHBhcmVudExvZ0lkOiBpbnB1dC5wYXJlbnRMb2dJZCA/PyBjb250ZXh0Py5wYXJlbnRMb2dJZCxcbiAgICAgIGFjdG9yOiBpbnB1dC5hY3RvciA/PyBjb250ZXh0Py5hY3RvcixcbiAgICAgIHNvdXJjZTogaW5wdXQuc291cmNlID8/IGNvbnRleHQ/LnNvdXJjZSA/PyBkZXRlY3RTb3VyY2UoKSxcbiAgICAgIHRhZ3M6IG1lcmdlVGFncyh7IC4uLmNvbnRleHQ/LnRhZ3MsIC4uLmlucHV0LnRhZ3MgfSwgdHJ1ZSksXG5cbiAgICAgIC8vIFBhc3MgdGhyb3VnaCBvcHRpb25hbCBmaWVsZHNcbiAgICAgIGVudGl0eU5hbWU6IGlucHV0LmVudGl0eU5hbWUsXG4gICAgICBlbnRpdHlJZDogaW5wdXQuZW50aXR5SWQsXG4gICAgICBvcGVyYXRpb246IGlucHV0Lm9wZXJhdGlvbixcbiAgICAgIHN1YlR5cGU6IGlucHV0LnN1YlR5cGUsXG4gICAgICBzdGF0dXM6IGlucHV0LnN0YXR1cyxcbiAgICAgIHN1Y2Nlc3M6IGlucHV0LnN1Y2Nlc3MsXG4gICAgICBkdXJhdGlvbk1zOiBpbnB1dC5kdXJhdGlvbk1zLFxuICAgICAgZGF0YTogaW5wdXQuZGF0YSxcbiAgICAgIGF0dHJpYnV0ZXM6IGlucHV0LmF0dHJpYnV0ZXMsXG4gICAgICBtZXRhZGF0YTogaW5wdXQubWV0YWRhdGEsXG4gICAgICBtZXRyaWNzOiBpbnB1dC5tZXRyaWNzLFxuICAgICAgY29udGV4dDogaW5wdXQuY29udGV4dCxcbiAgICAgIGVycm9yOiBpbnB1dC5lcnJvcixcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIERpc3BhdGNoIGV2ZW50IHRvIGJhY2tlbmRzIChmaXJlLWFuZC1mb3JnZXQpXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBkaXNwYXRjaFRvQmFja2VuZHMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgYmFja2VuZHM6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10pOiB2b2lkIHtcbiAgICAvLyBGaXJlLWFuZC1mb3JnZXQgLSBkb24ndCBhd2FpdFxuICAgIHZvaWQgUHJvbWlzZS5hbGwoXG4gICAgICBiYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBDaGVjayBiYWNrZW5kLXNwZWNpZmljIGxldmVsIGZpbHRlclxuICAgICAgICAgIGlmIChiYWNrZW5kLm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50TGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcbiAgICAgICAgICAgIGlmIChldmVudExldmVsIDwgYmFja2VuZC5taW5MZXZlbCkge1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2FwdHVyZSBpbiBiYWNrZW5kICR7YmFja2VuZC5uYW1lfTpgLCBlcnJvcik7XG4gICAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBjb250aW51ZSB3aXRoIG90aGVyIGJhY2tlbmRzXG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogRGlzcGF0Y2ggZXZlbnQgdG8gYmFja2VuZHMgKHN5bmNocm9ub3VzIC0gd2FpdHMgZm9yIGNvbXBsZXRpb24pXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBhc3luYyBkaXNwYXRjaFRvQmFja2VuZHNTeW5jKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIGJhY2tlbmRzOiBPYnNlcnZhYmlsaXR5QmFja2VuZFtdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICBiYWNrZW5kcy5tYXAoYXN5bmMgKGJhY2tlbmQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBDaGVjayBiYWNrZW5kLXNwZWNpZmljIGxldmVsIGZpbHRlclxuICAgICAgICAgIGlmIChiYWNrZW5kLm1pbkxldmVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IGV2ZW50TGV2ZWwgPSBzdHJpbmdUb0xldmVsKGV2ZW50LmxldmVsKTtcbiAgICAgICAgICAgIGlmIChldmVudExldmVsIDwgYmFja2VuZC5taW5MZXZlbCkge1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IGJhY2tlbmQuY2FwdHVyZShldmVudCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgbG9nZ2VyLmVycm9yKGBGYWlsZWQgdG8gY2FwdHVyZSBpbiBiYWNrZW5kICR7YmFja2VuZC5uYW1lfTpgLCBlcnJvcik7XG4gICAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBjb250aW51ZSB3aXRoIG90aGVyIGJhY2tlbmRzXG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGJhY2tlbmRzIGNvbmZpZ3VyZWQgZm9yIGEgc3BlY2lmaWMgZXZlbnQgdHlwZVxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0QmFja2VuZHNGb3JUeXBlKHR5cGU6IHN0cmluZyk6IE9ic2VydmFiaWxpdHlCYWNrZW5kW10ge1xuICAgIGNvbnN0IHR5cGVDYXRlZ29yeSA9IHRoaXMuZ2V0VHlwZUNhdGVnb3J5KHR5cGUpO1xuICAgIGNvbnN0IHR5cGVDb25maWcgPSB0aGlzLmNvbmZpZ01hbmFnZXI/LmdldFR5cGVDb25maWcodHlwZUNhdGVnb3J5KTtcblxuICAgIGlmICh0eXBlQ29uZmlnPy5iYWNrZW5kcyAmJiB0eXBlQ29uZmlnLmJhY2tlbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIFVzZSB0eXBlLXNwZWNpZmljIGJhY2tlbmRzXG4gICAgICByZXR1cm4gdGhpcy5iYWNrZW5kcy5maWx0ZXIoKGIpID0+IHR5cGVDb25maWcuYmFja2VuZHMhLmluY2x1ZGVzKGIubmFtZSBhcyAnY2xvdWR3YXRjaCcgfCAnZHluYW1vZGInIHwgJ290ZWwnKSk7XG4gICAgfVxuXG4gICAgLy8gVXNlIGFsbCBiYWNrZW5kc1xuICAgIHJldHVybiB0aGlzLmJhY2tlbmRzO1xuICB9XG5cbiAgLyoqXG4gICAqIE1hcCBldmVudCB0eXBlIHRvIGNhdGVnb3J5XG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBnZXRUeXBlQ2F0ZWdvcnkodHlwZTogc3RyaW5nKToga2V5b2YgTm9uTnVsbGFibGU8T2JzZXJ2YWJpbGl0eUNvbmZpZ1sgJ3R5cGVzJyBdPiB7XG4gICAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnc3Bhbi4nKSkgcmV0dXJuICdzcGFuJztcbiAgICBpZiAodHlwZSA9PT0gJ21ldHJpYycpIHJldHVybiAnbWV0cmljJztcbiAgICBpZiAodHlwZS5zdGFydHNXaXRoKCdhdWRpdCcpKSByZXR1cm4gJ2F1ZGl0JztcbiAgICBpZiAodHlwZS5zdGFydHNXaXRoKCd3b3JrZmxvdy4nKSkgcmV0dXJuICd3b3JrZmxvdyc7XG4gICAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnZGVjaXNpb24nKSkgcmV0dXJuICdkZWNpc2lvbic7XG4gICAgaWYgKHR5cGUuc3RhcnRzV2l0aCgnYWNjZXNzLicpKSByZXR1cm4gJ2FjY2Vzcyc7XG4gICAgcmV0dXJuICdsb2cnO1xuICB9XG5cbiAgLyoqXG4gICAqIEZsdXNoIGFsbCBiYWNrZW5kc1xuICAgKiBDYWxsZWQgYmVmb3JlIExhbWJkYSByZXR1cm5zXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmx1c2hQcm9taXNlcyA9IHRoaXMuYmFja2VuZHMubWFwKGFzeW5jIChiYWNrZW5kKSA9PiB7XG4gICAgICBpZiAoYmFja2VuZC5mbHVzaCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IGJhY2tlbmQuZmx1c2goKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBmbHVzaCBiYWNrZW5kICR7YmFja2VuZC5uYW1lfTpgLCBlcnJvcik7XG4gICAgICAgICAgLy8gRG9uJ3QgdGhyb3cgLSBjb250aW51ZSB3aXRoIG90aGVyIGJhY2tlbmRzXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKGZsdXNoUHJvbWlzZXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGV2ZW50IHNob3VsZCBiZSBjYXB0dXJlZCBiYXNlZCBvbiBsZXZlbCBhbmQgc2FtcGxpbmdcbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHNob3VsZENhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCwgY29uZmlnOiBPYnNlcnZhYmlsaXR5Q29uZmlnKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbGV2ZWxWYWx1ZSA9IHN0cmluZ1RvTGV2ZWwoZXZlbnQubGV2ZWwpO1xuXG4gICAgLy8gQ2hlY2sgdHlwZS1zcGVjaWZpYyBsZXZlbCBmaXJzdFxuICAgIGNvbnN0IHR5cGVDYXRlZ29yeSA9IHRoaXMuZ2V0VHlwZUNhdGVnb3J5KGV2ZW50LnR5cGUpO1xuICAgIGNvbnN0IGVmZmVjdGl2ZUxldmVsID0gdGhpcy5jb25maWdNYW5hZ2VyPy5nZXRFZmZlY3RpdmVMZXZlbEZvclR5cGUodHlwZUNhdGVnb3J5KSA/PyBjb25maWcubWluTGV2ZWw7XG5cbiAgICAvLyBMZXZlbCBjaGVja1xuICAgIGlmIChsZXZlbFZhbHVlIDwgZWZmZWN0aXZlTGV2ZWwpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBDUklUSUNBTCBhbHdheXMgY2FwdHVyZWRcbiAgICBpZiAobGV2ZWxWYWx1ZSA9PT0gT2JzZXJ2YWJpbGl0eUxldmVsLkNSSVRJQ0FMKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBTYW1wbGluZyBkaXNhYmxlZCA9IGNhcHR1cmUgYWxsXG4gICAgaWYgKCFjb25maWcuc2FtcGxpbmcuZW5hYmxlZCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gVHlwZS1zcGVjaWZpYyBzYW1wbGluZ1xuICAgIGNvbnN0IHR5cGVDb25maWcgPSB0aGlzLmNvbmZpZ01hbmFnZXI/LmdldFR5cGVDb25maWcodHlwZUNhdGVnb3J5KTtcbiAgICBpZiAodHlwZUNvbmZpZz8uc2FtcGxpbmc/LmVuYWJsZWQpIHtcbiAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgdHlwZUNvbmZpZy5zYW1wbGluZy5yYXRlO1xuICAgIH1cblxuICAgIC8vIE9wZXJhdGlvbi1zcGVjaWZpYyBzYW1wbGluZyAod2l0aCBjYWNoZWQgcmVnZXgpXG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbiAmJiBjb25maWcuc2FtcGxpbmcub3BlcmF0aW9ucykge1xuICAgICAgZm9yIChjb25zdCBbIHBhdHRlcm4sIHJhdGUgXSBvZiBPYmplY3QuZW50cmllcyhjb25maWcuc2FtcGxpbmcub3BlcmF0aW9ucykpIHtcbiAgICAgICAgY29uc3QgcmVnZXggPSB0aGlzLmdldE9yQ3JlYXRlU2FtcGxpbmdSZWdleChwYXR0ZXJuKTtcbiAgICAgICAgaWYgKHJlZ2V4LnRlc3QoZXZlbnQub3BlcmF0aW9uKSkge1xuICAgICAgICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgcmF0ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExldmVsLWJhc2VkIHNhbXBsaW5nXG4gICAgY29uc3QgcmF0ZSA9IGNvbmZpZy5zYW1wbGluZy5yYXRlc1sgbGV2ZWxWYWx1ZSBdO1xuICAgIGlmIChyYXRlID09PSB1bmRlZmluZWQgfHwgcmF0ZSA+PSAxKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAocmF0ZSA8PSAwKSByZXR1cm4gZmFsc2U7XG5cbiAgICByZXR1cm4gTWF0aC5yYW5kb20oKSA8IHJhdGU7XG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBmcm9tIGVudmlyb25tZW50IChzeW5jaHJvbm91cylcbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGVuc3VyZUluaXRpYWxpemVkKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmluaXRpYWxpemVkKSByZXR1cm47XG5cbiAgICAvLyBQYXJzZSBlbnZpcm9ubWVudCBjb25maWd1cmF0aW9uIHVzaW5nIENvbmZpZ01hbmFnZXJcbiAgICBjb25zdCBlbnZDb25maWcgPSBDb25maWdNYW5hZ2VyLmZyb21FbnZpcm9ubWVudCgpO1xuICAgIHRoaXMuY29uZmlnTWFuYWdlciA9IG5ldyBDb25maWdNYW5hZ2VyKGVudkNvbmZpZyk7XG5cbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZ01hbmFnZXIuZ2V0QWxsKCk7XG4gICAgY29uc3QgbWluTGV2ZWwgPSBjb25maWcubWluTGV2ZWw7XG4gICAgY29uc3QgYmFja2VuZENvbmZpZ3MgPSBjb25maWcuYmFja2VuZHM7XG4gICAgY29uc3QgYmFja2VuZE5hbWVzID0gYmFja2VuZENvbmZpZ3MubWFwKGIgPT4gYi50eXBlKTtcblxuICAgIC8vIEluaXRpYWxpemUgYmFja2VuZCBpbnN0YW5jZXMgdXNpbmcgc3RhdGljIGltcG9ydHMgKGVuYWJsZXMgdHJlZS1zaGFraW5nKVxuICAgIGZvciAoY29uc3QgdHlwZSBvZiBiYWNrZW5kTmFtZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgIGNhc2UgJ2R5bmFtb2RiJzpcbiAgICAgICAgICAgIHRoaXMuYmFja2VuZHMucHVzaChcbiAgICAgICAgICAgICAgbmV3IER5bmFtb0RCT2JzZXJ2YWJpbGl0eUJhY2tlbmQoe1xuICAgICAgICAgICAgICAgIG1pbkxldmVsLFxuICAgICAgICAgICAgICAgIHR0bERheXM6IGNvbmZpZy5keW5hbW9kYi50dGxEYXlzLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdvdGVsJzpcbiAgICAgICAgICAgIHRoaXMuYmFja2VuZHMucHVzaChcbiAgICAgICAgICAgICAgbmV3IE9URUxPYnNlcnZhYmlsaXR5QmFja2VuZCh7XG4gICAgICAgICAgICAgICAgc2VydmljZU5hbWU6IGNvbmZpZy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICAgICAgICBtaW5MZXZlbCxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgY2FzZSAnY2xvdWR3YXRjaCc6XG4gICAgICAgICAgICB0aGlzLmJhY2tlbmRzLnB1c2goXG4gICAgICAgICAgICAgIG5ldyBDbG91ZFdhdGNoQmFja2VuZCh7XG4gICAgICAgICAgICAgICAgc2VydmljZU5hbWU6IGNvbmZpZy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICAgICAgICBtaW5MZXZlbCxcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6IGNvbmZpZy5jbG91ZHdhdGNoLm5hbWVzcGFjZSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIGxvZ2dlci53YXJuKGBVbmtub3duIGJhY2tlbmQgdHlwZTogJHt0eXBlfWApO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoYEZhaWxlZCB0byBpbml0aWFsaXplIGJhY2tlbmQgJHt0eXBlfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCB0byBjbG91ZHdhdGNoIGlmIG5vIGJhY2tlbmRzIGNvbmZpZ3VyZWRcbiAgICBpZiAodGhpcy5iYWNrZW5kcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuYmFja2VuZHMucHVzaChcbiAgICAgICAgICBuZXcgQ2xvdWRXYXRjaEJhY2tlbmQoe1xuICAgICAgICAgICAgc2VydmljZU5hbWU6IGNvbmZpZy5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICAgIG1pbkxldmVsLFxuICAgICAgICAgICAgbmFtZXNwYWNlOiBjb25maWcuY2xvdWR3YXRjaC5uYW1lc3BhY2UsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBpbml0aWFsaXplIGRlZmF1bHQgQ2xvdWRXYXRjaCBiYWNrZW5kOicsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmluaXRpYWxpemVkID0gdHJ1ZTtcblxuICAgIC8vIEluamVjdCBvdXJzZWx2ZXMgaW50byBiYXNlLnRzIHRvIGJyZWFrIGNpcmN1bGFyIGRlcGVuZGVuY3lcbiAgICAvLyBUaGlzIGFsbG93cyBvYnNlcnZlcnMgdG8gdXNlIGNhcHR1cmUoKSB3aXRob3V0IGltcG9ydGluZyBtYW5hZ2VyIGRpcmVjdGx5XG4gICAgaW5pdGlhbGl6ZUNhcHR1cmVyKHtcbiAgICAgIGNhcHR1cmU6IChpbnB1dCwgb3B0aW9ucykgPT4gdGhpcy5jYXB0dXJlKGlucHV0LCBvcHRpb25zKSxcbiAgICAgIGNhcHR1cmVBc3luYzogKGlucHV0LCBvcHRpb25zKSA9PiB0aGlzLmNhcHR1cmVBc3luYyhpbnB1dCwgb3B0aW9ucyksXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IG9yIGNyZWF0ZSBhIGNhY2hlZCByZWdleCBmb3Igc2FtcGxpbmcgcGF0dGVyblxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0T3JDcmVhdGVTYW1wbGluZ1JlZ2V4KHBhdHRlcm46IHN0cmluZyk6IFJlZ0V4cCB7XG4gICAgbGV0IHJlZ2V4ID0gdGhpcy5zYW1wbGluZ1JlZ2V4Q2FjaGUuZ2V0KHBhdHRlcm4pO1xuICAgIGlmICghcmVnZXgpIHtcbiAgICAgIHJlZ2V4ID0gbmV3IFJlZ0V4cChgXiR7cGF0dGVybi5yZXBsYWNlKC9cXCovZywgJy4qJyl9JGApO1xuICAgICAgdGhpcy5zYW1wbGluZ1JlZ2V4Q2FjaGUuc2V0KHBhdHRlcm4sIHJlZ2V4KTtcbiAgICB9XG4gICAgcmV0dXJuIHJlZ2V4O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0IG1hbmFnZXIgc3RhdGUgKGZvciB0ZXN0aW5nKVxuICAgKiBcbiAgICogSU1QT1JUQU5UOiBUaGlzIGFsc28gcmVzZXRzIHRoZSBjYXB0dXJlciBpbiBiYXNlLnRzIHRvIGVuc3VyZVxuICAgKiBvYnNlcnZlcnMgY2FuIGJlIHByb3Blcmx5IHJlLWluaXRpYWxpemVkIGluIHRlc3RzLlxuICAgKi9cbiAgc3RhdGljIHJlc2V0KCk6IHZvaWQge1xuICAgIHRoaXMuY29uZmlnTWFuYWdlciA9IG51bGw7XG4gICAgdGhpcy5iYWNrZW5kcyA9IFtdO1xuICAgIHRoaXMuaW52b2NhdGlvbkNvdW50ID0gMDtcbiAgICB0aGlzLmluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgdGhpcy5zYW1wbGluZ1JlZ2V4Q2FjaGUuY2xlYXIoKTtcblxuICAgIC8vIEFsc28gcmVzZXQgdGhlIGNhcHR1cmVyIGluIGJhc2UudHMgLSBjcml0aWNhbCBmb3IgdGVzdCBpc29sYXRpb25cbiAgICByZXNldENhcHR1cmVyKCk7XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBDT05URVhUIENPTlZFTklFTkNFIE1FVEhPRFNcbiAgLy8gVGhlc2UgZGVsZWdhdGUgdG8gY29udGV4dC50cyBidXQgcHJvdmlkZSBhIHVuaWZpZWQgQVBJXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5ldyBvYnNlcnZhdGlvbiBjb250ZXh0XG4gICAqIFxuICAgKiBAcGFyYW0gY29ycmVsYXRpb25JZCAtIFJFUVVJUkVEIC0gdGhlIHRyYWNlL2NvcnJlbGF0aW9uIElEXG4gICAqIEBwYXJhbSBvcHRpb25zIC0gT3B0aW9uYWwgY29udGV4dCBvcHRpb25zXG4gICAqL1xuICBzdGF0aWMgY3JlYXRlQ29udGV4dChcbiAgICBjb3JyZWxhdGlvbklkOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IHtcbiAgICAgIHBhcmVudExvZ0lkPzogc3RyaW5nO1xuICAgICAgYWN0b3I/OiBBY3RvcjtcbiAgICAgIHRhZ3M/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgICAgc291cmNlPzogc3RyaW5nO1xuICAgIH1cbiAgKTogT2JzZXJ2YXRpb25Db250ZXh0IHtcbiAgICByZXR1cm4gY3JlYXRlT2JzZXJ2YXRpb25Db250ZXh0KGNvcnJlbGF0aW9uSWQsIG9wdGlvbnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBjdXJyZW50IG9ic2VydmF0aW9uIGNvbnRleHRcbiAgICovXG4gIHN0YXRpYyBjdXJyZW50Q29udGV4dCgpOiBPYnNlcnZhdGlvbkNvbnRleHQgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiBnZXRDdXJyZW50Q29udGV4dCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1biBhIGZ1bmN0aW9uIHdpdGhpbiBhbiBvYnNlcnZhdGlvbiBjb250ZXh0XG4gICAqIFxuICAgKiBAZXhhbXBsZVxuICAgKiBgYGB0eXBlc2NyaXB0XG4gICAqIGF3YWl0IE9ic2VydmVyLndpdGhDb250ZXh0KFxuICAgKiAgIE9ic2VydmVyLmNyZWF0ZUNvbnRleHQocmVxdWVzdElkLCB7IGFjdG9yIH0pLFxuICAgKiAgIGFzeW5jICgpID0+IHtcbiAgICogICAgIC8vIEFsbCBvYnNlcnZhdGlvbnMgaGVyZSBzaGFyZSBjb3JyZWxhdGlvbklkXG4gICAqICAgfVxuICAgKiApO1xuICAgKiBgYGBcbiAgICovXG4gIHN0YXRpYyBhc3luYyB3aXRoQ29udGV4dDxUPihcbiAgICBjb250ZXh0OiBPYnNlcnZhdGlvbkNvbnRleHQsXG4gICAgZm46ICgpID0+IFByb21pc2U8VD5cbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgcmV0dXJuIHJ1bldpdGhDb250ZXh0KGNvbnRleHQsIGZuKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW4gYSBmdW5jdGlvbiB3aXRoaW4gYW4gb2JzZXJ2YXRpb24gY29udGV4dCAoc3luYylcbiAgICovXG4gIHN0YXRpYyB3aXRoQ29udGV4dFN5bmM8VD4oXG4gICAgY29udGV4dDogT2JzZXJ2YXRpb25Db250ZXh0LFxuICAgIGZuOiAoKSA9PiBUXG4gICk6IFQge1xuICAgIHJldHVybiBydW5XaXRoQ29udGV4dFN5bmMoY29udGV4dCwgZm4pO1xuICB9XG5cbiAgLyoqXG4gICAqIFNldCBhY3RvciBvbiBjdXJyZW50IGNvbnRleHRcbiAgICogXG4gICAqIFVzZWZ1bCB3aGVuIGFjdG9yIGJlY29tZXMgYXZhaWxhYmxlIG1pZC1mbG93IChlLmcuLCBhZnRlciBhdXRoZW50aWNhdGlvbilcbiAgICovXG4gIHN0YXRpYyBzZXRBY3RvcihhY3RvcjogQWN0b3IpOiB2b2lkIHtcbiAgICBzZXRDb250ZXh0QWN0b3IoYWN0b3IpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCB0YWdzIHRvIGN1cnJlbnQgY29udGV4dFxuICAgKi9cbiAgc3RhdGljIGFkZFRhZ3ModGFnczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IHZvaWQge1xuICAgIGFkZENvbnRleHRUYWdzKHRhZ3MpO1xuICB9XG59XG5cbi8qKlxuICogTGFtYmRhIGhhbmRsZXIgd3JhcHBlciB3aXRoIG9ic2VydmFiaWxpdHkgbGlmZWN5Y2xlIG1hbmFnZW1lbnRcbiAqIFxuICogRW5zdXJlczpcbiAqIC0gTWFuYWdlciBpcyBpbml0aWFsaXplZFxuICogLSBJbnZvY2F0aW9uIGlzIHRyYWNrZWRcbiAqIC0gQmFja2VuZHMgYXJlIGZsdXNoZWQgYmVmb3JlIHJldHVybmluZ1xuICovXG5leHBvcnQgY29uc3Qgd2l0aE9ic2VydmFiaWxpdHkgPSA8VCBleHRlbmRzICguLi5hcmdzOiB1bmtub3duW10pID0+IFByb21pc2U8dW5rbm93bj4+KGhhbmRsZXI6IFQpOiBUID0+IHtcbiAgcmV0dXJuIChhc3luYyAoLi4uYXJnczogUGFyYW1ldGVyczxUPikgPT4ge1xuICAgIHRyeSB7XG4gICAgICBPYnNlcnZhYmlsaXR5TWFuYWdlci5pbml0aWFsaXplSW52b2NhdGlvbigpO1xuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoLi4uYXJncyk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IE9ic2VydmFiaWxpdHlNYW5hZ2VyLmZsdXNoKCk7XG4gICAgfVxuICB9KSBhcyBUO1xufTtcblxuLyoqXG4gKiBBbGlhcyBmb3IgT2JzZXJ2YWJpbGl0eU1hbmFnZXJcbiAqL1xuZXhwb3J0IGNvbnN0IE9ic2VydmVyID0gT2JzZXJ2YWJpbGl0eU1hbmFnZXI7XG4iXX0=