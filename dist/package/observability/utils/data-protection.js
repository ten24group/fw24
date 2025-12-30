"use strict";
/**
 * Data Protection for Observability
 *
 * Sensitive data redaction using @hackylabs/deep-redact.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROTECTED_FIELDS = exports.DEFAULT_BLACKLISTED_KEYS = void 0;
exports.redactSensitiveData = redactSensitiveData;
exports.shouldRedactKey = shouldRedactKey;
exports.extendBlacklist = extendBlacklist;
exports.clearRedactorCache = clearRedactorCache;
const deep_redact_1 = require("@hackylabs/deep-redact");
const serialize_1 = require("../../utils/serialize");
/**
 * Default blacklisted keys for sensitive data
 * Covers common authentication, financial, and PII fields
 */
exports.DEFAULT_BLACKLISTED_KEYS = [
    // Authentication & Authorization
    'password',
    'secret',
    'privateKey',
    'authorization',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'clientSecret',
    'bearer',
    'credential',
    'jwt',
    'sessionToken',
    'authToken',
    // Payment & Financial
    'creditCard',
    'cardNumber',
    'cvv',
    'cvc',
    'ssn',
    'socialSecurity',
    'bankAccount',
    'routingNumber',
    'accountNumber',
    'pin',
    // Personal Identifiable Information (PII)
    'email',
    'phone',
    'phoneNumber',
    'dateOfBirth',
    'dob',
    'address',
    'streetAddress',
    'postalCode',
    'zipCode',
    // Headers & Cookies
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
];
/**
 * Default fields to protect in ObservabilityEvent
 */
exports.DEFAULT_PROTECTED_FIELDS = [
    'data',
    'attributes',
    'metadata',
    'context',
];
// ============================================================================
// INTERNAL HELPERS
// ============================================================================
// Cached redactor instances for performance
const redactorCache = new Map();
/**
 * Get or create a cached redactor instance
 */
function getRedactor(config) {
    const blacklistedKeys = config.blacklistedKeys ?? exports.DEFAULT_BLACKLISTED_KEYS;
    // Create a cache key from config
    const cacheKey = JSON.stringify({
        blacklistedKeys: blacklistedKeys.map(k => k.toString()),
        caseSensitiveKeyMatch: config.caseSensitiveKeyMatch,
        replacement: config.replacement,
        fuzzyKeyMatch: config.fuzzyKeyMatch,
    });
    let redactor = redactorCache.get(cacheKey);
    if (!redactor) {
        redactor = new deep_redact_1.DeepRedact({
            blacklistedKeys,
            caseSensitiveKeyMatch: config.caseSensitiveKeyMatch ?? false,
            fuzzyKeyMatch: config.fuzzyKeyMatch ?? true,
            replacement: config.replacement ?? '[REDACTED]',
            remove: false,
            // CRITICAL: retainStructure must be true to ensure nested objects are traversed
            // when a parent key fuzzy-matches a blacklisted key (e.g., 'credentials' matches 'credential')
            retainStructure: true,
        });
        redactorCache.set(cacheKey, redactor);
    }
    return redactor;
}
// ============================================================================
// MAIN FUNCTIONS
// ============================================================================
/**
 * Redact sensitive data from an object
 *
 * @param data - Data to redact
 * @param config - Optional redaction configuration
 * @returns Deep copy of data with sensitive fields redacted
 */
function redactSensitiveData(data, config) {
    if (data === null || data === undefined) {
        return data;
    }
    // If disabled, return as-is
    if (config?.enabled === false) {
        return data;
    }
    const redactor = getRedactor(config ?? {});
    // Create deep copy before redacting (redactor mutates in place)
    const copy = (0, serialize_1.deepCopy)(data);
    return redactor.redact(copy);
}
/**
 * Check if a key should be redacted
 */
