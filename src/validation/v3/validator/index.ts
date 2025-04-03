/**
 * Core validator implementation
 */
import {
  ValidationRule,
  ValidationResult,
  ValidationError,
  ConditionalRule,
  ConditionReference,
  ConditionExpression,
  NamedConditions,
} from '../core/types';

// Export nested validation functions
export * from './nested';

/**
 * Validation schema containing rules and conditions
 */
export interface ValidationSchema<TValue, TContext = unknown> {
  /**
   * Validation rules for object fields
   */
  fields: {
    [K in keyof Partial<TValue>]: ValidationRule<TValue[K], TContext> | ConditionalRule<TValue[K], TContext>;
  };

  /**
   * Named conditions for reuse within this schema
   */
  conditions?: NamedConditions<TValue, TContext>;
}

/**
 * Options for validation
 */
export interface ValidateOptions {
  /** Whether to collect errors rather than stopping at first failure */
  collectErrors?: boolean;
  /** Whether to include detailed error information */
  verboseErrors?: boolean;
  /** Custom error messages by message ID */
  overriddenErrorMessages?: Record<string, string>;
}

/**
 * Core validator implementation
 */
export class Validator {
  /**
   * Validates a value against a schema
   *
   * @param data The data to validate
   * @param schema The validation schema
   * @param context Optional validation context
   * @param options Validation options
   */
  async validate<TValue, TContext = unknown>(
    data: TValue,
    schema: ValidationSchema<TValue, TContext>,
    context?: TContext,
    options: ValidateOptions = {},
  ): Promise<ValidationResult> {
    const { collectErrors = true, verboseErrors = true, overriddenErrorMessages = {} } = options;

    // Return early if schema is empty
    if (!schema || !schema.fields) {
      return { pass: true };
    }

    let allPass = true;
    const errors: ValidationError[] = [];

    // Validate each field
    for (const [fieldName, fieldRule] of Object.entries(schema.fields)) {
      if (!fieldRule) continue;

      const fieldValue = data[fieldName as keyof TValue];

      // Check if it's a conditional rule
      if (this.isConditionalRule(fieldRule)) {
        const { rule: validationRule, when: condition } = fieldRule;

        // Evaluate condition to determine if rule should be applied
        const shouldApply = await this.evaluateCondition(condition, data, schema.conditions || {}, context);

        // Apply rule if condition passes
        if (shouldApply) {
          // We pass the current data as parent in the context for dependency validation
          const augmentedContext = context ? { ...context, parent: data } : ({ parent: data } as unknown as TContext);

          const result = await this.validateField(fieldValue, validationRule, augmentedContext);

          if (!result.pass) {
            allPass = false;

            if (collectErrors && result.errors?.length) {
              errors.push(
                ...result.errors.map(err => ({
                  ...err,
                  field: fieldName,
                  path: err.path ? [fieldName, ...err.path] : [fieldName],
                })),
              );
            } else if (!collectErrors) {
              // Break early if not collecting all errors
              return {
                pass: false,
                errors: result.errors?.map(err => ({
                  ...err,
                  field: fieldName,
                  path: err.path ? [fieldName, ...err.path] : [fieldName],
                })),
              };
            }
          }
        }
      }
      // Handle regular rule
      else if (typeof fieldRule === 'object' && fieldRule !== null && 'validate' in fieldRule) {
        // Type assertion to ValidationRule if it has validate method
        const validationRule = fieldRule as ValidationRule<any, TContext>;

        // We pass the current data as parent in the context for dependency validation
        const augmentedContext = context ? { ...context, parent: data } : ({ parent: data } as unknown as TContext);

        const result = await this.validateField(fieldValue, validationRule, augmentedContext);

        if (!result.pass) {
          allPass = false;

          if (collectErrors && result.errors?.length) {
            errors.push(
              ...result.errors.map(err => ({
                ...err,
                field: fieldName,
                path: err.path ? [fieldName, ...err.path] : [fieldName],
              })),
            );
          } else if (!collectErrors) {
            // Break early if not collecting all errors
            return {
              pass: false,
              errors: result.errors?.map(err => ({
                ...err,
                field: fieldName,
                path: err.path ? [fieldName, ...err.path] : [fieldName],
              })),
            };
          }
        }
      }
      // Skip empty objects or invalid rules
      else {
        console.warn(`Invalid validation rule for field "${fieldName}". Rule does not have a validate method.`);
      }
    }

    // Apply custom error messages if provided
    if (overriddenErrorMessages && errors.length > 0) {
      for (const error of errors) {
        if (error.messageIds?.length) {
          for (const id of error.messageIds) {
            if (overriddenErrorMessages[id]) {
              error.message = overriddenErrorMessages[id];
              break;
            }
          }
        }
      }
    }

    return {
      pass: allPass,
      errors:
        errors.length > 0
          ? verboseErrors
            ? errors
            : errors.map(e => ({
                path: e.path,
                message: e.message,
              }))
          : undefined,
    };
  }

  /**
   * Determines if a rule is a conditional rule
   * Using a type guard to check object structure
   */
  private isConditionalRule(rule: unknown): rule is ConditionalRule<any, any> {
    return !!rule && typeof rule === 'object' && rule !== null && 'rule' in rule && 'when' in rule;
  }

  /**
   * Evaluates a condition to determine if a rule should be applied
   */
  private async evaluateCondition<TValue, TContext>(
    condition: ConditionReference<TValue, TContext> | undefined,
    data: TValue,
    namedConditions: NamedConditions<TValue, TContext>,
    context?: TContext,
  ): Promise<boolean> {
    // If no condition, always apply the rule
    if (!condition) return true;

    // String reference to a named condition
    if (typeof condition === 'string') {
      const namedCondition = namedConditions[condition];
      if (!namedCondition) {
        console.warn(`Named condition "${condition}" not found`);
        return false;
      }

      return namedCondition(data, context);
    }

    // Function condition
    if (typeof condition === 'function') {
      return condition(data, context);
    }

    // Condition expression object
    const expr = condition as ConditionExpression<TValue, TContext>;

    // AND condition
    if (expr.all && Array.isArray(expr.all)) {
      for (const cond of expr.all) {
        if (!(await this.evaluateCondition(cond, data, namedConditions, context))) {
          return false;
        }
      }
      return true;
    }

    // OR condition
    if (expr.any && Array.isArray(expr.any)) {
      for (const cond of expr.any) {
        if (await this.evaluateCondition(cond, data, namedConditions, context)) {
          return true;
        }
      }
      return false;
    }

    // NOT condition
    if (expr.not !== undefined) {
      const result = await this.evaluateCondition(expr.not, data, namedConditions, context);
      return !result;
    }

    return false;
  }

  /**
   * Validates a field against a rule
   */
  private async validateField<TValue, TContext>(
    value: TValue,
    rule: ValidationRule<TValue, TContext>,
    context?: TContext,
  ): Promise<ValidationResult> {
    return rule.validate(value, context);
  }
}
