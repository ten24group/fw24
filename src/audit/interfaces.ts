export type AuditLoggerType = 'console' | 'cloudwatch' | 'dynamodb' | 'custom';

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