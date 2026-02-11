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
const DeepRedactModule = require('@hackylabs/deep-redact/index.ts');
const DeepRedact = DeepRedactModule.DeepRedact || DeepRedactModule.default?.DeepRedact || DeepRedactModule;
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
        redactor = new DeepRedact({
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL29ic2VydmFiaWxpdHkvdXRpbHMvZGF0YS1wcm90ZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7OztHQUlHOzs7QUFzSEgsa0RBa0JDO0FBS0QsMENBNEJDO0FBS0QsMENBSUM7QUFLRCxnREFFQztBQXRMRCxNQUFNLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0FBQ3BFLE1BQU0sVUFBVSxHQUFHLGdCQUFnQixDQUFDLFVBQVUsSUFBSSxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsVUFBVSxJQUFJLGdCQUFnQixDQUFDO0FBQzNHLHFEQUFpRDtBQUdqRDs7O0dBR0c7QUFDVSxRQUFBLHdCQUF3QixHQUF3QjtJQUMzRCxpQ0FBaUM7SUFDakMsVUFBVTtJQUNWLFFBQVE7SUFDUixZQUFZO0lBQ1osZUFBZTtJQUNmLE9BQU87SUFDUCxhQUFhO0lBQ2IsY0FBYztJQUNkLFFBQVE7SUFDUixjQUFjO0lBQ2QsUUFBUTtJQUNSLFlBQVk7SUFDWixLQUFLO0lBQ0wsY0FBYztJQUNkLFdBQVc7SUFFWCxzQkFBc0I7SUFDdEIsWUFBWTtJQUNaLFlBQVk7SUFDWixLQUFLO0lBQ0wsS0FBSztJQUNMLEtBQUs7SUFDTCxnQkFBZ0I7SUFDaEIsYUFBYTtJQUNiLGVBQWU7SUFDZixlQUFlO0lBQ2YsS0FBSztJQUVMLDBDQUEwQztJQUMxQyxPQUFPO0lBQ1AsT0FBTztJQUNQLGFBQWE7SUFDYixhQUFhO0lBQ2IsS0FBSztJQUNMLFNBQVM7SUFDVCxlQUFlO0lBQ2YsWUFBWTtJQUNaLFNBQVM7SUFFVCxvQkFBb0I7SUFDcEIsUUFBUTtJQUNSLFlBQVk7SUFDWixXQUFXO0lBQ1gsY0FBYztDQUNmLENBQUM7QUFFRjs7R0FFRztBQUNVLFFBQUEsd0JBQXdCLEdBQWlFO0lBQ3BHLE1BQU07SUFDTixZQUFZO0lBQ1osVUFBVTtJ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RyxhQUFhLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3RGLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ1YscUZBQXFGO2dCQUNyRixJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMscUJBQXFCLENBQUMsSUFBSSxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztvQkFDbkcsT0FBTyxJQUFJLENBQUM7Z0JBQ2QsQ0FBQztZQUNILENBQUM7aUJBQU0sQ0FBQztnQkFDTixjQUFjO2dCQUNkLElBQUksYUFBYSxLQUFLLHFCQUFxQjtvQkFBRSxPQUFPLElBQUksQ0FBQztZQUMzRCxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGVBQWUsQ0FDN0IsY0FBbUM7SUFFbkMsT0FBTyxDQUFFLEdBQUcsZ0NBQXdCLEVBQUUsR0FBRyxjQUFjLENBQUUsQ0FBQztBQUM1RCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFnQixrQkFBa0I7SUFDaEMsYUFBYSxDQUFDLEtBQUssRUFBRSxDQUFDO0FBQ3hCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIERhdGEgUHJvdGVjdGlvbiBmb3IgT2JzZXJ2YWJpbGl0eVxuICogXG4gKiBTZW5zaXRpdmUgZGF0YSByZWRhY3Rpb24gdXNpbmcgQGhhY2t5bGFicy9kZWVwLXJlZGFjdC5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIERlZXBSZWRhY3QgYXMgRGVlcFJlZGFjdFR5cGUgfSBmcm9tICdAaGFja3lsYWJzL2RlZXAtcmVkYWN0JztcbmNvbnN0IERlZXBSZWRhY3RNb2R1bGUgPSByZXF1aXJlKCdAaGFja3lsYWJzL2RlZXAtcmVkYWN0L2luZGV4LnRzJyk7XG5jb25zdCBEZWVwUmVkYWN0ID0gRGVlcFJlZGFjdE1vZHVsZS5EZWVwUmVkYWN0IHx8IERlZXBSZWRhY3RNb2R1bGUuZGVmYXVsdD8uRGVlcFJlZGFjdCB8fCBEZWVwUmVkYWN0TW9kdWxlO1xuaW1wb3J0IHsgZGVlcENvcHkgfSBmcm9tICcuLi8uLi91dGlscy9zZXJpYWxpemUnO1xuaW1wb3J0IHR5cGUgeyBEYXRhUHJvdGVjdGlvbkNvbmZpZyB9IGZyb20gJy4uL3R5cGVzJztcblxuLyoqXG4gKiBEZWZhdWx0IGJsYWNrbGlzdGVkIGtleXMgZm9yIHNlbnNpdGl2ZSBkYXRhXG4gKiBDb3ZlcnMgY29tbW9uIGF1dGhlbnRpY2F0aW9uLCBmaW5hbmNpYWwsIGFuZCBQSUkgZmllbGRzXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX0JMQUNLTElTVEVEX0tFWVM6IChzdHJpbmcgfCBSZWdFeHApW10gPSBbXG4gIC8vIEF1dGhlbnRpY2F0aW9uICYgQXV0aG9yaXphdGlvblxuICAncGFzc3dvcmQnLFxuICAnc2VjcmV0JyxcbiAgJ3ByaXZhdGVLZXknLFxuICAnYXV0aG9yaXphdGlvbicsXG4gICd0b2tlbicsXG4gICdhY2Nlc3NUb2tlbicsXG4gICdyZWZyZXNoVG9rZW4nLFxuICAnYXBpS2V5JyxcbiAgJ2NsaWVudFNlY3JldCcsXG4gICdiZWFyZXInLFxuICAnY3JlZGVudGlhbCcsXG4gICdqd3QnLFxuICAnc2Vzc2lvblRva2VuJyxcbiAgJ2F1dGhUb2tlbicsXG5cbiAgLy8gUGF5bWVudCAmIEZpbmFuY2lhbFxuICAnY3JlZGl0Q2FyZCcsXG4gICdjYXJkTnVtYmVyJyxcbiAgJ2N2dicsXG4gICdjdmMnLFxuICAnc3NuJyxcbiAgJ3NvY2lhbFNlY3VyaXR5JyxcbiAgJ2JhbmtBY2NvdW50JyxcbiAgJ3JvdXRpbmdOdW1iZXInLFxuICAnYWNjb3VudE51bWJlcicsXG4gICdwaW4nLFxuXG4gIC8vIFBlcnNvbmFsIElkZW50aWZpYWJsZSBJbmZvcm1hdGlvbiAoUElJKVxuICAnZW1haWwnLFxuICAncGhvbmUnLFxuICAncGhvbmVOdW1iZXInLFxuICAnZGF0ZU9mQmlydGgnLFxuICAnZG9iJyxcbiAgJ2FkZHJlc3MnLFxuICAnc3RyZWV0QWRkcmVzcycsXG4gICdwb3N0YWxDb2RlJyxcbiAgJ3ppcENvZGUnLFxuXG4gIC8vIEhlYWRlcnMgJiBDb29raWVzXG4gICdjb29raWUnLFxuICAnc2V0LWNvb2tpZScsXG4gICd4LWFwaS1rZXknLFxuICAneC1hdXRoLXRva2VuJyxcbl07XG5cbi8qKlxuICogRGVmYXVsdCBmaWVsZHMgdG8gcHJvdGVjdCBpbiBPYnNlcnZhYmlsaXR5RXZlbnRcbiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPVEVDVEVEX0ZJRUxEUzogKCdkYXRhJyB8ICdhdHRyaWJ1dGVzJyB8ICdtZXRhZGF0YScgfCAnY29udGV4dCcgfCAnZXJyb3InKVtdID0gW1xuICAnZGF0YScsXG4gICdhdHRyaWJ1dGVzJyxcbiAgJ21ldGFkYXRhJyxcbiAgJ2NvbnRleHQnLFxuXTtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSU5URVJOQUwgSEVMUEVSU1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vLyBDYWNoZWQgcmVkYWN0b3IgaW5zdGFuY2VzIGZvciBwZXJmb3JtYW5jZVxuY29uc3QgcmVkYWN0b3JDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBEZWVwUmVkYWN0VHlwZT4oKTtcblxuLyoqXG4gKiBHZXQgb3IgY3JlYXRlIGEgY2FjaGVkIHJlZGFjdG9yIGluc3RhbmNlXG4gKi9cbmZ1bmN0aW9uIGdldFJlZGFjdG9yKGNvbmZpZzogUGFydGlhbDxEYXRhUHJvdGVjdGlvbkNvbmZpZz4pOiBEZWVwUmVkYWN0VHlwZSB7XG4gIGNvbnN0IGJsYWNrbGlzdGVkS2V5cyA9IGNvbmZpZy5ibGFja2xpc3RlZEtleXMgPz8gREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTO1xuXG4gIC8vIENyZWF0ZSBhIGNhY2hlIGtleSBmcm9tIGNvbmZpZ1xuICBjb25zdCBjYWNoZUtleSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICBibGFja2xpc3RlZEtleXM6IGJsYWNrbGlzdGVkS2V5cy5tYXAoayA9PiBrLnRvU3RyaW5nKCkpLFxuICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogY29uZmlnLmNhc2VTZW5zaXRpdmVLZXlNYXRjaCxcbiAgICByZXBsYWNlbWVudDogY29uZmlnLnJlcGxhY2VtZW50LFxuICAgIGZ1enp5S2V5TWF0Y2g6IGNvbmZpZy5mdXp6eUtleU1hdGNoLFxuICB9KTtcblxuICBsZXQgcmVkYWN0b3IgPSByZWRhY3RvckNhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmICghcmVkYWN0b3IpIHtcbiAgICByZWRhY3RvciA9IG5ldyBEZWVwUmVkYWN0KHtcbiAgICAgIGJsYWNrbGlzdGVkS2V5cyxcbiAgICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogY29uZmlnLmNhc2VTZW5zaXRpdmVLZXlNYXRjaCA/PyBmYWxzZSxcbiAgICAgIGZ1enp5S2V5TWF0Y2g6IGNvbmZpZy5mdXp6eUtleU1hdGNoID8/IHRydWUsXG4gICAgICByZXBsYWNlbWVudDogY29uZmlnLnJlcGxhY2VtZW50ID8/ICdbUkVEQUNURURdJyxcbiAgICAgIHJlbW92ZTogZmFsc2UsXG4gICAgICAvLyBDUklUSUNBTDogcmV0YWluU3RydWN0dXJlIG11c3QgYmUgdHJ1ZSB0byBlbnN1cmUgbmVzdGVkIG9iamVjdHMgYXJlIHRyYXZlcnNlZFxuICAgICAgLy8gd2hlbiBhIHBhcmVudCBrZXkgZnV6enktbWF0Y2hlcyBhIGJsYWNrbGlzdGVkIGtleSAoZS5nLiwgJ2NyZWRlbnRpYWxzJyBtYXRjaGVzICdjcmVkZW50aWFsJylcbiAgICAgIHJldGFpblN0cnVjdHVyZTogdHJ1ZSxcbiAgICB9KTtcbiAgICByZWRhY3RvckNhY2hlLnNldChjYWNoZUtleSwgcmVkYWN0b3IgYXMgRGVlcFJlZGFjdFR5cGUpO1xuICB9XG4gIHJldHVybiByZWRhY3RvciBhcyBEZWVwUmVkYWN0VHlwZTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTUFJTiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSZWRhY3Qgc2Vuc2l0aXZlIGRhdGEgZnJvbSBhbiBvYmplY3RcbiAqIFxuICogQHBhcmFtIGRhdGEgLSBEYXRhIHRvIHJlZGFjdFxuICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIHJlZGFjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBEZWVwIGNvcHkgb2YgZGF0YSB3aXRoIHNlbnNpdGl2ZSBmaWVsZHMgcmVkYWN0ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZGFjdFNlbnNpdGl2ZURhdGE8VD4oXG4gIGRhdGE6IFQsXG4gIGNvbmZpZz86IFBhcnRpYWw8RGF0YVByb3RlY3Rpb25Db25maWc+XG4pOiBUIHtcbiAgaWYgKGRhdGEgPT09IG51bGwgfHwgZGF0YSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGRhdGE7XG4gIH1cblxuICAvLyBJZiBkaXNhYmxlZCwgcmV0dXJuIGFzLWlzXG4gIGlmIChjb25maWc/LmVuYWJsZWQgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGRhdGE7XG4gIH1cblxuICBjb25zdCByZWRhY3RvciA9IGdldFJlZGFjdG9yKGNvbmZpZyA/PyB7fSk7XG5cbiAgLy8gQ3JlYXRlIGRlZXAgY29weSBiZWZvcmUgcmVkYWN0aW5nIChyZWRhY3RvciBtdXRhdGVzIGluIHBsYWNlKVxuICBjb25zdCBjb3B5ID0gZGVlcENvcHkoZGF0YSk7XG4gIHJldHVybiByZWRhY3Rvci5yZWRhY3QoY29weSkgYXMgVDtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIGtleSBzaG91bGQgYmUgcmVkYWN0ZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNob3VsZFJlZGFjdEtleShcbiAga2V5OiBzdHJpbmcsXG4gIGNvbmZpZz86IFBhcnRpYWw8RGF0YVByb3RlY3Rpb25Db25maWc+XG4pOiBib29sZWFuIHtcbiAgY29uc3QgYmxhY2tsaXN0ZWRLZXlzID0gY29uZmlnPy5ibGFja2xpc3RlZEtleXMgPz8gREVGQVVMVF9CTEFDS0xJU1RFRF9LRVlTO1xuICBjb25zdCBjYXNlU2Vuc2l0aXZlID0gY29uZmlnPy5jYXNlU2Vuc2l0aXZlS2V5TWF0Y2ggPz8gZmFsc2U7XG4gIGNvbnN0IGZ1enp5ID0gY29uZmlnPy5mdXp6eUtleU1hdGNoID8/IHRydWU7XG5cbiAgY29uc3Qgbm9ybWFsaXplZEtleSA9IGNhc2VTZW5zaXRpdmUgPyBrZXkgOiBrZXkudG9Mb3dlckNhc2UoKTtcblxuICBmb3IgKGNvbnN0IGJsYWNrbGlzdGVkIG9mIGJsYWNrbGlzdGVkS2V5cykge1xuICAgIGlmIChibGFja2xpc3RlZCBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgaWYgKGJsYWNrbGlzdGVkLnRlc3Qoa2V5KSkgcmV0dXJuIHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRCbGFja2xpc3RlZCA9IGNhc2VTZW5zaXRpdmUgPyBibGFja2xpc3RlZCA6IGJsYWNrbGlzdGVkLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoZnV6enkpIHtcbiAgICAgICAgLy8gRnV6enk6IGNoZWNrIGlmIGJsYWNrbGlzdGVkIGlzIGNvbnRhaW5lZCBpbiBrZXkgT1Iga2V5IGlzIGNvbnRhaW5lZCBpbiBibGFja2xpc3RlZFxuICAgICAgICBpZiAobm9ybWFsaXplZEtleS5pbmNsdWRlcyhub3JtYWxpemVkQmxhY2tsaXN0ZWQpIHx8IG5vcm1hbGl6ZWRCbGFja2xpc3RlZC5pbmNsdWRlcyhub3JtYWxpemVkS2V5KSkge1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBFeGFjdCBtYXRjaFxuICAgICAgICBpZiAobm9ybWFsaXplZEtleSA9PT0gbm9ybWFsaXplZEJsYWNrbGlzdGVkKSByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogRXh0ZW5kIHRoZSBkZWZhdWx0IGJsYWNrbGlzdCB3aXRoIGFkZGl0aW9uYWwga2V5c1xuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0ZW5kQmxhY2tsaXN0KFxuICBhZGRpdGlvbmFsS2V5czogKHN0cmluZyB8IFJlZ0V4cClbXVxuKTogKHN0cmluZyB8IFJlZ0V4cClbXSB7XG4gIHJldHVybiBbIC4uLkRFRkFVTFRfQkxBQ0tMSVNURURfS0VZUywgLi4uYWRkaXRpb25hbEtleXMgXTtcbn1cblxuLyoqXG4gKiBDbGVhciB0aGUgcmVkYWN0b3IgY2FjaGUgKHRlc3RpbmcpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhclJlZGFjdG9yQ2FjaGUoKTogdm9pZCB7XG4gIHJlZGFjdG9yQ2FjaGUuY2xlYXIoKTtcbn1cbiJdfQ==