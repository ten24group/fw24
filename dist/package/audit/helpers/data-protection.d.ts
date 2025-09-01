import { AuditEntry } from '../interfaces';
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
    customPatterns?: Array<{
        name: string;
        pattern: RegExp;
    }>;
    /** Custom sensitive field names */
    customSensitiveFields?: string[];
    /** Maximum string length before truncation */
    maxStringLength?: number;
    /** Redaction replacement text */
    redactionText?: string;
}
/**
 * Applies data protection to an audit entry before logging
 * Redacts PII, sensitive fields, and truncates long values
 */
export declare function protectAuditData(auditEntry: AuditEntry, config?: DataProtectionConfig): AuditEntry;
/**
 * Environment-aware data protection configuration
 * Enabled by default, can be disabled via environment variable
 */
export declare function getEnvironmentDataProtectionConfig(): DataProtectionConfig;
/**
 * Quick utility to check if a value contains potential PII
 * Useful for conditional redaction logic
 */
export declare function containsPII(value: string): boolean;
/**
 * Utility to redact only specific PII types
 */
export declare function redactSpecificPII(value: string, piiTypes?: string[]): string;
