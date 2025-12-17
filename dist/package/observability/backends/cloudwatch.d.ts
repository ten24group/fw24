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
    constructor(serviceName: string, namespace: string, minLevel: ObservabilityLevel);
    capture(event: ObservabilityEvent): Promise<void>;
    private handleLog;
    private extractMessage;
    private logAtLevel;
    private handleMetric;
    /**
     * Publish span duration as a CloudWatch metric
     * Allows creating dashboards/alarms on operation durations
     */
    private publishSpanDurationMetric;
    flush(): Promise<void>;
    initializeInvocation(): void;
    private mapUnit;
}
