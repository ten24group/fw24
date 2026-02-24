/**
 * Noise Reduction Types (v2)
 *
 * Three-decision model:
 * - emit:   Persist as a standalone DynamoDB record
 * - absorb: Merge structured data into nearest emitted ancestor
 * - silent: Increment counter on nearest emitted ancestor only
 *
 * Key design principles:
 * - No tree mutation: decisions are recorded, the tree is never modified
 * - Parent resolution happens at collection time by walking the tree
 * - Absorbed data lives in `data.absorbed` (no separate top-level attribute)
 * - Strong typing: no `any`, no forced casts
 */

import type { ObservabilityEvent } from '../types';

// ═══════════════════════════════════════════════════════════════════════════
// CORE DECISION MODEL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Noise reduction decision for a single event.
 *
 * - `emit`:   Persist as a standalone DynamoDB record (full event preserved)
 * - `absorb`: Do not persist as standalone; merge structured data into nearest emitted ancestor
 * - `silent`: Do not persist; only increment a counter on nearest emitted ancestor
 */
export type NoiseDecision = 'emit' | 'absorb' | 'silent';

// ═══════════════════════════════════════════════════════════════════════════
// ABSORBED DATA MODEL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Duration statistics for a group of operations.
 * All values are in milliseconds.
 */
export interface DurationStats {
  /** Sum of all durations (for computing averages) */
  readonly sum: number;
  /** Minimum duration observed */
  readonly min: number;
  /** Maximum duration observed */
  readonly max: number;
  /** Number of events with duration data (may differ from parent count if some events lack timing) */
  readonly count: number;
}

/**
 * Per-operation breakdown of absorbed events.
 * Tracks count, errors, and optional duration statistics.
 */
export interface OperationStats {
  /** Total events absorbed for this operation */
  readonly count: number;
  /** Number of events that had errors or success=false */
  readonly errorCount: number;
  /** Duration statistics (only present when at least one event had durationMs) */
  readonly duration?: DurationStats;
}

/**
 * Error details preserved from an absorbed child event.
 * Captures enough context for debugging without storing the full event.
 */
export interface AbsorbedError {
  /** observabilityLogId of the absorbed event that had the error */
  readonly observabilityLogId: string;
  /** Operation name from the absorbed event */
  readonly operation?: string;
  /** Entity ID from the absorbed event (for traceability) */
  readonly entityId?: string;
  /** Error details */
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
  /** Duration in milliseconds (if available) */
  readonly durationMs?: number;
  /** Cross-hop causedBy link from the absorbed event */
  readonly causedBy?: string;
  /** Tags from the absorbed event (for filtering/correlation) */
  readonly tags?: Readonly<Record<string, string>>;
  /** Deterministic error fingerprint for cross-event correlation */
  readonly fingerprint?: string;
}

/**
 * Structured data attached to an emitted event describing what was absorbed into it.
 *
 * This is the SINGLE structure that replaces the old system's scattered checkpoints,
 * aggregate buckets, noise reduction summaries, and fold markers.
 *
 * Design invariants:
 * - Arrays are bounded (configurable caps, enforced during absorption)
 * - All fields are optional (an event with no absorbed children has no data.absorbed)
 * - The structure is deterministic: same input always produces same output
 */
export interface AbsorbedData {
  /** Total events absorbed (decision=absorb) into this record */
  readonly count: number;
  /** Total events silently dropped (decision=silent) under this record */
  readonly silentCount: number;
  /** Per-operation breakdown with duration stats */
  readonly byOperation: Readonly<Record<string, OperationStats>>;
  /** Errors from absorbed children (ALWAYS preserved, capped by config) */
  readonly errors: readonly AbsorbedError[];
  /** Cross-hop causedBy links preserved from absorbed children */
  readonly causedByLinks: readonly string[];
  /** Entity IDs from absorbed children for traceability */
  readonly entityIds: readonly string[];
  /**
   * Timeline checkpoints synthesized from absorbed child events.
   * Each absorbed event with an operation name becomes a checkpoint entry,
   * giving the parent span a detailed timeline without creating separate records.
   * Format matches SpanCheckpoint so the UI can render them alongside manual checkpoints.
   */
  readonly checkpoints: readonly AbsorbedCheckpoint[];
}

/**
 * A checkpoint entry synthesized from an absorbed event.
 * Stored in AbsorbedData.checkpoints during algorithm execution.
 *
 * At persistence time (manager.ts), individual checkpoints are GROUPED by operation name
 * into composite timeline entries (Elastic APM span compression pattern).
 *
 * This type captures per-item fields only. Shared context (tags, source, level, type)
 * is factored out into the group header to avoid N-way duplication.
 */
export interface AbsorbedCheckpoint {
  /** Operation name (grouping key, e.g., "BaseEntityService.upsert") */
  readonly name: string;
  /** Timestamp in epoch milliseconds */
  readonly ts: number;
  /** Duration in milliseconds (if available) */
  readonly durationMs?: number;
  /** Whether the absorbed operation succeeded */
  readonly success?: boolean;
  /** Error info if the absorbed event had an error */
  readonly error?: { readonly type: string; readonly message: string };

  // === Per-item identity & state (varies per absorbed event) ===

