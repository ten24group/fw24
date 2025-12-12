"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNotInOp = exports.isInOp = exports.isNotContainsOp = exports.isContainsOp = exports.isStringPatternOp = exports.isRangeOp = exports.isLessThanOrEqualOp = exports.isLessThanOp = exports.isGreaterThanOrEqualOp = exports.isGreaterThanOp = exports.isInequalityOp = exports.isEqualityOp = exports.ARRAY_OPERATORS = exports.NUMERIC_COMPARISON_OPERATORS = exports.CORE_OPERATORS = exports.OPERATOR_ALIASES = exports.FILTER_KEYS_HAVING_ARRAY_VALUES = exports.PARSE_VALUE_DELIMITERS = void 0;
exports.normalizeOperator = normalizeOperator;
exports.isCoreOperator = isCoreOperator;
exports.isNumericOperator = isNumericOperator;
exports.isArrayOperator = isArrayOperator;
exports.extractFilterValue = extractFilterValue;
exports.shouldCoerceToNumber = shouldCoerceToNumber;
exports.normalizeToArray = normalizeToArray;
exports.isOperatorAlias = isOperatorAlias;
exports.getOperatorAliases = getOperatorAliases;
exports.isValidOperator = isValidOperator;
exports.createOperatorMatcher = createOperatorMatcher;
exports.normalizeRangeValue = normalizeRangeValue;
exports.coerceValue = coerceValue;
const query_types_1 = require("./query-types");
const logging_1 = require("../logging");
const logger = (0, logging_1.createLogger)('QueryUtils');
/**
 * Regular expression pattern used to parse value delimiters.
 * The pattern matches any of the following characters: &, ,, +, ;, :, or ..
 */
exports.PARSE_VALUE_DELIMITERS = /(?:&|,|\+|;|:|\.)+/;
/**
 * An array of filter keys that can have array values.
 */
exports.FILTER_KEYS_HAVING_ARRAY_VALUES = [
    'in', 'inList', 'nin', 'notIn', 'notInList', 'contains', 'includes', 'has',
    'notContains', 'notIncludes', 'notHas', 'containsSome', 'includesSome', 'hasSome'
];
/**
 * Comprehensive operator alias mapping - maps all extended operators to their core equivalents.
 * This consolidates the scattered alias logic from multiple files into a single source of truth.
 */
exports.OPERATOR_ALIASES = {
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
    // Existence check - maps to DynamoDB attribute_exists/attribute_not_exists
    'exists': 'exists',
    'notExists': 'notExists',
    // Backward compatibility aliases
    'isNull': 'notExists',
    'notNull': 'exists',
    'empty': 'notExists',
    'notEmpty': 'exists',
};
/**
 * Core filter operators that don't need alias resolution.
 */
exports.CORE_OPERATORS = new Set([
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'bt',
    'exists', 'notExists', 'isNull', 'notNull', 'empty', 'notEmpty',
    'contains', 'notContains', 'containsSome', 'like', 'endsWith', 'startsWith'
]);
/**
 * Operators that typically require numeric comparison and may need type coercion.
 */
exports.NUMERIC_COMPARISON_OPERATORS = new Set([
    'gt', 'gte', 'lt', 'lte', 'bt', 'between'
]);
/**
 * Operators that work with array values.
 */
