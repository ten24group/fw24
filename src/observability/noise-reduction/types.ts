/**
 * Internal types for tree-based noise reduction.
 * 
 * These types are used internally by the noise reduction system
 * and are not exported to external consumers.
 */

import type { ObservabilityEvent, NoiseDecision } from '../types';

/**
 * Tree node representing an observability event and its hierarchical relationships.
 * 
 * The tree structure enables efficient parent-child operations:
 * - Reparenting when parents are dropped
 * - Folding/aggregating into parents
 * - Transitive operations without separate loops
 */
export interface TreeNode {
  /** The observability event this node represents */
  readonly event: ObservabilityEvent;

  /** Parent node (undefined for roots) */
  parent?: TreeNode;

  /** Child nodes */
  readonly children: TreeNode[];

  /** Noise reduction decision for this node (evaluated in Phase 2) */
  decision?: NoiseDecision;

  /** ID of the rule that made the decision */
  ruleId?: string;

  /** Human-readable reason for the decision */
  reason?: string;

  /** Whether this node or any descendant is a hard signal (set in Phase 2.5) */
  hasHardSignalInSubtree?: boolean;
  /** Set in Phase 3 - true if this node was reparented (parent was dropped) */
  wasReparented?: boolean;

  /** Whether this node should be kept in final output (set in Phase 3) */
  kept: boolean;
}

/**
 * Result of building the event tree.
 */
export interface EventTree {
  /** Root nodes (events with no parent in this batch) */
  readonly roots: ReadonlyArray<TreeNode>;

  /** Index for fast node lookup by observabilityLogId */
  readonly nodeById: ReadonlyMap<string, TreeNode>;
}

/**
 * Statistics tracked during noise reduction.
 */
export interface NoiseReductionStats {
  /** Number of events dropped */
  dropped: number;

  /** Number of events folded into parents */
  folded: number;

  /** Number of events aggregated into parents */
  aggregated: number;

  /** Number of events downgraded (heavy fields stripped) */
  downgraded: number;

  /** Number of events kept in output */
  kept: number;

  /** Approximate bytes saved by noise reduction */
  approxBytesSaved: number;

  /** Breakdown of dropped events by type */
  droppedByType: Record<string, number>;

  /** Breakdown of dropped events by operation */
  droppedByOperation: Record<string, number>;

  /** Breakdown of folded events by type */
  foldedByType: Record<string, number>;

  /** Breakdown of folded events by operation */
  foldedByOperation: Record<string, number>;
}

/**
 * Configuration bounds for noise reduction operations.
 */
export interface NoiseReductionBounds {
  /** Maximum checkpoints per span */
  readonly maxCheckpointsPerSpan: number;

  /** Maximum aggregate keys per span */
  readonly maxAggregateKeysPerSpan: number;

  /** Maximum examples per aggregate key */
  readonly maxAggregateExamplesPerKey: number;

  /** Maximum error examples per aggregate key */
  readonly maxAggregateErrorExamplesPerKey: number;

  /** Include debug metadata in output */
  readonly includeDebugMetadata: boolean;

  /** Include examples in aggregates */
  readonly includeExamples: boolean;
}

/**
 * Example event in an aggregate bucket.
 * 
 * SMART CAPTURE: Only includes minimal identifying info for successful examples.
 * Error examples include more detail. Heavy payloads (data/attributes/context/metadata)
 * are only included in debug mode or for errors.
 */
export interface AggregateExample {
  // Core identification
  observabilityLogId: string;
  type: string;
  operation?: string;
  source?: string;
  entityName?: string;
  entityId?: string;
  durationMs?: number;
  success?: boolean;
  level: string;
  ruleId?: string;

  // Extended context (minimal, only captured when different/important)
  tags?: Record<string, string>;
  actor?: any; // Uses Actor from core types
  subType?: string;
  status?: string;
  metrics?: Record<string, number>;
  causedBy?: string;

  // Heavy payloads (only for errors or debug mode)
  data?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  relatedTraces?: string[];
}

/**
 * Error example event in an aggregate bucket.
 */
export interface AggregateErrorExample extends AggregateExample {
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Aggregate bucket for summarizing multiple similar events.
 */
export interface AggregateBucket {
  /** Total count of aggregated events */
  count: number;

  /** Count of error events */
  errorCount: number;

  /** Sum of durations */
  durationSumMs: number;

  /** Maximum duration */
  durationMaxMs: number;

  /** Example events (up to configured limit) */
  examples: AggregateExample[];

  /** Example error events (up to configured limit) */
  errorExamples: AggregateErrorExample[];

  /** Count of events per rule */
  rules: Record<string, number>;
}

/**
 * Noise reduction data attached to parent spans.
 */
export interface NoiseReductionData {
  /** Aggregate buckets by key */
  aggregates?: Record<string, AggregateBucket>;

  /** Whether aggregate data was truncated due to limits */
  aggregateTruncated?: boolean;

  /** Count of dropped child events */
  dropped?: number;

  /** Count of folded child events */
  folded?: number;

  /** Count of aggregated child events */
  aggregated?: number;

  /** Breakdown by rule ID */
  byRuleId?: Record<string, number>;

  /** Approximate bytes saved */
  approxBytesSaved?: number;

  /** Breakdown by event type */
  byType?: Record<string, number>;

  /** Breakdown by operation */
  byOperation?: Record<string, number>;

  /** Whether checkpoints were truncated due to limits */
  checkpointsTruncated?: boolean;

  /** Count of checkpoints that were truncated */
  checkpointsTruncatedCount?: number;

  /** Whether aggregate keys were truncated due to limits */
  aggregateKeysTruncated?: boolean;

  /** Whether aggregate examples were truncated due to limits */
  aggregateExamplesTruncated?: boolean;

  /** 
   * Internal: Track aggregate bucket count (avoids Object.keys() calls)
   * @internal
   */
  _bucketCount?: number;
}
