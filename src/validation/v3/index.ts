/**
 * Validation system v3 - Main exports
 */

// Core exports
export * from './core/types';
export * from './validator';

// Validation rules
export * from './rules';
export * from './rules/data-types';
export * from './rules/performance';

// Conditions
export * from './conditions';

// Nested validation
export * from './validator/nested';

// HTTP validation
export * from './http';

// Entity validation (compatibility with old validator)
export * from './validator/entity';

// JSON-based validation configuration
export * from './utils/json-config';
