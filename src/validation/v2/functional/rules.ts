/**
 * Functional validation rules
 * Provides a set of ready-to-use validation rules based on functions
 */

import { ValidationContext, ValidationResult, ValidationRule } from '../core/types';

/**
 * Options for creating validation rules
 */
export interface RuleOptions<TValue, TContext = unknown> {
  /** Custom error message */
  message?: string;

  /** Message ID for internationalization */
  messageId?: string;

  /** Expected value for error reporting */
  expected?: [name: string, value: unknown];

  /** Validation function */
  validate?: (value: TValue, context?: ValidationContext<TContext>) => boolean | Promise<boolean>;
}

/**
 * Creates a validation rule from a validation function
 */
export function createRule<TValue, TContext = unknown>(
  validateFn: (value: TValue, context?: ValidationContext<TContext>) => boolean | Promise<boolean>,
  options: RuleOptions<TValue, TContext> = {},
): ValidationRule<TValue, TContext> {
  return {
    validate: async (value: TValue, context?: ValidationContext<TContext>): Promise<ValidationResult> => {
      try {
        const pass = await Promise.resolve(validateFn(value, context));

        if (pass) {
          return { pass: true };
        }

        return {
          pass: false,
          errors: [
            {
              message: options.message,
              messageIds: options.messageId ? [options.messageId] : undefined,
              expected: options.expected,
              received: [value],
            },
          ],
        };
      } catch (error) {
        return {
          pass: false,
          errors: [
            {
              message: error instanceof Error ? error.message : 'Validation error',
              received: [value],
            },
          ],
        };
      }
    },
    message: options.message,
    messageId: options.messageId,
  };
}

/**
 * Creates a validation rule from a custom function
 */
export function custom<TValue, TContext = unknown>(
  fn: (value: TValue, context?: ValidationContext<TContext>) => boolean | Promise<boolean>,
  options: RuleOptions<TValue, TContext> = {},
): ValidationRule<TValue, TContext> {
  return createRule(fn, {
    message: options.message || 'Custom validation failed',
    messageId: options.messageId || 'validation.error.custom',
    ...options,
  });
}

/**
 * Creates a validation rule that requires a value to be present (not undefined or null)
 */
export function required<TValue, TContext = unknown>(
  options: RuleOptions<TValue, TContext> = {},
): ValidationRule<TValue, TContext> {
  return createRule((value: TValue) => value !== undefined && value !== null, {
    message: options.message || 'Value is required',
    messageId: options.messageId || 'validation.error.required',
    ...options,
  });
}

/**
 * Creates a validation rule that requires a string to have a minimum length
 */
export function minLength<TContext = unknown>(
  min: number,
  options: RuleOptions<string, TContext> = {},
): ValidationRule<string, TContext> {
  return createRule(
    (value: string) => {
      if (value === undefined || value === null) return true;
      return typeof value === 'string' && value.length >= min;
    },
    {
      message: options.message || `Value must be at least ${min} characters long`,
      messageId: options.messageId || 'validation.error.minLength',
      expected: ['minLength', min],
      ...options,
    },
  );
}

/**
 * Creates a validation rule that requires a string to have a maximum length
 */
export function maxLength<TContext = unknown>(
  max: number,
  options: RuleOptions<string, TContext> = {},
): ValidationRule<string, TContext> {
  return createRule(
    (value: string) => {
      if (value === undefined || value === null) return true;
      return typeof value === 'string' && value.length <= max;
    },
    {
      message: options.message || `Value must be at most ${max} characters long`,
      messageId: options.messageId || 'validation.error.maxLength',
      expected: ['maxLength', max],
      ...options,
    },
  );
}

/**
 * Creates a validation rule that requires a value to match a pattern
 */
export function pattern<TContext = unknown>(
  regex: RegExp,
  options: RuleOptions<string, TContext> = {},
): ValidationRule<string, TContext> {
  return createRule(
    (value: string) => {
      if (value === undefined || value === null) return true;
      return typeof value === 'string' && regex.test(value);
    },
    {
      message: options.message || `Value must match pattern ${regex}`,
      messageId: options.messageId || 'validation.error.pattern',
      expected: ['pattern', regex.toString()],
      ...options,
    },
  );
}

