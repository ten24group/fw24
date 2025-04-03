/**
 * Validation conditions implementation
 */
import { ValidationRule, ConditionalRule, ConditionReference, ConditionExpression } from '../core/types';
import {
  conditionEquals,
  conditionNotEquals,
  conditionOneOf,
  conditionExists,
  conditionGreaterThan,
  conditionLessThan,
  conditionContext,
} from './condition-helpers';

// Re-export condition helper functions
export {
  conditionEquals,
  conditionNotEquals,
  conditionOneOf,
  conditionExists,
  conditionGreaterThan,
  conditionLessThan,
  conditionContext,
};

/**
 * Creates a conditional rule that applies when the condition is met
 */
export function when<TValue, TContext = unknown>(
  condition: ConditionReference<TValue, TContext>,
  rule: ValidationRule<TValue, TContext>,
): ConditionalRule<TValue, TContext> {
  return {
    rule,
    when: condition,
  };
}

/**
 * Creates a conditional rule that applies when all conditions are met
 */
export function whenAll<TValue, TContext = unknown>(
  conditions: ConditionReference<TValue, TContext>[],
  rule: ValidationRule<TValue, TContext>,
): ConditionalRule<TValue, TContext> {
  return {
    rule,
    when: { all: conditions } as ConditionExpression<TValue, TContext>,
  };
}

/**
 * Creates a conditional rule that applies when any condition is met
 */
export function whenAny<TValue, TContext = unknown>(
  conditions: ConditionReference<TValue, TContext>[],
  rule: ValidationRule<TValue, TContext>,
): ConditionalRule<TValue, TContext> {
  return {
    rule,
    when: { any: conditions } as ConditionExpression<TValue, TContext>,
  };
}

/**
 * Creates a conditional rule that applies when the condition is not met
 */
export function whenNot<TValue, TContext = unknown>(
  condition: ConditionReference<TValue, TContext>,
  rule: ValidationRule<TValue, TContext>,
): ConditionalRule<TValue, TContext> {
  return {
    rule,
    when: { not: condition } as ConditionExpression<TValue, TContext>,
  };
}
