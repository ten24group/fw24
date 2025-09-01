import { AuditEntry } from '../interfaces';
import { DeepRedact } from '@hackylabs/deep-redact';
import { deepCopy } from '../../utils/serialize';

/**
 * Custom data protection function type - allows complete control over redaction
 */
export type DataProtectionFunction = (
  auditEntry: AuditEntry,
  config: DataProtectionConfig
) => AuditEntry;

/**
 * Deep-redact configuration for common audit scenarios
 */
export interface DeepRedactConfig {
  blacklistedKeys?: (string | RegExp)[];
  caseSensitiveKeyMatch?: boolean;
  remove?: boolean;
  replacement?: string;
  fuzzyKeyMatch?: boolean;
}

/**
 * Data protection configuration for audit entries
 */
export interface DataProtectionConfig {
  /** Enable/disable data protection */
  enabled?: boolean;
  /** Deep-redact configuration */
  deepRedact?: DeepRedactConfig;
  /** Custom data protection function - overrides deep-redact if provided */
  customProtectionFn?: DataProtectionFunction;
}

/**
 * Default data protection configuration
 */
const DEFAULT_CONFIG: Required<Omit<DataProtectionConfig, 'customProtectionFn' | 'deepRedact'>> = {
  enabled: true
};

/**
 * Default deep-redact configuration for audit entries
 * Redacts common sensitive fields while preserving audit trail integrity
 */
const DEFAULT_DEEP_REDACT_CONFIG: DeepRedactConfig = {
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
  caseSensitiveKeyMatch: false,
  remove: false,
  replacement: '[REDACTED]'
};

/**
 * Applies data protection to an audit entry before logging
 * Uses @hackylabs/deep-redact library for efficient and configurable redaction
 */
export function protectAuditData(
  auditEntry: AuditEntry, 
  config: DataProtectionConfig = {}
): AuditEntry {
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
    ...config.deepRedact
  };

  const redactor = new DeepRedact(deepRedactConfig as any);
  
  // Create a proper deep copy and redact
  const copy = deepCopy(auditEntry);
  return redactor.redact(copy) as AuditEntry;
}

/**
 * Utility to create a custom deep-redact configuration
 */
export function createRedactConfig(
  blacklistedKeys: (string | RegExp)[],
  options: Partial<DeepRedactConfig> = {}
): DeepRedactConfig {
  return {
    blacklistedKeys,
    caseSensitiveKeyMatch: false,
    remove: false,
    replacement: '[REDACTED]',
    ...options
  };
}
