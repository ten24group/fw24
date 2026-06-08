/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * All config and backends resolved from DI - no manual instantiation.
 */
import { CaptureInput, ObservabilityBackend, ObservabilityConfig, ObservabilityEvent } from './types';
import type { ObservabilitySummary } from '../core/runtime/execution-context/types';
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
    /**
     * Get observability summary for the current invocation.
     * Returns buffer stats: evicted, buffered, captured, sampledOut counts.
     * Returns undefined if no execution context exists.
     */
    static getSummary(): ObservabilitySummary | undefined;
    static configure(updates: Partial<ObservabilityConfig>): void;
    static registerBackend(backend: ObservabilityBackend): void;
    static unregisterBackend(name: string): void;
    /**
     * Register a pre-initialization hook.
     * Hooks run BEFORE backends are initialized, allowing schema/service registration
     * needed by backends without circular dependencies.
     *
     * @param hook - Callback to execute during initialization
     */
    static registerPreInitHook(hook: () => void): void;
    /**
     * Capture an observability event (fire-and-forget)
     *
     * Capture control is embedded in input.capture - no separate options param.
     *
     * @param input - Event input with capture control in input.capture
     * @returns observabilityLogId if captured, undefined if filtered/sampled out
     */
    static capture(input: CaptureInput): string | undefined;
    /**
     * Capture an observability event asynchronously (waits for backend capture)
     *
     * @param input - Event input with capture control in input.capture
     * @returns Promise<observabilityLogId> if captured, undefined if filtered/sampled out
     */
    static captureAsync(input: CaptureInput): Promise<string | undefined>;
    /**
     * Observe an event (convenience method)
     *
     * @param event - Partial event with required type and level
     * @returns observabilityLogId if captured, undefined if filtered/sampled out
     */
    static observe(event: Partial<ObservabilityEvent> & {
        type: string;
        level: string;
        correlationId?: string;
    }): string | undefined;
    /**
     * Flush all backends and buffered events (called at end of Lambda invocation)
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
