import { AuditEntry, AuditOptions } from '../interfaces';
import { AuditLoggerFactory } from '../loggers/factory';
import { Actor } from "../../core/types/execution-context";
import { ExecutionContext } from '../../core/types/execution-context';
import { randomUUID } from 'crypto';
import { AuditContext, RequestAuditContext, QueueAuditContext, TaskAuditContext } from '../../fw24';
import { protectAuditData, DataProtectionConfig } from './data-protection';

/**
 * Enhanced capture options for the audit system
 * 
 * This interface provides options for capturing logs with automatic
 * context extraction while maintaining backward compatibility.
 */
export interface CaptureLogOptions {
  // === CLASSIFICATION ===
  logType?: 'audit' | 'log' | 'event' | 'metric';
  subType?: string;
  severity?: 'info' | 'warn' | 'error' | 'critical';
  category?: string;
  
  // === ENTITY/RESOURCE TRACKING ===
  entityName?: string;
  entityId?: string;
  eventType?: string;
  operation?: string;
  
  // === SERVICE CONTEXT ===
  service?: string;
  externalSystem?: string;
  externalId?: string;
  
  // === STATUS & OUTCOME ===
  status?: string;
  success?: boolean;
  
  // === METRICS ===
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
  
  // === TRACKING ===
  correlationId?: string;
  
  // === DATA BLOCKS ===
  data?: any;
  metadata?: any;
  context?: any;
  
  // === RUNTIME CONTEXT ===
  ctx?: ExecutionContext;
  actor?: Actor;
  
  // === CONVENIENCE ===
  duration?: number; // Will be added to metrics
  
  // === TTL & DATA PROTECTION ===
  ttl?: number;                      // Custom TTL timestamp (Unix seconds)
  dataProtection?: DataProtectionConfig;
  
  // === CONTROL ===
  enabled?: boolean;
}

/**
 * Enhanced capture log function for the existing audit system
 * 
 * This is the primary interface for logging throughout the application.
 * It automatically extracts context from the execution environment and
 * provides sensible defaults for required fields.
 */
export async function captureLog(options: CaptureLogOptions): Promise<void> {
  try {
    const auditLogger = AuditLoggerFactory.getInstance().create();
    
    // Extract context information
    const actor = options.actor || options.ctx?.actor;
    const correlationId = options.correlationId || options.ctx?.request?.requestId || randomUUID();
    const ipAddress = options.ctx?.event?.requestContext?.identity?.sourceIp;
    
    // Build metrics object only if needed
    const metrics: Record<string, any> = {};
    if (options.metrics) {
      Object.assign(metrics, options.metrics);
    }
    if (options.duration !== undefined) {
      metrics.duration = options.duration;
    }
    
    // Determine status based on success flag
    let status = options.status;
    if (status === undefined && options.success !== undefined) {
      status = options.success ? 'completed' : 'failed';
    }
    
    // Create the enhanced audit entry
    const auditEntry: AuditEntry = {
      // === CLASSIFICATION ===
      logType: options.logType || 'audit',
      subType: options.subType,
      severity: options.severity || 'info',
      category: options.category,
      
      // === ENTITY/RESOURCE TRACKING ===
      entityName: options.entityName || 'unknown',
      entityId: options.entityId,
      eventType: options.eventType || 'unknown',
      operation: options.operation,
      
      // === SERVICE CONTEXT ===
      service: options.service,
      externalSystem: options.externalSystem,
      externalId: options.externalId,
      
      // === STATUS & OUTCOME ===
      status,
      success: options.success,
      ipAddress,
      
      // === METRICS ===
      metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
      
      // === TRACKING ===
      correlationId,
      
      // === ACTOR ===
      actor,
      
      // === DATA BLOCKS ===
      data: options.data,
      metadata: options.metadata,
      context: options.context,
      
      // === TTL ===
      ttl: options.ttl
    };
    
    // Apply data protection
    const dataProtectionConfig = {
      ...options.dataProtection
    };
    const protectedAuditEntry = protectAuditData(auditEntry, dataProtectionConfig);
    
    // Create audit options
    const auditOptions: AuditOptions = {
      enabled: options.enabled,
      auditEntry: protectedAuditEntry
    };
    
    // Log the entry using the existing audit system
    await auditLogger.audit(auditOptions);
    
  } catch (error) {
    // Don't break business logic on logging failures
    console.error('Failed to capture audit log:', error, {
      logType: options.logType,
      subType: options.subType,
      entityName: options.entityName,
      correlationId: options.correlationId
    });
  }
}

