import { AuditEntry, AuditOptions } from './interfaces';
import { AuditLoggerFactory } from './loggers/factory';
import { Actor } from '../core/types/actor';
import { ExecutionContext } from '../core/types/execution-context';
import { randomUUID } from 'crypto';

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
    
    // Build metrics object
    const metrics = { ...options.metrics };
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
      context: options.context
    };
    
    // Create audit options
    const auditOptions: AuditOptions = {
      enabled: options.enabled,
      auditEntry
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