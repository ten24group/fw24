/**
 * Priority-based noise reduction evaluation.
 *
 * Provides explicit priority handling for noise reduction rules,
 * replacing implicit "first match wins" with explicit priority resolution.
 */
import type { NoiseDecision, NoiseRule, ObservabilityEvent } from '../types';
/**
 * Base priority for each decision type.
 * Higher numbers = higher priority (harder to override).
 *
 * These priorities ensure sensible defaults:
 * - Keeping events is hard to override (high priority)
 * - Dropping events is easy to override (low priority)
 * - Aggregation/folding sit in the middle
 */
export declare const DECISION_BASE_PRIORITY: Readonly<Record<NoiseDecision, number>>;
/**
 * Result of noise reduction evaluation with full context.
 */
export interface NoiseEvaluationResult {
    /** The decision to apply */
    decision: NoiseDecision;
    /** ID of the rule that made this decision */
    ruleId: string;
    /** Human-readable reason for this decision */
    reason: string;
    /** Effective priority of the winning rule */
    priority: number;
    /** Total number of rules that matched this event */
    matchedRulesCount: number;
}
/**
 * Calculate the effective priority for a rule.
 * Uses explicit priority if provided, otherwise decision's base priority.
 */
export declare function getEffectivePriority(rule: NoiseRule): number;
/**
 * Evaluate all rules against an event and return the winning decision.
 *
 * Algorithm:
 * 1. Check per-event override (absolute highest priority)
 * 2. Check hard signals (errors/failures always kept unless overridden)
 * 3. Collect all matching rules (including exception evaluation)
 * 4. Sort by effective priority (highest first)
 * 5. Return the winning rule's decision
 *
 * @param event - The event to evaluate
 * @param allRules - All rules to consider (custom + builtin)
 * @param matchFn - Function to check if a match condition matches the event
 * @returns Evaluation result with full context
 */
export declare function evaluateNoiseRules(event: ObservabilityEvent, allRules: readonly NoiseRule[], matchFn: (event: ObservabilityEvent, match: NoiseRule['match']) => boolean): NoiseEvaluationResult;
