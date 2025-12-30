/**
 * Pattern matching utilities for observability rules
 */

const regexCache = new Map<string, RegExp>();
const MAX_CACHE_SIZE = 200;

function getOrCreateRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern);
  if (regex) return regex;

  if (regexCache.size >= MAX_CACHE_SIZE) {
    const firstKey = regexCache.keys().next().value;
    if (firstKey !== undefined) regexCache.delete(firstKey);
  }

  // Regex string form: "/.../i"
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const lastSlash = pattern.lastIndexOf('/');
    const body = pattern.slice(1, lastSlash);
    const flags = pattern.slice(lastSlash + 1);
    try {
      regex = new RegExp(body, flags);
    } catch {
      // Fallback to literal match regex
      regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    }
  } else if (pattern.includes('*')) {
    // Simple wildcard support: "Order.*" -> /^Order\..*$/
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const withWildcards = escaped.replace(/\\\*/g, '.*');
    regex = new RegExp(`^${withWildcards}$`);
  } else {
    // Exact match regex
    regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  }

  regexCache.set(pattern, regex);
  return regex;
}

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
export function matchesPattern(value: string | undefined, pattern: string | undefined): boolean {
  if (!pattern) return true;
  if (value === undefined) return false;

  const regex = getOrCreateRegex(pattern);
  return regex.test(value);
}

/**
 * Replaces a pattern in a value with a replacement string.
 * Supports literal matches, wildcard matches, and regex-like patterns.
 * 
 * @param value - The original value
 * @param pattern - The pattern to match
 * @param replacement - The replacement string
 * @returns The replaced value
 */
export function replacePattern(value: string, pattern: string, replacement: string): string {
  if (!pattern) return value;

  const regex = getOrCreateRegex(pattern);

  // If it's a regex-like pattern or has wildcards, use regex.replace
  if ((pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) || pattern.includes('*')) {
    try {
      return value.replace(regex, replacement);
    } catch {
      return value;
    }
  }

  // Exact match
  return value === pattern ? replacement : value;
}

