import { AuditEntry } from '../interfaces';

/**
 * Common PII patterns for automatic detection and redaction
 */
const PII_PATTERNS = [
  { name: 'ssn', pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g },
  { name: 'creditCard', pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
  { name: 'token', pattern: /\b[A-Za-z0-9_-]{20,}\b/g }
];

/**
 * Sensitive field names that should be redacted regardless of content
 */
const SENSITIVE_FIELDS = [
  'password', 'secret', 'token', 'key', 'authorization', 'auth',
  'ssn', 'social',
  'account', 'routing', 'cvv', 'pin', 'passcode'
];

/**
 * Data protection configuration for audit entries
 */
export interface DataProtectionConfig {
  /** Enable/disable data protection */
  enabled?: boolean;
  /** Redact PII patterns automatically */
  redactPII?: boolean;
  /** Redact sensitive field names */
  redactSensitiveFields?: boolean;
  /** Custom PII patterns to redact */
  customPatterns?: Array<{ name: string; pattern: RegExp }>;
  /** Custom sensitive field names */
  customSensitiveFields?: string[];
  /** Maximum string length before truncation */
  maxStringLength?: number;
  /** Redaction replacement text */
  redactionText?: string;
}

/**
 * Default data protection configuration
 */
const DEFAULT_CONFIG: Required<DataProtectionConfig> = {
  enabled: true,
  redactPII: true,
  redactSensitiveFields: true,
  customPatterns: [],
  customSensitiveFields: [],
  maxStringLength: 1000,
  redactionText: '[REDACTED]'
};

/**
 * Applies data protection to an audit entry before logging
 * Redacts PII, sensitive fields, and truncates long values
 */
export function protectAuditData(
  auditEntry: AuditEntry, 
  config: DataProtectionConfig = {}
): AuditEntry {
  const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (!effectiveConfig.enabled) {
    return auditEntry;
  }

  // Create a deep copy to avoid mutating the original
  const protectedEntry = JSON.parse(JSON.stringify(auditEntry));

  // Apply protection to all data blocks
  if (protectedEntry.data) {
    protectedEntry.data = protectObject(protectedEntry.data, effectiveConfig);
  }
  
  if (protectedEntry.metadata) {
    protectedEntry.metadata = protectObject(protectedEntry.metadata, effectiveConfig);
  }
  
  if (protectedEntry.context) {
    protectedEntry.context = protectObject(protectedEntry.context, effectiveConfig);
  }

  // Apply limited protection to metrics (preserve structure but redact values)
  if (protectedEntry.metrics) {
    protectedEntry.metrics = protectMetrics(protectedEntry.metrics, effectiveConfig);
  }

  return protectedEntry;
}

/**
 * Protects an object by redacting sensitive data
 */
function protectObject(obj: any, config: Required<DataProtectionConfig>): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => protectObject(item, config));
  }

  if (typeof obj === 'object') {
    const protectedObj: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Check if field name is sensitive
      if (config.redactSensitiveFields && isSensitiveField(lowerKey, config)) {
        protectedObj[key] = config.redactionText;
        continue;
      }
      
      // Recursively protect nested objects
      if (typeof value === 'object') {
        protectedObj[key] = protectObject(value, config);
      } else if (typeof value === 'string') {
        protectedObj[key] = protectString(value, config);
      } else {
        protectedObj[key] = value;
      }
    }
    
    return protectedObj;
  }

  if (typeof obj === 'string') {
    return protectString(obj, config);
  }

  return obj;
}

/**
 * Protects metrics object - preserve numeric values but redact strings
 */
function protectMetrics(metrics: any, config: Required<DataProtectionConfig>): any {
  if (!metrics || typeof metrics !== 'object') {
    return metrics;
  }

  const protectedMetrics: any = {};
  
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'string') {
      protectedMetrics[key] = protectString(value, config);
    } else if (typeof value === 'object') {
      protectedMetrics[key] = protectObject(value, config);
    } else {
      // Preserve numeric values for metrics
      protectedMetrics[key] = value;
    }
  }
  
  return protectedMetrics;
}

/**
 * Checks if a field name is considered sensitive
 */
function isSensitiveField(fieldName: string, config: Required<DataProtectionConfig>): boolean {
  const allSensitiveFields = [...SENSITIVE_FIELDS, ...config.customSensitiveFields];
  
  return allSensitiveFields.some(sensitiveField => 
    fieldName.includes(sensitiveField.toLowerCase())
  );
}

/**
 * Protects a string by redacting PII patterns and truncating length
 */
function protectString(str: string, config: Required<DataProtectionConfig>): string {
  if (!str || typeof str !== 'string') {
    return str;
  }

  let protectedStr = str;

  // Redact PII patterns
  if (config.redactPII) {
    const allPatterns = [...PII_PATTERNS, ...config.customPatterns];
    
    for (const { pattern } of allPatterns) {
      protectedStr = protectedStr.replace(pattern, config.redactionText);
    }
  }

  // Truncate long strings
  if (protectedStr.length > config.maxStringLength) {
    protectedStr = protectedStr.substring(0, config.maxStringLength) + '...[TRUNCATED]';
  }

  return protectedStr;
}

/**
 * Environment-aware data protection configuration
 * Enabled by default, can be disabled via environment variable
 */
export function getEnvironmentDataProtectionConfig(): DataProtectionConfig {
  const auditDataProtection = process.env.AUDIT_DATA_PROTECTION;
  
  // Explicit override to disable
  if (auditDataProtection === 'false') {
    return {
      enabled: false,
      redactPII: false,
      redactSensitiveFields: false
    };
  }
  
  // Default: enabled with basic protection
  return {
    enabled: true,
    redactPII: true,
    redactSensitiveFields: true,
    maxStringLength: 1000
  };
}

/**
 * Quick utility to check if a value contains potential PII
 * Useful for conditional redaction logic
 */
export function containsPII(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  return PII_PATTERNS.some(({ pattern }) => pattern.test(value));
}

/**
 * Utility to redact only specific PII types
 */
export function redactSpecificPII(
  value: string, 
  piiTypes: string[] = ['email', 'ssn', 'creditCard']
): string {
  if (!value || typeof value !== 'string') {
    return value;
  }
  
  let redacted = value;
  
  PII_PATTERNS
    .filter(({ name }) => piiTypes.includes(name))
    .forEach(({ pattern }) => {
      redacted = redacted.replace(pattern, '[REDACTED]');
    });
  
  return redacted;
}
