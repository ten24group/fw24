"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectAuditData = protectAuditData;
exports.createRedactConfig = createRedactConfig;
const deep_redact_1 = require("@hackylabs/deep-redact");
const serialize_1 = require("../../utils/serialize");
/**
 * Default data protection configuration
 */
const DEFAULT_CONFIG = {
    enabled: true
};
/**
 * Default deep-redact configuration for audit entries
 * Redacts common sensitive fields while preserving audit trail integrity,
 * TODO: make all these a pattern to ensure nothing sensitive is left out
 * TODO:add an allowed keys list to allow certain keys to be kept unredacted
 */
const DEFAULT_DEEP_REDACT_CONFIG = {
    blacklistedKeys: [
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
        // Payment & Financial
        'creditCard',
        'cardNumber',
        'ssn',
        'bankAccount',
        'routingNumber',
        'cvv',
        // Headers & Cookies
        'cookie',
        'email',
        'set-cookie'
    ],
    /** Loosely compare key names by checking if the key name of your unredacted object is included
     * anywhere within the name of your blacklisted key.
     * For example, is "pass" (your key) included in "password" (from config).
     *
     * @default false in the deep-redact library
     * */
    fuzzyKeyMatch: true,
    /**
     * Loosely compare key names by normalising the strings. This involves removing non-word characters and transforms the string to lowercase.
     * This means you never have to worry having to list duplicate keys in different formats
     * such as snake_case, camelCase, PascalCase or any other case.
     *
     * @default true in the deep-redact library
     */
    caseSensitiveKeyMatch: true,
};
/**
 * Applies data protection to an audit entry before logging
 * Uses @hackylabs/deep-redact library for efficient and configurable redaction
 */
function protectAuditData(auditEntry, config = {}) {
    const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
    if (!effectiveConfig.enabled) {
        return auditEntry;
    }
    // If custom protection function is provided, use it instead
    if (config.customProtectionFn) {
        return config.customProtectionFn(auditEntry, config);
    }
    // Use deep-redact (default behavior)
    const deepRedactConfig = {
        ...DEFAULT_DEEP_REDACT_CONFIG,
        ...config.deepRedact,
        // Ensure blacklistedKeys is always provided
        blacklistedKeys: config.deepRedact?.blacklistedKeys || DEFAULT_DEEP_REDACT_CONFIG.blacklistedKeys || []
    };
    const redactor = new deep_redact_1.DeepRedact(deepRedactConfig);
    // Create a proper deep copy and redact
    const copy = (0, serialize_1.deepCopy)(auditEntry);
    return redactor.redact(copy);
}
/**
 * Utility to create a custom deep-redact configuration
 */
