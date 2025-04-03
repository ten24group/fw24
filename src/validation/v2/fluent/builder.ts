/**
 * Fluent Validation Builder
 * Provides an intuitive, chainable API for building validation rules
 * Inspired by ElectroDb's query builder pattern
 */

import { ValidationRule, ValidationContext, ValidationResult } from '../core/types';
import {
  required,
  minLength,
  maxLength,
  pattern,
  email,
  numeric,
  min,
  max,
  oneOf,
  all,
  any,
  createRule,
} from '../functional/rules';

/**
 * Validation operators for string fields
 */
export class StringOperators<TContext = unknown> {
  private rules: ValidationRule<string, TContext>[] = [];

  /**
   * Requires the string to be present (not null or undefined)
   */
  required(message?: string): this {
    this.rules.push(required<string, TContext>({ message }));
    return this;
  }

  /**
   * Requires the string to have a minimum length
   */
  minLength(length: number, message?: string): this {
    this.rules.push(minLength<TContext>(length, { message }));
    return this;
  }

  /**
   * Requires the string to have a maximum length
   */
  maxLength(length: number, message?: string): this {
    this.rules.push(maxLength<TContext>(length, { message }));
    return this;
  }

  /**
   * Requires the string to be an email
   */
  email(message?: string): this {
    this.rules.push(email<TContext>({ message }));
    return this;
  }

  /**
   * Requires the string to match a pattern
   */
  matches(regex: RegExp, message?: string): this {
    this.rules.push(pattern<TContext>(regex, { message }));
    return this;
  }

  /**
   * Requires the string to be one of the specified values
   */
  oneOf(values: string[], message?: string): this {
    this.rules.push(oneOf<string, TContext>(values, { message }));
    return this;
  }

  /**
   * Add a custom validation function
   */
  custom(fn: (value: string) => boolean, message?: string): this {
    this.rules.push(createRule<string, TContext>(fn, { message }));
    return this;
  }

  /**
   * Get the built rule
   */
  build(): ValidationRule<string, TContext> {
    return all<string, TContext>(this.rules);
  }
}

/**
 * Validation operators for number fields
 */
export class NumberOperators<TContext = unknown> {
  private rules: ValidationRule<number, TContext>[] = [];

  /**
   * Requires the number to be present (not null or undefined)
   */
  required(message?: string): this {
    this.rules.push(required<number, TContext>({ message }));
    return this;
  }

  /**
   * Requires the number to be greater than or equal to the minimum
   */
  min(minimum: number, message?: string): this {
    this.rules.push(min<TContext>(minimum, { message }));
    return this;
  }

  /**
   * Requires the number to be less than or equal to the maximum
   */
  max(maximum: number, message?: string): this {
    this.rules.push(max<TContext>(maximum, { message }));
    return this;
  }

  /**
   * Requires the number to be between min and max (inclusive)
   */
  between(minimum: number, maximum: number, message?: string): this {
    this.rules.push(min<TContext>(minimum, { message: message || `Value must be at least ${minimum}` }));
    this.rules.push(max<TContext>(maximum, { message: message || `Value must be at most ${maximum}` }));
    return this;
  }

  /**
   * Requires the number to be one of the specified values
   */
  oneOf(values: number[], message?: string): this {
    this.rules.push(oneOf<number, TContext>(values, { message }));
    return this;
  }

  /**
   * Add a custom validation function
   */
  custom(fn: (value: number) => boolean, message?: string): this {
    this.rules.push(createRule<number, TContext>(fn, { message }));
    return this;
  }

  /**
   * Get the built rule
   */
  build(): ValidationRule<number, TContext> {
    return all<number, TContext>(this.rules);
  }
}

/**
 * Validation operators for array fields
 */
export class ArrayOperators<T, TContext = unknown> {
  private rules: ValidationRule<T[], TContext>[] = [];

  /**
   * Requires the array to be present (not null or undefined)
   */
  required(message?: string): this {
    this.rules.push(required<T[], TContext>({ message }));
    return this;
  }

  /**
   * Requires the array to have a minimum length
   */
  minLength(length: number, message?: string): this {
    this.rules.push(
      createRule<T[], TContext>(value => Array.isArray(value) && value.length >= length, {
        message: message || `Array must have at least ${length} items`,
      }),
    );
    return this;
  }

  /**
   * Requires the array to have a maximum length
   */
  maxLength(length: number, message?: string): this {
    this.rules.push(
      createRule<T[], TContext>(value => Array.isArray(value) && value.length <= length, {
        message: message || `Array must have at most ${length} items`,
      }),
    );
    return this;
  }

  /**
   * Requires each item in the array to pass validation
   */
  eachItem(itemRule: ValidationRule<T, TContext>, message?: string): this {
    this.rules.push(
      createRule<T[], TContext>(
        async (value, context) => {
          if (!Array.isArray(value)) return false;

          for (const item of value) {
            const result = await itemRule.validate(item, context);
            if (!result.pass) return false;
          }

          return true;
        },
        { message: message || 'All items must pass validation' },
      ),
    );
    return this;
  }

  /**
   * Add a custom validation function
   */
  custom(fn: (value: T[]) => boolean, message?: string): this {
    this.rules.push(createRule<T[], TContext>(fn, { message }));
    return this;
  }

  /**
   * Get the built rule
   */
  build(): ValidationRule<T[], TContext> {
    return all<T[], TContext>(this.rules);
  }
}

