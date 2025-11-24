import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
import { levelToPowertoolsLogLevel } from '../utils/level-utils';

export interface CloudWatchBackendOptions {
  serviceName?: string;
  minLevel?: ObservabilityLevel;
  namespace?: string;
}

export class CloudWatchBackend implements ObservabilityBackend {
  public readonly name = 'cloudwatch';
  public readonly minLevel?: ObservabilityLevel;
  
  private logger: Logger;
  private metrics: Metrics;
  
  constructor(options: CloudWatchBackendOptions = {}) {
    this.minLevel = options.minLevel;
    
    this.logger = new Logger({
      serviceName: options.serviceName || process.env.SERVICE_NAME || 'fw24-service',
      logLevel: levelToPowertoolsLogLevel(options.minLevel),
    });
    
    this.metrics = new Metrics({
      namespace: options.namespace || process.env.CLOUDWATCH_METRICS_NAMESPACE || 'FW24',
      serviceName: options.serviceName || process.env.SERVICE_NAME || 'fw24-service',
    });
  }
  
  async capture(event: ObservabilityEvent): Promise<void> {
    // Route by type
    if (event.type === 'metric') {
      this.handleMetric(event);
    } else {
      this.handleLog(event);
    }
  }
  
  private handleLog(event: ObservabilityEvent): void {
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
  
  private handleMetric(event: ObservabilityEvent): void {
    if (!event.metrics) return;
    
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
  
  async flush(): Promise<void> {
    this.metrics.publishStoredMetrics();
  }
  
  initializeInvocation(): void {
    // Powertools handles per-invocation state automatically
  }
  
  private mapUnit(unit?: string) {
    switch (unit?.toLowerCase()) {
      case 'seconds':
        return MetricUnit.Seconds;
      case 'milliseconds':
        return MetricUnit.Milliseconds;
      case 'microseconds':
        return MetricUnit.Microseconds;
      case 'bytes':
        return MetricUnit.Bytes;
      case 'kilobytes':
        return MetricUnit.Kilobytes;
      case 'megabytes':
        return MetricUnit.Megabytes;
      case 'gigabytes':
        return MetricUnit.Gigabytes;
      case 'percent':
        return MetricUnit.Percent;
      case 'count':
        return MetricUnit.Count;
      default:
        return MetricUnit.Count;
    }
  }
}

