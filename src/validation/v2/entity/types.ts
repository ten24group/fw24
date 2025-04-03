/**
 * Entity validation types
 * Defines the types for validating entities
 */

import { ValidationRule } from '../core/types';

/**
 * Actor data type
 */
export type Actor = Record<string, unknown>;

/**
 * Input data type
 */
export type Input = Record<string, unknown>;

/**
 * Entity record data type
 */
export type EntityRecord = Record<string, unknown>;

/**
 * Operation type for an entity
 */
export type Operation = string;

/**
 * Entity validation context
 */
export interface EntityValidationContext {
  /** The entity being validated */
  entityName: string;

  /** The operation being performed */
  operation: Operation;

  /** Input data */
  input?: Input;

  /** Actor data */
  actor?: Actor;

  /** Record data */
  record?: EntityRecord;

  /** Named conditions for validation */
  conditions?: Record<string, unknown>;
}

/**
 * Entity validation target
 */
export type ValidationTarget = 'input' | 'actor' | 'record';

/**
 * Schema for a specific target in entity validation
 */
export type TargetSchema<T extends Record<string, unknown>> = {
  [K in keyof T]?: ValidationRule<T[K], EntityValidationContext>;
};

/**
 * Schema for entity validation
 */
export interface EntityValidationSchema {
  /** Input validation schema */
  input?: TargetSchema<Input>;

  /** Actor validation schema */
  actor?: TargetSchema<Actor>;

  /** Record validation schema */
  record?: TargetSchema<EntityRecord>;

  /** Operations this schema applies to */
  operations?: Operation[];
}

/**
 * Result of entity validation
 */
export interface EntityValidationResult {
  /** Whether validation passed */
  pass: boolean;

  /** Validation errors */
  errors?: Array<{
    /** Error message */
    message: string;

    /** Path to the field that failed validation */
    path: string[];
  }>;
}
