/**
 * Entity Validator - For validating entities with actors, inputs, and records
 */
import { Validator } from '../validator';
import { ValidationError, ValidationResult, ValidationRule } from '../core/types';
import { parseJsonRule } from '../utils/json-config';

/**
 * Entity validation interface - compatible with the original Validator
 */
export interface EntityValidations {
  actor?: Record<string, any>;
  input?: Record<string, any>;
  record?: Record<string, any>;
  [key: string]: any;
}

/**
 * Entity validation options
 */
export interface EntityValidationOptions {
  operationName: string;
  entityName: string;
  entityValidations: EntityValidations;
  actor?: Record<string, any>;
  input?: Record<string, any>;
  record?: Record<string, any>;
  collectErrors?: boolean;
  verboseErrors?: boolean;
  overriddenErrorMessages?: Map<string, string>;
}

/**
 * Entity Validator - provides validation similar to the original validator
 * but using the v3 validation system
 */
export class EntityValidator {
  private validator: Validator;

  constructor() {
    this.validator = new Validator();
  }

  /**
   * Validates an entity based on the provided validation rules
   */
  async validateEntity(options: EntityValidationOptions): Promise<{ pass: boolean; errors: ValidationError[] }> {
    const {
      operationName,
      entityName,
      entityValidations,
      actor = {},
      input = {},
      record = {},
      collectErrors = false,
      verboseErrors = false,
    } = options;

    const errors: ValidationError[] = [];
    let pass = true;

    // Validate actor rules
    if (entityValidations.actor && Object.keys(entityValidations.actor).length > 0) {
      const result = await this.validateSection('actor', entityValidations.actor, actor, {
        operationName,
        entityName,
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(...result.errors);
        }
      }
    }

    // Validate input rules
    if (entityValidations.input && Object.keys(entityValidations.input).length > 0) {
      const result = await this.validateSection('input', entityValidations.input, input, {
        operationName,
        entityName,
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(...result.errors);
        }
      }
    }

    // Validate record rules
    if (entityValidations.record && Object.keys(entityValidations.record).length > 0) {
      const result = await this.validateSection('record', entityValidations.record, record, {
        operationName,
        entityName,
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(...result.errors);
        }
      }
    }

    return { pass, errors };
  }

  /**
   * Validates a specific section (actor/input/record) against validation rules
   */
  private async validateSection(
    sectionName: string,
    rules: Record<string, any>,
    data: Record<string, any>,
    options: {
      operationName: string;
      entityName: string;
      collectErrors: boolean;
      verboseErrors: boolean;
    },
  ): Promise<{ pass: boolean; errors: ValidationError[] }> {
    const { operationName, entityName, collectErrors, verboseErrors } = options;
    let pass = true;
    const errors: ValidationError[] = [];

    for (const field in rules) {
      const fieldValue = data[field];
      const fieldRules = rules[field];

      // Get the rule type for messageIds
      const ruleType = this.extractRuleType(fieldRules);

      // Convert JSON rules to ValidationRule objects
      const validationRules = Array.isArray(fieldRules)
        ? fieldRules.map(rule => parseJsonRule(rule))
        : [parseJsonRule(fieldRules)];

      for (const rule of validationRules) {
        // Create a schema to validate just this field
        const schema = {
          fields: {
            [field]: rule,
          },
        };

        // Use the validate method from Validator
        const result = await this.validator.validate({ [field]: fieldValue }, schema, data, {
          collectErrors: true,
          verboseErrors: true,
        });

        if (!result.pass) {
          pass = false;

          if (collectErrors && result.errors?.length) {
            const messageIds = result.errors.map((error: ValidationError) => {
              const pathPart = error.path ? error.path.slice(1).join('.') : '';
              return `validation.entity.${entityName}.${field.toLowerCase()}.${ruleType}`;
            });

            errors.push({
              path: [sectionName, field],
              message: result.errors[0]?.message || `Validation failed for ${field}`,
              messageIds,
              expected: result.errors[0]?.expected,
              received: result.errors[0]?.received,
            });

            if (!verboseErrors) {
              break; // Stop on first error if not collecting verbose errors
            }
          } else {
            return { pass: false, errors: [] };
          }
        }
      }
    }

    return { pass, errors };
  }

