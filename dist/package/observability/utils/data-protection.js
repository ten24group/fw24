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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvZGF0YS1wcm90ZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUErSEgsa0RBa0JDO0FBS0QsMENBNEJDO0FBS0QsMENBSUM7QUFLRCxnREFFQztBQWhNRCx3REFBb0Q7QUFDcEQscURBQWlEO0FBY2pEOzs7R0FHRztBQUNVLFFBQUEsd0JBQXdCLEdBQXdCO0lBQzNELGlDQUFpQztJQUNqQyxVQUFVO0lBQ1YsUUFBUTtJQUNSLFlBQVk7SUFDWixlQUFlO0lBQ2YsT0FBTztJQUNQLGFBQWE7SUFDYixjQUFjO0lBQ2QsUUFBUTtJQUNSLGNBQWM7SUFDZCxRQUFRO0lBQ1IsWUFBWTtJQUNaLEtBQUs7SUFDTCxjQUFjO0lBQ2QsV0FBVztJQUVYLHNCQUFzQjtJQUN0QixZQUFZO0lBQ1osWUFBWTtJQUNaLEtBQUs7SUFDTCxLQUFLO0lBQ0wsS0FBSztJQUNMLGdCQUFnQjtJQUNoQixhQUFhO0lBQ2IsZUFBZTtJQUNmLGVBQWU7SUFDZixLQUFLO0lBRUwsMENBQTBDO0lBQzFDLE9BQU87SUFDUCxPQUFPO0lBQ1AsYUFBYTtJQUNiLGFBQWE7SUFDYixLQUFLO0lBQ0wsU0FBUztJQUNULGVBQWU7SUFDZixZQUFZO0lBQ1osU0FBUztJQUVULG9CQUFvQjtJQUNwQixRQUFRO0lBQ1IsWUFBWTtJQUNaLFdBQVc7SUFDWCxjQUFjO0NBQ2YsQ0FBQztBQUVGOztHQUVHO0FBQ1UsUUFBQSx3QkFBd0IsR0FBaUU7SUFDcEcsTUFBTTtJQUNOLFlBQVk7SUFDWixVQUFVO0lBQ1YsU0FBUztDQUNWLENBQUM7QUFFRiwrRUFBK0U7QUFDL0UsbUJBQW1CO0FBQ25CLCtFQUErRTtBQUUvRSw0Q0FBNEM7QUFDNUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxHQUFHLEVBQXNCLENBQUM7QUFFcEQ7O0dBRUc7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QUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDLElBQUkscUJBQXFCLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7b0JBQ25HLE9BQU8sSUFBSSxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sY0FBYztnQkFDZCxJQUFJLGFBQWEsS0FBSyxxQkFBcUI7b0JBQUUsT0FBTyxJQUFJLENBQUM7WUFDM0QsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixlQUFlLENBQzdCLGNBQW1DO0lBRW5DLE9BQU8sQ0FBQyxHQUFHLGdDQUF3QixFQUFFLEdBQUcsY0FBYyxDQUFDLENBQUM7QUFDMUQsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isa0JBQWtCO0lBQ2hDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUN4QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBEYXRhIFByb3RlY3Rpb24gZm9yIE9ic2VydmFiaWxpdHlcbiAqIFxuICogU2Vuc2l0aXZlIGRhdGEgcmVkYWN0aW9uIHVzaW5nIEBoYWNreWxhYnMvZGVlcC1yZWRhY3QuXG4gKi9cblxuaW1wb3J0IHsgRGVlcFJlZGFjdCB9IGZyb20gJ0BoYWNreWxhYnMvZGVlcC1yZWRhY3QnO1xuaW1wb3J0IHsgZGVlcENvcHkgfSBmcm9tICcuLi8uLi91dGlscy9zZXJpYWxpemUnO1xuXG4vKipcbiAqIERhdGEgcHJvdGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YVByb3RlY3Rpb25Db25maWcge1xuICBlbmFibGVkPzogYm9vbGVhbjtcbiAgYmxhY2tsaXN0ZWRLZXlzPzogKHN0cmluZyB8IFJlZ0V4cClbXTtcbiAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoPzogYm9vbGVhbjtcbiAgcmVwbGFjZW1lbnQ/OiBzdHJpbmc7XG4gIGZ1enp5S2V5TWF0Y2g/OiBib29sZWFuO1xuICBmaWVsZHM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBEZWZhdWx0IGJsYWNrbGlzdGVkIGtleXMgZm9yIHNlbnNpdGl2ZSBkYXRhXG4gKiBDb3ZlcnMgY29tbW9uIGF1dGhlbnRpY2F0aW9uLCBmaW5hbmNpYWwsIGFuZCBQSUkgZmllbGRzXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVM6IChzdHJpbmcgfCBSZWdFeHApW10gPSBbXG4gIC8vIEF1dGhlbnRpY2F0aW9uICYgQXV0aG9yaXphdGlvblxuICAncGFzc3dvcmQnLFxuICAnc2VjcmV0JyxcbiAgJ3ByaXZhdGVLZXknLFxuICAnYXV0aG9yaXphdGlvbicsXG4gICd0b2tlbicsXG4gICdhY2Nlc3NUb2tlbicsXG4gICdyZWZyZXNoVG9rZW4nLFxuICAnYXBpS2V5JyxcbiAgJ2NsaWVudFNlY3JldCcsXG4gICdiZWFyZXInLFxuICAnY3JlZGVudGlhbCcsXG4gICdqd3QnLFxuICAnc2Vzc2lvblRva2VuJyxcbiAgJ2F1dGhUb2tlbicsXG4gIFxuICAvLyBQYXltZW50ICYgRmluYW5jaWFsXG4gICdjcmVkaXRDYXJkJyxcbiAgJ2NhcmROdW1iZXInLFxuICAnY3Z2JyxcbiAgJ2N2YycsXG4gICdzc24nLFxuICAnc29jaWFsU2VjdXJpdHknLFxuICAnYmFua0FjY291bnQnLFxuICAncm91dGluZ051bWJlcicsXG4gICdhY2NvdW50TnVtYmVyJyxcbiAgJ3BpbicsXG4gIFxuICAvLyBQZXJzb25hbCBJZGVudGlmaWFibGUgSW5mb3JtYXRpb24gKFBJSSlcbiAgJ2VtYWlsJyxcbiAgJ3Bob25lJyxcbiAgJ3Bob25lTnVtYmVyJyxcbiAgJ2RhdGVPZkJpcnRoJyxcbiAgJ2RvYicsXG4gICdhZGRyZXNzJyxcbiAgJ3N0cmVldEFkZHJlc3MnLFxuICAncG9zdGFsQ29kZScsXG4gICd6aXBDb2RlJyxcbiAgXG4gIC8vIEhlYWRlcnMgJiBDb29raWVzXG4gICdjb29raWUnLFxuICAnc2V0LWNvb2tpZScsXG4gICd4LWFwaS1rZXknLFxuICAneC1hdXRoLXRva2VuJyxcbl07XG5cbi8qKlxuICogRGVmYXVsdCBmaWVsZHMgdG8gcHJvdGVjdCBpbiBPYnNlcnZhYmlsaXR5RXZlbnRcbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPVEVDVEVEX0ZJRUxEUzogKCdkYXRhJyB8ICdhdHRyaWJ1dGVzJyB8ICdtZXRhZGF0YScgfCAnY29udGV4dCcgfCAnZXJyb3InKVtdID0gW1xuICAnZGF0YScsXG4gICdhdHRyaWJ1dGVzJyxcbiAgJ21ldGFkYXRhJyxcbiAgJ2NvbnRleHQnLFxuXTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSU5URVJOQUwgSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBDYWNoZWQgcmVkYWN0b3IgaW5zdGFuY2VzIGZvciBwZXJmb3JtYW5jZVxuY29uc3QgcmVkYWN0b3JDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBEZWVwUmVkYWN0PigpO1xuXG4vKipcbiAqIEdldCBvciBjcmVhdGUgYSBjYWNoZWQgcmVkYWN0b3IgaW5zdGFuY2VcbiAqL1xuZnVuY3Rpb24gZ2V0UmVkYWN0b3IoY29uZmlnOiBQYXJ0aWFsPERhdGFQcm90ZWN0aW9uQ29uZmlnPik6IERlZXBSZWRhY3Qge1xuICBjb25zdCBibGFja2xpc3RlZEtleXMgPSBjb25maWcuYmxhY2tsaXN0ZWRLZXlzID8/IERFRkFVTFRfQkxBQ0tMSVNURURfS0VZUztcbiAgXG4gIC8vIENyZWF0ZSBhIGNhY2hlIGtleSBmcm9tIGNvbmZpZ1xuICBjb25zdCBjYWNoZUtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICBibGFja2xpc3RlZEtleXM6IGJsYWNrbGlzdGVkS2V5cy5tYXAoayA9PiBrLnRvU3RyaW5nKCkpLFxuICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogY29uZmlnLmNhc2VTZW5zaXRpdmVLZXlNYXRjaCxcbiAgICByZXBsYWNlbWVudDogY29uZmlnLnJlcGxhY2VtZW50LFxuICAgIGZ1enp5S2V5TWF0Y2g6IGNvbmZpZy5mdXp6eUtleU1hdGNoLFxuICB9KTtcblxuICBsZXQgcmVkYWN0b3IgPSByZWRhY3RvckNhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmICghcmVkYWN0b3IpIHtcbiAgICByZWRhY3RvciA9IG5ldyBEZWVwUmVkYWN0KHtcbiAgICAgIGJsYWNrbGlzdGVkS2V5cyxcbiAgICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogY29uZmlnLmNhc2VTZW5zaXRpdmVLZXlNYXRjaCA/PyBmYWxzZSxcbiAgICAgIGZ1enp5S2V5TWF0Y2g6IGNvbmZpZy5mdXp6eUtleU1hdGNoID8/IHRydWUsXG4gICAgICByZXBsYWNlbWVudDogY29uZmlnLnJlcGxhY2VtZW50ID8/ICdbUkVEQUNURURdJyxcbiAgICAgIHJlbW92ZTogZmFsc2UsXG4gICAgICAvLyBDUklUSUNBTDogcmV0YWluU3RydWN0dXJlIG11c3QgYmUgdHJ1ZSB0byBlbnN1cmUgbmVzdGVkIG9iamVjdHMgYXJlIHRyYXZlcnNlZFxuICAgICAgLy8gd2hlbiBhIHBhcmVudCBrZXkgZnV6enktbWF0Y2hlcyBhIGJsYWNrbGlzdGVkIGtleSAoZS5nLiwgJ2NyZWRlbnRpYWxzJyBtYXRjaGVzICdjcmVkZW50aWFsJylcbiAgICAgIHJldGFpblN0cnVjdHVyZTogdHJ1ZSxcbiAgICB9KTtcbiAgICByZWRhY3RvckNhY2hlLnNldChjYWNoZUtleSwgcmVkYWN0b3IpO1xuICB9XG4gIHJldHVybiByZWRhY3Rvcjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTUFJTiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSZWRhY3Qgc2Vuc2l0aXZlIGRhdGEgZnJvbSBhbiBvYmplY3RcbiAqIFxuICogQHBhcmFtIGRhdGEgLSBEYXRhIHRvIHJlZGFjdFxuICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIHJlZGFjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBEZWVwIGNvcHkgb2YgZGF0YSB3aXRoIHNlbnNpdGl2ZSBmaWVsZHMgcmVkYWN0ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZGFjdFNlbnNpdGl2ZURhdGE8VD4oXG4gIGRhdGE6IFQsXG4gIGNvbmZpZz86IFBhcnRpYWw8RGF0YVByb3RlY3Rpb25Db25maWc+XG4pOiBUIHtcbiAgaWYgKGRhdGEgPT09IG51bGwgfHwgZGF0YSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGRhdGE7XG4gIH1cblxuICAvLyBJZiBkaXNhYmxlZCwgcmV0dXJuIGFzLWlzXG4gIGlmIChjb25maWc/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGRhdGE7XG4gIH1cblxuICBjb25zdCByZWRhY3RvciA9IGdldFJlZGFjdG9yKGNvbmZpZyA/PyB7fSk7XG4gIFxuICAvLyBDcmVhdGUgZGVlcCBjb3B5IGJlZm9yZSByZWRhY3RpbmcgKHJlZGFjdG9yIG11dGF0ZXMgaW4gcGxhY2UpXG4gIGNvbnN0IGNvcHkgPSBkZWVwQ29weShkYXRhKTtcbiAgcmV0dXJuIHJlZGFjdG9yLnJlZGFjdChjb3B5KSBhcyBUO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEga2V5IHNob3VsZCBiZSByZWRhY3RlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkUmVkYWN0S2V5KFxuICBrZXk6IHN0cmluZyxcbiAgY29uZmlnPzogUGFydGlhbDxEYXRhUHJvdGVjdGlvbkNvbmZpZz5cbik6IGJvb2xlYW4ge1xuICBjb25zdCBibGFja2xpc3RlZEtleXMgPSBjb25maWc/LmJsYWNrbGlzdGVkS2V5cyA/PyBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVM7XG4gIGNvbnN0IGNhc2VTZW5zaXRpdmUgPSBjb25maWc/LmNhc2VTZW5zaXRpdmVLZXlNYXRjaCA/PyBmYWxzZTtcbiAgY29uc3QgZnV6enkgPSBjb25maWc/LmZ1enp5S2V5TWF0Y2ggPz8gdHJ1ZTtcblxuICBjb25zdCBub3JtYWxpemVkS2V5ID0gY2FzZVNlbnNpdGl2ZSA/IGtleSA6IGtleS50b0xvd2VyQ2FzZSgpO1xuXG4gIGZvciAoY29uc3QgYmxhY2tsaXN0ZWQgb2YgYmxhY2tsaXN0ZWRLZXlzKSB7XG4gICAgaWYgKGJsYWNrbGlzdGVkIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICBpZiAoYmxhY2tsaXN0ZWQudGVzdChrZXkpKSByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZEJsYWNrbGlzdGVkID0gY2FzZVNlbnNpdGl2ZSA/IGJsYWNrbGlzdGVkIDogYmxhY2tsaXN0ZWQudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmIChmdXp6eSkge1xuICAgICAgICAvLyBGdXp6eTogY2hlY2sgaWYgYmxhY2tsaXN0ZWQgaXMgY29udGFpbmVkIGluIGtleSBPUiBrZXkgaXMgY29udGFpbmVkIGluIGJsYWNrbGlzdGVkXG4gICAgICAgIGlmIChub3JtYWxpemVkS2V5LmluY2x1ZGVzKG5vcm1hbGl6ZWRCbGFja2xpc3RlZCkgfHwgbm9ybWFsaXplZEJsYWNrbGlzdGVkLmluY2x1ZGVzKG5vcm1hbGl6ZWRLZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEV4YWN0IG1hdGNoXG4gICAgICAgIGlmIChub3JtYWxpemVkS2V5ID09PSBub3JtYWxpemVkQmxhY2tsaXN0ZWQpIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBFeHRlbmQgdGhlIGRlZmF1bHQgYmxhY2tsaXN0IHdpdGggYWRkaXRpb25hbCBrZXlzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmRCbGFja2xpc3QoXG4gIGFkZGl0aW9uYWxLZXlzOiAoc3RyaW5nIHwgUmVnRXhwKVtdXG4pOiAoc3RyaW5nIHwgUmVnRXhwKVtdIHtcbiAgcmV0dXJuIFsuLi5ERUZBVUxUX0JMQUNLTElTVEVEX0tFWVMsIC4uLmFkZGl0aW9uYWxLZXlzXTtcbn1cblxuLyoqXG4gKiBDbGVhciB0aGUgcmVkYWN0b3IgY2FjaGUgKHRlc3RpbmcpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhclJlZGFjdG9yQ2FjaGUoKTogdm9pZCB7XG4gIHJlZGFjdG9yQ2FjaGUuY2xlYXIoKTtcbn1cbiJdfQ==