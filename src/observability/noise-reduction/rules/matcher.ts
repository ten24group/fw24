/**
 * Rule matching logic for noise reduction.
 */

import type { ObservabilityEvent, NoiseRuleMatch, ObservabilityEventType, ObservabilityLevelString } from '../../types';
import { matchesPattern } from '../../utils/pattern-utils';
import { asArray } from '../utils';

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
export function matchesRule(event: ObservabilityEvent, match: NoiseRuleMatch): boolean {
  // Type matching
  const types = asArray(match.type);
  if (types && !types.includes(event.type as ObservabilityEventType)) {
    return false;
  }

  // Level matching
  const levels = asArray(match.level);
  if (levels && !levels.includes(event.level as ObservabilityLevelString)) {
    return false;
  }

  // Operation pattern matching (supports regex)
  if (!matchesPattern(event.operation, match.operation)) {
    return false;
  }

  // Source pattern matching (supports regex)
  if (!matchesPattern(event.source, match.source)) {
    return false;
  }

  // Entity name exact matching
  if (match.entityName && event.entityName !== match.entityName) {
    return false;
  }

  // Duration minimum threshold
  if (match.minDurationMs !== undefined) {
    if (event.durationMs === undefined) return false;
    if (event.durationMs < match.minDurationMs) return false;
  }

  // Duration maximum threshold
  if (match.maxDurationMs !== undefined) {
    if (event.durationMs === undefined) return false;
    if (event.durationMs >= match.maxDurationMs) return false;
  }

  // Success status matching
  if (match.success !== undefined) {
    if (event.success === undefined) return false;
    if (event.success !== match.success) return false;
  }

  // Tag matching (all specified tags must match)
  if (match.tags) {
    for (const [ k, v ] of Object.entries(match.tags)) {
      if (!event.tags) return false;
      if (!matchesPattern(event.tags[ k ], v)) return false;
    }
  }

  // Special handling for observabilityLogId (used in tests)
  if ('observabilityLogId' in match) {
    const matchWithId = match as NoiseRuleMatch & { observabilityLogId: string };
    if (event.observabilityLogId !== matchWithId.observabilityLogId) {
      return false;
    }
  }

  return true;
}
