/**
 * ObservabilityManager - Core Observer for the observability system
 *
 * DESIGN PRINCIPLES:
 * - Required fields (correlationId, type, level) must be provided - no auto-generation
 * - Never crash the application - log errors and continue
 * - Synchronous initialization from environment
 * - Fire-and-forget capture for non-blocking operation
 *
 * Usage:
 * ```typescript
 * // REQUIRED: Establish context with correlationId first
 * await runWithContext(
 *   createObservationContext(requestId),
 *   async () => {
 *     // Then use observers
 *     SpanObserver.start('operation');
 *     AuditObserver.entityCreate('User', userId, data);
 *   }
 * );
 * ```
 */
import { Actor } from '../core/types/execution-context';
import { CaptureInput, CaptureOptions, ObservabilityBackend, ObservabilityConfig, ObservabilityEvent, ObservationContext } from './types';
/**
 * ObservabilityManager - core static class for the observability system.
 *
 * For testability, use the IEventCapture interface via base.ts setCapturer().
 * This class's static methods satisfy IEventCapture when wrapped.
 */
export declare class ObservabilityManager {
    private static configManager;
    private static backends;
    private static invocationCount;
    private static initialized;
    private static samplingRegexCache;
    /**
     * Initialize with explicit configuration
     */
    static initialize(config: Partial<ObservabilityConfig>, backends?: ObservabilityBackend[]): void;
    /**
     * Get current configuration
     * Initializes from environment if not already initialized
     */
    static getConfig(): ObservabilityConfig;
    /**
     * Update configuration at runtime
     */
    static configure(updates: Partial<ObservabilityConfig>): void;
    /**
     * Register a backend
     */
    static registerBackend(backend: ObservabilityBackend): void;
    /**
     * Unregister a backend
     */
    static unregisterBackend(name: string): void;
    /**
     * Initialize for a new Lambda invocation
     * Called at the start of each invocation
     */
    static initializeInvocation(): void;
    /**
     * Check if this is a cold start
     */
    static isColdStart(): boolean;
    /**
     * Get current invocation count
     */
    static getInvocationCount(): number;
    /**
     * Capture an observability event
     *
     * REQUIRED fields (must be in input or context):
     * - type: Event type
     * - level: Severity level
     * - correlationId: From context or explicit
     *
     * @param input - Event input
     * @param options - Capture options (critical, sync)
     * @returns logId if captured, undefined if filtered/sampled out or invalid
     */
    static capture(input: CaptureInput, options?: CaptureOptions): string | undefined;
    /**
     * Capture an observability event asynchronously
     *
     * Use this when you need to await backend completion (e.g., for critical audits).
     *
     * @param input - Event input
     * @param options - Capture options (critical bypasses sampling)
     * @returns Promise<logId> if captured, undefined if filtered/sampled out or invalid
     */
    static captureAsync(input: CaptureInput, options?: Omit<CaptureOptions, 'sync'>): Promise<string | undefined>;
    /**
     * Observe an event (alias for capture with Partial<ObservabilityEvent>)
     *
     * This is the primary method for recording observations.
     * Prefer using specialized observers (SpanObserver, AuditObserver, etc.)
     *
     * @param event - Partial event (correlationId, type, level required)
     * @param options - Capture options
     * @returns logId if captured, undefined if filtered/sampled out
     */
    static observe(event: Partial<ObservabilityEvent> & {
        type: string;
        level: string;
        correlationId?: string;
    }, options?: CaptureOptions): string | undefined;
    /**
     * Validate capture input
     */
    private static validateInput;
    /**
     * Build complete event from input
     */
    private static buildEvent;
    /**
     * Dispatch event to backends (fire-and-forget)
     */
    private static dispatchToBackends;
    /**
     * Dispatch event to backends (synchronous - waits for completion)
     */
    private static dispatchToBackendsSync;
    /**
     * Get backends configured for a specific event type
     */
    private static getBackendsForType;
    /**
     * Map event type to category
     */
    private static getTypeCategory;
    /**
     * Flush all backends
     * Called before Lambda returns
     */
    static flush(): Promise<void>;
    /**
     * Check if event should be captured based on level and sampling
     */
    private static shouldCapture;
    /**
     * Initialize from environment (synchronous)
     */
    private static ensureInitialized;
    /**
     * Get or create a cached regex for sampling pattern
     */
    private static getOrCreateSamplingRegex;
    /**
     * Reset manager state (for testing)
     *
     * IMPORTANT: This also resets the capturer in base.ts to ensure
     * observers can be properly re-initialized in tests.
     */
    static reset(): void;
    /**
     * Create a new observation context
     *
     * @param correlationId - REQUIRED - the trace/correlation ID
     * @param options - Optional context options
     */
    static createContext(correlationId: string, options?: {
        parentLogId?: string;
        actor?: Actor;
        tags?: Record<string, string>;
        source?: string;
    }): ObservationContext;
    /**
     * Get current observation context
     */
    static currentContext(): ObservationContext | undefined;
    /**
     * Run a function within an observation context
     *
     * @example
     * ```typescript
     * await Observer.withContext(
     *   Observer.createContext(requestId, { actor }),
     *   async () => {
     *     // All observations here share correlationId
     *   }
     * );
     * ```
     */
    static withContext<T>(context: ObservationContext, fn: () => Promise<T>): Promise<T>;
    /**
     * Run a function within an observation context (sync)
     */
    static withContextSync<T>(context: ObservationContext, fn: () => T): T;
    /**
     * Set actor on current context
     *
     * Useful when actor becomes available mid-flow (e.g., after authentication)
     */
    static setActor(actor: Actor): void;
    /**
     * Add tags to current context
     */
    static addTags(tags: Record<string, string>): void;
}
/**
 * Lambda handler wrapper with observability lifecycle management
 *
 * Ensures:
 * - Manager is initialized
 * - Invocation is tracked
 * - Backends are flushed before returning
 */
export declare const withObservability: <T extends (...args: unknown[]) => Promise<unknown>>(handler: T) => T;
/**
 * Alias for ObservabilityManager
 */
export declare const Observer: typeof ObservabilityManager;
