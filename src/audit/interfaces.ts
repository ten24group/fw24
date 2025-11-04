import { Actor } from '../core/types/actor';

export enum AuditLoggerType {
    CONSOLE = 'console',
    CLOUDWATCH = 'cloudwatch',
    DYNAMODB = 'dynamodb',
    CUSTOM = 'custom',
    DUMMY = 'dummy'
}

/**
 * Constant containing the actual environment variable keys
 */
export const AUDIT_ENV_KEYS = {
    ENABLED: 'AUDIT_ENABLED',
    TYPE: 'AUDIT_TYPE',
    LOG_GROUP_NAME: 'AUDIT_LOG_GROUP_NAME',
    REGION: 'AUDIT_REGION',
    AUDIT_TABLE_NAME: 'AUDIT_TABLE_NAME',
    ALLOWED_ENTITY_NAMES: 'AUDIT_ALLOWED_ENTITY_NAMES',
    EXCLUDED_ENTITY_NAMES: 'AUDIT_EXCLUDED_ENTITY_NAMES'
} as const;

export interface AuditLoggerConfig {
    type: AuditLoggerType;
    enabled?: boolean;
    logGroupName?: string;
    region?: string;
}

export interface AuditOptions {
    /**
     * Whether audit logging is enabled for this specific operation.
     * If not provided, the auditor's configuration will be used.
     */
    enabled?: boolean;
    auditEntry?: AuditEntry;
}

export interface AuditEntry {
    auditId?: string;                                    // Auto-generated UUID (ElectroDB handles this)
    auditType?: string;                                  // Record categorization (defaults to 'audit')
    timestamp?: string;                                  // ISO timestamp (caller can provide or auto-generated)
    timestampMs?: number;                               // Milliseconds timestamp (auto-generated from timestamp)
    entityName?: string;                                // Entity being audited (e.g., 'user', 'post')
    eventType?: string;                                 // Action performed (e.g., 'create', 'update', 'delete', 'login')
    severity?: 'info' | 'warn' | 'error' | 'critical'; // Importance level
    success?: boolean;                                  // Whether the operation succeeded
    data?: any;                                         // Changed fields or event-specific data
    actor?: Actor;                                      // Who performed the action
    identifiers?: any;                                  // Entity identifiers (preferred over full entity)
}

export interface IAuditLogger {
    audit(options: AuditOptions): Promise<void>;
} 