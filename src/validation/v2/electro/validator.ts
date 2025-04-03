/**
 * Direct Validation API
 * Inspired by ElectroDb's query syntax but works directly with functions
 */

import { ValidationRule, ValidationResult, ValidationContext } from '../core/types';

/**
 * Validation condition type
 */
type Condition<T, TContext = unknown> = (value: T, context?: TContext) => boolean | Promise<boolean>;

/**
 * Logical operators for combining conditions
 */
export type LogicalOperator = 'AND' | 'OR';

/**
 * Validation builder that provides a clean, declarative API
 */
export class ValidationBuilder<T, TContext = unknown> {
  private conditions: Condition<T, TContext>[] = [];
  private currentLogicalOp: LogicalOperator = 'AND';

  /**
   * Add a condition to the validation chain with AND logic
   */
  where(condition: Condition<T, TContext>): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * Start an OR chain of conditions
   */
  or(): this {
    this.currentLogicalOp = 'OR';
    return this;
  }

  /**
   * Start an AND chain of conditions
   */
  and(): this {
    this.currentLogicalOp = 'AND';
    return this;
  }

  /**
   * Build the validation rule
   */
  build(): ValidationRule<T, TContext> {
    const conditions = [...this.conditions];
    const finalLogicalOp = this.currentLogicalOp;

    return {
      async validate(value: T, context?: ValidationContext<TContext>): Promise<ValidationResult> {
        try {
          // Execute all conditions with the appropriate logical operator
          let valid = finalLogicalOp === 'AND';

          for (const condition of conditions) {
            const contextValue = context?.context as TContext | undefined;
            const result = await condition(value, contextValue);

            if (finalLogicalOp === 'AND') {
              if (!result) {
                valid = false;
                break;
              }
            } else if (finalLogicalOp === 'OR') {
              if (result) {
                valid = true;
                break;
              }
            }
          }

          return {
            pass: valid,
            errors: valid ? undefined : [{ message: 'Validation failed' }],
          };
        } catch (error) {
          return {
            pass: false,
            errors: [{ message: (error as Error).message || 'Error during validation' }],
          };
        }
      },
    };
  }
}

/**
 * Property selector for type-safe property access
 */
export class PropertySelector<T, P> {
  constructor(private readonly property: keyof T) {}

  /**
   * Get the value of the property from an object
   */
  getValue(obj: T): P {
    return obj[this.property] as unknown as P;
  }

  /**
   * Get the property name
   */
  getKey(): string {
    return String(this.property);
  }
}

/**
 * Validation operators for different types
 */
export class Operators<T, TContext = unknown> {
  /**
   * Check if a value equals the expected value
   */
  eq(selector: keyof T, value: any): Condition<T, TContext> {
    return obj => obj[selector] === value;
  }

  /**
   * Check if a value exists (not null or undefined)
   */
  exists(selector: keyof T): Condition<T, TContext> {
    return obj => {
      const value = obj[selector];
      return value !== null && value !== undefined;
    };
  }

  /**
   * Check if a string value matches a pattern
   */
  matches(selector: keyof T, pattern: RegExp): Condition<T, TContext> {
    return obj => {
      const value = obj[selector];
      return typeof value === 'string' && pattern.test(value);
    };
  }

  /**
   * Check if a number value is greater than the expected value
   */
  gt(selector: keyof T, value: number): Condition<T, TContext> {
    return obj => {
      const objValue = obj[selector];
      return typeof objValue === 'number' && objValue > value;
    };
  }

  /**
   * Check if a number value is less than the expected value
   */
  lt(selector: keyof T, value: number): Condition<T, TContext> {
    return obj => {
      const objValue = obj[selector];
      return typeof objValue === 'number' && objValue < value;
    };
  }

  /**
   * Check if a number value is between min and max (inclusive)
   */
  between(selector: keyof T, min: number, max: number): Condition<T, TContext> {
    return obj => {
      const value = obj[selector];
      return typeof value === 'number' && value >= min && value <= max;
    };
  }

  /**
   * Check if a value is one of the specified values
   */
  oneOf(selector: keyof T, values: any[]): Condition<T, TContext> {
    return obj => {
      const value = obj[selector];
      return values.includes(value);
    };
  }

  /**
   * Custom validation function
   */
  custom(selector: keyof T, fn: (value: any, context?: TContext) => boolean): Condition<T, TContext> {
    return (obj, context) => {
      const value = obj[selector];
      return fn(value, context);
    };
  }

  /**
   * Combine multiple conditions with AND logic
   */
  and(...conditions: Condition<T, TContext>[]): Condition<T, TContext> {
    return async (obj, context) => {
      for (const condition of conditions) {
        if (!(await condition(obj, context))) {
          return false;
        }
      }
      return true;
    };
  }

  /**
   * Combine multiple conditions with OR logic
   */
  or(...conditions: Condition<T, TContext>[]): Condition<T, TContext> {
    return async (obj, context) => {
      for (const condition of conditions) {
        if (await condition(obj, context)) {
          return true;
        }
      }
      return false;
    };
  }
}

/**
 * Create a validation builder with property access and operators
 */
export function validate<T extends object, TContext = unknown>(): {
  where: (
    conditionFn: (obj: T, ops: Operators<T, TContext>) => Condition<T, TContext>,
  ) => ValidationBuilder<T, TContext>;
} {
  const ops = new Operators<T, TContext>();

  return {
    where: conditionFn => {
      const builder = new ValidationBuilder<T, TContext>();
      const condition = conditionFn({} as T, ops);
      return builder.where(condition);
    },
  };
}
