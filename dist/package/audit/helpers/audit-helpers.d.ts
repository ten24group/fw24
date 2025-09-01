import { Actor } from "../../core/types/execution-context";
import { ExecutionContext } from '../../core/types/execution-context';
import { AuditContext, RequestAuditContext, QueueAuditContext, TaskAuditContext } from '../../fw24';
/**
 * Enhanced capture options for the audit system
 *
 * This interface provides options for capturing logs with automatic
 * context extraction while maintaining backward compatibility.
 */
export interface CaptureLogOptions {
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
    data?: any;
    metadata?: any;
    context?: any;
    ctx?: ExecutionContext;
    actor?: Actor;
    duration?: number;
    ttl?: number;
    dataProtection?: {
        enabled?: boolean;
        redactPII?: boolean;
        redactSensitiveFields?: boolean;
        maxStringLength?: number;
    };
    enabled?: boolean;
}
/**
 * Enhanced capture log function for the existing audit system
 *
 * This is the primary interface for logging throughout the application.
 * It automatically extracts context from the execution environment and
 * provides sensible defaults for required fields.
 */
export declare function captureLog(options: CaptureLogOptions): Promise<void>;
/**
 * Convenience function for capturing errors with proper error formatting
 * This is actually useful since it handles error object serialization
 */
export declare function captureError(error: Error | unknown, options: Omit<CaptureLogOptions, 'severity' | 'success' | 'status' | 'data'>): Promise<void>;
/**
 * Audit capture service to handle audit logging for all controller types
 * This service breaks the circular import cycle by keeping audit logic separate from controllers
 */
export declare class AuditCaptureService {
    /**
     * Captures audit log for operation start
     */
    static captureStart(auditContext: AuditContext, operationContext: RequestAuditContext | QueueAuditContext | TaskAuditContext): Promise<void>;
    /**
     * Captures audit log for operation end (success or error)
     */
    static captureEnd(auditContext: AuditContext, _result: any, error: Error | null, responseContext?: any): Promise<void>;
}
