import { Actor } from "../core/types/execution-context";
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
    auditId?: string;
    auditType?: string;
    timestamp?: string;
    timestampMs?: number;
    logType?: 'audit' | 'log' | 'event' | 'metric';
    subType?: string;
    severity?: 'info' | 'warn' | 'error' | 'critical';
    category?: string;
    entityName?: string;
    entityId?: string;
    eventType?: string;
    operation?: string;
    service?: string;
    externalSystem?: string;
    externalId?: string;
    status?: string;
    success?: boolean;
    ipAddress?: string;
    metrics?: {
        duration?: number;
        amount?: number;
        currency?: string;
        recordCount?: number;
        dataSize?: number;
        responseTime?: number;
        throughput?: number;
        errorRate?: number;
        [key: string]: any;
    };
    correlationId?: string;
    actor?: Actor;
    data?: any;
    metadata?: any;
    context?: any;
    ttl?: number;
    identifiers?: any;
}
export interface IAuditLogger {
    audit(options: AuditOptions): Promise<void>;
} /**
 * Configurable sampling function for audit logging
 */
export type SamplingFunction = (correlationId: string, operation: string) => boolean;
/**
 * Generic audit configuration for all controller types
 */
export interface AuditConfig {
    enabled?: boolean;
    category?: string;
    customContext?: any;
    samplingFn?: SamplingFunction;
    skipStart?: boolean;
    skipEnd?: boolean;
    skipErrors?: boolean;
    includes?: {
        request?: boolean | ('headers' | 'body' | 'query')[];
        response?: boolean | ('headers' | 'body')[];
    };
    dataProtection?: {
        enabled?: boolean;
        redactPII?: boolean;
        redactSensitiveFields?: boolean;
        maxStringLength?: number;
    };
    ttl?: number;
}
/**
 * Correlation context for tracking operations across services
 */
export interface CorrelationContext {
    correlationId: string;
    operationId: string;
    parentOperationId?: string;
    operationType: 'api' | 'queue' | 'task';
    operationName: string;
    startTimestamp: string;
}
/**
 * Core audit context for framework components
 */
export interface AuditContext {
    enabled: boolean;
    logType: 'audit' | 'log' | 'event' | 'metric';
    subType: string;
    entityName: string;
    operation: string;
    category?: string;
    actor?: Actor;
    correlation: CorrelationContext;
    auditConfig: AuditConfig;
}
/**
 * Request-specific context for API controllers
 */
export interface RequestAuditContext {
    method: string;
    path: string;
    headers?: any;
    body?: any;
    query?: any;
    userAgent?: string;
    sourceIp?: string;
}
/**
 * Queue-specific context for SQS controllers
 */
export interface QueueAuditContext {
    queueName?: string;
    batchSize: number;
    messageIds: string[];
    approximateReceiveCount?: number;
}
/**
 * Task-specific context for scheduled tasks
 */
export interface TaskAuditContext {
    taskName?: string;
    schedule?: string;
    triggerSource: 'scheduled' | 'manual' | 'api';
    environment?: string;
}
