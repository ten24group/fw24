/**
 * Absorption Logic
 *
 * Handles merging data from absorbed/silenced events into the nearest
 * emitted ancestor's AbsorbedData structure.
 *
 * All operations are additive and bounded (capped by AbsorptionBounds).
 * No data is mutated on the original events.
 */
import type { ObservabilityEvent } from '../types';
import type { AbsorbedData, AbsorbedCheckpoint, AbsorbedError, AbsorptionBounds } from './types';
/**
 * Mutable version of AbsorbedData used during construction.
 * Frozen into an immutable AbsorbedData before leaving the algorithm.
 */
export interface MutableAbsorbedData {
    count: number;
    silentCount: number;
    byOperation: Record<string, MutableOperationStats>;
    errors: AbsorbedError[];
    causedByLinks: string[];
    entityIds: string[];
    checkpoints: AbsorbedCheckpoint[];
}
interface MutableOperationStats {
    count: number;
    errorCount: number;
    duration?: MutableDurationStats;
}
interface MutableDurationStats {
    sum: number;
    min: number;
    max: number;
    count: number;
}
/**
 * Create an empty mutable AbsorbedData builder.
 */
export declare function createMutableAbsorbed(): MutableAbsorbedData;
/**
 * Freeze a mutable AbsorbedData into an immutable one.
 * Returns undefined if no data was absorbed (count === 0 and silentCount === 0).
 */
export declare function freezeAbsorbed(mutable: MutableAbsorbedData): AbsorbedData | undefined;
/**
 * Absorb an event's data into a mutable AbsorbedData builder.
 *
 * This records:
 * - Per-operation stats (count, errorCount, duration min/max/sum)
 * - Error details (capped)
 * - Cross-hop causedBy links (capped)
 * - Entity IDs (capped)
 *
 * All arrays are bounded by the provided bounds.
 */
export declare function absorbEvent(target: MutableAbsorbedData, event: ObservabilityEvent, bounds: AbsorptionBounds): void;
/**
 * Record a silently dropped event (counter only, no data).
 */
export declare function recordSilent(target: MutableAbsorbedData): void;
export {};
