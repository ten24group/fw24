/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * All config and backends resolved from DI - no manual instantiation.
 */
import { CaptureInput, CaptureOptions, ObservabilityBackend, ObservabilityConfig, ObservabilityEvent } from './types';
export declare class ObservabilityManager {
    private constructor();
    /**
     * Initialize for a new Lambda invocation
     */
    static initializeInvocation(): void;
    static isInitialized(): boolean;
    static isColdStart(): boolean;
    static getInvocationCount(): number;
    static getConfig(): ObservabilityConfig | null;
    static configure(updates: Partial<ObservabilityConfig>): void;
    static registerBackend(backend: ObservabilityBackend): void;
    static unregisterBackend(name: string): void;
    /**
     * Capture an observability event (fire-and-forget)
     */
    static capture(input: CaptureInput, options?: CaptureOptions): string | undefined;
    /**
     * Capture an observability event asynchronously
     */
    static captureAsync(input: CaptureInput, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined>;
    /**
     * Observe an event
     */
    static observe(event: Partial<ObservabilityEvent> & {
        type: string;
        level: string;
        correlationId?: string;
    }, options?: CaptureOptions): string | undefined;
    /**
     * Flush all backends
     */
    static flush(): Promise<void>;
    /**
     * Reset manager state (for testing)
     */
    static reset(): void;
    /**
     * Initialize for testing with mock config and backends
     */
    static initializeForTesting(testConfig: ObservabilityConfig, testBackends?: ObservabilityBackend[]): void;
}
/**
 * Lambda handler wrapper with observability lifecycle management
 */
export declare const withObservability: <T extends (...args: unknown[]) => Promise<unknown>>(handler: T) => T;
export declare const Observer: typeof ObservabilityManager;
