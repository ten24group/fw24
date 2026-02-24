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

import type { ObservabilityEvent, NoiseReductionConfig, HardSignalConfig } from '../types';

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
export function isHardSignal(
  event: ObservabilityEvent,
  config: NoiseReductionConfig,
): boolean {
  const hardSigConfig = config.hardSignals ?? {};

  // Check level
  const levels = hardSigConfig.levels ?? ['error', 'critical'];
  if (levels.includes(event.level)) {
    return true;
  }

  // Check warn (opt-in)
  if (hardSigConfig.includeWarn && event.level === 'warn') {
    return true;
  }

  // Check failure
  if (event.success === false || event.error != null) {
    return true;
  }

  // Check slow (configurable thresholds)
  if (event.durationMs != null) {
    const threshold = getSlowThreshold(event, hardSigConfig);
    if (event.durationMs > threshold) {
      return true;
    }
  }

  return false;
}

/**
 * Get slow threshold for an event.
 * Checks per-type thresholds first, then falls back to global default.
 */
function getSlowThreshold(
  event: ObservabilityEvent,
  hardSigConfig: HardSignalConfig,
): number {
  // Check per-type threshold
  if (hardSigConfig.slowThresholds) {
    const typeThreshold = hardSigConfig.slowThresholds[event.type];
    if (typeThreshold !== undefined) {
      return typeThreshold;
    }
  }

  // Fall back to global default
  return hardSigConfig.slowThresholdMs ?? 5000;
}
