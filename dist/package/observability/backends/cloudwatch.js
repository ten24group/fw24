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
                this.handleMetric(event);
            }
            // For span events, publish durationMs as a separate metric ONLY if not already in metrics
            // This avoids duplicate metric publishing (span.end includes { metrics: { duration } })
            if (event.type.startsWith('span.') && event.durationMs !== undefined && !event.metrics?.duration) {
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
    handleMetric(event) {
        if (!event.metrics || Object.keys(event.metrics).length === 0)
            return;
        // Use a Map to deduplicate dimensions by name (first occurrence wins)
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
        // Priority 2: Add dimensions from attributes (only if not already present)
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
        // Priority 3: Add entity context as dimension (only if not already present)
        if (event.entityName && dimensionMap.size < MAX_DIMENSIONS && !dimensionMap.has('entityName')) {
            dimensionMap.set('entityName', event.entityName);
        }
        // Convert Map to array
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
     * Publish span duration as a CloudWatch metric
     * Allows creating dashboards/alarms on operation durations
     */
    publishSpanDurationMetric(event) {
        if (!event.durationMs || !event.operation)
            return;
        try {
            const singleMetric = this.metrics.singleMetric();
            // Add dimensions for filtering
            if (event.operation) {
                singleMetric.addDimension('operation', event.operation.slice(0, MAX_DIMENSION_VALUE_LENGTH));
            }
            if (event.source) {
                singleMetric.addDimension('source', event.source.slice(0, MAX_DIMENSION_VALUE_LENGTH));
            }
            if (event.success !== undefined) {
                singleMetric.addDimension('success', String(event.success));
            }
            if (event.entityName) {
                singleMetric.addDimension('entityName', event.entityName);
            }
            // Add tenant/actor dimensions if available
            if (event.actor?.tenantId) {
                singleMetric.addDimension('tenantId', event.actor.tenantId.slice(0, MAX_DIMENSION_VALUE_LENGTH));
            }
            singleMetric.addMetric('span.duration', metrics_1.MetricUnit.Milliseconds, event.durationMs);
        }
        catch (error) {
            internalLogger.warn('Failed to publish span duration metric:', error);
        }
    }
    async flush() {
        try {
            this.metrics.publishStoredMetrics();
        }
        catch (error) {
            internalLogger.error('Failed to publish metrics:', error);
        }
    }
    initializeInvocation() {
        // Powertools handles per-invocation state automatically
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7Ozs7Ozs7Ozs7QUFFSCwwREFBdUQ7QUFDdkQsNERBQXFFO0FBQ3JFLGlDQUFvRDtBQUNwRCwyQ0FBNkM7QUFFN0Msc0RBQWlFO0FBRWpFLE1BQU0sY0FBYyxHQUFHLElBQUEsc0JBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXpELG9CQUFvQjtBQUNwQixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUM7QUFDMUIsTUFBTSx5QkFBeUIsR0FBRyxHQUFHLENBQUM7QUFDdEMsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUM7QUFPakMsSUFBTSxpQkFBaUIsR0FBdkIsTUFBTSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBRXpCLFlBQzZDLFdBQW1CLEVBQ1YsU0FBaUIsRUFDN0IsUUFBNEI7UUFFcEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFFekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGVBQU0sQ0FBQztZQUN2QixXQUFXLEVBQUUsV0FBVztZQUN4QixRQUFRLEVBQUUsSUFBQSx1Q0FBeUIsRUFBQyxRQUFRLENBQUM7U0FDOUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLGlCQUFPLENBQUM7WUFDekIsU0FBUyxFQUFFLFNBQVM7WUFDcEIsV0FBVyxFQUFFLFdBQVc7U0FDekIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsSUFBSSxDQUFDO1lBQ0gsa0ZBQWtGO1lBQ2xGLDhGQUE4RjtZQUM5RixJQUFJLEtB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QixDQUFDLENBQUE7SUFDekMsV0FBQSxJQUFBLGlCQUFZLEVBQUMsb0NBQW9DLENBQUMsQ0FBQTtJQUNsRCxXQUFBLElBQUEsaUJBQVksRUFBQyx3QkFBd0IsQ0FBQyxDQUFBO0dBVjlCLGlCQUFpQixDQTBQN0IiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENsb3VkV2F0Y2ggQmFja2VuZCBmb3IgT2JzZXJ2YWJpbGl0eVxuICogXG4gKiBVc2VzIEFXUyBQb3dlcnRvb2xzIGZvciBMYW1iZGE6XG4gKiAtIExvZ2dlciBmb3Igc3RydWN0dXJlZCBKU09OIGxvZ2dpbmdcbiAqIC0gTWV0cmljcyBmb3IgRU1GIChFbWJlZGRlZCBNZXRyaWMgRm9ybWF0KSBtZXRyaWNzXG4gKiBcbiAqIEFsbCBjb25maWcgaW5qZWN0ZWQgdmlhIERJIC0gbm8gZmFsbGJhY2tzLlxuICovXG5cbmltcG9ydCB7IExvZ2dlciB9IGZyb20gJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJztcbmltcG9ydCB7IE1ldHJpY3MsIE1ldHJpY1VuaXQgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL21ldHJpY3MnO1xuaW1wb3J0IHsgSW5qZWN0YWJsZSwgSW5qZWN0Q29uZmlnIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5QmFja2VuZCwgT2JzZXJ2YWJpbGl0eUV2ZW50LCBPYnNlcnZhYmlsaXR5TGV2ZWwsIE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwgfSBmcm9tICcuLi91dGlscy9sZXZlbC11dGlscyc7XG5cbmNvbnN0IGludGVybmFsTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdDbG91ZFdhdGNoQmFja2VuZCcpO1xuXG4vLyBDbG91ZFdhdGNoIGxpbWl0c1xuY29uc3QgTUFYX0RJTUVOU0lPTlMgPSAxMDtcbmNvbnN0IE1BWF9ESU1FTlNJT05fTkFNRV9MRU5HVEggPSAyNTY7XG5jb25zdCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCA9IDEwMjQ7XG5cbkBJbmplY3RhYmxlKHtcbiAgcHJvdmlkZTogJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgcHJvdmlkZWRJbjogJ1JPT1QnLFxuICB0YWdzOiBbICdvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnY2xvdWR3YXRjaCcgXVxufSlcbmV4cG9ydCBjbGFzcyBDbG91ZFdhdGNoQmFja2VuZCBpbXBsZW1lbnRzIE9ic2VydmFiaWxpdHlCYWNrZW5kIHtcbiAgcHVibGljIHJlYWRvbmx5IG5hbWUgPSAnY2xvdWR3YXRjaCc7XG4gIHB1YmxpYyByZWFkb25seSBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcblxuICBwcml2YXRlIGxvZ2dlcjogTG9nZ2VyO1xuICBwcml2YXRlIG1ldHJpY3M6IE1ldHJpY3M7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5zZXJ2aWNlTmFtZScpIHNlcnZpY2VOYW1lOiBzdHJpbmcsXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5jbG91ZHdhdGNoLm5hbWVzcGFjZScpIG5hbWVzcGFjZTogc3RyaW5nLFxuICAgIEBJbmplY3RDb25maWcoJ29ic2VydmFiaWxpdHkubWluTGV2ZWwnKSBtaW5MZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsXG4gICkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBtaW5MZXZlbDtcblxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgICBzZXJ2aWNlTmFtZTogc2VydmljZU5hbWUsXG4gICAgICBsb2dMZXZlbDogbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbChtaW5MZXZlbCksXG4gICAgfSk7XG5cbiAgICB0aGlzLm1ldHJpY3MgPSBuZXcgTWV0cmljcyh7XG4gICAgICBuYW1lc3BhY2U6IG5hbWVzcGFjZSxcbiAgICAgIHNlcnZpY2VOYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGNhcHR1cmUoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBBTFdBWVMgZXh0cmFjdCBhbmQgcHVibGlzaCBtZXRyaWNzIHZpYSBFTUYgaWYgcHJlc2VudCwgcmVnYXJkbGVzcyBvZiBldmVudCB0eXBlXG4gICAgICAvLyBUaGlzIGVuc3VyZXMgbWV0cmljcyBlbWJlZGRlZCBpbiBzcGFucywgYXVkaXRzLCBvciBsb2dzIGFyZSBwdWJsaXNoZWQgYXMgQ2xvdWRXYXRjaCBtZXRyaWNzXG4gICAgICBpZiAoZXZlbnQubWV0cmljcyAmJiBPYmplY3Qua2V5cyhldmVudC5tZXRyaWNzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlTWV0cmljKGV2ZW50KTtcbiAgICAgIH1cblxuICAgICAgLy8gRm9yIHNwYW4gZXZlbnRzLCBwdWJsaXNoIGR1cmF0aW9uTXMgYXMgYSBzZXBhcmF0ZSBtZXRyaWMgT05MWSBpZiBub3QgYWxyZWFkeSBpbiBtZXRyaWNzXG4gICAgICAvLyBUaGlzIGF2b2lkcyBkdXBsaWNhdGUgbWV0cmljIHB1Ymxpc2hpbmcgKHNwYW4uZW5kIGluY2x1ZGVzIHsgbWV0cmljczogeyBkdXJhdGlvbiB9IH0pXG4gICAgICBpZiAoZXZlbnQudHlwZS5zdGFydHNXaXRoKCdzcGFuLicpICYmIGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCAmJiAhZXZlbnQubWV0cmljcz8uZHVyYXRpb24pIHtcbiAgICAgICAgdGhpcy5wdWJsaXNoU3BhbkR1cmF0aW9uTWV0cmljKGV2ZW50KTtcbiAgICAgIH1cblxuICAgICAgLy8gTG9nIHRoZSBldmVudCAodW5sZXNzIGl0J3MgYSBwdXJlIG1ldHJpYyBldmVudCB3aXRoIG5vIG90aGVyIGRhdGEpXG4gICAgICBpZiAoZXZlbnQudHlwZSAhPT0gJ21ldHJpYycpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVMb2coZXZlbnQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci5lcnJvcignQ2xvdWRXYXRjaCBjYXB0dXJlIGZhaWxlZDonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVMb2coZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICBvYnNlcnZhYmlsaXR5TG9nSWQ6IGV2ZW50Lm9ic2VydmFiaWxpdHlMb2dJZCxcbiAgICB9O1xuXG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIGNvbnRleHQuZW50aXR5TmFtZSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gICAgaWYgKGV2ZW50LmVudGl0eUlkKSBjb250ZXh0LmVudGl0eUlkID0gZXZlbnQuZW50aXR5SWQ7XG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikgY29udGV4dC5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkgY29udGV4dC5kdXJhdGlvbk1zID0gZXZlbnQuZHVyYXRpb25NcztcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSBjb250ZXh0LnN1Y2Nlc3MgPSBldmVudC5zdWNjZXNzO1xuICAgIGlmIChldmVudC5zdGF0dXMpIGNvbnRleHQuc3RhdHVzID0gZXZlbnQuc3RhdHVzO1xuICAgIGlmIChldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQpIGNvbnRleHQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkID0gZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkO1xuICAgIGlmIChldmVudC5jYXVzZWRCeSkgY29udGV4dC5jYXVzZWRCeSA9IGV2ZW50LmNhdXNlZEJ5O1xuICAgIGlmIChldmVudC5yZWxhdGVkVHJhY2VzKSBjb250ZXh0LnJlbGF0ZWRUcmFjZXMgPSBldmVudC5yZWxhdGVkVHJhY2VzO1xuICAgIGlmIChldmVudC5zb3VyY2UpIGNvbnRleHQuc291cmNlID0gZXZlbnQuc291cmNlO1xuICAgIGlmIChldmVudC50YWdzKSBjb250ZXh0LnRhZ3MgPSBldmVudC50YWdzO1xuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSBjb250ZXh0LmF0dHJpYnV0ZXMgPSBldmVudC5hdHRyaWJ1dGVzO1xuICAgIGlmIChldmVudC5kYXRhKSBjb250ZXh0LmRhdGEgPSBldmVudC5kYXRhO1xuICAgIGlmIChldmVudC5lcnJvcikgY29udGV4dC5lcnJvciA9IGV2ZW50LmVycm9yO1xuICAgIGlmIChldmVudC5hY3Rvcikge1xuICAgICAgY29uc3QgYWN0b3IgPSBldmVudC5hY3RvcjtcbiAgICAgIGlmIChhY3Rvci5hY3RvcklkKSBjb250ZXh0LmFjdG9ySWQgPSBhY3Rvci5hY3RvcklkO1xuICAgICAgaWYgKGFjdG9yLmFjdG9yVHlwZSkgY29udGV4dC5hY3RvclR5cGUgPSBhY3Rvci5hY3RvclR5cGU7XG4gICAgICBpZiAoYWN0b3IudGVuYW50SWQpIGNvbnRleHQudGVuYW50SWQgPSBhY3Rvci50ZW5hbnRJZDtcbiAgICAgIGlmIChhY3Rvci5zZXNzaW9uSWQpIGNvbnRleHQuc2Vzc2lvbklkID0gYWN0b3Iuc2Vzc2lvbklkO1xuICAgICAgaWYgKGFjdG9yLmVtYWlsKSBjb250ZXh0LmFjdG9yRW1haWwgPSBhY3Rvci5lbWFpbDtcbiAgICAgIGlmIChhY3Rvci5zb3VyY2VJcCkgY29udGV4dC5zb3VyY2VJcCA9IGFjdG9yLnNvdXJjZUlwO1xuICAgICAgaWYgKGFjdG9yLnVzZXJBZ2VudCkgY29udGV4dC51c2VyQWdlbnQgPSBhY3Rvci51c2VyQWdlbnQ7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuZXh0cmFjdE1lc3NhZ2UoZXZlbnQpO1xuICAgIHRoaXMubG9nQXRMZXZlbChldmVudC5sZXZlbCwgbWVzc2FnZSwgY29udGV4dCk7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8IGV2ZW50LnR5cGU7XG4gIH1cblxuICBwcml2YXRlIGxvZ0F0TGV2ZWwobGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgIGNhc2UgJ3RyYWNlJzpcbiAgICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5mbyc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2Fybic6XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgY2FzZSAnY3JpdGljYWwnOlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVNZXRyaWMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQubWV0cmljcyB8fCBPYmplY3Qua2V5cyhldmVudC5tZXRyaWNzKS5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIC8vIFVzZSBhIE1hcCB0byBkZWR1cGxpY2F0ZSBkaW1lbnNpb25zIGJ5IG5hbWUgKGZpcnN0IG9jY3VycmVuY2Ugd2lucylcbiAgICBjb25zdCBkaW1lbnNpb25NYXAgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogQWRkIGNvbW1vbiBkaW1lbnNpb25zIGZyb20gdGFncyAodGVuYW50LCBlbnRpdHksIG9wZXJhdGlvbiwgZXRjLilcbiAgICBpZiAoZXZlbnQudGFncykge1xuICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC50YWdzKSkge1xuICAgICAgICBpZiAoZGltZW5zaW9uTWFwLnNpemUgPj0gTUFYX0RJTUVOU0lPTlMpIGJyZWFrO1xuICAgICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiAhZGltZW5zaW9uTWFwLmhhcyhrZXkpKSB7XG4gICAgICAgICAgZGltZW5zaW9uTWFwLnNldChcbiAgICAgICAgICAgIGtleS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIKSxcbiAgICAgICAgICAgIHZhbHVlLnNsaWNlKDAsIE1BWF9ESU1FTlNJT05fVkFMVUVfTEVOR1RIKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAyOiBBZGQgZGltZW5zaW9ucyBmcm9tIGF0dHJpYnV0ZXMgKG9ubHkgaWYgbm90IGFscmVhZHkgcHJlc2VudClcbiAgICBpZiAoZXZlbnQuYXR0cmlidXRlcykge1xuICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhldmVudC5hdHRyaWJ1dGVzKSkge1xuICAgICAgICBpZiAoZGltZW5zaW9uTWFwLnNpemUgPj0gTUFYX0RJTUVOU0lPTlMpIHtcbiAgICAgICAgICBpbnRlcm5hbExvZ2dlci53YXJuKGBEaW1lbnNpb24gbGltaXQgcmVhY2hlZCAoJHtNQVhfRElNRU5TSU9OU30pLCBza2lwcGluZyByZW1haW5pbmcgYXR0cmlidXRlc2ApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIGNvbnRpbnVlO1xuXG4gICAgICAgIGNvbnN0IGRpbU5hbWUgPSBrZXkuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9OQU1FX0xFTkdUSCk7XG4gICAgICAgIGNvbnN0IGRpbVZhbHVlID0gdmFsdWUuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEgpO1xuXG4gICAgICAgIC8vIE9ubHkgYWRkIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQgKGRlZHVwbGljYXRpb24pXG4gICAgICAgIGlmICghZGltZW5zaW9uTWFwLmhhcyhkaW1OYW1lKSkge1xuICAgICAgICAgIGRpbWVuc2lvbk1hcC5zZXQoZGltTmFtZSwgZGltVmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMzogQWRkIGVudGl0eSBjb250ZXh0IGFzIGRpbWVuc2lvbiAob25seSBpZiBub3QgYWxyZWFkeSBwcmVzZW50KVxuICAgIGlmIChldmVudC5lbnRpdHlOYW1lICYmIGRpbWVuc2lvbk1hcC5zaXplIDwgTUFYX0RJTUVOU0lPTlMgJiYgIWRpbWVuc2lvbk1hcC5oYXMoJ2VudGl0eU5hbWUnKSkge1xuICAgICAgZGltZW5zaW9uTWFwLnNldCgnZW50aXR5TmFtZScsIGV2ZW50LmVudGl0eU5hbWUpO1xuICAgIH1cblxuICAgIC8vIENvbnZlcnQgTWFwIHRvIGFycmF5XG4gICAgY29uc3QgZGltZW5zaW9ucyA9IEFycmF5LmZyb20oZGltZW5zaW9uTWFwLmVudHJpZXMoKSkubWFwKChbIG5hbWUsIHZhbHVlIF0pID0+ICh7IG5hbWUsIHZhbHVlIH0pKTtcblxuICAgIGNvbnN0IHVuaXQgPSB0aGlzLm1hcFVuaXQoZXZlbnQuYXR0cmlidXRlcz8udW5pdCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xuXG4gICAgZm9yIChjb25zdCBbIG5hbWUsIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQubWV0cmljcykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNpbmdsZU1ldHJpYyA9IHRoaXMubWV0cmljcy5zaW5nbGVNZXRyaWMoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGRpbSBvZiBkaW1lbnNpb25zKSB7XG4gICAgICAgICAgc2luZ2xlTWV0cmljLmFkZERpbWVuc2lvbihkaW0ubmFtZSwgZGltLnZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNpbmdsZU1ldHJpYy5hZGRNZXRyaWMobmFtZSwgdW5pdCwgdmFsdWUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaW50ZXJuYWxMb2dnZXIud2FybihgRmFpbGVkIHRvIGFkZCBtZXRyaWMgJHtuYW1lfTpgLCBlcnJvcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1Ymxpc2ggc3BhbiBkdXJhdGlvbiBhcyBhIENsb3VkV2F0Y2ggbWV0cmljXG4gICAqIEFsbG93cyBjcmVhdGluZyBkYXNoYm9hcmRzL2FsYXJtcyBvbiBvcGVyYXRpb24gZHVyYXRpb25zXG4gICAqL1xuICBwcml2YXRlIHB1Ymxpc2hTcGFuRHVyYXRpb25NZXRyaWMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZHVyYXRpb25NcyB8fCAhZXZlbnQub3BlcmF0aW9uKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2luZ2xlTWV0cmljID0gdGhpcy5tZXRyaWNzLnNpbmdsZU1ldHJpYygpO1xuXG4gICAgICAvLyBBZGQgZGltZW5zaW9ucyBmb3IgZmlsdGVyaW5nXG4gICAgICBpZiAoZXZlbnQub3BlcmF0aW9uKSB7XG4gICAgICAgIHNpbmdsZU1ldHJpYy5hZGREaW1lbnNpb24oJ29wZXJhdGlvbicsIGV2ZW50Lm9wZXJhdGlvbi5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCkpO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LnNvdXJjZSkge1xuICAgICAgICBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKCdzb3VyY2UnLCBldmVudC5zb3VyY2Uuc2xpY2UoMCwgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEgpKTtcbiAgICAgIH1cbiAgICAgIGlmIChldmVudC5zdWNjZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2luZ2xlTWV0cmljLmFkZERpbWVuc2lvbignc3VjY2VzcycsIFN0cmluZyhldmVudC5zdWNjZXNzKSk7XG4gICAgICB9XG4gICAgICBpZiAoZXZlbnQuZW50aXR5TmFtZSkge1xuICAgICAgICBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKCdlbnRpdHlOYW1lJywgZXZlbnQuZW50aXR5TmFtZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEFkZCB0ZW5hbnQvYWN0b3IgZGltZW5zaW9ucyBpZiBhdmFpbGFibGVcbiAgICAgIGlmIChldmVudC5hY3Rvcj8udGVuYW50SWQpIHtcbiAgICAgICAgc2luZ2xlTWV0cmljLmFkZERpbWVuc2lvbigndGVuYW50SWQnLCBldmVudC5hY3Rvci50ZW5hbnRJZC5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCkpO1xuICAgICAgfVxuXG4gICAgICBzaW5nbGVNZXRyaWMuYWRkTWV0cmljKCdzcGFuLmR1cmF0aW9uJywgTWV0cmljVW5pdC5NaWxsaXNlY29uZHMsIGV2ZW50LmR1cmF0aW9uTXMpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci53YXJuKCdGYWlsZWQgdG8gcHVibGlzaCBzcGFuIGR1cmF0aW9uIG1ldHJpYzonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMubWV0cmljcy5wdWJsaXNoU3RvcmVkTWV0cmljcygpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci5lcnJvcignRmFpbGVkIHRvIHB1Ymxpc2ggbWV0cmljczonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgaW5pdGlhbGl6ZUludm9jYXRpb24oKTogdm9pZCB7XG4gICAgLy8gUG93ZXJ0b29scyBoYW5kbGVzIHBlci1pbnZvY2F0aW9uIHN0YXRlIGF1dG9tYXRpY2FsbHlcbiAgfVxuXG4gIHByaXZhdGUgbWFwVW5pdCh1bml0Pzogc3RyaW5nKTogKHR5cGVvZiBNZXRyaWNVbml0KVsga2V5b2YgdHlwZW9mIE1ldHJpY1VuaXQgXSB7XG4gICAgaWYgKCF1bml0KSByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB1bml0LnRvTG93ZXJDYXNlKCk7XG5cbiAgICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICAgIGNhc2UgJ3NlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5TZWNvbmRzO1xuICAgICAgY2FzZSAnbWlsbGlzZWNvbmRzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWlsbGlzZWNvbmRzO1xuICAgICAgY2FzZSAnbWljcm9zZWNvbmRzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWljcm9zZWNvbmRzO1xuICAgICAgY2FzZSAnYnl0ZXMnOiByZXR1cm4gTWV0cmljVW5pdC5CeXRlcztcbiAgICAgIGNhc2UgJ2tpbG9ieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlcztcbiAgICAgIGNhc2UgJ21lZ2FieXRlcyc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlcztcbiAgICAgIGNhc2UgJ2dpZ2FieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlcztcbiAgICAgIGNhc2UgJ3BlcmNlbnQnOiByZXR1cm4gTWV0cmljVW5pdC5QZXJjZW50O1xuICAgICAgY2FzZSAnYml0cyc6IHJldHVybiBNZXRyaWNVbml0LkJpdHM7XG4gICAgICBjYXNlICdiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdieXRlcy9zZWNvbmQnOiByZXR1cm4gTWV0cmljVW5pdC5CeXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2tpbG9iaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LktpbG9iaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAna2lsb2J5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ21lZ2FiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2dpZ2FiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ3RlcmFiaXRzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LlRlcmFiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAndGVyYWJ5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LlRlcmFieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2NvdW50L3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkNvdW50UGVyU2Vjb25kO1xuICAgICAgZGVmYXVsdDogcmV0dXJuIE1ldHJpY1VuaXQuQ291bnQ7XG4gICAgfVxuICB9XG59XG4iXX0=