  /**
   * Extracts the rule type from a validation rule object
   * @param rule The validation rule object
   * @returns The rule type (e.g., 'required', 'minLength', 'email')
   */
  private extractRuleType(rule: any): string {
    if (!rule || typeof rule !== 'object') {
      return '';
    }

    // For conditional rules, extract from the inner rule
    if ('when' in rule && 'rule' in rule) {
      return this.extractRuleType(rule.rule);
    }

    // Handle common rule types
    if ('required' in rule) return 'required';
    if ('minLength' in rule) return 'minLength';
    if ('maxLength' in rule) return 'maxLength';
    if ('min' in rule) return 'min';
    if ('max' in rule) return 'max';
    if ('equals' in rule || 'eq' in rule) return 'eq';
    if ('notEquals' in rule || 'neq' in rule) return 'neq';
    if ('oneOf' in rule || 'inList' in rule) return 'oneOf';
    if ('notOneOf' in rule || 'notInList' in rule) return 'notOneOf';
    if ('matches' in rule || 'pattern' in rule) return 'matches';
    if ('datatype' in rule) return rule.datatype;
    if ('gt' in rule) return 'gt';
    if ('lt' in rule) return 'lt';
    if ('gte' in rule) return 'gte';
    if ('lte' in rule) return 'lte';
    if ('custom' in rule) return 'custom';

    // Default to the first key if nothing matches
    return Object.keys(rule)[0] || '';
  }

  /**
   * Validates an object against JSON validation rules
   * Similar to validateInput in the original validator
   */
  async validateInput(
    input: Record<string, any>,
    rules: Record<string, any>,
    collectErrors = true,
  ): Promise<{ pass: boolean; errors: Record<string, string[]> }> {
    const errors: Record<string, string[]> = {};
    let pass = true;

    for (const field in rules) {
      const fieldValue = input[field];
      const fieldRules = rules[field];

      // Convert JSON rules to ValidationRule objects
      const rule = parseJsonRule(fieldRules);

      // Create a schema to validate just this field
      const schema = {
        fields: {
          [field]: rule,
        },
      };

      // Use the validate method from Validator
      const result = await this.validator.validate({ [field]: fieldValue }, schema, input, {
        collectErrors: true,
        verboseErrors: true,
      });

      if (!result.pass) {
        pass = false;

        if (collectErrors && result.errors?.length) {
          errors[field] = result.errors.map(
            (error: ValidationError) => error.message || `Validation failed for ${field}`,
          );
        } else {
          return { pass: false, errors: {} };
        }
      }
    }

    return { pass, errors };
  }

  /**
   * Validates an HTTP request against validation rules
   */
  async validateHttpRequest(options: {
    requestContext: any;
    validations: any;
    collectErrors?: boolean;
    verboseErrors?: boolean;
    overriddenErrorMessages?: Map<string, string>;
  }): Promise<{ pass: boolean; errors: ValidationError[] }> {
    const { requestContext, validations, collectErrors = false, verboseErrors = false } = options;
    const errors: ValidationError[] = [];
    let pass = true;

    // Validate body
    if (validations.body && requestContext.body) {
      const result = await this.validateSection('body', validations.body, requestContext.body, {
        operationName: 'http',
        entityName: 'request',
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(
            ...result.errors.map(error => ({
              ...error,
              messageIds: (error.messageIds || []).map(id => id.replace('entity.request', 'http')),
            })),
          );
        }
      }
    }

    // Validate path parameters
    if (validations.param && requestContext.pathParameters) {
      const result = await this.validateSection('param', validations.param, requestContext.pathParameters, {
        operationName: 'http',
        entityName: 'request',
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(
            ...result.errors.map(error => ({
              ...error,
              messageIds: (error.messageIds || []).map(id => id.replace('entity.request', 'http')),
            })),
          );
        }
      }
    }

    // Validate query parameters
    if (validations.query && requestContext.queryStringParameters) {
      const result = await this.validateSection('query', validations.query, requestContext.queryStringParameters, {
        operationName: 'http',
        entityName: 'request',
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(
            ...result.errors.map(error => ({
              ...error,
              messageIds: (error.messageIds || []).map(id => id.replace('entity.request', 'http')),
            })),
          );
        }
      }
    }

    // Validate headers
    if (validations.header && requestContext.headers) {
      const result = await this.validateSection('header', validations.header, requestContext.headers, {
        operationName: 'http',
        entityName: 'request',
        collectErrors,
        verboseErrors,
      });

      if (!result.pass) {
        pass = false;
        if (collectErrors && result.errors.length > 0) {
          errors.push(
            ...result.errors.map(error => ({
              ...error,
              messageIds: (error.messageIds || []).map(id => id.replace('entity.request', 'http')),
            })),
          );
        }
      }
    }

    // Apply custom error messages if provided
    if (options.overriddenErrorMessages && errors.length > 0) {
      for (const error of errors) {
        if (error.messageIds && error.messageIds.length > 0) {
          for (const messageId of error.messageIds) {
            const customMessage = options.overriddenErrorMessages.get(messageId);
            if (customMessage) {
              error.message = customMessage;
              break;
            }
          }
        }
      }
    }

    return { pass, errors };
  }
}
