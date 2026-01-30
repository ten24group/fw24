/**
 * Tree-based noise reduction for observability events.
 *
 * This module provides intelligent noise reduction for observability data,
 * reducing log volume while preserving critical information.
 *
 * ## Architecture
 *
 * The system uses a 4-phase tree-based approach:
 *
 * 1. **Build Tree**: Convert flat events to tree structure
 * 2. **Evaluate Decisions**: Apply noise rules to each node
 * 3. **Transform Tree**: Apply decisions (drop/fold/aggregate)
 * 4. **Flatten**: Convert back to flat array
 *
 * ## Benefits
 *
 * - **O(n) complexity**: Single pass per phase
 * - **Automatic reparenting**: No separate loops needed
 * - **Clear separation**: Each phase is independently testable
 * - **Type-safe**: Strong TypeScript types throughout
 *
 * @module noise-reduction
 */
import type { ObservabilityEvent, NoiseReductionConfig, NoiseDecision } from '../types';
import type { NoiseReductionStats } from './types';
/**
 * Result of noise reduction processing.
 */
export interface NoiseReductionResult {
    /** Events after noise reduction */
    events: ObservabilityEvent[];
    /** Statistics about what was suppressed */
    stats: NoiseReductionStats;
}
/**
 * Apply noise reduction to a batch of observability events.
 *
 * This is the main entry point for noise reduction. It processes events
 * through all four phases and returns the reduced output with statistics.
 *
 * ## Algorithm
 *
 * 1. Handle span.start events separately (OTEL compatibility)
 * 2. Build tree from remaining events
 * 3. Evaluate noise rules for all nodes
 * 4. Transform tree (apply decisions)
 * 5. Flatten tree to output
 * 6. Handle span.start based on parent decisions
 *
 * ## Performance
 *
 * - Time: O(n) where n = number of events
 * - Space: O(n) for tree structure
 *
 * @param inputEvents - Events to process
 * @param cfg - Noise reduction configuration
 * @returns Reduced events with statistics
 */
export declare function applyNoiseReduction(inputEvents: ReadonlyArray<ObservabilityEvent>, cfg: NoiseReductionConfig): NoiseReductionResult;
/**
 * Evaluate noise decision for a single event (for testing/inspection).
 *
 * This is a convenience function that evaluates rules for a single event
 * without building a tree or applying transformations.
 *
 * @param event - Event to evaluate
 * @param cfg - Noise reduction configuration
 * @returns Decision with context
 */
export declare function pickNoiseDecision(event: ObservabilityEvent, cfg: NoiseReductionConfig): {
    decision: NoiseDecision;
    ruleId: string;
    reason: string;
};
export { evaluateNoiseRules, DECISION_BASE_PRIORITY, type NoiseEvaluationResult } from './priority';
export { getBuiltinRules, clearBuiltinRulesCache } from './rules/builtins';
export type { NoiseReductionStats } from './types';
