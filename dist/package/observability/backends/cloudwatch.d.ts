import { ObservabilityBackend, ObservabilityEvent, ObservabilityLevel } from '../types';
export interface CloudWatchBackendOptions {
    serviceName?: string;
    minLevel?: ObservabilityLevel;
    namespace?: string;
}
export declare class CloudWatchBackend implements ObservabilityBackend {
    readonly name = "cloudwatch";
    readonly minLevel?: ObservabilityLevel;
    private logger;
    private metrics;
    constructor(options?: CloudWatchBackendOptions);
    capture(event: ObservabilityEvent): Promise<void>;
    private handleLog;
    private handleMetric;
    flush(): Promise<void>;
    initializeInvocation(): void;
    private mapUnit;
}
