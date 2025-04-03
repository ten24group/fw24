/**
 * Nested object validation implementation
 */
import { ValidationRule, ValidationResult, ValidationError } from '../core/types';
import { ValidationSchema, Validator } from './index';

/**
 * Gets a nested property from an object using a path
 */
export function getNestedProperty(obj: any, path: string | string[]): any {
  if (!obj) return undefined;

  const parts = Array.isArray(path) ? path : path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Sets a nested property in an object using a path
 */
export function setNestedProperty(obj: any, path: string | string[], value: any): void {
  if (!obj) return;

  const parts = Array.isArray(path) ? path : path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      // Create object or array based on next key
      const nextKey = parts[i + 1];
      current[part] = !isNaN(Number(nextKey)) && nextKey !== '' ? [] : {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Validation rule for a nested object
 */
export function nested<TValue, TNestedValue, TContext = unknown>(
  path: string | string[],
  schema: ValidationSchema<TNestedValue, TContext>,
  options: {
    message?: string;
    messageId?: string;
    required?: boolean;
  } = {},
): ValidationRule<TValue, TContext> {
  const validator = new Validator();
  const { required: isRequired = true } = options;

  return {
    async validate(value: TValue, context?: TContext): Promise<ValidationResult> {
      const pathArr = Array.isArray(path) ? path : path.split('.');
      // Special case for empty path (direct validation)
      const nestedValue =
        pathArr.length === 1 && pathArr[0] === ''
          ? (value as unknown as TNestedValue)
          : getNestedProperty(value, pathArr);

      if (nestedValue === undefined || nestedValue === null) {
        // If not required, pass validation
        if (!isRequired) {
          return { pass: true };
        }

        return {
          pass: false,
          errors: [
            {
              path: pathArr.length === 1 && pathArr[0] === '' ? [] : pathArr,
              message: options.message || 'Nested value is required',
              messageIds: options.messageId ? [options.messageId] : ['validation.nested.required'],
            },
          ],
        };
      }

      // Validate nested object using schema
      const result = await validator.validate(nestedValue, schema, context);

      // Prefix all error paths with the nested path
      if (!result.pass && result.errors) {
        const prefixedErrors = result.errors.map(error => ({
          ...error,
          // Only add path prefix if path is not empty
          path: pathArr.length === 1 && pathArr[0] === '' ? error.path : [...pathArr, ...(error.path || [])],
        }));

        return {
          pass: false,
          errors: prefixedErrors,
        };
      }

      return result;
    },
  };
}

/**
 * Validation rule for each item in an array
 */
export function eachItem<TItem, TContext = unknown>(
  itemRule: ValidationRule<TItem, TContext>,
  options: {
    stopOnFirstError?: boolean;
    message?: string;
    messageId?: string;
    required?: boolean;
  } = {},
): ValidationRule<TItem[] | undefined | null, TContext> {
  const { required: isRequired = false } = options;

  return {
    async validate(value: TItem[] | undefined | null, context?: TContext): Promise<ValidationResult> {
      if (!value || !Array.isArray(value)) {
        // If array is not required, pass validation when undefined
        if (!isRequired && (value === undefined || value === null)) {
          return { pass: true };
        }

        return {
          pass: false,
          errors: [
            {
              message: options.message || 'Expected an array',
              messageIds: options.messageId ? [options.messageId] : ['validation.array.required'],
            },
          ],
        };
      }

      const { stopOnFirstError = false } = options;
      const errors: ValidationError[] = [];
      let allPass = true;

      for (let i = 0; i < value.length; i++) {
        const itemValue = value[i];
        const result = await itemRule.validate(itemValue, context);

        if (!result.pass) {
          allPass = false;

          if (result.errors) {
            const prefixedErrors = result.errors.map(error => ({
              ...error,
              // Use the string representation of index as part of the path
              path: [i.toString(), ...(error.path || [])],
            }));

            errors.push(...prefixedErrors);

            if (stopOnFirstError) {
              break;
            }
          }
        }
      }

      return {
        pass: allPass,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

/**
 * Validation for objects with arbitrary keys but values that conform to a schema
 */
export function objectValues<TValue, TContext = unknown>(
  valueRule: ValidationRule<TValue, TContext>,
  options: {
    stopOnFirstError?: boolean;
    message?: string;
    messageId?: string;
    required?: boolean;
  } = {},
): ValidationRule<Record<string, TValue> | undefined | null, TContext> {
  const { required: isRequired = false } = options;

  return {
    async validate(value: Record<string, TValue> | undefined | null, context?: TContext): Promise<ValidationResult> {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        // If object is not required, pass validation when undefined
        if (!isRequired && (value === undefined || value === null)) {
          return { pass: true };
        }

        return {
          pass: false,
          errors: [
            {
              message: options.message || 'Expected an object',
              messageIds: options.messageId ? [options.messageId] : ['validation.object.required'],
            },
          ],
        };
      }

      const { stopOnFirstError = false } = options;
      const errors: ValidationError[] = [];
      let allPass = true;

      for (const key of Object.keys(value)) {
        const keyValue = value[key];
        const result = await valueRule.validate(keyValue, context);

        if (!result.pass) {
          allPass = false;

          if (result.errors) {
            const prefixedErrors = result.errors.map(error => ({
              ...error,
              path: [key, ...(error.path || [])],
            }));

            errors.push(...prefixedErrors);

            if (stopOnFirstError) {
              break;
            }
          }
        }
      }

      return {
        pass: allPass,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

/**
 * Creates a rule that depends on another field's value
 */
export function dependsOn<TValue, TContext = unknown>(
  dependencyPath: string | string[],
  condition: (dependencyValue: any, value: TValue, context?: TContext) => boolean | Promise<boolean>,
  options: { message?: string; messageId?: string } = {},
): ValidationRule<TValue, TContext> {
  return {
    async validate(value: TValue, context?: TContext): Promise<ValidationResult> {
      // For dependency validation, we use the context if available
      // If the context has a 'parent' property, use that
      // Otherwise, use the context itself (for standalone validation)
      // In the worst case, use the value itself (for self-contained validation)
      let parentObj: any;

      if (context && typeof context === 'object') {
        parentObj = 'parent' in context ? (context as any).parent : context;
      } else {
        // Fall back to value if no context is available (for self-contained validation)
        parentObj = value;
      }

      // Get the dependency value from the parent object
      const parts = Array.isArray(dependencyPath) ? dependencyPath : dependencyPath.split('.');
      const dependencyValue = getNestedProperty(parentObj, parts);

      const result = await condition(dependencyValue, value, context);

      return {
        pass: result,
        errors: result
          ? undefined
          : [
              {
                message:
                  options.message ||
                  `Field is dependent on ${Array.isArray(dependencyPath) ? dependencyPath.join('.') : dependencyPath}`,
                messageIds: options.messageId ? [options.messageId] : ['validation.dependsOn'],
              },
            ],
      };
    },
  };
}