/**
 * Validation operators for boolean fields
 */
export class BooleanOperators<TContext = unknown> {
  private rules: ValidationRule<boolean, TContext>[] = [];

  /**
   * Requires the boolean to be present (not null or undefined)
   */
  required(message?: string): this {
    this.rules.push(required<boolean, TContext>({ message }));
    return this;
  }

  /**
   * Requires the boolean to be true
   */
  isTrue(message?: string): this {
    this.rules.push(
      createRule<boolean, TContext>(value => value === true, { message: message || 'Value must be true' }),
    );
    return this;
  }

  /**
   * Requires the boolean to be false
   */
  isFalse(message?: string): this {
    this.rules.push(
      createRule<boolean, TContext>(value => value === false, { message: message || 'Value must be false' }),
    );
    return this;
  }

  /**
   * Add a custom validation function
   */
  custom(fn: (value: boolean) => boolean, message?: string): this {
    this.rules.push(createRule<boolean, TContext>(fn, { message }));
    return this;
  }

  /**
   * Get the built rule
   */
  build(): ValidationRule<boolean, TContext> {
    return all<boolean, TContext>(this.rules);
  }
}

/**
 * Validation operators for object fields
 */
export class ObjectOperators<T extends object, TContext = unknown> {
  private rules: ValidationRule<T, TContext>[] = [];

  /**
   * Requires the object to be present (not null or undefined)
   */
  required(message?: string): this {
    this.rules.push(required<T, TContext>({ message }));
    return this;
  }

  /**
   * Requires the object to have specific properties
   */
  hasProperties(properties: (keyof T)[], message?: string): this {
    this.rules.push(
      createRule<T, TContext>(
        value => {
          if (!value) return false;
          return properties.every(prop => prop in value);
        },
        { message: message || `Object must have properties: ${properties.join(', ')}` },
      ),
    );
    return this;
  }

  /**
   * Add property-level validation rules
   */
  property<K extends keyof T>(
    property: K,
    validation: ((value: T[K]) => boolean) | ValidationRule<T[K], TContext>,
    message?: string,
  ): this {
    if (typeof validation === 'function') {
      this.rules.push(
        createRule<T, TContext>(
          value => {
            if (!value) return false;
            const propValue = value[property];
            return validation(propValue);
          },
          { message: message || `Invalid value for property ${String(property)}` },
        ),
      );
    } else {
      this.rules.push(
        createRule<T, TContext>(
          async (value, context) => {
            if (!value) return false;
            const propValue = value[property];
            const result = await validation.validate(propValue, context);
            return result.pass;
          },
          { message: message || `Invalid value for property ${String(property)}` },
        ),
      );
    }
    return this;
  }

  /**
   * Add a custom validation function
   */
  custom(fn: (value: T) => boolean, message?: string): this {
    this.rules.push(createRule<T, TContext>(fn, { message }));
    return this;
  }

  /**
   * Get the built rule
   */
  build(): ValidationRule<T, TContext> {
    return all<T, TContext>(this.rules);
  }
}

/**
 * Main validation builder class
 * Provides a fluent API for building validation rules
 */
export class ValidationBuilder<TContext = unknown> {
  /**
   * Create a validation rule for a string field
   */
  string(cb: (ops: StringOperators<TContext>) => void): ValidationRule<string, TContext> {
    const operators = new StringOperators<TContext>();
    cb(operators);
    return operators.build();
  }

  /**
   * Create a validation rule for a number field
   */
  number(cb: (ops: NumberOperators<TContext>) => void): ValidationRule<number, TContext> {
    const operators = new NumberOperators<TContext>();
    cb(operators);
    return operators.build();
  }

  /**
   * Create a validation rule for a boolean field
   */
  boolean(cb: (ops: BooleanOperators<TContext>) => void): ValidationRule<boolean, TContext> {
    const operators = new BooleanOperators<TContext>();
    cb(operators);
    return operators.build();
  }

  /**
   * Create a validation rule for an array field
   */
  array<T>(cb: (ops: ArrayOperators<T, TContext>) => void): ValidationRule<T[], TContext> {
    const operators = new ArrayOperators<T, TContext>();
    cb(operators);
    return operators.build();
  }

  /**
   * Create a validation rule for an object field
   */
  object<T extends object>(cb: (ops: ObjectOperators<T, TContext>) => void): ValidationRule<T, TContext> {
    const operators = new ObjectOperators<T, TContext>();
    cb(operators);
    return operators.build();
  }

  /**
   * Create a custom validation rule
   */
  custom<T>(
    validate: (value: T, context?: ValidationContext<TContext>) => boolean | Promise<boolean>,
    message?: string,
  ): ValidationRule<T, TContext> {
    return createRule<T, TContext>(validate, { message });
  }

  /**
   * Combine multiple validation rules with AND logic
   */
  all<T>(rules: ValidationRule<T, TContext>[]): ValidationRule<T, TContext> {
    return all<T, TContext>(rules);
  }

  /**
   * Combine multiple validation rules with OR logic
   */
  any<T>(rules: ValidationRule<T, TContext>[]): ValidationRule<T, TContext> {
    return any<T, TContext>(rules);
  }
}

/**
 * Factory function to create a validation builder
 */
export function validate<TContext = unknown>(): ValidationBuilder<TContext> {
  return new ValidationBuilder<TContext>();
}
