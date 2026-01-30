"use strict";
/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda:
 * - Logger for structured JSON logging
 * - Metrics for EMF (Embedded Metric Format) metrics
 *
 * All config injected via DI - no fallbacks.
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudWatchBackend = void 0;
const logger_1 = require("@aws-lambda-powertools/logger");
const metrics_1 = require("@aws-lambda-powertools/metrics");
const di_1 = require("../../di");
const logging_1 = require("../../logging");
const level_utils_1 = require("../utils/level-utils");
const internalLogger = (0, logging_1.createLogger)('CloudWatchBackend');
// CloudWatch limits
const MAX_DIMENSIONS = 30; // CloudWatch hard limit (practical limit: 10)
const MAX_DIMENSION_NAME_LENGTH = 256;
const MAX_DIMENSION_VALUE_LENGTH = 1024;
let CloudWatchBackend = class CloudWatchBackend {
    name = 'cloudwatch';
    minLevel;
    logger;
    metrics;
    hasAnyMetrics = false;
    config;
    serviceName;
    metricsCache = new Map();
    constructor(serviceName, minLevel, config) {
        this.minLevel = minLevel;
        this.config = config;
        this.serviceName = serviceName;
        this.logger = new logger_1.Logger({
            serviceName: serviceName,
            logLevel: (0, level_utils_1.levelToPowertoolsLogLevel)(minLevel),
        });
        // Default metrics instance (for single namespace strategy or fallback)
        this.metrics = new metrics_1.Metrics({
            namespace: config.namespace,
            serviceName: serviceName,
        });
    }
    async capture(event) {
        try {
            // Batch ALL metrics (event.metrics + span duration) into a SINGLE EMF log
            const hasEventMetrics = event.metrics && Object.keys(event.metrics).length > 0;
            const hasSpanDuration = event.type === 'span' && event.durationMs !== undefined && !event.metrics?.duration;
            if (hasEventMetrics || hasSpanDuration) {
                // Phase 2: Apply metric sampling (check if we should publish metrics for this event)
                const shouldPublishMetrics = this.shouldPublishMetrics(event);
                if (shouldPublishMetrics) {
                    this.hasAnyMetrics = true;
                    // Combine both into one batched metric call with correct namespace
                    this.handleMetricsBatch(event, hasSpanDuration);
                }
            }
            // Log the event (unless it's a pure metric event with no other data)
            if (event.type !== 'metric') {
                this.handleLog(event);
            }
        }
        catch (error) {
            internalLogger.error('CloudWatch capture failed:', error);
        }
    }
    /**
     * Get the Metrics instance for the given event based on namespace strategy.
     * Creates and caches Metrics instances for different namespaces.
     */
    getMetricsForEvent(event) {
        const strategy = this.config.namespaceStrategy || 'single';
        // Single namespace (default): use default metrics instance
        if (strategy === 'single') {
            return this.metrics;
        }
        // Determine namespace
        let namespace;
        if (typeof strategy === 'function') {
            // Custom function
            try {
                namespace = strategy(event);
            }
            catch (error) {
                internalLogger.warn('Custom namespace strategy failed, using default:', error);
                namespace = this.config.namespace;
            }
        }
        else if (strategy === 'per-type') {
            // Per handler type: 'FW24/API', 'FW24/Queue', 'FW24/Task'
            const handlerType = event.tags?.handlerType || event.tags?.handler_type || 'Other';
            const suffix = handlerType.charAt(0).toUpperCase() + handlerType.slice(1);
            namespace = `${this.config.namespace}/${suffix}`;
        }
        else if (strategy === 'per-source') {
            // Per source: 'FW24/UserController', 'FW24/OrderService'
            if (event.source) {
                // Extract clean source name (remove 'controller:', 'service:', 'queue:' prefixes)
                const cleanSource = event.source.replace(/^(controller|service|queue|task):/, '');
                namespace = `${this.config.namespace}/${cleanSource}`;
            }
            else {
                namespace = this.config.namespace;
            }
        }
        else {
            namespace = this.config.namespace;
        }
        // Check cache
        if (this.metricsCache.has(namespace)) {
            return this.metricsCache.get(namespace);
        }
        // Create new Metrics instance for this namespace
        const metricsInstance = new metrics_1.Metrics({
            namespace,
            serviceName: this.serviceName,
        });
        this.metricsCache.set(namespace, metricsInstance);
        return metricsInstance;
    }
    handleLog(event) {
        const context = {
            type: event.type,
            correlationId: event.correlationId,
            observabilityLogId: event.observabilityLogId,
        };
        if (event.entityName)
            context.entityName = event.entityName;
        if (event.entityId)
            context.entityId = event.entityId;
        if (event.operation)
            context.operation = event.operation;
        if (event.durationMs !== undefined)
            context.durationMs = event.durationMs;
        if (event.success !== undefined)
            context.success = event.success;
        if (event.status)
            context.status = event.status;
        if (event.parentObservabilityLogId)
            context.parentObservabilityLogId = event.parentObservabilityLogId;
        if (event.causedBy)
            context.causedBy = event.causedBy;
        if (event.relatedTraces)
            context.relatedTraces = event.relatedTraces;
        if (event.source)
            context.source = event.source;
        if (event.tags)
            context.tags = event.tags;
        if (event.attributes)
            context.attributes = event.attributes;
        if (event.data)
            context.data = event.data;
        if (event.error)
            context.error = event.error;
        if (event.actor) {
            const actor = event.actor;
            if (actor.actorId)
                context.actorId = actor.actorId;
            if (actor.actorType)
                context.actorType = actor.actorType;
            if (actor.tenantId)
                context.tenantId = actor.tenantId;
            if (actor.sessionId)
                context.sessionId = actor.sessionId;
            if (actor.email)
                context.actorEmail = actor.email;
            if (actor.sourceIp)
                context.sourceIp = actor.sourceIp;
            if (actor.userAgent)
                context.userAgent = actor.userAgent;
        }
        const message = this.extractMessage(event);
        this.logAtLevel(event.level, message, context);
    }
    extractMessage(event) {
        if (event.data && typeof event.data.message === 'string') {
            return event.data.message;
        }
        return event.operation || event.type;
    }
    logAtLevel(level, message, context) {
        switch (level) {
            case 'trace':
            case 'debug':
                this.logger.debug(message, context);
                break;
            case 'info':
                this.logger.info(message, context);
                break;
            case 'warn':
                this.logger.warn(message, context);
                break;
            case 'error':
            case 'critical':
                this.logger.error(message, context);
                break;
        }
    }
    /**
     * Build deduplicated dimensions from event data.
     *
     * PHASE 2: Applies automatic tags filtering to reduce dimension cardinality.
     *
     * Priority order (first occurrence wins):
     * 1. Tags (highest priority - user-specified) - FILTERED BY CONFIG
     * 2. Explicit dimension overrides (passed as parameter) - FILTERED BY CONFIG
     * 3. Attributes (if string values)
     * 4. Entity context (entityName) - FILTERED BY CONFIG
     * 5. Custom tags from config
     *
     * @param event - Observability event
     * @param explicitDimensions - Explicit dimensions to add (e.g., operation, source, success)
     * @returns Deduplicated dimension map
     */
    buildDimensions(event, explicitDimensions) {
        const dimensionMap = new Map();
        // Priority 1: Tags (already filtered by ObservabilityManager)
        if (event.tags) {
            for (const [key, value] of Object.entries(event.tags)) {
                if (dimensionMap.size >= MAX_DIMENSIONS)
                    break;
                if (typeof value === 'string' && !dimensionMap.has(key)) {
                    dimensionMap.set(key.slice(0, MAX_DIMENSION_NAME_LENGTH), value.slice(0, MAX_DIMENSION_VALUE_LENGTH));
                }
            }
        }
        // Priority 2: Explicit dimensions
        if (explicitDimensions) {
            for (const [key, value] of Object.entries(explicitDimensions)) {
                if (dimensionMap.size >= MAX_DIMENSIONS)
                    break;
                if (!dimensionMap.has(key)) {
                    dimensionMap.set(key.slice(0, MAX_DIMENSION_NAME_LENGTH), value.slice(0, MAX_DIMENSION_VALUE_LENGTH));
                }
            }
        }
        // Priority 3: Attributes (string values only)
        if (event.attributes) {
            for (const [key, value] of Object.entries(event.attributes)) {
                if (dimensionMap.size >= MAX_DIMENSIONS) {
                    internalLogger.debug(`Dimension limit reached (${MAX_DIMENSIONS}), skipping remaining attributes`);
                    break;
                }
                if (typeof value !== 'string')
                    continue;
                const dimName = key.slice(0, MAX_DIMENSION_NAME_LENGTH);
                const dimValue = value.slice(0, MAX_DIMENSION_VALUE_LENGTH);
                if (!dimensionMap.has(dimName)) {
                    dimensionMap.set(dimName, dimValue);
                }
            }
        }
        // Priority 4: Entity context
        if (event.entityName && dimensionMap.size < MAX_DIMENSIONS && !dimensionMap.has('entityName')) {
            dimensionMap.set('entityName', event.entityName);
        }
        return dimensionMap;
    }
    /**
     * Batch ALL metrics from a single event into ONE EMF log entry.
     *
     * OPTIMIZATION: Combines event.metrics + span duration into a SINGLE EMF log
     * BEFORE (inefficient): 5 event metrics + 1 span duration = 2 separate EMF logs
     * AFTER (optimized): 5 event metrics + 1 span duration = 1 EMF log = 50% cost reduction
     *
     * PHASE 2: Also applies metric filtering to reduce published metrics
     *
     * CloudWatch EMF supports up to 100 metrics per log entry, so batching
     * is almost always better than individual metric emission.
     *
     * @param event - The observability event containing metrics
     * @param includeSpanDuration - Whether to include span duration in the batch
     */
    /**
     * Batch ALL metrics from a single event into ONE EMF log entry.
     *
     * OPTIMIZATION: Combines event.metrics + span duration into a SINGLE EMF log
     * BEFORE (inefficient): 5 event metrics + 1 span duration = 2 separate EMF logs
     * AFTER (optimized): 5 event metrics + 1 span duration = 1 EMF log = 50% cost reduction
     *
     * PHASE 2: Also applies metric filtering to reduce published metrics
     * PHASE 3: Applies operation-specific metric rules and dynamic namespace strategy
     *
     * CloudWatch EMF supports up to 100 metrics per log entry, so batching
     * is almost always better than individual metric emission.
     *
     * @param event - The observability event containing metrics
     * @param includeSpanDuration - Whether to include span duration in the batch
     */
    handleMetricsBatch(event, includeSpanDuration = false) {
        const dimensionMap = this.buildDimensions(event, this.getSpanDimensions(event));
        const dimensions = Array.from(dimensionMap.entries()).map(([name, value]) => ({ name, value }));
        try {
            // Phase 3: Get correct Metrics instance based on namespace strategy
            const metricsInstance = this.getMetricsForEvent(event);
            // Create ONE metrics batch for ALL metrics (event metrics + span duration)
            const metricsBatch = metricsInstance.singleMetric();
            // Add dimensions once (shared by all metrics)
            for (const dim of dimensions) {
                metricsBatch.addDimension(dim.name, dim.value);
            }
            let metricsAdded = 0;
            // Phase 2 & 3: Add event metrics with filtering (operation-specific or global)
            if (event.metrics && Object.keys(event.metrics).length > 0) {
                for (const [name, value] of Object.entries(event.metrics)) {
                    // Phase 3: Check if this metric should be published (operation-specific or global)
                    if (!this.shouldPublishMetric(name, event)) {
                        continue;
                    }
                    const unit = this.getMetricUnit(name, event.attributes?.unit);
                    metricsBatch.addMetric(name, unit, value);
                    metricsAdded++;
                }
            }
            // Phase 2 & 3: Add span duration with filtering
            if (includeSpanDuration && event.durationMs !== undefined) {
                // Check if 'duration' metric should be published
                if (this.shouldPublishMetric('duration', event)) {
                    metricsBatch.addMetric('duration', metrics_1.MetricUnit.Milliseconds, event.durationMs);
                    metricsAdded++;
                }
            }
            // Only publish if we have metrics to publish (after filtering)
            if (metricsAdded === 0) {
                internalLogger.debug('No metrics to publish after filtering');
            }
            // EMF will publish ONE log entry with ALL metrics (massive cost savings!)
        }
        catch (error) {
            internalLogger.warn('Failed to publish metrics batch:', error);
        }
    }
    /**
     * Get span-specific dimensions (operation, source, success)
     */
    getSpanDimensions(event) {
        if (event.type !== 'span')
            return undefined;
        const dimensions = {};
        if (event.operation)
            dimensions.operation = event.operation;
        if (event.source)
            dimensions.source = event.source;
        if (event.success !== undefined)
            dimensions.success = String(event.success);
        return Object.keys(dimensions).length > 0 ? dimensions : undefined;
    }
    /**
     * Determine the correct unit for a metric.
     * Allows per-metric unit override via naming conventions.
     */
    getMetricUnit(metricName, defaultUnit) {
        // Per-metric unit detection based on name patterns
        if (metricName.includes('duration') || metricName.includes('latency') || metricName.endsWith('Ms')) {
            return metrics_1.MetricUnit.Milliseconds;
        }
        if (metricName.includes('count') || metricName.includes('total') || metricName.endsWith('Count')) {
            return metrics_1.MetricUnit.Count;
        }
        if (metricName.includes('bytes') || metricName.includes('size') || metricName.endsWith('Bytes')) {
            return metrics_1.MetricUnit.Bytes;
        }
        if (metricName.includes('percent') || metricName.includes('rate')) {
            return metrics_1.MetricUnit.Percent;
        }
        // Fall back to default unit or Count
        return this.mapUnit(defaultUnit);
    }
    /**
     * Publish span duration as a CloudWatch metric.
     * Allows creating dashboards/alarms on operation durations.
     * Uses buildDimensions() to ensure proper deduplication with event.tags.
     */
    publishSpanDurationMetric(event) {
        if (!event.durationMs || !event.operation)
            return;
        try {
            // Build explicit dimensions for span metrics
            const explicitDimensions = {};
            if (event.operation) {
                explicitDimensions.operation = event.operation;
            }
            if (event.source) {
                explicitDimensions.source = event.source;
            }
            if (event.success !== undefined) {
                explicitDimensions.success = String(event.success);
            }
            if (event.entityName) {
                explicitDimensions.entityName = event.entityName;
            }
            if (event.actor?.tenantId) {
                explicitDimensions.tenantId = event.actor.tenantId;
            }
            // Use buildDimensions to properly deduplicate with tags
            const dimensionMap = this.buildDimensions(event, explicitDimensions);
            const singleMetric = this.metrics.singleMetric();
            for (const [name, value] of dimensionMap.entries()) {
                singleMetric.addDimension(name, value);
            }
            singleMetric.addMetric('span.duration', metrics_1.MetricUnit.Milliseconds, event.durationMs);
        }
        catch (error) {
            internalLogger.warn('Failed to publish span duration metric:', error);
        }
    }
    async flush() {
        try {
            // Avoid noisy powertools warning when no metrics were recorded.
            if (!this.hasAnyMetrics) {
                return;
            }
            // Phase 3: Publish metrics from all namespace instances
            // Default namespace
            this.metrics.publishStoredMetrics();
            // Cached namespaces (if any)
            for (const metricsInstance of this.metricsCache.values()) {
                metricsInstance.publishStoredMetrics();
            }
            this.hasAnyMetrics = false;
        }
        catch (error) {
            internalLogger.error('Failed to publish metrics:', error);
        }
    }
    initializeInvocation() {
        // Powertools handles per-invocation state automatically
        this.hasAnyMetrics = false;
        // Note: We DON'T clear metricsCache - it's safe to reuse across invocations
    }
    mapUnit(unit) {
        if (!unit)
            return metrics_1.MetricUnit.Count;
        const normalized = unit.toLowerCase();
        switch (normalized) {
            case 'seconds': return metrics_1.MetricUnit.Seconds;
            case 'milliseconds': return metrics_1.MetricUnit.Milliseconds;
            case 'microseconds': return metrics_1.MetricUnit.Microseconds;
            case 'bytes': return metrics_1.MetricUnit.Bytes;
            case 'kilobytes': return metrics_1.MetricUnit.Kilobytes;
            case 'megabytes': return metrics_1.MetricUnit.Megabytes;
            case 'gigabytes': return metrics_1.MetricUnit.Gigabytes;
            case 'percent': return metrics_1.MetricUnit.Percent;
            case 'bits': return metrics_1.MetricUnit.Bits;
            case 'bits/second': return metrics_1.MetricUnit.BitsPerSecond;
            case 'bytes/second': return metrics_1.MetricUnit.BytesPerSecond;
            case 'kilobits/second': return metrics_1.MetricUnit.KilobitsPerSecond;
            case 'kilobytes/second': return metrics_1.MetricUnit.KilobytesPerSecond;
            case 'megabits/second': return metrics_1.MetricUnit.MegabitsPerSecond;
            case 'megabytes/second': return metrics_1.MetricUnit.MegabytesPerSecond;
            case 'gigabits/second': return metrics_1.MetricUnit.GigabitsPerSecond;
            case 'gigabytes/second': return metrics_1.MetricUnit.GigabytesPerSecond;
            case 'terabits/second': return metrics_1.MetricUnit.TerabitsPerSecond;
            case 'terabytes/second': return metrics_1.MetricUnit.TerabytesPerSecond;
            case 'count/second': return metrics_1.MetricUnit.CountPerSecond;
            default: return metrics_1.MetricUnit.Count;
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: Cost Optimization Logic
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Phase 2 Optimization: Metric Sampling
     *
     * Determines if metrics should be published for this event based on sampling config.
     *
     * Strategy:
     * - Always publish: errors, slow operations (critical signals)
     * - Sample: fast, successful operations (routine traffic)
     * - Never sample: configured operations (e.g., payments, critical paths)
     */
    shouldPublishMetrics(event) {
        const config = this.config.metricSampling;
        // If sampling disabled, always publish
        if (!config || !config.enabled) {
            return true;
        }
        const operation = event.operation || '';
        // Check neverSample list (always publish)
        if (config.neverSample && this.matchesPatterns(operation, config.neverSample)) {
            return true;
        }
        // Check alwaysSample list (never publish unless error/slow)
        if (config.alwaysSample && this.matchesPatterns(operation, config.alwaysSample)) {
            // Continue to check if it's an error or slow operation
        }
        const alwaysPublishOn = config.alwaysPublishOn || 'both';
        // Always publish on error
        if ((event.success === false || event.error) &&
            (alwaysPublishOn === 'error' || alwaysPublishOn === 'both')) {
            return true;
        }
        // Always publish on slow operations
        const slowThreshold = config.thresholds?.slowDurationMs || 1000;
        if (event.durationMs !== undefined && event.durationMs >= slowThreshold &&
            (alwaysPublishOn === 'slow' || alwaysPublishOn === 'both')) {
            return true;
        }
        // Sample routine operations based on rate
        const sampleRate = config.rate || 0.1;
        return Math.random() < sampleRate;
    }
    /**
     * Phase 2 & 3 Optimization: Metric Filtering
     *
     * Determines if a specific metric should be published based on filtering config.
     *
     * Phase 3: Supports operation-specific rules (first match wins).
     * If no operation-specific rule matches, falls back to global rules.
     *
     * @param metricName - The name of the metric to check
     * @param event - The observability event (for operation-specific rules)
     * @returns true if the metric should be published, false otherwise
     */
    shouldPublishMetric(metricName, event) {
        const config = this.config.metricFiltering;
        // If filtering disabled, always publish
        if (!config || !config.enabled) {
            return true;
        }
        // Phase 3: Check operation-specific rules first
        if (config.operationRules && config.operationRules.length > 0 && event.operation) {
            for (const rule of config.operationRules) {
                if (this.matchesOperationPattern(event.operation, rule.operation)) {
                    // Matched operation-specific rule - evaluate it
                    return this.evaluateMetricRule(metricName, rule);
                }
            }
        }
        // No operation-specific rule matched - use global rules
        return this.evaluateMetricRule(metricName, config);
    }
    /**
     * Check if operation matches a pattern (string or RegExp).
     */
    matchesOperationPattern(operation, pattern) {
        if (pattern instanceof RegExp) {
            return pattern.test(operation);
        }
        // String pattern with wildcard support
        return this.matchesPatterns(operation, [pattern]);
    }
    /**
     * Evaluate a metric against filtering rules (whitelist/blacklist/patterns).
     */
    evaluateMetricRule(metricName, rule) {
        // Check patterns first (most flexible)
        if (rule.patterns) {
            const { include, exclude } = rule.patterns;
            // If include patterns exist, metric must match at least one
            if (include && include.length > 0) {
                const matchesInclude = include.some(pattern => pattern.test(metricName));
                if (!matchesInclude)
                    return false;
            }
            // If exclude patterns exist, metric must not match any
            if (exclude && exclude.length > 0) {
                const matchesExclude = exclude.some(pattern => pattern.test(metricName));
                if (matchesExclude)
                    return false;
            }
            return true;
        }
        // Check whitelist (ONLY these metrics)
        if (rule.whitelist !== undefined) {
            // Empty whitelist [] = no metrics allowed
            if (rule.whitelist.length === 0) {
                return false;
            }
            return this.matchesPatterns(metricName, rule.whitelist);
        }
        // Check blacklist (all EXCEPT these)
        if (rule.blacklist !== undefined) {
            // Empty blacklist [] = all metrics allowed
            if (rule.blacklist.length === 0) {
                return true;
            }
            return !this.matchesPatterns(metricName, rule.blacklist);
        }
        // No rules specified - publish
        return true;
    }
    /**
     * Check if a string matches any of the glob patterns.
     * Supports exact matches and simple glob patterns (*, ?).
     */
    matchesPatterns(value, patterns) {
        return patterns.some((pattern) => {
            // Exact match
            if (pattern === value)
                return true;
            // Convert glob to regex
            const regexPattern = pattern
                .replace(/\./g, '\\.') // Escape dots
                .replace(/\*/g, '.*') // * matches anything
                .replace(/\?/g, '.'); // ? matches single char
            const regex = new RegExp(`^${regexPattern}$`);
            return regex.test(value);
        });
    }
};
exports.CloudWatchBackend = CloudWatchBackend;
exports.CloudWatchBackend = CloudWatchBackend = __decorate([
    (0, di_1.Injectable)({
        provide: 'ObservabilityBackend',
        providedIn: 'ROOT',
        tags: ['observability', 'backend', 'cloudwatch']
    }),
    __param(0, (0, di_1.InjectConfig)('observability.serviceName')),
    __param(1, (0, di_1.InjectConfig)('observability.minLevel')),
    __param(2, (0, di_1.InjectConfig)('observability.cloudwatch'))
], CloudWatchBackend);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7Ozs7Ozs7Ozs7QUFFSCwwREFBdUQ7QUFDdkQsNERBQXFFO0FBQ3JFLGlDQUFvRDtBQUNwRCwyQ0FBNkM7QUFRN0Msc0RBQWlFO0FBRWpFLE1BQU0sY0FBYyxHQUFHLElBQUEsc0JBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXpELG9CQUFvQjtBQUNwQixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUMsQ0FBRSw4Q0FBOEM7QUFDMUUsTUFBTSx5QkFBeUIsR0FBRyxHQUFHLENBQUM7QUFDdEMsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUM7QUFPakMsSUFBTSxpQkFBaUIsR0FBdkIsTUFBTSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBQ2pCLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFDYixNQUFNLENBQW1CO0lBQ3pCLFdBQVcsQ0FBUztJQUNwQixZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQW1CLENBQUM7SUFFM0QsWUFDNkMsV0FBbUIsRUFDdEIsUUFBNEIsRUFDMUIsTUFBd0I7UUFFbEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUM7UUFFL0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGVBQU0sQ0FBQztZQUN2QixXQUFXLEVBQUUsV0FBVztZQUN4QixRQUFRLEVBQUUsSUFBQSx1Q0FBeUIsRUFBQyxRQUFRLENBQUM7U0FFOUMsQ0FBQyxDQUFDO1FBRUgsdUVBQXVFO1FB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Q0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBRUYsQ0FBQTtBQWxvQlksOENBQWlCOzRCQUFqQixpQkFBaUI7SUFMN0IsSUFBQSxlQUFVLEVBQUM7UUFDVixPQUFPLEVBQUUsc0JBQXNCO1FBQy9CLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxDQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFFO0tBQ25ELENBQUM7SUFhRyxXQUFBLElBQUEsaUJBQVksRUFBQywyQkFBMkIsQ0FBQyxDQUFBO0lBQ3pDLFdBQUEsSUFBQSxpQkFBWSxFQUFDLHdCQUF3QixDQUFDLENBQUE7SUFDdEMsV0FBQSxJQUFBLGlCQUFZLEVBQUMsMEJBQTBCLENBQUMsQ0FBQTtHQWRoQyxpQkFBaUIsQ0Frb0I3QiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBCYWNrZW5kIGZvciBPYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFVzZXMgQVdTIFBvd2VydG9vbHMgZm9yIExhbWJkYTpcbiAqIC0gTG9nZ2VyIGZvciBzdHJ1Y3R1cmVkIEpTT04gbG9nZ2luZ1xuICogLSBNZXRyaWNzIGZvciBFTUYgKEVtYmVkZGVkIE1ldHJpYyBGb3JtYXQpIG1ldHJpY3NcbiAqIFxuICogQWxsIGNvbmZpZyBpbmplY3RlZCB2aWEgREkgLSBubyBmYWxsYmFja3MuXG4gKi9cblxuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInO1xuaW1wb3J0IHsgTWV0cmljcywgTWV0cmljVW5pdCB9IGZyb20gJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcyc7XG5pbXBvcnQgeyBJbmplY3RhYmxlLCBJbmplY3RDb25maWcgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7XG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLFxuICBDbG91ZFdhdGNoQ29uZmlnLFxufSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsIH0gZnJvbSAnLi4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuXG5jb25zdCBpbnRlcm5hbExvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ2xvdWRXYXRjaEJhY2tlbmQnKTtcblxuLy8gQ2xvdWRXYXRjaCBsaW1pdHNcbmNvbnN0IE1BWF9ESU1FTlNJT05TID0gMzA7ICAvLyBDbG91ZFdhdGNoIGhhcmQgbGltaXQgKHByYWN0aWNhbCBsaW1pdDogMTApXG5jb25zdCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIID0gMjU2O1xuY29uc3QgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEggPSAxMDI0O1xuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ2Nsb3Vkd2F0Y2gnIF1cbn0pXG5leHBvcnQgY2xhc3MgQ2xvdWRXYXRjaEJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ2Nsb3Vkd2F0Y2gnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSBsb2dnZXI6IExvZ2dlcjtcbiAgcHJpdmF0ZSBtZXRyaWNzOiBNZXRyaWNzO1xuICBwcml2YXRlIGhhc0FueU1ldHJpY3MgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBjb25maWc6IENsb3VkV2F0Y2hDb25maWc7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VydmljZU5hbWU6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBtZXRyaWNzQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgTWV0cmljcz4oKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LnNlcnZpY2VOYW1lJykgc2VydmljZU5hbWU6IHN0cmluZyxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5Lm1pbkxldmVsJykgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmNsb3Vkd2F0Y2gnKSBjb25maWc6IENsb3VkV2F0Y2hDb25maWdcbiAgKSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuc2VydmljZU5hbWUgPSBzZXJ2aWNlTmFtZTtcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgICBzZXJ2aWNlTmFtZTogc2VydmljZU5hbWUsXG4gICAgICBsb2dMZXZlbDogbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbChtaW5MZXZlbCksXG5cbiAgICB9KTtcblxuICAgIC8vIERlZmF1bHQgbWV0cmljcyBpbnN0YW5jZSAoZm9yIHNpbmdsZSBuYW1lc3BhY2Ugc3RyYXRlZ3kgb3IgZmFsbGJhY2spXG4gICAgdGhpcy5tZXRyaWNzID0gbmV3IE1ldHJpY3Moe1xuICAgICAgbmFtZXNwYWNlOiBjb25maWcubmFtZXNwYWNlLFxuICAgICAgc2VydmljZU5hbWU6IHNlcnZpY2VOYW1lLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEJhdGNoIEFMTCBtZXRyaWNzIChldmVudC5tZXRyaWNzICsgc3BhbiBkdXJhdGlvbikgaW50byBhIFNJTkdMRSBFTUYgbG9nXG4gICAgICBjb25zdCBoYXNFdmVudE1ldHJpY3MgPSBldmVudC5tZXRyaWNzICYmIE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA+IDA7XG4gICAgICBjb25zdCBoYXNTcGFuRHVyYXRpb24gPSBldmVudC50eXBlID09PSAnc3BhbicgJiYgZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkICYmICFldmVudC5tZXRyaWNzPy5kdXJhdGlvbjtcblxuICAgICAgaWYgKGhhc0V2ZW50TWV0cmljcyB8fCBoYXNTcGFuRHVyYXRpb24pIHtcbiAgICAgICAgLy8gUGhhc2UgMjogQXBwbHkgbWV0cmljIHNhbXBsaW5nIChjaGVjayBpZiB3ZSBzaG91bGQgcHVibGlzaCBtZXRyaWNzIGZvciB0aGlzIGV2ZW50KVxuICAgICAgICBjb25zdCBzaG91bGRQdWJsaXNoTWV0cmljcyA9IHRoaXMuc2hvdWxkUHVibGlzaE1ldHJpY3MoZXZlbnQpO1xuXG4gICAgICAgIGlmIChzaG91bGRQdWJsaXNoTWV0cmljcykge1xuICAgICAgICAgIHRoaXMuaGFzQW55TWV0cmljcyA9IHRydWU7XG4gICAgICAgICAgLy8gQ29tYmluZSBib3RoIGludG8gb25lIGJhdGNoZWQgbWV0cmljIGNhbGwgd2l0aCBjb3JyZWN0IG5hbWVzcGFjZVxuICAgICAgICAgIHRoaXMuaGFuZGxlTWV0cmljc0JhdGNoKGV2ZW50LCBoYXNTcGFuRHVyYXRpb24pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIExvZyB0aGUgZXZlbnQgKHVubGVzcyBpdCdzIGEgcHVyZSBtZXRyaWMgZXZlbnQgd2l0aCBubyBvdGhlciBkYXRhKVxuICAgICAgaWYgKGV2ZW50LnR5cGUgIT09ICdtZXRyaWMnKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlTG9nKGV2ZW50KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaW50ZXJuYWxMb2dnZXIuZXJyb3IoJ0Nsb3VkV2F0Y2ggY2FwdHVyZSBmYWlsZWQ6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIE1ldHJpY3MgaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBldmVudCBiYXNlZCBvbiBuYW1lc3BhY2Ugc3RyYXRlZ3kuXG4gICAqIENyZWF0ZXMgYW5kIGNhY2hlcyBNZXRyaWNzIGluc3RhbmNlcyBmb3IgZGlmZmVyZW50IG5hbWVzcGFjZXMuXG4gICAqL1xuICBwcml2YXRlIGdldE1ldHJpY3NGb3JFdmVudChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogTWV0cmljcyB7XG4gICAgY29uc3Qgc3RyYXRlZ3kgPSB0aGlzLmNvbmZpZy5uYW1lc3BhY2VTdHJhdGVneSB8fCAnc2luZ2xlJztcblxuICAgIC8vIFNpbmdsZSBuYW1lc3BhY2UgKGRlZmF1bHQpOiB1c2UgZGVmYXVsdCBtZXRyaWNzIGluc3RhbmNlXG4gICAgaWYgKHN0cmF0ZWd5ID09PSAnc2luZ2xlJykge1xuICAgICAgcmV0dXJuIHRoaXMubWV0cmljcztcbiAgICB9XG5cbiAgICAvLyBEZXRlcm1pbmUgbmFtZXNwYWNlXG4gICAgbGV0IG5hbWVzcGFjZTogc3RyaW5nO1xuXG4gICAgaWYgKHR5cGVvZiBzdHJhdGVneSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgLy8gQ3VzdG9tIGZ1bmN0aW9uXG4gICAgICB0cnkge1xuICAgICAgICBuYW1lc3BhY2UgPSBzdHJhdGVneShldmVudCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpbnRlcm5hbExvZ2dlci53YXJuKCdDdXN0b20gbmFtZXNwYWNlIHN0cmF0ZWd5IGZhaWxlZCwgdXNpbmcgZGVmYXVsdDonLCBlcnJvcik7XG4gICAgICAgIG5hbWVzcGFjZSA9IHRoaXMuY29uZmlnLm5hbWVzcGFjZTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHN0cmF0ZWd5ID09PSAncGVyLXR5cGUnKSB7XG4gICAgICAvLyBQZXIgaGFuZGxlciB0eXBlOiAnRlcyNC9BUEknLCAnRlcyNC9RdWV1ZScsICdGVzI0L1Rhc2snXG4gICAgICBjb25zdCBoYW5kbGVyVHlwZSA9IGV2ZW50LnRhZ3M/LmhhbmRsZXJUeXBlIHx8IGV2ZW50LnRhZ3M/LmhhbmRsZXJfdHlwZSB8fCAnT3RoZXInO1xuICAgICAgY29uc3Qgc3VmZml4ID0gaGFuZGxlclR5cGUuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBoYW5kbGVyVHlwZS5zbGljZSgxKTtcbiAgICAgIG5hbWVzcGFjZSA9IGAke3RoaXMuY29uZmlnLm5hbWVzcGFjZX0vJHtzdWZmaXh9YDtcbiAgICB9IGVsc2UgaWYgKHN0cmF0ZWd5ID09PSAncGVyLXNvdXJjZScpIHtcbiAgICAgIC8vIFBlciBzb3VyY2U6ICdGVzI0L1VzZXJDb250cm9sbGVyJywgJ0ZXMjQvT3JkZXJTZXJ2aWNlJ1xuICAgICAgaWYgKGV2ZW50LnNvdXJjZSkge1xuICAgICAgICAvLyBFeHRyYWN0IGNsZWFuIHNvdXJjZSBuYW1lIChyZW1vdmUgJ2NvbnRyb2xsZXI6JywgJ3NlcnZpY2U6JywgJ3F1ZXVlOicgcHJlZml4ZXMpXG4gICAgICAgIGNvbnN0IGNsZWFuU291cmNlID0gZXZlbnQuc291cmNlLnJlcGxhY2UoL14oY29udHJvbGxlcnxzZXJ2aWNlfHF1ZXVlfHRhc2spOi8sICcnKTtcbiAgICAgICAgbmFtZXNwYWNlID0gYCR7dGhpcy5jb25maWcubmFtZXNwYWNlfS8ke2NsZWFuU291cmNlfWA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuYW1lc3BhY2UgPSB0aGlzLmNvbmZpZy5uYW1lc3BhY2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5hbWVzcGFjZSA9IHRoaXMuY29uZmlnLm5hbWVzcGFjZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBjYWNoZVxuICAgIGlmICh0aGlzLm1ldHJpY3NDYWNoZS5oYXMobmFtZXNwYWNlKSkge1xuICAgICAgcmV0dXJuIHRoaXMubWV0cmljc0NhY2hlLmdldChuYW1lc3BhY2UpITtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgbmV3IE1ldHJpY3MgaW5zdGFuY2UgZm9yIHRoaXMgbmFtZXNwYWNlXG4gICAgY29uc3QgbWV0cmljc0luc3RhbmNlID0gbmV3IE1ldHJpY3Moe1xuICAgICAgbmFtZXNwYWNlLFxuICAgICAgc2VydmljZU5hbWU6IHRoaXMuc2VydmljZU5hbWUsXG4gICAgfSk7XG5cbiAgICB0aGlzLm1ldHJpY3NDYWNoZS5zZXQobmFtZXNwYWNlLCBtZXRyaWNzSW5zdGFuY2UpO1xuICAgIHJldHVybiBtZXRyaWNzSW5zdGFuY2U7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUxvZyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgY29uc3QgY29udGV4dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgY29ycmVsYXRpb25JZDogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgIH07XG5cbiAgICBpZiAoZXZlbnQuZW50aXR5TmFtZSkgY29udGV4dC5lbnRpdHlOYW1lID0gZXZlbnQuZW50aXR5TmFtZTtcbiAgICBpZiAoZXZlbnQuZW50aXR5SWQpIGNvbnRleHQuZW50aXR5SWQgPSBldmVudC5lbnRpdHlJZDtcbiAgICBpZiAoZXZlbnQub3BlcmF0aW9uKSBjb250ZXh0Lm9wZXJhdGlvbiA9IGV2ZW50Lm9wZXJhdGlvbjtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSBjb250ZXh0LmR1cmF0aW9uTXMgPSBldmVudC5kdXJhdGlvbk1zO1xuICAgIGlmIChldmVudC5zdWNjZXNzICE9PSB1bmRlZmluZWQpIGNvbnRleHQuc3VjY2VzcyA9IGV2ZW50LnN1Y2Nlc3M7XG4gICAgaWYgKGV2ZW50LnN0YXR1cykgY29udGV4dC5zdGF0dXMgPSBldmVudC5zdGF0dXM7XG4gICAgaWYgKGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkgY29udGV4dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKGV2ZW50LmNhdXNlZEJ5KSBjb250ZXh0LmNhdXNlZEJ5ID0gZXZlbnQuY2F1c2VkQnk7XG4gICAgaWYgKGV2ZW50LnJlbGF0ZWRUcmFjZXMpIGNvbnRleHQucmVsYXRlZFRyYWNlcyA9IGV2ZW50LnJlbGF0ZWRUcmFjZXM7XG4gICAgaWYgKGV2ZW50LnNvdXJjZSkgY29udGV4dC5zb3VyY2UgPSBldmVudC5zb3VyY2U7XG4gICAgaWYgKGV2ZW50LnRhZ3MpIGNvbnRleHQudGFncyA9IGV2ZW50LnRhZ3M7XG4gICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIGNvbnRleHQuYXR0cmlidXRlcyA9IGV2ZW50LmF0dHJpYnV0ZXM7XG4gICAgaWYgKGV2ZW50LmRhdGEpIGNvbnRleHQuZGF0YSA9IGV2ZW50LmRhdGE7XG4gICAgaWYgKGV2ZW50LmVycm9yKSBjb250ZXh0LmVycm9yID0gZXZlbnQuZXJyb3I7XG4gICAgaWYgKGV2ZW50LmFjdG9yKSB7XG4gICAgICBjb25zdCBhY3RvciA9IGV2ZW50LmFjdG9yO1xuICAgICAgaWYgKGFjdG9yLmFjdG9ySWQpIGNvbnRleHQuYWN0b3JJZCA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICBpZiAoYWN0b3IuYWN0b3JUeXBlKSBjb250ZXh0LmFjdG9yVHlwZSA9IGFjdG9yLmFjdG9yVHlwZTtcbiAgICAgIGlmIChhY3Rvci50ZW5hbnRJZCkgY29udGV4dC50ZW5hbnRJZCA9IGFjdG9yLnRlbmFudElkO1xuICAgICAgaWYgKGFjdG9yLnNlc3Npb25JZCkgY29udGV4dC5zZXNzaW9uSWQgPSBhY3Rvci5zZXNzaW9uSWQ7XG4gICAgICBpZiAoYWN0b3IuZW1haWwpIGNvbnRleHQuYWN0b3JFbWFpbCA9IGFjdG9yLmVtYWlsO1xuICAgICAgaWYgKGFjdG9yLnNvdXJjZUlwKSBjb250ZXh0LnNvdXJjZUlwID0gYWN0b3Iuc291cmNlSXA7XG4gICAgICBpZiAoYWN0b3IudXNlckFnZW50KSBjb250ZXh0LnVzZXJBZ2VudCA9IGFjdG9yLnVzZXJBZ2VudDtcbiAgICB9XG5cbiAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5leHRyYWN0TWVzc2FnZShldmVudCk7XG4gICAgdGhpcy5sb2dBdExldmVsKGV2ZW50LmxldmVsLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdE1lc3NhZ2UoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHN0cmluZyB7XG4gICAgaWYgKGV2ZW50LmRhdGEgJiYgdHlwZW9mIGV2ZW50LmRhdGEubWVzc2FnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBldmVudC5kYXRhLm1lc3NhZ2U7XG4gICAgfVxuICAgIHJldHVybiBldmVudC5vcGVyYXRpb24gfHwgZXZlbnQudHlwZTtcbiAgfVxuXG4gIHByaXZhdGUgbG9nQXRMZXZlbChsZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgc3dpdGNoIChsZXZlbCkge1xuICAgICAgY2FzZSAndHJhY2UnOlxuICAgICAgY2FzZSAnZGVidWcnOlxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdpbmZvJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd3YXJuJzpcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICBjYXNlICdjcml0aWNhbCc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGQgZGVkdXBsaWNhdGVkIGRpbWVuc2lvbnMgZnJvbSBldmVudCBkYXRhLlxuICAgKiBcbiAgICogUEhBU0UgMjogQXBwbGllcyBhdXRvbWF0aWMgdGFncyBmaWx0ZXJpbmcgdG8gcmVkdWNlIGRpbWVuc2lvbiBjYXJkaW5hbGl0eS5cbiAgICogXG4gICAqIFByaW9yaXR5IG9yZGVyIChmaXJzdCBvY2N1cnJlbmNlIHdpbnMpOlxuICAgKiAxLiBUYWdzIChoaWdoZXN0IHByaW9yaXR5IC0gdXNlci1zcGVjaWZpZWQpIC0gRklMVEVSRUQgQlkgQ09ORklHXG4gICAqIDIuIEV4cGxpY2l0IGRpbWVuc2lvbiBvdmVycmlkZXMgKHBhc3NlZCBhcyBwYXJhbWV0ZXIpIC0gRklMVEVSRUQgQlkgQ09ORklHXG4gICAqIDMuIEF0dHJpYnV0ZXMgKGlmIHN0cmluZyB2YWx1ZXMpXG4gICAqIDQuIEVudGl0eSBjb250ZXh0IChlbnRpdHlOYW1lKSAtIEZJTFRFUkVEIEJZIENPTkZJR1xuICAgKiA1LiBDdXN0b20gdGFncyBmcm9tIGNvbmZpZ1xuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gT2JzZXJ2YWJpbGl0eSBldmVudFxuICAgKiBAcGFyYW0gZXhwbGljaXREaW1lbnNpb25zIC0gRXhwbGljaXQgZGltZW5zaW9ucyB0byBhZGQgKGUuZy4sIG9wZXJhdGlvbiwgc291cmNlLCBzdWNjZXNzKVxuICAgKiBAcmV0dXJucyBEZWR1cGxpY2F0ZWQgZGltZW5zaW9uIG1hcFxuICAgKi9cbiAgcHJpdmF0ZSBidWlsZERpbWVuc2lvbnMoXG4gICAgZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCxcbiAgICBleHBsaWNpdERpbWVuc2lvbnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gICk6IE1hcDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIGNvbnN0IGRpbWVuc2lvbk1hcCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG5cbiAgICAvLyBQcmlvcml0eSAxOiBUYWdzIChhbHJlYWR5IGZpbHRlcmVkIGJ5IE9ic2VydmFiaWxpdHlNYW5hZ2VyKVxuICAgIGlmIChldmVudC50YWdzKSB7XG4gICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50LnRhZ3MpKSB7XG4gICAgICAgIGlmIChkaW1lbnNpb25NYXAuc2l6ZSA+PSBNQVhfRElNRU5TSU9OUykgYnJlYWs7XG5cbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgIWRpbWVuc2lvbk1hcC5oYXMoa2V5KSkge1xuICAgICAgICAgIGRpbWVuc2lvbk1hcC5zZXQoXG4gICAgICAgICAgICBrZXkuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9OQU1FX0xFTkdUSCksXG4gICAgICAgICAgICB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogRXhwbGljaXQgZGltZW5zaW9uc1xuICAgIGlmIChleHBsaWNpdERpbWVuc2lvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXhwbGljaXREaW1lbnNpb25zKSkge1xuICAgICAgICBpZiAoZGltZW5zaW9uTWFwLnNpemUgPj0gTUFYX0RJTUVOU0lPTlMpIGJyZWFrO1xuXG4gICAgICAgIGlmICghZGltZW5zaW9uTWFwLmhhcyhrZXkpKSB7XG4gICAgICAgICAgZGltZW5zaW9uTWFwLnNldChcbiAgICAgICAgICAgIGtleS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIKSxcbiAgICAgICAgICAgIHZhbHVlLnNsaWNlKDAsIE1BWF9ESU1FTlNJT05fVkFMVUVfTEVOR1RIKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAzOiBBdHRyaWJ1dGVzIChzdHJpbmcgdmFsdWVzIG9ubHkpXG4gICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQuYXR0cmlidXRlcykpIHtcbiAgICAgICAgaWYgKGRpbWVuc2lvbk1hcC5zaXplID49IE1BWF9ESU1FTlNJT05TKSB7XG4gICAgICAgICAgaW50ZXJuYWxMb2dnZXIuZGVidWcoYERpbWVuc2lvbiBsaW1pdCByZWFjaGVkICgke01BWF9ESU1FTlNJT05TfSksIHNraXBwaW5nIHJlbWFpbmluZyBhdHRyaWJ1dGVzYCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgY29udGludWU7XG5cbiAgICAgICAgY29uc3QgZGltTmFtZSA9IGtleS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIKTtcbiAgICAgICAgY29uc3QgZGltVmFsdWUgPSB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCk7XG5cbiAgICAgICAgaWYgKCFkaW1lbnNpb25NYXAuaGFzKGRpbU5hbWUpKSB7XG4gICAgICAgICAgZGltZW5zaW9uTWFwLnNldChkaW1OYW1lLCBkaW1WYWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA0OiBFbnRpdHkgY29udGV4dFxuICAgIGlmIChldmVudC5lbnRpdHlOYW1lICYmIGRpbWVuc2lvbk1hcC5zaXplIDwgTUFYX0RJTUVOU0lPTlMgJiYgIWRpbWVuc2lvbk1hcC5oYXMoJ2VudGl0eU5hbWUnKSkge1xuICAgICAgZGltZW5zaW9uTWFwLnNldCgnZW50aXR5TmFtZScsIGV2ZW50LmVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIHJldHVybiBkaW1lbnNpb25NYXA7XG4gIH1cblxuICAvKipcbiAgICogQmF0Y2ggQUxMIG1ldHJpY3MgZnJvbSBhIHNpbmdsZSBldmVudCBpbnRvIE9ORSBFTUYgbG9nIGVudHJ5LlxuICAgKiBcbiAgICogT1BUSU1JWkFUSU9OOiBDb21iaW5lcyBldmVudC5tZXRyaWNzICsgc3BhbiBkdXJhdGlvbiBpbnRvIGEgU0lOR0xFIEVNRiBsb2dcbiAgICogQkVGT1JFIChpbmVmZmljaWVudCk6IDUgZXZlbnQgbWV0cmljcyArIDEgc3BhbiBkdXJhdGlvbiA9IDIgc2VwYXJhdGUgRU1GIGxvZ3NcbiAgICogQUZURVIgKG9wdGltaXplZCk6IDUgZXZlbnQgbWV0cmljcyArIDEgc3BhbiBkdXJhdGlvbiA9IDEgRU1GIGxvZyA9IDUwJSBjb3N0IHJlZHVjdGlvblxuICAgKiBcbiAgICogUEhBU0UgMjogQWxzbyBhcHBsaWVzIG1ldHJpYyBmaWx0ZXJpbmcgdG8gcmVkdWNlIHB1Ymxpc2hlZCBtZXRyaWNzXG4gICAqIFxuICAgKiBDbG91ZFdhdGNoIEVNRiBzdXBwb3J0cyB1cCB0byAxMDAgbWV0cmljcyBwZXIgbG9nIGVudHJ5LCBzbyBiYXRjaGluZ1xuICAgKiBpcyBhbG1vc3QgYWx3YXlzIGJldHRlciB0aGFuIGluZGl2aWR1YWwgbWV0cmljIGVtaXNzaW9uLlxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIG9ic2VydmFiaWxpdHkgZXZlbnQgY29udGFpbmluZyBtZXRyaWNzXG4gICAqIEBwYXJhbSBpbmNsdWRlU3BhbkR1cmF0aW9uIC0gV2hldGhlciB0byBpbmNsdWRlIHNwYW4gZHVyYXRpb24gaW4gdGhlIGJhdGNoXG4gICAqL1xuICAvKipcbiAgICogQmF0Y2ggQUxMIG1ldHJpY3MgZnJvbSBhIHNpbmdsZSBldmVudCBpbnRvIE9ORSBFTUYgbG9nIGVudHJ5LlxuICAgKiBcbiAgICogT1BUSU1JWkFUSU9OOiBDb21iaW5lcyBldmVudC5tZXRyaWNzICsgc3BhbiBkdXJhdGlvbiBpbnRvIGEgU0lOR0xFIEVNRiBsb2dcbiAgICogQkVGT1JFIChpbmVmZmljaWVudCk6IDUgZXZlbnQgbWV0cmljcyArIDEgc3BhbiBkdXJhdGlvbiA9IDIgc2VwYXJhdGUgRU1GIGxvZ3NcbiAgICogQUZURVIgKG9wdGltaXplZCk6IDUgZXZlbnQgbWV0cmljcyArIDEgc3BhbiBkdXJhdGlvbiA9IDEgRU1GIGxvZyA9IDUwJSBjb3N0IHJlZHVjdGlvblxuICAgKiBcbiAgICogUEhBU0UgMjogQWxzbyBhcHBsaWVzIG1ldHJpYyBmaWx0ZXJpbmcgdG8gcmVkdWNlIHB1Ymxpc2hlZCBtZXRyaWNzXG4gICAqIFBIQVNFIDM6IEFwcGxpZXMgb3BlcmF0aW9uLXNwZWNpZmljIG1ldHJpYyBydWxlcyBhbmQgZHluYW1pYyBuYW1lc3BhY2Ugc3RyYXRlZ3lcbiAgICogXG4gICAqIENsb3VkV2F0Y2ggRU1GIHN1cHBvcnRzIHVwIHRvIDEwMCBtZXRyaWNzIHBlciBsb2cgZW50cnksIHNvIGJhdGNoaW5nXG4gICAqIGlzIGFsbW9zdCBhbHdheXMgYmV0dGVyIHRoYW4gaW5kaXZpZHVhbCBtZXRyaWMgZW1pc3Npb24uXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgb2JzZXJ2YWJpbGl0eSBldmVudCBjb250YWluaW5nIG1ldHJpY3NcbiAgICogQHBhcmFtIGluY2x1ZGVTcGFuRHVyYXRpb24gLSBXaGV0aGVyIHRvIGluY2x1ZGUgc3BhbiBkdXJhdGlvbiBpbiB0aGUgYmF0Y2hcbiAgICovXG4gIHByaXZhdGUgaGFuZGxlTWV0cmljc0JhdGNoKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQsIGluY2x1ZGVTcGFuRHVyYXRpb246IGJvb2xlYW4gPSBmYWxzZSk6IHZvaWQge1xuICAgIGNvbnN0IGRpbWVuc2lvbk1hcCA9IHRoaXMuYnVpbGREaW1lbnNpb25zKGV2ZW50LCB0aGlzLmdldFNwYW5EaW1lbnNpb25zKGV2ZW50KSk7XG4gICAgY29uc3QgZGltZW5zaW9ucyA9IEFycmF5LmZyb20oZGltZW5zaW9uTWFwLmVudHJpZXMoKSkubWFwKChbIG5hbWUsIHZhbHVlIF0pID0+ICh7IG5hbWUsIHZhbHVlIH0pKTtcblxuICAgIHRyeSB7XG4gICAgICAvLyBQaGFzZSAzOiBHZXQgY29ycmVjdCBNZXRyaWNzIGluc3RhbmNlIGJhc2VkIG9uIG5hbWVzcGFjZSBzdHJhdGVneVxuICAgICAgY29uc3QgbWV0cmljc0luc3RhbmNlID0gdGhpcy5nZXRNZXRyaWNzRm9yRXZlbnQoZXZlbnQpO1xuXG4gICAgICAvLyBDcmVhdGUgT05FIG1ldHJpY3MgYmF0Y2ggZm9yIEFMTCBtZXRyaWNzIChldmVudCBtZXRyaWNzICsgc3BhbiBkdXJhdGlvbilcbiAgICAgIGNvbnN0IG1ldHJpY3NCYXRjaCA9IG1ldHJpY3NJbnN0YW5jZS5zaW5nbGVNZXRyaWMoKTtcblxuICAgICAgLy8gQWRkIGRpbWVuc2lvbnMgb25jZSAoc2hhcmVkIGJ5IGFsbCBtZXRyaWNzKVxuICAgICAgZm9yIChjb25zdCBkaW0gb2YgZGltZW5zaW9ucykge1xuICAgICAgICBtZXRyaWNzQmF0Y2guYWRkRGltZW5zaW9uKGRpbS5uYW1lLCBkaW0udmFsdWUpO1xuICAgICAgfVxuXG4gICAgICBsZXQgbWV0cmljc0FkZGVkID0gMDtcblxuICAgICAgLy8gUGhhc2UgMiAmIDM6IEFkZCBldmVudCBtZXRyaWNzIHdpdGggZmlsdGVyaW5nIChvcGVyYXRpb24tc3BlY2lmaWMgb3IgZ2xvYmFsKVxuICAgICAgaWYgKGV2ZW50Lm1ldHJpY3MgJiYgT2JqZWN0LmtleXMoZXZlbnQubWV0cmljcykubGVuZ3RoID4gMCkge1xuICAgICAgICBmb3IgKGNvbnN0IFsgbmFtZSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC5tZXRyaWNzKSkge1xuICAgICAgICAgIC8vIFBoYXNlIDM6IENoZWNrIGlmIHRoaXMgbWV0cmljIHNob3VsZCBiZSBwdWJsaXNoZWQgKG9wZXJhdGlvbi1zcGVjaWZpYyBvciBnbG9iYWwpXG4gICAgICAgICAgaWYgKCF0aGlzLnNob3VsZFB1Ymxpc2hNZXRyaWMobmFtZSwgZXZlbnQpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCB1bml0ID0gdGhpcy5nZXRNZXRyaWNVbml0KG5hbWUsIGV2ZW50LmF0dHJpYnV0ZXM/LnVuaXQgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKTtcbiAgICAgICAgICBtZXRyaWNzQmF0Y2guYWRkTWV0cmljKG5hbWUsIHVuaXQsIHZhbHVlKTtcbiAgICAgICAgICBtZXRyaWNzQWRkZWQrKztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBQaGFzZSAyICYgMzogQWRkIHNwYW4gZHVyYXRpb24gd2l0aCBmaWx0ZXJpbmdcbiAgICAgIGlmIChpbmNsdWRlU3BhbkR1cmF0aW9uICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBDaGVjayBpZiAnZHVyYXRpb24nIG1ldHJpYyBzaG91bGQgYmUgcHVibGlzaGVkXG4gICAgICAgIGlmICh0aGlzLnNob3VsZFB1Ymxpc2hNZXRyaWMoJ2R1cmF0aW9uJywgZXZlbnQpKSB7XG4gICAgICAgICAgbWV0cmljc0JhdGNoLmFkZE1ldHJpYygnZHVyYXRpb24nLCBNZXRyaWNVbml0Lk1pbGxpc2Vjb25kcywgZXZlbnQuZHVyYXRpb25Ncyk7XG4gICAgICAgICAgbWV0cmljc0FkZGVkKys7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gT25seSBwdWJsaXNoIGlmIHdlIGhhdmUgbWV0cmljcyB0byBwdWJsaXNoIChhZnRlciBmaWx0ZXJpbmcpXG4gICAgICBpZiAobWV0cmljc0FkZGVkID09PSAwKSB7XG4gICAgICAgIGludGVybmFsTG9nZ2VyLmRlYnVnKCdObyBtZXRyaWNzIHRvIHB1Ymxpc2ggYWZ0ZXIgZmlsdGVyaW5nJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIEVNRiB3aWxsIHB1Ymxpc2ggT05FIGxvZyBlbnRyeSB3aXRoIEFMTCBtZXRyaWNzIChtYXNzaXZlIGNvc3Qgc2F2aW5ncyEpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGludGVybmFsTG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBwdWJsaXNoIG1ldHJpY3MgYmF0Y2g6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgc3Bhbi1zcGVjaWZpYyBkaW1lbnNpb25zIChvcGVyYXRpb24sIHNvdXJjZSwgc3VjY2VzcylcbiAgICovXG4gIHByaXZhdGUgZ2V0U3BhbkRpbWVuc2lvbnMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQge1xuICAgIGlmIChldmVudC50eXBlICE9PSAnc3BhbicpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBkaW1lbnNpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikgZGltZW5zaW9ucy5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgaWYgKGV2ZW50LnNvdXJjZSkgZGltZW5zaW9ucy5zb3VyY2UgPSBldmVudC5zb3VyY2U7XG4gICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkgZGltZW5zaW9ucy5zdWNjZXNzID0gU3RyaW5nKGV2ZW50LnN1Y2Nlc3MpO1xuXG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKGRpbWVuc2lvbnMpLmxlbmd0aCA+IDAgPyBkaW1lbnNpb25zIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZSB0aGUgY29ycmVjdCB1bml0IGZvciBhIG1ldHJpYy5cbiAgICogQWxsb3dzIHBlci1tZXRyaWMgdW5pdCBvdmVycmlkZSB2aWEgbmFtaW5nIGNvbnZlbnRpb25zLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRNZXRyaWNVbml0KG1ldHJpY05hbWU6IHN0cmluZywgZGVmYXVsdFVuaXQ/OiBzdHJpbmcpOiB0eXBlb2YgTWV0cmljVW5pdFsga2V5b2YgdHlwZW9mIE1ldHJpY1VuaXQgXSB7XG4gICAgLy8gUGVyLW1ldHJpYyB1bml0IGRldGVjdGlvbiBiYXNlZCBvbiBuYW1lIHBhdHRlcm5zXG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2R1cmF0aW9uJykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygnbGF0ZW5jeScpIHx8IG1ldHJpY05hbWUuZW5kc1dpdGgoJ01zJykpIHtcbiAgICAgIHJldHVybiBNZXRyaWNVbml0Lk1pbGxpc2Vjb25kcztcbiAgICB9XG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2NvdW50JykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygndG90YWwnKSB8fCBtZXRyaWNOYW1lLmVuZHNXaXRoKCdDb3VudCcpKSB7XG4gICAgICByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcbiAgICB9XG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2J5dGVzJykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygnc2l6ZScpIHx8IG1ldHJpY05hbWUuZW5kc1dpdGgoJ0J5dGVzJykpIHtcbiAgICAgIHJldHVybiBNZXRyaWNVbml0LkJ5dGVzO1xuICAgIH1cbiAgICBpZiAobWV0cmljTmFtZS5pbmNsdWRlcygncGVyY2VudCcpIHx8IG1ldHJpY05hbWUuaW5jbHVkZXMoJ3JhdGUnKSkge1xuICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuUGVyY2VudDtcbiAgICB9XG5cbiAgICAvLyBGYWxsIGJhY2sgdG8gZGVmYXVsdCB1bml0IG9yIENvdW50XG4gICAgcmV0dXJuIHRoaXMubWFwVW5pdChkZWZhdWx0VW5pdCk7XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaCBzcGFuIGR1cmF0aW9uIGFzIGEgQ2xvdWRXYXRjaCBtZXRyaWMuXG4gICAqIEFsbG93cyBjcmVhdGluZyBkYXNoYm9hcmRzL2FsYXJtcyBvbiBvcGVyYXRpb24gZHVyYXRpb25zLlxuICAgKiBVc2VzIGJ1aWxkRGltZW5zaW9ucygpIHRvIGVuc3VyZSBwcm9wZXIgZGVkdXBsaWNhdGlvbiB3aXRoIGV2ZW50LnRhZ3MuXG4gICAqL1xuICBwcml2YXRlIHB1Ymxpc2hTcGFuRHVyYXRpb25NZXRyaWMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZHVyYXRpb25NcyB8fCAhZXZlbnQub3BlcmF0aW9uKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgLy8gQnVpbGQgZXhwbGljaXQgZGltZW5zaW9ucyBmb3Igc3BhbiBtZXRyaWNzXG4gICAgICBjb25zdCBleHBsaWNpdERpbWVuc2lvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICAgICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMub3BlcmF0aW9uID0gZXZlbnQub3BlcmF0aW9uO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LnNvdXJjZSkge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMuc291cmNlID0gZXZlbnQuc291cmNlO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMuc3VjY2VzcyA9IFN0cmluZyhldmVudC5zdWNjZXNzKTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5lbnRpdHlOYW1lKSB7XG4gICAgICAgIGV4cGxpY2l0RGltZW5zaW9ucy5lbnRpdHlOYW1lID0gZXZlbnQuZW50aXR5TmFtZTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5hY3Rvcj8udGVuYW50SWQpIHtcbiAgICAgICAgZXhwbGljaXREaW1lbnNpb25zLnRlbmFudElkID0gZXZlbnQuYWN0b3IudGVuYW50SWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIFVzZSBidWlsZERpbWVuc2lvbnMgdG8gcHJvcGVybHkgZGVkdXBsaWNhdGUgd2l0aCB0YWdzXG4gICAgICBjb25zdCBkaW1lbnNpb25NYXAgPSB0aGlzLmJ1aWxkRGltZW5zaW9ucyhldmVudCwgZXhwbGljaXREaW1lbnNpb25zKTtcbiAgICAgIGNvbnN0IHNpbmdsZU1ldHJpYyA9IHRoaXMubWV0cmljcy5zaW5nbGVNZXRyaWMoKTtcblxuICAgICAgZm9yIChjb25zdCBbIG5hbWUsIHZhbHVlIF0gb2YgZGltZW5zaW9uTWFwLmVudHJpZXMoKSkge1xuICAgICAgICBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKG5hbWUsIHZhbHVlKTtcbiAgICAgIH1cblxuICAgICAgc2luZ2xlTWV0cmljLmFkZE1ldHJpYygnc3Bhbi5kdXJhdGlvbicsIE1ldHJpY1VuaXQuTWlsbGlzZWNvbmRzLCBldmVudC5kdXJhdGlvbk1zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaW50ZXJuYWxMb2dnZXIud2FybignRmFpbGVkIHRvIHB1Ymxpc2ggc3BhbiBkdXJhdGlvbiBtZXRyaWM6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBBdm9pZCBub2lzeSBwb3dlcnRvb2xzIHdhcm5pbmcgd2hlbiBubyBtZXRyaWNzIHdlcmUgcmVjb3JkZWQuXG4gICAgICBpZiAoIXRoaXMuaGFzQW55TWV0cmljcykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIFBoYXNlIDM6IFB1Ymxpc2ggbWV0cmljcyBmcm9tIGFsbCBuYW1lc3BhY2UgaW5zdGFuY2VzXG4gICAgICAvLyBEZWZhdWx0IG5hbWVzcGFjZVxuICAgICAgdGhpcy5tZXRyaWNzLnB1Ymxpc2hTdG9yZWRNZXRyaWNzKCk7XG5cbiAgICAgIC8vIENhY2hlZCBuYW1lc3BhY2VzIChpZiBhbnkpXG4gICAgICBmb3IgKGNvbnN0IG1ldHJpY3NJbnN0YW5jZSBvZiB0aGlzLm1ldHJpY3NDYWNoZS52YWx1ZXMoKSkge1xuICAgICAgICBtZXRyaWNzSW5zdGFuY2UucHVibGlzaFN0b3JlZE1ldHJpY3MoKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5oYXNBbnlNZXRyaWNzID0gZmFsc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGludGVybmFsTG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcHVibGlzaCBtZXRyaWNzOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBQb3dlcnRvb2xzIGhhbmRsZXMgcGVyLWludm9jYXRpb24gc3RhdGUgYXV0b21hdGljYWxseVxuICAgIHRoaXMuaGFzQW55TWV0cmljcyA9IGZhbHNlO1xuICAgIC8vIE5vdGU6IFdlIERPTidUIGNsZWFyIG1ldHJpY3NDYWNoZSAtIGl0J3Mgc2FmZSB0byByZXVzZSBhY3Jvc3MgaW52b2NhdGlvbnNcbiAgfVxuXG4gIHByaXZhdGUgbWFwVW5pdCh1bml0Pzogc3RyaW5nKTogKHR5cGVvZiBNZXRyaWNVbml0KVsga2V5b2YgdHlwZW9mIE1ldHJpY1VuaXQgXSB7XG4gICAgaWYgKCF1bml0KSByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB1bml0LnRvTG93ZXJDYXNlKCk7XG5cbiAgICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICAgIGNhc2UgJ3NlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5TZWNvbmRzO1xuICAgICAgY2FzZSAnbWlsbGlzZWNvbmRzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWlsbGlzZWNvbmRzO1xuICAgICAgY2FzZSAnbWljcm9zZWNvbmRzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWljcm9zZWNvbmRzO1xuICAgICAgY2FzZSAnYnl0ZXMnOiByZXR1cm4gTWV0cmljVW5pdC5CeXRlcztcbiAgICAgIGNhc2UgJ2tpbG9ieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlcztcbiAgICAgIGNhc2UgJ21lZ2FieXRlcyc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlcztcbiAgICAgIGNhc2UgJ2dpZ2FieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlcztcbiAgICAgIGNhc2UgJ3BlcmNlbnQnOiByZXR1cm4gTWV0cmljVW5pdC5QZXJjZW50O1xuICAgICAgY2FzZSAnYml0cyc6IHJldHVybiBNZXRyaWNVbml0LkJpdHM7XG4gICAgICBjYXNlICdiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdieXRlcy9zZWNvbmQnOiByZXR1cm4gTWV0cmljVW5pdC5CeXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2tpbG9iaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LktpbG9iaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAna2lsb2J5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ21lZ2FiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2dpZ2FiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ3RlcmFiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LlRlcmFiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAndGVyYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LlRlcmFieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2NvdW50L3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkNvdW50UGVyU2Vjb25kO1xuICAgICAgZGVmYXVsdDogcmV0dXJuIE1ldHJpY1VuaXQuQ291bnQ7XG4gICAgfVxuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFBIQVNFIDI6IENvc3QgT3B0aW1pemF0aW9uIExvZ2ljXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBQaGFzZSAyIE9wdGltaXphdGlvbjogTWV0cmljIFNhbXBsaW5nXG4gICAqIFxuICAgKiBEZXRlcm1pbmVzIGlmIG1ldHJpY3Mgc2hvdWxkIGJlIHB1Ymxpc2hlZCBmb3IgdGhpcyBldmVudCBiYXNlZCBvbiBzYW1wbGluZyBjb25maWcuXG4gICAqIFxuICAgKiBTdHJhdGVneTpcbiAgICogLSBBbHdheXMgcHVibGlzaDogZXJyb3JzLCBzbG93IG9wZXJhdGlvbnMgKGNyaXRpY2FsIHNpZ25hbHMpXG4gICAqIC0gU2FtcGxlOiBmYXN0LCBzdWNjZXNzZnVsIG9wZXJhdGlvbnMgKHJvdXRpbmUgdHJhZmZpYylcbiAgICogLSBOZXZlciBzYW1wbGU6IGNvbmZpZ3VyZWQgb3BlcmF0aW9ucyAoZS5nLiwgcGF5bWVudHMsIGNyaXRpY2FsIHBhdGhzKVxuICAgKi9cbiAgcHJpdmF0ZSBzaG91bGRQdWJsaXNoTWV0cmljcyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogYm9vbGVhbiB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5jb25maWcubWV0cmljU2FtcGxpbmc7XG5cbiAgICAvLyBJZiBzYW1wbGluZyBkaXNhYmxlZCwgYWx3YXlzIHB1Ymxpc2hcbiAgICBpZiAoIWNvbmZpZyB8fCAhY29uZmlnLmVuYWJsZWQpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG9wZXJhdGlvbiA9IGV2ZW50Lm9wZXJhdGlvbiB8fCAnJztcblxuICAgIC8vIENoZWNrIG5ldmVyU2FtcGxlIGxpc3QgKGFsd2F5cyBwdWJsaXNoKVxuICAgIGlmIChjb25maWcubmV2ZXJTYW1wbGUgJiYgdGhpcy5tYXRjaGVzUGF0dGVybnMob3BlcmF0aW9uLCBjb25maWcubmV2ZXJTYW1wbGUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBhbHdheXNTYW1wbGUgbGlzdCAobmV2ZXIgcHVibGlzaCB1bmxlc3MgZXJyb3Ivc2xvdylcbiAgICBpZiAoY29uZmlnLmFsd2F5c1NhbXBsZSAmJiB0aGlzLm1hdGNoZXNQYXR0ZXJucyhvcGVyYXRpb24sIGNvbmZpZy5hbHdheXNTYW1wbGUpKSB7XG4gICAgICAvLyBDb250aW51ZSB0byBjaGVjayBpZiBpdCdzIGFuIGVycm9yIG9yIHNsb3cgb3BlcmF0aW9uXG4gICAgfVxuXG4gICAgY29uc3QgYWx3YXlzUHVibGlzaE9uID0gY29uZmlnLmFsd2F5c1B1Ymxpc2hPbiB8fCAnYm90aCc7XG5cbiAgICAvLyBBbHdheXMgcHVibGlzaCBvbiBlcnJvclxuICAgIGlmICgoZXZlbnQuc3VjY2VzcyA9PT0gZmFsc2UgfHwgZXZlbnQuZXJyb3IpICYmXG4gICAgICAoYWx3YXlzUHVibGlzaE9uID09PSAnZXJyb3InIHx8IGFsd2F5c1B1Ymxpc2hPbiA9PT0gJ2JvdGgnKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gQWx3YXlzIHB1Ymxpc2ggb24gc2xvdyBvcGVyYXRpb25zXG4gICAgY29uc3Qgc2xvd1RocmVzaG9sZCA9IGNvbmZpZy50aHJlc2hvbGRzPy5zbG93RHVyYXRpb25NcyB8fCAxMDAwO1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQgJiYgZXZlbnQuZHVyYXRpb25NcyA+PSBzbG93VGhyZXNob2xkICYmXG4gICAgICAoYWx3YXlzUHVibGlzaE9uID09PSAnc2xvdycgfHwgYWx3YXlzUHVibGlzaE9uID09PSAnYm90aCcpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBTYW1wbGUgcm91dGluZSBvcGVyYXRpb25zIGJhc2VkIG9uIHJhdGVcbiAgICBjb25zdCBzYW1wbGVSYXRlID0gY29uZmlnLnJhdGUgfHwgMC4xO1xuICAgIHJldHVybiBNYXRoLnJhbmRvbSgpIDwgc2FtcGxlUmF0ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQaGFzZSAyICYgMyBPcHRpbWl6YXRpb246IE1ldHJpYyBGaWx0ZXJpbmdcbiAgICogXG4gICAqIERldGVybWluZXMgaWYgYSBzcGVjaWZpYyBtZXRyaWMgc2hvdWxkIGJlIHB1Ymxpc2hlZCBiYXNlZCBvbiBmaWx0ZXJpbmcgY29uZmlnLlxuICAgKiBcbiAgICogUGhhc2UgMzogU3VwcG9ydHMgb3BlcmF0aW9uLXNwZWNpZmljIHJ1bGVzIChmaXJzdCBtYXRjaCB3aW5zKS5cbiAgICogSWYgbm8gb3BlcmF0aW9uLXNwZWNpZmljIHJ1bGUgbWF0Y2hlcywgZmFsbHMgYmFjayB0byBnbG9iYWwgcnVsZXMuXG4gICAqIFxuICAgKiBAcGFyYW0gbWV0cmljTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBtZXRyaWMgdG8gY2hlY2tcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIG9ic2VydmFiaWxpdHkgZXZlbnQgKGZvciBvcGVyYXRpb24tc3BlY2lmaWMgcnVsZXMpXG4gICAqIEByZXR1cm5zIHRydWUgaWYgdGhlIG1ldHJpYyBzaG91bGQgYmUgcHVibGlzaGVkLCBmYWxzZSBvdGhlcndpc2VcbiAgICovXG4gIHByaXZhdGUgc2hvdWxkUHVibGlzaE1ldHJpYyhtZXRyaWNOYW1lOiBzdHJpbmcsIGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBib29sZWFuIHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmNvbmZpZy5tZXRyaWNGaWx0ZXJpbmc7XG5cbiAgICAvLyBJZiBmaWx0ZXJpbmcgZGlzYWJsZWQsIGFsd2F5cyBwdWJsaXNoXG4gICAgaWYgKCFjb25maWcgfHwgIWNvbmZpZy5lbmFibGVkKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBQaGFzZSAzOiBDaGVjayBvcGVyYXRpb24tc3BlY2lmaWMgcnVsZXMgZmlyc3RcbiAgICBpZiAoY29uZmlnLm9wZXJhdGlvblJ1bGVzICYmIGNvbmZpZy5vcGVyYXRpb25SdWxlcy5sZW5ndGggPiAwICYmIGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgZm9yIChjb25zdCBydWxlIG9mIGNvbmZpZy5vcGVyYXRpb25SdWxlcykge1xuICAgICAgICBpZiAodGhpcy5tYXRjaGVzT3BlcmF0aW9uUGF0dGVybihldmVudC5vcGVyYXRpb24sIHJ1bGUub3BlcmF0aW9uKSkge1xuICAgICAgICAgIC8vIE1hdGNoZWQgb3BlcmF0aW9uLXNwZWNpZmljIHJ1bGUgLSBldmFsdWF0ZSBpdFxuICAgICAgICAgIHJldHVybiB0aGlzLmV2YWx1YXRlTWV0cmljUnVsZShtZXRyaWNOYW1lLCBydWxlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE5vIG9wZXJhdGlvbi1zcGVjaWZpYyBydWxlIG1hdGNoZWQgLSB1c2UgZ2xvYmFsIHJ1bGVzXG4gICAgcmV0dXJuIHRoaXMuZXZhbHVhdGVNZXRyaWNSdWxlKG1ldHJpY05hbWUsIGNvbmZpZyk7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgb3BlcmF0aW9uIG1hdGNoZXMgYSBwYXR0ZXJuIChzdHJpbmcgb3IgUmVnRXhwKS5cbiAgICovXG4gIHByaXZhdGUgbWF0Y2hlc09wZXJhdGlvblBhdHRlcm4ob3BlcmF0aW9uOiBzdHJpbmcsIHBhdHRlcm46IHN0cmluZyB8IFJlZ0V4cCk6IGJvb2xlYW4ge1xuICAgIGlmIChwYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICByZXR1cm4gcGF0dGVybi50ZXN0KG9wZXJhdGlvbik7XG4gICAgfVxuXG4gICAgLy8gU3RyaW5nIHBhdHRlcm4gd2l0aCB3aWxkY2FyZCBzdXBwb3J0XG4gICAgcmV0dXJuIHRoaXMubWF0Y2hlc1BhdHRlcm5zKG9wZXJhdGlvbiwgWyBwYXR0ZXJuIF0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEV2YWx1YXRlIGEgbWV0cmljIGFnYWluc3QgZmlsdGVyaW5nIHJ1bGVzICh3aGl0ZWxpc3QvYmxhY2tsaXN0L3BhdHRlcm5zKS5cbiAgICovXG4gIHByaXZhdGUgZXZhbHVhdGVNZXRyaWNSdWxlKFxuICAgIG1ldHJpY05hbWU6IHN0cmluZyxcbiAgICBydWxlOiB7IHdoaXRlbGlzdD86IHN0cmluZ1tdOyBibGFja2xpc3Q/OiBzdHJpbmdbXTsgcGF0dGVybnM/OiB7IGluY2x1ZGU/OiBSZWdFeHBbXTsgZXhjbHVkZT86IFJlZ0V4cFtdIH0gfVxuICApOiBib29sZWFuIHtcbiAgICAvLyBDaGVjayBwYXR0ZXJucyBmaXJzdCAobW9zdCBmbGV4aWJsZSlcbiAgICBpZiAocnVsZS5wYXR0ZXJucykge1xuICAgICAgY29uc3QgeyBpbmNsdWRlLCBleGNsdWRlIH0gPSBydWxlLnBhdHRlcm5zO1xuXG4gICAgICAvLyBJZiBpbmNsdWRlIHBhdHRlcm5zIGV4aXN0LCBtZXRyaWMgbXVzdCBtYXRjaCBhdCBsZWFzdCBvbmVcbiAgICAgIGlmIChpbmNsdWRlICYmIGluY2x1ZGUubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBtYXRjaGVzSW5jbHVkZSA9IGluY2x1ZGUuc29tZShwYXR0ZXJuID0+IHBhdHRlcm4udGVzdChtZXRyaWNOYW1lKSk7XG4gICAgICAgIGlmICghbWF0Y2hlc0luY2x1ZGUpIHJldHVybiBmYWxzZTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgZXhjbHVkZSBwYXR0ZXJucyBleGlzdCwgbWV0cmljIG11c3Qgbm90IG1hdGNoIGFueVxuICAgICAgaWYgKGV4Y2x1ZGUgJiYgZXhjbHVkZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoZXNFeGNsdWRlID0gZXhjbHVkZS5zb21lKHBhdHRlcm4gPT4gcGF0dGVybi50ZXN0KG1ldHJpY05hbWUpKTtcbiAgICAgICAgaWYgKG1hdGNoZXNFeGNsdWRlKSByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIENoZWNrIHdoaXRlbGlzdCAoT05MWSB0aGVzZSBtZXRyaWNzKVxuICAgIGlmIChydWxlLndoaXRlbGlzdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBFbXB0eSB3aGl0ZWxpc3QgW10gPSBubyBtZXRyaWNzIGFsbG93ZWRcbiAgICAgIGlmIChydWxlLndoaXRlbGlzdC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMubWF0Y2hlc1BhdHRlcm5zKG1ldHJpY05hbWUsIHJ1bGUud2hpdGVsaXN0KTtcbiAgICB9XG5cbiAgICAvLyBDaGVjayBibGFja2xpc3QgKGFsbCBFWENFUFQgdGhlc2UpXG4gICAgaWYgKHJ1bGUuYmxhY2tsaXN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIEVtcHR5IGJsYWNrbGlzdCBbXSA9IGFsbCBtZXRyaWNzIGFsbG93ZWRcbiAgICAgIGlmIChydWxlLmJsYWNrbGlzdC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gIXRoaXMubWF0Y2hlc1BhdHRlcm5zKG1ldHJpY05hbWUsIHJ1bGUuYmxhY2tsaXN0KTtcbiAgICB9XG5cbiAgICAvLyBObyBydWxlcyBzcGVjaWZpZWQgLSBwdWJsaXNoXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgYSBzdHJpbmcgbWF0Y2hlcyBhbnkgb2YgdGhlIGdsb2IgcGF0dGVybnMuXG4gICAqIFN1cHBvcnRzIGV4YWN0IG1hdGNoZXMgYW5kIHNpbXBsZSBnbG9iIHBhdHRlcm5zICgqLCA/KS5cbiAgICovXG4gIHByaXZhdGUgbWF0Y2hlc1BhdHRlcm5zKHZhbHVlOiBzdHJpbmcsIHBhdHRlcm5zOiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBwYXR0ZXJucy5zb21lKChwYXR0ZXJuOiBzdHJpbmcpID0+IHtcbiAgICAgIC8vIEV4YWN0IG1hdGNoXG4gICAgICBpZiAocGF0dGVybiA9PT0gdmFsdWUpIHJldHVybiB0cnVlO1xuXG4gICAgICAvLyBDb252ZXJ0IGdsb2IgdG8gcmVnZXhcbiAgICAgIGNvbnN0IHJlZ2V4UGF0dGVybiA9IHBhdHRlcm5cbiAgICAgICAgLnJlcGxhY2UoL1xcLi9nLCAnXFxcXC4nKSAgLy8gRXNjYXBlIGRvdHNcbiAgICAgICAgLnJlcGxhY2UoL1xcKi9nLCAnLionKSAgICAvLyAqIG1hdGNoZXMgYW55dGhpbmdcbiAgICAgICAgLnJlcGxhY2UoL1xcPy9nLCAnLicpOyAgICAvLyA/IG1hdGNoZXMgc2luZ2xlIGNoYXJcblxuICAgICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKGBeJHtyZWdleFBhdHRlcm59JGApO1xuICAgICAgcmV0dXJuIHJlZ2V4LnRlc3QodmFsdWUpO1xuICAgIH0pO1xuICB9XG5cbn1cbiJdfQ==