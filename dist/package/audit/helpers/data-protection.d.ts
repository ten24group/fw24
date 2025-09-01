import { AuditEntry } from '../interfaces';
/**
 * Custom data protection function type - allows complete control over redaction
 */
export type DataProtectionFunction = (auditEntry: AuditEntry, config: DataProtectionConfig) => AuditEntry;
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
 * Applies data protection to an audit entry before logging
 * Uses @hackylabs/deep-redact library for efficient and configurable redaction
 */
export declare function protectAuditData(auditEntry: AuditEntry, config?: DataProtectionConfig): AuditEntry;
/**
 * Utility to create a custom deep-redact configuration
 */
export declare function createRedactConfig(blacklistedKeys: (string | RegExp)[], options?: Partial<DeepRedactConfig>): DeepRedactConfig;
