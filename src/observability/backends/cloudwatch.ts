/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda Logger for structured JSON logging.
 * Metrics publishing via EMF is kept simple - one namespace, no complex sampling/filtering.
 *
 * For advanced metrics, use the OTEL backend which routes metrics through ADOT.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Injectable, InjectConfig } from '../../di';
import { createLogger } from '../../logging';
import type {
  ObservabilityBackend,
  ObservabilityEvent,
  ObservabilityLevelString,
  CloudWatchConfig,
} from '../types';
import { ObservabilityLevel } from '../types';
import { levelToPowertoolsLogLevel } from '../utils/level-utils';

const internalLogger = createLogger('CloudWatchBackend');

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: ['observability', 'backend', 'cloudwatch']
})
export class CloudWatchBackend implements ObservabilityBackend {
  public readonly name = 'cloudwatch';
  public readonly minLevel?: ObservabilityLevel;

  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private hasAnyMetrics = false;

  constructor(
    @InjectConfig('observability.serviceName') serviceName: string,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel,
    @InjectConfig('observability.cloudwatch') config: CloudWatchConfig
  ) {
    this.minLevel = minLevel;

    this.logger = new Logger({
      serviceName,
      logLevel: levelToPowertoolsLogLevel(minLevel),
    });

    this.metrics = new Metrics({
      namespace: config.namespace,
      serviceName,
    });
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    try {
      // Publish metrics if present
      if (event.metrics && Object.keys(event.metrics).length > 0) {
        this.publishMetrics(event);
      } else if (event.type === 'span' && event.durationMs !== undefined) {
        // Publish span duration as a metric
        this.publishSpanDuration(event);
      }

      // Log the event (skip pure metric events)
      if (event.type !== 'metric') {
        this.logEvent(event);
      }
    } catch (error) {
      internalLogger.error('CloudWatch capture failed:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Structured Logging
  // ═══════════════════════════════════════════════════════════════════════════

  private logEvent(event: ObservabilityEvent): void {
    const context: Record<string, unknown> = {
      type: event.type,
      correlationId: event.correlationId,
      observabilityLogId: event.observabilityLogId,
    };

    if (event.entityName) context.entityName = event.entityName;
    if (event.entityId) context.entityId = event.entityId;
    if (event.operation) context.operation = event.operation;
    if (event.durationMs !== undefined) context.durationMs = event.durationMs;
    if (event.success !== undefined) context.success = event.success;
    if (event.status) context.status = event.status;
    if (event.parentObservabilityLogId) context.parentObservabilityLogId = event.parentObservabilityLogId;
    if (event.causedBy) context.causedBy = event.causedBy;
    if (event.source) context.source = event.source;
    if (event.tags) context.tags = event.tags;
    if (event.data) context.data = event.data;
    if (event.error) context.error = event.error;
    // absorbed data is inside event.data — no separate handling needed

    if (event.actor) {
      const { actorId, actorType, tenantId, sessionId, email, sourceIp, userAgent } = event.actor;
      if (actorId) context.actorId = actorId;
      if (actorType) context.actorType = actorType;
      if (tenantId) context.tenantId = tenantId;
      if (sessionId) context.sessionId = sessionId;
      if (email) context.actorEmail = email;
      if (sourceIp) context.sourceIp = sourceIp;
      if (userAgent) context.userAgent = userAgent;
    }

    const message = this.extractMessage(event);
    this.logAtLevel(event.level, message, context);
  }

  private extractMessage(event: ObservabilityEvent): string {
    if (event.data && typeof event.data.message === 'string') {
      return event.data.message;
    }
    return event.operation || event.type;
  }

  private logAtLevel(level: ObservabilityLevelString, message: string, context: Record<string, unknown>): void {
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
  private getSourceCategory(source: string): string {
    const colonIndex = source.indexOf(':');
    return colonIndex > 0 ? source.substring(0, colonIndex) : source;
  }

  private publishMetrics(event: ObservabilityEvent): void {
    if (!event.metrics) return;

    try {
      const singleMetric = this.metrics.singleMetric();

      // Add basic dimensions (source is normalized to category to prevent high-cardinality billing trap)
      if (event.operation) singleMetric.addDimension('operation', event.operation);
      if (event.source) singleMetric.addDimension('source', this.getSourceCategory(event.source));
      if (event.success !== undefined) singleMetric.addDimension('success', String(event.success));

      for (const [name, value] of Object.entries(event.metrics)) {
        const unit = this.inferUnit(name);
        singleMetric.addMetric(name, unit, value);
      }

      this.hasAnyMetrics = true;
    } catch (error) {
      internalLogger.warn('Failed to publish metrics:', error);
    }
  }

  private publishSpanDuration(event: ObservabilityEvent): void {
    if (event.durationMs === undefined) return;

    try {
      const singleMetric = this.metrics.singleMetric();

      if (event.operation) singleMetric.addDimension('operation', event.operation);
      if (event.source) singleMetric.addDimension('source', this.getSourceCategory(event.source));
      if (event.success !== undefined) singleMetric.addDimension('success', String(event.success));

      singleMetric.addMetric('duration', MetricUnit.Milliseconds, event.durationMs);
      this.hasAnyMetrics = true;
    } catch (error) {
      internalLogger.warn('Failed to publish span duration metric:', error);
    }
  }

  private inferUnit(metricName: string): typeof MetricUnit[keyof typeof MetricUnit] {
    if (metricName.includes('duration') || metricName.includes('latency') || metricName.endsWith('Ms')) {
      return MetricUnit.Milliseconds;
    }
    if (metricName.includes('bytes') || metricName.includes('size') || metricName.endsWith('Bytes')) {
      return MetricUnit.Bytes;
    }
    if (metricName.includes('percent') || metricName.includes('rate')) {
      return MetricUnit.Percent;
    }
    return MetricUnit.Count;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  async flush(): Promise<void> {
    try {
      if (this.hasAnyMetrics) {
        this.metrics.publishStoredMetrics();
        this.hasAnyMetrics = false;
      }
    } catch (error) {
      internalLogger.error('Failed to publish metrics:', error);
    }
  }

  initializeInvocation(): void {
    this.hasAnyMetrics = false;
  }
}
