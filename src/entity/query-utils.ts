import { FilterOperatorValue, ComplexFilterOperatorValue, isComplexFilterValue } from './query-types';
import { createLogger } from '../logging';

const logger = createLogger('QueryUtils');

/**
 * Regular expression pattern used to parse value delimiters.
 * The pattern matches any of the following characters: &, ,, +, ;, :, or ..
 */
export const PARSE_VALUE_DELIMITERS = /(?:&|,|\+|;|:|\.)+/;

/**
 * An array of filter keys that can have array values.
 */
export const FILTER_KEYS_HAVING_ARRAY_VALUES = [
  'in', 'inList', 'nin', 'notIn', 'notInList', 'contains', 'includes', 'has',
  'notContains', 'notIncludes', 'notHas', 'containsSome', 'includesSome', 'hasSome'
];

/**
 * Comprehensive operator alias mapping - maps all extended operators to their core equivalents.
 * This consolidates the scattered alias logic from multiple files into a single source of truth.
 */
export const OPERATOR_ALIASES: Record<string, string> = {
  // Equality aliases
  'equalTo': 'eq',
  'equal': 'eq',
  '===': 'eq',
  '==': 'eq',

  // Inequality aliases
  'notEqualTo': 'neq',
  'notEqual': 'neq',
  '!==': 'neq',
  '!=': 'neq',
  '<>': 'neq',
  'ne': 'neq',

  // Comparison aliases
  'greaterThan': 'gt',
  'greaterThen': 'gt',
  '>': 'gt',

  'greaterThanOrEqualTo': 'gte',
  'greaterThenOrEqualTo': 'gte',
  '>=': 'gte',
  '>==': 'gte',

  'lessThan': 'lt',
  'lessThen': 'lt',
  '<': 'lt',

  'lessThanOrEqualTo': 'lte',
  'lessThenOrEqualTo': 'lte',
  '<=': 'lte',
  '<==': 'lte',

  // Range aliases
  'between': 'bt',
  'bw': 'bt',
  '><': 'bt',

  // List aliases
  'inList': 'in',
  'notInList': 'nin',
  'notIn': 'nin',

  // String pattern aliases
  'begins': 'startsWith',
  'beginsWith': 'startsWith',
  // Note: 'like' is intentionally not mapped here as different systems handle it differently
  // MeiliSearch uses 'contains' approximation, ElectroDB uses 'startsWith', etc.

  // Contains aliases
  'includes': 'contains',
  'has': 'contains',
  'includesSome': 'containsSome',
  'hasSome': 'containsSome',
  'notIncludes': 'notContains',
  'notHas': 'notContains',

  // Existence aliases
  'exists': 'exists', // Keep as-is, special handling needed per context
};

/**
 * Core filter operators that don't need alias resolution.
 */
export const CORE_OPERATORS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'bt',
  'isNull', 'isEmpty', 'exists', 'contains', 'notContains',
  'containsSome', 'like', 'endsWith', 'startsWith'
]);

/**
 * Operators that typically require numeric comparison and may need type coercion.
 */
export const NUMERIC_COMPARISON_OPERATORS = new Set([
  'gt', 'gte', 'lt', 'lte', 'bt', 'between'
]);

/**
 * Operators that work with array values.
 */
export const ARRAY_OPERATORS = new Set([
  'in', 'nin', 'inList', 'notInList', 'notIn', 'contains', 'notContains',
  'containsSome', 'includes', 'has', 'notIncludes', 'notHas', 'includesSome', 'hasSome'
]);

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
export function normalizeOperator(operator: string): string {
  return OPERATOR_ALIASES[ operator ] || operator;
}

/**
 * Checks if an operator is a core operator (doesn't need alias resolution).
 * 
 * @param operator - The operator to check
 * @returns True if it's a core operator
 */
export function isCoreOperator(operator: string): boolean {
  return CORE_OPERATORS.has(operator);
}

/**
 * Checks if an operator typically requires numeric comparison.
 * 
 * @param operator - The operator to check (should be normalized first)
 * @returns True if it's a numeric comparison operator
 */
