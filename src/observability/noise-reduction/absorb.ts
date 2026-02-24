/**
 * Absorption Logic
 *
 * Handles merging data from absorbed/silenced events into the nearest
 * emitted ancestor's AbsorbedData structure.
 *
 * All operations are additive and bounded (capped by AbsorptionBounds).
 * No data is mutated on the original events.
 */

import type { ObservabilityEvent, ObservabilityError } from '../types';
import type { AbsorbedData, AbsorbedCheckpoint, AbsorbedError, AbsorptionBounds, DurationStats, OperationStats } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// MUTABLE BUILDER (internal, frozen before returning to caller)
// ═══════════════════════════════════════════════════════════════════════════

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
export function createMutableAbsorbed(): MutableAbsorbedData {
  return {
    count: 0,
    silentCount: 0,
    byOperation: {},
    errors: [],
    causedByLinks: [],
    entityIds: [],
    checkpoints: [],
  };
}

/**
 * Freeze a mutable AbsorbedData into an immutable one.
 * Returns undefined if no data was absorbed (count === 0 and silentCount === 0).
 */
export function freezeAbsorbed(mutable: MutableAbsorbedData): AbsorbedData | undefined {
  if (mutable.count === 0 && mutable.silentCount === 0) {
    return undefined;
  }

  const frozenByOperation: Record<string, OperationStats> = {};
  for (const [key, stats] of Object.entries(mutable.byOperation)) {
    const frozen: OperationStats = {
      count: stats.count,
      errorCount: stats.errorCount,
      duration: stats.duration ? freezeDuration(stats.duration) : undefined,
    };
    frozenByOperation[key] = frozen;
  }

  return {
    count: mutable.count,
    silentCount: mutable.silentCount,
    byOperation: frozenByOperation,
    errors: [...mutable.errors],
    causedByLinks: [...mutable.causedByLinks],
    entityIds: [...mutable.entityIds],
    checkpoints: [...mutable.checkpoints],
  };
}

function freezeDuration(d: MutableDurationStats): DurationStats {
  return { sum: d.sum, min: d.min, max: d.max, count: d.count };
}

// ═══════════════════════════════════════════════════════════════════════════
// ABSORPTION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

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
export function absorbEvent(
  target: MutableAbsorbedData,
  event: ObservabilityEvent,
  bounds: AbsorptionBounds,
): void {
  target.count++;

  const opKey = event.operation ?? event.type;

  // Update per-operation stats (bounded)
  if (Object.keys(target.byOperation).length < bounds.maxOperationKeysPerSpan || opKey in target.byOperation) {
    const opStats = getOrCreateOperationStats(target.byOperation, opKey);
    opStats.count++;

    // Track errors
    if (event.success === false || event.error != null) {
      opStats.errorCount++;
    }

    // Track duration
    if (event.durationMs != null) {
      updateDuration(opStats, event.durationMs);
    }
  }

  // Preserve error details (always, but capped)
  if ((event.success === false || event.error != null) && target.errors.length < bounds.maxErrorsPerSpan) {
    target.errors.push(createAbsorbedError(event));
  }

  // Preserve cross-hop causedBy links (capped, deduplicated)
  if (event.causedBy && target.causedByLinks.length < bounds.maxCausedByLinksPerSpan) {
    if (!target.causedByLinks.includes(event.causedBy)) {
      target.causedByLinks.push(event.causedBy);
    }
  }

  // Preserve entity IDs (capped, deduplicated)
  if (event.entityId && target.entityIds.length < bounds.maxEntityIdsPerSpan) {
    if (!target.entityIds.includes(event.entityId)) {
      target.entityIds.push(event.entityId);
    }
  }

  // Create a timeline checkpoint from the absorbed event (capped).
  // Per-item varying fields go here; shared context (tags, source, etc.) is
  // extracted into the group header at persistence time (manager.ts).
  if (target.checkpoints.length < bounds.maxCheckpointsPerSpan) {
    const checkpoint: AbsorbedCheckpoint = {
      // Grouping key
      name: event.operation ?? event.type,
      // Per-item fields (vary across absorbed events)
      ts: event.timestampMs,
      durationMs: event.durationMs,
      success: event.success,
      observabilityLogId: event.observabilityLogId,
      entityId: event.entityId,
      status: event.status,
      causedBy: event.causedBy,
      metrics: event.metrics ? { ...event.metrics } : undefined,
      // Error details (only for failures) — preserve original message, fall back to type, then operation-qualified default
      error: (event.success === false || event.error != null)
        ? {
            type: event.error?.type ?? 'unknown',
            message: event.error?.message || event.error?.type || `${event.operation ?? event.type} failed`,
          }
        : undefined,
      // Shared context (stored here during collection, factored out to group at persistence)
      tags: event.tags ? { ...event.tags } : undefined,
      type: event.type,
      subType: event.subType,
      level: event.level,
      entityName: event.entityName,
      source: event.source,
    };
    target.checkpoints.push(checkpoint);
  }
}

/**
 * Record a silently dropped event (counter only, no data).
 */
export function recordSilent(target: MutableAbsorbedData): void {
  target.silentCount++;
}

/**
 * Merge absorbed data from a child emitted node into the parent's absorbed data.
 * This happens when child nodes that were emitted had their own absorbed children,
 * and we want the parent to also know about them (for cascade queries).
 *
 * NOTE: We do NOT merge child's absorbed data into parent in the current design.
 * Each emitted node only carries absorbed data from its direct absorbed/silenced children.
 * This keeps the data model simple and predictable.
 */

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getOrCreateOperationStats(
  byOp: Record<string, MutableOperationStats>,
  opKey: string,
): MutableOperationStats {
  let stats = byOp[opKey];
  if (!stats) {
    stats = { count: 0, errorCount: 0 };
    byOp[opKey] = stats;
  }
  return stats;
}

function updateDuration(stats: MutableOperationStats, durationMs: number): void {
  if (!stats.duration) {
    stats.duration = { sum: durationMs, min: durationMs, max: durationMs, count: 1 };
  } else {
    stats.duration.sum += durationMs;
    stats.duration.count++;
    if (durationMs < stats.duration.min) stats.duration.min = durationMs;
    if (durationMs > stats.duration.max) stats.duration.max = durationMs;
  }
}

function createAbsorbedError(event: ObservabilityEvent): AbsorbedError {
  const rawError = event.error;
  const errorType = rawError?.type ?? (event.success === false ? 'failure' : 'unknown');
  const errorMessage = rawError?.message
    || rawError?.type
    || `${event.operation ?? event.type} failed (no error details)`;

  return {
    observabilityLogId: event.observabilityLogId,
    operation: event.operation,
    entityId: event.entityId,
    error: { type: errorType, message: errorMessage },
    durationMs: event.durationMs,
    causedBy: event.causedBy,
    tags: event.tags ? { ...event.tags } : undefined,
    fingerprint: event.fingerprint,
  };
}
