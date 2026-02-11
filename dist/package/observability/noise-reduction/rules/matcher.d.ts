/**
 * Rule matching logic for noise reduction.
 */
import type { ObservabilityEvent, NoiseRuleMatch } from '../../types';
/**
 * Check if an event matches a noise rule match condition.
 *
 * All specified conditions must match for the rule to apply.
 * Undefined/missing conditions are treated as "match any".
 *
 * @param event - The observability event to check
 * @param match - The match conditions from a noise rule
 * @returns true if the event matches all specified conditions
 */
export declare function matchesRule(event: ObservabilityEvent, match: NoiseRuleMatch): boolean;
