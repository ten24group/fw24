/**
 * Shared utility functions for noise reduction (v2).
 */

import type { ObservabilityEvent } from '../types';
import type { NoiseReductionStats, AbsorptionBounds } from './types';
import type { NoiseReductionConfig } from '../types';

/**
 * Convert a value to an array if it isn't already.
 * Returns undefined if input is undefined (preserves optionality).
 */
export function asArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

/**
 * Increment a counter in a mutable record.
 * Creates the key with value 0 + by if it doesn't exist.
 */
export function incrementCounter(
  map: Record<string, number>,
  key: string | undefined,
  by: number = 1,
): void {
  const k = key ?? '_unknown';
  map[k] = (map[k] ?? 0) + by;
}

/**
 * Estimate the size of an event's payload fields in bytes.
 * Used for approximate byte savings tracking.
 */
export function estimateEventBytes(event: ObservabilityEvent): number {
  let bytes = 0;
  if (event.data) bytes += JSON.stringify(event.data).length;
  if (event.attributes) bytes += JSON.stringify(event.attributes).length;
  if (event.metadata) bytes += JSON.stringify(event.metadata).length;
  if (event.context) bytes += JSON.stringify(event.context).length;
  // Estimate base fields (type, level, operation, tags, etc.) at ~200 bytes
  bytes += 200;
  return bytes;
}

/**
 * Create initial (mutable) noise reduction stats.
 */
export function createMutableStats(): {
  emitted: number;
  absorbed: number;
  silenced: number;
  totalInput: number;
  suppressedRoots: number;
  absorbedByOperation: Record<string, number>;
  silencedByOperation: Record<string, number>;
} {
  return {
    emitted: 0,
    absorbed: 0,
    silenced: 0,
    totalInput: 0,
    suppressedRoots: 0,
    absorbedByOperation: {},
    silencedByOperation: {},
  };
}

/**
 * Freeze mutable stats into a readonly NoiseReductionStats.
 */
export function freezeStats(stats: ReturnType<typeof createMutableStats>): NoiseReductionStats {
  return {
    emitted: stats.emitted,
    absorbed: stats.absorbed,
    silenced: stats.silenced,
    totalInput: stats.totalInput,
    suppressedRoots: stats.suppressedRoots,
    absorbedByOperation: { ...stats.absorbedByOperation },
    silencedByOperation: { ...stats.silencedByOperation },
  };
}

/**
 * Extract absorption bounds from noise reduction config.
 */
export function getAbsorptionBounds(cfg: NoiseReductionConfig): AbsorptionBounds {
  return {
    maxErrorsPerSpan: cfg.maxAbsorbedErrorsPerSpan,
    maxCausedByLinksPerSpan: cfg.maxAbsorbedCausedByLinksPerSpan,
    maxEntityIdsPerSpan: cfg.maxAbsorbedEntityIdsPerSpan,
    maxOperationKeysPerSpan: cfg.maxAbsorbedOperationKeysPerSpan,
    maxCheckpointsPerSpan: cfg.maxAbsorbedCheckpointsPerSpan,
  };
}
