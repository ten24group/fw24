import { EntitySchema } from '../entity/base-entity';
import {
  ValidationRule as ValidationRuleType,
  HttpRequestValidations,
  EntityValidations,
  InputValidationRule,
} from './types';

// Core types for validation
type Op = 'create' | 'update' | 'delete' | 'get' | 'list' | 'query' | 'upsert' | 'duplicate';
type Target = 'input' | 'actor' | 'record';
type HttpTarget = 'body' | 'param' | 'query' | 'header';
type DataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'
  | 'email'
  | 'ip'
  | 'ipv4'
  | 'ipv6'
  | 'httpUrl'
  | 'uuid'
  | 'json'
  | 'date';

// Rule definitions as objects
export interface ValidationRule {
  // Basic validations
  required?: boolean | string;
  min?: number | [number, string];
  max?: number | [number, string];
  minLength?: number | [number, string];
  maxLength?: number | [number, string];

  // Type validations
  type?: DataType | [DataType, string];
  email?: boolean | string;
  url?: boolean | string;
  date?: boolean | string;

  // Pattern validation
  pattern?: RegExp | [RegExp, string];

  // Comparison validations
  eq?: any | [any, string];
  neq?: any | [any, string];
  gt?: number | [number, string];
  gte?: number | [number, string];
  lt?: number | [number, string];
  lte?: number | [number, string];

  // List validations
  in?: any[] | [any[], string];
  notIn?: any[] | [any[], string];

  // Special validations
  unique?: boolean | string;
  custom?:
    | ((value: any, data?: any) => boolean | Promise<boolean>)
    | [(value: any, data?: any) => boolean | Promise<boolean>, string];

  // Conditional validation
  when?: Array<{
    condition: (value: any, data?: any) => boolean;
    rules: ValidationRule;
  }>;

  // Common options
  message?: string;
  operations?: Op[];
}

// Higher level rule templates
export interface PasswordRule extends ValidationRule {
  minLength?: number | [number, string];
  requireSpecial?: boolean;
  requireUpper?: boolean;
  requireDigit?: boolean;
}

export interface NameRule extends ValidationRule {
  minLength?: number | [number, string];
  maxLength?: number | [number, string];
}

// Parse a rule definition into the internal format
function parseRule(rule: ValidationRule): Record<string, any>[] {
  const result: Record<string, any>[] = [];
  const operations = rule.operations;

  // Handle each validation type
  for (const [key, value] of Object.entries(rule)) {
    if (key === 'operations' || key === 'message') continue;

    // Special case for predefined rule templates
    if (key === 'email' && value) {
      const rule: Record<string, any> = { datatype: 'email' };
      if (typeof value === 'string') rule.message = value;
      if (operations) rule.operations = operations;
      result.push(rule);
      continue;
    }

    if (key === 'url' && value) {
      const rule: Record<string, any> = { datatype: 'httpUrl' };
      if (typeof value === 'string') rule.message = value;
      if (operations) rule.operations = operations;
      result.push(rule);
      continue;
    }

    if (key === 'date' && value) {
      const rule: Record<string, any> = { datatype: 'date' };
      if (typeof value === 'string') rule.message = value;
      if (operations) rule.operations = operations;
      result.push(rule);
      continue;
    }

    if (key === 'type') {
      const rule: Record<string, any> = { datatype: Array.isArray(value) ? value[0] : value };
      if (Array.isArray(value) && value[1]) rule.message = value[1];
      if (operations) rule.operations = operations;
      result.push(rule);
      continue;
    }

    if (key === 'in') {
      const rule: Record<string, any> = { inList: Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value };
      if (Array.isArray(value) && value[1]) rule.message = value[1];
      if (operations) rule.operations = operations;
      result.push(rule);
      continue;
    }

    if (key === 'notIn') {
      const rule: Record<string, any> = {
        notInList: Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value,
      };
      if (Array.isArray(value) && value[1]) rule.message = value[1];
      if (operations) rule.operations = operations;
      result.push(rule);
      continue;
    }

    if (key === 'when') {
      if (Array.isArray(value)) {
        for (const conditional of value) {
          const nestedRules = parseRule(conditional.rules);
          for (const nestedRule of nestedRules) {
            const conditionalRule = {
              ...nestedRule,
              conditional: {
                condition: conditional.condition,
              },
            };
            result.push(conditionalRule);
          }
        }
      }
      continue;
    }

    // Standard rule
    const ruleObj: Record<string, any> = {};

    if (Array.isArray(value) && !Array.isArray(value[0])) {
      // Handle direct array format like [10, "message"]
      ruleObj[key] = value[0];
      if (value[1]) ruleObj.message = value[1];
    } else {
      ruleObj[key] = value;
    }

    if (rule.message && !ruleObj.message) {
      ruleObj.message = rule.message;
    }

    if (operations) {
      ruleObj.operations = operations;
    }

    result.push(ruleObj);
  }

  return result;
}

