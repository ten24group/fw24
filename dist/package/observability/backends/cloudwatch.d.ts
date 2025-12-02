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
import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
export interface CloudWatchBackendOptions {
    serviceName: string;
    namespace: string;
    minLevel?: ObservabilityLevel;
}
export declare class CloudWatchBackend implements ObservabilityBackend {
    readonly name = "cloudwatch";
    readonly minLevel?: ObservabilityLevel;
    private logger;
    private metrics;
    constructor(options: CloudWatchBackendOptions);
    capture(event: ObservabilityEvent): Promise<void>;
    private handleLog;
    /**
     * Safely extract message from event (avoid unsafe casts)
     */
    private extractMessage;
    private logAtLevel;
    private handleMetric;
    flush(): Promise<void>;
    initializeInvocation(): void;
    private mapUnit;
}
