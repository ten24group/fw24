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
 * - Single `_absorbed` field replaces scattered checkpoints, aggregates, and summaries
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
}

/**
 * Structured data attached to an emitted event describing what was absorbed into it.
 * 
 * This is the SINGLE structure that replaces the old system's scattered checkpoints,
 * aggregate buckets, noise reduction summaries, and fold markers.
 * 
 * Design invariants:
 * - Arrays are bounded (configurable caps, enforced during absorption)
 * - All fields are optional (an event with no absorbed children has no _absorbed field)
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
  /** Maximum error entries in _absorbed.errors per emitted event */
  readonly maxErrorsPerSpan: number;
  /** Maximum causedBy links in _absorbed.causedByLinks per emitted event */
  readonly maxCausedByLinksPerSpan: number;
  /** Maximum entity IDs in _absorbed.entityIds per emitted event */
  readonly maxEntityIdsPerSpan: number;
  /** Maximum number of distinct operation keys in _absorbed.byOperation */
  readonly maxOperationKeysPerSpan: number;
}
