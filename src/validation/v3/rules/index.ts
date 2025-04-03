/**
 * Validation rules implementation
 */
import { ValidationRule, ValidationResult } from '../core/types';

// Export all data type validators
export * from './data-types';

// Export performance validators
export * from './performance';

/**
 * Creates a validation rule from a validation function
 */
export function rule<TValue, TContext = unknown>(
  validationFn: (value: TValue, context?: TContext) => boolean | Promise<boolean>,
  options: {
    message?: string;
    messageId?: string;
  } = {},
): ValidationRule<TValue, TContext> {
  return {
    async validate(value: TValue, context?: TContext): Promise<ValidationResult> {
      try {
        const result = await validationFn(value, context);
        return {
          pass: result,
          errors: result
            ? undefined
            : [
                {
                  message: options.message || 'Validation failed',
                  messageIds: options.messageId ? [options.messageId] : undefined,
                },
              ],
        };
      } catch (error) {
        return {
          pass: false,
          errors: [
            {
              message: (error as Error).message || 'Validation error occurred',
            },
          ],
        };
      }
    },
  };
}

/**
 * Creates a rule requiring a field to be present (not null, undefined, or empty string)
 */
export function required<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<unknown, TContext> {
  return rule<unknown, TContext>(
    value => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    },
    {
      message: options.message || 'Field is required',
      messageId: options.messageId || 'validation.required',
    },
  );
}

/**
 * Creates a rule requiring a string/array to have a minimum length
 */
export function minLength<TContext = unknown>(
  length: number,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | any[] | undefined | null, TContext> {
  return rule<string | any[] | undefined | null, TContext>(
    value => {
      if (value === undefined || value === null) return false;
      return value.length >= length;
    },
    {
      message: options.message || `Must be at least ${length} characters`,
      messageId: options.messageId || 'validation.minLength',
    },
  );
}

/**
 * Creates a rule requiring a string/array to have a maximum length
 */
export function maxLength<TContext = unknown>(
  length: number,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | any[] | undefined | null, TContext> {
  return rule<string | any[] | undefined | null, TContext>(
    value => {
      if (value === undefined || value === null) return false;
      return value.length <= length;
    },
    {
      message: options.message || `Must be at most ${length} characters`,
      messageId: options.messageId || 'validation.maxLength',
    },
  );
}

/**
 * Creates a rule requiring a string to match a pattern
 */
export function matches<TContext = unknown>(
  pattern: RegExp,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return rule<string | undefined | null, TContext>(
    value => {
      if (value === undefined || value === null) return false;
      return pattern.test(value);
    },
    {
      message: options.message || 'Must match the required pattern',
      messageId: options.messageId || 'validation.pattern',
    },
  );
}

/**
 * Creates a rule requiring a string to be a valid email
 */
export function email<TContext = unknown>(
  options: { message?: string; messageId?: string } = {},
): ValidationRule<string | undefined | null, TContext> {
  return matches<TContext>(/^[^@]+@[^@]+\.[^@]+$/, {
    message: options.message || 'Must be a valid email',
    messageId: options.messageId || 'validation.email',
  });
}

/**
 * Creates a rule requiring a value to equal a specific value
 */
export function equals<TValue, TContext = unknown>(
  compareValue: TValue,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<TValue, TContext> {
  return rule<TValue, TContext>(value => value === compareValue, {
    message: options.message || `Must equal ${String(compareValue)}`,
    messageId: options.messageId || 'validation.equals',
  });
}

/**
 * Creates a rule requiring a value to not equal a specific value
 */
export function notEquals<TValue, TContext = unknown>(
  compareValue: TValue,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<TValue, TContext> {
  return rule<TValue, TContext>(value => value !== compareValue, {
    message: options.message || `Must not equal ${String(compareValue)}`,
    messageId: options.messageId || 'validation.notEquals',
  });
}

/**
 * Creates a rule requiring a number to be at least a minimum value
 */
export function min<TContext = unknown>(
  minValue: number,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<number | undefined | null, TContext> {
  return rule<number | undefined | null, TContext>(
    value => {
      if (value === undefined || value === null) return false;
      return value >= minValue;
    },
    {
      message: options.message || `Must be at least ${minValue}`,
      messageId: options.messageId || 'validation.min',
    },
  );
}

/**
 * Creates a rule requiring a number to be at most a maximum value
 */
export function max<TContext = unknown>(
  maxValue: number,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<number | undefined | null, TContext> {
  return rule<number | undefined | null, TContext>(
    value => {
      if (value === undefined || value === null) return false;
      return value <= maxValue;
    },
    {
      message: options.message || `Must be at most ${maxValue}`,
      messageId: options.messageId || 'validation.max',
    },
  );
}

/**
 * Creates a rule requiring a value to be one of a set of allowed values
 */
export function oneOf<TValue, TContext = unknown>(
  allowedValues: ReadonlyArray<TValue>,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<TValue, TContext> {
  return rule<TValue, TContext>(value => allowedValues.includes(value), {
    message: options.message || `Must be one of: ${allowedValues.join(', ')}`,
    messageId: options.messageId || 'validation.oneOf',
  });
}

/**
 * Creates a rule requiring a value to not be one of a set of disallowed values
 */
export function notOneOf<TValue, TContext = unknown>(
  disallowedValues: ReadonlyArray<TValue>,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<TValue, TContext> {
  return rule<TValue, TContext>(value => !disallowedValues.includes(value), {
    message: options.message || `Must not be one of: ${disallowedValues.join(', ')}`,
    messageId: options.messageId || 'validation.notOneOf',
  });
}

/**
 * Creates a custom validation rule
 */
export function custom<TValue, TContext = unknown>(
  validationFn: (value: TValue, context?: TContext) => boolean | Promise<boolean>,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<TValue, TContext> {
  return rule<TValue, TContext>(validationFn, {
    message: options.message || 'Failed custom validation',
    messageId: options.messageId || 'validation.custom',
  });
}
