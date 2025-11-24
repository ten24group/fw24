"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudWatchBackend = void 0;
const logger_1 = require("@aws-lambda-powertools/logger");
const metrics_1 = require("@aws-lambda-powertools/metrics");
const level_utils_1 = require("../utils/level-utils");
class CloudWatchBackend {
    name = 'cloudwatch';
    minLevel;
    logger;
    metrics;
    constructor(options = {}) {
        this.minLevel = options.minLevel;
        this.logger = new logger_1.Logger({
            serviceName: options.serviceName || process.env.SERVICE_NAME || 'fw24-service',
            logLevel: (0, level_utils_1.levelToPowertoolsLogLevel)(options.minLevel),
        });
        this.metrics = new metrics_1.Metrics({
            namespace: options.namespace || process.env.CLOUDWATCH_METRICS_NAMESPACE || 'FW24',
            serviceName: options.serviceName || process.env.SERVICE_NAME || 'fw24-service',
        });
    }
    async capture(event) {
        // Route by type
        if (event.type === 'metric') {
            this.handleMetric(event);
        }
        else {
            this.handleLog(event);
        }
    }
    handleLog(event) {
        const context = {
            type: event.type,
            correlationId: event.correlationId,
            entityName: event.entityName,
            entityId: event.entityId,
            operation: event.operation,
            ...(event.durationMs && { durationMs: event.durationMs }),
            ...(event.success !== undefined && { success: event.success }),
            ...(event.attributes && { attributes: event.attributes }),
            ...(event.data && { data: event.data }),
        };
        const message = event.data?.message || event.operation || event.type;
        // Log everything as structured JSON
        switch (event.level) {
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
            default:
                this.logger.info(message, context);
        }
    }
    handleMetric(event) {
        if (!event.metrics)
            return;
        // Add dimensions from attributes
        if (event.attributes) {
            Object.entries(event.attributes).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    this.metrics.addDimension(key, value);
                }
            });
        }
        // Determine metric unit
        const unit = this.mapUnit(event.attributes?.unit);
        // EMF format - FREE CloudWatch Metrics!
        Object.entries(event.metrics).forEach(([name, value]) => {
            this.metrics.addMetric(name, unit, value);
        });
    }
    async flush() {
        this.metrics.publishStoredMetrics();
    }
    initializeInvocation() {
        // Powertools handles per-invocation state automatically
    }
    mapUnit(unit) {
        switch (unit?.toLowerCase()) {
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
            case 'count':
                return metrics_1.MetricUnit.Count;
            default:
                return metrics_1.MetricUnit.Count;
        }
    }
}
exports.CloudWatchBackend = CloudWatchBackend;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL2Nsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMERBQXVEO0FBQ3ZELDREQUFxRTtBQUVyRSxzREFBaUU7QUFRakUsTUFBYSxpQkFBaUI7SUFDWixJQUFJLEdBQUcsWUFBWSxDQUFDO0lBQ3BCLFFBQVEsQ0FBc0I7SUFFdEMsTUFBTSxDQUFTO0lBQ2YsT0FBTyxDQUFVO0lBRXpCLFlBQVksVUFBb0MsRUFBRTtRQUNoRCxJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUM7UUFFakMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGVBQU0sQ0FBQztZQUN2QixXQUFXLEVBQUUsT0FBTyxDQUFDLFdBQVcsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksSUFBSSxjQUFjO1lBQzlFLFFBQVEsRUFBRSxJQUFBLHVDQUF5QixFQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLGlCQUFPLENBQUM7WUFDekIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxTQUFTLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsSUFBSSxNQUFNO1lBQ2xGLFdBQVcsRUFBRSxPQUFPLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxJQUFJLGNBQWM7U0FDL0UsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBeUI7UUFDckMsZ0JBQWdCO1FBQ2hCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUM1QixJQUFJLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzNCLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFD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QUUsS0FBSyxDQUFDLENBQUM7UUFDNUMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLENBQUMsT0FBTyxDQUFDLG9CQUFvQixFQUFFLENBQUM7SUFDdEMsQ0FBQztJQUVELG9CQUFvQjtRQUNsQix3REFBd0Q7SUFDMUQsQ0FBQztJQUVPLE9BQU8sQ0FBQyxJQUFhO1FBQzNCLFFBQVEsSUFBSSxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDNUIsS0FBSyxTQUFTO2dCQUNaLE9BQU8sb0JBQVUsQ0FBQyxPQUFPLENBQUM7WUFDNUIsS0FBSyxjQUFjO2dCQUNqQixPQUFPLG9CQUFVLENBQUMsWUFBWSxDQUFDO1lBQ2pDLEtBQUssY0FBYztnQkFDakIsT0FBTyxvQkFBVSxDQUFDLFlBQVksQ0FBQztZQUNqQyxLQUFLLE9BQU87Z0JBQ1YsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztZQUMxQixLQUFLLFdBQVc7Z0JBQ2QsT0FBTyxvQkFBVSxDQUFDLFNBQVMsQ0FBQztZQUM5QixLQUFLLFdBQVc7Z0JBQ2QsT0FBTyxvQkFBVSxDQUFDLFNBQVMsQ0FBQztZQUM5QixLQUFLLFdBQVc7Z0JBQ2QsT0FBTyxvQkFBVSxDQUFDLFNBQVMsQ0FBQztZQUM5QixLQUFLLFNBQVM7Z0JBQ1osT0FBTyxvQkFBVSxDQUFDLE9BQU8sQ0FBQztZQUM1QixLQUFLLE9BQU87Z0JBQ1YsT0FBTyxvQkFBVSxDQUFDLEtBQUssQ0FBQztZQUMxQjtnQkFDRSxPQUFPLG9CQUFVLENBQUMsS0FBSyxDQUFDO1FBQzVCLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUF2SEQsOENBdUhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInO1xuaW1wb3J0IHsgTWV0cmljcywgTWV0cmljVW5pdCB9IGZyb20gJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5QmFja2VuZCwgT2JzZXJ2YWJpbGl0eUV2ZW50LCBPYnNlcnZhYmlsaXR5TGV2ZWwgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBsZXZlbFRvUG93ZXJ0b29sc0xvZ0xldmVsIH0gZnJvbSAnLi4vdXRpbHMvbGV2ZWwtdXRpbHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIENsb3VkV2F0Y2hCYWNrZW5kT3B0aW9ucyB7XG4gIHNlcnZpY2VOYW1lPzogc3RyaW5nO1xuICBtaW5MZXZlbD86IE9ic2VydmFiaWxpdHlMZXZlbDtcbiAgbmFtZXNwYWNlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQ2xvdWRXYXRjaEJhY2tlbmQgaW1wbGVtZW50cyBPYnNlcnZhYmlsaXR5QmFja2VuZCB7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lID0gJ2Nsb3Vkd2F0Y2gnO1xuICBwdWJsaWMgcmVhZG9ubHkgbWluTGV2ZWw/OiBPYnNlcnZhYmlsaXR5TGV2ZWw7XG4gIFxuICBwcml2YXRlIGxvZ2dlcjogTG9nZ2VyO1xuICBwcml2YXRlIG1ldHJpY3M6IE1ldHJpY3M7XG4gIFxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBDbG91ZFdhdGNoQmFja2VuZE9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMubWluTGV2ZWwgPSBvcHRpb25zLm1pbkxldmVsO1xuICAgIFxuICAgIHRoaXMubG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgICBzZXJ2aWNlTmFtZTogb3B0aW9ucy5zZXJ2aWNlTmFtZSB8fCBwcm9jZXNzLmVudi5TRVJWSUNFX05BTUUgfHwgJ2Z3MjQtc2VydmljZScsXG4gICAgICBsb2dMZXZlbDogbGV2ZWxUb1Bvd2VydG9vbHNMb2dMZXZlbChvcHRpb25zLm1pbkxldmVsKSxcbiAgICB9KTtcbiAgICBcbiAgICB0aGlzLm1ldHJpY3MgPSBuZXcgTWV0cmljcyh7XG4gICAgICBuYW1lc3BhY2U6IG9wdGlvbnMubmFtZXNwYWNlIHx8IHByb2Nlc3MuZW52LkNMT1VEV0FUQ0hfTUVUUklDU19OQU1FU1BBQ0UgfHwgJ0ZXMjQnLFxuICAgICAgc2VydmljZU5hbWU6IG9wdGlvbnMuc2VydmljZU5hbWUgfHwgcHJvY2Vzcy5lbnYuU0VSVklDRV9OQU1FIHx8ICdmdzI0LXNlcnZpY2UnLFxuICAgIH0pO1xuICB9XG4gIFxuICBhc3luYyBjYXB0dXJlKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBSb3V0ZSBieSB0eXBlXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09ICdtZXRyaWMnKSB7XG4gICAgICB0aGlzLmhhbmRsZU1ldHJpYyhldmVudCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaGFuZGxlTG9nKGV2ZW50KTtcbiAgICB9XG4gIH1cbiAgXG4gIHByaXZhdGUgaGFuZGxlTG9nKGV2ZW50OiBPYnNlcnZhYmlsaXR5RXZlbnQpOiB2b2lkIHtcbiAgICBjb25zdCBjb250ZXh0ID0ge1xuICAgICAgdHlwZTogZXZlbnQudHlwZSxcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGV2ZW50LmNvcnJlbGF0aW9uSWQsXG4gICAgICBlbnRpdHlOYW1lOiBldmVudC5lbnRpdHlOYW1lLFxuICAgICAgZW50aXR5SWQ6IGV2ZW50LmVudGl0eUlkLFxuICAgICAgb3BlcmF0aW9uOiBldmVudC5vcGVyYXRpb24sXG4gICAgICAuLi4oZXZlbnQuZHVyYXRpb25NcyAmJiB7IGR1cmF0aW9uTXM6IGV2ZW50LmR1cmF0aW9uTXMgfSksXG4gICAgICAuLi4oZXZlbnQuc3VjY2VzcyAhPT0gdW5kZWZpbmVkICYmIHsgc3VjY2VzczogZXZlbnQuc3VjY2VzcyB9KSxcbiAgICAgIC4uLihldmVudC5hdHRyaWJ1dGVzICYmIHsgYXR0cmlidXRlczogZXZlbnQuYXR0cmlidXRlcyB9KSxcbiAgICAgIC4uLihldmVudC5kYXRhICYmIHsgZGF0YTogZXZlbnQuZGF0YSB9KSxcbiAgICB9O1xuICAgIFxuICAgIGNvbnN0IG1lc3NhZ2UgPSBldmVudC5kYXRhPy5tZXNzYWdlIHx8IGV2ZW50Lm9wZXJhdGlvbiB8fCBldmVudC50eXBlO1xuICAgIFxuICAgIC8vIExvZyBldmVyeXRoaW5nIGFzIHN0cnVjdHVyZWQgSlNPTlxuICAgIHN3aXRjaCAoZXZlbnQubGV2ZWwpIHtcbiAgICAgIGNhc2UgJ3RyYWNlJzpcbiAgICAgIGNhc2UgJ2RlYnVnJzpcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcobWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnaW5mbyc6XG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnd2Fybic6XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4obWVzc2FnZSwgY29udGV4dCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgY2FzZSAnY3JpdGljYWwnOlxuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihtZXNzYWdlLCBjb250ZXh0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgfVxuICBcbiAgcHJpdmF0ZSBoYW5kbGVNZXRyaWMoZXZlbnQ6IE9ic2VydmFiaWxpdHlFdmVudCk6IHZvaWQge1xuICAgIGlmICghZXZlbnQubWV0cmljcykgcmV0dXJuO1xuICAgIFxuICAgIC8vIEFkZCBkaW1lbnNpb25zIGZyb20gYXR0cmlidXRlc1xuICAgIGlmIChldmVudC5hdHRyaWJ1dGVzKSB7XG4gICAgICBPYmplY3QuZW50cmllcyhldmVudC5hdHRyaWJ1dGVzKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICB0aGlzLm1ldHJpY3MuYWRkRGltZW5zaW9uKGtleSwgdmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIG1ldHJpYyB1bml0XG4gICAgY29uc3QgdW5pdCA9IHRoaXMubWFwVW5pdChldmVudC5hdHRyaWJ1dGVzPy51bml0KTtcbiAgICBcbiAgICAvLyBFTUYgZm9ybWF0IC0gRlJFRSBDbG91ZFdhdGNoIE1ldHJpY3MhXG4gICAgT2JqZWN0LmVudHJpZXMoZXZlbnQubWV0cmljcykuZm9yRWFjaCgoW25hbWUsIHZhbHVlXSkgPT4ge1xuICAgICAgdGhpcy5tZXRyaWNzLmFkZE1ldHJpYyhuYW1lLCB1bml0LCB2YWx1ZSk7XG4gICAgfSk7XG4gIH1cbiAgXG4gIGFzeW5jIGZsdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubWV0cmljcy5wdWJsaXNoU3RvcmVkTWV0cmljcygpO1xuICB9XG4gIFxuICBpbml0aWFsaXplSW52b2NhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBQb3dlcnRvb2xzIGhhbmRsZXMgcGVyLWludm9jYXRpb24gc3RhdGUgYXV0b21hdGljYWxseVxuICB9XG4gIFxuICBwcml2YXRlIG1hcFVuaXQodW5pdD86IHN0cmluZykge1xuICAgIHN3aXRjaCAodW5pdD8udG9Mb3dlckNhc2UoKSkge1xuICAgICAgY2FzZSAnc2Vjb25kcyc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LlNlY29uZHM7XG4gICAgICBjYXNlICdtaWxsaXNlY29uZHMnOlxuICAgICAgICByZXR1cm4gTWV0cmljVW5pdC5NaWxsaXNlY29uZHM7XG4gICAgICBjYXNlICdtaWNyb3NlY29uZHMnOlxuICAgICAgICByZXR1cm4gTWV0cmljVW5pdC5NaWNyb3NlY29uZHM7XG4gICAgICBjYXNlICdieXRlcyc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkJ5dGVzO1xuICAgICAgY2FzZSAna2lsb2J5dGVzJzpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuS2lsb2J5dGVzO1xuICAgICAgY2FzZSAnbWVnYWJ5dGVzJzpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuTWVnYWJ5dGVzO1xuICAgICAgY2FzZSAnZ2lnYWJ5dGVzJzpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuR2lnYWJ5dGVzO1xuICAgICAgY2FzZSAncGVyY2VudCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LlBlcmNlbnQ7XG4gICAgICBjYXNlICdjb3VudCc6XG4gICAgICAgIHJldHVybiBNZXRyaWNVbml0LkNvdW50O1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIE1ldHJpY1VuaXQuQ291bnQ7XG4gICAgfVxuICB9XG59XG5cbiJdfQ==