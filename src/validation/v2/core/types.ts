/**
 * Core validation system types and interfaces
 * Provides the foundational types for the validation system
 */

/**
 * ValidationResult represents the outcome of a validation operation
 */
export interface ValidationResult {
  /** Whether the validation passed */
  pass: boolean;

  /** Optional array of errors when validation fails */
  errors?: ValidationError[];
}

/**
 * ValidationError represents an error that occurred during validation
 */
export interface ValidationError {
  /** Error message to display to the user */
  message?: string;

  /** Array of message identifiers for internationalization */
  messageIds?: string[];

  /** Path to the field that failed validation */
  path?: string[];

  /** Custom message for the error */
  customMessage?: string;

  /** Custom message ID for internationalization */
  customMessageId?: string;

  /** Expected value information */
  expected?: [name: string, value: unknown];

  /** Received value information */
  received?: [value: unknown, refinedValue?: unknown];
}

/**
 * Represents a condition that determines whether a validation rule should be applied
 */
export type Condition<TValue = unknown, TContext = unknown> =
  | string // Named condition reference
  | ((value: TValue, context?: TContext) => boolean | Promise<boolean>); // Function condition

/**
 * Context object provided to conditions and validation rules
 */
export interface ValidationContext<TData = unknown> {
  /** The data being validated */
  data?: TData;

  /** Named conditions that can be referenced */
  conditions?: Record<string, unknown>;

  /** Helper function to evaluate named conditions */
  conditionMatches?: (name: string) => Promise<boolean>;

  /** Additional context properties */
  [key: string]: unknown;
}

/**
 * Base validation rule interface
 */
export interface ValidationRule<TValue = unknown, TContext = unknown> {
  /** Validation function that determines if a value is valid */
  validate: (value: TValue, context?: ValidationContext<TContext>) => Promise<ValidationResult> | ValidationResult;

  /** Optional message to display when validation fails */
  message?: string;

  /** Optional message ID for internationalization */
  messageId?: string;

  /** Single condition that determines whether the rule should be applied */
  condition?: Condition<TValue, TContext>;

  /** Multiple conditions with scope */
  conditions?: {
    /** List of conditions to evaluate */
    list: Condition<TValue, TContext>[];

    /** How to evaluate multiple conditions */
    scope?: 'all' | 'any' | 'none';
  };
}

/**
 * Core validator interface
 */
export interface IValidator {
  /**
   * Validates a value against a rule
   * @param value The value to validate
   * @param rule The validation rule to apply
   * @param context Additional context for validation
   */
  validate<TValue, TContext>(
    value: TValue,
    rule: ValidationRule<TValue, TContext>,
    context?: ValidationContext<TContext>,
  ): Promise<ValidationResult>;

  /**
   * Validates a value against a conditional rule
   * @param value The value to validate
   * @param rule The conditional validation rule to apply
   * @param context Additional context for validation
   */
  validateConditional<TValue, TContext>(
    value: TValue,
    rule: ValidationRule<TValue, TContext>,
    context?: ValidationContext<TContext>,
  ): Promise<ValidationResult>;

  /**
   * Evaluates a condition
   * @param condition The condition to evaluate
   * @param value The value to check against the condition
   * @param context Additional context for condition evaluation
   */
  evaluateCondition<TValue, TContext>(
    condition: Condition<TValue, TContext>,
    value: TValue,
    context?: ValidationContext<TContext>,
  ): Promise<boolean>;
}

/**
 * Rule aggregator interface for combining multiple rules
 */
export interface IRuleAggregator<TValue = unknown, TContext = unknown> {
  /**
   * Adds a rule to the aggregator
   * @param rule The rule to add
   */
  add(rule: ValidationRule<TValue, TContext>): this;

  /**
   * Builds the final set of rules
   */
  build(): ValidationRule<TValue, TContext>[];
}
