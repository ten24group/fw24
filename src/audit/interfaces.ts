import { Actor } from "../core/types/execution-context";

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
    // === CORE IDENTIFICATION ===
    auditId?: string;                                    // Auto-generated UUID (ElectroDB handles this)
    auditType?: string;                                  // Record categorization (defaults to 'audit')
    timestamp?: string;                                  // ISO timestamp (caller can provide or auto-generated)
    timestampMs?: number;                               // Milliseconds timestamp (auto-generated from timestamp)
    
    // === CLASSIFICATION (Enhanced) ===
    logType?: 'audit' | 'log' | 'event' | 'metric';    // Type of log entry
    subType?: string;                                   // Detailed log sub-type (api_request, payment_processed, etc.)
    severity?: 'info' | 'warn' | 'error' | 'critical'; // Importance level
    category?: string;                                  // Log category (security, business, performance, etc.)
    
    // === ENTITY/RESOURCE TRACKING ===
    entityName?: string;                                // Entity being audited (e.g., 'user', 'payment', 'order')
    entityId?: string;                                  // Specific entity identifier
    eventType?: string;                                 // Action performed (e.g., 'create', 'update', 'delete', 'login')
    operation?: string;                                 // Operation alias for eventType
    
    // === SERVICE CONTEXT ===
    service?: string;                                   // Service name (user-service, payment-service, etc.)
    externalSystem?: string;                            // External system (stripe, sendgrid, github, etc.)
    externalId?: string;                                // External transaction/reference ID
    
    // === STATUS & OUTCOME ===
    status?: string;                                    // Operation status (pending, completed, failed, etc.)
    success?: boolean;                                  // Whether the operation succeeded
    ipAddress?: string;                                 // Source IP address
    
    // === METRICS (Grouped) ===
    metrics?: {
        duration?: number;                              // Operation duration in ms
        amount?: number;                                // Monetary amount (in cents/smallest unit)
        currency?: string;                              // Currency (USD, EUR, GBP)
        recordCount?: number;                           // Number of records processed/affected
        dataSize?: number;                              // Size of data processed (bytes)
        responseTime?: number;                          // API response time
        throughput?: number;                            // Records per second
        errorRate?: number;                             // Error percentage
        [key: string]: any;                             // Allow custom metrics
    };
    
    // === TRACKING IDs ===
    correlationId?: string;                             // Request chain tracking
    
    // === ACTOR CONTEXT ===
    actor?: Actor;                                      // Who performed the action (enhanced with tenant info)
    
    // === FLEXIBLE DATA BLOCKS ===
    data?: any;                                         // Main payload - structure varies by subType
    metadata?: any;                                     // Additional context (retries, config, etc.)
    context?: any;                                      // Request/response/environment context
    
    // === TTL & DATA PROTECTION ===
    ttl?: number;                                       // TTL timestamp for automatic deletion (Unix seconds)
    
    // === LEGACY SUPPORT ===
    identifiers?: any;                                  // Entity identifiers (legacy field, use entityId instead)
}

export interface IAuditLogger {
    audit(options: AuditOptions): Promise<void>;
}/**
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

  // Opt-out flags (default: capture everything when enabled)
  skipStart?: boolean;
  skipEnd?: boolean;
  skipErrors?: boolean;

  // Controller-specific includes (only for API controllers)
  includes?: {
    request?: boolean | ('headers' | 'body' | 'query')[];
    response?: boolean | ('headers' | 'body')[];
  };

  // Data protection configuration
  dataProtection?: {
    enabled?: boolean;
    redactPII?: boolean;
    redactSensitiveFields?: boolean;
    maxStringLength?: number;
  };

  // TTL configuration (Unix timestamp in seconds)
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
 