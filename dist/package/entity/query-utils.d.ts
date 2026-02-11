import { FilterOperatorValue } from './query-types';
/**
 * Regular expression pattern used to parse value delimiters.
 * The pattern matches any of the following characters: &, ,, +, ;, :, or ..
 */
export declare const PARSE_VALUE_DELIMITERS: RegExp;
/**
 * An array of filter keys that can have array values.
 */
export declare const FILTER_KEYS_HAVING_ARRAY_VALUES: string[];
/**
 * Comprehensive operator alias mapping - maps all extended operators to their core equivalents.
 * This consolidates the scattered alias logic from multiple files into a single source of truth.
 */
export declare const OPERATOR_ALIASES: Record<string, string>;
/**
 * Core filter operators that don't need alias resolution.
 */
export declare const CORE_OPERATORS: Set<string>;
/**
 * Operators that typically require numeric comparison and may need type coercion.
 */
export declare const NUMERIC_COMPARISON_OPERATORS: Set<string>;
/**
 * Operators that work with array values.
 */
export declare const ARRAY_OPERATORS: Set<string>;
/**
 * Normalizes a filter operator to its core equivalent using the alias mapping.
 *
 * @param operator - The operator to normalize
 * @returns The core operator name
 *
 * @example
 * ```ts
 * normalizeOperator('equalTo') // returns 'eq'
 * normalizeOperator('>=') // returns 'gte'
 * normalizeOperator('eq') // returns 'eq' (already core)
 * ```
 */
export declare function normalizeOperator(operator: string): string;
/**
 * Checks if an operator is a core operator (doesn't need alias resolution).
 *
 * @param operator - The operator to check
 * @returns True if it's a core operator
 */
export declare function isCoreOperator(operator: string): boolean;
/**
 * Checks if an operator typically requires numeric comparison.
 *
 * @param operator - The operator to check (should be normalized first)
 * @returns True if it's a numeric comparison operator
 */
export declare function isNumericOperator(operator: string): boolean;
/**
 * Checks if an operator works with array values.
 *
 * @param operator - The operator to check (can be alias or core)
 * @returns True if it's an array operator
 */
export declare function isArrayOperator(operator: string): boolean;
/**
 * Extracts the actual value from a FilterOperatorValue, handling ComplexFilterOperatorValue structure.
 * This consolidates the complex value extraction logic used across different filter systems.
 *
 * @param rawVal - The raw filter value that might be complex
 * @returns The extracted actual value
 *
 * @example
 * ```ts
 * // Simple value
 * extractFilterValue("test") // returns "test"
 *
 * // Complex value
 * extractFilterValue({
 *   val: "actual_value",
 *   valType: "literal",
 *   valLabel: "Display Label"
 * }) // returns "actual_value"
 * ```
 */
export declare function extractFilterValue<T>(rawVal: FilterOperatorValue<T>): T;
/**
 * Determines if a value should be treated as numeric for comparison operations.
 * This helps with type coercion decisions across different filter systems.
 *
 * @param val - The value to check
 * @param operator - The operator being used (should be normalized)
 * @returns True if the value should be coerced to number
 *
 * @example
 * ```ts
 * shouldCoerceToNumber("123", "gt") // returns true
 * shouldCoerceToNumber("abc", "gt") // returns false
 * shouldCoerceToNumber("123", "eq") // returns false
 * ```
 */
export declare function shouldCoerceToNumber(val: any, operator: string): boolean;
/**
 * Safely converts array-like values to proper arrays.
 * This normalizes single values to arrays for operators that expect arrays.
 *
 * @param val - The value to normalize
 * @returns An array containing the value(s)
 *
 * @example
 * ```ts
 * normalizeToArray("single") // returns ["single"]
 * normalizeToArray(["a", "b"]) // returns ["a", "b"]
 * normalizeToArray(null) // returns [null]
 * ```
 */
export declare function normalizeToArray<T>(val: T | T[]): T[];
/**
 * Checks if a filter key/operator is in a given list of aliases.
 * This replaces the repetitive [ 'equalTo', 'equal', 'eq', '==', '===' ].includes(filterKey) patterns.
 *
 * @param operator - The operator to check
 * @param coreOperator - The core operator to match against
 * @returns True if the operator maps to the core operator
 *
 * @example
 * ```ts
 * isOperatorAlias('equalTo', 'eq') // returns true
 * isOperatorAlias('==', 'eq') // returns true
 * isOperatorAlias('gt', 'eq') // returns false
 * ```
 */
export declare function isOperatorAlias(operator: string, coreOperator: string): boolean;
/**
 * Gets all aliases for a given core operator.
 * Useful for validation or UI purposes.
 *
 * @param coreOperator - The core operator
 * @returns Array of all aliases (including the core operator itself)
 *
 * @example
 * ```ts
 * getOperatorAliases('eq') // returns ['eq', 'equalTo', 'equal', '===', '==']
 * ```
 */
export declare function getOperatorAliases(coreOperator: string): string[];
/**
 * Validates if an operator is supported (either core or has a valid alias).
 *
 * @param operator - The operator to validate
 * @returns True if the operator is supported
 */
export declare function isValidOperator(operator: string): boolean;
/**
 * Creates a helper function to check if a filter key matches any of the given core operators.
 * This replaces complex conditional chains with a more readable approach.
 *
 * @param operators - Array of core operators to match against
 * @returns Function that checks if a given operator matches any of the core operators
 *
 * @example
 * ```ts
 * const isEqualityOp = createOperatorMatcher(['eq', 'neq']);
 * isEqualityOp('equalTo') // returns true (maps to 'eq')
 * isEqualityOp('!=') // returns true (maps to 'neq')
 * isEqualityOp('gt') // returns false
 * ```
 */
export declare function createOperatorMatcher(operators: string[]): (operator: string) => boolean;
export declare const isEqualityOp: (operator: string) => boolean;
export declare const isInequalityOp: (operator: string) => boolean;
export declare const isGreaterThanOp: (operator: string) => boolean;
export declare const isGreaterThanOrEqualOp: (operator: string) => boolean;
export declare const isLessThanOp: (operator: string) => boolean;
export declare const isLessThanOrEqualOp: (operator: string) => boolean;
export declare const isRangeOp: (operator: string) => boolean;
export declare const isStringPatternOp: (operator: string) => boolean;
export declare const isContainsOp: (operator: string) => boolean;
export declare const isNotContainsOp: (operator: string) => boolean;
export declare const isInOp: (operator: string) => boolean;
export declare const isNotInOp: (operator: string) => boolean;
/**
 * Range value helper - normalizes different range value formats to a consistent structure.
 * Handles both [min, max] arrays and {from, to} objects.
 *
 * @param val - The range value in various formats
 * @returns Tuple of [min, max] values
 *
 * @example
 * ```ts
 * normalizeRangeValue([1, 10]) // returns [1, 10]
 * normalizeRangeValue({from: 5, to: 15}) // returns [5, 15]
 * ```
 */
export declare function normalizeRangeValue(val: any): [any, any];
/**
 * Type-safe coercion function that only converts when appropriate.
 *
 * @param val - The value to potentially coerce
 * @param operator - The operator context
 * @returns The coerced value or original value
 */
export declare function coerceValue(val: any, operator: string): any;
