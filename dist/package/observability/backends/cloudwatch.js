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
            // ALWAYS extract and publish metrics via EMF if present, regardless of event type
            // This ensures metrics embedded in spans, audits, or logs are published as CloudWatch metrics
            if (event.metrics && Object.keys(event.metrics).length > 0) {
                this.hasAnyMetrics = true;
                this.handleMetric(event);
            }
            // For consolidated span records, publish durationMs as a separate metric ONLY if not already present.
            // This avoids duplicate metric publishing when callers also include a duration metric explicitly.
            if (event.type === 'span' && event.durationMs !== undefined && !event.metrics?.duration) {
                this.hasAnyMetrics = true;
                this.publishSpanDurationMetric(event);
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
    handleMetric(event) {
        if (!event.metrics || Object.keys(event.metrics).length === 0)
            return;
        const dimensionMap = this.buildDimensions(event);
        const dimensions = Array.from(dimensionMap.entries()).map(([name, value]) => ({ name, value }));
        const unit = this.mapUnit(event.attributes?.unit);
        for (const [name, value] of Object.entries(event.metrics)) {
            try {
                const singleMetric = this.metrics.singleMetric();
                for (const dim of dimensions) {
                    singleMetric.addDimension(dim.name, dim.value);
                }
                singleMetric.addMetric(name, unit, value);
            }
            catch (error) {
                internalLogger.warn(`Failed to add metric ${name}:`, error);
            }
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7Ozs7Ozs7Ozs7QUFFSCwwREFBdUQ7QUFDdkQsNERBQXFFO0FBQ3JFLGlDQUFvRDtBQUNwRCwyQ0FBNkM7QUFFN0Msc0RBQWlFO0FBRWpFLE1BQU0sY0FBYyxHQUFHLElBQUEsc0JBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXpELG9CQUFvQjtBQUNwQixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUM7QUFDMUIsTUFBTSx5QkFBeUIsR0FBRyxHQUFHLENBQUM7QUFDdEMsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUM7QUFPakMsSUFBTSxpQkFBaUIsR0FBdkIsTUFBTSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBQ2pCLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFFOUIsWUFDNkMsV0FBbUIsRUFDVixTQUFpQixFQUM3QixRQUE0QjtRQUVwRSxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUV6QixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksZUFBTSxDQUFDO1lBQ3ZCLFdBQVcsRUFBRSxXQUFXO1lBQ3hCLFFBQVEsRUFBRSxJQUFBLHVDQUF5QixFQUFDLFFBQVEsQ0FBQztTQUU5QyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksaUJBQU8sQ0FBQztZQUN6QixTQUFTLEVBQUUsU0FBUztZQUNwQixXQUFXLEVBQUUsV0FBVztTQUN6QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUF5QjtRQUNyQyxJQUFJLENBQUM7WUFDSCxrRkFBa0Y7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LENBQUE7R0FYOUIsaUJBQWlCLENBeVM3QiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBCYWNrZW5kIGZvciBPYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFVzZXMgQVdTIFBvd2VydG9vbHMgZm9yIExhbWJkYTpcbiAqIC0gTG9nZ2VyIGZvciBzdHJ1Y3R1cmVkIEpTT04gbG9nZ2luZ1xuICogLSBNZXRyaWNzIGZvciBFTUYgKEVtYmVkZGVkIE1ldHJpYyBGb3JtYXQpIG1ldHJpY3NcbiAqIFxuICogQWxsIGNvbmZpZyBpbmplY3RlZCB2aWEgREkgLSBubyBmYWxsYmFja3MuXG4gKi9cblxuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInO1xuaW1wb3J0IHsgTWV0cmljcywgTWV0cmljVW5pdCB9IGZyb20gJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcyc7XG5pbXBvcnQgeyBJbmplY3RhYmxlLCBJbmplY3RDb25maWcgfSBmcm9tICcuLi8uLi9kaSc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbCB9IGZyb20gJy4uL3V0aWxzL2xldmVsLXV0aWxzJztcblxuY29uc3QgaW50ZXJuYWxMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0Nsb3VkV2F0Y2hCYWNrZW5kJyk7XG5cbi8vIENsb3VkV2F0Y2ggbGltaXRzXG5jb25zdCBNQVhfRElNRU5TSU9OUyA9IDEwO1xuY29uc3QgTUFYX0RJTUVOU0lPTl9OQU1FX0xFTkdUSCA9IDI1NjtcbmNvbnN0IE1BWF9ESU1FTlNJT05fVkFMVUVfTEVOR1RIID0gMTAyNDtcblxuQEluamVjdGFibGUoe1xuICBwcm92aWRlOiAnT2JzZXJ2YWJpbGl0eUJhY2tlbmQnLFxuICBwcm92aWRlZEluOiAnUk9PVCcsXG4gIHRhZ3M6IFsgJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsICdjbG91ZHdhdGNoJyBdXG59KVxuZXhwb3J0IGNsYXNzIENsb3VkV2F0Y2hCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdjbG91ZHdhdGNoJztcbiAgcHVibGljIHJlYWRvbmx5IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuXG4gIHByaXZhdGUgbG9nZ2VyOiBMb2dnZXI7XG4gIHByaXZhdGUgbWV0cmljczogTWV0cmljcztcbiAgcHJpdmF0ZSBoYXNBbnlNZXRyaWNzID0gZmFsc2U7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5zZXJ2aWNlTmFtZScpIHNlcnZpY2VOYW1lOiBzdHJpbmcsXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5jbG91ZHdhdGNoLm5hbWVzcGFjZScpIG5hbWVzcGFjZTogc3RyaW5nLFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkubWluTGV2ZWwnKSBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsXG4gICkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBtaW5MZXZlbDtcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgICBzZXJ2aWNlTmFtZTogc2VydmljZU5hbWUsXG4gICAgICBsb2dMZXZlbDogbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbChtaW5MZXZlbCksXG5cbiAgICB9KTtcblxuICAgIHRoaXMubWV0cmljcyA9IG5ldyBNZXRyaWNzKHtcbiAgICAgIG5hbWVzcGFjZTogbmFtZXNwYWNlLFxuICAgICAgc2VydmljZU5hbWU6IHNlcnZpY2VOYW1lLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEFMV0FZUyBleHRyYWN0IGFuZCBwdWJsaXNoIG1ldHJpY3MgdmlhIEVNRiBpZiBwcmVzZW50LCByZWdhcmRsZXNzIG9mIGV2ZW50IHR5cGVcbiAgICAgIC8vIFRoaXMgZW5zdXJlcyBtZXRyaWNzIGVtYmVkZGVkIGluIHNwYW5zLCBhdWRpdHMsIG9yIGxvZ3MgYXJlIHB1Ymxpc2hlZCBhcyBDbG91ZFdhdGNoIG1ldHJpY3NcbiAgICAgIGlmIChldmVudC5tZXRyaWNzICYmIE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy5oYXNBbnlNZXRyaWNzID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5oYW5kbGVNZXRyaWMoZXZlbnQpO1xuICAgICAgfVxuXG4gICAgICAvLyBGb3IgY29uc29saWRhdGVkIHNwYW4gcmVjb3JkcywgcHVibGlzaCBkdXJhdGlvbk1zIGFzIGEgc2VwYXJhdGUgbWV0cmljIE9OTFkgaWYgbm90IGFscmVhZHkgcHJlc2VudC5cbiAgICAgIC8vIFRoaXMgYXZvaWRzIGR1cGxpY2F0ZSBtZXRyaWMgcHVibGlzaGluZyB3aGVuIGNhbGxlcnMgYWxzbyBpbmNsdWRlIGEgZHVyYXRpb24gbWV0cmljIGV4cGxpY2l0bHkuXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gJ3NwYW4nICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCAmJiAhZXZlbnQubWV0cmljcz8uZHVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5oYXNBbnlNZXRyaWNzID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5wdWJsaXNoU3BhbkR1cmF0aW9uTWV0cmljKGV2ZW50KTtcbiAgICAgIH1cblxuICAgICAgLy8gTG9nIHRoZSBldmVudCAodW5sZXNzIGl0J3MgYSBwdXJlIG1ldHJpYyBldmVudCB3aXRoIG5vIG90aGVyIGRhdGEpXG4gICAgICBpZiAoZXZlbnQudHlwZSAhPT0gJ21ldHJpYycpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVMb2coZXZlbnQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci5lcnJvcignQ2xvdWRXYXRjaCBjYXB0dXJlIGZhaWxlZDonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVMb2coZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICB9O1xuXG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIGNvbnRleHQuZW50aXR5TmFtZSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gICAgaWYgKGV2ZW50LmVudGl0eUlkKSBjb250ZXh0LmVudGl0eUlkID0gZXZlbnQuZW50aXR5SWQ7XG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikgY29udGV4dC5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkgY29udGV4dC5kdXJhdGlvbk1zID0gZXZlbnQuZHVyYXRpb25NcztcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSBjb250ZXh0LnN1Y2Nlc3MgPSBldmVudC5zdWNjZXNzO1xuICAgIGlmIChldmVudC5zdGF0dXMpIGNvbnRleHQuc3RhdHVzID0gZXZlbnQuc3RhdHVzO1xuICAgIGlmIChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIGNvbnRleHQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGlmIChldmVudC5jYXVzZWRCeSkgY29udGV4dC5jYXVzZWRCeSA9IGV2ZW50LmNhdXNlZEJ5O1xuICAgIGlmIChldmVudC5yZWxhdGVkVHJhY2VzKSBjb250ZXh0LnJlbGF0ZWRUcmFjZXMgPSBldmVudC5yZWxhdGVkVHJhY2VzO1xuICAgIGlmIChldmVudC5zb3VyY2UpIGNvbnRleHQuc291cmNlID0gZXZlbnQuc291cmNlO1xuICAgIGlmIChldmVudC50YWdzKSBjb250ZXh0LnRhZ3MgPSBldmVudC50YWdzO1xuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSBjb250ZXh0LmF0dHJpYnV0ZXMgPSBldmVudC5hdHRyaWJ1dGVzO1xuICAgIGlmIChldmVudC5kYXRhKSBjb250ZXh0LmRhdGEgPSBldmVudC5kYXRhO1xuICAgIGlmIChldmVudC5lcnJvcikgY29udGV4dC5lcnJvciA9IGV2ZW50LmVycm9yO1xuICAgIGlmIChldmVudC5hY3Rvcikge1xuICAgICAgY29uc3QgYWN0b3IgPSBldmVudC5hY3RvcjtcbiAgICAgIGlmIChhY3Rvci5hY3RvcklkKSBjb250ZXh0LmFjdG9ySWQgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgaWYgKGFjdG9yLmFjdG9yVHlwZSkgY29udGV4dC5hY3RvclR5cGUgPSBhY3Rvci5hY3RvclR5cGU7XG4gICAgICBpZiAoYWN0b3IudGVuYW50SWQpIGNvbnRleHQudGVuYW50SWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICAgIGlmIChhY3Rvci5zZXNzaW9uSWQpIGNvbnRleHQuc2Vzc2lvbklkID0gYWN0b3Iuc2Vzc2lvbklkO1xuICAgICAgaWYgKGFjdG9yLmVtYWlsKSBjb250ZXh0LmFjdG9yRW1haWwgPSBhY3Rvci5lbWFpbDtcbiAgICAgIGlmIChhY3Rvci5zb3VyY2VJcCkgY29udGV4dC5zb3VyY2VJcCA9IGFjdG9yLnNvdXJjZUlwO1xuICAgICAgaWYgKGFjdG9yLnVzZXJBZ2VudCkgY29udGV4dC51c2VyQWdlbnQgPSBhY3Rvci51c2VyQWdlbnQ7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuZXh0cmFjdE1lc3NhZ2UoZXZlbnQpO1xuICAgIHRoaXMubG9nQXRMZXZlbChldmVudC5sZXZlbCwgbWVzc2FnZSwgY29udGV4dCk7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8IGV2ZW50LnR5cGU7XG4gIH1cblxuICBwcml2YXRlIGxvZ0F0TGV2ZWwobGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgIGNhc2UgJ3RyYWNlJzpcbiAgICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5mbyc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2Fybic6XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgY2FzZSAnY3JpdGljYWwnOlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGRlZHVwbGljYXRlZCBkaW1lbnNpb25zIGZyb20gZXZlbnQgZGF0YS5cbiAgICogUHJpb3JpdHkgb3JkZXIgKGZpcnN0IG9jY3VycmVuY2Ugd2lucyk6XG4gICAqIDEuIFRhZ3MgKGhpZ2hlc3QgcHJpb3JpdHkgLSB1c2VyLXNwZWNpZmllZClcbiAgICogMi4gRXhwbGljaXQgZGltZW5zaW9uIG92ZXJyaWRlcyAocGFzc2VkIGFzIHBhcmFtZXRlcilcbiAgICogMy4gQXR0cmlidXRlcyAoaWYgc3RyaW5nIHZhbHVlcylcbiAgICogNC4gRW50aXR5IGNvbnRleHQgKGVudGl0eU5hbWUpXG4gICAqIFxuICAgKiBAcGFyYW0gZXZlbnQgLSBPYnNlcnZhYmlsaXR5IGV2ZW50XG4gICAqIEBwYXJhbSBleHBsaWNpdERpbWVuc2lvbnMgLSBFeHBsaWNpdCBkaW1lbnNpb25zIHRvIGFkZCAoZS5nLiwgb3BlcmF0aW9uLCBzb3VyY2UsIHN1Y2Nlc3MpXG4gICAqIEByZXR1cm5zIERlZHVwbGljYXRlZCBkaW1lbnNpb24gbWFwXG4gICAqL1xuICBwcml2YXRlIGJ1aWxkRGltZW5zaW9ucyhcbiAgICBldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50LFxuICAgIGV4cGxpY2l0RGltZW5zaW9ucz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgKTogTWFwPHN0cmluZywgc3RyaW5nPiB7XG4gICAgY29uc3QgZGltZW5zaW9uTWFwID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcblxuICAgIC8vIFByaW9yaXR5IDE6IEFkZCBjb21tb24gZGltZW5zaW9ucyBmcm9tIHRhZ3MgKHRlbmFudCwgZW50aXR5LCBvcGVyYXRpb24sIGV0Yy4pXG4gICAgaWYgKGV2ZW50LnRhZ3MpIHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQudGFncykpIHtcbiAgICAgICAgaWYgKGRpbWVuc2lvbk1hcC5zaXplID49IE1BWF9ESU1FTlNJT05TKSBicmVhaztcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycgJiYgIWRpbWVuc2lvbk1hcC5oYXMoa2V5KSkge1xuICAgICAgICAgIGRpbWVuc2lvbk1hcC5zZXQoXG4gICAgICAgICAgICBrZXkuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9OQU1FX0xFTkdUSCksXG4gICAgICAgICAgICB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogQWRkIGV4cGxpY2l0IGRpbWVuc2lvbnMgKG9ubHkgaWYgbm90IGFscmVhZHkgcHJlc2VudClcbiAgICBpZiAoZXhwbGljaXREaW1lbnNpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV4cGxpY2l0RGltZW5zaW9ucykpIHtcbiAgICAgICAgaWYgKGRpbWVuc2lvbk1hcC5zaXplID49IE1BWF9ESU1FTlNJT05TKSBicmVhaztcbiAgICAgICAgaWYgKCFkaW1lbnNpb25NYXAuaGFzKGtleSkpIHtcbiAgICAgICAgICBkaW1lbnNpb25NYXAuc2V0KFxuICAgICAgICAgICAga2V5LnNsaWNlKDAsIE1BWF9ESU1FTlNJT05fTkFNRV9MRU5HVEgpLFxuICAgICAgICAgICAgdmFsdWUuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEgpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEFkZCBkaW1lbnNpb25zIGZyb20gYXR0cmlidXRlcyAob25seSBpZiBub3QgYWxyZWFkeSBwcmVzZW50KVxuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSB7XG4gICAgICBmb3IgKGNvbnN0IFsga2V5LCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50LmF0dHJpYnV0ZXMpKSB7XG4gICAgICAgIGlmIChkaW1lbnNpb25NYXAuc2l6ZSA+PSBNQVhfRElNRU5TSU9OUykge1xuICAgICAgICAgIGludGVybmFsTG9nZ2VyLndhcm4oYERpbWVuc2lvbiBsaW1pdCByZWFjaGVkICgke01BWF9ESU1FTlNJT05TfSksIHNraXBwaW5nIHJlbWFpbmluZyBhdHRyaWJ1dGVzYCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgY29udGludWU7XG5cbiAgICAgICAgY29uc3QgZGltTmFtZSA9IGtleS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIKTtcbiAgICAgICAgY29uc3QgZGltVmFsdWUgPSB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCk7XG5cbiAgICAgICAgLy8gT25seSBhZGQgaWYgbm90IGFscmVhZHkgcHJlc2VudCAoZGVkdXBsaWNhdGlvbilcbiAgICAgICAgaWYgKCFkaW1lbnNpb25NYXAuaGFzKGRpbU5hbWUpKSB7XG4gICAgICAgICAgZGltZW5zaW9uTWFwLnNldChkaW1OYW1lLCBkaW1WYWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA0OiBBZGQgZW50aXR5IGNvbnRleHQgYXMgZGltZW5zaW9uIChvbmx5IGlmIG5vdCBhbHJlYWR5IHByZXNlbnQpXG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUgJiYgZGltZW5zaW9uTWFwLnNpemUgPCBNQVhfRElNRU5TSU9OUyAmJiAhZGltZW5zaW9uTWFwLmhhcygnZW50aXR5TmFtZScpKSB7XG4gICAgICBkaW1lbnNpb25NYXAuc2V0KCdlbnRpdHlOYW1lJywgZXZlbnQuZW50aXR5TmFtZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpbWVuc2lvbk1hcDtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlTWV0cmljKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBpZiAoIWV2ZW50Lm1ldHJpY3MgfHwgT2JqZWN0LmtleXMoZXZlbnQubWV0cmljcykubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBkaW1lbnNpb25NYXAgPSB0aGlzLmJ1aWxkRGltZW5zaW9ucyhldmVudCk7XG4gICAgY29uc3QgZGltZW5zaW9ucyA9IEFycmF5LmZyb20oZGltZW5zaW9uTWFwLmVudHJpZXMoKSkubWFwKChbIG5hbWUsIHZhbHVlIF0pID0+ICh7IG5hbWUsIHZhbHVlIH0pKTtcbiAgICBjb25zdCB1bml0ID0gdGhpcy5tYXBVbml0KGV2ZW50LmF0dHJpYnV0ZXM/LnVuaXQgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKTtcblxuICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzaW5nbGVNZXRyaWMgPSB0aGlzLm1ldHJpY3Muc2luZ2xlTWV0cmljKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBkaW0gb2YgZGltZW5zaW9ucykge1xuICAgICAgICAgIHNpbmdsZU1ldHJpYy5hZGREaW1lbnNpb24oZGltLm5hbWUsIGRpbS52YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICBzaW5nbGVNZXRyaWMuYWRkTWV0cmljKG5hbWUsIHVuaXQsIHZhbHVlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGludGVybmFsTG9nZ2VyLndhcm4oYEZhaWxlZCB0byBhZGQgbWV0cmljICR7bmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQdWJsaXNoIHNwYW4gZHVyYXRpb24gYXMgYSBDbG91ZFdhdGNoIG1ldHJpYy5cbiAgICogQWxsb3dzIGNyZWF0aW5nIGRhc2hib2FyZHMvYWxhcm1zIG9uIG9wZXJhdGlvbiBkdXJhdGlvbnMuXG4gICAqIFVzZXMgYnVpbGREaW1lbnNpb25zKCkgdG8gZW5zdXJlIHByb3BlciBkZWR1cGxpY2F0aW9uIHdpdGggZXZlbnQudGFncy5cbiAgICovXG4gIHByaXZhdGUgcHVibGlzaFNwYW5EdXJhdGlvbk1ldHJpYyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5kdXJhdGlvbk1zIHx8ICFldmVudC5vcGVyYXRpb24pIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICAvLyBCdWlsZCBleHBsaWNpdCBkaW1lbnNpb25zIGZvciBzcGFuIG1ldHJpY3NcbiAgICAgIGNvbnN0IGV4cGxpY2l0RGltZW5zaW9uczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gICAgICBpZiAoZXZlbnQub3BlcmF0aW9uKSB7XG4gICAgICAgIGV4cGxpY2l0RGltZW5zaW9ucy5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgICB9XG4gICAgICBpZiAoZXZlbnQuc291cmNlKSB7XG4gICAgICAgIGV4cGxpY2l0RGltZW5zaW9ucy5zb3VyY2UgPSBldmVudC5zb3VyY2U7XG4gICAgICB9XG4gICAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGV4cGxpY2l0RGltZW5zaW9ucy5zdWNjZXNzID0gU3RyaW5nKGV2ZW50LnN1Y2Nlc3MpO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIHtcbiAgICAgICAgZXhwbGljaXREaW1lbnNpb25zLmVudGl0eU5hbWUgPSBldmVudC5lbnRpdHlOYW1lO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LmFjdG9yPy50ZW5hbnRJZCkge1xuICAgICAgICBleHBsaWNpdERpbWVuc2lvbnMudGVuYW50SWQgPSBldmVudC5hY3Rvci50ZW5hbnRJZDtcbiAgICAgIH1cblxuICAgICAgLy8gVXNlIGJ1aWxkRGltZW5zaW9ucyB0byBwcm9wZXJseSBkZWR1cGxpY2F0ZSB3aXRoIHRhZ3NcbiAgICAgIGNvbnN0IGRpbWVuc2lvbk1hcCA9IHRoaXMuYnVpbGREaW1lbnNpb25zKGV2ZW50LCBleHBsaWNpdERpbWVuc2lvbnMpO1xuICAgICAgY29uc3Qgc2luZ2xlTWV0cmljID0gdGhpcy5tZXRyaWNzLnNpbmdsZU1ldHJpYygpO1xuXG4gICAgICBmb3IgKGNvbnN0IFsgbmFtZSwgdmFsdWUgXSBvZiBkaW1lbnNpb25NYXAuZW50cmllcygpKSB7XG4gICAgICAgIHNpbmdsZU1ldHJpYy5hZGREaW1lbnNpb24obmFtZSwgdmFsdWUpO1xuICAgICAgfVxuXG4gICAgICBzaW5nbGVNZXRyaWMuYWRkTWV0cmljKCdzcGFuLmR1cmF0aW9uJywgTWV0cmljVW5pdC5NaWxsaXNlY29uZHMsIGV2ZW50LmR1cmF0aW9uTXMpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci53YXJuKCdGYWlsZWQgdG8gcHVibGlzaCBzcGFuIGR1cmF0aW9uIG1ldHJpYzonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEF2b2lkIG5vaXN5IHBvd2VydG9vbHMgd2FybmluZyB3aGVuIG5vIG1ldHJpY3Mgd2VyZSByZWNvcmRlZC5cbiAgICAgIGlmICghdGhpcy5oYXNBbnlNZXRyaWNzKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMubWV0cmljcy5wdWJsaXNoU3RvcmVkTWV0cmljcygpO1xuICAgICAgdGhpcy5oYXNBbnlNZXRyaWNzID0gZmFsc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGludGVybmFsTG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcHVibGlzaCBtZXRyaWNzOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBQb3dlcnRvb2xzIGhhbmRsZXMgcGVyLWludm9jYXRpb24gc3RhdGUgYXV0b21hdGljYWxseVxuICAgIHRoaXMuaGFzQW55TWV0cmljcyA9IGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBtYXBVbml0KHVuaXQ/OiBzdHJpbmcpOiAodHlwZW9mIE1ldHJpY1VuaXQpWyBrZXlvZiB0eXBlb2YgTWV0cmljVW5pdCBdIHtcbiAgICBpZiAoIXVuaXQpIHJldHVybiBNZXRyaWNVbml0LkNvdW50O1xuXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHVuaXQudG9Mb3dlckNhc2UoKTtcblxuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSAnc2Vjb25kcyc6IHJldHVybiBNZXRyaWNVbml0LlNlY29uZHM7XG4gICAgICBjYXNlICdtaWxsaXNlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5NaWxsaXNlY29uZHM7XG4gICAgICBjYXNlICdtaWNyb3NlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5NaWNyb3NlY29uZHM7XG4gICAgICBjYXNlICdieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LkJ5dGVzO1xuICAgICAgY2FzZSAna2lsb2J5dGVzJzogcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2J5dGVzO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJ5dGVzO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzJzogcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJ5dGVzO1xuICAgICAgY2FzZSAncGVyY2VudCc6IHJldHVybiBNZXRyaWNVbml0LlBlcmNlbnQ7XG4gICAgICBjYXNlICdiaXRzJzogcmV0dXJuIE1ldHJpY1VuaXQuQml0cztcbiAgICAgIGNhc2UgJ2JpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuQml0c1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2J5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAna2lsb2JpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2JpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdraWxvYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2J5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnbWVnYWJpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdtZWdhYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnZ2lnYWJpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdnaWdhYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAndGVyYWJpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuVGVyYWJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICd0ZXJhYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuVGVyYWJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnY291bnQvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuQ291bnRQZXJTZWNvbmQ7XG4gICAgICBkZWZhdWx0OiByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcbiAgICB9XG4gIH1cbn1cbiJdfQ==