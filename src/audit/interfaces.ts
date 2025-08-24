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
    ALLOWED_ENTITY_NAMES: 'AUDIT_ALLOWED_ENTITY_NAMES'
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
    timestamp?: string;
    entityName?: string;
    eventType?: string;
    data?: any;
    entity?: any;
    actor?: Actor;
    tenant?: any;
    identifiers?: any;
}

export interface IAuditLogger {
    audit(options: AuditOptions): Promise<void>;
} 