  /** Original observability log ID — for traceability and linking */
  readonly observabilityLogId?: string;
  /** Specific entity instance ID */
  readonly entityId?: string;
  /** Operation status (completed, failed, timeout, etc.) — varies per item */
  readonly status?: string;
  /** Cross-hop causedBy correlation ID — varies per item */
  readonly causedBy?: string;
  /** Numeric metrics from the absorbed event (queryTimeMs, resultCount, etc.) */
  readonly metrics?: Readonly<Record<string, number>>;

  // === Shared context (same across items in a group, extracted to group header at persistence) ===

  /** Tags from the absorbed event */
  readonly tags?: Readonly<Record<string, string>>;
  /** Event type (span, log, metric, etc.) */
  readonly type?: string;
  /** More specific type classification (e.g., entity.create, entity.update) */
  readonly subType?: string;
  /** Severity level */
  readonly level?: string;
  /** Entity type being observed (e.g., "standing", "team") */
  readonly entityName?: string;
  /** Source identifier */
  readonly source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TREE NODE (internal, for algorithm use)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of evaluating a noise rule against an event.
 * Stored on tree nodes to record why a decision was made.
 */
export interface NodeDecision {
  /** The noise reduction decision */
  readonly decision: NoiseDecision;
  /** ID of the rule that produced this decision (or 'default' / 'override' / 'hard-signal') */
  readonly ruleId: string;
  /** Human-readable reason for the decision */
  readonly reason: string;
  /** Effective priority of the winning rule */
  readonly priority: number;
}

/**
 * Tree node representing an observability event in the span hierarchy.
 *
 * The tree is built once and NEVER mutated. Decisions and absorbed data
 * are recorded as separate properties. Parent references are readonly.
 *
 * Children whose parents are not in the current batch become root nodes.
 * The original `parentObservabilityLogId` is preserved for cross-batch linking.
 */
export interface TreeNode {
  /** The observability event this node represents (never mutated) */
  readonly event: Readonly<ObservabilityEvent>;
  /** Parent node (undefined for roots in this batch) */
  readonly parent: TreeNode | undefined;
  /** Child nodes */
  readonly children: readonly TreeNode[];
  /** Noise reduction decision (set during evaluation phase) */
  evaluation?: NodeDecision;
  /** Whether this node or any descendant is a hard signal */
  hasHardSignalDescendant?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// ALGORITHM OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Statistics produced by the noise reduction algorithm.
 */
export interface NoiseReductionStats {
  /** Number of events emitted as standalone records */
  readonly emitted: number;
  /** Number of events absorbed into parents */
  readonly absorbed: number;
  /** Number of events silently dropped */
  readonly silenced: number;
  /** Total input events */
  readonly totalInput: number;
  /**
   * Number of root invocations suppressed because the entire tree was noise
   * (all emitted events were promoted from absorb/silent, none genuinely emitted).
   */
  readonly suppressedRoots: number;
  /** Breakdown of absorbed events by operation */
  readonly absorbedByOperation: Readonly<Record<string, number>>;
  /** Breakdown of silenced events by operation */
  readonly silencedByOperation: Readonly<Record<string, number>>;
}

/**
 * A single emitted event with its resolved parent ID and optional absorbed data.
 * This is what the noise reduction algorithm produces for each emitted event.
 */
export interface EmittedEvent {
  /** The original event (unmodified) */
  readonly event: ObservabilityEvent;
  /**
   * Resolved parent ID: the observabilityLogId of the nearest EMITTED ancestor.
   * This may differ from event.parentObservabilityLogId if intermediate parents were absorbed/silenced.
   * undefined means this is a root with no emitted parent.
   */
  readonly resolvedParentId: string | undefined;
  /** Absorbed data from children (only present if children were absorbed/silenced into this event) */
  readonly absorbed: AbsorbedData | undefined;
  /** Debug info about the noise reduction decision (only present when config.debug is true) */
  readonly debugInfo?: NoiseDebugInfo;
}

/**
 * Complete result of the noise reduction algorithm.
 */
/**
 * Debug information about the noise reduction decision for an event.
 * Only present when `config.debug` is enabled.
 */
export interface NoiseDebugInfo {
  /** The decision that was made */
  readonly decision: NoiseDecision;
  /** ID of the rule that produced this decision */
  readonly ruleId: string;
  /** Human-readable reason for the decision */
  readonly reason: string;
}

export interface NoiseReductionResult {
  /** Events to persist, with resolved parent IDs and absorbed data */
  readonly events: readonly EmittedEvent[];
  /** Statistics about the reduction */
  readonly stats: NoiseReductionStats;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION BOUNDS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bounds for absorbed data, preventing unbounded growth.
 * These are derived from NoiseReductionConfig at algorithm entry.
 */
export interface AbsorptionBounds {
  /** Maximum error entries in data.absorbed.errors per emitted event */
  readonly maxErrorsPerSpan: number;
  /** Maximum causedBy links in data.absorbed.causedByLinks per emitted event */
  readonly maxCausedByLinksPerSpan: number;
  /** Maximum entity IDs in data.absorbed.entityIds per emitted event */
  readonly maxEntityIdsPerSpan: number;
  /** Maximum number of distinct operation keys in data.absorbed.byOperation */
  readonly maxOperationKeysPerSpan: number;
  /** Maximum checkpoint entries in data.absorbed.checkpoints per emitted event */
  readonly maxCheckpointsPerSpan: number;
}