export function isNumericOperator(operator: string): boolean {
  return NUMERIC_COMPARISON_OPERATORS.has(operator);
}

/**
 * Checks if an operator works with array values.
 * 
 * @param operator - The operator to check (can be alias or core)
 * @returns True if it's an array operator
 */
export function isArrayOperator(operator: string): boolean {
  const normalized = normalizeOperator(operator);
  return ARRAY_OPERATORS.has(normalized) || ARRAY_OPERATORS.has(operator);
}

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
export function extractFilterValue<T>(rawVal: FilterOperatorValue<T>): T {
  if (isComplexFilterValue(rawVal)) {
    const complexVal = rawVal as ComplexFilterOperatorValue<T>;

    // For now, we only handle 'literal' valType
    // TODO: Implement support for 'propRef' and 'expression' valTypes
    if (complexVal.valType && complexVal.valType !== 'literal') {
      logger.warn(`Unsupported valType '${complexVal.valType}', treating as literal`, { complexVal });
    }

    return complexVal.val;
  }

  return rawVal as T;
}

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
export function shouldCoerceToNumber(val: any, operator: string): boolean {
  const normalizedOp = normalizeOperator(operator);
  return isNumericOperator(normalizedOp) &&
    (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))));
}

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
export function normalizeToArray<T>(val: T | T[]): T[] {
  if (Array.isArray(val)) {
    return val;
  }
  return [ val ];
}

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
export function isOperatorAlias(operator: string, coreOperator: string): boolean {
  return normalizeOperator(operator) === coreOperator;
}

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
export function getOperatorAliases(coreOperator: string): string[] {
  const aliases = Object.entries(OPERATOR_ALIASES)
    .filter(([ _alias, core ]) => core === coreOperator)
    .map(([ alias ]) => alias);

  return [ coreOperator, ...aliases ];
}

/**
 * Validates if an operator is supported (either core or has a valid alias).
 * 
 * @param operator - The operator to validate
 * @returns True if the operator is supported
 */
export function isValidOperator(operator: string): boolean {
  return isCoreOperator(operator) || operator in OPERATOR_ALIASES;
}

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
export function createOperatorMatcher(operators: string[]) {
  const coreOps = new Set(operators);
  return (operator: string): boolean => {
    const normalized = normalizeOperator(operator);
    return coreOps.has(normalized);
  };
}

// Create operator matcher functions using shared utilities
export const isEqualityOp = createOperatorMatcher([ 'eq' ]);
export const isInequalityOp = createOperatorMatcher([ 'neq' ]);
export const isGreaterThanOp = createOperatorMatcher([ 'gt' ]);
export const isGreaterThanOrEqualOp = createOperatorMatcher([ 'gte' ]);
export const isLessThanOp = createOperatorMatcher([ 'lt' ]);
export const isLessThanOrEqualOp = createOperatorMatcher([ 'lte' ]);
export const isRangeOp = createOperatorMatcher([ 'bt', 'between' ]);
export const isStringPatternOp = createOperatorMatcher([ 'startsWith' ]);
export const isContainsOp = createOperatorMatcher([ 'contains' ]);
export const isNotContainsOp = createOperatorMatcher([ 'notContains' ]);
export const isInOp = createOperatorMatcher([ 'in' ]);
export const isNotInOp = createOperatorMatcher([ 'nin' ]);

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
export function normalizeRangeValue(val: any): [ any, any ] {
  if (Array.isArray(val) && val.length >= 2) {
    return [ val[ 0 ], val[ 1 ] ];
  }
  if (val && typeof val === 'object' && 'from' in val && 'to' in val) {
    return [ val.from, val.to ];
  }
  throw new Error(`Invalid range value format: ${JSON.stringify(val)}`);
}

/**
 * Type-safe coercion function that only converts when appropriate.
 * 
 * @param val - The value to potentially coerce
 * @param operator - The operator context
 * @returns The coerced value or original value
 */
export function coerceValue(val: any, operator: string): any {
  if (shouldCoerceToNumber(val, operator)) {
    return Number(val);
  }
  return val;
} 