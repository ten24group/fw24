/**
 * Validation system
 * Provides a comprehensive validation system with functional and builder APIs
 */

// Core validation exports
export * from './core/types';
export * from './core/validator';
export * from './core/rule-aggregator';

// Functional validation exports
export * from './functional/rules';

// Shape validation exports
export * from './shapes/object-validation';

// Entity validation exports
export * from './entity/types';
export * from './entity/validator';
export * from './entity/builder';

// HTTP validation exports
export * from './http/types';
export * from './http/validator';
export * from './http/builder';

// Factory functions for easier imports
import { entity } from './entity/builder';
import { http } from './http/builder';
import { RuleAggregator } from './core/rule-aggregator';
import { Validator } from './core/validator';
import { createEntityValidator } from './entity/validator';
import { createHttpValidator } from './http/validator';

/**
 * Factory function to create a validation builder for entity validation
 */
export const createEntityValidation = entity;

/**
 * Factory function to create a validation builder for HTTP validation
 */
export const createHttpValidation = http;

/**
 * Factory function to create a validator
 */
export const createValidator = () => new Validator();

/**
 * Factory function to create a rule aggregator
 */
export const createRuleAggregator = <T, C>() => new RuleAggregator<T, C>();

/**
 * Shorthand exports for simpler imports
 */
export const validation = {
  entity,
  http,
  createValidator,
  createEntityValidator,
  createHttpValidator,
  createRuleAggregator,
};
