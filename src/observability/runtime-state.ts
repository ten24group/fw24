import type { ObservabilityConfig, SpanLifecycleHook } from './types';

/**
 * Minimal shared runtime state for observability modules.
 *
 * Purpose:
 * - Break circular dependencies between `ObservabilityManager` and `SpanObserver`.
 * - Allow flush-time utilities (like force-ending open spans) without importing `SpanObserver` from `manager.ts`.
 * - Store span lifecycle hooks so SpanObserver can call OTEL (and other real-time backends) directly.
 */

let currentConfig: ObservabilityConfig | null = null;

export function setCurrentObservabilityConfig(cfg: ObservabilityConfig | null): void {
  currentConfig = cfg;
}

export function getCurrentObservabilityConfig(): ObservabilityConfig | null {
  return currentConfig;
}

type SpanFinalizer = () => void;
let spanFinalizer: SpanFinalizer | null = null;

export function setSpanFinalizer(fn: SpanFinalizer): void {
  spanFinalizer = fn;
}

/**
 * Run the span finalizer and clear it to ensure idempotency.
 * If called multiple times, only the first call executes the finalizer.
 */
export function runSpanFinalizer(): void {
  const fn = spanFinalizer;
  spanFinalizer = null; // Clear immediately to prevent re-execution
  fn?.();
}

// ═══════════════════════════════════════════════════════════════════════════
// Span Lifecycle Hooks
// ═══════════════════════════════════════════════════════════════════════════

let lifecycleHooks: readonly SpanLifecycleHook[] = [];

/**
 * Register span lifecycle hooks (called by ObservabilityManager after backend init).
 * Replaces any previously registered hooks.
 */
export function setSpanLifecycleHooks(hooks: readonly SpanLifecycleHook[]): void {
  lifecycleHooks = hooks;
}

/**
 * Get currently registered span lifecycle hooks.
 * Called by SpanObserver on span start/end.
 */
export function getSpanLifecycleHooks(): readonly SpanLifecycleHook[] {
  return lifecycleHooks;
}


