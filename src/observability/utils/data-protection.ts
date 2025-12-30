/**
 * Data Protection for Observability
 * 
 * Sensitive data redaction using @hackylabs/deep-redact.
 */

import { DeepRedact } from '@hackylabs/deep-redact';
import { deepCopy } from '../../utils/serialize';
import type { DataProtectionConfig } from '../types';

/**
 * Default blacklisted keys for sensitive data
 * Covers common authentication, financial, and PII fields
 */
export const DEFAULT_BLACKLISTED_KEYS: (string | RegExp)[] = [
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
export const DEFAULT_PROTECTED_FIELDS: ('data' | 'attributes' | 'metadata' | 'context' | 'error')[] = [
  'data',
  'attributes',
  'metadata',
  'context',
];

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// Cached redactor instances for performance
const redactorCache = new Map<string, DeepRedact>();

/**
 * Get or create a cached redactor instance
 */
function getRedactor(config: Partial<DataProtectionConfig>): DeepRedact {
  const blacklistedKeys = config.blacklistedKeys ?? DEFAULT_BLACKLISTED_KEYS;

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
export function redactSensitiveData<T>(
  data: T,
  config?: Partial<DataProtectionConfig>
): T {
  if (data === null || data === undefined) {
    return data;
  }

  // If disabled, return as-is
  if (config?.enabled === false) {
    return data;
  }

  const redactor = getRedactor(config ?? {});

  // Create deep copy before redacting (redactor mutates in place)
  const copy = deepCopy(data);
  return redactor.redact(copy) as T;
}

/**
 * Check if a key should be redacted
 */
export function shouldRedactKey(
  key: string,
  config?: Partial<DataProtectionConfig>
): boolean {
  const blacklistedKeys = config?.blacklistedKeys ?? DEFAULT_BLACKLISTED_KEYS;
  const caseSensitive = config?.caseSensitiveKeyMatch ?? false;
  const fuzzy = config?.fuzzyKeyMatch ?? true;

  const normalizedKey = caseSensitive ? key : key.toLowerCase();

  for (const blacklisted of blacklistedKeys) {
    if (blacklisted instanceof RegExp) {
      if (blacklisted.test(key)) return true;
    } else {
      const normalizedBlacklisted = caseSensitive ? blacklisted : blacklisted.toLowerCase();
      if (fuzzy) {
        // Fuzzy: check if blacklisted is contained in key OR key is contained in blacklisted
        if (normalizedKey.includes(normalizedBlacklisted) || normalizedBlacklisted.includes(normalizedKey)) {
          return true;
        }
      } else {
        // Exact match
        if (normalizedKey === normalizedBlacklisted) return true;
      }
    }
  }

  return false;
}

/**
 * Extend the default blacklist with additional keys
 */
export function extendBlacklist(
  additionalKeys: (string | RegExp)[]
): (string | RegExp)[] {
  return [ ...DEFAULT_BLACKLISTED_KEYS, ...additionalKeys ];
}

/**
 * Clear the redactor cache (testing)
 */
export function clearRedactorCache(): void {
  redactorCache.clear();
}
