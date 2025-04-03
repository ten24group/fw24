/**
 * Simple, lightweight validation system that uses functions directly
 * Much less verbose than the fluent API, inspired by ElectroDb's approach
 */

import { ValidationRule, ValidationContext, ValidationResult } from '../core/types';

// Function-based Validator type
export type ValidatorFn<T, TContext = unknown> = (
  value: T,
  context?: TContext,
) => boolean | Promise<boolean> | ValidationResult | Promise<ValidationResult>;

// Extended ValidationResult with support for custom error messages
export interface ExtendedValidationResult extends ValidationResult {
  message?: string;
  errors?: Record<string | number, string>;
}

// Simple factory for creating validation rules
export function rule<T, TContext = unknown>(
  validatorFn: ValidatorFn<T, TContext>,
  options: { message?: string } = {},
): ValidationRule<T, TContext> {
  return {
    async validate(value: T, context?: ValidationContext<TContext>): Promise<ValidationResult> {
      try {
        const contextValue = context?.context;
        const result = await validatorFn(value, contextValue);

        if (typeof result === 'boolean') {
          return {
            pass: result,
            errors: result ? undefined : { _error: options.message || 'Validation failed' },
          };
        }

        // Handle ExtendedValidationResult
        const extResult = result as ExtendedValidationResult;
        return {
          pass: extResult.pass,
          errors: extResult.pass
            ? undefined
            : extResult.errors ||
              (extResult.message ? { _error: extResult.message } : undefined) || {
                _error: options.message || 'Validation failed',
              },
        };
      } catch (error) {
        return {
          pass: false,
          errors: { _error: (error as Error).message || options.message || 'Validation error occurred' },
        };
      }
    },
  };
}

// Schema type for object validation
export type Schema<T extends object> = {
  [K in keyof T]?: ValidatorFn<T[K]> | ValidationRule<T[K]>;
};

// Object validation factory
export function schema<T extends object, TContext = unknown>(schemaObj: Schema<T>): ValidationRule<T, TContext> {
  return {
    async validate(value: T, context?: ValidationContext<TContext>): Promise<ValidationResult> {
      if (!value || typeof value !== 'object') {
        return { pass: false, errors: { _error: 'Expected an object' } };
      }

      const errors: Record<string, string> = {};
      let hasErrors = false;

      // Process each field in the schema
      for (const [field, validator] of Object.entries(schemaObj)) {
        if (!validator) continue;

        const fieldValue = value[field as keyof T];

        let result: ValidationResult;
        if (typeof validator === 'function') {
          const validationResult = await validator(fieldValue, context?.context);
          if (typeof validationResult === 'boolean') {
            result = {
              pass: validationResult,
              errors: validationResult ? undefined : { _error: `Invalid value for ${field}` },
            };
          } else {
            result = validationResult as ValidationResult;
          }
        } else {
          result = await validator.validate(fieldValue, context);
        }

        if (!result.pass) {
          hasErrors = true;
          const errorMessage = result.errors?._error || `Invalid value for ${field}`;
          errors[field] = errorMessage;
        }
      }

      return {
        pass: !hasErrors,
        errors: hasErrors ? errors : undefined,
      };
    },
  };
}

