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
import {
  ObservabilityBackend,
  ObservabilityEvent,
  ObservabilityLevel,
  ObservabilityLevelString,
  CloudWatchConfig,
} from '../types';
import { levelToPowertoolsLogLevel } from '../utils/level-utils';

const internalLogger = createLogger('CloudWatchBackend');

// CloudWatch limits
const MAX_DIMENSIONS = 30;  // CloudWatch hard limit (practical limit: 10)
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
  private hasAnyMetrics = false;
  private readonly config: CloudWatchConfig;
  private readonly serviceName: string;
  private readonly metricsCache = new Map<string, Metrics>();

  constructor(
    @InjectConfig('observability.serviceName') serviceName: string,
    @InjectConfig('observability.minLevel') minLevel: ObservabilityLevel,
    @InjectConfig('observability.cloudwatch') config: CloudWatchConfig
  ) {
    this.minLevel = minLevel;
    this.config = config;
    this.serviceName = serviceName;

    this.logger = new Logger({
      serviceName: serviceName,
      logLevel: levelToPowertoolsLogLevel(minLevel),

    });

    // Default metrics instance (for single namespace strategy or fallback)
    this.metrics = new Metrics({
      namespace: config.namespace,
      serviceName: serviceName,
    });
  }

  async capture(event: ObservabilityEvent): Promise<void> {
    try {
      // Batch ALL metrics (event.metrics + span duration) into a SINGLE EMF log
      const hasEventMetrics = event.metrics && Object.keys(event.metrics).length > 0;
      const hasSpanDuration = event.type === 'span' && event.durationMs !== undefined && !event.metrics?.duration;

      if (hasEventMetrics || hasSpanDuration) {
        // Phase 2: Apply metric sampling (check if we should publish metrics for this event)
        const shouldPublishMetrics = this.shouldPublishMetrics(event);

        if (shouldPublishMetrics) {
          this.hasAnyMetrics = true;
          // Combine both into one batched metric call with correct namespace
          this.handleMetricsBatch(event, hasSpanDuration);
        }
      }

      // Log the event (unless it's a pure metric event with no other data)
      if (event.type !== 'metric') {
        this.handleLog(event);
      }
    } catch (error) {
      internalLogger.error('CloudWatch capture failed:', error);
    }
  }

  /**
   * Get the Metrics instance for the given event based on namespace strategy.
   * Creates and caches Metrics instances for different namespaces.
   */
  private getMetricsForEvent(event: ObservabilityEvent): Metrics {
    const strategy = this.config.namespaceStrategy || 'single';

    // Single namespace (default): use default metrics instance
    if (strategy === 'single') {
      return this.metrics;
    }

    // Determine namespace
    let namespace: string;

    if (typeof strategy === 'function') {
      // Custom function
      try {
        namespace = strategy(event);
      } catch (error) {
        internalLogger.warn('Custom namespace strategy failed, using default:', error);
        namespace = this.config.namespace;
      }
    } else if (strategy === 'per-type') {
      // Per handler type: 'FW24/API', 'FW24/Queue', 'FW24/Task'
      const handlerType = event.tags?.handlerType || event.tags?.handler_type || 'Other';
      const suffix = handlerType.charAt(0).toUpperCase() + handlerType.slice(1);
      namespace = `${this.config.namespace}/${suffix}`;
    } else if (strategy === 'per-source') {
      // Per source: 'FW24/UserController', 'FW24/OrderService'
      if (event.source) {
        // Extract clean source name (remove 'controller:', 'service:', 'queue:' prefixes)
        const cleanSource = event.source.replace(/^(controller|service|queue|task):/, '');
        namespace = `${this.config.namespace}/${cleanSource}`;
      } else {
        namespace = this.config.namespace;
      }
    } else {
      namespace = this.config.namespace;
    }

    // Check cache
    if (this.metricsCache.has(namespace)) {
      return this.metricsCache.get(namespace)!;
    }

    // Create new Metrics instance for this namespace
    const metricsInstance = new Metrics({
      namespace,
      serviceName: this.serviceName,
    });

    this.metricsCache.set(namespace, metricsInstance);
    return metricsInstance;
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

  /**
   * Build deduplicated dimensions from event data.
   * 
   * PHASE 2: Applies automatic tags filtering to reduce dimension cardinality.
   * 
   * Priority order (first occurrence wins):
   * 1. Tags (highest priority - user-specified) - FILTERED BY CONFIG
   * 2. Explicit dimension overrides (passed as parameter) - FILTERED BY CONFIG
   * 3. Attributes (if string values)
   * 4. Entity context (entityName) - FILTERED BY CONFIG
   * 5. Custom tags from config
   * 
   * @param event - Observability event
   * @param explicitDimensions - Explicit dimensions to add (e.g., operation, source, success)
   * @returns Deduplicated dimension map
   */
  private buildDimensions(
    event: ObservabilityEvent,
    explicitDimensions?: Record<string, string>
  ): Map<string, string> {
    const dimensionMap = new Map<string, string>();

    // Priority 1: Tags (already filtered by ObservabilityManager)
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

    // Priority 2: Explicit dimensions
    if (explicitDimensions) {
      for (const [ key, value ] of Object.entries(explicitDimensions)) {
        if (dimensionMap.size >= MAX_DIMENSIONS) break;

        if (!dimensionMap.has(key)) {
          dimensionMap.set(
            key.slice(0, MAX_DIMENSION_NAME_LENGTH),
            value.slice(0, MAX_DIMENSION_VALUE_LENGTH)
          );
        }
      }
    }

    // Priority 3: Attributes (string values only)
    if (event.attributes) {
      for (const [ key, value ] of Object.entries(event.attributes)) {
        if (dimensionMap.size >= MAX_DIMENSIONS) {
          internalLogger.debug(`Dimension limit reached (${MAX_DIMENSIONS}), skipping remaining attributes`);
          break;
        }

        if (typeof value !== 'string') continue;

        const dimName = key.slice(0, MAX_DIMENSION_NAME_LENGTH);
        const dimValue = value.slice(0, MAX_DIMENSION_VALUE_LENGTH);

        if (!dimensionMap.has(dimName)) {
          dimensionMap.set(dimName, dimValue);
        }
      }
    }

    // Priority 4: Entity context
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
   * PHASE 2: Also applies metric filtering to reduce published metrics
   * 
   * CloudWatch EMF supports up to 100 metrics per log entry, so batching
   * is almost always better than individual metric emission.
   * 
   * @param event - The observability event containing metrics
   * @param includeSpanDuration - Whether to include span duration in the batch
   */
  /**
   * Batch ALL metrics from a single event into ONE EMF log entry.
   * 
   * OPTIMIZATION: Combines event.metrics + span duration into a SINGLE EMF log
   * BEFORE (inefficient): 5 event metrics + 1 span duration = 2 separate EMF logs
   * AFTER (optimized): 5 event metrics + 1 span duration = 1 EMF log = 50% cost reduction
   * 
   * PHASE 2: Also applies metric filtering to reduce published metrics
   * PHASE 3: Applies operation-specific metric rules and dynamic namespace strategy
   * 
   * CloudWatch EMF supports up to 100 metrics per log entry, so batching
   * is almost always better than individual metric emission.
   * 
   * @param event - The observability event containing metrics
   * @param includeSpanDuration - Whether to include span duration in the batch
   */
  private handleMetricsBatch(event: ObservabilityEvent, includeSpanDuration: boolean = false): void {
    const dimensionMap = this.buildDimensions(event, this.getSpanDimensions(event));
    const dimensions = Array.from(dimensionMap.entries()).map(([ name, value ]) => ({ name, value }));

    try {
      // Phase 3: Get correct Metrics instance based on namespace strategy
      const metricsInstance = this.getMetricsForEvent(event);

      // Create ONE metrics batch for ALL metrics (event metrics + span duration)
      const metricsBatch = metricsInstance.singleMetric();

      // Add dimensions once (shared by all metrics)
      for (const dim of dimensions) {
        metricsBatch.addDimension(dim.name, dim.value);
      }

      let metricsAdded = 0;

      // Phase 2 & 3: Add event metrics with filtering (operation-specific or global)
      if (event.metrics && Object.keys(event.metrics).length > 0) {
        for (const [ name, value ] of Object.entries(event.metrics)) {
          // Phase 3: Check if this metric should be published (operation-specific or global)
          if (!this.shouldPublishMetric(name, event)) {
            continue;
          }

          const unit = this.getMetricUnit(name, event.attributes?.unit as string | undefined);
          metricsBatch.addMetric(name, unit, value);
          metricsAdded++;
        }
      }

      // Phase 2 & 3: Add span duration with filtering
      if (includeSpanDuration && event.durationMs !== undefined) {
        // Check if 'duration' metric should be published
        if (this.shouldPublishMetric('duration', event)) {
          metricsBatch.addMetric('duration', MetricUnit.Milliseconds, event.durationMs);
          metricsAdded++;
        }
      }

      // Only publish if we have metrics to publish (after filtering)
      if (metricsAdded === 0) {
        internalLogger.debug('No metrics to publish after filtering');
      }

      // EMF will publish ONE log entry with ALL metrics (massive cost savings!)
    } catch (error) {
      internalLogger.warn('Failed to publish metrics batch:', error);
    }
  }

  /**
   * Get span-specific dimensions (operation, source, success)
   */
  private getSpanDimensions(event: ObservabilityEvent): Record<string, string> | undefined {
    if (event.type !== 'span') return undefined;

    const dimensions: Record<string, string> = {};
    if (event.operation) dimensions.operation = event.operation;
    if (event.source) dimensions.source = event.source;
    if (event.success !== undefined) dimensions.success = String(event.success);

    return Object.keys(dimensions).length > 0 ? dimensions : undefined;
  }

  /**
   * Determine the correct unit for a metric.
   * Allows per-metric unit override via naming conventions.
   */
  private getMetricUnit(metricName: string, defaultUnit?: string): typeof MetricUnit[ keyof typeof MetricUnit ] {
    // Per-metric unit detection based on name patterns
    if (metricName.includes('duration') || metricName.includes('latency') || metricName.endsWith('Ms')) {
      return MetricUnit.Milliseconds;
    }
    if (metricName.includes('count') || metricName.includes('total') || metricName.endsWith('Count')) {
      return MetricUnit.Count;
    }
    if (metricName.includes('bytes') || metricName.includes('size') || metricName.endsWith('Bytes')) {
      return MetricUnit.Bytes;
    }
    if (metricName.includes('percent') || metricName.includes('rate')) {
      return MetricUnit.Percent;
    }

    // Fall back to default unit or Count
    return this.mapUnit(defaultUnit);
  }

  /**
   * Publish span duration as a CloudWatch metric.
   * Allows creating dashboards/alarms on operation durations.
   * Uses buildDimensions() to ensure proper deduplication with event.tags.
   */
  private publishSpanDurationMetric(event: ObservabilityEvent): void {
    if (!event.durationMs || !event.operation) return;

    try {
      // Build explicit dimensions for span metrics
      const explicitDimensions: Record<string, string> = {};

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

      for (const [ name, value ] of dimensionMap.entries()) {
        singleMetric.addDimension(name, value);
      }

      singleMetric.addMetric('span.duration', MetricUnit.Milliseconds, event.durationMs);
    } catch (error) {
      internalLogger.warn('Failed to publish span duration metric:', error);
    }
  }

  async flush(): Promise<void> {
    try {
      // Avoid noisy powertools warning when no metrics were recorded.
      if (!this.hasAnyMetrics) {
        return;
      }

      // Phase 3: Publish metrics from all namespace instances
      // Default namespace
      this.metrics.publishStoredMetrics();

      // Cached namespaces (if any)
      for (const metricsInstance of this.metricsCache.values()) {
        metricsInstance.publishStoredMetrics();
      }

      this.hasAnyMetrics = false;
    } catch (error) {
      internalLogger.error('Failed to publish metrics:', error);
    }
  }

  initializeInvocation(): void {
    // Powertools handles per-invocation state automatically
    this.hasAnyMetrics = false;
    // Note: We DON'T clear metricsCache - it's safe to reuse across invocations
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Cost Optimization Logic
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Phase 2 Optimization: Metric Sampling
   * 
   * Determines if metrics should be published for this event based on sampling config.
   * 
   * Strategy:
   * - Always publish: errors, slow operations (critical signals)
   * - Sample: fast, successful operations (routine traffic)
   * - Never sample: configured operations (e.g., payments, critical paths)
   */
  private shouldPublishMetrics(event: ObservabilityEvent): boolean {
    const config = this.config.metricSampling;

    // If sampling disabled, always publish
    if (!config || !config.enabled) {
      return true;
    }

    const operation = event.operation || '';

    // Check neverSample list (always publish)
    if (config.neverSample && this.matchesPatterns(operation, config.neverSample)) {
      return true;
    }

    // Check alwaysSample list (never publish unless error/slow)
    if (config.alwaysSample && this.matchesPatterns(operation, config.alwaysSample)) {
      // Continue to check if it's an error or slow operation
    }

    const alwaysPublishOn = config.alwaysPublishOn || 'both';

    // Always publish on error
    if ((event.success === false || event.error) &&
      (alwaysPublishOn === 'error' || alwaysPublishOn === 'both')) {
      return true;
    }

    // Always publish on slow operations
    const slowThreshold = config.thresholds?.slowDurationMs || 1000;
    if (event.durationMs !== undefined && event.durationMs >= slowThreshold &&
      (alwaysPublishOn === 'slow' || alwaysPublishOn === 'both')) {
      return true;
    }

    // Sample routine operations based on rate
    const sampleRate = config.rate || 0.1;
    return Math.random() < sampleRate;
  }

  /**
   * Phase 2 & 3 Optimization: Metric Filtering
   * 
   * Determines if a specific metric should be published based on filtering config.
   * 
   * Phase 3: Supports operation-specific rules (first match wins).
   * If no operation-specific rule matches, falls back to global rules.
   * 
   * @param metricName - The name of the metric to check
   * @param event - The observability event (for operation-specific rules)
   * @returns true if the metric should be published, false otherwise
   */
  private shouldPublishMetric(metricName: string, event: ObservabilityEvent): boolean {
    const config = this.config.metricFiltering;

    // If filtering disabled, always publish
    if (!config || !config.enabled) {
      return true;
    }

    // Phase 3: Check operation-specific rules first
    if (config.operationRules && config.operationRules.length > 0 && event.operation) {
      for (const rule of config.operationRules) {
        if (this.matchesOperationPattern(event.operation, rule.operation)) {
          // Matched operation-specific rule - evaluate it
          return this.evaluateMetricRule(metricName, rule);
        }
      }
    }

    // No operation-specific rule matched - use global rules
    return this.evaluateMetricRule(metricName, config);
  }

  /**
   * Check if operation matches a pattern (string or RegExp).
   */
  private matchesOperationPattern(operation: string, pattern: string | RegExp): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(operation);
    }

    // String pattern with wildcard support
    return this.matchesPatterns(operation, [ pattern ]);
  }

  /**
   * Evaluate a metric against filtering rules (whitelist/blacklist/patterns).
   */
  private evaluateMetricRule(
    metricName: string,
    rule: { whitelist?: string[]; blacklist?: string[]; patterns?: { include?: RegExp[]; exclude?: RegExp[] } }
  ): boolean {
    // Check patterns first (most flexible)
    if (rule.patterns) {
      const { include, exclude } = rule.patterns;

      // If include patterns exist, metric must match at least one
      if (include && include.length > 0) {
        const matchesInclude = include.some(pattern => pattern.test(metricName));
        if (!matchesInclude) return false;
      }

      // If exclude patterns exist, metric must not match any
      if (exclude && exclude.length > 0) {
        const matchesExclude = exclude.some(pattern => pattern.test(metricName));
        if (matchesExclude) return false;
      }

      return true;
    }

    // Check whitelist (ONLY these metrics)
    if (rule.whitelist !== undefined) {
      // Empty whitelist [] = no metrics allowed
      if (rule.whitelist.length === 0) {
        return false;
      }
      return this.matchesPatterns(metricName, rule.whitelist);
    }

    // Check blacklist (all EXCEPT these)
    if (rule.blacklist !== undefined) {
      // Empty blacklist [] = all metrics allowed
      if (rule.blacklist.length === 0) {
        return true;
      }
      return !this.matchesPatterns(metricName, rule.blacklist);
    }

    // No rules specified - publish
    return true;
  }

  /**
   * Check if a string matches any of the glob patterns.
   * Supports exact matches and simple glob patterns (*, ?).
   */
  private matchesPatterns(value: string, patterns: string[]): boolean {
    return patterns.some((pattern: string) => {
      // Exact match
      if (pattern === value) return true;

      // Convert glob to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')  // Escape dots
        .replace(/\*/g, '.*')    // * matches anything
        .replace(/\?/g, '.');    // ? matches single char

      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(value);
    });
  }

}
