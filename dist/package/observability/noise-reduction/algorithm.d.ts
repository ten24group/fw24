/**
 * Noise Reduction Algorithm (v2: single DFS, no tree mutation)
 *
 * Three-phase approach:
 * 1. BUILD: Flat events → tree (parentObservabilityLogId linkage)
 * 2. EVALUATE: Post-order DFS assigns emit/absorb/silent to each node
 * 3. COLLECT: Pre-order DFS builds output with resolved parent IDs and absorbed data
 * 4. STRIP: Promoted (noise) roots are removed; genuine children become new roots
 *
 * Key invariants:
 * - The tree is NEVER mutated (no reparenting, no child moving)
 * - Decisions are recorded as separate properties on nodes
 * - Parent IDs in output resolve to the nearest EMITTED ancestor
 * - Absorbed data flows to the nearest EMITTED ancestor
 * - Hard signals force emit (unless explicitly overridden by high-priority rule)
 * - Noise roots (silent/absorbed with no emitted ancestor) are ALWAYS stripped:
 *   - If ALL events are noise → entire invocation is suppressed (0 output)
 *   - If SOME events are genuine → noise roots stripped, genuine children kept as new roots
 */
import type { ObservabilityEvent, NoiseReductionConfig } from '../types';
import type { TreeNode, NoiseReductionResult } from './types';
/**
 * Apply noise reduction to a batch of observability events.
 *
 * This is the core algorithm. It processes events through three phases:
 * 1. Build tree from flat events (parentObservabilityLogId linkage)
 * 2. Evaluate decisions via post-order DFS (rules + hard signals)
 * 3. Collect output via pre-order DFS (resolved parents + absorbed data)
 *
 * span.start events are handled separately: they follow the decision of their
 * corresponding consolidated span (same observabilityLogId).
 *
 * @param inputEvents - Raw events from the invocation buffer
 * @param config - Noise reduction configuration
 * @returns Reduced events with resolved parent IDs and absorbed data
 */
export declare function applyNoiseReduction(inputEvents: readonly ObservabilityEvent[], config: NoiseReductionConfig): NoiseReductionResult;
/**
 * Evaluate noise decision for a single event (for testing/inspection).
 *
 * This evaluates rules for a single event without building a tree.
 * Does NOT apply hard signal logic or context preservation.
 *
 * @param event - Event to evaluate
 * @param config - Noise reduction configuration
 * @returns Decision with context
 */
export declare function pickNoiseDecision(event: ObservabilityEvent, config: NoiseReductionConfig): {
    readonly decision: string;
    readonly ruleId: string;
    readonly reason: string;
};
/**
 * Get the tree built from events (for testing/inspection).
 * Returns the tree nodes with their evaluations but without collecting output.
 */
export declare function buildAndEvaluate(inputEvents: readonly ObservabilityEvent[], config: NoiseReductionConfig): {
    readonly roots: readonly TreeNode[];
    readonly nodeById: ReadonlyMap<string, TreeNode>;
};
