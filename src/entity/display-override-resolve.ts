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

function normalizeEntry(raw: unknown): DisplayOverrideEntry | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if ('value' in o || 'kind' in o || 'channel' in o) {
      return raw as DisplayOverrideEntry;
    }
  }
  return { value: raw, kind: 'value' };
}

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


export function resolveWithDisplayOverrides(
  params: ResolveWithDisplayOverridesParams
): ResolveWithDisplayOverridesResult {
  const { storedValue, overrideMap, fieldPath, channel } = params;
  if (!overrideMap || typeof overrideMap !== 'object') {
    return { resolvedValue: storedValue, valueFromOverride: false };
  }

  const keysToTry: string[] = [];
  if (channel) keysToTry.push(`${fieldPath}@${channel}`);
  keysToTry.push(fieldPath);

  for (const key of keysToTry) {
    if (!Object.prototype.hasOwnProperty.call(overrideMap, key)) continue;
    const raw = overrideMap[ key ];
    const entry = normalizeEntry(raw);
    if (!entry) continue;

    const kind = entry.kind ?? 'value';
    if (kind === 'visibility' || kind === 'format') {
      return { resolvedValue: storedValue, valueFromOverride: false, entry };
    }
    if (entry.value !== undefined) {
      return { resolvedValue: entry.value, valueFromOverride: true, entry };
    }
  }

  return { resolvedValue: storedValue, valueFromOverride: false };
}


/**
 * Read a value from a record by dot-path without throwing (`a.b.c`).
 */
export function readStoredValueAtPath(record: Record<string, unknown>, fieldPath: string): unknown {
  if (!fieldPath.includes('.')) {
    return record[ fieldPath ];
  }
  const keys = fieldPath.split('.');
  let cur: unknown = record;
  for (const k of keys) {
    if (k === '') return undefined;
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    const o = cur as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(o, k)) return undefined;
    cur = o[ k ];
  }
  return cur;
}