/**
 * Convenience function for capturing errors with proper error formatting
 * This is actually useful since it handles error object serialization
 */
export async function captureError(
  error: Error | unknown, 
  options: Omit<CaptureLogOptions, 'severity' | 'success' | 'status' | 'data'>
): Promise<void> {
  return captureLog({
    ...options,
    severity: 'error',
    success: false,
    status: 'failed',
    data: {
      error: error
    }
  });
}
/**
 * Audit capture service to handle audit logging for all controller types
 * This service breaks the circular import cycle by keeping audit logic separate from controllers
 */

export class AuditCaptureService {

  /**
   * Captures audit log for operation start
   */
  static async captureStart(
    auditContext: AuditContext,
    operationContext: RequestAuditContext | QueueAuditContext | TaskAuditContext
  ): Promise<void> {
    if (!auditContext.enabled || auditContext.auditConfig.skipStart) return;

    // Check sampling
    if (auditContext.auditConfig.samplingFn &&
      !auditContext.auditConfig.samplingFn(auditContext.correlation.correlationId, auditContext.operation)) {
      return;
    }

    await captureLog({
      logType: auditContext.logType,
      subType: `${auditContext.subType}_start`,
      entityName: auditContext.entityName,
      entityId: auditContext.entityId,
      eventType: 'start',
      operation: auditContext.operation,
      category: auditContext.category,
      correlationId: auditContext.correlation.correlationId,
      actor: auditContext.actor,
      context: {
        correlation: auditContext.correlation,
        [ auditContext.correlation.operationType ]: operationContext
      },
      metadata: auditContext.auditConfig.customContext,
      ttl: auditContext.auditConfig.ttl,
      dataProtection: auditContext.auditConfig.dataProtection
    });
  }

  /**
   * Captures audit log for operation end (success or error)
   */
  static async captureEnd(
    auditContext: AuditContext,
    _result: any,
    error: Error | null,
    responseContext?: any
  ): Promise<void> {
    if (!auditContext.enabled) return;
    if (error && auditContext.auditConfig.skipErrors) return;
    if (!error && auditContext.auditConfig.skipEnd) return;

    // Check sampling
    if (auditContext.auditConfig.samplingFn &&
      !auditContext.auditConfig.samplingFn(auditContext.correlation.correlationId, auditContext.operation)) {
      return;
    }

    const duration = Date.now() - new Date(auditContext.correlation.startTimestamp).getTime();

    await captureLog({
      logType: auditContext.logType,
      subType: error ? `${auditContext.subType}_error` : `${auditContext.subType}_complete`,
      entityName: auditContext.entityName,
      entityId: auditContext.entityId,
      eventType: error ? 'error' : 'complete',
      operation: auditContext.operation,
      category: auditContext.category,
      success: !error,
      status: error ? 'failed' : 'completed',
      correlationId: auditContext.correlation.correlationId,
      actor: auditContext.actor,
      metrics: {
        duration,
        ...(responseContext ? {
          statusCode: responseContext.statusCode,
          responseSize: responseContext.responseSize
        } : {})
      },
      context: {
        correlation: auditContext.correlation,
        ...(responseContext && { response: responseContext })
      },
      metadata: auditContext.auditConfig.customContext,
      ttl: auditContext.auditConfig.ttl,
      dataProtection: auditContext.auditConfig.dataProtection,
      data: { error }
    });
  }
}
