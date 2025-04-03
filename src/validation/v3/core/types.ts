/**
 * Core types for the validation system
 */

/**
 * Result of a validation operation
 */
export interface ValidationResult {
  /** Whether validation passed */
  pass: boolean;
  /** Validation errors if any */
  errors?: ValidationError[];
}

/**
 * Validation error information
 */
export interface ValidationError {
  /** Field that failed validation */
  field?: string;
  /** Full path to the field that failed */
  path?: string[];
  /** Human-readable error message */
  message?: string;
  /** Message identifiers for internationalization */
  messageIds?: string[];
  /** Expected value or constraint */
  expected?: any;
  /** Actual received value */
  received?: any;
  /** Custom message override */
  customMessage?: string;
  /** Custom message ID override */
  customMessageId?: string;
}

/**
 * Basic validation rule interface
 */
export interface ValidationRule<TValue, TContext = unknown> {
  /**
   * Validate a value with optional context
   * @param value Value to validate
   * @param context Optional validation context
   */
  validate(value: TValue, context?: TContext): Promise<ValidationResult> | ValidationResult;
}

/**
 * Function that evaluates a condition
 */
export type ConditionFn<TValue, TContext = unknown> = (value: TValue, context?: TContext) => boolean | Promise<boolean>;

/**
 * Reference to a condition - either by name or function
 */
export type ConditionReference<TValue, TContext = unknown> =
  | string // Named condition reference
  | ConditionFn<TValue, TContext> // Inline condition function
  | ConditionExpression<TValue, TContext>; // Complex condition expression

/**
 * Complex condition expression with logical operators
 */
export interface ConditionExpression<TValue, TContext = unknown> {
  /** All conditions must be true (AND) */
  all?: ConditionReference<TValue, TContext>[];
  /** Any condition must be true (OR) */
  any?: ConditionReference<TValue, TContext>[];
  /** Condition must be false (NOT) */
  not?: ConditionReference<TValue, TContext>;
}

/**
 * Rule that applies conditionally
 */
export interface ConditionalRule<TValue, TContext = unknown> {
  /** The rule to apply when condition is met */
  rule: ValidationRule<TValue, TContext>;
  /** Condition determining when to apply the rule */
  when?: ConditionReference<TValue, TContext>;
}

/**
 * Map of named conditions for reuse
 */
export type NamedConditions<TValue, TContext = unknown> = Record<string, ConditionFn<TValue, TContext>>;
