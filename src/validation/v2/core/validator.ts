/**
 * Core validator implementation
 * Provides the base functionality for validating values against rules
 */

import { Condition, IValidator, ValidationContext, ValidationResult, ValidationRule } from './types';

/**
 * Core validator implementation
 * Handles basic validation logic and condition evaluation
 */
export class Validator implements IValidator {
  /**
   * Creates a new validator instance
   */
  constructor() {}

  /**
   * Validates a value against a validation rule
   */
  async validate<TValue, TContext>(
    value: TValue,
    rule: ValidationRule<TValue, TContext>,
    context?: ValidationContext<TContext>,
  ): Promise<ValidationResult> {
    try {
      // Apply the validation function
      return await rule.validate(value, context);
    } catch (error) {
      // Handle unexpected errors during validation
      return {
        pass: false,
        errors: [
          {
            message: error instanceof Error ? error.message : 'Validation error',
            customMessage: 'Unexpected error during validation',
          },
        ],
      };
    }
  }

  /**
   * Validates a value against a conditional validation rule
   * Only applies the validation if the condition(s) are met
   */
  async validateConditional<TValue, TContext>(
    value: TValue,
    rule: ValidationRule<TValue, TContext>,
    context?: ValidationContext<TContext>,
  ): Promise<ValidationResult> {
    // Default result if no conditions are met
    const defaultResult: ValidationResult = { pass: true };

    // If there's a single condition, evaluate it
    if (rule.condition !== undefined) {
      const conditionMet = await this.evaluateCondition(rule.condition, value, context);

      // Only run validation if the condition is met
      if (conditionMet) {
        return this.validate(value, rule, context);
      }

      return defaultResult;
    }

    // If there are multiple conditions, evaluate them according to the scope
    if (rule.conditions?.list && rule.conditions.list.length > 0) {
      const { list, scope = 'all' } = rule.conditions;

      // Evaluate all conditions
      const results = await Promise.all(list.map(condition => this.evaluateCondition(condition, value, context)));

      let conditionsMet = false;

      switch (scope) {
        case 'all':
          // All conditions must be true
          conditionsMet = results.every(result => result);
          break;
        case 'any':
          // At least one condition must be true
          conditionsMet = results.some(result => result);
          break;
        case 'none':
          // No condition should be true
          conditionsMet = !results.some(result => result);
          break;
      }

      // Only run validation if the conditions are met according to the scope
      if (conditionsMet) {
        return this.validate(value, rule, context);
      }

      return defaultResult;
    }

    // If no conditions are specified, just run the validation
    return this.validate(value, rule, context);
  }

  /**
   * Evaluates a condition against a value
   */
  async evaluateCondition<TValue, TContext>(
    condition: Condition<TValue, TContext>,
    value: TValue,
    context?: ValidationContext<TContext>,
  ): Promise<boolean> {
    // If the condition is a string, it's a named condition
    if (typeof condition === 'string') {
      // Use the conditionMatches function if available
      if (context?.conditionMatches) {
        return context.conditionMatches(condition);
      }

      // Otherwise, check if the condition exists in the context
      if (context?.conditions && condition in context.conditions) {
        const namedCondition = context.conditions[condition];

        // If it's a function, call it
        if (typeof namedCondition === 'function') {
          return this.evaluateCondition(namedCondition as Condition<TValue, TContext>, value, context);
        }
      }

      // If the named condition can't be found or evaluated, return false
      return false;
    }

    // If the condition is a function, call it with the value and context
    if (typeof condition === 'function') {
      try {
        // Pass the context data as the second parameter to the condition function
        const contextData = context?.data as TContext | undefined;
        return await Promise.resolve(condition(value, contextData));
      } catch (error) {
        // If there's an error evaluating the condition, return false
        console.error('Error evaluating condition:', error);
        return false;
      }
    }

    // Unsupported condition type
    return false;
  }
}

/**
 * Creates a new validator instance
 */
export function createValidator(): IValidator {
  return new Validator();
}
