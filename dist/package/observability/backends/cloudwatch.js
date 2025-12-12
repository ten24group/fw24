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
const level_utils_1 = require("../utils/level-utils");
const logging_1 = require("../../logging");
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
            if (event.type === 'metric') {
                this.handleMetric(event);
            }
            else {
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
        const dimensions = [];
        if (event.attributes) {
            for (const [key, value] of Object.entries(event.attributes)) {
                if (dimensions.length >= MAX_DIMENSIONS) {
                    internalLogger.warn(`Dimension limit reached (${MAX_DIMENSIONS}), skipping remaining`);
                    break;
                }
                if (typeof value !== 'string')
                    continue;
                const dimName = key.slice(0, MAX_DIMENSION_NAME_LENGTH);
                const dimValue = value.slice(0, MAX_DIMENSION_VALUE_LENGTH);
                dimensions.push({ name: dimName, value: dimValue });
            }
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7OztHQVFHOzs7Ozs7Ozs7Ozs7QUFFSCwwREFBdUQ7QUFDdkQsNERBQXFFO0FBQ3JFLGlDQUFvRDtBQUVwRCxzREFBaUU7QUFDakUsMkNBQTZDO0FBRTdDLE1BQU0sY0FBYyxHQUFHLElBQUEsc0JBQVksRUFBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXpELG9CQUFvQjtBQUNwQixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUM7QUFDMUIsTUFBTSx5QkFBeUIsR0FBRyxHQUFHLENBQUM7QUFDdEMsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLENBQUM7QUFPakMsSUFBTSxpQkFBaUIsR0FBdkIsTUFBTSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBRXpCLFlBQzZDLFdBQW1CLEVBQ1YsU0FBaUIsRUFDN0IsUUFBNEI7UUFFcEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFFekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGVBQU0sQ0FBQztZQUN2QixXQUFXLEVBQUUsV0FBVztZQUN4QixRQUFRLEVBQUUsSUFBQSx1Q0FBeUIsRUFBQyxRQUFRLENBQUM7U0FDOUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLGlCQUFPLENBQUM7WUFDekIsU0FBUyxFQUFFLFNBQVM7WUFDcEIsV0FBVyxFQUFFLFdBQVc7U0FDekIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxLQUFLLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFB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QUMsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztRQUNuQyxDQUFDO0lBQ0gsQ0FBQztDQUNGLENBQUE7QUFoTFksOENBQWlCOzRCQUFqQixpQkFBaUI7SUFMN0IsSUFBQSxlQUFVLEVBQUM7UUFDVixPQUFPLEVBQUUsc0JBQXNCO1FBQy9CLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxDQUFDLGVBQWUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO0tBQ2pELENBQUM7SUFTRyxXQUFBLElBQUEsaUJBQVksRUFBQywyQkFBMkIsQ0FBQyxDQUFBO0lBQ3pDLFdBQUEsSUFBQSxpQkFBWSxFQUFDLG9DQUFvQyxDQUFDLENBQUE7SUFDbEQsV0FBQSxJQUFBLGlCQUFZLEVBQUMsd0JBQXdCLENBQUMsQ0FBQTtHQVY5QixpQkFBaUIsQ0FnTDdCIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDbG91ZFdhdGNoIEJhY2tlbmQgZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogVXNlcyBBV1MgUG93ZXJ0b29scyBmb3IgTGFtYmRhOlxuICogLSBMb2dnZXIgZm9yIHN0cnVjdHVyZWQgSlNPTiBsb2dnaW5nXG4gKiAtIE1ldHJpY3MgZm9yIEVNRiAoRW1iZWRkZWQgTWV0cmljIEZvcm1hdCkgbWV0cmljc1xuICogXG4gKiBBbGwgY29uZmlnIGluamVjdGVkIHZpYSBESSAtIG5vIGZhbGxiYWNrcy5cbiAqL1xuXG5pbXBvcnQgeyBMb2dnZXIgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcic7XG5pbXBvcnQgeyBNZXRyaWNzLCBNZXRyaWNVbml0IH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9tZXRyaWNzJztcbmltcG9ydCB7IEluamVjdGFibGUsIEluamVjdENvbmZpZyB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbCB9IGZyb20gJy4uL3V0aWxzL2xldmVsLXV0aWxzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuXG5jb25zdCBpbnRlcm5hbExvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ2xvdWRXYXRjaEJhY2tlbmQnKTtcblxuLy8gQ2xvdWRXYXRjaCBsaW1pdHNcbmNvbnN0IE1BWF9ESU1FTlNJT05TID0gMTA7XG5jb25zdCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIID0gMjU2O1xuY29uc3QgTUFYX0RJTUVOU0lPTl9WQUxVRV9MRU5HVEggPSAxMDI0O1xuXG5ASW5qZWN0YWJsZSh7XG4gIHByb3ZpZGU6ICdPYnNlcnZhYmlsaXR5QmFja2VuZCcsXG4gIHByb3ZpZGVkSW46ICdST09UJyxcbiAgdGFnczogWydvYnNlcnZhYmlsaXR5JywgJ2JhY2tlbmQnLCAnY2xvdWR3YXRjaCddXG59KVxuZXhwb3J0IGNsYXNzIENsb3VkV2F0Y2hCYWNrZW5kIGltcGxlbWVudHMgT2JzZXJ2YWJpbGl0eUJhY2tlbmQge1xuICBwdWJsaWMgcmVhZG9ubHkgbmFtZSA9ICdjbG91ZHdhdGNoJztcbiAgcHVibGljIHJlYWRvbmx5IG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xuXG4gIHByaXZhdGUgbG9nZ2VyOiBMb2dnZXI7XG4gIHByaXZhdGUgbWV0cmljczogTWV0cmljcztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LnNlcnZpY2VOYW1lJykgc2VydmljZU5hbWU6IHN0cmluZyxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmNsb3Vkd2F0Y2gubmFtZXNwYWNlJykgbmFtZXNwYWNlOiBzdHJpbmcsXG4gICAgQEluamVjdENvbmZpZygnb2JzZXJ2YWJpbGl0eS5taW5MZXZlbCcpIG1pbkxldmVsOiBPYnNlcnZhYmlsaXR5TGV2ZWxcbiAgKSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgIHNlcnZpY2VOYW1lOiBzZXJ2aWNlTmFtZSxcbiAgICAgIGxvZ0xldmVsOiBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsKG1pbkxldmVsKSxcbiAgICB9KTtcblxuICAgIHRoaXMubWV0cmljcyA9IG5ldyBNZXRyaWNzKHtcbiAgICAgIG5hbWVzcGFjZTogbmFtZXNwYWNlLFxuICAgICAgc2VydmljZU5hbWU6IHNlcnZpY2VOYW1lLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgY2FwdHVyZShldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGlmIChldmVudC50eXBlID09PSAnbWV0cmljJykge1xuICAgICAgICB0aGlzLmhhbmRsZU1ldHJpYyhldmVudCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmhhbmRsZUxvZyhldmVudCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGludGVybmFsTG9nZ2VyLmVycm9yKCdDbG91ZFdhdGNoIGNhcHR1cmUgZmFpbGVkOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUxvZyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgY29uc3QgY29udGV4dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgICB0eXBlOiBldmVudC50eXBlLFxuICAgICAgY29ycmVsYXRpb25JZDogZXZlbnQuY29ycmVsYXRpb25JZCxcbiAgICAgIG9ic2VydmFiaWxpdHlMb2dJZDogZXZlbnQub2JzZXJ2YWJpbGl0eUxvZ0lkLFxuICAgIH07XG5cbiAgICBpZiAoZXZlbnQuZW50aXR5TmFtZSkgY29udGV4dC5lbnRpdHlOYW1lID0gZXZlbnQuZW50aXR5TmFtZTtcbiAgICBpZiAoZXZlbnQuZW50aXR5SWQpIGNvbnRleHQuZW50aXR5SWQgPSBldmVudC5lbnRpdHlJZDtcbiAgICBpZiAoZXZlbnQub3BlcmF0aW9uKSBjb250ZXh0Lm9wZXJhdGlvbiA9IGV2ZW50Lm9wZXJhdGlvbjtcbiAgICBpZiAoZXZlbnQuZHVyYXRpb25NcyAhPT0gdW5kZWZpbmVkKSBjb250ZXh0LmR1cmF0aW9uTXMgPSBldmVudC5kdXJhdGlvbk1zO1xuICAgIGlmIChldmVudC5zdWNjZXNzICE9PSB1bmRlZmluZWQpIGNvbnRleHQuc3VjY2VzcyA9IGV2ZW50LnN1Y2Nlc3M7XG4gICAgaWYgKGV2ZW50LnN0YXR1cykgY29udGV4dC5zdGF0dXMgPSBldmVudC5zdGF0dXM7XG4gICAgaWYgKGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCkgY29udGV4dC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQgPSBldmVudC5wYXJlbnRPYnNlcnZhYmlsaXR5TG9nSWQ7XG4gICAgaWYgKGV2ZW50LnNvdXJjZSkgY29udGV4dC5zb3VyY2UgPSBldmVudC5zb3VyY2U7XG4gICAgaWYgKGV2ZW50LnRhZ3MpIGNvbnRleHQudGFncyA9IGV2ZW50LnRhZ3M7XG4gICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIGNvbnRleHQuYXR0cmlidXRlcyA9IGV2ZW50LmF0dHJpYnV0ZXM7XG4gICAgaWYgKGV2ZW50LmRhdGEpIGNvbnRleHQuZGF0YSA9IGV2ZW50LmRhdGE7XG4gICAgaWYgKGV2ZW50LmVycm9yKSBjb250ZXh0LmVycm9yID0gZXZlbnQuZXJyb3I7XG4gICAgaWYgKGV2ZW50LmFjdG9yKSB7XG4gICAgICBjb25zdCBhY3RvciA9IGV2ZW50LmFjdG9yO1xuICAgICAgaWYgKGFjdG9yLmFjdG9ySWQpIGNvbnRleHQuYWN0b3JJZCA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICBpZiAoYWN0b3IuYWN0b3JUeXBlKSBjb250ZXh0LmFjdG9yVHlwZSA9IGFjdG9yLmFjdG9yVHlwZTtcbiAgICAgIGlmIChhY3Rvci50ZW5hbnRJZCkgY29udGV4dC50ZW5hbnRJZCA9IGFjdG9yLnRlbmFudElkO1xuICAgICAgaWYgKGFjdG9yLnNlc3Npb25JZCkgY29udGV4dC5zZXNzaW9uSWQgPSBhY3Rvci5zZXNzaW9uSWQ7XG4gICAgICBpZiAoYWN0b3IuZW1haWwpIGNvbnRleHQuYWN0b3JFbWFpbCA9IGFjdG9yLmVtYWlsO1xuICAgICAgaWYgKGFjdG9yLnNvdXJjZUlwKSBjb250ZXh0LnNvdXJjZUlwID0gYWN0b3Iuc291cmNlSXA7XG4gICAgICBpZiAoYWN0b3IudXNlckFnZW50KSBjb250ZXh0LnVzZXJBZ2VudCA9IGFjdG9yLnVzZXJBZ2VudDtcbiAgICB9XG5cbiAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5leHRyYWN0TWVzc2FnZShldmVudCk7XG4gICAgdGhpcy5sb2dBdExldmVsKGV2ZW50LmxldmVsLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdE1lc3NhZ2UoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHN0cmluZyB7XG4gICAgaWYgKGV2ZW50LmRhdGEgJiYgdHlwZW9mIGV2ZW50LmRhdGEubWVzc2FnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBldmVudC5kYXRhLm1lc3NhZ2U7XG4gICAgfVxuICAgIHJldHVybiBldmVudC5vcGVyYXRpb24gfHwgZXZlbnQudHlwZTtcbiAgfVxuXG4gIHByaXZhdGUgbG9nQXRMZXZlbChsZXZlbDogT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCB7XG4gICAgc3dpdGNoIChsZXZlbCkge1xuICAgICAgY2FzZSAndHJhY2UnOlxuICAgICAgY2FzZSAnZGVidWcnOlxuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdpbmZvJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd3YXJuJzpcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICBjYXNlICdjcml0aWNhbCc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmVycm9yKG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZU1ldHJpYyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5tZXRyaWNzIHx8IE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZGltZW5zaW9uczogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmcgfT4gPSBbXTtcblxuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhldmVudC5hdHRyaWJ1dGVzKSkge1xuICAgICAgICBpZiAoZGltZW5zaW9ucy5sZW5ndGggPj0gTUFYX0RJTUVOU0lPTlMpIHtcbiAgICAgICAgICBpbnRlcm5hbExvZ2dlci53YXJuKGBEaW1lbnNpb24gbGltaXQgcmVhY2hlZCAoJHtNQVhfRElNRU5TSU9OU30pLCBza2lwcGluZyByZW1haW5pbmdgKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSBjb250aW51ZTtcblxuICAgICAgICBjb25zdCBkaW1OYW1lID0ga2V5LnNsaWNlKDAsIE1BWF9ESU1FTlNJT05fTkFNRV9MRU5HVEgpO1xuICAgICAgICBjb25zdCBkaW1WYWx1ZSA9IHZhbHVlLnNsaWNlKDAsIE1BWF9ESU1FTlNJT05fVkFMVUVfTEVOR1RIKTtcblxuICAgICAgICBkaW1lbnNpb25zLnB1c2goeyBuYW1lOiBkaW1OYW1lLCB2YWx1ZTogZGltVmFsdWUgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdW5pdCA9IHRoaXMubWFwVW5pdChldmVudC5hdHRyaWJ1dGVzPy51bml0IGFzIHN0cmluZyB8IHVuZGVmaW5lZCk7XG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQubWV0cmljcykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNpbmdsZU1ldHJpYyA9IHRoaXMubWV0cmljcy5zaW5nbGVNZXRyaWMoKTtcbiAgICAgICAgXG4gICAgICAgIGZvciAoY29uc3QgZGltIG9mIGRpbWVuc2lvbnMpIHtcbiAgICAgICAgICBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKGRpbS5uYW1lLCBkaW0udmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBzaW5nbGVNZXRyaWMuYWRkTWV0cmljKG5hbWUsIHVuaXQsIHZhbHVlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGludGVybmFsTG9nZ2VyLndhcm4oYEZhaWxlZCB0byBhZGQgbWV0cmljICR7bmFtZX06YCwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLm1ldHJpY3MucHVibGlzaFN0b3JlZE1ldHJpY3MoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaW50ZXJuYWxMb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBwdWJsaXNoIG1ldHJpY3M6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIC8vIFBvd2VydG9vbHMgaGFuZGxlcyBwZXItaW52b2NhdGlvbiBzdGF0ZSBhdXRvbWF0aWNhbGx5XG4gIH1cblxuICBwcml2YXRlIG1hcFVuaXQodW5pdD86IHN0cmluZyk6ICh0eXBlb2YgTWV0cmljVW5pdClba2V5b2YgdHlwZW9mIE1ldHJpY1VuaXRdIHtcbiAgICBpZiAoIXVuaXQpIHJldHVybiBNZXRyaWNVbml0LkNvdW50O1xuXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHVuaXQudG9Mb3dlckNhc2UoKTtcblxuICAgIHN3aXRjaCAobm9ybWFsaXplZCkge1xuICAgICAgY2FzZSAnc2Vjb25kcyc6IHJldHVybiBNZXRyaWNVbml0LlNlY29uZHM7XG4gICAgICBjYXNlICdtaWxsaXNlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5NaWxsaXNlY29uZHM7XG4gICAgICBjYXNlICdtaWNyb3NlY29uZHMnOiByZXR1cm4gTWV0cmljVW5pdC5NaWNyb3NlY29uZHM7XG4gICAgICBjYXNlICdieXRlcyc6IHJldHVybiBNZXRyaWNVbml0LkJ5dGVzO1xuICAgICAgY2FzZSAna2lsb2J5dGVzJzogcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2J5dGVzO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzJzogcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJ5dGVzO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzJzogcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJ5dGVzO1xuICAgICAgY2FzZSAncGVyY2VudCc6IHJldHVybiBNZXRyaWNVbml0LlBlcmNlbnQ7XG4gICAgICBjYXNlICdiaXRzJzogcmV0dXJuIE1ldHJpY1VuaXQuQml0cztcbiAgICAgIGNhc2UgJ2JpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuQml0c1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2J5dGVzL3NlY29uZCc6IHJldHVybiBNZXRyaWNVbml0LkJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAna2lsb2JpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2JpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdraWxvYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2J5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnbWVnYWJpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdtZWdhYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnZ2lnYWJpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdnaWdhYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAndGVyYWJpdHMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuVGVyYWJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICd0ZXJhYnl0ZXMvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuVGVyYWJ5dGVzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnY291bnQvc2Vjb25kJzogcmV0dXJuIE1ldHJpY1VuaXQuQ291bnRQZXJTZWNvbmQ7XG4gICAgICBkZWZhdWx0OiByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcbiAgICB9XG4gIH1cbn1cbiJdfQ==