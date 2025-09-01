import { AuditEntry } from '../interfaces';
/**
 * Custom data protection function type - allows complete control over redaction
 */
export type DataProtectionFunction = (auditEntry: AuditEntry, config: DataProtectionConfig) => AuditEntry;
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
 * Applies data protection to an audit entry before logging
 * Uses fast-redact library for efficient and configurable redaction
 */
export declare function protectAuditData(auditEntry: AuditEntry, config?: DataProtectionConfig): AuditEntry;
/**
 * Utility to create a custom fast-redact configuration
 */
export declare function createRedactConfig(paths: string[], options?: Partial<FastRedactConfig>): FastRedactConfig;
