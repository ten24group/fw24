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
export declare function asArray<T>(v: T | T[] | undefined): T[] | undefined;
/**
 * Increment a counter in a mutable record.
 * Creates the key with value 0 + by if it doesn't exist.
 */
export declare function incrementCounter(map: Record<string, number>, key: string | undefined, by?: number): void;
/**
 * Estimate the size of an event's payload fields in bytes.
 * Used for approximate byte savings tracking.
 */
export declare function estimateEventBytes(event: ObservabilityEvent): number;
/**
 * Create initial (mutable) noise reduction stats.
 */
export declare function createMutableStats(): {
    emitted: number;
    absorbed: number;
    silenced: number;
    totalInput: number;
    suppressedRoots: number;
    absorbedByOperation: Record<string, number>;
    silencedByOperation: Record<string, number>;
};
/**
 * Freeze mutable stats into a readonly NoiseReductionStats.
 */
export declare function freezeStats(stats: ReturnType<typeof createMutableStats>): NoiseReductionStats;
/**
 * Extract absorption bounds from noise reduction config.
 */
export declare function getAbsorptionBounds(cfg: NoiseReductionConfig): AbsorptionBounds;
