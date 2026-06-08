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
    readonly error?: {
        readonly type: string;
        readonly message: string;
    };
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
    readonly name: string;
    readonly ts: number;
    readonly count: number;
    readonly errorCount: number;
    readonly duration?: AggregateStats;
    readonly metrics?: Readonly<Record<string, AggregateStats>>;
    readonly firstTs?: number;
    readonly lastTs?: number;
    readonly type?: string;
    readonly subType?: string;
    readonly level?: string;
    readonly source?: string;
    readonly entityName?: string;
    readonly tags?: Readonly<Record<string, string>>;
    readonly items: readonly CompactCheckpointItem[];
    readonly _type?: 'success' | 'error' | 'warning';
    readonly _description: string;
    readonly _source: 'absorbed';
}
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
export declare function groupCheckpointsByOperation(checkpoints: readonly AbsorbedCheckpoint[]): GroupedCheckpoint[];
