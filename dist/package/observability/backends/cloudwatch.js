"use strict";
/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda:
 * - Logger for structured JSON logging
 * - Metrics for EMF (Embedded Metric Format) metrics
 *
 * DESIGN PRINCIPLES:
 * - Never crash the application
 * - Respect CloudWatch limits
 * - Proper EMF format for free metrics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudWatchBackend = void 0;
const logger_1 = require("@aws-lambda-powertools/logger");
const metrics_1 = require("@aws-lambda-powertools/metrics");
const level_utils_1 = require("../utils/level-utils");
const logging_1 = require("../../logging");
const internalLogger = (0, logging_1.createLogger)('CloudWatchBackend');
// CloudWatch limits
const MAX_DIMENSIONS = 10; // CloudWatch allows max 10 dimensions per metric
const MAX_DIMENSION_NAME_LENGTH = 256;
const MAX_DIMENSION_VALUE_LENGTH = 1024;
class CloudWatchBackend {
    name = 'cloudwatch';
    minLevel;
    logger;
    metrics;
    constructor(options) {
        this.minLevel = options.minLevel;
        this.logger = new logger_1.Logger({
            serviceName: options.serviceName,
            logLevel: (0, level_utils_1.levelToPowertoolsLogLevel)(options.minLevel),
        });
        this.metrics = new metrics_1.Metrics({
            namespace: options.namespace,
            serviceName: options.serviceName,
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
            // Never crash - log internally and continue
            internalLogger.error('CloudWatch capture failed:', error);
        }
    }
    handleLog(event) {
        // Build context object for structured logging
        const context = {
            type: event.type,
            correlationId: event.correlationId,
            logId: event.logId,
        };
        // Add optional fields only if present
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
        if (event.parentLogId)
            context.parentLogId = event.parentLogId;
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
        // Extract all Actor fields (not just actorId/actorType)
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
        // Determine message (safely extract from data)
        const message = this.extractMessage(event);
        // Log at appropriate level
        this.logAtLevel(event.level, message, context);
    }
    /**
     * Safely extract message from event (avoid unsafe casts)
     */
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
        // Collect dimensions for this metric (don't add to global state yet)
        const dimensions = [];
        // Build dimensions from attributes (respecting limits)
        if (event.attributes) {
            for (const [key, value] of Object.entries(event.attributes)) {
                // Stop if we've hit the dimension limit
                if (dimensions.length >= MAX_DIMENSIONS) {
                    internalLogger.warn(`Dimension limit reached (${MAX_DIMENSIONS}), skipping remaining`);
                    break;
                }
                // Skip non-string values (CloudWatch dimensions must be strings)
                if (typeof value !== 'string')
                    continue;
                // Validate and truncate dimension name/value
                const dimName = key.slice(0, MAX_DIMENSION_NAME_LENGTH);
                const dimValue = value.slice(0, MAX_DIMENSION_VALUE_LENGTH);
                dimensions.push({ name: dimName, value: dimValue });
            }
        }
        // Determine metric unit
        const unit = this.mapUnit(event.attributes?.unit);
        // Add each metric with its dimensions using singleMetric() to avoid dimension accumulation
        for (const [name, value] of Object.entries(event.metrics)) {
            try {
                // Use singleMetric() which creates an isolated metric context
                // This prevents dimensions from leaking between metrics
                const singleMetric = this.metrics.singleMetric();
                // Add dimensions to this isolated metric
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
        // No action needed
    }
    mapUnit(unit) {
        if (!unit)
            return metrics_1.MetricUnit.Count;
        const normalized = unit.toLowerCase();
        switch (normalized) {
            case 'seconds':
                return metrics_1.MetricUnit.Seconds;
            case 'milliseconds':
                return metrics_1.MetricUnit.Milliseconds;
            case 'microseconds':
                return metrics_1.MetricUnit.Microseconds;
            case 'bytes':
                return metrics_1.MetricUnit.Bytes;
            case 'kilobytes':
                return metrics_1.MetricUnit.Kilobytes;
            case 'megabytes':
                return metrics_1.MetricUnit.Megabytes;
            case 'gigabytes':
                return metrics_1.MetricUnit.Gigabytes;
            case 'percent':
                return metrics_1.MetricUnit.Percent;
            case 'bits':
                return metrics_1.MetricUnit.Bits;
            case 'bits/second':
                return metrics_1.MetricUnit.BitsPerSecond;
            case 'bytes/second':
                return metrics_1.MetricUnit.BytesPerSecond;
            case 'kilobits/second':
                return metrics_1.MetricUnit.KilobitsPerSecond;
            case 'kilobytes/second':
                return metrics_1.MetricUnit.KilobytesPerSecond;
            case 'megabits/second':
                return metrics_1.MetricUnit.MegabitsPerSecond;
            case 'megabytes/second':
                return metrics_1.MetricUnit.MegabytesPerSecond;
            case 'gigabits/second':
                return metrics_1.MetricUnit.GigabitsPerSecond;
            case 'gigabytes/second':
                return metrics_1.MetricUnit.GigabytesPerSecond;
            case 'terabits/second':
                return metrics_1.MetricUnit.TerabitsPerSecond;
            case 'terabytes/second':
                return metrics_1.MetricUnit.TerabytesPerSecond;
            case 'count/second':
                return metrics_1.MetricUnit.CountPerSecond;
            default:
                return metrics_1.MetricUnit.Count;
        }
    }
}
exports.CloudWatchBackend = CloudWatchBackend;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7OztHQVdHOzs7QUFFSCwwREFBdUQ7QUFDdkQsNERBQXFFO0FBRXJFLHNEQUFpRTtBQUNqRSwyQ0FBNkM7QUFFN0MsTUFBTSxjQUFjLEdBQUcsSUFBQSxzQkFBWSxFQUFDLG1CQUFtQixDQUFDLENBQUM7QUFFekQsb0JBQW9CO0FBQ3BCLE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQyxDQUFDLGlEQUFpRDtBQUM1RSxNQUFNLHlCQUF5QixHQUFHLEdBQUcsQ0FBQztBQUN0QyxNQUFNLDBCQUEwQixHQUFHLElBQUksQ0FBQztBQVF4QyxNQUFhLGlCQUFpQjtJQUNaLElBQUksR0FBRyxZQUFZLENBQUM7SUFDcEIsUUFBUSxDQUFzQjtJQUV0QyxNQUFNLENBQVM7SUFDZixPQUFPLENBQVU7SUFFekIsWUFBWSxPQUFpQztRQUMzQyxJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUM7UUFFakMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGVBQU0sQ0FBQztZQUN2QixXQUFXLEVBQUUsT0FBTyxDQUFDLFdBQVc7WUFDaEMsUUFBUSxFQUFFLElBQUEsdUNBQXlCLEVBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQztTQUN0RCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksaUJBQU8sQ0FBQztZQUN6QixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7WUFDNUIsV0FBVyxFQUFFLE9BQU8sQ0FBQyxXQUFXO1NBQ2pDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQXlCO1FBQ3JDLElBQUksQ0FBQztZQUNILElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxRQUFRLEVB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aUJBQWlCO2dCQUNwQixPQUFPLG9CQUFVLENBQUMsaUJBQWlCLENBQUM7WUFDdEMsS0FBSyxrQkFBa0I7Z0JBQ3JCLE9BQU8sb0JBQVUsQ0FBQyxrQkFBa0IsQ0FBQztZQUN2QyxLQUFLLGNBQWM7Z0JBQ2pCLE9BQU8sb0JBQVUsQ0FBQyxjQUFjLENBQUM7WUFDbkM7Z0JBQ0UsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztRQUM1QixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBdE5ELDhDQXNOQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2xvdWRXYXRjaCBCYWNrZW5kIGZvciBPYnNlcnZhYmlsaXR5XG4gKiBcbiAqIFVzZXMgQVdTIFBvd2VydG9vbHMgZm9yIExhbWJkYTpcbiAqIC0gTG9nZ2VyIGZvciBzdHJ1Y3R1cmVkIEpTT04gbG9nZ2luZ1xuICogLSBNZXRyaWNzIGZvciBFTUYgKEVtYmVkZGVkIE1ldHJpYyBGb3JtYXQpIG1ldHJpY3NcbiAqIFxuICogREVTSUdOIFBSSU5DSVBMRVM6XG4gKiAtIE5ldmVyIGNyYXNoIHRoZSBhcHBsaWNhdGlvblxuICogLSBSZXNwZWN0IENsb3VkV2F0Y2ggbGltaXRzXG4gKiAtIFByb3BlciBFTUYgZm9ybWF0IGZvciBmcmVlIG1ldHJpY3NcbiAqL1xuXG5pbXBvcnQgeyBMb2dnZXIgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcic7XG5pbXBvcnQgeyBNZXRyaWNzLCBNZXRyaWNVbml0IH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9tZXRyaWNzJztcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlCYWNrZW5kLCBPYnNlcnZhYmlsaXR5RXZlbnQsIE9ic2VydmFiaWxpdHlMZXZlbCwgT2JzZXJ2YWJpbGl0eUxldmVsU3RyaW5nIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbCB9IGZyb20gJy4uL3V0aWxzL2xldmVsLXV0aWxzJztcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuXG5jb25zdCBpbnRlcm5hbExvZ2dlciA9IGNyZWF0ZUxvZ2dlcignQ2xvdWRXYXRjaEJhY2tlbmQnKTtcblxuLy8gQ2xvdWRXYXRjaCBsaW1pdHNcbmNvbnN0IE1BWF9ESU1FTlNJT05TID0gMTA7IC8vIENsb3VkV2F0Y2ggYWxsb3dzIG1heCAxMCBkaW1lbnNpb25zIHBlciBtZXRyaWNcbmNvbnN0IE1BWF9ESU1FTlNJT05fTkFNRV9MRU5HVEggPSAyNTY7XG5jb25zdCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCA9IDEwMjQ7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xvdWRXYXRjaEJhY2tlbmRPcHRpb25zIHtcbiAgc2VydmljZU5hbWU6IHN0cmluZztcbiAgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIG1pbkxldmVsPzogT2JzZXJ2YWJpbGl0eUxldmVsO1xufVxuXG5leHBvcnQgY2xhc3MgQ2xvdWRXYXRjaEJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ2Nsb3Vkd2F0Y2gnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSBsb2dnZXI6IExvZ2dlcjtcbiAgcHJpdmF0ZSBtZXRyaWNzOiBNZXRyaWNzO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IENsb3VkV2F0Y2hCYWNrZW5kT3B0aW9ucykge1xuICAgIHRoaXMubWluTGV2ZWwgPSBvcHRpb25zLm1pbkxldmVsO1xuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgIHNlcnZpY2VOYW1lOiBvcHRpb25zLnNlcnZpY2VOYW1lLFxuICAgICAgbG9nTGV2ZWw6IGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwob3B0aW9ucy5taW5MZXZlbCksXG4gICAgfSk7XG5cbiAgICB0aGlzLm1ldHJpY3MgPSBuZXcgTWV0cmljcyh7XG4gICAgICBuYW1lc3BhY2U6IG9wdGlvbnMubmFtZXNwYWNlLFxuICAgICAgc2VydmljZU5hbWU6IG9wdGlvbnMuc2VydmljZU5hbWUsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09ICdtZXRyaWMnKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlTWV0cmljKGV2ZW50KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuaGFuZGxlTG9nKGV2ZW50KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gTmV2ZXIgY3Jhc2ggLSBsb2cgaW50ZXJuYWxseSBhbmQgY29udGludWVcbiAgICAgIGludGVybmFsTG9nZ2VyLmVycm9yKCdDbG91ZFdhdGNoIGNhcHR1cmUgZmFpbGVkOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUxvZyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgLy8gQnVpbGQgY29udGV4dCBvYmplY3QgZm9yIHN0cnVjdHVyZWQgbG9nZ2luZ1xuICAgIGNvbnN0IGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICBsb2dJZDogZXZlbnQubG9nSWQsXG4gICAgfTtcblxuICAgIC8vIEFkZCBvcHRpb25hbCBmaWVsZHMgb25seSBpZiBwcmVzZW50XG4gICAgaWYgKGV2ZW50LmVudGl0eU5hbWUpIGNvbnRleHQuZW50aXR5TmFtZSA9IGV2ZW50LmVudGl0eU5hbWU7XG4gICAgaWYgKGV2ZW50LmVudGl0eUlkKSBjb250ZXh0LmVudGl0eUlkID0gZXZlbnQuZW50aXR5SWQ7XG4gICAgaWYgKGV2ZW50Lm9wZXJhdGlvbikgY29udGV4dC5vcGVyYXRpb24gPSBldmVudC5vcGVyYXRpb247XG4gICAgaWYgKGV2ZW50LmR1cmF0aW9uTXMgIT09IHVuZGVmaW5lZCkgY29udGV4dC5kdXJhdGlvbk1zID0gZXZlbnQuZHVyYXRpb25NcztcbiAgICBpZiAoZXZlbnQuc3VjY2VzcyAhPT0gdW5kZWZpbmVkKSBjb250ZXh0LnN1Y2Nlc3MgPSBldmVudC5zdWNjZXNzO1xuICAgIGlmIChldmVudC5zdGF0dXMpIGNvbnRleHQuc3RhdHVzID0gZXZlbnQuc3RhdHVzO1xuICAgIGlmIChldmVudC5wYXJlbnRMb2dJZCkgY29udGV4dC5wYXJlbnRMb2dJZCA9IGV2ZW50LnBhcmVudExvZ0lkO1xuICAgIGlmIChldmVudC5zb3VyY2UpIGNvbnRleHQuc291cmNlID0gZXZlbnQuc291cmNlO1xuICAgIGlmIChldmVudC50YWdzKSBjb250ZXh0LnRhZ3MgPSBldmVudC50YWdzO1xuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSBjb250ZXh0LmF0dHJpYnV0ZXMgPSBldmVudC5hdHRyaWJ1dGVzO1xuICAgIGlmIChldmVudC5kYXRhKSBjb250ZXh0LmRhdGEgPSBldmVudC5kYXRhO1xuICAgIGlmIChldmVudC5lcnJvcikgY29udGV4dC5lcnJvciA9IGV2ZW50LmVycm9yO1xuICAgIC8vIEV4dHJhY3QgYWxsIEFjdG9yIGZpZWxkcyAobm90IGp1c3QgYWN0b3JJZC9hY3RvclR5cGUpXG4gICAgaWYgKGV2ZW50LmFjdG9yKSB7XG4gICAgICBjb25zdCBhY3RvciA9IGV2ZW50LmFjdG9yO1xuICAgICAgaWYgKGFjdG9yLmFjdG9ySWQpIGNvbnRleHQuYWN0b3JJZCA9IGFjdG9yLmFjdG9ySWQ7XG4gICAgICBpZiAoYWN0b3IuYWN0b3JUeXBlKSBjb250ZXh0LmFjdG9yVHlwZSA9IGFjdG9yLmFjdG9yVHlwZTtcbiAgICAgIGlmIChhY3Rvci50ZW5hbnRJZCkgY29udGV4dC50ZW5hbnRJZCA9IGFjdG9yLnRlbmFudElkO1xuICAgICAgaWYgKGFjdG9yLnNlc3Npb25JZCkgY29udGV4dC5zZXNzaW9uSWQgPSBhY3Rvci5zZXNzaW9uSWQ7XG4gICAgICBpZiAoYWN0b3IuZW1haWwpIGNvbnRleHQuYWN0b3JFbWFpbCA9IGFjdG9yLmVtYWlsO1xuICAgICAgaWYgKGFjdG9yLnNvdXJjZUlwKSBjb250ZXh0LnNvdXJjZUlwID0gYWN0b3Iuc291cmNlSXA7XG4gICAgICBpZiAoYWN0b3IudXNlckFnZW50KSBjb250ZXh0LnVzZXJBZ2VudCA9IGFjdG9yLnVzZXJBZ2VudDtcbiAgICB9XG5cbiAgICAvLyBEZXRlcm1pbmUgbWVzc2FnZSAoc2FmZWx5IGV4dHJhY3QgZnJvbSBkYXRhKVxuICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmV4dHJhY3RNZXNzYWdlKGV2ZW50KTtcblxuICAgIC8vIExvZyBhdCBhcHByb3ByaWF0ZSBsZXZlbFxuICAgIHRoaXMubG9nQXRMZXZlbChldmVudC5sZXZlbCwgbWVzc2FnZSwgY29udGV4dCk7XG4gIH1cblxuICAvKipcbiAgICogU2FmZWx5IGV4dHJhY3QgbWVzc2FnZSBmcm9tIGV2ZW50IChhdm9pZCB1bnNhZmUgY2FzdHMpXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8IGV2ZW50LnR5cGU7XG4gIH1cblxuICBwcml2YXRlIGxvZ0F0TGV2ZWwobGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgIGNhc2UgJ3RyYWNlJzpcbiAgICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5mbyc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2Fybic6XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgY2FzZSAnY3JpdGljYWwnOlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVNZXRyaWMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQubWV0cmljcyB8fCBPYmplY3Qua2V5cyhldmVudC5tZXRyaWNzKS5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIC8vIENvbGxlY3QgZGltZW5zaW9ucyBmb3IgdGhpcyBtZXRyaWMgKGRvbid0IGFkZCB0byBnbG9iYWwgc3RhdGUgeWV0KVxuICAgIGNvbnN0IGRpbWVuc2lvbnM6IEFycmF5PHsgbmFtZTogc3RyaW5nOyB2YWx1ZTogc3RyaW5nIH0+ID0gW107XG5cbiAgICAvLyBCdWlsZCBkaW1lbnNpb25zIGZyb20gYXR0cmlidXRlcyAocmVzcGVjdGluZyBsaW1pdHMpXG4gICAgaWYgKGV2ZW50LmF0dHJpYnV0ZXMpIHtcbiAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMoZXZlbnQuYXR0cmlidXRlcykpIHtcbiAgICAgICAgLy8gU3RvcCBpZiB3ZSd2ZSBoaXQgdGhlIGRpbWVuc2lvbiBsaW1pdFxuICAgICAgICBpZiAoZGltZW5zaW9ucy5sZW5ndGggPj0gTUFYX0RJTUVOU0lPTlMpIHtcbiAgICAgICAgICBpbnRlcm5hbExvZ2dlci53YXJuKGBEaW1lbnNpb24gbGltaXQgcmVhY2hlZCAoJHtNQVhfRElNRU5TSU9OU30pLCBza2lwcGluZyByZW1haW5pbmdgKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNraXAgbm9uLXN0cmluZyB2YWx1ZXMgKENsb3VkV2F0Y2ggZGltZW5zaW9ucyBtdXN0IGJlIHN0cmluZ3MpXG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSBjb250aW51ZTtcblxuICAgICAgICAvLyBWYWxpZGF0ZSBhbmQgdHJ1bmNhdGUgZGltZW5zaW9uIG5hbWUvdmFsdWVcbiAgICAgICAgY29uc3QgZGltTmFtZSA9IGtleS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX05BTUVfTEVOR1RIKTtcbiAgICAgICAgY29uc3QgZGltVmFsdWUgPSB2YWx1ZS5zbGljZSgwLCBNQVhfRElNRU5TSU9OX1ZBTFVFX0xFTkdUSCk7XG5cbiAgICAgICAgZGltZW5zaW9ucy5wdXNoKHsgbmFtZTogZGltTmFtZSwgdmFsdWU6IGRpbVZhbHVlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERldGVybWluZSBtZXRyaWMgdW5pdFxuICAgIGNvbnN0IHVuaXQgPSB0aGlzLm1hcFVuaXQoZXZlbnQuYXR0cmlidXRlcz8udW5pdCBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xuXG4gICAgLy8gQWRkIGVhY2ggbWV0cmljIHdpdGggaXRzIGRpbWVuc2lvbnMgdXNpbmcgc2luZ2xlTWV0cmljKCkgdG8gYXZvaWQgZGltZW5zaW9uIGFjY3VtdWxhdGlvblxuICAgIGZvciAoY29uc3QgWyBuYW1lLCB2YWx1ZSBdIG9mIE9iamVjdC5lbnRyaWVzKGV2ZW50Lm1ldHJpY3MpKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBVc2Ugc2luZ2xlTWV0cmljKCkgd2hpY2ggY3JlYXRlcyBhbiBpc29sYXRlZCBtZXRyaWMgY29udGV4dFxuICAgICAgICAvLyBUaGlzIHByZXZlbnRzIGRpbWVuc2lvbnMgZnJvbSBsZWFraW5nIGJldHdlZW4gbWV0cmljc1xuICAgICAgICBjb25zdCBzaW5nbGVNZXRyaWMgPSB0aGlzLm1ldHJpY3Muc2luZ2xlTWV0cmljKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBBZGQgZGltZW5zaW9ucyB0byB0aGlzIGlzb2xhdGVkIG1ldHJpY1xuICAgICAgICBmb3IgKGNvbnN0IGRpbSBvZiBkaW1lbnNpb25zKSB7XG4gICAgICAgICAgc2luZ2xlTWV0cmljLmFkZERpbWVuc2lvbihkaW0ubmFtZSwgZGltLnZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgc2luZ2xlTWV0cmljLmFkZE1ldHJpYyhuYW1lLCB1bml0LCB2YWx1ZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpbnRlcm5hbExvZ2dlci53YXJuKGBGYWlsZWQgdG8gYWRkIG1ldHJpYyAke25hbWV9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgdGhpcy5tZXRyaWNzLnB1Ymxpc2hTdG9yZWRNZXRyaWNzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGludGVybmFsTG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gcHVibGlzaCBtZXRyaWNzOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBQb3dlcnRvb2xzIGhhbmRsZXMgcGVyLWludm9jYXRpb24gc3RhdGUgYXV0b21hdGljYWxseVxuICAgIC8vIE5vIGFjdGlvbiBuZWVkZWRcbiAgfVxuXG4gIHByaXZhdGUgbWFwVW5pdCh1bml0Pzogc3RyaW5nKTogKHR5cGVvZiBNZXRyaWNVbml0KVsga2V5b2YgdHlwZW9mIE1ldHJpY1VuaXQgXSB7XG4gICAgaWYgKCF1bml0KSByZXR1cm4gTWV0cmljVW5pdC5Db3VudDtcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB1bml0LnRvTG93ZXJDYXNlKCk7XG5cbiAgICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICAgIGNhc2UgJ3NlY29uZHMnOlxuICAgICAgICByZXR1cm4gTWV0cmljVW5pdC5TZWNvbmRzO1xuICAgICAgY2FzZSAnbWlsbGlzZWNvbmRzJzpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuTWlsbGlzZWNvbmRzO1xuICAgICAgY2FzZSAnbWljcm9zZWNvbmRzJzpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuTWljcm9zZWNvbmRzO1xuICAgICAgY2FzZSAnYnl0ZXMnOlxuICAgICAgICByZXR1cm4gTWV0cmljVW5pdC5CeXRlcztcbiAgICAgIGNhc2UgJ2tpbG9ieXRlcyc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlcztcbiAgICAgIGNhc2UgJ21lZ2FieXRlcyc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlcztcbiAgICAgIGNhc2UgJ2dpZ2FieXRlcyc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlcztcbiAgICAgIGNhc2UgJ3BlcmNlbnQnOlxuICAgICAgICByZXR1cm4gTWV0cmljVW5pdC5QZXJjZW50O1xuICAgICAgY2FzZSAnYml0cyc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkJpdHM7XG4gICAgICBjYXNlICdiaXRzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkJpdHNQZXJTZWNvbmQ7XG4gICAgICBjYXNlICdieXRlcy9zZWNvbmQnOlxuICAgICAgICByZXR1cm4gTWV0cmljVW5pdC5CeXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2tpbG9iaXRzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LktpbG9iaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAna2lsb2J5dGVzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LktpbG9ieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ21lZ2FiaXRzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0Lk1lZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0Lk1lZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2dpZ2FiaXRzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkdpZ2FiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkdpZ2FieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ3RlcmFiaXRzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LlRlcmFiaXRzUGVyU2Vjb25kO1xuICAgICAgY2FzZSAndGVyYWJ5dGVzL3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LlRlcmFieXRlc1BlclNlY29uZDtcbiAgICAgIGNhc2UgJ2NvdW50L3NlY29uZCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkNvdW50UGVyU2Vjb25kO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuQ291bnQ7XG4gICAgfVxuICB9XG59XG4iXX0=