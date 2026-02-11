/**
 * Priority-based noise reduction evaluation (v2: three-decision model).
 *
 * Provides explicit priority handling for noise reduction rules.
 * Rules are evaluated against events; highest priority match wins.
 */
import type { NoiseDecision, NoiseRule, NoiseRuleMatch, ObservabilityEvent } from '../types';
/**
 * Base priority for each decision type.
 * Higher numbers = higher priority (harder to override).
 *
 * - emit:   hard to override (you want to keep important events)
 * - absorb: middle ground (merge into parent)
 * - silent: easy to override (a keep/absorb rule can rescue events)
 */
export declare const DECISION_BASE_PRIORITY: Readonly<Record<NoiseDecision, number>>;
/**
 * Priority for hard signal protection (errors, failures, critical events).
 * Rules with priority > HARD_SIGNAL_PRIORITY can override hard signal protection.
 *
 * Example: To absorb error events intentionally, use priority: 2000
 */
export declare const HARD_SIGNAL_PRIORITY = 1000;
/**
 * Result of noise reduction evaluation with full context.
 */
export interface NoiseEvaluationResult {
    /** The decision to apply */
    readonly decision: NoiseDecision;
    /** ID of the rule that made this decision */
    readonly ruleId: string;
    /** Human-readable reason for this decision */
    readonly reason: string;
    /** Effective priority of the winning rule */
    readonly priority: number;
    /** Total number of rules that matched this event */
    readonly matchedRulesCount: number;
}
/**
 * Calculate the effective priority for a rule.
 * Uses explicit priority if provided, otherwise the decision's base priority.
 */
export declare function getEffectivePriority(rule: NoiseRule): number;
/**
 * Type for the rule matching function.
 * Decouples evaluation from the matcher implementation.
 */
export type RuleMatchFn = (event: ObservabilityEvent, match: NoiseRuleMatch) => boolean;
/**
 * Evaluate all rules against an event and return the winning decision.
 *
 * Algorithm:
 * 1. Check per-event override (absolute highest priority)
 * 2. Collect all matching rules (including exception evaluation)
 * 3. Sort by effective priority (highest first)
 * 4. Return the winning rule's decision
 *
 * NOTE: Hard signal protection is handled by the caller (algorithm.ts),
 * not inside this function. This keeps evaluation pure and testable.
 *
 * @param event - The event to evaluate
 * @param allRules - All rules to consider (custom + builtin)
 * @param matchFn - Function to check if a match condition matches the event
 * @returns Evaluation result with full context
 */
export declare function evaluateNoiseRules(event: ObservabilityEvent, allRules: readonly NoiseRule[], matchFn: RuleMatchFn): NoiseEvaluationResult;