// Process complex rule templates into basic rules
function processPasswordRule(rule: PasswordRule): ValidationRule {
  const result: ValidationRule = {
    required: rule.required || true,
  };

  // Copy common properties
  if (rule.operations) result.operations = rule.operations;
  if (rule.message) result.message = rule.message;

  // Set min length
  const minLength =
    typeof rule.minLength === 'number' ? rule.minLength : Array.isArray(rule.minLength) ? rule.minLength[0] : 8;

  result.minLength = minLength;

  // Build pattern for complexity requirements
  if (rule.requireUpper || rule.requireSpecial || rule.requireDigit) {
    let pattern = '';
    let requirements = [];

    if (rule.requireUpper) {
      pattern += '(?=.*[A-Z])';
      requirements.push('uppercase letter');
    }

    if (rule.requireDigit) {
      pattern += '(?=.*\\d)';
      requirements.push('digit');
    }

    if (rule.requireSpecial) {
      pattern += '(?=.*[!@#$%^&*])';
      requirements.push('special character');
    }

    pattern += '.+';
    result.pattern = new RegExp(pattern);
    if (!result.message) {
      result.message = `Password must contain at least one ${requirements.join(', ')}`;
    }
  }

  return result;
}

function processNameRule(rule: NameRule): ValidationRule {
  const result: ValidationRule = {
    required: rule.required || true,
  };

  // Copy common properties
  if (rule.operations) result.operations = rule.operations;
  if (rule.message) result.message = rule.message || 'Name is required';

  if (rule.minLength) {
    const min = typeof rule.minLength === 'number' ? rule.minLength : rule.minLength[0];
    result.minLength = min;
  }

  if (rule.maxLength) {
    const max = typeof rule.maxLength === 'number' ? rule.maxLength : rule.maxLength[0];
    result.maxLength = max;
  }

  return result;
}

/**
 * Entity validation builder
 */
export class EntityValidationBuilder {
  private validations: Record<string, Record<string, any[]>> = {};

  /**
   * Add a validation rule for a field
   */
  add(target: Target, field: string, rule: ValidationRule): EntityValidationBuilder {
    if (!this.validations[target]) {
      this.validations[target] = {};
    }

    if (!this.validations[target][field]) {
      this.validations[target][field] = [];
    }

    // Parse the rule into internal format
    const rules = parseRule(rule);
    this.validations[target][field].push(...rules);

    return this;
  }

  /**
   * Add a password validation rule
   */
  addPassword(target: Target, field: string, rule: PasswordRule): EntityValidationBuilder {
    return this.add(target, field, processPasswordRule(rule));
  }

  /**
   * Add a name validation rule
   */
  addName(target: Target, field: string, rule: NameRule): EntityValidationBuilder {
    return this.add(target, field, processNameRule(rule));
  }

  /**
   * Add validation rules for inputs
   */
  inputs(fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>): EntityValidationBuilder {
    return this.addFields('input', fields);
  }

  /**
   * Add validation rules for actors
   */
  actors(fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>): EntityValidationBuilder {
    return this.addFields('actor', fields);
  }

  /**
   * Add validation rules for records
   */
  records(
    fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>,
  ): EntityValidationBuilder {
    return this.addFields('record', fields);
  }

  /**
   * Add fields with validation rules
   */
  private addFields(
    target: Target,
    fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>,
  ): EntityValidationBuilder {
    for (const [field, ruleOrFn] of Object.entries(fields)) {
      if (typeof ruleOrFn === 'function') {
        // Apply the function to an empty rule
        const rule = ruleOrFn({});
        this.add(target, field, rule);
      } else {
        this.add(target, field, ruleOrFn);
      }
    }

    return this;
  }

  /**
   * Build the final validation object
   */
  build(): Record<string, Record<string, any[]>> {
    return this.validations;
  }
}

/**
 * HTTP validation builder
 */
export class HttpValidationBuilder {
  private validations: Record<string, Record<string, any>> = {};

  /**
   * Add a validation rule for a field
   */
  add(target: HttpTarget, field: string, rule: ValidationRule): HttpValidationBuilder {
    if (!this.validations[target]) {
      this.validations[target] = {};
    }

    if (!this.validations[target][field]) {
      this.validations[target][field] = {};
    }

    // Parse the rule into internal format
    const rules = parseRule(rule);

    // Merge rules for HTTP validation
    for (const rule of rules) {
      for (const [key, value] of Object.entries(rule)) {
        if (key === 'message') {
          if (!this.validations[target][field].message) {
            this.validations[target][field].message = value;
          }
        } else if (key === 'conditional') {
          if (!this.validations[target][field].conditionals) {
            this.validations[target][field].conditionals = [];
          }
          this.validations[target][field].conditionals.push(value);
        } else {
          this.validations[target][field][key] = value;
        }
      }
    }

    return this;
  }

