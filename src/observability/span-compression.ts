/**
 * Span Compression — Groups absorbed checkpoints by operation name into composite timeline entries.
 *
 * Inspired by Elastic APM's span compression: instead of N identical
 * "BaseEntityService.upsert" entries on the timeline, produces ONE entry like:
 *
 *   BaseEntityService.upsert x10 | 100-123ms | all succeeded | write · standing
 *
 * Extracted from manager.ts for clarity and testability.
 */

import type { AbsorbedCheckpoint } from './noise-reduction/types';

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Aggregate stats for a numeric field across a group of items. */
export interface AggregateStats {
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

/**
 * Compact representation of a single absorbed item within a grouped checkpoint.
 * Contains only the fields that vary per item — shared context lives on the parent `GroupedCheckpoint`.
 */
export interface CompactCheckpointItem {
  readonly ts: number;
  readonly durationMs?: number;
  readonly entityId?: string;
  readonly observabilityLogId?: string;
  readonly success?: boolean;
  readonly error?: { readonly type: string; readonly message: string };
  readonly status?: string;
  readonly causedBy?: string;
}

/**
 * A composite timeline entry that aggregates multiple absorbed checkpoints of the same operation.
 *
 * Example:
 *   name: "BaseEntityService.upsert"
 *   count: 10
 *   _description: "10x · 100-123ms · all succeeded · write · standing"
 */
export interface GroupedCheckpoint {
  // Identity (used as timeline label)
  readonly name: string;
  // Use firstTs as the timeline timestamp (sorted chronologically)
  readonly ts: number;
  // Aggregate stats
  readonly count: number;
  readonly errorCount: number;
  readonly duration?: AggregateStats;
  // Aggregate metrics (per-key sum/min/max/count across all items with metrics)
  readonly metrics?: Readonly<Record<string, AggregateStats>>;
  // Time range (only present when firstTs !== lastTs)
  readonly firstTs?: number;
  readonly lastTs?: number;
  // Shared context (stored ONCE, from first item — same across items of same operation)
  readonly type?: string;
  readonly subType?: string;
  readonly level?: string;
  readonly source?: string;
  readonly entityName?: string;
  readonly tags?: Readonly<Record<string, string>>;
  // Per-item varying data
  readonly items: readonly CompactCheckpointItem[];
  // Synthesized display fields
  readonly _type?: 'success' | 'error' | 'warning';
  readonly _description: string;
  readonly _source: 'absorbed';
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Group absorbed checkpoints by operation name into composite timeline entries.
 *
 * Each grouped entry contains:
 * - Aggregate stats: count, duration min/max/sum, errorCount
 * - Aggregate metrics: per-key min/max/sum/count across all items with metrics
 * - Shared context: tags, type, subType, level, source, entityName (stored once)
 * - Per-item compact array: ts, durationMs, entityId, observabilityLogId, success, error, status, causedBy
 * - Synthesized display fields: _type, _description, _source
 */
export function groupCheckpointsByOperation(checkpoints: readonly AbsorbedCheckpoint[]): GroupedCheckpoint[] {
  // Group by operation name
  const groups = new Map<string, AbsorbedCheckpoint[]>();
  for (const cp of checkpoints) {
    const existing = groups.get(cp.name);
    if (existing) {
      existing.push(cp);
    } else {
      groups.set(cp.name, [cp]);
    }
  }

  const result: GroupedCheckpoint[] = [];

  for (const [name, items] of groups) {
    // Compute aggregate stats
    let durationMin = Infinity;
    let durationMax = -Infinity;
    let durationSum = 0;
    let durationCount = 0;
    let errorCount = 0;
    let firstTs = Infinity;
    let lastTs = -Infinity;
    let hasAnySuccess = false;
    let hasAnyError = false;

    // Aggregate metrics across all items in this group
    const metricsAgg = new Map<string, { sum: number; min: number; max: number; count: number }>();

    for (const item of items) {
      if (item.durationMs != null) {
        durationSum += item.durationMs;
        durationCount++;
        if (item.durationMs < durationMin) durationMin = item.durationMs;
        if (item.durationMs > durationMax) durationMax = item.durationMs;
      }
      if (item.ts < firstTs) firstTs = item.ts;
      if (item.ts > lastTs) lastTs = item.ts;
      if (item.error || item.success === false) {
        errorCount++;
        hasAnyError = true;
      }
      if (item.success === true) hasAnySuccess = true;

      // Aggregate per-key metrics (queryTimeMs, resultCount, etc.)
      if (item.metrics) {
        for (const [key, value] of Object.entries(item.metrics)) {
          const existing = metricsAgg.get(key);
          if (existing) {
            existing.sum += value;
            existing.count++;
            if (value < existing.min) existing.min = value;
            if (value > existing.max) existing.max = value;
          } else {
            metricsAgg.set(key, { sum: value, min: value, max: value, count: 1 });
          }
        }
      }
    }

    // Determine the composite _type for timeline coloring
    const _type: GroupedCheckpoint['_type'] = hasAnyError && hasAnySuccess
      ? 'warning'     // mixed: some succeeded, some failed
      : hasAnyError
        ? 'error'
        : hasAnySuccess ? 'success' : undefined;

    // Build _description
    const descParts: string[] = [];
    descParts.push(`${items.length}x`);
    if (durationCount > 0) {
      if (durationMin === durationMax) {
        descParts.push(`${durationMin}ms`);
      } else {
        descParts.push(`${durationMin}-${durationMax}ms`);
      }
    }
    if (errorCount > 0) {
      descParts.push(`${errorCount} failed`);
    } else if (hasAnySuccess) {
      descParts.push('all succeeded');
    }
    // Extract shared context from first item (tags are shared across items of same operation)
    const firstItem = items[0];
    if (firstItem.tags?.operation_category) descParts.push(firstItem.tags.operation_category);
    if (firstItem.tags?.entity_name) descParts.push(firstItem.tags.entity_name);

    // Build compact per-item array (only varying fields)
    const compactItems: CompactCheckpointItem[] = items.map(item => ({
      ts: item.ts,
      ...(item.durationMs != null ? { durationMs: item.durationMs } : {}),
      ...(item.entityId ? { entityId: item.entityId } : {}),
      ...(item.observabilityLogId ? { observabilityLogId: item.observabilityLogId } : {}),
      ...(item.success != null ? { success: item.success } : {}),
      ...(item.error ? { error: item.error } : {}),
      ...(item.status ? { status: item.status } : {}),
      ...(item.causedBy ? { causedBy: item.causedBy } : {}),
    }));

    // Build aggregate metrics object (only if any item had metrics)
    let aggregateMetrics: Record<string, AggregateStats> | undefined;
    if (metricsAgg.size > 0) {
      aggregateMetrics = {};
      for (const [key, agg] of metricsAgg) {
        aggregateMetrics[key] = { sum: agg.sum, min: agg.min, max: agg.max, count: agg.count };
      }
    }

    // Build the composite timeline entry
    const entry: GroupedCheckpoint = {
      name,
      ts: firstTs,
      count: items.length,
      errorCount,
      ...(durationCount > 0 ? {
        duration: {
          min: durationMin,
          max: durationMax,
          sum: durationSum,
          count: durationCount,
        },
      } : {}),
      ...(aggregateMetrics ? { metrics: aggregateMetrics } : {}),
      ...(firstTs !== lastTs ? { firstTs, lastTs } : {}),
      ...(firstItem.type ? { type: firstItem.type } : {}),
      ...(firstItem.subType ? { subType: firstItem.subType } : {}),
      ...(firstItem.level ? { level: firstItem.level } : {}),
      ...(firstItem.source ? { source: firstItem.source } : {}),
      ...(firstItem.entityName ? { entityName: firstItem.entityName } : {}),
      ...(firstItem.tags ? { tags: firstItem.tags } : {}),
      items: compactItems,
      _type,
      _description: descParts.join(' · '),
      _source: 'absorbed',
    };

    result.push(entry);
  }

  return result;
}