// Common validation utilities
export const is = {
  required: <T, TContext = unknown>(message?: string) =>
    rule<T, TContext>(value => value !== null && value !== undefined, { message }),

  email: <TContext = unknown>(message?: string) =>
    rule<string, TContext>(value => typeof value === 'string' && /^[^@]+@[^@]+\.[^@]+$/.test(value), {
      message: message || 'Invalid email format',
    }),

  minLength: <TContext = unknown>(min: number, message?: string) =>
    rule<string, TContext>(value => typeof value === 'string' && value.length >= min, {
      message: message || `Minimum length is ${min} characters`,
    }),

  maxLength: <TContext = unknown>(max: number, message?: string) =>
    rule<string, TContext>(value => typeof value === 'string' && value.length <= max, {
      message: message || `Maximum length is ${max} characters`,
    }),

  pattern: <TContext = unknown>(regex: RegExp, message?: string) =>
    rule<string, TContext>(value => typeof value === 'string' && regex.test(value), {
      message: message || 'Value does not match pattern',
    }),

  min: <TContext = unknown>(min: number, message?: string) =>
    rule<number, TContext>(value => typeof value === 'number' && value >= min, {
      message: message || `Value must be at least ${min}`,
    }),

  max: <TContext = unknown>(max: number, message?: string) =>
    rule<number, TContext>(value => typeof value === 'number' && value <= max, {
      message: message || `Value must be at most ${max}`,
    }),

  oneOf: <T, TContext = unknown>(values: T[], message?: string) =>
    rule<T, TContext>(value => values.includes(value), {
      message: message || `Value must be one of: ${values.join(', ')}`,
    }),

  boolean: <TContext = unknown>(expected: boolean, message?: string) =>
    rule<boolean, TContext>(value => value === expected, { message: message || `Value must be ${expected}` }),

  array: <T, TContext = unknown>(
    itemValidator?: ValidatorFn<T, TContext> | ValidationRule<T, TContext>,
    message?: string,
  ) =>
    rule<T[], TContext>(async (value, context) => {
      if (!Array.isArray(value)) {
        return { pass: false, message: message || 'Value must be an array' };
      }

      if (!itemValidator) {
        return { pass: true };
      }

      const errors: Record<number, string> = {};
      let hasErrors = false;

      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        let result: ValidationResult;

        if (typeof itemValidator === 'function') {
          const validationResult = await itemValidator(item, context);
          if (typeof validationResult === 'boolean') {
            result = { pass: validationResult };
          } else {
            result = validationResult as ValidationResult;
          }
        } else {
          result = await itemValidator.validate(item, { context });
        }

        if (!result.pass) {
          hasErrors = true;
          errors[i] = result.errors?._error || `Invalid item at index ${i}`;
        }
      }

      return {
        pass: !hasErrors,
        message: hasErrors ? message || 'Some array items failed validation' : undefined,
        errors: hasErrors ? errors : undefined,
      };
    }),
};

// Helper for combining multiple validation rules with AND logic
export function all<T, TContext = unknown>(
  validators: (ValidatorFn<T, TContext> | ValidationRule<T, TContext>)[],
): ValidationRule<T, TContext> {
  return {
    async validate(value: T, context?: ValidationContext<TContext>): Promise<ValidationResult> {
      const errors: string[] = [];

      for (const validator of validators) {
        let result: ValidationResult;

        if (typeof validator === 'function') {
          const validationResult = await validator(value, context?.context);
          if (typeof validationResult === 'boolean') {
            result = { pass: validationResult };
          } else {
            result = validationResult as ValidationResult;
          }
        } else {
          result = await validator.validate(value, context);
        }

        if (!result.pass) {
          errors.push(result.errors?._error || 'Validation failed');
        }
      }

      return {
        pass: errors.length === 0,
        errors: errors.length > 0 ? { _error: errors.join('; ') } : undefined,
      };
    },
  };
}

// Helper for combining multiple validation rules with OR logic
export function any<T, TContext = unknown>(
  validators: (ValidatorFn<T, TContext> | ValidationRule<T, TContext>)[],
): ValidationRule<T, TContext> {
  return {
    async validate(value: T, context?: ValidationContext<TContext>): Promise<ValidationResult> {
      if (validators.length === 0) {
        return { pass: true };
      }

      const errors: string[] = [];

      for (const validator of validators) {
        let result: ValidationResult;

        if (typeof validator === 'function') {
          const validationResult = await validator(value, context?.context);
          if (typeof validationResult === 'boolean') {
            result = { pass: validationResult };
          } else {
            result = validationResult as ValidationResult;
          }
        } else {
          result = await validator.validate(value, context);
        }

        if (result.pass) {
          return { pass: true };
        }

        errors.push(result.errors?._error || 'Validation failed');
      }

      return {
        pass: false,
        errors: { _error: `All validations failed: ${errors.join('; ')}` },
      };
    },
  };
}
