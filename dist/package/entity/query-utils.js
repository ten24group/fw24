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
    // Existence aliases
    'exists': 'exists', // Keep as-is, special handling needed per context
};
/**
 * Core filter operators that don't need alias resolution.
 */
exports.CORE_OPERATORS = new Set([
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'bt',
    'isNull', 'isEmpty', 'exists', 'contains', 'notContains',
    'containsSome', 'like', 'endsWith', 'startsWith'
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktdXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZW50aXR5L3F1ZXJ5LXV0aWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQTBIQSw4Q0FFQztBQVFELHdDQUVDO0FBUUQsOENBRUM7QUFRRCwwQ0FHQztBQXNCRCxnREFjQztBQWlCRCxvREFJQztBQWdCRCw0Q0FLQztBQWlCRCwwQ0FFQztBQWNELGdEQU1DO0FBUUQsMENBRUM7QUFpQkQsc0RBTUM7QUE2QkQsa0RBUUM7QUFTRCxrQ0FLQztBQXBXRCwrQ0FBc0c7QUFDdEcsd0NBQTBDO0FBRTFDLE1BQU0sTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxZQUFZLENBQUMsQ0FBQztBQUUxQzs7O0dBR0c7QUFDVSxRQUFBLHNCQUFzQixHQUFHLG9CQUFvQixDQUFDO0FBRTNEOztHQUVHO0FBQ1UsUUFBQSwrQkFBK0IsR0FBRztJQUM3QyxJQUFJLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsS0FBSztJQUMxRSxhQUFhLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUUsY0FBYyxFQUFFLFNBQVM7Q0FDbEYsQ0FBQztBQUVGOzs7R0FHRztBQUNVLFFBQUEsZ0JBQWdCLEdBQTJCO0lBQ3RELG1CQUFtQjtJQUNuQixTQUFTLEVBQUUsSUFBSTtJQUNmLE9BQU8sRUFBRSxJQUFJO0lBQ2IsS0FBSyxFQUFFLElBQUk7SUFDWCxJQUFJLEVBQUUsSUFBSTtJQUVWLHFCQUFxQjtJQUNyQixZQUFZLEVBQUUsS0FBSztJQUNuQixVQUFVLEVBQUUsS0FBSztJQUNqQixLQUFLLEVBQUUsS0FBSztJQUNaLElBQUksRUFBRSxLQUFLO0lBQ1gsSUFBSSxFQUFFLEtBQUs7SUFDWCxJQUFJLEVBQUUsS0FBSztJQUVYLHFCQUFxQjtJQUNyQixhQUFhLEVBQUUsSUFBSTtJQUNuQixhQUFhLEVB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LEtBQUssQ0FBQywrQkFBK0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDeEUsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQWdCLFdBQVcsQ0FBQyxHQUFRLEVBQUUsUUFBZ0I7SUFDcEQsSUFBSSxvQkFBb0IsQ0FBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLEVBQUUsQ0FBQztRQUN4QyxPQUFPLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyQixDQUFDO0lBQ0QsT0FBTyxHQUFHLENBQUM7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRmlsdGVyT3BlcmF0b3JWYWx1ZSwgQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWUsIGlzQ29tcGxleEZpbHRlclZhbHVlIH0gZnJvbSAnLi9xdWVyeS10eXBlcyc7XG5pbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tICcuLi9sb2dnaW5nJztcblxuY29uc3QgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCdRdWVyeVV0aWxzJyk7XG5cbi8qKlxuICogUmVndWxhciBleHByZXNzaW9uIHBhdHRlcm4gdXNlZCB0byBwYXJzZSB2YWx1ZSBkZWxpbWl0ZXJzLlxuICogVGhlIHBhdHRlcm4gbWF0Y2hlcyBhbnkgb2YgdGhlIGZvbGxvd2luZyBjaGFyYWN0ZXJzOiAmLCAsLCArLCA7LCA6LCBvciAuLlxuICovXG5leHBvcnQgY29uc3QgUEFSU0VfVkFMVUVfREVMSU1JVEVSUyA9IC8oPzomfCx8XFwrfDt8OnxcXC4pKy87XG5cbi8qKlxuICogQW4gYXJyYXkgb2YgZmlsdGVyIGtleXMgdGhhdCBjYW4gaGF2ZSBhcnJheSB2YWx1ZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBGSUxURVJfS0VZU19IQVZJTkdfQVJSQVlfVkFMVUVTID0gW1xuICAnaW4nLCAnaW5MaXN0JywgJ25pbicsICdub3RJbicsICdub3RJbkxpc3QnLCAnY29udGFpbnMnLCAnaW5jbHVkZXMnLCAnaGFzJyxcbiAgJ25vdENvbnRhaW5zJywgJ25vdEluY2x1ZGVzJywgJ25vdEhhcycsICdjb250YWluc1NvbWUnLCAnaW5jbHVkZXNTb21lJywgJ2hhc1NvbWUnXG5dO1xuXG4vKipcbiAqIENvbXByZWhlbnNpdmUgb3BlcmF0b3IgYWxpYXMgbWFwcGluZyAtIG1hcHMgYWxsIGV4dGVuZGVkIG9wZXJhdG9ycyB0byB0aGVpciBjb3JlIGVxdWl2YWxlbnRzLlxuICogVGhpcyBjb25zb2xpZGF0ZXMgdGhlIHNjYXR0ZXJlZCBhbGlhcyBsb2dpYyBmcm9tIG11bHRpcGxlIGZpbGVzIGludG8gYSBzaW5nbGUgc291cmNlIG9mIHRydXRoLlxuICovXG5leHBvcnQgY29uc3QgT1BFUkFUT1JfQUxJQVNFUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgLy8gRXF1YWxpdHkgYWxpYXNlc1xuICAnZXF1YWxUbyc6ICdlcScsXG4gICdlcXVhbCc6ICdlcScsXG4gICc9PT0nOiAnZXEnLFxuICAnPT0nOiAnZXEnLFxuXG4gIC8vIEluZXF1YWxpdHkgYWxpYXNlc1xuICAnbm90RXF1YWxUbyc6ICduZXEnLFxuICAnbm90RXF1YWwnOiAnbmVxJyxcbiAgJyE9PSc6ICduZXEnLFxuICAnIT0nOiAnbmVxJyxcbiAgJzw+JzogJ25lcScsXG4gICduZSc6ICduZXEnLFxuXG4gIC8vIENvbXBhcmlzb24gYWxpYXNlc1xuICAnZ3JlYXRlclRoYW4nOiAnZ3QnLFxuICAnZ3JlYXRlclRoZW4nOiAnZ3QnLFxuICAnPic6ICdndCcsXG5cbiAgJ2dyZWF0ZXJUaGFuT3JFcXVhbFRvJzogJ2d0ZScsXG4gICdncmVhdGVyVGhlbk9yRXF1YWxUbyc6ICdndGUnLFxuICAnPj0nOiAnZ3RlJyxcbiAgJz49PSc6ICdndGUnLFxuXG4gICdsZXNzVGhhbic6ICdsdCcsXG4gICdsZXNzVGhlbic6ICdsdCcsXG4gICc8JzogJ2x0JyxcblxuICAnbGVzc1RoYW5PckVxdWFsVG8nOiAnbHRlJyxcbiAgJ2xlc3NUaGVuT3JFcXVhbFRvJzogJ2x0ZScsXG4gICc8PSc6ICdsdGUnLFxuICAnPD09JzogJ2x0ZScsXG5cbiAgLy8gUmFuZ2UgYWxpYXNlc1xuICAnYmV0d2Vlbic6ICdidCcsXG4gICdidyc6ICdidCcsXG4gICc+PCc6ICdidCcsXG5cbiAgLy8gTGlzdCBhbGlhc2VzXG4gICdpbkxpc3QnOiAnaW4nLFxuICAnbm90SW5MaXN0JzogJ25pbicsXG4gICdub3RJbic6ICduaW4nLFxuXG4gIC8vIFN0cmluZyBwYXR0ZXJuIGFsaWFzZXNcbiAgJ2JlZ2lucyc6ICdzdGFydHNXaXRoJyxcbiAgJ2JlZ2luc1dpdGgnOiAnc3RhcnRzV2l0aCcsXG4gIC8vIE5vdGU6ICdsaWtlJyBpcyBpbnRlbnRpb25hbGx5IG5vdCBtYXBwZWQgaGVyZSBhcyBkaWZmZXJlbnQgc3lzdGVtcyBoYW5kbGUgaXQgZGlmZmVyZW50bHlcbiAgLy8gTWVpbGlTZWFyY2ggdXNlcyAnY29udGFpbnMnIGFwcHJveGltYXRpb24sIEVsZWN0cm9EQiB1c2VzICdzdGFydHNXaXRoJywgZXRjLlxuXG4gIC8vIENvbnRhaW5zIGFsaWFzZXNcbiAgJ2luY2x1ZGVzJzogJ2NvbnRhaW5zJyxcbiAgJ2hhcyc6ICdjb250YWlucycsXG4gICdpbmNsdWRlc1NvbWUnOiAnY29udGFpbnNTb21lJyxcbiAgJ2hhc1NvbWUnOiAnY29udGFpbnNTb21lJyxcbiAgJ25vdEluY2x1ZGVzJzogJ25vdENvbnRhaW5zJyxcbiAgJ25vdEhhcyc6ICdub3RDb250YWlucycsXG5cbiAgLy8gRXhpc3RlbmNlIGFsaWFzZXNcbiAgJ2V4aXN0cyc6ICdleGlzdHMnLCAvLyBLZWVwIGFzLWlzLCBzcGVjaWFsIGhhbmRsaW5nIG5lZWRlZCBwZXIgY29udGV4dFxufTtcblxuLyoqXG4gKiBDb3JlIGZpbHRlciBvcGVyYXRvcnMgdGhhdCBkb24ndCBuZWVkIGFsaWFzIHJlc29sdXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBDT1JFX09QRVJBVE9SUyA9IG5ldyBTZXQoW1xuICAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnaW4nLCAnbmluJywgJ2J0JyxcbiAgJ2lzTnVsbCcsICdpc0VtcHR5JywgJ2V4aXN0cycsICdjb250YWlucycsICdub3RDb250YWlucycsXG4gICdjb250YWluc1NvbWUnLCAnbGlrZScsICdlbmRzV2l0aCcsICdzdGFydHNXaXRoJ1xuXSk7XG5cbi8qKlxuICogT3BlcmF0b3JzIHRoYXQgdHlwaWNhbGx5IHJlcXVpcmUgbnVtZXJpYyBjb21wYXJpc29uIGFuZCBtYXkgbmVlZCB0eXBlIGNvZXJjaW9uLlxuICovXG5leHBvcnQgY29uc3QgTlVNRVJJQ19DT01QQVJJU09OX09QRVJBVE9SUyA9IG5ldyBTZXQoW1xuICAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdidCcsICdiZXR3ZWVuJ1xuXSk7XG5cbi8qKlxuICogT3BlcmF0b3JzIHRoYXQgd29yayB3aXRoIGFycmF5IHZhbHVlcy5cbiAqL1xuZXhwb3J0IGNvbnN0IEFSUkFZX09QRVJBVE9SUyA9IG5ldyBTZXQoW1xuICAnaW4nLCAnbmluJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnbm90SW4nLCAnY29udGFpbnMnLCAnbm90Q29udGFpbnMnLFxuICAnY29udGFpbnNTb21lJywgJ2luY2x1ZGVzJywgJ2hhcycsICdub3RJbmNsdWRlcycsICdub3RIYXMnLCAnaW5jbHVkZXNTb21lJywgJ2hhc1NvbWUnXG5dKTtcblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgZmlsdGVyIG9wZXJhdG9yIHRvIGl0cyBjb3JlIGVxdWl2YWxlbnQgdXNpbmcgdGhlIGFsaWFzIG1hcHBpbmcuXG4gKiBcbiAqIEBwYXJhbSBvcGVyYXRvciAtIFRoZSBvcGVyYXRvciB0byBub3JtYWxpemVcbiAqIEByZXR1cm5zIFRoZSBjb3JlIG9wZXJhdG9yIG5hbWVcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBub3JtYWxpemVPcGVyYXRvcignZXF1YWxUbycpIC8vIHJldHVybnMgJ2VxJ1xuICogbm9ybWFsaXplT3BlcmF0b3IoJz49JykgLy8gcmV0dXJucyAnZ3RlJ1xuICogbm9ybWFsaXplT3BlcmF0b3IoJ2VxJykgLy8gcmV0dXJucyAnZXEnIChhbHJlYWR5IGNvcmUpXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZU9wZXJhdG9yKG9wZXJhdG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gT1BFUkFUT1JfQUxJQVNFU1sgb3BlcmF0b3IgXSB8fCBvcGVyYXRvcjtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYW4gb3BlcmF0b3IgaXMgYSBjb3JlIG9wZXJhdG9yIChkb2Vzbid0IG5lZWQgYWxpYXMgcmVzb2x1dGlvbikuXG4gKiBcbiAqIEBwYXJhbSBvcGVyYXRvciAtIFRoZSBvcGVyYXRvciB0byBjaGVja1xuICogQHJldHVybnMgVHJ1ZSBpZiBpdCdzIGEgY29yZSBvcGVyYXRvclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNDb3JlT3BlcmF0b3Iob3BlcmF0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gQ09SRV9PUEVSQVRPUlMuaGFzKG9wZXJhdG9yKTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYW4gb3BlcmF0b3IgdHlwaWNhbGx5IHJlcXVpcmVzIG51bWVyaWMgY29tcGFyaXNvbi5cbiAqIFxuICogQHBhcmFtIG9wZXJhdG9yIC0gVGhlIG9wZXJhdG9yIHRvIGNoZWNrIChzaG91bGQgYmUgbm9ybWFsaXplZCBmaXJzdClcbiAqIEByZXR1cm5zIFRydWUgaWYgaXQncyBhIG51bWVyaWMgY29tcGFyaXNvbiBvcGVyYXRvclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNOdW1lcmljT3BlcmF0b3Iob3BlcmF0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gTlVNRVJJQ19DT01QQVJJU09OX09QRVJBVE9SUy5oYXMob3BlcmF0b3IpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBhbiBvcGVyYXRvciB3b3JrcyB3aXRoIGFycmF5IHZhbHVlcy5cbiAqIFxuICogQHBhcmFtIG9wZXJhdG9yIC0gVGhlIG9wZXJhdG9yIHRvIGNoZWNrIChjYW4gYmUgYWxpYXMgb3IgY29yZSlcbiAqIEByZXR1cm5zIFRydWUgaWYgaXQncyBhbiBhcnJheSBvcGVyYXRvclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBcnJheU9wZXJhdG9yKG9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZU9wZXJhdG9yKG9wZXJhdG9yKTtcbiAgcmV0dXJuIEFSUkFZX09QRVJBVE9SUy5oYXMobm9ybWFsaXplZCkgfHwgQVJSQVlfT1BFUkFUT1JTLmhhcyhvcGVyYXRvcik7XG59XG5cbi8qKlxuICogRXh0cmFjdHMgdGhlIGFjdHVhbCB2YWx1ZSBmcm9tIGEgRmlsdGVyT3BlcmF0b3JWYWx1ZSwgaGFuZGxpbmcgQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWUgc3RydWN0dXJlLlxuICogVGhpcyBjb25zb2xpZGF0ZXMgdGhlIGNvbXBsZXggdmFsdWUgZXh0cmFjdGlvbiBsb2dpYyB1c2VkIGFjcm9zcyBkaWZmZXJlbnQgZmlsdGVyIHN5c3RlbXMuXG4gKiBcbiAqIEBwYXJhbSByYXdWYWwgLSBUaGUgcmF3IGZpbHRlciB2YWx1ZSB0aGF0IG1pZ2h0IGJlIGNvbXBsZXhcbiAqIEByZXR1cm5zIFRoZSBleHRyYWN0ZWQgYWN0dWFsIHZhbHVlXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogLy8gU2ltcGxlIHZhbHVlXG4gKiBleHRyYWN0RmlsdGVyVmFsdWUoXCJ0ZXN0XCIpIC8vIHJldHVybnMgXCJ0ZXN0XCJcbiAqIFxuICogLy8gQ29tcGxleCB2YWx1ZVxuICogZXh0cmFjdEZpbHRlclZhbHVlKHtcbiAqICAgdmFsOiBcImFjdHVhbF92YWx1ZVwiLFxuICogICB2YWxUeXBlOiBcImxpdGVyYWxcIixcbiAqICAgdmFsTGFiZWw6IFwiRGlzcGxheSBMYWJlbFwiXG4gKiB9KSAvLyByZXR1cm5zIFwiYWN0dWFsX3ZhbHVlXCJcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdEZpbHRlclZhbHVlPFQ+KHJhd1ZhbDogRmlsdGVyT3BlcmF0b3JWYWx1ZTxUPik6IFQge1xuICBpZiAoaXNDb21wbGV4RmlsdGVyVmFsdWUocmF3VmFsKSkge1xuICAgIGNvbnN0IGNvbXBsZXhWYWwgPSByYXdWYWwgYXMgQ29tcGxleEZpbHRlck9wZXJhdG9yVmFsdWU8VD47XG5cbiAgICAvLyBGb3Igbm93LCB3ZSBvbmx5IGhhbmRsZSAnbGl0ZXJhbCcgdmFsVHlwZVxuICAgIC8vIFRPRE86IEltcGxlbWVudCBzdXBwb3J0IGZvciAncHJvcFJlZicgYW5kICdleHByZXNzaW9uJyB2YWxUeXBlc1xuICAgIGlmIChjb21wbGV4VmFsLnZhbFR5cGUgJiYgY29tcGxleFZhbC52YWxUeXBlICE9PSAnbGl0ZXJhbCcpIHtcbiAgICAgIGxvZ2dlci53YXJuKGBVbnN1cHBvcnRlZCB2YWxUeXBlICcke2NvbXBsZXhWYWwudmFsVHlwZX0nLCB0cmVhdGluZyBhcyBsaXRlcmFsYCwgeyBjb21wbGV4VmFsIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjb21wbGV4VmFsLnZhbDtcbiAgfVxuXG4gIHJldHVybiByYXdWYWwgYXMgVDtcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmVzIGlmIGEgdmFsdWUgc2hvdWxkIGJlIHRyZWF0ZWQgYXMgbnVtZXJpYyBmb3IgY29tcGFyaXNvbiBvcGVyYXRpb25zLlxuICogVGhpcyBoZWxwcyB3aXRoIHR5cGUgY29lcmNpb24gZGVjaXNpb25zIGFjcm9zcyBkaWZmZXJlbnQgZmlsdGVyIHN5c3RlbXMuXG4gKiBcbiAqIEBwYXJhbSB2YWwgLSBUaGUgdmFsdWUgdG8gY2hlY2tcbiAqIEBwYXJhbSBvcGVyYXRvciAtIFRoZSBvcGVyYXRvciBiZWluZyB1c2VkIChzaG91bGQgYmUgbm9ybWFsaXplZClcbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIHZhbHVlIHNob3VsZCBiZSBjb2VyY2VkIHRvIG51bWJlclxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIHNob3VsZENvZXJjZVRvTnVtYmVyKFwiMTIzXCIsIFwiZ3RcIikgLy8gcmV0dXJucyB0cnVlXG4gKiBzaG91bGRDb2VyY2VUb051bWJlcihcImFiY1wiLCBcImd0XCIpIC8vIHJldHVybnMgZmFsc2VcbiAqIHNob3VsZENvZXJjZVRvTnVtYmVyKFwiMTIzXCIsIFwiZXFcIikgLy8gcmV0dXJucyBmYWxzZVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRDb2VyY2VUb051bWJlcih2YWw6IGFueSwgb3BlcmF0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBub3JtYWxpemVkT3AgPSBub3JtYWxpemVPcGVyYXRvcihvcGVyYXRvcik7XG4gIHJldHVybiBpc051bWVyaWNPcGVyYXRvcihub3JtYWxpemVkT3ApICYmXG4gICAgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInIHx8ICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJyAmJiAhaXNOYU4oTnVtYmVyKHZhbCkpKSk7XG59XG5cbi8qKlxuICogU2FmZWx5IGNvbnZlcnRzIGFycmF5LWxpa2UgdmFsdWVzIHRvIHByb3BlciBhcnJheXMuXG4gKiBUaGlzIG5vcm1hbGl6ZXMgc2luZ2xlIHZhbHVlcyB0byBhcnJheXMgZm9yIG9wZXJhdG9ycyB0aGF0IGV4cGVjdCBhcnJheXMuXG4gKiBcbiAqIEBwYXJhbSB2YWwgLSBUaGUgdmFsdWUgdG8gbm9ybWFsaXplXG4gKiBAcmV0dXJucyBBbiBhcnJheSBjb250YWluaW5nIHRoZSB2YWx1ZShzKVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIG5vcm1hbGl6ZVRvQXJyYXkoXCJzaW5nbGVcIikgLy8gcmV0dXJucyBbXCJzaW5nbGVcIl1cbiAqIG5vcm1hbGl6ZVRvQXJyYXkoW1wiYVwiLCBcImJcIl0pIC8vIHJldHVybnMgW1wiYVwiLCBcImJcIl1cbiAqIG5vcm1hbGl6ZVRvQXJyYXkobnVsbCkgLy8gcmV0dXJucyBbbnVsbF1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplVG9BcnJheTxUPih2YWw6IFQgfCBUW10pOiBUW10ge1xuICBpZiAoQXJyYXkuaXNBcnJheSh2YWwpKSB7XG4gICAgcmV0dXJuIHZhbDtcbiAgfVxuICByZXR1cm4gWyB2YWwgXTtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYSBmaWx0ZXIga2V5L29wZXJhdG9yIGlzIGluIGEgZ2l2ZW4gbGlzdCBvZiBhbGlhc2VzLlxuICogVGhpcyByZXBsYWNlcyB0aGUgcmVwZXRpdGl2ZSBbICdlcXVhbFRvJywgJ2VxdWFsJywgJ2VxJywgJz09JywgJz09PScgXS5pbmNsdWRlcyhmaWx0ZXJLZXkpIHBhdHRlcm5zLlxuICogXG4gKiBAcGFyYW0gb3BlcmF0b3IgLSBUaGUgb3BlcmF0b3IgdG8gY2hlY2tcbiAqIEBwYXJhbSBjb3JlT3BlcmF0b3IgLSBUaGUgY29yZSBvcGVyYXRvciB0byBtYXRjaCBhZ2FpbnN0XG4gKiBAcmV0dXJucyBUcnVlIGlmIHRoZSBvcGVyYXRvciBtYXBzIHRvIHRoZSBjb3JlIG9wZXJhdG9yXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0c1xuICogaXNPcGVyYXRvckFsaWFzKCdlcXVhbFRvJywgJ2VxJykgLy8gcmV0dXJucyB0cnVlXG4gKiBpc09wZXJhdG9yQWxpYXMoJz09JywgJ2VxJykgLy8gcmV0dXJucyB0cnVlXG4gKiBpc09wZXJhdG9yQWxpYXMoJ2d0JywgJ2VxJykgLy8gcmV0dXJucyBmYWxzZVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc09wZXJhdG9yQWxpYXMob3BlcmF0b3I6IHN0cmluZywgY29yZU9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIG5vcm1hbGl6ZU9wZXJhdG9yKG9wZXJhdG9yKSA9PT0gY29yZU9wZXJhdG9yO1xufVxuXG4vKipcbiAqIEdldHMgYWxsIGFsaWFzZXMgZm9yIGEgZ2l2ZW4gY29yZSBvcGVyYXRvci5cbiAqIFVzZWZ1bCBmb3IgdmFsaWRhdGlvbiBvciBVSSBwdXJwb3Nlcy5cbiAqIFxuICogQHBhcmFtIGNvcmVPcGVyYXRvciAtIFRoZSBjb3JlIG9wZXJhdG9yXG4gKiBAcmV0dXJucyBBcnJheSBvZiBhbGwgYWxpYXNlcyAoaW5jbHVkaW5nIHRoZSBjb3JlIG9wZXJhdG9yIGl0c2VsZilcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHRzXG4gKiBnZXRPcGVyYXRvckFsaWFzZXMoJ2VxJykgLy8gcmV0dXJucyBbJ2VxJywgJ2VxdWFsVG8nLCAnZXF1YWwnLCAnPT09JywgJz09J11cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0T3BlcmF0b3JBbGlhc2VzKGNvcmVPcGVyYXRvcjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBhbGlhc2VzID0gT2JqZWN0LmVudHJpZXMoT1BFUkFUT1JfQUxJQVNFUylcbiAgICAuZmlsdGVyKChbIF9hbGlhcywgY29yZSBdKSA9PiBjb3JlID09PSBjb3JlT3BlcmF0b3IpXG4gICAgLm1hcCgoWyBhbGlhcyBdKSA9PiBhbGlhcyk7XG5cbiAgcmV0dXJuIFsgY29yZU9wZXJhdG9yLCAuLi5hbGlhc2VzIF07XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGlmIGFuIG9wZXJhdG9yIGlzIHN1cHBvcnRlZCAoZWl0aGVyIGNvcmUgb3IgaGFzIGEgdmFsaWQgYWxpYXMpLlxuICogXG4gKiBAcGFyYW0gb3BlcmF0b3IgLSBUaGUgb3BlcmF0b3IgdG8gdmFsaWRhdGVcbiAqIEByZXR1cm5zIFRydWUgaWYgdGhlIG9wZXJhdG9yIGlzIHN1cHBvcnRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZE9wZXJhdG9yKG9wZXJhdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGlzQ29yZU9wZXJhdG9yKG9wZXJhdG9yKSB8fCBvcGVyYXRvciBpbiBPUEVSQVRPUl9BTElBU0VTO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBoZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgYSBmaWx0ZXIga2V5IG1hdGNoZXMgYW55IG9mIHRoZSBnaXZlbiBjb3JlIG9wZXJhdG9ycy5cbiAqIFRoaXMgcmVwbGFjZXMgY29tcGxleCBjb25kaXRpb25hbCBjaGFpbnMgd2l0aCBhIG1vcmUgcmVhZGFibGUgYXBwcm9hY2guXG4gKiBcbiAqIEBwYXJhbSBvcGVyYXRvcnMgLSBBcnJheSBvZiBjb3JlIG9wZXJhdG9ycyB0byBtYXRjaCBhZ2FpbnN0XG4gKiBAcmV0dXJucyBGdW5jdGlvbiB0aGF0IGNoZWNrcyBpZiBhIGdpdmVuIG9wZXJhdG9yIG1hdGNoZXMgYW55IG9mIHRoZSBjb3JlIG9wZXJhdG9yc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIGNvbnN0IGlzRXF1YWxpdHlPcCA9IGNyZWF0ZU9wZXJhdG9yTWF0Y2hlcihbJ2VxJywgJ25lcSddKTtcbiAqIGlzRXF1YWxpdHlPcCgnZXF1YWxUbycpIC8vIHJldHVybnMgdHJ1ZSAobWFwcyB0byAnZXEnKVxuICogaXNFcXVhbGl0eU9wKCchPScpIC8vIHJldHVybnMgdHJ1ZSAobWFwcyB0byAnbmVxJylcbiAqIGlzRXF1YWxpdHlPcCgnZ3QnKSAvLyByZXR1cm5zIGZhbHNlXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU9wZXJhdG9yTWF0Y2hlcihvcGVyYXRvcnM6IHN0cmluZ1tdKSB7XG4gIGNvbnN0IGNvcmVPcHMgPSBuZXcgU2V0KG9wZXJhdG9ycyk7XG4gIHJldHVybiAob3BlcmF0b3I6IHN0cmluZyk6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVPcGVyYXRvcihvcGVyYXRvcik7XG4gICAgcmV0dXJuIGNvcmVPcHMuaGFzKG5vcm1hbGl6ZWQpO1xuICB9O1xufVxuXG4vLyBDcmVhdGUgb3BlcmF0b3IgbWF0Y2hlciBmdW5jdGlvbnMgdXNpbmcgc2hhcmVkIHV0aWxpdGllc1xuZXhwb3J0IGNvbnN0IGlzRXF1YWxpdHlPcCA9IGNyZWF0ZU9wZXJhdG9yTWF0Y2hlcihbICdlcScgXSk7XG5leHBvcnQgY29uc3QgaXNJbmVxdWFsaXR5T3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnbmVxJyBdKTtcbmV4cG9ydCBjb25zdCBpc0dyZWF0ZXJUaGFuT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnZ3QnIF0pO1xuZXhwb3J0IGNvbnN0IGlzR3JlYXRlclRoYW5PckVxdWFsT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnZ3RlJyBdKTtcbmV4cG9ydCBjb25zdCBpc0xlc3NUaGFuT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnbHQnIF0pO1xuZXhwb3J0IGNvbnN0IGlzTGVzc1RoYW5PckVxdWFsT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnbHRlJyBdKTtcbmV4cG9ydCBjb25zdCBpc1JhbmdlT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnYnQnLCAnYmV0d2VlbicgXSk7XG5leHBvcnQgY29uc3QgaXNTdHJpbmdQYXR0ZXJuT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnc3RhcnRzV2l0aCcgXSk7XG5leHBvcnQgY29uc3QgaXNDb250YWluc09wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ2NvbnRhaW5zJyBdKTtcbmV4cG9ydCBjb25zdCBpc05vdENvbnRhaW5zT3AgPSBjcmVhdGVPcGVyYXRvck1hdGNoZXIoWyAnbm90Q29udGFpbnMnIF0pO1xuZXhwb3J0IGNvbnN0IGlzSW5PcCA9IGNyZWF0ZU9wZXJhdG9yTWF0Y2hlcihbICdpbicgXSk7XG5leHBvcnQgY29uc3QgaXNOb3RJbk9wID0gY3JlYXRlT3BlcmF0b3JNYXRjaGVyKFsgJ25pbicgXSk7XG5cbi8qKlxuICogUmFuZ2UgdmFsdWUgaGVscGVyIC0gbm9ybWFsaXplcyBkaWZmZXJlbnQgcmFuZ2UgdmFsdWUgZm9ybWF0cyB0byBhIGNvbnNpc3RlbnQgc3RydWN0dXJlLlxuICogSGFuZGxlcyBib3RoIFttaW4sIG1heF0gYXJyYXlzIGFuZCB7ZnJvbSwgdG99IG9iamVjdHMuXG4gKiBcbiAqIEBwYXJhbSB2YWwgLSBUaGUgcmFuZ2UgdmFsdWUgaW4gdmFyaW91cyBmb3JtYXRzXG4gKiBAcmV0dXJucyBUdXBsZSBvZiBbbWluLCBtYXhdIHZhbHVlc1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHNcbiAqIG5vcm1hbGl6ZVJhbmdlVmFsdWUoWzEsIDEwXSkgLy8gcmV0dXJucyBbMSwgMTBdXG4gKiBub3JtYWxpemVSYW5nZVZhbHVlKHtmcm9tOiA1LCB0bzogMTV9KSAvLyByZXR1cm5zIFs1LCAxNV1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUmFuZ2VWYWx1ZSh2YWw6IGFueSk6IFsgYW55LCBhbnkgXSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbCkgJiYgdmFsLmxlbmd0aCA+PSAyKSB7XG4gICAgcmV0dXJuIFsgdmFsWyAwIF0sIHZhbFsgMSBdIF07XG4gIH1cbiAgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09PSAnb2JqZWN0JyAmJiAnZnJvbScgaW4gdmFsICYmICd0bycgaW4gdmFsKSB7XG4gICAgcmV0dXJuIFsgdmFsLmZyb20sIHZhbC50byBdO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByYW5nZSB2YWx1ZSBmb3JtYXQ6ICR7SlNPTi5zdHJpbmdpZnkodmFsKX1gKTtcbn1cblxuLyoqXG4gKiBUeXBlLXNhZmUgY29lcmNpb24gZnVuY3Rpb24gdGhhdCBvbmx5IGNvbnZlcnRzIHdoZW4gYXBwcm9wcmlhdGUuXG4gKiBcbiAqIEBwYXJhbSB2YWwgLSBUaGUgdmFsdWUgdG8gcG90ZW50aWFsbHkgY29lcmNlXG4gKiBAcGFyYW0gb3BlcmF0b3IgLSBUaGUgb3BlcmF0b3IgY29udGV4dFxuICogQHJldHVybnMgVGhlIGNvZXJjZWQgdmFsdWUgb3Igb3JpZ2luYWwgdmFsdWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvZXJjZVZhbHVlKHZhbDogYW55LCBvcGVyYXRvcjogc3RyaW5nKTogYW55IHtcbiAgaWYgKHNob3VsZENvZXJjZVRvTnVtYmVyKHZhbCwgb3BlcmF0b3IpKSB7XG4gICAgcmV0dXJuIE51bWJlcih2YWwpO1xuICB9XG4gIHJldHVybiB2YWw7XG59ICJdfQ==