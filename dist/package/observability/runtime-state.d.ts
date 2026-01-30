import type { ObservabilityConfig } from './types';
export declare function setCurrentObservabilityConfig(cfg: ObservabilityConfig | null): void;
export declare function getCurrentObservabilityConfig(): ObservabilityConfig | null;
type SpanFinalizer = () => void;
export declare function setSpanFinalizer(fn: SpanFinalizer): void;
/**
 * Run the span finalizer and clear it to ensure idempotency.
 * If called multiple times, only the first call executes the finalizer.
 */
export declare function runSpanFinalizer(): void;
export {};
