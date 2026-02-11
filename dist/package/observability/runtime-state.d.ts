import type { ObservabilityConfig, SpanLifecycleHook } from './types';
export declare function setCurrentObservabilityConfig(cfg: ObservabilityConfig | null): void;
export declare function getCurrentObservabilityConfig(): ObservabilityConfig | null;
type SpanFinalizer = () => void;
export declare function setSpanFinalizer(fn: SpanFinalizer): void;
/**
 * Run the span finalizer and clear it to ensure idempotency.
 * If called multiple times, only the first call executes the finalizer.
 */
export declare function runSpanFinalizer(): void;
/**
 * Register span lifecycle hooks (called by ObservabilityManager after backend init).
 * Replaces any previously registered hooks.
 */
export declare function setSpanLifecycleHooks(hooks: readonly SpanLifecycleHook[]): void;
/**
 * Get currently registered span lifecycle hooks.
 * Called by SpanObserver on span start/end.
 */
export declare function getSpanLifecycleHooks(): readonly SpanLifecycleHook[];
export {};
