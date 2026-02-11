/**
 * CloudWatch Backend for Observability
 *
 * Uses AWS Powertools for Lambda Logger for structured JSON logging.
 * Metrics publishing via EMF is kept simple - one namespace, no complex sampling/filtering.
 *
 * For advanced metrics, use the OTEL backend which routes metrics through ADOT.
 */
import type { ObservabilityBackend, ObservabilityEvent, CloudWatchConfig } from '../types';
import { ObservabilityLevel } from '../types';
export declare class CloudWatchBackend implements ObservabilityBackend {
    readonly name = "cloudwatch";
    readonly minLevel?: ObservabilityLevel;
    private readonly logger;
    private readonly metrics;
    private hasAnyMetrics;
    constructor(serviceName: string, minLevel: ObservabilityLevel, config: CloudWatchConfig);
    capture(event: ObservabilityEvent): Promise<void>;
    private logEvent;
    private extractMessage;
    private logAtLevel;
    /**
     * Extract the category prefix from source (e.g., 'controller' from 'controller:OrderController.create').
     * Keeps CloudWatch dimension cardinality bounded to ~5 values (controller, service, queue, task, function).
     */
    private getSourceCategory;
    private publishMetrics;
    private publishSpanDuration;
    private inferUnit;
    flush(): Promise<void>;
    initializeInvocation(): void;
}
