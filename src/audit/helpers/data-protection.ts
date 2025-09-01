import { AuditEntry } from '../interfaces';
import fastRedact from 'fast-redact';
import { deepCopy } from '../../utils/serialize';

/**
 * Custom data protection function type - allows complete control over redaction
 */
export type DataProtectionFunction = (
  auditEntry: AuditEntry,
  config: DataProtectionConfig
) => AuditEntry;

/**
 * Fast-redact configuration for common audit scenarios
 */
export interface FastRedactConfig {
  paths?: string[];
  censor?: string | ((value: any) => any);
  serialize?: boolean | ((obj: any) => string);
  strict?: boolean;
  remove?: boolean;
}

/**
 * Data protection configuration for audit entries
 */
export interface DataProtectionConfig {
  /** Enable/disable data protection */
  enabled?: boolean;
  /** Fast-redact configuration */
  fastRedact?: FastRedactConfig;
  /** Custom data protection function - overrides fast-redact if provided */
  customProtectionFn?: DataProtectionFunction;
}

/**
 * Default data protection configuration
 */
const DEFAULT_CONFIG: Required<Omit<DataProtectionConfig, 'customProtectionFn' | 'fastRedact'>> = {
  enabled: true
};

/**
 * Default fast-redact configuration for audit entries
 * Redacts common sensitive fields while preserving audit trail integrity
 */
const DEFAULT_FAST_REDACT_CONFIG: FastRedactConfig = {
  paths: [
    // Authentication & Authorization
    '*.password',
    '*.secret',
    '*.privateKey',
    '*.authorization',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
    '*.apiKey',
    '*.clientSecret',
    
    // Payment & Financial
    '*.creditCard',
    '*.cardNumber',
    '*.ssn',
    '*.bankAccount',
    '*.routingNumber',
    '*.cvv',
    
    // Headers (cookies are sensitive)
    '*.cookie',
    '*.set-cookie'
  ],
  censor: '[REDACTED]'
};

/**
 * Applies data protection to an audit entry before logging
 * Uses fast-redact library for efficient and configurable redaction
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

  // Use fast-redact (default behavior)
  const fastRedactConfig = {
    ...DEFAULT_FAST_REDACT_CONFIG,
    ...config.fastRedact
  };

  // Ensure serialize is false for object return (not string)
  const redactOptions = {
    ...fastRedactConfig,
    serialize: false
  };

  const redactFn = fastRedact(redactOptions);
  
  // Create a proper deep copy and redact
  const copy = deepCopy(auditEntry);
  return redactFn(copy) as AuditEntry;
}

/**
 * Utility to create a custom fast-redact configuration
 */
export function createRedactConfig(
  paths: string[],
  options: Partial<FastRedactConfig> = {}
): FastRedactConfig {
  return {
    paths,
    censor: '[REDACTED]',
    serialize: false,
    strict: false,
    ...options
  };
}
