import { Actor } from '../core/types/actor';
export declare enum AuditLoggerType {
    CONSOLE = "console",
    CLOUDWATCH = "cloudwatch",
    DYNAMODB = "dynamodb",
    CUSTOM = "custom",
    DUMMY = "dummy"
}
/**
 * Constant containing the actual environment variable keys
 */
export declare const AUDIT_ENV_KEYS: {
    readonly ENABLED: "AUDIT_ENABLED";
    readonly TYPE: "AUDIT_TYPE";
    readonly LOG_GROUP_NAME: "AUDIT_LOG_GROUP_NAME";
    readonly REGION: "AUDIT_REGION";
    readonly AUDIT_TABLE_NAME: "AUDIT_TABLE_NAME";
    readonly ALLOWED_ENTITY_NAMES: "AUDIT_ALLOWED_ENTITY_NAMES";
};
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
