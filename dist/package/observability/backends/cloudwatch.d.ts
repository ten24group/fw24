/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda:
 * - Logger for structured JSON logging
 * - Metrics for EMF (Embedded Metric Format) metrics
 *
 * All config injected via DI - no fallbacks.
 */
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel, CloudWatchConfig } from '../types';
export declare class CloudWatchBackend implements ObservabilityBackend {
    readonly name = "cloudwatch";
    readonly minLevel?: ObservabilityLevel;
    private logger;
    private metrics;
    private hasAnyMetrics;
    private readonly config;
    private readonly serviceName;
    private readonly metricsCache;
    constructor(serviceName: string, minLevel: ObservabilityLevel, config: CloudWatchConfig);
    capture(event: ObservabilityEvent): Promise<void>;
    /**
     * Get the Metrics instance for the given event based on namespace strategy.
     * Creates and caches Metrics instances for different namespaces.
     */
    private getMetricsForEvent;
    private handleLog;
    private extractMessage;
    private logAtLevel;
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
    private buildDimensions;
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
    private handleMetricsBatch;
    /**
     * Get span-specific dimensions (operation, source, success)
     */
    private getSpanDimensions;
    /**
     * Determine the correct unit for a metric.
     * Allows per-metric unit override via naming conventions.
     */
    private getMetricUnit;
    /**
     * Publish span duration as a CloudWatch metric.
     * Allows creating dashboards/alarms on operation durations.
     * Uses buildDimensions() to ensure proper deduplication with event.tags.
     */
    private publishSpanDurationMetric;
    flush(): Promise<void>;
    initializeInvocation(): void;
    private mapUnit;
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
    private shouldPublishMetrics;
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
    private shouldPublishMetric;
    /**
     * Check if operation matches a pattern (string or RegExp).
     */
    private matchesOperationPattern;
    /**
     * Evaluate a metric against filtering rules (whitelist/blacklist/patterns).
     */
    private evaluateMetricRule;
    /**
     * Check if a string matches any of the glob patterns.
     * Supports exact matches and simple glob patterns (*, ?).
     */
    private matchesPatterns;
}
