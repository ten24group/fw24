/**
 * Display overrides merge **stored field values** with an optional JSON map (`displayOverrides` or
 * `model.displayOverrides.storageAttribute`). Same behavior as ui24.
 *
 * - No map / no entry → use stored value.
 * - Map has a **value** override → use that.
 * - Entry is only **visibility** or **format** → keep stored value (callers can inspect `entry`).
 * - Channel: tries `fieldPath@channel` before `fieldPath`.
 */
import type { DisplayOverrideEntry, DisplayOverrideStorage } from './display-override-types';
export interface ResolveWithDisplayOverridesParams {
    /** Current value on the row for this field (before overrides). */
    storedValue: unknown;
    overrideMap: DisplayOverrideStorage | undefined;
    /** Dot path used as key in the map (and optional `path@channel`). */
    fieldPath: string;
    channel?: string;
}
export interface ResolveWithDisplayOverridesResult {
    /** Value to show (stored, or override when applicable). */
    resolvedValue: unknown;
    /** True when a value-type override replaced the stored field. */
    valueFromOverride: boolean;
    entry?: DisplayOverrideEntry | null;
}
export declare function resolveWithDisplayOverrides(params: ResolveWithDisplayOverridesParams): ResolveWithDisplayOverridesResult;
/**
 * Read a value from a record by dot-path without throwing (`a.b.c`).
 */
export declare function readStoredValueAtPath(record: Record<string, unknown>, fieldPath: string): unknown;