exports.ARRAY_OPERATORS = new Set([
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
function normalizeOperator(operator) {
    return exports.OPERATOR_ALIASES[operator] || operator;
}
/**
 * Checks if an operator is a core operator (doesn't need alias resolution).
 *
 * @param operator - The operator to check
 * @returns True if it's a core operator
 */
function isCoreOperator(operator) {
    return exports.CORE_OPERATORS.has(operator);
}
/**
 * Checks if an operator typically requires numeric comparison.
 *
 * @param operator - The operator to check (should be normalized first)
 * @returns True if it's a numeric comparison operator
 */
function isNumericOperator(operator) {
    return exports.NUMERIC_COMPARISON_OPERATORS.has(operator);
}
/**
 * Checks if an operator works with array values.
 *
 * @param operator - The operator to check (can be alias or core)
 * @returns True if it's an array operator
 */
function isArrayOperator(operator) {
    const normalized = normalizeOperator(operator);
    return exports.ARRAY_OPERATORS.has(normalized) || exports.ARRAY_OPERATORS.has(operator);
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
function extractFilterValue(rawVal) {
    if ((0, query_types_1.isComplexFilterValue)(rawVal)) {
        const complexVal = rawVal;
        // For now, we only handle 'literal' valType
        // TODO: Implement support for 'propRef' and 'expression' valTypes
        if (complexVal.valType && complexVal.valType !== 'literal') {
            logger.warn(`Unsupported valType '${complexVal.valType}', treating as literal`, { complexVal });
        }
        return complexVal.val;
    }
    return rawVal;
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
function shouldCoerceToNumber(val, operator) {
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
function normalizeToArray(val) {
    if (Array.isArray(val)) {
        return val;
    }
    return [val];
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
function isOperatorAlias(operator, coreOperator) {
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
function getOperatorAliases(coreOperator) {
    const aliases = Object.entries(exports.OPERATOR_ALIASES)
        .filter(([_alias, core]) => core === coreOperator)
        .map(([alias]) => alias);
    return [coreOperator, ...aliases];
}
/**
 * Validates if an operator is supported (either core or has a valid alias).
 *
 * @param operator - The operator to validate
 * @returns True if the operator is supported
 */
function isValidOperator(operator) {
    return isCoreOperator(operator) || operator in exports.OPERATOR_ALIASES;
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
function createOperatorMatcher(operators) {
    const coreOps = new Set(operators);
    return (operator) => {
        const normalized = normalizeOperator(operator);
        return coreOps.has(normalized);
    };
}
// Create operator matcher functions using shared utilities
exports.isEqualityOp = createOperatorMatcher(['eq']);
exports.isInequalityOp = createOperatorMatcher(['neq']);
exports.isGreaterThanOp = createOperatorMatcher(['gt']);
exports.isGreaterThanOrEqualOp = createOperatorMatcher(['gte']);
exports.isLessThanOp = createOperatorMatcher(['lt']);
exports.isLessThanOrEqualOp = createOperatorMatcher(['lte']);
exports.isRangeOp = createOperatorMatcher(['bt', 'between']);
exports.isStringPatternOp = createOperatorMatcher(['startsWith']);
exports.isContainsOp = createOperatorMatcher(['contains']);
exports.isNotContainsOp = createOperatorMatcher(['notContains']);
exports.isInOp = createOperatorMatcher(['in']);
exports.isNotInOp = createOperatorMatcher(['nin']);
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
function normalizeRangeValue(val) {
    if (Array.isArray(val) && val.length >= 2) {
        return [val[0], val[1]];
    }
    if (val && typeof val === 'object' && 'from' in val && 'to' in val) {
        return [val.from, val.to];
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
function coerceValue(val, operator) {
    if (shouldCoerceToNumber(val, operator)) {
        return Number(val);
    }
    return val;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktdXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L3F1ZXJ5LXV0aWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQWdJQSw4Q0FFQztBQVFELHdDQUVDO0FBUUQsOENBRUM7QUFRRCwwQ0FHQztBQXNCRCxnREFjQztBQWlCRCxvREFJQztBQWdCRCw0Q0FLQztBQWlCRCwwQ0FFQztBQWNELGdEQU1DO0FBUUQsMENBRUM7QUFpQkQsc0RBTUM7QUE2QkQsa0RBUUM7QUFTRCxrQ0FLQztBQTFXRCwrQ0FBc0c7QUFDdEcsd0NBQTBDO0FBRTFDLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxZQUFZLENBQUMsQ0FBQztBQUUxQzs7O0dBR0c7QUFDVSxRQUFBLHNCQUFzQixHQUFHLG9CQUFvQixDQUFDO0FBRTNEOztHQUVHO0FBQ1UsUUFBQSwrQkFBK0IsR0FBRztJQUM3QyxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSztJQUMxRSxhQUFhLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUUsY0FBYyxFQUFFLFNBQVM7Q0FDbEYsQ0FBQztBQUVGOzs7R0FHRztBQUNVLFFBQUEsZ0JBQWdCLEdBQTJCO0lBQ3RELG1CQUFtQjtJQUNuQixTQUFTLEVBQUUsSUFBSTtJQUNmLE9BQU8sRUFBRSxJQUFJO0lBQ2IsS0FBSyxFQUFFLElBQUk7SUFDWCxJQUFJLEVBQUUsSUFBSTtJQUVWLHFCQUFxQjtJQUNyQixZQUFZLEVBQUUsS0FBSztJQUNuQixVQUFVLEVBQUUsS0FBSztJQUNqQixLQUFLLEVBQUUsS0FBSztJQUNaLElBQUksRUFBRSxLQUFLO0lBQ1gsSUFBSSxFQUFFLEtBQUs7SUFDWCxJQUFJLEVBQUUsS0FBSztJQUVYLHFCQUFxQjtJQUNyQixhQUFhLEVBQUUsSUFBSTtJQUNuQixhQUFhLEVB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SUFBSSxNQUFNLElBQUksR0FBRyxJQUFJLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNuRSxPQUFPLENBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFFLENBQUM7SUFDOUIsQ0FBQztJQUNELE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3hFLENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFnQixXQUFXLENBQUMsR0FBUSxFQUFFLFFBQWdCO0lBQ3BELElBQUksb0JBQW9CLENBQUMsR0FBRyxFQUFFLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDeEMsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDckIsQ0FBQztJQUNELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZpbHRlck9wZXJhdG9yVmFsdWUsIENvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlLCBpc0NvbXBsZXhGaWx0ZXJWYWx1ZSB9IGZyb20gJy4vcXVlcnktdHlwZXMnO1xuaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5cbmNvbnN0IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcignUXVlcnlVdGlscycpO1xuXG4vKipcbiAqIFJlZ3VsYXIgZXhwcmVzc2lvbiBwYXR0ZXJuIHVzZWQgdG8gcGFyc2UgdmFsdWUgZGVsaW1pdGVycy5cbiAqIFRoZSBwYXR0ZXJuIG1hdGNoZXMgYW55IG9mIHRoZSBmb2xsb3dpbmcgY2hhcmFjdGVyczogJiwgLCwgKywgOywgOiwgb3IgLi5cbiAqL1xuZXhwb3J0IGNvbnN0IFBBUlNFX1ZBTFVFX0RFTElNSVRFUlMgPSAvKD86JnwsfFxcK3w7fDp8XFwuKSsvO1xuXG4vKipcbiAqIEFuIGFycmF5IG9mIGZpbHRlciBrZXlzIHRoYXQgY2FuIGhhdmUgYXJyYXkgdmFsdWVzLlxuICovXG5leHBvcnQgY29uc3QgRklMVEVSX0tFWVNfSEFWSU5HX0FSUkFZX1ZBTFVFUyA9IFtcbiAgJ2luJywgJ2luTGlzdCcsICduaW4nLCAnbm90SW4nLCAnbm90SW5MaXN0JywgJ2NvbnRhaW5zJywgJ2luY2x1ZGVzJywgJ2hhcycsXG4gICdub3RDb250YWlucycsICdub3RJbmNsdWRlcycsICdub3RIYXMnLCAnY29udGFpbnNTb21lJywgJ2luY2x1ZGVzU29tZScsICdoYXNTb21lJ1xuXTtcblxuLyoqXG4gKiBDb21wcmVoZW5zaXZlIG9wZXJhdG9yIGFsaWFzIG1hcHBpbmcgLSBtYXBzIGFsbCBleHRlbmRlZCBvcGVyYXRvcnMgdG8gdGhlaXIgY29yZSBlcXVpdmFsZW50cy5cbiAqIFRoaXMgY29uc29saWRhdGVzIHRoZSBzY2F0dGVyZWQgYWxpYXMgbG9naWMgZnJvbSBtdWx0aXBsZSBmaWxlcyBpbnRvIGEgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aC5cbiAqL1xuZXhwb3J0IGNvbnN0IE9QRVJBVE9SX0FMSUFTRVM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIC8vIEVxdWFsaXR5IGFsaWFzZXNcbiAgJ2VxdWFsVG8nOiAnZXEnLFxuICAnZXF1YWwnOiAnZXEnLFxuICAnPT09JzogJ2VxJyxcbiAgJz09JzogJ2VxJyxcblxuICAvLyBJbmVxdWFsaXR5IGFsaWFzZXNcbiAgJ25vdEVxdWFsVG8nOiAnbmVxJyxcbiAgJ25vdEVxdWFsJzogJ25lcScsXG4gICchPT0nOiAnbmVxJyxcbiAgJyE9JzogJ25lcScsXG4gICc8Pic6ICduZXEnLFxuICAnbmUnOiAnbmVxJyxcblxuICAvLyBDb21wYXJpc29uIGFsaWFzZXNcbiAgJ2dyZWF0ZXJUaGFuJzogJ2d0JyxcbiAgJ2dyZWF0ZXJUaGVuJzogJ2d0JyxcbiAgJz4nOiAnZ3QnLFxuXG4gICdncmVhdGVyVGhhbk9yRXF1YWxUbyc6ICdndGUnLFxuICAnZ3JlYXRlclRoZW5PckVxdWFsVG8nOiAnZ3RlJyxcbiAgJz49JzogJ2d0ZScsXG4gICc+PT0nOiAnZ3RlJyxcblxuICAnbGVzc1RoYW4nOiAnbHQnLFxuICAnbGVzc1RoZW4nOiAnbHQnLFxuICAnPCc6ICdsdCcsXG5cbiAgJ2xlc3NUaGFuT3JFcXVhbFRvJzogJ2x0ZScsXG4gICdsZXNzVGhlbk9yRXF1YWxUbyc6ICdsdGUnLFxuICAnPD0nOiAnbHRlJyxcbiAgJzw9PSc6ICdsdGUnLFxuXG4gIC8vIFJhbmdlIGFsaWFzZXNcbiAgJ2JldHdlZW4nOiAnYnQnLFxuICAnYncnOiAnYnQnLFxuICAnPjwnOiAnYnQnLFxuXG4gIC8vIExpc3QgYWxpYXNlc1xuICAnaW5MaXN0JzogJ2luJyxcbiAgJ25vdEluTGlzdCc6ICduaW4nLFxuICAnbm90SW4nOiAnbmluJyxcblxuICAvLyBTdHJpbmcgcGF0dGVybiBhbGlhc2VzXG4gICdiZWdpbnMnOiAnc3RhcnRzV2l0aCcsXG4gICdiZWdpbnNXaXRoJzogJ3N0YXJ0c1dpdGgnLFxuICAvLyBOb3RlOiAnbGlrZScgaXMgaW50ZW50aW9uYWxseSBub3QgbWFwcGVkIGhlcmUgYXMgZGlmZmVyZW50IHN5c3RlbXMgaGFuZGxlIGl0IGRpZmZlcmVudGx5XG4gIC8vIE1laWxpU2VhcmNoIHVzZXMgJ2NvbnRhaW5zJyBhcHByb3hpbWF0aW9uLCBFbGVjdHJvREIgdXNlcyAnc3RhcnRzV2l0aCcsIGV0Yy5cblxuICAvLyBDb250YWlucyBhbGlhc2VzXG4gICdpbmNsdWRlcyc6ICdjb250YWlucycsXG4gICdoYXMnOiAnY29udGFpbnMnLFxuICAnaW5jbHVkZXNTb21lJzogJ2NvbnRhaW5zU29tZScsXG4gICdoYXNTb21lJzogJ2NvbnRhaW5zU29tZScsXG4gICdub3RJbmNsdWRlcyc6ICdub3RDb250YWlucycsXG4gICdub3RIYXMnOiAnbm90Q29udGFpbnMnLFxuXG4gIC8vIEV4aXN0ZW5jZSBjaGVjayAtIG1hcHMgdG8gRHluYW1vREIgYXR0cmlidXRlX2V4aXN0cy9hdHRyaWJ1dGVfbm90X2V4aXN0c1xuICAnZXhpc3RzJzogJ2V4aXN0cycsXG4gICdub3RFeGlzdHMnOiAnbm90RXhpc3RzJyxcbiAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eSBhbGlhc2VzXG4gICdpc051bGwnOiAnbm90RXhpc3RzJyxcbiAgJ25vdE51bGwnOiAnZXhpc3RzJyxcbiAgJ2VtcHR5JzogJ25vdEV4aXN0cycsXG4gICdub3RFbXB0eSc6ICdleGlzdHMnLFxufTtcblxuLyoqXG4gKiBDb3JlIGZpbHRlciBvcGVyYXRvcnMgdGhhdCBkb24ndCBuZWVkIGFsaWFzIHJlc29sdXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBDT1JFX09QRVJBVE9SUyA9IG5ldyBTZXQoW1xuICAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnaW4nLCAnbmluJywgJ2J0JyxcbiAgJ2V4aXN0cycsICdub3RFeGlzdHMnLCAnaXNOdWxsJywgJ25vdE51bGwnLCAnZW1wdHknLCAnbm90RW1wdHknLFxuICAnY29udGFpbnMnLCAnbm90Q29udGFpbnMnLCAnY29udGFpbnNTb21lJywgJ2xpa2UnLCAnZW5kc1dpdGgnLCAnc3RhcnRzV2l0aCdcbl0pO1xuXG4vKipcbiAqIE9wZXJhdG9ycyB0aGF0IHR5cGljYWxseSByZXF1aXJlIG51bWVyaWMgY29tcGFyaXNvbiBhbmQgbWF5IG5lZWQgdHlwZSBjb2VyY2lvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IE5VTUVSSUNfQ09NUEFSSVNPTl9PUEVSQVRPUlMgPSBuZXcgU2V0KFtcbiAgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYnQnLCAnYmV0d2Vlbidcbl0pO1xuXG4vKipcbiAqIE9wZXJhdG9ycyB0aGF0IHdvcmsgd2l0aCBhcnJheSB2YWx1ZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBBUlJBWV9PUEVSQVRPUlMgPSBuZXcgU2V0KFtcbiAgJ2luJywgJ25pbicsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ25vdEluJywgJ2NvbnRhaW5zJywgJ25vdENvbnRhaW5zJyxcbiAgJ2NvbnRhaW5zU29tZScsICdpbmNsdWRlcycsICdoYXMnLCAnbm90SW5jbHVkZXMnLCAnbm90SGFzJywgJ2luY2x1ZGVzU29tZScsICdoYXNTb21lJ1xuXSk7XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIGZpbHRlciBvcGVyYXRvciB0byBpdHMgY29yZSBlcXVpdmFsZW50IHVzaW5nIHRoZSBhbGlhcyBtYXBwaW5nLlxuICogXG4gKiBAcGFyYW0gb3BlcmF0b3IgLSBUaGUgb3BlcmF0b3IgdG8gbm9ybWFsaXplXG4gKiBAcmV0dXJucyBUaGUgY29yZSBvcGVyYXRvciBuYW1lXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogbm9ybWFsaXplT3BlcmF0b3IoJ2VxdWFsVG8nKSAvLyByZXR1cm5zICdlcSdcbiAqIG5vcm1hbGl6ZU9wZXJhdG9yKCc+PScpIC8vIHJldHVybnMgJ2d0ZSdcbiAqIG5vcm1hbGl6ZU9wZXJhdG9yKCdlcScpIC8vIHJldHVybnMgJ2VxJyAoYWxyZWFkeSBjb3JlKVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVPcGVyYXRvcihvcGVyYXRvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIE9QRVJBVE9SX0FMSUFTRVNbIG9wZXJhdG9yIF0gfHwgb3BlcmF0b3I7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGFuIG9wZXJhdG9yIGlzIGEgY29yZSBvcGVyYXRvciAoZG9lc24ndCBuZWVkIGFsaWFzIHJlc29sdXRpb24pLlxuICogXG4gKiBAcGFyYW0gb3BlcmF0b3IgLSBUaGUgb3BlcmF0b3IgdG8gY2hlY2tcbiAqIEByZXR1cm5zIFRydWUgaWYgaXQncyBhIGNvcmUgb3BlcmF0b3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQ29yZU9wZXJhdG9yKG9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIENPUkVfT1BFUkFUT1JTLmhhcyhvcGVyYXRvcik7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGFuIG9wZXJhdG9yIHR5cGljYWxseSByZXF1aXJlcyBudW1lcmljIGNvbXBhcmlzb24uXG4gKiBcbiAqIEBwYXJhbSBvcGVyYXRvciAtIFRoZSBvcGVyYXRvciB0byBjaGVjayAoc2hvdWxkIGJlIG5vcm1hbGl6ZWQgZmlyc3QpXG4gKiBAcmV0dXJucyBUcnVlIGlmIGl0J3MgYSBudW1lcmljIGNvbXBhcmlzb24gb3BlcmF0b3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTnVtZXJpY09wZXJhdG9yKG9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIE5VTUVSSUNfQ09NUEFSSVNPTl9PUEVSQVRPUlMuaGFzKG9wZXJhdG9yKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYW4gb3BlcmF0b3Igd29ya3Mgd2l0aCBhcnJheSB2YWx1ZXMuXG4gKiBcbiAqIEBwYXJhbSBvcGVyYXRvciAtIFRoZSBvcGVyYXRvciB0byBjaGVjayAoY2FuIGJlIGFsaWFzIG9yIGNvcmUpXG4gKiBAcmV0dXJucyBUcnVlIGlmIGl0J3MgYW4gYXJyYXkgb3BlcmF0b3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQXJyYXlPcGVyYXRvcihvcGVyYXRvcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVPcGVyYXRvcihvcGVyYXRvcik7XG4gIHJldHVybiBBUlJBWV9PUEVSQVRPUlMuaGFzKG5vcm1hbGl6ZWQpIHx8IEFSUkFZX09QRVJBVE9SUy5oYXMob3BlcmF0b3IpO1xufVxuXG4vKipcbiAqIEV4dHJhY3RzIHRoZSBhY3R1YWwgdmFsdWUgZnJvbSBhIEZpbHRlck9wZXJhdG9yVmFsdWUsIGhhbmRsaW5nIENvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlIHN0cnVjdHVyZS5cbiAqIFRoaXMgY29uc29saWRhdGVzIHRoZSBjb21wbGV4IHZhbHVlIGV4dHJhY3Rpb24gbG9naWMgdXNlZCBhY3Jvc3MgZGlmZmVyZW50IGZpbHRlciBzeXN0ZW1zLlxuICogXG4gKiBAcGFyYW0gcmF3VmFsIC0gVGhlIHJhdyBmaWx0ZXIgdmFsdWUgdGhhdCBtaWdodCBiZSBjb21wbGV4XG4gKiBAcmV0dXJucyBUaGUgZXh0cmFjdGVkIGFjdHVhbCB2YWx1ZVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIC8vIFNpbXBsZSB2YWx1ZVxuICogZXh0cmFjdEZpbHRlclZhbHVlKFwidGVzdFwiKSAvLyByZXR1cm5zIFwidGVzdFwiXG4gKiBcbiAqIC8vIENvbXBsZXggdmFsdWVcbiAqIGV4dHJhY3RGaWx0ZXJWYWx1ZSh7XG4gKiAgIHZhbDogXCJhY3R1YWxfdmFsdWVcIixcbiAqICAgdmFsVHlwZTogXCJsaXRlcmFsXCIsXG4gKiAgIHZhbExhYmVsOiBcIkRpc3BsYXkgTGFiZWxcIlxuICogfSkgLy8gcmV0dXJucyBcImFjdHVhbF92YWx1ZVwiXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RGaWx0ZXJWYWx1ZTxUPihyYXdWYWw6IEZpbHRlck9wZXJhdG9yVmFsdWU8VD4pOiBUIHtcbiAgaWYgKGlzQ29tcGxleEZpbHRlclZhbHVlKHJhd1ZhbCkpIHtcbiAgICBjb25zdCBjb21wbGV4VmFsID0gcmF3VmFsIGFzIENvbXBsZXhGaWx0ZXJPcGVyYXRvclZhbHVlPFQ+O1xuXG4gICAgLy8gRm9yIG5vdywgd2Ugb25seSBoYW5kbGUgJ2xpdGVyYWwnIHZhbFR5cGVcbiAgICAvLyBUT0RPOiBJbXBsZW1lbnQgc3VwcG9ydCBmb3IgJ3Byb3BSZWYnIGFuZCAnZXhwcmVzc2lvbicgdmFsVHlwZXNcbiAgICBpZiAoY29tcGxleFZhbC52YWxUeXBlICYmIGNvbXBsZXhWYWwudmFsVHlwZSAhPT0gJ2xpdGVyYWwnKSB7XG4gICAgICBsb2dnZXIud2FybihgVW5zdXBwb3J0ZWQgdmFsVHlwZSAnJHtjb21wbGV4VmFsLnZhbFR5cGV9JywgdHJlYXRpbmcgYXMgbGl0ZXJhbGAsIHsgY29tcGxleFZhbCB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGxleFZhbC52YWw7XG4gIH1cblxuICByZXR1cm4gcmF3VmFsIGFzIFQ7XG59XG5cbi8qKlxuICogRGV0ZXJtaW5lcyBpZiBhIHZhbHVlIHNob3VsZCBiZSB0cmVhdGVkIGFzIG51bWVyaWMgZm9yIGNvbXBhcmlzb24gb3BlcmF0aW9ucy5cbiAqIFRoaXMgaGVscHMgd2l0aCB0eXBlIGNvZXJjaW9uIGRlY2lzaW9ucyBhY3Jvc3MgZGlmZmVyZW50IGZpbHRlciBzeXN0ZW1zLlxuICogXG4gKiBAcGFyYW0gdmFsIC0gVGhlIHZhbHVlIHRvIGNoZWNrXG4gKiBAcGFyYW0gb3BlcmF0b3IgLSBUaGUgb3BlcmF0b3IgYmVpbmcgdXNlZCAoc2hvdWxkIGJlIG5vcm1hbGl6ZWQpXG4gKiBAcmV0dXJucyBUcnVlIGlmIHRoZSB2YWx1ZSBzaG91bGQgYmUgY29lcmNlZCB0byBudW1iZXJcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBzaG91bGRDb2VyY2VUb051bWJlcihcIjEyM1wiLCBcImd0XCIpIC8vIHJldHVybnMgdHJ1ZVxuICogc2hvdWxkQ29lcmNlVG9OdW1iZXIoXCJhYmNcIiwgXCJndFwiKSAvLyByZXR1cm5zIGZhbHNlXG4gKiBzaG91bGRDb2VyY2VUb051bWJlcihcIjEyM1wiLCBcImVxXCIpIC8vIHJldHVybnMgZmFsc2VcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkQ29lcmNlVG9OdW1iZXIodmFsOiBhbnksIG9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3Qgbm9ybWFsaXplZE9wID0gbm9ybWFsaXplT3BlcmF0b3Iob3BlcmF0b3IpO1xuICByZXR1cm4gaXNOdW1lcmljT3BlcmF0b3Iobm9ybWFsaXplZE9wKSAmJlxuICAgICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJyB8fCAodHlwZW9mIHZhbCA9PT0gJ3N0cmluZycgJiYgIWlzTmFOKE51bWJlcih2YWwpKSkpO1xufVxuXG4vKipcbiAqIFNhZmVseSBjb252ZXJ0cyBhcnJheS1saWtlIHZhbHVlcyB0byBwcm9wZXIgYXJyYXlzLlxuICogVGhpcyBub3JtYWxpemVzIHNpbmdsZSB2YWx1ZXMgdG8gYXJyYXlzIGZvciBvcGVyYXRvcnMgdGhhdCBleHBlY3QgYXJyYXlzLlxuICogXG4gKiBAcGFyYW0gdmFsIC0gVGhlIHZhbHVlIHRvIG5vcm1hbGl6ZVxuICogQHJldHVybnMgQW4gYXJyYXkgY29udGFpbmluZyB0aGUgdmFsdWUocylcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBub3JtYWxpemVUb0FycmF5KFwic2luZ2xlXCIpIC8vIHJldHVybnMgW1wic2luZ2xlXCJdXG4gKiBub3JtYWxpemVUb0FycmF5KFtcImFcIiwgXCJiXCJdKSAvLyByZXR1cm5zIFtcImFcIiwgXCJiXCJdXG4gKiBub3JtYWxpemVUb0FycmF5KG51bGwpIC8vIHJldHVybnMgW251bGxdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVRvQXJyYXk8VD4odmFsOiBUIHwgVFtdKTogVFtdIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkge1xuICAgIHJldHVybiB2YWw7XG4gIH1cbiAgcmV0dXJuIFsgdmFsIF07XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGEgZmlsdGVyIGtleS9vcGVyYXRvciBpcyBpbiBhIGdpdmVuIGxpc3Qgb2YgYWxpYXNlcy5cbiAqIFRoaXMgcmVwbGFjZXMgdGhlIHJlcGV0aXRpdmUgWyAnZXF1YWxUbycsICdlcXVhbCcsICdlcScsICc9PScsICc9PT0nIF0uaW5jbHVkZXMoZmlsdGVyS2V5KSBwYXR0ZXJucy5cbiAqIFxuICogQHBhcmFtIG9wZXJhdG9yIC0gVGhlIG9wZXJhdG9yIHRvIGNoZWNrXG4gKiBAcGFyYW0gY29yZU9wZXJhdG9yIC0gVGhlIGNvcmUgb3BlcmF0b3IgdG8gbWF0Y2ggYWdhaW5zdFxuICogQHJldHVybnMgVHJ1ZSBpZiB0aGUgb3BlcmF0b3IgbWFwcyB0byB0aGUgY29yZSBvcGVyYXRvclxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGlzT3BlcmF0b3JBbGlhcygnZXF1YWxUbycsICdlcScpIC8vIHJldHVybnMgdHJ1ZVxuICogaXNPcGVyYXRvckFsaWFzKCc9PScsICdlcScpIC8vIHJldHVybnMgdHJ1ZVxuICogaXNPcGVyYXRvckFsaWFzKCdndCcsICdlcScpIC8vIHJldHVybnMgZmFsc2VcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNPcGVyYXRvckFsaWFzKG9wZXJhdG9yOiBzdHJpbmcsIGNvcmVPcGVyYXRvcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBub3JtYWxpemVPcGVyYXRvcihvcGVyYXRvcikgPT09IGNvcmVPcGVyYXRvcjtcbn1cblxuLyoqXG4gKiBHZXRzIGFsbCBhbGlhc2VzIGZvciBhIGdpdmVuIGNvcmUgb3BlcmF0b3IuXG4gKiBVc2VmdWwgZm9yIHZhbGlkYXRpb24gb3IgVUkgcHVycG9zZXMuXG4gKiBcbiAqIEBwYXJhbSBjb3JlT3BlcmF0b3IgLSBUaGUgY29yZSBvcGVyYXRvclxuICogQHJldHVybnMgQXJyYXkgb2YgYWxsIGFsaWFzZXMgKGluY2x1ZGluZyB0aGUgY29yZSBvcGVyYXRvciBpdHNlbGYpXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogZ2V0T3BlcmF0b3JBbGlhc2VzKCdlcScpIC8vIHJldHVybnMgWydlcScsICdlcXVhbFRvJywgJ2VxdWFsJywgJz09PScsICc9PSddXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE9wZXJhdG9yQWxpYXNlcyhjb3JlT3BlcmF0b3I6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgYWxpYXNlcyA9IE9iamVjdC5lbnRyaWVzKE9QRVJBVE9SX0FMSUFTRVMpXG4gICAgLmZpbHRlcigoWyBfYWxpYXMsIGNvcmUgXSkgPT4gY29yZSA9PT0gY29yZU9wZXJhdG9yKVxuICAgIC5tYXAoKFsgYWxpYXMgXSkgPT4gYWxpYXMpO1xuXG4gIHJldHVybiBbIGNvcmVPcGVyYXRvciwgLi4uYWxpYXNlcyBdO1xufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBpZiBhbiBvcGVyYXRvciBpcyBzdXBwb3J0ZWQgKGVpdGhlciBjb3JlIG9yIGhhcyBhIHZhbGlkIGFsaWFzKS5cbiAqIFxuICogQHBhcmFtIG9wZXJhdG9yIC0gVGhlIG9wZXJhdG9yIHRvIHZhbGlkYXRlXG4gKiBAcmV0dXJucyBUcnVlIGlmIHRoZSBvcGVyYXRvciBpcyBzdXBwb3J0ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRPcGVyYXRvcihvcGVyYXRvcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBpc0NvcmVPcGVyYXRvcihvcGVyYXRvcikgfHwgb3BlcmF0b3IgaW4gT1BFUkFUT1JfQUxJQVNFUztcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgaGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIGEgZmlsdGVyIGtleSBtYXRjaGVzIGFueSBvZiB0aGUgZ2l2ZW4gY29yZSBvcGVyYXRvcnMuXG4gKiBUaGlzIHJlcGxhY2VzIGNvbXBsZXggY29uZGl0aW9uYWwgY2hhaW5zIHdpdGggYSBtb3JlIHJlYWRhYmxlIGFwcHJvYWNoLlxuICogXG4gKiBAcGFyYW0gb3BlcmF0b3JzIC0gQXJyYXkgb2YgY29yZSBvcGVyYXRvcnMgdG8gbWF0Y2ggYWdhaW5zdFxuICogQHJldHVybnMgRnVuY3Rpb24gdGhhdCBjaGVja3MgaWYgYSBnaXZlbiBvcGVyYXRvciBtYXRjaGVzIGFueSBvZiB0aGUgY29yZSBvcGVyYXRvcnNcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBjb25zdCBpc0VxdWFsaXR5T3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWydlcScsICduZXEnXSk7XG4gKiBpc0VxdWFsaXR5T3AoJ2VxdWFsVG8nKSAvLyByZXR1cm5zIHRydWUgKG1hcHMgdG8gJ2VxJylcbiAqIGlzRXF1YWxpdHlPcCgnIT0nKSAvLyByZXR1cm5zIHRydWUgKG1hcHMgdG8gJ25lcScpXG4gKiBpc0VxdWFsaXR5T3AoJ2d0JykgLy8gcmV0dXJucyBmYWxzZVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVPcGVyYXRvck1hdGNoZXIob3BlcmF0b3JzOiBzdHJpbmdbXSkge1xuICBjb25zdCBjb3JlT3BzID0gbmV3IFNldChvcGVyYXRvcnMpO1xuICByZXR1cm4gKG9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplT3BlcmF0b3Iob3BlcmF0b3IpO1xuICAgIHJldHVybiBjb3JlT3BzLmhhcyhub3JtYWxpemVkKTtcbiAgfTtcbn1cblxuLy8gQ3JlYXRlIG9wZXJhdG9yIG1hdGNoZXIgZnVuY3Rpb25zIHVzaW5nIHNoYXJlZCB1dGlsaXRpZXNcbmV4cG9ydCBjb25zdCBpc0VxdWFsaXR5T3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnZXEnIF0pO1xuZXhwb3J0IGNvbnN0IGlzSW5lcXVhbGl0eU9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ25lcScgXSk7XG5leHBvcnQgY29uc3QgaXNHcmVhdGVyVGhhbk9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ2d0JyBdKTtcbmV4cG9ydCBjb25zdCBpc0dyZWF0ZXJUaGFuT3JFcXVhbE9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ2d0ZScgXSk7XG5leHBvcnQgY29uc3QgaXNMZXNzVGhhbk9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ2x0JyBdKTtcbmV4cG9ydCBjb25zdCBpc0xlc3NUaGFuT3JFcXVhbE9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ2x0ZScgXSk7XG5leHBvcnQgY29uc3QgaXNSYW5nZU9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ2J0JywgJ2JldHdlZW4nIF0pO1xuZXhwb3J0IGNvbnN0IGlzU3RyaW5nUGF0dGVybk9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ3N0YXJ0c1dpdGgnIF0pO1xuZXhwb3J0IGNvbnN0IGlzQ29udGFpbnNPcCA9IGNyZWF0ZU9wZXJhdG9yTWF0Y2hlcihbICdjb250YWlucycgXSk7XG5leHBvcnQgY29uc3QgaXNOb3RDb250YWluc09wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ25vdENvbnRhaW5zJyBdKTtcbmV4cG9ydCBjb25zdCBpc0luT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnaW4nIF0pO1xuZXhwb3J0IGNvbnN0IGlzTm90SW5PcCA9IGNyZWF0ZU9wZXJhdG9yTWF0Y2hlcihbICduaW4nIF0pO1xuXG4vKipcbiAqIFJhbmdlIHZhbHVlIGhlbHBlciAtIG5vcm1hbGl6ZXMgZGlmZmVyZW50IHJhbmdlIHZhbHVlIGZvcm1hdHMgdG8gYSBjb25zaXN0ZW50IHN0cnVjdHVyZS5cbiAqIEhhbmRsZXMgYm90aCBbbWluLCBtYXhdIGFycmF5cyBhbmQge2Zyb20sIHRvfSBvYmplY3RzLlxuICogXG4gKiBAcGFyYW0gdmFsIC0gVGhlIHJhbmdlIHZhbHVlIGluIHZhcmlvdXMgZm9ybWF0c1xuICogQHJldHVybnMgVHVwbGUgb2YgW21pbiwgbWF4XSB2YWx1ZXNcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBub3JtYWxpemVSYW5nZVZhbHVlKFsxLCAxMF0pIC8vIHJldHVybnMgWzEsIDEwXVxuICogbm9ybWFsaXplUmFuZ2VWYWx1ZSh7ZnJvbTogNSwgdG86IDE1fSkgLy8gcmV0dXJucyBbNSwgMTVdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVJhbmdlVmFsdWUodmFsOiBhbnkpOiBbIGFueSwgYW55IF0ge1xuICBpZiAoQXJyYXkuaXNBcnJheSh2YWwpICYmIHZhbC5sZW5ndGggPj0gMikge1xuICAgIHJldHVybiBbIHZhbFsgMCBdLCB2YWxbIDEgXSBdO1xuICB9XG4gIGlmICh2YWwgJiYgdHlwZW9mIHZhbCA9PT0gJ29iamVjdCcgJiYgJ2Zyb20nIGluIHZhbCAmJiAndG8nIGluIHZhbCkge1xuICAgIHJldHVybiBbIHZhbC5mcm9tLCB2YWwudG8gXTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmFuZ2UgdmFsdWUgZm9ybWF0OiAke0pTT04uc3RyaW5naWZ5KHZhbCl9YCk7XG59XG5cbi8qKlxuICogVHlwZS1zYWZlIGNvZXJjaW9uIGZ1bmN0aW9uIHRoYXQgb25seSBjb252ZXJ0cyB3aGVuIGFwcHJvcHJpYXRlLlxuICogXG4gKiBAcGFyYW0gdmFsIC0gVGhlIHZhbHVlIHRvIHBvdGVudGlhbGx5IGNvZXJjZVxuICogQHBhcmFtIG9wZXJhdG9yIC0gVGhlIG9wZXJhdG9yIGNvbnRleHRcbiAqIEByZXR1cm5zIFRoZSBjb2VyY2VkIHZhbHVlIG9yIG9yaWdpbmFsIHZhbHVlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb2VyY2VWYWx1ZSh2YWw6IGFueSwgb3BlcmF0b3I6IHN0cmluZyk6IGFueSB7XG4gIGlmIChzaG91bGRDb2VyY2VUb051bWJlcih2YWwsIG9wZXJhdG9yKSkge1xuICAgIHJldHVybiBOdW1iZXIodmFsKTtcbiAgfVxuICByZXR1cm4gdmFsO1xufSAiXX0=