function shouldRedactKey(key, config) {
    const blacklistedKeys = config?.blacklistedKeys ?? exports.DEFAULT_BLACKLISTED_KEYS;
    const caseSensitive = config?.caseSensitiveKeyMatch ?? false;
    const fuzzy = config?.fuzzyKeyMatch ?? true;
    const normalizedKey = caseSensitive ? key : key.toLowerCase();
    for (const blacklisted of blacklistedKeys) {
        if (blacklisted instanceof RegExp) {
            if (blacklisted.test(key))
                return true;
        }
        else {
            const normalizedBlacklisted = caseSensitive ? blacklisted : blacklisted.toLowerCase();
            if (fuzzy) {
                // Fuzzy: check if blacklisted is contained in key OR key is contained in blacklisted
                if (normalizedKey.includes(normalizedBlacklisted) || normalizedBlacklisted.includes(normalizedKey)) {
                    return true;
                }
            }
            else {
                // Exact match
                if (normalizedKey === normalizedBlacklisted)
                    return true;
            }
        }
    }
    return false;
}
/**
 * Extend the default blacklist with additional keys
 */
function extendBlacklist(additionalKeys) {
    return [...exports.DEFAULT_BLACKLISTED_KEYS, ...additionalKeys];
}
/**
 * Clear the redactor cache (testing)
 */