function createRedactConfig(blacklistedKeys, options = {}) {
    return {
        blacklistedKeys,
        caseSensitiveKeyMatch: false,
        remove: false,
        replacement: '[REDACTED]',
        ...options
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1wcm90ZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2F1ZGl0L2hlbHBlcnMvZGF0YS1wcm90ZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBaUdBLDRDQTRCQztBQUtELGdEQVdDO0FBNUlELHdEQUFvRDtBQUNwRCxxREFBaUQ7QUFpQ2pEOztHQUVHO0FBQ0gsTUFBTSxjQUFjLEdBQThFO0lBQ2hHLE9BQU8sRUFBRSxJQUFJO0NBQ2QsQ0FBQztBQUVGOzs7OztHQUtHO0FBQ0gsTUFBTSwwQkFBMEIsR0FBcUI7SUFDbkQsZUFBZSxFQUFFO1FBQ2YsaUNBQWlDO1FBQ2pDLFVBQVU7UUFDVixRQUFRO1FBQ1IsWUFBWTtRQUNaLGVBQWU7UUFDZixPQUFPO1FBQ1AsYUFBYTtRQUNiLGNBQWM7UUFDZCxRQUFRO1FBQ1IsY0FBYztRQUVkLHNCQUFzQjtRQUN0QixZQUFZO1FBQ1osWUFBWTtRQUNaLEtBQUs7UUFDTCxhQUFhO1FBQ2IsZUFBZTtRQUNmLEtBQUs7UUFFTCxvQkFBb0I7UUFDcEIsUUFBUTtRQUNSLE9BQU87UUFDUCxZQUFZO0tBQ2I7SUFFRDs7Ozs7U0FLSztJQUNMLGFBQWEsRUFBRSxJQUFJO0lBRW5COzs7Ozs7T0FNRztJQUNILHFCQUFxQixFQUFFLElBQUk7Q0FDNUIsQ0FBQztBQUVGOzs7R0FHRztBQUNILFNBQWdCLGdCQUFnQixDQUM5QixVQUFzQixFQUN0QixTQUErQixFQUFFO0lBRWpDLE1BQU0sZUFBZSxHQUFHLEVBQUUsR0FBRyxjQUFjLEVBQUUsR0FBRyxNQUFNLEVBQUUsQ0FBQztJQUV6RCxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzdCLE9BQU8sVUFBVSxDQUFDO0lBQ3BCLENBQUM7SUFFRCw0REFBNEQ7SUFDNUQsSUFBSSxNQUFNLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztRQUM5QixPQUFPLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELHFDQUFxQztJQUNyQyxNQUFNLGdCQUFnQixHQUFHO1FBQ3ZCLEdBQUcsMEJBQTBCO1FBQzdCLEdBQUcsTUFBTSxDQUFDLFVBQVU7UUFDcEIsNENBQTRDO1FBQzVDLGVBQWUsRUFBRSxNQUFNLENBQUMsVUFBVSxFQUFFLGVBQWUsSUFBSSwwQkFBMEIsQ0FBQyxlQUFlLElBQUksRUFBRTtLQUN4RyxDQUFDO0lBRUYsTUFBTSxRQUFRLEdBQUcsSUFBSSx3QkFBVSxDQUFDLGdCQUFnQixDQUFDLENBQUM7SUFFbEQsdUNBQXVDO0lBQ3ZDLE1BQU0sSUFBSSxHQUFHLElBQUEsb0JBQVEsRUFBQyxVQUFVLENBQUMsQ0FBQztJQUNsQyxPQUFPLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFlLENBQUM7QUFDN0MsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQ2hDLGVBQW9DLEVBQ3BDLFVBQXFDLEVBQUU7SUFFdkMsT0FBTztRQUNMLGVBQWU7UUFDZixxQkFBcUIsRUFBRSxLQUFLO1FBQzVCLE1BQU0sRUFBRSxLQUFLO1FBQ2IsV0FBVyxFQUFFLFlBQVk7UUFDekIsR0FBRyxPQUFPO0tBQ1gsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBdWRpdEVudHJ5IH0gZnJvbSAnLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBEZWVwUmVkYWN0IH0gZnJvbSAnQGhhY2t5bGFicy9kZWVwLXJlZGFjdCc7XG5pbXBvcnQgeyBkZWVwQ29weSB9IGZyb20gJy4uLy4uL3V0aWxzL3NlcmlhbGl6ZSc7XG5cbi8qKlxuICogQ3VzdG9tIGRhdGEgcHJvdGVjdGlvbiBmdW5jdGlvbiB0eXBlIC0gYWxsb3dzIGNvbXBsZXRlIGNvbnRyb2wgb3ZlciByZWRhY3Rpb25cbiAqL1xuZXhwb3J0IHR5cGUgRGF0YVByb3RlY3Rpb25GdW5jdGlvbiA9IChcbiAgYXVkaXRFbnRyeTogQXVkaXRFbnRyeSxcbiAgY29uZmlnOiBEYXRhUHJvdGVjdGlvbkNvbmZpZ1xuKSA9PiBBdWRpdEVudHJ5O1xuXG4vKipcbiAqIERlZXAtcmVkYWN0IGNvbmZpZ3VyYXRpb24gZm9yIGNvbW1vbiBhdWRpdCBzY2VuYXJpb3NcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWVwUmVkYWN0Q29uZmlnIHtcbiAgYmxhY2tsaXN0ZWRLZXlzPzogKHN0cmluZyB8IFJlZ0V4cClbXTtcbiAgY2FzZVNlbnNpdGl2ZUtleU1hdGNoPzogYm9vbGVhbjtcbiAgcmVtb3ZlPzogYm9vbGVhbjtcbiAgcmVwbGFjZW1lbnQ/OiBzdHJpbmc7XG4gIGZ1enp5S2V5TWF0Y2g/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIERhdGEgcHJvdGVjdGlvbiBjb25maWd1cmF0aW9uIGZvciBhdWRpdCBlbnRyaWVzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YVByb3RlY3Rpb25Db25maWcge1xuICAvKiogRW5hYmxlL2Rpc2FibGUgZGF0YSBwcm90ZWN0aW9uICovXG4gIGVuYWJsZWQ/OiBib29sZWFuO1xuICAvKiogRGVlcC1yZWRhY3QgY29uZmlndXJhdGlvbiAqL1xuICBkZWVwUmVkYWN0PzogRGVlcFJlZGFjdENvbmZpZztcbiAgLyoqIEN1c3RvbSBkYXRhIHByb3RlY3Rpb24gZnVuY3Rpb24gLSBvdmVycmlkZXMgZGVlcC1yZWRhY3QgaWYgcHJvdmlkZWQgKi9cbiAgY3VzdG9tUHJvdGVjdGlvbkZuPzogRGF0YVByb3RlY3Rpb25GdW5jdGlvbjtcbn1cblxuLyoqXG4gKiBEZWZhdWx0IGRhdGEgcHJvdGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKi9cbmNvbnN0IERFRkFVTFRfQ09ORklHOiBSZXF1aXJlZDxPbWl0PERhdGFQcm90ZWN0aW9uQ29uZmlnLCAnY3VzdG9tUHJvdGVjdGlvbkZuJyB8ICdkZWVwUmVkYWN0Jz4+ID0ge1xuICBlbmFibGVkOiB0cnVlXG59O1xuXG4vKipcbiAqIERlZmF1bHQgZGVlcC1yZWRhY3QgY29uZmlndXJhdGlvbiBmb3IgYXVkaXQgZW50cmllc1xuICogUmVkYWN0cyBjb21tb24gc2Vuc2l0aXZlIGZpZWxkcyB3aGlsZSBwcmVzZXJ2aW5nIGF1ZGl0IHRyYWlsIGludGVncml0eSxcbiAqIFRPRE86IG1ha2UgYWxsIHRoZXNlIGEgcGF0dGVybiB0byBlbnN1cmUgbm90aGluZyBzZW5zaXRpdmUgaXMgbGVmdCBvdXRcbiAqIFRPRE86YWRkIGFuIGFsbG93ZWQga2V5cyBsaXN0IHRvIGFsbG93IGNlcnRhaW4ga2V5cyB0byBiZSBrZXB0IHVucmVkYWN0ZWRcbiAqL1xuY29uc3QgREVGQVVMVF9ERUVQX1JFREFDVF9DT05GSUc6IERlZXBSZWRhY3RDb25maWcgPSB7XG4gIGJsYWNrbGlzdGVkS2V5czogW1xuICAgIC8vIEF1dGhlbnRpY2F0aW9uICYgQXV0aG9yaXphdGlvblxuICAgICdwYXNzd29yZCcsXG4gICAgJ3NlY3JldCcsIFxuICAgICdwcml2YXRlS2V5JyxcbiAgICAnYXV0aG9yaXphdGlvbicsXG4gICAgJ3Rva2VuJyxcbiAgICAnYWNjZXNzVG9rZW4nLFxuICAgICdyZWZyZXNoVG9rZW4nLFxuICAgICdhcGlLZXknLFxuICAgICdjbGllbnRTZWNyZXQnLFxuICAgIFxuICAgIC8vIFBheW1lbnQgJiBGaW5hbmNpYWxcbiAgICAnY3JlZGl0Q2FyZCcsXG4gICAgJ2NhcmROdW1iZXInLFxuICAgICdzc24nLFxuICAgICdiYW5rQWNjb3VudCcsIFxuICAgICdyb3V0aW5nTnVtYmVyJyxcbiAgICAnY3Z2JyxcbiAgICBcbiAgICAvLyBIZWFkZXJzICYgQ29va2llc1xuICAgICdjb29raWUnLFxuICAgICdlbWFpbCcsXG4gICAgJ3NldC1jb29raWUnXG4gIF0sXG4gIFxuICAvKiogTG9vc2VseSBjb21wYXJlIGtleSBuYW1lcyBieSBjaGVja2luZyBpZiB0aGUga2V5IG5hbWUgb2YgeW91ciB1bnJlZGFjdGVkIG9iamVjdCBpcyBpbmNsdWRlZCBcbiAgICogYW55d2hlcmUgd2l0aGluIHRoZSBuYW1lIG9mIHlvdXIgYmxhY2tsaXN0ZWQga2V5LlxuICAgKiBGb3IgZXhhbXBsZSwgaXMgXCJwYXNzXCIgKHlvdXIga2V5KSBpbmNsdWRlZCBpbiBcInBhc3N3b3JkXCIgKGZyb20gY29uZmlnKS5cbiAgICogXG4gICAqIEBkZWZhdWx0IGZhbHNlIGluIHRoZSBkZWVwLXJlZGFjdCBsaWJyYXJ5XG4gICAqICovXG4gIGZ1enp5S2V5TWF0Y2g6IHRydWUsXG5cbiAgLyoqXG4gICAqIExvb3NlbHkgY29tcGFyZSBrZXkgbmFtZXMgYnkgbm9ybWFsaXNpbmcgdGhlIHN0cmluZ3MuIFRoaXMgaW52b2x2ZXMgcmVtb3Zpbmcgbm9uLXdvcmQgY2hhcmFjdGVycyBhbmQgdHJhbnNmb3JtcyB0aGUgc3RyaW5nIHRvIGxvd2VyY2FzZS5cbiAgICogVGhpcyBtZWFucyB5b3UgbmV2ZXIgaGF2ZSB0byB3b3JyeSBoYXZpbmcgdG8gbGlzdCBkdXBsaWNhdGUga2V5cyBpbiBkaWZmZXJlbnQgZm9ybWF0cyBcbiAgICogc3VjaCBhcyBzbmFrZV9jYXNlLCBjYW1lbENhc2UsIFBhc2NhbENhc2Ugb3IgYW55IG90aGVyIGNhc2UuXG4gICAqIFxuICAgKiBAZGVmYXVsdCB0cnVlIGluIHRoZSBkZWVwLXJlZGFjdCBsaWJyYXJ5XG4gICAqL1xuICBjYXNlU2Vuc2l0aXZlS2V5TWF0Y2g6IHRydWUsXG59O1xuXG4vKipcbiAqIEFwcGxpZXMgZGF0YSBwcm90ZWN0aW9uIHRvIGFuIGF1ZGl0IGVudHJ5IGJlZm9yZSBsb2dnaW5nXG4gKiBVc2VzIEBoYWNreWxhYnMvZGVlcC1yZWRhY3QgbGlicmFyeSBmb3IgZWZmaWNpZW50IGFuZCBjb25maWd1cmFibGUgcmVkYWN0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm90ZWN0QXVkaXREYXRhKFxuICBhdWRpdEVudHJ5OiBBdWRpdEVudHJ5LCBcbiAgY29uZmlnOiBEYXRhUHJvdGVjdGlvbkNvbmZpZyA9IHt9XG4pOiBBdWRpdEVudHJ5IHtcbiAgY29uc3QgZWZmZWN0aXZlQ29uZmlnID0geyAuLi5ERUZBVUxUX0NPTkZJRywgLi4uY29uZmlnIH07XG4gIFxuICBpZiAoIWVmZmVjdGl2ZUNvbmZpZy5lbmFibGVkKSB7XG4gICAgcmV0dXJuIGF1ZGl0RW50cnk7XG4gIH1cblxuICAvLyBJZiBjdXN0b20gcHJvdGVjdGlvbiBmdW5jdGlvbiBpcyBwcm92aWRlZCwgdXNlIGl0IGluc3RlYWRcbiAgaWYgKGNvbmZpZy5jdXN0b21Qcm90ZWN0aW9uRm4pIHtcbiAgICByZXR1cm4gY29uZmlnLmN1c3RvbVByb3RlY3Rpb25GbihhdWRpdEVudHJ5LCBjb25maWcpO1xuICB9XG5cbiAgLy8gVXNlIGRlZXAtcmVkYWN0IChkZWZhdWx0IGJlaGF2aW9yKVxuICBjb25zdCBkZWVwUmVkYWN0Q29uZmlnID0ge1xuICAgIC4uLkRFRkFVTFRfREVFUF9SRURBQ1RfQ09ORklHLFxuICAgIC4uLmNvbmZpZy5kZWVwUmVkYWN0LFxuICAgIC8vIEVuc3VyZSBibGFja2xpc3RlZEtleXMgaXMgYWx3YXlzIHByb3ZpZGVkXG4gICAgYmxhY2tsaXN0ZWRLZXlzOiBjb25maWcuZGVlcFJlZGFjdD8uYmxhY2tsaXN0ZWRLZXlzIHx8IERFRkFVTFRfREVFUF9SRURBQ1RfQ09ORklHLmJsYWNrbGlzdGVkS2V5cyB8fCBbXVxuICB9O1xuXG4gIGNvbnN0IHJlZGFjdG9yID0gbmV3IERlZXBSZWRhY3QoZGVlcFJlZGFjdENvbmZpZyk7XG4gIFxuICAvLyBDcmVhdGUgYSBwcm9wZXIgZGVlcCBjb3B5IGFuZCByZWRhY3RcbiAgY29uc3QgY29weSA9IGRlZXBDb3B5KGF1ZGl0RW50cnkpO1xuICByZXR1cm4gcmVkYWN0b3IucmVkYWN0KGNvcHkpIGFzIEF1ZGl0RW50cnk7XG59XG5cbi8qKlxuICogVXRpbGl0eSB0byBjcmVhdGUgYSBjdXN0b20gZGVlcC1yZWRhY3QgY29uZmlndXJhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUmVkYWN0Q29uZmlnKFxuICBibGFja2xpc3RlZEtleXM6IChzdHJpbmcgfCBSZWdFeHApW10sXG4gIG9wdGlvbnM6IFBhcnRpYWw8RGVlcFJlZGFjdENvbmZpZz4gPSB7fVxuKTogRGVlcFJlZGFjdENvbmZpZyB7XG4gIHJldHVybiB7XG4gICAgYmxhY2tsaXN0ZWRLZXlzLFxuICAgIGNhc2VTZW5zaXRpdmVLZXlNYXRjaDogZmFsc2UsXG4gICAgcmVtb3ZlOiBmYWxzZSxcbiAgICByZXBsYWNlbWVudDogJ1tSRURBQ1RFRF0nLFxuICAgIC4uLm9wdGlvbnNcbiAgfTtcbn1cbiJdfQ==