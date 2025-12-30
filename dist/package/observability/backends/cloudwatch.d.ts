/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda:
 * - Logger for structured JSON logging
 * - Metrics for EMF (Embedded Metric Format) metrics
 *
 * All config injected via DI - no fallbacks.
 */
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
export declare class CloudWatchBackend implements ObservabilityBackend {
    readonly name = "cloudwatch";
    readonly minLevel?: ObservabilityLevel;
    private logger;
    private metrics;
    private hasAnyMetrics;
    constructor(serviceName: string, namespace: string, minLevel: ObservabilityLevel);
    capture(event: ObservabilityEvent): Promise<void>;
    private handleLog;
    private extractMessage;
    private logAtLevel;
    /**
     * Build deduplicated dimensions from event data.
     * Priority order (first occurrence wins):
     * 1. Tags (highest priority - user-specified)
     * 2. Explicit dimension overrides (passed as parameter)
     * 3. Attributes (if string values)
     * 4. Entity context (entityName)
     *
     * @param event - Observability event
     * @param explicitDimensions - Explicit dimensions to add (e.g., operation, source, success)
     * @returns Deduplicated dimension map
     */
    private buildDimensions;
    private handleMetric;
    /**
     * Publish span duration as a CloudWatch metric.
     * Allows creating dashboards/alarms on operation durations.
     * Uses buildDimensions() to ensure proper deduplication with event.tags.
     */
    private publishSpanDurationMetric;
    flush(): Promise<void>;
    initializeInvocation(): void;
    private mapUnit;
}
