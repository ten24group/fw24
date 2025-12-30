/**
 * Pattern matching utilities for observability rules
 */
/**
 * Matches a value against a pattern string which can be a literal, a simple wildcard string,
 * or a regex-like string.
 *
 * - Literal: "Order" matches exactly "Order"
 * - Wildcard: "Order.*" matches "Order.created", "Order.deleted"
 * - Regex: "/^Order\\./i" matches "order.created"
 *
 * @param value - The value to check
 * @param pattern - The pattern to match against
 * @returns true if matches
 */
export declare function matchesPattern(value: string | undefined, pattern: string | undefined): boolean;
/**
 * Replaces a pattern in a value with a replacement string.
 * Supports literal matches, wildcard matches, and regex-like patterns.
 *
 * @param value - The original value
 * @param pattern - The pattern to match
 * @param replacement - The replacement string
 * @returns The replaced value
 */
export declare function replacePattern(value: string, pattern: string, replacement: string): string;
