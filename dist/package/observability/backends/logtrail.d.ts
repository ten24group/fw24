/**
 * Ships observability events to Logtrail’s Vector HTTP source (same contract as tslog logging).
 */
import type { ObservabilityBackend, ObservabilityBackendConfig, ObservabilityEvent } from '../types';
import { ObservabilityLevel } from '../types';
export declare class LogtrailObservabilityBackend implements ObservabilityBackend {
    readonly name: "logtrail";
    readonly minLevel?: ObservabilityLevel;
    private serviceLabelOverride;
    constructor(minLevel: ObservabilityLevel);
    configureFromBackendEntry(entry: ObservabilityBackendConfig): void;
    capture(event: ObservabilityEvent): Promise<void>;
}