function clearRedactorCache() {
    redactorCache.clear();
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvZGF0YS1wcm90ZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUFvSEgsa0RBa0JDO0FBS0QsMENBNEJDO0FBS0QsMENBSUM7QUFLRCxnREFFQztBQXJMRCx3REFBb0Q7QUFDcEQscURBQWlEO0FBR2pEOzs7R0FHRztBQUNVLFFBQUEsd0JBQXdCLEdBQXdCO0lBQzNELGlDQUFpQztJQUNqQyxVQUFVO0lBQ1YsUUFBUTtJQUNSLFlBQVk7SUFDWixlQUFlO0lBQ2YsT0FBTztJQUNQLGFBQWE7SUFDYixjQUFjO0lBQ2QsUUFBUTtJQUNSLGNBQWM7SUFDZCxRQUFRO0lBQ1IsWUFBWTtJQUNaLEtBQUs7SUFDTCxjQUFjO0lBQ2QsV0FBVztJQUVYLHNCQUFzQjtJQUN0QixZQUFZO0lBQ1osWUFBWTtJQUNaLEtBQUs7SUFDTCxLQUFLO0lBQ0wsS0FBSztJQUNMLGdCQUFnQjtJQUNoQixhQUFhO0lBQ2IsZUFBZTtJQUNmLGVBQWU7SUFDZixLQUFLO0lBRUwsMENBQTBDO0lBQzFDLE9BQU87SUFDUCxPQUFPO0lBQ1AsYUFBYTtJQUNiLGFBQWE7SUFDYixLQUFLO0lBQ0wsU0FBUztJQUNULGVBQWU7SUFDZixZQUFZO0lBQ1osU0FBUztJQUVULG9CQUFvQjtJQUNwQixRQUFRO0lBQ1IsWUFBWTtJQUNaLFdBQVc7SUFDWCxjQUFjO0NBQ2YsQ0FBQztBQUVGOztHQUVHO0FBQ1UsUUFBQSx3QkFBd0IsR0FBaUU7SUFDcEcsTUFBTTtJQUNOLFlBQVk7SUFDWixVQUFVO0lBQ1YsU0FBUztDQUNWLENBQUM7QUFFRiwrRUFBK0U7QUFDL0UsbUJBQW1CO0FBQ25CLCtFQUErRTtBQUUvRSw0Q0FBNEM7QUFDNUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLEVBQXNCLENBQUM7QUFFcEQ7O0dBRUc7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QUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDLElBQUkscUJBQXFCLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7b0JBQ25HLE9BQU8sSUFBSSxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sY0FBYztnQkFDZCxJQUFJLGFBQWEsS0FBSyxxQkFBcUI7b0JBQUUsT0FBTyxJQUFJLENBQUM7WUFDM0QsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixlQUFlLENBQzdCLGNBQW1DO0lBRW5DLE9BQU8sQ0FBRSxHQUFHLGdDQUF3QixFQUFFLEdBQUcsY0FBYyxDQUFFLENBQUM7QUFDNUQsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isa0JBQWtCO0lBQ2hDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUN4QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBEYXRhIFByb3RlY3Rpb24gZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogU2Vuc2l0aXZlIGRhdGEgcmVkYWN0aW9uIHVzaW5nIEBoYWNreWxhYnMvZGVlcC1yZWRhY3QuXG4gKi9cblxuaW1wb3J0IHsgRGVlcFJlZGFjdCB9IGZyb20gJ0BoYWNreWxhYnMvZGVlcC1yZWRhY3QnO1xuaW1wb3J0IHsgZGVlcENvcHkgfSBmcm9tICcuLi8uLi91dGlscy9zZXJpYWxpemUnO1xuaW1wb3J0IHR5cGUgeyBEYXRhUHJvdGVjdGlvbkNvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqXG4gKiBEZWZhdWx0IGJsYWNrbGlzdGVkIGtleXMgZm9yIHNlbnNpdGl2ZSBkYXRhXG4gKiBDb3ZlcnMgY29tbW9uIGF1dGhlbnRpY2F0aW9uLCBmaW5hbmNpYWwsIGFuZCBQSUkgZmllbGRzXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVM6IChzdHJpbmcgfCBSZWdFeHApW10gPSBbXG4gIC8vIEF1dGhlbnRpY2F0aW9uICYgQXV0aG9yaXphdGlvblxuICAncGFzc3dvcmQnLFxuICAnc2VjcmV0JyxcbiAgJ3ByaXZhdGVLZXknLFxuICAnYXV0aG9yaXphdGlvbicsXG4gICd0b2tlbicsXG4gICdhY2Nlc3NUb2tlbicsXG4gICdyZWZyZXNoVG9rZW4nLFxuICAnYXBpS2V5JyxcbiAgJ2NsaWVudFNlY3JldCcsXG4gICdiZWFyZXInLFxuICAnY3JlZGVudGlhbCcsXG4gICdqd3QnLFxuICAnc2Vzc2lvblRva2VuJyxcbiAgJ2F1dGhUb2tlbicsXG5cbiAgLy8gUGF5bWVudCAmIEZpbmFuY2lhbFxuICAnY3JlZGl0Q2FyZCcsXG4gICdjYXJkTnVtYmVyJyxcbiAgJ2N2dicsXG4gICdjdmMnLFxuICAnc3NuJyxcbiAgJ3NvY2lhbFNlY3VyaXR5JyxcbiAgJ2JhbmtBY2NvdW50JyxcbiAgJ3JvdXRpbmdOdW1iZXInLFxuICAnYWNjb3VudE51bWJlcicsXG4gICdwaW4nLFxuXG4gIC8vIFBlcnNvbmFsIElkZW50aWZpYWJsZSBJbmZvcm1hdGlvbiAoUElJKVxuICAnZW1haWwnLFxuICAncGhvbmUnLFxuICAncGhvbmVOdW1iZXInLFxuICAnZGF0ZU9mQmlydGgnLFxuICAnZG9iJyxcbiAgJ2FkZHJlc3MnLFxuICAnc3RyZWV0QWRkcmVzcycsXG4gICdwb3N0YWxDb2RlJyxcbiAgJ3ppcENvZGUnLFxuXG4gIC8vIEhlYWRlcnMgJiBDb29raWVzXG4gICdjb29raWUnLFxuICAnc2V0LWNvb2tpZScsXG4gICd4LWFwaS1rZXknLFxuICAneC1hdXRoLXRva2VuJyxcbl07XG5cbi8qKlxuICogRGVmYXVsdCBmaWVsZHMgdG8gcHJvdGVjdCBpbiBPYnNlcnZhYmlsaXR5RXZlbnRcbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPVEVDVEVEX0ZJRUxEUzogKCdkYXRhJyB8ICdhdHRyaWJ1dGVzJyB8ICdtZXRhZGF0YScgfCAnY29udGV4dCcgfCAnZXJyb3InKVtdID0gW1xuICAnZGF0YScsXG4gICdhdHRyaWJ1dGVzJyxcbiAgJ21ldGFkYXRhJyxcbiAgJ2NvbnRleHQnLFxuXTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSU5URVJOQUwgSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBDYWNoZWQgcmVkYWN0b3IgaW5zdGFuY2VzIGZvciBwZXJmb3JtYW5jZVxuY29uc3QgcmVkYWN0b3JDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBEZWVwUmVkYWN0PigpO1xuXG4vKipcbiAqIEdldCBvciBjcmVhdGUgYSBjYWNoZWQgcmVkYWN0b3IgaW5zdGFuY2VcbiAqL1xuZnVuY3Rpb24gZ2V0UmVkYWN0b3IoY29uZmlnOiBQYXJ0aWFsPERhdGFQcm90ZWN0aW9uQ29uZmlnPik6IERlZXBSZWRhY3Qge1xuICBjb25zdCBibGFja2xpc3RlZEtleXMgPSBjb25maWcuYmxhY2tsaXN0ZWRLZXlzID8/IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUztcblxuICAvLyBDcmVhdGUgYSBjYWNoZSBrZXkgZnJvbSBjb25maWdcbiAgY29uc3QgY2FjaGVLZXkgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgYmxhY2tsaXN0ZWRLZXlzOiBibGFja2xpc3RlZEtleXMubWFwKGsgPT4gay50b1N0cmluZygpKSxcbiAgICBjYXNlU2Vuc2l0aXZlS2V5TWF0Y2g6IGNvbmZpZy5jYXNlU2Vuc2l0aXZlS2V5TWF0Y2gsXG4gICAgcmVwbGFjZW1lbnQ6IGNvbmZpZy5yZXBsYWNlbWVudCxcbiAgICBmdXp6eUtleU1hdGNoOiBjb25maWcuZnV6enlLZXlNYXRjaCxcbiAgfSk7XG5cbiAgbGV0IHJlZGFjdG9yID0gcmVkYWN0b3JDYWNoZS5nZXQoY2FjaGVLZXkpO1xuICBpZiAoIXJlZGFjdG9yKSB7XG4gICAgcmVkYWN0b3IgPSBuZXcgRGVlcFJlZGFjdCh7XG4gICAgICBibGFja2xpc3RlZEtleXMsXG4gICAgICBjYXNlU2Vuc2l0aXZlS2V5TWF0Y2g6IGNvbmZpZy5jYXNlU2Vuc2l0aXZlS2V5TWF0Y2ggPz8gZmFsc2UsXG4gICAgICBmdXp6eUtleU1hdGNoOiBjb25maWcuZnV6enlLZXlNYXRjaCA/PyB0cnVlLFxuICAgICAgcmVwbGFjZW1lbnQ6IGNvbmZpZy5yZXBsYWNlbWVudCA/PyAnW1JFREFDVEVEXScsXG4gICAgICByZW1vdmU6IGZhbHNlLFxuICAgICAgLy8gQ1JJVElDQUw6IHJldGFpblN0cnVjdHVyZSBtdXN0IGJlIHRydWUgdG8gZW5zdXJlIG5lc3RlZCBvYmplY3RzIGFyZSB0cmF2ZXJzZWRcbiAgICAgIC8vIHdoZW4gYSBwYXJlbnQga2V5IGZ1enp5LW1hdGNoZXMgYSBibGFja2xpc3RlZCBrZXkgKGUuZy4sICdjcmVkZW50aWFscycgbWF0Y2hlcyAnY3JlZGVudGlhbCcpXG4gICAgICByZXRhaW5TdHJ1Y3R1cmU6IHRydWUsXG4gICAgfSk7XG4gICAgcmVkYWN0b3JDYWNoZS5zZXQoY2FjaGVLZXksIHJlZGFjdG9yKTtcbiAgfVxuICByZXR1cm4gcmVkYWN0b3I7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1BSU4gRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUmVkYWN0IHNlbnNpdGl2ZSBkYXRhIGZyb20gYW4gb2JqZWN0XG4gKiBcbiAqIEBwYXJhbSBkYXRhIC0gRGF0YSB0byByZWRhY3RcbiAqIEBwYXJhbSBjb25maWcgLSBPcHRpb25hbCByZWRhY3Rpb24gY29uZmlndXJhdGlvblxuICogQHJldHVybnMgRGVlcCBjb3B5IG9mIGRhdGEgd2l0aCBzZW5zaXRpdmUgZmllbGRzIHJlZGFjdGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWRhY3RTZW5zaXRpdmVEYXRhPFQ+KFxuICBkYXRhOiBULFxuICBjb25maWc/OiBQYXJ0aWFsPERhdGFQcm90ZWN0aW9uQ29uZmlnPlxuKTogVCB7XG4gIGlmIChkYXRhID09PSBudWxsIHx8IGRhdGEgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBkYXRhO1xuICB9XG5cbiAgLy8gSWYgZGlzYWJsZWQsIHJldHVybiBhcy1pc1xuICBpZiAoY29uZmlnPy5lbmFibGVkID09PSBmYWxzZSkge1xuICAgIHJldHVybiBkYXRhO1xuICB9XG5cbiAgY29uc3QgcmVkYWN0b3IgPSBnZXRSZWRhY3Rvcihjb25maWcgPz8ge30pO1xuXG4gIC8vIENyZWF0ZSBkZWVwIGNvcHkgYmVmb3JlIHJlZGFjdGluZyAocmVkYWN0b3IgbXV0YXRlcyBpbiBwbGFjZSlcbiAgY29uc3QgY29weSA9IGRlZXBDb3B5KGRhdGEpO1xuICByZXR1cm4gcmVkYWN0b3IucmVkYWN0KGNvcHkpIGFzIFQ7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSBrZXkgc2hvdWxkIGJlIHJlZGFjdGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRSZWRhY3RLZXkoXG4gIGtleTogc3RyaW5nLFxuICBjb25maWc/OiBQYXJ0aWFsPERhdGFQcm90ZWN0aW9uQ29uZmlnPlxuKTogYm9vbGVhbiB7XG4gIGNvbnN0IGJsYWNrbGlzdGVkS2V5cyA9IGNvbmZpZz8uYmxhY2tsaXN0ZWRLZXlzID8/IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUztcbiAgY29uc3QgY2FzZVNlbnNpdGl2ZSA9IGNvbmZpZz8uY2FzZVNlbnNpdGl2ZUtleU1hdGNoID8/IGZhbHNlO1xuICBjb25zdCBmdXp6eSA9IGNvbmZpZz8uZnV6enlLZXlNYXRjaCA/PyB0cnVlO1xuXG4gIGNvbnN0IG5vcm1hbGl6ZWRLZXkgPSBjYXNlU2Vuc2l0aXZlID8ga2V5IDoga2V5LnRvTG93ZXJDYXNlKCk7XG5cbiAgZm9yIChjb25zdCBibGFja2xpc3RlZCBvZiBibGFja2xpc3RlZEtleXMpIHtcbiAgICBpZiAoYmxhY2tsaXN0ZWQgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGlmIChibGFja2xpc3RlZC50ZXN0KGtleSkpIHJldHVybiB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkQmxhY2tsaXN0ZWQgPSBjYXNlU2Vuc2l0aXZlID8gYmxhY2tsaXN0ZWQgOiBibGFja2xpc3RlZC50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKGZ1enp5KSB7XG4gICAgICAgIC8vIEZ1enp5OiBjaGVjayBpZiBibGFja2xpc3RlZCBpcyBjb250YWluZWQgaW4ga2V5IE9SIGtleSBpcyBjb250YWluZWQgaW4gYmxhY2tsaXN0ZWRcbiAgICAgICAgaWYgKG5vcm1hbGl6ZWRLZXkuaW5jbHVkZXMobm9ybWFsaXplZEJsYWNrbGlzdGVkKSB8fCBub3JtYWxpemVkQmxhY2tsaXN0ZWQuaW5jbHVkZXMobm9ybWFsaXplZEtleSkpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRXhhY3QgbWF0Y2hcbiAgICAgICAgaWYgKG5vcm1hbGl6ZWRLZXkgPT09IG5vcm1hbGl6ZWRCbGFja2xpc3RlZCkgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIEV4dGVuZCB0aGUgZGVmYXVsdCBibGFja2xpc3Qgd2l0aCBhZGRpdGlvbmFsIGtleXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dGVuZEJsYWNrbGlzdChcbiAgYWRkaXRpb25hbEtleXM6IChzdHJpbmcgfCBSZWdFeHApW11cbik6IChzdHJpbmcgfCBSZWdFeHApW10ge1xuICByZXR1cm4gWyAuLi5ERUZBVUxUX0JMQUNLTElTVEVEX0tFWVMsIC4uLmFkZGl0aW9uYWxLZXlzIF07XG59XG5cbi8qKlxuICogQ2xlYXIgdGhlIHJlZGFjdG9yIGNhY2hlICh0ZXN0aW5nKVxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJSZWRhY3RvckNhY2hlKCk6IHZvaWQge1xuICByZWRhY3RvckNhY2hlLmNsZWFyKCk7XG59XG4iXX0=