/**
 * Hard signal detection for noise reduction.
 *
 * Hard signals are events that must always be preserved (emitted) and trigger
 * context preservation in their ancestor nodes. They represent important events
 * that should never be silently dropped.
 *
 * Hard signals include:
 * - Error/critical level events
 * - Failed operations (success=false or error present)
 * - Slow operations (exceeds configurable thresholds)
 * - Optionally: WARN level (if configured)
 */
import type { ObservabilityEvent, NoiseReductionConfig } from '../types';
/**
 * Check if an event is a hard signal.
 *
 * Hard signals always default to 'emit' unless explicitly overridden
 * by a rule with priority > HARD_SIGNAL_PRIORITY (1000).
 *
 * @param event - The observability event to check
 * @param config - Noise reduction configuration (only hardSignals sub-config is used)
 * @returns true if this is a hard signal that should be preserved
 */
export declare function isHardSignal(event: ObservabilityEvent, config: NoiseReductionConfig): boolean;
