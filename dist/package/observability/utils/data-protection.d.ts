/**
 * Data Protection for Observability
 *
 * Sensitive data redaction using @hackylabs/deep-redact.
 */
import type { DataProtectionConfig } from '../types';
/**
 * Default blacklisted keys for sensitive data
 * Covers common authentication, financial, and PII fields
 */
export declare const DEFAULT_BLACKLISTED_KEYS: (string | RegExp)[];
/**
 * Default fields to protect in ObservabilityEvent
 */
export declare const DEFAULT_PROTECTED_FIELDS: ('data' | 'attributes' | 'metadata' | 'context' | 'error')[];
/**
 * Redact sensitive data from an object
 *
 * @param data - Data to redact
 * @param config - Optional redaction configuration
 * @returns Deep copy of data with sensitive fields redacted
 */
export declare function redactSensitiveData<T>(data: T, config?: Partial<DataProtectionConfig>): T;
/**
 * Check if a key should be redacted
 */
export declare function shouldRedactKey(key: string, config?: Partial<DataProtectionConfig>): boolean;
/**
 * Extend the default blacklist with additional keys
 */
export declare function extendBlacklist(additionalKeys: (string | RegExp)[]): (string | RegExp)[];
/**
 * Clear the redactor cache (testing)
 */
export declare function clearRedactorCache(): void;
