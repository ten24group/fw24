/**
 * Hard signal detection for noise reduction.
 *
 * Hard signals are events that must always be preserved and trigger
 * context preservation in their ancestor nodes.
 */
import type { ObservabilityEvent, NoiseReductionConfig } from '../types';
/**
 * Check if an event is a hard signal.
 *
 * Hard signals include:
 * - Error/critical level events
 * - Failed operations (success=false or error present)
 * - Slow operations (exceeds threshold)
 * - Optionally: WARN level (if configured)
 *
 * @param event - The observability event to check
 * @param config - Noise reduction configuration
 * @returns true if this is a hard signal that must be preserved
 */
export declare function isHardSignal(event: ObservabilityEvent, config: NoiseReductionConfig): boolean;
