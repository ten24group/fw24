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
const MAX_DIMENSIONS = 10;
const MAX_DIMENSION_NAME_LENGTH = 256;
const MAX_DIMENSION_VALUE_LENGTH = 1024;
let CloudWatchBackend = class CloudWatchBackend {
    name = 'cloudwatch';
    minLevel;
    logger;
    metrics;
    hasAnyMetrics = false;
    constructor(serviceName, namespace, minLevel) {
        this.minLevel = minLevel;
        this.logger = new logger_1.Logger({
            serviceName: serviceName,
            logLevel: (0, level_utils_1.levelToPowertoolsLogLevel)(minLevel),
        });
        this.metrics = new metrics_1.Metrics({
            namespace: namespace,
            serviceName: serviceName,
        });
    }
    async capture(event) {
        try {
            // Batch ALL metrics (event.metrics + span duration) into a SINGLE EMF log
            const hasEventMetrics = event.metrics && Object.keys(event.metrics).length > 0;
            const hasSpanDuration = event.type === 'span' && event.durationMs !== undefined && !event.metrics?.duration;
            if (hasEventMetrics || hasSpanDuration) {
                this.hasAnyMetrics = true;
                // Combine both into one batched metric call
                this.handleMetricsBatch(event, hasSpanDuration);
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
     * Priority order (first occurrence wins):
     * 1. Tags (highest priority - user-specified)
     * 2. Explicit dimension overrides (passed as parameter)
     * 3. Attributes (if string values)
     * 4. Entity context (entityName)
     *
     * @param event - Observability event
     * @param explicitDimensions - Explicit dimensions to add (e.g., operation, source, success)
     * @returns Deduplicated dimension map
     */
    buildDimensions(event, explicitDimensions) {
        const dimensionMap = new Map();
        // Priority 1: Add common dimensions from tags (tenant, entity, operation, etc.)
        if (event.tags) {
            for (const [key, value] of Object.entries(event.tags)) {
                if (dimensionMap.size >= MAX_DIMENSIONS)
                    break;
                if (typeof value === 'string' && !dimensionMap.has(key)) {
                    dimensionMap.set(key.slice(0, MAX_DIMENSION_NAME_LENGTH), value.slice(0, MAX_DIMENSION_VALUE_LENGTH));
                }
            }
        }
        // Priority 2: Add explicit dimensions (only if not already present)
        if (explicitDimensions) {
            for (const [key, value] of Object.entries(explicitDimensions)) {
                if (dimensionMap.size >= MAX_DIMENSIONS)
                    break;
                if (!dimensionMap.has(key)) {
                    dimensionMap.set(key.slice(0, MAX_DIMENSION_NAME_LENGTH), value.slice(0, MAX_DIMENSION_VALUE_LENGTH));
                }
            }
        }
        // Priority 3: Add dimensions from attributes (only if not already present)
        if (event.attributes) {
            for (const [key, value] of Object.entries(event.attributes)) {
                if (dimensionMap.size >= MAX_DIMENSIONS) {
                    internalLogger.warn(`Dimension limit reached (${MAX_DIMENSIONS}), skipping remaining attributes`);
                    break;
                }
                if (typeof value !== 'string')
                    continue;
                const dimName = key.slice(0, MAX_DIMENSION_NAME_LENGTH);
                const dimValue = value.slice(0, MAX_DIMENSION_VALUE_LENGTH);
                // Only add if not already present (deduplication)
                if (!dimensionMap.has(dimName)) {
                    dimensionMap.set(dimName, dimValue);
                }
            }
        }
        // Priority 4: Add entity context as dimension (only if not already present)
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
            // Create ONE metrics batch for ALL metrics (event metrics + span duration)
            const metricsBatch = this.metrics.singleMetric();
            // Add dimensions once (shared by all metrics)
            for (const dim of dimensions) {
                metricsBatch.addDimension(dim.name, dim.value);
            }
            // Add all event metrics to the batch
            if (event.metrics && Object.keys(event.metrics).length > 0) {
                for (const [name, value] of Object.entries(event.metrics)) {
                    const unit = this.getMetricUnit(name, event.attributes?.unit);
                    metricsBatch.addMetric(name, unit, value);
                }
            }
            // Add span duration to the SAME batch (if requested)
            if (includeSpanDuration && event.durationMs !== undefined) {
                metricsBatch.addMetric('duration', metrics_1.MetricUnit.Milliseconds, event.durationMs);
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
            this.metrics.publishStoredMetrics();
            this.hasAnyMetrics = false;
        }
        catch (error) {
            internalLogger.error('Failed to publish metrics:', error);
        }
    }
    initializeInvocation() {
        // Powertools handles per-invocation state automatically
        this.hasAnyMetrics = false;
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
};
exports.CloudWatchBackend = CloudWatchBackend;
exports.CloudWatchBackend = CloudWatchBackend = __decorate([
    (0, di_1.Injectable)({
        provide: 'ObservabilityBackend',
        providedIn: 'ROOT',
        tags: ['observability', 'backend', 'cloudwatch']
    }),
    __param(0, (0, di_1.InjectConfig)('observability.serviceName')),
    __param(1, (0, di_1.InjectConfig)('observability.cloudwatch.namespace')),
    __param(2, (0, di_1.InjectConfig)('observability.minLevel'))
], CloudWatchBackend);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7Ozs7Ozs7Ozs7QUFFSCwwREFBdUQ7QUFDdkQsNERBQXFFO0FBQ3JFLGlDQUFvRDtBQUNwRCwyQ0FBNkM7QUFFN0Msc0RBQWlFO0FBRWpFLE1BQU0sY0FBYyxHQUFHLElBQUEsc0JBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXpELG9CQUFvQjtBQUNwQixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUM7QUFDMUIsTUFBTSx5QkFBeUIsR0FBRyxHQUFHLENBQUM7QUFDdEMsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUM7QUFPakMsSUFBTSxpQkFBaUIsR0FBdkIsTUFBTSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBQ2pCLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFFOUIsWUFDNkMsV0FBbUIsRUFDVixTQUFpQixFQUM3QixRQUE0QjtRQUVwRSxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUV6QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksZUFBTSxDQUFDO1lBQ3ZCLFdBQVcsRUFBRSxXQUFXO1lBQ3hCLFFBQVEsRUFBRSxJQUFBLHVDQUF5QixFQUFDLFFBQVEsQ0FBQztTQUU5QyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksaUJBQU8sQ0FBQztZQUN6QixTQUFTLEVBQUUsU0FBUztZQUNwQixXQUFXLEVBQUUsV0FBVztTQUN6QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUF5QjtRQUNyQyxJQUFJLENBQUM7WUFDSCwwRUFBMEU7WUFDMUUsTUFBTSxlQUFlLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1lBQy9FLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxJQUFJLEtBQUssTUFBTSxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUM7WUFFNUcsSUFBSSxlQUFlLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQ3ZDLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDO2dCQUMxQiw0Q0FBNEM7Z0JBQzVDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFDbEQsQ0FBQztZQUVELHFFQUFxRTtZQUNyRSxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDeEIsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsY0FBYyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM1RCxDQUFDO0lBQ0gsQ0FBQztJQUVPLFNBQVMsQ0FBQyxLQUF5QjtRQUN6QyxNQUFNLE9BQU8sR0FBNEI7WUFDdkMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1lBQ2hCLGFBQWEsRUFBRSxLQUFLLENBQUMsYUFBYTtZQUNsQyxrQkFBa0IsRUFBRSxLQUFLLENBQUMsa0JBQWtCO1NBQzdDLENBQUM7UUFFRixJQUFJLEtBQUssQ0FBQyxVQUFVO1lBQUUsT0FBTyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFDO1FBQzVELElBQUksS0FBSyxDQUFDLFFBQVE7WUFBRSxPQUFPLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUM7UUFDdEQsSUFBSSxLQUFLLENBQUMsU0FBUztZQUFFLE9BQU8sQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUN6RCxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUztZQUFFLE9BQU8sQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQztRQUMxRSxJQUFJLEtBQUssQ0FBQyxPQUFPLEtBQUssU0FBUztZQUFFLE9BQU8sQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLE9BQU8sQ0FBQztRQUNqRSxJQUFJLEtBQUssQ0FBQyxNQUFNO1lBQUUsT0FBTyxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO1FBQ2hELElBQUksS0FBSyxDQUFDLHdCQUF3QjtZQUFFLE9BQU8sQ0FBQyx3QkFBd0IsR0FBRyxLQUFLLENBQUMsd0JBQXdCLENBQUM7UUFDdEcsSUFBSSxLQUFLLENBQUMsUUFBUTtZQUFFLE9BQU8sQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQztRQUN0RCxJQUFJLEtBQUssQ0FBQyxhQUFhO1lBQUUsT0FBTyxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUMsYUFBYSxDQUFDO1FBQ3JFLElBQUksS0FBSyxDQUFDLE1BQU07WUFBRSxPQUFPLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7UUFDaEQsSUFBSSxLQUFLLENBQUMsSUFBSTtZQUFFLE9BQU8sQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQztRQUMxQyxJQUFJLEtBQUssQ0FBQyxVQUFVO1lBQUUsT0FBTyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFDO1FBQzVELElBQUksS0FBSyxDQUFDLElBQUk7WUFBRSxPQUFPLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUM7UUFDMUMsSUFBSSxLQUFLLENBQUMsS0FBSztZQUFFLE9BQU8sQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQztRQUM3QyxJQUFJLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNoQixNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDO1lBQzFCLElBQUksS0FBSyxDQUFDLE9BQU87Z0JBQUUsT0FBTyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDO1lBQ25ELElBQUksS0FBSyxDQUFDLFNBQVM7Z0JBQUUsT0FBTyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQ3pELElBQUksS0FBSyxDQUFDLFFBQVE7Z0JBQUUsT0FBTyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDO1lBQ3RELElBQUksS0FBSyxDQUFDLFNBQVM7Z0JBQUUsT0FBTyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQ3pELElBQUksS0FBSyxDQUFDLEtBQUs7Z0JBQUUsT0FBTyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDO1lBQ2xELElBQUksS0FBSyxDQUFDLFFBQVE7Z0JBQUUsT0FBTyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDO1lBQ3RELElBQUksS0FBSyxDQUFDLFNBQVM7Z0JBQUUsT0FBTyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1FBQzNELENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzNDLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDakQsQ0FBQztJQUVPLGNBQWMsQ0FBQyxLQUF5QjtRQUM5QyxJQUFJLEtBQUssQ0FBQyxJQUFJLElBQUksT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN6RCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDO1FBQzVCLENBQUM7UUFDRCxPQUFPLEtBQUssQ0FBQyxTQUFTLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQztJQUN2QyxDQUFDO0lBRU8sVUFBVSxDQUFDLEtBQStCLEVBQUUsT0FBZSxFQUFFLE9BQWdDO1FBQ25HLFFBQVEsS0FBSyxFQUFFLENBQUM7WUFDZCxLQUFLLE9BQU8sQ0FBQztZQUNiLEtBQUssT0FBTztnQkFDVixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ3BDLE1BQU07WUFDUixLQUFLLE1BQU07Z0JBQ1QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUNuQyxNQUFNO1lBQ1IsS0FBSyxNQUFNO2dCQUNULElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztnQkFDbkMsTUFBTTtZQUNSLEtBQUssT0FBTyxDQUFDO1lBQ2IsS0FBSyxVQUFVO2dCQUNiLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztnQkFDcEMsTUFBTTtRQUNWLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7O09BV0c7SUFDSyxlQUFlLENBQ3JCLEtBQXlCLEVBQ3pCLGtCQUEyQztRQUUzQyxNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztRQUUvQyxnRkFBZ0Y7UUFDaEYsSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDZixLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsS0FBSyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDeEQsSUFBSSxZQUFZLENBQUMsSUFBSSxJQUFJLGNBQWM7b0JBQUUsTUFBTTtnQkFDL0MsSUFBSSxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3hELFlBQVksQ0FBQyxHQUFHLENBQ2QsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUseUJBQXlCLENBQUMsRUFDdkMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsMEJBQTBCLENBQUMsQ0FDM0MsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxvRUFBb0U7UUFDcEUsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1lBQ3ZCLEtBQUssTUFBTSxDQUFFLEdBQUcsRUFBRSxLQUFLLENBQUUsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQztnQkFDaEUsSUFBSSxZQUFZLENBQUMsSUFBSSxJQUFJLGNBQWM7b0JBQUUsTUFBTTtnQkFDL0MsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDM0IsWUFBWSxDQUFDLEdBQUcsQ0FDZCxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSx5QkFBeUIsQ0FBQyxFQUN2QyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSwwQkFBMEIsQ0FBQyxDQUMzQyxDQUFDO2dCQUNKLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELDJFQUEyRTtRQUMzRSxJQUFJLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNyQixLQUFLLE1BQU0sQ0FBRSxHQUFHLEVBQUUsS0FBSyxDQUFFLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFDOUQsSUFBSSxZQUFZLENBQUMsSUFBSSxJQUFJLGNBQWMsRUFBRSxDQUFDO29CQUN4QyxjQUFjLENBQUMsSUFBSSxDQUFDLDRCQUE0QixjQUFjLGtDQUFrQyxDQUFDLENBQUM7b0JBQ2xHLE1BQU07Z0JBQ1IsQ0FBQztnQkFFRCxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVE7b0JBQUUsU0FBUztnQkFFeEMsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUseUJBQXlCLENBQUMsQ0FBQztnQkFDeEQsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsMEJBQTBCLENBQUMsQ0FBQztnQkFFNUQsa0RBQWtEO2dCQUNsRCxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO29CQUMvQixZQUFZLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztnQkFDdEMsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsNEVBQTRFO1FBQzVFLElBQUksS0FBSyxDQUFDLFVBQVUsSUFBSSxZQUFZLENBQUMsSUFBSSxHQUFHLGNBQWMsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUM5RixZQUFZLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkQsQ0FBQztRQUVELE9BQU8sWUFBWSxDQUFDO0lBQ3RCLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSyxrQkFBa0IsQ0FBQyxLQUF5QixFQUFFLHNCQUErQixLQUFLO1FBQ3hGLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ2hGLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBRSxJQUFJLEVBQUUsS0FBSyxDQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBRWxHLElBQUksQ0FBQztZQUNILDJFQUEyRTtZQUMzRSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxDQUFDO1lBRWpELDhDQUE4QztZQUM5QyxLQUFLLE1BQU0sR0FBRyxJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUM3QixZQUFZLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2pELENBQUM7WUFFRCxxQ0FBcUM7WUFDckMsSUFBSSxLQUFLLENBQUMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDM0QsS0FBSyxNQUFNLENBQUUsSUFBSSxFQUFFLEtBQUssQ0FBRSxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7b0JBQzVELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxVQUFVLEVBQUUsSUFBMEIsQ0FBQyxDQUFDO29CQUNwRixZQUFZLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUM7Z0JBQzVDLENBQUM7WUFDSCxDQUFDO1lBRUQscURBQXFEO1lBQ3JELElBQUksbUJBQW1CLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDMUQsWUFBWSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsb0JBQVUsQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQ2hGLENBQUM7WUFFRCwwRUFBMEU7UUFDNUUsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixjQUFjLENBQUMsSUFBSSxDQUFDLGtDQUFrQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2pFLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxpQkFBaUIsQ0FBQyxLQUF5QjtRQUNqRCxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssTUFBTTtZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRTVDLE1BQU0sVUFBVSxHQUEyQixFQUFFLENBQUM7UUFDOUMsSUFBSSxLQUFLLENBQUMsU0FBUztZQUFFLFVBQVUsQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUM1RCxJQUFJLEtBQUssQ0FBQyxNQUFNO1lBQUUsVUFBVSxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO1FBQ25ELElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxTQUFTO1lBQUUsVUFBVSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRTVFLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUNyRSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssYUFBYSxDQUFDLFVBQWtCLEVBQUUsV0FBb0I7UUFDNUQsbURBQW1EO1FBQ25ELElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNuRyxPQUFPLG9CQUFVLENBQUMsWUFBWSxDQUFDO1FBQ2pDLENBQUM7UUFDRCxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakcsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztRQUMxQixDQUFDO1FBQ0QsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2hHLE9BQU8sb0JBQVUsQ0FBQyxLQUFLLENBQUM7UUFDMUIsQ0FBQztRQUNELElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDbEUsT0FBTyxvQkFBVSxDQUFDLE9BQU8sQ0FBQztRQUM1QixDQUFDO1FBRUQscUNBQXFDO1FBQ3JDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUNuQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLHlCQUF5QixDQUFDLEtBQXlCO1FBQ3pELElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVM7WUFBRSxPQUFPO1FBRWxELElBQUksQ0FBQztZQUNILDZDQUE2QztZQUM3QyxNQUFNLGtCQUFrQixHQUEyQixFQUFFLENBQUM7WUFFdEQsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ3BCLGtCQUFrQixDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQ2pELENBQUM7WUFDRCxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakIsa0JBQWtCLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7WUFDM0MsQ0FBQztZQUNELElBQUksS0FBSyxDQUFDLE9BQU8sS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDaEMsa0JBQWtCLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDckQsQ0FBQztZQUNELElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNyQixrQkFBa0IsQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQztZQUNuRCxDQUFDO1lBQ0QsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLFFBQVEsRUFBRSxDQUFDO2dCQUMxQixrQkFBa0IsQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUM7WUFDckQsQ0FBQztZQUVELHdEQUF3RDtZQUN4RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLEtBQUssRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO1lBQ3JFLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLENBQUM7WUFFakQsS0FBSyxNQUFNLENBQUUsSUFBSSxFQUFFLEtBQUssQ0FBRSxJQUFJLFlBQVksQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO2dCQUNyRCxZQUFZLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN6QyxDQUFDO1lBRUQsWUFBWSxDQUFDLFNBQVMsQ0FBQyxlQUFlLEVBQUUsb0JBQVUsQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3JGLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsY0FBYyxDQUFDLElBQUksQ0FBQyx5Q0FBeUMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN4RSxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFLO1FBQ1QsSUFBSSxDQUFDO1lBQ0gsZ0VBQWdFO1lBQ2hFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7Z0JBQ3hCLE9BQU87WUFDVCxDQUFDO1lBQ0QsSUFBSSxDQUFDLE9BQU8sQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1lBQ3BDLElBQUksQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDO1FBQzdCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsY0FBYyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM1RCxDQUFDO0lBQ0gsQ0FBQztJQUVELG9CQUFvQjtRQUNsQix3REFBd0Q7UUFDeEQsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFDN0IsQ0FBQztJQUVPLE9BQU8sQ0FBQyxJQUFhO1FBQzNCLElBQUksQ0FBQyxJQUFJO1lBQUUsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztRQUVuQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFFdEMsUUFBUSxVQUFVLEVBQUUsQ0FBQztZQUNuQixLQUFLLFNBQVMsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxPQUFPLENBQUM7WUFDMUMsS0FBSyxjQUFjLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsWUFBWSxDQUFDO1lBQ3BELEtBQUssY0FBYyxDQUFDLENBQUMsT0FBTyxvQkFBVSxDQUFDLFlBQVksQ0FBQztZQUNwRCxLQUFLLE9BQU8sQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxLQUFLLENBQUM7WUFDdEMsS0FBSyxXQUFXLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsU0FBUyxDQUFDO1lBQzlDLEtBQUssV0FBVyxDQUFDLENBQUMsT0FBTyxvQkFBVSxDQUFDLFNBQVMsQ0FBQztZQUM5QyxLQUFLLFdBQVcsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxTQUFTLENBQUM7WUFDOUMsS0FBSyxTQUFTLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsT0FBTyxDQUFDO1lBQzFDLEtBQUssTUFBTSxDQUFDLENBQUMsT0FBTyxvQkFBVSxDQUFDLElBQUksQ0FBQztZQUNwQyxLQUFLLGFBQWEsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxhQUFhLENBQUM7WUFDcEQsS0FBSyxjQUFjLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsY0FBYyxDQUFDO1lBQ3RELEtBQUssaUJBQWlCLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsaUJBQWlCLENBQUM7WUFDNUQsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxrQkFBa0IsQ0FBQztZQUM5RCxLQUFLLGlCQUFpQixDQUFDLENBQUMsT0FBTyxvQkFBVSxDQUFDLGlCQUFpQixDQUFDO1lBQzVELEtBQUssa0JBQWtCLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsa0JBQWtCLENBQUM7WUFDOUQsS0FBSyxpQkFBaUIsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxpQkFBaUIsQ0FBQztZQUM1RCxLQUFLLGtCQUFrQixDQUFDLENBQUMsT0FBTyxvQkFBVSxDQUFDLGtCQUFrQixDQUFDO1lBQzlELEtBQUssaUJBQWlCLENBQUMsQ0FBQyxPQUFPLG9CQUFVLENBQUMsaUJBQWlCLENBQUM7WUFDNUQsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxrQkFBa0IsQ0FBQztZQUM5RCxLQUFLLGNBQWMsQ0FBQyxDQUFDLE9BQU8sb0JBQVUsQ0FBQyxjQUFjLENBQUM7WUFDdEQsT0FBTyxDQUFDLENBQUMsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztRQUNuQyxDQUFDO0lBQ0gsQ0FBQztDQUNGLENBQUE7QUFqV1ksOENBQWlCOzRCQUFqQixpQkFBaUI7SUFMN0IsSUFBQSxlQUFVLEVBQUM7UUFDVixPQUFPLEVBQUUsc0JBQXNCO1FBQy9CLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxDQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFFO0tBQ25ELENBQUM7SUFVRyxXQUFBLElBQUEsaUJBQVksRUFBQywyQkFBMkIsQ0FBQyxDQUFBO0lBQ3pDLFdBQUEsSUFBQSxpQkFBWSxFQUFDLG9DQUFvQyxDQUFDLENBQUE7SUFDbEQsV0FBQSxJQUFBLGlCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQTtHQVg5QixpQkFBaUIsQ0FpVzdCIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDbG91ZFdhdGNoIEJhY2tlbmQgZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogVXNlcyBBV1MgUG93ZXJ0b29scyBmb3IgTGFtYmRhOlxuICogLSBMb2dnZXIgZm9yIHN0cnVjdHVyZWQgSlNPTiBsb2dnaW5nXG4gKiAtIE1ldHJpY3MgZm9yIEVNRiAoRW1iZWRkZWQgTWV0cmljIEZvcm1hdCkgbWV0cmljc1xuICogXG4gKiBBbGwgY29uZmlnIGluamVjdGVkIHZpYSBESSAtIG5vIGZhbGxiYWNrcy5cbiAqL1xuXG5pbXBvcnQgeyBMb2dnZXIgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcic7XG5pbXBvcnQgeyBNZXRyaWNzLCBNZXRyaWNVbml0IH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9tZXRyaWNzJztcbmltcG9ydCB7IEluamVjdGFibGUsIEluamVjdENvbmZpZyB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUJhY2tlbmQsIE9ic2VydmFiaWxpdHlFdmVudCwgT2JzZXJ2YWJpbGl0eUxldmVsLCBPYnNlcnZhYmlsaXR5TGV2ZWxTdHJpbmcgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsIH0gZnJvbSAnLi4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuXG5jb25zdCBpbnRlcm5hbExvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ2xvdWRXYXRjaEJhY2tlbmQnKTtcblxuLy8gQ2xvdWRXYXRjaCBsaW1pdHNcbmNvbnN0IE1BWF9ESU1FTlNJT05TID0gMTA7XG5jb25zdCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIID0gMjU2O1xuY29uc3QgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEggPSAxMDI0O1xuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWyAnb2JzZXJ2YWJpbGl0eScsICdiYWNrZW5kJywgJ2Nsb3Vkd2F0Y2gnIF1cbn0pXG5leHBvcnQgY2xhc3MgQ2xvdWRXYXRjaEJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ2Nsb3Vkd2F0Y2gnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSBsb2dnZXI6IExvZ2dlcjtcbiAgcHJpdmF0ZSBtZXRyaWNzOiBNZXRyaWNzO1xuICBwcml2YXRlIGhhc0FueU1ldHJpY3MgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LnNlcnZpY2VOYW1lJykgc2VydmljZU5hbWU6IHN0cmluZyxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmNsb3Vkd2F0Y2gubmFtZXNwYWNlJykgbmFtZXNwYWNlOiBzdHJpbmcsXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5taW5MZXZlbCcpIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxcbiAgKSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgIHNlcnZpY2VOYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgIGxvZ0xldmVsOiBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsKG1pbkxldmVsKSxcblxuICAgIH0pO1xuXG4gICAgdGhpcy5tZXRyaWNzID0gbmV3IE1ldHJpY3Moe1xuICAgICAgbmFtZXNwYWNlOiBuYW1lc3BhY2UsXG4gICAgICBzZXJ2aWNlTmFtZTogc2VydmljZU5hbWUsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gQmF0Y2ggQUxMIG1ldHJpY3MgKGV2ZW50Lm1ldHJpY3MgKyBzcGFuIGR1cmF0aW9uKSBpbnRvIGEgU0lOR0xFIEVNRiBsb2dcbiAgICAgIGNvbnN0IGhhc0V2ZW50TWV0cmljcyA9IGV2ZW50Lm1ldHJpY3MgJiYgT2JqZWN0LmtleXMoZXZlbnQubWV0cmljcykubGVuZ3RoID4gMDtcbiAgICAgIGNvbnN0IGhhc1NwYW5EdXJhdGlvbiA9IGV2ZW50LnR5cGUgPT09ICdzcGFuJyAmJiBldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQgJiYgIWV2ZW50Lm1ldHJpY3M/LmR1cmF0aW9uO1xuXG4gICAgICBpZiAoaGFzRXZlbnRNZXRyaWNzIHx8IGhhc1NwYW5EdXJhdGlvbikge1xuICAgICAgICB0aGlzLmhhc0FueU1ldHJpY3MgPSB0cnVlO1xuICAgICAgICAvLyBDb21iaW5lIGJvdGggaW50byBvbmUgYmF0Y2hlZCBtZXRyaWMgY2FsbFxuICAgICAgICB0aGlzLmhhbmRsZU1ldHJpY3NCYXRjaChldmVudCwgaGFzU3BhbkR1cmF0aW9uKTtcbiAgICAgIH1cblxuICAgICAgLy8gTG9nIHRoZSBldmVudCAodW5sZXNzIGl0J3MgYSBwdXJlIG1ldHJpYyBldmVudCB3aXRoIG5vIG90aGVyIGRhdGEpXG4gICAgICBpZiAoZXZlbnQudHlwZSAhPT0gJ21ldHJpYycpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVMb2coZXZlbnQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci5lcnJvcignQ2xvdWRXYXRjaCBjYXB0dXJlIGZhaWxlZDonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVMb2coZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICB9O1xuXG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIGNvbnRleHQuZW50aXR5TmFtZSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gICAgaWYgKGV2ZW50LmVudGl0eUlkKSBjb250ZXh0LmVudGl0eUlkID0gZXZlbnQuZW50aXR5SWQ7XG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikgY29udGV4dC5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkgY29udGV4dC5kdXJhdGlvbk1zID0gZXZlbnQuZHVyYXRpb25NcztcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSBjb250ZXh0LnN1Y2Nlc3MgPSBldmVudC5zdWNjZXNzO1xuICAgIGlmIChldmVudC5zdGF0dXMpIGNvbnRleHQuc3RhdHVzID0gZXZlbnQuc3RhdHVzO1xuICAgIGlmIChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIGNvbnRleHQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGlmIChldmVudC5jYXVzZWRCeSkgY29udGV4dC5jYXVzZWRCeSA9IGV2ZW50LmNhdXNlZEJ5O1xuICAgIGlmIChldmVudC5yZWxhdGVkVHJhY2VzKSBjb250ZXh0LnJlbGF0ZWRUcmFjZXMgPSBldmVudC5yZWxhdGVkVHJhY2VzO1xuICAgIGlmIChldmVudC5zb3VyY2UpIGNvbnRleHQuc291cmNlID0gZXZlbnQuc291cmNlO1xuICAgIGlmIChldmVudC50YWdzKSBjb250ZXh0LnRhZ3MgPSBldmVudC50YWdzO1xuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSBjb250ZXh0LmF0dHJpYnV0ZXMgPSBldmVudC5hdHRyaWJ1dGVzO1xuICAgIGlmIChldmVudC5kYXRhKSBjb250ZXh0LmRhdGEgPSBldmVudC5kYXRhO1xuICAgIGlmIChldmVudC5lcnJvcikgY29udGV4dC5lcnJvciA9IGV2ZW50LmVycm9yO1xuICAgIGlmIChldmVudC5hY3Rvcikge1xuICAgICAgY29uc3QgYWN0b3IgPSBldmVudC5hY3RvcjtcbiAgICAgIGlmIChhY3Rvci5hY3RvcklkKSBjb250ZXh0LmFjdG9ySWQgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgaWYgKGFjdG9yLmFjdG9yVHlwZSkgY29udGV4dC5hY3RvclR5cGUgPSBhY3Rvci5hY3RvclR5cGU7XG4gICAgICBpZiAoYWN0b3IudGVuYW50SWQpIGNvbnRleHQudGVuYW50SWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICAgIGlmIChhY3Rvci5zZXNzaW9uSWQpIGNvbnRleHQuc2Vzc2lvbklkID0gYWN0b3Iuc2Vzc2lvbklkO1xuICAgICAgaWYgKGFjdG9yLmVtYWlsKSBjb250ZXh0LmFjdG9yRW1haWwgPSBhY3Rvci5lbWFpbDtcbiAgICAgIGlmIChhY3Rvci5zb3VyY2VJcCkgY29udGV4dC5zb3VyY2VJcCA9IGFjdG9yLnNvdXJjZUlwO1xuICAgICAgaWYgKGFjdG9yLnVzZXJBZ2VudCkgY29udGV4dC51c2VyQWdlbnQgPSBhY3Rvci51c2VyQWdlbnQ7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuZXh0cmFjdE1lc3NhZ2UoZXZlbnQpO1xuICAgIHRoaXMubG9nQXRMZXZlbChldmVudC5sZXZlbCwgbWVzc2FnZSwgY29udGV4dCk7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8IGV2ZW50LnR5cGU7XG4gIH1cblxuICBwcml2YXRlIGxvZ0F0TGV2ZWwobGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgIGNhc2UgJ3RyYWNlJzpcbiAgICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5mbyc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2Fybic6XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgY2FzZSAnY3JpdGljYWwnOlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGRlZHVwbGljYXRlZCBkaW1lbnNpb25zIGZyb20gZXZlbnQgZGF0YS5cbiAgICogUHJpb3JpdHkgb3JkZXIgKGZpcnN0IG9jY3VycmVuY2Ugd2lucyk6XG4gICAqIDEuIFRhZ3MgKGhpZ2hlc3QgcHJpb3JpdHkgLSB1c2VyLXNwZWNpZmllZClcbiAgICogMi4gRXhwbGljaXQgZGltZW5zaW9uIG92ZXJyaWRlcyAocGFzc2VkIGFzIHBhcmFtZXRlcilcbiAgICogMy4gQXR0cmlidXRlcyAoaWYgc3RyaW5nIHZhbHVlcylcbiAgICogNC4gRW50aXR5IGNvbnRleHQgKGVudGl0eU5hbWUpXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBPYnNlcnZhYmlsaXR5IGV2ZW50XG4gICAqIEBwYXJhbSBleHBsaWNpdERpbWVuc2lvbnMgLSBFeHBsaWNpdCBkaW1lbnNpb25zIHRvIGFkZCAoZS5nLiwgb3BlcmF0aW9uLCBzb3VyY2UsIHN1Y2Nlc3MpXG4gICAqIEByZXR1cm5zIERlZHVwbGljYXRlZCBkaW1lbnNpb24gbWFwXG4gICAqL1xuICBwcml2YXRlIGJ1aWxkRGltZW5zaW9ucyhcbiAgICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICAgIGV4cGxpY2l0RGltZW5zaW9ucz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgKTogTWFwPHN0cmluZywgc3RyaW5nPiB7XG4gICAgY29uc3QgZGltZW5zaW9uTWFwID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcblxuICAgIC8vIFByaW9yaXR5IDE6IEFkZCBjb21tb24gZGltZW5zaW9ucyBmcm9tIHRhZ3MgKHRlbmFudCwgZW50aXR5LCBvcGVyYXRpb24sIGV0Yy4pXG4gICAgaWYgKGV2ZW50LnRhZ3MpIHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQudGFncykpIHtcbiAgICAgICAgaWYgKGRpbWVuc2lvbk1hcC5zaXplID49IE1BWF9ESU1FTlNJT05TKSBicmVhaztcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgIWRpbWVuc2lvbk1hcC5oYXMoa2V5KSkge1xuICAgICAgICAgIGRpbWVuc2lvbk1hcC5zZXQoXG4gICAgICAgICAgICBrZXkuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9OQU1FX0xFTkdUSCksXG4gICAgICAgICAgICB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogQWRkIGV4cGxpY2l0IGRpbWVuc2lvbnMgKG9ubHkgaWYgbm90IGFscmVhZHkgcHJlc2VudClcbiAgICBpZiAoZXhwbGljaXREaW1lbnNpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV4cGxpY2l0RGltZW5zaW9ucykpIHtcbiAgICAgICAgaWYgKGRpbWVuc2lvbk1hcC5zaXplID49IE1BWF9ESU1FTlNJT05TKSBicmVhaztcbiAgICAgICAgaWYgKCFkaW1lbnNpb25NYXAuaGFzKGtleSkpIHtcbiAgICAgICAgICBkaW1lbnNpb25NYXAuc2V0KFxuICAgICAgICAgICAga2V5LnNsaWNlKDAsIE1BWF9ESU1FTlNJT05fTkFNRV9MRU5HVEgpLFxuICAgICAgICAgICAgdmFsdWUuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEgpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEFkZCBkaW1lbnNpb25zIGZyb20gYXR0cmlidXRlcyAob25seSBpZiBub3QgYWxyZWFkeSBwcmVzZW50KVxuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSB7XG4gICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50LmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgIGlmIChkaW1lbnNpb25NYXAuc2l6ZSA+PSBNQVhfRElNRU5TSU9OUykge1xuICAgICAgICAgIGludGVybmFsTG9nZ2VyLndhcm4oYERpbWVuc2lvbiBsaW1pdCByZWFjaGVkICgke01BWF9ESU1FTlNJT05TfSksIHNraXBwaW5nIHJlbWFpbmluZyBhdHRyaWJ1dGVzYCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgY29udGludWU7XG5cbiAgICAgICAgY29uc3QgZGltTmFtZSA9IGtleS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIKTtcbiAgICAgICAgY29uc3QgZGltVmFsdWUgPSB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCk7XG5cbiAgICAgICAgLy8gT25seSBhZGQgaWYgbm90IGFscmVhZHkgcHJlc2VudCAoZGVkdXBsaWNhdGlvbilcbiAgICAgICAgaWYgKCFkaW1lbnNpb25NYXAuaGFzKGRpbU5hbWUpKSB7XG4gICAgICAgICAgZGltZW5zaW9uTWFwLnNldChkaW1OYW1lLCBkaW1WYWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA0OiBBZGQgZW50aXR5IGNvbnRleHQgYXMgZGltZW5zaW9uIChvbmx5IGlmIG5vdCBhbHJlYWR5IHByZXNlbnQpXG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUgJiYgZGltZW5zaW9uTWFwLnNpemUgPCBNQVhfRElNRU5TSU9OUyAmJiAhZGltZW5zaW9uTWFwLmhhcygnZW50aXR5TmFtZScpKSB7XG4gICAgICBkaW1lbnNpb25NYXAuc2V0KCdlbnRpdHlOYW1lJywgZXZlbnQuZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpbWVuc2lvbk1hcDtcbiAgfVxuXG4gIC8qKlxuICAgKiBCYXRjaCBBTEwgbWV0cmljcyBmcm9tIGEgc2luZ2xlIGV2ZW50IGludG8gT05FIEVNRiBsb2cgZW50cnkuXG4gICAqIFxuICAgKiBPUFRJTUlaQVRJT046IENvbWJpbmVzIGV2ZW50Lm1ldHJpY3MgKyBzcGFuIGR1cmF0aW9uIGludG8gYSBTSU5HTEUgRU1GIGxvZ1xuICAgKiBCRUZPUkUgKGluZWZmaWNpZW50KTogNSBldmVudCBtZXRyaWNzICsgMSBzcGFuIGR1cmF0aW9uID0gMiBzZXBhcmF0ZSBFTUYgbG9nc1xuICAgKiBBRlRFUiAob3B0aW1pemVkKTogNSBldmVudCBtZXRyaWNzICsgMSBzcGFuIGR1cmF0aW9uID0gMSBFTUYgbG9nID0gNTAlIGNvc3QgcmVkdWN0aW9uXG4gICAqIFxuICAgKiBDbG91ZFdhdGNoIEVNRiBzdXBwb3J0cyB1cCB0byAxMDAgbWV0cmljcyBwZXIgbG9nIGVudHJ5LCBzbyBiYXRjaGluZ1xuICAgKiBpcyBhbG1vc3QgYWx3YXlzIGJldHRlciB0aGFuIGluZGl2aWR1YWwgbWV0cmljIGVtaXNzaW9uLlxuICAgKiBcbiAgICogQHBhcmFtIGV2ZW50IC0gVGhlIG9ic2VydmFiaWxpdHkgZXZlbnQgY29udGFpbmluZyBtZXRyaWNzXG4gICAqIEBwYXJhbSBpbmNsdWRlU3BhbkR1cmF0aW9uIC0gV2hldGhlciB0byBpbmNsdWRlIHNwYW4gZHVyYXRpb24gaW4gdGhlIGJhdGNoXG4gICAqL1xuICBwcml2YXRlIGhhbmRsZU1ldHJpY3NCYXRjaChldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LCBpbmNsdWRlU3BhbkR1cmF0aW9uOiBib29sZWFuID0gZmFsc2UpOiB2b2lkIHtcbiAgICBjb25zdCBkaW1lbnNpb25NYXAgPSB0aGlzLmJ1aWxkRGltZW5zaW9ucyhldmVudCwgdGhpcy5nZXRTcGFuRGltZW5zaW9ucyhldmVudCkpO1xuICAgIGNvbnN0IGRpbWVuc2lvbnMgPSBBcnJheS5mcm9tKGRpbWVuc2lvbk1hcC5lbnRyaWVzKCkpLm1hcCgoWyBuYW1lLCB2YWx1ZSBdKSA9PiAoeyBuYW1lLCB2YWx1ZSB9KSk7XG5cbiAgICB0cnkge1xuICAgICAgLy8gQ3JlYXRlIE9ORSBtZXRyaWNzIGJhdGNoIGZvciBBTEwgbWV0cmljcyAoZXZlbnQgbWV0cmljcyArIHNwYW4gZHVyYXRpb24pXG4gICAgICBjb25zdCBtZXRyaWNzQmF0Y2ggPSB0aGlzLm1ldHJpY3Muc2luZ2xlTWV0cmljKCk7XG5cbiAgICAgIC8vIEFkZCBkaW1lbnNpb25zIG9uY2UgKHNoYXJlZCBieSBhbGwgbWV0cmljcylcbiAgICAgIGZvciAoY29uc3QgZGltIG9mIGRpbWVuc2lvbnMpIHtcbiAgICAgICAgbWV0cmljc0JhdGNoLmFkZERpbWVuc2lvbihkaW0ubmFtZSwgZGltLnZhbHVlKTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIGFsbCBldmVudCBtZXRyaWNzIHRvIHRoZSBiYXRjaFxuICAgICAgaWYgKGV2ZW50Lm1ldHJpY3MgJiYgT2JqZWN0LmtleXMoZXZlbnQubWV0cmljcykubGVuZ3RoID4gMCkge1xuICAgICAgICBmb3IgKGNvbnN0IFsgbmFtZSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC5tZXRyaWNzKSkge1xuICAgICAgICAgIGNvbnN0IHVuaXQgPSB0aGlzLmdldE1ldHJpY1VuaXQobmFtZSwgZXZlbnQuYXR0cmlidXRlcz8udW5pdCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xuICAgICAgICAgIG1ldHJpY3NCYXRjaC5hZGRNZXRyaWMobmFtZSwgdW5pdCwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCBzcGFuIGR1cmF0aW9uIHRvIHRoZSBTQU1FIGJhdGNoIChpZiByZXF1ZXN0ZWQpXG4gICAgICBpZiAoaW5jbHVkZVNwYW5EdXJhdGlvbiAmJiBldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbWV0cmljc0JhdGNoLmFkZE1ldHJpYygnZHVyYXRpb24nLCBNZXRyaWNVbml0Lk1pbGxpc2Vjb25kcywgZXZlbnQuZHVyYXRpb25Ncyk7XG4gICAgICB9XG5cbiAgICAgIC8vIEVNRiB3aWxsIHB1Ymxpc2ggT05FIGxvZyBlbnRyeSB3aXRoIEFMTCBtZXRyaWNzIChtYXNzaXZlIGNvc3Qgc2F2aW5ncyEpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGludGVybmFsTG9nZ2VyLndhcm4oJ0ZhaWxlZCB0byBwdWJsaXNoIG1ldHJpY3MgYmF0Y2g6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgc3Bhbi1zcGVjaWZpYyBkaW1lbnNpb25zIChvcGVyYXRpb24sIHNvdXJjZSwgc3VjY2VzcylcbiAgICovXG4gIHByaXZhdGUgZ2V0U3BhbkRpbWVuc2lvbnMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWQge1xuICAgIGlmIChldmVudC50eXBlICE9PSAnc3BhbicpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBkaW1lbnNpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikgZGltZW5zaW9ucy5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgaWYgKGV2ZW50LnNvdXJjZSkgZGltZW5zaW9ucy5zb3VyY2UgPSBldmVudC5zb3VyY2U7XG4gICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkgZGltZW5zaW9ucy5zdWNjZXNzID0gU3RyaW5nKGV2ZW50LnN1Y2Nlc3MpO1xuXG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKGRpbWVuc2lvbnMpLmxlbmd0aCA+IDAgPyBkaW1lbnNpb25zIDogdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZSB0aGUgY29ycmVjdCB1bml0IGZvciBhIG1ldHJpYy5cbiAgICogQWxsb3dzIHBlci1tZXRyaWMgdW5pdCBvdmVycmlkZSB2aWEgbmFtaW5nIGNvbnZlbnRpb25zLlxuICAgKi9cbiAgcHJpdmF0ZSBnZXRNZXRyaWNVbml0KG1ldHJpY05hbWU6IHN0cmluZywgZGVmYXVsdFVuaXQ/OiBzdHJpbmcpOiB0eXBlb2YgTWV0cmljVW5pdFsga2V5b2YgdHlwZW9mIE1ldHJpY1VuaXQgXSB7XG4gICAgLy8gUGVyLW1ldHJpYyB1bml0IGRldGVjdGlvbiBiYXNlZCBvbiBuYW1lIHBhdHRlcm5zXG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2R1cmF0aW9uJykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygnbGF0ZW5jeScpIHx8IG1ldHJpY05hbWUuZW5kc1dpdGgoJ01zJykpIHtcbiAgICAgIHJldHVybiBNZXRyaWNVbml0Lk1pbGxpc2Vjb25kcztcbiAgICB9XG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2NvdW50JykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygndG90YWwnKSB8fCBtZXRyaWNOYW1lLmVuZHNXaXRoKCdDb3VudCcpKSB7XG4gICAgICByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcbiAgICB9XG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2J5dGVzJykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygnc2l6ZScpIHx8IG1ldHJpY05hbWUuZW5kc1dpdGgoJ0J5dGVzJykpIHtcbiAgICAgIHJldHVybiBNZXRyaWNVbml0LkJ5dGVzO1xuICAgIH1cbiAgICBpZiAobWV0cmljTmFtZS5pbmNsdWRlcygncGVyY2VudCcpIHx8IG1ldHJpY05hbWUuaW5jbHVkZXMoJ3JhdGUnKSkge1xuICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuUGVyY2VudDtcbiAgICB9XG5cbiAgICAvLyBGYWxsIGJhY2sgdG8gZGVmYXVsdCB1bml0IG9yIENvdW50XG4gICAgcmV0dXJuIHRoaXMubWFwVW5pdChkZWZhdWx0VW5pdCk7XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaCBzcGFuIGR1cmF0aW9uIGFzIGEgQ2xvdWRXYXRjaCBtZXRyaWMuXG4gICAqIEFsbG93cyBjcmVhdGluZyBkYXNoYm9hcmRzL2FsYXJtcyBvbiBvcGVyYXRpb24gZHVyYXRpb25zLlxuICAgKiBVc2VzIGJ1aWxkRGltZW5zaW9ucygpIHRvIGVuc3VyZSBwcm9wZXIgZGVkdXBsaWNhdGlvbiB3aXRoIGV2ZW50LnRhZ3MuXG4gICAqL1xuICBwcml2YXRlIHB1Ymxpc2hTcGFuRHVyYXRpb25NZXRyaWMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZHVyYXRpb25NcyB8fCAhZXZlbnQub3BlcmF0aW9uKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgLy8gQnVpbGQgZXhwbGljaXQgZGltZW5zaW9ucyBmb3Igc3BhbiBtZXRyaWNzXG4gICAgICBjb25zdCBleHBsaWNpdERpbWVuc2lvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICAgICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMub3BlcmF0aW9uID0gZXZlbnQub3BlcmF0aW9uO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LnNvdXJjZSkge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMuc291cmNlID0gZXZlbnQuc291cmNlO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMuc3VjY2VzcyA9IFN0cmluZyhldmVudC5zdWNjZXNzKTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5lbnRpdHlOYW1lKSB7XG4gICAgICAgIGV4cGxpY2l0RGltZW5zaW9ucy5lbnRpdHlOYW1lID0gZXZlbnQuZW50aXR5TmFtZTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5hY3Rvcj8udGVuYW50SWQpIHtcbiAgICAgICAgZXhwbGljaXREaW1lbnNpb25zLnRlbmFudElkID0gZXZlbnQuYWN0b3IudGVuYW50SWQ7XG4gICAgICB9XG5cbiAgICAgIC8vIFVzZSBidWlsZERpbWVuc2lvbnMgdG8gcHJvcGVybHkgZGVkdXBsaWNhdGUgd2l0aCB0YWdzXG4gICAgICBjb25zdCBkaW1lbnNpb25NYXAgPSB0aGlzLmJ1aWxkRGltZW5zaW9ucyhldmVudCwgZXhwbGljaXREaW1lbnNpb25zKTtcbiAgICAgIGNvbnN0IHNpbmdsZU1ldHJpYyA9IHRoaXMubWV0cmljcy5zaW5nbGVNZXRyaWMoKTtcblxuICAgICAgZm9yIChjb25zdCBbIG5hbWUsIHZhbHVlIF0gb2YgZGltZW5zaW9uTWFwLmVudHJpZXMoKSkge1xuICAgICAgICBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKG5hbWUsIHZhbHVlKTtcbiAgICAgIH1cblxuICAgICAgc2luZ2xlTWV0cmljLmFkZE1ldHJpYygnc3Bhbi5kdXJhdGlvbicsIE1ldHJpY1VuaXQuTWlsbGlzZWNvbmRzLCBldmVudC5kdXJhdGlvbk1zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaW50ZXJuYWxMb2dnZXIud2FybignRmFpbGVkIHRvIHB1Ymxpc2ggc3BhbiBkdXJhdGlvbiBtZXRyaWM6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBBdm9pZCBub2lzeSBwb3dlcnRvb2xzIHdhcm5pbmcgd2hlbiBubyBtZXRyaWNzIHdlcmUgcmVjb3JkZWQuXG4gICAgICBpZiAoIXRoaXMuaGFzQW55TWV0cmljcykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aGlzLm1ldHJpY3MucHVibGlzaFN0b3JlZE1ldHJpY3MoKTtcbiAgICAgIHRoaXMuaGFzQW55TWV0cmljcyA9IGZhbHNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci5lcnJvcignRmFpbGVkIHRvIHB1Ymxpc2ggbWV0cmljczonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgLy8gUG93ZXJ0b29scyBoYW5kbGVzIHBlci1pbnZvY2F0aW9uIHN0YXRlIGF1dG9tYXRpY2FsbHlcbiAgICB0aGlzLmhhc0FueU1ldHJpY3MgPSBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgbWFwVW5pdCh1bml0Pzogc3RyaW5nKTogKHR5cGVvZiBNZXRyaWNVbml0KVsga2V5b2YgdHlwZW9mIE1ldHJpY1VuaXQgXSB7XG4gICAgaWYgKCF1bml0KSByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB1bml0LnRvTG93ZXJDYXNlKCk7XG5cbiAgICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICAgIGNhc2UgJ3NlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5TZWNvbmRzO1xuICAgICAgY2FzZSAnbWlsbGlzZWNvbmRzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWlsbGlzZWNvbmRzO1xuICAgICAgY2FzZSAnbWljcm9zZWNvbmRzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWljcm9zZWNvbmRzO1xuICAgICAgY2FzZSAnYnl0ZXMnOiByZXR1cm4gTWV0cmljVW5pdC5CeXRlcztcbiAgICAgIGNhc2UgJ2tpbG9ieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlcztcbiAgICAgIGNhc2UgJ21lZ2FieXRlcyc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlcztcbiAgICAgIGNhc2UgJ2dpZ2FieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlcztcbiAgICAgIGNhc2UgJ3BlcmNlbnQnOiByZXR1cm4gTWV0cmljVW5pdC5QZXJjZW50O1xuICAgICAgY2FzZSAnYml0cyc6IHJldHVybiBNZXRyaWNVbml0LkJpdHM7XG4gICAgICBjYXNlICdiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdieXRlcy9zZWNvbmQnOiByZXR1cm4gTWV0cmljVW5pdC5CeXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2tpbG9iaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LktpbG9iaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAna2lsb2J5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ21lZ2FiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2dpZ2FiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ3RlcmFiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LlRlcmFiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAndGVyYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LlRlcmFieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2NvdW50L3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkNvdW50UGVyU2Vjb25kO1xuICAgICAgZGVmYXVsdDogcmV0dXJuIE1ldHJpY1VuaXQuQ291bnQ7XG4gICAgfVxuICB9XG59XG4iXX0=