"use strict";
/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda Logger for structured JSON logging.
 * Metrics publishing via EMF is kept simple - one namespace, no complex sampling/filtering.
 *
 * For advanced metrics, use the OTEL backend which routes metrics through ADOT.
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
let CloudWatchBackend = class CloudWatchBackend {
    name = 'cloudwatch';
    minLevel;
    logger;
    metrics;
    hasAnyMetrics = false;
    constructor(serviceName, minLevel, config) {
        this.minLevel = minLevel;
        this.logger = new logger_1.Logger({
            serviceName,
            logLevel: (0, level_utils_1.levelToPowertoolsLogLevel)(minLevel),
        });
        this.metrics = new metrics_1.Metrics({
            namespace: config.namespace,
            serviceName,
        });
    }
    async capture(event) {
        try {
            // Publish metrics if present
            if (event.metrics && Object.keys(event.metrics).length > 0) {
                this.publishMetrics(event);
            }
            else if (event.type === 'span' && event.durationMs !== undefined) {
                // Publish span duration as a metric
                this.publishSpanDuration(event);
            }
            // Log the event (skip pure metric events)
            if (event.type !== 'metric') {
                this.logEvent(event);
            }
        }
        catch (error) {
            internalLogger.error('CloudWatch capture failed:', error);
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Structured Logging
    // ═══════════════════════════════════════════════════════════════════════════
    logEvent(event) {
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
        if (event.source)
            context.source = event.source;
        if (event.tags)
            context.tags = event.tags;
        if (event.data)
            context.data = event.data;
        if (event.error)
            context.error = event.error;
        // absorbed data is inside event.data — no separate handling needed
        if (event.actor) {
            const { actorId, actorType, tenantId, sessionId, email, sourceIp, userAgent } = event.actor;
            if (actorId)
                context.actorId = actorId;
            if (actorType)
                context.actorType = actorType;
            if (tenantId)
                context.tenantId = tenantId;
            if (sessionId)
                context.sessionId = sessionId;
            if (email)
                context.actorEmail = email;
            if (sourceIp)
                context.sourceIp = sourceIp;
            if (userAgent)
                context.userAgent = userAgent;
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
    // ═══════════════════════════════════════════════════════════════════════════
    // Basic EMF Metrics
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Extract the category prefix from source (e.g., 'controller' from 'controller:OrderController.create').
     * Keeps CloudWatch dimension cardinality bounded to ~5 values (controller, service, queue, task, function).
     */
    getSourceCategory(source) {
        const colonIndex = source.indexOf(':');
        return colonIndex > 0 ? source.substring(0, colonIndex) : source;
    }
    publishMetrics(event) {
        if (!event.metrics)
            return;
        try {
            const singleMetric = this.metrics.singleMetric();
            // Add basic dimensions (source is normalized to category to prevent high-cardinality billing trap)
            if (event.operation)
                singleMetric.addDimension('operation', event.operation);
            if (event.source)
                singleMetric.addDimension('source', this.getSourceCategory(event.source));
            if (event.success !== undefined)
                singleMetric.addDimension('success', String(event.success));
            for (const [name, value] of Object.entries(event.metrics)) {
                const unit = this.inferUnit(name);
                singleMetric.addMetric(name, unit, value);
            }
            this.hasAnyMetrics = true;
        }
        catch (error) {
            internalLogger.warn('Failed to publish metrics:', error);
        }
    }
    publishSpanDuration(event) {
        if (event.durationMs === undefined)
            return;
        try {
            const singleMetric = this.metrics.singleMetric();
            if (event.operation)
                singleMetric.addDimension('operation', event.operation);
            if (event.source)
                singleMetric.addDimension('source', this.getSourceCategory(event.source));
            if (event.success !== undefined)
                singleMetric.addDimension('success', String(event.success));
            singleMetric.addMetric('duration', metrics_1.MetricUnit.Milliseconds, event.durationMs);
            this.hasAnyMetrics = true;
        }
        catch (error) {
            internalLogger.warn('Failed to publish span duration metric:', error);
        }
    }
    inferUnit(metricName) {
        if (metricName.includes('duration') || metricName.includes('latency') || metricName.endsWith('Ms')) {
            return metrics_1.MetricUnit.Milliseconds;
        }
        if (metricName.includes('bytes') || metricName.includes('size') || metricName.endsWith('Bytes')) {
            return metrics_1.MetricUnit.Bytes;
        }
        if (metricName.includes('percent') || metricName.includes('rate')) {
            return metrics_1.MetricUnit.Percent;
        }
        return metrics_1.MetricUnit.Count;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════════
    async flush() {
        try {
            if (this.hasAnyMetrics) {
                this.metrics.publishStoredMetrics();
                this.hasAnyMetrics = false;
            }
        }
        catch (error) {
            internalLogger.error('Failed to publish metrics:', error);
        }
    }
    initializeInvocation() {
        this.hasAnyMetrics = false;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7O0dBT0c7Ozs7Ozs7Ozs7OztBQUVILDBEQUF1RDtBQUN2RCw0REFBcUU7QUFDckUsaUNBQW9EO0FBQ3BELDJDQUE2QztBQVE3QyxzREFBaUU7QUFFakUsTUFBTSxjQUFjLEdBQUcsSUFBQSxzQkFBWSxFQUFDLG1CQUFtQixDQUFDLENBQUM7QUFPbEQsSUFBTSxpQkFBaUIsR0FBdkIsTUFBTSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFN0IsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBQzFCLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFFOUIsWUFDNkMsV0FBbUIsRUFDdEIsUUFBNEIsRUFDMUIsTUFBd0I7UUFFbEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFFekIsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGVBQU0sQ0FBQztZQUN2QixXQUFXO1lBQ1gsUUFBUSxFQUFFLElBQUEsdUNBQXlCLEVBQUMsUUFBUSxDQUFDO1NBQzlDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxpQkFBTyxDQUFDO1lBQ3pCLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztZQUMzQixXQUFXO1NBQ1osQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsSUFBSSxDQUFDO1lBQ0gsNkJBQTZCO1lBQzdCLElBQUksS0FBSyxDQUFDLE9BQU8sSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzNELElBQUksQ0FBQyxjQUFj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QUNILENBQUM7SUFFRCxvQkFBb0I7UUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUM7SUFDN0IsQ0FBQztDQUNGLENBQUE7QUFsTVksOENBQWlCOzRCQUFqQixpQkFBaUI7SUFMN0IsSUFBQSxlQUFVLEVBQUM7UUFDVixPQUFPLEVBQUUsc0JBQXNCO1FBQy9CLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxDQUFDLGVBQWUsRUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDO0tBQ2pELENBQUM7SUFVRyxXQUFBLElBQUEsaUJBQVksRUFBQywyQkFBMkIsQ0FBQyxDQUFBO0lBQ3pDLFdBQUEsSUFBQSxpQkFBWSxFQUFDLHdCQUF3QixDQUFDLENBQUE7SUFDdEMsV0FBQSxJQUFBLGlCQUFZLEVBQUMsMEJBQTBCLENBQUMsQ0FBQTtHQVhoQyxpQkFBaUIsQ0FrTTdCIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDbG91ZFdhdGNoIEJhY2tlbmQgZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogVXNlcyBBV1MgUG93ZXJ0b29scyBmb3IgTGFtYmRhIExvZ2dlciBmb3Igc3RydWN0dXJlZCBKU09OIGxvZ2dpbmcuXG4gKiBNZXRyaWNzIHB1Ymxpc2hpbmcgdmlhIEVNRiBpcyBrZXB0IHNpbXBsZSAtIG9uZSBuYW1lc3BhY2UsIG5vIGNvbXBsZXggc2FtcGxpbmcvZmlsdGVyaW5nLlxuICogXG4gKiBGb3IgYWR2YW5jZWQgbWV0cmljcywgdXNlIHRoZSBPVEVMIGJhY2tlbmQgd2hpY2ggcm91dGVzIG1ldHJpY3MgdGhyb3VnaCBBRE9ULlxuICovXG5cbmltcG9ydCB7IExvZ2dlciB9IGZyb20gJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJztcbmltcG9ydCB7IE1ldHJpY3MsIE1ldHJpY1VuaXQgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL21ldHJpY3MnO1xuaW1wb3J0IHsgSW5qZWN0YWJsZSwgSW5qZWN0Q29uZmlnIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgdHlwZSB7XG4gIE9ic2VydmFiaWxpdHlCYWNrZW5kLFxuICBPYnNlcnZhYmlsaXR5RXZlbnQsXG4gIE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZyxcbiAgQ2xvdWRXYXRjaENvbmZpZyxcbn0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eUxldmVsIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbCB9IGZyb20gJy4uL3V0aWxzL2xldmVsLXV0aWxzJztcblxuY29uc3QgaW50ZXJuYWxMb2dnZXIgPSBjcmVhdGVMb2dnZXIoJ0Nsb3VkV2F0Y2hCYWNrZW5kJyk7XG5cbkBJbmplY3RhYmxlKHtcbiAgcHJvdmlkZTogJ09ic2VydmFiaWxpdHlCYWNrZW5kJyxcbiAgcHJvdmlkZWRJbjogJ1JPT1QnLFxuICB0YWdzOiBbJ29ic2VydmFiaWxpdHknLCAnYmFja2VuZCcsICdjbG91ZHdhdGNoJ11cbn0pXG5leHBvcnQgY2xhc3MgQ2xvdWRXYXRjaEJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ2Nsb3Vkd2F0Y2gnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBsb2dnZXI6IExvZ2dlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBtZXRyaWNzOiBNZXRyaWNzO1xuICBwcml2YXRlIGhhc0FueU1ldHJpY3MgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LnNlcnZpY2VOYW1lJykgc2VydmljZU5hbWU6IHN0cmluZyxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5Lm1pbkxldmVsJykgbWluTGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbCxcbiAgICBASW5qZWN0Q29uZmlnKCdvYnNlcnZhYmlsaXR5LmNsb3Vkd2F0Y2gnKSBjb25maWc6IENsb3VkV2F0Y2hDb25maWdcbiAgKSB7XG4gICAgdGhpcy5taW5MZXZlbCA9IG1pbkxldmVsO1xuXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICAgIHNlcnZpY2VOYW1lLFxuICAgICAgbG9nTGV2ZWw6IGxldmVsVG9Qb3dlcnRvb2xzTG9nTGV2ZWwobWluTGV2ZWwpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5tZXRyaWNzID0gbmV3IE1ldHJpY3Moe1xuICAgICAgbmFtZXNwYWNlOiBjb25maWcubmFtZXNwYWNlLFxuICAgICAgc2VydmljZU5hbWUsXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gUHVibGlzaCBtZXRyaWNzIGlmIHByZXNlbnRcbiAgICAgIGlmIChldmVudC5tZXRyaWNzICYmIE9iamVjdC5rZXlzKGV2ZW50Lm1ldHJpY3MpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy5wdWJsaXNoTWV0cmljcyhldmVudCk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LnR5cGUgPT09ICdzcGFuJyAmJiBldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gUHVibGlzaCBzcGFuIGR1cmF0aW9uIGFzIGEgbWV0cmljXG4gICAgICAgIHRoaXMucHVibGlzaFNwYW5EdXJhdGlvbihldmVudCk7XG4gICAgICB9XG5cbiAgICAgIC8vIExvZyB0aGUgZXZlbnQgKHNraXAgcHVyZSBtZXRyaWMgZXZlbnRzKVxuICAgICAgaWYgKGV2ZW50LnR5cGUgIT09ICdtZXRyaWMnKSB7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoZXZlbnQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci5lcnJvcignQ2xvdWRXYXRjaCBjYXB0dXJlIGZhaWxlZDonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIFN0cnVjdHVyZWQgTG9nZ2luZ1xuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcblxuICBwcml2YXRlIGxvZ0V2ZW50KGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBjb25zdCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgIHR5cGU6IGV2ZW50LnR5cGUsXG4gICAgICBjb3JyZWxhdGlvbklkOiBldmVudC5jb3JyZWxhdGlvbklkLFxuICAgICAgb2JzZXJ2YWJpbGl0eUxvZ0lkOiBldmVudC5vYnNlcnZhYmlsaXR5TG9nSWQsXG4gICAgfTtcblxuICAgIGlmIChldmVudC5lbnRpdHlOYW1lKSBjb250ZXh0LmVudGl0eU5hbWUgPSBldmVudC5lbnRpdHlOYW1lO1xuICAgIGlmIChldmVudC5lbnRpdHlJZCkgY29udGV4dC5lbnRpdHlJZCA9IGV2ZW50LmVudGl0eUlkO1xuICAgIGlmIChldmVudC5vcGVyYXRpb24pIGNvbnRleHQub3BlcmF0aW9uID0gZXZlbnQub3BlcmF0aW9uO1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zICE9PSB1bmRlZmluZWQpIGNvbnRleHQuZHVyYXRpb25NcyA9IGV2ZW50LmR1cmF0aW9uTXM7XG4gICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkgY29udGV4dC5zdWNjZXNzID0gZXZlbnQuc3VjY2VzcztcbiAgICBpZiAoZXZlbnQuc3RhdHVzKSBjb250ZXh0LnN0YXR1cyA9IGV2ZW50LnN0YXR1cztcbiAgICBpZiAoZXZlbnQucGFyZW50T2JzZXJ2YWJpbGl0eUxvZ0lkKSBjb250ZXh0LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZCA9IGV2ZW50LnBhcmVudE9ic2VydmFiaWxpdHlMb2dJZDtcbiAgICBpZiAoZXZlbnQuY2F1c2VkQnkpIGNvbnRleHQuY2F1c2VkQnkgPSBldmVudC5jYXVzZWRCeTtcbiAgICBpZiAoZXZlbnQuc291cmNlKSBjb250ZXh0LnNvdXJjZSA9IGV2ZW50LnNvdXJjZTtcbiAgICBpZiAoZXZlbnQudGFncykgY29udGV4dC50YWdzID0gZXZlbnQudGFncztcbiAgICBpZiAoZXZlbnQuZGF0YSkgY29udGV4dC5kYXRhID0gZXZlbnQuZGF0YTtcbiAgICBpZiAoZXZlbnQuZXJyb3IpIGNvbnRleHQuZXJyb3IgPSBldmVudC5lcnJvcjtcbiAgICAvLyBhYnNvcmJlZCBkYXRhIGlzIGluc2lkZSBldmVudC5kYXRhIOKAlCBubyBzZXBhcmF0ZSBoYW5kbGluZyBuZWVkZWRcblxuICAgIGlmIChldmVudC5hY3Rvcikge1xuICAgICAgY29uc3QgeyBhY3RvcklkLCBhY3RvclR5cGUsIHRlbmFudElkLCBzZXNzaW9uSWQsIGVtYWlsLCBzb3VyY2VJcCwgdXNlckFnZW50IH0gPSBldmVudC5hY3RvcjtcbiAgICAgIGlmIChhY3RvcklkKSBjb250ZXh0LmFjdG9ySWQgPSBhY3RvcklkO1xuICAgICAgaWYgKGFjdG9yVHlwZSkgY29udGV4dC5hY3RvclR5cGUgPSBhY3RvclR5cGU7XG4gICAgICBpZiAodGVuYW50SWQpIGNvbnRleHQudGVuYW50SWQgPSB0ZW5hbnRJZDtcbiAgICAgIGlmIChzZXNzaW9uSWQpIGNvbnRleHQuc2Vzc2lvbklkID0gc2Vzc2lvbklkO1xuICAgICAgaWYgKGVtYWlsKSBjb250ZXh0LmFjdG9yRW1haWwgPSBlbWFpbDtcbiAgICAgIGlmIChzb3VyY2VJcCkgY29udGV4dC5zb3VyY2VJcCA9IHNvdXJjZUlwO1xuICAgICAgaWYgKHVzZXJBZ2VudCkgY29udGV4dC51c2VyQWdlbnQgPSB1c2VyQWdlbnQ7XG4gICAgfVxuXG4gICAgY29uc3QgbWVzc2FnZSA9IHRoaXMuZXh0cmFjdE1lc3NhZ2UoZXZlbnQpO1xuICAgIHRoaXMubG9nQXRMZXZlbChldmVudC5sZXZlbCwgbWVzc2FnZSwgY29udGV4dCk7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3RNZXNzYWdlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBzdHJpbmcge1xuICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhLm1lc3NhZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gZXZlbnQuZGF0YS5tZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXZlbnQub3BlcmF0aW9uIHx8IGV2ZW50LnR5cGU7XG4gIH1cblxuICBwcml2YXRlIGxvZ0F0TGV2ZWwobGV2ZWw6IE9ic2VydmFiaWxpdHlMZXZlbFN0cmluZywgbWVzc2FnZTogc3RyaW5nLCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQge1xuICAgIHN3aXRjaCAobGV2ZWwpIHtcbiAgICAgIGNhc2UgJ3RyYWNlJzpcbiAgICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5mbyc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2Fybic6XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgY2FzZSAnY3JpdGljYWwnOlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQXG4gIC8vIEJhc2ljIEVNRiBNZXRyaWNzXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIC8qKlxuICAgKiBFeHRyYWN0IHRoZSBjYXRlZ29yeSBwcmVmaXggZnJvbSBzb3VyY2UgKGUuZy4sICdjb250cm9sbGVyJyBmcm9tICdjb250cm9sbGVyOk9yZGVyQ29udHJvbGxlci5jcmVhdGUnKS5cbiAgICogS2VlcHMgQ2xvdWRXYXRjaCBkaW1lbnNpb24gY2FyZGluYWxpdHkgYm91bmRlZCB0byB+NSB2YWx1ZXMgKGNvbnRyb2xsZXIsIHNlcnZpY2UsIHF1ZXVlLCB0YXNrLCBmdW5jdGlvbikuXG4gICAqL1xuICBwcml2YXRlIGdldFNvdXJjZUNhdGVnb3J5KHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBjb2xvbkluZGV4ID0gc291cmNlLmluZGV4T2YoJzonKTtcbiAgICByZXR1cm4gY29sb25JbmRleCA+IDAgPyBzb3VyY2Uuc3Vic3RyaW5nKDAsIGNvbG9uSW5kZXgpIDogc291cmNlO1xuICB9XG5cbiAgcHJpdmF0ZSBwdWJsaXNoTWV0cmljcyhldmVudDogT2JzZXJ2YWJpbGl0eUV2ZW50KTogdm9pZCB7XG4gICAgaWYgKCFldmVudC5tZXRyaWNzKSByZXR1cm47XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc2luZ2xlTWV0cmljID0gdGhpcy5tZXRyaWNzLnNpbmdsZU1ldHJpYygpO1xuXG4gICAgICAvLyBBZGQgYmFzaWMgZGltZW5zaW9ucyAoc291cmNlIGlzIG5vcm1hbGl6ZWQgdG8gY2F0ZWdvcnkgdG8gcHJldmVudCBoaWdoLWNhcmRpbmFsaXR5IGJpbGxpbmcgdHJhcClcbiAgICAgIGlmIChldmVudC5vcGVyYXRpb24pIHNpbmdsZU1ldHJpYy5hZGREaW1lbnNpb24oJ29wZXJhdGlvbicsIGV2ZW50Lm9wZXJhdGlvbik7XG4gICAgICBpZiAoZXZlbnQuc291cmNlKSBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKCdzb3VyY2UnLCB0aGlzLmdldFNvdXJjZUNhdGVnb3J5KGV2ZW50LnNvdXJjZSkpO1xuICAgICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkgc2luZ2xlTWV0cmljLmFkZERpbWVuc2lvbignc3VjY2VzcycsIFN0cmluZyhldmVudC5zdWNjZXNzKSk7XG5cbiAgICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhldmVudC5tZXRyaWNzKSkge1xuICAgICAgICBjb25zdCB1bml0ID0gdGhpcy5pbmZlclVuaXQobmFtZSk7XG4gICAgICAgIHNpbmdsZU1ldHJpYy5hZGRNZXRyaWMobmFtZSwgdW5pdCwgdmFsdWUpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmhhc0FueU1ldHJpY3MgPSB0cnVlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpbnRlcm5hbExvZ2dlci53YXJuKCdGYWlsZWQgdG8gcHVibGlzaCBtZXRyaWNzOicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHB1Ymxpc2hTcGFuRHVyYXRpb24oZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmIChldmVudC5kdXJhdGlvbk1zID09PSB1bmRlZmluZWQpIHJldHVybjtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzaW5nbGVNZXRyaWMgPSB0aGlzLm1ldHJpY3Muc2luZ2xlTWV0cmljKCk7XG5cbiAgICAgIGlmIChldmVudC5vcGVyYXRpb24pIHNpbmdsZU1ldHJpYy5hZGREaW1lbnNpb24oJ29wZXJhdGlvbicsIGV2ZW50Lm9wZXJhdGlvbik7XG4gICAgICBpZiAoZXZlbnQuc291cmNlKSBzaW5nbGVNZXRyaWMuYWRkRGltZW5zaW9uKCdzb3VyY2UnLCB0aGlzLmdldFNvdXJjZUNhdGVnb3J5KGV2ZW50LnNvdXJjZSkpO1xuICAgICAgaWYgKGV2ZW50LnN1Y2Nlc3MgIT09IHVuZGVmaW5lZCkgc2luZ2xlTWV0cmljLmFkZERpbWVuc2lvbignc3VjY2VzcycsIFN0cmluZyhldmVudC5zdWNjZXNzKSk7XG5cbiAgICAgIHNpbmdsZU1ldHJpYy5hZGRNZXRyaWMoJ2R1cmF0aW9uJywgTWV0cmljVW5pdC5NaWxsaXNlY29uZHMsIGV2ZW50LmR1cmF0aW9uTXMpO1xuICAgICAgdGhpcy5oYXNBbnlNZXRyaWNzID0gdHJ1ZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaW50ZXJuYWxMb2dnZXIud2FybignRmFpbGVkIHRvIHB1Ymxpc2ggc3BhbiBkdXJhdGlvbiBtZXRyaWM6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaW5mZXJVbml0KG1ldHJpY05hbWU6IHN0cmluZyk6IHR5cGVvZiBNZXRyaWNVbml0W2tleW9mIHR5cGVvZiBNZXRyaWNVbml0XSB7XG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2R1cmF0aW9uJykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygnbGF0ZW5jeScpIHx8IG1ldHJpY05hbWUuZW5kc1dpdGgoJ01zJykpIHtcbiAgICAgIHJldHVybiBNZXRyaWNVbml0Lk1pbGxpc2Vjb25kcztcbiAgICB9XG4gICAgaWYgKG1ldHJpY05hbWUuaW5jbHVkZXMoJ2J5dGVzJykgfHwgbWV0cmljTmFtZS5pbmNsdWRlcygnc2l6ZScpIHx8IG1ldHJpY05hbWUuZW5kc1dpdGgoJ0J5dGVzJykpIHtcbiAgICAgIHJldHVybiBNZXRyaWNVbml0LkJ5dGVzO1xuICAgIH1cbiAgICBpZiAobWV0cmljTmFtZS5pbmNsdWRlcygncGVyY2VudCcpIHx8IG1ldHJpY05hbWUuaW5jbHVkZXMoJ3JhdGUnKSkge1xuICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuUGVyY2VudDtcbiAgICB9XG4gICAgcmV0dXJuIE1ldHJpY1VuaXQuQ291bnQ7XG4gIH1cblxuICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgLy8gTGlmZWN5Y2xlXG4gIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5oYXNBbnlNZXRyaWNzKSB7XG4gICAgICAgIHRoaXMubWV0cmljcy5wdWJsaXNoU3RvcmVkTWV0cmljcygpO1xuICAgICAgICB0aGlzLmhhc0FueU1ldHJpY3MgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaW50ZXJuYWxMb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byBwdWJsaXNoIG1ldHJpY3M6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIGluaXRpYWxpemVJbnZvY2F0aW9uKCk6IHZvaWQge1xuICAgIHRoaXMuaGFzQW55TWV0cmljcyA9IGZhbHNlO1xuICB9XG59XG4iXX0=