  /**
   * Add a password validation rule
   */
  addPassword(target: HttpTarget, field: string, rule: PasswordRule): HttpValidationBuilder {
    return this.add(target, field, processPasswordRule(rule));
  }

  /**
   * Add validation rules for body
   */
  body(fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>): HttpValidationBuilder {
    return this.addFields('body', fields);
  }

  /**
   * Add validation rules for query parameters
   */
  query(fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>): HttpValidationBuilder {
    return this.addFields('query', fields);
  }

  /**
   * Add validation rules for path parameters
   */
  param(fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>): HttpValidationBuilder {
    return this.addFields('param', fields);
  }

  /**
   * Add validation rules for headers
   */
  header(fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>): HttpValidationBuilder {
    return this.addFields('header', fields);
  }

  /**
   * Add fields with validation rules
   */
  private addFields(
    target: HttpTarget,
    fields: Record<string, ValidationRule | ((rule: ValidationRule) => ValidationRule)>,
  ): HttpValidationBuilder {
    for (const [field, ruleOrFn] of Object.entries(fields)) {
      if (typeof ruleOrFn === 'function') {
        // Apply the function to an empty rule
        const rule = ruleOrFn({});
        this.add(target, field, rule);
      } else {
        this.add(target, field, ruleOrFn);
      }
    }

    return this;
  }

  /**
   * Build the final validation object
   */
  build(): HttpRequestValidations {
    return this.validations as HttpRequestValidations;
  }
}

// Factory functions
export const entity = (): EntityValidationBuilder => new EntityValidationBuilder();
export const http = (): HttpValidationBuilder => new HttpValidationBuilder();

// Maintain backward compatibility
export const entityValidation = entity;
export const httpValidation = http;

/**
 * USAGE EXAMPLES
 *
 * 1. Basic object-based entity validation:
 * ```typescript
 * entity()
 *   .add('input', 'email', {
 *     required: true,
 *     email: 'Invalid email format',
 *     operations: ['create', 'update']
 *   })
 *   .add('actor', 'role', {
 *     in: [['admin'], 'Admin role required'],
 *     operations: ['delete']
 *   })
 *   .build();
 * ```
 *
 * 2. Multiple fields at once with object literals:
 * ```typescript
 * entity()
 *   .inputs({
 *     email: { required: true, email: 'Invalid email' },
 *     name: { required: 'Name is required', minLength: 2 },
 *     age: { min: 18, message: 'Must be an adult' }
 *   })
 *   .actors({
 *     role: { in: [['admin'], 'Admin only'], operations: ['delete'] }
 *   })
 *   .build();
 * ```
 *
 * 3. Using callbacks for complex rule building:
 * ```typescript
 * entity()
 *   .inputs({
 *     email: rule => ({ ...rule, required: true, email: 'Invalid email' }),
 *     password: rule => ({
 *       ...rule,
 *       required: true,
 *       minLength: [8, 'Too short'],
 *       pattern: [/(?=.*[A-Z])(?=.*\d)/, 'Need uppercase and number']
 *     })
 *   })
 *   .build();
 * ```
 *
 * 4. Special rule templates:
 * ```typescript
 * entity()
 *   .addPassword('input', 'password', {
 *     minLength: 10,
 *     requireSpecial: true,
 *     requireUpper: true,
 *     requireDigit: true
 *   })
 *   .addName('input', 'fullName', {
 *     minLength: 2,
 *     maxLength: 50
 *   })
 *   .build();
 * ```
 *
 * 5. Conditional validation:
 * ```typescript
 * entity()
 *   .add('input', 'shippingAddress', {
 *     required: 'Shipping address is required',
 *     when: [
 *       {
 *         condition: (value, data) => data.hasPhysicalProducts === true,
 *         rules: { minLength: [10, 'Please provide complete address'] }
 *       }
 *     ]
 *   })
 *   .build();
 * ```
 *
 * 6. HTTP validation:
 * ```typescript
 * http()
 *   .body({
 *     email: { required: true, email: 'Invalid format' },
 *     password: { required: true, minLength: [8, 'Password too short'] }
 *   })
 *   .param({
 *     id: { required: true, pattern: [/^\d+$/, 'Must be numeric'] }
 *   })
 *   .build();
 * ```
 */
