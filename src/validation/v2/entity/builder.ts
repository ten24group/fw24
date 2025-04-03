/**
 * Entity validation builder
 * Provides a fluent API for building entity validation schemas
 */

import { ValidationRule } from '../core/types';
import {
  Actor,
  EntityRecord,
  EntityValidationContext,
  EntityValidationSchema,
  Input,
  Operation,
  TargetSchema,
} from './types';

/**
 * Field definition function
 * Allows for defining fields using a callback
 */
export type EntityFieldDefinitionFn<T> = (field: string) => ValidationRule<T, EntityValidationContext>;

/**
 * Entity validation builder
 * Provides a fluent API for building entity validation schemas
 */
export class EntityValidationBuilder {
  private schema: EntityValidationSchema = {};
  private conditions: Record<string, unknown> = {};

  /**
   * Creates a new entity validation builder
   */
  constructor() {}

  /**
   * Defines operations this schema applies to
   * @param operations Operations to apply the schema to
   */
  forOperations(...operations: Operation[]): this {
    this.schema.operations = operations;
    return this;
  }

  /**
   * Defines conditions that can be referenced in validation rules
   * @param conditions Named conditions
   */
  defineConditions(conditions: Record<string, unknown>): this {
    this.conditions = { ...this.conditions, ...conditions };
    return this;
  }

  /**
   * Adds a validation rule for an input field
   * @param field Field name
   * @param rule Validation rule
   */
  addInput(field: string, rule: ValidationRule<unknown, EntityValidationContext>): this {
    if (!this.schema.input) {
      this.schema.input = {};
    }

    this.schema.input[field] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple input fields
   * @param fields Object mapping field names to validation rules
   */
  inputs(
    fields: Record<string, ValidationRule<unknown, EntityValidationContext> | EntityFieldDefinitionFn<unknown>>,
  ): this {
    if (!this.schema.input) {
      this.schema.input = {};
    }

    for (const field in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        const rule = fields[field];

        if (typeof rule === 'function') {
          this.schema.input[field] = rule(field);
        } else {
          this.schema.input[field] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Adds a validation rule for an actor field
   * @param field Field name
   * @param rule Validation rule
   */
  addActor(field: string, rule: ValidationRule<unknown, EntityValidationContext>): this {
    if (!this.schema.actor) {
      this.schema.actor = {};
    }

    this.schema.actor[field] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple actor fields
   * @param fields Object mapping field names to validation rules
   */
  actors(
    fields: Record<string, ValidationRule<unknown, EntityValidationContext> | EntityFieldDefinitionFn<unknown>>,
  ): this {
    if (!this.schema.actor) {
      this.schema.actor = {};
    }

    for (const field in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        const rule = fields[field];

        if (typeof rule === 'function') {
          this.schema.actor[field] = rule(field);
        } else {
          this.schema.actor[field] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Adds a validation rule for a record field
   * @param field Field name
   * @param rule Validation rule
   */
  addRecord(field: string, rule: ValidationRule<unknown, EntityValidationContext>): this {
    if (!this.schema.record) {
      this.schema.record = {};
    }

    this.schema.record[field] = rule;
    return this;
  }

  /**
   * Adds validation rules for multiple record fields
   * @param fields Object mapping field names to validation rules
   */
  records(
    fields: Record<string, ValidationRule<unknown, EntityValidationContext> | EntityFieldDefinitionFn<unknown>>,
  ): this {
    if (!this.schema.record) {
      this.schema.record = {};
    }

    for (const field in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        const rule = fields[field];

        if (typeof rule === 'function') {
          this.schema.record[field] = rule(field);
        } else {
          this.schema.record[field] = rule;
        }
      }
    }

    return this;
  }

  /**
   * Generic method to add a validation rule for any target
   * @param target Validation target
   * @param field Field name
   * @param rule Validation rule
   */
  add(
    target: 'input' | 'actor' | 'record',
    field: string,
    rule: ValidationRule<unknown, EntityValidationContext>,
  ): this {
    switch (target) {
      case 'input':
        return this.addInput(field, rule);
      case 'actor':
        return this.addActor(field, rule);
      case 'record':
        return this.addRecord(field, rule);
      default:
        return this;
    }
  }

  /**
   * Builds the validation schema
   */
  build(): EntityValidationSchema {
    // Include conditions in the schema
    if (Object.keys(this.conditions).length > 0) {
      return {
        ...this.schema,
        conditions: this.conditions,
      } as EntityValidationSchema;
    }

    return this.schema;
  }
}

/**
 * Creates a new entity validation builder
 */
export function entity(): EntityValidationBuilder {
  return new EntityValidationBuilder();
}
