"use strict";
/**
 * Pattern matching utilities for observability rules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesPattern = matchesPattern;
exports.replacePattern = replacePattern;
const regexCache = new Map();
const MAX_CACHE_SIZE = 200;
function getOrCreateRegex(pattern) {
    let regex = regexCache.get(pattern);
    if (regex)
        return regex;
    if (regexCache.size >= MAX_CACHE_SIZE) {
        const firstKey = regexCache.keys().next().value;
        if (firstKey !== undefined)
            regexCache.delete(firstKey);
    }
    // Regex string form: "/.../i"
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const lastSlash = pattern.lastIndexOf('/');
        const body = pattern.slice(1, lastSlash);
        const flags = pattern.slice(lastSlash + 1);
        try {
            regex = new RegExp(body, flags);
        }
        catch {
            // Fallback to literal match regex
            regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        }
    }
    else if (pattern.includes('*')) {
        // Simple wildcard support: "Order.*" -> /^Order\..*$/
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const withWildcards = escaped.replace(/\\\*/g, '.*');
        regex = new RegExp(`^${withWildcards}$`);
    }
    else {
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
function matchesPattern(value, pattern) {
    if (!pattern)
        return true;
    if (value === undefined)
        return false;
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
function replacePattern(value, pattern, replacement) {
    if (!pattern)
        return value;
    const regex = getOrCreateRegex(pattern);
    // If it's a regex-like pattern or has wildcards, use regex.replace
    if ((pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) || pattern.includes('*')) {
        try {
            return value.replace(regex, replacement);
        }
        catch {
            return value;
        }
    }
    // Exact match
    return value === pattern ? replacement : value;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0dGVybi11dGlscy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L3V0aWxzL3BhdHRlcm4tdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOztHQUVHOztBQW1ESCx3Q0FNQztBQVdELHdDQWdCQztBQWxGRCxNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztBQUM3QyxNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUM7QUFFM0IsU0FBUyxnQkFBZ0IsQ0FBQyxPQUFlO0lBQ3ZDLElBQUksS0FBSyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDcEMsSUFBSSxLQUFLO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFeEIsSUFBSSxVQUFVLENBQUMsSUFBSSxJQUFJLGNBQWMsRUFBRSxDQUFDO1FBQ3RDLE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLENBQUM7UUFDaEQsSUFBSSxRQUFRLEtBQUssU0FBUztZQUFFLFVBQVUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDMUQsQ0FBQztJQUVELDhCQUE4QjtJQUM5QixJQUFJLE9BQU8sQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLElBQUksT0FBTyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUM1RCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzNDLE1BQU0sSUFBSSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3pDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQzNDLElBQUksQ0FBQztZQUNILEtBQUssR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEMsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLGtDQUFrQztZQUNsQyxLQUFLLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLHFCQUFxQixFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUM1RSxDQUFDO0lBQ0gsQ0FBQztTQUFNLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pDLHNEQUFzRDtRQUN0RCxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLG9CQUFvQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQzlELE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3JELEtBQUssR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUM7SUFDM0MsQ0FBQztTQUFNLENBQUM7UUFDTixvQkFBb0I7UUFDcEIsS0FBSyxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDNUUsQ0FBQztJQUVELFVBQVUsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQy9CLE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVEOzs7Ozs7Ozs7OztHQVdHO0FBQ0gsU0FBZ0IsY0FBYyxDQUFDLEtBQXlCLEVBQUUsT0FBMkI7SUFDbkYsSUFBSSxDQUFDLE9BQU87UUFBRSxPQUFPLElBQUksQ0FBQztJQUMxQixJQUFJLEtBQUssS0FBSyxTQUFTO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFdEMsTUFBTSxLQUFLLEdBQUcsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDeEMsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQzNCLENBQUM7QUFFRDs7Ozs7Ozs7R0FRRztBQUNILFNBQWdCLGNBQWMsQ0FBQyxLQUFhLEVBQUUsT0FBZSxFQUFFLFdBQW1CO0lBQ2hGLElBQUksQ0FBQyxPQUFPO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFFM0IsTUFBTSxLQUFLLEdBQUcsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFeEMsbUVBQW1FO0lBQ25FLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3ZGLElBQUksQ0FBQztZQUNILE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDM0MsQ0FBQztRQUFDLE1BQU0sQ0FBQztZQUNQLE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7SUFFRCxjQUFjO0lBQ2QsT0FBTyxLQUFLLEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQztBQUNqRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQYXR0ZXJuIG1hdGNoaW5nIHV0aWxpdGllcyBmb3Igb2JzZXJ2YWJpbGl0eSBydWxlc1xuICovXG5cbmNvbnN0IHJlZ2V4Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUmVnRXhwPigpO1xuY29uc3QgTUFYX0NBQ0hFX1NJWkUgPSAyMDA7XG5cbmZ1bmN0aW9uIGdldE9yQ3JlYXRlUmVnZXgocGF0dGVybjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlZ2V4ID0gcmVnZXhDYWNoZS5nZXQocGF0dGVybik7XG4gIGlmIChyZWdleCkgcmV0dXJuIHJlZ2V4O1xuXG4gIGlmIChyZWdleENhY2hlLnNpemUgPj0gTUFYX0NBQ0hFX1NJWkUpIHtcbiAgICBjb25zdCBmaXJzdEtleSA9IHJlZ2V4Q2FjaGUua2V5cygpLm5leHQoKS52YWx1ZTtcbiAgICBpZiAoZmlyc3RLZXkgIT09IHVuZGVmaW5lZCkgcmVnZXhDYWNoZS5kZWxldGUoZmlyc3RLZXkpO1xuICB9XG5cbiAgLy8gUmVnZXggc3RyaW5nIGZvcm06IFwiLy4uLi9pXCJcbiAgaWYgKHBhdHRlcm4uc3RhcnRzV2l0aCgnLycpICYmIHBhdHRlcm4ubGFzdEluZGV4T2YoJy8nKSA+IDApIHtcbiAgICBjb25zdCBsYXN0U2xhc2ggPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCcvJyk7XG4gICAgY29uc3QgYm9keSA9IHBhdHRlcm4uc2xpY2UoMSwgbGFzdFNsYXNoKTtcbiAgICBjb25zdCBmbGFncyA9IHBhdHRlcm4uc2xpY2UobGFzdFNsYXNoICsgMSk7XG4gICAgdHJ5IHtcbiAgICAgIHJlZ2V4ID0gbmV3IFJlZ0V4cChib2R5LCBmbGFncyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBGYWxsYmFjayB0byBsaXRlcmFsIG1hdGNoIHJlZ2V4XG4gICAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKX0kYCk7XG4gICAgfVxuICB9IGVsc2UgaWYgKHBhdHRlcm4uaW5jbHVkZXMoJyonKSkge1xuICAgIC8vIFNpbXBsZSB3aWxkY2FyZCBzdXBwb3J0OiBcIk9yZGVyLipcIiAtPiAvXk9yZGVyXFwuLiokL1xuICAgIGNvbnN0IGVzY2FwZWQgPSBwYXR0ZXJuLnJlcGxhY2UoL1suKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICBjb25zdCB3aXRoV2lsZGNhcmRzID0gZXNjYXBlZC5yZXBsYWNlKC9cXFxcXFwqL2csICcuKicpO1xuICAgIHJlZ2V4ID0gbmV3IFJlZ0V4cChgXiR7d2l0aFdpbGRjYXJkc30kYCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gRXhhY3QgbWF0Y2ggcmVnZXhcbiAgICByZWdleCA9IG5ldyBSZWdFeHAoYF4ke3BhdHRlcm4ucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKX0kYCk7XG4gIH1cblxuICByZWdleENhY2hlLnNldChwYXR0ZXJuLCByZWdleCk7XG4gIHJldHVybiByZWdleDtcbn1cblxuLyoqXG4gKiBNYXRjaGVzIGEgdmFsdWUgYWdhaW5zdCBhIHBhdHRlcm4gc3RyaW5nIHdoaWNoIGNhbiBiZSBhIGxpdGVyYWwsIGEgc2ltcGxlIHdpbGRjYXJkIHN0cmluZywgXG4gKiBvciBhIHJlZ2V4LWxpa2Ugc3RyaW5nLlxuICogXG4gKiAtIExpdGVyYWw6IFwiT3JkZXJcIiBtYXRjaGVzIGV4YWN0bHkgXCJPcmRlclwiXG4gKiAtIFdpbGRjYXJkOiBcIk9yZGVyLipcIiBtYXRjaGVzIFwiT3JkZXIuY3JlYXRlZFwiLCBcIk9yZGVyLmRlbGV0ZWRcIlxuICogLSBSZWdleDogXCIvXk9yZGVyXFxcXC4vaVwiIG1hdGNoZXMgXCJvcmRlci5jcmVhdGVkXCJcbiAqIFxuICogQHBhcmFtIHZhbHVlIC0gVGhlIHZhbHVlIHRvIGNoZWNrXG4gKiBAcGFyYW0gcGF0dGVybiAtIFRoZSBwYXR0ZXJuIHRvIG1hdGNoIGFnYWluc3RcbiAqIEByZXR1cm5zIHRydWUgaWYgbWF0Y2hlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2hlc1BhdHRlcm4odmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCwgcGF0dGVybjogc3RyaW5nIHwgdW5kZWZpbmVkKTogYm9vbGVhbiB7XG4gIGlmICghcGF0dGVybikgcmV0dXJuIHRydWU7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgcmVnZXggPSBnZXRPckNyZWF0ZVJlZ2V4KHBhdHRlcm4pO1xuICByZXR1cm4gcmVnZXgudGVzdCh2YWx1ZSk7XG59XG5cbi8qKlxuICogUmVwbGFjZXMgYSBwYXR0ZXJuIGluIGEgdmFsdWUgd2l0aCBhIHJlcGxhY2VtZW50IHN0cmluZy5cbiAqIFN1cHBvcnRzIGxpdGVyYWwgbWF0Y2hlcywgd2lsZGNhcmQgbWF0Y2hlcywgYW5kIHJlZ2V4LWxpa2UgcGF0dGVybnMuXG4gKiBcbiAqIEBwYXJhbSB2YWx1ZSAtIFRoZSBvcmlnaW5hbCB2YWx1ZVxuICogQHBhcmFtIHBhdHRlcm4gLSBUaGUgcGF0dGVybiB0byBtYXRjaFxuICogQHBhcmFtIHJlcGxhY2VtZW50IC0gVGhlIHJlcGxhY2VtZW50IHN0cmluZ1xuICogQHJldHVybnMgVGhlIHJlcGxhY2VkIHZhbHVlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXBsYWNlUGF0dGVybih2YWx1ZTogc3RyaW5nLCBwYXR0ZXJuOiBzdHJpbmcsIHJlcGxhY2VtZW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIXBhdHRlcm4pIHJldHVybiB2YWx1ZTtcblxuICBjb25zdCByZWdleCA9IGdldE9yQ3JlYXRlUmVnZXgocGF0dGVybik7XG5cbiAgLy8gSWYgaXQncyBhIHJlZ2V4LWxpa2UgcGF0dGVybiBvciBoYXMgd2lsZGNhcmRzLCB1c2UgcmVnZXgucmVwbGFjZVxuICBpZiAoKHBhdHRlcm4uc3RhcnRzV2l0aCgnLycpICYmIHBhdHRlcm4ubGFzdEluZGV4T2YoJy8nKSA+IDApIHx8IHBhdHRlcm4uaW5jbHVkZXMoJyonKSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gdmFsdWUucmVwbGFjZShyZWdleCwgcmVwbGFjZW1lbnQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIEV4YWN0IG1hdGNoXG4gIHJldHVybiB2YWx1ZSA9PT0gcGF0dGVybiA/IHJlcGxhY2VtZW50IDogdmFsdWU7XG59XG5cbiJdfQ==