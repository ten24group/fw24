export type AuditLoggerType = 'console' | 'cloudwatch' | 'dynamodb' | 'custom';

/**
 * Environment variable keys used for audit configuration
 */
export interface AuditEnvKeys {
    ENABLED: 'AUDIT_ENABLED';
    TYPE: 'AUDIT_TYPE';
    LOG_GROUP_NAME: 'AUDIT_LOG_GROUP_NAME';
    REGION: 'AUDIT_REGION';
    TABLE_NAME: 'AUDIT_TABLE_NAME';
}

/**
 * Constant containing the actual environment variable keys
 */
export const AUDIT_ENV_KEYS: AuditEnvKeys = {
    ENABLED: 'AUDIT_ENABLED',
    TYPE: 'AUDIT_TYPE',
    LOG_GROUP_NAME: 'AUDIT_LOG_GROUP_NAME',
    REGION: 'AUDIT_REGION',
    TABLE_NAME: 'AUDIT_TABLE_NAME'
} as const;


export interface AuditorConfig {
    enabled: boolean;
    type: AuditLoggerType;
    logGroupName?: string;
    region?: string;
}

export interface AuditOptions {
    /**
     * Whether audit logging is enabled for this specific operation.
     * If not provided, the auditor's configuration will be used.
     */
    enabled?: boolean;
    entityName: string;
    crudType: string;
    data?: any;
    entity?: any;
    actor?: any;
    tenant?: any;
    identifiers?: any;
}

export interface IAuditor {
    audit(options: AuditOptions): Promise<void>;
} 