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
export const DECISION_BASE_PRIORITY: Readonly<Record<NoiseDecision, number>> = {
  keep: 100,
  aggregate: 50,
  fold: 40,
  downgrade: 30,
  drop: 10,
} as const;

/**
 * Priority for hard signal protection (errors, failures, critical events).
 * Rules with priority > HARD_SIGNAL_PRIORITY can override hard signal protection.
 * 
 * Example: To aggregate error events, use priority: 2000
 */
export const HARD_SIGNAL_PRIORITY = 1000;

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
 * Internal: Matched rule with its effective priority.
 */
interface MatchedRule {
  rule: NoiseRule;
  effectivePriority: number;
}

/**
 * Calculate the effective priority for a rule.
 * Uses explicit priority if provided, otherwise decision's base priority.
 */
export function getEffectivePriority(rule: NoiseRule): number {
  if (rule.priority !== undefined) {
    // Explicit priority must be positive
    if (rule.priority <= 0) {
      throw new Error(`Rule "${rule.id}" has invalid priority ${rule.priority}. Priority must be > 0.`);
    }
    return rule.priority;
  }

  // Use decision's base priority
  return DECISION_BASE_PRIORITY[ rule.decision ];
}

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
export function evaluateNoiseRules(
  event: ObservabilityEvent,
  allRules: readonly NoiseRule[],
  matchFn: (event: ObservabilityEvent, match: NoiseRule[ 'match' ]) => boolean
): NoiseEvaluationResult {
  // 1. Per-event override (absolute highest priority)
  if (event.capture?.noise) {
    return {
      decision: event.capture.noise.decision,
      ruleId: 'override',
      reason: event.capture.noise.reason || 'Per-event override',
      priority: Infinity,
      matchedRulesCount: 0,
    };
  }

  // 2. Collect all matching rules
  const matchedRules: MatchedRule[] = [];

  for (const rule of allRules) {
    // Check main match condition
    if (!matchFn(event, rule.match)) {
      continue;
    }

    // Check exception conditions - if ANY exception matches, skip this rule
    if (rule.except && rule.except.length > 0) {
      const hasMatchingException = rule.except.some(exc => matchFn(event, exc));
      if (hasMatchingException) {
        continue;
      }
    }

    // Rule matched and no exceptions - add to candidates
    matchedRules.push({
      rule,
      effectivePriority: getEffectivePriority(rule),
    });
  }

  // 3. No matching rules = keep by default
  // NOTE: Hard signal protection is handled in evaluator.ts, not here
  if (matchedRules.length === 0) {
    return {
      decision: 'keep',
      ruleId: 'default',
      reason: 'No matching rules, keep by default',
      priority: 0,
      matchedRulesCount: 0,
    };
  }

  // 4. Sort by priority (highest first) and select winner
  matchedRules.sort((a, b) => b.effectivePriority - a.effectivePriority);
  const winner = matchedRules[ 0 ];

  return {
    decision: winner.rule.decision,
    ruleId: winner.rule.id,
    reason: winner.rule.reason || `Matched rule: ${winner.rule.id}`,
    priority: winner.effectivePriority,
    matchedRulesCount: matchedRules.length,
  };
}
