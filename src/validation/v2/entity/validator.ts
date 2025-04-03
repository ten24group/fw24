/**
 * Entity validator implementation
 * Validates entity data against validation schemas
 */

import { IValidator, ValidationContext } from '../core/types';
import { createValidator } from '../core/validator';
import {
  Actor,
  EntityRecord,
  EntityValidationContext,
  EntityValidationResult,
  EntityValidationSchema,
  Input,
  Operation,
  ValidationTarget,
} from './types';

/**
 * Options for the entity validator
 */
interface EntityValidatorOptions {
  /** Custom validator to use */
  validator?: IValidator;

  /** Whether to collect all errors or stop at the first one */
  collectErrors?: boolean;

  /** Whether to include detailed error information */
  verboseErrors?: boolean;
}

/**
 * Entity validator class
 * Validates entity data against validation schemas
 */
export class EntityValidator {
  private validator: IValidator;
  private collectErrors: boolean;
  private verboseErrors: boolean;

  /**
   * Creates a new entity validator
   * @param options Options for the entity validator
   */
  constructor(options?: EntityValidatorOptions) {
    this.validator = options?.validator ?? createValidator();
    this.collectErrors = options?.collectErrors ?? true;
    this.verboseErrors = options?.verboseErrors ?? false;
  }

  /**
   * Validates entity data against a validation schema
   * @param options Validation options
   */
  async validate(options: {
    entityName: string;
    operation: Operation;
    schema: EntityValidationSchema;
    input?: Input;
    actor?: Actor;
    record?: EntityRecord;
  }): Promise<EntityValidationResult> {
    const { entityName, operation, schema, input, actor, record } = options;

    // Create validation context
    const context: EntityValidationContext = {
      entityName,
      operation,
      input,
      actor,
      record,
    };

    // Create a ValidationContext for the core validator
    const validationContext: ValidationContext<EntityValidationContext> = {
      data: context,
      conditionMatches: async (name: string) => {
        if (!context.conditions || !context.conditions[name]) {
          return false;
        }

        // Handle condition evaluation based on the condition type
        const condition = context.conditions[name];

        if (typeof condition === 'function') {
          return condition(context);
        }

        // For complex conditions (to be implemented)
        return false;
      },
    };

    // Only apply schema if it doesn't specify operations or if it includes the current operation
    if (schema.operations && !schema.operations.includes(operation)) {
      return { pass: true };
    }

    // Initialize result
    const result: EntityValidationResult = {
      pass: true,
      errors: [],
    };

    // Validate each target
    for (const target of ['input', 'actor', 'record'] as ValidationTarget[]) {
      const targetSchema = schema[target];
      const targetData = target === 'input' ? input : target === 'actor' ? actor : record;

      // Skip if no schema or data for this target
      if (!targetSchema || !targetData) {
        continue;
      }

      // Validate each field in the target
      for (const field in targetSchema) {
        if (Object.prototype.hasOwnProperty.call(targetSchema, field)) {
          const fieldRule = targetSchema[field];

          if (fieldRule) {
            const fieldValue = targetData[field];

            // Validate the field
            const fieldResult = await this.validator.validateConditional(fieldValue, fieldRule, validationContext);

            // If field validation fails, the entity validation fails
            if (!fieldResult.pass) {
              result.pass = false;

              // Collect errors if enabled
              if (this.collectErrors && fieldResult.errors) {
                result.errors = result.errors || [];

                fieldResult.errors.forEach(error => {
                  // Build complete path
                  const path = error.path || [];
                  path.unshift(field);
                  path.unshift(target);

                  // Create error object
                  const errorObj = {
                    message: error.message || error.customMessage || 'Validation failed',
                    path,
                  };

                  // Add additional information if verbose errors are enabled
                  if (this.verboseErrors) {
                    Object.assign(errorObj, {
                      expected: error.expected,
                      received: error.received,
                      messageIds: error.messageIds,
                    });
                  }

                  result.errors!.push(errorObj as any);
                });
              }
            }
          }
        }
      }
    }

    return result;
  }
}

/**
 * Creates a new entity validator
 */
export function createEntityValidator(options?: EntityValidatorOptions): EntityValidator {
  return new EntityValidator(options);
}
