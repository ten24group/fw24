/**
 * Object validation module
 * Provides functionality for validating objects with a schema of field rules
 */

import { IValidator, ValidationContext, ValidationResult, ValidationRule } from '../core/types';
import { createValidator } from '../core/validator';

/**
 * Schema for object validation
 * Maps field names to validation rules
 */
export type ObjectSchema<T extends Record<string, unknown>> = {
  [K in keyof T]?: ValidationRule<T[K], T>;
};

/**
 * Creates a validation rule for an object based on a schema
 * @param schema The validation schema for the object
 * @param options Additional options for object validation
 */
export function object<T extends Record<string, unknown>>(
  schema: ObjectSchema<T>,
  options?: {
    validator?: IValidator;
    allowUnknownFields?: boolean;
    message?: string;
  },
): ValidationRule<T, T> {
  const validator = options?.validator ?? createValidator();
  const allowUnknownFields = options?.allowUnknownFields ?? true;

  return {
    validate: async (value: T, context?: ValidationContext<T>): Promise<ValidationResult> => {
      // If value is undefined or null, the validation fails
      if (value === undefined || value === null) {
        return {
          pass: false,
          errors: [
            {
              message: 'Value must be an object',
              messageIds: ['validation.error.object.required'],
            },
          ],
        };
      }

      // If value is not an object, the validation fails
      if (typeof value !== 'object' || Array.isArray(value)) {
        return {
          pass: false,
          errors: [
            {
              message: 'Value must be an object',
              messageIds: ['validation.error.object.type'],
              received: [value, typeof value],
            },
          ],
        };
      }

      const result: ValidationResult = {
        pass: true,
        errors: [],
      };

      // Check for unknown fields if not allowed
      if (!allowUnknownFields) {
        const knownFields = Object.keys(schema);
        const unknownFields = Object.keys(value).filter(field => !knownFields.includes(field));

        if (unknownFields.length > 0) {
          result.pass = false;
          result.errors = result.errors || [];

          result.errors.push({
            message: `Unknown fields: ${unknownFields.join(', ')}`,
            messageIds: ['validation.error.object.unknownFields'],
            received: [unknownFields],
          });
        }
      }

      // Create a context that includes the current object
      const objectContext: ValidationContext<T> = {
        ...context,
        data: value,
      };

      // Validate each field according to the schema
      for (const field in schema) {
        if (Object.prototype.hasOwnProperty.call(schema, field)) {
          const fieldRule = schema[field];

          if (fieldRule) {
            // Get the field value
            const fieldValue = value[field];

            // Validate the field
            const fieldResult = await validator.validateConditional(fieldValue, fieldRule, objectContext);

            // If the field validation fails, the object validation fails
            if (!fieldResult.pass) {
              result.pass = false;

              // Add field errors to the result
              if (fieldResult.errors) {
                result.errors = result.errors || [];

                // Add the field path to each error
                fieldResult.errors.forEach(error => {
                  error.path = error.path || [];
                  error.path.unshift(field as string);

                  result.errors!.push(error);
                });
              }
            }
          }
        }
      }

      return result;
    },
    message: options?.message,
  };
}
