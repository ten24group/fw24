/**
 * Rule aggregator implementation
 * Helps combine multiple validation rules into a single set
 */

import { Condition, IRuleAggregator, ValidationContext, ValidationResult, ValidationRule } from './types';

/**
 * Rule aggregator implementation
 * Allows combining multiple rules for validation
 */
export class RuleAggregator<TValue, TContext> implements IRuleAggregator<TValue, TContext> {
  private rules: ValidationRule<TValue, TContext>[] = [];

  /**
   * Creates a new rule aggregator
   */
  constructor() {}

  /**
   * Adds a rule to the aggregator
   * @param rule The rule to add
   */
  add(rule: ValidationRule<TValue, TContext>): this {
    this.rules.push(rule);
    return this;
  }

  /**
   * Adds a rule that only applies when a condition is met
   * @param condition The condition to check
   * @param rule The rule to apply when the condition is met
   */
  when(condition: Condition<TValue, TContext>, rule: ValidationRule<TValue, TContext>): this {
    this.rules.push({
      ...rule,
      condition,
    });
    return this;
  }

  /**
   * Adds a rule that applies when all conditions are met
   * @param conditions The conditions to check
   * @param rule The rule to apply when all conditions are met
   */
  whenAll(conditions: Condition<TValue, TContext>[], rule: ValidationRule<TValue, TContext>): this {
    this.rules.push({
      ...rule,
      conditions: {
        list: conditions,
        scope: 'all',
      },
    });
    return this;
  }

  /**
   * Adds a rule that applies when any condition is met
   * @param conditions The conditions to check
   * @param rule The rule to apply when any condition is met
   */
  whenAny(conditions: Condition<TValue, TContext>[], rule: ValidationRule<TValue, TContext>): this {
    this.rules.push({
      ...rule,
      conditions: {
        list: conditions,
        scope: 'any',
      },
    });
    return this;
  }

  /**
   * Adds a rule that applies when no condition is met
   * @param conditions The conditions to check
   * @param rule The rule to apply when no condition is met
   */
  whenNone(conditions: Condition<TValue, TContext>[], rule: ValidationRule<TValue, TContext>): this {
    this.rules.push({
      ...rule,
      conditions: {
        list: conditions,
        scope: 'none',
      },
    });
    return this;
  }

  /**
   * Creates a composite rule that validates against all added rules
   */
  composite(): ValidationRule<TValue, TContext> {
    const rules = this.rules;

    return {
      validate: async (value: TValue, context?: ValidationContext<TContext>): Promise<ValidationResult> => {
        const result: ValidationResult = {
          pass: true,
          errors: [],
        };

        // If there are no rules, the validation passes
        if (rules.length === 0) {
          return result;
        }

        // Apply each rule
        for (const rule of rules) {
          const ruleResult = await rule.validate(value, context);

          // If any rule fails, the validation fails
          if (!ruleResult.pass) {
            result.pass = false;

            // Collect errors if they exist
            if (ruleResult.errors) {
              if (!result.errors) {
                result.errors = [];
              }

              result.errors.push(...ruleResult.errors);
            }
          }
        }

        return result;
      },
    };
  }

  /**
   * Builds the rule set
   */
  build(): ValidationRule<TValue, TContext>[] {
    return [...this.rules];
  }
}

/**
 * Creates a new rule aggregator
 */
export function createRuleAggregator<TValue, TContext>(): RuleAggregator<TValue, TContext> {
  return new RuleAggregator<TValue, TContext>();
}
