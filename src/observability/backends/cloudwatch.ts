/**
 * CloudWatch Backend for Observability
 * 
 * Uses AWS Powertools for Lambda:
 * - Logger for structured JSON logging
 * - Metrics for EMF (Embedded Metric Format) metrics
 * 
 * All config injected via DI - no fallbacks.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Injectable, InjectConfig } from '../../di';
import { createLogger } from '../../logging';
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, ObservabilityLevelString } from '../types';
import { levelToPowertoolsLogLevel } from '../utils/level-utils';

const internalLogger = createLogger('CloudWatchBackend');

// CloudWatch limits
const MAX_DIMENSIONS = 10;
const MAX_DIMENSION_NAME_LENGTH = 256;
const MAX_DIMENSION_VALUE_LENGTH = 1024;

@Injectable({
  provide: 'ObservabilityBackend',
  providedIn: 'ROOT',
  tags: [ 'observability', 'backend', 'cloudwatch' ]
})
export class CloudWatchBackend implements ObservabilityBackend {
  public readonly name = 'cloudwatch';
  public readonly minLevel?: ObservabilityLevel;

  private logger: Logger;
  private metrics: Metrics;

  constructor(
    @InjectConfig('observability.serviceName') serviceName: string,
    @InjectConfig('observability.cloudwatch.namespace') namespace: string,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel
  ) {
    this.minLevel = minLevel;

    this.logger = new Logger({
      serviceName: serviceName,
      logLevel: levelToPowertoolsLogLevel(minLevel),
    });

    this.metrics = new Metrics({
      namespace: namespace,
      serviceName: serviceName,
    });
  }

  async capture(event: ObservabilityEvent): Promise<void> {
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
    } catch (error) {
      internalLogger.error('CloudWatch capture failed:', error);
    }
  }

  private handleLog(event: ObservabilityEvent): void {
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
    if (event.relatedTraces) context.relatedTraces = event.relatedTraces;
    if (event.source) context.source = event.source;
    if (event.tags) context.tags = event.tags;
    if (event.attributes) context.attributes = event.attributes;
    if (event.data) context.data = event.data;
    if (event.error) context.error = event.error;
    if (event.actor) {
      const actor = event.actor;
      if (actor.actorId) context.actorId = actor.actorId;
      if (actor.actorType) context.actorType = actor.actorType;
      if (actor.tenantId) context.tenantId = actor.tenantId;
      if (actor.sessionId) context.sessionId = actor.sessionId;
      if (actor.email) context.actorEmail = actor.email;
      if (actor.sourceIp) context.sourceIp = actor.sourceIp;
      if (actor.userAgent) context.userAgent = actor.userAgent;
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

  private handleMetric(event: ObservabilityEvent): void {
    if (!event.metrics || Object.keys(event.metrics).length === 0) return;

    // Use a Map to deduplicate dimensions by name (first occurrence wins)
    const dimensionMap = new Map<string, string>();

    // Priority 1: Add common dimensions from tags (tenant, entity, operation, etc.)
    if (event.tags) {
      for (const [ key, value ] of Object.entries(event.tags)) {
        if (dimensionMap.size >= MAX_DIMENSIONS) break;
        if (typeof value === 'string' && !dimensionMap.has(key)) {
          dimensionMap.set(
            key.slice(0, MAX_DIMENSION_NAME_LENGTH),
            value.slice(0, MAX_DIMENSION_VALUE_LENGTH)
          );
        }
      }
    }

    // Priority 2: Add dimensions from attributes (only if not already present)
    if (event.attributes) {
      for (const [ key, value ] of Object.entries(event.attributes)) {
        if (dimensionMap.size >= MAX_DIMENSIONS) {
          internalLogger.warn(`Dimension limit reached (${MAX_DIMENSIONS}), skipping remaining attributes`);
          break;
        }

        if (typeof value !== 'string') continue;

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
    const dimensions = Array.from(dimensionMap.entries()).map(([ name, value ]) => ({ name, value }));

    const unit = this.mapUnit(event.attributes?.unit as string | undefined);

    for (const [ name, value ] of Object.entries(event.metrics)) {
      try {
        const singleMetric = this.metrics.singleMetric();

        for (const dim of dimensions) {
          singleMetric.addDimension(dim.name, dim.value);
        }

        singleMetric.addMetric(name, unit, value);
      } catch (error) {
        internalLogger.warn(`Failed to add metric ${name}:`, error);
      }
    }
  }

  /**
   * Publish span duration as a CloudWatch metric
   * Allows creating dashboards/alarms on operation durations
   */
  private publishSpanDurationMetric(event: ObservabilityEvent): void {
    if (!event.durationMs || !event.operation) return;

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

      singleMetric.addMetric('span.duration', MetricUnit.Milliseconds, event.durationMs);
    } catch (error) {
      internalLogger.warn('Failed to publish span duration metric:', error);
    }
  }

  async flush(): Promise<void> {
    try {
      this.metrics.publishStoredMetrics();
    } catch (error) {
      internalLogger.error('Failed to publish metrics:', error);
    }
  }

  initializeInvocation(): void {
    // Powertools handles per-invocation state automatically
  }

  private mapUnit(unit?: string): (typeof MetricUnit)[ keyof typeof MetricUnit ] {
    if (!unit) return MetricUnit.Count;

    const normalized = unit.toLowerCase();

    switch (normalized) {
      case 'seconds': return MetricUnit.Seconds;
      case 'milliseconds': return MetricUnit.Milliseconds;
      case 'microseconds': return MetricUnit.Microseconds;
      case 'bytes': return MetricUnit.Bytes;
      case 'kilobytes': return MetricUnit.Kilobytes;
      case 'megabytes': return MetricUnit.Megabytes;
      case 'gigabytes': return MetricUnit.Gigabytes;
      case 'percent': return MetricUnit.Percent;
      case 'bits': return MetricUnit.Bits;
      case 'bits/second': return MetricUnit.BitsPerSecond;
      case 'bytes/second': return MetricUnit.BytesPerSecond;
      case 'kilobits/second': return MetricUnit.KilobitsPerSecond;
      case 'kilobytes/second': return MetricUnit.KilobytesPerSecond;
      case 'megabits/second': return MetricUnit.MegabitsPerSecond;
      case 'megabytes/second': return MetricUnit.MegabytesPerSecond;
      case 'gigabits/second': return MetricUnit.GigabitsPerSecond;
      case 'gigabytes/second': return MetricUnit.GigabytesPerSecond;
      case 'terabits/second': return MetricUnit.TerabitsPerSecond;
      case 'terabytes/second': return MetricUnit.TerabytesPerSecond;
      case 'count/second': return MetricUnit.CountPerSecond;
      default: return MetricUnit.Count;
    }
  }
}