/**
 * Creates a validation rule that requires a value to be an email address
 */
export function email<TContext = unknown>(
  options: RuleOptions<string, TContext> = {},
): ValidationRule<string, TContext> {
  const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

  return pattern(emailPattern, {
    message: options.message || 'Value must be a valid email address',
    messageId: options.messageId || 'validation.error.email',
    ...options,
  });
}

/**
 * Creates a validation rule that requires a value to be a number
 */
export function numeric<TContext = unknown>(
  options: RuleOptions<unknown, TContext> = {},
): ValidationRule<unknown, TContext> {
  return createRule(
    (value: unknown) => {
      if (value === undefined || value === null) return true;
      return typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)));
    },
    {
      message: options.message || 'Value must be a number',
      messageId: options.messageId || 'validation.error.numeric',
      ...options,
    },
  );
}

/**
 * Creates a validation rule that requires a number to be greater than a minimum value
 */
export function min<TContext = unknown>(
  minimum: number,
  options: RuleOptions<number | string, TContext> = {},
): ValidationRule<number | string, TContext> {
  return createRule(
    (value: number | string) => {
      if (value === undefined || value === null) return true;
      const numValue = typeof value === 'string' ? Number(value) : value;
      return typeof numValue === 'number' && !isNaN(numValue) && numValue >= minimum;
    },
    {
      message: options.message || `Value must be at least ${minimum}`,
      messageId: options.messageId || 'validation.error.min',
      expected: ['min', minimum],
      ...options,
    },
  );
}

/**
 * Creates a validation rule that requires a number to be less than a maximum value
 */
export function max<TContext = unknown>(
  maximum: number,
  options: RuleOptions<number | string, TContext> = {},
): ValidationRule<number | string, TContext> {
  return createRule(
    (value: number | string) => {
      if (value === undefined || value === null) return true;
      const numValue = typeof value === 'string' ? Number(value) : value;
      return typeof numValue === 'number' && !isNaN(numValue) && numValue <= maximum;
    },
    {
      message: options.message || `Value must be at most ${maximum}`,
      messageId: options.messageId || 'validation.error.max',
      expected: ['max', maximum],
      ...options,
    },
  );
}

/**
 * Creates a validation rule that validates that a value is one of a set of allowed values
 */
export function oneOf<TValue, TContext = unknown>(
  allowedValues: TValue[],
  options: RuleOptions<TValue, TContext> = {},
): ValidationRule<TValue, TContext> {
  return createRule(
    (value: TValue) => {
      if (value === undefined || value === null) return true;
      return allowedValues.includes(value);
    },
    {
      message: options.message || `Value must be one of: ${allowedValues.join(', ')}`,
      messageId: options.messageId || 'validation.error.oneOf',
      expected: ['oneOf', allowedValues],
      ...options,
    },
  );
}

/**
 * Creates a validation rule that combines multiple rules
 */
export function all<TValue, TContext = unknown>(
  rules: ValidationRule<TValue, TContext>[],
  options: RuleOptions<TValue, TContext> = {},
): ValidationRule<TValue, TContext> {
  return {
    validate: async (value: TValue, context?: ValidationContext<TContext>): Promise<ValidationResult> => {
      const errors = [];

      for (const rule of rules) {
        const result = await rule.validate(value, context);

        if (!result.pass && result.errors) {
          errors.push(...result.errors);
        }
      }

      return {
        pass: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
    message: options.message,
    messageId: options.messageId,
  };
}

/**
 * Creates a validation rule that passes if any of the rules pass
 */
export function any<TValue, TContext = unknown>(
  rules: ValidationRule<TValue, TContext>[],
  options: RuleOptions<TValue, TContext> = {},
): ValidationRule<TValue, TContext> {
  return {
    validate: async (value: TValue, context?: ValidationContext<TContext>): Promise<ValidationResult> => {
      const errors = [];

      for (const rule of rules) {
        const result = await rule.validate(value, context);

        if (result.pass) {
          return { pass: true };
        }

        if (result.errors) {
          errors.push(...result.errors);
        }
      }

      return {
        pass: false,
        errors: errors.length > 0 ? errors : [{ message: options.message || 'None of the validation rules passed' }],
      };
    },
    message: options.message,
    messageId: options.messageId,
  };
}
